import * as THREE from "three";
import Multipoint from "@arcgis/core/geometry/Multipoint";
import { marsHiRiseImagery, marsImagery, marsSR } from "../utilities/layers";
import type { ScienceWaypoint } from "./jezeroDataset";

interface HiRiseMeta {
  width: number;
  height: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  minElevM?: number;
  maxElevM?: number;
}

export interface PovTelemetry {
  elevM: number;
  slopeDeg: number;
  headingDeg: number;
  offsetNorthM: number;
  offsetEastM: number;
  pointerLocked: boolean;
  resolutionMode: "HiRISE 1m DTM" | "Global MDEM200M";
  dataMode: 1 | 2 | 3 | 4;
}

const HIRISE_DTM_PREFIXES = ["jezero", "gale", "candor", "oxia"] as const;
const dtmCache = new Map<string, { meta: HiRiseMeta; grid: Float32Array }>();
const metaCache = new Map<string, HiRiseMeta>();

async function loadDtmMeta(prefix: string): Promise<HiRiseMeta | null> {
  const existing = metaCache.get(prefix);
  if (existing) return existing;
  try {
    const res = await fetch(`/data/${prefix}_hirise_meta.json`);
    if (!res.ok) return null;
    const meta = (await res.json()) as HiRiseMeta;
    metaCache.set(prefix, meta);
    return meta;
  } catch {
    return null;
  }
}

export async function ensureHiRiseData(
  lon?: number,
  lat?: number,
): Promise<{
  meta: HiRiseMeta;
  grid: Float32Array;
} | null> {
  let targetPrefix = "jezero";

  if (lon !== undefined && lat !== undefined) {
    const metas = await Promise.all(
      HIRISE_DTM_PREFIXES.map(async (p) => ({ p, meta: await loadDtmMeta(p) })),
    );
    const match = metas.find(
      ({ meta }) =>
        meta &&
        lon >= meta.minLon &&
        lon <= meta.maxLon &&
        lat >= meta.minLat &&
        lat <= meta.maxLat,
    );
    if (!match) return null;
    targetPrefix = match.p;
  }

  const cached = dtmCache.get(targetPrefix);
  if (cached) return cached;

  try {
    const [meta, binRes] = await Promise.all([
      loadDtmMeta(targetPrefix),
      fetch(`/data/${targetPrefix}_hirise_dtm.bin`),
    ]);
    if (!meta || !binRes.ok) return null;
    const grid = new Float32Array(await binRes.arrayBuffer());
    // Fill any NaN nodata borders along the diagonal HiRISE strip via fast 2D propagation
    const { width: w, height: h } = meta;
    for (let y = 0; y < h; y++) {
      let last = Number.NaN;
      for (let x = 0; x < w; x++) {
        const v = grid[y * w + x];
        if (!Number.isNaN(v)) last = v;
        else if (!Number.isNaN(last)) grid[y * w + x] = last;
      }
      last = Number.NaN;
      for (let x = w - 1; x >= 0; x--) {
        const v = grid[y * w + x];
        if (!Number.isNaN(v)) last = v;
        else if (!Number.isNaN(last)) grid[y * w + x] = last;
      }
    }
    for (let x = 0; x < w; x++) {
      let last = Number.NaN;
      for (let y = 0; y < h; y++) {
        const v = grid[y * w + x];
        if (!Number.isNaN(v)) last = v;
        else if (!Number.isNaN(last)) grid[y * w + x] = last;
      }
      last = Number.NaN;
      for (let y = h - 1; y >= 0; y--) {
        const v = grid[y * w + x];
        if (!Number.isNaN(v)) last = v;
        else if (!Number.isNaN(last)) grid[y * w + x] = last;
      }
    }
    const entry = { meta, grid };
    dtmCache.set(targetPrefix, entry);

    // Pre-warm Level 14 HiRISE imagery tiles in the background (capped at 16 tiles)
    const level = 14;
    const tileDeg = (0.3515625 / Math.pow(2, level)) * 512;
    const colMin = Math.floor((meta.minLon + 180) / tileDeg);
    const colMax = Math.floor((meta.maxLon + 180) / tileDeg);
    const rowMin = Math.floor((90 - meta.maxLat) / tileDeg);
    const rowMax = Math.floor((90 - meta.minLat) / tileDeg);
    if ((colMax - colMin + 1) * (rowMax - rowMin + 1) <= 16) {
      for (let r = rowMin; r <= rowMax; r++) {
        for (let c = colMin; c <= colMax; c++) {
          void loadImage(
            `https://astro.arcgis.com/arcgis/rest/services/OnMars/HiRISE/MapServer/tile/${level}/${r}/${c}`,
          );
        }
      }
    }
    return entry;
  } catch {
    return null;
  }
}

function createMarsSkyDome(dustStorm: boolean, sunDir: THREE.Vector3): THREE.Mesh {
  const skyGeo = new THREE.SphereGeometry(1600, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uDust: { value: dustStorm ? 1.0 : 0.0 },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;
      uniform vec3 uSunDir;
      uniform float uDust;
      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 horizon = mix(vec3(0.79, 0.50, 0.34), vec3(0.62, 0.36, 0.21), uDust);
        vec3 zenith  = mix(vec3(0.24, 0.27, 0.34), vec3(0.45, 0.28, 0.18), uDust);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));

        float sunCos = max(dot(dir, uSunDir), 0.0);
        // Martian bluish dust Mie scattering halo around the sun
        float blueHalo = pow(sunCos, 10.0) * (1.0 - 0.6 * uDust);
        col += vec3(0.18, 0.24, 0.34) * blueHalo * 0.65;
        // Crisp sun disc
        float sunDisc = smoothstep(0.9992, 0.9997, sunCos) * (1.0 - 0.7 * uDust);
        col += vec3(1.0, 0.96, 0.90) * sunDisc * 1.4;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(skyGeo, skyMat);
}

const tileImageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  let cached = tileImageCache.get(url);
  if (!cached) {
    cached = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = window.setTimeout(() => resolve(null), 2500);
      img.onload = () => {
        window.clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });
    tileImageCache.set(url, cached);
  }
  return cached;
}

/**
 * Fetches global Mars color imagery (OnMars/MDIM, Level 10) as base layer,
 * then overlays NASA/UArizona HiRISE orbital tiles (Level 14, ~1.2m/px)
 * where available, stitching them for the exact 600x600m patch.
 */
