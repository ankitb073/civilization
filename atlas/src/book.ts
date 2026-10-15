// Books in the archive: ordered collections read front to back (the History first, then Lives and Voices),
// the reader's progress through the History (this browser only), and the document of the day.

import { signal } from '@preact/signals';
import type { CollectionsJson, MetaJson } from '../../engine/src/export/contract.ts';
import { hashString } from '../../engine/src/core/rng.ts';
import { loadCollections } from './extras.ts';

export type Collection = CollectionsJson['collections'][number];

/** Collections with a reading order, in priority order (a page in two of them reads as part of the first). */
const BOOKS = ['history', 'lives', 'voices'];

export const collections = signal<CollectionsJson | null>(null);
export function ensureCollections(): Promise<CollectionsJson> {
  return loadCollections().then((c) => (collections.value = c));
}
/** The History, once collections.json is in and the engine has written at least three chapters. */
export const historyBook = (): Collection | undefined => collections.value?.collections.find((c) => c.id === 'history');

export interface Place { c: Collection; i: number }
export function placeOf(id: string): Place | null {
  const all = collections.value?.collections ?? [];
  for (const b of BOOKS) {
    const c = all.find((x) => x.id === b);
    const i = c ? c.items.findIndex((it) => it.id === id) : -1;
    if (c && i >= 0) return { c, i };
  }
  return null;
}

/** "Introduction" or "Chapter 5" for the History (from the engine's note); the position elsewhere. */
export function partName(c: Collection, i: number): string {
  return c.id === 'history' ? c.items[i].note.split(' · ')[0] : `${i + 1} of ${c.items.length}`;
}
/** Number of numbered chapters (the Introduction is not one); robust to chapters still being written. */
export function chapterCount(c: Collection): number {
  let n = 0, hi = 0;
  for (const it of c.items) { const m = /^Chapter (\d+)/.exec(it.note); if (m) { n++; hi = Math.max(hi, +m[1]); } }
  return Math.max(n, hi);
}

// ---------------------------------------------------------------- reading progress (History only)
export interface Progress { id: string; part: string; title: string; done: string[] }
const KEY = 'pal-reading';
function readProgress(): Progress | null {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return p && typeof p.id === 'string' ? { done: [], ...p } : null; } catch { return null; }
}
export const progress = signal<Progress | null>(readProgress());
function save(p: Progress) {
  progress.value = p;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}
export function markOpened(pl: Place) {
  if (pl.c.id !== 'history') return;
  const it = pl.c.items[pl.i];
  const p = progress.peek();
  if (p?.id !== it.id) save({ id: it.id, part: partName(pl.c, pl.i), title: it.title, done: p?.done ?? [] });
}
export function markDone(id: string) {
  const p = progress.peek();
  if (p && !p.done.includes(id)) save({ ...p, done: [...p.done, id] });
}
/** Where "Continue reading" should go: the chapter last opened, or the next one once that was finished. */
export function continueAt(c: Collection | undefined, p: Progress | null): { id: string; part: string; title: string } | null {
  if (!p) return null;
  if (!c) return p;
  const i = c.items.findIndex((it) => it.id === p.id);
  if (i < 0) return null;
  const j = p.done.includes(p.id) && i + 1 < c.items.length ? i + 1 : i;
  if (j === i && p.done.includes(p.id)) return null; // finished the book
  return { id: c.items[j].id, part: partName(c, j), title: c.items[j].title };
}

// ---------------------------------------------------------------- today in the archive
/** The viewer's local date, YYYY-MM-DD. */
export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** The document of the day: the same flagship for everyone on the same date. */
export function docOfDay(m: MetaJson, key = todayKey()): string | null {
  const f = m.flagships ?? [];
  return f.length ? f[hashString(`today:${key}`) % f.length] : null;
}

/** The EPUB edition, if this build has downloads. */
export function readerDownload(m: MetaJson | null) {
  return m?.downloads.find((d) => /\.epub$/.test(d.href));
}
export function hrefOf(d: { href: string }): string {
  return d.href.startsWith('http') ? d.href : import.meta.env.BASE_URL + d.href;
}
