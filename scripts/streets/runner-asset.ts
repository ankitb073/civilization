// Builds atlas/public/game/streets/runner.glb (the Streets runner, #/streets) from CC0 packs, read as data only
// (provenance, hashes and licences: atlas/public/game/streets/LICENSES.md):
//   - Quaternius Universal Base Characters [Standard]: Superhero_Male_FullBody.gltf + .bin and its base-colour textures
//     (T_Superhero_Male_Dark.png, T_Hair_1_BaseColor.png, T_Eye_Brown.png); the normal and roughness maps are not used.
//   - Quaternius Universal Animation Library 1 and 2 [Standard]: UAL1_Standard.glb, UAL2_Standard.glb (same 65-joint
//     skeleton).
//   - Mesh2Motion's human add-on animations (human-addon-animations.glb): Ledge Hang, Climb Wall, Climb Ladder.
//   - Quaternius Modular Character Outfits – Fantasy [Standard]: the Peasant outfit (Outfits/Male_Peasant.gltf + .bin,
//     T_Peasant_BaseColor.png, T_Regular_Male_Dark_BaseColor.png).
// What it does: copies the clips the runner uses onto the base character's skeleton (rotations as they are; translation
// only on the pelvis, scaled by the ratio of pelvis rest heights; no scale tracks); retargets the three Mesh2Motion
// clips (model-space turns from rest, rest directions lined up); authors the jumps (Run_Jump_L and Run_Jump_R, a running
// jump off either foot, and Jump_Air, the standing jump's flight), a jog (Jog_Loop) and a pull-up (Hang_PullUp) from
// frames of those clips plus joint angles (see "Authored clips"); dresses the runner in the Peasant's shirt and arms,
// drops the body under them, adds a tablet satchel on a strap (modelled here), simplifies the dense meshes; drops unused
// vertex streams, downsamples the base-colour textures (body and shirt 512, the arms' skin 256, brows and eyes 128),
// recolours the dark shorts as a madder-red kilt and the shirt's cream as linen, flattens texels nothing uses; then
// prunes, resamples keyframes, quantizes (KHR_mesh_quantization) and meshopt-compresses (EXT_meshopt_compression,
// decoded in the browser by three's MeshoptDecoder).
//
// Its tools are not atlas dependencies; run it from a scratch folder that has them:
//   mkdir -p /tmp/runner-asset && cp scripts/streets/runner-asset.ts /tmp/runner-asset/ && cd /tmp/runner-asset
//   npm init -y >/dev/null && npm pkg set type=module && npm i @gltf-transform/core@4.5.0 @gltf-transform/functions@4.5.0 \
//     @gltf-transform/extensions@4.5.0 meshoptimizer@0.25.0 pngjs@7.0.0 jpeg-js@0.4.4
//   node runner-asset.ts --ubc=<dir> --ual1=<UAL1_Standard.glb> --ual2=<UAL2_Standard.glb> \
//     --m2m=<human-addon-animations.glb> --mco=<dir with the Peasant outfit files> --out=<runner.glb>

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, meshopt, prune, quantize, resample, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? '';
const UBC = arg('ubc'), UAL1 = arg('ual1'), UAL2 = arg('ual2'), M2M = arg('m2m'), MCO = arg('mco'), OUT = arg('out');
if (!UBC || !UAL1 || !UAL2 || !M2M || !MCO || !OUT) {
  throw new Error('usage: --ubc=<dir> --ual1=<glb> --ual2=<glb> --m2m=<human-addon-animations.glb> --mco=<dir> --out=<glb>');
}

