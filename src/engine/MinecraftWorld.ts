import * as THREE from 'three';
import type { PortfolioProject } from '../data/projectsData';

interface CloudBlockSpec {
  dx: number;
  dy: number;
  dz: number;
  sx: number;
  sy: number;
  sz: number;
}

interface CloudCluster {
  x: number;
  y: number;
  z: number;
  speed: number;
  blocks: CloudBlockSpec[];
}

interface VoxelPos {
  x: number;
  y: number;
  z: number;
}

/**
 * Deterministic 32-bit PRNG (Mulberry32) so pixel-art textures and background
 * Minecraft forests/hills are crisp, repeatable, and artifact-free.
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Daytime Minecraft voxel world surrounding the 3D portfolio avenue:
 * - 16x16 pixel-art canvas textures with NearestFilter + SRGBColorSpace
 * - Central stone-brick & andesite avenue (X in [-7.5, +7.5], Z in [-214, +24])
 *   with stone-slab curbs and connecting stone paths to all 7 project bays
 * - Vibrant daytime sky dome, square Minecraft sun, and drifting voxel clouds
 * - Oak & Birch trees + stepped hills strictly in the distant perimeter
 *   (zero elevated blocks inside |X| < 38 && Z in (-236, 36))
 */
export class MinecraftWorld {
  public readonly group = new THREE.Group();

  private readonly scene: THREE.Scene;
  private readonly disposables: Array<{ dispose: () => void }> = [];

  private readonly skyGroup = new THREE.Group();
  private cloudsMesh: THREE.InstancedMesh | null = null;
  private readonly cloudClusters: CloudCluster[] = [];
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();

  private readonly prevBackground: THREE.Color | THREE.Texture | null;
  private readonly prevFog: THREE.Scene['fog'];

  constructor(scene: THREE.Scene, projects: PortfolioProject[]) {
    this.scene = scene;
    this.group.name = 'Minecraft_Daylight_World';

    this.prevBackground = scene.background;
    this.prevFog = scene.fog;

    scene.background = new THREE.Color(0x88b8ff);
    scene.fog = new THREE.Fog(0xbcd8ff, 88, 285);

    const textures = this.createPixelTextures();
    this.buildSkyAndSun();
    this.buildGroundAndRoads(projects, textures);
    this.buildVoxelClouds();
    this.buildPerimeterForestAndHills(textures);

    this.scene.add(this.group);
  }

  private makeCanvasTexture(
    size: number,
    painter: (ctx: CanvasRenderingContext2D, size: number) => void,
    repeatX = 1,
    repeatY = 1,
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      painter(ctx, size);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;

    if (repeatX !== 1 || repeatY !== 1) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
    } else {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }

