// Ingest agent-written flagship documents (flagships/*.md): validate against the record, then add
// them to the archive as curated, always-extant documents.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Gen } from '../artifacts/gen.ts';
import { localDate } from '../archive/doc.ts';

const FORM_SUB: [RegExp, string][] = [
  [/poem|lament|panegyric|verses|praise|song|hymn|satir/, 'poem'],
  [/proclamation|declaration|edict|curse|apology|memorandum|minutes|charter|testament|decree/, 'decree'],
  [/\blog\b|diary/, 'diary'],
  [/exercise/, 'treatise'],
  [/biograph|essay|lecture|preface|article/, 'paper'],
  [/\bletter\b|dispatch|report|petition|complaint/, 'letter'],
  [/memoir|chronicle|account|record of a disputation/, 'chronicle'],
  [/sermon|hymn|dialogue|confession|prayer|teaching|excommunication|defence/, 'scripture'],
  [/poem|lament|panegyric|verses|praise/, 'poem'],
  [/speech|manifesto/, 'pamphlet'],
  [/diary|log/, 'diary'],
  [/newspaper/, 'newspaper'],
  [/essay|lecture|preface/, 'paper'],
  [/inscription/, 'inscription'],
  [/decree|charter|testament/, 'decree'],
  [/exercise/, 'treatise'],
];

export interface IngestReport { files: number; added: number; strippedLinks: number; rejected: string[] }

export function ingestFlagships(g: Gen, dir: string, simPersons: number, world?: string): IngestReport {
  const rep: IngestReport = { files: 0, added: 0, strippedLinks: 0, rejected: [] };
  if (!existsSync(dir)) return rep;
  const ctx = g.ctx;
  const s = ctx.s;
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  for (const f of files) {
    rep.files++;
    const raw = readFileSync(join(dir, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) { rep.rejected.push(`${f}: no frontmatter`); continue; }
    const fm = new Map<string, string>();
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) fm.set(line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1'));
    }
    if (world && fm.has('world') && fm.get('world') !== world) { rep.rejected.push(`${f}: written for world ${fm.get('world')}, not ${world}`); continue; }
    const year = Number(fm.get('year'));
    const title = fm.get('title') ?? '';
    if (!Number.isFinite(year) || year < 0 || year > 4999 || !title) { rep.rejected.push(`${f}: bad year/title`); continue; }
    let author: number | null = null;
    const au = fm.get('author');
    if (au && au.startsWith('per:')) {
      const id = Number(au.slice(4));
      const p = s.persons[id];
      if (p && (id < simPersons || g.scholars.includes(id)) && p.born + 12 <= year && p.died >= year) author = id;
    }
    const pol = fm.get('polity');
    const polity = pol && pol.startsWith('pol:') ? Number(pol.slice(4)) : null;
    if (polity !== null && !s.polities[polity]) { rep.rejected.push(`${f}: unknown polity ${pol}`); continue; }
    const subj = fm.get('subject') ?? '';
    if (subj.startsWith('evt:') && !s.events[Number(subj.slice(4))]) { rep.rejected.push(`${f}: unknown subject ${subj}`); continue; }
    if (!Number.isFinite(Number(fm.get('lang'))) || !s.lang.languages().some((l) => l.id === Number(fm.get('lang')))) { rep.rejected.push(`${f}: unknown language`); continue; }
    const lang = Number(fm.get('lang') ?? ctx.editorialLang);
    const script = Number(fm.get('script') ?? -1);
    if (s.lang.info(lang).born > year) { rep.rejected.push(`${f}: language not yet born`); continue; }
    const form = fm.get('form') ?? 'chronicle';
    const sub = FORM_SUB.find(([re]) => re.test(form))?.[1] ?? 'chronicle';
    // validate links: only page entities that existed at the date (and simulation persons)
    const mentions = new Set<string>();
    let body = m[2].trim();
    body = body.replace(/\[\[([a-z]{3}):(\d+)\|([^\]]+)\]\]/g, (all, kind: string, num: string, text: string) => {
      const ref = `${kind}:${num}`;
      const ok = g.T.pageRefs.has(ref) && (kind !== 'per' || Number(num) < simPersons) && startOk(g, ref, year);
      if (!ok) { rep.strippedLinks++; return text; }
      mentions.add(ref);
      return all;
    });
    const subject = fm.get('subject') ?? '';
    const about = subject.startsWith('evt:') ? [Number(subject.slice(4))] : [];
    const cell = about.length ? s.events[about[0]].cell : polity !== null ? s.settlements[ctx.capitalAt(s.polities[polity], Math.min(year, (s.polities[polity].died ?? 5000) - 1))].cell : -1;
    const seat = polity !== null ? ctx.capitalAt(s.polities[polity], Math.min(year, (s.polities[polity].died ?? 5000) - 1)) : null;
    const editorial = `\n\n---\n\n**Editorial note.** A ${form}${subject.startsWith('evt:') ? ` concerning [[${subject}|${g.T.title.get(subject) ?? ''}]]` : subject.startsWith('per:') ? ` concerning [[${subject}|${g.T.title.get(subject) ?? ''}]]` : ''}. One of the archive’s flagship documents: a literary source, read with the usual caution about its author’s loyalties.`;
    g.add({
      sub, year, title, author, polity, lang, script: script >= 0 && s.scripts[script]?.born <= year ? script : -1, medium: fm.get('medium') ?? 'manuscript',
      cell, settlement: seat, about, body: body + editorial, mentions, dateText: dateFor(g, polity, lang, year, f), flagship: true, durable: 1, tau: 1e9, seat,
      data: { flagshipId: fm.get('id') ?? f.replace(/\.md$/, ''), form },
    });
    rep.added++;
  }
  return rep;
}

/** The document's date as its own culture would write it (modern essays keep AY). */
function dateFor(g: Gen, polity: number | null, lang: number, year: number, key: string): string {
  if (polity === null || year >= 4800) return `AY ${year}`;
  const p = g.ctx.s.polities[polity];
  if (p.born > year) return `AY ${year}`;
  const d = g.doc(lang, year, `flagship-date:${key}`);
  return localDate(g.ctx, d, p, year);
}

function startOk(g: Gen, ref: string, year: number): boolean {
  const s = g.ctx.s;
  const id = Number(ref.slice(4));
  switch (ref.slice(0, 3)) {
    case 'pol': return s.polities[id].born <= year;
    case 'per': return s.persons[id].born <= year;
    case 'set': return s.settlements[id].founded <= year;
    case 'mov': return s.movements[id].born <= year;
    case 'dei': return s.deities[id].born <= year;
    case 'cur': return s.currencies[id].born <= year;
    case 'hou': return s.houses[id].born <= year;
    case 'scr': return s.scripts[id].born <= year;
    case 'lan': return s.lang.info(id).born <= year;
    case 'cul': return s.cultures[id].born <= year;
    case 'evt': return s.events[id].year <= year;
    case 'art': return false;
    default: return true;
  }
}
