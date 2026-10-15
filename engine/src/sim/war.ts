// War: declarations, alliances called to arms, yearly campaigns and battles, sieges, peace treaties.
import type { State, Polity, War } from './state.ts';
import { event, ref, rel, alivePolity, addStress, setOwner, topStress } from './state.ts';
import { Rng } from '../core/rng.ts';
import { commander, kill, newPerson, ensureFamily, livingChildren, livingRuler } from './people.ts';
import { eraOf, has, TK } from './tech.ts';
import { endPolity, ownedCells } from './polities.ts';
import type { PolityAgg } from './polities.ts';
import type { PopMemory } from './population.ts';

export function atWar(s: State, pid: number): War[] {
  return s.wars.filter((w) => w.ended === null && (w.attackers.includes(pid) || w.defenders.includes(pid)));
}

export function startWar(s: State, year: number, attackers: number[], defenders: number[], goal: War['goal'], targetRegion: number, causes: number[], rng: Rng): War {
  const parts: [string, string][] = [];
  for (const a of attackers) parts.push([ref('pol', a), 'attacker']);
  for (const d of defenders) parts.push([ref('pol', d), 'defender']);
  if (targetRegion >= 0) parts.push([ref('reg', targetRegion), 'target']);
  const fixed = causes.filter((c) => c >= 0 && s.events[c].year <= year);
  const ev = event(s, 'war', year, { cell: targetRegion >= 0 ? s.world.regionLabelCell[targetRegion] : -1, parts, causes: fixed, data: { goal }, sig: 0.4 });
  const w: War = {
    event: ev.id, attackers: [...attackers], defenders: [...defenders], goal, targetRegion, start: year, score: 0, battles: [],
    occupied: new Set(), exhaustA: 0, exhaustD: 0, lossesA: 0, lossesD: 0, menLostA: 0, menLostD: 0, commanderA: null, commanderD: null, ended: null,
  };
  s.wars.push(w);
  for (const a of attackers) for (const d of defenders) rel(s, a, d).wars.push(ev.id);
  // defenders' allies answer the call
  if (goal !== 'civil' && goal !== 'independence') {
    for (const d of defenders) {
      for (const [k, r] of s.relations) {
        if (r.alliance === null) continue;
        const a = Math.floor(k / 65536), b = k % 65536;
        if (a !== d && b !== d) continue;
        const ally = a === d ? b : a;
        const ap = s.polities[ally];
        if (!alivePolity(ap, year) || w.attackers.includes(ally) || w.defenders.includes(ally)) continue;
        if (rng.chance(0.65)) {
          w.defenders.push(ally);
          ev.parts.push([ref('pol', ally), 'ally']);
        }
      }
    }
  }
  return w;
}

function sideArmy(s: State, side: number[], year: number): number {
  let t = 0;
  side.forEach((p, i) => {
    const q = s.polities[p];
    if (alivePolity(q, year)) t += q.army * (i === 0 ? 0.8 : 0.4);
  });
  return Math.max(50, t);
}

/** Men a side brings to the field: most of the leader's soldiers and some of each ally's. */
function sideMen(s: State, side: number[], year: number): number {
  let t = 0;
  side.forEach((p, i) => {
    const q = s.polities[p];
    if (alivePolity(q, year)) t += q.soldiers * (i === 0 ? 0.8 : 0.4);
  });
  return t;
}

/** Casualties (killed, wounded and taken) of one battle, in men. The beaten side loses 6–36% of the men it
 *  engaged, more in a rout; the victor loses a fraction of that (about 1.5× fewer in a close fight, 5× fewer
 *  in a rout, with scatter, so a costly victory stays possible), and never more than a quarter of its own men. */
export function casualties(r: Rng, menA: number, menD: number, attackerWins: boolean, decisive: number): [number, number] {
  const menW = attackerWins ? menA : menD;
  const menL = attackerWins ? menD : menA;
  const lostL = Math.round(menL * Math.min(0.6, (0.06 + 0.3 * decisive) * Math.exp(r.normal(0, 0.25))));
  const ratio = Math.exp(r.normal(Math.log(1.5 + 3.5 * decisive), 0.5));
  const lostW = Math.round(Math.min(lostL / ratio, menW * 0.25));
  return attackerWins ? [lostW, lostL] : [lostL, lostW];
}

