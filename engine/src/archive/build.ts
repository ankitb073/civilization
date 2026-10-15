// Archive assembly: titles → artifacts → survival → pages → links and backlinks.
import type { SimResult } from '../sim/run.ts';
import { Ctx } from './context.ts';
import { buildTitles } from './naming.ts';
import type { Titles } from './naming.ts';
import { buildPages, langLabel } from './pages.ts';
import { Gen } from '../artifacts/gen.ts';
import type { Artifact } from '../artifacts/gen.ts';
import { genTreaties } from '../artifacts/treaty.ts';
import { genChronicles, warTruth, truthFields } from '../artifacts/chronicle.ts';
import { genInscriptions } from '../artifacts/inscription.ts';
import { genLedgers } from '../artifacts/ledger.ts';
import { applySurvival } from '../artifacts/survival.ts';
import { genMore } from '../artifacts/more.ts';
import { genExcavationReports } from '../artifacts/modern.ts';
import { ingestFlagships } from '../flagships/ingest.ts';
import { applyFragments } from '../artifacts/fragments.ts';
import { worldFingerprint } from '../export/export.ts';

/** Persons created by the simulation itself (archive-created authors come after). */
export function simPersonCount(r: SimResult): number {
  return r.simPersons ?? r.state.persons.length;
}
import { resetCalendarCache } from './doc.ts';
import type { PageJson } from '../export/contract.ts';

export interface Archive {
  ctx: Ctx;
  T: Titles;
  gen: Gen;
  pages: Map<string, PageJson>;
  artifacts: Artifact[]; // extant only
  links: number;
}

