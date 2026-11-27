/**
 * NET module adapter: a NET run played out for real (X2a, DESIGN §36.20; ADR 0001).
 * @file scripts/integrations/NetArchitectAdapter.js
 * @description The NET module is CPR NET Architect, or our fork of it, NET Architect (NCI Edition), whichever is active,
 *              the fork when both are. With it active and the world setting on, the GM links a target (an NPC's
 *              business or a market corporation) to one of its architectures, and a real run on it counts as the
 *              runner's NET run. This file is the only place NCI touches either module, through its public API
 *              (`startNetrun`, `getActiveSession`), its hooks and the architectures in its world compendium, read as
 *              its own manager lists them. Nothing here changes it. On the original, NCI follows a run it started by
 *              watching the saved session; on the fork, it follows any run through the fork's run hooks (FORK_HOOKS).
 *              A taken item keeps its flags (both copy them), so a data shard made here and attached to a node
 *              becomes the runner's evidence; Foundry's createItem hook says when.
 */

import { MODULE_ID, SETTINGS } from '../utils/constants.js';

/** The original CPR NET Architect. */
export const NET_ARCHITECT_ID = 'cpr-net-architect';
/** Our fork, NET Architect (NCI Edition): preferred when both are active. */
export const NET_ARCHITECT_NCI_ID = 'cpr-net-architect-nci-edition';

/** The fork's run hooks, fired on every client from the authority GM's saved session (its README, "For module authors"). */
export const FORK_HOOKS = Object.freeze({
  runStarted: 'cprNetArchitectNci.runStarted',
  runnerLeft: 'cprNetArchitectNci.runnerLeft',
  runEnded: 'cprNetArchitectNci.runEnded',
  itemTaken: 'cprNetArchitectNci.itemTaken',
});

const isActive = (id) => !!game.modules?.get(id)?.active;

/** The GM whose client NET Architect runs on: the lowest id among connected GMs, as NET Architect has it. */
export function authorityOf(users) {
  return [...users].filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

/** A target's key in the links: `b:<business id>` or `c:<ticker>`, as the NET run's picker has them. */
export const targetKey = (target) => ((target.kind ? target.kind === 'npc' : !!target.id) ? `b:${target.id}` : `c:${target.ticker}`);

let cache = null;

export const NetArchitectAdapter = {
  /** Whether a NET module is here at all: either edition. */
  present() {
    return isActive(NET_ARCHITECT_NCI_ID) || isActive(NET_ARCHITECT_ID);
  },

  /** Whether the NET module in use is the fork, which has run hooks. */
  onFork() {
    return isActive(NET_ARCHITECT_NCI_ID);
  },

  /** The id of the NET module in use: the fork if it's active, else the original (active or not). */
  moduleId() {
    return this.onFork() ? NET_ARCHITECT_NCI_ID : NET_ARCHITECT_ID;
  },

  /** The NET module's own title, to name it to the GM. */
  title() {
    return game.modules?.get(this.moduleId())?.title ?? 'NET Architect';
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
    return game.modules?.get(this.moduleId())?.api ?? null;
  },

  /** Whether this client is the one the NET module starts runs from. */
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

  /** The keys of the targets linked to an architecture, in the order the GM linked them. */
  targetsOn(architectureId) {
    if (!architectureId) return [];
    return Object.entries(this.links()).filter(([, id]) => id === architectureId).map(([key]) => key);
  },

  /** Whether this client follows the fork's runs for NCI: real runs on, on the fork, and the authority GM, so one settles. */
  follows() {
    return this.enabled() && this.onFork() && !!game.user?.isGM && this.isAuthority();
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

  /** GM only: read the architectures from the NET module's world compendium. */
  async load() {
    const id = this.moduleId();
    const pack = game.packs?.get(`world.${id}`);
    if (!game.user?.isGM || !pack) {
      cache = [];
      return cache;
    }
    try {
      const docs = await pack.getDocuments();
      cache = docs.map((doc) => doc.getFlag(id, 'architecture')).filter((a) => a?.id)
        .map((a) => ({ id: a.id, name: a.name || a.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.warn('night-city-investments | could not read NET Architect architectures', error);
      cache = [];
    }
    return cache;
  },

  /** Start a run on the authority GM's client; throws with the NET module's own message if it refuses. */
  start(architectureId, actor, userId) {
    return this.api().startNetrun(architectureId, actor.uuid, { userId: userId ?? undefined, actions: 0 });
  },

  /** Whether an item came out of this session: the NET module marks a taken item `lootClaim` "<session>:<node>:<attachment>". */
  takenIn(item, sessionId) {
    const claim = item?.flags?.[this.moduleId()]?.lootClaim;
    return typeof claim === 'string' && claim.startsWith(`${sessionId}:`);
  },
};
