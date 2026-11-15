import { ensureHiRiseData } from "./SurfacePovEngine";
import { marsDistanceMeters } from "./evaPhysics";
import type { ScienceWaypoint } from "./jezeroDataset";

export interface DtmSample {
  elevM: number;
  slopeDeg: number;
  skyShieldingPct: number;
  fromRealDtm: boolean;
}

export interface PathNodePoint {
  lon: number;
  lat: number;
  elevM: number;
  slopeDeg: number;
  distFromStartM: number;
}

export interface TerrainRouteAnalysis {
  pathPoints: PathNodePoint[];
  totalDistanceM: number;
  elevationGainM: number;
  maxSlopeDeg: number;
  losClear: boolean;
  losObstructionM: number;
  usedRealDtm: boolean;
}

const MARS_RADIUS_M = 3389500;
const M_PER_DEG_LAT = (Math.PI * MARS_RADIUS_M) / 180;

function sampleGridBilinear(
  grid: Float32Array,
  meta: { width: number; height: number; minLon: number; maxLon: number; minLat: number; maxLat: number },
  lon: number,
  lat: number,
): number {
  const u = Math.max(0, Math.min(1, (lon - meta.minLon) / (meta.maxLon - meta.minLon)));
  const v = Math.max(0, Math.min(1, (meta.maxLat - lat) / (meta.maxLat - meta.minLat)));
  const gx = u * (meta.width - 1);
  const gy = v * (meta.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(meta.width - 1, x0 + 1);
  const y1 = Math.min(meta.height - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;

  const h00 = grid[y0 * meta.width + x0];
  const h10 = grid[y0 * meta.width + x1];
  const h01 = grid[y1 * meta.width + x0];
  const h11 = grid[y1 * meta.width + x1];
  return h00 + (h10 - h00) * fx + (h01 - h00) * fy + (h00 - h10 - h01 + h11) * fx * fy;
}

function getLocalSlopeDeg(
  grid: Float32Array,
  meta: { width: number; height: number; minLon: number; maxLon: number; minLat: number; maxLat: number },
  lon: number,
  lat: number,
): { elevM: number; slopeDeg: number } {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLon = 2 / mPerDegLon; // 2m step
  const dLat = 2 / M_PER_DEG_LAT;
  const hC = sampleGridBilinear(grid, meta, lon, lat);
  const hE = sampleGridBilinear(grid, meta, lon + dLon, lat);
  const hW = sampleGridBilinear(grid, meta, lon - dLon, lat);
  const hN = sampleGridBilinear(grid, meta, lon, lat + dLat);
  const hS = sampleGridBilinear(grid, meta, lon, lat - dLat);
  const dzdx = (hE - hW) / 4;
  const dzdy = (hN - hS) / 4;
  const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  return { elevM: hC, slopeDeg };
}

/**
 * Samples real elevation, local slope, and 8-ray horizon sky-shielding from HiRISE 1m DTM.
 */
export async function sampleDtmPoint(lon: number, lat: number): Promise<DtmSample> {
  const dtm = await ensureHiRiseData(lon, lat);
  if (!dtm) {
    return { elevM: -2500, slopeDeg: 5, skyShieldingPct: 15, fromRealDtm: false };
  }
  const { meta, grid } = dtm;
  const { elevM, slopeDeg } = getLocalSlopeDeg(grid, meta, lon, lat);

  // 8-direction horizon elevation angle check (25m, 65m, 130m) for radiation sky-shielding
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  let blockedFractionSum = 0;
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4;
    let maxElevAng = 0;
    for (const dist of [25, 65, 130]) {
      const rLon = lon + (Math.cos(ang) * dist) / mPerDegLon;
      const rLat = lat + (Math.sin(ang) * dist) / M_PER_DEG_LAT;
      const hR = sampleGridBilinear(grid, meta, rLon, rLat);
      const elevAng = Math.max(0, Math.atan2(hR - elevM, dist));
      if (elevAng > maxElevAng) maxElevAng = elevAng;
    }
    // Convert max horizon angle (0..PI/2) to hemisphere occlusion contribution
    blockedFractionSum += Math.sin(maxElevAng);
  }
  const skyShieldingPct = Math.min(85, Math.max(10, Math.round((blockedFractionSum / 8) * 100 + 8)));

  return {
    elevM: Math.round(elevM),
    slopeDeg: Number(slopeDeg.toFixed(1)),
    skyShieldingPct,
    fromRealDtm: true,
  };
}

/**
 * Checks direct UHF radio Line-of-Sight between two coordinates over the 1m DTM.
 */
export async function computeLineOfSight(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
  antennaHeightM = 2.5,
): Promise<{ clear: boolean; maxObstructionM: number }> {
  const dtm = await ensureHiRiseData(lon1, lat1);
  if (!dtm) return { clear: true, maxObstructionM: 0 };
  const { meta, grid } = dtm;
  const h1 = sampleGridBilinear(grid, meta, lon1, lat1) + antennaHeightM;
  const h2 = sampleGridBilinear(grid, meta, lon2, lat2) + 1.8;

  let maxObstructionM = 0;
  const steps = 48;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const lon = lon1 + (lon2 - lon1) * t;
    const lat = lat1 + (lat2 - lat1) * t;
    const terrainH = sampleGridBilinear(grid, meta, lon, lat);
    const rayH = h1 + (h2 - h1) * t;
    const diff = terrainH - rayH;
    if (diff > maxObstructionM) maxObstructionM = diff;
  }

  return {
    clear: maxObstructionM <= 0.5,
    maxObstructionM: Math.round(maxObstructionM),
  };
}

