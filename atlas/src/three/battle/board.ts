// The diorama's ground: the battle's district and its neighbours from world.json, as a tabletop heightfield.
// Pure typed arrays (no three.js). The window is turned so the nearest town lies across the field from the viewer;
// heights and colours are blended from the Voronoi cells' elevation and biome; the big rivers of world.json are
// carved in and drawn; forests, rocks and reeds come from each cell's biome, placed by a hash of the battle id.

import type { WorldJson } from '../../../../engine/src/export/contract.ts';
import type { Geo } from '../../geo.ts';
import { hash, unit } from './plan.ts';

/** Board size in scene units (x across the field, z from the viewer to the far edge). */
export const BOARD_W = 12;
export const BOARD_D = 9.2;
const GX = 132, GZ = 102;
/** The battlefield: an ellipse kept level enough for the armies to stand on. */
export const FIELD = { rx: 3.9, rz: 2.25 };

export interface Prop { kind: 'conifer' | 'broadleaf' | 'bush' | 'rock' | 'reed'; x: number; z: number; s: number; r: number }
export interface Ribbon { pts: Float32Array; width: number }

export interface Board {
  gx: number;
  gz: number;
  /** Heights (scene y) on the grid, row-major (z rows of x). */
  y: Float32Array;
  /** Vertex colours (linear-ish 0..1 sRGB) on the grid. */
  rgb: Float32Array;
  /** Whether a grid vertex is under the sea. */
  wet: Uint8Array;
  seaY: number;
  minY: number;
  maxY: number;
  rivers: Ribbon[];
  props: Prop[];
  /** The town, in scene coordinates (null if the battle had none), and whether it was pulled in from further off. */
  town: { x: number; z: number; far: boolean } | null;
  /** World units per scene unit, and the turn applied (radians): north on the board. */
  worldPerUnit: number;
  north: number;
  /** Height of the ground at a scene point. */
  heightAt(x: number, z: number): number;
  /** The biome of the cell under the battle. */
  biome: string;
}

function hexRgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  return [parseInt(m.slice(0, 2), 16) / 255, parseInt(m.slice(2, 4), 16) / 255, parseInt(m.slice(4, 6), 16) / 255];
}
const mix3 = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}
function fbm(x: number, y: number, seed: number): number {
  let f = 1, amp = 1, s = 0, n = 0;
  for (let o = 0; o < 4; o++) { s += vnoise(x * f, y * f, seed + o) * amp; n += amp; amp *= 0.5; f *= 2.1; }
  return s / n;
}

/** Distance from a point to a polyline (scene x, z pairs). */
function distToLine(px: number, pz: number, pts: Float32Array): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const dx = bx - ax, dz = bz - az;
    const L = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
    const d = Math.hypot(px - ax - t * dx, pz - az - t * dz);
    if (d < best) best = d;
  }
  return best;
}

/** Catmull-Rom through points (x, z pairs), `sub` steps per segment. */
function spline(p: number[], sub: number): number[] {
  const n = p.length / 2;
  if (n < 2) return p;
  const out: number[] = [];
  const at = (i: number) => { const k = Math.max(0, Math.min(n - 1, i)); return [p[2 * k], p[2 * k + 1]]; };
  for (let i = 0; i < n - 1; i++) {
    const [x0, z0] = at(i - 1), [x1, z1] = at(i), [x2, z2] = at(i + 1), [x3, z3] = at(i + 2);
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      out.push(
        0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
        0.5 * (2 * z1 + (-z0 + z2) * t + (2 * z0 - 5 * z1 + 4 * z2 - z3) * t2 + (-z0 + 3 * z1 - 3 * z2 + z3) * t3),
      );
    }
  }
  out.push(p[2 * (n - 1)], p[2 * (n - 1) + 1]);
  return out;
}

