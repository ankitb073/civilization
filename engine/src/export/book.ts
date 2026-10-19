// The Reader: an EPUB 3 anthology of the archive. It holds the narrative History, the literary sources
// in date order by age, the Lives, the scholars' essays and a few procedural specimens. Every entity link
// points to its page in the online atlas. Deterministic: a fixed timestamp, and zip entries in a fixed order.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import type { SimResult } from '../sim/run.ts';
import type { Archive } from '../archive/build.ts';
import type { Artifact } from '../artifacts/gen.ts';
import { computeEras, featuredOf, worldNameOf, worldFingerprint } from './export.ts';

const SITE = process.env.SITE_URL ?? 'https://ankitb073.github.io/civilization/';
const MODIFIED = '2026-01-01T00:00:00Z';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A document's date as plain text, in its own calendar with the AY year once: "in the 27th year of Nuwanan
 *  (AY 442)", "AY 4999". The archive writes local dates with links and a bracketed AY year. */
export function plainDate(x: Pick<Artifact, 'dateText' | 'year'>): string {
  const local = (x.dateText ?? '').replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/\s*\[AY -?\d+\]\s*$/, '').trim();
  return !local || local === `AY ${x.year}` ? `AY ${x.year}` : `${local} (AY ${x.year})`;
}

function inline(src: string): string {
  const tokens: string[] = [];
  const stash = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = src.replace(/\[\[([a-z]{3}:\d+)\|([^\]]*)\]\]/g, (_m, id: string, text: string) => stash(`<a href="${esc(SITE)}#/p/${esc(id)}">${esc(text)}</a>`));
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => stash(`<code>${esc(c)}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t: string, u: string) => stash(`<a href="${esc(u)}">${esc(t)}</a>`));
  s = esc(s);
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  s = s.replace(/ {2,}\n|\\\n/g, '<br/>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)]);
}

/** Markdown → XHTML (well-formed): the subset the archive writes. */
function render(md: string, verse = false, top = 2): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const blank = (l: string) => /^\s*$/.test(l);
  const isList = (l: string) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (blank(l)) { i++; continue; }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { const h = Math.min(6, top + Math.max(1, m[1].length - 1)); out.push(`<h${h}>${inline(m[2])}</h${h}>`); i++; continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) { out.push('<hr/>'); i++; continue; }
    if (/^\s*>/.test(l)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${render(buf.join('\n'), verse, top)}</blockquote>`);
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (r: string) => {
        const t = r.trim().replace(/^\|/, '').replace(/\|$/, '');
        const cells: string[] = [];
        let cur = '', depth = 0;
        for (let k = 0; k < t.length; k++) {
          if (t.startsWith('[[', k)) { depth++; cur += '[['; k++; continue; }
          if (t.startsWith(']]', k) && depth > 0) { depth--; cur += ']]'; k++; continue; }
          if (t[k] === '|' && depth === 0) { cells.push(cur.trim()); cur = ''; continue; }
          cur += t[k];
        }
        cells.push(cur.trim());
        return cells;
      };
      const head = row(l);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { body.push(row(lines[i])); i++; }
      out.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if ((m = l.match(/^\s*([-*+]|\d+[.)])\s+/))) {
      const ordered = /\d/.test(m[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const li = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!li || /\d/.test(li[1]) !== ordered) break;
        let text = li[2];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !isList(lines[i])) { text += ' ' + lines[i].trim(); i++; }
        items.push(`<li>${inline(text)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && !blank(lines[i]) && !/^(#{1,4})\s|^\s*>|^\s*\|/.test(lines[i]) && !isList(lines[i]) && !/^\s*(---+)\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
    if (!buf.length) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, verse ? '<br/>' : ' ')}</p>`);
  }
  return out.join('\n');
}

