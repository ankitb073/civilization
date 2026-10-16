// Procedural 3D models of the archive's documents, built from an ObjectSpec (record.ts) with surfaces painted in
// faces.ts. Every model stands on y = 0, faces +z, is centred on x = 0 and is built at its real size in metres,
// with the museum furniture it needs (a stele's base, a broken stone's steel mount, a coin's stand, a slanted board
// for paper). Low-poly and stylised; the detail is in the textures.
import {
  Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, DoubleSide, BackSide,
  ExtrudeGeometry, FrontSide, Group, IcosahedronGeometry, LatheGeometry, Mesh, MeshStandardMaterial, NoColorSpace,
  PlaneGeometry, RepeatWrapping, Shape, SRGBColorSpace, TubeGeometry, Vector2, Vector3, type Material, type Texture,
} from 'three';
import { blocksText, rng, type Block, type ObjectSpec } from './record.ts';
import {
  canvas, ctxOf, HAND, jagged, MONO, SANS, SERIF, drawBlurred, drawLine, wrap, fitSize, type Cv,
} from './paint.ts';
import {
  woodFace, mixColour, clayFaces, coinFace, envelopeFace, inscribedFace, METAL, paperStyle, plainFace, sheet, sheetDamage, sheetTex, stateColour,
  STONE, writeBlocks, type FaceLayout, type Imgs, type PaperStyle, type Tex,
} from './faces.ts';

export interface BuildOpts { detail: 'low' | 'mid' | 'high'; anisotropy?: number; /** texture scale override (1 = high) */ scale?: number }
export interface Built { group: Group; mats: MeshStandardMaterial[]; textures: Texture[]; size: Vector3 }

type P = [number, number];

// ---------------------------------------------------------------- materials and textures
class Kit {
  mats: MeshStandardMaterial[] = [];
  textures: Texture[] = [];
  private aniso: number;
  constructor(aniso: number) { this.aniso = aniso; }
  tex(cv: Cv, colour: boolean, repeat = false): CanvasTexture {
    const t = new CanvasTexture(cv);
    t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
    t.anisotropy = this.aniso;
    if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; }
    this.textures.push(t);
    return t;
  }
  mat(t: Tex | null, o: { rough?: number; metal?: number; color?: string; normal?: number; side?: typeof FrontSide | typeof DoubleSide | typeof BackSide; repeat?: boolean; env?: number } = {}): MeshStandardMaterial {
    const m = new MeshStandardMaterial({
      color: o.color ? new Color(o.color) : 0xffffff,
      roughness: o.rough ?? 0.85,
      metalness: o.metal ?? 0,
      side: o.side ?? FrontSide,
      envMapIntensity: o.env ?? 1,
    });
    if (t) {
      m.map = this.tex(t.map, true, o.repeat);
      if (t.normal) { m.normalMap = this.tex(t.normal, false, o.repeat); m.normalScale.set(o.normal ?? 1, o.normal ?? 1); }
      if (t.alpha) { m.alphaTest = 0.5; m.transparent = false; }
    }
    m.userData.normal = o.normal ?? 1;
    this.mats.push(m);
    return m;
  }
  /** Neutral museum furniture: a dark stand, felt, steel. */
  furniture(kind: 'felt' | 'steel' | 'acrylic' | 'wood' | 'base', color?: string): MeshStandardMaterial {
    const m = kind === 'steel' ? new MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.35, metalness: 0.9 })
      : kind === 'acrylic' ? new MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.35 })
        : kind === 'wood' ? new MeshStandardMaterial({ color: new Color(color ?? '#6b4a2e'), roughness: 0.7 })
          : kind === 'base' ? new MeshStandardMaterial({ color: new Color(color ?? '#8a8173'), roughness: 0.9 })
            : new MeshStandardMaterial({ color: new Color(color ?? '#2d2a2e'), roughness: 0.95 });
    m.userData.furniture = true;
    this.mats.push(m);
    return m;
  }
}