export function buildBoard(world: WorldJson, geo: Geo, cell: number, townCell: number | null, id: string): Board {
  const seed = hash(id) & 0xffff;
  const cx = geo.sx[cell], cy = geo.sy[cell];
  // turn the world so the town lies across the field (−z); with no town, a fixed turn from the id
  let tdx = 0, tdy = -1, dist = 0;
  if (townCell !== null && townCell >= 0) {
    tdx = geo.sx[townCell] - cx; tdy = geo.sy[townCell] - cy;
    dist = Math.hypot(tdx, tdy);
    if (dist < 1e-6) { const a = unit(`${id}:town`) * Math.PI * 2; tdx = Math.cos(a); tdy = Math.sin(a); }
  } else {
    const a = unit(`${id}:turn`) * Math.PI * 2; tdx = Math.cos(a); tdy = Math.sin(a);
  }
  const ang = Math.atan2(tdy, tdx); // the town's bearing in world space
  // rotate world (dx, dy) by `rot` so the bearing maps to (0, −1)
  const rot = -Math.PI / 2 - ang;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const k = Math.max(0.09, Math.min(0.16, dist > 0 ? 3.4 / dist : 0.16)); // scene units per world unit
  const toScene = (wx: number, wy: number): [number, number] => { const dx = (wx - cx) * k, dy = (wy - cy) * k; return [dx * cr - dy * sr, dx * sr + dy * cr]; };
  const toWorld = (x: number, z: number): [number, number] => { const dx = x * cr + z * sr, dy = -x * sr + z * cr; return [cx + dx / k, cy + dy / k]; };

  const sea = world.seaLevel;
  const biomeRgb = world.biomes.map((b) => hexRgb(b.color));
  const sigma = 8.5; // world units: the blend between neighbouring cells
  // the cells near the window, for blending
  const pick = (wx: number, wy: number, hint: number) => geo.delaunay.find(wx, wy, hint);
  const near = (c0: number): number[] => {
    const set = new Set<number>([c0]);
    for (let i = geo.nbrStart[c0]; i < geo.nbrStart[c0 + 1]; i++) {
      const a = geo.nbrs[i];
      set.add(a);
      for (let j = geo.nbrStart[a]; j < geo.nbrStart[a + 1]; j++) set.add(geo.nbrs[j]);
    }
    return [...set];
  };
  const nearCache = new Map<number, number[]>();
  const elevH = (e: number) => (e >= sea ? 0.03 + 1.75 * Math.pow((e - sea) / (255 - sea), 0.95) : -0.06 - 0.5 * Math.pow((sea - e) / sea, 0.7));

  // rivers in scene space
  const rivers: Ribbon[] = [];
  const margin = 2;
  for (const r of world.rivers) {
    const pts: number[] = [];
    for (const c of r.cells) { const [x, z] = toScene(geo.sx[c], geo.sy[c]); pts.push(x, z); }
    let inside = false;
    for (let i = 0; i < pts.length; i += 2) if (Math.abs(pts[i]) < BOARD_W / 2 + margin && Math.abs(pts[i + 1]) < BOARD_D / 2 + margin) { inside = true; break; }
    if (!inside) continue;
    // the width where the river crosses the board
    let w = 1;
    for (let i = 0; i < r.cells.length; i++) { const x = pts[2 * i], z = pts[2 * i + 1]; if (Math.abs(x) < BOARD_W / 2 + margin && Math.abs(z) < BOARD_D / 2 + margin) w = Math.max(w, r.width[i] ?? 1); }
    rivers.push({ pts: Float32Array.from(spline(pts, 8)), width: 0.07 + 0.03 * w });
  }

  // ---- heights and colours on the grid
  const N = GX * GZ;
  const y = new Float32Array(N), rgb = new Float32Array(N * 3), wet = new Uint8Array(N);
  const forest = new Float32Array(N), biomeAt = new Uint8Array(N);
  let hint = cell;
  let fieldSum = 0, fieldN = 0;
  for (let j = 0; j < GZ; j++) {
    for (let i = 0; i < GX; i++) {
      const x = (i / (GX - 1) - 0.5) * BOARD_W, z = (j / (GZ - 1) - 0.5) * BOARD_D;
      const [wx, wy] = toWorld(x, z);
      const c0 = pick(wx, wy, hint);
      hint = c0;
      let cells = nearCache.get(c0);
      if (!cells) nearCache.set(c0, (cells = near(c0)));
      let ws = 0, h = 0, r = 0, g = 0, b = 0, fo = 0;
      for (const c of cells) {
        const d2 = (geo.sx[c] - wx) ** 2 + (geo.sy[c] - wy) ** 2;
        const w = Math.exp(-d2 / (2 * sigma * sigma)) + 1e-9;
        ws += w;
        h += w * elevH(world.elevation[c]);
        const bi = world.biome[c];
        const col = biomeRgb[bi] ?? [0.7, 0.7, 0.6];
        r += w * col[0]; g += w * col[1]; b += w * col[2];
        fo += w * (bi === 4 || bi === 5 || bi === 11 ? 1 : bi === 12 ? 0.5 : bi === 7 || bi === 10 ? 0.22 : 0);
      }
      const v = j * GX + i;
      h /= ws;
      // detail: a little relief everywhere, more in the hills
      h += fbm(wx / 14 + 3.1, wy / 14 - 1.7, seed) * (0.035 + 0.14 * Math.max(0, h - 0.25));
      y[v] = h;
      rgb[3 * v] = r / ws; rgb[3 * v + 1] = g / ws; rgb[3 * v + 2] = b / ws;
      forest[v] = fo / ws;
      biomeAt[v] = world.biome[c0];
      const e = Math.hypot(x / FIELD.rx, z / FIELD.rz);
      if (e < 1) { fieldSum += h; fieldN++; }
    }
  }
  // level the battlefield toward its mean, so the armies stand on gentle ground
  const fieldY = Math.max(0.06, fieldN ? fieldSum / fieldN : 0.1);
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
    const x = (i / (GX - 1) - 0.5) * BOARD_W, z = (j / (GZ - 1) - 0.5) * BOARD_D;
    const v = j * GX + i;
    const e = Math.hypot(x / FIELD.rx, z / FIELD.rz);
    const keep = smooth(0.78, 1.3, e);
    const gentle = fieldY + (y[v] - fieldY) * 0.12;
    y[v] = gentle + (y[v] - gentle) * keep;
  }
  // carve the rivers
  for (const rv of rivers) {
    for (let v = 0; v < N; v++) {
      const x = ((v % GX) / (GX - 1) - 0.5) * BOARD_W, z = (Math.floor(v / GX) / (GZ - 1) - 0.5) * BOARD_D;
      const d = distToLine(x, z, rv.pts);
      const bank = rv.width * 2.6;
      if (d < bank) y[v] -= 0.07 * (1 - (d / bank) ** 2);
    }
  }
  // the town sits on a gentle rise of its own ground
  let town: Board['town'] = null;
  if (townCell !== null && townCell >= 0) {
    const want = dist * k;
    const r = Math.max(3.05, Math.min(BOARD_D / 2 - 0.75, want));
    town = { x: 0, z: -r, far: want > BOARD_D / 2 - 0.75 + 0.3 };
    for (let v = 0; v < N; v++) {
      const x = ((v % GX) / (GX - 1) - 0.5) * BOARD_W, z = (Math.floor(v / GX) / (GZ - 1) - 0.5) * BOARD_D;
      const d = Math.hypot(x - town.x, z - town.z);
      const ty = Math.max(0.08, y[v]);
      if (d < 1.25) y[v] = y[v] + (Math.max(ty, sampleY(y, town.x, town.z)) - y[v]) * (1 - smooth(0.7, 1.25, d));
    }
  }
  // colours: the biome palette deepened, rock on steep ground, snow high up, sand at the shore
  const rock = hexRgb('#9b8f7e'), snow = hexRgb('#f4f2ec'), sand = hexRgb('#e3d3a6'), trodden = hexRgb('#a99a74');
  const seaY = 0;
  let minY = Infinity, maxY = -Infinity;
  const dx = BOARD_W / (GX - 1), dz = BOARD_D / (GZ - 1);
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
    const v = j * GX + i;
    const h = y[v];
    minY = Math.min(minY, h); maxY = Math.max(maxY, h);
    const hx = y[j * GX + Math.min(GX - 1, i + 1)] - y[j * GX + Math.max(0, i - 1)];
    const hz = y[Math.min(GZ - 1, j + 1) * GX + i] - y[Math.max(0, j - 1) * GX + i];
    const slope = Math.hypot(hx / (2 * dx), hz / (2 * dz));
    let c: [number, number, number] = [rgb[3 * v], rgb[3 * v + 1], rgb[3 * v + 2]];
    const gm = (c[0] + c[1] + c[2]) / 3;
    c = c.map((t) => Math.max(0, Math.min(1, (gm + (t - gm) * 1.45) * 0.9))) as [number, number, number];
    const x = (i / (GX - 1) - 0.5) * BOARD_W, z = (j / (GZ - 1) - 0.5) * BOARD_D;
    const speck = fbm(x * 3.1, z * 3.1, seed + 7) * 0.06;
    c = c.map((t) => t * (1 + speck)) as [number, number, number];
    c = mix3(c, rock, Math.min(0.85, smooth(0.45, 1.3, slope) * 0.9 + smooth(0.9, 1.5, h) * 0.4));
    c = mix3(c, snow, smooth(1.32, 1.62, h) * 0.9);
    if (h < 0.05 && h > -0.02) c = mix3(c, sand, 0.55);
    // the field itself, trodden
    const e = Math.hypot(x / (FIELD.rx * 0.82), z / (FIELD.rz * 0.6));
    c = mix3(c, trodden, (1 - smooth(0.55, 1.05, e)) * 0.22);
    rgb[3 * v] = c[0]; rgb[3 * v + 1] = c[1]; rgb[3 * v + 2] = c[2];
    wet[v] = h < seaY ? 1 : 0;
  }

  const heightAt = (x: number, z: number) => sampleY(y, x, z);

  // ---- props: trees, bushes, reeds and rocks from the biomes, never on the field, the town or the water
  const props: Prop[] = [];
  const step = 0.17;
  for (let zz = -BOARD_D / 2 + 0.12; zz < BOARD_D / 2 - 0.1; zz += step) {
    for (let xx = -BOARD_W / 2 + 0.12; xx < BOARD_W / 2 - 0.1; xx += step) {
      const ix = Math.round(xx / step), iz = Math.round(zz / step);
      const x = xx + (hash2(ix, iz, seed + 11) - 0.5) * step * 0.9, z = zz + (hash2(ix, iz, seed + 12) - 0.5) * step * 0.9;
      if (Math.abs(x) > BOARD_W / 2 - 0.1 || Math.abs(z) > BOARD_D / 2 - 0.1) continue;
      const e = Math.hypot(x / (FIELD.rx * 1.08), z / (FIELD.rz * 1.12));
      if (e < 1) continue;
      if (town && Math.hypot(x - town.x, z - town.z) < 1.0) continue;
      const gi = Math.round((x / BOARD_W + 0.5) * (GX - 1)), gj = Math.round((z / BOARD_D + 0.5) * (GZ - 1));
      const v = gj * GX + gi;
      const h = heightAt(x, z);
      if (h < 0.02) continue;
      if (rivers.some((rv) => distToLine(x, z, rv.pts) < rv.width * 1.5)) continue;
      const u = hash2(ix, iz, seed + 13);
      const bi = biomeAt[v];
      const s = 0.75 + hash2(ix, iz, seed + 14) * 0.6;
      const r = hash2(ix, iz, seed + 15) * Math.PI * 2;
      const edge = smooth(1, 1.35, e); // thin out toward the field
      if (u < forest[v] * 0.78 * edge && h < 1.35) {
        const conifer = bi === 4 || bi === 13 || (bi === 5 && hash2(ix, iz, seed + 16) < 0.3) || h > 0.9;
        props.push({ kind: conifer ? 'conifer' : 'broadleaf', x, z, s, r });
      } else if (bi === 12 && u < 0.35 * edge) props.push({ kind: 'reed', x, z, s, r });
      else if ((bi === 6 || bi === 7 || bi === 10) && u < 0.06 * edge) props.push({ kind: 'bush', x, z, s, r });
      else if ((bi === 8 || bi === 9 || bi === 13 || h > 1.05) && u < 0.05) props.push({ kind: 'rock', x, z, s, r });
    }
  }
  return {
    gx: GX, gz: GZ, y, rgb, wet, seaY, minY, maxY, rivers, props, town,
    worldPerUnit: 1 / k, north: rot, heightAt, biome: world.biomes[world.biome[cell]]?.name ?? '',
  };
}

/** Bilinear height on the grid at a scene point. */
function sampleY(y: Float32Array, x: number, z: number): number {
  const fx = Math.max(0, Math.min(GX - 1.0001, (x / BOARD_W + 0.5) * (GX - 1)));
  const fz = Math.max(0, Math.min(GZ - 1.0001, (z / BOARD_D + 0.5) * (GZ - 1)));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j;
  const a = y[j * GX + i], b = y[j * GX + i + 1], c = y[(j + 1) * GX + i], d = y[(j + 1) * GX + i + 1];
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}
