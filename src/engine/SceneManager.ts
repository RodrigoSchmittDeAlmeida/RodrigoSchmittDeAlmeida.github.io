import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PortfolioProject } from '../data/projectsData';
import { CarAudioEngine } from './CarAudioEngine';
import { CarController, type CarTelemetryState } from './CarController';
import { ProjectMonuments3D } from './ProjectMonuments3D';
import { SmokeParticles } from './SmokeParticles';

export interface SceneCallbacks {
  onTelemetry: (t: CarTelemetryState) => void;
  onSelectProject: (project: PortfolioProject) => void;
  onProximityChange: (project: PortfolioProject | null, dist: number) => void;
}

const BLENDER_BG_HEX = 0x2b2b2e;

/**
 * Orchestrates the Blender-inspired 3D portfolio viewport, infinite snapping grid,
 * studio lighting + PMREM reflections, third-person chase & orbit cameras,
 * Gol G5 physics/audio/smoke, and raycasted 3D project display screens.
 */
export class SceneManager {
  private readonly container: HTMLElement;
  private readonly projects: PortfolioProject[];
  private readonly callbacks: SceneCallbacks;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly envRenderTarget: THREE.WebGLRenderTarget;
  private readonly orbitControls: OrbitControls;

  private readonly sunLight: THREE.DirectionalLight;
  private readonly gridGroup = new THREE.Group();
  private readonly staticDisposables: Array<{ dispose: () => void }> = [];

  private readonly audio: CarAudioEngine;
  private readonly smoke: SmokeParticles;
  private readonly monuments: ProjectMonuments3D;
  private readonly car: CarController;

  private cameraMode: 'chase' | 'orbit' = 'chase';
  private chaseYawOffset = 0;
  private chasePitchOffset = 0.08;
  private isDraggingCamera = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastDragX = 0;
  private lastDragY = 0;

  private readonly cameraPosSmooth = new THREE.Vector3(0, 3.6, 8.8);
  private readonly cameraLookSmooth = new THREE.Vector3(0, 1.3, -3.0);
  private readonly prevCarPos = new THREE.Vector3();
  private readonly tmpCamTargetPos = new THREE.Vector3();
  private readonly tmpCamTargetLook = new THREE.Vector3();

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();

  private rafId: number | null = null;
  private lastTimestamp = 0;
  private disposed = false;

  private lastProximityId: string | null = null;
  private lastProximityDist = Infinity;

  private readonly resizeObserver: ResizeObserver;
  private readonly onPointerDownBound: (e: PointerEvent) => void;
  private readonly onPointerMoveBound: (e: PointerEvent) => void;
  private readonly onPointerUpBound: (e: PointerEvent) => void;
  private readonly onPointerCancelBound: () => void;
  private readonly onWindowResizeBound: () => void;

  constructor(
    container: HTMLElement,
    projects: PortfolioProject[],
    callbacks: SceneCallbacks,
  ) {
    this.container = container;
    this.projects = projects;
    this.callbacks = callbacks;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BLENDER_BG_HEX);
    this.scene.fog = new THREE.Fog(BLENDER_BG_HEX, 62, 225);

    this.camera = new THREE.PerspectiveCamera(56, width / height, 0.15, 420);
    this.camera.position.copy(this.cameraPosSmooth);
    this.camera.lookAt(this.cameraLookSmooth);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // Soft diffuse automotive studio PMREM dome (no hard white studio lightboxes)
    this.envRenderTarget = this.buildSoftStudioEnvironment(this.renderer);
    this.scene.environment = this.envRenderTarget.texture;

    // OrbitControls for 'orbit' camera mode
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.075;
    this.orbitControls.maxPolarAngle = Math.PI * 0.485;
    this.orbitControls.minDistance = 3.6;
    this.orbitControls.maxDistance = 45;
    this.orbitControls.target.set(0, 0.9, 0);
    this.orbitControls.enabled = false;

