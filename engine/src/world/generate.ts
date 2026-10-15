import { Delaunay } from 'd3-delaunay';
import { Rng } from '../core/rng.ts';
import { Simplex2 } from '../core/noise.ts';
import { MinHeap } from '../core/heap.ts';
import { BIOME, BIOMES, RES, classifyBiome } from './biomes.ts';

export interface River {
  cells: number[]; // source → mouth
  flux: number; // at mouth
}

export interface World {
  width: number;
  height: number;
  n: number;
  x: Float64Array;
  y: Float64Array;
  neighbors: Int32Array[];
  elev: Float32Array; // -1..1, sea < 0
  land: Uint8Array;
  lat: Float32Array;
  temp: Float32Array; // °C annual mean
  precip: Float32Array; // mm/yr
  biome: Uint8Array;
  flux: Float32Array;
  downhill: Int32Array;
  riverThreshold: number;
  coastal: Uint8Array;
  fertility: Float32Array;
  resources: Uint16Array;
  region: Int32Array;
  regionCount: number;
  regionLabelCell: number[];
  regionLandmass: number[];
  landmass: Int32Array;
  landmassSize: number[];
  rivers: River[];
  /** km² represented by one cell */
  cellArea: number;
}

export const WIDTH = 2000;
export const HEIGHT = 1250;

