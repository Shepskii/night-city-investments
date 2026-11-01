/**
 * Faction repository
 * @file scripts/data/FactionRepository.js
 * @description The GM's list of factions (F1a), in a world setting every client can read: a player's
 *              window needs the names. Standing itself is on each business and in the GM's hidden state.
 */

import { normalizeFaction } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';
import { starterFactions } from './starter-factions.js';

const read = () => game.settings.get(MODULE_ID, SETTINGS.FACTION_DEFS) ?? {};

export const FactionRepository = {
  /** Every faction, by name within kind: corporations, then gangs, then the rest. */
  list() {
    const order = { corp: 0, gang: 1, other: 2 };
    return Object.values(read()).map(normalizeFaction).sort((a, b) => (order[a.kind] - order[b.kind]) || a.name.localeCompare(b.name));
  },

  get(id) {
    const f = read()[id];
    return f ? normalizeFaction(f) : null;
  },

  /** GM only: add a faction, or change one (with its `id`). A name is required. */
  async save(input) {
    if (!game.user.isGM) return { ok: false };
    const faction = normalizeFaction({ ...input, id: input.id || `fac_${foundry.utils.randomID(10)}` });
    if (!faction.name) return { ok: false, reason: 'no-name' };
    await game.settings.set(MODULE_ID, SETTINGS.FACTION_DEFS, { ...read(), [faction.id]: faction });
    return { ok: true, faction };
  },

  /** GM only. Standing already recorded with it stays out of sight until it is added back. */
  async remove(id) {
    if (!game.user.isGM) return { ok: false };
    const defs = { ...read() };
    delete defs[id];
    await game.settings.set(MODULE_ID, SETTINGS.FACTION_DEFS, defs);
    return { ok: true };
  },

  /** GM only: add the starter factions a world does not have yet; existing ones are left as they are. */
  async importStarter() {
    if (!game.user.isGM) return { ok: false };
    const defs = { ...read() };
    let created = 0;
    for (const f of starterFactions()) {
      if (defs[f.id]) continue;
      defs[f.id] = normalizeFaction(f);
      created++;
    }
    await game.settings.set(MODULE_ID, SETTINGS.FACTION_DEFS, defs);
    return { ok: true, created };
  },
};
