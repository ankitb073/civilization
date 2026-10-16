// What an archive object is, read from its record: the page of an artifact (art:N) → an ObjectSpec that the model
// builders draw. Pure (no three.js, no DOM): the same page always gives the same spec. "Chance" (the shape of a chip,
// which deity symbol crowns a stele) is a hash of the id, never Math.random.
//
// The rules: the medium decides the family of object and its material; the era decides style (a Bronze Age stele has
// a rounded top, a printed book a title page); the condition and the description decide the damage (a stele whose
// "lower part is broken away" is drawn broken); record numbers decide size (a coin's weight and metal give its
// diameter, the length of a text the size of its tablet); and the text on the object is the record's own text — the
// transliteration of an inscription, a coin's legend, the document's words.
import type { ArmsSpec, PageJson, SigilSpec } from '../../../../engine/src/export/contract.ts';

export type Family =
  | 'stele' | 'rock' | 'slab' | 'brick' | 'foundation' | 'plaster' | 'plaque'
  | 'tablet' | 'envelope' | 'tablets' | 'wax' | 'sherd' | 'coin'
  | 'scroll' | 'charter' | 'codex' | 'sheet' | 'newspaper' | 'telegram';

export type Stuff =
  | 'basalt' | 'diorite' | 'limestone' | 'sandstone' | 'granite' | 'steatite' | 'brick' | 'plaster' | 'clay'
  | 'terracotta' | 'bronze' | 'silver' | 'gold' | 'wax' | 'papyrus' | 'parchment' | 'paper' | 'newsprint';

/** A run of text with its marks: bold, italic, struck (a pupil's error), or a lacuna (text lost). */
export interface Run { s: string; b?: boolean; i?: boolean; x?: boolean; lac?: boolean }
/** h heading · p paragraph · v a line kept as written (verse, a signature) · li a numbered item. */
export interface Block { k: 'h' | 'p' | 'v' | 'li'; runs: Run[] }

export interface Damage {
  /** 0 crisp … 1 badly worn */
  weather: number;
  chips: number;
  brokenLower: boolean;
  fracture: boolean;
  wornLast: boolean;
  lostEnd: boolean;
  fire: boolean;
  water: boolean;
  leaves: boolean;
  fragmentary: boolean;
  corroded: boolean;
  offFlan: boolean;
  minor: boolean;
}

export interface CoinSpec {
  head: { who: string; attr: string; facing: 'left' | 'right' } | null;
  emblem: string | null;       // pol id whose arms are struck when there is no ruler
  legend: string;
  reverse: string;             // 'a ship under sail' …
  mint: string;
  metal: 'silver' | 'gold';
  fine: number;                // % silver (gold: 96)
  grams: number;
}

export interface NewsSpec { masthead: string; dateline: string[]; headline: string; paras: Block[]; footer: string }

export interface ObjectSpec {
  id: string;
  seed: number;
  family: Family;
  stuff: Stuff;
  medium: string;
  title: string;
  catalog: string;
  year: number;
  era: number;
  date: string;
  script: string;
  language: string;
  condition: string;
  /** the inscription's transliteration (stone and metal inscriptions): what is carved */
  carve: string | null;
  /** the document's own words, editorial matter removed */
  blocks: Block[];
  coin: CoinSpec | null;
  news: NewsSpec | null;
  ledger: { columns: string[]; rows: string[][] } | null;
  dmg: Damage;
  issuer: string | null;
  /** states named in the text (seals of a treaty's parties), issuer first */
  parties: string[];
  author: string | null;
  deity: string | null;
  arms: Record<string, ArmsSpec>;
  sigil: SigilSpec | null;
  /** real size in metres: width, height, depth */
  dims: [number, number, number];
  boast: { claimed: number; truth: number } | null;
}

