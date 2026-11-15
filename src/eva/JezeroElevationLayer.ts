import BaseElevationLayer from "@arcgis/core/layers/BaseElevationLayer";
import ElevationLayer from "@arcgis/core/layers/ElevationLayer";
import LOD from "@arcgis/core/layers/support/LOD";
import TileInfo from "@arcgis/core/layers/support/TileInfo";
import {
  subclass,
  property,
} from "@arcgis/core/core/accessorSupport/decorators";

interface HiRiseMeta {
  source: string;
  doi: string;
  width: number;
  height: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  minElevM: number;
  maxElevM: number;
}

@subclass("ExploreMars.eva.JezeroElevationLayer")
export class JezeroElevationLayer extends BaseElevationLayer {
  private _baseElevation: ElevationLayer;
  private _maxBaseLod = 7;
  private _tileCache = new Map<string, Promise<__esri.ElevationTileData>>();

  private _hiRiseGrid: Float32Array | null = null;
  private _hiRiseMeta: HiRiseMeta | null = null;

  @property()
  reliefExaggeration = 1.2;

  @property()
  hiResEnabled = true;

  constructor(
    properties?: __esri.BaseElevationLayerProperties & {
      reliefExaggeration?: number;
      hiResEnabled?: boolean;
    },
  ) {
    super(properties);
    this._baseElevation = new ElevationLayer({
      url: "https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer",
      copyright:
        "NASA, ESA, HRSC, USGS Astrogeology Mars 2020 HiRISE DTM (doi:10.5066/P9REJ9JN), Esri",
    });
  }

  private async loadHiRiseDtm(): Promise<void> {
    try {
      const [metaRes, binRes] = await Promise.all([
        fetch("/data/jezero_hirise_meta.json"),
        fetch("/data/jezero_hirise_dtm.bin"),
      ]);
      if (!metaRes.ok || !binRes.ok) return;
      this._hiRiseMeta = (await metaRes.json()) as HiRiseMeta;
      const buf = await binRes.arrayBuffer();
      this._hiRiseGrid = new Float32Array(buf);
    } catch {
      // Fallback to base MDEM200M if local HiRISE files are unavailable
    }
  }

  load(): Promise<this> {
    this.addResolvingPromise(
      Promise.all([this._baseElevation.load(), this.loadHiRiseDtm()]).then(
        () => {
          const baseInfo = this._baseElevation.tileInfo;
          const baseLods = baseInfo.lods ?? [];
          this._maxBaseLod =
            baseLods.length > 0 ? baseLods[baseLods.length - 1].level : 7;

          // Extend LODs up to level 12 (matches 1536x1024 HiRISE grid)
          const extendedLods = baseLods.map(
            (l) =>
              new LOD({
                level: l.level,
                resolution: l.resolution,
                scale: l.scale,
              }),
          );
          let lastLod = extendedLods[extendedLods.length - 1];
          while (lastLod && lastLod.level < 12) {
            const next = new LOD({
              level: lastLod.level + 1,
              resolution: lastLod.resolution / 2,
              scale: lastLod.scale / 2,
            });
            extendedLods.push(next);
            lastLod = next;
          }

          this.tileInfo = new TileInfo({
            dpi: baseInfo.dpi,
            format: baseInfo.format,
            origin: baseInfo.origin,
            size: baseInfo.size,
            spatialReference: baseInfo.spatialReference,
            lods: extendedLods,
          });
          this.spatialReference = this._baseElevation.spatialReference;
          this.fullExtent = this._baseElevation.fullExtent;
        },
      ),
    );
    return Promise.resolve(this);
  }

  private fetchBaseTileCached(
    level: number,
    row: number,
    col: number,
  ): Promise<__esri.ElevationTileData> {
    const key = `${level}/${row}/${col}`;
    let cached = this._tileCache.get(key);
    if (!cached) {
      cached = this._baseElevation.fetchTile(level, row, col).catch(() => ({
        width: 257,
        height: 257,
        values: new Float32Array(257 * 257).fill(-2550),
        noDataValue: -32768,
      }));
      this._tileCache.set(key, cached);
    }
    return cached;
  }

