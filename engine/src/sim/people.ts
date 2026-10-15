// People: lifespans, families, rulers and succession, commanders.
import type { State, Person, Polity, Dynasty, GovType } from './state.ts';
import { event, ref, personAlive, addStress } from './state.ts';
import { Rng } from '../core/rng.ts';
import type { NameId } from '../lang/index.ts';

export function yearEra(year: number): number {
  if (year < 1750) return 0;
  if (year < 2350) return 1;
  if (year < 3200) return 2;
  if (year < 4300) return 3;
  if (year < 4760) return 4;
  if (year < 4950) return 5;
  return 6;
}

const ADULT_MEAN = [50, 52, 55, 54, 57, 66, 76];
const CHILD_MORT = [0.3, 0.3, 0.27, 0.28, 0.25, 0.12, 0.02];

export function newPerson(
  s: State,
  o: {
    sex: 'm' | 'f';
    born: number;
    culture: number;
    polity: number | null;
    key: string;
    father?: number | null;
    mother?: number | null;
    dynasty?: number | null;
    minDeath?: number;
    nameId?: NameId;
    adult?: boolean; // survived childhood (notables)
  },
): Person {
  const rng = s.rng.fork('person', o.key);
  const era = yearEra(o.born);
  let deathAge: number;
  if (!o.adult && rng.chance(CHILD_MORT[era])) deathAge = rng.int(0, 14);
  else deathAge = Math.max(17, Math.min(98, Math.round(rng.normal(ADULT_MEAN[era], 13))));
  let died = o.born + deathAge;
  if (o.minDeath !== undefined && died < o.minDeath) died = o.minDeath + rng.int(0, 20);
  const lang = s.cultures[o.culture].lang;
  const nameId = o.nameId ?? s.lang.coinName(lang, Math.max(o.born, s.lang.info(lang).born), o.sex === 'm' ? 'person-m' : 'person-f', `per:${o.key}`);
  const p: Person = {
    id: s.persons.length,
    nameId,
    sex: o.sex,
    born: o.born,
    died,
    deathCause: 'natural',
    deathEvent: null,
    culture: o.culture,
    polity: o.polity,
    father: o.father ?? null,
    mother: o.mother ?? null,
    spouses: [],
    children: [],
    dynasty: o.dynasty ?? null,
    skill: rng.normal(0, 1),
    roles: [],
    epithet: null,
    childrenGenerated: false,
  };
  s.persons.push(p);
  return p;
}

/** Kill a person at `year` from violence (battle, execution, assassination). */
export function kill(s: State, person: Person, year: number, cause: string, ev: number | null): void {
  if (person.died <= year) return;
  person.died = Math.max(year, person.born);
  person.deathCause = cause;
  person.deathEvent = ev;
  // unborn children cannot exist; children are generated lazily so this is safe
}

export function newDynasty(s: State, founder: Person, polity: number, year: number): Dynasty {
  const d: Dynasty = { id: s.dynasties.length, nameId: founder.nameId, founder: founder.id, polity, start: year, end: null };
  s.dynasties.push(d);
  founder.dynasty = d.id;
  return d;
}

/** Generate spouse and children for a ruler lazily (children are born in the past or future, never after death). */
export function ensureFamily(s: State, ruler: Person): void {
  if (ruler.childrenGenerated) return;
  ruler.childrenGenerated = true;
  const rng = s.rng.fork('family', ruler.id);
  if (ruler.spouses.length === 0) {
    const sp = newPerson(s, {
      sex: ruler.sex === 'm' ? 'f' : 'm',
      born: ruler.born + rng.int(-6, 4) * (ruler.sex === 'm' ? -1 : 1),
      culture: ruler.culture,
      polity: ruler.polity,
      key: `spouse:${ruler.id}`,
      adult: true,
      minDeath: ruler.born + 20,
    });
    sp.spouses.push(ruler.id);
    ruler.spouses.push(sp.id);
  }
  const spouse = s.persons[ruler.spouses[0]];
  const mother = ruler.sex === 'f' ? ruler : spouse;
  const father = ruler.sex === 'm' ? ruler : spouse;
  const first = Math.max(mother.born + 17, father.born + 17);
  const last = Math.min(mother.born + 42, mother.died - 1, father.died);
  if (last < first) return;
  const n = Math.min(7, rng.poisson(2.8));
  const births: number[] = [];
  for (let i = 0; i < n; i++) births.push(rng.int(first, last));
  births.sort((a, b) => a - b);
  // name pool for royal name reuse
  const pool: NameId[] = [];
  let anc: Person | null = ruler;
  for (let g = 0; g < 4 && anc; g++) {
    pool.push(anc.nameId);
    anc = anc.father !== null ? s.persons[anc.father] : null;
  }
  births.forEach((b, i) => {
    const sex: 'm' | 'f' = rng.chance(0.5) ? 'm' : 'f';
    const reuse = sex === ruler.sex && rng.chance(0.38) ? rng.pick(pool) : undefined;
    const c = newPerson(s, {
      sex,
      born: b,
      culture: ruler.culture,
      polity: ruler.polity,
      key: `child:${ruler.id}:${i}`,
      father: father.id,
      mother: mother.id,
      dynasty: ruler.dynasty,
      nameId: reuse,
    });
    father.children.push(c.id);
    if (mother.id !== father.id) mother.children.push(c.id);
  });
}

