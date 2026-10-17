// Streets world: the hero district. Inside it, after the runner's first step, the modular kit built in Blender
// (kitload.ts) replaces the city model's boxes and the streets layer's primitives, lot for lot: the same houses at the
// same footprints and heights, the same parapets, ladders, stairs, jars and stalls at the same places, so every
// collider the world made at load stays true (nothing in the physics changes). Outside it, the town stays as it was.
//
// The shape: the cheapest that covers what the first days need: the errand's street route from the door of the
// house of tablets to the river gate (a corridor along it), the temple square and its market, the palace and its
// gate, the house of tablets, the nearest bridges over the river and their banks, the well, and the river gate.
//
// Streaming: the kit loads after the first frame (the player starts in today's city), the houses' pack first; the
// district is cut into square cells, built nearest first, and each cell fades in (a dithered alpha, so no sorting)
// over the boxes it replaces, which then go. Each cell draws one mesh per material at LOD0/LOD1 and a single
// untextured mesh at LOD2, chosen by distance (kit.json's lodDistances; phones skip LOD0 and use the halved ones).
// `ready` resolves when the cells near the runner are in.

import { type BufferAttribute, type Camera, Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import type { Ctx } from './ctx.ts';
import type { Layer } from './layer.ts';
import { type DrawnPart, allParts, hidePart, inside, shrinkPart } from './plan.ts';
import { type MonBox, type Monuments, assemble } from './assemble.ts';
import type { CityModel } from '../../../three/city/model.ts';
import { type KitPiece, type KitPrim, type LoadedKit, loadKit } from './kitload.ts';
import { type CellMeshes, type KInst, farMaterial, mergeCell, mergeJob } from './kitmesh.ts';

export interface DistrictShape {
  /** The bounding circle (m), and an outline (the furthest point inside along 96 rays from the centre). */
  center: { x: number; z: number };
  radius: number;
  polygon: [number, number][];
  contains(x: number, z: number): boolean;
}

export interface District extends DistrictShape {
  /** Everything the kit draws (cells and their LODs), under the world's root. */
  group: Group;
  /** Resolves when the cells near the runner are drawn by the kit (or the kit could not load: see `error`). */
  ready: Promise<void>;
  tier: 'hi' | 'lo';
  error: string | null;
  /** Begin loading (idempotent; the world calls it after the first frame). */
  start(renderer: unknown): void;
  /** Per frame: LODs, builds and fades by the camera's place. */
  tick(camera: Camera, renderer: unknown, scene: Object3D): void;
  stats(): Record<string, unknown>;
  breakdown(lod?: number): string[];
  debugVisible(): string[];
  dispose(): void;
}

type V2 = { x: number; z: number };
const segDist = (px: number, pz: number, a: V2, b: V2) => {
  const vx = b.x - a.x, vz = b.z - a.z, l = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / l));
  return Math.hypot(px - a.x - vx * t, pz - a.z - vz * t);
};

