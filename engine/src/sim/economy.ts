// Economy: trade routes, contacts, currencies (weight standards → coins → paper → fiat), debasement,
// prices per market, merchant houses, loans, defaults, bankruptcies, panics, trade collapses.
import type { State, Polity, Currency, House } from './state.ts';
import { event, ref, alivePolity, addStress, topStress } from './state.ts';
import { has, eraOf, seaRange, TK } from './tech.ts';
import { RES } from '../world/biomes.ts';
import { newPerson, yearEra, rulerAt } from './people.ts';
import { atWar } from './war.ts';
import type { PolityAgg } from './polities.ts';
import { Rng } from '../core/rng.ts';

export interface Good { id: number; key: string; name: string; unit: string; base: number; from: number; to: number; res?: number }

// base: grams of silver per unit at the start of the archive
export const GOODS: Good[] = [
  { id: 0, key: 'grain', name: 'grain', unit: 'measure', base: 8, from: -9999, to: 9999 },
  { id: 1, key: 'salt', name: 'salt', unit: 'measure', base: 14, from: -9999, to: 9999, res: RES.salt },
  { id: 2, key: 'copper', name: 'copper', unit: 'mina', base: 4, from: -9999, to: 4800, res: RES.copper },
  { id: 3, key: 'tin', name: 'tin', unit: 'mina', base: 28, from: -9999, to: 3600, res: RES.tin },
  { id: 4, key: 'bronze', name: 'bronze', unit: 'mina', base: 7, from: -9999, to: 3600 },
  { id: 5, key: 'iron', name: 'iron', unit: 'mina', base: 12, from: 1500, to: 4800, res: RES.iron },
  { id: 6, key: 'cloth', name: 'woollen cloth', unit: 'bolt', base: 9, from: -9999, to: 9999 },
  { id: 7, key: 'timber', name: 'timber', unit: 'beam', base: 3, from: -9999, to: 9999, res: RES.timber },
  { id: 8, key: 'horses', name: 'horses', unit: 'head', base: 260, from: -9999, to: 4900, res: RES.horses },
  { id: 9, key: 'spice', name: 'spices', unit: 'mina', base: 45, from: -9999, to: 9999, res: RES.spice },
  { id: 10, key: 'oil', name: 'olive oil', unit: 'jar', base: 6, from: -9999, to: 4800 },
  { id: 11, key: 'gold', name: 'gold', unit: 'mina', base: 4500, from: -9999, to: 9999, res: RES.gold },
  { id: 12, key: 'coal', name: 'coal', unit: 'ton', base: 40, from: 4700, to: 9999, res: RES.coal },
  { id: 13, key: 'steel', name: 'steel', unit: 'ton', base: 900, from: 4780, to: 9999 },
  { id: 14, key: 'petroleum', name: 'petroleum', unit: 'barrel', base: 25, from: 4880, to: 9999, res: RES.oil },
  { id: 15, key: 'machinery', name: 'machine tools', unit: 'set', base: 3000, from: 4800, to: 9999 },
];

export interface EconMemory {
  volumeHistory: Map<number, number[]>; // landmass -> recent volumes
  lastCollapse: Map<number, number>;
  priceBuf: number[]; // flat [year, settlement, good, price]
  hopsToTin: Map<number, number>;
}

export function initEcon(): EconMemory {
  return { volumeHistory: new Map(), lastCollapse: new Map(), priceBuf: [], hopsToTin: new Map() };
}

