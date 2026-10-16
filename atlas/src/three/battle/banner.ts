// Banners and standards from the archive's own heraldry (atlas/src/heraldry.ts, imported read-only): a state's
// arms on a cloth of its colour within a border of its metal; a commander's seal on a swallow-tailed standard.
// The SVG is drawn into a canvas once its image decodes; until then the cloth shows the plain tinctures.

import { CanvasTexture, SRGBColorSpace } from 'three';
import type { ArmsSpec, SigilSpec } from '../../../../engine/src/export/contract.ts';
import { armsSvg, sigilSvg } from '../../heraldry.ts';

export interface Tinctures { colour: string; metal: string }

const lum = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
};

/** The two tinctures of a coat of arms, read off its drawing: the darker is the colour, the lighter the metal. */
export function tincturesOf(spec: ArmsSpec): Tinctures {
  const svg = armsSvg(spec, { title: false, uid: `t${spec[0]}` });
  const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase()).filter((f) => f !== '#241c15' && f !== '#ffffff' && f !== '#000000');
  const uniq = [...new Set(fills)];
  if (uniq.length < 2) return { colour: uniq[0] ?? '#8e2f1f', metal: '#d6a634' };
  const [a, b] = uniq.slice(0, 2).sort((x, y) => lum(x) - lum(y));
  return { colour: a, metal: b };
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function texture(w: number, h: number, paint: (g: CanvasRenderingContext2D, img: HTMLImageElement | null) => void, svg: string, onReady: () => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  paint(g, null);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const img = new Image();
  img.onload = () => { g.clearRect(0, 0, w, h); paint(g, img); tex.needsUpdate = true; onReady(); };
  img.src = svgUrl(svg);
  return tex;
}

/** A state's banner: its arms on a cloth of its colour, bordered in its metal (128 × 160). */
export function bannerTexture(spec: ArmsSpec, t: Tinctures, onReady: () => void): CanvasTexture {
  const svg = armsSvg(spec, { title: false, uid: `b${spec[0]}` });
  return texture(128, 160, (g, img) => {
    g.fillStyle = t.colour; g.fillRect(0, 0, 128, 160);
    g.fillStyle = t.metal;
    g.fillRect(0, 0, 128, 9); g.fillRect(0, 151, 128, 9); g.fillRect(0, 0, 7, 160); g.fillRect(121, 0, 7, 160);
    // a fringe
    for (let x = 4; x < 128; x += 10) g.fillRect(x, 152, 4, 8);
    if (img) g.drawImage(img, 22, 22, 84, 101);
  }, svg, onReady);
}

/** A commander's standard: the seal on a field of the state's metal, a band of its colour (192 × 128, tails cut by
 *  the cloth's shape). */
export function standardTexture(seal: SigilSpec | null, arms: ArmsSpec, t: Tinctures, onReady: () => void): CanvasTexture {
  const svg = seal ? sigilSvg(seal, { title: false, uid: `c${seal[0]}` }) : armsSvg(arms, { title: false, uid: `c${arms[0]}` });
  return texture(192, 128, (g, img) => {
    g.fillStyle = t.metal; g.fillRect(0, 0, 192, 128);
    g.fillStyle = t.colour;
    g.fillRect(0, 0, 192, 14); g.fillRect(0, 114, 192, 14);
    g.fillRect(120, 14, 72, 100);
    if (img) { if (seal) g.drawImage(img, 18, 18, 92, 92); else g.drawImage(img, 26, 14, 84, 101); }
  }, svg, onReady);
}

/** The brass plaque on the plinth. */
export function plaqueTexture(title: string, sub: string, dark: boolean): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 160;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, dark ? '#9c7a3c' : '#c9a454'); grd.addColorStop(0.5, dark ? '#b8944c' : '#e2c071'); grd.addColorStop(1, dark ? '#80612c' : '#a9833b');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 160);
  g.strokeStyle = 'rgba(60,40,10,.55)'; g.lineWidth = 4; g.strokeRect(10, 10, 1004, 140);
  g.fillStyle = '#3a2810';
  g.textAlign = 'center';
  g.font = `600 58px 'EB Garamond Variable','EB Garamond',Georgia,serif`;
  g.fillText(title.toUpperCase().split('').join(' '), 512, 80, 960);
  g.font = `italic 500 36px 'EB Garamond Variable','EB Garamond',Georgia,serif`;
  g.fillText(sub, 512, 128, 960);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
