// Atlas export: static JSON files under atlas/public/data, per engine/src/export/contract.ts.
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import type { SimResult } from '../sim/run.ts';
import type { Archive } from '../archive/build.ts';
import type { CheckReport } from '../check/check.ts';
import type {
  MetaJson, WorldJson, TimelineJson, GraphJson, SearchJson, SearchEntry, PageJson, Layer, Era, EntityKind, HistomapJson, StoryJson, LanguagesJson, EconomyJson, CollectionsJson, DynastiesJson, WordsIndexJson, WordJson,
} from './contract.ts';
import { SHARD_COUNT, shardOf, shardFile } from './contract.ts';
import { BIOMES } from '../world/biomes.ts';
import { TK } from '../sim/tech.ts';
import { GOODS } from '../sim/economy.ts';
import { Rng } from '../core/rng.ts';
import { CONCEPTS } from '../lang/concepts.ts';
import type { SimEvent } from '../sim/state.ts';

export const ENGINE_VERSION = '1.0.0';

// graphology ships CommonJS; load it through require with the small surface we use.
interface GraphLike {
  addNode(id: string, attrs: { x: number; y: number }): void;
  addEdge(a: string, b: string): void;
  getNodeAttribute(id: string, k: 'x' | 'y'): number;
  degree(id: string): number;
}
const require = createRequire(import.meta.url);
const { UndirectedGraph } = require('graphology') as { UndirectedGraph: new () => GraphLike };
const forceAtlas2 = require('graphology-layout-forceatlas2') as {
  assign(g: GraphLike, o: { iterations: number; settings: Record<string, unknown> }): void;
  inferSettings(g: GraphLike): Record<string, unknown>;
};

export interface ExportOptions {
  outDir: string;
  downloads?: { label: string; href: string; bytes: number }[];
  log?: (m: string) => void;
  layoutIterations?: number;
}