/** Recompute routes and return polity contact sets (borders + routes). */
export function routesStep(s: State, agg: PolityAgg, y0: number): Map<number, Set<number>> {
  const w = s.world;
  const live = s.settlements.filter((t) => t.abandoned === null && t.founded <= y0 && t.pop >= 2500);
  const edges: [number, number, number][] = [];
  const seen = new Set<number>();
  const hostile = (a: number, b: number) => {
    if (a < 0 || b < 0 || a === b) return false;
    return s.wars.some((x) => x.ended === null && ((x.attackers.includes(a) && x.defenders.includes(b)) || (x.attackers.includes(b) && x.defenders.includes(a))));
  };
  for (const t of live) {
    const o = s.owner[t.cell];
    const P = o >= 0 ? s.polities[o] : null;
    const sea = P ? seaRange(P) : 120;
    const cands: [number, number][] = [];
    for (const u of live) {
      if (u.id === t.id) continue;
      const d = Math.hypot(w.x[t.cell] - w.x[u.cell], w.y[t.cell] - w.y[u.cell]);
      const sameLand = w.landmass[t.cell] === w.landmass[u.cell];
      if (sameLand && d < 190) cands.push([u.id, d * (1 + terrainPenalty(s, t.cell, u.cell))]);
      else if (t.port && u.port && d < sea) cands.push([u.id, d * 0.6]);
    }
    cands.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [uid, cost] of cands.slice(0, 4)) {
      const key = t.id < uid ? t.id * 100000 + uid : uid * 100000 + t.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const u = s.settlements[uid];
      if (hostile(s.owner[t.cell], s.owner[u.cell])) continue;
      const vol = Math.sqrt(t.pop * u.pop) / Math.max(20, cost);
      edges.push([t.id, uid, vol]);
    }
  }
  const maxV = edges.reduce((m, e) => Math.max(m, e[2]), 1);
  s.activeRoutes = edges.map(([a, b, v]) => [a, b, Math.round((v / maxV) * 1000) / 1000]);
  if (y0 % 100 === 0) s.routes.push({ year: y0, edges: s.activeRoutes.slice() });
  // contacts
  const contacts = new Map<number, Set<number>>();
  const add = (a: number, b: number) => {
    if (a < 0 || b < 0 || a === b) return;
    if (!contacts.has(a)) contacts.set(a, new Set());
    if (!contacts.has(b)) contacts.set(b, new Set());
    contacts.get(a)!.add(b);
    contacts.get(b)!.add(a);
  };
  for (const [a, nb] of agg.borders) for (const b of nb.keys()) add(a, b);
  for (const [a, b] of s.activeRoutes) add(s.owner[s.settlements[a].cell], s.owner[s.settlements[b].cell]);
  return contacts;
}

function terrainPenalty(s: State, a: number, b: number): number {
  const w = s.world;
  // sample three points along the segment
  let pen = 0;
  for (const f of [0.25, 0.5, 0.75]) {
    const x = w.x[a] + (w.x[b] - w.x[a]) * f;
    const y = w.y[a] + (w.y[b] - w.y[a]) * f;
    // nearest of the two endpoints' neighbours is good enough for a penalty
    const c = Math.abs(x - w.x[a]) + Math.abs(y - w.y[a]) < Math.abs(x - w.x[b]) + Math.abs(y - w.y[b]) ? a : b;
    pen += Math.max(0, w.elev[c] - 0.3) * 2;
  }
  return pen;
}

/** The techs a currency needs by its issue date. */
const NEEDS: Partial<Record<Currency['kind'], string[]>> = { coin: ['coinage'], paper: ['banking', 'printing'] };

/** A currency cannot be issued before its polity knows how to make it. A tech that spread to the polity in
 *  the current decade carries only a nominal date inside it, so that date moves back to the issue; an
 *  invention keeps its recorded date and the issue waits for it. */
function issueYear(s: State, p: Polity, kind: Currency['kind'], year: number): number {
  for (const key of NEEDS[kind] ?? []) {
    const t = p.techs.get(TK[key]);
    if (t === undefined || t <= year) continue;
    let invented = false;
    for (let i = s.events.length - 1; i >= 0 && s.events[i].year >= t - 10; i--) {
      const e = s.events[i];
      if (e.sub === 'invention' && e.data.tech === TK[key] && e.parts[0][0] === ref('pol', p.id)) { invented = true; break; }
    }
    if (invented) year = t;
    else p.techs.set(TK[key], year);
  }
  return year;
}

