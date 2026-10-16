// The besieged city as clustered low-poly blocks, sized from its population and styled by its age: houses with roofs
// of the period, a temple or towers, walls and towers before the age of engines; neighbouring towns as small
// clusters. Also returns where the night's windows, the sack's fires and the hearth smoke sit.
// Used when atlas/src/three/city has no buildCity(); deterministic (streams keyed by city id and year).

import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, Group, InstancedMesh, Matrix4, Mesh,
  MeshLambertMaterial, Quaternion, SphereGeometry, SRGBColorSpace, Vector3,
} from 'three';
import type { TerrainMesh } from '../../../terrain/mesh.ts';
import { SEA_Y } from '../../../terrain/mesh.ts';
import { streamOf, type BackdropScenario } from './scenario.ts';

type RGB = [number, number, number];
const H = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

interface AgeLook { walls: RGB[]; roof: RGB[]; roofForm: 'flat' | 'gable' | 'hip'; roofH: number; storeys: [number, number]; stone: RGB; temple: 'ziggurat' | 'hall' | 'spire' | 'dome' | 'towers' }
const AGES: AgeLook[] = [
  { walls: [H('#e2c9a0'), H('#d6b88e'), H('#ead5b0'), H('#cfae84')], roof: [H('#d6b994')], roofForm: 'flat', roofH: 0, storeys: [0.75, 1.15], stone: H('#dcc196'), temple: 'ziggurat' },
  { walls: [H('#bcb09a'), H('#ab977c'), H('#c7b89c')], roof: [H('#b39457'), H('#a6884f'), H('#9c8a62')], roofForm: 'gable', roofH: 0.55, storeys: [0.7, 1.05], stone: H('#c4b8a0'), temple: 'hall' },
  { walls: [H('#ebe2d0'), H('#e0d5c0'), H('#f1e9d8')], roof: [H('#b4583c'), H('#a8533a'), H('#bf6745')], roofForm: 'hip', roofH: 0.42, storeys: [0.85, 1.3], stone: H('#ede5d4'), temple: 'hall' },
  { walls: [H('#efe6d3'), H('#e4d6bc'), H('#b39472'), H('#eadcc4')], roof: [H('#7a5848'), H('#6c5a4c'), H('#8a4a38')], roofForm: 'gable', roofH: 0.8, storeys: [1.0, 1.6], stone: H('#dbd3c3'), temple: 'spire' },
  { walls: [H('#c07a60'), H('#d8cbb0'), H('#b06c54'), H('#e2d6bf')], roof: [H('#5f6670'), H('#69707a')], roofForm: 'hip', roofH: 0.5, storeys: [1.3, 2.0], stone: H('#e0d6c2'), temple: 'dome' },
  { walls: [H('#94604d'), H('#a46e57'), H('#8a5a49'), H('#c8b9a0')], roof: [H('#565b63'), H('#4f545c')], roofForm: 'gable', roofH: 0.38, storeys: [1.5, 2.4], stone: H('#cfc6b5'), temple: 'towers' },
  { walls: [H('#d3cfc6'), H('#c3c2bd'), H('#9fb3bf'), H('#e0dcd2')], roof: [H('#b8b5ae')], roofForm: 'flat', roofH: 0, storeys: [1.8, 3.6], stone: H('#e6e2d8'), temple: 'towers' },
];

export interface CityModel {
  group: Group;
  /** The city itself (houses, landmarks, walls) and the towns around it, as separate children of `group`. */
  main: Group;
  towns: Group;
  /** Lit windows (night), fires (the sack), hearths and chimneys (smoke): flat xyz. */
  windows: Float32Array;
  fires: Float32Array;
  hearths: Float32Array;
  /** Height of the tallest roof above the city's ground. */
  top: number;
  dispose(): void;
}

