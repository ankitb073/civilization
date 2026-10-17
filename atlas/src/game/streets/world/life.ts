// Streets world: cheap signs of life before the crowds of step 3. Thin hearth smoke over some roofs and courtyards;
// banners in the state's arms (drawn by heraldry.ts, the same arms as on its page) on the palace, the temple and the
// gate towers, stirring in the wind; birds wheeling over the town; and figurine townspeople standing at the stalls,
// the scale, the well and the gates (painted wood, no faces, as the site's figurines). All animation is in shaders
// driven by one time uniform; with reduced motion the time stands still.

import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, InstancedBufferAttribute, InstancedMesh,
  Matrix4, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3,
} from 'three';
import type { Smoke } from '../../../three/city/model.ts';
import { hash } from '../../../three/city/record.ts';
import { armsSvg } from '../../../heraldry.ts';
import type { ArmsSpec } from '../../../../../engine/src/export/contract.ts';
import { type Ctx, C } from './ctx.ts';
import type { Civic } from './civic.ts';
import { shade, vary, type RGB } from '../../../three/city/style.ts';

/** Hearth smoke: from bread ovens on the roofs and fires in the courtyards (sources in metres). */
export function hearths(ctx: Ctx, max: number): Smoke[] {
  const out: Smoke[] = [];
  const H = ctx.plan.houses;
  const order = H.map((_, i) => i).filter((i) => H[i].kind === 'house').sort((a, b) => ctx.u(`hearth:${a}`) - ctx.u(`hearth:${b}`));
  const placed: [number, number][] = [];
  for (const i of order) {
    if (out.length >= max) break;
    const h = H[i];
    if (placed.some(([x, z]) => Math.hypot(x - h.x, z - h.z) < 22)) continue;
    const court = ctx.sides[i].find((s) => s.court);
    let x: number, z: number, y: number;
    if (!court && !h.flat) continue;
    if (court && (ctx.u(`hc:${i}`) < 0.5 || !h.flat)) {
      x = court.x + court.nx * 2.2; z = court.z + court.nz * 2.2; y = h.ground + 0.4;
      // a hearth of stones
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ctx.kit.put('rock', x + Math.cos(a) * 0.42, y - 0.32, z + Math.sin(a) * 0.42, k, 0.26, 0.2, 0.26, [0.5, 0.47, 0.42]);
      }
      ctx.kit.put('rock', x, y - 0.38, z, 0, 0.5, 0.12, 0.5, [0.85, 0.42, 0.16]);
    } else {
      // a chimney pot on a roof corner
      const c = Math.cos(h.rot), s = Math.sin(h.rot);
      const u = (ctx.u(`hu:${i}`) < 0.5 ? -1 : 1) * (h.hw - 0.8), v = (ctx.u(`hv:${i}`) < 0.5 ? -1 : 1) * (h.hd - 0.8);
      x = h.x + c * u + s * v; z = h.z - s * u + c * v; y = h.roof + 0.65;
      ctx.kit.put('pole', x, h.roof + 0.32, z, 0, 0.42, 0.64, 0.42, shade(h.wall, 0.8));
      ctx.kit.solidBox(x, h.roof + 0.32, z, 0, 0.2, 0.32, 0.2);
    }
    out.push({ x, y, z, k: 0.9 + 0.5 * ctx.u(`hk:${i}`), seed: ctx.u(`hs:${i}`) });
    placed.push([h.x, h.z]);
  }
  return out;
}

