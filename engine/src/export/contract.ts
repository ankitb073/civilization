// The data contract between the engine (producer) and the atlas (consumer).
// Files live under atlas/public/data/. Pure types + tiny pure helpers only:
// this module is imported by both Node and the browser.

import { hashString } from '../core/rng.ts';

export type EntityKind =
  | 'polity' | 'person' | 'settlement' | 'region' | 'river' | 'culture' | 'language'
  | 'script' | 'movement' | 'deity' | 'currency' | 'house' | 'tech' | 'climate'
  | 'event' | 'artifact';

/** Entity ids look like "pol:12", "per:345", "evt:9001", "art:42". */
export const KIND_PREFIX: Record<EntityKind, string> = {
  polity: 'pol', person: 'per', settlement: 'set', region: 'reg', river: 'riv', culture: 'cul',
  language: 'lan', script: 'scr', movement: 'mov', deity: 'dei', currency: 'cur', house: 'hou',
  tech: 'tec', climate: 'cli', event: 'evt', artifact: 'art',
};

export function kindOf(id: string): EntityKind {
  const p = id.slice(0, id.indexOf(':'));
  for (const k of Object.keys(KIND_PREFIX) as EntityKind[]) if (KIND_PREFIX[k] === p) return k;
  throw new Error(`unknown id prefix: ${id}`);
}

export const SHARD_COUNT = 256;
export function shardOf(id: string): number {
  return hashString(id) % SHARD_COUNT;
}
export function shardFile(n: number): string {
  return `pages/${n.toString().padStart(3, '0')}.json`;
}

// ---------------------------------------------------------------- meta.json
export interface Era { id: string; name: string; start: number; end: number; blurb: string }

export interface MetaJson {
  title: string;
  subtitle: string;
  worldName: string;
  seed: number;
  engineVersion: string;
  yearStart: number;           // 0
  yearEnd: number;             // 5000
  yearLabel: string;           // "AY" (Archive Year)
  counts: Record<string, number>;
  eras: Era[];
  check: {
    passed: boolean;
    invariants: { id: string; title: string; checked: number; violations: number }[];
  };
  editorialLanguage: string;
  downloads: { label: string; href: string; bytes: number }[];
  featured: { id: string; title: string; why: string }[]; // curated entry points
  /** Ids of the agent-written flagship documents. */
  flagships: string[];
  /** Fingerprint of the simulated world the archive was generated from. */
  world: string;
}

// ---------------------------------------------------------------- world.json
export interface WorldJson {
  width: number;
  height: number;
  /** Flat [x0, y0, x1, y1, ...] Voronoi sites. Atlas rebuilds cells with
   *  d3-delaunay: Delaunay.from(pairs).voronoi([0, 0, width, height]). */
  points: number[];
  /** 0..255 per cell. Cells with elevation < seaLevel are water. */
  elevation: number[];
  seaLevel: number;
  biome: number[];
  biomes: { id: number; name: string; color: string }[];
  /** Polylines through cell sites, source → mouth; width grows downstream (1..6). */
  rivers: { id: string; name: string; cells: number[]; width: number[] }[];
  regions: { id: string; name: string; labelCell: number }[];
  /** Region index per cell, -1 for water. */
  regionOf: number[];
}

// ---------------------------------------------------------------- timeline.json
/** A per-cell categorical layer that changes over time (ownership, culture, religion). */
export interface Layer {
  legend: { idx: number; id: string; name: string; color: string; start: number; end: number }[];
  keyframeEvery: number;       // 100
  /** keyframes[k] = state at year k*keyframeEvery. base64 of little-endian Int16Array, one value
   *  per cell = legend idx or -1. */
  keyframes: string[];
  /** Every change, in order, column-wise for compression: base64 of three little-endian arrays
   *  back to back, each `deltaCount` long: Uint16 year steps (the first relative to `deltaBase`,
   *  each later one relative to the previous year), Uint16 cell, Int16 idx (-1 = none).
   *  To get year Y: take keyframe ⌊Y/keyframeEvery⌋ and apply the changes with
   *  keyframeYear < year <= Y in order. */
  deltas: string;
  deltaCount: number;
  deltaBase: number;
}

