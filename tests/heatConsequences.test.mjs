import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRequests, emptyPortfolio, brokerTerms, movedMoneySince, committedCash,
  HEAT_TIERS, HEAT_TUNING, HEAT_ACTIONS, HEAT_ACTION_IDS, PENALTY_TUNING, CRIT_BONUS,
  warningsFor, scrutinyFor, tierRank, isFrozen, brokerBanned, planInvestigation, makePenalty, sanitizePenaltyEdits,
  applyFine, applyFreeze, applyBrokerDrop,
  canAttempt, cooldownLeft, actionOutcome, runHeatAction, applyHeatEffect, setCharacterHeat, setWarned, upsertPenalty,
  emptyHeat, makeWindow, addWindow, applyAudit, auditWindow, scoreTrade, currentHeat, heatTier,
} from '../scripts/engine/index.js';

const DIRECT = { commissionBps: 200, flatFee: 5 };
const market = { ARA: { listed: true, active: true, price: 100, liquidity: 5 } };
const settings = (over = {}) => ({
  mode: 'open', depositFee: 0, direct: DIRECT, instant: true, seed: 's', heat: { enabled: true }, checks: {},
  brokers: { B1: { available: true, name: 'Bea', terms: brokerTerms(10, DIRECT) }, B2: { available: true, name: 'Bo', terms: brokerTerms(10, DIRECT) } },
  ...over,
});
let n = 0;
const req = (type, extra = {}) => ({ key: `k${++n}`, type, ...extra });
const run = (portfolio, requests, { tick = 10, s = settings() } = {}) => applyRequests({ portfolio, requests, wealth: 100000, tick, market, settings: s });
const last = (r) => r.portfolio.results.at(-1);
const funded = (over = {}) => ({ ...emptyPortfolio(), cash: 50000, brokerContactId: 'B1', ...over });

// ── Warnings and tiers ───────────────────────────────────────────────────────

test('a warning goes out once for each tier crossed upward, and falling back re-arms it', () => {
  assert.deepEqual(warningsFor({ heat: 10, warnedRank: 0 }), { send: [], warnedRank: 0, tier: 'quiet' });
  assert.deepEqual(warningsFor({ heat: 30, warnedRank: 0 }), { send: ['noticed'], warnedRank: 1, tier: 'noticed' });
  assert.deepEqual(warningsFor({ heat: 35, warnedRank: 1 }).send, [], 'already warned');
  assert.deepEqual(warningsFor({ heat: 55, warnedRank: 1 }), { send: ['flagged'], warnedRank: 2, tier: 'flagged' });
  assert.deepEqual(warningsFor({ heat: 80, warnedRank: 0 }).send, ['noticed', 'flagged'], 'a big jump sends each missed one');
  assert.deepEqual(warningsFor({ heat: 80, warnedRank: 2 }).send, [], 'investigated is a penalty, not a warning');
  const cooled = warningsFor({ heat: 10, warnedRank: 2 });
  assert.deepEqual([cooled.send, cooled.warnedRank], [[], 0]);
  assert.deepEqual(warningsFor({ heat: 30, warnedRank: cooled.warnedRank }).send, ['noticed'], 'and a later rise warns again');
  assert.deepEqual(HEAT_TIERS.map(tierRank), [0, 1, 2, 3]);
});

test('being flagged makes broker orders slower and dearer; below that nothing changes', () => {
  assert.deepEqual(scrutinyFor('quiet'), { latencyAdd: 0, feeMult: 1 });
  assert.deepEqual(scrutinyFor('noticed'), { latencyAdd: 0, feeMult: 1 });
  assert.deepEqual(scrutinyFor('flagged'), PENALTY_TUNING.scrutiny);
  assert.deepEqual(scrutinyFor('investigated'), PENALTY_TUNING.scrutiny);

  const order = (s) => run(funded(), [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 10 })], { s }).portfolio.orders[0];
  const calm = order(settings());
  const watched = order(settings({ scrutiny: scrutinyFor('flagged') }));
  assert.equal(watched.eligibleTick, calm.eligibleTick + 1, 'a day slower');
  assert.ok(Math.abs(watched.feeProfile.commissionBps - calm.feeProfile.commissionBps * 1.5) < 0.01, 'a half again on commission');
  assert.equal(watched.feeProfile.flatFee, calm.feeProfile.flatFee);
});

