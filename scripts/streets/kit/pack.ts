// Packs the streets kit for the web: reads each pack Blender exported (build/kit/export/<pack>.glb: meshes, LODs,
// vertex colours, materials without images), attaches the KTX2 textures from build/kit/ktx2/<tier>/ by material name
// (scripts/streets/kit/materials*.json), welds, dedups and prunes, then meshopt-compresses (EXT_meshopt_compression,
// decoded by three's MeshoptDecoder; textures need KTX2Loader). Writes, in atlas/public/game/streets/kit/:
//   <pack>.gltf (hi tier, desktop) and <pack>.lo.gltf (lo tier, phones): JSON only, sharing one <pack>.bin (geometry);
//   tex/hi/*.ktx2 and tex/lo/*.ktx2: every texture once, shared by all packs (so the browser fetches and caches each
//   texture once however many packs use it);
// then kit.json from build/kit/stats/*.json.
//
// Its tools are not atlas dependencies; run it from the scratch folder that has them (same pins as runner-asset.ts):
//   mkdir -p build/kit/node && cd build/kit/node && npm init -y >/dev/null && npm pkg set type=module && \
//     npm i @gltf-transform/core@4.5.0 @gltf-transform/functions@4.5.0 @gltf-transform/extensions@4.5.0 meshoptimizer@0.25.0
//   cp ../../../scripts/streets/kit/pack.ts . && node pack.ts --root=../../.. [--packs=arch,props,veg] [--tiers=hi,lo]

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO, type Document, type Material, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const arg = (k: string, d = '') => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ROOT = resolve(arg('root', '../../..'));
const KIT = join(ROOT, 'scripts', 'streets', 'kit');
const EXPORT = join(ROOT, 'build', 'kit', 'export');
const STATS = join(ROOT, 'build', 'kit', 'stats');
const KTX = join(ROOT, 'build', 'kit', 'ktx2');
const OUT = resolve(arg('out', join(ROOT, 'atlas', 'public', 'game', 'streets', 'kit')));
const tiers = arg('tiers', 'hi,lo').split(',');

interface MatDef { set: string; hi: number; lo: number; normal?: string; roughness?: number; metallic?: number; alpha?: boolean; doubleSided?: boolean; cutoff?: number; notes?: string; tile_m?: number; trim?: boolean }
const defs: Record<string, MatDef> = {};
for (const f of readdirSync(KIT).sort()) if (f.startsWith('materials') && f.endsWith('.json')) Object.assign(defs, JSON.parse(readFileSync(join(KIT, f), 'utf8')));
const means: Record<string, number[]> = existsSync(join(KIT, 'means.json')) ? JSON.parse(readFileSync(join(KIT, 'means.json'), 'utf8')) : {};

const packsAll = readdirSync(STATS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const packs = arg('packs') ? arg('packs').split(',') : packsAll;

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
mkdirSync(OUT, { recursive: true });

const baseName = (n: string) => n.replace(/\.\d+$/, '');

function texture(doc: Document, cache: Map<string, Texture>, tier: string, set: string, map: 'bc' | 'n' | 'orm'): Texture {
  const key = `${set}_${map}`;
  let t = cache.get(key);
  if (t) return t;
  const file = join(KTX, tier, `${set}_${map}.ktx2`);
  if (!existsSync(file)) throw new Error(`missing ${file} (run encode_textures.py)`);
  t = doc.createTexture(key).setImage(new Uint8Array(readFileSync(file))).setMimeType('image/ktx2').setURI(`tex/${tier}/${key}.ktx2`);
  cache.set(key, t);
  return t;
}

function dress(doc: Document, tier: string) {
  const cache = new Map<string, Texture>();
  for (const m of doc.getRoot().listMaterials()) {
    const name = baseName(m.getName());
    const d = defs[name];
    if (!d) { console.warn(`  no material def for ${m.getName()}`); continue; }
    m.setName(name);
    const bc = texture(doc, cache, tier, d.set, 'bc'), n = texture(doc, cache, tier, d.set, 'n'), orm = texture(doc, cache, tier, d.set, 'orm');
    m.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(bc);
    m.setNormalTexture(n).setNormalScale(1);
    m.setMetallicRoughnessTexture(orm).setMetallicFactor(d.metallic ?? 0).setRoughnessFactor(d.roughness ?? 1);
    m.setOcclusionTexture(orm).setOcclusionStrength(1);
    m.setEmissiveFactor([0, 0, 0]).setEmissiveTexture(null);
    m.setDoubleSided(!!d.doubleSided);
    if (d.alpha) m.setAlphaMode('MASK').setAlphaCutoff(d.cutoff ?? 0.5); else m.setAlphaMode('OPAQUE');
    for (const ti of [m.getBaseColorTextureInfo(), m.getNormalTextureInfo(), m.getMetallicRoughnessTextureInfo(), m.getOcclusionTextureInfo()]) {
      ti?.setTexCoord(0);
      // trilinear + anisotropy is the renderer's job; wrap is always repeat (tiling sets)
    }
  }
  // merge materials of the same name (Blender may export duplicates per object)
  const byName = new Map<string, Material>();
  for (const m of doc.getRoot().listMaterials()) {
    const keep = byName.get(m.getName());
    if (!keep) { byName.set(m.getName(), m); continue; }
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) if (p.getMaterial() === m) p.setMaterial(keep);
    m.dispose();
  }
}

