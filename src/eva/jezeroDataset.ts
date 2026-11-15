export interface ScienceWaypoint {
  id: string;
  name: string;
  subtitle: string;
  lon: number; // East longitude (wkid 104971)
  lat: number; // Planetocentric latitude
  elevationM: number;
  slopeDeg: number;
  thermalInertia: number; // J m^-2 K^-1 s^-1/2 (THEMIS)
  surfaceType: "Bedrock" | "Regolith" | "Aeolian Sand" | "Delta Scarp";
  minerals: string[];
  instrumentSource: string;
  sciencePriority: "CRITICAL" | "HIGH" | "MODERATE" | "SHELTER";
  biosignatureScore: number; // 0-100
  radiationShieldingPct: number; // % sky hemisphere blocked by local terrain
  rimfaxDepthNote: string;
  rimfaxLayers: { depthM: number; label: string; permittivity: number }[];
  povSummary: string;
  povImageUrl: string;
  sol: number;
}

export interface HazardZone {
  id: string;
  name: string;
  type: "slope" | "sand" | "radiation_shelter" | "science_crism";
  severity: "low" | "moderate" | "high" | "shelter";
  description: string;
  rings: [number, number][][]; // [lon, lat]
}

export interface MedaWeather {
  sol: number;
  airTempMinC: number;
  airTempMaxC: number;
  currentAirTempC: number;
  groundTempC: number;
  windSpeedMs: number;
  windDir: string;
  pressurePa: number;
  dustTau: number; // Optical depth
}

export interface SpaceWeatherState {
  source: "NASA DONKI LIVE" | "CACHED TELEMETRY";
  gcrBackgroundMsvDay: number;
  speAlertActive: boolean;
  flareClass: string;
  protonFluxPfu: number;
  lastUpdated: string;
}

export const JEZERO_BASE_COORDS = {
  lon: 77.4509,
  lat: 18.4446,
  name: "Octavia E. Butler Hab / Base",
};

