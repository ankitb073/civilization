# LLD: Language engine (`engine/src/lang/`)

## Purpose

Give every culture a real, evolving language. Names of places, people, gods and polities are coined in a language at a date. Their spelling at any later date in any language follows from documented sound changes (native lineage) or from borrowing plus adaptation (exonyms). Inscriptions are rendered as script transliteration, normalized text, interlinear gloss and English translation, all from one clause structure, so they always agree.

## Determinism rules

- The engine is constructed with a seed. Each language has its own RNG stream (`fork('lang', id)`). Each coined name gets a stream from the caller's `seedKey`. No output depends on the order of unrelated calls.
- Sound changes are a Poisson process per language with a mean gap of about 180 years. They are materialized lazily, but the times and choices depend only on that language's stream and lineage state. That makes `advanceTo(1000)` followed by `advanceTo(2000)` identical to `advanceTo(2000)` alone.
- `realize(name, lang, year)` applies only rules dated `≤ year` from the lineage path. Daughters inherit the parent's rules dated ≤ split year.

## Public API (normative; `engine/src/lang/index.ts`)

```ts
export type LangId = number;
export type NameId = number;
export type Concept = string;               // ids from concepts.ts, e.g. 'king', 'build'
export type ScriptKind = 'logographic' | 'logosyllabic' | 'syllabary' | 'abjad' | 'alphabet';
export type NameKind =
  | 'person-m' | 'person-f' | 'dynasty' | 'settlement' | 'region' | 'river' | 'mountain'
  | 'sea' | 'people' | 'polity' | 'deity' | 'movement' | 'currency' | 'house' | 'month' | 'script' | 'language';

export interface Realized { conventional: string; scholarly: string; ipa: string; }

export interface SoundChange {
  lang: LangId;        // language in which it occurred (may be an ancestor)
  year: number;
  rule: string;        // notation, e.g. "p > f / V_V"
  label: string;       // e.g. "intervocalic spirantization"
}

export interface LanguageInfo {
  id: LangId; parent: LangId | null; family: number;
  born: number; died: number | null;
  endonym: NameId;     // the language's own name (kind 'language')
  typology: { order: 'SOV' | 'SVO' | 'VSO'; adposition: 'pre' | 'post'; cases: string[] };
}

export interface NounPhrase {
  head: { concept: Concept } | { name: NameId };
  plural?: boolean;
  adjectives?: Concept[];
  possessor?: NounPhrase;              // genitive ("king of Kadrum")
  apposition?: NounPhrase[];           // "Ashur-dan, great king"
  count?: number;                      // numerals ("3000 silver")
  determinative?: 'deity' | 'place' | 'person' | 'land' | 'metal' | 'wood';
  demonstrative?: boolean;             // "this stele"
}

export interface Clause {
  verb: Concept;
  mood: 'past' | 'present' | 'future' | 'optative';  // optative for blessings/curses
  subject?: NounPhrase;
  object?: NounPhrase;
  obliques?: { role: 'dative' | 'locative' | 'instrumental' | 'ablative' | 'comitative' | 'benefactive'; np: NounPhrase }[];
  negated?: boolean;
}

export interface Token { normalized: string; segmented: string; gloss: string; }

export interface RenderedText {
  transliteration: string;   // script-faithful
  normalized: string;        // vocalized scholarly romanization
  tokens: Token[];           // interlinear (segmented + Leipzig gloss)
  translation: string;       // English free translation
}

export class LanguageEngine {
  constructor(seed: number);

  // lifecycle
  createProto(year: number, seedKey: string | number): LangId;      // new family root
  split(parent: LangId, year: number, seedKey: string | number): LangId;
  retire(lang: LangId, year: number): void;                         // extinct: no rules after
  advanceTo(year: number): void;                                    // materialize rules for all living langs
  recordContact(a: LangId, b: LangId, year: number): void;          // earliest contact kept

  // names
  coinName(lang: LangId, year: number, kind: NameKind, seedKey: string | number,
           opts?: { meaning?: Concept[]; parts?: (Concept | NameId)[] }): NameId;
  localize(name: NameId, lang: LangId, year: number): void;         // from `year`, locals speak `lang` (borrowing source chain)
  realize(name: NameId, lang: LangId, year: number): Realized;      // native or exonym
  nameMeaning(name: NameId): string | null;                         // English gloss, e.g. "red wall"
  nameOrigin(name: NameId): { lang: LangId; year: number };

  // words and text
  word(lang: LangId, concept: Concept, year: number): Realized;
  protoForm(lang: LangId, concept: Concept): string;                // "*kaṭur" in the family root
  renderClause(lang: LangId, year: number, script: { kind: ScriptKind; originLang: LangId },
               clauses: Clause[], resolveName: (n: NameId) => string): RenderedText;

  // introspection
  info(lang: LangId): LanguageInfo;
  languages(): LanguageInfo[];
  soundChanges(lang: LangId, upToYear?: number): SoundChange[];     // inherited + own, chronological
  inventory(lang: LangId, year: number): { consonants: string[]; vowels: string[] };

  // persistence
  toJSON(): unknown;
  static fromJSON(data: unknown): LanguageEngine;
}
```

