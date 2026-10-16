// The printed parts of a piece: its seal (drawn by heraldry.ts, the same SVG as on the person's page), the name band
// around its base, and the base itself, whose stone, wood or lacquer is the age's. Textures are drawn on canvases; a
// seal arrives asynchronously (an SVG image), so every texture registers in `pending` and calls `onTextureUpdate`.
import {
  CanvasTexture, CircleGeometry, CylinderGeometry, DoubleSide, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  SRGBColorSpace, type Texture,
} from 'three';
import { sigilSvg } from '../../heraldry.ts';
import type { FigureSpec } from './spec.ts';
import { lifeLine } from './spec.ts';
import { type Kit, lathe, mixHex, ring, shade, T } from './kit.ts';

export const BASE_R = 0.3;
export const BASE_H = 0.075;

const hasDom = typeof document !== 'undefined';
const pending = new Set<Promise<unknown>>();
const listeners = new Set<() => void>();
/** Called whenever a texture finishes drawing (stages re-render). */
export function onTextureUpdate(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => listeners.forEach((f) => f());
function track<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  p.finally(() => { pending.delete(p); notify(); }).catch(() => {});
  return p;
}
/** Resolves once every texture started so far has been drawn. */
export async function texturesReady(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

// ---------------------------------------------------------------- the seal
const sealCache = new Map<string, { tex: CanvasTexture; users: number }>();
/** The person's seal as a texture: the very SVG the page shows (round for men, a lozenge for women). */
export function sealTexture(f: FigureSpec): Texture | null {
  if (!hasDom) return null;
  const key = f.sigil.join('|');
  const hit = sealCache.get(key);
  if (hit) { hit.users++; return hit.tex; }
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  sealCache.set(key, { tex, users: 1 });
  const svg = sigilSvg(f.sigil, { uid: `fig${f.id}`, title: false }).replace('<svg ', `<svg width="${S}" height="${S}" `);
  const img = new Image();
  track(new Promise<void>((ok) => {
    img.onload = () => {
      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(img, 0, 0, S, S);
      tex.needsUpdate = true;
      ok();
    };
    img.onerror = () => ok();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }));
  return tex;
}

/** A flat decal of the seal, facing +z, `size` across (its own transparent corners make the lozenge). */
export function sealDecal(f: FigureSpec, size: number): Mesh | null {
  const tex = sealTexture(f);
  if (!tex) return null;
  const m = new Mesh(new PlaneGeometry(size, size), new MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.55, metalness: 0.05, side: DoubleSide }));
  m.castShadow = false;
  m.receiveShadow = true;
  m.name = 'seal';
  return m;
}

// ---------------------------------------------------------------- the base
interface BaseStyle { body: string; rim: string; ink: string; band: string; gilt: boolean; font: string; italic: boolean; weight: number }
/** One base per age: sandstone, basalt, marble, oak, walnut with gilt, black lacquer with brass, pale concrete. */
export function baseStyle(era: number): BaseStyle {
  const serif = `'EB Garamond Variable','EB Garamond',Georgia,serif`;
  const sans = `'Inter Variable',Inter,system-ui,sans-serif`;
  switch (era) {
    case 0: return { body: '#b89a6e', rim: '#a4875c', ink: '#3d2a18', band: '#c9ad82', gilt: false, font: serif, italic: false, weight: 600 };
    case 1: return { body: '#4f4c48', rim: '#5d5955', ink: '#e9dfc8', band: '#46433f', gilt: false, font: serif, italic: false, weight: 600 };
    case 2: return { body: '#e3ddd0', rim: '#d2cab9', ink: '#5b2418', band: '#ece6da', gilt: false, font: serif, italic: true, weight: 600 };
    case 3: return { body: '#6e4a2c', rim: '#5d3d23', ink: '#e7c36a', band: '#5a3b21', gilt: true, font: serif, italic: true, weight: 600 };
    case 4: return { body: '#3f2a1c', rim: '#c9a04a', ink: '#e8c46c', band: '#36241a', gilt: true, font: serif, italic: false, weight: 700 };
    case 5: return { body: '#1e1c1b', rim: '#b8913f', ink: '#d9b45e', band: '#181716', gilt: true, font: serif, italic: false, weight: 700 };
    default: return { body: '#cfccc5', rim: '#bdb9b1', ink: '#2c2a27', band: '#d9d6cf', gilt: false, font: sans, italic: false, weight: 650 };
  }
}

