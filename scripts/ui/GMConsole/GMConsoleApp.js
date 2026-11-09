/**
 * Market GM Console: the window, its tabs, and the previews they share.
 * @file scripts/ui/GMConsole/GMConsoleApp.js
 * @description Each tab's actions and data live in ./tabs; only the open tab's data is built.
 */

import { matchInvites } from '../Business/BusinessApp.js';
import { ProductionCatalog } from '../../data/ProductionCatalog.js';
import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { PreviewService } from '../../services/PreviewService.js';
import { BaseApplication } from '../BaseApplication.js';
import { L } from '../format.js';
import { coneChart } from '../components/chart.js';
import * as pending from './tabs/pending.js';
import * as market from './tabs/market.js';
import * as events from './tabs/events.js';
import * as actions from './tabs/actions.js';
import * as companies from './tabs/companies.js';
import * as funds from './tabs/funds.js';
import * as brokers from './tabs/brokers.js';
import * as gigs from './tabs/gigs.js';
import * as heat from './tabs/heat.js';
import * as businesses from './tabs/businesses.js';
import * as syndicates from './tabs/syndicates.js';
import * as factions from './tabs/factions.js';
import * as production from './tabs/production.js';
import * as tools from './tabs/tools.js';

const TABS = { pending, market, events, actions, brokers, businesses, syndicates, heat, gigs, companies, funds, factions, production, tools };
/** The two rows of buttons: each group, and its tabs in display order. */
const GROUPS = {
  pending: ['pending'],
  market: ['market', 'events', 'actions', 'brokers'],
  players: ['businesses', 'syndicates', 'heat'],
  tools: ['gigs', 'companies', 'funds', 'factions', 'production', 'tools'],
};
const groupOf = (tab) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(tab));
const PARTIALS = `modules/${MODULE_ID}/templates/gm/console`;

