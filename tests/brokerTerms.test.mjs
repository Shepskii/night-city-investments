import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountingTotal, skillFraction, skillGrade, directTerms, brokerTerms, pickLatency, fundTiming, fundExecutionPrice,
  describeTerms, cprD10, evaluateCheck, planSession, sessionActive, lockedOut,
  parseComponents, sanitizeFund, makeFundState, stepFundState, refreshFundState, fundValue, fundPrices,
  splitFundComponents, fundComposition, fundDailyYield, annualYield,
  holdWithdrawal, dueWithdrawals, markWithdrawalPaid, refundWithdrawal, emptyPortfolio, normalizePortfolio,
  DIRECT_DEFAULTS, BROKER_TUNING, computeFees, feeProfileOf,
} from '../scripts/engine/index.js';

// ── Broker terms follow Accounting skill, and are always slower and cheaper than direct ──

test('accounting total is stat plus level, clamped', () => {
  assert.equal(accountingTotal({ stat: 6, level: 4 }), 10);
  assert.equal(accountingTotal({ stat: 8, level: 99 }), 30);
  assert.equal(accountingTotal({}), 0);
  assert.equal(accountingTotal({ stat: -3, level: 1 }), 0);
});

test('grades and skill fraction', () => {
  assert.equal(skillGrade(2), 'rookie');
  assert.equal(skillGrade(8), 'competent');
  assert.equal(skillGrade(12), 'seasoned');
  assert.equal(skillGrade(14), 'expert');
  assert.equal(skillGrade(20), 'elite');
  assert.equal(skillFraction(BROKER_TUNING.skillMin), 0);
  assert.equal(skillFraction(BROKER_TUNING.skillMax + 5), 1);
});

test('a broker is ALWAYS cheaper and slower than direct, for every skill level and every direct setting', () => {
  for (const commissionBps of [0, 10, 25, 100, 200, 500]) {
    for (const flatFee of [0, 1, 5, 50]) {
      const direct = directTerms({ commissionBps, flatFee });
      for (let total = 0; total <= 30; total++) {
        const b = brokerTerms(total, { commissionBps, flatFee });
        const label = `skill ${total}, direct ${commissionBps}bps + ${flatFee}`;
        assert.ok(b.latency.min >= 1, `${label}: a broker takes at least a tick (direct takes none)`);
        assert.ok(b.latency.max >= b.latency.min, `${label}: latency range is ordered`);
        assert.ok(b.flatFee <= direct.flatFee, `${label}: flat fee not above direct`);
        if (commissionBps > 0) assert.ok(b.commissionBps < direct.commissionBps, `${label}: commission below direct`);
        else assert.equal(b.commissionBps, 0);
      }
    }
  }
});

test('the broker fee is never more than the direct fee on the same trade', () => {
  for (let total = 0; total <= 30; total++) {
    for (const gross of [1, 20, 50, 333, 1000, 25000]) {
      const direct = computeFees(gross, feeProfileOf({ ...directTerms({}) }));
      const broker = computeFees(gross, feeProfileOf(brokerTerms(total)));
      assert.ok(broker <= direct, `skill ${total}, gross ${gross}: ${broker} <= ${direct}`);
    }
  }
});

test('a more skilled broker is faster, and gets better fund results', () => {
  let prev = null;
  for (let total = 2; total <= 24; total++) {
    const t = brokerTerms(total);
    if (prev) {
      assert.ok(t.latency.max <= prev.latency.max, `latency max does not grow (${total})`);
      assert.ok(t.latency.min <= prev.latency.min, `latency min does not grow (${total})`);
      assert.ok(t.loadRebate >= prev.loadRebate, `rebate does not shrink (${total})`);
      assert.ok(t.timingMeanBps >= prev.timingMeanBps, `timing does not worsen (${total})`);
    }
    prev = t;
  }
  assert.ok(brokerTerms(4).latency.max > brokerTerms(18).latency.max);
  assert.ok(brokerTerms(18).loadRebate > brokerTerms(4).loadRebate);
});

test('skilled brokers charge a premium (but still under direct): cost rises with skill', () => {
  assert.ok(brokerTerms(18).commissionBps > brokerTerms(5).commissionBps);
  assert.ok(brokerTerms(20).commissionBps < directTerms({}).commissionBps);
});

test('direct terms are normalised and bounded', () => {
  const d = directTerms({ commissionBps: -5, flatFee: 2.6, dv: 999, sessionTicks: 0, lockoutTicks: 0 });
  assert.equal(d.commissionBps, 0);
  assert.equal(d.flatFee, 3);
  assert.equal(d.dv, 40);
  assert.equal(d.sessionTicks, 1);
  assert.equal(d.lockoutTicks, 1);
  assert.equal(directTerms({}).network, DIRECT_DEFAULTS.network);
});