// ---------------------------------------------------------------- geometry helpers
/** Smooth vertex normals across coincident vertices (split faces, extrusion caps). */
function smoothNormals(g: BufferGeometry) {
  const pos = g.getAttribute('position') as BufferAttribute;
  const idx = g.getIndex();
  const n = pos.count;
  const keys: string[] = new Array(n);
  for (let i = 0; i < n; i++) keys[i] = `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
  const acc = new Map<string, Vector3>();
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
  const tri = idx ? idx.count / 3 : n / 3;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(3 * t) : 3 * t, i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1, i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    const fn = e1.subVectors(b, a).cross(e2.subVectors(c, a));
    for (const i of [i0, i1, i2]) { const k = keys[i]; const v = acc.get(k); if (v) v.add(fn); else acc.set(k, fn.clone()); }
  }
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = acc.get(keys[i])!.clone().normalize(); nor[3 * i] = v.x; nor[3 * i + 1] = v.y; nor[3 * i + 2] = v.z; }
  g.setAttribute('normal', new BufferAttribute(nor, 3));
}

/** A box with rounded edges and (optionally) bulging faces, like a clay tablet. Groups: 0 front (+z), 1 back, 2 sides.
 *  Front and back UVs span the face (the back mirrored so it reads from behind). */
function roundedBox(w: number, h: number, d: number, r: number, bulge = 0, seg = 18, metres = false): BufferGeometry {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const rz = Math.min(r, hd * 0.95), rr = Math.min(r, hw * 0.9, hh * 0.9);
  const g = new BoxGeometry(w, h, d, seg, Math.round(seg * h / w) || seg, Math.max(4, Math.round(seg * d / w * 2)));
  const pos = g.getAttribute('position') as BufferAttribute;
  const uv = g.getAttribute('uv') as BufferAttribute;
  const remap = (t: number, half: number) => { const u = t / half; return Math.sign(u) * (1 - Math.pow(Math.max(0, 1 - Math.abs(u)), 1.7)) * half; };
  const p = new Vector3(), q = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.set(remap(pos.getX(i), hw), remap(pos.getY(i), hh), remap(pos.getZ(i), hd));
    q.set(Math.max(-hw + rr, Math.min(hw - rr, p.x)), Math.max(-hh + rr, Math.min(hh - rr, p.y)), Math.max(-hd + rz, Math.min(hd - rz, p.z)));
    const v = p.clone().sub(q);
    const L = Math.hypot(v.x / rr, v.y / rr, v.z / rz);
    if (L > 1e-6) { p.set(q.x + v.x / L, q.y + v.y / L, q.z + v.z / L); }
    if (bulge) {
      const k = Math.max(0, 1 - (p.x / hw) ** 2) * Math.max(0, 1 - (p.y / hh) ** 2);
      p.z += Math.sign(p.z) * bulge * k * (Math.abs(p.z) / hd) ** 2;
    }
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  // UVs: planar over the front and back; the sides in metres (their textures repeat)
  const idx = g.getIndex()!;
  for (const gr of g.groups) {
    for (let k = gr.start; k < gr.start + gr.count; k++) {
      const i = idx.getX(k);
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if ((gr.materialIndex === 4 || gr.materialIndex === 5) && !metres) { const u = (x + hw) / w; uv.setXY(i, gr.materialIndex === 4 ? u : 1 - u, (y + hh) / h); }
      else if (gr.materialIndex === 4 || gr.materialIndex === 5) uv.setXY(i, x * 4, y * 4);
      else if ((gr.materialIndex ?? 0) <= 1) uv.setXY(i, z * 4, y * 4);
      else uv.setXY(i, x * 4, z * 4);
    }
  }
  g.groups = g.groups.map((gr) => ({ ...gr, materialIndex: gr.materialIndex === 4 ? 0 : gr.materialIndex === 5 ? 1 : 2 }));
  smoothNormals(g);
  return g;
}

/** Sort an extruded shape's triangles into front (+z), back and sides, with the front's UVs over `bbox`. */
function regroup(g: BufferGeometry, bbox: [number, number, number, number]): BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position') as BufferAttribute;
  const nor = src.getAttribute('normal') as BufferAttribute;
  const uv0 = src.getAttribute('uv') as BufferAttribute;
  const [x0, y0, x1, y1] = bbox;
  const buckets: number[][] = [[], [], []];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const T = pos.count / 3;
  const fnx = new Float32Array(T), fny = new Float32Array(T), fnz = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    a.fromBufferAttribute(pos, 3 * t); b.fromBufferAttribute(pos, 3 * t + 1); c.fromBufferAttribute(pos, 3 * t + 2);
    const fn = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    fnx[t] = fn.x; fny[t] = fn.y; fnz[t] = fn.z;
    buckets[fn.z > 0.5 ? 0 : fn.z < -0.5 ? 1 : 2].push(t);
  }
  const P: number[] = [], N: number[] = [], U: number[] = [];
  const out = new BufferGeometry();
  let start = 0;
  buckets.forEach((list, gi) => {
    for (const t of list) for (let k = 0; k < 3; k++) {
      const i = 3 * t + k;
      const x = pos.getX(i), y = pos.getY(i);
      P.push(x, y, pos.getZ(i));
      N.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (gi === 0) U.push((x - x0) / (x1 - x0), (y - y0) / (y1 - y0));
      else {
        // box mapping by the triangle's dominant axis, in metres (the side texture repeats)
        const z = pos.getZ(i);
        const ax = Math.abs(fnx[t]), ay = Math.abs(fny[t]), az = Math.abs(fnz[t]);
        if (az >= ax && az >= ay) U.push(x * 3, y * 3); else if (ax >= ay) U.push(z * 3, y * 3); else U.push(x * 3, z * 3);
      }
    }
    out.addGroup(start, list.length * 3, gi);
    start += list.length * 3;
  });
  out.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
  out.setAttribute('uv', new BufferAttribute(new Float32Array(U), 2));
  return out;
}

function extrude(pts: P[], depth: number, bevel: number, bbox: [number, number, number, number]): BufferGeometry {
  const sh = new Shape(pts.map(([x, y]) => new Vector2(x, y)));
  const bt = Math.min(bevel, depth * 0.3);
  const g = new ExtrudeGeometry(sh, { depth: Math.max(0.001, depth - 2 * bt), bevelEnabled: bt > 0, bevelThickness: bt, bevelSize: bt * 0.8, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(depth - 2 * bt) / 2);
  return regroup(g, bbox);
}

/** Subdivide a closed polygon's edges to at most `step` and bite chips out of its rim (not out of `keep` points). */
function chipped(pts: P[], step: number, label: string, chips: number, depth: number, keep = new Set<number>()): P[] {
  const out: P[] = [];
  const fixed: boolean[] = [];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    for (let k = 0; k < n; k++) { out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]); fixed.push(keep.has(i) && (k === 0 || keep.has((i + 1) % pts.length))); }
  });
  const R = rng(`chips:${label}`);
  let cx = 0, cy = 0;
  for (const [x, y] of out) { cx += x; cy += y; }
  cx /= out.length; cy /= out.length;
  for (let c = 0; c < chips; c++) {
    const at = Math.floor(R() * out.length);
    const span = 2 + Math.floor(R() * 3), dep = depth * (0.4 + R() * 0.8);
    for (let k = -span; k <= span; k++) {
      const i = (at + k + out.length) % out.length;
      if (fixed[i]) continue;
      const f = (1 - Math.abs(k) / (span + 1)) * dep;
      const [x, y] = out[i];
      const L = Math.hypot(cx - x, cy - y) || 1;
      out[i] = [x + (cx - x) / L * f, y + (cy - y) / L * f];
    }
  }
  return out;
}

// ---------------------------------------------------------------- value noise (rocks)
function lattice(i: number, j: number, k: number, seed: number): number {
  let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(fx), v = s(fy), w = s(fz);
  const L = (a: number, b: number, t: number) => a + (b - a) * t;
  return L(
    L(L(lattice(i, j, k, seed), lattice(i + 1, j, k, seed), u), L(lattice(i, j + 1, k, seed), lattice(i + 1, j + 1, k, seed), u), v),
    L(L(lattice(i, j, k + 1, seed), lattice(i + 1, j, k + 1, seed), u), L(lattice(i, j + 1, k + 1, seed), lattice(i + 1, j + 1, k + 1, seed), u), v), w);
}

// ---------------------------------------------------------------- builders
export function buildObject(s: ObjectSpec, imgs: Imgs, o: BuildOpts): Built {
  const kit = new Kit(o.anisotropy ?? 4);
  const g = new Group();
  const hi = o.scale ?? (o.detail === 'high' ? 1 : o.detail === 'mid' ? 0.5 : 0.25);
  switch (s.family) {
    case 'stele': case 'slab': stele(s, g, kit, imgs, hi); break;
    case 'rock': rock(s, g, kit, imgs, hi); break;
    case 'brick': case 'foundation': block(s, g, kit, imgs, hi); break;
    case 'plaster': graffito(s, g, kit, imgs, hi); break;
    case 'plaque': plaque(s, g, kit, imgs, hi); break;
    case 'tablet': case 'tablets': tablets(s, g, kit, imgs, hi); break;
    case 'envelope': envelope(s, g, kit, imgs, hi); break;
    case 'coin': coin(s, g, kit, imgs, hi); break;
    case 'sherd': sherd(s, g, kit, hi); break;
    case 'wax': wax(s, g, kit, hi); break;
    case 'scroll': scroll(s, g, kit, hi); break;
    case 'charter': charter(s, g, kit, imgs, hi); break;
    case 'codex': codex(s, g, kit, hi); break;
    default: flat(s, g, kit, hi);
  }
  g.traverse((m) => {
    const mesh = m as Mesh;
    if (!mesh.isMesh) return;
    // the verso of a sheet (a second, back-facing mesh on the same surface) must not shadow its own recto
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // and a sheet (a single surface) would shadow itself: thin surfaces receive shadows but do not cast them
    mesh.castShadow = !mesh.userData.thin && !mats.some((x) => x.side === BackSide || (x as MeshStandardMaterial).transparent);
    mesh.receiveShadow = true;
  });
  g.updateMatrixWorld(true);
  const size = new Box3().setFromObject(g).getSize(new Vector3());
  return { group: g, mats: kit.mats, textures: kit.textures, size };
}

/** Texture pixels per metre for a surface whose longest side is `longest`: `hiPx` at full detail, scaled by `hi`. */
const px = (hi: number, longest: number, hiPx = 2048) => Math.max(96, hiPx * hi) / longest;

// ---- steles and slabs
function stele(s: ObjectSpec, g: Group, kit: Kit, imgs: Imgs, hi: number) {
  const [w, h, d] = s.dims;
  const R = rng(`stele:${s.id}`);
  const slab = s.family === 'slab';
  const style = slab ? 'rect' : s.era <= 1 ? 'arch' : s.era === 2 ? (R() < 0.5 ? 'arch' : 'gable') : R() < 0.5 ? 'gable' : 'rect';
  const wt = slab ? w : w * 0.93;
  const archH = style === 'arch' ? w * 0.42 : style === 'gable' ? w * 0.2 : 0;
  const ys = h - archH;
  const half = (y: number) => (w + (wt - w) * (y / h)) / 2;
  const top: P[] = [];
  if (style === 'arch') for (let i = 0; i <= 28; i++) { const t = (i / 28) * Math.PI; top.push([Math.cos(t) * half(ys), ys + Math.sin(t) * archH]); }
  else if (style === 'gable') top.push([half(ys), ys], [0, h], [-half(ys), ys]);
  else top.push([half(h), h], [-half(h), h]);
  const dm = s.dmg;
  let bottom: P[] = [[-half(0), 0], [half(0), 0]];
  if (dm.brokenLower) {
    const y1 = h * (0.12 + R() * 0.1), y2 = h * (0.2 + R() * 0.12);
    bottom = jagged(`${s.id}:brk`, -half(y1), y1, half(y2), y2, 16, w * 0.05);
  }
  let crackPts: P[] | null = null;
  if (dm.fracture) {
    const base = Math.max(...bottom.map((p) => p[1]));
    const c1 = base + h * (0.1 + R() * 0.08), c2 = base + h * (0.16 + R() * 0.08);
    crackPts = jagged(`${s.id}:crk`, -half(c1), c1, half(c2), c2, 14, w * 0.03);
  }
  const piece = (bot: P[], topLine: P[] | null): { pts: P[]; keep: Set<number> } => {
    const pts: P[] = [...bot];
    const keep = new Set<number>(bot.map((_, i) => i).filter(() => bot.length > 2));
    if (topLine) { for (const p of topLine.slice().reverse()) { keep.add(pts.length); pts.push(p); } }
    else pts.push(...top);
    return { pts, keep };
  };
  const pieces = crackPts ? [piece(bottom, crackPts), piece(crackPts, null)] : [piece(bottom, null)];
  // the face: one canvas over the whole stone, so the text runs on across a fracture
  const ppm = px(hi, h);
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  const X = (x: number) => (x + w / 2) * ppm, Y = (y: number) => (h - y) * ppm;
  const sym: [number, number, number] | undefined = slab ? undefined : style === 'arch' ? [X(0), Y(ys + archH * 0.42), Math.min(archH * 0.4, w * 0.2) * ppm]
    : style === 'gable' ? [X(0), Y(ys + archH * 0.38), archH * 0.34 * ppm] : [X(0), Y(h - w * 0.16), w * 0.12 * ppm];
  const textTop = style === 'arch' ? ys - h * 0.015 : style === 'gable' ? ys - h * 0.03 : slab ? h * 0.9 : h - w * 0.34;
  const L: FaceLayout = {
    W, H,
    box: [X(-w * 0.39), Y(textTop), w * 0.78 * ppm, (textTop - h * 0.07) * ppm],
    symbol: sym,
    frame: slab ? [X(-w * 0.45), Y(h * 0.94), w * 0.9 * ppm, h * 0.88 * ppm] : [X(-w * 0.44), Y(style === 'arch' ? ys + archH * 0.9 : textTop + h * 0.015), w * 0.88 * ppm, ((style === 'arch' ? ys + archH * 0.9 : textTop + h * 0.015) - h * 0.04) * ppm],
    crackLine: crackPts ? crackPts.map(([x, y]) => [X(x), Y(y)] as [number, number]) : undefined,
  };
  const face = inscribedFace(s, L, imgs);
  const front = kit.mat(face, { rough: s.stuff === 'basalt' || s.stuff === 'diorite' ? 0.62 : 0.88, normal: 1, env: 0.6 });
  const sidesT = plainFace(s.stuff, `${s.id}:side`, 256, 256, { fire: dm.fire });
  const side = kit.mat(sidesT, { rough: 0.9, repeat: true, env: 0.5 });
  const stone = new Group();
  pieces.forEach((pc, i) => {
    const pts = chipped(pc.pts, w / 24, `${s.id}:${i}`, dm.chips, w * 0.035, pc.keep);
    const geo = extrude(pts, d, Math.min(w, h) * 0.02, [-w / 2, 0, w / 2, h]);
    const m = new Mesh(geo, [front, side, side]);
    if (crackPts && i === 0) { m.rotation.z = 0.006; m.position.x = 0.003; }
    if (crackPts && i === 1) m.position.y = 0.004;
    stone.add(m);
  });
  const minY = Math.min(...bottom.map((p) => p[1]));
  if (dm.brokenLower) {
    // a broken stone stands on a modern steel mount
    const lift = 0.09;
    stone.position.y = lift - minY;
    const plate = new Mesh(new BoxGeometry(w * 0.9, 0.025, d * 1.6), kit.furniture('steel'));
    plate.position.y = 0.0125;
    g.add(plate);
    for (const sx of [-0.25, 0.25]) {
      const rod = new Mesh(new CylinderGeometry(0.008, 0.008, lift + 0.04, 10), kit.furniture('steel'));
      rod.position.set(sx * w, (lift + 0.04) / 2, 0);
      g.add(rod);
    }
  } else if (!slab) {
    // set into a low base block of rougher stone
    const bh = Math.min(0.12, h * 0.07);
    const base = new Mesh(roundedBox(w * 1.25, bh, d * 1.7, 0.01, 0, 18, true), kit.mat(plainFace(s.stuff, `${s.id}:base`, 128, 128), { rough: 0.95, color: '#b9b2a6', repeat: true }));
    base.position.y = bh / 2;
    g.add(base);
    stone.position.y = bh * 0.7;
  } else {
    const bh = 0.05;
    const base = new Mesh(new BoxGeometry(w * 0.8, bh, d * 2.2), kit.furniture('steel'));
    base.position.y = bh / 2;
    g.add(base);
    stone.position.y = bh;
  }
  g.add(stone);
}

// ---- rock relief: a boulder with a dressed panel cut into its face
function rock(s: ObjectSpec, g: Group, kit: Kit, imgs: Imgs, hi: number) {
  const [w, h, d] = s.dims;
  const R = rng(`rock:${s.id}`);
  const pts: P[] = [];
  const n = 30;
  const ph = [R() * 6.28, R() * 6.28, R() * 6.28];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.07 * Math.sin(a * 3 + ph[0]) + 0.05 * Math.sin(a * 5 + ph[1]) + 0.03 * Math.sin(a * 9 + ph[2]);
    const c = Math.cos(a), sn = Math.sin(a);
    const x = Math.sign(c) * Math.abs(c) ** 0.72 * (w / 2) * k;
    const y = h / 2 + Math.sign(sn) * Math.abs(sn) ** 0.72 * (h / 2) * k;
    pts.push([x, Math.max(0, y)]);
  }
  const sh = new Shape(pts.map(([x, y]) => new Vector2(x, y)));
  const bt = d * 0.3;
  const ex = new ExtrudeGeometry(sh, { depth: d - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: Math.min(w, h) * 0.08, bevelSegments: 3, steps: 2, curveSegments: 4 });
  ex.translate(0, 0, -(d - 2 * bt) / 2);
  const geo = regroup(ex, [-w / 2, 0, w / 2, h]);
  // weather the back and sides: displace them by noise, leaving the dressed face flat
  const pos = geo.getAttribute('position') as BufferAttribute;
  const zf = d / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const f = Math.max(0, Math.min(1, (zf - z) / (d * 0.25)));
    if (f <= 0) continue;
    const nx = x / (w / 2), ny = (y - h / 2) / (h / 2), nz = z / zf;
    const L = Math.hypot(nx, ny, nz) || 1;
    const amp = (vnoise(x * 2.2 + 7, y * 2.2, z * 2.2, s.seed) - 0.45) * Math.min(w, h) * 0.22 * f;
    pos.setXYZ(i, x + (nx / L) * amp, Math.max(0, y + (ny / L) * amp * (y < h * 0.15 ? 0.2 : 1)), z + (nz / L) * amp * 0.6);
  }
  geo.computeVertexNormals();
  const ppm = px(hi, Math.max(w, h));
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  const pw = w * 0.56, phh = h * 0.6;
  const px0 = (w - pw) / 2 * ppm, py0 = h * 0.16 * ppm;
  const face = inscribedFace(s, {
    W, H,
    panel: [px0, py0, pw * ppm, phh * ppm],
    box: [px0 + pw * ppm * 0.08, py0 + phh * ppm * 0.26, pw * ppm * 0.84, phh * ppm * 0.68],
    symbol: [W / 2, py0 + phh * ppm * 0.13, Math.min(pw, phh) * ppm * 0.1],
    frame: [px0 + pw * ppm * 0.03, py0 + phh * ppm * 0.03, pw * ppm * 0.94, phh * ppm * 0.94],
  }, imgs);
  const sideMat = kit.mat(plainFace(s.stuff, `${s.id}:rock`, hi >= 0.5 ? 512 : 256, hi >= 0.5 ? 512 : 256, { fire: s.dmg.fire }), { rough: 0.95, repeat: true, env: 0.4 });
  sideMat.flatShading = true;
  const m = new Mesh(geo, [kit.mat(face, { rough: 0.9, env: 0.5 }), sideMat, sideMat]);
  g.add(m);
}

// ---- inscribed brick, foundation tablet
function block(s: ObjectSpec, g: Group, kit: Kit, imgs: Imgs, hi: number) {
  const [w, h, d] = s.dims;
  const ppm = px(hi, Math.max(w, h), 1024);
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  const brick = s.family === 'brick';
  const face = inscribedFace(s, {
    W, H,
    box: brick ? [W * 0.2, H * 0.24, W * 0.6, H * 0.5] : [W * 0.1, H * 0.08, W * 0.8, H * 0.84],
    frame: brick ? [W * 0.16, H * 0.2, W * 0.68, H * 0.58] : undefined,
  }, imgs);
  const side = kit.mat(plainFace(s.stuff, `${s.id}:s`, 128, 128), { rough: 0.92, env: 0.5, repeat: true });
  const m = new Mesh(roundedBox(w, h, d, brick ? 0.01 : 0.006, brick ? 0.002 : 0.001), [kit.mat(face, { rough: brick ? 0.95 : 0.7, env: 0.6 }), side, side]);
  // stood up on a small steel easel, leaning back
  m.rotation.x = -0.12;
  m.position.set(0, h / 2 + 0.012, 0);
  g.add(m);
  const lip = new Mesh(new BoxGeometry(w * 0.7, 0.012, d * 2.2), kit.furniture('steel'));
  lip.position.set(0, 0.006, 0);
  g.add(lip);
  const back = new Mesh(new BoxGeometry(0.01, h * 0.6, 0.01), kit.furniture('steel'));
  back.position.set(0, h * 0.3, -d * 0.6 - h * 0.06);
  back.rotation.x = -0.12;
  g.add(back);
}

// ---- graffiti on plaster or on a statue base / column
function graffito(s: ObjectSpec, g: Group, kit: Kit, imgs: Imgs, hi: number) {
  const [w, h, d] = s.dims;
  const ppm = px(hi, w, 1024);
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  const face = inscribedFace(s, { W, H, box: [W * 0.12, H * 0.22, W * 0.76, H * 0.56] }, imgs);
  const side = kit.mat(plainFace(s.stuff, `${s.id}:s`, 128, 128, { fire: s.dmg.fire }), { rough: 0.95, repeat: true });
  const fm = kit.mat(face, { rough: 0.92, env: 0.5 });
  if (/column/.test(s.medium)) {
    const r = w * 0.42, ch = h * 1.5;
    const geo = new CylinderGeometry(r, r * 1.02, ch, hi >= 0.5 ? 64 : 32, 1, false, -Math.PI * 0.25, Math.PI * 0.5);
    // map the text onto the quarter of the drum that faces the viewer
    const col = new Mesh(new CylinderGeometry(r * 0.995, r * 1.015, ch, hi >= 0.5 ? 64 : 32), side);
    col.position.y = ch / 2;
    const front = new Mesh(geo, fm);
    front.position.y = ch / 2;
    front.scale.setScalar(1.002);
    g.add(col, front);
    return;
  }
  if (/statue base/.test(s.medium)) {
    const bh = h * 1.2, bd = w * 0.7;
    const m = new Mesh(roundedBox(w, bh, bd, 0.012), [fm, side, side]);
    m.position.y = bh / 2;
    g.add(m);
    // a moulding at the top and the feet of the lost statue
    const cap = new Mesh(roundedBox(w * 1.08, 0.05, bd * 1.08, 0.008), side);
    cap.position.y = bh + 0.025;
    g.add(cap);
    return;
  }
  // a fragment of plastered wall in a steel frame
  const R = rng(`frag:${s.id}`);
  const pts: P[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rx = w / 2 * (0.86 + R() * 0.14), ry = h / 2 * (0.86 + R() * 0.14);
    const c = Math.cos(a), sn = Math.sin(a);
    const k = 1 / Math.max(Math.abs(c), Math.abs(sn)) ** 0.6;
    pts.push([c * rx * Math.min(1.15, k * 0.8), h / 2 + sn * ry * Math.min(1.15, k * 0.8)]);
  }
  const m = new Mesh(extrude(pts, d, 0.004, [-w / 2, 0, w / 2, h]), [fm, side, side]);
  m.position.y = 0.06;
  g.add(m);
  const plate = new Mesh(new BoxGeometry(w * 0.6, 0.02, d * 2), kit.furniture('steel'));
  plate.position.y = 0.01;
  g.add(plate);
  const rod = new Mesh(new CylinderGeometry(0.006, 0.006, 0.07, 8), kit.furniture('steel'));
  rod.position.y = 0.04;
  g.add(rod);
}

// ---- metal plaques and tablets
function plaque(s: ObjectSpec, g: Group, kit: Kit, imgs: Imgs, hi: number) {
  const [w, h, d] = s.dims;
  const ppm = px(hi, h, 2048);
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  const face = inscribedFace(s, { W, H, box: [W * 0.11, H * 0.08, W * 0.78, H * 0.84], frame: [W * 0.06, H * 0.04, W * 0.88, H * 0.92] }, imgs);
  const metal = s.stuff;
  const fm = kit.mat(face, { rough: metal === 'silver' ? 0.38 : 0.48, metal: 0.85, env: 1.1, normal: 1 });
  const side = kit.mat(plainFace(metal as 'bronze', `${s.id}:s`, 64, 64), { rough: 0.45, metal: 0.9, repeat: true });
  const m = new Mesh(roundedBox(w, h, d, 0.004, 0, 12), [fm, side, side]);
  m.rotation.x = -0.16;
  m.position.set(0, h / 2 + 0.015, 0);
  g.add(m);
  // nail heads at the corners, as the plaque was fixed to a wall
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const nail = new Mesh(new CylinderGeometry(0.006, 0.007, 0.006, 12), side);
    nail.rotation.x = Math.PI / 2;
    nail.position.set(sx * w * 0.44, sy * h * 0.46, d / 2 + 0.002);
    m.add(nail);
  }
  const lip = new Mesh(new BoxGeometry(w * 0.8, 0.015, 0.06), kit.furniture('felt'));
  lip.position.set(0, 0.0075, 0.02);
  const back = new Mesh(new BoxGeometry(w * 0.3, h * 0.8, 0.01), kit.furniture('felt'));
  back.position.set(0, h * 0.4, -0.05 - h * 0.06);
  back.rotation.x = -0.16;
  g.add(lip, back);
}

// ---- clay tablets (one, several, or with an envelope)
function tabletMesh(s: ObjectSpec, kit: Kit, imgs: Imgs, hi: number, blocks?: Block[], dims = s.dims): Mesh {
  const [w, h, d] = dims;
  const ppm = px(hi, h, 1536);
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  const f = clayFaces({ ...s, blocks: blocks ?? s.blocks }, W, H, imgs, {});
  const edge = kit.mat(f.edge, { rough: 0.95, repeat: true, env: 0.5 });
  return new Mesh(roundedBox(w, h, d, Math.min(w, h) * 0.14, d * 0.16, hi >= 0.5 ? 22 : 14), [kit.mat(f.obverse, { rough: 0.93, env: 0.5 }), kit.mat(f.reverse, { rough: 0.93, env: 0.5 }), edge]);
}

function standFor(g: Group, kit: Kit, w: number, h: number, tilt: number) {
  const lip = new Mesh(new BoxGeometry(w * 0.9, 0.006, 0.03), kit.furniture('acrylic'));
  lip.position.set(0, 0.003, 0.012);
  const back = new Mesh(new BoxGeometry(w * 0.5, h * 0.7, 0.004), kit.furniture('acrylic'));
  back.position.set(0, h * 0.33, -Math.sin(tilt) * h * 0.5 - 0.012);
  back.rotation.x = -tilt;
  g.add(lip, back);
}

function tablets(s: ObjectSpec, g: Group, kit: Kit, imgs: Imgs, hi: number) {
  const [w, h, d] = s.dims;
  const tilt = 0.24;
  if (s.family === 'tablet') {
    const m = tabletMesh(s, kit, imgs, hi);
    m.rotation.x = -tilt;
    m.position.set(0, h / 2 * Math.cos(tilt) + 0.004, 0);
    g.add(m);
    standFor(g, kit, w, h, tilt);
    return;
  }
  // a set: the text split over three tablets, fanned out on the board
  const parts = splitBlocks(s.blocks, 3);
  const R = rng(`set:${s.id}`);
  parts.forEach((b, i) => {
    const k = 0.92 + R() * 0.12;
    const m = tabletMesh({ ...s, id: `${s.id}:${i}` }, kit, imgs, hi, b, [w * k, h * k, d]);
    m.rotation.set(-tilt, (i - 1) * 0.18, (i - 1) * -0.05);
    m.position.set((i - 1) * w * 1.08, h * k / 2 * Math.cos(tilt) + 0.004, -Math.abs(i - 1) * w * 0.25);
    g.add(m);
  });
  standFor(g, kit, w * 3, h, tilt);
}

function splitBlocks(bs: Block[], n: number): Block[][] {
  const total = blocksText(bs).length;
  const out: Block[][] = Array.from({ length: n }, () => []);
  let acc = 0;
  for (const b of bs) {
    const k = Math.min(n - 1, Math.floor((acc / Math.max(1, total)) * n));
    out[k].push(b);
    acc += blocksText([b]).length;
  }
  return out.map((x, i) => (x.length ? x : out[Math.max(0, i - 1)]));
}

function envelope(s: ObjectSpec, g: Group, kit: Kit, imgs: Imgs, hi: number) {
  const [w, h, d] = s.dims;
  // the envelope, sealed, standing behind; the tablet it held, in front
  const ew = w * 1.22, eh = h * 1.2, ed = d * 1.5;
  const ppm = px(hi, eh, 1024);
  const ef = envelopeFace(s, Math.round(ew * ppm), Math.round(eh * ppm), imgs);
  const em = kit.mat(ef, { rough: 0.95, env: 0.5 });
  const edge = kit.mat(plainFace('clay', `${s.id}:env`, 128, 128), { rough: 0.95, repeat: true, color: '#d8cbb5' });
  const env = new Mesh(roundedBox(ew, eh, ed, Math.min(ew, eh) * 0.2, ed * 0.22, hi >= 0.5 ? 22 : 14), [em, edge, edge]);
  env.rotation.set(-0.18, 0.28, 0);
  env.position.set(-w * 0.55, eh / 2 + 0.004, -d * 1.4);
  g.add(env);
  const t = tabletMesh(s, kit, imgs, hi);
  t.rotation.set(-0.3, -0.2, 0);
  t.position.set(w * 0.62, h / 2 * Math.cos(0.3) + 0.004, d * 0.8);
  g.add(t);
  standFor(g, kit, w * 2.6, h * 0.8, 0.3);
}

// ---- coins
function coin(s: ObjectSpec, g: Group, kit: Kit, imgs: Imgs, hi: number) {
  const [D, , T] = s.dims;
  const R = D / 2;
  const N = Math.max(128, Math.round(1024 * hi));
  const obv = coinFace(s, 'obverse', N, imgs), rev = coinFace(s, 'reverse', N, imgs);
  const c = s.coin!;
  const metalColour = c.metal === 'gold' ? METAL.gold : METAL.silver;
  const rough = c.metal === 'gold' ? 0.3 : 0.36 + s.dmg.weather * 0.15;
  const prof: Vector2[] = [];
  const t2 = T / 2;
  const steps = [[0, t2 * 0.78], [R * 0.86, t2 * 0.8], [R * 0.9, t2 * 0.98], [R * 0.95, t2], [R * 0.985, t2 * 0.8], [R, t2 * 0.35], [R * 1.005, 0]];
  for (const [r, y] of steps.slice().reverse()) prof.push(new Vector2(r, y));
  const half = (sign: 1 | -1, t: Tex) => {
    const geo = new LatheGeometry(prof.map((p) => new Vector2(p.x, p.y)), hi >= 0.5 ? 96 : 48);
    const pos = geo.getAttribute('position') as BufferAttribute;
    const uv = geo.getAttribute('uv') as BufferAttribute;
    const Rn = rng(`flan:${s.id}`);
    const ph = [Rn() * 6.28, Rn() * 6.28];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x), r = Math.hypot(x, z);
      // a hand-struck flan is never quite round
      const k = 1 + (r / R) ** 3 * (0.025 * Math.sin(a * 2 + ph[0]) + 0.015 * Math.sin(a * 3 + ph[1]));
      const nx = x * k, nz = z * k;
      pos.setXYZ(i, nx, y * sign, nz);
      uv.setXY(i, sign > 0 ? nx / (2 * R) + 0.5 : -nx / (2 * R) + 0.5, -nz / (2 * R) + 0.5);
    }
    if (sign < 0) { const idx = geo.getIndex()!; for (let k = 0; k < idx.count; k += 3) { const a = idx.getX(k); idx.setX(k, idx.getX(k + 1)); idx.setX(k + 1, a); } }
    geo.computeVertexNormals();
    const m = kit.mat(t, { rough, metal: 1, env: 0.75, color: '#ffffff' });
    void metalColour;
    return new Mesh(geo, m);
  };
  const coinG = new Group();
  coinG.add(half(1, obv), half(-1, rev));
  // stand the coin on edge, facing the viewer, in a small cradle
  coinG.rotation.x = Math.PI / 2 - 0.12;
  coinG.position.y = R + T * 0.6;
  const holder = new Group();
  holder.add(coinG);
  g.add(holder);
  const cradle = new Mesh(new BoxGeometry(D * 0.5, T * 2.2, T * 3.2), kit.furniture('acrylic'));
  cradle.position.set(0, T * 1.1, 0);
  g.add(cradle);
}

// ---- potsherd (ostracon)
function sherd(s: ObjectSpec, g: Group, kit: Kit, hi: number) {
  const [w, h, d] = s.dims;
  const R = rng(`sherd:${s.id}`);
  const pts: P[] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.3;
    pts.push([Math.cos(a) * w / 2 * (0.8 + R() * 0.25), h / 2 + Math.sin(a) * h / 2 * (0.78 + R() * 0.25)]);
  }
  const ppm = px(hi, Math.max(w, h), 1024);
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  const ps: PaperStyle = { base: STONE.terracotta.base, ink: '#1c1612', rubric: '#a3341f', font: HAND, weight: 500, fibres: 'news' };
  const sh = sheet({ ...s, era: 2 }, `${s.id}:sh`, W, H, ps);
  const a = sh.a;
  a.fillStyle = STONE.terracotta.base; a.fillRect(0, 0, W, H);
  const pl = plainFace('terracotta', `${s.id}:t`, W, H);
  a.drawImage(pl.map, 0, 0);
  const res = writeBlocks(a, s.blocks, { ...ps, rubric: ps.ink }, { x: W * 0.14, y: H * 0.14, w: W * 0.72, h: H * 0.72, size: fitSz(a, s.blocks, W * 0.72, H * 0.72, HAND, 1.15), lead: 1.15, font: HAND });
  void res;
  const fm = kit.mat({ map: sh.map, normal: pl.normal }, { rough: 0.9, env: 0.5 });
  const side = kit.mat(plainFace('terracotta', `${s.id}:e`, 64, 64), { rough: 0.95, color: '#c98a64', repeat: true });
  const geo = extrude(pts, d, 0.0015, [-w / 2, 0, w / 2, h]);
  // bend it: a piece of a jar's wall
  const Rr = w * 1.1;
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const ang = x / Rr, rad = Rr + z;
    pos.setXYZ(i, Math.sin(ang) * rad, pos.getY(i), Math.cos(ang) * rad - Rr);
  }
  geo.computeVertexNormals();
  const m = new Mesh(geo, [fm, side, side]);
  m.rotation.x = -0.12;
  m.position.y = 0.012;
  g.add(m);
  standFor(g, kit, w, h, 0.12);
}

function fitSz(a: CanvasRenderingContext2D, bs: Block[], w: number, h: number, font: string, lead: number): number {
  const runsAll = bs.flatMap((b) => [...b.runs, { s: ' ' }]);
  return fitSize(a, runsAll, w, h * 0.92, font, lead * 1.06, 6, h / 4);
}

// ---- wax tablet (diptych)
function wax(s: ObjectSpec, g: Group, kit: Kit, hi: number) {
  const [w, h, d] = s.dims;
  const parts = splitBlocks(s.blocks, 2);
  const ppm = px(hi, h, 1024);
  const iw = w * 0.84, ih = h * 0.86;
  const W = Math.round(iw * ppm), H = Math.round(ih * ppm);
  const wood = kit.mat(woodFace(`${s.id}:wood`), { rough: 0.7, repeat: true });
  const tilt = 0.75;
  const board = new Group();
  parts.forEach((b, i) => {
    const map = canvas(W, H), hgt = canvas(W, H);
    const a = ctxOf(map), hh = ctxOf(hgt);
    a.fillStyle = STONE.wax.base; a.fillRect(0, 0, W, H);
    hh.fillStyle = '#808080'; hh.fillRect(0, 0, W, H);
    // the stylus scratches through the dark wax to the pale wood
    const ps: PaperStyle = { base: STONE.wax.base, ink: '#c9a77c', rubric: '#c9a77c', font: HAND, weight: 500, fibres: 'news' };
    const size = fitSz(a, b, W * 0.86, H * 0.86, HAND, 1.12);
    const mask = canvas(W, H), mc = ctxOf(mask);
    writeBlocks(mc, b, { ...ps, ink: '#ffffff', rubric: '#ffffff' }, { x: W * 0.07, y: H * 0.06, w: W * 0.86, h: H * 0.86, size, lead: 1.12, font: HAND });
    const tinted = canvas(W, H), tc = ctxOf(tinted);
    tc.drawImage(mask, 0, 0); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = ps.ink; tc.fillRect(0, 0, W, H);
    a.drawImage(tinted, 0, 0);
    drawBlurred(hh, mask, Math.max(0.6, size * 0.04), 'rgba(0,0,0,0.6)');
    const fm = kit.mat({ map, normal: finishWax(hgt) }, { rough: 0.45, env: 0.7 });
    const leaf = new Group();
    const back = new Mesh(roundedBox(w, h, d * 0.55, 0.003, 0, 8), wood);
    back.position.z = -d * 0.275;
    const panel = new Mesh(new PlaneGeometry(iw, ih), fm);
    panel.userData.thin = true;
    panel.position.z = 0.0008;
    // the raised rim of the frame around the waxed recess
    const rimT = (w - iw) / 2, rimB = (h - ih) / 2;
    for (const [x, y, ww, hh2] of [[0, h / 2 - rimB / 2, w, rimB], [0, -h / 2 + rimB / 2, w, rimB], [-w / 2 + rimT / 2, 0, rimT, ih], [w / 2 - rimT / 2, 0, rimT, ih]] as const) {
      const r = new Mesh(roundedBox(ww, hh2, d * 0.45, 0.0015, 0, 4), wood);
      r.position.set(x, y, d * 0.225);
      leaf.add(r);
    }
    leaf.add(back, panel);
    leaf.position.x = (i - 0.5) * (w + 0.006);
    board.add(leaf);
  });
  board.rotation.x = -Math.PI / 2 + tilt;
  board.position.set(0, h / 2 * Math.sin(tilt) + 0.01, 0);
  g.add(board);
  const easel = new Mesh(new BoxGeometry(w * 2.2, 0.012, 0.03), kit.furniture('felt'));
  easel.position.set(0, 0.006, h / 2 * Math.cos(tilt) * 0.9);
  g.add(easel);
}
function finishWax(hgt: Cv): Cv {
  // a small inline normal map (the wax has no grain worth a texture of its own)
  return finishSimple(hgt, 5);
}
function finishSimple(hgt: Cv, k: number): Cv {
  const w = hgt.width, h = hgt.height;
  const H = ctxOf(hgt).getImageData(0, 0, w, h).data;
  const out = canvas(w, h), oc = ctxOf(out), N = oc.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * (y * w + x);
    const gx = (H[4 * (y * w + Math.min(w - 1, x + 1))] - H[4 * (y * w + Math.max(0, x - 1))]) / 255 * k;
    const gy = (H[4 * (Math.min(h - 1, y + 1) * w + x)] - H[4 * (Math.max(0, y - 1) * w + x)]) / 255 * k;
    const inv = 1 / Math.hypot(gx, gy, 1);
    N.data[i] = (-gx * inv * 0.5 + 0.5) * 255; N.data[i + 1] = (gy * inv * 0.5 + 0.5) * 255; N.data[i + 2] = (inv * 0.5 + 0.5) * 255; N.data[i + 3] = 255;
  }
  oc.putImageData(N, 0, 0);
  return out;
}

// ---- writing on sheets: shared page layouts
function pageText(s: ObjectSpec, label: string, W: number, H: number, ps: PaperStyle, draw: (a: CanvasRenderingContext2D, lacs: [number, number, number][]) => number): Tex {
  const sh = sheet(s, label, W, H, ps);
  const lacs: [number, number, number][] = [];
  const size = draw(sh.a, lacs);
  const alpha = sheetDamage(s, label, sh.a, lacs, size);
  return sheetTex(sh.map, sh.hgt, alpha);
}

/** A slanted board, felt-covered, for paper to lie on. Returns the group to put the sheet in (local y up = board normal). */
function board(g: Group, kit: Kit, w: number, h: number, tilt: number, colour = '#3b403d'): Group {
  const b = new Mesh(new BoxGeometry(w, 0.02, h), kit.furniture('felt', colour));
  const holder = new Group();
  holder.rotation.x = tilt;
  holder.position.set(0, Math.sin(tilt) * h / 2 + 0.02, 0);
  b.position.y = -0.011;
  holder.add(b);
  const zl = -Math.cos(tilt) * h / 2 + 0.03;
  const legH = Math.max(0.01, Math.sin(tilt) * h + 0.02 - 0.022 * Math.cos(tilt) - 0.03 * Math.tan(tilt) - 0.004);
  const leg = new Mesh(new BoxGeometry(w * 0.9, legH, 0.015), kit.furniture('felt', colour));
  leg.position.set(0, legH / 2, zl);
  g.add(holder, leg);
  return holder;
}

/** A sheet lying on its board: a plane with a gentle curl, the text side up. v=1 (the canvas top) at the far edge. */
function sheetMesh(w: number, h: number, mat: Material, back: Material, curl: number, seg = 24): Group {
  const geo = new PlaneGeometry(w, h, seg, seg);
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, curl * ((x / (w / 2)) ** 4 * 0.6 + (y / (h / 2)) ** 6 * 0.4) + Math.sin(x * 9 + y * 5) * curl * 0.08);
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  const out = new Group();
  const front = new Mesh(geo, mat);
  const rear = new Mesh(geo, back);
  front.userData.thin = true;
  out.add(front, rear);
  out.position.y = 0.0015;
  return out;
}

// ---- scrolls
function scroll(s: ObjectSpec, g: Group, kit: Kit, hi: number) {
  const ps = paperStyle(s);
  const H = s.dims[1];
  const open = 0.5, total = open + 0.62;
  const ppm = px(hi, total, 2048);
  const CW = Math.round(total * ppm), CH = Math.round(H * ppm);
  const leftRoll = 0.16;
  // the recto: columns of text across the open stretch
  const recto = pageText(s, `${s.id}:recto`, CW, CH, ps, (a, lacs) => {
    const colW = 0.15 * ppm, gap = 0.035 * ppm;
    const x0 = leftRoll * ppm + gap;
    const n = Math.max(1, Math.floor((open * ppm - gap) / (colW + gap)));
    const size = Math.max(CH * 0.028, Math.min(CH * 0.05, fitSz(a, s.blocks, colW * n, CH * 0.8, ps.font, 1.3) * 1.0));
    const r = writeBlocks(a, s.blocks, ps, { x: x0, y: CH * 0.1, w: n * (colW + gap) - gap, h: CH * 0.78, size, lead: 1.3, columns: n, gap, justify: false });
    lacs.push(...r.lacs);
    return size;
  });
  const verso = sheet(s, `${s.id}:verso`, 256, 128, ps);
  const vm = kit.mat(sheetTex(verso.map, verso.hgt, false), { rough: 0.95, side: BackSide, repeat: true });
  const rm = kit.mat(recto, { rough: 0.92, side: FrontSide });
  // the strip: rolled at both ends (a small roll at the start, the unread rest at the end)
  const segs = hi >= 0.5 ? 220 : 110;
  const pts: number[] = [], uvs: number[] = [], idx: number[] = [];
  const rollA = 0.024, rollB = 0.04;
  const sOpen0 = leftRoll, sOpen1 = leftRoll + open;
  const path: [number, number][] = [];
  {
    // left roll: s from 0 to leftRoll winds the other way
    let x = -open / 2, y = 0;
    const place = (sv: number): [number, number] => {
      if (sv >= sOpen0 && sv <= sOpen1) return [x + (sv - sOpen0), 0];
      if (sv > sOpen1) {
        let phi = 0, r = rollB, ss = sOpen1;
        const step = 0.002;
        while (ss + step <= sv) { phi += step / r; r = Math.max(0.008, rollB - 0.0015 * phi); ss += step; }
        return [open / 2 + r * Math.sin(phi), rollB - r * Math.cos(phi) + (rollB - r) * 0];
      }
      let phi = 0, r = rollA, ss = sOpen0;
      const step = 0.002;
      while (ss - step >= sv) { phi += step / r; r = Math.max(0.007, rollA - 0.0012 * phi); ss -= step; }
      return [x - r * Math.sin(phi), rollA - r * Math.cos(phi)];
    };
    for (let i = 0; i <= segs; i++) { const sv = (i / segs) * total; path.push(place(sv)); }
    void y;
  }
  for (let i = 0; i <= segs; i++) {
    const [x, y] = path[i];
    for (const z of [-H / 2, H / 2]) { pts.push(x, y, z); uvs.push(i / segs, z < 0 ? 1 : 0); }
  }
  for (let i = 0; i < segs; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const strip = new Group();
  const rectoMesh = new Mesh(geo, rm);
  rectoMesh.userData.thin = true;
  strip.add(rectoMesh, new Mesh(geo, vm));
  const holder = board(g, kit, total * 0.82, H * 1.12, 0.5);
  strip.position.set(0, 0.002, 0);
  holder.add(strip);
}

// ---- a charter with hanging seals
function charter(s: ObjectSpec, g: Group, kit: Kit, imgs: Imgs, hi: number) {
  const [w, h] = s.dims;
  const ps = paperStyle(s);
  const ppm = px(hi, w, 2048);
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  const tex = pageText(s, `${s.id}:ch`, W, H, ps, (a, lacs) => {
    const body = s.blocks;
    const size = Math.max(H * 0.016, fitSz(a, body, W * 0.84, H * 0.7, ps.font, 1.32) * 0.94);
    const r = writeBlocks(a, body, ps, { x: W * 0.08, y: H * 0.06, w: W * 0.84, h: H * 0.78, size, lead: 1.3, initial: true, justify: true });
    lacs.push(...r.lacs);
    // the plica's fold line
    a.fillStyle = 'rgba(90,60,30,0.25)'; a.fillRect(0, H * 0.86, W, Math.max(1, H * 0.004));
    return size;
  });
  const back = sheet(s, `${s.id}:bk`, 128, 128, ps);
  const sheetG = new Group();
  const geo = new PlaneGeometry(w, h, 20, 14);
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 14) * 0.0008 + Math.sin(pos.getY(i) * 19 + pos.getX(i) * 3) * 0.0005);
  geo.computeVertexNormals();
  const face = new Mesh(geo, kit.mat(tex, { rough: 0.9 }));
  face.userData.thin = true;
  sheetG.add(face, new Mesh(geo, kit.mat(sheetTex(back.map, back.hgt, false), { rough: 0.9, side: BackSide })));
  // the plica: the foot turned up and stitched through by the seal cords
  const plica = new Mesh(new BoxGeometry(w, h * 0.12, 0.002), kit.mat(sheetTex(back.map, back.hgt, false), { rough: 0.9 }));
  plica.position.set(0, -h / 2 + h * 0.06, 0.0025);
  sheetG.add(plica);
  const seals = Math.max(1, Math.min(4, s.parties.length || 1));
  const lift = 0.2;
  sheetG.position.y = lift + h / 2;
  sheetG.rotation.x = -0.08;
  g.add(sheetG);
  const backboard = new Mesh(new BoxGeometry(w * 1.25, h + lift + 0.06, 0.02), kit.furniture('felt', '#2a2c33'));
  backboard.position.set(0, (h + lift + 0.06) / 2, -0.03);
  backboard.rotation.x = -0.08;
  g.add(backboard);
  for (let i = 0; i < seals; i++) {
    const party = s.parties[i] ?? s.issuer ?? '';
    const colour = stateColour(s, party) ?? '#8e2a1e';
    const wax = colour === '#28231f' ? '#3a2a20' : colour === '#d6a634' || colour === '#f2eee5' ? '#9a6a2a' : mixWax(colour);
    const x = (seals === 1 ? 0 : (i / (seals - 1) - 0.5) * w * 0.6);
    const sr = Math.min(0.045, w * 0.1);
    const N = Math.max(96, Math.round(512 * hi));
    const face = sealFace(wax, imgs.arms.get(party) ?? null, N, `${s.id}:${i}`);
    const disc = new Mesh(new CylinderGeometry(sr, sr * 1.03, 0.012, 40), [kit.mat(plainFace('clay', `${s.id}:sealedge${i}`, 32, 32, { colour: wax }), { rough: 0.55 }), kit.mat(face, { rough: 0.5, env: 0.8 }), kit.mat(face, { rough: 0.5 })]);
    disc.rotation.x = Math.PI / 2 - 0.08;
    const sy = lift - sr - 0.035 - (i % 2) * 0.012;
    disc.position.set(x, sy, 0.012);
    g.add(disc);
    // the cord from the plica to the seal
    const curve = new CatmullRomCurve3([new Vector3(x - 0.006, lift + 0.02, 0.006), new Vector3(x - 0.01, (lift + sy) / 2 + 0.01, 0.012), new Vector3(x, sy + sr * 0.8, 0.012)]);
    const cord = new Mesh(new TubeGeometry(curve, 12, 0.0018, 6), kit.furniture('wood', i % 2 ? '#7a5a2a' : '#5a6b3a'));
    g.add(cord);
    const curve2 = new CatmullRomCurve3([new Vector3(x + 0.006, lift + 0.02, 0.006), new Vector3(x + 0.01, (lift + sy) / 2, 0.012), new Vector3(x + 0.002, sy + sr * 0.8, 0.012)]);
    g.add(new Mesh(new TubeGeometry(curve2, 12, 0.0018, 6), cord.material));
  }
}
function mixWax(c: string): string {
  // sealing wax is a resin: a state's colour, deepened
  const n = parseInt(c.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.round(v * 0.78).toString(16).padStart(2, '0');
  return `#${f(r)}${f(gg)}${f(b)}`;
}
function sealFace(wax: string, img: HTMLImageElement | null, N: number, label: string): Tex {
  const map = canvas(N, N), hgt = canvas(N, N);
  const a = ctxOf(map), h = ctxOf(hgt);
  a.fillStyle = wax; a.fillRect(0, 0, N, N);
  const g = a.createRadialGradient(N * 0.4, N * 0.35, 0, N / 2, N / 2, N * 0.55);
  g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
  a.fillStyle = g; a.fillRect(0, 0, N, N);
  h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);
  // the matrix pressed into the wax: a ring and the arms
  h.strokeStyle = 'rgba(0,0,0,0.5)'; h.lineWidth = N * 0.025; h.beginPath(); h.arc(N / 2, N / 2, N * 0.4, 0, Math.PI * 2); h.stroke();
  h.strokeStyle = 'rgba(255,255,255,0.4)'; h.lineWidth = N * 0.05; h.beginPath(); h.arc(N / 2, N / 2, N * 0.47, 0, Math.PI * 2); h.stroke();
  if (img) {
    const t = canvas(N, N);
    const tc = ctxOf(t);
    tc.drawImage(img, N * 0.28, N * 0.24, N * 0.44, N * 0.53);
    const im = tc.getImageData(0, 0, N, N);
    for (let i = 0; i < im.data.length; i += 4) { const l = (im.data[i] * 0.3 + im.data[i + 1] * 0.59 + im.data[i + 2] * 0.11) / 255; const al = im.data[i + 3] / 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = al * (0.35 + l * 0.65) * 255; }
    tc.putImageData(im, 0, 0);
    drawBlurred(h, t, N * 0.004, 'rgba(255,255,255,0.5)');
  }
  void label;
  return { map, normal: finishSimple(hgt, 8) };
}

