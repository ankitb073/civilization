// Trade documents: sailing guides and caravan itineraries along the century's trade routes (distances from the map,
// rulers, prices, merchant houses and the wars of the decade), and customs tariffs computed from market prices.
import type { Gen } from './gen.ts';
import { goodName, goodUnit } from './gen.ts';
import type { Doc } from '../archive/doc.ts';
import { localDate } from '../archive/doc.ts';
import type { Polity, SimEvent } from '../sim/state.ts';
import { Rng } from '../core/rng.ts';
import { GOODS } from '../sim/economy.ts';
import { cap } from '../archive/context.ts';
import { fmtPrice, houseLabel } from './ledger.ts';
import { alive, literate, med, commoner, addDoc } from './genres.ts';
import { titleOf, listJoin } from './treaty.ts';

const GRAIN = GOODS.findIndex((x) => x.key === 'grain');

export function genTrade(g: Gen): void {
  genPeriploi(g);
  genTariffs(g);
}

// ---------------------------------------------------------------- shared
/** The unit of account a document of `p` reckons in: grams of silver per unit, and its (linked) name. */
function reckoning(g: Gen, d: Doc, p: Polity, year: number): { grams: number; unit: string } {
  const ctx = g.ctx;
  const cur = ctx.currencyAt(p.id, year);
  if (cur < 0 || ctx.s.currencies[cur].born > year) return ctx.eraAt(p.id, year) >= 4 ? { grams: 1, unit: 'grams of silver' } : { grams: 8.3, unit: 'shekels of silver' };
  return { grams: ctx.contentAt(cur, year), unit: d.n(`cur:${cur}`) };
}

/** Wars a polity is fighting in a given year. */
function warsAt(g: Gen, pol: number, year: number): { war: SimEvent; enemy: number }[] {
  const s = g.ctx.s;
  const out: { war: SimEvent; enemy: number }[] = [];
  for (const i of g.ctx.eventsByRef.get(`pol:${pol}`) ?? []) {
    const e = s.events[i];
    if (e.sub !== 'war' || e.year > year || e.end < year) continue;
    const side = e.parts.find(([x]) => x === `pol:${pol}`)?.[1];
    const other = e.parts.find(([x, r]) => x.startsWith('pol:') && x !== `pol:${pol}` && (side === 'attacker' ? r === 'defender' : side === 'defender' ? r === 'attacker' : r === 'attacker'));
    if (other) out.push({ war: e, enemy: g.ctx.idNum(other[0]) });
  }
  return out;
}

function goodsAt(g: Gen, settlement: number, year: number): number[] {
  return GOODS.filter((x) => year >= x.from && year <= x.to && g.price(settlement, x.id, year) !== null).map((x) => x.id);
}

// ---------------------------------------------------------------- 1. sailing guides and itineraries
function genPeriploi(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const w = s.world;
  const riverAt = new Map<number, number>();
  w.rivers.forEach((rv, i) => {
    if (s.riverNames[i] === undefined) return;
    for (const c of rv.cells) if (!riverAt.has(c)) riverAt.set(c, i);
  });
  for (const rt of s.routes) {
    const r = new Rng(s.seed).fork('periplus', rt.year);
    for (const mode of ['sea', 'land'] as const) {
      const adj = new Map<number, number[]>();
      for (const [a, b] of rt.edges) {
        const A = s.settlements[a], B = s.settlements[b];
        const sea = A.port && B.port;
        if ((mode === 'sea') !== sea) continue;
        if (mode === 'land' && w.landmass[A.cell] !== w.landmass[B.cell]) continue;
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
      }
      if (adj.size < 5) continue;
      for (let k = 0; k < 3; k++) {
        const rr = r.fork(mode, k);
        if (!rr.chance(0.8)) continue;
        const year = rt.year + rr.int(5, 95);
        if (year >= 5000) continue;
        const open = (x: number) => s.settlements[x].founded <= year && (s.settlements[x].abandoned ?? 9999) > year;
        const starts = [...adj.keys()].sort((a, b) => a - b).filter((x) => {
          const o = ctx.ownerAt(s.settlements[x].cell, year);
          return open(x) && o >= 0 && literate(g, s.polities[o], year) && ctx.eraAt(o, year) >= 1;
        });
        if (!starts.length) continue;
        const path = [rr.pick(starts)];
        const seen = new Set(path);
        const len = rr.int(5, 9);
        while (path.length < len) {
          const next = (adj.get(path[path.length - 1]) ?? []).filter((x) => !seen.has(x) && open(x)).sort((a, b) => a - b);
          if (!next.length) break;
          const n = rr.pick(next);
          path.push(n);
          seen.add(n);
        }
        if (path.length < 4) continue;
        periplus(g, path, mode, year, riverAt, rr);
      }
    }
  }
}

