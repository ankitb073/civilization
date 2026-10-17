// Look-dev spike (docs/streets/lookdev.md): fetch and build the textures and skies the look directions use.
//
//   node atlas/scripts/lookdev-assets.ts fetch     downloads CC0 Poly Haven sources into build/lookdev/src/ (images only;
//                                                  each file's magic bytes are checked; nothing in them is executed)
//   node atlas/scripts/lookdev-assets.ts build     packs them into mipmapped KTX2 texture arrays under
//                                                  atlas/public/game/streets/look/ (Basis: ETC1S albedo, UASTC data) at
//                                                  2K, 1K and 512, the sky backdrops, the IBL HDRs, a manifest and
//                                                  LICENSES.md
//
// Tools: ffmpeg (decode, resize), cwebp (sky WebP), basisu 2.50 (KTX2; brew install basis_universal, Apache-2.0).
// Layers: every array has one layer per material, in MATERIALS order. Albedo layers are sRGB RGB with the scan's
// ambient occlusion multiplied in (60%); data layers are linear RGBA: normal x, normal y (OpenGL convention),
// roughness, height (the scan's displacement, for parallax and height-blended layers).

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ATLAS = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ATLAS, '..', 'build', 'lookdev', 'src2k');
const TMP = join(ATLAS, '..', 'build', 'lookdev', 'tmp');
const OUT = join(ATLAS, 'public', 'game', 'streets', 'look');

/** The scanned materials (Poly Haven, CC0), one array layer each. `metres`: how many metres one tile spans. */
export const MATERIALS = [
  // the first five are the hero set's layers, in the same order, so a hero array and a full array share layer indices
  // (the game streams the hero set in by swapping the texture, with no shader rebuilt)
  { key: 'plaster', id: 'clay_plaster', use: 'mud plaster on walls and roofs; terracotta jars (tinted)' },
  { key: 'brick', id: 'worn_brick_wall', use: 'mud brick where the plaster has flaked off' },
  { key: 'earth', id: 'dirt_floor', use: 'packed earth of the streets, the market and the courtyards' },
  { key: 'paving', id: 'stone_tiles_02', use: 'irregular flagstones of the temple court (only there)' },
  { key: 'stone', id: 'large_sandstone_blocks_01', use: 'temple and palace platforms, columns, rubble' },
  { key: 'wood', id: 'weathered_brown_planks', use: 'doors, beams, ladders, planks, poles' },
  { key: 'reed', id: 'reed_roof_04', use: 'reed mats, awnings of reed, the temple roof' },
  { key: 'cloth', id: 'hessian_230', use: 'awnings, banners, the clothes of still figures (tinted)' },
] as const;

/** Skies: `ibl` is sampled for image-based lighting (1K HDR); `sky` also becomes the visible backdrop. */
export const HDRIS = [
  // the one shipped: a clear late-afternoon sky, the sun low over a warm, hazy horizon (the light of the Tablet House's
  // painted plates). Look-dev's sky (kloofendal_48d_partly_cloudy, a sun 48° up among cumulus) read as midday; others
  // tried there: kloofendal_28d_misty, kloofendal_38d_partly_cloudy, table_mountain_1, hilly_terrain_01 and
  // syferfontein_18d_clear, all *_puresky (docs/streets/lookdev.md, decision 0033)
  { id: 'qwantani_late_afternoon_puresky', sky: true },
] as const;


