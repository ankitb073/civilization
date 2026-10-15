// Technologies: a hazard model of invention around target dates, diffusion along contacts,
// and fragile knowledge that can be lost when states collapse.
import type { State, Polity, Tech } from './state.ts';
import { alivePolity, event, ref } from './state.ts';
import { newPerson } from './people.ts';

const T = (key: string, name: string, target: number, era: number, prereqs: string[] = []) => ({ key, name, target, era, prereqs });

const DEFS = [
  T('writing', 'Writing', 60, 0),
  T('bronze', 'Bronze-working', -200, 0),
  T('wheel', 'The wheel', 150, 0),
  T('irrigation', 'Canal irrigation', 100, 0),
  T('bureaucracy', 'Scribal bureaucracy', 600, 0, ['writing']),
  T('chariot', 'The war chariot', 1300, 0, ['wheel', 'bronze']),
  T('iron', 'Iron-smelting', 1750, 1, ['bronze']),
  T('alphabet', 'Alphabetic writing', 1900, 1, ['writing']),
  T('cavalry', 'Mounted cavalry', 2050, 1, ['iron']),
  T('coinage', 'Coinage', 2350, 2, ['iron', 'writing']),
  T('philosophy', 'Systematic philosophy', 2450, 2, ['writing']),
  T('engineering', 'Arch & aqueduct engineering', 2650, 2, ['iron', 'bureaucracy']),
  T('heavyplough', 'The heavy plough', 2800, 3, ['iron']),
  T('crossbow', 'The crossbow', 3000, 3, ['iron']),
  T('paper', 'Paper-making', 3200, 3, ['writing']),
  T('croprotation', 'Crop rotation', 3700, 3, ['heavyplough']),
  T('banking', 'Deposit banking & bills of exchange', 4250, 4, ['coinage', 'paper']),
  T('gunpowder', 'Gunpowder weapons', 4300, 4, ['iron']),
  T('navigation', 'Ocean navigation', 4350, 4, ['paper']),
  T('printing', 'Movable-type printing', 4450, 4, ['paper']),
  T('jointstock', 'Joint-stock companies', 4600, 4, ['banking', 'navigation']),
  T('science', 'Experimental science', 4620, 4, ['printing']),
  T('steam', 'The steam engine', 4745, 5, ['science']),
  T('railway', 'Railways', 4810, 5, ['steam']),
  T('telegraph', 'The electric telegraph', 4815, 5, ['science']),
  T('rifles', 'Rifled firearms', 4820, 5, ['gunpowder', 'steam']),
  T('electricity', 'Electrification', 4855, 5, ['telegraph']),
  T('fertilizer', 'Synthetic fertilizer', 4870, 5, ['science']),
  T('combustion', 'The combustion engine', 4870, 5, ['steam']),
  T('radio', 'Radio', 4890, 5, ['electricity']),
  T('aviation', 'Powered flight', 4900, 5, ['combustion']),
  T('computing', 'Electronic computing', 4925, 6, ['electricity']),
  T('network', 'Computer networks', 4960, 6, ['computing']),
];

export const TECHS: Tech[] = DEFS.map((d, id) => ({ id, key: d.key, name: d.name, target: d.target, era: d.era, prereqs: [] }));
const BY_KEY = new Map(TECHS.map((t) => [t.key, t]));
DEFS.forEach((d, i) => {
  TECHS[i].prereqs = d.prereqs.map((k) => BY_KEY.get(k)!.id);
});

export function techId(key: string): number {
  const t = BY_KEY.get(key);
  if (!t) throw new Error(`unknown tech ${key}`);
  return t.id;
}

export const TK = Object.fromEntries(TECHS.map((t) => [t.key, t.id])) as Record<string, number>;

export function has(p: Polity, key: string): boolean {
  return p.techs.has(TK[key]);
}

export const ERA_NAMES = ['Bronze', 'Iron', 'Classical', 'Medieval', 'Early Modern', 'Industrial', 'Post-industrial'];

