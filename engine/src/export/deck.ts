// Clash of the Ages: a deck of cards drawn from the record (deck.json), and what every coat of arms and personal seal
// is drawn from (pages[].arms and .sigil; the drawing itself is atlas-side, atlas/src/heraldry.ts).
// Every number on a card is a count or a maximum over the record, so each can be checked with one query against
// world.sqlite: reigns from roles, wars from the war events' outcome, battles from the battle events, districts from
// the territory log, extents and populations from the decadal polity survey (decision 0021).
import type { SimResult } from '../sim/run.ts';
import type { Archive } from '../archive/build.ts';
import type { Person, Polity } from '../sim/state.ts';
import type { ArmsSpec, CardKind, DeckJson, Era, SigilSpec } from './contract.ts';
import { ARMS_COLONY, ARMS_HORDE, ARMS_INDUSTRIAL, ARMS_NAVAL, ARMS_REBEL } from './contract.ts';
import { mainGov } from '../archive/naming.ts';
import { TK } from '../sim/tech.ts';

type Card = DeckJson['cards'][number];

export const DECK_KINDS: DeckJson['kinds'] = [
  { id: 'ruler', name: 'Ruler', stats: [
    { key: 'reign', label: 'Reign', unit: 'yrs', how: 'Years on the throne: the last year of the reign minus the first (roles).' },
    { key: 'wars', label: 'Wars won', unit: '', how: 'Wars that ended during the reign, first and last years included, with the realm on the winning side (war events: outcome).' },
    { key: 'gained', label: 'Districts gained', unit: '', how: 'Districts that passed to the realm after the accession year, up to the end of the reign (territory log; each district counted once).' },
    { key: 'battles', label: 'Battles led', unit: '', how: 'Battles in which they were the attacking or defending commander, in their whole life (battle events).' },
  ] },
  { id: 'general', name: 'General', stats: [
    { key: 'battles', label: 'Battles', unit: '', how: 'Battles in which they were the attacking or defending commander (battle events).' },
    { key: 'won', label: 'Victories', unit: '', how: 'Of those battles, the ones their side won (battle events: winner).' },
    { key: 'host', label: 'Largest host', unit: 'men', how: 'The most men their side brought to one of their battles (battle events: attackerSize or defenderSize).' },
    { key: 'enemy', label: 'Enemy losses', unit: 'men', how: 'The other side’s losses in all their battles, added up (battle events: attackerLosses or defenderLosses).' },
  ] },
  { id: 'state', name: 'State', stats: [
    { key: 'districts', label: 'Peak extent', unit: 'districts', how: 'The most districts it held at any decadal survey (polity_years: cells).' },
    { key: 'pop', label: 'Peak population', unit: '', how: 'The most people it ruled at any decadal survey (polity_years: pop).' },
    { key: 'years', label: 'Lifespan', unit: 'yrs', how: 'From its founding to its end, or to AY 5000 if it still stands (polities: born, died).' },
    { key: 'wars', label: 'Wars won', unit: '', how: 'Wars it ended on the winning side, as attacker, defender or ally (war events: outcome).' },
  ] },
  { id: 'city', name: 'City', stats: [
    { key: 'pop', label: 'Peak population', unit: '', how: 'Its largest population on record (settlements: peak_pop).' },
    { key: 'years', label: 'Years standing', unit: 'yrs', how: 'From its founding to its abandonment, or to AY 5000 (settlements: founded, abandoned).' },
    { key: 'capital', label: 'Years a capital', unit: 'yrs', how: 'Years it was the capital of a state, added up over every state that ruled from it (polities: capitals).' },
    { key: 'sieges', label: 'Sieges endured', unit: '', how: 'Sieges and sacks it suffered (siege and sack events).' },
  ] },
  { id: 'faith', name: 'Faith', stats: [
    { key: 'followers', label: 'Peak followers', unit: '', how: 'The most adherents it counted at any decadal survey (movements: peak).' },
    { key: 'years', label: 'Years', unit: 'yrs', how: 'From its founding to its end, or to AY 5000 if it is still followed (movements: born, died).' },
    { key: 'states', label: 'State faith of', unit: 'states', how: 'States whose decadal survey ever names it as their religion (polity_years: religion).' },
    { key: 'conversions', label: 'Conversions', unit: '', how: 'Times a state converted to it (conversion events: adopted).' },
  ] },
];

