/**
 * GM Console audit tab (the Tools group): the self-check, macros, company suggestions, the trade log and the GM's actions.
 * @file scripts/ui/GMConsole/tabs/tools.js
 * @description Action handlers run with `this` set to the console window.
 */

import { parseTarget } from '../../../engine/index.js';
import { L, money, whole } from '../../format.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { GigImpactService } from '../../../services/GigImpactService.js';
import { DiagnosticsService } from '../../../services/DiagnosticsService.js';
import { MacroService } from '../../../services/MacroService.js';
import { MigrationService } from '../../../services/MigrationService.js';
import { CompanyEditorApp } from '../../CompanyEditor/CompanyEditorApp.js';
import { targetLabel, companiesById } from '../shared.js';

function onRunCheck() {
  this.checkReport = DiagnosticsService.verify({ silent: true });
  this.render();
}

async function onCreateMacros() {
  const { created, skipped } = await MacroService.createDefaults();
  ui.notifications.info(L('NCI.Tools.MacrosDone', { created, skipped }));
}

function onCreateSuggested(event, target) {
  CompanyEditorApp.edit(null, { name: target.dataset.name, ticker: target.dataset.ticker });
}

async function onIgnoreSuggested(event, target) {
  await GigImpactService.addMapping(target.dataset.name, 'ignore');
  this.render();
}

export const actions = {
  runCheck: onRunCheck,
  createMacros: onCreateMacros,
  createSuggested: onCreateSuggested,
  ignoreSuggested: onIgnoreSuggested,
};

export function context(app) {
  return { tools: build(app.checkReport), log: recentActions() };
}

/** The GM's latest actions on the market, newest first. */
function recentActions() {
  const byId = companiesById();
  return MarketStore.getControls().log.slice(-10).reverse().map((e) => ({
    tick: Math.floor(e.tick + 1e-6),
    text: L(`NCI.Log.${e.kind}`, {
      target: e.target ? (parseTarget(e.target) ? targetLabel(parseTarget(e.target), byId) : e.target) : '',
      company: byId.get(e.companyId)?.ticker ?? e.companyId ?? '',
      value: e.value ?? '', days: e.days ?? '', percent: e.percent ?? '', regime: e.regime ?? '',
      from: e.from ?? '', to: e.to ?? '', halted: e.halted ? L('NCI.Controls.Halted') : L('NCI.Controls.Resumed'),
    }),
  }));
}

function build(report) {
  const rows = DiagnosticsService.tradeLog();
  return {
    schema: L('NCI.Tools.Schema', { version: MigrationService.version() }),
    report: report ? {
      cls: report.counts.fail ? 'nci-down' : report.counts.warn ? 'nci-warn' : 'nci-up',
      summary: L(report.counts.fail ? 'NCI.Verify.SummaryFail' : report.counts.warn ? 'NCI.Verify.SummaryWarn' : 'NCI.Verify.SummaryOk', report.counts),
      checks: report.checks.map((c) => ({
        label: L(`NCI.Verify.Check.${c.id}`),
        levelLabel: L(`NCI.Verify.Level.${c.level}`),
        cls: { ok: 'nci-up', info: 'nci-muted', warn: 'nci-warn', fail: 'nci-down' }[c.level],
        detail: c.detail,
      })),
    } : null,
    suggestions: DiagnosticsService.suggestions().map((s) => ({
      ...s,
      seen: L('NCI.Tools.Seen', { count: s.count, from: s.from.map((f) => L(`NCI.Tools.From.${f}`)).join(', ') }),
    })),
    trades: rows.map((r) => ({
      tick: Math.floor(r.tick + 1e-6),
      name: r.name,
      side: L(`NCI.Side.${r.side}`),
      cls: r.side === 'buy' ? 'nci-up' : 'nci-down',
      asset: r.assetId,
      qty: r.qty,
      price: money(r.price),
      gross: whole(r.gross),
      fees: whole(r.fees),
      route: L(`NCI.Route.${r.route === 'broker' ? 'broker' : 'direct'}`),
    })),
  };
}