const HARBOURS = [
  'A good harbour, sheltered from the north wind.', 'An open roadstead; ships ride at anchor off the beach.', 'A harbour with a mole; dues are paid at the tower.',
  'A shallow bay; large ships lighten their cargo before they enter.', 'A deep harbour beneath the citadel.', 'Two harbours, one for warships and one for merchants.',
  'The entrance is narrow and a chain is drawn across it at night.', 'Anchor on sand in four fathoms; the bottom holds well.',
];
const HARBOURS_MODERN = [
  'Pilotage is compulsory; the pilot boards at the outer buoy.', 'Coaling station and dry dock; tugs available day and night.', 'Deep-water quays; cranes for heavy cargo.',
  'The bar shifts; vessels of deep draught wait for the tide.', 'Free port: goods in transit are not inspected.', 'Quarantine anchorage outside the breakwater.',
];
const STATIONS = [
  'The station is outside the old walls.', 'Change trains here for the coast.', 'Customs inspection at the frontier station.', 'Sleeping cars are attached here.',
  'The line is single track beyond this point; expect delays.', 'Goods are transhipped here to the narrow gauge.',
];
const STAGES = [
  'There is a well of sweet water at the gate.', 'The caravanserai stands outside the walls.', 'Water and fodder are dear here.', 'The road is paved for the last stage.',
  'A ford must be crossed; in spring it is deep.', 'There is an inn with stabling for a hundred beasts.', 'The road climbs through a pass; hire guides in the town.',
];

interface Units { dist: (km: number) => string; time: (km: number) => string; total: (km: number) => string }

function unitsFor(mode: 'sea' | 'land', era: number, desert: boolean): Units {
  const days = (n: number, what: 'sail' | 'day') => (what === 'sail' ? (n <= 1 ? "a day's sail" : `${n} days' sail`) : n <= 1 ? 'a day' : `${n} days`);
  const round = (x: number, step: number) => Math.max(step, Math.round(x / step) * step);
  if (mode === 'sea') {
    if (era <= 2) return { dist: (km) => `${round(km / 0.185, 50).toLocaleString('en-US')} stadia`, time: (km) => days(Math.max(1, Math.round(km / 110)), 'sail'), total: (km) => `${round(km / 0.185, 50).toLocaleString('en-US')} stadia` };
    if (era <= 4) return { dist: (km) => `${round(km / 5.556, 5)} leagues`, time: (km) => days(Math.max(1, Math.round(km / (era === 3 ? 140 : 200))), 'sail'), total: (km) => `${round(km / 5.556, 5)} leagues` };
    return { dist: (km) => `${round(km / 1.852, 10)} nautical miles`, time: (km) => (km / 28 < 48 ? `${Math.max(1, Math.round(km / 28))} hours by steamer` : `${Math.round(km / 28 / 24)} days by steamer`), total: (km) => `${round(km / 1.852, 10).toLocaleString('en-US')} nautical miles` };
  }
  const beast = desert ? 'camels' : era <= 2 ? 'donkeys' : 'mules';
  if (era <= 2) return { dist: (km) => `${round(km / 10.7, 1)} double-hours`, time: (km) => `${days(Math.max(1, Math.round(km / 30)), 'day')} with laden ${beast}`, total: (km) => `${round(km / 10.7, 1)} double-hours` };
  if (era <= 4) return { dist: (km) => `${round(km / 5.5, 1)} leagues`, time: (km) => `${days(Math.max(1, Math.round(km / (era === 3 ? 35 : 50))), 'day')} ${era === 3 ? `with ${beast}` : 'by coach'}`, total: (km) => `${round(km / 5.5, 1)} leagues` };
  return { dist: (km) => `${round(km, 5)} km`, time: (km) => `${Math.max(1, Math.round(km / 60))} hours by rail`, total: (km) => `${round(km, 5).toLocaleString('en-US')} km` };
}

