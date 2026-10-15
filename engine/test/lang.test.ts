import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LanguageEngine } from '../src/lang/index.ts';
import type { NameId, LangId, Clause, NameKind } from '../src/lang/index.ts';
import { PHONS } from '../src/lang/phonology.ts';

const SYMS = PHONS.map((p) => p.sym).sort((a, b) => b.length - a.length);
const SYM_ID = new Map(PHONS.map((p) => [p.sym, p.id]));

function parseIpa(s: string): number[] {
  const body = s.replace(/^\//, '').replace(/\/$/, '').replace(/[ -]/g, '');
  const out: number[] = [];
  let i = 0;
  while (i < body.length) {
    const m = SYMS.find((sy) => body.startsWith(sy, i));
    if (!m) throw new Error(`unparseable ipa ${s} at ${i}`);
    out.push(SYM_ID.get(m)!);
    i += m.length;
  }
  return out;
}

function world(seed = 42): { e: LanguageEngine; roots: LangId[]; kids: LangId[] } {
  const e = new LanguageEngine(seed);
  const roots: LangId[] = [];
  for (let f = 0; f < 5; f++) roots.push(e.createProto(-1000, `fam${f}`));
  const kids = [e.split(roots[0], 800, 'k0'), e.split(roots[1], 1500, 'k1'), e.split(roots[2], 2600, 'k2')];
  kids.push(e.split(kids[0], 2200, 'k3'));
  e.recordContact(roots[0], roots[1], 400);
  e.recordContact(kids[1], roots[3], 2000);
  e.recordContact(roots[4], kids[3], 3000);
  return { e, roots, kids };
}

const KINDS: NameKind[] = ['settlement', 'person-m', 'person-f', 'deity', 'river', 'people', 'region', 'mountain', 'sea'];

test('determinism across call orders', () => {
  const a = world(7);
  const b = world(7);
  b.e.advanceTo(5000); // materialize everything first in b only
  const keysA = new Map<string, NameId>();
  const keysB = new Map<string, NameId>();
  const specs: [LangId, number, NameKind, string][] = [];
  for (const l of [...a.roots, ...a.kids]) for (let i = 0; i < 6; i++) specs.push([l, 300 + i * 500, KINDS[i % KINDS.length], `n-${l}-${i}`]);
  for (const s of specs) keysA.set(s[3], a.e.coinName(s[0], s[1], s[2], s[3]));
  for (const s of specs.slice().reverse()) keysB.set(s[3], b.e.coinName(s[0], s[1], s[2], s[3]));
  for (const s of specs) {
    for (const y of [5000, 1000, 3000, s[1]]) {
      const ra = a.e.realize(keysA.get(s[3])!, s[0], y);
      const rb = b.e.realize(keysB.get(s[3])!, s[0], y);
      assert.deepEqual(ra, rb, `${s[3]} at ${y}`);
    }
  }
  for (const l of a.kids) assert.deepEqual(a.e.soundChanges(l, 5000), b.e.soundChanges(l, 5000));
});

test('daughter inherits parent rules only up to the split year', () => {
  const { e, roots, kids } = world(11);
  e.advanceTo(5000);
  const parentRules = e.soundChanges(roots[0], 5000);
  const kidRules = e.soundChanges(kids[0], 5000);
  const split = e.info(kids[0]).born;
  const inheritedFromParent = kidRules.filter((r) => r.lang === roots[0]);
  assert.deepEqual(inheritedFromParent, parentRules.filter((r) => r.year <= split));
  assert.ok(parentRules.some((r) => r.year > split), 'parent keeps changing after the split');
  assert.ok(kidRules.some((r) => r.lang === kids[0] && r.year > split), 'daughter has its own changes');
  for (const r of kidRules.filter((r) => r.lang === kids[0])) assert.ok(r.year > split);
});

test('a name realized in its coinage year is the coined form, stable until the next change', () => {
  const { e, roots } = world(3);
  const data = () => e.toJSON() as { names: { s: number[][] }[] };
  for (const l of roots) {
    const y = 1234;
    const n = e.coinName(l, y, 'settlement', `stable-${l}`);
    const r = e.realize(n, l, y);
    const segs = data().names[n].s;
    assert.equal(r.ipa, '/' + segs.map((s) => s.map((p) => PHONS[p].sym).join('')).join('') + '/');
    const next = e.soundChanges(l, 5000).find((c) => c.year > y);
    if (next) assert.deepEqual(e.realize(n, l, next.year - 1), r);
  }
});

test('every realization is non-empty and obeys phonotactics', () => {
  const { e, roots, kids } = world(19);
  const langs = [...roots, ...kids];
  const names: NameId[] = [];
  for (const l of langs) for (let i = 0; i < 12; i++) names.push(e.coinName(l, -500 + i * 400, KINDS[i % KINDS.length], `p-${l}-${i}`));
  for (const n of names) {
    for (const m of langs) {
      for (const y of [0, 1500, 3000, 5000]) {
        if (y < e.nameOrigin(n).year) continue; // realizing before coinage is anachronistic
        const r = e.realize(n, m, y);
        assert.ok(r.conventional.length > 0 && r.scholarly.length > 0);
        assert.match(r.conventional, /[aeiouyäöüâêîôûáéíóúèò]/i, `${r.conventional} has a vowel letter`);
        const ph = parseIpa(r.ipa);
        assert.ok(ph.some((p) => PHONS[p].v), `${r.ipa} has a vowel`);
        const inv = e.symbolicInventory(m, Math.max(y, e.info(m).born));
        for (const p of ph) assert.ok(inv.has(p), `${PHONS[p].sym} in ${r.ipa} is in the inventory of ${m} at ${y}`);
        let run = 0;
        for (const p of ph) {
          run = PHONS[p].v ? 0 : run + 1;
          assert.ok(run <= 4, `no 5-consonant clusters: ${r.ipa}`);
        }
      }
    }
  }
});

test('exonym adaptation removes foreign phonemes', () => {
  const { e, roots } = world(23);
  e.advanceTo(5000);
  let foreignSeen = 0;
  for (const src of roots) {
    for (const dst of roots) {
      if (src === dst) continue;
      for (let i = 0; i < 8; i++) {
        const n = e.coinName(src, 500, 'settlement', `x-${src}-${dst}-${i}`);
        const native = parseIpa(e.realize(n, src, 500).ipa);
        const dstInv = e.symbolicInventory(dst, 2500);
        if (native.some((p) => !dstInv.has(p))) foreignSeen++;
        for (const p of parseIpa(e.realize(n, dst, 2500).ipa)) assert.ok(dstInv.has(p));
      }
    }
  }
  assert.ok(foreignSeen > 0, 'the test exercised at least one foreign phoneme');
});

function inscription(e: LanguageEngine, l: LangId, year: number) {
  const ruler = e.coinName(l, year - 20, 'person-m', `ruler-${l}-${year}`);
  const city = e.coinName(l, year - 300, 'settlement', `city-${l}-${year}`);
  const god = e.coinName(l, year - 600, 'deity', `god-${l}-${year}`);
  const clauses: Clause[] = [
    {
      verb: 'build', mood: 'past',
      subject: { head: { name: ruler }, apposition: [{ head: { concept: 'king' }, possessor: { head: { name: city } } }] },
      object: { head: { concept: 'temple' }, demonstrative: true },
      obliques: [{ role: 'dative', np: { head: { name: god }, determinative: 'deity' } }, { role: 'locative', np: { head: { name: city } } }],
    },
    { verb: 'curse', mood: 'optative', subject: { head: { name: god } }, object: { head: { concept: 'name' }, possessorPronoun: '3sg.m' } },
  ];
  const resolve = (n: NameId) => e.realize(n, l, year).conventional;
  return { r: e.renderClause(l, year, { kind: 'logosyllabic', originLang: l }, clauses, resolve), names: [ruler, city, god].map(resolve) };
}

test('glosses contain case labels for a case language; translation mentions every name', () => {
  const { e, roots } = world(31);
  let caseLangs = 0;
  for (const l of roots) {
    const { r, names } = inscription(e, l, 1200);
    const cases = e.info(l).typology.cases;
    const glosses = r.tokens.map((t) => t.gloss).join(' ');
    if (cases.includes('GEN') || cases.includes('DAT') || cases.includes('LOC')) {
      caseLangs++;
      assert.match(glosses, /GEN|DAT|LOC/, `case labels in ${glosses}`);
    }
    for (const n of names) assert.ok(r.translation.includes(n), `${n} in "${r.translation}"`);
    assert.ok(r.transliteration.length > 0);
  }
  assert.ok(caseLangs > 0);
});

test('toJSON/fromJSON round-trips to identical realizations', () => {
  const { e, roots, kids } = world(57);
  const langs = [...roots, ...kids];
  const names: NameId[] = [];
  for (const l of langs) for (let i = 0; i < 5; i++) names.push(e.coinName(l, i * 700, KINDS[i], `rt-${l}-${i}`));
  e.localize(names[0], kids[1], 2500);
  e.retire(roots[3], 3500);
  e.advanceTo(5000);
  const copy = LanguageEngine.fromJSON(JSON.parse(JSON.stringify(e.toJSON())));
  for (const n of names) for (const m of langs) for (const y of [100, 2600, 5000]) assert.deepEqual(copy.realize(n, m, y), e.realize(n, m, y));
  for (const l of langs) {
    assert.deepEqual(copy.soundChanges(l, 5000), e.soundChanges(l, 5000));
    assert.deepEqual(copy.word(l, 'king', 4000), e.word(l, 'king', 4000));
    assert.deepEqual(copy.info(l), e.info(l));
  }
  const a = inscription(e, roots[0], 900).r;
  const b = inscription(copy, roots[0], 900).r;
  assert.deepEqual(a, b);
});
