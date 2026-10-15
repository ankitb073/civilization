// Name coinage: per-kind, per-style patterns producing native-looking names with
// recoverable meanings (descriptive toponyms, theophoric personal names, calendrical
// names, compounds). Forms are produced in the language's phonology *at the coinage year*.

import type { Rng } from '../core/rng.ts';
import { conceptDef } from './concepts.ts';
import type { Concept } from './concepts.ts';
import { isV, join } from './phonology.ts';
import type { Style } from './phonology.ts';
import type { Affix } from './morphology.ts';
import type { NameId, NameKind } from './types.ts';
import { pluralize } from './english.ts';

export interface CoinCtx {
  style: Style;
  rng: Rng;
  kind: NameKind;
  word: (c: Concept) => number[];
  deriv: (slot: string) => Affix | null;
  root: (nSyl: number) => number[];
  name: (id: NameId) => number[][];
  nameEn: (id: NameId) => string;
  ep: number;
  meaning?: Concept[];
  parts?: (Concept | NameId)[];
}

export interface Coined { segs: number[][]; joiner: '' | '-' | ' '; meaning: string | null }

const PLACE_NOUNS = ['city', 'town', 'wall', 'gate', 'house', 'hill', 'field', 'ford', 'spring', 'harbor', 'mouth', 'well', 'rock', 'tower', 'fortress', 'island', 'valley', 'plain', 'bay', 'marsh', 'village', 'market', 'bridge'];
const PLACE_ADJS = ['white', 'black', 'red', 'green', 'new', 'old', 'high', 'great', 'holy', 'golden', 'far', 'low', 'wide', 'deep', 'bright', 'cold', 'hot', 'first', 'strong'];
const PLACE_THINGS = ['reed', 'salt', 'oak', 'cedar', 'eagle', 'bull', 'horse', 'stone', 'fish', 'sheep', 'barley', 'copper', 'silver', 'snake', 'raven', 'wolf', 'honey', 'flower', 'wine', 'ash'];
const RIVER_ADJS = ['white', 'black', 'red', 'great', 'swift', 'deep', 'wide', 'cold', 'bitter', 'sweet', 'green', 'blue', 'silent', 'golden', 'long', 'holy'];
const SEA_ADJS = ['great', 'bitter', 'dark', 'green', 'blue', 'white', 'black', 'cold', 'wide', 'silent', 'red', 'eternal'];
const NATURE_DEITY = ['sun', 'moon', 'storm', 'sky', 'sea', 'earth', 'fire', 'dawn', 'thunder', 'river', 'star', 'night', 'wind', 'harvest', 'death', 'spring'];
const MALE_STEMS = ['strong', 'brave', 'wise', 'bright', 'lion', 'bull', 'wolf', 'eagle', 'glory', 'fame', 'lord', 'shield', 'sword', 'spear', 'son', 'gift', 'king', 'hero', 'stone', 'fire', 'iron', 'just', 'swift', 'oak', 'bear', 'horse', 'storm', 'thunder', 'brother', 'victory'];
const FEMALE_STEMS = ['bright', 'beautiful', 'flower', 'star', 'moon', 'dawn', 'sweet', 'pure', 'gift', 'daughter', 'light', 'honey', 'spring', 'reed', 'song', 'wise', 'green', 'golden', 'queen', 'lady', 'mercy', 'sister', 'rain', 'eagle', 'just'];
const THEO_PRED = ['protect', 'give', 'bless', 'great', 'just', 'strong', 'know', 'hear', 'see', 'love', 'eternal', 'rule', 'return', 'bright'];
const THEO_HEAD = ['servant', 'gift', 'son', 'daughter', 'light'];
const CAL_SIGNS = ['rain', 'wind', 'reed', 'eagle', 'snake', 'flower', 'deer', 'fire', 'stone', 'death', 'water', 'dog', 'house', 'star', 'storm', 'raven'];
const NUMERALS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const VIRTUE = ['bright', 'just', 'wise', 'pure', 'golden', 'eternal', 'peace', 'truth', 'jade', 'spring', 'swift', 'strong', 'brave', 'green', 'silent', 'mercy', 'light', 'dawn'].filter((c) => c !== 'jade');
const MOVEMENT_NOUNS = ['path', 'truth', 'light', 'wheel', 'word', 'law', 'faith', 'reason', 'wisdom', 'order', 'freedom', 'justice', 'heaven', 'spirit', 'fire'];
const MOVEMENT_ADJS = ['eternal', 'pure', 'new', 'true', 'holy', 'first', 'bright', 'free', 'just', 'old', 'great', 'silent', 'golden'];

