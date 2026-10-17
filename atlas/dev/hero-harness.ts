// Dev harness for the realistic hero (atlas/dev/hero.html, Vite dev server only). Loads hero.glb (or hero_lod1.glb)
// the way runner.ts loads runner.glb (GLTFLoader + MeshoptDecoder; WebP textures need nothing more), lights it with
// the build's sun-less late-afternoon sky (an equirect .hdr through PMREM) and one warm shadowing sun, and exposes
// window.__hero for scripts/streets/hero/shoot.ts: pose any clip at any time from any of the shot cameras, compare
// every joint against runner.glb's on the same clips, and time the frames.
//   /dev/hero.html?glb=/game/streets/hero/hero.glb&env=<url of env_1k.hdr>&sss=1&cornea=additive|glass&tm=agx|none
// Two optional runtime touches the game can copy (both on by default here; notes in the hero's LICENSES.md):
//   - skinShader(): the skin's "subsurface hints" — a wrapped, reddened terminator and light through thin parts (ears,
//     nostrils, fingers), using the thickness the skin's ORM map carries in its blue channel — and, for close-ups, a
//     tiling pore normal (hero_skin_detail.webp beside the GLB) blended over the skin's own normal map.
//   - corneaAdditive(): draws the cornea as an additive gloss layer instead of three's transmission pass.

