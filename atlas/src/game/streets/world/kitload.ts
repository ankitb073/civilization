// Streets world: the modular kit built in Blender (atlas/public/game/streets/kit/, kit.json documents every piece,
// scripts/streets/kit/ builds it). Loads its packs (meshopt geometry, KTX2 textures: `hi` on desktop, `lo` on phones)
// and turns each piece's LODs into plain arrays in the piece's own frame (positions and normals with the node's
// transform applied, uvs as floats, vertex colours as bytes), ready to be merged per cell by kitmesh.ts. Every texture
// loads once however many packs use it; every material is shared by name across packs.

import {
  type BufferAttribute, type BufferGeometry, Color, type CompressedTexture, type InterleavedBufferAttribute, type Material,
  Matrix3, type Matrix4, type Mesh, type MeshStandardMaterial, type Object3D, Vector3, type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const KIT_BASE = `${import.meta.env.BASE_URL}game/streets/kit/`;

export type Tier = 'hi' | 'lo';

export interface KitPieceInfo {
  pack: string; name: string; kind: string; snap: Record<string, unknown>; pivot: string;
  lods: { node: string; tris: number }[]; bbox: [[number, number, number], [number, number, number]];
  notes: string; materials: string[]; primitives: number; dye?: [number, number, number];
  fulcrum?: [number, number, number]; tip?: [number, number, number];
}
export interface KitJson {
  version: number;
  conventions: { lodDistances: number[]; collision: string; houses: string; [k: string]: unknown };
  materials: Record<string, { set: string; tile_m: number | null; trim: boolean; alpha: boolean; doubleSided: boolean; hi: number; lo: number; normal: string; mean?: [number, number, number] }>;
  packs: Record<string, { geometry: string; hi?: { file: string; bytes: number; textures: string[] }; lo?: { file: string; bytes: number; textures: string[] } }>;
  pieces: KitPieceInfo[];
  download: Record<string, unknown>;
}

/** One primitive of one LOD of a piece: arrays in the piece's frame (metres), one material. */
export interface KitPrim {
  mat: number;
  pos: Float32Array; nor: Float32Array; uv: Float32Array; col: Uint8Array;
  idx: Uint32Array;
  verts: number;
}
export interface KitPiece { name: string; info: KitPieceInfo; lods: KitPrim[][]; size: number }

export interface LoadedKit {
  json: KitJson;
  tier: Tier;
  pieces: Map<string, KitPiece>;
  /** Materials by index (kitmesh merges per index); names in `matNames`. */
  materials: Material[];
  matNames: string[];
  matIndex(name: string): number;
  /** Mean linear albedo of each material's texture (for the far LOD, drawn without textures). */
  means: [number, number, number][];
  /** Download and timing, for the probes. */
  stats: { packs: Record<string, { ms: number }>; textures: number; textureMB?: number; ms: number };
  dispose(): void;
}

/** A KTX2 loader that loads each texture once (packs share their texture files). */
class SharedKTX2 extends KTX2Loader {
  private cache = new Map<string, Promise<CompressedTexture>>();
  textures = 0;
  load(url: string, onLoad: (t: CompressedTexture) => void, onProgress?: (e: ProgressEvent) => void, onError?: (e: unknown) => void) {
    let p = this.cache.get(url);
    if (!p) {
      p = new Promise<CompressedTexture>((res, rej) => { super.load(url, res, onProgress, rej); });
      this.cache.set(url, p);
      this.textures++;
    }
    p.then(onLoad, onError);
  }
}

let ktx2: SharedKTX2 | null = null;
let ktx2Renderer: unknown = null;
/** The kit's KTX2 loader for a renderer (WebGLRenderer or WebGPURenderer, initialised). */
export function kitKtx2(renderer: unknown): SharedKTX2 {
  if (!ktx2 || ktx2Renderer !== renderer) {
    ktx2?.dispose();
    ktx2 = new SharedKTX2().setTranscoderPath(`${KIT_BASE}basis/`) as SharedKTX2;
    ktx2.setWorkerLimit(2);
    (ktx2 as unknown as { detectSupport(r: unknown): void }).detectSupport(renderer);
    ktx2Renderer = renderer;
  }
  return ktx2;
}

let jsonP: Promise<KitJson> | null = null;
export function loadKitJson(): Promise<KitJson> {
  jsonP ??= fetch(`${KIT_BASE}kit.json`).then((r) => { if (!r.ok) throw new Error(`kit.json: ${r.status}`); return r.json() as Promise<KitJson>; });
  jsonP.catch(() => { jsonP = null; });
  return jsonP;
}

const LIN = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * Load the kit for a renderer: kit.json, then the packs (`order` first: the houses' pack before props and plants).
 * `onPack` is called as each pack's pieces become usable, so the near ring can be drawn before the last pack lands.
 */
export async function loadKit(renderer: unknown, tier: Tier, opts: { order?: string[]; onPack?: (k: LoadedKit, pack: string) => void; foliageA2C?: boolean; skipLod0?: boolean } = {}): Promise<LoadedKit> {
  const t0 = performance.now();
  const json = await loadKitJson();
  const kt = kitKtx2(renderer);
  const loader = new GLTFLoader().setKTX2Loader(kt).setMeshoptDecoder(MeshoptDecoder);
  const info = new Map(json.pieces.map((p) => [p.name, p]));
  const materials: Material[] = [], matNames: string[] = [], means: [number, number, number][] = [];
  const byName = new Map<string, number>();
  const kit: LoadedKit = {
    json, tier, pieces: new Map(), materials, matNames, means,
    matIndex: (n) => byName.get(n) ?? -1,
    stats: { packs: {}, textures: 0, ms: 0 },
    dispose() {
      const tex = new Set<Texture>();
      for (const m of materials) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) { const t = (m as MeshStandardMaterial)[k]; if (t) tex.add(t); }
        m.dispose();
      }
      for (const t of tex) t.dispose();
    },
  };
  const addMaterial = (m: Material): number => {
    const name = m.name || `mat${materials.length}`;
    let i = byName.get(name);
    if (i !== undefined) return i;
    i = materials.length;
    byName.set(name, i);
    materials.push(m);
    matNames.push(name);
    const mean = json.materials[name]?.mean;
    means.push(mean ? [mean[0], mean[1], mean[2]] : [0.3, 0.22, 0.14]);
    return i;
  };
  const order = [...(opts.order ?? []), ...Object.keys(json.packs)].filter((p, i, a) => a.indexOf(p) === i && json.packs[p]);
  const loadPack = async (pack: string) => {
    const tp = performance.now();
    const file = json.packs[pack][tier]?.file ?? json.packs[pack].hi?.file;
    if (!file) return;
    // the glTF without its LOD0 nodes (the game draws LOD1 and LOD2), so their buffer (<pack>.lod0.bin) is never fetched
    const res = await fetch(`${KIT_BASE}${file}`);
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    const gj = await res.json() as { nodes: { name?: string }[]; scenes: { nodes: number[] }[] };
    if (opts.skipLod0 ?? true) for (const sc of gj.scenes) sc.nodes = sc.nodes.filter((i) => /_LOD\d+$/.test(gj.nodes[i]?.name ?? ''));
    const gltf = await loader.parseAsync(JSON.stringify(gj), KIT_BASE);
    gltf.scene.updateMatrixWorld(true);
    // nodes by name; a piece's LOD k is the node <name> (k = 0) or <name>_LOD<k>
    const nodes = new Map<string, Object3D>();
    gltf.scene.traverse((o) => { if (o.name && !nodes.has(o.name)) nodes.set(o.name, o); });
    for (const [name, pi] of info) {
      if (pi.pack !== pack) continue;
      const lods: KitPrim[][] = [];
      for (const l of pi.lods) {
        const node = nodes.get(l.node);
        const prims: KitPrim[] = [];
        node?.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          const mat = Array.isArray(m.material) ? m.material[0] : m.material;
          prims.push(primOf(m.geometry, m.matrixWorld, addMaterial(mat)));
        });
        lods.push(prims);
      }
      while (lods.length < 3) lods.push(lods[lods.length - 1] ?? []);
      if (!lods[0].length) lods[0] = lods[1]; // LOD0 not loaded: its slot draws LOD1
      const b = pi.bbox;
      kit.pieces.set(name, { name, info: pi, lods, size: Math.max(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]) });
    }
    // the meshes' geometry is copied out; the loader's own copies can go
    gltf.scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.geometry.dispose(); });
    kit.stats.packs[pack] = { ms: Math.round(performance.now() - tp) };
    opts.onPack?.(kit, pack);
  };
  // the first pack alone (the houses: what the near ring needs), then the rest together
  const [first, ...rest] = order;
  if (first) await loadPack(first);
  await Promise.all(rest.map(loadPack));
  // material tweaks: foliage cards alpha-to-coverage (with MSAA), the lime wash for the palace and the temple
  for (const [i, m] of materials.entries()) {
    const sm = m as MeshStandardMaterial;
    if (matNames[i] === 'M_Foliage') { sm.alphaToCoverage = opts.foliageA2C ?? true; sm.needsUpdate = true; }
    sm.userData.kit = true;
  }
  const plaster = byName.get('M_MudPlaster');
  if (plaster !== undefined && !byName.has('M_MudPlaster_Lime')) {
    const lime = (materials[plaster] as MeshStandardMaterial).clone();
    lime.name = 'M_MudPlaster_Lime';
    // lime wash over the mud plaster: the scan's mud brown lifted toward a warm off-white (the map multiplies)
    lime.color = new Color(1.62, 1.52, 1.38);
    lime.roughness = 1;
    lime.userData.kit = true;
    const i = addMaterial(lime);
    const m0 = means[plaster];
    means[i] = [Math.min(0.75, m0[0] * 1.62), Math.min(0.75, m0[1] * 1.52), Math.min(0.75, m0[2] * 1.38)];
  }
  kit.stats.textures = kt.textures;
  // GPU memory of the textures as transcoded (every mip of every texture, once)
  const seen = new Set<Texture>();
  let bytes = 0;
  for (const m of materials) for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
    const t = (m as MeshStandardMaterial)[key] as (Texture & { mipmaps?: { data: ArrayBufferView }[] }) | null;
    if (!t || seen.has(t)) continue;
    seen.add(t);
    for (const mm of t.mipmaps ?? []) bytes += mm.data?.byteLength ?? 0;
  }
  kit.stats.textureMB = Math.round(bytes / 1e5) / 10;
  kit.stats.ms = Math.round(performance.now() - t0);
  return kit;
}

