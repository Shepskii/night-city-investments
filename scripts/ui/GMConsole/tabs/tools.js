/**
 * GM Console tools tab: the self-check, macros, company suggestions and the trade log.
 * @file scripts/ui/GMConsole/tabs/tools.js
 * @description Action handlers run with `this` set to the console window.
 */

import { L, money, whole } from '../../format.js';
import { GigImpactService } from '../../../services/GigImpactService.js';
import { DiagnosticsService } from '../../../services/DiagnosticsService.js';
import { MacroService } from '../../../services/MacroService.js';
import { MigrationService } from '../../../services/MigrationService.js';
import { CompanyEditorApp } from '../../CompanyEditor/CompanyEditorApp.js';

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
  return { tools: build(app.checkReport) };
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