export const JEZERO_WAYPOINTS: ScienceWaypoint[] = [
  {
    id: "wp-base",
    name: "Octavia E. Butler Hab",
    subtitle: "Pressurized Habitat & Utility Rover Dock",
    lon: 77.4509,
    lat: 18.4446,
    elevationM: -2569,
    slopeDeg: 2.1,
    thermalInertia: 340,
    surfaceType: "Regolith",
    minerals: ["Basaltic Regolith", "Olivine-rich Sand"],
    instrumentSource: "HiRISE + Ingenuity Orthomosaic",
    sciencePriority: "MODERATE",
    biosignatureScore: 15,
    radiationShieldingPct: 12,
    rimfaxDepthNote: "3.2m compacted regolith over fractured igneous floor",
    rimfaxLayers: [
      { depthM: 0, label: "Compacted Regolith", permittivity: 3.1 },
      { depthM: 3.2, label: "Fractured Séítah Basalt", permittivity: 6.8 },
      { depthM: 11.5, label: "Deep Igneous Basement", permittivity: 8.4 },
    ],
    povSummary:
      "Flat landing plain with scattered cobbles and clear line-of-sight toward the Western Delta scarp to the northwest.",
    povImageUrl:
      "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00003/ids/edr/browse/zcam/ZL0_0003_0667213301_000FDR_N0010052ZCAM00010_1100LMJ01_1200.jpg",
    sol: 3,
  },
  {
    id: "wp-three-forks",
    name: "Three Forks Delta Base",
    subtitle: "Ancient River Delta Front & Alluvial Fan",
    lon: 77.4165,
    lat: 18.4622,
    elevationM: -2548,
    slopeDeg: 7.4,
    thermalInertia: 485,
    surfaceType: "Bedrock",
    minerals: ["Carbonates", "Fe/Mg Smectite Clays", "Olivine"],
    instrumentSource: "MRO CRISM + SuperCam",
    sciencePriority: "HIGH",
    biosignatureScore: 68,
    radiationShieldingPct: 22,
    rimfaxDepthNote: "Dipping foreset beds (15°–22°); paleo-lake shoreline contact",
    rimfaxLayers: [
      { depthM: 0, label: "Alluvial Mudstone", permittivity: 4.2 },
      { depthM: 4.8, label: "Dipping Delta Foresets", permittivity: 5.9 },
      { depthM: 13.0, label: "Lakebed Siltstone", permittivity: 7.1 },
    ],
    povSummary:
      "Layered sedimentary benches rising above the crater floor; exposed carbonate-bearing outcrops ideal for hand-lens inspection.",
    povImageUrl:
      "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00415/ids/edr/browse/zcam/ZR0_0415_0703784624_428FDR_N0240000ZCAM08420_1100LMJ01_1200.jpg",
    sol: 415,
  },
  {
    id: "wp-hogwallow",
    name: "Hogwallow Flats",
    subtitle: "Fine-Grained Sulfate & Clay Mudstones",
    lon: 77.4032,
    lat: 18.4718,
    elevationM: -2526,
    slopeDeg: 11.8,
    thermalInertia: 520,
    surfaceType: "Bedrock",
    minerals: ["Calcium Sulfate", "Phyllosilicates", "Aromatic Organics"],
    instrumentSource: "SHERLOC + PIXL",
    sciencePriority: "HIGH",
    biosignatureScore: 84,
    radiationShieldingPct: 26,
    rimfaxDepthNote: "Horizontal lacustrine laminations down to 9m",
    rimfaxLayers: [
      { depthM: 0, label: "Sulfate-rich Mudstone", permittivity: 4.5 },
      { depthM: 5.5, label: "Clay-rich Lacustrine Bed", permittivity: 5.3 },
      { depthM: 12.2, label: "Basal Sandstone", permittivity: 6.7 },
    ],
    povSummary:
      "Light-toned, finely laminated mudstone slabs. High scientific priority for astrobiology core extraction; moderate slope requires careful footing.",
    povImageUrl:
      "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00462/ids/edr/browse/zcam/ZL0_0462_0707957364_092FDR_N0260000ZCAM08456_1100LMJ01_1200.jpg",
    sol: 462,
  },
  {
    id: "wp-cheyava",
    name: "Bright Angel / Cheyava Falls",
    subtitle: "Leopard-Spot Organic & Vivianite Vein Site",
    lon: 77.3868,
    lat: 18.4835,
    elevationM: -2498,
    slopeDeg: 14.2,
    thermalInertia: 590,
    surfaceType: "Bedrock",
    minerals: [
      "Organic Carbon",
      "Iron Phosphate (Vivianite)",
      "Calcium Sulfate Veins",
      "Hematite",
    ],
    instrumentSource: "PIXL + SHERLOC + Watson",
    sciencePriority: "CRITICAL",
    biosignatureScore: 96,
    radiationShieldingPct: 31,
    rimfaxDepthNote: "Paleo-channel margin with mineralized fracture network",
    rimfaxLayers: [
      { depthM: 0, label: "Reddish Mudstone (Cheyava)", permittivity: 4.7 },
      { depthM: 3.9, label: "Sulfate-filled Fractures", permittivity: 5.8 },
      { depthM: 10.4, label: "Neretva Channel Gravel", permittivity: 7.4 },
    ],
    povSummary:
      "Arrowhead-shaped bedrock slab with white calcium sulfate veins and millimeter-scale 'leopard spots'—highest astrobiological priority in Jezero.",
    povImageUrl:
      "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/01215/ids/edr/browse/zcam/ZL0_1215_0774746161_852FDR_N0542178ZCAM09248_1100LMJ01_1200.jpg",
    sol: 1215,
  },
  {
    id: "wp-kodiak",
    name: "Kodiak Butte Shelter",
    subtitle: "Steep Delta Remnant & Topographic Radiation Shield",
    lon: 77.3945,
    lat: 18.4555,
    elevationM: -2482,
    slopeDeg: 19.6,
    thermalInertia: 640,
    surfaceType: "Delta Scarp",
    minerals: ["Cross-bedded Sandstone", "Conglomerate"],
    instrumentSource: "HiRISE DTM + MSL RAD Shielding Model",
    sciencePriority: "SHELTER",
    biosignatureScore: 42,
    radiationShieldingPct: 47,
    rimfaxDepthNote: "Dense consolidated sandstone bluff; 47% sky-hemisphere shielding",
    rimfaxLayers: [
      { depthM: 0, label: "Consolidated Conglomerate", permittivity: 6.2 },
      { depthM: 6.0, label: "Cross-bedded Sandstone", permittivity: 6.9 },
      { depthM: 14.0, label: "Dense Bedrock Core", permittivity: 8.1 },
    ],
    povSummary:
      "Steep, flat-topped remnant mesa. Overhangs at the northern cliff base block nearly half the sky, cutting Solar Particle Event radiation dose by ~47%.",
    povImageUrl:
      "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00142/ids/edr/browse/zcam/ZL0_0142_0679547910_046FDR_N0050000ZCAM08057_1100LMJ01_1200.jpg",
    sol: 142,
  },
];