function en(c: Concept): string {
  return conceptDef(c).en;
}
function enPlural(c: Concept): string {
  const d = conceptDef(c);
  return d.mass ? d.en : pluralize(c);
}
function thirdSg(c: Concept): string {
  const d = conceptDef(c);
  if (d.pos === 'adj') return 'is ' + d.en;
  const w = d.en;
  if (/(s|sh|ch|x|z|o)$/.test(w)) return w + 'es';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
}

/** Keep at most `maxSyl` syllables (a closing coda consonant is kept). */
export function clip(w: number[], maxSyl: number): number[] {
  let seen = 0;
  for (let i = 0; i < w.length; i++) {
    if (isV(w[i])) {
      seen++;
      if (seen === maxSyl) {
        // keep a single following consonant if followed by another consonant or end
        let end = i + 1;
        if (end < w.length && !isV(w[end]) && (end + 1 >= w.length || !isV(w[end + 1]))) end++;
        return w.slice(0, end);
      }
    }
  }
  return w;
}

function sylCount(w: number[]): number {
  let n = 0;
  for (const p of w) if (isV(p)) n++;
  return n;
}

function applyDeriv(w: number[], a: Affix | null, ep: number): number[] {
  if (!a) return w;
  return a.pos === 'pre' ? join(a.form, w, ep) : join(w, a.form, ep);
}

function fuse(parts: number[][], ep: number): number[] {
  let out: number[] = [];
  for (const p of parts) out = join(out, p, ep);
  return out;
}

function opaque(ctx: CoinCtx, weights: [number, number][]): number[] {
  const n = ctx.rng.weighted(weights.map((x) => x[0]), weights.map((x) => x[1]));
  return ctx.root(n);
}

/** Modifier + head in the style's order, fused or joined. */
function modHead(ctx: CoinCtx, mod: number[], head: number[], joiner: '' | '-' | ' ', maxSyl = 2): number[][] {
  const m = clip(mod, maxSyl);
  const h = clip(head, maxSyl);
  const ordered = ctx.style.adjOrder === 'pre' ? [m, h] : [h, m];
  return joiner === '' ? [fuse(ordered, ctx.ep)] : ordered;
}