/** Yearly: losses are made good toward the muster (recruits, the returning wounded), a quarter of the gap a year. */
export function recruitYear(s: State, year: number): void {
  for (const p of s.polities) {
    if (!alivePolity(p, year) || p.soldiers >= p.levy) continue;
    p.soldiers += Math.ceil((p.levy - p.soldiers) * 0.25);
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Declarations (yearly, low probability). */
export function declareYear(s: State, agg: PolityAgg, year: number, rng: Rng, contacts?: Map<number, Set<number>>): void {
  for (const a of s.polities) {
    if (!alivePolity(a, year) || a.kind === 'rebel') continue;
    if (atWar(s, a.id).length > 0) continue;
    if (year - a.lastWarEnd < 6) continue;
    const nb = new Map(agg.borders.get(a.id) ?? []);
    // across the sea: trading partners within naval reach, at a fraction of the land-border appetite
    const nav = a.techs.get(TK.navigation);
    if (contacts && nav !== undefined && nav <= year) for (const o of contacts.get(a.id) ?? []) if (!nb.has(o)) nb.set(o, -1);
    if (nb.size === 0) continue;
    for (const [bid, borderLen0] of nb) {
      const naval = borderLen0 < 0;
      const borderLen = naval ? 0 : borderLen0;
      const b = s.polities[bid];
      if (!alivePolity(b, year)) continue;
      if (a.overlord === bid || b.overlord === a.id) continue;
      const r = rel(s, a.id, bid);
      if (r.truceUntil > year || r.alliance !== null) continue;
      const pr = a.army / Math.max(1, b.army);
      let desire = 0.12 - r.opinion * 0.9 + (pr - 1) * 0.3 + Math.min(0.2, borderLen / 120);
      if (b.stability < 0.3) desire += 0.15;
      if (a.religion !== b.religion && s.movements[a.religion]?.tenets[5] > 0.4) desire += 0.12;
      if (pr < 0.8) desire -= 0.4;
      if (desire <= 0) continue;
      const p = 0.016 * desire * (a.gov === 'horde' ? 2.5 : 1) * (eraOf(a) >= 5 ? 0.6 : 1) * (naval ? 0.25 : 1);
      if (!rng.chance(p)) continue;
      // causes
      const causes: number[] = [];
      if (r.wars.length) causes.push(r.wars[r.wars.length - 1]);
      const stressB = topStress(b, year, 15, 1);
      if (stressB.length) causes.push(stressB[0]);
      const recent = s.events.slice(-600).filter((e) => e.year <= year && e.year > year - 25 && (e.sub === 'conversion' || e.sub === 'usurpation' || e.sub === 'embargo' || e.sub === 'expansion') && e.parts.some(([x]) => x === `pol:${bid}` || x === `pol:${a.id}`));
      if (recent.length) causes.push(recent[recent.length - 1].id);
      let goal: War['goal'] = 'conquest';
      const era = eraOf(a);
      if (a.gov === 'horde') goal = 'invasion';
      else if (era <= 1 && pr > 1.4 && rng.chance(0.35)) goal = 'tribute';
      else if (a.religion !== b.religion && rng.chance(0.2)) goal = 'holy';
      else if (r.marriages.length && b.stability < 0.4 && rng.chance(0.4)) goal = 'succession';
      else if (rng.chance(0.12)) goal = 'trade';
      // target region: the region of b's border cells most adjacent to a
      const regionVotes = new Map<number, number>();
      for (const c of agg.cells.get(bid) ?? []) {
        if (s.owner[c] !== bid) continue;
        for (const k of s.world.neighbors[c]) if (s.owner[k] === a.id) { regionVotes.set(s.world.region[c], (regionVotes.get(s.world.region[c]) ?? 0) + 1); break; }
      }
      let target = -1, tv = -1;
      for (const [rg, v] of regionVotes) if (v > tv || (v === tv && rg < target)) { target = rg; tv = v; }
      startWar(s, year, [a.id], [bid], goal, target, causes, rng);
      break;
    }
  }
}

/** One year of every active war. */
export function warYear(s: State, agg: PolityAgg, pm: PopMemory, year: number, rng: Rng): void {
  for (const w of s.wars) {
    if (w.ended !== null || w.start > year) continue;
    w.attackers = w.attackers.filter((p) => alivePolity(s.polities[p], year));
    w.defenders = w.defenders.filter((p) => alivePolity(s.polities[p], year));
    if (w.attackers.length === 0 || w.defenders.length === 0 || !alivePolity(s.polities[w.attackers[0]], year) || !alivePolity(s.polities[w.defenders[0]], year)) {
      endWarNoTreaty(s, w, year);
      continue;
    }
    const A = s.polities[w.attackers[0]];
    const D = s.polities[w.defenders[0]];
    if (year > w.start && rng.chance(0.78)) battle(s, agg, pm, w, A, D, year, rng);
    w.exhaustA += 0.06 + (A.pop > 0 ? (w.lossesA / A.pop) * 8 : 0) * 0.1;
    w.exhaustD += 0.06 + (D.pop > 0 ? (w.lossesD / D.pop) * 8 : 0) * 0.1;
    const dur = year - w.start;
    const maxDur = eraOf(A) <= 1 ? 9 : eraOf(A) <= 3 ? 18 : 12;
    let end = false;
    if (w.score >= 60 || w.score <= -50) end = true;
    else if (dur >= 2 && (w.exhaustA > 0.9 || w.exhaustD > 0.9) && rng.chance(0.35)) end = true;
    else if (dur >= maxDur && rng.chance(0.4)) end = true;
    if (end) makePeace(s, agg, w, A, D, year, rng);
  }
}

function frontCell(s: State, w: War, A: Polity, D: Polity, attackerAdvancing: boolean, rng: Rng): number {
  const world = s.world;
  const holders = new Set([...w.attackers]);
  const cands: number[] = [];
  if (attackerAdvancing) {
    for (let c = 0; c < world.n; c++) {
      if (s.owner[c] !== D.id || w.occupied.has(c)) continue;
      for (const k of world.neighbors[c]) if (holders.has(s.owner[k]) || w.occupied.has(k)) { cands.push(c); break; }
    }
  } else {
    for (const c of w.occupied) cands.push(c);
    if (cands.length === 0) {
      for (let c = 0; c < world.n; c++) {
        if (s.owner[c] !== A.id) continue;
        for (const k of world.neighbors[c]) if (s.owner[k] === D.id) { cands.push(c); break; }
      }
    }
  }
  if (cands.length === 0) {
    // no land front: fight near the defender's capital coast (naval landing) or capital
    return s.settlements[D.capital].cell;
  }
  const inTarget = cands.filter((c) => world.region[c] === w.targetRegion);
  return rng.pick(inTarget.length ? inTarget : cands);
}

function battle(s: State, agg: PolityAgg, pm: PopMemory, w: War, A: Polity, D: Polity, year: number, rng: Rng): void {
  const world = s.world;
  const freshA = 1 - Math.min(0.5, w.exhaustA * 0.3);
  const freshD = 1 - Math.min(0.5, w.exhaustD * 0.3);
  const SA = sideArmy(s, w.attackers, year) * freshA;
  const SD = sideArmy(s, w.defenders, year) * freshD;
  const cA = commander(s, A, year, rng);
  const cD = commander(s, D, year, rng);
  w.commanderA = cA.id;
  w.commanderD = cD.id;
  const advancing = w.score >= -20;
  const cell = frontCell(s, w, A, D, advancing, rng);
  const terrain = world.elev[cell] > 0.45 ? -0.3 : world.flux[cell] > world.riverThreshold * 3 ? -0.15 : 0;
  const pA = sigmoid(1.4 * Math.log(SA / SD) + 0.35 * (cA.skill - cD.skill) + terrain + rng.normal(0, 0.35));
  const attackerWins = rng.next() < pA;
  const shareA = 0.35 + rng.next() * 0.5;
  const shareD = 0.35 + rng.next() * 0.5;
  const engagedA = Math.round(SA * shareA);
  const engagedD = Math.round(SD * shareD);
  const decisive = rng.next();
  // strength worn down (war exhaustion and the balance of later battles)
  const lossW = 0.04 + 0.14 * rng.next();
  const lossL = 0.14 + 0.3 * decisive;
  const lossA = Math.round(engagedA * (attackerWins ? lossW : lossL));
  const lossD = Math.round(engagedD * (attackerWins ? lossL : lossW));
  w.lossesA += lossA;
  w.lossesD += lossD;
  A.army = Math.max(0, A.army - lossA);
  D.army = Math.max(0, D.army - lossD);
  // the men in the field and what the day cost each side (the record)
  const menA = Math.max(1, Math.round(sideMen(s, w.attackers, year) * freshA * shareA));
  const menD = Math.max(1, Math.round(sideMen(s, w.defenders, year) * freshD * shareD));
  const [lostA, lostD] = casualties(s.rng.fork('casualties', w.event, year), menA, menD, attackerWins, decisive);
  A.soldiers = Math.max(0, A.soldiers - lostA);
  D.soldiers = Math.max(0, D.soldiers - lostD);
  w.menLostA += lostA;
  w.menLostD += lostD;
  const delta = 10 + 22 * decisive;
  w.score += attackerWins ? delta : -delta;
  const winner = attackerWins ? A : D;
  const loser = attackerWins ? D : A;
  const nearSettlement = nearestSettlement(s, cell, year);
  const ev = event(s, 'battle', year, {
    cell,
    parts: [
      [`evt:${w.event}`, 'war'],
      [ref('pol', A.id), 'attacker'], [ref('pol', D.id), 'defender'],
      [ref('per', cA.id), 'attacking commander'], [ref('per', cD.id), 'defending commander'],
      [ref('pol', winner.id), 'victor'],
      ...(nearSettlement >= 0 ? [[ref('set', nearSettlement), 'near'] as [string, string]] : []),
    ],
    causes: [w.event],
    data: { war: w.event, attackerSize: menA, defenderSize: menD, attackerLosses: lostA, defenderLosses: lostD, winner: winner.id, decisive: Math.round(decisive * 100) / 100, region: world.region[cell] },
    sig: Math.min(0.6, 0.12 + (engagedA + engagedD) / 200_000 + decisive * 0.15),
  });
  w.battles.push(ev.id);
  pm.recentBattles.push({ year, cell, event: ev.id });
  s.devast[cell] = Math.min(1, s.devast[cell] + 0.35);
  for (const k of world.neighbors[cell]) s.devast[k] = Math.min(1, s.devast[k] + 0.12);
  addStress(loser, year, ev.id, 0.5 + decisive);
  loser.warWeariness += 0.4;
  // commander deaths
  const cLoser = attackerWins ? cD : cA;
  const cWinner = attackerWins ? cA : cD;
  if (rng.chance(0.07 + 0.08 * decisive)) { kill(s, cLoser, year, 'battle', ev.id); ev.data.commanderKilled = cLoser.id; }
  else if (rng.chance(0.015)) { kill(s, cWinner, year, 'battle', ev.id); ev.data.commanderKilled = cWinner.id; }
  // occupation / liberation
  if (attackerWins) {
    const n = 1 + Math.floor(decisive * 4);
    const cand: number[] = [];
    for (let c = 0; c < world.n && cand.length < 60; c++) {
      if (s.owner[c] !== D.id || w.occupied.has(c)) continue;
      if (world.region[c] !== w.targetRegion && rng.chance(0.6)) continue;
      for (const k of world.neighbors[c]) if (w.occupied.has(k) || w.attackers.includes(s.owner[k]) || k === cell) { cand.push(c); break; }
    }
    if (s.owner[cell] === D.id) w.occupied.add(cell);
    for (const c of rng.sample(cand, n)) w.occupied.add(c);
    // siege of the capital
    const capCell = s.settlements[D.capital].cell;
    if (w.occupied.has(capCell) || (decisive > 0.75 && rng.chance(0.25))) {
      w.occupied.add(capCell);
      siege(s, w, A, D, year, ev.id, rng);
    }
  } else {
    const occ = [...w.occupied];
    for (const c of rng.sample(occ, Math.min(occ.length, 2 + Math.floor(decisive * 4)))) w.occupied.delete(c);
  }
}

function siege(s: State, w: War, A: Polity, D: Polity, year: number, battleEv: number, rng: Rng): void {
  const t = s.settlements[D.capital];
  if (t.sacks.some((e) => s.events[e].year === year)) return;
  const sacked = rng.chance(0.45);
  const ev = event(s, sacked ? 'sack' : 'siege', year, {
    cell: t.cell,
    parts: [[`evt:${w.event}`, 'war'], [ref('set', t.id), 'settlement'], [ref('pol', A.id), 'besieger'], [ref('pol', D.id), 'besieged']],
    causes: [battleEv],
    data: { war: w.event, burnedArchives: sacked && t.pop > 15000 && rng.chance(0.35) },
    sig: sacked ? 0.45 : 0.25,
  });
  w.score += 20;
  if (sacked) {
    t.sacks.push(ev.id);
    s.pop[t.cell] *= 0.6;
    t.pop = Math.round(t.pop * 0.55);
    addStress(D, year, ev.id, 1.5);
    D.stability = Math.max(0, D.stability - 0.12);
  }
}

function nearestSettlement(s: State, cell: number, year: number): number {
  let best = -1, bd = Infinity;
  for (const t of s.settlements) {
    if (t.abandoned !== null || t.founded > year) continue;
    const d = Math.hypot(s.world.x[t.cell] - s.world.x[cell], s.world.y[t.cell] - s.world.y[cell]);
    if (d < bd) { bd = d; best = t.id; }
  }
  return bd < 80 ? best : -1;
}

function endWarNoTreaty(s: State, w: War, year: number): void {
  w.ended = year;
  const ev = s.events[w.event];
  ev.end = Math.max(ev.year, year);
  ev.data.outcome = 'dissolved';
  for (const p of [...w.attackers, ...w.defenders]) if (s.polities[p]) s.polities[p].lastWarEnd = year;
}

export interface Term {
  kind: 'cede' | 'indemnity' | 'tribute' | 'vassal' | 'truce' | 'marriage' | 'independence' | 'conversion' | 'trade' | 'status-quo' | 'annexation' | 'partition' | 'amnesty' | 'boundary';
  from?: number;
  to?: number;
  cells?: number[];
  settlements?: number[];
  regions?: number[];
  amount?: number; // silver kg
  years?: number;
  persons?: number[];
  movement?: number;
  river?: number;
}

function makePeace(s: State, agg: PolityAgg, w: War, A: Polity, D: Polity, year: number, rng: Rng): void {
  const world = s.world;
  w.ended = year;
  const warEv = s.events[w.event];
  warEv.end = year;
  const outcome = w.score > 25 ? 'attacker' : w.score < -25 ? 'defender' : 'stalemate';
  warEv.data.outcome = outcome;
  warEv.data.score = Math.round(w.score);
  warEv.data.lossesA = w.menLostA;
  warEv.data.lossesD = w.menLostD;
  const decisive = w.battles.slice().sort((a, b) => (s.events[b].data.decisive as number) - (s.events[a].data.decisive as number)).slice(0, 2);
  const causes = [w.event, ...decisive];
  const terms: Term[] = [];
  const winner = outcome === 'attacker' ? A : outcome === 'defender' ? D : null;
  const loser = outcome === 'attacker' ? D : outcome === 'defender' ? A : null;
  const era = eraOf(A);
  const truceYears = era <= 1 ? 10 : era <= 3 ? 15 : 20;
  let annex = false;
  let sub = 'treaty';

  const dCells = ownedCells(s, D.id);
  const aCells = ownedCells(s, A.id);

  if (w.goal === 'independence' || w.goal === 'civil') {
    // A is the rebel
    if (outcome === 'attacker') {
      if (w.goal === 'civil' && w.score > 70) {
        annex = true;
        terms.push({ kind: 'annexation', from: D.id, to: A.id, cells: dCells });
      } else {
        terms.push({ kind: w.goal === 'civil' ? 'partition' : 'independence', from: D.id, to: A.id });
        A.kind = 'state';
      }
    } else if (outcome === 'defender') {
      sub = 'suppression';
      annex = true;
      terms.push({ kind: 'annexation', from: A.id, to: D.id, cells: aCells });
      if (A.ruler !== null && rng.chance(0.6)) terms.push({ kind: 'amnesty', persons: [] });
    } else {
      terms.push({ kind: w.goal === 'civil' ? 'partition' : 'independence', from: D.id, to: A.id });
      A.kind = 'state';
    }
  } else if (winner && loser) {
    const loserCells = winner === A ? dCells : aCells;
    const occupied = [...w.occupied].filter((c) => s.owner[c] === loser.id);
    const capOcc = w.occupied.has(s.settlements[loser.capital].cell);
    if (winner === A && (w.goal === 'conquest' || w.goal === 'invasion' || w.goal === 'holy') && (loserCells.length - occupied.length < 6 || (capOcc && w.score > 85 && loserCells.length < 40))) {
      annex = true;
      terms.push({ kind: 'annexation', from: loser.id, to: winner.id, cells: loserCells });
    } else {
      const share = Math.min(0.45, (Math.abs(w.score) - 20) / 160 + (w.goal === 'invasion' ? 0.15 : 0));
      let ceded = occupied;
      if (winner === A && w.targetRegion >= 0) {
        const inTarget = loserCells.filter((c) => world.region[c] === w.targetRegion);
        ceded = [...new Set([...occupied, ...inTarget.slice(0, Math.ceil(inTarget.length * (0.4 + share)))])];
      }
      ceded = ceded.slice(0, Math.max(1, Math.floor(loserCells.length * share)));
      // keep the capital
      ceded = ceded.filter((c) => c !== s.settlements[loser.capital].cell);
      if (winner === D) ceded = ceded.slice(0, Math.floor(ceded.length * 0.4));
      if (ceded.length > 0) {
        const settlements = s.settlements.filter((t) => t.abandoned === null && t.founded <= year && ceded.includes(t.cell)).map((t) => t.id);
        const regions = [...new Set(ceded.map((c) => world.region[c]))];
        const river = boundaryRiver(s, ceded);
        terms.push({ kind: 'cede', from: loser.id, to: winner.id, cells: ceded, settlements, regions, river: river ?? undefined });
      }
      if (w.goal === 'tribute' || (winner === A && era <= 2 && rng.chance(0.35))) {
        const amount = Math.round(Math.max(1, loser.pop * 0.0006 * (1 + era)));
        terms.push({ kind: 'tribute', from: loser.id, to: winner.id, amount, years: rng.int(10, 40) });
      } else if (rng.chance(0.5)) {
        const amount = Math.round(Math.max(5, Math.min(Math.max(loser.treasury, 0) * 0.5 + loser.pop * 0.002, loser.pop * 0.01)));
        terms.push({ kind: 'indemnity', from: loser.id, to: winner.id, amount });
      }
      if (winner.army > loser.army * 3.5 && loser.cells < winner.cells / 4 && rng.chance(0.4) && loser.overlord === null) {
        terms.push({ kind: 'vassal', from: loser.id, to: winner.id });
      }
      if (w.goal === 'holy' && winner === A && loser.religion !== winner.religion && rng.chance(0.5)) {
        terms.push({ kind: 'conversion', from: loser.id, to: winner.id, movement: winner.religion });
      }
      if (w.goal === 'trade' || rng.chance(0.15)) terms.push({ kind: 'trade', from: loser.id, to: winner.id });
    }
  } else {
    terms.push({ kind: 'status-quo' });
  }
  if (!annex) terms.push({ kind: 'truce', years: truceYears });
  // dynastic marriage clause
  if (!annex && rng.chance(0.22) && A.ruler !== null && D.ruler !== null && A.dynasty !== null && D.dynasty !== null) {
    const m = marriageBetween(s, A, D, year, rng);
    if (m) terms.push({ kind: 'marriage', persons: m });
  }

  const parts: [string, string][] = [[`evt:${w.event}`, 'war']];
  for (const p of w.attackers) parts.push([ref('pol', p), winner?.id === p ? 'victor' : loser?.id === p ? 'vanquished' : 'party']);
  for (const p of w.defenders) parts.push([ref('pol', p), winner?.id === p ? 'victor' : loser?.id === p ? 'vanquished' : 'party']);
  // a ruler killed earlier this year does not sign
  const signA = livingRuler(s, A, year), signD = livingRuler(s, D, year);
  if (signA !== null) parts.push([ref('per', signA), 'signatory']);
  if (signD !== null) parts.push([ref('per', signD), 'signatory']);
  const site = treatySite(s, w, A, D, year);
  if (site >= 0) parts.push([ref('set', site), 'signed at']);
  const evSub = annex ? (sub === 'suppression' ? 'suppression' : 'conquest') : 'treaty';
  const ev = event(s, evSub, year, {
    cell: site >= 0 ? s.settlements[site].cell : warEv.cell,
    parts, causes,
    data: { kind: 'peace', war: w.event, outcome, goal: w.goal, terms: terms.map((t) => ({ ...t })) },
    sig: annex ? 0.55 : Math.min(0.6, 0.25 + Math.abs(w.score) / 300),
  });
  warEv.data.treaty = ev.id;

  // apply terms
  for (const t of terms) {
    switch (t.kind) {
      case 'cede':
        for (const c of t.cells!) setOwner(s, c, t.to!, year, ev.id);
        break;
      case 'annexation': {
        for (const c of t.cells!) setOwner(s, c, t.to!, year, ev.id);
        const dead = s.polities[t.from!];
        endPolity(s, dead, year, ev.id);
        if (dead.ruler !== null) {
          const r = s.persons[dead.ruler];
          if (rng.chance(0.35)) kill(s, r, year, 'executed', ev.id);
        }
        s.polities[t.to!].successors.push(dead.id);
        break;
      }
      case 'indemnity':
        s.polities[t.from!].treasury -= t.amount!;
        s.polities[t.to!].treasury += t.amount!;
        break;
      case 'tribute':
        s.polities[t.from!].tributes.push({ to: t.to!, amount: t.amount!, until: year + t.years!, event: ev.id });
        break;
      case 'vassal':
        s.polities[t.from!].overlord = t.to!;
        break;
      case 'truce':
        rel(s, A.id, D.id).truceUntil = year + t.years!;
        break;
      case 'conversion':
        s.polities[t.from!].religion = t.movement!;
        break;
      default:
        break;
    }
  }
  const r = rel(s, A.id, D.id);
  r.opinion = Math.max(-1, r.opinion - 0.35);
  for (const p of [...w.attackers, ...w.defenders]) if (s.polities[p]) s.polities[p].lastWarEnd = year;
  if (winner) winner.stability = Math.min(1, winner.stability + 0.07);
  if (loser && loser.died === null) {
    loser.stability = Math.max(0, loser.stability - 0.12);
    addStress(loser, year, ev.id, 1.2);
  }
}

function boundaryRiver(s: State, cells: number[]): number | null {
  const set = new Set(cells);
  for (let r = 0; r < s.world.rivers.length; r++) {
    const rv = s.world.rivers[r];
    let touch = 0;
    for (const c of rv.cells) if (set.has(c)) touch++;
    if (touch >= 2) return r;
  }
  return null;
}

function treatySite(s: State, w: War, A: Polity, D: Polity, year: number): number {
  // signed at the defender's capital if occupied, otherwise at a settlement near the front, else attacker capital
  const dCap = s.settlements[D.capital];
  if (w.occupied.has(dCap.cell)) return dCap.id;
  if (w.battles.length) {
    const last = s.events[w.battles[w.battles.length - 1]];
    const near = last.parts.find(([r, role]) => role === 'near' && r.startsWith('set:'));
    if (near) {
      const t = s.settlements[Number(near[0].slice(4))];
      if (t.abandoned === null) return t.id;
    }
  }
  return A.capital;
}

/** Arrange a dynastic marriage between two ruling houses; returns [spouseA, spouseB]. */
export function marriageBetween(s: State, A: Polity, B: Polity, year: number, rng: Rng): number[] | null {
  const ra = s.persons[A.ruler!];
  const rb = s.persons[B.ruler!];
  ensureFamily(s, ra);
  ensureFamily(s, rb);
  const eligible = (p: typeof ra) => livingChildren(s, p, year).filter((c) => year - c.born >= 14 && year - c.born <= 32 && c.spouses.length === 0);
  const ka = eligible(ra);
  const kb = eligible(rb);
  for (const x of ka) for (const y of kb) {
    if (x.sex !== y.sex) {
      x.spouses.push(y.id);
      y.spouses.push(x.id);
      rel(s, A.id, B.id).marriages.push(year);
      return [x.id, y.id];
    }
  }
  // a ruler without a living spouse marries a princess
  for (const [ruler, kids] of [[ra, kb], [rb, ka]] as const) {
    const living = ruler.spouses.some((sp) => s.persons[sp].died > year);
    if (living) continue;
    const k = kids.find((c) => c.sex !== ruler.sex);
    if (k) {
      ruler.spouses.push(k.id);
      k.spouses.push(ruler.id);
      rel(s, A.id, B.id).marriages.push(year);
      return [ruler.id, k.id];
    }
  }
  void newPerson;
  void has;
  void setOwner;
  return null;
}
