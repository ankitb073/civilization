// Reading pages: one static HTML page per flagship document (s/fl-NNN.html, named by its frozen flagship id), a contents page (s/index.html)
// and a sitemap. Each page carries the whole text, Open Graph and Twitter card tags, and links into the
// atlas for every person, place and event it names. Hash routes can't carry per-page cards or be indexed,
// so these are the links to post. The card image shows the map in the document's quarter-millennium
// (og/chNN.jpg, from the atlas `og` script) when it exists, and the site card otherwise.
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimResult } from '../sim/run.ts';
import type { Archive } from '../archive/build.ts';
import type { Artifact } from '../artifacts/gen.ts';
import { worldNameOf } from './export.ts';
import { renderMarkdown, plainDate } from './book.ts';

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

const UI = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
const CSS = `:root { color-scheme: light dark; --bg: #f4efe4; --surface: #fbf8f1; --ink: #1f1a14; --ink-2: #4a4036; --muted: #665b4c; --rule: #d9cfbc; --link: #7a2a1c; --accent: #8e2f1f; --accent-ink: #fbf8f1; }
@media (prefers-color-scheme: dark) { :root { --bg: #11151b; --surface: #1b2129; --ink: #ece3cf; --ink-2: #cdbfa5; --muted: #a89c86; --rule: #2e3742; --link: #e3a58e; --accent: #e3a58e; --accent-ink: #11151b; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 19px/1.62 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; }
header, main, footer { max-width: 40rem; margin: 0 auto; padding: 0 16px; }
header { padding-top: 20px; font: 600 13px/1.4 ${UI}; letter-spacing: .14em; text-transform: uppercase; }
header a { color: var(--accent); text-decoration: none; }
header span { color: var(--muted); font-weight: 500; letter-spacing: .04em; text-transform: none; }
.kicker { font: 500 14px/1.45 ${UI}; color: var(--muted); margin: 36px 0 8px; }
h1 { font-weight: 500; font-size: 2.05em; line-height: 1.15; margin: 0 0 26px; letter-spacing: -.005em; }
h2 { font-weight: 500; font-size: 1.35em; line-height: 1.25; margin: 1.9em 0 .45em; }
h3, h4, h5, h6 { font-weight: 600; font-size: 1.02em; margin: 1.6em 0 .35em; }
p { margin: 0 0 1em; }
a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 2px; }
blockquote { margin: 1.1em 0; padding-left: 1em; border-left: 2px solid var(--rule); color: var(--ink-2); }
table { border-collapse: collapse; font-size: .85em; margin: 1em 0; display: block; max-width: 100%; overflow-x: auto; }
th, td { border-bottom: 1px solid var(--rule); padding: .25em .6em; text-align: left; vertical-align: top; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2em 0; }
code { font-size: .88em; }
.apparatus { font-size: .86em; color: var(--ink-2); border-top: 1px solid var(--rule); margin-top: 2.2em; padding-top: 1em; }
.cta { display: inline-block; margin: 26px 0 8px; padding: 11px 18px; border-radius: 8px; background: var(--accent); color: var(--accent-ink); font: 600 15px/1.2 ${UI}; text-decoration: none; }
.pn { display: flex; justify-content: space-between; gap: 16px; margin: 28px 0 0; padding: 16px 0; border-top: 1px solid var(--rule); font: 15px/1.4 ${UI}; }
.pn a { max-width: 48%; text-decoration: none; }
.pn small { display: block; color: var(--muted); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 2px; }
.pn .next { margin-left: auto; text-align: right; }
.toc h2 { font: 600 13px/1.4 ${UI}; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 2.4em 0 .6em; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { padding: 7px 0; border-bottom: 1px solid var(--rule); }
.toc li a { text-decoration: none; }
.toc li span { display: block; font: 13px/1.4 ${UI}; color: var(--muted); }
footer { font: 14px/1.55 ${UI}; color: var(--muted); padding-top: 28px; padding-bottom: 48px; }
footer a { color: var(--muted); }
@media (max-width: 480px) { body { font-size: 18px; } h1 { font-size: 1.75em; } }
`;

interface Series { name: string; docs: Artifact[] }

