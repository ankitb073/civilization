// The nearest town as a small block of houses: how many by its population that century, how built by the age
// (mud brick and a stepped temple; pitched roofs and a keep; a spire; brick blocks and a chimney), walled when large
// enough to be walled in its age. Placement is a hash of the battle id. Baked into one geometry.

import { BufferGeometry, CylinderGeometry, Shape, ExtrudeGeometry } from 'three';
import { bake, box, cone, cyl, put, type Part } from './figures.ts';
import { unit, type Style } from './plan.ts';

const ROOF: Record<Style, string[]> = {
  bronze: ['#cdb48a', '#c4a87c', '#d6be94'], iron: ['#a4583a', '#b0673f', '#8f4e36'], medieval: ['#8c4a34', '#6e5444', '#9a5a3c'],
  gunpowder: ['#7d3f30', '#5a4a44', '#94503a'], industrial: ['#4f4a4a', '#5e5450', '#6b4038'], modern: ['#5a5a5c', '#6a6662', '#4d4f52'],
};
const WALL: Record<Style, string[]> = {
  bronze: ['#d9c39a', '#cfb68b', '#e0cba4'], iron: ['#e2d6bc', '#d8c8a8', '#cbb894'], medieval: ['#ddd2bc', '#cfc3a8', '#e6dcc6'],
  gunpowder: ['#e4dac6', '#d4c6aa', '#c9b694'], industrial: ['#a8664c', '#b5735a', '#9a5b44'], modern: ['#cfcac2', '#b8b4ae', '#a9a7a3'],
};

