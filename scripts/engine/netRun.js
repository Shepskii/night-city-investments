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
  if (!flag || flag.used) return false;
  if (businessId && flag.businessId === businessId) return true;
  return !!ticker && flag.ticker === ticker;
}
