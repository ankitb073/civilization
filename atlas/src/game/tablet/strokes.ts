// A wedge alphabet: every capital, digit and mark the tablet needs, drawn as straight strokes on a grid six units
// tall, the way a scribe with a reed stylus would press Latin letters into clay. Each stroke becomes one wedge whose
// head sits at its top (or its left, for a horizontal), as in cuneiform. Curves are squared off: there are none in clay.

export interface Glyph { w: number; s: number[] }

const G: Record<string, Glyph> = {
  A: { w: 4, s: [0, 6, 2, 0, 2, 0, 4, 6, 0.9, 3.9, 3.1, 3.9] },
  B: { w: 4, s: [0, 0, 0, 6, 0, 0, 3, 0, 3, 0, 3, 3, 0, 3, 4, 3, 4, 3, 4, 6, 0, 6, 4, 6] },
  C: { w: 4, s: [0.2, 0, 4, 0, 0, 0, 0, 6, 0.2, 6, 4, 6] },
  D: { w: 4, s: [0, 0, 0, 6, 0, 0, 2.8, 0, 2.8, 0, 4, 1.5, 4, 1.5, 4, 4.5, 4, 4.5, 2.8, 6, 0, 6, 2.8, 6] },
  E: { w: 3.6, s: [0, 0, 0, 6, 0, 0, 3.6, 0, 0, 3, 3, 3, 0, 6, 3.6, 6] },
  F: { w: 3.6, s: [0, 0, 0, 6, 0, 0, 3.6, 0, 0, 3, 3, 3] },
  G: { w: 4, s: [0.2, 0, 4, 0, 0, 0, 0, 6, 0.2, 6, 4, 6, 4, 3.2, 4, 6, 2.2, 3.2, 4, 3.2] },
  H: { w: 4, s: [0, 0, 0, 6, 4, 0, 4, 6, 0, 3, 4, 3] },
  I: { w: 2.4, s: [1.2, 0, 1.2, 6, 0, 0, 2.4, 0, 0, 6, 2.4, 6] },
  J: { w: 3.6, s: [3.6, 0, 3.6, 6, 0, 6, 3.6, 6, 0, 4, 0, 6] },
  K: { w: 4, s: [0, 0, 0, 6, 4, 0, 0, 3.4, 1.4, 2.5, 4, 6] },
  L: { w: 3.6, s: [0, 0, 0, 6, 0, 6, 3.6, 6] },
  M: { w: 5, s: [0, 0, 0, 6, 5, 0, 5, 6, 0, 0, 2.5, 3.8, 5, 0, 2.5, 3.8] },
  N: { w: 4, s: [0, 0, 0, 6, 4, 0, 4, 6, 0, 0, 4, 6] },
  O: { w: 4.2, s: [0.2, 0, 4.2, 0, 0, 0, 0, 6, 4.2, 0, 4.2, 6, 0.2, 6, 4.2, 6] },
  P: { w: 4, s: [0, 0, 0, 6, 0, 0, 4, 0, 4, 0, 4, 3.2, 0, 3.2, 4, 3.2] },
  Q: { w: 4.2, s: [0.2, 0, 4.2, 0, 0, 0, 0, 6, 4.2, 0, 4.2, 6, 0.2, 6, 4.2, 6, 2.6, 4.4, 4.6, 7] },
  R: { w: 4, s: [0, 0, 0, 6, 0, 0, 4, 0, 4, 0, 4, 3.2, 0, 3.2, 4, 3.2, 1.8, 3.2, 4, 6] },
  S: { w: 4, s: [0.3, 0, 4, 0, 0, 0, 0, 2.6, 0, 2.6, 4, 3.4, 4, 3.4, 4, 6, 0, 6, 3.7, 6] },
  T: { w: 4, s: [0, 0, 4, 0, 2, 0, 2, 6] },
  U: { w: 4, s: [0, 0, 0, 6, 4, 0, 4, 6, 0, 6, 4, 6] },
  V: { w: 4, s: [0, 0, 2, 6, 4, 0, 2, 6] },
  W: { w: 5.6, s: [0, 0, 1.4, 6, 2.8, 1.4, 1.4, 6, 2.8, 1.4, 4.2, 6, 5.6, 0, 4.2, 6] },
  X: { w: 4, s: [0, 0, 4, 6, 4, 0, 0, 6] },
  Y: { w: 4, s: [0, 0, 2, 3, 4, 0, 2, 3, 2, 3, 2, 6] },
  Z: { w: 4, s: [0, 0, 4, 0, 4, 0, 0, 6, 0, 6, 4, 6] },
  '0': { w: 3.2, s: [0.2, 0, 3.2, 0, 0, 0, 0, 6, 3.2, 0, 3.2, 6, 0.2, 6, 3.2, 6] },
  '1': { w: 2, s: [1.4, 0, 1.4, 6, 0, 1.4, 1.4, 0] },
  '2': { w: 3.6, s: [0, 0, 3.6, 0, 3.6, 0, 3.6, 2.8, 3.6, 2.8, 0, 6, 0, 6, 3.6, 6] },
  '3': { w: 3.6, s: [0, 0, 3.6, 0, 3.6, 0, 3.6, 6, 1, 3, 3.6, 3, 0, 6, 3.6, 6] },
  '4': { w: 3.8, s: [2.8, 0, 2.8, 6, 2.8, 0, 0, 4, 0, 4, 3.8, 4] },
  '5': { w: 3.6, s: [0, 0, 3.6, 0, 0, 0, 0, 2.8, 0, 2.8, 3.6, 2.8, 3.6, 2.8, 3.6, 6, 0, 6, 3.6, 6] },
  '6': { w: 3.6, s: [0, 0, 3.6, 0, 0, 0, 0, 6, 0, 3, 3.6, 3, 3.6, 3, 3.6, 6, 0, 6, 3.6, 6] },
  '7': { w: 3.6, s: [0, 0, 3.6, 0, 3.6, 0, 1.2, 6] },
  '8': { w: 3.6, s: [0, 0, 3.6, 0, 0, 0, 0, 6, 3.6, 0, 3.6, 6, 0, 3, 3.6, 3, 0, 6, 3.6, 6] },
  '9': { w: 3.6, s: [0, 0, 3.6, 0, 0, 0, 0, 3, 0, 3, 3.6, 3, 3.6, 0, 3.6, 6, 0, 6, 3.6, 6] },
  ',': { w: 0.8, s: [0.7, 5.2, 0, 7.2] },
  '.': { w: 0.8, s: [0, 5, 0.6, 6] },
  "'": { w: 0.8, s: [0.7, 0, 0, 1.9] },
  '"': { w: 2, s: [0.7, 0, 0, 1.9, 1.9, 0, 1.2, 1.9] },
  '-': { w: 2.4, s: [0, 3, 2.4, 3] },
  '—': { w: 4, s: [0, 3, 4, 3] },
  ':': { w: 0.8, s: [0.4, 1.2, 0.4, 2.4, 0.4, 4.4, 0.4, 5.6] },
  ';': { w: 0.8, s: [0.4, 1.2, 0.4, 2.4, 0.7, 4.6, 0, 6.8] },
  '?': { w: 3.6, s: [0, 0, 3.6, 0, 3.6, 0, 3.6, 2.8, 1.8, 2.8, 3.6, 2.8, 1.8, 2.8, 1.8, 4.2, 1.8, 5.1, 1.8, 6] },
  '!': { w: 1, s: [0.5, 0, 0.5, 4, 0.5, 5.1, 0.5, 6] },
  '(': { w: 1.4, s: [1.4, 0, 0, 1.6, 0, 1.6, 0, 4.4, 0, 4.4, 1.4, 6] },
  ')': { w: 1.4, s: [0, 0, 1.4, 1.6, 1.4, 1.6, 1.4, 4.4, 1.4, 4.4, 0, 6] },
  '/': { w: 3, s: [3, 0, 0, 6] },
  '+': { w: 3.6, s: [0, 3, 3.6, 3, 1.8, 1.2, 1.8, 4.8] },
};
/** Letters are condensed a little, as inscriptions are, so a line holds more of the sentence. */
const CONDENSE = 0.84;
for (const k of Object.keys(G)) G[k] = { w: G[k].w * CONDENSE, s: G[k].s.map((v, i) => (i % 2 === 0 ? v * CONDENSE : v)) };

