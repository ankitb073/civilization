// Simulation state: every entity, the cell grids, the event ledger and the change logs.
import type { World } from '../world/generate.ts';
import type { LanguageEngine, LangId, NameId, ScriptKind } from '../lang/index.ts';
import { Rng } from '../core/rng.ts';

export type Ref = string; // "pol:3"

export type GovType =
  | 'chiefdom' | 'city-state' | 'kingdom' | 'empire' | 'theocracy' | 'merchant-republic'
  | 'feudal-kingdom' | 'horde' | 'absolute-monarchy' | 'constitutional-monarchy' | 'republic'
  | 'federation' | 'one-party-state' | 'democracy' | 'colony';

export interface SimEvent {
  id: number;
  sub: string;
  year: number;
  end: number;
  cell: number;
  parts: [Ref, string][];
  causes: number[];
  data: Record<string, unknown>;
  sig: number;
}

export interface Polity {
  id: number;
  nameId: NameId;
  nameBasis: 'city' | 'people' | 'region' | 'dynasty';
  culture: number;
  born: number;
  died: number | null;
  foundEvent: number;
  endEvent: number | null;
  capital: number; // settlement id
  capitals: [number, number][]; // [year, settlement]
  gov: GovType;
  govs: [number, GovType][];
  ruler: number | null;
  dynasty: number | null;
  religion: number; // movement id (-1 none)
  currency: number; // currency id (-1 none)
  treasury: number; // silver kg
  debt: number;
  stability: number;
  army: number;
  techs: Map<number, number>; // tech id -> year acquired
  overlord: number | null;
  tributes: { to: number; amount: number; until: number; event: number }[];
  color: string;
  predecessor: number | null;
  successors: number[];
  kind: 'state' | 'horde' | 'rebel' | 'colony';
  landmassHome: number;
  generals: number[];
  // decadal aggregates
  cells: number;
  pop: number;
  urbanPop: number;
  warWeariness: number;
  lastWarEnd: number;
  crisis: number; // recent stress score, decays
  stress: { year: number; event: number; weight: number }[]; // recent stressor events
  successionLaw: 'primogeniture' | 'male-primogeniture' | 'seniority' | 'elective';
}

export interface Person {
  id: number;
  nameId: NameId;
  sex: 'm' | 'f';
  born: number;
  died: number; // natural death year (may be overridden earlier by violence)
  deathCause: string;
  deathEvent: number | null;
  culture: number;
  polity: number | null;
  father: number | null;
  mother: number | null;
  spouses: number[];
  children: number[];
  dynasty: number | null;
  skill: number; // generals, merchants, scholars
  roles: Role[];
  epithet: string | null;
  childrenGenerated: boolean;
}

export type RoleKind =
  | 'ruler' | 'regent' | 'heir' | 'general' | 'merchant' | 'founder' | 'prophet' | 'philosopher'
  | 'inventor' | 'rebel' | 'usurper' | 'governor' | 'consort' | 'envoy' | 'scribe' | 'historian'
  | 'priest' | 'explorer' | 'translator' | 'archaeologist' | 'president' | 'chairman';

export interface Role {
  role: RoleKind;
  polity: number | null;
  start: number;
  end: number | null;
  event: number | null;
  ref?: Ref;
}

export interface Dynasty {
  id: number;
  nameId: NameId;
  founder: number;
  polity: number;
  start: number;
  end: number | null;
}

export interface Settlement {
  id: number;
  nameId: NameId;
  names: [number, NameId][]; // renames
  cell: number;
  founded: number;
  abandoned: number | null;
  foundEvent: number;
  endEvent: number | null;
  culture: number;
  pop: number;
  peakPop: number;
  popHistory: [number, number][]; // per century
  sacks: number[]; // event ids
  port: boolean;
}

export interface Culture {
  id: number;
  nameId: NameId; // ethnonym
  lang: LangId;
  parent: number | null;
  born: number;
  died: number | null;
  homeCell: number;
  color: string;
  pantheon: number; // movement id
  script: number; // script id, -1 = illiterate
  pastoral: boolean;
  divergence: number;
  bornEvent: number | null;
}

export interface Script {
  id: number;
  nameId: NameId;
  kind: ScriptKind;
  parent: number | null;
  originLang: LangId;
  culture: number;
  born: number;
  event: number;
}

