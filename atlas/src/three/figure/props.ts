// What a piece holds, by the roles in its record: regalia, arms, the tools of a trade. Every prop is built at a hand
// (H, in the figure's own space) and takes its era's materials: bronze before the Age of Iron, steel after.
import { CanvasTexture, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, Shape, SRGBColorSpace, Vector3 } from 'three';
import type { FigureSpec } from './spec.ts';
import { about, ball, box, cap, cone, cyl, type Kit, lathe, mul, ring, rod, RX, RY, RZ, S3, shade, slab, starShape, T, tube, V } from './kit.ts';
import { sealDecal } from './base.ts';

export const C = {
  gold: '#d6a634', bronze: '#b07a3a', iron: '#878c92', steel: '#a9b0b7', brass: '#c49a45', silver: '#c9ccd0',
  wood: '#7a5232', darkwood: '#4d321f', leather: '#6b472a', parch: '#e8d9b0', clay: '#b07e56', linen: '#ece4d0',
  black: '#23201d', ivory: '#efe6d0', flame: '#ee8c2c', flame2: '#f7d36a', wax: '#9e2a22',
};
export const bladeOf = (era: number) => (era === 0 ? C.bronze : C.steel);

const hasDom = typeof document !== 'undefined';

// ---------------------------------------------------------------- regalia
/** A sceptre held upright: a gilt rod, its head by the age. */
export function sceptre(kit: Kit, H: Vector3, era: number, s: number) {
  const bot = V(H.x, H.y - 0.13 * s, H.z + 0.004), top = V(H.x, H.y + 0.27 * s, H.z + 0.004);
  kit.add(rod(bot, top, 0.0075 * s, 8), C.gold, 'metal');
  kit.add(ball(bot, 0.012 * s), C.gold, 'metal');
  const tip = top.clone();
  if (era <= 1) {
    // a lotus-bud knob
    kit.add(lathe([[0.004, 0], [0.02, 0.02], [0.016, 0.042], [0.001, 0.055]].map(([r, y]) => [r * s, y * s] as [number, number]), 12), C.gold, 'metal', T(tip.x, tip.y, tip.z));
  } else if (era === 3) {
    // a fleur-de-lis of three petals
    kit.add(ball(V(tip.x, tip.y + 0.008 * s, tip.z), 0.014 * s), C.gold, 'metal');
    kit.add(cone(0.009 * s, 0.05 * s, 8), C.gold, 'metal', T(tip.x, tip.y + 0.04 * s, tip.z));
    for (const d of [-1, 1]) kit.add(cone(0.007 * s, 0.035 * s, 8), C.gold, 'metal', mul(T(tip.x + d * 0.016 * s, tip.y + 0.026 * s, tip.z), RZ(-d * 0.75)));
  } else {
    // an orb and cross
    kit.add(ball(V(tip.x, tip.y + 0.018 * s, tip.z), 0.019 * s), C.gold, 'metal');
    kit.add(rod(V(tip.x, tip.y + 0.035 * s, tip.z), V(tip.x, tip.y + 0.07 * s, tip.z), 0.004 * s, 6), C.gold, 'metal');
    kit.add(rod(V(tip.x - 0.013 * s, tip.y + 0.056 * s, tip.z), V(tip.x + 0.013 * s, tip.y + 0.056 * s, tip.z), 0.004 * s, 6), C.gold, 'metal');
  }
}

/** The seal of state, held before the body in both hands (a regent rules in a child's name). */
export function heldSeal(kit: Kit, f: FigureSpec, H: Vector3, s: number) {
  const r = 0.07 * s;
  const fem = f.sex === 'f';
  // the matrix (a disc for a man's seal, a lozenge for a woman's), tilted up toward the viewer
  const tilt = -0.32;
  const c = V(0, H.y + 0.035 * s, H.z + 0.012 * s);
  kit.with(mul(T(c.x, c.y, c.z), RX(tilt)), () => {
    if (fem) kit.add(slab(diamond(r * 1.04), 0.014 * s, 0.002), f.tinctures.metal, 'metal');
    else kit.add(cyl(r * 1.04, r * 1.04, 0.014 * s, 32).rotateX(Math.PI / 2), f.tinctures.metal, 'metal');
    // a cord through the seal, hanging from the hands
    kit.add(ring(r * 0.55, 0.0028 * s, 16, 4, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI), '#7d1f1a', 'paint', T(0, -r * 0.9, -0.004));
    const d = sealDecal(f, r * 2.02);
    if (d) { d.position.z = 0.007 * s + 0.0028; kit.addObject(d); }
  });
}
function diamond(r: number): Shape {
  const sh = new Shape();
  sh.moveTo(0, r); sh.lineTo(r, 0); sh.lineTo(0, -r); sh.lineTo(-r, 0); sh.closePath();
  return sh;
}

