// Streets: the city of the record at walking scale. The city module (three/city) builds the town in lots; here one lot
// is LOT metres (docs/streets/hld.md: 1 lot = 8 m), the land runs on past the city's own ground to hills and a hazy
// horizon, and every solid part of the model (houses, walls, temple, palace, trees) becomes a physics shape: a box
// where the part is a box, else the convex hull of the part's own vertices. The ground becomes a triangle mesh.
// On top of the model, the streets layer (world/layer.ts) adds what street level needs (doors, parapets, ladders,
// stairs, planks, stalls, a well, banners …), its colliders join the model's in `solids` (physics.ts builds them all),
// and the runner reads ladders, places and water from `affordances` (affordances.ts).

import {
  BackSide, BufferAttribute, BufferGeometry, type Camera, Color, DirectionalLight, Fog, Group, HemisphereLight,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Quaternion, SphereGeometry, Vector3,
  type Material, type Scene,
} from 'three';
import { buildCity, type CityGroupData } from '../../three/city/index.ts';
import type { CityModel } from '../../three/city/model.ts';
import { hash, type CityRecord, type CityYear } from '../../three/city/record.ts';
import { vnoise } from '../../three/city/layout.ts';
import { biomeOf, mix, shade, type RGB } from '../../three/city/style.ts';
import type { ArmsSpec } from '../../../../engine/src/export/contract.ts';
import { FIRE, HEARTH, SmokeColumns } from './smoke.ts';
import type { Affordances } from './affordances.ts';
import { HeightGrid, type Plan, hidePart, readPlan } from './world/plan.ts';
import { groundSkin, mudSkin } from './world/materials.ts';
import { buildLayer, type Layer, type Quarter, type View } from './world/layer.ts';
import { createDistrict, type District } from './world/district.ts';

/** Metres per lot (one drawn building's plot): a Bronze Age house comes out 5–8 m across and 3.4–5.3 m to the roof. */
export const LOT = 8;

export type Solid =
  | { kind: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; q: Quaternion }
  | { kind: 'hull'; points: Float32Array };

/** What the view tells the world before it is built (StreetsView sets it from the route and the scenario). */
export interface WorldOptions {
  /** The scenario being played: its id (for the names its texts give), year, outcome and the state's arms. */
  scenario?: { id: string; year: number; outcome: string; arms: ArmsSpec | null; cityName: string } | null;
  /** Show the city after this year's sack (burnt quarters), not on its eve (the default). */
  sacked?: boolean;
  reducedMotion?: boolean;
  /** Give the streets layer's merged meshes the surface attributes the realism look reads (world/kit.ts). */
  surfaceTags?: boolean;
  /** Draw the hero district with the modular kit (default on; `#/streets?kit=0` turns it off). */
  district?: boolean;
}
let worldOpts: WorldOptions = {};
export function setWorldOptions(o: WorldOptions) { worldOpts = o; }

export interface StreetsCity {
  rec: CityRecord;
  /** The city at the year as drawn (before the year's sack unless the options say otherwise). */
  cy: CityYear;
  model: CityModel;
  /** The city's name for the HUD: the scenario's form when there is one ("Pumi", not the page's "Pummi"). */
  name: string;
  /** The city's group (in lots, scaled by LOT). */
  city: Group;
  /** Everything added to the scene. */
  root: Group;
  /** Radius of the city's ground, metres. */
  P: number;
  /** The walkable limit, metres from the temple square. */
  limit: number;
  solids: Solid[];
  ground: { vertices: Float32Array; indices: Uint32Array };
  sun: DirectionalLight;
  /** The sack's smoke (model.smoke). Hearth smoke updates itself. */
  smoke: SmokeColumns;
  /** Ground height (metres) at a point, from the city ground mesh (0 off the mesh). Fast (a grid). */
  heightAt(x: number, z: number): number;
  /** Ladders, places and water, for the runner (affordances.ts). */
  affordances: Affordances;
  /** Named quarters (the HUD shows them between places), and the river's name and distance to its edge (m). */
  quarters: Quarter[];
  river: { name: string | null; edgeDist(x: number, z: number): number; level: number };
  plan: Plan;
  layer: Layer;
  /** The hero district (world/district.ts): its shape, the kit's group, and `ready` once the near ring is in. Null
   *  when turned off. */
  district: District | null;
  /** Counts and timings of the streets layer (for the probes). */
  stats: Record<string, unknown>;
  /** Framings for the screenshot script, and a walkable loop through the places. */
  views(): View[];
  loop(): { x: number; z: number; run?: boolean }[];
  dispose(): void;
}

