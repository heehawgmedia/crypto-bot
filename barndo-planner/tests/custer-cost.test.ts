import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimate, GROUP_ORDER } from '../src/custer/costModel';
import { OPTIONS } from '../src/custer/options';
import { KIT_OFFERS, STOCK_PLANS } from '../src/custer/research';
import { SOURCE_BY_ID, SOURCES } from '../src/custer/sources';
import { RATES, SETTINGS } from '../src/custer/unitCosts';

const estimates = OPTIONS.map((o) => estimate(o, RATES, SETTINGS));

// Every line item the owner asked for, by the id of the line that covers it.
const REQUIRED = [
  'plans',
  'permits',
  'survey',
  'sitework',
  'driveway',
  'slab',
  'shell',
  'erection',
  'insulation',
  'framing',
  'electrical',
  'plumbing',
  'hvac',
  'well',
  'septic',
  'electric-run',
  'windows-doors',
  'drywall',
  'flooring',
  'cabinets',
  'appliances',
  'fixtures',
  'paint',
  'porches',
  'gutters',
  'landscaping',
  'loan',
  'builders-risk',
  'contingency',
];

test('every requested line item is priced for every option', () => {
  for (const e of estimates) {
    const ids = new Set(e.items.map((i) => i.id));
    for (const id of REQUIRED) assert.ok(ids.has(id), `${e.option.id} is missing ${id}`);
    for (const i of e.items) {
      assert.ok(GROUP_ORDER.includes(i.group));
      assert.ok(i.total.low > 0, `${e.option.id} ${i.id} low is zero`);
      assert.ok(i.total.low <= i.total.mid && i.total.mid <= i.total.high, `${e.option.id} ${i.id} range is out of order`);
    }
  }
});

test('totals add up and the likely range sits inside the all-low and all-high totals', () => {
  for (const e of estimates) {
    const mid = e.items.reduce((s, i) => s + i.total.mid, 0);
    assert.equal(e.total.mid, mid);
    assert.equal(
      e.extremes.low,
      e.items.reduce((s, i) => s + i.total.low, 0),
    );
    assert.equal(
      e.extremes.high,
      e.items.reduce((s, i) => s + i.total.high, 0),
    );
    assert.ok(e.extremes.low < e.total.low && e.total.low < e.total.mid && e.total.mid < e.total.high && e.total.high < e.extremes.high);
    assert.equal(e.perHeatedSf.mid, Math.round(e.total.mid / e.quantities.heatedSf));
  }
});

test('the house-only figure agrees with the two regional anchors', () => {
  for (const e of estimates) {
    // BuildMax: Kentucky turnkey $125 to $150 per sq ft by local contractors.
    assert.ok(e.houseOnly.perSf >= 120 && e.houseOnly.perSf <= 155, `${e.option.id} house-only $${e.houseOnly.perSf}/sf`);
    // Summertown Metals published turnkey: $102 to $123 per sq ft under roof.
    assert.ok(e.houseOnly.perSfUnderRoof >= 100 && e.houseOnly.perSfUnderRoof <= 125, `${e.option.id} $${e.houseOnly.perSfUnderRoof}/sf under roof`);
  }
});

test('contingency stays within the 10 to 15 percent the owner asked for', () => {
  for (const e of estimates) {
    const c = e.items.find((i) => i.id === 'contingency');
    assert.ok(c);
    const share = c.total.mid / e.construction.mid;
    assert.ok(share >= 0.1 && share <= 0.15, `${e.option.id} contingency ${(share * 100).toFixed(1)}%`);
  }
});

test('the smallest footprint has the lowest total', () => {
  const byTotal = [...estimates].sort((a, b) => a.total.mid - b.total.mid);
  assert.equal(byTotal[0].option.id, 'a');
});

test('every cited source exists, and research entries are complete', () => {
  for (const [key, rate] of Object.entries(RATES)) {
    for (const id of rate.sources) assert.ok(SOURCE_BY_ID[id], `rate ${key} cites unknown source ${id}`);
    assert.ok(rate.range.low <= rate.range.mid && rate.range.mid <= rate.range.high, `rate ${key}`);
  }
  for (const e of estimates) for (const i of e.items) for (const id of i.sources) assert.ok(SOURCE_BY_ID[id], `${i.id} cites unknown source ${id}`);
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length, 'duplicate source ids');
  for (const s of SOURCES) assert.match(s.url, /^https:\/\//);
  assert.ok(STOCK_PLANS.length >= 10 && KIT_OFFERS.length >= 10);
  for (const p of STOCK_PLANS) assert.ok(p.url.startsWith('https://') && p.heatedSf > 0 && p.price > 0, p.number);
  for (const k of KIT_OFFERS) assert.ok(k.url.startsWith('https://') && k.price.length > 0, k.provider);
});
