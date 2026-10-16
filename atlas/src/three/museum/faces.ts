// The surfaces of the museum's objects, painted from the record into canvases: an albedo map and a height map,
// turned into a normal map (carved letters, struck portraits, wedge impressions, paper fibre). One painter per kind
// of surface; the model builders in models.ts decide where each surface goes.
import { blazon } from '../../heraldry.ts';
import { blocksText, h01, rng, runs as toRuns, type Block, type ObjectSpec, type Run, type Stuff } from './record.ts';
import {
  blobPath, canvas, ctxOf, drawBlurred, drawDivine, drawHead, drawLine, drawReverse, fbm, finish, fitSize, HAND, imageRelief,
  jagged, MONO, mixHex, pressWedge, rgba, ringText, SANS, SERIF, signOf, speckle, syllables, wrap, type C2, type Cv, type Line,
} from './paint.ts';

export interface Imgs { arms: Map<string, HTMLImageElement>; sigil: HTMLImageElement | null }
export interface Tex { map: Cv; normal: Cv | null; alpha?: boolean }

// ---------------------------------------------------------------- materials
export const STONE: Record<string, { base: string; dark: string; light: string; cut: string; speck?: [string, number][]; grain: number }> = {
  basalt: { base: '#4a4846', dark: '#2c2b2a', light: '#6d6a66', cut: '#7a7671', speck: [['#8a8780', 0.0009], ['#1f1e1d', 0.0012]], grain: 0.3 },
  diorite: { base: '#4f5452', dark: '#262a29', light: '#8d918d', cut: '#9a9c97', speck: [['#e4e2da', 0.006], ['#151817', 0.004]], grain: 0.35 },
  limestone: { base: '#d9cdb1', dark: '#b6a582', light: '#ece3cd', cut: '#cbbb98', speck: [['#a8956f', 0.0012], ['#f3ecdc', 0.001]], grain: 0.4 },
  sandstone: { base: '#bea385', dark: '#97805f', light: '#d6c2a6', cut: '#b09676', speck: [['#8b6a47', 0.0014]], grain: 0.45 },
  granite: { base: '#a39a93', dark: '#6b625d', light: '#c9c0b8', cut: '#bbb2aa', speck: [['#2b2826', 0.006], ['#d9b6a6', 0.004], ['#f2ece6', 0.003]], grain: 0.35 },
  steatite: { base: '#5d665b', dark: '#3a4239', light: '#7e8879', cut: '#7a8576', grain: 0.2 },
  brick: { base: '#a65a3c', dark: '#7a3b25', light: '#c47a58', cut: '#93503a', speck: [['#5e2e1d', 0.002], ['#d8a07a', 0.0015]], grain: 0.55 },
  plaster: { base: '#e3dac6', dark: '#bfb39b', light: '#f1ebdd', cut: '#cfc4ad', grain: 0.3 },
  clay: { base: '#a08a70', dark: '#76644f', light: '#bba992', cut: '#8e785f', speck: [['#6f5f4c', 0.002]], grain: 0.32 },
  terracotta: { base: '#b9673f', dark: '#8e4a2b', light: '#d0865e', cut: '#a35a37', grain: 0.4 },
  wax: { base: '#2e2620', dark: '#1a1512', light: '#46392f', cut: '#b9946a', grain: 0.2 },
};
export const METAL: Record<string, string> = { bronze: '#9a6a3c', silver: '#b4b0a8', gold: '#d9a842', copper: '#b06e48' };

/** The colour (not the metal) of a state's arms, from the herald's own blazon (atlas/src/heraldry.ts). */
const TINCT: Record<string, string> = { Gules: '#b3322a', Azure: '#27589b', Vert: '#2c7847', Purpure: '#6a3c88', Sable: '#28231f', Or: '#d6a634', Argent: '#f2eee5' };
export function stateColour(s: ObjectSpec, pol: string | null = s.issuer): string | null {
  const spec = pol ? s.arms[pol] : undefined;
  if (!spec) return null;
  const b = blazon(spec);
  const name = ['Gules', 'Azure', 'Vert', 'Purpure', 'Sable'].find((n) => b.includes(n));
  return name ? TINCT[name] : null;
}

function clayColour(s: ObjectSpec): string {
  const k = h01(`clay:${s.id}`);
  return k < 0.4 ? '#a08a70' : k < 0.7 ? '#978369' : k < 0.9 ? '#aa967a' : '#8e7f6b';
}

// ---------------------------------------------------------------- shared steps
function grain(a: C2, hgt: C2, label: string, W: number, H: number, st: { base: string; dark: string; light: string; speck?: [string, number][]; grain: number; rough?: number }) {
  a.fillStyle = st.base;
  a.fillRect(0, 0, W, H);
  const big = Math.max(W, H);
  fbm(a, `${label}:alb`, big / 4, 5, st.grain * 0.4, 'overlay');
  fbm(a, `${label}:fine`, Math.max(2, big / 90), 2, st.grain * 0.25, 'overlay');
  for (const [col, dens] of st.speck ?? []) speckle(a, `${label}:${col}`, Math.round(W * H * dens * 0.25), Math.max(0.6, big / 900), col, 0.75);
  hgt.fillStyle = '#808080';
  hgt.fillRect(0, 0, W, H);
  fbm(hgt, `${label}:h`, Math.max(3, big / 60), 4, st.rough ?? 0.3, 'overlay');
}

export interface CarveOpts {
  font?: string;
  mode: 'carve' | 'raise' | 'scratch' | 'paint';
  /** pigment left in the letters */
  paint?: string | null;
  lead?: number;
  tracking?: number;
  caps?: boolean;
  rules?: boolean;
  minSize?: number;
  maxSize?: number;
  weight?: number;
}

/** Cut text into a surface: rows fitted to the box, with damage from the condition report. Returns the row
 *  geometry so callers can place cracks and breaks. */
