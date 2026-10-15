// Debug: render a world (optionally with a per-cell color override) to PNG.
import { Delaunay } from 'd3-delaunay';
import type { World } from '../world/generate.ts';
import { BIOMES, RES } from '../world/biomes.ts';
import { writePng, hexToRgb } from './png.ts';

export function renderWorld(world: World, path: string, scale = 0.5, colorOf?: (cell: number) => [number, number, number] | null): void {
  const w = Math.round(world.width * scale);
  const h = Math.round(world.height * scale);
  const pts = new Float64Array(world.n * 2);
  for (let i = 0; i < world.n; i++) { pts[2 * i] = world.x[i]; pts[2 * i + 1] = world.y[i]; }
  const d = new Delaunay(pts);
  const rgb = new Uint8Array(w * h * 3);
  const biomeRgb = BIOMES.map((b) => hexToRgb(b.color));
  let hint = 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const c = d.find((px + 0.5) / scale, (py + 0.5) / scale, hint);
      hint = c;
      let col = biomeRgb[world.biome[c]];
      if (world.land[c]) {
        const shade = 1 - Math.min(0.45, world.elev[c] * 0.5);
        col = [col[0] * shade, col[1] * shade, col[2] * shade];
        if (world.flux[c] > world.riverThreshold) col = [70, 110, 160];
      } else {
        const depth = Math.min(1, -world.elev[c]);
        col = [col[0] * (1 - depth * 0.35), col[1] * (1 - depth * 0.3), col[2] * (1 - depth * 0.2)];
      }
      const o = colorOf?.(c);
      if (o) col = [col[0] * 0.35 + o[0] * 0.65, col[1] * 0.35 + o[1] * 0.65, col[2] * 0.35 + o[2] * 0.65];
      if (!colorOf && world.resources[c] & RES.tin) col = [200, 40, 160];
      const k = (py * w + px) * 3;
      rgb[k] = col[0]; rgb[k + 1] = col[1]; rgb[k + 2] = col[2];
    }
  }
  writePng(path, w, h, rgb);
}