import {
  ACESFilmicToneMapping, AdditiveBlending, AgXToneMapping, AnimationMixer, Box3, Color, DirectionalLight, Euler,
  Group, type Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, NoToneMapping, type Object3D,
  PCFShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShaderChunk, SRGBColorSpace, Vector3, WebGLRenderer,
  EquirectangularReflectionMapping, NoColorSpace, RepeatWrapping, TextureLoader,
  type AnimationClip, type SkinnedMesh, type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const q = new URLSearchParams(location.search);
const GLB = q.get('glb') ?? '/game/streets/hero/hero.glb';
const RUNNER = q.get('runner') ?? '/game/streets/runner.glb';
// the build's sky (scripts/streets/hero/hdri.py), when it has been built; ?env= overrides
const builtEnv = Object.values(import.meta.glob('../../build/hero/work/env_1k.hdr', { query: '?url', import: 'default', eager: true }))[0] as string | undefined;
const ENV = q.get('env') ?? builtEnv ?? '';
const SSS = q.get('sss') !== '0';
const CORNEA = q.get('cornea') ?? 'additive';
const TM = q.get('tm') ?? 'agx';
// the key light, as in the Blender renders (hero_common.py KEY_*): from his right and a little ahead, 20° up, warm
const KEY_AZ = Number(q.get('az') ?? -62), KEY_EL = Number(q.get('el') ?? 20);
const ENV_SUN = { x: -0.7425626955494119, y: 0.6668210402720414, z: 0.0628517575641614 }; // hdri.py, Blender axes

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = TM === 'none' ? NoToneMapping : TM === 'aces' ? ACESFilmicToneMapping : AgXToneMapping;
renderer.toneMappingExposure = Number(q.get('exposure') ?? 1.0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#b9b3aa');
const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.02, 200);
const rad = (d: number) => (d * Math.PI) / 180;
const keyDir = new Vector3(Math.sin(rad(KEY_AZ)) * Math.cos(rad(KEY_EL)), Math.sin(rad(KEY_EL)), Math.cos(rad(KEY_AZ)) * Math.cos(rad(KEY_EL)));
const sun = new DirectionalLight(new Color(1.0, 0.74, 0.5), Number(q.get('sun') ?? 4.2));
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -1.6; sun.shadow.camera.right = 1.6; sun.shadow.camera.top = 2.2; sun.shadow.camera.bottom = -0.6;
sun.shadow.camera.near = 0.1; sun.shadow.camera.far = 12;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.012;
scene.add(sun, sun.target);
const ground = new Mesh(new PlaneGeometry(60, 60), new MeshStandardMaterial({ color: new Color(0.30, 0.235, 0.17), roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/** The skin's subsurface hints, patched into three's physical shading: a wrapped, reddened terminator for the
 *  direct light, and light coming through where the skin is thin (thickness: the ORM map's blue channel). */
export function skinShader(mat: MeshPhysicalMaterial | MeshStandardMaterial, detail?: Texture | null, detailRepeat = 32, detailStrength = 0.35) {
  const nrm = ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;',
    'mapN.xy *= normalScale;\n\t#ifdef HERO_DETAIL\n\t\tvec3 heroD = texture2D( heroDetail, vNormalMapUv * heroDetailRepeat ).xyz * 2.0 - 1.0;\n\t\tmapN = normalize( vec3( mapN.xy + heroD.xy * heroDetailStrength, mapN.z ) );\n\t#endif');
  const lit = ShaderChunk.lights_physical_pars_fragment.replace(
    /reflectedLight\.directDiffuse \+= irradiance \* BRDF_Lambert\( material\.(diffuseContribution|diffuseColor) \);/,
    (_m, field) => `{
      float nl = dot( geometryNormal, directLight.direction );
      float wrapped = saturate( ( nl + 0.5 ) / 1.5 ) - saturate( nl );
      float through = pow( saturate( dot( geometryViewDir, - normalize( directLight.direction + geometryNormal * 0.3 ) ) ), 3.0 ) * heroThick;
      reflectedLight.directDiffuse += ( irradiance + ( wrapped * 0.6 + through * 1.8 ) * heroScatter * directLight.color ) * BRDF_Lambert( material.${field} );
    }`);
  if (lit === ShaderChunk.lights_physical_pars_fragment) console.warn('skinShader: three changed its lighting chunk; skin left as is');
  mat.onBeforeCompile = (sh) => {
    if (detail) {
      sh.uniforms.heroDetail = { value: detail };
      sh.uniforms.heroDetailRepeat = { value: detailRepeat };
      sh.uniforms.heroDetailStrength = { value: detailStrength };
      sh.fragmentShader = '#define HERO_DETAIL\nuniform sampler2D heroDetail;\nuniform float heroDetailRepeat;\nuniform float heroDetailStrength;\n' + sh.fragmentShader;
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_maps>', nrm)
      .replace('#include <lights_physical_pars_fragment>', `float heroThick = 0.0;\nconst vec3 heroScatter = vec3( 1.0, 0.30, 0.16 );\n${lit}`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n#ifdef USE_METALNESSMAP\n\theroThick = texelMetalness.b;\n#endif');
  };
  mat.customProgramCacheKey = () => (detail ? 'hero-skin-detail' : 'hero-skin');
  mat.needsUpdate = true;
}

/** The cornea as an additive gloss (reflections of the sky and the sun's highlight over the iris), not glass. */
export function corneaAdditive(mat: MeshPhysicalMaterial) {
  mat.transmission = 0;
  mat.color.setRGB(0, 0, 0);
  mat.transparent = true;
  mat.blending = AdditiveBlending;
  mat.depthWrite = false;
  mat.needsUpdate = true;
}

interface Loaded { root: Object3D; clips: AnimationClip[]; mixer: AnimationMixer }
async function load(url: string): Promise<Loaded> {
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  return { root: g.scene, clips: g.animations, mixer: new AnimationMixer(g.scene) };
}

const errors: string[] = [];
addEventListener('error', (e) => errors.push(String(e.message)));
const stats = { loadMs: 0, triangles: 0, drawCalls: 0, materials: [] as string[], textures: 0 };

const DETAIL = q.get('detail') ?? GLB.replace(/[^/]*$/, 'hero_skin_detail.webp');
const t0 = performance.now();
const detailTex = q.get('detail') === '' ? null : await new TextureLoader().loadAsync(DETAIL).then((t) => {
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = NoColorSpace;
  t.anisotropy = 8;
  return t;
}).catch(() => { errors.push(`detail: ${DETAIL}`); return null; });
const [hero, runner, env] = await Promise.all([
  load(GLB), load(RUNNER).catch(() => null),
  ENV ? new HDRLoader().loadAsync(ENV).catch((e) => { errors.push(`env: ${e}`); return null; }) : Promise.resolve(null),
]);
stats.loadMs = performance.now() - t0;
if (env) {
  const pm = new PMREMGenerator(renderer);
  const rt = pm.fromEquirectangular(env as Texture);
  scene.environment = rt.texture;
  scene.background = env as Texture;
  (env as Texture).mapping = EquirectangularReflectionMapping;
  // turn the sky so the side its sun was on is the side the key comes from (Blender axes → three: x, z, -y)
  const s = new Vector3(ENV_SUN.x, ENV_SUN.z, -ENV_SUN.y);
  const psiS = Math.atan2(s.x, s.z);
  const psiK = rad(KEY_AZ);
  const rot = new Euler(0, psiS - psiK, 0);
  scene.environmentRotation.copy(rot);
  scene.backgroundRotation.copy(rot);
  scene.environmentIntensity = Number(q.get('envi') ?? 0.6);
  scene.backgroundIntensity = 1.0;
}

const body = new Group();
body.add(hero.root);
scene.add(body);
const mats = new Set<Material>();
hero.root.traverse((o) => {
  const m = o as Mesh;
  if (!m.isMesh) return;
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  stats.triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
    mats.add(mat);
    if (mat.name === 'skin' && SSS) skinShader(mat as MeshPhysicalMaterial, detailTex);
    if (mat.name === 'cornea') {
      m.castShadow = false;
      if (CORNEA === 'additive') corneaAdditive(mat as MeshPhysicalMaterial);
    }
    if (mat.name === 'brows' || mat.name === 'lashes' || mat.name === 'hair') m.castShadow = mat.name === 'hair';
  }
});
stats.materials = [...mats].map((m) => `${m.name}:${m.type}`);
stats.textures = new Set([...mats].flatMap((m) => Object.values(m).filter((v) => (v as Texture)?.isTexture))).size;

const actions = new Map(hero.clips.map((c) => [c.name, hero.mixer.clipAction(c)]));
const raction = runner ? new Map(runner.clips.map((c) => [c.name, runner.mixer.clipAction(c)])) : null;

function pose(clip: string | null, t: number) {
  hero.mixer.stopAllAction();
  if (clip) {
    const a = actions.get(clip);
    if (!a) throw new Error(`no clip ${clip}`);
    a.reset().play();
    a.time = t;
    a.paused = true;
  }
  hero.mixer.update(0);
  hero.root.updateMatrixWorld(true);
}

const tmp = new Vector3();
function joint(root: Object3D, name: string) { return root.getObjectByName(name)!.getWorldPosition(tmp).clone(); }
/** Blender's camera conventions (render.py): positions relative to the hips (or head), Blender axes (x, y, z) → three
 *  (x, z, -y); `lens` in mm on a 36 mm sensor across the image's longer side. */
function view(kind: string, lens: number, off: [number, number, number], target: 'hips' | 'head' | 'chest' | 'hand', toff: [number, number, number] = [0, 0, 0]) {
  const at = target === 'head' ? joint(hero.root, 'Head') : target === 'chest' ? joint(hero.root, 'spine_03') : target === 'hand' ? joint(hero.root, 'hand_l').add(joint(hero.root, 'middle_01_l')).multiplyScalar(0.5) : joint(hero.root, 'pelvis');
  const B = (v: [number, number, number]) => new Vector3(v[0], v[2], -v[1]);
  camera.position.copy(at).add(B(off));
  camera.lookAt(at.clone().add(B(toff)));
  const aspect = innerWidth / innerHeight;
  const half = 18 / lens;
  camera.fov = (2 * Math.atan(aspect >= 1 ? half / aspect : half) * 180) / Math.PI;
  camera.aspect = aspect;
  camera.near = kind === 'close' || kind === 'portrait' || kind === 'hands' ? 0.02 : 0.05;
  camera.updateProjectionMatrix();
}
const VIEWS: Record<string, () => void> = {
  game: () => view('game', 32, [0.9, 3.0, 1.15], 'chest', [0, 0, 0.1]),
  three: () => view('three', 40, [-1.5, -2.1, 0.55], 'hips', [0, 0, 0.12]),
  side: () => view('side', 45, [-3.0, 0, 0.35], 'hips', [0, 0, 0.1]),
  back: () => view('back', 40, [1.2, 2.6, 0.9], 'hips', [0, 0, 0.45]),
  close: () => view('close', 85, [-0.28, -0.72, 0.02], 'head', [0, 0, 0.06]),
  portrait: () => view('portrait', 100, [0.1, -0.85, 0.05], 'head', [0, 0, 0.07]),
  shoulders: () => view('shoulders', 55, [-0.9, -1.25, 0.25], 'chest', [0, 0, 0.12]),
  hands: () => view('hands', 60, [0.25, -0.55, 0.18], 'hand'),
  shoulders_back: () => view('shoulders_back', 50, [0.45, 1.05, 0.2], 'chest', [0, 0, 0.05]),
  hips_side: () => view('hips_side', 50, [-1.25, -0.25, 0.0], 'hips', [0, 0, -0.08]),
  knees: () => view('knees', 50, [-0.65, -1.0, -0.3], 'hips', [0, 0, -0.42]),
};

function render() {
  // the sun's shadow frustum follows the runner
  const hips = joint(hero.root, 'pelvis');
  sun.target.position.copy(hips);
  sun.position.copy(hips).addScaledVector(keyDir, 6);
  renderer.render(scene, camera);
  stats.drawCalls = renderer.info.render.calls;
}

/** Every clip at n evenly spaced times: the largest distance between any joint of the hero and the same joint of
 *  runner.glb (the clips and skeleton must have come across unchanged), and whether every skinned vertex bound stays
 *  finite and near the body. */
function compare(n = 12) {
  const out: Record<string, { maxJointDiff: number; finite: boolean; height: [number, number]; runnerLowest: number }> = {};
  if (!runner || !raction) return out;
  const names: string[] = [];
  runner.root.traverse((o) => { if ((o as { isBone?: boolean }).isBone) names.push(o.name); });
  for (const [name, a] of actions) {
    const ra = raction.get(name);
    let worst = 0, finite = true, lo = Infinity, hi = -Infinity, rlo = Infinity;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * a.getClip().duration;
      pose(name, t);
      runner.mixer.stopAllAction();
      if (ra) { ra.reset().play(); ra.time = t; ra.paused = true; }
      runner.mixer.update(0);
      runner.root.updateMatrixWorld(true);
      for (const j of names) {
        const h = joint(hero.root, j), r = joint(runner.root, j);
        worst = Math.max(worst, h.distanceTo(r));
      }
      const box = new Box3();
      hero.root.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) box.expandByObject(o, true); });
      if (![box.min.x, box.min.y, box.max.y].every(Number.isFinite)) finite = false;
      lo = Math.min(lo, box.min.y); hi = Math.max(hi, box.max.y);
      const rbox = new Box3();
      runner.root.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) rbox.expandByObject(o, true); });
      rlo = Math.min(rlo, rbox.min.y);
    }
    out[name] = { maxJointDiff: worst, finite, height: [lo, hi], runnerLowest: rlo };
  }
  return out;
}

