// Romanization: one uniform scholarly system, a per-language conventional orthography,
// IPA, and script-faithful transliteration (syllabary, abjad, alphabet, logograms).

import type { Rng } from '../core/rng.ts';
import { PHONS, isV, isC, sym, shortOf } from './phonology.ts';
import type { Style } from './phonology.ts';

const SCHOLARLY: Record<string, string> = {
  p: 'p', b: 'b', t: 't', d: 'd', 'ʈ': 'ṭ', 'ɖ': 'ḍ', k: 'k', g: 'g', 'kʷ': 'kʷ', 'gʷ': 'gʷ', q: 'q', 'ʔ': 'ʾ',
  'tˤ': 'ṭ', 'ɸ': 'φ', 'β': 'ḇ', f: 'f', v: 'v', 'θ': 'ṯ', 'ð': 'ḏ', s: 's', z: 'z', 'sˤ': 'ṣ', 'ʃ': 'š', 'ʒ': 'ž',
  'ʂ': 'ş', x: 'ḫ', 'ɣ': 'ġ', 'χ': 'ẖ', 'ħ': 'ḥ', 'ʕ': 'ʿ', h: 'h', ts: 'c', dz: 'ʒ', 'tʃ': 'č', 'dʒ': 'ǧ', 'tɬ': 'ƛ',
  m: 'm', n: 'n', 'ɳ': 'ṇ', 'ɲ': 'ñ', 'ŋ': 'ŋ', l: 'l', 'ɭ': 'ḷ', 'ʎ': 'ľ', r: 'r', 'ɻ': 'ṛ', j: 'y', w: 'w',
  i: 'i', y: 'ü', 'ɨ': 'ɨ', u: 'u', e: 'e', 'ø': 'ö', 'ə': 'ə', o: 'o', 'ɛ': 'ę', 'ɔ': 'ǫ', 'æ': 'ä', a: 'a',
  'iː': 'ī', 'yː': 'ǖ', 'uː': 'ū', 'eː': 'ē', 'øː': 'ȫ', 'oː': 'ō', 'æː': 'ǟ', 'aː': 'ā',
};

const CONV_DEFAULT: Record<string, string> = {
  p: 'p', b: 'b', t: 't', d: 'd', 'ʈ': 't', 'ɖ': 'd', k: 'k', g: 'g', 'kʷ': 'kw', 'gʷ': 'gw', q: 'q', 'ʔ': '',
  'tˤ': 't', 'ɸ': 'f', 'β': 'v', f: 'f', v: 'v', 'θ': 'th', 'ð': 'dh', s: 's', z: 'z', 'sˤ': 's', 'ʃ': 'sh', 'ʒ': 'zh',
  'ʂ': 'sh', x: 'kh', 'ɣ': 'gh', 'χ': 'kh', 'ħ': 'h', 'ʕ': '', h: 'h', ts: 'ts', dz: 'dz', 'tʃ': 'ch', 'dʒ': 'j',
  'tɬ': 'tl', m: 'm', n: 'n', 'ɳ': 'n', 'ɲ': 'ny', 'ŋ': 'ng', l: 'l', 'ɭ': 'l', 'ʎ': 'ly', r: 'r', 'ɻ': 'r', j: 'y', w: 'w',
  i: 'i', y: 'ü', 'ɨ': 'y', u: 'u', e: 'e', 'ø': 'ö', 'ə': 'e', o: 'o', 'ɛ': 'e', 'ɔ': 'o', 'æ': 'ae', a: 'a',
};

const CIRC: Record<string, string> = { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û' };
const ACUTE: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };

export interface Orthography {
  map: Record<string, string>;   // IPA symbol -> grapheme (short vowels and consonants)
  long: 'double' | 'plain' | 'circumflex' | 'acute';
  hispanicK: boolean;
  jMedial: string;               // glide j between a consonant and a vowel ("mie" vs "mye")
  wMedial: string;               // glide w between a consonant and a vowel ("tuelo" vs "twelo")
}