/** The plinth (into the kit) and its printed band and seal (as extra meshes). The base's top is y = 0. */
export function buildBase(kit: Kit, f: FigureSpec): void {
  const st = baseStyle(f.era);
  const R = BASE_R, H = BASE_H;
  // a bevelled drum: chamfered foot, straight side, moulded top edge
  kit.add(lathe([[0.001, -H], [R - 0.008, -H], [R, -H + 0.008], [R, -0.014], [R - 0.004, -0.006], [R - 0.012, 0], [0.001, 0]], 48), st.body, 'gloss');
  // a fillet at the top edge (brass or gilt on the later bases)
  kit.with(T(0, -0.011, 0), () => kit.add(ring(R - 0.0015, 0.0042, 64, 6), st.rim, st.gilt ? 'metal' : 'gloss'));
  if (f.death === 'executed') veil(kit);
  if (!hasDom) return;
  // the name band, printed round the front of the drum
  const band = nameBand(f, st);
  if (band) kit.addObject(band);
  // the seal, set into the top in front of the feet
  const seal = sealDecal(f, 0.11);
  if (seal) {
    seal.rotation.x = -Math.PI / 2;
    seal.position.set(0, 0.0035, R - 0.075);
    kit.addObject(seal);
    // its setting: a thin raised rim round a man's seal (a woman's lozenge lies flat)
    if (f.sex !== 'f') kit.with(T(0, 0.0012, R - 0.075), () => kit.add(ring(0.0505, 0.0038, 40, 5), st.gilt ? '#c9a04a' : shade(st.body, -0.25), st.gilt ? 'metal' : 'gloss'));
  }
}

/** A black cloth laid over the base: the record says this person was executed. */
function veil(kit: Kit) {
  const R = BASE_R + 0.004;
  const prof: [number, number][] = [[0.001, 0.0015], [R - 0.012, 0.0015], [R, -0.006], [R + 0.002, -0.03]];
  const g = lathe(prof, 64);
  // a scalloped hem: the cloth hangs lower between its folds
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -0.02) { const a = Math.atan2(p.getX(i), p.getZ(i)); p.setY(i, y - 0.012 * (0.5 + 0.5 * Math.cos(a * 9))); }
  }
  g.computeVertexNormals();
  kit.add(g, '#1c1a19');
}

const fontsLoaded = new Map<string, Promise<unknown>>();
function ensureFont(spec: string): Promise<unknown> {
  if (!hasDom || !document.fonts) return Promise.resolve();
  let p = fontsLoaded.get(spec);
  if (!p) { p = document.fonts.load(spec).catch(() => {}); fontsLoaded.set(spec, p); }
  return p;
}

function nameBand(f: FigureSpec, st: BaseStyle): Mesh | null {
  const W = 1024, Hh = 64;
  const arc = Math.PI * 0.92;     // the front ~165°
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Hh;
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = LinearMipmapLinearFilter;
  const name = f.name;
  const life = lifeLine(f).replace(/^AY /, 'AY ');
  const draw = () => {
    const c = cv.getContext('2d')!;
    c.fillStyle = st.band;
    c.fillRect(0, 0, W, Hh);
    // a hairline above and below, like an engraved cartouche
    c.fillStyle = mixHex(st.band, st.ink, 0.45);
    c.fillRect(0, 5, W, 1.5);
    c.fillRect(0, Hh - 6.5, W, 1.5);
    const big = (px: number) => `${st.italic ? 'italic ' : ''}${st.weight} ${px}px ${st.font}`;
    const small = (px: number) => `${st.weight - 100} ${px}px ${st.font}`;
    let px = 36;
    c.font = big(px);
    const sep = '   ·   ';
    c.font = small(26);
    const lw = c.measureText(sep + life).width;
    c.font = big(px);
    while (px > 18 && c.measureText(name).width + lw > W * 0.86) { px -= 1; c.font = big(px); }
    const nw = c.measureText(name).width;
    const x0 = (W - nw - lw) / 2;
    c.textBaseline = 'middle';
    c.fillStyle = st.ink;
    c.fillText(name, x0, Hh / 2 + 1);
    c.font = small(26);
    c.globalAlpha = 0.85;
    c.fillText(sep + life, x0 + nw, Hh / 2 + 2);
    c.globalAlpha = 1;
    tex.needsUpdate = true;
  };
  draw();
  track(Promise.all([ensureFont(`${st.italic ? 'italic ' : ''}${st.weight} 36px ${st.font}`), ensureFont(`${st.weight - 100} 26px ${st.font}`)]).then(draw));
  const g = new CylinderGeometry(BASE_R + 0.0012, BASE_R + 0.0012, 0.04, 64, 1, true, -arc / 2, arc);
  const m = new Mesh(g, new MeshStandardMaterial({ map: tex, roughness: st.gilt ? 0.45 : 0.6, metalness: 0.02 }));
  m.position.y = -BASE_H * 0.5 - 0.004;
  m.name = 'band';
  m.receiveShadow = true;
  return m;
}

/** A soft round shadow under a base (for the turntable, the shelf and the portraits). */
let blob: CanvasTexture | null = null;
export function contactShadow(opacity = 0.42): Mesh | null {
  if (!hasDom) return null;
  if (!blob) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d')!;
    // an alpha map is read from the green channel: white is opaque
    c.fillStyle = '#000';
    c.fillRect(0, 0, 128, 128);
    const g = c.createRadialGradient(64, 64, 18, 64, 64, 64);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.55, '#8c8c8c');
    g.addColorStop(1, '#000');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    blob = new CanvasTexture(cv);
  }
  const m = new Mesh(new CircleGeometry(BASE_R * 1.55, 32), new MeshBasicMaterial({ color: 0x000000, alphaMap: blob, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -BASE_H - 0.001;
  m.name = 'contact';
  m.renderOrder = -1;
  return m;
}
