import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRequests, runOrders, emptyPortfolio, brokerTerms, directTerms, feeProfileOf, orderRef, mailCommandToRequest,
  parseOrderText, sessionActive, lockedOut, valuePortfolio,
} from '../scripts/engine/index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const market = (over = {}) => ({
  ARA: { listed: true, active: true, price: 100, liquidity: 5 },
  MIL: { listed: true, active: true, price: 50, liquidity: 3 },
  NC50: { listed: true, active: true, kind: 'fund', price: 120, liquidity: 5, fund: { loadBps: 100, exitBps: 50, minBuy: 200 } },
  ...over,
});

const DIRECT = { commissionBps: 200, flatFee: 5 };
const settings = (over = {}) => ({
  mode: 'terminal',
  depositFee: 0,
  direct: DIRECT,
  access: { sessionTicks: 1, lockoutTicks: 1 },
  seed: 'seed',
  brokers: {
    ROOKIE: { available: true, name: 'Rookie', terms: brokerTerms(4, DIRECT) },
    ELITE: { available: true, name: 'Elite', terms: brokerTerms(20, DIRECT) },
    GONE: { available: false, name: 'Gone', terms: brokerTerms(10, DIRECT) },
  },
  checks: {},
  ...over,
});

let n = 0;
const req = (type, extra = {}) => ({ key: `k${++n}`, type, ...extra });
const run = (portfolio, requests, { wealth = 100000, tick = 10, m = market(), s = settings() } = {}) =>
  applyRequests({ portfolio, requests, wealth, tick, market: m, settings: s });
const last = (r) => r.portfolio.results.at(-1);

const funded = (cash = 50000) => ({ ...emptyPortfolio(), cash });
const passCheck = (key, over = {}) => ({ [key]: { access: { ok: true, source: 'network' }, stat: 6, level: 6, dv: 13, roll: { total: 5, rolls: [5] }, ...over } });

// ── Terminal sessions ─────────────────────────────────────────────────────────

