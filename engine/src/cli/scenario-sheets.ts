// Fact sheets for the Tablet House script writers: build/scenarios/<id>.json (or --out=<dir>), one per scenario.
// Each carries the scenario exactly as scenarios.json ships it, every placeholder a script may use with its value, and
// the richer context a writer needs to stay inside the record (as the flagship dossiers do for documents): the war's
// other battles, the city's people and names through time, its earlier sacks, the documents about the moment with
// their catalogue numbers, the sovereign's family, prices before and after, the faith, what technology existed.
// Scripts are checked with `node engine/src/debug/scenario-validate.ts <id>|--all` (docs/lld/tablet-house.md).
// Run from the repo root (the archive ingests flagships/): node engine/src/cli/scenario-sheets.ts [seed] [--out=dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { simulate } from '../sim/run.ts';
import { buildArchive } from '../archive/build.ts';
import type { Archive } from '../archive/build.ts';
import type { SimEvent, Person } from '../sim/state.ts';
import type { Term } from '../sim/war.ts';
import { computeEras, worldFingerprint } from '../export/export.ts';
import { Heraldry } from '../export/deck.ts';
import { BattleExport } from '../export/battle.ts';
import { scenarioCandidates, pickScenarios, buildScenario, plainText, popAt } from '../export/scenarios.ts';
import type { ScenarioPick } from '../export/scenarios.ts';
import type { Scenario } from '../export/contract.ts';
import { localDate } from '../archive/doc.ts';
import { tenetText } from '../archive/pages.ts';
import { techAt } from '../artifacts/gen.ts';
import { TECHS } from '../sim/tech.ts';
import { GOODS } from '../sim/economy.ts';

const args = process.argv.slice(2);
const seed = Number(args.find((x) => /^\d+$/.test(x)) ?? 5);
const outDir = args.find((x) => x.startsWith('--out='))?.slice(6) ?? 'build/scenarios';

/** Every leaf of the scenario a script may name as {path}, with its value (arrays by index: {state.gods.0.name}). */
function placeholders(sc: Scenario): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const walk = (v: unknown, path: string) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { out[path] = v; return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}.${i}`)); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(sc, '');
  // heraldry specs and the camera are for the renderer, not for prose
  for (const k of Object.keys(out)) if (/\.arms\.|^camera\./.test(k)) delete out[k];
  return out;
}

const GUIDANCE = `Write ONE Tablet House script for this scenario: scenario-scripts/<id>.json, in the format of docs/lld/tablet-house.md ("Script format"); scenario-scripts/sc-18225.json is the model.

Rules (the validator, node engine/src/debug/scenario-validate.ts <id>, rejects a script that breaks them):
- Every figure, date and record name comes from a {placeholder} (see "placeholders": any path listed there). Never type a digit in prose, and never write a figure in words; the game fills the numbers. Prefer placeholders for names too ({city.name}, {state.ruler.name}, {enemy.name}, {state.gods.0.name}…).
- Every PUBLIC fact is the record's: who ruled and commanded, their sex and age, who won the battle, the outcome on day 4 (scenario.outcome: sacked, conquered, treaty or held), whether the archive burned, the treaty's terms, the famine, plague or drought of the year, the gods and their sexes, the coin. The king or queen is scenario.state.ruler (use the title "state.ruler.title"); the enemy's sovereign is enemy.ruler.
- PRIVATE life is yours: the scribe, their household and neighbours, rumours, weather, smells, the work of the tablet house. Give invented people names from scenario.names (right sex), by placeholder ({names.f.2}).
- Nothing anachronistic: no technology, word or object that did not exist at the date (see context.technology); write on the scenario's medium (clay tablet, papyrus, parchment, paper, typescript) in its script.
- The king wants smaller dead and bigger victories; the real chronicle (scenario.chronicle) shows how this state's own historian bent the war. Its quote and closing words may be quoted only through {chronicle.quote} and {chronicle.outcomeWords}.
- Day 4 must tell the real ending. Endings and the archaeologist judge the player's tablet against the record, never the record itself.`;

