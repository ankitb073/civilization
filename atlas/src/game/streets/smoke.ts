// Streets: smoke as soft camera-facing puffs, one instanced draw per kind. The city model's own puffs are faceted
// balls meant to be seen from above at a distance; at walking scale they read as boulders, so the same sources send up
// billboards with a soft round texture instead. Two kinds: the sack's fires (dark, heavy, model.smoke, in lots) and
// the hearths of a living town (thin, pale, slow; sources from the streets layer, in metres).

import {
  CanvasTexture, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial,
  PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type Camera,
} from 'three';
import type { Smoke } from '../../three/city/model.ts';

export interface SmokeStyle {
  /** Puffs per column. */
  per: number;
  /** How far a puff rises and drifts over its life, in units of the source's k. */
  rise: number; drift: number;
  /** Growth from birth to the top (×k). */
  grow: [number, number];
  speed: number;
  opacity: number;
  /** Colours from the source up (dark sources use the first pair). */
  dark: [string, string]; light: [string, string];
  /** Mix toward the fog colour at the top. */
  haze: number;
}

export const FIRE: SmokeStyle = { per: 14, rise: 7.5, drift: 2.4, grow: [0.9, 4.3], speed: 0.06, opacity: 0.5, dark: ['#2b2724', '#6d655d'], light: ['#6d655d', '#a59d93'], haze: 0.45 };
export const HEARTH: SmokeStyle = { per: 16, rise: 8, drift: 3.2, grow: [1.0, 3.8], speed: 0.03, opacity: 0.36, dark: ['#6f675f', '#a8a097'], light: ['#7c746b', '#b7afa5'], haze: 0.32 };

export class SmokeColumns {
  readonly mesh: InstancedMesh;
  private src: Smoke[];
  private scale: number;
  private style: SmokeStyle;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private c = new Color();
  private fog: Color;
  private cols: Color[];
  private last = -1;

  constructor(src: Smoke[], scale: number, fog: Color, style: SmokeStyle = FIRE) {
    this.src = src;
    this.scale = scale;
    this.fog = fog;
    this.style = style;
    this.cols = [...style.dark, ...style.light].map((h) => new Color(h));
    const tex = puffTexture();
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: style.opacity, fog: true });
    const n = Math.max(1, src.length * style.per);
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = src.length * style.per;
    this.mesh.visible = src.length > 0;
    this.mesh.name = 'smoke';
  }

  /** Lay out the puffs at time t (seconds; a fixed t for reduced motion), facing the camera. Cheap to call twice. */
  update(t: number, cam: Camera) {
    if (!this.src.length || t === this.last) return;
    this.last = t;
    this.q.copy(cam.quaternion);
    const L = this.scale, S = this.style;
    let i = 0;
    const [d0, d1, l0, l1] = this.cols;
    for (const s of this.src) {
      for (let j = 0; j < S.per; j++) {
        const f = (t * S.speed * (0.8 + 0.4 * s.seed) + s.seed + j / S.per) % 1;
        const k = s.k * L * (S.grow[0] + (S.grow[1] - S.grow[0]) * f);
        // drift downwind and up; a little sway
        const sway = Math.sin(t * 0.4 + j * 1.7 + s.seed * 6) * 0.25 * f * s.k * L;
        this.p.set(s.x * L + f * S.drift * s.k * L + sway, s.y * L + f * S.rise * s.k * L, s.z * L + f * 1.1 * s.k * L);
        // grow, then thin out at the top (shrink to nothing so the column has no hard end)
        const fade = f < 0.12 ? f / 0.12 : 1 - Math.pow((f - 0.12) / 0.88, 1.6);
        const size = k * Math.max(0, fade);
        this.s.set(size, size, size);
        this.m.compose(this.p, this.q, this.s);
        this.mesh.setMatrixAt(i, this.m);
        if (s.dark) this.c.copy(d0).lerp(d1, f); else this.c.copy(l0).lerp(l1, 0.3 + 0.7 * f);
        this.c.lerp(this.fog, f * S.haze);
        this.mesh.setColorAt(i, this.c);
        i++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    const m = this.mesh.material as MeshBasicMaterial;
    m.map?.dispose();
    m.dispose();
  }
}

function puffTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // a few overlapping soft blobs, so a puff is not a perfect disc
  const blobs: [number, number, number, number][] = [[64, 66, 54, 1], [48, 58, 34, 0.7], [82, 56, 32, 0.7], [62, 44, 30, 0.6], [70, 80, 30, 0.5]];
  for (const [x, y, r, a] of blobs) {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${0.55 * a})`);
    grd.addColorStop(0.55, `rgba(255,255,255,${0.32 * a})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
