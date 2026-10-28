/**
 * Terminal access: can a character use a CorpNet terminal to trade directly?
 * @file scripts/services/TerminalAccess.js
 * @description Direct trading needs two things: a terminal with CorpNet access, then a passed
 *              Accounting check.
 *
 *   Access, either of:
 *     - the player's client is connected to (and signed in to) the CorpNet network in Night City
 *       Messenger. NCM keeps that in browser memory, so it is read on the player's client and sent
 *       with the request; the GM cannot verify it, which is the usual table-trust trade-off.
 *     - the GM has granted the character terminal access (a flag only the GM can set), for scenes
 *       that have a terminal but no NCM network, or to overrule NCM.
 *
 *   The check is rolled by the player, on their own client, when they press Connect (the chat card
 *   is the record). The GM's executor reads the dice back from that card and uses its own stat,
 *   skill level and DV, so a request cannot supply a total. No card means no check.
 */

import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { lockedOut, sessionActive } from '../engine/index.js';
import { NcmAdapter } from '../integrations/NcmAdapter.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { SkillAdapter } from './SkillAdapter.js';
import { TradingSettings } from './TradingSettings.js';

export const TerminalAccess = {
  /**
   * Player side: describe this client's access right now, to attach to a connect request and to
   * show in the window. Never trusted for the roll, only for the claim of being on the network.
   * @returns {{ok: boolean, reason?: string, network: string, on: boolean, authenticated: boolean}}
   */
  claim() {
    const network = TradingSettings.direct().network;
    const state = NcmAdapter.networkState(network);
    if (!state.known) return { ok: false, reason: 'no-network', network, on: false, authenticated: false };
    if (!state.on) return { ok: false, reason: 'no-network', network, on: false, authenticated: state.authenticated };
    if (state.requiresAuth && !state.authenticated) return { ok: false, reason: 'not-authenticated', network, on: true, authenticated: false };
    return { ok: true, network, on: true, authenticated: state.authenticated };
  },

  /** Has the GM granted this character terminal access? */
  granted(actor) {
    return !!actor?.getFlag?.(MODULE_ID, FLAGS.GRANT);
  },

  /** GM only. */
  async setGrant(actor, on) {
    if (!game.user.isGM) return false;
    if (on) await actor.setFlag(MODULE_ID, FLAGS.GRANT, true);
    else await actor.unsetFlag(MODULE_ID, FLAGS.GRANT);
    return true;
  },

  /**
   * Player side: roll the Accounting check for a connect request, but only when it can matter: a
   * terminal is required, this character has access, and they are neither locked out nor already in
   * a session (judged on their own view, which the GM re-checks). Returns the roll card's id, or
   * null when no roll is made, in which case the request goes without one and the GM explains why.
   * @param {Actor} actor
   * @param {{ok: boolean}} claim - from `claim()`
   * @returns {Promise<string|null>}
   */
  async roll(actor, claim) {
    if (TradingSettings.mode() !== 'terminal') return null;
    if (!(this.granted(actor) || claim?.ok === true)) return null;
    const portfolio = PortfolioRepository.get(actor);
    const tick = MarketStore.time();
    if (lockedOut(portfolio, tick) || sessionActive(portfolio, tick)) return null;
    const { messageId } = await SkillAdapter.check(actor, { dv: TradingSettings.direct().dv });
    return messageId;
  },

  /**
   * GM side: build the executor's `checks` entry for one connect request: decide whether the
   * character has access, and if so read the player's roll back from its chat card.
   * @param {Actor} actor
   * @param {object} request - a connectTerminal request; `request.claim` is the player's access claim
   */
  async buildCheck(actor, request) {
    const dv = TradingSettings.direct().dv;

    let access;
    if (this.granted(actor)) access = { ok: true, source: 'grant' };
    else if (request.claim?.ok === true) access = { ok: true, source: 'network' };
    else access = { ok: false, reason: request.claim?.reason ?? 'no-network' };

    if (!access.ok) return { access };

    const verified = await SkillAdapter.verify(actor, request, { dv });
    if (!verified.ok) return { access: { ok: false, reason: verified.reason } };
    return { access, stat: verified.stat, level: verified.level, dv: verified.dv, roll: verified.roll };
  },
};
