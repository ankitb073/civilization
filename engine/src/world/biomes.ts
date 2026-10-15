export const BIOME = {
  ocean: 0,
  shallows: 1,
  ice: 2,
  tundra: 3,
  taiga: 4,
  temperateForest: 5,
  steppe: 6,
  mediterranean: 7,
  hotDesert: 8,
  coldDesert: 9,
  savanna: 10,
  tropicalForest: 11,
  wetland: 12,
  alpine: 13,
} as const;

export const BIOMES: { id: number; name: string; color: string; fertility: number; capacity: number }[] = [
  // capacity = people per km² under Bronze Age farming, before river/fertility bonuses
  { id: 0, name: 'Ocean', color: '#a9c3cc', fertility: 0, capacity: 0 },
  { id: 1, name: 'Shallow sea', color: '#bdd3d6', fertility: 0, capacity: 0 },
  { id: 2, name: 'Ice', color: '#eeefe9', fertility: 0, capacity: 0.01 },
  { id: 3, name: 'Tundra', color: '#cdd1bf', fertility: 0.03, capacity: 0.15 },
  { id: 4, name: 'Taiga', color: '#93a68c', fertility: 0.15, capacity: 0.6 },
  { id: 5, name: 'Temperate forest', color: '#a1b98c', fertility: 0.55, capacity: 3.5 },
  { id: 6, name: 'Steppe', color: '#d5cf9c', fertility: 0.42, capacity: 1.6 },
  { id: 7, name: 'Mediterranean scrub', color: '#ccc691', fertility: 0.5, capacity: 4 },
  { id: 8, name: 'Hot desert', color: '#e7d5a6', fertility: 0.03, capacity: 0.08 },
  { id: 9, name: 'Cold desert', color: '#dbd1b3', fertility: 0.04, capacity: 0.1 },
  { id: 10, name: 'Savanna', color: '#d0c687', fertility: 0.42, capacity: 2.5 },
  { id: 11, name: 'Tropical forest', color: '#83aa78', fertility: 0.35, capacity: 2.2 },
  { id: 12, name: 'Wetland', color: '#a6c1a2', fertility: 0.45, capacity: 2.5 },
  { id: 13, name: 'Alpine', color: '#bdb5a8', fertility: 0.05, capacity: 0.25 },
];

export function classifyBiome(t: number, p: number, elevKm: number, lat: number): number {
  if (t < -7) return BIOME.ice;
  if (elevKm > 2.6) return BIOME.alpine;
  if (t < 0) return BIOME.tundra;
  if (t < 5) return p > 320 ? BIOME.taiga : BIOME.tundra;
  if (t < 18) {
    if (p < 230) return t < 11 ? BIOME.coldDesert : BIOME.hotDesert;
    if (p < 520) return BIOME.steppe;
    if (t > 12.5 && p < 850 && Math.abs(lat) > 26 && Math.abs(lat) < 44) return BIOME.mediterranean;
    return BIOME.temperateForest;
  }
  if (p < 300) return BIOME.hotDesert;
  if (p < 1050) return BIOME.savanna;
  return BIOME.tropicalForest;
}

export const RES = {
  copper: 1 << 0,
  tin: 1 << 1,
  iron: 1 << 2,
  silver: 1 << 3,
  gold: 1 << 4,
  salt: 1 << 5,
  horses: 1 << 6,
  timber: 1 << 7,
  stone: 1 << 8,
  spice: 1 << 9,
  coal: 1 << 10,
  oil: 1 << 11,
} as const;

export type ResourceName = keyof typeof RES;
export const RESOURCE_NAMES = Object.keys(RES) as ResourceName[];
