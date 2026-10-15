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
  sack: ['eyewitness account of the sack', 'lament for the fallen city', 'letter of a survivor of the sack'],
  siege: ['diary of the siege', 'letter smuggled out of the besieged city'],
  debasement: ['merchant’s complaint about the new coin', 'satire on the light coin', 'memorandum of the mint master'],
  conversion: ['sermon at the conversion of the court', 'letter of a priest of the old gods', 'hymn of the new faith'],
  persecution: ['letter of a martyr', 'account of the persecution by a survivor', 'secret prayer of the persecuted'],
  migration: ['song of the wanderers', 'complaint of the settled people against the newcomers', 'oral history set down by a grandson'],
  succession: ['lament for the dead king', 'coronation hymn', 'letter of the queen mother'],
  usurpation: ['proclamation of the usurper', 'curse on the usurper', 'apology of the usurper'],
  marriage: ['wedding song', 'letter of the bride to her mother', 'envoy’s description of the wedding'],
  council: ['letter from a delegate to the council', 'minutes kept by a secretary of the council'],
  bankruptcy: ['ledger note and lament of a failed merchant', 'letter of a creditor'],
  'colonial-war': ['letter of a colonial soldier', 'complaint of the colonized', 'report of the colonial governor'],
  independence: ['declaration of independence', 'memoir of a rebel', 'speech of the rebel leader'],
  reform: ['edict of reform', 'speech in favour of the reform', 'protest against the reform'],
  'house-founding': ['charter of partnership', 'letter of the founder to his son'],
  default: ['chronicle entry', 'letter', 'memoir'],
};

function era(a: Archive, p: Polity | null, year: number): number {
  if (p) return a.ctx.eraAt(p.id, Math.min(year, (p.died ?? 5000) - 1));
  // stateless land: the commonest era among the states of that decade
  const y = Math.floor(year / 10) * 10;
  const counts = new Map<number, number>();
  for (const rows of a.ctx.polityStats.values()) for (const row of rows) if (row[1] === y) counts.set(row[13] as number, (counts.get(row[13] as number) ?? 0) + 1);
  return [...counts].sort((x, z) => z[1] - x[1] || x[0] - z[0])[0]?.[0] ?? 6;
}

const techCache = new WeakMap<Archive, Map<number, number>>();
function techFirst(a: Archive): Map<number, number> {
  let m = techCache.get(a);
  if (!m) {
    m = new Map();
    for (const p of a.ctx.s.polities) for (const [t, y] of p.techs) if (y < (m.get(t) ?? Infinity)) m.set(t, y);
    techCache.set(a, m);
  }
  return m;
}

