import * as THREE from 'three';

export interface SmokeEmissionParams {
  carGroup: THREE.Object3D;
  carVelocityWorld: THREE.Vector3;
  speedKmh: number;
  forwardSpeed: number;
  throttle: number;
  isBraking: boolean;
  isDrifting: boolean;
  isTurbo: boolean;
  dt: number;
}

interface SmokeParticleSlot {
  active: boolean;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  startScale: number;
  endScale: number;
  baseOpacity: number;
  spinSpeed: number;
}

const POOL_SIZE = 150;

// Exact Gol G5 tire contact patch coordinates in Three.js car-local space (-Z forward, +X right)
const WHEEL_RL_CONTACT = new THREE.Vector3(-0.806, 0.06, 1.417);
const WHEEL_RR_CONTACT = new THREE.Vector3(0.817, 0.06, 1.417);
const WHEEL_FL_CONTACT = new THREE.Vector3(-0.806, 0.06, -1.343);
const WHEEL_FR_CONTACT = new THREE.Vector3(0.817, 0.06, -1.343);
const EXHAUST_TIP_LOCAL = new THREE.Vector3(-0.46, 0.24, 2.02);

/**
 * Pool-based volumetric tire smoke and exhaust particle emitter.
 * Generates soft radial cloud textures procedurally via HTMLCanvasElement
 * and converts wheel contact patches to world space via carGroup.localToWorld.
 */
export class SmokeParticles {
  public readonly group = new THREE.Group();

  private readonly texture: THREE.CanvasTexture;
  private readonly pool: SmokeParticleSlot[] = [];
  private cursor = 0;

  private rearEmitAccum = 0;
  private frontEmitAccum = 0;
  private exhaustEmitAccum = 0;

