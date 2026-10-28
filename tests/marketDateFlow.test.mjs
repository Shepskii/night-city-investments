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

test('a hand advance moves the market date on, and it stays ahead as the calendar moves', async () => {
  await TickService.advanceDays(2);
  assert.equal(today(), '2045-03-20');
  assert.equal(MarketClock.dateString(MarketClock.calendarMs()), '2045-03-18', 'the calendar has not moved');

  env.clock.ms += DAY;
  await TickService.checkClock();
  assert.equal(today(), '2045-03-21', 'the calendar day is added on top of the lead');
});

test('undoing a hand-advanced tick takes the date back with it', async () => {
  await TickService.advanceDays(1);
  assert.equal(today(), '2045-03-22');
  assert.equal((await TickService.undoLastTick(() => false)).ok, true);
  assert.equal(today(), '2045-03-21');
});

test('in manual mode only the market moves its date', async () => {
  env.store.set('tickMode', 'manual');
  env.clock.ms += 5 * DAY;
  await TickService.checkClock();
  assert.equal(today(), '2045-03-21', 'moving the calendar does nothing');
  await TickService.advance(10);
  assert.equal(today(), '2045-03-31', 'ten day ticks are ten days');
});