export const JEZERO_HAZARD_ZONES: HazardZone[] = [
  {
    id: "hz-sand-seitah",
    name: "Séítah Aeolian Sand Trap",
    type: "sand",
    severity: "high",
    description:
      "THEMIS Thermal Inertia < 190 TIU: Deep loose ripple sand. High risk of rover wheel sinkage and 1.45x astronaut metabolic fatigue.",
    rings: [
      [
        [77.428, 18.448],
        [77.442, 18.448],
        [77.444, 18.456],
        [77.431, 18.458],
        [77.428, 18.448],
      ],
    ],
  },
  {
    id: "hz-slope-scarp",
    name: "Western Delta Cliff Scarp (>24° Slope)",
    type: "slope",
    severity: "high",
    description:
      "HiRISE 1m DTM Slope > 24°: Exceeds xEMU spacesuit safe ascent limit. Fall & suit-puncture hazard.",
    rings: [
      [
        [77.406, 18.466],
        [77.413, 18.467],
        [77.411, 18.476],
        [77.403, 18.474],
        [77.406, 18.466],
      ],
    ],
  },
  {
    id: "hz-neretva-channel",
    name: "Neretva Vallis Boulder & Sand Floor",
    type: "sand",
    severity: "moderate",
    description:
      "THEMIS Thermal Inertia ~235 TIU: Mixed loose sand and meter-scale boulders. Rover speed restricted to 0.4 m/s.",
    rings: [
      [
        [77.389, 18.476],
        [77.399, 18.477],
        [77.397, 18.485],
        [77.387, 18.484],
        [77.389, 18.476],
      ],
    ],
  },
  {
    id: "hz-crism-clay",
    name: "CRISM Phyllosilicate & Carbonate Belt",
    type: "science_crism",
    severity: "low",
    description:
      "MRO CRISM spectral signature: Strong Fe/Mg-smectite & carbonate absorption bands (2.30–2.53 µm). Prime astrobiology zone.",
    rings: [
      [
        [77.398, 18.467],
        [77.406, 18.468],
        [77.404, 18.479],
        [77.394, 18.477],
        [77.398, 18.467],
      ],
    ],
  },
  {
    id: "hz-kodiak-shelter",
    name: "Kodiak Butte SPE Radiation Shelter Zone",
    type: "radiation_shelter",
    severity: "shelter",
    description:
      "Topographic sky-shielding > 45% along northern cliff base. Designated emergency shelter for Solar Particle Events.",
    rings: [
      [
        [77.391, 18.453],
        [77.398, 18.453],
        [77.398, 18.458],
        [77.391, 18.458],
        [77.391, 18.453],
      ],
    ],
  },
];

// --- GALE CRATER / MOUNT SHARP BOXWORK MISSION (NASA Challenge Example) ---
// Valid HiRISE 1m DTM bounds: 137.429..137.545 E, -4.701..-4.413 N
export const GALE_BASE_COORDS = {
  lon: 137.472,
  lat: -4.588,
  elevationM: -4120,
};