const CLIPS = {
  ual1: ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll'],
  ual2: ['ClimbUp_1m'], // the mantle
  // Mesh2Motion's human add-on clips (same skeleton, slightly different rest), retargeted: name there → name here
  // (and how much of each: Climb Ladder repeats one 1.208 s cycle three times)
  m2m: { 'Ledge Hang': ['Hang_Loop', 1.917, 6], 'Climb Wall': ['Climb_Wall', 2.083, 30], 'Climb Ladder': ['Climb_Ladder', 1.208, 30] } as Record<string, [string, number, number]>,
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
await copyClips(UAL2, CLIPS.ual2);

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
function author(name: string, keys: { u: number; pose: Pose }[], duration = 1, dense = false) {
  const N = dense ? keys.length - 1 : 30, times = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) times[i] = (i / N) * duration;
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
      const { k, s } = dense ? { k: [keys[i].pose, keys[i].pose, keys[i].pose, keys[i].pose], s: 0 } : at(i / N);
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
    const { k, s } = dense ? { k: [keys[i].pose, keys[i].pose, keys[i].pose, keys[i].pose], s: 0 } : at(i / N);
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
/** Retarget clips from another rig with the same joint names (Mesh2Motion's human): each joint takes the source's
 *  model-space turn from its own rest, applied to ours after lining our rest direction up with theirs (so a clavicle
 *  set 20° differently still ends where theirs does), then made local again; the pelvis keeps its translation, scaled
 *  by the ratio of the rigs' pelvis heights. Sampled at 30 per second. */
async function retarget(path: string, names: Record<string, [string, number, number]>) {
  const src = await io.read(path);
  const sj = src.getRoot().listSkins()[0].listJoints().slice().sort((a, b) => depth(a) - depth(b));
  const key = (n: string) => n.toLowerCase();
  const sBy = new Map(sj.map((j) => [key(j.getName()), j]));
  const sParent = new Map(sj.map((j) => [j.getName(), j.getParentNode()?.getName() ?? '']));
  // rest model-space rotations and bone directions (to the first child) of both rigs
  const restWorld = (js: Node[], par: Map<string, string>) => {
    const w = new Map<string, Q>();
    for (const j of js) { const P = w.get(par.get(j.getName())!); w.set(j.getName(), P ? qmul(P, j.getRotation()) : (j.getRotation() as Q)); }
    return w;
  };
  const Rs = restWorld(sj, sParent), Rt = restWorld(joints, parentOf);
  const dirOf = (n: Node) => { const c = n.listChildren()[0]; if (!c) return null; const a = n.getWorldTranslation(), b = c.getWorldTranslation(); const v = b.map((x, i) => x - a[i]); const l = Math.hypot(...v); return l > 1e-5 ? (v.map((x) => x / l) as V3) : null; };
  const arc = (a: V3, b: V3): Q => { // shortest turn taking a to b
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (d > 0.99999) return [0, 0, 0, 1];
    const c: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    return qnorm([c[0], c[1], c[2], 1 + d]);
  };
  const align = new Map<string, Q>();
  for (const j of joints) {
    const s0 = sBy.get(key(j.getName()));
    const dt = dirOf(j), ds = s0 ? dirOf(s0) : null;
    align.set(j.getName(), dt && ds && j.getName() !== 'root' ? arc(dt, ds) : [0, 0, 0, 1]);
  }
  const ratio = restZ(byName.get('pelvis')!) / restZ(sBy.get('pelvis')!);
  for (const a of src.getRoot().listAnimations()) {
    if (!names[a.getName()]) continue;
    const [out, upTo, fps] = names[a.getName()];
    const chans = new Map<string, { s: import('@gltf-transform/core').AnimationSampler; path: string }[]>();
    let end = 0;
    for (const ch of a.listChannels()) {
      const n = ch.getTargetNode()?.getName() ?? '';
      if (!chans.has(n)) chans.set(n, []);
      chans.get(n)!.push({ s: ch.getSampler()!, path: ch.getTargetPath()! });
      const ins = ch.getSampler()!.getInput()!.getArray() as Float32Array;
      end = Math.max(end, ins[ins.length - 1]);
    }
    const sampleS = (n: string, path: string, t: number, rest: number[]) => {
      const c = chans.get(n)?.find((x) => x.path === path);
      if (!c) return rest;
      const ins = c.s.getInput()!.getArray() as Float32Array, outs = c.s.getOutput()!.getArray() as Float32Array;
      const k = path === 'rotation' ? 4 : 3;
      let i = 0;
      while (i < ins.length - 2 && ins[i + 1] <= t) i++;
      const A = Array.from(outs.slice(i * k, i * k + k));
      if (c.s.getInterpolation() === 'STEP' || ins.length < 2) return t >= ins[i + 1] && ins.length > 1 ? Array.from(outs.slice((i + 1) * k, (i + 1) * k + k)) : A;
      const B = Array.from(outs.slice((i + 1) * k, (i + 1) * k + k));
      const f = Math.max(0, Math.min(1, (t - ins[i]) / (ins[i + 1] - ins[i] || 1)));
      return k === 4 ? qslerp(A as Q, B as Q, f) : A.map((x, m) => x + (B[m] - x) * f);
    };
    end = Math.min(end, upTo);
    const N = Math.max(2, Math.round(end * fps));
    const keys: { u: number; pose: Pose }[] = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * end;
      const Gs = new Map<string, Q>();
      for (const j of sj) {
        const n = j.getName(), P = Gs.get(sParent.get(n)!);
        const L = sampleS(n, 'rotation', t, j.getRotation()) as Q;
        Gs.set(n, P ? qmul(P, L) : L);
      }
      const p = restPose(), Gt = new Map<string, Q>();
      for (const j of joints) {
        const n = j.getName(), s0 = sBy.get(key(n));
        let G: Q;
        if (s0) G = qmul(qmul(qmul(Gs.get(s0.getName())!, qconj(Rs.get(s0.getName())!)), align.get(n)!), Rt.get(n)!);
        else { const P0 = Gt.get(parentOf.get(n)!); G = P0 ? qmul(P0, j.getRotation()) : (j.getRotation() as Q); }
        Gt.set(n, G);
        const P = Gt.get(parentOf.get(n)!);
        p.r.set(n, qnorm(P ? qmul(qconj(P), G) : G));
      }
      const pt = sampleS(sBy.get('pelvis')!.getName(), 'translation', t, sBy.get('pelvis')!.getTranslation()) as V3;
      p.pelvis = pt.map((x) => x * ratio) as V3;
      keys.push({ u: i / N, pose: p });
    }
    author(out, keys, end, true);
  }
}
await retarget(M2M, CLIPS.m2m);

