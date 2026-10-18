// Look: "grounded realism" for the streets (docs/streets/lookdev.md, decision 0033). Takes the built streets
// (world.ts buildStreets) and a WebGPURenderer and applies the look at runtime: PBR materials from CC0 scans,
// image-based lighting and a photographed late-afternoon sky, cascaded or follow shadows, a water shader, and the post
// stack (post.ts). The look owns the light: the sun's direction, colour and shadows, the sky, the fog, the exposure
// and the grade. `dispose()` puts the scene back as it was (the classic look's materials, sky, hemisphere and fog).
//
// Loading (decision 0033): `createRealism` needs only the manifest, the small IBL and a 2 KB sky; every material
// samples placeholder arrays, so the first frame waits for no texture. `stream()` then fetches the tier's texture
// sets and its sky and swaps them in, with no shader rebuilt.
//
// glTF assets (the modular building kit, the hero) drop in as they are: their MeshStandardMaterials take the same
// image-based light, shadows, GTAO, contact shadows, fog, anti-aliasing and grade, because all of those are
// applied by the lights and the post stack, not by the materials. `adopt(object)` sets their shadows.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { type BufferGeometry, Color, type DirectionalLight, HemisphereLight, type InstancedMesh, type Material, type Mesh, type Object3D, type PerspectiveCamera, type Scene, type Texture, Vector3 } from 'three';
import { PCFSoftShadowMap, PMREMGenerator, type WebGPURenderer, AgXToneMapping, ACESFilmicToneMapping, NeutralToneMapping } from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import type { StreetsCity } from '../world.ts';
import { LOT } from '../world.ts';
import type { TierName } from './tiers.ts';
import { loadBackdrop, loadIbl, loadManifest, loadMaterialSet, meansOf, placeholderArrays, streamBytes, type Backdrop, type MaterialSet, type SetName } from './textures.ts';
import { foliageMaterial, groundMaterial, landMaterial, lookUniforms, makeSlots, masonryMaterial, propsMaterial, type GroundRect, type LookQuality, type Slots } from './materials.ts';
import { cityKind, openingsOf, S, tagCity, type Footprint } from './surfaces.ts';
import { dressing } from './dressing.ts';
import { makeSky, type SkySetup } from './sky.ts';
import { waterMaterial, type WaterLook } from './water.ts';
import { makePost, type Post, type PostTier } from './post.ts';

export const SKY = 'qwantani_late_afternoon_puresky';

export interface LookTier {
  name: TierName;
  /** What streams in after the first frame: the full set, and the hero set's 2K albedo (desktop). */
  sets: { full: Extract<SetName, 'full-1k' | 'full-512'>; heroAlbedo: boolean };
  /** The IBL: 512×256 on computers, 256×128 on phones. */
  ibl: 'large' | 'small';
  quality: LookQuality;
  post: PostTier;
  shadow: { csm: boolean; size: number; cascades: number; maxFar: number; radius: number };
  sky: '4k' | '2k';
  /** Planar reflection on the river: resolution scale (0: reflect the sky only). */
  mirror: number;
  dprCap: number;
  anisotropy: number;
  /** Reed density along the banks (0..1; 0: none). */
  reeds: number;
  toneMapping: 'agx' | 'aces';
  /** Frame rate the game holds (the phone tier locks 30). */
  fps: 30 | 60;
  /** Hero model: the 40k-triangle LOD0 on computers, the 11k LOD1 on phones. */
  hero: 'lod0' | 'lod1';
}

