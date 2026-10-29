/**
 * Network watcher: a player who leaves CorpNet in Night City Messenger loses their direct-trading
 * session.
 * @file scripts/services/NetworkWatcher.js
 * @description Runs on each player's client, because only that client knows which network it is on.
 *              When the client is no longer on CorpNet (or no longer signed in to it), every live
 *              session on the user's own accounts that came from the network is ended with a
 *              `disconnectTerminal` request. A session the GM granted is not tied to the network and
 *              stays. A syndicate's session ends when the officer who opened it leaves.
 */

import { sessionActive } from '../engine/index.js';
import { log } from '../utils/helpers.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { NcmAdapter } from '../integrations/NcmAdapter.js';
import { TradingSettings } from './TradingSettings.js';
import { TerminalAccess } from './TerminalAccess.js';
import { PortfolioClient } from './PortfolioClient.js';
import { SyndicateClient, pendingSyndicateRequests } from './SyndicateClient.js';

/** A session this client should end: live, opened through the network, and not already being ended. */
const networkSession = (portfolio, tick) => sessionActive(portfolio, tick) && portfolio.session.source !== 'grant';

export const NetworkWatcher = {
  /** Start listening to NCM's network changes, and check once now. */
  start() {
    if (NcmAdapter.onNetworkChange(() => this.check())) this.check();
  },

  /** The characters whose sessions this user answers for: their own (a GM only those no player owns). */
  _characters() {
    return game.actors.filter((a) => a.type === 'character' && a.isOwner && !(game.user.isGM && a.hasPlayerOwner));
  },

  /** End every network session on the user's accounts if this client is off CorpNet. */
  async check() {
    try {
      if (TradingSettings.mode() !== 'terminal') return;
      const claim = TerminalAccess.claim();
      if (claim.ok) return;
      const tick = MarketStore.time();
      for (const actor of this._characters()) {
        const mine = PortfolioRepository.get(actor);
        const asking = PortfolioRepository.pending(actor).some((r) => r.type === 'disconnectTerminal');
        if (networkSession(mine, tick) && !asking) await PortfolioClient.submit(actor, 'disconnectTerminal', { reason: claim.reason });

        for (const s of SyndicateRepository.forActor(actor.id).filter((x) => x.status === 'active')) {
          const theirs = SyndicateRepository.portfolio(s.id);
          if (!networkSession(theirs, tick) || theirs.session.by !== actor.id) continue;
          const queued = pendingSyndicateRequests(actor).some((r) => r.syndicateId === s.id && r.request?.type === 'disconnectTerminal');
          if (!queued) await SyndicateClient.trade(actor, s.id, 'disconnectTerminal', { reason: claim.reason });
        }
      }
    } catch (error) {
      log.warn('Checking the CorpNet connection failed', error);
    }
  },
};
