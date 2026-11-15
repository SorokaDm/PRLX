import { property, subclass } from "@arcgis/core/core/accessorSupport/decorators";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import Widget from "@arcgis/core/widgets/Widget";
import { tsx } from "@arcgis/core/widgets/support/widget";
import Camera from "@arcgis/core/Camera";
import AppState from "../application/AppState";
import { HIGH_DETAIL_ZONES, type HighDetailZone } from "./highDetailZones";
import { sharedOverlayManager } from "./EvaOverlayManager";
import styles from "./HighDetailZonesMenu.module.scss";

@subclass("ExploreMars.eva.HighDetailZonesMenu")
export class HighDetailZonesMenu extends Widget {
  @property()
  expanded = false;

  @property()
  activeZoneId = HIGH_DETAIL_ZONES[0].id;

  postInitialize() {
    this.addHandles(
      reactiveUtils.watch(
        () => [AppState.route.path, AppState.surfacePovActive],
        () => this.scheduleRender(),
      ),
    );
    this.addHandles(
      reactiveUtils.watch(
        () => AppState.view?.map,
        (map) => {
          if (!map || !AppState.view) return;
          sharedOverlayManager.attachToView(AppState.view);
          if (sharedOverlayManager.hiResZoneLayer.graphics.length === 0) {
            sharedOverlayManager.updateHazards({
              hiResZones: true,
              slopeHazards: false,
              thermalSandTraps: false,
              crismMineralogy: false,
              radiationShelters: false,
              evaRoute: false,
            });
          }
        },
        { initial: true },
      ),
    );
  }

  private syncMissionForZone(zoneId: string) {
    if (zoneId === "gale-crater") AppState.activeMissionId = "gale";
    else if (zoneId === "candor-chasma") AppState.activeMissionId = "candor";
    else if (zoneId === "oxia-planum") AppState.activeMissionId = "oxia";
    else if (zoneId === "jezero-delta") AppState.activeMissionId = "jezero";
  }

  private flyToZone(zone: HighDetailZone) {
    this.activeZoneId = zone.id;
    this.syncMissionForZone(zone.id);
    const view = AppState.view;
    if (!view) return;
    const cam = new Camera({
      position: {
        x: zone.lon,
        y: zone.lat - 0.08,
        z: zone.altitudeM,
        spatialReference: { wkid: 104971 },
      },
      heading: zone.heading,
      tilt: zone.tilt,
    });
    void view.goTo(cam, { duration: 1400 });
  }

  private launchZonePov(e: Event, zone: HighDetailZone) {
    e.stopPropagation();
    this.activeZoneId = zone.id;
    this.syncMissionForZone(zone.id);
    AppState.pendingPovTarget = { lon: zone.lon, lat: zone.lat };
    if (!AppState.route.match("eva")) {
      AppState.route.push("eva");
    }
  }

  render() {
    return (
      <div>
        <div class={styles.container}>
          <button
            class={styles.toggleBtn}
            onclick={() => {
              this.expanded = !this.expanded;
            }}
            title="Список високодеталізованих зон HiRISE на Марсі"
          >
            <span class={styles.toggleLeft}>
              <span class={styles.star}>★</span>
              <span>High-Detail Zones</span>
              <span class={styles.countPill}>{HIGH_DETAIL_ZONES.length}</span>
            </span>
            <span>{this.expanded ? "▴" : "▾"}</span>
          </button>

          {this.expanded ? (
            <div class={styles.dropdown}>
              {HIGH_DETAIL_ZONES.map((zone) => {
                const isActive = zone.id === this.activeZoneId;
                return (
                  <div
                    key={zone.id}
                    class={`${styles.zoneCard} ${isActive ? styles.zoneCardActive : ""}`}
                    onclick={() => this.flyToZone(zone)}
                  >
                    <div class={styles.zoneHeader}>
                      <span class={styles.zoneName}>{zone.name}</span>
                      <span
                        class={
                          zone.isHyperlocalDtm
                            ? styles.badgeDtm
                            : styles.badgeOrbital
                        }
                      >
                        {zone.isHyperlocalDtm ? "HiRISE 1m DTM" : "HiRISE Orbital"}
                      </span>
                    </div>
                    <div class={styles.zoneMeta}>
                      <span>
                        {zone.mission} • {zone.lat.toFixed(2)}°N,{" "}
                        {zone.lon.toFixed(2)}°E
                      </span>
                      <button
                        class={styles.povBtn}
                        onclick={(e: Event) => this.launchZonePov(e, zone)}
                        title="Висадитися у 3D Surface POV"
                      >
                        3D POV
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }
}
