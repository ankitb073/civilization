// Board-game soldiers: one small low-poly model per troop and age, built from primitives and baked into a single
// geometry with vertex colours (tunic in the side's colour, trim in its metal, arms of the age's metal), so each
// troop of each side is one instanced draw. A model faces +z and stands on y = 0; a foot soldier is ~0.1 tall.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Euler, IcosahedronGeometry,
  Matrix4, Quaternion, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import type { Style, Troop } from './plan.ts';

export interface Palette {
  tunic: string;   // the side's colour tincture
  trim: string;    // its metal tincture
  metal: string;   // the age's metal
  skin: string;
  dark: string;
  wood: string;
  leather: string;
  horse: string;
}

const AGE_METAL: Record<Style, string> = { bronze: '#b98d45', iron: '#8d9093', medieval: '#9da3a8', gunpowder: '#7f8487', industrial: '#5d6266', modern: '#5f6a5c' };

/** A side's palette: its tinctures on the cloth, the age's metal on the arms. */
export function paletteFor(style: Style, colour: string, metal: string): Palette {
  const c = new Color(colour);
  if (style === 'industrial' || style === 'modern') {
    // uniforms: the state's colour, dulled toward field grey or khaki
    c.lerp(new Color(style === 'modern' ? '#6f6a4e' : '#5b5e58'), style === 'modern' ? 0.45 : 0.3);
  }
  return {
    tunic: `#${c.getHexString()}`, trim: metal, metal: AGE_METAL[style], skin: '#b8896a', dark: '#2f2822',
    wood: '#7b5a3a', leather: '#7e5a3a', horse: style === 'modern' ? '#5b5f4c' : '#6d4c33',
  };
}

type Key = keyof Palette;
interface Part { g: BufferGeometry; c: Key | string }

const m4 = new Matrix4();
function put(g: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): BufferGeometry {
  m4.compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));
  g.applyMatrix4(m4);
  return g;
}
const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 6) => new CylinderGeometry(rt, rb, h, seg, 1);
const cone = (r: number, h: number, seg = 6) => new ConeGeometry(r, h, seg, 1);
const ball = (r: number, ws = 6, hs = 4) => new SphereGeometry(r, ws, hs);

function bake(parts: Part[], pal: Palette): BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const c = new Color();
  for (const p of parts) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    g.computeVertexNormals();
    const P = g.getAttribute('position'), Nn = g.getAttribute('normal');
    const hex = (pal as unknown as Record<string, string>)[p.c] ?? p.c;
    c.set(hex);
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
    if (g !== p.g) p.g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  out.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------- bodies