/**
 * Runs A* terrain pathfinding over HiRISE 1m DTM between consecutive waypoints,
 * routing around steep scarps (> maxSlopeDeg) and minimizing climb cost.
 */
export async function findAStarTerrainPath(
  waypoints: ScienceWaypoint[],
  maxSlopeDeg = 22,
): Promise<TerrainRouteAnalysis> {
  if (waypoints.length < 2) {
    return {
      pathPoints: waypoints.map((w) => ({
        lon: w.lon,
        lat: w.lat,
        elevM: w.elevationM,
        slopeDeg: w.slopeDeg,
        distFromStartM: 0,
      })),
      totalDistanceM: 0,
      elevationGainM: 0,
      maxSlopeDeg: 0,
      losClear: true,
      losObstructionM: 0,
      usedRealDtm: false,
    };
  }

  const dtm = await ensureHiRiseData(waypoints[0].lon, waypoints[0].lat);
  if (!dtm) {
    // Straight-line fallback if outside 1m DTM coverage
    const pts: PathNodePoint[] = [];
    let distAcc = 0;
    for (let i = 0; i < waypoints.length; i++) {
      if (i > 0) {
        distAcc += marsDistanceMeters(waypoints[i - 1].lon, waypoints[i - 1].lat, waypoints[i].lon, waypoints[i].lat);
      }
      pts.push({
        lon: waypoints[i].lon,
        lat: waypoints[i].lat,
        elevM: waypoints[i].elevationM,
        slopeDeg: waypoints[i].slopeDeg,
        distFromStartM: Math.round(distAcc),
      });
    }
    return {
      pathPoints: pts,
      totalDistanceM: Math.round(distAcc),
      elevationGainM: 0,
      maxSlopeDeg: Math.max(...waypoints.map((w) => w.slopeDeg)),
      losClear: true,
      losObstructionM: 0,
      usedRealDtm: false,
    };
  }

  const { meta, grid } = dtm;
  const allPoints: PathNodePoint[] = [];
  let totalDist = 0;
  let elevGain = 0;
  let globalMaxSlope = 0;

  for (let segIdx = 0; segIdx < waypoints.length - 1; segIdx++) {
    const a = waypoints[segIdx];
    const b = waypoints[segIdx + 1];
    const segPts = runAStarSegment(grid, meta, a.lon, a.lat, b.lon, b.lat, maxSlopeDeg);

    for (let k = segIdx === 0 ? 0 : 1; k < segPts.length; k++) {
      const p = segPts[k];
      if (allPoints.length > 0) {
        const prev = allPoints[allPoints.length - 1];
        const d = marsDistanceMeters(prev.lon, prev.lat, p.lon, p.lat);
        totalDist += d;
        if (p.elevM > prev.elevM) elevGain += p.elevM - prev.elevM;
      }
      if (p.slopeDeg > globalMaxSlope) globalMaxSlope = p.slopeDeg;
      allPoints.push({
        ...p,
        distFromStartM: Math.round(totalDist),
      });
    }
  }

  const lastWp = waypoints[waypoints.length - 1];
  const los = await computeLineOfSight(waypoints[0].lon, waypoints[0].lat, lastWp.lon, lastWp.lat);

  return {
    pathPoints: allPoints,
    totalDistanceM: Math.round(totalDist),
    elevationGainM: Math.round(elevGain),
    maxSlopeDeg: Number(globalMaxSlope.toFixed(1)),
    losClear: los.clear,
    losObstructionM: los.maxObstructionM,
    usedRealDtm: true,
  };
}