function prism(): BufferGeometry {
  // a gable roof: unit footprint, ridge along x at height 1
  const v = [
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0, // front slope
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0, // back slope
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, // gable ends
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

interface Inst { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot: number; c: RGB }

/** Lay out a cluster of n houses within radius R around (cx, cz). Pushes into `walls`/`roofs`; returns the houses. */
function cluster(
  m: TerrainMesh, land: (x: number, z: number) => boolean, rnd: () => number, cx: number, cz: number, R: number, n: number,
  age: AgeLook, grid: boolean, angle: number, walls: Inst[], roofs: Inst[], storeyK: number, plot = 0, inner = 0,
): { x: number; z: number; y: number; w: number; d: number; h: number; rot: number; r: number }[] {
  const s = plot || Math.sqrt((Math.PI * R * R) / Math.max(1, n)) * 0.98;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const taken = new Set<number>();
  const out: { x: number; z: number; y: number; w: number; d: number; h: number; rot: number; r: number }[] = [];
  const lane = grid ? 4 : 0;
  // an irregular outline (suburbs along the roads) and a few open squares
  const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const edge = (a: number) => 1 + 0.2 * Math.sin(2 * a + ph[0]) + 0.12 * Math.sin(3 * a + ph[1]) + 0.08 * Math.sin(5 * a + ph[2]);
  const squares: [number, number, number][] = [];
  for (let k = 0; k < (n > 120 ? 3 : 1); k++) {
    const a = rnd() * 6.28, r = R * (0.15 + rnd() * 0.35);
    squares.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, s * (1.4 + rnd() * 1.4)]);
  }
  let tries = 0;
  while (out.length < n && tries < n * 14) {
    tries++;
    const a = rnd() * Math.PI * 2;
    const r = R * 1.3 * Math.sqrt(rnd());
    const fall = Math.exp(-Math.pow(r / (R * edge(a)), 4) * 1.35);
    if (r < inner || rnd() > fall) continue;
    // snap to the street grid (rotated), leaving lanes free
    const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
    const gx = lx * ca + lz * sa, gz = -lx * sa + lz * ca;
    const i = Math.round(gx / s), j = Math.round(gz / s);
    if (lane && (((i % lane) + lane) % lane === 0 || ((j % (lane + 1)) + lane + 1) % (lane + 1) === 0)) continue;
    const key = (i + 4096) * 8192 + (j + 4096);
    if (taken.has(key)) continue;
    const jit = grid ? 0.08 : 0.3;
    const ux = (i + (rnd() - 0.5) * jit) * s, uz = (j + (rnd() - 0.5) * jit) * s;
    const x = cx + ux * ca - uz * sa, z = cz + ux * sa + uz * ca;
    if (!land(x, z) || squares.some(([qx, qz, qr]) => (x - qx) ** 2 + (z - qz) ** 2 < qr * qr)) continue;
    const w = s * (0.56 + rnd() * 0.3), d = s * (0.5 + rnd() * 0.32);
    const rot = -angle + (grid ? 0 : (rnd() - 0.5) * 0.7);
    // footprint on the slope
    let y0 = Infinity, y1 = -Infinity;
    for (const [px, pz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
      const hx = x + px * Math.cos(rot) - pz * Math.sin(rot), hz = z + px * Math.sin(rot) + pz * Math.cos(rot);
      const hy = m.heightAt(hx, hz);
      y0 = Math.min(y0, hy); y1 = Math.max(y1, hy);
    }
    if (y1 - y0 > Math.max(0.012, w * 1.6)) continue;
    taken.add(key);
    const centre = Math.exp(-Math.pow(r / R, 2) * 2.2);
    const storeys = age.storeys[0] + (age.storeys[1] - age.storeys[0]) * rnd();
    const h = s * storeys * storeyK * (0.75 + 1.1 * centre) + (y1 - y0);
    const wc = age.walls[Math.floor(rnd() * age.walls.length)];
    const k = 0.9 + rnd() * 0.18;
    walls.push({ x, y: y0 - 0.002, z, sx: w, sy: h + 0.002, sz: d, rot, c: [wc[0] * k, wc[1] * k, wc[2] * k] });
    if (age.roofForm !== 'flat') {
      const rc = age.roof[Math.floor(rnd() * age.roof.length)];
      const kr = 0.88 + rnd() * 0.2;
      roofs.push({ x, y: y0 + h, z, sx: w * 1.06, sy: Math.min(w, d) * age.roofH * (0.85 + rnd() * 0.3), sz: d * 1.06, rot, c: [rc[0] * kr, rc[1] * kr, rc[2] * kr] });
    }
    out.push({ x, z, y: y0, w, d, h, rot, r });
  }
  return out;
}

export interface BlockOpts {
  /** 'full': the whole city; 'suburbs': a sparse ring just beyond R (around a city model that stops at R); 'none'. */
  main: 'full' | 'suburbs' | 'none';
  /** Plot size (scene units) for suburbs and towns, to match a city model's; the city's own otherwise. */
  plot?: number;
}

export function buildBlockCity(
  m: TerrainMesh, isLand: (x: number, z: number) => boolean, sc: BackdropScenario, era: number, cx: number, cz: number, R: number,
  neighbours: { x: number; z: number; pop: number; id: string }[], mobile: boolean, opts: BlockOpts = { main: 'full' },
): CityModel {
  const age = AGES[Math.max(0, Math.min(AGES.length - 1, era))];
  const rnd = streamOf(`backdrop:${sc.city.id}:${sc.year}`);
  const land = (x: number, z: number) => isLand(x, z) && m.heightAt(x, z) > SEA_Y + 0.008;
  const walls: Inst[] = [], roofs: Inst[] = [];
  const n = Math.round(Math.max(60, Math.min(mobile ? 1600 : 2600, 1.05 * Math.pow(Math.max(1, sc.city.pop), 0.52))));
  const grid = rnd() < (era >= 4 ? 0.75 : 0.45);
  const angle = rnd() * Math.PI;
  const s = Math.sqrt((Math.PI * R * R) / n);
  const plot = opts.plot ?? s * 0.98;
  const houses = opts.main === 'full' ? cluster(m, land, rnd, cx, cz, R, n, age, grid, angle, walls, roofs, 1.7) : [];
  if (opts.main === 'suburbs') {
    const ns = Math.round(Math.min(mobile ? 700 : 1500, (0.26 * Math.PI * R * R) / (plot * plot)));
    houses.push(...cluster(m, land, rnd, cx, cz, R * 1.3, ns, age, false, angle, walls, roofs, era >= 5 ? 0.8 : 1.3, plot * 1.1, R * 0.9));
  }
  let top = 0;
  const gy = m.heightAt(cx, cz);
  for (const h of houses) top = Math.max(top, h.y + h.h - gy);

  // ---- landmarks near the centre: temple / citadel, or towers in the modern city
  const extra: Mesh[] = [];
  const full = opts.main === 'full';
  const near = houses.slice().sort((a, b) => a.r - b.r);
  const site = near[Math.min(near.length - 1, 2)] ?? { x: cx, z: cz, y: gy, rot: angle };
  const stone = age.stone;
  const T = s * 1.0;
  const push = (x: number, y: number, z: number, w: number, hh: number, d: number, rot: number, c: RGB) => walls.push({ x, y, z, sx: w, sy: hh, sz: d, rot, c });
  if (!full) { /* the model has its own */ } else if (age.temple === 'ziggurat') {
    for (let k = 0; k < 3; k++) push(site.x, site.y + k * T * 1.25, site.z, T * (4.2 - k * 1.15), T * 1.3, T * (4.2 - k * 1.15), site.rot, k === 2 ? [stone[0] * 1.05, stone[1] * 1.0, stone[2] * 0.95] : stone);
    top = Math.max(top, site.y + T * 3.8 - gy);
  } else if (age.temple === 'hall' || age.temple === 'spire') {
    push(site.x, site.y, site.z, T * 4.4, T * 2.2, T * 2.6, site.rot, stone);
    roofs.push({ x: site.x, y: site.y + T * 2.2, z: site.z, sx: T * 4.6, sy: T * 1.5, sz: T * 2.8, rot: site.rot, c: age.roof[0] });
    if (age.temple === 'spire') {
      const ox = Math.cos(site.rot) * T * 2.6, oz = Math.sin(site.rot) * T * 2.6;
      push(site.x + ox, site.y, site.z + oz, T * 1.1, T * 6.5, T * 1.1, site.rot, stone);
      roofs.push({ x: site.x + ox, y: site.y + T * 6.5, z: site.z + oz, sx: T * 1.2, sy: T * 3.2, sz: T * 1.2, rot: site.rot + Math.PI / 4, c: age.roof[0] });
      top = Math.max(top, site.y + T * 9.7 - gy);
    }
  } else if (age.temple === 'dome') {
    push(site.x, site.y, site.z, T * 3.6, T * 2.4, T * 3.6, site.rot, stone);
    const dome = new Mesh(new SphereGeometry(T * 1.75, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new MeshLambertMaterial({ color: new Color().setRGB(0.55, 0.62, 0.6) }));
    dome.position.set(site.x, site.y + T * 2.4, site.z);
    dome.castShadow = true; dome.receiveShadow = true;
    extra.push(dome);
    top = Math.max(top, site.y + T * 4.2 - gy);
  } else {
    // the modern city: a handful of towers and works chimneys
    for (const h of near.slice(0, Math.max(4, Math.round(n / 120)))) {
      const k = 2.2 + rnd() * (era >= 6 ? 5 : 2.5);
      push(h.x, h.y, h.z, h.w * 1.15, h.h * k, h.d * 1.15, h.rot, age.walls[Math.floor(rnd() * age.walls.length)]);
      top = Math.max(top, h.y + h.h * k - gy);
    }
  }
  // a citadel on the highest ground near the centre (before the age of engines)
  if (full && era < 5) {
    let best = houses[0], bh = -Infinity;
    for (const h of houses) if (h.r < R * 0.55 && h.y > bh && h !== site) { bh = h.y; best = h; }
    if (best) {
      push(best.x, best.y, best.z, T * 3.2, T * 2.8, T * 2.6, best.rot + 0.3, stone);
      push(best.x + T * 1.3, best.y, best.z - T * 1.0, T * 1.1, T * 4.4, T * 1.1, best.rot + 0.3, stone);
      top = Math.max(top, best.y + T * 4.4 - gy);
    }
  }

  // ---- walls and towers, before the age of engines
  if (full && era < 5) {
    const Rw = R * 1.02;
    const segs = Math.max(28, Math.round((Math.PI * 2 * Rw) / (s * 2.6)));
    const th = s * 0.42, wh = s * 1.55;
    const pts: [number, number, boolean][] = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const rr = Rw * (1 + 0.07 * Math.sin(a * 3 + angle) + 0.04 * Math.sin(a * 5 + 1.3));
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      pts.push([x, z, land(x, z)]);
    }
    for (let k = 0; k < segs; k++) {
      const [ax, az, al] = pts[k], [bx, bz, bl] = pts[(k + 1) % segs];
      if (!al || !bl) continue;
      const ya = m.heightAt(ax, az), yb = m.heightAt(bx, bz);
      const len = Math.hypot(bx - ax, bz - az);
      const rot = -Math.atan2(bz - az, bx - ax);
      push((ax + bx) / 2, Math.min(ya, yb) - 0.003, (az + bz) / 2, len + th, wh + Math.abs(ya - yb) + 0.003, th, rot, age.stone);
      if (k % 2 === 0) push(ax, ya - 0.003, az, th * 2.6, wh * 1.75, th * 2.6, rot, [age.stone[0] * 0.95, age.stone[1] * 0.95, age.stone[2] * 0.93]);
    }
  }

  // ---- neighbouring towns: small clusters
  const tWalls: Inst[] = [], tRoofs: Inst[] = [];
  for (const nb of neighbours) {
    // as many houses as the city module draws for that many people, on the same plots
    const nn = Math.round(Math.max(8, Math.min(mobile ? 180 : 360, 1.4 * Math.pow(nb.pop, 0.54))));
    const r = plot * Math.sqrt(nn / Math.PI) * 1.2;
    const rn = streamOf(`backdrop:${nb.id}:${sc.year}`);
    cluster(m, land, rn, nb.x, nb.z, r, nn, age, rn() < 0.4, rn() * Math.PI, tWalls, tRoofs, era >= 5 ? 0.9 : 1.5, plot);
  }

  // ---- instanced meshes
  const group = new Group(), main = new Group(), towns = new Group();
  group.add(main, towns);
  const mtx = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), pos = new Vector3(), scl = new Vector3(), col = new Color();
  const fill = (group: Group, geo: BufferGeometry, list: Inst[], yaw = 0) => {
    if (!list.length) return;
    const mat = new MeshLambertMaterial({ color: 0xffffff });
    const im = new InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot + yaw);
      mtx.compose(pos.set(b.x, b.y, b.z), q, scl.set(b.sx, b.sy, b.sz));
      im.setMatrixAt(i, mtx);
      im.setColorAt(i, col.setRGB(b.c[0], b.c[1], b.c[2], SRGBColorSpace));
    });
    im.count = list.length;
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  };
  const box = new BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const roofGeo = (): BufferGeometry => {
    if (age.roofForm !== 'hip') return prism();
    const g = new ConeGeometry(Math.SQRT1_2, 1, 4, 1);
    g.translate(0, 0.5, 0);
    return g;
  };
  const yaw = age.roofForm === 'hip' ? Math.PI / 4 : 0;
  fill(main, box, walls);
  fill(main, roofGeo(), roofs, yaw);
  fill(towns, box.clone(), tWalls);
  fill(towns, roofGeo(), tRoofs, yaw);
  for (const e of extra) main.add(e);

  // ---- anchors for the night and the fire
  const wl: number[] = [], fl: number[] = [], hl: number[] = [];
  const rw = streamOf(`backdrop:${sc.city.id}:${sc.year}:lights`);
  for (const h of houses) {
    const lit = rw();
    if (lit < 0.75) {
      // a window on a random face, a little above the floor
      const face = Math.floor(rw() * 4);
      const along = (rw() - 0.5) * 0.7;
      const half = face % 2 === 0 ? h.d / 2 : h.w / 2;
      const lx = face % 2 === 0 ? along * h.w : (face === 1 ? 1 : -1) * (half + 0.0004);
      const lz = face % 2 === 0 ? (face === 0 ? 1 : -1) * (half + 0.0004) : along * h.d;
      const x = h.x + lx * Math.cos(h.rot) + lz * Math.sin(h.rot), z = h.z - lx * Math.sin(h.rot) + lz * Math.cos(h.rot);
      wl.push(x, h.y + h.h + 0.0006 + rw() * 0.0008, z);
    }
    if (rw() < 0.16) fl.push(h.x + (rw() - 0.5) * h.w, h.y + h.h * (0.6 + rw() * 0.5), h.z + (rw() - 0.5) * h.d);
    if (rw() < 0.03) hl.push(h.x, h.y + h.h * 1.2, h.z);
  }
  return {
    group, main, towns, windows: new Float32Array(wl), fires: new Float32Array(fl), hearths: new Float32Array(hl), top,
    dispose() {
      group.traverse((o) => {
        const mm = o as Mesh;
        mm.geometry?.dispose();
        (mm.material as MeshLambertMaterial | undefined)?.dispose?.();
      });
    },
  };
}