  // Scratch vectors reused every frame to avoid GC allocations
  private readonly tmpWorldPos = new THREE.Vector3();
  private readonly tmpWorldBack = new THREE.Vector3();
  private readonly tmpVel = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.group.name = 'GolG5_SmokeParticles';
    this.texture = this.createVolumetricSmokeTexture();

    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color: 0xe2e8f0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      });

      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 5;
      this.group.add(sprite);

      this.pool.push({
        active: false,
        sprite,
        material,
        velocity: new THREE.Vector3(),
        age: 0,
        maxAge: 1,
        startScale: 0.35,
        endScale: 1.8,
        baseOpacity: 0.4,
        spinSpeed: 0,
      });
    }

    scene.add(this.group);
  }

  private createVolumetricSmokeTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.clearRect(0, 0, size, size);

      // Multi-lobe radial puffs give organic cloud silhouette instead of a flat disc
      const lobes = [
        { x: 64, y: 64, r: 58, alpha: 0.74 },
        { x: 50, y: 56, r: 42, alpha: 0.52 },
        { x: 78, y: 58, r: 40, alpha: 0.48 },
        { x: 60, y: 78, r: 42, alpha: 0.46 },
        { x: 72, y: 46, r: 34, alpha: 0.44 },
      ];

      for (const lobe of lobes) {
        const grad = ctx.createRadialGradient(lobe.x, lobe.y, 2, lobe.x, lobe.y, lobe.r);
        grad.addColorStop(0.0, `rgba(255, 255, 255, ${lobe.alpha})`);
        grad.addColorStop(0.45, `rgba(246, 248, 252, ${lobe.alpha * 0.62})`);
        grad.addColorStop(1.0, 'rgba(232, 238, 246, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(lobe.x, lobe.y, lobe.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private spawn(
    worldPos: THREE.Vector3,
    velocity: THREE.Vector3,
    startScale: number,
    endScale: number,
    maxAge: number,
    baseOpacity: number,
    tintHex: number,
  ): void {
    const slot = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL_SIZE;

    slot.active = true;
    slot.age = 0;
    slot.maxAge = maxAge;
    slot.startScale = startScale;
    slot.endScale = endScale;
    slot.baseOpacity = baseOpacity;
    slot.spinSpeed = (Math.random() - 0.5) * 2.2;

    slot.velocity.copy(velocity);
    slot.sprite.position.copy(worldPos);
    slot.sprite.scale.set(startScale, startScale, 1);
    slot.sprite.visible = true;

    slot.material.color.setHex(tintHex);
    slot.material.rotation = Math.random() * Math.PI * 2;
    slot.material.opacity = 0;
  }

  private emitFromLocalPoint(
    carGroup: THREE.Object3D,
    localOffset: THREE.Vector3,
    carVelocityWorld: THREE.Vector3,
    worldBackDir: THREE.Vector3,
    backwardKick: number,
    spread: number,
    upwardSpeed: number,
    startScale: number,
    endScale: number,
    maxAge: number,
    opacity: number,
    tintHex: number,
  ): void {
    this.tmpWorldPos.copy(localOffset);
    this.tmpWorldPos.x += (Math.random() - 0.5) * 0.12;
    this.tmpWorldPos.z += (Math.random() - 0.5) * 0.14;
    carGroup.localToWorld(this.tmpWorldPos);

    this.tmpVel
      .copy(carVelocityWorld)
      .multiplyScalar(0.18)
      .addScaledVector(worldBackDir, backwardKick);

    this.tmpVel.x += (Math.random() - 0.5) * spread;
    this.tmpVel.z += (Math.random() - 0.5) * spread;
    this.tmpVel.y += upwardSpeed * (0.75 + Math.random() * 0.5);

    this.spawn(
      this.tmpWorldPos,
      this.tmpVel,
      startScale,
      endScale,
      maxAge,
      opacity,
      tintHex,
    );
  }

  public update(params: SmokeEmissionParams): void {
    const {
      carGroup,
      carVelocityWorld,
      speedKmh,
      forwardSpeed,
      throttle,
      isBraking,
      isDrifting,
      isTurbo,
      dt,
    } = params;

    if (dt <= 0) return;

    // World vector pointing toward rear of car (+Z local)
    carGroup.getWorldQuaternion(this.tmpQuat);
    this.tmpWorldBack.set(0, 0, 1).applyQuaternion(this.tmpQuat).normalize();
    const moveSign = forwardSpeed >= -0.5 ? 1 : -1;

    const hardLaunch = Math.abs(throttle) > 0.65 && speedKmh < 40;
    const hardBrake = isBraking && speedKmh > 15;
    const turboPush = isTurbo && Math.abs(throttle) > 0.35;
    const heavySmoke = isDrifting || hardBrake || hardLaunch || turboPush;

    // 1. Rear tires (primary drift/burnout emitters + subtle road mist at higher speeds)
    let rearRate = 0;
    if (isDrifting) rearRate = 44;
    else if (hardBrake || hardLaunch) rearRate = 34;
    else if (turboPush) rearRate = 24;
    else if (speedKmh > 26) rearRate = 4 + Math.min(8, (speedKmh - 26) * 0.08);

    if (rearRate > 0) {
      this.rearEmitAccum += rearRate * dt;
      while (this.rearEmitAccum >= 1) {
        this.rearEmitAccum -= 1;
        const opacity = heavySmoke ? 0.44 + Math.random() * 0.16 : 0.12 + Math.random() * 0.06;
        const startScale = heavySmoke ? 0.36 : 0.24;
        const endScale = heavySmoke ? 2.15 + Math.random() * 0.85 : 0.95 + Math.random() * 0.35;
        const maxAge = heavySmoke ? 1.05 + Math.random() * 0.42 : 0.52 + Math.random() * 0.2;
        const tint = isDrifting || hardBrake ? 0xf8fafc : 0xe2e8f0;

        for (const wheelPos of [WHEEL_RL_CONTACT, WHEEL_RR_CONTACT]) {
          this.emitFromLocalPoint(
            carGroup,
            wheelPos,
            carVelocityWorld,
            this.tmpWorldBack,
            moveSign * (1.2 + Math.min(3.5, speedKmh * 0.04)),
            heavySmoke ? 2.2 : 0.9,
            heavySmoke ? 0.95 : 0.42,
            startScale,
            endScale,
            maxAge,
            opacity,
            tint,
          );
        }
      }
    } else {
      this.rearEmitAccum = 0;
    }

    // 2. Front tires (burnout/launch FWD wheelspin, hard braking lockup, and aggressive drift)
    let frontRate = 0;
    if (hardLaunch || hardBrake) frontRate = 24;
    else if (isDrifting || turboPush) frontRate = 16;

    if (frontRate > 0) {
      this.frontEmitAccum += frontRate * dt;
      while (this.frontEmitAccum >= 1) {
        this.frontEmitAccum -= 1;
        const opacity = hardLaunch || hardBrake ? 0.36 + Math.random() * 0.14 : 0.24 + Math.random() * 0.1;
        const tint = hardBrake ? 0xf1f5f9 : 0xdbe2ec;

        for (const wheelPos of [WHEEL_FL_CONTACT, WHEEL_FR_CONTACT]) {
          this.emitFromLocalPoint(
            carGroup,
            wheelPos,
            carVelocityWorld,
            this.tmpWorldBack,
            moveSign * 1.4,
            1.6,
            0.78,
            0.3,
            1.65 + Math.random() * 0.5,
            0.85 + Math.random() * 0.28,
            opacity,
            tint,
          );
        }
      }
    } else {
      this.frontEmitAccum = 0;
    }

    // 3. Tailpipe exhaust wisp (dark slate tint stays legible over stone avenue & green grass)
    const exhaustRate = Math.abs(throttle) > 0.1 ? (isTurbo ? 11 : 6.5) : 2.2;
    this.exhaustEmitAccum += exhaustRate * dt;
    while (this.exhaustEmitAccum >= 1) {
      this.exhaustEmitAccum -= 1;
      this.emitFromLocalPoint(
        carGroup,
        EXHAUST_TIP_LOCAL,
        carVelocityWorld,
        this.tmpWorldBack,
        1.8 + Math.abs(throttle) * 2.2,
        0.45,
        0.52,
        0.14,
        0.65 + Math.abs(throttle) * 0.38,
        0.54,
        isTurbo ? 0.24 : 0.14,
        isTurbo ? 0xcbd5e1 : 0x5c6470,
      );
    }

    // 4. Integrate active particles
    const dragFactor = Math.exp(-2.4 * dt);
    for (let i = 0; i < POOL_SIZE; i++) {
      const slot = this.pool[i];
      if (!slot.active) continue;

      slot.age += dt;
      if (slot.age >= slot.maxAge) {
        slot.active = false;
        slot.sprite.visible = false;
        continue;
      }

      const t = slot.age / slot.maxAge;
      slot.velocity.multiplyScalar(dragFactor);
      slot.sprite.position.addScaledVector(slot.velocity, dt);

      const scale = slot.startScale + (slot.endScale - slot.startScale) * Math.pow(t, 0.72);
      slot.sprite.scale.set(scale, scale, 1);

      // Keep cloud billows rolling above the Blender ground plane
      const minY = scale * 0.22;
      if (slot.sprite.position.y < minY) {
        slot.sprite.position.y = minY;
        slot.velocity.y = Math.max(0.15, Math.abs(slot.velocity.y) * 0.35);
      }

      // Smooth fade-in (first 15%) followed by gradual dissipation
      const fadeIn = Math.min(1, t / 0.15);
      const fadeOut = Math.pow(1 - t, 1.35);
      slot.material.opacity = slot.baseOpacity * fadeIn * fadeOut;
      slot.material.rotation += slot.spinSpeed * dt;
    }
  }

  public reset(): void {
    this.rearEmitAccum = 0;
    this.frontEmitAccum = 0;
    this.exhaustEmitAccum = 0;
    for (const slot of this.pool) {
      slot.active = false;
      slot.sprite.visible = false;
      slot.material.opacity = 0;
    }
  }

  public dispose(): void {
    this.group.removeFromParent();
    for (const slot of this.pool) {
      slot.material.dispose();
    }
    this.texture.dispose();
  }
}
