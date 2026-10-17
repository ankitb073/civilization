// Streets world: the hero district assembled from the modular kit (kit.json's recipe, scripts/streets/kit/viewer.html
// house()). Every house keeps the model's footprint and height lot for lot; its four sides become a corner column and
// wall modules stretched to fit, with a door module where the streets layer put the door, window modules at its
// windows, upper bands for taller walls, the roof slab's edge and field, the layer's parapet runs (open where ladders,
// stairs and planks arrive), beam ends, a room on the roof where the model has one, an open door leaf with a dark
// room behind it. Stairs, ladders, alley walls, the city walls and towers, gate leaves, the market, the well, the
// tablets drying on the roof of the house of tablets, jars, firewood, ovens, mats, trees, reeds and weeds come from
// the layer's own intents (intents.ts), at the places and sizes its colliders already have. Everything is grouped by
// owner, so a district cell can swap an owner's primitives for its kit pieces at once. Deterministic: hashes of the
// city id (ctx.u), never Math.random.

import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Ctx } from './ctx.ts';
import { houseOwner } from './ctx.ts';
import type { House, Rect, Side } from './plan.ts';
import { sides } from './plan.ts';
import type { Intent } from './intents.ts';
import type { KitPiece, LoadedKit } from './kitload.ts';
import { linRGB } from './kitload.ts';
import type { KInst } from './kitmesh.ts';
import { meander, riverDist } from '../../../three/city/layout.ts';
import type { RGB } from '../../../three/city/style.ts';

const UP = new Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(), _l = new Matrix4(), _w = new Matrix4();

/** A frame on the ground: x along (xx, xz), z out along (nx, nz), y up (right-handed when n = x turned a quarter). */
class Frame {
  readonly m = new Matrix4();
  constructor(ox: number, oy: number, oz: number, xx: number, xz: number, nx: number, nz: number) {
    this.m.makeBasis(new Vector3(xx, 0, xz), UP, new Vector3(nx, 0, nz)).setPosition(ox, oy, oz);
  }
  /** A piece at local (x, y, z), turned `rot` about local y, scaled (sx, sy, sz). */
  at(x: number, y: number, z: number, rot = 0, sx = 1, sy = 1, sz = 1): Float32Array {
    _q.setFromAxisAngle(UP, rot);
    _l.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    return Float32Array.from(_w.multiplyMatrices(this.m, _l).elements);
  }
}

/** A frame whose x runs along yaw (as the city's parts: local x → (cos, −sin)), z → (sin, cos). */
const yawFrame = (x: number, y: number, z: number, yaw: number) => new Frame(x, y, z, Math.cos(yaw), -Math.sin(yaw), Math.sin(yaw), Math.cos(yaw));
/** A frame on a rectangle's side: origin at the side's start corner (kit order), x along it, z out of it. */
function sideFrame(s: Side, y: number): { f: Frame; L: number; tx: number; tz: number; sx: number; sz: number; sign: number } {
  const tx = s.nz, tz = -s.nx;
  const sx = s.x - tx * s.half, sz = s.z - tz * s.half;
  // plan t (along s.tx, s.tz) → kit x: x = half + sign · t
  const sign = s.tx * tx + s.tz * tz > 0 ? 1 : -1;
  return { f: new Frame(sx, y, sz, tx, tz, s.nx, s.nz), L: s.half * 2, tx, tz, sx, sz, sign };
}

export interface AssembleOut {
  /** Kit pieces by owner. */
  byOwner: Map<number, KInst[]>;
  /** Owners the district made itself (towers, reeds …) with their positions. */
  counts: Record<string, number>;
}

/** A box the model drew for a monument, in metres: its footprint, base and height. */
export interface MonBox extends Rect { y: number; h: number }
/** The temple and the palace as the model drew them (district.ts reads their parts), for the kit to redress. */
export interface Monuments {
  temple?: { owner: number; podium: MonBox; cella: MonBox | null; columns: { x: number; y: number; z: number; d: number; h: number }[]; front: { x: number; z: number } | null };
  palace?: { owner: number; platform: MonBox; hall: MonBox | null; slab: MonBox | null; towers: MonBox[]; front: { x: number; z: number } };
}

interface Opts { inside(x: number, z: number): boolean; mobile: boolean; monuments?: Monuments }

