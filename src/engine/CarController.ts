/// <reference types="vite/client" />
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PortfolioProject } from '../data/projectsData';
import type { CarAudioEngine } from './CarAudioEngine';
import type { SmokeParticles } from './SmokeParticles';

export interface CarTelemetryState {
  speedKmh: number;
  rpm: number;
  gear: string;
  isDrifting: boolean;
  isBraking: boolean;
  isTurbo: boolean;
  headlightsOn: boolean;
  autopilotMode: 'manual' | 'goto' | 'tour';
  autopilotTargetId: string | null;
  posX: number;
  posZ: number;
  headingDeg: number;
  nearestProjectId: string | null;
  nearestProjectDist: number;
  activePlayingIds: string[];
  modelLoaded: boolean;
}

export interface ApproachWaypoints {
  entry: THREE.Vector3;
  park: THREE.Vector3;
  lookAt: THREE.Vector3;
}

export interface MonumentObstacle {
  x: number;
  z: number;
  radius: number;
}

type AutopilotStage = 'entry' | 'park' | 'braking' | 'dwell';

interface AutopilotState {
  mode: 'goto' | 'tour';
  project: PortfolioProject;
  waypoints: THREE.Vector3[];
  waypointIndex: number;
  entry: THREE.Vector3;
  park: THREE.Vector3;
  lookAt: THREE.Vector3;
  stage: AutopilotStage;
  dwellRemaining: number;
  stuckTimer: number;
  reverseTimer: number;
  reverseCooldown: number;
}

const WHEEL_RADIUS = 0.3516;
const WHEELBASE = 2.76; // 1.3431m front + 1.4167m rear
const ARENA_BOUNDARY_RADIUS = 235;

// Exact wheel center coordinates in Three.js vehicle space (-Z forward, +X right)
const WHEEL_POSITIONS = {
  Wheel_FL: new THREE.Vector3(-0.8059, 0.3516, -1.3431),
  Wheel_FR: new THREE.Vector3(0.8165, 0.3516, -1.3431),
  Wheel_RL: new THREE.Vector3(-0.8059, 0.3516, 1.4167),
  Wheel_RR: new THREE.Vector3(0.8165, 0.3516, 1.4167),
} as const;

export interface CarControllerCallbacks {
  onOpenNearestProject: (project: PortfolioProject) => void;
  onHeadlightsChange?: (on: boolean) => void;
  onResetRequested?: () => void;
}

/**
 * Third-person Volkswagen Gol G5 vehicle controller with GLB async loading,
 * temporary geometric fallback, soft contact shadow, 5-speed gearbox + RPM simulation,
 * handbrake drift, 2-stage Pure Pursuit autopilot + autonomous tour, headlights,
 * and input pause when modals/inputs are active.
 */
export class CarController {
  public readonly carGroup = new THREE.Group();
  public readonly chassisGroup = new THREE.Group();

  private fallbackGroup: THREE.Group | null = null;
  private glbModelGroup: THREE.Object3D | null = null;
  private contactShadowMesh: THREE.Mesh | null = null;
  private contactShadowTex: THREE.CanvasTexture | null = null;

  private steerPivotFL = new THREE.Group();
  private steerPivotFR = new THREE.Group();
  private pivotRL = new THREE.Group();
  private pivotRR = new THREE.Group();

  private spinPivotFL = new THREE.Group();
  private spinPivotFR = new THREE.Group();
  private spinPivotRL = new THREE.Group();
  private spinPivotRR = new THREE.Group();

  private wheelFL: THREE.Object3D | null = null;
  private wheelFR: THREE.Object3D | null = null;
  private wheelRL: THREE.Object3D | null = null;
  private wheelRR: THREE.Object3D | null = null;
  private steeringSpinPivot: THREE.Group | null = null;

  private headlightMats: THREE.MeshStandardMaterial[] = [];
  private brakelightMats: THREE.MeshStandardMaterial[] = [];
  private reversingLightMats: THREE.MeshStandardMaterial[] = [];
  private glassMats: THREE.MeshStandardMaterial[] = [];
  private firstPersonView = false;

  private readonly spotLeft: THREE.SpotLight;
  private readonly spotRight: THREE.SpotLight;

  private readonly keysPressed = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly forwardVec = new THREE.Vector3(0, 0, -1);
  private readonly rightVec = new THREE.Vector3(1, 0, 0);

  private heading = 0; // 0 rad = facing -Z
  private steerAngle = 0;
  private rpm = 850;
  private gear = 'N';
  private headlightsOn = false;
  private modelLoaded = false;
  private disposed = false;

  private forwardSpeed = 0;
  private lateralSpeed = 0;
  private bodyPitch = 0;
  private bodyRoll = 0;
  private lastThrottle = 0;

  private autopilot: AutopilotState | null = null;
  private tourActive = false;
  private tourIndex = 0;
  private lastObstacles: MonumentObstacle[] = [];
  private readonly sortedProjects: PortfolioProject[];
  private readonly resolveWaypoints: (projectId: string) => ApproachWaypoints | null;

  private nearestProject: PortfolioProject | null = null;
  private nearestProjectDist = Infinity;

  private readonly audio: CarAudioEngine;
  private readonly smoke: SmokeParticles;
  private readonly callbacks: CarControllerCallbacks;

  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly onKeyUpBound: (e: KeyboardEvent) => void;
  private readonly onBlurBound: () => void;

  constructor(
    scene: THREE.Scene,
    audio: CarAudioEngine,
    smoke: SmokeParticles,
    projects: PortfolioProject[],
    resolveWaypoints: (projectId: string) => ApproachWaypoints | null,
    callbacks: CarControllerCallbacks,
  ) {
    this.audio = audio;
    this.smoke = smoke;
    this.sortedProjects = [...projects].sort((a, b) => a.index - b.index);
    this.resolveWaypoints = resolveWaypoints;
    this.callbacks = callbacks;

    this.carGroup.name = 'GolG5_Root';
    this.chassisGroup.name = 'GolG5_Chassis';
    this.carGroup.add(this.chassisGroup);

    // Soft radial contact shadow under the Gol G5 chassis to anchor it onto the studio grid
    this.buildContactShadow();

    // Mount persistent axle anchors on carGroup so tires stay planted on Y = 0
    this.steerPivotFL.position.copy(WHEEL_POSITIONS.Wheel_FL);
    this.steerPivotFR.position.copy(WHEEL_POSITIONS.Wheel_FR);
    this.pivotRL.position.copy(WHEEL_POSITIONS.Wheel_RL);
    this.pivotRR.position.copy(WHEEL_POSITIONS.Wheel_RR);

    this.steerPivotFL.add(this.spinPivotFL);
    this.steerPivotFR.add(this.spinPivotFR);
    this.pivotRL.add(this.spinPivotRL);
    this.pivotRR.add(this.spinPivotRR);

    this.carGroup.add(this.steerPivotFL, this.steerPivotFR, this.pivotRL, this.pivotRR);

    // Calibrated front SpotLights: illuminate floor cleanly up to 22m without blowing out screens or asphalt
    this.spotLeft = new THREE.SpotLight(0xedf4ff, 0, 22, Math.PI * 0.23, 0.85, 0.9);
    this.spotLeft.position.set(-0.62, 0.66, -1.96);
    this.spotLeft.target.position.set(-0.85, 0.0, -14);
    this.chassisGroup.add(this.spotLeft, this.spotLeft.target);

    this.spotRight = new THREE.SpotLight(0xedf4ff, 0, 22, Math.PI * 0.23, 0.85, 0.9);
    this.spotRight.position.set(0.62, 0.66, -1.96);
    this.spotRight.target.position.set(0.85, 0.0, -14);
    this.chassisGroup.add(this.spotRight, this.spotRight.target);

    scene.add(this.carGroup);

    // Render subtle temporary Gol G5 silhouette until GLB finishes streaming
    this.buildFallbackSilhouette();
    this.applyHeadlightState();

    // Load real Blender-exported Gol G5 GLB
    this.loadGolG5Model();

    this.onKeyDownBound = (e) => this.handleKeyDown(e);
    this.onKeyUpBound = (e) => this.handleKeyUp(e);
    this.onBlurBound = () => this.keysPressed.clear();

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
  }

