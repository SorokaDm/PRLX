/* Copyright 2023 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { tsx } from "@arcgis/core/widgets/support/widget";
import AppState from "../application/AppState";
import styles from "./HomePage.module.scss";
import cx from "classnames";

interface LandingPageProps {
  hidden: boolean;
  onStart: () => void;
}

export function LandingPage({ onStart, hidden }: LandingPageProps) {
  const launchMission = (mission: "jezero" | "gale" | "candor" | "oxia") => {
    AppState.activeMissionId = mission;
    onStart();
  };

  return (
    <div class={cx(styles.landingPage, { [styles.hidden]: hidden })}>
      <div class={styles.content}>
        <div class={styles.eyebrow}>PRLX • MARS SURFACE OPERATIONS</div>
        <h1 class={styles.heading}>PRLX</h1>
        <p class={styles.lead}>
          1-meter HiRISE terrain navigation, A* hazard-avoidance routing, and
          real-time astronaut helmet POV.
        </p>

        <div class={styles.missionGrid}>
          <button
            class={styles.missionCard}
            onclick={() => launchMission("jezero")}
          >
            <div class={styles.missionTag}>1m DTM • Perseverance</div>
            <div class={styles.missionName}>Jezero Delta</div>
            <div class={styles.missionDesc}>
              Ancient river delta carbonates &amp; cliff shelters
            </div>
            <div class={styles.missionCta}>Start Mission →</div>
          </button>

          <button
            class={styles.missionCard}
            onclick={() => launchMission("gale")}
          >
            <div class={styles.missionTag}>1m DTM • Curiosity</div>
            <div class={styles.missionName}>Gale Boxwork</div>
            <div class={styles.missionDesc}>
              Mount Sharp sulfate ridges &amp; Vera Rubin scarp
            </div>
            <div class={styles.missionCta}>Start Mission →</div>
          </button>

          <button
            class={styles.missionCard}
            onclick={() => launchMission("candor")}
          >
            <div class={styles.missionTag}>1m DTM • Valles Marineris</div>
            <div class={styles.missionName}>Candor Chasma</div>
            <div class={styles.missionDesc}>
              Layered canyon walls &amp; deep radiation-sheltered troughs
            </div>
            <div class={styles.missionCta}>Start Mission →</div>
          </button>

          <button
            class={styles.missionCard}
            onclick={() => launchMission("oxia")}
          >
            <div class={styles.missionTag}>1m DTM • ExoMars</div>
            <div class={styles.missionName}>Oxia Planum</div>
            <div class={styles.missionDesc}>
              Clay-bearing ancient plains &amp; low-slope rover corridors
            </div>
            <div class={styles.missionCta}>Start Mission →</div>
          </button>
        </div>
      </div>
    </div>
  );
}
