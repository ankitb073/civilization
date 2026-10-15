// Regular sound changes: a data representation, an interpreter, and a library of
// generators that propose plausible changes given a language's current state.

import type { Rng } from '../core/rng.ts';
import { PHONS, P, hasSym, isV, isC, sym, voiceFlip, lengthFlip, isObstruent, isFront, countVowels, key } from './phonology.ts';
import type { Style } from './phonology.ts';

export type Matcher = 'V' | 'C' | '#' | number[];

export interface Sub {
  from: number;
  to: number[];          // [] = deletion
  left?: Matcher[];      // left[0] = position i-1, left[1] = i-2 ...
  right?: Matcher[];     // right[0] = position i+1 ...
}

export interface RuleSpec {
  label: string;
  notation: string;
  kind: 'sub' | 'seq' | 'prothesis' | 'degemination';
  subs?: Sub[];
  seq?: { a: number; b: number; to: number[]; right?: Matcher[] }[];
  vowel?: number;        // prothesis vowel
  nonInitial?: boolean;  // vowel targets must not be the first (stressed) vowel
  minVowels?: number;
}

function matchAt(w: number[], pos: number, m: Matcher): boolean {
  if (m === '#') return pos < 0 || pos >= w.length;
  if (pos < 0 || pos >= w.length) return false;
  const p = w[pos];
  if (m === 'V') return isV(p);
  if (m === 'C') return isC(p);
  return m.includes(p);
}

function ctxOk(w: number[], i: number, left?: Matcher[], right?: Matcher[]): boolean {
  if (left) for (let k = 0; k < left.length; k++) if (!matchAt(w, i - 1 - k, left[k])) return false;
  if (right) for (let k = 0; k < right.length; k++) if (!matchAt(w, i + 1 + k, right[k])) return false;
  return true;
}

function maxRuns(w: number[]): { initial: number; medial: number; final: number } {
  let initial = 0;
  while (initial < w.length && isC(w[initial])) initial++;
  let final = 0;
  while (final < w.length - initial && isC(w[w.length - 1 - final])) final++;
  let medial = 0;
  let run = 0;
  for (let i = initial; i < w.length - final; i++) {
    if (isC(w[i])) {
      run++;
      if (run > medial) medial = run;
    } else run = 0;
  }
  return { initial, medial, final };
}

function acceptable(out: number[], orig: number[]): boolean {
  if (out.length === 0) return false;
  if (!out.some(isV)) return false;
  if (out.length < 2 && orig.length >= 2) return false;
  const r = maxRuns(out);
  const o = maxRuns(orig);
  if (r.initial > Math.max(2, o.initial)) return false;
  if (r.medial > Math.max(3, o.medial)) return false;
  if (r.final > Math.max(2, o.final)) return false;
  // no tripled identical phonemes
  for (let i = 2; i < out.length; i++) if (out[i] === out[i - 1] && out[i] === out[i - 2]) return false;
  return true;
}

export function applyRule(spec: RuleSpec, w: number[]): number[] {
  let out: number[];
  if (spec.kind === 'sub') {
    if (spec.minVowels && countVowels(w) < spec.minVowels) return w;
    let firstV = -1;
    for (let i = 0; i < w.length; i++) if (isV(w[i])) { firstV = i; break; }
    out = [];
    let changed = false;
    for (let i = 0; i < w.length; i++) {
      const p = w[i];
      let done = false;
      for (const s of spec.subs!) {
        if (s.from !== p) continue;
        if (spec.nonInitial && isV(p) && i === firstV) continue;
        if (!ctxOk(w, i, s.left, s.right)) continue;
        for (const t of s.to) out.push(t);
        done = true;
        changed = true;
        break;
      }
      if (!done) out.push(p);
    }
    if (!changed) return w;
  } else if (spec.kind === 'seq') {
    out = [];
    let changed = false;
    for (let i = 0; i < w.length; i++) {
      let done = false;
      for (const s of spec.seq!) {
        if (w[i] === s.a && w[i + 1] === s.b && ctxOk(w, i + 1, undefined, s.right)) {
          for (const t of s.to) out.push(t);
          i++;
          done = true;
          changed = true;
          break;
        }
      }
      if (!done) out.push(w[i]);
    }
    if (!changed) return w;
  } else if (spec.kind === 'prothesis') {
    if (w.length >= 2 && (sym(w[0]) === 's' || sym(w[0]) === 'ʃ') && isC(w[1])) out = [spec.vowel!, ...w];
    else return w;
  } else {
    out = [];
    let changed = false;
    for (let i = 0; i < w.length; i++) {
      if (i > 0 && isC(w[i]) && w[i] === w[i - 1]) {
        changed = true;
        continue;
      }
      out.push(w[i]);
    }
    if (!changed) return w;
  }
  return acceptable(out, w) ? out : w;
}

