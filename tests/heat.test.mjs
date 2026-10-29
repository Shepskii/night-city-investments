import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEAT_TUNING, emptyHeat, normalizeHeat, heatTier, decayHeat, currentHeat, directionOf, makeWindow, placedInWindow, windowReady,
  scoreTrade, auditWindow, applyAudit, addWindow, voidWindow, pruneWindows,
} from '../scripts/engine/index.js';

const win = (extra = {}) => makeWindow({ id: 'w1', sourceKey: 'gig:1:done', companyId: 'ARA', outcome: 'done', openTick: 10, closeTick: 12, openDate: '2045-03-15', ...extra });
const order = (extra = {}) => ({ id: 'o1', assetId: 'ARA', assetType: 'stock', side: 'buy', qty: 20, fillPrice: 240, status: 'filled', route: 'direct', submittedTick: 10, ...extra });
const score = (o = {}, w = win(), extra = {}) => scoreTrade({ order: order(o), window: w, actorId: 'a1', portfolioValue: 30_000, ...extra });

test('heat tiers follow the thresholds', () => {
  assert.deepEqual([0, 24.9, 25, 49.9, 50, 74.9, 75, 100].map((h) => heatTier(h)), ['quiet', 'quiet', 'noticed', 'noticed', 'flagged', 'flagged', 'investigated', 'investigated']);
});

test('heat halves every half-life and never grows back', () => {
  assert.equal(decayHeat(80, 5, 5), 80);
  assert.ok(Math.abs(decayHeat(80, 0, HEAT_TUNING.halfLifeTicks) - 40) < 1e-9);
  assert.ok(Math.abs(decayHeat(80, 0, 2 * HEAT_TUNING.halfLifeTicks) - 20) < 1e-9);
  assert.equal(decayHeat(80, 9, 3), 80, 'time going backwards (an undo) does not add heat');
  assert.equal(currentHeat(undefined, 5), 0);
  assert.equal(currentHeat({ heat: 60, tick: 0 }, 7), 30);
});

test('news direction follows the outcome', () => {
  assert.equal(directionOf('done'), 'up');
  assert.equal(directionOf('failed'), 'down');
  assert.equal(win({ outcome: 'failed' }).direction, 'down');
});

test('a window never closes before it opens and de-duplicates its people', () => {
  const w = makeWindow({ id: 'x', sourceKey: 'k', companyId: 'ARA', outcome: 'done', openTick: 10, closeTick: 4, tipped: ['a', 'a', 'b'], runners: ['c', 'c'] });
  assert.equal(w.closeTick, 10);
  assert.deepEqual(w.tipped, ['a', 'b']);
  assert.deepEqual(w.runners, ['c']);
  assert.equal(w.status, 'open');
});

test('only stock orders on the window\'s company, placed inside it, are in the window', () => {
  const w = win();
  assert.equal(placedInWindow(order({ submittedTick: 9 }), w), false, 'placed the day before');
  assert.equal(placedInWindow(order({ submittedTick: 10 }), w), true);
  assert.equal(placedInWindow(order({ submittedTick: 12 }), w), true);
  assert.equal(placedInWindow(order({ submittedTick: 13 }), w), false, 'after the effect shows');
  assert.equal(placedInWindow(order({ assetId: 'MIL' }), w), false);
  assert.equal(placedInWindow(order({ assetType: 'fund' }), w), false);
});

test('a buy before good news counts; a sale before it does not', () => {
  const buy = score();
  assert.ok(buy && buy.gain > 15 && buy.gain < 30, `gain ${buy?.gain}`);
  assert.deepEqual([buy.side, buy.route, buy.knowledge, buy.gross], ['buy', 'direct', 'general', 4800]);
  assert.equal(score({ side: 'sell' }), null);
});

test('a sale before bad news counts; a buy before it does not', () => {
  const w = win({ outcome: 'failed' });
  assert.ok(score({ side: 'sell' }, w).gain > 0);
  assert.equal(score({ side: 'buy' }, w), null);
});

test('orders that are not filled, are outside the window, or are pocket change draw nothing', () => {
  assert.equal(score({ status: 'open' }), null);
  assert.equal(score({ status: 'cancelled' }), null);
  assert.equal(score({ submittedTick: 9 }), null);
  assert.equal(score({ submittedTick: 13 }), null);
  assert.equal(score({ assetType: 'fund' }), null);
  assert.equal(score({ qty: 1, fillPrice: 240 }), null, 'under the minimum trade');
  assert.ok(score({ qty: 2, fillPrice: 200 }), 'at the minimum trade');
});

