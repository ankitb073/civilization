// river.json for the River of Time (#/river): a stream per great state (the Histomap's and every state that ever held
// 2.5% of the world's people) with its share of the people, its districts and its soldiers from the decade surveys, its
// arms, and the great events that stand as stones along the bank. Read straight from the record; small.
import type { SimResult } from '../sim/run.ts';
import type { Archive } from '../archive/build.ts';
import type { Era, HistomapJson, RiverJson } from './contract.ts';
import type { Heraldry } from './deck.ts';

type Stone = RiverJson['stones'][number];

const num = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** States that ever held this share of the world's people get a stream of their own, whatever their era. */
const MIN_PEAK = 0.025;

export function riverJson(r: SimResult, a: Archive, H: Heraldry, hm: HistomapJson, eras: Era[]): RiverJson {
  const s = r.state;
  const years = hm.years;
  const n = years.length;
  const at = new Map(years.map((y, i) => [y, i]));
  const pop = new Map<number, Float64Array>(), cells = new Map<number, Float64Array>(), army = new Map<number, Float64Array>();
  const worldPop = new Float64Array(n), worldArmy = new Float64Array(n);
  const get = (m: Map<number, Float64Array>, pid: number) => { let x = m.get(pid); if (!x) m.set(pid, (x = new Float64Array(n))); return x; };
  for (const row of s.polityYears) {
    const i = at.get(row[1] as number);
    if (i === undefined) continue;
    const pid = row[0] as number;
    get(pop, pid)[i] = row[3] as number;
    get(cells, pid)[i] = row[2] as number;
    get(army, pid)[i] = row[6] as number;
    worldPop[i] += row[3] as number;
    worldArmy[i] += row[6] as number;
  }
  // the Histomap's streams, and every state that was ever a great share of the world
  const kept = new Set(hm.series.filter((x) => x.id.startsWith('pol:')).map((x) => Number(x.id.slice(4))));
  for (const [pid, p] of pop) {
    let peak = 0;
    for (let i = 0; i < n; i++) if (worldPop[i] > 0) peak = Math.max(peak, p[i] / worldPop[i]);
    if (peak >= MIN_PEAK) kept.add(pid);
  }
  const oPop = new Float64Array(n), oCells = new Float64Array(n), oArmy = new Float64Array(n);
  for (const [pid, p] of pop) {
    if (kept.has(pid)) continue;
    const c = cells.get(pid)!, sol = army.get(pid)!;
    for (let i = 0; i < n; i++) { oPop[i] += p[i]; oCells[i] += c[i]; oArmy[i] += sol[i]; }
  }
  const share = (v: number, i: number) => (worldPop[i] > 0 ? Math.round((v / worldPop[i]) * 10000) / 10000 : 0);
  const trimmed = (p: Float64Array, c: Float64Array, sol: Float64Array) => {
    let i0 = -1, i1 = -1;
    for (let i = 0; i < n; i++) if (p[i] > 0 || c[i] > 0 || sol[i] > 0) { if (i0 < 0) i0 = i; i1 = i; }
    if (i0 < 0) return { i0: 0, share: [] as number[], cells: [] as number[], army: [] as number[] };
    const idx = Array.from({ length: i1 - i0 + 1 }, (_, j) => i0 + j);
    return { i0, share: idx.map((i) => share(p[i], i)), cells: idx.map((i) => Math.round(c[i])), army: idx.map((i) => Math.round(sol[i])) };
  };
  const series: RiverJson['series'] = [];
  for (const pid of kept) {
    const p = s.polities[pid];
    const cap = s.settlements[p.capitals[0][1]].cell;
    series.push({
      id: `pol:${pid}`, name: a.T.short.get(`pol:${pid}`) ?? '', color: p.color, order: s.world.x[cap], start: p.born, end: p.died ?? 5000,
      ...trimmed(pop.get(pid)!, cells.get(pid)!, army.get(pid)!), arms: H.polity(p),
    });
  }
  series.sort((x, y) => x.order - y.order || x.start - y.start);
  series.forEach((x, i) => { x.order = i; });
  series.push({ id: 'other', name: 'Lesser states', color: '#b8ab92', order: series.length, start: 0, end: 5000, ...trimmed(oPop, oCells, oArmy) });
  let land = 0;
  for (let i = 0; i < s.world.n; i++) if (s.world.land[i]) land++;
  return { years, land, pop: Array.from(worldPop, Math.round), army: Array.from(worldArmy, Math.round), series, stones: stones(r, a, eras) };
}