const PERSONA_FORMS = ['queen mother', 'bride', 'martyr', 'hostage', 'refugee', 'survivor', 'envoy', 'delegate', 'courtier', 'physician', 'settler', 'natives', 'colonized', 'colonial soldier', 'merchant', 'creditor', 'old gods', 'convert', 'priest’s account', 'ruined trader', 'smuggled', 'secretary', 'starving'];

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
  const form = rng.pick(FORMS[c.kind] ?? FORMS.default);
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
    const pol = parts.find((x) => x.r.startsWith('pol:') && ['attacker', 'victor', 'polity', 'collapsed', 'stricken', 'issuer', 'party', 'colonizer', 'besieged', 'persecutor', 'house', 'host', 'against', 'annexed'].includes(x.role)) ?? parts.find((x) => x.r.startsWith('pol:'));
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
  // forms that name their own speaker (a bride, a martyr, a hostage, a refugee…) get an anonymous
  // author of that kind rather than an ill-fitting ruler or general
  if (PERSONA_FORMS.some((k) => form.includes(k))) author = null;
  // written after the state fell: the author lives under whoever holds the place now
  if (polity && polity.died !== null && polity.died < year && e && e.cell >= 0 && ctx.ownerAt(e.cell, year) >= 0) polity = s.polities[ctx.ownerAt(e.cell, year)];
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
    const who = ref.startsWith('per:') ? ` (${s.persons[ctx.idNum(ref)].sex === 'f' ? 'woman; she/her' : 'man; he/him'})` : ref.startsWith('dei:') ? ` (${s.deities[ctx.idNum(ref)].sex === 'f' ? 'goddess; she/her' : 'god; he/him'})` : '';
    // primary sources never write AY: drop the editors' date suffix from titles such as climate anomalies
    allowed.set(ref, { text: d.nameOf(ref).replace(/,? \(?AY [\d–-]+\)?$/, ''), what: what + who });
  };
  // --- subject
  let subject: Dossier['subject'];
  const facts: string[] = [];
  const context: string[] = [];
  {
    // what the author's world could and could not know: technologies by first adoption anywhere
    const first = techFirst(a);
    const known = TECHS.filter((t) => (first.get(t.id) ?? Infinity) <= year).sort((x, z) => first.get(z.id)! - first.get(x.id)!).slice(0, 6).map((t) => t.name.toLowerCase());
    const unknown = TECHS.filter((t) => (first.get(t.id) ?? Infinity) > year).sort((x, z) => (first.get(x.id) ?? 9e9) - (first.get(z.id) ?? 9e9)).slice(0, 5).map((t) => t.name.toLowerCase());
    context.push(`Technology: the newest known anywhere are ${known.join(', ') || 'none'}.${unknown.length ? ` NOT yet invented (never mention them or their products): ${unknown.join(', ')}.` : ''}`);
  }
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
    const cur = ctx.currencyAtExact(polity.id, year);
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
      id: `per:${author.id}`, name: d.nameOf(`per:${author.id}`), role: `${author.sex === 'f' ? 'woman' : 'man'}; ${author.roles.map((r) => r.role).join(', ') || 'person'}`, polity: author.polity !== null ? T.short.get(`pol:${author.polity}`) ?? null : null,
      born: author.born, died: author.died, stance: stanceOf(a, author, e),
    } : { id: null, name: 'anonymous', role: PERSONA_FORMS.some((k) => form.includes(k)) ? `the speaker the form implies (${form})` : form.includes('poem') || form.includes('panegyric') || form.includes('verses') || form.includes('hymn') || form.includes('lament') ? 'poet' : 'unknown', polity: polity ? T.short.get(`pol:${polity.id}`) ?? null : null, born: null, died: null, stance: 'loyal to their own people and gods' },
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

