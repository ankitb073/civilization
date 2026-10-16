// The painted backdrop: a 2D canvas of the same beat (sky gradient, ridges, the city's silhouette, fires, smoke),
// shown at once while the 3D scene loads and kept when WebGL is not available. Two canvases crossfade on a beat
// change. Deterministic: everything is drawn from streams keyed by the city's id.

import { css, mixRgb, skyAt, type Look, type RGB } from './looks.ts';
import { eraIndex, streamOf, type BackdropScenario } from './scenario.ts';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export interface PaintColors { ours: RGB | null; theirs: RGB | null }

export class Painted {
  private root: HTMLElement;
  private cv: [HTMLCanvasElement, HTMLCanvasElement];
  private front = 0;
  private sc: BackdropScenario;
  private look: Look | null = null;
  private colors: PaintColors = { ours: null, theirs: null };
  private ro: ResizeObserver;
  private w = 0;
  private h = 0;

  constructor(parent: HTMLElement, sc: BackdropScenario) {
    this.sc = sc;
    this.root = document.createElement('div');
    this.root.className = 'bd__paint';
    const mk = () => { const c = document.createElement('canvas'); c.setAttribute('aria-hidden', 'true'); this.root.appendChild(c); return c; };
    this.cv = [mk(), mk()];
    this.cv[0].style.opacity = '1';
    this.cv[1].style.opacity = '0';
    parent.appendChild(this.root);
    let pending = 0;
    this.ro = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => { if (this.look && this.sized()) this.paint(this.cv[this.front], this.look); });
    });
    this.ro.observe(this.root);
  }

  setColors(c: PaintColors) {
    this.colors = c;
    if (this.look) this.setLook(this.look, true);
  }

  /** Paint a look; crossfade unless `instant`. */
  setLook(l: Look, instant: boolean) {
    this.look = l;
    this.sized();
    const back = instant ? this.front : 1 - this.front;
    this.paint(this.cv[back], l);
    if (back !== this.front) {
      this.cv[back].style.opacity = '1';
      this.cv[this.front].style.opacity = '0';
      this.front = back;
    }
  }

  private sized(): boolean {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const changed = w !== this.w || h !== this.h;
    this.w = w; this.h = h;
    return changed;
  }

  private paint(cv: HTMLCanvasElement, L: Look) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const W = this.w, H = this.h;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sc = this.sc;
    const rnd = streamOf(`backdrop:paint:${sc.city.id}`);
    const tall = W / H < 1;
    const hy = H * (tall ? 0.3 : 0.38);               // horizon
    const cityY = H * (tall ? 0.47 : 0.62);            // the city's ground
    const cityX = W * 0.5;
    const sunX = clamp(0.5 + L.sunAz / 70, -0.2, 1.2) * W;
    const sunY = hy - (L.sunEl / 25) * hy * 0.8;
    const lightK = clamp((L.lightI * 0.32 + L.hemiI * 0.55) / 1.55, 0.12, 1.15);
    const zl = 0.2126 * L.zenith[0] + 0.7152 * L.zenith[1] + 0.0722 * L.zenith[2];
    const night = 1 - clamp((zl - 0.05) / 0.3, 0, 1);

    // ---- sky
    const g = ctx.createLinearGradient(0, 0, 0, hy);
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      g.addColorStop(u, css(skyAt(L, (1 - u) * 0.7, 0)));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hy + 1);
    if (L.glowK > 0.02) {
      const rg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(W, H) * 0.55);
      rg.addColorStop(0, css(L.glow, Math.min(0.9, L.glowK * 0.75)));
      rg.addColorStop(0.25, css(L.glow, L.glowK * 0.28));
      rg.addColorStop(1, css(L.glow, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, hy + 1);
    }
    if (L.stars > 0.02) {
      const sr = streamOf(`backdrop:stars:${sc.city.id}`);
      for (let i = 0; i < 160; i++) {
        const x = sr() * W, y = sr() * hy * 0.9, a = sr() * L.stars * (1 - y / hy);
        ctx.fillStyle = `rgba(235,238,255,${a.toFixed(3)})`;
        ctx.fillRect(x, y, sr() < 0.1 ? 1.6 : 1, sr() < 0.1 ? 1.6 : 1);
      }
    }
    if (L.clouds > 0.03) {
      const cr = streamOf(`backdrop:clouds:${sc.city.id}`);
      const n = Math.round(4 + L.clouds * 14);
      for (let i = 0; i < n; i++) {
        const x = cr() * W * 1.2 - W * 0.1, y = hy * (0.12 + cr() * 0.62), rx = W * (0.08 + cr() * 0.16), ry = rx * (0.16 + cr() * 0.1);
        const lit = mixRgb(L.cloudShade, L.cloudLit, clamp(0.4 + (1 - Math.abs(x - sunX) / W) * 0.6, 0, 1));
        const cg = ctx.createRadialGradient(x, y, 0, x, y, rx);
        cg.addColorStop(0, css(lit, 0.55 * Math.min(1, L.clouds * 1.4)));
        cg.addColorStop(1, css(lit, 0));
        ctx.save();
        ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.translate(-x, -y);
        ctx.fillStyle = cg;
        ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
        ctx.restore();
      }
    }

    // ---- land: a far range, two nearer ridges into the haze, then the plain
    const earth: RGB = mixRgb([0.55, 0.52, 0.4], this.colors.ours ?? [0.6, 0.55, 0.42], 0.35);
    const far: RGB = mixRgb(earth, this.colors.theirs ?? earth, 0.3);
    const lit = (c: RGB) => shade(c, lightK);
    const ridge = (u: number, ph: number, rough: number) => {
      // a 1D fBm with a ridged share: peaks for the far range, swells for the near hills
      let sum = 0, amp = 1, f = 1, norm = 0;
      for (let o = 0; o < 5; o++) {
        const n = Math.sin(u * f * 6.1 + ph * (o + 1)) * 0.6 + Math.sin(u * f * 13.7 + ph * 1.7 * (o + 2)) * 0.4;
        sum += (rough * (1 - Math.abs(n)) + (1 - rough) * (n * 0.5 + 0.5)) * amp;
        norm += amp; amp *= 0.5; f *= 2.1;
      }
      return sum / norm;
    };
    const layers = [
      { base: hy + (cityY - hy) * 0.06, amp: H * 0.16, rough: 0.85, haze: 0.72, col: far },
      { base: hy + (cityY - hy) * 0.32, amp: H * 0.075, rough: 0.35, haze: 0.5, col: earth },
      { base: hy + (cityY - hy) * 0.62, amp: H * 0.04, rough: 0.15, haze: 0.3, col: earth },
    ];
    for (const ly of layers) {
      const ph = rnd() * 10;
      const col = mixRgb(lit(ly.col), L.haze, ly.haze);
      const lg = ctx.createLinearGradient(0, ly.base - ly.amp, 0, ly.base + H * 0.12);
      lg.addColorStop(0, css(mixRgb(col, L.horizon, 0.12)));
      lg.addColorStop(1, css(mixRgb(col, L.haze, 0.25)));
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W + 6; x += 6) ctx.lineTo(x, ly.base - ly.amp * ridge(x / W, ph, ly.rough));
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    const gg = ctx.createLinearGradient(0, cityY - H * 0.08, 0, H);
    gg.addColorStop(0, css(mixRgb(lit(earth), L.haze, 0.4)));
    gg.addColorStop(1, css(shade(lit(earth), 0.72)));
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 8; x += 8) {
      const u = x / W - 0.5;
      ctx.lineTo(x, cityY + H * 0.02 + u * u * H * 0.18 - Math.exp(-u * u * 40) * H * 0.035);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // ---- the battle's dust, far off
    if (L.dust > 0.02) {
      const dx = W * (tall ? 0.72 : 0.7), dy = hy + (cityY - hy) * 0.1;
      for (let i = 0; i < 9; i++) {
        const y = dy - i * H * 0.03, r = H * (0.035 + i * 0.012);
        const dg = ctx.createRadialGradient(dx + i * W * 0.006, y, 0, dx + i * W * 0.006, y, r);
        dg.addColorStop(0, css(mixRgb([0.75, 0.64, 0.5], L.haze, i / 12), 0.32 * L.dust));
        dg.addColorStop(1, css(L.haze, 0));
        ctx.fillStyle = dg;
        ctx.fillRect(dx - r * 1.5, y - r, r * 3.2, r * 2);
      }
    }

    // ---- the city
    const era = eraIndex(sc.year);
    const span = W * (tall ? 0.66 : 0.34) * clamp(0.7 + Math.log10(Math.max(1000, sc.city.pop)) / 14, 0.85, 1.3);
    const n = Math.round(clamp(Math.pow(sc.city.pop, 0.3), 16, 90));
    const bc: RGB = era >= 5 ? [0.55, 0.42, 0.36] : era >= 2 ? [0.86, 0.82, 0.74] : [0.78, 0.68, 0.52];
    const wallC = mixRgb(shade(bc, lightK * 0.95), L.haze, 0.18 + 0.1 * (1 - night));
    const darkC = mixRgb(shade(bc, lightK * 0.6), L.haze, 0.12);
    const unit = span / n * 1.9;
    // glow behind the burning city
    if (L.fire > 0.02) {
      const fg = ctx.createRadialGradient(cityX, cityY - unit * 2, 0, cityX, cityY - unit * 2, span * 1.1);
      fg.addColorStop(0, `rgba(255,120,40,${(0.55 * L.fire).toFixed(3)})`);
      fg.addColorStop(0.5, `rgba(200,60,20,${(0.18 * L.fire).toFixed(3)})`);
      fg.addColorStop(1, 'rgba(120,30,10,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, W, H);
    }
    // houses, back to front
    const houses: { x: number; w: number; h: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const u = (i + rnd() * 0.8) / n - 0.5;
      const x = cityX + u * span;
      const centre = Math.exp(-u * u * 14);
      const w = unit * (0.6 + rnd() * 0.6);
      const hh = unit * (era >= 5 ? 1.2 + rnd() * 2.6 : 0.5 + rnd() * 0.7) * (0.7 + centre * 0.9);
      const y = cityY - Math.exp(-u * u * 40) * H * 0.035 + u * u * H * 0.18 * 0.2 + rnd() * unit * 0.4;
      houses.push({ x, w, h: hh, y });
    }
    houses.sort((a, b) => a.y - b.y);
    for (const b of houses) {
      ctx.fillStyle = css(rnd() < 0.5 ? wallC : darkC);
      ctx.fillRect(b.x - b.w / 2, b.y - b.h, b.w, b.h + unit * 0.4);
      if (era >= 1 && era <= 5 && era !== 4) {
        ctx.fillStyle = css(mixRgb(shade(era === 2 ? [0.7, 0.34, 0.24] : [0.42, 0.34, 0.3], lightK), L.haze, 0.15));
        ctx.beginPath();
        ctx.moveTo(b.x - b.w * 0.56, b.y - b.h);
        ctx.lineTo(b.x, b.y - b.h - b.w * 0.42);
        ctx.lineTo(b.x + b.w * 0.56, b.y - b.h);
        ctx.fill();
      }
    }
    // a temple or tower over the middle
    const tx = cityX + span * 0.06, ty = cityY - H * 0.035;
    ctx.fillStyle = css(mixRgb(shade([0.88, 0.84, 0.76], lightK), L.haze, 0.12));
    if (era <= 1) for (let k = 0; k < 3; k++) ctx.fillRect(tx - unit * (2.2 - k * 0.6), ty - unit * (1 + k) * 0.9, unit * (4.4 - k * 1.2), unit * 0.95);
    else if (era <= 4) { ctx.fillRect(tx - unit * 0.45, ty - unit * 4.2, unit * 0.9, unit * 4.2); ctx.beginPath(); ctx.moveTo(tx - unit * 0.55, ty - unit * 4.2); ctx.lineTo(tx, ty - unit * 6); ctx.lineTo(tx + unit * 0.55, ty - unit * 4.2); ctx.fill(); }
    else { ctx.fillRect(tx - unit * 0.5, ty - unit * 7, unit, unit * 7); ctx.fillRect(tx + unit * 2, ty - unit * 5, unit * 0.35, unit * 5); }
    // walls
    if (era < 5) {
      const wy = cityY + unit * 0.5;
      ctx.fillStyle = css(mixRgb(shade([0.74, 0.68, 0.58], lightK * 0.85), L.haze, 0.1));
      ctx.fillRect(cityX - span * 0.56, wy - unit * 0.9, span * 1.12, unit * 1.0);
      for (let k = 0; k <= 8; k++) {
        const x = cityX - span * 0.56 + (k / 8) * span * 1.12;
        ctx.fillRect(x - unit * 0.45, wy - unit * 1.5, unit * 0.9, unit * 1.6);
      }
    }
    // windows by night
    if (L.windows > 0.02) {
      const wr = streamOf(`backdrop:paint:win:${sc.city.id}`);
      for (const b of houses) {
        if (wr() > 0.55 * L.windows + 0.1) continue;
        ctx.fillStyle = `rgba(255,190,110,${(0.65 * L.windows).toFixed(3)})`;
        ctx.fillRect(b.x - b.w * 0.25 + wr() * b.w * 0.3, b.y - b.h * (0.3 + wr() * 0.5), Math.max(1.2, unit * 0.14), Math.max(1.2, unit * 0.16));
      }
    }
    // campfires in the plain around the walls
    if (L.camp > 0.02) {
      const cr = streamOf(`backdrop:paint:camp:${sc.city.id}`);
      for (let i = 0; i < 70; i++) {
        const a = cr() * Math.PI * 2, r = 0.7 + cr() * 0.9;
        const x = cityX + Math.cos(a) * span * r * 0.75, y = cityY + Math.abs(Math.sin(a)) * H * 0.12 * r + unit;
        if (y > H) continue;
        const s = 1.2 + cr() * 1.6;
        const fg = ctx.createRadialGradient(x, y, 0, x, y, s * 4);
        fg.addColorStop(0, `rgba(255,190,90,${(0.9 * L.camp).toFixed(3)})`);
        fg.addColorStop(0.3, `rgba(255,120,40,${(0.35 * L.camp).toFixed(3)})`);
        fg.addColorStop(1, 'rgba(255,90,30,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(x - s * 4, y - s * 4, s * 8, s * 8);
      }
    }
    // smoke columns: the sack's, the camp's, the hearths'
    const column = (x: number, y: number, hgt: number, wid: number, col: RGB, a: number, lean: number) => {
      for (let i = 0; i < 14; i++) {
        const u = i / 13;
        const cx = x + lean * u * u * hgt, cy = y - u * hgt, r = wid * (0.5 + u * 1.6);
        const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        sg.addColorStop(0, css(col, a * (1 - u * 0.75)));
        sg.addColorStop(1, css(col, 0));
        ctx.fillStyle = sg;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    };
    if (L.smoke > 0.02) {
      const sr = streamOf(`backdrop:paint:smoke:${sc.city.id}`);
      for (let i = 0; i < 5; i++) {
        const x = cityX + (sr() - 0.5) * span * 0.8;
        column(x, cityY - unit, H * (0.35 + sr() * 0.2), unit * 1.6, mixRgb([0.3, 0.2, 0.17], L.haze, 0.25 * (1 - night)), 0.45 * L.smoke, W * 0.12);
      }
      // flames along the roofs
      for (const b of houses) {
        if (sr() > 0.35) continue;
        const fg = ctx.createRadialGradient(b.x, b.y - b.h, 0, b.x, b.y - b.h, unit * 1.4);
        fg.addColorStop(0, `rgba(255,200,90,${(0.9 * L.fire).toFixed(3)})`);
        fg.addColorStop(0.4, `rgba(255,110,30,${(0.5 * L.fire).toFixed(3)})`);
        fg.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(b.x - unit * 1.4, b.y - b.h - unit * 1.4, unit * 2.8, unit * 2.8);
      }
    }
    if (L.campSmoke > 0.02 || L.chimney > 0.02) {
      const sr = streamOf(`backdrop:paint:wisps:${sc.city.id}`);
      const pale = mixRgb([0.8, 0.78, 0.76], L.haze, 0.3);
      for (let i = 0; i < 6; i++) column(cityX + (sr() - 0.5) * span * 1.8, cityY + H * 0.02, H * 0.12, unit * 0.5, pale, 0.25 * L.campSmoke, W * 0.04);
      for (let i = 0; i < 5; i++) column(cityX + (sr() - 0.5) * span * 0.7, cityY - unit * 2, H * 0.08, unit * 0.35, pale, 0.25 * L.chimney, W * 0.03);
    }
  }

  dispose() { this.ro.disconnect(); this.root.remove(); }
}