// ---- codices and printed books
function codex(s: ObjectSpec, g: Group, kit: Kit, hi: number) {
  const [W2, h] = s.dims;
  const pw = W2 / 2;
  const ps = paperStyle(s);
  const ppm = px(hi, W2, 2048);
  const CW = Math.round(W2 * ppm), CH = Math.round(h * ppm);
  const printed = /print|typescript|report|proceedings|volume|book$|book chapter|^book/.test(s.medium) || s.era >= 4;
  const tex = pageText(s, `${s.id}:spread`, CW, CH, ps, (a, lacs) => {
    const P = CW / 2;
    const m = P * 0.12;
    let size = 0;
    if (s.ledger) {
      size = ledgerSpread(a, s, ps, CW, CH);
    } else if (printed && s.family === 'codex') {
      // a title page on the left, the text beginning on the right
      a.fillStyle = ps.ink;
      const tsz = CH * 0.045;
      const tl = wrap(a, [{ s: s.title.toUpperCase(), b: true }], P * 0.72, ps.font, tsz, 600);
      let y = CH * 0.26;
      for (const ln of tl) { drawLine(a, ln, P / 2 - ln.w / 2, y, { color: ps.ink }); y += tsz * 1.3; }
      a.fillStyle = ps.rubric; a.fillRect(P * 0.4, y, P * 0.2, Math.max(1, CH * 0.003)); y += CH * 0.06;
      a.font = `italic 500 ${CH * 0.026}px ${ps.font}`; a.fillStyle = ps.ink;
      for (const t of [s.language && `In ${s.language}`, s.date].filter(Boolean) as string[]) { for (const ln of wrap(a, [{ s: t, i: true }], P * 0.7, ps.font, CH * 0.026)) { drawLine(a, ln, P / 2 - ln.w / 2, y, { color: ps.ink }); y += CH * 0.036; } }
      size = Math.max(CH * 0.017, Math.min(CH * 0.028, fitSz(a, s.blocks, P - m * 2, CH * 0.8, ps.font, 1.32)));
      const r = writeBlocks(a, s.blocks, ps, { x: P + m, y: CH * 0.09, w: P - m * 2, h: CH * 0.8, size, lead: 1.32, justify: true, centerHeads: true, headCaps: true });
      lacs.push(...r.lacs);
    } else {
      size = Math.max(CH * 0.017, Math.min(CH * 0.03, fitSz(a, s.blocks, (P - m * 2) * 2, CH * 0.78, ps.font, 1.3)));
      const r = writeBlocks(a, s.blocks, ps, { x: m, y: CH * 0.1, w: CW - m * 2, h: CH * 0.78, size, lead: 1.3, columns: 2, gap: m * 2, initial: true, justify: true });
      lacs.push(...r.lacs);
    }
    // the gutter's shadow
    const gr = a.createLinearGradient(P - P * 0.12, 0, P + P * 0.12, 0);
    gr.addColorStop(0, 'rgba(70,50,30,0)'); gr.addColorStop(0.5, 'rgba(70,50,30,0.32)'); gr.addColorStop(1, 'rgba(70,50,30,0)');
    a.fillStyle = gr; a.fillRect(P - P * 0.12, 0, P * 0.24, CH);
    return size;
  });
  const pageMat = kit.mat(tex, { rough: 0.92 });
  // the page block: a surface rising from the gutter and falling to the fore-edges
  const T = Math.min(0.035, 0.012 + blocksText(s.blocks).length / 200000) * (s.dmg.leaves ? 0.75 : 1);
  const nx = hi >= 0.5 ? 64 : 32, ny = 8;
  const prof = (u: number) => {
    const xn = Math.abs(u - 0.5) * 2;
    const rise = Math.sin(Math.min(1, xn / 0.16) * Math.PI / 2);
    return T * (0.25 + 0.75 * rise) * (1 - 0.25 * Math.max(0, xn - 0.16)) + (xn > 0.97 ? -(xn - 0.97) * T * 4 : 0);
  };
  const P: number[] = [], U: number[] = [], I: number[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / ny;
    P.push((u - 0.5) * W2, prof(u), (0.5 - v) * h);
    U.push(u, v);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; I.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1); }
  const top = new BufferGeometry();
  top.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  top.setAttribute('uv', new BufferAttribute(new Float32Array(U), 2));
  top.setIndex(I);
  top.computeVertexNormals();
  // edges of the block (head, tail, fore-edges): fine page lines
  const edgeCv = canvas(64, 64), ec = ctxOf(edgeCv);
  ec.fillStyle = ps.base; ec.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 2) { ec.fillStyle = 'rgba(90,70,40,0.25)'; ec.fillRect(0, y, 64, 1); }
  const edgeMat = kit.mat({ map: edgeCv, normal: null }, { rough: 0.95, side: DoubleSide });
  const walls: number[] = [], wu: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { walls.push(...a, ...b, ...c, ...a, ...c, ...d); wu.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1); };
  for (const zs of [h / 2, -h / 2]) for (let i = 0; i < nx; i++) {
    const u0 = i / nx, u1 = (i + 1) / nx;
    const x0 = (u0 - 0.5) * W2, x1 = (u1 - 0.5) * W2;
    if (zs > 0) quad([x0, 0, zs], [x1, 0, zs], [x1, prof(u1), zs], [x0, prof(u0), zs]);
    else quad([x1, 0, zs], [x0, 0, zs], [x0, prof(u0), zs], [x1, prof(u1), zs]);
  }
  quad([-W2 / 2, 0, -h / 2], [-W2 / 2, 0, h / 2], [-W2 / 2, prof(0), h / 2], [-W2 / 2, prof(0), -h / 2]);
  quad([W2 / 2, 0, h / 2], [W2 / 2, 0, -h / 2], [W2 / 2, prof(1), -h / 2], [W2 / 2, prof(1), h / 2]);
  const wg = new BufferGeometry();
  wg.setAttribute('position', new BufferAttribute(new Float32Array(walls), 3));
  wg.setAttribute('uv', new BufferAttribute(new Float32Array(wu), 2));
  wg.computeVertexNormals();
  const book = new Group();
  const pages = new Mesh(top, pageMat);
  pages.userData.thin = true;
  book.add(pages, new Mesh(wg, edgeMat));
  // the binding: boards in leather dyed in the state's colour (vellum before print), a little larger than the leaves
  const dyed = stateColour(s);
  const leather = printed ? (dyed ? mixColour(dyed, '#4a3020', 0.45) : '#5a3a24') : s.stuff === 'parchment' ? '#d9c9a3' : '#6a4a2c';
  const coverMat = kit.mat(plainFace('sandstone', `${s.id}:cov`, 128, 128, { colour: leather }), { rough: 0.7, color: '#e8e2da', repeat: true });
  for (const sx of [-1, 1]) {
    const c = new Mesh(roundedBox(pw + 0.012, 0.006, h + 0.016, 0.0025, 0, 6), coverMat);
    c.position.set(sx * (pw / 2 + 0.004), -0.003, 0);
    c.rotation.z = sx * -0.025;
    book.add(c);
  }
  const holder = board(g, kit, W2 * 1.05, h * 1.08, 0.42);
  book.position.y = 0.006;
  holder.add(book);
}

