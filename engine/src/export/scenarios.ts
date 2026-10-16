// The Tablet House (#/tablet, docs/lld/tablet-house.md): scenarios.json, the game's playable moments.
// Each is a siege or sack of a literate state's capital together with the battle of the same war that brought the enemy
// to its walls (the battle the siege is recorded as caused by, fought earlier the same year). Everything a scenario
// script needs is read from the record: period names as the defender's own scribes wrote them (the archive's naming,
// as the flagship dossiers' allowedLinks texts), the ruler and the commander at the date, the gods, the coin and the
// price of grain, the hardships of the year, the treaty that ended the war and the defender's surviving chronicle of it.
// Nothing here creates a document, person or event or draws from a shared random stream, so the archive and its
// catalogue numbering are untouched. engine/test/scenarios.test.ts recounts every fact from world.sqlite.

import type { Archive } from '../archive/build.ts';
import type { SimEvent, Polity, Person, ClimateAnomaly } from '../sim/state.ts';
import type { Term } from '../sim/war.ts';
import type { Artifact } from '../artifacts/gen.ts';
import type { Reign } from '../archive/context.ts';
import type { Scenario, ScenarioOutcome, ScenariosJson } from './contract.ts';
import { localDate } from '../archive/doc.ts';
import { money, techAt } from '../artifacts/gen.ts';
import { titleOf } from '../artifacts/treaty.ts';
import { GOODS } from '../sim/economy.ts';
import { BattleExport } from './battle.ts';
import type { Heraldry } from './deck.ts';

/** How many scenarios the game ships. */
export const SCENARIO_COUNT = 30;
/** A war ended within this many years of the siege ended it on the scenario's fourth day (the treaty, the conquest). */
export const SCENARIO_SOON = 2;
const GRAIN = GOODS.findIndex((g) => g.key === 'grain');
/** A state's technological era (the decadal survey's era index), as the flagship dossiers name it. */
export const ERAS = ['Bronze Age', 'Iron Age', 'Classical', 'Medieval', 'Early Modern', 'Industrial', 'Post-industrial'];

/** A playable moment before it is written out: the events and states it is drawn from. */
export interface ScenarioPick {
  e: SimEvent;            // the siege or sack
  war: SimEvent;
  battle: SimEvent;       // the battle of the same war that caused it
  D: Polity;              // ours: the besieged state (the war's defender)
  A: Polity;              // theirs: the besieger (the war's attacker)
  city: number;           // settlement id
  outcome: ScenarioOutcome;
  treaty: SimEvent | null; // the war's treaty or conquest, when it came within SCENARIO_SOON years
  chronicle: Artifact | null; // the defender's surviving account of the war
  ruler: Reign;           // the defender's sovereign at the date
  score: number;
}

/** Display text without link markup or the editors' "[AY n]" normalizations (they are apparatus, not the object). */
export function plainText(x: string): string {
  return x.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/ \[AY -?\d+\]/g, '');
}

const part = (e: SimEvent, role: string): string | undefined => e.parts.find(([, r]) => r === role)?.[0];
const num = (ref: string | undefined): number => (ref === undefined ? -1 : Number(ref.slice(ref.indexOf(':') + 1)));

