/**
 * Market clock: the calendar, and the market's own date on it.
 * @file scripts/services/MarketClockService.js
 * @description The calendar comes from Night City Messenger's time provider, so the market and the
 *              messenger share one clock, falling back to Foundry world time if the provider is not
 *              ready. Only the tick service reads the calendar directly; everything else uses the
 *              market's date (`marketDay`), which runs ahead of the calendar by the days a GM has
 *              advanced the market by hand, and in manual mode moves only with the market.
 */

import { msToDate, dayIndex, marketDay, DAY_MS } from '../engine/index.js';
import { MarketStore } from '../data/MarketStore.js';

export const MarketClock = {
  /** The in-world calendar, in milliseconds. */
  calendarMs() {
    try {
      const ms = game.modules.get('night-city-messenger')?.api?.time?.getCurrentTimeMs?.();
      if (Number.isFinite(ms)) return ms;
    } catch {
      // Fall through to world time.
    }
    return Math.floor(game.time.worldTime * 1000);
  },

  /** The market's now: the calendar's time of day on the market's date. */
  nowMs() {
    const calendar = this.calendarMs();
    const pub = MarketStore.getPublic();
    if (!pub.schema) return calendar;
    return calendar + (marketDay(pub, dayIndex(calendar)) - dayIndex(calendar)) * DAY_MS;
  },

  /** The market's date. */
  date() {
    return msToDate(this.nowMs());
  },

  /** e.g. "2045-03-09" */
  dateString(ms = this.nowMs()) {
    const { year, month, day } = msToDate(ms);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },
};