function roofPrism(w: number, d: number, h: number): BufferGeometry {
  const s = new Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
  const g = new ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

export function buildTown(id: string, style: Style, pop: number, heightAt: (x: number, z: number) => number, cx: number, cz: number): { geo: BufferGeometry; radius: number; top: number } {
  const n = Math.round(Math.max(6, Math.min(44, 4 + 8.5 * Math.log10(Math.max(300, pop) / 300))));
  const radius = 0.22 + 0.075 * Math.sqrt(n);
  const parts: Part[] = [];
  const base = heightAt(cx, cz);
  const placed: [number, number, number][] = [];
  const flat = style === 'bronze';
  const tall = style === 'industrial' || style === 'modern';
  // a centre piece for the age
  let top = base + 0.12;
  if (style === 'bronze') {
    for (let k = 0; k < 4; k++) parts.push({ g: put(box(0.26 - k * 0.055, 0.045, 0.26 - k * 0.055), cx, base + 0.0225 + k * 0.045, cz), c: k % 2 ? '#c9ae80' : '#d8c194' });
    parts.push({ g: put(box(0.05, 0.04, 0.05), cx, base + 0.2, cz), c: '#b8573c' });
    top = base + 0.23;
  } else if (style === 'iron') {
    parts.push({ g: put(box(0.2, 0.025, 0.13), cx, base + 0.0125, cz), c: '#e8dcc4' });
    for (let k = 0; k < 6; k++) for (const s of [-1, 1]) parts.push({ g: put(new CylinderGeometry(0.008, 0.008, 0.08, 6), cx - 0.085 + k * 0.034, base + 0.065, cz + s * 0.05), c: '#efe6d2' });
    parts.push({ g: put(roofPrism(0.16, 0.2, 0.05), cx, base + 0.105, cz, 0, Math.PI / 2, 0), c: '#a4583a' });
    top = base + 0.16;
  } else if (style === 'medieval' || style === 'gunpowder') {
    const keep = style === 'medieval';
    parts.push({ g: put(box(keep ? 0.12 : 0.1, keep ? 0.2 : 0.12, keep ? 0.12 : 0.18), cx, base + (keep ? 0.1 : 0.06), cz), c: '#d8ccb4' });
    if (keep) for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push({ g: put(box(0.025, 0.03, 0.025), cx + dx * 0.05, base + 0.215, cz + dz * 0.05), c: '#cfc2a8' });
    else { parts.push({ g: put(box(0.06, 0.14, 0.06), cx, base + 0.19, cz - 0.06), c: '#d8ccb4' }); parts.push({ g: put(cone(0.045, 0.16, 4), cx, base + 0.34, cz - 0.06, 0, Math.PI / 4, 0), c: '#5b4f4a' }); parts.push({ g: put(roofPrism(0.1, 0.12, 0.05), cx, base + 0.12, cz + 0.03, 0, Math.PI / 2, 0), c: '#7d3f30' }); }
    top = base + (keep ? 0.24 : 0.42);
  } else {
    // a mill or works: a long shed and a chimney
    parts.push({ g: put(box(0.22, 0.08, 0.12), cx, base + 0.04, cz), c: '#9a5b44' });
    parts.push({ g: put(roofPrism(0.12, 0.22, 0.04), cx, base + 0.08, cz, 0, 0, 0), c: '#4f4a4a' });
    parts.push({ g: put(cyl(0.018, 0.026, 0.34, 8), cx + 0.13, base + 0.17, cz - 0.04), c: '#7a4234' });
    top = base + 0.36;
  }
  placed.push([cx, cz, 0.17]);
  // houses
  let tries = 0;
  for (let i = 0; placed.length < n + 1 && tries < 900; tries++) {
    const a = unit(`${id}:house:a:${tries}`) * Math.PI * 2;
    const r = 0.14 + Math.sqrt(unit(`${id}:house:r:${tries}`)) * (radius - 0.1);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.85;
    const w = 0.05 + unit(`${id}:house:w:${tries}`) * 0.035, d = 0.045 + unit(`${id}:house:d:${tries}`) * 0.03;
    const s = Math.max(w, d) * 0.62;
    if (placed.some(([px, pz, ps]) => Math.hypot(px - x, pz - z) < ps + s)) continue;
    placed.push([x, z, s]);
    const y = heightAt(x, z);
    const h = tall ? 0.05 + unit(`${id}:house:h:${tries}`) * 0.08 : 0.04 + unit(`${id}:house:h:${tries}`) * 0.02;
    const rot = Math.round(a / (Math.PI / 2)) * (Math.PI / 2) + (unit(`${id}:house:t:${tries}`) - 0.5) * 0.4;
    const k = Math.floor(unit(`${id}:house:c:${tries}`) * 3);
    const wall = WALL[style][k], roof = ROOF[style][(k + i) % 3];
    parts.push({ g: put(box(w, h, d), x, y + h / 2 - 0.004, z, 0, rot, 0), c: wall });
    if (flat) parts.push({ g: put(box(w * 1.04, 0.006, d * 1.04), x, y + h - 0.001, z, 0, rot, 0), c: roof });
    else if (!tall || k === 0) parts.push({ g: put(roofPrism(d * 1.12, w * 1.06, 0.028), x, y + h - 0.004, z, 0, rot + Math.PI / 2, 0), c: roof });
    else parts.push({ g: put(box(w * 1.02, 0.006, d * 1.02), x, y + h, z, 0, rot, 0), c: roof });
    i++;
  }
  // a wall for a sizeable town in an age of walls
  if (pop >= 4000 && style !== 'industrial' && style !== 'modern') {
    const R = radius + 0.06, segs = 28;
    const wc = style === 'bronze' ? '#cdb68c' : '#cbbfa6';
    for (let s = 0; s < segs; s++) {
      if (s === 7 || s === 21) continue; // gates
      const a0 = (s / segs) * Math.PI * 2, a1 = ((s + 1) / segs) * Math.PI * 2, am = (a0 + a1) / 2;
      const x = cx + Math.cos(am) * R, z = cz + Math.sin(am) * R * 0.85;
      const len = Math.hypot(Math.cos(a1) - Math.cos(a0), (Math.sin(a1) - Math.sin(a0)) * 0.85) * R;
      const y = heightAt(x, z);
      parts.push({ g: put(box(len * 1.06, 0.05, 0.02), x, y + 0.02, z, 0, -Math.atan2(Math.sin(am) * 0.85, Math.cos(am)) + Math.PI / 2, 0), c: wc });
      if (s % 4 === 0) parts.push({ g: put(cyl(0.022, 0.024, 0.08, 6), x, y + 0.035, z), c: wc });
    }
  }
  return { geo: bake(parts, {} as never), radius, top };
}
