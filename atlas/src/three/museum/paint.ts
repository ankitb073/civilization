// Canvas painting for the museum's objects: noise, blur, height → normal maps, text layout, wedge signs, coin
// portraits and reverse types. Everything is drawn into 2D canvases that become three.js textures; nothing here
// imports three. Deterministic: every "random" draw comes from rng(label) keyed by the object's id.
import { hash, rng, type Run } from './record.ts';

export type Cv = HTMLCanvasElement;
export type C2 = CanvasRenderingContext2D;

export function canvas(w: number, h: number): Cv {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export const ctxOf = (c: Cv): C2 => c.getContext('2d')!;

export const SERIF = '"EB Garamond Variable", "EB Garamond", Georgia, "Times New Roman", serif';
export const SANS = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
export const HAND = 'Caveat, "Bradley Hand", "Segoe Print", cursive';
export const MONO = '"Courier New", Courier, ui-monospace, Menlo, monospace';

let fontsP: Promise<unknown> | null = null;
/** The atlas's own fonts must be loaded before a canvas draws with them. */
export function ensureFonts(): Promise<unknown> {
  if (!fontsP) {
    const f = document.fonts;
    fontsP = Promise.all([
      f.load(`500 40px ${SERIF}`), f.load(`italic 500 40px ${SERIF}`), f.load(`700 40px ${SERIF}`),
      f.load(`500 40px ${SANS}`), f.load(`500 40px ${HAND}`),
    ]).catch(() => null);
  }
  return fontsP;
}

// ---------------------------------------------------------------- colour
export function hexRgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
export function mixHex(a: string, b: string, t: number): string {
  const A = hexRgb(a), B = hexRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
export const rgba = (h: string, a: number) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };

// ---------------------------------------------------------------- blur
let canFilter: boolean | null = null;
function filterOk(c: C2): boolean {
  if (canFilter === null) {
    // Safari before 18 has no canvas filters: blur through a shadow instead
    canFilter = typeof (c as unknown as { filter?: unknown }).filter === 'string';
    if (canFilter) { const t = ctxOf(canvas(2, 2)); t.filter = 'blur(2px)'; canFilter = t.filter === 'blur(2px)'; }
  }
  return canFilter;
}
/** Draw `src` (an alpha mask) blurred by `r` px in `color`, with the current composite operation. */
export function drawBlurred(c: C2, src: CanvasImageSource & { width: number; height: number }, r: number, color: string, dx = 0, dy = 0) {
  c.save();
  if (r < 0.4) {
    tint(c, src, color, dx, dy);
  } else if (filterOk(c)) {
    const t = tinted(src, color);
    c.filter = `blur(${r.toFixed(2)}px)`;
    c.drawImage(t, dx, dy);
  } else {
    const off = src.width + 64 + Math.ceil(r * 3);
    c.shadowColor = color;
    c.shadowBlur = r * 2;
    c.shadowOffsetX = off;
    c.drawImage(src, dx - off, dy);
  }
  c.restore();
}
function tinted(src: CanvasImageSource & { width: number; height: number }, color: string): Cv {
  const t = canvas(src.width, src.height);
  const x = ctxOf(t);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, t.width, t.height);
  return t;
}
function tint(c: C2, src: CanvasImageSource & { width: number; height: number }, color: string, dx: number, dy: number) {
  c.drawImage(tinted(src, color), dx, dy);
}

// ---------------------------------------------------------------- noise
const tiles = new Map<string, Cv>();
function noiseTile(label: string, n = 64): Cv {
  const k = `${label}:${n}`;
  let t = tiles.get(k);
  if (t) return t;
  t = canvas(n, n);
  const x = ctxOf(t);
  const im = x.createImageData(n, n);
  const r = rng(`tile:${label}`);
  for (let i = 0; i < n * n; i++) { const v = Math.floor(r() * 256); im.data[4 * i] = v; im.data[4 * i + 1] = v; im.data[4 * i + 2] = v; im.data[4 * i + 3] = 255; }
  x.putImageData(im, 0, 0);
  tiles.set(k, t);
  return t;
}
/** Fractal noise over the whole canvas: `octaves` layers of a smooth random tile, from coarse (`scale` px per cell)
 *  to fine, each drawn with `alpha` using the current composite op (e.g. 'overlay' or 'multiply'). */
