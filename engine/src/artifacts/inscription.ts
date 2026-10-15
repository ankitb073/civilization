// Epigraphy: victory stelae, temple dedications, boundary stones, royal epitaphs. Each is rendered
// by the language engine from clause structures, so transliteration, gloss and translation agree.
import type { Gen } from './gen.ts';
import { fmt } from './gen.ts';
import type { Doc } from '../archive/doc.ts';
import { localDate } from '../archive/doc.ts';
import type { Clause, NounPhrase, NameId } from '../lang/index.ts';
import type { Polity, SimEvent } from '../sim/state.ts';
import type { Term } from '../sim/war.ts';
import { Rng } from '../core/rng.ts';
import { cap } from '../archive/context.ts';
import { domainPhrase } from '../archive/naming.ts';

const MAX_ERA = 3;

export function genInscriptions(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  // victory stelae
  for (const e of s.events) {
    if (e.sub !== 'battle') continue;
    const winner = s.polities[e.data.winner as number];
    if (!winner || ctx.eraAt(winner.id, e.year) > MAX_ERA) continue;
    if (ctx.scriptOf(winner, e.year) < 0) continue;
    const rng = new Rng(s.seed).fork('stele', e.id);
    if (!rng.chance(0.1 + Number(e.data.decisive ?? 0) * 0.25)) continue;
    victoryStele(g, e, winner, rng);
  }
  // dedications and epitaphs
  for (const [pid, reigns] of ctx.reigns) {
    const p = s.polities[pid];
    for (const r of reigns) {
      if (r.role !== 'ruler') continue;
      const rng = new Rng(s.seed).fork('dedic', r.person, pid);
      const len = r.end - r.start;
      if (len >= 6 && ctx.eraAt(pid, r.start) <= MAX_ERA && ctx.scriptOf(p, r.start + 3) >= 0 && rng.chance(0.3)) {
        dedication(g, p, r.person, r.start + rng.int(2, Math.max(2, len - 1)), rng);
      }
      const person = s.persons[r.person];
      if (person.died === r.end && person.died < 5000 && ctx.eraAt(pid, r.end) <= MAX_ERA && ctx.scriptOf(p, r.end) >= 0 && rng.chance(0.22)) {
        epitaph(g, p, r.person, r.start, r.end, rng);
      }
    }
  }
  // boundary stones
  for (const e of s.events) {
    if (e.sub !== 'treaty') continue;
    const cede = ((e.data.terms as Term[]) ?? []).find((t) => t.kind === 'cede');
    if (!cede || cede.to === undefined) continue;
    const W = s.polities[cede.to];
    if (ctx.eraAt(W.id, e.year) > MAX_ERA || ctx.scriptOf(W, e.year) < 0) continue;
    const rng = new Rng(s.seed).fork('boundary', e.id);
    if (!rng.chance(0.3)) continue;
    boundaryStone(g, e, W, cede, rng);
  }
}

interface Names { map: Map<NameId, string> }

function np(name: NameId, det?: NounPhrase['determinative'], extra: Partial<NounPhrase> = {}): NounPhrase {
  return { head: { name }, determinative: det, ...extra };
}

function kingOf(polityName: NameId, great: boolean, female = false): NounPhrase[] {
  const out: NounPhrase[] = [];
  if (great && !female) out.push({ head: { concept: 'great-king' } });
  out.push({ head: { concept: female ? 'queen' : 'king' }, possessor: { head: { name: polityName }, determinative: 'land' } });
  return out;
}

