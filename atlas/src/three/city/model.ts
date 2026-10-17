// Cities in 3D: the model of one city at one year, generated from its record (record.ts) on its plan (layout.ts).
// Houses: how many from the population survey; their materials and forms from the master's technological age;
// roof colour from the people. The temple's form from the state faith; palace and walls while a capital; harbour and
// boats for a port; a bridge where a river runs; burnt quarters and breached walls for a sack in the last 20 years;
// ruins after abandonment. Units are lots; the group is centred on the temple square, x east and z south.

import {
  BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Group, LinearMipmapLinearFilter, Mesh,
  MeshLambertMaterial, SRGBColorSpace, type IUniform, type WebGLProgramParametersWithUniforms, Color,
} from 'three';
import {
  type CityRecord, type CityYear, type TempleForm, SACK_YEARS, buildingsFor, cityAt, hash, popAt, polityName, stepAt, unit,
} from './record.ts';
import { type Layout, type Slot, SECTORS, layoutOf, meander, riverDist, seaDepth, shoreAt, vnoise, waterAt } from './layout.ts';
import {
  ASH, CHARCOAL, EMBER, GOLD, MOSS, RUIN, SILVER, type RGB, ageStyle, biomeOf, hex, metalOf, mix, roofOfCulture, shade, vary,
} from './style.ts';
import { Parts, makeGeometries, type Kind } from './parts.ts';

export const WATER_Y = -0.14;
const MAX_LEVEL = 8;
const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Anchor { key: 'temple' | 'palace' | 'harbour' | 'river' | 'rail' | 'walls'; kicker: string; text: string; x: number; y: number; z: number }
export interface Smoke { x: number; y: number; z: number; k: number; seed: number; dark?: boolean }
export interface ModelOpts {
  plinth?: boolean;
  textureSize?: number;
  theme?: 'light' | 'dark';
  /** Draw the city as it stood before a sack in the drawn year itself: no burnt quarters, breached walls or sooted
   *  temple and palace for that year's sack (an earlier sack within 20 years still shows). Off by default; used by the
   *  streets game, whose first days come before the sack. */
  beforeSack?: boolean;
}

let sharedGeos: ReturnType<typeof makeGeometries> | null = null;

/** Per-record lookups by year (age and people of each year, for lots that lag behind a change). */
interface Track { age: Int8Array; culture: Int16Array; y0: number }
function trackOf(rec: CityRecord): Track {
  const y0 = Math.max(0, Math.min(rec.start, rec.yearEnd));
  const n = rec.yearEnd - y0 + 1;
  const age = new Int8Array(n), culture = new Int16Array(n);
  let oi = 0, ci = 0;
  for (let k = 0; k < n; k++) {
    const y = y0 + k;
    while (oi + 2 < rec.owners.length && rec.owners[oi + 2] <= y) oi += 2;
    while (ci + 2 < rec.cultures.length && rec.cultures[ci + 2] <= y) ci += 2;
    const owner = rec.owners[oi + 1];
    const p = rec.polities[owner];
    let a = 0;
    if (p && p.survey.length) a = stepAt(p.survey, y, 3, 2);
    else rec.eras.forEach((e, i) => { if (y >= e.start) a = i; });
    // a city without a master keeps the age it last had
    if ((!p || !p.survey.length) && k > 0 && owner < 0) a = age[k - 1];
    age[k] = clamp(a, 0, 6);
    culture[k] = rec.cultures[ci + 1];
  }
  return { age, culture, y0 };
}

export class CityModel {
  readonly group = new Group();
  readonly rec: CityRecord;
  readonly L: Layout;
  /** Plinth radius in lots (the model's extent). */
  P = 0;
  cy: CityYear | null = null;
  anchors: Anchor[] = [];
  smoke: Smoke[] = [];
  /** Live counts, for the probes. */
  readonly stats = { parts: 0, houses: 0, build: 0 };
  private T: Track;
  private parts: Parts;
  private puffs: Parts;
  private mat: MeshLambertMaterial;
  private puffMat: MeshLambertMaterial;
  private ground: Mesh | null = null;
  private side: Mesh | null = null;
  private water: Mesh;
  private waterMat: MeshLambertMaterial;
  private groundMat: MeshLambertMaterial;
  private sideMat: MeshLambertMaterial;
  private tex: CanvasTexture | null = null;
  private uniforms: Record<string, IUniform>;
  private town = new Float32Array(SECTORS + 1);
  private level = -1;
  private paintedAge = -1;
  private opts: Required<ModelOpts>;
  private trees: { x: number; z: number; s: number; h: number; kind: number; r: number; sector: number }[] = [];
  private railHide: Uint8Array;
  private biome: ReturnType<typeof biomeOf>;
  private wallRing = new Map<number, number>();
  private rimWet = new Uint8Array(181);

  constructor(rec: CityRecord, opts: ModelOpts = {}) {
    this.rec = rec;
    this.opts = { plinth: opts.plinth ?? true, textureSize: opts.textureSize ?? 1024, theme: opts.theme ?? 'light', beforeSack: opts.beforeSack ?? false };
    this.L = layoutOf(rec);
    this.T = trackOf(rec);
    this.biome = biomeOf(rec.site.biome);
    sharedGeos ??= makeGeometries();
    this.mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.parts = new Parts(sharedGeos, this.mat);
    this.puffMat = new MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true });
    this.puffs = new Parts(sharedGeos, this.puffMat, false);
    this.puffs.group.renderOrder = 3;
    this.group.add(this.parts.group, this.puffs.group);
    this.waterMat = new MeshLambertMaterial({ color: 0x6f9db2, transparent: true, opacity: 0.8, depthWrite: false });
    this.water = new Mesh(new CircleGeometry(1, 128).rotateX(-Math.PI / 2), this.waterMat);
    this.water.position.y = WATER_Y;
    this.water.receiveShadow = true;
    this.water.renderOrder = 2;
    this.group.add(this.water);
    this.sideMat = new MeshLambertMaterial({ vertexColors: true });
    this.uniforms = {
      uTown: { value: this.town },
      uPave: { value: new Color() },
      uPlaza: { value: new Color() },
      uPlazaR: { value: this.L.plazaR },
      uPaveK: { value: 1 },
    };
    this.groundMat = new MeshLambertMaterial({ color: 0xffffff });
    this.groundMat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLot;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLot = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vLot;
