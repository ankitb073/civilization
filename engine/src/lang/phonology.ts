// Phoneme inventory with features, family "styles" (phonological archetypes), root
// generation, empirical phonotactic profiles, and loanword repair.

import type { Rng } from '../core/rng.ts';

export type Manner = 'stop' | 'affricate' | 'fricative' | 'nasal' | 'lateral' | 'rhotic' | 'glide' | 'vowel';

export interface Phon {
  id: number;
  sym: string;
  v: boolean;
  place: number;     // consonants: 0 bilabial .. 11 glottal
  manner: Manner;
  voice: boolean;
  emph: boolean;
  height: number;    // vowels: 0 high .. 4 low
  back: number;      // 0 front, 1 central, 2 back
  round: boolean;
  long: boolean;
}

export const PHONS: Phon[] = [];
const BY_SYM = new Map<string, number>();

function addC(sym: string, place: number, manner: Manner, voice: boolean, emph = false): void {
  const id = PHONS.length;
  PHONS.push({ id, sym, v: false, place, manner, voice, emph, height: 0, back: 0, round: false, long: false });
  BY_SYM.set(sym, id);
}
function addV(sym: string, height: number, back: number, round: boolean, long = false): void {
  const id = PHONS.length;
  PHONS.push({ id, sym, v: true, place: -1, manner: 'vowel', voice: true, emph: false, height, back, round, long });
  BY_SYM.set(sym, id);
}

// places: 0 bilabial 1 labiodental 2 dental 3 alveolar 4 postalveolar 5 retroflex 6 palatal
//         7 velar 8 labiovelar 9 uvular 10 pharyngeal 11 glottal
addC('p', 0, 'stop', false); addC('b', 0, 'stop', true);
addC('t', 3, 'stop', false); addC('d', 3, 'stop', true);
addC('ʈ', 5, 'stop', false); addC('ɖ', 5, 'stop', true);
addC('k', 7, 'stop', false); addC('g', 7, 'stop', true);
addC('kʷ', 8, 'stop', false); addC('gʷ', 8, 'stop', true);
addC('q', 9, 'stop', false); addC('ʔ', 11, 'stop', false);
addC('tˤ', 3, 'stop', false, true);
addC('ɸ', 0, 'fricative', false); addC('β', 0, 'fricative', true);
addC('f', 1, 'fricative', false); addC('v', 1, 'fricative', true);
addC('θ', 2, 'fricative', false); addC('ð', 2, 'fricative', true);
addC('s', 3, 'fricative', false); addC('z', 3, 'fricative', true);
addC('sˤ', 3, 'fricative', false, true);
addC('ʃ', 4, 'fricative', false); addC('ʒ', 4, 'fricative', true);
addC('ʂ', 5, 'fricative', false);
addC('x', 7, 'fricative', false); addC('ɣ', 7, 'fricative', true);
addC('χ', 9, 'fricative', false);
addC('ħ', 10, 'fricative', false); addC('ʕ', 10, 'fricative', true);
addC('h', 11, 'fricative', false);
addC('ts', 3, 'affricate', false); addC('dz', 3, 'affricate', true);
addC('tʃ', 4, 'affricate', false); addC('dʒ', 4, 'affricate', true);
addC('tɬ', 3, 'affricate', false);
addC('m', 0, 'nasal', true); addC('n', 3, 'nasal', true); addC('ɳ', 5, 'nasal', true);
addC('ɲ', 6, 'nasal', true); addC('ŋ', 7, 'nasal', true);
addC('l', 3, 'lateral', true); addC('ɭ', 5, 'lateral', true); addC('ʎ', 6, 'lateral', true);
addC('r', 3, 'rhotic', true); addC('ɻ', 5, 'rhotic', true);
addC('j', 6, 'glide', true); addC('w', 8, 'glide', true);

addV('i', 0, 0, false); addV('y', 0, 0, true); addV('ɨ', 0, 1, false); addV('u', 0, 2, true);
addV('e', 1, 0, false); addV('ø', 1, 0, true); addV('ə', 2, 1, false); addV('o', 1, 2, true);
addV('ɛ', 3, 0, false); addV('ɔ', 3, 2, true); addV('æ', 3.5, 0, false); addV('a', 4, 1, false);
addV('iː', 0, 0, false, true); addV('yː', 0, 0, true, true); addV('uː', 0, 2, true, true);
addV('eː', 1, 0, false, true); addV('øː', 1, 0, true, true); addV('oː', 1, 2, true, true);
addV('æː', 3.5, 0, false, true); addV('aː', 4, 1, false, true);

export function P(sym: string): number {
  const id = BY_SYM.get(sym);
  if (id === undefined) throw new Error(`unknown phoneme ${sym}`);
  return id;
}
export function hasSym(sym: string): boolean {
  return BY_SYM.has(sym);
}
export const isV = (id: number): boolean => PHONS[id].v;
export const isC = (id: number): boolean => !PHONS[id].v;
export const sym = (id: number): string => PHONS[id].sym;

