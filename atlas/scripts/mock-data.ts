// Contract-conformant mock data so the atlas can be built before the engine export exists.
// The real export (engine/src/cli/export.ts) overwrites atlas/public/data/.
// Run: npm --prefix atlas run mock

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Delaunay } from 'd3-delaunay';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Rng } from '../../engine/src/core/rng.ts';
import {
  KIND_PREFIX, SHARD_COUNT, shardFile, shardOf,
  type EntityKind, type GraphJson, type Layer, type MetaJson, type PageJson, type SearchEntry,
  type TimelineJson, type WorldJson,
} from '../../engine/src/export/contract.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const rng = new Rng(20261015);
const W = 2000, H = 1250, YEAR_END = 5000;

// ------------------------------------------------------------------ noise
function hash2(ix: number, iy: number, s: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number, oct = 5): number {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { sum += amp * vnoise(x * f, y * f, s + o * 31); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
}

// ------------------------------------------------------------------ names
const ONSETS = ['k', 't', 'p', 'b', 'd', 'g', 'm', 'n', 's', 'sh', 'r', 'l', 'v', 'h', 'z', 'kh', 'th', 'ash', 'il', 'or', 'ur', 'e'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'a', 'e', 'ai', 'ou'];
const CODAS = ['', '', '', 'n', 'r', 'm', 's', 'l', 'k', 'th', 'sh', 'd'];
function word(r: Rng, syl = r.int(2, 3)): string {
  let s = '';
  for (let i = 0; i < syl; i++) s += r.pick(ONSETS) + r.pick(VOWELS) + (i === syl - 1 ? r.pick(CODAS) : r.chance(0.2) ? r.pick(CODAS) : '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const usedNames = new Set<string>();
function uname(r: Rng, syl?: number): string {
  for (let i = 0; i < 50; i++) { const w = word(r, syl); if (!usedNames.has(w)) { usedNames.add(w); return w; } }
  return word(r, 4);
}

// ------------------------------------------------------------------ world
const N = 8000;
const spacing = Math.sqrt((W * H) / N);
const pts: number[] = [];
for (let y = spacing / 2; y < H; y += spacing) for (let x = spacing / 2; x < W; x += spacing) {
  pts.push(Math.round((x + (rng.next() - 0.5) * spacing * 0.9) * 10) / 10, Math.round((y + (rng.next() - 0.5) * spacing * 0.9) * 10) / 10);
}
const n = pts.length / 2;
const delaunay = new Delaunay(Float64Array.from(pts));
const nbrs: number[][] = [];
for (let i = 0; i < n; i++) nbrs.push([...delaunay.neighbors(i)]);
const blobs = [
  { x: 720, y: 560, rx: 560, ry: 420, h: 1.0 },
  { x: 1520, y: 520, rx: 330, ry: 300, h: 0.9 },
  { x: 1450, y: 1030, rx: 260, ry: 150, h: 0.7 },
  { x: 380, y: 1060, rx: 200, ry: 120, h: 0.55 },
];
const elevRaw = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const x = pts[2 * i], y = pts[2 * i + 1];
  let b = 0;
  for (const bl of blobs) {
    const dx = (x - bl.x) / bl.rx, dy = (y - bl.y) / bl.ry;
    b = Math.max(b, bl.h * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)));
  }
  const ridge = 1 - Math.abs(fbm(x / 260, y / 260, 7, 4) * 2 - 1);
  elevRaw[i] = b * 0.75 + fbm(x / 210, y / 210, 3) * 0.55 + ridge * ridge * b * 0.35;
}
const sortedE = Array.from(elevRaw).sort((a, b) => a - b);
const seaCut = sortedE[Math.floor(n * 0.56)];
const maxE = sortedE[n - 1], minE = sortedE[0];
const SEA = 100;
const elevation: number[] = Array.from(elevRaw, (e) =>
  e < seaCut ? Math.round(((e - minE) / (seaCut - minE)) * (SEA - 1)) : Math.round(SEA + ((e - seaCut) / (maxE - seaCut)) * (255 - SEA)));
const land = (i: number) => elevation[i] >= SEA;

const biomes = [
  { id: 0, name: 'Ocean', color: '#9fb7c2' },
  { id: 1, name: 'Ice', color: '#eef0ee' },
  { id: 2, name: 'Tundra', color: '#c9c7b4' },
  { id: 3, name: 'Boreal forest', color: '#8c9c78' },
  { id: 4, name: 'Temperate forest', color: '#9fae7e' },
  { id: 5, name: 'Steppe', color: '#cfc58f' },
  { id: 6, name: 'Desert', color: '#e2cf9f' },
  { id: 7, name: 'Savanna', color: '#d4c27c' },
  { id: 8, name: 'Tropical forest', color: '#7f9a6a' },
  { id: 9, name: 'Wetland', color: '#9fb39a' },
  { id: 10, name: 'Mountain', color: '#b3a693' },
];
const biome: number[] = [];
const moisture: number[] = [];
for (let i = 0; i < n; i++) {
  const x = pts[2 * i], y = pts[2 * i + 1];
  const lat = 1 - y / H; // 1 = north
  const m = fbm(x / 300, y / 300, 11) * 0.8 + (Math.abs(lat - 0.15) < 0.12 ? 0.25 : 0) + (lat > 0.55 && lat < 0.8 ? 0.15 : 0);
  moisture.push(m);
  if (!land(i)) { biome.push(0); continue; }
  const e = elevation[i];
  const t = 1 - lat * 1.1 - (e - SEA) / 400;
  let b: number;
  if (e > 215) b = 10;
  else if (t < 0.05) b = 1;
  else if (t < 0.18) b = 2;
  else if (t < 0.32) b = m > 0.45 ? 3 : 2;
  else if (t < 0.62) b = m > 0.55 ? 4 : m > 0.4 ? 5 : 6;
  else b = m > 0.6 ? 8 : m > 0.45 ? 7 : 6;
  if (b !== 10 && b !== 1 && m > 0.72 && e < SEA + 12) b = 9;
  biome.push(b);
}

// rivers
const down = new Int32Array(n).fill(-1);
for (let i = 0; i < n; i++) {
  if (!land(i)) continue;
  let best = -1, be = elevRaw[i];
  for (const j of nbrs[i]) if (elevRaw[j] < be) { be = elevRaw[j]; best = j; }
  down[i] = best;
}
const flux = new Float64Array(n);
const order = Array.from({ length: n }, (_, i) => i).filter(land).sort((a, b) => elevRaw[b] - elevRaw[a]);
for (const i of order) { flux[i] += 0.5 + moisture[i]; if (down[i] >= 0) flux[down[i]] += flux[i]; }
const upstream: number[][] = Array.from({ length: n }, () => []);
for (let i = 0; i < n; i++) if (down[i] >= 0 && land(i)) upstream[down[i]].push(i);
const mouths = order.filter((i) => down[i] >= 0 && !land(down[i]) && flux[i] > 45).sort((a, b) => flux[b] - flux[a]).slice(0, 28);
const rivers: WorldJson['rivers'] = [];
const riverIds: string[] = [];
for (const m of mouths) {
  const path = [down[m], m];
  let cur = m;
  while (true) {
    const ups = upstream[cur].filter((u) => flux[u] > 10);
    if (!ups.length) break;
    cur = ups.reduce((a, b) => (flux[a] > flux[b] ? a : b));
    path.push(cur);
  }
  if (path.length < 6) continue;
  path.reverse();
  const id = `riv:${rivers.length + 1}`;
  riverIds.push(id);
  rivers.push({ id, name: `${uname(rng, 2)} River`, cells: path, width: path.map((c) => Math.min(6, Math.max(1, Math.round(Math.log2(flux[c] / 6))))) });
}

