// Builds atlas/public/game/streets/runner.glb (the Streets runner, #/streets) from two CC0 Quaternius packs, read as
// data only (provenance, hashes and licences: atlas/public/game/streets/LICENSES.md):
//   - Universal Base Characters [Standard]: Superhero_Male_FullBody.gltf + .bin and its base-colour textures
//     (T_Superhero_Male_Dark.png, T_Hair_1_BaseColor.png, T_Eye_Brown.png); the normal and roughness maps are not used.
//   - Universal Animation Library 1 and 2 [Standard]: UAL1_Standard.glb, UAL2_Standard.glb (same 65-joint skeleton).
// What it does: copies the clips the runner uses onto the base character's skeleton (rotations as they are; translation
// only on the pelvis, scaled by the ratio of pelvis rest heights; no scale tracks), drops unused vertex streams,
// downsamples the base-colour textures (body 512, brows and eyes 128), recolours the dark shorts as a madder-red
// loincloth, then prunes, resamples keyframes, quantizes (KHR_mesh_quantization) and meshopt-compresses
// (EXT_meshopt_compression, decoded in the browser by three's MeshoptDecoder).
//
// Its tools are not atlas dependencies; run it from a scratch folder that has them:
//   mkdir -p /tmp/runner-asset && cp scripts/streets/runner-asset.ts /tmp/runner-asset/ && cd /tmp/runner-asset
//   npm init -y >/dev/null && npm pkg set type=module && npm i @gltf-transform/core@4.5.0 @gltf-transform/functions@4.5.0 \
//     @gltf-transform/extensions@4.5.0 meshoptimizer@0.25.0 pngjs@7.0.0 jpeg-js@0.4.4
//   node runner-asset.ts --ubc=<dir> --ual1=<UAL1_Standard.glb> --ual2=<UAL2_Standard.glb> --out=<runner.glb>

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? '';
const UBC = arg('ubc'), UAL1 = arg('ual1'), UAL2 = arg('ual2'), OUT = arg('out');
if (!UBC || !UAL1 || !OUT) throw new Error('usage: --ubc=<dir> --ual1=<glb> [--ual2=<glb>] --out=<glb>');

const CLIPS = {
  ual1: ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll'],
  ual2: ['ClimbUp_1m'], // for the mantle (step 2)
};
const TEX: Record<string, { file: string; size: number; jpeg: boolean }> = {
  MI_Superhero_Male: { file: 'T_Superhero_Male_Dark.png', size: 512, jpeg: true },
  MI_Hair_1: { file: 'T_Hair_1_BaseColor.png', size: 128, jpeg: true },
  MI_Eyes: { file: 'T_Eye_Brown.png', size: 128, jpeg: false },
};

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// the base character, without the maps we do not ship (they need not be on disk)
const gltfPath = join(UBC, 'Superhero_Male_FullBody.gltf');
const json = JSON.parse(readFileSync(gltfPath, 'utf8'));
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const keep = new Set(Object.values(TEX).map((t) => t.file));
for (const im of json.images ?? []) if (!keep.has(im.uri) || !existsSync(join(UBC, im.uri))) im.uri = PX;
const resources: Record<string, Uint8Array> = {};
for (const b of json.buffers) resources[b.uri] = new Uint8Array(readFileSync(join(UBC, b.uri)));
for (const im of json.images ?? []) if (!im.uri.startsWith('data:')) resources[im.uri] = new Uint8Array(readFileSync(join(UBC, im.uri)));
const doc: Document = await io.readJSON({ json, resources });
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const restZ = (n: Node) => n.getTranslation()[2];

