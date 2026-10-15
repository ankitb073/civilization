// Obsidian vault export: one Markdown file per page, [[Title|text]] wikilinks, YAML frontmatter,
// and an explicit "Referenced by" section so links are bidirectional in any Markdown viewer.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Archive } from '../archive/build.ts';
import type { PageJson } from './contract.ts';

const FOLDER: Record<string, string> = {
  polity: 'States', person: 'People', settlement: 'Cities', region: 'Regions', river: 'Rivers', culture: 'Peoples',
  language: 'Languages', script: 'Scripts', movement: 'Faiths and Schools', deity: 'Gods', currency: 'Currencies',
  house: 'Merchant Houses', tech: 'Technologies', climate: 'Climate', event: 'Events', artifact: 'Documents',
};

export function fileTitle(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150);
}

export interface VaultExtras {
  story?: { chapters: { title: string; start: number; end: number; intro: string; beats: { year: number; eventId: string; title: string; docs: { id: string; title: string; flagship: boolean }[] }[] }[] };
  featured?: { id: string; title: string; why: string }[];
}

export function writeVault(a: Archive, dir: string, worldName: string, extras: VaultExtras = {}): { files: number } {
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const name = new Map<string, string>();
  const used = new Set<string>();
  for (const pg of a.pages.values()) {
    let t = fileTitle(pg.title);
    if (used.has(t.toLowerCase())) t = fileTitle(`${pg.title} ${pg.id.replace(':', '-')}`);
    used.add(t.toLowerCase());
    name.set(pg.id, t);
  }
  const conv = (md: string) => md.replace(/\[\[([a-z]{3}:\d+)\|([^\]]*)\]\]/g, (_, id: string, text: string) => {
    const t = name.get(id);
    if (!t) return text;
    return t === text ? `[[${t}]]` : `[[${t}|${text}]]`;
  });
  const subdirs = new Set<string>();
  let files = 0;
  for (const pg of a.pages.values()) {
    const folder = pg.kind === 'event' ? join(FOLDER.event, cap(pg.sub.replace(/-/g, ' '))) : pg.kind === 'artifact' ? join(FOLDER.artifact, cap(pg.sub)) : FOLDER[pg.kind] ?? 'Other';
    if (!subdirs.has(folder)) {
      mkdirSync(join(dir, folder), { recursive: true });
      subdirs.add(folder);
    }
    writeFileSync(join(dir, folder, `${name.get(pg.id)}.md`), render(pg, conv, name));
    files++;
  }
  const link = (id: string, text?: string) => (name.has(id) ? `[[${name.get(id)}${text ? `|${text}` : ''}]]` : text ?? id);
  const start: string[] = [`# Start here: the archive of ${worldName}`, ''];
  if (extras.featured?.length) {
    start.push('## Entry points', '');
    for (const f of extras.featured) start.push(`- ${link(f.id, f.title)}: ${f.why}`);
    start.push('');
  }
  if (extras.story) {
    start.push('## Five thousand years in brief', '');
    for (const c of extras.story.chapters) {
      start.push(`### ${c.title} (AY ${c.start}–${c.end})`, '', conv(c.intro), '');
      for (const b of c.beats) start.push(`- **AY ${b.year}**: ${link(b.eventId, b.title)}${b.docs.length ? `. Read: ${b.docs.map((d) => `${d.flagship ? '★ ' : ''}${link(d.id, d.title)}`).join('; ')}` : ''}`);
      start.push('');
    }
  }
  writeFileSync(join(dir, '00 Start here.md'), start.join('\n'));
  // a flat chronology note per millennium
  for (let m = 0; m < 5; m++) {
    const evs = [...a.pages.values()].filter((p) => p.kind === 'event' && p.t0 >= m * 1000 && p.t0 < (m + 1) * 1000 && !['battle', 'succession', 'election', 'expansion', 'founding-city', 'house-founding', 'bankruptcy', 'weight-standard'].includes(p.sub)).sort((x, y) => x.t0 - y.t0 || x.id.localeCompare(y.id));
    const lines = [`# Chronology, AY ${m * 1000}–${(m + 1) * 1000 - 1}`, '', ...evs.map((p) => `- AY ${p.t0}: ${link(p.id)}`)];
    writeFileSync(join(dir, `01 Chronology ${m * 1000}s.md`), lines.join('\n'));
  }
  writeFileSync(join(dir, 'README.md'), [
    `# Palimpsest: the archive of ${worldName}`,
    '',
    'An Obsidian vault exported from the Palimpsest engine. Every page is a Markdown file; every link is a wikilink, and every page ends with the list of pages that link to it.',
    '',
    'Open this folder as a vault in Obsidian and use the graph view, or browse it in any Markdown viewer.',
    '',
    `Folders: ${Object.values(FOLDER).join(', ')}.`,
    '',
    'Generated from a single seed. Fiction: any resemblance to real peoples is coincidental.',
  ].join('\n'));
  return { files };
}

