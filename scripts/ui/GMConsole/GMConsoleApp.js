/**
 * Market GM Console: clock, market controls, events, corporate actions, companies.
 * @file scripts/ui/GMConsole/GMConsoleApp.js
 */

import { REGIMES, parseTarget, SHOCK_PERSISTENCE, GLIDE_NOISE, glideEndTick, ipoStatus, dayIndex } from '../../engine/index.js';
import { MODULE_ID, SETTINGS, HOOKS } from '../../utils/constants.js';
import { CompanyRepository } from '../../data/CompanyRepository.js';
import { FundRepository } from '../../data/FundRepository.js';
import { BrokerRepository } from '../../data/BrokerRepository.js';
import { MarketStore } from '../../data/MarketStore.js';
import { MarketClock } from '../../services/MarketClockService.js';
import { TickService } from '../../services/TickService.js';
import { ImportService } from '../../services/ImportService.js';
import { FundService } from '../../services/FundService.js';
import { UndoService } from '../../services/UndoService.js';
import { PreviewService } from '../../services/PreviewService.js';
import { IpoService } from '../../services/IpoService.js';
import { GigImpactService } from '../../services/GigImpactService.js';
import { HeatService } from '../../services/HeatService.js';
import { TerminalAccess } from '../../services/TerminalAccess.js';
import { DiagnosticsService } from '../../services/DiagnosticsService.js';
import { MacroService } from '../../services/MacroService.js';
import { MigrationService } from '../../services/MigrationService.js';
import { TradingSettings } from '../../services/TradingSettings.js';
import { MarketControlService } from '../../services/MarketControlService.js';
import { CorporateActionService } from '../../services/CorporateActionService.js';
import { DividendService } from '../../services/DividendService.js';
import { NewsService } from '../../services/NewsService.js';
import { BaseApplication } from '../BaseApplication.js';
import { CompanyEditorApp } from '../CompanyEditor/CompanyEditorApp.js';
import { FundEditorApp } from '../FundEditor/FundEditorApp.js';
import { L, money, whole, daysLeft, daysInclusive } from '../format.js';
import { coneChart } from '../components/chart.js';

const TABS = ['market', 'events', 'actions', 'companies', 'funds', 'brokers', 'gigs', 'heat', 'tools'];
const BRIDGE_ID = 'night-city-map-night-city-investments-bridge';

/** Read a named input from the nearest enclosing gig card. */
function gigField(target, name) {
  return target.closest('.nci-gig')?.querySelector(`[name="${name}"]`);
}

/** Tell the GM what happened to a gig report or decision. */
function gigResult(out) {
  const status = out?.status ?? 'failed';
  const key = ['applied', 'pending', 'unmatched', 'ignored', 'duplicate', 'disabled', 'invalid', 'not-gm'].includes(status) ? status : 'failed';
  const text = L(`NCI.Gig.Result.${key}`, { days: out?.delayDays ?? '' });
  if (out?.ok && key !== 'failed') ui.notifications.info(text);
  else ui.notifications.warn(text);
  return out?.ok;
}

