<img width="2040" height="657" alt="image" src="https://github.com/user-attachments/assets/86fedc65-fcd3-4feb-9d12-7b13ec7e8535" />
# PRLX — Mars Surface EVA Navigation & 3D POV

**PRLX** is an interactive Mars surface operations and EVA (extravehicular activity) route-planning platform built on real **1-meter NASA HiRISE Digital Terrain Models (DTM)**, orbital imagery, and a real-time first-person 3D surface POV simulator.

🎥 **[Watch 30-Second Demo Video](https://drive.google.com/file/d/1v5gWNWIk_j1LFEksZMr6s0oVxdgw29s1/view?usp=sharing)**

---

## Key Capabilities

- **4 High-Resolution 1m HiRISE Landing Zones**:
  - **Jezero Delta** (Perseverance)
  - **Gale Boxwork** (Curiosity)
  - **Candor Chasma** (Valles Marineris)
  - **Oxia Planum** (ExoMars)
- **A\* Terrain-Aware Route Planning** (`src/eva/dtmAnalyzer.ts`):
  - Place custom waypoints directly on the Mars globe (`+ Waypoint`), reorder stops (`↑` / `↓`), or auto-optimize (`Auto Safe`).
  - Full 2D terrain-gradient A\* pathfinding penalizes steep cliffs/descents (`>20°` On Foot, `>15°` Rover) and routes along flat valley floors.
  - Real-time elevation profile chart, **UHF Line-of-Sight (LOS)** obstruction check, oxygen consumption, and JSON plan export.
- **4 Orbital & Surface Data Modes** (`1`–`4`):
  1. **Optical (MDIM + HiRISE)** — True-color orbital mosaic & local surface view
  2. **Topography & Slope** — Shaded relief + real-time 1m DTM slope hazard heatmap
  3. **Geology (USGS)** — Global USGS geologic map + elevation stratigraphy
  4. **Hazards & Radiation** — USGS Mars Digital Dune Database (MGD3) + topographic sky-shielding & exposure map
- **First-Person 3D Surface POV** (`src/eva/SurfacePovEngine.ts`):
  - Walk/sprint (`WASD` + `Shift`) across real 1m HiRISE terrain with Martian gravity jumping (`Space`, `3.72 m/s²`).
  - Player-centered scrolling minimap + **`[M]` Full Tactical Map** overview fitting the entire route.
  - **`[P]` Pin** field markers and **`[E]` Waypoint Inspector** showing real DTM elevation, slope, coordinates, and sky-shielding.

---

## Run Locally

```bash
git clone https://github.com/SorokaDm/PRLX.git
cd PRLX
npm install
npm run dev
```

Then open `http://localhost:3000/` in your browser.

---

## Tech Stack & Data Sources

- **3D Globe & GIS**: [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/) (`SceneView`, custom `JezeroElevationLayer`, `wkid: 104971` Mars 2000)
- **3D Surface Engine**: [Three.js](https://threejs.org/) (`WebGLRenderer`, 1m HiRISE DTM meshes, custom sky dome)
- **Data**: NASA/JPL/University of Arizona HiRISE 1m DTM, USGS MDIM 2.1, USGS Global Geologic Map of Mars, USGS MGD3 Dunes, NASA DONKI Space Weather API
- **Tooling**: TypeScript, Vite, Sass

---

## Attribution & Licensing

Built on top of the open-source [Esri/explore-mars](https://github.com/Esri/explore-mars) template (Apache License 2.0) for the base ArcGIS Mars `SceneView` and orbital layers. All PRLX EVA mission planning, A\* 1m DTM pathfinding, 3D surface POV, tactical mapping, and UI modules (`src/eva/*`, `src/home/HomePage.tsx`) were developed for this hackathon project.

Copyright 2024 Esri (base template) & PRLX Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

A copy of the license is available in [license.txt](./license.txt).
