// Public types of the language engine (see docs/lld/language.md).

import type { Concept } from './concepts.ts';
export type { Concept } from './concepts.ts';

export type LangId = number;
export type NameId = number;
export type ScriptKind = 'logographic' | 'logosyllabic' | 'syllabary' | 'abjad' | 'alphabet';
export type NameKind =
  | 'person-m' | 'person-f' | 'dynasty' | 'settlement' | 'region' | 'river' | 'mountain'
  | 'sea' | 'people' | 'polity' | 'deity' | 'movement' | 'currency' | 'house' | 'month' | 'script' | 'language';

export interface Realized { conventional: string; scholarly: string; ipa: string }

export interface SoundChange {
  lang: LangId;
  year: number;
  rule: string;
  label: string;
}

export interface LanguageInfo {
  id: LangId;
  parent: LangId | null;
  family: number;
  born: number;
  died: number | null;
  endonym: NameId;
  typology: { order: 'SOV' | 'SVO' | 'VSO'; adposition: 'pre' | 'post'; cases: string[] };
}

export interface NounPhrase {
  head: { concept: Concept } | { name: NameId };
  plural?: boolean;
  adjectives?: Concept[];
  possessor?: NounPhrase;
  apposition?: NounPhrase[];
  count?: number;
  determinative?: 'deity' | 'place' | 'person' | 'land' | 'metal' | 'wood';
  demonstrative?: boolean;
  /** Extension: pronominal possessor ("his lord", "my father"), needed for formulae. */
  possessorPronoun?: '1sg' | '3sg.m' | '3sg.f' | '3pl';
}

export interface Clause {
  verb: Concept;
  mood: 'past' | 'present' | 'future' | 'optative';
  subject?: NounPhrase;
  object?: NounPhrase;
  obliques?: { role: 'dative' | 'locative' | 'instrumental' | 'ablative' | 'comitative' | 'benefactive'; np: NounPhrase }[];
  negated?: boolean;
}

export interface Token { normalized: string; segmented: string; gloss: string }

export interface RenderedText {
  transliteration: string;
  normalized: string;
  tokens: Token[];
  translation: string;
}