/** A regent's keys at the belt (the charge of their seal). */
export function keys(kit: Kit, at: Vector3, s: number) {
  kit.add(ring(0.016 * s, 0.0025 * s, 14, 4).rotateX(Math.PI / 2), C.brass, 'metal', T(at.x, at.y, at.z));
  for (const [dx, a] of [[-0.006, 0.25], [0.006, -0.2]] as [number, number][]) {
    kit.with(mul(T(at.x + dx * s, at.y - 0.016 * s, at.z + 0.004), RZ(a)), () => {
      kit.add(rod(V(0, 0, 0), V(0, -0.045 * s, 0), 0.0025 * s, 5), C.brass, 'metal');
      kit.add(box(V(0.005 * s, -0.04 * s, 0), 0.008 * s, 0.01 * s, 0.003 * s), C.brass, 'metal');
    });
  }
}

// ---------------------------------------------------------------- arms
export function spear(kit: Kit, H: Vector3, era: number, s: number) {
  const bot = V(H.x, 0.015, H.z), top = V(H.x, H.y + 0.62 * s, H.z);
  kit.add(rod(bot, top, 0.0075 * s, 7), C.wood);
  // the head: a leaf blade
  kit.add(lathe([[0.007, 0], [0.016, 0.03], [0.012, 0.06], [0.001, 0.095]].map(([r, y]) => [r * s, y * s] as [number, number]), 6), bladeOf(era), 'metal', mul(T(top.x, top.y, top.z), S3(1, 1, 0.35)));
  kit.add(cone(0.008 * s, 0.03 * s, 6), bladeOf(era), 'metal', T(bot.x, bot.y + 0.014, bot.z));
}

/** A sword held upright before the shoulder; a sabre's blade is curved. */
export function sword(kit: Kit, H: Vector3, era: number, s: number, opts: { down?: boolean; sabre?: boolean } = {}) {
  const dir = opts.down ? -1 : 1;
  kit.with(mul(T(H.x, H.y, H.z + 0.01 * s), RX(opts.down ? 0 : 0.18)), () => {
    const L = (era <= 1 ? 0.26 : era === 4 ? 0.36 : 0.32) * s;
    // grip and pommel
    kit.add(rod(V(0, -0.03 * s * dir, 0), V(0, 0.03 * s * dir, 0), 0.0085 * s, 6), C.leather);
    kit.add(ball(V(0, -0.045 * s * dir, 0), 0.012 * s), era === 0 ? C.bronze : C.brass, 'metal');
    // guard
    if (era >= 2) kit.add(box(V(0, 0.036 * s * dir, 0), 0.075 * s, 0.009 * s, 0.012 * s, 0.003 * s), era >= 4 ? C.brass : C.iron, 'metal');
    if (era >= 4) kit.add(ring(0.02 * s, 0.0025 * s, 12, 4, Math.PI).rotateY(Math.PI / 2), C.brass, 'metal', T(0, 0.02 * s * dir, 0.012 * s));
    // blade: a flattened taper
    const w = (era === 4 ? 0.007 : era <= 1 ? 0.02 : 0.016) * s;
    const g = lathe([[w, 0], [w * 0.95, L * 0.8], [0.0005, L]], 4);
    g.scale(1, 1, 0.25);
    if (opts.sabre) {
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, p.getZ(i) - 0.35 * (y * y) / L); }
      g.computeVertexNormals();
    }
    kit.add(g, bladeOf(era), 'metal', mul(T(0, 0.04 * s * dir, 0), dir < 0 ? RX(Math.PI) : RX(0)));
  });
}

