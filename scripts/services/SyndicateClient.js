/**
 * Syndicate client: the player's side of a syndicate's requests (DESIGN §30).
 * @file scripts/services/SyndicateClient.js
 * @description A member never writes the syndicate. Their character carries a syndicate outbox that
 *              only its owner writes, and the active GM's SyndicateService handles it and leaves a
 *              receipt. Trades for the syndicate's account are terminal requests wrapped in a
 *              `trade` request, so the GM knows which member asked.
 */

import { MODULE_ID, FLAGS, OUTBOX_LIMIT } from '../utils/constants.js';
import { L, unwrap } from '../utils/helpers.js';
import { SerialQueue } from '../utils/queue.js';

/** What the GM has done with a character's syndicate requests. */
export function syndicateReceipts(actor) {
  const r = unwrap(actor?.getFlag?.(MODULE_ID, FLAGS.SYNDICATE_RECEIPTS)) ?? {};
  return { processed: [...(r.processed ?? [])], results: [...(r.results ?? [])] };
}

export function syndicateOutbox(actor) {
  return foundry.utils.deepClone(actor?.getFlag?.(MODULE_ID, FLAGS.SYNDICATE_OUTBOX) ?? []);
}

/** Requests the GM has not handled yet. */
export function pendingSyndicateRequests(actor) {
  const done = new Set(syndicateReceipts(actor).processed);
  return syndicateOutbox(actor).filter((r) => !done.has(r.key));
}

class SyndicateClientImpl {
  constructor() {
    this._chain = new SerialQueue('Syndicate client write');
    /** Keys submitted from this client, so results are announced to the person who asked. */
    this.submitted = new Set();
  }

  /**
   * Queue a request for the GM.
   * @param {Actor} actor - the member's own character
   * @param {string} type - see engine/syndicate.js
   * @param {object} payload - with `syndicateId` for every request but `found`
   * @returns {Promise<string|null>} the request key, or null if the outbox is full
   */
  async submit(actor, type, payload = {}) {
    if (pendingSyndicateRequests(actor).length >= OUTBOX_LIMIT) {
      ui.notifications.warn(L('NCI.Errors.OutboxFull'));
      return null;
    }
    const key = foundry.utils.randomID(16);
    this.submitted.add(key);
    await this._chain.run(async () => {
      await actor.setFlag(MODULE_ID, FLAGS.SYNDICATE_OUTBOX, [...syndicateOutbox(actor), { key, type, ...payload, ts: Date.now() }]);
    });
    if (!game.users.activeGM) ui.notifications.info(L('NCI.Notify.QueuedNoGM'));
    return key;
  }

  /** A terminal request for the syndicate's account, made by an officer. */
  trade(actor, syndicateId, type, payload = {}) {
    return this.submit(actor, 'trade', { syndicateId, request: { type, ...payload } });
  }

  /** Drop handled requests from the outbox. Only the owner writes it. */
  async prune(actor) {
    if (!actor.isOwner || (game.user.isGM && actor.hasPlayerOwner)) return;
    await this._chain.run(async () => {
      const done = new Set(syndicateReceipts(actor).processed);
      const current = syndicateOutbox(actor);
      const keep = current.filter((r) => !done.has(r.key));
      if (keep.length !== current.length) await actor.setFlag(MODULE_ID, FLAGS.SYNDICATE_OUTBOX, keep);
    });
  }
}

export const SyndicateClient = new SyndicateClientImpl();