// regions
const landCells = order.slice().sort((a, b) => a - b);
const regionOf = new Array<number>(n).fill(-1);
const regionSeeds = rng.sample(landCells, 72);
const regions: WorldJson['regions'] = [];
const queue: number[] = [];
regionSeeds.forEach((c, k) => { regionOf[c] = k; queue.push(c); });
for (let qi = 0; qi < queue.length; qi++) {
  const c = queue[qi];
  for (const j of rng.shuffle(nbrs[c].slice())) if (land(j) && regionOf[j] < 0) { regionOf[j] = regionOf[c]; queue.push(j); }
}
const regionCells: number[][] = regionSeeds.map(() => []);
for (let i = 0; i < n; i++) if (regionOf[i] >= 0) regionCells[regionOf[i]].push(i);
regionSeeds.forEach((s, k) => {
  const cs = regionCells[k];
  let cx = 0, cy = 0;
  for (const c of cs) { cx += pts[2 * c]; cy += pts[2 * c + 1]; }
  cx /= cs.length; cy /= cs.length;
  let best = s, bd = Infinity;
  for (const c of cs) { const d = (pts[2 * c] - cx) ** 2 + (pts[2 * c + 1] - cy) ** 2; if (d < bd) { bd = d; best = c; } }
  regions.push({ id: `reg:${k + 1}`, name: `${rng.pick(['The ', '', '', 'Upper ', 'Lower '])}${uname(rng, 2)}${rng.pick(['', '', ' Basin', ' Coast', ' Highlands', ' Plain', ' Marches'])}`.trim(), labelCell: best });
});
// drop unreached land cells into nearest region (islands)
for (let i = 0; i < n; i++) if (land(i) && regionOf[i] < 0) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < regions.length; k++) { const c = regions[k].labelCell; const d = (pts[2 * c] - pts[2 * i]) ** 2 + (pts[2 * c + 1] - pts[2 * i + 1]) ** 2; if (d < bd) { bd = d; best = k; } }
  regionOf[i] = best;
}

const world: WorldJson = { width: W, height: H, points: pts, elevation, seaLevel: SEA, biome, biomes, rivers, regions, regionOf };

// ------------------------------------------------------------------ eras
const eras: MetaJson['eras'] = [
  { id: 'bronze', name: 'Age of Bronze', start: 0, end: 1150, blurb: 'River cities, tin roads and the first written treaties.' },
  { id: 'iron', name: 'Age of Iron', start: 1150, end: 2200, blurb: 'Collapse, recovery and cheap iron in every hand.' },
  { id: 'empires', name: 'Age of Empires', start: 2200, end: 3300, blurb: 'Coinage, universal faiths and continental empires.' },
  { id: 'faiths', name: 'Age of Schisms', start: 3300, end: 4100, blurb: 'Councils, crusades and the great merchant houses.' },
  { id: 'sail', name: 'Age of Sail and Print', start: 4100, end: 4650, blurb: 'Ocean crossings, printing presses and joint-stock companies.' },
  { id: 'engines', name: 'Age of Engines', start: 4650, end: 4900, blurb: 'Coal, rail, telegraph and mass politics.' },
  { id: 'networks', name: 'Age of Networks', start: 4900, end: 5000, blurb: 'Computation, warming and the archive itself.' },
];

