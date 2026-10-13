import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deriveWalls,
  exteriorWallArea,
  mergeIntervals,
  porchArea,
  rectMinus,
  roofMetrics,
  roomFits,
  solidSpans,
  spawnPoint,
} from '../src/model/geometry';
import { blank40x60, classic40x60 } from '../src/model/presets';
import type { Plan } from '../src/model/types';

test('mergeIntervals unions overlapping and touching intervals', () => {
  assert.deepEqual(mergeIntervals([[0, 10], [10, 20], [25, 30], [27, 28]]), [[0, 20], [25, 30]]);
});

test('a blank plan has exactly four exterior walls', () => {
  const walls = deriveWalls(blank40x60());
  assert.equal(walls.length, 4);
  assert.ok(walls.every((w) => w.exterior));
  const east = walls.find((w) => w.side === 'E');
  assert.ok(east);
  assert.equal(east.openings.length, 1); // the entry door
  assert.deepEqual(solidSpans(east), [[0, 28], [31, 60]]);
});

test('shared room edges produce a single interior wall with the door opening', () => {
  const plan: Plan = { ...blank40x60(), exteriorDoors: [], windows: [] };
  plan.rooms = [
    { id: 'a', name: 'A', type: 'bedroom', x: 0, z: 0, w: 20, d: 20, doors: [{ side: 'E', offset: 5, width: 3 }] },
    { id: 'b', name: 'B', type: 'office', x: 20, z: 0, w: 20, d: 20, doors: [] },
  ];
  const walls = deriveWalls(plan);
  const interior = walls.filter((w) => !w.exterior);
  // shared wall at x=20 plus the south edges of both rooms (merged into one wall at z=20)
  assert.equal(interior.length, 2);
  const shared = interior.find((w) => w.axis === 'z');
  assert.ok(shared);
  assert.equal(shared.at, 20);
  assert.deepEqual(solidSpans(shared), [[0, 5], [8, 20]]);
  const south = interior.find((w) => w.axis === 'x');
  assert.ok(south);
  assert.deepEqual([south.start, south.end], [0, 40]);
});

test('room edges on the footprint perimeter do not create duplicate walls', () => {
  const plan = classic40x60();
  const walls = deriveWalls(plan);
  const northWalls = walls.filter((w) => w.axis === 'x' && w.at === 0);
  assert.equal(northWalls.length, 1);
  assert.ok(northWalls[0].exterior);
});

test('roomFits rejects overlaps and out-of-bounds placements', () => {
  const plan = classic40x60();
  const shop = plan.rooms[0];
  assert.ok(roomFits(plan, { x: 0, z: 0, w: 40, d: 16 }, shop.id));
  assert.ok(!roomFits(plan, { x: 0, z: 0, w: 40, d: 17 }, shop.id)); // overlaps the pantry
  assert.ok(!roomFits(plan, { x: -1, z: 0, w: 40, d: 16 }, shop.id));
  assert.ok(!roomFits(plan, { x: 0, z: 0, w: 3, d: 16 }, shop.id)); // below minimum size
});

test('roof metrics follow pitch and span', () => {
  const plan = blank40x60(); // ridge along z, span 40, pitch 4:12, eave 12
  const m = roofMetrics(plan);
  assert.equal(m.span, 40);
  assert.equal(m.ridgeHeight, 12 + 20 * (4 / 12));
  const expectedRafter = (20 + 1.5) * Math.sqrt(1 + (4 / 12) ** 2);
  assert.ok(Math.abs(m.rafterLength - expectedRafter) < 1e-9);
  assert.ok(Math.abs(m.area - 2 * expectedRafter * 63) < 1e-9);
  assert.ok(exteriorWallArea(plan) > 2 * (40 + 60) * 12);
});

test('porch areas wrap around shared corners without double counting', () => {
  const plan = blank40x60();
  plan.porches = { N: 8, S: 0, E: 6, W: 0 };
  assert.equal(porchArea(plan), (40 + 6) * 8 + 60 * 6);
});

test('rectMinus decomposes the open area correctly', () => {
  const rects = rectMinus({ x: 0, z: 0, w: 10, d: 10 }, [{ x: 0, z: 0, w: 5, d: 5 }]);
  const area = rects.reduce((s, r) => s + r.w * r.d, 0);
  assert.equal(area, 75);
});

test('spawn point lands in open floor area', () => {
  const plan = classic40x60();
  const p = spawnPoint(plan);
  assert.ok(p.z > 16 && p.z < 36, `expected spawn in the great room, got z=${p.z}`);
});
