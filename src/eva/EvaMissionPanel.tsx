import {
  property,
  subclass,
} from "@arcgis/core/core/accessorSupport/decorators";
import Widget from "@arcgis/core/widgets/Widget";
import { tsx } from "@arcgis/core/widgets/support/widget";
import Camera from "@arcgis/core/Camera";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import Point from "@arcgis/core/geometry/Point";
import cx from "classnames";
import AppState from "../application/AppState";
import { marsElevation, marsSR } from "../utilities/layers";
import {
  DUST_STORM_MEDA_WEATHER,
  JEZERO_WAYPOINTS,
  NOMINAL_MEDA_WEATHER,
  fetchLiveNasaDonkiSpaceWeather,
  getMissionDataset,
  type MissionId,
  type ScienceWaypoint,
  type SpaceWeatherState,
} from "./jezeroDataset";
import {
  evaluateEvaRoute,
  optimizeSafeRoute,
  type CrisisMode,
  type TransportMode,
} from "./evaPhysics";
import { sharedOverlayManager, type LayerToggles } from "./EvaOverlayManager";
import { ensureHiRiseData, SurfacePovEngine, type PovTelemetry } from "./SurfacePovEngine";
import {
  findAStarTerrainPath,
  sampleDtmPoint,
  type TerrainRouteAnalysis,
} from "./dtmAnalyzer";
import styles from "./EvaMissionPanel.module.scss";

@subclass("ExploreMars.eva.EvaMissionPanel")
export class EvaMissionPanel extends Widget {
  private overlayManager = sharedOverlayManager;
  private mapClickHandle: __esri.Handle | null = null;

  @property()
  missionId: MissionId = "jezero";

  @property()
  transportMode: TransportMode = "foot";

  @property()
  waypoints: ScienceWaypoint[] = [];

  @property()
  selectedWaypointId = "";

  @property()
  crisisMode: CrisisMode = "nominal";

  @property()
  reliefExaggeration = 1.6;

  @property()
  hiResTerrain = true;

  @property()
  toggles: LayerToggles = {
    slopeHazards: true,
    thermalSandTraps: true,
    crismMineralogy: true,
    radiationShelters: true,
    evaRoute: true,
    hiResZones: true,
  };

  @property()
  addingWaypoint = false;

  @property()
  visorOpen = false;

  @property()
  pickingPov = false;

  @property()
  surfacePovActive = false;

  @property()
  povLon = 77.4165;

  @property()
  povLat = 18.4622;

  @property()
  povElevM = -2548;

  @property()
  povHeading = 0;

  @property()
  povSlopeDeg = 4;

  @property()
  povOffsetN = 0;

  @property()
  povOffsetE = 0;

  @property()
  povResolutionMode: "HiRISE 1m DTM" | "Global MDEM200M" = "HiRISE 1m DTM";

  @property()
  povDataMode: 1 | 2 | 3 | 4 = 1;

  @property()
  drawerOpen = true;

  @property()
  wizardStep: 1 | 2 = 1;

  @property()
  largeMapOpen = false;

  @property()
  terrainAnalysis: TerrainRouteAnalysis | null = null;

  private routeCalcToken = 0;

  private povEngine: SurfacePovEngine | null = null;

  @property()
  spaceWeather: SpaceWeatherState = {
    source: "CACHED TELEMETRY",
    gcrBackgroundMsvDay: 0.64,
    speAlertActive: false,
    flareClass: "Loading...",
    protonFluxPfu: 1.2,
    lastUpdated: "Syncing NASA DONKI...",
  };

  private povTargetHandle: __esri.WatchHandle | null = null;
  private minimapCanvasEl: HTMLCanvasElement | null = null;

  private getNearestWaypoint(): { wp: ScienceWaypoint; distM: number } | null {
    const mPerDegLat = (Math.PI * 3389500) / 180;
    const mPerDegLon = mPerDegLat * Math.cos((this.povLat * Math.PI) / 180);
    const curLat = this.povLat + this.povOffsetN / mPerDegLat;
    const curLon = this.povLon + this.povOffsetE / mPerDegLon;
    let best: { wp: ScienceWaypoint; distM: number } | null = null;
    for (const wp of this.waypoints) {
      const dx = (wp.lon - curLon) * mPerDegLon;
      const dy = (wp.lat - curLat) * mPerDegLat;
      const distM = Math.round(Math.hypot(dx, dy));
      if (!best || distM < best.distM) {
        best = { wp, distM };
      }
    }
    return best;
  }

  private pinCurrentPovWaypoint() {
    const mPerDegLat = (Math.PI * 3389500) / 180;
    const mPerDegLon = mPerDegLat * Math.cos((this.povLat * Math.PI) / 180);
    const curLat = Number((this.povLat + this.povOffsetN / mPerDegLat).toFixed(6));
    const curLon = Number((this.povLon + this.povOffsetE / mPerDegLon).toFixed(6));
    const idx = this.waypoints.length + 1;
    const wp: ScienceWaypoint = {
      id: `wp-pov-${Date.now()}`,
      name: `EVA Pin #${idx}`,
      subtitle: "Astronaut Field Marker",
      lon: curLon,
      lat: curLat,
      elevationM: Math.round(this.povElevM),
      slopeDeg: Number(this.povSlopeDeg.toFixed(1)),
      thermalInertia: 380,
      surfaceType: "Regolith",
      minerals: ["Field Sample"],
      instrumentSource: "xEMU Visor Pin",
      sciencePriority: "HIGH",
      biosignatureScore: 60,
      radiationShieldingPct: this.povSlopeDeg > 14 ? 38 : 20,
      rimfaxDepthNote: "Field marker pinned during surface EVA.",
      rimfaxLayers: [{ depthM: 1.5, label: "Surface Regolith", permittivity: 4.5 }],
      povSummary: `Pinned at ${curLat.toFixed(4)}°N, ${curLon.toFixed(4)}°E (Elev ${Math.round(this.povElevM)}m, Slope ${this.povSlopeDeg.toFixed(1)}°).`,
      povImageUrl: this.waypoints[0]?.povImageUrl ?? "",
      sol: 1215,
    };
    this.waypoints = [...this.waypoints, wp];
    this.selectedWaypointId = wp.id;
    this.povEngine?.addRuntimeWaypoint(curLon, curLat, false);
    this.syncOverlays();
  }