  private sampleRealHiRise(lon: number, lat: number): number | null {
    const grid = this._hiRiseGrid;
    const meta = this._hiRiseMeta;
    if (!grid || !meta) return null;

    if (
      lon < meta.minLon ||
      lon > meta.maxLon ||
      lat < meta.minLat ||
      lat > meta.maxLat
    ) {
      return null;
    }

    const u =
      ((lon - meta.minLon) / (meta.maxLon - meta.minLon)) * (meta.width - 1);
    const v =
      ((meta.maxLat - lat) / (meta.maxLat - meta.minLat)) * (meta.height - 1);

    const x0 = Math.max(0, Math.min(meta.width - 1, Math.floor(u)));
    const x1 = Math.min(meta.width - 1, x0 + 1);
    const y0 = Math.max(0, Math.min(meta.height - 1, Math.floor(v)));
    const y1 = Math.min(meta.height - 1, y0 + 1);

    const fx = u - x0;
    const fy = v - y0;

    const v00 = grid[y0 * meta.width + x0];
    const v10 = grid[y0 * meta.width + x1];
    const v01 = grid[y1 * meta.width + x0];
    const v11 = grid[y1 * meta.width + x1];

    if (
      Number.isNaN(v00) ||
      Number.isNaN(v10) ||
      Number.isNaN(v01) ||
      Number.isNaN(v11)
    ) {
      return Number.isNaN(v00) ? null : v00;
    }

    const top = v00 + (v10 - v00) * fx;
    const bot = v01 + (v11 - v01) * fx;
    return top + (bot - top) * fy;
  }

  async fetchTile(
    level: number,
    row: number,
    col: number,
    options?: __esri.BaseElevationLayerFetchTileOptions,
  ): Promise<__esri.ElevationTileData> {
    let data: __esri.ElevationTileData;

    if (level <= this._maxBaseLod) {
      data = await this._baseElevation.fetchTile(level, row, col, options);
    } else {
      const diff = level - this._maxBaseLod;
      const scale = 1 << diff;
      const pRow = Math.floor(row / scale);
      const pCol = Math.floor(col / scale);
      const pData = await this.fetchBaseTileCached(this._maxBaseLod, pRow, pCol);

      const w = pData.width;
      const h = pData.height;
      const subColOffset = (col % scale) / scale;
      const subRowOffset = (row % scale) / scale;
      const out = new Float32Array(w * h);

      for (let r = 0; r < h; r++) {
        const py = (subRowOffset + r / (h - 1) / scale) * (h - 1);
        const y0 = Math.min(h - 1, Math.max(0, Math.floor(py)));
        const y1 = Math.min(h - 1, y0 + 1);
        const fy = py - y0;

        for (let c = 0; c < w; c++) {
          const px = (subColOffset + c / (w - 1) / scale) * (w - 1);
          const x0 = Math.min(w - 1, Math.max(0, Math.floor(px)));
          const x1 = Math.min(w - 1, x0 + 1);
          const fx = px - x0;

          const v00 = pData.values[y0 * w + x0] ?? -2550;
          const v10 = pData.values[y0 * w + x1] ?? v00;
          const v01 = pData.values[y1 * w + x0] ?? v00;
          const v11 = pData.values[y1 * w + x1] ?? v00;

          const top = v00 + (v10 - v00) * fx;
          const bot = v01 + (v11 - v01) * fx;
          out[r * w + c] = top + (bot - top) * fy;
        }
      }

      data = {
        width: w,
        height: h,
        values: out,
        noDataValue: pData.noDataValue,
      };
    }

    const meta = this._hiRiseMeta;
    if (!this.hiResEnabled || !this._hiRiseGrid || !meta || level < 6) {
      return data;
    }

    const bounds = this.getTileBounds(level, row, col);
    if (!bounds) {
      return data;
    }

    const [minLon, minLat, maxLon, maxLat] = bounds;
    if (
      maxLon < meta.minLon ||
      minLon > meta.maxLon ||
      maxLat < meta.minLat ||
      minLat > meta.maxLat
    ) {
      return data;
    }

    const { width, height, values } = data;
    const writableValues = Float32Array.from(values);
    const ex = this.reliefExaggeration;
    const datumM = -2565;

    for (let r = 0; r < height; r++) {
      const lat = maxLat - (r / Math.max(height - 1, 1)) * (maxLat - minLat);
      if (lat < meta.minLat || lat > meta.maxLat) continue;

      for (let c = 0; c < width; c++) {
        const lon = minLon + (c / Math.max(width - 1, 1)) * (maxLon - minLon);
        if (lon < meta.minLon || lon > meta.maxLon) continue;

        const idx = r * width + c;
        const baseVal = writableValues[idx];
        if (baseVal == null || Number.isNaN(baseVal)) continue;

        const realHiRise = this.sampleRealHiRise(lon, lat);
        if (realHiRise == null) continue;

        // Smooth feathering at the HiRISE mosaic boundary
        const edgeLon = Math.min(
          (lon - meta.minLon) / 0.008,
          (meta.maxLon - lon) / 0.008,
          1,
        );
        const edgeLat = Math.min(
          (lat - meta.minLat) / 0.008,
          (meta.maxLat - lat) / 0.008,
          1,
        );
        const blend = Math.max(0, Math.min(1, edgeLon * edgeLat));

        const targetElev = datumM + (realHiRise - datumM) * ex;
        writableValues[idx] = baseVal + (targetElev - baseVal) * blend;
      }
    }

    return {
      width,
      height,
      values: writableValues,
      noDataValue: data.noDataValue,
    };
  }
}