test('direct trading needs a terminal session', () => {
  const r = run(funded(), [req('placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 5 })]);
  assert.equal(last(r).reason, 'no-terminal-session');
  assert.equal(r.portfolio.orders.length, 0);
});

test('passing the Accounting check opens a session, and direct orders then fill at once', () => {
  const connect = req('connectTerminal');
  const s = settings({ checks: passCheck(connect.key) });
  const opened = run(funded(), [connect], { s });
  assert.equal(last(opened).passed, true);
  assert.deepEqual([last(opened).total, last(opened).dv], [17, 13]);
  assert.equal(sessionActive(opened.portfolio, 10), true);

  const traded = run(opened.portfolio, [req('placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 5 })], { s });
  assert.equal(traded.portfolio.orders[0].status, 'filled', 'direct is near-instant');
  assert.equal(traded.portfolio.orders[0].filledTick, 10);
  assert.equal(traded.events[0].route, 'direct');
  assert.equal(traded.portfolio.lots[0].qty, 5);
});

test('failing the check locks the character out; the lockout blocks retries until it ends', () => {
  const c1 = req('connectTerminal');
  const s1 = settings({ checks: passCheck(c1.key, { roll: { total: 0, rolls: [4, 4] } }) });
  const failed = run(funded(), [c1], { s: s1 });
  assert.equal(last(failed).ok, true);
  assert.equal(last(failed).passed, false);
  assert.equal(sessionActive(failed.portfolio, 10), false);
  assert.equal(lockedOut(failed.portfolio, 10), true);
  assert.equal(last(failed).lockoutUntilTick, 11);

  const c2 = req('connectTerminal');
  const retry = run(failed.portfolio, [c2], { s: settings({ checks: passCheck(c2.key) }) });
  assert.equal(last(retry).reason, 'locked-out');

  const c3 = req('connectTerminal');
  const later = run(failed.portfolio, [c3], { tick: 11, s: settings({ checks: passCheck(c3.key) }) });
  assert.equal(last(later).passed, true);
});

test('a fumble doubles the lockout', () => {
  const c = req('connectTerminal');
  const r = run(funded(), [c], { s: settings({ checks: passCheck(c.key, { roll: { total: -4, rolls: [1, 5], crit: 'fumble' } }) }) });
  assert.equal(last(r).passed, false);
  assert.equal(last(r).lockoutUntilTick, 12);
  assert.equal(last(r).crit, 'fumble');
});

test('no terminal access means no check, and the reason is passed through', () => {
  const none = run(funded(), [req('connectTerminal')]);
  assert.equal(last(none).reason, 'no-terminal');
  const c = req('connectTerminal');
  const denied = run(funded(), [c], { s: settings({ checks: { [c.key]: { access: { ok: false, reason: 'no-network' } } } }) });
  assert.equal(last(denied).reason, 'no-network');
  assert.equal(denied.portfolio.session, null);
  assert.equal(denied.portfolio.lockoutUntilTick, 0, 'being without access is not a failed check');
});

test('a request cannot supply its own dice', () => {
  const c = { ...req('connectTerminal'), roll: { total: 10 }, access: { ok: true }, stat: 10, level: 10, dv: 1, check: { success: true } };
  const r = run(funded(), [c]);
  assert.equal(last(r).reason, 'no-terminal');
  assert.equal(r.portfolio.session, null);
});

test('a session lasts only its window; the next tick direct trading is closed again', () => {
  const c = req('connectTerminal');
  const s = settings({ checks: passCheck(c.key) });
  const opened = run(funded(), [c], { s });
  const nextDay = run(opened.portfolio, [req('placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 1 })], { tick: 11, s });
  assert.equal(last(nextDay).reason, 'no-terminal-session');
  const longer = settings({ access: { sessionTicks: 3, lockoutTicks: 1 }, checks: passCheck(c.key) });
  const open3 = run(funded(), [c], { s: longer });
  assert.equal(sessionActive(open3.portfolio, 12), true);
  assert.equal(sessionActive(open3.portfolio, 13), false);
});

test('an active session is reused, not re-rolled; and the legacy open mode needs no terminal', () => {
  const c = req('connectTerminal');
  const s = settings({ checks: passCheck(c.key) });
  const opened = run(funded(), [c], { s });
  const again = run(opened.portfolio, [req('connectTerminal')], { s });
  assert.deepEqual([last(again).ok, last(again).already], [true, true]);

  const open = run(funded(), [req('connectTerminal')], { s: settings({ mode: 'open' }) });
  assert.equal(last(open).reason, 'not-required');
  const legacy = run(funded(), [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 2 })], { s: { depositFee: 0, feeProfile: DIRECT, instant: true } });
  assert.equal(legacy.portfolio.orders[0].status, 'filled');
});

// ── Direct is the most expensive; brokers are slower but cheaper ─────────────

test('the same trade costs less through any broker than direct, but arrives later', () => {
  const c = req('connectTerminal');
  const sess = settings({ checks: passCheck(c.key) });
  const opened = run(funded(), [c], { s: sess }).portfolio;
  const direct = run(opened, [req('placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 50 })], { s: sess });
  const directFee = direct.portfolio.orders[0].fees;

  for (const brokerId of ['ROOKIE', 'ELITE']) {
    const withBroker = { ...funded(), brokerContactId: brokerId };
    const placed = run(withBroker, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 50 })]);
    const order = placed.portfolio.orders[0];
    assert.equal(order.status, 'open', `${brokerId}: not instant`);
    assert.ok(order.eligibleTick >= 11, `${brokerId}: at least a tick later`);

    const filled = runOrders({ portfolio: placed.portfolio, tick: order.eligibleTick, market: market(), seed: 'seed' });
    assert.equal(filled.portfolio.orders[0].status, 'filled');
    assert.ok(filled.portfolio.orders[0].fees < directFee, `${brokerId}: fee ${filled.portfolio.orders[0].fees} < direct ${directFee}`);
  }
});

test('a more skilled broker is quicker', () => {
  const eta = (brokerId, i) => {
    const r = run({ ...funded(), brokerContactId: brokerId }, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 1 })], { s: settings({ seed: `s${i}` }) });
    return r.portfolio.orders[0].eligibleTick - 10;
  };
  let rookie = 0;
  let elite = 0;
  for (let i = 0; i < 30; i++) { rookie += eta('ROOKIE', i); elite += eta('ELITE', i); }
  assert.ok(rookie / 30 > elite / 30 + 1.5, `rookie ${rookie / 30} vs elite ${elite / 30}`);
  assert.equal(elite / 30, 1);
});

test('a broker order keeps the fee terms it was placed with, and the order records its route and broker', () => {
  const placed = run({ ...funded(), brokerContactId: 'ROOKIE' }, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 10 })]);
  const o = placed.portfolio.orders[0];
  assert.equal(o.route, 'broker');
  assert.equal(o.brokerId, 'ROOKIE');
  assert.deepEqual(o.feeProfile, feeProfileOf(brokerTerms(4, DIRECT)));
  // The broker's terms change later; the open order is unaffected.
  const filled = runOrders({ portfolio: placed.portfolio, tick: o.eligibleTick, market: market(), feeProfile: { flatFee: 999, commissionBps: 9999 }, seed: 'seed' });
  assert.ok(filled.portfolio.orders[0].fees < 100);
});

test('placing a broker order needs an available broker', () => {
  const none = run(funded(), [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 1 })]);
  assert.equal(last(none).reason, 'no-broker');
  const gone = run({ ...funded(), brokerContactId: 'GONE' }, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 1 })]);
  assert.equal(last(gone).reason, 'no-broker');
  assert.equal(last(run(funded(), [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 1 })])).reason, 'invalid-route');
  assert.equal(last(run(funded(), [req('placeOrder', { route: 'teleport', side: 'buy', assetId: 'ARA', qty: 1 })])).reason, 'invalid-route');
});