export function exportAtlas(r: SimResult, a: Archive, check: CheckReport | null, o: ExportOptions): MetaJson {
  const log = o.log ?? (() => {});
  const s = r.state;
  const T = a.T;
  const dir = o.outDir;
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(join(dir, 'pages'), { recursive: true });
  const write = (file: string, data: unknown) => {
    const txt = JSON.stringify(data);
    writeFileSync(join(dir, file), txt);
    return txt.length;
  };
  const sizes: Record<string, [number, number]> = {};
  const writeSized = (file: string, data: unknown) => {
    const txt = JSON.stringify(data);
    writeFileSync(join(dir, file), txt);
    sizes[file] = [txt.length, gzipSync(txt).length];
  };

  // ---------------------------------------------------------------- world
  const w = s.world;
  const points: number[] = [];
  for (let i = 0; i < w.n; i++) points.push(w.x[i], w.y[i]);
  const world: WorldJson = {
    width: w.width, height: w.height, points,
    elevation: Array.from(w.elev, (e, i) => (w.land[i] ? Math.max(128, Math.min(255, Math.round(128 + e * 127))) : Math.max(0, Math.min(127, Math.round(127 + e * 127))))),
    seaLevel: 128,
    biome: Array.from(w.biome),
    biomes: BIOMES.map((b) => ({ id: b.id, name: b.name, color: b.color })),
    rivers: w.rivers.map((rv, i) => ({ id: `riv:${i}`, name: T.short.get(`riv:${i}`) ?? '', cells: rv.cells, width: rv.cells.map((c) => Math.round((1 + 5 * Math.sqrt(w.flux[c] / rv.flux)) * 10) / 10) })),
    regions: Array.from({ length: w.regionCount }, (_, i) => ({ id: `reg:${i}`, name: T.short.get(`reg:${i}`) ?? '', labelCell: w.regionLabelCell[i] })),
    regionOf: Array.from(w.region),
  };
  writeSized('world.json', world);

  // ---------------------------------------------------------------- timeline
  const layer = (initial: Int32Array, logFlat: number[], legend: Layer['legend']): Layer => {
    const cur = Int16Array.from(initial);
    const keyframes: string[] = [];
    let li = 0;
    for (let k = 0; k <= 50; k++) {
      const K = k * 100;
      while (li < logFlat.length && logFlat[li] <= K) {
        cur[logFlat[li + 1]] = logFlat[li + 2];
        li += 4;
      }
      keyframes.push(Buffer.from(cur.buffer.slice(0)).toString('base64'));
    }
    const n = logFlat.length / 4;
    const base = n ? logFlat[0] : 0;
    const steps = new Uint16Array(n), cells = new Uint16Array(n), vals = new Int16Array(n);
    let prev = base;
    for (let i = 0; i < n; i++) {
      steps[i] = logFlat[4 * i] - prev;
      prev = logFlat[4 * i];
      cells[i] = logFlat[4 * i + 1];
      vals[i] = logFlat[4 * i + 2];
    }
    const buf = Buffer.concat([Buffer.from(steps.buffer), Buffer.from(cells.buffer), Buffer.from(vals.buffer)]);
    return { legend, keyframeEvery: 100, keyframes, deltas: buf.toString('base64'), deltaCount: n, deltaBase: base };
  };
  const political = layer(r.initial.owner, s.territoryLog, s.polities.map((p) => ({ idx: p.id, id: `pol:${p.id}`, name: T.short.get(`pol:${p.id}`) ?? '', color: p.color, start: p.born, end: p.died ?? 5000 })));
  const culture = layer(r.initial.culture, s.cultureLog, s.cultures.map((c) => ({ idx: c.id, id: `cul:${c.id}`, name: T.short.get(`cul:${c.id}`) ?? '', color: c.color, start: c.born, end: c.died ?? 5000 })));
  const relColors = new Rng(s.seed).fork('religion-colors');
  const religion = layer(r.initial.religion, s.religionLog, s.movements.map((m) => ({ idx: m.id, id: `mov:${m.id}`, name: T.short.get(`mov:${m.id}`) ?? '', color: hsl(relColors.next() * 360, 38 + relColors.next() * 20, 45 + relColors.next() * 15), start: m.born, end: m.died ?? 5000 })));
  writeSized('layer-culture.json', culture);
  writeSized('layer-religion.json', religion);
  // event markers: the most significant few per century
  const markers: TimelineJson['events'] = [];
  const byCentury = new Map<number, typeof s.events>();
  for (const e of s.events) {
    if (!T.pageRefs.has(`evt:${e.id}`) || e.cell < 0 || e.sig < 0.2) continue;
    const c = Math.floor(e.year / 100);
    if (!byCentury.has(c)) byCentury.set(c, []);
    byCentury.get(c)!.push(e);
  }
  for (const [, evs] of [...byCentury].sort((x, y) => x[0] - y[0])) {
    for (const e of evs.sort((x, y) => y.sig - x.sig || x.id - y.id).slice(0, 80).sort((x, y) => x.year - y.year || x.id - y.id)) {
      markers.push({ id: `evt:${e.id}`, year: e.year, end: e.end, sub: e.sub, title: T.title.get(`evt:${e.id}`) ?? '', cell: e.cell, sig: Math.round(e.sig * 100) / 100 });
    }
  }
  const timeline: TimelineJson = {
    layers: { political },
    layerFiles: { culture: 'layer-culture.json', religion: 'layer-religion.json' },
    polities: s.polities.map((p) => ({ idx: p.id, id: `pol:${p.id}`, names: [[p.born, T.short.get(`pol:${p.id}`) ?? '']], capitals: p.capitals.map(([y, c]) => [y, c] as [number, number]) })),
    settlements: s.settlements.map((t) => ({ idx: t.id, id: `set:${t.id}`, name: T.short.get(`set:${t.id}`) ?? '', cell: t.cell, start: t.founded, end: t.abandoned ?? 5000, pop: t.popHistory.map(([y, v]) => [y, v] as [number, number]) })),
    events: markers,
    climate: s.climate.map((c) => ({ year: c.year, temp: c.temp, precip: c.precip })),
    routes: s.routes.map((rt) => ({ year: rt.year, edges: rt.edges.map(([x, y, v]) => [x, y, Math.round(v * 100) / 100] as [number, number, number]) })),
  };
  writeSized('timeline.json', timeline);
  log(`timeline: ${(sizes['timeline.json'][1] / 1024).toFixed(0)} KB gz`);

  // ---------------------------------------------------------------- graph (structural edges + ForceAtlas2)
  const ids = [...a.pages.keys()];
  const index = new Map(ids.map((id, i) => [id, i]));
  const edgeSet = new Set<number>();
  const edges: number[] = [];
  const addEdge = (x: string, y: string) => {
    const i = index.get(x), j = index.get(y);
    if (i === undefined || j === undefined || i === j) return;
    const key = i < j ? i * 1_000_000 + j : j * 1_000_000 + i;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push(i, j);
  };
  const LINK = /\[\[([a-z]{3}:\d+)\|/g;
  for (const pg of a.pages.values()) {
    for (const [, v] of pg.infobox) for (const m of v.matchAll(LINK)) addEdge(pg.id, m[1]);
    if (pg.kind === 'artifact') for (const l of pg.links.slice(0, 12)) addEdge(pg.id, l);
  }
  const t0 = performance.now();
  const g = new UndirectedGraph();
  const hash = new Rng(s.seed).fork('layout');
  ids.forEach((id) => {
    const pg = a.pages.get(id)!;
    const t = Math.max(0, Math.min(5000, pg.t0));
    g.addNode(id, { x: (t / 5000) * 2000 - 1000 + hash.normal(0, 60), y: hash.normal(0, 400) });
  });
  for (let k = 0; k < edges.length; k += 2) g.addEdge(ids[edges[k]], ids[edges[k + 1]]);
  const settings = forceAtlas2.inferSettings(g);
  forceAtlas2.assign(g, { iterations: o.layoutIterations ?? 40, settings: { ...settings, barnesHutOptimize: true, barnesHutTheta: 1.2, gravity: 0.6, scalingRatio: 8, adjustSizes: false, linLogMode: false } });
  log(`layout: ${ids.length} nodes, ${edges.length / 2} edges in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  const graph: GraphJson = {
    ids, labels: ids.map((id) => trim(T.short.get(id) ?? a.pages.get(id)!.title, 48)),
    kinds: ids.map((id) => a.pages.get(id)!.kind),
    x: ids.map((id) => Math.round(g.getNodeAttribute(id, 'x'))),
    y: ids.map((id) => Math.round(g.getNodeAttribute(id, 'y'))),
    size: ids.map((id) => Math.round((1 + Math.log2(1 + g.degree(id))) * 10) / 10),
    t0: ids.map((id) => a.pages.get(id)!.t0),
    t1: ids.map((id) => a.pages.get(id)!.t1),
    edges,
  };
  writeSized('graph.json', graph);

  // ---------------------------------------------------------------- search
  const entries: SearchEntry[] = [];
  for (const pg of a.pages.values()) {
    const aliases = new Set<string>();
    const short = T.short.get(pg.id);
    if (short && short !== pg.title) aliases.add(short);
    for (const n of pg.names ?? []) aliases.add(n.form);
    if (pg.artifact) aliases.add(pg.artifact.catalog);
    entries.push([pg.id, pg.title, pg.kind as EntityKind, pg.t0, [...aliases].join('|'), pg.sub]);
  }
  writeSized('search.json', { entries } as SearchJson);

  // ---------------------------------------------------------------- page shards
  const titleOf = (id: string) => a.pages.get(id)?.title ?? id;
  const shards: PageJson[][] = Array.from({ length: SHARD_COUNT }, () => []);
  let raw = 0;
  for (const pg of a.pages.values()) {
    const out: PageJson = { ...pg };
    if (out.backlinks.length > 300) {
      out.backlinkCount = out.backlinks.length;
      // keep the most significant: documents and events first, then most recent
      out.backlinks = out.backlinks.slice().sort((x, y) => rankRef(x) - rankRef(y)).slice(0, 300);
    }
    const labels: Record<string, string> = {};
    for (const l of out.links) labels[l] = titleOf(l);
    for (const l of out.backlinks) labels[l] = titleOf(l);
    out.labels = labels;
    shards[shardOf(pg.id)].push(out);
  }
  for (let i = 0; i < SHARD_COUNT; i++) raw += write(shardFile(i), { pages: shards[i] });
  log(`pages: ${a.pages.size} in ${SHARD_COUNT} shards, ${(raw / 1e6).toFixed(0)} MB raw`);

  // ---------------------------------------------------------------- collections & dynasties
  writeSized('collections.json', collectionsJson(r, a));
  writeSized('dynasties.json', dynastiesJson(r, a));

  // ---------------------------------------------------------------- languages & economy
  writeSized('languages.json', languagesJson(r, a));
  {
    const { index, words } = wordsJson(r, a);
    mkdirSync(join(dir, 'words'), { recursive: true });
    writeSized('words/index.json', index);
    let raw = 0;
    for (const w of words) raw += write(`words/${w.concept}.json`, w);
    log(`words: ${words.length} concepts, ${(raw / 1e6).toFixed(1)} MB raw`);
  }
  writeSized('economy.json', economyJson(r, a));

  // ---------------------------------------------------------------- story
  writeSized('story.json', story(r, a));

  // ---------------------------------------------------------------- histomap
  writeSized('histomap.json', histomap(r, a));

  // ---------------------------------------------------------------- meta
  const eras = computeEras(r, a);
  const counts: Record<string, number> = {};
  for (const pg of a.pages.values()) counts[pg.kind] = (counts[pg.kind] ?? 0) + 1;
  counts.documents = a.artifacts.length;
  counts.links = a.links;
  counts.years = 5000;
  counts.events = s.events.length;
  const worldName = worldNameOf(r, a);
  const meta: MetaJson = {
    title: 'Palimpsest',
    subtitle: `A 5,000-year archive of ${worldName}, a world that never existed`,
    worldName,
    seed: s.seed,
    engineVersion: ENGINE_VERSION,
    yearStart: 0,
    yearEnd: 5000,
    yearLabel: 'AY',
    counts,
    eras,
    check: check
      ? { passed: check.passed, invariants: check.invariants.map((x) => ({ id: x.id, title: x.title, checked: x.checked, violations: x.violations })) }
      : { passed: false, invariants: [] },
    editorialLanguage: T.short.get(`lan:${a.ctx.editorialLang}`) ?? '',
    downloads: o.downloads ?? [],
    featured: featured(r, a),
    flagships: a.artifacts.filter((x) => x.flagship).map((x) => `art:${x.id}`),
    world: worldFingerprint(r),
  };
  writeSized('meta.json', meta);
  for (const [f, [rawB, gz]] of Object.entries(sizes)) log(`  ${f}: ${(rawB / 1024).toFixed(0)} KB raw, ${(gz / 1024).toFixed(0)} KB gz`);
  void statSync;
  return meta;
}

function trim(x: string, n: number): string {
  return x.length <= n ? x : x.slice(0, n - 1) + '…';
}

function collectionsJson(r: SimResult, a: Archive): CollectionsJson {
  const s = r.state;
  const T = a.T;
  const ctx = a.ctx;
  const out: CollectionsJson['collections'] = [];
  const add = (id: string, title: string, blurb: string, items: { id: string; note: string; year: number }[], max = 40) => {
    const it = items.filter((x) => a.pages.has(x.id)).map((x) => ({ ...x, title: a.pages.get(x.id)!.title }));
    if (it.length >= 3) out.push({ id, title, blurb, items: it.slice(0, max) });
  };
  // the narrative History comes first: it is the way in for new readers
  const fnum = (x: (typeof a.artifacts)[number]) => Number(String(x.data?.flagshipId ?? '').slice(3)) || 0;
  const hist = a.artifacts.filter((x) => x.flagship && fnum(x) >= 900 && fnum(x) < 1000).sort((x, y) => fnum(x) - fnum(y));
  add('history', `A History of ${worldNameOf(r, a)}`, `Five thousand years in ${hist.length} chapters, by the archive’s modern historians: start here.`, hist.map((x) => ({ id: `art:${x.id}`, note: fnum(x) === 900 ? 'Introduction' : `Chapter ${fnum(x) - 900} · AY ${(fnum(x) - 901) * 250}–${(fnum(x) - 900) * 250}`, year: (fnum(x) - 901) * 250 })));
  const simEvents = r.simEvents ?? s.events.length;
  const evs = s.events.slice(0, simEvents);
  // rulers
  const reigns: { person: number; pid: number; start: number; end: number }[] = [];
  for (const [pid, rs] of ctx.reigns) for (const x of rs) if (x.role === 'ruler') reigns.push({ person: x.person, pid, start: x.start, end: x.end });
  add('queens', 'Queens and empresses', 'Women who ruled in their own right, longest reigns first.', reigns.filter((x) => s.persons[x.person].sex === 'f').sort((x, y) => (y.end - y.start) - (x.end - x.start)).map((x) => ({ id: `per:${x.person}`, note: `${T.short.get(`pol:${x.pid}`)}, AY ${x.start}–${x.end}`, year: x.start })));
  add('long-reigns', 'The longest reigns', 'Rulers who held the throne for half a century or more.', reigns.filter((x) => x.end - x.start >= 45).sort((x, y) => (y.end - y.start) - (x.end - x.start)).map((x) => ({ id: `per:${x.person}`, note: `${x.end - x.start} years in ${T.short.get(`pol:${x.pid}`)}`, year: x.start })));
  add('usurpers', 'Usurpers', 'Those who seized thrones that were not theirs.', evs.filter((e) => e.sub === 'usurpation').sort((x, y) => y.sig - x.sig).map((e) => ({ id: `evt:${e.id}`, note: `AY ${e.year}`, year: e.year })));
  add('plagues', 'The great plagues', 'Pandemics traced along the trade routes, worst first.', evs.filter((e) => e.sub === 'plague').sort((x, y) => Number(y.data.deaths) - Number(x.data.deaths)).map((e) => ({ id: `evt:${e.id}`, note: `${Math.round(Number(e.data.deaths) / 1000).toLocaleString('en-US')} thousand dead${e.data.virginSoil ? ' · virgin soil' : ''}`, year: e.year })));
  add('volcanic', 'Volcanic winters', 'The great eruptions and the cold, hungry years after them.', s.anomalies.filter((x) => x.kind === 'eruption').sort((x, y) => y.severity - x.severity || x.start - y.start).map((x) => ({ id: `cli:${x.id}`, note: `VEI ${x.severity}, AY ${x.start}`, year: x.start })));
  add('collapses', 'Collapses of great powers', 'States that broke apart, and why.', evs.filter((e) => e.sub === 'collapse').sort((x, y) => y.sig - x.sig).map((e) => ({ id: `evt:${e.id}`, note: `AY ${e.year}`, year: e.year })));
  add('rival', 'Wars told twice', 'Wars for which both sides’ chronicles survive: compare them with the record.', [...a.pages.values()].filter((p) => p.accounts && p.accounts.sources.length >= 2).sort((x, y) => x.t0 - y.t0).map((p) => ({ id: p.id, note: `${p.accounts!.sources.length} accounts`, year: p.t0 })));
  add('contact', 'The age of contact', 'First contacts, colonies and colonial wars.', evs.filter((e) => e.sub === 'first-contact' || e.sub === 'colonization' || (e.sub === 'war' && e.data.goal === 'colonial')).sort((x, y) => x.year - y.year).map((e) => ({ id: `evt:${e.id}`, note: `AY ${e.year}`, year: e.year })));
  add('revolutions', 'Revolutions', 'When the old order fell.', evs.filter((e) => e.sub === 'revolution').sort((x, y) => x.year - y.year).map((e) => ({ id: `evt:${e.id}`, note: `AY ${e.year}`, year: e.year })));
  add('founders', 'Founders of faiths and schools', 'Prophets and philosophers whose teachings outlived them.', s.movements.filter((m) => m.founder !== null && (m.kind === 'religion' || m.kind === 'philosophy' || m.kind === 'ideology')).sort((x, y) => y.peak - x.peak).map((m) => ({ id: `per:${m.founder}`, note: `${T.short.get(`mov:${m.id}`)} (${m.kind}), AY ${m.born}`, year: m.born })));
  add('debased', 'The most debased coins', 'Currencies whose silver vanished, issue by issue.', s.currencies.filter((c) => c.kind === 'coin' && c.history.length > 2).sort((x, y) => x.history[x.history.length - 1][1] / x.history[0][1] - y.history[y.history.length - 1][1] / y.history[0][1]).map((c) => ({ id: `cur:${c.id}`, note: `${Math.round((1 - c.history[c.history.length - 1][1] / c.history[0][1]) * 100)}% of its silver lost`, year: c.born })));
  add('fragments', 'Lost works', 'Works known only from quotations in later books.', a.artifacts.filter((x) => x.condition.startsWith('Lost;')).sort((x, y) => x.year - y.year).map((x) => ({ id: `art:${x.id}`, note: `AY ${x.year}`, year: x.year })));
  const flag = a.artifacts.filter((x) => x.flagship);
  add('poems', 'Poems and songs', 'Epics, laments, hymns and satires from the flagship sources.', flag.filter((x) => x.sub === 'poem').sort((x, y) => x.year - y.year).map((x) => ({ id: `art:${x.id}`, note: `AY ${x.year}`, year: x.year })));
  add('letters', 'Letters', 'Flagship letters: from the front, from hostages, refugees, merchants and kings.', flag.filter((x) => x.sub === 'letter').sort((x, y) => x.year - y.year).map((x) => ({ id: `art:${x.id}`, note: `AY ${x.year}`, year: x.year })));
  const form = (x: (typeof flag)[number]) => String(x.data?.form ?? '');
  add('voices', 'Voices from below', 'Farmers, apprentices, conscripts, market women and refugees: ordinary people living through famines, plagues, sacks and revolutions.', flag.filter((x) => fnum(x) >= 700 && fnum(x) < 900).sort((x, y) => x.year - y.year).map((x) => ({ id: `art:${x.id}`, note: `AY ${x.year}`, year: x.year })), 120);
  add('lives', 'Lives', 'Long-form biographies by the archive’s modern scholars.', flag.filter((x) => fnum(x) >= 600 && fnum(x) < 700).sort((x, y) => x.title.localeCompare(y.title)).map((x) => ({ id: `art:${x.id}`, note: `AY ${x.year}`, year: x.year })));
  add('essays', 'Essays on the sources', 'Modern scholars weigh the chronicles against the record.', flag.filter((x) => /journal article|survey lecture|philological essay|biographical essay$/.test(form(x)) && fnum(x) < 600).sort((x, y) => x.title.localeCompare(y.title)).map((x) => ({ id: `art:${x.id}`, note: `AY ${x.year}`, year: x.year })));
  return { collections: out };
}

function dynastiesJson(r: SimResult, a: Archive): DynastiesJson {
  const s = r.state;
  const T = a.T;
  const ctx = a.ctx;
  const reignOf = new Map<number, [number, number]>();
  for (const [, rs] of ctx.reigns) for (const x of rs) if (x.role === 'ruler' && !reignOf.has(x.person)) reignOf.set(x.person, [x.start, x.end]);
  const scored = s.dynasties.map((d) => {
    const members = s.persons.filter((p) => p.dynasty === d.id && reignOf.has(p.id));
    const years = members.reduce((acc, p) => acc + reignOf.get(p.id)![1] - reignOf.get(p.id)![0], 0);
    return { d, years, rulers: members.length };
  }).filter((x) => x.rulers >= 4).sort((x, y) => y.years - x.years).slice(0, 50);
  return {
    dynasties: scored.map(({ d }) => {
      const rulers = s.persons.filter((p) => p.dynasty === d.id && reignOf.has(p.id));
      const ids = new Set<number>(rulers.map((p) => p.id));
      // include parents that connect rulers (non-ruling links in the line)
      for (const p of rulers) { let f = p.father; let guard = 0; while (f !== null && !ids.has(f) && guard++ < 3) { ids.add(f); f = s.persons[f].father; } }
      const members = [...ids].map((id) => s.persons[id]).filter((p) => T.pageRefs.has(`per:${p.id}`) || reignOf.has(p.id)).sort((x, y) => x.born - y.born);
      const inSet = new Set(members.map((p) => p.id));
      return {
        id: `dyn:${d.id}`, name: `House of ${T.short.get(`per:${d.founder}`) ?? ''}`, polity: `pol:${d.polity}`, start: d.start, end: d.end ?? 5000,
        members: members.map((p) => ({
          id: `per:${p.id}`, name: T.short.get(`per:${p.id}`) ?? '', sex: p.sex, born: p.born, died: p.died,
          parent: p.father !== null && inSet.has(p.father) ? `per:${p.father}` : p.mother !== null && inSet.has(p.mother) ? `per:${p.mother}` : null,
          reign: reignOf.get(p.id) ?? null, epithet: T.epithet.get(p.id) ?? null,
        })),
      };
    }),
  };
}

function languagesJson(r: SimResult, a: Archive): LanguagesJson {
  const s = r.state;
  const T = a.T;
  const langs = s.lang.languages();
  const rootOf = (id: number): number => { let l = id; for (;;) { const p = s.lang.info(l).parent; if (p === null) return l; l = p; } };
  return {
    languages: langs.map((l) => ({
      id: `lan:${l.id}`, name: T.short.get(`lan:${l.id}`) ?? '', parent: l.parent !== null ? `lan:${l.parent}` : null, family: `lan:${rootOf(l.id)}`,
      born: l.born, died: l.died, soundChanges: s.lang.soundChanges(l.id).filter((c) => c.lang === l.id).length, style: s.lang.familyStyle(l.id),
      speakers: s.cultures.filter((c) => c.lang === l.id).map((c) => `cul:${c.id}`),
      sample: ['water', 'king', 'god', 'mother'].map((c) => [c, s.lang.word(l.id, c, l.born).conventional, s.lang.word(l.id, c, Math.min(l.died ?? 5000, 5000)).conventional] as [string, string, string]),
    })),
    cultureLanguage: Object.fromEntries(s.cultures.map((c) => [c.id, `lan:${c.lang}`])),
  };
}

const CULTURE_WORDS = ['king', 'queen', 'great-king', 'lord', 'god', 'goddess', 'priest', 'scribe', 'merchant', 'soldier', 'slave', 'city', 'temple', 'palace',
  'war', 'peace', 'treaty', 'battle', 'army', 'law', 'tax', 'tribute', 'silver', 'gold', 'bronze', 'iron', 'coin', 'ship', 'road', 'market', 'sword',
  'chariot', 'book', 'letter', 'prayer', 'truth', 'freedom', 'justice', 'empire', 'throne', 'crown', 'paper', 'bank', 'steam', 'machine', 'rail'];

function wordsJson(r: SimResult, a: Archive): { index: WordsIndexJson; words: WordJson[] } {
  const L = r.state.lang;
  const langs = L.languages();
  const ed = a.ctx.editorialLang;
  const known = new Set(CONCEPTS.map((c) => c.id));
  const picked: { id: string; group: 'core' | 'culture' }[] = [
    ...CONCEPTS.filter((c) => c.core).map((c) => ({ id: c.id, group: 'core' as const })),
    ...CULTURE_WORDS.filter((c) => known.has(c) && !CONCEPTS.find((x) => x.id === c)?.core).map((id) => ({ id, group: 'culture' as const })),
  ];
  const words: WordJson[] = picked.map(({ id: c }) => ({
    concept: c,
    langs: langs.map((l) => {
      const end = Math.min(l.died ?? 5000, 5000);
      const steps: WordJson['langs'][number]['steps'] = [];
      let w = L.word(l.id, c, l.born);
      steps.push([l.born, w.conventional, w.ipa, l.parent === null ? 'proto' : null]);
      let prev = w.conventional;
      const own = L.soundChanges(l.id).filter((ch) => ch.lang === l.id && ch.year > l.born && ch.year <= end);
      for (const ch of own) {
        const before = L.word(l.id, c, ch.year - 1);
        if (before.conventional !== prev && ch.year - 1 > steps[steps.length - 1][0]) { steps.push([ch.year - 1, before.conventional, before.ipa, 'replaced']); prev = before.conventional; }
        w = L.word(l.id, c, ch.year);
        if (w.conventional !== prev) { steps.push([ch.year, w.conventional, w.ipa, ch.label]); prev = w.conventional; }
      }
      w = L.word(l.id, c, end);
      if (w.conventional !== prev) steps.push([end, w.conventional, w.ipa, 'replaced']);
      return { id: `lan:${l.id}`, steps };
    }),
  }));
  return {
    index: { concepts: picked.map(({ id, group }) => ({ id, group, modern: L.word(ed, id, 5000).conventional })), sampleLanguage: `lan:${ed}` },
    words,
  };
}

function economyJson(r: SimResult, a: Archive): EconomyJson {
  const s = r.state;
  const T = a.T;
  const pb = r.econ.priceBuf;
  const byYear = new Map<number, Map<number, number[]>>();
  for (let i = 0; i < pb.length; i += 4) {
    const y = pb[i], g = pb[i + 2], p = pb[i + 3];
    let m = byYear.get(y);
    if (!m) byYear.set(y, (m = new Map()));
    let arr = m.get(g);
    if (!arr) m.set(g, (arr = []));
    arr.push(p);
  }
  const med = (xs: number[] | undefined) => {
    if (!xs || !xs.length) return null;
    const v = xs.slice().sort((x, y) => x - y);
    return Math.round(v[Math.floor(v.length / 2)] * 100) / 100;
  };
  const gi = (k: string) => GOODS.findIndex((g) => g.key === k);
  const prices: EconomyJson['prices'] = [];
  const level: [number, number][] = [];
  for (const [y, m] of [...byYear].sort((x, z) => x[0] - z[0])) {
    prices.push([y, med(m.get(gi('grain'))), med(m.get(gi('tin'))), med(m.get(gi('iron'))), m.get(gi('grain'))?.length ?? 0]);
    const rel: number[] = [];
    for (const [g, xs] of m) { const v = med(xs); if (v !== null) rel.push(v / GOODS[g].base); }
    const l = med(rel);
    if (l !== null) level.push([y, l]);
  }
  const big = s.currencies.filter((c) => c.history.length > 2 || c.kind !== 'weight').sort((x, y) => y.history.length - x.history.length).slice(0, 60);
  return {
    goods: GOODS.map((g) => ({ id: g.id, key: g.key, name: g.name, unit: g.unit })),
    prices, priceLevel: level,
    currencies: big.map((c) => ({ id: `cur:${c.id}`, name: T.short.get(`cur:${c.id}`) ?? '', issuer: `pol:${c.polity}`, kind: c.kind, history: c.history.map(([y, v]) => [y, Math.round(v * 10000) / 10000] as [number, number]) })),
    events: s.events.filter((e) => ['debasement', 'panic', 'hyperinflation', 'trade-collapse', 'default', 'coinage', 'paper-money'].includes(e.sub) && T.pageRefs.has(`evt:${e.id}`) && (e.sub !== 'coinage' || e.sig >= 0.3)).map((e) => ({ id: `evt:${e.id}`, year: e.year, sub: e.sub, title: T.title.get(`evt:${e.id}`) ?? '' })),
  };
}

export function storyOf(r: SimResult, a: Archive): StoryJson {
  return story(r, a);
}

export function featuredOf(r: SimResult, a: Archive): MetaJson['featured'] {
  return featured(r, a);
}

function story(r: SimResult, a: Archive): StoryJson {
  const s = r.state;
  const T = a.T;
  const eras = computeEras(r, a);
  const docsAbout = new Map<number, { id: string; title: string; flagship: boolean; score: number }[]>();
  for (const x of a.artifacts) {
    const score = (x.flagship ? 10 : 0) + (x.sub === 'chronicle' ? 3 : x.sub === 'treaty' ? 2 : x.sub === 'inscription' ? 2 : 1);
    for (const e of x.about) {
      if (!docsAbout.has(e)) docsAbout.set(e, []);
      docsAbout.get(e)!.push({ id: `art:${x.id}`, title: x.title, flagship: x.flagship, score });
    }
  }
  const SUBS = new Set(['war', 'collapse', 'plague', 'eruption', 'first-contact', 'trade-collapse', 'movement-founding', 'schism', 'revolution', 'invention', 'script-invention', 'conquest', 'colonization', 'famine', 'migration', 'treaty']);
  const chapters: StoryJson['chapters'] = [];
  for (const er of eras) {
    const evs = s.events.filter((e) => e.year >= er.start && e.year < er.end && SUBS.has(e.sub) && T.pageRefs.has(`evt:${e.id}`) && e.cell >= 0);
    // favour events with documents, diversity of kinds, spread through the era
    const scored = evs.map((e) => ({ e, score: e.sig + Math.min(0.4, (docsAbout.get(e.id)?.reduce((m, d) => Math.max(m, d.score), 0) ?? 0) / 25) }));
    scored.sort((x, y) => y.score - x.score || x.e.id - y.e.id);
    const picked: SimEvent[] = [];
    const perSub = new Map<string, number>();
    for (const { e } of scored) {
      if (picked.length >= 7) break;
      if ((perSub.get(e.sub) ?? 0) >= 2) continue;
      if (picked.some((p) => Math.abs(p.year - e.year) < (er.end - er.start) / 14)) continue;
      picked.push(e);
      perSub.set(e.sub, (perSub.get(e.sub) ?? 0) + 1);
    }
    picked.sort((x, y) => x.year - y.year);
    chapters.push({
      eraId: er.id, title: er.name, start: er.start, end: er.end, intro: er.blurb,
      beats: picked.map((e) => ({
        year: e.year, eventId: `evt:${e.id}`, title: T.title.get(`evt:${e.id}`) ?? '', text: a.pages.get(`evt:${e.id}`)?.summary ?? '', cell: e.cell,
        docs: (docsAbout.get(e.id) ?? []).sort((x, y) => y.score - x.score).slice(0, 3).map(({ id, title, flagship }) => ({ id, title, flagship })),
      })),
    });
  }
  return { chapters };
}

function histomap(r: SimResult, a: Archive): HistomapJson {
  const s = r.state;
  const STEP = 20; // a multiple of the decadal statistics
  const years: number[] = [];
  for (let y = 0; y <= 4990; y += STEP) years.push(y);
  const idx = new Map(years.map((y, i) => [y, i]));
  // decadal stats → population per polity per sample
  const pop = new Map<number, Float64Array>();
  const world = new Float64Array(years.length);
  for (const row of s.polityYears) {
    const y = row[1] as number;
    if (y % STEP !== 0 || !idx.has(y)) continue;
    const i = idx.get(y)!;
    const pid = row[0] as number;
    let a1 = pop.get(pid);
    if (!a1) pop.set(pid, (a1 = new Float64Array(years.length)));
    a1[i] = row[3] as number;
  }
  // world population: states plus the stateless, from settlement-scale proxy (states' share grows over time)
  for (let i = 0; i < years.length; i++) {
    let st = 0;
    for (const a1 of pop.values()) st += a1[i];
    world[i] = st;
  }
  // keep the biggest streams, fold the rest into 'other'
  const peak = [...pop.entries()].map(([pid, a1]) => [pid, Math.max(...a1)] as const).sort((x, y) => y[1] - x[1]);
  const keep = new Set(peak.slice(0, 140).map(([pid]) => pid));
  const other = new Float64Array(years.length);
  for (const [pid, a1] of pop) if (!keep.has(pid)) for (let i = 0; i < years.length; i++) other[i] += a1[i];
  const series: HistomapJson['series'] = [];
  for (const pid of keep) {
    const p = s.polities[pid];
    const a1 = pop.get(pid)!;
    const cap = s.settlements[p.capitals[0][1]].cell;
    series.push({
      id: `pol:${pid}`, name: a.T.short.get(`pol:${pid}`) ?? '', color: p.color, order: s.world.x[cap],
      start: p.born, end: p.died ?? 5000, share: Array.from(a1, (v, i) => (world[i] > 0 ? Math.round((v / world[i]) * 10000) / 10000 : 0)),
    });
  }
  series.sort((x, y) => x.order - y.order);
  series.forEach((x, i) => { x.order = i; });
  series.push({ id: 'other', name: 'Lesser states', color: '#b8ab92', order: series.length, start: 0, end: 5000, share: Array.from(other, (v, i) => (world[i] > 0 ? Math.round((v / world[i]) * 10000) / 10000 : 0)) });
  return { years, worldPop: Array.from(world, (v) => Math.round(v)), series };
}

function rankRef(ref: string): number {
  const p = ref.slice(0, 3);
  return p === 'art' ? 0 : p === 'evt' ? 1 : p === 'pol' ? 2 : 3;
}

/** A short fingerprint of the simulated world: changes whenever simulation output changes. */
export function worldFingerprint(r: SimResult): string {
  let h = 0x811c9dc5;
  const mix = (x: number) => { h = Math.imul(h ^ (x | 0), 0x01000193) >>> 0; };
  mix(r.state.seed);
  const n = r.simEvents ?? r.state.events.length;
  mix(n);
  mix(r.simPersons ?? r.state.persons.length);
  for (let i = 0; i < n; i++) { const e = r.state.events[i]; mix(e.year); mix(e.sub.length); mix(e.cell); }
  return h.toString(16).padStart(8, '0');
}

export function worldNameOf(r: SimResult, a: Archive): string {
  const s = r.state;
  for (const c of ['earth', 'land', 'realm', 'world']) {
    try {
      const w = capFirst(s.lang.word(a.ctx.editorialLang, c, 5000).conventional);
      if (w.replace(/[^\p{L}]/gu, '').length >= 4) return w;
    } catch { /* concept missing */ }
  }
  return capFirst(s.lang.realize(s.lang.info(a.ctx.editorialLang).endonym, a.ctx.editorialLang, 5000).conventional);
}

function capFirst(x: string): string {
  return x ? x[0].toUpperCase() + x.slice(1) : x;
}

function hsl(h: number, sat: number, l: number): string {
  const s1 = sat / 100, l1 = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s1 * Math.min(l1, 1 - l1);
  const f = (n: number) => l1 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

export function computeEras(r: SimResult, a: Archive): Era[] {
  const s = r.state;
  const first = (key: string) => {
    let best = 5000;
    for (const p of s.polities) {
      const y = p.techs.get(TK[key]);
      if (y !== undefined && y < best) best = y;
    }
    return best;
  };
  const marks: [string, string, number][] = [
    ['bronze', 'Age of Bronze', 0],
    ['iron', 'Age of Iron', first('iron')],
    ['coin', 'Age of Coin and Creed', first('coinage')],
    ['parchment', 'Age of Parchment and Plough', first('paper')],
    ['print', 'Age of Sail and Print', first('printing')],
    ['engines', 'Age of Engines', first('steam')],
    ['networks', 'Age of Networks', first('computing')],
  ].filter(([, , y]) => (y as number) < 5000) as [string, string, number][];
  marks.sort((x, y) => x[2] - y[2]);
  const eras: Era[] = [];
  for (let i = 0; i < marks.length; i++) {
    const [id, name, start] = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1][2] : 5000;
    if (end <= start) continue;
    eras.push({ id, name, start, end, blurb: eraBlurb(r, a, start, end) });
  }
  return eras;
}

function eraBlurb(r: SimResult, a: Archive, start: number, end: number): string {
  const s = r.state;
  const T = a.T;
  const evs = s.events.filter((e) => e.year >= start && e.year < end);
  const wars = evs.filter((e) => e.sub === 'war').length;
  const collapses = evs.filter((e) => e.sub === 'collapse').length;
  const top = evs.filter((e) => T.pageRefs.has(`evt:${e.id}`) && ['collapse', 'plague', 'eruption', 'trade-collapse', 'invention', 'schism', 'movement-founding', 'revolution'].includes(e.sub)).sort((x, y) => y.sig - x.sig).slice(0, 2);
  // largest polity of the era
  let big: number | null = null, bigCells = 0;
  for (const row of s.polityYears) {
    const y = row[1] as number;
    if (y < start || y >= end) continue;
    if ((row[2] as number) > bigCells) { bigCells = row[2] as number; big = row[0] as number; }
  }
  const parts = [`${wars.toLocaleString('en-US')} wars and ${collapses} collapses.`];
  if (big !== null) parts.push(`Largest state: ${T.title.get(`pol:${big}`)} (${bigCells} districts).`);
  if (top.length) parts.push(`Marked by ${top.map((e) => T.short.get(`evt:${e.id}`)).join(' and ')}.`);
  return parts.join(' ');
}

function featured(r: SimResult, a: Archive): MetaJson['featured'] {
  const s = r.state;
  const T = a.T;
  const out: MetaJson['featured'] = [];
  const add = (id: string | undefined, why: string) => {
    if (!id || !a.pages.has(id) || out.some((x) => x.id === id)) return;
    out.push({ id, title: a.pages.get(id)!.title, why });
  };
  // a war told by both sides
  const rivals = [...a.pages.values()].filter((p) => p.accounts && p.accounts.sources.length >= 2).sort((x, y) => (y.accounts!.sources.length - x.accounts!.sources.length) || (s.events[Number(y.id.slice(4))].sig - s.events[Number(x.id.slice(4))].sig));
  if (rivals[0]) add(rivals[0].id, 'Two chronicles, two wars: compare each side’s account with what really happened.');
  const deadliest = s.events.filter((e) => e.sub === 'war').sort((x, y) => (Number(y.data.lossesA ?? 0) + Number(y.data.lossesD ?? 0)) - (Number(x.data.lossesA ?? 0) + Number(x.data.lossesD ?? 0)))[0];
  if (deadliest) add(`evt:${deadliest.id}`, 'The deadliest war in five thousand years.');
  const peakOf = new Map<number, number>();
  for (const row of s.polityYears) peakOf.set(row[0] as number, Math.max(peakOf.get(row[0] as number) ?? 0, row[2] as number));
  const longest = s.polities.filter((p) => (peakOf.get(p.id) ?? 0) >= 60).sort((x, y) => ((y.died ?? 5000) - y.born) - ((x.died ?? 5000) - x.born))[0];
  if (longest) add(`pol:${longest.id}`, `The longest-lived great power: ${((longest.died ?? 5000) - longest.born)} years.`);
  const biggest = s.polityYears.slice().sort((x, y) => (y[2] as number) - (x[2] as number))[0];
  if (biggest) add(`pol:${biggest[0]}`, `The greatest extent ever reached: ${biggest[2]} districts in AY ${biggest[1]}.`);
  const eruption = s.anomalies.filter((x) => x.kind === 'eruption').sort((x, y) => y.severity - x.severity || x.start - y.start)[0];
  if (eruption) add(`cli:${eruption.id}`, 'A volcanic winter, and the famines that followed.');
  const tc = s.events.find((e) => e.sub === 'trade-collapse');
  if (tc) add(`evt:${tc.id}`, 'When long-distance trade fell apart, and why.');
  const plague = s.events.filter((e) => e.sub === 'plague').sort((x, y) => Number(y.data.deaths) - Number(x.data.deaths))[0];
  if (plague) add(`evt:${plague.id}`, 'The worst pandemic, traced city by city along the trade routes.');
  const firstScript = s.events.find((e) => e.sub === 'script-invention');
  if (firstScript) add(`evt:${firstScript.id}`, 'The invention of writing.');
  const ins = a.artifacts.filter((x) => x.interlinear && x.sub === 'inscription' && x.year < 1500).sort((x, y) => x.year - y.year)[0];
  if (ins) add(`art:${ins.id}`, 'An inscription in transliteration, interlinear gloss and translation.');
  const ledger = a.artifacts.find((x) => x.sub === 'ledger' && x.ledger && x.ledger.notes.length >= 2);
  if (ledger) add(`art:${ledger.id}`, 'A merchant’s day-book, with prices that follow harvests, wars and debased coin.');
  const fam = s.lang.languages().filter((l) => l.parent !== null).sort((x, y) => s.lang.soundChanges(y.id).length - s.lang.soundChanges(x.id).length)[0];
  if (fam) add(`lan:${fam.id}`, 'A language whose words you can watch change, sound law by sound law.');
  void T;
  return out;
}