function cutText(a: C2, hgt: C2, s: ObjectSpec, text: string | Run[], box: [number, number, number, number], o: CarveOpts, colour: { ink: string; cut: string; cutAlpha?: number }) {
  const [x0, y0, bw, bh] = box;
  const font = o.font ?? SERIF;
  const lead = o.lead ?? 1.5;
  const tr = o.tracking ?? 0.04;
  const rr = typeof text === 'string' ? toRuns(o.caps ? text.toUpperCase() : text) : text;
  const wt = o.weight ?? 600;
  const size = fitSize(a, rr, bw, bh, font, lead, o.minSize ?? 5, o.maxSize ?? bh / 3, wt, tr);
  const lines = typeof text === 'string' ? wrap(a, toRuns(o.caps ? text.toUpperCase() : text), bw, font, size, wt, tr * size) : wrap(a, rr, bw, font, size, wt, tr * size);
  const W = a.canvas.width, H = a.canvas.height;
  const mask = canvas(W, H), mc = ctxOf(mask);
  const worn = canvas(W, H), wc = ctxOf(worn);
  mc.textBaseline = 'alphabetic'; wc.textBaseline = 'alphabetic';
  const d = s.dmg;
  const lineH = size * lead;
  const lacs: [number, number, number][] = [];
  const nWorn = d.wornLast ? Math.max(1, Math.round(lines.length * 0.28)) : 0;
  lines.forEach((ln, i) => {
    const y = y0 + size + i * lineH;
    if (y > y0 + bh + size * 0.2) return;
    const target = i >= lines.length - nWorn ? wc : mc;
    const lac = drawLine(target, ln, x0 + (o.mode === 'scratch' ? 0 : Math.max(0, (bw - ln.w) / 2) * 0.15), y, { color: '#fff', tracking: tr * size });
    for (const [l, r] of lac) lacs.push([l, r, y]);
    if (o.rules && o.mode === 'carve') { mc.save(); mc.globalAlpha = 0.35; mc.fillStyle = '#fff'; mc.fillRect(x0 - size * 0.2, y + size * 0.32, bw + size * 0.4, Math.max(1, size * 0.04)); mc.restore(); }
  });
  const blur = size * (0.025 + d.weather * 0.045);
  if (o.mode === 'carve') {
    drawBlurred(hgt, mask, blur * 2.5, 'rgba(0,0,0,0.5)');
    drawBlurred(hgt, mask, blur, 'rgba(0,0,0,0.5)');
    drawBlurred(hgt, worn, blur * 4, 'rgba(0,0,0,0.28)');
    // the cut catches dust and old pigment
    a.save(); a.globalAlpha = colour.cutAlpha ?? 0.3; drawBlurred(a, mask, blur, colour.cut); a.restore();
    if (o.paint) { a.save(); a.globalAlpha = 0.5 * (1 - d.weather * 0.7); a.globalCompositeOperation = 'multiply'; drawBlurred(a, mask, blur * 0.8, o.paint); a.restore(); }
    a.save(); a.globalAlpha = 0.15; drawBlurred(a, worn, blur * 3, colour.cut); a.restore();
  } else if (o.mode === 'raise') {
    drawBlurred(hgt, mask, blur * 2.2, 'rgba(255,255,255,0.45)');
    drawBlurred(hgt, mask, blur * 0.8, 'rgba(255,255,255,0.4)');
    drawBlurred(hgt, worn, blur * 3, 'rgba(255,255,255,0.25)');
  } else if (o.mode === 'scratch') {
    drawBlurred(hgt, mask, Math.max(0.5, blur * 0.6), 'rgba(0,0,0,0.45)');
    a.save(); a.globalAlpha = 0.6; drawBlurred(a, mask, 0.4, colour.ink); a.restore();
  } else {
    a.save(); a.globalAlpha = 0.82; drawBlurred(a, mask, size * 0.03, colour.ink); a.restore();
    a.save(); a.globalAlpha = 0.35; drawBlurred(a, worn, size * 0.05, colour.ink); a.restore();
  }
  return { size, lines, lineH, lacs };
}

/** A spall: a patch where the surface has flaked away (lacunae, lost lines). */
function spall(a: C2, hgt: C2, label: string, x: number, y: number, rx: number, ry: number, fresh: string) {
  hgt.save();
  blobPath(hgt, label, x, y, rx, ry, 0.45);
  hgt.clip();
  hgt.fillStyle = '#5a5a5a';
  hgt.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
  fbm(hgt, `${label}:sp`, Math.max(4, rx / 4), 3, 0.5, 'overlay', x - rx * 2, y - ry * 2, rx * 4, ry * 4);
  hgt.restore();
  a.save();
  blobPath(a, label, x, y, rx, ry, 0.45);
  a.clip();
  a.globalAlpha = 0.55;
  a.fillStyle = fresh;
  a.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
  a.restore();
}

function crack(a: C2, hgt: C2, pts: [number, number][], w: number) {
  for (const [ctx, col, lw] of [[hgt, '#1a1a1a', w * 1.6], [a, 'rgba(25,20,15,0.85)', w * 0.7]] as const) {
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }
}

function soot(a: C2, label: string, W: number, H: number, strength: number) {
  // fire blackens the edges in patches: a ragged band, darker at the rim
  const R = rng(`soot:${label}`);
  const m = canvas(W, H), mc = ctxOf(m);
  mc.fillStyle = '#000';
  const big = Math.max(W, H);
  for (let i = 0; i < 14; i++) {
    const edge = i % 4;
    const t = R();
    const x = edge === 0 ? 0 : edge === 1 ? W : t * W, y = edge === 2 ? 0 : edge === 3 ? H : t * H;
    blobPath(mc, `${label}:s${i}`, x, y, big * (0.06 + R() * 0.1), big * (0.05 + R() * 0.08), 0.6);
    mc.fill();
  }
  a.save();
  a.globalCompositeOperation = 'multiply';
  a.globalAlpha = 0.32 * strength;
  drawBlurred(a, m, big * 0.025, '#3a2c22');
  a.globalAlpha = 0.18 * strength;
  drawBlurred(a, m, big * 0.006, '#241b16');
  a.restore();
}