export const TIERS: Record<TierName, LookTier> = {
  desktop: {
    name: 'desktop',
    sets: { full: 'full-1k', heroAlbedo: true },
    ibl: 'large',
    quality: { parallax: 14, detail: true, detailFar: 90 },
    post: { ao: 0.5, contactShadows: true, aa: 'traa', dof: true, motionBlur: true, bloom: true, shafts: true },
    shadow: { csm: true, size: 2048, cascades: 3, maxFar: 220, radius: 0 },
    sky: '4k', mirror: 0, dprCap: 1.5, anisotropy: 8, toneMapping: 'agx', reeds: 0.75, fps: 60, hero: 'lod0',
  },
  'desktop-medium': {
    name: 'desktop-medium',
    sets: { full: 'full-1k', heroAlbedo: false },
    ibl: 'large',
    quality: { parallax: 8, detail: true, detailFar: 70 },
    post: { ao: 0.5, contactShadows: false, aa: 'taau', scale: 0.8, dof: false, motionBlur: false, bloom: true, shafts: false },
    shadow: { csm: true, size: 2048, cascades: 2, maxFar: 140, radius: 0 },
    sky: '4k', mirror: 0, dprCap: 1.25, anisotropy: 4, toneMapping: 'agx', reeds: 0.5, fps: 60, hero: 'lod0',
  },
  phone: {
    name: 'phone',
    sets: { full: 'full-512', heroAlbedo: false },
    ibl: 'small',
    quality: { parallax: 0, detail: true, detailFar: 45 },
    post: { ao: 0.5, prepass: false, contactShadows: false, aa: 'taau', scale: 0.85, dof: false, motionBlur: false, bloom: false, shafts: false },
    shadow: { csm: false, size: 2048, cascades: 1, maxFar: 0, radius: 34 },
    sky: '2k', mirror: 0, dprCap: 1.5, anisotropy: 4, toneMapping: 'agx', reeds: 0.3, fps: 30, hero: 'lod0',
  },
  'phone-low': {
    name: 'phone-low',
    sets: { full: 'full-512', heroAlbedo: false },
    ibl: 'small',
    quality: { parallax: 0, detail: true, detailFar: 35 },
    post: { ao: 0, contactShadows: false, aa: 'fxaa', dof: false, motionBlur: false, bloom: false, shafts: false },
    shadow: { csm: false, size: 2048, cascades: 1, maxFar: 0, radius: 30 },
    sky: '2k', mirror: 0, dprCap: 1, anisotropy: 2, toneMapping: 'agx', reeds: 0, fps: 60, hero: 'lod1',
  },
};

/** The light and grade: AgX, a strong warm late-afternoon sun, a darker sky fill, a firmer curve (look-dev's, warmed
 *  for the lower sun of decision 0033). */
export const DEFAULT_TUNE: Record<string, string> = { tm: 'agx', exp: '0.78', sun: '7.0', env: '0.85', con: '1.15', sat: '1.2', warm: '1.15', haze: '0.42', bounce: '0.2' };

export interface StreamStats { ms: number; bytes: number; sets: string[]; formats: Record<string, string[]>; gpuTextureBytes: number }

export interface RealismLook {
  tier: LookTier;
  post: Post;
  /** Toward the sun (world); the game's shadows and the sky agree with it. */
  sunDir: Vector3;
  /** Per frame, before render: time (s), the camera and what it follows (the runner's feet). */
  update(t: number, camera: PerspectiveCamera, focus: Vector3): void;
  render(): void;
  /** Shadows for a model added later (the hero, the levy, the district's kit): cast and receive. */
  adopt(o: Object3D): void;
  /** Give the look's materials to streets-kit meshes built after the look (the levy). */
  dress(o: Object3D): void;
  /** Fetch the tier's textures and sky, and swap them in (no shader rebuilt). Progress in bytes. */
  stream(onBytes?: (loaded: number, total: number) => void): Promise<StreamStats>;
  /** The camera's projection changed (size or field of view): re-fit the shadow cascades. */
  resized(): void;
  /** Light and grade, by name (exp, sun, env, tm, sat, con, fog, haze, bloom, warm, …): for tuning by hand. */
  tune(o: Record<string, string>): void;
  stats(): Record<string, unknown>;
  dispose(): void;
}

