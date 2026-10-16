// The Tablet House, played through in a browser: every day and the ending, on a desktop and a phone, with screenshots,
// an axe audit at each kind of screen, the sound switched on, the share card saved, and the share page's redirect.
// Usage: npm --prefix atlas run build && node atlas/scripts/tablet.ts [--dist=atlas/dist] [--out=dir] [--city=sc-919]
//        [--only=desktop|phone] [--reduced] [--picks=btrbr113] (five slots: t true, r rounded, b boasted; then the
//        cards played on days 3, 4 and 5, 1–3). Without --city it plays the city of the day.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium, type Page } from 'playwright';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DIST = resolve(arg('dist') ?? join(ROOT, 'dist'));
const OUT = resolve(arg('out') ?? join(ROOT, '..', 'build', 'tablet-shots'));
const CITY = arg('city') ?? '';
const ONLY = arg('only');
const REDUCED = process.argv.includes('--reduced');
// slots: muster, ours, theirs, field, end; then the cards of days 3, 4 and 5
const PICKS = (arg('picks') ?? 'btrbr113').split('');
const PORT = 4187;
mkdirSync(OUT, { recursive: true });

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/civilization\/?/, '/');
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', ok));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const errors: string[] = [];
const a11y: string[] = [];

/** axe over the current screen (the WCAG A/AA rules); violations are collected for the summary. */
async function audit(page: Page, name: string) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document.querySelector('.tb') ?? document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return r.violations.map((x) => `${x.impact} ${x.id}: ${x.help} (${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')})`);
  });
  for (const x of v) a11y.push(`${name}: ${x}`);
}

async function shot(page: Page, name: string, full = false) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
  console.log(`  ${name}`);
}
/** Click the main gold button and wait for the next screen to settle. */
async function next(page: Page, settle = 1200) {
  const b = page.locator('.tb-btn--gold:not([disabled])').first();
  await b.waitFor({ state: 'visible', timeout: 30000 });
  await b.click();
  await sleep(settle);
}
async function waitIdle(page: Page) {
  await page.waitForFunction(() => !document.querySelector('.tb.is-busy'), null, { timeout: 30000 });
}