export function fbm(c: C2, label: string, scale: number, octaves: number, alpha: number, op: GlobalCompositeOperation = 'overlay', x0 = 0, y0 = 0, w = c.canvas.width, h = c.canvas.height) {
  const r = rng(`fbm:${label}`);
  c.save();
  c.globalCompositeOperation = op;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  let s = scale, a = alpha;
  for (let o = 0; o < octaves; o++) {
    const tile = noiseTile(`${label}:${o}`);
    const sw = Math.ceil(w / s) + 2, sh = Math.ceil(h / s) + 2;
    const small = canvas(sw, sh);
    const sx = ctxOf(small);
    const pat = sx.createPattern(tile, 'repeat')!;
    sx.translate(-Math.floor(r() * 64), -Math.floor(r() * 64));
    sx.fillStyle = pat;
    sx.fillRect(0, 0, sw + 64, sh + 64);
    c.globalAlpha = a;
    c.drawImage(small, 0, 0, sw, sh, x0 - s, y0 - s, sw * s, sh * s);
    s = Math.max(1, s / 2.1);
    a *= 0.62;
  }
  c.restore();
}

/** Sprinkle `n` dots of radius ~r (speckled stone, pits, foxing). */
export function speckle(c: C2, label: string, n: number, r: number, color: string, alpha: number, x0 = 0, y0 = 0, w = c.canvas.width, h = c.canvas.height) {
  const R = rng(`speck:${label}`);
  c.save();
  c.fillStyle = color;
  for (let i = 0; i < n; i++) {
    c.globalAlpha = alpha * (0.4 + R() * 0.6);
    const rr = r * (0.3 + R() * R() * 1.7);
    c.beginPath();
    c.ellipse(x0 + R() * w, y0 + R() * h, rr, rr * (0.6 + R() * 0.4), R() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

/** An irregular blob path (stains, spalls, burns) around (x, y). */
export function blobPath(c: C2, label: string, x: number, y: number, rx: number, ry: number, rough = 0.35, n = 22) {
  const R = rng(`blob:${label}`);
  const ph = [R() * 6.28, R() * 6.28, R() * 6.28];
  c.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + rough * (0.5 * Math.sin(a * 2 + ph[0]) + 0.3 * Math.sin(a * 5 + ph[1]) + 0.2 * Math.sin(a * 9 + ph[2]));
    const px = x + Math.cos(a) * rx * k, py = y + Math.sin(a) * ry * k;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
}

/** A jagged polyline from (x0, y0) to (x1, y1) (cracks, breaks, torn edges), as points. */
export function jagged(label: string, x0: number, y0: number, x1: number, y1: number, n: number, amp: number): [number, number][] {
  const R = rng(`jag:${label}`);
  const pts: [number, number][] = [];
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  let off = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    off = i === 0 || i === n ? 0 : off * 0.45 + (R() - 0.5) * amp * 2;
    pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
  }
  return pts;
}

// ---------------------------------------------------------------- height → normals
/** Turn a height canvas (grey, 128 = the surface) into a tangent-space normal map; darken `albedo` in the hollows
 *  (`ao`) so carved letters read even in flat light. Returns the normal map canvas. */
export function finish(height: Cv, strength: number, albedo?: Cv, ao = 0.5): Cv {
  const w = height.width, h = height.height;
  const H = ctxOf(height).getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const oc = ctxOf(out);
  const N = oc.createImageData(w, h);
  const n = N.data;
  const A = albedo ? ctxOf(albedo).getImageData(0, 0, w, h) : null;
  const a = A?.data;
  const k = strength / 255;
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : y) * w, yp = (y < h - 1 ? y + 1 : y) * w, yc = y * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      // Sobel
      const tl = H[4 * (ym + xm)], tc = H[4 * (ym + x)], tr = H[4 * (ym + xp)];
      const ml = H[4 * (yc + xm)], mr = H[4 * (yc + xp)];
      const bl = H[4 * (yp + xm)], bc = H[4 * (yp + x)], br = H[4 * (yp + xp)];
      const gx = (tr + 2 * mr + br - tl - 2 * ml - bl) * 0.25 * k;
      const gy = (bl + 2 * bc + br - tl - 2 * tc - tr) * 0.25 * k;
      // image y runs down, texture v up: n = (-∂h/∂x, +∂h/∂y_img, 1)
      const nx = -gx, ny = gy;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = 4 * (yc + x);
      n[i] = (nx * inv * 0.5 + 0.5) * 255;
      n[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      n[i + 2] = (inv * 0.5 + 0.5) * 255;
      n[i + 3] = 255;
      if (a) {
        const d = H[i] < 128 ? (128 - H[i]) / 128 : 0;
        const f = 1 - Math.min(0.85, d * ao * 2.2);
        a[i] *= f; a[i + 1] *= f; a[i + 2] *= f;
      }
    }
  }
  oc.putImageData(N, 0, 0);
  if (A) ctxOf(albedo!).putImageData(A, 0, 0);
  return out;
}

