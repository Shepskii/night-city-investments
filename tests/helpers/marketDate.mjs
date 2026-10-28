/**
 * The market keeps its own date (see `marketDay` in engine/clock.js), so tests move it with the
 * market rather than with the calendar.
 */

const DAY = 86_400_000;

/** Days from the market's date to a calendar date (month 1-12). */
export async function daysUntil(year, month, day) {
  const { MarketClock } = await import('../../scripts/services/MarketClockService.js');
  const now = MarketClock.date();
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.year, now.month - 1, now.day)) / DAY);
}

/** The first day of the quarter after the market's date, as [year, month, day]. */
export async function nextQuarter() {
  const { MarketClock } = await import('../../scripts/services/MarketClockService.js');
  const { year, month } = MarketClock.date();
  const start = Math.floor((month - 1) / 3) * 3 + 4;
  return start > 12 ? [year + 1, 1, 1] : [year, start, 1];
}

/** "2045-Q3" for a [year, month, day]. */
export const quarterKey = ([year, month]) => `${year}-Q${Math.floor((month - 1) / 3) + 1}`;

/** The market's date `days` from now, as "YYYY-MM-DD". */
export async function marketDateIn(days) {
  const { MarketClock } = await import('../../scripts/services/MarketClockService.js');
  return MarketClock.dateString(MarketClock.nowMs() + days * DAY);
}
