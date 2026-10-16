// Cities in 3D: what things are made of and coloured by. Era (the master's technological age) sets materials and
// forms; the people set the roof colour (from their heraldic colour, as on their arms) and the street pattern;
// the faith's heraldic metal gilds or whitens its temple. Pure functions of record values.

import { hash } from './record.ts';

export type RGB = [number, number, number];

export function hex(h: string): RGB {
  const m = h.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shade = (a: RGB, k: number): RGB => [Math.min(1, a[0] * k), Math.min(1, a[1] * k), Math.min(1, a[2] * k)];
/** Vary a colour by a 0..1 hash: ±amt in brightness, a touch of warmth. */
export function vary(a: RGB, h: number, amt = 0.1): RGB {
  const k = 1 + (h - 0.5) * 2 * amt;
  const w = (((h * 7.31) % 1) - 0.5) * amt * 0.5;
  return [Math.min(1, a[0] * k + w), Math.min(1, a[1] * k), Math.min(1, a[2] * k - w)];
}

// heraldry.ts tinctures (Gules, Azure, Vert, Purpure, Sable), as roof materials of each colour
const ROOF_OF_TINCTURE: RGB[] = [hex('#b4583c'), hex('#5a6d86'), hex('#5d7c4b'), hex('#775069'), hex('#55585f')];
export const TINCTURE_NAMES = ['red', 'blue-grey', 'green', 'purple', 'dark slate'];
/** The people's heraldic colour (the same draw as their arms in heraldry.ts). */
export function tinctureOf(culture: number): number {
  return culture < 0 ? 0 : hash(`cul:${culture}`) % 5;
}
export function roofOfCulture(culture: number): RGB {
  return ROOF_OF_TINCTURE[tinctureOf(culture)];
}
/** The faith's heraldic metal: 0 Or (gilded), 1 Argent (white). */
export function metalOf(faith: number, id: string): number {
  return hash(faith >= 0 ? `mov:${faith}` : `none:${id}`) % 2;
}
export const GOLD = hex('#d3a640');
export const SILVER = hex('#ece8df');

export type Pattern = 'grid' | 'radial' | 'organic' | 'courtyard';
export const PATTERNS: Pattern[] = ['grid', 'radial', 'organic', 'courtyard'];
/** A people's street pattern and its bearing (radians), the same in every city they build. */
export function streetsOf(culture: number): { pattern: Pattern; angle: number } {
  const h = hash(`cul:${culture}:streets`);
  return { pattern: PATTERNS[h % PATTERNS.length], angle: ((h >>> 8) % 90) * (Math.PI / 180) };
}

/** Per technological age: walls, roofs, paving; storeys; roof form. */
export interface AgeStyle {
  name: string;
  walls: RGB[];
  roof: 'flat' | 'gable' | 'hip' | 'steep' | 'mansard';
  roofK: number; // how much the people's colour shows in the roof
  roofBase: RGB;
  h: [number, number]; // wall height range (lots)
  foot: [number, number]; // footprint range (fraction of a lot)
  pave: RGB;
  stone: RGB; // monuments
  wall: RGB; // city walls
}

export const AGES: AgeStyle[] = [
  { name: 'mud-brick and reed', walls: [hex('#c9a57b'), hex('#bf9a70'), hex('#d4b48c')], roof: 'flat', roofK: 0.12, roofBase: hex('#d6b994'), h: [0.42, 0.66], foot: [0.62, 0.86], pave: hex('#c8b190'), stone: hex('#c8a678'), wall: hex('#b8936a') },
  { name: 'stone, timber and thatch', walls: [hex('#b9ad96'), hex('#a8957a'), hex('#c4b59a')], roof: 'gable', roofK: 0.22, roofBase: hex('#b89b5e'), h: [0.42, 0.62], foot: [0.6, 0.84], pave: hex('#bcae94'), stone: hex('#c2b69e'), wall: hex('#aa9f8a') },
  { name: 'dressed stone and tile', walls: [hex('#e8dfcd'), hex('#ddd2bd'), hex('#efe7d6')], roof: 'hip', roofK: 0.85, roofBase: hex('#b4583c'), h: [0.55, 0.85], foot: [0.62, 0.86], pave: hex('#cfc4ae'), stone: hex('#ece4d2'), wall: hex('#cdbfa4') },
  { name: 'timber and plaster', walls: [hex('#efe6d3'), hex('#e4d6bc'), hex('#a98a68'), hex('#eadcc4')], roof: 'steep', roofK: 0.9, roofBase: hex('#6c5a4c'), h: [0.7, 1.1], foot: [0.55, 0.78], pave: hex('#b7ab98'), stone: hex('#d9d1c1'), wall: hex('#b2aa9a') },
  { name: 'brick and stone', walls: [hex('#b9735a'), hex('#d8cbb0'), hex('#a8654f'), hex('#e2d6bf')], roof: 'mansard', roofK: 0.7, roofBase: hex('#5f6670'), h: [0.95, 1.5], foot: [0.66, 0.9], pave: hex('#a9a194'), stone: hex('#e0d6c2'), wall: hex('#b8ab93') },
  { name: 'industrial brick and slate', walls: [hex('#94604d'), hex('#a46e57'), hex('#8a5a49'), hex('#c8b9a0')], roof: 'gable', roofK: 0.35, roofBase: hex('#565b63'), h: [1.1, 1.8], foot: [0.72, 0.92], pave: hex('#8f8b85'), stone: hex('#cfc6b5'), wall: hex('#9a9184') },
  { name: 'concrete, steel and glass', walls: [hex('#d3cfc6'), hex('#c3c2bd'), hex('#9fb3bf'), hex('#e0dcd2')], roof: 'flat', roofK: 0.12, roofBase: hex('#b8b5ae'), h: [1.3, 2.6], foot: [0.72, 0.92], pave: hex('#8d8b88'), stone: hex('#e6e2d8'), wall: hex('#a5a29c') },
];
export const ageStyle = (a: number) => AGES[Math.max(0, Math.min(AGES.length - 1, a))];

export const CHARCOAL = hex('#2f2a26');
export const ASH = hex('#4a423c');
export const EMBER = hex('#e8742c');
export const MOSS = hex('#7d8a5a');
export const RUIN = hex('#b2a690');

/** Ground colours by biome: [land, fields light, fields dark, trees]. */
export interface Biome { land: RGB; field: RGB[]; tree: RGB; trees: 'broad' | 'conifer' | 'palm' | 'scrub' | 'none'; density: number; snow: boolean }
export function biomeOf(name: string): Biome {
  const B = (land: string, fields: string[], tree: string, trees: Biome['trees'], density: number, snow = false): Biome => ({ land: hex(land), field: fields.map(hex), tree: hex(tree), trees, density, snow });
  switch (name) {
    case 'Ice': return B('#e9ece9', ['#dfe3df', '#d5dbd8'], '#5d6f62', 'conifer', 0.05, true);
    case 'Tundra': return B('#c3c6b1', ['#b9bd9a', '#a9ae86', '#c9c19a'], '#56684f', 'conifer', 0.18, true);
    case 'Taiga': return B('#8fa283', ['#a6b27f', '#b9b886', '#94a46d'], '#3f5a43', 'conifer', 0.9);
    case 'Temperate forest': return B('#9db584', ['#b7c487', '#c9c58a', '#a3b876', '#d2c48e'], '#4f7346', 'broad', 0.85);
    case 'Steppe': return B('#cdc591', ['#d6c98c', '#c2b97a', '#dccf98'], '#77874f', 'broad', 0.12);
    case 'Mediterranean scrub': return B('#c8c08a', ['#d0c389', '#bdb97b', '#cbb67e', '#a9ad72'], '#6c7f4c', 'scrub', 0.35);
    case 'Hot desert': return B('#e5d2a1', ['#cfc489', '#b9bd78', '#d9c995'], '#7d8a4c', 'palm', 0.05);
    case 'Cold desert': return B('#d6cba9', ['#cbc39a', '#bdb88c'], '#748063', 'scrub', 0.06);
    case 'Savanna': return B('#cdbf7f', ['#d2c27f', '#bfb26c', '#c9b877'], '#7a8545', 'broad', 0.22);
    case 'Tropical forest': return B('#7fa572', ['#9fb878', '#b2c07e', '#8cae6b'], '#3f6b3d', 'palm', 0.95);
    case 'Wetland': return B('#9fbb9b', ['#aec18e', '#9fb582', '#b9c597'], '#55734e', 'broad', 0.45);
    case 'Alpine': return B('#b8b0a2', ['#b9b493', '#aaa786'], '#4d6250', 'conifer', 0.4, true);
    default: return B('#c9c18c', ['#d0c389', '#bdb97b'], '#6c7f4c', 'broad', 0.3);
  }
}