export interface Movement {
  id: number;
  nameId: NameId;
  kind: 'pantheon' | 'cult' | 'religion' | 'philosophy' | 'sect' | 'reform' | 'ideology';
  parent: number | null;
  culture: number;
  founder: number | null;
  born: number;
  died: number | null;
  tenets: number[]; // 6 axes in [-1, 1]
  originCell: number;
  foundEvent: number | null;
  deities: number[];
  adherents: number; // decadal aggregate (people)
  cells: number;
  peak: number;
}

export interface Deity {
  id: number;
  nameId: NameId;
  culture: number;
  movement: number;
  domain: string; // concept, e.g. 'sky', 'storm'
  sex: 'm' | 'f';
  born: number;
}

export interface Currency {
  id: number;
  nameId: NameId;
  polity: number;
  kind: 'weight' | 'coin' | 'paper' | 'fiat';
  metal: 'silver' | 'gold' | 'bronze' | 'none';
  born: number;
  died: number | null;
  content: number; // grams of silver equivalent per unit
  history: [number, number][]; // [year, content]
  event: number;
}

export interface House {
  id: number;
  nameId: NameId;
  founder: number;
  heads: [number, number][]; // [year, person]
  settlement: number;
  born: number;
  died: number | null;
  foundEvent: number;
  endEvent: number | null;
  goods: number[];
  capital: number; // silver kg
  partners: number[]; // settlements
  loans: { polity: number; amount: number; year: number }[];
  kind: 'house' | 'company' | 'bank' | 'corporation';
}

export interface ClimateAnomaly {
  id: number;
  kind: 'eruption' | 'drought' | 'cold' | 'pluvial' | 'warming';
  start: number;
  end: number;
  cells: number[];
  severity: number;
  volcanoCell: number;
  nameId: NameId | null;
  event: number;
}

export interface War {
  event: number;
  attackers: number[];
  defenders: number[];
  goal: 'conquest' | 'tribute' | 'succession' | 'holy' | 'trade' | 'independence' | 'civil' | 'invasion' | 'colonial' | 'unification';
  targetRegion: number;
  start: number;
  score: number; // + favours attackers
  battles: number[];
  occupied: Set<number>;
  exhaustA: number;
  exhaustD: number;
  lossesA: number;
  lossesD: number;
  commanderA: number | null;
  commanderD: number | null;
  ended: number | null;
}

export interface Relation {
  opinion: number;
  alliance: number | null; // treaty event id
  truceUntil: number;
  tradePact: number | null;
  embargo: number | null;
  wars: number[];
  marriages: number[];
}

export interface Tech {
  id: number;
  key: string;
  name: string;
  target: number;
  prereqs: number[];
  era: number;
}

export interface State {
  seed: number;
  world: World;
  lang: LanguageEngine;
  rng: Rng;
  year: number;
  // cell grids
  owner: Int32Array;
  culture: Int32Array;
  religion: Int32Array;
  pop: Float32Array;
  cap: Float32Array; // capacity under current tech and climate
  yieldF: Float32Array; // climate yield factor
  devast: Float32Array; // war devastation, decays
  settlementAt: Int32Array;
  // entities
  polities: Polity[];
  persons: Person[];
  dynasties: Dynasty[];
  settlements: Settlement[];
  cultures: Culture[];
  scripts: Script[];
  movements: Movement[];
  deities: Deity[];
  currencies: Currency[];
  houses: House[];
  anomalies: ClimateAnomaly[];
  events: SimEvent[];
  wars: War[];
  relations: Map<number, Relation>;
  regionNames: NameId[];
  riverNames: NameId[];
  // logs: flat [year, cell, value, event]
  territoryLog: number[];
  cultureLog: number[];
  religionLog: number[];
  lastLogYear: { territory: number; culture: number; religion: number };
  // climate
  climate: { year: number; temp: number; precip: number }[];
  modeAmp: number[];
  modeField: Float32Array[]; // per mode, per cell
  tempAnom: number;
  fossil: number; // cumulative fossil fuel use
  // economy (filled by economy.ts)
  prices: { year: number; settlement: number; good: number; price: number }[];
  routes: { year: number; edges: [number, number, number][] }[];
  activeRoutes: [number, number, number][];
  silverStock: number;
  // decadal polity stats rows
  polityYears: (number | string | null)[][];
  // flush cursors for incremental DB writes
  flushed: Record<string, number>;
}

export function ref(prefix: string, id: number): Ref {
  return `${prefix}:${id}`;
}

export function relKey(a: number, b: number): number {
  return a < b ? a * 65536 + b : b * 65536 + a;
}

