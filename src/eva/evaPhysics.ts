import type { HazardZone, ScienceWaypoint } from "./jezeroDataset";

const MARS_RADIUS_M = 3389500;
const PLSS_MAX_OXYGEN_MIN = 480; // 8-hour xEMU primary + reserve O2
const BASE_WALK_SPEED_MS = 1.05; // ~3.8 km/h in pressurized xEMU suit
const BASE_ROVER_SPEED_MS = 2.4; // ~8.6 km/h Pressurized Utility Rover

export type CrisisMode = "nominal" | "spe_storm" | "dust_storm";
export type TransportMode = "foot" | "rover";

export interface RouteSegmentMetrics {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  distanceM: number;
  elevationDeltaM: number;
  slopeDeg: number;
  durationMin: number;
  o2CostMin: number;
  hazardLevel: "safe" | "caution" | "danger";
}

export interface EvaRouteSummary {
  segments: RouteSegmentMetrics[];
  totalDistanceM: number;
  totalElevationGainM: number;
  maxSlopeDeg: number;
  totalDurationMin: number;
  o2UsedMin: number;
  o2RemainingMin: number;
  o2RemainingPct: number;
  batteryRemainingPct: number;
  estimatedDoseUsv: number;
  walkBackSafe: boolean;
  safetyStatus: "GO" | "CAUTION" | "ABORT / SHELTER";
  recommendedAction: string;
}

export function marsDistanceMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluateEvaRoute(
  waypoints: ScienceWaypoint[],
  crisisMode: CrisisMode,
  scienceStopMinutesPerWaypoint = 18,
  transportMode: TransportMode = "foot",
): EvaRouteSummary {
  if (waypoints.length < 2) {
    return {
      segments: [],
      totalDistanceM: 0,
      totalElevationGainM: 0,
      maxSlopeDeg: 0,
      totalDurationMin: 0,
      o2UsedMin: 0,
      o2RemainingMin: PLSS_MAX_OXYGEN_MIN,
      o2RemainingPct: 100,
      batteryRemainingPct: 100,
      estimatedDoseUsv: 0,
      walkBackSafe: true,
      safetyStatus: crisisMode === "nominal" ? "GO" : "CAUTION",
      recommendedAction: "Select at least 2 waypoints to compute EVA logistics.",
    };
  }

  const segments: RouteSegmentMetrics[] = [];
  let totalDistanceM = 0;
  let totalElevationGainM = 0;
  let maxSlopeDeg = 0;
  let totalDurationMin = 0;
  let o2UsedMin = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const distanceM = marsDistanceMeters(a.lon, a.lat, b.lon, b.lat);
    const elevationDeltaM = b.elevationM - a.elevationM;
    const avgSlope = Math.max(
      (a.slopeDeg + b.slopeDeg) / 2,
      (Math.atan2(Math.abs(elevationDeltaM), Math.max(distanceM, 1)) * 180) /
        Math.PI,
    );

    // Terrain & crisis speed penalties
    const sandPenalty =
      a.thermalInertia < 260 || b.thermalInertia < 260
        ? transportMode === "rover"
          ? 1.55
          : 1.35
        : 1.0;
    const dustPenalty = crisisMode === "dust_storm" ? 1.4 : 1.0;
    const slopeSpeedFactor = Math.max(0.38, 1 - avgSlope / 38);
    const baseSpeed = transportMode === "rover" ? BASE_ROVER_SPEED_MS : BASE_WALK_SPEED_MS;
    const effectiveSpeed =
      (baseSpeed * slopeSpeedFactor) / (sandPenalty * dustPenalty);

    const walkMin = distanceM / effectiveSpeed / 60;
    const stopMin = i < waypoints.length - 1 ? scienceStopMinutesPerWaypoint : 0;
    const durationMin = walkMin + stopMin;

    // Metabolic O2 multiplier: uphill + loose sand + high slope increase O2 burn; rover cuts traverse O2 burn
    const uphillMultiplier =
      elevationDeltaM > 0 ? 1 + (elevationDeltaM / Math.max(distanceM, 20)) * 2.2 : 0.95;
    const transportO2Factor = transportMode === "rover" ? 0.52 : 1.0;
    const o2CostMin =
      walkMin * uphillMultiplier * sandPenalty * transportO2Factor + stopMin * 0.85;

    let hazardLevel: "safe" | "caution" | "danger" = "safe";
    if (avgSlope > 18) hazardLevel = "danger";
    else if (avgSlope > 11 || sandPenalty > 1.1) hazardLevel = "caution";

    segments.push({
      fromId: a.id,
      toId: b.id,
      fromName: a.name,
      toName: b.name,
      distanceM: Math.round(distanceM),
      elevationDeltaM: Math.round(elevationDeltaM),
      slopeDeg: Number(avgSlope.toFixed(1)),
      durationMin: Number(durationMin.toFixed(1)),
      o2CostMin: Number(o2CostMin.toFixed(1)),
      hazardLevel,
    });

    totalDistanceM += distanceM;
    if (elevationDeltaM > 0) totalElevationGainM += elevationDeltaM;
    if (avgSlope > maxSlopeDeg) maxSlopeDeg = avgSlope;
    totalDurationMin += durationMin;
    o2UsedMin += o2CostMin;
  }

  const o2RemainingMin = Math.max(0, PLSS_MAX_OXYGEN_MIN - o2UsedMin);
  const o2RemainingPct = Math.round((o2RemainingMin / PLSS_MAX_OXYGEN_MIN) * 100);
  const thermalDrain = crisisMode === "dust_storm" ? 1.32 : 1.0;
  const batteryRemainingPct = Math.max(
    5,
    Math.round(100 - (totalDurationMin / 460) * 100 * thermalDrain),
  );

  // Radiation dose calculation (GCR baseline ~26.7 uSv/hr; SPE multiplies by 18x unless shielded)
  const avgShielding =
    waypoints.reduce((acc, w) => acc + w.radiationShieldingPct, 0) /
    waypoints.length /
    100;
  const baseRateUsvPerHr = crisisMode === "spe_storm" ? 480 : 26.7;
  const effectiveRate = baseRateUsvPerHr * (1 - avgShielding * 0.85);
  const estimatedDoseUsv = Math.round((totalDurationMin / 60) * effectiveRate);

  const walkBackSafe = o2RemainingPct >= 30 && batteryRemainingPct >= 25;

  let safetyStatus: "GO" | "CAUTION" | "ABORT / SHELTER" = "GO";
  let recommendedAction =
    "All PLSS & terrain parameters nominal. Proceed with science sampling.";

  if (crisisMode === "spe_storm") {
    safetyStatus = "ABORT / SHELTER";
    recommendedAction =
      "SOLAR PARTICLE EVENT! Divert immediately to Kodiak Butte Shelter (47% sky shielding).";
  } else if (!walkBackSafe || maxSlopeDeg > 20) {
    safetyStatus = "CAUTION";
    recommendedAction =
      maxSlopeDeg > 20
        ? "Steep slope (>20°) detected. Use Utility Rover winch or reroute along delta bench."
        : "O2 margin below 30% walk-back reserve. Trim science stops.";
  } else if (crisisMode === "dust_storm") {
    safetyStatus = "CAUTION";
    recommendedAction =
      "High dust optical depth (τ = 2.85). Activate Visor HUD Nav-Beacon & return to Hab.";
  }

  return {
    segments,
    totalDistanceM: Math.round(totalDistanceM),
    totalElevationGainM: Math.round(totalElevationGainM),
    maxSlopeDeg: Number(maxSlopeDeg.toFixed(1)),
    totalDurationMin: Math.round(totalDurationMin),
    o2UsedMin: Math.round(o2UsedMin),
    o2RemainingMin: Math.round(o2RemainingMin),
    o2RemainingPct,
    batteryRemainingPct,
    estimatedDoseUsv,
    walkBackSafe,
    safetyStatus,
    recommendedAction,
  };
}

