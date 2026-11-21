import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PortfolioProject } from '../data/projectsData';
import { CarAudioEngine } from './CarAudioEngine';
import { CarController, type CarTelemetryState } from './CarController';
import { MinecraftWorld } from './MinecraftWorld';
import { ProjectMonuments3D } from './ProjectMonuments3D';
import { SmokeParticles } from './SmokeParticles';

export type CameraMode = 'chase' | 'firstperson' | 'orbit';

export interface SceneCallbacks {
  onTelemetry: (t: CarTelemetryState) => void;
  onSelectProject: (project: PortfolioProject) => void;
  onProximityChange: (project: PortfolioProject | null, dist: number) => void;
}

/**
 * Orchestrates the daytime Minecraft 3D portfolio world, automotive daylight PMREM
 * reflections, tight car-following shadow rig, cinematic 44-deg chase/3-4 & orbit
 * cameras, Gol G5 physics/audio/smoke, and raycasted 3D project display screens.
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
  private readonly minecraft: MinecraftWorld;

  private readonly audio: CarAudioEngine;
  private readonly smoke: SmokeParticles;
  private readonly monuments: ProjectMonuments3D;
  private readonly car: CarController;

  private cameraMode: CameraMode = 'chase';
  private chaseYawOffset = 0;
  private chasePitchOffset = 0.0;
  private threeQuarterBlend = 0;
  private threeQuarterSide = 1;
  private isDraggingCamera = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastDragX = 0;
  private lastDragY = 0;

  private readonly cameraPosSmooth = new THREE.Vector3(0, 2.15, 5.75);
  private readonly cameraLookSmooth = new THREE.Vector3(0, 1.35, -4.2);
  private readonly prevCarPos = new THREE.Vector3();
  private readonly tmpCamTargetPos = new THREE.Vector3();
  private readonly tmpCamTargetLook = new THREE.Vector3();
  private readonly fpLocalEye = new THREE.Vector3(-0.39, 1.21, 0.04);
  private readonly fpLocalBaseLookOffset = new THREE.Vector3(0, -0.06, -10.04);
  private readonly fpLookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly fpWorldEye = new THREE.Vector3();
  private readonly fpWorldLook = new THREE.Vector3();

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

    this.camera = new THREE.PerspectiveCamera(44, width / height, 0.05, 480);
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
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // Automotive daylight studio + sky PMREM dome for crisp black-paint reflections
    this.envRenderTarget = this.buildAutomotiveDaylightEnvironment(this.renderer);
    this.scene.environment = this.envRenderTarget.texture;

    // OrbitControls for 'orbit' camera mode
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.075;
    this.orbitControls.maxPolarAngle = Math.PI * 0.485;
    this.orbitControls.minDistance = 3.4;
    this.orbitControls.maxDistance = 45;
    this.orbitControls.target.set(0, 0.9, 0);
    this.orbitControls.enabled = false;

    // Calibrated daylight + grass bounce lighting rig
    const hemiLight = new THREE.HemisphereLight(0xd4e8ff, 0x4b6e35, 0.95);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff8ea, 2.05);
    this.sunLight.position.set(16, 26, 14);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 68;
    this.sunLight.shadow.camera.left = -14;
    this.sunLight.shadow.camera.right = 14;
    this.sunLight.shadow.camera.top = 14;
    this.sunLight.shadow.camera.bottom = -14;
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight, this.sunLight.target);

    const rimLight = new THREE.DirectionalLight(0xeef5ff, 0.55);
    rimLight.position.set(-22, 14, -20);
    this.scene.add(rimLight);

    // Daytime Minecraft world (pixel-art grass, stone avenue, paths, sky, clouds, perimeter forest)
    this.minecraft = new MinecraftWorld(this.scene, this.projects);

    // Atmospheric horizon fog & sky-blue background synced for distant mountains & clouds
    this.scene.fog = new THREE.Fog(0xb7d4fa, 42, 168);
    this.scene.background = new THREE.Color(0x9bc4f7);

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

  /**
   * Generates a 1024x512 equirectangular daylight automotive studio PMREM dome:
   * - Sky-blue zenith gradient (#a9ccff -> #dff0ff)
   * - 3 soft overhead/side automotive softbox cloud strips for clearcoat crease reflections
   * - Soft grass-green bounce (#4a6b35) in the lower hemisphere
   */
  private buildAutomotiveDaylightEnvironment(
    renderer: THREE.WebGLRenderer,
  ): THREE.WebGLRenderTarget {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Base sky + grass bounce gradient
      const baseGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      baseGrad.addColorStop(0.0, '#a9ccff');
      baseGrad.addColorStop(0.28, '#c7e1ff');
      baseGrad.addColorStop(0.47, '#dff0ff');
      baseGrad.addColorStop(0.51, '#9fc4a2');
      baseGrad.addColorStop(0.58, '#5f8446');
      baseGrad.addColorStop(0.75, '#4a6b35');
      baseGrad.addColorStop(1.0, '#314823');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 3 soft automotive softbox / cloud strips (1 overhead + 2 side studio bands)
      const drawSoftStrip = (
        cx: number,
        cy: number,
        rx: number,
        ry: number,
        alpha: number,
      ) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        const grad = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
        grad.addColorStop(0.0, `rgba(255, 255, 255, ${alpha})`);
        grad.addColorStop(0.45, `rgba(246, 251, 255, ${alpha * 0.65})`);
        grad.addColorStop(1.0, 'rgba(223, 240, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      // Overhead softbox strip (roof & hood reflection)
      drawSoftStrip(512, 86, 460, 46, 0.92);
      // Left & right upper-horizon softbox cloud bands (door & fender crease reflections)
      drawSoftStrip(256, 178, 220, 38, 0.78);
      drawSoftStrip(768, 178, 220, 38, 0.78);
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

    const target = pmrem.fromScene(envScene, 0.035);

    domeGeo.dispose();
    domeMat.dispose();
    domeTex.dispose();
    pmrem.dispose();

    return target;
  }

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (document.body.dataset.modalOpen === 'true') return;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.lastDragX = e.clientX;
    this.lastDragY = e.clientY;

    if (this.cameraMode === 'chase' || this.cameraMode === 'firstperson') {
      this.isDraggingCamera = true;
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const canvas = this.renderer.domElement;

    if (
      this.isDraggingCamera &&
      (this.cameraMode === 'chase' || this.cameraMode === 'firstperson')
    ) {
      const dx = e.clientX - this.lastDragX;
      const dy = e.clientY - this.lastDragY;
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;

      if (this.cameraMode === 'firstperson') {
        this.chaseYawOffset = THREE.MathUtils.clamp(
          this.chaseYawOffset - dx * 0.0055,
          -1.15,
          1.15,
        );
        this.chasePitchOffset = THREE.MathUtils.clamp(
          this.chasePitchOffset - dy * 0.004,
          -0.30,
          0.28,
        );
      } else {
        this.chaseYawOffset -= dx * 0.0055;
        this.chasePitchOffset = THREE.MathUtils.clamp(
          this.chasePitchOffset + dy * 0.004,
          -0.14,
          0.52,
        );
      }
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

  private updateCamera(
    dt: number,
    nearestProject: PortfolioProject | null,
    nearestDist: number,
  ): void {
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
        0.0,
        this.chasePitchOffset,
        recenter,
      );
    }

    if (this.cameraMode === 'firstperson') {
      this.threeQuarterBlend = 0;
      this.car.chassisGroup.updateMatrixWorld(true);

      this.fpWorldEye.copy(this.fpLocalEye);
      this.car.chassisGroup.localToWorld(this.fpWorldEye);

      const yaw = THREE.MathUtils.clamp(this.chaseYawOffset, -1.15, 1.15);
      const pitch = THREE.MathUtils.clamp(this.chasePitchOffset, -0.30, 0.28);
      this.fpLookEuler.set(pitch, yaw, 0, 'YXZ');

      this.fpWorldLook
        .copy(this.fpLocalBaseLookOffset)
        .applyEuler(this.fpLookEuler)
        .add(this.fpLocalEye);
      this.car.chassisGroup.localToWorld(this.fpWorldLook);

      this.camera.position.copy(this.fpWorldEye);
      this.camera.lookAt(this.fpWorldLook);
      this.cameraPosSmooth.copy(this.fpWorldEye);
      this.cameraLookSmooth.copy(this.fpWorldLook);

      if (Math.abs(this.camera.fov - 64) > 0.05) {
        this.camera.fov = 64;
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    const carYaw = this.car.carGroup.rotation.y;
    const lateralSpeed = this.car.getLateralSpeed();
    const speedKmh = Math.abs(forwardSpeed) * 3.6;

    // Subtle drift swing gives clear view of side-slipping rear end
    const driftCamLead = THREE.MathUtils.clamp(-lateralSpeed * 0.024, -0.2, 0.2);
    const camYaw = carYaw + this.chaseYawOffset + driftCamLead;

    // Smoothly transition into a subtle 3/4 cinematic showroom angle near a bay
    const parkedNearScreen =
      !this.isDraggingCamera &&
      nearestProject !== null &&
      nearestDist < 12.5 &&
      speedKmh < 8;

    const blendAlpha = 1 - Math.exp(-3.8 * dt);
    this.threeQuarterBlend = THREE.MathUtils.lerp(
      this.threeQuarterBlend,
      parkedNearScreen ? 1 : 0,
      blendAlpha,
    );

    if (parkedNearScreen && nearestProject) {
      const toScreenX = nearestProject.worldPos.x - carPos.x;
      const toScreenZ = nearestProject.worldPos.z - carPos.z;
      const carRightX = Math.cos(carYaw);
      const carRightZ = -Math.sin(carYaw);
      const sideDot = toScreenX * carRightX + toScreenZ * carRightZ;
      // Offset opposite the screen's side so Gol G5 and 3D display sit cleanly side-by-side
      const desiredSide = Math.abs(sideDot) > 0.25 ? (sideDot >= 0 ? -1 : 1) : 1;
      this.threeQuarterSide = desiredSide;
    }

    const lateralOffset = 1.35 * this.threeQuarterBlend * this.threeQuarterSide;

    const chaseDist = 5.75 + Math.min(1.2, Math.abs(forwardSpeed) * 0.028);
    const horizDist = chaseDist * Math.cos(this.chasePitchOffset);
    const chaseHeight = 2.15 + chaseDist * Math.sin(this.chasePitchOffset);

    // Behind car (+Z relative to camYaw) + subtle 3/4 lateral offset
    this.tmpCamTargetPos.set(
      carPos.x + Math.sin(camYaw) * horizDist + Math.cos(camYaw) * lateralOffset,
      Math.max(0.95, chaseHeight),
      carPos.z + Math.cos(camYaw) * horizDist - Math.sin(camYaw) * lateralOffset,
    );

    // Look ahead (4.2 m) along heading, gently rising & opening toward screen when parked
    const lookY = THREE.MathUtils.lerp(1.35, 1.78, this.threeQuarterBlend);
    this.tmpCamTargetLook.set(
      carPos.x - Math.sin(carYaw) * 4.2,
      lookY,
      carPos.z - Math.cos(carYaw) * 4.2,
    );

    if (this.threeQuarterBlend > 0.01 && nearestProject) {
      const screenBias = 0.18 * this.threeQuarterBlend;
      this.tmpCamTargetLook.x = THREE.MathUtils.lerp(
        this.tmpCamTargetLook.x,
        nearestProject.worldPos.x,
        screenBias,
      );
      this.tmpCamTargetLook.z = THREE.MathUtils.lerp(
        this.tmpCamTargetLook.z,
        nearestProject.worldPos.z,
        screenBias,
      );
    }

    const posAlpha = 1 - Math.exp(-7.5 * dt);
    const lookAlpha = 1 - Math.exp(-10.5 * dt);
    this.cameraPosSmooth.lerp(this.tmpCamTargetPos, posAlpha);
    this.cameraLookSmooth.lerp(this.tmpCamTargetLook, lookAlpha);

    this.camera.position.copy(this.cameraPosSmooth);
    this.camera.lookAt(this.cameraLookSmooth);

    // Cinematic 44-deg FOV with subtle speed expansion
    const targetFov = 44 + Math.min(6.0, Math.abs(forwardSpeed) * 0.14);
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

    // 4. Update Minecraft voxel clouds & sky dome centered on car
    this.minecraft.update(dt, carPos);

    // 5. Keep tight +-14m shadow frustum centered on the Gol G5
    this.sunLight.position.set(carPos.x + 16, 26, carPos.z + 14);
    this.sunLight.target.position.set(carPos.x, 0, carPos.z);
    this.sunLight.target.updateMatrixWorld();

    // 6. Update 3rd-person chase / 3-4 showroom or free orbit camera
    this.updateCamera(dt, nearestProject, nearestDist);

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

  public setCameraMode(mode: CameraMode): void {
    if (this.cameraMode === mode) return;
    const prevMode = this.cameraMode;
    this.cameraMode = mode;
    this.isDraggingCamera = false;
    this.car.setFirstPersonView(mode === 'firstperson');

    const carPos = this.car.carGroup.position;
    const carYaw = this.car.carGroup.rotation.y;

    if (mode === 'orbit') {
      this.orbitControls.enabled = true;
      this.orbitControls.target.set(carPos.x, 0.95, carPos.z);
      if (prevMode === 'firstperson') {
        this.camera.position.set(
          carPos.x + Math.sin(carYaw) * 5.75,
          2.15,
          carPos.z + Math.cos(carYaw) * 5.75,
        );
      }
      this.camera.fov = 44;
      this.camera.updateProjectionMatrix();
      this.orbitControls.update();
    } else if (mode === 'firstperson') {
      this.orbitControls.enabled = false;
      this.chaseYawOffset = 0;
      this.chasePitchOffset = 0.0;
      this.threeQuarterBlend = 0;
      this.camera.fov = 64;
      this.camera.updateProjectionMatrix();
      this.updateCamera(0.016, null, Infinity);
    } else {
      this.orbitControls.enabled = false;
      this.cameraPosSmooth.copy(this.camera.position);
      this.cameraLookSmooth.set(carPos.x, 1.35, carPos.z);
      this.chaseYawOffset = 0;
      this.chasePitchOffset = 0.0;
      this.threeQuarterBlend = 0;
      this.camera.fov = 44;
      this.camera.updateProjectionMatrix();
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
    this.chasePitchOffset = 0.0;
    this.threeQuarterBlend = 0;
    this.cameraPosSmooth.set(0, 2.15, 5.75);
    this.cameraLookSmooth.set(0, 1.35, -4.2);
    if (this.cameraMode === 'orbit') {
      this.orbitControls.target.set(0, 0.95, 0);
      this.camera.position.set(0, 2.15, 5.75);
      this.orbitControls.update();
    } else if (this.cameraMode === 'firstperson') {
      this.updateCamera(0.016, null, Infinity);
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
    this.minecraft.dispose();

    this.envRenderTarget.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
