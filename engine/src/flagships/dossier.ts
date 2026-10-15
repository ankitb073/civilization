// Flagship dossiers: for a few hundred of the archive's most significant moments, a fact sheet an
// author (human or AI) can write a rich primary source from, without contradicting the record.
import type { Archive } from '../archive/build.ts';
import type { SimEvent, Polity, Person } from '../sim/state.ts';
import { localDate } from '../archive/doc.ts';
import { tenetText } from '../archive/pages.ts';
import { Rng } from '../core/rng.ts';
import { TECHS } from '../sim/tech.ts';
import { GOODS } from '../sim/economy.ts';

export interface Dossier {
  id: string;
  form: string;
  register: string;
  year: number;
  localDate: string;
  language: string;
  script: string;
  medium: string;
  author: { id: string | null; name: string; role: string; polity: string | null; born: number | null; died: number | null; stance: string } | null;
  subject: { id: string; title: string; summary: string; facts: string[] };
  context: string[];
  allowedLinks: { id: string; text: string; what: string }[];
  guidance: string;
  /** Copy verbatim into the output file, then add a `title:` line. */
  frontmatter: string;
}

const FORMS: Record<string, string[]> = {
  war: ['epic poem fragment', 'war memoir', 'letter from the front', 'lament for the fallen', 'victory hymn', 'dispatch to the court'],
  treaty: ['envoy’s report of the negotiations', 'speech at the swearing of the peace', 'letter of a hostage'],
  collapse: ['lament for the city', 'eyewitness chronicle of the fall', 'letter of a refugee', 'last decree of the court'],
  'movement-founding': ['sermon', 'philosophical dialogue', 'hymn', 'confession of a convert', 'letter of the founder'],
  schism: ['open letter of excommunication', 'defence of the new teaching', 'record of a disputation'],
  plague: ['physician’s diary', 'letter of a merchant during the plague', 'prayer in time of pestilence'],
  eruption: ['diary of the dark years', 'priest’s account of the darkened sky'],
  famine: ['petition of the starving to the king', 'diary of a hard year'],
  'trade-collapse': ['merchant’s memoir of the hard decade', 'letter of a ruined trader'],
  revolution: ['speech to the crowd', 'memoir of a revolutionary', 'diary of a courtier during the revolution'],
  'first-contact': ['ship’s log', 'letter of the first envoy', 'account of the newcomers by a local chronicler'],
  colonization: ['letter of a settler', 'charter of the colony', 'complaint of the natives to the colonial governor'],
  invention: ['letter of the inventor', 'lecture before the academy', 'newspaper feature on the invention'],
  reign: ['royal autobiography inscription', 'panegyric', 'satirical verses on the king', 'testament of the ruler'],
  panic: ['merchant’s memoir of the panic', 'letter of a banker'],
  'script-invention': ['scribal school exercise and its teacher’s preface', 'praise of the new letters'],
  modern: ['editor’s preface to the archive', 'essay on the reliability of the chronicles', 'lecture on the great collapse'],
};

function era(a: Archive, p: Polity | null, year: number): number {
  return p ? a.ctx.eraAt(p.id, Math.min(year, (p.died ?? 5000) - 1)) : 6;
}

const REGISTER = [
  'Bronze Age: formulaic, paratactic, invocations of gods, repetition, epithets; no abstractions.',
  'Iron Age: formulaic but more narrative; omens, gods, kings, tribute.',
  'Classical: rhetorical, philosophical asides, civic virtue, measured periods.',
  'Medieval: pious, hierarchical, scriptural allusion, feudal obligation.',
  'Early modern: printed-age prose, learned, argumentative, dated with care.',
  'Industrial: newspaper and official prose, statistics, steam and wire, mass politics.',
  'Post-industrial: modern, plain, technical vocabulary, institutions.',
];

