// The Tablet House backdrop: what each beat looks like (sky, light, haze, effects, grade, camera), as plain numbers
// so a beat change is a crossfade between two Looks. Shared by the 3D scene and the painted fallback.

export type Beat = 'muster' | 'field' | 'walls' | 'fall-sack' | 'fall-treaty' | 'held' | 'tablet' | 'ending';
export const BEATS: Beat[] = ['muster', 'field', 'walls', 'fall-sack', 'fall-treaty', 'held', 'tablet', 'ending'];

export type RGB = [number, number, number];
export type Outcome = 'sacked' | 'conquered' | 'treaty' | 'held';

export function hex(h: string): RGB {
  const m = h.replace('#', '');
  return [parseInt(m.slice(0, 2), 16) / 255, parseInt(m.slice(2, 4), 16) / 255, parseInt(m.slice(4, 6), 16) / 255];
}
export const css = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${+a.toFixed(3)})`;
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface Look {
  // ---- sky (sRGB 0..1)
  zenith: RGB;
  horizon: RGB;
  /** Below the horizon and the colour the land fades into. */
  haze: RGB;
  glow: RGB;
  glowK: number;
  /** Sun (or fire-lit cloud base) in the sky: degrees above the horizon, degrees right of the camera's heading. */
  sunEl: number;
  sunAz: number;
  disk: number;
  stars: number;
  clouds: number;
  cloudLit: RGB;
  cloudShade: RGB;
  // ---- light on the land
  lightEl: number;
  lightAz: number;
  light: RGB;
  lightI: number;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiI: number;
  /** Fog start and end, in multiples of the camera's distance to the city. */
  fogNear: number;
  fogFar: number;
  // ---- effects, 0..1
  windows: number;
  camp: number;
  fire: number;
  smoke: number;
  dust: number;
  chimney: number;
  campSmoke: number;
  // ---- grade (DOM overlays and a CSS filter on the 3D layer)
  vignette: number;
  vignetteColor: RGB;
  tint: RGB;
  tintK: number;
  blur: number;
  bright: number;
  sat: number;
  lamp: number;
  // ---- camera: turn from the base heading (rad), elevation above the city (degrees), distance multiple, lead
  // toward the battle (share of the way, capped), drift amplitude
  azOff: number;
  /** 0: the scene's chosen heading; 1: looking straight past the city toward the battlefield. */
  face: number;
  elev: number;
  distK: number;
  lead: number;
  drift: number;
}

type Spec = Omit<Look, 'zenith' | 'horizon' | 'haze' | 'glow' | 'cloudLit' | 'cloudShade' | 'light' | 'hemiSky' | 'hemiGround' | 'vignetteColor' | 'tint'> & {
  zenith: string; horizon: string; haze: string; glow: string; cloudLit: string; cloudShade: string; light: string;
  hemiSky: string; hemiGround: string; vignetteColor: string; tint: string;
};

const BASE: Spec = {
  zenith: '#6f9bc8', horizon: '#e6dccb', haze: '#d9d2c4', glow: '#ffd8a0', glowK: 0.5, sunEl: 20, sunAz: -70, disk: 0, stars: 0,
  clouds: 0.25, cloudLit: '#fbf3e6', cloudShade: '#aab4c0',
  lightEl: 24, lightAz: -110, light: '#fff0d8', lightI: 2.8, hemiSky: '#d4e0ec', hemiGround: '#6d5d46', hemiI: 1.0,
  fogNear: 1.1, fogFar: 7,
  windows: 0, camp: 0, fire: 0, smoke: 0, dust: 0, chimney: 0, campSmoke: 0,
  vignette: 0.35, vignetteColor: '#1c140c', tint: '#000000', tintK: 0, blur: 0, bright: 1, sat: 1, lamp: 0,
  azOff: 0, face: 0, elev: 14, distK: 1, lead: 0, drift: 1,
};

const SPECS: Record<Exclude<Beat, 'tablet'>, Partial<Spec>> = {
  // morning: low sun from the left, long shadows across the fields the levy will march over
  muster: {
    zenith: '#5f8fc2', horizon: '#f0dcc2', haze: '#e3d6c2', glow: '#ffcf96', glowK: 0.8, sunEl: 7, sunAz: -58, disk: 0.6,
    clouds: 0.3, cloudLit: '#fff1dc', cloudShade: '#a7aebb',
    lightEl: 16, lightAz: -128, light: '#ffe2b6', lightI: 3.0, hemiSky: '#cddcec', hemiGround: '#6a5741', hemiI: 0.95,
    fogNear: 1.0, fogFar: 7, chimney: 0.6,
    azOff: -0.12, face: 0.45, elev: 14, distK: 1, lead: 0.05,
  },
  // late morning haze, the dust of the battle rising far off toward the field
  field: {
    zenith: '#7c9fc0', horizon: '#e9dcc4', haze: '#e0d3bc', glow: '#fff0d0', glowK: 0.45, sunEl: 34, sunAz: 35, disk: 0,
    clouds: 0.18, cloudLit: '#fbf4e8', cloudShade: '#b9bcc2',
    lightEl: 36, lightAz: 140, light: '#fff3df', lightI: 2.7, hemiSky: '#dbe2e8', hemiGround: '#7a6a52', hemiI: 1.05,
    fogNear: 0.8, fogFar: 5.6, dust: 1, chimney: 0.2,
    azOff: 0.06, face: 1, elev: 12, distK: 1.5, lead: 0.1,
  },
  // dusk behind the city; the besiegers' fires ring the walls
  walls: {
    zenith: '#1f2848', horizon: '#d9845a', haze: '#6b5260', glow: '#ff8c48', glowK: 0.95, sunEl: -1.5, sunAz: 24, disk: 0,
    clouds: 0.35, cloudLit: '#f08a5a', cloudShade: '#33304a',
    lightEl: 7, lightAz: 30, light: '#ff9b62', lightI: 1.3, hemiSky: '#6f6890', hemiGround: '#2b2128', hemiI: 0.75,
    fogNear: 1.0, fogFar: 6.5, windows: 0.9, camp: 1, campSmoke: 0.25,
    vignette: 0.5, vignetteColor: '#0d0710',
    azOff: 0.32, elev: 18, distK: 1.05, lead: 0,
  },
  // night; the city burns
  'fall-sack': {
    zenith: '#03050b', horizon: '#17151f', haze: '#121118', glow: '#ff5a1e', glowK: 0.06, sunEl: 3, sunAz: 0, disk: 0, stars: 0.9,
    clouds: 0.22, cloudLit: '#3a2424', cloudShade: '#07080d',
    lightEl: 40, lightAz: 150, light: '#8ea4d8', lightI: 0.42, hemiSky: '#1e2846', hemiGround: '#17110f', hemiI: 0.42,
    fogNear: 1.0, fogFar: 6, windows: 0.3, fire: 1, smoke: 1,
    vignette: 0.62, vignetteColor: '#050203',
    azOff: 0.14, elev: 13, distK: 0.9, lead: 0,
  },
  // grey dawn; terms are read at the gate
  'fall-treaty': {
    zenith: '#76818f', horizon: '#d3cbc0', haze: '#c4bdb3', glow: '#f6dcc0', glowK: 0.4, sunEl: 2, sunAz: -48, disk: 0,
    clouds: 0.86, cloudLit: '#e0d9d1', cloudShade: '#858b97',
    lightEl: 9, lightAz: -120, light: '#f4dfca', lightI: 1.1, hemiSky: '#c3c8cf', hemiGround: '#605a52', hemiI: 1.25,
    fogNear: 0.7, fogFar: 5, windows: 0.15, camp: 0.1, chimney: 0.5, campSmoke: 0.45,
    vignette: 0.42, vignetteColor: '#141619', sat: 0.88,
    azOff: -0.34, elev: 12, distK: 1.05, lead: 0,
  },
  // the walls held: a clear morning, the besiegers' camp left smouldering
  held: {
    zenith: '#3f7fc4', horizon: '#dce7ee', haze: '#d6dee2', glow: '#fff3d6', glowK: 0.6, sunEl: 22, sunAz: -95, disk: 0,
    clouds: 0.16, cloudLit: '#ffffff', cloudShade: '#b0bccb',
    lightEl: 24, lightAz: -132, light: '#fff3dc', lightI: 3.1, hemiSky: '#d3e2f2', hemiGround: '#6f6048', hemiI: 1.05,
    fogNear: 1.4, fogFar: 9, campSmoke: 0.5, chimney: 0.35, dust: 0.15,
    vignette: 0.28,
    azOff: -0.08, elev: 15, distK: 1.2, lead: 0,
  },
  // history's long view: golden late light, the city small in its land
  ending: {
    zenith: '#4f6c9c', horizon: '#f2c48c', haze: '#d9b892', glow: '#ffb46a', glowK: 0.9, sunEl: 6, sunAz: 38, disk: 0.5,
    clouds: 0.34, cloudLit: '#ffcf94', cloudShade: '#6c6a86',
    lightEl: 10, lightAz: 48, light: '#ffc58e', lightI: 2.5, hemiSky: '#b9c3d6', hemiGround: '#5a4836', hemiI: 0.9,
    fogNear: 1.1, fogFar: 6.5, chimney: 0.3,
    vignette: 0.42, vignetteColor: '#140c06',
    azOff: 0.62, elev: 16, distK: 2.3, lead: 0, drift: 1.4,
  },
};

function build(s: Spec): Look {
  return {
    ...s,
    zenith: hex(s.zenith), horizon: hex(s.horizon), haze: hex(s.haze), glow: hex(s.glow), cloudLit: hex(s.cloudLit),
    cloudShade: hex(s.cloudShade), light: hex(s.light), hemiSky: hex(s.hemiSky), hemiGround: hex(s.hemiGround),
    vignetteColor: hex(s.vignetteColor), tint: hex(s.tint),
  };
}

const LOOKS = new Map<string, Look>();
for (const [k, v] of Object.entries(SPECS)) LOOKS.set(k, build({ ...BASE, ...v }));

/** The outdoor beat an outcome ends on (the tablet is written under it). */
export function outcomeBeat(o: Outcome): Beat {
  return o === 'held' ? 'held' : o === 'treaty' ? 'fall-treaty' : 'fall-sack';
}

/** The tablet: the same world seen from the lamp-lit room where the scribe writes: dark, soft, warm. */
export function interior(outside: Look): Look {
  return {
    ...outside,
    vignette: 0.96, vignetteColor: hex('#120701'), tint: hex('#ff9440'), tintK: 0.3, blur: 7, bright: 0.4, sat: 0.7, lamp: 1,
    distK: outside.distK * 0.9, drift: 0.35,
  };
}

/** The look of a beat. `after` is the last outdoor beat shown (the tablet keeps its time of day). */
export function lookFor(beat: Beat, outcome: Outcome, after: Beat | null): Look {
  if (beat === 'tablet') {
    const base = after && after !== 'tablet' && after !== 'ending' ? after : outcomeBeat(outcome);
    return interior(lookFor(base, outcome, null));
  }
  const l = { ...LOOKS.get(beat)! };
  if (beat === 'ending') {
    // the long view remembers how it ended: thin smoke over a sacked city, a quiet one otherwise
    if (outcome === 'sacked' || outcome === 'conquered') { l.smoke = 0.32; l.chimney = 0.1; l.sat = 0.9; }
  }
  return l;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const CAMERA_KEYS = new Set<keyof Look>(['azOff', 'face', 'elev', 'distK', 'lead', 'drift']);

/** Blend two looks: `t` for the light and grade, `tc` for the camera. */
export function blendLook(a: Look, b: Look, t: number, tc = t): Look {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(a) as (keyof Look)[]) {
    const u = CAMERA_KEYS.has(k) ? tc : t;
    const va = a[k], vb = b[k];
    out[k] = Array.isArray(va) ? mixRgb(va as RGB, vb as RGB, u) : lerp(va as number, vb as number, u);
  }
  return out as unknown as Look;
}

/** Sky colour at height h (sin of elevation) toward a direction `cosSun` (cosine to the sun), sRGB. Matches sky.ts. */
export function skyAt(l: Look, h: number, cosSun: number): RGB {
  const up = Math.max(0, Math.min(1, h));
  let c = mixRgb(l.horizon, l.zenith, Math.pow(up, 0.55));
  const below = Math.max(0, Math.min(1, -h / 0.08));
  c = mixRgb(c, l.haze, below * below * (3 - 2 * below));
  const g = Math.max(0, cosSun);
  const k = l.glowK * (Math.pow(g, 6) * 0.55 + Math.pow(g, 48) * 0.6 + 0.35 * g * g * Math.exp(-Math.max(h, 0) * 7));
  return [Math.min(1, c[0] + l.glow[0] * k), Math.min(1, c[1] + l.glow[1] * k), Math.min(1, c[2] + l.glow[2] * k)];
}
