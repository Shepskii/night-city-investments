import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planAlert, removeAlert, checkAlerts, alertMet, MAX_ALERTS, ALERT_LOG_CAP, applyRequests, emptyPortfolio,
  buildStatement, closeStatement, baselineStatement, statementDue, monthKey,
  sanitizeFund, makeFundState, stepFundState, fundTargets, fundComposition, rebalanceDue, rebalanceComponents, applyRebalance,
  normalizeNotify, NOTIFY_CATEGORIES, parseOrderText, mailCommandToRequest,
} from '../scripts/engine/index.js';

const asset = (price, prevClose = price) => ({ listed: true, active: true, price, prevClose });
const plan = (portfolio, over = {}) => planAlert({
  portfolio, key: `k${Math.random()}`, assetId: 'A', kind: 'above', value: 110, once: true, asset: asset(100), tick: 1, ...over,
});

// ── Alerts ───────────────────────────────────────────────────────────────────

test('alerts are validated when they are set', () => {
  const p = emptyPortfolio();
  assert.equal(plan(p).ok, true);
  assert.equal(plan(p, { kind: 'sideways' }).reason, 'invalid-alert');
  assert.equal(plan(p, { value: 0 }).reason, 'invalid-alert');
  assert.equal(plan(p, { value: 'abc' }).reason, 'invalid-alert');
  assert.equal(plan(p, { kind: 'move', value: 0.1 }).reason, 'invalid-alert', 'a move below 0.5% is noise');
  assert.equal(plan(p, { kind: 'move', value: 80 }).reason, 'invalid-alert');
  assert.equal(plan(p, { kind: 'move', value: 5 }).ok, true);
  assert.equal(plan(p, { asset: { ...asset(100), listed: false } }).reason, 'unknown-asset');
  assert.equal(plan(p, { asset: undefined }).reason, 'unknown-asset');
  assert.equal(plan(p, { kind: 'above', value: 90 }).reason, 'alert-already-met', 'already past that price');
  assert.equal(plan(p, { kind: 'below', value: 100 }).reason, 'alert-already-met');
});

test('duplicate alerts and too many alerts are refused', () => {
  const first = plan(emptyPortfolio(), { key: 'one' });
  assert.equal(plan(first.portfolio, { key: 'two' }).reason, 'alert-duplicate');
  assert.equal(plan(first.portfolio, { key: 'three', value: 120 }).ok, true);

  let p = emptyPortfolio();
  for (let i = 0; i < MAX_ALERTS; i++) p = plan(p, { key: `k${i}`, value: 110 + i }).portfolio;
  assert.equal(p.alerts.length, MAX_ALERTS);
  assert.equal(plan(p, { key: 'overflow', value: 500 }).reason, 'too-many-alerts');
});

test('a once alert fires when it first comes true and is then removed', () => {
  const p = plan(emptyPortfolio(), { key: 'a', value: 110 }).portfolio;
  assert.equal(checkAlerts(p, { A: { price: 105, prevClose: 100 } }, 2).changed, false, 'not yet');

  const out = checkAlerts(p, { A: { price: 112, prevClose: 105 } }, 3);
  assert.equal(out.fired.length, 1);
  assert.deepEqual([out.fired[0].assetId, out.fired[0].price, out.fired[0].tick], ['A', 112, 3]);
  assert.equal(out.portfolio.alerts.length, 0, 'a one-off alert is spent');
  assert.equal(out.portfolio.alertLog.length, 1);
  assert.equal(checkAlerts(out.portfolio, { A: { price: 120, prevClose: 112 } }, 4).fired.length, 0, 'and does not fire again');
});

test('a repeating alert fires, disarms, and re-arms once the condition clears', () => {
  let p = plan(emptyPortfolio(), { key: 'r', value: 110, once: false }).portfolio;
  let out = checkAlerts(p, { A: { price: 111, prevClose: 100 } }, 2);
  assert.equal(out.fired.length, 1);
  assert.equal(out.portfolio.alerts[0].armed, false);
  p = out.portfolio;

  out = checkAlerts(p, { A: { price: 115, prevClose: 111 } }, 3);
  assert.equal(out.fired.length, 0, 'still above: no second alert');
  assert.equal(out.changed, false);

  out = checkAlerts(p, { A: { price: 105, prevClose: 115 } }, 4);
  assert.equal(out.fired.length, 0);
  assert.equal(out.portfolio.alerts[0].armed, true, 'fell back below: armed again');

  out = checkAlerts(out.portfolio, { A: { price: 112, prevClose: 105 } }, 5);
  assert.equal(out.fired.length, 1, 'fires again on the next crossing');
});

