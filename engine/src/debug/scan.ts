// Score candidate seeds for the canonical world: node engine/src/debug/scan.ts <from> <to>
import { simulate } from '../sim/run.ts';
import { TK } from '../sim/tech.ts';

const from = Number(process.argv[2] ?? 1), to = Number(process.argv[3] ?? from);
for (let seed = from; seed <= to; seed++) {
  const t = performance.now();
  const r = simulate(seed, 5000);
  const s = r.state;
  const first = (k: string) => { let b = 9999; for (const p of s.polities) { const y = p.techs.get(TK[k]); if (y !== undefined && y < b) b = y; } return b; };
  const peak = new Map<number, number>();
  for (const row of s.polityYears) peak.set(row[0] as number, Math.max(peak.get(row[0] as number) ?? 0, row[2] as number));
  const empires = [...peak.values()].filter((v) => v >= 150).length;
  const bigCollapses = s.events.filter((e) => e.sub === 'collapse' && (peak.get(Number(e.parts[0][0].slice(4))) ?? 0) >= 80).length;
  const subs = (k: string) => s.events.filter((e) => e.sub === k).length;
  const continental = s.events.filter((e) => e.sub === 'first-contact' && e.data.continents).map((e) => e.year);
  const longest = Math.max(...s.polities.map((p) => (p.died ?? 5000) - p.born));
  let pop = 0; for (let i = 0; i < s.world.n; i++) pop += s.pop[i];
  const vei7 = s.anomalies.filter((a) => a.kind === 'eruption' && a.severity >= 7).length;
  const m = {
    seed, steam: first('steam'), computing: first('computing'), empires, bigCollapses, tradeCollapse: subs('trade-collapse'), vei7,
    continental: continental[0] ?? null, colonies: subs('colonization'), revolutions: subs('revolution'), wars: subs('war'),
    languages: s.lang.languages().length, families: s.lang.languages().filter((l) => l.parent === null).length,
    longest, popB: Math.round(pop / 1e7) / 100, plagues: subs('plague'), schisms: subs('schism'), secs: Math.round((performance.now() - t) / 1000),
  };
  let score = 0;
  score += m.steam >= 4650 && m.steam <= 4860 ? 2 : 0;
  score += m.computing <= 4995 ? 1 : 0;
  score += Math.min(4, m.empires) * 0.75;
  score += Math.min(6, m.bigCollapses) * 0.5;
  score += m.tradeCollapse > 0 ? 1.5 : 0;
  score += m.vei7 > 0 ? 1 : 0;
  score += m.continental !== null && m.continental >= 3600 && m.continental <= 4750 ? 3 : 0;
  score += Math.min(20, m.colonies) * 0.1;
  score += Math.min(6, m.revolutions) * 0.25;
  score += m.longest >= 600 ? 1 : 0;
  score += Math.min(6, m.schisms) * 0.15;
  console.log(JSON.stringify({ ...m, score: Math.round(score * 100) / 100 }));
}
