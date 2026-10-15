// The Word Machine's data: the concept index, one lazy file per word, and a word's derivation in a language.

import type { WordJson, WordsIndexJson } from '../../engine/src/export/contract.ts';
import { fetchJson } from './data.ts';
import type { LangIndex } from './languages.ts';

export type Step = WordJson['langs'][number]['steps'][number];
export type Concept = WordsIndexJson['concepts'][number];

export const loadWordsIndex = () => fetchJson<WordsIndexJson>('words/index.json');
export const loadWord = (concept: string) => fetchJson<WordJson>(`words/${encodeURIComponent(concept)}.json`);

export const YEAR_MIN = -3200, YEAR_MAX = 5000;

/** 'great-king' → 'great king' */
export const gloss = (concept: string) => concept.replace(/-/g, ' ');

/** −2478 or 4919 (the derivation's compact dates). */
export const fy = (y: number) => (y < 0 ? `−${-y}` : String(y));

/** A step's form as written: proto-forms are reconstructions and carry an asterisk. */
export const shown = (s: Step) => (s[3] === 'proto' ? `*${s[1]}` : s[1]);

/** The last step at or before `y` (null before the first). Steps are in year order. */
export function stepAt(steps: Step[], y: number): Step | null {
  let lo = 0, hi = steps.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid][0] <= y) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at < 0 ? null : steps[at];
}

/** The language's ancestry, root first, ending with the language itself. */
export function ancestry(ix: LangIndex, id: string): string[] {
  const out: string[] = [];
  for (let l = ix.byId.get(id); l; l = l.parent ? ix.byId.get(l.parent) : undefined) out.unshift(l.id);
  return out;
}

/**
 * proto: a family's reconstructed root; law: a dated sound law; replaced: the word swapped for a borrowing;
 * split: a daughter inherits the form unchanged; respelled: inherited in the daughter's own spelling;
 * swapped: the daughter carried a different word from the moment it split off.
 */
export type LinkKind = 'proto' | 'law' | 'replaced' | 'split' | 'respelled' | 'swapped';
export interface Link { y: number; form: string; ipa: string; change: string | null; lang: string; kind: LinkKind }

/** The full derivation of a word in a language: root → … → parent → the language, each step tagged. */
export function derivation(byLang: Map<string, Step[]>, ix: LangIndex, id: string): Link[] {
  const ids = ancestry(ix, id);
  const out: Link[] = [];
  ids.forEach((lid, i) => {
    const until = i + 1 < ids.length ? ix.byId.get(ids[i + 1])!.born : Infinity;
    for (const [y, form, ipa, change] of byLang.get(lid) ?? []) {
      if (y >= until) break;
      const prev = out[out.length - 1];
      const kind: LinkKind = change === 'proto' || !prev ? 'proto'
        : change === 'replaced' ? 'replaced'
        : change !== null ? 'law'
        : prev.form === form ? 'split' : prev.ipa === ipa ? 'respelled' : 'swapped';
      out.push({ y, form: kind === 'proto' ? `*${form}` : form, ipa, change, lang: lid, kind });
    }
  });
  return out;
}

/** Where a sound law is listed: the language page it happened in, scrolled to that law. */
export function lawHref(lang: string, y: number, law: string): string {
  return `#/p/${lang}?sc=${y}&law=${encodeURIComponent(law)}`;
}
