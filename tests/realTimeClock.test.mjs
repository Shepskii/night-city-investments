import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const env = installFakeFoundry({ actors: [['Alice', 90000, true]] });
game.users.filter = () => [];
game.nightcity = { messageService: { sendMessage: async () => ({ success: true }) } };
env.store.set('tickMode', 'realTime');
env.store.set('realTimeMinutes', 10);

let S;

before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    engine: await load('../scripts/engine/index.js'),
  };
  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
});

const pub = () => S.MarketStore.getPublic();
const day = () => S.engine.dayIndex(env.clock.ms);
const move = async (ms) => { env.clock.ms += ms; await S.TickService.checkClock(); };

test('the first look at the clock only sets the market date and the timer', async () => {
  const pub0 = pub();
  assert.equal(pub0.lastDay, day(), 'a new market starts on the calendar date');
  assert.equal(pub0.lastMs, env.clock.ms);
  await S.TickService.checkClock();
  assert.equal(pub().tickIndex, 0);
});

test('one tick for each interval of in-world clock time, keeping the part-interval left over', async () => {
  await move(9 * MIN);
  assert.equal(pub().tickIndex, 0, 'nine minutes is not enough');
  await move(1 * MIN);
  assert.equal(pub().tickIndex, 1);
  await move(25 * MIN);
  assert.equal(pub().tickIndex, 3, 'twenty-five minutes owes two ticks');
  await move(4 * MIN);
  assert.equal(pub().tickIndex, 3, 'the five left over from before plus four is still short');
  await move(1 * MIN);
  assert.equal(pub().tickIndex, 4, 'and one more minute completes the interval');
  assert.equal(S.MarketStore.getHistory().series.ARA.closes.length, 1, 'the chart keeps one close per game day, however many ticks there were');
  assert.equal(pub().lastDay, day());
});

test('the interval is the module setting', async () => {
  env.store.set('realTimeMinutes', 30);
  const tick = pub().tickIndex;
  await move(29 * MIN);
  assert.equal(pub().tickIndex, tick);
  await move(1 * MIN);
  assert.equal(pub().tickIndex, tick + 1);
  env.store.set('realTimeMinutes', 10);
});

test('when the calendar date changes the market takes the new date with no tick', async () => {
  const tick = pub().tickIndex;
  const before = day();
  const clock0 = S.MarketStore.time();
  await move(14 * HOUR);
  assert.equal(day(), before + 1, 'the calendar moved to the next day');
  assert.equal(pub().lastDay, day(), 'the market date matches');
  assert.equal(pub().tickIndex, tick + 60, 'fourteen hours owes eighty-four intervals; the cap runs the latest sixty');
  assert.equal(pub().lastMs, env.clock.ms, 'and the timer restarts after a capped catch-up');
  assert.ok(Math.abs(S.MarketStore.time() - clock0 - 60 * 10 / 1440) < 1e-6, 'game time moved only by the ticks that ran');

  await move(10 * MIN);
  assert.equal(pub().tickIndex, tick + 61, 'ticking carries on from there');
});

test('a jump of days in the calendar catches the market up a game day at a time', async () => {
  const tick = pub().tickIndex;
  const clock0 = S.MarketStore.time();
  const closes0 = S.MarketStore.getHistory().series.ARA.closes.length;
  await move(3 * DAY);
  assert.equal(pub().tickIndex, tick + 3, 'three whole days are three day-sized ticks');
  assert.ok(Math.abs(S.MarketStore.time() - clock0 - 3) < 1e-6, 'the market clock moved on by three days');
  assert.equal(S.MarketStore.getHistory().series.ARA.closes.length, closes0 + 3, 'with a close for each');
  assert.equal(pub().lastDay, day());
  assert.equal(pub().lastMs, env.clock.ms);

  await move(2 * DAY + 25 * MIN);
  assert.equal(pub().tickIndex, tick + 3 + 2 + 2, 'two days and part of a third: two day ticks, then the intervals in the rest');
  assert.ok(Math.abs(S.MarketStore.time() - clock0 - (5 + 2 * 10 / 1440)) < 1e-6);
});

test('the Advance 1 day button runs a whole game day at once, in any mode', async () => {
  const tick = pub().tickIndex;
  const clock0 = S.MarketStore.time();
  await S.TickService.advanceDays(1);
  assert.equal(pub().tickIndex, tick + 1);
  assert.ok(Math.abs(S.MarketStore.time() - clock0 - 1) < 1e-6);
  await S.TickService.advanceDays(3);
  assert.ok(Math.abs(S.MarketStore.time() - clock0 - 4) < 1e-6);
});