async function confirm(title, content) {
  const result = await foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<p>${content}</p>`,
    rejectClose: false,
    modal: true,
  });
  return !!result;
}

/** Read a named input from the form block that contains the clicked button. */
function field(target, name) {
  const el = target.closest('.nci-form')?.querySelector(`[name="${name}"]`);
  if (!el) return undefined;
  return el.type === 'checkbox' ? el.checked : el.value;
}

/** Tell the GM whether an action worked. */
function report(result, okKey = 'NCI.GMConsole.ActionOk') {
  const ok = result === true || result?.ok === true || (typeof result === 'number' && result >= 0);
  if (ok) ui.notifications.info(L(okKey));
  else ui.notifications.warn(L('NCI.GMConsole.ActionFailed'));
  return ok;
}

function targetLabel(target, byId) {
  if (target.type === 'market') return L('NCI.Controls.WholeMarket');
  if (target.type === 'sector') return L(`NCI.Sector.${target.id}`);
  return byId.get(target.id)?.ticker ?? target.id;
}

export class GMConsoleApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    id: 'nci-gm-console',
    window: { title: 'NCI.GMConsole.Title', icon: 'fas fa-sliders' },
    position: { width: 760, height: 680 },
    actions: {
      switchTab: GMConsoleApp._onTab,
      advance: GMConsoleApp._onAdvance,
      advanceDay: GMConsoleApp._onAdvanceDay,
      advanceCustom: GMConsoleApp._onAdvanceCustom,
      resetMarket: GMConsoleApp._onReset,
      newCompany: GMConsoleApp._onNew,
      editCompany: GMConsoleApp._onEdit,
      deleteCompany: GMConsoleApp._onDelete,
      importStarter: GMConsoleApp._onImportStarter,
      addBias: GMConsoleApp._onAddBias,
      removeBias: GMConsoleApp._onRemoveBias,
      forceRegime: GMConsoleApp._onForceRegime,
      clearRegime: GMConsoleApp._onClearRegime,
      setVolatility: GMConsoleApp._onSetVolatility,
      toggleHalt: GMConsoleApp._onToggleHalt,
      addShock: GMConsoleApp._onAddShock,
      removeImpact: GMConsoleApp._onRemoveImpact,
      postNews: GMConsoleApp._onPostNews,
      setPrice: GMConsoleApp._onSetPrice,
      specialDividend: GMConsoleApp._onSpecialDividend,
      splitStock: GMConsoleApp._onSplit,
      buyoutStock: GMConsoleApp._onBuyout,
      delistStock: GMConsoleApp._onDelist,
      bankruptStock: GMConsoleApp._onBankrupt,
      newFund: GMConsoleApp._onNewFund,
      editFund: GMConsoleApp._onEditFund,
      closeFund: GMConsoleApp._onCloseFund,
      importFunds: GMConsoleApp._onImportFunds,
      addBrokerActor: GMConsoleApp._onAddBrokerActor,
      addBrokerContact: GMConsoleApp._onAddBrokerContact,
      toggleBroker: GMConsoleApp._onToggleBroker,
      removeBroker: GMConsoleApp._onRemoveBroker,
      saveBroker: GMConsoleApp._onSaveBroker,
      toggleGrant: GMConsoleApp._onToggleGrant,
      undoTick: GMConsoleApp._onUndo,
      previewBias: GMConsoleApp._onPreviewBias,
      previewShock: GMConsoleApp._onPreviewShock,
      previewGlide: GMConsoleApp._onPreviewGlide,
      addGlide: GMConsoleApp._onAddGlide,
      removeGlide: GMConsoleApp._onRemoveGlide,
      listNow: GMConsoleApp._onListNow,
      gigApprove: GMConsoleApp._onGigApprove,
      gigDiscard: GMConsoleApp._onGigDiscard,
      gigMap: GMConsoleApp._onGigMap,
      gigAddMapping: GMConsoleApp._onGigAddMapping,
      gigRemoveMapping: GMConsoleApp._onGigRemoveMapping,
      gigReport: GMConsoleApp._onGigReport,
      gigClearHistory: GMConsoleApp._onGigClearHistory,
      heatApprove: GMConsoleApp._onHeatApprove,
      heatDismiss: GMConsoleApp._onHeatDismiss,
      heatSet: GMConsoleApp._onHeatSet,
      heatClear: GMConsoleApp._onHeatClear,
      runCheck: GMConsoleApp._onRunCheck,
      createMacros: GMConsoleApp._onCreateMacros,
      createSuggested: GMConsoleApp._onCreateSuggested,
      ignoreSuggested: GMConsoleApp._onIgnoreSuggested,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/gm/console.hbs` },
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
  }

  _onClose(options) {
    Hooks.off(HOOKS.MARKET_UPDATED, this._refresh);
    Hooks.off(HOOKS.COMPANIES_CHANGED, this._refresh);
    Hooks.off(HOOKS.GIGS_CHANGED, this._refresh);
    Hooks.off(HOOKS.HEAT_CHANGED, this._refresh);
    super._onClose?.(options);
  }

  // ── Clock and companies ────────────────────────────────────────────────────

  static _onTab(event, target) {
    if (TABS.includes(target.dataset.tab)) this.tab = target.dataset.tab;
    this.render();
  }

  static async _onAdvance(event, target) {
    await TickService.advance(Number(target.dataset.days) || 1);
  }

  static async _onAdvanceDay(event, target) {
    await TickService.advanceDays(Number(target.dataset.days) || 1);
  }

  static async _onAdvanceCustom(event, target) {
    const days = Math.floor(Number(field(target, 'customDays')));
    if (!(days >= 1)) return ui.notifications.warn(L('NCI.GMConsole.InvalidDays'));
    await TickService.advance(days);
  }

  static async _onReset() {
    if (!(await confirm(L('NCI.GMConsole.Reset'), L('NCI.GMConsole.ResetConfirm')))) return;
    await TickService.reset();
  }

  static _onNew() {
    CompanyEditorApp.edit(null);
  }

  static _onEdit(event, target) {
    CompanyEditorApp.edit(target.dataset.id);
  }

  static async _onDelete(event, target) {
    const company = CompanyRepository.get(target.dataset.id);
    if (!company) return;
    if (!(await confirm(L('NCI.GMConsole.DeleteCompany'), L('NCI.GMConsole.DeleteConfirm', { name: company.name })))) return;
    await CompanyRepository.remove(company.id);
  }

  static async _onImportStarter() {
    const { created, skipped } = await ImportService.importStarter();
    ui.notifications.info(L('NCI.GMConsole.ImportDone', { created, skipped }));
  }

  // ── Market controls ────────────────────────────────────────────────────────

  static async _onAddBias(event, target) {
    report(await MarketControlService.addBias({
      target: field(target, 'biasTarget'),
      value: Number(field(target, 'biasValue')),
      days: Number(field(target, 'biasDays')),
      decay: field(target, 'biasDecay'),
    }));
  }

  static async _onRemoveBias(event, target) {
    await MarketControlService.removeBias(target.dataset.id);
  }

  static async _onForceRegime(event, target) {
    report(await MarketControlService.forceRegime(field(target, 'regime'), Number(field(target, 'regimeDays'))));
  }

  static async _onClearRegime() {
    await MarketControlService.clearRegime();
  }

  static async _onSetVolatility(event, target) {
    report(await MarketControlService.setVolatility(Number(field(target, 'volMult'))));
  }

  static async _onToggleHalt(event, target) {
    await MarketControlService.setHalt(target.dataset.halted !== 'true');
  }

  // ── Events ────────────────────────────────────────────────────────────────

  static async _onAddShock(event, target) {
    report(await MarketControlService.addShock({
      target: field(target, 'shockTarget'),
      percent: Number(field(target, 'shockPercent')),
      delayDays: Number(field(target, 'shockDelay')),
      persistence: field(target, 'shockPersistence'),
      headline: field(target, 'shockHeadline') ?? '',
    }));
  }

  static async _onRemoveImpact(event, target) {
    await MarketControlService.removeImpact(target.dataset.id);
  }

  static async _onPostNews(event, target) {
    const company = field(target, 'newsCompany');
    const item = await NewsService.post({
      headline: field(target, 'newsHeadline') ?? '',
      tone: field(target, 'newsTone'),
      companyIds: company ? [company] : [],
    });
    report(!!item);
  }

  static async _onSetPrice(event, target) {
    report(await CorporateActionService.setPrice(field(target, 'priceCompany'), Number(field(target, 'priceValue')), {
      alsoFair: !!field(target, 'priceFair'),
    }));
  }

  // ── Corporate actions ──────────────────────────────────────────────────────

  static async _onSpecialDividend(event, target) {
    report(await DividendService.declareSpecial(field(target, 'divCompany'), Number(field(target, 'divAmount'))));
  }

  static async _onSplit(event, target) {
    const id = field(target, 'splitCompany');
    const ratio = Math.floor(Number(field(target, 'splitRatio')));
    const company = CompanyRepository.get(id);
    if (!company || !(await confirm(L('NCI.Actions.Split'), L('NCI.Actions.SplitConfirm', { name: company.name, ratio })))) return;
    report(await CorporateActionService.split(id, ratio));
  }

  static async _onBuyout(event, target) {
    const id = field(target, 'buyoutCompany');
    const price = Number(field(target, 'buyoutPrice'));
    const company = CompanyRepository.get(id);
    if (!company || !(await confirm(L('NCI.Actions.Buyout'), L('NCI.Actions.BuyoutConfirm', { name: company.name, price: money(price) })))) return;
    report(await CorporateActionService.buyout(id, price));
  }

  static async _onDelist(event, target) {
    const id = field(target, 'endCompany');
    const company = CompanyRepository.get(id);
    if (!company || !(await confirm(L('NCI.Actions.Delist'), L('NCI.Actions.DelistConfirm', { name: company.name })))) return;
    report(await CorporateActionService.delist(id));
  }

  static async _onBankrupt(event, target) {
    const id = field(target, 'endCompany');
    const company = CompanyRepository.get(id);
    if (!company || !(await confirm(L('NCI.Actions.Bankrupt'), L('NCI.Actions.BankruptConfirm', { name: company.name })))) return;
    report(await CorporateActionService.bankrupt(id));
  }

  // ── Funds and brokers ──────────────────────────────────────────────────────

  static _onNewFund() {
    FundEditorApp.edit(null);
  }

  static _onEditFund(event, target) {
    FundEditorApp.edit(target.dataset.id);
  }

  static async _onCloseFund(event, target) {
    const fund = FundRepository.get(target.dataset.id);
    if (!fund || !(await confirm(L('NCI.GMConsole.CloseFund'), L('NCI.GMConsole.CloseFundConfirm', { name: fund.name })))) return;
    report((await FundService.liquidate(fund.id)).ok);
  }

  static async _onImportFunds() {
    const { created, skipped } = await FundService.importStarter();
    ui.notifications.info(L('NCI.GMConsole.ImportDone', { created, skipped }));
  }

  static async _onAddBrokerActor(event, target) {
    const id = field(target, 'brokerActor');
    if (!id) return;
    report(await BrokerRepository.makeBrokerFromActor(id));
    this.render();
  }

  static async _onAddBrokerContact(event, target) {
    const id = field(target, 'brokerContact');
    if (!id) return;
    report(await BrokerRepository.makeBrokerFromContact(id));
    this.render();
  }

  static async _onToggleBroker(event, target) {
    await BrokerRepository.setDef(target.dataset.id, { enabled: target.dataset.enabled !== 'true' });
    this.render();
  }

  static async _onRemoveBroker(event, target) {
    const broker = BrokerRepository.get(target.dataset.id);
    if (!broker) return;
    if (!(await confirm(L('NCI.GMConsole.RemoveBroker'), L('NCI.GMConsole.RemoveBrokerConfirm', { name: broker.name })))) return;
    const out = await BrokerRepository.remove(broker.id);
    if (out.ok) ui.notifications.info(L('NCI.GMConsole.BrokerRemoved', { name: broker.name }));
    else ui.notifications.warn(L(`NCI.GMConsole.RemoveBrokerRefused.${out.reason}`, { names: (out.names ?? []).join(', ') }));
    this.render();
  }

  /** Save the manual rating and minimum withdrawal in this broker's table row. */
  static async _onSaveBroker(event, target) {
    const row = target.closest('tr');
    const manual = row?.querySelector('[name="manualTotal"]');
    const patch = { minWithdrawal: Math.max(0, Math.floor(Number(row?.querySelector('[name="minWithdrawal"]')?.value) || 0)) };
    if (manual) patch.manualTotal = Math.max(0, Math.min(30, Math.floor(Number(manual.value) || 0)));
    report(await BrokerRepository.setDef(target.dataset.id, patch));
    this.render();
  }

  static async _onToggleGrant(event, target) {
    const actor = game.actors.get(target.dataset.id);
    if (!actor) return;
    await TerminalAccess.setGrant(actor, !TerminalAccess.granted(actor));
    this.render();
  }

  // ── Undo, preview, glides, listings ────────────────────────────────────────

  static async _onUndo() {
    const out = await UndoService.undo();
    if (out.ok) ui.notifications.info(L('NCI.GMConsole.UndoDone', { tick: out.tickIndex }));
    else ui.notifications.warn(L(`NCI.GMConsole.Undo.${out.reason}`));
  }

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

  static _onPreviewBias(event, target) {
    this._togglePreview('bias', () => {
      const days = Number(field(target, 'biasDays'));
      const scenario = {
        kind: 'bias', target: field(target, 'biasTarget'), value: Number(field(target, 'biasValue')), days, decay: field(target, 'biasDecay'),
      };
      this._showPreview(scenario, Math.min(120, Math.max(30, days + 10)), L('NCI.Controls.Sentiment'));
    });
  }

  static _onPreviewShock(event, target) {
    this._togglePreview('shock', () => {
      const delayDays = Number(field(target, 'shockDelay'));
      const scenario = {
        kind: 'shock', target: field(target, 'shockTarget'), percent: Number(field(target, 'shockPercent')), delayDays, persistence: field(target, 'shockPersistence'),
      };
      this._showPreview(scenario, Math.min(120, 30 + delayDays), L('NCI.Controls.ShockTitle'));
    });
  }

  static _onPreviewGlide(event, target) {
    this._togglePreview('glide', () => {
      const days = Math.floor(Number(field(target, 'glideDays')));
      const scenario = {
        kind: 'glide',
        companyId: field(target, 'glideCompany'),
        target: Number(field(target, 'glideTarget')),
        days,
        noise: GLIDE_NOISE[field(target, 'glideNoise')] ?? GLIDE_NOISE.medium,
      };
      this._showPreview(scenario, Math.min(120, Math.max(14, days + 5)), L('NCI.Glide.Title'));
    });
  }

  static async _onAddGlide(event, target) {
    report(await MarketControlService.addGlide({
      companyId: field(target, 'glideCompany'),
      target: Number(field(target, 'glideTarget')),
      days: Number(field(target, 'glideDays')),
      noise: field(target, 'glideNoise'),
    }), 'NCI.Glide.Started');
  }

  static async _onRemoveGlide(event, target) {
    await MarketControlService.removeGlide(target.dataset.id);
  }

  static async _onListNow(event, target) {
    const company = CompanyRepository.get(target.dataset.id);
    if (!company || !(await confirm(L('NCI.Ipo.ListNow'), L('NCI.Ipo.ListNowConfirm', { name: company.name })))) return;
    report((await IpoService.listNow(company.id))?.ok);
  }

  // ── Gig outcomes ───────────────────────────────────────────────────────────

  static async _onGigApprove(event, target) {
    const edits = {
      percent: Number(gigField(target, 'gigPercent')?.value),
      delayDays: Number(gigField(target, 'gigDelay')?.value),
      headline: gigField(target, 'gigHeadline')?.value ?? '',
    };
    gigResult(await GigImpactService.approve(target.dataset.id, edits));
  }

  static async _onGigDiscard(event, target) {
    await GigImpactService.discard(target.dataset.id);
  }

  static async _onGigMap(event, target) {
    const choice = gigField(target, 'gigCompany')?.value;
    if (!choice) return ui.notifications.warn(L('NCI.Gig.ChooseCompany'));
    const remember = gigField(target, 'gigRemember')?.checked !== false;
    await GigImpactService.mapClient(target.dataset.id, choice, { remember });
  }

  static async _onGigAddMapping(event, target) {
    const client = field(target, 'mapClientName');
    const choice = field(target, 'mapCompany');
    if (!String(client ?? '').trim() || !choice) return ui.notifications.warn(L('NCI.Gig.Result.invalid'));
    report((await GigImpactService.addMapping(client, choice))?.ok);
  }

  static async _onGigRemoveMapping(event, target) {
    await GigImpactService.removeMapping(target.dataset.key);
  }

  static async _onGigReport(event, target) {
    const out = await GigImpactService.reportManual({
      client: field(target, 'reportClient') ?? '',
      outcome: field(target, 'reportOutcome'),
      reward: field(target, 'reportReward'),
      companyId: field(target, 'reportCompany') ?? '',
    });
    gigResult(out);
  }

  static async _onGigClearHistory() {
    await GigImpactService.clearHistory();
  }

  // ── Heat ───────────────────────────────────────────────────────────────────

  static async _onHeatApprove(event, target) {
    const card = target.closest('.nci-gig');
    const read = (name) => card?.querySelector(`[name="${name}"]`)?.value;
    const out = await HeatService.approvePenalty(target.dataset.id, { amount: read('penaltyAmount'), days: read('penaltyDays') });
    ui.notifications[out?.ok ? 'info' : 'warn'](L(`NCI.Heat.Result.${out?.ok ? 'ok' : (out?.status ?? 'invalid')}`));
  }

  static async _onHeatDismiss(event, target) {
    await HeatService.dismissPenalty(target.dataset.id);
  }

  static async _onHeatSet(event, target) {
    const value = target.closest('tr')?.querySelector('[name="heatValue"]')?.value;
    const out = await HeatService.setHeat(target.dataset.id, value);
    if (!out?.ok) ui.notifications.warn(L(`NCI.Heat.Result.${out?.status ?? 'invalid'}`));
  }

  static async _onHeatClear(event, target) {
    await HeatService.setHeat(target.dataset.id, 0);
  }

  // ── Tools ──────────────────────────────────────────────────────────────────

  static _onRunCheck() {
    this.checkReport = DiagnosticsService.verify({ silent: true });
    this.render();
  }

  static async _onCreateMacros() {
    const { created, skipped } = await MacroService.createDefaults();
    ui.notifications.info(L('NCI.Tools.MacrosDone', { created, skipped }));
  }

  static _onCreateSuggested(event, target) {
    CompanyEditorApp.edit(null, { name: target.dataset.name, ticker: target.dataset.ticker });
  }

  static async _onIgnoreSuggested(event, target) {
    await GigImpactService.addMapping(target.dataset.name, 'ignore');
    this.render();
  }

  _toolsContext() {
    const report = this.checkReport;
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

  // ── Context ────────────────────────────────────────────────────────────────

  _gigsContext(companyOptions) {
    const gigs = MarketStore.getGigs();
    const byId = new Map(CompanyRepository.all({ includeUnlisted: true }).map((c) => [c.id, c]));
    const label = (id) => (byId.has(id) ? `${byId.get(id).ticker} ${byId.get(id).name}` : id);
    const sign = (n) => `${n > 0 ? '+' : ''}${n}`;
    const base = (p) => ({
      id: p.id,
      title: p.title,
      client: p.client || '—',
      outcome: L(`NCI.Gig.Outcome.${p.outcome}`),
      up: p.outcome === 'done',
      reward: Number(p.reward ?? 0).toLocaleString(),
      date: p.date,
      reason: p.reason ? L(`NCI.Gig.Reason.${p.reason}`) : '',
    });

    return {
      bridge: !!game.modules?.get(BRIDGE_ID)?.active,
      approval: GigImpactService.approvalRequired(),
      needsMapping: gigs.pending.filter((p) => p.kind === 'mapping').map((p) => ({
        ...base(p),
        possible: p.candidates?.length ? L('NCI.Gig.Possible', { names: p.candidates.map(label).join(', ') }) : '',
        options: companyOptions.map((o) => ({ ...o, selected: o.value === p.candidates?.[0] })),
      })),
      review: gigs.pending.filter((p) => p.kind === 'review').map((p) => ({
        ...base(p),
        company: label(p.companyId),
        percent: p.percent,
        delayDays: p.delayDays,
        headline: p.headline ?? '',
        how: L(`NCI.Gig.How.${p.how}`),
      })),
      mappings: Object.entries(gigs.mappings).map(([key, m]) => ({
        key,
        label: m.label,
        target: m.companyId === 'ignore' ? L('NCI.Gig.Ignore') : label(m.companyId),
      })),
      history: gigs.history.slice(-15).reverse().map((h) => ({
        ...base(h),
        company: h.companyId ? label(h.companyId) : '—',
        status: L(`NCI.Gig.Status.${h.status}`),
        applied: h.status === 'applied',
        effect: h.status === 'applied' ? `${sign(h.percent)}%` : '',
      })),
      outcomes: ['done', 'failed'].map((o) => ({ value: o, label: L(`NCI.Gig.Outcome.${o}`) })),
    };
  }

  _heatContext(companyOptions) {
    const snap = HeatService.snapshot();
    const label = new Map(companyOptions.map((o) => [o.value, o.label]));
    const company = (id) => label.get(id) ?? id;
    const dir = (d) => L(`NCI.Heat.Direction.${d}`);
    const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
    const lastOf = (c) => {
      const e = c.log.at(-1);
      if (!e) return '';
      if (e.action) return L('NCI.Heat.LastAction', { gain: signed(e.gain), what: L(`NCI.Heat.ActionName.${e.action}`), date: e.date });
      return L('NCI.Heat.LastGain', { gain: signed(e.gain), company: company(e.companyId), date: e.date });
    };
    const penaltyText = (p) => L(`NCI.Heat.Penalty.${p.kind}`, { amount: Number(p.params.amount ?? 0).toLocaleString(), days: p.params.days ?? p.params.banDays ?? 0 });
    const doneText = (p) => {
      if (p.status !== 'applied' || !p.result) return '';
      if (p.kind === 'fine') return L('NCI.Heat.PenaltyDone.fine', { paid: Number(p.result.paid).toLocaleString(), short: p.result.shortfall > 0 ? L('NCI.Heat.ShortBy', { amount: Number(p.result.shortfall).toLocaleString() }) : '' });
      if (p.kind === 'freeze') return L('NCI.Heat.PenaltyDone.freeze', { until: Math.ceil(p.result.untilTick - 1e-6) });
      return L(p.result.dropped ? 'NCI.Heat.PenaltyDone.dropBroker' : 'NCI.Heat.PenaltyDone.dropBrokerNone');
    };
    const penalty = (p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      isFine: p.kind === 'fine',
      amount: p.params.amount,
      days: p.params.days ?? p.params.banDays,
      daysLabel: L(p.kind === 'freeze' ? 'NCI.Heat.FreezeDays' : 'NCI.Heat.BanDays'),
      text: penaltyText(p),
      line: L('NCI.Heat.PenaltyLine', { kind: L(`NCI.Heat.Status.${p.status}`), heat: p.heat, date: p.date }),
      status: L(`NCI.Heat.Status.${p.status}`),
      done: doneText(p),
    });

    return {
      enabled: HeatService.enabled(),
      consequences: HeatService.consequencesOn(),
      approval: HeatService.approvalRequired(),
      tiers: ['quiet', 'noticed', 'flagged', 'investigated'].map((t) => ({ id: t, label: L(`NCI.Heat.Tier.${t}`), hint: L(`NCI.Heat.TierHint.${t}`) })),
      characters: snap.characters.map((c) => ({
        actorId: c.actorId,
        name: c.name,
        heat: c.heat,
        width: Math.min(100, Math.round(c.heat)),
        tier: c.tier,
        tierLabel: L(`NCI.Heat.Tier.${c.tier}`),
        updated: c.tick,
        last: lastOf(c),
        cover: c.cover ? L('NCI.Heat.Covered', { n: daysInclusive(c.cover.until, snap.tick) }) : '',
      })),
      pendingPenalties: snap.penalties.filter((p) => p.status === 'pending').map(penalty),
      penaltyHistory: snap.penalties.filter((p) => p.status !== 'pending').slice(-8).reverse().map(penalty),
      open: snap.windows.filter((w) => w.status === 'open').map((w) => ({
        company: company(w.companyId),
        direction: dir(w.direction),
        up: w.direction === 'up',
        closes: w.closeTick >= snap.tick - 1e-6 ? L('NCI.Heat.ClosesIn', { n: daysInclusive(w.closeTick, snap.tick) }) : L('NCI.Heat.AwaitingFills'),
        tipped: w.tipped.length,
        opened: w.openDate,
      })),
      audits: snap.audits.slice(-8).reverse().map((a) => ({
        date: a.date,
        company: company(a.companyId),
        direction: dir(a.direction),
        up: a.direction === 'up',
        quiet: !a.results.length,
        results: a.results.map((r) => ({
          name: r.name,
          gain: r.applied ?? r.gain,
          covered: r.covered ? L('NCI.Heat.CoverHalved', { gain: r.gain }) : '',
          trades: r.trades.map((t) => L('NCI.Heat.Trade', {
            side: L(`NCI.Side.${t.side}`), gross: Number(t.gross).toLocaleString(), route: L(`NCI.Route.${t.route}`), knowledge: L(`NCI.Heat.Knowledge.${t.knowledge}`), gain: t.gain,
          })),
        })),
      })),
    };
  }

  _fundsContext(pub) {
    return FundRepository.all().map((f) => ({
      id: f.id,
      ticker: f.ticker,
      name: f.name,
      kind: L(`NCI.FundKind.${f.kind}`),
      nav: pub.funds?.[f.id] ? money(pub.funds[f.id].nav) : '—',
      holdings: f.components.length,
      fees: `${(f.expenseRatio * 100).toFixed(2)}% / ${f.loadBps}-${f.exitBps} bps`,
    }));
  }

  _brokersContext() {
    const direct = TradingSettings.direct();
    const useOf = (id) => {
      const use = BrokerRepository.usage(id);
      const names = [...use.assigned, ...use.busy];
      return { inUse: names.length ? L('NCI.GMConsole.BrokerInUse', { names: names.join(', ') }) : '', canRemove: !names.length };
    };
    const brokers = BrokerRepository.list().map((b) => ({
      ...useOf(b.id),
      id: b.id,
      name: b.name,
      source: b.skill.source === 'sheet' ? L('NCI.GMConsole.SkillSheet') : L('NCI.GMConsole.SkillManual'),
      manual: b.skill.source === 'manual',
      noSkillItem: b.skill.source === 'sheet' && !b.skill.found,
      total: b.skill.total,
      grade: L(`NCI.Grade.${b.grade}`),
      voice: b.personality ? L(`NCI.Voice.${b.personality}`) : L('NCI.Voice.standard'),
      commission: `${(b.terms.commissionBps / 100).toFixed(2)}%`,
      flatFee: b.terms.flatFee,
      days: b.terms.latency.min === b.terms.latency.max ? `${b.terms.latency.min}` : `${b.terms.latency.min}-${b.terms.latency.max}`,
      enabled: b.enabled,
      minWithdrawal: b.minWithdrawal,
    }));
    const actors = game.actors.filter((a) => a.hasPlayerOwner);
    return {
      brokers,
      direct: { commission: `${(direct.commissionBps / 100).toFixed(2)}%`, flatFee: direct.flatFee, dv: direct.dv, network: direct.network },
      terminalMode: TradingSettings.mode() === 'terminal',
      actorOptions: game.actors.filter((a) => a.type === 'character' || a.type === 'npc').map((a) => ({ value: a.id, label: a.name })),
      contactOptions: BrokerRepository.candidateContacts().map((c) => ({ value: c.id, label: c.name })),
      grants: actors.map((a) => ({ id: a.id, name: a.name, granted: TerminalAccess.granted(a) })),
    };
  }
  async _prepareContext() {
    const pub = MarketStore.getPublic();
    const hidden = MarketStore.getHidden();
    const controls = MarketStore.getControls();
    const companies = CompanyRepository.all({ includeUnlisted: true });
    const byId = new Map(companies.map((c) => [c.id, c]));
    const tick = pub.tickIndex ?? 0;
    // Every duration below is on the market clock, in game days.
    const time = pub.time ?? tick;
    const tickMode = game.settings.get(MODULE_ID, SETTINGS.TICK_MODE);

    const biases = controls.biases.map((b) => ({
      id: b.id,
      label: `${targetLabel(b.target, byId)}: ${b.value > 0 ? '+' : ''}${b.value}σ`,
      left: daysLeft(b.startTick + b.duration, time),
      decay: L(`NCI.Controls.Decay.${b.decay}`),
      pending: b.startTick > time + 1e-6,
    }));

    const impacts = controls.impacts.map((i) => ({
      id: i.id,
      label: `${targetLabel(i.target, byId)}: ${i.meta?.percent > 0 ? '+' : ''}${i.meta?.percent ?? '?'}%`,
      persistence: i.source === 'gig' ? L('NCI.Gig.Source') : i.meta?.persistence ? L(`NCI.Controls.Persistence.${i.meta.persistence}`) : '',
      starts: i.onsetTick > time + 1e-6 ? L('NCI.Controls.StartsIn', { n: daysLeft(i.onsetTick, time) }) : L('NCI.Controls.Active'),
    }));

    const log = controls.log.slice(-10).reverse().map((e) => ({
      tick: Math.floor(e.tick + 1e-6),
      text: L(`NCI.Log.${e.kind}`, {
        target: e.target ? (parseTarget(e.target) ? targetLabel(parseTarget(e.target), byId) : e.target) : '',
        company: byId.get(e.companyId)?.ticker ?? e.companyId ?? '',
        value: e.value ?? '', days: e.days ?? '', percent: e.percent ?? '', regime: e.regime ?? '',
        from: e.from ?? '', to: e.to ?? '', halted: e.halted ? L('NCI.Controls.Halted') : L('NCI.Controls.Resumed'),
      }),
    }));

    const glides = controls.glides.map((g) => ({
      id: g.id,
      label: L('NCI.Glide.Line', { company: byId.get(g.companyId)?.ticker ?? g.companyId, target: money(g.target) }),
      status: g.startTick > time + 1e-6
        ? L('NCI.Glide.StartsIn', { n: daysLeft(g.startTick, time), days: g.duration })
        : L('NCI.Glide.Left', { n: daysLeft(g.startTick + g.duration, time) }),
    }));
    const today = dayIndex(MarketClock.nowMs());
    const ipoText = (c) => {
      const st = ipoStatus(c, today);
      if (st.state === 'none') return '';
      return st.state === 'due' ? L('NCI.Ipo.ListingToday') : L(st.state === 'window' ? 'NCI.Ipo.WindowOpen' : 'NCI.Ipo.ListsOn', { n: st.daysToList, date: c.ipo.date });
    };

    const companyOptions = companies.map((c) => ({ value: c.id, label: `${c.ticker} ${c.name}` }));
    const gigCounts = GigImpactService.counts();

    return {
      previewBias: this.preview?.kind === 'bias' ? this.preview : null,
      previewShock: this.preview?.kind === 'shock' ? this.preview : null,
      previewGlide: this.preview?.kind === 'glide' ? this.preview : null,
      canUndo: UndoService.available(),
      glides,
      glideNoises: Object.keys(GLIDE_NOISE).map((k) => ({ value: k, label: L(`NCI.Glide.NoiseLevel.${k}`), selected: k === 'medium' })),
      tab: this.tab,
      tabs: TABS.map((t) => ({
        id: t,
        label: t === 'gigs' && gigCounts.review + gigCounts.mapping ? `${L('NCI.GMConsole.Tab.gigs')} (${gigCounts.review + gigCounts.mapping})` : L(`NCI.GMConsole.Tab.${t}`),
        active: t === this.tab,
      })),
      isMarket: this.tab === 'market',
      isEvents: this.tab === 'events',
      isActions: this.tab === 'actions',
      isCompanies: this.tab === 'companies',
      isFunds: this.tab === 'funds',
      isBrokers: this.tab === 'brokers',
      isGigs: this.tab === 'gigs',
      isHeat: this.tab === 'heat',
      isTools: this.tab === 'tools',
      tools: this.tab === 'tools' ? this._toolsContext() : null,
      heat: this.tab === 'heat' ? this._heatContext(companyOptions) : null,
      gig: this.tab === 'gigs' ? this._gigsContext(companyOptions) : null,
      funds: this.tab === 'funds' ? this._fundsContext(pub) : [],
      broker: this.tab === 'brokers' ? this._brokersContext() : null,
      hasState: !!pub.schema,
      activeGM: game.user.id === game.users.activeGM?.id,
      mode: L(`NCI.Settings.TickMode.${{ worldTime: 'WorldTime', realTime: 'RealTime', manual: 'Manual' }[tickMode]}`),
      date: MarketClock.dateString(),
      tick,
      gameDay: Math.floor(time + 1e-6),
      mood: pub.mood ? L(`NCI.Mood.${pub.mood}`) : '—',
      regime: hidden?.regime ? L(`NCI.Regime.${hidden.regime}`) : '—',
      forcedRegime: controls.forceRegime
        ? L('NCI.Controls.ForcedRegime', { regime: L(`NCI.Regime.${controls.forceRegime.regime}`), n: daysLeft(controls.forceRegime.untilTick, time) })
        : '',
      volMult: controls.volMult,
      haltAll: controls.haltAll,
      biases,
      impacts,
      log,
      targets: MarketControlService.targetOptions(),
      regimes: REGIMES.map((r) => ({ value: r, label: L(`NCI.Regime.${r}`) })),
      persistences: Object.keys(SHOCK_PERSISTENCE).map((p) => ({ value: p, label: L(`NCI.Controls.Persistence.${p}`), selected: p === 'standard' })),
      companyOptions,
      companies: companies.map((c) => ({
        id: c.id,
        ticker: c.ticker,
        name: c.name,
        sector: L(`NCI.Sector.${c.sector}`),
        price: pub.companies?.[c.id] ? money(pub.companies[c.id].price) : '—',
        status: L(`NCI.Status.${c.status}`),
        listed: c.listed,
        ipoText: ipoText(c),
        canList: !c.listed && !!pub.companies?.[c.id],
      })),
    };
  }
}