/** A scabbard hanging at the left hip. */
export function scabbard(kit: Kit, at: Vector3, era: number, s: number) {
  kit.with(mul(T(at.x, at.y, at.z), RZ(0.12), RX(0.32)), () => {
    kit.add(tube(V(0, 0, 0), V(0, -0.3 * s, 0), 0.012 * s, 0.009 * s, 8), era >= 5 ? C.black : C.leather);
    kit.add(rod(V(0, 0.0, 0), V(0, 0.06 * s, 0), 0.008 * s, 6), C.leather);
    kit.add(ball(V(0, 0.07 * s, 0), 0.011 * s), C.brass, 'metal');
  });
}

/** A rifle grounded at the right side (with a bayonet in the Age of Engines). */
export function rifle(kit: Kit, H: Vector3, era: number, s: number) {
  const x = H.x, z = H.z + 0.006;
  kit.with(T(x, 0.012, z), () => {
    // stock and fore-end
    kit.add(box(V(0, 0.075 * s, -0.006 * s), 0.024 * s, 0.15 * s, 0.045 * s, 0.006 * s), C.wood);
    kit.add(box(V(0, 0.27 * s, 0.004 * s), 0.02 * s, 0.26 * s, 0.024 * s, 0.005 * s), C.wood);
    // barrel
    kit.add(rod(V(0, 0.15 * s, 0.008 * s), V(0, 0.66 * s, 0.008 * s), 0.0055 * s, 6), C.iron, 'metal');
    kit.add(box(V(0, 0.19 * s, 0.018 * s), 0.014 * s, 0.04 * s, 0.014 * s), C.iron, 'metal');
    if (era === 5) kit.add(lathe([[0.003, 0], [0.004, 0.02], [0.001, 0.17]].map(([r, y]) => [r * s, y * s] as [number, number]), 4), C.steel, 'metal', T(0, 0.65 * s, 0.016 * s));
    // sling
    kit.add(rod(V(0, 0.12 * s, -0.026 * s), V(0, 0.48 * s, -0.012 * s), 0.0028 * s, 4), C.leather);
  });
}

/** A shield on the left arm, its face painted with the bearer's seal. Its shape is the age's (as on the arms). */
export function shield(kit: Kit, f: FigureSpec, H: Vector3, s: number) {
  const era = f.era;
  const c = V(H.x + 0.01 * s, H.y - 0.03 * s, H.z + 0.04 * s);
  kit.with(mul(T(c.x, c.y, c.z), RY(0.32), RX(-0.06)), () => {
    let sh: Shape;
    let w: number;
    if (era === 0) { sh = new Shape().absarc(0, 0, 0.14 * s, 0, Math.PI * 2, false); w = 0.25 * s; }
    else if (era === 1) { sh = ellipse(0.105 * s, 0.155 * s); w = 0.19 * s; }
    else if (era === 2) { sh = kite(0.105 * s, 0.2 * s); w = 0.18 * s; }
    else { sh = heater(0.11 * s, 0.15 * s); w = 0.18 * s; }
    const g = slab(sh, 0.016 * s, 0.004 * s);
    kit.add(g, f.tinctures.colour);
    // a rim and a boss
    kit.add(slab(sh, 0.008 * s, 0), era === 0 ? C.bronze : C.iron, 'metal', mul(T(0, 0, -0.006 * s), S3(1.04, 1.04, 1)));
    const d = sealDecal(f, w);
    if (d) { d.position.set(0, era === 2 ? 0.03 * s : era === 3 ? 0.01 * s : 0, 0.0128 * s + 0.0012); kit.addObject(d); }
    else kit.add(ball(V(0, 0, 0.012 * s), 0.025 * s, 1, 1, 0.5), era === 0 ? C.bronze : C.iron, 'metal');
  });
}
function ellipse(rx: number, ry: number): Shape { const s = new Shape(); s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0); return s; }
function kite(w: number, h: number): Shape {
  const s = new Shape();
  s.moveTo(0, -h * 0.62);
  s.quadraticCurveTo(w * 0.9, -h * 0.05, w, h * 0.25);
  s.quadraticCurveTo(w * 0.8, h * 0.48, 0, h * 0.5);
  s.quadraticCurveTo(-w * 0.8, h * 0.48, -w, h * 0.25);
  s.quadraticCurveTo(-w * 0.9, -h * 0.05, 0, -h * 0.62);
  return s;
}
function heater(w: number, h: number): Shape {
  const s = new Shape();
  s.moveTo(-w, h * 0.55); s.lineTo(w, h * 0.55); s.lineTo(w, h * 0.05);
  s.quadraticCurveTo(w * 0.9, -h * 0.55, 0, -h * 0.82);
  s.quadraticCurveTo(-w * 0.9, -h * 0.55, -w, h * 0.05);
  s.closePath();
  return s;
}

