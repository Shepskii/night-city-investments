/**
 * Undo service: step the market back one tick. GM client only.
 * @file scripts/services/UndoService.js
 */

import { movedMoneySince } from '../engine/index.js';
import { isActiveGM } from '../utils/helpers.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { TickService } from './TickService.js';
import { PortfolioService } from './PortfolioService.js';

export const UndoService = {
  /** Is there a tick to undo? */
  available() {
    return isActiveGM() && TickService.undoAvailable();
  },

  /** Has a player's money moved because of this tick (a fill, a dividend, a paid withdrawal)? */
  async isSettled(tickIndex) {
    await PortfolioService._queue;
    return PortfolioRepository.accounts()
      .filter((a) => PortfolioRepository.hasPortfolio(a))
      .some((a) => movedMoneySince(PortfolioRepository.get(a), tickIndex));
  },

  /**
   * Undo the last tick, unless a player's money has already moved because of it (a fill, a dividend
   * or a paid withdrawal). In that case the answer is `settled` and nothing changes.
   * @returns {Promise<{ok: boolean, reason?: 'not-active-gm'|'nothing-to-undo'|'settled', tickIndex?: number}>}
   */
  undo() {
    return TickService.undoLastTick((tickIndex) => this.isSettled(tickIndex));
  },
};