export function newCurrency(s: State, p: Polity, kind: Currency['kind'], year: number, content: number, metal: Currency['metal'], sub: string, causes: number[] = [], parent?: Currency): Currency {
  year = issueYear(s, p, kind, year);
  const id = s.currencies.length;
  const lang = s.cultures[p.culture].lang;
  const nameId = s.lang.coinName(lang, year, 'currency', `cur:${id}`);
  const parts: [string, string][] = [[ref('cur', id), 'currency'], [ref('pol', p.id), 'issuer']];
  if (parent) parts.push([ref('cur', parent.id), 'replaces']);
  const ruler = rulerAt(s, p, year);
  if (ruler !== null) parts.push([ref('per', ruler), 'ruler']);
  const fixed = causes.filter((c) => s.events[c].year <= year);
  const ev = event(s, sub, year, { cell: s.settlements[p.capital].cell, parts, causes: fixed, data: { kind, content, metal }, sig: sub === 'coinage' ? 0.3 : sub === 'currency-reform' ? 0.3 : 0.06 });
  const c: Currency = { id, nameId, polity: p.id, kind, metal, born: year, died: null, content, history: [[year, content]], event: ev.id };
  s.currencies.push(c);
  if (p.currency >= 0 && s.currencies[p.currency].polity === p.id) s.currencies[p.currency].died = year;
  p.currency = id;
  return c;
}

/** Decadal: currencies, debasement, inflation. */
export function currencyStep(s: State, y0: number): void {
  const rng = s.rng.fork('currency', y0);
  // runs after the decade's political year loop: states that ended during it issue nothing, and one born
  // during it issues nothing before its birth
  for (const p of s.polities) {
    if (p.died !== null || p.born > y0 + 9 || p.kind === 'rebel') continue;
    const era = eraOf(p);
    const cur = p.currency >= 0 ? s.currencies[p.currency] : null;
    const year = y0 + rng.int(Math.max(0, p.born - y0), 9);
    if (!cur) {
      if (!has(p, 'writing')) continue;
      // adopt predecessor's currency if it still circulates, else a weight standard
      const pred = p.predecessor !== null ? s.polities[p.predecessor] : null;
      if (pred && pred.currency >= 0 && rng.chance(0.6)) { p.currency = pred.currency; continue; }
      if (has(p, 'coinage')) newCurrency(s, p, 'coin', year, round1(3 + rng.next() * 12), rng.chance(0.85) ? 'silver' : 'gold', 'coinage');
      else newCurrency(s, p, 'weight', year, round1(7.5 + rng.next() * 3.5), 'silver', 'weight-standard');
      continue;
    }
    const own = cur.polity === p.id;
    if (has(p, 'coinage') && cur.kind === 'weight' && rng.chance(0.3)) {
      newCurrency(s, p, 'coin', year, round1(3 + rng.next() * 12), rng.chance(0.85) ? 'silver' : 'gold', 'coinage', [], cur);
      continue;
    }
    if (!own && rng.chance(0.15) && has(p, 'writing')) {
      newCurrency(s, p, has(p, 'coinage') ? 'coin' : 'weight', year, round1(has(p, 'coinage') ? 3 + rng.next() * 12 : 7.5 + rng.next() * 3.5), 'silver', has(p, 'coinage') ? 'coinage' : 'weight-standard', [], cur);
      continue;
    }
    if (!own) continue;
    if (has(p, 'banking') && has(p, 'printing') && cur.kind === 'coin' && era >= 4 && rng.chance(0.06)) {
      newCurrency(s, p, 'paper', year, cur.content, 'none', 'paper-money', [], cur);
      continue;
    }
    if (era >= 5 && cur.kind !== 'fiat' && rng.chance(0.12)) {
      newCurrency(s, p, 'fiat', year, round3(cur.content), 'none', 'currency-reform', [], cur);
      continue;
    }
    // debasement / inflation
    if (cur.kind === 'coin' && p.treasury < 0 && rng.chance(0.45)) {
      const wars = atWar(s, p.id).map((w) => w.event);
      const causes = [...wars, ...topStress(p, year, 30, 2)].filter((c) => s.events[c].year <= year);
      const factor = 0.62 + rng.next() * 0.3;
      const before = cur.content;
      cur.content = round3(cur.content * factor);
      cur.history.push([year, cur.content]);
      const ev = event(s, 'debasement', year, { cell: s.settlements[p.capital].cell, parts: [[ref('cur', cur.id), 'currency'], [ref('pol', p.id), 'issuer']], causes, data: { before, after: cur.content }, sig: factor < 0.75 ? 0.35 : 0.18 });
      p.treasury += Math.abs(p.treasury) * 0.7 + p.pop * 0.001;
      p.stability = Math.max(0, p.stability - 0.04);
      addStress(p, year, ev.id, 0.6);
    } else if (cur.kind === 'paper' || cur.kind === 'fiat') {
      let infl = cur.kind === 'fiat' ? 0.012 + rng.next() * 0.02 : 0.004;
      if (p.treasury < 0) infl += 0.02;
      if (p.stability < 0.15 && cur.kind === 'fiat' && rng.chance(0.2)) {
        const before = cur.content;
        cur.content = cur.content / (8 + rng.next() * 400);
        cur.history.push([year, round6(cur.content)]);
        const causes = topStress(p, year, 30, 3).filter((c) => s.events[c].year <= year);
        const ev = event(s, 'hyperinflation', year, { cell: s.settlements[p.capital].cell, parts: [[ref('cur', cur.id), 'currency'], [ref('pol', p.id), 'issuer']], causes, data: { before, after: cur.content }, sig: 0.45 });
        addStress(p, year, ev.id, 1.5);
        p.stability = Math.max(0, p.stability - 0.1);
        p.treasury = Math.max(p.treasury, 0);
        // a money worth less than a hundredth of a gram is replaced by a new one, a thousand (or a million) old units to one
        if (cur.content < 0.01) {
          let k = 1;
          while (cur.content * k < 0.5) k *= 1000;
          newCurrency(s, p, 'fiat', year, round3(cur.content * k), 'none', 'currency-reform', [ev.id], cur);
        }
      } else {
        cur.content = cur.content * Math.pow(1 - infl, 10);
        cur.history.push([y0 + 9, round6(cur.content)]);
        if (cur.content < 0.01) newCurrency(s, p, 'fiat', y0 + 9, round3(cur.content * 1000), 'none', 'currency-reform', [], cur);
      }
    }
  }
  // currencies no longer used by anyone fall out of circulation
  const used = new Set<number>();
  for (const p of s.polities) if (p.died === null && p.currency >= 0) used.add(p.currency);
  for (const c of s.currencies) if (c.died === null && !used.has(c.id)) c.died = y0 + 9;
}

