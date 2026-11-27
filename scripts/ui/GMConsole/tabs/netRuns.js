/**
 * GM Console NET runs tab (the Tools group): which architecture in the NET module each target runs on (X2a, DESIGN §36.20),
 * and where its data shard goes: on NET Architect (NCI Edition), the node NCI attaches it to at run start; on the original,
 * a shard the GM makes here and attaches by hand. Shown only with a NET module active.
 * @file scripts/ui/GMConsole/tabs/netRuns.js
 * @description Action handlers run with `this` set to the console window.
 */

import { MODULE_ID, SETTINGS } from '../../../utils/constants.js';
import { BusinessService } from '../../../services/BusinessService.js';
import { JobService } from '../../../services/JobService.js';
import { NetArchitectAdapter, targetKey } from '../../../integrations/NetArchitectAdapter.js';
import { L } from '../../format.js';

let loading = null;

async function onLink(event, target) {
  const key = target.dataset.key;
  const row = target.closest('tr');
  const value = row?.querySelector('select[name="netArch"]')?.value ?? '';
  // The node list follows the architecture chosen (see pickArchitecture); a node only counts if it is that one's.
  const node = row?.querySelector('select[name="netNode"]')?.value || null;
  const keep = node && NetArchitectAdapter.nodesOf(value).some((n) => n.id === node) ? node : null;
  await NetArchitectAdapter.link(key, value, keep);
  delete this.netPicks?.[key];
  // Players see which targets have a map with the job board.
  await JobService.publish();
  ui.notifications.info(L(value ? 'NCI.NetRunLive.Linked' : 'NCI.NetRunLive.Unlinked'));
  this.render();
}

async function onShard(event, target) {
  const out = await BusinessService.makeLiveShard(target.dataset.key);
  if (!out.ok) return ui.notifications.warn(L('NCI.GMConsole.ActionFailed'));
  ui.notifications.info(L('NCI.NetRunLive.ShardMade', { name: out.item.name, module: NetArchitectAdapter.title() }));
  return out.item.sheet?.render(true);
}

async function onReload() {
  await NetArchitectAdapter.load();
  this.render();
}

export const actions = { netLink: onLink, netShard: onShard, netReload: onReload };

/**
 * The GM chose an architecture in a target's row, not yet saved: the row shows it, with its nodes for the data shard
 * from the architectures already loaded, until Save.
 */
export function pickArchitecture(app, key, architectureId) {
  app.netPicks ??= {};
  app.netPicks[key] = architectureId;
}

/** Choosing an architecture redraws its row's node choices at once (a change, not a click). */
export function onRender(app, root) {
  for (const select of root.querySelectorAll('select[name="netArch"][data-key]')) {
    select.addEventListener('change', (event) => {
      pickArchitecture(app, select.dataset.key, event.target.value);
      app.render();
    });
  }
}

export function context(app) {
  // The architectures come from the NET module's compendium, read once and again on Reload.
  if (!loading && NetArchitectAdapter.present()) {
    loading = NetArchitectAdapter.load().then(() => app.render());
  }
  const maps = NetArchitectAdapter.architectures();
  const links = NetArchitectAdapter.links();
  const fork = NetArchitectAdapter.onFork();
  const moduleTitle = NetArchitectAdapter.title();
  const { npc, corps } = BusinessService.inquiryTargets();
  const row = (t, kind) => {
    const target = { ...t, kind };
    const key = targetKey(target);
    const linked = links[key] ?? '';
    // The architecture the row shows: one the GM has just chosen, before Save, else the linked one.
    const shown = app.netPicks?.[key] ?? linked;
    // On the fork, NCI attaches the data shard itself: to the node chosen here, or by default the first objective,
    // file or data node. On the original, the GM makes it and attaches it in the NET module's editor.
    const map = fork && shown ? maps.find((m) => m.id === shown) : null;
    const chosen = map && shown === linked ? NetArchitectAdapter.nodeOf(target) : null;
    return {
      key, name: kind === 'corp' ? `${t.name} (${t.ticker})` : t.name, kind: L(`NCI.NetRunLive.Kind.${kind}`), dv: t.netDv,
      options: [{ value: '', label: L('NCI.NetRunLive.NoMap'), selected: !shown }, ...maps.map((m) => ({ value: m.id, label: m.name, selected: m.id === shown }))],
      nodes: map ? [
        { value: '', label: L('NCI.NetRunLive.DefaultNode'), selected: !map.nodes.some((n) => n.id === chosen) },
        ...map.nodes.map((n) => ({ value: n.id, label: `${n.name} (${n.type})`, selected: n.id === chosen })),
      ] : [],
      missing: !!linked && maps.length > 0 && !maps.some((m) => m.id === linked),
      linked: !!linked,
      manualShard: !fork && !!linked,
    };
  };
  return {
    netRuns: {
      present: NetArchitectAdapter.present(),
      on: game.settings.get(MODULE_ID, SETTINGS.NET_ARCHITECT) === true,
      hint: L(fork ? 'NCI.NetRunLive.TabHintFork' : 'NCI.NetRunLive.TabHint', { module: moduleTitle }),
      noMaps: maps.length === 0,
      noMapsText: L('NCI.NetRunLive.NoMaps', { module: moduleTitle }),
      fork,
      rows: [...npc.map((t) => row(t, 'npc')), ...corps.map((t) => row(t, 'corp'))],
    },
  };
}
