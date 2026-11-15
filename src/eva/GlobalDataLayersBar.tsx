import { property, subclass } from "@arcgis/core/core/accessorSupport/decorators";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import TileLayer from "@arcgis/core/layers/TileLayer";
import Widget from "@arcgis/core/widgets/Widget";
import { tsx } from "@arcgis/core/widgets/support/widget";
import AppState from "../application/AppState";
import {
  marsHiRiseImagery,
  marsImagery,
  marsImageryBasemap,
  marsNamesLayer,
} from "../utilities/layers";
import { sharedOverlayManager } from "./EvaOverlayManager";
import { getMissionDataset } from "./jezeroDataset";
import styles from "./GlobalDataLayersBar.module.scss";

export interface GlobalLayerDef {
  key: 1 | 2 | 3 | 4;
  id: string;
  label: string;
  title: string;
  astronautNote: string;
}

export const ESSENTIAL_DATA_MODES: GlobalLayerDef[] = [
  {
    key: 1,
    id: "optical",
    label: "Optical (MDIM + HiRISE)",
    title: "NASA/USGS MDIM 2.1 Color + HiRISE 0.25m Orbital Mosaic",
    astronautNote: "1. OPTICAL: True-color surface navigation, craters & obstacle check",
  },
  {
    key: 2,
    id: "topography",
    label: "Topography & Slope",
    title: "ESA HRSC + NASA MOLA Elevation (Globe) / Real-Time Slope Safety (3D POV)",
    astronautNote: "2. TOPOGRAPHY & SLOPE: Elevation & steepness (>24° red cliff hazard)",
  },
  {
    key: 3,
    id: "geology",
    label: "Geology (USGS)",
    title: "USGS Global Geologic Map of Mars (Tanaka et al., 2014)",
    astronautNote: "3. GEOLOGY: Volcanic, sedimentary & aqueous science target units",
  },
  {
    key: 4,
    id: "hazards",
    label: "Hazards & Radiation",
    title: "USGS Mars Digital Dune Sand-Traps (MGD3) + Radiation Shelters + 1m DTM",
    astronautNote: "4. HAZARDS & RADIATION: Sand traps (amber) & low-lying radiation shelters (cyan)",
  },
];

@subclass("ExploreMars.eva.GlobalDataLayersBar")
export class GlobalDataLayersBar extends Widget {
  @property()
  activeKey: 1 | 2 | 3 | 4 = 1;

  @property()
  pickingPov = false;

  private mapClickHandle: __esri.Handle | null = null;

  private shadedReliefOverlay = new TileLayer({
    id: "globalShadedReliefOverlay",
    portalItem: {
      id: "07b33bb3067747abbebd1ce34c29816e",
    },
    title: "Shaded Relief & Elevation",
    visible: false,
    opacity: 0.55,
    minScale: 0,
  });

  private geologyOverlay = new TileLayer({
    id: "globalUsgsGeologyOverlay",
    url: "https://tiles.arcgis.com/tiles/nzS0F0zdNLvs7nc8/arcgis/rest/services/Mars_geology_All_layers_100pct/MapServer",
    title: "USGS Global Geologic Map of Mars",
    visible: false,
    opacity: 0.58,
    minScale: 0,
  });