function segmentCrossesHazard(
  a: ScienceWaypoint,
  b: ScienceWaypoint,
  hazardZones: HazardZone[],
): number {
  let penalty = 0;
  const steps = 6;
  for (const hz of hazardZones) {
    if (hz.type !== "slope" && hz.type !== "sand") continue;
    const ring = hz.rings[0];
    if (!ring || ring.length < 3) continue;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const lon = a.lon + (b.lon - a.lon) * t;
      const lat = a.lat + (b.lat - a.lat) * t;
      if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) {
        penalty += hz.type === "slope" ? 1800 : 850;
      }
    }
  }
  return penalty;
}

/**
 * Greedy nearest-safe-neighbor route optimizer that keeps the starting Hab fixed
 * and orders science stops to minimize distance, steep slope, and sand-trap crossings.
 */
export function optimizeSafeRoute(
  waypoints: ScienceWaypoint[],
  hazardZones: HazardZone[],
): ScienceWaypoint[] {
  if (waypoints.length <= 2) return [...waypoints];

  const ordered: ScienceWaypoint[] = [waypoints[0]];
  const remaining = waypoints.slice(1);

  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestCost = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const dist = marsDistanceMeters(current.lon, current.lat, cand.lon, cand.lat);
      const climb = Math.max(0, cand.elevationM - current.elevationM) * 3.5;
      const slopeCost = cand.slopeDeg > 16 ? (cand.slopeDeg - 16) * 140 : 0;
      const hazardCost = segmentCrossesHazard(current, cand, hazardZones);
      const totalCost = dist + climb + slopeCost + hazardCost;
      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestIdx = i;
      }
    }

    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }

  return ordered;
}
