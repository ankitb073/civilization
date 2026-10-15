// Document writing helpers: period-correct names with links, local calendars, phrase variation.
import type { Ctx } from './context.ts';
import { ordinal } from './context.ts';
import type { Titles } from './naming.ts';
import type { LangId, NameId } from '../lang/index.ts';
import type { Polity } from '../sim/state.ts';
import { Rng } from '../core/rng.ts';

export class Doc {
  readonly ctx: Ctx;
  readonly T: Titles;
  readonly lang: LangId;
  readonly year: number;
  readonly rng: Rng;
  mentions = new Set<string>();

  constructor(ctx: Ctx, T: Titles, lang: LangId, year: number, rng: Rng) {
    this.ctx = ctx;
    this.T = T;
    this.lang = lang;
    this.year = year;
    this.rng = rng;
  }

  /** Link to an entity page with explicit display text. */
  link(ref: string, text: string): string {
    if (!this.T.pageRefs.has(ref)) return text;
    this.mentions.add(ref);
    return `[[${ref}|${text}]]`;
  }

  /** The name of an entity as this document would write it. */
  nameOf(ref: string): string {
    const s = this.ctx.s;
    const id = this.ctx.idNum(ref);
    const nm = (nameId: NameId) => this.ctx.name(nameId, this.lang, this.year);
    switch (ref.slice(0, 3)) {
      case 'pol': return nm(s.polities[id].nameId);
      case 'per': return nm(s.persons[id].nameId);
      case 'set': {
        const t = s.settlements[id];
        let n = t.names[0][1];
        for (const [y, v] of t.names) if (y <= this.year) n = v;
        return nm(n);
      }
      case 'reg': return nm(s.regionNames[id]);
      case 'riv': return nm(s.riverNames[id]);
      case 'cul': return nm(s.cultures[id].nameId);
      case 'mov': return nm(s.movements[id].nameId);
      case 'dei': return nm(s.deities[id].nameId);
      case 'cur': return nm(s.currencies[id].nameId);
      case 'hou': return nm(s.houses[id].nameId);
      case 'lan': return nm(s.lang.info(id).endonym);
      case 'scr': return nm(s.scripts[id].nameId);
      default: return this.T.short.get(ref) ?? ref;
    }
  }

  /** Linked period name. */
  n(ref: string): string {
    return this.link(ref, this.nameOf(ref));
  }

  /** Linked editorial (modern) name, for editorial apparatus. */
  ed(ref: string): string {
    return this.link(ref, this.T.short.get(ref) ?? ref);
  }

  /** Linked editorial title. */
  title(ref: string): string {
    return this.link(ref, this.T.title.get(ref) ?? this.T.short.get(ref) ?? ref);
  }

  pick<T>(xs: readonly T[]): T {
    return this.rng.pick(xs);
  }

  chance(p: number): boolean {
    return this.rng.chance(p);
  }

  /** The native word for a concept, scholarly romanization in italics. */
  term(concept: string): string {
    return `*${this.ctx.s.lang.word(this.lang, concept, this.year).scholarly}*`;
  }
}

// ---------------------------------------------------------------- calendars

const monthCache = new Map<string, NameId[]>();

export function months(ctx: Ctx, culture: number): NameId[] {
  const key = String(culture);
  let m = monthCache.get(key);
  if (!m) {
    const cu = ctx.s.cultures[culture];
    const born = Math.max(cu.born, ctx.s.lang.info(cu.lang).born);
    m = Array.from({ length: 12 }, (_, i) => ctx.s.lang.coinName(cu.lang, born, 'month', `month:${culture}:${i}`));
    monthCache.set(key, m);
  }
  return m;
}

export function resetCalendarCache(): void {
  monthCache.clear();
}

/** A local date for a document issued by polity `p` in `year`, plus the normalized year. */
export function localDate(ctx: Ctx, d: Doc, p: Polity | null, year: number, opts: { day?: boolean } = {}): string {
  const s = ctx.s;
  const norm = ` [AY ${year}]`;
  if (!p) return `in the year AY ${year}`;
  const era = ctx.eraAt(p.id, year);
  const reign = ctx.rulerAt(p.id, year);
  const style = new Rng(s.seed).fork('calendar', p.id).int(0, 2);
  const monthPart = () => {
    if (!opts.day) return '';
    const cu = ctx.polityCulture(p, year);
    const ms = months(ctx, cu);
    const mi = d.rng.int(0, 11);
    const day = d.rng.int(1, 29);
    return `on the ${ordinal(day)} day of ${d.link(`cul:${cu}`, ctx.name(ms[mi], d.lang, year))}, `;
  };
  if (era <= 1 || (era <= 3 && style === 0)) {
    if (reign && reign.role === 'ruler') {
      const n = year - reign.start + 1;
      return `${monthPart()}in the ${ordinal(n)} year of ${d.n(`per:${reign.person}`)}${norm}`;
    }
    return `${monthPart()}in the ${ordinal(year - p.born + 1)} year of ${d.n(`pol:${p.id}`)}${norm}`;
  }
  if (era <= 3) {
    if (style === 1) {
      const cap = ctx.capitalAt(p, year);
      const t = s.settlements[cap];
      return `${monthPart()}in the year ${year - t.founded + 1} from the founding of ${d.n(`set:${cap}`)}${norm}`;
    }
    const rel = ctx.religionOf(p.id, year);
    const m = rel >= 0 ? s.movements[rel] : null;
    if (m && m.kind !== 'pantheon' && m.born <= year) return `${monthPart()}in the year ${year - m.born + 1} of the ${d.n(`mov:${m.id}`)}${norm}`;
    return `${monthPart()}in the year ${year - p.born + 1} of ${d.n(`pol:${p.id}`)}${norm}`;
  }
  // early modern and later: a common era counted from the state faith or the realm
  const rel = ctx.religionOf(p.id, year);
  const m = rel >= 0 ? s.movements[rel] : null;
  const anchor = m && m.kind !== 'pantheon' && m.born <= year ? m.born : p.born;
  const label = m && m.kind !== 'pantheon' && m.born <= year ? d.n(`mov:${m.id}`) : d.n(`pol:${p.id}`);
  const cu = ctx.polityCulture(p, year);
  const ms = months(ctx, cu);
  const mi = d.rng.int(0, 11);
  const day = d.rng.int(1, 28);
  return `${day} ${d.link(`cul:${cu}`, ctx.name(ms[mi], d.lang, year))} ${year - anchor + 1} of the ${label}${norm}`;
}
