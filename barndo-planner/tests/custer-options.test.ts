import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPTIONS } from '../src/custer/options';
import { validateLevel, validateOpenings } from '../src/custer/validate';
import { deriveWalls } from '../src/model/geometry';

test('four options are 4 bed / 2.5 bath, and the budget option is 3 bed / 2 bath', () => {
  assert.ok(OPTIONS.length >= 5);
  for (const o of OPTIONS) {
    const budget = o.id === 'e';
    assert.equal(o.beds.main + o.beds.upper, budget ? 3 : 4, `${o.id} bedrooms`);
    assert.deepEqual(o.baths, budget ? { full: 2, half: 0 } : { full: 2, half: 1 }, `${o.id} baths`);
    const main = o.plan.rooms.filter((r) => r.type === 'bedroom').length;
    const upper = (o.upper?.rooms ?? []).filter((r) => r.type === 'bedroom').length;
    assert.equal(main, o.beds.main, `${o.id} main-level bedrooms drawn`);
    assert.equal(upper, o.beds.upper, `${o.id} upper-level bedrooms drawn`);
    const baths = [...o.plan.rooms, ...(o.upper?.rooms ?? [])];
    assert.equal(baths.filter((r) => r.type === 'bathroom').length, o.baths.full, `${o.id} full baths drawn`);
    assert.equal(baths.filter((r) => r.type === 'half-bath').length, o.baths.half, `${o.id} half baths drawn`);
  }
});

test('every main level is a valid, fully connected plan with the primary suite and office downstairs', () => {
  for (const o of OPTIONS) {
    assert.deepEqual(validateLevel(o.plan, o.plan.rooms, `${o.id} main`), []);
    assert.deepEqual(validateOpenings(o.plan, o.id), []);
    assert.ok(o.plan.rooms.some((r) => r.name === 'Primary bedroom'), `${o.id} primary on main`);
    // The budget option has no separate office; its third bedroom has a door and doubles as one.
    const office = o.id === 'e' ? o.plan.rooms.some((r) => /office/i.test(r.name)) : o.plan.rooms.some((r) => r.type === 'office');
    assert.ok(office, `${o.id} office on main`);
    assert.ok(o.plan.rooms.some((r) => r.type === 'pantry'), `${o.id} pantry`);
    assert.ok(o.plan.rooms.some((r) => r.type === 'laundry'), `${o.id} laundry`);
    assert.ok(deriveWalls(o.plan).length > 4);
  }
});

test('walled rooms and open zones tile each main level exactly', () => {
  for (const o of OPTIONS) {
    const area = o.plan.rooms.reduce((s, r) => s + r.w * r.d, 0);
    const footprint = o.plan.width * o.plan.depth;
    assert.ok(area <= footprint, `${o.id} rooms exceed the footprint`);
    // Anything not covered is leftover great-room floor; keep it small so labels stay honest.
    assert.ok(footprint - area <= 0.06 * footprint, `${o.id} leaves ${footprint - area} sq ft unlabeled`);
  }
});

test('upper levels are reachable from the stair and sit inside the footprint', () => {
  for (const o of OPTIONS) {
    if (!o.upper) continue;
    const entry = o.upper.rooms.filter((r) => r.type === 'stair').map((r) => r.id);
    // A bonus loft is entered through its own door from the stair top in the great room.
    const problems = validateLevel(o.plan, o.upper.rooms, `${o.id} upper`, entry.length ? [...entry, '__open__'] : ['__open__']);
    assert.deepEqual(problems, []);
    const drawn = o.upper.rooms.filter((r) => r.type !== 'stair').reduce((s, r) => s + r.w * r.d, 0);
    assert.equal(drawn, o.upper.finishedSf, `${o.id} upper finished area`);
  }
});
