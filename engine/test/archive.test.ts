// The archive layer on a short history: unique titles, resolvable bidirectional links, no anachronisms,
// ledgers priced from the market series, treaties matching the territory log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simulate } from '../src/sim/run.ts';
import { buildArchive } from '../src/archive/build.ts';
import type { Term } from '../src/sim/war.ts';

const r = simulate(5, 1500);
// build in an empty working directory so canonical-world flagships (flagships/*.md) are not ingested
const cwd = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'palimpsest-archive-'));
process.chdir(tmp);
let a: ReturnType<typeof buildArchive>;
try {
  a = buildArchive(r);
} finally {
  process.chdir(cwd);
  rmSync(tmp, { recursive: true, force: true });
}
const s = r.state;
const LINK = /\[\[([a-z]{3}:\d+)\|/g;

const isExcavation = (ref: string) => ref.startsWith('evt:') && s.events[Number(ref.slice(4))].sub === 'excavation';

test('every page title is unique', () => {
  const seen = new Map<string, string>();
  for (const ref of a.T.pageRefs) {
    const t = a.T.title.get(ref) ?? (isExcavation(ref) ? undefined : '');
    if (t === undefined) continue; // known gap, see the todo test below
    assert.ok(t, `${ref} has no title`);
    const k = t!.toLowerCase();
    assert.ok(!seen.has(k), `title "${t}" used by ${seen.get(k)} and ${ref}`);
    seen.set(k, ref);
  }
});

test('archive-created excavation events have editorial titles', { todo: 'engine: excavation events get no title; their pages show raw ids such as "evt:10643"' }, () => {
  const missing = [...a.T.pageRefs].filter((ref) => isExcavation(ref) && !a.T.title.get(ref));
  assert.equal(missing.length, 0, `${missing.length} excavation events without a title, e.g. ${missing[0]}`);
});

test('every link resolves to a page and is mirrored by a backlink', () => {
  let n = 0;
  for (const pg of a.pages.values()) {
    for (const txt of [pg.body, ...pg.infobox.map(([, v]) => v)]) {
      for (const m of txt.matchAll(LINK)) {
        assert.ok(a.pages.has(m[1]), `${pg.id} links to missing ${m[1]}`);
        n++;
      }
    }
    for (const l of pg.links) assert.ok(a.pages.get(l)!.backlinks.includes(pg.id), `${l} lacks backlink to ${pg.id}`);
    for (const b of pg.backlinks) assert.ok(a.pages.get(b)?.links.includes(pg.id), `${pg.id} lists backlink ${b} that does not link to it`);
  }
  assert.ok(n > 1000, `only ${n} links`);
});

function startOf(ref: string): number | null {
  const id = Number(ref.slice(4));
  switch (ref.slice(0, 3)) {
    case 'pol': return s.polities[id].born;
    case 'per': return s.persons[id].born;
    case 'set': return s.settlements[id].founded;
    case 'mov': return s.movements[id].born;
    case 'dei': return s.deities[id].born;
    case 'cur': return s.currencies[id].born;
    case 'hou': return s.houses[id].born;
    case 'scr': return s.scripts[id].born;
    case 'lan': return s.lang.info(id).born;
    case 'cul': return s.cultures[id].born;
    case 'evt': return s.events[id].year;
    default: return null;
  }
}

test('no document mentions anything that did not yet exist at its date', () => {
  let checked = 0;
  for (const art of a.artifacts) {
    const text = art.body.split('\n---\n')[0];
    for (const m of text.matchAll(LINK)) {
      const st = startOf(m[1]);
      if (st === null) continue;
      checked++;
      assert.ok(st <= art.year, `art:${art.id} (${art.sub}, AY ${art.year}) mentions ${m[1]} (from AY ${st})`);
    }
  }
  assert.ok(checked > 500, `only ${checked} in-text links checked`);
});

test('ledger prices are within 20% of the simulated market series', () => {
  const pb = r.econ.priceBuf;
  const prices = new Map<string, number>();
  for (let i = 0; i < pb.length; i += 4) prices.set(`${pb[i + 1]}:${pb[i + 2]}:${pb[i]}`, pb[i + 3]);
  let n = 0;
  for (const art of a.artifacts) {
    if (art.sub !== 'ledger') continue;
    const entries = (art.data?.entries ?? []) as { market: number; good: number; unit: number; grams: number }[];
    for (const e of entries) {
      let ref: number | undefined;
      for (let y = Math.floor(art.year / 10) * 10; y >= art.year - 60 && ref === undefined; y -= 10) ref = prices.get(`${e.market}:${e.good}:${y}`);
      assert.ok(ref !== undefined, `art:${art.id}: no market price for ${e.market}/${e.good}`);
      const silver = e.unit * e.grams;
      assert.ok(Math.abs(silver / ref! - 1) <= 0.2, `art:${art.id}: ${silver.toFixed(3)} g vs market ${ref!.toFixed(3)} g`);
      n++;
    }
  }
  assert.ok(n > 0, 'no ledger entries in a 1,500-year history');
});

test('every ceded district appears in the territory log under its treaty', () => {
  const L = s.territoryLog;
  const byEvent = new Map<number, Map<number, number>>();
  for (let i = 0; i < L.length; i += 4) {
    const ev = L[i + 3];
    if (ev < 0) continue;
    if (!byEvent.has(ev)) byEvent.set(ev, new Map());
    byEvent.get(ev)!.set(L[i + 1], L[i + 2]);
  }
  let n = 0;
  for (const e of s.events) {
    if (e.sub !== 'treaty') continue;
    for (const t of (e.data.terms as Term[] | undefined) ?? []) {
      if (t.kind !== 'cede') continue;
      for (const c of t.cells ?? []) {
        assert.equal(byEvent.get(e.id)?.get(c), t.to, `evt:${e.id} cedes cell ${c} to pol:${t.to}`);
        n++;
      }
    }
  }
  assert.ok(n > 0, 'no cessions in a 1,500-year history');
});

test('the EPUB reader is a valid zip with mimetype first and well-formed XHTML', async () => {
  const { writeReader } = await import('../src/export/book.ts');
  const { execFileSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'palimpsest-epub-'));
  try {
    const path = join(dir, 'r.epub');
    writeReader(r, a, path);
    const buf = readFileSync(path);
    // mimetype must be the first entry, stored uncompressed, so readers can sniff it at offset 38
    assert.equal(buf.subarray(30, 38).toString(), 'mimetype');
    assert.equal(buf.readUInt16LE(8), 0);
    assert.equal(buf.subarray(38, 58).toString(), 'application/epub+zip');
    const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(names.includes('OEBPS/content.opf') && names.includes('OEBPS/nav.xhtml'));
    for (const n of names.filter((x) => x.endsWith('.xhtml') || x.endsWith('.opf'))) {
      const xml = execFileSync('unzip', ['-p', path, n], { encoding: 'utf8', maxBuffer: 1 << 26 });
      const stack: string[] = [];
      for (const m of xml.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
        if (m[3]) continue;
        if (m[1]) assert.equal(stack.pop(), m[2], `${n}: </${m[2]}> closes the wrong element`);
        else stack.push(m[2]);
      }
      assert.deepEqual(stack, [], `${n}: unclosed ${stack.join(', ')}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