export function eraOf(p: Polity): number {
  if (has(p, 'computing')) return 6;
  if (has(p, 'steam')) return 5;
  if (has(p, 'printing') || has(p, 'gunpowder')) return 4;
  if (has(p, 'paper') && has(p, 'heavyplough')) return 3;
  if (has(p, 'coinage') || has(p, 'philosophy')) return 2;
  if (has(p, 'iron')) return 1;
  return 0;
}

export function agriMult(p: Polity | null): number {
  if (!p) return 0.85;
  let m = 1;
  if (has(p, 'iron')) m *= 1.15;
  if (has(p, 'heavyplough')) m *= 1.4;
  if (has(p, 'engineering')) m *= 1.1;
  if (has(p, 'croprotation')) m *= 1.4;
  if (has(p, 'navigation')) m *= 1.1; // new crops
  if (has(p, 'science')) m *= 1.2;
  if (has(p, 'steam')) m *= 1.4;
  if (has(p, 'railway')) m *= 1.35;
  if (has(p, 'fertilizer')) m *= 2.2;
  if (has(p, 'combustion')) m *= 1.5;
  if (has(p, 'electricity')) m *= 1.25;
  if (has(p, 'computing')) m *= 1.2;
  return m;
}

export function irrigationMult(p: Polity | null): number {
  return p && has(p, 'irrigation') ? 1.5 : 1;
}

/** How workable forest and heavy soils are (0..1). */
export function forestWorkable(p: Polity | null): number {
  if (!p) return 0.3;
  if (has(p, 'heavyplough')) return 1;
  if (has(p, 'iron')) return 0.65;
  return 0.35;
}

export function milMult(p: Polity): number {
  let m = has(p, 'bronze') ? 1 : 0.7;
  if (has(p, 'chariot')) m *= 1.25;
  if (has(p, 'iron')) m *= 1.3;
  if (has(p, 'cavalry')) m *= 1.2;
  if (has(p, 'crossbow')) m *= 1.15;
  if (has(p, 'gunpowder')) m *= 1.6;
  if (has(p, 'rifles')) m *= 1.7;
  if (has(p, 'railway')) m *= 1.2;
  if (has(p, 'combustion')) m *= 1.5;
  if (has(p, 'aviation')) m *= 1.4;
  return m;
}

export const MOBILIZATION = [0.006, 0.008, 0.01, 0.008, 0.012, 0.02, 0.012];
export const TAX_PER_CAPITA = [0.004, 0.005, 0.007, 0.006, 0.009, 0.02, 0.05]; // silver kg / person / yr
export const GROWTH = [0.0015, 0.0016, 0.002, 0.002, 0.003, 0.009, 0.008];
export const URBAN_SHARE = [0.05, 0.07, 0.11, 0.12, 0.19, 0.45, 0.72];

export function adminMult(p: Polity): number {
  let m = 1;
  if (has(p, 'writing')) m *= 1.6;
  if (has(p, 'bureaucracy')) m *= 1.6;
  if (has(p, 'engineering')) m *= 1.25;
  if (has(p, 'paper')) m *= 1.15;
  if (has(p, 'printing')) m *= 1.25;
  if (has(p, 'railway')) m *= 1.5;
  if (has(p, 'telegraph')) m *= 1.8;
  if (has(p, 'computing')) m *= 1.2;
  return m;
}

/** Maximum distance (map units) for sea links. */
export function seaRange(p: Polity): number {
  if (has(p, 'steam')) return 5000;
  if (has(p, 'navigation')) return 2600;
  if (has(p, 'paper')) return 150;
  if (has(p, 'iron')) return 115;
  return 85;
}

/** Fragile techs that can be lost in a collapse. */
const FRAGILE = new Set(['writing', 'bureaucracy', 'coinage', 'engineering', 'alphabet', 'banking', 'philosophy']);

export function inheritTechs(s: State, child: Polity, parent: Polity | null, year: number, collapse: boolean): void {
  if (!parent) return;
  const rng = s.rng.fork('inherit', child.id);
  for (const [t, y] of parent.techs) {
    const tech = TECHS[t];
    if (collapse && FRAGILE.has(tech.key) && rng.chance(0.25)) continue;
    child.techs.set(t, Math.min(year, Math.max(y, child.born)));
  }
  // prerequisites must stay satisfied
  for (const t of [...child.techs.keys()]) {
    if (!TECHS[t].prereqs.every((q) => child.techs.has(q))) child.techs.delete(t);
  }
}

