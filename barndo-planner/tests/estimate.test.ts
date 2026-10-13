import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimate } from '../src/cost/estimate';
import { makeProject } from '../src/model/presets';
import type { Project } from '../src/model/types';

const clone = (p: Project): Project => structuredClone(p);

test('estimate totals reconcile and metrics are populated', () => {
  const est = estimate(makeProject('classic'));
  const sum = est.items.reduce((s, i) => s + i.amount, 0);
  assert.equal(est.subtotal, sum);
  assert.equal(est.total, est.subtotal + est.contingency);
  assert.equal(est.metrics.footprintSf, 2400);
  assert.equal(est.metrics.shopSf, 640);
  assert.equal(est.metrics.livingSf, 1760);
  assert.equal(est.metrics.bedrooms, 3);
  assert.equal(est.metrics.fullBaths, 2);
  assert.ok(est.total > 200000 && est.total < 800000, `total ${est.total} outside sanity range`);
  assert.ok(est.metrics.costPerSf > 80 && est.metrics.costPerSf < 300);
});

test('a bigger footprint costs more', () => {
  const base = makeProject('classic');
  const bigger = clone(base);
  bigger.plan.width = 50;
  assert.ok(estimate(bigger).total > estimate(base).total);
});

test('upgrading options raises the total; regional multiplier scales it', () => {
  const base = makeProject('classic');
  const lux = clone(base);
  lux.options.interiorFinish = 'luxury';
  lux.options.kitchenTier = 'luxury';
  lux.options.roofing = 'standing-seam';
  assert.ok(estimate(lux).total > estimate(base).total);

  const regional = clone(base);
  regional.options.regionMultiplier = 1.5;
  const ratio = estimate(regional).subtotal / estimate(base).subtotal;
  assert.ok(Math.abs(ratio - 1.5) < 0.01, `ratio ${ratio}`);
});

test('contingency percent applies to the subtotal', () => {
  const p = makeProject('starter');
  p.options.contingencyPct = 20;
  const est = estimate(p);
  assert.equal(est.contingency, Math.round(est.subtotal * 0.2));
});

test('a plan without bathrooms produces a warning', () => {
  const p = makeProject('blank');
  const est = estimate(p);
  assert.ok(est.warnings.some((w) => w.includes('bathroom')));
});
