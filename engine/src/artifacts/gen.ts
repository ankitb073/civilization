// Artifact framework: the Artifact record, author pools, modern scholars, survival and provenance.
import type { Ctx } from '../archive/context.ts';
import type { Titles } from '../archive/naming.ts';
import { eventTitle } from '../archive/naming.ts';
import { Doc } from '../archive/doc.ts';
import type { LangId } from '../lang/index.ts';
import type { InterlinearText } from '../export/contract.ts';
import type { Polity, Person } from '../sim/state.ts';
import { event, ref } from '../sim/state.ts';
import { newPerson } from '../sim/people.ts';
import { Rng } from '../core/rng.ts';
import { GOODS } from '../sim/economy.ts';
import { TK } from '../sim/tech.ts';
import { existsSync, readFileSync } from 'node:fs';

/** Catalogue numbers frozen for flagships (flagships/catalog.json). Generated documents skip them, so a
 *  generator that emits more documents of a kind never takes a number a flagship already holds. */
function reservedNumbers(): Set<string> {
  const path = new URL('../../../flagships/catalog.json', import.meta.url);
  return existsSync(path) ? new Set(Object.values(JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>)) : new Set();
}

/** Did polity `p` know technology `key` (a TECHS key such as 'chariot', 'printing') by `year`? */
export function techAt(p: Polity | null | undefined, key: string, year: number): boolean {
  if (!p) return false;
  const y = p.techs.get(TK[key]);
  return y !== undefined && y <= year;
}

/** Writing materials a state could not yet make: a printed medium before movable type, paper before paper-making.
 *  Only the label changes; durability and the survival draw stay as they were, so the archive keeps its documents. */
const UNPRINTED: Record<string, string> = {
  'printed book': 'paper codex', 'printed broadsheet': 'manuscript register', 'printed sheet': 'paper', 'printed gazette': 'manuscript newsletter',
};
export function periodMedium(p: Polity | null | undefined, medium: string, year: number): string {
  if (!p) return medium;
  let m = medium;
  if (/^printed /.test(m) && !techAt(p, 'printing', year)) m = UNPRINTED[m] ?? m.replace(/^printed /, 'manuscript ');
  if (/\bpaper\b/.test(m) && !techAt(p, 'paper', year)) m = m.replace(/\bpaper\b/, 'parchment');
  return m;
}

export interface Artifact {
  id: number;
  sub: string;
  year: number;
  title: string;
  catalog: string;
  author: number | null;
  polity: number | null;
  lang: LangId;
  script: number; // -1 for print/electronic or unknown
  medium: string;
  cell: number;
  settlement: number | null;
  about: number[]; // event ids
  body: string;
  mentions: Set<string>;
  dateText: string;
  interlinear?: InterlinearText;
  ledger?: { columns: string[]; rows: string[][]; notes: string[] };
  rival?: { eventId: number; side: string; claims: [string, string][] };
  condition: string;
  provenance: string;
  translator: number | null;
  foundYear: number | null;
  flagship: boolean;
  durable: number; // survival durability 0..1
  tau: number; // decay constant in years
  seat: number | null; // settlement where it was kept
  status: 'extant' | 'lost';
  data?: Record<string, unknown>;
  /** Where the surviving object was found or kept (set by the survival pass). */
  foundAt?: number | null;
  foundHow?: 'excavated' | 'in situ' | 'library' | 'chance';
}

export const CATALOG_CODE: Record<string, string> = {
  treaty: 'TR', chronicle: 'CH', inscription: 'IN', ledger: 'LE', letter: 'LT', decree: 'DE', annals: 'AN',
  census: 'CE', scripture: 'SC', treatise: 'PH', record: 'RE', coin: 'NU', travelogue: 'TV', newspaper: 'NP',
  telegram: 'TG', debate: 'PD', market: 'MR', yearbook: 'YB', excavation: 'EX', paper: 'SP', pamphlet: 'PM', patent: 'PT', poem: 'PO', diary: 'DI',
  lawsuit: 'LS', will: 'WL', muster: 'MU', manifest: 'SM', glossary: 'GL', exercise: 'SX', almanac: 'AL', graffito: 'GR',
  omen: 'OM', periplus: 'PP', tariff: 'TF', story: 'ST',
};

