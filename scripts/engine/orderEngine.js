/**
 * Order evaluation and fills
 * @file scripts/engine/orderEngine.js
 * @description Pure order logic: fees, trigger rules, validation, FIFO lot accounting, and fill
 *              application on a portfolio value object { cash, lots, ledger }. No Foundry globals.
 */

const round = Math.round;

/** Broker fee for a gross amount: flatFee + commissionBps. Whole eb. */
export function computeFees(gross, profile = {}) {
  const flat = profile.flatFee ?? 0;
  const bps = profile.commissionBps ?? 0;
  return round(flat + (gross * bps) / 10000);
}

/**
 * Decide whether an order can execute against the current quote.
 * Buys execute at the ask and sells at the bid.
 * @returns {{triggered: boolean, price: number}}
 */
export function checkTrigger(order, quote) {
  const ref = order.side === 'buy' ? quote.ask : quote.bid;
  switch (order.type ?? 'market') {
    case 'limit': {
      const ok = order.side === 'buy' ? ref <= order.limit : ref >= order.limit;
      return { triggered: ok, price: ref };
    }
    case 'stop': {
      const ok = order.side === 'buy' ? quote.mid >= order.limit : quote.mid <= order.limit;
      return { triggered: ok, price: ref };
    }
    default:
      return { triggered: true, price: ref };
  }
}

/** Total shares held of an asset. */
export function heldQty(lots, assetId) {
  return lots.filter((l) => l.assetId === assetId).reduce((sum, l) => sum + l.qty, 0);
}

/**
 * Check an order against the portfolio before filling.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateOrder({ order, price, cash, lots, fees = 0, minOrder = 0, assetActive = true, reservedQty = 0 }) {
  if (!assetActive) return { ok: false, reason: 'halted' };
  if (!Number.isInteger(order.qty) || order.qty <= 0) return { ok: false, reason: 'invalid-qty' };
  const gross = round(order.qty * price);
  if (gross < minOrder) return { ok: false, reason: 'below-minimum' };
  if (order.side === 'buy') {
    if (cash < gross + fees) return { ok: false, reason: 'insufficient-funds' };
  } else if (order.qty > heldQty(lots, order.assetId) - reservedQty) {
    return { ok: false, reason: 'insufficient-shares' };
  }
  return { ok: true };
}

/**
 * Remove `qty` shares from the oldest lots first.
 * @returns {{lots: object[], costBasis: number} | null} null when there are not enough shares
 */
export function consumeLotsFifo(lots, assetId, qty) {
  if (heldQty(lots, assetId) < qty) return null;
  const ordered = lots
    .map((lot, index) => ({ lot, index }))
    .filter(({ lot }) => lot.assetId === assetId)
    .sort((a, b) => (a.lot.acquiredTick ?? 0) - (b.lot.acquiredTick ?? 0) || a.index - b.index);

  const remaining = new Map(lots.map((l) => [l.id, l.qty]));
  let need = qty;
  let costBasis = 0;
  for (const { lot } of ordered) {
    if (need <= 0) break;
    const take = Math.min(need, lot.qty);
    costBasis += take * lot.unitCost;
    remaining.set(lot.id, lot.qty - take);
    need -= take;
  }
  const next = lots
    .map((l) => ({ ...l, qty: remaining.get(l.id) }))
    .filter((l) => l.qty > 0);
  return { lots: next, costBasis };
}

/**
 * Apply a fill to a portfolio. Returns a new portfolio; the input is not mutated.
 * Buy cost basis includes fees. A sell's realised P&L is net proceeds minus FIFO cost basis.
 *
 * @param {object} o
 * @param {{cash: number, lots: object[], ledger: object[]}} o.portfolio
 * @param {object} o.order - { id, side, assetType, assetId, qty }
 * @param {number} o.price - per-unit execution price
 * @param {number} [o.fees]
 * @param {number} o.tick
 * @param {string} [o.lotId] - id for a new lot on a buy
 * @param {number} [o.settleTicks] - a sell's proceeds become spendable this many ticks later (0: at once)
 * @returns {{ok: true, portfolio: object, gross: number, fees: number, realized: number|null} | {ok: false, reason: string}}
 */
export function executeFill({ portfolio, order, price, fees = 0, tick, lotId = null, settleTicks = 0 }) {
  const gross = round(order.qty * price);
  const ledger = [...portfolio.ledger];
  const base = { ts: tick, assetId: order.assetId, ref: order.id };

  if (order.side === 'buy') {
    const total = gross + fees;
    if (portfolio.cash < total) return { ok: false, reason: 'insufficient-funds' };
    const lot = {
      id: lotId ?? `lot_${tick}_${order.id}`,
      assetType: order.assetType ?? 'stock',
      assetId: order.assetId,
      qty: order.qty,
      unitCost: Math.round((total / order.qty) * 10000) / 10000,
      acquiredTick: tick,
      drip: false,
    };
    ledger.push({ ...base, kind: 'buy', qty: order.qty, amount: -gross });
    if (fees) ledger.push({ ...base, kind: 'fee', qty: 0, amount: -fees });
    return {
      ok: true,
      portfolio: { ...portfolio, cash: portfolio.cash - total, lots: [...portfolio.lots, lot], ledger },
      gross,
      fees,
      realized: null,
    };
  }

  const consumed = consumeLotsFifo(portfolio.lots, order.assetId, order.qty);
  if (!consumed) return { ok: false, reason: 'insufficient-shares' };
  const proceeds = gross - fees;
  const settle = Math.max(0, Math.floor(settleTicks));
  ledger.push({ ...base, kind: 'sell', qty: order.qty, amount: gross });
  if (fees) ledger.push({ ...base, kind: 'fee', qty: 0, amount: -fees });
  // With a settlement (or fund redemption) delay the money is owed to the portfolio but not yet spendable.
  const settling = settle > 0
    ? { unsettled: [...(portfolio.unsettled ?? []), { id: `us_${order.id}`, assetId: order.assetId, amount: proceeds, releaseTick: tick + settle }] }
    : {};
  return {
    ok: true,
    portfolio: { ...portfolio, cash: settle > 0 ? portfolio.cash : portfolio.cash + proceeds, lots: consumed.lots, ledger, ...settling },
    gross,
    fees,
    realized: round(proceeds - consumed.costBasis),
    settleTicks: settle,
  };
}

/** Average cost, market value and unrealised P&L for one asset. */
export function positionSummary(lots, assetId, price) {
  const mine = lots.filter((l) => l.assetId === assetId);
  const qty = mine.reduce((s, l) => s + l.qty, 0);
  const cost = mine.reduce((s, l) => s + l.qty * l.unitCost, 0);
  const value = round(qty * price);
  return {
    qty,
    avgCost: qty ? cost / qty : 0,
    cost: round(cost),
    value,
    unrealized: round(value - cost),
  };
}