export function makeOrthography(style: Style, rng: Rng, parent?: Orthography): Orthography {
  const map: Record<string, string> = { ...CONV_DEFAULT };
  for (const [s, opts] of Object.entries(style.ortho)) {
    if (s === 'k') continue;
    map[s] = rng.weighted(opts.map((o) => o[0]), opts.map((o) => o[1]));
  }
  if (!style.ortho['ð']) map['ð'] = rng.weighted(['d', 'dh', 'th'], [5, 2, 1]);
  if (!style.ortho['β']) map['β'] = rng.weighted(['b', 'v'], [4, 3]);
  if (!style.ortho['ɣ']) map['ɣ'] = rng.weighted(['g', 'gh'], [5, 2]);
  if (!style.ortho['æ']) map['æ'] = rng.weighted(['e', 'ä', 'ae'], [4, 3, 1]);
  if (!style.ortho['ɛ']) map['ɛ'] = rng.weighted(['e', 'è'], [5, 1]);
  if (!style.ortho['ɔ']) map['ɔ'] = rng.weighted(['o', 'ò', 'aw'], [5, 1, 1]);
  let long = rng.weighted(style.longVowelStyle.map((o) => o[0]), style.longVowelStyle.map((o) => o[1])) as Orthography['long'];
  let hispanicK = !!style.ortho.k && rng.chance(0.6);
  let jMedial = rng.chance(0.65) ? 'i' : map.j;
  let wMedial = rng.chance(0.6) ? 'u' : map.w;
  if (parent) {
    // daughters inherit most conventions, re-rolling a few
    for (const s of Object.keys(map)) if (!rng.chance(0.3)) map[s] = parent.map[s];
    if (!rng.chance(0.3)) long = parent.long;
    if (!rng.chance(0.3)) hispanicK = parent.hispanicK;
    if (!rng.chance(0.3)) jMedial = parent.jMedial;
    if (!rng.chance(0.3)) wMedial = parent.wMedial;
  }
  // a glide and a vowel must not share a letter
  if (map.j === 'y') {
    if (map.y === 'y') map.y = 'ü';
    if (map['ɨ'] === 'y') map['ɨ'] = 'i';
  }
  if (map.j === 'j' && map['dʒ'] === 'j') map['dʒ'] = 'dj';
  return { map, long, hispanicK, jMedial, wMedial };
}

function convVowel(id: number, o: Orthography): string {
  const p = PHONS[id];
  if (!p.long) return o.map[p.sym] ?? CONV_DEFAULT[p.sym] ?? p.sym;
  const base = o.map[sym(shortOf(id))] ?? CONV_DEFAULT[sym(shortOf(id))] ?? 'a';
  if (base.length > 1 || o.long === 'plain') return base;
  if (o.long === 'double') return base + base;
  if (o.long === 'circumflex') return CIRC[base] ?? base;
  return ACUTE[base] ?? base;
}

export function conventional(w: number[], o: Orthography, asName: boolean): string {
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const id = w[i];
    if (asName && i === 0 && (sym(id) === 'ʔ' || sym(id) === 'ʕ')) continue;
    let g: string;
    if (isV(id)) g = convVowel(id, o);
    else if (o.hispanicK && sym(id) === 'k') {
      const nx = w[i + 1];
      g = nx !== undefined && isV(nx) && PHONS[nx].back === 0 ? 'qu' : 'c';
    } else if (sym(id) === 'ŋ' && i + 1 < w.length && (sym(w[i + 1]) === 'g' || sym(w[i + 1]) === 'k' || sym(w[i + 1]) === 'x' || sym(w[i + 1]) === 'ɣ')) {
      g = 'n';
    } else if (sym(id) === 'j' && i > 0 && isC(w[i - 1]) && i + 1 < w.length && isV(w[i + 1]) && sym(w[i + 1]) !== 'i' && sym(w[i + 1]) !== 'iː') {
      g = o.jMedial;
    } else if (sym(id) === 'w' && i > 0 && isC(w[i - 1]) && i + 1 < w.length && isV(w[i + 1]) && sym(w[i + 1]) !== 'u' && sym(w[i + 1]) !== 'uː') {
      g = o.wMedial;
    } else g = o.map[sym(id)] ?? CONV_DEFAULT[sym(id)] ?? sym(id);
    // geminate digraphs: "shsh" -> "ssh"
    if (i > 0 && w[i - 1] === id && isC(id) && g.length > 1) g = g[0];
    // avoid apostrophes next to word edges and doubled apostrophes
    if (g === "'" && (i === w.length - 1 || out.endsWith("'"))) g = '';
    out += g;
  }
  // Avoid an ugly triple letter.
  out = out.replace(/(.)\1\1+/g, '$1$1');
  return asName ? capitalize(out) : out;
}