/** The district's shape on Pumi's plan (or any city with the same places): discs and capsules, unioned. */
export function districtShape(layer: Layer, ctx: Ctx): DistrictShape {
  const plan = ctx.plan;
  const places = layer.affordances.places;
  const at = (id: string) => places.find((p) => p.id === id) ?? null;
  const discs: { x: number; z: number; r: number }[] = [];
  const caps: { a: V2; b: V2; r: number }[] = [];
  // the temple square and its market
  discs.push({ x: 0, z: 0, r: plan.plazaR + 10 });
  // the house of tablets (its house, not just its door), the palace and its gate, the well
  const tab = layer.civ.tablet;
  if (tab) { const h = plan.houses[tab.house]; discs.push({ x: h.x, z: h.z, r: 22 }); }
  if (plan.palace) discs.push({ x: plan.palace.x, z: plan.palace.z, r: Math.max(plan.palace.hw, plan.palace.hd) + 10 });
  const well = at('well');
  if (well) discs.push({ x: well.pos.x, z: well.pos.z, r: 12 });
  // the errand's way: the street route from the house of tablets to the river gate, and the gate itself
  const from = at('tablet-house'), gate = places.find((p) => p.kind === 'gate' && /river/i.test(p.name)) ?? null;
  if (from && gate) {
    const r = layer.route(from.pos, gate.pos, 3);
    if (r) for (let i = 1; i < r.pts.length; i++) caps.push({ a: r.pts[i - 1], b: r.pts[i], r: 22 });
    const g = layer.civ.gates.find((x) => Math.hypot(x.inner.x - gate.pos.x, x.inner.z - gate.pos.z) < 1);
    discs.push({ x: g ? g.x : gate.pos.x, z: g ? g.z : gate.pos.z, r: 26 });
  }
  // the bridges near the square, and the river under them
  for (const b of plan.bridges) {
    if (Math.hypot(b.x, b.z) > 75) continue;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    caps.push({ a: { x: b.x - c * b.hw, z: b.z + s * b.hw }, b: { x: b.x + c * b.hw, z: b.z - s * b.hw }, r: 16 });
  }
  const contains = (x: number, z: number) =>
    discs.some((d) => Math.hypot(x - d.x, z - d.z) <= d.r) || caps.some((c) => segDist(x, z, c.a, c.b) <= c.r);
  // centre and radius from a 2 m raster of the union
  let sx = 0, sz = 0, n = 0;
  const lim = (ctx.limit ?? 200) + 30;
  for (let x = -lim; x <= lim; x += 2) for (let z = -lim; z <= lim; z += 2) if (contains(x, z)) { sx += x; sz += z; n++; }
  const cx = n ? sx / n : 0, cz = n ? sz / n : 0;
  let radius = 0;
  for (let x = -lim; x <= lim; x += 2) for (let z = -lim; z <= lim; z += 2) if (contains(x, z)) radius = Math.max(radius, Math.hypot(x - cx, z - cz));
  const polygon: [number, number][] = [];
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let far = 0;
    for (let t = 0; t <= radius + 2; t += 1) if (contains(cx + dx * t, cz + dz * t)) far = t;
    polygon.push([Math.round((cx + dx * far) * 10) / 10, Math.round((cz + dz * far) * 10) / 10]);
  }
  return { center: { x: Math.round(cx * 10) / 10, z: Math.round(cz * 10) / 10 }, radius: Math.ceil(radius), polygon, contains };
}

interface Cell {
  key: string;
  owners: number[];
  insts: KInst[];
  /** The model's parts for the cell's owners (house boxes, wall runs, towers …); `keep`: only shrunk, never hidden. */
  parts: { p: DrawnPart; keep: boolean }[];
  x0: number; z0: number; x1: number; z1: number;
  lod: number;
  want: number;
  lods: (Group | null)[];
  state: 'proc' | 'compiling' | 'fading' | 'kit';
  fade: number;
  twins: Material[];
  tris: number[];
}

const CELL = 24;

/** The temple's and the palace's parts as the model drew them, and which of them the kit replaces (hide) or only
 *  covers (keep: their tops stay, shrunk a little behind the kit's walls). */
function monuments(ctx: Ctx, layer: Layer, model: CityModel, parts: Map<number, { p: DrawnPart; keep: boolean }[]>): Monuments {
  const plan = ctx.plan, L = plan.LOT;
  const all = allParts(model.group);
  const box = (p: DrawnPart): MonBox => ({ x: p.x * L, z: p.z * L, rot: p.rot, hw: (p.sx * L) / 2, hd: (p.sz * L) / 2, y: p.y * L, h: p.sy * L });
  const within = (r: { x: number; z: number; rot: number; hw: number; hd: number }, m: number) => all.filter((p) => inside(r, p.x * L, p.z * L, m));
  const out: Monuments = {};
  const T = plan.temple, o = ctx.owners.get('temple');
  if (T && o >= 0) {
    const here = within(T, 2);
    const boxes = here.filter((p) => p.mesh.geometry.type === 'BoxGeometry');
    const pod = boxes.filter((p) => Math.abs(p.y) < 1e-3).sort((a, b) => b.sx * b.sz - a.sx * a.sz)[0];
    if (pod) {
      const cella = boxes.find((p) => Math.abs(p.y - pod.sy) < 1e-3 && p.sy > 0.5) ?? null;
      const cols = here.filter((p) => p.mesh.geometry.type === 'CylinderGeometry' && p.sy * L > 3);
      out.temple = {
        owner: o, podium: box(pod), cella: cella ? box(cella) : null,
        columns: cols.map((p) => ({ x: p.x * L, y: p.y * L, z: p.z * L, d: p.sx * L, h: p.sy * L })),
        front: layer.civ.temple?.foot ?? null,
      };
      parts.set(o, [{ p: pod, keep: true }, ...(cella ? [{ p: cella, keep: false }] : []), ...cols.map((p) => ({ p, keep: false }))]);
    }
  }
  const Pl = plan.palace, po = ctx.owners.get('palace');
  if (Pl && po >= 0) {
    const boxes = within(Pl, 3).filter((p) => p.mesh.geometry.type === 'BoxGeometry');
    const plat = boxes.filter((p) => Math.abs(p.y) < 1e-3).sort((a, b) => b.sx * b.sz - a.sx * a.sz)[0];
    if (plat) {
      const top = plat.y + plat.sy;
      const hall = boxes.filter((p) => Math.abs(p.y - top) < 1e-3 && p.sx > plat.sx * 0.4).sort((a, b) => b.sx * b.sz - a.sx * a.sz)[0] ?? null;
      const slab = hall ? boxes.find((p) => Math.abs(p.y - (hall.y + hall.sy)) < 1e-3 && p.sy < 0.2) ?? null : null;
      const towers = boxes.filter((p) => Math.abs(p.y - top) < 1e-3 && p !== hall && Math.abs(p.sx - p.sz) < 1e-3 && p.sy * L > 6);
      out.palace = { owner: po, platform: box(plat), hall: hall ? box(hall) : null, slab: slab ? box(slab) : null, towers: towers.map(box), front: layer.civ.palace?.foot ?? { x: Pl.gate.x, z: Pl.gate.z } };
      parts.set(po, [{ p: plat, keep: true }, ...(hall ? [{ p: hall, keep: false }] : []), ...towers.map((p) => ({ p, keep: false }))]);
    }
  }
  return out;
}

