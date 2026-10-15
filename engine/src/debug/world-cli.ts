import { generateWorld } from '../world/generate.ts';
import { renderWorld } from './render-world.ts';
import { BIOMES, RES, RESOURCE_NAMES } from '../world/biomes.ts';

const seed = Number(process.argv[2] ?? 1);
const out = process.argv[3] ?? `world-${seed}.png`;
const t = performance.now();
const w = generateWorld(seed);
console.log(`cells=${w.n} gen=${(performance.now() - t).toFixed(0)}ms cellArea=${w.cellArea}km²`);
const counts = new Map<string, number>();
for (let i = 0; i < w.n; i++) counts.set(BIOMES[w.biome[i]].name, (counts.get(BIOMES[w.biome[i]].name) ?? 0) + 1);
console.log([...counts].map(([k, v]) => `${k}:${v}`).join('  '));
console.log('landmasses', w.landmassSize.filter((s) => s > 5).join(','), 'regions', w.regionCount, 'rivers', w.rivers.length);
const res = RESOURCE_NAMES.map((r) => { let c = 0; for (let i = 0; i < w.n; i++) if (w.resources[i] & RES[r]) c++; return `${r}:${c}`; });
console.log(res.join(' '));
renderWorld(w, out);
console.log('wrote', out);
