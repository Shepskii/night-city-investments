import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDeposit, planWithdrawalHold, releaseHold, planDirectWithdrawal } from '../scripts/engine/cash.js';
import { periodKey, dividendDue, dividendPerShare, payoutFor, reinvest } from '../scripts/engine/dividends.js';
import { makeDivisor, computeNav, weightedValue, accrueExpense } from '../scripts/engine/fundNav.js';
import { parseOrderText } from '../scripts/engine/orderParser.js';

test('deposit moves wealth into the balance, less any fee', () => {
  assert.deepEqual(planDeposit({ wealth: 1000, cash: 50, amount: 400 }), { ok: true, wealth: 600, cash: 450, fee: 0 });
  assert.equal(planDeposit({ wealth: 1000, cash: 0, amount: 400, fee: 10 }).cash, 390);
  assert.equal(planDeposit({ wealth: 100, cash: 0, amount: 400 }).reason, 'insufficient-wealth');
  assert.equal(planDeposit({ wealth: 100, cash: 0, amount: -5 }).reason, 'invalid-amount');
  assert.equal(planDeposit({ wealth: 100, cash: 0, amount: 10, fee: 10 }).reason, 'below-fee');
});

test('withdrawal hold takes amount and fee, and can be released', () => {
  const held = planWithdrawalHold({ cash: 1000, amount: 500, fee: 25 });
  assert.equal(held.ok, true);
  assert.equal(held.cash, 475);
  assert.equal(releaseHold({ cash: held.cash, hold: held.hold }).cash, 1000);
  assert.equal(planWithdrawalHold({ cash: 1000, amount: 990, fee: 25 }).reason, 'insufficient-balance');
  assert.equal(planWithdrawalHold({ cash: 1000, amount: 50, minWithdrawal: 100 }).reason, 'below-minimum');
});

test('direct withdrawal credits wealth immediately', () => {
  assert.deepEqual(planDirectWithdrawal({ wealth: 10, cash: 100, amount: 40 }), { ok: true, cash: 60, wealth: 50 });
  assert.equal(planDirectWithdrawal({ wealth: 10, cash: 30, amount: 40 }).reason, 'insufficient-balance');
});

test('period keys', () => {
  const d = { year: 2045, month: 5, day: 12 };
  assert.equal(periodKey('monthly', d), '2045-05');
  assert.equal(periodKey('quarterly', d), '2045-Q2');
  assert.equal(periodKey('annual', d), '2045');
});

test('dividends are due once per period and catch up after a skipped day', () => {
  const co = { status: 'active', dividend: { policy: 'fixed', frequency: 'quarterly', payoutDay: 10 } };
  assert.equal(dividendDue(co, { year: 2045, month: 4, day: 5 }).due, false);
  const first = dividendDue(co, { year: 2045, month: 4, day: 10 });
  assert.deepEqual(first, { due: true, key: '2045-Q2' });
  assert.equal(dividendDue(co, { year: 2045, month: 4, day: 20 }, first.key).due, false);
  assert.equal(dividendDue(co, { year: 2045, month: 5, day: 2 }).due, true, 'skipped payout day is caught up');
  assert.equal(dividendDue(co, { year: 2045, month: 7, day: 12 }, first.key).due, true);
  assert.equal(dividendDue({ ...co, status: 'halted' }, { year: 2045, month: 4, day: 10 }).due, false);
  assert.equal(dividendDue({ status: 'active', dividend: { policy: 'none' } }, { year: 2045, month: 4, day: 10 }).due, false);
});

test('dividend amounts', () => {
  assert.equal(dividendPerShare({ dividend: { policy: 'fixed', perShare: 2.5 } }, 100), 2.5);
  assert.equal(dividendPerShare({ dividend: { policy: 'yield', yield: 0.04, frequency: 'quarterly' } }, 100), 1);
  assert.equal(dividendPerShare({ dividend: { policy: 'none' } }, 100), 0);
  assert.equal(payoutFor(10, 1.25), 13);
  assert.deepEqual(reinvest(250, 100), { shares: 2, spent: 200, remainder: 50 });
});

test('index rebases to 100 and tracks component moves', () => {
  const comps = [{ companyId: 'A', weight: 0.5 }, { companyId: 'B', weight: 0.5 }];
  const prices = { A: 100, B: 50 };
  const div = makeDivisor(comps, prices, 100);
  assert.equal(computeNav(comps, prices, div), 100);
  assert.equal(computeNav(comps, { A: 110, B: 55 }, div), 110);
  assert.equal(weightedValue(comps, prices), 75);
  assert.ok(accrueExpense(100, 0.0365, 365) < 100);
});

test('parser: trades', () => {
  assert.deepEqual(parseOrderText('BUY 10 ARA'), { ok: true, cmd: 'buy', qty: 10, ticker: 'ARA', type: 'market' });
  assert.deepEqual(parseOrderText('sell 5 shares of sam @ 80'), { ok: true, cmd: 'sell', qty: 5, ticker: 'SAM', type: 'limit', limit: 80 });
  assert.deepEqual(parseOrderText('Sell 5 SAM stop 70.5'), { ok: true, cmd: 'sell', qty: 5, ticker: 'SAM', type: 'stop', limit: 70.5 });
  assert.deepEqual(parseOrderText('sell all ara'), { ok: true, cmd: 'sell', qty: 'all', ticker: 'ARA', type: 'market' });
});

test('parser: other commands, HTML and noise', () => {
  assert.deepEqual(parseOrderText('withdraw 5,000 eb'), { ok: true, cmd: 'withdraw', amount: 5000 });
  assert.deepEqual(parseOrderText('<p>Hi,</p><p>status</p>'), { ok: true, cmd: 'status' });
  assert.deepEqual(parseOrderText('CANCEL ord_12'), { ok: true, cmd: 'cancel', ref: 'ord_12' });
  assert.equal(parseOrderText('Please buy me some ARA stock').ok, false);
  assert.equal(parseOrderText('').error, 'unrecognised');
  assert.equal(parseOrderText('buy 0 ARA').ok, false);
  assert.equal(parseOrderText('buy 10 shares').ok, false);
});

test('parser: first recognised line wins in a multi-line mail', () => {
  assert.deepEqual(parseOrderText('Subject line\nbuy 3 MIL\nthanks'), { ok: true, cmd: 'buy', qty: 3, ticker: 'MIL', type: 'market' });
});