export function livingChildren(s: State, p: Person, year: number): Person[] {
  return p.children.map((c) => s.persons[c]).filter((c) => personAlive(c, year));
}

export function heirOf(s: State, polity: Polity, ruler: Person, year: number): Person | null {
  ensureFamily(s, ruler);
  const kids = livingChildren(s, ruler, year).sort((a, b) => a.born - b.born || a.id - b.id);
  const sons = kids.filter((k) => k.sex === 'm');
  const daughters = kids.filter((k) => k.sex === 'f');
  const siblings = ruler.father !== null
    ? livingChildren(s, s.persons[ruler.father], year).filter((x) => x.id !== ruler.id).sort((a, b) => a.born - b.born)
    : [];
  switch (polity.successionLaw) {
    case 'primogeniture':
      return kids[0] ?? siblings[0] ?? null;
    case 'male-primogeniture':
      return sons[0] ?? siblings.find((x) => x.sex === 'm') ?? daughters[0] ?? null;
    case 'seniority': {
      const adultBro = siblings.find((x) => x.sex === 'm' && year - x.born >= 18);
      return adultBro ?? sons[0] ?? daughters[0] ?? null;
    }
    case 'elective': {
      const adults = [...kids, ...siblings].filter((x) => year - x.born >= 20);
      if (adults.length === 0) return null;
      return adults.sort((a, b) => b.skill - a.skill || a.id - b.id)[0];
    }
  }
}

export const REPUBLICAN: GovType[] = ['merchant-republic', 'republic', 'federation', 'democracy', 'one-party-state'];

export function isRepublican(g: GovType): boolean {
  return REPUBLICAN.includes(g);
}

export function setRuler(s: State, polity: Polity, person: Person, year: number, ev: number, role: 'ruler' | 'regent' | 'president' | 'chairman' = 'ruler'): void {
  if (polity.ruler !== null) {
    const old = s.persons[polity.ruler];
    const r = [...old.roles].reverse().find((x) => (x.role === 'ruler' || x.role === 'president' || x.role === 'chairman') && x.polity === polity.id && x.end === null);
    if (r) r.end = year;
  }
  polity.ruler = person.id;
  polity.rulers.push([year, person.id]);
  person.polity = polity.id;
  person.roles.push({ role, polity: polity.id, start: year, end: null, event: ev });
}

/** The head of state of a polity at a year, from its reign history; null if the holder was already dead. */
export function rulerAt(s: State, polity: Polity, year: number): number | null {
  let r: number | null = null;
  for (const [y, id] of polity.rulers) {
    if (y > year) break;
    r = id;
  }
  return r !== null && s.persons[r].died > year ? r : null;
}

/** A head of state who can still act at `year` (one killed earlier that year cannot sign or be named). */
export function livingRuler(s: State, polity: Polity, year: number): number | null {
  return polity.ruler !== null && s.persons[polity.ruler].died > year ? polity.ruler : null;
}

/** Create a founding ruler for a new polity. */
export function foundingRuler(s: State, polity: Polity, year: number, ev: number, key: string): Person {
  const rng = s.rng.fork('founder', key);
  const p = newPerson(s, {
    sex: rng.chance(polity.successionLaw === 'primogeniture' ? 0.3 : 0.08) ? 'f' : 'm',
    born: year - rng.int(24, 48),
    culture: polity.culture,
    polity: polity.id,
    key: `ruler:${key}`,
    adult: true,
    minDeath: year + 1,
  });
  if (!isRepublican(polity.gov)) {
    const d = newDynasty(s, p, polity.id, year);
    polity.dynasty = d.id;
  }
  setRuler(s, polity, p, year, ev, isRepublican(polity.gov) ? headRole(polity.gov) : 'ruler');
  return p;
}

export function headRole(g: GovType): 'ruler' | 'president' | 'chairman' {
  if (g === 'one-party-state') return 'chairman';
  if (g === 'republic' || g === 'federation' || g === 'democracy') return 'president';
  return 'ruler';
}

const TERM: Partial<Record<GovType, number>> = { republic: 6, federation: 5, democracy: 5, 'one-party-state': 14, 'merchant-republic': 12 };