test('being watched also slows and prices broker withdrawals, but not direct ones', () => {
  const w = (s, p = funded()) => run(p, [req('withdraw', { amount: 10_000 })], { s });
  const calm = last(w(settings()));
  const watched = last(w(settings({ scrutiny: scrutinyFor('flagged') })));
  assert.equal(watched.releaseTick, calm.releaseTick + 1);
  assert.ok(watched.fee > calm.fee);
  const noBroker = last(w(settings({ scrutiny: scrutinyFor('flagged') }), funded({ brokerContactId: null })));
  assert.equal(noBroker.pending, undefined, 'straight to the wallet, untouched');
});

// ── Penalties ────────────────────────────────────────────────────────────────

test('an investigation chooses a penalty, the same one every time for the same audit', () => {
  const trades = [{ gross: 4000 }, { gross: 2000 }];
  const a = planInvestigation({ actorId: 'a', sourceKey: 'gig:1:done', heat: 80, trades, brokerId: 'B1' });
  const b = planInvestigation({ actorId: 'a', sourceKey: 'gig:1:done', heat: 80, trades, brokerId: 'B1' });
  assert.deepEqual(a, b);
  const kinds = new Set();
  for (let i = 0; i < 300; i++) kinds.add(planInvestigation({ actorId: `a${i}`, sourceKey: 'k', heat: 80, trades, brokerId: 'B1' }).kind);
  assert.deepEqual([...kinds].sort(), ['dropBroker', 'fine', 'freeze']);
});

test('without a broker nobody can be dropped, and the mix still follows the weights', () => {
  const counts = { fine: 0, freeze: 0, dropBroker: 0 };
  for (let i = 0; i < 1000; i++) counts[planInvestigation({ actorId: `a${i}`, sourceKey: 'k', heat: 80, trades: [{ gross: 3000 }], brokerId: null }).kind]++;
  assert.equal(counts.dropBroker, 0);
  assert.ok(counts.fine > counts.freeze, `${counts.fine} fines vs ${counts.freeze} freezes`);
  assert.ok(counts.fine / 1000 > 0.55 && counts.fine / 1000 < 0.7, 'about five in eight');
  const withBroker = { fine: 0, freeze: 0, dropBroker: 0 };
  for (let i = 0; i < 1000; i++) withBroker[planInvestigation({ actorId: `a${i}`, sourceKey: 'k', heat: 80, trades: [{ gross: 3000 }], brokerId: 'B1' }).kind]++;
  assert.ok(withBroker.dropBroker > 140 && withBroker.dropBroker < 260, `about one in five: ${withBroker.dropBroker}`);
});

test('fines and freezes grow with heat, and a fine follows what the trades moved', () => {
  const pick = (kind, heat, gross) => {
    for (let i = 0; i < 500; i++) {
      const p = planInvestigation({ actorId: `a${i}`, sourceKey: 'k', heat, trades: [{ gross }], brokerId: null });
      if (p.kind === kind) return p;
    }
    return null;
  };
  const mild = pick('fine', 75, 10_000).amount;
  const severe = pick('fine', 100, 10_000).amount;
  assert.equal(mild, 1000, '10% at the threshold');
  assert.equal(severe, 2500, '25% at the top');
  assert.equal(pick('fine', 75, 100).amount, PENALTY_TUNING.minFine, 'never below the minimum');
  assert.equal(pick('freeze', 75, 1).days, 2);
  assert.equal(pick('freeze', 100, 1).days, 5);
  const drop = planInvestigation({ actorId: 'x', sourceKey: 'drop-case', heat: 80, trades: [], brokerId: 'B1' });
  assert.ok(drop.kind !== 'dropBroker' || (drop.brokerId === 'B1' && drop.banDays === PENALTY_TUNING.banDays));
});