// ---------------------------------------------------------------- text
export interface Piece { s: string; run: Run; w: number; font: string }
export interface Line { pieces: Piece[]; w: number; gap: boolean }

export function fontFor(base: string, size: number, run: Run, weight = 500): string {
  return `${run.i ? 'italic ' : ''}${run.b ? 700 : weight} ${size.toFixed(1)}px ${base}`;
}

/** Greedy word wrap of styled runs into lines no wider than `width`. Words break after spaces and after the
 *  interpuncts (·) that divide words in the record's transliterations. */
export function wrap(c: C2, runsIn: Run[], width: number, base: string, size: number, weight = 500, tracking = 0): Line[] {
  const lines: Line[] = [];
  let cur: Piece[] = [], cw = 0;
  const push = () => { lines.push({ pieces: cur, w: cw, gap: false }); cur = []; cw = 0; };
  for (const run of runsIn) {
    const font = fontFor(base, size, run, weight);
    c.font = font;
    const words = run.lac ? [run.s] : run.s.split(/(?<=[\s·\-])/);
    for (const wd of words) {
      if (!wd) continue;
      const w = c.measureText(wd).width + tracking * wd.length;
      if (cw + w > width && cw > 0 && wd.trim()) {
        // trailing space off the line
        if (cur.length && /\s$/.test(cur[cur.length - 1].s)) { const p = cur[cur.length - 1]; p.s = p.s.trimEnd(); cw -= p.w - (c.measureText(p.s).width + tracking * p.s.length); p.w = c.measureText(p.s).width + tracking * p.s.length; }
        push();
        if (!wd.trim()) continue;
      }
      if (w > width && !run.lac) {
        // a word longer than the line: break it by characters
        let part = '';
        for (const ch of wd) {
          const pw = c.measureText(part + ch).width + tracking * (part.length + 1);
          if (pw > width - cw && (part || cw)) { cur.push({ s: part, run, w: c.measureText(part).width + tracking * part.length, font }); cw += cur[cur.length - 1].w; push(); part = ch; }
          else part += ch;
        }
        if (part) { const pw = c.measureText(part).width + tracking * part.length; cur.push({ s: part, run, w: pw, font }); cw += pw; }
        continue;
      }
      if (cw === 0 && !wd.trim()) continue;
      cur.push({ s: wd, run, w, font });
      cw += w;
    }
  }
  if (cur.length) push();
  return lines;
}

/** Draw one wrapped line; returns the x-extents of its lacunae (where the object should show damage). */
export function drawLine(c: C2, line: Line, x: number, y: number, opt: { color: string; struck?: string; lacColor?: string; tracking?: number; justify?: number } = { color: '#000' }): [number, number][] {
  const lac: [number, number][] = [];
  let px = x;
  const spaces = opt.justify && line.pieces.length > 1 ? (opt.justify - line.w) / (line.pieces.length - 1) : 0;
  for (const p of line.pieces) {
    c.font = p.font;
    if (p.run.lac) {
      lac.push([px, px + p.w]);
      if (opt.lacColor) { c.fillStyle = opt.lacColor; spaced(c, p.s, px, y, opt.tracking ?? 0); }
    } else {
      c.fillStyle = opt.color;
      spaced(c, p.s, px, y, opt.tracking ?? 0);
      if (p.run.x) {
        const sz = parseFloat(p.font.replace(/^.*?(\d+(\.\d+)?)px.*$/, '$1')) || 12;
        c.save();
        c.strokeStyle = opt.struck ?? opt.color;
        c.lineWidth = Math.max(1, sz * 0.08);
        c.beginPath(); c.moveTo(px, y - sz * 0.28); c.lineTo(px + p.w, y - sz * 0.32); c.stroke();
        c.restore();
      }
    }
    px += p.w + (spaces > 0 && spaces < 40 ? spaces : 0);
  }
  return lac;
}
export function spaced(c: C2, s: string, x: number, y: number, tracking: number) {
  if (!tracking) { c.fillText(s, x, y); return; }
  let px = x;
  for (const ch of s) { c.fillText(ch, px, y); px += c.measureText(ch).width + tracking; }
}

/** Find a font size at which `runs` fill the box: the largest size whose wrapped lines fit `height`. */
export function fitSize(c: C2, runsIn: Run[], width: number, height: number, base: string, lead: number, lo: number, hi: number, weight = 500, tracking = 0): number {
  let best = lo;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    const n = wrap(c, runsIn, width, base, mid, weight, tracking * mid).length;
    if (n * mid * lead <= height) { best = mid; lo = mid; } else hi = mid;
  }
  return best;
}

