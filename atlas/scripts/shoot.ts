// Screenshot key views of the built atlas at phone and desktop sizes.
// Usage: npm --prefix atlas run build && npm --prefix atlas run shoot [-- --only=map,page]
// Output: atlas/.shots/<name>-<viewport>[-dark].png, plus console errors on stdout.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { MetaJson, PageJson, ShardJson } from '../../engine/src/export/contract.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.shots');
const DATA = join(ROOT, 'dist', 'data');
const PORT = 4179;
const BASE = `http://localhost:${PORT}/civilization/`;
mkdirSync(OUT, { recursive: true });

const only = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '').split(',').filter(Boolean);

// pick representative pages from the data
const meta = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8')) as MetaJson;
const pages: PageJson[] = [];
for (const f of readdirSync(join(DATA, 'pages'))) pages.push(...(JSON.parse(readFileSync(join(DATA, 'pages', f), 'utf8')) as ShardJson).pages);
const find = (pred: (p: PageJson) => boolean) => pages.find(pred);
const bySub = (sub: RegExp) => find((p) => p.kind === 'artifact' && sub.test(p.sub));
const withAccounts = find((p) => !!p.accounts && p.accounts.sources.length > 1);
const lang = find((p) => p.kind === 'language' && !!p.language && p.language.soundChanges.length > 3);
const polity = pages.filter((p) => p.kind === 'polity').sort((a, b) => b.backlinks.length - a.backlinks.length)[0];
const settlement = pages.filter((p) => p.kind === 'settlement' && (p.names?.length ?? 0) > 1).sort((a, b) => b.backlinks.length - a.backlinks.length)[0];
const mid = Math.round((meta.yearStart + meta.yearEnd) / 2);

const views: { name: string; hash: string; dark?: boolean; wait?: number }[] = [
  { name: 'map', hash: `#/map?y=1200&l=political` },
  { name: 'map-late', hash: `#/map?y=${Math.round(meta.yearEnd * 0.8)}&l=political&routes=1` },
  { name: 'map-sel', hash: `#/map?y=${polity ? Math.min(polity.t1, polity.t0 + 150) : mid}&l=political&sel=${polity?.id ?? ''}` },
  { name: 'map-religion', hash: `#/map?y=${mid}&l=religion`, dark: true },
  { name: 'graph', hash: `#/graph?y=${Math.round(meta.yearEnd * 0.7)}`, wait: 1500 },
  { name: 'ego', hash: `#/graph?y=${meta.yearEnd}&focus=${withAccounts?.id ?? polity?.id}`, wait: 2500 },
  { name: 'event', hash: `#/p/${withAccounts?.id}` },
  { name: 'compare', hash: `#/compare/${withAccounts?.id}` },
  { name: 'inscription', hash: `#/p/${find((p) => !!p.artifact?.interlinear)?.id}` },
  { name: 'inscription', hash: `#/p/${find((p) => !!p.artifact?.interlinear)?.id}`, dark: true },
  { name: 'ledger', hash: `#/p/${find((p) => !!p.artifact?.ledger)?.id}` },
  { name: 'treaty', hash: `#/p/${bySub(/treaty/)?.id}` },
  { name: 'chronicle', hash: `#/p/${bySub(/chronicle/)?.id}` },
  { name: 'newspaper', hash: `#/p/${bySub(/news/)?.id}` },
  { name: 'telegram', hash: `#/p/${bySub(/telegram/)?.id}` },
  { name: 'language', hash: `#/p/${lang?.id}` },
  { name: 'polity', hash: `#/p/${polity?.id}` },
  { name: 'settlement', hash: `#/p/${settlement?.id}` },
  { name: 'browse', hash: `#/browse?kind=artifact` },
  { name: 'about', hash: `#/about` },
  { name: 'search', hash: `#/search` },
];

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout!.on('data', (b: Buffer) => { if (b.toString().includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

const browser = await chromium.launch();
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
      await page.screenshot({ path: join(OUT, file), fullPage: false });
      console.log(`${file.padEnd(34)} ${String(ms).padStart(5)}ms${overflow > 0 ? `  !! horizontal overflow ${overflow}px` : ''}`);
      await ctx.close();
    }
  }
  // social card: 1200×630 of the map (writes atlas/public/og.png; run after a real export + build)
  if (only.includes('og')) {
    const year = Number(process.argv.find((a) => a.startsWith('--year='))?.slice(7) ?? Math.round(meta.yearEnd * 0.55));
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(BASE + `#/map?y=${year}&l=political&clean=1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(ROOT, 'public', 'og.png') });
    console.log(`og.png written (year ${year})`);
    await ctx.close();
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
      const first = (await page.locator('.row__t').first().textContent())!.trim();
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
      for (let i = 0; i < 100; i++) {
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      }
      const total = performance.now() - t0;
      const d = r.drawTimes.slice().sort((a, b) => a - b);
      return { frames: d.length, median: d[Math.floor(d.length / 2)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1], total };
    });
    console.log(`perf: slider scrub 100 steps — ${res.frames} draws, median ${res.median.toFixed(1)}ms, p95 ${res.p95.toFixed(1)}ms, max ${res.max.toFixed(1)}ms`);
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
