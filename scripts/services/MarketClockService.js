/**
 * Market clock: in-world time for ticking.
 * @file scripts/services/MarketClockService.js
 * @description Uses Night City Messenger's time provider so the market and the messenger share one
 *              clock. Falls back to Foundry world time if the provider is not ready.
 */

import { msToDate } from '../engine/index.js';

export const MarketClock = {
  nowMs() {
    try {
      const ms = game.modules.get('night-city-messenger')?.api?.time?.getCurrentTimeMs?.();
      if (Number.isFinite(ms)) return ms;
    } catch {
      // Fall through to world time.
    }
    return Math.floor(game.time.worldTime * 1000);
  },

  /** Current in-world calendar date. */
  date() {
    return msToDate(this.nowMs());
  },

  /** e.g. "2045-03-09" */
  dateString(ms = this.nowMs()) {
    const { year, month, day } = msToDate(ms);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },
};
