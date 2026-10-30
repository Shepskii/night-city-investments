import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const DAY_MS = 86_400_000;
const env = installFakeFoundry({ actors: [] });
// 2046-12-17: a Monday in the real calendar, the calendar day the clock is on.
env.clock.ms = Date.UTC(2046, 11, 17, 12);
game.i18n = { localize: (k) => k, format: (k) => k };

const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/**
 * A Simple Calendar whose weekdays run `shift` days ahead of the real calendar's, or (`restart`) one
 * that starts every year on its first weekday, as a world's calendar can, so its weeks break at New Year.
 */
function simpleCalendar(shift, names = NAMES, { restart = false } = {}) {
  // As in the test world: 2046 runs on (Monday 29 December), and 2047 starts again on its first weekday, a Monday.
  const first = { 2046: 2, 2047: 0 };
  const dow = (d) => (restart
    ? (Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS) + (first[d.getUTCFullYear()] ?? 0)) % 7
    : (d.getUTCDay() + shift) % 7);
  globalThis.SimpleCalendar = {
    api: {
      timestamp: () => env.clock.ms / 1000,
      timestampToDate: (ts) => {
        const d = new Date(ts * 1000);
        return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() - 1, dayOfTheWeek: dow(d) };
      },
      dateToTimestamp: ({ year, month, day, hour = 0 }) => Date.UTC(year, month, day + 1, hour) / 1000,
      getAllWeekdays: () => names.map((name) => ({ name })),
    },
  };
}
after(() => delete globalThis.SimpleCalendar);

const { MarketClock } = await import('../scripts/services/MarketClockService.js');
const { BusinessService } = await import('../scripts/services/BusinessService.js');
const { nextBoundary, weekdayOf } = await import('../scripts/engine/index.js');
const today = Math.floor(env.clock.ms / DAY_MS);

test("weekdays follow Simple Calendar's, where its week is shifted from the real calendar's", () => {
  assert.equal(weekdayOf(today), 1, 'a Monday in the real calendar');
  simpleCalendar(2);
  assert.equal(MarketClock.weekdayOffset(), 2);
  assert.equal(MarketClock.weekdayName(today), 'Wednesday', "Simple Calendar's own weekday");
  // A business week set to close on Monday closes on the calendar's Monday.
  env.store.set('businessWeekday', 1);
  const end = nextBoundary(today, BusinessService.weekday());
  assert.equal(MarketClock.weekdayName(end), 'Monday');
  assert.equal(end - today, 5, 'Wednesday to the next Monday');
});

test('no shift without Simple Calendar, with a week that is not 7 days, or with a clock off its date', () => {
  delete globalThis.SimpleCalendar;
  assert.equal(MarketClock.weekdayOffset(), 0);
  assert.equal(MarketClock.weekdayName(today), 'NCI.Weekday.1');
  simpleCalendar(2, ['One', 'Two', 'Three', 'Four', 'Five']);
  assert.equal(MarketClock.weekdayOffset(), 0);
  simpleCalendar(2);
  const ms = env.clock.ms;
  globalThis.SimpleCalendar.api.timestamp = () => (ms + 3 * DAY_MS) / 1000;
  assert.equal(MarketClock.weekdayOffset(), 0, 'the clock is not on the calendar date');
});

test("a calendar whose weekdays restart at New Year: each week still closes on the calendar's closing day", () => {
  // Weekdays restarting at New Year, as this world's calendar does.
  const MON_FIRST = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  simpleCalendar(0, MON_FIRST, { restart: true });
  env.store.set('businessWeekday', 0);
  const closes = BusinessService.weekday();
  const day = (y, m, d) => Math.floor(Date.UTC(y, m, d) / DAY_MS);
  // 29 December 2046 is a calendar Monday; the calendar starts 2047 on a Monday too, three days later.
  assert.equal(MarketClock.weekdayName(day(2046, 11, 29)), 'Monday');
  assert.equal(MarketClock.weekdayName(day(2047, 0, 1)), 'Monday');
  assert.equal(MarketClock.weekdayName(day(2046, 11, 31)), 'Wednesday');
  assert.equal(nextBoundary(day(2046, 11, 29), closes), day(2047, 0, 1), 'a short week, closing on the first Monday of the new year');
  assert.equal(nextBoundary(day(2047, 0, 1), closes), day(2047, 0, 8), 'then full weeks again');
  assert.equal(MarketClock.weekdayName(day(2047, 0, 5)), 'Friday');
});
