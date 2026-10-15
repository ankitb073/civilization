// Dev-only: inject a few hand-made flagship documents (poem, diary, letter) into an existing
// atlas/public/data export so their rendering can be tested before real flagships exist.
// Usage: node atlas/scripts/fixture-flagships.ts   (re-running the engine build removes them)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shardFile, shardOf, type MetaJson, type PageJson, type SearchJson, type ShardJson } from '../../engine/src/export/contract.ts';

const D = process.env.PAL_DATA_OUT ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const read = <T>(f: string) => JSON.parse(readFileSync(join(D, f), 'utf8')) as T;
const meta = read<MetaJson>('meta.json');
const search = read<SearchJson>('search.json');

// borrow real entities so links resolve
const firstOf = (kind: string) => search.entries.find((e) => e[2] === kind)!;
const pol = firstOf('polity'), per = search.entries.filter((e) => e[2] === 'person')[40], set = firstOf('settlement'), war = search.entries.find((e) => e[2] === 'event' && e[5] === 'war')!;
const y = Math.max(300, war[3]);

const base = (id: string, sub: string, title: string, catalog: string, body: string, extra: Partial<NonNullable<PageJson['artifact']>> = {}): PageJson => ({
  id, kind: 'artifact', sub, title, t0: y + 3, t1: y + 3,
  summary: `${title}. A flagship source.`,
  infobox: [['Catalogue', catalog], ['Author', `[[${per[0]}|${per[1]}]]`], ['Place', `[[${set[0]}|${set[1]}]]`]],
  body,
  links: [per[0], set[0], pol[0], war[0]],
  backlinks: [],
  labels: { [per[0]]: per[1], [set[0]]: set[1], [pol[0]]: pol[1], [war[0]]: war[1] },
  cell: -1,
  artifact: {
    catalog, date: `in the 3rd year after the ${war[1]}`, language: 'Old Ashkari', script: 'Luthli', medium: 'papyrus',
    authorId: per[0], condition: 'Complete.', provenance: `Copied at ${set[1]}; now in the archive.`, flagship: true, ...extra,
  },
});

const pages: PageJson[] = [
  base('art:990001', 'poem', `Lament for ${set[1]}`, 'PAL·PO·00001',
    `The river does not remember the walls,\nnor the walls the hands that raised them.\nI counted the boats at [[${set[0]}|${set[1]}]]\nand there were fewer than my fingers.\n\nO [[${pol[0]}|${pol[1]}]], your silver was bright\nwhen the harvest was bright;\nnow the scales are honest\nand the granary is not.\n\nSing it again, slowly —\nthe year of the [[${war[0]}|${war[1]}]],\nthe year the [...] went quiet.`),
  base('art:990002', 'diary', `Day-book of ${per[1]}`, 'PAL·DI·00001',
    `### 3rd of the Barley Moon\n\nRain since dawn. The courier from [[${set[0]}|${set[1]}]] did not come. My lord says the roads are closed by the [[${war[0]}|${war[1]}]].\n\n### 4th of the Barley Moon\n\nThe price of bread has risen again — eleven coppers. I paid it.\n\n### 9th of the Barley Moon\n\nNews at last: [[${pol[0]}|${pol[1]}]] has sued for peace. Nobody believes it.`),
  base('art:990003', 'letter', `Letter of ${per[1]} to the court of ${pol[1]}`, 'PAL·LE·99001',
    `To the Great House of [[${pol[0]}|${pol[1]}]], from your servant [[${per[0]}|${per[1]}]]: greetings.\n\nI write from [[${set[0]}|${set[1]}]], where the tin has not come for three seasons. If the war called [[${war[0]}|${war[1]}]] does not end before the floods, there will be no bronze for the spring muster.\n\nMay the gods keep you, and the road.`),
];

for (const p of pages) {
  const f = shardFile(shardOf(p.id));
  const sh = read<ShardJson>(f);
  sh.pages = sh.pages.filter((x) => x.id !== p.id).concat(p);
  writeFileSync(join(D, f), JSON.stringify(sh));
}
search.entries = search.entries.filter((e) => !pages.some((p) => p.id === e[0]))
  .concat(pages.map((p) => [p.id, p.title, p.kind, p.t0, p.artifact!.catalog, p.sub] as SearchJson['entries'][number]));
writeFileSync(join(D, 'search.json'), JSON.stringify(search));
meta.flagships = [...new Set([...(meta.flagships ?? []), ...pages.map((p) => p.id)])];
writeFileSync(join(D, 'meta.json'), JSON.stringify(meta));
console.log(`fixtures: ${pages.map((p) => `${p.id} (${p.sub})`).join(', ')}`);
