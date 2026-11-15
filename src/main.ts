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
import "@esri/calcite-components/main.css";
import "@esri/calcite-components/components/calcite-loader";
import "./font-face/font-face.scss";
import "./general.scss";
import "./esri-widget-customizations.scss";
import Application from "./application/Application";
import {
  marsImageryBasemap,
  marsSR,
  marsElevation,
  marsNamesLayer,
  missionLayer,
} from "./utilities/layers";
import Map from "@arcgis/core/Map";
import { addFrameTask } from "@arcgis/core/core/scheduling";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import AppState from "./application/AppState";
import SceneView from "@arcgis/core/views/SceneView";
import { getMissionDataset } from "./eva/jezeroDataset";

const map = new Map({
  basemap: marsImageryBasemap,
  ground: {
    surfaceColor: [144, 106, 100],
    layers: [marsElevation],
  },
  layers: [marsNamesLayer, missionLayer],
});

const view = new SceneView({
  container: "viewDiv",
  map,
  qualityProfile: "medium",
  spatialReference: marsSR,
  environment: {
    lighting: {
      type: "virtual",
      directShadowsEnabled: false,
    },
  },
  camera: {
    position: {
      spatialReference: {
        wkid: 104971,
      },
      x: -57.10234077359152,
      y: -24.37565105257643,
      z: 839844.3044310743,
    },
    heading: 293.23407097843636,
    tilt: 43.952125030140685,
  },
  popup: {
    actions: [],
    dockEnabled: true,
    dockOptions: {
      buttonEnabled: false,
      position: "top-right",
      breakpoint: false,
    },
    visibleElements: {
      spinner: true,
      collapseButton: false,
    },
  },
  theme: {
    accentColor: "rgb(0,255,0)",
  },
});
view.ui.remove("attribution");

const spinGlobe = addFrameTask({
  update: () => {
    if (!AppState.route.match("landing")) {
      spinGlobe.remove();
      return;
    }
    if (!view.interacting) {
      const camera = view?.camera.clone();
      if (camera.position.longitude == null) {
        return;
      }

      camera.position.longitude -= 0.01;
      view.camera = camera;
    } else {
      spinGlobe.remove();
    }
  },
});

AppState.view = view;

const app = new Application({
  container: "application",
});

reactiveUtils.when(
  () => AppState.route.path !== "landing",
  () => {
    spinGlobe.remove();
    const ds = getMissionDataset(AppState.activeMissionId);
    void view.goTo(
      {
        center: [ds.camera.x, ds.camera.y],
        scale: 42000,
        heading: 0,
        tilt: 45,
      },
      { speedFactor: 0.75 },
    );
  },
);

(window as any).app = app;
(window as any).view = view;
