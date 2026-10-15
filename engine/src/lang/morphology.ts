// Grammatical skeleton of a family: word order, case/adposition strategy, inflectional
// affixes, free particles, and derivational morphemes used in naming. Forms are proto
// phoneme strings; they evolve with the lexicon.

import type { Rng } from '../core/rng.ts';
import { PHONS, isV, key } from './phonology.ts';
import type { ProtoPhonology } from './phonology.ts';

export interface Affix { pos: 'pre' | 'suf'; form: number[] }

export interface Morphology {
  order: 'SOV' | 'SVO' | 'VSO';
  adposition: 'pre' | 'post';
  cases: string[];                         // case labels marked by affixes
  affixes: Record<string, Affix>;          // PL, GEN, ACC, DAT, ..., PST, PRS, FUT, OPT, POSS.*
  particles: Record<string, number[]>;     // free words: ADP.*, NEG, DEM, POSS.*, TAM particles
  deriv: Record<string, Affix>;            // place, people, lang, male, female, person
  adjOrder: 'pre' | 'post';
  genOrder: 'pre' | 'post';
}

export const ALL_CASES = ['ACC', 'GEN', 'DAT', 'LOC', 'INS', 'ABL', 'COM'];
export const POSS_KEYS = ['POSS.1SG', 'POSS.3SG.M', 'POSS.3SG.F', 'POSS.3PL'];
export const TAM = ['PST', 'PRS', 'FUT', 'OPT'];

function pickC(pp: ProtoPhonology, rng: Rng, filter?: (id: number) => boolean): number {
  const items: number[] = [];
  const ws: number[] = [];
  pp.consonants.forEach((c, i) => {
    const m = PHONS[c].manner;
    // grammatical morphemes favour unmarked consonants
    const unmarked = m === 'nasal' || m === 'lateral' || m === 'rhotic' || PHONS[c].sym === 's' || PHONS[c].sym === 't' || PHONS[c].sym === 'k';
    if (!filter || filter(c)) {
      items.push(c);
      ws.push(pp.cw[i] * (unmarked ? 2.5 : 0.5) * (PHONS[c].emph ? 0.1 : 1));
    }
  });
  return rng.weighted(items, ws);
}
function pickV(pp: ProtoPhonology, rng: Rng): number {
  const items = pp.vowels.filter((v) => !PHONS[v].long);
  const ws = items.map((v) => pp.vw[pp.vowels.indexOf(v)]);
  return rng.weighted(items, ws);
}

function morpheme(pp: ProtoPhonology, rng: Rng, shape: string): number[] {
  const out: number[] = [];
  for (const ch of shape) {
    if (ch === 'C') out.push(pickC(pp, rng));
    else if (ch === 'V') out.push(pickV(pp, rng));
    else if (ch === 'L') {
      const longs = pp.vowels.filter((v) => PHONS[v].long);
      out.push(longs.length ? rng.pick(longs) : pickV(pp, rng));
    }
  }
  return out;
}

function shapeFor(pp: ProtoPhonology, rng: Rng, pos: 'pre' | 'suf'): string {
  const noCoda = pp.codas.length === 0;
  if (pos === 'pre') return rng.weighted(['CV', 'V', 'CVC'], [6, 1.5, noCoda ? 0 : 1]);
  return rng.weighted(['VC', 'V', 'CV', 'CVC', 'L'], [noCoda ? 0 : 5, 2, 4, noCoda ? 0 : 1, pp.vowels.some((v) => PHONS[v].long) ? 1 : 0]);
}

