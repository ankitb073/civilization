// The world of Runner of the Tablet House (#/streets, step 2: Pumi, walkable). Two jobs:
//
// 1. --fingerprint: proves the city model is unchanged for every other view. In a browser on the Vite dev server it
//    builds cities with buildCity() at several years with the default options, and hashes everything the model draws
//    (each instanced part's matrix and colour, the painted ground, the water, anchors and smoke). Save a baseline with
//    --save=file before a change to atlas/src/three/city, then compare with --compare=file after it.
//
// 2. (default) shoots the street world: loads #/streets (Pumi, sc-919, before the sack) from a built dist at desktop
//    1440×900 and phone 390×844 (DPR 2, 4× CPU slowdown), runs axe, screenshots the market, the house of tablets, a
//    rooftop and the river, walks one scripted loop through the streets, and reports frame times (median, p95), draw
//    calls, triangles, colliders, ladders, places, load time and the JS downloaded.
//
// Usage: node atlas/scripts/streets-world.ts --fingerprint [--save=f.json | --compare=f.json]
//        node atlas/scripts/streets-world.ts [--out=dir] [--dist=atlas/dist] [--only=desktop|phone] [--seconds=20]
//          [--q=sc=sc-919] [--tag=after]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type CDPSession, type Page } from 'playwright';
import { serveDist } from './serve.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN; };
const r2 = (v: number) => Math.round(v * 100) / 100;

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }).catch(() => chromium.launch());