/** A jog, between the walk and the run: the run's stride made smaller (the legs' swing about their mean over the
 *  cycle cut to 45%, the arms' and trunk's to 60%, the pelvis's bounce to half, a little less lean) on a quicker cycle
 *  (0.76 s, about 158 steps a minute). Where the run has a
 *  foot planted, the pelvis is set so the jog's lowest foot is on the ground too; between those frames the correction
 *  is interpolated, so the float stays a float. The game measures its ground speed from the clip, as for the others. */
function jog() {
  const D = 0.9333, N = 28, cycle = 0.76;
  const src = Array.from({ length: N + 1 }, (_, i) => sample(RUN, (i / N) * D));
  const mean = new Map<string, Q>();
  for (const j of joints) {
    const n = j.getName(), ref = src[0].r.get(n)!;
    let acc = [0, 0, 0, 0];
    for (const p of src) { let q: number[] = p.r.get(n)!; if (qdot(q, ref) < 0) q = q.map((x) => -x); acc = acc.map((x, i) => x + q[i]); }
    mean.set(n, qnorm(acc));
  }
  const pm = [0, 1, 2].map((c) => src.reduce((a, p) => a + p.pelvis[c], 0) / src.length);
  const frames = src.map((p) => {
    const o = restPose();
    for (const j of joints) { const n = j.getName(); o.r.set(n, qslerp(mean.get(n)!, p.r.get(n)!, /^(thigh|calf|foot|ball)/.test(n) ? 0.45 : 0.6)); }
    o.pelvis = [pm[0] + (p.pelvis[0] - pm[0]) * 0.6, pm[1] + (p.pelvis[1] - pm[1]) * 0.6, pm[2] + (p.pelvis[2] - pm[2]) * 0.5];
    return bend(o, { spine_01: -3 });
  });
  const fix: (number | null)[] = frames.map((f, i) => (lowest(src[i]) <= 0.035 ? lowest(src[i]) - lowest(f) : null));
  for (let i = 0; i < fix.length; i++) {
    if (fix[i] !== null) continue;
    let a = i, b = i;
    while (fix[(a - 1 + fix.length) % fix.length] === null) a--;
    while (fix[(b + 1) % fix.length] === null) b++;
    const fa = fix[(a - 1 + fix.length) % fix.length]!, fb = fix[(b + 1) % fix.length]!;
    fix[i] = fa + (fb - fa) * ((i - a + 1) / (b - a + 2));
  }
  frames.forEach((f, i) => { f.pelvis[2] += fix[i]!; });
  author('Jog_Loop', frames.map((pose, i) => ({ u: i / N, pose })), cycle, true);
}
jog();

