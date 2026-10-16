// Streets: the city of the record at walking scale. The city module (three/city) builds the town in lots; here one lot
// is LOT metres, the land runs on past the city's own ground to hills and a hazy horizon, and every solid part of the
// model (houses, walls, temple, palace, trees) becomes a physics shape: a box where the part is a box, else the convex
// hull of the part's own vertices. The ground becomes a triangle mesh. Nothing here reads anything but the model.

import {
  BackSide, BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, Quaternion, SphereGeometry, Vector3, type Material, type Scene,
} from 'three';
import { buildCity, type CityGroupData } from '../../three/city/index.ts';
import type { CityModel } from '../../three/city/model.ts';
import { cityAt, hash, type CityRecord, type CityYear } from '../../three/city/record.ts';
import { vnoise } from '../../three/city/layout.ts';
import { biomeOf, mix, shade, type RGB } from '../../three/city/style.ts';
import { SmokeColumns } from './smoke.ts';

/** Metres per lot (one drawn building's plot): an Iron Age house comes out 6–9 m across and 4–6 m to the eaves. */
export const LOT = 9;

export type Solid =
  | { kind: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; q: Quaternion }
  | { kind: 'hull'; points: Float32Array };

export interface StreetsCity {
  rec: CityRecord;
  cy: CityYear;
  model: CityModel;
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
  smoke: SmokeColumns;
  /** Ground height (metres) at a point, from the city ground mesh (0 off the mesh). */
  heightAt(x: number, z: number): number;
  dispose(): void;
}

const SKY_TOP = new Color('#7fa3c4');
const SKY_HAZE = new Color('#e6d6b8');
export const FOG = new Color('#ddcdb0');

export function buildStreets(scene: Scene, rec: CityRecord, year: number, opts: { mobile: boolean }): StreetsCity {
  const root = new Group();
  root.name = 'streets';
  const city = buildCity(rec, year, { plinth: false, textureSize: opts.mobile ? 1024 : 2048, theme: 'light' });
  const model = (city.userData as CityGroupData).model;
  city.scale.setScalar(LOT);
  root.add(city);
  root.updateMatrixWorld(true);
  const cy = cityAt(rec, year);
  const P = model.P * LOT;

  // ---- the ground mesh (find it among the model's meshes: indexed, with uvs and a painted map)
  let groundMesh: Mesh | null = null;
  city.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as unknown as InstancedMesh).isInstancedMesh) return;
    const g = m.geometry;
    const mat = m.material as MeshLambertMaterial;
    if (g.index && g.attributes.uv && mat.map) groundMesh = m;
  });
  if (!groundMesh) throw new Error('streets: the city has no ground');
  const gm = groundMesh as Mesh;
  gm.receiveShadow = true;
  groundDetail(gm.material as MeshLambertMaterial);
  const gpos = gm.geometry.attributes.position as BufferAttribute;
  const vertices = new Float32Array(gpos.count * 3);
  const v = new Vector3();
  for (let i = 0; i < gpos.count; i++) {
    v.fromBufferAttribute(gpos, i).applyMatrix4(gm.matrixWorld);
    vertices[3 * i] = v.x; vertices[3 * i + 1] = v.y; vertices[3 * i + 2] = v.z;
  }
  const indices = new Uint32Array(gm.geometry.index!.array);

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
      if (scl.y < 0.1 || scl.x < 0.02 || scl.z < 0.02) continue; // painted-on slivers (rails, ash)
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
  const sc = sun.shadow.camera;
  sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  root.add(hemi, sun, sun.target);

  const heightAt = (x: number, z: number) => groundHeight(vertices, indices, x, z, P);
  const smoke = new SmokeColumns(model.smoke, LOT, FOG);
  root.add(smoke.mesh);

  return {
    rec, cy, model, city, root, P, limit: P - 6, solids, ground: { vertices, indices }, sun, smoke, heightAt,
    dispose() {
      model.dispose();
      smoke.dispose();
      outer.geometry.dispose();
      (outer.material as Material).dispose();
      sky.geometry.dispose();
      (sky.material as Material).dispose();
    },
  };
}

/** The city's painted ground is made to be seen from above; at walking scale it is one flat colour, which hides how
 *  fast the runner goes. Mottle it in this scene: blotches a few metres across and a finer grain, faded out with
 *  distance so it does not shimmer. (Wraps the city ground material's own shader edit, on this model's instance.) */
function groundDetail(mat: MeshLambertMaterial) {
  const prev = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    if (!sh.fragmentShader.includes('varying vec3 vLot;')) return;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `float stHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 23758.5453); }
float stNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(stHash(i), stHash(i + vec2(1.0, 0.0)), u.x), mix(stHash(i + vec2(0.0, 1.0)), stHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 w = vLot.xz * ${LOT.toFixed(1)};
  float fw = fwidth(w.x) + fwidth(w.y);
  float blot = stNoise(w * 0.3) * 0.65 + stNoise(w * 0.9 + 7.1) * 0.35;
  float grain = (stNoise(w * 3.1 + 3.3) - 0.5) * (1.0 - smoothstep(0.08, 0.45, fw * 3.1));
  diffuseColor.rgb *= 0.86 + 0.26 * blot + 0.16 * grain;
}`);
  };
  mat.customProgramCacheKey = () => `${key}+streets-detail`;
  mat.needsUpdate = true;
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

/** Height of the city ground under (x, z): a coarse search over its triangles (used for spawn and probes, not per frame). */
function groundHeight(V: Float32Array, I: Uint32Array, x: number, z: number, P: number): number {
  if (Math.hypot(x, z) > P) return 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const x0 = V[a], z0 = V[a + 2], x1 = V[b], z1 = V[b + 2], x2 = V[c], z2 = V[c + 2];
    const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(d) < 1e-9) continue;
    const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
    const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
    const l2 = 1 - l0 - l1;
    if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
    return l0 * V[a + 1] + l1 * V[b + 1] + l2 * V[c + 1];
  }
  return 0;
}