// ---------------------------------------------------------------- stone and metal faces
export interface FaceLayout {
  W: number; H: number;
  /** the text box in px */
  box: [number, number, number, number];
  /** a relief symbol (stele lunette) centre and radius */
  symbol?: [number, number, number];
  /** a relief frame around the text */
  frame?: [number, number, number, number];
  /** a dressed panel cut into rough rock: smoother, a step lower */
  panel?: [number, number, number, number];
  /** where the stone breaks off (px polyline, everything below is gone) */
  breakLine?: [number, number][];
  crackLine?: [number, number][];
}

/** An inscribed stone (or metal) face: stele, slab, rock panel, brick stamp, foundation tablet, graffito, plaque. */
export function inscribedFace(s: ObjectSpec, L: FaceLayout, imgs: Imgs): Tex & { size: number } {
  const { W, H } = L;
  const map = canvas(W, H), hgt = canvas(W, H);
  const a = ctxOf(map), h = ctxOf(hgt);
  const metal = s.stuff === 'bronze' || s.stuff === 'silver' || s.stuff === 'gold';
  const st = metal ? { base: METAL[s.stuff], dark: mixHex(METAL[s.stuff], '#000000', 0.5), light: mixHex(METAL[s.stuff], '#ffffff', 0.3), grain: 0.12, rough: 0.07, cut: mixHex(METAL[s.stuff], '#000000', 0.45) } : STONE[s.stuff] ?? STONE.limestone;
  grain(a, h, s.id, W, H, st);
  if (metal) {
    // patina: verdigris on bronze, tarnish on silver, gathered in the hollows later
    a.save();
    a.globalCompositeOperation = 'source-over';
    fbm(a, `${s.id}:pat`, W / 4, 3, s.stuff === 'bronze' ? 0.3 : 0.1, 'overlay');
    a.globalCompositeOperation = 'color';
    a.fillStyle = s.stuff === 'bronze' ? '#4f8f78' : '#4a4038';
    a.globalAlpha = s.stuff === 'bronze' ? 0.55 : 0.3;
    a.fillRect(0, 0, W, H);
    a.restore();
  }
  const d = s.dmg;
  if (L.panel) {
    // rough rock all round, a smooth dressed panel sunk into it
    fbm(h, `${s.id}:rough`, Math.max(W, H) / 10, 4, 0.28, 'overlay');
    const [x, y, pw, ph] = L.panel;
    const m = canvas(W, H), mc = ctxOf(m);
    mc.fillStyle = '#fff';
    mc.beginPath(); mc.roundRect(x, y, pw, ph, Math.min(pw, ph) * 0.04); mc.fill();
    h.save(); h.beginPath(); h.roundRect(x, y, pw, ph, Math.min(pw, ph) * 0.04); h.clip(); h.fillStyle = '#6a6a6a'; h.fillRect(0, 0, W, H); fbm(h, `${s.id}:dress`, Math.max(3, pw / 80), 3, 0.12, 'overlay', x, y, pw, ph); h.restore();
    a.save(); a.globalAlpha = 0.18; a.globalCompositeOperation = 'multiply'; a.fillStyle = st.dark; a.fillRect(0, 0, W, H); a.restore();
    a.save(); a.globalAlpha = 0.55; drawBlurred(a, m, Math.max(1, pw * 0.004), st.light); a.restore();
    fbm(a, `${s.id}:dressA`, Math.max(3, pw / 40), 2, 0.06, 'overlay', x, y, pw, ph);
  }
  // relief frame
  if (L.frame) {
    const [fx, fy, fw, fh] = L.frame;
    const lw = Math.max(2, Math.min(W, H) * 0.018);
    const m = canvas(W, H), mc = ctxOf(m);
    mc.strokeStyle = '#fff'; mc.lineWidth = lw;
    if (L.symbol) {
      // the frame follows the lunette's arch
      const r = fw / 2;
      mc.beginPath(); mc.moveTo(fx, fy + fh); mc.lineTo(fx, fy + r); mc.arc(fx + r, fy + r, r, Math.PI, 0); mc.lineTo(fx + fw, fy + fh); mc.closePath(); mc.stroke();
    } else mc.strokeRect(fx, fy, fw, fh);
    if (metal || s.family === 'brick') drawBlurred(h, m, lw * 0.5, 'rgba(255,255,255,0.55)');
    else { drawBlurred(h, m, lw * 0.6, 'rgba(0,0,0,0.38)'); drawBlurred(h, m, lw * 1.6, 'rgba(255,255,255,0.16)'); }
  }
  // the god's symbol in the lunette, in raised relief
  if (L.symbol) {
    const [cx, cy, r] = L.symbol;
    const m = canvas(W, H), mc = ctxOf(m);
    mc.fillStyle = '#fff';
    drawDivine(mc, s.deity, cx, cy, r);
    drawBlurred(h, m, r * 0.1, 'rgba(255,255,255,0.55)');
    drawBlurred(h, m, r * 0.025, 'rgba(255,255,255,0.4)');
    a.save(); a.globalAlpha = 0.3; drawBlurred(a, m, r * 0.03, st.light); a.restore();
    a.save(); a.globalAlpha = 0.22; drawBlurred(a, m, r * 0.06, st.dark, r * 0.03, r * 0.04); a.restore();
  }
  // the text
  const pigment = !metal && s.era <= 2 && h01(`paint:${s.id}`) < 0.6 ? (stateColour(s) ?? '#8e3b22') : null;
  const mode: CarveOpts['mode'] = s.family === 'plaster' ? (/painted/.test(s.medium) ? 'paint' : 'scratch') : 'carve';
  const text: string | Run[] = s.carve ?? blocksToRuns(s.blocks, s.family === 'plaque' || s.family === 'slab');
  const cut = cutText(a, h, s, text, L.box, {
    mode, paint: pigment, font: mode === 'scratch' || mode === 'paint' ? HAND : SERIF, rules: s.family === 'stele' || s.family === 'rock' || s.family === 'plaque',
    lead: mode === 'scratch' || mode === 'paint' ? 1.2 : 1.55, tracking: s.carve && /·/.test(s.carve) ? 0.06 : 0.03, caps: !s.carve && (s.family === 'plaque' || s.family === 'slab'), weight: metal ? 500 : 600,
    maxSize: mode === 'scratch' || mode === 'paint' ? L.box[3] / 3 : L.box[3] / 5,
  }, { ink: mode === 'paint' ? '#9a2b1b' : mode === 'scratch' ? (s.stuff === 'plaster' ? '#6f6556' : '#5d5446') : '#000', cut: st.cut, cutAlpha: metal ? 0.45 : 0.3 });
  // damage
  if (d.lostEnd) {
    const [bx, by, bw, bh] = L.box;
    const y = Math.min(by + bh, by + cut.lines.length * cut.lineH) - cut.lineH * 0.6;
    spall(a, h, `${s.id}:lost`, bx + bw * 0.55, y, bw * 0.45, cut.lineH * 1.3, st.light);
  }
  for (const [l, r, y] of cut.lacs) spall(a, h, `${s.id}:lac:${Math.round(l)}:${Math.round(y)}`, (l + r) / 2, y - cut.size * 0.35, Math.max(cut.size, (r - l) * 0.6), cut.size * 0.75, st.light);
  if (d.chips) for (let i = 0; i < d.chips + 2; i++) {
    const R = rng(`chip:${s.id}:${i}`);
    const edge = i % 4;
    const x = edge === 0 ? W * 0.03 : edge === 1 ? W * 0.97 : W * (0.1 + R() * 0.8), y = edge === 2 ? H * 0.04 : edge === 3 ? H * 0.96 : H * (0.15 + R() * 0.75);
    spall(a, h, `${s.id}:chip:${i}`, x, y, W * (0.02 + R() * 0.03), W * (0.015 + R() * 0.025), st.light);
  }
  if (L.crackLine) crack(a, h, L.crackLine, Math.max(2, W * 0.006));
  if (d.fire) soot(a, s.id, W, H, metal ? 0.5 : 0.8);
  if (d.weather > 0.4 && !metal) { speckle(h, `${s.id}:pits`, Math.round(W * H * 0.00045 * d.weather), Math.max(1, W / 500), '#3a3a3a', 0.6); speckle(a, `${s.id}:lich`, Math.round(W * H * 0.00003 * d.weather), Math.max(2, W / 300), s.stuff === 'basalt' || s.stuff === 'diorite' ? '#7d8270' : '#a3a08a', 0.18); }
  if (d.corroded) speckle(a, `${s.id}:cor`, Math.round(W * H * 0.0004), Math.max(2, W / 200), '#3d7a5e', 0.5);
  void imgs;
  const normal = finish(hgt, Math.max(4, cut.size * (metal ? 0.16 : 0.2)), map, metal ? 0.35 : 0.28);
  return { map, normal, size: cut.size };
}