// ---------------------------------------------------------------- the written word
export function tablet(kit: Kit, H: Vector3, s: number) {
  kit.with(mul(T(H.x, H.y + 0.03 * s, H.z + 0.02 * s), RX(-0.55)), () => {
    kit.add(box(V(0, 0, 0), 0.085 * s, 0.11 * s, 0.022 * s, 0.009 * s), C.clay);
    for (let i = 0; i < 6; i++) kit.add(box(V(-0.004 * s + ((i * 7) % 3) * 0.002 * s, 0.038 * s - i * 0.015 * s, 0.0115 * s), 0.06 * s - (i % 3) * 0.008 * s, 0.003 * s, 0.002 * s), shade(C.clay, -0.3));
  });
}
export function stylus(kit: Kit, H: Vector3, s: number, color = C.wood) {
  kit.add(rod(V(H.x - 0.01 * s, H.y - 0.02 * s, H.z), V(H.x + 0.035 * s, H.y + 0.06 * s, H.z + 0.02 * s), 0.0035 * s, 5), color);
}
export function quill(kit: Kit, H: Vector3, s: number) {
  const a = V(H.x - 0.005 * s, H.y - 0.015 * s, H.z + 0.004 * s), b = V(H.x + 0.03 * s, H.y + 0.085 * s, H.z - 0.01 * s);
  kit.add(rod(a, b, 0.0025 * s, 4), C.ivory);
  const mid = a.clone().lerp(b, 0.65);
  kit.with(mul(T(mid.x, mid.y, mid.z), RZ(-0.33)), () => kit.add(ball(V(0, 0, 0), 0.06 * s, 0.18, 0.75, 0.05, 8, 6), '#f4efe2'));
}
/** An open scroll, or (from the Age of Parchment on) an open codex, held at the chest. */
export function writing(kit: Kit, H: Vector3, era: number, s: number) {
  kit.with(mul(T(H.x, H.y + 0.03 * s, H.z + 0.025 * s), RX(-0.6)), () => {
    if (era === 2) {
      // a scroll open between its two rollers
      kit.add(box(V(0, 0, 0), 0.1 * s, 0.085 * s, 0.003 * s), C.parch);
      for (const d of [-1, 1]) kit.add(cyl(0.012 * s, 0.012 * s, 0.1 * s, 10).rotateZ(Math.PI / 2), C.parch, 'paint', T(0, d * 0.045 * s, 0.006 * s));
      for (const d of [-1, 1]) for (const e of [-1, 1]) kit.add(ball(V(e * 0.056 * s, d * 0.045 * s, 0.006 * s), 0.008 * s), C.darkwood);
    } else {
      book(kit, V(0, 0, 0), s, C.leather, true);
    }
  });
}
/** A book (closed, or open flat). */
export function book(kit: Kit, at: Vector3, s: number, cover: string, open = false) {
  if (open) {
    for (const d of [-1, 1]) {
      kit.add(box(V(at.x + d * 0.037 * s, at.y, at.z - 0.002 * s), 0.078 * s, 0.105 * s, 0.004 * s, 0.0015 * s), cover, 'paint', mul(about(V(at.x, at.y, at.z), RY(d * 0.12))));
      kit.add(box(V(at.x + d * 0.035 * s, at.y, at.z + 0.004 * s), 0.07 * s, 0.096 * s, 0.008 * s, 0.002 * s), C.parch, 'paint', about(V(at.x, at.y, at.z), RY(d * 0.12)));
      for (let i = 0; i < 4; i++) kit.add(box(V(at.x + d * 0.035 * s, at.y + 0.03 * s - i * 0.018 * s, at.z + 0.0085 * s), 0.05 * s, 0.0025 * s, 0.001 * s), shade(C.parch, -0.35), 'paint', about(V(at.x, at.y, at.z), RY(d * 0.12)));
    }
  } else {
    kit.add(box(at, 0.078 * s, 0.105 * s, 0.026 * s, 0.004 * s), cover);
    kit.add(box(V(at.x + 0.004 * s, at.y, at.z), 0.074 * s, 0.096 * s, 0.028 * s, 0.002 * s), C.parch);
  }
}
/** A rolled charter tied with a ribbon. */
export function charter(kit: Kit, H: Vector3, s: number, ribbon: string) {
  kit.with(mul(T(H.x, H.y + 0.01 * s, H.z + 0.01 * s), RZ(0.9), RX(0.2)), () => {
    kit.add(cyl(0.014 * s, 0.014 * s, 0.15 * s, 12), C.parch);
    kit.add(cyl(0.0155 * s, 0.0155 * s, 0.014 * s, 12), ribbon);
  });
}

