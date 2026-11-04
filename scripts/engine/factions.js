/**
 * Factions and standing (F1a)
 * @file scripts/engine/factions.js
 * @description Corporations and gangs a business can stand well or badly with. Standing runs from -100
 *              to 100, belongs to each business, drifts back toward 0 a little each week, and moves at
 *              most so far in a week; repeated favours count for less. The number stays in the GM's
 *              hidden state: a business's record keeps only the band, and only for factions it has met.
 *              Actions aimed at a faction, and what standing does to costs and trouble, are F1b. Pure.
 */

import { BUSINESS_DEFAULTS, DISTRICTS } from './businessConfig.js';
import { normalizeName, gigTags } from './gigImpact.js';
import { fail } from './businessRecord.js';

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
 * @param {{steady?: boolean}} [o] - `steady`: an ongoing tie, such as a connected back room's week, which counts in full and is not a recent dealing
 * @returns {{entry: object, applied: number}}
 */
export function moveStanding(entry, amount, day, p = BUSINESS_DEFAULTS, { steady = false } = {}) {
  const s = p.standing;
  const now = entry ?? { value: 0, weekStart: day, moved: 0, recent: [] };
  const recent = (now.recent ?? []).filter((d) => day - d < s.gig.windowDays);
  const fresh = day - (now.weekStart ?? day) >= 7;
  const moved = fresh ? 0 : Number(now.moved) || 0;
  const scaled = steady ? Number(amount) : Number(amount) / (1 + recent.length);
  const room = Math.max(0, s.weeklyCap - Math.abs(moved));
  const applied = Math.round(Math.max(-room, Math.min(room, scaled)) * 10) / 10;
  return {
    applied,
    entry: {
      value: Math.max(-100, Math.min(100, Math.round(((Number(now.value) || 0) + applied) * 10) / 10)),
      weekStart: fresh ? day : now.weekStart ?? day,
      moved: Math.round((moved + applied) * 10) / 10,
      recent: steady ? recent : [...recent, day],
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
  const tags = gigTags(notes);
  const tag = tags.target;
  const own = matchFaction(tags.client || client, factions);
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

/** The gift an aimed action costs a business at its stage (F1b). */
export function giftFor(b, p = BUSINESS_DEFAULTS) {
  const gifts = p.standing.gift;
  return gifts[Math.min(b.stage ?? 0, gifts.length - 1)];
}

/** Whether this action may be aimed at this faction now, and the gift it costs. */
export function aimCheck(b, action, factionId, factions, p = BUSINESS_DEFAULTS) {
  const aim = p.standing.aims[action];
  const faction = factions.find((f) => f.id === factionId);
  if (!aim || !faction || !aim.kinds.includes(faction.kind)) return fail('bad-faction');
  const gift = giftFor(b, p);
  return b.till < gift ? fail('no-gift') : { ok: true, faction, gift };
}

/** A hostile faction's chance of acting this week, from its standing. */
export function hostileChance(value, p = BUSINESS_DEFAULTS) {
  const [low, high] = p.standing.hostile.chance;
  const edge = Math.abs(p.standing.bands[0][0]);
  return low + (high - low) * Math.max(0, Math.min(1, (Math.abs(Number(value) || 0) - edge) / (100 - edge)));
}

/**
 * What a business's standing does to it. Costs come from the bands on its record, so a player's window can
 * show them; the factions that may act against it come from the hidden numbers, which only the GM has.
 * @param {object} b - the business
 * @param {object[]} factions - the list, a corporation with its company's `sector`
 * @param {object|null} values - the hidden standing, `{factionId: {value}}`
 * @returns {{cost: number, protection: number, shakedown: number, gangs: object[], hostile: object[]}} multipliers,
 *          the gangs on its turf, and the hostile factions, the worst first
 */
export function factionEffects(b, factions = [], values = null, p = BUSINESS_DEFAULTS) {
  const sum = (list, table) => {
    const total = list.reduce((a, f) => a + (table[b.standings?.[f.id] ?? 'neutral'] ?? 0), 0);
    return Math.max(-table.cap, Math.min(table.cap, total));
  };
  const sector = b.company?.sector ?? p.charter.sectors[b.archetype];
  const turf = turfFactions(factions, b.district);
  // A gang with a deal on the back room charges no protection and sends no shakedowns (U1c).
  const dealId = b.backRoom?.deal?.factionId;
  const gangs = turf.filter((f) => f.id !== dealId);
  const share = turf.length ? gangs.length / turf.length : 1;
  const protection = (1 + sum(gangs, p.standing.effects.protection)) * share;
  return {
    cost: 1 + sum(factions.filter((f) => f.kind === 'corp' && f.sector === sector), p.standing.effects.cost),
    protection,
    shakedown: protection,
    gangs: gangs.map((f) => ({ id: f.id, name: f.name })),
    hostile: values
      ? factions.filter((f) => standingBand(values[f.id]?.value, p) === 'hostile')
        .map((f) => ({ id: f.id, name: f.name, kind: f.kind, value: values[f.id].value })).sort((x, y) => x.value - y.value)
      : [],
  };
}