export class GMConsoleApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    id: 'nci-gm-console',
    window: { title: 'NCI.GMConsole.Title', icon: 'fas fa-sliders' },
    position: { width: 1200, height: 680 },
    actions: {
      switchTab: GMConsoleApp._onTab,
      ...Object.assign({}, ...Object.values(TABS).map((tab) => tab.actions)),
    },
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/gm/console.hbs`,
      templates: [...Object.keys(TABS), 'preview'].map((t) => `${PARTIALS}/${t}.hbs`),
    },
  };

  tab = 'market';
  /** The tab last open in each group, to go back to when the group is chosen again. */
  lastInGroup = {};
  preview = null;
  /** The last self-check, kept so it stays on screen while the GM works. */
  checkReport = null;
  _refresh = () => this.render();

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Hooks.on(HOOKS.MARKET_UPDATED, this._refresh);
    Hooks.on(HOOKS.COMPANIES_CHANGED, this._refresh);
    Hooks.on(HOOKS.GIGS_CHANGED, this._refresh);
    Hooks.on(HOOKS.HEAT_CHANGED, this._refresh);
    Hooks.on(HOOKS.BUSINESSES_CHANGED, this._refresh);
    Hooks.on(HOOKS.SYNDICATES_CHANGED, this._refresh);
  }

  _onClose(options) {
    Hooks.off(HOOKS.MARKET_UPDATED, this._refresh);
    Hooks.off(HOOKS.COMPANIES_CHANGED, this._refresh);
    Hooks.off(HOOKS.GIGS_CHANGED, this._refresh);
    Hooks.off(HOOKS.HEAT_CHANGED, this._refresh);
    Hooks.off(HOOKS.BUSINESSES_CHANGED, this._refresh);
    Hooks.off(HOOKS.SYNDICATES_CHANGED, this._refresh);
    super._onClose?.(options);
  }

  /** A tab's own button, or a group's: that group's last tab, or else its first. */
  static _onTab(event, target) {
    // A Pending row opens its tab, but not for a click on the fields and buttons it holds.
    if (event?.target?.closest?.('.nci-rowactions')) return;
    const { tab, group } = target.dataset;
    const chosen = group ? this.lastInGroup[group] ?? GROUPS[group]?.[0] : tab;
    if (chosen in TABS) {
      this.tab = chosen;
      this.lastInGroup[groupOf(chosen)] = chosen;
    }
    this.render();
  }

  // ── Previews (the Market and Events tabs) ──────────────────────────────────

  /** Run the preview for a scenario and show it. */
  _showPreview(scenario, days, title) {
    const result = PreviewService.run(scenario, days);
    if (!result.ok) {
      ui.notifications.warn(L(`NCI.Preview.Reason.${result.reason}`));
      return;
    }
    const s = result.summary;
    const pc = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
    this.preview = {
      kind: scenario.kind,
      title: L('NCI.Preview.Title', { title, days: result.ticks }),
      chart: coneChart(result.baseline, result.scenario),
      summary: L(result.single ? 'NCI.Preview.SummarySingle' : 'NCI.Preview.SummaryGroup', {
        median: pc(s.scenarioMedianChange),
        base: pc(s.baselineMedianChange),
        low: pc(s.scenarioLow),
        high: pc(s.scenarioHigh),
        higher: Math.round(s.higherShare * 100),
        paths: result.paths,
      }),
    };
    this.render();
  }

  /** A preview button opens its preview, and while that preview is showing the same button closes it. */
  _togglePreview(kind, show) {
    if (this.preview?.kind === kind) {
      this.preview = null;
      this.render();
      return;
    }
    show();
  }

  // ── Context ────────────────────────────────────────────────────────────────

  /** The Production tab's archetype picker and drop box (P1a), which are not clicks. */
  /** The New NPC company form: find the owner by typing, as a world can hold hundreds of NPCs (N1). */
  _ownerSearch(root) {
    const search = root.querySelector('[name="npcOwnerSearch"]');
    if (!search) return;
    const owner = root.querySelector('[name="npcOwner"]');
    const options = [...root.querySelectorAll('[data-npc-owner]')];
    const names = options.map((o) => o.dataset.name);
    const show = (shown) => options.forEach((o, i) => { o.style.display = shown.has(i) ? '' : 'none'; });
    const pick = (o) => {
      owner.value = o.dataset.id;
      search.value = o.dataset.name;
      show(new Set());
    };
    search.addEventListener('input', () => {
      owner.value = '';
      show(new Set(matchInvites(search.value, names)));
    });
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const first = options.find((o) => o.style.display !== 'none');
      if (first) pick(first);
    });
    options.forEach((o) => o.addEventListener('click', (event) => {
      event.preventDefault();
      pick(o);
    }));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    root.querySelector('[data-production-archetype]')?.addEventListener('change', (event) => {
      this.productionArchetype = event.target.value;
      this.render();
    });
    this._ownerSearch(root);
    root.querySelector('[data-production-drop]')?.addEventListener('drop', (event) => {
      event.preventDefault();
      try {
        event.target.value = JSON.parse(event.dataTransfer.getData('text/plain')).uuid ?? '';
      } catch {
        event.target.value = event.dataTransfer.getData('text/plain');
      }
    });
  }

  async _prepareContext() {
    await ProductionCatalog.load();
    const waiting = pending.waiting();
    const tabs = Object.keys(TABS).map((t) => ({ id: t, label: L(`NCI.GMConsole.Tab.${t}`), count: waiting[t] ?? 0, active: t === this.tab }));
    const group = groupOf(this.tab);
    const context = {
      tab: this.tab,
      tabs,
      groups: Object.keys(GROUPS).map((g) => ({
        id: g,
        label: L(`NCI.GMConsole.Group.${g}`),
        count: GROUPS[g].reduce((a, t) => a + (waiting[t] ?? 0), 0),
        active: g === group,
      })),
      // A group of one has no second row.
      subTabs: GROUPS[group].length > 1 ? GROUPS[group].map((t) => tabs.find((x) => x.id === t)) : [],
      activeGM: game.user.id === game.users.activeGM?.id,
    };
    for (const t of Object.keys(TABS)) context[`is${t[0].toUpperCase()}${t.slice(1)}`] = t === this.tab;
    return { ...context, ...TABS[this.tab].context(this) };
  }
}