function ledgerSpread(a: CanvasRenderingContext2D, s: ObjectSpec, ps: PaperStyle, CW: number, CH: number): number {
  const L = s.ledger!;
  const cols = L.columns;
  const m = CW * 0.05;
  const width = CW - m * 2;
  const size = CH * 0.024;
  const lineH = size * 1.7;
  // the opening note, then ruled columns across the spread
  const head = writeBlocks(a, s.blocks.slice(0, 2), ps, { x: m, y: CH * 0.06, w: width, h: CH * 0.16, size: size * 1.05, lead: 1.3, columns: 2, gap: m * 2 });
  let y = Math.max(CH * 0.24, head.y + size);
  a.font = `600 ${size}px ${ps.font}`;
  const weights = cols.map((c, i) => Math.max(c.length, ...L.rows.map((r) => (r[i] ?? '').length)) + 2);
  const tot = weights.reduce((x, y2) => x + y2, 0);
  const xs: number[] = [];
  let acc = m;
  for (const wgt of weights) { xs.push(acc); acc += (wgt / tot) * width; }
  a.strokeStyle = 'rgba(150,40,30,0.5)'; a.lineWidth = Math.max(1, CH * 0.0015);
  for (const x of xs.slice(1)) { a.beginPath(); a.moveTo(x - size * 0.3, y - size * 1.2); a.lineTo(x - size * 0.3, CH * 0.92); a.stroke(); }
  a.fillStyle = ps.ink;
  cols.forEach((c, i) => { a.font = `700 ${size}px ${ps.font}`; a.fillText(c, xs[i], y); });
  y += lineH;
  a.strokeStyle = 'rgba(60,80,120,0.25)';
  for (const r of L.rows) {
    if (y > CH * 0.92) break;
    r.forEach((c, i) => { a.font = `500 ${size}px ${ps.font}`; let t = c; const maxW = (weights[i] / tot) * width - size * 0.6; while (a.measureText(t).width > maxW && t.length > 2) t = t.slice(0, -2) + '…'; a.fillText(t, xs[i], y); });
    a.beginPath(); a.moveTo(m, y + size * 0.45); a.lineTo(CW - m, y + size * 0.45); a.stroke();
    y += lineH;
  }
  return size;
}