uniform float uTown[${SECTORS + 1}];
uniform vec3 uPave;
uniform vec3 uPlaza;
uniform float uPlazaR;
uniform float uPaveK;
float lotHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float r = length(vLot.xz);
  float a = atan(vLot.z, vLot.x);
  if (a < 0.0) a += 6.28318530718;
  float f = a / 6.28318530718 * ${SECTORS}.0;
  int i = int(floor(f));
  float R = mix(uTown[i], uTown[i + 1], fract(f));
  R += 0.35 * sin(a * 37.0 + r * 0.7) + 0.25 * sin(a * 91.0);
  float land = smoothstep(-0.07, -0.01, vLot.y) * (1.0 - smoothstep(0.35, 0.9, vLot.y));
  float pave = (1.0 - smoothstep(R - 0.6, R + 0.5, r)) * land * uPaveK;
  vec2 lot = floor(vLot.xz * 1.0);
  vec3 pc = uPave * (0.93 + 0.1 * lotHash(lot));
  float plaza = 1.0 - smoothstep(uPlazaR - 0.25, uPlazaR + 0.1, r);
  pc = mix(pc, uPlaza * (0.97 + 0.05 * step(0.5, fract(r * 1.3))), plaza);
  diffuseColor.rgb = mix(diffuseColor.rgb, pc, max(pave, plaza * land));
}`);
    };
    this.groundMat.customProgramCacheKey = () => 'palimpsest-city-ground-v1';
    this.railHide = new Uint8Array(this.L.slots.length);
    this.setTheme(this.opts.theme);
  }

  setTheme(t: 'light' | 'dark') {
    this.opts.theme = t;
    this.waterMat.color.set(t === 'dark' ? 0x3f6f86 : 0x6f9db2);
    this.waterMat.opacity = t === 'dark' ? 0.86 : 0.78;
    // dusk in the dark theme: everything a shade deeper, the ground most
    this.mat.color.setScalar(t === 'dark' ? 0.88 : 1);
    this.groundMat.color.setScalar(t === 'dark' ? 0.78 : 1);
    if (this.side) this.paintSide();
  }

  // ---------------------------------------------------------------- the year
  /** Rebuild for a year. Returns false when nothing visible changed. */
  setYear(year: number): boolean {
    const t0 = performance.now();
    const rec = this.rec, L = this.L;
    let cy = cityAt(rec, year);
    if (this.opts.beforeSack && cy.sack && cy.sack.year === cy.year) cy = { ...cy, sack: sackBefore(rec, cy.year) };
    const prev = this.cy;
    if (prev && prev.year === cy.year) return false;
    this.cy = cy;
    const nShow = Math.max(cy.n, cy.nPeak);
    const townR = Math.max(L.plazaR + 1, L.radiusAt(Math.max(nShow, cy.phase === 'ruin' ? cy.nPeak : 0)));
    // the plinth grows in steps, so the ground is repainted only now and then
    // past about 78 lots the plinth stops growing: a great city runs off its edges, like a diorama of its middle
    let level = 0;
    while (level < MAX_LEVEL && 14 * Math.pow(1.24, level) < townR * 1.3 + 4) level++;
    const age = cy.age;
    const bucket = age < 2 ? 0 : age < 5 ? 1 : 2;
    if (level !== this.level) {
      this.level = level;
      this.P = 14 * Math.pow(1.24, level);
      this.paintedAge = bucket;
      this.buildGround(age);
      this.plantTrees();
    } else if (bucket !== this.paintedAge) {
      this.paintedAge = bucket;
      this.repaint(age);
    }
    this.uniforms.uPaveK.value = cy.phase === 'ruin' ? Math.max(0, 0.85 - cy.ruinAge / 500) : 1;
    const st = ageStyle(age);
    (this.uniforms.uPave.value as Color).setRGB(...st.pave, SRGBColorSpace);
    (this.uniforms.uPlaza.value as Color).setRGB(...shade(st.pave, 1.08), SRGBColorSpace);

    const parts = this.parts;
    parts.reset();
    this.anchors = [];
    this.smoke = [];
    this.town.fill(0);
    const rail = age >= 5 && cy.phase === 'living' ? this.railPlan(townR) : null;
    this.houses(cy, townR, rail);
    this.smoothTown(cy);
    this.temple(cy);
    this.palace(cy);
    this.walls(cy);
    this.harbour(cy, townR);
    this.bridges(cy, townR);
    if (rail) this.railway(cy, rail);
    this.forest(cy);
    parts.commit();
    this.puffsAt(0);
    this.stats.parts = parts.count();
    this.stats.build = performance.now() - t0;
    return true;
  }

  /** Smoke drifts (t in seconds); reduced motion passes a fixed t. */
  puffsAt(t: number) {
    const p = this.puffs;
    p.reset();
    const grey = hex('#cfcac1'), dark = hex('#4d4843'), soot = hex('#2c2926');
    for (const s of this.smoke) {
      for (let j = 0; j < 5; j++) {
        const f = (t * 0.11 * (0.8 + 0.4 * s.seed) + s.seed + j / 5) % 1;
        const k = s.k * (0.5 + 1.3 * f) * (1 - f * f * f);
        const c = s.dark ? mix(soot, dark, f) : mix(dark, grey, 0.3 + f * 0.7);
        p.add('ball', s.x + f * 1.6 * s.k, s.y + f * 3 * s.k, s.z + f * 0.7 * s.k, s.seed * 6, k, k * 0.85, k, c);
      }
    }
    p.commit();
  }

  // ---------------------------------------------------------------- houses
  private ageOf(y: number): number {
    const T = this.T;
    return T.age[clamp(Math.round(y) - T.y0, 0, T.age.length - 1)];
  }
  private cultureOf(y: number): number {
    const T = this.T;
    return T.culture[clamp(Math.round(y) - T.y0, 0, T.culture.length - 1)];
  }

  private railPlan(townR: number) {
    const L = this.L;
    const a = L.railAng;
    const ds = L.plazaR + 2.6 + 0.22 * townR;
    const dx = Math.cos(a), dz = Math.sin(a);
    this.railHide.fill(0);
    L.slots.forEach((s, i) => {
      const along = s.x * dx + s.z * dz;
      if (along < ds - 2.2) return;
      if (Math.abs(-s.x * dz + s.z * dx) < (along < ds + 2 ? 1.6 : 0.85)) this.railHide[i] = 1;
    });
    return { a, ds, dx, dz };
  }

  private houses(cy: CityYear, townR: number, rail: { a: number } | null) {
    const L = this.L, rec = this.rec, parts = this.parts;
    const yr = cy.year;
    const n = cy.n, peak = Math.max(cy.nPeak, n);
    const popK = clamp(Math.log10(Math.max(1, cy.pop) / 20000), 0, 2.2);
    // a sack: burnt quarters toward where the attackers broke in, fading as the city rebuilds
    const sackDir = cy.sack ? unit(`${rec.id}:sack:${cy.sack.year}`) * TAU : 0;
    const burnK = cy.sack ? 0.5 * Math.pow(1 - cy.sack.ago / (SACK_YEARS + 1), 0.8) : 0;
    let smokes = 0;
    let houses = 0;
    const ruinAge = cy.ruinAge;
    for (let i = 0; i < peak && i < L.slots.length; i++) {
      const s = L.slots[i];
      if (rail && this.railHide[i]) continue;
      if (s.r > this.P - 0.9) continue;
      const standing = i < n;
      const age = this.ageOf(yr - s.lag);
      const st = ageStyle(age);
      const fw = clamp(s.w * lerp(st.foot[0], st.foot[1], s.h1) * 1.42, 0.45, 0.97);
      const fd = clamp(s.d * lerp(st.foot[0], st.foot[1], s.h2) * 1.42, 0.45, 0.97);
      const centre = Math.exp(-s.r / Math.max(3, 0.32 * townR));
      let h = lerp(st.h[0], st.h[1], s.h3) * (1 + 0.12 * popK) * (age >= 3 ? 1 + 0.45 * centre : 1);
      const wall = vary(st.walls[Math.floor(s.h2 * st.walls.length) % st.walls.length], s.h3, 0.09);
      if (standing && cy.phase === 'living') {
        this.townAt(s, 0.95);
        houses++;
        const burnt = burnK > 0 && (0.5 + 0.5 * Math.cos(s.ang - sackDir)) * 0.9 + 0.35 * s.h2 > 1.2 - burnK;
        if (burnt) {
          // roofless shells: two scorched walls left standing, embers while the fire is fresh
          const hb = h * (0.4 + 0.45 * s.h1);
          const cs = Math.cos(s.rot), sn = Math.sin(s.rot);
          parts.add('box', s.x, 0, s.z, s.rot, fw, 0.08, fd, ASH);
          parts.add('box', s.x - sn * fd * 0.42, 0, s.z - cs * fd * 0.42, s.rot, fw, hb, 0.1, CHARCOAL);
          parts.add('box', s.x + cs * fw * 0.42, 0, s.z - sn * fw * 0.42, s.rot, 0.1, hb * (0.5 + 0.5 * s.h2), fd, CHARCOAL);
          if (cy.sack!.ago <= 1 && s.h3 < 0.35) parts.add('box', s.x, 0.06, s.z, s.rot + 0.5, fw * 0.4, 0.1, fd * 0.35, EMBER);
          if (cy.sack!.ago <= 2 && smokes < 16 && s.h3 < 0.3) { this.smoke.push({ x: s.x, y: hb, z: s.z, k: 1.4 * Math.max(1, Math.sqrt(this.P / 30)), seed: s.h1, dark: true }); smokes++; }
          continue;
        }
        const culture = this.cultureOf(yr - s.lag * 0.6);
        const roof = vary(mix(st.roofBase, roofOfCulture(culture), st.roofK), s.h1, 0.12);
        // the works, with their chimneys, in the age of engines
        if (age >= 5 && s.r > 0.42 * townR && angDist(s.ang, L.industryAng) < 0.62 && s.h1 < 0.55) {
          this.factory(s, age, fw, fd);
          continue;
        }
        // towers in the middle of a modern city
        if (age >= 6 && s.r < 0.34 * townR) {
          const k = 1 - s.r / (0.34 * townR);
          const th = 1.6 + (2 + 14 * s.h1 * s.h1) * k * (0.6 + 0.4 * popK / 2.2);
          const glass = s.h2 < 0.55;
          parts.add('box', s.x, 0, s.z, s.rot, fw * 0.92, th, fd * 0.92, glass ? vary(hex('#8ea6b4'), s.h3, 0.1) : wall);
          parts.add('box', s.x, th, s.z, s.rot, fw * 0.7, 0.12, fd * 0.7, hex('#6f7378'));
          continue;
        }
        this.house(s, age, fw, fd, h, wall, roof, s.r > 0.8 * townR);
      } else if (cy.phase === 'ruin') {
        // ruins: fewer standing as the centuries pass, and greener
        if (s.h1 > 0.92 * Math.exp(-ruinAge / 900)) continue;
        const green = clamp(ruinAge / 700, 0, 0.7);
        parts.add('box', s.x, 0, s.z, s.rot, fw * 0.9, h * (0.15 + 0.32 * s.h2), fd * 0.9, mix(vary(RUIN, s.h3, 0.08), MOSS, green * (0.5 + 0.5 * s.h3)));
        this.townAt(s, 0.6);
      } else {
        // empty houses: the city has shrunk from its size in the last century and a half
        parts.add('box', s.x, 0, s.z, s.rot, fw * 0.92, h * (0.22 + 0.25 * s.h2), fd * 0.92, mix(vary(RUIN, s.h3, 0.08), MOSS, 0.35));
        this.townAt(s, 0.4);
      }
    }
    this.stats.houses = houses;
  }

  private house(s: Slot, age: number, fw: number, fd: number, h: number, wall: RGB, roof: RGB, outskirts: boolean) {
    const p = this.parts;
    const { x, z, rot } = s;
    switch (age) {
      case 0: {
        if (outskirts && s.h1 < 0.55) {
          // reed huts at the edge of a Bronze Age town
          p.add('dome', x, 0, z, rot, fw * 0.8, h * 1.1, fw * 0.8, vary(hex('#c8ad74'), s.h2, 0.1));
          return;
        }
        p.add('box', x, 0, z, rot, fw, h, fd, wall);
        p.add('box', x, h, z, rot, fw * 1.03, 0.05, fd * 1.03, roof);
        if (s.h2 > 0.72) p.add('box', x - 0.08, h, z - 0.06, rot, fw * 0.5, h * 0.55, fd * 0.55, shade(wall, 1.04));
        return;
      }
      case 1: {
        if (outskirts && s.h1 < 0.4) {
          // roundhouses
          p.add('cyl', x, 0, z, rot, fw * 0.85, h * 0.8, fw * 0.85, wall);
          p.add('cone', x, h * 0.8, z, rot, fw * 1.05, h * 0.9, fw * 1.05, roof);
          return;
        }
        p.add('box', x, 0, z, rot, fw, h, fd, wall);
        p.add('gable', x, h, z, rot, fw * 1.08, fw * 0.42, fd * 1.08, roof);
        return;
      }
      case 2:
        p.add('box', x, 0, z, rot, fw, h, fd, wall);
        p.add('pyr', x, h, z, rot, fw * 1.1, Math.min(fw, fd) * 0.32, fd * 1.1, roof);
        return;
      case 3: {
        const long = fd > fw;
        p.add('box', x, 0, z, rot, fw, h, fd, wall);
        p.add('gable', x, h, z, long ? rot + Math.PI / 2 : rot, (long ? fd : fw) * 1.06, Math.min(fw, fd) * 0.68, (long ? fw : fd) * 1.08, roof);
        return;
      }
      case 4:
        p.add('box', x, 0, z, rot, fw, h, fd, wall);
        p.add('frustum', x, h, z, rot, fw * 1.02, 0.34, fd * 1.02, roof);
        if (s.h3 > 0.8) p.add('box', x + fw * 0.25, h + 0.2, z, rot, 0.08, 0.3, 0.12, shade(wall, 0.85));
        return;
      case 5:
        p.add('box', x, 0, z, rot, fw, h, fd, wall);
        p.add('gable', x, h, z, rot, fw * 1.04, 0.28, fd * 1.04, roof);
        if (s.h3 > 0.55) p.add('box', x - fw * 0.3, h, z, rot, 0.09, 0.42, 0.09, shade(wall, 0.8));
        return;
      default: {
        const hh = h * (0.8 + 0.6 * s.h3);
        p.add('box', x, 0, z, rot, fw, hh, fd, wall);
        p.add('box', x, hh, z, rot, fw * 0.92, 0.06, fd * 0.92, shade(wall, 0.82));
      }
    }
  }

  private factory(s: Slot, age: number, fw: number, fd: number) {
    const p = this.parts;
    const ks = Math.max(1, Math.sqrt(this.P / 30));
    const brick = vary(age >= 6 ? hex('#b5b0a6') : hex('#8b5644'), s.h3, 0.1);
    const roof = age >= 6 ? hex('#9aa0a4') : hex('#4f565e');
    const w = Math.max(fw, 0.9), d = Math.max(fd, 0.9), h = 0.7;
    p.add('box', s.x, 0, s.z, s.rot, w, h, d, brick);
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * (d / 3);
      const cs = Math.cos(s.rot), sn = Math.sin(s.rot);
      p.add('wedge', s.x + sn * off, h, s.z + cs * off, s.rot, w, 0.28, d / 3, roof);
    }
    if (s.h2 < 0.45) {
      const ch = (2.1 + 1.6 * s.h3) * ks;
      p.add('cyl', s.x + 0.3, 0, s.z + 0.25, 0, 0.22 * ks, ch, 0.22 * ks, shade(brick, 0.8));
      p.add('cyl', s.x + 0.3, ch - 0.15 * ks, s.z + 0.25, 0, 0.3 * ks, 0.15 * ks, 0.3 * ks, shade(brick, 0.65));
      if (age === 5 && s.h3 < 0.7) this.smoke.push({ x: s.x + 0.3, y: ch, z: s.z + 0.25, k: 0.6 * ks, seed: s.h1 });
    }
  }

  /** The town's extent per sector, for the paving under it. */
  private townAt(s: Slot, k: number) {
    const v = s.r + 0.95 * k;
    if (v > this.town[s.sector]) this.town[s.sector] = v;
  }
  private smoothTown(cy: CityYear) {
    const t = this.town;
    const base = cy.phase === 'site' ? 0 : this.L.plazaR + 0.6;
    const out = new Float32Array(SECTORS);
    for (let i = 0; i < SECTORS; i++) {
      const a = t[(i + SECTORS - 1) % SECTORS], b = t[i], c = t[(i + 1) % SECTORS];
      out[i] = Math.max(base, b, 0.92 * Math.max(a, c), (a + b + c) / 3);
    }
    for (let i = 0; i < SECTORS; i++) t[i] = out[i];
    t[SECTORS] = t[0];
  }

  // ---------------------------------------------------------------- temple
  private temple(cy: CityYear) {
    if (cy.phase === 'site') return;
    const rec = this.rec;
    const ruin = cy.phase === 'ruin';
    const form: TempleForm | 'shrine' = ruin ? (this.lastForm() ?? 'shrine') : cy.form ?? 'shrine';
    const age = cy.age;
    const pop = ruin ? popAt(rec, rec.end).pop : cy.pop;
    const k = clamp(0.62 + 0.24 * Math.log10(Math.max(1, pop) / 2500), 0.5, 1.12) * (this.L.plazaR / 2.6);
    const st = ageStyle(age);
    const faith = ruin ? -1 : cy.faith;
    const metal = metalOf(faith, rec.id) === 0 ? GOLD : SILVER;
    const stone = st.stone;
    const roof = mix(st.roofBase, roofOfCulture(cy.culture), Math.max(0.5, st.roofK));
    const burnt = !!cy.sack && cy.sack.ago <= 6;
    const sooty = (c: RGB) => (ruin ? mix(c, MOSS, clamp(cy.ruinAge / 900, 0.15, 0.55)) : burnt ? mix(c, CHARCOAL, 0.45) : c);
    const lost = ruin || burnt; // roofs, domes and spires fall
    const S = ruin ? Math.max(0.35, 0.8 - cy.ruinAge / 3000) : 1;
    const p = this.parts;
    const a0 = -this.L.roads[0] || 0;
    let top = 1.5 * k;
    const put = (kind: Kind, x: number, y: number, z: number, w: number, h: number, d: number, c: RGB, rot = a0) => {
      const cs = Math.cos(a0), sn = Math.sin(a0);
      p.add(kind, x * cs + z * sn, y * S, -x * sn + z * cs, rot, w, h * S, d, sooty(c));
    };
    const v = hash(`mov:${faith}:variant`);
    switch (form) {
      case 'ziggurat': {
        const tiers = age >= 1 ? 4 : 3;
        let y = 0;
        for (let i = 0; i < tiers; i++) {
          const s = 3.3 * k * (1 - i * 0.2);
          const h = 0.62 * k * (1 - i * 0.08);
          put('box', 0, y, 0, s, h, s, shade(stone, 1 - i * 0.03));
          y += h;
        }
        for (let j = 0; j < 4; j++) put('box', 0, 0, 1.65 * k + 0.2 * k - j * 0.3 * k, 0.55 * k, (j + 1) * 0.42 * k, 0.4 * k, shade(stone, 0.93));
        if (!lost) put('box', 0, y, 0, 0.8 * k, 0.55 * k, 0.8 * k, age >= 1 ? hex('#3f6f9e') : metal);
        top = y + 0.6 * k;
        break;
      }
      case 'domed': {
        put('box', 0, 0, 0, 2.7 * k, 1.05 * k, 2.7 * k, stone);
        put('cyl', 0, 1.05 * k, 0, 1.6 * k, 0.42 * k, 1.6 * k, shade(stone, 1.03));
        const domeC = v % 3 === 0 ? hex('#4f9a94') : v % 3 === 1 ? metal : hex('#b9c2c4');
        if (!lost) {
          put('dome', 0, 1.47 * k, 0, 1.75 * k, 1.25 * k, 1.75 * k, domeC);
          put('cone', 0, 2.68 * k, 0, 0.16 * k, 0.5 * k, 0.16 * k, metal);
        }
        const towers = [0, 2, 4][v % 3];
        for (let i = 0; i < towers; i++) {
          const ang = (i / towers) * TAU + Math.PI / 4;
          const x = Math.cos(ang) * 1.75 * k, z = Math.sin(ang) * 1.75 * k;
          put('cyl', x, 0, z, 0.3 * k, 2.8 * k, 0.3 * k, shade(stone, 1.02));
          if (!lost) put('cone', x, 2.8 * k, z, 0.4 * k, 0.6 * k, 0.4 * k, domeC);
        }
        top = 3.1 * k;
        break;
      }
      case 'spired': {
        if (age <= 1) {
          // before dressed stone: a tower shrine with a pointed cap, and its forecourt hall
          put('box', 0, 0, -0.4 * k, 2.4 * k, 0.9 * k, 1.8 * k, stone);
          put('box', 0, 0, 0.9 * k, 1.2 * k, 2.6 * k, 1.2 * k, shade(stone, 1.04));
          if (!lost) put('pyr', 0, 2.6 * k, 0.9 * k, 1.25 * k, 1.5 * k, 1.25 * k, metal);
          top = (lost ? 2.7 : 4.2) * k;
          break;
        }
        put('box', 0, 0, 0, 1.25 * k, 1.35 * k, 3.1 * k, stone);
        put('box', 0, 0, -0.35 * k, 2.6 * k, 1.2 * k, 1.0 * k, stone);
        if (!lost) {
          put('gable', 0, 1.35 * k, 0, 3.15 * k, 0.8 * k, 1.3 * k, roof, a0 + Math.PI / 2);
          put('gable', 0, 1.2 * k, -0.35 * k, 2.65 * k, 0.72 * k, 1.04 * k, roof);
        }
        put('box', 0, 0, 1.75 * k, 0.95 * k, 2.6 * k, 0.95 * k, shade(stone, 1.03));
        if (!lost) put('pyr', 0, 2.6 * k, 1.75 * k, 0.98 * k, 2.2 * k, 0.98 * k, v % 2 ? metal : shade(roof, 0.8));
        top = 4.8 * k;
        break;
      }
      case 'pagoda': {
        put('box', 0, 0, 0, 2.9 * k, 0.32 * k, 2.9 * k, shade(stone, 0.95));
        const tiers = age >= 3 ? 7 : 5;
        let y = 0.32 * k;
        for (let i = 0; i < tiers; i++) {
          const s = 1.55 * k * (1 - i * 0.09);
          put('box', 0, y, 0, s, 0.4 * k, s, i === 0 ? hex('#a8443a') : stone);
          if (!lost || i < 2) put('frustum', 0, y + 0.36 * k, 0, s * 1.5, 0.3 * k, s * 1.5, roof);
          y += 0.62 * k;
        }
        if (!lost) put('cone', 0, y, 0, 0.18 * k, 0.9 * k, 0.18 * k, metal);
        top = y + 0.9 * k;
        break;
      }
      case 'columned': {
        put('box', 0, 0, 0, 2.3 * k, 0.36 * k, 3.4 * k, shade(stone, 0.97));
        put('box', 0, 0.36 * k, 0, 1.25 * k, 1.05 * k, 2.2 * k, shade(stone, 0.94));
        const cols: [number, number][] = [];
        for (let i = 0; i < 6; i++) { const zz = (-1.45 + i * 0.58) * k; cols.push([-0.95 * k, zz], [0.95 * k, zz]); }
        for (let i = 1; i < 3; i++) { const xx = (-0.95 + i * 0.633) * k; cols.push([xx, -1.45 * k], [xx, 1.45 * k]); }
        cols.forEach(([x, z], i) => { if (!ruin || hash(`${rec.id}:col:${i}`) % 3) put('cyl', x, 0.36 * k, z, 0.2 * k, 1.12 * k, 0.2 * k, SILVER); });
        if (!lost) put('gable', 0, 1.48 * k, 0, 3.45 * k, 0.55 * k, 2.25 * k, roof, a0 + Math.PI / 2);
        top = 2.2 * k;
        break;
      }
      case 'stupa': {
        put('box', 0, 0, 0, 3.1 * k, 0.36 * k, 3.1 * k, shade(stone, 0.95));
        put('cyl', 0, 0.36 * k, 0, 2.2 * k, 0.35 * k, 2.2 * k, SILVER);
        if (!lost) {
          put('dome', 0, 0.7 * k, 0, 2.0 * k, 1.5 * k, 2.0 * k, SILVER);
          put('box', 0, 2.15 * k, 0, 0.45 * k, 0.3 * k, 0.45 * k, metal);
          put('cone', 0, 2.45 * k, 0, 0.36 * k, 1.3 * k, 0.36 * k, metal);
        }
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * TAU + Math.PI / 4;
          put('dome', Math.cos(ang) * 1.3 * k, 0.36 * k, Math.sin(ang) * 1.3 * k, 0.45 * k, 0.5 * k, 0.45 * k, SILVER);
        }
        top = 3.6 * k;
        break;
      }
      case 'hall': {
        if (age <= 4) {
          put('box', 0, 0, 0, 3.4 * k, 0.3 * k, 1.8 * k, shade(stone, 0.96));
          put('box', 0, 0.3 * k, -0.25 * k, 3.1 * k, 1.0 * k, 1.0 * k, stone);
          for (let i = 0; i < 8; i++) put('cyl', (-1.45 + i * 0.414) * k, 0.3 * k, 0.55 * k, 0.16 * k, 0.95 * k, 0.16 * k, SILVER);
          if (!lost) put('box', 0, 1.25 * k, 0, 3.3 * k, 0.16 * k, 1.75 * k, roof);
          top = 1.8 * k;
        } else {
          put('box', 0, 0, -0.5 * k, 3.2 * k, 1.5 * k, 1.3 * k, stone);
          put('box', 0, 1.5 * k, -0.5 * k, 3.0 * k, 0.1 * k, 1.1 * k, shade(stone, 0.85));
          put('box', 0, 0, 1.0 * k, 0.5 * k, 0.35 * k, 0.5 * k, shade(stone, 0.9));
          put('box', 0, 0.35 * k, 1.0 * k, 0.24 * k, 2.6 * k, 0.24 * k, shade(stone, 1.04));
          put('pyr', 0, 2.95 * k, 1.0 * k, 0.24 * k, 0.3 * k, 0.24 * k, metal);
          top = 3.3 * k;
        }
        break;
      }
      default: {
        // no state faith on record: a shrine and an open square
        put('box', 0, 0, 0, 0.9 * k, 0.6 * k, 0.9 * k, stone);
        put('pyr', 0, 0.6 * k, 0, 1.0 * k, 0.45 * k, 1.0 * k, roof);
        top = 1.2 * k;
      }
    }
    if (lost) top *= 0.7;
    if (!ruin && cy.faith >= 0) {
      const f = rec.faiths[cy.faith];
      this.anchors.push({ key: 'temple', kicker: form === 'hall' ? (f?.[1] === 'ideology' ? 'Hall of' : 'School of') : 'Temple of', text: f?.[0] ?? '', x: 0, y: top * S, z: 0 });
    }
  }

  private lastForm(): TempleForm | null {
    const rec = this.rec;
    return cityAt(rec, rec.end - 1).form;
  }

  // ---------------------------------------------------------------- palace
  private palace(cy: CityYear) {
    const P = this.L.palace;
    if (!P || !cy.capital || cy.phase !== 'living') return;
    const rec = this.rec;
    const age = cy.age;
    const st = ageStyle(age);
    const k = clamp(0.8 + 0.1 * Math.log10(Math.max(1, cy.pop) / 5000), 0.75, 1);
    // drawn in the units of a 3.4 × 2.5-lot palace, scaled to the site the layout reserved
    const f = P.w / 3.4;
    const W = 3.4 * k, D = 2.5 * k;
    const flagC = hex(rec.polities[cy.capital.polity]?.color ?? '#8e2f1f');
    const roof = mix(st.roofBase, roofOfCulture(cy.culture), Math.max(0.55, st.roofK));
    const stone = shade(st.stone, 0.98);
    const burnt = !!cy.sack && cy.sack.ago <= 4;
    const tone = (c: RGB) => (burnt ? mix(c, CHARCOAL, 0.4) : c);
    const p = this.parts;
    const cs = Math.cos(P.rot), sn = Math.sin(P.rot);
    // local (u along the radius, v across) → world
    const put = (kind: Kind, u: number, y: number, v: number, w: number, h: number, d: number, c: RGB, rot = 0) =>
      p.add(kind, P.x + (u * cs + v * sn) * f, y * f, P.z + (-u * sn + v * cs) * f, P.rot + rot, w * f, h * f, d * f, tone(c));
    let top = 1.5;
    if (age <= 1) {
      put('box', 0, 0, 0, W, 0.35, D, shade(stone, 0.95));
      put('box', 0.1 * W, 0.35, 0, 0.7 * W, 0.75, 0.62 * D, stone);
      put('box', 0.1 * W, 1.1, 0, 0.74 * W, 0.07, 0.66 * D, roof);
      for (const v of [-0.38, 0.38]) put('box', -0.4 * W, 0.35, v * D, 0.42, 1.25, 0.42, shade(stone, 1.03));
      top = 1.7;
    } else if (age === 2) {
      put('box', 0, 0, 0, W, 0.3, D, shade(stone, 0.95));
      put('box', 0.12 * W, 0.3, 0, 0.66 * W, 0.95, 0.8 * D, stone);
      if (!burnt) put('pyr', 0.12 * W, 1.25, 0, 0.72 * W, 0.45, 0.86 * D, roof);
      for (let i = 0; i < 6; i++) put('cyl', -0.3 * W, 0.3, (-0.4 + i * 0.16) * D, 0.14, 0.9, 0.14, SILVER);
      top = 1.9;
    } else if (age === 3) {
      for (const [u, v, w, d] of [[-0.5, 0, 0.12, 1], [0.5, 0, 0.12, 1], [0, -0.5, 1, 0.12], [0, 0.5, 1, 0.12]]) put('box', u * W, 0, v * D, w * W, 0.8, d * D, stone);
      put('box', 0.1 * W, 0, 0, 0.36 * W, 2.0, 0.42 * D, shade(stone, 1.03));
      for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        put('cyl', u * W, 0, v * D, 0.6, 1.35, 0.6, shade(stone, 1.02));
        if (!burnt) put('cone', u * W, 1.35, v * D, 0.72, 0.65, 0.72, roof);
      }
      top = 2.3;
    } else if (age === 4) {
      put('box', 0.18 * W, 0, 0, 0.42 * W, 1.15, D, stone);
      put('box', -0.18 * W, 0, -0.4 * D, 0.5 * W, 1.0, 0.22 * D, stone);
      put('box', -0.18 * W, 0, 0.4 * D, 0.5 * W, 1.0, 0.22 * D, stone);
      if (!burnt) {
        put('frustum', 0.18 * W, 1.15, 0, 0.44 * W, 0.4, D * 1.01, hex('#59606a'));
        put('cyl', 0.18 * W, 1.15, 0, 0.62, 0.35, 0.62, stone);
        put('dome', 0.18 * W, 1.5, 0, 0.62, 0.55, 0.62, hex('#6f9c92'));
      }
      top = 2.2;
    } else {
      put('box', 0.1 * W, 0, 0, 0.55 * W, 1.45, D, stone);
      put('box', 0.1 * W, 1.45, 0, 0.5 * W, 0.08, 0.95 * D, shade(stone, 0.86));
      put('box', -0.3 * W, 0, 0, 0.45, 3.1, 0.45, shade(stone, 1.03));
      if (!burnt) put('pyr', -0.3 * W, 3.1, 0, 0.5, 0.55, 0.5, hex('#59606a'));
      top = 3.7;
    }
    // the master's colours
    put('cyl', -0.1 * W, top - 0.2, 0, 0.05, 1.0, 0.05, hex('#3b3430'));
    put('box', -0.1 * W + 0.24, top + 0.48, 0, 0.46, 0.28, 0.03, flagC);
    this.anchors.push({ key: 'palace', kicker: 'Palace of', text: polityName(rec, cy.capital.polity, cy.year), x: P.x, y: (top + 0.8) * f, z: P.z });
  }

  // ---------------------------------------------------------------- walls
  private ringFor(since: number): number {
    let r = this.wallRing.get(since);
    if (r === undefined) {
      const L = this.L;
      const need = L.radiusAt(buildingsFor(popAt(this.rec, since).pop)) + 0.4;
      r = L.rings.find((x) => x >= need) ?? L.rings[L.rings.length - 1];
      this.wallRing.set(since, r);
    }
    return r;
  }

  private walls(cy: CityYear) {
    const L = this.L, rec = this.rec, p = this.parts;
    if (cy.phase !== 'living') return;
    if (!cy.walls) {
      // the walls' line as a boulevard of trees once the age of engines has pulled them down
      if (cy.age >= 5) {
        let since = -1;
        for (const [a] of rec.capitals) if (a < cy.year && this.ageOf(a) < 5) since = capitalSince(rec, a);
        if (since >= 0) {
          const R = this.ringFor(since);
          const n = Math.ceil((TAU * R) / 1.25);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU;
            const x = Math.cos(a) * R, z = Math.sin(a) * R;
            if (waterAt(L, x, z, 0.4) || nearRoad(L, x, z, 0.8)) continue;
            const hh = hash(`${rec.id}:blv:${i}`) / 4294967296;
            p.add('cyl', x, 0, z, 0, 0.07, 0.3, 0.07, hex('#5b4a3a'));
            p.add('ball', x, 0.25, z, hh * 6, 0.55, 0.65, 0.55, vary(hex('#5f7f48'), hh, 0.12));
          }
        }
      }
      return;
    }
    const R = this.ringFor(cy.walls.since);
    const age = Math.min(cy.age, 4);
    const st = ageStyle(age);
    const H = [0.85, 1.0, 1.1, 1.25, 0.8][age];
    const T = age === 4 ? 0.62 : 0.42;
    const col = shade(st.wall, 1);
    const roof = mix(st.roofBase, roofOfCulture(cy.culture), 0.85);
    const n = Math.max(16, Math.ceil((TAU * R) / 1.5));
    const sackDir = cy.sack ? unit(`${rec.id}:sack:${cy.sack.year}`) * TAU : 0;
    const breachK = cy.sack ? Math.pow(1 - cy.sack.ago / (SACK_YEARS + 1), 0.6) : 0;
    const crenels = n < 140 && age <= 3;
    const pt = (i: number): [number, number] => [Math.cos((i / n) * TAU) * R, Math.sin((i / n) * TAU) * R];
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pt(i), [x1, z1] = pt(i + 1);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const ma = ((i + 0.5) / n) * TAU;
      const hi = hash(`${rec.id}:wall:${i}`) / 4294967296;
      const breach = breachK > 0 && Math.cos(ma - sackDir) > 0.45 && hi < 0.75 * breachK;
      const wet = waterAt(L, mx, mz, 0.25) !== 0;
      const gate = nearRoad(L, mx, mz, 0.9);
      if (!wet && !gate) {
        if (breach) {
          if (hi < 0.35 * breachK) p.span('box', x0, z0, x1, z1, 0, H * 0.35, T, mix(col, CHARCOAL, 0.25), 0.04);
        } else {
          p.span('box', x0, z0, x1, z1, 0, H, T, col, 0.04);
          if (crenels) {
            for (const f of [0.2, 0.5, 0.8]) p.add('box', x0 + (x1 - x0) * f, H, z0 + (z1 - z0) * f, -ma, 0.18, 0.16, T * 0.9, col);
          }
        }
      }
      // towers: every third post, and on both sides of each gate
      const [tx, tz] = pt(i);
      const tWet = waterAt(L, tx, tz, 0.2) !== 0;
      const nextGate = nearRoad(L, (x1 + pt(i + 2)[0]) / 2, (z1 + pt(i + 2)[1]) / 2, 0.9);
      const prevGate = nearRoad(L, (pt(i - 1)[0] + x0) / 2, (pt(i - 1)[1] + z0) / 2, 0.9);
      const isGate = !gate && (nextGate || prevGate);
      if (tWet || (i % 3 && !isGate)) continue;
      const broken = breachK > 0 && Math.cos((i / n) * TAU - sackDir) > 0.45 && hi < 0.6 * breachK;
      const th = (H + (isGate ? 0.75 : 0.45)) * (broken ? 0.45 : 1);
      if (age === 4) {
        if (i % 6 === 0 || isGate) {
          const ox = Math.cos((i / n) * TAU) * 0.55, oz = Math.sin((i / n) * TAU) * 0.55;
          p.add('box', tx + ox, 0, tz + oz, -(i / n) * TAU + Math.PI / 4, 1.5, H * (broken ? 0.5 : 1), 1.5, shade(col, 0.96));
        }
      } else if (age === 3) {
        p.add('cyl', tx, 0, tz, 0, 0.82, th, 0.82, shade(col, 1.03));
        if (!broken) p.add('cone', tx, th, tz, 0, 0.94, 0.62, 0.94, roof);
      } else {
        p.add('box', tx, 0, tz, -(i / n) * TAU, 0.8, th, 0.8, shade(col, 1.04));
      }
    }
    let la = Math.PI * 1.25;
    for (let d = 0; d < Math.PI; d += 0.1) {
      if (!waterAt(L, Math.cos(la + d) * R, Math.sin(la + d) * R, 1)) { la += d; break; }
      if (!waterAt(L, Math.cos(la - d) * R, Math.sin(la - d) * R, 1)) { la -= d; break; }
    }
    this.anchors.push({ key: 'walls', kicker: 'Walls', text: `since AY ${cy.walls.since}`, x: Math.cos(la) * R, y: H + 0.6, z: Math.sin(la) * R });
  }

  // ---------------------------------------------------------------- harbour and boats
  private harbour(cy: CityYear, townR: number) {
    const L = this.L, rec = this.rec, p = this.parts;
    const c = L.coast;
    if (!c || !rec.port || cy.phase === 'site') return;
    const ruin = cy.phase === 'ruin';
    const age = cy.age;
    const perp: [number, number] = [-c.cz, c.cx];
    const at = (t: number, depth: number): [number, number] => {
      const s = shoreAt(L, t) + depth;
      return [c.cx * s + perp[0] * t, c.cz * s + perp[1] * t];
    };
    const hk = clamp(townR / 20, 1, 2.6);
    const Lq = clamp(0.55 * townR, 3, this.P * 0.8);
    const timber = hex('#8a6a4c');
    const quayC = age <= 1 ? timber : ageStyle(age).stone;
    // the quay along the shore
    if (age >= 2) {
      for (let t = -Lq; t < Lq; t += 1.2) {
        const [x0, z0] = at(t, -0.15), [x1, z1] = at(t + 1.2, -0.15);
        if (Math.hypot(x0, z0) > this.P - 1) continue;
        p.span('box', x0, z0, x1, z1, -0.55, 0.62, 1.1, shade(quayC, 0.95), 0.05);
      }
    }
    // piers
    const nP = clamp(1 + Math.floor(Lq / (4.5 * hk)), 1, 8);
    const pierLen = [1.6, 2.1, 2.6, 2.8, 3.4, 4.2, 4.8][age] * hk;
    const piers: { x: number; z: number; t: number }[] = [];
    for (let i = 0; i < nP; i++) {
      const t = nP === 1 ? 0 : -Lq * 0.75 + (i / (nP - 1)) * Lq * 1.5;
      const [x0, z0] = at(t, -0.3);
      const x1 = x0 + c.cx * pierLen, z1 = z0 + c.cz * pierLen;
      if (Math.hypot(x1, z1) > this.P - 0.8) continue;
      const broken = ruin && hash(`${rec.id}:pier:${i}`) % 2 === 0;
      p.span('box', x0, z0, broken ? (x0 + x1) / 2 : x1, broken ? (z0 + z1) / 2 : z1, -0.5, 0.56, (age <= 2 ? 0.42 : 0.6) * Math.sqrt(hk), age <= 2 ? timber : shade(quayC, 0.92));
      piers.push({ x: x1, z: z1, t });
      // cranes from the age of engines
      if (!ruin && age >= 5 && i % 2 === 0) {
        const cx = x0 + c.cx * pierLen * 0.6, cz = z0 + c.cz * pierLen * 0.6;
        const crane = age >= 6 ? hex('#c4572e') : hex('#4f4741');
        if (age >= 6) {
          for (const s of [-0.35, 0.35]) p.add('box', cx + perp[0] * s * hk, 0.06, cz + perp[1] * s * hk, 0, 0.12 * hk, 2.3 * hk, 0.12 * hk, crane);
          p.add('box', cx + c.cx * 0.6 * hk, 2.3 * hk, cz + c.cz * 0.6 * hk, -Math.atan2(c.cz, c.cx), 2.6 * hk, 0.2 * hk, 0.9 * hk, crane);
        } else {
          p.add('box', cx, 0.06, cz, 0, 0.16 * hk, 1.7 * hk, 0.16 * hk, crane);
          p.add('box', cx + c.cx * 0.5 * hk, 1.7 * hk, cz + c.cz * 0.5 * hk, -Math.atan2(c.cz, c.cx), 1.4 * hk, 0.1 * hk, 0.1 * hk, crane);
        }
      }
    }
    // warehouses on the quay, and container yards in the last age
    if (!ruin && age >= 4) {
      for (let t = -Lq * 0.8; t < Lq * 0.8; t += 2.3 * hk) {
        const [x, z] = at(t, -1.25 * hk);
        if (waterAt(L, x, z, 0.3) || Math.hypot(x, z) < L.plazaR + 1) continue;
        const rot = -Math.atan2(perp[1], perp[0]);
        if (age >= 6) {
          for (let k = 0; k < 3; k++) {
            const hh = hash(`${rec.id}:ctr:${t}:${k}`);
            const cc = [hex('#b5452f'), hex('#2f6c9a'), hex('#3d8a5a'), hex('#d1912f'), hex('#8c8f93')][hh % 5];
            p.add('box', x + perp[0] * (k - 1) * 0.55 * hk, 0, z + perp[1] * (k - 1) * 0.55 * hk, rot, 0.5 * hk, (0.3 + (hh % 3) * 0.28) * hk, 1.0 * hk, cc);
          }
        } else {
          p.add('box', x, 0, z, rot, 1.8 * hk, 0.8 * hk, 0.85 * hk, vary(hex('#a6694f'), (((t * 0.37) % 1) + 1) % 1, 0.1));
          p.add('gable', x, 0.8 * hk, z, rot, 1.85 * hk, 0.35 * hk, 0.9 * hk, hex('#5b5e64'));
        }
      }
    }
    // a breakwater and its light, from the age of coin, for a big port
    if (!ruin && age >= 2 && cy.pop > 15000) {
      const d = pierLen + 2.4 * hk;
      for (let t = -Lq * 0.7; t < Lq * 0.35; t += 1.1) {
        const [x0, z0] = at(t, d), [x1, z1] = at(t + 1.1, d);
        if (Math.hypot(x1, z1) > this.P - 0.8) continue;
        p.span('box', x0, z0, x1, z1, -0.55, 0.62, 0.75 * Math.sqrt(hk), shade(quayC, 0.88), 0.05);
      }
      const [lx, lz] = at(Lq * 0.35, d);
      if (Math.hypot(lx, lz) < this.P - 1) {
        p.add('cyl', lx, 0, lz, 0, 0.6 * hk, 2.1 * hk, 0.6 * hk, SILVER);
        p.add('ball', lx, 2.0 * hk, lz, 0, 0.42 * hk, 0.42 * hk, 0.42 * hk, hex('#f3d27a'));
        p.add('cone', lx, 2.35 * hk, lz, 0, 0.62 * hk, 0.5 * hk, 0.62 * hk, hex('#7a3c30'));
      }
    }
    if (ruin) return;
    // boats: how many from the size of the port, what kind from the age
    const nb = clamp(Math.round(1.5 + 2.4 * Math.log2(1 + cy.pop / 4000)), 2, 26);
    const bk = clamp(Math.sqrt(townR / 14), 1, 2.2);
    const rr = (i: number, k: number) => hash(`${rec.id}:boat:${i}:${k}`) / 4294967296;
    let placed = 0;
    const heading = -Math.atan2(c.cz, c.cx);
    for (let i = 0; placed < nb && i < nb * 3; i++) {
      let x: number, z: number, rot: number;
      if (i < piers.length * 2) {
        const pr = piers[i >> 1];
        const side = i & 1 ? 1 : -1;
        const back = 0.4 + rr(i, 0) * Math.max(0.3, pierLen - 1.6 * bk);
        x = pr.x - c.cx * back + perp[0] * side * 0.75 * bk;
        z = pr.z - c.cz * back + perp[1] * side * 0.75 * bk;
        rot = heading;
      } else {
        const t = (rr(i, 1) - 0.5) * Lq * 2.2;
        const [bx, bz] = at(t, pierLen + 0.8 * bk + rr(i, 2) * 6 * hk);
        x = bx; z = bz;
        rot = rr(i, 3) * TAU;
      }
      if (seaDepth(L, x, z) < 0.9 * bk || Math.hypot(x, z) > this.P - 1.6 * bk) continue;
      this.boat(x, z, rot, age, rr(i, 4), bk);
      placed++;
    }
    const [hx, hz] = at(0, pierLen * 0.5 + 1);
    this.anchors.push({ key: 'harbour', kicker: 'Port', text: 'Harbour', x: hx, y: 0.6, z: hz });
  }

  private boat(x: number, z: number, rot: number, age: number, h: number, b: number) {
    const p = this.parts;
    const y = WATER_Y - 0.08 * b;
    const linen = hex('#efe6d1'), wood = vary(hex('#6e5139'), h, 0.12);
    const cs = Math.cos(rot), sn = Math.sin(rot);
    // a part `d` lots along the keel, `yo` above the water, scaled with the boat
    const q = (kind: Kind, d: number, yo: number, r: number, sx: number, sy: number, sz: number, c: RGB) =>
      p.add(kind, x + cs * d * b, y + yo * b, z - sn * d * b, r, sx * b, sy * b, sz * b, c);
    const across = rot + Math.PI / 2;
    switch (age) {
      case 0:
        q('hull', 0, 0, rot, 0.9, 0.22, 0.6, vary(hex('#c7aa6a'), h, 0.1));
        q('box', 0, 0.2, rot, 0.03, 0.55, 0.03, wood);
        q('box', 0, 0.45, across, 0.42, 0.34, 0.02, linen);
        return;
      case 1:
      case 2:
        q('hull', 0, 0, rot, 1.7, 0.28, 0.85, wood);
        q('cyl', 0, 0.22, 0, 0.05, 1.0, 0.05, wood);
        q('box', 0, 0.5, across, 0.9, 0.62, 0.03, h < 0.5 ? linen : mix(linen, hex('#b3322a'), 0.55));
        return;
      case 3:
        q('hull', 0, 0, rot, 1.35, 0.38, 1.0, wood);
        q('box', -0.45, 0.3, rot, 0.35, 0.28, 0.42, shade(wood, 1.1));
        q('cyl', 0, 0.3, 0, 0.06, 1.25, 0.06, wood);
        q('box', 0, 0.65, across, 0.8, 0.7, 0.03, linen);
        return;
      case 4:
        q('hull', 0, 0, rot, 2.1, 0.4, 1.0, wood);
        for (const d of [-0.55, 0, 0.5]) {
          q('cyl', d, 0.3, 0, 0.05, d === 0 ? 1.6 : 1.3, 0.05, wood);
          q('box', d, 0.55, across, 0.7, 0.45, 0.03, linen);
          q('box', d, 1.05, across, 0.55, 0.38, 0.03, linen);
        }
        return;
      case 5:
        q('hull', 0, 0, rot, 2.4, 0.4, 1.05, hex('#34373b'));
        q('box', -0.2, 0.36, rot, 0.9, 0.3, 0.42, hex('#ece6da'));
        q('cyl', -0.1, 0.66, 0, 0.18, 0.55, 0.18, h < 0.5 ? hex('#a33a2c') : hex('#2b2b2b'));
        if (h < 0.5) this.smoke.push({ x: x - cs * 0.1 * b, y: y + 1.2 * b, z: z + sn * 0.1 * b, k: 0.35 * b, seed: h });
        return;
      default: {
        q('hull', 0, 0, rot, 3.6, 0.42, 1.3, h < 0.5 ? hex('#7c2f2a') : hex('#2f4a63'));
        q('box', -1.35, 0.38, rot, 0.4, 0.62, 0.55, hex('#f1eee7'));
        for (let k = 0; k < 4; k++) {
          const cc = [hex('#b5452f'), hex('#2f6c9a'), hex('#3d8a5a'), hex('#d1912f')][(k + Math.floor(h * 7)) % 4];
          q('box', -0.75 + k * 0.48, 0.38, rot, 0.42, 0.24 + ((k + Math.floor(h * 5)) % 2) * 0.2, 0.5, cc);
        }
      }
    }
  }

  // ---------------------------------------------------------------- river crossings
  private bridges(cy: CityYear, townR: number) {
    const L = this.L, R = L.river, p = this.parts;
    if (!R || cy.phase !== 'living') return;
    const age = cy.age;
    const spots: { x: number; z: number; ang: number }[] = [];
    // where the main roads cross
    for (const a of L.roads) {
      const dx = Math.cos(a), dz = Math.sin(a);
      let inW = -1;
      for (let t = L.plazaR; t < this.P; t += 0.2) {
        const w = riverDist(L, dx * t, dz * t).d < 0;
        if (w && inW < 0) inW = t;
        if (!w && inW >= 0) { const m = (inW + t) / 2; spots.push({ x: dx * m, z: dz * m, ang: a }); break; }
      }
    }
    // and more across a big town
    if (age >= 2 && townR > 9) {
      for (let u = -townR; u <= townR; u += 8.5) {
        if (Math.abs(u) < 3) continue;
        const m = meander(R, u);
        const x = R.ox + R.fx * u + R.nx * m, z = R.oz + R.fz * u + R.nz * m;
        if (Math.hypot(x, z) > townR * 0.9 || seaDepth(L, x, z) > -1) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 4)) continue;
        spots.push({ x, z, ang: Math.atan2(R.nz, R.nx) });
      }
    }
    const len = R.half * 2 + 1.3;
    for (const s of spots) {
      if (Math.hypot(s.x, s.z) > this.P - 1.5) continue;
      const rot = -s.ang;
      const cs = Math.cos(s.ang), sn = Math.sin(s.ang);
      if (age <= 1) {
        p.add('box', s.x, 0.02, s.z, rot, len, 0.1, 0.55, hex('#80614a'));
        for (const f of [-0.33, 0, 0.33]) p.add('cyl', s.x + cs * f * len, -0.5, s.z + sn * f * len, 0, 0.08, 0.55, 0.08, hex('#5b4535'));
      } else if (age <= 4) {
        const stone = ageStyle(age).stone;
        p.add('box', s.x, -0.1, s.z, rot, len, 0.32, 0.75, shade(stone, 0.95));
        for (const f of [-0.22, 0.22]) p.add('box', s.x + cs * f * len, -0.55, s.z + sn * f * len, rot, 0.3, 0.5, 0.82, shade(stone, 0.85));
      } else if (age === 5) {
        const iron = hex('#4a4e55');
        p.add('box', s.x, 0, s.z, rot, len, 0.14, 0.75, hex('#6f6a64'));
        for (const o of [-0.36, 0.36]) p.add('box', s.x - sn * o, 0.12, s.z + cs * o, rot, len, 0.48, 0.05, iron);
      } else {
        p.add('box', s.x, 0.02, s.z, rot, len, 0.12, 0.9, hex('#b9b6b0'));
        for (const f of [-0.25, 0.25]) p.add('cyl', s.x + cs * f * len, -0.55, s.z + sn * f * len, 0, 0.16, 0.6, 0.16, hex('#a29f99'));
      }
    }
    if (this.rec.site.river) {
      // name it where it runs through open country, never out at sea
      const at = (u: number): [number, number] => { const m = meander(R, u); return [R.ox + R.fx * u + R.nx * m, R.oz + R.fz * u + R.nz * m]; };
      let best: [number, number] | null = null;
      for (const sign of [-1, 1]) {
        for (let u = Math.min(townR + 3, this.P * 0.6); u > 2; u -= 1.5) {
          const [x, z] = at(u * sign);
          if (Math.hypot(x, z) < this.P * 0.85 && seaDepth(L, x, z) < -2) { best = [x, z]; break; }
        }
        if (best) break;
      }
      if (best) this.anchors.push({ key: 'river', kicker: 'River', text: this.rec.site.river.name, x: best[0], y: 0.3, z: best[1] });
    }
  }

  // ---------------------------------------------------------------- railway
  private railway(cy: CityYear, rail: { a: number; ds: number; dx: number; dz: number }) {
    const p = this.parts, L = this.L;
    const { ds, dx, dz, a } = rail;
    const end = this.P - 0.4;
    let stop = end;
    for (let t = ds; t < end; t += 0.5) if (waterAt(L, dx * t, dz * t, 0.2) === 1) { stop = t - 0.5; break; }
    const rot = -a;
    const x0 = dx * (ds - 1.2), z0 = dz * (ds - 1.2), x1 = dx * stop, z1 = dz * stop;
    p.span('box', x0, z0, x1, z1, 0, 0.06, 0.7, hex('#6d655c'));
    for (const o of [-0.17, 0.17]) p.span('box', x0 - dz * o, z0 + dx * o, x1 - dz * o, z1 + dx * o, 0.06, 0.04, 0.05, hex('#2f2c2a'));
    // the station
    const sx = dx * (ds + 0.6), sz = dz * (ds + 0.6);
    const ox = -dz * 0.9, oz = dx * 0.9;
    p.add('box', sx + ox, 0, sz + oz, rot, 2.8, 0.75, 0.9, cy.age >= 6 ? hex('#d9d4ca') : hex('#a86a52'));
    p.add('gable', sx, 0.7, sz, rot, 3.0, 0.45, 1.3, cy.age >= 6 ? hex('#9fb1bc') : hex('#7d8790'));
    // a train at the platform
    const modern = cy.age >= 6;
    for (let k = 0; k < 5; k++) {
      const t = ds + 0.8 + k * 0.95;
      if (t > stop - 0.5) break;
      const c = k === 0 ? (modern ? hex('#e8e4dc') : hex('#26302b')) : modern ? hex('#c84a3a') : hex('#7a2e2a');
      p.add('box', dx * t, 0.1, dz * t, rot, 0.86, 0.36, 0.38, c);
      if (k === 0 && !modern) {
        p.add('cyl', dx * (t + 0.25), 0.46, dz * (t + 0.25), 0, 0.12, 0.22, 0.12, hex('#1e1e1e'));
        this.smoke.push({ x: dx * (t + 0.25), y: 0.7, z: dz * (t + 0.25), k: 0.3, seed: 0.37 });
      }
    }
    this.anchors.push({ key: 'rail', kicker: 'Railway', text: 'Station', x: sx, y: 1.3, z: sz });
  }

  // ---------------------------------------------------------------- trees
  private plantTrees() {
    const P = this.P, L = this.L, B = this.biome;
    const trees: CityModel['trees'] = [];
    const seed = hash(`${this.rec.id}:trees`) & 0xffff;
    const step = Math.max(1.1, P / 34);
    const kind = B.trees === 'conifer' ? 1 : B.trees === 'palm' ? 2 : B.trees === 'scrub' ? 3 : 0;
    for (let x = -P; x <= P; x += step) {
      for (let z = -P; z <= P; z += step) {
        const jx = x + (vnoise(x * 3.1, z * 3.1, seed) - 0.5) * step * 1.4;
        const jz = z + (vnoise(x * 2.7 + 9, z * 2.7, seed) - 0.5) * step * 1.4;
        const r = Math.hypot(jx, jz);
        if (r > P - 0.8 || r < L.plazaR + 1) continue;
        // woods come in clumps; more of them toward the edge of the model
        const clump = vnoise(jx / 9, jz / 9, seed + 3);
        let dens = B.density * (0.25 + 1.5 * clump * clump) * (0.35 + 0.9 * smooth(P * 0.35, P * 0.85, r));
        if (B.trees === 'palm' && L.river) dens = Math.max(dens, 1.2 * Math.exp(-Math.max(0, riverDist(L, jx, jz).d) / 2.5));
        const hv = vnoise(jx * 5.3, jz * 5.3, seed + 4);
        if (hv > dens) continue;
        if (waterAt(L, jx, jz, 0.5)) continue;
        if (nearRoad(L, jx, jz, 0.7)) continue;
        trees.push({ x: jx, z: jz, s: 0.75 + 0.6 * vnoise(jx * 7, jz * 7, seed + 5), h: hv, kind, r, sector: Math.floor((((Math.atan2(jz, jx) + TAU) % TAU) / TAU) * SECTORS) % SECTORS });
        if (trees.length > 2600) break;
      }
    }
    this.trees = trees;
  }

  private forest(cy: CityYear) {
    const p = this.parts, B = this.biome;
    const ruin = cy.phase === 'ruin';
    const fieldBand = 7;
    const scale = Math.max(1, this.P / 22);
    for (const t of this.trees) {
      const r = t.r;
      const edge = this.town[t.sector];
      if (r < edge + 0.6) {
        // ruins are overgrown, little by little
        if (!ruin || t.h > clamp(cy.ruinAge / 1500, 0, 0.8) * B.density) continue;
      } else if (r < edge + fieldBand && t.h > 0.12) continue; // the fields around the town
      const s = t.s * scale * 0.9;
      const c = vary(B.tree, t.h, 0.16);
      const trunk = hex('#5d4a3a');
      switch (t.kind) {
        case 1:
          p.add('cone', t.x, 0, t.z, 0, 0.62 * s, 1.5 * s, 0.62 * s, shade(c, 0.9));
          break;
        case 2:
          p.add('cyl', t.x, 0, t.z, 0, 0.07 * s, 1.1 * s, 0.07 * s, trunk);
          p.add('ball', t.x, 1.0 * s, t.z, t.h * 7, 0.8 * s, 0.3 * s, 0.8 * s, c);
          break;
        case 3:
          p.add('ball', t.x, 0, t.z, t.h * 7, 0.5 * s, 0.4 * s, 0.5 * s, c);
          break;
        default:
          p.add('cyl', t.x, 0, t.z, 0, 0.09 * s, 0.4 * s, 0.09 * s, trunk);
          p.add('ball', t.x, 0.3 * s, t.z, t.h * 7, 0.7 * s, 0.75 * s, 0.7 * s, c);
      }
    }
  }

  // ---------------------------------------------------------------- the ground (repainted when the plinth grows)
  private buildGround(age: number) {
    const P = this.P, L = this.L, site = this.rec.site;
    const NR = 70, NS = 180;
    const flat = P / 1.42;
    const amp = P * 0.032 * (0.3 + site.uphill.k + site.elev * 0.7);
    const seed = hash(`${this.rec.id}:hills`) & 0xffff;
    const height = (x: number, z: number): number => {
      const sd = seaDepth(L, x, z);
      if (sd > -0.6) return sd > 0 ? -Math.min(0.62, 0.16 + sd * 0.22) : -0.16 * smooth(-0.6, 0, sd);
      const rd = riverDist(L, x, z).d;
      if (rd < 0.35) return rd < 0 ? -Math.min(0.46, 0.15 + -rd * 0.5) : -0.15 * (1 - rd / 0.35);
      const r = Math.hypot(x, z);
      if (r < flat) return 0;
      const up = (x * site.uphill.dx + z * site.uphill.dz) / r;
      const hill = amp * smooth(flat, P, r) * (0.55 + 0.45 * up) * (0.5 + vnoise(x / 6, z / 6, seed));
      // keep the shore and the riverbanks low
      return hill * smooth(-0.6, -4, sd) * smooth(0.35, 3, rd);
    };
    const pos = new Float32Array((NR * NS + 1) * 3);
    const uv = new Float32Array((NR * NS + 1) * 2);
    const idx: number[] = [];
    const put = (i: number, x: number, z: number) => {
      pos[3 * i] = x; pos[3 * i + 1] = height(x, z); pos[3 * i + 2] = z;
      uv[2 * i] = x / (2 * P) + 0.5; uv[2 * i + 1] = z / (2 * P) + 0.5;
    };
    put(0, 0, 0);
    for (let ri = 1; ri <= NR; ri++) {
      const r = P * Math.pow(ri / NR, 1.12);
      for (let s = 0; s < NS; s++) {
        const a = (s / NS) * TAU;
        put(1 + (ri - 1) * NS + s, Math.cos(a) * r, Math.sin(a) * r);
      }
    }
    for (let s = 0; s < NS; s++) idx.push(0, 1 + ((s + 1) % NS), 1 + s);
    for (let ri = 1; ri < NR; ri++) {
      for (let s = 0; s < NS; s++) {
        const a = 1 + (ri - 1) * NS + s, b = 1 + (ri - 1) * NS + ((s + 1) % NS);
        const c = a + NS, d = b + NS;
        idx.push(a, b, d, a, d, c);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // the painted ground
    const size = this.opts.textureSize;
    if (!this.tex) {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      this.tex = new CanvasTexture(canvas);
      this.tex.colorSpace = SRGBColorSpace;
      this.tex.flipY = false;
      this.tex.anisotropy = 4;
      this.tex.minFilter = LinearMipmapLinearFilter;
      this.groundMat.map = this.tex;
    }
    this.repaint(age);
    if (!this.ground) {
      this.ground = new Mesh(g, this.groundMat);
      this.ground.receiveShadow = true;
      this.group.add(this.ground);
    } else {
      this.ground.geometry.dispose();
      this.ground.geometry = g;
    }
    this.water.scale.set(P, 1, P);
    // the plinth's side, following the rim
    if (this.opts.plinth) {
      const thick = 0.085 * P;
      const sp = new Float32Array(NS * 2 * 3 + 6);
      const col = new Float32Array(NS * 2 * 3 + 6);
      const sidx: number[] = [];
      for (let s = 0; s <= NS; s++) {
        const a = (s / NS) * TAU;
        const x = Math.cos(a) * P, z = Math.sin(a) * P;
        const top = Math.max(WATER_Y, height(x, z));
        this.rimWet[s] = height(x, z) < WATER_Y + 0.02 ? 1 : 0;
        const k = s * 2;
        sp.set([x, top, z, x * 1.0, -thick, z * 1.0], k * 3);
        if (s < NS) sidx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
      const sg = new BufferGeometry();
      sg.setAttribute('position', new BufferAttribute(sp, 3));
      sg.setAttribute('color', new BufferAttribute(col, 3));
      sg.setIndex(sidx);
      sg.computeVertexNormals();
      if (!this.side) {
        this.side = new Mesh(sg, this.sideMat);
        this.side.receiveShadow = true;
        this.group.add(this.side);
      } else {
        this.side.geometry.dispose();
        this.side.geometry = sg;
      }
      this.paintSide();
    }
  }

  private repaint(age: number) {
    if (!this.tex) return;
    const canvas = this.tex.image as HTMLCanvasElement;
    this.paint(canvas.getContext('2d')!, canvas.width, age);
    this.tex.needsUpdate = true;
  }

  private paintSide() {
    if (!this.side) return;
    const g = this.side.geometry;
    const col = g.attributes.color as BufferAttribute;
    const dark = this.opts.theme === 'dark';
    const rim = dark ? hex('#6b5a48') : hex('#8a7356');
    const body = dark ? hex('#241d18') : hex('#4b3a2d');
    const pos = g.attributes.position as BufferAttribute;
    const wet = dark ? hex('#2d5566') : hex('#5f8fa3');
    for (let i = 0; i < pos.count; i++) {
      const c = i % 2 === 0 ? (this.rimWet[i >> 1] ? wet : rim) : body;
      col.setXYZ(i, Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2));
    }
    col.needsUpdate = true;
  }

  private paint(ctx: CanvasRenderingContext2D, size: number, age: number) {
    const P = this.P, L = this.L, B = this.biome, rec = this.rec;
    const k = size / (2 * P);
    const X = (x: number) => (x + P) * k;
    const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
    const seed = hash(`${rec.id}:fields`) & 0xffff;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css(B.land);
    ctx.fillRect(0, 0, size, size);
    // mottling
    for (let i = 0; i < 260; i++) {
      const x = (vnoise(i * 1.7, 3.3, seed) - 0.5) * 2 * P, z = (vnoise(5.1, i * 1.3, seed) - 0.5) * 2 * P;
      const r = (1.5 + 4 * vnoise(i, i, seed + 1)) * Math.max(1, P / 30);
      ctx.fillStyle = css(shade(B.land, 0.9 + 0.2 * vnoise(i * 0.7, 1, seed + 2)), 0.35);
      ctx.beginPath(); ctx.arc(X(x), X(z), r * k, 0, TAU); ctx.fill();
    }
    // fields: a patchwork laid out on the people's bearing
    const angle = ((hash(`cul:${stepAt(rec.cultures, rec.start)}:streets`) >>> 8) % 90) * (Math.PI / 180);
    const fw = 2.4 * Math.max(1, P / 40), fd = 1.7 * Math.max(1, P / 40);
    ctx.save();
    ctx.translate(X(0), X(0));
    ctx.rotate(angle);
    const ext = P * 1.5;
    const irrigated = B.trees === 'palm' || rec.site.biome === 'Cold desert';
    for (let u = -ext; u < ext; u += fw) {
      for (let v = -ext; v < ext; v += fd) {
        const cx = u + fw / 2, cz = v + fd / 2;
        const wx = cx * Math.cos(angle) - cz * Math.sin(angle), wz = cx * Math.sin(angle) + cz * Math.cos(angle);
        const r = Math.hypot(wx, wz);
        if (r > P) continue;
        const h = vnoise(u * 3.7, v * 3.7, seed + 7);
        let keep = 1 - smooth(P * 0.45, P * 0.95, r);
        if (irrigated) keep = L.river ? Math.exp(-Math.max(0, riverDist(L, wx, wz).d) / 4) : keep * 0.25;
        if (B.snow) keep *= 0.35;
        if (h > keep) continue;
        const fc = B.field[Math.floor(vnoise(u * 1.3, v * 1.9, seed + 8) * B.field.length * 0.999)];
        ctx.fillStyle = css(vary(fc, h, 0.06));
        ctx.fillRect((u + 0.08) * k, (v + 0.08) * k, (fw - 0.16) * k, (fd - 0.16) * k);
        if (h < 0.5) {
          ctx.strokeStyle = css(shade(fc, 0.86), 0.5);
          ctx.lineWidth = Math.max(1, 0.05 * k);
          for (let q = 1; q < 4; q++) { ctx.beginPath(); ctx.moveTo((u + 0.1) * k, (v + (q * fd) / 4) * k); ctx.lineTo((u + fw - 0.1) * k, (v + (q * fd) / 4) * k); ctx.stroke(); }
        }
      }
    }
    ctx.restore();
    // roads out of town
    const road = shade(ageStyle(age).pave, 0.92);
    ctx.strokeStyle = css(road);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, 0.95 * k);
    for (const a of L.roads) {
      ctx.beginPath();
      ctx.moveTo(X(0), X(0));
      const wob = hash(`${rec.id}:road:${a}`) & 0xffff;
      for (let t = 0; t <= P * 1.05; t += 1) {
        const off = t > L.plazaR + 6 ? (vnoise(t / 7, 0.5, wob) - 0.5) * 3 * smooth(L.plazaR + 6, P, t) : 0;
        ctx.lineTo(X(Math.cos(a) * t - Math.sin(a) * off), X(Math.sin(a) * t + Math.cos(a) * off));
      }
      ctx.stroke();
    }
    const R = L.river;
    if (R) {
      const pts: [number, number][] = [];
      const u0 = Number.isFinite(R.uMin) ? R.uMin : -P * 1.5;
      for (let u = u0; u <= P * 1.5; u += 0.4) {
        const m = meander(R, u);
        pts.push([R.ox + R.fx * u + R.nx * m, R.oz + R.fz * u + R.nz * m]);
      }
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const line = (w: number, col: string) => {
        ctx.beginPath();
        pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), X(z)) : ctx.moveTo(X(x), X(z))));
        ctx.strokeStyle = col; ctx.lineWidth = w * k; ctx.stroke();
      };
      line(R.half * 2 + 0.9, css(shade(B.land, 0.82)));
      line(R.half * 2, css(hex('#55869a')));
      line(R.half * 1.1, css(hex('#4a788c')));
    }
    // the sea, its shallows and the beach
    const c = L.coast;
    if (c) {
      const perp = [-c.cz, c.cx];
      const pts: [number, number][] = [];
      for (let t = -P * 1.6; t <= P * 1.6; t += 0.5) {
        const s = shoreAt(L, t);
        pts.push([c.cx * s + perp[0] * t, c.cz * s + perp[1] * t]);
      }
      const sea = () => {
        ctx.beginPath();
        pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), X(z)) : ctx.moveTo(X(x), X(z))));
        const far = P * 3;
        const [lx, lz] = pts[pts.length - 1], [fx, fz] = pts[0];
        ctx.lineTo(X(lx + c.cx * far), X(lz + c.cz * far));
        ctx.lineTo(X(fx + c.cx * far), X(fz + c.cz * far));
        ctx.closePath();
      };
      if (!rec.port) {
        ctx.save(); sea(); ctx.strokeStyle = css(hex('#e2d3a8')); ctx.lineWidth = 1.6 * k; ctx.stroke(); ctx.restore();
      }
      sea();
      ctx.fillStyle = css(hex('#4f7f92'));
      ctx.fill();
      ctx.save(); sea(); ctx.clip();
      ctx.strokeStyle = css(hex('#7fa9a8'), 0.85); ctx.lineWidth = 2.4 * k; sea(); ctx.stroke();
      ctx.strokeStyle = css(hex('#9cbfb5'), 0.8); ctx.lineWidth = 0.9 * k; sea(); ctx.stroke();
      // deeper water further out, and a few lines of swell
      for (let d = 4; d < P * 2; d += 3) {
        ctx.beginPath();
        pts.forEach(([x, z], i) => { const xx = X(x + c.cx * d), zz = X(z + c.cz * d); if (i) ctx.lineTo(xx, zz); else ctx.moveTo(xx, zz); });
        ctx.strokeStyle = css(hex('#3f6f84'), Math.min(0.5, d / (P * 1.2)) * 0.5); ctx.lineWidth = 3 * k; ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(235,245,245,0.22)';
      ctx.lineWidth = Math.max(1, 0.12 * k);
      for (let i = 0; i < 90; i++) {
        const t = (vnoise(i * 3.1, 0.7, seed + 21) - 0.5) * P * 2.4, d = 1.5 + vnoise(0.3, i * 2.3, seed + 22) * P;
        const s0 = shoreAt(L, t) + d;
        const x = c.cx * s0 + perp[0] * t, z = c.cz * s0 + perp[1] * t;
        const len = (1.2 + 2 * vnoise(i, i * 0.5, seed + 23)) * Math.max(1, P / 40);
        ctx.beginPath();
        ctx.moveTo(X(x - perp[0] * len), X(z - perp[1] * len));
        ctx.quadraticCurveTo(X(x - c.cx * 0.3), X(z - c.cz * 0.3), X(x + perp[0] * len), X(z + perp[1] * len));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  dispose() {
    this.parts.dispose();
    this.puffs.dispose();
    this.ground?.geometry.dispose();
    this.side?.geometry.dispose();
    this.water.geometry.dispose();
    this.tex?.dispose();
    for (const m of [this.mat, this.puffMat, this.waterMat, this.groundMat, this.sideMat]) m.dispose();
  }
}

/** The most recent sack within SACK_YEARS before (not in) year y, as cityAt() reports one. */
function sackBefore(rec: CityRecord, y: number): CityYear['sack'] {
  let sack: CityYear['sack'] = null;
  for (const s of rec.sacks) if (s < y && y - s <= SACK_YEARS) sack = { year: s, ago: y - s };
  return sack;
}

function angDist(a: number, b: number): number {
  const d = Math.abs((((a - b) % TAU) + TAU) % TAU);
  return Math.min(d, TAU - d);
}
function nearRoad(L: Layout, x: number, z: number, w: number): boolean {
  for (const a of L.roads) {
    const along = x * Math.cos(a) + z * Math.sin(a);
    if (along < 0) continue;
    if (Math.abs(-x * Math.sin(a) + z * Math.cos(a)) < w) return true;
  }
  return false;
}
function capitalSince(rec: CityRecord, a: number): number {
  let since = a;
  for (let i = rec.capitals.length - 1; i >= 0; i--) {
    const [x, y] = rec.capitals[i];
    if (x < since && y >= since - 1) since = x;
  }
  return since;
}
