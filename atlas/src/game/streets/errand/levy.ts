// Runner of the Tablet House: the levy at the gate. Ranks of figurines in the site's painted-wood look (world/life.ts
// `figurine`), each with a spear, sashes and shields in the state's colours (its banners' field and metal), facing the
// town; before them the commander in a bronze helmet and a cloak of the state's colour, a herald, and a standard with
// the state's arms. Merged by the streets kit into a few meshes (a handful of draw calls), with no colliders: the
// errand's arrival fires before anyone can reach them. When the horn sounds they march out through the gate (or, with
// reduced motion, are simply gone), and a new run brings them back.
//
// Placed on the gate's own axis: u outward through the gate, v across it. The column stands on the opening's line
// (found by probing the wall for the widest clear span), each figure only where the ground is clear and dry.
import { Color, DoubleSide, Group, Mesh, MeshLambertMaterial, PlaneGeometry, Vector3 } from 'three';
import type { ArmsSpec } from '../../../../../engine/src/export/contract.ts';
import { Kit } from '../world/kit.ts';
import { plainMaterial } from '../world/materials.ts';
import { C } from '../world/ctx.ts';
import { bannerTexture, figurine, stateColours } from '../world/life.ts';
import type { RGB } from '../../../three/city/style.ts';

export interface LevyInput {
  /** The gate's inner point (where a runner arrives) and its outward angle (radians, x east, z south). */
  inner: { x: number; z: number };
  ang: number;
  ground(x: number, z: number): number;
  /** Clear for a standing figure at (x, z) on the ground there (no wall, house, stall or person). */
  free(x: number, z: number): boolean;
  water(x: number, z: number): number;
  arms: ArmsSpec | null;
  fallbackColour: string;
  /** Seeds the figures' small differences (0..1 from a label). */
  u(label: string): number;
  mobile: boolean;
}

export interface Levy {
  group: Group;
  /** Where the commander stands, and the gate axis (for framings and the arrival). */
  commander: Vector3;
  axis: { ax: number; az: number; v0: number };
  men: number;
  /** Start the march out through the gate (`instant`: gone at once, for reduced motion). */
  march(instant: boolean): void;
  /** Per frame: move the marching column; hide it once it is through the gate. */
  tick(dt: number): void;
  /** Back in ranks (a new run). */
  reset(): void;
  marching(): boolean;
  dispose(): void;
}

