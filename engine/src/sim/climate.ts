// Climate: global temperature anomaly (long cycles + red noise + volcanic + industrial forcing),
// regional precipitation via smooth modes, and named anomalies (eruptions, droughts, cold spells).
import type { State, ClimateAnomaly } from './state.ts';
import { event, ref } from './state.ts';
import { Simplex2 } from '../core/noise.ts';
import { BIOME } from '../world/biomes.ts';

export const MODES = 6;

export interface ClimateMemory {
  noise: number;
  volcanic: number;
  droughtByMode: (number | null)[]; // active anomaly id per mode
  coldSince: number | null;
  coldAnomaly: number | null;
  warmingAnomaly: number | null;
  volcanoCells: number[];
}

export function initClimate(s: State): ClimateMemory {
  const w = s.world;
  const rng = s.rng.fork('climate-init');
  s.modeField = [];
  for (let k = 0; k < MODES; k++) {
    const nz = new Simplex2(rng.fork('mode', k));
    const f = new Float32Array(w.n);
    const scale = 380 + k * 70;
    for (let i = 0; i < w.n; i++) f[i] = nz.fbm(w.x[i] / scale, w.y[i] / scale, 2) * 1.6;
    s.modeField.push(f);
  }
  s.modeAmp = new Array(MODES).fill(0);
  const volcanoCells: number[] = [];
  for (let i = 0; i < w.n; i++) if (w.land[i] && w.elev[i] > 0.55) volcanoCells.push(i);
  return { noise: 0, volcanic: 0, droughtByMode: new Array(MODES).fill(null), coldSince: null, coldAnomaly: null, warmingAnomaly: null, volcanoCells };
}

export function longTerm(y: number): number {
  return -0.3 * (y / 5000) + 0.2 * Math.sin((2 * Math.PI * (y + 400)) / 1450) + 0.1 * Math.sin((2 * Math.PI * y) / 610);
}