/** The great events: the deadliest war of every five centuries and the three deadliest of all, the worst plagues,
 *  the great (VEI 7) eruptions, first contact, the invention of writing, the great trade collapse, the worst famines. */
function stones(r: SimResult, a: Archive, eras: Era[]): Stone[] {
  const s = r.state;
  const out: Stone[] = [];
  const seen = new Set<string>();
  const title = (id: string) => (a.T.short.get(id) ?? a.pages.get(id)?.title ?? id).replace(/\s*\(AY \d+\)\s*$/, '');
  const add = (id: string, year: number, kind: Stone['kind'], figure: string, mag: number) => {
    if (seen.has(id) || !a.pages.has(id)) return;
    seen.add(id);
    out.push({ id, year, kind, title: title(id), figure, mag: Math.round(Math.max(0, Math.min(1, mag)) * 100) / 100 });
  };
  // wars by the dead on both sides
  const wars = s.events.filter((e) => e.sub === 'war').map((e) => ({ e, dead: num(e.data.lossesA) + num(e.data.lossesD) })).filter((w) => w.dead > 0);
  const maxWar = Math.max(1, ...wars.map((w) => w.dead));
  const warMag = (d: number) => Math.log10(1 + d) / Math.log10(1 + maxWar);
  const byDead = wars.slice().sort((x, y) => y.dead - x.dead || x.e.id - y.e.id);
  for (const w of byDead.slice(0, 3)) add(`evt:${w.e.id}`, w.e.year, 'war', `${fmt(w.dead)} fell`, warMag(w.dead));
  for (let y0 = 0; y0 < 5000; y0 += 500) {
    const w = byDead.find((x) => x.e.year >= y0 && x.e.year < y0 + 500);
    if (w) add(`evt:${w.e.id}`, w.e.year, 'war', `${fmt(w.dead)} fell`, warMag(w.dead));
  }
  // plagues by deaths: the three worst, and the worst of every era
  const plagues = s.events.filter((e) => e.sub === 'plague').map((e) => ({ e, dead: num(e.data.deaths) })).sort((x, y) => y.dead - x.dead || x.e.id - y.e.id);
  const maxPl = Math.max(1, ...plagues.map((p) => p.dead));
  const plMag = (d: number) => Math.log10(1 + d) / Math.log10(1 + maxPl);
  for (const p of plagues.slice(0, 3)) add(`evt:${p.e.id}`, p.e.year, 'plague', `${fmt(p.dead)} dead`, plMag(p.dead));
  for (const er of eras) {
    const p = plagues.find((x) => x.e.year >= er.start && x.e.year < er.end && x.dead >= 100000);
    if (p) add(`evt:${p.e.id}`, p.e.year, 'plague', `${fmt(p.dead)} dead`, plMag(p.dead));
  }
  // the great eruptions (volcanic winters)
  for (const an of s.anomalies.filter((x) => x.kind === 'eruption' && x.severity >= 7).sort((x, y) => x.start - y.start)) {
    const id = a.pages.has(`cli:${an.id}`) ? `cli:${an.id}` : `evt:${an.event}`;
    add(id, an.start, 'eruption', `VEI ${Math.round(an.severity)}`, (an.severity - 5) / 2);
  }
  const fc = s.events.find((e) => e.sub === 'first-contact' && e.data.continents) ?? s.events.find((e) => e.sub === 'first-contact');
  if (fc) add(`evt:${fc.id}`, fc.year, 'contact', 'two worlds meet', 1);
  const wr = s.events.find((e) => e.sub === 'script-invention');
  if (wr) add(`evt:${wr.id}`, wr.year, 'writing', 'the first script', 0.7);
  const tc = s.events.find((e) => e.sub === 'trade-collapse');
  if (tc) add(`evt:${tc.id}`, tc.year, 'trade', `trade falls ${Math.round(num(tc.data.drop) * 100)}%`, 0.8);
  const famines = s.events.filter((e) => e.sub === 'famine').map((e) => ({ e, dead: num(e.data.deaths) })).sort((x, y) => y.dead - x.dead || x.e.id - y.e.id);
  const maxFam = Math.max(1, ...famines.map((f) => f.dead));
  for (const f of famines.slice(0, 2)) add(`evt:${f.e.id}`, f.e.year, 'famine', `${fmt(f.dead)} dead`, Math.log10(1 + f.dead) / Math.log10(1 + maxFam));
  return out.sort((x, y) => x.year - y.year || x.id.localeCompare(y.id));
}
