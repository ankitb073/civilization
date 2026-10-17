// Builds atlas/public/game/streets/runner.glb (the Streets runner, #/streets) from two CC0 Quaternius packs, read as
// data only (provenance, hashes and licences: atlas/public/game/streets/LICENSES.md):
//   - Universal Base Characters [Standard]: Superhero_Male_FullBody.gltf + .bin and its base-colour textures
//     (T_Superhero_Male_Dark.png, T_Hair_1_BaseColor.png, T_Eye_Brown.png); the normal and roughness maps are not used.
//   - Universal Animation Library 1 and 2 [Standard]: UAL1_Standard.glb, UAL2_Standard.glb (same 65-joint skeleton).
// What it does: copies the clips the runner uses onto the base character's skeleton (rotations as they are; translation
// only on the pelvis, scaled by the ratio of pelvis rest heights; no scale tracks); authors three jump clips from
// frames of those clips plus joint angles (Run_Jump_L and Run_Jump_R, a running jump off either foot, and Jump_Air, the
// standing jump's flight; see "Authored clips" below); drops unused vertex streams,
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

// ---------------------------------------------------------------------------------------------------------------------
// Authored clips. No free pack has a running jump for this rig (UAL1 and UAL2 have a standing jump and a stylised
// "ninja" tuck; Mesh2Motion's "Run Jump" is one held pose), so the jumps are posed here, from frames of the clips above
// plus joint angles, and interpolated. Each clip is a phase from take-off (0) to touch-down (1) over one second; the
// game sets its time from the arc, so the pose always matches what the body is doing in the air.
// Model space: y up, +z forward, +x the runner's left. Quaternions are [x, y, z, w].

type Q = [number, number, number, number];
type V3 = [number, number, number];
const qmul = (a: Q | number[], b: Q | number[]): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q: Q | number[]): Q => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q: number[]): Q => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qaxis = (ax: V3, deg: number): Q => { const h = (deg * Math.PI) / 360, s = Math.sin(h); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; };
const qdot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const qslerp = (a: Q, b0: Q, t: number): Q => {
  const b = qdot(a, b0) < 0 ? (b0.map((x) => -x) as Q) : b0;
  const d = Math.min(1, qdot(a, b));
  if (d > 0.9995) return qnorm(a.map((x, i) => x + (b[i] - x) * t));
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
};

/** A pose: every joint's local rotation, and the pelvis's translation (armature units, z up). */
interface Pose { r: Map<string, Q>; pelvis: V3 }
const joints = root.listSkins()[0].listJoints();
const depth = (n: Node): number => { let d = 0; for (let p = n.getParentNode(); p; p = p.getParentNode()) d++; return d; };
joints.sort((a, b) => depth(a) - depth(b));
const parentOf = new Map(joints.map((j) => [j.getName(), j.getParentNode()?.getName() ?? '']));
const restPose = (): Pose => ({ r: new Map(joints.map((j) => [j.getName(), j.getRotation() as Q])), pelvis: byName.get('pelvis')!.getTranslation() as V3 });
const clone = (p: Pose): Pose => ({ r: new Map(p.r), pelvis: [...p.pelvis] as V3 });

/** Sample a clip of the document at time t (linear samplers, as all of these are). */
function sample(clip: string, t: number): Pose {
  const a = root.listAnimations().find((x) => x.getName() === clip);
  if (!a) throw new Error(`no clip ${clip}`);
  const p = restPose();
  for (const ch of a.listChannels()) {
    const n = ch.getTargetNode()!.getName(), path = ch.getTargetPath();
    if (path !== 'rotation' && !(path === 'translation' && n === 'pelvis')) continue;
    const s = ch.getSampler()!;
    const ins = s.getInput()!.getArray() as Float32Array, outs = s.getOutput()!.getArray() as Float32Array;
    const k = path === 'rotation' ? 4 : 3;
    const tt = Math.max(ins[0], Math.min(ins[ins.length - 1], t));
    let i = 0;
    while (i < ins.length - 2 && ins[i + 1] < tt) i++;
    const f = ins[i + 1] > ins[i] ? (tt - ins[i]) / (ins[i + 1] - ins[i]) : 0;
    const A = Array.from(outs.slice(i * k, i * k + k)), B = Array.from(outs.slice((i + 1) * k, (i + 1) * k + k));
    if (path === 'rotation') p.r.set(n, qslerp(A as Q, B as Q, f));
    else p.pelvis = A.map((x, j) => x + (B[j] - x) * f) as V3;
  }
  return p;
}

/** Model-space rotation of each joint in a pose (the root's parents carry no rotation). */
function world(p: Pose): Map<string, Q> {
  const w = new Map<string, Q>();
  for (const j of joints) {
    const n = j.getName(), par = w.get(parentOf.get(n)!);
    w.set(n, par ? qmul(par, p.r.get(n)!) : p.r.get(n)!);
  }
  return w;
}

