/**
 * Player businesses: smear and leak campaigns (F1c)
 * @file scripts/engine/businessCampaign.js
 * @description A business runs a campaign against a listed company as one of its week's actions: a smear
 *              (Composition, Persuasion) or a leak (Library Search, Interface). It costs the same whatever
 *              the roll, and a business can run one a month. A success moves the target's price a little,
 *              after the GM approves it unless a setting turns that off; a fumble gets the business caught.
 *              Pure; the GM's service queues the impact, the news, the heat and the standing.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { fail, addLedger } from './businessRecord.js';
import { bandPassed } from './rolls.js';

/** Days until this business may run another campaign; 0 when it can now. */
export function campaignWait(b, day, p = BUSINESS_DEFAULTS) {
  return b.lastCampaignDay == null ? 0 : Math.max(0, b.lastCampaignDay + p.campaign.days - day);
}

/** Whether this business can run a campaign now, before the target itself is known to the engine. */
export function campaignCheck(b, ticker, day, p = BUSINESS_DEFAULTS, cost = p.campaign.cost) {
  if (!ticker) return fail('no-target');
  if (ticker === b.company?.ticker) return fail('bad-target');
  if (campaignWait(b, day, p) > 0) return fail('campaign-wait');
  if (b.campaign) return fail('campaign-wait');
  return b.till < cost ? fail('no-gift') : { ok: true };
}

/**
 * A company's black ops against another (U1c): a campaign in all but scale, sharing its month's limit and
 * the GM's approval, with a case and a scandal if it goes wrong.
 * @returns {object[]} events for the GM's service
 */
export function runBlackOps(b, { ticker, name, band, actorId, day, approval }, p = BUSINESS_DEFAULTS) {
  const rules = p.crime;
  b.till -= rules.blackOpsCost;
  b.lastCampaignDay = day;
  addLedger(b, { day, kind: 'blackOps', amount: -rules.blackOpsCost }, p);
  if (band === 'fumble') return [{ type: 'campaignCaught', ticker, blackOps: true, exposure: rules.blackOpsCaught }];
  if (!bandPassed(band)) return [];
  const campaign = { ticker, name, kind: 'blackOps', percent: rules.blackOpsSize[band], actorId, day };
  if (!approval) return [{ type: 'campaignLands', campaign }];
  b.campaign = { ...campaign, status: 'awaiting' };
  return [];
}

/** A smear or a leak, from the skill rolled. Staff called in smear. */
export const campaignKind = (useKey) => (['skill:Library Search', 'ability:Interface'].includes(useKey) ? 'leak' : 'smear');

/**
 * Run the campaign the week's roll has just decided: the cost, then what the band brings.
 * @returns {object[]} events for the GM's service
 */
export function runCampaign(b, { ticker, name, useKey, band, actorId, day, approval }, p = BUSINESS_DEFAULTS) {
  const rules = p.campaign;
  b.till -= rules.cost;
  b.lastCampaignDay = day;
  addLedger(b, { day, kind: 'campaign', amount: -rules.cost }, p);
  if (band === 'fumble') return [{ type: 'campaignCaught', ticker, exposure: rules.caughtExposure }];
  if (!bandPassed(band)) return [];
  const campaign = { ticker, name, kind: campaignKind(useKey), percent: rules.size[band], actorId, day };
  if (!approval) return [{ type: 'campaignLands', campaign }];
  b.campaign = { ...campaign, status: 'awaiting' };
  return [];
}