/** Phonemes a rule can introduce (for the symbolic inventory closure). */
export function ruleOutputs(spec: RuleSpec): number[] {
  const o: number[] = [];
  for (const s of spec.subs ?? []) o.push(...s.to);
  for (const s of spec.seq ?? []) o.push(...s.to);
  if (spec.vowel !== undefined) o.push(spec.vowel);
  return o;
}

// ------------------------------------------------------------------ generators

export interface GenCtx {
  inv: Set<number>;     // phonemes attested in the current lexicon snapshot
  rng: Rng;
  style: Style;
  lex: number[][];
}

type Gen = (c: GenCtx) => RuleSpec | null;

const S = (s: string) => (hasSym(s) ? P(s) : -1);
const has = (c: GenCtx, s: string) => hasSym(s) && c.inv.has(P(s));
const fmt = (ids: number[]) => ids.map(sym).join(' ');
const inInv = (c: GenCtx, pred: (id: number) => boolean) => [...c.inv].filter(pred).sort((a, b) => a - b);
const shortVowels = (c: GenCtx) => inInv(c, (p) => isV(p) && !PHONS[p].long);
const longVowels = (c: GenCtx) => inInv(c, (p) => isV(p) && PHONS[p].long);
const frontVowels = (c: GenCtx) => inInv(c, (p) => isV(p) && isFront(p));

function subsFromPairs(pairs: [number, number[]][], left?: Matcher[], right?: Matcher[]): Sub[] {
  return pairs.map(([from, to]) => ({ from, to, left, right }));
}

function pairNotation(pairs: [number, number[]][], env: string): string {
  const from = pairs.map((p) => sym(p[0])).join(' ');
  const to = pairs.map((p) => (p[1].length ? p[1].map(sym).join('') : '∅')).join(' ');
  return `${from} > ${to}${env ? ' / ' + env : ''}`;
}