/** How many cards of each kind: about three hundred in all. */
const TARGET: Record<CardKind, number> = { ruler: 100, general: 80, state: 70, city: 26, faith: 24 };

/** Every coat of arms and seal is read from the record through these lookups, built once per export. */
export class Heraldry {
  private readonly r: SimResult;
  private readonly a: Archive;
  private readonly eraStarts: number[];
  private readonly colonizer = new Set<number>();
  private readonly firstSteam: number;
  private readonly stateArms = new Map<number, ArmsSpec>();

  constructor(r: SimResult, a: Archive, eras: Era[]) {
    this.r = r;
    this.a = a;
    this.eraStarts = eras.map((e) => e.start);
    const s = r.state;
    for (const e of s.events) if (e.sub === 'colonization') for (const [ref, role] of e.parts) if (role === 'colonizer' && ref.startsWith('pol:')) this.colonizer.add(Number(ref.slice(4)));
    let first = Infinity;
    for (const p of s.polities) { const y = p.techs.get(TK.steam); if (y !== undefined && y < first) first = y; }
    this.firstSteam = first;
  }

  eraOf(year: number): number {
    let k = 0;
    for (let i = 0; i < this.eraStarts.length; i++) if (this.eraStarts[i] <= year) k = i;
    return k;
  }

  /** A state's arms: its people's colour, its first recorded faith's metal, its main government's charge, the
   *  shield of the age it was founded in. */
  polity(p: Polity): ArmsSpec {
    let spec = this.stateArms.get(p.id);
    if (spec) return spec;
    const s = this.r.state;
    const stats = this.a.ctx.polityStats.get(p.id) ?? [];
    const firstFaith = stats.map((row) => row[11] as number).find((x) => x >= 0);
    const gov = mainGov(p);
    const steam = p.techs.get(TK.steam);
    const port = s.settlements[p.capitals[0][1]]?.port ?? false;
    const flags = (this.colonizer.has(p.id) || (gov === 'merchant-republic' && port) ? ARMS_NAVAL : 0)
      | (steam !== undefined && (steam - p.born <= 150 || p.born >= this.firstSteam) ? ARMS_INDUSTRIAL : 0)
      | (p.kind === 'colony' || p.govs.some(([, g]) => g === 'colony') ? ARMS_COLONY : 0)
      | (p.kind === 'horde' || gov === 'horde' ? ARMS_HORDE : 0)
      | (p.kind === 'rebel' ? ARMS_REBEL : 0);
    spec = [`pol:${p.id}`, p.culture, firstFaith ?? (p.religion >= 0 ? p.religion : -1), gov, this.eraOf(Math.max(0, p.born)), flags];
    this.stateArms.set(p.id, spec);
    return spec;
  }

  /** A city's arms: its founders' colour, the metal of the faith held where it stood when it was founded. */
  settlement(id: number): ArmsSpec {
    const t = this.r.state.settlements[id];
    const y = Math.max(0, t.founded);
    return [`set:${id}`, t.culture, this.a.ctx.religionAt(t.cell, y), t.port ? 'port' : 'city', this.eraOf(y), t.port ? ARMS_NAVAL : 0];
  }

  /** A faith's seal: its people's colour, its own metal, a charge for its kind. */
  movement(id: number): ArmsSpec {
    const m = this.r.state.movements[id];
    return [`mov:${id}`, m.culture, id, `faith:${m.kind}`, this.eraOf(Math.max(0, m.born)), 0];
  }

  /** A person's seal: their sex, every role they held, their name, the age of their first role, their house, and the
   *  tinctures of the state they served (the polity of their first role with one, else their own). */
  person(p: Person): SigilSpec {
    const s = this.r.state;
    const served = p.roles.find((x) => x.polity !== null)?.polity ?? p.polity;
    const st = served !== null && served !== undefined ? s.polities[served] : null;
    const arms = st ? this.polity(st) : null;
    const prime = p.roles.length ? p.roles[0].start : p.born + 30;
    const roles = [...new Set(p.roles.map((x) => x.role))].join(',');
    return [`per:${p.id}`, p.sex, roles, this.a.T.short.get(`per:${p.id}`) ?? '', this.eraOf(Math.max(0, prime)), p.dynasty ?? -1, arms ? arms[1] : p.culture, arms ? arms[2] : -1, arms ? arms[5] & ARMS_NAVAL : 0];
  }
}

