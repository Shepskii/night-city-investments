/**
 * Helpers
 * @file scripts/utils/helpers.js
 */

import { MODULE_ID, MODULE_SHORT, SETTINGS } from './constants.js';

export const log = {
  info: (...args) => console.log(`${MODULE_SHORT} |`, ...args),
  warn: (...args) => console.warn(`${MODULE_SHORT} |`, ...args),
  error: (...args) => console.error(`${MODULE_SHORT} |`, ...args),
  debug: (...args) => {
    try {
      if (game.settings?.get(MODULE_ID, SETTINGS.DEBUG_MODE)) console.debug(`${MODULE_SHORT} |`, ...args);
    } catch {
      // Setting not registered yet.
    }
  },
};

/** Localise a key, formatting it when there is data to fill in. */
export const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/**
 * A record saved in the one-write form (wrapped in a one-element array, so a save replaces it rather
 * than merging into it), or an older unwrapped one.
 */
export const unwrap = (stored) => (Array.isArray(stored) ? stored[0] : stored);

export function isGM() {
  return game.user?.isGM ?? false;
}

/** True only on the one GM client that should perform authoritative writes. */
export function isActiveGM() {
  return !!game.user?.isGM && game.user.id === game.users.activeGM?.id;
}