/** The axis each kind of joint bends about, signed so that a positive angle is the natural way: hips, shoulders and
 *  elbows swing the limb forward and up; knees bend the heel back; the trunk, neck and head lean forward; ankles point
 *  the toes; balls lift them. `abd` takes a limb out to its own side. */
function axisOf(bone: string, kind: 'flex' | 'abd'): V3 {
  const side = bone.endsWith('_l') ? 1 : bone.endsWith('_r') ? -1 : 0;
  if (kind === 'abd') return [0, 0, side || 1];
  if (/^(thigh|upperarm|lowerarm|hand|clavicle|ball)_/.test(bone)) return [-1, 0, 0];
  return [1, 0, 0]; // calf, foot, pelvis, spine, neck, head
}

/** Turn joints by angles (degrees) in model space, about their natural axes, carrying their children along: out to the
 *  side first, then forward. Applied root-first, so a knee bends about the axis as the thigh now hangs. With `abs`, each
 *  named joint starts from its rest angle (legs straight down, arms straight out) instead of from the pose's. */
function bend(p0: Pose, ops: Record<string, number | [number, number]>, abs = false): Pose {
  const p = clone(p0);
  const rest = restPose();
  for (const j of joints) {
    const n = j.getName(), op = ops[n];
    if (op === undefined) continue;
    const [flex, abd] = typeof op === 'number' ? [op, 0] : op;
    if (abs) p.r.set(n, rest.r.get(n)!);
    const w = world(p);
    const P = w.get(parentOf.get(n)!) ?? ([0, 0, 0, 1] as Q);
    const R = qmul(qaxis(axisOf(n, 'flex'), flex), qaxis(axisOf(n, 'abd'), abd));
    p.r.set(n, qnorm(qmul(qmul(qmul(qconj(P), R), P), p.r.get(n)!)));
  }
  return p;
}
const lowerPelvis = (p0: Pose, m: number): Pose => { const p = clone(p0); p.pelvis = [p.pelvis[0], p.pelvis[1], p.pelvis[2] - m]; return p; };
const rot = (q: Q, v: V3): V3 => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)); return [r[0], r[1], r[2]]; };
/** The lowest point of the feet (ankles, balls, toe tips) above the runner's origin, in metres. */
function lowest(p: Pose): number {
  const w = world(p), pos = new Map<string, V3>();
  for (const j of joints) {
    const n = j.getName(), par = parentOf.get(n)!;
    const t = n === 'pelvis' ? p.pelvis : (j.getTranslation() as V3);
    const P = w.get(par), pp = pos.get(par);
    pos.set(n, P && pp ? rot(P, t).map((x, i) => x + pp[i]) as V3 : [0, 0, 0]);
  }
  return Math.min(...[...pos].filter(([n]) => /^(foot|ball)/.test(n)).map(([, v]) => v[1]));
}
/** In the air the body hangs from the arc by its feet: lower the pelvis until the lowest foot is `floor` above the
 *  origin (the game's collision capsule bottom), so a tucked runner clears exactly what its capsule clears and does not
 *  float above it. */
const sink = (p: Pose, floor = 0.03): Pose => lowerPelvis(p, Math.max(0, lowest(p) - floor));
const mix = (a: Pose, b: Pose, t: number): Pose => ({
  r: new Map([...a.r].map(([n, q]) => [n, qslerp(q, b.r.get(n)!, t)])),
  pelvis: a.pelvis.map((x, i) => x + (b.pelvis[i] - x) * t) as V3,
});

/** Write a clip from key poses at phases 0..1: Catmull-Rom through the keys (quaternions kept on one hemisphere),
 *  sampled at 30 per second over one second. */
function author(name: string, keys: { u: number; pose: Pose }[]) {
  const N = 30, times = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) times[i] = i / N;
  const at = (u: number) => {
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].u < u) i++;
    const s = Math.max(0, Math.min(1, (u - keys[i].u) / (keys[i + 1].u - keys[i].u)));
    return { k: [keys[Math.max(0, i - 1)], keys[i], keys[i + 1], keys[Math.min(keys.length - 1, i + 2)]].map((x) => x.pose), s };
  };
  const cr = (a: number, b: number, c: number, d: number, s: number) =>
    0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s * s + (-a + 3 * b - 3 * c + d) * s * s * s);
  const anim = doc.createAnimation(name);
  const track = (node: Node, path: 'rotation' | 'translation', vals: Float32Array) => {
    const ia = doc.createAccessor().setType('SCALAR').setArray(times.slice()).setBuffer(buffer);
    const oa = doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(vals).setBuffer(buffer);
    const smp = doc.createAnimationSampler().setInput(ia).setOutput(oa).setInterpolation('LINEAR');
    anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(smp));
  };
  for (const j of joints) {
    const n = j.getName(), vals = new Float32Array((N + 1) * 4);
    let prev: Q | null = null;
    for (let i = 0; i <= N; i++) {
      const { k, s } = at(i / N);
      const q = k.map((p) => p.r.get(n)!);
      for (let m = 1; m < 4; m++) if (qdot(q[m], q[m - 1]) < 0) q[m] = q[m].map((x) => -x) as Q;
      let r = qnorm([0, 1, 2, 3].map((c) => cr(q[0][c], q[1][c], q[2][c], q[3][c], s)));
      if (prev && qdot(r, prev) < 0) r = r.map((x) => -x) as Q;
      vals.set(r, i * 4);
      prev = r;
    }
    track(j, 'rotation', vals);
  }
  const pv = new Float32Array((N + 1) * 3);
  for (let i = 0; i <= N; i++) {
    const { k, s } = at(i / N);
    for (let c = 0; c < 3; c++) pv[i * 3 + c] = cr(k[0].pelvis[c], k[1].pelvis[c], k[2].pelvis[c], k[3].pelvis[c], s);
  }
  track(byName.get('pelvis')!, 'translation', pv);
}