const SKY_TOP = new Color('#7fa3c4');
const SKY_HAZE = new Color('#e6d6b8');
export const FOG = new Color('#ddcdb0');

export function buildStreets(scene: Scene, rec: CityRecord, year: number, opts: { mobile: boolean }): StreetsCity {
  const t0 = performance.now();
  const wo = worldOpts;
  const reduced = wo.reducedMotion ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const root = new Group();
  root.name = 'streets';
  const city = buildCity(rec, year, { plinth: false, textureSize: opts.mobile ? 1024 : 2048, theme: 'light', beforeSack: !wo.sacked });
  const model = (city.userData as CityGroupData).model;
  city.scale.setScalar(LOT);
  root.add(city);
  root.updateMatrixWorld(true);
  const cy = model.cy!;
  const P = model.P * LOT;

  // ---- the ground mesh (find it among the model's meshes: indexed, with uvs and a painted map)
  let groundMesh: Mesh | null = null;
  let waterDisc: Mesh | null = null;
  city.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as unknown as InstancedMesh).isInstancedMesh) return;
    const g = m.geometry;
    const mat = m.material as MeshLambertMaterial;
    if (g.index && g.attributes.uv && mat.map) groundMesh = m;
    if (g.type === 'CircleGeometry') waterDisc = m;
  });
  if (!groundMesh) throw new Error('streets: the city has no ground');
  const gm = groundMesh as Mesh;
  gm.receiveShadow = true;
  groundSkin(gm.material as MeshLambertMaterial, LOT, model.L.roads);
  const gpos = gm.geometry.attributes.position as BufferAttribute;
  const vertices = new Float32Array(gpos.count * 3);
  const v = new Vector3();
  for (let i = 0; i < gpos.count; i++) {
    v.fromBufferAttribute(gpos, i).applyMatrix4(gm.matrixWorld);
    vertices[3 * i] = v.x; vertices[3 * i + 1] = v.y; vertices[3 * i + 2] = v.z;
  }
  const indices = new Uint32Array(gm.geometry.index!.array);
  const hg = new HeightGrid(vertices, indices, P, 1);
  const heightAt = (x: number, z: number) => hg.at(x, z);

  // ---- the plan, read from the model's parts; the streets' own edits to this copy of the model
  const plan = readPlan(model, LOT, heightAt);
  for (const c of plan.walls?.crenels ?? []) hidePart(c); // redrawn as merlons on the walk's outer edge
  for (const h of plan.houses) for (const p of h.burntParts ?? []) hidePart(p); // redrawn as broken shells (world/burnt.ts)
  if (waterDisc && !model.L.coast) (waterDisc as Mesh).visible = false; // the river has its own surface
  // the walls of houses, walls and monuments: the mud-plaster skin (on the model's box parts, in this scene only)
  const skins: Material[] = [];
  city.traverse((o) => {
    const im = o as InstancedMesh;
    if (!im.isInstancedMesh || im.geometry.type !== 'BoxGeometry' || (im.material as Material).transparent) return;
    const m = mudSkin((im.material as MeshLambertMaterial).clone(), 'city');
    im.material = m;
    skins.push(m);
  });

  // ---- solids from the instanced parts
  const solids: Solid[] = [];
  const M = new Matrix4(), W = new Matrix4();
  const pos = new Vector3(), q = new Quaternion(), scl = new Vector3();
  const uniq = new Map<BufferGeometry, Float32Array>();
  const pointsOf = (g: BufferGeometry): Float32Array => {
    let u = uniq.get(g);
    if (u) return u;
    const p = g.attributes.position as BufferAttribute;
    const seen = new Set<string>();
    const out: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x, y, z);
    }
    u = new Float32Array(out);
    uniq.set(g, u);
    return u;
  };
  city.traverse((o) => {
    const im = o as InstancedMesh;
    if (!im.isInstancedMesh || !im.visible || im.count === 0) return;
    if ((im.material as Material).transparent) { im.visible = false; return; } // the model's smoke: drawn as soft puffs instead
    const box = im.geometry.type === 'BoxGeometry';
    const local = box ? null : pointsOf(im.geometry);
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, M);
      W.multiplyMatrices(im.matrixWorld, M);
      W.decompose(pos, q, scl);
      if (scl.y < 0.1 || scl.x < 0.02 || scl.z < 0.02) continue; // painted-on slivers (rails, ash) and hidden parts
      if (box) {
        // unit box with its base at y 0: centre is half a height up
        const c = new Vector3(0, 0.5, 0).applyMatrix4(W);
        solids.push({ kind: 'box', x: c.x, y: c.y, z: c.z, hx: scl.x / 2, hy: scl.y / 2, hz: scl.z / 2, q: q.clone() });
      } else {
        const pts = new Float32Array(local!.length);
        for (let k = 0; k < local!.length; k += 3) {
          v.set(local![k], local![k + 1], local![k + 2]).applyMatrix4(W);
          pts[k] = v.x; pts[k + 1] = v.y; pts[k + 2] = v.z;
        }
        solids.push({ kind: 'hull', points: pts });
      }
    }
  });
  const modelSolids = solids.length;

  // ---- the streets layer
  const sc = wo.scenario ?? null;
  const sackYear = rec.sacks.includes(cy.year) ? cy.year : sc && sc.outcome === 'sacked' ? sc.year : null;
  const layer = buildLayer({
    rec, model, plan, solids, ground: heightAt, mobile: opts.mobile, reduced,
    scenario: sc ? { id: sc.id, year: sc.year, arms: sc.arms, sacked: !!wo.sacked } : null, sackYear, tags: !!wo.surfaceTags,
  });
  for (const s of layer.solids) solids.push(s);
  root.add(layer.group);

  // ---- the hero district: the modular kit over the model, streamed in after the first frame
  const tk = performance.now();
  const kitOn = wo.district ?? (typeof location === 'undefined' || !/[?&]kit=0\b/.test(location.hash));
  const district = kitOn ? createDistrict({ ctx: layer.ctx, layer, model, mobile: opts.mobile, reduced, root }) : null;
  const districtMs = Math.round(performance.now() - tk);

  // ---- the land beyond the city's ground: rim heights carried out to hills, coloured like the rim
  const rim = rimOf(vertices, P);
  const outer = outerLand(rec, P, rim, gm);
  root.add(outer);

  // ---- sky dome and haze
  const sky = skyDome(P * 9);
  root.add(sky);
  scene.fog = new Fog(FOG, P * 0.55, P * 4.2);
  scene.background = FOG.clone();

  // ---- light: a late-afternoon sun from the west-south-west, a sky and ground fill
  const hemi = new HemisphereLight(0xfff3dc, 0x8a7a62, 1.25);
  const sun = new DirectionalLight(0xffe8c4, 2.6);
  sun.castShadow = true;
  const sm = opts.mobile ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const R = opts.mobile ? 22 : 34;
  const shc = sun.shadow.camera;
  shc.left = -R; shc.right = R; shc.top = R; shc.bottom = -R; shc.near = 1; shc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  root.add(hemi, sun, sun.target);

  // ---- smoke: the sack's fires (when shown) and the hearths of a living town
  const smoke = new SmokeColumns(model.smoke, LOT, FOG, FIRE);
  root.add(smoke.mesh);
  const hearth = new SmokeColumns(layer.hearth, 1, FOG, HEARTH);
  root.add(hearth.mesh);

  // ---- one tick per frame, before the scene is drawn (the game's loop needs no change)
  const prevHook = scene.onBeforeRender;
  scene.onBeforeRender = function (...args) {
    prevHook.apply(this, args);
    const camera = args[2];
    const t = reduced ? 40 : performance.now() / 1000;
    district?.tick(camera as Camera, args[0], scene);
    layer.tick(t, (camera as Camera).position);
    hearth.update(t, camera as Camera);
    if (model.smoke.length) smoke.update(t, camera as Camera);
  };

  const stats = { ...layer.stats, modelSolids, solids: solids.length, districtMs, buildMs: Math.round(performance.now() - t0) };
  return {
    rec, cy, model, name: sc?.cityName ?? cy.name, city, root, P, limit: P - 6, solids, ground: { vertices, indices }, sun, smoke, heightAt,
    affordances: layer.affordances, quarters: layer.quarters,
    river: { name: layer.riverName, edgeDist: layer.river.edgeDist, level: layer.river.level },
    plan, layer, district, stats, views: layer.views, loop: layer.loop,
    dispose() {
      scene.onBeforeRender = prevHook;
      district?.dispose();
      layer.dispose();
      model.dispose();
      smoke.dispose();
      hearth.dispose();
      for (const m of skins) m.dispose();
      outer.geometry.dispose();
      (outer.material as Material).dispose();
      sky.geometry.dispose();
      (sky.material as Material).dispose();
    },
  };
}

