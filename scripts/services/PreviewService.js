/**
 * Preview service: runs the Monte-Carlo preview for a planned control. GM client only.
 * @file scripts/services/PreviewService.js
 */

import { mergeState, previewScenario } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';
import { isActiveGM } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { MarketStore } from '../data/MarketStore.js';

export const PreviewService = {
  /**
   * @param {{kind: 'bias'|'shock'|'glide'}} scenario - see engine/preview.js
   * @param {number} [days] - how far ahead to look
   * @returns {{ok: boolean, reason?: string}} the cone for the scenario and for doing nothing
   */
  run(scenario, days = 30) {
    if (!isActiveGM()) return { ok: false, reason: 'not-active-gm' };
    const pub = MarketStore.getPublic();
    if (!pub.schema) return { ok: false, reason: 'no-market' };
    return previewScenario({
      state: mergeState(pub, MarketStore.getHidden()),
      companies: CompanyRepository.all({ includeUnlisted: true }),
      seed: game.settings.get(MODULE_ID, SETTINGS.WORLD_SEED) || 'nci',
      controls: MarketStore.getControls(),
      scenario,
      ticks: days,
    });
  },
};
