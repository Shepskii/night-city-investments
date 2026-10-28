import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, stepMarket, normalizeControls, resolveControls, pruneControls, makeGlide, makeBias, glideFeasible,
  glideEndTick, restoreExpired, appendClose, truncateHistory, resetSeries, emptyHistory, getSeries,
  previewScenario, applyScenario, isoToDay, ipoStatus, ipoPrice, planSubscription, allocationRatio, ipoDemand, settleIpoOrders,
  applyRequests, emptyPortfolio, movedMoneySince, sanitizeCompany,
} from '../scripts/engine/index.js';

const companies = [
  { id: 'A', ticker: 'AAA', sector: 'tech', initialPrice: 100, volatility: 3, beta: 1, status: 'active', listed: true },
  { id: 'B', ticker: 'BBB', sector: 'tech', initialPrice: 50, volatility: 2, beta: 1, status: 'active', listed: true },
  { id: 'C', ticker: 'CCC', sector: 'arms', initialPrice: 80, volatility: 4, beta: 1.2, status: 'active', listed: true },
];

function run(ticks, controls, state = createInitialState({ companies })) {
  let s = state;
  let c = normalizeControls(controls);
  const prices = [];
  for (let i = 0; i < ticks; i++) {
    const tick = s.tickIndex + 1;
    const step = stepMarket({ state: s, companies, seed: 'seed', controls: resolveControls(c, tick) });
    s = step.state;
    c = pruneControls(c, tick);
    prices.push(s.companies.A.price);
  }
  return { state: s, controls: c, prices };
}

// ── Glides ───────────────────────────────────────────────────────────────────

test('a glide lands exactly on its target on the last day, and then ends', () => {
  const controls = { glides: [makeGlide({ id: 'g', companyId: 'A', target: 130, startTick: 1, duration: 10, noise: 0.5 })] };
  const { state, controls: after, prices } = run(10, controls);
  assert.equal(state.companies.A.price, 130);
  assert.equal(prices.at(-1), 130);
  assert.equal(after.glides.length, 0, 'finished glides are removed');
  assert.ok(Math.abs(state.companies.A.fair - 130) / 130 < 0.01, 'fair value follows, so the price does not snap back');
});

test('a glide with no noise is a smooth line, and other companies are unaffected', () => {
  const controls = { glides: [makeGlide({ id: 'g', companyId: 'A', target: 120, startTick: 1, duration: 8, noise: 0 })] };
  const { prices, state } = run(8, controls);
  for (let i = 1; i < prices.length; i++) assert.ok(prices[i] > prices[i - 1], 'rises every day');
  const ratios = prices.slice(1).map((p, i) => p / prices[i]);
  assert.ok(Math.max(...ratios) - Math.min(...ratios) < 0.01, 'about the same step each day');
  const plain = run(8, {});
  assert.equal(state.companies.B.price, plain.state.companies.B.price, 'an unrelated company is untouched');
});

test('a glide can fall as well as rise, and starts only at its start tick', () => {
  const late = { glides: [makeGlide({ id: 'g', companyId: 'A', target: 70, startTick: 4, duration: 5, noise: 0.25 })] };
  assert.deepEqual(resolveControls(late, 3).glide, {});
  assert.equal(resolveControls(late, 4).glide.A.remaining, 5);
  assert.equal(resolveControls(late, 8).glide.A.remaining, 1);
  assert.equal(glideEndTick(late.glides[0]), 8);
  assert.equal(run(8, late).state.companies.A.price, 70);
});

test('glides that ask for an absurd daily move are refused', () => {
  assert.equal(glideFeasible(100, 130, 10), true);
  assert.equal(glideFeasible(100, 1000, 3), false);
  assert.equal(glideFeasible(100, 0.5, 10), false, 'below the minimum price');
  assert.equal(glideFeasible(0, 100, 10), false);
});