// ---------------------------------------------------------------- wedge signs (clay)
const VOWELS = /[aeiouyəäöüǫęāēīōūàèìòùáéíóúâêîôûæøåɛɔ]+/i;
/** A word's syllables: each vowel group with the consonants before it; trailing consonants join the last. */
export function syllables(word: string): string[] {
  const w = word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  if (!w) return [];
  if (/^\d+$/.test(w)) return [w];
  const out: string[] = [];
  let rest = w;
  while (rest) {
    const m = rest.match(VOWELS);
    if (!m) { if (out.length) out[out.length - 1] += rest; else out.push(rest); break; }
    const end = m.index! + m[0].length;
    out.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return out;
}

export interface Wedge { x: number; y: number; a: number; l: number; s: number }
/** The sign for a syllable in a script: 2–6 wedges in a cell (unit box), the same every time it is written. */
export function signOf(script: string, syl: string): Wedge[] {
  if (/^\d+$/.test(syl)) {
    // numerals: tens as corner-wedges, units as upright wedges, in stacks of three (the number itself, 1800 → digits)
    const out: Wedge[] = [];
    const digits = syl.slice(0, 3);
    let x = 0.1;
    for (const d of digits) {
      const n = Number(d);
      for (let i = 0; i < n; i++) out.push({ x: x + Math.floor(i / 3) * 0.16, y: 0.18 + (i % 3) * 0.28, a: Math.PI / 2, l: 0.22, s: 0.13 });
      x += Math.max(1, Math.ceil(n / 3)) * 0.16 + 0.08;
    }
    if (!out.length) out.push({ x: 0.3, y: 0.4, a: Math.PI * 0.75, l: 0.2, s: 0.16 });
    return out;
  }
  const R = rng(`sign:${script}:${syl}`);
  const n = 2 + Math.floor(R() * 4);
  const out: Wedge[] = [];
  const kinds = [0, 0, 0, Math.PI / 2, Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI * 0.75];
  for (let i = 0; i < n; i++) {
    const a = kinds[Math.floor(R() * kinds.length)];
    const horiz = Math.abs(Math.cos(a)) > 0.9;
    out.push({
      x: horiz ? 0.05 + R() * 0.25 : 0.15 + R() * 0.7,
      y: horiz ? 0.15 + R() * 0.7 : 0.05 + R() * 0.25,
      a, l: a === Math.PI * 0.75 ? 0.2 : 0.38 + R() * 0.42, s: 0.17 + R() * 0.09,
    });
  }
  return out;
}

/** Press one wedge into a height canvas (dark = deeper): a triangular head and a tapering tail. */
export function pressWedge(c: C2, x: number, y: number, size: number, w: Wedge) {
  const L = w.l * size, S = w.s * size;
  c.save();
  c.translate(x + w.x * size, y + w.y * size);
  c.rotate(w.a);
  c.beginPath();
  c.moveTo(0, -S * 0.75);
  c.lineTo(S * 0.95, 0);
  c.lineTo(0, S * 0.75);
  c.closePath();
  c.fill();
  const a0 = c.globalAlpha;
  c.globalAlpha = a0 * 0.75;
  c.beginPath();
  c.moveTo(S * 0.5, -S * 0.2);
  c.lineTo(Math.max(L, S), 0);
  c.lineTo(S * 0.5, S * 0.2);
  c.closePath();
  c.fill();
  c.globalAlpha = a0;
  c.restore();
}

// ---------------------------------------------------------------- coin designs (unit box −1…1, y down)
type P = [number, number];
function poly(c: C2, pts: P[], close = true) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  if (close) c.closePath();
}
function smoothPoly(c: C2, pts: P[], close = true) {
  c.beginPath();
  const n = pts.length;
  const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (close) {
    const s = mid(pts[n - 1], pts[0]);
    c.moveTo(s[0], s[1]);
    for (let i = 0; i < n; i++) { const m = mid(pts[i], pts[(i + 1) % n]); c.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
    c.closePath();
  } else {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) { const m = mid(pts[i], pts[i + 1]); c.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
    c.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}

/** A ruler's head in profile (facing right; mirror for left). `fill` draws the relief mass, `line` the cut details.
 *  The face is varied by a hash of the person, so one ruler always has the same profile. */
export function drawHead(c: C2, who: string, attr: string, mode: 'fill' | 'line') {
  const R = rng(`head:${who}`);
  const nose = 0.56 + R() * 0.1, chin = 0.38 + R() * 0.08, brow = 0.36 + R() * 0.06, back = -0.56 - R() * 0.08;
  const face: P[] = [
    [-0.02, -0.74], [0.24, -0.62], [brow, -0.42], [brow + 0.04, -0.24], [brow + 0.05, -0.18], [nose, -0.02], [nose - 0.12, 0.05],
    [0.46, 0.13], [0.42, 0.19], [0.46, 0.24], [chin + 0.02, 0.36], [chin - 0.04, 0.44], [0.2, 0.5], [0.17, 0.62], [0.22, 0.86],
    [-0.36, 0.86], [-0.3, 0.62], [-0.36, 0.38], [back + 0.04, 0.05], [back, -0.3], [-0.38, -0.62],
  ];
  if (mode === 'fill') {
    smoothPoly(c, face);
    c.fill();
    if (attr === 'helmeted') {
      smoothPoly(c, [[-0.66, -0.25], [-0.6, -0.68], [-0.22, -0.92], [0.22, -0.82], [0.42, -0.5], [0.44, -0.3], [0.1, -0.32], [-0.1, -0.06], [-0.44, 0.02]]);
      c.fill();
      // crest
      smoothPoly(c, [[-0.7, -0.5], [-0.5, -1.0], [0.0, -1.12], [0.3, -0.96], [0.0, -0.98], [-0.42, -0.86]]);
      c.fill();
    } else if (attr === 'veiled') {
      smoothPoly(c, [[0.2, -0.68], [-0.1, -0.84], [-0.52, -0.66], [-0.72, -0.2], [-0.74, 0.4], [-0.62, 0.86], [-0.28, 0.86], [-0.42, 0.3], [-0.36, -0.26], [-0.1, -0.5]]);
      c.fill();
    } else if (attr === 'bearded') {
      smoothPoly(c, [[-0.08, 0.06], [0.2, 0.1], [0.4, 0.3], [chin + 0.04, 0.5], [0.22, 0.62], [-0.08, 0.48], [-0.2, 0.22]]);
      c.fill();
    }
    // hair mass
    if (attr !== 'helmeted' && attr !== 'veiled') {
      smoothPoly(c, [[0.24, -0.6], [-0.02, -0.8], [-0.46, -0.68], [back - 0.06, -0.3], [back - 0.02, 0.1], [-0.42, 0.3], [-0.2, 0.1], [-0.08, -0.4]]);
      c.fill();
    }
    return;
  }
  // details: eye, ear, mouth, the attribute's lines
  c.beginPath(); c.ellipse(0.28, -0.17, 0.05, 0.025, -0.1, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(0.2, -0.24); c.quadraticCurveTo(0.29, -0.28, 0.35, -0.22); c.stroke();
  c.beginPath(); c.moveTo(0.36, 0.19); c.lineTo(0.43, 0.19); c.stroke();
  if (attr !== 'helmeted' && attr !== 'veiled') {
    c.beginPath(); c.ellipse(-0.16, -0.05, 0.07, 0.11, 0, -1.2, 2.6); c.stroke();
    // hair curls
    for (let i = 0; i < 9; i++) {
      const t = i / 8, x = -0.46 + t * 0.6 - (t > 0.6 ? (t - 0.6) * 0.4 : 0), y = -0.62 + Math.sin(t * 3) * 0.06 + t * 0.1;
      c.beginPath(); c.arc(x, y, 0.05, 0.3, 4.6); c.stroke();
      c.beginPath(); c.arc(x - 0.06, y + 0.22, 0.05, 0.3, 4.6); c.stroke();
    }
  }
  if (attr === 'diademed') {
    c.beginPath(); c.moveTo(0.26, -0.56); c.quadraticCurveTo(-0.1, -0.5, -0.5, -0.36); c.stroke();
    c.beginPath(); c.moveTo(0.26, -0.5); c.quadraticCurveTo(-0.1, -0.44, -0.5, -0.3); c.stroke();
    // ribbons
    c.beginPath(); c.moveTo(-0.5, -0.33); c.quadraticCurveTo(-0.7, -0.05, -0.62, 0.3); c.stroke();
    c.beginPath(); c.moveTo(-0.5, -0.33); c.quadraticCurveTo(-0.58, 0.0, -0.48, 0.34); c.stroke();
  } else if (attr === 'laureate') {
    for (let i = 0; i < 8; i++) {
      const t = i / 7, x = 0.22 - t * 0.74, y = -0.58 + t * 0.26;
      c.beginPath(); c.ellipse(x, y - 0.05, 0.075, 0.03, -0.6 + t * 0.4, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.ellipse(x - 0.02, y + 0.05, 0.075, 0.03, 0.5 + t * 0.4, 0, Math.PI * 2); c.stroke();
    }
  } else if (attr === 'helmeted') {
    c.beginPath(); c.moveTo(0.42, -0.42); c.quadraticCurveTo(0.0, -0.36, -0.6, -0.3); c.stroke();
    c.beginPath(); c.moveTo(-0.62, -0.5); c.quadraticCurveTo(-0.3, -1.0, 0.25, -0.96); c.stroke();
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(-0.55 + i * 0.12, -0.6 - Math.sin(i / 5 * 2.6) * 0.32); c.lineTo(-0.48 + i * 0.12, -0.84 - Math.sin(i / 5 * 2.6) * 0.18); c.stroke(); }
  } else if (attr === 'veiled') {
    for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-0.3 - i * 0.1, -0.6 + i * 0.05); c.quadraticCurveTo(-0.55 - i * 0.04, 0.0, -0.45 - i * 0.06, 0.8); c.stroke(); }
  } else if (attr === 'bearded') {
    for (let i = 0; i < 7; i++) { c.beginPath(); c.arc(0.02 + (i % 4) * 0.1, 0.22 + Math.floor(i / 4) * 0.14 + (i % 4) * 0.04, 0.045, 0.3, 4.6); c.stroke(); }
  }
  // the bust's cut
  c.beginPath(); c.moveTo(-0.36, 0.84); c.quadraticCurveTo(-0.07, 0.92, 0.22, 0.84); c.stroke();
}

/** The reverse types the record names. `fill` draws the relief mass, `line` the cut details. */
export function drawReverse(c: C2, type: string, mode: 'fill' | 'line') {
  const t = type.toLowerCase();
  const F = mode === 'fill';
  const doFill = () => (F ? c.fill() : c.stroke());
  if (/ship/.test(t)) {
    smoothPoly(c, [[-0.8, 0.12], [0.75, 0.12], [0.86, -0.06], [0.6, 0.36], [-0.6, 0.36], [-0.86, 0.02]]); doFill();
    if (F) { c.fillRect(-0.03, -0.82, 0.06, 0.96); smoothPoly(c, [[-0.5, -0.7], [0.5, -0.7], [0.56, -0.2], [0, -0.1], [-0.56, -0.2]]); c.fill(); }
    else {
      for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(-0.5 + i * 0.2, 0.32); c.lineTo(-0.62 + i * 0.2, 0.6); c.stroke(); }
      c.beginPath(); c.moveTo(-0.9, 0.7); for (let i = 0; i <= 8; i++) c.quadraticCurveTo(-0.9 + i * 0.225 - 0.11, 0.62, -0.9 + i * 0.225, 0.7); c.stroke();
      c.beginPath(); c.moveTo(-0.5, -0.45); c.lineTo(0.5, -0.45); c.stroke();
    }
  } else if (/temple/.test(t)) {
    if (F) {
      c.fillRect(-0.8, 0.5, 1.6, 0.1); c.fillRect(-0.72, 0.4, 1.44, 0.1); c.fillRect(-0.64, -0.38, 1.28, 0.12);
      for (let i = 0; i < 4; i++) c.fillRect(-0.58 + i * 0.36, -0.26, 0.12, 0.66);
      poly(c, [[-0.72, -0.38], [0, -0.8], [0.72, -0.38]]); c.fill();
    } else {
      for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-0.55 + i * 0.36, -0.24); c.lineTo(-0.55 + i * 0.36, 0.38); c.stroke(); }
      poly(c, [[-0.5, -0.44], [0, -0.7], [0.5, -0.44]]); c.stroke();
    }
  } else if (/wheat|ear/.test(t)) {
    if (F) {
      c.lineWidth = 0.08; c.beginPath(); c.moveTo(0.05, 0.9); c.quadraticCurveTo(-0.05, 0.2, 0.0, -0.4); c.stroke();
      for (let i = 0; i < 7; i++) for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * 0.11, 0.25 - i * 0.16, 0.09, 0.15, s * 0.5, 0, Math.PI * 2); c.fill(); }
      c.beginPath(); c.ellipse(0, -0.85, 0.07, 0.13, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(0.05, 0.6); c.quadraticCurveTo(0.4, 0.4, 0.62, 0.0); c.lineTo(0.66, 0.06); c.quadraticCurveTo(0.42, 0.5, 0.07, 0.68); c.fill();
    } else {
      for (let i = 0; i < 7; i++) for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 0.18, 0.15 - i * 0.16); c.lineTo(s * 0.42, -0.2 - i * 0.16); c.stroke(); }
    }
  } else if (/goddess/.test(t)) {
    if (F) {
      c.fillRect(-0.55, -0.25, 0.14, 0.95); c.fillRect(-0.55, 0.1, 0.75, 0.14); c.fillRect(0.06, 0.1, 0.12, 0.6);
      smoothPoly(c, [[-0.4, -0.3], [-0.06, -0.36], [0.06, 0.14], [0.5, 0.18], [0.5, 0.66], [0.36, 0.7], [0.32, 0.32], [-0.36, 0.3]]); c.fill();
      c.beginPath(); c.arc(-0.2, -0.52, 0.15, 0, Math.PI * 2); c.fill();
      c.fillRect(-0.34, -0.8, 0.28, 0.14);
      for (let i = 0; i < 3; i++) c.fillRect(-0.34 + i * 0.11, -0.88, 0.06, 0.1);
      c.lineWidth = 0.05; c.beginPath(); c.moveTo(-0.05, -0.2); c.lineTo(0.5, -0.3); c.stroke();
      c.beginPath(); c.moveTo(0.5, -0.82); c.lineTo(0.5, 0.2); c.stroke();
    } else {
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-0.3 + i * 0.1, -0.2); c.quadraticCurveTo(-0.2 + i * 0.1, 0.1, 0.0 + i * 0.12, 0.28); c.stroke(); }
    }
  } else if (/eagle/.test(t)) {
    if (F) {
      c.beginPath(); c.ellipse(0, 0.05, 0.18, 0.42, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(0.06, -0.45, 0.13, 0, Math.PI * 2); c.fill();
      poly(c, [[0.16, -0.48], [0.32, -0.42], [0.18, -0.38]]); c.fill();
      for (const s of [-1, 1]) { smoothPoly(c, [[s * 0.1, -0.2], [s * 0.5, -0.62], [s * 0.92, -0.7], [s * 0.86, -0.3], [s * 0.6, 0.05], [s * 0.14, 0.12]]); c.fill(); }
      poly(c, [[-0.12, 0.38], [0.12, 0.38], [0.26, 0.82], [-0.26, 0.82]]); c.fill();
    } else {
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(s * (0.2 + i * 0.13), -0.3 - i * 0.07); c.lineTo(s * (0.28 + i * 0.13), 0.02 - i * 0.04); c.stroke(); }
      for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-0.08 + i * 0.05, 0.42); c.lineTo(-0.18 + i * 0.12, 0.8); c.stroke(); }
    }
  } else if (/bull/.test(t)) {
    if (F) {
      smoothPoly(c, [[-0.68, -0.18], [-0.2, -0.32], [0.38, -0.3], [0.62, -0.42], [0.82, -0.3], [0.8, -0.04], [0.6, 0.06], [0.5, 0.26], [-0.62, 0.24], [-0.78, 0.0]]); c.fill();
      c.lineWidth = 0.1;
      for (const [x0, x1] of [[-0.55, -0.6], [-0.38, -0.32], [0.3, 0.36], [0.46, 0.52]]) { c.beginPath(); c.moveTo(x0, 0.2); c.lineTo(x1, 0.66); c.stroke(); }
      c.lineWidth = 0.05;
      c.beginPath(); c.moveTo(0.64, -0.4); c.quadraticCurveTo(0.6, -0.68, 0.84, -0.7); c.stroke();
      c.beginPath(); c.moveTo(-0.76, -0.1); c.quadraticCurveTo(-0.92, 0.2, -0.84, 0.46); c.stroke();
    } else {
      c.beginPath(); c.moveTo(-0.9, 0.7); c.lineTo(0.9, 0.7); c.stroke();
      c.beginPath(); c.arc(0.7, -0.24, 0.03, 0, Math.PI * 2); c.stroke();
    }
  } else {
    // a horseman
    if (F) {
      smoothPoly(c, [[-0.6, -0.05], [0.2, -0.1], [0.42, -0.48], [0.62, -0.5], [0.6, -0.3], [0.4, -0.1], [0.38, 0.18], [-0.56, 0.2], [-0.72, 0.05]]); c.fill();
      c.lineWidth = 0.08;
      for (const [x0, y0, x1, y1] of [[-0.5, 0.15, -0.66, 0.66], [-0.3, 0.15, -0.2, 0.66], [0.2, 0.15, 0.34, 0.62], [0.32, 0.12, 0.56, 0.42]]) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
      c.lineWidth = 0.05; c.beginPath(); c.moveTo(-0.66, 0.0); c.quadraticCurveTo(-0.9, 0.2, -0.82, 0.4); c.stroke();
      smoothPoly(c, [[-0.18, -0.12], [-0.06, -0.6], [0.06, -0.62], [0.08, -0.14]]); c.fill();
      c.beginPath(); c.arc(0.0, -0.74, 0.1, 0, Math.PI * 2); c.fill();
      c.lineWidth = 0.035; c.beginPath(); c.moveTo(-0.5, -0.9); c.lineTo(0.62, -0.18); c.stroke();
    } else {
      c.beginPath(); c.moveTo(-0.9, 0.72); c.lineTo(0.9, 0.72); c.stroke();
      c.beginPath(); c.moveTo(0.42, -0.46); c.quadraticCurveTo(0.3, -0.3, 0.2, -0.1); c.stroke();
    }
  }
}