export function scholarly(w: number[], asName: boolean): string {
  let out = '';
  for (const id of w) out += SCHOLARLY[sym(id)] ?? sym(id);
  return asName ? capitalize(out) : out;
}

export function scholarlyOf(id: number): string {
  return SCHOLARLY[sym(id)] ?? sym(id);
}

export function ipa(w: number[]): string {
  return w.map(sym).join('');
}

export function capitalize(s: string): string {
  if (!s) return s;
  const m = s.match(/^(['ʾʿ]*)(.)(.*)$/su);
  if (!m) return s;
  return m[1] + m[2].toLocaleUpperCase() + m[3];
}

// ------------------------------------------------------------------ scripts

/** Split a phoneme string into syllables: onset, nucleus, coda. */
export function syllabify(w: number[]): { onset: number[]; v: number; coda: number[] }[] {
  const vIdx: number[] = [];
  for (let i = 0; i < w.length; i++) if (isV(w[i])) vIdx.push(i);
  if (!vIdx.length) return [{ onset: w.slice(), v: -1, coda: [] }];
  const syl: { onset: number[]; v: number; coda: number[] }[] = [];
  for (let k = 0; k < vIdx.length; k++) {
    const vi = vIdx[k];
    const prevEnd = k === 0 ? 0 : vIdx[k - 1] + 1;
    const cons = w.slice(prevEnd, vi);
    let onset: number[];
    if (k === 0) onset = cons;
    else if (cons.length <= 1) onset = cons;
    else {
      // first consonant closes the previous syllable
      syl[k - 1].coda.push(cons[0]);
      onset = cons.slice(1);
    }
    syl.push({ onset, v: w[vi], coda: [] });
  }
  const last = vIdx[vIdx.length - 1];
  syl[syl.length - 1].coda.push(...w.slice(last + 1));
  return syl;
}

/** Cuneiform-style syllabic spelling: ka-du-ru-um, plene for long vowels, echo vowels for clusters. */
export function syllabicSpelling(w: number[]): string {
  const signs: string[] = [];
  for (const s of syllabify(w)) {
    if (s.v < 0) {
      signs.push(s.onset.map(scholarlyOf).join(''));
      continue;
    }
    const vs = scholarlyOf(shortOf(s.v));
    for (let i = 0; i < s.onset.length - 1; i++) signs.push(scholarlyOf(s.onset[i]) + vs);
    const on = s.onset.length ? scholarlyOf(s.onset[s.onset.length - 1]) : '';
    const long = PHONS[s.v].long;
    const firstCoda = s.coda.length ? scholarlyOf(s.coda[0]) : '';
    if (long) {
      signs.push(on + vs);
      signs.push(vs + firstCoda);
    } else {
      signs.push(on + vs + firstCoda);
    }
    for (let i = 1; i < s.coda.length; i++) signs.push(vs + scholarlyOf(s.coda[i]));
  }
  return signs.join('-');
}

/** Consonantal (abjad) spelling with matres lectionis for long and final vowels. */
export function abjadSpelling(w: number[]): string {
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const id = w[i];
    if (isC(id)) {
      out += scholarlyOf(id);
      continue;
    }
    const s = sym(shortOf(id));
    const long = PHONS[id].long;
    const final = i === w.length - 1;
    if (i === 0) out += 'ʾ';
    if (long || final) {
      if (s === 'i' || s === 'e') out += 'y';
      else if (s === 'u' || s === 'o') out += 'w';
      else if (final) out += 'h';
      else out += 'ʾ';
    }
  }
  return out;
}

export const DETERMINATIVES: Record<string, { pre?: string; post?: string }> = {
  deity: { pre: 'ᵈ' },
  person: { pre: 'ᵐ' },
  land: { pre: 'ᵏᵘʳ' },
  place: { post: 'ᵏⁱ' },
  metal: { pre: 'ᵘʳᵘᵈᵘ' },
  wood: { pre: 'ᵍⁱˢ' },
};