  private removeWaypoint(id: string) {
    this.waypoints = this.waypoints.filter((w) => w.id !== id);
    if (this.selectedWaypointId === id) {
      this.selectedWaypointId = this.waypoints[0]?.id ?? "";
    }
    if (this.waypoints.length < 2) {
      this.terrainAnalysis = null;
    }
    this.syncOverlays();
    this.scheduleRender();
  }

  private moveWaypoint(idx: number, delta: -1 | 1) {
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= this.waypoints.length) return;
    const next = [...this.waypoints];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    this.waypoints = next;
    this.syncOverlays();
    this.scheduleRender();
  }

  private clearAllWaypoints() {
    this.waypoints = [];
    this.selectedWaypointId = "";
    this.terrainAnalysis = null;
    if (this.addingWaypoint) {
      this.addingWaypoint = false;
      AppState.activeInteractionMode = "none";
      if (AppState.view?.container) {
        AppState.view.container.style.cursor = "";
      }
      this.mapClickHandle?.remove();
      this.mapClickHandle = null;
    }
    this.syncOverlays();
    this.scheduleRender();
  }

  private onPovKeyDown = (e: KeyboardEvent) => {
    if (!this.surfacePovActive) return;
    if (e.code === "KeyM") {
      this.largeMapOpen = !this.largeMapOpen;
      if (this.largeMapOpen && document.pointerLockElement) {
        document.exitPointerLock?.();
      }
      this.scheduleRender();
      return;
    }
    if (e.code === "Escape" && (this.largeMapOpen || this.visorOpen)) {
      this.largeMapOpen = false;
      this.visorOpen = false;
      this.scheduleRender();
      return;
    }
    if (e.code === "KeyP") {
      this.pinCurrentPovWaypoint();
      return;
    }
    if (e.code !== "KeyE") return;
    const nearest = this.getNearestWaypoint();
    if (nearest && nearest.distM <= 250) {
      this.selectedWaypointId = nearest.wp.id;
      this.visorOpen = !this.visorOpen;
    }
  };

  postInitialize() {
    window.addEventListener("keydown", this.onPovKeyDown);
    void ensureHiRiseData();
    void fetchLiveNasaDonkiSpaceWeather().then((sw) => {
      this.spaceWeather = sw;
    });

    if (AppState.view) {
      this.overlayManager.attachToView(AppState.view);
      this.syncOverlays();
    }

    if (AppState.pendingPovTarget) {
      const target = AppState.pendingPovTarget;
      AppState.pendingPovTarget = null;
      this.enterSurfacePov(target.lon, target.lat);
    }

    this.povTargetHandle = reactiveUtils.watch(
      () => AppState.pendingPovTarget,
      (target) => {
        if (!target) return;
        AppState.pendingPovTarget = null;
        this.enterSurfacePov(target.lon, target.lat);
      },
    );

    this.addHandles([
      reactiveUtils.watch(
        () => AppState.activeMissionId,
        (id) => {
          if (id && id !== this.missionId) {
            this.switchMission(id, true);
          }
        },
        { initial: true },
      ),
      reactiveUtils.watch(
        () => AppState.activeInteractionMode,
        (mode) => {
          if (mode !== "waypoint" && this.addingWaypoint) {
            this.addingWaypoint = false;
            this.mapClickHandle?.remove();
            this.mapClickHandle = null;
          }
        },
      ),
    ]);
  }

  destroy() {
    window.removeEventListener("keydown", this.onPovKeyDown);
    this.unmountSurfacePov();
    AppState.surfacePovActive = false;
    this.povTargetHandle?.remove();
    this.povTargetHandle = null;
    this.mapClickHandle?.remove();
    this.mapClickHandle = null;
  }

  private flyToJezeroOverview() {
    const view = AppState.view;
    if (!view) return;
    this.overlayManager.attachToView(view);

    const cam = new Camera({
      position: {
        x: 77.412,
        y: 18.415,
        z: 3650,
        spatialReference: { wkid: 104971 },
      },
      heading: 345,
      tilt: 62,
    });
    void view.goTo(cam, { speedFactor: 0.9 });
  }

  private flyToWaypoint(wp: ScienceWaypoint) {
    this.selectedWaypointId = wp.id;
    this.syncOverlays();
    const view = AppState.view;
    if (!view) return;

    void view.goTo(
      {
        target: new Point({
          x: wp.lon,
          y: wp.lat,
          spatialReference: marsSR,
        }),
        scale: 12000,
        heading: 0,
        tilt: 48,
      },
      { speedFactor: 0.9 },
    );
  }

  private getActiveHazards() {
    return getMissionDataset(this.missionId).hazards;
  }

  private switchMission(id: MissionId, flyCamera = true) {
    this.missionId = id;
    AppState.activeMissionId = id;
    const ds = getMissionDataset(id);
    this.waypoints = [];
    this.selectedWaypointId = "";
    this.terrainAnalysis = null;
    this.syncOverlays();
    if (flyCamera && !this.surfacePovActive && AppState.view) {
      void AppState.view.goTo(
        {
          target: new Point({
            x: ds.camera.x,
            y: ds.camera.y,
            spatialReference: marsSR,
          }),
          scale: 42000,
          heading: 0,
          tilt: 45,
        },
        { speedFactor: 0.9 },
      );
    }
    this.scheduleRender();
  }

  private optimizeCurrentRoute() {
    this.waypoints = optimizeSafeRoute(this.waypoints, this.getActiveHazards());
    this.syncOverlays();
    this.scheduleRender();
  }

  private syncOverlays() {
    const summary = evaluateEvaRoute(
      this.waypoints,
      this.crisisMode,
      18,
      this.transportMode,
    );
    if (this.waypoints.length < 2) {
      this.terrainAnalysis = null;
    }
    this.overlayManager.updateHazards(this.toggles, this.getActiveHazards());
    this.overlayManager.updateRouteAndWaypoints(
      this.waypoints,
      summary.segments,
      this.selectedWaypointId,
      this.toggles.evaRoute,
      this.terrainAnalysis?.pathPoints,
    );

    const token = ++this.routeCalcToken;
    const maxSlope = this.transportMode === "rover" ? 15 : 20;
    void findAStarTerrainPath(this.waypoints, maxSlope).then((analysis) => {
      if (token !== this.routeCalcToken) return;
      this.terrainAnalysis = analysis;
      this.overlayManager.updateRouteAndWaypoints(
        this.waypoints,
        summary.segments,
        this.selectedWaypointId,
        this.toggles.evaRoute,
        analysis.pathPoints,
      );
      this.scheduleRender();
    });
  }

  private toggleLayer(key: keyof LayerToggles) {
    this.toggles = {
      ...this.toggles,
      [key]: !this.toggles[key],
    };
    this.syncOverlays();
  }

  private updateTerrainSettings(hiRes: boolean, exaggeration: number) {
    this.hiResTerrain = hiRes;
    this.reliefExaggeration = exaggeration;
    marsElevation.hiResEnabled = hiRes;
    marsElevation.reliefExaggeration = exaggeration;
    const ground = AppState.view?.map?.ground;
    if (ground) {
      ground.layers.remove(marsElevation);
      ground.layers.add(marsElevation);
    }
  }

  private toggleAddWaypointMode() {
    const view = AppState.view;
    if (!view) return;

    if (this.addingWaypoint) {
      this.addingWaypoint = false;
      AppState.activeInteractionMode = "none";
      if (view.container) view.container.style.cursor = "";
      this.mapClickHandle?.remove();
      this.mapClickHandle = null;
      this.scheduleRender();
      return;
    }

    this.addingWaypoint = true;
    AppState.activeInteractionMode = "waypoint";
    if (view.container) view.container.style.cursor = "crosshair";
    this.mapClickHandle?.remove();
    this.mapClickHandle = view.on("click", (event) => {
      if (!event.mapPoint || AppState.activeInteractionMode !== "waypoint") return;
      const lon = Number((event.mapPoint.longitude ?? event.mapPoint.x).toFixed(5));
      const lat = Number((event.mapPoint.latitude ?? event.mapPoint.y).toFixed(5));
      const fallbackElev = Math.round(event.mapPoint.z ?? -2510);

      this.addingWaypoint = false;
      AppState.activeInteractionMode = "none";
      if (view.container) view.container.style.cursor = "";
      this.mapClickHandle?.remove();
      this.mapClickHandle = null;
      this.scheduleRender();

      void sampleDtmPoint(lon, lat).then((sample) => {
        const elev = sample.fromRealDtm ? sample.elevM : fallbackElev;
        const newWp: ScienceWaypoint = {
          id: `wp-custom-${Date.now()}`,
          name: this.waypoints.length === 0 ? "Start Base" : `Target #${this.waypoints.length}`,
          subtitle: sample.fromRealDtm ? "HiRISE 1m DTM Sampled" : "Field Station",
          lon,
          lat,
          elevationM: elev,
          slopeDeg: sample.slopeDeg,
          thermalInertia: 430,
          surfaceType: sample.slopeDeg > 14 ? "Delta Scarp" : "Regolith",
          minerals: ["Target Pending PIXL Scan"],
          instrumentSource: sample.fromRealDtm ? "HiRISE 1m DTM" : "Crew Field Selection",
          sciencePriority: sample.skyShieldingPct > 40 ? "SHELTER" : "HIGH",
          biosignatureScore: 60,
          radiationShieldingPct: sample.skyShieldingPct,
          rimfaxDepthNote: "Real-time RIMFAX scan queued on arrival",
          rimfaxLayers: [
            { depthM: 0, label: "Surface Regolith", permittivity: 3.6 },
            { depthM: 4.5, label: "Subsurface Bedrock", permittivity: 6.4 },
          ],
          povSummary: `Sampled at ${lat}°N, ${lon}°E • Elev ${elev}m • Slope ${sample.slopeDeg}° • Sky shield ${sample.skyShieldingPct}%`,
          povImageUrl: JEZERO_WAYPOINTS[1].povImageUrl,
          sol: 1215,
        };

        this.waypoints = [...this.waypoints, newWp];
        this.selectedWaypointId = newWp.id;
        this.syncOverlays();
        this.scheduleRender();
      });
    });
  }

  private resetRoute() {
    this.waypoints = [...JEZERO_WAYPOINTS];
    this.selectedWaypointId = JEZERO_WAYPOINTS[3].id;
    this.syncOverlays();
  }

  private togglePickPovMode() {
    const view = AppState.view;
    if (!view) return;

    if (this.pickingPov) {
      this.pickingPov = false;
      this.mapClickHandle?.remove();
      this.mapClickHandle = null;
      return;
    }

    this.addingWaypoint = false;
    this.mapClickHandle?.remove();
    this.pickingPov = true;

    this.mapClickHandle = view.on("click", (event) => {
      if (!event.mapPoint) return;
      const lon = event.mapPoint.longitude ?? event.mapPoint.x;
      const lat = event.mapPoint.latitude ?? event.mapPoint.y;
      this.pickingPov = false;
      this.mapClickHandle?.remove();
      this.mapClickHandle = null;
      void this.enterSurfacePov(lon, lat);
    });
  }

  private enterSurfacePov(lon: number, lat: number) {
    let targetMission: MissionId = this.missionId;
    if (lon >= 137.42 && lon <= 137.55 && lat >= -4.71 && lat <= -4.41) {
      targetMission = "gale";
    } else if (lon >= -76.99 && lon <= -76.87 && lat >= -6.57 && lat <= -6.37) {
      targetMission = "candor";
    } else if (lon >= -24.02 && lon <= -23.87 && lat >= 17.92 && lat <= 18.35) {
      targetMission = "oxia";
    } else if (lon >= 77.35 && lon <= 77.47 && lat >= 18.42 && lat <= 18.52) {
      targetMission = "jezero";
    }
    if (targetMission !== this.missionId) {
      this.switchMission(targetMission, false);
    }
    this.povLon = Number(lon.toFixed(6));
    this.povLat = Number(lat.toFixed(6));
    this.povOffsetN = 0;
    this.povOffsetE = 0;
    this.surfacePovActive = true;
    AppState.surfacePovActive = true;
  }

  private mountSurfacePov(el: HTMLElement) {
    this.unmountSurfacePov();
    this.povEngine = new SurfacePovEngine({
      container: el,
      lon: this.povLon,
      lat: this.povLat,
      exaggeration: this.reliefExaggeration,
      waypoints: this.waypoints,
      astarPath: this.terrainAnalysis?.pathPoints,
      dustStorm: this.crisisMode === "dust_storm",
      roverSupport: this.transportMode === "rover",
      ground: AppState.view?.map?.ground,
      onTelemetry: (t: PovTelemetry) => {
        this.povElevM = t.elevM;
        this.povSlopeDeg = t.slopeDeg;
        this.povHeading = t.headingDeg;
        this.povOffsetN = t.offsetNorthM;
        this.povOffsetE = t.offsetEastM;
        this.povResolutionMode = t.resolutionMode;
        this.povDataMode = t.dataMode;
      },
    });
    if (this.minimapCanvasEl) {
      this.povEngine.setMinimapCanvas(this.minimapCanvasEl);
    }
  }

  private unmountSurfacePov() {
    this.povEngine?.dispose();
    this.povEngine = null;
  }

  private async stepPov(_forwardMeters: number, _turnDeg: number) {
    // Handled natively at 60fps inside SurfacePovEngine
  }

  private exitSurfacePov() {
    this.unmountSurfacePov();
    this.surfacePovActive = false;
    AppState.surfacePovActive = false;
  }

  render() {
    const summary = evaluateEvaRoute(
      this.waypoints,
      this.crisisMode,
      18,
      this.transportMode,
    );
    const weather =
      this.crisisMode === "dust_storm"
        ? DUST_STORM_MEDA_WEATHER
        : NOMINAL_MEDA_WEATHER;
    const selectedWp =
      this.waypoints.find((w) => w.id === this.selectedWaypointId) ??
      this.waypoints[0];

    const statusClass =
      summary.safetyStatus === "GO"
        ? styles.statusGo
        : summary.safetyStatus === "CAUTION"
          ? styles.statusCaution
          : styles.statusAbort;

    const statusDotColor =
      summary.safetyStatus === "GO"
        ? "#10b981"
        : summary.safetyStatus === "CAUTION"
          ? "#f59e0b"
          : "#ef4444";

    return (
      <div>
        {!this.surfacePovActive && !this.drawerOpen ? (
          <button
            key="drawer-pill"
            style="position:fixed;top:16px;right:16px;z-index:999;pointer-events:auto;display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);background:rgba(24,26,31,0.74);backdrop-filter:blur(28px) saturate(180%);color:#f5f5f7;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 12px 32px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.12);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;"
            onclick={() => {
              this.drawerOpen = true;
              this.scheduleRender();
            }}
            title="Open Mission Planner"
          >
            <span style={`width:8px;height:8px;border-radius:50%;background:${statusDotColor};display:inline-block;`} />
            <span>{getMissionDataset(this.missionId).label.split("•")[0].trim()}</span>
            <span style="color:rgba(255,255,255,0.55);font-weight:500;">
              • {(summary.totalDistanceM / 1000).toFixed(1)} km • O₂ {summary.o2RemainingPct}%
            </span>
            <span style="color:rgba(255,255,255,0.6);">▾</span>
          </button>
        ) : null}

        {!this.surfacePovActive && this.drawerOpen ? (
          <aside key="drawer-aside" class={styles.panel} style="width:320px;max-height:calc(100vh - 100px);">
          <div class={styles.header}>
            <div class={styles.titleGroup}>
              <div class={styles.title}>EVA Mission Control</div>
              <div class={styles.subtitle}>
                {getMissionDataset(this.missionId).label}
              </div>
            </div>
            <div class={styles.headerActions}>
              <button
                class={styles.iconBtn}
                onclick={() => {
                  this.drawerOpen = false;
                }}
                title="Collapse"
              >
                ✕
              </button>
            </div>
          </div>

          <div class={styles.scrollBody} style="padding:12px 14px;gap:12px;">
            <div style="display:flex;gap:4px;padding:3px;border-radius:10px;background:rgba(255,255,255,0.06);">
              <button
                class={styles.iconBtn}
                style={
                  this.wizardStep === 1
                    ? "flex:1;border:none;background:rgba(255,255,255,0.18);color:#fff;"
                    : "flex:1;border:none;background:transparent;color:rgba(255,255,255,0.55);"
                }
                onclick={() => {
                  this.wizardStep = 1;
                  this.scheduleRender();
                }}
              >
                1. Site
              </button>
              <button
                class={styles.iconBtn}
                style={
                  this.wizardStep === 2
                    ? "flex:1;border:none;background:rgba(255,255,255,0.18);color:#fff;"
                    : "flex:1;border:none;background:transparent;color:rgba(255,255,255,0.55);"
                }
                onclick={() => {
                  this.wizardStep = 2;
                  this.scheduleRender();
                }}
              >
                2. Route &amp; Land
              </button>
            </div>

            {this.wizardStep === 1 ? (
              <div key="wizard-step-1" style="display:flex;flex-direction:column;gap:10px;">
                <div style="font-size:12px;color:rgba(255,255,255,0.68);line-height:1.4;">
                  Choose a 1-meter HiRISE landing zone, then proceed to plan your safe A* traverse.
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                  {(
                    [
                      ["jezero", "Jezero"],
                      ["gale", "Gale Boxwork"],
                      ["candor", "Candor"],
                      ["oxia", "Oxia"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      class={styles.iconBtn}
                      style={
                        this.missionId === id
                          ? "border:1px solid rgba(10,132,255,0.6);background:rgba(10,132,255,0.2);color:#ffffff;"
                          : "border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.75);"
                      }
                      onclick={() => this.switchMission(id, true)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  class={styles.primaryBtn}
                  onclick={() => {
                    this.wizardStep = 2;
                    this.scheduleRender();
                  }}
                >
                  Next: Plan Safe Route →
                </button>
              </div>
            ) : (
              <div key="wizard-step-2" style="display:flex;flex-direction:column;gap:10px;">
                <div key="transport-toggle" style="display:flex;gap:4px;padding:3px;border-radius:12px;background:rgba(255,255,255,0.07);">
                  <button
                    class={styles.iconBtn}
                    style={
                      this.transportMode === "foot"
                        ? "flex:1;border:none;background:rgba(255,255,255,0.2);color:#ffffff;"
                        : "flex:1;border:none;background:transparent;color:rgba(255,255,255,0.65);"
                    }
                    onclick={() => {
                      this.transportMode = "foot";
                      this.syncOverlays();
                    }}
                  >
                    On Foot
                  </button>
                  <button
                    class={styles.iconBtn}
                    style={
                      this.transportMode === "rover"
                        ? "flex:1;border:none;background:rgba(255,255,255,0.2);color:#ffffff;"
                        : "flex:1;border:none;background:transparent;color:rgba(255,255,255,0.65);"
                    }
                    onclick={() => {
                      this.transportMode = "rover";
                      this.syncOverlays();
                    }}
                  >
                    Rover
                  </button>
                </div>

            <div key="crisis-grid" class={styles.crisisGrid}>
              <button
                class={cx(
                  styles.crisisBtn,
                  this.crisisMode === "nominal" && styles.crisisActiveNominal,
                )}
                onclick={() => {
                  this.crisisMode = "nominal";
                  this.syncOverlays();
                }}
              >
                Nominal
              </button>
              <button
                class={cx(
                  styles.crisisBtn,
                  this.crisisMode === "spe_storm" && styles.crisisActiveSpe,
                )}
                onclick={() => {
                  this.crisisMode = "spe_storm";
                  this.syncOverlays();
                }}
              >
                SPE Storm
              </button>
              <button
                class={cx(
                  styles.crisisBtn,
                  this.crisisMode === "dust_storm" && styles.crisisActiveDust,
                )}
                onclick={() => {
                  this.crisisMode = "dust_storm";
                  this.syncOverlays();
                }}
              >
                Dust Storm
              </button>
            </div>

            <div key="status-banner" class={cx(styles.statusBanner, statusClass)}>
              <strong>{summary.safetyStatus}:</strong>{" "}
              {((this.terrainAnalysis?.totalDistanceM ?? summary.totalDistanceM) / 1000).toFixed(2)} km • Max{" "}
              {this.terrainAnalysis?.maxSlopeDeg ?? summary.maxSlopeDeg}° • O₂ {summary.o2RemainingPct}%
            </div>

            {this.renderElevationProfileSvg()}

            <div key="route-actions-row" style="display:flex;gap:6px;flex-wrap:wrap;">
              <button
                class={styles.secondaryBtn}
                style={
                  this.addingWaypoint
                    ? "flex:1;min-width:96px;background:#0a84ff;border-color:#0a84ff;color:#ffffff;"
                    : "flex:1;min-width:96px;"
                }
                onclick={() => this.toggleAddWaypointMode()}
              >
                {this.addingWaypoint ? "Click Map…" : "+ Waypoint"}
              </button>
              <button
                class={styles.secondaryBtn}
                style="flex:1;min-width:82px;"
                onclick={() => this.optimizeCurrentRoute()}
                title="Reorder stops for safest terrain"
              >
                Auto Safe
              </button>
              <button
                class={styles.secondaryBtn}
                style="width:auto;padding:8px 10px;"
                onclick={() => this.clearAllWaypoints()}
                title="Clear all waypoints"
              >
                Clear
              </button>
              <button
                class={styles.secondaryBtn}
                style="width:auto;padding:8px 10px;"
                onclick={() => this.exportMissionJson(summary)}
                title="Export A* EVA Plan JSON"
              >
                Export
              </button>
            </div>

            <div key="waypoint-list" class={styles.waypointList}>
              {this.waypoints.length === 0 ? (
                <div
                  key="empty-waypoints-hint"
                  style="padding:12px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.14);font-size:11.5px;line-height:1.45;color:rgba(255,255,255,0.66);text-align:center;"
                >
                  No waypoints yet. Click <strong>+ Waypoint</strong> and tap the terrain to place your start &amp; target stops — A* will compute the safest route.
                </div>
              ) : null}
              {this.waypoints.map((wp, idx) => (
                <div
                  key={wp.id}
                  class={cx(
                    styles.waypointCard,
                    wp.id === this.selectedWaypointId && styles.waypointSelected,
                  )}
                  onclick={() => this.flyToWaypoint(wp)}
                >
                  <div>
                    <div class={styles.wpName}>
                      {idx + 1}. {wp.name}
                    </div>
                    <div class={styles.wpMeta}>
                      Slope {wp.slopeDeg}° • Shield {wp.radiationShieldingPct}%
                    </div>
                  </div>
                  <div key={`wp-actions-${wp.id}`} style="display:flex;align-items:center;gap:2px;">
                    <button
                      class={styles.iconBtn}
                      style="padding:2px 5px;font-size:10px;opacity:0.75;"
                      disabled={idx <= 0}
                      onclick={(e: Event) => {
                        e.stopPropagation();
                        this.moveWaypoint(idx, -1);
                      }}
                      title="Move earlier"
                    >
                      ↑
                    </button>
                    <button
                      class={styles.iconBtn}
                      style="padding:2px 5px;font-size:10px;opacity:0.75;"
                      disabled={idx >= this.waypoints.length - 1}
                      onclick={(e: Event) => {
                        e.stopPropagation();
                        this.moveWaypoint(idx, 1);
                      }}
                      title="Move later"
                    >
                      ↓
                    </button>
                    <button
                      class={styles.iconBtn}
                      style="padding:2px 6px;font-size:11px;opacity:0.75;"
                      onclick={(e: Event) => {
                        e.stopPropagation();
                        this.removeWaypoint(wp.id);
                      }}
                      title="Remove from route"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              class={styles.primaryBtn}
              style="margin-top:2px;"
              onclick={() => {
                const ds = getMissionDataset(this.missionId);
                const start = this.waypoints[0];
                this.enterSurfacePov(
                  start ? start.lon : ds.camera.x,
                  start ? start.lat : ds.camera.y,
                );
              }}
            >
              Land &amp; Walk on Mars →
            </button>
              </div>
            )}
          </div>
        </aside>
        ) : null}

        {this.surfacePovActive
          ? this.renderSurfacePovOverlay(summary, weather)
          : null}

        {this.visorOpen ? this.renderVisorHud(selectedWp, summary, weather) : null}
      </div>
    );
  }

  private getCardinal(deg: number): string {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  }

  private exportMissionJson(summary: ReturnType<typeof evaluateEvaRoute>) {
    const payload = {
      team: "PRLX",
      missionId: this.missionId,
      transportMode: this.transportMode,
      crisisMode: this.crisisMode,
      generatedAt: new Date().toISOString(),
      telemetry: {
        distanceM: this.terrainAnalysis?.totalDistanceM ?? summary.totalDistanceM,
        elevationGainM: this.terrainAnalysis?.elevationGainM ?? summary.totalElevationGainM,
        maxSlopeDeg: this.terrainAnalysis?.maxSlopeDeg ?? summary.maxSlopeDeg,
        o2RemainingPct: summary.o2RemainingPct,
        estimatedDoseUsv: summary.estimatedDoseUsv,
        uhfLineOfSightClear: this.terrainAnalysis?.losClear ?? true,
      },
      waypoints: this.waypoints,
      astarPath: this.terrainAnalysis?.pathPoints ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prlx-eva-${this.missionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private renderElevationProfileSvg() {
    const pts = this.terrainAnalysis?.pathPoints;
    if (!pts || pts.length < 2) {
      return (
        <div
          key="elevation-profile-box"
          style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:8px 10px;font-size:11px;color:rgba(255,255,255,0.52);text-align:center;"
        >
          Add 2+ waypoints for A* elevation profile
        </div>
      );
    }
    const w = 280;
    const h = 52;
    let minE = Infinity;
    let maxE = -Infinity;
    for (const p of pts) {
      if (p.elevM < minE) minE = p.elevM;
      if (p.elevM > maxE) maxE = p.elevM;
    }
    const spanE = Math.max(4, maxE - minE);
    const totalD = Math.max(1, pts[pts.length - 1].distFromStartM);
    const polyPts = pts
      .map((p) => {
        const x = ((p.distFromStartM / totalD) * (w - 8) + 4).toFixed(1);
        const y = (h - 6 - ((p.elevM - minE) / spanE) * (h - 14)).toFixed(1);
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <div
        key="elevation-profile-box"
        style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:8px 10px;"
      >
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:rgba(255,255,255,0.56);margin-bottom:4px;">
          <span>Elevation ({Math.round(minE)}..{Math.round(maxE)}m)</span>
          <span style={this.terrainAnalysis?.losClear ? "color:#30d158;font-weight:600;" : "color:#ff9f0a;font-weight:600;"}>
            UHF LOS: {this.terrainAnalysis?.losClear ? "Clear" : `Blocked ${this.terrainAnalysis?.losObstructionM}m`}
          </span>
        </div>
        <svg width="100%" height={String(h)} viewBox={`0 0 ${w} ${h}`} style="display:block;">
          <polyline fill="none" stroke="#0a84ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points={polyPts} />
        </svg>
      </div>
    );
  }

  private renderSurfacePovOverlay(
    summary: ReturnType<typeof evaluateEvaRoute>,
    weather: typeof NOMINAL_MEDA_WEATHER,
  ) {
    const radRate = this.crisisMode === "spe_storm" ? 410 : 24;
    const nearest = this.getNearestWaypoint();
    const cardinal = this.getCardinal(this.povHeading);
    return (
      <div>
        <div
          key="pov-three-host"
          class={styles.povCanvasHost}
          afterCreate={(el: HTMLElement) => this.mountSurfacePov(el)}
          afterRemoved={() => this.unmountSurfacePov()}
        />
        <div class={styles.surfacePovFrame}>
          <div
            style="position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 85px rgba(0,0,0,0.65);"
          />
          <div class={styles.crosshair} />

          {this.crisisMode !== "nominal" ? (
            <div
              style={`position:absolute;top:60px;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:999px;font-size:11.5px;font-weight:600;backdrop-filter:blur(24px) saturate(180%);z-index:20;${
                this.crisisMode === "spe_storm"
                  ? "background:rgba(255,69,58,0.25);border:1px solid rgba(255,69,58,0.5);color:#ffd5d2;"
                  : "background:rgba(255,159,10,0.25);border:1px solid rgba(255,159,10,0.5);color:#ffe9c2;"
              }`}
            >
              {this.crisisMode === "spe_storm"
                ? "Solar Radiation Alert • Seek Shelter [4]"
                : "Dust Storm (τ=2.85) • Follow Route"}
            </div>
          ) : null}

          <div class={styles.surfacePovTop}>
            <div
              style="display:flex;align-items:center;gap:12px;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);background:rgba(24,26,31,0.72);backdrop-filter:blur(28px) saturate(180%);color:#f5f5f7;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums;box-shadow:0 12px 32px rgba(0,0,0,0.35);pointer-events:auto;"
            >
              <span style="font-weight:600;color:#ffffff;">{cardinal} {this.povHeading}°</span>
              <span style="color:rgba(255,255,255,0.55);">{this.povElevM} m</span>
              <span style="color:rgba(255,255,255,0.55);">Slope {this.povSlopeDeg}°</span>
              <span style="color:rgba(255,255,255,0.55);">O₂ {summary.o2RemainingPct}%</span>
              <span style="color:rgba(255,255,255,0.45);font-size:11px;">{radRate} µSv/h</span>
            </div>

            <div
              style="display:flex;align-items:center;gap:8px;pointer-events:auto;"
            >
              {nearest ? (
                nearest.distM <= 250 ? (
                  <button
                    class={styles.iconBtn}
                    style="border-radius:999px;padding:8px 14px;background:#0a84ff;border:none;color:#ffffff;font-weight:600;"
                    onclick={() => {
                      this.selectedWaypointId = nearest.wp.id;
                      this.visorOpen = !this.visorOpen;
                    }}
                  >
                    Inspect {nearest.wp.name} [E]
                  </button>
                ) : (
                  <div
                    style="padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);background:rgba(24,26,31,0.72);backdrop-filter:blur(28px) saturate(180%);color:rgba(255,255,255,0.8);font-size:12px;font-weight:500;"
                  >
                    {nearest.wp.name} • {nearest.distM}m
                  </div>
                )
              ) : null}
              <button
                class={styles.iconBtn}
                style="border-radius:999px;padding:8px 14px;background:rgba(24,26,31,0.76);backdrop-filter:blur(28px) saturate(180%);font-weight:600;"
                onclick={() => this.exitSurfacePov()}
              >
                Done
              </button>
            </div>
          </div>

          <div class={styles.surfacePovControls}>
            <div
              style="display:flex;align-items:center;gap:4px;padding:5px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);background:rgba(24,26,31,0.74);backdrop-filter:blur(28px) saturate(180%);box-shadow:0 16px 40px rgba(0,0,0,0.42);pointer-events:auto;"
            >
              {(
                [
                  [1, "Optical"],
                  [2, "Slope"],
                  [3, "Strata"],
                  [4, "Shelters"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  class={styles.iconBtn}
                  style={
                    this.povDataMode === mode
                      ? "border-radius:999px;border:none;background:rgba(255,255,255,0.2);color:#ffffff;font-weight:600;"
                      : "border-radius:999px;border:none;background:transparent;color:rgba(255,255,255,0.7);"
                  }
                  onclick={() => {
                    this.povDataMode = mode;
                    this.povEngine?.setDataMode(mode);
                  }}
                >
                  {mode} {label}
                </button>
              ))}
              <button
                class={styles.iconBtn}
                style="border-radius:999px;border:none;background:rgba(10,132,255,0.24);color:#ffffff;font-weight:600;"
                onclick={() => this.pinCurrentPovWaypoint()}
                title="Pin current position [P]"
              >
                + Pin [P]
              </button>
              <button
                class={styles.iconBtn}
                style="border-radius:999px;border:none;background:rgba(255,255,255,0.14);color:#ffffff;font-weight:600;"
                onclick={() => {
                  this.largeMapOpen = !this.largeMapOpen;
                  this.scheduleRender();
                }}
                title="Toggle full tactical map [M]"
              >
                Map [M]
              </button>
            </div>
          </div>

          <div
            style="position:fixed;bottom:18px;right:18px;padding:6px;border-radius:16px;border:1px solid rgba(255,255,255,0.14);background:rgba(24,26,31,0.74);backdrop-filter:blur(28px) saturate(180%);box-shadow:0 16px 40px rgba(0,0,0,0.45);pointer-events:auto;cursor:pointer;"
            onclick={() => {
              this.largeMapOpen = true;
              this.scheduleRender();
            }}
            title="Click or press [M] for full tactical map"
          >
            <canvas
              width="156"
              height="156"
              style="display:block;border-radius:11px;"
              afterCreate={(el: HTMLCanvasElement) => {
                this.minimapCanvasEl = el;
                this.povEngine?.setMinimapCanvas(el);
              }}
            />
          </div>

          {this.largeMapOpen ? (
            <div
              key="pov-large-map-modal"
              style="position:fixed;inset:0;z-index:1100;background:rgba(6,8,12,0.58);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;pointer-events:auto;"
              onclick={() => {
                this.largeMapOpen = false;
                this.scheduleRender();
              }}
            >
              <div
                style="padding:14px;border-radius:22px;border:1px solid rgba(255,255,255,0.16);background:rgba(24,26,31,0.88);backdrop-filter:blur(32px) saturate(180%);box-shadow:0 28px 70px rgba(0,0,0,0.65);display:flex;flex-direction:column;gap:10px;"
                onclick={(e: Event) => e.stopPropagation()}
              >
                <div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px;">
                  <span style="font-size:13px;font-weight:600;color:#f5f5f7;">
                    EVA Tactical Map • Full Route Overview
                  </span>
                  <button
                    class={styles.iconBtn}
                    style="padding:4px 10px;border-radius:999px;"
                    onclick={() => {
                      this.largeMapOpen = false;
                      this.scheduleRender();
                    }}
                  >
                    Close [M]
                  </button>
                </div>
                <canvas
                  width="520"
                  height="520"
                  style="display:block;border-radius:14px;border:1px solid rgba(255,255,255,0.1);max-width:82vw;max-height:76vh;"
                  afterCreate={(el: HTMLCanvasElement) => {
                    this.povEngine?.setLargeMapCanvas(el);
                  }}
                  afterRemoved={() => {
                    this.povEngine?.setLargeMapCanvas(null);
                  }}
                />
                <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.6);padding:0 4px;">
                  <span>Green: You • Blue line: A* Route • Space: Mars Jump (3.72 m/s²)</span>
                  <span>[M] / [ESC] Close</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  private renderVisorHud(
    wp: ScienceWaypoint,
    summary: ReturnType<typeof evaluateEvaRoute>,
    weather: typeof NOMINAL_MEDA_WEATHER,
  ) {
    const radRate =
      this.crisisMode === "spe_storm"
        ? Math.round(480 * (1 - (wp.radiationShieldingPct / 100) * 0.85))
        : Math.round(26.7 * (1 - (wp.radiationShieldingPct / 100) * 0.85));
    const nearest = this.getNearestWaypoint();
    const distLabel = nearest && nearest.wp.id === wp.id ? `${Math.round(nearest.distM)} m` : "—";

    return (
      <div
        key="pov-waypoint-inspector"
        style="position:fixed;top:64px;right:18px;width:296px;z-index:1090;padding:14px 16px;border-radius:18px;border:1px solid rgba(255,255,255,0.16);background:rgba(24,26,31,0.78);backdrop-filter:blur(28px) saturate(180%);box-shadow:0 18px 48px rgba(0,0,0,0.48),inset 0 1px 0 rgba(255,255,255,0.12);color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;pointer-events:auto;display:flex;flex-direction:column;gap:10px;"
      >
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div>
            <div style="font-size:10.5px;font-weight:600;color:#0a84ff;letter-spacing:0.03em;text-transform:uppercase;">
              {wp.instrumentSource}
            </div>
            <div style="font-size:14px;font-weight:600;margin-top:2px;">{wp.name}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.58);margin-top:1px;">
              {wp.lat.toFixed(5)}°N, {wp.lon.toFixed(5)}°E
            </div>
          </div>
          <button
            class={styles.iconBtn}
            style="padding:4px 9px;border-radius:999px;font-size:11px;"
            onclick={() => {
              this.visorOpen = false;
              this.scheduleRender();
            }}
          >
            Close [E]
          </button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <div style="padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.05);">
            <div style="font-size:10px;color:rgba(255,255,255,0.52);">Elevation</div>
            <div style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;">{wp.elevationM} m</div>
          </div>
          <div style="padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.05);">
            <div style="font-size:10px;color:rgba(255,255,255,0.52);">Local Slope</div>
            <div style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;">{wp.slopeDeg}°</div>
          </div>
          <div style="padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.05);">
            <div style="font-size:10px;color:rgba(255,255,255,0.52);">Sky Shielding</div>
            <div style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;">{wp.radiationShieldingPct}%</div>
          </div>
          <div style="padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.05);">
            <div style="font-size:10px;color:rgba(255,255,255,0.52);">Distance</div>
            <div style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;">{distLabel}</div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.68);padding-top:4px;border-top:1px solid rgba(255,255,255,0.08);">
          <span>Rad: {radRate} µSv/h</span>
          <span>O₂: {summary.o2RemainingMin} min</span>
          <span>MEDA: {weather.currentAirTempC}°C</span>
        </div>
      </div>
    );
  }
}