function blocksToRuns(bs: Block[], caps: boolean): Run[] {
  const out: Run[] = [];
  for (const b of bs) {
    for (const r of b.runs) out.push(caps && !r.lac ? { ...r, s: r.s.toUpperCase() } : r);
    out.push({ s: ' ' });
  }
  return out;
}

/** A plain surface of a material (sides and backs), small and tileable. */
export function plainFace(stuff: Stuff | 'bronze' | 'silver' | 'gold', label: string, W = 256, H = 256, opts: { fire?: boolean; colour?: string } = {}): Tex {
  const map = canvas(W, H), hgt = canvas(W, H);
  const a = ctxOf(map), h = ctxOf(hgt);
  const metal = stuff === 'bronze' || stuff === 'silver' || stuff === 'gold';
  const st = metal ? { base: METAL[stuff], dark: '#000', light: '#fff', grain: 0.12 } : { ...(STONE[stuff] ?? STONE.limestone) };
  if (opts.colour) st.base = opts.colour;
  grain(a, h, label, W, H, st);
  if (stuff === 'bronze') { a.save(); a.globalAlpha = 0.5; a.globalCompositeOperation = 'color'; a.fillStyle = '#4f8f78'; a.fillRect(0, 0, W, H); a.restore(); }
  if (opts.fire) soot(a, label, W, H, 0.7);
  return { map, normal: finish(hgt, metal ? 3 : 6) };
}

/** Wood: long streaks of grain. */
export function woodFace(label: string, colour = '#7a5434', W = 256, H = 256): Tex {
  const map = canvas(W, H), hgt = canvas(W, H);
  const a = ctxOf(map), h = ctxOf(hgt);
  a.fillStyle = colour; a.fillRect(0, 0, W, H);
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  const R = rng(`wood:${label}`);
  for (let i = 0; i < 70; i++) {
    const y = R() * H, th = 0.6 + R() * 2.4, dark = R() < 0.55;
    a.strokeStyle = dark ? `rgba(40,22,10,${0.08 + R() * 0.16})` : `rgba(255,220,170,${0.04 + R() * 0.08})`;
    a.lineWidth = th;
    a.beginPath();
    const ph = R() * 6.28, amp = 1 + R() * 4;
    for (let x = 0; x <= W; x += 8) { const yy = y + Math.sin(x / W * 6.28 * (1 + R() * 0.2) + ph) * amp; if (x === 0) a.moveTo(x, yy); else a.lineTo(x, yy); }
    a.stroke();
    if (dark) { h.strokeStyle = 'rgba(0,0,0,0.25)'; h.lineWidth = th; h.stroke(); }
  }
  return { map, normal: finish(hgt, 2) };
}

export const mixColour = mixHex;

// ---------------------------------------------------------------- clay: wedges
export interface ClayFaces { obverse: Tex; reverse: Tex; edge: Tex }

/** A clay tablet's two faces: one wedge-sign per syllable of the record's text, written along ruled lines from the
 *  obverse onto the reverse; lacunae as spalls; a cylinder seal rolled across the foot of the reverse. */
