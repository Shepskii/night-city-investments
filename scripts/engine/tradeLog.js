/**
 * Trade log
 * @file scripts/engine/tradeLog.js
 * @description The GM's view of recent fills across every portfolio, read from the filled orders
 *              each portfolio keeps (the last 40 closed ones). Pure; no Foundry globals.
 */

export const TRADE_LOG_LIMIT = 40;

/**
 * Recent filled orders, newest first.
 * @param {{actorId: string, name: string, portfolio: object}[]} entries
 * @param {{limit?: number, actorId?: string, assetId?: string}} [opts]
 */
export function tradeLog(entries, { limit = TRADE_LOG_LIMIT, actorId = null, assetId = null } = {}) {
  const rows = [];
  for (const entry of entries) {
    if (actorId && entry.actorId !== actorId) continue;
    for (const o of entry.portfolio?.orders ?? []) {
      if (o.status !== 'filled') continue;
      if (assetId && o.assetId !== assetId) continue;
      rows.push({
        tick: o.filledTick ?? o.closedTick ?? 0,
        actorId: entry.actorId,
        name: entry.name,
        orderId: o.id,
        side: o.side,
        assetId: o.assetId,
        assetType: o.assetType ?? 'stock',
        qty: o.qty,
        price: o.fillPrice ?? 0,
        gross: Math.round((o.qty ?? 0) * (o.fillPrice ?? 0)),
        fees: o.fees ?? 0,
        route: o.route ?? 'direct',
        brokerId: o.brokerId ?? null,
        realized: o.realized ?? 0,
      });
    }
  }
  rows.sort((a, b) => b.tick - a.tick || a.name.localeCompare(b.name) || String(b.orderId).localeCompare(String(a.orderId)));
  return rows.slice(0, Math.max(1, limit));
}