test('below and daily-move alerts, and alerts on assets with no quote', () => {
  assert.equal(alertMet({ kind: 'below', value: 50 }, { price: 49 }), true);
  assert.equal(alertMet({ kind: 'below', value: 50 }, { price: 51 }), false);
  assert.equal(alertMet({ kind: 'move', value: 5 }, { price: 106, prevClose: 100 }), true);
  assert.equal(alertMet({ kind: 'move', value: 5 }, { price: 94, prevClose: 100 }), true, 'down counts too');
  assert.equal(alertMet({ kind: 'move', value: 5 }, { price: 103, prevClose: 100 }), false);
  assert.equal(alertMet({ kind: 'move', value: 5 }, { price: 103 }), false, 'no previous close');
  assert.equal(alertMet({ kind: 'above', value: 5 }, null), false);

  const p = plan(emptyPortfolio(), { key: 'x', value: 110 }).portfolio;
  const out = checkAlerts(p, {}, 2);
  assert.equal(out.portfolio.alerts.length, 1, 'an asset with no quote keeps its alert');
});

test('the fired-alert log is capped', () => {
  let p = emptyPortfolio();
  for (let i = 0; i < ALERT_LOG_CAP + 5; i++) {
    p = plan(p, { key: `k${i}`, value: 110 + i, once: true }).portfolio;
    p = checkAlerts(p, { A: { price: 500, prevClose: 100 } }, i).portfolio;
  }
  assert.equal(p.alertLog.length, ALERT_LOG_CAP);
});

test('the executor sets and removes alerts', () => {
  const market = { A: asset(100, 99) };
  const apply = (p, requests) => applyRequests({ portfolio: p, requests, wealth: 0, tick: 4, market, settings: { mode: 'open' } });
  const result = (out, key) => out.portfolio.results.find((r) => r.key === key);

  let out = apply(emptyPortfolio(), [{ key: 's1', type: 'setAlert', assetId: 'A', kind: 'above', value: 120 }]);
  assert.equal(result(out, 's1').ok, true);
  assert.equal(out.portfolio.alerts[0].once, true, 'once by default');
  const id = result(out, 's1').alertId;

  out = apply(out.portfolio, [{ key: 's2', type: 'setAlert', assetId: 'A', kind: 'below', value: 90, once: false }]);
  assert.equal(out.portfolio.alerts[1].once, false);
  out = apply(out.portfolio, [{ key: 's3', type: 'setAlert', assetId: 'A', kind: 'above', value: 50 }]);
  assert.equal(result(out, 's3').reason, 'alert-already-met');

  out = apply(out.portfolio, [{ key: 's4', type: 'removeAlert', alertId: id }, { key: 's5', type: 'removeAlert', alertId: 'nope' }]);
  assert.equal(result(out, 's4').ok, true);
  assert.equal(result(out, 's5').reason, 'not-found');
  assert.equal(out.portfolio.alerts.length, 1);
  assert.equal(removeAlert(out.portfolio, 'nope').ok, false);

  out = apply(out.portfolio, [{ key: 's6', type: 'requestStatement' }]);
  assert.equal(result(out, 's6').ok, true);
});

// ── Statements ───────────────────────────────────────────────────────────────

const book = () => ({
  ...emptyPortfolio(),
  cash: 2000,
  lots: [{ id: 'l1', assetId: 'A', qty: 10, unitCost: 100, acquiredTick: 3 }, { id: 'l2', assetId: 'B', qty: 5, unitCost: 40, acquiredTick: 3 }],
  ledger: [
    { ts: 1, kind: 'deposit', amount: 3000 },
    { ts: 2, kind: 'buy', assetId: 'A', qty: 10, amount: -1000 },
    { ts: 2, kind: 'fee', amount: -15 },
    { ts: 3, kind: 'buy', assetId: 'B', qty: 5, amount: -200 },
    { ts: 4, kind: 'dividend', assetId: 'A', amount: 30 },
    { ts: 5, kind: 'withdraw', amount: -500 },
    { ts: 6, kind: 'sell', assetId: 'C', qty: 1, amount: 250 },
  ],
  stats: { realized: 50, dividends: 30 },
});

