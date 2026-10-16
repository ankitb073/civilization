// The relief model behind #/3d: the Voronoi cells of world.json turned into a watertight,
// exaggerated terrain mesh. Pure typed arrays (no three.js) so it can be built and probed anywhere.
//
// Each cell is fanned from its site to its polygon; every fan triangle is subdivided (land L=3,
// sea L=1) and keeps its own vertices, carrying (cell, neighbour across the fan's Voronoi edge,
// distance to that edge). The shader colours a cell by its owner in the chosen year and draws
// borders where the neighbour's owner differs, so changing the year only swaps a tiny per-cell
// palette texture; the geometry never changes.
//
// Heights: a cell's site sits at its own elevation, a Voronoi vertex at the mean of the cells that
// meet there, and any vertex where land meets sea at exactly sea level, so the coast follows the
// cell edges of the 2D map. Land gets a little deterministic fBm/ridge detail on top.

import type { WorldJson } from '../../../engine/src/export/contract.ts';
import type { Geo } from '../geo.ts';

/** Scene units per world unit: the 2000-wide world becomes a 20-unit tabletop model. */
export const SCALE = 0.01;
export const SEA_Y = -0.006;
export const BASE_Y = -0.62;
const LAND_L = 3;

export interface TerrainMesh {
  /** Render vertices (duplicated per fan triangle). */
  count: number;
  position: Float32Array;
  normal: Float32Array;
  /** cell, neighbour across the fan edge (== cell when none). */
  cells: Uint16Array;
  /** Distance to the fan's Voronoi edge, in scene units. */
  edge: Float32Array;
  index: Uint32Array;
  /** Render vertex → unique vertex. */
  uniq: Uint32Array;
  /** Unique vertices: position (x, y, z), smoothed normal, terrain attributes for colouring. */
  uCount: number;
  uPos: Float32Array;
  uNormal: Float32Array;
  /** Biome colour (sRGB 0..1) averaged over the cells meeting at the vertex. */
  uBiome: Float32Array;
  /** Concavity in [-1, 1] (valleys negative), for baked occlusion. */
  uCurv: Float32Array;
  /** Fraction of land among the cells meeting at the vertex. */
  uLand: Float32Array;
  /** Scene-space extent: x in [-w/2, w/2], z in [-d/2, d/2]. */
  width: number;
  depth: number;
  ox: number;
  oz: number;
  maxY: number;
  /** The rectangle's rim, in order around it: x, y (terrain), z per point. */
  rim: Float32Array;
  /** Height of the terrain at a scene point (exactly the mesh surface), and the cell under it. */
  heightAt(x: number, z: number): number;
  cellAt(x: number, z: number): number;
  /** Scene position of a cell's site (on the surface). */
  siteY: Float32Array;
}

// ---------------------------------------------------------------- noise (deterministic)
function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}
/** fBm in [-1, 1] blended toward ridges with `ridge` in [0, 1]. World-unit coordinates. */
function detail(x: number, y: number, ridge: number): number {
  let f = 1 / 85, amp = 1, sum = 0, norm = 0, rsum = 0;
  for (let o = 0; o < 4; o++) {
    const n = vnoise(x * f + o * 17.3, y * f - o * 9.1);
    sum += n * amp;
    rsum += (1 - Math.abs(n)) * 2 * amp - amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return ((1 - ridge) * sum + ridge * rsum) / norm;
}

/** Scene height of a site from its 0..255 elevation. */
export function siteHeight(e: number, sea: number): number {
  if (e >= sea) {
    const t = (e - sea) / Math.max(1, 255 - sea);
    return 0.012 + 0.98 * Math.pow(t, 1.55);
  }
  const d = (sea - e) / Math.max(1, sea);
  return -0.03 - 0.3 * Math.pow(d, 0.75);
}

function hexRgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}

