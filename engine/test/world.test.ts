// World generation: plausible geography and the properties the atlas relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/generate.ts';
import { RES } from '../src/world/biomes.ts';

const w = generateWorld(5);

test('land fraction is between 30% and 45%', () => {
  let land = 0;
  for (let i = 0; i < w.n; i++) land += w.land[i];
  const f = land / w.n;
  assert.ok(f >= 0.3 && f <= 0.45, `land fraction ${f}`);
});

test('every land cell belongs to a region; sea cells to none', () => {
  for (let i = 0; i < w.n; i++) {
    if (w.land[i]) assert.ok(w.region[i] >= 0 && w.region[i] < w.regionCount, `land cell ${i} region ${w.region[i]}`);
    else assert.equal(w.region[i], -1);
  }
});

test('major rivers run downhill to the sea', () => {
  assert.ok(w.rivers.length > 0);
  for (const rv of w.rivers) {
    const mouth = rv.cells[rv.cells.length - 1];
    const d = w.downhill[mouth];
    assert.ok(d >= 0 && !w.land[d], `river mouth ${mouth} drains to ${d}`);
    for (let k = 0; k + 1 < rv.cells.length; k++) assert.equal(w.downhill[rv.cells[k]], rv.cells[k + 1]);
  }
});

test('tin exists (and is rare)', () => {
  let tin = 0;
  for (let i = 0; i < w.n; i++) if (w.resources[i] & RES.tin) tin++;
  assert.ok(tin > 0 && tin < w.n * 0.02, `tin cells ${tin}`);
});

test('Voronoi sites are rounded to 0.1 (the atlas rebuilds identical cells)', () => {
  for (let i = 0; i < w.n; i++) {
    assert.equal(Math.round(w.x[i] * 10) / 10, w.x[i]);
    assert.equal(Math.round(w.y[i] * 10) / 10, w.y[i]);
  }
});