// ---------------------------------------------------------------- trade
export function scales(kit: Kit, H: Vector3, era: number, s: number) {
  const m = era === 0 ? C.bronze : C.brass;
  const top = V(H.x, H.y + 0.055 * s, H.z + 0.01 * s);
  kit.add(rod(V(H.x, H.y, H.z + 0.01 * s), top, 0.0035 * s, 5), m, 'metal');
  const L = 0.075 * s;
  kit.add(rod(V(top.x - L, top.y, top.z), V(top.x + L, top.y, top.z), 0.003 * s, 5), m, 'metal');
  kit.add(ball(top, 0.007 * s), m, 'metal');
  for (const d of [-1, 1]) {
    const px = top.x + d * L, py = top.y - 0.085 * s;
    for (const e of [-1, 1]) kit.add(rod(V(top.x + d * L, top.y, top.z), V(px + e * 0.016 * s, py + 0.006 * s, top.z), 0.0012 * s, 3), m, 'metal');
    kit.add(cap(0.022 * s, Math.PI * 0.55, Math.PI, 14, 4).scale(1, 0.55, 1), m, 'metal', T(px, py + 0.012 * s, top.z));
  }
}
export function ledger(kit: Kit, H: Vector3, s: number) {
  kit.with(mul(T(H.x, H.y + 0.03 * s, H.z + 0.02 * s), RX(-0.35), RZ(0.1)), () => {
    kit.add(box(V(0, 0, 0), 0.085 * s, 0.12 * s, 0.03 * s, 0.004 * s), '#5a2a1e');
    kit.add(box(V(0.004 * s, 0, 0), 0.08 * s, 0.112 * s, 0.032 * s, 0.002 * s), C.parch);
    kit.add(box(V(-0.035 * s, 0, 0), 0.016 * s, 0.122 * s, 0.034 * s, 0.003 * s), '#3e1d14');
  });
}
export function purse(kit: Kit, at: Vector3, s: number) {
  kit.add(ball(V(at.x, at.y - 0.03 * s, at.z), 0.026 * s, 1, 1.15, 0.8), C.leather);
  kit.add(rod(V(at.x, at.y, at.z), V(at.x, at.y - 0.01 * s, at.z), 0.004 * s, 4), C.leather);
}