test('a first statement covers everything and has no performance to compare', () => {
  const s = buildStatement({ portfolio: book(), prices: { A: 120, B: 50 }, tick: 8 });
  assert.equal(s.fromTick, null);
  assert.equal(s.opening, null);
  assert.equal(s.gain, null);
  assert.deepEqual(s.closing, { cash: 2000, holdings: 1450, unsettled: 0, total: 3450 });
  assert.deepEqual(s.flows, { deposits: 3000, withdrawals: 500, refunds: 0, bought: 1200, sold: 250, fees: 15, dividends: 30, reinvested: 0, payouts: 0 });
  assert.equal(s.unrealized, 250);
  assert.deepEqual(s.positions.map((p) => p.assetId), ['A', 'B'], 'largest first');
  assert.ok(Math.abs(s.positions[0].weight - 1200 / 1450) < 1e-9);
  assert.equal(s.positions.reduce((t, p) => t + p.weight, 0).toFixed(6), '1.000000');
});

test('later statements compare with the baseline and strip out deposits and withdrawals', () => {
  const p = { ...book(), statement: { tick: 4, monthKey: '2046-09', total: 2500, realized: 20 } };
  const s = buildStatement({ portfolio: p, prices: { A: 120, B: 50 }, tick: 9 });
  assert.equal(s.fromTick, 4);
  assert.equal(s.opening, 2500);
  assert.deepEqual([s.flows.withdrawals, s.flows.sold, s.flows.deposits], [500, 250, 0], 'only entries after the baseline');
  // 3450 now, 2500 before, 500 of it taken out: performance is 3450 - 2500 + 500.
  assert.equal(s.gain, 1450);
  assert.ok(Math.abs(s.gainPct - 1450 / 2500) < 1e-9);
  assert.equal(s.realized, 30);
});

test('refunded withdrawals are not counted as performance', () => {
  const p = { ...emptyPortfolio(), cash: 1000, statement: { tick: 0, monthKey: 'x', total: 1000, realized: 0 }, ledger: [
    { ts: 1, kind: 'withdraw', amount: -400 }, { ts: 2, kind: 'withdraw-refund', amount: 400 },
  ] };
  const s = buildStatement({ portfolio: p, prices: {}, tick: 3 });
  assert.equal(s.gain, 0, 'the money came back, so nothing was gained or lost');
});

test('the monthly baseline: first sight, same month, new month', () => {
  const key = monthKey({ year: 2046, month: 10, day: 3 });
  assert.equal(key, '2046-10');
  const fresh = emptyPortfolio();
  assert.equal(statementDue(fresh, key), 'baseline');

  const based = baselineStatement({ ...fresh, cash: 700 }, {}, 5, key);
  assert.deepEqual(based.statement, { tick: 5, monthKey: '2046-10', total: 700, realized: 0 });
  assert.equal(statementDue(based, key), null, 'nothing more this month');
  assert.equal(statementDue(based, '2046-11'), 'send');

  const s = buildStatement({ portfolio: based, prices: {}, tick: 40 });
  const closed = closeStatement(based, s, '2046-11');
  assert.equal(closed.statement.monthKey, '2046-11');
  assert.equal(closed.statement.tick, 40);
  assert.equal(statementDue(closed, '2046-11'), null);
});

// ── Fund rebalancing and manager alpha ───────────────────────────────────────

const fundDef = (over = {}) => sanitizeFund({
  name: 'Test', ticker: 'TST', components: 'A 1, B 1, C 1', expenseRatio: 0, ...over,
}).fund;

test('fund config keeps rebalancing and manager alpha in range', () => {
  const f = fundDef({ rebalance: 'quarterly', managerAlpha: 0.02 });
  assert.equal(f.rebalance, 'quarterly');
  assert.equal(f.managerAlpha, 0.02);
  assert.equal(fundDef({ rebalance: 'sometimes' }).rebalance, 'none');
  assert.equal(fundDef({ managerAlpha: 5 }).managerAlpha, 0.1, 'capped at 10% a year');
  assert.equal(fundDef({ managerAlpha: -5 }).managerAlpha, -0.1);
  assert.equal(fundDef({}).managerAlpha, 0);
  assert.deepEqual(fundDef({ targets: { a: 0.6, B: 0.4, X: -1 } }).targets, { A: 0.6, B: 0.4 });
});

test('manager alpha adds to the yearly return, and a poor manager subtracts', () => {
  const prices = { A: 100, B: 100, C: 100 };
  const run = (alpha) => {
    const fund = fundDef({ managerAlpha: alpha });
    let s = makeFundState(fund, prices);
    for (let i = 0; i < 365; i++) s = stepFundState(s, fund, prices, {});
    return s.nav;
  };
  const flat = run(0);
  assert.equal(flat, 100, 'with flat prices and no costs nothing moves');
  assert.ok(run(0.05) > 105 && run(0.05) < 106, `5% a year is about 105, got ${run(0.05)}`);
  assert.ok(run(-0.05) < 95.5 && run(-0.05) > 94.5);
});

