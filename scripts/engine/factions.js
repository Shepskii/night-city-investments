/**
 * Factions and standing (F1a)
 * @file scripts/engine/factions.js
 * @description Corporations and gangs a business can stand well or badly with. Standing runs from -100
 *              to 100, belongs to each business, drifts back toward 0 a little each week, and moves at
 *              most so far in a week; repeated favours count for less. The number stays in the GM's
 *              hidden state: a business's record keeps only the band, and only for factions it has met.
 *              Pure.
 */

import { BUSINESS_DEFAULTS, DISTRICTS } from './businessConfig.js';
import { normalizeName } from './gigImpact.js';

export const FACTION_KINDS = Object.freeze(['corp', 'gang', 'other']);

const text = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** A faction as stored: its id comes from the GM's list, and districts must be real ones. */
export function normalizeFaction(input = {}) {
  return {
    id: text(input.id, 40),
    name: text(input.name, 60),
    kind: FACTION_KINDS.includes(input.kind) ? input.kind : 'other',
    ticker: text(input.ticker, 5).toUpperCase(),
    districts: [...new Set((Array.isArray(input.districts) ? input.districts : []).map((d) => text(d, 20)).filter((d) => DISTRICTS[d]))],
    aliases: (Array.isArray(input.aliases) ? input.aliases : []).map((a) => text(a, 60)).filter(Boolean),
  };
}

/** The band players see for a standing. */
export function standingBand(value, p = BUSINESS_DEFAULTS) {
  return p.standing.bands.find(([below]) => (Number(value) || 0) < below)[1];
}

/** The faction a gig's client names: by name, alias or ticker. */
export function matchFaction(client, factions) {
  const wanted = normalizeName(client);
  if (!wanted) return null;
  return factions.find((f) => [f.name, f.ticker, ...(f.aliases ?? [])].some((n) => n && normalizeName(n) === wanted)) ?? null;
}

/** The gangs whose turf this district is. */
export const turfFactions = (factions, district) => (district ? factions.filter((f) => f.districts?.includes(district)) : []);

/** How far a gig for a faction would move a business's standing with it, before the limits. */
export function gigStanding({ outcome, reward }, p = BUSINESS_DEFAULTS) {
  const g = p.standing.gig;
  const size = Math.min(g.size[1], Math.max(g.size[0], (Number(reward) || 0) / g.reward));
  return Math.round((outcome === 'failed' ? g.failed : g.done) * size * 10) / 10;
}

/**
 * Move a standing. Recent favours make this one count for less, and it moves at most `weeklyCap` in any
 * seven days, either way.
 * @param {object|null} entry - `{value, weekStart, moved, recent: number[]}`, or null for a first dealing
 * @returns {{entry: object, applied: number}}
 */
export function moveStanding(entry, amount, day, p = BUSINESS_DEFAULTS) {
  const s = p.standing;
  const now = entry ?? { value: 0, weekStart: day, moved: 0, recent: [] };
  const recent = (now.recent ?? []).filter((d) => day - d < s.gig.windowDays);
  const fresh = day - (now.weekStart ?? day) >= 7;
  const moved = fresh ? 0 : Number(now.moved) || 0;
  const scaled = Number(amount) / (1 + recent.length);
  const room = Math.max(0, s.weeklyCap - Math.abs(moved));
  const applied = Math.round(Math.max(-room, Math.min(room, scaled)) * 10) / 10;
  return {
    applied,
    entry: {
      value: Math.max(-100, Math.min(100, Math.round(((Number(now.value) || 0) + applied) * 10) / 10)),
      weekStart: fresh ? day : now.weekStart ?? day,
      moved: Math.round((moved + applied) * 10) / 10,
      recent: [...recent, day],
    },
  };
}

/** A week's fade toward 0. */
export function driftStanding(entry, p = BUSINESS_DEFAULTS) {
  const value = Number(entry?.value) || 0;
  const d = p.standing.drift;
  return { ...entry, value: Math.abs(value) <= d ? 0 : Math.round((value - Math.sign(value) * d) * 10) / 10 };
}

/** What a business's record shows for its hidden standings: each met faction's band. */
export const standingBands = (entries = {}, p = BUSINESS_DEFAULTS) => Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, standingBand(e.value, p)]));