// ---- sheets, newspapers, telegrams
function flat(s: ObjectSpec, g: Group, kit: Kit, hi: number) {
  const [w, h] = s.dims;
  const ps = paperStyle(s);
  const ppm = px(hi, Math.max(w, h), 2048);
  const W = Math.round(w * ppm), H = Math.round(h * ppm);
  let tex: Tex;
  if (s.family === 'newspaper' && s.news) tex = pageText(s, `${s.id}:np`, W, H, ps, (a, lacs) => newspaper(a, s, ps, W, H, lacs));
  else if (s.family === 'telegram') tex = pageText(s, `${s.id}:tg`, W, H, ps, (a) => telegram(a, s, W, H));
  else tex = pageText(s, `${s.id}:sh`, W, H, ps, (a, lacs) => {
    const m = W * 0.11;
    const mono = ps.font === MONO;
    const size = Math.max(H * 0.012, Math.min(H * (mono ? 0.022 : 0.026), fitSz(a, s.blocks, W - m * 2, H * 0.8, ps.font, mono ? 1.5 : 1.35)));
    const r = writeBlocks(a, s.blocks, ps, { x: m, y: H * 0.08, w: W - m * 2, h: H * 0.84, size, lead: mono ? 1.5 : 1.35, justify: !mono, centerHeads: true, headCaps: s.era >= 4 });
    lacs.push(...r.lacs);
    return size;
  });
  const back = sheet(s, `${s.id}:b`, 128, 128, ps);
  const mat = kit.mat(tex, { rough: 0.93 });
  const bm = kit.mat(sheetTex(back.map, back.hgt, false), { rough: 0.93, side: BackSide });
  const holder = board(g, kit, w * 1.06, h * 1.05, 0.62);
  holder.add(sheetMesh(w, h, mat, bm, s.family === 'newspaper' ? 0.006 : 0.004));
}