  private buildContactShadow(): void {
    const w = 256;
    const h = 512;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(1, h / w);
      const grad = ctx.createRadialGradient(0, 0, 18, 0, 0, w * 0.48);
      grad.addColorStop(0.0, 'rgba(4, 5, 8, 0.62)');
      grad.addColorStop(0.55, 'rgba(4, 5, 8, 0.36)');
      grad.addColorStop(0.82, 'rgba(4, 5, 8, 0.12)');
      grad.addColorStop(1.0, 'rgba(4, 5, 8, 0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.48, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(2.6, 4.8);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'GolG5_ContactShadow';
    mesh.position.set(0, 0.020, 0.02);
    mesh.renderOrder = 2;
    this.carGroup.add(mesh);

    this.contactShadowMesh = mesh;
    this.contactShadowTex = tex;
  }

  private buildFallbackSilhouette(): void {
    const group = new THREE.Group();
    group.name = 'GolG5_Fallback';

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0d0e12,
      metalness: 0.22,
      roughness: 0.28,
      envMapIntensity: 0.85,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.35,
      roughness: 0.08,
      envMapIntensity: 0.95,
    });
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x161619,
      metalness: 0.08,
      roughness: 0.82,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      metalness: 0.85,
      roughness: 0.25,
    });
    const xenonMat = new THREE.MeshStandardMaterial({
      name: 'Mat_Headlight_Xenon',
      color: 0xe2e8f0,
      emissive: new THREE.Color(0xdbeafe),
      emissiveIntensity: 2.2,
    });
    const brakeMat = new THREE.MeshStandardMaterial({
      name: 'Mat_Brakelight_Red',
      color: 0x991b1b,
      emissive: new THREE.Color(0xff1414),
      emissiveIntensity: 0.45,
    });
    const revMat = new THREE.MeshStandardMaterial({
      name: 'Mat_Reversing_Light',
      color: 0xe5e7eb,
      emissive: new THREE.Color(0xf8fafc),
      emissiveIntensity: 0.0,
    });

    this.headlightMats = [xenonMat];
    this.brakelightMats = [brakeMat];
    this.reversingLightMats = [revMat];

    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.62, 4.02), bodyMat);
    lowerBody.position.set(0, 0.56, 0.02);
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    group.add(lowerBody);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.56, 2.08), glassMat);
    cabin.position.set(0, 1.12, 0.24);
    cabin.castShadow = true;
    group.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.08, 1.74), bodyMat);
    roof.position.set(0, 1.42, 0.28);
    roof.castShadow = true;
    group.add(roof);

    // Front Xenon pods (-Z)
    for (const lx of [-0.62, 0.62]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.08), xenonMat);
      lamp.position.set(lx, 0.64, -1.98);
      group.add(lamp);
    }

    // Rear tail lamps (+Z)
    for (const lx of [-0.64, 0.64]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), brakeMat);
      tail.position.set(lx, 0.72, 2.02);
      group.add(tail);

      const rev = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.08), revMat);
      rev.position.set(lx * 0.72, 0.62, 2.025);
      group.add(rev);
    }

    const makeFallbackWheel = (name: string): THREE.Group => {
      const wGroup = new THREE.Group();
      wGroup.name = name;
      const tireGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.23, 22);
      tireGeo.rotateZ(Math.PI / 2);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;

      const rimGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.24, 14);
      rimGeo.rotateZ(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, rimMat);

      wGroup.add(tire, rim);
      return wGroup;
    };

    this.wheelFL = makeFallbackWheel('Wheel_FL');
    this.wheelFR = makeFallbackWheel('Wheel_FR');
    this.wheelRL = makeFallbackWheel('Wheel_RL');
    this.wheelRR = makeFallbackWheel('Wheel_RR');

    this.spinPivotFL.add(this.wheelFL);
    this.spinPivotFR.add(this.wheelFR);
    this.spinPivotRL.add(this.wheelRL);
    this.spinPivotRR.add(this.wheelRR);

    this.fallbackGroup = group;
    this.chassisGroup.add(group);
  }

  private disposeFallbackSilhouette(): void {
    if (!this.fallbackGroup) return;

    const disposeWheelObj = (wheel: THREE.Object3D | null) => {
      if (!wheel) return;
      wheel.removeFromParent();
      wheel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry.dispose();
          this.disposeMaterialOrArray(mesh.material);
        }
      });
    };

    disposeWheelObj(this.wheelFL);
    disposeWheelObj(this.wheelFR);
    disposeWheelObj(this.wheelRL);
    disposeWheelObj(this.wheelRR);

    this.fallbackGroup.removeFromParent();
    this.fallbackGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        this.disposeMaterialOrArray(mesh.material);
      }
    });
    this.fallbackGroup = null;
  }

  private disposeMaterialOrArray(mat: THREE.Material | THREE.Material[]): void {
    if (Array.isArray(mat)) {
      mat.forEach((m) => m.dispose());
    } else {
      mat.dispose();
    }
  }

  private loadGolG5Model(): void {
    const loader = new GLTFLoader();
    const glbUrl = `${import.meta.env.BASE_URL}models/gol_g5.glb`;

    loader.load(
      glbUrl,
      (gltf) => {
        if (this.disposed) {
          this.disposeObject3D(gltf.scene);
          return;
        }

        const root = gltf.scene;
        root.name = 'GolG5_GLB';
        root.updateMatrixWorld(true);

        const headlights = new Set<THREE.MeshStandardMaterial>();
        const brakelights = new Set<THREE.MeshStandardMaterial>();
        const reversingLights = new Set<THREE.MeshStandardMaterial>();
        const glasses = new Set<THREE.MeshStandardMaterial>();

        const registerMaterial = (mat: THREE.Material) => {
          if (!(mat instanceof THREE.MeshStandardMaterial)) return;
          const name = mat.name || '';

          if (name.startsWith('Mat_Headlight_Xenon')) {
            mat.emissive = new THREE.Color(0xdbeafe);
            mat.emissiveIntensity = this.headlightsOn ? 2.2 : 0.12;
            headlights.add(mat);
          } else if (name.startsWith('Mat_Brakelight_Red')) {
            mat.emissive = new THREE.Color(0xff1414);
            mat.emissiveIntensity = 0.45;
            brakelights.add(mat);
          } else if (name.startsWith('Mat_Reversing_Light')) {
            mat.emissive = new THREE.Color(0xf8fafc);
            mat.emissiveIntensity = 0.0;
            reversingLights.add(mat);
          } else if (name.startsWith('Mat_CarPaint_Black')) {
            // Deep black automotive paint calibrated for Minecraft daylight without chrome blowout
            mat.envMapIntensity = 0.85;
            mat.roughness = 0.28;
            mat.metalness = 0.22;
            if (mat instanceof THREE.MeshPhysicalMaterial) {
              mat.clearcoat = 0.65;
              mat.clearcoatRoughness = 0.12;
            }
          } else if (
            name.startsWith('Mat_Chrome_Trim') ||
            name.startsWith('Mat_Alloy_Rim')
          ) {
            // Keep crisp reflections on VW/GOL/1.6 emblems, exhaust tip, and alloy spokes
            mat.envMapIntensity = 1.15;
          } else if (name.startsWith('Mat_Glass_Tint')) {
            // Smoked glass with realistic blue sky reflection
            mat.envMapIntensity = 0.95;
            mat.roughness = 0.08;
            mat.transparent = true;
            glasses.add(mat);
          } else if (
            name.startsWith('Mat_Trim_Black') ||
            name.startsWith('Mat_Tire_Rubber')
          ) {
            mat.envMapIntensity = 0.35;
          } else {
            mat.envMapIntensity = Math.min(mat.envMapIntensity ?? 0.55, 0.65);
          }
        };

        root.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = false;
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(registerMaterial);
            } else if (mesh.material) {
              registerMaterial(mesh.material);
            }
          }
        });

        // Resolve the 4 wheel groups/meshes
        const wFL = root.getObjectByName('Wheel_FL') ?? null;
        const wFR = root.getObjectByName('Wheel_FR') ?? null;
        const wRL = root.getObjectByName('Wheel_RL') ?? null;
        const wRR = root.getObjectByName('Wheel_RR') ?? null;

        // Swap out temporary geometric fallback cleanly
        this.disposeFallbackSilhouette();

        this.headlightMats = Array.from(headlights);
        this.brakelightMats = Array.from(brakelights);
        this.reversingLightMats = Array.from(reversingLights);
        this.glassMats = Array.from(glasses);

        const mountWheel = (
          wheelNode: THREE.Object3D | null,
          steerAnchor: THREE.Group,
          spinPivot: THREE.Group,
          fallbackPos: THREE.Vector3,
        ): THREE.Object3D | null => {
          if (!wheelNode) return null;
          const worldPos = new THREE.Vector3();
          const worldQuat = new THREE.Quaternion();
          wheelNode.getWorldPosition(worldPos);
          wheelNode.getWorldQuaternion(worldQuat);
          root.worldToLocal(worldPos);

          // Use extracted pivot coordinates if valid, else fallback to contract coords
          if (worldPos.lengthSq() > 0.05) {
            steerAnchor.position.copy(worldPos);
          } else {
            steerAnchor.position.copy(fallbackPos);
          }

          wheelNode.removeFromParent();
          wheelNode.position.set(0, 0, 0);
          wheelNode.quaternion.copy(worldQuat);
          spinPivot.rotation.set(0, 0, 0);
          spinPivot.add(wheelNode);
          return wheelNode;
        };

        this.wheelFL = mountWheel(wFL, this.steerPivotFL, this.spinPivotFL, WHEEL_POSITIONS.Wheel_FL);
        this.wheelFR = mountWheel(wFR, this.steerPivotFR, this.spinPivotFR, WHEEL_POSITIONS.Wheel_FR);
        this.wheelRL = mountWheel(wRL, this.pivotRL, this.spinPivotRL, WHEEL_POSITIONS.Wheel_RL);
        this.wheelRR = mountWheel(wRR, this.pivotRR, this.spinPivotRR, WHEEL_POSITIONS.Wheel_RR);

        this.glbModelGroup = root;
        this.chassisGroup.add(root);
        this.carGroup.updateMatrixWorld(true);
        root.updateMatrixWorld(true);

        // Re-center steeringwheel pivot onto its mesh centroid along the ~17.23° column axis
        const swNode = root.getObjectByName('steeringwheel') ?? null;
        if (swNode) {
          const swBox = new THREE.Box3().setFromObject(swNode);
          const swCenter = swBox.getCenter(new THREE.Vector3());
          root.worldToLocal(swCenter);

          const steeringTiltPivot = new THREE.Group();
          steeringTiltPivot.name = 'Steering_Tilt_Pivot';
          steeringTiltPivot.position.copy(swCenter);
          steeringTiltPivot.rotation.x = -0.30;

          const steeringSpinPivot = new THREE.Group();
          steeringSpinPivot.name = 'Steering_Spin_Pivot';
          steeringTiltPivot.add(steeringSpinPivot);
          root.add(steeringTiltPivot);

          root.updateMatrixWorld(true);
          steeringSpinPivot.attach(swNode);
          this.steeringSpinPivot = steeringSpinPivot;
        }

        this.modelLoaded = true;
        this.applyHeadlightState();
        this.setFirstPersonView(this.firstPersonView);
      },
      undefined,
      () => {
        // Keep geometric fallback active if GLB asset cannot be fetched
        this.modelLoaded = false;
      },
    );
  }

  private isInputBlocked(): boolean {
    if (document.body.dataset.modalOpen === 'true') return true;
    const active = document.activeElement;
    if (active) {
      const tag = active.tagName.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
      }
    }
    return false;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isInputBlocked()) {
      this.keysPressed.clear();
      return;
    }

    const code = e.code;

    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    // Manual driving input cancels active autopilot & autonomous tour immediately
    if (
      code === 'KeyW' ||
      code === 'KeyS' ||
      code === 'KeyA' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      this.cancelAutopilot();
    }

    this.keysPressed.add(code);

    if (!e.repeat) {
      if (code === 'KeyH' || code === 'KeyL') {
        this.toggleHeadlights();
      } else if (code === 'KeyR') {
        if (this.callbacks.onResetRequested) {
          this.callbacks.onResetRequested();
        } else {
          this.reset();
        }
      } else if (code === 'KeyB') {
        this.audio.playHorn();
      } else if (code === 'KeyE' || code === 'Enter') {
        if (this.nearestProject && this.nearestProjectDist < 13.0) {
          e.preventDefault();
          this.callbacks.onOpenNearestProject(this.nearestProject);
        }
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysPressed.delete(e.code);
  }

  private cancelAutopilot(): void {
    this.autopilot = null;
    this.tourActive = false;
  }

  public setFirstPersonView(active: boolean): void {
    this.firstPersonView = active;
    for (const mat of this.glassMats) {
      mat.transparent = true;
      mat.opacity = active ? 0.16 : 0.55;
      mat.needsUpdate = true;
    }
  }

  public toggleHeadlights(): boolean {
    this.headlightsOn = !this.headlightsOn;
    this.applyHeadlightState();
    this.callbacks.onHeadlightsChange?.(this.headlightsOn);
    return this.headlightsOn;
  }

  private applyHeadlightState(): void {
    const beamIntensity = this.headlightsOn ? 4.5 : 0;
    this.spotLeft.intensity = beamIntensity;
    this.spotRight.intensity = beamIntensity;
    this.spotLeft.visible = this.headlightsOn;
    this.spotRight.visible = this.headlightsOn;

    for (const mat of this.headlightMats) {
      mat.emissiveIntensity = this.headlightsOn ? 2.2 : 0.12;
    }
  }

  private createFallbackWaypoints(project: PortfolioProject): ApproachWaypoints {
    const frontX = Math.sin(project.worldPos.angleY);
    const frontZ = Math.cos(project.worldPos.angleY);
    return {
      entry: new THREE.Vector3(
        project.worldPos.x + frontX * 13.5,
        0,
        project.worldPos.z + frontZ * 13.5,
      ),
      park: new THREE.Vector3(
        project.worldPos.x + frontX * 7.6,
        0,
        project.worldPos.z + frontZ * 7.6,
      ),
      lookAt: new THREE.Vector3(project.worldPos.x, 0, project.worldPos.z),
    };
  }

  private startAutopilotTo(project: PortfolioProject, mode: 'goto' | 'tour'): void {
    const wp = this.resolveWaypoints(project.id) ?? this.createFallbackWaypoints(project);
    const entry = wp.entry.clone();
    const park = wp.park.clone();
    const lookAt = wp.lookAt.clone();
    entry.y = 0;
    park.y = 0;
    lookAt.y = 0;

    const pos = this.carGroup.position;
    const fwdX = -Math.sin(this.heading);
    const fwdZ = -Math.cos(this.heading);

    const distToPark = Math.hypot(park.x - pos.x, park.z - pos.z);
    const frontX = park.x - lookAt.x;
    const frontZ = park.z - lookAt.z;
    const frontLen = Math.hypot(frontX, frontZ) || 1;
    const carFromMonDotFront =
      ((pos.x - lookAt.x) * frontX + (pos.z - lookAt.z) * frontZ) / frontLen;

    const alreadyInTargetBay = distToPark < 5.5 && carFromMonDotFront > 2.5;

    const waypoints: THREE.Vector3[] = [];
    let initialReverseTimer = 0;

    if (!alreadyInTargetBay) {
      let nearestMon: PortfolioProject | null = null;
      let nearestMonDist = Infinity;
      for (const p of this.sortedProjects) {
        const d = Math.hypot(p.worldPos.x - pos.x, p.worldPos.z - pos.z);
        if (d < nearestMonDist) {
          nearestMonDist = d;
          nearestMon = p;
        }
      }

      let nearestObsDist = nearestMonDist;
      let obsFrontBlocked = false;
      const obsList: MonumentObstacle[] =
        this.lastObstacles.length > 0
          ? this.lastObstacles
          : this.sortedProjects.map((p) => ({
              x: p.worldPos.x,
              z: p.worldPos.z,
              radius: 2.35,
            }));

      for (const obs of obsList) {
        const ox = obs.x - pos.x;
        const oz = obs.z - pos.z;
        const od = Math.hypot(ox, oz);
        if (od < nearestObsDist) {
          nearestObsDist = od;
        }
        if (od > 0.05 && od < 9.5) {
          const frontDot = (fwdX * ox + fwdZ * oz) / od;
          if (frontDot > 0.25) {
            obsFrontBlocked = true;
          }
        }
      }

      const offCentralAvenue = Math.abs(pos.x) > 5.5 || pos.z < -195;
      const nearAnyMonument = Math.min(nearestMonDist, nearestObsDist) < 12.5;

      if (offCentralAvenue && nearAnyMonument) {
        let parkAtualZ = pos.z;
        let monZ = pos.z;
        if (nearestMon) {
          const nearWp =
            this.resolveWaypoints(nearestMon.id) ??
            this.createFallbackWaypoints(nearestMon);
          parkAtualZ = nearWp.park.z;
          monZ = nearestMon.worldPos.z;
        }

        // Route out to central avenue X=0; stay behind monument if already on -Z side, else exit toward +Z
        const rawExitZ =
          pos.z < monZ - 1.5
            ? pos.z - 1.5
            : Math.max(pos.z + 2.5, parkAtualZ);
        const clampedExitZ = THREE.MathUtils.clamp(rawExitZ, -201.5, 22);
        waypoints.push(new THREE.Vector3(0, 0, clampedExitZ));

        if (obsFrontBlocked) {
          initialReverseTimer = 1.0;
        }
      }

      // Cruise down unobstructed central avenue (X=0) to target bay Z alignment
      const cruiseWp = new THREE.Vector3(0, 0, entry.z);
      if (
        waypoints.length === 0 ||
        waypoints[waypoints.length - 1].distanceTo(cruiseWp) > 1.2
      ) {
        waypoints.push(cruiseWp);
      }

      if (cruiseWp.distanceTo(entry) > 1.2) {
        waypoints.push(entry.clone());
      }
    }

    waypoints.push(park.clone());

    const initialStage: AutopilotStage =
      waypoints.length === 1 ? 'park' : 'entry';

    this.autopilot = {
      mode,
      project,
      waypoints,
      waypointIndex: 0,
      entry,
      park,
      lookAt,
      stage: initialStage,
      dwellRemaining: 0,
      stuckTimer: 0,
      reverseTimer: initialReverseTimer,
      reverseCooldown: 0,
    };
  }

  public driveToProject(project: PortfolioProject): void {
    this.tourActive = false;
    this.startAutopilotTo(project, 'goto');
  }

  public toggleAutonomousTour(): boolean {
    if (this.tourActive) {
      this.cancelAutopilot();
      return false;
    }
    if (this.sortedProjects.length === 0) return false;
    this.tourActive = true;
    this.tourIndex = 0;
    this.startAutopilotTo(this.sortedProjects[0], 'tour');
    return true;
  }

  public isTourActive(): boolean {
    return this.tourActive;
  }

  public reset(): void {
    this.cancelAutopilot();
    this.carGroup.position.set(0, 0, 0);
    this.heading = 0;
    this.carGroup.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.steerAngle = 0;
    this.rpm = 850;
    this.gear = 'N';
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.chassisGroup.rotation.set(0, 0, 0);
    this.steerPivotFL.rotation.y = 0;
    this.steerPivotFR.rotation.y = 0;
    if (this.steeringSpinPivot) {
      this.steeringSpinPivot.rotation.z = 0;
    }
    this.smoke.reset();
  }

  public getPosition(): THREE.Vector3 {
    return this.carGroup.position;
  }

  public getSteerAngle(): number {
    return this.steerAngle;
  }

  public getLateralSpeed(): number {
    return this.lateralSpeed;
  }

  public getForwardSpeed(): number {
    return this.forwardSpeed;
  }

  public getVelocity(): THREE.Vector3 {
    return this.velocity;
  }

  public update(
    rawDt: number,
    obstacles: MonumentObstacle[],
    nearestProject: PortfolioProject | null,
    nearestDist: number,
    activePlayingIds: string[] = [],
  ): CarTelemetryState {
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    this.lastObstacles = obstacles;
    this.nearestProject = nearestProject;
    this.nearestProjectDist = nearestDist;

    if (this.isInputBlocked()) {
      this.keysPressed.clear();
    }

    // Car orientation vectors in world XZ (-Z is forward when heading = 0)
    this.forwardVec.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    this.rightVec.set(Math.cos(this.heading), 0, -Math.sin(this.heading));

    this.forwardSpeed = this.velocity.dot(this.forwardVec);
    this.lateralSpeed = this.velocity.dot(this.rightVec);

    const speedAbs = Math.abs(this.forwardSpeed);
    const speedKmhRaw = speedAbs * 3.6;
    const maxSteerAngle = THREE.MathUtils.lerp(0.56, 0.25, Math.min(1, speedKmhRaw / 150));

    let throttleInput = 0;
    let steerInput = 0;
    let handbrake = false;
    let isTurbo = false;

    if (this.autopilot) {
      const auto = this.computeAutopilotControls(dt, obstacles, maxSteerAngle);
      throttleInput = auto.throttle;
      steerInput = auto.steer;
      handbrake = auto.handbrake;
      isTurbo = auto.turbo;
    } else if (!this.isInputBlocked()) {
      const up = this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp');
      const down = this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown');
      const left = this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft');
      const right = this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight');

      if (up) throttleInput += 1;
      if (down) throttleInput -= 1;
      if (left) steerInput += 1; // +Y steer angle = left (-X)
      if (right) steerInput -= 1;

      handbrake = this.keysPressed.has('Space');
      isTurbo =
        this.keysPressed.has('ShiftLeft') || this.keysPressed.has('ShiftRight');
    }

    this.lastThrottle = throttleInput;

    // Speed-sensitive steering lock (nimble at low speed, stable at high speed)
    const targetSteer = steerInput * maxSteerAngle;
    const steerLerpRate = Math.abs(targetSteer) > Math.abs(this.steerAngle) ? 9.5 : 13.0;
    this.steerAngle +=
      (targetSteer - this.steerAngle) * Math.min(1, dt * steerLerpRate);

    // Longitudinal acceleration / braking / reverse
    const maxForwardSpeed = isTurbo ? 51.5 : 40.5; // ~185 km/h turbo, ~146 km/h NA
    const maxReverseSpeed = 14.5; // ~52 km/h
    const turboMul = isTurbo ? 1.48 : 1.0;

    let isBraking = false;
    let longAccel = 0;

    if (throttleInput > 0.05) {
      if (this.forwardSpeed < -0.6) {
        isBraking = true;
        longAccel = 36.0;
      } else if (this.forwardSpeed < maxForwardSpeed) {
        const speedRatio = Math.max(0, this.forwardSpeed) / maxForwardSpeed;
        const powerCurve = 1.0 - 0.55 * Math.pow(speedRatio, 1.4);
        longAccel = throttleInput * 19.5 * turboMul * Math.max(0.2, powerCurve);
      }
    } else if (throttleInput < -0.05) {
      if (this.forwardSpeed > 0.6) {
        isBraking = true;
        longAccel = -38.0;
      } else if (this.forwardSpeed > -maxReverseSpeed) {
        longAccel = throttleInput * 14.5;
      }
    }

    if (handbrake) {
      isBraking = true;
      if (Math.abs(this.forwardSpeed) > 0.2) {
        longAccel -= Math.sign(this.forwardSpeed) * 9.5;
      }
    }

    // Apply longitudinal acceleration along car forward
    this.forwardSpeed += longAccel * dt;

    // Natural rolling resistance + quadratic aero drag
    if (Math.abs(throttleInput) < 0.05 && !handbrake) {
      const rollDrag = 1.9 * dt;
      if (Math.abs(this.forwardSpeed) <= rollDrag) {
        this.forwardSpeed = 0;
      } else {
        this.forwardSpeed -= Math.sign(this.forwardSpeed) * rollDrag;
      }
    }
    this.forwardSpeed *= Math.exp(-0.08 * dt);

    // Bicycle steering kinematics + handbrake drift yaw authority
    const gripFactor = handbrake ? 2.1 : 11.2;
    this.lateralSpeed *= Math.exp(-gripFactor * dt);

    if (speedAbs > 0.18) {
      const kinematicYaw = (this.forwardSpeed / WHEELBASE) * Math.tan(this.steerAngle);
      const driftYawGain = handbrake ? 1.38 : 1.0;
      const yawRate = THREE.MathUtils.clamp(
        kinematicYaw * driftYawGain,
        handbrake ? -3.6 : -2.85,
        handbrake ? 3.6 : 2.85,
      );
      this.heading += yawRate * dt;
    }

    // Recompose world velocity using updated heading
    this.forwardVec.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    this.rightVec.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    this.velocity
      .copy(this.forwardVec)
      .multiplyScalar(this.forwardSpeed)
      .addScaledVector(this.rightVec, this.lateralSpeed);

    // Integrate world position on Y = 0
    this.carGroup.position.addScaledVector(this.velocity, dt);
    this.carGroup.position.y = 0;
    this.carGroup.rotation.y = this.heading;

    // Soft collision slide around monument pedestals
    this.resolveObstacleCollisions(obstacles);

    // Soft arena perimeter containment
    const distFromOrigin = Math.hypot(
      this.carGroup.position.x,
      this.carGroup.position.z,
    );
    if (distFromOrigin > ARENA_BOUNDARY_RADIUS) {
      const scale = ARENA_BOUNDARY_RADIUS / distFromOrigin;
      this.carGroup.position.x *= scale;
      this.carGroup.position.z *= scale;
      this.velocity.multiplyScalar(0.5);
    }

    // Drift detection
    const isDrifting =
      (handbrake && speedAbs > 4.2) ||
      (Math.abs(this.lateralSpeed) > 3.1 && speedAbs > 7.0);

    // Suspension pitch & cornering roll
    const targetPitch = THREE.MathUtils.clamp(longAccel * 0.0014, -0.032, 0.032);
    const targetRoll = THREE.MathUtils.clamp(
      -this.steerAngle * this.forwardSpeed * 0.0042,
      -0.045,
      0.045,
    );
    this.bodyPitch += (targetPitch - this.bodyPitch) * Math.min(1, dt * 8.5);
    this.bodyRoll += (targetRoll - this.bodyRoll) * Math.min(1, dt * 8.5);
    this.chassisGroup.rotation.x = this.bodyPitch;
    this.chassisGroup.rotation.z = this.bodyRoll;

    // Steering pivots & wheel spin (-Z forward requires rotation.x -= forwardSpeed * dt / R)
    this.steerPivotFL.rotation.y = this.steerAngle;
    this.steerPivotFR.rotation.y = this.steerAngle;
    if (this.steeringSpinPivot) {
      // Positive steerAngle (Left / KeyA) rotates steering wheel counter-clockwise (+Z) from driver view
      this.steeringSpinPivot.rotation.z = this.steerAngle * 2.1;
    }

    const burnoutFactor =
      Math.abs(throttleInput) > 0.65 && speedAbs < 10 ? 1.55 : 1.0;
    const wheelSpinDelta = ((this.forwardSpeed * burnoutFactor) * dt) / WHEEL_RADIUS;
    this.spinPivotFL.rotation.x -= wheelSpinDelta;
    this.spinPivotFR.rotation.x -= wheelSpinDelta;
    this.spinPivotRL.rotation.x -= wheelSpinDelta;
    this.spinPivotRR.rotation.x -= wheelSpinDelta;

    // Gearbox & RPM simulation
    const speedKmh = Math.abs(this.forwardSpeed) * 3.6;
    const prevGear = this.gear;
    this.updateGearAndRpm(speedKmh, throttleInput, handbrake, isTurbo, dt);
    if (prevGear !== this.gear) {
      this.audio.notifyGearShift(prevGear, this.gear);
    }

    // Brake & Reversing tail lights
    const inReverse = this.gear === 'R';
    const brakeEmissive = isBraking ? 3.2 : this.headlightsOn ? 1.05 : 0.35;
    for (const mat of this.brakelightMats) {
      mat.emissiveIntensity = brakeEmissive;
    }
    const reverseEmissive = inReverse ? 2.6 : 0.0;
    for (const mat of this.reversingLightMats) {
      mat.emissiveIntensity = reverseEmissive;
    }

    // Volumetric tire smoke particles
    this.smoke.update({
      carGroup: this.carGroup,
      carVelocityWorld: this.velocity,
      speedKmh,
      forwardSpeed: this.forwardSpeed,
      throttle: throttleInput,
      isBraking,
      isDrifting,
      isTurbo,
      dt,
    });

    // Procedural Web Audio engine & tire slip sound
    const slipIntensity = Math.min(
      1,
      Math.abs(this.lateralSpeed) / 9.5 + (isBraking && speedKmh > 18 ? 0.45 : 0),
    );
    this.audio.update({
      rpm: this.rpm,
      speedKmh,
      throttle: this.lastThrottle,
      isBraking,
      isDrifting,
      isTurbo,
      slipIntensity,
      dt,
    });

    // Defensive state guard against non-finite values
    if (
      !Number.isFinite(this.forwardSpeed) ||
      !Number.isFinite(this.lateralSpeed) ||
      !Number.isFinite(this.heading) ||
      !Number.isFinite(this.steerAngle) ||
      !Number.isFinite(this.carGroup.position.x) ||
      !Number.isFinite(this.carGroup.position.z)
    ) {
      this.forwardSpeed = 0;
      this.lateralSpeed = 0;
      this.steerAngle = 0;
      this.velocity.set(0, 0, 0);
      if (!Number.isFinite(this.heading)) this.heading = 0;
      if (!Number.isFinite(this.carGroup.position.x)) this.carGroup.position.x = 0;
      if (!Number.isFinite(this.carGroup.position.z)) this.carGroup.position.z = 0;
      this.carGroup.rotation.y = this.heading;
    }
    if (!Number.isFinite(this.rpm)) {
      this.rpm = 850;
    }

    const headingDeg =
      (((-this.heading * 180) / Math.PI) % 360 + 360) % 360;

    const autopilotMode: 'manual' | 'goto' | 'tour' = this.tourActive
      ? 'tour'
      : this.autopilot
        ? this.autopilot.mode
        : 'manual';
    const autopilotTargetId = this.autopilot ? this.autopilot.project.id : null;

    const safeSpeedKmh = Number.isFinite(speedKmh) ? Math.round(speedKmh) : 0;
    const safeRpm = Number.isFinite(this.rpm) ? Math.round(this.rpm) : 850;
    const safePosX = Number.isFinite(this.carGroup.position.x)
      ? Number(this.carGroup.position.x.toFixed(1))
      : 0;
    const safePosZ = Number.isFinite(this.carGroup.position.z)
      ? Number(this.carGroup.position.z.toFixed(1))
      : 0;
    const safeHeadingDeg = Number.isFinite(headingDeg) ? Math.round(headingDeg) : 0;

    return {
      speedKmh: safeSpeedKmh,
      rpm: safeRpm,
      gear: this.gear,
      isDrifting,
      isBraking,
      isTurbo,
      headlightsOn: this.headlightsOn,
      autopilotMode,
      autopilotTargetId,
      posX: safePosX,
      posZ: safePosZ,
      headingDeg: safeHeadingDeg,
      nearestProjectId: nearestProject ? nearestProject.id : null,
      nearestProjectDist: Number.isFinite(nearestDist)
        ? Number(nearestDist.toFixed(1))
        : 999,
      activePlayingIds,
      modelLoaded: this.modelLoaded,
    };
  }

  private computeAutopilotControls(
    dt: number,
    obstacles: MonumentObstacle[],
    maxSteerAngle: number,
  ): {
    throttle: number;
    steer: number;
    handbrake: boolean;
    turbo: boolean;
  } {
    const ap = this.autopilot;
    if (!ap) {
      return { throttle: 0, steer: 0, handbrake: false, turbo: false };
    }

    // Stage 4: Dwell in front of station during autonomous tour (9.0s)
    if (ap.stage === 'dwell') {
      this.velocity.set(0, 0, 0);
      this.forwardSpeed = 0;
      this.lateralSpeed = 0;

      if (document.body.dataset.modalOpen !== 'true') {
        ap.dwellRemaining -= dt;
      }

      if (ap.dwellRemaining <= 0) {
        if (this.tourActive && this.sortedProjects.length > 0) {
          this.tourIndex = (this.tourIndex + 1) % this.sortedProjects.length;
          this.startAutopilotTo(this.sortedProjects[this.tourIndex], 'tour');
        } else {
          this.autopilot = null;
        }
      }
      return { throttle: 0, steer: 0, handbrake: true, turbo: false };
    }

    // Stage 3: Final smooth stop & alignment to lookAt at parking bay
    if (ap.stage === 'braking') {
      const lookDx = ap.lookAt.x - this.carGroup.position.x;
      const lookDz = ap.lookAt.z - this.carGroup.position.z;
      const lookLen = Math.hypot(lookDx, lookDz) || 1;
      const dotRightLook =
        (this.rightVec.x * lookDx + this.rightVec.z * lookDz) / lookLen;
      const steerAlign =
        Math.abs(this.forwardSpeed) > 0.35
          ? THREE.MathUtils.clamp(-dotRightLook * 1.4, -1, 1)
          : 0;

      if (Math.abs(this.forwardSpeed) < 0.35) {
        this.velocity.set(0, 0, 0);
        this.forwardSpeed = 0;
        this.lateralSpeed = 0;

        if (ap.mode === 'tour' && this.tourActive) {
          ap.stage = 'dwell';
          ap.dwellRemaining = 9.0;
        } else {
          this.autopilot = null;
        }
      }
      return { throttle: 0, steer: steerAlign, handbrake: true, turbo: false };
    }

    const posX = this.carGroup.position.x;
    const posZ = this.carGroup.position.z;

    // Advance sequentially through waypoints (< 2.8m for intermediate, < 0.85m for final park)
    while (ap.waypointIndex < ap.waypoints.length - 1) {
      const wp = ap.waypoints[ap.waypointIndex];
      if (Math.hypot(wp.x - posX, wp.z - posZ) < 2.8) {
        ap.waypointIndex++;
      } else {
        break;
      }
    }

    const isFinalWaypoint = ap.waypointIndex >= ap.waypoints.length - 1;
    ap.stage = isFinalWaypoint ? 'park' : 'entry';

    const currentTarget = ap.waypoints[ap.waypointIndex];
    const distToTarget = Math.hypot(currentTarget.x - posX, currentTarget.z - posZ);
    const distToPark = Math.hypot(ap.park.x - posX, ap.park.z - posZ);

    if (isFinalWaypoint && distToTarget < 0.85) {
      ap.stage = 'braking';
      return { throttle: 0, steer: 0, handbrake: true, turbo: false };
    }

    // Compute Pure Pursuit target point (align along entry -> park corridor on final approach)
    let targetX = currentTarget.x;
    let targetZ = currentTarget.z;
    if (isFinalWaypoint) {
      let corX = ap.park.x - ap.entry.x;
      let corZ = ap.park.z - ap.entry.z;
      let corLen = Math.hypot(corX, corZ);
      if (corLen < 0.2) {
        corX = ap.lookAt.x - ap.park.x;
        corZ = ap.lookAt.z - ap.park.z;
        corLen = Math.hypot(corX, corZ) || 1;
      }
      const upstream = distToPark > 1.3 ? THREE.MathUtils.clamp(distToPark * 0.4, 0, 2.0) : 0;
      targetX = ap.park.x - (corX / corLen) * upstream;
      targetZ = ap.park.z - (corZ / corLen) * upstream;
    }

    const dx = targetX - posX;
    const dz = targetZ - posZ;
    const distToAim = Math.hypot(dx, dz);
    const dirX = dx / Math.max(distToAim, 0.001);
    const dirZ = dz / Math.max(distToAim, 0.001);

    // Check if car is cleanly in front of target screen for final bay glide
    const monFrontX = ap.park.x - ap.lookAt.x;
    const monFrontZ = ap.park.z - ap.lookAt.z;
    const monFrontLen = Math.hypot(monFrontX, monFrontZ) || 1;
    const carFromTargetFront =
      ((posX - ap.lookAt.x) * monFrontX + (posZ - ap.lookAt.z) * monFrontZ) /
      monFrontLen;
    const allowFinalParkApproach =
      isFinalWaypoint && distToPark < 7.0 && carFromTargetFront > 4.0;

    // Forward predictive probes (2.6m and 5.0m ahead of front axle) + smooth repulsion
    const frontAxleX = posX + this.forwardVec.x * 1.3431;
    const frontAxleZ = posZ + this.forwardVec.z * 1.3431;
    const probeNearX = frontAxleX + this.forwardVec.x * 2.6;
    const probeNearZ = frontAxleZ + this.forwardVec.z * 2.6;
    const probeFarX = frontAxleX + this.forwardVec.x * 5.0;
    const probeFarZ = frontAxleZ + this.forwardVec.z * 5.0;

    const probeAngle = 0.56;
    const cosP = Math.cos(probeAngle);
    const sinP = Math.sin(probeAngle);
    const leftTestX =
      frontAxleX + (this.forwardVec.x * cosP - this.rightVec.x * sinP) * 3.8;
    const leftTestZ =
      frontAxleZ + (this.forwardVec.z * cosP - this.rightVec.z * sinP) * 3.8;
    const rightTestX =
      frontAxleX + (this.forwardVec.x * cosP + this.rightVec.x * sinP) * 3.8;
    const rightTestZ =
      frontAxleZ + (this.forwardVec.z * cosP + this.rightVec.z * sinP) * 3.8;

    let leftClearance = Infinity;
    let rightClearance = Infinity;
    let probeNearHit = false;
    let probeNearCritical = false;
    let probeFarHit = false;

    let avoidX = 0;
    let avoidZ = 0;
    let frontBlocked = false;

    for (const obs of obstacles) {
      const isTargetMonument =
        Math.hypot(
          obs.x - ap.project.worldPos.x,
          obs.z - ap.project.worldPos.z,
        ) < 5.5;
      const exemptTarget = allowFinalParkApproach && isTargetMonument;

      const safetyRadius = obs.radius + 1.55;
      const distNear = Math.hypot(probeNearX - obs.x, probeNearZ - obs.z);
      const distFar = Math.hypot(probeFarX - obs.x, probeFarZ - obs.z);

      if (distNear < safetyRadius) {
        probeNearHit = true;
        if (distNear < obs.radius + 1.1) {
          probeNearCritical = true;
        }
      }
      if (!exemptTarget && distFar < safetyRadius) {
        probeFarHit = true;
      }

      const lClear = Math.hypot(leftTestX - obs.x, leftTestZ - obs.z) - obs.radius;
      const rClear = Math.hypot(rightTestX - obs.x, rightTestZ - obs.z) - obs.radius;
      if (lClear < leftClearance) leftClearance = lClear;
      if (rClear < rightClearance) rightClearance = rClear;

      if (exemptTarget && distToPark < 5.2) {
        continue;
      }

      const ox = posX - obs.x;
      const oz = posZ - obs.z;
      const od = Math.hypot(ox, oz);
      const avoidRadius = obs.radius + 2.5;

      if (od < avoidRadius && od > 0.05) {
        const nx = ox / od;
        const nz = oz / od;
        const weight = (avoidRadius - od) / 2.5;

        // Choose tangential side aligned with target heading so car curves cleanly around pedestal
        const cross = -nx * dirZ + nz * dirX;
        const tangSign = cross >= 0 ? 1 : -1;
        const tx = -nz * tangSign;
        const tz = nx * tangSign;

        avoidX += nx * weight * 1.65 + tx * weight * 1.35;
        avoidZ += nz * weight * 1.65 + tz * weight * 1.35;
      }

      if (od < obs.radius + 2.1 && od > 0.05) {
        const toObsFwd = (-ox / od) * this.forwardVec.x + (-oz / od) * this.forwardVec.z;
        if (toObsFwd > 0.65) {
          frontBlocked = true;
        }
      }
    }

    const aimX = dirX + avoidX;
    const aimZ = dirZ + avoidZ;
    const aimLen = Math.hypot(aimX, aimZ) || 1;
    const normX = aimX / aimLen;
    const normZ = aimZ / aimLen;

    const dotForward = this.forwardVec.x * normX + this.forwardVec.z * normZ;
    const dotRight = this.rightVec.x * normX + this.rightVec.z * normZ;
    const freeSideSteer = leftClearance >= rightClearance ? 1 : -1;
    const revSteerChoice =
      dotForward < -0.2
        ? dotRight >= 0
          ? 1
          : -1
        : leftClearance >= rightClearance
          ? -1
          : 1;

    if (ap.reverseCooldown > 0) {
      ap.reverseCooldown = Math.max(0, ap.reverseCooldown - dt);
    }

    // Controlled reverse recovery (initial bay exit, predictive probe critical, or stuck)
    if (ap.reverseTimer > 0) {
      ap.reverseTimer = Math.max(0, ap.reverseTimer - dt);
      if (ap.reverseTimer === 0) {
        ap.reverseCooldown = 2.0;
      }
      return { throttle: -0.62, steer: revSteerChoice, handbrake: false, turbo: false };
    }

    const probeRequiresReverse =
      probeNearHit &&
      (probeNearCritical ||
        Math.max(leftClearance, rightClearance) < 1.35 ||
        Math.abs(this.forwardSpeed) < 2.2);

    if (
      (probeNearCritical || ap.reverseCooldown <= 0) &&
      (probeRequiresReverse ||
        (frontBlocked && Math.abs(this.forwardSpeed) < 1.8) ||
        (dotForward < -0.55 && distToAim < 7.5))
    ) {
      ap.reverseTimer = 1.05;
      ap.stuckTimer = 0;
      return { throttle: -0.62, steer: revSteerChoice, handbrake: false, turbo: false };
    }

    if (Math.abs(this.forwardSpeed) < 0.65) {
      ap.stuckTimer += dt;
      if (ap.stuckTimer > 0.95) {
        ap.reverseTimer = 1.05;
        ap.stuckTimer = 0;
        return { throttle: -0.62, steer: revSteerChoice, handbrake: false, turbo: false };
      }
    } else {
      ap.stuckTimer = 0;
    }

    // Pure Pursuit curvature steering with strong predictive evasive override
    const lookaheadL = THREE.MathUtils.clamp(distToAim, 2.2, 9.0);
    let steer: number;
    if (probeNearHit || probeFarHit) {
      steer = freeSideSteer;
    } else if (dotForward < 0.05) {
      steer = dotRight >= 0 ? -1 : 1;
    } else {
      const rightOffset = dotRight * lookaheadL;
      const curvature = (2 * rightOffset) / (lookaheadL * lookaheadL);
      const desiredSteerAngle = -Math.atan(WHEELBASE * curvature);
      steer = THREE.MathUtils.clamp(desiredSteerAngle / maxSteerAngle, -1, 1);
    }

    // Remaining path distance across sequential waypoints
    let effectiveDist = distToTarget;
    for (let i = ap.waypointIndex; i < ap.waypoints.length - 1; i++) {
      effectiveDist += ap.waypoints[i].distanceTo(ap.waypoints[i + 1]);
    }

    // Controlled speed profile: clamp(sqrt(2 * 4.0 * effectiveDist), 1.5, 11.5)
    let targetSpeed = THREE.MathUtils.clamp(
      Math.sqrt(Math.max(0, 2 * 4.0 * effectiveDist)),
      1.5,
      11.5,
    );

    if (dotForward < 0.7) {
      targetSpeed = Math.min(targetSpeed, 6.5);
    }
    if (dotForward < 0.25) {
      targetSpeed = Math.min(targetSpeed, 4.2);
    }

    // Look ahead to next waypoint turn so car slows smoothly before 90-degree avenue turns
    if (!isFinalWaypoint && distToTarget < 7.5) {
      const nextWp = ap.waypoints[ap.waypointIndex + 1];
      const ndx = nextWp.x - currentTarget.x;
      const ndz = nextWp.z - currentTarget.z;
      const nLen = Math.hypot(ndx, ndz);
      if (nLen > 0.5) {
        const nextDot =
          (this.forwardVec.x * ndx + this.forwardVec.z * ndz) / nLen;
        if (nextDot < 0.7) {
          targetSpeed = Math.min(targetSpeed, 6.5);
        }
      }
    }

    if (probeNearHit || probeFarHit) {
      targetSpeed = Math.min(targetSpeed, 5.0);
    }

    if (isFinalWaypoint && distToPark < 2.4) {
      targetSpeed = Math.min(targetSpeed, Math.max(1.25, distToPark * 1.4));
    }

    let throttle = 0;
    if (this.forwardSpeed < targetSpeed - 0.5) {
      throttle = THREE.MathUtils.clamp(
        (targetSpeed - this.forwardSpeed) * 0.28,
        0.25,
        0.88,
      );
    } else if (this.forwardSpeed > targetSpeed + 0.9) {
      throttle = THREE.MathUtils.clamp(
        -(this.forwardSpeed - targetSpeed) * 0.35,
        -0.75,
        -0.2,
      );
    } else {
      throttle = 0.08;
    }

    return {
      throttle,
      steer,
      handbrake: false,
      turbo: false,
    };
  }

  private resolveObstacleCollisions(obstacles: MonumentObstacle[]): void {
    const carRadius = 1.15;
    for (const obs of obstacles) {
      const dx = this.carGroup.position.x - obs.x;
      const dz = this.carGroup.position.z - obs.z;
      const minDist = obs.radius + carRadius;
      const dist = Math.hypot(dx, dz);
      if (dist < minDist && dist > 0.0001) {
        const nx = dx / dist;
        const nz = dz / dist;
        this.carGroup.position.x = obs.x + nx * minDist;
        this.carGroup.position.z = obs.z + nz * minDist;

        // Cancel inward velocity component while preserving tangential slide
        const vn = this.velocity.x * nx + this.velocity.z * nz;
        if (vn < 0) {
          this.velocity.x -= vn * nx * 1.1;
          this.velocity.z -= vn * nz * 1.1;
          this.forwardSpeed = this.velocity.dot(this.forwardVec);
        }
      }
    }
  }

  private updateGearAndRpm(
    speedKmh: number,
    throttle: number,
    handbrake: boolean,
    isTurbo: boolean,
    dt: number,
  ): void {
    let nextGear = this.gear;
    let targetRpm = 850;

    if (this.forwardSpeed < -0.5 || (throttle < -0.1 && this.forwardSpeed <= 0.4)) {
      nextGear = 'R';
      targetRpm = 1150 + Math.min(1, speedKmh / 48) * 4400 + Math.abs(throttle) * 450;
    } else if (speedKmh < 1.2 && Math.abs(throttle) < 0.08) {
      nextGear = 'N';
      targetRpm = 850 + (isTurbo ? 250 : 0);
    } else if (speedKmh < 1.5 && handbrake && throttle > 0.1) {
      nextGear = '1';
      targetRpm = 1100 + throttle * 4300;
    } else {
      // Hysteresis thresholds avoid rapid gear hunting
      if (speedKmh < 34) nextGear = '1';
      else if (speedKmh < 68) nextGear = this.gear === '1' && speedKmh < 38 ? '1' : '2';
      else if (speedKmh < 104) nextGear = this.gear === '2' && speedKmh < 72 ? '2' : '3';
      else if (speedKmh < 142) nextGear = this.gear === '3' && speedKmh < 108 ? '3' : '4';
      else nextGear = this.gear === '4' && speedKmh < 146 ? '4' : '5';

      const bands: Record<string, [number, number]> = {
        '1': [0, 38],
        '2': [26, 72],
        '3': [54, 108],
        '4': [84, 146],
        '5': [114, 192],
      };
      const [minKmh, maxKmh] = bands[nextGear] ?? [0, 40];
      const norm = THREE.MathUtils.clamp(
        (speedKmh - minKmh) / Math.max(1, maxKmh - minKmh),
        0,
        1,
      );
      targetRpm =
        1650 +
        norm * 4850 +
        Math.max(0, throttle) * 480 +
        (isTurbo && throttle > 0.2 ? 320 : 0);
    }

    this.gear = nextGear;
    const clampedTarget = THREE.MathUtils.clamp(targetRpm, 850, 6800);
    this.rpm += (clampedTarget - this.rpm) * Math.min(1, dt * 11.0);
  }

  private disposeObject3D(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        this.disposeMaterialOrArray(mesh.material);
      }
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);

    this.disposeFallbackSilhouette();
    if (this.contactShadowMesh) {
      this.contactShadowMesh.removeFromParent();
      this.contactShadowMesh.geometry.dispose();
      this.disposeMaterialOrArray(this.contactShadowMesh.material);
      this.contactShadowMesh = null;
    }
    if (this.contactShadowTex) {
      this.contactShadowTex.dispose();
      this.contactShadowTex = null;
    }
    if (this.glbModelGroup) {
      this.disposeObject3D(this.glbModelGroup);
      if (this.wheelFL) this.disposeObject3D(this.wheelFL);
      if (this.wheelFR) this.disposeObject3D(this.wheelFR);
      if (this.wheelRL) this.disposeObject3D(this.wheelRL);
      if (this.wheelRR) this.disposeObject3D(this.wheelRR);
      this.glbModelGroup = null;
    }
    this.carGroup.removeFromParent();
  }
}
