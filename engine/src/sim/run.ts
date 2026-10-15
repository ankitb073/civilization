// The main loop: 50 centuries, decade sub-steps, and a yearly loop for politics and war so that
// every territorial change is logged in chronological order.
import type { State } from './state.ts';
import { alivePolity } from './state.ts';
import { initState } from './init.ts';
import { buildGeo } from './geo.ts';
import { initClimate, climateStep } from './climate.ts';
import { initPopMemory, populationStep, plagueStep } from './population.ts';
import { settlementStep, recordSettlementPop } from './settlements.ts';
import { aggregate, stabilityStep, governmentStep, formationStep, politicsYear, expansionYear } from './polities.ts';
import { declareYear, warYear } from './war.ts';
import { diplomacyStep, applyPendingAnnex } from './diplomacy.ts';
import { cultureStep } from './culture.ts';
import { religionStep } from './religion.ts';
import type { ThoughtPresence } from './religion.ts';
import { techStep, eraOf } from './tech.ts';
import { routesStep, currencyStep, priceStep, housesStep, initEcon } from './economy.ts';
import type { EconMemory } from './economy.ts';

export interface SimResult {
  state: State;
  econ: EconMemory;
  thought: ThoughtPresence;
  /** State before any log entry: replaying the logs from here reproduces every year exactly. */
  initial: { owner: Int32Array; culture: Int32Array; religion: Int32Array };
}

export interface SimHooks {
  onStart?: (r: SimResult) => void;
  onCentury?: (r: SimResult, year: number) => void;
  log?: (msg: string) => void;
}

export function simulate(seed: number, yearEnd = 5000, hooks: SimHooks = {}): SimResult {
  const s = initState(seed);
  const geo = buildGeo(s);
  const cm = initClimate(s);
  const pm = initPopMemory(s);
  const econ = initEcon();
  const thought: ThoughtPresence = { settlements: new Map() };
  const initial = { owner: new Int32Array(s.world.n).fill(-1), culture: s.culture.slice(), religion: s.religion.slice() };
  const result: SimResult = { state: s, econ, thought, initial };
  let centuryExpansion = new Map<number, number>();
  hooks.onStart?.(result);
  const t0 = performance.now();

  for (let y0 = 0; y0 < yearEnd; y0 += 10) {
    s.year = y0;
    if (y0 % 100 === 0) centuryExpansion = new Map();
    climateStep(s, cm, y0);
    populationStep(s, geo, pm, y0);
    plagueStep(s, y0);
    settlementStep(s, geo, y0);
    formationStep(s, geo, y0);
    let agg = aggregate(s, geo, y0);
    const contacts = routesStep(s, agg, y0);
    techStep(s, y0, contacts);
    currencyStep(s, y0);
    priceStep(s, econ, y0);
    housesStep(s, agg, econ, y0);
    stabilityStep(s, agg, y0);
    const centuryEnd = y0 % 100 === 90;
    for (let y = y0; y < y0 + 10; y++) {
      const rng = s.rng.fork('year', y);
      applyPendingAnnex(s, y);
      governmentStep(s, agg, y);
      diplomacyStep(s, agg, y);
      politicsYear(s, geo, agg, y, rng);
      declareYear(s, agg, y, rng);
      warYear(s, agg, pm, y, rng);
      expansionYear(s, agg, y, rng, centuryExpansion);
      if (y % 5 === 4) agg = aggregate(s, geo, y);
    }
    // cultural and religious change is logged at the end of the decade, after the political year loop
    religionStep(s, geo, agg, thought, y0);
    cultureStep(s, geo, agg, y0, centuryEnd);
    // decadal statistics
    for (const p of s.polities) {
      if (!alivePolity(p, y0)) continue;
      s.polityYears.push([p.id, y0, p.cells, Math.round(p.pop), Math.round(p.urbanPop), Math.round(p.treasury), p.army, Math.round(p.stability * 1000) / 1000, p.gov, p.ruler, p.capital, p.religion, p.currency, eraOf(p)]);
    }
    s.lang.advanceTo(y0 + 9);
    if (centuryEnd) {
      recordSettlementPop(s, y0 + 10);
      hooks.onCentury?.(result, y0 + 10);
      if (hooks.log) {
        const alive = s.polities.filter((p) => p.died === null);
        const wars = s.wars.filter((w) => w.ended === null).length;
        let pop = 0;
        for (const c of geo.landCells) pop += s.pop[c];
        const top = alive.slice().sort((a, b) => b.cells - a.cells).slice(0, 3).map((p) => `${p.id}:${p.gov}:${p.cells}`).join(' ');
        const eras = alive.reduce((m, p) => Math.max(m, eraOf(p)), 0);
        hooks.log(`AY ${y0 + 10}  pop=${(pop / 1e6).toFixed(1)}M polities=${alive.length} wars=${wars} events=${s.events.length} persons=${s.persons.length} settlements=${s.settlements.filter((t) => t.abandoned === null).length} cultures=${s.cultures.filter((c) => c.died === null).length} era=${eras} T=${s.tempAnom.toFixed(2)} top=[${top}] ${((performance.now() - t0) / 1000).toFixed(1)}s`);
      }
    }
  }
  return result;
}