// ------------------------------------------------------------------------------------------------- fetch
async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'user-agent': 'palimpsest-lookdev (github.com/ankitb073/civilization)' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function download(url: string, file: string, kind: 'jpg' | 'hdr'): Promise<void> {
  if (existsSync(file) && statSync(file).size > 1000) return;
  const r = await fetch(url, { headers: { 'user-agent': 'palimpsest-lookdev (github.com/ankitb073/civilization)' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  // untrusted bytes: keep only what is plainly the image format we asked for
  const ok = kind === 'jpg' ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff : buf.subarray(0, 10).toString('latin1').startsWith('#?RADIANCE') || buf.subarray(0, 6).toString('latin1') === '#?RGBE';
  if (!ok) throw new Error(`${url}: not a ${kind} file`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  console.log(`  ${(buf.length / 1024).toFixed(0).padStart(6)} KB  ${file.replace(SRC + '/', '')}`);
}

async function fetchAll() {
  for (const m of MATERIALS) {
    const dir = join(SRC, 'tex', m.id);
    const files = await getJson(`https://api.polyhaven.com/files/${m.id}`);
    const info = await getJson(`https://api.polyhaven.com/info/${m.id}`);
    const want: [string, string][] = [['Diffuse', 'diff'], ['nor_gl', 'nor_gl'], ['arm', 'arm'], ['Displacement', 'disp']];
    const urls: Record<string, string> = {};
    for (const [k, name] of want) {
      const f = files[k]?.['2k']?.jpg;
      if (!f) throw new Error(`${m.id}: no 2k jpg ${k}`);
      urls[name] = f.url;
      await download(f.url, join(dir, `${name}.jpg`), 'jpg');
    }
    writeFileSync(join(dir, 'info.json'), JSON.stringify({ id: m.id, name: info.name, authors: Object.keys(info.authors ?? {}), dimensions: info.dimensions, date_published: info.date_published, urls, page: `https://polyhaven.com/a/${m.id}` }, null, 1));
  }
  for (const h of HDRIS) {
    const dir = join(SRC, 'hdri', h.id);
    const files = await getJson(`https://api.polyhaven.com/files/${h.id}`);
    const info = await getJson(`https://api.polyhaven.com/info/${h.id}`);
    const urls: Record<string, string> = { '1k': files.hdri['1k'].hdr.url };
    await download(urls['1k'], join(dir, '1k.hdr'), 'hdr');
    if (h.sky) { urls['4k'] = files.hdri['4k'].hdr.url; await download(urls['4k'], join(dir, '4k.hdr'), 'hdr'); }
    writeFileSync(join(dir, 'info.json'), JSON.stringify({ id: h.id, name: info.name, authors: Object.keys(info.authors ?? {}), evs_cap: info.evs_cap, date_published: info.date_published, urls, page: `https://polyhaven.com/a/${h.id}` }, null, 1));
  }
  console.log('fetched →', SRC);
}

// ------------------------------------------------------------------------------------------------- build
function ffDecode(file: string, size: number, fmt: 'rgb24' | 'rgb48le' = 'rgb24'): Buffer {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${size}:${size}:flags=lanczos`, '-f', 'rawvideo', '-pix_fmt', fmt, '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg ${file}: ${r.stderr}`);
  return r.stdout;
}

function ffWritePng(raw: Buffer, w: number, h: number, file: string, fmt = 'rgb24') {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', fmt, '-s', `${w}x${h}`, '-i', '-', file], { input: raw, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg → ${file}: ${r.stderr}`);
}

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

interface Layer { albedo: Buffer; data: Buffer; mean: [number, number, number] }

/** One material at `size`: albedo (diff × AO), data (normal xy, roughness, height), and its mean linear albedo. */
function layerOf(id: string, size: number): Layer {
  const dir = join(SRC, 'tex', id);
  const diff = ffDecode(join(dir, 'diff.jpg'), size), nor = ffDecode(join(dir, 'nor_gl.jpg'), size), arm = ffDecode(join(dir, 'arm.jpg'), size);
  const disp = ffDecode(join(dir, 'disp.jpg'), size);
  const n = size * size;
  // the height, stretched to the full 0..255 range (each scan's displacement uses a different part of it)
  let hMin = 255, hMax = 0;
  for (let i = 0; i < n; i++) { const h = disp[i * 3]; if (h < hMin) hMin = h; if (h > hMax) hMax = h; }
  const hK = 255 / Math.max(1, hMax - hMin);
  const albedo = Buffer.alloc(n * 3), data = Buffer.alloc(n * 4);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const ao = arm[i * 3] / 255;
    const k = 1 - 0.6 * (1 - ao);
    for (let c = 0; c < 3; c++) albedo[i * 3 + c] = Math.round(Math.min(255, diff[i * 3 + c] * k));
    r += srgbToLin(albedo[i * 3] / 255); g += srgbToLin(albedo[i * 3 + 1] / 255); b += srgbToLin(albedo[i * 3 + 2] / 255);
    data[i * 4] = nor[i * 3]; data[i * 4 + 1] = nor[i * 3 + 1]; data[i * 4 + 2] = arm[i * 3 + 1]; data[i * 4 + 3] = Math.round((disp[i * 3] - hMin) * hK);
  }
  return { albedo, data, mean: [r / n, g / n, b / n] };
}

function sha(file: string) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

/** Write a set of layers as mipmapped KTX2 arrays: albedo ETC1S (sRGB), data UASTC (linear RGBA). */
function writeSet(name: string, layers: Layer[], size: number, q: { etc1s: number; lambda: number; albedoOnly?: boolean }) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const albedoPngs: string[] = [], dataPngs: string[] = [];
  layers.forEach((L, i) => {
    const a = join(dir, `albedo-${i}.png`), d = join(dir, `data-${i}.png`);
    ffWritePng(L.albedo, size, size, a); ffWritePng(L.data, size, size, d, 'rgba');
    albedoPngs.push(a); dataPngs.push(d);
  });
  const ka = join(OUT, `${name}-albedo.ktx2`), kd = join(OUT, `${name}-data.ktx2`);
  execFileSync('basisu', [...albedoPngs, '-ktx2', '-tex_type', '2darray', '-mipmap', '-etc1s', '-quality', String(q.etc1s), '-effort', '5', '-output_file', ka], { stdio: 'pipe' });
  if (!q.albedoOnly) execFileSync('basisu', [...dataPngs, '-ktx2', '-tex_type', '2darray', '-mipmap', '-uastc', '-linear', '-lambda', String(q.lambda), '-effort', '4', '-output_file', kd], { stdio: 'pipe' });
  const out: Record<string, unknown> = {};
  for (const [k, f] of (q.albedoOnly ? [['albedo', ka]] : [['albedo', ka], ['data', kd]])) out[k] = { file: f.replace(OUT + '/', ''), bytes: statSync(f).size, sha256: sha(f) };
  return out;
}

// ---- HDR (Radiance RGBE) read and write, for the sky backdrop and the clamped IBL
function readHdr(file: string): { w: number; h: number; px: Float32Array } {
  const buf = readFileSync(file);
  let p = 0;
  const line = () => { let s = ''; while (buf[p] !== 0x0a) s += String.fromCharCode(buf[p++]); p++; return s; };
  for (;;) { const l = line(); if (l === '') break; }
  const dims = line().split(' ');
  const h = Number(dims[1]), w = Number(dims[3]);
  const px = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === w) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = buf[p++];
          if (n > 128) { n -= 128; const v = buf[p++]; while (n--) scan[(x++) * 4 + c] = v; } else { while (n--) scan[(x++) * 4 + c] = buf[p++]; }
        }
      }
    } else {
      for (let x = 0; x < w; x++) { for (let c = 0; c < 4; c++) scan[x * 4 + c] = buf[p++]; }
    }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0;
      const i = (y * w + x) * 3;
      px[i] = scan[x * 4] * f; px[i + 1] = scan[x * 4 + 1] * f; px[i + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { w, h, px };
}

