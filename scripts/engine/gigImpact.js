/**
 * Gig outcomes as market impacts
 * @file scripts/engine/gigImpact.js
 * @description Pure logic for the Night City Map bridge: work out which company a gig's client is,
 *              how big the market reaction is and when it shows, and keep the approval queue and the
 *              client mappings. No Foundry globals.
 */

import { hashSeed, mulberry32 } from './rng.js';
import { gigImpactAmount, saturate } from './impactKernel.js';

export const GIG_SCHEMA = 1;
export const GIG_OUTCOMES = ['done', 'failed'];
export const GIG_HISTORY_CAP = 100;
export const GIG_PENDING_CAP = 60;
export const GIG_HEADLINE_VARIANTS = 8;
/** How many wordings each part of the standard (broker-less) rumour mail has in lang/en.json under NCI.Mail.Tip. */
export const GIG_TIP_VARIANTS = Object.freeze({ Subject: 4, Up: 8, Down: 8, Hedge: 6 });

export const GIG_TUNING = Object.freeze({
  refReward: 1000,
  k: 0.03,
  floor: 0.005,
  cap: 0.08,
  failWeight: 1.3,
  /** Ticks over which earlier gig impacts on the same company use up its room. */
  saturationTicks: 7,
  softCap: 0.1,
  /** Even a saturated company keeps this share of the impact. */
  minRoom: 0.2,
  /** Never larger than this after the GM's scale (log-return, about 12%). */
  hardCap: 0.12,
  delay: { min: 1, max: 3 },
  /** A bigger move is a bigger story, so it also sticks for longer. */
  shape: {
    done: { permanent: 0.35, tauDown: 12 },
    failed: { permanent: 0.5, tauDown: 14 },
  },
  strongPct: 3,
});

export const GIG_SCALE_RANGE = { min: 0.25, max: 3 };
export const MAX_GIG_PERCENT = 30;
export const MAX_GIG_DELAY = 30;

export const emptyGigs = () => ({ schema: GIG_SCHEMA, pending: [], history: [], mappings: {} });

export function normalizeGigs(g) {
  const base = emptyGigs();
  if (!g) return base;
  return {
    ...base,
    ...g,
    pending: Array.isArray(g.pending) ? g.pending : [],
    history: Array.isArray(g.history) ? g.history : [],
    mappings: g.mappings && typeof g.mappings === 'object' ? g.mappings : {},
  };
}

// ── Names ────────────────────────────────────────────────────────────────────

/** Lower case, no accents or punctuation, single spaces. "Arasaka Corp." becomes "arasaka corp". */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const SUFFIXES = new Set(['corp', 'corporation', 'inc', 'incorporated', 'ltd', 'llc', 'co', 'company', 'group', 'international', 'industries', 'holdings', 'plc', 'gmbh', 'the']);

/** The name without legal suffixes, so "Trauma Team International" and "Trauma Team" agree. */
export function coreName(value) {
  const tokens = normalizeName(value).split(' ').filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  while (tokens.length > 1 && SUFFIXES.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** 1 for identical strings, 0 for nothing in common. */
export function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - levenshtein(a, b) / longest : 1;
}

/** Whole-word phrase test on already normalised text. */
const hasPhrase = (text, phrase) => !!phrase && ` ${text} `.includes(` ${phrase} `);

// ── Rewards ──────────────────────────────────────────────────────────────────

/**
 * The eb amount in a free-text reward such as "1,500 eb", "2k", "500 eb x team (hard)" or "5 000".
 * Takes the first figure it finds; 0 when there is none.
 */
export function parseReward(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const m = String(value ?? '').match(/(\d{1,3}(?:[ ,\u00a0\u202f]\d{3})+|\d+)(?:[.,](\d+))?(?:\s*(k|m|thousand|million)\b)?/i);
  if (!m) return 0;
  const whole = Number(m[1].replace(/[ ,\u00a0\u202f]/g, ''));
  const n = m[2] ? Number(`${whole}.${m[2]}`) : whole;
  const unit = (m[3] ?? '').toLowerCase();
  const mult = unit === 'k' || unit === 'thousand' ? 1000 : unit === 'm' || unit === 'million' ? 1_000_000 : 1;
  return Math.max(0, Math.round(n * mult));
}

// ── Resolving a client to a company ──────────────────────────────────────────

const TAG = /\[\s*(?:nci|invest|stock)\s*[:=]\s*([^\]\s]+)\s*\]/i;