// ------------------------------------------------------------------ polities, culture, religion over time
type Pol = { idx: number; id: string; name: string; color: string; start: number; end: number; cells: Set<number>; power: number; origin: number; capitals: [number, number][]; names: [number, string][]; culture: number };
const owner = new Int16Array(n).fill(-1);
const polities: Pol[] = [];
const ownerKeys: string[] = [];
const ownerDeltas: number[] = [];
const PAL = ['#b5523b', '#3b6ea5', '#6b8e3d', '#a8763e', '#7a4e8a', '#2f8a83', '#c08a2b', '#8a3b55', '#4f6b3a', '#5e5aa0', '#a3593a', '#357a9a', '#8b6f2f', '#6d3f6b', '#3e8a5a', '#b04a6a', '#2e6b8a', '#9a8a3a', '#6a4a3a', '#4a7aa8'];
function hsl(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (m: number) => (m + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (m: number) => l - a * Math.max(-1, Math.min(k(m) - 3, Math.min(9 - k(m), 1)));
  const x = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}
function newColor(i: number): string {
  if (i < PAL.length) return PAL[i];
  return hsl((i * 137.508) % 360, 38 + (i % 3) * 8, 42 + (i % 4) * 5);
}

const settlementsRaw: { idx: number; id: string; name: string; cell: number; start: number; end: number; base: number }[] = [];
const goodSite = landCells.filter((c) => biome[c] !== 1 && biome[c] !== 10 && biome[c] !== 2 && (flux[c] > 12 || nbrs[c].some((j) => !land(j))));
const setByCell = new Map<number, number>();
for (let k = 0; k < 230; k++) {
  const c = rng.pick(goodSite);
  if (setByCell.has(c) || nbrs[c].some((j) => setByCell.has(j))) continue;
  const start = Math.floor(Math.pow(rng.next(), 1.4) * 4700 / 10) * 10;
  const end = rng.chance(0.25) ? Math.min(YEAR_END, start + rng.int(300, 2500)) : YEAR_END;
  const idx = settlementsRaw.length;
  setByCell.set(c, idx);
  settlementsRaw.push({ idx, id: `set:${idx + 1}`, name: uname(rng, rng.int(2, 3)), cell: c, start, end, base: 2000 + rng.next() * 30000 * (flux[c] > 40 ? 3 : 1) });
}

type Ev = TimelineJson['events'][number] & { parts: string[] };
const events: Ev[] = [];
function addEvent(year: number, end: number, sub: string, title: string, cell: number, sig: number, parts: string[]): string {
  const id = `evt:${events.length + 1}`;
  events.push({ id, year, end, sub, title, cell, sig: Math.round(sig * 100) / 100, parts });
  return id;
}

const cultureCount = 24;
const cultureSeeds = rng.sample(landCells, cultureCount);
const culture = new Int16Array(n).fill(-1);
{
  const q: number[] = [];
  cultureSeeds.forEach((c, k) => { culture[c] = k; q.push(c); });
  for (let qi = 0; qi < q.length; qi++) { const c = q[qi]; for (const j of nbrs[c]) if (land(j) && culture[j] < 0) { culture[j] = culture[c]; q.push(j); } }
  for (let i = 0; i < n; i++) if (land(i) && culture[i] < 0) culture[i] = 0;
}
const cultureKeys: string[] = [];
const cultureDeltas: number[] = [];
const religion = new Int16Array(n).fill(-1);
const relKeys: string[] = [];
const relDeltas: number[] = [];
const movements: { idx: number; id: string; name: string; color: string; start: number; end: number }[] = [];

function b64(arr: Int16Array | Int32Array): string {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
}

function spawnPolity(year: number, cell: number, cells?: number[]): Pol {
  const idx = polities.length;
  const base = uname(rng, 2);
  const kind = year < 1500 ? rng.pick(['City of', 'Kingdom of', '']) : year < 3500 ? rng.pick(['Kingdom of', 'Empire of', 'Realm of', '']) : rng.pick(['Republic of', 'Kingdom of', 'Federation of', '']);
  const p: Pol = { idx, id: `pol:${idx + 1}`, name: kind ? `${kind} ${base}` : base, color: newColor(idx), start: year, end: YEAR_END, cells: new Set(), power: 0.5 + rng.next(), origin: cell, capitals: [], names: [], culture: culture[cell] };
  p.names.push([year, p.name]);
  polities.push(p);
  for (const c of cells ?? [cell]) setOwner(year, c, idx);
  return p;
}
function setOwner(year: number, c: number, idx: number) {
  const prev = owner[c];
  if (prev === idx) return;
  if (prev >= 0) polities[prev].cells.delete(c);
  owner[c] = idx;
  if (idx >= 0) polities[idx].cells.add(c);
  if (year % 100 !== 0 || true) ownerDeltas.push(year, c, idx);
}
function killIfEmpty(year: number, p: Pol) {
  if (p.cells.size === 0 && p.end === YEAR_END) p.end = year;
}

const climate: TimelineJson['climate'] = [];
let temp = 0;
const persons: { id: string; name: string; born: number; died: number; pol: string; role: string }[] = [];
function person(year: number, pol: Pol, role: string): string {
  const id = `per:${persons.length + 1}`;
  persons.push({ id, name: `${uname(rng, 2)}${rng.chance(0.3) ? ' ' + rng.pick(['the Elder', 'the Bold', 'the Builder', 'II', 'III', 'the Pious', 'the Unready']) : ''}`, born: year - rng.int(25, 55), died: year + rng.int(1, 30), pol: pol.id, role });
  return id;
}
const wars: { id: string; a: Pol; b: Pol; year: number; end: number; battle: string; treaty: string | null }[] = [];

for (let year = 0; year <= YEAR_END; year += 10) {
  // climate
  temp = temp * 0.85 + rng.normal(0, 0.12) + (year > 4800 ? 0.03 : 0);
  let precip = rng.normal(0, 0.05);
  if (rng.chance(0.012)) {
    temp -= 0.9;
    const mts = landCells.filter((x) => biome[x] === 10);
    const c = rng.pick(mts.length ? mts : landCells);
    addEvent(year + rng.int(0, 9), year + 10, 'eruption', `Eruption of Mount ${uname(rng, 2)}`, c, 0.6, []);
  }
  if (rng.chance(0.02)) { precip -= 0.18; const c = rng.pick(landCells); addEvent(year + rng.int(0, 9), year + rng.int(20, 90), 'drought', `The ${uname(rng, 2)} Drought`, c, 0.5, []); }
  climate.push({ year, temp: Math.round(temp * 100) / 100, precip: Math.round(precip * 1000) / 1000 });

  // polity births
  const alive = polities.filter((p) => p.end === YEAR_END && p.cells.size > 0);
  const birthP = year < 300 ? 0.5 : alive.length < 18 ? 0.35 : 0.08;
  if (rng.chance(birthP) && polities.length < 140) {
    const free = goodSite.filter((c) => owner[c] < 0);
    if (free.length > 0) {
      const c = rng.pick(free);
      const p = spawnPolity(year, c);
      addEvent(year, year, 'founding', `Founding of ${p.name}`, c, 0.35, [p.id]);
    }
  }
  // growth & conquest
  for (const p of alive) {
    const tries = Math.min(40, 3 + Math.floor(p.cells.size / 6));
    const arr = [...p.cells];
    if (!arr.length) continue;
    for (let t = 0; t < tries; t++) {
      const c = rng.pick(arr);
      const j = rng.pick(nbrs[c]);
      if (!land(j)) continue;
      if (owner[j] < 0) { if (rng.chance(0.35 * p.power)) setOwner(year, j, p.idx); }
      else if (owner[j] !== p.idx && rng.chance(0.03 * p.power)) {
        const q = polities[owner[j]];
        if (p.power * Math.sqrt(p.cells.size) > q.power * Math.sqrt(q.cells.size) * rng.range(0.6, 1.6)) {
          setOwner(year, j, p.idx);
          killIfEmpty(year, q);
        }
      }
    }
  }
  // wars
  if (rng.chance(0.55) && alive.length > 2) {
    const a = rng.pick(alive);
    const borderOther = new Set<number>();
    for (const c of a.cells) for (const j of nbrs[c]) if (owner[j] >= 0 && owner[j] !== a.idx) borderOther.add(owner[j]);
    if (borderOther.size) {
      const b = polities[rng.pick([...borderOther])];
      const y0 = year + rng.int(0, 9), y1 = y0 + rng.int(1, 14);
      const front = [...a.cells].filter((c) => nbrs[c].some((j) => owner[j] === b.idx));
      const loc = front.length ? rng.pick(front) : a.origin;
      const wname = `${rng.pick(['War of the', 'The'])} ${uname(rng, 2)} ${rng.pick(['War', 'Succession', 'Campaign', 'Border War'])}`;
      const id = addEvent(y0, y1, 'war', `${wname} (${y0}–${y1})`, loc, 0.4 + rng.next() * 0.5, [a.id, b.id]);
      const battle = addEvent(y0 + 1, y0 + 1, 'battle', `Battle of ${uname(rng, 2)}`, loc, 0.3, [a.id, b.id, id]);
      // transfer some cells
      const gain = front.length ? Math.min(30, rng.int(3, 25)) : 0;
      const taken: number[] = [];
      const q2 = [...b.cells].filter((c) => nbrs[c].some((j) => owner[j] === a.idx));
      for (let k = 0; k < gain && q2.length; k++) { const c = q2.pop()!; taken.push(c); }
      for (const c of taken) setOwner(y1, c, a.idx);
      killIfEmpty(y1, b);
      let treaty: string | null = null;
      if (b.cells.size > 0) treaty = addEvent(y1, y1, 'treaty', `Treaty of ${uname(rng, 2)}`, loc, 0.35, [a.id, b.id, id]);
      else addEvent(y1, y1, 'conquest', `Conquest of ${b.name}`, loc, 0.6, [a.id, b.id, id]);
      wars.push({ id, a, b, year: y0, end: y1, battle, treaty });
    }
  }
  // collapse
  for (const p of alive) {
    if (p.cells.size === 0) continue;
    if (p.cells.size > 260 && rng.chance(0.012)) {
      const byReg = new Map<number, number[]>();
      for (const c of p.cells) { const r = regionOf[c]; if (!byReg.has(r)) byReg.set(r, []); byReg.get(r)!.push(c); }
      const regs = [...byReg.entries()].sort((a, b) => b[1].length - a[1].length);
      addEvent(year, year + 20, 'collapse', `Collapse of ${p.name}`, p.origin, 0.95, [p.id]);
      for (const [, cs] of regs.slice(1, 6)) {
        const np = spawnPolity(year + rng.int(0, 9), cs[0], cs);
        addEvent(np.start, np.start, 'revolt', `Rise of ${np.name}`, cs[0], 0.45, [np.id, p.id]);
      }
      for (const [, cs] of regs.slice(6)) for (const c of cs) if (rng.chance(0.5)) setOwner(year, c, -1);
      killIfEmpty(year, p);
    }
  }
  // culture assimilation
  for (let t = 0; t < 120; t++) {
    const c = rng.pick(landCells);
    const o = owner[c];
    if (o >= 0 && culture[c] !== polities[o].culture && rng.chance(0.25)) { culture[c] = polities[o].culture; cultureDeltas.push(year, c, culture[c]); }
  }
  // religions
  if ((year === 500 || rng.chance(year > 1800 && year < 4300 ? 0.012 : 0.002)) && movements.length < 18) {
    const c = rng.pick(goodSite);
    const idx = movements.length;
    movements.push({ idx, id: `mov:${idx + 1}`, name: `${rng.pick(['The ', 'The Way of ', 'The Church of ', 'The School of '])}${uname(rng, 2)}${rng.pick(['', ' Faith', 'ism', ' Teaching'])}`, color: hsl((idx * 71 + 20) % 360, 45, 48), start: year, end: YEAR_END });
    religion[c] = idx; relDeltas.push(year, c, idx);
    addEvent(year + rng.int(0, 9), year, 'founding', `Founding of ${movements[idx].name}`, c, 0.55, [movements[idx].id]);
  }
  if (movements.length) for (let t = 0; t < 260; t++) {
    const c = rng.pick(landCells);
    if (religion[c] < 0) continue;
    const j = rng.pick(nbrs[c]);
    if (land(j) && religion[j] !== religion[c] && rng.chance(religion[j] < 0 ? 0.6 : 0.12)) { religion[j] = religion[c]; relDeltas.push(year, j, religion[j]); }
  }
  // capitals
  for (const p of polities) {
    if (p.end !== YEAR_END || p.cells.size === 0) continue;
    const curCap = p.capitals.length ? p.capitals[p.capitals.length - 1][1] : -1;
    const capOk = curCap >= 0 && p.cells.has(settlementsRaw[curCap].cell) && settlementsRaw[curCap].start <= year && settlementsRaw[curCap].end > year;
    if (!capOk) {
      const cands = settlementsRaw.filter((s) => s.start <= year && s.end > year && p.cells.has(s.cell));
      if (cands.length) p.capitals.push([year, cands.reduce((a, b) => (a.base > b.base ? a : b)).idx]);
    }
  }
  // keyframes
  if (year % 100 === 0) {
    ownerKeys.push(b64(owner.slice()));
    cultureKeys.push(b64(culture.slice()));
    relKeys.push(b64(religion.slice()));
  }
}
// strip deltas that are at exact keyframe years and already captured? Contract: apply deltas with keyframeYear < year <= target.
// Deltas recorded at year y (multiple of 100) BEFORE the keyframe snapshot are inside the keyframe — drop those to stay correct.
function stripKeyframeYears(d: number[]): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < d.length; i += 3) if (d[i] % 100 !== 0) out.push(d[i], d[i + 1], d[i + 2]);
  // sort by year (stable)
  const trip: [number, number, number][] = [];
  for (let i = 0; i < out.length; i += 3) trip.push([out[i], out[i + 1], out[i + 2]]);
  trip.sort((a, b) => a[0] - b[0]);
  return Int32Array.from(trip.flat());
}
// Re-run would be needed for exact keyframe consistency if deltas carried years in later steps; in this mock all
// setOwner calls within a step use years in [year, year+23], so a delta can fall after a later keyframe snapshot.
// Rebuild deltas so each is consistent: replay from keyframes.
function rebuildLayer(keys: string[], raw: number[]): Int32Array {
  // Replay raw deltas in recorded order to derive the true sequence, then re-emit keyed by year with
  // semantics "state(y) = keyframe(floor) + deltas in (kf, y]". We approximate by sorting by year and
  // regenerating keyframes from the sorted replay.
  const trip: [number, number, number][] = [];
  for (let i = 0; i < raw.length; i += 3) trip.push([raw[i], raw[i + 1], raw[i + 2]]);
  trip.sort((a, b) => a[0] - b[0]);
  const state = new Int16Array(n).fill(-1);
  const newKeys: string[] = [];
  const out: number[] = [];
  let ti = 0;
  for (let k = 0; k * 100 <= YEAR_END; k++) {
    const ky = k * 100;
    while (ti < trip.length && trip[ti][0] <= ky) { state[trip[ti][1]] = trip[ti][2]; ti++; }
    newKeys.push(b64(state.slice()));
    const next = ky + 100;
    while (ti < trip.length && trip[ti][0] <= next && trip[ti][0] > ky) {
      if (trip[ti][0] === next) break;
      out.push(...trip[ti]);
      state[trip[ti][1]] = trip[ti][2];
      ti++;
    }
  }
  keys.length = 0; keys.push(...newKeys);
  return Int32Array.from(out);
}
void stripKeyframeYears;
// culture initial state must be in the delta stream for replay: emit initial assignment at year 0
const cultureInit: number[] = [];
{
  const init = new Int16Array(n).fill(-1);
  const q: number[] = [];
  cultureSeeds.forEach((c, k) => { init[c] = k; q.push(c); });
  for (let qi = 0; qi < q.length; qi++) { const c = q[qi]; for (const j of nbrs[c]) if (land(j) && init[j] < 0) { init[j] = init[c]; q.push(j); } }
  for (let i = 0; i < n; i++) if (land(i) && init[i] < 0) init[i] = 0;
  for (let i = 0; i < n; i++) if (init[i] >= 0) cultureInit.push(0, i, init[i]);
}
const ownerD = rebuildLayer(ownerKeys, ownerDeltas);
const cultureD = rebuildLayer(cultureKeys, [...cultureInit, ...cultureDeltas]);
const relD = rebuildLayer(relKeys, relDeltas);

