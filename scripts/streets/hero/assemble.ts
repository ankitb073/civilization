// Step 7 of the hero build: puts the hero's meshes (exported by export.py, skinned to UAL_bind) on the game's own
// skeleton and clips, copied unchanged from runner.glb, gives them their materials, and compresses the result.
//   - Skeleton and clips: runner.glb's joint nodes and all its animations, as they are (same names, same rest, same
//     keys), so runner.ts plays hero.glb exactly as it plays runner.glb. runner.glb's meshes, materials and textures go.
//   - Meshes: each mesh from the Blender export, its JOINTS_0 remapped to runner.glb's joint order, on one new skin over
//     runner.glb's joints whose inverse bind matrices put the bind pose (bind.json: each joint's change from rest) on
//     the rest skeleton. The meshes hang under runner.glb's "Armature" node, as its own meshes did.
//   - Materials: rebuilt here by name from MATERIALS below and the maps in build/hero/work/tex (the Blender export
//     only carries the names), so every glTF parameter is set on purpose.
//   - Compression: KHR_mesh_quantization and EXT_meshopt_compression (three's MeshoptDecoder, as for runner.glb);
//     textures as WebP (EXT_texture_webp, which three's GLTFLoader reads without setup) or, with --ktx2, KTX2/Basis
//     (KHR_texture_basisu, needs three's KTX2Loader).
// Usage (from build/hero/tools, see build.sh):
//   node assemble.ts --runner=<runner.glb> --meshes=<export.glb> --bind=<bind.json> --tex=<dir> --out=<hero.glb>
//     [--size=<max texture size>] [--webp-q=<quality>] [--ktx2] [--raw=<uncompressed copy.glb>]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO, type Material, type Node, type Texture } from '@gltf-transform/core';
import {
  ALL_EXTENSIONS, EXTTextureWebP, KHRMaterialsAnisotropy, KHRMaterialsIOR, KHRMaterialsTransmission, KHRTextureBasisu,
} from '@gltf-transform/extensions';
import { dedup, dequantize, mergeDocuments, meshopt, prune, quantize, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { PNG } from 'pngjs';

const arg = (k: string, d = '') => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const RUNNER = arg('runner'), MESHES = arg('meshes'), BIND = arg('bind'), OUT = arg('out'), TEXDIR = arg('tex');
const SIZE = Number(arg('size', '2048')), WEBP_Q = Number(arg('webp-q', '86')), KTX2 = process.argv.includes('--ktx2');
const RAW = arg('raw');
if (!RUNNER || !MESHES || !BIND || !OUT || !TEXDIR) throw new Error('usage: --runner= --meshes= --bind= --tex= --out= [--size=2048] [--ktx2]');

// ---------------------------------------------------------------- materials, by the names the Blender scripts give
type Spec = {
  color?: string; rgba?: [number, number, number, number]; normal?: string; normalScale?: number;
  orm?: string; roughness?: number; occlusion?: boolean; alpha?: 'BLEND' | 'MASK'; cutoff?: number; double?: boolean;
  ior?: number; transmission?: number; anisotropy?: { strength: number; texture?: string };
};
const MATERIALS: Record<string, Spec> = {
  // skin: base colour, normal, and one map for occlusion (R), roughness (G) and thickness (B, for the game's skin
  // shader patch; three reads B as metalness × metallicFactor, which is 0)
  skin: { color: 'skin_basecolor', normal: 'skin_normal', orm: 'skin_orm', occlusion: true, ior: 1.4 },
  eye: { color: 'eye_basecolor', roughness: 0.35 },
  // LOD1's eye has no cornea: a glossier eyeball stands in for the wet glass
  eye_glossy: { color: 'eye_basecolor', roughness: 0.12 },
  // the cornea is clear glass; cheap engines may draw it additively instead (see LICENSES/README in the hero folder)
  cornea: { rgba: [1, 1, 1, 1], roughness: 0.03, transmission: 1, ior: 1.376 },
  brows: { color: 'brows', alpha: 'BLEND', double: true, roughness: 0.6 },
  lashes: { color: 'lashes', alpha: 'BLEND', double: true, roughness: 0.6 },
  hair: { color: 'hair_basecolor', normal: 'hair_normal', alpha: 'BLEND', roughness: 0.66, ior: 1.45, anisotropy: { strength: 0.5, texture: 'hair_anisotropy' } },
  linen: { color: 'linen_basecolor', normal: 'linen_normal', orm: 'linen_orm', occlusion: true, double: true },
  leather: { color: 'leather_basecolor', normal: 'leather_normal', orm: 'leather_orm', occlusion: true },
  clay: { color: 'clay_basecolor', normal: 'clay_normal', orm: 'clay_orm', occlusion: true },
};

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// ---------------------------------------------------------------- small matrix helpers (column-major 4×4)
type M4 = number[];
const mul = (a: M4, b: M4): M4 => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function inv(m: M4): M4 {
  const o = new Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

// ---------------------------------------------------------------- the game's skeleton and clips
const doc = await io.read(RUNNER);
const root = doc.getRoot();
await doc.transform(dequantize());
const runnerSkin = root.listSkins()[0];
const joints = runnerSkin.listJoints();
const jointIndex = new Map(joints.map((j, i) => [j.getName(), i]));
const armature = joints[0].getParentNode()!;
for (const n of root.listNodes()) if (n.getMesh()) { n.getMesh()!.dispose(); n.dispose(); }
for (const s of root.listSkins()) s.dispose();
for (const m of root.listMaterials()) m.dispose();
for (const t of root.listTextures()) t.dispose();
const clips = root.listAnimations().map((a) => a.getName());

// bind pose: each joint's world matrix at bind = delta · rest world
const bind = JSON.parse(readFileSync(BIND, 'utf8')).delta as Record<string, M4>;
const ibm = new Float32Array(joints.length * 16);
joints.forEach((j, i) => {
  const D = bind[j.getName()];
  if (!D) throw new Error(`bind.json has no ${j.getName()}`);
  ibm.set(inv(mul(D, Array.from(j.getWorldMatrix()))), i * 16);
});
const buffer = root.listBuffers()[0];
const skin = doc.createSkin('hero').setSkeleton(joints[0]).setInverseBindMatrices(
  doc.createAccessor('hero_ibm').setType('MAT4').setArray(ibm).setBuffer(buffer));
for (const j of joints) skin.addJoint(j);

// ---------------------------------------------------------------- the hero's meshes
const src = await io.read(MESHES);
const sRoot = src.getRoot();
const sSkin = sRoot.listSkins()[0];
const sJoints = sSkin.listJoints();
// sanity: the export's own bind (its joints' world matrices) against bind.json's
const sIbm = sSkin.getInverseBindMatrices()!.getArray()!;
let worst = 0;
sJoints.forEach((j, i) => {
  const k = jointIndex.get(j.getName());
  if (k === undefined) return;
  const mine = inv(Array.from(ibm.slice(k * 16, k * 16 + 16)));
  const theirs = inv(Array.from(sIbm.slice(i * 16, i * 16 + 16)));
  for (let c = 12; c < 15; c++) worst = Math.max(worst, Math.abs(mine[c] - theirs[c]));
});
console.log(`bind check: joint positions agree within ${(worst * 1000).toFixed(3)} mm`);
if (worst > 1e-4) throw new Error('the export was bound to a different pose than bind.json');
const remap = sJoints.map((j) => {
  const k = jointIndex.get(j.getName());
  if (k === undefined) throw new Error(`runner.glb has no joint ${j.getName()}`);
  return k;
});
const meshNodes = sRoot.listNodes().filter((n) => n.getMesh() && n.getSkin());
for (const n of meshNodes) {
  for (const p of n.getMesh()!.listPrimitives()) {
    const J = p.getAttribute('JOINTS_0')!;
    const arr = J.getArray()!;
    const out = new Uint16Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = remap[arr[i]];
    J.setArray(out);
  }
}
for (const t of sRoot.listTextures()) t.dispose();
const map = mergeDocuments(doc, src);
for (const s of root.listScenes().slice(1)) s.dispose();
const added: Node[] = [];
for (const n of meshNodes) {
  const m = map.get(n) as Node;
  const node = doc.createNode(n.getName()).setMesh(m.getMesh()).setSkin(skin);
  armature.addChild(node);
  added.push(node);
}
for (const s of root.listSkins()) if (s !== skin) s.dispose();

// ---------------------------------------------------------------- materials
const texCache = new Map<string, Texture>();
function tex(name: string): Texture {
  if (!texCache.has(name)) {
    const f = join(TEXDIR, `${name}.png`);
    if (!existsSync(f)) throw new Error(`missing texture ${f}`);
    texCache.set(name, doc.createTexture(name).setImage(new Uint8Array(readFileSync(f))).setMimeType('image/png').setURI(`${name}.png`));
  }
  return texCache.get(name)!;
}
const iorExt = doc.createExtension(KHRMaterialsIOR);
const trExt = doc.createExtension(KHRMaterialsTransmission);
const anExt = doc.createExtension(KHRMaterialsAnisotropy);
const built = new Map<string, Material>();
function build(name: string): Material {
  if (built.has(name)) return built.get(name)!;
  const s = MATERIALS[name];
  if (!s) throw new Error(`no material spec for "${name}"`);
  const m = doc.createMaterial(name).setMetallicFactor(0).setRoughnessFactor(s.orm ? 1 : (s.roughness ?? 0.6));
  if (s.color) m.setBaseColorTexture(tex(s.color));
  if (s.rgba) m.setBaseColorFactor(s.rgba);
  if (s.normal) m.setNormalTexture(tex(s.normal)).setNormalScale(s.normalScale ?? 1);
  if (s.orm) {
    m.setMetallicRoughnessTexture(tex(s.orm));
    if (s.occlusion) m.setOcclusionTexture(tex(s.orm));
  }
  if (s.alpha) m.setAlphaMode(s.alpha).setAlphaCutoff(s.cutoff ?? 0.5);
  m.setDoubleSided(!!s.double);
  if (s.ior) m.setExtension('KHR_materials_ior', iorExt.createIOR().setIOR(s.ior));
  if (s.transmission) m.setExtension('KHR_materials_transmission', trExt.createTransmission().setTransmissionFactor(s.transmission));
  if (s.anisotropy) {
    const a = anExt.createAnisotropy().setAnisotropyStrength(s.anisotropy.strength);
    if (s.anisotropy.texture) a.setAnisotropyTexture(tex(s.anisotropy.texture));
    m.setExtension('KHR_materials_anisotropy', a);
  }
  built.set(name, m);
  return m;
}
const used = new Set<string>();
for (const n of added) for (const p of n.getMesh()!.listPrimitives()) {
  const nm = (p.getMaterial()?.getName() ?? '').replace(/\.\d+$/, '');
  p.setMaterial(build(nm));
  used.add(nm);
  // the vertex colours only matter where a material multiplies by them (the gear); elsewhere drop them
  if (!['linen', 'leather', 'clay'].includes(nm)) p.setAttribute('COLOR_0', null);
}
await doc.transform(prune({ keepLeaves: true, keepAttributes: false }), dedup(), unpartition());

// ---------------------------------------------------------------- textures: downsize, then WebP or KTX2
const tmp = mkdtempSync(join(tmpdir(), 'hero-tex-'));
function encode(t: Texture, i: number) {
  const img = t.getImage()!;
  const p = PNG.sync.read(Buffer.from(img));
  const inF = join(tmp, `t${i}.png`);
  writeFileSync(inF, img);
  const role = new Set<string>();
  for (const par of t.listParents()) {
    if (par.propertyType !== 'Material') continue;
    const m = par as Material;
    if (m.getNormalTexture() === t) role.add('normal');
    if (m.getBaseColorTexture() === t) role.add('color');
    if (m.getMetallicRoughnessTexture() === t || m.getOcclusionTexture() === t) role.add('data');
  }
  if ((t.getName() ?? '').includes('anisotropy')) role.add('data');
  // the skin gets the full size; the hair half of it; tiling materials (which repeat every few centimetres) a quarter
  const nm = t.getName() ?? '';
  const cap = nm.startsWith('skin_') ? SIZE : nm.startsWith('hair_') || nm.startsWith('eye') ? SIZE / 2 : SIZE / 4;
  const k = Math.max(1, Math.max(p.width, p.height) / Math.max(256, cap));
  const w = Math.round(p.width / k), h = Math.round(p.height / k);
  const name = t.getName() || `tex${i}`;
  if (KTX2) {
    const outF = join(tmp, `t${i}.ktx2`);
    const a = ['-ktx2', '-mipmap', '-y_flip', '-resample', String(w), String(h)];
    // UASTC (with rate-distortion optimisation, then Zstandard) for normals and data, ETC1S for colour
    if (role.has('normal')) a.push('-uastc', '-uastc_level', '2', '-uastc_rdo_l', '1.5', '-normal_map');
    else if (role.has('data')) a.push('-uastc', '-uastc_level', '2', '-uastc_rdo_l', '1.5', '-linear');
    else a.push('-q', '220');
    a.push('-output_file', outF, inF);
    execFileSync('basisu', a, { stdio: 'ignore' });
    t.setImage(new Uint8Array(readFileSync(outF))).setMimeType('image/ktx2').setURI(`${name}.ktx2`);
  } else {
    const outF = join(tmp, `t${i}.webp`);
    const q = role.has('normal') ? Math.max(WEBP_Q, 92) : role.has('data') ? Math.max(WEBP_Q, 90) : WEBP_Q;
    const a = ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', '-alpha_q', '100', '-resize', String(w), String(h)];
    a.push(inF, '-o', outF);
    execFileSync('cwebp', a);
    t.setImage(new Uint8Array(readFileSync(outF))).setMimeType('image/webp').setURI(`${name}.webp`);
  }
}
if (RAW) await io.write(RAW, doc);
const texs = root.listTextures();
texs.forEach((t, i) => encode(t, i));
if (KTX2) doc.createExtension(KHRTextureBasisu).setRequired(true);
else doc.createExtension(EXTTextureWebP).setRequired(true);
rmSync(tmp, { recursive: true, force: true });

await doc.transform(
  prune({ keepLeaves: true }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8, quantizeWeight: 8, quantizeGeneric: 12 }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write(OUT, doc);

// ---------------------------------------------------------------- report
let tris = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
const texBytes = root.listTextures().reduce((s, t) => s + (t.getImage()?.byteLength ?? 0), 0);
const report = {
  file: OUT, bytes: statSync(OUT).size, triangles: tris, textureBytes: texBytes, geometryAndClipBytes: statSync(OUT).size - texBytes,
  textures: root.listTextures().map((t) => ({ name: t.getURI(), bytes: t.getImage()?.byteLength })),
  meshes: root.listMeshes().map((m) => ({ name: m.getName(), triangles: m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0), materials: m.listPrimitives().map((p) => p.getMaterial()?.getName()) })),
  materials: [...used], joints: joints.length, clips,
};
writeFileSync(OUT.replace(/\.glb$/, '.report.json'), JSON.stringify(report, null, 1));
console.log(`${OUT}: ${report.bytes} bytes (textures ${texBytes}), ${tris} triangles, ${report.textures.length} textures, ${clips.length} clips`);