const hex = (h: string): RGB => { const c = new Color(h); return [c.r, c.g, c.b]; };
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function buildLevy(inp: LevyInput): Levy {
  const ax = Math.cos(inp.ang), az = Math.sin(inp.ang); // outward through the gate
  const bx = -az, bz = ax; // across it
  const at = (u: number, v: number) => ({ x: inp.inner.x + ax * u + bx * v, z: inp.inner.z + az * u + bz * v });
  // the opening: on the wall's line (6–8 m out), the widest run of clear, dry ground across the gate
  let v0 = 0;
  {
    let best = 0, run = 0, start = 0;
    for (let v = -20; v <= 20.01; v += 0.5) {
      const ok = [6.5, 7.5, 8.5].every((u) => { const p = at(u, v); return inp.free(p.x, p.z) && inp.water(p.x, p.z) <= 0.02; });
      if (ok) { if (!run) start = v; run += 0.5; if (run > best) { best = run; v0 = start + run / 2 - 0.25; } } else run = 0;
    }
    v0 = Math.max(-7, Math.min(7, v0));
  }
  const { field, metal } = stateColours(inp.arms, inp.fallbackColour);
  const F = hex(field), M = hex(metal);
  const bronze: RGB = C.bronze;
  const linen: RGB = [0.86, 0.8, 0.66];
  const hide: RGB = [0.62, 0.48, 0.32];

  const kit = new Kit();
  const mat = plainMaterial();
  for (const [name, shape] of [['wood', 'box'], ['pole', 'cyl'], ['ball', 'ball'], ['frustum', 'frustum'], ['cone', 'cone'], ['jar', 'jar']] as const) kit.define(name, shape, mat, { cast: true });
  const inward = Math.atan2(-ax, -az), outward = Math.atan2(ax, az);
  let men = 0;
  const stand = (u: number, v: number, yaw: number, key: string, gear: Parameters<typeof figurine>[2], c: RGB): boolean => {
    const p = at(u, v);
    if (!inp.free(p.x, p.z) || inp.water(p.x, p.z) > 0.02) return false;
    figurine(kit, { x: p.x, y: inp.ground(p.x, p.z), z: p.z, yaw: yaw + (inp.u(`levy:yaw:${key}`) - 0.5) * 0.25, c, sex: 'm', pose: 'stand' }, gear);
    return true;
  };
  // the ranks: facing the town, a little uneven, as a levy of farmers stands
  const cols = inp.mobile ? 7 : 8, rows = inp.mobile ? 8 : 10;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const key = `${r}:${k}`;
      const u = 3.2 - r * 1.05 + (inp.u(`levy:u:${key}`) - 0.5) * 0.25;
      const v = v0 + (k - (cols - 1) / 2) * 0.92 + (inp.u(`levy:v:${key}`) - 0.5) * 0.2;
      const kilt = inp.u(`levy:kilt:${key}`) < 0.3 ? lerp3(linen, F, 0.55) : linen;
      const shield = inp.u(`levy:shield:${key}`) < 0.38 ? (inp.u(`levy:sc:${key}`) < 0.5 ? F : hide) : undefined;
      if (stand(u, v, inward, key, { spear: bronze, sash: F, shield }, kilt)) men++;
    }
  }
  // before them: the commander (bronze helmet, a cloak of the state's colour), a herald, and the standard
  const frontU = 3.2 - (rows - 1) * 1.05 - 2.4;
  const cp = at(frontU, v0);
  const commander = new Vector3(cp.x, inp.ground(cp.x, cp.z), cp.z);
  stand(frontU, v0, outward, 'commander', { helmet: bronze, cloak: F, spear: M }, lerp3(linen, F, 0.25));
  stand(frontU + 0.5, v0 - 1.5, outward + 0.4, 'herald', { sash: F }, linen);
  const sb = at(frontU + 0.4, v0 + 1.6);
  stand(frontU + 0.4, v0 + 1.6, outward - 0.3, 'standard', { sash: F }, linen);
  const sy = inp.ground(sb.x, sb.z);
  const poleTop = sy + 4.3;
  // the standard's pole beside the bearer's right hand, and a crossbar
  const sp = { x: sb.x + bx * 0.32, z: sb.z + bz * 0.32 };
  kit.put('pole', sp.x, sy + 2.15, sp.z, 0, 0.08, 4.3, 0.08, C.timberDark);
  kit.put('wood', sp.x, poleTop - 0.05, sp.z, inward, 1.1, 0.06, 0.06, C.timberDark); // across the gate, as the cloth
  const group = kit.build({ cell: 64, small: 0.05 });
  group.name = 'errand-levy';
  // the cloth: the state's arms, as on the towers' banners
  const tex = bannerTexture(inp.arms, inp.fallbackColour);
  const cloth = new Mesh(new PlaneGeometry(1, 1).translate(0, -0.5, 0), new MeshLambertMaterial({ map: tex, side: DoubleSide, alphaTest: 0.5 }));
  cloth.position.set(sp.x, poleTop, sp.z);
  cloth.scale.set(1.05, 1.9, 1);
  cloth.rotation.y = inward; // its face toward the town
  cloth.castShadow = true;
  cloth.name = 'levy-standard';
  group.add(cloth);

  let march: { v: number; d: number } | null = null;
  const home = group.position.clone();
  return {
    group, commander, axis: { ax, az, v0 }, men,
    march(instant) {
      if (instant) { group.visible = false; march = null; return; }
      if (!march && group.visible) march = { v: 0, d: 0 };
    },
    tick(dt) {
      if (!march) return;
      march.v = Math.min(1.35, march.v + dt * 0.9);
      march.d += march.v * dt;
      group.position.set(home.x + ax * march.d, home.y, home.z + az * march.d);
      // through the gate and away: gone once the last rank is well outside
      if (march.d > 26) { group.visible = false; march = null; }
    },
    reset() { march = null; group.position.copy(home); group.visible = true; },
    marching: () => !!march,
    dispose() {
      kit.disposeBuilt(); kit.dispose(); mat.dispose();
      cloth.geometry.dispose(); tex.dispose(); (cloth.material as MeshLambertMaterial).dispose();
    },
  };
}