async function fetchHiRisePatchTexture(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
): Promise<THREE.CanvasTexture | null> {
  const tileSize = 512;
  const outSize = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#b8744e";
  ctx.fillRect(0, 0, outSize, outSize);
  // Pre-fill with fine regolith grain so any missing strip tile blends naturally
  const imgData = ctx.getImageData(0, 0, outSize, outSize);
  for (let i = 0; i < outSize * outSize; i++) {
    const n = Math.sin(i * 12.9898) * 43758.5453;
    const g = (n - Math.floor(n) - 0.5) * 34;
    imgData.data[i * 4 + 0] = Math.min(255, Math.max(0, 184 + g));
    imgData.data[i * 4 + 1] = Math.min(255, Math.max(0, 116 + g * 0.7));
    imgData.data[i * 4 + 2] = Math.min(255, Math.max(0, 78 + g * 0.5));
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  let loadedCount = 0;

  // 1. Base global Mars color imagery (OnMars/MDIM, Level 10)
  const mdLevel = 10;
  const mdRes = 0.3515625 / Math.pow(2, mdLevel);
  const mdTileDeg = mdRes * tileSize;
  const mdColMin = Math.floor((minLon - -180) / mdTileDeg);
  const mdColMax = Math.floor((maxLon - -180) / mdTileDeg);
  const mdRowMin = Math.floor((90 - maxLat) / mdTileDeg);
  const mdRowMax = Math.floor((90 - minLat) / mdTileDeg);

  if ((mdColMax - mdColMin + 1) * (mdRowMax - mdRowMin + 1) <= 9) {
    const mdJobs: Promise<void>[] = [];
    for (let r = mdRowMin; r <= mdRowMax; r++) {
      for (let c = mdColMin; c <= mdColMax; c++) {
        const url = `https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer/tile/${mdLevel}/${r}/${c}`;
        mdJobs.push(
          loadImage(url).then((img) => {
            if (!img) return;
            loadedCount++;
            const tMinLon = -180 + c * mdTileDeg;
            const tMaxLat = 90 - r * mdTileDeg;
            const dx = ((tMinLon - minLon) / (maxLon - minLon)) * outSize;
            const dy = ((maxLat - tMaxLat) / (maxLat - minLat)) * outSize;
            const dw = (mdTileDeg / (maxLon - minLon)) * outSize;
            const dh = (mdTileDeg / (maxLat - minLat)) * outSize;
            ctx.save();
            ctx.filter = "brightness(1.2) contrast(1.05)";
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.restore();
          }),
        );
      }
    }
    await Promise.all(mdJobs);
  }

  // 2. Overlay HiRISE Level 14 where available
  const level = 14;
  const res = 0.3515625 / Math.pow(2, level); // deg per pixel
  const tileDeg = res * tileSize;

  const colMin = Math.floor((minLon - -180) / tileDeg);
  const colMax = Math.floor((maxLon - -180) / tileDeg);
  const rowMin = Math.floor((90 - maxLat) / tileDeg);
  const rowMax = Math.floor((90 - minLat) / tileDeg);

  if ((colMax - colMin + 1) * (rowMax - rowMin + 1) <= 16) {
    const jobs: Promise<void>[] = [];
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        const url = `https://astro.arcgis.com/arcgis/rest/services/OnMars/HiRISE/MapServer/tile/${level}/${r}/${c}`;
        jobs.push(
          loadImage(url).then((img) => {
            if (!img) return;
            loadedCount++;
            const tMinLon = -180 + c * tileDeg;
            const tMaxLat = 90 - r * tileDeg;
            const dx = ((tMinLon - minLon) / (maxLon - minLon)) * outSize;
            const dy = ((maxLat - tMaxLat) / (maxLat - minLat)) * outSize;
            const dw = (tileDeg / (maxLon - minLon)) * outSize;
            const dh = (tileDeg / (maxLat - minLat)) * outSize;
            ctx.save();
            ctx.filter = "brightness(1.28) contrast(1.08)";
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.restore();
          }),
        );
      }
    }
    await Promise.all(jobs);
  }

  if (loadedCount === 0) return null;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createMarsRegolithTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = Math.sin(i * 12.9898) * 43758.5453;
    const r = n - Math.floor(n);
    const base = 138 + (r - 0.5) * 44;
    img.data[i * 4 + 0] = Math.min(255, Math.max(0, base * 1.12));
    img.data[i * 4 + 1] = Math.min(255, Math.max(0, base * 0.72));
    img.data[i * 4 + 2] = Math.min(255, Math.max(0, base * 0.52));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  return tex;
}