export function createDistrict(inp: { ctx: Ctx; layer: Layer; model: CityModel; mobile: boolean; reduced: boolean; root: Group }): District {
  const { ctx, layer, mobile } = inp;
  const shape = districtShape(layer, ctx);
  const group = new Group();
  group.name = 'hero-district';
  inp.root.add(group);
  const tier: 'hi' | 'lo' = mobile ? 'lo' : 'hi';
  const plan = ctx.plan;
  // every owner the district can redraw: the layer's, plus the city walls' runs and towers
  if (plan.walls) {
    plan.walls.runs.forEach((r, i) => ctx.owners.id(`wr:${i}`, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2));
    for (const tw of plan.walls.towers) ctx.owners.id(`tw:${tw.x.toFixed(1)},${tw.z.toFixed(1)}`, tw.x, tw.z);
  }
  const owners = new Set<number>();
  ctx.owners.pos.forEach((p, i) => { if (shape.contains(p.x, p.z)) owners.add(i); });
  // the model's own parts per owner
  const partsOf = new Map<number, { p: DrawnPart; keep: boolean }[]>();
  const hide = (ps: DrawnPart[]) => ps.map((p) => ({ p, keep: false }));
  plan.houses.forEach((h, i) => { const o = ctx.owners.get(`h:${i}`); if (o >= 0 && owners.has(o) && h.parts) partsOf.set(o, hide(h.parts)); });
  if (plan.walls) {
    plan.walls.runs.forEach((r, i) => { const o = ctx.owners.get(`wr:${i}`); if (owners.has(o)) partsOf.set(o, hide([r.part])); });
    for (const tw of plan.walls.towers) { const o = ctx.owners.get(`tw:${tw.x.toFixed(1)},${tw.z.toFixed(1)}`); if (owners.has(o)) partsOf.set(o, hide([tw.part])); }
  }
  const mons = monuments(ctx, layer, inp.model, partsOf);

  let kit: LoadedKit | null = null;
  const arch = new Set<number>(), quiet = new Set<number>(), near1 = new Set<number>();
  let farMat: MeshStandardMaterial | null = null;
  const cells: Cell[] = [];
  let started = false;
  let error: string | null = null;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => { resolveReady = r; });
  let readyDone = false;
  let nearRing: Cell[] | null = null;
  const stats: Record<string, unknown> = { tier, owners: owners.size, cells: 0 };
  let lastCam: { x: number; z: number } | null = null;
  // the kit's LOD1 is nearly LOD0 on screen (kit renders: build/kit/renders/arch_lods.png) at half the triangles, and
  // its LOD2 holds up from a street's width: LOD1 near, LOD2 beyond (LOD0 stays in the kit for close renders)
  const lodDist = mobile ? [0, 0, 8, 20] : [0, 0, 20, 64];
  const NEAR_READY = mobile ? 24 : 40;
  const FADE = inp.reduced ? 0 : 0.6;
  let pending: { cell: Cell; lod: number } | null = null;
  let compileP: Promise<unknown> | null = null;
  let frame = 0;
  let mainCamera: Camera | null = null;
  const graveyard: { at: number; free: () => void }[] = [];
  /** Pools: cells settled at one far LOD drawn as one mesh (LOD2 per 48 m block, LOD3 all together), rebuilt by a
   *  job when their members change; meanwhile (a "broken" pool) every member draws its own group. */
  interface Pool { key: string; level: number; group: Group | null; members: Set<Cell>; tris: number; job: { set: Set<Cell>; gen: Generator<void, CellMeshes>; ctl: { until: number } } | null }
  const pools = new Map<string, Pool>();
  let poolBuilds = 0;
  const pooled = (c: Cell) => { const p = pools.get(poolKey(c, c.lod)); return !!p && !!p.group && p.members.has(c); };
  function poolKey(c: Cell, level: number) {
    if (level === 3) return 'L3';
    if (level !== 2) return '';
    return `L2:${Math.floor((c.x0 + c.x1) / 2 / 48)},${Math.floor((c.z0 + c.z1) / 2 / 48)}`;
  }
  const ownerCells = new Map<number, Cell[]>();
  const settled = new Map<number, number>(); // owner → 1 (its primitives gone, boxes shrunk), 2 (boxes gone)
  /** An owner's primitives go when all its cells have started to fade in; its boxes when all have finished. */
  function settle(o: number) {
    const cs = ownerCells.get(o) ?? [];
    const st = settled.get(o) ?? 0;
    const parts = partsOf.get(o) ?? [];
    if (st < 1 && cs.every((c) => c.state !== 'proc')) {
      layer.kit.hideOwner(o);
      for (const { p } of parts) shrinkPart(p, 0.03, plan.LOT);
      settled.set(o, 1);
    }
    if ((settled.get(o) ?? 0) < 2 && cs.every((c) => c.state === 'kit')) {
      for (const { p, keep } of parts) if (keep) shrinkPart(p, 0.03, plan.LOT); else hidePart(p);
      settled.set(o, 2);
    }
  }

  /** The cells from the assembled pieces, by owner's place. */
  function buildCells(k: LoadedKit) {
    const t0 = performance.now();
    const out = assemble(ctx, k, owners, { inside: shape.contains, mobile, monuments: mons });
    const byKey = new Map<string, Cell>();
    const cellAt = (key: string) => {
      let c = byKey.get(key);
      if (!c) {
        c = { key, owners: [], insts: [], parts: [], x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, lod: -1, want: -1, lods: [null, null, null, null], state: 'proc', fade: 0, twins: [], tris: [0, 0, 0, 0] };
        byKey.set(key, c);
      }
      return c;
    };
    for (const [o, insts] of out.byOwner) {
      const p = ctx.owners.pos[o];
      // a great owner (the palace, the temple) is cut into its own cells, so no one build is long
      const big = insts.length > 400;
      const home = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
      const mine = new Set<Cell>();
      for (const it of insts) {
        const x = it.m[12], z = it.m[14];
        const c = cellAt(big ? `o${o}:${Math.floor(x / CELL)},${Math.floor(z / CELL)}` : home);
        c.insts.push(it);
        c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.z0 = Math.min(c.z0, z); c.z1 = Math.max(c.z1, z);
        mine.add(c);
      }
      for (const c of mine) c.owners.push(o);
      ownerCells.set(o, [...mine]);
      // the model's parts go with the owner's first cell; they go once all its cells are in (settle)
      [...mine][0]?.parts.push(...(partsOf.get(o) ?? []));
    }
    // owners with parts but no kit pieces of their own (none expected) still count toward their cell
    cells.push(...byKey.values());
    stats.cells = cells.length;
    stats.pieces = cells.reduce((a, c) => a + c.insts.length, 0);
    stats.assemble = out.counts;
    stats.assembleMs = Math.round(performance.now() - t0);
  }

  const distTo = (c: Cell, x: number, z: number) => Math.hypot(Math.max(c.x0 - x, 0, x - c.x1), Math.max(c.z0 - z, 0, z - c.z1));
  const lodFor = (c: Cell, d: number) => {
    const cur = c.lod;
    const hy = 3;
    let want = 1;
    // a threshold eases toward the LOD the cell already shows (no flicker at the line)
    for (let l = want; l < 4; l++) if (d >= lodDist[l] + (cur < 0 ? 0 : cur >= l ? -hy : hy)) want = l;
    return want;
  };

  function start(renderer: unknown) {
    if (started) return;
    started = true;
    const t0 = performance.now();
    loadKit(renderer, tier, { order: ['arch'], foliageA2C: !mobile })
      .then((k) => {
        kit = k;
        addRoom(k);
        addBoxes(k);
        // what stays textured at the middle LOD: the walls, roofs and their plaster (props fold into the plain mesh)
        for (const n of ['M_MudPlaster', 'M_MudPlaster_Lime', 'M_MudBrick', 'M_RoofMud']) { const i = k.matIndex(n); if (i >= 0) arch.add(i); }
        // textured at LOD1 on desktop: the walls and roofs, timber, pottery and the stalls' cloth (the rest folds into
        // the plain mesh: a few small things and the trees' bark, not worth a draw call each per cell)
        for (const n of [...arch].map((i) => k.matNames[i]).concat(['M_Timber', 'M_Terracotta', 'M_Textile'])) { const i = k.matIndex(n); if (i >= 0) near1.add(i); }
        // small things whose own shadow pass costs more than it shows (their contact shading is baked in COLOR_0)
        for (const n of ['M_Basketry', 'M_Hessian', 'M_Grain', 'M_ClayRaw', 'M_StructMisc']) { const i = k.matIndex(n); if (i >= 0) quiet.add(i); }
        farMat = farMaterial();
        buildCells(k);
        stats.loadMs = Math.round(performance.now() - t0);
        stats.kit = k.stats;
      })
      .catch((e) => {
        error = String((e as Error)?.message ?? e);
        console.warn(`streets: the kit could not load (${error}); the district stays as the model drew it`);
        readyDone = true;
        resolveReady();
      });
  }

  function twin(m: Material): Material {
    const t = m.clone();
    t.transparent = false;
    t.alphaHash = true;
    t.opacity = 0;
    t.userData.kit = true;
    return t;
  }

  /** Make a built LOD the cell's visible one: the first time, fade it in over the model's boxes. */
  function show(c: Cell, lod: number, renderer: unknown, scene: Object3D) {
    const g = c.lods[lod]!;
    for (let l = 0; l < 4; l++) if (c.lods[l]) c.lods[l]!.visible = l === lod;
    c.lod = lod;
    if (c.state !== 'proc') return;
    if (FADE <= 0) { finish(c); return; }
    // fade: the cell's meshes on dithered twins of their materials, the boxes shrunk a little behind them
    const twins = new Map<Material, Material>();
    g.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const mat = m.material as Material;
      let t = twins.get(mat);
      if (!t) { t = twin(mat); twins.set(mat, t); }
      m.userData.solid = mat;
      m.material = t;
    });
    c.twins = [...twins.values()];
    c.state = 'compiling';
    for (const o of c.owners) settle(o);
    // compile the dithered variants before the first fade shows (later cells reuse the programs)
    // (WebGLRenderer only: WebGPURenderer builds its pipelines asynchronously by itself)
    const r = renderer as { compileAsync?: (o: Object3D, cam: Camera, s?: Object3D) => Promise<unknown>; isWebGLRenderer?: boolean };
    if (r.isWebGLRenderer && r.compileAsync && mainCamera) {
      compileP = r.compileAsync(g, mainCamera, scene).catch(() => null).then(() => { c.state = 'fading'; c.fade = 0; compileP = null; });
    } else { c.state = 'fading'; c.fade = 0; }
  }

  function finish(c: Cell) {
    for (const g of c.lods) g?.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.userData.solid) { m.material = m.userData.solid; delete m.userData.solid; } });
    for (const t of c.twins) graveyard.push({ at: frame + 3, free: () => t.dispose() });
    c.twins = [];
    c.state = 'kit';
    for (const o of c.owners) settle(o);
  }

  /** The build under way: a merge job that runs a few milliseconds a frame. */
  let job: { cell: Cell; lod: number; gen: Generator<void, CellMeshes>; ctl: { until: number } } | null = null;
  function startBuild(c: Cell, lod: number) {
    if (!kit || !farMat) return;
    // near (LOD1): textured on desktop but for the small props' materials (they fold into the plain mesh, as at LOD2),
    // the walls' and roofs' only on phones; far (LOD2): one plain mesh
    const keep = lod <= 1 ? (mobile ? (m: number) => arch.has(m) : (m: number) => near1.has(m)) : () => false;
    const ctl = { until: 0 };
    job = { cell: c, lod, ctl, gen: mergeJob(c.insts, lod, kit, keep, farMat, `kit-${c.key}-L${lod}`, (m) => !quiet.has(m), ctl, mobile && lod === 1 ? 2 : undefined) };
  }
  /** Work on the build until the deadline; true when a cell's LOD was finished (and shown). */
  function runBuild(until: number, renderer: unknown, scene: Object3D): boolean {
    if (!job) return false;
    job.ctl.until = until;
    const r = job.gen.next();
    if (!r.done) return false;
    const { cell: c, lod } = job;
    job = null;
    finishBuild(c, lod, r.value);
    show(c, lod, renderer, scene);
    return true;
  }
  function finishBuild(c: Cell, lod: number, r: CellMeshes) {
    const prev = c.lods[lod];
    if (prev) freeGroup(prev);
    const g = new Group();
    g.name = `kit-cell-${c.key}-L${lod}`;
    for (const m of r.meshes) g.add(m);
    g.visible = false;
    group.add(g);
    c.lods[lod] = g;
    c.tris[lod] = r.tris;
    (stats.builds as number[] | undefined)?.push(Math.round(r.ms * 10) / 10);
  }
  stats.builds = [] as number[];

  const freeGroup = (g: Group) => { group.remove(g); g.traverse((o) => { const m = o as Mesh; if (m.isMesh) graveyard.push({ at: frame + 3, free: () => m.geometry.dispose() }); }); };
  const sameSet = (a: Set<Cell>, b: Set<Cell>) => a.size === b.size && [...a].every((c) => b.has(c));

  /** Keep the pools: each pool's members are its cells settled (and built) at its level; a change breaks the pool
   *  (members draw their own groups) and starts a job; a finished job whose set still holds becomes the pool. */
  function tendPools(until: number) {
    if (!kit || !farMat) return;
    const want = new Map<string, Set<Cell>>();
    for (const c of cells) {
      if (c.state !== 'kit' || (c.lod !== 2 && c.lod !== 3) || !c.lods[c.lod]) continue;
      const k = poolKey(c, c.lod);
      let w = want.get(k);
      if (!w) { w = new Set(); want.set(k, w); }
      w.add(c);
    }
    for (const k of new Set([...want.keys(), ...pools.keys()])) {
      const set = want.get(k) ?? new Set<Cell>();
      let p = pools.get(k);
      if (!p) { p = { key: k, level: k === 'L3' ? 3 : 2, group: null, members: new Set(), tris: 0, job: null }; pools.set(k, p); }
      if (p.group && !sameSet(p.members, set)) { freeGroup(p.group); p.group = null; p.members = new Set(); p.tris = 0; }
      if (p.job && !sameSet(p.job.set, set)) p.job = null; // stale: start again
      if (!p.group && !p.job && set.size >= 2) {
        const ctl = { until: 0 };
        // (on phones the far pools cast no shadow: the phone's shadow covers ±22 m, where cells are nearer LODs)
        p.job = { set, ctl, gen: mergeJob([...set].flatMap((c) => c.insts), p.level, kit, () => false, farMat, `kit-pool-${k}`, (m) => !mobile && !quiet.has(m), ctl) };
      }
    }
    // work on the pools' jobs in what is left of the frame
    for (const p of pools.values()) {
      if (!p.job || performance.now() > until) continue;
      p.job.ctl.until = until;
      const r = p.job.gen.next();
      if (!r.done) continue;
      const g = new Group();
      g.name = `kit-pool-${p.key}`;
      for (const m of r.value.meshes) g.add(m);
      group.add(g);
      p.group = g;
      p.members = p.job.set;
      p.tris = r.value.tris;
      p.job = null;
      poolBuilds++;
    }
    // what draws: an intact pool's group, else each cell's own group for its LOD
    for (const c of cells) {
      if (c.lod < 0) continue;
      const inPool = pooled(c);
      for (let l = 0; l < 4; l++) if (c.lods[l]) c.lods[l]!.visible = !inPool && l === c.lod;
    }
  }

  function tick(camera: Camera, renderer: unknown, scene: Object3D) {
    frame++;
    while (graveyard.length && graveyard[0].at <= frame) graveyard.shift()!.free();
    // the game's own camera: the first perspective one seen (a mirror or shadow pass renders with others)
    if (!mainCamera && (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera) mainCamera = camera;
    if (camera !== mainCamera) return;
    if (!started) { if (frame > 2) start(renderer); return; }
    if (!kit || !cells.length) return;
    const cx = camera.position.x, cz = camera.position.z;
    lastCam = { x: cx, z: cz };
    // what each cell wants, and the nearest one still to build
    let next: { cell: Cell; lod: number; d: number } | null = null;
    const has = (c: Cell, l: number) => !!c.lods[l];
    for (const c of cells) {
      const d = distTo(c, cx, cz);
      c.want = lodFor(c, d);
      if (!has(c, c.want) && (!next || d < next.d)) next = { cell: c, lod: c.want, d };
      if (c.lods[c.want] && c.lod !== c.want && c.state !== 'compiling') show(c, c.want, renderer, scene);
    }
    if (!nearRing) nearRing = cells.filter((c) => distTo(c, cx, cz) < NEAR_READY);
    // build: a few milliseconds a frame, the nearest cell first (a long merge pauses and goes on next frame)
    const t0 = performance.now();
    const until = t0 + (mobile ? 2.5 : 3);
    let guard = 0;
    while (!compileP && guard++ < 8) {
      if (!job) {
        if (!next) break;
        startBuild(next.cell, next.lod);
        next = null;
      }
      if (!runBuild(until, renderer, scene)) break;
      if (performance.now() > until) break;
      next = null;
      for (const c of cells) {
        if (has(c, c.want)) continue;
        const d = distTo(c, cx, cz);
        if (!next || d < next.d) next = { cell: c, lod: c.want, d };
      }
    }
    // the pools: every few frames, or every frame while one is being rebuilt
    if (frame % 4 === 0 || [...pools.values()].some((p) => p.job)) tendPools(until + 1);
    // fades
    const dt = 1 / 60;
    for (const c of cells) {
      if (c.state !== 'fading') continue;
      c.fade += dt / FADE;
      const a = Math.min(1, c.fade);
      for (const t of c.twins) t.opacity = a;
      if (a >= 1) finish(c);
    }
    // drop the detailed LODs of cells far behind (memory), keep the far one
    if (frame % 30 === 0) {
      for (const c of cells) for (let l = 0; l < 3; l++) {
        const g = c.lods[l];
        if (!g || c.lod === l || c.want === l) continue;
        if (distTo(c, cx, cz) < lodDist[l + 1] + 30) continue;
        c.lods[l] = null;
        // freed a few frames later: this frame's earlier passes (shadows, a pre-pass) may still have it queued
        freeGroup(g);
      }
    }
    if (!readyDone && nearRing && nearRing.every((c) => c.state === 'fading' || c.state === 'kit')) {
      readyDone = true;
      stats.readyMs = Math.round(performance.now() - (stats.t0 as number));
      resolveReady();
    }
  }
  stats.t0 = performance.now();

  return {
    ...shape, group, ready, tier,
    get error() { return error; },
    start, tick,
    stats() {
      const shown = cells.filter((c) => c.state !== 'proc');
      const byLod = [0, 0, 0, 0];
      let tris = 0;
      for (const c of shown) if (c.lod >= 0) { byLod[c.lod]++; if (!pooled(c)) tris += c.tris[c.lod]; }
      for (const p of pools.values()) tris += p.tris;
      let meshes = 0, geoBytes = 0;
      group.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        meshes++;
        for (const a of Object.values(m.geometry.attributes)) geoBytes += (a as BufferAttribute).array.byteLength;
        geoBytes += m.geometry.index?.array.byteLength ?? 0;
      });
      return { ...stats, pools: [...pools.values()].filter((p) => p.group).length, pooled: cells.filter(pooled).length, poolBuilds, ready: readyDone, error, cellsShown: shown.length, cellsByLod: byLod, triangles: Math.round(tris), meshes, geometryMB: Math.round(geoBytes / 1e5) / 10, camera: lastCam, polygonPoints: shape.polygon.length, center: shape.center, radius: shape.radius };
    },
    /** What draws (for tuning): each visible group, and the LOD its cell is at. */
    debugVisible() {
      const byGroup = new Map<Group, string>();
      for (const c of cells) c.lods.forEach((g, l) => { if (g) byGroup.set(g, `${c.key} L${l} cellLod=${c.lod} want=${c.want} state=${c.state} pooled=${pooled(c)}`); });
      return group.children.filter((g) => g.visible).map((g) => `${g.name}: ${byGroup.get(g as Group) ?? 'pool/orphan'}`);
    },
    /** Triangles per piece at a LOD over the whole district (for tuning). */
    breakdown(lod = 2) {
      const t = new Map<string, { n: number; tris: number }>();
      for (const c of cells) for (const it of c.insts) {
        if (lod >= 2 && it.near) continue;
        const e = t.get(it.piece.name) ?? { n: 0, tris: 0 };
        e.n++;
        e.tris += (it.piece.lods[lod] ?? []).reduce((a, p) => a + p.idx.length / 3, 0);
        t.set(it.piece.name, e);
      }
      return [...t.entries()].sort((a, b) => b[1].tris - a[1].tris).map(([k, v]) => `${k} ${v.n}× ${Math.round(v.tris)}`);
    },
    dispose() {
      group.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.geometry.dispose(); });
      for (const c of cells) for (const t of c.twins) t.dispose();
      farMat?.dispose();
      kit?.dispose();
      group.removeFromParent();
    },
  };
}