`concepts.ts` exports `CONCEPTS: { id: Concept; en: string; pos: 'n' | 'v' | 'adj' | 'num'; past?: string; plural?: string }[]`. It has at least about 220 entries and must include:

- **Nature:** sun, moon, star, sky, storm, rain, river, water, sea, mountain, hill, forest, tree, stone, field, grain, barley, earth, fire, wind, snow, salt, horse, bull, cow, sheep, lion, eagle, snake, fish, ship.
- **People and kinship:** man, woman, father, mother, son, daughter, brother, people, child, slave, servant, merchant, scribe, priest, prophet, soldier, enemy, friend, stranger, elder.
- **Power:** king, great-king, queen, lord, chief, prince, governor, council, assembly, law, judge, tribute, treaty, oath, peace, war, army, battle, victory, border, boundary-stone.
- **Built things and goods:** city, wall, gate, house, temple, palace, tomb, stele, road, market, harbor, granary, gold, silver, copper, tin, bronze, iron, coin, cloth, wine, oil, spice, timber, coal, steam, engine, rail, wire, machine.
- **Religion and thought:** god, goddess, spirit, heaven, underworld, name, truth, wisdom, path, wheel, light, darkness, soul, death, life, word, book.
- **Adjectives:** great, small, new, old, high, low, white, black, red, green, holy, strong, just, eternal, first, last, far, near, rich, poor.
- **Verbs:** build, give, take, swear, rule, conquer, destroy, defeat, burn, flee, return, trade, pay, buy, sell, write, speak, say, hear, see, dwell, found, bless, curse, protect, erect, dedicate, restore, cede, die, live, love, fear, know.
- **Numerals:** one through ten, hundred, thousand.

## Internals (guidance)

- **Phonemes:** use an IPA symbol table with features (place, manner, voice for consonants; height, backness, rounding for vowels). Each proto-language picks 14–24 consonants and 3–7 vowels. Phonotactics come from a syllable template set (CV, CVC, CCV with stop+liquid onsets, and allowed codas). Basic vocabulary is 1–2 syllables; the rest is 2–3.
- **Morphology:** proto-languages pick case suffixes (or prepositions) for GEN, DAT, LOC, INS, ABL and COM. Verbs take tense/mood suffixes (PST, PRS, FUT, OPT), plus PL and NEG markers. Affixes are phoneme sequences inside the word, so sound changes erode them naturally; final vowel loss can kill a case system. Segment for glossing by finding the realized stem as a prefix of the realized word. If that fails, use the portmanteau gloss `king.GEN`.
- **Sound changes:** use a generator library of 15 or more plausible types, each instantiated against the current inventory:
  - intervocalic voicing and spirantization;
  - final devoicing;
  - apocope of final unstressed vowels in polysyllables;
  - syncope;
  - palatalization before front vowels;
  - chain vowel shifts and mergers;
  - h-loss;
  - nasal place assimilation;
  - cluster simplification;
  - rhotacism;
  - l-vocalization;
  - prothesis before sC;
  - unconditioned spirantization (p > f, k > x);
  - glide formation;
  - degemination.

  Rules never produce an empty word. If a rule would, it is skipped for that word.
- **Borrowing:** to work out the exonym of name N in language M at year t:
  1. Take the latest localization entry `(L, y) ≤ t` of N.
  2. If M is L or descends from L, the form is native.
  3. Otherwise the borrowing year is `b = max(y, earliest recorded contact between M's lineage and L's lineage)`, or `b = t` when there is no contact before t.
  4. Realize N in L at b, then adapt it to M's ancestor alive at b: map each foreign phoneme to the nearest native one by features, and repair illegal clusters and codas by epenthesis or deletion.
  5. Then apply M-lineage rules from b to t.
- **Romanization:**
  - *Scholarly:* one uniform academic system for all languages: š č ž ḫ ṭ ṣ ŋ ā ē, IPA-ish.
  - *Conventional:* a per-language orthography picked at birth and partly inherited, ASCII-leaning with occasional flavor (sh/x/š, kh/x, th/þ, y/j). The first letter is capitalized for names.
  - *Transliteration by script:*
    - alphabet: the normalized text;
    - abjad: consonants only, with long vowels as matres lectionis;
    - syllabary: CV signs hyphenated within words (`ka-tu-ru-um`);
    - logosyllabic/logographic: frequent nouns (king, god, city, land, temple, silver, son) written as logograms. When the script comes from another language, they appear in CAPS as that origin language's word (the Sumerogram convention). Logograms use determinatives (ᵈ before deities, ᵏⁱ after places, ᵐ before male persons), and everything else is syllabic.
- **English translation:** produced from the same clauses: subject, apposition, verb (with irregular pasts and `may X …` for the optative), object, then obliques ("for", "in", "with", "from", "to"). Names come through `resolveName`.

## Tests (`engine/test/lang.test.ts`)

- Determinism across call orders.
- A daughter inherits the parent's rules only up to the split year.
- Names coined in year y are unchanged when realized at y.
- Every realization is non-empty and obeys the language's phonotactics.
- Exonym adaptation removes foreign phonemes.
- Glosses contain the case labels for a case language.
- Translation mentions every name.
- `toJSON` / `fromJSON` round-trips to identical realizations.