export function clayFaces(s: ObjectSpec, W: number, H: number, imgs: Imgs, opts: { blocks?: Block[]; seal?: 'reverse' | 'bands' | 'none'; label?: string } = {}): ClayFaces {
  const blocks = opts.blocks ?? s.blocks;
  const colour = clayColour(s);
  const st = { ...STONE.clay, base: colour, dark: mixHex(colour, '#000000', 0.3), light: mixHex(colour, '#ffffff', 0.25) };
  // the text as syllable signs, with paragraph breaks and lacunae
  type Tok = { syl: string; br?: boolean; lac?: boolean; word?: boolean };
  const toks: Tok[] = [];
  for (const b of blocks) {
    for (const r of b.runs) {
      if (r.lac) { toks.push({ syl: '', lac: true }); continue; }
      for (const w of r.s.split(/\s+/)) {
        const sy = syllables(w);
        sy.forEach((x, i) => toks.push({ syl: x, word: i === sy.length - 1 }));
      }
    }
    toks.push({ syl: '', br: true });
  }
  const seal = opts.seal ?? (imgs.sigil ? 'reverse' : 'none');
  const signs = toks.filter((t) => !t.br).length;
  // sign size: fill the obverse and reverse with the text
  const margin = W * 0.08;
  const area = (W - margin * 2) * (H - margin * 2) * (seal === 'reverse' ? 1.75 : 2);
  const cell = Math.max(W / 34, Math.min(W / 7, Math.sqrt(area / Math.max(1, signs * 1.25))));
  const faces = [canvas(W, H), canvas(W, H)];
  const hs = [canvas(W, H), canvas(W, H)];
  const masks = [canvas(W, H), canvas(W, H)];
  faces.forEach((f, i) => grain(ctxOf(f), ctxOf(hs[i]), `${s.id}:clay${i}`, W, H, st));
  let face = 0, x = margin, y = margin;
  const rowH = cell * 1.18;
  const bottom = (f: number) => H - margin - (f === 1 && seal === 'reverse' ? H * 0.24 : 0);
  const lacs: [number, number, number][] = [];
  const nextRow = () => {
    // a ruled line under the row
    const m = ctxOf(masks[face]);
    m.save(); m.globalAlpha = 0.5; m.fillStyle = '#fff'; m.fillRect(margin * 0.6, y + rowH - cell * 0.06, W - margin * 1.2, Math.max(1, cell * 0.05)); m.restore();
    x = margin; y += rowH;
    if (y + rowH > bottom(face)) { face++; y = margin; }
  };
  for (const t of toks) {
    if (face > 1) break;
    if (t.br) { if (x > margin) nextRow(); continue; }
    if (t.lac) { const w = cell * 2.4; if (x + w > W - margin) nextRow(); if (face > 1) break; lacs.push([face, x + w / 2, y + rowH / 2]); x += w; continue; }
    if (x + cell > W - margin) { nextRow(); if (face > 1) break; }
    const m = ctxOf(masks[face]);
    m.fillStyle = '#fff';
    for (const w of signOf(s.script, t.syl)) pressWedge(m, x, y + cell * 0.08, cell * 0.92, w);
    x += cell * (t.word ? 1.25 : 1.02);
  }
  const out: Tex[] = [];
  for (let i = 0; i < 2; i++) {
    const a = ctxOf(faces[i]), h = ctxOf(hs[i]);
    drawBlurred(h, masks[i], cell * 0.12, 'rgba(0,0,0,0.35)');
    drawBlurred(h, masks[i], cell * 0.025, 'rgba(0,0,0,0.55)');
    a.save(); a.globalAlpha = 0.42; drawBlurred(a, masks[i], cell * 0.02, st.dark); a.restore();
    for (const [f, lx, ly] of lacs) if (f === i) spall(a, h, `${s.id}:lac:${Math.round(lx)}:${Math.round(ly)}`, lx, ly, cell * 1.4, cell * 0.8, st.light);
    if (i === 1 && seal === 'reverse' && imgs.sigil) rollSeal(h, imgs.sigil, margin * 0.5, H - margin - H * 0.2, W - margin, H * 0.2);
    if (i === 0 && seal === 'bands' && imgs.sigil) { rollSeal(h, imgs.sigil, W * 0.04, H * 0.42, W * 0.92, H * 0.2); rollSeal(h, imgs.sigil, W * 0.04, H * 0.7, W * 0.92, H * 0.2); }
    if (s.dmg.minor || s.dmg.weather > 0.4) for (let k = 0; k < 3; k++) { const R = rng(`cchip:${s.id}:${i}:${k}`); spall(a, h, `${s.id}:cchip:${i}:${k}`, R() < 0.5 ? W * 0.04 : W * 0.96, H * (0.1 + R() * 0.8), W * 0.05, W * 0.04, st.light); }
    if (s.dmg.fire) soot(a, `${s.id}:${i}`, W, H, 0.9);
    if (s.dmg.water) fbm(a, `${s.id}:wet${i}`, W / 3, 2, 0.18, 'multiply');
    out.push({ map: faces[i], normal: finish(hs[i], Math.max(4, cell * 0.1), faces[i], 0.15) });
  }
  return { obverse: out[0], reverse: out[1], edge: plainFace('clay', `${s.id}:edge`, 128, 128, { fire: s.dmg.fire, colour }) };
}

/** A cylinder seal rolled across clay: the seal's image repeated along a band, in relief. */
function rollSeal(h: C2, img: HTMLImageElement, x: number, y: number, w: number, bh: number) {
  // the band the cylinder pressed flat, then the seal's design standing up in it
  h.save(); h.fillStyle = 'rgba(0,0,0,0.22)'; h.fillRect(x, y, w, bh); h.restore();
  const iw = bh * 0.83;
  for (let px = x; px < x + w - iw * 0.3; px += iw * 1.02) imageRelief(h, img, px, y, Math.min(iw, x + w - px), bh, 1, bh * 0.012);
  h.save(); h.fillStyle = 'rgba(0,0,0,0.4)'; h.fillRect(x, y - bh * 0.03, w, Math.max(1, bh * 0.03)); h.fillRect(x, y + bh, w, Math.max(1, bh * 0.03)); h.restore();
}

