/**
 * Market GM Console: the window, its tabs, and the previews they share.
 * @file scripts/ui/GMConsole/GMConsoleApp.js
 * @description Each tab's actions and data live in ./tabs; only the open tab's data is built.
 */

import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { GigImpactService } from '../../services/GigImpactService.js';
import { PreviewService } from '../../services/PreviewService.js';
import { BaseApplication } from '../BaseApplication.js';
import { L } from '../format.js';
import { coneChart } from '../components/chart.js';
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
import * as tools from './tabs/tools.js';

/** In display order. */
const TABS = { market, events, actions, companies, funds, brokers, gigs, heat, businesses, syndicates, factions, tools };
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

  static _onTab(event, target) {
    if (target.dataset.tab in TABS) this.tab = target.dataset.tab;
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

  async _prepareContext() {
    const gigCounts = GigImpactService.counts();
    const waiting = { gigs: gigCounts.review + gigCounts.mapping, businesses: businesses.waiting(), syndicates: syndicates.waiting() };
    const context = {
      tab: this.tab,
      tabs: Object.keys(TABS).map((t) => ({
        id: t,
        label: waiting[t] ? `${L(`NCI.GMConsole.Tab.${t}`)} (${waiting[t]})` : L(`NCI.GMConsole.Tab.${t}`),
        active: t === this.tab,
      })),
      activeGM: game.user.id === game.users.activeGM?.id,
    };
    for (const t of Object.keys(TABS)) context[`is${t[0].toUpperCase()}${t.slice(1)}`] = t === this.tab;
    return { ...context, ...TABS[this.tab].context(this) };
  }
}
