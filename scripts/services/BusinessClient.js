/**
 * Business client: the player's side of running a business.
 * @file scripts/services/BusinessClient.js
 * @description Players never change a business. They append a request to their character's business
 *              outbox and the active GM's service handles it, as with the portfolio outbox. A roll is
 *              made here, on the player's own client, when they press Roll: the request carries the
 *              chat card's id and the GM reads the dice from the card.
 */

import { dayIndex, rollSpec, partnerOf } from '../engine/index.js';
import { MODULE_ID, FLAGS, OUTBOX_LIMIT, BROKER_TAG, INVESTOR_TAG, STAFF_TAGS } from '../utils/constants.js';
import { NcmAdapter } from '../integrations/NcmAdapter.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { L, unwrap } from '../utils/helpers.js';
import { SerialQueue } from '../utils/queue.js';
import { MarketClock } from './MarketClockService.js';
import { SkillAdapter } from './SkillAdapter.js';

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
  // A syndicate partner counts its officers' Operator, since they act for it (DESIGN §31, B3b).
  const actorsOf = (id) => {
    const actor = game.actors.get(id);
    if (actor) return [actor];
    const syndicate = SyndicateRepository.get(id);
    return (syndicate?.members ?? []).filter((m) => m.status === 'active' && m.role === 'officer').map((m) => game.actors.get(m.actorId)).filter(Boolean);
  };
  return Math.max(0, ...business.partners
    .filter((p) => p.status === 'active' || p.status === 'leaving')
    .flatMap((p) => actorsOf(p.actorId))
    .map((actor) => SkillAdapter.readAbility(actor, 'Operator').rank));
}

/**
 * The characters a business may invite to buy in: player characters, and the characters linked to
 * NCM contacts tagged broker or investor. A contact with no linked character is left out, since an
 * investor pays from a character's wealth and accepts through that character.
 */
export function investorActors() {
  const tagged = new Set([BROKER_TAG, INVESTOR_TAG].flatMap((tag) => NcmAdapter.contactsTagged(tag)).map((c) => c?.actorId).filter(Boolean));
  return [
    ...game.actors.filter((a) => a.type === 'character' && (a.hasPlayerOwner || tagged.has(a.id))),
    // Syndicates invest from their own account (DESIGN §31, B3b).
    ...SyndicateRepository.all().filter((s) => s.status === 'active').map((s) => ({ id: s.id, name: s.name, isSyndicate: true })),
  ];
}

/**
 * The characters a business may hire (DESIGN §33): player characters ('pc'), and NPCs linked to NCM
 * contacts tagged staff or employee ('npc').
 * @returns {{id: string, name: string, source: 'pc'|'npc'}[]}
 */
export function staffActors() {
  const tagged = new Set(STAFF_TAGS.flatMap((tag) => NcmAdapter.contactsTagged(tag)).map((c) => c?.actorId).filter(Boolean));
  return game.actors
    .filter((a) => a.type === 'character' && (a.hasPlayerOwner || tagged.has(a.id)))
    .map((a) => ({ id: a.id, name: a.name, source: a.hasPlayerOwner ? 'pc' : 'npc' }));
}

/** The jobs a character holds or has been offered, as the GM mirrored them onto the character. */
export const jobsOf = (actor) => [...(unwrap(actor?.getFlag?.(MODULE_ID, FLAGS.JOBS)) ?? [])];

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
    // For a syndicate, the officer it is picked as sends the request, naming the syndicate (DESIGN §31, B3b).
    if (actor?.isSyndicate) return this.submit(actor.as, type, { ...payload, syndicateId: actor.id });
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
    // An officer acting for a syndicate rolls with their own skills and Luck.
    const { messageId } = await SkillAdapter.leverCheck(actor?.isSyndicate ? actor.as : actor, {
      dv: spec.dv, title, use, levers: { ...levers, bonus: spec.bonusAvailable ? levers.bonus : 0, extra: spec.extraAvailable ? levers.extra : 0 },
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