test('latency is deterministic for a key, within range, and varies between keys', () => {
  const t = brokerTerms(8);
  assert.equal(pickLatency(t, 's', 'k1'), pickLatency(t, 's', 'k1'));
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const n = pickLatency(t, 's', `k${i}`);
    assert.ok(n >= t.latency.min && n <= t.latency.max);
    seen.add(n);
  }
  assert.ok(seen.size > 1);
  assert.equal(pickLatency(brokerTerms(20), 's', 'x'), 1);
});

test('fund timing: skilled brokers beat the NAV on average, unskilled ones do worse, and it is reproducible', () => {
  const avg = (terms) => {
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += fundTiming({ terms, seed: 'w', key: `o${i}` });
    return sum / 400;
  };
  assert.ok(avg(brokerTerms(19)) > 15);
  assert.ok(avg(brokerTerms(4)) < 5);
  assert.ok(avg(brokerTerms(19)) > avg(brokerTerms(4)) + 15);
  assert.equal(fundTiming({ terms: brokerTerms(10), seed: 'w', key: 'a' }), fundTiming({ terms: brokerTerms(10), seed: 'w', key: 'a' }));
});

test('fund execution: a skilled broker buys cheaper and sells dearer than an unskilled one', () => {
  const fund = { loadBps: 100, exitBps: 50 };
  const rookie = brokerTerms(4);
  const elite = brokerTerms(20);
  const price = (side, terms, timingBps = 0) => fundExecutionPrice({ side, nav: 100, fund, terms, timingBps });
  assert.ok(price('buy', elite) < price('buy', rookie));
  assert.ok(price('sell', elite) > price('sell', rookie));
  assert.ok(price('buy', rookie) > 100, 'a rookie pays the full load');
  assert.ok(price('sell', rookie) < 100);
  assert.ok(price('buy', rookie, 20) < price('buy', rookie, 0), 'good timing lowers a buy price');
  assert.ok(price('sell', rookie, 20) > price('sell', rookie, 0), 'good timing raises a sell price');
  assert.ok(price('buy', rookie, -20) > price('buy', rookie, 0), 'bad timing costs the client');
});

test('describeTerms gives a readable summary', () => {
  const s = describeTerms(brokerTerms(12));
  assert.equal(s.grade, 'seasoned');
  assert.equal(s.total, 12);
  assert.ok(s.commissionPct > 0 && s.minDays >= 1 && s.maxDays >= s.minDays);
});

// ── Skill checks and terminal sessions ───────────────────────────────────────

const stub = (...values) => { const q = [...values]; return () => q.shift(); };

test('CPR d10: a 10 explodes upward, a 1 subtracts, anything else stands', () => {
  assert.deepEqual(cprD10(stub(6)), { total: 6, rolls: [6], crit: null });
  assert.deepEqual(cprD10(stub(10, 7)), { total: 17, rolls: [10, 7], crit: 'success' });
  assert.deepEqual(cprD10(stub(1, 4)), { total: -3, rolls: [1, 4], crit: 'fumble' });
});

test('a check meets or beats the DV', () => {
  const roll = { total: 5 };
  assert.equal(evaluateCheck({ stat: 6, level: 2, roll, dv: 13 }).success, true, 'exactly the DV passes');
  assert.equal(evaluateCheck({ stat: 6, level: 2, roll, dv: 14 }).success, false);
  const r = evaluateCheck({ stat: 6, level: 2, roll: { total: 9, crit: 'success' }, dv: 13 });
  assert.deepEqual([r.base, r.total, r.margin, r.crit], [8, 17, 4, 'success']);
});

test('passing opens a session for the window; failing locks out, doubled on a fumble', () => {
  const pass = planSession({ check: { success: true, total: 15, dv: 13 }, tick: 5, sessionTicks: 1, lockoutTicks: 1, source: 'network' });
  assert.equal(pass.passed, true);
  assert.deepEqual([pass.session.grantedTick, pass.session.validThroughTick], [5, 5]);
  assert.equal(planSession({ check: { success: true, total: 15, dv: 13 }, tick: 5, sessionTicks: 3, lockoutTicks: 1 }).session.validThroughTick, 7);

  assert.equal(planSession({ check: { success: false, crit: null }, tick: 5, sessionTicks: 1, lockoutTicks: 1 }).lockoutUntilTick, 6);
  assert.equal(planSession({ check: { success: false, crit: 'fumble' }, tick: 5, sessionTicks: 1, lockoutTicks: 1 }).lockoutUntilTick, 7);
});