// ---------------------------------------------------------------- hashing
/** FNV-1a with an avalanche: a stable 32-bit hash of a string. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
/** A small deterministic stream (mulberry32) keyed by a label. */
export function rng(label: string): () => number {
  let a = hash(label) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const h01 = (s: string) => hash(s) / 4294967296;

// ---------------------------------------------------------------- the medium
export function familyOf(medium: string, sub: string, bodyLen = 0): Family {
  const m = medium.toLowerCase();
  if (/coin/.test(m)) return 'coin';
  if (/in envelope/.test(m)) return 'envelope';
  if (/clay tablets/.test(m)) return 'tablets';
  if (/clay tablet/.test(m)) return 'tablet';
  if (/foundation tablet/.test(m)) return 'foundation';
  if (/wax tablet/.test(m)) return 'wax';
  if (/potsherd|ostracon/.test(m)) return 'sherd';
  if (/graffit/.test(m)) return 'plaster';
  if (/brick/.test(m)) return 'brick';
  if (/rock relief/.test(m)) return 'rock';
  if (/stele/.test(m)) return 'stele';
  if (/slab/.test(m)) return 'slab';
  if (/bronze|silver tablet|gold tablet|plaque/.test(m)) return 'plaque';
  if (/with seals/.test(m)) return 'charter';
  if (/papyrus/.test(m)) return 'scroll';
  if (/codex|book|volume|register|quires|leaves|ledger|bound|report|proceedings|manuscript/.test(m)) return 'codex';
  if (/^parchment$/.test(m)) return bodyLen > 1600 ? 'scroll' : 'sheet';
  if (/newsprint|gazette|broadsheet/.test(m)) return 'newspaper';
  if (/telegra/.test(m)) return 'telegram';
  if (/paper|typescript|print|article|sheet|pamphlet|specification/.test(m)) return 'sheet';
  if (/stone/.test(m)) return 'stele';
  if (sub === 'coin') return 'coin';
  return 'sheet';
}

function stuffOf(fam: Family, medium: string, id: string, era: number): Stuff {
  const m = medium.toLowerCase();
  if (/basalt/.test(m)) return 'basalt';
  if (/diorite/.test(m)) return 'diorite';
  if (/limestone/.test(m)) return 'limestone';
  if (fam === 'rock') return (['sandstone', 'granite', 'limestone'] as const)[hash(`rock:${id}`) % 3];
  if (fam === 'brick') return 'brick';
  if (fam === 'foundation') return 'steatite';
  if (fam === 'plaster') return /statue base|gate column/.test(m) ? 'limestone' : 'plaster';
  if (fam === 'stele' || fam === 'slab') return (['limestone', 'sandstone', 'limestone', 'granite'] as const)[hash(`stone:${id}`) % 4];
  if (fam === 'tablet' || fam === 'tablets' || fam === 'envelope') return 'clay';
  if (fam === 'sherd') return 'terracotta';
  if (fam === 'wax') return 'wax';
  if (fam === 'coin') return /gold/.test(m) ? 'gold' : 'silver';
  if (fam === 'plaque') return /silver/.test(m) ? 'silver' : /gold/.test(m) ? 'gold' : 'bronze';
  if (/papyrus/.test(m)) return 'papyrus';
  if (/parchment|vellum/.test(m)) return 'parchment';
  if (fam === 'newspaper' || /newsprint/.test(m)) return 'newsprint';
  if (fam === 'codex' && era <= 3 && !/paper|print/.test(m)) return 'parchment';
  return 'paper';
}

// ---------------------------------------------------------------- text
const LINK = /\[\[[a-z]{3}:[^\]|]+\|([^\]]*)\]\]/g;
export const plain = (s: string) => s.replace(LINK, '$1');

/** Inline marks → runs. Lacunae ("[...]", "[x x x]") become their own runs. */
export function runs(src: string): Run[] {
  const out: Run[] = [];
  const s = plain(src);
  const re = /(\*\*[^*]+\*\*|~~[^~]+~~|(?<![*\w])\*[^*\s][^*]*?\*(?!\w)|\[(?:\.\.\.|…|x(?: x)*)\])/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ s: s.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**')) out.push({ s: t.slice(2, -2), b: true });
    else if (t.startsWith('~~')) out.push({ s: t.slice(2, -2), x: true });
    else if (t.startsWith('[')) out.push({ s: t, lac: true });
    else out.push({ s: t.slice(1, -1), i: true });
    last = m.index! + t.length;
  }
  if (last < s.length) out.push({ s: s.slice(last) });
  return out.filter((r) => r.s.length > 0);
}