/** Every siege or sack the game could be set at (unscored order: event id). */
export function scenarioCandidates(a: Archive): ScenarioPick[] {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const simEvents = ctx.r.simEvents ?? s.events.length;
  // documents about each event, flagships apart (they mark the moments the archive's writers chose)
  const docs = new Map<number, { n: number; flagships: number }>();
  for (const x of a.artifacts) for (const id of x.about) {
    const d = docs.get(id) ?? { n: 0, flagships: 0 };
    d.n++;
    if (x.flagship) d.flagships++;
    docs.set(id, d);
  }
  const chronicles = new Map<number, Artifact>();
  for (const x of a.artifacts) if (x.sub === 'chronicle' && x.rival && x.rival.side === 'defender' && !chronicles.has(x.rival.eventId)) chronicles.set(x.rival.eventId, x);
  const out: ScenarioPick[] = [];
  for (let i = 0; i < simEvents; i++) {
    const e = s.events[i];
    if ((e.sub !== 'siege' && e.sub !== 'sack') || !T.pageRefs.has(`evt:${e.id}`)) continue;
    const war = s.events[e.data.war as number];
    if (!war || war.sub !== 'war') continue;
    const D = s.polities[num(part(war, 'defender'))];
    const A = s.polities[num(part(war, 'attacker'))];
    if (!D || !A || part(e, 'besieged') !== `pol:${D.id}` || part(e, 'besieger') !== `pol:${A.id}`) continue;
    const battle = e.causes.map((c) => s.events[c]).find((b) => b.sub === 'battle' && b.data.war === war.id && b.year <= e.year && b.year >= e.year - 1);
    if (!battle || !T.pageRefs.has(`evt:${battle.id}`) || part(battle, 'defender') !== `pol:${D.id}` || part(battle, 'attacker') !== `pol:${A.id}`) continue;
    const city = num(part(e, 'settlement'));
    if (city < 0 || !T.pageRefs.has(`set:${city}`) || ctx.capitalAt(D, e.year) !== city) continue;
    if (ctx.scriptOf(D, e.year) < 0) continue; // the defender had writing at the date
    if (!ctx.polityStats.get(D.id)?.length) continue; // and the decadal survey knows it (its age, faith and coin)
    // a sovereign in the palace: reigning that year and not killed in the battle before the siege
    const ruler = ctx.rulerAt(D.id, e.year);
    const enemyRuler = ctx.rulerAt(A.id, e.year);
    if (!ruler || !enemyRuler || !part(battle, 'defending commander')) continue;
    const rp = s.persons[ruler.person];
    if (rp.born > e.year || rp.died < e.year || rp.deathEvent === battle.id || s.persons[enemyRuler.person].born > e.year) continue;
    // how it ended
    const tid = war.data.treaty as number | undefined;
    const tEv = tid !== undefined && s.events[tid].year - e.year <= SCENARIO_SOON ? s.events[tid] : null;
    const terms = (tEv?.data.terms as Term[] | undefined) ?? [];
    const annexed = !!tEv && tEv.sub === 'conquest' && terms.some((t) => t.kind === 'annexation' && t.from === D.id);
    const outcome: ScenarioOutcome = e.sub === 'sack' ? 'sacked' : annexed ? 'conquered' : tEv && tEv.sub === 'treaty' ? 'treaty' : 'held';
    const treaty = outcome === 'held' ? null : tEv;
    const chronicle = chronicles.get(war.id) ?? null;
    // drama: a famous, well-documented, bloody moment in a great city
    const t = s.settlements[city];
    const pop = popAt(t.popHistory, e.year);
    const size = Number(battle.data.attackerSize) + Number(battle.data.defenderSize);
    const about = [e.id, war.id, battle.id, ...(treaty ? [treaty.id] : [])].map((id) => docs.get(id) ?? { n: 0, flagships: 0 });
    const flag = about.reduce((m, d) => m + d.flagships, 0);
    const nDocs = about.reduce((m, d) => m + d.n, 0);
    const backlinks = a.pages.get(`evt:${e.id}`)?.backlinks.length ?? 0;
    const treatyDoc = treaty && a.artifacts.some((x) => x.sub === 'treaty' && x.about[0] === treaty.id);
    const killed = battle.data.commanderKilled === num(part(battle, 'defending commander'));
    let score = e.sig + 0.35 * Math.log10(Math.max(10, pop)) + 0.3 * Math.log10(Math.max(10, size));
    if (e.data.burnedArchives) score += 0.8;
    if (chronicle) score += 1;
    if (treatyDoc) score += 0.4;
    score += Math.min(1.2, 0.6 * flag) + Math.min(0.5, 0.06 * nDocs) + Math.min(0.5, 0.04 * backlinks);
    if (num(part(battle, 'defending commander')) === ruler.person) score += 0.3;
    if (killed) score += 0.3;
    if (t.sacks.some((x) => s.events[x].year < e.year)) score += 0.2;
    const hard = hardshipOf(a, { e, D, city });
    if (hard.famine) score += 0.5;
    if (hard.plague) score += 0.5;
    if (hard.drought) score += 0.3;
    out.push({ e, war, battle, D, A, city, outcome, treaty, chronicle, ruler, score });
  }
  return out;
}