function writeHdr(file: string, w: number, h: number, px: Float32Array) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1');
  const out: number[] = [];
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
      const m = Math.max(r, g, b);
      if (m < 1e-32) { scan.fill(0, x * 4, x * 4 + 4); continue; }
      const e = Math.ceil(Math.log2(m) + 1e-9);
      const f = Math.pow(2, -e) * 256;
      scan[x * 4] = Math.min(255, Math.floor(r * f)); scan[x * 4 + 1] = Math.min(255, Math.floor(g * f)); scan[x * 4 + 2] = Math.min(255, Math.floor(b * f)); scan[x * 4 + 3] = e + 128;
    }
    // new-style run-length encoding: each channel of the scanline separately (Radiance's own format)
    out.push(2, 2, (w >> 8) & 255, w & 255);
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < w) {
        let run = 1;
        while (x + run < w && run < 127 && scan[(x + run) * 4 + c] === scan[x * 4 + c]) run++;
        if (run >= 3) { out.push(128 + run, scan[x * 4 + c]); x += run; continue; }
        // a literal stretch up to the next run of three or more
        let n = 0;
        while (x + n < w && n < 128) {
          if (x + n + 2 < w && scan[(x + n) * 4 + c] === scan[(x + n + 1) * 4 + c] && scan[(x + n) * 4 + c] === scan[(x + n + 2) * 4 + c]) break;
          n++;
        }
        if (n === 0) n = 1;
        out.push(n);
        for (let k = 0; k < n; k++) out.push(scan[(x + k) * 4 + c]);
        x += n;
      }
    }
  }
  writeFileSync(file, Buffer.concat([head, Buffer.from(out)]));
}

