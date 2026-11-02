/**
 * The windows' colours
 * @file scripts/core/theme.js
 * @description A player can match Pneuma's Visual Tools. That module publishes its skin as CSS variables and
 *              `data-pvt-base`, and the stylesheet reads them under the class set here. So whichever skin and colours
 *              a player has, or none, shows with no more to do here, and no colours of theirs are copied.
 */

import { MODULE_ID, SETTINGS } from '../utils/constants.js';

export const VISUAL_TOOLS_ID = 'pneuma-visualtools';
export const THEMES = Object.freeze({ nightCity: 'nightCity', visualTools: 'visualTools' });

export const visualToolsActive = () => !!game.modules?.get(VISUAL_TOOLS_ID)?.active;

/** Whether this client's windows should follow Pneuma's Visual Tools: it must be chosen, and the module there. */
export const matchesVisualTools = () => visualToolsActive() && game.settings.get(MODULE_ID, SETTINGS.THEME) === THEMES.visualTools;

export function applyTheme() {
  globalThis.document?.documentElement?.classList.toggle('nci-theme-pvt', matchesVisualTools());
}