// ---------------------------------------------------------------- the sacred
/** A tall staff, crowned with a knob, a crook or a star. */
export function staff(kit: Kit, H: Vector3, s: number, top: 'knob' | 'crook' | 'star', metal: string) {
  const bot = V(H.x, 0.015, H.z + 0.004), tip = V(H.x, H.y + 0.5 * s, H.z + 0.004);
  kit.add(rod(bot, tip, 0.0085 * s, 7), top === 'crook' ? C.darkwood : C.wood);
  if (top === 'knob') kit.add(ball(V(tip.x, tip.y + 0.012 * s, tip.z), 0.018 * s), metal, 'metal');
  else if (top === 'crook') kit.add(ring(0.032 * s, 0.0075 * s, 14, 6, Math.PI * 1.25).rotateX(-Math.PI / 2), metal, 'metal', mul(T(tip.x + 0.032 * s * Math.sign(H.x || 1), tip.y + 0.002, tip.z), RZ(Math.PI)));
  else {
    kit.add(slab(starShape(6, 0.05 * s, 0.022 * s), 0.012 * s, 0.002 * s), metal, 'metal', T(tip.x, tip.y + 0.05 * s, tip.z));
    kit.add(ring(0.055 * s, 0.003 * s, 24, 4).rotateX(Math.PI / 2), metal, 'metal', T(tip.x, tip.y + 0.05 * s, tip.z));
  }
}
/** A censer hanging on its chains. */
export function censer(kit: Kit, H: Vector3, s: number, metal: string) {
  const bowl = V(H.x, H.y - 0.13 * s, H.z + 0.02 * s);
  for (const a of [0, 2.1, 4.2]) kit.add(rod(V(H.x, H.y - 0.01 * s, H.z + 0.015 * s), V(bowl.x + Math.cos(a) * 0.018 * s, bowl.y + 0.02 * s, bowl.z + Math.sin(a) * 0.018 * s), 0.0011 * s, 3), metal, 'metal');
  kit.add(cap(0.024 * s, Math.PI * 0.5, Math.PI, 14, 5), metal, 'metal', T(bowl.x, bowl.y + 0.004 * s, bowl.z));
  kit.add(cap(0.024 * s, 0, Math.PI * 0.5, 14, 5).scale(1, 0.8, 1), shade(metal, -0.15), 'metal', T(bowl.x, bowl.y + 0.006 * s, bowl.z));
  kit.add(ball(V(bowl.x, bowl.y + 0.03 * s, bowl.z), 0.006 * s), metal, 'metal');
  // a thread of incense smoke
  for (let i = 0; i < 4; i++) kit.add(ball(V(bowl.x + Math.sin(i * 1.7) * 0.012 * s, bowl.y + (0.05 + i * 0.03) * s, bowl.z - i * 0.004), (0.011 - i * 0.0015) * s), '#d8d2c8');
}
/** A torch held high (the chairman's charge). */
export function torch(kit: Kit, H: Vector3, s: number) {
  kit.add(tube(V(H.x, H.y - 0.05 * s, H.z), V(H.x, H.y + 0.08 * s, H.z), 0.008 * s, 0.014 * s, 8), C.brass, 'metal');
  kit.add(cyl(0.022 * s, 0.017 * s, 0.03 * s, 12), C.brass, 'metal', T(H.x, H.y + 0.095 * s, H.z));
  kit.add(lathe([[0.02, 0], [0.024, 0.02], [0.015, 0.05], [0.001, 0.085]].map(([r, y]) => [r * s, y * s] as [number, number]), 10), C.flame, 'paint', T(H.x, H.y + 0.108 * s, H.z));
  kit.add(lathe([[0.011, 0], [0.013, 0.015], [0.001, 0.05]].map(([r, y]) => [r * s, y * s] as [number, number]), 8), C.flame2, 'paint', T(H.x, H.y + 0.112 * s, H.z + 0.006 * s));
}

// ---------------------------------------------------------------- envoys and rebels
/** A folded letter closed with wax in the sender's colour. */
export function letter(kit: Kit, H: Vector3, f: FigureSpec, s: number) {
  kit.with(mul(T(H.x + 0.012 * s, H.y + 0.025 * s, H.z + 0.02 * s), RX(-0.35), RZ(-0.25)), () => {
    kit.add(box(V(0, 0, 0), 0.085 * s, 0.055 * s, 0.006 * s, 0.0015 * s), C.parch);
    kit.add(box(V(0, 0.012 * s, 0.0035 * s), 0.085 * s, 0.003 * s, 0.001 * s), shade(C.parch, -0.2));
    kit.add(cyl(0.012 * s, 0.012 * s, 0.004 * s, 14).rotateX(Math.PI / 2), f.tinctures.colour === '#28231f' ? C.wax : f.tinctures.colour, 'paint', T(0, -0.004 * s, 0.004 * s));
    kit.add(ring(0.012 * s, 0.0016 * s, 14, 4).rotateX(Math.PI / 2), f.tinctures.metal, 'metal', T(0, -0.004 * s, 0.0055 * s));
  });
}