test('undoing a tick brings back only what that tick used up', () => {
  const bias = makeBias({ id: 'b1', target: { type: 'market' }, value: 1, startTick: 1, duration: 3 });
  const glide = makeGlide({ id: 'g1', companyId: 'A', target: 120, startTick: 1, duration: 3 });
  const before = { biases: [bias], glides: [glide], forceRegime: { regime: 'bull', untilTick: 3 } };
  const after = pruneControls(before, 4);
  assert.deepEqual([after.biases.length, after.glides.length, after.forceRegime], [0, 0, null], 'the tick used them up');

  const fresh = makeBias({ id: 'b2', target: { type: 'market' }, value: 1, startTick: 5, duration: 3 });
  const restored = restoreExpired({ ...after, biases: [fresh] }, before, 4);
  assert.deepEqual(restored.biases.map((b) => b.id).sort(), ['b1', 'b2'], 'the expired bias returns, the GM\'s new one stays');
  assert.equal(restored.glides.length, 1);
  assert.equal(restored.forceRegime.regime, 'bull');

  const stillRunning = { biases: [makeBias({ id: 'b3', target: { type: 'market' }, value: 1, startTick: 1, duration: 30 })] };
  assert.equal(restoreExpired({ biases: [] }, stillRunning, 4).biases.length, 0, 'a bias the GM removed mid-way is not resurrected');
});

// ── History ──────────────────────────────────────────────────────────────────

test('truncating history removes later closes and series that began later', () => {
  let h = emptyHistory();
  for (let t = 0; t <= 5; t++) h = appendClose(h, 'A', t, 100 + t);
  h = appendClose(h, 'NEW', 4, 10);
  h = appendClose(h, 'NEW', 5, 11);
  const cut = truncateHistory(h, 3);
  assert.deepEqual(getSeries(cut, 'A'), [100, 101, 102, 103]);
  assert.equal(cut.series.NEW, undefined, 'a company added after that tick has no history yet');
  assert.deepEqual(getSeries(truncateHistory(h, 99), 'A'), getSeries(h, 'A'), 'nothing to cut');
});

test('a listing starts a fresh history', () => {
  let h = appendClose(emptyHistory(), 'X', 0, 20);
  h = appendClose(h, 'X', 1, 21);
  const next = resetSeries(h, 'X', 2, 50);
  assert.deepEqual(getSeries(next, 'X'), [50]);
  assert.equal(next.series.X.startTick, 2);
});

// ── Monte-Carlo preview ──────────────────────────────────────────────────────

const base = () => ({ state: createInitialState({ companies }), companies, seed: 'world', controls: normalizeControls(null), ticks: 20, paths: 80 });

test('a positive bias shifts the preview upward, and a negative shock downward', () => {
  const up = previewScenario({ ...base(), scenario: { kind: 'bias', target: 'company:A', value: 2, days: 15, decay: 'flat' } });
  assert.equal(up.ok, true);
  assert.equal(up.single, true);
  assert.ok(up.summary.scenarioMedianChange > up.summary.baselineMedianChange + 0.05, 'clearly higher than doing nothing');
  assert.ok(up.summary.higherShare > 0.8);
  assert.equal(up.baseline.p50.length, 20);
  assert.ok(up.scenario.p10.every((v, i) => v <= up.scenario.p50[i] && up.scenario.p50[i] <= up.scenario.p90[i]), 'the band is ordered');

  const down = previewScenario({ ...base(), scenario: { kind: 'shock', target: 'company:A', percent: -15, delayDays: 1, persistence: 'standard' } });
  assert.ok(down.summary.scenarioMedianChange < down.summary.baselineMedianChange - 0.05);
  assert.ok(down.summary.higherShare < 0.2);
});

test('a preview of nothing shows no difference, because both runs share their random numbers', () => {
  const none = previewScenario({ ...base(), scenario: { kind: 'bias', target: 'company:A', value: 0, days: 10, decay: 'flat' } });
  assert.deepEqual(none.scenario, none.baseline);
  assert.equal(none.summary.higherShare, 0);
});

test('a preview is repeatable, and never uses the world\'s own random numbers', () => {
  const scenario = { kind: 'bias', target: 'market', value: 1, days: 10, decay: 'linear' };
  const a = previewScenario({ ...base(), scenario });
  const b = previewScenario({ ...base(), scenario });
  assert.deepEqual(a, b);

  // The real future for the same state and seed is a single path; the preview must not be exactly it.
  const real = run(20, {}).prices;
  const flat = previewScenario({ ...base(), seed: 'seed', scenario: { kind: 'bias', target: 'company:A', value: 0, days: 1, decay: 'flat' } });
  assert.notDeepEqual(flat.baseline.p50, real);
});

