// cities.json: what a city's 3D model (#/city/set:N, atlas/src/three/city) is generated from, beyond timeline.json
// and the city's page. All of it is read from the record: who held the city's ground and which people lived on it
// (the territory and culture logs at its cell), its sacks and harbour, and each state's faith and technological age
// (the decadal survey). Change points only, so the file stays small; it is fetched only by the city view.
import type { SimResult } from '../sim/run.ts';
import type { Archive } from '../archive/build.ts';
import type { CitiesJson } from './contract.ts';

export function citiesJson(r: SimResult, a: Archive): CitiesJson {
  const s = r.state;
  const short = (id: string) => a.T.short.get(id) ?? '';
  const bySite = new Map<number, number[]>();
  for (const t of s.settlements) {
    const l = bySite.get(t.cell);
    if (l) l.push(t.id); else bySite.set(t.cell, [t.id]);
  }
  // replay a [year, cell, value, event] log for the settlements' cells only: [year, value, …] from the founding
  const track = (initial: Int32Array, log: number[]): number[][] => {
    const out = s.settlements.map((t) => [t.founded, initial[t.cell]]);
    for (let i = 0; i < log.length; i += 4) {
      const ids = bySite.get(log[i + 1]);
      if (!ids) continue;
      for (const id of ids) {
        const o = out[id];
        const y = Math.max(log[i], s.settlements[id].founded);
        if (o[o.length - 1] === log[i + 2]) continue;
        if (o[o.length - 2] === y) o[o.length - 1] = log[i + 2];
        else o.push(y, log[i + 2]);
      }
    }
    return out;
  };
  // the decadal survey: [id, year, …, religion (11), …, technological age (13)]
  const states: number[][] = s.polities.map(() => []);
  for (const row of s.polityYears) {
    const o = states[row[0] as number];
    const faith = row[11] as number, era = row[13] as number;
    if (o.length && o[o.length - 2] === faith && o[o.length - 1] === era) continue;
    o.push(o.length ? (row[1] as number) : Math.min(row[1] as number, s.polities[row[0] as number].born), faith, era);
  }
  return {
    owners: track(r.initial.owner, s.territoryLog),
    cultures: track(r.initial.culture, s.cultureLog),
    sacks: s.settlements.map((t) => t.sacks.map((e) => s.events[e].year)),
    port: s.settlements.map((t) => (t.port ? 1 : 0)),
    states,
    faiths: s.movements.map((m) => [short(`mov:${m.id}`), m.kind, m.parent ?? -1]),
    peoples: s.cultures.map((c) => short(`cul:${c.id}`)),
  };
}
