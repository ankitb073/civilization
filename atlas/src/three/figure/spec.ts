// What a figurine is cut from: a person's page, read into a FigureSpec. Pure (no three.js), so the route, the person
// page and the portrait script all read a person the same way and the same person is the same piece everywhere.
//
// Everything comes from the record: sex, birth and death (and how they died), every role with its state and years,
// the people they were born among, their house, and their seal (atlas/src/heraldry.ts), whose tinctures the piece is
// painted in. The piece shows a person at the middle of the role their seal is cut for (a reign, a career, a battle
// year), unless asked for another year — a child king at his accession, say.
import type { PageJson, SigilSpec } from '../../../../engine/src/export/contract.ts';
import { sealRole, sigilSvg } from '../../heraldry.ts';

export interface FigureRole { role: string; polity: string | null; place: string; start: number; end: number }

export interface Tinctures {
  colour: string;    // the state's colour (the people's)
  metal: string;     // the state's metal (the faith's)
  /** A ruling house's arms are quartered: a is the first quarter, b the second (in the house's order). For anyone
   *  else a is the colour and b the metal (a field within a bordure). */
  a: string;
  b: string;
  quarterly: boolean;
}

export interface FigureSpec {
  id: string;
  name: string;          // the page title without its disambiguator
  sex: 'm' | 'f';
  born: number;
  died: number | null;   // null: living at the end of the record
  death: string;         // 'natural', 'battle', 'executed', … ('' when living)
  roles: FigureRole[];
  role: string;          // the role the piece is cut for: the highest held (as on the seal)
  roles2: Set<string>;   // every role held
  era: number;           // the age of their prime (index into meta.eras), as on the seal
  dynasty: number;       // -1: no ruling house
  house: string | null;
  people: number;        // their own culture (cul:N), -1 if unknown
  flags: number;
  sigil: SigilSpec;
  tinctures: Tinctures;
  year: number;          // the year the piece shows them at
  age: number;           // their age in that year
  /** The role entry the piece is cut for (its span sets `year`), if any. */
  main: FigureRole | null;
}

export type FigureSource = Pick<PageJson, 'id' | 'title' | 'infobox' | 't0' | 't1'> & { sigil?: SigilSpec; sub?: string };

const row = (p: FigureSource, k: string) => p.infobox.find((r) => r[0] === k)?.[1] ?? '';

/** "AY 354" → 354; "40 before AY 0" → -40; "AY −40" → -40. */
export function parseYear(s: string): number | null {
  let m = s.match(/(\d+)\s+before\s+AY\s*0/);
  if (m) return -Number(m[1]);
  m = s.match(/AY\s*([−-])?\s*(\d+)/);
  if (m) return (m[1] ? -1 : 1) * Number(m[2]);
  return null;
}

/** "ruler of [[pol:22|Virnado]] (380–412); merchant (2100): House of X" → roles. */
export function parseRoles(s: string): FigureRole[] {
  const out: FigureRole[] = [];
  for (const part of s.split(/;\s*/)) {
    const m = part.match(/^([a-z-]+)(?:\s+of\s+\[\[(pol:\d+)\|([^\]]*)\]\])?\s*\((−?-?\d+)(?:\s*[–-]\s*(−?-?\d+))?\)/);
    if (!m) continue;
    const n = (x: string) => Number(x.replace('−', '-'));
    const start = n(m[4]);
    out.push({ role: m[1], polity: m[2] ?? null, place: m[3] ?? '', start, end: m[5] !== undefined ? n(m[5]) : start });
  }
  return out;
}

const hexes = (svg: string, re: RegExp) => svg.match(re)?.[1];
/** The seal's tinctures, read from the seal itself (heraldry.ts draws it; this reads its fills), so the piece and
 *  the seal can never disagree. */
