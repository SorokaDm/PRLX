import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import type SceneView from "@arcgis/core/views/SceneView";
import { marsSR } from "../utilities/layers";
import {
  JEZERO_HAZARD_ZONES,
  type HazardZone,
  type ScienceWaypoint,
} from "./jezeroDataset";
import { HIGH_DETAIL_ZONES } from "./highDetailZones";
import type { RouteSegmentMetrics } from "./evaPhysics";
import type { PathNodePoint } from "./dtmAnalyzer";
import { ensureHiRiseData } from "./SurfacePovEngine";

export interface LayerToggles {
  hiResZones: boolean;
  slopeHazards: boolean;
  thermalSandTraps: boolean;
  crismMineralogy: boolean;
  radiationShelters: boolean;
  evaRoute: boolean;
}

export class EvaOverlayManager {
  public terrainModeLayer: GraphicsLayer;
  public hiResZoneLayer: GraphicsLayer;
  public hazardLayer: GraphicsLayer;
  public routeLayer: GraphicsLayer;
  public waypointLayer: GraphicsLayer;
  private attachedView: SceneView | null = null;
  private currentHazardZones: HazardZone[] = JEZERO_HAZARD_ZONES;

  constructor() {
    this.terrainModeLayer = new GraphicsLayer({
      id: "evaTerrainModeLayer",
      title: "HiRISE 1m DTM Analysis Overlay",
      elevationInfo: { mode: "on-the-ground" },
    });

    this.hiResZoneLayer = new GraphicsLayer({
      id: "evaHiResZoneLayer",
      title: "HiRISE 1m High-Detail Coverage Zones",
      elevationInfo: { mode: "on-the-ground" },
    });

    this.hazardLayer = new GraphicsLayer({
      id: "evaHazardLayer",
      title: "NASA EVA Hazards & Science Layers",
      elevationInfo: { mode: "on-the-ground" },
    });

    this.routeLayer = new GraphicsLayer({
      id: "evaRouteLayer",
      title: "EVA Traverse Route",
      elevationInfo: { mode: "on-the-ground" },
    });

    this.waypointLayer = new GraphicsLayer({
      id: "evaWaypointLayer",
      title: "EVA Science Waypoints",
      elevationInfo: { mode: "relative-to-ground" },
    });
  }

  public attachToView(view: SceneView) {
    if (this.attachedView === view || !view.map) return;
    this.attachedView = view;
    if (!view.map.findLayerById(this.hazardLayer.id)) {
      view.map.addMany([
        this.terrainModeLayer,
        this.hiResZoneLayer,
        this.hazardLayer,
        this.routeLayer,
        this.waypointLayer,
      ]);
    }
  }