/** The document's text: the body above the editorial rule, without the editor's headnotes. */
export function docBlocks(body: string, opts: { translationOnly?: boolean } = {}): Block[] {
  let text = body.split(/\n---+\s*\n/)[0];
  if (opts.translationOnly) {
    const m = text.match(/##\s+Translation\s*\n([\s\S]*?)(?=\n##\s|$)/);
    if (m) text = m[1];
  }
  const lines = text.replace(/\r/g, '').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const joined = para.join(' ').replace(/\s+/g, ' ').trim();
    para = [];
    // an editor's headnote introducing the text ("*Graffito scratched on … :*")
    if (/^\*[^*]+:\*$/.test(joined)) return;
    if (joined) out.push({ k: 'p', runs: runs(joined) });
  };
  for (const raw of lines) {
    let l = raw.replace(/^\s*>\s?/, '');
    if (/^\s*$/.test(l)) { flush(); continue; }
    const h = l.match(/^#{1,4}\s+(.*)$/);
    if (h) { flush(); if (!/^(Translation|Commentary|Description)$/i.test(h[1].trim())) out.push({ k: 'h', runs: runs(h[1]) }); continue; }
    const li = l.match(/^\s*(\d+\.|-)\s+(.*)$/);
    if (li) { flush(); out.push({ k: 'li', runs: runs((li[1] === '-' ? '' : `${li[1]} `) + li[2]) }); continue; }
    // a hard line break (verse, signatures) keeps the line as written
    if (/ {2,}$/.test(l) || /^(For |Signed|Sealed)/.test(l.trim())) { flush(); l = l.trim(); if (l) out.push({ k: 'v', runs: runs(l) }); continue; }
    para.push(l.trim());
  }
  flush();
  return out;
}

export function blocksText(bs: Block[]): string {
  return bs.map((b) => b.runs.map((r) => r.s).join('')).join('\n');
}

// ---------------------------------------------------------------- damage
function damageOf(cond: string, desc: string, carve: string | null, fam: Family): Damage {
  const c = cond.toLowerCase(), d = desc.toLowerCase();
  const d0: Damage = {
    weather: 0.15, chips: 0, brokenLower: false, fracture: false, wornLast: false, lostEnd: false, fire: false, water: false,
    leaves: false, fragmentary: false, corroded: false, offFlan: false, minor: false,
  };
  if (/weathered/.test(c)) d0.weather = 0.55;
  if (/^complete\.$/.test(c.trim()) || /well preserved|very fine|extremely fine/.test(c + d)) d0.weather = /extremely fine/.test(c) ? 0.02 : 0.08;
  if (/worn/.test(c)) d0.weather = 0.6;
  if (/^fine/.test(c)) d0.weather = 0.3;
  if (/minor losses/.test(c)) { d0.minor = true; d0.weather = Math.max(d0.weather, 0.25); }
  if (/minor chips/.test(d)) d0.chips = 4;
  if (/lower part of the stone is broken away/.test(d)) d0.brokenLower = true;
  if (/fracture runs through/.test(d)) d0.fracture = true;
  if (/last lines are worn/.test(d)) d0.wornLast = true;
  if (/final lines are lost/.test(c) || /\[x(?: x)*\]\s*$/.test(carve ?? '')) d0.lostEnd = true;
  if (/fire/.test(c)) d0.fire = true;
  if (/water/.test(c)) d0.water = true;
  if (/leaves missing/.test(c)) d0.leaves = true;
  if (/fragmentary/.test(c)) d0.fragmentary = true;
  if (/corroded/.test(c)) d0.corroded = true;
  if (/off the flan/.test(c)) d0.offFlan = true;
  if (fam === 'rock' || fam === 'stele' || fam === 'slab') d0.chips = Math.max(d0.chips, d0.weather > 0.4 ? 3 : 1);
  return d0;
}

// ---------------------------------------------------------------- coins
function coinOf(body: string, medium: string): CoinSpec {
  const obv = body.match(/\*\*Obverse:\*\*\s*([^\n]*)/)?.[1] ?? '';
  const head = obv.match(/head of \[\[(per:\d+)\|[^\]]*\]\],\s*([a-z]+),\s*(left|right)/);
  const emb = obv.match(/emblem of \[\[(pol:\d+)\|/);
  const legend = obv.match(/Legend:\s*\*([^*]+)\*/)?.[1] ?? '';
  const rev = body.match(/\*\*Reverse:\*\*\s*([^;\n]+);\s*mint mark of \[\[set:\d+\|([^\]]+)\]\]/);
  const metal = /gold/.test(medium) ? 'gold' : 'silver';
  const fine = Number(body.match(/about (\d+)% fine/)?.[1] ?? (metal === 'gold' ? 96 : 92));
  const grams = Number(body.match(/\*\*Weight:\*\*\s*([\d.]+)\s*g/)?.[1] ?? 4);
  return {
    head: head ? { who: head[1], attr: head[2], facing: head[3] as 'left' | 'right' } : null,
    emblem: emb ? emb[1] : null,
    legend: legend.trim(),
    reverse: rev?.[1].trim() ?? 'a wheat ear',
    mint: rev?.[2] ?? '',
    metal, fine, grams,
  };
}

/** Diameter and thickness (m) of a struck coin from its weight and metal: a flan about a tenth as thick as it is wide. */
export function coinSize(c: CoinSpec): [number, number] {
  const fineFrac = c.metal === 'gold' ? 0.96 : c.fine / 100;
  // alloy density: silver 10.5, copper 8.9, gold 19.3 g/cm³
  const rho = c.metal === 'gold' ? 19.3 * fineFrac + 8.9 * (1 - fineFrac) : 10.5 * fineFrac + 8.9 * (1 - fineFrac);
  const vol = c.grams / rho; // cm³
  const d = Math.cbrt(vol / (Math.PI / 4 * 0.1)); // V = π/4 · d² · 0.1d
  return [d / 100, d * 0.1 / 100];
}

// ---------------------------------------------------------------- newspapers
function newsOf(body: string): NewsSpec | null {
  const blocks = docBlocks(body);
  if (!blocks.length) return null;
  const first = blocks[0].runs;
  const mast = first.find((r) => r.b)?.s ?? '';
  if (!mast) return null;
  const rest = first.filter((r) => !r.b).map((r) => r.s).join('').split('·').map((x) => x.trim()).filter(Boolean);
  const head = blocks.find((b) => b.k === 'h');
  const paras = blocks.slice(1).filter((b) => b !== head && !(b.runs.length === 1 && b.runs[0].i && /Markets|Weather/.test(b.runs[0].s)));
  const foot = blocks.find((b) => b.runs.length === 1 && b.runs[0].i && /Markets|Weather/.test(b.runs[0].s));
  return { masthead: mast, dateline: rest, headline: head ? head.runs.map((r) => r.s).join('') : '', paras, footer: foot?.runs[0].s ?? '' };
}

// ---------------------------------------------------------------- the spec
const ERA_STARTS = [0, 1866, 2439, 3154, 4593, 4741, 4947];

export interface SpecExtras { arms?: Record<string, ArmsSpec>; sigil?: SigilSpec | null; eraStarts?: number[] }

/** Can this page be built as an object at all? (A work known only from quotations has no object.) */
export function hasObject(page: PageJson): boolean {
  return page.kind === 'artifact' && !!page.artifact && !/^Lost\b/.test(page.artifact.condition);
}

export function specOf(page: PageJson, x: SpecExtras = {}): ObjectSpec {
  const a = page.artifact!;
  const body = page.body;
  const starts = x.eraStarts ?? ERA_STARTS;
  let era = 0;
  starts.forEach((s, i) => { if (page.t0 >= s) era = i; });
  const fam = familyOf(a.medium, page.sub, body.length);
  const stone = ['stele', 'rock', 'slab', 'brick', 'foundation', 'plaque'].includes(fam);
  const carve = stone && a.interlinear ? a.interlinear.transliteration : null;
  const desc = (body.split('\n').find((l) => l.trim()) ?? '');
  const blocks = page.sub === 'coin' ? [] : docBlocks(body, { translationOnly: !!a.interlinear });
  const issuer = page.infobox.find(([k]) => k === 'Issued by')?.[1].match(/\[\[(pol:\d+)\|/)?.[1] ?? null;
  const docText = body.split(/\n---+\s*\n/)[0];
  const parties: string[] = [];
  if (issuer) parties.push(issuer);
  // a treaty's parties sign "For X:"; otherwise the states its text names
  const signers = [...docText.matchAll(/^For \[\[(pol:\d+)\|/gm)].map((m) => m[1]);
  for (const p of signers.length ? signers : [...docText.matchAll(/\[\[(pol:\d+)\|/g)].map((m) => m[1])) if (!parties.includes(p)) parties.push(p);
  if (signers.length) parties.splice(0, parties.length, ...signers);
  const deity = docText.match(/\[\[(dei:\d+)\|/)?.[1] ?? null;
  const bm = body.match(/It claims ([\d,]+) enemy dead\. The record of the battle gives ([\d,]+) losses/);
  const num = (s: string) => Number(s.replace(/,/g, ''));
  const coin = fam === 'coin' ? coinOf(body, a.medium) : null;
  const spec: ObjectSpec = {
    id: page.id,
    seed: hash(page.id),
    family: fam,
    stuff: stuffOf(fam, a.medium, page.id, era),
    medium: a.medium,
    title: page.title,
    catalog: a.catalog,
    year: page.t0,
    era,
    date: a.date.replace(/\s*\[AY -?\d+\]\s*$/, ''),
    script: a.script,
    language: a.language,
    condition: a.condition,
    carve,
    blocks,
    coin,
    news: fam === 'newspaper' ? newsOf(body) : null,
    ledger: a.ledger ? { columns: a.ledger.columns.map(plain), rows: a.ledger.rows.map((r) => r.map(plain)) } : null,
    dmg: damageOf(a.condition, desc, carve, fam),
    issuer,
    parties: parties.slice(0, 4),
    author: a.authorId ?? null,
    deity,
    arms: x.arms ?? {},
    sigil: x.sigil ?? null,
    dims: [0.5, 1, 0.2],
    boast: bm ? { claimed: num(bm[1]), truth: num(bm[2]) } : null,
  };
  spec.dims = dimsOf(spec);
  return spec;
}

/** Real size (m), from the record: the length of the text, a coin's weight, the medium. */
function dimsOf(s: ObjectSpec): [number, number, number] {
  const r = rng(`dims:${s.id}`);
  const chars = s.carve ? s.carve.length : blocksText(s.blocks).length;
  switch (s.family) {
    case 'stele': {
      // monumental letters, larger the bigger the boast; the stone as tall as its text needs
      const w = 0.5 + r() * 0.22;
      const letter = 0.034 * (1 + (s.boast ? Math.min(0.5, 0.11 * Math.log10(Math.max(1, s.boast.claimed / 500))) : 0));
      const perRow = Math.max(8, Math.floor((w * 0.8) / (letter * 0.62)));
      const rows = Math.ceil(chars / perRow);
      const h = Math.min(2.6, Math.max(0.95, 0.3 * w + rows * letter * 1.55 + 0.22 + w * 0.25));
      return [w, h, 0.16 + r() * 0.08];
    }
    case 'rock': return [1.5 + r() * 0.5, 1.3 + r() * 0.4, 0.7];
    case 'slab': { const w = 0.7 + r() * 0.3; return [w, Math.max(0.42, Math.min(0.9, 0.18 + chars / 900)), 0.12]; }
    case 'brick': return [0.33, 0.33, 0.075];
    case 'foundation': return [0.11 + r() * 0.03, 0.15 + r() * 0.04, 0.025];
    case 'plaster': return [0.42 + r() * 0.2, 0.32 + r() * 0.12, 0.06];
    case 'plaque': { const w = 0.26 + Math.min(0.24, chars / 4000); return [w, w * (1.3 + r() * 0.2), 0.008]; }
    case 'tablet': case 'tablets': {
      const w = Math.min(0.2, 0.06 + Math.sqrt(chars) * 0.0016 + r() * 0.012);
      return [w, w * (1.25 + r() * 0.2), 0.024 + w * 0.12];
    }
    case 'envelope': return [0.075, 0.095, 0.028];
    case 'wax': return [0.13, 0.17, 0.012];
    case 'sherd': return [0.11 + r() * 0.05, 0.1 + r() * 0.04, 0.008];
    case 'coin': { const [d, t] = coinSize(s.coin!); return [d, d, t]; }
    case 'scroll': return [0.52, s.stuff === 'papyrus' ? 0.27 : 0.3, 0.05];
    case 'charter': return [0.42, 0.3, 0.004];
    case 'codex': {
      const big = /printed volume|register|proceedings|report|ledger/.test(s.medium);
      const h = big ? 0.34 : /typescript/.test(s.medium) ? 0.3 : s.era >= 4 ? 0.24 : 0.27;
      return [h * 0.72 * 2, h, 0.05];
    }
    case 'newspaper': {
      // a news-sheet as large as its news: early ones were a single small sheet
      const w = Math.min(0.46, 0.28 + chars / 5000);
      return [w, w * 1.32, 0.004];
    }
    case 'telegram': return [0.21, 0.15, 0.002];
    default: return /pamphlet/.test(s.medium) ? [0.15, 0.22, 0.003] : [0.21, 0.297, 0.002];
  }
}

/** One line on what the model shows and how it was read from the record. */
export function provenanceNote(s: ObjectSpec): string {
  const parts: string[] = [];
  if (s.carve) parts.push('The carved text is the inscription’s transliteration, as recorded');
  else if (s.coin) parts.push(`Legend, portrait and reverse as recorded; ${s.coin.grams} g of ${s.coin.metal === 'gold' ? 'gold' : `silver about ${s.coin.fine}% fine`} sets the size`);
  else if (s.family === 'tablet' || s.family === 'tablets' || s.family === 'envelope') parts.push('One wedge-sign per syllable of the recorded text, the same sign for the same syllable');
  else parts.push('The text is the document’s own, in translation');
  const d = s.dmg;
  const dm: string[] = [];
  if (d.brokenLower) dm.push('the lower part broken away');
  if (d.fracture) dm.push('a fracture through the last register');
  if (d.wornLast) dm.push('the last lines worn');
  if (d.lostEnd) dm.push('the final lines lost');
  if (d.fire) dm.push('fire damage');
  if (d.water) dm.push('water stains');
  if (d.corroded) dm.push('corrosion');
  if (d.offFlan) dm.push('the legend off the flan');
  if (d.weather >= 0.5 && !d.corroded) dm.push('weathering');
  if (dm.length) parts.push(`damage drawn from the condition report: ${dm.join(', ')}`);
  return parts.join('; ') + '.';
}

/** Human size: "1.42 m tall", "2.3 cm across". */
export function sizeLabel(s: ObjectSpec): string {
  const [w, h] = s.dims;
  const f = (m: number) => (m >= 1 ? `${m.toFixed(2)} m` : m >= 0.1 ? `${Math.round(m * 100)} cm` : `${(m * 100).toFixed(1)} cm`);
  if (s.family === 'coin') return `${f(w)} across, ${s.coin!.grams} g`;
  if (['scroll', 'codex', 'sheet', 'newspaper', 'telegram', 'charter'].includes(s.family)) return `${f(h)} tall`;
  return `${f(w)} × ${f(h)}`;
}