export function isObstruent(id: number): boolean {
  const m = PHONS[id].manner;
  return m === 'stop' || m === 'fricative' || m === 'affricate';
}
export function isSonorant(id: number): boolean {
  const m = PHONS[id].manner;
  return m === 'nasal' || m === 'lateral' || m === 'rhotic' || m === 'glide';
}
export function isFront(id: number): boolean {
  const p = PHONS[id];
  return p.v && p.back === 0;
}

/** Counterpart differing only in voice, if it exists. */
export function voiceFlip(id: number): number | null {
  const p = PHONS[id];
  for (const q of PHONS) {
    if (!q.v && q.place === p.place && q.manner === p.manner && q.emph === p.emph && q.voice !== p.voice && q.sym !== 'tɬ' && p.sym !== 'tɬ') return q.id;
  }
  return null;
}
export function lengthFlip(id: number): number | null {
  const p = PHONS[id];
  if (!p.v) return null;
  for (const q of PHONS) {
    if (q.v && q.height === p.height && q.back === p.back && q.round === p.round && q.long !== p.long) return q.id;
  }
  return null;
}
export function shortOf(id: number): number {
  const p = PHONS[id];
  if (!p.v || !p.long) return id;
  return lengthFlip(id) ?? id;
}

/** Feature distance used for loanword adaptation. */
export function distance(a: number, b: number): number {
  const p = PHONS[a];
  const q = PHONS[b];
  if (p.v !== q.v) return 100;
  if (p.v) {
    return Math.abs(p.height - q.height) + Math.abs(p.back - q.back) * 0.8 + (p.round !== q.round ? 0.7 : 0) + (p.long !== q.long ? 0.3 : 0);
  }
  const mannerD = p.manner === q.manner ? 0 : (isObstruent(a) && isObstruent(b)) ? 1.5 : 3;
  return Math.abs(p.place - q.place) * 0.6 + mannerD + (p.voice !== q.voice ? 0.8 : 0) + (p.emph !== q.emph ? 0.4 : 0);
}

