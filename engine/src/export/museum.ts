// The Museum (atlas #/museum): about two dozen celebrated documents, shown as 3D objects built from their records.
// Every pick is a rule over the extant archive (the oldest dated document, the biggest boast in stone, the first
// coin, the most debased coin and its first issue, the first printed book…), so the hall re-curates itself when the
// record changes. Each item carries a trimmed copy of its page (the atlas builds the model from it without fetching
// a page shard) and the coats of arms and seal the object shows (an issuer's emblem, the parties' seals).
import type { SimResult } from '../sim/run.ts';
import type { Archive } from '../archive/build.ts';
import type { Artifact } from '../artifacts/gen.ts';
import type { ArmsSpec, MuseumJson, PageJson, SigilSpec } from './contract.ts';
import type { Heraldry } from './deck.ts';

const BODY_MAX = 2400;

export function museumJson(r: SimResult, a: Archive, H: Heraldry): MuseumJson {
  const s = r.state;
  // physical objects only: a work known from quotations has no object to show
  const phys = a.artifacts.filter((x) => !x.condition.startsWith('Lost')).sort((x, y) => x.year - y.year || x.id - y.id);
  const first = (f: (x: Artifact) => boolean) => phys.find(f);
  const last = (f: (x: Artifact) => boolean) => phys.findLast(f);
  const num = (v: string | undefined) => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const picks: { x: Artifact | undefined; why: string | ((x: Artifact) => string) }[] = [];
  const add = (x: Artifact | undefined, why: string | ((x: Artifact) => string)) => picks.push({ x, why });

  add(first(() => true), (x) => `The oldest dated document in the archive, written in AY ${x.year}.`);
  add(first((x) => x.sub === 'inscription'), 'The oldest inscription.');
  add(first((x) => x.sub === 'letter'), 'The oldest letter.');
  add(first((x) => x.sub === 'treaty'), 'The oldest treaty.');
  add(first((x) => x.sub === 'inscription' && /^Victory stele/.test(x.title)), 'The first victory monument: a king’s account of his battle, cut in rock.');
  // the liars' gallery: the stele that invents the most enemy dead (the same measure as the "biggest boasts" collection)
  let boast: { x: Artifact; claimed: number; truth: number } | undefined;
  for (const x of phys) {
    if (x.flagship || x.sub !== 'inscription') continue;
    const m = x.body.match(/It claims ([\d,]+) enemy dead\. The record of the battle gives ([\d,]+) losses/);
    if (!m) continue;
    const claimed = num(m[1]), truth = num(m[2]);
    if (!boast || claimed - truth > boast.claimed - boast.truth) boast = { x, claimed, truth };
  }
  if (boast) { const b = boast; add(b.x, `The biggest boast in stone: it claims ${fmt(b.claimed)} enemy dead; the record of the battle has ${fmt(b.truth)}.`); }
  add(first((x) => x.medium === 'clay tablet in envelope'), 'The oldest letter still with its clay envelope.');
  add(first((x) => x.sub === 'graffito'), 'The oldest graffito, scratched by a soldier.');
  add(first((x) => x.sub === 'treaty' && /silver|bronze/.test(x.medium)), (x) => `The oldest treaty cut in metal, on a ${x.medium}.`);
  add(first((x) => x.medium === 'potsherd'), 'A school exercise on a broken pot, with the teacher’s corrections.');
  add(first((x) => x.medium.startsWith('papyrus')), 'The oldest papyrus.');
  add(first((x) => /parchment codex/.test(x.medium)), 'The oldest codex: a book of bound leaves rather than a roll.');
  add(first((x) => x.sub === 'coin'), 'The first coin.');
  add(first((x) => x.medium === 'gold coin'), 'The first gold coin.');
  // the debasement pair: of the currencies whose first issue and a later one both survive, the one whose silver fell furthest
  const issues = new Map<number, { x: Artifact; issue: number; fine: number }[]>();
  for (const x of phys) {
    if (x.sub !== 'coin' || x.medium !== 'silver coin') continue;
    const m = x.body.match(/Issue (\d+) of the \[\[cur:(\d+)\|/), f = x.body.match(/about (\d+)% fine/);
    if (!m || !f) continue;
    const cur = Number(m[2]);
    if (!issues.has(cur)) issues.set(cur, []);
    issues.get(cur)!.push({ x, issue: Number(m[1]), fine: Number(f[1]) });
  }
  let pair: [{ x: Artifact; fine: number }, { x: Artifact; fine: number }] | undefined;
  for (const list of issues.values()) {
    const one = list.find((c) => c.issue === 1);
    const late = list.filter((c) => c.issue > 1).sort((p, q) => p.fine - q.fine || q.issue - p.issue)[0];
    if (one && late && late.fine < one.fine && (!pair || one.fine - late.fine > pair[0].fine - pair[1].fine)) pair = [one, late];
  }
  if (pair) {
    const [one, late] = pair;
    add(one.x, `A first issue, about ${one.fine}% silver: set it beside its debased descendant.`);
    add(late.x, `The same coinage ${late.x.year - one.x.year} years later: about ${late.fine}% silver, the most debased coin whose first issue also survives.`);
  }
  add(first((x) => x.medium === 'wax tablet'), 'Written in wax with a stylus, and never wiped clean.');
  add(first((x) => x.medium === 'paper codex'), 'The oldest paper book.');
  // the treaty that ended the deadliest war
  const deadliest = s.events.filter((e) => e.sub === 'war').sort((x, y) => (Number(y.data.lossesA ?? 0) + Number(y.data.lossesD ?? 0)) - (Number(x.data.lossesA ?? 0) + Number(x.data.lossesD ?? 0)))[0];
  if (deadliest) add(first((x) => x.sub === 'treaty' && x.about.includes(deadliest.id)), 'The treaty that ended the deadliest war in five thousand years.');
  add(first((x) => x.medium === 'parchment, with seals'), 'The oldest treaty sealed in wax by its parties.');
  add(first((x) => x.sub === 'patent'), (x) => `The first patent: ${x.title.replace(/^[^:]*:\s*/, '').replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}.`);
  add(first((x) => x.medium === 'newsprint'), 'The first newspaper.');
  add(first((x) => x.medium === 'printed book'), 'The first printed book.');
  add(first((x) => x.sub === 'telegram'), 'The first telegram, sent from the battlefield.');
  add(first((x) => x.sub === 'treaty' && /typescript/.test(x.medium)), 'The first treaty typed rather than written.');
  add(last(() => true), 'The newest document in the archive.');

  const seen = new Set<number>();
  const items: MuseumJson['items'] = [];
  for (const { x, why } of picks) {
    if (!x || seen.has(x.id)) continue;
    const pg = a.pages.get(`art:${x.id}`);
    if (!pg) continue;
    seen.add(x.id);
    items.push({ id: pg.id, why: typeof why === 'string' ? why : why(x), page: trimPage(pg), arms: armsFor(x, pg), sigil: sigilFor(x) });
  }
  items.sort((p, q) => p.page.t0 - q.page.t0 || p.id.localeCompare(q.id));
  return { items };

  function armsFor(x: Artifact, pg: PageJson): Record<string, ArmsSpec> {
    const out: Record<string, ArmsSpec> = {};
    const ids = new Set<number>();
    if (x.polity !== null) ids.add(x.polity);
    for (const m of pg.body.matchAll(/\[\[pol:(\d+)\|/g)) if (ids.size < 6) ids.add(Number(m[1]));
    for (const id of ids) if (s.polities[id]) out[`pol:${id}`] = H.polity(s.polities[id]);
    return out;
  }
  function sigilFor(x: Artifact): SigilSpec | undefined {
    return x.author !== null && s.persons[x.author] ? H.person(s.persons[x.author]) : undefined;
  }
}

/** The page without its link lists, the body cut at a paragraph, the gloss without per-word tokens. */
function trimPage(pg: PageJson): PageJson {
  let body = pg.body;
  if (body.length > BODY_MAX) {
    const cut = body.lastIndexOf('\n\n', BODY_MAX);
    body = body.slice(0, cut > BODY_MAX / 2 ? cut : BODY_MAX).trimEnd() + '\n\n…';
  }
  const art = pg.artifact ? { ...pg.artifact } : undefined;
  if (art?.interlinear) art.interlinear = { ...art.interlinear, tokens: [] };
  if (art?.ledger) art.ledger = { ...art.ledger, rows: art.ledger.rows.slice(0, 14), notes: [] };
  return {
    id: pg.id, kind: pg.kind, sub: pg.sub, title: pg.title, t0: pg.t0, t1: pg.t1, summary: pg.summary,
    infobox: pg.infobox, body, links: [], backlinks: [], labels: {}, cell: pg.cell, artifact: art,
  };
}