export function assemble(ctx: Ctx, kit: LoadedKit, owners: Set<number>, opts: Opts): AssembleOut {
  const byOwner = new Map<number, KInst[]>();
  const counts: Record<string, number> = {};
  const count = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
  const P = (name: string): KitPiece | null => kit.pieces.get(name) ?? null;
  const M = (n: string) => kit.matIndex(n);
  const PLASTER = M('M_MudPlaster'), LIME = M('M_MudPlaster_Lime'), TEXTILE = M('M_Textile'), BRICK = M('M_MudBrick');
  const add = (owner: number, name: string, m: Float32Array, o: Partial<KInst> = {}) => {
    const piece = P(name);
    if (!piece) return;
    let l = byOwner.get(owner);
    if (!l) { l = []; byOwner.set(owner, l); }
    l.push({ piece, m, ...o });
  };
  /** LOD3: a plain box standing in for a part far off (unit box, base at y0), in a material's mean colour. */
  const box3 = (owner: number, r: Rect, y0: number, h: number, kind: '' | 'Roof' | 'Lime' = '', tint?: [number, number, number]) => {
    if (h <= 0.01) return;
    add(owner, `_box${kind}`, yawFrame(r.x, y0, r.z, r.rot).at(0, 0, 0, 0, r.hw * 2, h, r.hd * 2), { lod3: 'only', tint });
  };
  const H = ctx.plan.houses;
  const pick = <T>(arr: T[], u: number) => arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];
  const meanWall = (() => {
    const s = [0, 0, 0];
    let n = 0;
    for (const h of H) if (h.kind === 'house') { const c = linRGB(h.wall); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++; }
    return n ? s.map((v) => v / n) : [0.5, 0.35, 0.2];
  })();
  /** A house's plaster tint: the record's own variation between houses, about the kit's own colour. */
  const tintOf = (c: RGB): [number, number, number] => {
    const l = linRGB(c);
    return [0, 1, 2].map((k) => Math.max(0.78, Math.min(1.12, 0.96 * (l[k] / meanWall[k])))) as [number, number, number];
  };

  // ---------------------------------------------------------------- walls of modules along a side
  type Mod = { name: string; x: number; w: number; nominal: number; kind: 'wall' | 'door' | 'window'; uo: number };
  const WALLS: Record<number, string[]> = { 1: ['wall_1m', 'wall_1m_b'], 2: ['wall_2m_a', 'wall_2m_b', 'wall_2m_c'], 4: ['wall_4m_a', 'wall_4m_b', 'wall_4m_c'] };
  const BANDS: Record<number, string> = { 1: 'wallband_1m', 2: 'wallband_2m', 4: 'wallband_4m' };
  /** Fill [a, b] along a side with modules: fixed ones (doors, windows: centre c, nominal width) where asked, plain
   *  walls between, each stretched to fit; uvs carry on from module to module. */
  function layoutSide(L: number, fixed: { c: number; nominal: number; name: string; kind: 'door' | 'window' }[], key: string): Mod[] {
    const a = 0.5, b = L - 0.5;
    const span = b - a;
    const fx = fixed.slice().sort((p, q) => p.c - q.c);
    // place the fixed modules, in from the corners, without overlapping (a window that does not fit is left out)
    const placed: { x0: number; x1: number; f: (typeof fx)[number] }[] = [];
    for (const f of fx) {
      const w = Math.min(f.nominal, span);
      let x0 = Math.max(a, Math.min(b - w, f.c - w / 2));
      const prev = placed[placed.length - 1];
      if (prev && x0 < prev.x1) {
        if (f.kind === 'window') continue;
        // a door over a window: the window goes
        if (prev.f.kind === 'window') { placed.pop(); x0 = Math.max(a, Math.min(b - w, f.c - w / 2)); }
        else continue;
      }
      placed.push({ x0, x1: x0 + w, f });
    }
    const out: Mod[] = [];
    let uo = 0.25; // after the corner column (0.5 m = a quarter of a 2 m tile)
    const walls = (x0: number, x1: number, salt: string) => {
      const g = x1 - x0;
      if (g < 0.02) return;
      const n = Math.max(1, Math.round(g));
      // whole metres as 4, 2 and 1 m modules, in an order from the hash
      const parts: number[] = [];
      let r = n;
      while (r >= 4 && ctx.u(`kw4:${key}:${salt}:${parts.length}`) < 0.7) { parts.push(4); r -= 4; }
      while (r >= 2) { parts.push(2); r -= 2; }
      while (r >= 1) { parts.push(1); r -= 1; }
      // shuffle deterministically
      for (let i = parts.length - 1; i > 0; i--) { const j = Math.floor(ctx.u(`kws:${key}:${salt}:${i}`) * (i + 1)); [parts[i], parts[j]] = [parts[j], parts[i]]; }
      const k = g / n;
      let x = x0;
      parts.forEach((p, i) => {
        out.push({ name: pick(WALLS[p], ctx.u(`kwp:${key}:${salt}:${i}`)), x, w: p * k, nominal: p, kind: 'wall', uo });
        uo += p / 2;
        x += p * k;
      });
    };
    let x = a;
    placed.forEach((p, i) => {
      walls(x, p.x0, `g${i}`);
      out.push({ name: p.f.name, x: p.x0, w: p.x1 - p.x0, nominal: p.f.nominal, kind: p.f.kind, uo });
      uo += p.f.nominal / 2;
      x = p.x1;
    });
    walls(x, b, 'end');
    return out;
  }

  /** The upper bands over a module (same columns), as kit names and offsets. */
  const bandsOf = (m: Mod): { name: string; dx: number; nominal: number }[] => {
    if (m.nominal === 3) return [{ name: BANDS[2], dx: 0, nominal: 2 }, { name: BANDS[1], dx: 2, nominal: 1 }];
    return [{ name: BANDS[m.nominal] ?? BANDS[2], dx: 0, nominal: m.nominal }];
  };

  /** The walls of a rectangle from y0 to y0 + Hw: corners, modules (with doors and windows), upper bands. */
  function shellWalls(owner: number, rect: Rect, y0: number, Hw: number, key: string, tint: [number, number, number] | undefined, opt: {
    doorOf?: (k: number) => { t: number; name: string; nominal: number } | null; windowsOf?: (k: number) => number[]; bandsOnly?: boolean; swap?: [number, number];
  } = {}) {
    // walls of n 1 m bands over a 3 m base, all stretched by one factor so the last band ends at the top
    const nb = opt.bandsOnly ? Math.max(1, Math.round(Hw)) : Math.max(0, Math.round(Hw - 3));
    const ky = opt.bandsOnly ? Hw / nb : Hw / (3 + nb);
    const base = opt.bandsOnly ? 0 : 3 * ky;
    const doors: { f: Frame; m: Mod; ky: number }[] = [];
    for (const s of sides(rect)) {
      const { f, L, sign } = sideFrame(s, y0);
      const fixed: { c: number; nominal: number; name: string; kind: 'door' | 'window' }[] = [];
      const d = opt.doorOf?.(s.k);
      if (d) fixed.push({ c: s.half + sign * d.t, nominal: d.nominal, name: d.name, kind: 'door' });
      for (const t of opt.windowsOf?.(s.k) ?? []) fixed.push({ c: s.half + sign * t, nominal: 2, name: 'window_2m', kind: 'window' });
      const mods = layoutSide(L, fixed, `${key}:${s.k}`);
      const o = { tint, tintMat: PLASTER, swap: opt.swap };
      if (!opt.bandsOnly) {
        add(owner, 'corner_out', f.at(0, 0, 0, 0, 1, ky, 1), o);
        for (const m of mods) {
          add(owner, m.name, f.at(m.x, 0, 0, 0, m.w / m.nominal, ky, 1), { ...o, uo: m.uo });
          if (m.kind === 'door') doors.push({ f, m, ky });
        }
      }
      for (let j = 0; j < nb; j++) {
        const y = base + j * ky;
        add(owner, 'cornerband', f.at(0, y, 0, 0, 1, ky, 1), o);
        for (const m of mods) {
          const k = m.w / m.nominal;
          for (const b of bandsOf(m)) add(owner, b.name, f.at(m.x + b.dx * k, y, 0, 0, k, ky, 1), { ...o, uo: m.uo + b.dx / 2 });
        }
      }
      count('walls', mods.length);
    }
    return doors;
  }

  /** The roof slab over a rectangle: edge strips round it (with beam ends on some sides) and the field inside. */
  function roofSlab(owner: number, rect: Rect, yTop: number, key: string, beams: number[] = [], swap?: [number, number]) {
    for (const s of sides(rect)) {
      const { f, L } = sideFrame(s, yTop);
      add(owner, 'roof_edge_corner', f.at(0, 0, 0), { swap });
      const n = Math.max(1, Math.round((L - 1) / 2)), k = (L - 1) / (2 * n);
      for (let i = 0; i < n; i++) add(owner, 'roof_edge_2m', f.at(0.5 + i * 2 * k, 0, 0, 0, k, 1, 1), { uo: 0.25 + i, swap });
      if (beams.includes(s.k)) for (let i = 0; i < n; i++) add(owner, 'beam_ends_2m', f.at(0.5 + i * 2 * k, 0, 0, 0, k, 1, 1));
    }
    // the field: tiles over the inner rectangle (0.5 m in from each wall face), in the rectangle's own frame
    const W = rect.hw * 2, D = rect.hd * 2;
    const c = Math.cos(rect.rot), sn = Math.sin(rect.rot);
    const f = new Frame(rect.x, yTop, rect.z, c, -sn, sn, c);
    const nx = Math.max(1, Math.round((W - 1) / 2)), nz = Math.max(1, Math.round((D - 1) / 2));
    const kx = (W - 1) / (2 * nx), kz = (D - 1) / (2 * nz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      add(owner, 'roof_field_2m', f.at(-rect.hw + 0.5 + i * 2 * kx, 0, -rect.hd + 0.5 + (j + 1) * 2 * kz, 0, kx, 1, kz), { noShadow: true });
    }
    void key;
  }

  /** A dark room behind a doorway (a door module at m in frame f): what the door shows instead of the hollow house. */
  function darkRoom(owner: number, f: Frame, m: Mod, ky: number) {
    const k = m.w / m.nominal;
    const cx = m.x + (m.nominal / 2) * k;
    const w = m.nominal === 3 ? 2.6 : 1.9;
    add(owner, '_room', f.at(cx, 0, -0.5, 0, w, 2.3 * ky, 2.0), { near: true });
  }

  /** The door leaf (or leaves) of a door module, swung open into the house. */
  function doorLeaves(owner: number, f: Frame, m: Mod, ky: number, key: string) {
    const k = m.w / m.nominal;
    const open = 1.15 + 0.45 * ctx.u(`dl:${key}`);
    if (m.name === 'door_3m') {
      add(owner, 'door_leaf_l', f.at(m.x + 0.77 * k, 0, -0.34, open, k, ky, 1));
      // the right leaf: mirrored about its hinge (x flipped), opened the other way
      add(owner, 'door_leaf_l', f.at(m.x + 2.23 * k, 0, -0.34, -open, -k, ky, 1));
    } else {
      add(owner, 'door_leaf_s', f.at(m.x + 0.49 * k, 0, -0.34, open, k, ky, 1));
    }
  }

  // ---------------------------------------------------------------- houses
  const intentsBy = new Map<number, Intent[]>();
  for (const it of ctx.intents) { const l = intentsBy.get(it.owner); if (l) l.push(it); else intentsBy.set(it.owner, [it]); }

  H.forEach((h: House, i) => {
    if (h.kind !== 'house') return;
    const owner = houseOwner(ctx, i);
    if (!owners.has(owner)) return;
    const d = ctx.dress[i];
    const its = intentsBy.get(owner) ?? [];
    const tint = tintOf(h.wall);
    const y0 = Math.min(0, h.ground);
    const Hw = h.top - y0;
    const big = d.role === 'tablet-house';
    const windows = its.filter((x): x is Extract<Intent, { k: 'window' }> => x.k === 'window');
    const doors = shellWalls(owner, h, y0, Hw, `h${h.id}`, tint, {
      doorOf: (k) => (d.door && d.door.k === k ? { t: d.door.t, name: big ? 'door_3m' : ctx.u(`dk:${h.id}`) < 0.5 ? 'door_2m' : 'door_2m_b', nominal: big ? 3 : 2 } : null),
      windowsOf: (k) => windows.filter((w) => w.side === k).map((w) => w.t),
    });
    for (const dd of doors) { doorLeaves(owner, dd.f, dd.m, dd.ky, `${h.id}`); darkRoom(owner, dd.f, dd.m, dd.ky); }
    const vig = its.find((x): x is Extract<Intent, { k: 'vigas' }> => x.k === 'vigas');
    roofSlab(owner, h, h.top, `h${h.id}`, vig?.sides ?? []);
    box3(owner, h, y0, Hw, '', tint);
    box3(owner, { ...h, hw: h.rhw, hd: h.rhd }, h.top, h.roof - h.top, 'Roof');
    if (h.upper) box3(owner, h.upper, h.roof, h.upper.top - h.roof, '', tint);
    count('houses');
    // the room on the roof: bands from the roof up to its own slab
    if (h.upper) {
      const U = h.upper;
      const Hu = U.top - 0.4 - h.roof;
      if (Hu > 0.3) shellWalls(owner, U, h.roof, Hu, `u${h.id}`, tint, { bandsOnly: true });
      roofSlab(owner, U, U.top - 0.4, `u${h.id}`);
      count('upperRooms');
    }
  });

  // ---------------------------------------------------------------- parapets (the layer's runs, with their gaps)
  // corners: where two runs of one roof meet, a corner piece; runs stop short of it
  const parRuns = new Map<number, Extract<Intent, { k: 'parapet' }>[]>();
  for (const it of ctx.intents) if (it.k === 'parapet' && owners.has(it.owner)) { const l = parRuns.get(it.house); if (l) l.push(it); else parRuns.set(it.house, [it]); }
  for (const [hi, runs] of parRuns) {
    const owner = runs[0].owner;
    const h = H[hi];
    const tint = tintOf(h.wall);
    const ky = runs[0].h / 0.55;
    // the slab's corners (kit order: each side's start), and which runs reach them
    const ends: { x: number; z: number; run: (typeof runs)[number]; atStart: boolean }[] = [];
    const segs = runs.map((r) => {
      const s = r.side;
      const off = r.th / 2; // the run's centre line is th/2 in from the slab edge
      const ax = s.x + s.tx * r.a + s.nx * off, az = s.z + s.tz * r.a + s.nz * off;
      const bx = s.x + s.tx * r.b + s.nx * off, bz = s.z + s.tz * r.b + s.nz * off;
      // kit x runs along (nz, −nx): order the ends that way
      const tx = s.nz, tz = -s.nx;
      const fwd = (bx - ax) * tx + (bz - az) * tz > 0;
      const p0 = fwd ? [ax, az] : [bx, bz], p1 = fwd ? [bx, bz] : [ax, az];
      const full = s.half + r.th / 2;
      const touch0 = fwd ? Math.abs(r.a + full) < 0.05 : Math.abs(r.b - full) < 0.05;
      const touch1 = fwd ? Math.abs(r.b - full) < 0.05 : Math.abs(r.a + full) < 0.05;
      return { r, s, p0, p1, tx, tz, touch0, touch1 };
    });
    // a corner is shared by the run that ends there and the run that starts there
    for (const a of segs) {
      if (!a.touch0) continue;
      const other = segs.find((b) => b !== a && b.touch1 && Math.hypot(b.p1[0] - a.p0[0], b.p1[1] - a.p0[1]) < 0.3);
      ends.push({ x: a.p0[0], z: a.p0[1], run: a.r, atStart: !!other });
      if (other) (other as { cut1?: boolean }).cut1 = true;
      (a as { cut0?: boolean }).cut0 = !!other;
    }
    for (const sg of segs) {
      const cut0 = (sg as { cut0?: boolean }).cut0 ? 0.26 : 0, cut1 = (sg as { cut1?: boolean }).cut1 ? 0.26 : 0;
      const y = sg.r.roof;
      // the frame on the slab edge: z = 0 the parapet's exterior face
      const f = new Frame(sg.p0[0], y, sg.p0[1], sg.tx, sg.tz, sg.s.nx, sg.s.nz);
      if (cut0) add(owner, 'parapet_corner', f.at(0, 0, 0, 0, 1, ky, 1), { tint, tintMat: PLASTER });
      const full = Math.hypot(sg.p1[0] - sg.p0[0], sg.p1[1] - sg.p0[1]);
      add(owner, '_box', f.at(full / 2, 0, -0.13, 0, full, sg.r.h, 0.26), { lod3: 'only', tint });
      const len = full - cut0 - cut1;
      if (len < 0.12) continue;
      const n2 = Math.max(0, Math.round(len / 2));
      const parts: [string, number][] = n2 >= 1 && len / (2 * n2) > 0.8 ? Array.from({ length: n2 }, (_, i) => [ctx.u(`pp:${h.id}:${sg.s.k}:${i}`) < 0.5 ? 'parapet_2m' : 'parapet_2m_b', 2] as [string, number])
        : Array.from({ length: Math.max(1, Math.round(len)) }, () => ['parapet_1m', 1] as [string, number]);
      const nominal = parts.reduce((a, p) => a + p[1], 0);
      const k = len / nominal;
      let x = cut0, uo = 0;
      for (const [name, w] of parts) { add(owner, name, f.at(x, 0, 0, 0, k, ky, 1), { tint, tintMat: PLASTER, uo }); x += w * k; uo += w / 2; }
      // a rain spout through the parapet's foot on some runs
      if (len > 2.4 && ctx.u(`spout:${h.id}:${sg.s.k}`) < 0.45) add(owner, 'drain_spout', f.at(cut0 + len * (0.3 + 0.4 * ctx.u(`spt:${h.id}:${sg.s.k}`)), 0, 0));
      count('parapets', parts.length);
    }
  }

  // ---------------------------------------------------------------- from the layer's intents
  for (const it of ctx.intents) {
    if (!owners.has(it.owner)) continue;
    const o = it.owner;
    switch (it.k) {
      case 'stair': {
        // two flights along the wall (a lower one on the ground, an upper one on a solid block), then the landing
        const s = it.side;
        const dir = Math.sign(it.t1 - it.t0);
        const tL = it.t1 - dir * it.landing;
        const run = Math.abs(tL - it.t0), rise = it.top - it.g;
        // a frame on the stair: x along the rise, z out from the wall (kit: against the wall at z = 0, 1 m wide to +z)
        const tx = s.tx * dir, tz = s.tz * dir;
        const ox = s.x + s.tx * it.t0 + s.nx * it.out, oz = s.z + s.tz * it.t0 + s.nz * it.out;
        // right-handed: z = x turned a quarter = (−tz, tx); out from the wall must be +z, else mirror z
        const zx = -tz, zz = tx;
        const out = zx * s.nx + zz * s.nz > 0 ? 1 : -1;
        const f = new Frame(ox, it.g, oz, tx, tz, zx, zz);
        const wz = it.width * out;
        const flights = rise > 3.6 ? 2 : 1;
        const fx = run / flights / 3.36, fy = rise / flights / 3.0;
        for (let k = 0; k < flights; k++) {
          const x0 = (k * run) / flights, y0 = (k * rise) / flights;
          add(o, 'stair_flight', f.at(x0, y0, 0, 0, fx, fy, wz));
          if (y0 > 0.05) add(o, 'stair_landing', f.at(x0, 0, 0, 0, (run / flights), y0 / 3.0, wz));
        }
        add(o, 'stair_landing', f.at(run, 0, 0, 0, it.landing, rise / 3.0, wz));
        count('stairs');
        break;
      }
      case 'ladder': {
        const F = new Vector3(...it.F), T = new Vector3(...it.T);
        const dir = T.clone().sub(F);
        const len = dir.length();
        dir.normalize();
        const tan = new Vector3(-it.n[1], 0, it.n[0]); // along the wall
        const z = new Vector3().crossVectors(tan, dir).normalize();
        const m = new Matrix4().makeBasis(tan, dir, z);
        const name = len > 3.9 ? 'ladder_5m' : 'ladder_3m';
        const nominal = name === 'ladder_5m' ? 5 : 3.2;
        m.multiply(new Matrix4().makeScale(1.05, len / nominal, 1)).setPosition(F.x, F.y, F.z);
        add(o, name, Float32Array.from(m.elements));
        count('ladders');
        break;
      }
      case 'lowWall': {
        // a courtyard wall from house to house (both its ends against a wall): 2 m modules stretched to the gap
        const ax = it.a[0], az = it.a[2], bx = it.b[0], bz = it.b[2];
        const len = Math.hypot(bx - ax, bz - az);
        const tx = (bx - ax) / len, tz = (bz - az) / len;
        const f = new Frame(ax, it.a[1] - it.h / 2, az, tx, tz, -tz, tx);
        const n = Math.max(1, Math.round(len / 2)), k = len / (2 * n);
        for (let j = 0; j < n; j++) add(o, 'cwall_2m', f.at(j * 2 * k, 0, 0, 0, k, it.h / 2, it.th / 0.41), { uo: j });
        count('lowWalls');
        break;
      }
      case 'jar': {
        const tall = it.h > 1.0;
        const name = tall ? (ctx.u(`kj:${it.x.toFixed(1)}:${it.z.toFixed(1)}`) < 0.5 ? 'pithos' : 'pithos_chipped') : 'jar_storage';
        const s = it.h / (tall ? 1.3 : 0.81);
        add(o, name, yawFrame(it.x, it.y, it.z, it.yaw).at(0, 0, 0, 0, s, s, s));
        // now and then a small jug or a stack of bowls beside it
        const u = ctx.u(`kjs:${it.x.toFixed(1)}:${it.z.toFixed(1)}`);
        if (u < 0.22) add(o, u < 0.11 ? 'jug_small' : 'bowl_stack', yawFrame(it.x, it.y, it.z, it.yaw).at(it.r + 0.22, 0, 0.1, u * 20), { near: true, noShadow: true });
        count('jars');
        break;
      }
      case 'firewood': {
        // the stack's back on the wall line (0.3 m behind the layer's pile centre)
        const wx = it.x - it.nx * 0.3, wz = it.z - it.nz * 0.3;
        add(o, 'firewood_stack', new Frame(wx, it.y, wz, it.nz, -it.nx, it.nx, it.nz).at(0, 0, 0, 0, 0.9, 1, 0.9));
        count('firewood');
        break;
      }
      case 'mat': {
        const f = yawFrame(it.x, it.y, it.z, it.yaw);
        add(o, 'mat_flat', f.at(0, 0, 0, 0, 0.95, 1, 0.85), { tint: tintCloth(it.c), noShadow: true });
        if (ctx.u(`kmr:${it.x.toFixed(1)}`) < 0.5) add(o, 'mat_rolled', f.at(0, 0, 0.75, 0.08), { near: true });
        count('mats');
        break;
      }
      case 'oven': {
        const f = yawFrame(it.x, it.y, it.z, it.yaw);
        add(o, 'tannur', f.at(0, 0, 0, 0, 0.85, 0.85, 0.85));
        // firewood by the oven
        add(o, 'firewood_bundle', f.at(0.15, 0, 0.75, 0.3 * ctx.u(`kfb:${it.x.toFixed(1)}`)), { near: true });
        if (ctx.u(`kfb2:${it.x.toFixed(1)}`) < 0.5) add(o, 'firewood_bundle', f.at(0.1, 0.18, 0.78, 0.5), { near: true });
        count('ovens');
        break;
      }
      case 'grain': {
        const f = yawFrame(it.x, it.y, it.z, it.yaw);
        add(o, 'mat_flat', f.at(0, 0, 0, 0, 1.15, 1, 1.5), { tint: [0.9, 0.85, 0.75], noShadow: true });
        add(o, 'tray_winnowing', f.at(0.55, 0.03, 0.25), { near: true });
        add(o, 'basket_grain', f.at(-0.7, 0.03, -0.35, 0.4), { near: true });
        count('grain');
        break;
      }
      case 'basket': {
        add(o, ctx.u(`kb:${it.x.toFixed(1)}`) < 0.5 ? 'basket_grain' : 'basket_tall', yawFrame(it.x, it.y, it.z, it.yaw).at(0, 0, 0));
        break;
      }
      case 'stall': stall(it); break;
      case 'scale': {
        // the post at the layer's post; the arm and pans along the arc of stalls
        const ux = -Math.sin(it.a), uz = Math.cos(it.a);
        const g = ctx.ground(it.x, it.z);
        add(o, 'scale', new Frame(it.x, g, it.z, ux, uz, -uz, ux).at(0, 0, 0));
        add(o, 'sack_open', new Frame(it.x, g, it.z, ux, uz, -uz, ux).at(-0.3, 0, 0.95, 0.5));
        count('scale');
        break;
      }
      case 'well': {
        const g = ctx.ground(it.x, it.z);
        const ux = Math.cos(it.a), uz = Math.sin(it.a);
        const f = new Frame(it.x, g, it.z, ux, uz, -uz, ux);
        add(o, 'well_head', f.at(0, 0, 0));
        const pole = P('shaduf_pole');
        const ful = P('well_head')?.info.fulcrum ?? [2.3, 2.31, 0];
        if (pole) {
          // the sweep raised a little, its bucket hanging from the tip
          const ang = 0.12 + 0.1 * ctx.u('kwell');
          const pm = new Matrix4().copy(f.m).multiply(new Matrix4().makeTranslation(ful[0], ful[1], ful[2])).multiply(new Matrix4().makeRotationZ(ang));
          add(o, 'shaduf_pole', Float32Array.from(pm.elements));
          const tip = (pole.info.tip ?? [-2.29, 1.61, 0]) as number[];
          const tv = new Vector3(tip[0], tip[1], tip[2]).applyMatrix4(pm);
          add(o, 'shaduf_bucket', yawFrame(tv.x, tv.y, tv.z, it.a).at(0, 0, 0));
        }
        count('well');
        break;
      }
      case 'cistern': {
        const g = ctx.ground(it.x, it.z);
        const s = it.r / 0.81;
        add(o, 'well_head', yawFrame(it.x, g, it.z, ctx.u(`kc:${it.x.toFixed(1)}`) * TAU).at(0, 0, 0, 0, s, 0.92, s));
        break;
      }
      case 'tablets': {
        for (const r of it.racks) {
          const n = Math.max(1, Math.round(r.len / 1.62));
          const k = r.len / (n * 1.61);
          const f = yawFrame(r.x, it.y, r.z, r.yaw);
          for (let j = 0; j < n; j++) add(o, 'tablet_board', f.at(-r.len / 2 + (j + 0.5) * 1.61 * k, 0, 0, 0, k, 0.92, 1.1));
        }
        count('tabletBoards');
        break;
      }
      case 'gateLeaf': {
        const ax = it.a[0], az = it.a[2], bx = it.b[0], bz = it.b[2];
        const len = Math.hypot(bx - ax, bz - az);
        const tx = (bx - ax) / len, tz = (bz - az) / len;
        const f = new Frame(ax, 0, az, tx, tz, -tz, tx);
        add(o, 'gate_leaf', f.at(0, 0, 0, 0, len / 1.78, it.h / 3.38, 1));
        count('gateLeaves');
        break;
      }
      case 'tree': {
        const u = ctx.u(`ktree:${it.x.toFixed(1)}:${it.z.toFixed(1)}`);
        const f = yawFrame(it.x, it.y, it.z, u * TAU);
        // courtyards are narrow: a fig's crown kept to the layer's own (about 2 m round), a palm's above the roofs
        if (u < 0.45) add(o, 'fig_tree', f.at(0, 0, 0, 0, it.sz * 0.72, it.sz * 0.8, it.sz * 0.72), { lod3: 'also' });
        else if (u < 0.8) add(o, 'palm_young', f.at(0, 0, 0, 0, it.sz * 0.9, it.sz * 1.05, it.sz * 0.9), { lod3: 'also' });
        else add(o, 'palm_mature', f.at(0, 0, 0, 0, it.sz * 0.8, it.sz * 0.85, it.sz * 0.8), { lod3: 'also' });
        count('trees');
        break;
      }
      case 'front': {
        // a flight of steps straight out from a face: kit flights side by side, rising toward the face
        if (it.what === 'bridge') break;
        const sd = it.side;
        const fx = sd.x + sd.tx * it.t + sd.nx * it.run, fz = sd.z + sd.tz * it.t + sd.nz * it.run;
        // x up the steps (into the face), z along the face (x turned a quarter)
        const xx = -sd.nx, xz = -sd.nz;
        const f = new Frame(fx, it.g, fz, xx, xz, -xz, xx);
        // flights about 3 m wide each (narrower ones side by side read as a grid of worn treads)
        const n = Math.max(1, Math.round(it.width / 3));
        const w = it.width / n;
        const rise = it.top - it.g;
        // lime-washed, the worn brick of the treads washed over too (a grid of flights would show it as a grid)
        for (let j = 0; j < n; j++) add(o, 'stair_flight', f.at(0, 0, -it.width / 2 + j * w, 0, it.run / 3.36, rise / 3.0, w), { swap: [[PLASTER, LIME], [BRICK, LIME]] });
        count('frontStairs');
        break;
      }
      case 'palaceDoor': {
        // the two columns by the hall's door: the kit's porch columns, as thick as the layer's
        for (const c of it.columns) add(o, 'porch_column', yawFrame(c[0], c[1], c[2], Math.atan2(-it.side.tz, it.side.tx)).at(0, 0, 0, 0, 1.45, 1.0, 1.45), { swap: [PLASTER, LIME] });
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------- the temple and the palace, lime-washed
  const mon = opts.monuments;
  const lime: [number, number] = [PLASTER, LIME];
  /** The side of a rectangle that faces a point most squarely (its k). */
  const facing = (r: Rect, p: { x: number; z: number }) => sides(r).map((sd) => ({ k: sd.k, d: sd.nx * (p.x - sd.x) + sd.nz * (p.z - sd.z) })).sort((a, b) => b.d - a.d)[0].k;
  if (mon?.temple && owners.has(mon.temple.owner)) {
    const T = mon.temple, o = T.owner;
    // the podium's faces (its top stays the model's paving), the cella's walls and roof slab under the gable, a door
    shellWalls(o, T.podium, T.podium.y, T.podium.h, 'tpod', undefined, { swap: lime });
    if (T.cella) {
      const C = T.cella;
      const front = T.front ? facing(C, T.front) : -1;
      const doors = shellWalls(o, C, C.y, C.h, 'tcel', undefined, { swap: lime, doorOf: (k) => (k === front ? { t: 0, name: 'door_3m', nominal: 3 } : null) });
      for (const dd of doors) { doorLeaves(o, dd.f, dd.m, dd.ky, 'temple'); darkRoom(o, dd.f, dd.m, dd.ky); }
      roofSlab(o, C, C.y + C.h, 'tcel', [], lime);
    }
    // the colonnade: porch columns, scaled up to the model's (a timber core plastered, a brick plinth, a bolster capital)
    for (const c of T.columns) {
      add(o, 'porch_column', yawFrame(c.x, c.y, c.z, 0).at(0, 0, 0, 0, (c.d / 0.34) * 0.82, c.h / 3.6, (c.d / 0.34) * 0.82), { swap: lime });
      box3(o, { x: c.x, z: c.z, rot: 0, hw: c.d * 0.35, hd: c.d * 0.35 }, c.y, c.h, 'Lime');
    }
    box3(o, T.podium, T.podium.y, T.podium.h, 'Lime');
    if (T.cella) box3(o, T.cella, T.cella.y, T.cella.h + 0.4, 'Lime');
    count('templeColumns', T.columns.length);
  }
  if (mon?.palace && owners.has(mon.palace.owner)) {
    const Pm = mon.palace, o = Pm.owner;
    shellWalls(o, Pm.platform, Pm.platform.y, Pm.platform.h, 'ppl', undefined, { swap: lime });
    box3(o, Pm.platform, Pm.platform.y, Pm.platform.h, 'Lime');
    if (Pm.hall) box3(o, Pm.hall, Pm.hall.y, Pm.hall.h, 'Lime');
    for (const T of Pm.towers) box3(o, T, T.y, T.h, 'Lime');
    if (Pm.hall) {
      const Hh = Pm.hall;
      const front = facing(Hh, Pm.front);
      const doors = shellWalls(o, Hh, Hh.y, Hh.h, 'phl', undefined, { swap: lime, doorOf: (k) => (k === front ? { t: 0, name: 'door_3m', nominal: 3 } : null) });
      for (const dd of doors) { doorLeaves(o, dd.f, dd.m, dd.ky, 'palace'); darkRoom(o, dd.f, dd.m, dd.ky); }
    }
    // stepped parapets on the hall's roof slab (the model's, kept) and on the towers
    const stepped = (r: Rect, y: number, key: string) => {
      for (const sd of sides(r)) {
        const { f, L } = sideFrame(sd, y);
        const n = Math.max(1, Math.round(L / 2)), k = L / (2 * n);
        for (let i = 0; i < n; i++) add(o, 'parapet_stepped_2m', f.at(i * 2 * k, 0, 0, 0, k, 1, 1), { swap: lime, uo: i });
      }
      void key;
    };
    if (Pm.slab) stepped(Pm.slab, Pm.slab.y + Pm.slab.h, 'pslab');
    for (const [ti, T] of Pm.towers.entries()) {
      shellWalls(o, T, T.y, T.h - 0.4, `ptw${ti}`, undefined, { swap: lime });
      roofSlab(o, T, T.y + T.h - 0.4, `ptw${ti}`, [], lime);
      stepped({ ...T, hw: T.hw + 0.1, hd: T.hd + 0.1 }, T.y + T.h, `ptw${ti}`);
    }
    count('palace');
  }

  /** A market stall: the kit's stall on the layer's posts (counter toward the square's centre), its awning in the
   *  layer's colour, the layer's goods on the counter, a jar and sacks beside it, baskets under the counter. */
  function stall(it: Extract<Intent, { k: 'stall' }>) {
    const o = it.owner;
    const g = ctx.ground(it.x, it.z);
    const ux = -Math.sin(it.a), uz = Math.cos(it.a), vx = -Math.cos(it.a), vz = -Math.sin(it.a);
    // kit x along the arc (u), kit z toward the centre (v); right-handed: z = x turned a quarter = (−uz, ux)
    const f = new Frame(it.x, g, it.z, ux, uz, -uz, ux);
    const vSign = (-uz) * vx + ux * vz > 0 ? 1 : -1;
    const dye = P('stall_large')?.info.dye ?? [0.54, 0.17, 0.11];
    const cl = linRGB(it.cloth);
    const tint: [number, number, number] = [cl[0] / dye[0], cl[1] / dye[1], cl[2] / dye[2]];
    add(o, 'stall_large', f.at(0, 0, 0, 0, 0.94, 1, 0.89 * vSign), { tint, tintMat: TEXTILE });
    const at = (u: number, v: number) => f.at(u, 0, v * vSign);
    for (const gd of it.goods) {
      const y = 0.82;
      const m = f.at(gd.u, y, gd.v * vSign, gd.kind * 9, 0.75, 0.75, 0.75);
      if (gd.kind < 0.3) add(o, 'basket_grain', m, { near: true });
      else if (gd.kind < 0.6) add(o, ctx.u(`kgj:${it.i}:${gd.u.toFixed(2)}`) < 0.5 ? 'jug_small' : 'bowl_stack', f.at(gd.u, y, gd.v * vSign, gd.kind * 9, 1.1, 1.1, 1.1), { near: true });
      else if (gd.kind < 0.8) add(o, 'basket_tall', f.at(gd.u, y, gd.v * vSign, gd.kind * 9, 0.6, 0.45, 0.6), { near: true });
      else add(o, 'mat_rolled', f.at(gd.u, y + 0.02, gd.v * vSign, 0.1, 0.4, 1, 1), { near: true, tint: tintCloth(gd.c) });
    }
    if (it.jar) add(o, ctx.u(`ksj:${it.i}`) < 0.5 ? 'pithos' : 'jar_storage', f.at(1.75, 0, 0.2 * vSign, it.i, 0.68, 0.68, 0.68));
    // sacks where the layer put one, more behind the counter, baskets under it
    add(o, ctx.u(`kss:${it.i}`) < 0.5 ? 'sack_closed' : 'sack_open', at(-1.75, 0.3));
    add(o, pick(['sack_closed', 'sack_slumped', 'sack_open'], ctx.u(`kss2:${it.i}`)), f.at(-0.9, 0, -0.55 * vSign, 1.3 + it.i), { near: true });
    if (ctx.u(`kss3:${it.i}`) < 0.6) add(o, pick(['sack_closed', 'basket_tall'], ctx.u(`kss4:${it.i}`)), f.at(0.85, 0, -0.6 * vSign, 0.4 + it.i), { near: true });
    add(o, pick(['basket_grain', 'basket_tall', 'tray_winnowing'], ctx.u(`ksb:${it.i}`)), f.at(-0.4, 0, 0.45 * vSign, it.i * 1.7, 0.85, 0.85, 0.85), { near: true });
    count('stalls');
  }

  // ---------------------------------------------------------------- the city walls, towers, gates
  const W = ctx.plan.walls;
  if (W) {
    W.runs.forEach((r, i) => {
      const owner = ctx.owners.get(`wr:${i}`);
      if (owner < 0 || !owners.has(owner)) return;
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      const tx = (r.x1 - r.x0) / len, tz = (r.z1 - r.z0) / len;
      const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
      // kit: the outside of the city is +z; z = x turned a quarter = (−tz, tx): if that points in, run the other way
      let ox = r.x0, oz = r.z0, fx = tx, fz = tz;
      if (-tz * mx + tx * mz < 0) { ox = r.x1; oz = r.z1; fx = -tx; fz = -tz; }
      const f = new Frame(ox, 0, oz, fx, fz, -fz, fx);
      const n = Math.max(1, Math.round(len / 4)), k = len / (4 * n);
      for (let j = 0; j < n; j++) add(owner, 'citywall_4m', f.at(j * 4 * k, 0, 0, 0, k, W.H / 6.8, W.T / 3.36), { uo: j * 2 });
      add(owner, '_box', f.at(len / 2, 0, 0, 0, len, W.H, W.T), { lod3: 'only' });
      add(owner, '_box', f.at(len / 2, W.H, 1.45 * (W.T / 3.36), 0, len, 0.55, 0.45), { lod3: 'only' });
      count('wallRuns');
    });
    for (const tw of W.towers) {
      const owner = ctx.owners.id(`tw:${tw.x.toFixed(1)},${tw.z.toFixed(1)}`, tw.x, tw.z);
      if (!owners.has(owner)) continue;
      const ang = Math.atan2(tw.z, tw.x);
      // outside +z: the tower's local z along the radius
      const ox = Math.cos(ang), oz = Math.sin(ang);
      const f = new Frame(tw.x, 0, tw.z, oz, -ox, ox, oz);
      const s = (tw.half * 2) / 7.0;
      add(owner, 'gate_tower', f.at(0, 0, 0, 0, s, tw.top / 9.9, s));
      add(owner, '_box', f.at(0, 0, 0, 0, tw.half * 2, tw.top, tw.half * 2), { lod3: 'only' });
      count('towers');
    }
  }

  // ---------------------------------------------------------------- the river's banks: reeds, in the district only
  const L = ctx.plan.L, R = L.river, LOT = ctx.plan.LOT;
  if (R) {
    let k = 0;
    const step = 1.6;
    const reach = (ctx.limit ?? 200) + 10;
    for (let um = -reach; um < reach; um += step) {
      const u = um / LOT;
      const m = meander(R, u);
      for (const side of [-1, 1]) {
        const jit = ctx.u(`reed:${k}:${side}`);
        if (jit < 0.25) continue;
        // from the bed's edge outward: the first shallows or dry bank
        let best: [number, number] | null = null;
        for (let e = -0.25; e <= 0.55; e += 0.1) {
          const s = m + side * (R.half + e);
          const x = (R.ox + R.fx * u + R.nx * s) * LOT, z = (R.oz + R.fz * u + R.nz * s) * LOT;
          const dep = ctx.water(x, z);
          if (dep < 0.3) { best = [x, z]; break; }
        }
        if (!best || !opts.inside(best[0], best[1])) continue;
        if (ctx.plan.bridges.some((b) => Math.hypot(b.x - best![0], b.z - best![1]) < b.hw + 2.5 && riverDist(L, best![0] / LOT, best![1] / LOT).d < 1)) continue;
        if (ctx.occ.blocked(best[0], best[1], 0.6, ctx.ground(best[0], best[1]) + 0.2, ctx.ground(best[0], best[1]) + 2)) continue;
        const owner = ctx.owners.id(`reed:${k}:${side}`, best[0], best[1]);
        owners.add(owner);
        const g = ctx.ground(best[0], best[1]);
        const rot = jit * 40;
        const f = yawFrame(best[0], g - 0.05, best[1], rot);
        const pickR = ctx.u(`reedk:${k}:${side}`);
        if (pickR < 0.3) {
          // a strip of low reeds along the bank
          const tx = R.fx + (R.nx * (meander(R, u + 0.05) - m)) / 0.05, tz = R.fz + (R.nz * (meander(R, u + 0.05) - m)) / 0.05;
          const l = Math.hypot(tx, tz);
          add(owner, 'reed_edge_4m', new Frame(best[0], g - 0.05, best[1], tx / l, tz / l, -tz / l, tx / l).at(-2, 0, 0, 0, 1, 0.9 + 0.3 * jit, 1), { noShadow: true });
        } else add(owner, pickR < 0.65 ? 'reeds_a' : 'reeds_b', f.at(0, 0, 0, 0, 0.8 + 0.4 * jit, 0.75 + 0.45 * jit, 0.8 + 0.4 * jit));
        count('reeds');
      }
      k++;
    }
  }

  // ---------------------------------------------------------------- grass and weeds along the feet of walls
  H.forEach((h, i) => {
    if (h.kind !== 'house') return;
    const owner = houseOwner(ctx, i);
    if (!owners.has(owner)) return;
    const d = ctx.dress[i];
    for (const s of ctx.sides[i]) {
      if (s.open < 1.2) continue;
      const n = Math.floor((s.half * 2) / 1.3);
      for (let j = 0; j < n; j++) {
        const u = ctx.u(`kg:${h.id}:${s.k}:${j}`);
        if (u > (s.court ? 0.55 : 0.32)) continue;
        const t = -s.half + 0.4 + (j + ctx.u(`kgt:${h.id}:${s.k}:${j}`)) * ((s.half * 2 - 0.8) / n);
        if (d.door && d.door.k === s.k && Math.abs(t - d.door.t) < 1.3) continue;
        if (d.gaps.some((gp) => gp.k === s.k && Math.abs(gp.t - t) < 0.9)) continue;
        const off = 0.12 + 0.28 * ctx.u(`kgo:${h.id}:${s.k}:${j}`);
        const x = s.x + s.tx * t + s.nx * off, z = s.z + s.tz * t + s.nz * off;
        const g = ctx.ground(x, z);
        if (ctx.water(x, z) > 0 || ctx.occ.blocked(x, z, 0.12, g + 0.05, g + 0.6)) continue;
        const kind = pick(['grass_a', 'grass_b', 'grass_c', 'grass_b', 'weed_thistle', 'weed_stalks'], ctx.u(`kgk:${h.id}:${s.k}:${j}`));
        const sc = 0.7 + 0.5 * u;
        add(owner, kind, yawFrame(x, g - 0.02, z, u * 31).at(0, 0, 0, 0, sc, sc, sc), { near: true, noShadow: true });
        count('weeds');
      }
    }
  });

  return { byOwner, counts };
}

/** A cloth tint: the layer's (sRGB) colour against the kit's near-white linen. */
function tintCloth(c: RGB): [number, number, number] {
  const l = linRGB(c);
  return [Math.min(1.4, l[0] / 0.66), Math.min(1.4, l[1] / 0.57), Math.min(1.4, l[2] / 0.41)];
}