test('sector and market previews average the companies in them; bad scenarios are refused', () => {
  const sector = previewScenario({ ...base(), scenario: { kind: 'bias', target: 'sector:tech', value: 1, days: 10, decay: 'flat' } });
  assert.equal(sector.single, false);
  assert.deepEqual([...sector.trackIds].sort(), ['A', 'B']);
  assert.equal(sector.start, 100, 'a group is shown as an index starting at 100');

  assert.equal(previewScenario({ ...base(), scenario: { kind: 'bias', target: 'sector:nothing', value: 1, days: 5 } }).reason, 'no-targets');
  assert.equal(previewScenario({ ...base(), scenario: { kind: 'glide', companyId: 'A', target: 1000, days: 3, noise: 0.5 } }).reason, 'glide-too-steep');
  const glide = previewScenario({ ...base(), scenario: { kind: 'glide', companyId: 'A', target: 120, days: 10, noise: 0.25 } });
  assert.ok(glide.ok && glide.scenario.p50[9] > 115, 'a glide preview ends near its target');
});

test('applyScenario does not change the controls it is given', () => {
  const controls = normalizeControls(null);
  const out = applyScenario(controls, { kind: 'bias', target: 'market', value: 1, days: 5, decay: 'flat' }, 0);
  assert.equal(controls.biases.length, 0);
  assert.equal(out.biases.length, 1);
});

// ── IPOs ─────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const today = Math.floor(Date.UTC(2045, 2, 15) / DAY);
const ipoCompany = (over = {}) => ({ id: 'X', listed: false, initialPrice: 40, ipo: { date: '2045-03-20', price: 50, windowDays: 3, allocation: 0, ...over } });

test('IPO dates and status', () => {
  assert.equal(isoToDay('2045-03-15'), today);
  assert.equal(isoToDay('2045-02-30'), null, 'not a real date');
  assert.equal(isoToDay('soon'), null);
  assert.equal(ipoStatus(ipoCompany(), today).state, 'upcoming', 'five days out, window is three');
  assert.equal(ipoStatus(ipoCompany(), today + 2).state, 'window');
  assert.equal(ipoStatus(ipoCompany(), today + 5).state, 'due');
  assert.equal(ipoStatus(ipoCompany({ windowDays: 0 }), today + 4).state, 'upcoming', 'no window means no subscriptions');
  assert.equal(ipoStatus({ ...ipoCompany(), listed: true }, today).state, 'none');
  assert.equal(ipoStatus(ipoCompany({ date: '' }), today).state, 'none');
  assert.equal(ipoPrice(ipoCompany()), 50);
  assert.equal(ipoPrice(ipoCompany({ price: null })), 40, 'defaults to the initial price');
});

test('company config keeps a clean IPO schedule', () => {
  const ok = sanitizeCompany({ name: 'Newco', ticker: 'NEW', initialPrice: 40, ipo: { date: '2045-06-01', price: '55', windowDays: '5', allocation: '1000' } });
  assert.deepEqual(ok.company.ipo, { date: '2045-06-01', price: 55, windowDays: 5, allocation: 1000 });
  const bad = sanitizeCompany({ name: 'Newco', ticker: 'NEW', initialPrice: 40, ipo: { date: '2045-13-45', price: 0, windowDays: 400, allocation: -5 } });
  assert.deepEqual(bad.company.ipo, { date: '', price: null, windowDays: 30, allocation: 0 });
  assert.deepEqual(sanitizeCompany({ name: 'Old', ticker: 'OLD', initialPrice: 40 }).company.ipo, { date: '', price: null, windowDays: 0, allocation: 0 });
});