/** LOD3's plain boxes (base at y 0, unit size), one per material whose mean colour they take: plaster, roof, lime. */
function addBoxes(k: LoadedKit) {
  for (const [name, mn] of [['_box', 'M_MudPlaster'], ['_boxRoof', 'M_RoofMud'], ['_boxLime', 'M_MudPlaster_Lime']] as const) {
    const mat = k.matIndex(mn);
    if (mat < 0) continue;
    const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
    const faces: [number[], number[], number[]][] = [
      [[0.5, 0, 0.5], [0, 0, -1], [0, 1, 0]], [[-0.5, 0, -0.5], [0, 0, 1], [0, 1, 0]],
      [[-0.5, 0, 0.5], [1, 0, 0], [0, 1, 0]], [[0.5, 0, -0.5], [-1, 0, 0], [0, 1, 0]],
      [[-0.5, 1, 0.5], [1, 0, 0], [0, 0, -1]],
    ];
    for (const [o, u, v] of faces) {
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const b = pos.length / 3;
      for (const [a, c] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        pos.push(o[0] + u[0] * a + v[0] * c, o[1] + u[1] * a + v[1] * c, o[2] + u[2] * a + v[2] * c);
        nor.push(n[0], n[1], n[2]);
        const y = o[1] + v[1] * c;
        const sh = Math.round(255 * (0.78 + 0.22 * y));
        col.push(sh, sh, sh, 255);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const prim: KitPrim = { mat, pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(pos.length / 3 * 2), col: new Uint8Array(col), idx: new Uint32Array(idx), verts: pos.length / 3 };
    k.pieces.set(name, { name, info: { pack: 'synthetic', name, kind: 'lod3', snap: {}, pivot: '', lods: [], bbox: [[-0.5, 0, -0.5], [0.5, 1, 0.5]], notes: 'far stand-in box', materials: [mn], primitives: 1 }, lods: [[prim], [prim], [prim]], size: 1 });
  }
}

/** The dark room behind an open door: an inward-facing box (floor, ceiling, back and side walls; the front open), unit
 *  wide (x −0.5..0.5), tall (y 0..1) and deep (z 0..−1), in the plaster material with near-black vertex colours. */
function addRoom(k: LoadedKit) {
  const mat = k.matIndex('M_MudPlaster');
  if (mat < 0) return;
  // faces as [corner, u axis, v axis, shade]: each quad's normal (u × v) points into the room
  const quads: [number[], number[], number[], number][] = [
    [[-0.5, 0, 0], [1, 0, 0], [0, 0, -1], 0.13], // floor (normal +y)
    [[-0.5, 1, 0], [0, 0, -1], [1, 0, 0], 0.05], // ceiling (normal −y)
    [[-0.5, 0, -1], [1, 0, 0], [0, 1, 0], 0.08], // back wall (normal +z)
    [[-0.5, 0, 0], [0, 0, -1], [0, 1, 0], 0.07], // left wall (normal +x)
    [[0.5, 0, 0], [0, 1, 0], [0, 0, -1], 0.07], // right wall (normal −x)
  ];
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (const [o, u, v, sh] of quads) {
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const b = pos.length / 3;
    for (const [a, c] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      pos.push(o[0] + u[0] * a + v[0] * c, o[1] + u[1] * a + v[1] * c, o[2] + u[2] * a + v[2] * c);
      nor.push(n[0], n[1], n[2]);
      uv.push(a, c);
      const s = Math.round(sh * 255);
      col.push(s, s, Math.round(s * 0.9), 255);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const prim: KitPrim = { mat, pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), col: new Uint8Array(col), idx: new Uint32Array(idx), verts: pos.length / 3 };
  const piece: KitPiece = { name: '_room', info: { pack: 'synthetic', name: '_room', kind: 'interior', snap: {}, pivot: '', lods: [], bbox: [[-0.5, 0, -1], [0.5, 1, 0]], notes: 'dark room behind an open door', materials: ['M_MudPlaster'], primitives: 1 }, lods: [[prim], [prim], []], size: 1 };
  k.pieces.set('_room', piece);
}
