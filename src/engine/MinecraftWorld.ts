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
  sx?: number;
  sy?: number;
  sz?: number;
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
 * Daytime Minecraft 1.21+ voxel world surrounding the 3D portfolio avenue:
 * - 16x16 pixel-art canvas textures with NearestFilter + SRGBColorSpace
 * - Central Stone Brick + Mossy/Cracked Stone Brick avenue (X in [-7.5, +7.5], Z in [-214, +24])
 *   with stone-slab curbs, connecting bay paths, roadside Minecraft lanterns (|X| = 32),
 *   and crossed-plane flowers & tall grass in the lateral meadows (|X| in [24, 37])
 * - Vibrant daytime sky dome, square Minecraft sun in the front-right horizon,
 *   and low drifting voxel clouds (y = 24..34) with fog blending
 * - High Jagged Peaks / Meadows mountain ranges (y = 1..32) with Deepslate/Stone/Grass/Snow
 *   and Spruce, Oak & Birch trees strictly in the distant perimeter
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
  private readonly maxAnisotropy: number;

  constructor(scene: THREE.Scene, projects: PortfolioProject[], maxAnisotropy = 8) {
    this.scene = scene;
    this.maxAnisotropy = Math.min(16, Math.max(1, maxAnisotropy));
    this.group.name = 'Minecraft_Daylight_World';

    this.prevBackground = scene.background;
    this.prevFog = scene.fog;

    scene.background = new THREE.Color(0x9bc4f7);
    scene.fog = new THREE.Fog(0xb7d4fa, 42, 168);

    const textures = this.createPixelTextures();
    this.buildSkyAndSun();
    this.buildGroundAndRoads(projects, textures);
    this.buildRoadsideLanternsAndFlowers(projects, textures);
    this.buildVoxelClouds();
    this.buildPerimeterForestAndHills(textures);

    this.scene.add(this.group);
  }

  private makeCanvasTexture(
    size: number,
    painter: (ctx: CanvasRenderingContext2D, size: number) => void,
    repeatX = 1,
    repeatY = 1,
    isCutout = false,
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
    // Keep crisp pixel-art blocks up close while mipmapping + anisotropy eliminate distance shimmering & Moiré aliasing
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = isCutout ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = this.maxAnisotropy;

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

    // 4. Stone Brick, Cracked & Mossy Stone Bricks (16x16 per tile, 8x8 tile atlas for avenue)
    const stonePalette = ['#7d8086', '#6d7076', '#8d9096'];
    const paintSingleStoneBrickTile = (
      ctx: CanvasRenderingContext2D,
      ox: number,
      oy: number,
      rng: () => number,
      variant: 'normal' | 'cracked' | 'mossy',
    ) => {
      const size = 16;
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
          ctx.fillRect(ox + x, oy + y, 1, 1);
        }
      }

      if (variant === 'cracked') {
        const cracks = [
          [2, 2], [3, 3], [4, 3], [5, 4], [6, 5], [6, 6],
          [10, 10], [11, 11], [11, 12], [12, 13], [13, 14],
        ];
        for (const [cx, cy] of cracks) {
          ctx.fillStyle = '#474a50';
          ctx.fillRect(ox + cx, oy + cy, 1, 1);
        }
      } else if (variant === 'mossy') {
        const mossShades = ['#4f7d2f', '#5e9139', '#3f6823', '#6ca243'];
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const nearSeam =
              y <= 2 ||
              Math.abs(y - 8) <= 1 ||
              x <= 1 ||
              (y < 8 && Math.abs(x - 8) <= 1) ||
              (y >= 8 && (Math.abs(x - 4) <= 1 || Math.abs(x - 12) <= 1));
            if (nearSeam && rng() < 0.42) {
              ctx.fillStyle = mossShades[Math.floor(rng() * mossShades.length)];
              ctx.fillRect(ox + x, oy + y, 1, 1);
            } else if (rng() < 0.09) {
              ctx.fillStyle = mossShades[Math.floor(rng() * mossShades.length)];
              ctx.fillRect(ox + x, oy + y, 1, 1);
            }
          }
        }
      }
    };

    const paintStoneRoad = (ctx: CanvasRenderingContext2D) => {
      paintSingleStoneBrickTile(ctx, 0, 0, createRng(404), 'normal');
    };

    const avenueTex = this.makeCanvasTexture(
      128,
      (ctx) => {
        const rng = createRng(4041);
        for (let ty = 0; ty < 8; ty++) {
          for (let tx = 0; tx < 8; tx++) {
            const roll = rng();
            const variant: 'normal' | 'cracked' | 'mossy' =
              roll < 0.72 ? 'normal' : roll < 0.87 ? 'cracked' : 'mossy';
            paintSingleStoneBrickTile(
              ctx,
              tx * 16,
              ty * 16,
              createRng(4100 + ty * 31 + tx * 17),
              variant,
            );
          }
        }
      },
      15 / 8,
      238 / 8,
    );
    const pathTex = this.makeCanvasTexture(16, paintStoneRoad, 7, 14);
    const plazaTex = this.makeCanvasTexture(16, paintStoneRoad, 10, 10);

    // 4b. Mountain Stone, Deepslate & Snow Blocks (16x16 Minecraft 1.21+)
    const stoneTex = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(440);
      const shades = ['#7d8086', '#72757b', '#878a90', '#696c72'];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          ctx.fillStyle = shades[Math.floor(rng() * shades.length)];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    const deepslateTex = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(450);
      const shades = ['#4d5159', '#43474f', '#575b64', '#3b3e46'];
      for (let y = 0; y < size; y++) {
        const rowBias = y % 4 === 0 ? 1 : 0;
        for (let x = 0; x < size; x++) {
          const idx = Math.min(shades.length - 1, rowBias + Math.floor(rng() * 3));
          ctx.fillStyle = shades[idx];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    const snowTex = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(460);
      const shades = ['#f2f6fb', '#eaf1fa', '#ffffff', '#e1ebf7'];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const r = rng();
          const idx = r < 0.45 ? 0 : r < 0.72 ? 1 : r < 0.9 ? 2 : 3;
          ctx.fillStyle = shades[idx];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

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

    // 10. Spruce Log Side, Top & Deep Evergreen Leaves (16x16)
    const spruceBark = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(1010);
      const shades = ['#3a2513', '#2e1d0e', '#462e18', '#25170b'];
      for (let x = 0; x < size; x++) {
        const colBias = x % 4 === 0 ? 1 : 0;
        for (let y = 0; y < size; y++) {
          const idx = Math.min(shades.length - 1, colBias + Math.floor(rng() * 3));
          ctx.fillStyle = shades[idx];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    const spruceTop = this.makeCanvasTexture(16, (ctx, size) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const border = x === 0 || x === 15 || y === 0 || y === 15;
          const ring = x === 3 || x === 12 || y === 3 || y === 12;
          ctx.fillStyle = border ? '#2e1d0e' : ring ? '#6e4e2f' : '#85603c';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    const spruceLeaves = this.makeCanvasTexture(16, (ctx, size) => {
      const rng = createRng(1020);
      const shades = ['#284a2a', '#1f3b21', '#325a34', '#182f1a'];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const r = rng();
          const idx = r < 0.36 ? 0 : r < 0.7 ? 1 : r < 0.88 ? 2 : 3;
          ctx.fillStyle = shades[idx];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });

    // 11. Crossed-Plane Flowers & Tall Grass (16x16 RGBA pixel art with alpha cutout)
    const paintStemAndLeaves = (ctx: CanvasRenderingContext2D) => {
      ctx.clearRect(0, 0, 16, 16);
      ctx.fillStyle = '#3f7d24';
      ctx.fillRect(7, 8, 2, 8);
      ctx.fillStyle = '#538e2c';
      ctx.fillRect(5, 11, 2, 2);
      ctx.fillRect(9, 10, 2, 2);
      ctx.fillRect(6, 13, 1, 2);
    };

    const poppyTex = this.makeCanvasTexture(
      16,
      (ctx) => {
        paintStemAndLeaves(ctx);
        ctx.fillStyle = '#c92323';
        ctx.fillRect(5, 3, 6, 5);
        ctx.fillRect(4, 4, 8, 3);
        ctx.fillStyle = '#ef3e3e';
        ctx.fillRect(6, 3, 4, 3);
        ctx.fillRect(5, 4, 2, 2);
        ctx.fillStyle = '#241a18';
        ctx.fillRect(7, 5, 2, 2);
      },
      1,
      1,
      true,
    );

    const dandelionTex = this.makeCanvasTexture(
      16,
      (ctx) => {
        paintStemAndLeaves(ctx);
        ctx.fillStyle = '#eab308';
        ctx.fillRect(5, 4, 6, 4);
        ctx.fillRect(6, 3, 4, 6);
        ctx.fillStyle = '#fde047';
        ctx.fillRect(6, 4, 4, 4);
        ctx.fillStyle = '#ca8a04';
        ctx.fillRect(7, 5, 2, 2);
      },
      1,
      1,
      true,
    );

    const cornflowerTex = this.makeCanvasTexture(
      16,
      (ctx) => {
        paintStemAndLeaves(ctx);
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(5, 3, 6, 5);
        ctx.fillRect(4, 5, 8, 2);
        ctx.fillStyle = '#60a5fa';
        ctx.fillRect(6, 3, 4, 2);
        ctx.fillRect(5, 4, 2, 2);
        ctx.fillRect(9, 4, 2, 2);
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(7, 5, 2, 2);
      },
      1,
      1,
      true,
    );

    const tallGrassTex = this.makeCanvasTexture(
      16,
      (ctx) => {
        ctx.clearRect(0, 0, 16, 16);
        const blades: Array<[number, number, number, string]> = [
          [2, 7, 9, '#4c8628'],
          [4, 4, 12, '#62a436'],
          [6, 6, 10, '#538e2c'],
          [8, 3, 13, '#72b841'],
          [10, 5, 11, '#5a9931'],
          [12, 6, 10, '#4a8227'],
          [14, 8, 8, '#65a838'],
        ];
        for (const [bx, topY, h, color] of blades) {
          ctx.fillStyle = color;
          ctx.fillRect(bx, topY, 1, h);
          if (topY > 3) {
            ctx.fillRect(Math.max(0, bx - 1), topY + 2, 1, Math.max(2, h - 4));
          }
        }
      },
      1,
      1,
      true,
    );

    // 12. Minecraft Lantern Emissive Texture (16x16)
    const lanternTex = this.makeCanvasTexture(16, (ctx) => {
      ctx.fillStyle = '#343942';
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = '#f3cc6d';
      ctx.fillRect(2, 3, 12, 10);
      ctx.fillStyle = '#f8e59b';
      ctx.fillRect(3, 4, 10, 8);
      ctx.fillStyle = '#fff5ca';
      ctx.fillRect(5, 5, 6, 6);
      // Dark iron vertical ribs
      ctx.fillStyle = '#343942';
      ctx.fillRect(0, 0, 2, 16);
      ctx.fillRect(14, 0, 2, 16);
      ctx.fillRect(0, 0, 16, 2);
      ctx.fillRect(0, 14, 16, 2);
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
      stoneTex,
      deepslateTex,
      snowTex,
      oakBark,
      oakTop,
      oakLeaves,
      birchBark,
      birchTop,
      birchLeaves,
      spruceBark,
      spruceTop,
      spruceLeaves,
      poppyTex,
      dandelionTex,
      cornflowerTex,
      tallGrassTex,
      lanternTex,
    };
  }

  private buildSkyAndSun(): void {
    this.skyGroup.name = 'Minecraft_Sky_Dome';

    // Seamless sky dome blending zenith #6aa4f8 -> #9bc4f7 -> horizon #b7d4fa (matches Fog)
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 64;
    skyCanvas.height = 128;
    const ctx = skyCanvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, skyCanvas.height);
      grad.addColorStop(0.0, '#6aa4f8');
      grad.addColorStop(0.28, '#9bc4f7');
      grad.addColorStop(0.49, '#b7d4fa');
      grad.addColorStop(0.56, '#b7d4fa');
      grad.addColorStop(1.0, '#9bc4f7');
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

    // Classic square Minecraft Sun in the front-right horizon (z < 0, moderate height)
    // clearly visible in both 3rd-person and 1st-person views above the Jagged Peaks
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

    const sunGeo = new THREE.PlaneGeometry(28, 28);
    const sunMat = new THREE.MeshBasicMaterial({
      map: sunTex,
      fog: false,
      depthWrite: false,
    });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.set(108, 52, -255);
    sunMesh.lookAt(0, 0, 0);
    this.skyGroup.add(sunMesh);

    // Soft glowing sun halo
    const haloGeo = new THREE.PlaneGeometry(46, 46);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xfff5cb,
      transparent: true,
      opacity: 0.24,
      fog: false,
      depthWrite: false,
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.position.set(109, 52.5, -256);
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
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(geo);
    }
  }

  private createCrossedPlanesGeometry(width: number, height: number): THREE.BufferGeometry {
    const hw = width * 0.5;
    const d = hw * Math.SQRT1_2;
    const positions = new Float32Array([
      // Quad 1 (+45 deg)
      -d, 0, -d,
       d, 0,  d,
       d, height,  d,
      -d, height, -d,
      // Quad 2 (-45 deg)
      -d, 0,  d,
       d, 0, -d,
       d, height, -d,
      -d, height,  d,
    ]);
    const uvs = new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
    ]);
    const indices = [
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private buildRoadsideLanternsAndFlowers(
    projects: PortfolioProject[],
    textures: ReturnType<MinecraftWorld['createPixelTextures']>,
  ): void {
    const rng = createRng(7711);

    // 1. Minecraft Lantern Posts along outer lawn border (|X| = 32)
    const lanternZs = [14, -14, -44, -74, -104, -134, -164, -194];
    const postSpots: Array<{ x: number; z: number; inwardSign: number }> = [];
    for (const lz of lanternZs) {
      postSpots.push({ x: -32, z: lz, inwardSign: 1 });
      postSpots.push({ x: 32, z: lz, inwardSign: -1 });
    }

    const baseGeo = new THREE.BoxGeometry(0.62, 0.56, 0.62);
    const poleGeo = new THREE.BoxGeometry(0.26, 3.3, 0.26);
    const armGeo = new THREE.BoxGeometry(0.92, 0.22, 0.24);
    const hookGeo = new THREE.BoxGeometry(0.1, 0.28, 0.1);
    const lanternGeo = new THREE.BoxGeometry(0.38, 0.44, 0.38);

    const stonePostMat = new THREE.MeshLambertMaterial({
      map: textures.stoneTex,
    });
    const woodPostMat = new THREE.MeshLambertMaterial({
      map: textures.spruceBark,
    });
    const ironHookMat = new THREE.MeshLambertMaterial({
      color: 0x343942,
    });
    const lanternMat = new THREE.MeshLambertMaterial({
      map: textures.lanternTex,
      emissive: new THREE.Color(0xf8e59b),
      emissiveMap: textures.lanternTex,
      emissiveIntensity: 1.25,
    });

    this.disposables.push(
      baseGeo,
      poleGeo,
      armGeo,
      hookGeo,
      lanternGeo,
      stonePostMat,
      woodPostMat,
      ironHookMat,
      lanternMat,
    );

    const count = postSpots.length;
    const baseInst = new THREE.InstancedMesh(baseGeo, stonePostMat, count);
    const poleInst = new THREE.InstancedMesh(poleGeo, woodPostMat, count);
    const armInst = new THREE.InstancedMesh(armGeo, woodPostMat, count);
    const hookInst = new THREE.InstancedMesh(hookGeo, ironHookMat, count);
    const lanternInst = new THREE.InstancedMesh(lanternGeo, lanternMat, count);

    baseInst.name = 'Minecraft_Lantern_Bases';
    poleInst.name = 'Minecraft_Lantern_Poles';
    armInst.name = 'Minecraft_Lantern_Arms';
    hookInst.name = 'Minecraft_Lantern_Hooks';
    lanternInst.name = 'Minecraft_Lantern_Cores';

    for (const im of [baseInst, poleInst, armInst, hookInst, lanternInst]) {
      im.castShadow = false;
      im.receiveShadow = false;
    }

    this.tmpScale.set(1, 1, 1);
    for (let i = 0; i < count; i++) {
      const { x, z, inwardSign } = postSpots[i];
      this.tmpPos.set(x, 0.28, z);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      baseInst.setMatrixAt(i, this.tmpMatrix);

      this.tmpPos.set(x, 2.21, z);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      poleInst.setMatrixAt(i, this.tmpMatrix);

      this.tmpPos.set(x + inwardSign * 0.36, 3.76, z);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      armInst.setMatrixAt(i, this.tmpMatrix);

      this.tmpPos.set(x + inwardSign * 0.7, 3.51, z);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      hookInst.setMatrixAt(i, this.tmpMatrix);

      this.tmpPos.set(x + inwardSign * 0.7, 3.18, z);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      lanternInst.setMatrixAt(i, this.tmpMatrix);
    }

    for (const im of [baseInst, poleInst, armInst, hookInst, lanternInst]) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }

    // 2. Crossed-Plane Flowers (Poppy, Dandelion, Cornflower) & Tall Grass in |X| in [24, 37]
    const flowerPositions: Array<{ x: number; z: number; kind: number; scale: number; yaw: number }> = [];
    for (let attempt = 0; attempt < 950 && flowerPositions.length < 320; attempt++) {
      const side = rng() < 0.5 ? -1 : 1;
      const fx = side * (24.2 + rng() * 12.6); // strictly |X| in [24, 37]
      const fz = -226 + rng() * 250;

      // Stay well clear of all 7 project monuments/bays and lantern posts
      let blocked = false;
      for (const proj of projects) {
        if (Math.hypot(fx - proj.worldPos.x, fz - proj.worldPos.z) < 10.5) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      for (const spot of postSpots) {
        if (Math.hypot(fx - spot.x, fz - spot.z) < 1.8) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const roll = rng();
      const kind = roll < 0.42 ? 3 : roll < 0.62 ? 0 : roll < 0.81 ? 1 : 2; // Tall Grass + 3 flowers
      flowerPositions.push({
        x: fx,
        z: fz,
        kind,
        scale: kind === 3 ? 0.82 + rng() * 0.34 : 0.74 + rng() * 0.24,
        yaw: rng() * Math.PI * 0.5,
      });
    }

    const crossGeo = this.createCrossedPlanesGeometry(0.84, 0.84);
    this.disposables.push(crossGeo);

    const floraConfigs: Array<{ name: string; tex: THREE.Texture }> = [
      { name: 'Minecraft_Poppies', tex: textures.poppyTex },
      { name: 'Minecraft_Dandelions', tex: textures.dandelionTex },
      { name: 'Minecraft_Cornflowers', tex: textures.cornflowerTex },
      { name: 'Minecraft_Tall_Grass', tex: textures.tallGrassTex },
    ];

    const yAxis = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < floraConfigs.length; k++) {
      const items = flowerPositions.filter((f) => f.kind === k);
      if (items.length === 0) continue;

      const mat = new THREE.MeshLambertMaterial({
        map: floraConfigs[k].tex,
        alphaTest: 0.5,
        transparent: false,
        side: THREE.DoubleSide,
      });
      this.disposables.push(mat);

      const inst = new THREE.InstancedMesh(crossGeo, mat, items.length);
      inst.name = floraConfigs[k].name;
      inst.castShadow = false;
      inst.receiveShadow = false;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        this.tmpPos.set(item.x, 0.0, item.z);
        this.tmpQuat.setFromAxisAngle(yAxis, item.yaw);
        this.tmpScale.set(item.scale, item.scale, item.scale);
        this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        inst.setMatrixAt(i, this.tmpMatrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    }
    this.tmpQuat.identity();
  }

  private buildVoxelClouds(): void {
    const rng = createRng(1337);
    let totalBlocks = 0;

    // 38 wide, recognizable Minecraft voxel cloud formations at y = 24..34 (1.6..2.2m thick)
    // clearly visible in both 3rd-person and 1st-person views and fading smoothly into fog
    for (let i = 0; i < 38; i++) {
      const x = -220 + rng() * 440;
      const y = 24 + rng() * 10;
      const z = i < 16 ? -280 + rng() * 240 : -320 + rng() * 430;
      const speed = 1.15 + rng() * 0.95;

      const blocks: CloudBlockSpec[] = [];
      const parts = 2 + Math.floor(rng() * 3);
      for (let p = 0; p < parts; p++) {
        const spec: CloudBlockSpec = {
          dx: (p - parts * 0.5) * (9 + rng() * 7),
          dy: p === 0 ? 0 : (rng() - 0.5) * 0.5,
          dz: (rng() - 0.5) * 11,
          sx: 14 + Math.floor(rng() * 18),
          sy: 1.6 + rng() * 0.6,
          sz: 10 + Math.floor(rng() * 12),
        };
        blocks.push(spec);
        totalBlocks += 1;
      }
      this.cloudClusters.push({ x, y, z, speed, blocks });
    }

    const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
    const cloudMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0xdceaff,
      emissiveIntensity: 0.34,
      fog: true,
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
    if (Math.abs(x) > 135 || z < -305 || z > 95) return false;
    const inForbiddenZone =
      Math.abs(x) - canopyRadius < 38 &&
      z + canopyRadius > -236 &&
      z - canopyRadius < 36;
    if (inForbiddenZone) return false;
    return Math.abs(x) >= 40 || z <= -238 || z >= 38;
  }

  private hash2D(ix: number, iz: number): number {
    let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  private valueNoise2D(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);

    const a = this.hash2D(ix, iz);
    const b = this.hash2D(ix + 1, iz);
    const c = this.hash2D(ix, iz + 1);
    const d = this.hash2D(ix + 1, iz + 1);

    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }

  private buildPerimeterForestAndHills(
    textures: ReturnType<MinecraftWorld['createPixelTextures']>,
  ): void {
    const rng = createRng(4242);

    const oakTrunkBlocks: VoxelPos[] = [];
    const birchTrunkBlocks: VoxelPos[] = [];
    const spruceTrunkBlocks: VoxelPos[] = [];
    const oakLeafBlocks: VoxelPos[] = [];
    const birchLeafBlocks: VoxelPos[] = [];
    const spruceLeafBlocks: VoxelPos[] = [];

    const mountainGrassBlocks: VoxelPos[] = [];
    const mountainDirtBlocks: VoxelPos[] = [];
    const mountainStoneBlocks: VoxelPos[] = [];
    const mountainDeepslateBlocks: VoxelPos[] = [];
    const mountainSnowBlocks: VoxelPos[] = [];

    // 1. Minecraft 1.21+ Jagged Peaks & Meadows mountain ranges (y = 1..32)
    // Sampled on a 3x3m macro-voxel grid with solid vertical pillars so 70,985 cubes
    // compress into ~5,200 single-draw-call Lambert instances for locked 60 FPS!
    const STEP = 3;
    const terrainHeightMap = new Map<string, number>();

    const snapGrid = (val: number): number => Math.round(val / STEP) * STEP;
    const sampleTerrainHeight = (qx: number, qz: number): number => {
      return terrainHeightMap.get(`${snapGrid(qx)},${snapGrid(qz)}`) ?? 0;
    };

    for (let bz = -303; bz <= 93; bz += STEP) {
      for (let bx = -132; bx <= 132; bx += STEP) {
        if (Math.abs(bx) < 46 && bz > -242 && bz < 44) continue;
        if (!this.isAllowedBackgroundCoord(bx, bz, 2)) continue;

        const dxCorr = Math.max(0, Math.abs(bx) - 46);
        const dzNorth = Math.max(0, -242 - bz);
        const dzSouth = Math.max(0, bz - 44);
        const distFromCorridor = Math.max(dxCorr, dzNorth, dzSouth);

        // Domain-warped ridged multifractal for sharp Jagged Peaks silhouettes
        const warpX = (this.valueNoise2D(bx * 0.025 + 3.1, bz * 0.025 - 7.4) - 0.5) * 14;
        const warpZ = (this.valueNoise2D(bx * 0.025 - 9.2, bz * 0.025 + 4.8) - 0.5) * 14;
        const wx = bx + warpX;
        const wz = bz + warpZ;

        const n1 = 1 - Math.abs(this.valueNoise2D(wx * 0.026 + 11.3, wz * 0.026 - 4.7) * 2 - 1);
        const n2 = 1 - Math.abs(this.valueNoise2D(wx * 0.062 - 3.1, wz * 0.062 + 9.2) * 2 - 1);
        const n3 = this.valueNoise2D(bx * 0.14 + 5.5, bz * 0.14 - 2.1);

        const ridge =
          Math.pow(n1, 1.75) * 0.68 +
          Math.pow(n2, 1.9) * 0.24 +
          n3 * 0.08;

        // Carve scenic valleys so ranges form distinct massifs instead of a solid wall
        const massif = this.valueNoise2D(bx * 0.020 - 6.0, bz * 0.020 + 2.5);
        const massifWeight = Math.max(0, Math.min(1, (massif - 0.34) / 0.42));
        if (massifWeight <= 0 && distFromCorridor < 35) continue;

        const ramp = Math.min(1, distFromCorridor / 24);
        const outerFade = Math.min(
          1,
          (136 - Math.abs(bx)) / 12,
          (bz + 306) / 12,
          (96 - bz) / 12,
        );

        const rawH =
          (ridge - 0.28) * 48 * Math.pow(ramp, 0.85) * (0.28 + 0.72 * massifWeight) * Math.max(0.25, outerFade) +
          (distFromCorridor < 12 ? massifWeight * 3.0 : 0);

        const topY = Math.min(32, Math.floor(rawH));
        if (topY >= 2) {
          terrainHeightMap.set(`${bx},${bz}`, topY);
        }
      }
    }

    // Geological stratification with vertical column merging (max 2 instances per 3x3 column)
    for (const [key, topY] of terrainHeightMap.entries()) {
      const commaIdx = key.indexOf(',');
      const bx = Number(key.slice(0, commaIdx));
      const bz = Number(key.slice(commaIdx + 1));

      const hN = terrainHeightMap.get(`${bx},${bz - STEP}`) ?? 0;
      const hS = terrainHeightMap.get(`${bx},${bz + STEP}`) ?? 0;
      const hW = terrainHeightMap.get(`${bx - STEP},${bz}`) ?? 0;
      const hE = terrainHeightMap.get(`${bx + STEP},${bz}`) ?? 0;
      const minNeighborY = Math.min(hN, hS, hW, hE);
      const slope = topY - minNeighborY;

      const capH = topY >= 16 ? Math.min(4, Math.max(2, Math.round(topY * 0.22))) : 2;
      const baseH = Math.max(0, topY - capH);

      // Lower cliff pillar (Deepslate / Stone / Dirt)
      if (baseH > 0) {
        const basePillar: VoxelPos = {
          x: bx,
          y: baseH * 0.5,
          z: bz,
          sx: STEP,
          sy: baseH,
          sz: STEP,
        };
        if (topY <= 9 && slope >= 4) {
          mountainDeepslateBlocks.push(basePillar);
        } else if (topY < 11 && slope < 3) {
          mountainDirtBlocks.push(basePillar);
        } else if (this.hash2D(bx, bz) < 0.32) {
          mountainDeepslateBlocks.push(basePillar);
        } else {
          mountainStoneBlocks.push(basePillar);
        }
      }

      // Upper cap block (Snow Peak / Stone Cliff / Meadow Grass)
      const capBlock: VoxelPos = {
        x: bx,
        y: baseH + capH * 0.5,
        z: bz,
        sx: STEP,
        sy: capH,
        sz: STEP,
      };
      if (topY >= 16 || (topY === 15 && slope <= 2 && this.hash2D(bx, bz) < 0.55)) {
        mountainSnowBlocks.push(capBlock);
      } else if (slope >= 6 && topY <= 12) {
        mountainDeepslateBlocks.push(capBlock);
      } else if (topY >= 12 || slope >= 5) {
        mountainStoneBlocks.push(capBlock);
      } else {
        mountainGrassBlocks.push(capBlock);
      }
    }

    // 2. Distant Spruce (conical pine), Oak & Birch voxel trees (strictly outside |X| < 38 && Z in (-236, 36))
    const treePositions: Array<{ x: number; z: number; kind: 'oak' | 'birch' | 'spruce' }> = [];
    const minTreeSpacing = 7.6;

    for (let attempt = 0; attempt < 900 && treePositions.length < 95; attempt++) {
      const tx = Math.round(-126 + rng() * 252);
      const tz = Math.round(-295 + rng() * 380);

      // Account for 2.5m canopy radius so no leaf block ever touches the driving area
      if (!this.isAllowedBackgroundCoord(tx, tz, 2.5)) continue;

      // Grow forest on grassy meadows & foothills, never on high snow/stone cliffs
      const baseH = sampleTerrainHeight(tx, tz);
      if (baseH > 10) continue;

      let tooClose = false;
      for (const existing of treePositions) {
        if (Math.hypot(existing.x - tx, existing.z - tz) < minTreeSpacing) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const roll = rng();
      const kind: 'oak' | 'birch' | 'spruce' =
        roll < 0.38 ? 'spruce' : roll < 0.68 ? 'birch' : 'oak';
      treePositions.push({ x: tx, z: tz, kind });
    }

    for (const tree of treePositions) {
      const baseH = sampleTerrainHeight(tree.x, tree.z);

      if (tree.kind === 'spruce') {
        const trunkHeight = 6 + Math.floor(rng() * 3);
        // Single merged vertical trunk column per tree
        spruceTrunkBlocks.push({
          x: tree.x,
          y: baseH + trunkHeight * 0.5,
          z: tree.z,
          sx: 1,
          sy: trunkHeight,
          sz: 1,
        });

        // Conical layered Spruce foliage tapering from wide skirt up to single tip
        const topTipY = baseH + trunkHeight + 1;
        for (let ly = 0; ly <= trunkHeight - 1; ly++) {
          const worldY = topTipY - ly;
          let radius = 0;
          if (ly === 0) radius = 0;
          else if (ly === 1) radius = 1;
          else if (ly === 2) radius = 0;
          else if (ly === 3) radius = 1;
          else if (ly === 4) radius = 2;
          else if (ly === 5) radius = 1;
          else radius = 2;

          for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (radius === 1 && Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
              if (radius === 2 && Math.abs(dx) + Math.abs(dz) > 2) continue;
              if (ly >= 2 && dx === 0 && dz === 0) continue;

              const lx = tree.x + dx;
              const lz = tree.z + dz;
              if (Math.abs(lx) < 38 && lz > -236 && lz < 36) continue;

              spruceLeafBlocks.push({
                x: lx,
                y: worldY + 0.5,
                z: lz,
              });
            }
          }
        }
        continue;
      }

      const isBirch = tree.kind === 'birch';
      const trunkHeight = isBirch ? 4 + Math.floor(rng() * 3) : 4 + Math.floor(rng() * 2);
      const trunkTarget = isBirch ? birchTrunkBlocks : oakTrunkBlocks;
      const leafTarget = isBirch ? birchLeafBlocks : oakLeafBlocks;

      trunkTarget.push({
        x: tree.x,
        y: baseH + trunkHeight * 0.5,
        z: tree.z,
        sx: 1,
        sy: trunkHeight,
        sz: 1,
      });

      // Classic Minecraft canopy: 2 lower 5x5 chamfered layers + 3x3 layer + top cross
      const crownBase = baseH + trunkHeight - 1;
      for (let ly = 0; ly <= 3; ly++) {
        const radius = ly <= 1 ? 2 : 1;
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
              if (ly === 1 || rng() < 0.65) continue;
            }
            if (ly === 3 && Math.abs(dx) === 1 && Math.abs(dz) === 1) {
              continue;
            }
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

    // Build shared 1x1x1 voxel geometry & single-material Lambert InstancedMeshes for 60 FPS
    const voxelGeo = new THREE.BoxGeometry(1, 1, 1);
    this.disposables.push(voxelGeo);

    const grassMat = new THREE.MeshLambertMaterial({ map: textures.grassTopBlock });
    const dirtMat = new THREE.MeshLambertMaterial({ map: textures.dirtTex });
    const stoneMat = new THREE.MeshLambertMaterial({ map: textures.stoneTex });
    const deepslateMat = new THREE.MeshLambertMaterial({ map: textures.deepslateTex });
    const snowMat = new THREE.MeshLambertMaterial({ map: textures.snowTex });

    const oakTrunkMat = new THREE.MeshLambertMaterial({ map: textures.oakBark });
    const birchTrunkMat = new THREE.MeshLambertMaterial({ map: textures.birchBark });
    const spruceTrunkMat = new THREE.MeshLambertMaterial({ map: textures.spruceBark });

    const oakLeafMat = new THREE.MeshLambertMaterial({ map: textures.oakLeaves });
    const birchLeafMat = new THREE.MeshLambertMaterial({ map: textures.birchLeaves });
    const spruceLeafMat = new THREE.MeshLambertMaterial({ map: textures.spruceLeaves });

    this.disposables.push(
      grassMat,
      dirtMat,
      stoneMat,
      deepslateMat,
      snowMat,
      oakTrunkMat,
      birchTrunkMat,
      spruceTrunkMat,
      oakLeafMat,
      birchLeafMat,
      spruceLeafMat,
    );

    this.spawnInstancedVoxels('Mountain_Grass_Blocks', voxelGeo, grassMat, mountainGrassBlocks, false);
    this.spawnInstancedVoxels('Mountain_Dirt_Blocks', voxelGeo, dirtMat, mountainDirtBlocks, false);
    this.spawnInstancedVoxels('Mountain_Stone_Blocks', voxelGeo, stoneMat, mountainStoneBlocks, false);
    this.spawnInstancedVoxels('Mountain_Deepslate_Blocks', voxelGeo, deepslateMat, mountainDeepslateBlocks, false);
    this.spawnInstancedVoxels('Mountain_Snow_Blocks', voxelGeo, snowMat, mountainSnowBlocks, false);

    this.spawnInstancedVoxels('Oak_Trunks', voxelGeo, oakTrunkMat, oakTrunkBlocks, false);
    this.spawnInstancedVoxels('Birch_Trunks', voxelGeo, birchTrunkMat, birchTrunkBlocks, false);
    this.spawnInstancedVoxels('Spruce_Trunks', voxelGeo, spruceTrunkMat, spruceTrunkBlocks, false);

    this.spawnInstancedVoxels('Oak_Leaves', voxelGeo, oakLeafMat, oakLeafBlocks, false);
    this.spawnInstancedVoxels('Birch_Leaves', voxelGeo, birchLeafMat, birchLeafBlocks, false);
    this.spawnInstancedVoxels('Spruce_Leaves', voxelGeo, spruceLeafMat, spruceLeafBlocks, false);
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
    mesh.receiveShadow = false;

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      // Hard invariant assert: zero blocks in central driving zone
      if (Math.abs(p.x) < 38 && p.z > -236 && p.z < 36) {
        throw new Error(`MinecraftWorld invariant violated at (${p.x}, ${p.z})`);
      }
      this.tmpPos.set(p.x, p.y, p.z);
      this.tmpScale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
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