/** The sun in an equirect HDR: the brightest region's direction (azimuth from +x toward +z as three's equirect
 *  maps u, elevation) and its peak radiance. */
function sunOf(img: { w: number; h: number; px: Float32Array }) {
  let best = 0, bi = 0;
  for (let i = 0; i < img.w * img.h; i++) { const l = img.px[i * 3] * 0.2126 + img.px[i * 3 + 1] * 0.7152 + img.px[i * 3 + 2] * 0.0722; if (l > best) { best = l; bi = i; } }
  const x = bi % img.w, y = Math.floor(bi / img.w);
  const u = (x + 0.5) / img.w, v = (y + 0.5) / img.h;
  return { u, v, elevationDeg: (0.5 - v) * 180, peak: best };
}

function build(skiesOnly = false) {
  mkdirSync(OUT, { recursive: true });
  const prev = skiesOnly && existsSync(join(OUT, 'manifest.json')) ? JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) : null;
  const manifest: Record<string, unknown> = { materials: MATERIALS.map((m) => m.key), sets: prev?.sets ?? {}, skies: {} };
  const sets = manifest.sets as Record<string, unknown>;
  // hero: the surfaces the camera is closest to (walls, ground, stone), at 2K for desktop; full: every material
  const hero = ['plaster', 'brick', 'earth', 'paving', 'stone'];
  // hero-2k is albedo only (decision 0033): the game streams it over the 1K set's albedo on desktop; its normals,
  // roughness and height stay at 1K (the 2K data array was 15 MB for little that shows at a third-person camera)
  const plan: { name: string; size: number; keys: readonly string[]; etc1s: number; lambda: number; albedoOnly?: boolean }[] = [
    { name: 'hero-2k', size: 2048, keys: hero, etc1s: 85, lambda: 10, albedoOnly: true },
    { name: 'full-1k', size: 1024, keys: MATERIALS.map((m) => m.key), etc1s: 85, lambda: 6 },
    { name: 'full-512', size: 512, keys: MATERIALS.map((m) => m.key), etc1s: 80, lambda: 3 },
  ];
  for (const p of skiesOnly ? [] : plan) {
    const mats = p.keys.map((k) => MATERIALS.find((m) => m.key === k)!);
    const layers = mats.map((m) => layerOf(m.id, p.size));
    sets[p.name] = { size: p.size, keys: p.keys, means: layers.map((l) => l.mean.map((v) => +v.toFixed(4))), files: writeSet(p.name, layers, p.size, { etc1s: p.etc1s, lambda: p.lambda, albedoOnly: p.albedoOnly }) };
    console.log(`${p.name}:`, JSON.stringify(sets[p.name]));
  }
  // skies: the IBL source (1K HDR, the sun clamped so the directional light is not counted twice) and, for the ones
  // used as a backdrop, the upper hemisphere as an 8-bit image (exposure set so the sky's 99th percentile is 0.9)
  const skies = manifest.skies as Record<string, unknown>;
  for (const h of HDRIS) {
    const dir = join(SRC, 'hdri', h.id);
    if (!existsSync(join(dir, '1k.hdr'))) continue;
    const img = readHdr(join(dir, '1k.hdr'));
    const sun = sunOf(img);
    const lum = (i: number) => img.px[i * 3] * 0.2126 + img.px[i * 3 + 1] * 0.7152 + img.px[i * 3 + 2] * 0.0722;
    const L: number[] = [];
    for (let i = 0; i < img.w * img.h / 2; i++) L.push(lum(i));
    L.sort((a, b) => a - b);
    const p99 = L[Math.floor(L.length * 0.99)], p50 = L[Math.floor(L.length * 0.5)];
    const cap = p99 * 4;
    const clamped = new Float32Array(img.px);
    for (let i = 0; i < img.w * img.h; i++) { const l = lum(i); if (l > cap) { const k = cap / l; clamped[i * 3] *= k; clamped[i * 3 + 1] *= k; clamped[i * 3 + 2] *= k; } }
    // the IBL at 512×256 (computers) and 256×128 (phones), box filters of the clamped 1K: PMREM's diffuse and rough
    // lobes need no more, and the sharp reflections (the river) read the visible sky instead
    const half = (src: Float32Array, w: number, hh: number) => {
      const w2 = w / 2, h2 = hh / 2, o = new Float32Array(w2 * h2 * 3);
      for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let c = 0; c < 3; c++) {
        const a = (yy: number, xx: number) => src[((y * 2 + yy) * w + x * 2 + xx) * 3 + c];
        o[(y * w2 + x) * 3 + c] = (a(0, 0) + a(0, 1) + a(1, 0) + a(1, 1)) / 4;
      }
      return o;
    };
    const mid = half(clamped, img.w, img.h);
    const ibl = join(OUT, `sky-${h.id}-ibl-512.hdr`);
    writeHdr(ibl, img.w / 2, img.h / 2, mid);
    const small = half(mid, img.w / 2, img.h / 2);
    const ibl512 = join(OUT, `sky-${h.id}-ibl-256.hdr`);
    writeHdr(ibl512, img.w / 4, img.h / 4, small);
    const entry: Record<string, unknown> = { sun, p50: +p50.toFixed(4), p99: +p99.toFixed(4), ibl: { file: ibl.replace(OUT + '/', ''), bytes: statSync(ibl).size }, iblSmall: { file: ibl512.replace(OUT + '/', ''), bytes: statSync(ibl512).size } };
    if (h.sky && existsSync(join(dir, '4k.hdr'))) {
      const big = readHdr(join(dir, '4k.hdr'));
      const top = Math.round(big.h * 0.56); // the upper hemisphere and a little below the horizon
      const expo = 0.9 / p99;
      for (const [tag, W] of [['4k', 4096], ['2k', 2048], ['preview', 1024]] as const) {
        const raw = Buffer.alloc(big.w * top * 3);
        for (let i = 0; i < big.w * top; i++) {
          for (let c = 0; c < 3; c++) {
            const v = Math.min(1, big.px[i * 3 + c] * expo);
            raw[i * 3 + c] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
          }
        }
        const png = join(TMP, `sky-${h.id}-${tag}.png`);
        mkdirSync(TMP, { recursive: true });
        ffWritePng(raw, big.w, top, png);
        // a KTX2 (Basis UASTC, sRGB, mipmapped) of W × W/4: a GPU-compressed sky, 1 byte a texel on the GPU (ASTC or
        // BC7) instead of 4 as an 8-bit image (the 4K one: 5.6 MB instead of 22 MB with its mips)
        const H = W / 4;
        const sized = join(TMP, `sky-${h.id}-${tag}-${W}x${H}.png`);
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', `scale=${W}:${H}:flags=lanczos`, sized]);
        if (tag === 'preview') {
          // the first frame's sky (a few KB), until the KTX2 streams in after it
          const webp = join(OUT, `sky-${h.id}-preview.webp`);
          execFileSync('cwebp', ['-quiet', '-q', '70', '-sharp_yuv', '-m', '6', sized, '-o', webp]);
          entry.preview = { file: webp.replace(OUT + '/', ''), bytes: statSync(webp).size, width: W, height: H, exposure: +expo.toFixed(5), vSpan: top / big.h };
          continue;
        }
        const ktx = join(OUT, `sky-${h.id}-${tag}.ktx2`);
        execFileSync('basisu', [sized, '-ktx2', '-uastc', '-lambda', '8', '-effort', '4', '-mipmap', '-output_file', ktx], { stdio: 'pipe' });
        entry[`backdrop${tag}`] = { file: ktx.replace(OUT + '/', ''), bytes: statSync(ktx).size, width: W, height: H, exposure: +expo.toFixed(5), vSpan: top / big.h };
      }
    }
    skies[h.id] = entry;
    console.log(`sky ${h.id}:`, JSON.stringify(entry));
  }
  // the basis transcoder: the game uses the kit's copy (atlas/public/game/streets/kit/basis/, world/kitload.ts)
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeLicenses();
  console.log('built →', OUT);
}