test('a date rolled back also just changes the market date, and nothing is undone', async () => {
  const tick = pub().tickIndex;
  await move(-2 * DAY);
  assert.equal(pub().tickIndex, tick, 'no rollback and no tick');
  assert.equal(pub().lastDay, day());
  await move(10 * MIN);
  assert.equal(pub().tickIndex, tick + 1);
});

test('a clock turned back within the day restarts the timer without a tick', async () => {
  const tick = pub().tickIndex;
  await move(-40 * MIN);
  assert.equal(pub().tickIndex, tick);
  assert.equal(pub().lastMs, env.clock.ms);
  await move(9 * MIN);
  assert.equal(pub().tickIndex, tick);
  await move(1 * MIN);
  assert.equal(pub().tickIndex, tick + 1);
});

test('a long jump within the day ticks once for each interval, up to the cap', async () => {
  const tick = pub().tickIndex;
  const hoursLeft = 24 - new Date(env.clock.ms).getUTCHours();
  assert.ok(hoursLeft > 4, 'the test needs room before midnight');
  await move(3 * HOUR);
  assert.equal(pub().tickIndex, tick + 18, 'three hours is eighteen intervals');
  await move(4 * MIN);
  assert.equal(pub().tickIndex, tick + 18);
});

test('manual advance works alongside, and the manual mode ignores the clock', async () => {
  const tick = pub().tickIndex;
  await S.TickService.advance(2);
  assert.equal(pub().tickIndex, tick + 2);
  env.store.set('tickMode', 'manual');
  await move(5 * HOUR);
  assert.equal(pub().tickIndex, tick + 2);
  env.store.set('tickMode', 'realTime');
});

test('only the active GM ticks the market', async () => {
  game.users.activeGM = { id: 'someone-else' };
  const tick = pub().tickIndex;
  await move(30 * MIN);
  assert.equal(pub().tickIndex, tick);
  game.users.activeGM = { id: 'gm1' };
});

// ── The pure rule ─────────────────────────────────────────────────────────────

test('realTimeDue: every case', () => {
  const { realTimeDue } = S.engine;
  const base = Date.UTC(2045, 2, 15, 12);
  const day0 = S.engine.dayIndex(base);
  const o = { lastDay: day0, lastMs: base, intervalMs: 10 * MIN };
  const none = { dayTicks: 0, resync: false, skipped: 0 };
  assert.deepEqual(realTimeDue({ ...o, nowMs: base + 9 * MIN }), { ...none, ticks: 0, day: day0, ms: base });
  assert.deepEqual(realTimeDue({ ...o, nowMs: base + 25 * MIN }), { ...none, ticks: 2, day: day0, ms: base + 20 * MIN });
  assert.equal(realTimeDue({ ...o, lastDay: null, nowMs: base }).resync, true, 'no market date yet');
  assert.equal(realTimeDue({ ...o, lastMs: null, nowMs: base }).resync, true, 'a market from before this mode existed');
  assert.equal(realTimeDue({ ...o, nowMs: base - 13 * HOUR }).resync, true, 'the date changed backwards');
  assert.equal(realTimeDue({ ...o, nowMs: base - MIN }).resync, true, 'the clock went back');

  const next = realTimeDue({ ...o, nowMs: base + 13 * HOUR });
  assert.deepEqual([next.resync, next.ticks, next.day], [false, 60, day0 + 1], 'across midnight it is still just intervals');
  assert.equal(realTimeDue({ ...o, nowMs: base + 5 * HOUR }).ticks, 30);

  const jump = realTimeDue({ ...o, nowMs: base + 3 * DAY + 25 * MIN });
  assert.deepEqual([jump.dayTicks, jump.ticks, jump.skipped, jump.ms, jump.day], [3, 2, 0, base + 3 * DAY + 20 * MIN, day0 + 3], 'whole days first, then the rest in intervals');
  const huge = realTimeDue({ ...o, nowMs: base + 100 * DAY + 5 * MIN });
  assert.deepEqual([huge.dayTicks, huge.skipped, huge.ms], [60, 40, base + 100 * DAY + 5 * MIN], 'a long jump runs the cap, then restarts the timer');
  const capped = realTimeDue({ ...o, nowMs: base + 11 * HOUR, cap: 60 });
  assert.deepEqual([capped.ticks, capped.skipped, capped.ms], [60, 6, base + 11 * HOUR], 'a capped catch-up restarts the timer');
});