function render(g: Gen, d: Doc, p: Polity, year: number, clauses: Clause[], names: Names, damaged: boolean) {
  const ctx = g.ctx;
  const s = ctx.s;
  const scId = ctx.scriptOf(p, year);
  const sc = s.scripts[scId];
  const resolve = (n: NameId) => {
    const ref = names.map.get(n);
    const text = ctx.name(n, d.lang, year);
    return ref ? d.link(ref, text) : text;
  };
  const used = damaged && clauses.length > 1 ? clauses.slice(0, -1) : clauses;
  const r = s.lang.renderClause(d.lang, year, { kind: sc.kind, originLang: sc.originLang }, used, resolve);
  const strip = (x: string) => x.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1');
  const out = {
    transliteration: strip(r.transliteration),
    normalized: strip(r.normalized),
    tokens: r.tokens.map((t) => ({ normalized: strip(t.normalized), segmented: strip(t.segmented), gloss: strip(t.gloss) })),
    translation: r.translation,
  };
  if (damaged && clauses.length > 1) {
    out.transliteration += ' [x x x x x]';
    out.normalized += ' [...]';
    out.tokens.push({ normalized: '[...]', segmented: '[...]', gloss: '' });
    out.translation += ' [...]';
  }
  return { r: out, script: sc };
}

function headerFor(g: Gen, d: Doc, kind: string, place: string, medium: string, scriptRef: string, damaged: boolean, rng: Rng): string {
  const cond = damaged ? d.pick(['The lower part of the stone is broken away.', 'The last lines are worn beyond reading.', 'A fracture runs through the final register.']) : d.pick(['The text is complete.', 'The surface is well preserved.', 'Only minor chips affect the reading.']);
  void rng;
  const art = /^[aeiou]/i.test(medium) ? 'an' : 'a';
  return `${cap(kind)} on ${art} ${medium}, ${place}. Inscribed in the ${scriptRef}. ${cond}`;
}