export interface TimelineJson {
  /** The political layer is inline; the others are fetched on demand from `layerFiles`. */
  layers: { political: Layer; culture?: Layer; religion?: Layer };
  layerFiles: { culture: string; religion: string };
  polities: {
    idx: number;               // == political legend idx
    id: string;
    names: [year: number, name: string][];  // name as of year (conventional, editorial)
    capitals: [year: number, settlementIdx: number][];
  }[];
  settlements: {
    idx: number; id: string; name: string; cell: number; start: number; end: number;
    pop: [year: number, pop: number][];      // per century
  }[];
  /** The most significant located events (a few hundred per century at most). */
  events: {
    id: string; year: number; end: number; sub: string; title: string;
    cell: number;              // -1 if not located
    sig: number;               // 0..1 significance, for marker filtering
  }[];
  /** Global climate anomaly per decade. temp in °C vs. baseline, precip as fraction. */
  climate: { year: number; temp: number; precip: number }[];
  /** Trade routes per century: [settlementIdxA, settlementIdxB, relative volume 0..1]. */
  routes: { year: number; edges: [number, number, number][] }[];
}

// ---------------------------------------------------------------- graph.json
/** Columnar for size. Positions precomputed with ForceAtlas2 at build time. */
export interface GraphJson {
  ids: string[];
  labels: string[];
  kinds: EntityKind[];
  x: number[];
  y: number[];
  size: number[];
  t0: number[];                // existence start (year)
  t1: number[];                // existence end (year)
  /** Flat [sourceIdx, targetIdx, ...]. Undirected for display. */
  edges: number[];
}

// ---------------------------------------------------------------- search.json
/** [id, title, kind, t0, aliases joined by "|", sub] — sub is the page's sub-type (e.g. 'treaty', 'war'). */
export type SearchEntry = [string, string, EntityKind, number, string, string];
export interface SearchJson { entries: SearchEntry[] }

// ---------------------------------------------------------------- pages/NNN.json
export interface InterlinearText {
  transliteration: string;
  normalized: string;
  tokens: { normalized: string; segmented: string; gloss: string }[];
  translation: string;
}

export interface PageJson {
  id: string;
  kind: EntityKind;
  sub: string;                 // e.g. event 'war' | 'battle' | 'treaty'..., artifact 'treaty' | 'ledger'...
  title: string;
  t0: number;
  t1: number;
  summary: string;
  infobox: [label: string, value: string][];   // values may contain [[id|text]] links
  /** Markdown. Links are written [[id|display text]]. Headings, lists, tables, blockquotes,
   *  emphasis. Lacunae appear as [...] and are plain text. */
  body: string;
  links: string[];
  backlinks: string[];
  /** Display titles for every id in links/backlinks (so pages render without the search index). */
  labels: Record<string, string>;
  /** Total backlinks when the list was truncated for size (hub pages). */
  backlinkCount?: number;
  cell: number;                // map focus cell, -1 if none
  /** Name of this entity through time and across languages. */
  names?: { year: number; lang: string; form: string; scholarly: string }[];
  /** Small multiples for sparklines (area, population, prices, adherents...). */
  /** `decadal`: each point is a decade survey (x = decade start; the state at its end), shown as "1650s". */
  series?: { label: string; unit: string; points: [number, number][]; decadal?: boolean }[];
  artifact?: {
    catalog: string;           // "PAL·TR·00347"
    date: string;              // as written, in the local calendar
    language: string;          // display names (also linked in infobox)
    script: string;
    medium: string;
    authorId?: string;
    condition: string;
    provenance: string;
    translatorId?: string;
    flagship: boolean;
    /** A flagship's static reading page with its social card, relative to the site root ("s/fl-905.html"). */
    permalink?: string;
    interlinear?: InterlinearText;
    ledger?: { columns: string[]; rows: string[][]; notes: string[] };
    rival?: { eventId: string; side: string };
  };
  /** For events with competing accounts: ground truth vs. what each source claims. */
  accounts?: {
    truth: [field: string, value: string][];
    sources: { artifactId: string; side: string; author: string; claims: [field: string, value: string][] }[];
  };
  /** For languages. */
  language?: {
    soundChanges: { year: number; rule: string; label: string; lang: string }[];
    words: { concept: string; forms: [year: number, form: string][] }[];
    daughters: string[];
    parent: string | null;
  };
  /** A state's, city's or faith's coat of arms (drawn atlas-side by atlas/src/heraldry.ts). */
  arms?: ArmsSpec;
  /** A person's seal (atlas/src/heraldry.ts). */
  sigil?: SigilSpec;
  /** Battles: what the diorama (#/battle/evt:N) is drawn from. */
  battle?: BattleJson;
}