export class SurfacePovEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private animId = 0;
  private disposed = false;

  private centerLon: number;
  private centerLat: number;
  private centerElevM = -2540;
  private exaggeration: number;
  private walkPhase = 0;

  // Local terrain height sampler (x = East meters, z = South meters)
  private patchSizeM = 2400;
  private segs = 200;
  private heightField = new Float32Array((200 + 1) * (200 + 1));

  // FPS camera state
  private yaw = 0; // radians, 0 = North (-Z)
  private pitch = -0.04;
  private keys = new Set<string>();
  private dustPoints: THREE.Points | null = null;
  private skyDome: THREE.Mesh | null = null;
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private lastTime = performance.now();
  private onTelemetry: (t: PovTelemetry) => void;
  private frameCounter = 0;
  private ground?: __esri.Ground;
  private resolutionMode: "HiRISE 1m DTM" | "Global MDEM200M" = "HiRISE 1m DTM";
  private dataMode: 1 | 2 | 3 | 4 = 1;
  private terrainGeom: THREE.PlaneGeometry | null = null;
  private terrainMat: THREE.MeshStandardMaterial | null = null;
  private orthoTex: THREE.CanvasTexture | null = null;
  private regolithTex: THREE.CanvasTexture | null = null;
  private modeColors: Partial<Record<1 | 2 | 3 | 4, Float32Array>> = {};
  private minimapCanvas: HTMLCanvasElement | null = null;
  private largeMapCanvas: HTMLCanvasElement | null = null;
  private minimapReliefCanvas: HTMLCanvasElement | null = null;
  private minimapWaypoints: { x: number; z: number; critical: boolean }[] = [];
  private minimapRoute: { x: number; z: number }[] = [];
  private roverSupport = false;
  private roverGroup: THREE.Group | null = null;
  private astarPath: { lon: number; lat: number }[] = [];
  private verticalVel = 0;
  private verticalOffset = 0;
  private isGrounded = true;

  constructor(opts: {
    container: HTMLElement;
    lon: number;
    lat: number;
    exaggeration: number;
    waypoints: ScienceWaypoint[];
    astarPath?: { lon: number; lat: number }[];
    dustStorm: boolean;
    roverSupport?: boolean;
    ground?: __esri.Ground;
    onTelemetry: (t: PovTelemetry) => void;
  }) {
    this.container = opts.container;
    this.centerLon = opts.lon;
    this.centerLat = opts.lat;
    this.exaggeration = opts.exaggeration;
    this.astarPath = opts.astarPath ?? [];
    this.roverSupport = Boolean(opts.roverSupport);
    this.ground = opts.ground;
    this.onTelemetry = opts.onTelemetry;

    const w = opts.container.clientWidth || window.innerWidth;
    const h = opts.container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "default" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = false;
    opts.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const skyColor = opts.dustStorm ? 0x9b5a34 : 0xc47b52;
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.FogExp2(skyColor, opts.dustStorm ? 0.008 : 0.0007);

    this.camera = new THREE.PerspectiveCamera(70, w / h, 0.1, 4500);
    this.camera.rotation.order = "YXZ";

    // Martian sunlight + warm dust bounce fill + Sky Dome
    const sunDir = new THREE.Vector3(120, 72, -90).normalize();
    const sun = new THREE.DirectionalLight(0xfff1e0, 2.5);
    sun.position.copy(sunDir).multiplyScalar(200);
    this.scene.add(sun);

    const hemi = new THREE.HemisphereLight(0xf3c3a2, 0x6e4733, 1.15);
    this.scene.add(hemi);

    this.skyDome = createMarsSkyDome(opts.dustStorm, sunDir);
    this.scene.add(this.skyDome);

    this.bindEvents();
    void this.buildScene(opts.waypoints);
    this.loop();
  }

  private async buildScene(waypoints: ScienceWaypoint[]) {
    const data = await ensureHiRiseData(this.centerLon, this.centerLat);
    const N = this.segs;
    const metersPerDegLat = (Math.PI * 3389500) / 180;
    const metersPerDegLon =
      metersPerDegLat * Math.cos((this.centerLat * Math.PI) / 180);

    // Dynamically expand patchSizeM if user waypoints span beyond 1100m
    let maxSpanM = 1100;
    for (const wp of waypoints) {
      const wx = Math.abs((wp.lon - this.centerLon) * metersPerDegLon);
      const wz = Math.abs((wp.lat - this.centerLat) * metersPerDegLat);
      maxSpanM = Math.max(maxSpanM, wx + 450, wz + 450);
    }
    this.patchSizeM = Math.min(12000, Math.max(2400, Math.ceil(maxSpanM * 2.5)));
    const half = this.patchSizeM / 2;

    const inJezeroHiRes =
      !!data &&
      this.centerLon >= data.meta.minLon &&
      this.centerLon <= data.meta.maxLon &&
      this.centerLat >= data.meta.minLat &&
      this.centerLat <= data.meta.maxLat;

    this.resolutionMode = inJezeroHiRes ? "HiRISE 1m DTM" : "Global MDEM200M";

    const pMinLon = this.centerLon - half / metersPerDegLon;
    const pMaxLon = this.centerLon + half / metersPerDegLon;
    const pMinLat = this.centerLat - half / metersPerDegLat;
    const pMaxLat = this.centerLat + half / metersPerDegLat;

    const patchExceedsDtm =
      !inJezeroHiRes ||
      !data ||
      pMinLon < data.meta.minLon ||
      pMaxLon > data.meta.maxLon ||
      pMinLat < data.meta.minLat ||
      pMaxLat > data.meta.maxLat;

    let globalGrid: Float32Array | null = null;
    const gSize = 21;
    if (patchExceedsDtm && this.ground) {
      const pts: number[][] = [];
      for (let r = 0; r < gSize; r++) {
        const lat = pMaxLat - (r / (gSize - 1)) * (pMaxLat - pMinLat);
        for (let c = 0; c < gSize; c++) {
          const lon = pMinLon + (c / (gSize - 1)) * (pMaxLon - pMinLon);
          pts.push([lon, lat]);
        }
      }
      try {
        const res = await this.ground.queryElevation(
          new Multipoint({ points: pts, spatialReference: marsSR }),
        );
        const outPts = (res.geometry as Multipoint).points;
        const baseFallback = data?.meta.minElevM ?? -2500;
        globalGrid = new Float32Array(gSize * gSize);
        for (let i = 0; i < outPts.length; i++) {
          const z = outPts[i][2];
          globalGrid[i] = Number.isFinite(z) && Math.abs(z) > 0.001 ? z : baseFallback;
        }
      } catch {
        globalGrid = null;
      }
    }

    const sampleGlobal = (lon: number, lat: number): number => {
      if (!globalGrid) return 0;
      const clampedLon = Math.max(pMinLon, Math.min(pMaxLon, lon));
      const clampedLat = Math.max(pMinLat, Math.min(pMaxLat, lat));
      const u = ((clampedLon - pMinLon) / (pMaxLon - pMinLon)) * (gSize - 1);
      const v = ((pMaxLat - clampedLat) / (pMaxLat - pMinLat)) * (gSize - 1);
      const x0 = Math.floor(u);
      const x1 = Math.min(gSize - 1, x0 + 1);
      const y0 = Math.floor(v);
      const y1 = Math.min(gSize - 1, y0 + 1);
      const fx = u - x0;
      const fy = v - y0;
      const a = globalGrid[y0 * gSize + x0];
      const b = globalGrid[y0 * gSize + x1];
      const c = globalGrid[y1 * gSize + x0];
      const d = globalGrid[y1 * gSize + x1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };

    const sampleHiRise = (lon: number, lat: number): number => {
      if (!inJezeroHiRes || !data) {
        return sampleGlobal(lon, lat);
      }

      const { meta, grid } = data;
      const clampedLon = Math.max(meta.minLon, Math.min(meta.maxLon, lon));
      const clampedLat = Math.max(meta.minLat, Math.min(meta.maxLat, lat));
      const u =
        ((clampedLon - meta.minLon) / (meta.maxLon - meta.minLon)) *
        (meta.width - 1);
      const v =
        ((meta.maxLat - clampedLat) / (meta.maxLat - meta.minLat)) *
        (meta.height - 1);
      const x0 = Math.floor(u);
      const x1 = Math.min(meta.width - 1, x0 + 1);
      const y0 = Math.floor(v);
      const y1 = Math.min(meta.height - 1, y0 + 1);
      const fx = u - x0;
      const fy = v - y0;
      const v00 = grid[y0 * meta.width + x0];
      const v10 = grid[y0 * meta.width + x1];
      const v01 = grid[y1 * meta.width + x0];
      const v11 = grid[y1 * meta.width + x1];
      const fallback = meta.minElevM ?? 0;
      const a = Number.isNaN(v00) ? fallback : v00;
      const b = Number.isNaN(v10) ? a : v10;
      const c = Number.isNaN(v01) ? a : v01;
      const d = Number.isNaN(v11) ? a : v11;
      const hiVal = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;

      const outLon = lon < meta.minLon ? meta.minLon - lon : lon > meta.maxLon ? lon - meta.maxLon : 0;
      const outLat = lat < meta.minLat ? meta.minLat - lat : lat > meta.maxLat ? lat - meta.maxLat : 0;
      const outDist = Math.max(outLon, outLat);
      if (outDist <= 0) return hiVal;

      if (globalGrid) {
        const gVal = sampleGlobal(lon, lat);
        if (Math.abs(gVal - hiVal) < 600) {
          const blend = Math.min(1, outDist / 0.003);
          const s = blend * blend * (3 - 2 * blend);
          return hiVal * (1 - s) + gVal * s;
        }
      }
      return hiVal;
    };

    this.centerElevM = sampleHiRise(this.centerLon, this.centerLat);

    const geom = new THREE.PlaneGeometry(
      this.patchSizeM,
      this.patchSizeM,
      N,
      N,
    );
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position;
    const uv = geom.attributes.uv;

    for (let r = 0; r <= N; r++) {
      for (let c = 0; c <= N; c++) {
        const idx = r * (N + 1) + c;
        const x = -half + (c / N) * this.patchSizeM; // East (+)
        const z = -half + (r / N) * this.patchSizeM; // South (+), North (-)
        const lon = this.centerLon + x / metersPerDegLon;
        const lat = this.centerLat - z / metersPerDegLat;

        const rawH = (sampleHiRise(lon, lat) - this.centerElevM) * this.exaggeration;
        const micro =
          Math.sin(x * 0.45 + z * 0.32) * 0.14 +
          Math.cos(x * 1.1 - z * 0.9) * 0.06;
        const y = rawH + micro;

        this.heightField[idx] = y;
        pos.setY(idx, y);

        // Exact 0..1 UVs for the 600x600m stitched HiRISE orbital texture
        uv.setXY(idx, c / N, 1 - r / N);
      }
    }

    geom.computeVertexNormals();
    const normals = geom.attributes.normal;
    const c1 = new Float32Array(pos.count * 3);
    const c2 = new Float32Array(pos.count * 3);
    const c3 = new Float32Array(pos.count * 3);
    const c4 = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const nx = normals.getX(i);
      const ny = normals.getY(i);
      const nz = normals.getZ(i);
      const y = pos.getY(i);
      const sunDot = Math.max(0.55, nx * 0.55 + ny * 0.65 - nz * 0.45);
      const slopeDark = 0.85 + 0.15 * ny;
      const shade = sunDot * slopeDark;

      // Mode 1: Optical (warm Martian oxide tint)
      c1[i * 3 + 0] = Math.min(1, 1.0 * shade);
      c1[i * 3 + 1] = Math.min(1, 0.72 * shade);
      c1[i * 3 + 2] = Math.min(1, 0.52 * shade);

      // Mode 2: Topography & Slope Safety (Green <12°, Amber 12-24°, Red >24°)
      const slopeDeg = (Math.acos(Math.min(1, Math.max(0, ny))) * 180) / Math.PI;
      if (slopeDeg > 24) {
        c2[i * 3 + 0] = 0.95 * shade;
        c2[i * 3 + 1] = 0.22 * shade;
        c2[i * 3 + 2] = 0.22 * shade;
      } else if (slopeDeg > 12) {
        c2[i * 3 + 0] = 0.96 * shade;
        c2[i * 3 + 1] = 0.68 * shade;
        c2[i * 3 + 2] = 0.16 * shade;
      } else {
        c2[i * 3 + 0] = 0.18 * shade;
        c2[i * 3 + 1] = 0.82 * shade;
        c2[i * 3 + 2] = 0.56 * shade;
      }

      // Mode 3: Geologic Strata (elevation banding for sedimentary layers)
      const band = (((y + this.centerElevM) % 16) + 16) % 16;
      if (band < 4) {
        c3[i * 3 + 0] = 0.68 * shade;
        c3[i * 3 + 1] = 0.36 * shade;
        c3[i * 3 + 2] = 0.86 * shade;
      } else if (band < 8) {
        c3[i * 3 + 0] = 0.26 * shade;
        c3[i * 3 + 1] = 0.72 * shade;
        c3[i * 3 + 2] = 0.88 * shade;
      } else if (band < 12) {
        c3[i * 3 + 0] = 0.92 * shade;
        c3[i * 3 + 1] = 0.66 * shade;
        c3[i * 3 + 2] = 0.28 * shade;
      } else {
        c3[i * 3 + 0] = 0.78 * shade;
        c3[i * 3 + 1] = 0.42 * shade;
        c3[i * 3 + 2] = 0.34 * shade;
      }

      // Mode 4: Hazards & Radiation Shielding (low-lying sheltered = cyan, flat dust = amber, exposed high = red)
      if (y < -2 && slopeDeg < 10) {
        c4[i * 3 + 0] = 0.2 * shade;
        c4[i * 3 + 1] = 0.82 * shade;
        c4[i * 3 + 2] = 0.92 * shade;
      } else if (slopeDeg < 5) {
        c4[i * 3 + 0] = 0.95 * shade;
        c4[i * 3 + 1] = 0.65 * shade;
        c4[i * 3 + 2] = 0.18 * shade;
      } else if (y > 4) {
        c4[i * 3 + 0] = 0.94 * shade;
        c4[i * 3 + 1] = 0.3 * shade;
        c4[i * 3 + 2] = 0.3 * shade;
      } else {
        c4[i * 3 + 0] = 0.55 * shade;
        c4[i * 3 + 1] = 0.6 * shade;
        c4[i * 3 + 2] = 0.66 * shade;
      }
    }

    this.modeColors = { 1: c1, 2: c2, 3: c3, 4: c4 };
    this.terrainGeom = geom;
    geom.setAttribute("color", new THREE.BufferAttribute(this.modeColors[this.dataMode]!, 3));
    this.rebuildMinimapRelief();

    const regolithTex = createMarsRegolithTexture();
    this.regolithTex = regolithTex;
    const mat = new THREE.MeshStandardMaterial({
      map: regolithTex,
      bumpMap: regolithTex,
      bumpScale: 0.45,
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
    });
    this.terrainMat = mat;

    // Fetch real NASA MDIM + HiRISE satellite tiles for this patch and drape onto terrain
    void this.loadMarsSatelliteTexture(pMinLon, pMaxLon, pMinLat, pMaxLat).then((satTex) => {
      if (!satTex || !this.terrainMat || !this.terrainGeom || !this.modeColors) return;
      this.regolithTex?.dispose();
      this.regolithTex = satTex;
      this.orthoTex = satTex;
      this.terrainMat.map = satTex;
      this.terrainMat.needsUpdate = true;
      this.drawMinimap();

      // Neutralize orange vertex tint in Optical mode so real satellite colors shine
      const c1Arr = this.modeColors[1];
      const normAttr = this.terrainGeom.attributes.normal;
      if (c1Arr && normAttr) {
        for (let i = 0; i < normAttr.count; i++) {
          const nx = normAttr.getX(i);
          const ny = normAttr.getY(i);
          const nz = normAttr.getZ(i);
          const sunDot = Math.max(0.62, nx * 0.5 + ny * 0.72 - nz * 0.4);
          const shade = Math.min(1.08, sunDot * (0.9 + 0.1 * ny));
          c1Arr[i * 3 + 0] = shade;
          c1Arr[i * 3 + 1] = shade;
          c1Arr[i * 3 + 2] = shade;
        }
        if (this.dataMode === 1) {
          this.terrainGeom.setAttribute("color", new THREE.BufferAttribute(c1Arr, 3));
        }
      }
    });

    // Wind-blown Martian dust particles drifting across the visor
    const dustCount = 320;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3 + 0] = (Math.random() - 0.5) * 90;
      dustPos[i * 3 + 1] = Math.random() * 14 - 2;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));

    const pCanvas = document.createElement("canvas");
    pCanvas.width = 32;
    pCanvas.height = 32;
    const pCtx = pCanvas.getContext("2d")!;
    const grad = pCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255, 220, 190, 0.9)");
    grad.addColorStop(1, "rgba(255, 220, 190, 0)");
    pCtx.fillStyle = grad;
    pCtx.fillRect(0, 0, 32, 32);

    const dustMat = new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(pCanvas),
      size: 0.22,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.dustPoints = new THREE.Points(dustGeo, dustMat);
    this.scene.add(this.dustPoints);

    // Stitch & apply real NASA/UArizona HiRISE orbital photography (~1.2m/px) before first render if fast
    const patchMinLon = this.centerLon - half / metersPerDegLon;
    const patchMaxLon = this.centerLon + half / metersPerDegLon;
    const patchMinLat = this.centerLat - half / metersPerDegLat;
    const patchMaxLat = this.centerLat + half / metersPerDegLat;

    const orthoPromise = fetchHiRisePatchTexture(
      patchMinLon,
      patchMaxLon,
      patchMinLat,
      patchMaxLat,
    );

    const orthoTex = await Promise.race([
      orthoPromise,
      new Promise<null>((r) => window.setTimeout(() => r(null), 1800)),
    ]);

    if (orthoTex && !this.disposed) {
      this.orthoTex = orthoTex;
      if (this.dataMode === 1) {
        mat.map = orthoTex;
        mat.bumpMap = orthoTex;
        mat.bumpScale = 0.25;
        mat.needsUpdate = true;
      }
    } else {
      void orthoPromise.then((lateTex) => {
        if (lateTex && !this.disposed) {
          this.orthoTex = lateTex;
          if (this.dataMode === 1) {
            mat.map = lateTex;
            mat.bumpMap = lateTex;
            mat.bumpScale = 0.25;
            mat.needsUpdate = true;
          }
        }
      });
    }

    const terrainMesh = new THREE.Mesh(geom, mat);
    this.scene.add(terrainMesh);

    // Add glowing waypoint beacons for any science waypoints within patch
    this.minimapWaypoints = [];
    for (const wp of waypoints) {
      const wx = (wp.lon - this.centerLon) * metersPerDegLon;
      const wz = -(wp.lat - this.centerLat) * metersPerDegLat;
      if (Math.abs(wx) < half && Math.abs(wz) < half) {
        this.minimapWaypoints.push({
          x: wx,
          z: wz,
          critical: wp.sciencePriority === "CRITICAL",
        });
        const wy = this.getHeightAt(wx, wz);
        const beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.18, 12, 12),
          new THREE.MeshBasicMaterial({
            color: wp.sciencePriority === "CRITICAL" ? 0xc084fc : 0x38bdf8,
            transparent: true,
            opacity: 0.78,
          }),
        );
        beacon.position.set(wx, wy + 6, wz);
        this.scene.add(beacon);

        // Ground halo ring around science target
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.4, 1.85, 28),
          new THREE.MeshBasicMaterial({
            color: wp.sciencePriority === "CRITICAL" ? 0xe879f9 : 0x38bdf8,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.7,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(wx, wy + 0.22, wz);
        this.scene.add(ring);
      }
    }

    // Drape glowing 3D holographic EVA traverse path across terrain (uses real A* path if available)
    const routeNodes: { lon: number; lat: number }[] =
      this.astarPath.length >= 2 ? this.astarPath : waypoints;
    this.minimapRoute = routeNodes.map((n) => ({
      x: (n.lon - this.centerLon) * metersPerDegLon,
      z: -(n.lat - this.centerLat) * metersPerDegLat,
    }));
    this.drawMinimap();
    if (routeNodes.length >= 2) {
      const pathPts: THREE.Vector3[] = [];
      for (let i = 0; i < routeNodes.length - 1; i++) {
        const ax = (routeNodes[i].lon - this.centerLon) * metersPerDegLon;
        const az = -(routeNodes[i].lat - this.centerLat) * metersPerDegLat;
        const bx = (routeNodes[i + 1].lon - this.centerLon) * metersPerDegLon;
        const bz = -(routeNodes[i + 1].lat - this.centerLat) * metersPerDegLat;
        const segDistM = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(6, Math.min(80, Math.ceil(segDistM / 3)));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = ax + (bx - ax) * t;
          const pz = az + (bz - az) * t;
          if (Math.abs(px) < half - 2 && Math.abs(pz) < half - 2) {
            const py = this.getHeightAt(px, pz) + 0.65;
            const last = pathPts[pathPts.length - 1];
            if (!last || last.distanceToSquared(new THREE.Vector3(px, py, pz)) > 0.25) {
              pathPts.push(new THREE.Vector3(px, py, pz));
            }
          }
        }
      }
      if (pathPts.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(pathPts);
        const tubeGeom = new THREE.TubeGeometry(
          curve,
          Math.min(600, Math.max(48, pathPts.length * 2)),
          0.16,
          6,
          false,
        );
        const tubeMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.92,
        });
        this.scene.add(new THREE.Mesh(tubeGeom, tubeMat));

        // Add subtle glowing nav-stakes every ~22m along the visible path
        for (let i = 0; i < pathPts.length; i += 8) {
          const p = pathPts[i];
          const stake = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8),
            new THREE.MeshBasicMaterial({
              color: 0x22d3ee,
              transparent: true,
              opacity: 0.72,
            }),
          );
          stake.position.set(p.x, p.y + 0.25, p.z);
          this.scene.add(stake);
        }
      }
    }

    // Place astronaut at center (0, 0) at 1.8m eye height
    this.camera.position.set(0, this.getHeightAt(0, 0) + 1.8, 0);
  }

  private async loadMarsSatelliteTexture(
    pMinLon: number,
    pMaxLon: number,
    pMinLat: number,
    pMaxLat: number,
  ): Promise<THREE.CanvasTexture | null> {
    try {
      await marsImagery.load();
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 1024;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      let drewAny = false;
      const drawLayerTiles = async (layer: typeof marsImagery, alpha: number, maxStretchRatio: number) => {
        const ti = layer.tileInfo;
        if (!ti?.lods?.length || !ti.origin) return;
        const tileW = ti.size?.[0] ?? 256;
        const tileH = ti.size?.[1] ?? 256;
        const targetRes = (pMaxLon - pMinLon) / 768;
        let lod = ti.lods[ti.lods.length - 1];
        for (const candidate of ti.lods) {
          if (candidate.resolution <= targetRes) {
            lod = candidate;
            break;
          }
        }
        if (lod.resolution > targetRes * maxStretchRatio) return;
        const spanLon = lod.resolution * tileW;
        const spanLat = lod.resolution * tileH;
        const cMin = Math.floor((pMinLon - ti.origin.x) / spanLon);
        const cMax = Math.floor((pMaxLon - ti.origin.x) / spanLon);
        const rMin = Math.floor((ti.origin.y - pMaxLat) / spanLat);
        const rMax = Math.floor((ti.origin.y - pMinLat) / spanLat);

        if ((cMax - cMin + 1) * (rMax - rMin + 1) > 25) return;

        const jobs: Promise<void>[] = [];
        for (let r = rMin; r <= rMax; r++) {
          for (let c = cMin; c <= cMax; c++) {
            const url = layer.getTileUrl(lod.level, r, c);
            if (!url) continue;
            const tileLon0 = ti.origin.x + c * spanLon;
            const tileLat1 = ti.origin.y - r * spanLat;
            const dx = ((tileLon0 - pMinLon) / (pMaxLon - pMinLon)) * canvas.width;
            const dy = ((pMaxLat - tileLat1) / (pMaxLat - pMinLat)) * canvas.height;
            const dw = (spanLon / (pMaxLon - pMinLon)) * canvas.width;
            const dh = (spanLat / (pMaxLat - pMinLat)) * canvas.height;

            jobs.push(
              new Promise<void>((resolve) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.drawImage(img, dx, dy, dw, dh);
                    ctx.restore();
                    drewAny = true;
                  }
                  resolve();
                };
                img.onerror = () => resolve();
                img.src = url;
              }),
            );
          }
        }
        await Promise.all(jobs);
      };

      await drawLayerTiles(marsImagery, 0.72, 16);
      try {
        await marsHiRiseImagery.load();
        await drawLayerTiles(marsHiRiseImagery, 0.85, 6);
      } catch {
        // HiRISE overlay optional outside coverage
      }

      if (!drewAny) return null;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      return tex;
    } catch {
      return null;
    }
  }

  private createRoverMesh(activeSupport: boolean): THREE.Group {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.42,
      metalness: 0.35,
    });
    const goldFoilMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.35,
      metalness: 0.75,
    });
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.85,
      metalness: 0.25,
    });
    const strutMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.5,
      metalness: 0.6,
    });

    // Main chassis ("warm electronics box")
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.65, 2.35), bodyMat);
    chassis.position.set(0, 0.82, 0);
    group.add(chassis);

    // Gold MMRTG / thermal aft pack
    const rtg = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.75), goldFoilMat);
    rtg.position.set(0, 0.9, 1.35);
    group.add(rtg);

    // Mast & MastCam head
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.05, 10), strutMat);
    mast.position.set(0.35, 1.62, -0.75);
    group.add(mast);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.26), bodyMat);
    head.position.set(0.35, 2.15, -0.75);
    group.add(head);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12),
      new THREE.MeshBasicMaterial({ color: activeSupport ? 0x22d3ee : 0x38bdf8 }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0.35, 2.15, -0.89);
    group.add(lens);

    // 6 rocker-bogie wheels
    const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.24, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const zOffsets = [-1.0, 0.0, 1.0];
    for (const side of [-1, 1]) {
      for (const wz of zOffsets) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(side * 1.05, 0.28, wz);
        group.add(w);

        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), strutMat);
        strut.position.set(side * 0.9, 0.55, wz);
        group.add(strut);
      }
    }

    return group;
  }

  private getHeightAt(x: number, z: number): number {
    const half = this.patchSizeM / 2;
    const N = this.segs;
    const u = Math.max(0, Math.min(N - 0.001, ((x + half) / this.patchSizeM) * N));
    const v = Math.max(0, Math.min(N - 0.001, ((z + half) / this.patchSizeM) * N));
    const c0 = Math.floor(u);
    const r0 = Math.floor(v);
    const fx = u - c0;
    const fy = v - r0;
    const h00 = this.heightField[r0 * (N + 1) + c0];
    const h10 = this.heightField[r0 * (N + 1) + c0 + 1];
    const h01 = this.heightField[(r0 + 1) * (N + 1) + c0];
    const h11 = this.heightField[(r0 + 1) * (N + 1) + c0 + 1];
    return h00 + (h10 - h00) * fx + (h01 - h00) * fy + (h00 - h10 - h01 + h11) * fx * fy;
  }

  private rebuildMinimapRelief() {
    const colors = this.modeColors[this.dataMode];
    if (!colors) return;
    const N = this.segs;
    const size = N + 1;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      img.data[i * 4 + 0] = Math.min(255, Math.max(0, Math.round(colors[i * 3 + 0] * 255)));
      img.data[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(colors[i * 3 + 1] * 255)));
      img.data[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(colors[i * 3 + 2] * 255)));
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.minimapReliefCanvas = c;
  }

  public setMinimapCanvas(canvas: HTMLCanvasElement | null) {
    this.minimapCanvas = canvas;
    this.drawMinimap();
  }

  public setLargeMapCanvas(canvas: HTMLCanvasElement | null) {
    this.largeMapCanvas = canvas;
    this.drawLargeMap();
  }

  public addRuntimeWaypoint(lon: number, lat: number, critical = false) {
    const half = this.patchSizeM / 2;
    const metersPerDegLat = (Math.PI * 3389500) / 180;
    const metersPerDegLon = metersPerDegLat * Math.cos((this.centerLat * Math.PI) / 180);
    const wx = (lon - this.centerLon) * metersPerDegLon;
    const wz = -(lat - this.centerLat) * metersPerDegLat;
    this.minimapWaypoints.push({ x: wx, z: wz, critical });
    if (Math.abs(wx) >= half || Math.abs(wz) >= half) {
      this.drawMinimap();
      return;
    }
    const wy = this.getHeightAt(wx, wz);

    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 12, 12),
      new THREE.MeshBasicMaterial({
        color: critical ? 0xc084fc : 0x22d3ee,
        transparent: true,
        opacity: 0.85,
      }),
    );
    beacon.position.set(wx, wy + 6, wz);
    this.scene.add(beacon);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.85, 28),
      new THREE.MeshBasicMaterial({
        color: critical ? 0xe879f9 : 0x22d3ee,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(wx, wy + 0.22, wz);
    this.scene.add(ring);
    this.drawMinimap();
  }

  private drawMinimap() {
    this.drawLargeMap();
    const canvas = this.minimapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1b1411";
    ctx.fillRect(0, 0, w, h);

    // Player-centered scrolling minimap: astronaut is ALWAYS at (w/2, h/2)
    const zoom = 2.0;
    const pxPerM = (w * zoom) / this.patchSizeM;
    const camX = this.camera.position.x;
    const camZ = this.camera.position.z;
    const toX = (wx: number) => w / 2 + (wx - camX) * pxPerM;
    const toY = (wz: number) => h / 2 + (wz - camZ) * pxPerM;

    const half = this.patchSizeM / 2;
    const mapX = toX(-half);
    const mapY = toY(-half);
    const mapSize = this.patchSizeM * pxPerM;

    if (this.minimapReliefCanvas) {
      ctx.drawImage(this.minimapReliefCanvas, mapX, mapY, mapSize, mapSize);
    }

    if (this.dataMode === 1 && this.orthoTex?.image) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.drawImage(this.orthoTex.image as CanvasImageSource, mapX, mapY, mapSize, mapSize);
      ctx.restore();
    }

    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(mapX, mapY, mapSize, mapSize);

    // Scrolling 200m tactical grid
    ctx.strokeStyle = "rgba(56, 189, 248, 0.16)";
    const gridStepM = 200;
    const startX = Math.floor((camX - w / (2 * pxPerM)) / gridStepM) * gridStepM;
    const endX = camX + w / (2 * pxPerM);
    for (let gx = startX; gx <= endX; gx += gridStepM) {
      const cx = toX(gx);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();
    }
    const startZ = Math.floor((camZ - h / (2 * pxPerM)) / gridStepM) * gridStepM;
    const endZ = camZ + h / (2 * pxPerM);
    for (let gz = startZ; gz <= endZ; gz += gridStepM) {
      const cy = toY(gz);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.stroke();
    }

    // Route polyline on minimap
    if (this.minimapRoute.length >= 2) {
      ctx.save();
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      this.minimapRoute.forEach((pt, idx) => {
        const px = toX(pt.x);
        const py = toY(pt.z);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }

    // Waypoint markers
    for (const wp of this.minimapWaypoints) {
      const px = toX(wp.x);
      const py = toY(wp.z);
      ctx.fillStyle = wp.critical ? "#c084fc" : "#38bdf8";
      ctx.beginPath();
      ctx.arc(px, py, 3.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Astronaut ALWAYS centered at (w/2, h/2) with rotating FOV cone
    const ax = w / 2;
    const ay = h / 2;
    const dirAngle = -Math.PI / 2 - this.yaw;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(dirAngle);
    ctx.fillStyle = "rgba(56, 189, 248, 0.28)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 22, -0.45, 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#38bdf8";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ax, ay, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawLargeMap() {
    const canvas = this.largeMapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1b1411";
    ctx.fillRect(0, 0, w, h);

    // Fit bounding square around entire route, all waypoints, and astronaut
    let minX = this.camera.position.x;
    let maxX = this.camera.position.x;
    let minZ = this.camera.position.z;
    let maxZ = this.camera.position.z;
    for (const pt of this.minimapRoute) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }
    for (const wp of this.minimapWaypoints) {
      if (wp.x < minX) minX = wp.x;
      if (wp.x > maxX) maxX = wp.x;
      if (wp.z < minZ) minZ = wp.z;
      if (wp.z > maxZ) maxZ = wp.z;
    }
    const span = Math.min(this.patchSizeM, Math.max(400, (maxX - minX) * 1.25, (maxZ - minZ) * 1.25));
    const half = this.patchSizeM / 2;
    const maxOffset = Math.max(0, half - span / 2);
    const cxWorld = Math.max(-maxOffset, Math.min(maxOffset, (minX + maxX) / 2));
    const czWorld = Math.max(-maxOffset, Math.min(maxOffset, (minZ + maxZ) / 2));
    const toX = (wx: number) => w / 2 + ((wx - cxWorld) / span) * w;
    const toY = (wz: number) => h / 2 + ((wz - czWorld) / span) * h;

    const mapX = toX(-half);
    const mapY = toY(-half);
    const mapSize = (this.patchSizeM / span) * w;

    if (this.minimapReliefCanvas) {
      ctx.drawImage(this.minimapReliefCanvas, mapX, mapY, mapSize, mapSize);
    }

    if (this.dataMode === 1 && this.orthoTex?.image) {
      ctx.save();
      ctx.globalAlpha = 0.48;
      ctx.drawImage(this.orthoTex.image as CanvasImageSource, mapX, mapY, mapSize, mapSize);
      ctx.restore();
    }

    ctx.strokeStyle = "rgba(56, 189, 248, 0.18)";
    ctx.lineWidth = 1;
    const step = w / 8;
    for (let i = 1; i < 8; i++) {
      const p = i * step;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }

    if (this.minimapRoute.length >= 2) {
      ctx.save();
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      this.minimapRoute.forEach((pt, idx) => {
        const px = toX(pt.x);
        const py = toY(pt.z);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }

    this.minimapWaypoints.forEach((wp, idx) => {
      const px = toX(wp.x);
      const py = toY(wp.z);
      ctx.fillStyle = wp.critical ? "#c084fc" : "#0a84ff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "600 10px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(idx + 1), px, py);
    });

    const ax = toX(this.camera.position.x);
    const ay = toY(this.camera.position.z);
    const dirAngle = -Math.PI / 2 - this.yaw;

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(dirAngle);
    ctx.fillStyle = "rgba(48, 209, 88, 0.32)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 34, -0.45, 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#30d158";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ax, ay, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  public setDataMode(mode: 1 | 2 | 3 | 4) {
    this.dataMode = mode;
    this.rebuildMinimapRelief();
    if (this.terrainGeom && this.modeColors[mode]) {
      this.terrainGeom.setAttribute(
        "color",
        new THREE.BufferAttribute(this.modeColors[mode]!, 3),
      );
    }
    if (this.terrainMat) {
      if (mode === 1 && this.orthoTex) {
        this.terrainMat.map = this.orthoTex;
        this.terrainMat.bumpMap = this.orthoTex;
        this.terrainMat.bumpScale = 0.25;
      } else if (this.regolithTex) {
        this.terrainMat.map = this.regolithTex;
        this.terrainMat.bumpMap = this.regolithTex;
        this.terrainMat.bumpScale = 0.45;
      }
      this.terrainMat.needsUpdate = true;
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const modeMatch = e.code.match(/^(?:Digit|Numpad)([1-4])$/);
    if (modeMatch) {
      this.setDataMode(Number(modeMatch[1]) as 1 | 2 | 3 | 4);
    }
    this.keys.add(e.code);
    if (
      [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(e.code)
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent) => {
    this.isDragging = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    if (document.pointerLockElement !== this.renderer.domElement) {
      this.renderer.domElement.requestPointerLock?.();
    }
  };

  private onMouseUp = () => {
    this.isDragging = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    if (!locked && !this.isDragging) return;

    const dx = locked ? e.movementX : e.clientX - this.lastMouseX;
    const dy = locked ? e.movementY : e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    const sensitivity = 0.0026;
    this.yaw -= dx * sensitivity;
    this.pitch = Math.max(
      -Math.PI * 0.44,
      Math.min(Math.PI * 0.44, this.pitch - dy * sensitivity),
    );
  };

  private onResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private bindEvents() {
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("resize", this.onResize);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
  }

  private loop = () => {
    if (this.disposed) return;
    this.animId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // FPS walking on solid terrain (uses e.code so EN & UA layouts both work)
    let forward = 0;
    let strafe = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) forward += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) forward -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) strafe += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) strafe -= 1;

    const curGround = this.getHeightAt(this.camera.position.x, this.camera.position.z);
    const sx = this.getHeightAt(this.camera.position.x + 1, this.camera.position.z) - curGround;
    const sz = this.getHeightAt(this.camera.position.x, this.camera.position.z + 1) - curGround;
    const localSlopeRad = Math.atan(Math.hypot(sx, sz));
    const slopeFactor = Math.max(0.35, 1 - localSlopeRad / 0.75);

    if (forward !== 0 || strafe !== 0) {
      const len = Math.hypot(forward, strafe);
      forward /= len;
      strafe /= len;
      const isSprinting = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
      const baseSpeed = isSprinting ? 28.0 : 14.0;
      const speed = baseSpeed * slopeFactor;
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);

      const moveX = (-sinY * forward + cosY * strafe) * speed * dt;
      const moveZ = (-cosY * forward - sinY * strafe) * speed * dt;

      const limit = this.patchSizeM * 0.48;
      this.camera.position.x = Math.max(-limit, Math.min(limit, this.camera.position.x + moveX));
      this.camera.position.z = Math.max(-limit, Math.min(limit, this.camera.position.z + moveZ));
      this.walkPhase += dt * (isSprinting ? 11.5 : 8.0) * slopeFactor;
    }

    if (this.dustPoints) {
      this.dustPoints.position.x = this.camera.position.x;
      this.dustPoints.position.z = this.camera.position.z;
      this.dustPoints.position.y = this.camera.position.y - 2;
      const dAttr = this.dustPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < dAttr.count; i++) {
        let dx = dAttr.getX(i) + dt * 3.8;
        if (dx > 45) dx = -45;
        dAttr.setX(i, dx);
      }
      dAttr.needsUpdate = true;
    }

    if (this.keys.has("Space") && this.isGrounded) {
      this.verticalVel = 4.6;
      this.isGrounded = false;
    }

    if (!this.isGrounded || this.verticalOffset > 0) {
      this.verticalVel -= 3.72 * dt; // Mars gravity (3.72 m/s²)
      this.verticalOffset += this.verticalVel * dt;
      if (this.verticalOffset <= 0) {
        this.verticalOffset = 0;
        this.verticalVel = 0;
        this.isGrounded = true;
      }
    }

    const groundY = this.getHeightAt(this.camera.position.x, this.camera.position.z);
    const headBob =
      this.isGrounded && (forward !== 0 || strafe !== 0)
        ? Math.sin(this.walkPhase) * 0.035
        : 0;
    this.camera.position.y = groundY + 1.8 + headBob + this.verticalOffset;
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Rover companion smoothly follows astronaut when Rover Support mode is active
    if (this.roverGroup && this.roverSupport) {
      const targetRx = this.camera.position.x + Math.cos(this.yaw) * 6.5 + Math.sin(this.yaw) * 5.0;
      const targetRz = this.camera.position.z - Math.sin(this.yaw) * 6.5 + Math.cos(this.yaw) * 5.0;
      const dx = targetRx - this.roverGroup.position.x;
      const dz = targetRz - this.roverGroup.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.6) {
        const step = Math.min(dist, dt * 3.8);
        this.roverGroup.position.x += (dx / dist) * step;
        this.roverGroup.position.z += (dz / dist) * step;
        this.roverGroup.rotation.y = Math.atan2(-dx, -dz);
      }
      this.roverGroup.position.y = this.getHeightAt(
        this.roverGroup.position.x,
        this.roverGroup.position.z,
      );
    }

    if (this.skyDome) {
      this.skyDome.position.copy(this.camera.position);
    }

    this.renderer.render(this.scene, this.camera);

    this.frameCounter++;
    if (this.frameCounter % 2 === 0) {
      this.drawMinimap();
    }
    if (this.frameCounter % 10 === 0) {
      const hx = this.getHeightAt(this.camera.position.x + 1, this.camera.position.z) - groundY;
      const hz = this.getHeightAt(this.camera.position.x, this.camera.position.z + 1) - groundY;
      const slopeDeg = Math.round((Math.atan(Math.hypot(hx, hz)) * 180) / Math.PI);
      const headingDeg = Math.round((((-this.yaw * 180) / Math.PI) % 360 + 360) % 360);
      this.onTelemetry({
        elevM: Math.round(this.centerElevM + groundY),
        slopeDeg,
        headingDeg,
        offsetNorthM: Math.round(-this.camera.position.z),
        offsetEastM: Math.round(this.camera.position.x),
        pointerLocked: document.pointerLockElement === this.renderer.domElement,
        resolutionMode: this.resolutionMode,
        dataMode: this.dataMode,
      });
    }
  };

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animId);
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize", this.onResize);
    this.renderer.domElement.removeEventListener("mousedown", this.onMouseDown);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