export function climateStep(s: State, mem: ClimateMemory, y0: number): void {
  const w = s.world;
  const rng = s.rng.fork('climate', y0);
  mem.noise = 0.75 * mem.noise + rng.normal(0, 0.07);
  mem.volcanic *= 0.3;

  // eruptions
  const vei7 = rng.chance(0.011);
  const vei6 = !vei7 && rng.chance(0.075);
  if ((vei6 || vei7) && mem.volcanoCells.length > 0) {
    const cell = rng.pick(mem.volcanoCells);
    const year = y0 + rng.int(0, 9);
    const cooling = vei7 ? 1.05 : 0.38;
    mem.volcanic += cooling;
    const ev = event(s, 'eruption', year, { cell, data: { vei: vei7 ? 7 : 6, cooling }, sig: vei7 ? 0.8 : 0.4, end: year + (vei7 ? 15 : 4) });
    const lang = s.cultures[s.culture[cell]]?.lang;
    const a: ClimateAnomaly = {
      id: s.anomalies.length, kind: 'eruption', start: year, end: year + (vei7 ? 15 : 4), cells: neighborhood(s, cell, vei7 ? 4 : 2),
      severity: vei7 ? 7 : 6, volcanoCell: cell,
      nameId: lang !== undefined ? s.lang.coinName(lang, year, 'mountain', `volcano:${cell}`) : null, event: ev.id,
    };
    s.anomalies.push(a);
    ev.parts.push([ref('cli', a.id), 'anomaly']);
    // local devastation
    for (const c of a.cells) s.pop[c] *= vei7 ? 0.55 : 0.85;
  }

  const warming = Math.min(1.6, s.fossil * 1.1e-6);
  if (warming > 0.25 && mem.warmingAnomaly === null) {
    const year = y0 + rng.int(0, 9);
    const ev = event(s, 'warming', year, { data: { anomaly: warming }, sig: 0.6, end: 5000 });
    const a: ClimateAnomaly = { id: s.anomalies.length, kind: 'warming', start: year, end: 5000, cells: [], severity: warming, volcanoCell: -1, nameId: null, event: ev.id };
    s.anomalies.push(a);
    ev.parts.push([ref('cli', a.id), 'anomaly']);
    mem.warmingAnomaly = a.id;
  }
  if (mem.warmingAnomaly !== null) s.anomalies[mem.warmingAnomaly].severity = warming;

  s.tempAnom = longTerm(y0) + mem.noise - mem.volcanic + warming;
  let pSum = 0;
  for (let k = 0; k < MODES; k++) {
    s.modeAmp[k] = 0.8 * s.modeAmp[k] + rng.normal(0, 0.12);
    pSum += s.modeAmp[k];
  }
  s.climate.push({ year: y0, temp: round2(s.tempAnom), precip: round2(pSum / MODES) });

  // yields
  for (let i = 0; i < w.n; i++) {
    if (!w.land[i]) continue;
    let pa = 0;
    for (let k = 0; k < MODES; k++) pa += s.modeAmp[k] * s.modeField[k][i];
    pa = Math.max(-0.65, Math.min(0.65, pa));
    const b = w.biome[i];
    const arid = b === BIOME.steppe || b === BIOME.savanna || b === BIOME.mediterranean || b === BIOME.hotDesert || b === BIOME.coldDesert;
    const river = w.flux[i] > w.riverThreshold;
    let sens = arid ? 1.25 : 0.7;
    if (river) sens *= 0.55;
    let y = 1 + (pa < 0 ? sens * pa : 0.25 * pa);
    const lat = Math.abs(w.lat[i]);
    y += s.tempAnom * (lat > 40 ? 0.3 : lat > 25 ? 0.12 : -0.05);
    s.yieldF[i] = Math.max(0.3, Math.min(1.2, y));
  }

  // droughts per mode lobe
  for (let k = 0; k < MODES; k++) {
    const amp = s.modeAmp[k];
    const lobe: number[] = [];
    for (let i = 0; i < w.n; i++) if (w.land[i] && amp * s.modeField[k][i] < -0.26) lobe.push(i);
    const active = mem.droughtByMode[k];
    if (active === null && lobe.length > 70) {
      const year = y0 + rng.int(0, 9);
      const ev = event(s, 'drought', year, { cell: lobe[Math.floor(lobe.length / 2)], data: { mode: k, cells: lobe.length }, sig: Math.min(0.75, 0.25 + lobe.length / 600) });
      const a: ClimateAnomaly = { id: s.anomalies.length, kind: 'drought', start: year, end: year, cells: lobe, severity: Math.abs(amp), volcanoCell: -1, nameId: null, event: ev.id };
      s.anomalies.push(a);
      ev.parts.push([ref('cli', a.id), 'anomaly']);
      mem.droughtByMode[k] = a.id;
    } else if (active !== null) {
      const a = s.anomalies[active];
      if (lobe.length < 35) {
        a.end = Math.max(a.start + 1, y0 + rng.int(0, 9));
        s.events[a.event].end = a.end;
        mem.droughtByMode[k] = null;
      } else {
        a.end = y0 + 9;
        s.events[a.event].end = a.end;
        a.severity = Math.max(a.severity, Math.abs(amp));
      }
    }
  }

  // cold spells
  if (s.tempAnom < -0.45) {
    if (mem.coldSince === null) mem.coldSince = y0;
    if (mem.coldAnomaly === null && y0 - mem.coldSince >= 20) {
      const year = mem.coldSince;
      const ev = event(s, 'cold-period', year, { data: { anomaly: s.tempAnom }, sig: 0.5 });
      const a: ClimateAnomaly = { id: s.anomalies.length, kind: 'cold', start: mem.coldSince, end: year, cells: [], severity: -s.tempAnom, volcanoCell: -1, nameId: null, event: ev.id };
      s.anomalies.push(a);
      ev.parts.push([ref('cli', a.id), 'anomaly']);
      mem.coldAnomaly = a.id;
    } else if (mem.coldAnomaly !== null) {
      const a = s.anomalies[mem.coldAnomaly];
      a.end = y0 + 9;
      s.events[a.event].end = a.end;
      a.severity = Math.max(a.severity, -s.tempAnom);
    }
  } else {
    mem.coldSince = null;
    mem.coldAnomaly = null;
  }
}

/** The climate anomaly (if any) active at `cell` during [y0, y0+9]. */
export function activeAnomalyAt(s: State, cell: number, y0: number): ClimateAnomaly | null {
  let best: ClimateAnomaly | null = null;
  for (let i = s.anomalies.length - 1; i >= 0 && i > s.anomalies.length - 40; i--) {
    const a = s.anomalies[i];
    if (a.start > y0 + 9 || a.end < y0) continue;
    if (a.kind === 'cold' || a.kind === 'warming' || a.cells.includes(cell)) {
      if (!best || a.severity > best.severity) best = a;
    }
  }
  return best;
}

function neighborhood(s: State, cell: number, rings: number): number[] {
  const seen = new Set([cell]);
  let frontier = [cell];
  for (let r = 0; r < rings; r++) {
    const next: number[] = [];
    for (const f of frontier) for (const k of s.world.neighbors[f]) if (!seen.has(k) && s.world.land[k]) { seen.add(k); next.push(k); }
    frontier = next;
  }
  return [...seen];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