test('a fine takes what is owed, or what there is, and shows in the ledger', () => {
  const full = applyFine(funded({ cash: 5000 }), { amount: 1200, tick: 7, ref: 'case' });
  assert.deepEqual([full.paid, full.shortfall, full.portfolio.cash], [1200, 0, 3800]);
  assert.deepEqual(full.portfolio.ledger.at(-1), { ts: 7, kind: 'fine', assetId: null, qty: 0, amount: -1200, ref: 'case' });
  const short = applyFine(funded({ cash: 300 }), { amount: 1200, tick: 7 });
  assert.deepEqual([short.paid, short.shortfall, short.portfolio.cash], [300, 900, 0]);
  const broke = applyFine(funded({ cash: 0 }), { amount: 1200, tick: 7 });
  assert.deepEqual([broke.paid, broke.shortfall, broke.portfolio.ledger.length], [0, 1200, 0]);
  assert.equal(movedMoneySince(full.portfolio, 7), true, 'a fine blocks undoing the tick that caused it');
});

test('a frozen account cannot trade or withdraw, its open orders are voided, and it thaws on time', () => {
  const placed = run(funded(), [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 10 }), req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 5 })]).portfolio;
  assert.equal(placed.orders.filter((o) => o.status === 'open').length, 2);
  const ipo = { ...placed, orders: [...placed.orders, { id: 'ipo1', type: 'ipo', status: 'open', assetId: 'X', side: 'buy', reserve: 100 }] };

  const { portfolio: frozen, untilTick } = applyFreeze(ipo, { days: 3, tick: 10 });
  assert.equal(untilTick, 13);
  assert.deepEqual(frozen.orders.map((o) => [o.status, o.reason]), [['cancelled', 'frozen'], ['cancelled', 'frozen'], ['open', undefined]], 'trading orders voided, the IPO subscription kept');
  assert.equal(committedCash(frozen.orders) >= 0, true);
  assert.deepEqual([isFrozen(frozen, 12), isFrozen(frozen, 13)], [true, false]);

  const buy = last(run(frozen, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 1 })], { tick: 11 }));
  assert.equal(buy.reason, 'account-frozen');
  assert.equal(last(run(frozen, [req('withdraw', { amount: 100 })], { tick: 11 })).reason, 'account-frozen');
  assert.equal(last(run(frozen, [req('deposit', { amount: 100 })], { tick: 11 })).ok, true, 'money can still go in');
  assert.equal(last(run(frozen, [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 1 })], { tick: 13 })).ok, true, 'and it thaws');
  assert.equal(applyFreeze(applyFreeze(funded(), { days: 5, tick: 10 }).portfolio, { days: 2, tick: 10 }).untilTick, 15, 'a shorter freeze never shortens a longer one');
});

