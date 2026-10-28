/**
 * Macro service: creates the starter macros in the world.
 * @file scripts/services/MacroService.js
 * @description Macros are created as ordinary world macros the GM can edit, move or delete. Foundry's
 *              default permissions only let Trusted players and above run script macros, so the
 *              terminal macro is for those players; everyone else uses the scene-control button.
 */

import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { L } from '../utils/helpers.js';


export const MACROS = Object.freeze([
  { key: 'terminal', img: 'icons/svg/coins.svg', everyone: true, command: 'game.nightcity.investments.open();' },
  { key: 'business', img: 'icons/svg/house.svg', everyone: true, command: 'game.nightcity.investments.openBusiness();' },
  { key: 'console', img: 'icons/svg/cog.svg', everyone: false, command: 'game.nightcity.investments.openGM();' },
  {
    key: 'advance',
    img: 'icons/svg/clockwork.svg',
    everyone: false,
    command: "if (!game.user.isGM) return ui.notifications.warn('GM only');\nawait game.nightcity.investments.market.advance(1);",
  },
  { key: 'check', img: 'icons/svg/eye.svg', everyone: false, command: 'await game.nightcity.investments.verify();' },
]);

export const MacroService = {
  /** The macro this module made for `key`, if it is still in the world. */
  find(key) {
    return game.macros?.find((m) => m.getFlag(MODULE_ID, FLAGS.MACRO) === key) ?? null;
  },

  /**
   * GM only. Create each starter macro that is not there yet.
   * @returns {Promise<{created: number, skipped: number}>}
   */
  async createDefaults() {
    if (!game.user.isGM) return { created: 0, skipped: 0 };
    const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    let created = 0;
    let skipped = 0;
    for (const def of MACROS) {
      if (this.find(def.key)) {
        skipped++;
        continue;
      }
      await Macro.create({
        name: L(`NCI.Macros.${def.key}`),
        type: 'script',
        scope: 'global',
        img: def.img,
        command: def.command,
        ownership: { default: def.everyone ? levels.OBSERVER : levels.NONE },
        flags: { [MODULE_ID]: { [FLAGS.MACRO]: def.key } },
      });
      created++;
    }
    return { created, skipped };
  },
};