/** An envelope: the first line of the letter (its address) and the sender's seal rolled across it, twice. */
export function envelopeFace(s: ObjectSpec, W: number, H: number, imgs: Imgs): Tex {
  return clayFaces(s, W, H, imgs, { blocks: s.blocks.slice(0, 1), seal: 'bands' }).obverse;
}

// ---------------------------------------------------------------- coins
/** One face of a coin: the struck design in relief within a beaded border; the field toned, the high points bright. */
export function coinFace(s: ObjectSpec, side: 'obverse' | 'reverse', N: number, imgs: Imgs): Tex {
  const c = s.coin!;
  const map = canvas(N, N), hgt = canvas(N, N);
  const a = ctxOf(map), h = ctxOf(hgt);
  const metal = c.metal === 'gold' ? METAL.gold : mixHex(METAL.silver, METAL.copper, Math.max(0, Math.min(0.85, (92 - c.fine) / 60)));
  a.fillStyle = metal; a.fillRect(0, 0, N, N);
  fbm(a, `${s.id}:${side}:m`, N / 5, 4, 0.1, 'overlay');
  h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);
  fbm(h, `${s.id}:${side}:h`, N / 90, 2, 0.03, 'overlay');
  const R = rng(`coin:${s.id}:${side}`);
  // an off-centre strike pushes the design (and the legend) off the flan
  const off = s.dmg.offFlan ? N * 0.07 : N * 0.012;
  const ang = R() * Math.PI * 2;
  const cx = N / 2 + Math.cos(ang) * off, cy = N / 2 + Math.sin(ang) * off;
  const r = N * 0.47;
  const relief = canvas(N, N), rc = ctxOf(relief);
  const lines = canvas(N, N), lc = ctxOf(lines);
  const letters = canvas(N, N), tc = ctxOf(letters);
  rc.fillStyle = '#fff'; lc.strokeStyle = '#fff'; lc.fillStyle = '#fff'; tc.fillStyle = '#fff';
  // beaded border
  for (let i = 0; i < 72; i++) { const t = (i / 72) * Math.PI * 2; rc.beginPath(); rc.arc(cx + Math.cos(t) * r * 0.93, cy + Math.sin(t) * r * 0.93, N * 0.0085, 0, Math.PI * 2); rc.fill(); }
  const design = (draw: (k: C2, mode: 'fill' | 'line') => void, scale: number, oy = 0, flip = false) => {
    for (const [k, mode] of [[rc, 'fill'], [lc, 'line']] as const) {
      k.save();
      k.translate(cx, cy + oy);
      k.scale(flip ? -scale : scale, scale);
      k.lineWidth = 0.035;
      k.lineCap = 'round';
      draw(k, mode);
      k.restore();
    }
  };
  if (side === 'obverse') {
    if (c.head) design((k, m) => drawHead(k, c.head!.who, c.head!.attr, m), r * 0.58, -r * 0.02, c.head.facing === 'left');
    else {
      const img = c.emblem ? imgs.arms.get(c.emblem) : undefined;
      if (img) imageRelief(rc, img, cx - r * 0.42, cy - r * 0.55, r * 0.84, r * 1.0, 1, 0);
      else design((k, m) => drawReverse(k, 'a temple façade', m), r * 0.5);
    }
    ringText(tc, c.legend, cx, cy, r * 0.79, -Math.PI / 2, N * 0.075, SERIF);
  } else {
    design((k, m) => drawReverse(k, c.reverse, m), r * 0.55, -r * 0.08);
    if (c.mint) {
      tc.font = `700 ${N * 0.075}px ${SERIF}`;
      tc.textAlign = 'center';
      tc.fillText(c.mint.normalize('NFD').replace(/[^\p{L}]/gu, '').slice(0, 3).toUpperCase(), cx, cy + r * 0.76);
      tc.fillRect(cx - r * 0.5, cy + r * 0.56, r, N * 0.008);
    }
  }
  // relief: a soft dome under the crisp edge; details cut into it
  const wear = c.metal === 'gold' ? s.dmg.weather * 0.6 : s.dmg.weather;
  drawBlurred(h, relief, N * (0.014 + wear * 0.01), 'rgba(255,255,255,0.5)');
  drawBlurred(h, relief, N * (0.004 + wear * 0.005), 'rgba(255,255,255,0.32)');
  drawBlurred(h, lines, N * (0.0015 + wear * 0.004), `rgba(0,0,0,${0.5 - wear * 0.3})`);
  drawBlurred(h, letters, N * (0.004 + wear * 0.006), 'rgba(255,255,255,0.35)');
  drawBlurred(h, letters, N * (0.0012 + wear * 0.004), `rgba(255,255,255,${0.4 - wear * 0.2})`);
  // the flan's rim, raised
  h.save(); h.strokeStyle = 'rgba(255,255,255,0.5)'; h.lineWidth = N * 0.03; h.beginPath(); h.arc(N / 2, N / 2, N * 0.485, 0, Math.PI * 2); h.stroke(); h.restore();
  // toning: dark in the fields, bright on worn high points
  a.save(); a.globalCompositeOperation = 'multiply'; a.globalAlpha = c.metal === 'gold' ? 0.2 : 0.55;
  const g = a.createRadialGradient(N / 2, N / 2, N * 0.2, N / 2, N / 2, N * 0.5); g.addColorStop(0, '#9a9590'); g.addColorStop(1, '#6a6560');
  a.fillStyle = g; a.fillRect(0, 0, N, N); a.restore();
  a.save(); a.globalAlpha = 0.35 + wear * 0.3; drawBlurred(a, relief, N * 0.01, mixHex(metal, '#ffffff', 0.35)); drawBlurred(a, letters, N * 0.003, mixHex(metal, '#ffffff', 0.3)); a.restore();
  if (s.dmg.corroded) { speckle(a, `${s.id}:${side}:cor`, Math.round(N * N * 0.0016), N / 90, '#3f6f58', 0.55); speckle(a, `${s.id}:${side}:blk`, Math.round(N * N * 0.0012), N / 120, '#2b2622', 0.5); speckle(h, `${s.id}:${side}:pit`, Math.round(N * N * 0.002), N / 160, '#404040', 0.7); }
  if (wear > 0.4) speckle(h, `${s.id}:${side}:scr`, Math.round(N * N * 0.00012), N / 500, '#707070', 0.35);
  return { map, normal: finish(hgt, Math.max(4, N / 90), map, 0.35) };
}