test('bigger trades draw more, in absolute size and as a share of the portfolio', () => {
  const small = score({ qty: 5 }).gain;
  const mid = score({ qty: 20 }).gain;
  const big = score({ qty: 60 }).gain;
  assert.ok(small < mid && mid < big, `${small} < ${mid} < ${big}`);
  const poor = scoreTrade({ order: order(), window: win(), actorId: 'a', portfolioValue: 6000 }).gain;
  const rich = scoreTrade({ order: order(), window: win(), actorId: 'a', portfolioValue: 600_000 }).gain;
  assert.ok(poor > rich, 'the same trade is a bigger bet for a smaller portfolio');
});

test('heat keeps growing with trade size, up to a cap of four medium trades', () => {
  const at = (gross, value = 30_000) => scoreTrade({ order: order({ qty: 1, fillPrice: gross }), window: win(), actorId: 'a', portfolioValue: value }).gain;
  const medium = at(3000);
  assert.equal(medium, HEAT_TUNING.base, 'a medium trade (3,000 eb, 10% of the portfolio) is worth the base');
  assert.ok(Math.abs(at(6000, 30_000) / medium - 2) < 0.05, 'twice the size in eb and in share of the portfolio: twice the heat');
  assert.ok(at(6000, 60_000) > medium && at(6000, 60_000) < at(6000, 30_000), 'a bigger trade in a bigger portfolio counts for less than the same trade in a small one');
  assert.ok(at(10_000) > at(5000) && at(5000) > at(3000), 'a large trade draws more than a medium one');
  const huge = scoreTrade({ order: order({ qty: 10_000 }), window: win(), actorId: 'a', portfolioValue: 1_000 }).gain;
  assert.equal(huge, HEAT_TUNING.base * HEAT_TUNING.sizeRef.cap, 'capped at four medium trades');
});

test('one to three medium trades are enough to reach the first warning bracket', () => {
  const medium = { qty: 1, fillPrice: 3000 };
  const heatFor = (n, o = {}) => {
    const portfolios = [{ actorId: 'a1', value: 30_000, orders: Array.from({ length: n }, (_, i) => order({ id: `o${i}`, ...medium, ...o })) }];
    return auditWindow({ window: win(), portfolios })[0]?.gain ?? 0;
  };
  const noticed = HEAT_TUNING.tiers.noticed;
  assert.ok(heatFor(1, { route: 'direct' }) < noticed, 'one medium trade alone is not enough');
  assert.ok(heatFor(2, { route: 'direct' }) >= noticed, 'two direct medium trades are');
  assert.ok(heatFor(3, { route: 'broker' }) >= noticed, 'so are three through a broker');
  assert.ok(heatFor(1, { fillPrice: 5000 }) < noticed && heatFor(2, { fillPrice: 5000 }) >= noticed, 'two 5,000 eb trades comfortably');
  assert.equal(heatTier(heatFor(1, { fillPrice: 6000 })), 'noticed', 'one larger trade is a warning on its own');
  assert.ok(heatFor(3, { route: 'broker', submittedTick: 12 }) < noticed, 'last-minute broker trades can still slip under');
});

test('two large trades on the same news make a character investigated', () => {
  const portfolios = [{ actorId: 'a1', value: 30_000, orders: [order({ id: 'a', qty: 1, fillPrice: 12_000 }), order({ id: 'b', qty: 1, fillPrice: 12_000 })] }];
  assert.equal(heatTier(auditWindow({ window: win(), portfolios })[0].gain), 'investigated');
});

test('trading earlier in the window draws more than trading on its last day', () => {
  const first = score({ submittedTick: 10 }).gain;
  const mid = score({ submittedTick: 11 }).gain;
  const last = score({ submittedTick: 12 }).gain;
  assert.ok(first > mid && mid > last);
  assert.ok(Math.abs(last / first - (1 - HEAT_TUNING.earlyDrop)) < 0.02);
  const oneDay = makeWindow({ id: 'x', sourceKey: 'k', companyId: 'ARA', outcome: 'done', openTick: 10, closeTick: 10 });
  assert.equal(score({ submittedTick: 10 }, oneDay).gain, first, 'a one-day window is all "first day"');
});

