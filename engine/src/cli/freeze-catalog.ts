// Freeze the catalogue numbers of all flagships in flagships/catalog.json (run after a wave is accepted).
import { simulate } from '../sim/run.ts';
import { buildArchive } from '../archive/build.ts';
import { freezeCatalog } from '../flagships/ingest.ts';

const r = simulate(5, 5000);
const a = buildArchive(r);
console.log(`froze ${freezeCatalog(a.gen, 'flagships')} flagship catalogue numbers in flagships/catalog.json`);