function page(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`;
}

const CSS = `body { font-family: Georgia, "Iowan Old Style", serif; line-height: 1.5; margin: 0 4%; }
h1, h2, h3 { font-weight: normal; line-height: 1.2; }
h1 { font-size: 1.9em; margin: 2em 0 0.4em; text-align: center; }
h2 { font-size: 1.45em; margin: 2.2em 0 0.3em; }
h3 { font-size: 1.15em; margin: 1.6em 0 0.3em; font-style: italic; }
h4, h5, h6 { font-size: 1em; margin: 1.2em 0 0.2em; }
p { margin: 0 0 0.7em; text-align: justify; }
a { color: #6b3a1f; text-decoration: none; }
blockquote { margin: 0.8em 1.5em; font-style: italic; }
table { border-collapse: collapse; font-size: 0.85em; margin: 0.8em 0; }
th, td { border-bottom: 1px solid #bbb; padding: 0.2em 0.5em; text-align: left; vertical-align: top; }
hr { border: 0; border-top: 1px solid #bbb; margin: 1.2em 20%; }
.meta { font-size: 0.8em; color: #555; margin-bottom: 1em; font-variant: small-caps; letter-spacing: 0.02em; }
.apparatus { font-size: 0.85em; color: #333; border-top: 1px solid #ccc; margin-top: 1em; padding-top: 0.5em; }
.doc { margin-bottom: 2.5em; }
.part { text-align: center; margin-top: 30%; }
.part p { text-align: center; font-style: italic; }
.title { text-align: center; margin-top: 20%; }
.title p { text-align: center; }
.small { font-size: 0.85em; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100%; }
`;

interface Entry { file: string; title: string; html: string; toc: { id: string; title: string }[] }

export function writeReader(r: SimResult, a: Archive, path: string, opts: { cover?: string; facts?: number } = {}): { bytes: number; docs: number } {
  const s = r.state;
  const T = a.T;
  const world = worldNameOf(r, a);
  const fid = (x: Artifact) => String((x.data as { flagshipId?: string } | undefined)?.flagshipId ?? '');
  const num = (x: Artifact) => Number(fid(x).slice(3)) || 0;
  const flag = a.artifacts.filter((x) => x.flagship).sort((x, y) => num(x) - num(y));
  const history = flag.filter((x) => num(x) >= 900 && num(x) < 1000);
  const lives = flag.filter((x) => num(x) >= 600 && num(x) < 700).sort((x, y) => s.persons[Number(fid2subject(x))]?.born - s.persons[Number(fid2subject(y))]?.born || num(x) - num(y));
  const scholars = flag.filter((x) => num(x) >= 200 && num(x) < 300);
  // Tales: modern fiction, read in the order of the moments they are set in
  const setIn = (x: Artifact) => s.events[x.about?.[0] ?? -1]?.year ?? x.year;
  const tales = flag.filter((x) => num(x) >= 1001 && num(x) < 2000).sort((x, y) => setIn(x) - setIn(y) || num(x) - num(y));
  const sources = flag.filter((x) => !history.includes(x) && !lives.includes(x) && !scholars.includes(x) && !tales.includes(x)).sort((x, y) => x.year - y.year || num(x) - num(y));
  function fid2subject(x: Artifact): string {
    // Lives are about one person; their subject is the first person linked in the editorial note
    const m = x.body.split('\n---\n').slice(-1)[0].match(/\[\[per:(\d+)\|/);
    return m ? m[1] : '-1';
  }
  const byId = new Map(a.artifacts.map((x) => [x.id, x]));
  let docs = 0;

  const docHtml = (x: Artifact, head = 'h2'): string => {
    docs++;
    const [text, ...rest] = x.body.split('\n---\n');
    const verse = /poem|verse|song|hymn|elegy|lament|ode|epic/.test(`${x.sub} ${String((x.data as { form?: string } | undefined)?.form ?? '')}`);
    const author = x.author !== null ? T.short.get(`per:${x.author}`) ?? '' : '';
    const meta = [x.catalog, plainDate(x), author ? `by ${author}` : '', x.medium, T.short.get(`lan:${x.lang}`) ?? ''].filter(Boolean).map(esc).join(' · ');
    return `<section class="doc" id="d${x.id}"><${head}>${esc(x.title)}</${head}>
<p class="meta">${meta}</p>
${render(text, verse, head === 'h1' ? 1 : 2)}
${rest.length ? `<div class="apparatus">${render(rest.join('\n---\n'), false, 3)}</div>` : ''}
</section>`;
  };

  const entries: Entry[] = [];
  const parts: { title: string; blurb: string; first: number }[] = [];
  const part = (title: string, blurb: string) => {
    const file = `part${parts.length + 1}.xhtml`;
    parts.push({ title, blurb, first: entries.length });
    entries.push({ file, title, html: page(title, `<section class="part" epub:type="part"><h1>${esc(title)}</h1><p>${esc(blurb)}</p></section>`), toc: [] });
  };

  // title page
  const nDocs = a.artifacts.length;
  entries.push({
    file: 'title.xhtml', title: 'Title page', toc: [],
    html: page(`The ${world} Reader`, `<section class="title" epub:type="titlepage">
<h1>The ${esc(world)} Reader</h1>
<p><em>Five thousand years in its own words</em></p>
<p class="small">From the Palimpsest archive: the documents five thousand years left behind.</p>
<p class="small">${nDocs.toLocaleString('en-US')} surviving documents · world ${worldFingerprint(r)}${opts.facts ? ` · ${opts.facts.toLocaleString('en-US')} facts audited` : ''}</p>
<p class="small">Every name links to its page in the online atlas:<br/><a href="${esc(SITE)}">${esc(SITE.replace(/^https?:\/\//, ''))}</a></p>
</section>`),
  });
  entries.push({
    file: 'about.xhtml', title: 'About this book', toc: [],
    html: page('About this book', `<section epub:type="foreword"><h1>About this book</h1>
<p>${esc(world)} is not a real place. Its continents, rivers, peoples, languages, wars, prices and plagues were generated from one random seed and simulated year by year for five thousand years. Every state change in that simulation has a recorded cause, and a consistency checker audits the resulting database on every build: no cause after its effect, no ceded district that fails to change hands, no document that mentions anything that did not yet exist.</p>
<p>From that record the archive writes the documents such a world would leave behind: treaties, ledgers, inscriptions with interlinear glosses, rival chronicles, newspapers. This book collects the literary part of the archive. These are flagship documents written from fact sheets cut at each document's date: poems, letters, memoirs, the voices of ordinary people, the archive's own modern scholars, and a narrative history of the whole five millennia.</p>
<p>Dates are given as the authors wrote them, in their own calendars, and in Archive Years (AY), the modern scholars' reckoning from the first city-states. Words in a different colour are links to the online atlas, where every person, place, state, faith and event has a page with a map.</p>
<p class="small">Generated by Palimpsest (MIT licence). The text of the archive is fiction.</p>
</section>`),
  });

  if (history.length) {
    part(`A History of ${world}`, `A narrative history in ${history.length} parts, by the archive’s modern historians.`);
    for (const x of history) entries.push({ file: `h${num(x)}.xhtml`, title: x.title, html: page(x.title, docHtml(x, 'h1')), toc: [] });
  }

  part('Voices of Five Millennia', 'Literary sources in the order they were written: songs and laments, letters and memoirs, decrees, sermons, diaries and the voices of ordinary people.');
  const eras = computeEras(r, a);
  for (const er of eras) {
    const xs = sources.filter((x) => x.year >= er.start && x.year < er.end);
    if (!xs.length) continue;
    // e-readers prefer files of a few hundred KB: split long ages into parts of about 30 documents
    const parts1 = Math.ceil(xs.length / 30);
    for (let k = 0; k < parts1; k++) {
      const ys = xs.slice(Math.floor((k * xs.length) / parts1), Math.floor(((k + 1) * xs.length) / parts1));
      const sub = parts1 > 1 ? `, ${k + 1} of ${parts1} (AY ${ys[0].year}–${ys[ys.length - 1].year})` : ` (AY ${er.start}–${er.end})`;
      entries.push({ file: `era-${er.id}-${k + 1}.xhtml`, title: `${er.name}${sub}`, toc: ys.map((x) => ({ id: `d${x.id}`, title: x.title })), html: page(er.name, `${k === 0 ? `<h1>${esc(er.name)}</h1><p class="meta">AY ${er.start}–${er.end}</p>${er.blurb ? `<p><em>${esc(er.blurb)}</em></p>` : ''}` : ''}\n${ys.map((x) => docHtml(x)).join('\n')}`) });
    }
  }

  if (lives.length) {
    part('Lives', `${lives.length} long-form biographies of the people who shaped ${world}, in order of birth.`);
    const chunk = 10;
    for (let k = 0; k < lives.length; k += chunk) {
      const xs = lives.slice(k, k + chunk);
      entries.push({ file: `lives${k / chunk + 1}.xhtml`, title: `Lives ${k + 1}–${k + xs.length}`, toc: xs.map((x) => ({ id: `d${x.id}`, title: x.title })), html: page('Lives', xs.map((x) => docHtml(x)).join('\n')) });
    }
  }
  if (tales.length) {
    part(`Tales of ${world}`, `${tales.length} short stories by the world's modern novelists, each set at a real moment of the record, in the order of the moments they tell.`);
    const chunk = 8;
    for (let k = 0; k < tales.length; k += chunk) {
      const xs = tales.slice(k, k + chunk);
      entries.push({ file: `tales${k / chunk + 1}.xhtml`, title: `Tales ${k + 1}–${k + xs.length}`, toc: xs.map((x) => ({ id: `d${x.id}`, title: x.title })), html: page('Tales', xs.map((x) => docHtml(x)).join('\n')) });
    }
  }
  if (scholars.length) {
    part('The Scholars’ Debates', 'Modern essays on rival chronicles, the ages, language families, collapses and founders of faiths.');
    const chunk = 12;
    for (let k = 0; k < scholars.length; k += chunk) {
      const xs = scholars.slice(k, k + chunk);
      entries.push({ file: `essays${k / chunk + 1}.xhtml`, title: `Essays ${k + 1}–${k + xs.length}`, toc: xs.map((x) => ({ id: `d${x.id}`, title: x.title })), html: page('Essays', xs.map((x) => docHtml(x)).join('\n')) });
    }
  }
  // specimens of the procedural archive: the atlas's curated entry points that are documents
  const spec = featuredOf(r, a).filter((f) => f.id.startsWith('art:')).map((f) => byId.get(Number(f.id.slice(4)))).filter((x): x is Artifact => !!x && !x.flagship);
  if (spec.length) {
    part('Specimens from the Archive', 'Documents written by the archive itself: a treaty, a ledger, an inscription with its gloss, rival chronicles and more.');
    entries.push({ file: 'specimens.xhtml', title: 'Specimens', toc: spec.map((x) => ({ id: `d${x.id}`, title: x.title })), html: page('Specimens', spec.map((x) => docHtml(x)).join('\n')) });
  }

  // navigation
  const nav = page('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${entries.filter((e) => e.file !== 'title.xhtml').map((e) => `<li><a href="${e.file}">${esc(e.title)}</a>${e.toc.length ? `<ol>${e.toc.map((t) => `<li><a href="${e.file}#${t.id}">${esc(t.title)}</a></li>`).join('')}</ol>` : ''}</li>`).join('\n')}
</ol></nav>`);
  const cover = opts.cover && existsSync(opts.cover) ? readFileSync(opts.cover) : null;
  const uid = `urn:palimpsest:${s.seed}:${worldFingerprint(r)}`;
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${esc(uid)}</dc:identifier>
<dc:title>The ${esc(world)} Reader</dc:title>
<dc:creator>Palimpsest</dc:creator>
<dc:language>en</dc:language>
<dc:description>Five thousand years in its own words: a narrative history, literary sources, lives and essays from the Palimpsest archive.</dc:description>
<dc:rights>MIT licence</dc:rights>
<meta property="dcterms:modified">${MODIFIED}</meta>
${cover ? '<meta name="cover" content="cover-image"/>' : ''}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
${cover ? '<item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>\n<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>' : ''}
${entries.map((e, k) => `<item id="c${k}" href="${e.file}" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine>
${cover ? '<itemref idref="cover" linear="yes"/>' : ''}
${entries.map((_e, k) => `<itemref idref="c${k}"/>`).join('\n')}
<itemref idref="nav" linear="no"/>
</spine>
</package>
`;
  const files: { name: string; data: Buffer; store?: boolean }[] = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip'), store: true },
    { name: 'META-INF/container.xml', data: Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n') },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf) },
    { name: 'OEBPS/nav.xhtml', data: Buffer.from(nav) },
    { name: 'OEBPS/style.css', data: Buffer.from(CSS) },
  ];
  if (cover) {
    files.push({ name: 'OEBPS/cover.png', data: cover, store: true });
    files.push({ name: 'OEBPS/cover.xhtml', data: Buffer.from(page('Cover', `<section class="cover" epub:type="cover"><img src="cover.png" alt="The ${esc(world)} Reader"/></section>`)) });
  }
  for (const e of entries) files.push({ name: `OEBPS/${e.file}`, data: Buffer.from(e.html) });
  const buf = zip(files);
  writeFileSync(path, buf);
  return { bytes: buf.length, docs };
}

/** A minimal zip writer (store or deflate), enough for EPUB: mimetype first and uncompressed. */
function zip(files: { name: string; data: Buffer; store?: boolean }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = f.store ? f.data : deflateRawSync(f.data, { level: 9 });
    const method = f.store ? 0 : 8;
    const crc = crc32(f.data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(method, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(f.data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    chunks.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38); c.writeUInt32LE(off, 42);
    central.push(c, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cd, end]);
}

/** The archive's Markdown subset as HTML (well-formed XHTML), for the reading pages too. */
export { render as renderMarkdown };
