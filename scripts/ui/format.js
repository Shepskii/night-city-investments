/**
 * Shared display formatting for windows.
 * @file scripts/ui/format.js
 */

export { L } from '../utils/helpers.js';

export const money = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const whole = (n) => Math.round(n).toLocaleString();

/** Signed whole eb, e.g. "+1,200" or "-350". */
export const signed = (n) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString()}`;

export const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;

export const trendClass = (x) => (x > 0 ? 'nci-up' : x < 0 ? 'nci-down' : 'nci-flat');

/** Whole game days from `now` to `end` (both market-clock times), counting a part-day as a day. */
export const daysLeft = (end, now) => Math.max(0, Math.ceil(end - now - 1e-6));

/** The same, counting today as one: 3 when `end` is two whole days away. */
export const daysInclusive = (end, now) => Math.floor(end - now + 1e-6) + 1;

/** A market-clock time as a whole game day number. */
export const dayNumber = (time) => Math.floor(time + 1e-6);
