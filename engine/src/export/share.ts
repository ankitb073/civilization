// Share pages: one tiny static HTML file per flagship document (s/art-N.html). Each carries Open Graph and
// Twitter card tags, then redirects to the document in the atlas. Hash routes can't carry per-page cards,
// so these are the links to post. The card image shows the map in the document's quarter-millennium
// (og/chNN.jpg, from the atlas `og` script) when it exists, and the site card otherwise.
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SimResult } from '../sim/run.ts';
import type { Archive } from '../archive/build.ts';
import { worldNameOf } from './export.ts';

const SITE = process.env.SITE_URL ?? 'https://ankitb073.github.io/civilization/';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text of a document's opening, for the card description. */
export function lede(body: string, max = 220): string {
  const text = body.split('\n---\n')[0]
    .replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, '$1')
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[,;:]$/, '') + '…';
}

export function writeSharePages(r: SimResult, a: Archive, dir: string, publicDir: string): number {
  const world = worldNameOf(r, a);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const image = (year: number, fl: number) => {
    // a History chapter shows its own period, not the year it was written
    const ch = String(fl > 900 && fl <= 920 ? fl - 900 : Math.min(20, Math.floor(year / 250) + 1)).padStart(2, '0');
    return existsSync(join(publicDir, 'og', `ch${ch}.jpg`)) ? `og/ch${ch}.jpg` : 'og.png';
  };
  let n = 0;
  for (const x of a.artifacts) {
    if (!x.flagship) continue;
    const id = `art:${x.id}`;
    const fl = Number(String(x.data?.flagshipId ?? '').slice(3)) || 0;
    const target = `${SITE}#/p/${id}`;
    const desc = lede(x.body);
    const title = `${x.title} — ${x.dateText && x.dateText !== `AY ${x.year}` ? `${x.dateText}, ` : ''}AY ${x.year}`;
    writeFileSync(join(dir, `art-${x.id}.html`), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(title)} · Palimpsest</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(target)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Palimpsest: the archive of ${esc(world)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(`${SITE}s/art-${x.id}.html`)}">
<meta property="og:image" content="${esc(SITE + image(x.year, fl))}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(SITE + image(x.year, fl))}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)})</script>
</head><body><p><a href="${esc(target)}">${esc(x.title)}</a>: a document from the archive of ${esc(world)}, a world that never existed.</p></body></html>
`);
    n++;
  }
  return n;
}