// The run clip's foot contacts (seconds into Jog_Fwd_Loop, 0.933 s): each foot leaves the ground and touches down.
const RUN = 'Jog_Fwd_Loop';
const TOE_OFF = { l: 0.175, r: 0.642 }, TOUCH = { l: 0.03, r: 0.497 };
const other = (s: 'l' | 'r') => (s === 'l' ? 'r' : 'l');

/** A running jump off foot T, as in a parkour gap jump: push off the toes of T with the free knee driving and the
 *  opposite arm swinging up; the free knee high and T's heel kicked up behind on the way up; both knees up in a slight
 *  tuck at the top, arms forward for balance; then the free leg reaches ahead for the ground, T trailing, and touches
 *  down at the point of the run's stride where the free foot lands, so the run carries straight on. Joint angles are
 *  in degrees (limbs and trunk from their rest angles, so they read as absolute). */
function runJump(T: 'l' | 'r') {
  const F = other(T);
  const j = (o: Record<string, number | [number, number]>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace('$T', T).replace('$F', F), v]));
  const push = bend(sample(RUN, TOE_OFF[T] - 0.02), j({
    spine_01: 3, thigh_$F: 26, calf_$F: 10, foot_$T: 14, upperarm_$T: 42, lowerarm_$T: 14, upperarm_$F: -18,
  }));
  const drive = bend(sample(RUN, TOE_OFF[T] + 0.05), j({
    spine_01: 14, spine_02: 6, spine_03: 2, neck_01: -8, thigh_$F: 84, calf_$F: 92, foot_$F: 12, thigh_$T: -24, calf_$T: 104,
    foot_$T: 34, upperarm_$T: [96, -84], lowerarm_$T: 58, upperarm_$F: [-28, -84], lowerarm_$F: 62,
  }), true);
  const tuck = bend(sample(RUN, TOE_OFF[T] + 0.1), j({
    spine_01: 20, spine_02: 8, spine_03: 4, neck_01: -14, thigh_$F: 80, calf_$F: 104, foot_$F: 18, thigh_$T: 52, calf_$T: 118,
    foot_$T: 26, upperarm_$T: [68, -80], lowerarm_$T: 72, upperarm_$F: [44, -80], lowerarm_$F: 72,
  }), true);
  const reach = bend(sample(RUN, TOUCH[F] - 0.03), j({
    spine_01: 16, spine_02: 6, spine_03: 2, neck_01: -10, thigh_$F: 52, calf_$F: 16, foot_$F: -6, thigh_$T: 6, calf_$T: 92,
    foot_$T: 20, upperarm_$T: [44, -80], lowerarm_$T: 56, upperarm_$F: [26, -82], lowerarm_$F: 56,
  }), true);
  const touch = bend(sample(RUN, TOUCH[F]), j({ spine_01: 5, upperarm_$T: 10, upperarm_$F: 6 }));
  author(`Run_Jump_${T.toUpperCase()}`, [
    { u: 0, pose: push }, { u: 0.2, pose: sink(drive) }, { u: 0.47, pose: sink(tuck) }, { u: 0.8, pose: sink(reach) }, { u: 1, pose: touch },
  ]);
}
runJump('l');
runJump('r');

/** The standing jump's flight: from the push of Jump_Start through its tuck at the top, then the legs reach down for the
 *  ground as Jump_Land begins, so a landing picks up where the flight ends. */
author('Jump_Air', [
  { u: 0, pose: sample('Jump_Start', 0.1) },
  { u: 0.24, pose: sink(sample('Jump_Start', 0.22)) },
  { u: 0.48, pose: sink(sample('Jump_Start', 0.36)) },
  { u: 0.78, pose: sink(mix(sample('Jump_Loop', 1.0), sample('Jump_Land', 0), 0.5)) },
  { u: 1, pose: sample('Jump_Land', 0.02) },
]);

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