function runAStarSegment(
  grid: Float32Array,
  meta: { width: number; height: number; minLon: number; maxLon: number; minLat: number; maxLat: number },
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
  maxSlopeDeg: number,
): Array<{ lon: number; lat: number; elevM: number; slopeDeg: number }> {
  const midLat = (latA + latB) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const segDistM = Math.hypot((lonB - lonA) * mPerDegLon, (latB - latA) * M_PER_DEG_LAT);
  const padM = Math.min(1100, Math.max(480, segDistM * 0.45));
  const padDegLon = padM / mPerDegLon;
  const padDegLat = padM / M_PER_DEG_LAT;

  const minLon = Math.max(meta.minLon, Math.min(lonA, lonB) - padDegLon);
  const maxLon = Math.min(meta.maxLon, Math.max(lonA, lonB) + padDegLon);
  const minLat = Math.max(meta.minLat, Math.min(latA, latB) - padDegLat);
  const maxLat = Math.min(meta.maxLat, Math.max(latA, latB) + padDegLat);

  const spanX = Math.max(20, (maxLon - minLon) * mPerDegLon);
  const spanY = Math.max(20, (maxLat - minLat) * M_PER_DEG_LAT);
  const cols = 108;
  const rows = 108;
  const cellW = spanX / (cols - 1);
  const cellH = spanY / (rows - 1);

  const elev = new Float32Array(cols * rows);
  let minWindowElev = Infinity;
  for (let r = 0; r < rows; r++) {
    const lat = maxLat - (r / (rows - 1)) * (maxLat - minLat);
    for (let c = 0; c < cols; c++) {
      const lon = minLon + (c / (cols - 1)) * (maxLon - minLon);
      const h = sampleGridBilinear(grid, meta, lon, lat);
      elev[r * cols + c] = h;
      if (h < minWindowElev) minWindowElev = h;
    }
  }

  // True 2D terrain slope at every cell (prevents side-hill traversing along steep cliffs)
  const trueSlope = new Float32Array(cols * rows);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const dzdx = (elev[r * cols + (c + 1)] - elev[r * cols + (c - 1)]) / (2 * cellW);
      const dzdy = (elev[(r + 1) * cols + c] - elev[(r - 1) * cols + c]) / (2 * cellH);
      trueSlope[r * cols + c] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  }

  const toCol = (lon: number) => Math.max(0, Math.min(cols - 1, Math.round(((lon - minLon) / (maxLon - minLon)) * (cols - 1))));
  const toRow = (lat: number) => Math.max(0, Math.min(rows - 1, Math.round(((maxLat - lat) / (maxLat - minLat)) * (rows - 1))));

  const sc = toCol(lonA);
  const sr = toRow(latA);
  const gc = toCol(lonB);
  const gr = toRow(latB);
  const startIdx = sr * cols + sc;
  const goalIdx = gr * cols + gc;

  const total = cols * rows;
  const gScore = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  gScore[startIdx] = 0;

  // Simple binary min-heap for fast A*
  const heapIdx: number[] = [startIdx];
  const heapF: number[] = [Math.hypot((gc - sc) * cellW, (gr - sr) * cellH)];

  const pushHeap = (idx: number, f: number) => {
    heapIdx.push(idx);
    heapF.push(f);
    let i = heapIdx.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= heapF[i]) break;
      [heapIdx[p], heapIdx[i]] = [heapIdx[i], heapIdx[p]];
      [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
      i = p;
    }
  };

  const popHeap = (): number => {
    const top = heapIdx[0];
    const lastIdx = heapIdx.pop()!;
    const lastF = heapF.pop()!;
    if (heapIdx.length > 0) {
      heapIdx[0] = lastIdx;
      heapF[0] = lastF;
      let i = 0;
      const n = heapIdx.length;
      while (true) {
        let best = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < n && heapF[l] < heapF[best]) best = l;
        if (r < n && heapF[r] < heapF[best]) best = r;
        if (best === i) break;
        [heapIdx[i], heapIdx[best]] = [heapIdx[best], heapIdx[i]];
        [heapF[i], heapF[best]] = [heapF[best], heapF[i]];
        i = best;
      }
    }
    return top;
  };

  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];

  while (heapIdx.length > 0) {
    const cur = popHeap();
    if (cur === goalIdx) break;
    if (closed[cur]) continue;
    closed[cur] = 1;

    const cr = Math.floor(cur / cols);
    const cc = cur % cols;
    const hCur = elev[cur];

    for (const [dc, dr] of dirs) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nIdx = nr * cols + nc;
      if (closed[nIdx]) continue;

      const stepDist = Math.hypot(dc * cellW, dr * cellH);
      const dh = elev[nIdx] - hCur;
      const stepSlopeDeg = (Math.atan2(Math.abs(dh), stepDist) * 180) / Math.PI;
      const slopeDeg = Math.max(stepSlopeDeg, trueSlope[nIdx]);

      // Strongly prefer flat valley floors and treat steep cliffs/descents as impassable
      let slopePenalty = 1;
      if (slopeDeg > maxSlopeDeg) {
        slopePenalty = 500 + (slopeDeg - maxSlopeDeg) * 80;
      } else if (slopeDeg > maxSlopeDeg * 0.6) {
        slopePenalty = 6.5;
      } else if (slopeDeg > 4) {
        const excess = (slopeDeg - 4) / 6;
        slopePenalty = 1 + excess * excess * 1.6;
      }
      const climbCost = dh > 0 ? dh * 8.0 : Math.abs(dh) * 5.2;
      const ridgeBias = Math.max(0, elev[nIdx] - minWindowElev) * 0.65;
      const tentativeG = gScore[cur] + stepDist * slopePenalty + climbCost + ridgeBias;

      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = cur;
        gScore[nIdx] = tentativeG;
        const hEst = Math.hypot((gc - nc) * cellW, (gr - nr) * cellH);
        pushHeap(nIdx, tentativeG + hEst);
      }
    }
  }

  // Reconstruct path
  const rawIdx: number[] = [];
  let cur = goalIdx;
  if (cameFrom[cur] === -1 && cur !== startIdx) {
    rawIdx.push(goalIdx, startIdx);
  } else {
    while (cur !== -1) {
      rawIdx.push(cur);
      if (cur === startIdx) break;
      cur = cameFrom[cur];
    }
  }
  rawIdx.reverse();

  // Decimate slightly if very dense while preserving bends
  return rawIdx.map((idx, i) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const lon = i === 0 ? lonA : i === rawIdx.length - 1 ? lonB : minLon + (c / (cols - 1)) * (maxLon - minLon);
    const lat = i === 0 ? latA : i === rawIdx.length - 1 ? latB : maxLat - (r / (rows - 1)) * (maxLat - minLat);
    const { elevM, slopeDeg } = getLocalSlopeDeg(grid, meta, lon, lat);
    return { lon, lat, elevM: Math.round(elevM), slopeDeg: Number(slopeDeg.toFixed(1)) };
  });
}
