// Cities in 3D — the reusable entry point. Any view can put a city from the record into its own three.js scene:
//
//   import { loadCityRecord, buildCity } from '../three/city/index.ts';   // lazy-load this module (dynamic import)
//   const rec = await loadCityRecord('set:0');      // fetches what it needs (timeline, cities.json, the city's page)
//   const city = buildCity(rec, 1200);              // a THREE.Group, in lots (1 unit = one drawn building's plot)
//   city.scale.setScalar(5 / city.userData.radius); // fit it: userData.radius is the model's radius in lots
//   scene.add(city);
//   // later: city.userData.model.setYear(1300) re-generates in place; city.userData.model.dispose() frees it.
//
// The group is centred on the temple square, x east and z south (as on the map), ground at y = 0; it brings its own
// ground, water and (unless { plinth: false }) a plinth, but no lights. Same record and year → the same city.

import type { Group } from 'three';
import { CityModel, type ModelOpts } from './model.ts';
import type { CityRecord } from './record.ts';

export { CityModel } from './model.ts';
export { loadCityRecord, cityAt, type CityRecord, type CityYear } from './record.ts';

export interface CityGroupData { radius: number; year: number; model: CityModel }

/** Generate a settlement's 3D model at a year (see the module comment). */
export function buildCity(settlement: CityRecord, year: number, opts: ModelOpts = {}): Group {
  const model = new CityModel(settlement, opts);
  model.setYear(year);
  const g = model.group;
  const data: CityGroupData = { radius: model.P, year, model };
  g.userData = data;
  const set = model.setYear.bind(model);
  model.setYear = (y: number) => { const r = set(y); data.radius = model.P; data.year = y; return r; };
  return g;
}