function body(style: Style, opts: { shield?: 'round' | 'oval' | 'kite' | 'rect'; helmet?: boolean } = {}): Part[] {
  const p: Part[] = [];
  // legs and boots
  p.push({ g: put(box(0.011, 0.04, 0.012), -0.0075, 0.02, 0), c: style === 'bronze' || style === 'iron' ? 'skin' : 'dark' });
  p.push({ g: put(box(0.011, 0.04, 0.012), 0.0075, 0.02, 0), c: style === 'bronze' || style === 'iron' ? 'skin' : 'dark' });
  // tunic / coat: flared below the belt
  p.push({ g: put(cyl(0.013, 0.017, 0.044, 6), 0, 0.057, 0), c: 'tunic' });
  p.push({ g: put(box(0.03, 0.006, 0.02), 0, 0.044, 0), c: style === 'gunpowder' || style === 'industrial' || style === 'modern' ? 'dark' : 'leather' });
  // arms
  p.push({ g: put(cyl(0.0045, 0.0045, 0.036, 3), -0.019, 0.062, 0.004, 0.25, 0, 0.12), c: 'tunic' });
  p.push({ g: put(cyl(0.0045, 0.0045, 0.036, 3), 0.019, 0.062, 0.004, 0.25, 0, -0.12), c: 'tunic' });
  // head
  p.push({ g: put(ball(0.0105, 5, 4), 0, 0.0895, 0), c: 'skin' });
  // headgear by age
  if (opts.helmet !== false) {
    switch (style) {
      case 'bronze': p.push({ g: put(new SphereGeometry(0.0118, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.091, 0), c: 'metal' });
        p.push({ g: put(box(0.004, 0.012, 0.004), 0, 0.104, -0.002), c: 'trim' }); break;
      case 'iron': p.push({ g: put(cone(0.0122, 0.02, 6), 0, 0.1, 0), c: 'metal' }); break;
      case 'medieval': p.push({ g: put(cyl(0.0118, 0.0118, 0.019, 6), 0, 0.093, 0), c: 'metal' }); p.push({ g: put(box(0.016, 0.0025, 0.004), 0, 0.093, 0.011), c: 'dark' }); break;
      case 'gunpowder': p.push({ g: put(cyl(0.019, 0.019, 0.003, 7), 0, 0.098, 0), c: 'dark' }); p.push({ g: put(cyl(0.009, 0.011, 0.012, 6), 0, 0.105, 0), c: 'dark' }); break;
      case 'industrial': p.push({ g: put(cyl(0.0105, 0.0115, 0.014, 6), 0, 0.099, 0), c: 'tunic' }); p.push({ g: put(box(0.016, 0.002, 0.008), 0, 0.093, 0.01), c: 'dark' }); break;
      case 'modern': p.push({ g: put(new SphereGeometry(0.0135, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.092, 0, 0, 0, 0, 1, 0.85, 1), c: 'metal' }); break;
    }
  }
  if (opts.shield) {
    const z = 0.014;
    switch (opts.shield) {
      case 'round': p.push({ g: put(cyl(0.02, 0.02, 0.004, 9), -0.016, 0.06, z, Math.PI / 2, 0, 0), c: 'tunic' }); p.push({ g: put(cyl(0.005, 0.005, 0.006, 6), -0.016, 0.06, z + 0.002, Math.PI / 2, 0, 0), c: 'metal' }); break;
      case 'oval': p.push({ g: put(cyl(0.017, 0.017, 0.004, 9), -0.016, 0.058, z, Math.PI / 2, 0, 0, 1, 1, 1.5), c: 'tunic' }); p.push({ g: put(box(0.004, 0.044, 0.006), -0.016, 0.058, z + 0.001), c: 'trim' }); break;
      case 'rect': p.push({ g: put(box(0.03, 0.044, 0.004), -0.015, 0.058, z), c: 'tunic' }); p.push({ g: put(box(0.03, 0.005, 0.0055), -0.015, 0.058, z + 0.0005), c: 'trim' }); break;
      case 'kite': p.push({ g: put(cone(0.017, 0.05, 4), -0.016, 0.055, z, Math.PI, Math.PI / 4, 0, 1, 1, 0.25), c: 'tunic' }); p.push({ g: put(box(0.004, 0.04, 0.0065), -0.016, 0.06, z + 0.001), c: 'trim' }); break;
    }
  }
  return p;
}

function horseParts(rider: Part[], barding: boolean): Part[] {
  const p: Part[] = [];
  p.push({ g: put(box(0.03, 0.034, 0.08), 0, 0.068, 0), c: barding ? 'tunic' : 'horse' });
  for (const [x, z] of [[-0.01, 0.03], [0.01, 0.03], [-0.01, -0.03], [0.01, -0.03]]) p.push({ g: put(box(0.008, 0.05, 0.009), x, 0.026, z), c: 'horse' });
  p.push({ g: put(box(0.016, 0.042, 0.018), 0, 0.094, 0.048, -0.55, 0, 0), c: 'horse' });
  p.push({ g: put(box(0.014, 0.014, 0.03), 0, 0.114, 0.066, 0.2, 0, 0), c: 'horse' });
  p.push({ g: put(box(0.004, 0.03, 0.012), 0, 0.106, 0.04, -0.55, 0, 0), c: 'dark' });
  p.push({ g: put(cyl(0.003, 0.005, 0.04, 4), 0, 0.075, -0.05, -0.9, 0, 0), c: 'dark' });
  if (barding) p.push({ g: put(box(0.032, 0.008, 0.082), 0, 0.087, 0), c: 'trim' });
  // the rider sits on the horse
  for (const r of rider) { put(r.g, 0, 0.05, 0); p.push(r); }
  return p;
}

function riderParts(style: Style, weapon: 'spear' | 'lance' | 'sabre'): Part[] {
  const p = body(style).filter((_, i) => i >= 2); // no legs: they straddle the horse
  p.push({ g: put(box(0.036, 0.01, 0.016), 0, 0.04, 0), c: 'dark' });
  if (weapon === 'lance') { p.push({ g: put(cyl(0.0022, 0.003, 0.19, 4), 0.02, 0.09, 0.04, 1.2, 0, 0), c: 'wood' }); p.push({ g: put(box(0.022, 0.014, 0.003), 0.02, 0.135, -0.004, 0, 0, 0), c: 'trim' }); }
  else if (weapon === 'spear') p.push({ g: put(cyl(0.0018, 0.0025, 0.15, 4), 0.022, 0.085, 0.01, 0.35, 0, 0), c: 'wood' });
  else p.push({ g: put(box(0.0035, 0.05, 0.006), 0.022, 0.095, 0.008, 0.4, 0, 0), c: 'metal' });
  return p;
}

// ---------------------------------------------------------------- troops
export function troopParts(t: Troop, style: Style): Part[] {
  const shieldFor = (): 'round' | 'oval' | 'kite' | 'rect' => (style === 'bronze' ? 'round' : style === 'iron' ? 'oval' : style === 'medieval' ? 'kite' : 'rect');
  switch (t) {
    case 'spear': {
      const p = body(style, { shield: shieldFor() });
      p.push({ g: put(cyl(0.0016, 0.002, 0.16, 4), 0.019, 0.085, 0.006), c: 'wood' });
      p.push({ g: put(cone(0.0035, 0.014, 4), 0.019, 0.172, 0.006), c: 'metal' });
      return p;
    }
    case 'sword': {
      const p = body(style, { shield: style === 'bronze' ? 'rect' : shieldFor() });
      p.push({ g: put(box(0.0035, 0.04, 0.006), 0.021, 0.082, 0.012, 0.35, 0, 0), c: 'metal' });
      p.push({ g: put(box(0.012, 0.0025, 0.004), 0.021, 0.064, 0.006, 0.35, 0, 0), c: 'dark' });
      return p;
    }
    case 'bow': {
      const p = body(style, { helmet: style !== 'bronze' });
      p.push({ g: put(new TorusGeometry(0.03, 0.0018, 3, 8, Math.PI * 0.9), -0.02, 0.07, 0.018, 0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.45), c: 'wood' });
      p.push({ g: put(cyl(0.006, 0.006, 0.034, 5), 0.012, 0.075, -0.013, 0.2, 0, 0), c: 'leather' });
      return p;
    }
    case 'sling': {
      const p = body(style, { helmet: false });
      p.push({ g: put(cyl(0.0012, 0.0012, 0.05, 3), 0.024, 0.1, 0, 0, 0, 0.6), c: 'leather' });
      p.push({ g: put(ball(0.004, 4, 3), 0.038, 0.12, 0), c: 'dark' });
      return p;
    }
    case 'xbow': {
      const p = body(style);
      p.push({ g: put(box(0.006, 0.006, 0.05), 0.008, 0.07, 0.024), c: 'wood' });
      p.push({ g: put(box(0.042, 0.004, 0.004), 0.008, 0.07, 0.046), c: 'metal' });
      return p;
    }
    case 'pike': {
      const p = body(style, { helmet: true });
      p.push({ g: put(cyl(0.0016, 0.002, 0.27, 4), 0.017, 0.135, 0.004), c: 'wood' });
      p.push({ g: put(cone(0.003, 0.014, 4), 0.017, 0.276, 0.004), c: 'metal' });
      return p;
    }
    case 'musket': {
      const p = body(style);
      p.push({ g: put(cyl(0.0022, 0.0028, 0.085, 4), 0.019, 0.085, 0.006, 0.2, 0, 0), c: 'dark' });
      p.push({ g: put(box(0.006, 0.022, 0.008), 0.019, 0.045, 0.0, 0.2, 0, 0), c: 'wood' });
      return p;
    }
    case 'rifle': {
      const p = body(style);
      p.push({ g: put(cyl(0.0018, 0.0024, 0.075, 4), 0.018, 0.075, 0.016, 0.75, 0, 0), c: 'dark' });
      p.push({ g: put(box(0.005, 0.02, 0.007), 0.018, 0.052, -0.006, 0.75, 0, 0), c: 'wood' });
      p.push({ g: put(cone(0.0018, 0.016, 3), 0.018, 0.103, 0.044, 0.75, 0, 0), c: 'metal' });
      p.push({ g: put(box(0.022, 0.026, 0.01), 0, 0.064, -0.017), c: 'leather' });
      return p;
    }
    case 'horse': return horseParts(riderParts(style, style === 'industrial' || style === 'modern' || style === 'gunpowder' ? 'sabre' : 'spear'), false);
    case 'knight': return horseParts(riderParts(style, 'lance'), true);
    case 'chariot': {
      const p: Part[] = [];
      // the car, its wheels, the pole and two horses, a driver and an archer
      p.push({ g: put(box(0.06, 0.032, 0.04), 0, 0.05, -0.02), c: 'wood' });
      p.push({ g: put(box(0.062, 0.006, 0.042), 0, 0.068, -0.02), c: 'tunic' });
      for (const x of [-0.035, 0.035]) {
        p.push({ g: put(new TorusGeometry(0.024, 0.003, 3, 10), x, 0.026, -0.02, 0, Math.PI / 2, 0), c: 'dark' });
        p.push({ g: put(cyl(0.003, 0.003, 0.046, 4), x, 0.026, -0.02, 0, 0, Math.PI / 2), c: 'wood' });
      }
      p.push({ g: put(box(0.004, 0.004, 0.08), 0, 0.045, 0.04), c: 'wood' });
      for (const x of [-0.016, 0.016]) {
        p.push({ g: put(box(0.016, 0.026, 0.06), x, 0.06, 0.09), c: 'horse' });
        for (const [lx, lz] of [[-0.005, 0.11], [0.005, 0.11], [-0.005, 0.07], [0.005, 0.07]]) p.push({ g: put(box(0.005, 0.044, 0.005), x + lx, 0.024, lz), c: 'horse' });
        p.push({ g: put(box(0.01, 0.03, 0.012), x, 0.083, 0.124, -0.5, 0, 0), c: 'horse' });
        p.push({ g: put(box(0.009, 0.009, 0.02), x, 0.098, 0.136, 0.2, 0, 0), c: 'horse' });
      }
      for (const [x, wpn] of [[-0.013, 'reins'], [0.015, 'bow']] as const) {
        const b = body(style, { helmet: true }).filter((_, i) => i >= 2);
        for (const q of b) { put(q.g, x, 0.03, -0.02); p.push(q); }
        if (wpn === 'bow') p.push({ g: put(new TorusGeometry(0.026, 0.0016, 3, 8, Math.PI * 0.9), x + 0.004, 0.1, 0.0, 0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.45), c: 'wood' });
      }
      return p;
    }
    case 'cannon': {
      const p: Part[] = [];
      p.push({ g: put(cyl(0.008, 0.011, 0.11, 7), 0, 0.04, 0.012, Math.PI / 2 - 0.12, 0, 0), c: 'metal' });
      p.push({ g: put(box(0.022, 0.012, 0.07), 0, 0.022, -0.018, 0.15, 0, 0), c: 'wood' });
      for (const x of [-0.019, 0.019]) p.push({ g: put(new CylinderGeometry(0.022, 0.022, 0.006, 9), x, 0.022, 0.0, 0, 0, Math.PI / 2), c: 'wood' });
      p.push({ g: put(ball(0.006, 5, 4), -0.03, 0.006, 0.05), c: 'dark' });
      p.push({ g: put(ball(0.006, 5, 4), -0.024, 0.006, 0.056), c: 'dark' });
      // a gunner
      for (const q of body(style)) { put(q.g, 0.04, 0, -0.03); p.push(q); }
      return p;
    }
    case 'gun': {
      const p: Part[] = [];
      p.push({ g: put(cyl(0.0055, 0.0075, 0.12, 7), 0, 0.045, 0.03, Math.PI / 2 - 0.3, 0, 0), c: 'metal' });
      p.push({ g: put(box(0.05, 0.034, 0.003), 0, 0.04, 0.0), c: 'metal' });
      p.push({ g: put(box(0.008, 0.008, 0.09), -0.012, 0.01, -0.045, 0.1, 0.25, 0), c: 'metal' });
      p.push({ g: put(box(0.008, 0.008, 0.09), 0.012, 0.01, -0.045, 0.1, -0.25, 0), c: 'metal' });
      for (const x of [-0.03, 0.03]) p.push({ g: put(new CylinderGeometry(0.022, 0.022, 0.007, 10), x, 0.022, 0.0, 0, 0, Math.PI / 2), c: 'dark' });
      for (const q of body(style)) { put(q.g, -0.045, 0, -0.04); p.push(q); }
      for (const q of body(style)) { put(q.g, 0.045, 0, -0.05); p.push(q); }
      return p;
    }
    case 'tank': {
      const p: Part[] = [];
      p.push({ g: put(box(0.1, 0.034, 0.15), 0, 0.03, 0), c: 'metal' });
      p.push({ g: put(box(0.11, 0.024, 0.16), 0, 0.016, 0), c: 'dark' });
      p.push({ g: put(box(0.06, 0.03, 0.065), 0, 0.062, -0.01), c: 'metal' });
      p.push({ g: put(cyl(0.0045, 0.005, 0.1, 6), 0, 0.064, 0.07, Math.PI / 2, 0, 0), c: 'dark' });
      p.push({ g: put(box(0.03, 0.004, 0.03), 0, 0.079, -0.01), c: 'tunic' });
      return p;
    }
  }
}

export function troopGeometry(t: Troop, style: Style, pal: Palette): BufferGeometry {
  return bake(troopParts(t, style), pal);
}

/** Props for the board: trees, bushes, reeds, rocks (unit size; scaled per instance). */
export function propGeometry(kind: 'conifer' | 'broadleaf' | 'bush' | 'rock' | 'reed', dark: boolean): BufferGeometry {
  const leaf = dark ? '#3e5a3c' : '#5d7c4a', pine = dark ? '#2f4a3a' : '#466a4c', trunk = '#6b4f37';
  switch (kind) {
    case 'conifer': return bake([
      { g: put(cyl(0.008, 0.01, 0.04, 4), 0, 0.02, 0), c: trunk },
      { g: put(cone(0.05, 0.09, 5), 0, 0.075, 0), c: pine },
      { g: put(cone(0.036, 0.07, 5), 0, 0.12, 0), c: pine },
    ], {} as Palette);
    case 'broadleaf': return bake([
      { g: put(cyl(0.008, 0.011, 0.05, 4), 0, 0.025, 0), c: trunk },
      { g: put(new IcosahedronGeometry(0.052, 0), 0, 0.088, 0, 0.3, 0.5, 0, 1, 0.92, 1), c: leaf },
    ], {} as Palette);
    case 'bush': return bake([{ g: put(new IcosahedronGeometry(0.03, 0), 0, 0.02, 0, 0, 0, 0, 1.2, 0.7, 1), c: dark ? '#5a6a40' : '#7d8a52' }], {} as Palette);
    case 'reed': return bake([
      { g: put(cyl(0.002, 0.003, 0.05, 3), 0, 0.025, 0, 0.1, 0, 0.1), c: '#8c8a4e' },
      { g: put(cyl(0.002, 0.003, 0.045, 3), 0.01, 0.022, 0.004, -0.1, 0, -0.15), c: '#8c8a4e' },
      { g: put(cyl(0.002, 0.003, 0.04, 3), -0.008, 0.02, -0.006, 0, 0, 0.2), c: '#7a7a44' },
    ], {} as Palette);
    case 'rock': return bake([{ g: put(new IcosahedronGeometry(0.035, 0), 0, 0.012, 0, 0.4, 0.7, 0, 1.2, 0.6, 1), c: '#8a8278' }], {} as Palette);
  }
}

/** Raw parts baked with explicit colours (for the town and the standards). */
export { bake, put, box, cyl, cone, ball };
export type { Part };