/** Choose the scenarios: the most dramatic moments, spread over the five millennia (an equal share each), over every
 *  kind of ending, over the regions of the world, never the same city or war twice. */
export function pickScenarios(a: Archive, cands: ScenarioPick[], n = SCENARIO_COUNT): ScenarioPick[] {
  const s = a.ctx.s;
  const region = (p: ScenarioPick) => s.world.region[p.e.cell];
  const sorted = cands.slice().sort((x, y) => y.score - x.score || x.e.id - y.e.id);
  const picked: ScenarioPick[] = [];
  const BANDS = 5;
  const per = Math.ceil(n / BANDS);
  // each band: two sacks, a conquest, a peace, walls that held, and a conquest or a peace in turn
  for (let band = 0; band < BANDS; band++) {
    const turn: ScenarioOutcome = band % 2 ? 'treaty' : 'conquered';
    const plan: (ScenarioOutcome | null)[] = ['sacked', 'conquered', 'treaty', 'held', 'sacked', turn, null, null];
    plan.length = Math.max(per, 1);
    const lo = (5000 / BANDS) * band, hi = (5000 / BANDS) * (band + 1);
    const inBand = sorted.filter((p) => p.e.year >= lo && p.e.year < hi);
    const mine: ScenarioPick[] = [];
    const ok = (p: ScenarioPick, strict: boolean) => !picked.includes(p) && !mine.includes(p)
      && !picked.some((q) => q.city === p.city || q.war.id === p.war.id)
      && !mine.some((q) => q.city === p.city || q.war.id === p.war.id || (strict && (region(q) === region(p) || Math.abs(q.e.year - p.e.year) < 90)));
    for (const want of plan) {
      if (picked.length + mine.length >= n) break;
      const pool = inBand.filter((p) => want === null || p.outcome === want);
      const p = pool.find((x) => ok(x, true)) ?? pool.find((x) => ok(x, false));
      if (p) mine.push(p);
    }
    // a band short of some ending makes up its share from its best remaining moments
    while (mine.length < per && picked.length + mine.length < n) {
      const p = inBand.find((x) => ok(x, true)) ?? inBand.find((x) => ok(x, false));
      if (!p) break;
      mine.push(p);
    }
    picked.push(...mine);
  }
  return picked.sort((x, y) => x.e.year - y.e.year || x.e.id - y.e.id);
}

const hardCache = new WeakMap<Archive, { famines: SimEvent[]; plagues: SimEvent[] }>();
/** The hardships of the year: a famine in the city's region or striking the state, a plague in the city or striking
 *  the state, a drought over the city; each spanning the year of the siege. */
export function hardshipOf(a: Archive, p: Pick<ScenarioPick, 'e' | 'D' | 'city'>): { famine: SimEvent | null; plague: SimEvent | null; drought: ClimateAnomaly | null } {
  const s = a.ctx.s;
  let h = hardCache.get(a);
  if (!h) hardCache.set(a, (h = { famines: s.events.filter((x) => x.sub === 'famine'), plagues: s.events.filter((x) => x.sub === 'plague') }));
  const year = p.e.year;
  const cell = s.settlements[p.city].cell;
  const region = s.world.region[cell];
  const spans = (x: SimEvent) => x.year <= year && year <= Math.max(x.year, x.end);
  return {
    famine: h.famines.find((x) => spans(x) && x.parts.some(([r, role]) => (role === 'region' && r === `reg:${region}`) || (role === 'stricken' && r === `pol:${p.D.id}`))) ?? null,
    plague: h.plagues.find((x) => spans(x) && x.parts.some(([r, role]) => r === `set:${p.city}` || (role === 'stricken' && r === `pol:${p.D.id}`))) ?? null,
    drought: s.anomalies.find((x) => x.kind === 'drought' && x.start <= year && year <= x.end && x.cells.includes(cell)) ?? null,
  };
}

