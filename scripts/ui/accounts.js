/**
 * Trading accounts for the windows: a user's characters, and the syndicates those characters belong
 * to (DESIGN §30).
 * @file scripts/ui/accounts.js
 * @description A syndicate is traded "as" one of its members, so the picker's value for it is
 *              `syn:<syndicateId>:<actorId>`. The account it gives behaves like an actor for reading:
 *              the portfolio is the syndicate's own, and preferences (watchlist, notifications) are the
 *              member's. Writes go through PortfolioClient, which sends them as syndicate requests.
 */

import { memberOf } from '../engine/index.js';
import { FLAGS } from '../utils/constants.js';
import { L } from '../utils/helpers.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';

const PREFIX = 'syn:';

export const syndicateKey = (syndicateId, actorId) => `${PREFIX}${syndicateId}:${actorId}`;

/** A syndicate's account, seen through one of its members. Null unless that member is active in it. */
export function memberAccount(syndicateId, actorId) {
  const account = SyndicateRepository.account(syndicateId);
  const as = game.actors.get(actorId);
  if (!account || !as || memberOf(account.syndicate, actorId)?.status !== 'active') return null;
  return {
    ...account,
    as,
    key: syndicateKey(syndicateId, actorId),
    isOfficer: memberOf(account.syndicate, actorId).role === 'officer',
    getFlag: (scope, key) => (key === FLAGS.PREFS ? as.getFlag(scope, key) : account.journal.getFlag(scope, key)),
  };
}

/** A character, or a syndicate as one of its members, from a picker value. */
export function accountFor(id) {
  if (!id) return null;
  if (!String(id).startsWith(PREFIX)) return game.actors.get(id) ?? null;
  const [syndicateId, actorId] = String(id).slice(PREFIX.length).split(':');
  return memberAccount(syndicateId, actorId);
}

/** The accounts a user can pick: their characters first, then each active syndicate they trade for. */
export function tradingAccounts() {
  const characters = PortfolioRepository.actors();
  const syndicates = [];
  for (const actor of characters) {
    for (const s of SyndicateRepository.forActor(actor.id)) {
      if (s.status !== 'active' || memberOf(s, actor.id)?.status !== 'active') continue;
      syndicates.push({ id: syndicateKey(s.id, actor.id), name: L('NCI.Syndicate.PickerLabel', { name: s.name, as: actor.name }), isSyndicate: true });
    }
  }
  return [...characters.map((a) => ({ id: a.id, name: a.name, isSyndicate: false })), ...syndicates];
}

/**
 * The accounts the Business window offers: the given characters, then each active syndicate one of
 * them belongs to. Only officers act for a syndicate in a business (DESIGN §30, B3b); other members
 * see its businesses read-only.
 */
export function businessAccounts(characters) {
  const syndicates = [];
  for (const actor of characters) {
    for (const s of SyndicateRepository.forActor(actor.id)) {
      const me = memberOf(s, actor.id);
      if (s.status !== 'active' || me?.status !== 'active') continue;
      syndicates.push({ id: syndicateKey(s.id, actor.id), name: L('NCI.Syndicate.PickerLabel', { name: s.name, as: actor.name }), isSyndicate: true });
    }
  }
  return [...characters.map((a) => ({ id: a.id, name: a.name, isSyndicate: false })), ...syndicates];
}

/** The character behind an account: itself, or the member a syndicate is traded as. */
export const ownerOf = (account) => (account?.isSyndicate ? account.as : account);