export interface ShardJson { pages: PageJson[] }

// ---------------------------------------------------------------- pages[].battle (engine/src/export/battle.ts)
/** A battle as the diorama draws it. Pairs are [attacker, defender]. All of it is read from the record except
 *  `claims`, which are read from the surviving documents' own text. */
export interface BattleJson {
  size: [number, number];
  losses: [number, number];
  won: 0 | 1;
  decisive: number;          // 0..1, as recorded
  fell: -1 | 0 | 1;          // whose commander was killed in the battle (-1: neither)
  arms: [ArmsSpec, ArmsSpec];
  seals: [SigilSpec | null, SigilSpec | null];   // the commanders'
  /** The military techs each side knew that year: bit i set for BATTLE_KIT[i] (bronze, chariot, iron, cavalry,
   *  crossbow, gunpowder, rifles, railway, combustion, aviation). */
  kit: [number, number];
  town: number;              // the nearest settlement's population that century (0: none)
  claims: BattleClaim[];
}
/** What one surviving document says about one battle (null where it says nothing). */
export interface BattleClaim {
  art: string;
  kind: 'chronicle' | 'stele' | 'telegram' | 'newspaper' | 'muster';
  side: 0 | 1;               // whose document it is
  size: [number | null, number | null];
  losses: [number | null, number | null];
  won: 0 | 1 | null;         // who it says won
  arms?: [arm: string, men: number][];   // muster rolls: the men of each arm, as listed
}
/** The military techs a battle's `kit` bits stand for, in order of their coming. */
export const BATTLE_KIT = ['bronze', 'chariot', 'iron', 'cavalry', 'crossbow', 'gunpowder', 'rifles', 'railway', 'combustion', 'aviation'] as const;

// ---------------------------------------------------------------- heraldry (pages[].arms and .sigil, deck.json)
/** What a coat of arms is drawn from, all of it read from the record: [page id, culture (sets the colour),
 *  religion (sets the metal; -1 none), form (a state's main government; 'city' | 'port'; 'faith:<movement kind>'),
 *  era index into meta.eras (sets the shield's shape), flags (ARMS_*)]. The drawing is a pure function of this. */
export type ArmsSpec = [id: string, culture: number, religion: number, form: string, era: number, flags: number];
export const ARMS_NAVAL = 1;      // founded colonies, or a merchant republic ruled from a port
export const ARMS_INDUSTRIAL = 2; // took up the steam engine early in its life
export const ARMS_COLONY = 4;
export const ARMS_HORDE = 8;
export const ARMS_REBEL = 16;
/** What a person's seal is drawn from: [page id, sex, every role they held (comma-separated, in order), name,
 *  era index of their prime (their first role), dynasty (-1 none), the culture and religion of the state they served
 *  (its tinctures; their own culture and -1 when they served none), flags (ARMS_NAVAL when that state was a sea power)]. */
export type SigilSpec = [id: string, sex: 'm' | 'f', roles: string, name: string, era: number, dynasty: number, culture: number, religion: number, flags: number];

// ---------------------------------------------------------------- deck.json
/** Clash of the Ages: a deck of cards drawn from the record. Every stat is a count or a maximum over the record
 *  (roles, war and battle events, the territory log, the decadal polity survey), checkable against world.sqlite;
 *  `how` says how each is counted. Higher always wins. */
export type CardKind = 'ruler' | 'general' | 'state' | 'city' | 'faith';
export interface DeckJson {
  kinds: { id: CardKind; name: string; stats: { key: string; label: string; unit: string; how: string }[] }[];
  cards: {
    id: string;                // the page the card links to (per:N, pol:N, set:N, mov:N)
    kind: CardKind;
    name: string;              // the page title
    role: string;              // "Ruler of Tallin", "General of Yida", "Jinru people · capital Taulin"
    years: [number, number];   // the reign, the campaigns (first to last battle), or the life of the state, city or faith
    era: number;               // index into meta.eras
    rarity: 0 | 1 | 2 | 3;     // common, rare, epic, legendary: by significance within the kind
    stats: number[];           // in the order of kinds[].stats
    arms: ArmsSpec;            // the card's own arms, or (rulers, generals) the arms of the state they served
    sigil?: SigilSpec;         // rulers and generals
  }[];
}

// ---------------------------------------------------------------- story.json
/** A guided reading of the five millennia: one chapter per era, each a handful of beats
 *  (turning points) with the best documents to read about them. */
