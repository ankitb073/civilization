// Split public/data/timeline.json into tl/ (core + per-millennium political chunks + deferred parts).
// Runs before every atlas build; a no-op when there is no timeline.json. The engine contract is unchanged:
// the atlas falls back to timeline.json when tl/ is missing.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { TimelineJson } from '../../engine/src/export/contract.ts';
import { TL_VERSION, type TlChunk, type TlCore, type TlEvents } from '../src/tl.ts';

const DATA = process.env.PAL_DATA_OUT ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const src = join(DATA, 'timeline.json');
if (!existsSync(src)) { console.log('prepare-data: no timeline.json, skipping'); process.exit(0); }

const t = JSON.parse(readFileSync(src, 'utf8')) as TimelineJson;
const OUT = join(DATA, 'tl');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const sizes: [string, number][] = [];
const write = (name: string, v: unknown) => {
  const s = JSON.stringify(v);
  writeFileSync(join(OUT, name), s);
  sizes.push([name, gzipSync(s).length]);
};

const pol = t.layers.political;
const every = pol.keyframeEvery;
const CHUNK_YEARS = 1000;
const perChunk = CHUNK_YEARS / every;

// decode the column-wise deltas
const n = pol.deltaCount;
const raw = Buffer.from(pol.deltas, 'base64');
const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + n * 6);
const steps = new Uint16Array(buf, 0, n), cells = new Uint16Array(buf, n * 2, n), idx = new Int16Array(buf, n * 4, n);
const years = new Int32Array(n);
let y = pol.deltaBase;
for (let i = 0; i < n; i++) { y += steps[i]; years[i] = y; }

const chunks: TlCore['political']['chunks'] = [];
for (let c = 0; c * perChunk < pol.keyframes.length; c++) {
  const k0 = c * perChunk, k1 = Math.min(pol.keyframes.length, k0 + perChunk);
  // changes needed to reach any year in this chunk's centuries: kfYear(k0) < year < kfYear(k1)
  const lo = k0 * every, hi = k1 * every;
  const sel: number[] = [];
  for (let i = 0; i < n; i++) if (years[i] > lo && years[i] <= hi) sel.push(i);
  const m = sel.length;
  const out = new ArrayBuffer(m * 6);
  const s2 = new Uint16Array(out, 0, m), c2 = new Uint16Array(out, m * 2, m), i2 = new Int16Array(out, m * 4, m);
  let prev = lo;
  sel.forEach((i, j) => { s2[j] = years[i] - prev; prev = years[i]; c2[j] = cells[i]; i2[j] = idx[i]; });
  const chunk: TlChunk = { firstKeyframe: k0, keyframes: pol.keyframes.slice(k0, k1), deltas: Buffer.from(out).toString('base64'), deltaCount: m, deltaBase: lo };
  const file = `political-${c}.json`;
  write(file, chunk);
  chunks.push({ file, firstKeyframe: k0, keyframes: k1 - k0 });
}

const ev: TlEvents = { id: [], year: [], end: [], sub: [], cell: [], sig: [], title: [] };
for (const e of t.events) { ev.id.push(e.id); ev.year.push(e.year); ev.end.push(e.end); ev.sub.push(e.sub); ev.cell.push(e.cell); ev.sig.push(e.sig); ev.title.push(e.title); }
write('events.json', ev);
write('routes.json', t.routes);
const sig2 = (v: number) => (v < 100 ? Math.round(v) : (() => { const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; })());
const L = pol.legend;
const core: TlCore = {
  v: TL_VERSION,
  layerFiles: t.layerFiles,
  polities: { id: t.polities.map((p) => p.id), idx: t.polities.map((p) => p.idx), names: t.polities.map((p) => p.names), capitals: t.polities.map((p) => p.capitals) },
  settlements: t.settlements.map((x) => ({ ...x, pop: x.pop.map(([yy, v]) => [yy, sig2(v)] as [number, number]) })),
  climate: t.climate,
  political: {
    legend: { idx: L.map((l) => l.idx), id: L.map((l) => l.id), name: L.map((l) => l.name), color: L.map((l) => l.color), start: L.map((l) => l.start), end: L.map((l) => l.end) },
    keyframeEvery: every, chunkYears: CHUNK_YEARS, chunks,
  },
  events: 'events.json',
  routes: 'routes.json',
};
write('core.json', core);
const total = gzipSync(readFileSync(src)).length;
console.log(`prepare-data: timeline.json ${(total / 1024).toFixed(0)} KB gz → tl/ ${sizes.map(([f, s]) => `${f} ${(s / 1024).toFixed(0)} KB`).join(', ')}`);