/**
 * Names a company answers to: its name, ticker and aliases.
 * @param {object[]} companies
 */
export function clientIndex(companies) {
  const entries = [];
  for (const c of companies) {
    const add = (text, kind) => {
      const key = normalizeName(text);
      if (key) entries.push({ companyId: c.id, kind, key, core: coreName(text) });
    };
    add(c.name, 'name');
    add(c.ticker, 'ticker');
    for (const alias of c.aliases ?? []) add(alias, 'alias');
  }
  return entries;
}

const unique = (list) => [...new Set(list)];

/** Phrases to look for inside longer text. A one-word core such as "night" (from "Night Corp") is too common to use. */
const phrasesOf = (e) => (e.core !== e.key && e.core.includes(' ') ? [e.key, e.core] : [e.key]);
const appearsIn = (text, e) => phrasesOf(e).some((p) => p.length >= 4 && hasPhrase(text, p));

/**
 * Work out which company a gig is about.
 *
 * Order: a `[NCI: ARA]` tag in the notes, then the GM's saved mappings, then an exact name, ticker or
 * alias, then a name found inside the client text, then a near miss (a typo), and last a company
 * named in the gig's own text. Only the tag, a mapping and an exact or contained name are trusted
 * to apply on their own; the rest are marked `needsReview`.
 *
 * @param {{client?: string, notes?: string, text?: string}} gig
 * @param {object[]} companies
 * @param {Object<string, {companyId: string}>} [mappings] - keyed by `normalizeName(client)`
 * @returns {{status: 'matched'|'ignored'|'ambiguous'|'unmatched', companyId?: string, how?: string, needsReview?: boolean, candidates?: string[], clientKey: string}}
 */
export function resolveClient(gig, companies, mappings = {}) {
  const clientKey = normalizeName(gig.client);
  const byId = new Map(companies.map((c) => [c.id, c]));
  const index = clientIndex(companies);

  const tag = String(gig.notes ?? '').match(TAG)?.[1];
  if (tag) {
    if (/^(ignore|none|skip)$/i.test(tag)) return { status: 'ignored', how: 'tag', clientKey };
    const hit = companies.find((c) => c.id === tag || c.ticker.toLowerCase() === tag.toLowerCase());
    if (hit) return { status: 'matched', companyId: hit.id, how: 'tag', needsReview: false, clientKey };
  }

  if (clientKey) {
    const saved = mappings[clientKey];
    if (saved?.companyId === 'ignore') return { status: 'ignored', how: 'mapping', clientKey };
    if (saved && byId.has(saved.companyId)) return { status: 'matched', companyId: saved.companyId, how: 'mapping', needsReview: false, clientKey };

    const core = coreName(gig.client);
    const exact = unique(index.filter((e) => e.key === clientKey || e.core === core).map((e) => e.companyId));
    if (exact.length === 1) return { status: 'matched', companyId: exact[0], how: 'exact', needsReview: false, clientKey };
    if (exact.length > 1) return { status: 'ambiguous', candidates: exact, clientKey };

    // Tickers are left out here: three-letter codes turn up inside ordinary words and phrases.
    const named = index.filter((e) => e.kind !== 'ticker');
    const inside = unique(named.filter((e) => appearsIn(clientKey, e)).map((e) => e.companyId));
    if (inside.length === 1) return { status: 'matched', companyId: inside[0], how: 'contains', needsReview: false, clientKey };
    if (inside.length > 1) return { status: 'ambiguous', candidates: inside, clientKey };

    const scored = named
      .filter((e) => e.core.length >= 5 && core.length >= 5)
      .map((e) => ({ id: e.companyId, score: similarity(core, e.core) }))
      .filter((s) => s.score >= 0.8)
      .sort((a, b) => b.score - a.score);
    if (scored.length) {
      const close = unique(scored.filter((s) => s.score >= scored[0].score - 0.03).map((s) => s.id));
      if (close.length === 1) return { status: 'matched', companyId: close[0], how: 'fuzzy', needsReview: true, clientKey };
      return { status: 'ambiguous', candidates: close, clientKey };
    }
  }

  const text = normalizeName(gig.text);
  if (text) {
    const mentioned = unique(index.filter((e) => e.kind !== 'ticker' && appearsIn(text, e)).map((e) => e.companyId));
    if (mentioned.length === 1) return { status: 'matched', companyId: mentioned[0], how: 'mention', needsReview: true, clientKey };
    if (mentioned.length > 1) return { status: 'ambiguous', candidates: mentioned, clientKey };
  }
  return { status: 'unmatched', clientKey };
}