try {
  if (process.argv.includes('--fingerprint')) await fingerprint();
  else await shoot();
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- 1. the city model's fingerprint
async function fingerprint() {
  const { createServer } = await import('vite');
  const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'warn', server: { port: 5193, strictPort: false, host: '127.0.0.1' } });
  await server.listen();
  const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5193/';
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}#/about`, { waitUntil: 'domcontentloaded' });
    // cities and years: Pumi around its sack (and the backdrop's year, 331), an early year, and two other cities
    const cases: [string, number][] = [['set:17', 331], ['set:17', 332], ['set:17', 333], ['set:17', 340], ['set:17', 120], ['set:0', 300], ['set:0', 2500], ['set:151', 2234]];
    const out = await page.evaluate(async (cases) => {
      const mod = await import('/src/three/city/index.ts' as string) as typeof import('../src/three/city/index.ts');
      const fnv = (h: number, bytes: Uint8Array) => { for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193); return h >>> 0; };
      const f32 = (a: ArrayLike<number>) => new Uint8Array(new Float32Array(Array.from(a)).buffer);
      const res: Record<string, string> = {};
      for (const [id, y] of cases) {
        const rec = await mod.loadCityRecord(id);
        for (const [label, opts] of [['default', {}], ['view', { textureSize: 1024, theme: 'light' }], ['backdrop', { plinth: false, textureSize: 512, theme: 'light' }]] as [string, Record<string, unknown>][]) {
          const g = mod.buildCity(rec, y, opts);
          const model = (g.userData as { model: { anchors: unknown[]; smoke: unknown[]; P: number; cy: unknown; dispose(): void } }).model;
          let h = 0x811c9dc5;
          const parts: string[] = [];
          g.traverse((o: any) => {
            if (o.isInstancedMesh) {
              const n = o.count;
              h = fnv(h, f32((o.instanceMatrix.array as Float32Array).subarray(0, n * 16)));
              if (o.instanceColor) h = fnv(h, f32((o.instanceColor.array as Float32Array).subarray(0, n * 3)));
              parts.push(`${o.geometry.type}:${n}:${o.visible ? 1 : 0}`);
            } else if (o.isMesh) {
              h = fnv(h, f32(o.geometry.attributes.position.array));
              h = fnv(h, f32([o.scale.x, o.scale.y, o.scale.z, o.position.y, o.renderOrder]));
              const map = o.material?.map?.image as HTMLCanvasElement | undefined;
              if (map && map.getContext) h = fnv(h, new Uint8Array(map.getContext('2d')!.getImageData(0, 0, map.width, map.height).data.buffer));
              parts.push(`mesh:${o.geometry.attributes.position.count}`);
            }
          });
          h = fnv(h, new TextEncoder().encode(JSON.stringify([model.anchors, model.smoke, model.P, model.cy])));
          res[`${id}@${y}/${label}`] = `${h.toString(16).padStart(8, '0')} ${parts.join(' ')}`;
          model.dispose();
        }
      }
      return res;
    }, cases);
    if (errors.length) console.log('errors:', errors);
    for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(28)} ${v}`);
    // the streets' Pumi (AY 332 before the sack) against #/city/set:17?y=331, lot for lot: every standing house's body
    const lots = await page.evaluate(async () => {
      const mod = await import('/src/three/city/index.ts' as string) as typeof import('../src/three/city/index.ts');
      const rec = await mod.loadCityRecord('set:17');
      const bodies = (opts: Record<string, unknown>, y: number) => {
        const g = mod.buildCity(rec, y, opts);
        const m = (g.userData as { model: { dispose(): void } }).model;
        const out: string[] = [];
        let burnt = 0;
        g.traverse((o: any) => {
          if (!o.isInstancedMesh || o.geometry.type !== 'BoxGeometry') return;
          const e = o.instanceMatrix.array as Float32Array;
          for (let i = 0; i < o.count; i++) {
            const k = i * 16;
            if (Math.abs(e[k + 13]) > 1e-4) continue;
            const sy = e[k + 5];
            if (sy > 0.3 && sy < 0.8 && Math.hypot(e[k], e[k + 2]) < 1.1) out.push(`${e[k + 12].toFixed(3)},${e[k + 14].toFixed(3)},${Math.hypot(e[k], e[k + 2]).toFixed(3)},${Math.hypot(e[k + 8], e[k + 10]).toFixed(3)}`);
            else if (Math.abs(sy - 0.08) < 1e-4) burnt++;
          }
        });
        m.dispose();
        return { houses: out.sort(), burnt };
      };
      const streets = bodies({ plinth: false, beforeSack: true }, 332), view331 = bodies({}, 331), view332 = bodies({}, 332);
      const a = new Set(streets.houses), b = new Set(view331.houses);
      return {
        streets332: streets.houses.length, streetsBurnt: streets.burnt, view331: view331.houses.length, view332: view332.houses.length, view332Burnt: view332.burnt,
        onlyStreets: [...a].filter((k) => !b.has(k)).length, only331: [...b].filter((k) => !a.has(k)).length,
      };
    });
    console.log(`Pumi lot for lot: streets AY 332 before the sack ${lots.streets332} houses (${lots.streetsBurnt} burnt) vs #/city/set:17?y=331 ${lots.view331}` +
      ` (#/city?y=332 draws ${lots.view332Burnt} of them burnt); in the streets only ${lots.onlyStreets}, in AY 331 only ${lots.only331}`);
    const save = arg('save', ''), cmp = arg('compare', '');
    if (save) { writeFileSync(resolve(save), JSON.stringify(out, null, 2)); console.log(`saved → ${resolve(save)}`); }
    if (cmp) {
      const old = JSON.parse(readFileSync(resolve(cmp), 'utf8')) as Record<string, string>;
      const diff = Object.keys({ ...old, ...out }).filter((k) => old[k] !== out[k]);
      console.log(diff.length ? `CHANGED (${diff.length}): ${diff.join(', ')}` : `identical to ${cmp}: ${Object.keys(out).length} builds`);
      if (diff.length) process.exitCode = 1;
    }
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------- 2. the street world, shot and timed
async function shoot() {
  const OUT = resolve(arg('out', join(ROOT, '..', 'build', 'streets-world')));
  const ONLY = arg('only', '');
  const SECONDS = Number(arg('seconds', '20'));
  const TAG = arg('tag', '');
  const Q = arg('q', '');
  const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  mkdirSync(OUT, { recursive: true });
  const PORT = 4198;
  const server = await serveDist(resolve(arg('dist', join(ROOT, 'dist'))), PORT);
  const base = `http://127.0.0.1:${PORT}/civilization/`;
  const href = `${base}#/streets${Q ? `?${Q}` : ''}`;
  const sizes = [
    { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false, throttle: 1 },
    { name: 'phone', width: 390, height: 844, dpr: 2, mobile: true, throttle: 4 },
  ].filter((s) => !ONLY || s.name === ONLY);
  const summary: Record<string, unknown> = { href };
  type G = {
    ready: boolean; info(): any; stats: { frame: number[]; cpu: number[]; phys: number[] };
    drive(p: unknown[], loop?: boolean): void; stopDriving(): void; teleport(x: number, z: number, f?: number): void;
    cam: { yaw: number; pitch: number; want: number; follow: boolean }; city: any; phys: any;
  };
  const W = () => (window as unknown as { __palimpsestStreets: G }).__palimpsestStreets;
  try {
    for (const s of sizes) {
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: s.mobile, hasTouch: s.mobile });
      const page = await ctx.newPage();
      const errors: string[] = [];
      const wire: { url: string; bytes: number }[] = [];
      page.on('response', async (r) => {
        const len = Number(r.headers()['content-length'] ?? 0);
        wire.push({ url: r.url().replace(base, ''), bytes: len || (await r.body().catch(() => Buffer.alloc(0))).length });
      });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`); });
      const cdp: CDPSession = await ctx.newCDPSession(page);
      if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.throttle });
      // --net=4g: Lighthouse's mobile "slow 4G" (1.6 Mbps down, 750 kbps up, 150 ms round trip), phones only
      const NET = arg('net', '');
      if (NET === '4g' && s.mobile) {
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8), uploadThroughput: (750e3 / 8) });
      }
      const t0 = Date.now();
      await page.goto(href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).__palimpsestStreets?.ready || document.querySelector('.st-load--err'), null, { timeout: 120000 })
        .catch((e) => { console.log('not ready:', errors); throw e; });
      const failed = await page.evaluate(() => document.querySelector('.st-load--err')?.textContent ?? null);
      if (failed) { console.log('failed to load:', failed, errors); throw new Error(failed); }
      const loadMs = Date.now() - t0;
      if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      if (arg('net', '') === '4g' && s.mobile) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const files: Record<string, string> = {};
      const shot = async (name: string) => { const f = join(OUT, `${s.name}-${name}${TAG ? `-${TAG}` : ''}.png`); await page.screenshot({ path: f }); files[name] = f; };
      await shot('hint');
      await page.addScriptTag({ content: AXE });
      const axe = await page.evaluate(async () => {
        const a = (window as any).axe;
        const r = await a.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
        return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, n: v.nodes.length, where: v.nodes.slice(0, 3).map((n: any) => n.target.join(' ')) }));
      });
      const ok = page.getByRole('button', { name: 'Got it' });
      if (await ok.count()) await ok.click();
      await page.waitForTimeout(300);

      // the world's own account of itself
      const world = await page.evaluate(() => {
        const g = (window as any).__palimpsestStreets;
        const c = g.city;
        const a = c.affordances;
        if (!a) return { places: [], ladders: 0, stats: null, solids: c.solids.length, name: c.cy.name, year: c.cy.year, sack: c.cy.sack };
        return {
          places: a.places.map((p: any) => ({ id: p.id, name: p.name, kind: p.kind, x: Math.round(p.pos.x), z: Math.round(p.pos.z), r: p.radius })),
          ladders: a.ladders.length,
          stats: c.stats ?? null,
          solids: c.solids.length,
          name: c.cy.name, year: c.cy.year, sack: c.cy.sack,
        };
      });

      // every place on foot from the house of tablets
      const walk = await page.evaluate(() => { const t0 = performance.now(); const r = (window as any).__palimpsestStreets.city.layer?.walkTest?.() ?? null; return { r, ms: Math.round(performance.now() - t0) }; });
      // the stairs: walk the runner up each kind (palace, temple, a wall stair, two houses) and see where it ends
      const stairs = await page.evaluate(() => {
        const st = (window as any).__palimpsestStreets.city.layer?.civ?.stairs ?? [];
        const pick = [st.find((s: any) => s.name === 'palace'), st.find((s: any) => s.name === 'temple'), st.find((s: any) => s.name.startsWith('walls')), ...st.filter((s: any) => s.name.startsWith('house')).slice(0, 2)].filter(Boolean);
        return pick.map((s: any) => ({ name: s.name, path: s.path.map((p: any) => ({ x: p.x, y: p.y, z: p.z })) }));
      }) as { name: string; path: { x: number; y: number; z: number }[] }[];
      const climbs: { name: string; top: number; got: number; ok: boolean }[] = [];
      for (const st of stairs) {
        await page.evaluate((st) => { const g = (window as any).__palimpsestStreets; g.teleport(st.path[0].x, st.path[0].z); g.drive(st.path.slice(1).map((p: any) => ({ x: p.x, z: p.z, run: true })), false); }, st);
        await page.waitForTimeout(7000);
        const f = await page.evaluate(() => (window as any).__palimpsestStreets.info().feet);
        const last = st.path[st.path.length - 1];
        climbs.push({ name: st.name, top: Math.round(last.y * 100) / 100, got: Math.round(f.y * 100) / 100, ok: Math.abs(f.y - last.y) < 0.6 });
      }
      await page.evaluate(() => (window as any).__palimpsestStreets.stopDriving());
      // views: stand at a place, look at it
      const view = async (name: string, x: number, z: number, yaw: number, pitch: number, want?: number) => {
        await page.evaluate(([x, z, yaw, pitch, want]) => {
          const g = (window as any).__palimpsestStreets;
          g.stopDriving();
          g.teleport(x, z, yaw);
          g.cam.yaw = yaw; g.cam.pitch = pitch;
          if (want) g.cam.want = want;
        }, [x, z, yaw, pitch, want ?? 0]);
        await page.waitForTimeout(1100);
        await shot(name);
      };
      type V = { name: string; x: number; z: number; yaw: number; pitch: number; want?: number };
      let views = await page.evaluate(() => (window as any).__palimpsestStreets.city.views?.() ?? []) as V[];
      // an older build without views(): replay saved framings (--views=file, scaled by --scale for another LOT)
      const vf = arg('views', '');
      if (!views.length && vf) {
        const k = Number(arg('scale', '1'));
        views = (JSON.parse(readFileSync(resolve(vf), 'utf8')) as V[]).map((v) => ({ ...v, x: v.x * k, z: v.z * k }));
      } else writeFileSync(join(OUT, `views-${s.name}.json`), JSON.stringify(views, null, 1));
      for (const v of views) await view(v.name, v.x, v.z, v.yaw, v.pitch, v.want);

      // the scripted loop, timed (phones: 4× slower CPU)
      const loop = await page.evaluate(() => (window as any).__palimpsestStreets.city.loop?.() ?? null) as { x: number; z: number; run?: boolean }[] | null;
      let frames: Record<string, unknown> = { skipped: 'no loop' };
      if (loop && loop.length) {
        await page.evaluate((p) => { const g = (window as any).__palimpsestStreets; g.teleport(p[0].x, p[0].z); g.cam.want = 3.9; g.drive(p, true); }, loop);
        await page.waitForTimeout(1200);
        if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.throttle });
        await page.evaluate(() => { const st = (window as any).__palimpsestStreets.stats; st.frame.length = 0; st.cpu.length = 0; st.phys.length = 0; });
        const samples: any[] = [];
        for (let k = 0; k < SECONDS; k++) {
          await page.waitForTimeout(1000);
          samples.push(await page.evaluate(() => (window as any).__palimpsestStreets.info()));
          if (k === Math.floor(SECONDS / 2)) await shot('loop');
        }
        const st = await page.evaluate(() => { const g = (window as any).__palimpsestStreets; return { frame: g.stats.frame.slice(), cpu: g.stats.cpu.slice(), phys: g.stats.phys.slice() }; });
        if (s.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        const last = samples[samples.length - 1];
        frames = {
          n: st.frame.length,
          frameMs: { median: r2(pct(st.frame, 50)), p95: r2(pct(st.frame, 95)), max: r2(Math.max(...st.frame)) },
          cpuMs: { median: r2(pct(st.cpu, 50)), p95: r2(pct(st.cpu, 95)) },
          physicsMs: { median: r2(pct(st.phys, 50)), p95: r2(pct(st.phys, 95)) },
          drawCalls: { median: pct(samples.map((x) => x.calls), 50), max: Math.max(...samples.map((x) => x.calls)) },
          triangles: { median: pct(samples.map((x) => x.triangles), 50), max: Math.max(...samples.map((x) => x.triangles)) },
          physics: last.physics, timing: Object.fromEntries(Object.entries(last.timing as Record<string, number>).map(([k, v]) => [k, Math.round(v)])),
          dpr: last.dpr,
        };
      }
      const kb = (re: RegExp) => Math.round(wire.filter((w) => re.test(w.url)).reduce((a, w) => a + w.bytes, 0) / 1024);
      const res = {
        size: `${s.width}×${s.height} @${s.dpr}x${s.throttle > 1 ? `, ${s.throttle}× CPU` : ''}`,
        loadMs, world, walk, climbs, frames, axe, errors: errors.slice(0, 12), files,
        download: { jsKB: kb(/\.js(\?|$)/), dataKB: kb(/data\/.*\.json/), modelKB: kb(/\.glb$/), chunks: wire.filter((w) => /\.js$/.test(w.url)).map((w) => `${w.url.replace(/^.*\//, '')} ${Math.round(w.bytes / 1024)} KB`) },
      };
      summary[s.name] = res;
      console.log(`\n== ${s.name} ${res.size}: load ${loadMs} ms`);
      console.log(JSON.stringify(res, null, 1));
      await ctx.close();
    }
    writeFileSync(join(OUT, `world${TAG ? `-${TAG}` : ''}.json`), JSON.stringify(summary, null, 2));
    console.log(`\n→ ${join(OUT, `world${TAG ? `-${TAG}` : ''}.json`)}`);
  } finally {
    server.close();
  }
}