test('subscriptions hold cash, can be cancelled, and need an open window', () => {
  const market = { X: { listed: false, active: false, price: 50, ipo: { open: true, price: 50 } }, Y: { listed: false, active: false, price: 20 } };
  const portfolio = { ...emptyPortfolio(), cash: 10_000 };
  const apply = (p, requests) => applyRequests({ portfolio: p, requests, wealth: 0, tick: 3, market, settings: { mode: 'open' } });
  const result = (out, key) => out.portfolio.results.find((r) => r.key === key);

  let out = apply(portfolio, [{ key: 'k1', type: 'subscribeIpo', assetId: 'X', qty: 100 }]);
  assert.equal(result(out, 'k1').ok, true);
  assert.equal(result(out, 'k1').reserve, 5000);
  assert.equal(out.portfolio.cash, 10_000, 'the money is held, not spent');

  out = apply(out.portfolio, [{ key: 'k2', type: 'subscribeIpo', assetId: 'X', qty: 10 }]);
  assert.equal(result(out, 'k2').reason, 'ipo-already');

  out = apply(out.portfolio, [{ key: 'k3', type: 'placeOrder', route: 'direct', side: 'buy', assetId: 'X', qty: 1, orderType: 'market' }]);
  assert.equal(result(out, 'k3').reason, 'unknown-asset', 'it cannot be traded before it lists');

  out = apply(out.portfolio, [{ key: 'k4', type: 'subscribeIpo', assetId: 'Y', qty: 5 }]);
  assert.equal(result(out, 'k4').reason, 'ipo-closed');

  out = apply(out.portfolio, [{ key: 'k5', type: 'cancelOrder', orderId: 'o_k1' }]);
  assert.equal(result(out, 'k5').ok, true);
  out = apply(out.portfolio, [{ key: 'k6', type: 'subscribeIpo', assetId: 'X', qty: 250 }]);
  assert.equal(result(out, 'k6').reason, 'insufficient-funds', 'cannot reserve more than the balance');
  out = apply(out.portfolio, [{ key: 'k7', type: 'subscribeIpo', assetId: 'X', qty: 0 }]);
  assert.equal(result(out, 'k7').reason, 'invalid-qty');
});

test('listing fills subscriptions, pro rata when the offer is oversubscribed', () => {
  const asset = { ipo: { open: true, price: 50 } };
  const sub = (cash, qty, key) => planSubscription({ portfolio: { ...emptyPortfolio(), cash }, key, assetId: 'X', qty, asset, tick: 3 }).portfolio;
  const a = sub(10_000, 80, 'a');
  const b = sub(10_000, 60, 'b');
  const demand = ipoDemand([a, b], 'X');
  assert.equal(demand, 140);
  assert.equal(allocationRatio(demand, 0), 1, 'no cap');
  assert.equal(allocationRatio(demand, 200), 1, 'not oversubscribed');
  const ratio = allocationRatio(demand, 100);
  assert.ok(Math.abs(ratio - 100 / 140) < 1e-9);

  const sa = settleIpoOrders(a, 'X', 50, ratio, 9);
  const sb = settleIpoOrders(b, 'X', 50, ratio, 9);
  assert.equal(sa.filled, 57);
  assert.equal(sb.filled, 42);
  assert.ok(sa.filled + sb.filled <= 100, 'never more than the allocation');
  assert.equal(sa.portfolio.cash, 10_000 - 57 * 50);
  assert.equal(sa.portfolio.lots[0].unitCost, 50);
  assert.equal(sa.portfolio.orders[0].status, 'filled');
  assert.equal(sa.portfolio.orders[0].requestedQty, 80);
  assert.equal(sa.portfolio.ledger.at(-1).ref, 'ipo');

  const tiny = settleIpoOrders(sub(1000, 1, 't'), 'X', 50, 0.5, 9);
  assert.equal(tiny.portfolio.orders[0].status, 'rejected');
  assert.equal(tiny.portfolio.orders[0].reason, 'ipo-no-allocation');
  assert.equal(tiny.portfolio.cash, 1000, 'nothing is charged');
  assert.equal(settleIpoOrders(emptyPortfolio(), 'X', 50, 1, 9).changed, false);
});

// ── Undo safety ──────────────────────────────────────────────────────────────

test('money moved by a tick is detected, but deposits are not', () => {
  const p = (ledger, withdrawals = []) => ({ ...emptyPortfolio(), ledger, withdrawals });
  assert.equal(movedMoneySince(p([{ kind: 'buy', ts: 5 }]), 5), true);
  assert.equal(movedMoneySince(p([{ kind: 'buy', ts: 5 }]), 6), false, 'an earlier tick is safe');
  assert.equal(movedMoneySince(p([{ kind: 'dividend', ts: 7 }]), 5), true);
  assert.equal(movedMoneySince(p([{ kind: 'deposit', ts: 5 }, { kind: 'withdraw', ts: 5 }, { kind: 'fee', ts: 5 }]), 5), false);
  assert.equal(movedMoneySince(p([], [{ status: 'paid', paidTick: 5 }]), 5), true);
  assert.equal(movedMoneySince(p([], [{ status: 'pending' }]), 5), false);
});
