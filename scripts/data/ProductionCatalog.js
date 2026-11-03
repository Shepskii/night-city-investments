/**
 * Production catalog
 * @file scripts/data/ProductionCatalog.js
 * @description What each kind of business can make (P1a, DESIGN §36.10): the system's core compendiums read against
 *              the engine's defaults, with the GM's own changes in a world setting every client can read.
 */

import { ARCHETYPES, madeByDefault } from '../engine/index.js';
import { BusinessRepository } from './BusinessRepository.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';

/** The core compendiums the defaults come from. Anything else, the GM adds by hand. */
const PACKS = Object.freeze(['weapons', 'ammo', 'upgrades', 'cyberware', 'drugs', 'programs', 'gear', 'clothing']);
const FIELDS = Object.freeze(['system.price.market', 'system.type']);

const read = () => game.settings.get(MODULE_ID, SETTINGS.PRODUCTION_CATALOG) ?? {};
const write = (next) => game.settings.set(MODULE_ID, SETTINGS.PRODUCTION_CATALOG, next);
const entryOf = (data, archetype) => ({ added: [], removed: [], ...(data[archetype] ?? {}) });

let index = null;
let loading = null;

/** A compendium or world item as a row on the list. */
const rowOf = (uuid, item) => ({
  uuid,
  name: String(item.name ?? ''),
  type: item.type,
  // An upgrade says what it goes on: a garage's are for vehicles, a gun shop's for weapons.
  kind: item.system?.type ?? '',
  img: String(item.img ?? ''),
  price: Number(item.system?.price?.market) || 0,
});

export const ProductionCatalog = {
  /** Read the compendiums, once. Anything that wants the list awaits this first. */
  load() {
    if (index) return Promise.resolve(index);
    loading ??= (async () => {
      const rows = [];
      for (const name of PACKS) {
        const pack = game.packs?.get?.(`cyberpunk-red-core.core_${name}`);
        if (!pack) continue;
        for (const e of await pack.getIndex({ fields: [...FIELDS] })) {
          const row = rowOf(e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, e);
          if (row.price > 0) rows.push(row);
        }
      }
      index = rows;
      return rows;
    })();
    return loading;
  },

  /** A business type's list, cheapest first: the defaults the GM kept, then what they added; each says if it is illegal. */
  list(archetype) {
    const data = read();
    const { added, removed } = entryOf(data, archetype);
    const illegal = new Set(data.illegal ?? []);
    const seen = new Set(removed);
    const rows = [];
    for (const row of [...added, ...(index ?? []).filter((r) => madeByDefault(archetype, r))]) {
      if (seen.has(row.uuid)) continue;
      seen.add(row.uuid);
      rows.push({ ...row, illegal: illegal.has(row.uuid) });
    }
    return rows.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  },

  /** One item off a business type's list, or null. */
  find(archetype, uuid) {
    return this.list(archetype).find((r) => r.uuid === uuid) ?? null;
  },

  /** What the GM took off a business type's defaults, to put back. */
  removed(archetype) {
    const { removed } = entryOf(read(), archetype);
    return (index ?? []).filter((r) => removed.includes(r.uuid) && madeByDefault(archetype, r)).sort((a, b) => a.name.localeCompare(b.name));
  },

  /** Add a priced item to a business type's list, by its UUID. */
  async add(archetype, uuid) {
    if (!ARCHETYPES[archetype]) return { ok: false, reason: 'bad-archetype' };
    const item = await fromUuid(String(uuid ?? '').trim()).catch(() => null);
    if (item?.documentName !== 'Item') return { ok: false, reason: 'item-missing' };
    const row = rowOf(item.uuid, item);
    if (row.price <= 0) return { ok: false, reason: 'no-price' };
    const data = read();
    const entry = entryOf(data, archetype);
    await write({
      ...data,
      [archetype]: {
        added: [...entry.added.filter((r) => r.uuid !== row.uuid), row],
        removed: entry.removed.filter((id) => id !== row.uuid),
      },
    });
    return { ok: true };
  },

  /** Take an item off a business type's list. */
  async remove(archetype, uuid) {
    if (!ARCHETYPES[archetype]) return { ok: false, reason: 'bad-archetype' };
    const data = read();
    const entry = entryOf(data, archetype);
    await write({
      ...data,
      [archetype]: {
        added: entry.added.filter((r) => r.uuid !== uuid),
        removed: [...new Set([...entry.removed, uuid])],
      },
    });
    return { ok: true };
  },

  /** Put a default back on a business type's list. */
  async restore(archetype, uuid) {
    if (!ARCHETYPES[archetype]) return { ok: false, reason: 'bad-archetype' };
    const data = read();
    const entry = entryOf(data, archetype);
    await write({ ...data, [archetype]: { ...entry, removed: entry.removed.filter((id) => id !== uuid) } });
    return { ok: true };
  },

  /** Mark an item illegal, or not, wherever it is made. */
  async setIllegal(uuid, illegal) {
    const data = read();
    const now = new Set(data.illegal ?? []);
    if (illegal) now.add(uuid);
    else now.delete(uuid);
    await write({ ...data, illegal: [...now] });
    // A line already set on the item follows the GM's word from its next run.
    for (const b of BusinessRepository.all()) {
      if (b.production?.line?.uuid === uuid) await BusinessRepository.save({ ...b, production: { ...b.production, line: { ...b.production.line, illegal: !!illegal } } });
    }
    return { ok: true };
  },
};
