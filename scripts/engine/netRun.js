/**
 * A Netrunner's NET run (X2a, DESIGN §36.20)
 * @file scripts/engine/netRun.js
 * @description Interface against an NPC's business or a market corporation, once a week, for legwork money. A pass
 *              brings back a data shard: what is coming for a corporation, or an NPC business's real ledger. It is
 *              evidence for a Lawman's investigation or a Media's story. A failure is traced; a fumble is an ICE hit
 *              as well, for the GM to play. Pure.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { bandPassed } from './rolls.js';
import { corpTier } from './businessInquiry.js';

/** Days until this Netrunner can run again; 0 when they can now. */
export function netRunWait(lastDay, day, p = BUSINESS_DEFAULTS) {
  return Number.isFinite(lastDay) ? Math.max(0, lastDay + p.roles.netRun.days - day) : 0;
}

/** The DV of a run: an NPC's business by its stage, a corporation by its size among the market's corporations. */
export function netRunDv(target, corps = [], p = BUSINESS_DEFAULTS) {
  const dv = p.roles.netRun.dv;
  if (target.kind === 'npc') return dv.npc[Math.max(0, Math.min(dv.npc.length - 1, Number(target.stage) || 0))];
  return dv.corp[corpTier(corps, target.ticker)];
}

/** How much a piece of evidence adds to an investigation: its own weight (a real run's shard), or the usual. */
export const evidenceWeight = (flag, p = BUSINESS_DEFAULTS) => (Number.isFinite(flag?.bonus) ? flag.bonus : p.roles.inquiry.evidence);

/**
 * How a real run ended (X2a on NET Architect): a pass if the shard about the target came out with the runner, traced
 * if any node was failed or compromised on the way.
 * @returns {{outcome: 'success'|'failure', traced: boolean, heat: number, standing: number}}
 */
export function liveRunOutcome({ shard, failed = 0, compromised = 0 }, p = BUSINESS_DEFAULTS) {
  const rules = p.roles.netRun;
  const traced = failed + compromised > 0;
  return { outcome: shard ? 'success' : 'failure', traced, heat: traced ? rules.heat : 0, standing: traced ? rules.standing : 0 };
}

/**
 * What the roll does.
 * @returns {{outcome: 'success'|'failure'|'fumble', shard: boolean, heat: number, standing: number, ice: boolean}}
 */
export function netRunEffect(band, p = BUSINESS_DEFAULTS) {
  const rules = p.roles.netRun;
  const none = { shard: false, heat: 0, standing: 0, ice: false };
  if (bandPassed(band)) return { ...none, outcome: 'success', shard: true };
  const traced = { ...none, heat: rules.heat, standing: rules.standing };
  return band === 'fumble' ? { ...traced, outcome: 'fumble', ice: true } : { ...traced, outcome: 'failure' };
}

/**
 * Whether an evidence item is about this target: the ticker when it has one, or the business itself.
 * @param {{ticker?: string|null, businessId?: string|null, used?: boolean}} flag
 */
export function evidenceMatches(flag, { ticker = null, businessId = null } = {}) {
  // A shard still waiting on a node (a live template) is no one's evidence yet.
  if (!flag || flag.used || flag.live) return false;
  if (businessId && flag.businessId === businessId) return true;
  return !!ticker && flag.ticker === ticker;
}