export const GALE_WAYPOINTS: ScienceWaypoint[] = [
  {
    id: "wp-gale-hab",
    name: "Bradbury / Aeolis Palus Hab",
    subtitle: "Pressurized Habitat & Rover Charging Depot",
    lon: 137.472,
    lat: -4.588,
    elevationM: -4120,
    slopeDeg: 2.8,
    thermalInertia: 410,
    surfaceType: "Regolith",
    minerals: ["Basaltic Mudstone", "Dust Veneer"],
    instrumentSource: "HiRISE 1m DTM + THEMIS TI",
    sciencePriority: "CRITICAL",
    biosignatureScore: 42,
    radiationShieldingPct: 30,
    rimfaxDepthNote: "3.5 m compacted mudstone over basaltic basement.",
    rimfaxLayers: [
      { depthM: 1.5, label: "Compacted Regolith", permittivity: 4.1 },
      { depthM: 6.0, label: "Lacustrine Mudstone", permittivity: 6.4 },
    ],
    povSummary:
      "Primary pressurized habitat & rover charging depot at the base of Aeolis Mons (Mount Sharp).",
    povImageUrl:
      "https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/04102/opgs/edr/ncam/NLB_761645828EDR_F1060660NCAM00253M_.JPG",
    sol: 4102,
  },
  {
    id: "wp-gale-boxwork",
    name: "Mount Sharp Boxwork Formations",
    subtitle: "Mineralized Groundwater Ridge Network",
    lon: 137.486,
    lat: -4.618,
    elevationM: -3965,
    slopeDeg: 11.4,
    thermalInertia: 465,
    surfaceType: "Bedrock",
    minerals: ["Mg-Sulfate", "Fracture-Fill Cemented Ridges"],
    instrumentSource: "MRO CRISM + Curiosity ChemCam",
    sciencePriority: "CRITICAL",
    biosignatureScore: 95,
    radiationShieldingPct: 26,
    rimfaxDepthNote: "12 m+ cemented sulfate fracture veins.",
    rimfaxLayers: [
      { depthM: 2.0, label: "Sulfate Boxwork Cap", permittivity: 7.2 },
      { depthM: 10.0, label: "Fractured Sulfate Unit", permittivity: 8.6 },
    ],
    povSummary:
      "Spiderweb-like mineralized ridges formed by ancient subsurface groundwater; top NASA astrobiology target.",
    povImageUrl:
      "https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/04200/opgs/edr/ncam/NLB_770341446EDR_F1080000NCAM00295M_.JPG",
    sol: 4200,
  },
  {
    id: "wp-gale-torridon",
    name: "Glen Torridon Clay Trough",
    subtitle: "CRISM Phyllosilicate Lacustrine Basin",
    lon: 137.463,
    lat: -4.629,
    elevationM: -4040,
    slopeDeg: 6.5,
    thermalInertia: 350,
    surfaceType: "Regolith",
    minerals: ["Smectite Clay (CRISM Phyllosilicate Peak)"],
    instrumentSource: "MRO CRISM + SAM",
    sciencePriority: "HIGH",
    biosignatureScore: 86,
    radiationShieldingPct: 38,
    rimfaxDepthNote: "8 m stratified clay-bearing mudstone.",
    rimfaxLayers: [
      { depthM: 1.8, label: "Clay-Rich Siltstone", permittivity: 5.8 },
      { depthM: 8.2, label: "Murray Formation", permittivity: 7.5 },
    ],
    povSummary:
      "Clay-bearing lacustrine trough with low wheel slip and moderate ridge shielding.",
    povImageUrl:
      "https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/02555/opgs/edr/ncam/NLB_624321163EDR_S0771636NCAM00253M_.JPG",
    sol: 2555,
  },
  {
    id: "wp-gale-vera-rubin",
    name: "Vera Rubin Ridge Hematite Scarp",
    subtitle: "Emergency SPE Cliff Shelter (>45% Sky Block)",
    lon: 137.495,
    lat: -4.602,
    elevationM: -3895,
    slopeDeg: 18.2,
    thermalInertia: 510,
    surfaceType: "Delta Scarp",
    minerals: ["Crystalline Hematite", "Iron Oxide Caprock"],
    instrumentSource: "HiRISE 1m DTM + RAD",
    sciencePriority: "SHELTER",
    biosignatureScore: 68,
    radiationShieldingPct: 48,
    rimfaxDepthNote: "Solid indurated hematite-cemented ridge.",
    rimfaxLayers: [
      { depthM: 3.0, label: "Hematite Caprock", permittivity: 9.1 },
      { depthM: 12.0, label: "Basalt Basement", permittivity: 9.5 },
    ],
    povSummary:
      "Steep erosion-resistant ridge; cliff overhang provides emergency SPE radiation shelter (>45% sky block).",
    povImageUrl:
      "https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/02275/opgs/edr/ncam/NLB_599464774EDR_S0732300NCAM00253M_.JPG",
    sol: 2275,
  },
];