/** The pull-up from a hang: the arms draw the chest up to the edge, a knee comes up onto it (Climb Up's tuck, hands
 *  planted), and the runner rises to stand on top. In place; the game carries the body up and over along with it. */
function pullUp() {
  const hang = sample('Hang_Loop', 0);
  const pull = bend(hang, {
    spine_01: 10, spine_02: 4, upperarm_l: -95, upperarm_r: -95, lowerarm_l: 105, lowerarm_r: 105,
    thigh_l: 34, calf_l: 50, thigh_r: 12, calf_r: 26,
  });
  author('Hang_PullUp', [
    { u: 0, pose: hang }, { u: 0.34, pose: pull }, { u: 0.6, pose: sample('ClimbUp_1m', 0.24) },
    { u: 0.8, pose: sample('ClimbUp_1m', 0.42) }, { u: 1, pose: sample('ClimbUp_1m', 0.62) },
  ], 0.8);
}
pullUp();

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
function shrink(file: string, size: number, dir = UBC): { data: Uint8Array; w: number; h: number } {
  const p = PNG.sync.read(readFileSync(join(dir, file)));
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
// ---------------------------------------------------------------------------------------------------------------------
// The costume: Quaternius's Modular Character Outfits – Fantasy [Standard] (CC0), made for this skeleton. The Peasant's
// shirt and arms (sleeves, forearms and hands) go on, with their own skin of our joints (their bind matrices); the
// superhero body under them goes (its torso, arms and hands), so nothing pokes through; its head, legs and feet stay.
async function dress() {
  const j = JSON.parse(readFileSync(join(MCO, 'Male_Peasant.gltf'), 'utf8'));
  for (const im of j.images ?? []) im.uri = PX;
  const od = await io.readJSON({ json: j, resources: { [j.buffers[0].uri]: new Uint8Array(readFileSync(join(MCO, j.buffers[0].uri))) } });
  const copy = (a: import('@gltf-transform/core').Accessor) =>
    doc.createAccessor().setType(a.getType()).setArray(a.getArray()!.slice()).setNormalized(a.getNormalized()).setBuffer(buffer);
  const oskin = od.getRoot().listSkins()[0];
  const skin = doc.createSkin('outfit').setInverseBindMatrices(copy(oskin.getInverseBindMatrices()!));
  for (const oj of oskin.listJoints()) skin.addJoint(byName.get(oj.getName())!);
  const mats = new Map<string, import('@gltf-transform/core').Material>();
  const matFor = (n: string) => {
    if (!mats.has(n)) {
      const tex = doc.createTexture(n).setImage(new Uint8Array(0)).setMimeType('image/jpeg');
      mats.set(n, doc.createMaterial(n).setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(0.85));
    }
    return mats.get(n)!;
  };
  for (const name of ['Male_Peasant_Body', 'Male_Peasant_Arms']) {
    const om = od.getRoot().listMeshes().find((m) => m.getName() === name)!;
    const mesh = doc.createMesh(name);
    for (const prim of om.listPrimitives()) {
      const np = doc.createPrimitive();
      for (const sem of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
        const a = prim.getAttribute(sem);
        if (a) np.setAttribute(sem, copy(a));
      }
      np.setIndices(copy(prim.getIndices()!)).setMaterial(matFor(prim.getMaterial()!.getName()));
      mesh.addPrimitive(np);
    }
    byName.get('Armature')!.addChild(doc.createNode(name).setMesh(mesh).setSkin(skin));
  }
  // the superhero body under the shirt and sleeves: drop every triangle all of whose corners hang mostly on a joint
  // the costume covers
  const covered = /^(spine_0[123]|clavicle_|upperarm_|lowerarm_|hand_|index_|middle_|ring_|pinky_|thumb_)/;
  const heroNode = byName.get('SuperHero_Male')!, hero = heroNode.getMesh()!, heroSkin = heroNode.getSkin()!;
  const hj = heroSkin.listJoints().map((x) => x.getName());
  for (const prim of hero.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!, I = prim.getIndices()!;
    const dom = (v: number) => { const jj = J.getElement(v, []), ww = W.getElement(v, []); let b = 0; for (let k = 1; k < 4; k++) if (ww[k] > ww[b]) b = k; return hj[jj[b]]; };
    const idx = Array.from(I.getArray()!);
    const keepTri: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const tri = idx.slice(t, t + 3);
      if (tri.every((v) => covered.test(dom(v)))) continue;
      keepTri.push(...tri);
    }
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keepTri)).setBuffer(buffer));
    compactPrimitive(prim);
  }
  satchel(od.getRoot().listMeshes().find((m) => m.getName() === 'Male_Peasant_Body')!, heroSkin);
}