export interface TechContact {
  neighbors: Map<number, Set<number>>; // polity -> polities in contact
}

/** Decadal tech step: a calibrated global hazard for first inventions, diffusion along contacts,
 *  and rare independent reinvention by peoples with no contact to the inventors. */
export function techStep(s: State, y0: number, contacts: Map<number, Set<number>>): void {
  const rng = s.rng.fork('tech', y0);
  const alive = s.polities.filter((p) => alivePolity(p, y0));
  const known = new Map<number, number>();
  for (const p of s.polities) for (const [t, y] of p.techs) if (!known.has(t) || y < known.get(t)!) known.set(t, y);
  // diffusion
  for (const p of alive) {
    const dev = devFactor(s, p);
    const cs = contacts.get(p.id);
    for (const tech of TECHS) {
      if (p.techs.has(tech.id) || !known.has(tech.id)) continue;
      if (!tech.prereqs.every((q) => p.techs.has(q) && p.techs.get(q)! <= y0)) continue;
      let neighborKnows = 0;
      if (cs) for (const o of cs) if (s.polities[o].techs.has(tech.id) && s.polities[o].techs.get(tech.id)! <= y0) neighborKnows++;
      if (neighborKnows > 0) {
        const speed = tech.era >= 5 ? 1.8 : tech.era >= 4 ? 1.3 : 1;
        if (rng.chance(Math.min(0.75, 0.13 * neighborKnows * (0.6 + dev) * speed))) p.techs.set(tech.id, y0 + rng.int(0, 9));
      } else if (rng.chance(Math.min(0.2, 0.008 * Math.exp((y0 - tech.target - 150) / 110) * dev))) {
        invent(s, p, tech, y0 + rng.int(0, 9), true, rng);
      }
    }
  }
  // first inventions
  for (const tech of TECHS) {
    if (known.has(tech.id)) continue;
    // industrial-era inventions cascade quickly once their prerequisites exist
    const hazard = tech.era >= 5 ? Math.min(0.9, 0.16 * Math.exp((y0 - tech.target) / 45)) : Math.min(0.9, 0.065 * Math.exp((y0 - tech.target) / 100));
    if (!rng.chance(hazard)) continue;
    const able = alive.filter((p) => tech.prereqs.every((q) => p.techs.has(q) && p.techs.get(q)! <= y0));
    if (able.length === 0) continue;
    const p = rng.weighted(able, able.map((q) => devFactor(s, q) ** 2));
    invent(s, p, tech, y0 + rng.int(0, 9), false, rng);
  }
}

function invent(s: State, p: Polity, tech: Tech, year: number, independent: boolean, rng: import('../core/rng.ts').Rng): void {
  const inv = inventor(s, p, year, rng);
  const ev = event(s, 'invention', year, {
    cell: s.settlements[p.capital]?.cell ?? -1,
    parts: [[ref('pol', p.id), 'polity'], ...(inv !== null ? [[ref('per', inv), 'inventor'] as [string, string]] : [])],
    data: { tech: tech.id, independent },
    sig: independent ? 0.25 : 0.65,
  });
  if (inv !== null) s.persons[inv].roles.push({ role: 'inventor', polity: p.id, start: year, end: year, event: ev.id });
  p.techs.set(tech.id, year);
}

function inventor(s: State, p: Polity, year: number, rng: import('../core/rng.ts').Rng): number | null {
  const person = newPerson(s, { sex: rng.chance(0.85) ? 'm' : 'f', born: year - rng.int(28, 55), culture: p.culture, polity: p.id, minDeath: year + 1, key: `inventor:${p.id}:${year}` });
  person.skill = 1 + rng.next();
  return person.id;
}

export function devFactor(s: State, p: Polity): number {
  const urban = p.pop > 0 ? p.urbanPop / p.pop : 0;
  let d = 0.25 + urban * 4 + Math.min(1.2, Math.log10(1 + p.pop / 200_000) * 0.5);
  if (has(p, 'writing')) d += 0.3;
  if (has(p, 'printing')) d += 0.4;
  return d * (0.6 + p.stability * 0.6);
}