/** Average and 95th-percentile frame time playing a clip for `ms` milliseconds (on this machine's GPU). */
async function frameTimes(clip = 'Jog_Fwd_Loop', ms = 3000) {
  const a = actions.get(clip)!;
  hero.mixer.stopAllAction();
  a.reset().play();
  VIEWS.game();
  const times: number[] = [];
  let last = performance.now();
  const end = last + ms;
  await new Promise<void>((done) => {
    const step = () => {
      const now = performance.now();
      hero.mixer.update((now - last) / 1000);
      render();
      times.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  times.sort((x, y) => x - y);
  return { frames: times.length, median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)] };
}

/** The game's own loader and Runner (atlas/src/game/streets/runner.ts, imported read-only) on runner.glb and on the
 *  hero: the hero must load, find every clip and measure the same gaits. */
async function gameCheck() {
  const out: Record<string, unknown> = {};
  try {
    const { loadRunner } = await import('../src/game/streets/runner.ts');
    for (const [k, url] of [['runner', RUNNER], ['hero', GLB]] as const) {
      try {
        const r = await loadRunner(url);
        r.update(1 / 60, { speed: 0, grounded: true, vy: 0, air: 0, turn: 0, arc: { vy0: 0, gUp: 9.8, gDown: 9.8, clear: 0, below: 0 } });
        out[k] = { gaits: r.gaits, height: r.height, pelvisHeight: r.pelvisHeight() };
      } catch (e) { out[k] = { error: String(e) }; }
    }
  } catch (e) { out.error = `runner.ts did not load: ${e}`; }
  return out;
}

const clips = hero.clips.map((c) => ({ name: c.name, duration: c.duration }));
(window as unknown as { __hero: unknown }).__hero = {
  ready: true, clips, stats, errors,
  shot(clip: string | null, t: number, v: string) { pose(clip, t); VIEWS[v](); render(); return renderer.info.render.calls; },
  compare, frameTimes, gameCheck,
  resize(w: number, h: number) { renderer.setSize(w, h); },
};

// by hand: a clip picker that plays
const bar = document.getElementById('bar')!;
if (q.get('play') === '0') bar.style.display = 'none';
const sel = document.createElement('select');
for (const c of clips) sel.append(new Option(c.name, c.name));
const vsel = document.createElement('select');
for (const v of Object.keys(VIEWS)) vsel.append(new Option(v, v));
vsel.value = 'three';
bar.append(sel, vsel);
let playing = q.get('play') !== '0';
if (playing) {
  let last = performance.now();
  const loop = () => {
    if (!playing) return;
    const now = performance.now();
    const a = actions.get(sel.value)!;
    if (!a.isRunning()) { hero.mixer.stopAllAction(); a.reset().play(); }
    hero.mixer.update((now - last) / 1000);
    last = now;
    hero.root.updateMatrixWorld(true);
    VIEWS[vsel.value]();
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  addEventListener('keydown', (e) => { if (e.key === ' ') playing = !playing; });
}