export interface StoryJson {
  chapters: {
    eraId: string;
    title: string;
    start: number;
    end: number;
    intro: string;                         // Markdown with [[id|text]] links
    beats: {
      year: number;
      eventId: string;
      title: string;
      text: string;                        // Markdown with links
      cell: number;                        // map focus
      docs: { id: string; title: string; flagship: boolean }[];
    }[];
  }[];
}

// ---------------------------------------------------------------- languages.json
/** The tree of tongues: every language with its parent, life span and speakers, for a dendrogram
 *  through time and a languages map layer (culture idx → language). */
export interface LanguagesJson {
  languages: {
    id: string; name: string; parent: string | null; family: string; born: number; died: number | null;
    soundChanges: number; style: string; speakers: string[];   // culture ids
    sample: [concept: string, early: string, late: string][];  // a few words at birth and at end
  }[];
  /** culture idx (as in layer-culture legend) → language id */
  cultureLanguage: Record<number, string>;
}

// ---------------------------------------------------------------- words/index.json, words/<concept>.json (lazy)
/** The Word Machine: how one word changed in every language, with each dated sound law. */
export interface WordsIndexJson {
  /** core: basic vocabulary; culture: kings, gods, money, war, writing, machines */
  concepts: { id: string; group: 'core' | 'culture'; modern: string }[];
  /** the language the modern sample is in (the archive's editorial language) */
  sampleLanguage: string;
}
export interface WordJson {
  concept: string;
  /** Each language's own stretch of the word's history: the form it inherited at its birth (change null;
   *  'proto' for a family root), then every change of form: a sound law's label, or 'replaced' when
   *  the word itself was swapped (borrowing). Ancestors' steps are in their own entries. */
  langs: { id: string; steps: [year: number, form: string, ipa: string, change: string | null][] }[];
}

// ---------------------------------------------------------------- economy.json
/** Five millennia of prices: medians across markets, in grams of silver, plus every currency's
 *  silver content over time. */
export interface EconomyJson {
  goods: { id: number; key: string; name: string; unit: string }[];
  /** per decade: [year, median grain price, median tin price, median iron price, markets counted] */
  prices: [number, number | null, number | null, number | null, number][];
  /** world price level per decade (median of all goods relative to their base) */
  priceLevel: [number, number][];
  currencies: { id: string; name: string; issuer: string; kind: string; history: [number, number][] }[];
  events: { id: string; year: number; sub: string; title: string }[];   // debasements, panics, hyperinflations, trade collapses
}

// ---------------------------------------------------------------- collections.json
/** Curated reading lists generated from the record. */
/** The lying-chronicle game: wars told by both sides, with what each scribe claimed and what the record holds. */
export interface GameJson {
  rounds: {
    war: string;               // evt:N
    title: string;
    years: [number, number];
    sides: [string, string];   // display names: attacker, defender
    truth: { lossesA: number; lossesD: number; began: string; outcome: string };
    accounts: { art: string; side: 'attacker' | 'defender'; author: string; lossesA: number; lossesD: number; began: string; outcome: string }[];
  }[];
}

export interface CollectionsJson {
  collections: { id: string; title: string; blurb: string; items: { id: string; title: string; note: string; year: number }[] }[];
}

// ---------------------------------------------------------------- dynasties.json
/** Family trees of the greatest ruling houses. */
export interface DynastiesJson {
  dynasties: {
    id: string; name: string; polity: string; start: number; end: number;
    members: { id: string; name: string; sex: 'm' | 'f'; born: number; died: number; parent: string | null; reign: [number, number] | null; epithet: string | null }[];
  }[];
}

// ---------------------------------------------------------------- figures.json
/** The subjects of the Lives as figurines (#/figures, atlas/src/three/figure): each Life (art:N) with its subject's
 *  person page cut to what a figure is built from (the same rows the page carries, so a piece is identical everywhere). */
export type FigurePage = Pick<PageJson, 'id' | 'title' | 'sub' | 't0' | 't1' | 'infobox' | 'sigil'>;
export interface FiguresJson {
  pieces: { life: string; page: FigurePage }[];
}

// ---------------------------------------------------------------- histomap.json
/** A "Histomap": every state as a stream whose width is its share of the world's population.
 *  Streams are ordered west → east by capital, so neighbours flow side by side. */
