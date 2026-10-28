/**
 * Business client: the player's side of running a business.
 * @file scripts/services/BusinessClient.js
 * @description Players never change a business. They append a request to their character's business
 *              outbox and the active GM's service handles it, as with the portfolio outbox. A roll is
 *              made here, on the player's own client, when they press Roll: the request carries the
 *              chat card's id and the GM reads the dice from the card.
 */

import { dayIndex, rollSpec, partnerOf } from '../engine/index.js';
import { MODULE_ID, FLAGS, OUTBOX_LIMIT } from '../utils/constants.js';
import { L } from '../utils/helpers.js';
import { SerialQueue } from '../utils/queue.js';
import { MarketClock } from './MarketClockService.js';
import { SkillAdapter } from './SkillAdapter.js';

const unwrap = (stored) => (Array.isArray(stored) ? stored[0] : stored);

/** What the GM has done with a character's business requests. */
export function receiptsOf(actor) {
  const r = unwrap(actor?.getFlag?.(MODULE_ID, FLAGS.BUSINESS_RECEIPTS)) ?? {};
  return { processed: [...(r.processed ?? [])], results: [...(r.results ?? [])] };
}

export function businessOutbox(actor) {
  return foundry.utils.deepClone(actor?.getFlag?.(MODULE_ID, FLAGS.BUSINESS_OUTBOX) ?? []);
}

/** Requests the GM has not handled yet. */
export function pendingBusinessRequests(actor) {
  const done = new Set(receiptsOf(actor).processed);
  return businessOutbox(actor).filter((r) => !done.has(r.key));
}

/** The best Operator rank among a business's partners, for hire fees. */
export function operatorRankOf(business) {
  return Math.max(0, ...business.partners
    .filter((p) => p.status === 'active' || p.status === 'leaving')
    .map((p) => SkillAdapter.readAbility(game.actors.get(p.actorId), 'Operator').rank));
}

class BusinessClientImpl {
  constructor() {
    this._chain = new SerialQueue('Business client write');
    this.submitted = new Set();
  }

  /** Today, as a market day. */
  day() {
    return dayIndex(MarketClock.nowMs());
  }

  /**
   * Queue a request for the GM.
   * @returns {Promise<string|null>} the request key, or null if the outbox is full
   */
  async submit(actor, type, payload = {}) {
    if (pendingBusinessRequests(actor).length >= OUTBOX_LIMIT) {
      ui.notifications.warn(L('NCI.Errors.OutboxFull'));
      return null;
    }
    const key = foundry.utils.randomID(16);
    this.submitted.add(key);
    await this._chain.run(async () => {
      await actor.setFlag(MODULE_ID, FLAGS.BUSINESS_OUTBOX, [...businessOutbox(actor), { key, type, ...payload, ts: Date.now() }]);
    });
    if (!game.users.activeGM) ui.notifications.info(L('NCI.Notify.QueuedNoGM'));
    return key;
  }

  /** Drop requests the GM has handled. Players prune their own; a GM only actors no player owns. */
  async prune(actor) {
    if (!actor.isOwner) return;
    if (game.user.isGM && actor.hasPlayerOwner) return;
    await this._chain.run(async () => {
      const done = new Set(receiptsOf(actor).processed);
      const current = businessOutbox(actor);
      const keep = current.filter((r) => !done.has(r.key));
      if (keep.length !== current.length) await actor.setFlag(MODULE_ID, FLAGS.BUSINESS_OUTBOX, keep);
    });
  }

  /**
   * Make a business roll and send it. The request is checked here first against the business as
   * this client sees it, so a roll that could not count is not made; the GM checks it all again.
   * @param {Actor} actor
   * @param {object} business
   * @param {object} request - `{type, businessId, use, action?, forAction?}`
   * @param {{levers?: object, title: string}} o
   * @returns {Promise<string|null>} the request key
   */
  async roll(actor, business, request, { levers = {}, title }) {
    const spec = rollSpec(business, request, actor.id, { day: this.day(), operatorRank: operatorRankOf(business) });
    if (!spec.ok) {
      ui.notifications.warn(L(`NCI.Business.Reason.${spec.reason}`));
      return null;
    }
    const use = request.use.kind === 'hire' ? request.use : spec.use;
    const { messageId } = await SkillAdapter.leverCheck(actor, {
      dv: spec.dv, title, use, levers: { ...levers, bonus: spec.bonusAvailable ? levers.bonus : 0 },
    });
    if (!messageId) return null;
    return this.submit(actor, request.type, { ...request, use, rollId: messageId });
  }

  /** Is this character a partner who can act for the business (active, with a vote)? */
  canAct(business, actorId) {
    const p = partnerOf(business, actorId);
    return !!p && p.status === 'active' && p.voting;
  }
}

export const BusinessClient = new BusinessClientImpl();