function newspaper(a: CanvasRenderingContext2D, s: ObjectSpec, ps: PaperStyle, W: number, H: number, lacs: [number, number, number][]): number {
  const n = s.news!;
  const m = W * 0.06;
  const ink = ps.ink;
  // masthead
  let y = H * 0.03;
  const msz = fitSize(a, [{ s: n.masthead, b: true }], W - m * 2, H * 0.09, SERIF, 1.0, 10, H * 0.08, 700);
  a.font = `700 ${msz}px ${SERIF}`;
  a.fillStyle = ink;
  a.textAlign = 'center';
  y += msz;
  a.fillText(n.masthead, W / 2, y);
  y += msz * 0.32;
  a.fillRect(m, y, W - m * 2, Math.max(2, H * 0.004));
  y += H * 0.024;
  a.font = `500 ${H * 0.016}px ${SERIF}`;
  a.fillText(n.dateline.join('   ·   '), W / 2, y);
  y += H * 0.012;
  a.fillRect(m, y, W - m * 2, Math.max(1, H * 0.0015));
  a.fillRect(m, y + H * 0.004, W - m * 2, Math.max(1, H * 0.0015));
  y += H * 0.03;
  a.textAlign = 'left';
  // headline
  const hsz = Math.min(H * 0.06, fitSize(a, [{ s: n.headline, b: true }], W - m * 2, H * 0.12, SERIF, 1.1, 10, H * 0.06, 700));
  for (const ln of wrap(a, [{ s: n.headline, b: true }], W - m * 2, SERIF, hsz, 700)) { y += hsz; drawLine(a, ln, W / 2 - ln.w / 2, y, { color: ink }); y += hsz * 0.15; }
  y += H * 0.02;
  // the story in two columns, the markets in a box at the foot
  const cols = blocksText(n.paras).length > 500 ? 2 : 1;
  const size = Math.max(H * 0.014, Math.min(H * 0.026, fitSz(a, n.paras, (W - m * 2) * (cols === 2 ? 1.9 : 1), H * 0.4, SERIF, 1.32)));
  const r = writeBlocks(a, n.paras, ps, { x: m, y, w: W - m * 2, h: H - y - H * 0.14, size, lead: 1.32, columns: cols, gap: m, justify: true });
  lacs.push(...r.lacs);
  a.fillStyle = 'rgba(0,0,0,0.6)';
  if (cols === 2) a.fillRect(W / 2 - 0.5, y, Math.max(1, W * 0.001), Math.min(r.y, H * 0.84) - y);
  if (n.footer) {
    const fy = Math.min(H * 0.86, Math.max(r.y + size, H * 0.6));
    a.strokeStyle = ink; a.lineWidth = Math.max(1, H * 0.0015);
    a.strokeRect(m, fy, W - m * 2, H * 0.08);
    writeBlocks(a, [{ k: 'p', runs: [{ s: n.footer, i: true }] }], ps, { x: m * 1.4, y: fy + H * 0.008, w: W - m * 2.8, h: H * 0.07, size: size * 1.05, lead: 1.3 });
  }
  return size;
}