function sheet(a: Archive, H: Heraldry, B: BattleExport, p: ScenarioPick) {
  const ctx = a.ctx;
  const s = ctx.s;
  const T = a.T;
  const sc = buildScenario(a, H, B, p);
  const { e, war, D, A } = p;
  const year = e.year;
  const lang = ctx.polityLang(D, year);
  const d = a.gen.doc(lang, year, `scenario:${e.id}`);
  const nm = (ref: string) => d.nameOf(ref).replace(/,? \(?AY [\d–-]+\)?$/, '');
  const t = s.settlements[p.city];
  const who = (x: SimEvent, role: string) => x.parts.find(([, r]) => r === role)?.[0];
  const personAt = (q: Person, y: number) => ({
    id: `per:${q.id}`, name: nm(`per:${q.id}`), editorial: T.short.get(`per:${q.id}`) ?? null, sex: q.sex, born: q.born, died: q.died, deathCause: q.deathCause,
    ageAtDate: y - q.born, aliveAtDate: q.born <= y && q.died >= y, roles: q.roles.map((r) => `${r.role}${r.polity !== null ? ` of ${nm(`pol:${r.polity}`)}` : ''} ${r.start}–${r.end ?? ''}`.trim()),
  });
  // the war's battles, sieges and sacks, in order
  const engagements = (ctx.eventsByRef.get(`evt:${war.id}`) ?? []).map((i) => s.events[i]).filter((x) => x.sub === 'battle' || x.sub === 'siege' || x.sub === 'sack').sort((x, y) => x.year - y.year || x.id - y.id);
  const battles = engagements.map((x) => {
    if (x.sub !== 'battle') return { id: `evt:${x.id}`, kind: x.sub, year: x.year, name: nm(`evt:${x.id}`), city: nm(who(x, 'settlement') ?? ''), thisSiege: x.id === e.id };
    const ours = who(x, 'defender') === `pol:${D.id}`;
    const near = who(x, 'near');
    const cmd = (role: string) => { const r = who(x, role); return r ? { id: r, name: nm(r), sex: s.persons[ctx.idNum(r)].sex, killed: x.data.commanderKilled === ctx.idNum(r) } : null; };
    return {
      id: `evt:${x.id}`, kind: 'battle', year: x.year, name: nm(`evt:${x.id}`), date: plainText(localDate(ctx, d, D, x.year, { day: true, key: `evt:${x.id}` })),
      place: near ? nm(near) : nm(`reg:${x.data.region}`), ours: Number(x.data[ours ? 'defenderSize' : 'attackerSize']), theirs: Number(x.data[ours ? 'attackerSize' : 'defenderSize']),
      oursLost: Number(x.data[ours ? 'defenderLosses' : 'attackerLosses']), theirsLost: Number(x.data[ours ? 'attackerLosses' : 'defenderLosses']),
      won: x.data.winner === D.id, commander: cmd(ours ? 'defending commander' : 'attacking commander'), enemyCommander: cmd(ours ? 'attacking commander' : 'defending commander'),
      thisBattle: x.id === p.battle.id, claims: B.of(x).claims.map((c) => ({ document: c.art, kind: c.kind, side: (c.side === 1) === ours ? 'ours' : 'theirs', oursLost: ours ? c.losses[1] : c.losses[0], theirsLost: ours ? c.losses[0] : c.losses[1] })),
    };
  });
  // how the war ended, even when it came later than the scenario's fourth day
  const tid = war.data.treaty as number | undefined;
  const peace = tid !== undefined ? (() => {
    const x = s.events[tid];
    const terms = (x.data.terms as Term[] | undefined) ?? [];
    return { id: `evt:${x.id}`, kind: x.sub, year: x.year, name: nm(`evt:${x.id}`), yearsAfterSiege: x.year - year, outcome: String(x.data.outcome ?? ''), terms: terms.map((q) => ({ kind: q.kind, from: q.from !== undefined ? nm(`pol:${q.from}`) : null, to: q.to !== undefined ? nm(`pol:${q.to}`) : null, districts: q.cells?.length ?? null, kg: q.amount ?? null, years: q.years ?? null })) };
  })() : null;
  // documents about the moment, the war, its battles and its peace
  const ids = new Set([e.id, war.id, ...engagements.map((x) => x.id), ...(tid !== undefined ? [tid] : [])]);
  const docs = a.artifacts.filter((x) => x.about.some((i) => ids.has(i))).sort((x, y) => x.year - y.year || x.id - y.id).map((x) => ({
    id: `art:${x.id}`, catalog: x.catalog, title: x.title, kind: x.sub, year: x.year, side: x.polity === D.id ? 'ours' : x.polity === A.id ? 'theirs' : 'other',
    author: x.author !== null ? T.short.get(`per:${x.author}`) ?? null : null, flagship: x.flagship, aboutThisSiege: x.about.includes(e.id), medium: x.medium, condition: x.condition,
  }));
  // the city: its people, its names and population through time, its earlier sacks
  const sacks = t.sacks.map((i) => s.events[i]).filter((x) => x.year < year).map((x) => ({ id: `evt:${x.id}`, year: x.year, by: nm(who(x, 'besieger') ?? ''), burnedArchives: !!x.data.burnedArchives }));
  const sieges = (ctx.eventsByRef.get(`set:${t.id}`) ?? []).map((i) => s.events[i]).filter((x) => x.sub === 'siege' && x.year < year).map((x) => ({ id: `evt:${x.id}`, year: x.year, by: nm(who(x, 'besieger') ?? '') }));
  // the sovereign's family at the date
  const king = s.persons[ctx.idNum(sc.state.ruler.id)];
  const family = {
    ruler: personAt(king, year), epithet: T.epithet.get(king.id) ?? null,
    father: king.father !== null ? personAt(s.persons[king.father], year) : null, mother: king.mother !== null ? personAt(s.persons[king.mother], year) : null,
    spouses: king.spouses.map((x) => personAt(s.persons[x], year)), children: king.children.map((x) => personAt(s.persons[x], year)).filter((x) => x.born <= year),
    predecessor: (() => { const rs = ctx.reigns.get(D.id) ?? []; const i = rs.findIndex((r) => r.person === king.id); return i > 0 ? personAt(s.persons[rs[i - 1].person], year) : null; })(),
  };
  const enemyKing = s.persons[ctx.idNum(sc.enemy.ruler.id)];
  // prices at the city's market, decade by decade around the siege (grams of silver), and in the coin
  const goods = ['grain', 'salt', 'cloth', 'oil', 'bronze', 'iron', 'horses'].map((k) => GOODS.find((g) => g.key === k)!).filter(Boolean);
  const prices: Record<string, unknown>[] = [];
  for (let y = Math.floor(year / 10) * 10 - 30; y <= Math.floor(year / 10) * 10 + 30; y += 10) {
    const row: Record<string, unknown> = { decade: y };
    let any = false;
    for (const g of goods) { const v = a.gen.priceIndex.get(`${p.city}:${g.id}:${y}`); if (v !== undefined) { row[`${g.key} (per ${g.unit})`] = v; any = true; } }
    if (any) prices.push(row);
  }
  // what existed: the newest techniques anywhere, the next ones nobody had, and the two states' own
  const first = new Map<number, number>();
  for (const q of s.polities) for (const [k, y] of q.techs) if (y < (first.get(k) ?? Infinity)) first.set(k, y);
  const known = TECHS.filter((x) => (first.get(x.id) ?? Infinity) <= year).sort((x, y) => first.get(y.id)! - first.get(x.id)!).slice(0, 6).map((x) => x.name.toLowerCase());
  const unknown = TECHS.filter((x) => (first.get(x.id) ?? Infinity) > year).sort((x, y) => (first.get(x.id) ?? 9e9) - (first.get(y.id) ?? 9e9)).slice(0, 5).map((x) => x.name.toLowerCase());
  const own = (q: typeof D) => TECHS.filter((x) => techAt(q, x.key, year)).map((x) => x.name.toLowerCase());
  const rel = ctx.religionOf(D.id, year);
  const fm = s.movements[Number(sc.state.faithId.slice(4))];
  const recent = (ctx.eventsByRef.get(`pol:${D.id}`) ?? []).map((i) => s.events[i]).filter((x) => x.year <= year && x.year > year - 30 && x.sig >= 0.2 && T.pageRefs.has(`evt:${x.id}`) && !ids.has(x.id)).slice(-10)
    .map((x) => ({ id: `evt:${x.id}`, year: x.year, kind: x.sub, title: T.title.get(`evt:${x.id}`) ?? '' }));
  const hist = t.names.map(([y, n]) => ({ from: y, name: ctx.name(n, lang, Math.max(y, Math.min(year, 5000))) }));
  return {
    id: sc.id,
    scenario: sc,
    placeholders: placeholders(sc),
    context: {
      register: ['Bronze Age: formulaic, paratactic, invocations of gods, repetition, epithets; no abstractions.', 'Iron Age: formulaic but more narrative; omens, gods, kings, tribute.', 'Classical: rhetorical, civic virtue, measured periods.', 'Medieval: pious, hierarchical, scriptural allusion, feudal obligation.', 'Early modern: learned, argumentative, dated with care.', 'Industrial: official prose, statistics, steam and wire, mass politics.', 'Post-industrial: modern, plain, technical vocabulary, institutions.'][Math.min(6, sc.eraIndex)],
      technology: `Newest known anywhere: ${known.join(', ') || 'none'}. NOT yet invented (never mention them or their products): ${unknown.join(', ') || 'nothing'}.`,
      ourTechnology: own(D), enemyTechnology: own(A),
      editorialNames: { siege: T.title.get(`evt:${e.id}`), city: T.short.get(`set:${t.id}`), state: T.title.get(`pol:${D.id}`), enemy: T.title.get(`pol:${A.id}`), war: T.title.get(`evt:${war.id}`) },
      war: { battles, peace, began: war.year, ended: war.end, outcome: sc.war.outcome },
      city: { people: sc.city.people, peopleId: sc.city.peopleId, founded: t.founded, port: t.port, region: sc.city.region, namesThroughTime: hist, population: t.popHistory.filter(([y]) => y >= year - 300 && y <= year + 200).map(([y, v]) => ({ year: y, pop: Math.round(v) })), popAtDate: popAt(t.popHistory, year), earlierSacks: sacks, earlierSieges: sieges },
      documents: docs,
      family, enemyRuler: personAt(enemyKing, year),
      faith: { name: sc.state.faith, kind: fm.kind, stateFaith: rel >= 0, teaching: tenetText(fm.kind, fm.tenets), gods: sc.state.gods },
      money: { coin: sc.state.coin, gramsOfSilver: sc.state.coinSilver, grainPerMeasure: sc.state.grain, grainInCoin: sc.state.grainCoin, prices },
      recentEvents: recent,
    },
    guidance: GUIDANCE,
  };
}

const r = simulate(seed, 5000);
const a = buildArchive(r);
const H = new Heraldry(r, a, computeEras(r, a));
const B = new BattleExport(a, H);
const picks = pickScenarios(a, scenarioCandidates(a));
mkdirSync(outDir, { recursive: true });
const world = worldFingerprint(r);
for (const p of picks) {
  const x = sheet(a, H, B, p);
  writeFileSync(`${outDir}/${x.id}.json`, JSON.stringify({ world, ...x }, null, 2));
}
console.log(`${picks.length} scenario sheets in ${outDir}: ${picks.map((p) => `sc-${p.e.id} (AY ${p.e.year}, ${p.outcome})`).join(', ')}`);