/** The tablet satchel (ours): a leather bag at the left hip with two clay tablets standing out of it, on a strap that
 *  runs up across the chest, over the right shoulder and down the back, laid just outside the shirt (its cross-section
 *  read from the shirt's own vertices). Skinned to the base skeleton: the bag to the pelvis and a little to the left
 *  thigh (it swings with the stride), the strap to the spine by height. */
function satchel(shirt: import('@gltf-transform/core').Mesh, skin: import('@gltf-transform/core').Skin) {
  const sj = skin.listJoints().map((x) => x.getName());
  const J = (n: string) => sj.indexOf(n);
  // the shirt's outline: radius from the body's axis, by height and angle
  const sp = shirt.listPrimitives()[0].getAttribute('POSITION')!;
  const pts: V3[] = [];
  for (let i = 0; i < sp.getCount(); i++) pts.push(sp.getElement(i, []) as V3);
  const radius = (y: number, th: number) => {
    let r = 0.1;
    for (const p of pts) {
      if (Math.abs(p[1] - y) > 0.035) continue;
      const a = Math.atan2(p[0], p[2]), d = Math.abs(Math.atan2(Math.sin(a - th), Math.cos(a - th)));
      if (d < 0.3) r = Math.max(r, Math.hypot(p[0], p[2]));
    }
    return r;
  };
  type Part = { pos: number[]; nrm: number[]; jw: number[][]; idx: number[]; color: number[] };
  const parts: Part[] = [];
  const spineW = (y: number): number[][] => {
    // [joint, weight] pairs blended across the spine by height
    const bands: [string, number][] = [['pelvis', 0.98], ['spine_01', 1.1], ['spine_02', 1.24], ['spine_03', 1.38]];
    for (let i = 0; i < bands.length - 1; i++) {
      const [a, ya] = bands[i], [b, yb] = bands[i + 1];
      if (y <= yb) { const t = Math.max(0, Math.min(1, (y - ya) / (yb - ya))); return [[J(a), 1 - t], [J(b), t]]; }
    }
    return [[J('spine_03'), 1]];
  };
  const box = (c: V3, h: V3, q: Q, color: number[], w: number[][]) => {
    const P: Part = { pos: [], nrm: [], jw: [], idx: [], color };
    const faces: [V3, V3, V3][] = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
    for (const [n, u, v] of faces) {
      const base = P.pos.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const l: V3 = [0, 1, 2].map((k) => n[k] * h[k] + u[k] * su * h[k] + v[k] * sv * h[k]) as V3;
        const wv = rot(q, l);
        P.pos.push(c[0] + wv[0], c[1] + wv[1], c[2] + wv[2]);
        P.nrm.push(...rot(q, n));
        P.jw.push(...[w]);
      }
      P.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    parts.push(P);
  };
  // linear colours: tanned leather, its dark strap and flap, unfired clay
  const LEATHER = [0.16, 0.065, 0.024], DARK = [0.065, 0.026, 0.01], CLAY = [0.5, 0.34, 0.19];
  const bagW = [[J('pelvis'), 0.72], [J('thigh_l'), 0.28]];
  const tilt = qaxis([0, 0, 1], 6);
  box([0.2, 0.86, 0.02], [0.04, 0.105, 0.125], tilt, LEATHER, bagW); // the bag
  box([0.245, 0.915, 0.02], [0.007, 0.055, 0.13], tilt, DARK, bagW); // its flap
  box([0.2, 0.99, -0.03], [0.022, 0.05, 0.06], qmul(tilt, qaxis([1, 0, 0], 8)), CLAY, bagW); // tablets standing out
  box([0.195, 0.985, 0.06], [0.02, 0.045, 0.055], qmul(tilt, qaxis([1, 0, 0], -6)), CLAY, bagW);
  // the strap: a band around the body, high over the right shoulder (θ = -90°), low at the left hip (θ = +90°)
  const S: Part = { pos: [], nrm: [], jw: [], idx: [], color: DARK };
  const N = 40;
  const at = (i: number): V3 => {
    const th = (i / N) * Math.PI * 2 - Math.PI;
    const side = -Math.sin(th); // 1 at the right shoulder, -1 at the left hip
    const y = 1.2 + 0.25 * side + 0.06 * Math.max(0, side) ** 6;
    const shoulder = Math.max(0, side) ** 4;
    const r = radius(Math.min(1.42, y), th) * (1 - 0.45 * shoulder) + 0.014;
    return [Math.sin(th) * r, y, Math.cos(th) * r];
  };
  for (let i = 0; i <= N; i++) {
    const p = at(i), a = at(i - 1), b = at(i + 1);
    const t: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const n: V3 = [p[0], 0, p[2]];
    const nl = Math.hypot(n[0], n[2]) || 1;
    n[0] /= nl; n[2] /= nl;
    const wd: V3 = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
    const wl = Math.hypot(...wd) || 1;
    for (const sg of [-1, 1]) {
      S.pos.push(p[0] + (wd[0] / wl) * 0.022 * sg, p[1] + (wd[1] / wl) * 0.022 * sg, p[2] + (wd[2] / wl) * 0.022 * sg);
      S.nrm.push(...n);
      const w = spineW(p[1]);
      const shoulder = Math.max(0, -Math.sin((i / N) * Math.PI * 2 - Math.PI)) ** 6;
      S.jw.push(shoulder > 0.05 ? [...w.map(([j, x]) => [j, x * (1 - shoulder * 0.5)]), [J('clavicle_r'), shoulder * 0.5]].flat() : w.flat());
    }
    if (i < N) { const o = i * 2; S.idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3, o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  parts.push(S);
  // one primitive (one draw call), its parts told apart by vertex colour
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [], jw: number[][][] = [];
  for (const P of parts) {
    const base = pos.length / 3;
    pos.push(...P.pos); nrm.push(...P.nrm);
    for (let i = 0; i < P.pos.length / 3; i++) { col.push(...P.color); jw.push(P.jw[i]); }
    idx.push(...P.idx.map((i) => i + base));
  }
  const n = pos.length / 3;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const pairs: number[][] = [];
    const flat = jw[i].flat();
    for (let k = 0; k < flat.length; k += 2) pairs.push([flat[k], flat[k + 1]]);
    pairs.sort((x, y) => y[1] - x[1]);
    const sum = pairs.slice(0, 4).reduce((s2, x) => s2 + x[1], 0) || 1;
    pairs.slice(0, 4).forEach(([j2, w2], k) => { joints[i * 4 + k] = j2; weights[i * 4 + k] = w2 / sum; });
  }
  const acc = (type: 'VEC3' | 'VEC4' | 'SCALAR', a: Float32Array | Uint16Array | Uint32Array) => doc.createAccessor().setType(type).setArray(a).setBuffer(buffer);
  const mat = doc.createMaterial('MI_Satchel').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.9).setDoubleSided(true);
  const mesh = doc.createMesh('Satchel').addPrimitive(doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(pos))).setAttribute('NORMAL', acc('VEC3', new Float32Array(nrm)))
    .setAttribute('COLOR_0', acc('VEC3', new Float32Array(col)))
    .setAttribute('JOINTS_0', acc('VEC4', joints)).setAttribute('WEIGHTS_0', acc('VEC4', weights)).setIndices(acc('SCALAR', new Uint32Array(idx))).setMaterial(mat));
  byName.get('Armature')!.addChild(doc.createNode('Satchel').setMesh(mesh).setSkin(skin));
}
await dress();