// ---------------------------------------------------------------- paper, papyrus, parchment
export interface PaperStyle { base: string; ink: string; rubric: string; font: string; weight: number; fibres: 'papyrus' | 'parchment' | 'laid' | 'wove' | 'news' }

export function paperStyle(s: ObjectSpec): PaperStyle {
  if (s.stuff === 'papyrus') return { base: '#d8c18c', ink: '#211b15', rubric: '#9a3220', font: SERIF, weight: 500, fibres: 'papyrus' };
  if (s.stuff === 'parchment') return { base: s.era <= 2 ? '#e2cfa3' : '#e9dcbd', ink: '#3b2a1b', rubric: '#a3341f', font: SERIF, weight: 500, fibres: 'parchment' };
  if (s.stuff === 'newsprint') return { base: s.era >= 6 ? '#ebe4d2' : '#e4d9bd', ink: '#1a1814', rubric: '#1a1814', font: SERIF, weight: 500, fibres: 'news' };
  if (/typescript|telegraph/.test(s.medium)) return { base: s.era >= 6 ? '#f1ede2' : '#ece4d0', ink: '#24242a', rubric: '#8e2f1f', font: MONO, weight: 500, fibres: 'wove' };
  if (s.era >= 4) return { base: s.era >= 5 ? '#efe8d6' : '#ebe1c8', ink: '#16130f', rubric: '#8e2f1f', font: SERIF, weight: 500, fibres: s.era >= 5 ? 'wove' : 'laid' };
  return { base: '#e8dcc0', ink: '#2c2218', rubric: '#9a3220', font: SERIF, weight: 500, fibres: 'laid' };
}