/** A banner on a pole, the broken chain of the rebel on it. */
export function banner(kit: Kit, H: Vector3, f: FigureSpec, s: number, side: number) {
  const bot = V(H.x, 0.015, H.z), top = V(H.x, H.y + 0.62 * s, H.z);
  kit.add(rod(bot, top, 0.007 * s, 7), C.darkwood);
  kit.add(ball(V(top.x, top.y + 0.012, top.z), 0.014 * s), f.tinctures.metal, 'metal');
  if (!hasDom) return;
  const w = 0.3 * s, h = 0.21 * s;
  const g = new PlaneGeometry(w, h, 12, 2);
  // the cloth ripples as it hangs from the pole
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + w / 2; p.setZ(i, 0.022 * s * Math.sin(x / w * Math.PI * 1.6) * (x / w)); p.setY(i, p.getY(i) - 0.03 * (x / w) * (x / w) * s); }
  g.computeVertexNormals();
  g.translate(w / 2, 0, 0);
  const m = new Mesh(g, new MeshStandardMaterial({ map: bannerTexture(f), side: DoubleSide, roughness: 0.75, alphaTest: 0.5 }));
  m.castShadow = true;
  m.position.set(top.x, top.y - h / 2 - 0.01 * s, top.z);
  // fly away from the body, swung back a little
  m.rotation.y = side < 0 ? Math.PI - 0.55 : 0.55;
  m.name = 'banner';
  kit.addObject(m);
}
function bannerTexture(f: FigureSpec): CanvasTexture {
  const W = 300, Hh = 210;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Hh;
  const c = cv.getContext('2d')!;
  const t = f.tinctures;
  // a swallow-tailed banner: the field per pale in the house's order, or the state's colour
  c.beginPath();
  c.moveTo(0, 0); c.lineTo(W, 0); c.lineTo(W * 0.8, Hh / 2); c.lineTo(W, Hh); c.lineTo(0, Hh); c.closePath();
  c.save(); c.clip();
  c.fillStyle = t.a; c.fillRect(0, 0, W, Hh);
  if (t.quarterly) { c.fillStyle = t.b; c.fillRect(W * 0.45, 0, W, Hh / 2); c.fillRect(0, Hh / 2, W * 0.45, Hh / 2); }
  // two chain links, the right one broken open
  const metal = t.quarterly ? (t.a === t.metal ? t.colour : t.metal) : t.metal;
  c.lineWidth = 15; c.strokeStyle = '#241c15';
  const link = (cx: number, cy: number, broken: boolean, stroke: string, lw: number) => {
    c.save(); c.translate(cx, cy); c.rotate(-0.55);
    c.lineWidth = lw; c.strokeStyle = stroke; c.lineCap = 'round';
    c.beginPath();
    if (broken) { c.ellipse(0, 0, 38, 22, 0, 0.5, Math.PI * 2 - 0.15); }
    else c.ellipse(0, 0, 38, 22, 0, 0, Math.PI * 2);
    c.stroke(); c.restore();
  };
  for (const [stroke, lw] of [['#241c15', 17], [metal, 11]] as [string, number][]) { link(W * 0.3, Hh * 0.55, false, stroke, lw); link(W * 0.56, Hh * 0.42, true, stroke, lw); }
  c.restore();
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- inventors and the archaeologist
export function wheel(kit: Kit, H: Vector3, s: number) {
  kit.with(mul(T(H.x, H.y + 0.02 * s, H.z + 0.035 * s), RY(0.5)), () => {
    kit.add(ring(0.06 * s, 0.009 * s, 22, 6).rotateX(Math.PI / 2), C.wood);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI; kit.add(rod(V(-Math.cos(a) * 0.056 * s, -Math.sin(a) * 0.056 * s, 0), V(Math.cos(a) * 0.056 * s, Math.sin(a) * 0.056 * s, 0), 0.0045 * s, 5), C.wood); }
    kit.add(cyl(0.014 * s, 0.014 * s, 0.025 * s, 10).rotateX(Math.PI / 2), C.darkwood);
  });
}
export function mallet(kit: Kit, H: Vector3, s: number) {
  kit.add(rod(V(H.x, H.y - 0.04 * s, H.z + 0.01 * s), V(H.x, H.y + 0.09 * s, H.z + 0.02 * s), 0.0055 * s, 6), C.wood);
  kit.add(cyl(0.022 * s, 0.022 * s, 0.07 * s, 10).rotateZ(Math.PI / 2), C.darkwood, 'paint', T(H.x, H.y + 0.1 * s, H.z + 0.02 * s));
}
export function dividers(kit: Kit, H: Vector3, s: number) {
  const top = V(H.x, H.y + 0.05 * s, H.z + 0.015 * s);
  for (const d of [-1, 1]) kit.add(rod(top, V(H.x + d * 0.025 * s, H.y - 0.07 * s, H.z + 0.03 * s), 0.0028 * s, 4), C.brass, 'metal');
  kit.add(ball(top, 0.007 * s), C.brass, 'metal');
}
export function setSquare(kit: Kit, H: Vector3, s: number) {
  kit.with(mul(T(H.x, H.y + 0.02 * s, H.z + 0.03 * s), RX(-0.3)), () => {
    kit.add(box(V(0, 0.04 * s, 0), 0.012 * s, 0.11 * s, 0.004 * s), C.wood);
    kit.add(box(V(0.035 * s, -0.009 * s, 0), 0.08 * s, 0.012 * s, 0.004 * s), C.wood);
  });
}
export function wrench(kit: Kit, H: Vector3, s: number) {
  const a = V(H.x, H.y - 0.04 * s, H.z + 0.01 * s), b = V(H.x + 0.01 * s, H.y + 0.1 * s, H.z + 0.02 * s);
  kit.add(rod(a, b, 0.006 * s, 6), C.iron, 'metal');
  kit.add(ring(0.016 * s, 0.006 * s, 12, 5, Math.PI * 1.5).rotateX(Math.PI / 2), C.iron, 'metal', mul(T(b.x, b.y + 0.012 * s, b.z), RZ(Math.PI * 0.25)));
}
export function cogwheel(kit: Kit, H: Vector3, s: number) {
  const sh = new Shape();
  const n = 10, ro = 0.055 * s, rr = 0.043 * s;
  for (let i = 0; i < n; i++) {
    for (const [da, r] of [[0, rr], [0.12, ro], [0.38, ro], [0.5, rr], [0.75, rr]] as [number, number][]) {
      const a = ((i + da) / n) * Math.PI * 2;
      if (i === 0 && da === 0) sh.moveTo(r * Math.cos(a), r * Math.sin(a)); else sh.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
  }
  sh.closePath();
  const hole = new Shape().absarc(0, 0, 0.015 * s, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  kit.add(slab(sh, 0.014 * s, 0.002 * s), C.brass, 'metal', mul(T(H.x, H.y + 0.03 * s, H.z + 0.035 * s), RY(0.35)));
}
export function trowel(kit: Kit, H: Vector3, s: number) {
  kit.with(mul(T(H.x, H.y, H.z + 0.02 * s), RX(0.9)), () => {
    kit.add(rod(V(0, -0.02 * s, 0), V(0, 0.035 * s, 0), 0.007 * s, 6), C.wood);
    kit.add(rod(V(0, 0.035 * s, 0), V(0, 0.05 * s, 0.006 * s), 0.002 * s, 4), C.steel, 'metal');
    const sh = new Shape(); sh.moveTo(0, 0); sh.lineTo(0.028 * s, 0.03 * s); sh.lineTo(0, 0.1 * s); sh.lineTo(-0.028 * s, 0.03 * s); sh.closePath();
    kit.add(slab(sh, 0.003 * s), C.steel, 'metal', T(0, 0.048 * s, 0.008 * s));
  });
}
export function brush(kit: Kit, H: Vector3, s: number) {
  kit.add(rod(V(H.x, H.y - 0.03 * s, H.z + 0.01 * s), V(H.x, H.y + 0.05 * s, H.z + 0.02 * s), 0.0045 * s, 6), C.wood);
  kit.add(lathe([[0.008, 0], [0.012, 0.012], [0.011, 0.035], [0.006, 0.042]].map(([r, y]) => [r * s, y * s] as [number, number]), 8).scale(1, 1, 0.5), '#d9c9a3', 'paint', T(H.x, H.y + 0.05 * s, H.z + 0.02 * s));
}

/** A black armband: the record says this person fell in battle. */
export function armband(kit: Kit, S: Vector3, E: Vector3, r: number) {
  const m = S.clone().lerp(E, 0.55);
  const d = E.clone().sub(S).normalize();
  kit.add(tube(m.clone().addScaledVector(d, -0.012), m.clone().addScaledVector(d, 0.012), r, r, 12), '#141211');
}