export function buildDossiers(a: Archive, limit = 240): Dossier[] {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const rng = new Rng(s.seed).fork('dossiers');
  const simPersons = s.persons.length; // archive-created persons have unstable ids; flagships use sim persons only
  const isSim = (ref: string) => !ref.startsWith('per:') || ctx.idNum(ref) < simPersons;
  const chosen: { kind: string; e: SimEvent | null; p?: Polity; person?: Person }[] = [];
  const take = (kind: string, evs: SimEvent[], n: number) => {
    for (const e of evs.slice(0, n)) chosen.push({ kind, e });
  };
  const bySig = (sub: string, f: (e: SimEvent) => boolean = () => true) => s.events.filter((e) => e.sub === sub && T.pageRefs.has(`evt:${e.id}`) && f(e)).sort((x, y) => y.sig - x.sig || x.id - y.id);
  const losses = (e: SimEvent) => Number(e.data.lossesA ?? 0) + Number(e.data.lossesD ?? 0);
  // spread wars across the eras
  const wars = bySig('war').filter((e) => e.data.outcome !== 'dissolved');
  const warsByEra = new Map<number, SimEvent[]>();
  for (const e of wars) {
    const k = Math.min(6, Math.floor(e.year / 750));
    if (!warsByEra.has(k)) warsByEra.set(k, []);
    warsByEra.get(k)!.push(e);
  }
  for (const [, evs] of [...warsByEra].sort((x, y) => x[0] - y[0])) take('war', evs.sort((x, y) => losses(y) - losses(x)), 7);
  take('treaty', bySig('treaty', (e) => e.data.kind === 'peace'), 18);
  take('collapse', bySig('collapse'), 18);
  take('movement-founding', bySig('movement-founding'), 18);
  take('schism', bySig('schism'), 8);
  take('plague', bySig('plague'), 8);
  take('eruption', bySig('eruption', (e) => Number(e.data.vei) >= 7), 4);
  take('famine', bySig('famine'), 6);
  take('trade-collapse', bySig('trade-collapse'), 3);
  take('revolution', bySig('revolution'), 12);
  take('first-contact', bySig('first-contact'), 3);
  take('colonization', bySig('colonization'), 6);
  take('invention', bySig('invention', (e) => !e.data.independent), 12);
  take('panic', bySig('panic'), 5);
  take('script-invention', bySig('script-invention'), 3);
  // great rulers: longest and most eventful reigns
  const reigns: { pid: number; person: number; start: number; end: number; score: number }[] = [];
  for (const [pid, rs] of ctx.reigns) for (const r of rs) if (r.role === 'ruler' && r.end - r.start >= 15) reigns.push({ pid, person: r.person, start: r.start, end: r.end, score: (r.end - r.start) * (1 + (ctx.statsAt(pid, r.end)?.[2] as number ?? 0) / 50) });
  reigns.sort((x, y) => y.score - x.score);
  for (const r of reigns.slice(0, 24)) chosen.push({ kind: 'reign', e: null, p: s.polities[r.pid], person: s.persons[r.person] });
  for (let i = 0; i < 4; i++) chosen.push({ kind: 'modern', e: null });

  const out: Dossier[] = [];
  const seen = new Set<string>();
  for (const c of chosen) {
    if (out.length >= limit) break;
    const key = c.e ? `e${c.e.id}` : c.person ? `r${c.person.id}` : `m${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = dossier(a, c, out.length, rng.fork(key), isSim);
    if (d) out.push(d);
  }
  return out;
}

function dossier(a: Archive, c: { kind: string; e: SimEvent | null; p?: Polity; person?: Person }, n: number, rng: Rng, isSim: (ref: string) => boolean): Dossier | null {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const id = `fl-${String(n + 1).padStart(3, '0')}`;
  const form = rng.pick(FORMS[c.kind] ?? ['chronicle']);
  // --- author and date
  let author: Person | null = null;
  let polity: Polity | null = null;
  let year = 0;
  const e = c.e;
  const alive = (p: Person, y: number) => p.born + 16 <= y && p.died >= y;
  if (c.kind === 'modern') {
    const ed = s.polities[ctx.editorialPolity];
    polity = ed;
    year = 4990 - n % 7;
    const heads = (ctx.reigns.get(ed.id) ?? []).map((r) => s.persons[r.person]).filter((p) => alive(p, year));
    author = heads[0] ?? null;
  } else if (c.kind === 'reign') {
    polity = c.p!;
    author = c.person!;
    const r = (ctx.reigns.get(polity.id) ?? []).find((x) => x.person === author!.id)!;
    year = form.startsWith('satirical') || form.startsWith('panegyric') ? r.start + Math.floor((r.end - r.start) * 0.6) : Math.min(r.end, author.died) - 1;
    if (form.startsWith('panegyric') || form.startsWith('satirical')) author = null; // court poet / anonymous
  } else if (e) {
    const parts = e.parts.map(([r, role]) => ({ r, role }));
    const pol = parts.find((x) => x.r.startsWith('pol:') && ['attacker', 'victor', 'polity', 'collapsed', 'stricken', 'issuer', 'party', 'colonizer'].includes(x.role)) ?? parts.find((x) => x.r.startsWith('pol:'));
    polity = pol ? s.polities[ctx.idNum(pol.r)] : (e.cell >= 0 && ctx.ownerAt(e.cell, e.year) >= 0 ? s.polities[ctx.ownerAt(e.cell, e.year)] : null);
    const lag = form.includes('memoir') || form.includes('chronicle') || form.includes('lament') ? rng.int(2, 25) : form.includes('epic') ? rng.int(10, 60) : rng.int(0, 2);
    year = Math.min(4999, Math.max(e.year, e.end) + (form.includes('diary') || form.includes('log') || form.includes('letter') || form.includes('dispatch') ? 0 : lag));
    if (form.includes('diary') || form.includes('log') || form.includes('dispatch') || form.includes('letter')) {
      year = e.year;
      if (e.sub === 'war') {
        // a letter from the front is written just after the war's greatest battle
        const battles = (ctx.eventsByRef.get(`evt:${e.id}`) ?? []).map((i) => s.events[i]).filter((b) => b.sub === 'battle');
        const big = battles.sort((x, y) => (Number(y.data.attackerSize) + Number(y.data.defenderSize)) - (Number(x.data.attackerSize) + Number(x.data.defenderSize)))[0];
        if (big) year = big.year;
      }
    }
    // participants first
    const people = parts.filter((x) => x.r.startsWith('per:') && isSim(x.r)).map((x) => s.persons[ctx.idNum(x.r)]).filter((p) => alive(p, year));
    if (people.length && !form.includes('epic') && !form.includes('lament') && !form.includes('prayer') && !form.includes('hymn')) author = people[0];
    if (!author && polity) {
      const r = ctx.rulerAt(polity.id, year);
      if (r && (form.includes('decree') || form.includes('speech') || form.includes('letter'))) {
        const p = s.persons[r.person];
        if (alive(p, year)) author = p;
      }
    }
  }
  if (polity && (polity.born > year)) return null;
  const lang = polity ? ctx.polityLang(polity, Math.min(year, (polity.died ?? 5000) - 1)) : ctx.editorialLang;
  if (s.lang.info(lang).born > year) return null;
  const d = a.gen.doc(lang, year, `dossier:${id}`);
  const er = era(a, polity, year);
  const allowed = new Map<string, { text: string; what: string }>();
  const allow = (ref: string, what: string) => {
    if (!T.pageRefs.has(ref) || !isSim(ref) || allowed.has(ref)) return;
    const st = startOf(a, ref);
    if (st !== null && st > year) return;
    allowed.set(ref, { text: d.nameOf(ref), what });
  };
  // --- subject
  let subject: Dossier['subject'];
  const facts: string[] = [];
  const context: string[] = [];
  if (e) {
    allow(`evt:${e.id}`, 'the subject event');
    for (const [r, role] of e.parts) {
      if (r.startsWith('evt:')) allow(r, role);
      else allow(r, role);
    }
    for (const cid of e.causes) allow(`evt:${cid}`, 'a cause');
    for (const k of (ctx.childrenEvents.get(e.id) ?? []).slice(0, 8)) if (s.events[k].year <= year) allow(`evt:${k}`, 'a consequence');
    const pg = a.pages.get(`evt:${e.id}`);
    const unfolding = year < e.end;
    // the author knows only what had happened by the document's date
    const later = /^(Outcome|Ended by|Losses|Date)\b/;
    subject = { id: `evt:${e.id}`, title: T.title.get(`evt:${e.id}`) ?? '', summary: unfolding ? `${T.title.get(`evt:${e.id}`)}: began AY ${e.year} and is still unfolding at the document's date.` : stripLinks(pg?.summary ?? ''), facts };
    facts.push(unfolding ? `Began AY ${e.year}; still unfolding at the document's date (AY ${year}). Its outcome is NOT known to the author.` : `Date: AY ${e.year}${e.end > e.year ? `–${e.end}` : ''}`);
    for (const [k, v] of pg?.infobox ?? []) if (!(unfolding && later.test(k)) && !/^Date\b/.test(k)) facts.push(`${k}: ${stripLinks(v)}`);
    if (e.sub === 'war') {
      const battles = (ctx.eventsByRef.get(`evt:${e.id}`) ?? []).map((i) => s.events[i]).filter((b) => (b.sub === 'battle' || b.sub === 'siege' || b.sub === 'sack') && b.year <= year).sort((x, y) => x.year - y.year).slice(0, 10);
      for (const b of battles) {
        allow(`evt:${b.id}`, 'an engagement of the war');
        for (const [r] of b.parts) allow(r, 'participant in a battle');
        const t = T.title.get(`evt:${b.id}`) ?? '';
        facts.push(`${t}${t.includes(`AY ${b.year}`) ? '' : ` (AY ${b.year})`}: ${b.data.attackerSize ? `attackers ${b.data.attackerSize}, defenders ${b.data.defenderSize}; losses ${b.data.attackerLosses} / ${b.data.defenderLosses}; won by ${T.short.get(`pol:${b.data.winner}`)}` : b.sub}`);
      }
    }
    if (e.sub === 'invention') facts.push(`Technology: ${TECHS[e.data.tech as number].name}`);
  } else if (c.kind === 'reign') {
    const p = c.person!;
    allow(`per:${p.id}`, 'the ruler');
    allow(`pol:${polity!.id}`, 'the realm');
    const pg = a.pages.get(`per:${p.id}`);
    subject = { id: `per:${p.id}`, title: T.title.get(`per:${p.id}`) ?? '', summary: stripLinks(pg?.summary ?? ''), facts };
    for (const [k, v] of pg?.infobox ?? []) facts.push(`${k}: ${stripLinks(v)}`);
    const evs = (ctx.eventsByRef.get(`pol:${polity!.id}`) ?? []).map((i) => s.events[i]).filter((x) => x.year <= year && x.year >= (ctx.reigns.get(polity!.id) ?? []).find((r) => r.person === p.id)!.start && x.sig >= 0.2 && T.pageRefs.has(`evt:${x.id}`)).slice(-14);
    for (const x of evs) { allow(`evt:${x.id}`, 'an event of the reign'); facts.push(`${T.title.get(`evt:${x.id}`)} (AY ${x.year})`); }
    if (p.father !== null) allow(`per:${p.father}`, 'father');
    for (const sp of p.spouses) allow(`per:${sp}`, 'spouse');
    for (const k of p.children) allow(`per:${k}`, 'child');
  } else {
    // modern editorial essay about the archive as a whole
    subject = { id: 'archive', title: 'The archive itself', summary: 'An essay by the modern editors on the sources, their biases and the history they reveal.', facts };
    const big = s.events.filter((x) => (x.sub === 'collapse' || x.sub === 'trade-collapse' || x.sub === 'first-contact' || x.sub === 'plague') && T.pageRefs.has(`evt:${x.id}`)).sort((x, y) => y.sig - x.sig).slice(0, 14);
    for (const x of big) { allow(`evt:${x.id}`, 'a turning point'); facts.push(`${T.title.get(`evt:${x.id}`)} (AY ${x.year}): ${stripLinks(a.pages.get(`evt:${x.id}`)?.summary ?? '')}`); }
    const rival = [...a.pages.values()].filter((p) => p.accounts && p.accounts.sources.length >= 2).slice(0, 3);
    for (const r of rival) { allow(r.id, 'a war known from rival accounts'); facts.push(`Rival accounts exist for ${r.title}: ${r.accounts!.truth.map(([f, v]) => `${f}=${v}`).join('; ')} vs claims ${r.accounts!.sources.map((src) => src.claims.map(([f, v]) => `${f}=${v}`).join(', ')).join(' | ')}`); }
  }
  // --- context at the date
  if (polity && polity.born <= year) {
    allow(`pol:${polity.id}`, 'the author’s state');
    const r = ctx.rulerAt(polity.id, year);
    if (r) { allow(`per:${r.person}`, 'ruler at the date'); context.push(`Ruler at the date: ${d.nameOf(`per:${r.person}`)} (since AY ${r.start})`); }
    const capId = ctx.capitalAt(polity, Math.min(year, (polity.died ?? 5000) - 1));
    allow(`set:${capId}`, 'capital');
    context.push(`State: ${T.title.get(`pol:${polity.id}`)} — government ${ctx.govAt(polity, year)}; capital ${d.nameOf(`set:${capId}`)}`);
    const rel = ctx.religionOf(polity.id, year);
    if (rel >= 0 && s.movements[rel].born <= year) {
      const m = s.movements[rel];
      allow(`mov:${m.id}`, 'state religion');
      for (const dei of m.deities.slice(0, 6)) allow(`dei:${dei}`, `a god (${s.deities[dei].domain})`);
      context.push(`State religion: ${d.nameOf(`mov:${m.id}`)} (${m.kind}). ${tenetText(m.kind, m.tenets)}${m.deities.length ? ` Gods: ${m.deities.slice(0, 6).map((x) => `${d.nameOf(`dei:${x}`)} (${s.deities[x].domain})`).join(', ')}.` : ''}`);
    }
    const cur = ctx.currencyAt(polity.id, year);
    if (cur >= 0 && s.currencies[cur].born <= year) {
      allow(`cur:${cur}`, 'currency');
      const grain = a.gen.price(capId, GOODS.findIndex((g) => g.key === 'grain'), year);
      context.push(`Currency: ${d.nameOf(`cur:${cur}`)} (${ctx.contentAt(cur, year).toFixed(2)} g silver)${grain !== null ? `; grain costs about ${(grain / ctx.contentAt(cur, year)).toFixed(2)} per measure` : ''}`);
    }
    const near = (ctx.eventsByRef.get(`pol:${polity.id}`) ?? []).map((i) => s.events[i]).filter((x) => x.year <= year && x.year > year - 25 && x.sig >= 0.25 && T.pageRefs.has(`evt:${x.id}`)).slice(-6);
    for (const x of near) { if (allowed.has(`evt:${x.id}`) && x.id !== e?.id) continue; allow(`evt:${x.id}`, 'recent event'); const t = T.title.get(`evt:${x.id}`) ?? ''; context.push(`Recent: ${t}${t.includes(`AY ${x.year}`) ? '' : ` (AY ${x.year})`}`); }
    context.push(`Technology level: ${['Bronze Age', 'Iron Age', 'Classical', 'Medieval', 'Early Modern', 'Industrial', 'Post-industrial'][er]}`);
  }
  const scriptId = polity ? ctx.scriptOf(polity, Math.min(year, (polity.died ?? 5000) - 1)) : -1;
  const medium = er <= 1 ? 'clay tablet' : er <= 3 ? 'parchment' : er === 4 ? 'paper' : 'print';
  const frontmatter = [
    `id: ${id}`,
    `subject: ${e ? `evt:${e.id}` : c.kind === 'reign' ? `per:${c.person!.id}` : 'archive'}`,
    `form: ${form}`,
    `year: ${year}`,
    `author: ${author ? `per:${author.id}` : 'null'}`,
    `polity: ${polity ? `pol:${polity.id}` : 'null'}`,
    `lang: ${lang}`,
    `script: ${scriptId}`,
    `medium: ${medium}`,
  ].join('\n');
  return {
    frontmatter,
    id, form, register: REGISTER[er], year,
    localDate: stripLinks(localDate(ctx, d, polity, year)),
    language: T.short.get(`lan:${lang}`) ?? '',
    script: scriptId >= 0 ? T.short.get(`scr:${scriptId}`) ?? '' : er >= 4 ? 'print' : 'unwritten (oral, set down later)',
    medium,
    author: author ? {
      id: `per:${author.id}`, name: d.nameOf(`per:${author.id}`), role: author.roles.map((r) => r.role).join(', ') || 'person', polity: author.polity !== null ? T.short.get(`pol:${author.polity}`) ?? null : null,
      born: author.born, died: author.died, stance: stanceOf(a, author, e),
    } : { id: null, name: 'anonymous', role: form.includes('poem') || form.includes('panegyric') || form.includes('verses') || form.includes('hymn') || form.includes('lament') ? 'poet' : 'unknown', polity: polity ? T.short.get(`pol:${polity.id}`) ?? null : null, born: null, died: null, stance: 'loyal to their own people and gods' },
    subject: subject!,
    context,
    allowedLinks: [...allowed].map(([ref, v]) => ({ id: ref, text: v.text, what: v.what })),
    guidance: GUIDANCE,
  };
}