async function copyClips(path: string, names: string[]) {
  const src = await io.read(path);
  const sNodes = new Map(src.getRoot().listNodes().map((n) => [n.getName(), n]));
  const ratio = restZ(byName.get('pelvis')!) / restZ(sNodes.get('pelvis')!);
  for (const a of src.getRoot().listAnimations()) {
    if (!names.includes(a.getName())) continue;
    const anim = doc.createAnimation(a.getName());
    for (const ch of a.listChannels()) {
      const tn = ch.getTargetNode()?.getName() ?? '';
      const p = ch.getTargetPath();
      const dst = byName.get(tn);
      if (!dst || p === 'scale' || p === 'weights' || (p === 'translation' && tn !== 'pelvis')) continue;
      const s = ch.getSampler()!;
      const inp = s.getInput()!, outp = s.getOutput()!;
      const arr = (outp.getArray() as Float32Array).slice();
      if (p === 'translation') for (let i = 0; i < arr.length; i++) arr[i] *= ratio;
      const ia = doc.createAccessor().setType(inp.getType()).setArray((inp.getArray() as Float32Array).slice()).setBuffer(buffer);
      const oa = doc.createAccessor().setType(outp.getType()).setArray(arr).setBuffer(buffer);
      const smp = doc.createAnimationSampler().setInput(ia).setOutput(oa).setInterpolation(s.getInterpolation());
      anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(dst).setTargetPath(p).setSampler(smp));
    }
  }
}
await copyClips(UAL1, CLIPS.ual1);
if (UAL2) await copyClips(UAL2, CLIPS.ual2);

// vertex streams three would misuse (COLOR_0 switches vertex colours on) or never reads
for (const m of root.listMeshes()) for (const prim of m.listPrimitives()) {
  for (const k of ['COLOR_0', 'COLOR_1', 'TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3']) prim.setAttribute(k, null);
}

/** Box-filter a PNG down to size × size (RGBA). */
function shrink(file: string, size: number): { data: Uint8Array; w: number; h: number } {
  const p = PNG.sync.read(readFileSync(join(UBC, file)));
  const k = Math.max(1, Math.round(p.width / size));
  const w = Math.floor(p.width / k), h = Math.floor(p.height / k);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0, 0];
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      const o = ((y * k + j) * p.width + (x * k + i)) * 4;
      for (let c = 0; c < 4; c++) acc[c] += p.data[o + c];
    }
    for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = Math.round(acc[c] / (k * k));
  }
  return { data: out, w, h };
}
/** The dark-grey shorts become a madder-red loincloth (keeping their shading); skin is untouched. */
function loincloth(d: Uint8Array) {
  const RED = [148, 50, 38];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 26 && lum < 115 && b >= r - 6) {
      const k = Math.min(1.35, lum / 70);
      d[i] = Math.min(255, RED[0] * k); d[i + 1] = Math.min(255, RED[1] * k); d[i + 2] = Math.min(255, RED[2] * k);
    }
  }
}
for (const mat of root.listMaterials()) {
  mat.setNormalTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0);
  const spec = TEX[mat.getName()];
  const tex = mat.getBaseColorTexture();
  if (!spec || !tex) continue;
  const img = shrink(spec.file, spec.size);
  if (mat.getName() === 'MI_Superhero_Male') { loincloth(img.data); mat.setRoughnessFactor(0.78).setDoubleSided(false); }
  if (spec.jpeg) {
    tex.setImage(new Uint8Array(jpeg.encode({ data: img.data, width: img.w, height: img.h }, 86).data)).setMimeType('image/jpeg');
  } else {
    const png = new PNG({ width: img.w, height: img.h });
    png.data = Buffer.from(img.data);
    tex.setImage(new Uint8Array(PNG.sync.write(png))).setMimeType('image/png');
  }
  tex.setURI(`runner_${mat.getName().toLowerCase()}.${spec.jpeg ? 'jpg' : 'png'}`);
}
for (const t of root.listTextures()) if (!t.listParents().some((p) => p.propertyType === 'Material')) t.dispose();

await doc.transform(
  prune(), dedup(), resample({ tolerance: 1e-4 }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }),
  prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write(OUT, doc);
console.log(`${OUT}: clips ${root.listAnimations().map((a) => a.getName()).join(', ')}; ${readFileSync(OUT).length} bytes`);
