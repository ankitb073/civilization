// figures.json: the subjects of the Lives, each with their person page cut to the rows a figurine is built from
// (atlas/src/three/figure/spec.ts reads the same rows from a full page, so a piece is the same in #/figures, on the
// person's page and in the static portraits). About 40 KB raw for the hundred Lives.
import type { Archive } from '../archive/build.ts';
import type { CollectionsJson, FigurePage, FiguresJson, SigilSpec } from './contract.ts';

const ROWS = new Set(['Born', 'Died', 'People', 'House', 'Roles']);

export function figuresJson(a: Archive, collections: CollectionsJson, sigilOf: (personId: number) => SigilSpec | undefined): FiguresJson {
  const lives = collections.collections.find((c) => c.id === 'lives')?.items ?? [];
  const byId = new Map(a.artifacts.map((x) => [`art:${x.id}`, x]));
  const pieces: FiguresJson['pieces'] = [];
  for (const it of lives) {
    const art = byId.get(it.id);
    // a Life is about one person: the first person linked in its editorial note (as in collections.json)
    const m = art?.body.split('\n---\n').slice(-1)[0].match(/\[\[per:(\d+)\|/);
    const pg = m ? a.pages.get(`per:${m[1]}`) : undefined;
    if (!pg) continue;
    const page: FigurePage = { id: pg.id, title: pg.title, sub: pg.sub, t0: pg.t0, t1: pg.t1, infobox: pg.infobox.filter(([k]) => ROWS.has(k)) };
    const sigil = sigilOf(Number(m![1]));
    if (sigil) page.sigil = sigil;
    pieces.push({ life: it.id, page });
  }
  return { pieces };
}
