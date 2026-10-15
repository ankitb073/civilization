// Archive context: indexes over the finished simulation for point-in-time lookups, plus the
// editorial frame (editorial language, page ids, naming).
import type { State, Polity, Person, SimEvent } from '../sim/state.ts';
import type { SimResult } from '../sim/run.ts';
import type { LangId, NameId } from '../lang/index.ts';
import { Rng } from '../core/rng.ts';
import { has } from '../sim/tech.ts';

export interface Reign { person: number; start: number; end: number; role: string }

export class Ctx {
  readonly s: State;
  readonly r: SimResult;
  readonly rng: Rng;
  editorialLang: LangId = 0;
  editorialPolity = -1;
  /** Archive-level continents: region ids 1000+landmass for landmasses of more than 60 cells. */
  continents = new Map<number, { lm: number; nameId: NameId; cells: number; labelCell: number }>();
  // per-cell histories: parallel arrays of [year, value]
  private ownerY: number[][] = [];
  private ownerV: number[][] = [];
  private cultY: number[][] = [];
  private cultV: number[][] = [];
  private relY: number[][] = [];
  private relV: number[][] = [];
  reigns = new Map<number, Reign[]>();
  eventsByRef = new Map<string, number[]>();
  polityStats = new Map<number, (number | string | null)[][]>();
  childrenEvents = new Map<number, number[]>(); // event -> events listing it as cause
  private nameMemo = new Map<string, string>();

  constructor(r: SimResult) {
    this.r = r;
    this.s = r.state;
    this.rng = new Rng(r.state.seed).fork('archive');
    const s = this.s;
    const n = s.world.n;
    const build = (initial: Int32Array, log: number[]) => {
      const Y: number[][] = Array.from({ length: n }, () => [-100000]);
      const V: number[][] = Array.from({ length: n }, (_, i) => [initial[i]]);
      for (let i = 0; i < log.length; i += 4) {
        const c = log[i + 1];
        Y[c].push(log[i]);
        V[c].push(log[i + 2]);
      }
      return [Y, V];
    };
    [this.ownerY, this.ownerV] = build(r.initial.owner, s.territoryLog);
    [this.cultY, this.cultV] = build(r.initial.culture, s.cultureLog);
    [this.relY, this.relV] = build(r.initial.religion, s.religionLog);
    // reigns
    for (const p of s.persons) {
      for (const role of p.roles) {
        if (role.polity === null) continue;
        if (role.role !== 'ruler' && role.role !== 'president' && role.role !== 'chairman') continue;
        let a = this.reigns.get(role.polity);
        if (!a) this.reigns.set(role.polity, (a = []));
        const pol = s.polities[role.polity];
        const end = role.end ?? Math.min(p.died, pol.died ?? 5000, 5000);
        a.push({ person: p.id, start: role.start, end, role: role.role });
      }
    }
    for (const a of this.reigns.values()) a.sort((x, y) => x.start - y.start || x.end - y.end);
    for (const e of s.events) {
      for (const [ref] of e.parts) {
        let a = this.eventsByRef.get(ref);
        if (!a) this.eventsByRef.set(ref, (a = []));
        a.push(e.id);
      }
      for (const c of e.causes) {
        let a = this.childrenEvents.get(c);
        if (!a) this.childrenEvents.set(c, (a = []));
        a.push(e.id);
      }
    }
    for (const row of s.polityYears) {
      const pid = row[0] as number;
      let a = this.polityStats.get(pid);
      if (!a) this.polityStats.set(pid, (a = []));
      a.push(row);
    }
    this.chooseEditorial();
  }

  private chooseEditorial(): void {
    const s = this.s;
    let best: Polity | null = null;
    for (const p of s.polities) {
      if (p.died !== null) continue;
      const score = p.pop * (has(p, 'computing') ? 3 : 1) * (has(p, 'printing') ? 1.5 : 1);
      const bs = best ? best.pop * (has(best, 'computing') ? 3 : 1) * (has(best, 'printing') ? 1.5 : 1) : -1;
      if (score > bs) best = p;
    }
    this.editorialPolity = best ? best.id : 0;
    this.editorialLang = best ? s.cultures[best.culture].lang : 0;
  }

