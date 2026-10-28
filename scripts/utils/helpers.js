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

export function isGM() {
  return game.user?.isGM ?? false;
}

/** True only on the one GM client that should perform authoritative writes. */
export function isActiveGM() {
  return !!game.user?.isGM && game.user.id === game.users.activeGM?.id;
}
