// Full data build: simulate (flushing each century to SQLite) → archive → database → atlas export.
import { simulate } from '../sim/run.ts';
import { WorldDb } from '../db/writer.ts';
import { buildArchive } from '../archive/build.ts';

const args = process.argv.slice(2);
const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.SEED ?? 1);
const t = performance.now();
const log = (m: string) => console.log(`[${((performance.now() - t) / 1000).toFixed(1)}s] ${m}`);
const db = new WorldDb('build/world.sqlite');
const r = simulate(seed, 5000, {
  onStart: (res) => db.writeWorld(res),
  onCentury: (res, year) => db.flushCentury(res, year),
});
log(`simulated: ${r.state.events.length} events`);
const archive = buildArchive(r, log);
db.finalize(r);
db.writeArchive(archive);
log('database written');
db.close();
