// Write the EPUB reader only (for checking the book without a full build): node engine/src/cli/reader.ts [out.epub]
import { simulate } from '../sim/run.ts';
import { buildArchive } from '../archive/build.ts';
import { writeReader } from '../export/book.ts';

const out = process.argv[2] ?? 'build/palimpsest-reader.epub';
const r = simulate(5, 5000);
const a = buildArchive(r);
const b = writeReader(r, a, out, { cover: 'atlas/public/og.png' });
console.log(`${out}: ${b.docs} documents, ${(b.bytes / 1e6).toFixed(2)} MB`);