test('choosing a broker', () => {
  const r = run(funded(), [req('setBroker', { brokerId: 'ELITE' })]);
  assert.equal(r.portfolio.brokerContactId, 'ELITE');
  assert.equal(last(run(r.portfolio, [req('setBroker', { brokerId: 'NOBODY' })])).reason, 'unknown-broker');
  assert.equal(last(run(r.portfolio, [req('setBroker', { brokerId: 'GONE' })])).reason, 'unknown-broker');
  assert.equal(run(r.portfolio, [req('setBroker', { brokerId: null })]).portfolio.brokerContactId, null);
});

// ── Pooled funds: broker only, skill improves the result ─────────────────────

test('funds cannot be traded directly, even with a live session, and only at market', () => {
  const c = req('connectTerminal');
  const s = settings({ checks: passCheck(c.key) });
  const opened = run({ ...funded(), brokerContactId: 'ELITE' }, [c], { s }).portfolio;
  assert.equal(last(run(opened, [req('placeOrder', { route: 'direct', side: 'buy', assetId: 'NC50', qty: 5 })], { s })).reason, 'fund-needs-broker');
  assert.equal(last(run(opened, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'NC50', qty: 5, orderType: 'limit', limit: 100 })], { s })).reason, 'fund-market-only');
  assert.equal(last(run(opened, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'NC50', qty: 1 })], { s })).reason, 'below-minimum');
});

test('a fund order through a broker fills at the NAV adjusted by that broker, with a recorded timing', () => {
  const placed = run({ ...funded(), brokerContactId: 'ELITE' }, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'NC50', qty: 10 })]);
  const o = placed.portfolio.orders[0];
  assert.equal(o.assetType, 'fund');
  assert.ok(o.terms.loadRebate > 0.5);
  const filled = runOrders({ portfolio: placed.portfolio, tick: o.eligibleTick, market: market(), seed: 'seed' });
  assert.equal(filled.portfolio.orders[0].status, 'filled');
  assert.equal(filled.portfolio.lots[0].assetType, 'fund');
  assert.equal(typeof filled.portfolio.orders[0].timingBps, 'number');
  assert.equal(filled.events[0].assetType, 'fund');
});

test('across many orders a top broker gets better fund prices than a rookie, buying and selling', () => {
  const avgFill = (brokerId, side) => {
    let total = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const base = side === 'sell'
        ? { ...funded(), brokerContactId: brokerId, lots: [{ id: 'l', assetType: 'fund', assetId: 'NC50', qty: 100, unitCost: 100, acquiredTick: 1 }] }
        : { ...funded(), brokerContactId: brokerId };
      const placed = run(base, [{ key: `f${side}${brokerId}${i}`, type: 'placeOrder', route: 'broker', side, assetId: 'NC50', qty: 10 }], { s: settings({ seed: `w${i}` }) });
      const o = placed.portfolio.orders[0];
      total += runOrders({ portfolio: placed.portfolio, tick: o.eligibleTick, market: market(), seed: `w${i}` }).portfolio.orders[0].fillPrice;
    }
    return total / N;
  };
  assert.ok(avgFill('ELITE', 'buy') < avgFill('ROOKIE', 'buy') - 0.5, 'elite buys cheaper');
  assert.ok(avgFill('ELITE', 'sell') > avgFill('ROOKIE', 'sell') + 0.5, 'elite sells dearer');
});

test('fund buys reserve funds with headroom for timing, and shares are reserved on sells', () => {
  const placed = run({ ...funded(1300), brokerContactId: 'ROOKIE' }, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'NC50', qty: 10 })]);
  assert.equal(last(placed).ok, true);
  assert.ok(placed.portfolio.orders[0].reserve > 10 * 120 * 1.01);
  const second = run(placed.portfolio, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'NC50', qty: 10 })]);
  assert.equal(last(second).reason, 'insufficient-funds');
});

// ── Withdrawals ───────────────────────────────────────────────────────────────