/** Decadal market prices (grams of silver per unit) for significant markets. */
export function priceStep(s: State, mem: EconMemory, y0: number): void {
  const w = s.world;
  const rng = s.rng.fork('prices', y0);
  const markets = s.settlements.filter((t) => t.abandoned === null && t.founded <= y0 && t.pop >= 9000);
  // route graph
  const adj = new Map<number, number[]>();
  for (const [a, b] of s.activeRoutes) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const live = s.settlements.filter((t) => t.abandoned === null && t.founded <= y0);
  const producesRes = (t: { cell: number }, res: number) => {
    if (s.world.resources[t.cell] & res) return true;
    for (const k of w.neighbors[t.cell]) if (w.resources[k] & res) return true;
    return false;
  };
  const hops = new Map<number, Map<number, number>>(); // good -> settlement -> hops
  for (const g of GOODS) {
    if (g.res === undefined) continue;
    const dist = new Map<number, number>();
    let frontier: number[] = [];
    for (const t of live) if (producesRes(t, g.res)) { dist.set(t.id, 0); frontier.push(t.id); }
    for (let h = 1; h <= 8 && frontier.length; h++) {
      const next: number[] = [];
      for (const f of frontier) for (const k of adj.get(f) ?? []) if (!dist.has(k)) { dist.set(k, h); next.push(k); }
      frontier = next;
    }
    hops.set(g.id, dist);
  }
  mem.hopsToTin = hops.get(3) ?? new Map();
  // global price level from silver stock vs population
  let totalPop = 0;
  for (let i = 0; i < w.n; i++) totalPop += s.pop[i];
  const level = Math.pow(s.silverStock / Math.max(1, totalPop * 0.02), 0.45);
  for (const t of markets) {
    const o = s.owner[t.cell];
    const P = o >= 0 ? s.polities[o] : null;
    const war = P && atWar(s, P.id).length > 0 ? 1.25 : 1;
    let hy = s.yieldF[t.cell];
    let n = 1;
    for (const k of w.neighbors[t.cell]) if (w.land[k]) { hy += s.yieldF[k]; n++; }
    hy /= n;
    for (const g of GOODS) {
      if (y0 < g.from || y0 > g.to) continue;
      let p = g.base * level;
      if (g.key === 'grain') p *= Math.pow(1 / Math.max(0.35, hy), 1.6) * (1 + 0.6 * s.devast[t.cell]);
      if (g.res !== undefined) {
        const h = hops.get(g.id)!.get(t.id);
        p *= h === undefined ? 3.2 : 0.8 + 0.22 * h;
      }
      if (g.key === 'bronze') {
        const h = hops.get(3)!.get(t.id);
        p *= h === undefined ? 2.4 : 0.9 + 0.12 * h;
      }
      if (g.key === 'iron' && y0 > 2200) p *= Math.max(0.15, 1 - (y0 - 2200) / 2600);
      if (g.key === 'steel' || g.key === 'machinery') p *= Math.max(0.3, 1 - (y0 - 4780) / 500);
      if (g.key === 'cloth' && y0 > 4760) p *= Math.max(0.25, 1 - (y0 - 4760) / 300);
      p *= war * (1 + rng.normal(0, 0.05));
      mem.priceBuf.push(y0, t.id, g.id, Math.round(p * 1000) / 1000);
    }
  }
  // silver stock: mines in owned territory add, wear removes
  let mined = 0;
  for (let i = 0; i < w.n; i++) if ((w.resources[i] & RES.silver) && s.owner[i] >= 0) mined += 1 + (has(s.polities[s.owner[i]], 'gunpowder') ? 3 : 0);
  s.silverStock = s.silverStock * 0.985 + mined * 2500;
}

