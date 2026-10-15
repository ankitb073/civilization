// Accessibility audit with axe-core over the main views, both themes.
// Usage: npm --prefix atlas run build && node atlas/scripts/a11y.ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PORT = 4185;
const server = await serveDist(join(ROOT, 'dist'), PORT);
const meta = JSON.parse(readFileSync(join(ROOT, 'dist', 'data', 'meta.json'), 'utf8'));
// the book (History, else Lives) and the newest genres
const search = (JSON.parse(readFileSync(join(ROOT, 'dist', 'data', 'search.json'), 'utf8')).entries as string[][]);
const genre = (sub: string) => search.find((e) => e[2] === 'artifact' && e[5] === sub)?.[0];
let book: { id: string; items: { id: string }[] } | undefined;
try { const cols = JSON.parse(readFileSync(join(ROOT, 'dist', 'data', 'collections.json'), 'utf8')).collections; book = cols.find((c: { id: string }) => c.id === 'history') ?? cols.find((c: { id: string }) => c.id === 'lives'); } catch { /* older export */ }
const extra = [
  ...(book ? [['book', `#/collections/${book.id}`], ['chapter', `#/p/${book.items[Math.min(1, book.items.length - 1)].id}`]] : []),
  ...['omen', 'tariff', 'periplus'].map((sub) => [sub, `#/p/${genre(sub)}`]).filter(([, h]) => !h.endsWith('undefined')),
];
// the Word Machine: the picker, and a word with a derivation open (the editorial language)
let edLang = '';
try { edLang = JSON.parse(readFileSync(join(ROOT, 'dist', 'data', 'words', 'index.json'), 'utf8')).sampleLanguage; } catch { /* older export */ }
if (edLang) extra.push(['words', '#/words'], ['word', `#/words/water?y=2112&l=${edLang}`], ['word-early', '#/words/king?y=-1500']);
const views = [
  ['map', '#/map?y=2600'], ['story', '#/story'], ['histomap', '#/histomap'], ['languages', '#/languages'], ['graph', '#/graph?y=3000'],
  ['browse', '#/browse'], ['about', '#/about'], ['collections', '#/collections'], ['year', '#/year/2310'], ['prices', '#/prices'],
  ['war', `#/p/${meta.featured[0].id}`], ['compare', `#/compare/${meta.featured[0].id}`], ['polity', `#/p/${meta.featured.find((f: { id: string }) => f.id.startsWith('pol:'))?.id}`],
  ['inscription', `#/p/${meta.featured.find((f: { id: string; title: string }) => /inscription/i.test(f.title))?.id ?? meta.featured[0].id}`],
  ...extra,
];
const browser = await chromium.launch();
const totals = new Map<string, { impact: string; help: string; count: number; where: Set<string> }>();
try {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [name, hash] of views) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${PORT}/civilization/${hash}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(name === 'graph' ? 2500 : 900);
      await page.addScriptTag({ content: AXE });
      const res = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) }));
      });
      for (const v of res) {
        const k = v.id;
        const t = totals.get(k) ?? { impact: v.impact, help: v.help, count: 0, where: new Set<string>() };
        t.count += v.n;
        t.where.add(`${name}/${scheme}: ${v.sample.join(' | ')}`);
        totals.set(k, t);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (!totals.size) console.log('axe: no violations');
for (const [id, t] of [...totals.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`\n${t.impact.toUpperCase()} ${id} ×${t.count}: ${t.help}`);
  for (const w of [...t.where].slice(0, 6)) console.log(`   ${w.slice(0, 220)}`);
}