  public async updateTerrainModeHeatmap(
    mode: 1 | 2 | 3 | 4,
    centerLon: number,
    centerLat: number,
  ): Promise<void> {
    this.terrainModeLayer.removeAll();
    if (mode === 1) return;

    const dtm = await ensureHiRiseData(centerLon, centerLat);
    if (!dtm) return;

    const { meta, grid } = dtm;
    const cols = 24;
    const rows = 24;
    const dLon = (meta.maxLon - meta.minLon) / cols;
    const dLat = (meta.maxLat - meta.minLat) / rows;
    const mPerDegLat = (Math.PI * 3389500) / 180;
    const mPerDegLon = mPerDegLat * Math.cos((((meta.minLat + meta.maxLat) / 2) * Math.PI) / 180);
    const cellWidthM = dLon * mPerDegLon;
    const cellHeightM = dLat * mPerDegLat;

    let minH = Infinity;
    let maxH = -Infinity;
    const samples: { r: number; c: number; h: number; slope: number }[] = [];

    for (let r = 0; r < rows; r++) {
      const gy = Math.min(meta.height - 2, Math.max(1, Math.floor(((r + 0.5) / rows) * meta.height)));
      for (let c = 0; c < cols; c++) {
        const gx = Math.min(meta.width - 2, Math.max(1, Math.floor(((c + 0.5) / cols) * meta.width)));
        const h = grid[gy * meta.width + gx];
        const hE = grid[gy * meta.width + (gx + 1)];
        const hW = grid[gy * meta.width + (gx - 1)];
        const hN = grid[(gy - 1) * meta.width + gx];
        const hS = grid[(gy + 1) * meta.width + gx];
        const stepX = (2 * (meta.maxLon - meta.minLon) * mPerDegLon) / meta.width;
        const stepY = (2 * (meta.maxLat - meta.minLat) * mPerDegLat) / meta.height;
        const dzdx = (hE - hW) / Math.max(1, stepX);
        const dzdy = (hN - hS) / Math.max(1, stepY);
        const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        samples.push({ r, c, h, slope });
      }
    }

    const spanH = Math.max(1, maxH - minH);
    const graphics: Graphic[] = [];

    for (const s of samples) {
      const t = (s.h - minH) / spanH;
      let color: [number, number, number, number] = [0, 0, 0, 0];

      if (mode === 2) {
        if (s.slope > 24) color = [239, 68, 68, 0.55];
        else if (s.slope > 15) color = [245, 158, 11, 0.44];
        else if (s.slope > 8) color = [250, 204, 21, 0.28];
        else color = [34, 197, 94, 0.14];
      } else if (mode === 3) {
        if (t < 0.28) color = [56, 189, 248, 0.36];
        else if (t < 0.55) color = [168, 85, 247, 0.32];
        else if (t < 0.78) color = [244, 114, 182, 0.3];
        else color = [251, 146, 60, 0.34];
      } else if (mode === 4) {
        if (t > 0.72) color = [239, 68, 68, 0.42];
        else if (t < 0.36 && s.slope < 5) color = [245, 158, 11, 0.4];
        else if (s.slope >= 10 && t < 0.58) color = [34, 211, 238, 0.38];
        else color = [100, 116, 139, 0.1];
      }

      const lon0 = meta.minLon + s.c * dLon;
      const lon1 = lon0 + dLon;
      const lat1 = meta.maxLat - s.r * dLat;
      const lat0 = lat1 - dLat;

      graphics.push(
        new Graphic({
          geometry: new Polygon({
            rings: [
              [
                [lon0, lat1],
                [lon1, lat1],
                [lon1, lat0],
                [lon0, lat0],
                [lon0, lat1],
              ],
            ],
            spatialReference: marsSR,
          }),
          symbol: {
            type: "simple-fill",
            color,
            outline: { width: 0 },
          } as any,
          attributes: {
            elevM: Math.round(s.h),
            slopeDeg: s.slope.toFixed(1),
            cellM: `${Math.round(cellWidthM)}×${Math.round(cellHeightM)}m`,
          },
        }),
      );
    }

    this.terrainModeLayer.addMany(graphics);
  }

  public updateHazards(
    toggles: LayerToggles,
    hazardZones?: HazardZone[],
  ) {
    if (hazardZones) {
      this.currentHazardZones = hazardZones;
    }
    this.hiResZoneLayer.removeAll();
    if (toggles.hiResZones) {
      for (const hz of HIGH_DETAIL_ZONES) {
        const [minLon, minLat, maxLon, maxLat] = hz.bounds;
        const rawRing = hz.footprint ?? [
          [minLon, maxLat],
          [maxLon, maxLat],
          [maxLon, minLat],
          [minLon, minLat],
          [minLon, maxLat],
        ];
        // Ensure clockwise winding for ArcGIS Polygon exterior ring
        let area2 = 0;
        for (let i = 0; i < rawRing.length - 1; i++) {
          const [x1, y1] = rawRing[i];
          const [x2, y2] = rawRing[i + 1];
          area2 += (x2 - x1) * (y2 + y1);
        }
        const ring = area2 < 0 ? [...rawRing].reverse() : rawRing;

        const box = new Polygon({
          rings: [ring],
          spatialReference: marsSR,
        });

        const fillColor = hz.isHyperlocalDtm
          ? [16, 185, 129, 0.12]
          : [56, 189, 248, 0.08];
        const strokeColor = hz.isHyperlocalDtm
          ? [52, 211, 153, 0.95]
          : [56, 189, 248, 0.9];

        this.hiResZoneLayer.add(
          new Graphic({
            geometry: box,
            symbol: {
              type: "simple-fill",
              color: fillColor,
              outline: {
                color: strokeColor,
                width: 2.2,
                style: "dash",
              },
            } as any,
            attributes: {
              name: `${hz.name} — ${hz.detailLabel}`,
              description: hz.summary,
            },
            popupTemplate: {
              title: "{name}",
              content: "{description}",
            },
          }),
        );

        this.hiResZoneLayer.add(
          new Graphic({
            geometry: new Polyline({
              paths: [ring],
              spatialReference: marsSR,
            }),
            symbol: {
              type: "simple-line",
              color: strokeColor,
              width: 2.5,
              style: "dash",
            } as any,
          }),
        );

        this.hiResZoneLayer.add(
          new Graphic({
            geometry: new Point({
              x: (minLon + maxLon) / 2,
              y: maxLat + 0.002,
              spatialReference: marsSR,
            }),
            symbol: {
              type: "point-3d",
              symbolLayers: [
                {
                  type: "text",
                  text: hz.isHyperlocalDtm
                    ? `★ ${hz.name.toUpperCase()} (HiRISE 1m DTM)`
                    : `◆ ${hz.name.toUpperCase()} (HiRISE)`,
                  material: { color: strokeColor },
                  halo: { color: [6, 10, 18, 0.95], size: 1.8 },
                  size: 10.5,
                  font: { weight: "bold" },
                },
              ],
            } as any,
          }),
        );
      }
    }

    this.hazardLayer.removeAll();
  }