test('knowing more draws more: the gig runner most, a rumour follower far less', () => {
  const general = score().gain;
  const runner = score({}, win({ runners: ['a1'] })).gain;
  const tipped = score({}, win({ tipped: ['a1'] })).gain;
  const both = score({}, win({ runners: ['a1'], tipped: ['a1'] }));
  assert.ok(Math.abs(runner / general - HEAT_TUNING.knowledge.runner) < 0.05);
  assert.ok(Math.abs(tipped / general - HEAT_TUNING.knowledge.tipped) < 0.05);
  assert.equal(both.knowledge, 'runner', 'running the gig outweighs a rumour');
  assert.equal(score({}, win({ tipped: ['someone-else'] })).knowledge, 'general');
});

test('a syndicate knows what any of its members knows', () => {
  assert.equal(score({}, win({ runners: ['m2'] }), { actorId: 'syn', aliases: ['m1', 'm2'] }).knowledge, 'runner');
  assert.equal(score({}, win({ tipped: ['m1'] }), { actorId: 'syn', aliases: ['m1', 'm2'] }).knowledge, 'tipped');
  assert.equal(score({}, win({ tipped: ['m3'] }), { actorId: 'syn', aliases: ['m1', 'm2'] }).knowledge, 'general');
  const [r] = auditWindow({ window: win({ runners: ['m1'] }), portfolios: [{ actorId: 'syn', aliases: ['m1'], orders: [order()], value: 30_000 }] });
  assert.equal(r.trades[0].knowledge, 'runner');
});

test('direct trades leave a bigger trail than broker trades', () => {
  const direct = score({ route: 'direct' }).gain;
  const broker = score({ route: 'broker' }).gain;
  assert.ok(Math.abs(broker / direct - HEAT_TUNING.route.broker) < 0.05);
  assert.equal(score({ route: undefined }).route, 'direct', 'an old order with no route is treated as direct');
});

test('the GM\'s strength scales heat within its range', () => {
  const one = score({}, win(), { strength: 1 }).gain;
  assert.ok(Math.abs(score({}, win(), { strength: 2 }).gain / one - 2) < 0.05);
  assert.ok(Math.abs(score({}, win(), { strength: 99 }).gain / one - 3) < 0.05, 'capped at 3x');
  assert.equal(score({}, win(), { strength: 0 }), null, 'zero strength draws nothing');
});

test('an audit scores each character and skips those with nothing to answer for', () => {
  const portfolios = [
    { actorId: 'a1', name: 'Alice', value: 30_000, orders: [order({ id: 'o1' }), order({ id: 'o2', submittedTick: 11, qty: 10 })] },
    { actorId: 'a2', name: 'Bob', value: 30_000, orders: [order({ id: 'o3', side: 'sell' }), order({ id: 'o4', submittedTick: 8 })] },
    { actorId: 'a3', name: 'Cara', value: 30_000, orders: [] },
  ];
  const results = auditWindow({ window: win(), portfolios });
  assert.deepEqual(results.map((r) => r.actorId), ['a1']);
  assert.equal(results[0].name, 'Alice');
  assert.equal(results[0].trades.length, 2);
  assert.ok(Math.abs(results[0].gain - results[0].trades.reduce((s, t) => s + t.gain, 0)) < 0.11);
});

test('one audit can add at most the maximum heat', () => {
  const orders = Array.from({ length: 10 }, (_, i) => order({ id: `o${i}`, qty: 1000 }));
  const [r] = auditWindow({ window: win(), portfolios: [{ actorId: 'a1', value: 1_000_000, orders }] });
  assert.equal(r.gain, HEAT_TUNING.maxHeat);
});

test('recording an audit fades old heat, adds the new, closes the window and keeps a log', () => {
  let heat = addWindow(emptyHeat(), win());
  const results = [{ actorId: 'a1', name: 'Alice', gain: 40, trades: [{ orderId: 'o1' }] }];
  heat = applyAudit(heat, { window: win(), results, tick: 14, date: 'd1' });
  assert.equal(heat.characters.a1.heat, 40);
  assert.equal(heat.windows[0].status, 'audited');
  assert.equal(heat.windows[0].auditedTick, 14);
  assert.equal(heat.audits.length, 1);
  assert.deepEqual(heat.audits[0].results, [{ ...results[0], applied: 40 }]);

  const w2 = win({ id: 'w2', sourceKey: 'gig:2:done' });
  heat = applyAudit(addWindow(heat, w2), { window: w2, results: [{ actorId: 'a1', name: 'Alice', gain: 30, trades: [{}] }], tick: 14 + HEAT_TUNING.halfLifeTicks });
  assert.equal(heat.characters.a1.heat, 50, 'the first 40 halved to 20, then +30');
  assert.equal(heat.characters.a1.log.length, 2);
  assert.equal(heat.characters.a1.log[1].companyId, 'ARA');

  const w3 = win({ id: 'w3', sourceKey: 'gig:3:done' });
  heat = applyAudit(addWindow(heat, w3), { window: w3, results: [{ actorId: 'a1', name: 'Alice', gain: 90, trades: [{}] }], tick: 22 });
  assert.equal(heat.characters.a1.heat, HEAT_TUNING.maxHeat, 'never past the maximum');
});