    tex.needsUpdate = true;
    this.disposables.push(tex);
    return tex;
  }

  private createPixelTextures() {
    // 1. Grass Top (16x16 mosaic of natural Minecraft greens)
    const grassPalette = ['#5e9d34', '#6ab03b', '#538e2c', '#76be44'];
    const paintGrassTop = (ctx: CanvasRenderingContext2D, size: number, seed: number) => {
      const rng = createRng(seed);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const r = rng();
          const idx =
            r < 0.34 ? 0 : r < 0.64 ? 1 : r < 0.86 ? 2 : 3;
          ctx.fillStyle = grassPalette[idx];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };

    const grassTopGround = this.makeCanvasTexture(
      16,
      (ctx, size) => paintGrassTop(ctx, size, 101),
      520,
      520,
    );
    const grassTopBlock = this.makeCanvasTexture(
      16,
      (ctx, size) => paintGrassTop(ctx, size, 101),
      1,
      1,
    );

    // 2. Grass Side (dirt #7b5839 + irregular green overhang on top)
    const dirtPalette = ['#7b5839', '#6e4e32', '#866140', '#63452b'];
    const grassSide = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(202);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const c = dirtPalette[Math.floor(rng() * dirtPalette.length)];
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      // Top grass border (2 to 4 pixels tall per column)
      for (let x = 0; x < size; x++) {
        const overhang = 2 + Math.floor(rng() * 3);
        for (let y = 0; y < overhang; y++) {
          ctx.fillStyle =
            y === overhang - 1
              ? '#538e2c'
              : grassPalette[Math.floor(rng() * 3)];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    // 3. Dirt Block
    const dirtTex = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(303);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          ctx.fillStyle = dirtPalette[Math.floor(rng() * dirtPalette.length)];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    // 4. Stone Brick & Andesite Road Texture (16x16)
    const stonePalette = ['#7d8086', '#6d7076', '#8d9096'];
    const paintStoneRoad = (ctx: CanvasRenderingContext2D, size: number) => {
      const rng = createRng(404);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const isHorizSeam = y === 0 || y === 8;
          const isVertSeam =
            (y < 8 && (x === 0 || x === 8)) ||
            (y >= 8 && (x === 4 || x === 12));
          if (isHorizSeam || isVertSeam) {
            ctx.fillStyle = rng() < 0.55 ? '#5d6066' : '#65686e';
          } else {
            ctx.fillStyle = stonePalette[Math.floor(rng() * stonePalette.length)];
          }
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };

    const avenueTex = this.makeCanvasTexture(16, paintStoneRoad, 15, 238);
    const pathTex = this.makeCanvasTexture(16, paintStoneRoad, 7, 14);
    const plazaTex = this.makeCanvasTexture(16, paintStoneRoad, 10, 10);

    // 5. Stone Slab Curb Texture (16x16)
    const slabPalette = ['#94989e', '#868a90', '#a1a5ab'];
    const paintSlab = (ctx: CanvasRenderingContext2D, size: number) => {
      const rng = createRng(505);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (y === 0 || y === 15 || y === 7 || y === 8) {
            ctx.fillStyle = '#6c7076';
          } else {
            ctx.fillStyle = slabPalette[Math.floor(rng() * slabPalette.length)];
          }
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };
    const slabCurbTex = this.makeCanvasTexture(16, paintSlab, 1, 16);

    // 6. Oak Log Side & Top
    const oakBark = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(606);
      const oakShades = ['#6b4e2f', '#583f24', '#63472a', '#4d361e'];
      for (let x = 0; x < size; x++) {
        const colBias = x % 3 === 0 ? 1 : 0;
        for (let y = 0; y < size; y++) {
          const idx = Math.min(
            oakShades.length - 1,
            colBias + Math.floor(rng() * 3),
          );
          ctx.fillStyle = oakShades[idx];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    const oakTop = this.makeCanvasTexture(16, (ctx, size) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const border = x === 0 || x === 15 || y === 0 || y === 15;
          const ring = x === 3 || x === 12 || y === 3 || y === 12;
          ctx.fillStyle = border
            ? '#583f24'
            : ring
              ? '#9c784e'
              : '#b68f60';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    // 7. Oak Leaves (16x16)
    const oakLeaves = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(707);
      const leafColors = ['#3f7d24', '#4f922f', '#31641b', '#5aa137'];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const r = rng();
          const idx = r < 0.35 ? 0 : r < 0.68 ? 1 : r < 0.88 ? 2 : 3;
          ctx.fillStyle = leafColors[idx];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    // 8. Birch Log Side & Top (#e7e4db with dark streaks #3c3a35)
    const birchBark = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(808);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          ctx.fillStyle = rng() < 0.78 ? '#e7e4db' : '#dad6cc';
          ctx.fillRect(x, y, 1, 1);
        }
      }
      // Horizontal dark charcoal bark streaks
      const streaks = [
        [2, 2, 5],
        [9, 4, 4],
        [1, 7, 4],
        [7, 9, 6],
        [3, 12, 5],
        [11, 14, 4],
      ];
      for (const [sx, sy, len] of streaks) {
        for (let dx = 0; dx < len; dx++) {
          ctx.fillStyle = dx % 2 === 0 ? '#3c3a35' : '#56534c';
          ctx.fillRect((sx + dx) % size, sy, 1, 1);
        }
      }
    });

    const birchTop = this.makeCanvasTexture(16, (ctx, size) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const border = x === 0 || x === 15 || y === 0 || y === 15;
          ctx.fillStyle = border ? '#dcd8ce' : '#c6b18b';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    // 9. Birch Leaves (16x16 slightly lighter olive-green canopy)
    const birchLeaves = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(909);
      const leafColors = ['#4d8c32', '#5ea040', '#3f7527', '#6cb24e'];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const r = rng();
          const idx = r < 0.35 ? 0 : r < 0.7 ? 1 : r < 0.88 ? 2 : 3;
          ctx.fillStyle = leafColors[idx];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    return {
      grassTopGround,
      grassTopBlock,
      grassSide,
      dirtTex,
      avenueTex,
      pathTex,
      plazaTex,
      slabCurbTex,
      oakBark,
      oakTop,
      oakLeaves,
      birchBark,
      birchTop,
      birchLeaves,
    };
  }

  private buildSkyAndSun(): void {
    this.skyGroup.name = 'Minecraft_Sky_Dome';

    // Seamless sky dome blending zenith #88b8ff -> horizon #bcd8ff (matches Fog)
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 64;
    skyCanvas.height = 128;
    const ctx = skyCanvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, skyCanvas.height);
      grad.addColorStop(0.0, '#6aa4f8');
      grad.addColorStop(0.28, '#88b8ff');
      grad.addColorStop(0.49, '#bcd8ff');
      grad.addColorStop(0.55, '#bcd8ff');
      grad.addColorStop(1.0, '#9fc2ee');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
    }
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const skyGeo = new THREE.SphereGeometry(340, 28, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTex,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyGroup.add(skyMesh);

    // Classic square Minecraft Sun high in the sky
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = 16;
    sunCanvas.height = 16;
    const sunCtx = sunCanvas.getContext('2d');
    if (sunCtx) {
      sunCtx.fillStyle = '#fff3b8';
      sunCtx.fillRect(0, 0, 16, 16);
      sunCtx.fillStyle = '#fff9da';
      sunCtx.fillRect(2, 2, 12, 12);
      sunCtx.fillStyle = '#ffffff';
      sunCtx.fillRect(4, 4, 8, 8);
    }
    const sunTex = new THREE.CanvasTexture(sunCanvas);
    sunTex.colorSpace = THREE.SRGBColorSpace;
    sunTex.magFilter = THREE.NearestFilter;
    sunTex.minFilter = THREE.NearestFilter;
    sunTex.generateMipmaps = false;

    const sunGeo = new THREE.PlaneGeometry(34, 34);
    const sunMat = new THREE.MeshBasicMaterial({
      map: sunTex,
      fog: false,
      depthWrite: false,
    });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    // Align roughly with sunLight direction (+16, +26, +14)
    sunMesh.position.set(125, 205, 108);
    sunMesh.lookAt(0, 0, 0);
    this.skyGroup.add(sunMesh);

    // Soft glowing sun halo
    const haloGeo = new THREE.PlaneGeometry(54, 54);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xfff5cb,
      transparent: true,
      opacity: 0.22,
      fog: false,
      depthWrite: false,
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.position.set(126, 206, 109);
    haloMesh.lookAt(0, 0, 0);
    this.skyGroup.add(haloMesh);

    this.disposables.push(
      skyTex,
      skyGeo,
      skyMat,
      sunTex,
      sunGeo,
      sunMat,
      haloGeo,
      haloMat,
    );
    this.group.add(this.skyGroup);
  }

  private buildGroundAndRoads(
    projects: PortfolioProject[],
    textures: ReturnType<MinecraftWorld['createPixelTextures']>,
  ): void {
    // 1. Vast grassy ground plane (520x520m, 1m voxel tile scale)
    const groundGeo = new THREE.PlaneGeometry(520, 520);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      map: textures.grassTopGround,
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.14,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.set(0, 0, -100);
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);
    this.disposables.push(groundGeo, groundMat);

    // 2. Central Minecraft Avenue: X in [-7.5, +7.5] (15m wide), Z in [-214, +24] (238m long)
    const avenueGeo = new THREE.PlaneGeometry(15, 238);
    avenueGeo.rotateX(-Math.PI / 2);
    const avenueMat = new THREE.MeshStandardMaterial({
      map: textures.avenueTex,
      roughness: 0.9,
      metalness: 0.02,
      envMapIntensity: 0.16,
    });
    const avenueMesh = new THREE.Mesh(avenueGeo, avenueMat);
    avenueMesh.position.set(0, 0.012, -95);
    avenueMesh.receiveShadow = true;
    this.group.add(avenueMesh);
    this.disposables.push(avenueGeo, avenueMat);

    // 3. Branching stone paths & bay plazas connecting central avenue to all 7 project bays
    const pathMat = new THREE.MeshStandardMaterial({
      map: textures.pathTex,
      roughness: 0.9,
      metalness: 0.02,
      envMapIntensity: 0.16,
    });
    const plazaMat = new THREE.MeshStandardMaterial({
      map: textures.plazaTex,
      roughness: 0.9,
      metalness: 0.02,
      envMapIntensity: 0.16,
    });
    const slabMat = new THREE.MeshStandardMaterial({
      map: textures.slabCurbTex,
      roughness: 0.85,
      metalness: 0.03,
      envMapIntensity: 0.18,
    });
    this.disposables.push(pathMat, plazaMat, slabMat);

    const leftJunctionZs: number[] = [];
    const rightJunctionZs: number[] = [];

    for (const proj of projects) {
      const { x: px, z: pz, angleY } = proj.worldPos;
      const cosA = Math.cos(angleY);
      const sinA = Math.sin(angleY);

      // Station bay center (around local (0.4, 0, 7.6))
      const bayX = px + 0.4 * cosA + 7.6 * sinA;
      const bayZ = pz - 0.4 * sinA + 7.6 * cosA;

      // Stone bay plaza in front of the monument
      const plazaGeo = new THREE.PlaneGeometry(10.4, 10.6);
      plazaGeo.rotateX(-Math.PI / 2);
      const plazaMesh = new THREE.Mesh(plazaGeo, plazaMat);
      plazaMesh.position.set(bayX - 0.8 * sinA, 0.016, bayZ - 0.8 * cosA);
      plazaMesh.rotation.y = angleY;
      plazaMesh.receiveShadow = true;
      this.group.add(plazaMesh);
      this.disposables.push(plazaGeo);

      // Lateral stone connector from central avenue edge (|X| = 7.5) to bay center
      if (Math.abs(bayX) > 7.2) {
        const sideSign = bayX > 0 ? 1 : -1;
        const startX = sideSign * 6.5;
        const startZ = bayZ;
        const dx = bayX - startX;
        const dz = bayZ - startZ;
        const len = Math.hypot(dx, dz) + 2.4;

        const spurGeo = new THREE.PlaneGeometry(len, 6.8);
        spurGeo.rotateX(-Math.PI / 2);
        const spurMesh = new THREE.Mesh(spurGeo, pathMat);
        spurMesh.position.set((startX + bayX) * 0.5, 0.014, (startZ + bayZ) * 0.5);
        spurMesh.rotation.y = -Math.atan2(dz, dx);
        spurMesh.receiveShadow = true;
        this.group.add(spurMesh);
        this.disposables.push(spurGeo);

        if (sideSign < 0) leftJunctionZs.push(startZ);
        else rightJunctionZs.push(startZ);
      }
    }

    // 4. Stone-slab curbs along central avenue (with clean gaps at lateral bay junctions)
    this.buildSegmentedCurbs(-7.75, -214, 24, leftJunctionZs, 4.4, slabMat);
    this.buildSegmentedCurbs(7.75, -214, 24, rightJunctionZs, 4.4, slabMat);

    // North & South end stone-slab caps
    const capGeo = new THREE.BoxGeometry(16.0, 0.09, 0.55);
    const southCap = new THREE.Mesh(capGeo, slabMat);
    southCap.position.set(0, 0.045, 24.25);
    southCap.receiveShadow = true;
    southCap.castShadow = true;

    const northCap = new THREE.Mesh(capGeo, slabMat);
    northCap.position.set(0, 0.045, -214.25);
    northCap.receiveShadow = true;
    northCap.castShadow = true;

    this.group.add(southCap, northCap);
    this.disposables.push(capGeo);
  }

  private buildSegmentedCurbs(
    curbX: number,
    zMin: number,
    zMax: number,
    gapCenters: number[],
    gapHalfWidth: number,
    material: THREE.Material,
  ): void {
    const sortedGaps = [...gapCenters].sort((a, b) => a - b);
    const segments: Array<[number, number]> = [];
    let cursor = zMin;

    for (const gz of sortedGaps) {
      const gStart = Math.max(zMin, gz - gapHalfWidth);
      const gEnd = Math.min(zMax, gz + gapHalfWidth);
      if (gStart - cursor > 1.0) {
        segments.push([cursor, gStart]);
      }
      cursor = Math.max(cursor, gEnd);
    }
    if (zMax - cursor > 1.0) {
      segments.push([cursor, zMax]);
    }

    for (const [s0, s1] of segments) {
      const len = s1 - s0;
      const geo = new THREE.BoxGeometry(0.55, 0.09, len);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(curbX, 0.045, (s0 + s1) * 0.5);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(geo);
    }
  }

  private buildVoxelClouds(): void {
    const rng = createRng(1337);
    let totalBlocks = 0;

    // 28 layered Minecraft cloud clusters drifting across y = 46..54
    for (let i = 0; i < 28; i++) {
      const x = -220 + rng() * 440;
      const y = 46 + rng() * 8;
      const z = -320 + rng() * 430;
      const speed = 1.1 + rng() * 0.9;

      const blocks: CloudBlockSpec[] = [];
      const parts = 2 + Math.floor(rng() * 3);
      for (let p = 0; p < parts; p++) {
        const spec: CloudBlockSpec = {
          dx: (p - parts * 0.5) * (6 + rng() * 5),
          dy: p === 0 ? 0 : (rng() - 0.5) * 1.4,
          dz: (rng() - 0.5) * 8,
          sx: 10 + Math.floor(rng() * 14),
          sy: 2.6 + Math.floor(rng() * 2) * 1.2,
          sz: 8 + Math.floor(rng() * 10),
        };
        blocks.push(spec);
        totalBlocks += 1;
      }
      this.cloudClusters.push({ x, y, z, speed, blocks });
    }

    const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xf8fbff,
      emissive: 0xdbe9ff,
      emissiveIntensity: 0.42,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.1,
    });

    const mesh = new THREE.InstancedMesh(cloudGeo, cloudMat, totalBlocks);
    mesh.name = 'Minecraft_Voxel_Clouds';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.cloudsMesh = mesh;

    this.syncCloudMatrices();
    this.group.add(mesh);
    this.disposables.push(cloudGeo, cloudMat);
  }

  private syncCloudMatrices(): void {
    if (!this.cloudsMesh) return;
    let idx = 0;
    for (const cluster of this.cloudClusters) {
      for (const b of cluster.blocks) {
        this.tmpPos.set(cluster.x + b.dx, cluster.y + b.dy, cluster.z + b.dz);
        this.tmpScale.set(b.sx, b.sy, b.sz);
        this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        this.cloudsMesh.setMatrixAt(idx++, this.tmpMatrix);
      }
    }
    this.cloudsMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Mathematical guard guaranteeing ZERO trees or raised terrain blocks ever
   * enter the central driving corridor |X| < 38 && Z in (-236, 36).
   */
  private isAllowedBackgroundCoord(
    x: number,
    z: number,
    canopyRadius = 0,
  ): boolean {
    if (Math.abs(x) > 125 || z < -295 || z > 85) return false;
    const inForbiddenZone =
      Math.abs(x) - canopyRadius < 38 &&
      z + canopyRadius > -236 &&
      z - canopyRadius < 36;
    if (inForbiddenZone) return false;
    return Math.abs(x) >= 40 || z <= -238 || z >= 38;
  }

  private buildPerimeterForestAndHills(
    textures: ReturnType<MinecraftWorld['createPixelTextures']>,
  ): void {
    const rng = createRng(4242);

    const oakTrunkBlocks: VoxelPos[] = [];
    const birchTrunkBlocks: VoxelPos[] = [];
    const oakLeafBlocks: VoxelPos[] = [];
    const birchLeafBlocks: VoxelPos[] = [];
    const hillGrassBlocks: VoxelPos[] = [];
    const hillDirtBlocks: VoxelPos[] = [];

    // 1. Stepped low Minecraft hills strictly in the distant perimeter (|X| >= 48, Z <= -246, Z >= 44)
    const hillCenters: Array<{ cx: number; cz: number; rx: number; rz: number; maxH: number }> = [];
    for (let i = 0; i < 36; i++) {
      const cx = -114 + rng() * 228;
      const cz = -286 + rng() * 362;
      const rx = 5 + Math.floor(rng() * 6);
      const rz = 5 + Math.floor(rng() * 6);
      const maxH = 2 + Math.floor(rng() * 3); // 2..4 blocks tall

      // Require entire hill footprint to stay well outside the driving zone
      const safeForHill =
        Math.abs(cx) - rx >= 46 || cz + rz <= -244 || cz - rz >= 42;
      if (safeForHill && Math.abs(cx) <= 116 && cz >= -288 && cz <= 78) {
        hillCenters.push({ cx: Math.round(cx), cz: Math.round(cz), rx, rz, maxH });
      }
    }

    // Track highest ground height per integer (x, z) so trees sit cleanly on hills
    const terrainHeightMap = new Map<string, number>();
    for (const hill of hillCenters) {
      for (let dz = -hill.rz; dz <= hill.rz; dz++) {
        for (let dx = -hill.rx; dx <= hill.rx; dx++) {
          const norm = Math.hypot(dx / hill.rx, dz / hill.rz);
          if (norm > 1) continue;
          const bx = hill.cx + dx;
          const bz = hill.cz + dz;
          if (!this.isAllowedBackgroundCoord(bx, bz, 1)) continue;

          const h = Math.max(1, Math.round((1 - norm * norm) * hill.maxH));
          const key = `${bx},${bz}`;
          const prev = terrainHeightMap.get(key) ?? 0;
          if (h > prev) {
            terrainHeightMap.set(key, h);
          }
        }
      }
    }

    for (const [key, topY] of terrainHeightMap.entries()) {
      const [bxStr, bzStr] = key.split(',');
      const bx = Number(bxStr);
      const bz = Number(bzStr);
      if (!this.isAllowedBackgroundCoord(bx, bz, 0)) continue;

      for (let y = 0; y < topY - 1; y++) {
        hillDirtBlocks.push({ x: bx, y: y + 0.5, z: bz });
      }
      hillGrassBlocks.push({ x: bx, y: topY - 0.5, z: bz });
    }

    // 2. Distant Oak & Birch voxel trees (strictly outside |X| < 38 && Z in (-236, 36))
    const treePositions: Array<{ x: number; z: number; isBirch: boolean }> = [];
    const minTreeSpacing = 6.2;

    for (let attempt = 0; attempt < 900 && treePositions.length < 155; attempt++) {
      const tx = Math.round(-120 + rng() * 240);
      const tz = Math.round(-290 + rng() * 370);

      // Account for 2.5m canopy radius so no leaf block ever touches the driving area
      if (!this.isAllowedBackgroundCoord(tx, tz, 2.5)) continue;

      let tooClose = false;
      for (const existing of treePositions) {
        if (Math.hypot(existing.x - tx, existing.z - tz) < minTreeSpacing) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      treePositions.push({ x: tx, z: tz, isBirch: rng() < 0.38 });
    }

    for (const tree of treePositions) {
      const baseH = terrainHeightMap.get(`${tree.x},${tree.z}`) ?? 0;
      const trunkHeight = tree.isBirch ? 4 + Math.floor(rng() * 3) : 4 + Math.floor(rng() * 2);
      const trunkTarget = tree.isBirch ? birchTrunkBlocks : oakTrunkBlocks;
      const leafTarget = tree.isBirch ? birchLeafBlocks : oakLeafBlocks;

      for (let ty = 0; ty < trunkHeight; ty++) {
        trunkTarget.push({
          x: tree.x,
          y: baseH + ty + 0.5,
          z: tree.z,
        });
      }

      // Classic Minecraft canopy: 2 lower 5x5 chamfered layers + 3x3 layer + top cross
      const crownBase = baseH + trunkHeight - 1;
      for (let ly = 0; ly <= 3; ly++) {
        const radius = ly <= 1 ? 2 : 1;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            // Chamfer corners on outer 5x5 layers and top layer
            if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
              if (ly === 1 || rng() < 0.65) continue;
            }
            if (ly === 3 && Math.abs(dx) === 1 && Math.abs(dz) === 1) {
              continue;
            }
            // Skip interior trunk overlap on lower layers
            if (ly <= 1 && dx === 0 && dz === 0) continue;

            const lx = tree.x + dx;
            const lz = tree.z + dz;
            // Final mathematical assertion on every individual leaf block
            if (Math.abs(lx) < 38 && lz > -236 && lz < 36) continue;

            leafTarget.push({
              x: lx,
              y: crownBase + ly + 0.5,
              z: lz,
            });
          }
        }
      }
    }

    // Build shared 1x1x1 voxel geometry & separate InstancedMeshes for 60 FPS
    const voxelGeo = new THREE.BoxGeometry(1, 1, 1);
    this.disposables.push(voxelGeo);

    // Grass Block (side = grassSide, top = grassTopBlock, bottom = dirtTex)
    const grassBlockMats = [
      new THREE.MeshStandardMaterial({ map: textures.grassSide, roughness: 0.96, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.grassSide, roughness: 0.96, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.grassTopBlock, roughness: 0.96, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.dirtTex, roughness: 0.96, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.grassSide, roughness: 0.96, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.grassSide, roughness: 0.96, metalness: 0 }),
    ];
    this.disposables.push(...grassBlockMats);
    this.spawnInstancedVoxels('Hill_Grass_Blocks', voxelGeo, grassBlockMats, hillGrassBlocks, false);

    const dirtMat = new THREE.MeshStandardMaterial({
      map: textures.dirtTex,
      roughness: 0.96,
      metalness: 0,
    });
    this.disposables.push(dirtMat);
    this.spawnInstancedVoxels('Hill_Dirt_Blocks', voxelGeo, dirtMat, hillDirtBlocks, false);

    const oakTrunkMats = [
      new THREE.MeshStandardMaterial({ map: textures.oakBark, roughness: 0.94, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.oakBark, roughness: 0.94, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.oakTop, roughness: 0.94, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.oakTop, roughness: 0.94, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.oakBark, roughness: 0.94, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.oakBark, roughness: 0.94, metalness: 0 }),
    ];
    this.disposables.push(...oakTrunkMats);
    this.spawnInstancedVoxels('Oak_Trunks', voxelGeo, oakTrunkMats, oakTrunkBlocks, true);

    const birchTrunkMats = [
      new THREE.MeshStandardMaterial({ map: textures.birchBark, roughness: 0.92, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.birchBark, roughness: 0.92, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.birchTop, roughness: 0.92, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.birchTop, roughness: 0.92, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.birchBark, roughness: 0.92, metalness: 0 }),
      new THREE.MeshStandardMaterial({ map: textures.birchBark, roughness: 0.92, metalness: 0 }),
    ];
    this.disposables.push(...birchTrunkMats);
    this.spawnInstancedVoxels('Birch_Trunks', voxelGeo, birchTrunkMats, birchTrunkBlocks, true);

    const oakLeafMat = new THREE.MeshStandardMaterial({
      map: textures.oakLeaves,
      roughness: 0.95,
      metalness: 0,
    });
    const birchLeafMat = new THREE.MeshStandardMaterial({
      map: textures.birchLeaves,
      roughness: 0.95,
      metalness: 0,
    });
    this.disposables.push(oakLeafMat, birchLeafMat);

    this.spawnInstancedVoxels('Oak_Leaves', voxelGeo, oakLeafMat, oakLeafBlocks, true);
    this.spawnInstancedVoxels('Birch_Leaves', voxelGeo, birchLeafMat, birchLeafBlocks, true);
  }

  private spawnInstancedVoxels(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    positions: VoxelPos[],
    castShadow: boolean,
  ): void {
    if (positions.length === 0) return;

    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;

    this.tmpScale.set(1, 1, 1);
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      // Hard invariant assert: zero blocks in central driving zone
      if (Math.abs(p.x) < 38 && p.z > -236 && p.z < 36) {
        throw new Error(`MinecraftWorld invariant violated at (${p.x}, ${p.z})`);
      }
      this.tmpPos.set(p.x, p.y, p.z);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      mesh.setMatrixAt(i, this.tmpMatrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  public update(dt: number, carPos: THREE.Vector3): void {
    // Keep sky dome & distant sun centered on car XZ so horizon never feels close
    this.skyGroup.position.set(carPos.x, 0, carPos.z);

    // Drift voxel clouds smoothly across the sky
    if (this.cloudsMesh && this.cloudClusters.length > 0) {
      for (const cluster of this.cloudClusters) {
        cluster.x += cluster.speed * dt;
        if (cluster.x > 230) {
          cluster.x = -230;
        }
      }
      this.syncCloudMatrices();
    }
  }

  public dispose(): void {
    this.scene.background = this.prevBackground;
    this.scene.fog = this.prevFog;
    this.group.removeFromParent();
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
    this.cloudsMesh = null;
    this.cloudClusters.length = 0;
  }
}