export function writeSharePages(r: SimResult, a: Archive, dir: string, publicDir: string, dataDir = join(publicDir, 'data')): number {
  const world = worldNameOf(r, a);
  const T = a.T;
  const s = r.state;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fl = (x: Artifact) => Number(String(x.data?.flagshipId ?? '').slice(3)) || 0;
  const form = (x: Artifact) => String((x.data as { form?: string } | undefined)?.form ?? x.sub);
  const isHistory = (x: Artifact) => fl(x) >= 900 && fl(x) <= 920;
  const isModern = (x: Artifact) => x.year >= 4800 && x.dateText === `AY ${x.year}`;
  const image = (x: Artifact) => {
    // a History chapter shows its own period, not the year it was written
    const ch = String(isHistory(x) && fl(x) > 900 ? fl(x) - 900 : Math.min(20, Math.floor(x.year / 250) + 1)).padStart(2, '0');
    return existsSync(join(publicDir, 'og', `ch${ch}.jpg`)) ? `og/ch${ch}.jpg` : 'og.png';
  };
  const titleOf = (x: Artifact) => isHistory(x) ? `${x.title} · A History of ${world}`
    : isModern(x) ? x.title
    : `${x.title} — ${plainDate(x)}`;
  const page = (x: Artifact) => `${String(x.data?.flagshipId ?? `art-${x.id}`)}.html`; // stable across rebuilds

  // reading order: the History by chapter, the Lives by their subject's birth, essays by number, sources by date
  const flag = a.artifacts.filter((x) => x.flagship);
  const subjectBorn = (x: Artifact) => {
    const m = x.body.split('\n---\n').slice(-1)[0].match(/\[\[per:(\d+)\|/);
    return m ? s.persons[Number(m[1])]?.born ?? 0 : 0;
  };
  const series: Series[] = [
    { name: `A History of ${world}`, docs: flag.filter(isHistory).sort((x, y) => fl(x) - fl(y)) },
    { name: 'Sources', docs: flag.filter((x) => !isHistory(x) && !isModern(x)).sort((x, y) => x.year - y.year || fl(x) - fl(y)) },
    { name: 'Lives', docs: flag.filter((x) => fl(x) >= 600 && fl(x) < 700).sort((x, y) => subjectBorn(x) - subjectBorn(y) || fl(x) - fl(y)) },
  ];
  const placed = new Set(series.flatMap((z) => z.docs));
  series.push({ name: 'Essays', docs: flag.filter((x) => !placed.has(x)).sort((x, y) => fl(x) - fl(y)) });

  const head = (title: string, desc: string, url: string, img: string, type: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Palimpsest</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#f4efe4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#11151b" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Palimpsest: the archive of ${esc(world)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(SITE + img)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(SITE + img)}">
<style>${CSS}</style>`;
  const top = `<header><a href="../">Palimpsest</a> <span>· the archive of ${esc(world)}, a world that never existed</span></header>`;
  const foot = `<footer><p>Palimpsest is a simulated history of five thousand years: every state, war, price and word comes from one seeded simulation, and every document is checked against its record. <a href="./">All sources and essays</a> · <a href="../">The atlas</a> · <a href="https://github.com/ankitb073/civilization/blob/main/docs/how-it-works.md">How it works</a></p></footer>`;

  let n = 0;
  for (const z of series) {
    z.docs.forEach((x, k) => {
      const title = titleOf(x);
      const desc = lede(x.body);
      const url = `${SITE}s/${page(x)}`;
      const [text, ...rest] = x.body.split('\n---\n');
      const verse = /poem|verse|song|hymn|elegy|lament|ode|epic/.test(`${x.sub} ${form(x)}`);
      const author = x.author !== null ? T.short.get(`per:${x.author}`) ?? '' : '';
      const date = plainDate(x);
      const kicker = [form(x).replace(/^./, (c) => c.toUpperCase()), date, author ? `by ${author}` : '', x.catalog].filter(Boolean).map(esc).join(' · ');
      const prev = z.docs[k - 1], next = z.docs[k + 1];
      const pn = prev || next ? `<nav class="pn" aria-label="${esc(z.name)}">${prev ? `<a class="prev" href="${page(prev)}"><small>← ${esc(z.name)}</small>${esc(prev.title)}</a>` : ''}${next ? `<a class="next" href="${page(next)}"><small>${esc(z.name)} →</small>${esc(next.title)}</a>` : ''}</nav>` : '';
      const ld = { '@context': 'https://schema.org', '@type': 'CreativeWork', name: x.title, genre: form(x), inLanguage: 'en', url, image: SITE + image(x), isPartOf: { '@type': 'CreativeWorkSeries', name: `Palimpsest: ${z.name}`, url: `${SITE}s/` }, description: desc };
      writeFileSync(join(dir, page(x)), `${head(title, desc, url, image(x), 'article')}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head><body>
${top}
<main><article>
<p class="kicker">${kicker}</p>
<h1>${esc(x.title)}</h1>
${renderMarkdown(text, verse, 2)}
${rest.length ? `<div class="apparatus">${renderMarkdown(rest.join('\n---\n'), false, 3)}</div>` : ''}
</article>
<a class="cta" href="${esc(`../#/p/art:${x.id}`)}">Open in the atlas →</a>
${pn}
</main>
${foot}
</body></html>
`);
      n++;
    });
  }

  // collections: one page each (s/c/<id>.html), so a shared link to a list unfurls as a card too
  const colPath = join(dataDir, 'collections.json');
  const cols = existsSync(colPath) ? (JSON.parse(readFileSync(colPath, 'utf8')) as { collections: { id: string; title: string; blurb: string; items: { id: string; title: string; note: string; year: number }[] }[] }).collections : [];
  const byArt = new Map(flag.map((x) => [`art:${x.id}`, x]));
  mkdirSync(join(dir, 'c'), { recursive: true });
  for (const c of cols) {
    const url = `${SITE}s/c/${c.id}.html`;
    const items = c.items.map((it, k) => {
      const f = byArt.get(it.id);
      const href = f ? `../${page(f)}` : `../../#/p/${it.id}`;
      return `<li><a href="${esc(href)}">${esc(it.title)}</a><span>${k + 1}. ${esc(it.note)}</span></li>`;
    }).join('');
    writeFileSync(join(dir, 'c', `${c.id}.html`), `${head(`${c.title}: from the archive of ${world}`, c.blurb, url, 'og.png', 'website').replace(/href="\.\.\/favicon\.svg"/, 'href="../../favicon.svg"')}
</head><body>
${top.replace('href="../"', 'href="../../"')}
<main class="toc">
<p class="kicker">A collection from the archive</p>
<h1>${esc(c.title)}</h1>
<p>${esc(c.blurb)}</p>
<ol>${items}</ol>
<a class="cta" href="${esc(`../../#/collections/${c.id}`)}">Open in the atlas →</a>
</main>
${foot.replace(/href="\.\/"/, 'href="../"').replace('href="../">The atlas', 'href="../../">The atlas')}
</body></html>
`);
  }

  // contents
  const desc = `The literary sources, Lives, essays and the narrative History of ${world}: ${n} documents from a five-thousand-year archive of a world that never existed.`;
  writeFileSync(join(dir, 'index.html'), `${head(`Sources, Lives and essays from the archive of ${world}`, desc, `${SITE}s/`, 'og.png', 'website')}
</head><body>
${top}
<main class="toc">
<h1>Sources, Lives and essays</h1>
<p>${esc(desc)} The atlas holds all of them, with ${a.artifacts.filter((x) => x.status === 'extant').length.toLocaleString('en-US')} documents in all.</p>
${cols.length ? `<h2>Collections</h2>
<ol>${cols.map((c) => `<li><a href="c/${c.id}.html">${esc(c.title)}</a><span>${esc(c.blurb)}</span></li>`).join('')}</ol>` : ''}
${series.map((z) => `<h2>${esc(z.name)}</h2>
<ol>${z.docs.map((x) => `<li><a href="${page(x)}">${esc(x.title)}</a><span>${esc([form(x), plainDate(x)].join(' · '))}</span></li>`).join('')}</ol>`).join('\n')}
</main>
${foot}
</body></html>
`);

  // sitemap: the atlas, the contents and every reading page
  const urls = [SITE, `${SITE}s/`, ...cols.map((c) => `${SITE}s/c/${c.id}.html`), ...series.flatMap((z) => z.docs.map((x) => `${SITE}s/${page(x)}`))];
  writeFileSync(join(publicDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>
`);
  return n;
}
