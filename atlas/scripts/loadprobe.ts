// Measure first-load cost of the map: bytes on the wire (gzip) and time to first map draw,
// unthrottled and on a throttled 4G-like link. Usage: npm --prefix atlas run build && node atlas/scripts/loadprobe.ts
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4183;
const server = await serveDist(join(ROOT, 'dist'), PORT);
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());
const profiles = [
  { name: 'unthrottled', net: null },
  { name: '4G (9 Mbps, 85 ms)', net: { offline: false, downloadThroughput: (9e6 / 8), uploadThroughput: (1.5e6 / 8), latency: 85 } },
  { name: 'slow 4G (1.6 Mbps, 150 ms)', net: { offline: false, downloadThroughput: (1.6e6 / 8), uploadThroughput: (0.75e6 / 8), latency: 150 } },
];
try {
  for (const pr of profiles) {
    for (const [label, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      if (pr.net) await cdp.send('Network.emulateNetworkConditions', pr.net);
      let bytes = 0;
      const data: string[] = [];
      cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => { bytes += e.encodedDataLength; });
      page.on('request', (r) => { if (r.url().includes('/data/')) data.push(r.url().split('/data/')[1]); });
      const t0 = Date.now();
      await page.goto(`http://localhost:${PORT}/civilization/#/map?y=2600&l=political`);
      await page.waitForFunction(() => ((window as unknown as { __palimpsestMap?: { drawTimes: number[] } }).__palimpsestMap?.drawTimes.length ?? 0) > 0, null, { timeout: 120000 });
      const ms = Date.now() - t0;
      const atDraw = bytes;
      const dataAtDraw = data.slice();
      console.log(`${pr.name.padEnd(28)} ${label.padEnd(8)} first map ${String(ms).padStart(5)} ms · ${(atDraw / 1024).toFixed(0)} KB on the wire · data: ${dataAtDraw.join(', ')}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