export function generateWorld(seed: number, targetCells = 8000): World {
  const root = new Rng(seed).fork('world');
  const W = WIDTH;
  const H = HEIGHT;

  // ---------- sites
  const sRng = root.fork('sites');
  const s = Math.sqrt((W * H) / targetCells);
  const cols = Math.floor(W / s);
  const rows = Math.floor(H / s);
  const pts: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * (W / cols) + (sRng.next() - 0.5) * 0.8 * s;
      const y = (r + 0.5) * (H / rows) + (sRng.next() - 0.5) * 0.8 * s;
      pts.push(Math.round(Math.min(W - 0.1, Math.max(0.1, x)) * 10) / 10);
      pts.push(Math.round(Math.min(H - 0.1, Math.max(0.1, y)) * 10) / 10);
    }
  }
  const n = pts.length / 2;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = pts[2 * i];
    y[i] = pts[2 * i + 1];
  }
  const delaunay = new Delaunay(Float64Array.from(pts));
  const neighbors: Int32Array[] = new Array(n);
  for (let i = 0; i < n; i++) neighbors[i] = Int32Array.from(delaunay.neighbors(i));

  // ---------- elevation
  const eRng = root.fork('elevation');
  const nz = new Simplex2(eRng.fork('noise'));
  const warp = new Simplex2(eRng.fork('warp'));
  const ridge = new Simplex2(eRng.fork('ridge'));
  const j = (a: number) => (eRng.next() - 0.5) * a;
  const blobs = [
    { cx: W * (0.32 + j(0.05)), cy: H * (0.5 + j(0.08)), rx: W * 0.3, ry: H * 0.4, h: 1.0 },
    { cx: W * (0.2 + j(0.05)), cy: H * (0.28 + j(0.05)), rx: W * 0.16, ry: H * 0.2, h: 0.85 },
    { cx: W * (0.45 + j(0.04)), cy: H * (0.7 + j(0.06)), rx: W * 0.14, ry: H * 0.18, h: 0.8 },
    { cx: W * (0.8 + j(0.04)), cy: H * (0.42 + j(0.08)), rx: W * 0.14, ry: H * 0.32, h: 0.95 },
    { cx: W * (0.75 + j(0.04)), cy: H * (0.7 + j(0.05)), rx: W * 0.09, ry: H * 0.14, h: 0.75 },
  ];
  // archipelago between and south
  for (let k = 0; k < 7; k++) {
    blobs.push({
      cx: W * (0.55 + eRng.next() * 0.18),
      cy: H * (0.62 + eRng.next() * 0.3),
      rx: W * (0.018 + eRng.next() * 0.025),
      ry: H * (0.03 + eRng.next() * 0.04),
      h: 0.55 + eRng.next() * 0.3,
    });
  }
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wx = x[i] + 230 * warp.fbm(x[i] / 480, y[i] / 480, 5);
    const wy = y[i] + 230 * warp.fbm(x[i] / 480 + 31.7, y[i] / 480 - 12.1, 5);
    let base = -0.6;
    for (const b of blobs) {
      const dx = (wx - b.cx) / b.rx;
      const dy = (wy - b.cy) / b.ry;
      const d2 = dx * dx + dy * dy;
      const v = b.h * (1 - d2);
      if (v > base) base = v;
    }
    const detail = nz.fbm(x[i] / 260, y[i] / 260, 6);
    const r = ridge.ridged(x[i] / 330, y[i] / 330, 4);
    const landish = Math.max(0, Math.min(1, base + 0.3));
    let e = base + 0.5 * detail + 0.55 * landish * Math.max(0, r - 0.55) * 2.2;
    // force ocean at the map edge
    const ex = Math.min(x[i], W - x[i]) / (W * 0.06);
    const ey = Math.min(y[i], H - y[i]) / (H * 0.06);
    const edge = Math.min(1, ex, ey);
    e = e * edge - (1 - edge) * 0.6;
    raw[i] = e;
  }
  // sea level at the land-fraction quantile
  const sorted = Float32Array.from(raw).sort();
  const seaRaw = sorted[Math.floor(n * (1 - 0.37))];
  const maxRaw = sorted[n - 1];
  const minRaw = sorted[0];
  const elev = new Float32Array(n);
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (raw[i] >= seaRaw) {
      elev[i] = Math.pow((raw[i] - seaRaw) / (maxRaw - seaRaw), 1.25);
      land[i] = 1;
    } else {
      elev[i] = -Math.pow((seaRaw - raw[i]) / (seaRaw - minRaw), 0.8);
    }
  }
  // Remove single-cell lakes and specks (smooth the coastline a little).
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let landN = 0;
      for (const k of neighbors[i]) landN += land[k];
      const deg = neighbors[i].length;
      if (land[i] && landN === 0) {
        land[i] = 0;
        elev[i] = -0.02;
      } else if (!land[i] && landN === deg) {
        land[i] = 1;
        elev[i] = 0.01;
      }
    }
  }

  // ---------- latitude & temperature
  const lat = new Float32Array(n);
  const temp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = 58 - (y[i] / H) * 60;
    const elevKm = land[i] ? elev[i] * 4.6 : 0;
    const c = Math.cos((lat[i] * Math.PI) / 180);
    temp[i] = -12 + 40 * Math.pow(c, 1.2) - 6.5 * elevKm;
  }

  // ---------- precipitation by moisture advection on a raster
  const GW = 250;
  const GH = 156;
  const gx = W / GW;
  const gy = H / GH;
  const gElev = new Float32Array(GW * GH);
  const gLand = new Uint8Array(GW * GH);
  let hint = 0;
  for (let r = 0; r < GH; r++) {
    for (let c = 0; c < GW; c++) {
      const cell = delaunay.find((c + 0.5) * gx, (r + 0.5) * gy, hint);
      hint = cell;
      gElev[r * GW + c] = land[cell] ? elev[cell] : 0;
      gLand[r * GW + c] = land[cell];
    }
  }
  const gP = new Float32Array(GW * GH);
  for (let r = 0; r < GH; r++) {
    const la = 58 - (((r + 0.5) * gy) / H) * 60;
    const westerly = la > 30;
    // zonal base precipitation in mm/yr (ITCZ wet, subtropical dry belt, mid-latitude storm track)
    const baseMm = Math.max(
      70,
      260 + 1900 * Math.exp(-(((la - 4) / 10) ** 2)) + 700 * Math.exp(-(((la - 49) / 12) ** 2)) - 300 * Math.exp(-(((la - 25) / 6) ** 2)),
    );
    let m = 1;
    let prevH = 0;
    for (let k = 0; k < GW; k++) {
      const c = westerly ? k : GW - 1 - k;
      const idx = r * GW + c;
      if (!gLand[idx]) {
        m = Math.min(1, m + 0.12);
        gP[idx] = baseMm * m;
        prevH = 0;
      } else {
        const h = gElev[idx];
        const dh = h - prevH;
        let p = m * (baseMm + 14000 * Math.max(0, dh));
        if (dh < 0) p *= Math.max(0.35, 1 + dh * 9); // lee-side drying
        gP[idx] = p;
        m = Math.max(0.04, m * (1 - p / 26000) + 0.004);
        prevH = h;
      }
    }
  }
  // blur
  const blurred = blur(gP, GW, GH, 3);
  const precip = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.min(GW - 1, Math.floor(x[i] / gx));
    const r = Math.min(GH - 1, Math.floor(y[i] / gy));
    precip[i] = Math.max(25, Math.min(4200, blurred[r * GW + c]));
  }

  // ---------- hydrology: priority flood
  const filled = new Float32Array(n);
  const downhill = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const order: number[] = [];
  const heap = new MinHeap<number>();
  for (let i = 0; i < n; i++) {
    if (!land[i]) {
      visited[i] = 1;
      filled[i] = elev[i];
      // seed with coastal sea cells only
      let touchesLand = false;
      for (const k of neighbors[i]) if (land[k]) touchesLand = true;
      if (touchesLand) heap.push(elev[i], i);
    }
  }
  while (heap.size > 0) {
    const c = heap.pop()!;
    for (const k of neighbors[c]) {
      if (visited[k]) continue;
      visited[k] = 1;
      filled[k] = Math.max(elev[k], filled[c] + 1e-5);
      downhill[k] = c;
      order.push(k);
      heap.push(filled[k], k);
    }
  }
  const flux = new Float32Array(n);
  for (let i = 0; i < n; i++) if (land[i]) flux[i] = precip[i] / 1000;
  for (let o = order.length - 1; o >= 0; o--) {
    const c = order[o];
    const d = downhill[c];
    if (d >= 0 && land[d]) flux[d] += flux[c];
  }
  const landFlux: number[] = [];
  for (let i = 0; i < n; i++) if (land[i]) landFlux.push(flux[i]);
  landFlux.sort((a, b) => a - b);
  const riverThreshold = landFlux[Math.floor(landFlux.length * 0.93)];

  // ---------- biomes, coast
  const biome = new Uint8Array(n);
  const coastal = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i]) {
      let nearLand = false;
      for (const k of neighbors[i]) if (land[k]) nearLand = true;
      biome[i] = nearLand && elev[i] > -0.25 ? BIOME.shallows : BIOME.ocean;
      continue;
    }
    for (const k of neighbors[i]) if (!land[k]) coastal[i] = 1;
    biome[i] = classifyBiome(temp[i], precip[i], elev[i] * 4.6, lat[i]);
    if (flux[i] > riverThreshold * 2.5 && elev[i] < 0.06 && precip[i] > 700 && temp[i] > 2) biome[i] = BIOME.wetland;
  }

  // ---------- fertility
  const fertility = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    let f = BIOMES[biome[i]].fertility;
    const isRiver = flux[i] > riverThreshold;
    if (isRiver && elev[i] < 0.3) f += 0.45 * Math.min(1, flux[i] / (riverThreshold * 6));
    else {
      for (const k of neighbors[i]) {
        if (flux[k] > riverThreshold * 2 && elev[k] < 0.3) {
          f += 0.18;
          break;
        }
      }
    }
    if (elev[i] > 0.45) f *= 0.6;
    fertility[i] = Math.max(0, Math.min(1, f));
  }

  // ---------- landmasses
  const landmass = new Int32Array(n).fill(-1);
  const landmassSize: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!land[i] || landmass[i] >= 0) continue;
    const id = landmassSize.length;
    let size = 0;
    const stack = [i];
    landmass[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      for (const k of neighbors[c]) {
        if (land[k] && landmass[k] < 0) {
          landmass[k] = id;
          stack.push(k);
        }
      }
    }
    landmassSize.push(size);
  }

  // ---------- resources
  const rRng = root.fork('resources');
  const rn = new Simplex2(rRng.fork('noise'));
  const resources = new Uint16Array(n);
  const landCells: number[] = [];
  for (let i = 0; i < n; i++) if (land[i]) landCells.push(i);
  for (const i of landCells) {
    const e = elev[i];
    const b = biome[i];
    let r = 0;
    const cluster = rn.noise(x[i] / 90, y[i] / 90);
    if (e > 0.18 && e < 0.75 && cluster > 0.35 && rRng.chance(0.55)) r |= RES.copper;
    if (b !== BIOME.hotDesert && b !== BIOME.ice && rRng.chance(0.05 + (e > 0.2 ? 0.04 : 0))) r |= RES.iron;
    if (e > 0.45 && rRng.chance(0.045)) r |= RES.silver;
    if (e > 0.4 && rRng.chance(0.02)) r |= RES.gold;
    if (coastal[i] && precip[i] < 500 && rRng.chance(0.35)) r |= RES.salt;
    else if ((b === BIOME.hotDesert || b === BIOME.coldDesert) && rRng.chance(0.04)) r |= RES.salt;
    else if (rRng.chance(0.004)) r |= RES.salt;
    if (b === BIOME.steppe && rRng.chance(0.5)) r |= RES.horses;
    if (b === BIOME.taiga || b === BIOME.temperateForest || b === BIOME.tropicalForest) r |= RES.timber;
    if (e > 0.35 && rRng.chance(0.25)) r |= RES.stone;
    if ((b === BIOME.tropicalForest || b === BIOME.savanna) && rRng.chance(0.12)) r |= RES.spice;
    if (b === BIOME.hotDesert && coastal[i] && rRng.chance(0.08)) r |= RES.spice; // incense coasts
    const coalN = rn.noise(x[i] / 140 + 50, y[i] / 140 - 20);
    if (temp[i] > 3 && temp[i] < 17 && e < 0.45 && coalN > 0.62) r |= RES.coal;
    const oilN = rn.noise(x[i] / 130 - 77, y[i] / 130 + 13);
    if ((precip[i] < 450 || coastal[i]) && e < 0.3 && oilN > 0.66) r |= RES.oil;
    resources[i] = r;
  }
  // Tin: rare, clustered in 4 provinces on hills, spread across landmasses.
  const hills = landCells.filter((i) => elev[i] > 0.15 && elev[i] < 0.7 && landmassSize[landmass[i]] > 60);
  const tinCenters: number[] = [];
  for (let tries = 0; tries < 400 && tinCenters.length < 4; tries++) {
    const c = rRng.pick(hills);
    if (tinCenters.every((t) => Math.hypot(x[t] - x[c], y[t] - y[c]) > 420)) tinCenters.push(c);
  }
  for (const c of tinCenters) {
    const seen = new Set<number>([c]);
    let frontier = [c];
    for (let ring = 0; ring < 2; ring++) {
      const next: number[] = [];
      for (const f of frontier) for (const k of neighbors[f]) if (land[k] && !seen.has(k)) { seen.add(k); next.push(k); }
      frontier = next;
    }
    for (const k of seen) if (k === c || rRng.chance(0.55)) resources[k] |= RES.tin;
  }

  // ---------- regions by seeded cost-growth
  const gRng = root.fork('regions');
  const region = new Int32Array(n).fill(-1);
  const seeds: number[] = [];
  for (let lm = 0; lm < landmassSize.length; lm++) {
    const cells = landCells.filter((i) => landmass[i] === lm);
    const count = Math.max(1, Math.round(cells.length / 105));
    const chosen: number[] = [];
    const minD = Math.sqrt((cells.length * s * s) / count) * 0.75;
    for (let tries = 0; tries < count * 60 && chosen.length < count; tries++) {
      const c = gRng.pick(cells);
      if (chosen.every((o) => Math.hypot(x[o] - x[c], y[o] - y[c]) > minD)) chosen.push(c);
    }
    if (chosen.length === 0) chosen.push(cells[0]);
    seeds.push(...chosen);
  }
  const dist = new Float64Array(n).fill(Infinity);
  const rh = new MinHeap<number>();
  seeds.forEach((sd, idx) => {
    region[sd] = idx;
    dist[sd] = 0;
    rh.push(0, sd);
  });
  while (rh.size > 0) {
    const c = rh.pop()!;
    for (const k of neighbors[c]) {
      if (!land[k]) continue;
      const cost = 1 + 6 * Math.max(0, elev[k] - 0.35) + (flux[k] > riverThreshold * 4 ? 2.5 : 0) + gRng.next() * 0.3;
      const nd = dist[c] + cost;
      if (nd < dist[k]) {
        dist[k] = nd;
        region[k] = region[c];
        rh.push(nd, k);
      }
    }
  }
  const regionCount = seeds.length;
  // label cell: the member cell closest to the region centroid
  const sumX = new Float64Array(regionCount), sumY = new Float64Array(regionCount), cnt = new Float64Array(regionCount);
  for (const i of landCells) {
    const r = region[i];
    sumX[r] += x[i]; sumY[r] += y[i]; cnt[r]++;
  }
  const regionLabelCell = new Array<number>(regionCount).fill(-1);
  const best = new Float64Array(regionCount).fill(Infinity);
  for (const i of landCells) {
    const r = region[i];
    const d = Math.hypot(x[i] - sumX[r] / cnt[r], y[i] - sumY[r] / cnt[r]);
    if (d < best[r]) { best[r] = d; regionLabelCell[r] = i; }
  }
  const regionLandmass = regionLabelCell.map((c) => landmass[c]);

  // ---------- major rivers
  const upstream: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) if (land[i] && downhill[i] >= 0 && land[downhill[i]]) upstream[downhill[i]].push(i);
  const mouths: number[] = [];
  for (let i = 0; i < n; i++) if (land[i] && flux[i] > riverThreshold * 1.5 && downhill[i] >= 0 && !land[downhill[i]]) mouths.push(i);
  mouths.sort((a, b) => flux[b] - flux[a] || a - b);
  const rivers: River[] = [];
  for (const m of mouths.slice(0, 48)) {
    const path = [m];
    let c = m;
    for (;;) {
      let bestUp = -1;
      for (const u of upstream[c]) if (flux[u] > riverThreshold && (bestUp < 0 || flux[u] > flux[bestUp])) bestUp = u;
      if (bestUp < 0) break;
      path.push(bestUp);
      c = bestUp;
    }
    if (path.length >= 4) rivers.push({ cells: path.reverse(), flux: flux[m] });
  }

  // one cell ≈ 30M km² of land spread over the land cell count (Eurasia-scale world)
  const cellArea = Math.round(26_000_000 / landCells.length);

  return {
    width: W, height: H, n, x, y, neighbors, elev, land, lat, temp, precip, biome, flux, downhill,
    riverThreshold, coastal, fertility, resources, region, regionCount, regionLabelCell, regionLandmass,
    landmass, landmassSize, rivers, cellArea,
  };
}

function blur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let s = 0, k = 0;
      for (let d = -radius; d <= radius; d++) {
        const cc = c + d;
        if (cc < 0 || cc >= w) continue;
        s += src[r * w + cc]; k++;
      }
      tmp[r * w + c] = s / k;
    }
  }
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let s = 0, k = 0;
      for (let d = -radius; d <= radius; d++) {
        const rr = r + d;
        if (rr < 0 || rr >= h) continue;
        s += tmp[rr * w + c]; k++;
      }
      out[r * w + c] = s / k;
    }
  }
  return out;
}
