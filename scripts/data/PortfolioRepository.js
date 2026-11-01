/**
 * Portfolio repository: portfolios live in actor flags.
 * @file scripts/data/PortfolioRepository.js
 * @description
 *   flags.<module>.portfolio  written only by the GM executor
 *   flags.<module>.outbox     written only by the owning player (requests for the GM)
 *   flags.<module>.prefs      player-owned preferences (watchlist)
 */

import { normalizePortfolio } from '../engine/index.js';
import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { SyndicateRepository } from './SyndicateRepository.js';
import { unwrap, isCharacter } from '../utils/helpers.js';

const clone = (v) => foundry.utils.deepClone(v);

// The portfolio is stored wrapped in a one-element array (read back with `unwrap`), so a save replaces
// it outright instead of being merged into the old one. An unwrapped portfolio is from before v0.9.7.

export const PortfolioRepository = {
  get(actor) {
    return normalizePortfolio(this.raw(actor));
  },

  /** The stored portfolio as it is, before normalising, or null. */
  raw(actor) {
    const stored = unwrap(actor?.getFlag(MODULE_ID, FLAGS.PORTFOLIO));
    return stored ? clone(stored) : null;
  },

  hasPortfolio(actor) {
    return !!unwrap(actor?.getFlag(MODULE_ID, FLAGS.PORTFOLIO));
  },

  /** Every request the player has submitted that the executor has not handled yet. */
  pending(actor) {
    const processed = new Set(this.get(actor).processed);
    return this.outbox(actor).filter((r) => !processed.has(r.key));
  },

  outbox(actor) {
    return clone(actor?.getFlag(MODULE_ID, FLAGS.OUTBOX) ?? []);
  },

  /** GM executor only. */
  save(actor, portfolio) {
    return actor.setFlag(MODULE_ID, FLAGS.PORTFOLIO, [portfolio]);
  },

  watchlist(actor) {
    return clone(actor?.getFlag(MODULE_ID, FLAGS.PREFS)?.watchlist ?? []);
  },

  /**
   * Characters this user can work with. Players get the ones they own. A GM gets the player-owned
   * characters, or every character if none has an owner yet (so the GM can still try things out).
   */
  actors() {
    const characters = game.actors.filter((a) => isCharacter(a));
    const usable = game.user.isGM
      ? characters.filter((a) => a.hasPlayerOwner)
      : characters.filter((a) => a.testUserPermission(game.user, 'OWNER'));
    const list = game.user.isGM && !usable.length ? characters : usable;
    return list.sort((a, b) => a.name.localeCompare(b.name));
  },

  /**
   * Every account the market keeps: the characters, and each active syndicate (DESIGN §30). This is
   * the list the GM's services go through after a tick, for dividends, IPOs, heat and the like.
   */
  accounts() {
    return [...game.actors.filter((a) => isCharacter(a)), ...SyndicateRepository.accounts()];
  },

  /** A character or a syndicate, by id. */
  accountOf(id) {
    return game.actors.get(id) ?? SyndicateRepository.account(id);
  },

  /** The user's assigned character, or the first they can use. */
  defaultActor() {
    const list = this.actors();
    return list.find((a) => a.id === game.user.character?.id) ?? list.find((a) => a.hasPlayerOwner) ?? list[0] ?? null;
  },
};