const _v = new Vector3(), _n = new Matrix3();

/** A primitive's arrays in the piece's frame: the node transform (glTF dequantisation) applied, uvs as floats,
 *  colours as RGBA bytes, indices as 32-bit. */
function primOf(g: BufferGeometry, world: Matrix4, mat: number): KitPrim {
  const P = g.attributes.position as BufferAttribute | InterleavedBufferAttribute;
  const N = g.attributes.normal as BufferAttribute | undefined;
  const U = g.attributes.uv as BufferAttribute | undefined;
  const Cc = g.attributes.color as BufferAttribute | undefined;
  const n = P.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Uint8Array(n * 4);
  _n.getNormalMatrix(world);
  for (let i = 0; i < n; i++) {
    _v.fromBufferAttribute(P, i).applyMatrix4(world);
    pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
    if (N) { _v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize(); nor[i * 3] = _v.x; nor[i * 3 + 1] = _v.y; nor[i * 3 + 2] = _v.z; }
    else nor[i * 3 + 1] = 1;
    if (U) { uv[i * 2] = U.getX(i); uv[i * 2 + 1] = U.getY(i); }
    if (Cc) {
      // COLOR_0 is linear (glTF); three reads it as given
      const a = Cc.itemSize === 4 ? Cc.getW(i) : 1;
      col[i * 4] = clamp255(Cc.getX(i)); col[i * 4 + 1] = clamp255(Cc.getY(i)); col[i * 4 + 2] = clamp255(Cc.getZ(i)); col[i * 4 + 3] = clamp255(a);
    } else { col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = col[i * 4 + 3] = 255; }
  }
  const src = g.index ? (g.index.array as ArrayLike<number>) : null;
  const idx = src ? Uint32Array.from(src) : Uint32Array.from({ length: n }, (_, i) => i);
  return { mat, pos, nor, uv, col, idx, verts: n };
}
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** sRGB → linear, for tints given in the layer's sRGB colours. */
export const linRGB = (c: [number, number, number]): [number, number, number] => [LIN(c[0]), LIN(c[1]), LIN(c[2])];