export function makeMorphology(pp: ProtoPhonology, rng: Rng): Morphology {
  const st = pp.style;
  const order = rng.weighted(st.order.map((o) => o[0]), st.order.map((o) => o[1]));
  const adposition: 'pre' | 'post' = st.caseSystem === 'semitic' ? 'pre' : order === 'SOV' ? 'post' : 'pre';
  const used = new Set<string>();
  const uniq = (gen: () => number[]): number[] => {
    for (let i = 0; i < 12; i++) {
      const f = gen();
      if (!used.has(key(f))) {
        used.add(key(f));
        return f;
      }
    }
    const f = gen();
    used.add(key(f));
    return f;
  };
  const affixes: Record<string, Affix> = {};
  const particles: Record<string, number[]> = {};
  let cases: string[] = [];
  if (st.caseSystem === 'rich') cases = ALL_CASES.filter((c) => c === 'GEN' || c === 'LOC' || rng.chance(0.75));
  else if (st.caseSystem === 'semitic') cases = ['ACC', 'GEN'];
  else if (st.caseSystem === 'locative') cases = ['LOC'];
  for (const c of cases) {
    const pos: 'suf' = 'suf';
    affixes[c] = { pos, form: uniq(() => morpheme(pp, rng, st.caseSystem === 'semitic' ? 'V' + (rng.chance(0.5) && pp.codas.length ? 'C' : '') : shapeFor(pp, rng, pos))) };
  }
  // plural
  const plPos: 'pre' | 'suf' = st.derivPos === 'pre' && rng.chance(0.7) ? 'pre' : 'suf';
  affixes.PL = { pos: plPos, form: uniq(() => morpheme(pp, rng, shapeFor(pp, rng, plPos))) };
  // verbal mood/tense
  if (st.verbAffix === 'particle') {
    for (const t of TAM) particles[t] = uniq(() => morpheme(pp, rng, rng.pick(['CV', 'CV', 'V', 'CVC'].filter((s) => pp.codas.length || !s.endsWith('C')))));
  } else {
    for (const t of TAM) {
      const pos: 'pre' | 'suf' = st.verbAffix === 'pre' ? 'pre' : 'suf';
      affixes[t] = { pos, form: uniq(() => morpheme(pp, rng, shapeFor(pp, rng, pos))) };
    }
  }
  // possessive pronouns
  for (const pk of POSS_KEYS) {
    if (st.possAffix === 'suf') affixes[pk] = { pos: 'suf', form: uniq(() => morpheme(pp, rng, rng.pick(['CV', 'CV', 'CVCV'].filter(Boolean)))) };
    else particles[pk] = uniq(() => morpheme(pp, rng, rng.pick(['CV', 'CVCV', 'VCV'])));
  }
  // adpositions for roles without a case
  const roles: [string, string][] = [['GEN', 'ADP.GEN'], ['DAT', 'ADP.DAT'], ['LOC', 'ADP.LOC'], ['INS', 'ADP.INS'], ['ABL', 'ADP.ABL'], ['COM', 'ADP.COM']];
  for (const [c, pkey] of roles) if (!cases.includes(c)) particles[pkey] = uniq(() => morpheme(pp, rng, rng.pick(['CV', 'CV', 'VC', 'CVC'].filter((s) => pp.codas.length || !s.endsWith('C')))));
  particles['ADP.BEN'] = uniq(() => morpheme(pp, rng, pp.codas.length ? 'CVC' : 'CVCV'));
  particles.NEG = uniq(() => morpheme(pp, rng, rng.pick(['CV', 'V', 'CVC'].filter((s) => pp.codas.length || !s.endsWith('C')))));
  particles.DEM = uniq(() => morpheme(pp, rng, rng.pick(['CV', 'CVC', 'VCV'].filter((s) => pp.codas.length || !s.endsWith('C')))));
  // derivational morphemes for names
  const deriv: Record<string, Affix> = {};
  for (const [slot, p] of Object.entries(st.nameSuffixes)) {
    if (slot === 'reduplicate' || slot === 'calendrical') continue;
    if (!rng.chance(p)) continue;
    const pos = st.derivPos;
    let shape = pos === 'pre' ? 'CV' : shapeFor(pp, rng, 'suf');
    if (slot === 'female') shape = rng.pick(['V', 'VC', 'CV'].filter((s) => pp.codas.length || !s.endsWith('C')));
    if (slot === 'male') shape = rng.pick(['VC', 'V', 'CV'].filter((s) => pp.codas.length || !s.endsWith('C')));
    if (slot === 'place' && pos === 'suf') shape = rng.pick(['CV', 'CVC', 'CV'].filter((s) => pp.codas.length || !s.endsWith('C')));
    deriv[slot] = { pos, form: uniq(() => morpheme(pp, rng, shape)) };
  }
  return { order, adposition, cases, affixes, particles, deriv, adjOrder: st.adjOrder, genOrder: st.genOrder };
}

export function hasVowel(w: number[]): boolean {
  return w.some(isV);
}