// ── Size, timing and wording ─────────────────────────────────────────────────

/** Sum of the size of impacts already applied to a company in the last few ticks. */
export function recentGigAbs(gigs, companyId, tick, window = GIG_TUNING.saturationTicks) {
  return gigs.history
    .filter((h) => h.status === 'applied' && h.companyId === companyId && tick - h.tick < window)
    .reduce((s, h) => s + Math.abs(h.amount ?? 0), 0);
}

/**
 * The market reaction to a gig outcome. Failures hit harder than successes help, a company that
 * has had several gig impacts lately reacts less, and the delay is 1 to 3 days (fixed by the
 * gig's key, so asking twice gives the same answer).
 *
 * @returns {{amount: number, percent: number, delayDays: number, permanent: number, tauDown: number, saturated: boolean}}
 */
export function planGigImpact({ outcome, reward = 0, scale = 1, recentAbs = 0, key = '' }, tuning = GIG_TUNING) {
  const raw = gigImpactAmount({ outcome, reward, refReward: tuning.refReward, k: tuning.k, floor: tuning.floor, cap: tuning.cap, failWeight: tuning.failWeight });
  const sized = raw * Math.min(GIG_SCALE_RANGE.max, Math.max(GIG_SCALE_RANGE.min, Number(scale) || 1));
  const room = Math.max(tuning.minRoom, saturate(1, recentAbs, tuning.softCap));
  const amount = Math.sign(sized) * Math.min(tuning.hardCap, Math.abs(sized) * room);
  const rng = mulberry32(hashSeed('gig-delay', key));
  const { min, max } = tuning.delay;
  const shape = tuning.shape[outcome] ?? tuning.shape.done;
  return {
    amount: Math.round(amount * 10_000) / 10_000,
    percent: amountToPercent(amount),
    delayDays: min + Math.floor(rng() * (max - min + 1)),
    permanent: shape.permanent,
    tauDown: shape.tauDown,
    saturated: room < 1,
  };
}

/** Log-return to a rounded percent change (0.0198 is about +2.0%). */
export const amountToPercent = (amount) => Math.round((Math.exp(amount) - 1) * 1000) / 10;

/**
 * Language key for a generic, spoiler-free headline. The wording says only that the company has had
 * a good or bad spell, never what the gig was.
 */
export function gigHeadlineKey({ outcome, percent, key = '' }) {
  const size = Math.abs(percent) >= GIG_TUNING.strongPct ? 'strong' : 'mild';
  const n = 1 + (hashSeed('gig-headline', key) % GIG_HEADLINE_VARIANTS);
  return `NCI.Gig.Headline.${outcome === 'failed' ? 'failed' : 'done'}.${size}.${n}`;
}

// ── The queue and the history ────────────────────────────────────────────────

export const isKnownGig = (gigs, sourceKey) => gigs.pending.some((p) => p.sourceKey === sourceKey) || gigs.history.some((h) => h.sourceKey === sourceKey);

export function addPending(gigs, record) {
  return { ...gigs, pending: [...gigs.pending, record].slice(-GIG_PENDING_CAP) };
}

export const removePending = (gigs, id) => ({ ...gigs, pending: gigs.pending.filter((p) => p.id !== id) });

export function addHistory(gigs, entry) {
  return { ...gigs, history: [...gigs.history, entry].slice(-GIG_HISTORY_CAP) };
}

export function setMapping(gigs, clientKey, companyId, label = '') {
  if (!clientKey) return gigs;
  return { ...gigs, mappings: { ...gigs.mappings, [clientKey]: { companyId, label: label || clientKey } } };
}

export function removeMapping(gigs, clientKey) {
  const { [clientKey]: _gone, ...rest } = gigs.mappings;
  return { ...gigs, mappings: rest };
}

/** Clamp a GM's edits to a sensible size and delay. */
export function sanitizeGigEdits({ percent, delayDays }) {
  const p = Number(percent);
  const d = Math.floor(Number(delayDays));
  return {
    percent: Number.isFinite(p) && p !== 0 ? Math.max(-MAX_GIG_PERCENT, Math.min(MAX_GIG_PERCENT, p)) : null,
    delayDays: Number.isFinite(d) ? Math.max(0, Math.min(MAX_GIG_DELAY, d)) : null,
  };
}