/** Letters around a circle, reading clockwise from `start` (radians, 0 = 3 o'clock), upright to the rim. */
export function ringText(c: C2, text: string, cx: number, cy: number, r: number, start: number, size: number, font: string) {
  c.font = `600 ${size}px ${font}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const total = [...text].reduce((t, ch) => t + c.measureText(ch).width + size * 0.12, 0);
  let a = start - total / r / 2;
  for (const ch of text) {
    const w = c.measureText(ch).width + size * 0.12;
    a += w / 2 / r;
    c.save();
    c.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    c.rotate(a + Math.PI / 2);
    c.fillText(ch, 0, 0);
    c.restore();
    a += w / 2 / r;
  }
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------- symbols for stele lunettes
/** A divine symbol for the god a stele is dedicated to (which symbol: a hash of the deity's id). */
export function drawDivine(c: C2, deity: string | null, cx: number, cy: number, r: number) {
  const k = deity ? hash(`sym:${deity}`) % 4 : 0;
  c.save();
  c.translate(cx, cy);
  if (k === 0) {
    // an eight-pointed star in a disc
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(0, 0, r * 0.82, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.3 : r * 0.78; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    c.closePath(); c.fill();
  } else if (k === 1) {
    // a winged disc
    c.beginPath(); c.arc(0, 0, r * 0.42, 0, Math.PI * 2); c.fill();
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(s * r * 0.4, -r * 0.15 + i * r * 0.17);
      c.quadraticCurveTo(s * r * 1.4, -r * 0.5 + i * r * 0.22, s * r * (2.3 - i * 0.35), -r * 0.25 + i * r * 0.26);
      c.lineTo(s * r * 0.4, r * 0.08 + i * r * 0.17);
      c.closePath(); c.fill();
    }
  } else if (k === 2) {
    // a crescent over a disc
    c.beginPath(); c.arc(0, r * 0.35, r * 0.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(0, -r * 0.25, r * 0.75, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(0, -r * 0.55, r * 0.68, 0, Math.PI * 2); c.fill();
  } else {
    // a rayed sun
    c.beginPath(); c.arc(0, 0, r * 0.45, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.beginPath();
      c.moveTo(Math.cos(a - 0.12) * r * 0.5, Math.sin(a - 0.12) * r * 0.5);
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      c.lineTo(Math.cos(a + 0.12) * r * 0.5, Math.sin(a + 0.12) * r * 0.5);
      c.fill();
    }
  }
  c.restore();
}

// ---------------------------------------------------------------- SVG (arms, seals) → images
const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
export function svgImage(svg: string): Promise<HTMLImageElement | null> {
  let p = imgCache.get(svg);
  if (!p) {
    p = new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => ok(null);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', '<svg width="200" height="240" '))}`;
    });
    imgCache.set(svg, p);
  }
  return p;
}

/** An image as relief: its luminance and shape → heights (light parts raised), into `c` at (x, y, w, h). */
export function imageRelief(c: C2, img: CanvasImageSource, x: number, y: number, w: number, h: number, depth: number, blur: number) {
  const t = canvas(w, h);
  const tc = ctxOf(t);
  tc.drawImage(img, 0, 0, w, h);
  const im = tc.getImageData(0, 0, t.width, t.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    const a = d[i + 3] / 255;
    const v = a * (0.45 + lum * 0.55);
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = Math.round(v * 255);
  }
  tc.putImageData(im, 0, 0);
  c.save();
  c.globalAlpha = Math.min(1, depth);
  drawBlurred(c, t, blur, '#ffffff', x, y);
  c.restore();
}