export interface HistomapJson {
  years: number[];                       // sample years (every 20)
  worldPop: number[];                    // total population per sample
  series: {
    id: string;                          // polity id, or 'other' / 'stateless'
    name: string;
    color: string;
    order: number;                       // vertical order (0 = west)
    start: number;
    end: number;
    share: number[];                     // 0..1 share of world population per sample year
  }[];
}

// ---------------------------------------------------------------- river.json
/** The River of Time (#/river, a 3D Histomap). Its own streams: the Histomap's, plus every state that ever held 2.5%
 *  of the world's people (so the early centuries are as full as the late), on histomap.json's sample years. Every
 *  number is a decade survey (polity_years) at the sample year; stones are the record's great events. */
export interface RiverJson {
  years: number[];                       // == histomap.json years (every 20)
  land: number;                          // land districts in the world (the districts share's denominator)
  pop: number[];                         // people in all states, per sample (the people share's denominator)
  army: number[];                        // soldiers under arms in all states, per sample
  series: {
    id: string;                          // pol:N, or 'other' (every lesser state together)
    name: string;
    color: string;                       // the state's colour, as on the map and the Histomap
    order: number;                       // west → east by first capital
    start: number;
    end: number;
    i0: number;                          // index into years of the first value below
    share: number[];                     // share of the world's people (0..1), per sample from i0
    cells: number[];                     // districts held, per sample from i0
    army: number[];                      // soldiers, per sample from i0
    arms?: ArmsSpec;                     // states only
  }[];
  stones: {
    id: string;                          // the page (evt:N or cli:N)
    year: number;
    kind: 'war' | 'plague' | 'eruption' | 'contact' | 'writing' | 'trade' | 'famine';
    title: string;
    figure: string;                      // "1,654,464 fell", "VEI 7", …
    mag: number;                         // 0..1 within its kind (sets the stone's height)
  }[];
}

// ---------------------------------------------------------------- cities.json
/** Cities in 3D (#/city/set:N, atlas/src/three/city): what a city's model needs beyond timeline.json and its page,
 *  as change points read from the record (engine/src/export/cities.ts). Fetched only by the city view. */
export interface CitiesJson {
  owners: number[][];                    // per settlement idx: flat [year, polity idx (-1 none), …] from its founding (territory log at its cell)
  cultures: number[][];                  // per settlement idx: flat [year, culture idx, …] from its founding (culture log at its cell)
  sacks: number[][];                     // per settlement idx: the years it was sacked
  port: number[];                        // per settlement idx: 1 if a port
  states: number[][];                    // per polity idx: flat [year, state faith (movement idx, -1 none), technological age (index into meta.eras), …] (decadal survey)
  faiths: [name: string, kind: string, parent: number][]; // per movement idx
  peoples: string[];                     // per culture idx: its name
}

// ---------------------------------------------------------------- museum.json
/** The Museum (#/museum): celebrated documents shown as 3D objects built from their records. Each is picked by a
 *  rule over the extant archive (the oldest dated document, the biggest boast in stone, the first coin…; see
 *  engine/src/export/museum.ts), oldest first. `page` is the document's page, trimmed (no link lists, the body cut at
 *  a paragraph, the gloss without per-word tokens); `arms` are the coats of arms of the states it names (its issuer
 *  first) and `sigil` its author's seal, for the emblems and seals the object carries. */
export interface MuseumJson {
  items: { id: string; why: string; page: PageJson; arms: Record<string, ArmsSpec>; sigil?: SigilSpec }[];
}

// ---------------------------------------------------------------- scenarios.json
/** The Tablet House (#/tablet, docs/lld/tablet-house.md): the playable moments, built by engine/src/export/scenarios.ts
 *  and recounted from world.sqlite by engine/test/scenarios.test.ts. Each is a siege or sack of a literate state's
 *  capital and the battle of the same war that brought the enemy to its walls. "Ours" is always the besieged state (the
 *  scribe's side), "theirs" the besieger. Names are the period forms the defender's own scribes wrote at the date (the
 *  archive's naming, as the flagship dossiers' allowedLinks texts). Prices are grams of silver per measure of grain.
 *  The fields after the first block of each object are additions to the design's shape (never removals). */