export function rel(s: State, a: number, b: number): Relation {
  const k = relKey(a, b);
  let r = s.relations.get(k);
  if (!r) {
    r = { opinion: 0, alliance: null, truceUntil: -1, tradePact: null, embargo: null, wars: [], marriages: [] };
    s.relations.set(k, r);
  }
  return r;
}

/** Create an event. Causes must not be later than the event. */
export function event(
  s: State,
  sub: string,
  year: number,
  opts: { cell?: number; parts?: [Ref, string][]; causes?: number[]; data?: Record<string, unknown>; end?: number; sig?: number } = {},
): SimEvent {
  const causes = [...new Set((opts.causes ?? []).filter((c) => c != null && c >= 0))];
  for (const c of causes) {
    const ce = s.events[c];
    if (!ce) throw new Error(`event ${sub}@${year}: unknown cause ${c}`);
    if (ce.year > year) throw new Error(`event ${sub}@${year}: cause ${ce.sub}#${c}@${ce.year} is later`);
  }
  const e: SimEvent = {
    id: s.events.length,
    sub,
    year,
    end: opts.end ?? year,
    cell: opts.cell ?? -1,
    parts: opts.parts ?? [],
    causes,
    data: opts.data ?? {},
    sig: opts.sig ?? 0.2,
  };
  s.events.push(e);
  return e;
}

/** A year in [lo, hi] that is not earlier than any cause. */
export function yearAfter(s: State, rng: Rng, lo: number, hi: number, causes: (number | null | undefined)[]): number {
  let min = lo;
  for (const c of causes) if (c != null && c >= 0) min = Math.max(min, s.events[c].year);
  if (min >= hi) return min;
  return rng.int(min, hi);
}

export function setOwner(s: State, cell: number, owner: number, year: number, ev: number): void {
  if (s.owner[cell] === owner) return;
  if (year < s.lastLogYear.territory) throw new Error(`territory log out of order: ${year} < ${s.lastLogYear.territory}`);
  s.lastLogYear.territory = year;
  s.owner[cell] = owner;
  s.territoryLog.push(year, cell, owner, ev);
}

export function setCulture(s: State, cell: number, culture: number, year: number, ev: number): void {
  if (s.culture[cell] === culture) return;
  if (year < s.lastLogYear.culture) throw new Error(`culture log out of order: ${year} < ${s.lastLogYear.culture}`);
  s.lastLogYear.culture = year;
  s.culture[cell] = culture;
  s.cultureLog.push(year, cell, culture, ev);
}

export function setReligion(s: State, cell: number, movement: number, year: number, ev: number): void {
  if (s.religion[cell] === movement) return;
  if (year < s.lastLogYear.religion) throw new Error(`religion log out of order: ${year} < ${s.lastLogYear.religion}`);
  s.lastLogYear.religion = year;
  s.religion[cell] = movement;
  s.religionLog.push(year, cell, movement, ev);
}

export function alivePolity(p: Polity | undefined, year: number): p is Polity {
  return !!p && p.born <= year && (p.died === null || p.died > year);
}

export function personAlive(p: Person, year: number): boolean {
  return p.born <= year && p.died > year;
}

export function age(p: Person, year: number): number {
  return year - p.born;
}

export function langOfCulture(s: State, culture: number): LangId {
  return s.cultures[culture].lang;
}

export function addStress(p: Polity, year: number, ev: number, weight: number): void {
  p.stress.push({ year, event: ev, weight });
  if (p.stress.length > 40) p.stress.splice(0, p.stress.length - 40);
}

/** Top stressor events in the last `window` years (for causal attribution). */
export function topStress(p: Polity, year: number, window = 60, k = 4): number[] {
  return p.stress
    .filter((x) => x.year > year - window && x.year <= year)
    .sort((a, b) => b.weight - a.weight || b.year - a.year)
    .slice(0, k)
    .map((x) => x.event);
}

export const PALETTE = [
  '#b5523b', '#3f6e8c', '#c08a2e', '#5d7d3a', '#8c4f7a', '#2f7f74', '#a8643a', '#6b5ea8',
  '#9c3f4f', '#4b7f4f', '#c56f50', '#4a6a9e', '#8a7a2e', '#7a4f3a', '#3e8a9a', '#a04f8f',
  '#6f8f3a', '#b07a5a', '#55607a', '#9a5a2a', '#2e6a5a', '#b5455f', '#7f6a4a', '#5a8ab0',
];