export const GALE_HAZARD_ZONES: HazardZone[] = [
  {
    id: "hz-gale-gediz-scarp",
    name: "Gediz Vallis Steep Scarp (>24°)",
    type: "slope",
    severity: "high",
    description:
      "HiRISE 1m DTM slope > 24°. High boulder talus & suit stability hazard; avoid direct ascent.",
    rings: [
      [
        [137.476, -4.612],
        [137.484, -4.612],
        [137.484, -4.623],
        [137.476, -4.623],
        [137.476, -4.612],
      ],
    ],
  },
  {
    id: "hz-gale-bagnold-sand",
    name: "Bagnold Dark Sand Drift (Low TIU)",
    type: "sand",
    severity: "moderate",
    description:
      "THEMIS Thermal Inertia ~215 TIU: Active basaltic dune ripples. High rover sinkage & O2 penalty.",
    rings: [
      [
        [137.462, -4.596],
        [137.471, -4.596],
        [137.471, -4.607],
        [137.462, -4.607],
        [137.462, -4.596],
      ],
    ],
  },
  {
    id: "hz-gale-boxwork-crism",
    name: "Mount Sharp Sulfate Boxwork Belt",
    type: "science_crism",
    severity: "low",
    description:
      "MRO CRISM hydrated sulfate & fracture-cemented ridge signature. High-priority habitability zone.",
    rings: [
      [
        [137.482, -4.614],
        [137.493, -4.614],
        [137.493, -4.625],
        [137.482, -4.625],
        [137.482, -4.614],
      ],
    ],
  },
  {
    id: "hz-gale-rubin-shelter",
    name: "Vera Rubin Cliff SPE Shelter",
    type: "radiation_shelter",
    severity: "shelter",
    description:
      "Topographic sky-shielding ~48% along steep hematite scarp. Designated Solar Particle Event shelter.",
    rings: [
      [
        [137.491, -4.598],
        [137.499, -4.598],
        [137.499, -4.606],
        [137.491, -4.606],
        [137.491, -4.598],
      ],
    ],
  },
];

// --- CANDOR CHASMA (VALLES MARINERIS) ---
export const CANDOR_WAYPOINTS: ScienceWaypoint[] = [
  {
    id: "wp-candor-hab",
    name: "Candor Plateau Landing Pad",
    subtitle: "Canyon Rim Operations Base",
    lon: -76.928,
    lat: -6.47,
    elevationM: 1020,
    slopeDeg: 3.5,
    thermalInertia: 390,
    surfaceType: "Regolith",
    minerals: ["Basaltic Regolith", "Polyhydrated Sulfates"],
    instrumentSource: "HiRISE 1m DTM",
    sciencePriority: "CRITICAL",
    biosignatureScore: 55,
    radiationShieldingPct: 28,
    rimfaxDepthNote: "Layered sulfate deposits above tectonic trough.",
    rimfaxLayers: [{ depthM: 2.0, label: "Sulfate Crust", permittivity: 5.5 }],
    povSummary: "Elevated bench overlooking the Candor Chasma layered mounds.",
    povImageUrl: JEZERO_WAYPOINTS[0].povImageUrl,
    sol: 1,
  },
  {
    id: "wp-candor-mound",
    name: "Candor Layered Sulfate Mound",
    subtitle: "Aqueous Sulfate Stratigraphy",
    lon: -76.915,
    lat: -6.458,
    elevationM: 1185,
    slopeDeg: 14.2,
    thermalInertia: 470,
    surfaceType: "Bedrock",
    minerals: ["Kieserite", "Polyhydrated Sulfates", "Hematite"],
    instrumentSource: "MRO CRISM + HiRISE",
    sciencePriority: "CRITICAL",
    biosignatureScore: 82,
    radiationShieldingPct: 35,
    rimfaxDepthNote: "Alternating light-toned sulfate and dark basaltic beds.",
    rimfaxLayers: [{ depthM: 4.0, label: "Layered Sulfates", permittivity: 6.9 }],
    povSummary: "Steep layered mound preserving ancient Valles Marineris groundwater history.",
    povImageUrl: JEZERO_WAYPOINTS[2].povImageUrl,
    sol: 14,
  },
  {
    id: "wp-candor-shelter",
    name: "Candor Canyon Wall Shelter",
    subtitle: "High-Wall SPE Radiation Shield",
    lon: -76.942,
    lat: -6.484,
    elevationM: 860,
    slopeDeg: 17.5,
    thermalInertia: 520,
    surfaceType: "Delta Scarp",
    minerals: ["Indurated Basalt", "Iron Oxide"],
    instrumentSource: "HiRISE 1m DTM + RAD",
    sciencePriority: "SHELTER",
    biosignatureScore: 40,
    radiationShieldingPct: 54,
    rimfaxDepthNote: "Deep canyon wall blocks >50% of cosmic/solar sky hemisphere.",
    rimfaxLayers: [{ depthM: 5.0, label: "Canyon Bedrock", permittivity: 8.8 }],
    povSummary: "Natural canyon wall alcove providing 54% SPE sky-shielding.",
    povImageUrl: JEZERO_WAYPOINTS[1].povImageUrl,
    sol: 22,
  },
];