export function startOf(a: Archive, ref: string): number | null {
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

export function stripLinks(x: string): string {
  return x.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1');
}

export const GUIDANCE = `Write ONE primary source in English translation, as it would appear in a modern scholarly edition.

Rules (the archive is machine-checked; breaking them gets the document rejected):
- Stay consistent with every fact in the dossier: names, dates, numbers, who won, who died. You may add texture (weather, smells, feelings, unnamed people, speech, ritual, rumours), and an author may be biased, boastful, mistaken or silent, as real authors are, but do not invent new named people, places, states, gods, events or precise statistics that contradict the record.
- Link people, places, states, gods, faiths, coins and events ONLY from allowedLinks, using exactly [[id|text]] where id is from the list. Use the given period form as the text (or a natural inflection of it). Never link anything else. Link each entity at most twice.
- The author knows only what happened up to the document's date. Nothing later may be mentioned or foreshadowed.
- Match the register of the era (see register) and the form. Bronze Age texts are formulaic; industrial texts read like newspapers or speeches; poems are in lines.
- Length: 350–750 words. Use Markdown: paragraphs, short headings only if the form has them (e.g. a log), > quotes for inscriptions or quoted speech when apt, line breaks for verse.
- No editorial commentary in the body. Do not mention "simulation", "AY", "dossier" or the modern editors (except in the modern editorial essays, which are written by those editors and may use AY dates).`;

/** Modern historiography: essays by the archive's own scholars (fl-201 onward). */
export function buildHistoriography(a: Archive): Dossier[] {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const g = a.gen;
  const ed = s.polities[ctx.editorialPolity];
  const lang = ctx.editorialLang;
  const rng = new Rng(s.seed).fork('historiography');
  const out: Dossier[] = [];
  const simPersons = a.ctx.r.simPersons ?? s.persons.length;
  const isOk = (ref: string) => !ref.startsWith('per:') || ctx.idNum(ref) < simPersons;
  const scholarAt = (k: number) => {
    const pool = g.scholars.filter((id) => s.persons[id].born + 28 <= 4990 && s.persons[id].died >= 4950);
    const id = pool[k % pool.length];
    const p = s.persons[id];
    const year = Math.min(4999, Math.max(4950, p.born + 30 + (k % 9)), p.died);
    return { id, year };
  };
  const make = (k: number, form: string, subjectId: string, title: string, facts: string[], links: string[], context: string[]): void => {
    const { id: who, year } = scholarAt(k);
    const d = g.doc(lang, year, `hist:${k}`);
    const allowed: Dossier['allowedLinks'] = [];
    const seen = new Set<string>();
    for (const ref of links) {
      if (seen.has(ref) || !T.pageRefs.has(ref) || !isOk(ref)) continue;
      const st = startOf(a, ref);
      if (st !== null && st > year) continue;
      seen.add(ref);
      allowed.push({ id: ref, text: T.short.get(ref) ?? d.nameOf(ref), what: T.title.get(ref) ?? '' });
      if (allowed.length >= 45) break;
    }
    const id = `fl-${String(201 + out.length).padStart(3, '0')}`;
    const p = s.persons[who];
    out.push({
      id, form, register: 'Modern scholarship: clear, precise, argumentative; footnote-like asides in parentheses; may cite AY dates and catalogue numbers in prose.',
      year, localDate: `AY ${year}`, language: T.short.get(`lan:${lang}`) ?? '', script: 'print', medium: 'journal article',
      author: { id: `per:${who}`, name: T.short.get(`per:${who}`) ?? '', role: p.roles.map((r) => r.role).join(', '), polity: T.short.get(`pol:${ed.id}`) ?? null, born: p.born, died: p.died, stance: 'a modern scholar: sceptical of royal propaganda, careful with numbers, writing for colleagues' },
      subject: { id: subjectId, title, summary: title, facts }, context, allowedLinks: allowed,
      guidance: GUIDANCE.replace('Do not mention "simulation", "AY", "dossier" or the modern editors (except in the modern editorial essays, which are written by those editors and may use AY dates).', 'This is modern scholarship: you MAY use AY dates. Never mention "simulation", "dossier" or "ground truth" — call the reconstructed record "the documentary consensus" or "the record". Refer to surviving sources by their titles in plain text (do not link documents).'),
      frontmatter: [`id: ${id}`, `subject: ${subjectId}`, `form: ${form}`, `year: ${year}`, `author: per:${who}`, `polity: pol:${ed.id}`, `lang: ${lang}`, `script: ${ctx.scriptOf(ed, year)}`, `medium: journal article`].join('\n'),
    });
  };
  let k = 0;
  // 1. rival accounts revisited
  const rivals = [...a.pages.values()].filter((p) => p.accounts && p.accounts.sources.length >= 2).sort((x, y) => s.events[Number(y.id.slice(4))].sig - s.events[Number(x.id.slice(4))].sig).slice(0, 22);
  for (const pg of rivals) {
    const e = s.events[Number(pg.id.slice(4))];
    const facts = [stripLinks(pg.summary), ...pg.accounts!.truth.map(([f, v]) => `Record — ${f}: ${v}`), ...pg.accounts!.sources.map((src) => `${src.side} chronicle by ${src.author}: ${src.claims.map(([f, v]) => `${f}: ${v}`).join('; ')}`)];
    const links = [pg.id, ...e.parts.map(([r]) => r), ...(ctx.eventsByRef.get(pg.id) ?? []).slice(0, 12).map((i) => `evt:${i}`), ...e.causes.map((c) => `evt:${c}`)];
    make(k++, 'journal article re-examining rival chronicles', pg.id, `Revisiting the ${T.short.get(pg.id)}: two chronicles against the record`, facts, links, []);
  }
  // 2. era overviews
  const eras = computeErasLite(a);
  for (const er of eras) {
    const evs = s.events.filter((e) => e.year >= er.start && e.year < er.end && T.pageRefs.has(`evt:${e.id}`)).sort((x, y) => y.sig - x.sig).slice(0, 18);
    const facts = [`${er.name}: AY ${er.start}–${er.end}`, ...evs.map((e) => `${T.title.get(`evt:${e.id}`)} (AY ${e.year})`)];
    make(k++, 'survey lecture on an age', `era:${er.id}`, `${er.name}: a survey`, facts, evs.flatMap((e) => [`evt:${e.id}`, ...e.parts.slice(0, 3).map(([r]) => r)]), []);
  }
  // 3. language families
  for (const root of s.lang.languages().filter((l) => l.parent === null)) {
    const daughters = s.lang.languages().filter((l) => l.family === root.family && l.parent !== null).slice(0, 12);
    const facts = [`Family root: ${T.title.get(`lan:${root.id}`)}`, ...daughters.map((l) => `${T.short.get(`lan:${l.id}`)} (AY ${l.born}–${l.died ?? 'present'})`), ...['water', 'king', 'god', 'mother', 'silver'].map((c) => `*${c}*: proto ${s.lang.protoForm(root.id, c)}; ${daughters.slice(0, 5).map((l) => `${T.short.get(`lan:${l.id}`)} ${s.lang.word(l.id, c, Math.min(l.died ?? 5000, 5000)).conventional}`).join(', ')}`), ...s.lang.soundChanges(daughters[0]?.id ?? root.id).slice(0, 8).map((c) => `Sound law c. AY ${c.year}: ${c.label} (${c.rule})`)];
    make(k++, 'philological essay', `lan:${root.id}`, `The ${T.short.get(`lan:${root.id}`)} languages and their ancestor`, facts, [`lan:${root.id}`, ...daughters.map((l) => `lan:${l.id}`)], []);
  }
  // 4. great collapses
  const collapses = s.events.filter((e) => e.sub === 'collapse' && T.pageRefs.has(`evt:${e.id}`)).sort((x, y) => y.sig - x.sig).slice(0, 6);
  for (const e of collapses) {
    const facts = [stripLinks(a.pages.get(`evt:${e.id}`)?.summary ?? ''), ...e.causes.map((c) => `Cause: ${T.title.get(`evt:${c}`)} (AY ${s.events[c].year})`), ...e.parts.filter(([, r]) => r === 'successor').map(([r]) => `Successor: ${T.title.get(r)}`)];
    make(k++, 'journal article on a state collapse', `evt:${e.id}`, `Why did the ${T.short.get(e.parts[0][0])} fall?`, facts, [`evt:${e.id}`, ...e.parts.map(([r]) => r), ...e.causes.map((c) => `evt:${c}`)], []);
  }
  // 5. founders of faiths
  const founders = s.movements.filter((m) => m.founder !== null && (m.kind === 'religion' || m.kind === 'philosophy') && T.pageRefs.has(`per:${m.founder}`)).sort((x, y) => y.peak - x.peak).slice(0, 8);
  for (const m of founders) {
    const facts = [stripLinks(a.pages.get(`mov:${m.id}`)?.summary ?? ''), `Teachings: ${tenetText(m.kind, m.tenets)}`, `Founder: ${T.title.get(`per:${m.founder}`)} (AY ${s.persons[m.founder!].born}–${s.persons[m.founder!].died})`];
    make(k++, 'biographical essay', `per:${m.founder}`, `The historical ${T.short.get(`per:${m.founder}`)}`, facts, [`per:${m.founder}`, `mov:${m.id}`, ...(m.foundEvent !== null ? [`evt:${m.foundEvent}`] : []), ...s.movements.filter((x) => x.parent === m.id).map((x) => `mov:${x.id}`)], []);
  }
  void rng;
  return out;
}

function computeErasLite(a: Archive): { id: string; name: string; start: number; end: number }[] {
  const s = a.ctx.s;
  const first = (key: string) => { let b = 5000; for (const p of s.polities) { const y = p.techs.get(TECHS.findIndex((t) => t.key === key)); if (y !== undefined && y < b) b = y; } return b; };
  const m: [string, string, number][] = [['bronze', 'The Age of Bronze', 0], ['iron', 'The Age of Iron', first('iron')], ['coin', 'The Age of Coin and Creed', first('coinage')], ['parchment', 'The Age of Parchment and Plough', first('paper')], ['print', 'The Age of Sail and Print', first('printing')], ['engines', 'The Age of Engines', first('steam')], ['networks', 'The Age of Networks', first('computing')]];
  m.sort((x, y) => x[2] - y[2]);
  return m.map(([id, name, start], i) => ({ id, name, start, end: i + 1 < m.length ? m[i + 1][2] : 5000 })).filter((e) => e.end > e.start);
}

/** Second wave: subjects not covered by the first, numbered from fl-301. */
export function buildWave2(a: Archive, exclude: Set<string>): Dossier[] {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const rng = new Rng(s.seed).fork('dossiers-wave2');
  const simPersons = a.ctx.r.simPersons ?? s.persons.length;
  const isSim = (ref: string) => !ref.startsWith('per:') || ctx.idNum(ref) < simPersons;
  const simEvents = a.ctx.r.simEvents ?? s.events.length;
  const pick = (sub: string, n: number, f: (e: SimEvent) => boolean = () => true) => s.events
    .filter((e) => e.id < simEvents && e.sub === sub && T.pageRefs.has(`evt:${e.id}`) && !exclude.has(`evt:${e.id}`) && f(e))
    .sort((x, y) => y.sig - x.sig || x.id - y.id).slice(0, n);
  const plan: [string, string, number, ((e: SimEvent) => boolean)?][] = [
    ['war', 'war', 36, (e) => e.data.outcome !== 'dissolved'],
    ['sack', 'sack', 18], ['siege', 'siege', 6], ['debasement', 'debasement', 8], ['conversion', 'conversion', 14],
    ['persecution', 'persecution', 10], ['migration', 'migration', 8], ['famine', 'famine', 8], ['succession', 'succession', 14, (e) => e.sig >= 0.1],
    ['usurpation', 'usurpation', 12], ['marriage', 'marriage', 10], ['council', 'council', 8], ['bankruptcy', 'bankruptcy', 6],
    ['war', 'colonial-war', 10, (e) => e.data.goal === 'colonial'], ['war', 'independence', 10, (e) => e.data.goal === 'independence' && e.data.outcome === 'attacker'],
    ['revolution', 'revolution', 10], ['reform', 'reform', 6], ['invention', 'invention', 10, (e) => !e.data.independent],
    ['collapse', 'collapse', 12], ['plague', 'plague', 6], ['movement-founding', 'movement-founding', 12], ['treaty', 'treaty', 12, (e) => e.data.kind === 'peace'],
    ['house-founding', 'house-founding', 6], ['schism', 'schism', 6],
  ];
  const chosen: { kind: string; e: SimEvent }[] = [];
  const taken = new Set<number>();
  for (const [sub, kind, n, f] of plan) for (const e of pick(sub, n * 2, f)) {
    if (taken.has(e.id) || chosen.filter((c) => c.kind === kind).length >= n) continue;
    taken.add(e.id);
    chosen.push({ kind, e });
  }
  const out: Dossier[] = [];
  for (const c of chosen) {
    const d = dossier(a, { kind: c.kind, e: c.e }, 300 + out.length, rng.fork(c.e.id), isSim);
    if (d) out.push(d);
  }
  return out;
}

/** Third wave: "Lives", long-form biographies of consequential people by modern scholars (fl-601+). */
export function buildLives(a: Archive, exclude: Set<string>): Dossier[] {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const g = a.gen;
  const ed = s.polities[ctx.editorialPolity];
  const lang = ctx.editorialLang;
  const simPersons = a.ctx.r.simPersons ?? s.persons.length;
  const simEvents = a.ctx.r.simEvents ?? s.events.length;
  const score = new Map<number, number>();
  for (let i = 0; i < simEvents; i++) {
    const e = s.events[i];
    for (const [r, role] of e.parts) {
      if (!r.startsWith('per:')) continue;
      const id = ctx.idNum(r);
      if (id >= simPersons) continue;
      let w = e.sig;
      if (e.sub === 'battle' && e.data.winner !== undefined && ((role === 'attacking commander' && e.parts.some(([x, rr]) => rr === 'attacker' && x === `pol:${e.data.winner}`)) || (role === 'defending commander' && e.parts.some(([x, rr]) => rr === 'defender' && x === `pol:${e.data.winner}`)))) w *= 2;
      if (e.sub === 'movement-founding' || e.sub === 'invention' || e.sub === 'revolution' || e.sub === 'usurpation') w *= 3;
      score.set(id, (score.get(id) ?? 0) + w);
    }
  }
  for (const [pid, rs] of ctx.reigns) for (const r of rs) score.set(r.person, (score.get(r.person) ?? 0) + (r.end - r.start) / 10 * (1 + ((ctx.statsAt(pid, r.end)?.[2] as number) ?? 0) / 100));
  const ranked = [...score].filter(([id]) => !exclude.has(`per:${id}`) && T.pageRefs.has(`per:${id}`)).sort((x, y) => y[1] - x[1]).slice(0, 40);
  const out: Dossier[] = [];
  ranked.forEach(([pid], k) => {
    const p = s.persons[pid];
    const pool = g.scholars.filter((id) => s.persons[id].born + 28 <= 4995 && s.persons[id].died >= 4955);
    const who = pool[(k * 7) % pool.length];
    const year = Math.min(4999, Math.max(4955, s.persons[who].born + 32 + (k % 11)), s.persons[who].died);
    const d = g.doc(lang, year, `life:${pid}`);
    const pg = a.pages.get(`per:${pid}`);
    const evs = (ctx.eventsByRef.get(`per:${pid}`) ?? []).filter((i) => i < simEvents).map((i) => s.events[i]).sort((x, y) => x.year - y.year).slice(0, 30);
    const facts = [stripLinks(pg?.summary ?? ''), `Sex: ${p.sex === 'f' ? 'woman (she/her)' : 'man (he/him)'}`, ...(pg?.infobox ?? []).map(([k2, v]) => `${k2}: ${stripLinks(v)}`), ...evs.map((e) => `${T.title.get(`evt:${e.id}`)} (AY ${e.year}): ${stripLinks(a.pages.get(`evt:${e.id}`)?.summary ?? '')}`)];
    const links = new Set<string>([`per:${pid}`]);
    for (const r of p.roles) if (r.polity !== null) links.add(`pol:${r.polity}`);
    if (p.father !== null) links.add(`per:${p.father}`);
    if (p.mother !== null) links.add(`per:${p.mother}`);
    for (const x of [...p.spouses, ...p.children]) links.add(`per:${x}`);
    for (const e of evs) { links.add(`evt:${e.id}`); for (const [r] of e.parts.slice(0, 6)) links.add(r); }
    const allowed: Dossier['allowedLinks'] = [];
    for (const ref of links) {
      if (!T.pageRefs.has(ref) || (ref.startsWith('per:') && ctx.idNum(ref) >= simPersons) || (ref.startsWith('evt:') && ctx.idNum(ref) >= simEvents)) continue;
      const st = startOf(a, ref);
      if (st !== null && st > year) continue;
      const sexNote = ref.startsWith('per:') ? ` (${s.persons[ctx.idNum(ref)].sex === 'f' ? 'woman; she/her' : 'man; he/him'})` : '';
      allowed.push({ id: ref, text: T.short.get(ref) ?? d.nameOf(ref), what: (T.title.get(ref) ?? '') + sexNote });
      if (allowed.length >= 60) break;
    }
    const id = `fl-${String(601 + out.length).padStart(3, '0')}`;
    out.push({
      id, form: 'biographical essay (Lives series)', register: 'Modern scholarship: a long-form life, narrative but critical; weighs legend against record; may cite AY dates.',
      year, localDate: `AY ${year}`, language: T.short.get(`lan:${lang}`) ?? '', script: 'print', medium: 'book chapter',
      author: { id: `per:${who}`, name: T.short.get(`per:${who}`) ?? '', role: `${s.persons[who].sex === 'f' ? 'woman' : 'man'}; ${s.persons[who].roles.map((r) => r.role).join(', ')}`, polity: T.short.get(`pol:${ed.id}`) ?? null, born: s.persons[who].born, died: s.persons[who].died, stance: 'a modern biographer: humane, sceptical of court propaganda, interested in how ordinary lives were shaped' },
      subject: { id: `per:${pid}`, title: `The life of ${T.short.get(`per:${pid}`)}`, summary: stripLinks(pg?.summary ?? ''), facts },
      context: [], allowedLinks: allowed,
      guidance: GUIDANCE.replace('Do not mention "simulation", "AY", "dossier" or the modern editors (except in the modern editorial essays, which are written by those editors and may use AY dates).', 'This is modern scholarship: you MAY use AY dates. Never mention "simulation", "dossier" or "ground truth" — call it "the record". Do not link documents; name sources by title in plain text.').replace('Length: 350–750 words.', 'Length: 900–1,400 words, with 3–5 short section headings.'),
      frontmatter: [`id: ${id}`, `subject: per:${pid}`, `form: biographical essay`, `year: ${year}`, `author: per:${who}`, `polity: pol:${ed.id}`, `lang: ${lang}`, `script: ${ctx.scriptOf(ed, year)}`, `medium: book chapter`].join('\n'),
    });
  });
  return out;
}

const VOICES: Record<string, string[]> = {
  famine: ['diary of a farmer’s wife in the hungry year', 'petition of villagers to the governor', 'song of the empty granary', 'prayer scratched on a potsherd'],
  plague: ['letter of an apprentice to his mother', 'lullaby sung in the plague year', 'list of the dead kept by a gravedigger, with his notes', 'vow made by a widow at a shrine'],
  sack: ['letter of a refugee to a cousin', 'song of the burned city sung by its survivors', 'testimony of a servant who hid in the cellar'],
  migration: ['song of the long road', 'complaint of farmers about the newcomers', 'memories of a newcomer girl told in old age'],
  debasement: ['market woman’s tally and her complaints', 'letter of a soldier about his wages in light coin', 'street song mocking the new coin'],
  conquest: ['letter home of a conscript in the conquering army', 'lament of a village under the new masters', 'prayer of a captive'],
  colonization: ['letter of a settler’s wife', 'song of the people of the coast about the ships', 'complaint of a fisherman about the colonists'],
  revolution: ['diary of a seamstress during the revolution', 'letter of a student to his father', 'song of the barricades'],
  eruption: ['diary of a shepherd in the ash years', 'prayer for the return of the sun'],
  drought: ['letter of a herdsman from the dry pastures', 'rain charm and its story', 'diary of a well-keeper'],
  war: ['letter home of a conscript', 'song of the mothers of soldiers', 'deserter’s confession'],
};

/** Fourth wave: "Voices from below", anonymous ordinary people living through great events (fl-701+). */
export function buildVoices(a: Archive, exclude: Set<string>): Dossier[] {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const rng = new Rng(s.seed).fork('voices');
  const simPersons = a.ctx.r.simPersons ?? s.persons.length;
  const simEvents = a.ctx.r.simEvents ?? s.events.length;
  const isSim = (ref: string) => !ref.startsWith('per:') || ctx.idNum(ref) < simPersons;
  const quotas: [string, number, ((e: SimEvent) => boolean)?][] = [
    ['famine', 22], ['plague', 18], ['sack', 22], ['migration', 10], ['debasement', 8], ['conquest', 18], ['colonization', 10],
    ['revolution', 12], ['eruption', 6], ['drought', 8], ['war', 18, (e) => e.data.outcome !== 'dissolved'],
  ];
  const out: Dossier[] = [];
  for (const [sub, n, f] of quotas) {
    const evs = s.events.filter((e) => e.id < simEvents && e.sub === sub && T.pageRefs.has(`evt:${e.id}`) && !exclude.has(`evt:${e.id}`) && e.cell >= 0 && (!f || f(e)))
      .sort((x, y) => y.sig - x.sig || x.id - y.id);
    // spread across the five millennia
    const picked: SimEvent[] = [];
    for (const e of evs) {
      if (picked.length >= n) break;
      if (picked.some((p) => Math.abs(p.year - e.year) < 5000 / (n * 1.6))) continue;
      picked.push(e);
    }
    for (const e of picked) {
      const r = rng.fork(e.id);
      const form = r.pick(VOICES[sub]);
      const d0 = dossier(a, { kind: sub === 'conquest' ? 'war' : sub, e }, 700 + out.length, r, isSim);
      if (!d0) continue;
      // an anonymous ordinary author, placed where the event happened
      const region = s.world.region[e.cell];
      const town = s.settlementAt[e.cell];
      const place = town >= 0 && s.settlements[town].founded <= e.year ? `set:${town}` : `reg:${region}`; // only a town that already stood
      const placeName = T.short.get(place) ?? '';
      d0.form = form;
      d0.author = { id: null, name: 'anonymous', role: `an ordinary person: the voice of the form ("${form}"), living in or near ${placeName}`, polity: d0.author?.polity ?? null, born: null, died: null, stance: 'an ordinary person who suffered or witnessed the event; knows little of high politics, a great deal about prices, weather, family and fear; may misname distant powers or blame the wrong people' };
      d0.frontmatter = d0.frontmatter.replace(/^form: .*$/m, `form: ${form}`).replace(/^author: .*$/m, 'author: null');
      d0.guidance = d0.guidance + '\n- This is a voice from below: write as the ordinary person the form implies (a conscript, a farmer’s wife, an apprentice, a market woman…). They are not named and do not know court secrets. Concrete daily life: food, prices (use the context’s currency and grain price), weather, kin, rumours. You may give the narrator and their family plain first names only if the form needs it, but do not link them and do not make them historical actors. 300–650 words.';
      out.push(d0);
    }
  }
  return out;
}