/** Turn of the sky about the vertical so the sun stands where the streets' own sun did (west-south-west of the
 *  square, as world.ts/game.ts place it), keeping the shadows' general direction. */
function turnFor(sunU: number): number {
  const want = Math.atan2(26, -38); // the classic look's sun offset (x −38, z +26)
  return want - (sunU - 0.5) * Math.PI * 2;
}

// What the looks of one visit share: a texture set, sky or IBL is fetched once and kept for a tier change (dropped by
// disposeLookCache when the game goes).
const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, f: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) { p = f(); cache.set(key, p); p.catch(() => cache.delete(key)); }
  return p;
}
/** The city parts' tagged geometries (tagCity), kept for every look of a visit. */
const tagged = new Map<InstancedMesh, BufferGeometry>();

export async function disposeLookCache() {
  for (const g of tagged.values()) g.dispose();
  tagged.clear();
  for (const p of cache.values()) {
    const v = await (p as Promise<any>).catch(() => null);
    if (!v) continue;
    if (v.albedo) v.albedo.dispose();
    if (v.data) v.data.dispose();
    if (v.texture) v.texture.dispose();
  }
  cache.clear();
}

export interface RealismOpts {
  turn?: number;
  sky?: string;
  /** The temple's court (flagstones), metres; by default the plan's temple footprint grown by 3 m. */
  court?: GroundRect | null;
}

