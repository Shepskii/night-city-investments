/**
 * Syndicate cash: a syndicate's money going into and coming out of businesses (DESIGN §31, B3b).
 * @file scripts/services/SyndicateCash.js
 * @description The business service pays a character in eddies; a syndicate it pays in its brokerage
 *              account, through here. It runs in step with order processing, since the portfolio
 *              service writes the same account. Also values a syndicate's business stakes, which
 *              count in its NAV.
 */

import { freeCash, dayIndex, normalizeSyndicate, recordSpend, LEDGER_CAP } from '../engine/index.js';
import { HOOKS } from '../utils/constants.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { MarketClock } from './MarketClockService.js';
import { PortfolioService } from './PortfolioService.js';

export const SyndicateCash = {
  /** Is this id a syndicate's (and not a character's)? */
  isSyndicate(id) {
    return !!SyndicateRepository.get(id);
  },

  /** What a syndicate can spend now: its account's cash less what open buy orders hold. */
  available(id) {
    return freeCash(SyndicateRepository.portfolio(id));
  },

  /** A syndicate's stakes in businesses still open, at book value times its share. */
  stakesOf(id) {
    return BusinessRepository.stakesOf(id);
  },

  /**
   * Pay a syndicate (positive) or take from it (negative) for a business, with a line in its account's
   * ledger and in its own history. A payment an officer made counts against their daily limit.
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  pay(id, delta, { businessId = null, businessName = '', officerId = null } = {}) {
    const amount = Math.round(Number(delta) || 0);
    if (!amount) return Promise.resolve({ ok: true });
    return PortfolioService.exclusive(async () => {
      const syndicate = SyndicateRepository.get(id);
      if (!syndicate) return { ok: false, reason: 'no-syndicate' };
      const portfolio = SyndicateRepository.portfolio(id);
      if (amount < 0 && freeCash(portfolio) < -amount) return { ok: false, reason: 'insufficient-cash' };
      const tick = MarketStore.time();
      const next = {
        ...portfolio,
        cash: portfolio.cash + amount,
        ledger: [...portfolio.ledger, { ts: tick, kind: amount < 0 ? 'businessOut' : 'businessIn', assetId: null, qty: 0, amount, ref: businessId }].slice(-LEDGER_CAP),
      };
      const s = normalizeSyndicate(syndicate);
      const day = dayIndex(MarketClock.nowMs());
      s.ledger = [...s.ledger, { day, kind: amount < 0 ? 'businessOut' : 'businessIn', amount: Math.abs(amount), business: businessName }].slice(-120);
      if (officerId && amount < 0) recordSpend(s, officerId, day, -amount);
      await SyndicateRepository.save(s, next);
      Hooks.callAll(HOOKS.SYNDICATES_CHANGED, { syndicateId: id });
      return { ok: true };
    });
  },

  /** Note in a syndicate's history that a business request its members agreed could not be made. */
  noteFailed(id, { label = '', reason = '' } = {}) {
    return PortfolioService.exclusive(async () => {
      const syndicate = SyndicateRepository.get(id);
      if (!syndicate) return;
      const s = normalizeSyndicate(syndicate);
      s.ledger = [...s.ledger, { day: dayIndex(MarketClock.nowMs()), kind: 'businessFailed', business: label, reason }].slice(-120);
      await SyndicateRepository.save(s);
      Hooks.callAll(HOOKS.SYNDICATES_CHANGED, { syndicateId: id });
    });
  },
};
