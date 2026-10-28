/**
 * Executor support
 * @file scripts/engine/executorSupport.js
 * @description Small helpers the executor needs for broker fee profiles and fund pricing. Kept
 *              apart so executor.js stays readable. Pure; no Foundry globals.
 */

import { feeProfileOf, fundTiming, fundExecutionPrice } from './brokerTerms.js';

/** The { flatFee, commissionBps } of a broker's terms. */
export const brokerTermsFeeProfile = feeProfileOf;

/**
 * The per-unit price a fund order fills at today: NAV adjusted by the order's broker terms and a
 * seeded timing draw (the same order always gets the same draw).
 */
export function fundOrderPrice({ order, asset, seed }) {
  const terms = order.terms ?? { loadRebate: 0, timingMeanBps: 0, timingSigmaBps: 0 };
  const timingBps = fundTiming({ terms, seed: seed ?? 'nci', key: order.id });
  const price = fundExecutionPrice({ side: order.side, nav: asset.price, fund: asset.fund ?? {}, terms, timingBps });
  return { price, timingBps };
}