/** Decadal merchant houses: founding, heads, loans, defaults, bankruptcies, panics. */
export function housesStep(s: State, agg: PolityAgg, mem: EconMemory, y0: number): void {
  const rng = s.rng.fork('houses', y0);
  const degree = new Map<number, number>();
  for (const [a, b, v] of s.activeRoutes) {
    degree.set(a, (degree.get(a) ?? 0) + v);
    degree.set(b, (degree.get(b) ?? 0) + v);
  }
  // founding
  for (const t of s.settlements) {
    if (t.abandoned !== null || t.founded > y0 || t.pop < 9000) continue;
    const o = s.owner[t.cell];
    if (o < 0) continue;
    const P = s.polities[o];
    if (!has(P, 'writing')) continue;
    const d = degree.get(t.id) ?? 0;
    if (d < 0.05) continue;
    const existing = s.houses.filter((h) => h.died === null && h.settlement === t.id).length;
    if (existing >= 3) continue;
    if (!rng.chance(Math.min(0.05, 0.004 + d * 0.035))) continue;
    const year = y0 + rng.int(0, 9);
    const culture = s.culture[t.cell] >= 0 ? s.culture[t.cell] : P.culture;
    const founder = newPerson(s, { sex: rng.chance(0.1) ? 'f' : 'm', born: year - rng.int(25, 45), culture, polity: o, key: `merchant:${t.id}:${year}`, adult: true, minDeath: year + 1 });
    const id = s.houses.length;
    const nameId = s.lang.coinName(s.cultures[culture].lang, year, 'house', `hou:${id}`);
    const era = eraOf(P);
    const kind: House['kind'] = era >= 5 ? 'corporation' : has(P, 'jointstock') && rng.chance(0.5) ? 'company' : has(P, 'banking') && rng.chance(0.4) ? 'bank' : 'house';
    const goods = pickGoods(s, t.cell, year, rng);
    const partners = s.activeRoutes.filter(([a, b]) => a === t.id || b === t.id).map(([a, b]) => (a === t.id ? b : a));
    const ev = event(s, 'house-founding', year, { cell: t.cell, parts: [[ref('hou', id), 'house'], [ref('per', founder.id), 'founder'], [ref('set', t.id), 'seat'], [ref('pol', o), 'polity']], data: { kind }, sig: 0.1 });
    const h: House = { id, nameId, founder: founder.id, heads: [[year, founder.id]], settlement: t.id, born: year, died: null, foundEvent: ev.id, endEvent: null, goods, capital: 20 + rng.next() * 80, partners, loans: [], kind };
    founder.roles.push({ role: 'merchant', polity: o, start: year, end: null, event: ev.id, ref: ref('hou', id) });
    s.houses.push(h);
  }
  // lifecycle
  const failures: { house: House; event: number }[] = [];
  for (const h of s.houses) {
    if (h.died !== null || h.born > y0) continue;
    const t = s.settlements[h.settlement];
    const o = s.owner[t.cell];
    const P = o >= 0 ? s.polities[o] : null;
    h.partners = s.activeRoutes.filter(([a, b]) => a === h.settlement || b === h.settlement).map(([a, b]) => (a === h.settlement ? b : a));
    const vol = degree.get(h.settlement) ?? 0;
    h.capital *= 1 + (vol - 0.05) * 0.8 + rng.normal(0.02, 0.06);
    // heads
    const [, head] = h.heads[h.heads.length - 1];
    const hp = s.persons[head];
    if (hp.died <= y0 + 9) {
      const year = Math.max(hp.died, y0);
      if (year <= y0 + 9 && rng.chance(Math.max(0.3, 0.8 - (year - h.born) / 400))) {
        const heir = newPerson(s, { sex: rng.chance(0.12) ? 'f' : 'm', born: year - rng.int(22, 40), culture: hp.culture, polity: o >= 0 ? o : null, key: `head:${h.id}:${year}`, adult: true, minDeath: year + 1, father: rng.chance(0.7) ? hp.id : null });
        if (heir.father !== null) hp.children.push(heir.id);
        heir.roles.push({ role: 'merchant', polity: o >= 0 ? o : null, start: year, end: null, event: null, ref: ref('hou', h.id) });
        h.heads.push([year, heir.id]);
      } else {
        endHouse(s, h, Math.min(y0 + 9, Math.max(year, y0)), 'dissolution', []);
        continue;
      }
    }
    // lending to the crown
    if (P && P.treasury < 0 && h.capital > 60 && (h.kind === 'bank' || h.kind === 'company' || rng.chance(0.3)) && rng.chance(0.25)) {
      const amount = Math.min(h.capital * 0.6, -P.treasury);
      h.loans.push({ polity: P.id, amount, year: y0 });
      h.capital -= amount * 0.2;
      P.treasury += amount;
      P.debt += amount;
    }
    // defaults
    for (const loan of h.loans.slice()) {
      const debtor = s.polities[loan.polity];
      const dead = debtor.died !== null && debtor.died <= y0 + 9;
      if (dead || (debtor.treasury < -debtor.pop * 0.01 && rng.chance(0.3))) {
        const year = Math.min(y0 + 9, Math.max(y0, dead ? debtor.died! : y0 + rng.int(0, 9)));
        const causes = dead && debtor.endEvent !== null ? [debtor.endEvent] : topStress(debtor, year, 30, 2);
        const fixed = causes.filter((c) => s.events[c].year <= year);
        const ev = event(s, 'default', year, { cell: s.settlements[debtor.capital].cell, parts: [[ref('pol', debtor.id), 'debtor'], [ref('hou', h.id), 'creditor']], causes: fixed, data: { amount: Math.round(loan.amount) }, sig: 0.25 });
        h.capital -= loan.amount;
        h.loans.splice(h.loans.indexOf(loan), 1);
        debtor.debt = Math.max(0, debtor.debt - loan.amount);
        if (h.capital < 0) {
          const bev = endHouse(s, h, year, 'bankruptcy', [ev.id]);
          failures.push({ house: h, event: bev });
          break;
        }
      }
    }
    if (h.died !== null) continue;
    // ruin by war or a lost market
    if (h.capital < 4 || (t.abandoned !== null)) {
      const year = y0 + rng.int(0, 9);
      const causes = [...t.sacks.filter((e) => s.events[e].year > y0 - 20), ...(P ? topStress(P, year, 20, 2) : [])].filter((c) => s.events[c].year <= year);
      const bev = endHouse(s, h, year, 'bankruptcy', causes);
      failures.push({ house: h, event: bev });
    }
  }
  if (failures.length >= 3) {
    const year = Math.max(...failures.map((f) => s.events[f.event].year));
    const t = s.settlements[failures[0].house.settlement];
    const parts: [string, string][] = failures.map((f) => [ref('hou', f.house.id), 'failed'] as [string, string]);
    const pol = new Set(failures.map((f) => s.owner[s.settlements[f.house.settlement].cell]).filter((x) => x >= 0));
    for (const p of pol) parts.push([ref('pol', p), 'affected']);
    const ev = event(s, 'panic', year, { cell: t.cell, parts, causes: failures.map((f) => f.event), data: { failures: failures.length }, sig: Math.min(0.6, 0.25 + failures.length * 0.04) });
    for (const p of pol) {
      const P = s.polities[p];
      if (alivePolity(P, year)) { addStress(P, year, ev.id, 1); P.stability = Math.max(0, P.stability - 0.05); }
    }
  }
  // trade collapse detection per landmass
  const byLand = new Map<number, number>();
  for (const [a, b, v] of s.activeRoutes) {
    const lm = s.world.landmass[s.settlements[a].cell];
    byLand.set(lm, (byLand.get(lm) ?? 0) + v);
    void b;
  }
  for (const [lm, vol] of byLand) {
    const hist = mem.volumeHistory.get(lm) ?? [];
    const recentMax = hist.length ? Math.max(...hist.slice(-4)) : 0;
    if (recentMax > 3 && vol < recentMax * 0.55 && y0 - (mem.lastCollapse.get(lm) ?? -1000) > 150) {
      mem.lastCollapse.set(lm, y0);
      const year = y0 + rng.int(0, 9);
      const recent = s.events.slice(-4000).filter((e) => e.year <= year && e.year >= y0 - 40 && s.world.landmass[e.cell] === lm && ['collapse', 'conquest', 'sack', 'plague', 'famine', 'drought', 'eruption', 'migration', 'panic'].includes(e.sub));
      recent.sort((a, b) => b.sig - a.sig || b.year - a.year);
      const causes = recent.slice(0, 5).map((e) => e.id);
      const parts: [string, string][] = [];
      const pols = new Set<number>();
      for (const e of recent.slice(0, 10)) for (const [r, role] of e.parts) if (r.startsWith('pol:') && role !== 'successor') pols.add(Number(r.slice(4)));
      for (const p of [...pols].slice(0, 8)) parts.push([ref('pol', p), 'affected']);
      event(s, 'trade-collapse', year, { cell: recent[0]?.cell ?? -1, parts, causes, data: { landmass: lm, drop: Math.round((1 - vol / recentMax) * 100) / 100 }, sig: 0.7, end: year + 30 });
    }
    hist.push(vol);
    if (hist.length > 8) hist.shift();
    mem.volumeHistory.set(lm, hist);
  }
  // fossil fuel use drives late warming
  for (const p of s.polities) {
    if (!alivePolity(p, y0) || !has(p, 'steam')) continue;
    s.fossil += p.pop * 1.2e-4 * (1 + (has(p, 'combustion') ? 1 : 0) + (has(p, 'electricity') ? 0.5 : 0));
  }
}