  public updateRouteAndWaypoints(
    waypoints: ScienceWaypoint[],
    segments: RouteSegmentMetrics[],
    selectedWaypointId: string,
    showRoute: boolean,
    terrainPathPoints?: PathNodePoint[],
  ) {
    this.routeLayer.removeAll();
    this.waypointLayer.removeAll();

    if (showRoute && terrainPathPoints && terrainPathPoints.length >= 2) {
      for (let i = 0; i < terrainPathPoints.length - 1; i++) {
        const a = terrainPathPoints[i];
        const b = terrainPathPoints[i + 1];
        const s = Math.max(a.slopeDeg, b.slopeDeg);
        let lineColor: [number, number, number, number] = [34, 211, 238, 0.95];
        if (s > 18) lineColor = [248, 113, 113, 0.98];
        else if (s > 11) lineColor = [251, 191, 36, 0.95];

        this.routeLayer.add(
          new Graphic({
            geometry: new Polyline({
              paths: [[[a.lon, a.lat], [b.lon, b.lat]]],
              spatialReference: marsSR,
            }),
            symbol: {
              type: "simple-line",
              color: lineColor,
              width: 4,
              style: "solid",
            } as any,
          }),
        );
      }
    } else if (showRoute && waypoints.length >= 2) {
      for (let i = 0; i < waypoints.length - 1; i++) {
        const a = waypoints[i];
        const b = waypoints[i + 1];
        const seg = segments[i];

        let lineColor: [number, number, number, number] = [34, 211, 238, 0.95];
        if (seg?.hazardLevel === "caution") {
          lineColor = [251, 191, 36, 0.95];
        } else if (seg?.hazardLevel === "danger") {
          lineColor = [248, 113, 113, 0.98];
        }

        const polyline = new Polyline({
          paths: [
            [
              [a.lon, a.lat],
              [b.lon, b.lat],
            ],
          ],
          spatialReference: marsSR,
        });

        this.routeLayer.add(
          new Graphic({
            geometry: polyline,
            symbol: {
              type: "simple-line",
              color: lineColor,
              width: 4,
              style: "solid",
            } as any,
          }),
        );
      }
    }

    waypoints.forEach((wp, index) => {
      const isSelected = wp.id === selectedWaypointId;
      let markerColor: [number, number, number, number] = [56, 189, 248, 1];
      if (wp.sciencePriority === "CRITICAL") markerColor = [192, 132, 252, 1];
      else if (wp.sciencePriority === "SHELTER") markerColor = [74, 222, 128, 1];
      else if (wp.id === "wp-base") markerColor = [248, 250, 252, 1];

      const point = new Point({
        x: wp.lon,
        y: wp.lat,
        z: 18,
        spatialReference: marsSR,
      });

      this.waypointLayer.add(
        new Graphic({
          geometry: point,
          attributes: { waypointId: wp.id, name: wp.name },
          symbol: {
            type: "point-3d",
            symbolLayers: [
              {
                type: "icon",
                size: isSelected ? 22 : 15,
                resource: { primitive: "circle" },
                material: { color: markerColor },
                outline: {
                  color: isSelected ? [255, 255, 255, 1] : [15, 23, 42, 0.9],
                  size: isSelected ? 3 : 1.5,
                },
              },
              {
                type: "text",
                text: `${index + 1}. ${wp.name}`,
                material: { color: [248, 250, 252, 1] },
                halo: { color: [15, 23, 42, 0.9], size: 1.5 },
                size: isSelected ? 12 : 10,
                font: { weight: "bold" },
              },
            ],
            verticalOffset: {
              screenLength: 24,
              maxWorldLength: 200,
              minWorldLength: 10,
            },
            callout: {
              type: "line",
              size: 1.5,
              color: markerColor,
            },
          } as any,
        }),
      );
    });
  }
}

export const sharedOverlayManager = new EvaOverlayManager();
