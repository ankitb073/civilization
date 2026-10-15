import { simulate } from '../sim/run.ts';
const seed = Number(process.argv[2] ?? 1);
const end = Number(process.argv[3] ?? 5000);
const r = simulate(seed, end);
const s = r.state;
const subs = new Map<string, number>();
for (const e of s.events) subs.set(e.sub, (subs.get(e.sub) ?? 0) + 1);
console.log([...subs].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
const ends = new Map<string, number>();
for (const p of s.polities) { const k = p.endEvent !== null ? s.events[p.endEvent].sub : 'alive'; ends.set(k, (ends.get(k) ?? 0) + 1); }
console.log('polity ends', [...ends].map(([k, v]) => `${k}:${v}`).join(' '), 'total', s.polities.length);
const life = s.polities.filter(p => p.died !== null).map(p => p.died! - p.born).sort((a, b) => a - b);
console.log('lifespan median', life[Math.floor(life.length / 2)], 'p90', life[Math.floor(life.length * 0.9)]);
const owned = s.owner.filter(o => o >= 0).length; let land = 0; for (let i = 0; i < s.world.n; i++) land += s.world.land[i];
console.log('owned cells', owned, 'of land', land);
const wars = s.events.filter(e => e.sub === 'war');
const outcomes = new Map<string, number>(); for (const w of wars) outcomes.set(String(w.data.outcome), (outcomes.get(String(w.data.outcome)) ?? 0) + 1);
console.log('war outcomes', [...outcomes].map(([k, v]) => `${k}:${v}`).join(' '));
const firstTech = new Map<number, number>(); for (const p of s.polities) for (const [t, y] of p.techs) if (!firstTech.has(t) || y < firstTech.get(t)!) firstTech.set(t, y);
import('../sim/tech.ts').then(({ TECHS }) => console.log('techs', TECHS.map(t => `${t.key}:${firstTech.get(t.id) ?? '-'}(${t.target})`).join(' ')));
const buckets = new Map<number, number>(); for (const w of wars) { const b = Math.floor(w.year / 500) * 500; buckets.set(b, (buckets.get(b) ?? 0) + 1); }
console.log('wars per 500y', [...buckets].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '));
const alive = (y: number) => s.polities.filter(p => p.born <= y && (p.died === null || p.died > y)).length;
console.log('polities alive', [500, 1000, 2000, 3000, 4000, 4500, 4800, 5000].map(y => `${y}:${alive(y)}`).join(' '));
const kinds = new Map<string, number[]>(); for (const p of s.polities) { const k = s.events[p.foundEvent].sub; if (!kinds.has(k)) kinds.set(k, []); kinds.get(k)!.push((p.died ?? 5000) - p.born); }
console.log('lifespan by origin', [...kinds].map(([k, v]) => { v.sort((a, b) => a - b); return `${k}:n${v.length} med${v[Math.floor(v.length / 2)]}`; }).join(' '));
const nonRebel = s.polities.filter(p => p.kind !== 'rebel' && s.events[p.foundEvent].sub !== 'revolt' && s.events[p.foundEvent].sub !== 'civil-war').map(p => (p.died ?? 5000) - p.born).sort((a, b) => a - b);
console.log('non-rebel lifespan median', nonRebel[Math.floor(nonRebel.length / 2)], 'p75', nonRebel[Math.floor(nonRebel.length * 0.75)], 'p95', nonRebel[Math.floor(nonRebel.length * 0.95)], 'n', nonRebel.length);
