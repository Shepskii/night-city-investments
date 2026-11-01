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

const TARGET_TAG = /\[\s*(?:nci|invest|stock)\s+target\s*[:=]\s*([^\]]+?)\s*\]/i;

const hasWords = (text, name) => {
  const n = normalizeName(name);
  return n.length >= 5 && ` ${text} `.includes(` ${n} `);
};

/**
 * Who a gig is aimed at. Gigs report no target of their own, so it is the GM's tag in the notes
 * (`[NCI target: Militech]`, a faction or a market company), or failing that the one faction named in
 * its title or description. One found only in the text is `how: 'text'`, and waits for the GM to confirm.
 * @returns {{name: string, factionId: string|null, ticker: string, how: 'tag'|'text'}|null}
 */
export function findTarget({ client, title, desc, notes }, factions, companies = []) {
  const tag = TARGET_TAG.exec(String(notes ?? ''))?.[1];
  const own = matchFaction(client, factions);
  if (tag) {
    const faction = matchFaction(tag, factions);
    if (faction) return faction.id === own?.id ? null : { name: faction.name, factionId: faction.id, ticker: faction.ticker, how: 'tag' };
    const wanted = normalizeName(tag);
    const company = companies.find((c) => normalizeName(c.name) === wanted || normalizeName(c.ticker) === wanted);
    return company ? { name: company.name, factionId: null, ticker: company.ticker, how: 'tag' } : null;
  }
  const text = normalizeName([title, desc].filter(Boolean).join(' '));
  if (!text) return null;
  const named = factions.filter((f) => f.id !== own?.id && [f.name, ...(f.aliases ?? [])].some((n) => hasWords(text, n)));
  return named.length === 1 ? { name: named[0].name, factionId: named[0].id, ticker: named[0].ticker, how: 'text' } : null;
}

/** How much of a client's move its target moves the other way, by the gig's outcome. */
export const targetShare = (outcome, p = BUSINESS_DEFAULTS) => p.standing.target[outcome === 'failed' ? 'failed' : 'done'];
