/**
 * Syndicate watcher: tells players what happened to their syndicate requests and the syndicate's
 * orders, and windows to refresh.
 * @file scripts/services/SyndicateWatcher.js
 */

import { HOOKS, MODULE_ID, FLAGS } from '../utils/constants.js';
import { L, unwrap, isCharacter } from '../utils/helpers.js';
import { SyndicateClient, syndicateReceipts } from './SyndicateClient.js';
import { PortfolioWatcher } from './PortfolioWatcher.js';

export const SyndicateWatcher = {
  _seen: new Set(),
  _orderStatus: new Map(),

  /** Remember the results and order states already there, so only later ones are announced. */
  snapshot() {
    for (const actor of game.actors.filter((a) => isCharacter(a) && a.isOwner)) {
      syndicateReceipts(actor).results.forEach((r) => this._seen.add(r.key));
    }
    for (const journal of game.journal.filter((j) => j.getFlag(MODULE_ID, FLAGS.SYNDICATE))) {
      for (const o of unwrap(journal.getFlag(MODULE_ID, FLAGS.PORTFOLIO))?.orders ?? []) this._orderStatus.set(o.id, o.status);
    }
  },

  /** Hook for `updateActor` on every client. */
  onActorUpdate(actor, changes) {
    const flags = `flags.${MODULE_ID}`;
    if (!foundry.utils.hasProperty(changes, `${flags}.${FLAGS.SYNDICATE_RECEIPTS}`) && !foundry.utils.hasProperty(changes, `${flags}.${FLAGS.SYNDICATE_OUTBOX}`)) return;
    Hooks.callAll(HOOKS.SYNDICATES_CHANGED, { actorId: actor.id });
    if (!actor.isOwner) return;
    SyndicateClient.prune(actor);
    for (const result of syndicateReceipts(actor).results) {
      if (this._seen.has(result.key)) continue;
      this._seen.add(result.key);
      if (SyndicateClient.submitted.has(result.key)) this._announce(result);
    }
  },

  /** Hook for journal changes on every client: a syndicate came, went or changed, or one of its orders moved. */
  onJournal(journal, changes) {
    const isSyndicate = journal?.getFlag?.(MODULE_ID, FLAGS.SYNDICATE) || foundry.utils.hasProperty(changes ?? {}, `flags.${MODULE_ID}.${FLAGS.SYNDICATE}`);
    if (!isSyndicate) return;
    Hooks.callAll(HOOKS.SYNDICATES_CHANGED, { journalId: journal.id });
    Hooks.callAll(HOOKS.PORTFOLIO_UPDATED, unwrap(journal.getFlag(MODULE_ID, FLAGS.SYNDICATE))?.id);
    // Members hear about the syndicate's fills as they do about their own; the GM is told about none.
    if (game.user.isGM || !changes) return;
    for (const order of unwrap(journal.getFlag(MODULE_ID, FLAGS.PORTFOLIO))?.orders ?? []) {
      const before = this._orderStatus.get(order.id);
      this._orderStatus.set(order.id, order.status);
      if (before !== undefined && before !== order.status) PortfolioWatcher._announceOrder(order);
    }
  },

  _announce(result) {
    // A proposal the request made or voted on: still open for the members, or settled there and then.
    if (result.ok && result.proposal === 'proposalPassed') return ui.notifications.info(L('NCI.Syndicate.Settled.passed'));
    if (result.ok && result.proposal === 'proposalFailed') return ui.notifications.info(L('NCI.Syndicate.Settled.failed'));
    if (result.ok && result.proposal === 'proposalVoid') return ui.notifications.warn(L('NCI.Syndicate.Settled.void', { reason: L(`NCI.Syndicate.Reason.${result.proposalReason}`) }));
    if (result.ok && result.proposal === 'open' && result.type !== 'propose') return ui.notifications.info(L('NCI.Syndicate.Settled.open'));
    if (result.inner) return PortfolioWatcher._announceResult(result.inner);
    if (result.ok) return ui.notifications.info(L(`NCI.Syndicate.Done.${result.type}`));
    return ui.notifications.warn(L('NCI.Syndicate.Refused', { reason: L(`NCI.Syndicate.Reason.${result.reason}`) }));
  },
};