test('with a broker, a withdrawal is held and paid later; the fee follows the broker', () => {
  const r = run({ ...funded(5000), brokerContactId: 'ROOKIE' }, [req('withdraw', { amount: 1000 })], { wealth: 200 });
  const res = last(r);
  assert.equal(res.pending, true);
  assert.ok(res.releaseTick >= 11);
  assert.equal(r.wealth, 200, 'wealth is only credited when the character claims the eddies');
  assert.equal(r.portfolio.cash, 5000 - 1000 - res.fee);
  assert.equal(r.portfolio.withdrawals[0].status, 'pending');

  const direct = run({ ...funded(5000) }, [req('withdraw', { amount: 1000 })], { wealth: 200 });
  assert.equal(direct.wealth, 1200, 'with no broker it is immediate');
  assert.equal(direct.portfolio.withdrawals.length, 0);
});

test('a pending withdrawal can be cancelled and is refunded in full, once', () => {
  const placed = run({ ...funded(5000), brokerContactId: 'ELITE' }, [req('withdraw', { amount: 1000 })]);
  const id = placed.portfolio.withdrawals[0].id;
  const cancelled = run(placed.portfolio, [req('cancelWithdrawal', { withdrawalId: id })]);
  assert.equal(cancelled.portfolio.cash, 5000);
  assert.equal(last(cancelled).ok, true);
  assert.equal(last(run(cancelled.portfolio, [req('cancelWithdrawal', { withdrawalId: id })])).reason, 'not-found');
});

test('a withdrawal cannot exceed the balance plus its fee', () => {
  const r = run({ ...funded(1000), brokerContactId: 'ELITE' }, [req('withdraw', { amount: 1000 })]);
  assert.equal(last(r).reason, 'insufficient-balance');
  assert.equal(r.portfolio.withdrawals.length, 0);
});

// ── Broker mail ───────────────────────────────────────────────────────────────

const book = () => ({
  ...funded(),
  lots: [{ id: 'l1', assetType: 'stock', assetId: 'ARA', qty: 10, unitCost: 90, acquiredTick: 1 }],
  orders: [{ id: 'o_abc123xyz', status: 'open', side: 'sell', assetId: 'ARA', qty: 4, type: 'market', reserve: 0 }],
  withdrawals: [{ id: 'w_withdrawq1', status: 'pending', amount: 100, fee: 5 }],
});
const resolveAsset = (t) => ({ ARA: { assetId: 'ARA', kind: 'stock' }, NC50: { assetId: 'NC50', kind: 'fund' } }[t] ?? null);
const mail = (text) => mailCommandToRequest({ parsed: parseOrderText(text), key: 'mail_1', portfolio: book(), resolveAsset });

test('mail commands become broker-route requests', () => {
  assert.deepEqual(mail('BUY 10 ARA').request, { key: 'mail_1', type: 'placeOrder', route: 'broker', side: 'buy', assetId: 'ARA', qty: 10, orderType: 'market', limit: null, expiry: 'day' });
  const limit = mail('sell 5 ARA @ 120').request;
  assert.deepEqual([limit.orderType, limit.limit, limit.expiry], ['limit', 120, 'gtc']);
  assert.equal(mail('buy 3 nc50').request.assetId, 'NC50');
  assert.deepEqual(mail('withdraw 500').request, { key: 'mail_1', type: 'withdraw', amount: 500 });
});

test('sell all uses only the shares not already committed', () => {
  assert.equal(mail('sell all ARA').request.qty, 6);
  assert.equal(mailCommandToRequest({ parsed: parseOrderText('sell all NC50'), key: 'k', portfolio: book(), resolveAsset }).reason, 'insufficient-shares');
});

test('cancel finds orders and withdrawals by their short reference', () => {
  assert.equal(orderRef('o_abc123xyz'), '123XYZ');
  assert.deepEqual(mail('cancel 123xyz').request, { key: 'mail_1', type: 'cancelOrder', orderId: 'o_abc123xyz' });
  assert.equal(orderRef('w_withdrawq1'), 'DRAWQ1');
  assert.deepEqual(mail('cancel drawq1').request, { key: 'mail_1', type: 'cancelWithdrawal', withdrawalId: 'w_withdrawq1' });
  assert.equal(mail('cancel zzzzzz').reason, 'not-found');
});

test('unknown tickers, nonsense, status and help', () => {
  assert.deepEqual(mail('buy 5 NOPE'), { ok: false, reason: 'unknown-asset', ticker: 'NOPE' });
  assert.equal(mail('please buy stuff').reason, 'unrecognised');
  assert.equal(mail('buy 0 ARA').ok, false);
  assert.equal(mail('status').reply, 'status');
  assert.equal(mail('help').reply, 'help');
});

test('a portfolio with funds values them at NAV', () => {
  const p = { ...funded(), lots: [{ id: 'f', assetType: 'fund', assetId: 'NC50', qty: 10, unitCost: 100, acquiredTick: 1 }] };
  assert.equal(valuePortfolio(p, { NC50: 120 }).holdings, 1200);
});
