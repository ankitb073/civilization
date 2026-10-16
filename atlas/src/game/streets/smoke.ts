// Streets: the smoke over a sacked or working city, as soft camera-facing puffs. The city model's own puffs are
// faceted balls meant to be seen from above at a distance; at walking scale they read as boulders, so here the same
// sources (model.smoke, in lots) send up billboards with a soft round texture instead: one instanced draw.

import {
  CanvasTexture, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial,
  PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type Camera,
} from 'three';
import type { Smoke } from '../../three/city/model.ts';

const PER = 14;

export class SmokeColumns {
  readonly mesh: InstancedMesh;
  private src: Smoke[];
  private scale: number;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private c = new Color();
  private fog: Color;

  constructor(src: Smoke[], scale: number, fog: Color) {
    this.src = src;
    this.scale = scale;
    this.fog = fog;
    const tex = puffTexture();
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, fog: true });
    const n = Math.max(1, src.length * PER);
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = src.length * PER;
    this.mesh.name = 'smoke';
  }

  /** Lay out the puffs at time t (seconds; a fixed t for reduced motion), facing the camera. */
  update(t: number, cam: Camera) {
    this.q.copy(cam.quaternion);
    const L = this.scale;
    let i = 0;
    const soot = new Color('#2b2724'), ash = new Color('#6d655d'), grey = new Color('#a59d93');
    for (const s of this.src) {
      for (let j = 0; j < PER; j++) {
        const f = (t * 0.06 * (0.8 + 0.4 * s.seed) + s.seed + j / PER) % 1;
        const k = s.k * L * (0.9 + 3.4 * f);
        // drift downwind and up; a little sway
        const sway = Math.sin(t * 0.4 + j * 1.7 + s.seed * 6) * 0.25 * f * s.k * L;
        this.p.set(s.x * L + f * 2.4 * s.k * L + sway, s.y * L + f * 7.5 * s.k * L, s.z * L + f * 1.1 * s.k * L);
        // grow, then thin out at the top (shrink to nothing so the column has no hard end)
        const fade = f < 0.12 ? f / 0.12 : 1 - Math.pow((f - 0.12) / 0.88, 1.6);
        const size = k * Math.max(0, fade);
        this.s.set(size, size, size);
        this.m.compose(this.p, this.q, this.s);
        this.mesh.setMatrixAt(i, this.m);
        if (s.dark) this.c.copy(soot).lerp(ash, f); else this.c.copy(ash).lerp(grey, 0.3 + 0.7 * f);
        this.c.lerp(this.fog, f * 0.45);
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