test('a broker who walks away is unassigned, refuses the character for a while, and loses their open orders', () => {
  const base = run(funded(), [req('placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 10 })]).portfolio;
  const direct = { ...base, orders: [...base.orders, { id: 'd1', status: 'open', route: 'direct', brokerId: null, assetId: 'ARA', side: 'buy', type: 'limit' }] };
  const { portfolio: dropped, dropped: did, brokerId } = applyBrokerDrop(direct, { brokerId: 'B1', banDays: 14, tick: 10 });
  assert.deepEqual([did, brokerId, dropped.brokerContactId], [true, 'B1', null]);
  assert.deepEqual(dropped.orders.map((o) => o.status), ['cancelled', 'open'], 'only orders through that broker');
  assert.equal(dropped.orders[0].reason, 'broker-dropped');
  assert.deepEqual([brokerBanned(dropped, 'B1', 23), brokerBanned(dropped, 'B1', 24), brokerBanned(dropped, 'B2', 11)], [true, false, false]);

  assert.equal(last(run(dropped, [req('setBroker', { brokerId: 'B1' })], { tick: 12 })).reason, 'broker-refuses');
  assert.equal(last(run(dropped, [req('setBroker', { brokerId: 'B2' })], { tick: 12 })).ok, true, 'another broker will take them');
  assert.equal(last(run(dropped, [req('setBroker', { brokerId: 'B1' })], { tick: 24 })).ok, true, 'and the ban ends');
  assert.equal(applyBrokerDrop(funded({ brokerContactId: null }), { tick: 1 }).dropped, false);
});

test('penalty records and GM edits', () => {
  const plan = { kind: 'fine', amount: 800 };
  const p = makePenalty({ id: 'p1', actorId: 'a', name: 'Alice', plan, tick: 9, sourceKey: 'k', heat: 80 });
  assert.deepEqual([p.kind, p.params, p.status], ['fine', { amount: 800 }, 'pending']);
  assert.deepEqual(sanitizePenaltyEdits('fine', { amount: 1234.6 }), { amount: 1235 });
  assert.deepEqual(sanitizePenaltyEdits('fine', { amount: -5 }), { amount: 0 });
  assert.equal(sanitizePenaltyEdits('fine', { amount: 'x' }), null);
  assert.deepEqual(sanitizePenaltyEdits('freeze', { days: 99 }), { days: 30 });
  assert.deepEqual(sanitizePenaltyEdits('freeze', { days: 0 }), { days: 1 });
  assert.deepEqual(sanitizePenaltyEdits('dropBroker', { days: 20 }), { banDays: 20 });
  assert.equal(sanitizePenaltyEdits('nope', {}), null);

  let heat = upsertPenalty(emptyHeat(), p);
  heat = upsertPenalty(heat, { ...p, status: 'applied' });
  assert.deepEqual(heat.penalties.map((x) => x.status), ['applied'], 'same id replaces');
  for (let i = 0; i < HEAT_TUNING.penaltyCap + 5; i++) heat = upsertPenalty(heat, { ...p, id: `n${i}` });
  assert.equal(heat.penalties.length, HEAT_TUNING.penaltyCap);
});

// ── Cover-up actions ─────────────────────────────────────────────────────────

test('each action is tied to its own skill, and the dearer ones are harder and riskier', () => {
  assert.deepEqual(HEAT_ACTION_IDS.map((id) => HEAT_ACTIONS[id].skill), ['Trading', 'Accounting', 'Business', 'Bribery']);
  assert.equal(HEAT_ACTIONS.bribe.stat, 'cool');
  assert.ok(['mask', 'books', 'front', 'bribe'].every((id, i, all) => i === 0 || HEAT_ACTIONS[id].dv >= HEAT_ACTIONS[all[i - 1]].dv), 'DV never falls as the stakes rise');
  assert.ok(HEAT_ACTIONS.bribe.reduce > HEAT_ACTIONS.books.reduce && HEAT_ACTIONS.books.reduce > HEAT_ACTIONS.mask.reduce);
  assert.ok(HEAT_ACTIONS.bribe.fail > 0 && HEAT_ACTIONS.mask.fail === 0, 'only a bribe can backfire on a plain miss');
  assert.ok(HEAT_ACTIONS.front.cover.factor < 1);
});

test('an action can be tried only when heat is on, the account is free, it is off cooldown and affordable', () => {
  const p = funded({ cash: 600 });
  const ok = (id, tick = 10, extra = {}) => canAttempt({ portfolio: { ...p, ...extra }, actionId: id, tick, enabled: true });
  assert.deepEqual(ok('books'), { ok: true });
  assert.equal(canAttempt({ portfolio: p, actionId: 'books', tick: 10, enabled: false }).reason, 'heat-off');
  assert.equal(ok('nope').reason, 'unknown-action');
  assert.equal(ok('bribe').reason, 'insufficient-funds', '3,000 eb is more than the 600 in the account');
  assert.equal(ok('books', 10, { frozenUntilTick: 12 }).reason, 'account-frozen');
  assert.equal(ok('books', 10, { heatCooldowns: { books: 12 } }).reason, 'on-cooldown');
  assert.deepEqual([cooldownLeft({ heatCooldowns: { books: 12 } }, 'books', 10), cooldownLeft({ heatCooldowns: { books: 12 } }, 'books', 12)], [2, 0]);
  assert.deepEqual(ok('books', 12, { heatCooldowns: { books: 12 } }), { ok: true }, 'ready again once the cooldown has passed');
});

test('a check decides the outcome: critical, success, miss, backfire and fumble', () => {
  const ck = (success, crit = null) => ({ success, crit });
  assert.deepEqual(actionOutcome('books', ck(true)), { outcome: 'success', passed: true, reduce: 15, add: 0, coverTicks: 0, coverFactor: null });
  const crit = actionOutcome('books', ck(true, 'success'));
  assert.deepEqual([crit.outcome, crit.reduce], ['critical', 15 * CRIT_BONUS]);
  assert.deepEqual(actionOutcome('books', ck(false)), { outcome: 'failure', passed: false, reduce: 0, add: 0, coverTicks: 0, coverFactor: null });
  assert.equal(actionOutcome('bribe', ck(false)).add, 8, 'a refused bribe gets talked about');
  assert.deepEqual([actionOutcome('bribe', ck(false, 'fumble')).outcome, actionOutcome('bribe', ck(false, 'fumble')).add], ['fumble', 20]);
  assert.equal(actionOutcome('books', ck(true, 'fumble')).outcome, 'success', 'a fumbled die that still beats the DV is a pass');
  const front = actionOutcome('front', ck(true));
  assert.deepEqual([front.reduce, front.coverTicks, front.coverFactor], [5, 7, 0.5]);
  assert.equal(actionOutcome('front', ck(true, 'success')).coverTicks, 11, 'a critical lengthens the cover');
});

const checkFor = (key, roll, over = {}) => ({ [key]: { stat: 6, level: 6, dv: 15, roll: { total: roll, rolls: [roll], crit: null }, ...over } });

test('trying an action takes the cost and starts the cooldown whether or not it works', () => {
  const pass = req('heatAction', { action: 'books' });
  const passed = run(funded({ cash: 5000 }), [pass], { s: settings({ checks: checkFor(pass.key, 6) }) });
  const r = last(passed);
  assert.deepEqual([r.ok, r.passed, r.outcome, r.action, r.cost, r.total, r.dv, r.reduce], [true, true, 'success', 'books', 500, 18, 15, 15]);
  assert.equal(passed.portfolio.cash, 4500);
  assert.deepEqual(passed.portfolio.ledger.at(-1), { ts: 10, kind: 'cover', assetId: null, qty: 0, amount: -500, ref: pass.key });
  assert.equal(passed.portfolio.heatCooldowns.books, 13);

  const miss = req('heatAction', { action: 'bribe' });
  const missed = run(funded({ cash: 5000 }), [miss], { s: settings({ checks: checkFor(miss.key, 1, { stat: 3, level: 2, dv: 17 }) }) });
  assert.deepEqual([last(missed).passed, last(missed).outcome, last(missed).add], [false, 'failure', 8]);
  assert.equal(missed.portfolio.cash, 2000, 'the money is gone anyway');

  const again = run(passed.portfolio, [req('heatAction', { action: 'books' })], { s: settings({ checks: {} }) });
  assert.equal(last(again).reason, 'on-cooldown');
});

test('an action with no roll, no money, heat tracking off or a forged name does nothing', () => {
  const a = req('heatAction', { action: 'books' });
  assert.equal(last(run(funded(), [a])).reason, 'no-check');
  const unverified = req('heatAction', { action: 'books' });
  const refused = run(funded(), [unverified], { s: settings({ checks: { [unverified.key]: { failed: 'roll-used' } } }) });
  assert.equal(last(refused).reason, 'roll-used', 'a roll the GM could not verify says why');
  assert.equal(refused.portfolio.cash, 50000, 'and costs nothing');
  assert.equal(run(funded(), [req('heatAction', { action: 'books' })]).portfolio.cash, 50000);
  const broke = req('heatAction', { action: 'books' });
  assert.equal(last(run(funded({ cash: 100 }), [broke], { s: settings({ checks: checkFor(broke.key, 9) }) })).reason, 'insufficient-funds');
  const off = req('heatAction', { action: 'books' });
  assert.equal(last(run(funded(), [off], { s: settings({ heat: { enabled: false }, checks: checkFor(off.key, 9) }) })).reason, 'heat-off');
  const forged = req('heatAction', { action: 'giveMeMoney' });
  assert.equal(last(run(funded(), [forged], { s: settings({ checks: checkFor(forged.key, 9) }) })).reason, 'unknown-action');
});

test('a player cannot forge a penalty: the executor has no such request', () => {
  for (const type of ['heatFine', 'heatFreeze', 'applyFine', 'clearHeat', 'dropBroker']) {
    const r = run(funded(), [req(type, { amount: 1, days: 1 })]);
    assert.equal(last(r).reason, 'unknown-request', type);
    assert.equal(r.portfolio.cash, 50000);
  }
});

// ── Effect on the heat record ────────────────────────────────────────────────

const who = (key = 'k1') => ({ actorId: 'a1', name: 'Alice', key, action: 'books', tick: 20 });

test('a successful action takes heat off, never below nothing, and is applied once', () => {
  const start = { ...emptyHeat(), characters: { a1: { heat: 40, tick: 20, name: 'Alice', log: [] } } };
  const a = applyHeatEffect(start, who(), { reduce: 15, add: 0 });
  assert.deepEqual([a.applied, a.heat.characters.a1.heat], [true, 25]);
  assert.deepEqual(a.heat.characters.a1.log.at(-1), { tick: 20, date: '', gain: -15, action: 'books', companyId: null, sourceKey: 'k1', trades: 0 });
  const again = applyHeatEffect(a.heat, who(), { reduce: 15, add: 0 });
  assert.deepEqual([again.applied, again.heat.characters.a1.heat], [false, 25], 'the same request never counts twice');
  assert.equal(applyHeatEffect(a.heat, who('k2'), { reduce: 99, add: 0 }).heat.characters.a1.heat, 0);
  assert.equal(applyHeatEffect(emptyHeat(), who(), { reduce: 15, add: 0 }).heat.characters.a1.heat, 0, 'nothing to take off');
});

test('a backfire adds heat, up to the maximum, and fades what was there first', () => {
  const start = { ...emptyHeat(), characters: { a1: { heat: 40, tick: 20 - HEAT_TUNING.halfLifeTicks, name: 'Alice' } } };
  assert.equal(applyHeatEffect(start, who(), { reduce: 0, add: 8 }).heat.characters.a1.heat, 28, '40 halved to 20, then +8');
  assert.equal(applyHeatEffect({ ...emptyHeat(), characters: { a1: { heat: 95, tick: 20 } } }, who(), { reduce: 0, add: 20 }).heat.characters.a1.heat, HEAT_TUNING.maxHeat);
  assert.equal(applyHeatEffect(emptyHeat(), who(), { reduce: 0, add: 8 }).heat.characters.a1.heat, 8, 'creates a record');
});

test('a front company buys cover that cuts the heat from the next audits, until it runs out', () => {
  const covered = applyHeatEffect(emptyHeat(), who(), { reduce: 5, add: 0, coverTicks: 7, coverFactor: 0.5 }).heat;
  assert.deepEqual(covered.characters.a1.cover, { until: 27, factor: 0.5 });

  const w = makeWindow({ id: 'w1', sourceKey: 'gig:1:done', companyId: 'ARA', outcome: 'done', openTick: 18, closeTick: 19 });
  const result = [{ actorId: 'a1', name: 'Alice', gain: 40, trades: [{ gross: 5000 }] }];
  const inside = applyAudit(addWindow(covered, w), { window: w, results: result, tick: 22 });
  assert.equal(inside.characters.a1.heat, 20, 'half of 40');
  assert.equal(inside.audits.at(-1).results[0].applied, 20);
  assert.equal(inside.audits.at(-1).results[0].gain, 40, 'the audit keeps what the trades scored');
  assert.equal(inside.audits.at(-1).results[0].covered, true);
  assert.equal(inside.characters.a1.cover.factor, 0.5, 'an audit does not use up the cover, the days do');
  assert.deepEqual(inside.characters.a1.applied, ['k1'], 'an audit keeps what an action recorded');

  const w2 = makeWindow({ id: 'w2', sourceKey: 'gig:2:done', companyId: 'ARA', outcome: 'done', openTick: 28, closeTick: 29 });
  const outside = applyAudit(addWindow(covered, w2), { window: w2, results: result, tick: 30 });
  assert.ok(outside.characters.a1.heat > 35, `no cover after it expires: ${outside.characters.a1.heat}`);
  assert.equal(outside.audits.at(-1).results[0].covered, undefined);
});

test('a skilled broker leaves a smaller trail than a rookie, but only on trades made through them', () => {
  const w = makeWindow({ id: 'w', sourceKey: 'k', companyId: 'ARA', outcome: 'done', openTick: 10, closeTick: 12 });
  const order = (id, route, brokerId) => ({ id, assetId: 'ARA', assetType: 'stock', side: 'buy', qty: 1, fillPrice: 3000, status: 'filled', route, brokerId, submittedTick: 10 });
  const audit = (brokerFactors, orders) => auditWindow({ window: w, portfolios: [{ actorId: 'a', value: 30_000, orders, brokerFactors }] })[0];
  const rookie = audit({ R: HEAT_TUNING.brokerFactor.rookie }, [order('o1', 'broker', 'R')]);
  const elite = audit({ E: HEAT_TUNING.brokerFactor.elite }, [order('o1', 'broker', 'E')]);
  assert.ok(Math.abs(elite.gain / rookie.gain - HEAT_TUNING.brokerFactor.elite) < 0.02, `${elite.gain} vs ${rookie.gain}`);
  assert.equal(elite.trades[0].brokerFactor, 0.65);
  assert.equal(rookie.trades[0].brokerFactor, undefined);
  const direct = audit({ E: 0.65 }, [order('o2', 'direct', null)]);
  assert.equal(direct.gain, 14, 'a direct trade is not covered by anyone');
  assert.deepEqual(HEAT_TUNING.brokerFactor, { rookie: 1, competent: 0.95, seasoned: 0.85, expert: 0.75, elite: 0.65 });
  assert.equal(scoreTrade({ order: order('o3', 'broker', 'E'), window: w, actorId: 'a', portfolioValue: 30_000, brokerFactor: 5 }).gain, scoreTrade({ order: order('o3', 'broker', 'E'), window: w, actorId: 'a', portfolioValue: 30_000 }).gain, 'a factor above 1 is ignored');
});

test('the GM can set a character\'s heat outright, and clear it', () => {
  let heat = applyHeatEffect(emptyHeat(), who(), { reduce: 0, add: 40 }).heat;
  heat = setCharacterHeat(heat, { actorId: 'a1', value: 12, tick: 21, date: 'd' });
  assert.equal(heat.characters.a1.heat, 12);
  assert.equal(heat.characters.a1.log.at(-1).action, 'gm');
  assert.deepEqual(heat.characters.a1.applied, ['k1'], 'the rest of the record is kept');
  assert.equal(setCharacterHeat(heat, { actorId: 'a1', value: 0, tick: 22 }).characters.a1.heat, 0);
  assert.equal(setCharacterHeat(heat, { actorId: 'a1', value: 500, tick: 22 }).characters.a1.heat, HEAT_TUNING.maxHeat);
  assert.equal(setCharacterHeat(emptyHeat(), { actorId: 'new', name: 'Newbie', value: 30, tick: 1 }).characters.new.name, 'Newbie');
  assert.equal(heatTier(currentHeat(setCharacterHeat(emptyHeat(), { actorId: 'x', value: 60, tick: 5 }).characters.x, 5)), 'flagged');
});

test('what a character has been warned about is remembered', () => {
  const heat = setWarned({ ...emptyHeat(), characters: { a1: { heat: 30, tick: 1 } } }, 'a1', 1);
  assert.equal(heat.characters.a1.warned, 1);
  assert.equal(setWarned(heat, 'a1', 1), heat, 'no change, no new object');
  assert.equal(setWarned(emptyHeat(), 'nobody', 2).characters.nobody, undefined, 'only for characters that have a record');
});
