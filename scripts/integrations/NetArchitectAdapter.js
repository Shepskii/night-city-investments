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
import { L } from '../utils/helpers.js';

/** The original CPR NET Architect. */
export const NET_ARCHITECT_ID = 'cpr-net-architect';
/** Our fork, NET Architect (NCI Edition): preferred when both are active. */
export const NET_ARCHITECT_NCI_ID = 'cpr-net-architect-nci-edition';

/**
 * The fork's run hooks NCI follows, fired on every client from the authority GM's saved session (its README, "For module
 * authors"). Its `itemTaken` isn't needed: a taken shard is filled on Foundry's createItem.
 */
export const FORK_HOOKS = Object.freeze({
  runStarted: 'cprNetArchitectNci.runStarted',
  runnerLeft: 'cprNetArchitectNci.runnerLeft',
  runEnded: 'cprNetArchitectNci.runEnded',
});

const isActive = (id) => !!game.modules?.get(id)?.active;

/** The GM whose client NET Architect runs on: the lowest id among connected GMs, as NET Architect has it. */
export function authorityOf(users) {
  return [...users].filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

/** A target's key in the links: `b:<business id>` or `c:<ticker>`, as the NET run's picker has them. */
export const targetKey = (target) => ((target.kind ? target.kind === 'npc' : !!target.id) ? `b:${target.id}` : `c:${target.ticker}`);

let cache = null;

/**
 * The links as stored: a target key to its architecture id, or, on the fork with a node chosen for the data shard,
 * `{ architectureId, nodeId }`. Links made before nodes could be chosen are plain ids, and still work.
 */
const storedLinks = () => ({ ...(game.settings.get(MODULE_ID, SETTINGS.NET_ARCH_LINKS) ?? {}) });
/** A stored link read: its architecture id and chosen node, each null if there is none. */
const parseLink = (value) => (typeof value === 'string'
  ? { architectureId: value || null, nodeId: null }
  : { architectureId: value?.architectureId || null, nodeId: value?.nodeId || null });

/** The node types a data shard goes on when the GM hasn't chosen one, in the order tried. */
const SHARD_NODE_TYPES = Object.freeze(['objective', 'file', 'data']);

/** The node a target's data shard goes on: the one the GM chose, if the architecture still has it, else the first of SHARD_NODE_TYPES; or null. */
function shardNode(nodes, chosenId = null) {
  const chosen = chosenId ? nodes.find((n) => n.id === chosenId) : null;
  if (chosen) return chosen;
  for (const type of SHARD_NODE_TYPES) {
    const found = nodes.find((n) => n.type === type);
    if (found) return found;
  }
  return null;
}

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
    return game.modules?.get(this.moduleId())?.title ?? L('NCI.NetRunLive.ModuleTitle');
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
    return Object.fromEntries(Object.entries(storedLinks()).map(([key, value]) => [key, parseLink(value).architectureId]).filter(([, id]) => id));
  },

  linkOf(target) {
    return this.links()[targetKey(target)] ?? null;
  },

  /** The node the GM chose to hold a target's data shard on the fork, or null for the default (see `shardNodeFor`). */
  nodeOf(target) {
    return parseLink(storedLinks()[targetKey(target)]).nodeId;
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

  /** GM only: link a target to an architecture, with the node for its data shard if chosen, or unlink it with an empty id. */
  async link(key, architectureId, nodeId = null) {
    const links = storedLinks();
    if (architectureId) links[key] = nodeId ? { architectureId, nodeId } : architectureId;
    else delete links[key];
    await game.settings.set(MODULE_ID, SETTINGS.NET_ARCH_LINKS, links);
  },

  /** The architectures known so far (GM only), from the last `load`. */
  architectures() {
    return cache ?? [];
  },

  /** An architecture's nodes, in the order they are saved, from the last `load`. */
  nodesOf(architectureId) {
    return this.architectures().find((a) => a.id === architectureId)?.nodes ?? [];
  },

  /**
   * The node a target's data shard goes on in an architecture, from the last `load`: the one the GM chose, if the
   * architecture still has it, else its first objective, then file, then data node; or null.
   */
  shardNodeFor(target, architectureId) {
    return shardNode(this.nodesOf(architectureId), this.nodeOf(target));
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
        .map((a) => ({
          id: a.id, name: a.name || a.id,
          nodes: (Array.isArray(a.nodes) ? a.nodes : []).filter((n) => n?.id).map((n) => ({ id: n.id, type: n.type ?? 'custom', name: n.name || n.type || n.id })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.warn('night-city-investments | could not read NET Architect architectures', error);
      cache = [];
    }
    return cache;
  },

  /**
   * What the fork's live session says of one runner, while that session is still the active one: the nodes they failed
   * and the run's compromised nodes, as `runnerLeft` would give them; or null when the session is gone or another.
   */
  runnerInSession(sessionId, actorUuid) {
    let session = null;
    try {
      session = this.api()?.getActiveSession?.() ?? null;
    } catch {
      return null;
    }
    if (!session || session.id !== sessionId) return null;
    // Sessions from before several runners keep the one runner's state at the top.
    const records = session.runners ? Object.values(session.runners) : [session];
    const record = records.find((r) => r?.runner?.actorUuid === actorUuid);
    if (!record) return null;
    return { failed: [...(record.failedNodeIds ?? [])], compromised: [...(session.compromisedNodeIds ?? [])] };
  },

  /** Start a run on the authority GM's client; throws with the NET module's own message if it refuses. */
  start(architectureId, actor, userId) {
    return this.api().startNetrun(architectureId, actor.uuid, { userId: userId ?? undefined, actions: 0 });
  },

  /** GM authority only, during a run: attach an Item to a node in the fork's live run, as the runner sees it if `visible`. */
  addRunItem(nodeId, itemUuid, { visible = false } = {}) {
    return this.api().addRunItem(nodeId, itemUuid, { visible });
  },

  /** Whether an item came out of this session: the NET module marks a taken item `lootClaim` "<session>:<node>:<attachment>". */
  takenIn(item, sessionId) {
    const claim = item?.flags?.[this.moduleId()]?.lootClaim;
    return typeof claim === 'string' && claim.startsWith(`${sessionId}:`);
  },
};