const ALIAS: Record<string, string> = { '’': "'", '‘': "'", 'ʼ': "'", 'ʻ': "'", '`': "'", '“': '"', '”': '"', '–': '-', '&': '+' };

/** Marks added for a combining diacritic, relative to a glyph of width w. */
function accent(mark: string, w: number): number[] {
  const c = w / 2;
  switch (mark) {
    case '̈': return [c - 1, -2.2, c - 1, -1, c + 1, -2.2, c + 1, -1];      // diaeresis
    case '́': return [c + 0.9, -2.4, c - 0.3, -1];                              // acute
    case '̀': return [c - 0.9, -2.4, c + 0.3, -1];                              // grave
    case '̂': return [c, -2.4, c - 1.2, -1, c, -2.4, c + 1.2, -1];              // circumflex
    case '̄': case '̃': return [c - 1.3, -1.6, c + 1.3, -1.6];             // macron, tilde
    case '̌': return [c - 1.2, -2.4, c, -1, c + 1.2, -2.4, c, -1];              // caron
    case '̊': return [c - 0.6, -2.4, c + 0.6, -2.4, c - 0.6, -2.4, c - 0.6, -1.2]; // ring
    case '̧': return [c + 0.4, 6, c - 0.4, 7.4];                                 // cedilla
    default: return [];
  }
}

/** One glyph for a single (possibly accented) character; unknown letters become a blank of a letter's width. */
export function glyphOf(ch: string): Glyph {
  if (ch === ' ') return { w: 2.2, s: [] };
  const direct = G[ch] ?? G[ALIAS[ch] ?? ''];
  if (direct) return direct;
  const nfd = ch.normalize('NFD');
  const base = G[nfd[0].toUpperCase()] ?? G[ALIAS[nfd[0]] ?? ''];
  if (!base) return { w: 3, s: [] };
  const extra = [...nfd.slice(1)].flatMap((m) => accent(m, base.w));
  return extra.length ? { w: base.w, s: [...base.s, ...extra] } : base;
}

export const TRACK = 1.5;      // gap between letters, in grid units
export const CAP = 6;          // grid units per capital height

/** Split text into grapheme-ish units (a base letter with its combining marks). */
export function chars(text: string): string[] {
  return text.normalize('NFC').match(/\P{M}\p{M}*/gu) ?? [];
}

export function advance(ch: string): number {
  return glyphOf(ch).w + TRACK;
}
export function measure(text: string): number {
  const cs = chars(text);
  return cs.reduce((t, c) => t + advance(c), 0) - (cs.length ? TRACK : 0);
}
