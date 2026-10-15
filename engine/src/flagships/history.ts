// Wave 5: "A History of the World" in twenty chapters of 250 years (fl-901–920) and an introduction
// (fl-900). Each chapter's dossier digests the period from the record: the great powers, wars,
// collapses, plagues and climate, faiths, inventions, prices, languages and the surviving sources.
import type { Archive } from '../archive/build.ts';
import type { SimEvent } from '../sim/state.ts';
import type { Dossier } from './dossier.ts';
import { startOf, stripLinks, GUIDANCE } from './dossier.ts';
import { TECHS } from '../sim/tech.ts';
import { worldNameOf } from '../export/export.ts';

const SPAN = 250;

export function buildHistory(a: Archive): Dossier[] {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const g = a.gen;
  const ed = s.polities[ctx.editorialPolity];
  const lang = ctx.editorialLang;
  const simPersons = ctx.r.simPersons ?? s.persons.length;
  const simEvents = ctx.r.simEvents ?? s.events.length;
  const world = worldNameOf(ctx.r, a);
  const name = (ref: string) => T.short.get(ref) ?? ref;
  const titleOf = (ref: string) => (T.title.get(ref) ?? name(ref)).replace(/ \(AY [^)]*\)$/, '');
  const summ = (ref: string) => stripLinks(a.pages.get(ref)?.summary ?? '');
  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n >= 1e4 ? `${Math.round(n / 1e3)} thousand` : String(Math.round(n)));
  const evOk = (e: SimEvent) => e.id < simEvents && T.pageRefs.has(`evt:${e.id}`);

  // decadal statistics by year
  const rowsAt = new Map<number, (number | string | null)[][]>();
  for (const row of s.polityYears) {
    const y = row[1] as number;
    let l = rowsAt.get(y);
    if (!l) rowsAt.set(y, (l = []));
    l.push(row);
  }
  const statePop = (y: number) => (rowsAt.get(y) ?? []).reduce((t, r) => t + (r[3] as number), 0);
  const stateCount = (y: number) => (rowsAt.get(y) ?? []).length;

  // documents about each event
  const docsAbout = new Map<number, typeof a.artifacts>();
  for (const x of a.artifacts) for (const e of x.about) {
    let l = docsAbout.get(e);
    if (!l) docsAbout.set(e, (l = []));
    l.push(x);
  }
  // first adoption of each technology anywhere
  const techFirst = TECHS.map((t) => {
    let best: [number, number] | null = null;
    for (const p of s.polities) { const y = p.techs.get(t.id); if (y !== undefined && (!best || y < best[0])) best = [y, p.id]; }
    return { t, first: best };
  });
  // land cells, for shares of the map
  const land: number[] = [];
  for (let c = 0; c < s.world.n; c++) if (s.world.land[c]) land.push(c);
  const shareAt = (y: number, at: (c: number, y: number) => number) => {
    const m = new Map<number, number>();
    for (const c of land) { const v = at(c, y); if (v >= 0) m.set(v, (m.get(v) ?? 0) + 1); }
    return [...m].sort((x, z) => z[1] - x[1]);
  };
  const median = (xs: number[]) => { const v = [...xs].sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };
  const grainAt = (y0: number, y1: number) => median(s.prices.filter((p) => p.good === 0 && p.year >= y0 && p.year < y1).map((p) => p.price));
  const climate = (y0: number, y1: number) => { const xs = s.climate.filter((c) => c.year >= y0 && c.year < y1); return xs.length ? xs.reduce((t, c) => t + c.temp, 0) / xs.length : 0; };

  const scholars = g.scholars.filter((id) => s.persons[id].born + 30 <= 4999 && s.persons[id].died >= 4999);
  const out: Dossier[] = [];
  const headline: string[] = [];

  // one line per chapter, so each writer knows the whole arc
  for (let k = 0; k < 5000 / SPAN; k++) {
    const y0 = k * SPAN, y1 = y0 + SPAN;
    const big = (shareAt(y0 + 120, (c, y) => ctx.ownerAt(c, y))).slice(0, 3).map(([p]) => name(`pol:${p}`));
    const war = s.events.filter((e) => e.sub === 'war' && e.year >= y0 && e.year < y1 && evOk(e)).sort((x, y) => Number(y.data.lossesA ?? 0) + Number(y.data.lossesD ?? 0) - Number(x.data.lossesA ?? 0) - Number(x.data.lossesD ?? 0) || y.sig - x.sig)[0];
    headline.push(`Chapter ${k + 1} (AY ${y0}–${y1}): largest states at mid-period ${big.join(', ') || 'none'}${war ? `; the greatest war, ${titleOf(`evt:${war.id}`)} (AY ${war.year})` : ''}`);
  }

  const make = (k: number, form: string, subjectId: string, subjTitle: string, facts: string[], links: string[], context: string[], words: string): void => {
    const who = scholars[(k * 5 + 3) % scholars.length];
    const year = 4999;
    const allowed: Dossier['allowedLinks'] = [];
    const seen = new Set<string>();
    for (const ref of links) {
      if (seen.has(ref) || !T.pageRefs.has(ref)) continue;
      if (ref.startsWith('per:') && ctx.idNum(ref) >= simPersons) continue;
      if (ref.startsWith('evt:') && ctx.idNum(ref) >= simEvents) continue;
      const st = startOf(a, ref);
      if (st !== null && st > year) continue;
      seen.add(ref);
      const sexNote = ref.startsWith('per:') ? ` (${s.persons[ctx.idNum(ref)].sex === 'f' ? 'woman; she/her' : 'man; he/him'})` : ref.startsWith('dei:') ? ` (${s.deities[ctx.idNum(ref)].sex === 'f' ? 'goddess; she/her' : 'god; he/him'})` : '';
      allowed.push({ id: ref, text: name(ref), what: titleOf(ref) + sexNote });
      if (allowed.length >= 110) break;
    }
    const id = `fl-${String(900 + k).padStart(3, '0')}`;
    const p = s.persons[who];
    out.push({
      id, form, register: 'Modern narrative history for general readers: confident, vivid and exact; explains causes; weighs the sources; may cite AY dates and catalogue numbers in prose.',
      year, localDate: `AY ${year}`, language: name(`lan:${lang}`), script: 'print', medium: 'book chapter',
      author: { id: `per:${who}`, name: name(`per:${who}`), role: `${p.sex === 'f' ? 'woman' : 'man'}; ${p.roles.map((r) => r.role).join(', ')}`, polity: name(`pol:${ed.id}`), born: p.born, died: p.died, stance: `a modern historian contributing to a collaborative history of ${world}: synthesizing, sceptical of court propaganda, attentive to climate, prices and ordinary people` },
      subject: { id: subjectId, title: subjTitle, summary: subjTitle, facts },
      context, allowedLinks: allowed,
      guidance: GUIDANCE
        .replace('Do not mention "simulation", "AY", "dossier" or the modern editors (except in the modern editorial essays, which are written by those editors and may use AY dates).', 'This is modern scholarship written in AY 4999, so the whole past is known: you MAY use AY dates and may look ahead to later chapters. Never mention "simulation", "dossier" or "ground truth"; call it "the record" or "the documentary consensus". Do not link documents; cite sources by catalogue number and title in plain text.')
        .replace('Write ONE primary source in English translation, as it would appear in a modern scholarly edition.', `Write ONE chapter of *A History of ${world}*, a modern narrative history in twenty-one parts.`)
        .replace('Length: 350–750 words.', words)
        .replace('Bronze Age texts are formulaic; industrial texts read like newspapers or speeches; poems are in lines.', 'This is modern prose: narrative, with argument.'),
      frontmatter: [`id: ${id}`, `subject: ${subjectId}`, `form: ${form}`, `year: ${year}`, `author: per:${who}`, `polity: pol:${ed.id}`, `lang: ${lang}`, `script: ${ctx.scriptOf(ed, year)}`, `medium: book chapter`].join('\n'),
    });
  };

  // 0. introduction: how we know
  {
    const perMil = [0, 1, 2, 3, 4].map((m) => {
      const xs = a.artifacts.filter((x) => x.year >= m * 1000 && x.year < (m + 1) * 1000);
      const subs = new Map<string, number>();
      for (const x of xs) subs.set(x.sub, (subs.get(x.sub) ?? 0) + 1);
      return `AY ${m * 1000}–${(m + 1) * 1000}: ${xs.length} surviving documents; commonest kinds ${[...subs].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k2, v]) => `${k2} (${v})`).join(', ')}`;
    });
    const media = new Map<string, number>();
    for (const x of a.artifacts) media.set(x.medium, (media.get(x.medium) ?? 0) + 1);
    const excav = s.events.filter((e) => e.sub === 'excavation').length;
    const langs = s.lang.languages();
    const fams = langs.filter((l) => l.parent === null);
    const facts = [
      `The world: ${world}. The record runs from AY 0 to AY 5000.`,
      `Surviving documents in the archive: ${a.artifacts.length}, of which ${a.artifacts.filter((x) => x.flagship).length} are literary works and modern essays.`,
      ...perMil,
      `Media: ${[...media].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k2, v]) => `${k2} ${v}`).join(', ')}.`,
      `Excavations recorded: ${excav}. Fragments of lost works survive only through quotation in later texts.`,
      `Languages in the record: ${langs.length}, in ${fams.length} families (${fams.map((l) => name(`lan:${l.id}`)).join(', ')}). Writing systems: ${s.scripts.length}, from logosyllabic scripts to alphabets.`,
      `States in the record: ${s.polities.length}. Wars: ${s.events.filter((e) => e.sub === 'war').length}. Peace treaties: ${s.events.filter((e) => e.sub === 'treaty').length}.`,
      'Calendars: each people dated by its own era (regnal years, foundation eras, religious eras); modern scholarship converts all dates to Archive Years (AY).',
      'Rival chronicles of the same war disagree with each other and with the record; historians reconstruct the documentary consensus by comparing them with treaties, ledgers and inscriptions.',
      'Bias of survival: clay and stone survive, parchment and paper mostly do not; the early record is royal and monumental, the late record is commercial and popular.',
    ];
    make(0, 'survey essay (introduction)', 'hist:0', `A History of ${world}: Introduction. How we know what we know`, facts,
      [...fams.map((l) => `lan:${l.id}`), `pol:${ed.id}`], ['The chapters of this history:', ...headline], 'Length: 1,500–2,200 words, with 3–5 short section headings.');
  }

  for (let k = 0; k < 5000 / SPAN; k++) {
    const y0 = k * SPAN, y1 = y0 + SPAN, mid = y0 + 120; // decade-aligned
    const facts: string[] = [];
    const links: string[] = [];
    const inP = (e: SimEvent) => e.year >= y0 && e.year < y1 && evOk(e);
    const evs = s.events.filter(inP);
    facts.push(`Period: AY ${y0}–${y1}.`);
    const p0 = statePop(y0), p1 = statePop(Math.min(4990, y1 - 10));
    facts.push(`People living under states: ${fmt(p0)} in AY ${y0}, ${fmt(statePop(mid))} in AY ${mid}, ${fmt(p1)} in AY ${y1 - 10}. Number of states: ${stateCount(y0)} → ${stateCount(mid)} → ${stateCount(Math.min(4990, y1 - 10))}.`);
    const cl = climate(y0, y1);
    facts.push(`Climate: mean temperature anomaly ${cl >= 0 ? '+' : ''}${cl.toFixed(2)} °C over the period (relative to the long-run mean).`);
    const gp0 = grainAt(y0, y0 + 30), gp1 = grainAt(y1 - 30, y1);
    if (Number.isFinite(gp0) && Number.isFinite(gp1)) facts.push(`Grain: the median market price of a measure of grain was ${gp0.toFixed(1)} g of silver at the start of the period and ${gp1.toFixed(1)} g at its end.`);

    // great powers: by peak population within the period
    const peak = new Map<number, (number | string | null)[]>();
    for (let y = y0; y < y1; y += 10) for (const row of rowsAt.get(y) ?? []) { const p = row[0] as number; if (!peak.has(p) || (row[3] as number) > (peak.get(p)![3] as number)) peak.set(p, row); }
    const powers = [...peak.values()].sort((x, y) => (y[3] as number) - (x[3] as number)).slice(0, 9);
    for (const row of powers) {
      const pid = row[0] as number;
      const pol = s.polities[pid];
      const reigns = (ctx.reigns.get(pid) ?? []).filter((r) => r.end > y0 && r.start < y1).sort((x, y) => (y.end - y.start) - (x.end - x.start)).slice(0, 3);
      const cap = row[10] as number;
      const life = (ctx.polityStats.get(pid) ?? []).reduce<(number | string | null)[] | null>((m, r) => (m === null || (r[3] as number) > (m[3] as number) ? r : m), null);
      facts.push(`Great power: ${titleOf(`pol:${pid}`)} (AY ${pol.born}–${pol.died ?? 'present'}): largest within this chapter ${fmt(row[3] as number)} people and ${row[2]} districts (survey of the ${row[1]}s)${life && life[1] !== row[1] ? `; its all-time peak came later or earlier: ${fmt(life[3] as number)} people and ${life[2]} districts (survey of the ${life[1]}s)` : '; this was its all-time peak'}; capital ${cap >= 0 ? name(`set:${cap}`) : 'none'}; government ${row[8]}${reigns.length ? `; long reigns: ${reigns.map((r) => `${name(`per:${r.person}`)} (${r.start}–${r.end})`).join(', ')}` : ''}.`);
      links.push(`pol:${pid}`);
      if (cap >= 0) links.push(`set:${cap}`);
      for (const r of reigns) links.push(`per:${r.person}`);
    }
    const share = shareAt(mid, (c, y) => ctx.ownerAt(c, y));
    const stateless = land.length - share.reduce((t, [, v]) => t + v, 0);
    facts.push(`Map at AY ${mid}: ${Math.round((100 * stateless) / land.length)}% of the land outside any state; largest by territory ${share.slice(0, 4).map(([p, v]) => `${name(`pol:${p}`)} ${Math.round((100 * v) / land.length)}%`).join(', ')}.`);

    // foundings and ends of states
    const born = s.polities.filter((p) => p.born >= y0 && p.born < y1).map((p) => ({ p, peak: Math.max(0, ...(ctx.polityStats.get(p.id) ?? []).map((r) => r[3] as number)) })).sort((x, y) => y.peak - x.peak).slice(0, 6);
    for (const { p, peak: pk } of born) { facts.push(`Founded AY ${p.born}: ${titleOf(`pol:${p.id}`)} (lasted to ${p.died ?? 'the present'}; at its height ${fmt(pk)} people)${p.foundEvent !== null && T.pageRefs.has(`evt:${p.foundEvent}`) ? `; founding: ${titleOf(`evt:${p.foundEvent}`)}` : ''}.`); links.push(`pol:${p.id}`); }
    const ends = evs.filter((e) => e.sub === 'collapse' || e.sub === 'conquest' || e.sub === 'annexation').sort((x, y) => y.sig - x.sig).slice(0, 6);
    for (const e of ends) { facts.push(`${e.sub === 'collapse' ? 'Collapse' : e.sub === 'conquest' ? 'Conquest' : 'Annexation'}, AY ${e.year}: ${titleOf(`evt:${e.id}`)}. ${summ(`evt:${e.id}`)}`); links.push(`evt:${e.id}`, ...e.parts.slice(0, 3).map(([r]) => r)); }

    // wars
    const dead = (e: SimEvent) => Number(e.data.lossesA ?? 0) + Number(e.data.lossesD ?? 0);
    const wars = evs.filter((e) => e.sub === 'war').sort((x, y) => dead(y) - dead(x) || y.sig - x.sig).slice(0, 8).sort((x, y) => x.year - y.year);
    for (const e of wars) {
      const docs = (docsAbout.get(e.id) ?? []).sort((x, y) => Number(y.flagship) - Number(x.flagship)).slice(0, 2);
      facts.push(`War, AY ${e.year}–${e.end}: ${titleOf(`evt:${e.id}`)}. ${summ(`evt:${e.id}`)}${docs.length ? ` Sources: ${docs.map((d) => `${d.catalog} "${d.title}"`).join('; ')}.` : ''}`);
      links.push(`evt:${e.id}`, ...e.parts.slice(0, 4).map(([r]) => r));
    }
    // disasters and upheavals
    const kinds = ['reform', 'election', 'plague', 'famine', 'eruption', 'drought', 'cold-period', 'migration', 'revolution', 'revolt', 'civil-war', 'usurpation', 'sack', 'trade-collapse', 'warming'];
    const upheavals = evs.filter((e) => kinds.includes(e.sub)).sort((x, y) => y.sig - x.sig).slice(0, 12).sort((x, y) => x.year - y.year);
    for (const e of upheavals) { facts.push(`${e.sub[0].toUpperCase() + e.sub.slice(1)}, AY ${e.year}: ${titleOf(`evt:${e.id}`)}. ${summ(`evt:${e.id}`)}`); links.push(`evt:${e.id}`); }
    const anoms = s.anomalies.filter((x) => x.start >= y0 && x.start < y1).sort((x, y) => y.severity - x.severity).slice(0, 4);
    for (const x of anoms) facts.push(`Climate anomaly: ${x.kind} from AY ${x.start} to ${x.end} (severity ${x.severity.toFixed(2)}, ${x.cells.length} districts affected)${T.pageRefs.has(`evt:${x.event}`) ? `, ${titleOf(`evt:${x.event}`)}` : ''}.`);

    // faiths and ideas
    const faith = evs.filter((e) => ['movement-founding', 'schism', 'council', 'persecution', 'conversion'].includes(e.sub)).sort((x, y) => y.sig - x.sig).slice(0, 8).sort((x, y) => x.year - y.year);
    for (const e of faith) { facts.push(`Faith and thought, AY ${e.year}: ${titleOf(`evt:${e.id}`)}. ${summ(`evt:${e.id}`)}`); links.push(`evt:${e.id}`, ...e.parts.slice(0, 2).map(([r]) => r)); }
    const rel = shareAt(mid, (c, y) => ctx.religionAt(c, y)).slice(0, 4);
    facts.push(`Faiths by share of the land at AY ${mid}: ${rel.map(([m, v]) => `${name(`mov:${m}`)} ${Math.round((100 * v) / land.length)}%`).join(', ')}.`);
    for (const [m] of rel) links.push(`mov:${m}`);
    for (const mv of s.movements.filter((m) => m.born >= y0 && m.born < y1 && (m.kind !== 'cult')).sort((x, y) => y.peak - x.peak).slice(0, 4)) {
      facts.push(`New ${mv.kind}: ${titleOf(`mov:${mv.id}`)} (AY ${mv.born})${mv.founder !== null ? `, founded by ${name(`per:${mv.founder}`)}` : ''}.`);
      links.push(`mov:${mv.id}`);
      if (mv.founder !== null) links.push(`per:${mv.founder}`);
    }

    // technology
    const techs = techFirst.filter((x) => x.first && x.first[0] >= y0 && x.first[0] < y1);
    if (techs.length) facts.push(`First adopted: ${techs.map((x) => `${x.t.name} (AY ${x.first![0]}, ${name(`pol:${x.first![1]}`)})`).join('; ')}.`);
    for (const e of evs.filter((e) => e.sub === 'invention' || e.sub === 'script-invention').slice(0, 5)) { facts.push(`Invention, AY ${e.year}: ${titleOf(`evt:${e.id}`)}. ${summ(`evt:${e.id}`)}`); links.push(`evt:${e.id}`, ...e.parts.slice(0, 2).map(([r]) => r)); }

    // money and trade
    const money = evs.filter((e) => ['debasement', 'currency-reform', 'paper-money', 'hyperinflation', 'default', 'bankruptcy', 'repudiation'].includes(e.sub)).sort((x, y) => y.sig - x.sig).slice(0, 5);
    for (const e of money) { facts.push(`Money, AY ${e.year}: ${titleOf(`evt:${e.id}`)}. ${summ(`evt:${e.id}`)}`); links.push(`evt:${e.id}`); }
    // counts use every simulated event, not only those important enough to have a page
    const all = s.events.filter((e) => e.id < simEvents && e.year >= y0 && e.year < y1);
    facts.push(`Merchant houses founded in the period: ${all.filter((e) => e.sub === 'house-founding').length}; coinages and weight standards introduced: ${all.filter((e) => e.sub === 'coinage' || e.sub === 'weight-standard').length}; state collapses in all: ${all.filter((e) => e.sub === 'collapse').length}; wars in all: ${all.filter((e) => e.sub === 'war').length}.`);

    // contact and colonies
    for (const e of evs.filter((e) => ['first-contact', 'colonization', 'colonial-claim'].includes(e.sub)).sort((x, y) => y.sig - x.sig).slice(0, 5)) { facts.push(`Across the sea, AY ${e.year}: ${titleOf(`evt:${e.id}`)}. ${summ(`evt:${e.id}`)}`); links.push(`evt:${e.id}`, ...e.parts.slice(0, 2).map(([r]) => r)); }

    // languages and scripts
    const newLangs = s.lang.languages().filter((l) => l.born >= y0 && l.born < y1 && l.parent !== null).slice(0, 6);
    if (newLangs.length) facts.push(`Languages that emerged as distinct: ${newLangs.map((l) => `${name(`lan:${l.id}`)} (AY ${l.born}, from ${name(`lan:${l.parent}`)})`).join('; ')}.`);
    for (const l of newLangs) links.push(`lan:${l.id}`, `lan:${l.parent}`);
    const laws = s.lang.languages().flatMap((l) => s.lang.soundChanges(l.id).filter((c) => c.year >= y0 && c.year < y1).map((c) => ({ l, c })));
    const own = new Map<string, typeof laws[number]>();
    for (const x of laws) if (!own.has(x.c.label + x.c.year)) own.set(x.c.label + x.c.year, x);
    if (own.size) facts.push(`Distinct sound changes (by rule and year) dated to the period: ${own.size} (${laws.length} counting each language separately); for example ${[...own.values()].slice(0, 3).map((x) => `${x.c.label} in ${name(`lan:${x.l.id}`)} c. AY ${x.c.year}`).join('; ')}.`);
    for (const e of evs.filter((e) => e.sub === 'script-adoption').slice(0, 3)) { facts.push(`Writing, AY ${e.year}: ${titleOf(`evt:${e.id}`)}.`); links.push(`evt:${e.id}`); }

    // sources
    const docs = a.artifacts.filter((x) => x.year >= y0 && x.year < y1 && !x.flagship);
    const subs = new Map<string, number>();
    for (const x of docs) subs.set(x.sub, (subs.get(x.sub) ?? 0) + 1);
    facts.push(`Surviving documents from the period: ${docs.length + a.artifacts.filter((x) => x.year >= y0 && x.year < y1 && x.flagship).length} in all: ${docs.length} procedural documents, and ${a.artifacts.filter((x) => x.year >= y0 && x.year < y1 && x.flagship).length} literary works and essays (the procedural ones: ${[...subs].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k2, v]) => `${k2} ${v}`).join(', ')}).`);
    const key = docs.filter((x) => x.about.some((e) => s.events[e] && s.events[e].sig >= 0.5)).sort((x, y) => Math.max(...y.about.map((e) => s.events[e]?.sig ?? 0)) - Math.max(...x.about.map((e) => s.events[e]?.sig ?? 0))).slice(0, 8);
    for (const x of key) facts.push(`Source: ${x.catalog} "${x.title}" (${x.sub}, AY ${x.year}).`);
    const lit = a.artifacts.filter((x) => x.flagship && x.year >= y0 && x.year < y1).slice(0, 10);
    for (const x of lit) facts.push(`Literary source: ${x.catalog} "${x.title}" (AY ${x.year}).`);

    const context = ['The chapters of this history (write only yours; you may refer back or look ahead in a sentence):', ...headline];
    if (k > 0) context.push(`The previous chapter ended in AY ${y0}.`);
    make(k + 1, `survey essay (A History of ${world}, chapter ${k + 1})`, `hist:${k + 1}`, `A History of ${world}, chapter ${k + 1}: AY ${y0}–${y1}`, facts, links, context, 'Length: 2,000–3,000 words, with 4–6 section headings (##). Give the chapter an evocative title in the frontmatter, e.g. "The Bronze Kings (AY 0–250)". Open with a scene or a source, then explain. End by handing over to the next chapter.');
  }
  return out;
}