  private dunesLayer = new FeatureLayer({
    id: "globalUsgsDunesLayer",
    url: "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Mars_Dune_Digital_Database_Merged/FeatureServer/0",
    visible: false,
    minScale: 0,
    elevationInfo: { mode: "on-the-ground" },
    renderer: {
      type: "simple",
      symbol: {
        type: "simple-fill",
        color: [245, 158, 11, 0.45],
        outline: { color: [251, 191, 36, 0.95], width: 1.4 },
      },
    } as any,
    popupTemplate: {
      title: "USGS Mars Dune Field (Sand-Trap Hazard)",
      content: "Global Mars Digital Dune Database (MGD3)",
    },
  });

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    const match = e.code.match(/^(?:Digit|Numpad)([1-4])$/);
    if (!match) return;
    this.selectLayer(Number(match[1]) as 1 | 2 | 3 | 4);
  };

  postInitialize() {
    window.addEventListener("keydown", this.onKeyDown);
    this.addHandles([
      reactiveUtils.watch(
        () => AppState.view?.map,
        (map) => {
          if (!map) return;
          if (!map.findLayerById(this.shadedReliefOverlay.id)) {
            map.add(this.shadedReliefOverlay);
          }
          if (!map.findLayerById(this.geologyOverlay.id)) {
            map.add(this.geologyOverlay);
          }
          if (!map.findLayerById(this.dunesLayer.id)) {
            map.add(this.dunesLayer);
          }
          this.applyLayerState(this.activeKey);
        },
        { initial: true },
      ),
      reactiveUtils.watch(
        () => AppState.activeMissionId,
        () => {
          this.applyLayerState(this.activeKey);
        },
      ),
    ]);
  }

  destroy() {
    window.removeEventListener("keydown", this.onKeyDown);
    this.mapClickHandle?.remove();
    this.mapClickHandle = null;
  }

  private togglePickPov() {
    const view = AppState.view;
    if (!view) return;
    if (this.pickingPov) {
      this.pickingPov = false;
      AppState.activeInteractionMode = "none";
      if (view.container) view.container.style.cursor = "";
      this.mapClickHandle?.remove();
      this.mapClickHandle = null;
      this.scheduleRender();
      return;
    }
    this.pickingPov = true;
    AppState.activeInteractionMode = "pov";
    if (view.container) view.container.style.cursor = "crosshair";
    this.mapClickHandle?.remove();
    this.mapClickHandle = view.on("click", (event) => {
      if (!event.mapPoint || AppState.activeInteractionMode !== "pov") return;
      const lon = event.mapPoint.longitude ?? event.mapPoint.x;
      const lat = event.mapPoint.latitude ?? event.mapPoint.y;
      this.pickingPov = false;
      AppState.activeInteractionMode = "none";
      if (view.container) view.container.style.cursor = "";
      this.mapClickHandle?.remove();
      this.mapClickHandle = null;
      AppState.pendingPovTarget = { lon, lat };
      this.scheduleRender();
    });
    this.scheduleRender();
  }

  private selectLayer(keyNum: 1 | 2 | 3 | 4) {
    this.activeKey = keyNum;
    this.applyLayerState(keyNum);
    this.scheduleRender();
  }

  private applyLayerState(keyNum: 1 | 2 | 3 | 4) {
    const view = AppState.view;
    const map = view?.map;
    if (!map || !view) return;

    sharedOverlayManager.attachToView(view);
    if (map.basemap !== marsImageryBasemap) {
      map.basemap = marsImageryBasemap;
    }

    marsImagery.opacity = 1;
    marsHiRiseImagery.visible = true;
    marsHiRiseImagery.minScale = 250000;
    marsHiRiseImagery.opacity = keyNum === 1 ? 0.42 : 0.25;

    this.shadedReliefOverlay.visible = keyNum === 2;
    this.geologyOverlay.visible = keyNum === 3;
    this.dunesLayer.visible = keyNum === 4;
    marsNamesLayer.visible = keyNum === 4 || keyNum === 1;

    sharedOverlayManager.hiResZoneLayer.visible = true;
    sharedOverlayManager.updateHazards({
      hiResZones: true,
      slopeHazards: keyNum === 2 || keyNum === 1,
      crismMineralogy: keyNum === 3 || keyNum === 1,
      thermalSandTraps: keyNum === 4 || keyNum === 1,
      radiationShelters: keyNum === 4 || keyNum === 1,
      evaRoute: true,
    });

    const ds = getMissionDataset(AppState.activeMissionId);
    const centerLon = ds.waypoints[0]?.lon ?? ds.camera.x;
    const centerLat = ds.waypoints[0]?.lat ?? ds.camera.y;
    void sharedOverlayManager.updateTerrainModeHeatmap(
      keyNum,
      centerLon,
      centerLat,
    );
  }

  render() {
    const activeLayer =
      ESSENTIAL_DATA_MODES.find((l) => l.key === this.activeKey) ??
      ESSENTIAL_DATA_MODES[0];

    return (
      <div>
        <div class={styles.wrap}>
          <div class={styles.contextPill}>{activeLayer.astronautNote}</div>
          <div class={styles.bar}>
            {ESSENTIAL_DATA_MODES.map((layer) => {
              const isActive = layer.key === this.activeKey;
              return (
                <button
                  key={layer.id}
                  class={`${styles.btn} ${isActive ? styles.btnActive : ""}`}
                  onclick={() => this.selectLayer(layer.key)}
                  title={layer.title}
                >
                  <span class={styles.keyBadge}>{layer.key}</span>
                  <span>{layer.label}</span>
                </button>
              );
            })}
            <button
              class={styles.btn}
              style={
                this.pickingPov
                  ? "background:#0a84ff;color:#ffffff;font-weight:600;"
                  : "background:rgba(10,132,255,0.22);color:#ffffff;font-weight:600;"
              }
              onclick={() => this.togglePickPov()}
              title="Click anywhere on Mars to land in 3D Surface POV"
            >
              <span>{this.pickingPov ? "Click Map…" : "Land 3D POV"}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