/** Percentile rank of each value among its peers (ties share the midpoint), in [0, 1]. */
function ranks(values: number[]): number[] {
  const sorted = values.slice().sort((x, y) => x - y);
  const lower = (v: number) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; } return lo; };
  const upper = (v: number) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; } return lo; };
  return values.map((v) => (lower(v) + upper(v)) / 2 / Math.max(1, sorted.length));
}

interface Candidate { card: Omit<Card, 'rarity'>; score: number }

/** The best candidates, spread over the ages: each era gets a share by the square root of its candidates, the rest go
 *  to the best left over. Rarity follows the score: the top 6% legendary, the next 14% epic, the next 30% rare. */
function choose(cands: Candidate[], n: number, eras: number): Card[] {
  const byEra = Array.from({ length: eras }, () => [] as Candidate[]);
  for (const c of cands) byEra[c.card.era].push(c);
  for (const g of byEra) g.sort((x, y) => y.score - x.score || x.card.id.localeCompare(y.card.id));
  const root = byEra.map((g) => Math.sqrt(g.length));
  const total = root.reduce((t, x) => t + x, 0) || 1;
  const picked = new Set<Candidate>();
  byEra.forEach((g, e) => { for (const c of g.slice(0, Math.floor((n * 0.8 * root[e]) / total))) picked.add(c); });
  for (const c of cands.slice().sort((x, y) => y.score - x.score || x.card.id.localeCompare(y.card.id))) {
    if (picked.size >= n) break;
    picked.add(c);
  }
  const chosen = [...picked].sort((x, y) => y.score - x.score || x.card.id.localeCompare(y.card.id));
  return chosen.map((c, i) => {
    const q = i / chosen.length;
    return { ...c.card, rarity: (q < 0.06 ? 3 : q < 0.2 ? 2 : q < 0.5 ? 1 : 0) as Card['rarity'] };
  }).sort((x, y) => x.years[0] - y.years[0] || x.id.localeCompare(y.id));
}