/** A fig tree in some courtyards (a short trunk and a broad crown), for shade and green between the roofs. */
export function courtyardTrees(ctx: Ctx): number {
  const seen = new Set<string>();
  let n = 0;
  ctx.plan.houses.forEach((h, i) => {
    for (const s of ctx.sides[i] ?? []) {
      if (!s.court) continue;
      const d = Math.min(s.open, 8) / 2;
      const x = s.x + s.nx * d, z = s.z + s.nz * d;
      const k = `${Math.round(x / 5)},${Math.round(z / 5)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (ctx.u(`fig:${k}`) > 0.34) continue;
      const g = ctx.ground(x, z);
      if (ctx.occ.blocked(x, z, 0.8, g + 0.1, g + 2)) continue;
      const sz = 0.85 + 0.35 * ctx.u(`figs:${k}`);
      const leaf: RGB = vary([0.36, 0.45, 0.24], ctx.u(`figc:${k}`), 0.12);
      ctx.kit.put('pole', x, g + 0.9 * sz, z, 0, 0.26 * sz, 1.8 * sz, 0.26 * sz, [0.45, 0.38, 0.3]);
      ctx.kit.solidBox(x, g + 0.9 * sz, z, 0, 0.14, 0.9 * sz, 0.14);
      for (let j = 0; j < 4; j++) {
        const a = j * 1.7 + ctx.u(`figa:${k}`) * 6, r = j ? 0.9 * sz : 0;
        ctx.kit.put('ball', x + Math.cos(a) * r, g + (2.0 + (j ? 0 : 0.5)) * sz, z + Math.sin(a) * r, a, 2.4 * sz, 1.5 * sz, 2.4 * sz, shade(leaf, 0.9 + 0.08 * j));
      }
      ctx.occ.add({ x, z, rot: 0, hw: 0.3, hd: 0.3 }, g, g + 3.5 * sz);
      n++;
    }
  });
  return n;
}

// ---------------------------------------------------------------- banners

const COLOURS = ['#b3322a', '#27589b', '#2c7847', '#6a3c88', '#28231f'];
const METALS = ['#d6a634', '#f2eee5'];

/** The banner's cloth: the people's colour, a fringe of the faith's metal, the arms in the middle (drawn when the
 *  SVG has loaded; plain until then). */
function bannerTexture(arms: ArmsSpec | null, fallback: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  const field = arms ? COLOURS[hash(`cul:${arms[1]}`) % COLOURS.length] : fallback;
  const metal = arms ? METALS[hash(arms[2] >= 0 ? `mov:${arms[2]}` : `none:${arms[0]}`) % 2] : '#d6a634';
  const paint = () => {
    g.fillStyle = field;
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = metal;
    g.fillRect(0, 0, 128, 10);
    g.fillRect(0, 0, 8, 256); g.fillRect(120, 0, 8, 256);
    // a swallowtail hem
    g.fillStyle = metal;
    g.beginPath(); g.moveTo(0, 236); g.lineTo(64, 214); g.lineTo(128, 236); g.lineTo(128, 246); g.lineTo(64, 224); g.lineTo(0, 246); g.fill();
    g.clearRect(0, 246, 128, 10);
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.moveTo(0, 256); g.lineTo(64, 228); g.lineTo(128, 256); g.fill();
    g.restore();
  };
  paint();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  if (arms && typeof Image !== 'undefined') {
    try {
      const svg = armsSvg(arms, { uid: 'streets-banner' });
      const img = new Image();
      img.onload = () => { paint(); g.drawImage(img, 18, 40, 92, 110); tex.needsUpdate = true; };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.includes('xmlns') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'))}`;
    } catch { /* the plain banner stays */ }
  }
  return tex;
}

export interface Life { group: Group; tick(t: number): void; dispose(): void; birds: number; banners: number; people: number }

export function life(ctx: Ctx, civ: Civic, arms: ArmsSpec | null, fallbackColour: string, reduced: boolean): Life {
  const group = new Group();
  group.name = 'streets-life';
  const uTime = { value: 0 };
  const disposers: (() => void)[] = [];

  // ---- banners: a cloth on a pole (or hung from a tower's face), swaying from the top
  const B = civ.banners;
  if (B.length) {
    const geo = new PlaneGeometry(1, 1, 1, 8).translate(0, -0.5, 0);
    const tex = bannerTexture(arms, fallbackColour);
    const mat = new MeshLambertMaterial({ map: tex, side: DoubleSide, alphaTest: 0.5 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float down = -position.y;
  float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
  transformed.z += sin(uTime * 1.9 + ph + down * 2.6) * 0.13 * down + 0.06 * down;
  transformed.x += sin(uTime * 1.3 + ph * 1.7 + down * 1.4) * 0.03 * down;
}`);
    };
    const im = new InstancedMesh(geo, mat, B.length);
    const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0);
    B.forEach((b, i) => {
      const top = b.pole ? b.y + b.h + 0.4 : b.y;
      q.setFromAxisAngle(up, b.yaw);
      m.compose(new Vector3(b.x, top, b.z), q, new Vector3(b.h * 0.42, b.h, 1));
      im.setMatrixAt(i, m);
      if (b.pole) {
        ctx.kit.put('pole', b.x, b.y + (b.h + 0.7) / 2, b.z, 0, 0.1, b.h + 0.7, 0.1, C.timberDark);
        ctx.kit.solidBox(b.x, b.y + (b.h + 0.7) / 2, b.z, 0, 0.06, (b.h + 0.7) / 2, 0.06);
        // the crossbar
        const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
        ctx.kit.put('wood', b.x, top + 0.02, b.z, b.yaw, b.h * 0.5, 0.06, 0.06, C.timberDark);
        void c; void s;
      }
    });
    im.castShadow = true;
    im.frustumCulled = false;
    im.name = 'banners';
    group.add(im);
    disposers.push(() => { geo.dispose(); tex.dispose(); mat.dispose(); });
  }

  // ---- birds: a few flocks wheeling over the town (a V of two triangles, flapping)
  const flocks = ctx.mobile ? 3 : 4, per = ctx.mobile ? 6 : 8;
  const n = flocks * per;
  const bg = new BufferGeometry();
  bg.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0.18, -0.55, 0.05, -0.12, 0, 0, -0.1,
    0, 0, 0.18, 0, 0, -0.1, 0.55, 0.05, -0.12,
  ]), 3));
  bg.computeVertexNormals();
  const fl = new Float32Array(n * 4), cen = new Float32Array(n * 3);
  const R = ctx.plan.walls ? ctx.plan.walls.R : 120;
  for (let f = 0; f < flocks; f++) {
    const a = ctx.u(`flock:${f}`) * Math.PI * 2, rr = R * (0.2 + 0.55 * ctx.u(`flr:${f}`));
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const rad = 18 + 26 * ctx.u(`flrad:${f}`), h = 24 + 22 * ctx.u(`flh:${f}`);
    const sp = (ctx.u(`fls:${f}`) < 0.5 ? -1 : 1) * (0.16 + 0.1 * ctx.u(`flsp:${f}`));
    for (let k = 0; k < per; k++) {
      const i = f * per + k;
      fl[i * 4] = rad + (ctx.u(`b:${i}:r`) - 0.5) * 7;
      fl[i * 4 + 1] = h + (ctx.u(`b:${i}:h`) - 0.5) * 4;
      fl[i * 4 + 2] = sp * (0.95 + 0.1 * ctx.u(`b:${i}:s`));
      fl[i * 4 + 3] = (k / per) * 0.9 + ctx.u(`b:${i}:p`) * 0.25;
      cen[i * 3] = cx; cen[i * 3 + 1] = ctx.u(`b:${i}:w`) * 6.28; cen[i * 3 + 2] = cz;
    }
  }
  bg.setAttribute('aBird', new InstancedBufferAttribute(fl, 4));
  bg.setAttribute('aCen', new InstancedBufferAttribute(cen, 3));
  const bm = new MeshBasicMaterial({ color: 0x3a3029, side: DoubleSide, fog: true });
  bm.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec4 aBird;\nattribute vec3 aCen;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float a = aBird.z * uTime + aBird.w * 6.2831;
  float flap = sin(uTime * (9.0 + aCen.y) + aCen.y * 3.0);
  vec3 p = transformed;
  p.y += abs(p.x) * flap * 0.55;
  p *= 1.6;
  vec3 fwd = normalize(vec3(-sin(a), 0.0, cos(a)) * sign(aBird.z));
  vec3 side = vec3(fwd.z, 0.0, -fwd.x);
  vec3 c = vec3(aCen.x + cos(a) * aBird.x, aBird.y + sin(a * 2.3 + aCen.y) * 2.0, aCen.z + sin(a) * aBird.x);
  transformed = c + side * p.x + vec3(0.0, p.y, 0.0) + fwd * p.z;
}`);
  };
  const birds = new InstancedMesh(bg, bm, n);
  for (let i = 0; i < n; i++) birds.setMatrixAt(i, new Matrix4());
  birds.frustumCulled = false;
  birds.name = 'birds';
  group.add(birds);
  disposers.push(() => { bg.dispose(); bm.dispose(); });

  // ---- figurines: a gown (women) or a kilt over bare legs (men), a torso, shoulders, arms, a bare wooden head
  const wood: RGB = [0.79, 0.64, 0.47];
  for (const p of civ.people) {
    const k = ctx.kit;
    const sit = p.pose === 'sit';
    if (sit) k.put('frustum', p.x, p.y + 0.22, p.z, p.yaw, 0.42, 0.44, 0.42, C.timber);
    const base = sit ? p.y + 0.44 : p.y;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    // local frame: x across the shoulders (c, −s), z forward (s, c)
    const at = (u: number, v: number): [number, number] => [p.x + c * u + s * v, p.z - s * u + c * v];
    if (sit) {
      // a lap and shins
      const [lx, lz] = at(0, 0.18);
      k.put('wood', lx, base + 0.06, lz, p.yaw, 0.36, 0.14, 0.42, p.c);
      const [sx, sz] = at(0, 0.38);
      k.put('wood', sx, p.y + 0.22, sz, p.yaw, 0.3, 0.44, 0.14, p.sex === 'f' ? p.c : wood);
    } else if (p.sex === 'f') {
      k.put('frustum', p.x, base + 0.56, p.z, p.yaw, 0.5, 1.12, 0.42, p.c);
    } else {
      for (const sg of [-1, 1]) { const [lx, lz] = at(sg * 0.09, 0); k.put('pole', lx, base + 0.27, lz, 0, 0.11, 0.54, 0.11, wood); }
      k.put('frustum', p.x, base + 0.75, p.z, p.yaw, 0.46, 0.5, 0.38, p.c);
    }
    const waist = sit ? base + 0.1 : p.sex === 'f' ? base + 1.08 : base + 0.98;
    k.put('pole', p.x, waist + 0.18, p.z, p.yaw, 0.34, 0.38, 0.24, p.sex === 'f' ? p.c : wood);
    k.put('ball', p.x, waist + 0.38, p.z, p.yaw, 0.48, 0.16, 0.28, p.sex === 'f' ? p.c : wood);
    for (const sg of [-1, 1]) {
      const up = p.pose === 'carry' && sg > 0;
      const [ax, az] = at(sg * 0.24, 0);
      k.put('pole', ax, waist + (up ? 0.6 : 0.12), az, 0, 0.09, 0.5, 0.09, wood);
    }
    k.put('ball', p.x, waist + 0.6, p.z, p.yaw, 0.24, 0.29, 0.25, wood);
    if (p.sex === 'f' && hash(`${p.x.toFixed(1)}:${p.z.toFixed(1)}`) % 2) {
      const [hx, hz] = at(0, -0.05);
      k.put('ball', hx, waist + 0.66, hz, p.yaw, 0.27, 0.2, 0.28, shade(p.c, 0.85));
    }
    if (p.pose === 'carry') { const [jx, jz] = at(0.24, 0); k.put('jar', jx, waist + 1.02, jz, 0, 0.32, 0.4, 0.32, C.clay); }
  }

  return {
    group,
    birds: n,
    banners: B.length,
    people: civ.people.length,
    tick(t: number) { uTime.value = reduced ? 12.5 : t; },
    dispose() { for (const d of disposers) d(); },
  };
}

export const _c = new Color();