  // ---------------------------------------------------------------- point-in-time lookups
  private at(Y: number[][], V: number[][], cell: number, year: number): number {
    if (cell < 0) return -1;
    const ys = Y[cell];
    let lo = 0, hi = ys.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ys[mid] <= year) lo = mid;
      else hi = mid - 1;
    }
    return V[cell][lo];
  }
  ownerAt(cell: number, year: number): number { return this.at(this.ownerY, this.ownerV, cell, year); }
  cultureAt(cell: number, year: number): number { return this.at(this.cultY, this.cultV, cell, year); }
  religionAt(cell: number, year: number): number { return this.at(this.relY, this.relV, cell, year); }
  ownerHistory(cell: number): [number, number][] { return this.ownerY[cell].map((y, i) => [y, this.ownerV[cell][i]]); }

  rulerAt(polity: number, year: number): Reign | null {
    const a = this.reigns.get(polity);
    if (!a) return null;
    let best: Reign | null = null;
    for (const r of a) if (r.start <= year && r.end >= year) best = r;
    return best;
  }

  /** Decadal stats row of a polity at year: [id, year, cells, pop, urban, treasury, army, stability, gov, ruler, capital, religion, currency, era]. */
  statsAt(polity: number, year: number): (number | string | null)[] | null {
    const a = this.polityStats.get(polity);
    if (!a || a.length === 0) return null;
    let best = a[0];
    for (const row of a) if ((row[1] as number) <= year) best = row;
    return best;
  }

  govAt(p: Polity, year: number): string {
    let g = p.govs[0][1];
    for (const [y, v] of p.govs) if (y <= year) g = v;
    return g;
  }

  capitalAt(p: Polity, year: number): number {
    let c = p.capitals[0][1];
    for (const [y, v] of p.capitals) if (y <= year) c = v;
    return c;
  }

  currencyAt(polity: number, year: number): number {
    const row = this.statsAt(polity, year);
    return row ? (row[12] as number) : -1;
  }

  /** The currency in use at an exact date: decadal rows are recorded at the decade's end, so skip coins not yet minted. */
  currencyAtExact(polity: number, year: number): number {
    const a = this.polityStats.get(polity) ?? [];
    for (let i = a.length - 1; i >= 0; i--) {
      if ((a[i][1] as number) > year) continue;
      const c = a[i][12] as number;
      if (c < 0 || this.s.currencies[c].born <= year) return c;
    }
    return -1;
  }

  religionOf(polity: number, year: number): number {
    const row = this.statsAt(polity, year);
    return row ? (row[11] as number) : this.s.polities[polity].religion;
  }

  eraAt(polity: number, year: number): number {
    const row = this.statsAt(polity, year);
    return row ? (row[13] as number) : 0;
  }

  contentAt(currency: number, year: number): number {
    const c = this.s.currencies[currency];
    let v = c.history[0][1];
    for (const [y, x] of c.history) if (y <= year) v = x;
    return v;
  }

  polityCulture(p: Polity | number, year: number): number {
    const P = typeof p === 'number' ? this.s.polities[p] : p;
    let c = P.cultures[0][1];
    for (const [y, v] of P.cultures) if (y <= year) c = v;
    return c;
  }

  polityLang(p: Polity | number, year: number): LangId {
    return this.s.cultures[this.polityCulture(p, year)].lang;
  }

  /** The script a polity's chancery would use at `year` (or -1 if illiterate). */
  scriptOf(p: Polity, year: number): number {
    const cu = this.s.cultures[this.polityCulture(p, year)];
    let sc = cu.script;
    // walk back to a script that already existed at `year`
    while (sc >= 0 && this.s.scripts[sc].born > year) sc = this.s.scripts[sc].parent ?? -1;
    if (sc < 0) {
      // any script of this culture born by then
      for (const x of this.s.scripts) if (x.culture === cu.id && x.born <= year) sc = x.id;
    }
    return sc;
  }

  // ---------------------------------------------------------------- names
  name(nameId: NameId, lang: LangId, year: number): string {
    const k = `${nameId}|${lang}|${Math.round(year / 25)}`;
    let v = this.nameMemo.get(k);
    if (v === undefined) {
      v = this.s.lang.realize(nameId, lang, year).conventional;
      if (v.replace(/[^\p{L}]/gu, '').length < 3) {
        // eroded to a stub: keep the earliest full form, as editors do with worn-down names
        const o = this.s.lang.nameOrigin(nameId);
        const full = this.s.lang.realize(nameId, o.lang, o.year).conventional;
        if (full.replace(/[^\p{L}]/gu, '').length > v.replace(/[^\p{L}]/gu, '').length) v = full;
      }
      v = deBug(v);
      this.nameMemo.set(k, v);
    }
    return v;
  }

  scholarly(nameId: NameId, lang: LangId, year: number): string {
    return this.s.lang.realize(nameId, lang, year).scholarly;
  }

  personName(p: Person, lang: LangId, year: number): string {
    return this.name(p.nameId, lang, year);
  }

  /** Coin names for every sizeable landmass (idempotent). */
  ensureContinents(): void {
    if (this.continents.size) return;
    const s = this.s;
    const w = s.world;
    for (let lm = 0; lm < w.landmassSize.length; lm++) {
      if (w.landmassSize[lm] <= 60) continue;
      const counts = new Map<number, number>();
      let sx = 0, sy = 0, n = 0;
      for (let c = 0; c < w.n; c++) {
        if (w.landmass[c] !== lm) continue;
        const cu = this.r.initial.culture[c];
        if (cu >= 0) counts.set(cu, (counts.get(cu) ?? 0) + 1);
        sx += w.x[c]; sy += w.y[c]; n++;
      }
      let cu = -1, best = -1;
      for (const [k, v] of counts) if (v > best || (v === best && k < cu)) { best = v; cu = k; }
      if (cu < 0) continue;
      const lang = s.cultures[cu].lang;
      const nameId = s.lang.coinName(lang, Math.max(0, s.lang.info(lang).born), 'region', `continent:${lm}`);
      let label = -1, bd = Infinity;
      for (let c = 0; c < w.n; c++) {
        if (w.landmass[c] !== lm) continue;
        const dd = Math.hypot(w.x[c] - sx / n, w.y[c] - sy / n);
        if (dd < bd) { bd = dd; label = c; }
      }
      this.continents.set(1000 + lm, { lm, nameId, cells: w.landmassSize[lm], labelCell: label });
    }
  }

  continentOfCell(cell: number): number | null {
    const id = 1000 + this.s.world.landmass[cell];
    return this.continents.has(id) ? id : null;
  }

  ev(id: number): SimEvent {
    return this.s.events[id];
  }

  partsOf(e: SimEvent, role: string): string[] {
    return e.parts.filter(([, r]) => r === role).map(([x]) => x);
  }

  idNum(ref: string): number {
    return Number(ref.slice(ref.indexOf(':') + 1));
  }
}

/** A coined name that happens to spell a programmer's null ("None", "Null", "NaN") reads as a bug;
 *  editors mark the final vowel instead (None → Nonë). */
export function deBug(v: string): string {
  if (!/^(none|null|nil|nan|undefined|true|false|error|object)$/i.test(v)) return v;
  const m = v.match(/^(.*)([aeiou])([^aeiou]*)$/i);
  if (!m) return v + 'h';
  const mark: Record<string, string> = { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü' };
  return m[1] + (mark[m[2].toLowerCase()] ?? m[2]) + m[3];
}

export function roman(n: number): string {
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function ordinalWord(n: number): string {
  const w = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
  return n < w.length ? w[n] : ordinal(n);
}

export function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function ay(year: number): string {
  return year < 0 ? `${-year} before AY 0` : `AY ${year}`;
}