/** A settlement's population at a date: the last century census at or before it (the first one, if it came later). */
export function popAt(hist: [number, number][], year: number): number {
  let v = hist[0]?.[1] ?? 0;
  for (const [y, p] of hist) if (y <= year) v = p;
  return Math.round(v);
}

/** The writing material of a state's palace scribe at a date (its age and technologies). */
export function mediumOf(p: Polity, era: number, year: number): string {
  if (era >= 5) return 'typescript';
  if (era === 4 || techAt(p, 'paper', year)) return 'paper';
  if (era === 3) return 'parchment';
  if (era === 2) return 'papyrus';
  return 'clay tablet';
}

/** Write one scenario out from the record. */
export function buildScenario(a: Archive, H: Heraldry, B: BattleExport, p: ScenarioPick): Scenario {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const { e, war, battle, D, A } = p;
  const year = e.year;
  const lang = ctx.polityLang(D, year);
  const d = a.gen.doc(lang, year, `scenario:${e.id}`);
  const nm = (ref: string) => d.nameOf(ref).replace(/,? \(?AY [\d–-]+\)?$/, '');
  const person = (id: number): Person => s.persons[id];
  const era = ctx.eraAt(D.id, year);
  const t = s.settlements[p.city];
  // the state at the date
  const reign = p.ruler;
  const king = person(reign.person);
  const enemyReign = ctx.rulerAt(A.id, year)!;
  const enemyKing = person(enemyReign.person);
  const gov = ctx.govAt(D, year);
  const culture = ctx.polityCulture(D, year);
  const rel = ctx.religionOf(D.id, year);
  const faith = rel >= 0 && s.movements[rel].born <= year ? s.movements[rel] : null;
  const pantheon = s.movements[s.cultures[culture].pantheon];
  // the state faith, or the people's own gods where the state keeps none; a faith without gods has none to invoke
  // (its chroniclers pray "by the grace of the One whom the faithful teach")
  const fm = faith ?? pantheon;
  const godIds = fm.deities.filter((g) => s.deities[g].born <= year).sort((x, y) => x - y).slice(0, 6);
  const cur = ctx.currencyAtExact(D.id, year);
  const coin = cur >= 0 && s.currencies[cur].born <= year ? cur : -1;
  const coinSilver = coin >= 0 ? round(ctx.contentAt(coin, year), 4) : null;
  const grain = a.gen.price(p.city, GRAIN, year);
  const scriptId = ctx.scriptOf(D, year);
  // the battle
  const bPart = (role: string) => part(battle, role);
  const near = bPart('near');
  const cmd = person(num(bPart('defending commander')));
  const enemyCmd = bPart('attacking commander') ? person(num(bPart('attacking commander'))) : null;
  const battleRuler = ctx.rulerAt(D.id, battle.year);
  // the war, summed over the record's battles (equal to the war's own totals when it ended in a peace)
  const battles = (ctx.eventsByRef.get(`evt:${war.id}`) ?? []).map((i) => s.events[i]).filter((b) => b.sub === 'battle').sort((x, y) => x.year - y.year || x.id - y.id);
  const warOutcome = String(war.data.outcome ?? 'dissolved');
  // the end
  let treaty: Scenario['treaty'] = null;
  if (p.treaty) {
    const tEv = p.treaty;
    const terms = (tEv.data.terms as Term[] | undefined) ?? [];
    const ours = terms.filter((x) => (x.kind === 'cede' || x.kind === 'annexation') && x.from === D.id);
    const trib = terms.find((x) => x.kind === 'tribute' && x.from === D.id);
    const ind = terms.find((x) => x.kind === 'indemnity' && x.from === D.id);
    const truce = terms.find((x) => x.kind === 'truce');
    const doc = a.artifacts.find((x) => x.sub === 'treaty' && x.about[0] === tEv.id) ?? null;
    const site = part(tEv, 'signed at');
    treaty = {
      id: `evt:${tEv.id}`, ceded: ours.reduce((m, x) => m + (x.cells?.length ?? 0), 0),
      tribute: trib ? `${plainText(money(a.gen, d, trib.amount!, D.id, tEv.year))} a year for ${trib.years} years` : null,
      truce: truce?.years ?? null,
      text: doc ? plainText(doc.body.split('\n---\n')[0]).trim() : null,
      kind: tEv.sub === 'treaty' ? 'treaty' : 'conquest', name: nm(`evt:${tEv.id}`), year: tEv.year,
      signedAt: site ? nm(site) : null,
      towns: ours.flatMap((x) => x.settlements ?? []).filter((x) => s.settlements[x].founded <= tEv.year).map((x) => nm(`set:${x}`)),
      indemnity: ind ? plainText(money(a.gen, d, ind.amount!, D.id, tEv.year)) : null,
      tributeKg: trib?.amount ?? null, tributeYears: trib?.years ?? null, indemnityKg: ind?.amount ?? null,
      terms: terms.map((x) => x.kind),
      catalog: doc?.catalog ?? null, doc: doc ? `art:${doc.id}` : null,
    };
  }
  const region = s.world.region[t.cell];
  const { famine, plague, drought } = hardshipOf(a, p);
  // the defender's own account of the war, as it survives
  let chronicle: Scenario['chronicle'] = null;
  if (p.chronicle) {
    const x = p.chronicle;
    const claim = B.of(battle).claims.find((c) => c.art === `art:${x.id}` && c.kind === 'chronicle') ?? null;
    const claims = new Map(x.rival?.claims ?? []);
    const claimed = (pol: Polity) => { const v = claims.get(`Losses of ${T.short.get(`pol:${pol.id}`)}`); return v === undefined ? null : Number(v.replace(/[^\d.]/g, '')); };
    const { quote, outcomeWords } = chronicleWords(x, battle, claim ? [claim.losses[1], claim.losses[0]] : null);
    chronicle = {
      catalog: x.catalog, author: x.author !== null ? ctx.name(person(x.author).nameId, x.lang, x.year) : 'anonymous', year: x.year,
      oursLost: claim?.losses[1] ?? null, theirsLost: claim?.losses[0] ?? null, outcomeWords, quote,
      id: `art:${x.id}`, title: x.title, authorId: x.author !== null ? `per:${x.author}` : null, medium: x.medium, condition: x.condition,
      tellsBattle: claim !== null, claimsWon: claim ? claim.won === 1 : null,
      warOursLost: claimed(D), warTheirsLost: claimed(A), outcomeClaim: claims.get('Outcome') ?? null,
    };
  }
  // names in use among the city's people at the time (buildTales: the culture of the place, then the state's)
  const names: Scenario['names'] = { f: [], m: [] };
  let people = -1;
  for (const c of [ctx.cultureAt(t.cell, year), culture].filter((c, k, xs) => c >= 0 && xs.indexOf(c) === k)) {
    const cl = s.cultures[c].lang;
    const got: Scenario['names'] = { f: [], m: [] };
    for (const sex of ['f', 'm'] as const) {
      for (const q of s.persons) {
        if (q.culture !== c || q.sex !== sex || q.born > year + 20 || q.born < year - 200) continue;
        if (s.lang.nameKind(q.nameId) !== (sex === 'f' ? 'person-f' : 'person-m')) continue;
        const x = ctx.name(q.nameId, cl, year);
        if (!got[sex].includes(x)) got[sex].push(x);
        if (got[sex].length >= 10) break;
      }
    }
    if (got.f.length + got.m.length) { names.f = got.f; names.m = got.m; people = c; break; }
  }
  if (people < 0) people = ctx.cultureAt(t.cell, year) >= 0 ? ctx.cultureAt(t.cell, year) : culture;
  // where the 3D terrain view (atlas/src/terrain: SCALE 0.01, origin at the map's centre) looks from
  const w = s.world;
  const tx = round(w.x[t.cell] * 0.01 - (w.width * 0.01) / 2, 3), tz = round(w.y[t.cell] * 0.01 - (w.height * 0.01) / 2, 3);
  const female = (q: Person) => q.sex === 'f';
  return {
    id: `sc-${e.id}`, event: e.id, year,
    city: {
      id: `set:${t.id}`, name: nm(`set:${t.id}`), pop: popAt(t.popHistory, year), cell: t.cell, port: t.port,
      region: nm(`reg:${region}`), people: nm(`cul:${people}`), peopleId: `cul:${people}`, arms: H.settlement(t.id),
      sacked: t.sacks.filter((x) => s.events[x].year < year).length, founded: t.founded,
    },
    state: {
      id: `pol:${D.id}`, name: nm(`pol:${D.id}`),
      ruler: { id: `per:${king.id}`, name: nm(`per:${king.id}`), sex: king.sex, age: year - king.born, title: titleOf(gov, era, female(king)), since: reign.start, died: king.died, deathCause: king.deathCause },
      faith: nm(`mov:${fm.id}`),
      gods: godIds.map((g) => ({ name: nm(`dei:${g}`), sex: s.deities[g].sex, role: s.deities[g].domain, id: `dei:${g}` })),
      coin: coin >= 0 ? nm(`cur:${coin}`) : null, grain: grain === null ? null : round(grain, 3),
      faithId: `mov:${fm.id}`, faithKind: fm.kind, coinId: coin >= 0 ? `cur:${coin}` : null, coinSilver,
      grainCoin: grain !== null && coinSilver ? round(grain / coinSilver, 2) : null,
      gov, language: nm(`lan:${lang}`), langId: lang, arms: H.polity(D),
    },
    enemy: {
      id: `pol:${A.id}`, name: nm(`pol:${A.id}`),
      ruler: { id: `per:${enemyKing.id}`, name: nm(`per:${enemyKing.id}`), sex: enemyKing.sex, age: year - enemyKing.born, title: titleOf(ctx.govAt(A, year), ctx.eraAt(A.id, year), female(enemyKing)) },
      arms: H.polity(A),
    },
    medium: mediumOf(D, era, year),
    script: nm(`scr:${scriptId}`),
    scriptKind: s.scripts[scriptId].kind,
    battle: {
      id: `evt:${battle.id}`, place: near ? nm(near) : nm(`reg:${battle.data.region}`),
      ours: Number(battle.data.defenderSize), theirs: Number(battle.data.attackerSize),
      oursLost: Number(battle.data.defenderLosses), theirsLost: Number(battle.data.attackerLosses),
      won: battle.data.winner === D.id,
      commander: { name: nm(`per:${cmd.id}`), sex: cmd.sex, isKing: battleRuler !== null && battleRuler.person === cmd.id, id: `per:${cmd.id}`, age: battle.year - cmd.born, killed: battle.data.commanderKilled === cmd.id },
      year: battle.year, name: nm(`evt:${battle.id}`), placeId: near ?? `reg:${battle.data.region}`, decisive: Number(battle.data.decisive ?? 0),
      date: plainText(localDate(ctx, d, D, battle.year, { day: true, key: `evt:${battle.id}` })),
      enemyCommander: enemyCmd ? { id: `per:${enemyCmd.id}`, name: nm(`per:${enemyCmd.id}`), sex: enemyCmd.sex, killed: battle.data.commanderKilled === enemyCmd.id } : null,
    },
    outcome: p.outcome,
    burnedArchives: !!e.data.burnedArchives,
    treaty,
    hardship: {
      famine: famine !== null, plague: plague ? nm(`evt:${plague.id}`) : null, drought: drought !== null,
      grainBefore: nullRound(a.gen.price(p.city, GRAIN, year - 10), 3),
      grainAfter: nullRound(exactPrice(a, p.city, GRAIN, Math.floor(year / 10) * 10 + 10), 3),
      famineId: famine ? `evt:${famine.id}` : null, plagueId: plague ? `evt:${plague.id}` : null, droughtId: drought ? `cli:${drought.id}` : null,
    },
    chronicle,
    names,
    camera: { x: tx, y: 1.6, z: round(tz + 2.4, 3), target: [tx, 0, tz] },
    sub: e.sub as 'siege' | 'sack',
    title: T.title.get(`evt:${e.id}`) ?? '',
    date: plainText(localDate(ctx, d, D, year, { day: true, key: `evt:${e.id}` })),
    era: ERAS[Math.min(6, Math.max(0, era))], eraIndex: era,
    war: {
      id: `evt:${war.id}`, name: nm(`evt:${war.id}`), start: war.year, end: war.end, goal: String(war.data.goal ?? ''),
      battles: battles.length, won: battles.filter((b) => b.data.winner === D.id).length,
      oursLost: battles.reduce((m, b) => m + Number(b.data.defenderLosses), 0), theirsLost: battles.reduce((m, b) => m + Number(b.data.attackerLosses), 0),
      outcome: warOutcome === 'attacker' ? 'lost' : warOutcome === 'defender' ? 'won' : warOutcome === 'stalemate' ? 'stalemate' : 'dissolved',
    },
  };
}