export const CANDOR_HAZARD_ZONES: HazardZone[] = [
  {
    id: "hz-candor-scarp",
    name: "Candor Canyon Scarp (>25°)",
    type: "slope",
    severity: "high",
    description: "Steep Valles Marineris tectonic cliff face. Avoid direct descent.",
    rings: [[[-76.924, -6.462], [-76.916, -6.462], [-76.916, -6.471], [-76.924, -6.471], [-76.924, -6.462]]],
  },
  {
    id: "hz-candor-shelter",
    name: "Candor Wall SPE Shelter (54%)",
    type: "radiation_shelter",
    severity: "shelter",
    description: "High canyon wall sky-shielding >50% for Solar Particle Events.",
    rings: [[[-76.946, -6.48], [-76.938, -6.48], [-76.938, -6.488], [-76.946, -6.488], [-76.946, -6.48]]],
  },
];

// --- OXIA PLANUM (EXOMARS TARGET) ---
export const OXIA_WAYPOINTS: ScienceWaypoint[] = [
  {
    id: "wp-oxia-hab",
    name: "Oxia Landing Plain Hab",
    subtitle: "Phyllosilicate Basin Base",
    lon: -23.946,
    lat: 18.136,
    elevationM: -2995,
    slopeDeg: 1.9,
    thermalInertia: 360,
    surfaceType: "Regolith",
    minerals: ["Fe/Mg Clay", "Basaltic Dust"],
    instrumentSource: "HiRISE 1m DTM",
    sciencePriority: "CRITICAL",
    biosignatureScore: 60,
    radiationShieldingPct: 18,
    rimfaxDepthNote: "Flat clay-bearing plain ideal for rover & foot traverse.",
    rimfaxLayers: [{ depthM: 2.0, label: "Clay Regolith", permittivity: 4.8 }],
    povSummary: "Broad ancient delta plain with minimal slope hazards.",
    povImageUrl: JEZERO_WAYPOINTS[0].povImageUrl,
    sol: 1,
  },
  {
    id: "wp-oxia-clay",
    name: "Oxia Smectite Clay Outcrop",
    subtitle: "High Biosignature Preservation Zone",
    lon: -23.934,
    lat: 18.148,
    elevationM: -2978,
    slopeDeg: 5.2,
    thermalInertia: 445,
    surfaceType: "Bedrock",
    minerals: ["Fe/Mg Phyllosilicates", "Vermiculite"],
    instrumentSource: "MRO CRISM + OMEGA",
    sciencePriority: "CRITICAL",
    biosignatureScore: 94,
    radiationShieldingPct: 24,
    rimfaxDepthNote: "3.9-billion-year-old water-altered clay bedrock.",
    rimfaxLayers: [{ depthM: 3.5, label: "Phyllosilicate Unit", permittivity: 6.2 }],
    povSummary: "Prime ExoMars target for preserved ancient organic molecules.",
    povImageUrl: JEZERO_WAYPOINTS[2].povImageUrl,
    sol: 9,
  },
  {
    id: "wp-oxia-ridge",
    name: "Coogoon Valles Channel Rim",
    subtitle: "Fluvial Delta & Ridge Shelter",
    lon: -23.958,
    lat: 18.126,
    elevationM: -2942,
    slopeDeg: 14.8,
    thermalInertia: 495,
    surfaceType: "Delta Scarp",
    minerals: ["Silica-Cemented Sandstone", "Olivine"],
    instrumentSource: "HiRISE 1m DTM + CaSSIS",
    sciencePriority: "SHELTER",
    biosignatureScore: 76,
    radiationShieldingPct: 42,
    rimfaxDepthNote: "Indurated fluvial ridge along ancient river channel.",
    rimfaxLayers: [{ depthM: 4.0, label: "Fluvial Caprock", permittivity: 7.4 }],
    povSummary: "Elevated delta channel bank offering 42% horizon radiation shielding.",
    povImageUrl: JEZERO_WAYPOINTS[1].povImageUrl,
    sol: 16,
  },
];