function periplus(g: Gen, path: number[], mode: 'sea' | 'land', year: number, riverAt: Map<number, number>, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const w = s.world;
  const T = s.settlements;
  const home = s.polities[ctx.ownerAt(T[path[0]].cell, year)];
  const era = ctx.eraAt(home.id, year);
  const d = g.doc(ctx.polityLang(home, year), year, `periplus:${mode}:${path[0]}:${year}`);
  const kmPer = Math.sqrt((w.cellArea * w.n) / (w.width * w.height));
  const legKm = (a: number, b: number) => Math.hypot(w.x[T[a].cell] - w.x[T[b].cell], w.y[T[a].cell] - w.y[T[b].cell]) * kmPer * (mode === 'sea' ? 1.2 : 1.35);
  const desert = path.some((x) => w.biome[T[x].cell] === 8 || w.biome[T[x].cell] === 9);
  const U = unitsFor(mode, era, desert);
  const money = reckoning(g, d, home, year);
  // what is cheap and dear at each stop, against the average along the route
  const avg = new Map<number, number>();
  for (const gd of GOODS) {
    const ps = path.map((x) => g.price(x, gd.id, year)).filter((p): p is number => p !== null);
    if (ps.length >= 3 && year >= gd.from && year <= gd.to) avg.set(gd.id, ps.reduce((a, b) => a + b, 0) / ps.length);
  }
  const pilot = commoner(g, d, ctx.polityCulture(home, year), year, `pilot:${path[0]}:${year}`);
  const lines: string[] = [];
  const intro = mode === 'sea'
    ? (era >= 5 ? `Sailing directions from ${d.n(`set:${path[0]}`)} to ${d.n(`set:${path[path.length - 1]}`)}, compiled for the masters of merchant vessels by ${pilot}, pilot, ${localDate(ctx, d, home, year)}.` : `The coasting voyage from ${d.n(`set:${path[0]}`)} to ${d.n(`set:${path[path.length - 1]}`)}, as the pilot ${pilot} sailed it, written down for the merchants of ${d.n(`set:${path[0]}`)} ${localDate(ctx, d, home, year)}.`)
    : (era >= 5 ? `Route book of the line from ${d.n(`set:${path[0]}`)} to ${d.n(`set:${path[path.length - 1]}`)}, compiled by ${pilot} for travelling agents, ${localDate(ctx, d, home, year)}.` : `The road from ${d.n(`set:${path[0]}`)} to ${d.n(`set:${path[path.length - 1]}`)}, stage by stage, as the caravan master ${pilot} travelled it, ${localDate(ctx, d, home, year)}.`);
  lines.push(intro, '');
  const homeCap = ctx.capitalAt(home, year) === path[0];
  lines.push(`${d.n(`set:${path[0]}`)} ${homeCap ? `is the ${era >= 5 ? 'capital' : 'royal city'} of` : 'belongs to'} ${d.n(`pol:${home.id}`)}. Prices below are given in ${money.unit}.`);
  let total = 0;
  let prevOwner = home.id;
  const wars: number[] = [];
  path.slice(1).forEach((sid, i) => {
    const from = path[i];
    const t = T[sid];
    const km = legKm(from, sid);
    total += km;
    const parts: string[] = [];
    parts.push(`${U.dist(km)}, ${U.time(km)}.`);
    // the place itself
    const rv = riverAt.get(t.cell);
    const fixed = (xs: string[], key: string) => xs[new Rng(s.seed).fork(key, sid).int(0, xs.length - 1)];
    if (mode === 'sea') parts.push(rv !== undefined && d.chance(0.6) ? `${era >= 5 ? 'Berth' : 'Anchor'} in the mouth of the ${d.n(`riv:${rv}`)}.` : era >= 5 ? fixed(HARBOURS_MODERN, 'harbour-m') : fixed(HARBOURS, 'harbour'));
    else parts.push(rv !== undefined && d.chance(0.5) ? `The town stands on the ${d.n(`riv:${rv}`)}.` : era >= 5 ? fixed(STATIONS, 'station') : fixed(STAGES, 'stage'));
    const o = ctx.ownerAt(t.cell, year);
    if (o < 0) parts.push('No king rules here; the elders of the town take the dues.');
    else if (o !== prevOwner) {
      const P = s.polities[o];
      const isCap = ctx.capitalAt(P, year) === sid;
      parts.push(`Here begins the land of ${d.n(`pol:${o}`)}${isCap ? `, and this is its ${era >= 5 ? 'capital' : 'royal city'}` : ''}.`);
    }
    prevOwner = o;
    // trade
    const ranked = [...avg].map(([gd, a]) => [gd, (g.price(sid, gd, year) ?? a) / a] as [number, number]).filter(([gd]) => g.price(sid, gd, year) !== null).sort((x, y) => x[1] - y[1] || x[0] - y[0]);
    const sells = ranked.filter(([, q]) => q < 0.93).slice(0, 2);
    const buys = ranked.filter(([, q]) => q > 1.07).reverse().slice(0, 2);
    const price = (gd: number) => `${fmtPrice(g.price(sid, gd, year)! / money.grams)} the ${goodUnit(gd)}`;
    if (sells.length) parts.push(`${cap(goodName(sells[0][0]))} ${/s$/.test(goodName(sells[0][0])) ? 'are' : 'is'} cheap here (${price(sells[0][0])})${sells[1] ? `, and ${goodName(sells[1][0])}` : ''}.`);
    if (buys.length) parts.push(`${era >= 5 ? 'There is a demand for' : 'They will buy'} ${listJoin(buys.map(([gd]) => goodName(gd)))}${buys.length === 1 ? ` at ${price(buys[0][0])}` : ''}.`);
    const houses = s.houses.filter((h) => h.settlement === sid && h.born <= year && (h.died ?? 9999) > year && h.goods.length).sort((a, b) => b.capital - a.capital);
    if (houses.length && d.chance(0.6)) {
      const h = houses[0];
      parts.push(`${cap(houseLabel(h.kind, d.n(`hou:${h.id}`)))} keeps a ${era >= 5 ? 'branch office' : 'warehouse'} here and deals in ${listJoin(h.goods.slice(0, 2).map((x) => goodName(x)))}.`);
    }
    // hazards of the decade
    const fighting = o >= 0 ? warsAt(g, o, year) : [];
    if (fighting.length && !wars.includes(fighting[0].war.id)) {
      // warn once per war; the next ports of the same coast need no repeat
      const f = fighting[0];
      wars.push(f.war.id);
      parts.push(mode === 'sea'
        ? `Beware: ${d.n(`pol:${o}`)} is at war with ${d.n(`pol:${f.enemy}`)}, and ${era >= 5 ? 'warships stop and search' : 'privateers and pirates take'} merchantmen off this coast.`
        : `Beware: ${d.n(`pol:${o}`)} is at war with ${d.n(`pol:${f.enemy}`)}; the road is watched and caravans are held at the gate.`);
    }
    const sack = t.sacks.map((x) => s.events[x]).filter((e) => e.year <= year && e.year > year - 25).pop();
    if (sack) {
      const by = sack.parts.find(([, x]) => x === 'besieger')?.[0];
      parts.push(`The city was sacked${by ? ` by ${d.n(by)}` : ''} ${year - sack.year <= 1 ? 'last year' : `${year - sack.year} years ago`}, and the ${mode === 'sea' ? 'quays are' : 'walls are'} not yet repaired.`);
    }
    const plague = (ctx.eventsByRef.get(`set:${sid}`) ?? []).map((x) => s.events[x]).find((e) => e.sub === 'plague' && e.year <= year && e.end >= year - 3);
    if (plague) parts.push(`There is pestilence in the town; ${mode === 'sea' ? 'ships are held at anchor for forty days' : 'travellers are turned away at the gate'}.`);
    lines.push('', `**${i + 1}. To ${d.n(`set:${sid}`)}.** ${parts.join(' ')}`);
  });
  lines.push('', `In all, ${U.total(total)} from ${d.n(`set:${path[0]}`)} to ${d.n(`set:${path[path.length - 1]}`)}. ${mode === 'sea' ? d.pick(['Keep the land on the right hand going out, and on the left coming home.', 'Sail in the summer months; in winter the coast is closed.', 'Water the ship at every second harbour.']) : d.pick(['Travel in the cool months; in summer the wells fail.', 'Pay the guards at every frontier and keep the receipts.', 'Do not travel the last stage after dark.'])}`);
  const warNote = wars.length ? ` Wars on the route that year: ${listJoin(wars.map((x) => d.title(`evt:${x}`)))}.` : '';
  lines.push('', '---', '', `**Editorial note.** Distances are measured on the atlas map between the ports of the route network for AY ${Math.floor(year / 100) * 100}, with an allowance for the ${mode === 'sea' ? 'coastwise course' : 'windings of the road'}, and converted to ${era <= 2 ? (mode === 'sea' ? 'stadia of 185 m and a day\'s sail of about 110 km' : 'double-hours of about 10.7 km and a caravan day of about 30 km') : mode === 'sea' ? (era <= 4 ? 'sea leagues of 5.56 km' : 'nautical miles') : era <= 4 ? 'leagues of 5.5 km' : 'kilometres'}. Rulers, prices, merchant houses and hazards agree with the record for AY ${year}.${warNote}`);
  const m = era >= 4 ? med(era, 'print', r) : med(era, 'soft', r);
  const title = mode === 'sea'
    ? `${era >= 5 ? 'Sailing directions' : 'Periplus'} from ${g.T.short.get(`set:${path[0]}`)} to ${g.T.short.get(`set:${path[path.length - 1]}`)} (AY ${year})`
    : `${era >= 5 ? 'Route book' : 'Itinerary'} from ${g.T.short.get(`set:${path[0]}`)} to ${g.T.short.get(`set:${path[path.length - 1]}`)} (AY ${year})`;
  addDoc(g, { sub: 'periplus', year, title, author: null, p: home, d, body: lines, settlement: path[0], about: [], m });
}

