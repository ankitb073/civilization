// What a model needs beyond its own page: the coats of arms of the states it names and its author's seal (read from
// their pages, as heraldry.ts draws them), and those drawings as images to press into clay, wax and metal.
import type { ArmsSpec, PageJson, SigilSpec } from '../../../../engine/src/export/contract.ts';
import { loadPage } from '../../data.ts';
import { armsSvg, sigilSvg } from '../../heraldry.ts';
import { meta } from '../../store.ts';
import { specOf, type ObjectSpec, type SpecExtras } from './record.ts';
import { svgImage } from './paint.ts';
import type { Imgs } from './faces.ts';

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((ok) => setTimeout(() => ok(fallback), ms))]);

export function eraStarts(): number[] | undefined {
  return meta.value?.eras.map((e) => e.start);
}

/** Fetch the arms and seal a page's object shows (a few page shards; skipped after a few seconds). */
export async function extrasFor(page: PageJson): Promise<SpecExtras> {
  const pre = specOf(page, { eraStarts: eraStarts() });
  const pols = new Set(pre.parties);
  if (pre.coin?.emblem) pols.add(pre.coin.emblem);
  const arms: Record<string, ArmsSpec> = {};
  let sigil: SigilSpec | null = null;
  const jobs: Promise<unknown>[] = [...pols].slice(0, 5).map((id) => loadPage(id).then((p) => { if (p?.arms) arms[id] = p.arms; }).catch(() => {}));
  if (pre.author) jobs.push(loadPage(pre.author).then((p) => { if (p?.sigil) sigil = p.sigil; }).catch(() => {}));
  await withTimeout(Promise.all(jobs), 4000, []);
  return { arms, sigil, eraStarts: eraStarts() };
}

export async function imagesFor(s: ObjectSpec): Promise<Imgs> {
  const arms = new Map<string, HTMLImageElement>();
  const jobs: Promise<unknown>[] = Object.entries(s.arms).map(([id, spec]) => svgImage(armsSvg(spec, { uid: `mu${id.replace(':', '')}`, title: false })).then((img) => { if (img) arms.set(id, img); }));
  let sigil: HTMLImageElement | null = null;
  if (s.sigil) jobs.push(svgImage(sigilSvg(s.sigil, { uid: `ms${s.sigil[0].replace(':', '')}`, title: false })).then((img) => { sigil = img; }));
  await withTimeout(Promise.all(jobs), 3000, []);
  return { arms, sigil };
}