function writeLicenses() {
  const rows: string[] = [];
  for (const m of MATERIALS) {
    const f = join(SRC, 'tex', m.id, 'info.json');
    if (!existsSync(f)) continue;
    const i = JSON.parse(readFileSync(f, 'utf8'));
    rows.push(`| ${i.name} (\`${m.id}\`) | ${m.use} | ${i.authors.join(', ')} | ${i.page} | ${Object.values(i.urls as Record<string, string>).map((u) => `\`${u.replace(/^.*\//, '')}\``).join(', ')} |`);
  }
  const sky: string[] = [];
  for (const h of HDRIS) {
    const f = join(SRC, 'hdri', h.id, 'info.json');
    if (!existsSync(f)) continue;
    const i = JSON.parse(readFileSync(f, 'utf8'));
    sky.push(`| ${i.name} (\`${h.id}\`) | ${h.sky ? 'image-based lighting and the visible sky' : 'image-based lighting (candidate)'} | ${i.authors.join(', ')} | ${i.page} | ${Object.values(i.urls as Record<string, string>).map((u) => `\`${u.replace(/^.*\//, '')}\``).join(', ')} |`);
  }
  const shipped = readdirSync(OUT).filter((f) => /\.(ktx2|webp|hdr)$/.test(f)).sort().map((f) => `| \`${f}\` | ${(statSync(join(OUT, f)).size / 1024).toFixed(0)} KB | \`${sha(join(OUT, f)).slice(0, 16)}…\` |`);
  const md = `# Look-dev assets: sources and licences

Textures and skies of the realism look of *Runner of the Tablet House* (\`docs/streets/lookdev.md\`, decision 0033).
Built by \`atlas/scripts/lookdev-assets.ts\` (\`fetch\`, then \`build\`) from the sources below.

## Poly Haven (CC0 1.0)

Every Poly Haven asset is CC0 1.0 Universal (public domain dedication; https://polyhaven.com/license). Attribution is
not required; we give it anyway. Sources were fetched from Poly Haven's public API (\`api.polyhaven.com/files/<id>\`)
on ${new Date().toISOString().slice(0, 10)}, at 2K JPEG (textures) and Radiance HDR (skies), into \`build/lookdev/src2k/\`
(not committed). Each download's magic bytes were checked; only image files were kept.

### Textures

| Asset | Used for | Authors | Page | Files |
|---|---|---|---|---|
${rows.join('\n')}

How they are processed: the albedo is multiplied by the scan's ambient occlusion (60%); the OpenGL normal map's x and
y, the roughness (the green channel of \`arm\`) and the displacement (stretched to the full range) make the data
layer. \`hero-2k\` holds the albedo of the five surfaces seen closest (plaster, brick, earth, paving, stone) at 2K for
desktop; \`full-1k\` and \`full-512\` hold all eight materials, the hero five first. All are the scans resized (Lanczos). Albedo arrays are Basis ETC1S (sRGB),
data arrays Basis UASTC (linear), both mipmapped KTX2 2D arrays, one layer per material.

### Skies

| Asset | Used for | Authors | Page | Files |
|---|---|---|---|---|
${sky.join('\n')}

\`sky-<id>-ibl-512.hdr\` is the 1K HDR, with the sun clamped to four times the sky's 99th percentile (the directional
light carries the sun, so the image must not count it twice), halved to 512×256 for computers; \`-ibl-256.hdr\` is the
same at 256×128, for phones. Both are run-length encoded Radiance files. \`sky-<id>-4k.ktx2\` and \`-2k.ktx2\` are the
upper hemisphere, exposed so the sky's 99th percentile is 0.9, as Basis UASTC sRGB (4096×1024 and 2048×512, mipmapped),
for the visible backdrop; \`-preview.webp\` (1024×256) is the first frame's sky, until the KTX2 streams in.

## Basis Universal (Apache-2.0)

The KTX2 files were encoded with \`basisu\` 2.50 (Apache-2.0, https://github.com/BinomialLLC/basis_universal). The game
transcodes them with the copy of three 0.185.1's transcoder that the kit ships (\`../kit/basis/\`), one loader for both.

## Shipped files

| File | Size | SHA-256 |
|---|---|---|
${shipped.join('\n')}
`;
  writeFileSync(join(OUT, 'LICENSES.md'), md);
}

const cmd = process.argv[2] ?? 'build';
if (cmd === 'fetch') await fetchAll();
else if (cmd === 'build') build();
else if (cmd === 'skies') build(true);
else throw new Error(`unknown command ${cmd}`);
