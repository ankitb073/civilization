// Look: the scanned materials as GPU texture arrays (KTX2, Basis Universal), and the skies. Built by
// atlas/scripts/lookdev-assets.ts from CC0 Poly Haven scans (atlas/public/game/streets/look/LICENSES.md).
//
// Every material set is two mipmapped 2D arrays with one layer per material: albedo (sRGB, ETC1S) and data (linear,
// UASTC: normal x, normal y, roughness, height). The transcoder picks the GPU format the device has (ASTC on phones
// and Apple GPUs, BC7 or BC1/BC3 on other desktops, ETC2 on older Android), so a 1K layer takes 1–1.4 MB of GPU memory
// instead of 5.6 MB as RGBA8.
//
// Streaming (decision 0033): the materials sample "slots" (one base texture node per array, look/materials.ts), which
// start as tiny placeholder arrays (each layer the scan's mean colour, a flat normal), so the first frame needs no
// texture download at all. After it, the tier's sets stream in and are swapped into the slots (a texture swap, not a
// shader rebuild): the full set (every material), then on desktop the hero set's 2K albedo. The hero set's layers are
// the first layers of the full set, in the same order, so one layer index serves both.

import {
  type CompressedArrayTexture, DataArrayTexture, LinearMipmapLinearFilter, LinearFilter, RepeatWrapping, SRGBColorSpace,
  NoColorSpace, type DataTexture, EquirectangularReflectionMapping, FloatType, type Texture, UnsignedByteType, RGBAFormat,
} from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { kitKtx2 } from '../world/kitload.ts';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { WebGPURenderer } from 'three/webgpu';

export const LOOK_BASE = `${import.meta.env.BASE_URL}game/streets/look/`;

/** Material keys in the full arrays' layer order (lookdev-assets.ts MATERIALS). */
export const MATERIAL_KEYS = ['plaster', 'brick', 'earth', 'paving', 'stone', 'wood', 'reed', 'cloth'] as const;
export type MaterialKey = (typeof MATERIAL_KEYS)[number];
/** The hero array's layers (2K on desktop): the surfaces seen closest; the full arrays' first layers. */
export const HERO_KEYS = ['plaster', 'brick', 'earth', 'paving', 'stone'] as const;
export const layerOf = (k: MaterialKey) => MATERIAL_KEYS.indexOf(k);

/** Metres one texture tile spans (Poly Haven's measured size of each scan; cloth enlarged so its weave reads). */
export const TILE: Record<MaterialKey, number> = { plaster: 2.0, brick: 2.0, earth: 2.07, paving: 4.2, wood: 1.8, reed: 2.5, stone: 3.0, cloth: 0.6 };

export type SetName = 'hero-2k' | 'full-1k' | 'full-512';
interface SkyFile { file: string; bytes: number; width: number; height: number; exposure: number; vSpan: number }
export interface Manifest {
  sets: Record<string, { size: number; keys: string[]; means: number[][]; files: Record<string, { file: string; bytes: number }> }>;
  skies: Record<string, { sun: { u: number; v: number; elevationDeg: number }; ibl: { file: string; bytes: number }; iblSmall?: { file: string; bytes: number }; preview?: SkyFile; backdrop4k?: SkyFile; backdrop2k?: SkyFile }>;
}

export interface MaterialSet {
  name: string;
  size: number;
  keys: string[];
  albedo: CompressedArrayTexture;
  data: CompressedArrayTexture;
  /** Download (bytes) and estimated GPU memory (bytes, with mips). */
  bytes: number;
  gpuBytes: number;
  /** The GPU formats the transcoder chose. */
  formats: string[];
}

let manifestP: Promise<Manifest> | null = null;
export function loadManifest(): Promise<Manifest> {
  manifestP ??= fetch(`${LOOK_BASE}manifest.json`).then((r) => { if (!r.ok) throw new Error(`look manifest: ${r.status}`); return r.json() as Promise<Manifest>; });
  return manifestP;
}

/** Mean linear albedo of each layer (in MATERIAL_KEYS order), from the largest full set the manifest has: the
 *  materials divide each scan by it so the record's colours tint them, and the placeholders are drawn in it. */