const GENERATORS: Record<string, Gen> = {
  'intervocalic voicing': (c) => {
    const pairs: [number, number[]][] = [];
    for (const p of inInv(c, (p) => isObstruent(p) && !PHONS[p].voice && !PHONS[p].emph && PHONS[p].manner !== 'affricate')) {
      if (sym(p) === 'ʔ' || sym(p) === 'h' || sym(p) === 'ħ') continue;
      const v = voiceFlip(p);
      if (v !== null && (PHONS[p].manner === 'stop' || c.rng.chance(0.5))) pairs.push([p, [v]]);
    }
    if (!pairs.length) return null;
    return { label: 'intervocalic voicing', notation: pairNotation(pairs, 'V_V'), kind: 'sub', subs: subsFromPairs(pairs, ['V'], ['V']) };
  },
  'intervocalic spirantization': (c) => {
    const map: Record<string, string> = { b: 'β', d: 'ð', g: 'ɣ' };
    const pairs: [number, number[]][] = [];
    for (const [a, b] of Object.entries(map)) if (has(c, a)) pairs.push([P(a), [c.rng.chance(0.4) && a === 'b' ? P('v') : P(b)]]);
    if (!pairs.length) return null;
    return { label: 'intervocalic spirantization', notation: pairNotation(pairs, 'V_V'), kind: 'sub', subs: subsFromPairs(pairs, ['V'], ['V']) };
  },
  'postvocalic spirantization': (c) => {
    const map: Record<string, string> = { b: 'v', d: 'ð', g: 'ɣ', p: 'f', t: 'θ', k: 'x' };
    const pairs: [number, number[]][] = [];
    for (const [a, b] of Object.entries(map)) if (has(c, a)) pairs.push([P(a), [P(b)]]);
    if (pairs.length < 2) return null;
    return { label: 'postvocalic spirantization', notation: pairNotation(pairs, 'V_'), kind: 'sub', subs: subsFromPairs(pairs, ['V']) };
  },
  'final devoicing': (c) => {
    const pairs: [number, number[]][] = [];
    for (const p of inInv(c, (p) => isObstruent(p) && PHONS[p].voice)) {
      const v = voiceFlip(p);
      if (v !== null) pairs.push([p, [v]]);
    }
    if (!pairs.length) return null;
    return { label: 'final devoicing', notation: pairNotation(pairs, '_#'), kind: 'sub', subs: subsFromPairs(pairs, undefined, ['#']) };
  },
  apocope: (c) => {
    let vs = shortVowels(c).filter((v) => sym(v) !== 'a');
    if (c.rng.chance(0.25)) vs = shortVowels(c);
    if (vs.length > 2) vs = c.rng.sample(vs, c.rng.int(1, 3)).sort((a, b) => a - b);
    if (!vs.length) return null;
    const pairs: [number, number[]][] = vs.map((v) => [v, []]);
    return { label: 'apocope', notation: pairNotation(pairs, 'VC_#'), kind: 'sub', subs: subsFromPairs(pairs, ['C', 'V'], ['#']), minVowels: 2 };
  },
  syncope: (c) => {
    let vs = shortVowels(c).filter((v) => sym(v) !== 'a' || c.rng.chance(0.3));
    if (vs.length > 2) vs = c.rng.sample(vs, c.rng.int(1, 2)).sort((a, b) => a - b);
    if (!vs.length) return null;
    const pairs: [number, number[]][] = vs.map((v) => [v, []]);
    return { label: 'syncope', notation: pairNotation(pairs, 'VC_CV'), kind: 'sub', subs: subsFromPairs(pairs, ['C', 'V'], ['C', 'V']), minVowels: 3 };
  },
  palatalization: (c) => {
    const fr = frontVowels(c);
    if (!fr.length) return null;
    const options: [string, string][][] = [
      [['k', 'tʃ'], ['g', 'dʒ']],
      [['t', 'ts'], ['d', 'dz']],
      [['s', 'ʃ']],
      [['k', 'tʃ']],
      [['t', 'tʃ'], ['d', 'dʒ']],
    ];
    const opt = c.rng.pick(options).filter(([a]) => has(c, a));
    if (!opt.length) return null;
    const pairs: [number, number[]][] = opt.map(([a, b]) => [P(a), [P(b)]]);
    return { label: 'palatalization', notation: pairNotation(pairs, `_${fr.length > 2 ? '[+front]' : fmt(fr)}`), kind: 'sub', subs: subsFromPairs(pairs, undefined, [fr]) };
  },
  'vowel raising': (c) => {
    const opts: [string, string][][] = [[['e', 'i'], ['o', 'u']], [['eː', 'iː'], ['oː', 'uː']], [['o', 'u']], [['ɛ', 'e'], ['ɔ', 'o']], [['aː', 'ɔ']]];
    const pairs: [number, number[]][] = c.rng.pick(opts).filter(([a]) => has(c, a)).map(([a, b]) => [P(a), [P(b)]]);
    if (!pairs.length) return null;
    return { label: 'vowel raising', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'vowel lowering': (c) => {
    const opts: [string, string][][] = [[['i', 'e'], ['u', 'o']], [['e', 'ɛ']], [['u', 'o']], [['ɨ', 'ə']]];
    const pairs: [number, number[]][] = c.rng.pick(opts).filter(([a]) => has(c, a)).map(([a, b]) => [P(a), [P(b)]]);
    if (!pairs.length) return null;
    // lowering is commonly conditioned by a following coda or a low vowel; use word-final position or before r
    const cond = c.rng.chance(0.5);
    return { label: 'vowel lowering', notation: pairNotation(pairs, cond ? '_C#' : ''), kind: 'sub', subs: subsFromPairs(pairs, undefined, cond ? ['C', '#'] : undefined) };
  },
  'vowel fronting': (c) => {
    const opts: [string, string][][] = [[['u', 'y']], [['a', 'æ']], [['o', 'ø']], [['uː', 'yː']], [['aː', 'eː']]];
    const pairs: [number, number[]][] = c.rng.pick(opts).filter(([a]) => has(c, a)).map(([a, b]) => [P(a), [P(b)]]);
    if (!pairs.length) return null;
    // short vowels front only before a front vowel in the next syllable (i-mutation); long ones shift freely
    const fr = frontVowels(c);
    const conditioned = !PHONS[pairs[0][0]].long && fr.length > 0;
    return {
      label: 'vowel fronting', notation: pairNotation(pairs, conditioned ? '_C[+front]' : ''), kind: 'sub',
      subs: subsFromPairs(pairs, undefined, conditioned ? ['C', fr] : undefined),
    };
  },
  'vowel reduction': (c) => {
    if (!c.inv.has(P('a')) && !c.inv.has(P('e'))) return null;
    let vs = shortVowels(c).filter((v) => sym(v) !== 'ə' && sym(v) !== 'i' && sym(v) !== 'u');
    if (vs.length > 2) vs = c.rng.sample(vs, 2).sort((a, b) => a - b);
    if (!vs.length) return null;
    const pairs: [number, number[]][] = vs.map((v) => [v, [P('ə')]]);
    return { label: 'vowel reduction', notation: pairNotation(pairs, 'C_#'), kind: 'sub', subs: subsFromPairs(pairs, ['C'], ['#']), minVowels: 2 };
  },
  'vowel merger': (c) => {
    const opts: [string, string][] = [['ɛ', 'e'], ['ɔ', 'o'], ['y', 'i'], ['ø', 'e'], ['æ', 'a'], ['ɨ', 'i'], ['ə', 'e'], ['ə', 'a'], ['o', 'u'], ['e', 'i'], ['yː', 'iː'], ['øː', 'eː'], ['æː', 'aː']];
    const avail = opts.filter(([a, b]) => has(c, a) && has(c, b));
    if (!avail.length) return null;
    const [a, b] = c.rng.pick(avail);
    const pairs: [number, number[]][] = [[P(a), [P(b)]]];
    return { label: 'vowel merger', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'loss of h': (c) => {
    if (!has(c, 'h')) return null;
    const pairs: [number, number[]][] = [[P('h'), []]];
    return { label: 'loss of h', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'pharyngeal weakening': (c) => {
    const pairs: [number, number[]][] = [];
    if (has(c, 'ħ')) pairs.push([P('ħ'), [P('h')]]);
    if (has(c, 'ʕ')) pairs.push([P('ʕ'), c.rng.chance(0.5) ? [P('ʔ')] : []]);
    if (has(c, 'χ')) pairs.push([P('χ'), [P('x')]]);
    if (!pairs.length) return null;
    return { label: 'pharyngeal weakening', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'glottal stop loss': (c) => {
    if (!has(c, 'ʔ')) return null;
    const pairs: [number, number[]][] = [[P('ʔ'), []]];
    return { label: 'glottal stop loss', notation: pairNotation(pairs, c.rng.chance(0.5) ? '' : 'V_'), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'nasal assimilation': (c) => {
    if (!has(c, 'n')) return null;
    const labials = inInv(c, (p) => !isV(p) && PHONS[p].place <= 1 && PHONS[p].manner === 'stop');
    const velars = inInv(c, (p) => !isV(p) && (PHONS[p].place === 7 || PHONS[p].place === 8) && PHONS[p].manner === 'stop');
    const subs: Sub[] = [];
    if (labials.length && has(c, 'm')) subs.push({ from: P('n'), to: [P('m')], right: [labials] });
    if (velars.length) subs.push({ from: P('n'), to: [P('ŋ')], right: [velars] });
    if (!subs.length) return null;
    return { label: 'nasal assimilation', notation: `n > m ŋ / _[labial] _[velar]`, kind: 'sub', subs };
  },
  'regressive assimilation': (c) => {
    const stops = inInv(c, (p) => !isV(p) && PHONS[p].manner === 'stop' && !PHONS[p].voice && sym(p) !== 'ʔ');
    if (stops.length < 2) return null;
    const target = c.rng.pick(stops.filter((s) => sym(s) === 't').concat(stops));
    const subs: Sub[] = stops.filter((s) => s !== target).map((s) => ({ from: s, to: [target], right: [[target]] }));
    return { label: 'regressive assimilation', notation: `${fmt(stops.filter((s) => s !== target))} > ${sym(target)} / _${sym(target)}`, kind: 'sub', subs };
  },
  degemination: () => ({ label: 'degemination', notation: 'CᵢCᵢ > Cᵢ', kind: 'degemination' }),
  rhotacism: (c) => {
    const src = has(c, 'z') ? 'z' : has(c, 's') ? 's' : null;
    if (!src || !has(c, 'r')) return null;
    const pairs: [number, number[]][] = [[P(src), [P('r')]]];
    return { label: 'rhotacism', notation: pairNotation(pairs, 'V_V'), kind: 'sub', subs: subsFromPairs(pairs, ['V'], ['V']) };
  },
  'l-vocalization': (c) => {
    if (!has(c, 'l')) return null;
    const to = c.rng.chance(0.6) ? P('w') : P('u');
    return {
      label: 'l-vocalization', notation: `l > ${sym(to)} / V_C`, kind: 'sub',
      subs: [{ from: P('l'), to: [to], left: ['V'], right: ['C'] }],
    };
  },
  prothesis: (c) => {
    if (!has(c, 's')) return null;
    const v = has(c, 'e') ? P('e') : has(c, 'i') ? P('i') : null;
    if (v === null) return null;
    return { label: 'prothesis', notation: `∅ > ${sym(v)} / #_sC`, kind: 'prothesis', vowel: v };
  },
  spirantization: (c) => {
    const opts: [string, string][] = [['p', 'f'], ['k', 'x'], ['t', 'θ'], ['b', 'v'], ['p', 'h'], ['g', 'ɣ']];
    const avail = opts.filter(([a]) => has(c, a));
    if (!avail.length) return null;
    const [a, b] = c.rng.pick(avail);
    const pairs: [number, number[]][] = [[P(a), [P(b)]]];
    return { label: 'spirantization', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'labiovelar shift': (c) => {
    const pairs: [number, number[]][] = [];
    const toP = c.rng.chance(0.5);
    if (has(c, 'kʷ')) pairs.push([P('kʷ'), toP ? [P('p')] : [P('k')]]);
    if (has(c, 'gʷ')) pairs.push([P('gʷ'), toP ? [P('b')] : [P('g')]]);
    if (!pairs.length) return null;
    return { label: 'labiovelar shift', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'glide formation': (c) => {
    const subs: Sub[] = [];
    if (has(c, 'i')) subs.push({ from: P('i'), to: [P('j')], left: ['C'], right: ['V'] });
    if (has(c, 'u')) subs.push({ from: P('u'), to: [P('w')], left: ['C'], right: ['V'] });
    if (!subs.length) return null;
    return { label: 'glide formation', notation: 'i u > j w / C_V', kind: 'sub', subs };
  },
  's-debuccalization': (c) => {
    if (!has(c, 's')) return null;
    const initial = c.rng.chance(0.5);
    return {
      label: 's-debuccalization', notation: initial ? 's > h / #_V' : 's > h / V_V', kind: 'sub',
      subs: [{ from: P('s'), to: [P('h')], left: initial ? ['#'] : ['V'], right: ['V'] }],
    };
  },
  'emphatic loss': (c) => {
    const pairs: [number, number[]][] = [];
    if (has(c, 'tˤ')) pairs.push([P('tˤ'), [P('t')]]);
    if (has(c, 'sˤ')) pairs.push([P('sˤ'), [c.rng.chance(0.5) ? P('ts') : P('s')]]);
    if (has(c, 'q') && c.rng.chance(0.5)) pairs.push([P('q'), [P('k')]]);
    if (!pairs.length) return null;
    return { label: 'emphatic loss', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  deaffrication: (c) => {
    const opts: [string, string][] = [['tʃ', 'ʃ'], ['ts', 's'], ['dʒ', 'ʒ'], ['dz', 'z'], ['tɬ', 'l'], ['tʃ', 'ts']];
    const avail = opts.filter(([a]) => has(c, a));
    if (!avail.length) return null;
    const [a, b] = c.rng.pick(avail);
    const pairs: [number, number[]][] = [[P(a), [P(b)]]];
    return { label: 'deaffrication', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'w-fortition': (c) => {
    if (!has(c, 'w')) return null;
    const to = c.rng.chance(0.7) ? P('v') : P('b');
    return {
      label: 'w-fortition', notation: `w > ${sym(to)} / [# V]_V`, kind: 'sub',
      subs: [{ from: P('w'), to: [to], left: ['#'], right: ['V'] }, { from: P('w'), to: [to], left: ['V'], right: ['V'] }],
    };
  },
  'final consonant loss': (c) => {
    const cands = inInv(c, (p) => isC(p) && ['m', 'n', 's', 't', 'd', 'k', 'ʔ', 'h', 'r'].includes(sym(p)));
    if (!cands.length) return null;
    const pick = c.rng.sample(cands, c.rng.int(1, Math.min(3, cands.length)));
    const pairs: [number, number[]][] = pick.map((p) => [p, []]);
    return { label: 'final consonant loss', notation: pairNotation(pairs, 'V_#'), kind: 'sub', subs: subsFromPairs(pairs, ['V'], ['#']), minVowels: 1 };
  },
  monophthongization: (c) => {
    const seq: { a: number; b: number; to: number[]; right?: Matcher[] }[] = [];
    if (has(c, 'a') && has(c, 'j')) seq.push({ a: P('a'), b: P('j'), to: [has(c, 'eː') ? P('eː') : P('e')] });
    if (has(c, 'a') && has(c, 'w')) seq.push({ a: P('a'), b: P('w'), to: [has(c, 'oː') ? P('oː') : P('o')] });
    if (!seq.length) return null;
    // only before consonants or word end
    for (const s of seq) s.right = [c.rng.chance(0.5) ? 'C' : 'C'];
    return { label: 'monophthongization', notation: 'aj aw > e o / _C', kind: 'seq', seq };
  },
  umlaut: (c) => {
    const fr = inInv(c, (p) => sym(p) === 'i' || sym(p) === 'j' || sym(p) === 'iː');
    if (!fr.length) return null;
    const pairs: [number, number[]][] = [];
    if (has(c, 'a')) pairs.push([P('a'), [P('e')]]);
    if (has(c, 'o')) pairs.push([P('o'), [c.rng.chance(0.6) ? P('ø') : P('e')]]);
    if (has(c, 'u')) pairs.push([P('u'), [c.rng.chance(0.6) ? P('y') : P('i')]]);
    if (!pairs.length) return null;
    return { label: 'umlaut', notation: pairNotation(pairs, '_C[i j]'), kind: 'sub', subs: subsFromPairs(pairs, undefined, ['C', fr]) };
  },
  'vowel length loss': (c) => {
    const ls = longVowels(c);
    if (!ls.length) return null;
    const pairs: [number, number[]][] = ls.map((v) => [v, [lengthFlip(v) ?? v]]);
    return { label: 'vowel length loss', notation: 'Vː > V', kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'open-syllable lengthening': (c) => {
    const vs = shortVowels(c).filter((v) => lengthFlip(v) !== null && ['a', 'e', 'o'].includes(sym(v)));
    if (!vs.length) return null;
    const pairs: [number, number[]][] = vs.map((v) => [v, [lengthFlip(v)!]]);
    return { label: 'open-syllable lengthening', notation: pairNotation(pairs, '#C_CV'), kind: 'sub', subs: subsFromPairs(pairs, ['C', '#'], ['C', 'V']) };
  },
  breaking: (c) => {
    const subs: Sub[] = [];
    if (has(c, 'e') && has(c, 'j')) subs.push({ from: P('e'), to: [P('j'), P('e')], left: ['C', '#'] });
    if (has(c, 'o') && has(c, 'w')) subs.push({ from: P('o'), to: [P('w'), P('e')], left: ['C', '#'] });
    if (!subs.length) return null;
    return { label: 'breaking', notation: 'e o > je we / #C_', kind: 'sub', subs };
  },
  debuccalization: (c) => {
    const opts: [string, string][] = [['k', 'ʔ'], ['t', 'k'], ['s', 'h'], ['f', 'h']];
    const avail = opts.filter(([a]) => has(c, a));
    if (!avail.length) return null;
    const [a, b] = c.rng.pick(avail);
    if (a === 't' && has(c, 'k')) return null; // only after k has moved
    const pairs: [number, number[]][] = [[P(a), [P(b)]]];
    // The label stays 'debuccalization' even for t > k: rule selection keys on labels, so renaming it would
    // change which laws every language acquires and therefore every name in the archive.
    return { label: 'debuccalization', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'retroflex merger': (c) => {
    const map: [string, string][] = [['ʈ', 't'], ['ɖ', 'd'], ['ɳ', 'n'], ['ɭ', 'l'], ['ʂ', 'ʃ'], ['ɻ', 'r']];
    const pairs: [number, number[]][] = map.filter(([a]) => has(c, a)).map(([a, b]) => [P(a), [P(b)]]);
    if (pairs.length < 2) return null;
    return { label: 'retroflex merger', notation: pairNotation(pairs, ''), kind: 'sub', subs: subsFromPairs(pairs) };
  },
  'cluster simplification': (c) => {
    const subs: Sub[] = [];
    for (const p of inInv(c, (p) => isC(p) && (PHONS[p].manner === 'stop'))) subs.push({ from: p, to: [], left: ['C'], right: ['C'] });
    if (!subs.length) return null;
    return { label: 'cluster simplification', notation: 'C > ∅ / C_C', kind: 'sub', subs };
  },
};

export const RULE_LABELS = Object.keys(GENERATORS);

const BASE_WEIGHT: Record<string, number> = {
  'intervocalic voicing': 1.3, 'intervocalic spirantization': 0.6, 'postvocalic spirantization': 0.35,
  'final devoicing': 0.9, apocope: 1.0, syncope: 0.8, palatalization: 1.2, 'vowel raising': 1, 'vowel lowering': 0.6,
  'vowel fronting': 0.6, 'vowel reduction': 0.35, 'vowel merger': 1.1, 'loss of h': 0.8, 'pharyngeal weakening': 0.6,
  'glottal stop loss': 0.6, 'nasal assimilation': 0.9, 'regressive assimilation': 0.7, degemination: 0.7,
  rhotacism: 0.4, 'l-vocalization': 0.4, prothesis: 0.4, spirantization: 0.4, 'labiovelar shift': 0.8,
  'glide formation': 0.5, 's-debuccalization': 0.35, 'emphatic loss': 0.7, deaffrication: 0.6, 'w-fortition': 0.5,
  'final consonant loss': 0.8, monophthongization: 0.7, umlaut: 0.35, 'vowel length loss': 0.6,
  'open-syllable lengthening': 0.4, breaking: 0.35, debuccalization: 0.25, 'retroflex merger': 0.4,
  'cluster simplification': 0.6,
};

/** Propose a sound change that meaningfully affects the lexicon, or null. */
export function proposeRule(c: GenCtx, usedLabels: Map<string, number>): RuleSpec | null {
  const labels = RULE_LABELS;
  const weights = labels.map((l) => (BASE_WEIGHT[l] ?? 0.5) * (c.style.ruleBias[l] ?? 1) * Math.pow(0.3, usedLabels.get(l) ?? 0));
  const before = new Set(c.lex.map(key));
  for (let attempt = 0; attempt < 14; attempt++) {
    const label = c.rng.weighted(labels, weights);
    const spec = GENERATORS[label](c);
    if (!spec) continue;
    let changed = 0;
    const after = new Set<string>();
    for (const w of c.lex) {
      const o = applyRule(spec, w);
      if (o !== w) changed++;
      after.add(key(o));
    }
    const minChanged = Math.max(3, Math.floor(c.lex.length * 0.012));
    if (changed < minChanged) continue;
    if (changed > c.lex.length * 0.75 && spec.kind === 'sub' && spec.subs!.some((s) => s.to.length === 0)) continue;
    const merged = before.size - after.size;
    const tolerance = label === 'vowel merger' || label === 'vowel length loss' ? 0.07 : 0.035;
    if (merged > c.lex.length * tolerance) continue;
    return spec;
  }
  return null;
}
