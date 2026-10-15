// Run the simulation and write the world database.
import { simulate } from '../sim/run.ts';

const args = process.argv.slice(2);
const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? 1);
const yearEnd = Number(args.find((a) => a.startsWith('--end='))?.slice(6) ?? 5000);
const t = performance.now();
const r = simulate(seed, yearEnd, { log: (m) => console.log(m) });
console.log(`done in ${((performance.now() - t) / 1000).toFixed(1)}s: ${r.state.events.length} events, ${r.state.persons.length} persons`);
