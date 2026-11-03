/**
 * Crew Tools adapter: a character's downtime, behind one door (B7b, DESIGN §36.9).
 * @file scripts/integrations/CrewToolsAdapter.js
 * @description With Pneuma's Crew Tools active, the days business work takes come from a character's downtime, not
 *              the weekly allowance. Crew Tools has no hook and no way to register an activity, so the player's client
 *              spends the days as a free-form spend tagged with a one-time key, before anything else happens, and sends
 *              that key with the request. The GM's service finds the spend in the character's Downtime Log and credits
 *              the days to that one request. The player owns that log and could edit it, as with a roll's chat card:
 *              the GM's view of it is the check.
 */

import { BUSINESS_DEFAULTS } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';
import { L } from '../utils/helpers.js';
import { ownerOf } from '../ui/accounts.js';

export const CREW_TOOLS_ID = 'pneuma-crewtools';

const api = () => game.modules?.get(CREW_TOOLS_ID)?.api?.downtime ?? null;
const stateOf = (characterId) => {
  try {
    return api()?.getState(characterId) ?? null;
  } catch {
    return null;
  }
};

export const CrewToolsAdapter = {
  /** Whether Crew Tools is here. */
  present() {
    return !!game.modules?.get(CREW_TOOLS_ID)?.active;
  },

  /** Whether business days come from downtime in this world. */
  active() {
    return this.present() && game.settings.get(MODULE_ID, SETTINGS.CREW_DOWNTIME) !== false;
  },

  /** Whether a GM has opened Downtime for this character: Crew Tools refuses until then. */
  prepared(characterId) {
    return !!stateOf(characterId)?.accounts?.some((a) => a.actorId === characterId);
  },

  /** A character's unspent days, worked out as Crew Tools does: what was awarded, less everything else recorded. */
  balance(characterId) {
    const events = stateOf(characterId)?.events ?? [];
    return events.filter((e) => e.actorId === characterId).reduce((sum, e) => sum + (e.kind === 'award' ? e.days : e.kind === 'rejected' ? 0 : -e.days), 0);
  },

  /**
   * The engine's rules for this account on this business: no weekly days of its own, only what is in their downtime.
   * Its days already used this week are added back, so that what is left comes to their balance. Unchanged without it.
   */
  params(account, business) {
    if (!this.active()) return BUSINESS_DEFAULTS;
    const used = business?.period?.days?.[account?.id] ?? 0;
    return { ...BUSINESS_DEFAULTS, businessDays: used + this.balance(ownerOf(account)?.id) };
  },

  /** The engine's rules on the GM's side: no days at all, but what a request's verified spend credits it. */
  gmParams() {
    return this.active() ? { ...BUSINESS_DEFAULTS, businessDays: 0 } : BUSINESS_DEFAULTS;
  },

  /**
   * Spend a character's days, before the work they pay for. A refusal from Crew Tools is shown as it says it.
   * @param {object} account - a character, or a syndicate as one of its officers: the character's own days
   * @param {number} days
   * @param {string} reason - shown in their Downtime Log
   * @returns {Promise<{key: string, days: number}|null>} what to send with the request, or null if nothing was spent
   */
  async spend(account, days, reason) {
    const characterId = ownerOf(account)?.id;
    if (this.balance(characterId) < days) {
      ui.notifications.warn(L('NCI.Downtime.NotEnough', { days }));
      return null;
    }
    const key = `nci_${foundry.utils.randomID(16)}`;
    try {
      await api().use(days, 'spend', reason, characterId, { projectId: key });
    } catch (error) {
      ui.notifications.warn(error.message);
      return null;
    }
    return { key, days };
  },

  /**
   * On the GM's side: the spend a request claims, if it is in the character's log: theirs, of those days, in this session.
   * @returns {{id: string, days: number}|null}
   */
  verify(characterId, claim) {
    const state = stateOf(characterId);
    const event = state?.events?.find((e) => e.projectId === claim?.key && e.actorId === characterId && e.kind === 'spend');
    if (!event || event.days !== claim.days || event.period !== state.period) return null;
    return { id: event.id, days: event.days };
  },
};
