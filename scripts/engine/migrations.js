/**
 * Data migrations
 * @file scripts/engine/migrations.js
 * @description An ordered list of steps that bring stored data up to the current schema, and a runner
 *              that applies the ones a world has not had yet. Pure: everything it touches comes in
 *              through `ctx`, so it is tested without Foundry.
 *
 *   ctx.portfolios()          -> [{ id, name, data }]   every stored portfolio
 *   ctx.savePortfolio(id, d)
 *   ctx.stores()              -> { controls, gigs, heat }  raw stored values (null when absent)
 *   ctx.saveStore(name, d)
 *   ctx.saveVersion(n)        called after each step, so a failure part-way keeps the progress made
 */

import { normalizePortfolio } from './portfolioModel.js';
import { normalizeControls } from './marketControls.js';
import { normalizeGigs } from './gigImpact.js';
import { normalizeHeat } from './heat.js';

/** Structural equality for plain JSON data, ignoring key order. */
export function sameData(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameData(a[k], b[k]));
}

const STORE_NORMALIZERS = { controls: normalizeControls, gigs: normalizeGigs, heat: normalizeHeat };

/**
 * Version 2: write back every portfolio and GM store with the fields added since the first
 * release (settling sales, alerts, heat and so on), so nothing depends on a read-time default.
 */
async function normalizeStoredData(ctx) {
  let portfolios = 0;
  for (const { id, data } of await ctx.portfolios()) {
    const next = normalizePortfolio(data);
    if (sameData(next, data)) continue;
    await ctx.savePortfolio(id, next);
    portfolios++;
  }

  let stores = 0;
  const raw = (await ctx.stores()) ?? {};
  for (const [name, normalize] of Object.entries(STORE_NORMALIZERS)) {
    if (!raw[name]) continue;
    const next = normalize(raw[name]);
    if (sameData(next, raw[name])) continue;
    await ctx.saveStore(name, next);
    stores++;
  }
  return { portfolios, stores };
}

export const MIGRATIONS = Object.freeze([
  Object.freeze({ version: 2, id: 'normalize-stored-data', up: normalizeStoredData }),
]);

/** The schema version a world is on once every step has run. */
export const latestSchemaVersion = (steps = MIGRATIONS) => steps.reduce((m, s) => Math.max(m, s.version), 1);

/** Steps a world on `from` still has to run, oldest first. */
export const pendingMigrations = (from, steps = MIGRATIONS) => steps.filter((s) => s.version > from).sort((a, b) => a.version - b.version);

/**
 * Run every pending step. Stops at the first one that throws and reports it; steps that already
 * finished stay applied and recorded.
 * @returns {Promise<{ok: boolean, from: number, version: number, applied: object[], newer?: boolean, failed?: {version: number, id: string, error: string}}>}
 */
export async function runMigrations({ from, steps = MIGRATIONS, ctx }) {
  const start = Number.isFinite(Number(from)) && Number(from) >= 1 ? Math.floor(Number(from)) : 1;
  if (start > latestSchemaVersion(steps)) return { ok: true, from: start, version: start, applied: [], newer: true };

  const applied = [];
  let version = start;
  for (const step of pendingMigrations(start, steps)) {
    try {
      const result = (await step.up(ctx)) ?? {};
      version = step.version;
      applied.push({ version, id: step.id, ...result });
      await ctx.saveVersion?.(version);
    } catch (error) {
      return { ok: false, from: start, version, applied, failed: { version: step.version, id: step.id, error: String(error?.message ?? error) } };
    }
  }
  return { ok: true, from: start, version, applied };
}
