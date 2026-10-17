// Step 1 of the hero build (scripts/streets/hero/build.sh): reads the game's runner.glb (the UAL skeleton and every
// clip the game plays, built by scripts/streets/runner-asset.ts) and writes, for Blender:
//   <out>/runner-plain.glb  the same file without meshopt compression or quantization (Blender reads it plainly);
//   <out>/skeleton.json     every joint's name, parent, rest TRS and rest world matrix (glTF space: y up, metres),
//                           and the clips' names and durations.
// The hero keeps this skeleton and these clips byte for byte: assemble.ts copies them from runner.glb itself.
// Usage (from a folder with the tools, see build.sh): node skeleton.ts --runner=<runner.glb> --out=<dir>

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? '';
const RUNNER = arg('runner'), OUT = arg('out');
if (!RUNNER || !OUT) throw new Error('usage: --runner=<runner.glb> --out=<dir>');
mkdirSync(OUT, { recursive: true });

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(RUNNER);
const root = doc.getRoot();
await doc.transform(dequantize());
for (const e of root.listExtensionsUsed()) {
  if (e.extensionName === 'EXT_meshopt_compression' || e.extensionName === 'KHR_mesh_quantization') e.dispose();
}
await io.write(join(OUT, 'runner-plain.glb'), doc);

const skin = root.listSkins()[0];
const joints = skin.listJoints();
const parentName = (n: Node) => n.getParentNode()?.getName() ?? '';
const info = {
  source: RUNNER,
  joints: joints.map((j) => ({
    name: j.getName(),
    parent: parentName(j),
    t: j.getTranslation(), r: j.getRotation(), s: j.getScale(),
    world: Array.from(j.getWorldMatrix()),
  })),
  armature: joints[0].getParentNode()?.getName() ?? '',
  clips: root.listAnimations().map((a) => ({
    name: a.getName(),
    duration: Math.max(...a.listSamplers().map((s) => { const t = s.getInput()!.getArray()!; return t[t.length - 1]; })),
  })),
};
writeFileSync(join(OUT, 'skeleton.json'), JSON.stringify(info, null, 1));
console.log(`skeleton: ${joints.length} joints, ${info.clips.length} clips → ${OUT}`);
