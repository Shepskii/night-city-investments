/**
 * Insider-trading heat
 * @file scripts/engine/heat.js
 * @description A gig outcome is private until its price effect starts to show. A trade on that
 *              company in the gap, in the direction the news will move it, draws heat. Heat is a hidden
 *              0-100 score per character that fades with time. This file only scores and records;
 *              nothing in it punishes anyone. Pure; no Foundry globals.
 *
 *   window  the gap: from the gig being reported to the first tick its effect shows
 *   audit   once the window has closed (and orders placed inside it have settled), every fill placed
 *           in it is scored in one pass
 *   gain    base x size x earliness x knowledge x route, only for trades the news makes profitable
 */

export const HEAT_SCHEMA = 1;

export const HEAT_TUNING = Object.freeze({
  /**
   * Heat from one medium trade (see `sizeRef`) that is as suspicious as it gets: early in the window,
   * placed by a direct trade, with no rumour behind it. Two of those, or three through a broker, are
   * enough to reach "noticed"; a large trade is worth several of them.
   */
  base: 14,
  /** In-world days for heat to halve. */
  halfLifeTicks: 7,
  maxHeat: 100,
  /** Trades below this many eb are pocket change and draw nothing. */
  minTrade: 250,
  /**
   * A medium trade is 3,000 eb, or 10% of the portfolio. Size is how many of those a trade is
   * (half by eb, half by share of the portfolio), up to `cap`, so a bigger trade draws more heat.
   */
  sizeRef: { abs: 3_000, rel: 0.1, cap: 4 },
  /** Trading on the last day of the window is this much less suspicious than on the first. */
  earlyDrop: 0.4,
  knowledge: { runner: 1.5, tipped: 0.4, general: 1 },
  route: { direct: 1, broker: 0.7 },
  /** Wait this long past the window for slow broker orders to fill before auditing anyway. */
  maxWaitTicks: 10,
  logCap: 20,
  windowCap: 40,
  auditCap: 30,
  penaltyCap: 30,
  /** A skilled broker leaves a smaller trail: the share of heat kept on trades made through them. */
  brokerFactor: { rookie: 1, competent: 0.95, seasoned: 0.85, expert: 0.75, elite: 0.65 },
  tiers: { noticed: 25, flagged: 50, investigated: 75 },
});

export const HEAT_TIERS = ['quiet', 'noticed', 'flagged', 'investigated'];

export const emptyHeat = () => ({ schema: HEAT_SCHEMA, characters: {}, windows: [], audits: [], penalties: [] });

