/**
 * NET Architect adapter: a NET run played out for real (X2a, DESIGN §36.20).
 * @file scripts/integrations/NetArchitectAdapter.js
 * @description With CPR NET Architect active and the world setting on, the GM links a target (an NPC's business or a
 *              market corporation) to one of their architectures, and a Netrunner can choose a real run on it over the
 *              quick roll. NET Architect is another author's module: this file is the only place NCI touches it, through
 *              its public API (`startNetrun`, `getActiveSession`), its hooks (`cprNetArchitectJackOut`) and the
 *              architectures in its world compendium, read as its own manager lists them. Nothing here changes it.
 *              A taken item keeps its flags (NET Architect copies them), so a data shard made here and attached to a
 *              node becomes the runner's evidence; Foundry's createItem hook says when.
 */

import { MODULE_ID, SETTINGS } from '../utils/constants.js';

export const NET_ARCHITECT_ID = 'cpr-net-architect';

/** The GM whose client NET Architect runs on: the lowest id among connected GMs, as NET Architect has it. */
export function authorityOf(users) {
  return [...users].filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

/** A target's key in the links: `b:<business id>` or `c:<ticker>`, as the NET run's picker has them. */
export const targetKey = (target) => ((target.kind ? target.kind === 'npc' : !!target.id) ? `b:${target.id}` : `c:${target.ticker}`);

let cache = null;

export const NetArchitectAdapter = {
  /** Whether NET Architect is here at all. */
  present() {
    return !!game.modules?.get(NET_ARCHITECT_ID)?.active;
  },

  /** Whether real runs are on in this world: what players are shown. NET Architect's API may load after NCI's start. */
  enabled() {
    return this.present() && game.settings.get(MODULE_ID, SETTINGS.NET_ARCHITECT) === true;
  },

  /** Whether a real run can be started now: on, and NET Architect's API is there. */
  active() {
    return this.enabled() && !!this.api();
  },

  api() {
    return game.modules?.get(NET_ARCHITECT_ID)?.api ?? null;
  },

  /** Whether this client is the one NET Architect starts runs from. */
  isAuthority() {
    return authorityOf(game.users)?.id === game.user?.id;
  },

  /** Whether a run is going on now: NET Architect has one at a time. */
  busy() {
    try {
      return !!this.api()?.getActiveSession?.();
    } catch {
      return false;
    }
  },

  /** The links the GM has made, target key to architecture id. */
  links() {
    return { ...(game.settings.get(MODULE_ID, SETTINGS.NET_ARCH_LINKS) ?? {}) };
  },

  linkOf(target) {
    return this.links()[targetKey(target)] ?? null;
  },

  /** GM only: link a target to an architecture, or unlink it with an empty id. */
  async link(key, architectureId) {
    const links = this.links();
    if (architectureId) links[key] = architectureId;
    else delete links[key];
    await game.settings.set(MODULE_ID, SETTINGS.NET_ARCH_LINKS, links);
  },

  /** The architectures known so far (GM only), from the last `load`. */
  architectures() {
    return cache ?? [];
  },

  /** GM only: read the architectures from NET Architect's world compendium. */
  async load() {
    const pack = game.packs?.get(`world.${NET_ARCHITECT_ID}`);
    if (!game.user?.isGM || !pack) {
      cache = [];
      return cache;
    }
    try {
      const docs = await pack.getDocuments();
      cache = docs.map((doc) => doc.getFlag(NET_ARCHITECT_ID, 'architecture')).filter((a) => a?.id)
        .map((a) => ({ id: a.id, name: a.name || a.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.warn('night-city-investments | could not read NET Architect architectures', error);
      cache = [];
    }
    return cache;
  },

  /** Start a run on the authority GM's client; throws with NET Architect's own message if it refuses. */
  start(architectureId, actor, userId) {
    return this.api().startNetrun(architectureId, actor.uuid, { userId: userId ?? undefined, actions: 0 });
  },

  /** Whether an item came out of this session: NET Architect marks a taken item `lootClaim` "<session>:<node>:<attachment>". */
  takenIn(item, sessionId) {
    const claim = item?.flags?.[NET_ARCHITECT_ID]?.lootClaim;
    return typeof claim === 'string' && claim.startsWith(`${sessionId}:`);
  },
};
