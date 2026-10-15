// Demo: four families evolving over 5,000 years. Run: node engine/src/lang/demo.ts
import { LanguageEngine } from './index.ts';
import type { NameId, LangId, Clause } from './index.ts';

const seed = Number(process.argv[2] ?? 7);
const e = new LanguageEngine(seed);

const fams: LangId[] = [];
for (let f = 0; f < 4; f++) fams.push(e.createProto(-1500 + f * 100, `fam${f}`));
// splits
const d: Record<string, LangId> = {};
d.a1 = e.split(fams[0], 400, 'a1');
d.a2 = e.split(fams[0], 1600, 'a2');
d.a1x = e.split(d.a1, 2800, 'a1x');
d.b1 = e.split(fams[1], 900, 'b1');
d.c1 = e.split(fams[2], 1200, 'c1');
d.d1 = e.split(fams[3], 2100, 'd1');
e.retire(fams[0], 3300);
e.advanceTo(5000);
for (let i = 0; i < fams.length; i++) e.recordContact(fams[i], fams[(i + 1) % fams.length], 1500 + i * 300);
e.recordContact(d.a1x, fams[1], 3000);

const years = [0, 1000, 2500, 4000, 5000];
const label = (l: LangId) => {
  const info = e.info(l);
  return `${e.realize(info.endonym, l, info.born).conventional}[${e.familyStyle(l)}#${l}]`;
};

console.log('=== Names through time (native lineage) ===');
for (const f of fams) {
  const daughter = Object.values(d).find((x) => e.info(x).parent === f && e.info(x).died === null) ?? f;
  const kinds = ['settlement', 'settlement', 'person-m', 'person-f', 'deity', 'river', 'people'] as const;
  console.log(`\n${label(f)} → ${label(daughter)}`);
  kinds.forEach((k, i) => {
    const n = e.coinName(f, 0, k, `demo-${f}-${i}`);
    const forms = years.map((y) => e.realize(n, y < e.info(daughter).born ? f : daughter, y).conventional);
    const m = e.nameMeaning(n);
    console.log(`  ${k.padEnd(10)} ${forms.join(' → ')}${m ? `   '${m}'` : ''}`);
  });
}

console.log('\n=== Exonyms at AY 4000 (one settlement per family, as named by every living language) ===');
const live = e.languages().filter((l) => l.died === null).map((l) => l.id);
for (const f of fams) {
  const n = e.coinName(f, 100, 'settlement', `exo-${f}`);
  const row = live.map((l) => `${e.realize(n, l, 4000).conventional}`).join(' | ');
  console.log(`  ${label(f).padEnd(22)} ${row}`);
}

console.log('\n=== Sound changes ===');
for (const l of [fams[0], d.a1x, fams[1], fams[2], fams[3]]) {
  const sc = e.soundChanges(l, 5000);
  console.log(`\n${label(l)} (${sc.length} changes)`);
  for (const c of sc.slice(0, 14)) console.log(`  AY ${String(c.year).padStart(5)}  ${c.label.padEnd(26)} ${c.rule}  [${c.lang}]`);
}

console.log('\n=== Swadesh-style words through time ===');
const concepts = ['water', 'king', 'god', 'city', 'mother', 'fire', 'stone', 'silver', 'great', 'give'];
for (const l of [d.a1x, fams[1], fams[2], d.d1]) {
  console.log(`\n${label(l)}  proto ${concepts.map((c) => e.protoForm(l, c)).join(' ')}`);
  for (const y of [0, 2500, 5000]) console.log(`  AY ${String(y).padStart(4)}  ${concepts.map((c) => e.word(l, c, y).conventional).join('  ')}`);
}

console.log('\n=== Inscriptions ===');
const scriptLang = fams[1];
const cases: { lang: LangId; kind: 'logosyllabic' | 'abjad' | 'alphabet'; origin: LangId; year: number }[] = [
  { lang: fams[0], kind: 'logosyllabic', origin: scriptLang, year: 600 },
  { lang: d.a1, kind: 'abjad', origin: d.a1, year: 2300 },
  { lang: fams[3], kind: 'alphabet', origin: fams[3], year: 3600 },
];
for (const c of cases) {
  const ruler = e.coinName(c.lang, c.year - 30, 'person-m', `ruler-${c.lang}`);
  const city = e.coinName(c.lang, c.year - 500, 'settlement', `city-${c.lang}`);
  const god = e.coinName(c.lang, c.year - 900, 'deity', `god-${c.lang}`);
  const resolve = (n: NameId) => e.realize(n, c.lang, c.year).conventional;
  const clauses: Clause[] = [
    {
      verb: 'build', mood: 'past',
      subject: { head: { name: ruler }, determinative: 'person', apposition: [{ head: { concept: 'great-king' } }, { head: { concept: 'king' }, possessor: { head: { name: city }, determinative: 'place' } }] },
      object: { head: { concept: 'temple' }, demonstrative: true },
      obliques: [{ role: 'benefactive', np: { head: { name: god }, determinative: 'deity', apposition: [{ head: { concept: 'lord' }, possessorPronoun: '3sg.m' }] } }],
    },
    {
      verb: 'destroy', mood: 'optative',
      subject: { head: { name: god }, determinative: 'deity' },
      object: { head: { concept: 'name' }, possessorPronoun: '3sg.m' },
    },
  ];
  const r = e.renderClause(c.lang, c.year, { kind: c.kind, originLang: c.origin }, clauses, resolve);
  console.log(`\n[${c.kind}] ${label(c.lang)} AY ${c.year}`);
  console.log('  translit:  ' + r.transliteration);
  console.log('  normal:    ' + r.normalized);
  console.log('  segmented: ' + r.tokens.map((t) => t.segmented).join(' '));
  console.log('  gloss:     ' + r.tokens.map((t) => t.gloss).join(' '));
  console.log('  transl:    ' + r.translation);
}