const LINK_RE = /\[\[([a-z]{3}:\d+)\|/g;

export function buildArchive(r: SimResult, log: (m: string) => void = () => {}): Archive {
  resetCalendarCache();
  const t0 = performance.now();
  const ctx = new Ctx(r);
  const T = buildTitles(ctx);
  log(`titles: ${T.title.size} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  const gen = new Gen(ctx, T);
  genTreaties(gen);
  genChronicles(gen);
  genInscriptions(gen);
  genLedgers(gen);
  genMore(gen);
  const simPersons = r.state.persons.length - 0;
  const fl = ingestFlagships(gen, 'flagships', simPersonCount(r), worldFingerprint(r));
  if (fl.files) log(`flagships: ${fl.added}/${fl.files} added, ${fl.strippedLinks} invalid links stripped${fl.rejected.length ? `, rejected: ${fl.rejected.join('; ')}` : ''}`);
  void simPersons;
  log(`generated ${gen.artifacts.length} candidate documents (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  applySurvival(gen);
  const frags = applyFragments(gen);
  log(`fragments: ${frags} lost works survive as quotations`);
  for (const a of gen.artifacts) if (a.status === 'extant') T.pageRefs.add(`art:${a.id}`);
  const before = gen.artifacts.length;
  genExcavationReports(gen);
  for (const a of gen.artifacts.slice(before)) T.pageRefs.add(`art:${a.id}`);
  const extant = gen.artifacts.filter((a) => a.status === 'extant');
  for (const a of extant) {
    T.title.set(`art:${a.id}`, `${a.catalog} ${a.title}`);
    T.short.set(`art:${a.id}`, a.title);
  }
  // documents that did not survive cannot be linked: strip links to lost artifacts (none exist) and
  // unlink references to non-page entities (Doc.link already guards)
  const pages = buildPages(ctx, T, extant);
  for (const a of extant) pages.set(`art:${a.id}`, artifactPage(ctx, T, a));
  // war pages carry the rival accounts against the ground truth
  for (const a of extant) {
    if (!a.rival) continue;
    const ref = `evt:${a.rival.eventId}`;
    const pg = pages.get(ref);
    if (!pg) continue;
    if (!pg.accounts) {
      const t = warTruth(gen, ctx.s.events[a.rival.eventId]);
      if (!t) continue;
      pg.accounts = { truth: truthFields(gen, t), sources: [] };
    }
    pg.accounts.sources.push({ artifactId: `art:${a.id}`, side: a.rival.side, author: a.author !== null ? T.short.get(`per:${a.author}`) ?? '' : '', claims: a.rival.claims });
  }
  // links & backlinks
  let links = 0;
  for (const pg of pages.values()) {
    const set = new Set<string>();
    const scan = (txt: string) => {
      for (const m of txt.matchAll(LINK_RE)) if (m[1] !== pg.id) set.add(m[1]);
    };
    scan(pg.body);
    for (const [, v] of pg.infobox) scan(v);
    if (pg.accounts) for (const src of pg.accounts.sources) set.add(src.artifactId);
    pg.links = [...set].filter((x) => pages.has(x));
    links += pg.links.length;
  }
  for (const pg of pages.values()) for (const l of pg.links) pages.get(l)!.backlinks.push(pg.id);
  log(`pages: ${pages.size}, documents extant: ${extant.length}, links: ${links} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  return { ctx, T, gen, pages, artifacts: extant, links };
}

function artifactPage(ctx: Ctx, T: Titles, a: Artifact): PageJson {
  const s = ctx.s;
  const ref = `art:${a.id}`;
  const scriptName = a.script >= 0 ? T.short.get(`scr:${a.script}`) ?? '' : a.year >= 4400 ? 'print' : '—';
  const langName = langLabel(ctx, a.lang);
  const infobox: [string, string][] = [
    ['Catalogue', a.catalog],
    ['Date', (() => { const d = a.dateText.replace(/\s*\[AY \d+\]$/, ''); return d === `AY ${a.year}` ? d : `${d} (AY ${a.year})`; })()],
    ...(a.author !== null ? [['Author', `[[per:${a.author}|${T.short.get(`per:${a.author}`) ?? ''}]]`] as [string, string]] : []),
    ...(a.polity !== null ? [['Issued by', `[[pol:${a.polity}|${T.title.get(`pol:${a.polity}`) ?? ''}]]`] as [string, string]] : []),
    ['Language', `[[lan:${a.lang}|${langName}]]`],
    ['Script', a.script >= 0 ? `[[scr:${a.script}|${scriptName}]]` : scriptName],
    ['Medium', a.medium],
    ...(a.settlement !== null ? [['Place', `[[set:${a.settlement}|${T.short.get(`set:${a.settlement}`) ?? ''}]]`] as [string, string]] : []),
    ...(a.about.filter((e) => T.pageRefs.has(`evt:${e}`)).length ? [['Concerns', a.about.filter((e) => T.pageRefs.has(`evt:${e}`)).slice(0, 6).map((e) => `[[evt:${e}|${T.title.get(`evt:${e}`)}]]`).join(', ')] as [string, string]] : []),
    ['Condition', a.condition],
    ['Provenance', a.provenance],
    ...(a.translator !== null ? [['Translated by', `[[per:${a.translator}|${T.short.get(`per:${a.translator}`) ?? ''}]]`] as [string, string]] : []),
  ];
  // provenance mentions as links in the provenance text
  return {
    id: ref, kind: 'artifact', sub: a.sub, title: a.title, t0: a.year, t1: a.year,
    summary: `${a.title}. ${cap1(a.medium)}, ${langName}, AY ${a.year}.`,
    infobox, body: a.body, links: [], backlinks: [], labels: {}, cell: a.cell,
    artifact: {
      catalog: a.catalog, date: a.dateText.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1'), language: langName, script: scriptName, medium: a.medium,
      authorId: a.author !== null ? `per:${a.author}` : undefined, condition: a.condition, provenance: a.provenance,
      translatorId: a.translator !== null ? `per:${a.translator}` : undefined, flagship: a.flagship,
      interlinear: a.interlinear, ledger: a.ledger, rival: a.rival ? { eventId: `evt:${a.rival.eventId}`, side: a.rival.side } : undefined,
    },
  };
  void s;
}

function cap1(x: string): string {
  return x ? x[0].toUpperCase() + x.slice(1) : x;
}