function stanceOf(a: Archive, p: Person, e: SimEvent | null): string {
  if (!e) return 'a ruler writing for posterity: self-glorifying, pious, selective';
  const pol = p.polity;
  const role = pol !== null ? e.parts.find(([r]) => r === `pol:${pol}`)?.[1] : undefined;
  if (role === 'victor' || role === 'attacker') return 'on the winning or attacking side: proud, blames the enemy, inflates their losses';
  if (role === 'vanquished' || role === 'defender' || role === 'collapsed' || role === 'stricken') return 'on the losing or suffering side: grieving, defensive, blames treachery or the gods';
  return 'a witness with their own loyalties; not neutral';
  void a;
}

function startOf(a: Archive, ref: string): number | null {
  const s = a.ctx.s;
  const id = a.ctx.idNum(ref);
  switch (ref.slice(0, 3)) {
    case 'pol': return s.polities[id].born;
    case 'per': return s.persons[id].born;
    case 'set': return s.settlements[id].founded;
    case 'mov': return s.movements[id].born;
    case 'dei': return s.deities[id].born;
    case 'cur': return s.currencies[id].born;
    case 'hou': return s.houses[id].born;
    case 'scr': return s.scripts[id].born;
    case 'lan': return s.lang.info(id).born;
    case 'cul': return s.cultures[id].born;
    case 'evt': return s.events[id].year;
    default: return null;
  }
}