export const OXIA_HAZARD_ZONES: HazardZone[] = [
  {
    id: "hz-oxia-sand",
    name: "Oxia Aeolian Ripple Trap",
    type: "sand",
    severity: "moderate",
    description: "THEMIS Low TIU sand ripples along basin floor. Restrict rover speed.",
    rings: [[[-23.942, 18.138], [-23.936, 18.138], [-23.936, 18.144], [-23.942, 18.144], [-23.942, 18.138]]],
  },
  {
    id: "hz-oxia-crism",
    name: "Oxia Clay Biosignature Belt",
    type: "science_crism",
    severity: "low",
    description: "MRO CRISM Fe/Mg-phyllosilicate spectral peak (2.3 µm).",
    rings: [[[-23.938, 18.145], [-23.93, 18.145], [-23.93, 18.152], [-23.938, 18.152], [-23.938, 18.145]]],
  },
];

export type MissionId = "jezero" | "gale" | "candor" | "oxia";

export function getMissionDataset(id: MissionId): {
  waypoints: ScienceWaypoint[];
  hazards: HazardZone[];
  camera: { x: number; y: number; z: number };
  label: string;
} {
  switch (id) {
    case "gale":
      return {
        waypoints: GALE_WAYPOINTS,
        hazards: GALE_HAZARD_ZONES,
        camera: { x: 137.48, y: -4.605, z: 3650 },
        label: "Gale Crater • Mount Sharp Boxwork",
      };
    case "candor":
      return {
        waypoints: CANDOR_WAYPOINTS,
        hazards: CANDOR_HAZARD_ZONES,
        camera: { x: -76.928, y: -6.47, z: 5200 },
        label: "Candor Chasma • Valles Marineris",
      };
    case "oxia":
      return {
        waypoints: OXIA_WAYPOINTS,
        hazards: OXIA_HAZARD_ZONES,
        camera: { x: -23.946, y: 18.136, z: 4200 },
        label: "Oxia Planum • Clay Basin",
      };
    default:
      return {
        waypoints: JEZERO_WAYPOINTS,
        hazards: JEZERO_HAZARD_ZONES,
        camera: { x: 77.412, y: 18.415, z: 3650 },
        label: "Jezero Crater • Western Delta",
      };
  }
}

export const NOMINAL_MEDA_WEATHER: MedaWeather = {
  sol: 1215,
  airTempMinC: -78,
  airTempMaxC: -19,
  currentAirTempC: -34,
  groundTempC: -26,
  windSpeedMs: 6.4,
  windDir: "ESE (112°)",
  pressurePa: 742,
  dustTau: 0.58,
};

export const DUST_STORM_MEDA_WEATHER: MedaWeather = {
  sol: 1215,
  airTempMinC: -72,
  airTempMaxC: -38,
  currentAirTempC: -49,
  groundTempC: -44,
  windSpeedMs: 24.8,
  windDir: "WNW (295°)",
  pressurePa: 768,
  dustTau: 2.85,
};

export async function fetchLiveNasaDonkiSpaceWeather(): Promise<SpaceWeatherState> {
  const fallback: SpaceWeatherState = {
    source: "CACHED TELEMETRY",
    gcrBackgroundMsvDay: 0.64,
    speAlertActive: false,
    flareClass: "C2.4 (Nominal)",
    protonFluxPfu: 1.2,
    lastUpdated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
  };

  try {
    const end = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const url = `https://api.nasa.gov/DONKI/FLR?startDate=${startDate}&endDate=${end}&api_key=DEMO_KEY`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return fallback;
    const flares = (await res.json()) as Array<{
      classType?: string;
      peakTime?: string;
    }>;

    if (!Array.isArray(flares) || flares.length === 0) {
      return { ...fallback, source: "NASA DONKI LIVE" };
    }

    const latest = flares[flares.length - 1];
    const flareClass = latest.classType ?? "C1.0";
    const isMajor = flareClass.startsWith("X") || flareClass.startsWith("M5");

    return {
      source: "NASA DONKI LIVE",
      gcrBackgroundMsvDay: 0.64,
      speAlertActive: isMajor,
      flareClass,
      protonFluxPfu: isMajor ? 140 : 2.1,
      lastUpdated: (latest.peakTime ?? new Date().toISOString()).replace("T", " ").slice(0, 16) + " UTC",
    };
  } catch {
    return fallback;
  }
}
