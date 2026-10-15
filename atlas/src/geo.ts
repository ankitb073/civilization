import { Delaunay } from 'd3-delaunay';
import type { WorldJson } from '../../engine/src/export/contract.ts';

/** Geometry rebuilt in the browser from the Voronoi sites in world.json. */
export interface Geo {
  n: number;
  width: number;
  height: number;
  delaunay: Delaunay<number>;
  sx: Float64Array;
  sy: Float64Array;
  /** Flat polygon coords; cell i occupies polyCoords[polyStart[i]*2 .. polyStart[i+1]*2). */
  polyStart: Int32Array;
  polyCoords: Float64Array;
  land: Uint8Array;
  /** Shared Voronoi edges between neighbouring cells. */
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeXY: Float64Array; // x1,y1,x2,y2 per edge
  edgeCount: number;
  /** Adjacency (CSR). */
  nbrStart: Int32Array;
  nbrs: Int32Array;
}

export function buildGeo(w: WorldJson): Geo {
  const n = w.points.length / 2;
  const pts = Float64Array.from(w.points);
  const delaunay = new Delaunay(pts);
  const vor = delaunay.voronoi([0, 0, w.width, w.height]);
  const sx = new Float64Array(n), sy = new Float64Array(n);
  for (let i = 0; i < n; i++) { sx[i] = pts[2 * i]; sy[i] = pts[2 * i + 1]; }

  const polyStart = new Int32Array(n + 1);
  const coords: number[] = [];
  for (let i = 0; i < n; i++) {
    polyStart[i] = coords.length / 2;
    const poly = vor.cellPolygon(i);
    if (poly) for (let k = 0; k < poly.length - 1; k++) coords.push(poly[k][0], poly[k][1]);
  }
  polyStart[n] = coords.length / 2;

  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = w.elevation[i] >= w.seaLevel ? 1 : 0;

  // Shared edges via Delaunay half-edges: the Voronoi edge dual to half-edge e joins the
  // circumcentres of the two triangles on either side of it.
  const { halfedges, triangles } = delaunay;
  const cc = vor.circumcenters;
  const ea: number[] = [], eb: number[] = [], exy: number[] = [];
  for (let e = 0; e < halfedges.length; e++) {
    const o = halfedges[e];
    if (o < e) continue; // handles o === -1 (hull) too
    const a = triangles[e];
    const b = triangles[e % 3 === 2 ? e - 2 : e + 1];
    const t1 = Math.floor(e / 3), t2 = Math.floor(o / 3);
    ea.push(a);
    eb.push(b);
    exy.push(cc[2 * t1], cc[2 * t1 + 1], cc[2 * t2], cc[2 * t2 + 1]);
  }

  const counts = new Int32Array(n + 1);
  for (let i = 0; i < ea.length; i++) { counts[ea[i] + 1]++; counts[eb[i] + 1]++; }
  for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
  const nbrStart = counts.slice();
  const fill = counts.slice();
  const nbrs = new Int32Array(ea.length * 2);
  for (let i = 0; i < ea.length; i++) { nbrs[fill[ea[i]]++] = eb[i]; nbrs[fill[eb[i]]++] = ea[i]; }

  return {
    n, width: w.width, height: w.height, delaunay, sx, sy,
    polyStart, polyCoords: Float64Array.from(coords), land,
    edgeA: Int32Array.from(ea), edgeB: Int32Array.from(eb), edgeXY: Float64Array.from(exy), edgeCount: ea.length,
    nbrStart, nbrs,
  };
}

export function addCellToPath(g: Geo, path: Path2D, i: number) {
  const s = g.polyStart[i], e = g.polyStart[i + 1];
  if (e - s < 3) return;
  const c = g.polyCoords;
  path.moveTo(c[2 * s], c[2 * s + 1]);
  for (let k = s + 1; k < e; k++) path.lineTo(c[2 * k], c[2 * k + 1]);
  path.closePath();
}