export function tincturesOf(sigil: SigilSpec): Tinctures {
  const svg = sigilSvg(sigil, { uid: 'fig', title: false });
  const metal = hexes(svg, /<\/defs><path d="[^"]*" fill="(#[0-9a-f]{6})"/i) ?? '#d6a634';
  const colour = hexes(svg, /fill="(#[0-9a-f]{6})" opacity="\.75"/i) ?? '#b3322a';
  const q = svg.match(/<rect width="100" height="100" fill="(#[0-9a-f]{6})"\/><g fill="(#[0-9a-f]{6})">/i);
  return q ? { colour, metal, a: q[1], b: q[2], quarterly: true } : { colour, metal, a: colour, b: metal, quarterly: false };
}

/** The page title without "(AY 2645–2697)" or "(priest, AY 883–948)". */
export function displayName(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim() || title;
}

/** Read a person's page into a figure. `year` shows them at another year of their life (clamped to it). */
export function figureSpec(page: FigureSource, opts: { year?: number } = {}): FigureSpec | null {
  if (!page.id.startsWith('per:')) return null;
  const sigil: SigilSpec = page.sigil ?? [page.id, 'm', page.sub ?? '', page.title, 0, -1, 0, -1, 0];
  const born = parseYear(row(page, 'Born')) ?? page.t0;
  const diedRow = row(page, 'Died');
  const living = /^living/i.test(diedRow);
  const died = living ? null : parseYear(diedRow) ?? page.t1;
  const death = living ? '' : diedRow.match(/\(([a-z -]+)\)/i)?.[1]?.toLowerCase() ?? 'natural';
  const roles = parseRoles(row(page, 'Roles'));
  const role = sealRole(sigil);
  const main = roles.find((r) => r.role === role) ?? roles[0] ?? null;
  const end = died ?? Math.max(born, Math.min(5000, page.t1));
  let year = main ? Math.round((main.start + Math.max(main.start, main.end)) / 2) : born + 35;
  if (opts.year !== undefined && Number.isFinite(opts.year)) year = Math.round(opts.year);
  year = Math.max(born, Math.min(end, year));
  const people = Number(row(page, 'People').match(/\[\[cul:(\d+)\|/)?.[1] ?? -1);
  return {
    id: page.id,
    name: displayName(page.title),
    sex: sigil[1] === 'f' ? 'f' : 'm',
    born, died, death, roles, role,
    roles2: new Set(roles.map((r) => r.role).concat(sigil[2].split(',').filter(Boolean))),
    era: Math.max(0, Math.min(6, sigil[4])),
    dynasty: sigil[5],
    house: row(page, 'House') || null,
    people,
    flags: sigil[8],
    sigil,
    tinctures: tincturesOf(sigil),
    year,
    age: year - born,
    main,
  };
}

/** FNV-1a with an avalanche (the same function heraldry.ts uses): the only "chance" in a piece is a hash of its id. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

export const ERA_NAMES = ['Age of Bronze', 'Age of Iron', 'Age of Coin and Creed', 'Age of Parchment and Plough', 'Age of Sail and Print', 'Age of Engines', 'Age of Networks'];

const ROLE_WORD: Record<string, [string, string]> = {
  ruler: ['King', 'Queen'], regent: ['Regent', 'Regent'], usurper: ['Usurper', 'Usurper'], general: ['General', 'General'],
  president: ['President', 'President'], chairman: ['Chairman', 'Chairwoman'], merchant: ['Merchant', 'Merchant'],
  priest: ['Priest', 'Priestess'], prophet: ['Prophet', 'Prophetess'], philosopher: ['Philosopher', 'Philosopher'],
  scribe: ['Scribe', 'Scribe'], historian: ['Historian', 'Historian'], envoy: ['Envoy', 'Envoy'], inventor: ['Inventor', 'Inventor'],
  rebel: ['Rebel', 'Rebel'], archaeologist: ['Archaeologist', 'Archaeologist'], translator: ['Translator', 'Translator'],
};
/** "Ruler of Virnado, 380–412" — the line under a piece's name. Rulers are "ruler" (the record does not say king). */
export function roleLine(f: FigureSpec): string {
  const r = f.main;
  if (!r) return '';
  const w = r.role === 'ruler' ? 'Ruler' : (ROLE_WORD[r.role]?.[f.sex === 'f' ? 1 : 0] ?? r.role[0].toUpperCase() + r.role.slice(1));
  const yrs = r.end > r.start ? `${r.start}–${r.end}` : `${r.start}`;
  return `${w}${r.place ? ` of ${r.place}` : ''}, ${yrs}`;
}

/** "AY 354–412", "40 before AY 0 – AY 10", "born AY 4970". */
export function lifeLine(f: FigureSpec): string {
  const y = (n: number) => (n < 0 ? `${-n} before AY 0` : `AY ${n}`);
  if (f.died === null) return `born ${y(f.born)}`;
  if (f.born < 0) return `${y(f.born)} – ${y(f.died)}`;
  return `AY ${f.born}–${f.died}`;
}

const HOLDS: Record<string, (f: FigureSpec) => string> = {
  ruler: (f) => (f.roles2.has('rebel') ? 'a crown and the banner of the broken chain (rebel, then ruler)' : f.roles2.has('usurper') ? 'a crown, a sceptre and a drawn sword (usurper, then ruler)' : 'a crown and a sceptre'),
  regent: () => 'the seal of state, held for a child, and the keys at the belt',
  general: (f) => (f.era <= 1 ? 'a helmet, a shield painted with the seal, and a spear' : f.era <= 3 ? 'a helmet, a shield painted with the seal, and a sword' : f.era === 4 ? 'a morion and a sword' : f.era === 5 ? 'a shako, a sabre and a rifle' : 'a steel helmet and a rifle'),
  president: () => 'a rolled charter and a sash',
  chairman: () => 'a torch (the charge of the seal)',
  merchant: (f) => (f.era >= 4 ? 'scales and a ledger' : 'scales and a purse'),
  priest: () => 'a staff and a censer',
  prophet: () => 'a staff crowned with a star',
  philosopher: () => 'a book',
  scribe: (f) => (f.era <= 1 ? 'a clay tablet and a stylus' : f.era === 2 ? 'a scroll and a pen' : f.era <= 4 ? 'a book and a quill' : 'a book and a pen'),
  historian: (f) => (f.era <= 1 ? 'a clay tablet and a stylus' : f.era === 2 ? 'a scroll and a pen' : f.era <= 4 ? 'a book and a quill' : 'a book and a pen'),
  translator: (f) => (f.era <= 1 ? 'a clay tablet and a stylus' : 'a book and a scroll'),
  envoy: () => 'a letter sealed in the state’s colours',
  rebel: () => 'the banner of the broken chain',
  inventor: (f) => (f.era <= 2 ? 'a wheel and a mallet' : f.era <= 4 ? 'dividers and a square' : 'a wrench and a cogwheel'),
  archaeologist: () => 'a trowel and a brush',
};

/** Why the piece looks as it does, line by line, each from the record. */
export function figureNotes(f: FigureSpec, blazon: string): string[] {
  const out: string[] = [];
  out.push(`Shown ${f.age < 1 ? 'as a newborn' : `aged ${f.age}`}, in ${f.year < 0 ? `${-f.year} before AY 0` : `AY ${f.year}`}${f.main ? ` (${f.main.role}${f.main.place ? ` of ${f.main.place}` : ''})` : ''}${f.age >= 60 ? ': grey hair' : f.age < 15 ? ': a child' : ''}${f.age >= 62 ? ', stooped' : ''}.`);
  out.push(`Dress of the ${ERA_NAMES[f.era]}, the age of their prime${f.people >= 0 ? '; the hem’s band is their people’s' : ''}.`);
  out.push(f.tinctures.quarterly ? `Colours of their house${f.house ? ` (${f.house})` : ''}, quartered as on the seal: ${blazon}.` : `Colours of the state they served, as on their seal: ${blazon}.`);
  const h = HOLDS[f.role];
  if (h) out.push(`Holds ${h(f)}.`);
  if (f.death === 'battle') out.push('A black armband: fell in battle.');
  if (f.death === 'executed') out.push('A black cloth over the base: executed.');
  return out;
}