export class Gen {
  readonly ctx: Ctx;
  readonly T: Titles;
  readonly rng: Rng;
  artifacts: Artifact[] = [];
  counters = new Map<string, number>();
  private reserved = reservedNumbers();
  private scribes = new Map<string, number[]>(); // `${polity}:${role}` -> persons
  scholars: number[] = [];
  priceIndex = new Map<string, number>();
  editorialCulture = 0;

  constructor(ctx: Ctx, T: Titles) {
    this.ctx = ctx;
    this.T = T;
    this.rng = ctx.rng.fork('artifacts');
    const pb = ctx.r.econ.priceBuf;
    for (let i = 0; i < pb.length; i += 4) this.priceIndex.set(`${pb[i + 1]}:${pb[i + 2]}:${pb[i]}`, pb[i + 3]);
    this.editorialCulture = ctx.s.polities[ctx.editorialPolity].culture;
    this.makeScholars();
  }

  doc(lang: LangId, year: number, key: string): Doc {
    return new Doc(this.ctx, this.T, lang, year, this.rng.fork('doc', key));
  }

  /** Price in grams of silver for a good at a market at a year (nearest earlier decade). */
  price(settlement: number, good: number, year: number): number | null {
    for (let y = Math.floor(year / 10) * 10; y >= year - 60; y -= 10) {
      const p = this.priceIndex.get(`${settlement}:${good}:${y}`);
      if (p !== undefined) return p;
    }
    return null;
  }

  add(a: Omit<Artifact, 'id' | 'catalog' | 'condition' | 'provenance' | 'translator' | 'foundYear' | 'status'>): Artifact {
    const code = CATALOG_CODE[a.sub] ?? 'MS';
    let n = (this.counters.get(code) ?? 0) + 1;
    while (!a.flagship && this.reserved.has(`PAL·${code}·${String(n).padStart(5, '0')}`)) n++;
    this.counters.set(code, n);
    const art: Artifact = {
      ...a, medium: a.flagship ? a.medium : periodMedium(a.polity !== null ? this.ctx.s.polities[a.polity] : null, a.medium, a.year),
      id: this.artifacts.length, catalog: `PAL·${code}·${String(n).padStart(5, '0')}`,
      condition: 'complete', provenance: '', translator: null, foundYear: null, status: 'extant',
    };
    this.artifacts.push(art);
    return art;
  }

  /** A court scribe, historian, priest etc. of a polity alive at `year` (created on demand). */
  author(p: Polity, role: 'scribe' | 'historian' | 'priest' | 'envoy', year: number, culture?: number): Person {
    const s = this.ctx.s;
    const key = `${p.id}:${role}`;
    const pool = this.scribes.get(key) ?? [];
    for (const id of pool) {
      const x = s.persons[id];
      if (x.born + 20 <= year && x.died > year) return x;
    }
    const rng = this.rng.fork('author', key, year);
    const born = year - rng.int(24, 50);
    const x = newPerson(s, { sex: rng.chance(0.08) ? 'f' : 'm', born, culture: culture ?? this.ctx.polityCulture(p, year), polity: p.id, key: `author:${key}:${year}`, adult: true, minDeath: year + rng.int(1, 25) });
    x.roles.push({ role, polity: p.id, start: born + 20, end: x.died, event: null });
    pool.push(x.id);
    this.scribes.set(key, pool);
    this.T.pageRefs.add(`per:${x.id}`);
    this.T.title.set(`per:${x.id}`, `${this.ctx.name(x.nameId, s.cultures[x.culture].lang, born + 30)} (${role}, AY ${born}–${x.died})`);
    this.T.short.set(`per:${x.id}`, this.ctx.name(x.nameId, s.cultures[x.culture].lang, born + 30));
    return x;
  }

