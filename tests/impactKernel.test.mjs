import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeImpact, cumulativeResponse, increment, collectImpacts, isExpired, gigImpactAmount, saturate,
} from '../scripts/engine/impactKernel.js';

const impact = (over = {}) => makeImpact({ target: { type: 'company', id: 'A' }, amount: 0.1, onsetTick: 5, ...over });

test('nothing happens at or before onset', () => {
  const i = impact();
  assert.equal(cumulativeResponse(i, 4), 0);
  assert.equal(cumulativeResponse(i, 5), 0);
  assert.ok(cumulativeResponse(i, 6) > 0);
});

test('response settles near amount * permanent', () => {
  const i = impact({ permanent: 0.4 });
  const settled = cumulativeResponse(i, 200);
  assert.ok(Math.abs(settled - 0.1 * 0.4) < 1e-6);
});

test('increments sum to the cumulative response', () => {
  const i = impact();
  let sum = 0;
  for (let t = 1; t <= 30; t++) sum += increment(i, t);
  assert.ok(Math.abs(sum - cumulativeResponse(i, 30)) < 1e-12);
});

test('company, sector and market targets apply correctly', () => {
  const companies = [{ id: 'A', sector: 'arms', beta: 2 }, { id: 'B', sector: 'tech', beta: 1 }];
  const t = 7;
  const company = collectImpacts([impact()], companies, t);
  assert.ok(company.returns.A > 0 && company.returns.B === 0);
  const sector = collectImpacts([impact({ target: { type: 'sector', id: 'tech' } })], companies, t);
  assert.ok(sector.returns.B > 0 && sector.returns.A === 0);
  const market = collectImpacts([impact({ target: { type: 'market' } })], companies, t);
  assert.ok(Math.abs(market.returns.A - 2 * market.returns.B) < 1e-12);
});

test('expired impacts are reported', () => {
  const i = impact();
  assert.equal(isExpired(i, 20), false);
  assert.equal(isExpired(i, 500), true);
  assert.deepEqual(collectImpacts([i], [{ id: 'A', sector: 'x' }], 500).expired, [0]);
});

test('gig impacts: failures hit harder, both are capped, bigger rewards matter more', () => {
  const win = gigImpactAmount({ outcome: 'done', reward: 2000 });
  const loss = gigImpactAmount({ outcome: 'failed', reward: 2000 });
  assert.ok(win > 0 && loss < 0);
  assert.ok(Math.abs(loss) > win);
  assert.ok(gigImpactAmount({ outcome: 'done', reward: 100000 }) <= 0.08);
  assert.ok(Math.abs(gigImpactAmount({ outcome: 'failed', reward: 1e9 })) <= 0.08);
  assert.ok(gigImpactAmount({ outcome: 'done', reward: 5000 }) > gigImpactAmount({ outcome: 'done', reward: 100 }));
});

test('saturation shrinks repeat impacts', () => {
  assert.equal(saturate(0.05, 0), 0.05);
  assert.ok(saturate(0.05, 0.05) < 0.05);
  assert.equal(saturate(0.05, 0.2), 0);
});
