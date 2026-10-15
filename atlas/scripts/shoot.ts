// Screenshot key views of the built atlas at phone and desktop sizes.
// Usage: npm --prefix atlas run build && npm --prefix atlas run shoot [-- --only=map,page]
// Output: atlas/.shots/<name>-<viewport>[-dark].png, plus console errors on stdout.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { MetaJson, SearchJson } from '../../engine/src/export/contract.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.shots');
const DATA = join(ROOT, 'dist', 'data');
const PORT = 4179;
const BASE = `http://localhost:${PORT}/civilization/`;
mkdirSync(OUT, { recursive: true });

const only = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '').split(',').filter(Boolean);

// pick representative pages from the data (search.json carries kind + sub for every page)
const meta = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8')) as MetaJson;
const search = (JSON.parse(readFileSync(join(DATA, 'search.json'), 'utf8')) as SearchJson).entries;
const featured = (prefix: string) => meta.featured.find((f) => f.id.startsWith(prefix))?.id;
const firstOf = (kind: string, sub?: RegExp) => search.find((e) => e[2] === kind && (!sub || sub.test(e[5] ?? '')))?.[0];
const featuredArt = (sub: RegExp) => meta.featured.map((f) => search.find((e) => e[0] === f.id)).find((e) => e && e[2] === 'artifact' && sub.test(e[5] ?? ''))?.[0];
const war = meta.featured[0]?.id ?? firstOf('event', /war/);
const polity = featured('pol:') ?? firstOf('polity');
const person = search.filter((e) => e[2] === 'person').sort((a, b) => b[1].length - a[1].length)[Math.floor(search.length / 9) % 500]?.[0] ?? firstOf('person');
const ids = {
  war, polity, person,
  treaty: featuredArt(/treaty/) ?? firstOf('artifact', /treaty/),
  chronicle: featuredArt(/chronicle/) ?? firstOf('artifact', /chronicle/),
  inscription: featuredArt(/inscription/) ?? firstOf('artifact', /inscription/),
  ledger: featuredArt(/ledger/) ?? firstOf('artifact', /ledger/),
  letter: firstOf('artifact', /letter/),
  language: featured('lan:') ?? firstOf('language'),
  settlement: firstOf('settlement'),
  climate: featured('cli:'),
  movement: firstOf('movement'),
  poem: firstOf('artifact', /^poem$/),
  diary: firstOf('artifact', /^diary$/),
  flagship: (meta.flagships ?? []).find((id) => !/^(poem|diary)$/.test(search.find((e) => e[0] === id)?.[5] ?? '')) ?? meta.flagships?.[0],
};
console.log('pages:', JSON.stringify(ids));