export function meansOf(man: Manifest): number[][] {
  const s = man.sets['full-1k'] ?? man.sets['full-512'];
  return MATERIAL_KEYS.map((k) => s?.means[s.keys.indexOf(k)] ?? [0.2, 0.17, 0.13]);
}

/** The streets' one KTX2 loader (world/kitload.ts): one transcoder download and one worker pool for the kit's
 *  textures and the look's. */
function ktx2For(renderer: WebGPURenderer): KTX2Loader { return kitKtx2(renderer) as unknown as KTX2Loader; }

/** Bytes per pixel of a compressed GPU format (by three's format constant), for the memory estimate. */
function bppOf(format: number): number {
  // three: RGB_S3TC_DXT1 33776, RGBA_S3TC_DXT1 33777, DXT3 33778, DXT5 33779, RGB_ETC1 36196, RGB_ETC2 37492,
  // RGBA_ETC2_EAC 37496, RGBA_ASTC_4x4 37808, RGBA_BPTC 36492, RGBA 1023
  if (format === 33776 || format === 33777 || format === 36196 || format === 37492) return 0.5;
  if (format === 1023) return 4;
  return 1;
}
const FORMAT_NAMES: Record<number, string> = { 33776: 'BC1', 33777: 'BC1a', 33779: 'BC3', 36196: 'ETC1', 37492: 'ETC2', 37496: 'ETC2-EAC', 37808: 'ASTC4x4', 36492: 'BC7', 1023: 'RGBA8' };

/** Load a KTX2 file, reporting bytes as they arrive. */
function loadKtx2(renderer: WebGPURenderer, url: string, onBytes?: (loaded: number) => void): Promise<Texture> {
  return new Promise((resolve, reject) => {
    ktx2For(renderer).load(url, resolve, (e: ProgressEvent) => onBytes?.(e.loaded), reject);
  });
}

export async function loadMaterialSet(renderer: WebGPURenderer, name: SetName, anisotropy: number, onBytes?: (loaded: number) => void, parts: ('albedo' | 'data')[] = ['albedo', 'data']): Promise<MaterialSet> {
  const man = await loadManifest();
  const s = man.sets[name];
  if (!s) throw new Error(`look: no material set ${name}`);
  const got: Record<string, number> = {};
  const tick = (k: string) => (n: number) => { got[k] = n; onBytes?.(Object.values(got).reduce((a, b) => a + b, 0)); };
  const [albedo, data] = await Promise.all((['albedo', 'data'] as const).map((k) => parts.includes(k) ? loadKtx2(renderer, LOOK_BASE + s.files[k].file, tick(k)) as Promise<CompressedArrayTexture> : Promise.resolve(null)));
  for (const t of [albedo, data]) {
    if (!t) continue;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
  if (albedo) albedo.colorSpace = SRGBColorSpace;
  if (data) data.colorSpace = NoColorSpace;
  const layers = s.keys.length;
  const gpu = (t: CompressedArrayTexture | null) => (t ? Math.round(s.size * s.size * layers * bppOf(t.format) * 4 / 3) : 0);
  return {
    name, size: s.size, keys: s.keys, albedo: albedo as CompressedArrayTexture, data: data as CompressedArrayTexture,
    bytes: (albedo ? s.files.albedo.bytes : 0) + (data ? s.files.data.bytes : 0),
    gpuBytes: gpu(albedo) + gpu(data),
    formats: [albedo ? FORMAT_NAMES[albedo.format] ?? String(albedo.format) : '-', data ? FORMAT_NAMES[data.format] ?? String(data.format) : '-'],
  };
}

/** The bytes a set's files take (for the loading readout). */
export async function setBytes(name: SetName, parts: ('albedo' | 'data')[] = ['albedo', 'data']): Promise<number> {
  const s = (await loadManifest()).sets[name];
  return s ? parts.reduce((a, k) => a + s.files[k].bytes, 0) : 0;
}

/** Placeholder arrays (4×4 a layer, one layer per material): albedo the scan's mean colour (sRGB), data a flat
 *  normal, the material's usual roughness and mid height. What the first frame samples, until the sets stream in. */
export function placeholderArrays(means: number[][]): { albedo: DataArrayTexture; data: DataArrayTexture } {
  const n = 4, L = means.length;
  const a = new Uint8Array(n * n * L * 4), d = new Uint8Array(n * n * L * 4);
  const toSrgb = (c: number) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  const rough: Record<string, number> = { plaster: 0.86, brick: 0.82, earth: 0.9, paving: 0.78, stone: 0.8, wood: 0.75, reed: 0.85, cloth: 0.9 };
  for (let l = 0; l < L; l++) {
    const m = means[l];
    const r = rough[MATERIAL_KEYS[l]] ?? 0.85;
    for (let i = 0; i < n * n; i++) {
      const o = (l * n * n + i) * 4;
      a[o] = toSrgb(m[0]); a[o + 1] = toSrgb(m[1]); a[o + 2] = toSrgb(m[2]); a[o + 3] = 255;
      d[o] = 128; d[o + 1] = 128; d[o + 2] = Math.round(r * 255); d[o + 3] = 128;
    }
  }
  const mk = (buf: Uint8Array, cs: string) => {
    const t = new DataArrayTexture(buf, n, n, L);
    t.format = RGBAFormat;
    t.type = UnsignedByteType;
    t.colorSpace = cs;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(a, SRGBColorSpace), data: mk(d, NoColorSpace) };
}

/** The IBL source: an equirect HDR (the sun clamped), as a float texture for PMREM. */
export async function loadIbl(sky: string, small = false): Promise<{ texture: DataTexture; bytes: number; sunU: number; elevationDeg: number }> {
  const man = await loadManifest();
  const s = man.skies[sky];
  if (!s) throw new Error(`look: no sky ${sky}`);
  const f = small && s.iblSmall ? s.iblSmall : s.ibl;
  const t = await new HDRLoader().setDataType(FloatType).loadAsync(LOOK_BASE + f.file);
  t.mapping = EquirectangularReflectionMapping;
  // the sky's light, warmed toward the painted plates' late afternoon: the clear sky's blue kept in its brightness,
  // pulled a third of the way to a warm grey (a dusty, hazy sky lights the shadows warmer than a clean one)
  const d = (t.image as { data: Float32Array }).data;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
    d[i] = d[i] * 0.66 + l * 0.34 * 1.16; d[i + 1] = d[i + 1] * 0.66 + l * 0.34 * 0.98; d[i + 2] = d[i + 2] * 0.66 + l * 0.34 * 0.78;
  }
  t.needsUpdate = true;
  return { texture: t, bytes: f.bytes, sunU: s.sun.u, elevationDeg: s.sun.elevationDeg };
}