const sizes: Record<string, Record<string, number>> = {};
for (const pack of packs) {
  const stats = JSON.parse(readFileSync(join(STATS, `${pack}.json`), 'utf8'));
  const src = join(EXPORT, stats.file);
  for (const tier of tiers) {
    const doc = await io.read(src);
    doc.createExtension(KHRTextureBasisu).setRequired(true);
    dress(doc, tier);
    await doc.transform(
      weld(),
      dedup(),
      prune({ keepAttributes: false, keepLeaves: true }),
      // normals, uvs and colours quantized; positions stay float so a mesh's geometry is usable without its node
      quantize({ pattern: /^(NORMAL|TEXCOORD_\d|COLOR_\d)$/, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8 }),
    );
    // LOD0 in a buffer of its own (<pack>.lod0.bin): the game draws LOD1 and LOD2 and never fetches it
    const root = doc.getRoot();
    const main = root.listBuffers()[0];
    const lod0 = doc.createBuffer('lod0');
    const lodOf = (n: string) => (/_LOD\d+$/.test(n) ? 1 : 0);
    const users = new Map<unknown, Set<number>>();
    for (const node of root.listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      for (const prim of mesh.listPrimitives()) for (const a of [...prim.listAttributes(), prim.getIndices()]) {
        if (!a) continue;
        let u = users.get(a);
        if (!u) { u = new Set(); users.set(a, u); }
        u.add(lodOf(node.getName()));
      }
    }
    let moved = 0;
    for (const [a, u] of users) if (u.size === 1 && u.has(0)) { (a as { setBuffer(b: unknown): void }).setBuffer(lod0); moved++; }
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true);
    for (const b of root.listBuffers()) b.setURI(b === lod0 || b.getName() === 'lod0' ? `${pack}.lod0.bin` : `${pack}.bin`);
    void main; void moved;
    const out = join(OUT, tier === 'hi' ? `${pack}.gltf` : `${pack}.${tier}.gltf`);
    await io.write(out, doc);
    writeFileSync(out, JSON.stringify(JSON.parse(readFileSync(out, 'utf8'))));   // minified
    for (const old of [join(OUT, `${pack}.glb`), join(OUT, `${pack}.${tier}.glb`)]) if (existsSync(old)) unlinkSync(old);
    const lod0Bin = join(OUT, `${pack}.lod0.bin`);
    const bytes = statSync(out).size + statSync(join(OUT, `${pack}.bin`)).size + (existsSync(lod0Bin) ? statSync(lod0Bin).size : 0);
    (sizes[pack] ??= {})[tier] = bytes;
    console.log(`${pack} ${tier}: gltf+bin ${(bytes / 1048576).toFixed(2)} MB`);
  }
}