/** Texels no shipped triangle uses (the atlas is shared with outfits and body parts we leave out) are filled with the
 *  mean of the used ones, so the JPEG spends nothing on them. */
function flatten(mat: import('@gltf-transform/core').Material, img: { data: Uint8Array; w: number; h: number }) {
  const used = new Uint8Array(img.w * img.h);
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    if (p.getMaterial() !== mat) continue;
    const uv = p.getAttribute('TEXCOORD_0'), I = p.getIndices()?.getArray();
    if (!uv || !I) continue;
    for (let t = 0; t < I.length; t += 3) {
      const P = [0, 1, 2].map((q) => { const e = uv.getElement(I[t + q], []); return [e[0] * img.w, e[1] * img.h]; });
      const area = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const A = area(P[0], P[1], P[2]) || 1e-9;
      const x0 = Math.max(0, Math.floor(Math.min(...P.map((q) => q[0])) - 3)), x1 = Math.min(img.w - 1, Math.ceil(Math.max(...P.map((q) => q[0])) + 3));
      const y0 = Math.max(0, Math.floor(Math.min(...P.map((q) => q[1])) - 3)), y1 = Math.min(img.h - 1, Math.ceil(Math.max(...P.map((q) => q[1])) + 3));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const c = [x + 0.5, y + 0.5];
        const pad = 3 * Math.max(...[0, 1, 2].map((q) => Math.hypot(P[(q + 1) % 3][0] - P[q][0], P[(q + 1) % 3][1] - P[q][1]))) / Math.abs(A);
        const w0 = area(P[1], P[2], c) / A, w1 = area(P[2], P[0], c) / A, w2 = area(P[0], P[1], c) / A;
        if (w0 >= -pad && w1 >= -pad && w2 >= -pad) used[y * img.w + x] = 1;
      }
    }
  }
  const mean = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < used.length; i++) if (used[i]) { for (let c = 0; c < 3; c++) mean[c] += img.data[i * 4 + c]; n++; }
  for (let c = 0; c < 3; c++) mean[c] /= Math.max(1, n);
  for (let i = 0; i < used.length; i++) if (!used[i]) for (let c = 0; c < 3; c++) img.data[i * 4 + c] = mean[c];
}
/** The shirt's undyed cream, lighter and warmer: linen. Leather and metal (darker or greyer) are left. */
function linen(d: Uint8Array) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    if (lum > 95 && r >= b + 12) {
      d[i] = Math.min(255, r * 1.16 + 6); d[i + 1] = Math.min(255, g * 1.13 + 2); d[i + 2] = Math.min(255, b * 1.02);
    }
  }
}
for (const mat of root.listMaterials()) {
  mat.setNormalTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0);
  if (mat.getName() === 'MI_Peasant' || mat.getName() === 'MI_Regular_Male') {
    const peasant = mat.getName() === 'MI_Peasant';
    const img = shrink(peasant ? 'T_Peasant_BaseColor.png' : 'T_Regular_Male_Dark_BaseColor.png', peasant ? 512 : 256, MCO);
    if (peasant) linen(img.data);
    flatten(mat, img);
    mat.getBaseColorTexture()!.setImage(new Uint8Array(jpeg.encode({ data: img.data, width: img.w, height: img.h }, 86).data))
      .setMimeType('image/jpeg').setURI(`runner_${mat.getName().toLowerCase()}.jpg`);
    continue;
  }
  const spec = TEX[mat.getName()];
  const tex = mat.getBaseColorTexture();
  if (!spec || !tex) continue;
  const img = shrink(spec.file, spec.size);
  if (mat.getName() === 'MI_Superhero_Male') { loincloth(img.data); mat.setRoughnessFactor(0.78).setDoubleSided(false); flatten(mat, img); }
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

// fewer triangles where nobody will miss them at game distance: the costume's hands and sleeves, the shirt, the body's
// head and legs (meshoptimizer's simplifier, borders and seams kept)
await MeshoptSimplifier.ready;
await doc.transform(weld());
for (const [mesh, ratio] of [['Male_Peasant_Arms', 0.5], ['Male_Peasant_Body', 0.7], ['SuperHero_Male', 0.7]] as const) {
  const m = root.listNodes().find((n) => n.getName() === mesh)!.getMesh()!;
  for (const prim of m.listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.004, lockBorder: true });
}
await doc.transform(
  prune(), dedup(), resample({ tolerance: 1e-4 }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }),
  prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write(OUT, doc);
console.log(`${OUT}: clips ${root.listAnimations().map((a) => a.getName()).join(', ')}; ${readFileSync(OUT).length} bytes`);
