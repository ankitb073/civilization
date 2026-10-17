// Streets world: the streets layer. On the city model's own plan (read by plan.ts), deterministically (hashes of the
// city id, never Math.random), it adds what street level needs and returns what the runner needs: drawn parts
// (instanced, a dozen draw calls), colliders (boxes and convex hulls, in the world's `solids`), ladders, places and
// the water. Order matters: the big public works first, then stairs, planks and ladders (which open gaps in the
// parapets), then the facades and clutter that must keep clear of them.

import { type Group, InstancedMesh, Matrix4, type Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { Affordances, Ladder, Place } from '../affordances.ts';
import type { CityModel } from '../../../three/city/model.ts';
import type { CityRecord } from '../../../three/city/record.ts';
import { unit } from '../../../three/city/record.ts';
import { riverDist } from '../../../three/city/layout.ts';
import type { ArmsSpec } from '../../../../../engine/src/export/contract.ts';
import type { Solid } from '../world.ts';
import { type Ctx, Owners } from './ctx.ts';
import { Kit, SURFACE } from './kit.ts';
import { contactMaterial, mudSkin, plainMaterial } from './materials.ts';
import { compassGate, streetNames } from './names.ts';
import { Occupancy, type Plan, inside } from './plan.ts';
import { facades, houseStairs, lowWalls, measureSides, neighbourIndex, parapets, pickDoors, planks, roofClutter, streetClutter } from './houses.ts';
import { laddersAndReach, type Reach } from './reach.ts';
import { bridgeWorks, dyersStreet, emptyCivic, market, palaceSteps, people, pickTabletHouse, postern, tabletHouse, templeSteps, wallWorks, well, type Civic } from './civic.ts';
import { courtyardTrees, hearths, life, type Life } from './life.ts';
import { burntHouses } from './burnt.ts';
import { river, type River } from './water.ts';
import type { Smoke } from '../../../three/city/model.ts';

export interface LayerInput {
  rec: CityRecord;
  model: CityModel;
  plan: Plan;
  solids: Solid[];
  ground(x: number, z: number): number;
  mobile: boolean;
  reduced: boolean;
  scenario: { id: string; year: number; arms: ArmsSpec | null; sacked: boolean } | null;
  /** The year whose sack the town awaits (or suffered): the postern faces where it broke in. */
  sackYear: number | null;
  /** Give the merged meshes the surface attributes the realism look reads (aBox, aDim, aNrm; kit.ts). */
  tags?: boolean;
}

export interface Quarter { name: string; x: number; z: number; r: number }
export interface View { name: string; x: number; z: number; yaw: number; pitch: number; want?: number }

export interface Layer {
  group: Group;
  solids: Solid[];
  affordances: Affordances;
  quarters: Quarter[];
  river: River;
  riverName: string | null;
  hearth: Smoke[];
  life: Life;
  stats: Record<string, unknown>;
  civ: Civic;
  reach: Reach;
  /** What every part works from (owners and intents for the hero district), and the parts themselves. */
  ctx: Ctx;
  kit: Kit;
  views(): View[];
  loop(): { x: number; z: number; run?: boolean }[];
  /** Can a runner walk from the house of tablets to every place (raised ones: to the foot of their stairs)? */
  walkTest(): { id: string; name: string; ok: boolean; metres: number }[];
  /** A street route from a to b (A* on a 1 m grid, clear of everything solid near the ground and of water), as points
   *  every `every` metres along it, and its length (m); null when there is none. For errands and their bots. */
  route(a: { x: number; z: number }, b: { x: number; z: number }, every?: number): { pts: { x: number; z: number }[]; metres: number } | null;
  /** Per frame: time (s) and where the camera is (the near detail shows within reach of it). */
  tick(t: number, cam?: { x: number; z: number }): void;
  dispose(): void;
}

export function buildLayer(inp: LayerInput): Layer {
  const t0 = performance.now();
  const { rec, model, plan } = inp;
  const nearDist = inp.mobile ? 60 : 120;
  const LOT = plan.LOT;
  const kit = new Kit();
  const mud = mudSkin(plainMaterial(), 'detail');
  const plain = plainMaterial();
  // what each list is made of: fixed for mud and jars, read from each part's colour for the lists that draw many things
  kit.define('mud', 'box', mud, { cast: true, surface: SURFACE.masonry });
  kit.define('wood', 'box', plain, { cast: true });
  kit.define('cloth', 'box', plain, { cast: true });
  kit.define('pole', 'cyl', plain, { cast: true });
  kit.define('jar', 'jar', plain, { cast: true, surface: SURFACE.terracotta });
  kit.define('ball', 'ball', plain, { cast: true });
  kit.define('cone', 'cone', plain, { cast: true });
  kit.define('frustum', 'frustum', plain, { cast: true });
  kit.define('rock', 'rock', plain, { cast: true });
  const occ = new Occupancy(8);
  occ.addSolids(inp.solids);
  const rv = river(plan.L, LOT, model.P * LOT, inp.ground, inp.reduced);
  const names = streetNames(inp.scenario?.id);
  const ctx: Ctx = {
    cityId: rec.id, plan, kit, occ, ground: inp.ground, water: rv.depthAt,
    u: (label: string) => unit(`${rec.id}:streets:${label}`), names, mobile: inp.mobile, sides: [], dress: [],
    limit: model.P * LOT - 6, owners: new Owners(), intents: [],
  };
  const timing: Record<string, number> = {};
  const lap = (k: string, t: number) => { timing[k] = Math.round((performance.now() - t) * 10) / 10; return performance.now(); };
  let t = performance.now();
  const burnt = burntHouses(ctx, !!model.cy?.sack && model.cy.sack.ago <= 1);
  measureSides(ctx);
  pickDoors(ctx);
  t = lap('sides', t);

  // ---- public works
  const civ = emptyCivic();
  palaceSteps(ctx, civ);
  templeSteps(ctx, civ, plan.palace);
  bridgeWorks(ctx);
  wallWorks(ctx, civ);
  if (inp.sackYear !== null) postern(ctx, civ, unit(`${rec.id}:sack:${inp.sackYear}`) * Math.PI * 2);
  market(ctx, civ, plan.palace);
  well(ctx, civ, civ.market?.centre ?? null);
  const th = pickTabletHouse(ctx);
  if (th >= 0) tabletHouse(ctx, civ, th);
  dyersStreet(ctx, civ);
  t = lap('civic', t);

  // ---- ways up and across
  const near = neighbourIndex(plan.houses);
  const stairs = houseStairs(ctx, Math.max(4, Math.round(plan.houses.length / 22)), civ.stairs);
  const walls = lowWalls(ctx, near);
  const lanes = [civ.market?.centre, civ.tablet?.door, civ.palace?.foot, ...civ.gates.map((g) => g.inner)].filter((p): p is Vector3 => !!p).map((p) => ({ x: p.x, z: p.z }));
  const pl = planks(ctx, near, lanes);
  t = lap('stairs-walls-planks', t);
  const must = [th, civ.dyers?.dyer ?? -1, civ.dyers?.home ?? -1].filter((i) => i >= 0);
  const reach = laddersAndReach(ctx, pl, near, must);
  t = lap('ladders', t);

  // ---- the faces of the town
  facades(ctx);
  const clutter = streetClutter(ctx);
  const roofs = roofClutter(ctx);
  const par = parapets(ctx);
  const figs = treesOwned(ctx, () => courtyardTrees(ctx));
  const hearth = hearths(ctx, inp.scenario?.sacked ? 6 : inp.mobile ? 12 : 20);
  people(ctx, civ);
  const lf = life(ctx, civ, inp.scenario?.arms ?? null, rec.polities[model.cy?.owner ?? -1]?.color ?? '#8e2f1f', inp.reduced);
  t = lap('dress', t);

  // ---- contact shadows under houses and great platforms
  const rects = [
    ...plan.houses.map((h) => ({ x: h.x, z: h.z, rot: h.rot, hw: h.hw + 1.1, hd: h.hd + 1.1, y: h.ground })),
    ...(plan.temple ? [{ ...plan.temple, hw: plan.temple.hw + 1.6, hd: plan.temple.hd + 1.6, y: 0 }] : []),
    ...(plan.palace ? [{ ...plan.palace, hw: plan.palace.hw + 1.6, hd: plan.palace.hd + 1.6, y: 0 }] : []),
  ];
  const cg = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const cm = contactMaterial();
  const contact = new InstancedMesh(cg, cm, rects.length);
  const M = new Matrix4(), Q = new Quaternion(), UP = new Vector3(0, 1, 0);
  rects.forEach((r, i) => {
    M.compose(new Vector3(r.x, inp.ground(r.x, r.z) + 0.03, r.z), Q.setFromAxisAngle(UP, r.rot), new Vector3(r.hw * 2, 1, r.hd * 2));
    contact.setMatrixAt(i, M);
  });
  contact.renderOrder = 1;
  contact.frustumCulled = false;
  contact.name = 'contact-shadows';

  const group = kit.build({ cell: 64, small: 0.75, tags: !!inp.tags });
  group.add(contact, lf.group);
  if (rv.mesh) group.add(rv.mesh);

  // ---- places
  const places: Place[] = [];
  const P3 = (v: Vector3) => new Vector3(v.x, v.y, v.z);
  const cy = model.cy!;
  const palaceName = model.anchors.find((a) => a.key === 'palace');
  const templeName = model.anchors.find((a) => a.key === 'temple');
  if (civ.tablet) places.push({ id: 'tablet-house', name: names.tabletHouse, kind: 'tablet-house', pos: P3(civ.tablet.door), radius: 6, note: civ.tablet.cistern ? 'a cistern in its courtyard' : undefined });
  if (civ.palace) places.push({ id: 'palace-gate', name: 'The palace gate', kind: 'palace', pos: P3(civ.palace.gate), radius: 9, note: palaceName ? `${palaceName.kicker} ${palaceName.text}` : undefined, ref: cy.capital ? rec.polities[cy.capital.polity]?.id : undefined });
  if (civ.temple) places.push({ id: 'temple', name: templeName ? `${templeName.kicker} ${templeName.text}` : 'The temple', kind: 'temple', pos: P3(civ.temple.foot), radius: 12, ref: cy.faith >= 0 ? `mov:${cy.faith}` : undefined });
  if (civ.market) places.push({ id: 'market', name: names.market, kind: 'market', pos: P3(civ.market.scale), radius: 16, note: 'the weigher’s scale' });
  if (civ.well) places.push({ id: 'well', name: names.well, kind: 'well', pos: P3(civ.well), radius: 6 });
  // gates: the one nearest the river is the river gate; the land gate nearest the market, the second named gate
  const gates = civ.gates.map((g, i) => ({ g, i, river: plan.L.river ? Math.abs(riverDist(plan.L, g.x / LOT, g.z / LOT).d) * LOT : Infinity }));
  const riverGate = gates.filter((g) => g.river < 60).sort((a, b) => a.river - b.river)[0] ?? null;
  const mAng = civ.market ? Math.atan2(civ.market.centre.z, civ.market.centre.x) : 0;
  const marketGate = names.marketGate ? gates.filter((g) => g !== riverGate).sort((a, b) => Math.abs(Math.atan2(Math.sin(a.g.ang - mAng), Math.cos(a.g.ang - mAng))) - Math.abs(Math.atan2(Math.sin(b.g.ang - mAng), Math.cos(b.g.ang - mAng))))[0] ?? null : null;
  for (const g of gates) {
    const name = g === riverGate ? names.riverGate : g === marketGate ? names.marketGate! : compassGate(g.g.ang);
    places.push({ id: `gate-${g.i}`, name, kind: 'gate', pos: P3(g.g.inner), radius: 13, note: g === riverGate && rec.site.river ? `by the river ${rec.site.river.name}` : undefined });
  }
  if (civ.postern && names.postern) places.push({ id: 'postern', name: names.postern, kind: 'gate', pos: P3(civ.postern.inner), radius: 8 });
  if (civ.walls.head && cy.walls) places.push({ id: 'walls', name: 'The walls', kind: 'walls', pos: P3(civ.walls.head), radius: 10, note: `standing since AY ${cy.walls.since}` });
  if (civ.dyers) {
    const D = plan.houses[civ.dyers.dyer];
    const doorOf = (i: number) => {
      const d = ctx.dress[i];
      const h = plan.houses[i];
      if (!d.door) return new Vector3(h.x, h.ground, h.z);
      const s = ctx.sides[i][d.door.k];
      return new Vector3(s.x + s.tx * d.door.t + s.nx * 1.4, h.ground, s.z + s.tz * d.door.t + s.nz * 1.4);
    };
    places.push({ id: 'dyer', name: 'The dyer’s house', kind: 'house', pos: doorOf(civ.dyers.dyer), radius: 4.5 });
    if (civ.dyers.home >= 0) places.push({ id: 'home', name: 'Your house', kind: 'house', pos: doorOf(civ.dyers.home), radius: 4.5 });
    void D;
  }
  // quarters the texts name, for the HUD between places
  const quarters: Quarter[] = [];
  if (civ.dyers && names.quarter) quarters.push({ name: names.quarter, x: civ.dyers.centre.x, z: civ.dyers.centre.z, r: 34 });
  const qs = names.streets;
  if (qs[0] && riverGate) quarters.push({ name: qs[0], x: riverGate.g.inner.x * 0.88, z: riverGate.g.inner.z * 0.88, r: 30 });
  if (qs[1] && marketGate) quarters.push({ name: qs[1], x: marketGate.g.inner.x * 0.88, z: marketGate.g.inner.z * 0.88, r: 30 });

  const ladders: Ladder[] = [...civ.ladders, ...reach.ladders];
  const affordances: Affordances = { ladders, places, waterDepthAt: rv.depthAt };
  timing.total = Math.round((performance.now() - t0) * 10) / 10;
  const stats = {
    houses: plan.houses.length, roofs: reach.roofs, roofsReached: reach.reached, roofsReachedWithoutLadders: reach.reachedNoLadders,
    upperRooms: reach.uppers, upperRoomsWithLadders: reach.uppersReached, gapBands: reach.gaps,
    ladders: ladders.length, wallLadders: civ.walls.ladders, wallStairs: civ.walls.stairs.length, houseStairs: stairs,
    planks: pl.filter((p) => !p.lane).length, lanePlanks: pl.filter((p) => p.lane).length, lowWalls: walls, parapets: par,
    jars: clutter.jars, awnings: clutter.awnings, roofThings: roofs, stalls: civ.market?.stalls.length ?? 0,
    banners: lf.banners, people: lf.people, birds: lf.birds, hearths: hearth.length, courtyardTrees: figs, bridges: plan.bridges.length, burntHouses: burnt,
    parts: kit.count(), detailMeshes: kit.cells.length, detailTriangles: kit.triangles, colliders: kit.solids.length, places: places.length, timing,
  };

  const views = (): View[] => {
    const out: View[] = [];
    const look = (name: string, from: Vector3, to: Vector3, pitch: number, want?: number) => out.push({ name, x: from.x, z: from.z, yaw: Math.atan2(to.x - from.x, to.z - from.z), pitch, want });
    if (civ.market) {
      // along the arc of stalls, from beside the scale
      const sc = civ.market.scale;
      const l = Math.hypot(sc.x, sc.z) || 1;
      const ox = sc.x / l, oz = sc.z / l, tx = -oz, tz = ox;
      look('market', new Vector3(sc.x + tx * 8 - ox * 3.2, 0, sc.z + tz * 8 - oz * 3.2), new Vector3(sc.x - tx * 6 + ox * 3, 0, sc.z - tz * 6 + oz * 3), 0.14, 4.4);
    }
    if (civ.tablet) {
      const d = civ.tablet.door, h = plan.houses[civ.tablet.house];
      const dx = d.x - h.x, dz = d.z - h.z, l = Math.hypot(dx, dz) || 1;
      look('tablet-house', new Vector3(d.x + (dx / l) * 5.5 + (dz / l) * 2.5, 0, d.z + (dz / l) * 5.5 - (dx / l) * 2.5), new Vector3(h.x, 0, h.z), 0.22, 4.4);
    }
    // a roof the runner can reach, near the square, looking over the town toward the temple
    const roofI = [...reach.reachedSet].map((i) => plan.houses[i]).filter((h) => !ctx.dress[plan.houses.indexOf(h)].role && !h.upper)
      .sort((a, b) => Math.abs(a.r - (plan.plazaR + 30)) - Math.abs(b.r - (plan.plazaR + 30)))[0];
    if (roofI) look('rooftop', new Vector3(roofI.x, 0, roofI.z), new Vector3(0, 0, 0), 0.34, 5.5);
    if (plan.bridges[0] && plan.L.river) {
      const b = plan.bridges.sort((a, c) => Math.hypot(a.x, a.z) - Math.hypot(c.x, c.z))[0];
      const R = plan.L.river;
      look('river', new Vector3(b.x + Math.cos(b.rot) * 2, 0, b.z - Math.sin(b.rot) * 2), new Vector3(b.x + R.fx * 30, 0, b.z + R.fz * 30), 0.12);
    }
    if (civ.palace) look('palace', civ.palace.foot.clone().add(new Vector3(plan.palace!.gate.nx * 6, 0, plan.palace!.gate.nz * 6)), civ.palace.gate, 0.18);
    const b = plan.houses.filter((h) => h.kind === 'burnt').sort((a, c) => a.r - c.r)[0];
    if (b) {
      const s0 = ctx.sides[plan.houses.indexOf(b)].slice().sort((a, c) => c.open - a.open)[0];
      if (s0) look('burnt', new Vector3(s0.x + s0.nx * 6 + s0.tx * 3, 0, s0.z + s0.nz * 6 + s0.tz * 3), new Vector3(b.x, 0, b.z), 0.3, 4.6);
    }
    const gate = places.find((p) => p.kind === 'gate' && p.id.startsWith('gate'));
    if (gate) look('gate', gate.pos.clone().multiplyScalar(0.86), gate.pos.clone().multiplyScalar(1.2), 0.12);
    const dyer = places.find((p) => p.id === 'dyer');
    if (dyer && civ.dyers) {
      const D = plan.houses[civ.dyers.dyer];
      const dx = dyer.pos.x - D.x, dz = dyer.pos.z - D.z, l = Math.hypot(dx, dz) || 1;
      look('dyers', new Vector3(dyer.pos.x + (dx / l) * 4 + (dz / l) * 3, 0, dyer.pos.z + (dz / l) * 4 - (dx / l) * 3), new Vector3(D.x, 0, D.z), 0.16, 4.4);
    }
    return out;
  };

  const loop = () => routeLoop(ctx, [civ.tablet?.door, civ.palace?.foot, civ.market?.scale, civ.well, gates[0]?.g.inner, civ.temple?.foot].filter((p): p is Vector3 => !!p));
  const walkTest = () => {
    const from = places.find((p) => p.kind === 'tablet-house')?.pos ?? new Vector3(plan.plazaR, 0, 0);
    const path = walker(ctx);
    return places.map((p) => {
      let to = p.pos;
      if (p.kind === 'palace' && civ.palace) to = civ.palace.foot;
      else if (p.kind === 'walls' && civ.walls.feet[0]) to = civ.walls.feet[0];
      const r = path(from, to);
      let m = 0;
      if (r) for (let i = 1; i < r.length; i++) m += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
      return { id: p.id, name: p.name, ok: !!r, metres: Math.round(m) };
    });
  };

  let streetPath: ReturnType<typeof walker> | null = null;
  const route = (a: { x: number; z: number }, b: { x: number; z: number }, every = 3) => {
    streetPath ??= walker(ctx);
    const r = streetPath(new Vector3(a.x, 0, a.z), new Vector3(b.x, 0, b.z));
    if (!r) return null;
    let metres = 0;
    const pts: { x: number; z: number }[] = [{ x: r[0][0], z: r[0][1] }];
    let since = 0;
    for (let i = 1; i < r.length; i++) {
      const d = Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
      metres += d; since += d;
      if (since >= every || i === r.length - 1) { pts.push({ x: r[i][0], z: r[i][1] }); since = 0; }
    }
    return { pts, metres };
  };

  return {
    group, solids: kit.solids, affordances, quarters, river: rv, riverName: rec.site.river?.name ?? null, hearth, life: lf, stats, civ, reach, ctx, kit,
    views, loop, walkTest, route,
    tick(tt: number, cam?: { x: number; z: number }) {
      lf.tick(tt); rv.tick(tt);
      if (cam) kit.near(cam.x, cam.z, nearDist);
    },
    dispose() {
      kit.disposeBuilt();
      kit.dispose();
      mud.dispose(); plain.dispose();
      cg.dispose(); cm.map?.dispose(); cm.dispose();
      lf.dispose(); rv.dispose();
      group.traverse((o) => { const m = o as Mesh; if ((m as unknown as InstancedMesh).isInstancedMesh) (m as unknown as InstancedMesh).dispose(); });
    },
  };
}

/** The courtyard trees (world/life.ts) as owned things with an intent each, so the district can redraw them: each
 *  trunk (a 'pole' put) starts a tree, its crown follows it. */
function treesOwned(ctx: Ctx, place: () => number): number {
  const kit = ctx.kit;
  const put = kit.put;
  let k = 0;
  kit.put = function (name, x, y, z, yaw, sx, sy, sz, c) {
    if (name === 'pole') {
      const s = sx / 0.26;
      kit.owner = ctx.owners.id(`tree:${k++}`, x, z);
      ctx.intents.push({ k: 'tree', owner: kit.owner, x, y: y - 0.9 * s, z, sz: s });
    }
    put.call(kit, name, x, y, z, yaw, sx, sy, sz, c);
  };
  try { return place(); } finally { kit.put = put; kit.owner = -1; }
}

/** A* on a 1 m grid of the streets (clear of everything solid near the ground, and of water): a path from a to b
 *  as grid points, or null. For the walk test, the screenshot script's loop and bots. */
function walker(ctx: Ctx): (a: Vector3, b: Vector3) => [number, number][] | null {
  const free = new Map<number, boolean>();
  const limit = ctx.limit ?? 1e9;
  const N = 2048;
  const key = (i: number, j: number) => (i + N) * 4 * N + (j + N);
  const ok = (i: number, j: number) => {
    const k = key(i, j);
    let v = free.get(k);
    if (v === undefined) {
      const g = ctx.ground(i, j);
      // inside the walkable ring; dry ground or a bridge deck (its steps lead up onto it)
      const bridge = ctx.plan.bridges.find((b) => inside(b, i, j, 0.2));
      if (Math.hypot(i, j) > limit) v = false;
      else if (bridge) v = true;
      else v = !ctx.occ.blocked(i, j, 0.45, g + 0.2, g + 1.8) && ctx.water(i, j) <= 0;
      free.set(k, v);
    }
    return v;
  };
  return (a: Vector3, b: Vector3) => {
    const si = Math.round(a.x), sj = Math.round(a.z), ti = Math.round(b.x), tj = Math.round(b.z);
    // a binary heap of [i, j, f]
    const heap: [number, number, number][] = [];
    const push = (e: [number, number, number]) => {
      heap.push(e);
      let c = heap.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (heap[p][2] <= heap[c][2]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = (): [number, number, number] => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][2] < heap[m][2]) m = l;
          if (r < heap.length && heap[r][2] < heap[m][2]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
        }
      }
      return top;
    };
    push([si, sj, 0]);
    const g = new Map<number, number>([[key(si, sj), 0]]);
    const from = new Map<number, number>();
    const closed = new Set<number>();
    const h = (i: number, j: number) => Math.hypot(i - ti, j - tj);
    let guard = 0;
    while (heap.length && guard++ < 200000) {
      const [i, j] = pop();
      const ck = key(i, j);
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (Math.abs(i - ti) <= 1 && Math.abs(j - tj) <= 1) {
        const pts: [number, number][] = [[i, j]];
        let k = key(i, j);
        while (from.has(k)) { k = from.get(k)!; pts.push([Math.floor(k / (4 * N)) - N, (k % (4 * N)) - N]); }
        return pts.reverse();
      }
      const gc = g.get(key(i, j))!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di, nj = j + dj;
        if (!ok(ni, nj) && !(Math.abs(ni - ti) <= 2 && Math.abs(nj - tj) <= 2) && !(Math.abs(ni - si) <= 2 && Math.abs(nj - sj) <= 2)) continue;
        // no squeezing diagonally between two blocked cells
        if (di && dj && !ok(i + di, j) && !ok(i, j + dj)) continue;
        const ng = gc + (di && dj ? 1.414 : 1);
        const nk = key(ni, nj);
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); from.set(nk, key(i, j)); push([ni, nj, ng + h(ni, nj) * 1.05]); }
      }
    }
    return null;
  };
}

/** A walkable loop through the given points, simplified to waypoints a few metres apart, run at a jog. */
function routeLoop(ctx: Ctx, stops: Vector3[]): { x: number; z: number; run?: boolean }[] {
  const out: { x: number; z: number; run?: boolean }[] = [];
  const path = walker(ctx);
  for (let k = 0; k < stops.length; k++) {
    const p = path(stops[k], stops[(k + 1) % stops.length]);
    if (!p) continue;
    for (let i = 0; i < p.length; i += 4) out.push({ x: p[i][0], z: p[i][1], run: true });
  }
  return out;
}