export function nearest(id: number, inv: Iterable<number>): number {
  let best = id;
  let bd = Infinity;
  for (const c of inv) {
    const d = distance(id, c);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

// ------------------------------------------------------------------ styles

export interface Style {
  id: string;
  consonants: Record<string, number>;   // inclusion probability
  vowels: Record<string, number>;
  /** syllable templates: C onset, V short vowel, L long vowel, N coda, R stop+liquid onset,
   *  S s+stop onset, P prenasalized onset, '' (vowel-initial when template starts with V). */
  initial: [string, number][];
  medial: [string, number][];
  final?: [string, number][];
  codas: string[];
  finalCodas?: string[];               // if set, restricts word-final codas
  sylCore: [number, number][];         // syllable-count weights for core words
  sylOther: [number, number][];
  gemination: number;
  signature: number;                   // how many consonants get a frequency boost
  freq: Record<string, number>;        // style frequency tweaks
  order: [('SOV' | 'SVO' | 'VSO'), number][];
  caseSystem: 'rich' | 'semitic' | 'none' | 'locative';
  adjOrder: 'pre' | 'post';
  genOrder: 'pre' | 'post';
  verbAffix: 'suf' | 'pre' | 'particle';
  possAffix: 'suf' | 'particle';
  nameJoin: '' | '-' | ' ';
  personJoin: '' | '-' | ' ';
  epenthetic: string;
  longVowelStyle: [string, number][];  // conventional: double | plain | circumflex | acute
  ortho: Record<string, [string, number][]>;
  ruleBias: Record<string, number>;
  nameSuffixes: Record<string, number>; // which derivational slots exist (prob)
  derivPos: 'pre' | 'suf';
}

const CORE_FREQ: Record<string, number> = {
  t: 2.6, k: 2.4, n: 2.6, m: 2.1, s: 2.1, r: 2.0, l: 2.0, p: 1.4, d: 1.6, b: 1.3, g: 1.2, h: 1.0, j: 0.9, w: 0.9,
  a: 3.2, i: 2.3, u: 1.9, e: 1.7, o: 1.5,
  'aː': 0.9, 'iː': 0.7, 'uː': 0.6, 'eː': 0.5, 'oː': 0.5,
};

export const STYLES: Style[] = [
  {
    id: 'sem',
    consonants: { p: 0.4, b: 1, t: 1, d: 1, k: 1, g: 0.9, q: 0.9, 'ʔ': 1, 'tˤ': 0.8, 'sˤ': 0.8, s: 1, z: 0.8, 'ʃ': 1, x: 0.7, 'ħ': 0.8, 'ʕ': 0.7, h: 0.9, m: 1, n: 1, l: 1, r: 1, j: 0.9, w: 0.9, 'θ': 0.3 },
    vowels: { a: 1, i: 1, u: 1, 'aː': 1, 'iː': 1, 'uː': 1, e: 0.25, o: 0.15 },
    initial: [['CV', 5], ['CVN', 4], ['CL', 2]],
    medial: [['CV', 5], ['CVN', 3.5], ['CL', 2.2]],
    codas: ['m', 'n', 'l', 'r', 's', 'ʃ', 't', 'k', 'b', 'd', 'q', 'ħ', 'ʔ', 'z', 'p'],
    sylCore: [[1, 2], [2, 6], [3, 1]],
    sylOther: [[2, 6], [3, 3]],
    gemination: 0.25,
    signature: 2,
    freq: { 'ʔ': 1.2, 'ʃ': 1.5, q: 1.2 },
    order: [['VSO', 4], ['SOV', 4], ['SVO', 2]],
    caseSystem: 'semitic',
    adjOrder: 'post', genOrder: 'post',
    verbAffix: 'pre', possAffix: 'suf',
    nameJoin: '-', personJoin: '-',
    epenthetic: 'i',
    longVowelStyle: [['plain', 5], ['circumflex', 2]],
    ortho: { 'ʃ': [['sh', 9], ['š', 1]], x: [['kh', 8], ['h', 2]], 'ħ': [['h', 1]], 'ʕ': [["'", 1], ['', 1]], 'ʔ': [["'", 1], ['', 2]], 'tˤ': [['t', 1]], 'sˤ': [['s', 3], ['ts', 1]], q: [['q', 3], ['k', 1]], 'θ': [['th', 1]] },
    ruleBias: { 'pharyngeal weakening': 2.5, 'loss of h': 1.5, 'emphatic loss': 2, 'postvocalic spirantization': 2.2, 'glottal stop loss': 2, 'final consonant loss': 1.2, 'apocope': 0.6 },
    nameSuffixes: { place: 0.2, people: 0.7, male: 0.2, female: 0.9 },
    derivPos: 'suf',
  },
  {
    id: 'ura',
    consonants: { p: 1, t: 1, k: 1, d: 0.3, g: 0.2, b: 0.15, s: 1, 'ʃ': 0.4, h: 0.8, v: 0.9, j: 1, m: 1, n: 1, 'ŋ': 0.4, l: 1, r: 1, ts: 0.4, 'tʃ': 0.3, 'ɲ': 0.3, 'ð': 0.2 },
    vowels: { a: 1, e: 1, i: 1, o: 1, u: 1, y: 0.85, 'æ': 0.85, 'ø': 0.6, 'aː': 0.5, 'eː': 0.4, 'iː': 0.4, 'oː': 0.4, 'uː': 0.4 },
    initial: [['CV', 6], ['CVN', 3], ['V', 0.6], ['CL', 1]],
    medial: [['CV', 6], ['CVN', 2.5], ['CL', 0.8]],
    codas: ['n', 'l', 'r', 's', 't', 'k', 'h', 'm'],
    finalCodas: ['n', 's', 't', 'r', 'l', 'k'],
    sylCore: [[1, 1], [2, 7], [3, 2]],
    sylOther: [[2, 5], [3, 5]],
    gemination: 0.35,
    signature: 2,
    freq: { v: 1.4, j: 1.3, h: 1.2 },
    order: [['SOV', 8], ['SVO', 2]],
    caseSystem: 'rich',
    adjOrder: 'pre', genOrder: 'pre',
    verbAffix: 'suf', possAffix: 'suf',
    nameJoin: '', personJoin: '',
    epenthetic: 'i',
    longVowelStyle: [['double', 9], ['acute', 1]],
    ortho: { 'æ': [['ä', 6], ['ae', 1]], 'ø': [['ö', 6], ['oe', 1]], y: [['y', 5], ['ü', 2]], 'ʃ': [['sh', 3], ['s', 1]], 'ŋ': [['ng', 1]], 'ɲ': [['ny', 1]], j: [['j', 8], ['y', 1]], ts: [['ts', 1]], 'tʃ': [['ch', 1]], 'ð': [['dh', 1]] },
    ruleBias: { 'vowel length loss': 1.5, 'final consonant loss': 1.3, 'umlaut': 1.4, 'degemination': 0.6, 'syncope': 1.2 },
    nameSuffixes: { place: 0.9, people: 0.6, lang: 0.6 },
    derivPos: 'suf',
  },
  {
    id: 'aus',
    consonants: { p: 0.9, t: 1, k: 1, 'ʔ': 0.6, m: 1, n: 1, 'ŋ': 0.9, s: 0.7, h: 0.7, l: 0.9, r: 0.7, w: 0.8, j: 0.4, b: 0.25, d: 0.25, g: 0.2, f: 0.3, v: 0.3 },
    vowels: { a: 1, e: 1, i: 1, o: 1, u: 1 },
    initial: [['CV', 7], ['V', 1.5]],
    medial: [['CV', 9], ['V', 0.6]],
    codas: [],
    sylCore: [[2, 7], [3, 2], [1, 0.3]],
    sylOther: [[2, 3], [3, 5], [4, 1.5]],
    gemination: 0,
    signature: 2,
    freq: { 'ŋ': 1.5, k: 1.2, l: 1.2, h: 1.1 },
    order: [['VSO', 6], ['SVO', 4]],
    caseSystem: 'none',
    adjOrder: 'post', genOrder: 'post',
    verbAffix: 'particle', possAffix: 'particle',
    nameJoin: '', personJoin: '',
    epenthetic: 'a',
    longVowelStyle: [['plain', 1]],
    ortho: { 'ŋ': [['ng', 9], ['g', 1]], 'ʔ': [["'", 2], ['', 3]], j: [['y', 1]], w: [['w', 3], ['v', 1]] },
    ruleBias: { 'debuccalization': 2.5, 'loss of h': 1.5, 'glottal stop loss': 1.5, 'vowel merger': 1.2, 'apocope': 0.1, 'syncope': 0.2, 'intervocalic spirantization': 0.3, 'postvocalic spirantization': 0.15, spirantization: 0.4, 'intervocalic voicing': 0.5 },
    nameSuffixes: { place: 0.3, people: 0.3, reduplicate: 0.25 },
    derivPos: 'pre',
  },
  {
    id: 'ine',
    consonants: { p: 1, b: 0.8, t: 1, d: 1, k: 1, g: 1, 'kʷ': 0.5, 'gʷ': 0.3, s: 1, h: 0.4, m: 1, n: 1, l: 1, r: 1, w: 0.8, j: 0.6, f: 0.3, 'θ': 0.15, x: 0.2, z: 0.15 },
    vowels: { a: 1, e: 1, i: 1, o: 1, u: 1, 'eː': 0.5, 'oː': 0.5, 'aː': 0.5, 'iː': 0.2, 'uː': 0.2 },
    initial: [['CV', 4], ['CVN', 3.5], ['RV', 1.6], ['RVN', 0.8], ['SV', 0.7], ['V', 0.4]],
    medial: [['CV', 5], ['CVN', 3], ['RV', 1]],
    codas: ['s', 'r', 'n', 'm', 'l', 't', 'k', 'd'],
    sylCore: [[1, 4], [2, 6], [3, 1]],
    sylOther: [[2, 6], [3, 3]],
    gemination: 0.05,
    signature: 2,
    freq: { s: 1.3, r: 1.3, w: 1.2 },
    order: [['SOV', 6], ['SVO', 4]],
    caseSystem: 'rich',
    adjOrder: 'pre', genOrder: 'pre',
    verbAffix: 'suf', possAffix: 'particle',
    nameJoin: '', personJoin: '',
    epenthetic: 'e',
    longVowelStyle: [['plain', 8], ['circumflex', 1], ['acute', 1]],
    ortho: { 'kʷ': [['qu', 4], ['kw', 3]], 'gʷ': [['gu', 2], ['gw', 3]], 'θ': [['th', 1]], x: [['ch', 2], ['kh', 2]], j: [['y', 3], ['j', 1], ['i', 1]], w: [['w', 3], ['v', 1], ['u', 1]] },
    ruleBias: { palatalization: 1.6, apocope: 1.3, 'final consonant loss': 1.2, umlaut: 1.0, breaking: 1.3, 'intervocalic voicing': 1.4, 'labiovelar shift': 2 },
    nameSuffixes: { male: 0.85, female: 0.85, place: 0.5, people: 0.5 },
    derivPos: 'suf',
  },
  {
    id: 'ban',
    consonants: { p: 0.7, b: 1, t: 1, d: 1, k: 1, g: 1, m: 1, n: 1, 'ɲ': 0.6, 'ŋ': 0.6, s: 1, z: 0.6, 'ʃ': 0.5, 'tʃ': 0.5, 'dʒ': 0.4, l: 0.8, w: 1, j: 0.8, h: 0.3, f: 0.4, v: 0.4 },
    vowels: { a: 1, e: 1, i: 1, o: 1, u: 1 },
    initial: [['CV', 7], ['PV', 1.6], ['V', 0.5]],
    medial: [['CV', 7], ['PV', 2]],
    codas: [],
    sylCore: [[2, 7], [3, 3]],
    sylOther: [[2, 4], [3, 5], [4, 1]],
    gemination: 0,
    signature: 2,
    freq: { w: 1.4, b: 1.3, z: 1.2 },
    order: [['SVO', 9], ['SOV', 1]],
    caseSystem: 'none',
    adjOrder: 'post', genOrder: 'post',
    verbAffix: 'pre', possAffix: 'particle',
    nameJoin: '', personJoin: '',
    epenthetic: 'u',
    longVowelStyle: [['double', 1]],
    ortho: { 'ɲ': [['ny', 1]], 'ŋ': [["ng'", 2], ['ng', 3]], 'ʃ': [['sh', 1]], 'tʃ': [['ch', 1]], 'dʒ': [['j', 1]], j: [['y', 1]] },
    ruleBias: { palatalization: 1.4, 'intervocalic spirantization': 1.2, 'vowel merger': 1.0, apocope: 0.1 },
    nameSuffixes: { place: 0.95, people: 0.95, lang: 0.95, person: 0.3 },
    derivPos: 'pre',
  },
  {
    id: 'mes',
    consonants: { p: 1, t: 1, k: 1, 'kʷ': 0.8, 'ʔ': 0.6, m: 1, n: 1, s: 1, 'ʃ': 1, ts: 0.9, 'tʃ': 0.9, 'tɬ': 0.85, l: 1, j: 0.9, w: 1, h: 0.4, x: 0.3 },
    vowels: { a: 1, e: 1, i: 1, o: 1, 'aː': 0.4, 'iː': 0.3, 'oː': 0.3, 'eː': 0.3 },
    initial: [['CV', 6], ['CVN', 3], ['V', 0.8]],
    medial: [['CV', 6], ['CVN', 3]],
    codas: ['n', 'l', 's', 'ʃ', 'k', 'tɬ', 'ʔ', 'ts', 'tʃ', 'm'],
    sylCore: [[1, 1], [2, 6], [3, 2]],
    sylOther: [[2, 4], [3, 4], [4, 1]],
    gemination: 0.1,
    signature: 2,
    freq: { 'tɬ': 1.6, 'ʃ': 1.3, ts: 1.2 },
    order: [['VSO', 5], ['SVO', 5]],
    caseSystem: 'locative',
    adjOrder: 'pre', genOrder: 'post',
    verbAffix: 'pre', possAffix: 'particle',
    nameJoin: '', personJoin: ' ',
    epenthetic: 'i',
    longVowelStyle: [['plain', 1]],
    ortho: { 'ʃ': [['x', 7], ['sh', 3]], 'tʃ': [['ch', 1]], ts: [['tz', 6], ['ts', 4]], 'tɬ': [['tl', 1]], 'kʷ': [['cu', 3], ['kw', 1]], 'ʔ': [['h', 2], ["'", 2], ['', 2]], k: [['k', 1], ['c', 2]] },
    ruleBias: { 'vowel length loss': 1.4, syncope: 1.2, 'deaffrication': 1.2 },
    nameSuffixes: { place: 0.9, people: 0.85, calendrical: 0.4 },
    derivPos: 'suf',
  },
  {
    id: 'dra',
    consonants: { p: 1, t: 1, 'ʈ': 1, k: 1, b: 0.5, d: 0.5, 'ɖ': 0.4, g: 0.5, 'tʃ': 0.8, m: 1, n: 1, 'ɳ': 0.9, 'ŋ': 0.6, 'ɲ': 0.4, l: 1, 'ɭ': 0.8, r: 1, 'ɻ': 0.5, w: 0.9, j: 0.9, s: 0.4, 'ʂ': 0.3, h: 0.2 },
    vowels: { a: 1, e: 1, i: 1, o: 1, u: 1, 'aː': 0.85, 'eː': 0.7, 'iː': 0.7, 'oː': 0.7, 'uː': 0.7 },
    initial: [['CV', 5], ['CVN', 3], ['CL', 2.5], ['V', 0.6], ['L', 0.3]],
    medial: [['CV', 5], ['CVN', 3], ['CL', 1.5]],
    codas: ['n', 'ɳ', 'l', 'ɭ', 'r', 'm', 'j', 'ʈ', 'k', 'p', 't'],
    finalCodas: ['n', 'ɳ', 'l', 'ɭ', 'r', 'm', 'j'],
    sylCore: [[1, 1], [2, 6], [3, 2]],
    sylOther: [[2, 4], [3, 5], [4, 1]],
    gemination: 0.45,
    signature: 2,
    freq: { 'ɳ': 1.2, 'ʈ': 1.3, 'ɭ': 1.2 },
    order: [['SOV', 10]],
    caseSystem: 'rich',
    adjOrder: 'pre', genOrder: 'pre',
    verbAffix: 'suf', possAffix: 'suf',
    nameJoin: '', personJoin: '',
    epenthetic: 'u',
    longVowelStyle: [['double', 6], ['plain', 3]],
    ortho: { 'ʈ': [['t', 3], ['tt', 1]], 'ɖ': [['d', 1]], 'ɳ': [['n', 1]], 'ɭ': [['l', 1]], 'ɻ': [['zh', 6], ['r', 2]], 'tʃ': [['ch', 1]], 'ʂ': [['sh', 1]], 'ɲ': [['ny', 1]], 'ŋ': [['ng', 1]], j: [['y', 1]], w: [['v', 5], ['w', 3]] },
    ruleBias: { 'intervocalic voicing': 1.6, 'vowel length loss': 0.8, palatalization: 1.2, apocope: 0.4 },
    nameSuffixes: { male: 0.9, female: 0.8, place: 0.85, people: 0.5 },
    derivPos: 'suf',
  },
  {
    id: 'sin',
    consonants: { p: 1, t: 1, k: 1, b: 0.4, d: 0.4, g: 0.3, ts: 0.9, 'tʃ': 0.9, s: 1, 'ʃ': 0.8, 'ʂ': 0.3, h: 1, x: 0.5, f: 0.6, m: 1, n: 1, 'ŋ': 0.9, l: 1, j: 1, w: 1, z: 0.3 },
    vowels: { a: 1, e: 0.8, i: 1, o: 1, u: 1, 'ə': 0.7, y: 0.4 },
    initial: [['CV', 4], ['CVN', 6], ['V', 0.3]],
    medial: [['CV', 4], ['CVN', 6]],
    codas: ['n', 'ŋ', 'm', 'p', 't', 'k'],
    sylCore: [[1, 9], [2, 1]],
    sylOther: [[1, 5], [2, 5]],
    gemination: 0,
    signature: 3,
    freq: { 'ŋ': 1.6, h: 1.3, ts: 1.2 },
    order: [['SVO', 9], ['SOV', 1]],
    caseSystem: 'none',
    adjOrder: 'pre', genOrder: 'pre',
    verbAffix: 'particle', possAffix: 'particle',
    nameJoin: '', personJoin: ' ',
    epenthetic: 'ə',
    longVowelStyle: [['plain', 1]],
    ortho: { ts: [['z', 4], ['ts', 3]], 'tʃ': [['ch', 4], ['zh', 3]], 'ʃ': [['sh', 5], ['x', 3]], 'ʂ': [['sh', 1]], 'ŋ': [['ng', 1]], 'ə': [['e', 5], ['eu', 1]], y: [['yu', 2], ['ü', 2]], x: [['h', 3], ['kh', 1]], j: [['y', 1]] },
    ruleBias: { 'final consonant loss': 1.6, 'cluster simplification': 0.5, apocope: 0.05, syncope: 0.05 },
    nameSuffixes: { place: 0.3 },
    derivPos: 'suf',
  },
];

export const STYLE_BY_ID = new Map(STYLES.map((s) => [s.id, s]));

// ------------------------------------------------------------------ proto phonology

export interface ProtoPhonology {
  style: Style;
  consonants: number[];
  vowels: number[];
  cw: number[];   // consonant weights aligned with consonants
  vw: number[];
  codas: number[];
  finalCodas: number[];
}

export function makeProtoPhonology(style: Style, rng: Rng): ProtoPhonology {
  const consonants: number[] = [];
  for (const [s, p] of Object.entries(style.consonants)) if (rng.chance(p)) consonants.push(P(s));
  // guarantee a workable core
  for (const s of ['t', 'k', 'n', 'm']) if (style.consonants[s] && !consonants.includes(P(s))) consonants.push(P(s));
  const vowels: number[] = [];
  for (const [s, p] of Object.entries(style.vowels)) if (rng.chance(p)) vowels.push(P(s));
  for (const s of ['a', 'i', 'u']) if (style.vowels[s] && !vowels.includes(P(s))) vowels.push(P(s));
  consonants.sort((x, y) => x - y);
  vowels.sort((x, y) => x - y);
  const sig = new Set(rng.sample(consonants, style.signature));
  const cw = consonants.map((c) => (CORE_FREQ[sym(c)] ?? 0.8) * (style.freq[sym(c)] ?? 1) * (sig.has(c) ? 2.2 : 1) * rng.range(0.7, 1.3));
  const vw = vowels.map((v) => (CORE_FREQ[sym(v)] ?? 0.7) * (style.freq[sym(v)] ?? 1) * rng.range(0.8, 1.2));
  const codas = style.codas.filter((s) => consonants.includes(P(s))).map(P);
  const finalCodas = (style.finalCodas ?? style.codas).filter((s) => consonants.includes(P(s))).map(P);
  return { style, consonants, vowels, cw, vw, codas, finalCodas };
}

function pickC(pp: ProtoPhonology, rng: Rng, filter?: (id: number) => boolean): number {
  if (!filter) return rng.weighted(pp.consonants, pp.cw);
  const items: number[] = [];
  const ws: number[] = [];
  pp.consonants.forEach((c, i) => {
    if (filter(c)) {
      items.push(c);
      ws.push(pp.cw[i]);
    }
  });
  if (items.length === 0) return rng.weighted(pp.consonants, pp.cw);
  return rng.weighted(items, ws);
}

function pickV(pp: ProtoPhonology, rng: Rng, long: boolean): number {
  const items: number[] = [];
  const ws: number[] = [];
  pp.vowels.forEach((v, i) => {
    if (PHONS[v].long === long) {
      items.push(v);
      ws.push(pp.vw[i]);
    }
  });
  if (items.length === 0) return rng.weighted(pp.vowels, pp.vw);
  return rng.weighted(items, ws);
}

const STOP_LIKE = (id: number) => PHONS[id].manner === 'stop' && PHONS[id].sym !== 'ʔ' && !PHONS[id].emph;
const LIQUID = (id: number) => PHONS[id].manner === 'lateral' || PHONS[id].manner === 'rhotic';

/** Generate a root in the proto-language's phonotactics. */
export function genRoot(pp: ProtoPhonology, rng: Rng, nSyl: number): number[] {
  const st = pp.style;
  const out: number[] = [];
  for (let s = 0; s < nSyl; s++) {
    const tplSet = s === 0 ? st.initial : (s === nSyl - 1 && st.final ? st.final : st.medial);
    let tpl = rng.weighted(tplSet.map((t) => t[0]), tplSet.map((t) => t[1]));
    // vowel-initial only at the start of a word
    if (s > 0 && (tpl.startsWith('V') || tpl.startsWith('L'))) tpl = 'C' + tpl;
    for (const ch of tpl) {
      if (ch === 'C') {
        let c = pickC(pp, rng);
        // avoid identical onset repeats and onset same as previous coda
        if (out.length && out[out.length - 1] === c && rng.chance(0.85)) c = pickC(pp, rng);
        out.push(c);
      } else if (ch === 'R') {
        const st1 = pickC(pp, rng, STOP_LIKE);
        const liq = pp.consonants.filter(LIQUID);
        out.push(st1);
        if (liq.length) out.push(rng.pick(liq));
      } else if (ch === 'S') {
        if (pp.consonants.includes(P('s'))) out.push(P('s'));
        out.push(pickC(pp, rng, (c) => STOP_LIKE(c) && !PHONS[c].voice));
      } else if (ch === 'P') {
        const stop = pickC(pp, rng, (c) => PHONS[c].manner === 'stop' && PHONS[c].voice);
        const nas = homorganicNasal(stop, pp.consonants);
        if (nas !== null) out.push(nas);
        out.push(stop);
      } else if (ch === 'V') {
        out.push(pickV(pp, rng, false));
      } else if (ch === 'L') {
        out.push(pickV(pp, rng, true));
      } else if (ch === 'N') {
        const last = s === nSyl - 1;
        const pool = last ? pp.finalCodas : pp.codas;
        if (pool.length) out.push(rng.pick(pool));
      }
    }
    // gemination: duplicate the next syllable's onset as this syllable's coda
    if (s < nSyl - 1 && st.gemination > 0 && isV(out[out.length - 1]) && rng.chance(st.gemination)) {
      out.push(-1); // placeholder, resolved after next onset is chosen
    }
  }
  // resolve gemination placeholders
  for (let i = 0; i < out.length; i++) {
    if (out[i] === -1) {
      const next = out[i + 1];
      if (next !== undefined && isC(next) && (PHONS[next].manner === 'stop' || PHONS[next].manner === 'nasal' || PHONS[next].manner === 'lateral' || PHONS[next].sym === 's')) out[i] = next;
      else out.splice(i--, 1);
    }
  }
  return out;
}

function homorganicNasal(stop: number, inv: number[]): number | null {
  const pl = PHONS[stop].place;
  let best: number | null = null;
  let bd = Infinity;
  for (const c of inv) {
    if (PHONS[c].manner !== 'nasal') continue;
    const d = Math.abs(PHONS[c].place - pl);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

// ------------------------------------------------------------------ profiles + repair

export interface Profile {
  inv: Set<number>;
  maxOnset: number;
  maxMedial: number;
  maxFinal: number;
  codas: Set<number>;
  finalCodas: Set<number>;
  hiatus: boolean;
  epenthetic: number;
}

/** Derive the phonotactic profile actually attested in a lexicon snapshot. */
export function profileOf(words: number[][], epentheticSym: string): Profile {
  const inv = new Set<number>();
  let maxOnset = 1;
  let maxMedial = 1;
  let maxFinal = 0;
  const codas = new Set<number>();
  const finalCodas = new Set<number>();
  let hiatus = false;
  const vowelCounts = new Map<number, number>();
  for (const w of words) {
    for (const p of w) inv.add(p);
    let i = 0;
    while (i < w.length && isC(w[i])) i++;
    maxOnset = Math.max(maxOnset, i);
    let j = w.length;
    while (j > 0 && isC(w[j - 1])) j--;
    const fin = w.length - j;
    maxFinal = Math.max(maxFinal, fin);
    if (fin > 0) finalCodas.add(w[j]);
    for (let k = 0; k < w.length; k++) {
      if (isV(w[k])) {
        vowelCounts.set(w[k], (vowelCounts.get(w[k]) ?? 0) + 1);
        if (k + 1 < w.length && isV(w[k + 1])) hiatus = true;
        // medial run after this vowel
        let r = k + 1;
        while (r < w.length && isC(w[r])) r++;
        const run = r - k - 1;
        if (r < w.length && run >= 2) {
          maxMedial = Math.max(maxMedial, run);
          codas.add(w[k + 1]);
        }
      }
    }
  }
  let ep = hasSym(epentheticSym) ? P(epentheticSym) : -1;
  if (!inv.has(ep)) {
    let best = -1;
    let bc = -1;
    for (const [v, c] of vowelCounts) if (!PHONS[v].long && c > bc) { bc = c; best = v; }
    ep = best >= 0 ? best : P('a');
  }
  return { inv, maxOnset, maxMedial, maxFinal, codas, finalCodas, hiatus, epenthetic: ep };
}

/** Adapt a foreign phoneme string to a target profile (loanword nativization). */
export function adaptTo(word: number[], prof: Profile): number[] {
  const invC: number[] = [];
  const invV: number[] = [];
  for (const p of prof.inv) (isV(p) ? invV : invC).push(p);
  invC.sort((a, b) => a - b);
  invV.sort((a, b) => a - b);
  let w = word.map((p) => (prof.inv.has(p) ? p : nearest(p, isV(p) ? invV : invC)));
  const E = prof.epenthetic;
  // initial cluster
  let i = 0;
  while (i < w.length && isC(w[i])) i++;
  if (i > prof.maxOnset) {
    const out = w.slice(0, prof.maxOnset);
    for (let k = prof.maxOnset; k < i; k++) out.push(E, w[k]);
    w = out.concat(w.slice(i));
  }
  // medial clusters and codas
  const res: number[] = [];
  let k = 0;
  while (k < w.length) {
    const p = w[k];
    res.push(p);
    if (isV(p)) {
      let r = k + 1;
      while (r < w.length && isC(w[r])) r++;
      const run = w.slice(k + 1, r);
      if (r < w.length && run.length >= 2 && (run.length > prof.maxMedial || !prof.codas.has(run[0]))) {
        for (let q = 0; q < run.length - 1; q++) res.push(run[q], E);
        res.push(run[run.length - 1]);
        k = r;
        continue;
      }
    }
    k++;
  }
  w = res;
  // final cluster
  let j = w.length;
  while (j > 0 && isC(w[j - 1])) j--;
  const fin = w.length - j;
  if (fin > 0 && (fin > prof.maxFinal || !prof.finalCodas.has(w[j]))) {
    if (prof.maxFinal === 0) {
      const out = w.slice(0, j);
      for (let k = j; k < w.length; k++) out.push(w[k], E);
      w = out;
    } else {
      w = w.concat([E]);
    }
  }
  // hiatus
  if (!prof.hiatus) {
    const out: number[] = [];
    for (const p of w) {
      if (out.length && isV(p) && isV(out[out.length - 1])) {
        if (PHONS[p].sym === PHONS[out[out.length - 1]].sym) continue;
        const glide = PHONS[p].back === 0 && prof.inv.has(P('j')) ? P('j') : prof.inv.has(P('w')) ? P('w') : -1;
        if (glide >= 0) out.push(glide);
        else continue;
      }
      out.push(p);
    }
    w = out;
  }
  if (!w.some(isV)) w.push(E);
  return w;
}

/** Concatenate morphemes with light junction repair. */
export function join(a: number[], b: number[], epenthetic: number): number[] {
  if (a.length === 0) return b.slice();
  if (b.length === 0) return a.slice();
  const aEndV = isV(a[a.length - 1]);
  const bStartV = isV(b[0]);
  if (aEndV && bStartV) {
    return b.length > 1 ? a.concat(b.slice(1)) : a.concat(b);
  }
  // avoid 3+ consonant pileups at the junction
  let ra = 0;
  for (let i = a.length - 1; i >= 0 && isC(a[i]); i--) ra++;
  let rb = 0;
  for (let i = 0; i < b.length && isC(b[i]); i++) rb++;
  if (ra + rb >= 3 || (ra >= 1 && rb >= 1 && a[a.length - 1] === b[0] && ra + rb > 2)) return a.concat([epenthetic], b);
  return a.concat(b);
}

export function countVowels(w: number[]): number {
  let n = 0;
  for (const p of w) if (isV(p)) n++;
  return n;
}

export function key(w: number[]): string {
  return w.join('.');
}