function telegram(a: CanvasRenderingContext2D, s: ObjectSpec, W: number, H: number): number {
  const m = W * 0.06;
  a.fillStyle = '#5a5248';
  a.font = `700 ${H * 0.07}px ${SANS}`;
  a.textAlign = 'center';
  a.fillText('TELEGRAM', W / 2, H * 0.12);
  a.textAlign = 'left';
  a.strokeStyle = 'rgba(90,82,72,0.6)'; a.lineWidth = Math.max(1, H * 0.004);
  a.strokeRect(m, H * 0.17, W - m * 2, H * 0.74);
  a.beginPath(); a.moveTo(m, H * 0.3); a.lineTo(W - m, H * 0.3); a.stroke();
  // the record's header line and message, typed on paper tape strips pasted down
  const blocks = s.blocks;
  const head = blocks[0]?.runs.map((r) => r.s).join('') ?? '';
  a.fillStyle = '#24242a';
  a.font = `600 ${H * 0.045}px ${MONO}`;
  const hl = wrap(a, [{ s: head }], W - m * 2.6, MONO, H * 0.045, 600);
  hl.slice(0, 2).forEach((ln, i) => drawLine(a, ln, m * 1.3, H * 0.235 + i * H * 0.05, { color: '#24242a' }));
  const msg = blocks.slice(1).map((b) => b.runs.map((r) => r.s).join('')).join(' ');
  const size = H * 0.042;
  const lines = wrap(a, [{ s: msg }], W - m * 3, MONO, size, 600);
  let y = H * 0.36;
  for (const ln of lines.slice(0, 9)) {
    a.fillStyle = 'rgba(248,244,230,0.95)';
    a.fillRect(m * 1.2, y - size * 1.0, ln.w + m * 0.6, size * 1.35);
    a.fillStyle = 'rgba(0,0,0,0.12)';
    a.fillRect(m * 1.2, y + size * 0.35, ln.w + m * 0.6, Math.max(1, size * 0.05));
    drawLine(a, ln, m * 1.5, y, { color: '#1f1f24' });
    y += size * 1.6;
  }
  return size;
}

export { SERIF };