/** One verbatim sentence of a chronicle (the tally of this battle when it tells it, else its closing words, else its
 *  opening), and the words of its closing paragraph after the date: both as the surviving text reads, never a gap. */
function chronicleWords(x: Artifact, battle: SimEvent, tally: [number | null, number | null] | null): { quote: string | null; outcomeWords: string | null } {
  // the chronicler's own narrative: up to the colophon (*Thus recorded by…*), without passages quoted from other works
  const all = x.body.split('\n---\n')[0].split(/\n\s*\n/).map((q) => q.trim()).filter(Boolean);
  const colophon = all.findIndex((q) => q.startsWith('*'));
  const paras = (colophon >= 0 ? all.slice(0, colophon) : all).filter((q) => !q.startsWith('>') && !q.startsWith('In the words of'));
  const sentences = (q: string) => plainText(q).split(/(?<=[.!?])\s+(?=[A-Z“"])/).map((z) => z.trim()).filter((z) => z && !z.includes('[...]'));
  const fmt = (n: number) => n.toLocaleString('en-US');
  let quote: string | null = null;
  if (tally && tally[0] !== null && tally[1] !== null) {
    const para = paras.find((q) => q.includes(`[AY ${battle.year}]`) && q.includes(fmt(tally[0]!)) && q.includes(fmt(tally[1]!)));
    if (para) quote = sentences(para).find((z) => z.includes(fmt(tally[0]!)) && z.includes(fmt(tally[1]!))) ?? null;
  }
  // the closing paragraph tells the peace: what follows its date is the chronicler's verdict on the war
  const last = paras[paras.length - 1] ?? '';
  const m = last.match(/\[AY -?\d+\],?\s*/);
  let outcomeWords: string | null = null;
  if (m) {
    const rest = plainText(last.slice(m.index! + m[0].length)).trim();
    if (rest && !rest.includes('[...]')) outcomeWords = rest;
  }
  if (quote === null) {
    const closing = sentences(last);
    quote = closing[closing.length - 1] ?? sentences(paras[0] ?? '')[0] ?? null;
  }
  return { quote, outcomeWords };
}

/** A market's recorded price for one decade (no fallback to earlier decades). */
function exactPrice(a: Archive, settlement: number, good: number, decade: number): number | null {
  return a.gen.priceIndex.get(`${settlement}:${good}:${decade}`) ?? null;
}

function round(x: number, k: number): number {
  const f = 10 ** k;
  return Math.round(x * f) / f;
}

function nullRound(x: number | null, k: number): number | null {
  return x === null ? null : round(x, k);
}

/** scenarios.json: the picked moments, oldest first. */
export function scenariosJson(a: Archive, H: Heraldry, picks?: ScenarioPick[]): ScenariosJson {
  const B = new BattleExport(a, H);
  const chosen = picks ?? pickScenarios(a, scenarioCandidates(a));
  return { scenarios: chosen.map((p) => buildScenario(a, H, B, p)) };
}