export type ScenarioOutcome = 'sacked' | 'conquered' | 'treaty' | 'held';
export interface Scenario {
  id: string;                    // "sc-<eventId>"
  event: number; year: number;   // the siege/sack event and its year
  city: {
    id: string; name: string; pop: number; cell: number; port: boolean;     // pop: the last century census at or before the year
    region: string; people: string; peopleId: string;                      // the region, and the people whose names are in `names`
    arms: ArmsSpec; sacked: number; founded: number;                       // earlier sacks of the city; its founding year
  };
  state: {
    id: string; name: string; ruler: { id: string; name: string; sex: 'm' | 'f'; age: number;
      title: string; since: number; died: number; deathCause: string };   // title as the state's documents style it (king, queen, great king, lord…)
    faith: string; gods: { name: string; sex: 'm' | 'f'; role: string; id: string }[];   // role: the god's domain
    coin: string | null; grain: number | null;                             // grain: grams of silver per measure at the city's market
    faithId: string; faithKind: string; coinId: string | null; coinSilver: number | null; // grams of silver per coin at the date
    grainCoin: number | null;                                              // the grain price in coins
    gov: string; language: string; langId: number; arms: ArmsSpec;
  };
  enemy: { id: string; name: string; ruler: { id: string; name: string; sex: 'm' | 'f'; age: number; title: string }; arms: ArmsSpec };
  medium: string;                // clay tablet / papyrus / parchment / paper / typescript: the palace scribe's material at that date
  script: string;                // the script's name
  scriptKind: string;            // logosyllabic | syllabary | abjad | alphabet
  battle: {
    id: string; place: string; ours: number; theirs: number; oursLost: number; theirsLost: number;
    won: boolean; commander: { name: string; sex: 'm' | 'f'; isKing: boolean; id: string; age: number; killed: boolean };
    year: number; name: string; placeId: string; decisive: number;
    date: string;                // the day as the defender's scribes dated it
    enemyCommander: { id: string; name: string; sex: 'm' | 'f'; killed: boolean } | null;
  };
  outcome: ScenarioOutcome;      // sacked: the sack; conquered: the realm annexed within two years; treaty: peace within two years; held: neither
  burnedArchives: boolean;
  treaty: {
    id: string; ceded: number;   // districts the defender gave up
    tribute: string | null;      // the yearly tribute the defender must pay, as its own money reckons it
    truce: number | null;        // years
    text: string | null;         // the surviving treaty document (links as plain text, without the editors' note and [AY] marks)
    kind: 'treaty' | 'conquest'; name: string; year: number; signedAt: string | null; towns: string[];
    indemnity: string | null; tributeKg: number | null; tributeYears: number | null; indemnityKg: number | null;
    terms: string[];             // the kinds of every term, in order (cede, tribute, truce, annexation…)
    catalog: string | null; doc: string | null;
  } | null;
  hardship: {
    famine: boolean; plague: string | null; drought: boolean;
    grainBefore: number | null;  // the price a decade or more before (the nearest earlier survey)
    grainAfter: number | null;   // the first survey after the year (null: the market no longer reported)
    famineId: string | null; plagueId: string | null; droughtId: string | null;
  };
  /** The defender side's surviving chronicle of the war. oursLost/theirsLost/claimsWon are what it says of THIS
   *  battle, read from its surviving text (null when it passes over the battle); war* are its totals for the war. */
  chronicle: {
    catalog: string; author: string; year: number; oursLost: number | null; theirsLost: number | null;
    outcomeWords: string | null; // its closing words on the war, verbatim after the date
    quote: string | null;        // one verbatim sentence (this battle's tally when it tells it)
    id: string; title: string; authorId: string | null; medium: string; condition: string;
    tellsBattle: boolean; claimsWon: boolean | null;
    warOursLost: number | null; warTheirsLost: number | null; outcomeClaim: string | null;
  } | null;
  names: { f: string[]; m: string[] }; // names in use among the city's people at the time (right sex)
  /** Optional 3D framing in atlas/src/terrain scene units (SCALE 0.01, origin at the map's centre), looking north. */
  camera: { x: number; y: number; z: number; target: [number, number, number] } | null;
  sub: 'siege' | 'sack';
  title: string;                 // the event page's title
  date: string;                  // the day of the siege as the defender's scribes dated it
  era: string; eraIndex: number; // the defender's technological era (Bronze Age … Post-industrial), 0..6
  /** The whole war, from the record's battles (ours = the defender). */
  war: { id: string; name: string; start: number; end: number; goal: string; battles: number; won: number; oursLost: number; theirsLost: number; outcome: 'won' | 'lost' | 'stalemate' | 'dissolved' };
}
export interface ScenariosJson { scenarios: Scenario[] }