// ---------------------------------------------------------------- 2. customs tariffs
function genTariffs(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const P of s.polities) {
    const r0 = new Rng(s.seed).fork('tariff', P.id);
    const last = Math.min(P.died ?? 5000, 5000);
    for (let y = Math.ceil((P.born + 20) / 100) * 100; y < last; y += 100) {
      const r = r0.fork(y);
      if (!r.chance(0.25)) continue;
      const year = Math.min(last - 1, y + r.int(0, 99));
      if (!alive(P, year) || !literate(g, P, year) || ctx.eraAt(P.id, year) < 2) continue;
      tariff(g, P, year, r);
    }
  }
}

function tariff(g: Gen, P: Polity, year: number, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const era = ctx.eraAt(P.id, year);
  // the busiest port of the realm, else the market at the capital's gate
  const ports = s.settlements.filter((t) => t.port && t.founded <= year && (t.abandoned ?? 9999) > year && ctx.ownerAt(t.cell, year) === P.id);
  const pop = (t: (typeof s.settlements)[number]) => t.popHistory.filter(([y]) => y <= year).pop()?.[1] ?? 0;
  const port = ports.sort((a, b) => pop(b) - pop(a) || a.id - b.id)[0];
  const place = port ? port.id : ctx.capitalAt(P, year);
  const goods = goodsAt(g, place, year);
  if (goods.length < 5) return;
  const d = g.doc(ctx.polityLang(P, year), year, `tariff:${P.id}:${year}`);
  const money = reckoning(g, d, P, year);
  const wars = warsAt(g, P.id, year);
  const famine = (ctx.eventsByRef.get(`pol:${P.id}`) ?? []).map((i) => s.events[i]).find((e) => e.sub === 'famine' && e.year <= year && e.year >= year - 10);
  const base = era <= 3 ? r.pick([0.1, 0.1, 0.05]) : era === 4 ? r.pick([0.05, 0.075, 0.1, 0.125]) : r.pick([0.08, 0.1, 0.12, 0.15]);
  const surcharge = wars.length ? 1.5 : 1;
  const frac = (x: number) => {
    const table: [number, string][] = [[0.025, 'one part in forty'], [0.05, 'one part in twenty'], [0.075, 'three parts in forty'], [0.1, 'one part in ten'], [0.125, 'one part in eight'], [0.15, 'three parts in twenty'], [0.2, 'one part in five'], [0.25, 'one part in four'], [0.3, 'three parts in ten']];
    if (era >= 4) return `${Math.round(x * 1000) / 10}%`;
    return table.find(([v]) => Math.abs(v - x) < 0.006)?.[1] ?? `${Math.round(x * 100)} in the hundred`;
  };
  const contraband = new Set<number>();
  if (wars.length) for (const k of ['horses', 'iron', 'bronze', 'timber', 'steel', 'petroleum', 'machinery']) {
    const gd = GOODS.find((x) => x.key === k)!;
    if (year >= gd.from && year <= gd.to) contraband.add(gd.id);
  }
  const monopoly = era <= 3 && r.chance(0.3) ? GOODS.find((x) => x.key === 'salt')!.id : -1;
  const rows: string[] = [];
  const notes: string[] = [];
  for (const gd of goods) {
    const key = GOODS[gd].key;
    let rate = base;
    let why = '';
    let fixed = false;
    if (key === 'grain') { rate = famine ? 0 : era <= 3 ? 0.025 : base / 2; fixed = true; why = famine ? 'free while the famine lasts' : 'reduced, that bread be cheap'; }
    else if (key === 'gold') { rate = 0; why = 'free, that the treasury may grow'; }
    else if (key === 'spice') { rate = era <= 3 ? 0.2 : base * 2; why = 'a luxury'; }
    else if (era >= 5 && (key === 'machinery' || key === 'steel' || key === 'cloth')) { rate = base * 2; why = 'protective duty'; }
    else if (era >= 5 && (key === 'coal' || key === 'petroleum')) { rate = base / 2; why = 'reduced, for industry'; }
    if (gd === monopoly) {
      rows.push(`| ${cap(goodName(gd))} | ${goodUnit(gd)} | ${fmtPrice(g.price(place, gd, year)! / money.grams)} | — | royal monopoly |`);
      continue;
    }
    if (!fixed) rate = Math.min(0.5, rate * surcharge);
    const value = g.price(place, gd, year)! / money.grams;
    rows.push(`| ${cap(goodName(gd))} | ${goodUnit(gd)} | ${fmtPrice(value)} | ${rate === 0 ? 'free' : fmtPrice(value * rate)} | ${rate === 0 ? why : `${frac(rate)}${why ? `; ${why}` : ''}`} |`);
  }
  // preamble
  const reign = ctx.rulerAt(P.id, year);
  const ruler = reign ? s.persons[reign.person] : null;
  const byRuler = !!ruler && ruler.born + 16 <= year && ruler.died >= year;
  const author = byRuler ? ruler!.id : g.author(P, 'scribe', year).id;
  const gov = ctx.govAt(P, year);
  const lord = byRuler ? titleOf(gov, era, ruler!.sex === 'f') : 'treasury';
  const where = port ? `the harbour of ${d.n(`set:${place}`)}` : `the gates and market of ${d.n(`set:${place}`)}`;
  const lines: string[] = [];
  if (era <= 3) {
    lines.push(byRuler
      ? `Thus decrees ${d.n(`per:${author}`)}, ${titleOf(gov, era, ruler!.sex === 'f')} of ${d.n(`pol:${P.id}`)}: these are the dues of ${where}, which every merchant shall pay to the collectors of the ${lord} before his goods are ${port ? 'landed' : 'brought in'}.`
      : `The treasury of ${d.n(`pol:${P.id}`)} sets these dues at ${where}, to be paid by every merchant before his goods are ${port ? 'landed' : 'brought in'}.`);
  } else if (era === 4) {
    lines.push(`${byRuler ? `By ${d.n(`per:${author}`)}, ${titleOf(gov, era, ruler!.sex === 'f')} of ${d.n(`pol:${P.id}`)}.` : `By the Council of the Treasury of ${d.n(`pol:${P.id}`)}.`} A book of the rates of customs to be taken at ${where}, upon all goods ${port ? 'imported or exported by sea' : 'entering or leaving the city'}, valued at the current prices of the market.`);
  } else {
    lines.push(`Customs tariff of ${d.n(`pol:${P.id}`)}, in force at ${where} from ${localDate(ctx, d, P, year)}. Duties are levied ad valorem on the declared value, checked against the market prices of the port.`);
  }
  lines.push('', `Values and dues in ${money.unit}.`, '', `| Goods | Unit | Value | Due | Rate |`, '|---|---|---|---|---|', ...rows, '');
  notes.push(`Goods not named pay ${frac(Math.min(0.5, base * surcharge))} of their value.`);
  if (monopoly >= 0) notes.push(`Salt is sold only at the storehouse of the ${lord}; whoever brings it in pays with the whole cargo.`);
  if (wars.length) {
    const enemies = [...new Set(wars.map((x) => x.enemy))];
    notes.push(`For as long as the war with ${listJoin(enemies.map((x) => d.n(`pol:${x}`)))} lasts, every due but that on grain is raised by half.`);
    if (contraband.size) notes.push(`No one shall carry ${listJoin([...contraband].map((x) => goodName(x)))} ${era >= 5 ? 'to the enemy or to neutral ports for his account' : 'out of the realm'}; the goods are forfeit and the ${era >= 5 ? 'shipper fined' : 'carrier flogged'}.`);
    notes.push(era >= 5 ? `Goods of enemy origin are prohibited and will be seized.` : `Merchants of ${listJoin(enemies.map((x) => d.n(`pol:${x}`)))} shall not ${port ? 'enter the harbour' : 'pass the gate'}; their goods are forfeit to the ${era <= 3 ? lord : 'treasury'}.`);
  }
  if (famine) notes.push(`Because of the ${d.n(`evt:${famine.id}`)}, grain enters free until the granaries are full.`);
  if (era <= 3) notes.push(d.pick(['Whoever hides goods from the collectors shall pay the due fourfold.', 'Whoever bribes a collector shall lose his hand.', 'The collectors shall give a sealed receipt for every due.']));
  else notes.push(d.pick(['False declarations are punished by confiscation.', 'Receipts shall be given for every payment.', 'Goods in transit pay one tenth of the rate.']));
  lines.push(...notes.map((n, i) => `${i + 1}. ${n}`));
  lines.push('', era <= 3 ? `Given ${localDate(ctx, d, P, year)}. Let it be written on the gate of the customs house.` : era === 4 ? `Given at ${d.n(`set:${ctx.capitalAt(P, year)}`)}, ${localDate(ctx, d, P, year)}. Printed by authority.` : `By order of the government.`);
  const warNote = wars.length ? ` In AY ${year} ${g.T.short.get(`pol:${P.id}`)} was fighting the ${listJoin(wars.map((x) => d.title(`evt:${x.war.id}`)))}, hence the surcharge and the embargo.` : '';
  lines.push('', '---', '', `**Editorial note.** Values are the market prices of ${d.ed(`set:${place}`)} for the decade in the record, converted at the silver content of the ${money.unit === 'shekels of silver' ? 'shekel' : money.unit === 'grams of silver' ? 'reckoning' : 'currency'} that year; dues are computed at the stated rates.${warNote}`);
  addDoc(g, {
    sub: 'tariff', year, title: `Customs tariff of ${g.T.short.get(`set:${place}`)} (AY ${year})`, author, p: P, d, body: lines, settlement: place, about: wars.map((x) => x.war.id).slice(0, 2),
    m: med(era, era >= 4 ? 'print' : era <= 2 ? 'stone' : 'soft', r),
  });
}
