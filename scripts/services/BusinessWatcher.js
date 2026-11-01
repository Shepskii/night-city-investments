/**
 * Business watcher: tells players what happened to their business requests, and windows to refresh.
 * @file scripts/services/BusinessWatcher.js
 */

import { HOOKS, MODULE_ID, FLAGS } from '../utils/constants.js';
import { L, isCharacter } from '../utils/helpers.js';
import { BusinessClient, receiptsOf } from './BusinessClient.js';

export const BusinessWatcher = {
  _seen: new Set(),

  /** Remember the results already there, so only later ones are announced. */
  snapshot() {
    for (const actor of game.actors.filter((a) => isCharacter(a) && a.isOwner)) {
      receiptsOf(actor).results.forEach((r) => this._seen.add(r.key));
    }
  },

  /** Hook for `updateActor` on every client. */
  onActorUpdate(actor, changes) {
    const flags = `flags.${MODULE_ID}`;
    if (![FLAGS.BUSINESS_RECEIPTS, FLAGS.BUSINESS_OUTBOX, FLAGS.JOBS].some((f) => foundry.utils.hasProperty(changes, `${flags}.${f}`))) return;
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { actorId: actor.id });
    if (!actor.isOwner) return;
    BusinessClient.prune(actor);
    for (const result of receiptsOf(actor).results) {
      if (this._seen.has(result.key)) continue;
      this._seen.add(result.key);
      if (BusinessClient.submitted.has(result.key)) this._announce(result);
    }
  },

  /** Hook for journal changes on every client: a business record came, went or changed. */
  onJournal(journal, changes) {
    const isBusiness = journal?.getFlag?.(MODULE_ID, FLAGS.BUSINESS) || foundry.utils.hasProperty(changes ?? {}, `flags.${MODULE_ID}.${FLAGS.BUSINESS}`);
    if (isBusiness) Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { journalId: journal.id });
  },

  _announce(result) {
    const settled = result.ok ? result.proposal : null;
    if (settled?.outcome === 'passed') ui.notifications.info(L(`NCI.Business.Settled.${settled.detail ?? settled.kind}`));
    else if (settled?.outcome === 'failed') ui.notifications.info(L('NCI.Business.Settled.failed'));
    else if (settled?.outcome === 'void') ui.notifications.warn(L('NCI.Business.Settled.void', { reason: L(`NCI.Business.Reason.${settled.reason}`) }));
    // An investigation says whether it found anything; what it found comes by mail (B6d).
    else if (result.ok && result.investigation) ui.notifications.info(L(result.investigation.success ? 'NCI.Ownership.Found' : 'NCI.Ownership.NotFound'));
    else if (result.ok) ui.notifications.info(L(`NCI.Business.Done.${result.type}`));
    else ui.notifications.warn(L('NCI.Business.Refused', { reason: L(`NCI.Business.Reason.${result.reason}`) }));
  },
};
