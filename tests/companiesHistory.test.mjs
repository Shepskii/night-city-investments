import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCompany, normalizeTicker } from '../scripts/engine/companyConfig.js';
import { appendClose, emptyHistory, getSeries, pruneHistory, rangeStats, HISTORY_CAP } from '../scripts/engine/history.js';
import { ticksDue, dayIndex, msToDate, DAY_MS } from '../scripts/engine/clock.js';
import { splitState, mergeState, marketMood, pruneState } from '../scripts/engine/stateSplit.js';
import { createInitialState, stepMarket } from '../scripts/engine/marketModel.js';
import { equalWeightIndex } from '../scripts/engine/fundNav.js';
import { sparkline, lineChart, trendColor } from '../scripts/ui/components/chart.js';
import { SAMPLE_COMPANIES } from '../tools/sample-companies.mjs';

test('ticker normalisation', () => {
  assert.equal(normalizeTicker(' ara-1 '), 'ARA1');
  assert.equal(normalizeTicker('abcdefghij'), 'ABCDEF');
  assert.equal(normalizeTicker(null), '');
});

test('sanitizeCompany accepts a minimal valid form and fills defaults', () => {
  const r = sanitizeCompany({ name: ' Arasaka ', ticker: 'ara', initialPrice: '240' });
  assert.equal(r.ok, true);
  assert.equal(r.company.id, 'ARA');
  assert.equal(r.company.name, 'Arasaka');
  assert.equal(r.company.initialPrice, 240);
  assert.equal(r.company.volatility, 3);
  assert.equal(r.company.dividend.policy, 'none');
  assert.equal(r.company.listed, true);
  assert.equal(r.company.status, 'active');
});

test('sanitizeCompany rejects bad input', () => {
  assert.deepEqual(sanitizeCompany({ name: '', ticker: 'A', initialPrice: 0 }).errors, ['name-required', 'ticker-invalid', 'price-invalid']);
  assert.equal(sanitizeCompany({ name: 'X', ticker: 'XX', initialPrice: 0.5 }).ok, false);
});

test('sanitizeCompany clamps ranges and cleans aliases', () => {
  const r = sanitizeCompany({
    name: 'X', ticker: 'XX', initialPrice: 10, volatility: 99, beta: 9, liquidity: 0,
    aliases: 'Foo, foo ,Bar,,', sector: 'nonsense', status: 'weird',
    dividend: { policy: 'yield', yield: 5, payoutDay: 40, frequency: 'weekly' },
  });
  assert.equal(r.company.volatility, 5);
  assert.equal(r.company.beta, 3);
  assert.equal(r.company.liquidity, 1);
  assert.deepEqual(r.company.aliases, ['Foo', 'Bar']);
  assert.equal(r.company.sector, 'other');
  assert.equal(r.company.status, 'active');
  assert.equal(r.company.dividend.yield, 1);
  assert.equal(r.company.dividend.payoutDay, 28);
  assert.equal(r.company.dividend.frequency, 'quarterly');
});

test('sanitizeCompany keeps an existing id when the ticker is edited', () => {
  assert.equal(sanitizeCompany({ id: 'ARA', name: 'X', ticker: 'ARAS', initialPrice: 10 }).company.id, 'ARA');
});

test('history ring buffer stores cents and trims the oldest', () => {
  let h = emptyHistory();
  for (let t = 0; t < HISTORY_CAP + 5; t++) h = appendClose(h, 'A', t, 100 + t / 100);
  assert.equal(h.series.A.closes.length, HISTORY_CAP);
  assert.equal(h.series.A.startTick, 5);
  assert.equal(getSeries(h, 'A', 2).length, 2);
  assert.equal(getSeries(h, 'A').at(-1), 100 + (HISTORY_CAP + 4) / 100);
  assert.deepEqual(getSeries(h, 'missing'), []);
});

test('history append does not mutate and prune drops removed companies', () => {
  const h0 = emptyHistory();
  const h1 = appendClose(h0, 'A', 1, 10);
  assert.deepEqual(h0.series, {});
  assert.deepEqual(Object.keys(pruneHistory(appendClose(h1, 'B', 1, 5), ['A']).series), ['A']);
});