function endHouse(s: State, h: House, year: number, sub: 'bankruptcy' | 'dissolution', causes: number[]): number {
  const t = s.settlements[h.settlement];
  const fixed = causes.filter((c) => s.events[c].year <= year);
  const ev = event(s, sub === 'bankruptcy' ? 'bankruptcy' : 'house-dissolution', year, { cell: t.cell, parts: [[ref('hou', h.id), 'house'], [ref('set', t.id), 'seat']], causes: fixed, sig: sub === 'bankruptcy' ? 0.15 : 0.04 });
  h.died = year;
  h.endEvent = ev.id;
  const head = s.persons[h.heads[h.heads.length - 1][1]];
  for (const r of head.roles) if (r.ref === ref('hou', h.id) && r.end === null) r.end = year;
  return ev.id;
}

function pickGoods(s: State, cell: number, year: number, rng: Rng): number[] {
  const w = s.world;
  const local: number[] = [];
  for (const g of GOODS) {
    if (year < g.from || year > g.to) continue;
    if (g.res !== undefined) {
      let hasRes = (w.resources[cell] & g.res) !== 0;
      for (const k of w.neighbors[cell]) if (w.resources[k] & g.res) hasRes = true;
      if (hasRes) local.push(g.id);
    }
  }
  const era = yearEra(year);
  const staples = era >= 5 ? [12, 13, 15, 0] : [0, 6, 10, 2, 4];
  const pool = [...new Set([...local, ...rng.sample(staples.filter((g) => year >= GOODS[g].from && year <= GOODS[g].to), 2), ...(rng.chance(0.4) ? [9] : []), ...(year < 3600 && rng.chance(0.5) ? [3] : [])])];
  return pool.slice(0, 5);
}

function round1(x: number): number { return Math.round(x * 10) / 10; }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function round6(x: number): number { return Math.round(x * 1e6) / 1e6; }