/** A sheet of writing material with its fibre, foxing and stains; returns albedo + height canvases to write on. */
export function sheet(s: ObjectSpec, label: string, W: number, H: number, ps: PaperStyle) {
  const map = canvas(W, H), hgt = canvas(W, H);
  const a = ctxOf(map), h = ctxOf(hgt);
  a.fillStyle = ps.base; a.fillRect(0, 0, W, H);
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  const big = Math.max(W, H);
  fbm(a, `${label}:p`, big / 4, 4, ps.fibres === 'parchment' ? 0.1 : 0.07, 'overlay');
  if (ps.fibres === 'papyrus') {
    // horizontal fibres on the recto, the vertical layer showing faintly through
    const R = rng(`fib:${label}`);
    for (let y = 0; y < H; y += Math.max(1.5, H / 260)) {
      a.fillStyle = `rgba(${R() < 0.5 ? '120,90,50' : '250,235,200'},${0.05 + R() * 0.09})`;
      a.fillRect(0, y, W, Math.max(1, H / 300 * (0.5 + R())));
      h.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.08 + R() * 0.1})`;
      h.fillRect(0, y, W, Math.max(1, H / 300));
    }
    for (let x = 0; x < W; x += Math.max(4, W / 70)) { a.fillStyle = `rgba(110,80,40,${0.03 + R() * 0.04})`; a.fillRect(x, 0, Math.max(1, W / 400), H); }
    // the joins between glued sheets (kollemata)
    for (let x = W * (0.2 + R() * 0.1); x < W; x += W * (0.3 + R() * 0.1)) { a.fillStyle = 'rgba(120,85,45,0.12)'; a.fillRect(x, 0, W * 0.012, H); }
  } else if (ps.fibres === 'parchment') {
    speckle(a, `${label}:hair`, Math.round(W * H * 0.0008), Math.max(0.6, big / 1400), '#8a6e4a', 0.35);
    fbm(a, `${label}:cockle`, big / 2.5, 2, 0.07, 'multiply');
    fbm(h, `${label}:cockle`, big / 6, 2, 0.06, 'overlay');
  } else if (ps.fibres === 'laid') {
    for (let x = W * 0.04; x < W; x += big * 0.07) { a.fillStyle = 'rgba(140,110,70,0.06)'; a.fillRect(x, 0, Math.max(1, W / 500), H); }
    for (let y = 0; y < H; y += Math.max(2, big / 220)) { a.fillStyle = 'rgba(140,110,70,0.025)'; a.fillRect(0, y, W, 1); }
  } else if (ps.fibres === 'news') {
    speckle(a, `${label}:pulp`, Math.round(W * H * 0.0012), Math.max(0.5, big / 2000), '#8c826c', 0.25);
  }
  // age: browned edges
  const g = a.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
  g.addColorStop(0, 'rgba(120,85,40,0)'); g.addColorStop(1, `rgba(120,85,40,${s.era >= 5 ? 0.18 : 0.32})`);
  a.fillStyle = g; a.fillRect(0, 0, W, H);
  if (s.dmg.weather > 0.4 || s.era >= 4) speckle(a, `${label}:fox`, Math.round(W * H * 0.00004 * (1 + s.dmg.weather * 3)), Math.max(1.5, big / 300), '#a07a48', 0.25);
  return { map, hgt, a, h };
}

export interface WriteOpts { x: number; y: number; w: number; h: number; size: number; lead?: number; font?: string; weight?: number; headCaps?: boolean; initial?: boolean; justify?: boolean; columns?: number; gap?: number; centerHeads?: boolean }

/** Write blocks of text into a box; returns where it stopped (y) and the lacunae drawn. Text that does not fit stops
 *  at the box's foot (the rest is on pages the object does not show). */
export function writeBlocks(a: C2, blocks: Block[], ps: PaperStyle, o: WriteOpts): { y: number; lacs: [number, number, number][]; used: number } {
  const lead = o.lead ?? 1.35;
  const font = o.font ?? ps.font;
  const cols = o.columns ?? 1;
  const gap = o.gap ?? o.size * 1.5;
  const cw = (o.w - gap * (cols - 1)) / cols;
  let col = 0, y = o.y + o.size;
  const lacs: [number, number, number][] = [];
  let used = 0;
  const bottom = o.y + o.h;
  a.textBaseline = 'alphabetic';
  outer: for (const [bi, b] of blocks.entries()) {
    const head = b.k === 'h';
    const sz = head ? o.size * 1.25 : o.size;
    const rr = head && o.headCaps ? b.runs.map((r) => ({ ...r, s: r.s.toUpperCase(), b: true })) : head ? b.runs.map((r) => ({ ...r, b: true })) : b.runs;
    const indent = b.k === 'li' ? sz * 1.2 : 0;
    let lines = wrap(a, rr, cw - indent, font, sz, o.weight ?? ps.weight);
    let drop = 0;
    if (o.initial && bi === 0 && b.k === 'p' && rr[0]?.s) {
      // a decorated initial over two lines
      drop = sz * 2.2;
      lines = wrap(a, [{ ...rr[0], s: rr[0].s.slice(1) }, ...rr.slice(1)], cw - drop, font, sz, o.weight ?? ps.weight);
      a.save(); a.font = `700 ${sz * 2.6}px ${SERIF}`; a.fillStyle = ps.rubric;
      a.fillText(rr[0].s[0], o.x + col * (cw + gap), y + sz * 1.25); a.restore();
    }
    for (const [li, ln] of lines.entries()) {
      if (y > bottom) { col++; if (col >= cols) break outer; y = o.y + o.size; }
      const x0 = o.x + col * (cw + gap) + (li < 2 ? drop : 0) + (li > 0 ? indent : 0);
      const cx = head && o.centerHeads ? o.x + col * (cw + gap) + (cw - ln.w) / 2 : x0;
      const lac = drawLine(a, ln, cx, y, { color: head ? ps.rubric === ps.ink ? ps.ink : ps.rubric : ps.ink, struck: ps.ink, justify: o.justify && li < lines.length - 1 && b.k === 'p' ? cw - (li < 2 ? drop : 0) : 0 });
      for (const [l, r] of lac) lacs.push([l, r, y]);
      y += sz * lead;
      used++;
    }
    y += sz * (b.k === 'v' || b.k === 'li' ? 0.05 : 0.45);
  }
  return { y, lacs, used };
}

/** Damage to a sheet from its condition: fire eats the edges (transparent), water leaves tide-lines, lacunae and
 *  "fragmentary" leave holes. Returns true when the sheet now has transparent parts. */
export function sheetDamage(s: ObjectSpec, label: string, a: C2, lacs: [number, number, number][], size: number): boolean {
  const W = a.canvas.width, H = a.canvas.height;
  const d = s.dmg;
  let alpha = false;
  if (d.water) {
    const R = rng(`water:${label}`);
    for (let i = 0; i < 2; i++) {
      const x = R() < 0.5 ? W * (0.1 + R() * 0.3) : W * (0.6 + R() * 0.3), y = H * (0.5 + R() * 0.45);
      blobPath(a, `${label}:w${i}`, x, y, W * (0.18 + R() * 0.15), H * (0.12 + R() * 0.12), 0.5);
      a.fillStyle = 'rgba(150,110,60,0.13)'; a.fill();
      a.strokeStyle = 'rgba(120,80,40,0.35)'; a.lineWidth = Math.max(1.5, W / 300); a.stroke();
    }
  }
  if (d.fragmentary || (s.stuff === 'papyrus' && lacs.length)) {
    for (const [l, r, y] of lacs) {
      blobPath(a, `${label}:hole:${Math.round(l)}:${Math.round(y)}`, (l + r) / 2, y - size * 0.35, Math.max(size, (r - l) * 0.55), size * 0.8, 0.5);
      a.save(); a.globalCompositeOperation = 'destination-out'; a.fill(); a.restore();
      alpha = true;
    }
  } else if (lacs.length) {
    for (const [l, r, y] of lacs) {
      blobPath(a, `${label}:rub:${Math.round(l)}:${Math.round(y)}`, (l + r) / 2, y - size * 0.35, Math.max(size, (r - l) * 0.55), size * 0.7, 0.5);
      a.fillStyle = 'rgba(160,120,70,0.35)'; a.fill();
    }
  }
  if (d.fire) {
    // burn inward from the edges along a ragged line; char the new edge
    const pts: [number, number][] = [];
    const R = rng(`burn:${label}`);
    const inset = Math.min(W, H) * 0.06;
    const edge = (x0: number, y0: number, x1: number, y1: number) => { for (const p of jagged(`${label}:${x0}:${y0}`, x0, y0, x1, y1, 14, inset * 0.6)) pts.push(p); };
    const k = () => inset * (0.4 + R());
    edge(k(), k(), W - k(), k()); edge(W - k(), k(), W - k(), H - k()); edge(W - k(), H - k(), k(), H - k()); edge(k(), H - k(), k(), k());
    const path = () => { a.beginPath(); pts.forEach(([x, y], i) => (i ? a.lineTo(x, y) : a.moveTo(x, y))); a.closePath(); };
    a.save();
    path();
    a.lineWidth = inset * 1.1; a.strokeStyle = 'rgba(60,35,15,0.55)'; a.lineJoin = 'round'; a.stroke();
    a.lineWidth = inset * 0.45; a.strokeStyle = 'rgba(25,15,8,0.9)'; a.stroke();
    a.globalCompositeOperation = 'destination-in';
    path(); a.fill();
    a.restore();
    alpha = true;
  }
  if (d.minor) {
    const R = rng(`nick:${label}`);
    a.save(); a.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 3; i++) { blobPath(a, `${label}:nick${i}`, R() < 0.5 ? 0 : W, H * R(), W * 0.03, H * 0.025, 0.6); a.fill(); }
    a.restore();
    alpha = true;
  }
  return alpha;
}

/** A sheet's finished textures (normal map from its fibre). */
export function sheetTex(map: Cv, hgt: Cv, alpha: boolean): Tex {
  return { map, normal: finish(hgt, 2.5), alpha };
}

export { SANS, MONO, HAND, SERIF, blocksText };