test('session and lockout windows', () => {
  const p = { session: { grantedTick: 5, validThroughTick: 6 }, lockoutUntilTick: 9 };
  assert.deepEqual([4, 5, 6, 7].map((t) => sessionActive(p, t)), [false, true, true, false]);
  assert.deepEqual([8, 9].map((t) => lockedOut(p, t)), [true, false]);
  assert.equal(sessionActive(emptyPortfolio(), 1), false);
  assert.equal(lockedOut(emptyPortfolio(), 1), false);
});

// ── Funds ─────────────────────────────────────────────────────────────────────

test('component parsing accepts several spellings and reports unknown tickers', () => {
  const { components, unknown } = parseComponents('ara 30, MIL:20\nBIO=10; PET', ['ARA', 'MIL', 'BIO', 'PET']);
  assert.deepEqual(components, [{ companyId: 'ARA', weight: 30 }, { companyId: 'MIL', weight: 20 }, { companyId: 'BIO', weight: 10 }, { companyId: 'PET', weight: 1 }]);
  assert.deepEqual(unknown, []);
  assert.deepEqual(parseComponents('ARA 10, NOPE 5, ARA 5', ['ARA']).components, [{ companyId: 'ARA', weight: 15 }]);
  assert.deepEqual(parseComponents('ARA 10, NOPE 5', ['ARA']).unknown, ['NOPE']);
  assert.deepEqual(parseComponents('ARA 0, MIL -3').components, []);
  assert.deepEqual(parseComponents([{ companyId: 'ARA', weight: 2 }, { ticker: 'MIL' }]).components, [{ companyId: 'ARA', weight: 2 }, { companyId: 'MIL', weight: 1 }]);
});