function victoryStele(g: Gen, e: SimEvent, W: Polity, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const reign = ctx.rulerAt(W.id, e.year);
  if (!reign) return;
  const ruler = s.persons[reign.person];
  if (ruler.died < e.year || e.year - ruler.born < 16) return;
  const year = Math.min(4999, e.year + rng.int(0, 2), ruler.died);
  const lang = ctx.polityLang(W, year);
  const d = g.doc(lang, year, `stele:${e.id}`);
  const loserId = e.parts.find(([, r]) => r === 'attacker' || r === 'defender' ? false : false)?.[0];
  void loserId;
  const A = ctx.idNum(e.parts.find(([, r]) => r === 'attacker')![0]);
  const D = ctx.idNum(e.parts.find(([, r]) => r === 'defender')![0]);
  const L = s.polities[W.id === A ? D : A];
  const near = e.parts.find(([, r]) => r === 'near')?.[0];
  const placeName: NameId = near ? s.settlements[ctx.idNum(near)].nameId : s.regionNames[e.data.region as number];
  const rel = ctx.religionOf(W.id, e.year);
  const mov = rel >= 0 ? s.movements[rel] : s.movements[s.cultures[W.culture].pantheon];
  const godId = mov.deities.length ? rng.pick(mov.deities) : s.movements[s.cultures[W.culture].pantheon].deities[0];
  const god = s.deities[godId];
  const names: Names = { map: new Map() };
  names.map.set(ruler.nameId, `per:${ruler.id}`);
  names.map.set(W.nameId, `pol:${W.id}`);
  names.map.set(L.nameId, `pol:${L.id}`);
  names.map.set(god.nameId, `dei:${god.id}`);
  if (near) names.map.set(placeName, near);
  else names.map.set(placeName, `reg:${e.data.region}`);
  const isA = W.id === A;
  const trueDead = Number(isA ? e.data.defenderLosses : e.data.attackerLosses);
  const claimed = Math.max(100, Math.round((trueDead * (2 + rng.next() * 6)) / 100) * 100);
  const great = ctx.govAt(W, e.year) === 'empire';
  const clauses: Clause[] = [
    { verb: 'defeat', mood: 'past', subject: np(ruler.nameId, 'person', { apposition: kingOf(W.nameId, great, ruler.sex === 'f') }), object: np(L.nameId, 'land'), obliques: [{ role: 'locative', np: np(placeName, 'place') }] },
    { verb: 'kill', mood: 'past', object: { head: { concept: 'soldier' }, plural: true, count: claimed } },
    { verb: 'erect', mood: 'past', object: { head: { concept: 'stele' }, demonstrative: true }, obliques: [{ role: 'benefactive', np: np(god.nameId, 'deity', { apposition: [{ head: { concept: god.sex === 'f' ? 'lady' : 'lord' }, possessorPronoun: '3sg.m' }] }) }] },
    { verb: 'destroy', mood: 'optative', subject: np(god.nameId, 'deity'), object: { head: { concept: 'name' }, possessor: { head: { concept: 'enemy' } } } },
  ];
  const damaged = rng.chance(0.35);
  const { r, script } = render(g, d, W, year, clauses, names, damaged);
  const medium = rng.pick(['basalt stele', 'limestone stele', 'diorite stele', 'rock relief']);
  const capCity = ctx.capitalAt(W, year);
  const findCell = near ? s.settlements[ctx.idNum(near)].cell : e.cell;
  const lines: string[] = [];
  lines.push(headerFor(g, d, 'victory monument', `set up ${near ? `near ${d.n(near)}` : `in ${d.n(`reg:${e.data.region}`)}`}`, medium, d.link(`scr:${script.id}`, `${d.nameOf(`scr:${script.id}`)} script`), damaged, rng));
  lines.push('');
  lines.push('## Translation');
  lines.push('');
  lines.push(`> ${r.translation}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Commentary');
  lines.push('');
  lines.push(`The stele commemorates the ${d.title(`evt:${e.id}`)}, fought ${localDate(ctx, d, W, e.year)}. It claims ${fmt(claimed)} enemy dead. The ground-truth record of the battle gives ${fmt(trueDead)} losses for ${d.ed(`pol:${L.id}`)}, an overstatement of about ${Math.round(claimed / Math.max(1, trueDead))}×, typical of royal victory monuments. The battle belonged to the ${d.title(`evt:${e.data.war as number}`)}.`);
  g.add({
    sub: 'inscription', year, title: `Victory stele of ${g.T.short.get(`per:${ruler.id}`)}: ${g.T.short.get(`evt:${e.id}`)}`,
    author: ruler.id, polity: W.id, lang, script: script.id, medium, cell: findCell, settlement: near ? ctx.idNum(near) : null,
    about: [e.id, e.data.war as number], body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, W, year),
    interlinear: r, flagship: false, durable: 0.85, tau: 6000, seat: capCity,
  });
}

function dedication(g: Gen, p: Polity, rulerId: number, year0: number, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = Math.min(year0, s.persons[rulerId].died);
  if (year - s.persons[rulerId].born < 16) return;
  const lang = ctx.polityLang(p, year);
  const d = g.doc(lang, year, `dedic:${rulerId}:${p.id}`);
  const ruler = s.persons[rulerId];
  const rel = ctx.religionOf(p.id, year);
  const mov = rel >= 0 ? s.movements[rel] : s.movements[s.cultures[p.culture].pantheon];
  const pool = mov.deities.length ? mov.deities : s.movements[s.cultures[p.culture].pantheon].deities;
  const god = s.deities[rng.pick(pool)];
  const capCity = ctx.capitalAt(p, year);
  const t = s.settlements[capCity];
  const names: Names = { map: new Map() };
  names.map.set(ruler.nameId, `per:${ruler.id}`);
  names.map.set(p.nameId, `pol:${p.id}`);
  names.map.set(god.nameId, `dei:${god.id}`);
  const building = rng.pick(['temple', 'temple', 'palace', 'wall', 'granary', 'gate']);
  const great = ctx.govAt(p, year) === 'empire';
  const subject = np(ruler.nameId, 'person', { apposition: kingOf(p.nameId, great, ruler.sex === 'f') });
  const clauses: Clause[] = building === 'temple'
    ? [{ verb: 'build', mood: 'past', subject, object: { head: { concept: 'temple' }, demonstrative: true }, obliques: [{ role: 'benefactive', np: np(god.nameId, 'deity', { apposition: [{ head: { concept: god.sex === 'f' ? 'lady' : 'lord' }, possessorPronoun: '3sg.m' }] }) }] },
       { verb: 'protect', mood: 'optative', subject: np(god.nameId, 'deity'), object: { head: { concept: 'king' } } }]
    : [{ verb: rng.chance(0.5) ? 'build' : 'restore', mood: 'past', subject, object: { head: { concept: building }, demonstrative: true }, obliques: [{ role: 'locative', np: np(t.nameId, 'place') }] },
       { verb: 'bless', mood: 'optative', subject: np(god.nameId, 'deity'), object: { head: { concept: 'city' } } }];
  if (building !== 'temple') names.map.set(t.nameId, `set:${t.id}`);
  const damaged = rng.chance(0.3);
  const { r, script } = render(g, d, p, year, clauses, names, damaged);
  const medium = rng.pick(['foundation tablet', 'inscribed brick', 'limestone slab', 'bronze plaque']);
  const lines: string[] = [];
  lines.push(headerFor(g, d, `building inscription`, `from the ${building} at ${d.n(`set:${capCity}`)}`, medium, d.link(`scr:${script.id}`, `${d.nameOf(`scr:${script.id}`)} script`), damaged, rng));
  lines.push('');
  lines.push('## Translation');
  lines.push('');
  lines.push(`> ${r.translation}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Commentary');
  lines.push('');
  const reign = ctx.rulerAt(p.id, year);
  const issued = localDate(ctx, d, p, year);
  lines.push(`Issued ${issued}${reign && !issued.includes(`per:${reign.person}|`) ? `, in the reign of ${d.ed(`per:${reign.person}`)}` : ''}. ${d.ed(`dei:${god.id}`)} was ${god.domain === 'sky' || god.domain === 'storm' ? 'the head of the pantheon' : `the ${god.sex === 'f' ? 'goddess' : 'god'} of ${domainPhrase(god.domain)}`} in the ${d.title(`mov:${mov.id}`)} tradition.`);
  g.add({
    sub: 'inscription', year, title: `${cap(building)} inscription of ${g.T.short.get(`per:${ruler.id}`)} at ${g.T.short.get(`set:${capCity}`)}`,
    author: ruler.id, polity: p.id, lang, script: script.id, medium, cell: t.cell, settlement: capCity, about: [],
    body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, p, year), interlinear: r, flagship: false,
    durable: 0.8, tau: 5000, seat: capCity,
  });
}