  private makeScholars(): void {
    const s = this.ctx.s;
    const ed = s.polities[this.ctx.editorialPolity];
    const rng = this.rng.fork('scholars');
    for (let i = 0; i < 48; i++) {
      const born = rng.int(4780, 4935);
      const x = newPerson(s, { sex: rng.chance(0.4) ? 'f' : 'm', born, culture: this.editorialCulture, polity: ed.id, key: `scholar:${i}`, adult: true, minDeath: Math.min(born + 65, 5000) });
      const role = i % 3 === 0 ? 'archaeologist' : 'translator';
      x.roles.push({ role, polity: ed.id, start: born + 25, end: Math.min(x.died, 5000), event: null });
      this.scholars.push(x.id);
      this.T.pageRefs.add(`per:${x.id}`);
      const nm = this.ctx.name(x.nameId, s.cultures[x.culture].lang, 5000);
      this.T.title.set(`per:${x.id}`, `${nm} (${role}, AY ${born}–${x.died > 5000 ? '' : x.died})`.replace('–)', '–)'));
      this.T.short.set(`per:${x.id}`, nm);
    }
  }

  scholarFor(lang: LangId, foundYear: number, role: 'archaeologist' | 'translator'): number {
    const s = this.ctx.s;
    const fam = s.lang.info(lang).family;
    const cands = this.scholars.filter((id) => {
      const x = s.persons[id];
      return x.roles.some((r) => r.role === role) && x.born + 25 <= foundYear && x.died >= foundYear;
    });
    const pool = cands.length ? cands : this.scholars;
    return pool[fam % pool.length];
  }
}

export function moneyKg(kg: number): number {
  return kg;
}

/** Render a sum of silver (kg) as the payer would write it. */
export function money(g: Gen, d: Doc, kg: number, polity: number | null, year: number): string {
  const ctx = g.ctx;
  const cur = polity !== null ? ctx.currencyAt(polity, year) : -1;
  if (cur < 0 || year < ctx.s.currencies[cur].born) {
    const talents = kg / 30;
    if (talents >= 1) return `${fmt(talents)} talents of silver`;
    return `${fmt(kg * 2)} minas of silver`;
  }
  const c = ctx.s.currencies[cur];
  const grams = ctx.contentAt(cur, year);
  const units = (kg * 1000) / Math.max(1e-6, grams);
  const link = d.link(`cur:${cur}`, d.nameOf(`cur:${cur}`));
  // large sums by weight are reckoned in talents, as scribes did
  if (c.kind === 'weight' && kg >= 30) return `${fmt(kg / 30)} talent${kg >= 45 ? 's' : ''} of silver by the ${link} standard`;
  return `${fmt(units)} ${link}${c.kind === 'weight' ? ' of silver' : ''}`;
}

export function fmt(x: number): string {
  if (x >= 100) return Math.round(x).toLocaleString('en-US');
  if (x >= 10) return String(Math.round(x));
  if (x >= 1) return String(Math.round(x * 10) / 10);
  return String(Math.round(x * 100) / 100);
}

export function goodName(id: number): string {
  return GOODS[id].name;
}

export function goodUnit(id: number): string {
  return GOODS[id].unit;
}

/** Record an archive-level event (e.g. an excavation) in the causal ledger. */
export function archiveEvent(g: Gen, sub: string, year: number, cell: number, parts: [string, string][], causes: number[], data: Record<string, unknown>, sig = 0.1): number {
  const e = event(g.ctx.s, sub, year, { cell, parts, causes, data, sig });
  const ref = `evt:${e.id}`;
  g.T.pageRefs.add(ref);
  const title = eventTitle(g.ctx, g.T, e);
  g.T.title.set(ref, title);
  g.T.short.set(ref, title);
  return e.id;
}

export { ref };
