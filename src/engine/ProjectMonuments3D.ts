import * as THREE from 'three';
import type { PortfolioProject } from '../data/projectsData';
import { ScreenDemoRenderer } from './ScreenDemoRenderer';

export interface MonumentObstacle {
  x: number;
  z: number;
  radius: number;
}

export interface ProjectApproachWaypoints {
  entry: THREE.Vector3;
  park: THREE.Vector3;
  lookAt: THREE.Vector3;
}

interface MonumentEntry {
  project: PortfolioProject;
  root: THREE.Group;
  titleGroup: THREE.Group;
  screenMaterial: THREE.MeshStandardMaterial;
  descMaterial: THREE.MeshStandardMaterial;
  bayMaterial: THREE.MeshBasicMaterial;
  demoRenderer: ScreenDemoRenderer;
  screenTexture: THREE.CanvasTexture;
  screenWorldCenter: THREE.Vector3;
  screenSphere: THREE.Sphere;
  screenForward: THREE.Vector3;
  worldPosition: THREE.Vector3;
  demoElapsed: number;
  frameTimer: number;
  wasPlaying: boolean;
  isHovered: boolean;
  phase: number;
}

const TARGET_FPS = 20;
const FRAME_INTERVAL = 1 / TARGET_FPS;
const MAX_PLAY_DISTANCE = 46;
const MIN_CAMERA_DOT = 0.35;
const MIN_FRONT_FACE_DOT = -0.15;

/**
 * Renders 3D editorial portfolio stations inside the Blender-style world:
 * - Floating matte typographic title sign above (y ~ 5.15 m)
 * - Side-by-side layout: live video-demo canvas on the left (5.40 x 3.38 m)
 *   and static high-res editorial description on the right (3.10 x 3.38 m)
 * - Discrete matte stone-gray parking bay corner brackets on the floor
 * - Frustum + gaze gating so demos only tick & upload at ~20 FPS while looked at
 */
export class ProjectMonuments3D {
  public readonly group = new THREE.Group();
  public readonly interactiveMeshes: THREE.Object3D[] = [];

  private readonly entries: MonumentEntry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private readonly frustum = new THREE.Frustum();
  private readonly projScreenMatrix = new THREE.Matrix4();
  private readonly cameraForward = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private globalTime = 0;

