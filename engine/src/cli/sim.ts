// Run the simulation century by century, flushing each century into the world database.
import { simulate } from '../sim/run.ts';
import { WorldDb } from '../db/writer.ts';

const args = process.argv.slice(2);
const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.SEED ?? 5);
const yearEnd = Number(args.find((a) => a.startsWith('--end='))?.slice(6) ?? 5000);
const out = args.find((a) => a.startsWith('--db='))?.slice(5) ?? 'build/world.sqlite';
const quiet = args.includes('--quiet');
const t = performance.now();
const db = new WorldDb(out);
const r = simulate(seed, yearEnd, {
  onStart: (res) => db.writeWorld(res),
  onCentury: (res, year) => db.flushCentury(res, year),
  log: quiet ? undefined : (m) => console.log(m),
});
db.finalize(r);
db.close();
console.log(`seed ${seed}: ${r.state.events.length} events, ${r.state.persons.length} persons → ${out} in ${((performance.now() - t) / 1000).toFixed(1)}s`);
