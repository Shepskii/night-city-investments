/**
 * Market clock helpers
 * @file scripts/engine/clock.js
 * @description Converts in-world time into market ticks (one per in-world day). Pure; no Foundry globals.
 */

export const DAY_MS = 86_400_000;
export const MAX_CATCHUP_TICKS = 60;

/**
 * The market's own clock, in game days (a float). Everything that happens over time (a gig's delay,
 * a sentiment bias, a heat window, a broker's speed, an order's expiry) is measured on it, so it
 * means the same whatever the tick interval is. A tick moves it on by `dt` days: 1 in the day and
 * manual modes, or the tick interval as a fraction of a day in the in-world clock mode.
 */
export const TIME_EPS = 1e-6;

/** Whole game days elapsed at `time`, forgiving the rounding in a sum of many small steps. */
export const dayOf = (time) => Math.floor(time + TIME_EPS);

/** `time` plus `dt` days, snapped so that a day's worth of small steps lands on the whole number. */
export const addTime = (time, dt) => Math.round((time + dt) * 1e9) / 1e9;

/** Days per tick for an interval in minutes of in-world clock time. */
export const minutesToDays = (minutes) => minutes / 1440;

/** Whole days since the epoch for a timestamp in milliseconds. */
export const dayIndex = (ms) => Math.floor(ms / DAY_MS);

/** Calendar date (UTC) for a timestamp in milliseconds; month is 1-12. */
export function msToDate(ms) {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Real-time mode: ticks owed on the in-world clock (the Simple Calendar clock, so 24 hours of 60
 * minutes), one for every `intervalMs` since the last tick. A jump forward catches up: every whole
 * day in it is run as a day-sized tick, and what is left as ordinary interval ticks, so a week
 * skipped on the calendar is a week of game time and events that fell due in it happen. Going back,
 * in time or in date, only makes the market take the new date and restart its timer, with no tick
 * and no undo. The market date (`day`) follows the calendar either way.
 * @param {{lastDay: number|null, lastMs: number|null, nowMs: number, intervalMs: number, cap?: number}} o
 * @returns {{dayTicks: number, ticks: number, day: number, ms: number, resync: boolean, skipped: number}}
 *          `ms` is the time to record as the last tick (it keeps the part-interval left over);
 *          `skipped` counts what the cap left unsimulated, after which the timer restarts
 */
export function realTimeDue({ lastDay, lastMs, nowMs, intervalMs, cap = MAX_CATCHUP_TICKS }) {
  const day = dayIndex(nowMs);
  if (lastDay === null || lastDay === undefined || lastMs === null || lastMs === undefined || nowMs < lastMs) {
    return { dayTicks: 0, ticks: 0, day, ms: nowMs, resync: true, skipped: 0 };
  }
  const elapsed = nowMs - lastMs;
  const wholeDays = Math.floor(elapsed / DAY_MS);
  const owed = Math.floor((elapsed - wholeDays * DAY_MS) / intervalMs);
  const dayTicks = Math.min(wholeDays, cap);
  const ticks = Math.min(owed, cap);
  const skipped = (wholeDays - dayTicks) + (owed - ticks);
  return { dayTicks, ticks, day, ms: skipped ? nowMs : lastMs + wholeDays * DAY_MS + owed * intervalMs, resync: false, skipped };
}

/**
 * How many ticks are owed since the last one.
 * - First run: baseline to today without ticking.
 * - Time moved backwards (`ahead` > 0): no ticks. The market is that many days ahead of the
 *   calendar, and stays put until the calendar catches up with it.
 * - A long gap: tick at most `cap` times; the rest are skipped, not simulated.
 * @param {{lastDay: number|null, nowMs: number, cap?: number}} o
 * @returns {{ticks: number, day: number, rebaseline: boolean, skipped: number, ahead: number}}
 */
export function ticksDue({ lastDay, nowMs, cap = MAX_CATCHUP_TICKS }) {
  const day = dayIndex(nowMs);
  if (lastDay === null || lastDay === undefined) {
    return { ticks: 0, day, rebaseline: true, skipped: 0, ahead: 0 };
  }
  if (day < lastDay) return { ticks: 0, day, rebaseline: false, skipped: 0, ahead: lastDay - day };
  const delta = day - lastDay;
  const ticks = Math.min(delta, cap);
  return { ticks, day, rebaseline: false, skipped: delta - ticks, ahead: 0 };
}