function render(pg: PageJson, conv: (md: string) => string, name: Map<string, string>): string {
  const lines: string[] = [];
  const aliases = (pg.names ?? []).map((n) => n.form).filter((x, i, xs) => xs.indexOf(x) === i && x !== pg.title).slice(0, 12);
  lines.push('---');
  lines.push(`id: "${pg.id}"`);
  lines.push(`kind: ${pg.kind}`);
  lines.push(`type: "${pg.sub}"`);
  lines.push(`from: ${pg.t0}`);
  lines.push(`to: ${pg.t1}`);
  if (aliases.length) lines.push(`aliases: [${aliases.map((x) => JSON.stringify(x)).join(', ')}]`);
  lines.push(`tags: [${pg.kind}, ${slug(pg.sub)}]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${pg.title}`);
  lines.push('');
  lines.push(`> ${conv(pg.summary)}`);
  lines.push('');
  if (pg.infobox.length) {
    lines.push('| | |');
    lines.push('|---|---|');
    for (const [k, v] of pg.infobox) lines.push(`| **${k}** | ${conv(v).replace(/\|/g, '\\|')} |`);
    lines.push('');
  }
  if (pg.artifact?.interlinear) {
    const il = pg.artifact.interlinear;
    lines.push('## Text');
    lines.push('');
    lines.push(`*Transliteration:* ${il.transliteration}`);
    lines.push('');
    lines.push(`*Normalized:* ${il.normalized}`);
    lines.push('');
    lines.push('| ' + il.tokens.map((t) => t.segmented).join(' | ') + ' |');
    lines.push('|' + il.tokens.map(() => '---').join('|') + '|');
    lines.push('| ' + il.tokens.map((t) => t.gloss).join(' | ') + ' |');
    lines.push('');
  }
  if (pg.artifact?.ledger) {
    const l = pg.artifact.ledger;
    lines.push('## Entries');
    lines.push('');
    lines.push('| ' + l.columns.join(' | ') + ' |');
    lines.push('|' + l.columns.map(() => '---').join('|') + '|');
    for (const r of l.rows) lines.push('| ' + r.map((c) => conv(c).replace(/\|/g, '\\|')).join(' | ') + ' |');
    lines.push('');
  }
  lines.push(conv(pg.body));
  if (pg.names && pg.names.length) {
    lines.push('');
    lines.push('## Names through time');
    lines.push('');
    for (const n of pg.names) lines.push(`- AY ${n.year}, ${n.lang}: **${n.form}** (*${n.scholarly}*)`);
  }
  if (pg.accounts) {
    lines.push('');
    lines.push('## The record and the accounts');
    lines.push('');
    lines.push('| Question | Ground truth | ' + pg.accounts.sources.map((s) => `[[${name.get(s.artifactId)}\\|${s.side}]]`).join(' | ') + ' |');
    lines.push('|---|---|' + pg.accounts.sources.map(() => '---').join('|') + '|');
    for (const [field, truth] of pg.accounts.truth) {
      lines.push(`| ${field} | ${truth} | ` + pg.accounts.sources.map((s) => s.claims.find(([f]) => f === field)?.[1] ?? '—').join(' | ') + ' |');
    }
  }
  if (pg.backlinks.length) {
    lines.push('');
    lines.push('## Referenced by');
    lines.push('');
    for (const b of pg.backlinks.slice(0, 500)) {
      const t = name.get(b);
      if (t) lines.push(`- [[${t}]]`);
    }
    if (pg.backlinks.length > 500) lines.push(`- …and ${pg.backlinks.length - 500} more`);
  }
  lines.push('');
  return lines.join('\n');
}

function cap(x: string): string {
  return x ? x[0].toUpperCase() + x.slice(1) : x;
}

function slug(x: string): string {
  return x.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