test('rangeStats', () => {
  assert.deepEqual(rangeStats([100, 120, 90, 110]), { high: 120, low: 90, change: 0.1 });
  assert.equal(rangeStats([]).high, null);
});

test('ticksDue: the first run baselines without ticking, and time moving backwards leaves the market ahead', () => {
  const now = 50 * DAY_MS + 123;
  assert.deepEqual(ticksDue({ lastDay: null, nowMs: now }), { ticks: 0, day: 50, rebaseline: true, skipped: 0, ahead: 0 });
  assert.deepEqual(ticksDue({ lastDay: 60, nowMs: now }), { ticks: 0, day: 50, rebaseline: false, skipped: 0, ahead: 10 });
  assert.equal(ticksDue({ lastDay: 50, nowMs: now }).ahead, 0);
  assert.equal(ticksDue({ lastDay: 60, nowMs: 60 * DAY_MS }).ticks, 0, 'aligned: nothing due');
  assert.equal(ticksDue({ lastDay: 60, nowMs: 61 * DAY_MS }).ticks, 1, 'ticking resumes once the calendar passes the market');
});

test('ticksDue: counts whole days and caps long gaps', () => {
  assert.equal(ticksDue({ lastDay: 50, nowMs: 50 * DAY_MS + 5 }).ticks, 0);
  assert.equal(ticksDue({ lastDay: 50, nowMs: 53 * DAY_MS }).ticks, 3);
  const big = ticksDue({ lastDay: 0, nowMs: 500 * DAY_MS, cap: 60 });
  assert.equal(big.ticks, 60);
  assert.equal(big.skipped, 440);
  assert.equal(big.day, 500);
});

test('date conversion', () => {
  assert.deepEqual(msToDate(Date.UTC(2045, 2, 9)), { year: 2045, month: 3, day: 9 });
  assert.equal(dayIndex(Date.UTC(1970, 0, 2)), 1);
});

test('split and merge round-trip, and the public half hides fair value and regime', () => {
  const state = stepMarket({ state: createInitialState({ companies: SAMPLE_COMPANIES }), companies: SAMPLE_COMPANIES, seed: 's' }).state;
  const { pub, hidden } = splitState(state, 42);
  assert.equal(pub.lastDay, 42);
  assert.deepEqual(Object.keys(pub.companies.ARA).sort(), ['prevClose', 'price']);
  assert.equal(JSON.stringify(pub).includes('fair'), false);
  assert.equal(JSON.stringify(pub).includes('regime'), false);
  assert.deepEqual(mergeState(pub, hidden), state);
});

test('mergeState tolerates missing hidden data', () => {
  const merged = mergeState({ tickIndex: 3, companies: { A: { price: 50, prevClose: 49 } } }, null);
  assert.equal(merged.companies.A.fair, 50);
  assert.equal(merged.companies.A.vol, 1);
  assert.equal(merged.regime, 'sideways');
});

test('pruneState and mood', () => {
  const s = createInitialState({ companies: SAMPLE_COMPANIES });
  assert.deepEqual(Object.keys(pruneState(s, ['ARA']).companies), ['ARA']);
  assert.equal(marketMood('crash'), 'panic');
  assert.equal(marketMood('???'), 'steady');
});

test('equal-weight index starts at 100 and moves with prices', () => {
  const items = [{ price: 100, prevClose: 100, base: 100 }, { price: 50, prevClose: 50, base: 50 }];
  assert.equal(equalWeightIndex(items).level, 100);
  const up = equalWeightIndex([{ price: 110, prevClose: 100, base: 100 }, { price: 55, prevClose: 50, base: 50 }]);
  assert.equal(up.level, 110);
  assert.ok(Math.abs(up.changePct - 0.1) < 1e-9);
  assert.equal(equalWeightIndex([]).level, 100);
});

test('charts return svg and colour by trend', () => {
  assert.ok(sparkline([1, 2, 3]).startsWith('<svg'));
  assert.ok(sparkline([1, 2, 3]).includes(trendColor(1)));
  assert.ok(sparkline([3, 2, 1]).includes(trendColor(-1)));
  assert.notEqual(trendColor(1), trendColor(-1));
  assert.ok(!sparkline([1]).includes('polyline'));
  assert.ok(lineChart([5, 6, 7, 6]).includes('<polygon'));
  assert.equal(trendColor(0), '#888888');
});