async function play(kind: 'desktop' | 'phone') {
  const vp = kind === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: kind === 'phone' ? 2 : 1, isMobile: kind === 'phone', hasTouch: kind === 'phone', reducedMotion: REDUCED ? 'reduce' : 'no-preference', colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${kind}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${kind} console: ${m.text()}`); });
  const p = `${kind}-`;
  // the way in: the tile at the top of the Play hub
  await page.goto(`http://127.0.0.1:${PORT}/civilization/#/play`, { waitUntil: 'networkidle' });
  await page.waitForSelector('a.play__tile[href="#/tablet"]', { timeout: 20000 });
  await shot(page, `${p}00-play-hub`);
  await page.goto(`http://127.0.0.1:${PORT}/civilization/#/tablet${CITY ? `/${CITY}` : ''}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.tb-intro', { timeout: 30000 });
  await sleep(2600);
  await shot(page, `${p}00-intro`);
  await audit(page, `${p}intro`);
  // the sound switch: on and off again (headless browsers have no speakers, but nothing may throw)
  const snd = page.locator('.tb-intro .tb-sound');
  if (await snd.count()) { await snd.click(); await sleep(600); await snd.click(); }
  await next(page, 1700);
  let pick = 0;
  const slotPick = async () => {
    const c = PICKS[pick++] ?? 'b';
    const n = c === 't' ? 0 : c === 'r' ? 1 : 2;
    return n;
  };
  for (let day = 1; day <= 5; day++) {
    // the title card
    await page.waitForSelector('.tb-titlecard', { timeout: 30000 });
    await sleep(REDUCED ? 300 : 2300);
    await shot(page, `${p}d${day}-1-title`);
    if (await page.locator('.tb-titlecard').count()) await page.click('.tb-titlecard');
    await page.waitForSelector('.tb-scene', { timeout: 30000 });
    await sleep(REDUCED ? 400 : 4200);
    await shot(page, `${p}d${day}-2-scene`);
    await next(page, 900);
    if (day === 1 || day === 2) {
      const slots = day === 1 ? 1 : 3;
      for (let i = 0; i < slots; i++) {
        await page.waitForSelector('.tb-opt', { timeout: 30000 });
        await waitIdle(page);
        const n = await slotPick();
        if (kind === 'desktop') await page.locator('.tb-opt').nth(n).hover();
        await sleep(500);
        await shot(page, `${p}d${day}-3-write${slots > 1 ? `-${i + 1}` : ''}`);
        if (day === 1) await audit(page, `${p}write`);
        await page.locator('.tb-opt').nth(n).click();
        await sleep(400);
        if (i === 0 && day === 1) await shot(page, `${p}d${day}-3b-pressing`);
        await waitIdle(page);
        await sleep(700);
      }
      await page.waitForSelector('.tb-written', { timeout: 30000 });
      await sleep(REDUCED ? 300 : 2400);
      await shot(page, `${p}d${day}-4-written`);
      await next(page, 1200);
      continue;
    }
    // days 3–5: the cards
    await page.waitForSelector('.tb-card', { timeout: 30000 });
    await sleep(day === 5 ? 1500 : 900);
    await shot(page, `${p}d${day}-3-choose`);
    if (day === 5) await audit(page, `${p}choose`);
    const card = Number(PICKS[5 + (day - 3)] ?? '1') - 1;
    const cards = page.locator('.tb-card');
    await cards.nth(Math.min(card, (await cards.count()) - 1)).click();
    await sleep(day === 5 ? 1800 : 600);
    if (day === 5) await shot(page, `${p}d5-4-amending`);
    await waitIdle(page);
    await sleep(REDUCED ? 300 : 2600);
    await shot(page, `${p}d${day}-4-chosen`);
    if (day === 3) await next(page, 1200);
    if (day === 4) {
      await next(page, 900);
      await page.waitForSelector('.tb-opt', { timeout: 30000 });
      await waitIdle(page);
      await sleep(500);
      await shot(page, `${p}d4-5-write`);
      const n = await slotPick();
      await page.locator('.tb-opt').nth(n).click();
      await waitIdle(page);
      await page.waitForSelector('.tb-written', { timeout: 30000 });
      await sleep(REDUCED ? 300 : 2400);
      await shot(page, `${p}d4-6-written`);
      await next(page, 1200);
    }
  }
  // the firing
  await next(page, 1200);
  await page.waitForSelector('.tb-fire', { timeout: 30000 });
  await sleep(1300);
  await shot(page, `${p}e0-firing`);
  await page.waitForSelector('.tb-fire .tb-btn--gold:not([disabled])', { timeout: 30000 });
  await sleep(1200);
  await shot(page, `${p}e1-fired`);
  await next(page, 2500);
  await page.waitForSelector('.tb-end', { timeout: 30000 });
  await sleep(1500);
  await shot(page, `${p}e2-ending`);
  for (const [sel, name] of [['.tb-end__record', 'e3-record'], ['.tb-end__dig', 'e4-archaeologist'], ['.tb-end__score', 'e5-score']] as const) {
    await page.locator(sel).scrollIntoViewIfNeeded();
    await sleep(700);
    await shot(page, `${p}${name}`);
  }
  await shot(page, `${p}e9-ending-full`, true);
  await audit(page, `${p}ending`);
  // the share card, drawn in the page and saved
  if (kind === 'desktop') {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Save the card' }).click()]);
    await dl.saveAs(join(OUT, `${p}card.png`));
    console.log(`  ${p}card`);
  }
  // the share page opens the same city
  if (existsSync(join(DIST, 's', 'tablet.html'))) {
    const city = await page.evaluate(() => location.hash.split('/')[2] ?? '');
    await page.goto(`http://127.0.0.1:${PORT}/civilization/s/tablet.html?c=${city || 'sc-18225'}`);
    await page.waitForURL(/#\/tablet/, { timeout: 10000 }).catch(() => {});
    const to = await page.evaluate(() => location.hash);
    console.log(`  s/tablet.html?c=${city} → ${to}`);
    if (city && !to.endsWith(city)) errors.push(`${kind}: the share page went to ${to}`);
  }
  await ctx.close();
}

try {
  for (const k of ['desktop', 'phone'] as const) {
    if (ONLY && ONLY !== k) continue;
    console.log(k);
    await play(k);
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log('errors:'); for (const e of errors) console.log(' ', e); }
console.log(a11y.length ? `axe: ${a11y.length} violations\n  ${a11y.join('\n  ')}` : 'axe: no violations');
console.log(`screenshots → ${OUT}`);
