/**
 * Trading settings: one place that reads the GM's trading rules.
 * @file scripts/services/TradingSettings.js
 */

import { directTerms } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';

const get = (key) => game.settings.get(MODULE_ID, key);

export const TradingSettings = {
  /** 'terminal' (direct trades need a CorpNet terminal session) or 'open' (anyone may trade directly). */
  mode() {
    return get(SETTINGS.DIRECT_MODE) === 'open' ? 'open' : 'terminal';
  },

  /** The direct-trading terms, normalised (commission, flat fee, DV, session and lockout lengths, network). */
  direct() {
    return directTerms({
      commissionBps: get(SETTINGS.DIRECT_COMMISSION_BPS),
      flatFee: get(SETTINGS.DIRECT_FLAT_FEE),
      dv: get(SETTINGS.CORPNET_DV),
      sessionTicks: get(SETTINGS.SESSION_TICKS),
      lockoutTicks: get(SETTINGS.LOCKOUT_TICKS),
      network: get(SETTINGS.CORPNET_NETWORK),
    });
  },

  /** Only used in 'open' mode: do direct orders fill at once or at the next tick? */
  openInstant() {
    return get(SETTINGS.DIRECT_EXECUTION) === 'instant';
  },

  depositFee() {
    return Number(get(SETTINGS.DEPOSIT_FEE)) || 0;
  },

  /** Days a sale's proceeds take to become spendable (0: at once). */
  settlementDays() {
    return Math.max(0, Math.floor(Number(get(SETTINGS.SETTLEMENT_DAYS)) || 0));
  },

  seed() {
    return get(SETTINGS.WORLD_SEED) || 'nci';
  },

  /** The `settings` object the pure executor takes, without brokers or checks. */
  forExecutor() {
    const direct = this.direct();
    return {
      mode: this.mode(),
      depositFee: this.depositFee(),
      settlementDays: this.settlementDays(),
      direct: { commissionBps: direct.commissionBps, flatFee: direct.flatFee },
      access: { sessionTicks: direct.sessionTicks, lockoutTicks: direct.lockoutTicks },
      instant: this.openInstant(),
      seed: this.seed(),
    };
  },
};
