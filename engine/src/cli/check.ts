// Audit the world database. Exits non-zero on any violation (the CI gate).
import { writeFileSync } from 'node:fs';
import { runChecks } from '../check/check.ts';

const db = process.argv[2] ?? 'build/world.sqlite';
const r = runChecks(db);
writeFileSync('build/check.json', JSON.stringify(r, null, 2));
for (const i of r.invariants) {
  console.log(`${i.violations === 0 ? '✓' : '✗'} ${i.title}: ${i.checked.toLocaleString('en-US')} checked, ${i.violations} violations`);
  for (const ex of i.examples) console.log(`    ${ex}`);
}
console.log(r.passed ? `PASSED in ${r.ms} ms` : `FAILED in ${r.ms} ms`);
process.exit(r.passed ? 0 : 1);
