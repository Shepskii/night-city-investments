import { test } from 'node:test';
import assert from 'node:assert/strict';
import { band, CREWS, DEFAULTS, createBusiness, stepPeriod, runBusiness, valuation } from '../tools/business-model.mjs';

test('outcome bands follow the margin, with criticals and fumbles', () => {
  assert.deepEqual([-3, 0, 1, 2, 5, 6, 7, 8].map((m) => band(m, null)),
    ['failure', 'narrow', 'narrow', 'solid', 'solid', 'strong', 'strong', 'exceptional']);
  assert.equal(band(-1, 'fumble'), 'fumble');
  assert.equal(band(0, 'fumble'), 'narrow', 'a fumble that still passes is not a fumble result');
  assert.equal(band(1, 'success'), 'exceptional');
});

test('the same seed always gives the same business', () => {
  assert.deepEqual(runBusiness(CREWS.average, 'repeat'), runBusiness(CREWS.average, 'repeat'));
  assert.notDeepEqual(runBusiness(CREWS.average, 'repeat'), runBusiness(CREWS.average, 'other'));
});

test('a strong crew climbs every stage in order, within the run', () => {
  const r = runBusiness(CREWS.strong, 'climb');
  assert.ok(r.registered < r.chartered && r.chartered < r.eligible, JSON.stringify(r));
  assert.ok(r.eligible >= 28, 'no business can list before the milestones allow (about 28 periods)');
});

test('a side business earns within its stage band', () => {
  const b = createBusiness();
  for (let i = 0; i < 4; i++) stepPeriod(b, CREWS.average, 'band', DEFAULTS);
  const weekly = b.profits.reduce((a, x) => a + x, 0) / b.profits.length;
  assert.ok(weekly > 20 && weekly < 150, `weekly profit ${weekly}`);
});

test('the valuation adds net assets to annualised profit at the multiple, never counting a loss', () => {
  const b = { till: 1000, assets: 4000, profits: [100, 100] };
  assert.equal(valuation(b), 5000 + 100 * 52 * DEFAULTS.listing.multiple);
  assert.equal(valuation({ till: 1000, assets: 4000, profits: [-500] }), 5000);
});
