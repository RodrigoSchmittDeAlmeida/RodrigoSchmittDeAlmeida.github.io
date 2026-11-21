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
  screenMaterial: THREE.MeshBasicMaterial;
  descMaterial: THREE.MeshBasicMaterial;
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

const FALLBACK_STATION_COLORS: Record<string, string> = {
  leitorECU: '#dc4c4c',
  vstable: '#2ea86f',
  chatbot: '#279b9e',
  vincula: '#4d79e8',
  ordovitae: '#c4528d',
  t2ia: '#c4a435',
  smarttalent: '#4a93d4',
};

function getStationColor(project: PortfolioProject): string {
  const maybeColor = (project as PortfolioProject & { color?: string }).color;
  return maybeColor || FALLBACK_STATION_COLORS[project.id] || '#4a93d4';
}

const TARGET_FPS = 15;
const FRAME_INTERVAL = 1 / TARGET_FPS;
const MAX_PLAY_DISTANCE = 44;
const MIN_CAMERA_DOT = 0.35;
const MIN_FRONT_FACE_DOT = -0.15;

/**
 * Renders 3D editorial portfolio stations inside the Minecraft-style world:
 * - Floating crisp typographic title sign above (y ~ 5.15 m) with project accent dot
 * - Side-by-side layout: live video-demo canvas on the left (5.40 x 3.38 m)
 *   and static high-res (1024x1120) editorial description on the right (3.10 x 3.38 m)
 * - Unlit toneMapped:false MeshBasicMaterial screens + mipmaps + anisotropy up to 16
 * - Minecraft pixel-art Deepslate Bricks frames & Polished Stone pedestals
 * - Discrete parking bay corner brackets in project.color (opacity 0.55)
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

    const deepslateTex = this.createMinecraftDeepslateBricksTexture();
    const polishedStoneTex = this.createMinecraftPolishedStoneTexture();
    this.textures.push(deepslateTex, polishedStoneTex);

    const deepslateMat = new THREE.MeshStandardMaterial({
      map: deepslateTex,
      roughness: 0.9,
      metalness: 0.04,
      envMapIntensity: 0.2,
    });
    const polishedStoneMat = new THREE.MeshStandardMaterial({
      map: polishedStoneTex,
      roughness: 0.86,
      metalness: 0.04,
      envMapIntensity: 0.18,
    });
    this.materials.push(deepslateMat, polishedStoneMat);

    // Shared structural geometries with world-scale Minecraft UVs
    const plinthGeo = this.scaleBoxUVs(new THREE.BoxGeometry(6.8, 0.24, 1.1), 6.8, 0.24, 1.1, 0.85);
    const strutGeo = this.scaleBoxUVs(new THREE.BoxGeometry(0.24, 3.35, 0.28), 0.24, 3.35, 0.28, 0.85);
    const spineGeo = this.scaleBoxUVs(new THREE.BoxGeometry(8.1, 0.2, 0.22), 8.1, 0.2, 0.22, 0.85);

    const videoBackGeo = this.scaleBoxUVs(new THREE.BoxGeometry(5.54, 3.52, 0.14), 5.54, 3.52, 0.14, 0.85);
    const videoFaceGeo = new THREE.PlaneGeometry(5.4, 3.38);

    const descBackGeo = this.scaleBoxUVs(new THREE.BoxGeometry(3.24, 3.52, 0.14), 3.24, 3.52, 0.14, 0.85);
    const descFaceGeo = new THREE.PlaneGeometry(3.1, 3.38);

    const titleBackGeo = this.scaleBoxUVs(new THREE.BoxGeometry(5.48, 0.96, 0.08), 5.48, 0.96, 0.08, 0.85);
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

    const clampedAniso = Math.min(16, Math.max(1, maxAnisotropy));

    projects.forEach((project, idx) => {
      const accentColor = getStationColor(project);
      const root = new THREE.Group();
      root.name = `Monument_${project.id}`;
      root.position.set(project.worldPos.x, 0, project.worldPos.z);
      root.rotation.y = project.worldPos.angleY;

      // Polished Stone plinth & Deepslate Bricks twin rear structural struts at z = -0.52
      const plinth = new THREE.Mesh(plinthGeo, polishedStoneMat);
      plinth.position.set(0.1, 0.12, -0.52);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      root.add(plinth);

      for (const sx of [-2.25, 2.25]) {
        const strut = new THREE.Mesh(strutGeo, deepslateMat);
        strut.position.set(sx, 1.82, -0.52);
        strut.castShadow = false;
        strut.receiveShadow = false;
        root.add(strut);
      }

      for (const sy of [1.85, 3.45]) {
        const spine = new THREE.Mesh(spineGeo, deepslateMat);
        spine.position.set(0.25, sy, -0.32);
        spine.castShadow = false;
        root.add(spine);
      }

      // Display Assembly (centered vertically at y = 2.65 m, subtle downward tilt)
      const displayGroup = new THREE.Group();
      displayGroup.position.set(0, 2.65, 0);
      displayGroup.rotation.x = 0.035;
      root.add(displayGroup);

      // Left Panel: Live Video-Demo Canvas (5.40 x 3.38 m at x = -1.68)
      const videoBack = new THREE.Mesh(videoBackGeo, deepslateMat);
      videoBack.position.set(-1.68, 0, -0.09);
      videoBack.castShadow = false;
      videoBack.receiveShadow = false;
      videoBack.userData.projectId = project.id;
      displayGroup.add(videoBack);

      const demoRenderer = new ScreenDemoRenderer(project);
      demoRenderer.render(0, false);

      const screenTexture = new THREE.CanvasTexture(demoRenderer.getCanvas());
      screenTexture.colorSpace = THREE.SRGBColorSpace;
      screenTexture.anisotropy = Math.min(4, clampedAniso);
      // Avoid expensive per-frame GPU mipmap chain generation on dynamic canvas uploads
      screenTexture.generateMipmaps = false;
      screenTexture.minFilter = THREE.LinearFilter;
      screenTexture.magFilter = THREE.LinearFilter;
      screenTexture.needsUpdate = true;
      this.textures.push(screenTexture);

      const screenMaterial = new THREE.MeshBasicMaterial({
        map: screenTexture,
        toneMapped: false,
      });
      this.materials.push(screenMaterial);

      const videoFace = new THREE.Mesh(videoFaceGeo, screenMaterial);
      videoFace.position.set(-1.68, 0, 0.0);
      videoFace.userData.projectId = project.id;
      displayGroup.add(videoFace);

      // Right Panel: High-Res Editorial Description (3.10 x 3.38 m at x = +2.78)
      const descBack = new THREE.Mesh(descBackGeo, deepslateMat);
      descBack.position.set(2.78, 0, -0.09);
      descBack.castShadow = false;
      descBack.receiveShadow = false;
      descBack.userData.projectId = project.id;
      displayGroup.add(descBack);

      const descTexture = this.createEditorialDescriptionTexture(project, clampedAniso);
      this.textures.push(descTexture);

      const descMaterial = new THREE.MeshBasicMaterial({
        map: descTexture,
        toneMapped: false,
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

      const titleBack = new THREE.Mesh(titleBackGeo, deepslateMat);
      titleBack.position.set(0, 0, -0.045);
      titleBack.castShadow = false;
      titleBack.userData.projectId = project.id;
      titleGroup.add(titleBack);

      const titleTexture = this.createFloatingTitleTexture(project, clampedAniso);
      this.textures.push(titleTexture);

      const titleMat = new THREE.MeshBasicMaterial({
        map: titleTexture,
        toneMapped: false,
      });
      this.materials.push(titleMat);

      const titleFace = new THREE.Mesh(titleFaceGeo, titleMat);
      titleFace.position.set(0, 0, 0.005);
      titleFace.userData.projectId = project.id;
      titleGroup.add(titleFace);
      this.interactiveMeshes.push(titleFace);

      // Discrete Parking Bay Corner Brackets in project.color (opacity 0.55, no neon rings)
      const bayMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(accentColor),
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      this.materials.push(bayMaterial);

      const bayCenterX = 0.4;
      const bayCenterZ = 7.6;
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
        barX.position.set(cx + sx * 0.375, 0.024, cz);
        root.add(barX);

        const barZ = new THREE.Mesh(armZGeo, bayMaterial);
        barZ.position.set(cx, 0.024, cz + sz * 0.375);
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

  private scaleBoxUVs(
    geo: THREE.BoxGeometry,
    w: number,
    h: number,
    d: number,
    tileMeters = 0.85,
  ): THREE.BoxGeometry {
    const uvAttr = geo.attributes.uv;
    if (!uvAttr) return geo;
    // BoxGeometry face order: +x (d,h), -x (d,h), +y (w,d), -y (w,d), +z (w,h), -z (w,h)
    const faceDims: Array<[number, number]> = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    for (let f = 0; f < 6; f++) {
      const [fw, fh] = faceDims[f];
      const su = Math.max(0.25, fw / tileMeters);
      const sv = Math.max(0.25, fh / tileMeters);
      const base = f * 4;
      for (let v = 0; v < 4; v++) {
        uvAttr.setXY(base + v, uvAttr.getX(base + v) * su, uvAttr.getY(base + v) * sv);
      }
    }
    uvAttr.needsUpdate = true;
    return geo;
  }

  private createMinecraftDeepslateBricksTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Base deepslate brick color
      ctx.fillStyle = '#383a42';
      ctx.fillRect(0, 0, 16, 16);

      // Mortar rows (Minecraft staggered brick pattern)
      ctx.fillStyle = '#22242a';
      ctx.fillRect(0, 3, 16, 1);
      ctx.fillRect(0, 7, 16, 1);
      ctx.fillRect(0, 11, 16, 1);
      ctx.fillRect(0, 15, 16, 1);

      // Vertical mortar joints (staggered)
      ctx.fillRect(7, 0, 1, 3);
      ctx.fillRect(15, 0, 1, 3);
      ctx.fillRect(3, 4, 1, 3);
      ctx.fillRect(11, 4, 1, 3);
      ctx.fillRect(7, 8, 1, 3);
      ctx.fillRect(15, 8, 1, 3);
      ctx.fillRect(3, 12, 1, 3);
      ctx.fillRect(11, 12, 1, 3);

      // Subtle brick pixel noise & top highlight
      const highlights: Array<[number, number, string]> = [
        [1, 0, '#464954'],
        [2, 0, '#464954'],
        [9, 0, '#454852'],
        [11, 0, '#454852'],
        [0, 4, '#464954'],
        [5, 4, '#454852'],
        [6, 4, '#454852'],
        [13, 4, '#474a55'],
        [2, 8, '#454852'],
        [10, 8, '#464954'],
        [1, 12, '#454852'],
        [6, 12, '#474a55'],
        [13, 12, '#454852'],
        [4, 2, '#2f3138'],
        [12, 2, '#2e3037'],
        [1, 6, '#303239'],
        [8, 6, '#2e3037'],
        [5, 10, '#2f3138'],
        [12, 10, '#303239'],
        [2, 14, '#2e3037'],
        [9, 14, '#2f3138'],
      ];
      for (const [px, py, col] of highlights) {
        ctx.fillStyle = col;
        ctx.fillRect(px, py, 1, 1);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  private createMinecraftPolishedStoneTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Polished andesite / smooth stone block base
      ctx.fillStyle = '#6c7078';
      ctx.fillRect(0, 0, 16, 16);

      // Top & left crisp bevel highlight
      ctx.fillStyle = '#838790';
      ctx.fillRect(0, 0, 16, 1);
      ctx.fillRect(0, 0, 1, 16);

      // Bottom & right crisp bevel shadow
      ctx.fillStyle = '#4e5259';
      ctx.fillRect(0, 15, 16, 1);
      ctx.fillRect(15, 0, 1, 16);

      // Inner subtle bevel
      ctx.fillStyle = '#757982';
      ctx.fillRect(1, 1, 14, 1);
      ctx.fillStyle = '#5c6068';
      ctx.fillRect(1, 14, 14, 1);

      // Deterministic pixel speckles for authentic Minecraft stone feel
      const speckles: Array<[number, number, string]> = [
        [3, 4, '#62666e'],
        [6, 3, '#767a83'],
        [10, 5, '#60646c'],
        [12, 4, '#777b84'],
        [4, 8, '#757982'],
        [8, 7, '#60646c'],
        [11, 9, '#767a83'],
        [5, 11, '#61656d'],
        [9, 12, '#747881'],
        [13, 11, '#63676f'],
        [2, 10, '#62666e'],
      ];
      for (const [px, py, col] of speckles) {
        ctx.fillStyle = col;
        ctx.fillRect(px, py, 1, 1);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
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
    const accentColor = getStationColor(project);

    if (ctx) {
      ctx.fillStyle = '#14161b';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#474c58';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);

      // Discreet 8px circular dot in project.color beside category
      ctx.beginPath();
      ctx.arc(44, 50, 8, 0, Math.PI * 2);
      ctx.fillStyle = accentColor;
      ctx.fill();

      // Category metadata (zero orange)
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 22px "IBM Plex Mono", "Consolas", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(this.truncateText(ctx, project.category.toUpperCase(), w - 104), 64, 58);

      // Main crisp white Space Grotesk Title
      ctx.fillStyle = '#f4f5f7';
      ctx.font = '700 54px "Space Grotesk", "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(this.truncateText(ctx, project.title, w - 72), 36, 126);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private createEditorialDescriptionTexture(
    project: PortfolioProject,
    maxAnisotropy: number,
  ): THREE.CanvasTexture {
    const w = 1024;
    const h = 1120;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const accentColor = getStationColor(project);

    if (ctx) {
      // Dark matte editorial background (#111318)
      ctx.fillStyle = '#111318';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#2f3542';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, w - 3, h - 3);

      const pad = 48;
      const contentW = w - pad * 2;

      // Top bar: Category in project.color & Period
      ctx.fillStyle = accentColor;
      ctx.font = '700 21px "IBM Plex Mono", "Consolas", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(this.truncateText(ctx, project.category.toUpperCase(), contentW - 220), pad, 58);

      ctx.fillStyle = '#9ea4b3';
      ctx.font = '500 21px "IBM Plex Mono", "Consolas", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(project.period, w - pad, 58);

      // Subtle divider
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad, 80);
      ctx.lineTo(w - pad, 80);
      ctx.stroke();

      // Subtitle
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 29px "Space Grotesk", "IBM Plex Sans", sans-serif';
      let cursorY = 122;
      cursorY = this.drawWrappedText(ctx, project.subtitle, pad, cursorY, contentW, 36, 2);

      // Section: O QUE FAZ (26px)
      cursorY += 18;
      ctx.fillStyle = accentColor;
      ctx.font = '700 20px "IBM Plex Mono", monospace';
      ctx.fillText('O QUE FAZ', pad, cursorY);

      cursorY += 34;
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '400 26px "IBM Plex Sans", system-ui, sans-serif';
      const whatText = project.whatItDoes || project.summary;
      cursorY = this.drawWrappedText(ctx, whatText, pad, cursorY, contentW, 33, 6);

      // Section: ARQUITETURA (24px)
      cursorY += 18;
      ctx.fillStyle = accentColor;
      ctx.font = '700 20px "IBM Plex Mono", monospace';
      ctx.fillText('ARQUITETURA', pad, cursorY);

      cursorY += 34;
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '400 24px "IBM Plex Sans", system-ui, sans-serif';
      cursorY = this.drawWrappedText(ctx, project.architecture, pad, cursorY, contentW, 31, 5);

      // Metrics (28px highlight)
      const metricsY = Math.max(678, cursorY + 12);
      const metrics = project.metrics.slice(0, 3);
      if (metrics.length > 0) {
        const gap = 16;
        const cellW = (contentW - gap * (metrics.length - 1)) / metrics.length;
        const cellH = 116;
        metrics.forEach((m, idx) => {
          const mx = pad + idx * (cellW + gap);
          this.drawRoundRect(ctx, mx, metricsY, cellW, cellH, 10, '#181b22', '#2e3442');

          ctx.fillStyle = '#9ea6b8';
          ctx.font = '600 16px "IBM Plex Sans", sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(this.truncateText(ctx, m.label.toUpperCase(), cellW - 28), mx + 16, metricsY + 36);

          ctx.fillStyle = '#f8fafc';
          ctx.font = '700 28px "Space Grotesk", "IBM Plex Sans", sans-serif';
          ctx.fillText(this.truncateText(ctx, m.value, cellW - 28), mx + 16, metricsY + 82);
        });
      }

      // Technologies (22px pills)
      const techSectionY = metricsY + 150;
      ctx.fillStyle = '#9ea6b8';
      ctx.font = '700 18px "IBM Plex Mono", monospace';
      ctx.fillText('TECNOLOGIAS', pad, techSectionY);

      let tagX = pad;
      let tagY = techSectionY + 18;
      const rowH = 44;
      ctx.font = '500 22px "IBM Plex Sans", sans-serif';

      for (const rawTech of project.technologies.slice(0, 8)) {
        const techName =
          typeof rawTech === 'string'
            ? rawTech
            : (rawTech as unknown as { name?: string }).name ?? '';
        if (!techName) continue;
        const tw = ctx.measureText(techName).width;
        const pillW = tw + 28;

        if (tagX + pillW > w - pad) {
          tagX = pad;
          tagY += rowH + 12;
          if (tagY > h - 86) break;
        }

        this.drawRoundRect(ctx, tagX, tagY, pillW, rowH, 8, '#1a1e26', '#333a4a');
        ctx.fillStyle = '#f1f5f9';
        ctx.textBaseline = 'middle';
        ctx.fillText(techName, tagX + 14, tagY + rowH / 2 + 0.5);
        ctx.textBaseline = 'alphabetic';
        tagX += pillW + 12;
      }

      // Footer interaction cue
      ctx.fillStyle = '#9ca3af';
      ctx.font = '500 19px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      const hint = project.isChatbot
        ? '[E] ou Clique para abrir chat interativo'
        : '[E] ou Clique para ampliar galeria & repositório';
      ctx.fillText(hint, pad, h - 28);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
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
    const lz = -0.35;
    for (const entry of this.entries) {
      const cx = entry.project.worldPos.x;
      const cz = entry.project.worldPos.z;
      const angle = entry.project.worldPos.angleY;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      // 4 collision circles spanning the full ~9m station width
      for (const lx of [-3.6, -1.2, 1.2, 3.6]) {
        obstacles.push({
          x: cx + lx * cosA + lz * sinA,
          z: cz - lx * sinA + lz * cosA,
          radius: 2.35,
        });
      }
    }
    return obstacles;
  }

  /**
   * Computes approach waypoints for autonomous driving:
   * - entry: (0.4, 0, 14.2) local
   * - park: (0.4, 0, 8.6) local (comfortable viewing margin in front of the 3D display)
   * - lookAt: (0.4, 2.55, 0) local
   */
  public getProjectApproachWaypoints(projectId: string): ProjectApproachWaypoints | null {
    const entry = this.entries.find((e) => e.project.id === projectId);
    if (!entry) return null;

    entry.root.updateMatrixWorld(true);
    const entryPos = new THREE.Vector3(0.4, 0, 14.2).applyMatrix4(entry.root.matrixWorld);
    const parkPos = new THREE.Vector3(0.4, 0, 8.6).applyMatrix4(entry.root.matrixWorld);
    const lookAtPos = new THREE.Vector3(0.4, 2.55, 0).applyMatrix4(entry.root.matrixWorld);

    return {
      entry: entryPos,
      park: parkPos,
      lookAt: lookAtPos,
    };
  }

  /**
   * Updates floating title signs, gaze-gated 15 FPS video playback (capped to
   * the single best-aligned station per frame to prevent multi-canvas GPU upload stalls),
   * and returns the list of project IDs currently playing.
   */
  public update(dt: number, camera: THREE.Camera, carPosition: THREE.Vector3): string[] {
    this.globalTime += dt;
    const activePlayingIds: string[] = [];

    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
    this.cameraForward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

    let bestEntry: MonumentEntry | null = null;
    let bestScore = -Infinity;

    for (const entry of this.entries) {
      // Gentle vertical float on the 3D name sign above (y ~ 5.15 m)
      entry.titleGroup.position.y = 5.15 + Math.sin(this.globalTime * 1.35 + entry.phase) * 0.08;

      // Subtle non-neon bay opacity feedback when car is parked nearby or screen is hovered
      const carDist = Math.hypot(
        carPosition.x - entry.worldPosition.x,
        carPosition.z - entry.worldPosition.z,
      );
      const isNear = carDist < 11.5;
      const targetBayOpacity = entry.isHovered ? 0.78 : isNear ? 0.68 : 0.55;
      entry.bayMaterial.opacity +=
        (targetBayOpacity - entry.bayMaterial.opacity) * Math.min(1, dt * 8);

      // Gaze & Frustum Gating
      const camDist = camera.position.distanceTo(entry.screenWorldCenter);
      if (camDist < MAX_PLAY_DISTANCE && this.frustum.intersectsSphere(entry.screenSphere)) {
        this.tmpDir.subVectors(entry.screenWorldCenter, camera.position).normalize();
        const forwardDot = this.cameraForward.dot(this.tmpDir);
        const frontFaceDot = entry.screenForward.dot(this.tmpDir.negate());

        if (forwardDot > MIN_CAMERA_DOT && frontFaceDot > MIN_FRONT_FACE_DOT) {
          // Prioritize the closest & most centered screen in view
          const score = forwardDot * 32 - camDist;
          if (score > bestScore) {
            bestScore = score;
            bestEntry = entry;
          }
        }
      }
    }

    for (const entry of this.entries) {
      const isLooking = entry === bestEntry;

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