export function deckJson(r: SimResult, a: Archive, eras: Era[], H: Heraldry): DeckJson {
  const s = r.state;
  const T = a.T;
  const ctx = a.ctx;
  const simEvents = r.simEvents ?? s.events.length;
  const fame = (id: string) => a.pages.get(id)?.backlinks.length ?? 0;
  const short = (id: string) => T.short.get(id) ?? '';
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const x = m.get(k); if (x) x.push(v); else m.set(k, [v]); };

  // wars won: the year each war ended, for every state on the winning side
  const warWins = new Map<number, number[]>();
  for (let i = 0; i < simEvents; i++) {
    const e = s.events[i];
    if (e.sub !== 'war') continue;
    const o = e.data.outcome;
    if (o !== 'attacker' && o !== 'defender') continue;
    for (const [ref, role] of e.parts) {
      if (!ref.startsWith('pol:')) continue;
      const side = role === 'attacker' ? 'attacker' : role === 'defender' || role === 'ally' ? 'defender' : null;
      if (side === o) push(warWins, Number(ref.slice(4)), e.end);
    }
  }
  // battles by commander
  interface Fought { year: number; won: boolean; host: number; enemy: number; polity: number }
  const fought = new Map<number, Fought[]>();
  const sieges = new Map<number, number>();
  for (let i = 0; i < simEvents; i++) {
    const e = s.events[i];
    if (e.sub === 'siege' || e.sub === 'sack') {
      for (const [ref, role] of e.parts) if (role === 'settlement' && ref.startsWith('set:')) sieges.set(Number(ref.slice(4)), (sieges.get(Number(ref.slice(4))) ?? 0) + 1);
      continue;
    }
    if (e.sub !== 'battle') continue;
    let att = -1, def = -1, cA = -1, cD = -1;
    for (const [ref, role] of e.parts) {
      if (role === 'attacker') att = Number(ref.slice(4));
      else if (role === 'defender') def = Number(ref.slice(4));
      else if (role === 'attacking commander') cA = Number(ref.slice(4));
      else if (role === 'defending commander') cD = Number(ref.slice(4));
    }
    const d = e.data as { attackerSize: number; defenderSize: number; attackerLosses: number; defenderLosses: number; winner: number };
    if (cA >= 0) push(fought, cA, { year: e.year, won: d.winner === att, host: d.attackerSize, enemy: d.defenderLosses, polity: att });
    if (cD >= 0) push(fought, cD, { year: e.year, won: d.winner === def, host: d.defenderSize, enemy: d.attackerLosses, polity: def });
  }
  // districts passing to each state, in year order (the log is appended in year order)
  const gains = new Map<number, { years: number[]; cells: number[] }>();
  const log = s.territoryLog;
  for (let i = 0; i < log.length; i += 4) {
    const owner = log[i + 2];
    if (owner < 0) continue;
    let g = gains.get(owner);
    if (!g) gains.set(owner, (g = { years: [], cells: [] }));
    g.years.push(log[i]);
    g.cells.push(log[i + 1]);
  }
  const gainedIn = (pid: number, after: number, upTo: number) => {
    const g = gains.get(pid);
    if (!g) return 0;
    let lo = 0, hi = g.years.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (g.years[m] <= after) lo = m + 1; else hi = m; }
    const seen = new Set<number>();
    for (let k = lo; k < g.years.length && g.years[k] <= upTo; k++) seen.add(g.cells[k]);
    return seen.size;
  };
  const winsIn = (pid: number, from: number, to: number) => (warWins.get(pid) ?? []).filter((y) => y >= from && y <= to).length;

  const cands: Record<CardKind, Candidate[]> = { ruler: [], general: [], state: [], city: [], faith: [] };
  const score = (list: Omit<Card, 'rarity'>[]): Candidate[] => {
    if (!list.length) return [];
    const k = list[0].stats.length;
    const cols = Array.from({ length: k }, (_, j) => ranks(list.map((c) => c.stats[j])));
    const fm = ranks(list.map((c) => fame(c.id)));
    return list.map((card, i) => ({ card, score: cols.reduce((t, col) => t + col[i], 0) / k + 0.5 * fm[i] }));
  };

  // rulers: each person's longest reign as ruler, president or chairman
  const best = new Map<number, { pid: number; start: number; end: number; role: string }>();
  for (const [pid, rs] of ctx.reigns) for (const x of rs) {
    const b = best.get(x.person);
    if (!b || x.end - x.start > b.end - b.start) best.set(x.person, { pid, start: x.start, end: x.end, role: x.role });
  }
  const rulers: Omit<Card, 'rarity'>[] = [];
  for (const [person, x] of best) {
    const id = `per:${person}`;
    if (!a.pages.has(id) || x.end - x.start < 3) continue;
    const p = s.persons[person];
    const stats = [x.end - x.start, winsIn(x.pid, x.start, x.end), gainedIn(x.pid, x.start, x.end), fought.get(person)?.length ?? 0];
    if (stats[1] + stats[2] + stats[3] === 0) continue;
    const title = x.role === 'ruler' ? 'Ruler' : x.role === 'president' ? 'President' : 'Chairman';
    rulers.push({ id, kind: 'ruler', name: a.pages.get(id)!.title, role: `${title} of ${short(`pol:${x.pid}`)}`, years: [x.start, x.end], era: H.eraOf(Math.max(0, x.start)), stats, arms: H.polity(s.polities[x.pid]), sigil: H.person(p) });
  }
  cands.ruler = score(rulers);

  // generals: commanders who never ruled, with three battles or more
  const generals: Omit<Card, 'rarity'>[] = [];
  for (const [person, fs] of fought) {
    const id = `per:${person}`;
    const p = s.persons[person];
    if (fs.length < 3 || !a.pages.has(id) || best.has(person) || !p.roles.some((x) => x.role === 'general')) continue;
    const served = p.roles.find((x) => x.role === 'general' && x.polity !== null)?.polity ?? fs[0].polity;
    const years = fs.map((f) => f.year);
    generals.push({
      id, kind: 'general', name: a.pages.get(id)!.title, role: `General of ${short(`pol:${served}`)}`, years: [Math.min(...years), Math.max(...years)], era: H.eraOf(Math.max(0, Math.min(...years))),
      stats: [fs.length, fs.filter((f) => f.won).length, Math.max(...fs.map((f) => f.host)), fs.reduce((t, f) => t + f.enemy, 0)],
      arms: H.polity(s.polities[served]), sigil: H.person(p),
    });
  }
  cands.general = score(generals);

  // states: every state with a recorded extent that lasted twenty years or more
  const states: Omit<Card, 'rarity'>[] = [];
  for (const p of s.polities) {
    const id = `pol:${p.id}`;
    const stats = ctx.polityStats.get(p.id) ?? [];
    const peakCells = Math.max(0, ...stats.map((row) => row[2] as number));
    const peakPop = Math.max(0, ...stats.map((row) => row[3] as number));
    const life = (p.died ?? 5000) - p.born;
    if (!a.pages.has(id) || peakCells <= 0 || life < 20) continue;
    states.push({ id, kind: 'state', name: a.pages.get(id)!.title, role: `${short(`cul:${p.culture}`)} people · capital ${short(`set:${p.capitals[0][1]}`)}`, years: [p.born, p.died ?? 5000], era: H.eraOf(Math.max(0, p.born)), stats: [peakCells, peakPop, life, warWins.get(p.id)?.length ?? 0], arms: H.polity(p) });
  }
  cands.state = score(states);

  // cities
  const capitalYears = new Map<number, number>();
  for (const p of s.polities) p.capitals.forEach(([y, c], i) => { const next = i + 1 < p.capitals.length ? p.capitals[i + 1][0] : p.died ?? 5000; capitalYears.set(c, (capitalYears.get(c) ?? 0) + Math.max(0, next - y)); });
  const cities: Omit<Card, 'rarity'>[] = [];
  for (const t of s.settlements) {
    const id = `set:${t.id}`;
    if (!a.pages.has(id) || t.peakPop <= 0) continue;
    cities.push({ id, kind: 'city', name: a.pages.get(id)!.title, role: `${t.port ? 'Port' : 'City'} in ${short(`reg:${s.world.region[t.cell]}`)}`, years: [t.founded, t.abandoned ?? 5000], era: H.eraOf(Math.max(0, t.founded)), stats: [Math.round(t.peakPop), (t.abandoned ?? 5000) - t.founded, capitalYears.get(t.id) ?? 0, sieges.get(t.id) ?? 0], arms: H.settlement(t.id) });
  }
  cands.city = score(cities);

  // faiths
  const stateFaith = new Map<number, Set<number>>();
  for (const row of s.polityYears) { const m = row[11] as number; if (m >= 0) { let x = stateFaith.get(m); if (!x) stateFaith.set(m, (x = new Set())); x.add(row[0] as number); } }
  const conversions = new Map<number, number>();
  for (let i = 0; i < simEvents; i++) {
    const e = s.events[i];
    if (e.sub === 'conversion') for (const [ref, role] of e.parts) if (role === 'adopted' && ref.startsWith('mov:')) conversions.set(Number(ref.slice(4)), (conversions.get(Number(ref.slice(4))) ?? 0) + 1);
  }
  const faiths: Omit<Card, 'rarity'>[] = [];
  for (const m of s.movements) {
    const id = `mov:${m.id}`;
    if (!a.pages.has(id) || m.peak <= 0) continue;
    const kind = m.kind === 'pantheon' ? `Pantheon of the ${short(`cul:${m.culture}`)}` : m.founder !== null ? `${m.kind[0].toUpperCase()}${m.kind.slice(1)} founded by ${short(`per:${m.founder}`)}` : `${m.kind[0].toUpperCase()}${m.kind.slice(1)} of the ${short(`cul:${m.culture}`)}`;
    faiths.push({ id, kind: 'faith', name: a.pages.get(id)!.title, role: kind, years: [m.born, m.died ?? 5000], era: H.eraOf(Math.max(0, m.born)), stats: [Math.round(m.peak), (m.died ?? 5000) - m.born, stateFaith.get(m.id)?.size ?? 0, conversions.get(m.id) ?? 0], arms: H.movement(m.id) });
  }
  cands.faith = score(faiths);

  const cards: Card[] = [];
  for (const k of DECK_KINDS) cards.push(...choose(cands[k.id], TARGET[k.id], eras.length));
  return { kinds: DECK_KINDS, cards };
}