  constructor(scene: THREE.Scene, projects: PortfolioProject[], maxAnisotropy = 8) {
    this.group.name = 'Portfolio_Project_Monuments';

    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x1b1d23,
      metalness: 0.42,
      roughness: 0.68,
      envMapIntensity: 0.25,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x262932,
      metalness: 0.25,
      roughness: 0.78,
      envMapIntensity: 0.16,
    });
    this.materials.push(metalMat, trimMat);

    // Shared structural geometries
    const plinthGeo = new THREE.BoxGeometry(6.8, 0.24, 1.1);
    const strutGeo = new THREE.BoxGeometry(0.24, 3.35, 0.28);
    const spineGeo = new THREE.BoxGeometry(8.1, 0.2, 0.22);

    const videoBackGeo = new THREE.BoxGeometry(5.54, 3.52, 0.14);
    const videoFaceGeo = new THREE.PlaneGeometry(5.4, 3.38);

    const descBackGeo = new THREE.BoxGeometry(3.24, 3.52, 0.14);
    const descFaceGeo = new THREE.PlaneGeometry(3.1, 3.38);

    const titleBackGeo = new THREE.BoxGeometry(5.48, 0.96, 0.08);
    const titleFaceGeo = new THREE.PlaneGeometry(5.38, 0.88);

    // Corner bracket arm geometries for parking bay (no neon ring)
    const armXGeo = new THREE.PlaneGeometry(0.85, 0.1);
    armXGeo.rotateX(-Math.PI / 2);
    const armZGeo = new THREE.PlaneGeometry(0.1, 0.85);
    armZGeo.rotateX(-Math.PI / 2);

    this.geometries.push(
      plinthGeo,
      strutGeo,
      spineGeo,
      videoBackGeo,
      videoFaceGeo,
      descBackGeo,
      descFaceGeo,
      titleBackGeo,
      titleFaceGeo,
      armXGeo,
      armZGeo,
    );

    const clampedAniso = Math.min(8, maxAnisotropy);

    projects.forEach((project, idx) => {
      const root = new THREE.Group();
      root.name = `Monument_${project.id}`;
      root.position.set(project.worldPos.x, 0, project.worldPos.z);
      root.rotation.y = project.worldPos.angleY;

      // Plinth & twin rear structural struts at z = -0.52 so nothing intersects the screens
      const plinth = new THREE.Mesh(plinthGeo, metalMat);
      plinth.position.set(0.1, 0.12, -0.52);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      root.add(plinth);

      for (const sx of [-2.25, 2.25]) {
        const strut = new THREE.Mesh(strutGeo, metalMat);
        strut.position.set(sx, 1.82, -0.52);
        strut.castShadow = true;
        strut.receiveShadow = true;
        root.add(strut);
      }

      for (const sy of [1.85, 3.45]) {
        const spine = new THREE.Mesh(spineGeo, trimMat);
        spine.position.set(0.25, sy, -0.32);
        spine.castShadow = true;
        root.add(spine);
      }

      // Display Assembly (centered vertically at y = 2.65 m, subtle downward tilt)
      const displayGroup = new THREE.Group();
      displayGroup.position.set(0, 2.65, 0);
      displayGroup.rotation.x = 0.035;
      root.add(displayGroup);

      // Left Panel: Live Video-Demo Canvas (5.40 x 3.38 m at x = -1.68)
      const videoBack = new THREE.Mesh(videoBackGeo, metalMat);
      videoBack.position.set(-1.68, 0, -0.09);
      videoBack.castShadow = true;
      videoBack.receiveShadow = true;
      videoBack.userData.projectId = project.id;
      displayGroup.add(videoBack);

      const demoRenderer = new ScreenDemoRenderer(project);
      demoRenderer.render(0, false);

      const screenTexture = new THREE.CanvasTexture(demoRenderer.getCanvas());
      screenTexture.colorSpace = THREE.SRGBColorSpace;
      screenTexture.anisotropy = clampedAniso;
      screenTexture.minFilter = THREE.LinearFilter;
      screenTexture.magFilter = THREE.LinearFilter;
      screenTexture.generateMipmaps = false;
      screenTexture.needsUpdate = true;
      this.textures.push(screenTexture);

      const screenMaterial = new THREE.MeshStandardMaterial({
        map: screenTexture,
        emissiveMap: screenTexture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.88,
        roughness: 0.96,
        metalness: 0.0,
        envMapIntensity: 0.06,
      });
      this.materials.push(screenMaterial);

      const videoFace = new THREE.Mesh(videoFaceGeo, screenMaterial);
      videoFace.position.set(-1.68, 0, 0.0);
      videoFace.userData.projectId = project.id;
      displayGroup.add(videoFace);

      // Right Panel: High-Res Editorial Description (3.10 x 3.38 m at x = +2.78)
      const descBack = new THREE.Mesh(descBackGeo, metalMat);
      descBack.position.set(2.78, 0, -0.09);
      descBack.castShadow = true;
      descBack.receiveShadow = true;
      descBack.userData.projectId = project.id;
      displayGroup.add(descBack);

      const descTexture = this.createEditorialDescriptionTexture(project, clampedAniso);
      this.textures.push(descTexture);

      const descMaterial = new THREE.MeshStandardMaterial({
        map: descTexture,
        emissiveMap: descTexture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.86,
        roughness: 0.95,
        metalness: 0.0,
        envMapIntensity: 0.06,
      });
      this.materials.push(descMaterial);

      const descFace = new THREE.Mesh(descFaceGeo, descMaterial);
      descFace.position.set(2.78, 0, 0.0);
      descFace.userData.projectId = project.id;
      displayGroup.add(descFace);

      this.interactiveMeshes.push(videoFace, videoBack, descFace, descBack);

      // Floating 3D Title Sign Above (y ~ 5.15 m)
      const titleGroup = new THREE.Group();
      titleGroup.position.set(0.35, 5.15, 0.04);
      root.add(titleGroup);

      const titleBack = new THREE.Mesh(titleBackGeo, trimMat);
      titleBack.position.set(0, 0, -0.045);
      titleBack.castShadow = true;
      titleBack.userData.projectId = project.id;
      titleGroup.add(titleBack);

      const titleTexture = this.createFloatingTitleTexture(project, clampedAniso);
      this.textures.push(titleTexture);

      const titleMat = new THREE.MeshStandardMaterial({
        map: titleTexture,
        emissiveMap: titleTexture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.72,
        roughness: 0.94,
        metalness: 0.0,
        envMapIntensity: 0.04,
      });
      this.materials.push(titleMat);

      const titleFace = new THREE.Mesh(titleFaceGeo, titleMat);
      titleFace.position.set(0, 0, 0.005);
      titleFace.userData.projectId = project.id;
      titleGroup.add(titleFace);
      this.interactiveMeshes.push(titleFace);

      // Discrete Matte Stone-Gray Parking Bay Corner Brackets (no neon rings)
      const bayMaterial = new THREE.MeshBasicMaterial({
        color: 0x6c707a,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.materials.push(bayMaterial);

      const bayCenterX = 0.5;
      const bayCenterZ = 8.2;
      const halfW = 1.85;
      const halfL = 2.65;

      const corners: Array<[number, number, number, number]> = [
        [bayCenterX - halfW, bayCenterZ - halfL, 1, 1],
        [bayCenterX + halfW, bayCenterZ - halfL, -1, 1],
        [bayCenterX - halfW, bayCenterZ + halfL, 1, -1],
        [bayCenterX + halfW, bayCenterZ + halfL, -1, -1],
      ];

      for (const [cx, cz, sx, sz] of corners) {
        const barX = new THREE.Mesh(armXGeo, bayMaterial);
        barX.position.set(cx + sx * 0.375, 0.016, cz);
        root.add(barX);

        const barZ = new THREE.Mesh(armZGeo, bayMaterial);
        barZ.position.set(cx, 0.016, cz + sz * 0.375);
        root.add(barZ);
      }

      this.group.add(root);
      root.updateMatrixWorld(true);

      // Precompute world-space center, bounding sphere, and front normal for gaze gating
      const screenWorldCenter = new THREE.Vector3(-1.68, 2.65, 0).applyMatrix4(root.matrixWorld);
      const screenSphere = new THREE.Sphere(screenWorldCenter.clone(), 3.4);
      const screenForward = new THREE.Vector3(
        Math.sin(project.worldPos.angleY),
        0,
        Math.cos(project.worldPos.angleY),
      ).normalize();

      this.entries.push({
        project,
        root,
        titleGroup,
        screenMaterial,
        descMaterial,
        bayMaterial,
        demoRenderer,
        screenTexture,
        screenWorldCenter,
        screenSphere,
        screenForward,
        worldPosition: new THREE.Vector3(project.worldPos.x, 0, project.worldPos.z),
        demoElapsed: 0,
        frameTimer: 0,
        wasPlaying: false,
        isHovered: false,
        phase: idx * 0.9,
      });
    });

    scene.add(this.group);
  }

  private createFloatingTitleTexture(
    project: PortfolioProject,
    maxAnisotropy: number,
  ): THREE.CanvasTexture {
    const w = 1024;
    const h = 168;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.fillStyle = '#18191e';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#52555f';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      // Category metadata
      ctx.fillStyle = '#c98a55';
      ctx.font = '600 22px "IBM Plex Mono", "Consolas", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(this.truncateText(ctx, project.category.toUpperCase(), w - 72), 36, 58);

      // Main Space Grotesk Title
      ctx.fillStyle = '#f4f5f7';
      ctx.font = '700 54px "Space Grotesk", "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(this.truncateText(ctx, project.title, w - 72), 36, 124);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  private createEditorialDescriptionTexture(
    project: PortfolioProject,
    maxAnisotropy: number,
  ): THREE.CanvasTexture {
    const w = 820;
    const h = 900;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      // Matte slate background (Impeccable editorial palette)
      ctx.fillStyle = '#14161b';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#363944';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);

      const pad = 42;
      const contentW = w - pad * 2;

      // Top bar: Category & Period
      ctx.fillStyle = '#c98a55';
      ctx.font = '600 20px "IBM Plex Mono", "Consolas", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(this.truncateText(ctx, project.category.toUpperCase(), contentW - 180), pad, 56);

      ctx.fillStyle = '#9ea4b3';
      ctx.textAlign = 'right';
      ctx.fillText(project.period, w - pad, 56);

      // Subtle divider
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad, 78);
      ctx.lineTo(w - pad, 78);
      ctx.stroke();

      // Subtitle
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f3f4f6';
      ctx.font = '600 25px "Space Grotesk", "IBM Plex Sans", sans-serif';
      let cursorY = 118;
      cursorY = this.drawWrappedText(ctx, project.subtitle, pad, cursorY, contentW, 32, 2);

      // Section: O que faz
      cursorY += 22;
      ctx.fillStyle = '#c98a55';
      ctx.font = '700 18px "IBM Plex Mono", monospace';
      ctx.fillText('O QUE FAZ', pad, cursorY);

      cursorY += 28;
      ctx.fillStyle = '#d4d8e1';
      ctx.font = '400 21px "IBM Plex Sans", system-ui, sans-serif';
      const whatText = project.whatItDoes || project.summary;
      cursorY = this.drawWrappedText(ctx, whatText, pad, cursorY, contentW, 29, 6);

      // Section: Arquitetura
      cursorY += 22;
      ctx.fillStyle = '#c98a55';
      ctx.font = '700 18px "IBM Plex Mono", monospace';
      ctx.fillText('ARQUITETURA', pad, cursorY);

      cursorY += 28;
      ctx.fillStyle = '#c2c7d4';
      ctx.font = '400 19px "IBM Plex Sans", system-ui, sans-serif';
      cursorY = this.drawWrappedText(ctx, project.architecture, pad, cursorY, contentW, 26, 4);

      // Metrics (2-3 real metrics in crisp editorial cells)
      const metricsY = 588;
      const metrics = project.metrics.slice(0, 3);
      if (metrics.length > 0) {
        const gap = 14;
        const cellW = (contentW - gap * (metrics.length - 1)) / metrics.length;
        const cellH = 98;
        metrics.forEach((m, idx) => {
          const mx = pad + idx * (cellW + gap);
          this.drawRoundRect(ctx, mx, metricsY, cellW, cellH, 8, '#1c1f26', '#323642');

          ctx.fillStyle = '#98a0b0';
          ctx.font = '600 14px "IBM Plex Sans", sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(this.truncateText(ctx, m.label.toUpperCase(), cellW - 24), mx + 14, metricsY + 32);

          ctx.fillStyle = '#f8fafc';
          ctx.font = '700 22px "IBM Plex Mono", monospace';
          ctx.fillText(this.truncateText(ctx, m.value, cellW - 24), mx + 14, metricsY + 72);
        });
      }

      // Technologies
      const techSectionY = 720;
      ctx.fillStyle = '#98a0b0';
      ctx.font = '600 16px "IBM Plex Mono", monospace';
      ctx.fillText('TECNOLOGIAS', pad, techSectionY);

      let tagX = pad;
      let tagY = techSectionY + 16;
      const rowH = 34;
      ctx.font = '500 16px "IBM Plex Sans", sans-serif';

      for (const rawTech of project.technologies.slice(0, 8)) {
        const techName =
          typeof rawTech === 'string'
            ? rawTech
            : (rawTech as unknown as { name?: string }).name ?? '';
        if (!techName) continue;
        const tw = ctx.measureText(techName).width;
        const pillW = tw + 24;

        if (tagX + pillW > w - pad) {
          tagX = pad;
          tagY += rowH + 10;
          if (tagY > h - 78) break;
        }

        this.drawRoundRect(ctx, tagX, tagY, pillW, rowH, 6, '#1e2129', '#3a3f4d');
        ctx.fillStyle = '#e5e7eb';
        ctx.textBaseline = 'middle';
        ctx.fillText(techName, tagX + 12, tagY + rowH / 2 + 0.5);
        ctx.textBaseline = 'alphabetic';
        tagX += pillW + 10;
      }

      // Footer interaction cue
      ctx.fillStyle = '#9ca3af';
      ctx.font = '500 16px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      const hint = project.isChatbot
        ? '[E] ou Clique para abrir chat interativo'
        : '[E] ou Clique para ampliar galeria & repositório';
      ctx.fillText(hint, pad, h - 26);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  private drawRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: string,
    stroke?: string,
  ): void {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  private drawWrappedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
  ): number {
    const words = text.split(/\s+/);
    let line = '';
    let currentY = y;
    let linesDrawn = 0;

    for (let i = 0; i < words.length; i++) {
      const candidate = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(candidate).width > maxWidth && line) {
        if (linesDrawn === maxLines - 1) {
          ctx.fillText(this.truncateText(ctx, `${line} ${words[i]}`, maxWidth), x, currentY);
          return currentY + lineHeight;
        }
        ctx.fillText(line, x, currentY);
        line = words[i];
        currentY += lineHeight;
        linesDrawn++;
      } else {
        line = candidate;
      }
    }
    if (line && linesDrawn < maxLines) {
      ctx.fillText(line, x, currentY);
      return currentY + lineHeight;
    }
    return currentY;
  }

  private truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let trimmed = text;
    while (trimmed.length > 4 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}…`;
  }

  public setHovered(projectId: string | null): void {
    for (const entry of this.entries) {
      entry.isHovered = entry.project.id === projectId;
    }
  }

  public setHoveredProject(projectId: string | null): void {
    this.setHovered(projectId);
  }

  public getProjectById(projectId: string): PortfolioProject | null {
    const match = this.entries.find((e) => e.project.id === projectId);
    return match ? match.project : null;
  }

  public getObstacles(): MonumentObstacle[] {
    const obstacles: MonumentObstacle[] = [];
    for (const entry of this.entries) {
      const angle = entry.project.worldPos.angleY;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      // 3 collision circles spanning the side-by-side station width without protruding forward
      for (const localX of [-2.8, 0.2, 2.9]) {
        obstacles.push({
          x: entry.project.worldPos.x + localX * cosA,
          z: entry.project.worldPos.z - localX * sinA,
          radius: 1.95,
        });
      }
    }
    return obstacles;
  }

  /**
   * Computes approach waypoints for autonomous driving:
   * - entry: 13.5 m ahead (+Z local)
   * - park: 8.2 m ahead (+Z local), shifted +0.5 m in local X so car + video + description frame cleanly
   * - lookAt: center of the paired display
   */
  public getProjectApproachWaypoints(projectId: string): ProjectApproachWaypoints | null {
    const entry = this.entries.find((e) => e.project.id === projectId);
    if (!entry) return null;

    entry.root.updateMatrixWorld(true);
    const entryPos = new THREE.Vector3(0.5, 0, 13.5).applyMatrix4(entry.root.matrixWorld);
    const parkPos = new THREE.Vector3(0.5, 0, 8.2).applyMatrix4(entry.root.matrixWorld);
    const lookAtPos = new THREE.Vector3(0.5, 2.65, 0).applyMatrix4(entry.root.matrixWorld);

    return {
      entry: entryPos,
      park: parkPos,
      lookAt: lookAtPos,
    };
  }

  /**
   * Updates floating title signs, gaze-gated 20 FPS video playback, and returns
   * the list of project IDs currently playing.
   */
  public update(dt: number, camera: THREE.Camera, carPosition: THREE.Vector3): string[] {
    this.globalTime += dt;
    const activePlayingIds: string[] = [];

    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
    this.cameraForward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

    for (const entry of this.entries) {
      // Gentle vertical float on the 3D name sign above (y ~ 5.15 m)
      entry.titleGroup.position.y = 5.15 + Math.sin(this.globalTime * 1.35 + entry.phase) * 0.08;

      // Subtle non-neon bay opacity feedback when car is parked nearby or screen is hovered
      const carDist = Math.hypot(
        carPosition.x - entry.worldPosition.x,
        carPosition.z - entry.worldPosition.z,
      );
      const isNear = carDist < 11.5;
      const targetBayOpacity = entry.isHovered ? 0.5 : isNear ? 0.42 : 0.28;
      entry.bayMaterial.opacity +=
        (targetBayOpacity - entry.bayMaterial.opacity) * Math.min(1, dt * 8);

      const targetEmissive = entry.isHovered ? 0.96 : 0.88;
      entry.screenMaterial.emissiveIntensity +=
        (targetEmissive - entry.screenMaterial.emissiveIntensity) * Math.min(1, dt * 8);
      entry.descMaterial.emissiveIntensity +=
        ((entry.isHovered ? 0.94 : 0.86) - entry.descMaterial.emissiveIntensity) *
        Math.min(1, dt * 8);

      // Gaze & Frustum Gating
      const camDist = camera.position.distanceTo(entry.screenWorldCenter);
      let isLooking = false;

      if (camDist < MAX_PLAY_DISTANCE && this.frustum.intersectsSphere(entry.screenSphere)) {
        this.tmpDir.subVectors(entry.screenWorldCenter, camera.position).normalize();
        const forwardDot = this.cameraForward.dot(this.tmpDir);
        const frontFaceDot = entry.screenForward.dot(this.tmpDir.negate());

        if (forwardDot > MIN_CAMERA_DOT && frontFaceDot > MIN_FRONT_FACE_DOT) {
          isLooking = true;
        }
      }

      if (isLooking) {
        entry.demoElapsed += dt;
        entry.frameTimer += dt;

        if (!entry.wasPlaying || entry.frameTimer >= FRAME_INTERVAL) {
          entry.frameTimer = entry.frameTimer % FRAME_INTERVAL;
          entry.demoRenderer.consumeAssetRefresh();
          entry.demoRenderer.render(entry.demoElapsed, true);
          entry.screenTexture.needsUpdate = true;
        }
        entry.wasPlaying = true;
        activePlayingIds.push(entry.project.id);
      } else {
        if (entry.wasPlaying || entry.demoRenderer.consumeAssetRefresh()) {
          entry.demoRenderer.render(entry.demoElapsed, false);
          entry.screenTexture.needsUpdate = true;
          entry.wasPlaying = false;
          entry.frameTimer = 0;
        }
      }
    }

    return activePlayingIds;
  }

  public dispose(): void {
    this.group.removeFromParent();
    for (const entry of this.entries) entry.demoRenderer.dispose();
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    for (const tex of this.textures) tex.dispose();
    this.entries.length = 0;
  }
}