function epitaph(g: Gen, p: Polity, rulerId: number, start: number, end: number, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = end;
  const lang = ctx.polityLang(p, year);
  const d = g.doc(lang, year, `epitaph:${rulerId}`);
  const ruler = s.persons[rulerId];
  const capCity = ctx.capitalAt(p, year);
  const pan = s.movements[ctx.religionOf(p.id, year)] ?? s.movements[s.cultures[p.culture].pantheon];
  const under = pan.deities.map((x) => s.deities[x]).find((x) => x.domain === 'underworld') ?? (pan.deities.length ? s.deities[pan.deities[0]] : null);
  const names: Names = { map: new Map() };
  names.map.set(ruler.nameId, `per:${ruler.id}`);
  names.map.set(p.nameId, `pol:${p.id}`);
  const appo = kingOf(p.nameId, false, ruler.sex === 'f');
  if (ruler.father !== null) {
    const f = s.persons[ruler.father];
    names.map.set(f.nameId, `per:${f.id}`);
    appo.push({ head: { concept: ruler.sex === 'f' ? 'daughter' : 'son' }, possessor: np(f.nameId, 'person') });
  }
  const clauses: Clause[] = [
    { verb: 'dwell', mood: 'present', subject: np(ruler.nameId, 'person', { apposition: appo }), obliques: [{ role: 'locative', np: { head: { concept: 'tomb' }, demonstrative: true } }] },
  ];
  if (under) {
    names.map.set(under.nameId, `dei:${under.id}`);
    clauses.push({ verb: 'protect', mood: 'optative', subject: np(under.nameId, 'deity'), object: { head: { concept: 'soul' }, possessorPronoun: ruler.sex === 'f' ? '3sg.f' : '3sg.m' } });
  }
  const damaged = rng.chance(0.4);
  const { r, script } = render(g, d, p, year, clauses, names, damaged);
  const lines: string[] = [];
  lines.push(headerFor(g, d, 'funerary inscription', `from the royal tombs of ${d.n(`set:${capCity}`)}`, rng.pick(['sarcophagus lid', 'tomb lintel', 'funerary stele']), d.link(`scr:${script.id}`, `${d.nameOf(`scr:${script.id}`)} script`), damaged, rng));
  lines.push('');
  lines.push('## Translation');
  lines.push('');
  lines.push(`> ${r.translation}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Commentary');
  lines.push('');
  lines.push(`${d.ed(`per:${ruler.id}`)} reigned from AY ${start} to AY ${end} (${end - start} years) and ${ruler.deathCause === 'natural' ? 'died in office' : `died by ${ruler.deathCause}`}.`);
  g.add({
    sub: 'inscription', year, title: `Epitaph of ${g.T.short.get(`per:${ruler.id}`)}`, author: null, polity: p.id, lang, script: script.id,
    medium: 'stone', cell: s.settlements[capCity].cell, settlement: capCity, about: [], body: lines.join('\n'), mentions: d.mentions,
    dateText: localDate(ctx, d, p, year), interlinear: r, flagship: false, durable: 0.85, tau: 6000, seat: capCity,
  });
}

function boundaryStone(g: Gen, e: SimEvent, W: Polity, cede: Term, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = e.year;
  const lang = ctx.polityLang(W, year);
  const d = g.doc(lang, year, `boundary:${e.id}`);
  const reign = ctx.rulerAt(W.id, year);
  if (!reign) return;
  const ruler = s.persons[reign.person];
  if (year - ruler.born < 16 || ruler.died < year) return;
  const pan = s.movements[ctx.religionOf(W.id, year)] ?? s.movements[s.cultures[W.culture].pantheon];
  const godId = pan.deities.length ? rng.pick(pan.deities) : s.movements[s.cultures[W.culture].pantheon].deities[0];
  const god = s.deities[godId];
  const cell = cede.cells?.[0] ?? e.cell;
  const region = s.world.region[cell];
  const names: Names = { map: new Map() };
  names.map.set(ruler.nameId, `per:${ruler.id}`);
  names.map.set(W.nameId, `pol:${W.id}`);
  names.map.set(god.nameId, `dei:${god.id}`);
  names.map.set(s.regionNames[region], `reg:${region}`);
  const clauses: Clause[] = [
    { verb: 'erect', mood: 'past', subject: np(ruler.nameId, 'person', { apposition: kingOf(W.nameId, false, ruler.sex === 'f') }), object: { head: { concept: 'boundary-stone' }, demonstrative: true }, obliques: [{ role: 'locative', np: np(s.regionNames[region], 'land') }] },
    { verb: 'curse', mood: 'optative', subject: np(god.nameId, 'deity'), object: { head: { concept: 'enemy' } } },
  ];
  const damaged = rng.chance(0.3);
  const { r, script } = render(g, d, W, year, clauses, names, damaged);
  const lines: string[] = [];
  lines.push(headerFor(g, d, 'boundary inscription', `found in ${d.n(`reg:${region}`)}`, 'kudurru-type stone', d.link(`scr:${script.id}`, `${d.nameOf(`scr:${script.id}`)} script`), damaged, rng));
  lines.push('');
  lines.push('## Translation');
  lines.push('');
  lines.push(`> ${r.translation}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Commentary');
  lines.push('');
  lines.push(`Set up after the ${d.title(`evt:${e.id}`)}, by which ${d.ed(`pol:${cede.from!}`)} ceded ${cede.cells?.length ?? 0} district${cede.cells?.length === 1 ? '' : 's'} to ${d.ed(`pol:${W.id}`)}.`);
  g.add({
    sub: 'inscription', year, title: `Boundary stone of ${g.T.short.get(`per:${ruler.id}`)} in ${g.T.short.get(`reg:${region}`)}`,
    author: ruler.id, polity: W.id, lang, script: script.id, medium: 'stone', cell, settlement: null, about: [e.id],
    body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, W, year), interlinear: r, flagship: false,
    durable: 0.9, tau: 7000, seat: null,
  });
}