const cultures = Array.from({ length: cultureCount }, (_, k) => ({ idx: k, id: `cul:${k + 1}`, name: `${uname(rng, 2)}${rng.pick(['i', 'ans', 'ite', 'ese', ''])}`, color: hsl((k * 47 + 10) % 360, 30, 55), start: 0, end: YEAR_END }));

const layerOf = (legend: Layer['legend'], keys: string[], d: Int32Array): Layer => ({ legend, keyframeEvery: 100, keyframes: keys, deltas: b64(d) });

const settlements: TimelineJson['settlements'] = settlementsRaw.map((s) => {
  const pop: [number, number][] = [];
  for (let y = Math.ceil(s.start / 100) * 100; y <= s.end; y += 100) {
    const age = y - s.start;
    pop.push([y, Math.round(s.base * (0.2 + Math.min(1, age / 1200)) * (1 + Math.max(0, y - 4600) / 60) * (0.8 + 0.4 * hash2(s.idx, y, 5)))]);
  }
  return { idx: s.idx, id: s.id, name: s.name, cell: s.cell, start: s.start, end: s.end, pop };
});
for (const s of settlementsRaw) addEvent(s.start, s.start, 'founding', `Founding of ${s.name}`, s.cell, 0.2 + (s.base > 40000 ? 0.3 : 0), [s.id]);
// extra flavour events
const extraSubs = ['plague', 'famine', 'succession', 'migration', 'schism', 'council', 'invention', 'debasement', 'panic'];
for (let k = 0; k < 700; k++) {
  const sub = rng.pick(extraSubs);
  const y = rng.int(0, YEAR_END);
  const c = rng.pick(landCells);
  const title: Record<string, string> = {
    plague: `The ${uname(rng, 2)} Plague`, famine: `Famine in ${regions[regionOf[c]].name}`, succession: `Succession Crisis of ${uname(rng, 2)}`,
    migration: `Migration of the ${uname(rng, 2)}`, schism: `The ${uname(rng, 2)} Schism`, council: `Council of ${uname(rng, 2)}`,
    invention: `Invention of the ${rng.pick(['water mill', 'astrolabe', 'printing press', 'steam engine', 'telegraph', 'abacus', 'iron plough'])}`,
    debasement: `Debasement of the ${uname(rng, 2)} coin`, panic: `The Panic of ${y}`,
  };
  const owners = polities.filter((p) => p.start <= y && p.end >= y);
  addEvent(y, y + (sub === 'plague' || sub === 'famine' ? rng.int(2, 12) : 0), sub, title[sub], c, rng.next() * 0.6, owners.length ? [rng.pick(owners).id] : []);
}
events.sort((a, b) => a.year - b.year);