test('an audit with nobody to blame still closes the window and is kept', () => {
  const heat = applyAudit(addWindow(emptyHeat(), win()), { window: win(), results: [], tick: 14 });
  assert.deepEqual(heat.characters, {});
  assert.equal(heat.windows[0].status, 'audited');
  assert.equal(heat.audits[0].results.length, 0);
});

test('logs and audits are capped', () => {
  let heat = emptyHeat();
  for (let i = 0; i < HEAT_TUNING.auditCap + 10; i++) {
    const w = win({ id: `w${i}`, sourceKey: `gig:${i}:done` });
    heat = applyAudit(addWindow(heat, w), { window: w, results: [{ actorId: 'a1', name: 'Alice', gain: 1, trades: [{}] }], tick: 20 + i });
  }
  assert.equal(heat.audits.length, HEAT_TUNING.auditCap);
  assert.equal(heat.characters.a1.log.length, HEAT_TUNING.logCap);
  assert.ok(heat.windows.length <= HEAT_TUNING.windowCap);
});

test('a gig opens one window, and a window can be voided', () => {
  let heat = addWindow(emptyHeat(), win());
  heat = addWindow(heat, win({ id: 'again' }));
  assert.equal(heat.windows.length, 1, 'the same gig key is not watched twice');
  heat = voidWindow(heat, 'w1');
  assert.equal(heat.windows[0].status, 'void');
  assert.equal(voidWindow(heat, 'nope').windows.length, 1);
});

test('pruning keeps every open window and the newest closed ones', () => {
  const windows = [
    ...Array.from({ length: 50 }, (_, i) => ({ ...win({ id: `c${i}`, sourceKey: `c${i}` }), status: 'audited' })),
    win({ id: 'open1', sourceKey: 'open1' }),
    win({ id: 'open2', sourceKey: 'open2' }),
  ];
  const kept = pruneWindows(windows);
  assert.equal(kept.length, HEAT_TUNING.windowCap);
  assert.ok(kept.some((w) => w.id === 'open1') && kept.some((w) => w.id === 'open2'));
  assert.ok(kept.some((w) => w.id === 'c49') && !kept.some((w) => w.id === 'c0'), 'oldest closed ones go first');
  assert.equal(pruneWindows(windows.slice(0, 5)).length, 5);
});

test('a window is ready once it has closed and its orders have filled, or after the wait runs out', () => {
  const w = win();
  const filledList = [order({ status: 'filled' })];
  const openList = [order({ status: 'open' })];
  assert.equal(windowReady(w, 12, [filledList]), false, 'the last day is still inside the window');
  assert.equal(windowReady(w, 13, [filledList, []]), true);
  assert.equal(windowReady(w, 13, [openList]), false, 'an order placed in the window is still working');
  assert.equal(windowReady(w, 13, [[order({ status: 'open', submittedTick: 9 })]]), true, 'an order placed before the window does not hold it up');
  assert.equal(windowReady(w, 13, [[order({ status: 'open', assetId: 'MIL' })]]), true, 'nor one on another company');
  assert.equal(windowReady(w, 12 + HEAT_TUNING.maxWaitTicks, [openList]), false);
  assert.equal(windowReady(w, 13 + HEAT_TUNING.maxWaitTicks, [openList]), true, 'it does not wait forever');
  assert.equal(windowReady({ ...w, status: 'audited' }, 99, []), false);
});

test('a stored record is repaired when it is incomplete', () => {
  assert.deepEqual(normalizeHeat(null), emptyHeat());
  const h = normalizeHeat({ characters: 'nope', windows: null, audits: {} });
  assert.deepEqual([h.characters, h.windows, h.audits], [{}, [], []]);
});
