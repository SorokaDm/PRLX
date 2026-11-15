export interface HighDetailZone {
  id: string;
  name: string;
  mission: string;
  detailLabel: string;
  isHyperlocalDtm: boolean;
  lon: number;
  lat: number;
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  footprint?: [number, number][]; // Exact valid-data polygon ring [lon, lat][]
  altitudeM: number;
  heading: number;
  tilt: number;
  summary: string;
}

export const HIGH_DETAIL_ZONES: HighDetailZone[] = [
  {
    id: "jezero-delta",
    name: "Jezero Crater (Western Delta)",
    mission: "Perseverance Rover",
    detailLabel: "HiRISE 1m DTM + 0.25m",
    isHyperlocalDtm: true,
    lon: 77.4165,
    lat: 18.4622,
    bounds: [77.365, 18.435, 77.46, 18.5],
    footprint: [[77.365,18.5],[77.365,18.435],[77.46,18.435],[77.46,18.446628],[77.459938,18.449296],[77.459072,18.454633],[77.457401,18.467977],[77.455482,18.483988],[77.453502,18.5],[77.365,18.5]],
    altitudeM: 6500,
    heading: 18,
    tilt: 58,
    summary: "Hyperlocal 1m/px USGS DTM + full 5 NASA EVA hazard/mineralogy layers.",
  },
  {
    id: "gale-crater",
    name: "Gale Crater (Aeolis Mons)",
    mission: "Curiosity Rover",
    detailLabel: "HiRISE 1m DTM + 0.25m",
    isHyperlocalDtm: true,
    lon: 137.4869,
    lat: -4.557,
    bounds: [137.429195, -4.701417, 137.544652, -4.412582],
    footprint: [[137.429647,-4.424452],[137.434166,-4.460062],[137.44004,-4.507541],[137.445915,-4.555021],[137.451789,-4.602501],[137.457438,-4.649981],[137.463086,-4.69746],[137.501949,-4.69746],[137.543748,-4.68559],[137.540359,-4.649981],[137.535388,-4.602501],[137.529514,-4.555021],[137.523865,-4.507541],[137.517765,-4.460062],[137.513472,-4.424452],[137.429647,-4.424452]],
    altitudeM: 12000,
    heading: 15,
    tilt: 60,
    summary: "Real 1m/px NASA HiRISE DTM — Mount Sharp & Curiosity landing region.",
  },
  {
    id: "meridiani-planum",
    name: "Meridiani Planum (Endeavour)",
    mission: "Opportunity Rover",
    detailLabel: "HiRISE Orbital + MDEM200M",
    isHyperlocalDtm: false,
    lon: -5.5267,
    lat: -1.9462,
    bounds: [-5.58, -2.0, -5.47, -1.89],
    altitudeM: 11000,
    heading: 170,
    tilt: 58,
    summary: "Hematite plains, Victoria & Endeavour crater rims.",
  },
  {
    id: "elysium-insight",
    name: "Elysium Planitia",
    mission: "InSight Lander",
    detailLabel: "HiRISE Orbital + MDEM200M",
    isHyperlocalDtm: false,
    lon: 135.6234,
    lat: 4.5024,
    bounds: [135.57, 4.45, 135.68, 4.55],
    altitudeM: 10000,
    heading: 30,
    tilt: 55,
    summary: "Smooth volcanic plains & Homestead hollow landing site.",
  },
  {
    id: "gusev-columbia",
    name: "Gusev Crater (Columbia Hills)",
    mission: "Spirit Rover",
    detailLabel: "HiRISE Orbital + MDEM200M",
    isHyperlocalDtm: false,
    lon: 175.4729,
    lat: -14.5684,
    bounds: [175.42, -14.62, 175.53, -14.51],
    altitudeM: 12000,
    heading: 45,
    tilt: 58,
    summary: "Husband Hill & Home Plate ancient hydrothermal deposits.",
  },
  {
    id: "oxia-planum",
    name: "Oxia Planum",
    mission: "ExoMars Rosalind Franklin",
    detailLabel: "HiRISE 1m DTM + 0.25m",
    isHyperlocalDtm: true,
    lon: -23.9459,
    lat: 18.1358,
    bounds: [-24.016046, 17.923854, -23.875714, 18.347736],
    footprint: [[-24.014948,18.330316],[-24.008082,18.278057],[-24.001216,18.225797],[-23.994351,18.173538],[-23.987485,18.121278],[-23.98062,18.069019],[-23.973754,18.01676],[-23.967163,17.9645],[-23.962495,17.929661],[-23.909218,17.929661],[-23.878186,17.94708],[-23.884777,17.99934],[-23.891367,18.051599],[-23.897684,18.103859],[-23.904275,18.156118],[-23.910866,18.208378],[-23.917182,18.260637],[-23.92597,18.330316],[-24.014948,18.330316]],
    altitudeM: 12000,
    heading: 10,
    tilt: 56,
    summary: "Real 1m/px NASA HiRISE DTM — clay-bearing phyllosilicate basin & delta fan.",
  },
  {
    id: "candor-chasma",
    name: "Candor Chasma (Valles Marineris)",
    mission: "MRO / HiRISE Canyon Target",
    detailLabel: "HiRISE 1m DTM + 0.25m",
    isHyperlocalDtm: true,
    lon: -76.9278,
    lat: -6.4697,
    bounds: [-76.982385, -6.561619, -76.873288, -6.377867],
    footprint: [[-76.958473,-6.385418],[-76.981531,-6.39297],[-76.977902,-6.423176],[-76.973418,-6.460933],[-76.968508,-6.49869],[-76.964024,-6.536447],[-76.961249,-6.559102],[-76.937764,-6.559102],[-76.874782,-6.55155],[-76.874142,-6.543999],[-76.879052,-6.506242],[-76.883536,-6.468484],[-76.888233,-6.430727],[-76.893997,-6.385418],[-76.958473,-6.385418]],
    altitudeM: 18000,
    heading: 320,
    tilt: 62,
    summary: "Real 1m/px NASA HiRISE DTM — deep tectonic canyon walls & layered mounds.",
  },
];