const routes: TimelineJson['routes'] = [];
for (let y = 0; y <= YEAR_END; y += 100) {
  const live = settlements.filter((s) => s.start <= y && s.end > y);
  const edges: [number, number, number][] = [];
  for (const s of live) {
    const near = live.filter((t) => t.idx !== s.idx).map((t) => ({ t, d: (pts[2 * t.cell] - pts[2 * s.cell]) ** 2 + (pts[2 * t.cell + 1] - pts[2 * s.cell + 1]) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const { t, d } of near) if (s.idx < t.idx && d < 240 * 240) edges.push([s.idx, t.idx, Math.round(rng.range(0.1, 1) * 100) / 100]);
  }
  routes.push({ year: y, edges });
}

const timeline: TimelineJson = {
  layers: {
    political: layerOf(polities.map((p) => ({ idx: p.idx, id: p.id, name: p.name, color: p.color, start: p.start, end: p.end })), ownerKeys, ownerD),
    culture: layerOf(cultures.map(({ idx, id, name, color, start, end }) => ({ idx, id, name, color, start, end })), cultureKeys, cultureD),
    religion: layerOf(movements.map(({ idx, id, name, color, start, end }) => ({ idx, id, name, color, start, end })), relKeys, relD),
  },
  polities: polities.map((p) => ({ idx: p.idx, id: p.id, names: p.names, capitals: p.capitals })),
  settlements,
  events: events.map(({ parts: _p, ...e }) => e),
  climate,
  routes,
};

// ------------------------------------------------------------------ pages + graph
const pages = new Map<string, PageJson>();
function page(id: string, kind: EntityKind, sub: string, title: string, t0: number, t1: number, summary: string, body: string, extra: Partial<PageJson> = {}): PageJson {
  const p: PageJson = { id, kind, sub, title, t0, t1, summary, infobox: [], body, links: [], backlinks: [], cell: -1, ...extra };
  pages.set(id, p);
  return p;
}
const L = (id: string, text?: string) => `[[${id}|${text ?? pages.get(id)?.title ?? id}]]`;
const fmtY = (y: number) => `${y} AY`;

const languages = Array.from({ length: 30 }, (_, k) => ({ id: `lan:${k + 1}`, name: `${rng.pick(['Old ', 'Middle ', '', '', 'Proto-'])}${uname(rng, 2)}`, parent: k > 4 ? `lan:${rng.int(1, k)}` : null, born: k > 4 ? rng.int(0, 4000) : 0 }));
const scripts = Array.from({ length: 8 }, (_, k) => ({ id: `scr:${k + 1}`, name: `${uname(rng, 2)} ${['cuneiform', 'syllabary', 'abjad', 'alphabet', 'script', 'hand', 'glyphs', 'alphabet'][k]}`, start: k * 500 }));
const deities = Array.from({ length: 40 }, (_, k) => ({ id: `dei:${k + 1}`, name: uname(rng, 2), domain: rng.pick(['storm', 'sun', 'river', 'grain', 'war', 'the underworld', 'the sea', 'wisdom', 'the hearth']) }));
const currencies = Array.from({ length: 30 }, (_, k) => ({ id: `cur:${k + 1}`, name: `${uname(rng, 2).toLowerCase()}`, start: 1800 + k * 100 }));
const houses = Array.from({ length: 40 }, (_, k) => ({ id: `hou:${k + 1}`, name: `House of ${uname(rng, 2)}`, start: rng.int(1500, 4800) }));
const techs = ['Bronze casting', 'Writing', 'The wheel', 'Iron smelting', 'Coinage', 'The alphabet', 'Aqueducts', 'Paper', 'The compass', 'Printing', 'Gunpowder', 'Double-entry bookkeeping', 'The joint-stock company', 'The steam engine', 'The railway', 'The telegraph', 'Electric power', 'Radio', 'The computer', 'The network']
  .map((name, k) => ({ id: `tec:${k + 1}`, name, start: Math.round((k / 20) ** 1.8 * 4950) }));
const climates = events.filter((e) => e.sub === 'drought' || e.sub === 'eruption').slice(0, 30).map((e, k) => ({ id: `cli:${k + 1}`, name: e.sub === 'drought' ? e.title : `Volcanic winter of ${e.year}`, start: e.year, end: e.end + 10, cell: e.cell, ev: e.id }));

for (const p of polities) {
  const cap = p.capitals[0];
  const pg = page(p.id, 'polity', p.start < 1500 ? 'city-state' : p.start < 3500 ? 'kingdom' : 'republic', p.name, p.start, p.end,
    `A ${p.start < 1500 ? 'Bronze Age city-state' : p.start < 3500 ? 'kingdom' : 'state'} that lasted ${p.end - p.start} years.`, '');
  pg.cell = p.origin;
  pg.series = [
    { label: 'Territory', unit: 'cells', points: Array.from({ length: Math.max(2, Math.floor((p.end - p.start) / 100)) }, (_, i) => [p.start + i * 100, Math.round(20 + 200 * Math.sin((i + 1) / 6) ** 2 * rng.range(0.7, 1.3))] as [number, number]) },
    { label: 'Population', unit: 'thousand', points: Array.from({ length: Math.max(2, Math.floor((p.end - p.start) / 100)) }, (_, i) => [p.start + i * 100, Math.round(50 + 900 * (i / 20) * rng.range(0.6, 1.4))] as [number, number]) },
  ];
  pg.names = [
    { year: p.start, lang: 'Old ' + p.name.split(' ').pop(), form: p.name.split(' ').pop()!, scholarly: p.name.split(' ').pop()!.replace(/sh/g, 'š').replace(/kh/g, 'ḫ') },
    { year: p.start + 600, lang: 'Middle ' + p.name.split(' ').pop(), form: p.name.split(' ').pop()!.replace(/k/g, 'g').replace(/t/g, 'd'), scholarly: p.name.split(' ').pop()!.replace(/k/g, 'g') },
  ];
  void cap;
}
for (const s of settlementsRaw) {
  const pg = page(s.id, 'settlement', s.base > 40000 ? 'city' : 'town', s.name, s.start, s.end, `A ${s.base > 40000 ? 'great city' : 'town'} on ${regions[regionOf[s.cell]].name}.`, '');
  pg.cell = s.cell;
  pg.series = [{ label: 'Population', unit: 'people', points: settlements[s.idx].pop }];
  pg.names = [
    { year: s.start, lang: 'Old Ashkari', form: s.name, scholarly: s.name.replace(/sh/g, 'š').replace(/th/g, 'ṯ') },
    { year: Math.min(YEAR_END, s.start + 900), lang: 'Middle Ashkari', form: s.name.replace(/k/g, 'g').replace(/a$/, ''), scholarly: s.name.replace(/k/g, 'g') },
    { year: Math.min(YEAR_END, s.start + 2100), lang: 'Vellish (exonym)', form: s.name.replace(/[aeiou]$/, '').replace(/p/g, 'f') + 'om', scholarly: s.name.replace(/p/g, 'f') + 'om' },
  ];
}
regions.forEach((r, k) => { const pg = page(r.id, 'region', 'region', r.name, 0, YEAR_END, `A region of ${regionCells[k]?.length ?? 0} cells.`, ''); pg.cell = r.labelCell; });
rivers.forEach((r) => { const pg = page(r.id, 'river', 'river', r.name, 0, YEAR_END, `A river ${r.cells.length * 18} leagues long.`, ''); pg.cell = r.cells[Math.floor(r.cells.length / 2)]; });
cultures.forEach((c) => page(c.id, 'culture', 'people', `The ${c.name}`, 0, YEAR_END, `An ethnolinguistic group.`, ''));
movements.forEach((m) => page(m.id, 'movement', rng.pick(['religion', 'philosophy', 'ideology']), m.name, m.start, m.end, `A movement founded in ${m.start} AY.`, ''));
languages.forEach((l, k) => {
  const pg = page(l.id, 'language', 'language', l.name, l.born, YEAR_END, `A language of the ${uname(rng, 2)} family.`, '');
  pg.language = {
    parent: l.parent,
    daughters: languages.filter((x) => x.parent === l.id).map((x) => x.id),
    soundChanges: Array.from({ length: 14 }, (_, i) => ({ year: l.born + i * 180 + rng.int(0, 90), rule: rng.pick(['p > f / V_V', 't > d / V_V', 'k > tʃ / _i', 'V > ∅ / VC_#', 'h > ∅', 's > r / V_V', 'e > i', 'o > u', 'b > v / V_V', 'n > m / _p', 'g > ɣ / V_V', 'l > w / _C']), label: rng.pick(['intervocalic lenition', 'palatalization', 'apocope', 'h-loss', 'rhotacism', 'vowel raising', 'spirantization', 'nasal assimilation', 'l-vocalization']), lang: i < 6 && l.parent ? languages.find((x) => x.id === l.parent)!.name : l.name })),
    words: ['king', 'god', 'water', 'city', 'silver', 'mother', 'river', 'war'].map((concept) => {
      let w = word(rng, 2).toLowerCase();
      const forms: [number, string][] = [];
      for (let y = l.born; y <= YEAR_END; y += 800) { forms.push([y, w]); w = w.replace(/p/, 'f').replace(/t(?=[aeiou])/, 'd').replace(/[aeiou]$/, '') || w; }
      return { concept, forms };
    }),
  };
  void k;
});
scripts.forEach((s, k) => page(s.id, 'script', ['logographic', 'syllabary', 'abjad', 'alphabet'][k % 4], s.name, s.start, YEAR_END, `A writing system.`, ''));
deities.forEach((d) => page(d.id, 'deity', 'deity', d.name, 0, YEAR_END, `God of ${d.domain}.`, ''));
currencies.forEach((c) => {
  const pg = page(c.id, 'currency', 'coin', `The ${c.name}`, c.start, Math.min(YEAR_END, c.start + 900), `A silver coin.`, '');
  pg.series = [{ label: 'Silver content', unit: 'g', points: Array.from({ length: 9 }, (_, i) => [c.start + i * 100, Math.round(8.5 * Math.pow(0.86, i) * 100) / 100] as [number, number]) }];
});
houses.forEach((h) => page(h.id, 'house', 'merchant-house', h.name, h.start, Math.min(YEAR_END, h.start + rng.int(80, 400)), `A merchant house.`, ''));
techs.forEach((t) => page(t.id, 'tech', 'technology', t.name, t.start, YEAR_END, `First recorded in ${t.start} AY.`, ''));
climates.forEach((c) => { const pg = page(c.id, 'climate', c.name.startsWith('Volcanic') ? 'volcanic-winter' : 'drought', c.name, c.start, c.end, 'A climate anomaly.', ''); pg.cell = c.cell; });
for (const p of persons) page(p.id, 'person', p.role, p.name, p.born, p.died, `${p.role[0].toUpperCase() + p.role.slice(1)} of ${pages.get(p.pol)?.title}.`, '');

// events
const sigEvents = events.filter((e) => e.sig >= 0.3 || e.sub === 'war');
for (const e of sigEvents) {
  const pg = page(e.id, 'event', e.sub, e.title, e.year, e.end, `${e.sub[0].toUpperCase() + e.sub.slice(1)} in ${e.year} AY.`, '');
  pg.cell = e.cell;
}

// persons attached to wars
for (const w of wars) {
  const ra = person(w.year, w.a, 'ruler'), rb = person(w.year, w.b, 'ruler');
  const ga = person(w.year, w.a, 'general');
  for (const id of [ra, rb, ga]) { const p = persons.find((x) => x.id === id)!; page(id, 'person', p.role, p.name, p.born, p.died, `${p.role[0].toUpperCase() + p.role.slice(1)} of ${pages.get(p.pol)!.title}.`, ''); }
  (w as unknown as { rulers: string[] }).rulers = [ra, rb, ga];
}

// artifacts
let artN = 0;
const artIds: string[] = [];
function art(sub: string, title: string, year: number, cell: number, body: string, a: Partial<NonNullable<PageJson['artifact']>>, extra: Partial<PageJson> = {}): PageJson {
  artN++;
  const id = `art:${artN}`;
  artIds.push(id);
  const code = { treaty: 'TR', ledger: 'LD', inscription: 'IN', chronicle: 'CH', newspaper: 'NP', telegram: 'TG', letter: 'LT', decree: 'DC', census: 'CN', coin: 'NM', travelogue: 'TV', pamphlet: 'PM', treatise: 'TT', 'climate-record': 'CR' }[sub] ?? 'XX';
  const pg = page(id, 'artifact', sub, title, year, year, a.medium ? `${a.medium[0].toUpperCase() + a.medium.slice(1)}, ${year} AY.` : `${year} AY.`, body, extra);
  pg.cell = cell;
  pg.artifact = {
    catalog: `PAL·${code}·${String(artN).padStart(5, '0')}`, date: `Year ${rng.int(2, 30)} of ${rng.pick(['the Great King', 'the Founding', 'the Awakening'])}`,
    language: 'Old Ashkari', script: 'Ashkari cuneiform', medium: 'clay tablet', condition: rng.pick(['Complete.', 'Fragmentary; lower third lost.', 'Worn; several signs illegible.']),
    provenance: `Excavated at ${rng.pick(settlementsRaw).name} in ${rng.int(4700, 4990)} AY; now in the ${uname(rng, 2)} Museum.`, flagship: rng.chance(0.08), ...a,
  };
  return pg;
}
const sett = (i: number) => settlementsRaw[i % settlementsRaw.length];
for (const w of wars.slice(0, 260)) {
  const [ra, rb, ga] = (w as unknown as { rulers: string[] }).rulers;
  const truthCas = [rng.int(800, 6000), rng.int(800, 9000)];
  const treatyId = w.treaty;
  // treaty artifact
  let trArt: PageJson | null = null;
  if (treatyId) {
    const settA = sett(w.a.idx * 3), settB = sett(w.b.idx * 5);
    trArt = art('treaty', `${pages.get(treatyId)!.title}`, w.end, pages.get(treatyId)!.cell,
      `Thus says ${L(ra)}, Great King of ${L(w.a.id)}, beloved of ${L(deities[w.a.idx % 40].id)}: to ${L(rb)}, King of ${L(w.b.id)}, my brother, speak!\n\n` +
      `1. Between ${L(w.a.id)} and ${L(w.b.id)} there shall be peace and brotherhood forever. The war called ${L(w.id)} is ended.\n` +
      `2. The town of ${L(settB.id)} and its fields, as far as the ${L(rivers[w.a.idx % rivers.length].id)}, shall belong to ${L(w.a.id)}.\n` +
      `3. ${L(w.b.id)} shall pay each year 300 shekels of silver, weighed by the stone of ${L(settA.id)}.\n` +
      `4. If a fugitive flees from ${L(w.b.id)} to ${L(w.a.id)}, he shall be seized and returned.\n` +
      `5. Whoever alters the words of this tablet, may ${L(deities[w.b.idx % 40].id)} destroy his name and his seed in the land.\n\n` +
      `> Witnessed by the gods of both lands. [...] the seal of the scribe [...]\n`,
      { authorId: ra, language: 'Old Ashkari', medium: 'clay tablet' });
  }
  const chrA = art('chronicle', `Chronicle of ${w.a.name.split(' ').pop()}: the war against ${w.b.name.split(' ').pop()}`, w.end + rng.int(1, 40), w.a.origin,
    `In the ${rng.int(2, 20)}th year of ${L(ra)}, the faithless men of ${L(w.b.id)} crossed the border and burned the granaries. The king went out against them.\n\n` +
    `At ${L(w.battle)} the gods marched before our army. **${truthCas[1] * 2}** of the enemy fell; of ours, only a few hundred.\n\n` +
    `Thereafter ${L(w.b.id)} sued for peace, and the king in his mercy granted it.`,
    { language: 'Middle Ashkari', medium: 'parchment', authorId: ga, rival: { eventId: w.id, side: w.a.name } });
  const chrB = art('chronicle', `Annals of ${w.b.name.split(' ').pop()}: the year of the invasion`, w.end + rng.int(5, 80), w.b.origin,
    `In that year the tyrant ${L(ra)} came down upon us without cause, as a flood comes upon the fields.\n\n` +
    `Our people held at ${L(w.battle)}; ${truthCas[0] * 3} of the invaders were slain, and our losses were grievous but not shameful.\n\n` +
    `To end the suffering of the land, ${L(rb)} gave the town of [...] and bought peace with silver.`,
    { language: 'Vellish', medium: 'paper codex', authorId: rb, rival: { eventId: w.id, side: w.b.name } });
  const wp = pages.get(w.id)!;
  wp.accounts = {
    truth: [['Began', fmtY(w.year)], ['Ended', fmtY(w.end)], ['Aggressor', w.a.name], ['Cause', 'Border friction after a drought year'], ['Decisive battle', pages.get(w.battle)!.title], [`${w.a.name} losses`, truthCas[0].toLocaleString('en')], [`${w.b.name} losses`, truthCas[1].toLocaleString('en')], ['Outcome', treatyId ? `${w.b.name} cedes territory and pays tribute` : `${w.b.name} is annexed`]],
    sources: [
      { artifactId: chrA.id, side: w.a.name, author: pages.get(ga)!.title, claims: [['Began', fmtY(w.year)], ['Aggressor', w.b.name], ['Cause', 'Raids on the granaries'], ['Decisive battle', pages.get(w.battle)!.title], [`${w.a.name} losses`, 'a few hundred'], [`${w.b.name} losses`, (truthCas[1] * 2).toLocaleString('en')], ['Outcome', 'Peace granted in mercy']] },
      { artifactId: chrB.id, side: w.b.name, author: pages.get(rb)!.title, claims: [['Began', fmtY(w.year)], ['Aggressor', w.a.name], ['Cause', 'Unprovoked invasion'], [`${w.a.name} losses`, (truthCas[0] * 3).toLocaleString('en')], [`${w.b.name} losses`, 'grievous but not shameful'], ['Outcome', 'Peace bought with silver']] },
    ],
  };
  wp.body = `The **${wp.title}** was fought between ${L(w.a.id)} and ${L(w.b.id)}.\n\n## Course\n\nThe decisive engagement was the ${L(w.battle)}. ${treatyId ? `The war ended with the ${L(treatyId)}.` : `${L(w.b.id)} was annexed.`}\n\n## Sources\n\nTwo accounts survive and disagree sharply: ${L(chrA.id)} and ${L(chrB.id)}.${trArt ? ` The treaty text is preserved as ${L(trArt.id)}.` : ''}\n`;
  wp.infobox = [['Belligerents', `${L(w.a.id)} vs ${L(w.b.id)}`], ['Dates', `${w.year}–${w.end} AY`], ['Commanders', `${L(ga)}; ${L(rb)}`], ['Result', treatyId ? `${L(treatyId)}` : 'Annexation']];
}

// inscriptions
for (let k = 0; k < 80; k++) {
  const p = rng.pick(polities);
  const s = sett(k * 7);
  const king = uname(rng, 2), god = deities[k % 40];
  art('inscription', `Dedication stele of ${king} at ${s.name}`, Math.max(p.start, rng.int(200, 3000)), s.cell,
    `The stele stands 1.8 m high. The text runs in ${rng.int(6, 14)} lines below a relief of the king before ${L(god.id)}.\n\nThe last two lines are badly worn.`,
    {
      medium: 'basalt stele', language: 'Old Ashkari', script: 'Ashkari cuneiform',
      interlinear: {
        transliteration: `ᵐ${king.toLowerCase().replace(/(.{2})/g, '$1-').replace(/-$/, '')} LUGAL GAL LUGAL ${s.name.toUpperCase()}ᵏⁱ ᵈ${god.name.toUpperCase()} É-${'šu'} i-pu-uš [...]`,
        normalized: `${king} šarru rabû šar ${s.name}ki ana ${god.name} bīt-šu īpuš`,
        tokens: [
          { normalized: king, segmented: king, gloss: king },
          { normalized: 'šarru', segmented: 'šarr-u', gloss: 'king-NOM' },
          { normalized: 'rabû', segmented: 'rab-û', gloss: 'great-NOM' },
          { normalized: 'šar', segmented: 'šar', gloss: 'king.CSTR' },
          { normalized: s.name, segmented: s.name, gloss: s.name },
          { normalized: 'ana', segmented: 'ana', gloss: 'to' },
          { normalized: god.name, segmented: god.name, gloss: god.name },
          { normalized: 'bīt-šu', segmented: 'bīt-šu', gloss: 'house-3SG.M' },
          { normalized: 'īpuš', segmented: 'ī-puš', gloss: '3SG-build.PST' },
        ],
        translation: `${king}, great king, king of ${s.name}, built for ${god.name} his house [...]`,
      },
    });
}
// ledgers
for (let k = 0; k < 70; k++) {
  const h = rng.pick(houses);
  const y = h.start + rng.int(0, 60);
  const s = sett(k * 11);
  const goods = ['barley', 'tin', 'copper', 'wool cloth', 'salt', 'olive oil', 'timber', 'silver', 'spice'];
  const rows: string[][] = [];
  let bal = rng.int(200, 900);
  for (let r = 0; r < rng.int(8, 16); r++) {
    const g = rng.pick(goods), q = rng.int(2, 120), pr = Math.round(rng.range(0.4, 12) * 10) / 10;
    const out = rng.chance(0.5);
    bal += out ? -q * pr : q * pr;
    rows.push([`${rng.pick(['1st', '4th', '9th', '15th', '22nd'])} of ${uname(rng, 2)}`, out ? `Bought from ${uname(rng, 2)}` : `Sold to ${uname(rng, 2)}`, g, `${q}`, `${pr}`, `${out ? '−' : ''}${(q * pr).toFixed(1)}`, bal.toFixed(1)]);
  }
  art('ledger', `Day-book of the ${h.name}, year ${y}`, y, s.cell,
    `Accounts of the ${L(h.id)} at ${L(s.id)}, kept in ${L(rng.pick(currencies).id)}.`,
    { medium: 'paper ledger', language: 'Vellish', script: 'Vellish alphabet', ledger: { columns: ['Date', 'Entry', 'Goods', 'Qty', 'Price', 'Amount', 'Balance'], rows, notes: [`Road to ${s.name} closed by the war; tin carried by sea at double cost.`, 'Balance carried forward.'] } });
}
// newspapers, telegrams, letters, decrees, misc
for (let k = 0; k < 40; k++) {
  const y = rng.int(4650, 4990);
  const pol = rng.pick(polities);
  art('newspaper', `The ${uname(rng, 2)} Courier, ${y}`, y, rng.pick(settlementsRaw).cell,
    `# GRAIN PRICES SOAR AS DROUGHT GRIPS THE ${regions[k % regions.length].name.toUpperCase()}\n\n*From our correspondent in ${L(sett(k).id)}*\n\nThe price of wheat on the exchange rose for the ninth consecutive week as reports reached the capital of failed harvests across ${L(regions[k % regions.length].id)}. Ministers of ${L(pol.id)} met late into the night.\n\n## Telegraph lines down in the north\n\nCommunications with the frontier have been interrupted since Tuesday.\n\n## Shipping news\n\nArrived: the steamer *${uname(rng, 2)}*, from ${sett(k + 3).name}, with coal and machinery.`,
    { medium: 'newsprint', language: 'Vellish', script: 'Vellish alphabet' });
  art('telegram', `Telegram from the ${pol.name.split(' ').pop()} legation, ${y}`, y, rng.pick(settlementsRaw).cell,
    `URGENT STOP FRONTIER FORCES MOBILIZED AT ${sett(k + 9).name.toUpperCase()} STOP MINISTER REQUESTS INSTRUCTIONS STOP REPLY BY WIRE STOP`,
    { medium: 'telegraph form', language: 'Vellish', script: 'Vellish alphabet' });
}
for (let k = 0; k < 60; k++) {
  const y = rng.int(300, 4600);
  const kinds = ['letter', 'decree', 'census', 'coin', 'travelogue', 'pamphlet', 'treatise', 'climate-record'];
  const sub = kinds[k % kinds.length];
  const s = sett(k * 13);
  art(sub, `${{ letter: 'Letter to the king of', decree: 'Edict on the coinage of', census: 'Census of', coin: 'Silver stater of', travelogue: 'Travels through', pamphlet: 'A Plain Address to the People of', treatise: 'On the Nature of the Soul, written at', 'climate-record': 'Temple flood record of' }[sub]} ${s.name}`, y, s.cell,
    `${sub === 'letter' ? `To ${L(rng.pick(polities).id)}, my brother, speak! Thus says your brother:\n\nWith me all is well. With you may all be well.\n\nAs for the tin you asked for, the roads are closed and the caravans do not come. [...]` : sub === 'decree' ? `By order of the council of ${L(s.id)}:\n\n1. The new coin shall be accepted at its full value in all markets.\n2. Whoever refuses it shall pay a fine of ten pieces.\n3. Prices of grain shall not exceed those fixed on the stone in the market.` : sub === 'census' ? `| District | Households | Men of arms |\n|---|---|---|\n| Upper town | 1,240 | 380 |\n| River quarter | 2,115 | 610 |\n| Fields | 4,870 | 1,450 |\n\nTotal households: **8,225**.` : `${uname(rng, 3)} ${uname(rng, 2).toLowerCase()} ${uname(rng, 2).toLowerCase()}. The text discusses ${L(rng.pick(movements.length ? movements.map((x) => x.id) : ['mov:1']))} at length, quoting the sayings of its founder.\n\nIn this year the river rose to fourteen cubits and the barley failed in the lower fields.`}`,
    { medium: sub === 'coin' ? 'silver' : sub === 'pamphlet' ? 'printed broadside' : 'papyrus', language: 'Middle Ashkari' });
}

// generic bodies for entities without one
for (const p of pages.values()) {
  if (p.body) continue;
  const related = rng.sample(artIds, 2);
  if (p.kind === 'polity') {
    const caps = polities.find((x) => x.id === p.id)!.capitals.map(([y, si]) => `${L(settlementsRaw[si].id)} (from ${y} AY)`).join(', ');
    p.body = `**${p.title}** was a ${p.sub.replace('-', ' ')} that existed from ${p.t0} to ${p.t1} AY.\n\n## History\n\nIt was founded in ${L(regions[regionOf[p.cell]].id)}. Its capitals were ${caps || 'not recorded'}.\n\n## Sources\n\nIt is mentioned in ${related.map((r) => L(r)).join(' and ')}.`;
    p.infobox = [['Founded', `${p.t0} AY`], ['Ended', `${p.t1} AY`], ['Government', p.sub], ['Region', L(regions[regionOf[p.cell]].id)]];
  } else if (p.kind === 'settlement') {
    p.body = `**${p.title}** stood in ${L(regions[regionOf[p.cell]].id)}.\n\n## History\n\nFounded ${p.t0} AY. ${p.t1 < YEAR_END ? `Abandoned ${p.t1} AY.` : 'It is still inhabited.'}\n\nSee ${related.map((r) => L(r)).join(', ')}.`;
    p.infobox = [['Founded', `${p.t0} AY`], ['Region', L(regions[regionOf[p.cell]].id)]];
  } else if (p.kind === 'event') {
    const e = events.find((x) => x.id === p.id)!;
    p.body = `The **${p.title}** took place in ${p.t0} AY${e.cell >= 0 ? ` in ${L(regions[regionOf[e.cell]].id)}` : ''}.\n\n## Participants\n\n${e.parts.filter((x) => pages.has(x)).map((x) => `- ${L(x)}`).join('\n') || '- None recorded'}\n\n## Causes\n\n- Preceded by ${L(rng.pick(sigEvents).id)}\n\n## Sources\n\n${related.map((r) => `- ${L(r)}`).join('\n')}`;
    p.infobox = [['Date', p.t0 === p.t1 ? `${p.t0} AY` : `${p.t0}–${p.t1} AY`], ['Type', p.sub]];
  } else {
    p.body = `**${p.title}** — ${p.summary}\n\nAttested in ${related.map((r) => L(r)).join(' and ')}.`;
    p.infobox = [['Kind', p.kind], ['Attested', `${p.t0}–${p.t1} AY`]];
  }
}

// links & backlinks
const linkRe = /\[\[([a-z]{3}:\d+)(?:\|[^\]]*)?\]\]/g;
for (const p of pages.values()) {
  const set = new Set<string>();
  const text = p.body + p.infobox.map((x) => x[1]).join(' ');
  for (const m of text.matchAll(linkRe)) if (pages.has(m[1]) && m[1] !== p.id) set.add(m[1]);
  if (p.artifact?.authorId) set.add(p.artifact.authorId);
  p.links = [...set];
}
for (const p of pages.values()) for (const l of p.links) pages.get(l)!.backlinks.push(p.id);

// graph
const g = new Graph({ type: 'undirected' });
for (const p of pages.values()) g.addNode(p.id, { x: rng.range(-100, 100), y: rng.range(-100, 100) });
for (const p of pages.values()) for (const l of p.links) if (!g.hasEdge(p.id, l)) g.addEdge(p.id, l);
forceAtlas2.assign(g, { iterations: 260, settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: true, gravity: 1.2, scalingRatio: 6 } });
const ids = g.nodes();
const idIndex = new Map(ids.map((id, i) => [id, i]));
const graph: GraphJson = {
  ids,
  labels: ids.map((id) => pages.get(id)!.title),
  kinds: ids.map((id) => pages.get(id)!.kind),
  x: ids.map((id) => Math.round(g.getNodeAttribute(id, 'x') * 10) / 10),
  y: ids.map((id) => Math.round(g.getNodeAttribute(id, 'y') * 10) / 10),
  size: ids.map((id) => Math.round((1.5 + Math.sqrt(g.degree(id)) * 1.2) * 10) / 10),
  t0: ids.map((id) => pages.get(id)!.t0),
  t1: ids.map((id) => pages.get(id)!.t1),
  edges: g.mapEdges((_e, _a, s, t) => [idIndex.get(s)!, idIndex.get(t)!]).flat(),
};