/** Rim heights by angle (180 steps), from the ground vertices nearest the edge. */
function rimOf(vertices: Float32Array, P: number): Float32Array {
  const N = 180;
  const h = new Float32Array(N).fill(NaN);
  const best = new Float32Array(N).fill(-1);
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], z = vertices[i + 2];
    const r = Math.hypot(x, z);
    if (r < P * 0.97) continue;
    const a = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
    const s = Math.round((a / (Math.PI * 2)) * N) % N;
    if (r > best[s]) { best[s] = r; h[s] = vertices[i + 1]; }
  }
  for (let s = 0; s < N; s++) if (Number.isNaN(h[s])) h[s] = h[(s + N - 1) % N] || 0;
  return h;
}

function outerLand(rec: CityRecord, P: number, rim: Float32Array, ground: Mesh): Mesh {
  const B = biomeOf(rec.site.biome);
  const seed = hash(`${rec.id}:streets-hills`) & 0xffff;
  const NS = rim.length, NR = 30;
  const R1 = P * 9;
  // the painted ground's colours along the rim, so the seam does not show
  const rimCol: RGB[] = [];
  const src = (ground.material as MeshLambertMaterial).map?.image as HTMLCanvasElement | undefined;
  let small: Uint8ClampedArray | null = null;
  const SM = 128;
  if (src && typeof document !== 'undefined') {
    // one small copy of the painted ground, read once
    const c = document.createElement('canvas');
    c.width = c.height = SM;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (g) { g.drawImage(src, 0, 0, SM, SM); small = g.getImageData(0, 0, SM, SM).data; }
  }
  for (let s = 0; s < NS; s++) {
    const a = (s / NS) * Math.PI * 2;
    if (small) {
      const u = 0.5 + 0.5 * Math.cos(a) * 0.97, w = 0.5 + 0.5 * Math.sin(a) * 0.97;
      const i = (Math.floor(w * (SM - 1)) * SM + Math.floor(u * (SM - 1))) * 4;
      rimCol.push([small[i] / 255, small[i + 1] / 255, small[i + 2] / 255]);
    } else rimCol.push(B.land);
  }
  const up = rec.site.uphill;
  const amp = 14 + 46 * (0.3 + up.k + rec.site.elev * 0.7);
  const pos = new Float32Array(NR * NS * 3);
  const col = new Float32Array(NR * NS * 3);
  const lin = (c: number) => Math.pow(c, 2.2);
  for (let ri = 0; ri < NR; ri++) {
    const t = ri / (NR - 1);
    const r = P + (R1 - P) * Math.pow(t, 1.7);
    for (let s = 0; s < NS; s++) {
      const a = (s / NS) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const k = Math.min(1, (r - P) / (P * 1.4));
      const towardUp = Math.cos(a) * up.dx + Math.sin(a) * up.dz;
      const n1 = vnoise(x / 180, z / 180, seed), n2 = vnoise(x / 60, z / 60, seed + 1);
      const hills = amp * k * k * (0.45 + 0.4 * towardUp + 0.6 * n1) + 6 * k * n2;
      const y = rim[s] * (1 - k) + hills;
      const i = (ri * NS + s) * 3;
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
      const land = mix(B.land, B.tree, 0.25 * n2 + 0.2 * Math.max(0, n1 - 0.5));
      const c = mix(rimCol[s], shade(land, 0.92 + 0.16 * n2), Math.min(1, k * 3));
      col[i] = lin(c[0]); col[i + 1] = lin(c[1]); col[i + 2] = lin(c[2]);
    }
  }
  const idx: number[] = [];
  for (let ri = 0; ri < NR - 1; ri++) {
    for (let s = 0; s < NS; s++) {
      const a = ri * NS + s, b = ri * NS + ((s + 1) % NS), c = a + NS, d = b + NS;
      idx.push(a, d, b, a, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new Mesh(g, new MeshLambertMaterial({ vertexColors: true }));
  m.receiveShadow = true;
  m.name = 'outer-land';
  return m;
}

function skyDome(r: number): Mesh {
  const g = new SphereGeometry(r, 32, 16);
  const p = g.attributes.position as BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const c = new Color();
  for (let i = 0; i < p.count; i++) {
    const h = p.getY(i) / r;
    c.copy(SKY_HAZE).lerp(SKY_TOP, Math.min(1, Math.max(0, h * 2.2)));
    col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  const m = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10;
  m.name = 'sky';
  m.frustumCulled = false;
  return m;
}
