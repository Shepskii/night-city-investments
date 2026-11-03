import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const DAY = 86_400_000;
const env = installFakeFoundry();

let TickService, MarketStore, MarketClock;

before(async () => {
  ({ TickService } = await import('../scripts/services/TickService.js'));
  ({ MarketStore } = await import('../scripts/data/MarketStore.js'));
  ({ MarketClock } = await import('../scripts/services/MarketClockService.js'));
  const { ImportService } = await import('../scripts/services/ImportService.js');
  await ImportService.importStarter();
  await TickService.syncCompanies();
});

const today = () => MarketClock.dateString();

test('following the calendar, the market date is the calendar date', async () => {
  assert.equal(today(), '2045-03-15');
  env.clock.ms += 3 * DAY;
  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, 3, 'a tick for each day');
  assert.equal(today(), '2045-03-18');
  assert.equal(MarketStore.getPublic().lead, 0);
});

const calendar = () => MarketClock.dateString(MarketClock.calendarMs());

test('a hand advance moves the calendar with the market, with no ticks twice over', async () => {
  const ticks = MarketStore.getPublic().tickIndex;
  await TickService.advanceDays(2);
  assert.equal(today(), '2045-03-20');
  assert.equal(calendar(), '2045-03-20', 'the calendar came too');
  assert.equal(MarketStore.getPublic().lead, 0);
  assert.equal(MarketStore.getPublic().tickIndex, ticks + 2);
  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, ticks + 2, 'the calendar\'s move sets off no catching up');
  assert.equal(today(), '2045-03-20');

  env.clock.ms += DAY;
  await TickService.checkClock();
  assert.equal(today(), '2045-03-21', 'and they go on together');
  assert.equal(calendar(), '2045-03-21');
});

test('a gap from an earlier version: Advance leaves it, and the button closes it, moving only the calendar', async () => {
  const pub = MarketStore.getPublic();
  await MarketStore.setPublic({ ...pub, lead: 8 });
  assert.equal(today(), '2045-03-29');
  await TickService.advanceDays(1);
  assert.equal(today(), '2045-03-30');
  assert.equal(calendar(), '2045-03-22', 'one day, not the whole gap in one jump');
  assert.equal(MarketStore.getPublic().lead, 8);

  const ticks = MarketStore.getPublic().tickIndex;
  assert.ok((await TickService.alignCalendar()).ok);
  assert.equal(calendar(), '2045-03-30');
  assert.equal(today(), '2045-03-30', 'the market date has not moved');
  assert.equal(MarketStore.getPublic().lead, 0);
  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, ticks, 'no ticks for the days the calendar moved');
  assert.ok((await TickService.alignCalendar()).ok, 'with no gap, nothing to do');
  assert.equal(calendar(), '2045-03-30');
});

test('if the calendar cannot move, nothing changes', async () => {
  const pub = MarketStore.getPublic();
  await MarketStore.setPublic({ ...pub, lead: 3 });
  const advance = game.time.advance;
  game.time.advance = async () => { throw new Error('refused'); };
  await TickService.alignCalendar().catch(() => null);
  game.time.advance = advance;
  assert.equal(MarketStore.getPublic().lead, 3);
  assert.equal(MarketStore.getPublic().lastDay, pub.lastDay);
  await MarketStore.setPublic({ ...MarketStore.getPublic(), lead: 0 });
});

test('undoing a hand-advanced tick leaves the date and the calendar together', async () => {
  const ticks = MarketStore.getPublic().tickIndex;
  await TickService.advanceDays(1);
  assert.equal(today(), '2045-03-31');
  assert.equal((await TickService.undoLastTick(() => false)).ok, true);
  assert.equal(MarketStore.getPublic().tickIndex, ticks);
  assert.equal(today(), calendar(), 'the clock is left alone, as an undo always leaves it');
});

test('in manual mode only the market moves its date', async () => {
  env.store.set('tickMode', 'manual');
  env.clock.ms += 5 * DAY;
  await TickService.checkClock();
  assert.equal(today(), '2045-03-31', 'moving the calendar does nothing');
  const before = calendar();
  await TickService.advance(10);
  assert.equal(today(), '2045-04-10', 'ten day ticks are ten days');
  assert.equal(calendar(), before, 'and manual mode leaves the calendar alone');
});