// search
const search: SearchEntry[] = [...pages.values()].map((p) => [p.id, p.title, p.kind, p.t0, (p.names ?? []).map((x) => x.form).join('|')]);

// meta
const counts: Record<string, number> = {};
for (const p of pages.values()) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
counts.links = [...pages.values()].reduce((s, p) => s + p.links.length, 0);
const firstWar = wars[0];
const meta: MetaJson = {
  title: 'Palimpsest',
  subtitle: 'A 5,000-year archive of a civilization that never existed',
  worldName: 'Ereth',
  seed: 20261015,
  engineVersion: 'mock-0.1',
  yearStart: 0,
  yearEnd: YEAR_END,
  yearLabel: 'AY',
  counts,
  eras,
  check: {
    passed: true,
    invariants: [
      ['links', 'Every link target exists and has a backlink'],
      ['anachronism', 'Documents reference only entities and events that existed by their date'],
      ['authors', 'Authors were alive and literate in the document language'],
      ['offices', 'Rulers named in titles held office at the date'],
      ['cessions', 'Treaty cessions match the territory log'],
      ['prices', 'Ledger prices match the simulated price series'],
      ['names', 'Names are rendered in the document language at its date'],
      ['causes', 'The cause graph is acyclic and time-respecting'],
    ].map(([id, title]) => ({ id, title, checked: rng.int(2000, 90000), violations: 0 })),
  },
  editorialLanguage: 'Vellish',
  downloads: [
    { label: 'World database (SQLite)', href: 'downloads/world.sqlite.gz', bytes: 48_200_000 },
    { label: 'Obsidian vault (zip)', href: 'downloads/vault.zip', bytes: 31_400_000 },
  ],
  featured: [
    { id: firstWar.id, title: pages.get(firstWar.id)!.title, why: 'Two chronicles, one war, and they disagree about everything. Compare them against the ground truth.' },
    { id: artIds.find((a) => pages.get(a)!.sub === 'inscription')!, title: 'A dedication stele', why: 'Read an inscription in transliteration, gloss and translation.' },
    { id: artIds.find((a) => pages.get(a)!.sub === 'ledger')!, title: 'A merchant day-book', why: 'Prices that follow the harvests and the coinage.' },
    { id: 'lan:6', title: pages.get('lan:6')!.title, why: 'Watch a language drift, sound law by sound law.' },
  ],
};

// ------------------------------------------------------------------ write
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'pages'), { recursive: true });
const wj = (f: string, v: unknown) => writeFileSync(join(OUT, f), JSON.stringify(v));
wj('meta.json', meta);
wj('world.json', world);
wj('timeline.json', timeline);
wj('graph.json', graph);
wj('search.json', { entries: search });
const shards: PageJson[][] = Array.from({ length: SHARD_COUNT }, () => []);
for (const p of pages.values()) shards[shardOf(p.id)].push(p);
shards.forEach((ps, i) => wj(shardFile(i), { pages: ps }));
console.log(`mock: ${n} cells, ${polities.length} polities, ${settlements.length} settlements, ${events.length} events, ${pages.size} pages, ${graph.edges.length / 2} edges`);
void KIND_PREFIX;