export function normalizeHeat(h) {
  const base = emptyHeat();
  if (!h) return base;
  return {
    ...base,
    ...h,
    characters: h.characters && typeof h.characters === 'object' ? h.characters : {},
    windows: Array.isArray(h.windows) ? h.windows : [],
    audits: Array.isArray(h.audits) ? h.audits : [],
    penalties: Array.isArray(h.penalties) ? h.penalties : [],
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round1 = (n) => Math.round(n * 10) / 10;

// ── Heat over time ───────────────────────────────────────────────────────────

/** The tier a heat value falls in. */
export function heatTier(heat, tiers = HEAT_TUNING.tiers) {
  if (heat >= tiers.investigated) return 'investigated';
  if (heat >= tiers.flagged) return 'flagged';
  if (heat >= tiers.noticed) return 'noticed';
  return 'quiet';
}

/** Heat after `toTick - fromTick` days: it halves every `halfLife` days. */
export function decayHeat(value, fromTick, toTick, halfLife = HEAT_TUNING.halfLifeTicks) {
  const dt = Math.max(0, toTick - fromTick);
  return value * 0.5 ** (dt / halfLife);
}

/** A character's heat now, rounded to a tenth. */
export function currentHeat(entry, tick) {
  if (!entry) return 0;
  return round1(decayHeat(entry.heat ?? 0, entry.tick ?? tick, tick));
}

// ── Windows ──────────────────────────────────────────────────────────────────

/** Which way the news will move the price. */
export const directionOf = (outcome) => (outcome === 'failed' ? 'down' : 'up');

/**
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.sourceKey - the gig's key, so a gig opens one window
 * @param {string} o.companyId
 * @param {'done'|'failed'} o.outcome
 * @param {number} o.openTick - when the outcome was reported
 * @param {number} o.closeTick - the last tick before the effect shows
 * @param {string[]} [o.tipped] - characters sent a rumour about it
 * @param {string[]} [o.runners] - characters who ran the gig
 */
export function makeWindow({ id, sourceKey, gigId = null, companyId, outcome, openTick, closeTick, openDate = '', tipped = [], runners = [] }) {
  return {
    id,
    sourceKey,
    gigId,
    companyId,
    direction: directionOf(outcome),
    openTick,
    closeTick: Math.max(openTick, closeTick),
    openDate,
    tipped: [...new Set(tipped)],
    runners: [...new Set(runners)],
    status: 'open',
  };
}

/** Was this order placed inside the window, on the window's company? */
export const placedInWindow = (order, window) => order.assetId === window.companyId
  && order.assetType !== 'fund'
  && order.submittedTick >= window.openTick
  && order.submittedTick <= window.closeTick;

/** Is the window over, and have the orders placed inside it settled (or waited long enough)? */
export function windowReady(window, tick, orderLists, tuning = HEAT_TUNING) {
  if (window.status !== 'open' || tick <= window.closeTick) return false;
  if (tick > window.closeTick + tuning.maxWaitTicks) return true;
  return !orderLists.some((orders) => orders.some((o) => o.status === 'open' && placedInWindow(o, window)));
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Heat from one filled order, or null when it does not count. It counts when it is a stock trade
 * of a meaningful size, placed inside the window, in the direction the news will move the price
 * (a buy before good news, a sale before bad).
 *
 * @param {object} o
 * @param {object} o.order - a filled order from the portfolio
 * @param {object} o.window
 * @param {string} o.actorId
 * @param {number} o.portfolioValue - the character's total value, for the share of it traded
 * @param {number} [o.strength] - the GM's scale
 * @param {number} [o.brokerFactor] - share of the heat kept on a broker trade (a skilled broker covers better)
 */
export function scoreTrade({ order, window, actorId, portfolioValue, strength = 1, brokerFactor = 1 }, tuning = HEAT_TUNING) {
  if (order.status !== 'filled' || !placedInWindow(order, window)) return null;
  const aligned = (window.direction === 'up' && order.side === 'buy') || (window.direction === 'down' && order.side === 'sell');
  if (!aligned) return null;

  const gross = (order.fillPrice ?? 0) * (order.qty ?? 0);
  if (gross < tuning.minTrade) return null;

  const total = Math.max(portfolioValue, gross);
  const { abs, rel, cap } = tuning.sizeRef;
  const size = Math.min(cap, 0.5 * Math.min(cap, gross / abs) + 0.5 * Math.min(cap, gross / total / rel));
  const span = window.closeTick - window.openTick;
  const position = span > 0 ? (order.submittedTick - window.openTick) / span : 0;
  const earliness = 1 - tuning.earlyDrop * clamp(position, 0, 1);
  const knowledgeKey = window.runners.includes(actorId) ? 'runner' : window.tipped.includes(actorId) ? 'tipped' : 'general';
  const knowledge = tuning.knowledge[knowledgeKey];
  const route = tuning.route[order.route] ?? tuning.route.broker;
  const cover = order.route === 'broker' ? clamp(Number(brokerFactor) || 1, 0, 1) : 1;
  const gain = round1(tuning.base * Math.min(3, Math.max(0, strength)) * size * earliness * knowledge * route * cover);
  if (!(gain > 0)) return null;

  return {
    orderId: order.id, side: order.side, gross: Math.round(gross), route: order.route ?? 'direct', submittedTick: order.submittedTick, knowledge: knowledgeKey, gain,
    ...(cover < 1 ? { brokerFactor: cover } : {}),
  };
}

/**
 * Score every character's trades in one window.
 * @param {object} o
 * @param {object} o.window
 * @param {{actorId: string, name?: string, orders: object[], value: number, brokerFactors?: Object<string, number>}[]} o.portfolios
 *        `brokerFactors` maps a broker's id to the share of heat kept on trades made through them
 * @param {number} [o.strength]
 * @returns {{actorId: string, name: string, gain: number, trades: object[]}[]} only characters with something to answer for
 */
export function auditWindow({ window, portfolios, strength = 1 }, tuning = HEAT_TUNING) {
  const results = [];
  for (const p of portfolios) {
    const trades = p.orders
      .map((order) => scoreTrade({ order, window, actorId: p.actorId, portfolioValue: p.value, strength, brokerFactor: p.brokerFactors?.[order.brokerId] ?? 1 }, tuning))
      .filter(Boolean);
    if (!trades.length) continue;
    const gain = round1(Math.min(tuning.maxHeat, trades.reduce((s, t) => s + t.gain, 0)));
    results.push({ actorId: p.actorId, name: p.name ?? p.actorId, gain, trades });
  }
  return results;
}

// ── Recording ────────────────────────────────────────────────────────────────

/** Is a character's cover (from a front company) still working at this tick? */
export const coverActive = (entry, tick) => !!entry?.cover && tick <= entry.cover.until;

/**
 * Add an audit's results to the heat record: each character's heat fades to now, then rises by the
 * gain (cut by any cover they have bought, never past the maximum); the window is closed and the
 * audit kept for the GM. Everything else on a character's record (warnings, cover, applied actions)
 * is kept.
 * @returns {object} the new heat record
 */
export function applyAudit(heat, { window, results, tick, date = '' }, tuning = HEAT_TUNING) {
  const current = normalizeHeat(heat);
  const characters = { ...current.characters };
  const recorded = [];
  for (const r of results) {
    const before = characters[r.actorId];
    const faded = before ? decayHeat(before.heat, before.tick, tick, tuning.halfLifeTicks) : 0;
    const covered = coverActive(before, tick);
    const applied = round1(r.gain * (covered ? before.cover.factor : 1));
    characters[r.actorId] = {
      ...before,
      heat: round1(Math.min(tuning.maxHeat, faded + applied)),
      tick,
      name: r.name,
      log: [...(before?.log ?? []), { tick, date, gain: applied, companyId: window.companyId, sourceKey: window.sourceKey, trades: r.trades.length, ...(covered ? { covered: true } : {}) }].slice(-tuning.logCap),
    };
    recorded.push({ ...r, applied, ...(covered ? { covered: true } : {}) });
  }
  const windows = current.windows.map((w) => (w.id === window.id ? { ...w, status: 'audited', auditedTick: tick } : w));
  const audits = [...current.audits, {
    id: window.id, sourceKey: window.sourceKey, companyId: window.companyId, direction: window.direction, openTick: window.openTick, closeTick: window.closeTick, tick, date, results: recorded,
  }].slice(-tuning.auditCap);
  return { ...current, characters, windows: pruneWindows(windows, tuning), audits };
}

/** Keep every open window and the newest closed ones. */
export function pruneWindows(windows, tuning = HEAT_TUNING) {
  if (windows.length <= tuning.windowCap) return windows;
  const open = windows.filter((w) => w.status === 'open');
  const closed = windows.filter((w) => w.status !== 'open').slice(-Math.max(0, tuning.windowCap - open.length));
  return windows.filter((w) => open.includes(w) || closed.includes(w));
}

export function addWindow(heat, window) {
  const current = normalizeHeat(heat);
  if (current.windows.some((w) => w.sourceKey === window.sourceKey)) return current;
  return { ...current, windows: pruneWindows([...current.windows, window]) };
}

/** Close a window without scoring it. */
export function voidWindow(heat, windowId) {
  const current = normalizeHeat(heat);
  return { ...current, windows: current.windows.map((w) => (w.id === windowId ? { ...w, status: 'void' } : w)) };
}