test('sanitizeFund validates, normalises weights and bounds the costs', () => {
  const ok = sanitizeFund({ name: ' NC 50 ', ticker: 'nc50', components: 'ARA 3, MIL 1', expenseRatio: 9, loadBps: 9999, exitBps: -4, minBuy: '250', initialNav: 0, kind: 'weird' }, { knownIds: ['ARA', 'MIL'] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.fund.components, [{ companyId: 'ARA', weight: 0.75 }, { companyId: 'MIL', weight: 0.25 }]);
  assert.deepEqual([ok.fund.id, ok.fund.name, ok.fund.expenseRatio, ok.fund.loadBps, ok.fund.exitBps, ok.fund.minBuy, ok.fund.initialNav, ok.fund.kind], ['NC50', 'NC 50', 0.05, 500, 0, 250, 1, 'themed']);
  assert.deepEqual(sanitizeFund({ name: '', ticker: 'A', components: '' }).errors, ['name-required', 'ticker-invalid', 'components-invalid']);
  assert.ok(sanitizeFund({ name: 'X', ticker: 'XX', components: 'NOPE 1, ARA 1' }, { knownIds: ['ARA'] }).errors.includes('components-unknown'));
});

const FUND = { id: 'NC2', components: [{ companyId: 'A', weight: 0.5 }, { companyId: 'B', weight: 0.5 }], expenseRatio: 0.01, initialNav: 100 };
const PX = { A: 100, B: 50 };

test('a fund starts at its initial NAV and follows its components', () => {
  const s = makeFundState(FUND, PX);
  assert.deepEqual([s.nav, s.prevNav, s.accrual], [100, 100, 1]);
  const refreshed = refreshFundState(s, FUND, { A: 110, B: 55 });
  assert.equal(refreshed.nav, 110);
  assert.equal(fundValue(FUND.components, { A: 100 }), 50, 'a missing price counts as zero');
});

test('each tick the expense ratio drags the NAV and component dividends feed it', () => {
  const s0 = makeFundState(FUND, PX);
  const noIncome = { A: { dividend: { policy: 'none' }, status: 'active' }, B: { dividend: { policy: 'none' }, status: 'active' } };
  let s = s0;
  for (let i = 0; i < 365; i++) s = stepFundState(s, FUND, PX, noIncome);
  assert.ok(Math.abs(s.nav - 100 * (1 - 0.01 / 365) ** 365) < 0.1, `prices flat, 1% expense drag: ${s.nav}`);
  assert.ok(s.nav < 100 && s.nav > 98.5);
  const oneStep = stepFundState(s0, FUND, PX, noIncome);
  assert.equal(oneStep.prevNav, 100, 'prevNav is the NAV before the step');
  assert.ok(oneStep.accrual < 1, 'the drag accrues even when the rounded NAV has not moved yet');

  const payers = { A: { dividend: { policy: 'yield', yield: 0.05, frequency: 'quarterly' }, status: 'active' }, B: { dividend: { policy: 'yield', yield: 0.05, frequency: 'quarterly' }, status: 'active' } };
  let t = s0;
  for (let i = 0; i < 365; i++) t = stepFundState(t, FUND, PX, payers);
  assert.ok(t.nav > s.nav + 3, `5% yield lifts the NAV: ${t.nav} vs ${s.nav}`);
});

test('yield maths and bankrupt components', () => {
  assert.equal(annualYield({ status: 'active', dividend: { policy: 'fixed', perShare: 1, frequency: 'quarterly' } }, 100), 0.04);
  assert.equal(annualYield({ status: 'halted', dividend: { policy: 'yield', yield: 0.1 } }, 100), 0);
  assert.equal(annualYield({ status: 'active', dividend: { policy: 'none' } }, 100), 0);
  assert.ok(fundDailyYield(FUND, PX, { A: { status: 'active', dividend: { policy: 'yield', yield: 0.1, frequency: 'annual' } } }) > 0);
  assert.deepEqual(fundPrices({ A: 100, B: 50 }, { A: { status: 'bankrupt' }, B: { status: 'delisted' } }), { A: 0, B: 50 });
});

test('a split in a component leaves the fund NAV unchanged; composition adds to 1', () => {
  const s = makeFundState(FUND, PX);
  const split = splitFundComponents(FUND, 'A', 2);
  const after = refreshFundState(s, split, { A: 50, B: 50 });
  assert.equal(after.nav, 100);
  assert.equal(splitFundComponents(FUND, 'ZZ', 2), FUND);
  const comp = fundComposition(FUND, PX);
  assert.ok(Math.abs(comp.reduce((t, c) => t + c.share, 0) - 1) < 1e-9);
  assert.equal(comp[0].companyId, 'A');
});

// ── Withdrawals through a broker ─────────────────────────────────────────────

const cashed = (cash) => ({ ...emptyPortfolio(), cash });

test('a withdrawal hold takes amount and fee at once and records a pending withdrawal', () => {
  const r = holdWithdrawal({ portfolio: cashed(1000), key: 'k', amount: 400, fee: 20, brokerId: 'B1', tick: 3, latency: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.portfolio.cash, 580);
  assert.deepEqual(r.withdrawal, { id: 'w_k', amount: 400, fee: 20, brokerId: 'B1', submittedTick: 3, releaseTick: 5, status: 'pending' });
  assert.deepEqual(r.portfolio.ledger.map((l) => [l.kind, l.amount]), [['withdraw', -400], ['fee', -20]]);
  assert.equal(holdWithdrawal({ portfolio: cashed(100), key: 'k', amount: 400, fee: 0, brokerId: 'B', tick: 1, latency: 1 }).reason, 'insufficient-balance');
  assert.equal(holdWithdrawal({ portfolio: cashed(1000), key: 'k', amount: 50, brokerId: 'B', tick: 1, latency: 1, minWithdrawal: 100 }).reason, 'below-minimum');
});

test('withdrawals become due at the release tick, can be paid once, or refunded in full', () => {
  const held = holdWithdrawal({ portfolio: cashed(1000), key: 'k', amount: 400, fee: 20, brokerId: 'B1', tick: 3, latency: 2 }).portfolio;
  assert.equal(dueWithdrawals(held, 4).length, 0);
  assert.equal(dueWithdrawals(held, 5).length, 1);

  const paid = markWithdrawalPaid(held, 'w_k', 5);
  assert.equal(paid.portfolio.withdrawals[0].status, 'paid');
  assert.equal(paid.portfolio.cash, 580, 'paying does not touch the balance again');
  assert.equal(markWithdrawalPaid(paid.portfolio, 'w_k', 6).changed, false);
  assert.equal(dueWithdrawals(paid.portfolio, 9).length, 0);

  const refunded = refundWithdrawal(held, 'w_k', 4, 'cancelled');
  assert.equal(refunded.ok, true);
  assert.equal(refunded.portfolio.cash, 1000);
  assert.equal(refunded.portfolio.ledger.at(-1).kind, 'withdraw-refund');
  assert.equal(refundWithdrawal(refunded.portfolio, 'w_k', 4).reason, 'not-found');
  assert.equal(refundWithdrawal(paid.portfolio, 'w_k', 6).reason, 'not-found', 'a paid withdrawal cannot be refunded');
  assert.deepEqual(normalizePortfolio({}).withdrawals, []);
});