    // Calibrated studio lighting rig
    const hemiLight = new THREE.HemisphereLight(0xd8dde6, 0x24262c, 0.85);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff6eb, 1.55);
    this.sunLight.position.set(18, 28, 16);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 96;
    this.sunLight.shadow.camera.left = -28;
    this.sunLight.shadow.camera.right = 28;
    this.sunLight.shadow.camera.top = 28;
    this.sunLight.shadow.camera.bottom = -28;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight, this.sunLight.target);

    const rimLight = new THREE.DirectionalLight(0xcdd3dc, 0.45);
    rimLight.position.set(-22, 14, -20);
    this.scene.add(rimLight);

    // Subsystems
    this.audio = new CarAudioEngine();
    this.smoke = new SmokeParticles(this.scene);
    this.monuments = new ProjectMonuments3D(
      this.scene,
      this.projects,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.car = new CarController(
      this.scene,
      this.audio,
      this.smoke,
      this.projects,
      (projectId) => this.monuments.getProjectApproachWaypoints(projectId),
      {
        onOpenNearestProject: (project) => this.callbacks.onSelectProject(project),
        onResetRequested: () => this.resetCar(),
      },
    );

    // Build Blender infinite floor grid, discrete axis lines, and matte route guide
    this.buildInfiniteBlenderGrid();
    this.buildOriginAxesAndRouteGuide();

    // Pointer listeners for chase camera look-around & 3D screen raycasting
    const canvas = this.renderer.domElement;
    this.onPointerDownBound = (e) => this.handlePointerDown(e);
    this.onPointerMoveBound = (e) => this.handlePointerMove(e);
    this.onPointerUpBound = (e) => this.handlePointerUp(e);
    this.onPointerCancelBound = () => {
      this.isDraggingCamera = false;
    };
    this.onWindowResizeBound = () => this.handleResize();

    canvas.addEventListener('pointerdown', this.onPointerDownBound);
    window.addEventListener('pointermove', this.onPointerMoveBound);
    window.addEventListener('pointerup', this.onPointerUpBound);
    window.addEventListener('pointercancel', this.onPointerCancelBound);
    window.addEventListener('resize', this.onWindowResizeBound);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    // Start frame loop
    this.lastTimestamp = performance.now();
    this.tick(this.lastTimestamp);
  }

  private buildSoftStudioEnvironment(
    renderer: THREE.WebGLRenderer,
  ): THREE.WebGLRenderTarget {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();

    // Equirectangular soft automotive studio dome: subtle cool-slate overhead gradient, no harsh white boxes
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0.0, '#5a6272');
      grad.addColorStop(0.24, '#474f5d');
      grad.addColorStop(0.42, '#353b46');
      grad.addColorStop(0.49, '#495160'); // soft studio horizon bounce for body creases
      grad.addColorStop(0.56, '#2a2e37');
      grad.addColorStop(0.78, '#1b1d23');
      grad.addColorStop(1.0, '#121418');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const domeTex = new THREE.CanvasTexture(canvas);
    domeTex.colorSpace = THREE.SRGBColorSpace;

    const domeGeo = new THREE.SphereGeometry(28, 48, 24);
    const domeMat = new THREE.MeshBasicMaterial({
      map: domeTex,
      side: THREE.BackSide,
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    envScene.add(domeMesh);

    const target = pmrem.fromScene(envScene, 0.04);

    domeGeo.dispose();
    domeMat.dispose();
    domeTex.dispose();
    pmrem.dispose();

    return target;
  }

  private buildInfiniteBlenderGrid(): void {
    this.gridGroup.name = 'Blender_Infinite_Grid';

    // Matte floor plane in #2B2B2E receives car shadows & calibrated headlight cones
    const floorGeo = new THREE.PlaneGeometry(600, 600);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: BLENDER_BG_HEX,
      roughness: 0.94,
      metalness: 0.04,
      envMapIntensity: 0.08,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.receiveShadow = true;
    this.gridGroup.add(floorMesh);

    // 1m subtle Blender grid lines (#3B3C40)
    const minorGrid = new THREE.GridHelper(600, 600, 0x3b3c40, 0x3b3c40);
    minorGrid.position.y = 0.002;
    const minorMat = minorGrid.material as THREE.Material;
    minorMat.transparent = true;
    minorMat.opacity = 0.62;
    minorMat.depthWrite = false;
    this.gridGroup.add(minorGrid);

    // 10m major Blender grid lines (#505258)
    const majorGrid = new THREE.GridHelper(600, 60, 0x505258, 0x505258);
    majorGrid.position.y = 0.004;
    const majorMat = majorGrid.material as THREE.Material;
    majorMat.transparent = true;
    majorMat.opacity = 0.9;
    majorMat.depthWrite = false;
    this.gridGroup.add(majorGrid);

    this.staticDisposables.push(
      floorGeo,
      floorMat,
      minorGrid.geometry,
      minorMat,
      majorGrid.geometry,
      majorMat,
    );
    this.scene.add(this.gridGroup);
  }

  private buildOriginAxesAndRouteGuide(): void {
    // Discrete Blender World X Axis (Red #B84B4B)
    const xAxisGeo = new THREE.PlaneGeometry(520, 0.04);
    xAxisGeo.rotateX(-Math.PI / 2);
    const xAxisMat = new THREE.MeshBasicMaterial({
      color: 0xb84b4b,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const xAxis = new THREE.Mesh(xAxisGeo, xAxisMat);
    xAxis.position.set(0, 0.007, 0);
    this.scene.add(xAxis);

    // Discrete Blender Longitudinal Axis along Z (Green #579246)
    const zAxisGeo = new THREE.PlaneGeometry(0.04, 520);
    zAxisGeo.rotateX(-Math.PI / 2);
    const zAxisMat = new THREE.MeshBasicMaterial({
      color: 0x579246,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const zAxis = new THREE.Mesh(zAxisGeo, zAxisMat);
    zAxis.position.set(0, 0.007, 0);
    this.scene.add(zAxis);

    this.staticDisposables.push(xAxisGeo, xAxisMat, zAxisGeo, zAxisMat);

    // Matte neutral grey dashed spline guide (#6E727A, opacity 0.35) connecting spawn -> station bays
    if (this.projects.length > 0) {
      const waypoints: THREE.Vector3[] = [new THREE.Vector3(0, 0.014, 0)];
      const sorted = [...this.projects].sort((a, b) => a.index - b.index);
      for (const proj of sorted) {
        const approach = this.monuments.getProjectApproachWaypoints(proj.id);
        if (approach) {
          waypoints.push(new THREE.Vector3(approach.park.x, 0.014, approach.park.z));
        } else {
          const frontX = Math.sin(proj.worldPos.angleY);
          const frontZ = Math.cos(proj.worldPos.angleY);
          waypoints.push(
            new THREE.Vector3(
              proj.worldPos.x + frontX * 8.2,
              0.014,
              proj.worldPos.z + frontZ * 8.2,
            ),
          );
        }
      }

      const curve = new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.35);
      const sampledPoints = curve.getPoints(180);
      const guideGeo = new THREE.BufferGeometry().setFromPoints(sampledPoints);
      const guideMat = new THREE.LineDashedMaterial({
        color: 0x6e727a,
        dashSize: 1.6,
        gapSize: 1.2,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });

      const guideLine = new THREE.Line(guideGeo, guideMat);
      guideLine.computeLineDistances();
      this.scene.add(guideLine);
      this.staticDisposables.push(guideGeo, guideMat);
    }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (document.body.dataset.modalOpen === 'true') return;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.lastDragX = e.clientX;
    this.lastDragY = e.clientY;

    if (this.cameraMode === 'chase') {
      this.isDraggingCamera = true;
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const canvas = this.renderer.domElement;

    if (this.isDraggingCamera && this.cameraMode === 'chase') {
      const dx = e.clientX - this.lastDragX;
      const dy = e.clientY - this.lastDragY;
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;

      this.chaseYawOffset -= dx * 0.0055;
      this.chasePitchOffset = THREE.MathUtils.clamp(
        this.chasePitchOffset + dy * 0.004,
        -0.12,
        0.58,
      );
      return;
    }

    if (document.body.dataset.modalOpen === 'true') {
      this.monuments.setHovered(null);
      canvas.style.cursor = '';
      return;
    }

    // Raycast hover highlight on 3D project display screens
    const hitId = this.pickProjectIdAtClientPos(e.clientX, e.clientY);
    this.monuments.setHovered(hitId);
    canvas.style.cursor = hitId ? 'pointer' : '';
  }

  private handlePointerUp(e: PointerEvent): void {
    const wasDragging = this.isDraggingCamera;
    this.isDraggingCamera = false;

    if (e.button !== 0) return;
    if (document.body.dataset.modalOpen === 'true') return;

    // Only treat as click if pointer didn't pan/orbit camera
    const moveDist = Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY);
    if (moveDist > 6 && wasDragging) return;
    if (moveDist > 6) return;

    const hitId = this.pickProjectIdAtClientPos(e.clientX, e.clientY);
    if (hitId) {
      const project = this.projects.find((p) => p.id === hitId);
      if (project) {
        this.callbacks.onSelectProject(project);
      }
    }
  }

  private pickProjectIdAtClientPos(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.monuments.interactiveMeshes, false);

    for (const hit of hits) {
      const id = hit.object.userData?.projectId;
      if (typeof id === 'string') return id;
    }
    return null;
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private updateCamera(dt: number, nearestDist: number): void {
    const carPos = this.car.carGroup.position;

    if (this.cameraMode === 'orbit') {
      // Shift orbit pivot & camera along with car displacement so driving works in orbit mode too
      const deltaX = carPos.x - this.prevCarPos.x;
      const deltaZ = carPos.z - this.prevCarPos.z;
      this.orbitControls.target.x += deltaX;
      this.orbitControls.target.z += deltaZ;
      this.camera.position.x += deltaX;
      this.camera.position.z += deltaZ;
      this.orbitControls.update();
      return;
    }

    // Gently re-center user camera drag offset while driving forward/reverse
    const forwardSpeed = this.car.getForwardSpeed();
    if (!this.isDraggingCamera && Math.abs(forwardSpeed) > 1.8) {
      const recenter = Math.exp(-2.3 * dt);
      this.chaseYawOffset *= recenter;
      this.chasePitchOffset = THREE.MathUtils.lerp(
        0.08,
        this.chasePitchOffset,
        recenter,
      );
    }

    const carYaw = this.car.carGroup.rotation.y;
    const lateralSpeed = this.car.getLateralSpeed();
    // Subtle drift swing gives clear view of side-slipping rear end
    const driftCamLead = THREE.MathUtils.clamp(-lateralSpeed * 0.028, -0.22, 0.22);
    const camYaw = carYaw + this.chaseYawOffset + driftCamLead;

    const chaseDist = 8.4 + Math.min(1.6, Math.abs(forwardSpeed) * 0.035);
    const horizDist = chaseDist * Math.cos(this.chasePitchOffset);
    const chaseHeight = 2.65 + chaseDist * Math.sin(this.chasePitchOffset);

    // Behind car (+Z relative to camYaw)
    this.tmpCamTargetPos.set(
      carPos.x + Math.sin(camYaw) * horizDist,
      Math.max(0.95, chaseHeight),
      carPos.z + Math.cos(camYaw) * horizDist,
    );

    // Slightly elevate gaze when parked/slow in front of a station so video + title plate stay framed
    const parkedInFront = Math.abs(forwardSpeed) < 1.5 && nearestDist < 12.0;
    const lookY = parkedInFront ? 1.85 : 1.35;

    // Look ahead of the car along its heading
    this.tmpCamTargetLook.set(
      carPos.x - Math.sin(carYaw) * 3.4,
      lookY,
      carPos.z - Math.cos(carYaw) * 3.4,
    );

    const posAlpha = 1 - Math.exp(-7.5 * dt);
    const lookAlpha = 1 - Math.exp(-10.5 * dt);
    this.cameraPosSmooth.lerp(this.tmpCamTargetPos, posAlpha);
    this.cameraLookSmooth.lerp(this.tmpCamTargetLook, lookAlpha);

    this.camera.position.copy(this.cameraPosSmooth);
    this.camera.lookAt(this.cameraLookSmooth);

    // Subtle speed FOV expansion
    const targetFov = 55 + Math.min(8.5, Math.abs(forwardSpeed) * 0.19);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
      this.camera.updateProjectionMatrix();
    }
  }

  private tick(timestamp: number): void {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame((t) => this.tick(t));

    const dt = Math.min(0.05, Math.max(0.001, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;

    const carPos = this.car.getPosition();
    this.prevCarPos.copy(carPos);

    // 1. Update 3D monuments with camera frustum + gaze gating (returns active playing project IDs)
    const activePlayingIds = this.monuments.update(dt, this.camera, carPos);

    // 2. Compute nearest project station in XZ
    let nearestProject: PortfolioProject | null = null;
    let nearestDist = Infinity;
    for (const proj of this.projects) {
      const dist = Math.hypot(
        carPos.x - proj.worldPos.x,
        carPos.z - proj.worldPos.z,
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestProject = proj;
      }
    }

    // 3. Update Gol G5 physics, wheels, audio & tire smoke
    const telemetry = this.car.update(
      dt,
      this.monuments.getObstacles(),
      nearestProject,
      nearestDist,
      activePlayingIds,
    );

    // 4. Snap 600m Blender grid every 10m to create an infinite studio floor
    const snapX = Math.round(carPos.x / 10) * 10;
    const snapZ = Math.round(carPos.z / 10) * 10;
    this.gridGroup.position.set(snapX, 0, snapZ);

    // 5. Keep Studio shadow frustum centered on the Gol G5
    this.sunLight.position.set(carPos.x + 18, 28, carPos.z + 16);
    this.sunLight.target.position.set(carPos.x, 0, carPos.z);
    this.sunLight.target.updateMatrixWorld();

    // 6. Update 3rd-person chase or free orbit camera
    this.updateCamera(dt, nearestDist);

    // 7. Emit telemetry & proximity callbacks
    this.callbacks.onTelemetry(telemetry);

    const activeNear = nearestDist < 9.5 ? nearestProject : null;
    const activeId = activeNear ? activeNear.id : null;
    if (activeId !== this.lastProximityId) {
      if (activeNear && this.lastProximityId !== activeId) {
        this.audio.playArrivalChime();
      }
      this.lastProximityId = activeId;
      this.lastProximityDist = nearestDist;
      this.callbacks.onProximityChange(activeNear, nearestDist);
    } else if (activeNear && Math.abs(nearestDist - this.lastProximityDist) >= 0.15) {
      this.lastProximityDist = nearestDist;
      this.callbacks.onProximityChange(activeNear, nearestDist);
    }

    this.renderer.render(this.scene, this.camera);
  }

  public driveToProject(projectId: string): void {
    const project = this.projects.find((p) => p.id === projectId);
    if (!project) return;
    this.car.driveToProject(project);
  }

  public toggleAutonomousTour(): boolean {
    return this.car.toggleAutonomousTour();
  }

  public isTourActive(): boolean {
    return this.car.isTourActive();
  }

  public setCameraMode(mode: 'chase' | 'orbit'): void {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;

    const carPos = this.car.carGroup.position;
    if (mode === 'orbit') {
      this.orbitControls.enabled = true;
      this.orbitControls.target.set(carPos.x, 0.95, carPos.z);
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      this.orbitControls.update();
    } else {
      this.orbitControls.enabled = false;
      this.cameraPosSmooth.copy(this.camera.position);
      this.cameraLookSmooth.set(carPos.x, 1.35, carPos.z);
      this.chaseYawOffset = 0;
      this.chasePitchOffset = 0.08;
    }
  }

  public toggleAudio(): boolean {
    return this.audio.toggleAudio();
  }

  public isAudioEnabled(): boolean {
    return this.audio.isAudioEnabled();
  }

  public toggleHeadlights(): boolean {
    return this.car.toggleHeadlights();
  }

  public resetCar(): void {
    this.car.reset();
    this.chaseYawOffset = 0;
    this.chasePitchOffset = 0.08;
    this.cameraPosSmooth.set(0, 3.6, 8.8);
    this.cameraLookSmooth.set(0, 1.3, -3.0);
    if (this.cameraMode === 'orbit') {
      this.orbitControls.target.set(0, 0.95, 0);
      this.camera.position.set(0, 3.6, 8.8);
      this.orbitControls.update();
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('pointermove', this.onPointerMoveBound);
    window.removeEventListener('pointerup', this.onPointerUpBound);
    window.removeEventListener('pointercancel', this.onPointerCancelBound);
    window.removeEventListener('resize', this.onWindowResizeBound);

    this.orbitControls.dispose();
    this.car.dispose();
    this.monuments.dispose();
    this.smoke.dispose();
    this.audio.dispose();

    for (const item of this.staticDisposables) {
      item.dispose();
    }
    this.envRenderTarget.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