const views: { name: string; hash: string; dark?: boolean; wait?: number; full?: boolean }[] = [
  ...[300, 1500, 3200, 4600, 4990].map((y) => ({ name: `map-${y}`, hash: `#/map?y=${y}&l=political` })),
  { name: 'map-culture', hash: `#/map?y=2500&l=culture`, wait: 1500 },
  { name: 'map-religion', hash: `#/map?y=3800&l=religion`, dark: true, wait: 1500 },
  { name: 'map-sel', hash: `#/map?y=2600&l=political&sel=${polity}` },
  { name: 'map-routes', hash: `#/map?y=4000&l=political&routes=1`, dark: true },
  { name: 'graph', hash: `#/graph?y=3500`, wait: 6000 },
  { name: 'graph-dark', hash: `#/graph?y=4990&k=all&d=1`, dark: true, wait: 9000 },
  { name: 'ego', hash: `#/graph?y=5000&focus=${war}`, wait: 6000 },
  { name: 'event', hash: `#/p/${war}` },
  { name: 'compare', hash: `#/compare/${war}` },
  { name: 'polity', hash: `#/p/${polity}` },
  { name: 'person', hash: `#/p/${person}` },
  { name: 'treaty', hash: `#/p/${ids.treaty}` },
  { name: 'chronicle', hash: `#/p/${ids.chronicle}` },
  { name: 'inscription', hash: `#/p/${ids.inscription}` },
  { name: 'inscription', hash: `#/p/${ids.inscription}`, dark: true },
  { name: 'ledger', hash: `#/p/${ids.ledger}` },
  { name: 'letter', hash: `#/p/${ids.letter}` },
  { name: 'language', hash: `#/p/${ids.language}`, full: true },
  { name: 'settlement', hash: `#/p/${ids.settlement}` },
  { name: 'climate', hash: `#/p/${ids.climate}` },
  { name: 'browse', hash: `#/browse?kind=artifact&sub=treaty`, wait: 1500 },
  { name: 'browse-flag', hash: `#/browse?kind=artifact&flag=1`, wait: 1500 },
  { name: 'tour', hash: ``, wait: 3200 },
  { name: 'histomap', hash: `#/histomap`, wait: 1500, full: true },
  { name: 'histomap-dark', hash: `#/histomap`, dark: true, wait: 1500 },
  { name: 'story', hash: `#/story`, wait: 2200 },
  { name: 'story-beat', hash: `#/story?at=c2b3`, wait: 3000 },
  ...(ids.poem ? [{ name: 'poem', hash: `#/p/${ids.poem}` }] : []),
  ...(ids.diary ? [{ name: 'diary', hash: `#/p/${ids.diary}` }] : []),
  ...(ids.flagship ? [{ name: 'flagship', hash: `#/p/${ids.flagship}` }] : []),
  { name: 'about', hash: `#/about` },
  { name: 'search', hash: `#/search` },
];

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout!.on('data', (b: Buffer) => { if (b.toString().includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

// Prefer full Chromium with the real GPU (Metal on macOS); the headless shell falls back to software GL,
// which makes WebGL/canvas timings meaningless.
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
  .catch(() => chromium.launch());
const errors: string[] = [];
try {
  for (const vp of [{ tag: 'phone', width: 390, height: 844, scale: 2, mobile: true }, { tag: 'desktop', width: 1440, height: 900, scale: 1, mobile: false }]) {
    for (const v of views) {
      if (only.length && !only.includes(v.name)) continue;
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale, isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: v.dark ? 'dark' : 'light' });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') { if (!m.text().startsWith('Failed to load resource')) errors.push(`[${vp.tag} ${v.name}] ${m.text()}`); }; });
      page.on('pageerror', (e) => errors.push(`[${vp.tag} ${v.name}] PAGEERROR ${e.message}`));
      page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${vp.tag} ${v.name}] HTTP ${r.status()} ${r.url().replace(BASE, '')}`); });
      const t0 = Date.now();
      await page.goto(BASE + v.hash, { waitUntil: 'networkidle' });
      await page.waitForTimeout(v.wait ?? 700);
      const ms = Date.now() - t0;
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const file = `${v.name}-${vp.tag}${v.dark ? '-dark' : ''}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: !!v.full });
      console.log(`${file.padEnd(34)} ${String(ms).padStart(5)}ms${overflow > 0 ? `  !! horizontal overflow ${overflow}px` : ''}`);
      await ctx.close();
    }
  }
  // social card: 1200×630 of the map (writes atlas/public/og.png; run after a real export + build)
  if (only.includes('og')) {
    const year = Number(process.argv.find((a) => a.startsWith('--year='))?.slice(7) ?? Math.round(meta.yearEnd * 0.55));
    const scale = Number(process.argv.find((a) => a.startsWith('--scale='))?.slice(8) ?? 1);
    const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? join(ROOT, 'public', 'og.png');
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: scale, colorScheme: process.argv.includes('--dark') ? 'dark' : 'light' });
    const page = await ctx.newPage();
    await page.goto(BASE + `#/map?y=${year}&l=political&og=1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: out });
    console.log(`${out} written (year ${year})`);
    await ctx.close();
  }

  // README stills → docs/img/
  if (only.includes('readme')) {
    const IMG = join(ROOT, '..', 'docs', 'img');
    mkdirSync(IMG, { recursive: true });
    const poem = (meta.flagships ?? []).find((id) => search.find((e) => e[0] === id)?.[5] === 'poem');
    const shots: { file: string; hash: string; vp: { width: number; height: number; scale: number; mobile?: boolean }; dark?: boolean; wait?: number; full?: boolean }[] = [
      { file: 'map.png', hash: '#/map?y=3700&l=political', vp: { width: 1440, height: 900, scale: 2 } },
      { file: 'compare.png', hash: `#/compare/${meta.featured[0].id}`, vp: { width: 1440, height: 900, scale: 2 } },
      { file: 'graph.png', hash: '#/graph?y=4500&d=1', vp: { width: 1440, height: 900, scale: 2 }, dark: true, wait: 7000 },
      { file: 'inscription.png', hash: `#/p/${ids.inscription}`, vp: { width: 1440, height: 1100, scale: 2 } },
      { file: 'poem.png', hash: `#/p/${poem ?? ids.poem}`, vp: { width: 1440, height: 1100, scale: 2 } },
      { file: 'phone.png', hash: '#/map?y=3200&l=political', vp: { width: 390, height: 844, scale: 3, mobile: true } },
      { file: 'story.png', hash: '#/story?at=c3b2', vp: { width: 1440, height: 900, scale: 2 }, wait: 3200 },
      { file: 'histomap.png', hash: '#/histomap?export=1', vp: { width: 1600, height: 1000, scale: 1 }, wait: 1500, full: true },
    ];
    for (const sh of shots) {
      const ctx = await browser.newContext({ viewport: { width: sh.vp.width, height: sh.vp.height }, deviceScaleFactor: sh.vp.scale, isMobile: !!sh.vp.mobile, hasTouch: !!sh.vp.mobile, colorScheme: sh.dark ? 'dark' : 'light', reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[readme ${sh.file}] PAGEERROR ${e.message}`));
      await page.goto(BASE + sh.hash, { waitUntil: 'networkidle' });
      await page.waitForTimeout(sh.wait ?? 1200);
      await page.screenshot({ path: join(IMG, sh.file), fullPage: !!sh.full });
      console.log(`docs/img/${sh.file}`);
      await ctx.close();
    }
  }

  // interaction flows
  if (!only.length || only.includes('flows')) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[flows] PAGEERROR ${e.message}`));
    const step = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); console.log(`flow ok   ${label}`); } catch (e) { console.log(`flow FAIL ${label}: ${(e as Error).message.split('\n')[0]}`); errors.push(`[flows] ${label}`); }
    };
    await page.goto(BASE + '#/map?y=1500', { waitUntil: 'networkidle' });
    await step('tap the map selects something', async () => {
      const box = (await page.locator('.mapview__canvas').boundingBox())!;
      for (const [fx, fy] of [[0.35, 0.5], [0.3, 0.45], [0.4, 0.55], [0.25, 0.6]]) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
        await page.waitForTimeout(250);
        if (await page.locator('.sel__head').count()) break;
      }
      await page.locator('.sel__head').waitFor({ timeout: 2000 });
      await page.waitForTimeout(300);
      if (!/sel=/.test(page.url())) throw new Error('selection not in URL: ' + page.url());
    });
    await step('read page from panel', async () => {
      const read = page.locator('.panel a.btn', { hasText: 'Read page' });
      if (await read.count()) { await read.first().click(); await page.locator('.reader__title').waitFor({ timeout: 3000 }); }
      else { await page.goto(BASE + '#/browse'); }
    });
    await step('global search finds and opens a page', async () => {
      await page.goto(BASE + '#/browse', { waitUntil: 'networkidle' });
      // title text only (skip the ✦ flagship marker and the type label)
      const first = (await page.locator('.row__t').first().evaluate((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''))).trim();
      await page.locator('.topbar__search input').fill(first.slice(0, 8));
      await page.locator('.topbar .search__item').first().waitFor({ timeout: 3000 });
      await page.keyboard.press('Enter');
      await page.locator('.reader__title').waitFor({ timeout: 3000 });
    });
    await step('wiki link navigates', async () => {
      const before = page.url();
      await page.locator('.prose a.wl').first().click();
      await page.waitForTimeout(400);
      if (page.url() === before) throw new Error('url did not change');
      await page.locator('.reader__title').waitFor({ timeout: 3000 });
    });
    await step('graph node click opens card', async () => {
      await page.goto(BASE + '#/graph?y=5000', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await page.locator('.graphbar__search input').fill('Kingdom');
      await page.locator('.graphbar .search__item').first().click();
      await page.locator('.panel .pagecard__title').waitFor({ timeout: 3000 });
    });
    await step('play advances the year', async () => {
      await page.goto(BASE + '#/map?y=100', { waitUntil: 'networkidle' });
      await page.locator('.slider__play').click();
      await page.waitForTimeout(800);
      await page.locator('.slider__play').click();
      const y = Number(await page.locator('.slider__num').textContent());
      if (!(y > 100)) throw new Error('year did not advance: ' + y);
    });
    await step('theme toggle switches to dark', async () => {
      await page.locator('.theme-toggle').click();
      const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (t !== 'dark') throw new Error('theme attr ' + t);
    });
    await ctx.close();
  }

  // perf probe: scrub the slider across 1,000 years on the desktop map
  if (!only.length || only.includes('perf')) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '#/map?y=1000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const res = await page.evaluate(async () => {
      const r = (window as unknown as { __palimpsestMap: { drawTimes: number[]; year: number; invalidate(): void } }).__palimpsestMap;
      r.drawTimes.length = 0;
      const slider = document.querySelector('.slider__track') as HTMLElement;
      slider.focus();
      const t0 = performance.now();
      const steps: number[] = [];
      for (let i = 0; i < 100; i++) {
        const s0 = performance.now();
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: i % 10 === 9, bubbles: true }));
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        steps.push(performance.now() - s0);
      }
      const total = performance.now() - t0;
      steps.sort((a, b) => a - b);
      (window as unknown as { __steps: number[] }).__steps = steps;
      const d = r.drawTimes.slice().sort((a, b) => a - b);
      return { frames: d.length, median: d[Math.floor(d.length / 2)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1], total, stepP95: steps[95] };
    });
    console.log(`perf: slider scrub 100 steps — ${res.frames} draws, median ${res.median.toFixed(1)}ms, p95 ${res.p95.toFixed(1)}ms, max ${res.max.toFixed(1)}ms, ${(res.total / 100).toFixed(1)}ms/step wall (2 frames min), step p95 ${res.stepP95.toFixed(1)}ms`);
    // initial load: navigation start -> first map draw
    const p2 = await ctx.newPage();
    const tStart = Date.now();
    await p2.goto(BASE + '#/map?y=2000');
    await p2.waitForFunction(() => ((window as unknown as { __palimpsestMap?: { drawTimes: number[] } }).__palimpsestMap?.drawTimes.length ?? 0) > 0, null, { timeout: 30000 });
    console.log(`perf: first map draw ${Date.now() - tStart}ms after navigation (local server)`);
    // graph: worker load + chunked build, then scrub refresh times
    const p3 = await ctx.newPage();
    const g0 = Date.now();
    await p3.goto(BASE + '#/graph?y=2500');
    await p3.waitForFunction(() => (window as unknown as { __palimpsestGraph?: { buildMs?: number } }).__palimpsestGraph?.buildMs !== undefined, null, { timeout: 60000 });
    const gp = await p3.evaluate(() => (window as unknown as { __palimpsestGraph: { loadMs: number; buildMs: number; nodes: number; edges: number } }).__palimpsestGraph);
    console.log(`perf: graph ready ${Date.now() - g0}ms after navigation — worker fetch+parse+index ${Math.round(gp.loadMs)}ms, build ${Math.round(gp.buildMs)}ms for ${gp.nodes} nodes / ${gp.edges} edges`);
    const lt = await p3.evaluate(async () => {
      // long tasks during a scrub
      const longs: number[] = [];
      const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); });
      po.observe({ type: 'longtask', buffered: false });
      const slider = document.querySelector('.slider__track') as HTMLElement;
      slider.focus();
      for (let i = 0; i < 60; i++) {
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
        await new Promise((res) => setTimeout(res, 30));
      }
      await new Promise((res) => setTimeout(res, 400));
      po.disconnect();
      const r = (window as unknown as { __palimpsestGraph: { refreshMs: number[] } }).__palimpsestGraph.refreshMs.slice().sort((a, b) => a - b);
      return { longs, refreshMedian: r[Math.floor(r.length / 2)], refreshP95: r[Math.floor(r.length * 0.95)], n: r.length };
    });
    console.log(`perf: graph scrub — ${lt.n} refreshes, median ${lt.refreshMedian?.toFixed(1)}ms, p95 ${lt.refreshP95?.toFixed(1)}ms; long tasks: ${lt.longs.length ? lt.longs.map((x) => Math.round(x)).join(',') : 'none'}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.log(`\n${errors.length} console errors:`);
  for (const e of [...new Set(errors)].slice(0, 40)) console.log('  ' + e);
} else console.log('\nNo console errors.');
