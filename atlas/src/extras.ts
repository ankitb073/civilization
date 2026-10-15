// Lazily loaded curated data: collections, dynasties, and the "surprise me" picker.

import type { CollectionsJson, DynastiesJson } from '../../engine/src/export/contract.ts';
import { fetchJson, loadPage } from './data.ts';
import { ensureMeta } from './store.ts';
import { navigate } from './state.ts';
import { SHARD_COUNT, shardFile } from '../../engine/src/export/contract.ts';

let colP: Promise<CollectionsJson> | null = null;
export function loadCollections(): Promise<CollectionsJson> {
  if (!colP) { colP = fetchJson<CollectionsJson>('collections.json'); colP.catch(() => { colP = null; }); }
  return colP;
}

export type Dynasty = DynastiesJson['dynasties'][number];
let dynP: Promise<DynastiesJson> | null = null;
export function loadDynasties(): Promise<DynastiesJson> {
  if (!dynP) { dynP = fetchJson<DynastiesJson>('dynasties.json'); dynP.catch(() => { dynP = null; }); }
  return dynP;
}

/** Where a collection's items should open (rival wars go straight to the comparison). */
export function itemHref(collectionId: string, id: string): string {
  return collectionId === 'rival' && id.startsWith('evt:') ? `#/compare/${id}` : `#/p/${id}`;
}

function rand(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % Math.max(1, n);
}

/** Open a random document; flagship sources are five times as likely as any other. */
export async function surprise(): Promise<void> {
  const m = await ensureMeta();
  const flags = m.flagships ?? [];
  const docs = m.counts.artifact ?? m.counts.documents ?? 0;
  const wFlag = flags.length * 5, wRest = Math.max(0, docs - flags.length);
  if (flags.length && rand(wFlag + wRest) < wFlag) { navigate(`#/p/${flags[rand(flags.length)]}`); return; }
  const flagSet = new Set(flags);
  for (let tries = 0; tries < 6; tries++) {
    const sh = await fetchJson<{ pages: { id: string; kind: string }[] }>(shardFile(rand(SHARD_COUNT)));
    const arts = sh.pages.filter((p) => p.kind === 'artifact' && !flagSet.has(p.id));
    if (arts.length) {
      const id = arts[rand(arts.length)].id;
      void loadPage(id);
      navigate(`#/p/${id}`);
      return;
    }
  }
  if (flags.length) navigate(`#/p/${flags[rand(flags.length)]}`);
}
