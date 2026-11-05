/**
 * Districts from Night City Map
 * @file scripts/services/DistrictService.js
 * @description The module has its own districts, with numbers tuned for them, and works without the map. With the map
 *              active, what can be chosen follows the map, and a district new to this module is remembered in a world
 *              setting with numbers from its danger. It is never forgotten, so a business in a district the map has
 *              since lost keeps its name and numbers. Every client reads the setting; only the GM writes it.
 */

import { DISTRICTS, cleanDistrictNumbers, districtIds, isDistrict, mergeMapDistricts, setExtraDistricts } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';
import { isActiveGM, log } from '../utils/helpers.js';

const MAP_ID = 'night-city-map';

/** The map's built-in districts: it has no API for them, so they come from its data file. */
let builtIn = null;
let queue = Promise.resolve();

const mapActive = () => game.modules?.get?.(MAP_ID)?.active === true;

const read = () => {
  const stored = game.settings.get(MODULE_ID, SETTINGS.DISTRICT_DEFS) ?? {};
  return Object.fromEntries(Object.entries(stored).filter(([, d]) => Number.isFinite(d?.traffic)));
};

export const DistrictService = {
  /** Make the remembered districts known to the engine, then read the map's own. */
  async load() {
    setExtraDistricts(read());
    if (!mapActive()) return;
    try {
      builtIn = (await import(foundry.utils.getRoute(`modules/${MAP_ID}/scripts/data.js`))).DISTRICTS ?? [];
    } catch (error) {
      log.warn('Could not read the districts of Night City Map; its built-in ones stay as this module knows them', error);
    }
  },

  /** The districts the map has now: the GM's own, if they are on, or its built-in ones. Null without the map. */
  mapDistricts() {
    if (!mapActive()) return null;
    let geo = null;
    try {
      geo = game.settings.get(MAP_ID, 'state')?.geo;
    } catch {
      return null;
    }
    return geo?.on ? geo.districts ?? [] : builtIn;
  },

  /** GM: remember what is new on the map. Runs often, as the map saves everything in one setting, and writes only on a change. */
  sync() {
    if (!isActiveGM()) return Promise.resolve();
    queue = queue.then(async () => {
      const list = this.mapDistricts();
      if (!list) return;
      const { defs, changed } = mergeMapDistricts(read(), list);
      if (changed) await game.settings.set(MODULE_ID, SETTINGS.DISTRICT_DEFS, defs);
    }).catch((error) => log.error('Could not update the districts from Night City Map', error));
    return queue;
  },

  /** The districts a new business may choose: the map's, or this module's own without it. Water is no place for a shop. */
  offered() {
    const list = this.mapDistricts();
    return list ? list.filter((d) => d.danger !== 0 && isDistrict(d.id)).map((d) => d.id) : Object.keys(DISTRICTS);
  },

  /** A district's name, wherever it came from; '' for none. */
  name(id) {
    if (!id) return '';
    if (Object.hasOwn(DISTRICTS, id)) return game.i18n.localize(`NCI.District.${id}`);
    return read()[id]?.name ?? '';
  },

  /** Each id, with the name of those that came from the map, for the GM typing a faction's turf. */
  idList() {
    return districtIds().map((id) => (Object.hasOwn(DISTRICTS, id) ? id : `${id} (${this.name(id)})`)).join(', ');
  },

  /** The districts that came from the map, for the GM to adjust. */
  rows() {
    const on = new Set((this.mapDistricts() ?? []).map((d) => d.id));
    return Object.values(read()).map((d) => ({ ...d, onMap: on.has(d.id) })).sort((a, b) => a.name.localeCompare(b.name));
  },

  /** GM: set a district's numbers. The map's later changes of danger leave them alone. */
  async saveNumbers(id, numbers) {
    const defs = read();
    if (!game.user.isGM || !defs[id]) return { ok: false };
    await game.settings.set(MODULE_ID, SETTINGS.DISTRICT_DEFS, { ...defs, [id]: { ...defs[id], ...cleanDistrictNumbers(numbers), edited: true } });
    return { ok: true };
  },
};