function capWords(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function coin(ctx: CoinCtx): Coined {
  const { rng, style, kind } = ctx;
  const ep = ctx.ep;
  const nameJoin = style.nameJoin;
  const personJoin = style.personJoin;

  // Explicit parts: concepts and names, in semantic order (modifier first).
  if (ctx.parts && ctx.parts.length) {
    const pieces: number[][] = [];
    const glosses: string[] = [];
    for (const p of ctx.parts) {
      if (typeof p === 'number') {
        const segs = ctx.name(p);
        pieces.push(...segs.map((s) => clip(s, 3)));
        glosses.push(ctx.nameEn(p));
      } else {
        pieces.push(clip(ctx.word(p), 2));
        glosses.push(en(p));
      }
    }
    const isPerson = kind === 'person-m' || kind === 'person-f';
    const joiner: '' | '-' | ' ' = isPerson ? personJoin : nameJoin;
    let segs = joiner === '' ? [fuse(pieces, ep)] : pieces;
    // Theophoric person names: deity + predicate reads as a sentence.
    let meaning = glosses.join(' ');
    if (isPerson && ctx.parts.length === 2 && typeof ctx.parts[0] === 'number' && typeof ctx.parts[1] === 'string') {
      meaning = `${glosses[0]} ${thirdSg(ctx.parts[1] as Concept)}`;
    } else if (ctx.parts.length === 2 && typeof ctx.parts[0] === 'string' && typeof ctx.parts[1] === 'number') {
      meaning = conceptDef(ctx.parts[0] as Concept).pos === 'adj' ? `${glosses[0]} ${glosses[1]}` : `${glosses[0]} of ${glosses[1]}`;
    }
    if (kind === 'polity' || kind === 'region') {
      const d = ctx.deriv('place');
      if (d && rng.chance(0.5)) segs = [...segs.slice(0, -1), applyDeriv(segs[segs.length - 1], d, ep)];
    }
    if (kind === 'people') {
      const d = ctx.deriv('people');
      if (d) segs = [...segs.slice(0, -1), applyDeriv(segs[segs.length - 1], d, ep)];
      meaning = `people of ${glosses.join(' ')}`;
    }
    if (kind === 'dynasty' || kind === 'house') meaning = `house of ${glosses.join(' ')}`;
    return { segs, joiner, meaning };
  }

  // Explicit meaning: compound of concepts in semantic order (modifier first).
  if (ctx.meaning && ctx.meaning.length) {
    const words = ctx.meaning.map((c) => ctx.word(c));
    let segs: number[][];
    if (words.length === 1) segs = [words[0]];
    else if (words.length === 2) segs = modHead(ctx, words[0], words[1], kind === 'deity' || kind === 'movement' ? '' : nameJoin);
    else segs = [fuse(words.map((w) => clip(w, 2)), ep)];
    const m = ctx.meaning.map(en).join(' ');
    return { segs, joiner: nameJoin, meaning: m };
  }

  switch (kind) {
    case 'settlement': {
      const r = rng.next();
      if (r < 0.28) {
        const adj = rng.pick(PLACE_ADJS);
        const noun = rng.pick(PLACE_NOUNS);
        return { segs: modHead(ctx, ctx.word(adj), ctx.word(noun), nameJoin), joiner: nameJoin, meaning: `${en(adj)} ${en(noun)}` };
      }
      if (r < 0.42) {
        const thing = rng.pick(PLACE_THINGS);
        const d = ctx.deriv('place');
        if (d) return { segs: [applyDeriv(clip(ctx.word(thing), 2), d, ep)], joiner: nameJoin, meaning: `place of ${enPlural(thing)}` };
        const noun = rng.pick(PLACE_NOUNS);
        return { segs: modHead(ctx, ctx.word(thing), ctx.word(noun), nameJoin), joiner: nameJoin, meaning: `${en(thing)} ${en(noun)}` };
      }
      let w = opaque(ctx, style.id === 'sin' ? [[2, 1]] : [[2, 6], [3, 2]]);
      const d = ctx.deriv('place');
      if (d && rng.chance(0.45) && sylCount(w) <= 2) w = applyDeriv(w, d, ep);
      return { segs: [w], joiner: nameJoin, meaning: null };
    }
    case 'region': {
      const r = rng.next();
      if (r < 0.35) {
        const adj = rng.pick(['high', 'low', 'wide', 'green', 'red', 'black', 'white', 'far', 'golden', 'cold', 'hot', 'old', 'holy']);
        const noun = rng.pick(['land', 'plain', 'coast', 'steppe', 'valley', 'desert', 'forest', 'marsh', 'field']);
        return { segs: modHead(ctx, ctx.word(adj), ctx.word(noun), nameJoin), joiner: nameJoin, meaning: `${en(adj)} ${en(noun)}` };
      }
      let w = opaque(ctx, [[2, 6], [3, 3]]);
      const d = ctx.deriv('place');
      if (d && rng.chance(0.5)) w = applyDeriv(w, d, ep);
      return { segs: [w], joiner: nameJoin, meaning: null };
    }
    case 'river': {
      if (rng.chance(0.3)) {
        const adj = rng.pick(RIVER_ADJS);
        const noun = rng.chance(0.6) ? 'river' : 'water';
        return { segs: modHead(ctx, ctx.word(adj), ctx.word(noun), ''), joiner: '', meaning: `${en(adj)} ${en(noun)}` };
      }
      return { segs: [opaque(ctx, [[1, 2], [2, 6], [3, 2]])], joiner: '', meaning: null };
    }
    case 'mountain': {
      if (rng.chance(0.45)) {
        const adj = rng.pick(['white', 'black', 'red', 'high', 'holy', 'cold', 'great', 'old', 'golden', 'silent', 'far']);
        const noun = rng.pick(['mountain', 'rock', 'hill', 'stone']);
        return { segs: modHead(ctx, ctx.word(adj), ctx.word(noun), nameJoin), joiner: nameJoin, meaning: `${en(adj)} ${en(noun)}` };
      }
      return { segs: [opaque(ctx, [[2, 6], [3, 2]])], joiner: '', meaning: null };
    }
    case 'sea': {
      if (rng.chance(0.7)) {
        const adj = rng.pick(SEA_ADJS);
        const noun = rng.chance(0.75) ? 'sea' : 'water';
        return { segs: modHead(ctx, ctx.word(adj), ctx.word(noun), nameJoin === '-' ? '-' : ''), joiner: nameJoin, meaning: `${en(adj)} ${en(noun)}` };
      }
      return { segs: [opaque(ctx, [[2, 6], [3, 2]])], joiner: '', meaning: null };
    }
    case 'people':
    case 'language': {
      let w = opaque(ctx, [[1, 0.6], [2, 6], [3, 2.5]]);
      const d = ctx.deriv(kind === 'language' ? (ctx.deriv('lang') ? 'lang' : 'people') : 'people');
      if (d && rng.chance(0.75)) w = applyDeriv(w, d, ep);
      return { segs: [w], joiner: '', meaning: null };
    }
    case 'polity': {
      let w = opaque(ctx, [[2, 6], [3, 2]]);
      const d = ctx.deriv('place');
      if (d && rng.chance(0.5)) w = applyDeriv(w, d, ep);
      return { segs: [w], joiner: '', meaning: null };
    }
    case 'deity': {
      const r = rng.next();
      if (r < 0.4) {
        const c = rng.pick(NATURE_DEITY);
        return { segs: [clip(ctx.word(c), 2)], joiner: '', meaning: en(c) };
      }
      if (r < 0.55) {
        const c = rng.pick(NATURE_DEITY);
        const lord = ctx.word(rng.chance(0.5) ? 'lord' : 'lady');
        const segs = style.genOrder === 'post' ? [clip(lord, 2), clip(ctx.word(c), 2)] : [clip(ctx.word(c), 2), clip(lord, 2)];
        const j: '' | '-' = style.nameJoin === '-' ? '-' : '';
        return { segs: j === '' ? [fuse(segs, ep)] : segs, joiner: j, meaning: `lord of the ${en(c)}` };
      }
      return { segs: [opaque(ctx, [[1, 2], [2, 6], [3, 1]])], joiner: '', meaning: null };
    }
    case 'person-m':
    case 'person-f':
      return personName(ctx);
    case 'dynasty':
    case 'house': {
      let w = opaque(ctx, [[1, 1], [2, 6], [3, 2]]);
      const d = ctx.deriv('people');
      if (d && rng.chance(0.4)) w = applyDeriv(w, d, ep);
      return { segs: [w], joiner: '', meaning: null };
    }
    case 'movement': {
      const noun = rng.pick(MOVEMENT_NOUNS);
      if (rng.chance(0.6)) {
        const adj = rng.pick(MOVEMENT_ADJS);
        return { segs: modHead(ctx, ctx.word(adj), ctx.word(noun), ''), joiner: '', meaning: `${en(adj)} ${en(noun)}` };
      }
      return { segs: [ctx.word(noun)], joiner: '', meaning: en(noun) };
    }
    case 'currency': {
      const c = rng.pick(['silver', 'measure', 'talent', 'coin', 'gold', 'copper', 'bull', 'sheep', 'barley', 'seal', 'crown', 'wheel', 'star', 'eagle']);
      if (rng.chance(0.5)) return { segs: [clip(ctx.word(c), 2)], joiner: '', meaning: en(c) };
      return { segs: [opaque(ctx, [[1, 3], [2, 5]])], joiner: '', meaning: null };
    }
    case 'month': {
      const c = rng.pick(['harvest', 'rain', 'flood', 'snow', 'dawn', 'fire', 'barley', 'sheep', 'flower', 'storm', 'star', 'moon', 'drought', 'ice', 'wind', 'season']);
      return { segs: [clip(ctx.word(c), 2)], joiner: '', meaning: `of the ${en(c)}` };
    }
    case 'script': {
      if (rng.chance(0.6)) {
        const adj = rng.pick(['new', 'old', 'holy', 'small', 'great', 'true', 'swift']);
        const noun = rng.pick(['sign', 'word', 'letter', 'writing'].filter((c) => c !== 'writing'));
        return { segs: modHead(ctx, ctx.word(adj), ctx.word(noun), ''), joiner: '', meaning: `${en(adj)} ${en(noun)}s` };
      }
      return { segs: [opaque(ctx, [[2, 6], [3, 1]])], joiner: '', meaning: null };
    }
  }
  return { segs: [opaque(ctx, [[2, 1]])], joiner: '', meaning: null };
}

function personName(ctx: CoinCtx): Coined {
  const { rng, style, kind } = ctx;
  const ep = ctx.ep;
  const fem = kind === 'person-f';
  const stems = fem ? FEMALE_STEMS : MALE_STEMS;
  const gender = ctx.deriv(fem ? 'female' : 'male');
  const pj = style.personJoin;
  const finish = (w: number[]) => applyDeriv(w, gender, ep);

  switch (style.id) {
    case 'sem': {
      const r = rng.next();
      if (r < 0.45) {
        // sentence name: "Brother-is-great", "Gift-of-the-sun"
        const head = rng.pick(fem ? ['daughter', 'gift', 'light', 'star', 'moon', 'sister'] : ['brother', 'son', 'gift', 'servant', 'light', 'lion', 'king']);
        const pred = rng.pick(THEO_PRED);
        const segs = [clip(ctx.word(head), 2), clip(ctx.word(pred), 2)];
        if (fem && gender) segs[segs.length - 1] = finish(segs[segs.length - 1]);
        return { segs, joiner: '-', meaning: `${capFirst(en(head))} ${thirdSg(pred)}` };
      }
      const stem = rng.pick(stems);
      const w = fem ? finish(clip(ctx.word(stem), 2)) : clip(ctx.word(stem), 2);
      return { segs: [w], joiner: '-', meaning: en(stem) };
    }
    case 'aus': {
      const r = rng.next();
      if (r < 0.25) {
        const base = ctx.root(1);
        const red = clip(base, 1);
        return { segs: [fuse([red, red, ctx.root(1)], ep)], joiner: '', meaning: null };
      }
      if (r < 0.7) {
        const a = rng.pick(stems);
        const b = rng.pick(['sky', 'sea', 'star', 'wind', 'rain', 'sun', 'moon', 'dawn', 'fire', 'island', 'bird', 'flower', 'storm', 'water']);
        const segs = modHead(ctx, ctx.word(a), ctx.word(b), '');
        return { segs, joiner: '', meaning: `${en(a)} ${en(b)}` };
      }
      return { segs: [ctx.root(rng.int(2, 3))], joiner: '', meaning: null };
    }
    case 'mes': {
      const r = rng.next();
      if (r < 0.4) {
        const num = rng.pick(NUMERALS);
        const sign = rng.pick(CAL_SIGNS);
        return { segs: [clip(ctx.word(num), 2), clip(ctx.word(sign), 2)], joiner: ' ', meaning: capWords(`${en(num)} ${en(sign)}`) };
      }
      if (r < 0.8) {
        const a = rng.pick(stems);
        const b = rng.pick(['eagle', 'snake', 'flower', 'smoke', 'fire', 'star', 'jar', 'reed', 'stone', 'raven', 'deer', 'storm', 'heart', 'water']);
        const segs = modHead(ctx, ctx.word(a), ctx.word(b), '');
        return { segs, joiner: '', meaning: `${en(a)} ${en(b)}` };
      }
      return { segs: [ctx.root(rng.int(2, 3))], joiner: '', meaning: null };
    }
    case 'sin': {
      const sur = clip(ctx.root(1), 1);
      if (rng.chance(0.6)) {
        const g = rng.pick(VIRTUE);
        const g2 = rng.chance(0.5) ? rng.pick(VIRTUE.filter((x) => x !== g)) : null;
        const given = g2 ? fuse([clip(ctx.word(g), 1), clip(ctx.word(g2), 1)], ep) : clip(ctx.word(g), 1);
        return { segs: [sur, given], joiner: ' ', meaning: g2 ? `${en(g)} ${en(g2)}` : en(g) };
      }
      return { segs: [sur, ctx.root(rng.int(1, 2))], joiner: ' ', meaning: null };
    }
    case 'ban': {
      const r = rng.next();
      const pre = ctx.deriv('person');
      if (r < 0.6) {
        const c = rng.pick(['rain', 'gift', 'dawn', 'harvest', 'war', 'peace', 'flood', 'drought', 'night', 'star', 'road', 'stranger', 'lion', 'river', 'honey', 'journey'].filter((x) => x !== 'journey'));
        return { segs: [applyDeriv(clip(ctx.word(c), 2), pre, ep)], joiner: '', meaning: en(c) };
      }
      return { segs: [applyDeriv(ctx.root(rng.int(2, 3)), pre, ep)], joiner: '', meaning: null };
    }
    default: {
      // ine, ura, dra: two-stem compounds with gender endings
      const r = rng.next();
      if (r < 0.68) {
        const a = rng.pick(stems);
        let b = rng.pick(stems);
        if (b === a) b = rng.pick(stems);
        const w = fuse([clip(ctx.word(a), 1 + (rng.chance(0.4) ? 1 : 0)), clip(ctx.word(b), 2)], ep);
        return { segs: [finish(clip(w, 4))], joiner: pj === ' ' ? '' : pj, meaning: `${en(a)} ${en(b)}` };
      }
      return { segs: [finish(ctx.root(rng.int(2, 3)))], joiner: '', meaning: null };
    }
  }
}

function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