export async function createRealism(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, city: StreetsCity, tier: LookTier, opts: RealismOpts = {}): Promise<RealismLook> {
  const SKY_ID = opts.sky ?? SKY;
  const t0 = performance.now();
  const loads: Record<string, number> = {};
  const lap = <T>(k: string, p: Promise<T>) => p.then((v) => { loads[k] = Math.round(performance.now() - t0); return v; });
  const [man, ibl, preview] = await Promise.all([
    lap('manifest', loadManifest()),
    lap('ibl', cached(`ibl:${SKY_ID}:${tier.ibl}`, () => loadIbl(SKY_ID, tier.ibl === 'small'))),
    lap('sky', cached(`sky:${SKY_ID}:preview`, () => loadBackdrop(renderer, SKY_ID, 'preview'))),
  ]);
  const means = meansOf(man);
  const ph = placeholderArrays(means);
  const slots: Slots = makeSlots(ph, means);
  const turn = opts.turn ?? turnFor(ibl.sunU);
  const sky: SkySetup = makeSky({ backdrop: preview.texture, exposure: preview.exposure, vSpan: preview.vSpan, sunU: preview.sunU, elevationDeg: ibl.elevationDeg, turn, width: preview.width });
  lookUniforms.sunDir.value.copy(sky.sunDir);

  // ---- renderer
  renderer.toneMapping = tier.toneMapping === 'agx' ? AgXToneMapping : ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  // ---- what the look changes, to put back
  const undo: (() => void)[] = [];
  const setMat = (m: Mesh, mat: Material) => { const old = m.material; m.material = mat; undo.push(() => { m.material = old; }); };
  // (a tagged copy is kept for the next look, not disposed: disposing a geometry frees every vertex buffer its render
  // objects used, the instanced mesh's own instance matrix too, which the mesh goes on drawing with)
  const setGeo = (m: Mesh, g: BufferGeometry) => { const old = m.geometry; m.geometry = g; undo.push(() => { m.geometry = old; }); };
  const hide = (o: Object3D) => { const v = o.visible; o.visible = false; undo.push(() => { o.visible = v; }); };
  const owned: { dispose(): void }[] = [ph.albedo, ph.data];

  // ---- sky, environment, fog
  const prev = { bg: scene.background, bgN: (scene as any).backgroundNode, env: scene.environment, fog: scene.fog, envI: scene.environmentIntensity, envR: scene.environmentRotation.clone() };
  undo.push(() => { scene.background = prev.bg; (scene as any).backgroundNode = prev.bgN; scene.environment = prev.env; scene.fog = prev.fog; scene.environmentIntensity = prev.envI; scene.environmentRotation.copy(prev.envR); });
  scene.background = null;
  (scene as any).backgroundNode = sky.background;
  // the image light, prefiltered here, now (PMREM), with the renderer's pipelines made synchronously for it: it is
  // drawn once, so a draw skipped while an async pipeline compiles (game.ts) would leave the light black for good
  const syncPrev = (renderer as any).__syncPipelines;
  (renderer as any).__syncPipelines = true;
  const pmrem = new PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(ibl.texture);
  pmrem.dispose();
  (renderer as any).__syncPipelines = syncPrev;
  owned.push(envRT);
  scene.environment = envRT.texture;
  scene.environmentRotation.copy(sky.envRotation);
  scene.environmentIntensity = 1.0;
  scene.fog = null;

  // ---- lights: the sky's light comes from the image; the sun from the sky's sun. The classic look's hemisphere
  // fill is switched off (the image light replaces it).
  const sun = city.sun as DirectionalLight;
  city.root.traverse((o) => { if ((o as HemisphereLight).isHemisphereLight && o.name !== 'look-bounce') hide(o); });
  const sunPrev = { c: sun.color.clone(), i: sun.intensity, size: sun.shadow.mapSize.clone(), bias: sun.shadow.bias, nb: sun.shadow.normalBias, cam: { l: sun.shadow.camera.left, r: sun.shadow.camera.right, t: sun.shadow.camera.top, b: sun.shadow.camera.bottom, n: sun.shadow.camera.near, f: sun.shadow.camera.far } };
  undo.push(() => {
    sun.color.copy(sunPrev.c); sun.intensity = sunPrev.i; sun.shadow.mapSize.copy(sunPrev.size); sun.shadow.bias = sunPrev.bias; sun.shadow.normalBias = sunPrev.nb; (sun.shadow as any).shadowNode = null;
    const c = sun.shadow.camera; c.left = sunPrev.cam.l; c.right = sunPrev.cam.r; c.top = sunPrev.cam.t; c.bottom = sunPrev.cam.b; c.near = sunPrev.cam.n; c.far = sunPrev.cam.f; c.updateProjectionMatrix();
    sun.shadow.map?.dispose(); sun.shadow.map = null;
  });
  sun.color.set(new Color(1.0, 0.86, 0.66));
  sun.intensity = 4.2;
  sun.shadow.mapSize.set(tier.shadow.size, tier.shadow.size);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;
  sun.shadow.map?.dispose(); sun.shadow.map = null;
  let csm: any = null;
  if (tier.shadow.csm) {
    csm = new CSMShadowNode(sun, { cascades: tier.shadow.cascades, maxFar: tier.shadow.maxFar, mode: 'practical', lightMargin: 80 });
    csm.fade = true;
    (sun.shadow as any).shadowNode = csm;
  } else {
    const R = tier.shadow.radius;
    const c = sun.shadow.camera;
    // the low sun's shadows run long: the box reaches 260 m toward it
    c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 1; c.far = 300; c.updateProjectionMatrix();
  }

  // ---- bounce light: the sunlit ground and walls light the shadows warm (no GI here: a hemisphere of light from
  // below, its strength tied to the sun's)
  const bounce = new HemisphereLight(0x000000, 0xc8955a, 0);
  bounce.name = 'look-bounce';
  city.root.add(bounce);
  undo.push(() => { city.root.remove(bounce); });
  const bounceK = { v: 0.13 };

  // ---- materials
  const q = tier.quality;
  const monuments: Footprint[] = [];
  if (city.plan.temple) monuments.push(city.plan.temple);
  if (city.plan.palace) monuments.push(city.plan.palace, city.plan.palace.hall);
  const wr = city.plan.walls;
  const wallRing = wr ? { r0: wr.R - wr.T - 2, r1: wr.R + wr.T + 2 } : null;
  const mats = {
    masonryCity: masonryMaterial(slots, q, 'city'),
    propsCity: propsMaterial(slots, q, 'city'),
    thatch: propsMaterial(slots, q, 'city', S.reed),
    foliage: foliageMaterial(),
    masonryKit: masonryMaterial(slots, q, 'kit'),
    propsKit: propsMaterial(slots, q, 'kit'),
    land: landMaterial(slots),
  };
  owned.push(...Object.values(mats));
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
  // the city model's parts
  city.city.traverse((o) => {
    const im = o as InstancedMesh;
    if (!im.isInstancedMesh || !im.visible || im.count === 0) return;
    const kind = cityKind(im.geometry);
    let tg = tagged.get(im);
    if (!tg) { tg = tagCity(im, monuments, wallRing); tagged.set(im, tg); }
    setGeo(im, tg);
    const mat = kind === 'box' ? mats.masonryCity : kind === 'gable' || kind === 'pyr' || kind === 'wedge' ? mats.thatch : kind === 'cone' || kind === 'ball' ? mats.foliage : mats.propsCity;
    setMat(im, mat);
    bump(`city-${kind}`, im.count);
  });
  // the ground, the land beyond, the sky dome, the water, the streets layer's parts
  let groundMesh: Mesh | null = null;
  city.city.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as unknown as InstancedMesh).isInstancedMesh) return;
    const mat = m.material as any;
    if (m.geometry.index && m.geometry.attributes.uv && mat?.map) groundMesh = m;
  });
  const temple = city.plan.temple;
  const court: GroundRect | null = opts.court !== undefined ? opts.court : temple ? { x: temple.x, z: temple.z, hw: temple.hw + 3, hd: temple.hd + 3, rot: temple.rot } : null;
  if (groundMesh) {
    const gm = groundMesh as Mesh;
    const gmat = groundMaterial(slots, q, { map: (gm.material as any).map ?? null, LOT, plazaR: city.plan.plazaR, roads: city.plan.roads, waterLevel: city.river.level, court });
    owned.push(gmat);
    setMat(gm, gmat);
  }
  let water: WaterLook | null = null;
  const post0 = { sunColor: new Color(1, 0.85, 0.66) };
  const kitMeshes: Mesh[] = [];
  const dressKit = (root: Object3D) => {
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.geometry.attributes.aDim || (m as any).isInstancedMesh) return;
      const orig = m.material as Material;
      if (orig === mats.masonryKit || orig === mats.propsKit) return;
      const kind = (orig.userData as { lookKind?: string }).lookKind ?? (orig.customProgramCacheKey?.().includes('+mud-') ? 'mud' : 'plain');
      setMat(m, kind === 'mud' ? mats.masonryKit : mats.propsKit);
      kitMeshes.push(m);
      bump(kind === 'mud' ? 'kit-masonry' : 'kit-props');
    });
  };
  city.root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    if (m.name === 'sky') hide(m);
    else if (m.name === 'outer-land') setMat(m, mats.land);
    else if (m.name === 'contact-shadows') hide(m);
    else if (m === city.layer.river.mesh) {
      water = waterMaterial({ level: city.river.level, mirror: tier.mirror > 0, mirrorScale: tier.mirror, sky: sky.radiance, sunDir: sky.u.sunDir, sunColor: sky.u.sunColor });
      setMat(m, water.material);
      m.receiveShadow = true;
      if (water.mirror) { scene.add(water.mirror); undo.push(() => { scene.remove(water!.mirror!); }); }
      owned.push(water);
    }
  });
  dressKit(city.root);
  // the banners' wind and the birds' flap, in TSL (world/life.ts; WebGPURenderer ignores the classic patches)
  for (const { mesh, material } of await city.layer.life.nodeMaterials().catch(() => [])) { setMat(mesh, material); bump('life'); }

  // ---- dressing: soot and grime at doors and windows, reeds on the banks
  // (no soot where the kit's own walls stand: the hero district draws its own doors)
  const district = city.district;
  const dress = dressing(city, openingsOf(city.layer.group).filter((o) => !district?.contains(o.x, o.z)), { reeds: tier.reeds });
  for (const o of [dress.decals, dress.reeds]) if (o) { scene.add(o); undo.push(() => { scene.remove(o); }); }
  owned.push(dress);

  // ---- post
  const post = makePost(renderer, scene, camera, sun, sky, tier.post);
  post.u.sunDir.value.copy(sky.sunDir);
  const setupMs = Math.round(performance.now() - t0);
  const target = new Vector3();
  let streamed: StreamStats | null = null;
  const sets: MaterialSet[] = [];
  let backdrop: Backdrop = preview;
  let fov = camera.fov, aspect = camera.aspect;
  let farCheck = -1;

  const look: RealismLook = {
    tier, post, sunDir: sky.sunDir,
    update(t, cam, focus) {
      lookUniforms.time.value = t;
      // the kit's far levels (LOD2, LOD3 and the far pools, built as the view moves) cast no shadow: from that far
      // they fall in the outer cascades only, where they cost draw calls for shadows nobody resolves
      if (district && t - farCheck > 0.5) {
        farCheck = t;
        for (const g of district.group.children) {
          if (!/-L[23]$|^kit-pool/.test(g.name)) continue;
          g.traverse((c) => { const m = c as Mesh; if (m.isMesh && m.castShadow) m.castShadow = false; });
        }
      }
      if (water) (water as WaterLook).u.time.value = t;
      if (csm) {
        if (Math.abs(cam.fov - fov) > 0.5 || cam.aspect !== aspect) look.resized();
        sun.position.copy(sky.sunDir).multiplyScalar(200).add(cam.position);
        sun.target.position.copy(cam.position);
        sun.target.updateMatrixWorld();
      } else {
        // a follow shadow, snapped to its texels so it does not shimmer
        const R = tier.shadow.radius;
        const texel = (2 * R) / tier.shadow.size;
        target.set(Math.round(focus.x / texel) * texel, focus.y, Math.round(focus.z / texel) * texel);
        sun.position.copy(sky.sunDir).multiplyScalar(150).add(target);
        sun.target.position.copy(target);
        sun.target.updateMatrixWorld();
      }
      post.update(cam, cam.position.distanceTo(focus));
    },
    render() { post.render(); },
    // (the kit's meshes keep the shadow casting the world chose for them)
    adopt(o) { o.traverse((c) => { const m = c as Mesh; if (m.isMesh) { if (!m.userData.kit) m.castShadow = !m.userData.noShadow; m.receiveShadow = true; } }); },
    dress(o) { dressKit(o); },
    async stream(onBytes) {
      const s0 = performance.now();
      const total = await streamBytes(SKY_ID, [tier.sets.full], tier.sets.heroAlbedo, tier.sky);
      const got: Record<string, number> = {};
      const tick = (k: string) => (n: number) => { got[k] = n; onBytes?.(Math.min(total, Object.values(got).reduce((a, b) => a + b, 0)), total); };
      const formats: Record<string, string[]> = {};
      // the full set and the sky together, then the hero albedo (the full set fills every surface; the hero sharpens
      // the closest)
      const [full, sk] = await Promise.all([
        cached(`set:${tier.sets.full}:${tier.anisotropy}`, () => loadMaterialSet(renderer, tier.sets.full, tier.anisotropy, tick('full'))),
        cached(`sky:${SKY_ID}:${tier.sky}`, () => loadBackdrop(renderer, SKY_ID, tier.sky, tick('sky'))),
      ]);
      slots.fullAlb.value = full.albedo; slots.fullData.value = full.data;
      slots.heroAlb.value = full.albedo; slots.heroData.value = full.data;
      sets.push(full); formats[full.name] = full.formats;
      sky.setBackdrop(sk.texture, sk.width);
      backdrop = sk;
      if (tier.sets.heroAlbedo) {
        const hero = await cached(`set:hero-2k-albedo:${tier.anisotropy}`, () => loadMaterialSet(renderer, 'hero-2k', tier.anisotropy, tick('hero'), ['albedo']));
        slots.heroAlb.value = hero.albedo;
        sets.push(hero); formats[`${hero.name} albedo`] = hero.formats;
      }
      streamed = {
        ms: Math.round(performance.now() - s0), bytes: total, sets: sets.map((x) => x.name), formats,
        gpuTextureBytes: sets.reduce((a, x) => a + x.gpuBytes, 0) + Math.round(backdrop.width * backdrop.width / 4 * 4 / 3),
      };
      return streamed;
    },
    resized() {
      fov = camera.fov; aspect = camera.aspect;
      if (csm && csm.camera) { try { csm.updateFrustums(); } catch { /* not initialised yet: it reads the camera on its first frame */ } }
    },
    tune(o) {
      const n = (k: string) => (o[k] !== undefined && o[k] !== null && o[k] !== '' ? Number(o[k]) : null);
      const u = post.u;
      if (n('exp') !== null) u.exposure.value = n('exp')!;
      if (n('bounce') !== null) bounceK.v = n('bounce')!;
      if (n('sun') !== null) { sun.intensity = n('sun')!; if (water) (water as WaterLook).u.sunK.value = sun.intensity; }
      bounce.intensity = sun.intensity * bounceK.v;
      if (n('env') !== null) scene.environmentIntensity = n('env')!;
      if (n('sat') !== null) u.saturation.value = n('sat')!;
      if (n('con') !== null) u.contrast.value = n('con')!;
      if (n('fog') !== null) u.fogDensity.value = n('fog')!;
      if (n('haze') !== null) sky.u.haze.value = n('haze')!;
      if (n('skyk') !== null) sky.u.skyK.value = n('skyk')!;
      if (n('bloom') !== null) u.bloomStrength.value = n('bloom')!;
      if (n('vig') !== null) u.vignette.value = n('vig')!;
      if (n('alb') !== null) lookUniforms.albedoK.value = n('alb')!;
      if (n('warm') !== null) {
        // the sun's colour, from a white-ish noon (0) to a deep late-afternoon gold (1.4)
        const w = n('warm')!;
        sun.color.setRGB(1, 0.93 - 0.1 * w, 0.84 - 0.22 * w);
        post0.sunColor.copy(sun.color);
        post.u.sunColor.value.copy(sun.color);
        sky.u.sunColor.value.copy(sun.color);
      }
      if (o.tm) { renderer.toneMapping = o.tm === 'aces' ? ACESFilmicToneMapping : o.tm === 'neutral' ? NeutralToneMapping : AgXToneMapping; post.pipeline.needsUpdate = true; }
    },
    stats() {
      return {
        tier: tier.name, setupMs, loads, counts, dressing: dress.stats, streamed,
        textures: { sets: sets.map(setInfo), iblBytes: ibl.bytes, skyBytes: backdrop.bytes, skyWidth: backdrop.width },
        gpuTextureBytes: streamed ? (streamed as StreamStats).gpuTextureBytes : 0,
        sunDir: sky.sunDir.toArray().map((v) => +v.toFixed(3)),
        sunElevationDeg: +((Math.asin(sky.sunDir.y) * 180) / Math.PI).toFixed(1),
        turn: +turn.toFixed(3),
      };
    },
    dispose() {
      post.dispose();
      for (let i = undo.length - 1; i >= 0; i--) undo[i]();
      for (const o of owned) o.dispose();
      // the streamed sets, the skies and the IBL stay in the cache for another tier (disposeLookCache drops them)
    },
  };
  look.tune(DEFAULT_TUNE);
  return look;
}

function setInfo(s: MaterialSet) { return { name: s.name, size: s.size, layers: s.keys.length, bytes: s.bytes, gpuBytes: s.gpuBytes, formats: s.formats }; }

export type { Texture };