export function buildTerrain(world: WorldJson, geo: Geo): TerrainMesh {
  const n = geo.n;
  const W = world.width, H = world.height;
  const sea = world.seaLevel;
  const ox = (W * SCALE) / 2, oz = (H * SCALE) / 2;
  const land = geo.land;
  const biomeRgb = world.biomes.map((b) => hexRgb(b.color));

  // ---- unique vertices, keyed on a fine grid
  const keyOf = (x: number, y: number) => Math.round(x * 64) * 262144 + Math.round(y * 64);
  const idOf = new Map<number, number>();
  const ux: number[] = [], uy: number[] = [];
  const uid = (x: number, y: number): number => {
    const k = keyOf(x, y);
    let id = idOf.get(k);
    if (id === undefined) { id = ux.length; idOf.set(k, id); ux.push(x); uy.push(y); }
    return id;
  };

  // polygon corners: which cells meet there
  const cornerLandSum: number[] = [], cornerSeaSum: number[] = [], cornerLandN: number[] = [], cornerSeaN: number[] = [];
  const siteH = new Float64Array(n);
  for (let i = 0; i < n; i++) siteH[i] = siteHeight(world.elevation[i], sea);
  const pc = geo.polyCoords;
  const touch = (id: number, i: number) => {
    while (cornerLandN.length <= id) { cornerLandSum.push(0); cornerSeaSum.push(0); cornerLandN.push(0); cornerSeaN.push(0); }
    if (land[i]) { cornerLandSum[id] += siteH[i]; cornerLandN[id]++; } else { cornerSeaSum[id] += siteH[i]; cornerSeaN[id]++; }
  };
  // fans: site, corner a, corner b, neighbour, L
  const fanCell: number[] = [], fanA: number[] = [], fanB: number[] = [], fanNbr: number[] = [];
  const cellFanStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    cellFanStart[i] = fanCell.length;
    const s = geo.polyStart[i], e = geo.polyStart[i + 1];
    const m = e - s;
    if (m < 3) continue;
    const sx = geo.sx[i], sy = geo.sy[i];
    const ids: number[] = [];
    for (let k = 0; k < m; k++) { const id = uid(pc[2 * (s + k)], pc[2 * (s + k) + 1]); ids.push(id); touch(id, i); }
    for (let k = 0; k < m; k++) {
      const a = ids[k], b = ids[(k + 1) % m];
      if (a === b) continue;
      const ax = ux[a], ay = uy[a], bx = ux[b], by = uy[b];
      // the neighbour across this edge: the adjacent site nearest the edge's midpoint, if equidistant with us
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const dSelf = Math.hypot(mx - sx, my - sy);
      let nb = i, bd = Infinity;
      for (let q = geo.nbrStart[i]; q < geo.nbrStart[i + 1]; q++) {
        const j = geo.nbrs[q];
        const dd = Math.hypot(mx - geo.sx[j], my - geo.sy[j]);
        if (dd < bd) { bd = dd; nb = j; }
      }
      if (Math.abs(bd - dSelf) > 0.02 * dSelf + 0.05) nb = i; // the world's rim
      // skip slivers
      const area = (ax - sx) * (by - sy) - (bx - sx) * (ay - sy);
      if (Math.abs(area) < 1e-9) continue;
      fanCell.push(i); fanA.push(a); fanB.push(b); fanNbr.push(nb);
    }
  }
  cellFanStart[n] = fanCell.length;
  const fans = fanCell.length;

  const cornerCount = ux.length;
  const uH: number[] = new Array(cornerCount);
  for (let id = 0; id < cornerCount; id++) {
    const ln = cornerLandN[id] ?? 0, sn = cornerSeaN[id] ?? 0;
    uH[id] = ln && sn ? 0 : ln ? cornerLandSum[id] / ln : sn ? cornerSeaSum[id] / sn : 0;
  }
  // a site is a unique vertex too
  const siteId = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (geo.polyStart[i + 1] - geo.polyStart[i] < 3) continue;
    siteId[i] = uid(geo.sx[i], geo.sy[i]);
    uH[siteId[i]] = siteH[i];
  }

  // ---- sub-vertices of every fan (row-major triangle grid)
  const gridIdx = (L: number, i: number, j: number) => i * (L + 1) - (i * (i - 1)) / 2 + j;
  const fanL = new Uint8Array(fans);
  const fanVStart = new Int32Array(fans + 1);
  let tv = 0;
  for (let f = 0; f < fans; f++) {
    const L = land[fanCell[f]] ? LAND_L : 1;
    fanL[f] = L;
    fanVStart[f] = tv;
    tv += ((L + 1) * (L + 2)) / 2;
  }
  fanVStart[fans] = tv;
  const fanV = new Int32Array(tv);
  for (let f = 0; f < fans; f++) {
    const L = fanL[f];
    const c = fanCell[f], a = fanA[f], b = fanB[f];
    const s = siteId[c];
    const sx = ux[s], sy = uy[s], ax = ux[a], ay = uy[a], bx = ux[b], by = uy[b];
    const hs = uH[s], ha = uH[a], hb = uH[b];
    for (let i = 0; i <= L; i++) {
      for (let j = 0; j <= L - i; j++) {
        let id: number;
        if (i === 0 && j === 0) id = s;
        else if (i === L) id = a;
        else if (j === L) id = b;
        else {
          const wa = i / L, wb = j / L, ws = (L - i - j) / L;
          const x = ws * sx + wa * ax + wb * bx, y = ws * sy + wa * ay + wb * by;
          id = uid(x, y);
          if (uH[id] === undefined) uH[id] = ws * hs + wa * ha + wb * hb;
        }
        fanV[fanVStart[f] + gridIdx(L, i, j)] = id;
      }
    }
  }

  // ---- smooth the piecewise-linear heights (Voronoi 'pyramids' → domes and valleys), coast pinned
  {
    const U = ux.length;
    const deg = new Int32Array(U + 1);
    const pairs: number[] = [];
    const addTri = (p: number, q: number, r: number) => { pairs.push(p, q, q, r, r, p); };
    for (let f = 0; f < fans; f++) {
      const L = fanL[f], v0 = fanVStart[f];
      for (let i = 0; i < L; i++) for (let j = 0; j < L - i; j++) {
        addTri(fanV[v0 + gridIdx(L, i, j)], fanV[v0 + gridIdx(L, i + 1, j)], fanV[v0 + gridIdx(L, i, j + 1)]);
        if (i + j + 2 <= L) addTri(fanV[v0 + gridIdx(L, i + 1, j)], fanV[v0 + gridIdx(L, i + 1, j + 1)], fanV[v0 + gridIdx(L, i, j + 1)]);
      }
    }
    for (let k = 0; k < pairs.length; k += 2) { deg[pairs[k] + 1]++; deg[pairs[k + 1] + 1]++; }
    for (let i = 0; i < U; i++) deg[i + 1] += deg[i];
    const fill = deg.slice();
    const adj = new Int32Array(pairs.length);
    for (let k = 0; k < pairs.length; k += 2) { adj[fill[pairs[k]]++] = pairs[k + 1]; adj[fill[pairs[k + 1]]++] = pairs[k]; }
    let cur = Float64Array.from(uH as number[]);
    let next = new Float64Array(U);
    for (let it = 0; it < 8; it++) {
      for (let id = 0; id < U; id++) {
        const h = cur[id];
        if (h === 0 || deg[id + 1] === deg[id]) { next[id] = h; continue; }
        let sum = 0;
        for (let k = deg[id]; k < deg[id + 1]; k++) sum += cur[adj[k]];
        const avg = sum / (deg[id + 1] - deg[id]);
        const v = h + 0.6 * (avg - h);
        next[id] = h > 0 ? Math.max(1e-3, v) : Math.min(-1e-3, v);
      }
      [cur, next] = [next, cur];
    }
    // detail on land: calm lowlands, rugged highlands
    for (let id = 0; id < U; id++) {
      const base = cur[id];
      let h = base;
      if (base > 0) {
        const t = Math.min(1, base / 0.6);
        const r = Math.max(0, Math.min(1, (t - 0.25) / 0.45));
        h = base * 1.2 + base * (0.05 + 0.3 * t * t) * detail(ux[id], uy[id], r * r * (3 - 2 * r));
      }
      uH[id] = h;
    }
  }
  const uCount = ux.length;
  const uPos = new Float32Array(uCount * 3);
  let maxY = 0;
  for (let id = 0; id < uCount; id++) {
    uPos[3 * id] = ux[id] * SCALE - ox;
    uPos[3 * id + 1] = uH[id];
    uPos[3 * id + 2] = uy[id] * SCALE - oz;
    if (uH[id] > maxY) maxY = uH[id];
  }

  // ---- render vertices and triangles
  const position = new Float32Array(tv * 3);
  const cells = new Uint16Array(tv * 2);
  const edge = new Float32Array(tv);
  const uniq = new Uint32Array(tv);
  let triCount = 0;
  for (let f = 0; f < fans; f++) { const L = fanL[f]; triCount += L * L; }
  const index = new Uint32Array(triCount * 3);
  let ti = 0;
  const uNormal = new Float32Array(uCount * 3);
  for (let f = 0; f < fans; f++) {
    const L = fanL[f];
    const c = fanCell[f], a = fanA[f], b = fanB[f];
    const s = siteId[c];
    // distance from the site to the edge line (world units → scene)
    const ax = ux[a], ay = uy[a], bx = ux[b], by = uy[b];
    const ex = bx - ax, ey = by - ay;
    const el = Math.hypot(ex, ey) || 1;
    const dSite = (Math.abs((ux[s] - ax) * ey - (uy[s] - ay) * ex) / el) * SCALE;
    const v0 = fanVStart[f];
    for (let i = 0; i <= L; i++) {
      for (let j = 0; j <= L - i; j++) {
        const v = v0 + gridIdx(L, i, j);
        const id = fanV[v];
        uniq[v] = id;
        position[3 * v] = uPos[3 * id];
        position[3 * v + 1] = uPos[3 * id + 1];
        position[3 * v + 2] = uPos[3 * id + 2];
        cells[2 * v] = c;
        cells[2 * v + 1] = fanNbr[f];
        edge[v] = (1 - (i + j) / L) * dSite;
      }
    }
    // orientation: up-facing in scene space (x right, z toward the viewer, y up)
    const flip = ((ax - ux[s]) * (by - uy[s]) - (bx - ux[s]) * (ay - uy[s])) > 0;
    const tri = (p: number, q: number, r: number) => {
      if (flip) { index[ti++] = p; index[ti++] = r; index[ti++] = q; } else { index[ti++] = p; index[ti++] = q; index[ti++] = r; }
      // accumulate area-weighted face normals on the unique vertices
      const P = fanV[p] * 3, Q = fanV[q] * 3, R = fanV[r] * 3;
      const e1x = uPos[Q] - uPos[P], e1y = uPos[Q + 1] - uPos[P + 1], e1z = uPos[Q + 2] - uPos[P + 2];
      const e2x = uPos[R] - uPos[P], e2y = uPos[R + 1] - uPos[P + 1], e2z = uPos[R + 2] - uPos[P + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (const U of [P, Q, R]) { uNormal[U] += nx; uNormal[U + 1] += ny; uNormal[U + 2] += nz; }
    };
    for (let i = 0; i < L; i++) {
      for (let j = 0; j < L - i; j++) {
        tri(v0 + gridIdx(L, i, j), v0 + gridIdx(L, i + 1, j), v0 + gridIdx(L, i, j + 1));
        if (i + j + 2 <= L) tri(v0 + gridIdx(L, i + 1, j), v0 + gridIdx(L, i + 1, j + 1), v0 + gridIdx(L, i, j + 1));
      }
    }
  }
  for (let id = 0; id < uCount; id++) {
    const k = 3 * id;
    const l = Math.hypot(uNormal[k], uNormal[k + 1], uNormal[k + 2]) || 1;
    uNormal[k] /= l; uNormal[k + 1] /= l; uNormal[k + 2] /= l;
    if (uNormal[k + 1] === 0) uNormal[k + 1] = 1;
  }
  const normal = new Float32Array(tv * 3);
  for (let v = 0; v < tv; v++) {
    const id = uniq[v];
    normal[3 * v] = uNormal[3 * id];
    normal[3 * v + 1] = uNormal[3 * id + 1];
    normal[3 * v + 2] = uNormal[3 * id + 2];
  }

  // ---- per unique vertex: biome mix, land share, concavity (from the triangle graph)
  const uBiome = new Float32Array(uCount * 3);
  const uLand = new Float32Array(uCount);
  const wsum = new Float32Array(uCount);
  const nbH = new Float64Array(uCount);
  const nbN = new Float32Array(uCount);
  for (let f = 0; f < fans; f++) {
    const c = fanCell[f];
    const rgb = biomeRgb[world.biome[c]] ?? [0.78, 0.74, 0.62];
    for (let v = fanVStart[f]; v < fanVStart[f + 1]; v++) {
      const id = fanV[v];
      uBiome[3 * id] += rgb[0]; uBiome[3 * id + 1] += rgb[1]; uBiome[3 * id + 2] += rgb[2];
      uLand[id] += land[c];
      wsum[id] += 1;
    }
  }
  for (let id = 0; id < uCount; id++) {
    const w = wsum[id] || 1;
    uBiome[3 * id] /= w; uBiome[3 * id + 1] /= w; uBiome[3 * id + 2] /= w;
    uLand[id] /= w;
  }
  for (let t = 0; t < index.length; t += 3) {
    const p = uniq[index[t]], q = uniq[index[t + 1]], r = uniq[index[t + 2]];
    const hp = uH[p], hq = uH[q], hr = uH[r];
    nbH[p] += hq + hr; nbN[p] += 2;
    nbH[q] += hp + hr; nbN[q] += 2;
    nbH[r] += hp + hq; nbN[r] += 2;
  }
  const uCurv = new Float32Array(uCount);
  for (let id = 0; id < uCount; id++) {
    if (!nbN[id]) continue;
    const dh = uH[id] - nbH[id] / nbN[id];
    uCurv[id] = Math.max(-1, Math.min(1, dh * 28));
  }

  // ---- the rim of the rectangle, in order (for the model's sides)
  const eps = 1e-3;
  const rimIds: { id: number; t: number }[] = [];
  for (let id = 0; id < uCount; id++) {
    const x = ux[id], y = uy[id];
    let t = -1;
    if (Math.abs(y) < eps) t = x;
    else if (Math.abs(x - W) < eps) t = W + y;
    else if (Math.abs(y - H) < eps) t = W + H + (W - x);
    else if (Math.abs(x) < eps) t = 2 * W + H + (H - y);
    if (t >= 0) rimIds.push({ id, t });
  }
  rimIds.sort((a, b) => a.t - b.t);
  const rim = new Float32Array(rimIds.length * 3);
  rimIds.forEach(({ id }, k) => { rim[3 * k] = uPos[3 * id]; rim[3 * k + 1] = uPos[3 * id + 1]; rim[3 * k + 2] = uPos[3 * id + 2]; });

  // ---- point queries (exact surface)
  let hint = 0;
  const cellAtWorld = (wx: number, wy: number) => {
    if (wx < 0 || wy < 0 || wx > W || wy > H) return -1;
    hint = geo.delaunay.find(wx, wy, hint);
    return hint;
  };
  const heightAtWorld = (wx: number, wy: number): number => {
    const c = cellAtWorld(Math.max(0, Math.min(W, wx)), Math.max(0, Math.min(H, wy)));
    if (c < 0) return SEA_Y;
    let best = -1, bestMin = -Infinity, bws = 0, bwa = 0, bwb = 0;
    for (let f = cellFanStart[c]; f < cellFanStart[c + 1]; f++) {
      const s = siteId[c], a = fanA[f], b = fanB[f];
      const x0 = ux[s], y0 = uy[s], x1 = ux[a], y1 = uy[a], x2 = ux[b], y2 = uy[b];
      const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(det) < 1e-12) continue;
      const ws = ((y1 - y2) * (wx - x2) + (x2 - x1) * (wy - y2)) / det;
      const wa = ((y2 - y0) * (wx - x2) + (x0 - x2) * (wy - y2)) / det;
      const wb = 1 - ws - wa;
      const mn = Math.min(ws, wa, wb);
      if (mn > bestMin) { bestMin = mn; best = f; bws = ws; bwa = wa; bwb = wb; }
      if (mn >= 0) break;
    }
    if (best < 0) return uH[siteId[c]] ?? SEA_Y;
    // clamp into the triangle
    bws = Math.max(0, bws); bwa = Math.max(0, bwa); bwb = Math.max(0, bwb);
    const sum = bws + bwa + bwb || 1;
    bwa /= sum; bwb /= sum;
    const L = fanL[best];
    const u = bwa * L, v = bwb * L;
    let i = Math.min(L - 1, Math.floor(u));
    let j = Math.min(L - 1 - i, Math.floor(v));
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    const fu = u - i, fv = v - j;
    const V = (ii: number, jj: number) => uH[fanV[fanVStart[best] + gridIdx(L, ii, jj)]];
    if (fu + fv <= 1 || i + j + 2 > L) {
      return V(i, j) * (1 - fu - fv) + V(i + 1, j) * fu + V(i, j + 1) * fv;
    }
    return V(i + 1, j + 1) * (fu + fv - 1) + V(i, j + 1) * (1 - fu) + V(i + 1, j) * (1 - fv);
  };

  const siteY = new Float32Array(n);
  for (let i = 0; i < n; i++) siteY[i] = siteId[i] >= 0 ? uH[siteId[i]] : SEA_Y;

  return {
    count: tv, position, normal, cells, edge, index, uniq,
    uCount, uPos, uNormal, uBiome, uCurv, uLand,
    width: W * SCALE, depth: H * SCALE, ox, oz, maxY, rim, siteY,
    heightAt: (x, z) => heightAtWorld((x + ox) / SCALE, (z + oz) / SCALE),
    cellAt: (x, z) => cellAtWorld((x + ox) / SCALE, (z + oz) / SCALE),
  };
}