export interface Backdrop { texture: Texture; bytes: number; exposure: number; vSpan: number; sunU: number; width: number }

/** The visible sky: the upper hemisphere of the HDR as 8-bit sRGB (exposed), with the linear multiplier that undoes
 *  the exposure. `preview`: the first frame's small WebP; '4k' and '2k': the KTX2 that streams in after it. */
export async function loadBackdrop(renderer: WebGPURenderer, sky: string, size: '4k' | '2k' | 'preview', onBytes?: (n: number) => void): Promise<Backdrop> {
  const man = await loadManifest();
  const s = man.skies[sky];
  const b = size === 'preview' ? s?.preview : size === '4k' ? s?.backdrop4k : s?.backdrop2k;
  if (!s || !b) throw new Error(`look: no backdrop ${sky} ${size}`);
  let t: Texture;
  if (b.file.endsWith('.ktx2')) t = await loadKtx2(renderer, LOOK_BASE + b.file, onBytes);
  else {
    const { TextureLoader } = await import('three');
    t = await new TextureLoader().loadAsync(LOOK_BASE + b.file);
    t.generateMipmaps = true;
  }
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return { texture: t, bytes: b.bytes, exposure: b.exposure, vSpan: b.vSpan, sunU: s.sun.u, width: b.width };
}

/** The bytes of what streams after the first frame for a tier (for the readout). */
export async function streamBytes(sky: string, sets: SetName[], heroAlbedo: boolean, backdrop: '4k' | '2k'): Promise<number> {
  const man = await loadManifest();
  let n = 0;
  for (const s of sets) n += await setBytes(s);
  if (heroAlbedo) n += await setBytes('hero-2k', ['albedo']);
  const sk = man.skies[sky];
  n += (backdrop === '4k' ? sk?.backdrop4k?.bytes : sk?.backdrop2k?.bytes) ?? 0;
  return n;
}
