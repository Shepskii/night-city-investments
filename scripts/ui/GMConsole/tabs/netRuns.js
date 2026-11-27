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
  // The node list is the linked architecture's: with another architecture chosen, its nodes are offered after the save.
  const node = row?.querySelector('select[name="netNode"]')?.value || null;
  const keep = node && NetArchitectAdapter.nodesOf(value).some((n) => n.id === node) ? node : null;
  await NetArchitectAdapter.link(key, value, keep);
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

export function context(app) {
  // The architectures come from the NET module's compendium, read once and again on Reload.
  if (!loading && NetArchitectAdapter.present()) {
    loading = NetArchitectAdapter.load().then(() => app.render());
  }
  const maps = NetArchitectAdapter.architectures();
  const links = NetArchitectAdapter.links();
  const fork = NetArchitectAdapter.onFork();
  const { npc, corps } = BusinessService.inquiryTargets();
  const row = (t, kind) => {
    const target = { ...t, kind };
    const key = targetKey(target);
    const linked = links[key] ?? '';
    // On the fork, NCI attaches the data shard itself: to the node chosen here, or by default the first objective,
    // file or data node. On the original, the GM makes it and attaches it in the NET module's editor.
    const map = fork && linked ? maps.find((m) => m.id === linked) : null;
    const chosen = map ? NetArchitectAdapter.nodeOf(target) : null;
    return {
      key, name: kind === 'corp' ? `${t.name} (${t.ticker})` : t.name, kind: L(`NCI.NetRunLive.Kind.${kind}`), dv: t.netDv,
      options: [{ value: '', label: L('NCI.NetRunLive.NoMap'), selected: !linked }, ...maps.map((m) => ({ value: m.id, label: m.name, selected: m.id === linked }))],
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
      hint: L(NetArchitectAdapter.onFork() ? 'NCI.NetRunLive.TabHintFork' : 'NCI.NetRunLive.TabHint', { module: NetArchitectAdapter.title() }),
      noMaps: maps.length === 0 ? L('NCI.NetRunLive.NoMaps', { module: NetArchitectAdapter.title() }) : '',
      fork,
      rows: [...npc.map((t) => row(t, 'npc')), ...corps.map((t) => row(t, 'corp'))],
    },
  };
}