test('target mix, and when a rebalance is due', () => {
  const fund = fundDef({ rebalance: 'quarterly' });
  const t = fundTargets(fund, { A: 100, B: 100, C: 200 });
  assert.equal(Object.values(t).reduce((s, v) => s + v, 0).toFixed(4), '1.0000');
  assert.ok(Math.abs(t.C - 0.5) < 1e-4, 'the dearer company is half the value at equal share counts');

  const date = (month) => ({ year: 2046, month, day: 10 });
  const st = (rebalanceKey) => ({ rebalanceKey });
  assert.deepEqual(rebalanceDue(fundDef({ rebalance: 'none' }), st(null), date(1)), { due: false });
  assert.deepEqual(rebalanceDue(fund, st(null), date(2)), { due: false, mark: '2046-Q1' }, 'first sight only records the period');
  assert.deepEqual(rebalanceDue(fund, st('2046-Q1'), date(3)), { due: false }, 'same quarter');
  assert.deepEqual(rebalanceDue(fund, st('2046-Q1'), date(4)), { due: true, key: '2046-Q2' });
  assert.deepEqual(rebalanceDue(fundDef({ rebalance: 'monthly' }), st('2046-03'), date(4)), { due: true, key: '2046-04' });
  assert.deepEqual(rebalanceDue(fund, {}, date(4)).mark, '2046-Q2', 'a state from before rebalancing existed is treated as first sight');
});

test('rebalancing restores the target mix without moving the NAV', () => {
  const start = { A: 100, B: 100, C: 100 };
  let fund = fundDef({ rebalance: 'quarterly' });
  fund = { ...fund, targets: fundTargets(fund, start) };
  let state = makeFundState(fund, start);

  const drifted = { A: 200, B: 100, C: 50 };
  state = stepFundState(state, fund, drifted, {});
  const before = fundComposition(fund, drifted);
  assert.ok(before[0].share > 0.5, 'the winner has taken over the fund');

  const out = applyRebalance(fund, state, drifted, '2046-Q2');
  assert.equal(out.state.nav, state.nav, 'the NAV does not jump');
  assert.equal(out.state.rebalanceKey, '2046-Q2');
  for (const c of fundComposition(out.fund, drifted)) {
    assert.ok(Math.abs(c.share - fund.targets[c.companyId]) < 1e-3, `${c.companyId} is back at its target`);
  }
  // And it keeps tracking prices from there.
  const next = stepFundState(out.state, out.fund, { A: 200, B: 100, C: 50 }, {});
  assert.ok(Math.abs(next.nav - out.state.nav) < 0.02);
  const up = stepFundState(out.state, out.fund, { A: 220, B: 110, C: 55 }, {});
  assert.ok(up.nav > out.state.nav * 1.09, 'a 10% rise in everything lifts the fund about 10%');
});

test('a bankrupt holding drops out of a rebalance and the rest are scaled up', () => {
  const start = { A: 100, B: 100, C: 100 };
  let fund = fundDef();
  fund = { ...fund, targets: fundTargets(fund, start) };
  const prices = { A: 100, B: 100, C: 0 };
  const out = rebalanceComponents(fund, prices);
  const live = out.components.filter((c) => prices[c.companyId] > 0);
  const shares = fundComposition({ ...out, components: live }, prices).map((c) => c.share);
  assert.ok(shares.every((s) => Math.abs(s - 0.5) < 1e-3), 'the two survivors split the fund');
  assert.equal(rebalanceComponents(fund, { A: 0, B: 0, C: 0 }), fund, 'nothing to rebalance into');
});

// ── Notification categories and the STATEMENT mail command ───────────────────

test('alerts are on by default, statements are opt-in', () => {
  const n = normalizeNotify(undefined);
  assert.equal(n.alerts, 'mail');
  assert.equal(n.statements, 'off');
  assert.ok(NOTIFY_CATEGORIES.includes('alerts') && NOTIFY_CATEGORIES.includes('statements'));
  assert.equal(normalizeNotify({ statements: 'chat', alerts: 'bogus' }).statements, 'chat');
  assert.equal(normalizeNotify({ alerts: 'bogus' }).alerts, 'mail');
});

test('STATEMENT is a recognised mail command', () => {
  const parsed = parseOrderText('Statement please\n\nSTATEMENT');
  assert.deepEqual([parsed.ok, parsed.cmd], [true, 'statement']);
  assert.equal(parseOrderText('statements').cmd, 'statement');
  const cmd = mailCommandToRequest({ parsed, key: 'k', portfolio: emptyPortfolio(), resolveAsset: () => null });
  assert.deepEqual([cmd.ok, cmd.reply], [true, 'statement']);
});
