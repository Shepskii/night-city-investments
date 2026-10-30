/**
 * Market clock: the calendar, and the market's own date on it.
 * @file scripts/services/MarketClockService.js
 * @description The calendar comes from Night City Messenger's time provider, so the market and the
 *              messenger share one clock, falling back to Foundry world time if the provider is not
 *              ready. Only the tick service reads the calendar directly; everything else uses the
 *              market's date (`marketDay`), which runs ahead of the calendar by the days a GM has
 *              advanced the market by hand, and in manual mode moves only with the market.
 */

import { msToDate, dayIndex, marketDay, DAY_MS, weekdayOf } from '../engine/index.js';
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

  /**
   * How many days Simple Calendar's weekdays run ahead of the real calendar's. The calendar's dates
   * become real dates (Night City Messenger's clock), but a Simple Calendar world can set its own
   * weekdays: there, 2046-12-17 may be a Wednesday though it was a Monday in the real calendar. 0 with
   * no Simple Calendar, a week that is not 7 days, or a clock that is not on Simple Calendar's date.
   */
  weekdayOffset() {
    try {
      const sc = globalThis.SimpleCalendar?.api;
      if (!sc?.timestampToDate || !sc.timestamp) return 0;
      if ((sc.getAllWeekdays?.() ?? []).length !== 7) return 0;
      const today = sc.timestampToDate(sc.timestamp());
      if (!Number.isInteger(today?.dayOfTheWeek)) return 0;
      // Simple Calendar's month and day are indices.
      const day = dayIndex(Date.UTC(today.year, today.month, today.day + 1));
      if (day !== dayIndex(this.calendarMs())) return 0;
      return (((today.dayOfTheWeek - weekdayOf(day)) % 7) + 7) % 7;
    } catch {
      return 0;
    }
  },

  /**
   * A day's weekday on the world's calendar: Simple Calendar's own for that date (an index into its
   * weekdays), asked date by date, since its weeks need not run on unbroken from year to year; or the
   * real calendar's, 0 = Sunday, shifted as Simple Calendar's are today when it cannot say.
   */
  weekdayOf(day) {
    const offset = this.weekdayOffset();
    try {
      const sc = globalThis.SimpleCalendar?.api;
      if (sc?.dateToTimestamp && this._onCalendar()) {
        const d = new Date(day * DAY_MS);
        const date = sc.timestampToDate(sc.dateToTimestamp({ year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() - 1, hour: 12, minute: 0, second: 0 }));
        if (Number.isInteger(date?.dayOfTheWeek)) return date.dayOfTheWeek;
      }
    } catch {
      // The real calendar's, shifted.
    }
    return (weekdayOf(day) + offset) % 7;
  },

  /** Whether Simple Calendar keeps 7-day weeks and the clock is on its date (no shift needed today). */
  _onCalendar() {
    try {
      const sc = globalThis.SimpleCalendar.api;
      if ((sc.getAllWeekdays?.() ?? []).length !== 7) return false;
      const today = sc.timestampToDate(sc.timestamp());
      return dayIndex(Date.UTC(today.year, today.month, today.day + 1)) === dayIndex(this.calendarMs());
    } catch {
      return false;
    }
  },

  /** A day's weekday by name: Simple Calendar's own name where it has one. */
  weekdayName(day) {
    const index = this.weekdayOf(day);
    try {
      const name = globalThis.SimpleCalendar?.api?.getAllWeekdays?.()?.[index]?.name;
      if (name) return name;
    } catch {
      // The module's own names.
    }
    return game.i18n.localize(`NCI.Weekday.${index}`);
  },

  /** e.g. "2045-03-09" */
  dateString(ms = this.nowMs()) {
    const { year, month, day } = msToDate(ms);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },
};