/** Yearly check of the head of state. Returns the succession event if one happened. */
export function successionCheck(s: State, polity: Polity, year: number, rng: Rng): number | null {
  if (polity.ruler === null) return null;
  const ruler = s.persons[polity.ruler];
  const role = [...ruler.roles].reverse().find((r) => r.polity === polity.id && r.end === null);
  const term = TERM[polity.gov];
  const termOver = term !== undefined && role && year - role.start >= term;
  if (ruler.died > year && !termOver) return null;
  const dead = ruler.died <= year;
  const causes = dead && ruler.deathEvent !== null ? [ruler.deathEvent] : [];

  if (isRepublican(polity.gov)) {
    const next = newPerson(s, { sex: rng.chance(year > 4900 ? 0.3 : 0.06) ? 'f' : 'm', born: year - rng.int(38, 66), culture: polity.culture, polity: polity.id, key: `head:${polity.id}:${year}`, adult: true, minDeath: year + 1 });
    next.skill = rng.normal(0.3, 0.8);
    const ev = event(s, 'election', year, {
      cell: s.settlements[polity.capital]?.cell ?? -1,
      parts: [[ref('pol', polity.id), 'polity'], [ref('per', ruler.id), 'predecessor'], [ref('per', next.id), 'successor']],
      causes,
      data: { gov: polity.gov, reason: dead ? 'death' : 'term' },
      sig: 0.08,
    });
    setRuler(s, polity, next, year, ev.id, headRole(polity.gov));
    return ev.id;
  }

  let heir = heirOf(s, polity, ruler, year);
  const parts: [string, string][] = [[ref('pol', polity.id), 'polity'], [ref('per', ruler.id), 'predecessor']];
  let sub = 'succession';
  let regent: Person | null = null;
  const data: Record<string, unknown> = {};
  if (!heir) {
    // crisis: a usurper founds a new dynasty
    sub = 'usurpation';
    heir = newPerson(s, { sex: 'm', born: year - rng.int(28, 50), culture: polity.culture, polity: polity.id, key: `usurper:${polity.id}:${year}`, adult: true, minDeath: year + 1 });
    heir.skill = rng.normal(0.5, 0.8);
    polity.stability = Math.max(0, polity.stability - 0.18);
    data.crisis = true;
  } else if (year - heir.born < 16) {
    const mother = heir.mother !== null ? s.persons[heir.mother] : null;
    regent = mother && personAlive(mother, year) && mother.id !== ruler.id ? mother : null;
    if (!regent) {
      regent = newPerson(s, { sex: 'm', born: year - rng.int(30, 55), culture: polity.culture, polity: polity.id, key: `regent:${polity.id}:${year}`, adult: true, minDeath: year + 1 });
    }
    data.regency = true;
    polity.stability = Math.max(0, polity.stability - 0.06);
  }
  parts.push([ref('per', heir.id), 'successor']);
  if (regent) parts.push([ref('per', regent.id), 'regent']);
  const ev = event(s, sub, year, { cell: s.settlements[polity.capital]?.cell ?? -1, parts, causes, data, sig: sub === 'usurpation' ? 0.3 : 0.12 });
  if (sub === 'usurpation') {
    if (polity.dynasty !== null) s.dynasties[polity.dynasty].end = year;
    const d = newDynasty(s, heir, polity.id, year);
    polity.dynasty = d.id;
    heir.roles.push({ role: 'usurper', polity: polity.id, start: year, end: year, event: ev.id });
    addStress(polity, year, ev.id, 0.6);
  }
  if (regent) regent.roles.push({ role: 'regent', polity: polity.id, start: year, end: heir.born + 16, event: ev.id });
  setRuler(s, polity, heir, year, ev.id);
  return ev.id;
}

/** Pick or create a commander for a polity at war. */
export function commander(s: State, polity: Polity, year: number, rng: Rng): Person {
  const ruler = polity.ruler !== null ? s.persons[polity.ruler] : null;
  const era = yearEra(year);
  if (ruler && personAlive(ruler, year) && year - ruler.born >= 18 && year - ruler.born < 60 && rng.chance(era <= 1 ? 0.55 : era <= 3 ? 0.35 : 0.05)) return ruler;
  const pool = polity.generals.map((g) => s.persons[g]).filter((g) => personAlive(g, year) && year - g.born >= 22 && year - g.born <= 68);
  if (pool.length > 0 && rng.chance(0.8)) return rng.pick(pool);
  const g = newPerson(s, { sex: era >= 6 && rng.chance(0.1) ? 'f' : 'm', born: year - rng.int(26, 48), culture: polity.culture, polity: polity.id, key: `general:${polity.id}:${year}:${polity.generals.length}`, adult: true, minDeath: year + 1 });
  g.roles.push({ role: 'general', polity: polity.id, start: year, end: null, event: null });
  polity.generals.push(g.id);
  if (polity.generals.length > 12) polity.generals.shift();
  return g;
}