// ---------------------------------------------------------------- kit.json
const kit: Record<string, unknown> = {
  name: 'Pumi hero-district kit (Runner of the Tablet House)',
  version: 1,
  generated: 'scripts/streets/kit (Blender 5.2 build scripts) + pack.ts; sources in LICENSES.md',
  conventions: {
    units: 'metres; glTF Y-up; a piece faces +Z (its exterior / front); x runs along a wall run',
    pivots: 'baked into each mesh: every node sits at the origin with identity transform; see each piece\'s pivot',
    lods: 'nodes <name> (LOD0), <name>_LOD1, <name>_LOD2; suggested switch distances in lodDistances (m, desktop; halve on phones)',
    lodDistances: [0, 18, 45],
    vertexColors: 'COLOR_0 (multiply into base colour per glTF): baked contact occlusion, grime, tint. GLTFLoader enables it.',
    textures: 'KTX2 (KHR_texture_basisu): load with KTX2Loader (three/examples/jsm/loaders/KTX2Loader + basis transcoder). Geometry: EXT_meshopt_compression, set GLTFLoader.setMeshoptDecoder(MeshoptDecoder). Normals, UVs and colours use KHR_mesh_quantization; positions are float.',
    tiers: 'hi = <pack>.gltf (desktop, 2K hero textures, UASTC normals); lo = <pack>.lo.gltf (phones, 1K, ETC1S). Both share <pack>.bin (LOD1 and LOD2 geometry) and <pack>.lod0.bin (LOD0 only, loaded only when a LOD0 node is), and reference shared textures in tex/hi or tex/lo; same nodes and pivots in both.',
    instancing: 'each piece is one mesh with 1-3 primitives (one per material); draw with InstancedMesh per primitive, or merge per cell by material (all pieces share a handful of materials).',
    houses: 'world.houses footprints are continuous (3.6-7.8 m a side, walls 3.4-5.3 m tall, roof slab 0.4 m). Reference implementation: scripts/streets/kit/viewer.html house(). Per side, in order front, right, back, left, each side frame turned +90 deg about y from the last (x runs along the side from its start corner, exterior +Z, the footprint toward -Z): corner_out at x = 0; wall modules filling x 0.5 .. L-0.5, stretched along x by (L-1)/sum(widths) (keep 0.9-1.1); for walls taller than 3.0 m stack wallband_* (1 m each) and cornerband at y = 3, 4, ... and stretch y so the last band ends at the wall top; at the wall top y = Hw: roof_edge_corner at x = 0, roof_edge_2m filling 0.5 .. L-0.5, beam_ends_2m (optional, long sides) the same; in the frame offset by (-0.1, Hw+0.4, +0.1): parapet_corner at the origin, parapet_2m / parapet_2m_b filling 0.26 .. L+0.2-0.26. roof_field_2m tiles fill the inner rectangle 0.5 .. W-0.5 by 0.5 .. D-0.5 at y = Hw (their surface is y = Hw + 0.4). Doors: door_leaf_s in door_2m at (0.49, 0, -0.34), door_leaf_l pairs in door_3m at (0.77, 0, -0.34) and (2.23, 0, -0.34) mirrored; rotate about y to open (inward, toward -z).',
    uvs: 'tileable materials map 1 UV unit = tile_m (2 m) from each piece\'s pivot, so runs of 2 m and 4 m modules tile seamlessly; a 1 m module or a corner leaves a texture phase step at its far end unless the next piece's u is offset by the run's phase so far (sum of nominal widths / 2), as the game does (atlas/src/game/streets/world/assemble.ts); brick courses stay level (v is height). Stretching scales the texture with the piece.',
    tint: 'COLOR_0 holds baked occlusion and grime; per-house plaster tint goes on top as an instance colour (three multiplies instanceColor x vertex colour x map). Props carry their own tint in COLOR_0 (see each piece\'s extras).',
    collision: 'pieces are visual; collide with simple boxes: a wall piece is x 0..W, y 0..H, z -T..0; parapets x 0..W, y 0..0.55, z -0.26..0; stair_flight a wedge from (0,0) to (3.36, 3.0) over z 0..1.',
  },
  // mean linear albedo per set (means.py), for the game's far LOD drawn without textures
  materials: Object.fromEntries(Object.entries(defs).map(([k, d]) => [k, { set: d.set, tile_m: d.tile_m ?? null, trim: !!d.trim, alpha: !!d.alpha, doubleSided: !!d.doubleSided, hi: d.hi, lo: d.lo, normal: d.normal ?? 'etc1s', notes: d.notes ?? '', ...(means[d.set] ? { mean: means[d.set] } : {}) }])),
  packs: {} as Record<string, unknown>,
  pieces: [] as unknown[],
};
for (const pack of packsAll) {
  const stats = JSON.parse(readFileSync(join(STATS, `${pack}.json`), 'utf8'));
  const files: Record<string, unknown> = {};
  const bin = join(OUT, `${pack}.bin`);
  for (const tier of ['hi', 'lo']) {
    const f = join(OUT, tier === 'hi' ? `${pack}.gltf` : `${pack}.${tier}.gltf`);
    if (!existsSync(f)) continue;
    const g = JSON.parse(readFileSync(f, 'utf8'));
    const tex = [...new Set((g.images ?? []).map((i: { uri: string }) => i.uri))];
    files[tier] = { file: f.slice(OUT.length + 1), bytes: statSync(f).size + (existsSync(bin) ? statSync(bin).size : 0), textures: tex };
  }
  (kit.packs as Record<string, unknown>)[pack] = { geometry: `${pack}.bin`, ...files };
  // materials actually drawn, read back from the packed glTF (one primitive per material per LOD node)
  const gf = join(OUT, `${pack}.gltf`);
  const used = new Map<string, string[]>();
  if (existsSync(gf)) {
    const g = JSON.parse(readFileSync(gf, 'utf8'));
    for (const m of g.meshes ?? []) used.set(m.name, m.primitives.map((pr: { material: number }) => g.materials[pr.material]?.name));
  }
  for (const p of stats.pieces) {
    const { view, lens, no_ground, materials, ...rest } = p;
    const mats = used.get(p.name) ?? materials;
    (kit.pieces as unknown[]).push({ pack, file: `${pack}.gltf`, fileLo: `${pack}.lo.gltf`, ...rest, materials: mats, primitives: mats.length });
  }
}
// textures: each once, shared
const texBytes: Record<string, number> = {};
for (const tier of ['hi', 'lo']) {
  const d = join(OUT, 'tex', tier);
  texBytes[tier] = existsSync(d) ? readdirSync(d).reduce((a, f) => a + statSync(join(d, f)).size, 0) : 0;
}
const geo = Object.keys(kit.packs as object).reduce((a, p) => {
  const bin = join(OUT, `${p}.bin`);
  return a + (existsSync(bin) ? statSync(bin).size : 0);
}, 0);
const json = (tier: string) => Object.keys(kit.packs as object).reduce((a, p) => {
  const f = join(OUT, tier === 'hi' ? `${p}.gltf` : `${p}.${tier}.gltf`);
  return a + (existsSync(f) ? statSync(f).size : 0);
}, 0);
const geo0 = Object.keys(kit.packs as object).reduce((a, p) => {
  const bin = join(OUT, `${p}.lod0.bin`);
  return a + (existsSync(bin) ? statSync(bin).size : 0);
}, 0);
kit.download = {
  note: 'bytes on the wire before HTTP compression (gzip shrinks the .gltf JSON ~5x; .bin and .ktx2 are already compressed). LOD0 geometry is in <pack>.lod0.bin (geometryLod0), fetched only by a viewer that draws LOD0; the game draws LOD1 and LOD2.',
  geometryLod0: geo0,
  hi: { geometry: geo, json: json('hi'), textures: texBytes.hi, total: geo + json('hi') + texBytes.hi },
  lo: { geometry: geo, json: json('lo'), textures: texBytes.lo, total: geo + json('lo') + texBytes.lo },
};
writeFileSync(join(OUT, 'kit.json'), JSON.stringify(kit, null, 1));
const dl = kit.download as Record<string, Record<string, number>>;
console.log(`download hi ${(dl.hi.total / 1048576).toFixed(2)} MB (textures ${(dl.hi.textures / 1048576).toFixed(2)}), lo ${(dl.lo.total / 1048576).toFixed(2)} MB (textures ${(dl.lo.textures / 1048576).toFixed(2)}), geometry ${(geo / 1048576).toFixed(2)} MB; kit.json written`);