function stripLinks(x: string): string {
  return x.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1');
}

const GUIDANCE = `Write ONE primary source in English translation, as it would appear in a modern scholarly edition.

Rules (the archive is machine-checked; breaking them gets the document rejected):
- Stay consistent with every fact in the dossier: names, dates, numbers, who won, who died. You may add texture (weather, smells, feelings, unnamed people, speech, ritual, rumours), and an author may be biased, boastful, mistaken or silent, as real authors are, but do not invent new named people, places, states, gods, events or precise statistics that contradict the record.
- Link people, places, states, gods, faiths, coins and events ONLY from allowedLinks, using exactly [[id|text]] where id is from the list. Use the given period form as the text (or a natural inflection of it). Never link anything else. Link each entity at most twice.
- The author knows only what happened up to the document's date. Nothing later may be mentioned or foreshadowed.
- Match the register of the era (see register) and the form. Bronze Age texts are formulaic; industrial texts read like newspapers or speeches; poems are in lines.
- Length: 350–750 words. Use Markdown: paragraphs, short headings only if the form has them (e.g. a log), > quotes for inscriptions or quoted speech when apt, line breaks for verse.
- No editorial commentary in the body. Do not mention "simulation", "AY", "dossier" or the modern editors (except in the modern editorial essays, which are written by those editors and may use AY dates).`;
