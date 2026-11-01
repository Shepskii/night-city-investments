/**
 * Starter factions: Night City's gangs by district, using Night City Map's district ids, and the
 * market's starter corporations. Starting points: the GM can edit or remove any of them.
 * @file scripts/data/starter-factions.js
 */

import { STARTER_COMPANIES } from './starter-companies.js';

const gang = (id, name, districts) => ({ id: `gang_${id}`, name, kind: 'gang', districts });

export const STARTER_GANGS = [
  gang('tyger', 'Tyger Claws', ['watson', 'japan', 'china']),
  gang('voodoo', 'Voodoo Boys', ['watson', 'japan', 'heywood']),
  gang('sixth', '6th Street', ['watson', 'westbrook', 'europe', 'glen', 'heywood']),
  gang('primetime', 'Prime Time Players', ['westbrook', 'uni', 'heywood']),
  gang('scavs', 'Scavengers', ['oldcc', 'oldcorp', 'bank', 'med', 'hind', 'rancho']),
  gang('maelstrom', 'Maelstrom', ['oldcc', 'oldcorp', 'south', 'ocz']),
  gang('inquisitors', 'Inquisitors', ['oldcc', 'ocz']),
  gang('ironsights', 'Iron Sights', ['bank', 'south']),
  gang('renegades', 'Renegades', ['med', 'ocz', 'rancho', 'pacifica']),
  gang('piranhas', 'Piranhas', ['marina', 'uni', 'china', 'pacifica']),
  gang('vampyres', 'Philharmonic Vampyres', ['marina', 'europe']),
  gang('redchrome', 'Red Chrome Legion', ['south', 'pacifica']),
  gang('vaqueros', 'Steel Vaqueros', ['hind']),
];

/** The whole starter list: the gangs, and a corporate faction for each starter company. */
export const starterFactions = () => [
  ...STARTER_COMPANIES.map((c) => ({ id: `corp_${c.ticker.toLowerCase()}`, name: c.name, kind: 'corp', ticker: c.ticker, aliases: c.aliases ?? [] })),
  ...STARTER_GANGS,
];
