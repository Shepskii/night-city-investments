/**
 * Market Terminal: the player's main window (Market and Portfolio tabs).
 * @file scripts/ui/MarketTerminal/MarketTerminalApp.js
 */

import {
  quote, getSeries, rangeStats, equalWeightIndex, valuePortfolio, latestNews, OPEN, timeOf,
} from '../../engine/index.js';
import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { CompanyRepository } from '../../data/CompanyRepository.js';
import { FundRepository } from '../../data/FundRepository.js';
import { MarketStore } from '../../data/MarketStore.js';
import { PortfolioRepository } from '../../data/PortfolioRepository.js';
import { MarketClock } from '../../services/MarketClockService.js';
import { PortfolioClient } from '../../services/PortfolioClient.js';
import { TerminalAccess } from '../../services/TerminalAccess.js';
import { describeOrder } from '../../services/PortfolioWatcher.js';
import { BaseApplication } from '../BaseApplication.js';
import { TradeDialogApp } from '../TradeDialog/TradeDialogApp.js';
import { BusinessApp } from '../Business/BusinessApp.js';
import { sparkline, lineChart } from '../components/chart.js';
import { L, money, whole, signed, pct, trendClass } from '../format.js';
import { fundRows, fundDetail, accessContext, ipoRows, heatContext } from './context.js';
import { ipoPrice, shareOf, bookValue } from '../../engine/index.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { SyndicateClient } from '../../services/SyndicateClient.js';
import { accountFor, tradingAccounts, ownerOf } from '../accounts.js';
import { syndicateContext, characterSyndicates } from './syndicateContext.js';

const RANGES = [30, 90, 365];
const HISTORY_ROWS = 10;
const LEDGER_ROWS = 15;

function dividendText(d) {
  if (!d || d.policy === 'none') return L('NCI.Terminal.NoDividend');
  const freq = L(`NCI.Frequency.${d.frequency}`);
  if (d.policy === 'fixed') return L('NCI.Terminal.DividendFixed', { amount: money(d.perShare), freq });
  return L('NCI.Terminal.DividendYield', { pct: (d.yield * 100).toFixed(2), freq });
}

export class MarketTerminalApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    id: 'nci-market-terminal',
    window: { title: 'NCI.Terminal.Title', icon: 'fas fa-chart-line' },
    position: { width: 1100, height: 640 },
    actions: {
      select: MarketTerminalApp._onSelect,
      openAsset: MarketTerminalApp._onOpenAsset,
      back: MarketTerminalApp._onBack,
      range: MarketTerminalApp._onRange,
      switchTab: MarketTerminalApp._onTab,
      trade: MarketTerminalApp._onTrade,
      deposit: MarketTerminalApp._onDeposit,
      withdraw: MarketTerminalApp._onWithdraw,
      cancelOrder: MarketTerminalApp._onCancelOrder,
      watch: MarketTerminalApp._onWatch,
      drip: MarketTerminalApp._onDrip,
      connectTerminal: MarketTerminalApp._onConnectTerminal,
      cancelWithdrawal: MarketTerminalApp._onCancelWithdrawal,
      subscribeIpo: MarketTerminalApp._onSubscribeIpo,
      addAlert: MarketTerminalApp._onAddAlert,
      removeAlert: MarketTerminalApp._onRemoveAlert,
      requestStatement: MarketTerminalApp._onRequestStatement,
      manageBusiness: MarketTerminalApp._onManageBusiness,
      coverTracks: MarketTerminalApp._onCoverTracks,
      synFound: MarketTerminalApp._onSynFound,
      synJoin: MarketTerminalApp._onSynJoin,
      synDecline: MarketTerminalApp._onSynDecline,
      synOpen: MarketTerminalApp._onSynOpen,
      synDeposit: MarketTerminalApp._onSynDeposit,
      synRedeem: MarketTerminalApp._onSynRedeem,
      synLeave: MarketTerminalApp._onSynLeave,
      synVote: MarketTerminalApp._onSynVote,
      synPropose: MarketTerminalApp._onSynPropose,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/terminal/market.hbs` },
  };

  tab = 'market';
  selectedId = null;
  /** The tab a company page was opened from, so "Back" returns there. */
  cameFrom = null;
  range = 90;
  actorId = PortfolioRepository.defaultActor()?.id ?? null;
  _refresh = () => this.render();

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    for (const hook of [HOOKS.MARKET_UPDATED, HOOKS.COMPANIES_CHANGED, HOOKS.PORTFOLIO_UPDATED, HOOKS.BUSINESSES_CHANGED, HOOKS.SYNDICATES_CHANGED]) Hooks.on(hook, this._refresh);
  }

  _onClose(options) {
    for (const hook of [HOOKS.MARKET_UPDATED, HOOKS.COMPANIES_CHANGED, HOOKS.PORTFOLIO_UPDATED, HOOKS.BUSINESSES_CHANGED, HOOKS.SYNDICATES_CHANGED]) Hooks.off(hook, this._refresh);
    super._onClose?.(options);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    el.querySelector('select[name="actorId"]')?.addEventListener('change', (event) => {
      this.actorId = event.target.value;
      this.render();
    });
    el.querySelector('select[name="brokerId"]')?.addEventListener('change', (event) => {
      if (this.actor) PortfolioClient.setBroker(this.actor, event.target.value);
    });
    el.querySelector('input[name="moverPct"]')?.addEventListener('change', (event) => {
      if (this.actor) PortfolioClient.setMoverPct(this.actor, event.target.value);
    });
    el.querySelectorAll('select[data-notify]').forEach((select) => {
      select.addEventListener('change', (event) => {
        if (this.actor) PortfolioClient.setNotify(this.actor, event.target.dataset.notify, event.target.value);
      });
    });
  }

  /** The picked account: a character, or a syndicate traded as one of its members (DESIGN §31). */
  get actor() {
    return accountFor(this.actorId);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  static _onSelect(event, target) {
    this.selectedId = target.dataset.id;
    this.cameFrom = null;
    this.render();
  }

  /** From a holding on the Portfolio tab: open that company's (or fund's) market page. */
  static _onOpenAsset(event, target) {
    this.selectedId = target.dataset.id;
    this.cameFrom = 'portfolio';
    this.tab = 'market';
    this.render();
  }

  static _onBack() {
    this.selectedId = null;
    if (this.cameFrom) this.tab = this.cameFrom;
    this.cameFrom = null;
    this.render();
  }

  static _onRange(event, target) {
    this.range = Number(target.dataset.range) || 90;
    this.render();
  }

  static _onTab(event, target) {
    this.tab = target.dataset.tab;
    this.cameFrom = null;
    this.render();
  }

  static _onTrade(event, target) {
    if (!this.actor) return ui.notifications.warn(L('NCI.Errors.NoActor'));
    TradeDialogApp.trade({ actorId: this.actorId, assetId: target.dataset.id, side: target.dataset.side });
  }

  /** Read the whole-eb amount from the cash box. */
  _cashAmount() {
    const amount = Math.floor(Number(this.element.querySelector('[name="cashAmount"]')?.value));
    if (!(amount >= 1)) {
      ui.notifications.warn(L('NCI.Reasons.invalid-amount'));
      return null;
    }
    return amount;
  }

  static async _onDeposit() {
    const amount = this._cashAmount();
    if (amount && this.actor) await PortfolioClient.submit(this.actor, 'deposit', { amount });
  }

  static async _onWithdraw() {
    const amount = this._cashAmount();
    if (amount && this.actor) await PortfolioClient.submit(this.actor, 'withdraw', { amount });
  }

  static async _onCancelOrder(event, target) {
    if (this.actor) await PortfolioClient.submit(this.actor, 'cancelOrder', { orderId: target.dataset.id });
  }

  static async _onWatch(event, target) {
    if (!this.actor) return ui.notifications.warn(L('NCI.Errors.NoActor'));
    await PortfolioClient.toggleWatch(this.actor, target.dataset.id);
    this.render();
  }

  /** Switch dividend reinvestment on or off for one holding. */
  static async _onDrip(event, target) {
    if (!this.actor) return;
    await PortfolioClient.submit(this.actor, 'setDrip', { assetId: target.dataset.id, enabled: target.dataset.enabled !== 'true' });
  }

  /** Ask to open a direct-trading session. Needs a CorpNet terminal (or a GM grant); the player rolls the check as they press the button. */
  static async _onConnectTerminal() {
    if (!this.actor) return ui.notifications.warn(L('NCI.Errors.NoActor'));
    const claim = TerminalAccess.claim();
    if (!claim.ok && !TerminalAccess.granted(ownerOf(this.actor))) {
      return ui.notifications.warn(L('NCI.Access.NeedTerminal', { reason: L(`NCI.Reasons.${claim.reason}`) }));
    }
    await PortfolioClient.connectTerminal(this.actor);
  }

  static async _onCancelWithdrawal(event, target) {
    if (this.actor) await PortfolioClient.cancelWithdrawal(this.actor, target.dataset.id);
  }

  static async _onAddAlert() {
    if (!this.actor) return ui.notifications.warn(L('NCI.Errors.NoActor'));
    const field = (name) => this.element.querySelector(`[name="${name}"]`);
    const value = Number(field('alertValue')?.value);
    if (!(value > 0)) return ui.notifications.warn(L('NCI.Reasons.invalid-alert'));
    return PortfolioClient.setAlert(this.actor, {
      assetId: field('alertAsset').value, kind: field('alertKind').value, value, once: !!field('alertOnce')?.checked,
    });
  }

  static async _onRemoveAlert(event, target) {
    if (this.actor) await PortfolioClient.removeAlert(this.actor, target.dataset.id);
  }

  /** From a private stake on the Portfolio tab: open the Business window on that business. */
  static _onManageBusiness(event, target) {
    BusinessApp.open({ businessId: target.dataset.id });
  }

  static async _onRequestStatement() {
    if (this.actor) await PortfolioClient.requestStatement(this.actor);
  }

  /** Try one of the cover-up actions. The player makes the skill roll on this client; the GM's side checks it and takes the cost. */
  static async _onCoverTracks(event, target) {
    if (!this.actor) return ui.notifications.warn(L('NCI.Errors.NoActor'));
    await PortfolioClient.heatAction(this.actor, target.dataset.id);
  }

  // ── Syndicates (DESIGN §31) ────────────────────────────────────────────────

  /** A form field in the box, row or block around the button. */
  _field(target, name) {
    return target.closest('.nci-cashbox, .nci-actions, .nci-block')?.querySelector(`[name="${name}"]`) ?? null;
  }

  static async _onSynFound(event, target) {
    if (!this.actor || this.actor.isSyndicate) return undefined;
    const name = this._field(target, 'synName')?.value?.trim() ?? '';
    if (name.length < 2) return ui.notifications.warn(L('NCI.Syndicate.Reason.bad-name'));
    const invite = [...(target.closest('.nci-block')?.querySelectorAll('input[name="synInvite"]:checked') ?? [])].map((i) => i.value);
    return SyndicateClient.submit(this.actor, 'found', { name, invite });
  }

  static _onSynJoin(event, target) {
    if (this.actor && !this.actor.isSyndicate) return SyndicateClient.submit(this.actor, 'join', { syndicateId: target.dataset.id });
    return undefined;
  }

  static _onSynDecline(event, target) {
    if (this.actor && !this.actor.isSyndicate) return SyndicateClient.submit(this.actor, 'decline', { syndicateId: target.dataset.id });
    return undefined;
  }

  /** Switch the picker to a syndicate the character belongs to. */
  static _onSynOpen(event, target) {
    this.actorId = target.dataset.key;
    this.render();
  }

  static _onSynDeposit(event, target) {
    const amount = Math.floor(Number(this._field(target, 'synAmount')?.value));
    if (!this.actor?.isSyndicate) return undefined;
    if (!(amount >= 1)) return ui.notifications.warn(L('NCI.Reasons.invalid-amount'));
    return SyndicateClient.submit(this.actor.as, 'deposit', { syndicateId: this.actor.id, amount });
  }

  static _onSynRedeem(event, target) {
    const units = Number(this._field(target, 'synUnits')?.value);
    if (!this.actor?.isSyndicate) return undefined;
    if (!(units > 0)) return ui.notifications.warn(L('NCI.Syndicate.Reason.bad-amount'));
    return SyndicateClient.submit(this.actor.as, 'redeem', { syndicateId: this.actor.id, units });
  }

  static async _onSynLeave() {
    if (!this.actor?.isSyndicate) return undefined;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L('NCI.Syndicate.Leave') }, content: `<p>${L('NCI.Syndicate.LeaveConfirm')}</p>`, rejectClose: false,
    });
    return ok ? SyndicateClient.submit(this.actor.as, 'leave', { syndicateId: this.actor.id }) : undefined;
  }

  static _onSynVote(event, target) {
    if (!this.actor?.isSyndicate) return undefined;
    return SyndicateClient.submit(this.actor.as, 'vote', { syndicateId: this.actor.id, proposalId: target.dataset.id, yes: target.dataset.yes === 'true' });
  }

  /** Put something to the vote: the form's kind is admit, remove, officer, member, limit or dissolve. */
  static _onSynPropose(event, target) {
    if (!this.actor?.isSyndicate) return undefined;
    const kind = this._field(target, 'synKind')?.value;
    const base = { syndicateId: this.actor.id };
    if (kind === 'admit') return SyndicateClient.submit(this.actor.as, 'propose', { ...base, kind, actorId: this._field(target, 'synCandidate')?.value });
    if (['remove', 'officer', 'member'].includes(kind)) {
      const actorId = this._field(target, 'synMember')?.value;
      return SyndicateClient.submit(this.actor.as, 'propose', kind === 'remove' ? { ...base, kind, actorId } : { ...base, kind: 'role', actorId, role: kind });
    }
    if (kind === 'limit') return SyndicateClient.submit(this.actor.as, 'propose', { ...base, kind, amount: Math.floor(Number(this._field(target, 'synLimit')?.value)) });
    if (kind === 'dissolve') return SyndicateClient.submit(this.actor.as, 'propose', { ...base, kind });
    return undefined;
  }

  /** Ask how many shares to subscribe for, then queue the subscription. */
  static async _onSubscribeIpo(event, target) {
    if (!this.actor) return ui.notifications.warn(L('NCI.Errors.NoActor'));
    const company = CompanyRepository.upcomingIpos().find((c) => c.id === target.dataset.id);
    if (!company) return undefined;
    const qty = await foundry.applications.api.DialogV2.prompt({
      window: { title: L('NCI.Ipo.SubscribeTitle', { ticker: company.ticker }) },
      content: `<p>${L('NCI.Ipo.SubscribeHint', { price: money(ipoPrice(company)) })}</p>`
        + `<label>${L('NCI.Ipo.Shares')} <input type="number" name="qty" min="1" step="1" value="10" autofocus></label>`,
      ok: { label: L('NCI.Ipo.Subscribe'), callback: (e, button) => Math.floor(Number(button.form.elements.qty.value)) },
      rejectClose: false,
    });
    if (!(qty >= 1)) return undefined;
    return PortfolioClient.submit(this.actor, 'subscribeIpo', { assetId: company.id, qty });
  }

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext() {
    const pub = MarketStore.getPublic();
    const history = MarketStore.getHistory();
    const companies = CompanyRepository.all();
    const hasData = !!pub.schema;
    const traded = hasData ? companies.filter((c) => pub.companies?.[c.id]) : [];

    const actors = tradingAccounts();
    if (this.actorId && !actors.some((a) => a.id === this.actorId)) this.actorId = actors[0]?.id ?? null;
    const watched = new Set(this.actor ? PortfolioRepository.watchlist(this.actor) : []);

    const rows = traded.map((c) => {
      const s = pub.companies[c.id];
      const q = quote(s.price, c.liquidity);
      const change = s.prevClose ? (s.price - s.prevClose) / s.prevClose : 0;
      return {
        id: c.id,
        ticker: c.ticker,
        name: c.name,
        sector: L(`NCI.Sector.${c.sector}`),
        price: money(s.price),
        change: pct(change),
        cls: trendClass(change),
        bid: money(q.bid),
        ask: money(q.ask),
        spark: sparkline(getSeries(history, c.id, 30)),
        statusLabel: c.status === 'active' ? '' : L(`NCI.Status.${c.status}`),
        unlisted: !c.listed,
        watched: watched.has(c.id),
      };
    });

    const idx = equalWeightIndex(traded.map((c) => ({
      price: pub.companies[c.id].price,
      prevClose: pub.companies[c.id].prevClose,
      base: c.initialPrice / (c.splitFactor ?? 1),
    })));

    const selected = traded.find((c) => c.id === this.selectedId);
    const funds = FundRepository.all();
    const selectedFund = !selected ? funds.find((f) => f.id === this.selectedId && pub.funds?.[f.id]) : null;
    if (this.selectedId && !selected && !selectedFund) this.selectedId = null;

    const feed = MarketStore.getNews();
    const nameOf = (id) => companies.find((c) => c.id === id)?.ticker ?? id;
    const newsRows = (items) => items.map((n) => ({
      date: n.date,
      headline: n.headline,
      cls: n.tone === 'up' ? 'nci-up' : n.tone === 'down' ? 'nci-down' : 'nci-flat',
      tickers: n.companyIds.map(nameOf).join(' '),
    }));

    const fundList = hasData ? fundRows(funds, pub, history) : [];
    const ipos = hasData ? ipoRows(this.actor) : [];
    let detail = null;
    if (selected) detail = await this._detail(selected, pub, history, watched);
    else if (selectedFund) detail = fundDetail(selectedFund, pub, history, this.range, { hasActor: !!this.actor });

    return {
      isGM: game.user.isGM,
      tab: this.tab,
      isMarket: this.tab === 'market',
      isPortfolio: this.tab === 'portfolio',
      isNews: this.tab === 'news',
      news: newsRows(latestNews(feed, { limit: 40 })),
      hasData,
      hasCompanies: companies.length > 0,
      rows,
      fundRows: fundList,
      ipoRows: ipos,
      hasListings: rows.length > 0 || ipos.length > 0,
      index: { level: money(idx.level), pct: pct(idx.changePct), cls: trendClass(idx.changePct) },
      mood: hasData ? L(`NCI.Mood.${pub.mood}`) : '—',
      date: MarketClock.dateString(),
      tick: pub.tickIndex ?? 0,
      detail,
      backLabel: L(this.cameFrom === 'portfolio' ? 'NCI.Terminal.BackPortfolio' : 'NCI.Terminal.Back'),
      actors: actors.map((a) => ({ id: a.id, name: a.name, selected: a.id === this.actorId })),
      hasActor: !!this.actor,
      portfolio: this.actor && this.tab === 'portfolio' ? this._portfolio(pub, companies, funds) : null,
    };
  }

  async _detail(c, pub, history, watched) {
    const s = pub.companies[c.id];
    const q = quote(s.price, c.liquidity);
    const dayChange = s.prevClose ? (s.price - s.prevClose) / s.prevClose : 0;
    const series = getSeries(history, c.id, this.range);
    const year = rangeStats(getSeries(history, c.id, 365));
    const periodChange = rangeStats(series).change;
    const record = MarketStore.getDividendRecords()[c.id];
    const lastDividend = record?.perShare
      ? L('NCI.Terminal.LastDividend', { amount: money(record.perShare), date: record.date })
      : '';
    const companyNews = latestNews(MarketStore.getNews(), { companyId: c.id, limit: 5 }).map((n) => ({
      date: n.date,
      headline: n.headline,
      cls: n.tone === 'up' ? 'nci-up' : n.tone === 'down' ? 'nci-down' : 'nci-flat',
    }));

    return {
      id: c.id,
      ticker: c.ticker,
      name: c.name,
      sector: L(`NCI.Sector.${c.sector}`),
      hq: c.hq,
      ceo: c.ceo,
      price: money(s.price),
      change: pct(dayChange),
      cls: trendClass(dayChange),
      bid: money(q.bid),
      ask: money(q.ask),
      spreadPct: (q.spread * 100).toFixed(2),
      high: year.high !== null ? money(year.high) : '—',
      low: year.low !== null ? money(year.low) : '—',
      periodChange: pct(periodChange),
      periodCls: trendClass(periodChange),
      marketCap: c.sharesOutstanding ? whole(s.price * c.sharesOutstanding) : '—',
      volatility: L(`NCI.Vol.${c.volatility}`),
      beta: c.beta.toFixed(2),
      dividend: dividendText(c.dividend),
      lastDividend,
      companyNews,
      statusLabel: c.status === 'active' ? '' : L(`NCI.Status.${c.status}`),
      unlisted: !c.listed,
      tradable: c.status === 'active' && c.listed && !!this.actor,
      watched: watched.has(c.id),
      chart: lineChart(series),
      ranges: RANGES.map((r) => ({ value: r, label: L('NCI.Terminal.Days', { n: r }), active: r === this.range })),
      lore: c.lore ? await TextEditor.enrichHTML(c.lore, { async: true }) : '',
    };
  }

  /**
   * The character's stakes in private businesses (DESIGN §26.8a): read-only, valued at book value
   * times their share, and not tradable on the market. Only businesses still open count.
   */
  _privateStakes(actor) {
    return BusinessRepository.forActor(actor.id)
      .filter((b) => b.status === 'open' && shareOf(b, actor.id) > 0)
      .map((b) => ({
        id: b.id,
        name: b.name,
        stage: L(`NCI.Business.Stage.${b.stage}`),
        share: `${(shareOf(b, actor.id) * 100).toFixed(1)}%`,
        value: Math.round(shareOf(b, actor.id) * bookValue(b)),
      }));
  }

  _portfolio(pub, companies, funds = []) {
    const actor = this.actor;
    const p = PortfolioRepository.get(actor);
    const byId = new Map([...companies, ...funds].map((c) => [c.id, c]));
    const prices = {
      ...Object.fromEntries(Object.entries(pub.companies ?? {}).map(([id, s]) => [id, s.price])),
      ...Object.fromEntries(Object.entries(pub.funds ?? {}).map(([id, s]) => [id, s.nav])),
    };
    const v = valuePortfolio(p, prices);
    const stakes = actor.isSyndicate ? [] : this._privateStakes(actor);
    const stakesValue = stakes.reduce((a, s) => a + s.value, 0);
    const tick = timeOf(pub);
    const tickerOf = (id) => byId.get(id)?.ticker ?? id;

    const positions = v.positions.map((pos) => ({
      id: pos.assetId,
      ticker: tickerOf(pos.assetId),
      name: byId.get(pos.assetId)?.name ?? '',
      qty: pos.qty,
      avgCost: money(pos.avgCost),
      price: money(pos.price),
      value: whole(pos.value),
      pnl: signed(pos.unrealized),
      pnlPct: pct(pos.unrealizedPct),
      cls: trendClass(pos.unrealized),
      weight: v.holdings > 0 ? `${((pos.value / v.holdings) * 100).toFixed(0)}%` : '',
      canOpen: byId.has(pos.assetId) && !!(pub.companies?.[pos.assetId] || pub.funds?.[pos.assetId]),
      drip: !!p.drip[pos.assetId],
      hasDividend: (!!byId.get(pos.assetId)?.dividend && byId.get(pos.assetId).dividend.policy !== 'none')
        || byId.get(pos.assetId)?.distribution === 'distributing',
    }));

    const settling = p.unsettled.map((u) => ({
      text: L('NCI.Portfolio.SettlingLine', { ticker: tickerOf(u.assetId), amount: whole(u.amount) }),
      when: L('NCI.Portfolio.SettlesIn', { n: Math.max(1, Math.ceil(u.releaseTick - tick - 1e-6)) }),
    }));

    const orders = p.orders.filter((o) => o.status === OPEN).map((o) => ({
      id: o.id,
      text: describeOrder(o),
      when: o.type === 'ipo'
        ? L('NCI.Ipo.AwaitingListing')
        : L(o.eligibleTick > tick ? 'NCI.Portfolio.EtaDays' : 'NCI.Portfolio.Working', { n: Math.max(1, Math.ceil(o.eligibleTick - tick - 1e-6)) }),
      route: o.type === 'ipo' ? L('NCI.Ipo.Offer') : L(`NCI.Route.${o.route ?? 'direct'}`),
      expiry: L(`NCI.Expiry.${o.expiry}`),
    }));

    const history = p.orders.filter((o) => o.status !== OPEN).slice(-HISTORY_ROWS).reverse().map((o) => ({
      text: describeOrder(o),
      status: L(`NCI.OrderStatus.${o.status}`),
      detail: o.status === 'filled' ? `${money(o.fillPrice)} eb` : o.reason ? L(`NCI.Reasons.${o.reason}`) : '',
      cls: o.status === 'filled' ? 'nci-up' : 'nci-muted',
    }));

    const ledger = p.ledger.slice(-LEDGER_ROWS).reverse().map((e) => ({
      tick: Math.floor(e.ts + 1e-6),
      kind: L(`NCI.Ledger.${e.kind}`),
      asset: e.assetId ? tickerOf(e.assetId) : '',
      amount: signed(e.amount),
      cls: trendClass(e.amount),
    }));

    const alertText = (a) => L(`NCI.Alerts.Line.${a.kind}`, { ticker: tickerOf(a.assetId), value: a.value, price: money(a.value) });
    const alerts = p.alerts.map((a) => ({
      id: a.id,
      text: alertText(a),
      mode: L(a.once ? 'NCI.Alerts.Once' : 'NCI.Alerts.Repeat'),
      waiting: !a.armed,
    }));
    const alertLog = [...p.alertLog].reverse().map((e) => ({
      tick: Math.floor(e.tick + 1e-6),
      text: L(`NCI.Alerts.Fired.${e.kind}`, {
        ticker: tickerOf(e.assetId), value: e.value, price: money(e.price),
        pct: `${(((e.price - e.prevClose) / e.prevClose) * 100).toFixed(1)}%`,
      }),
    }));
    const alertAssets = [
      ...companies.filter((c) => c.listed).map((c) => ({ value: c.id, label: `${c.ticker} ${c.name}` })),
      ...funds.map((f) => ({ value: f.id, label: `${f.ticker} ${f.name}` })),
    ];

    return {
      wealth: whole(ownerOf(actor).system?.wealth?.value ?? 0),
      syndicate: actor.isSyndicate ? syndicateContext(actor, p, prices) : null,
      syndicates: actor.isSyndicate ? null : characterSyndicates(actor),
      cash: whole(v.cash),
      unsettled: whole(v.unsettled),
      settling,
      holdings: whole(v.holdings),
      total: whole(v.total + stakesValue),
      stakes: stakes.map((s) => ({ ...s, value: whole(s.value) })),
      stakesValue: stakes.length ? whole(stakesValue) : '',
      unrealized: signed(v.unrealized),
      unrealizedCls: trendClass(v.unrealized),
      realized: signed(p.stats.realized),
      realizedCls: trendClass(p.stats.realized),
      dividends: signed(p.stats.dividends ?? 0),
      alerts,
      alertLog,
      alertAssets,
      alertKinds: ['above', 'below', 'move'].map((k) => ({ value: k, label: L(`NCI.Alerts.Kind.${k}`) })),
      pending: actor.isSyndicate ? 0 : PortfolioRepository.pending(actor).length,
      noGM: !game.users.activeGM,
      access: accessContext(actor, p, tick),
      heat: heatContext(actor, p, tick),
      positions,
      orders,
      history,
      ledger,
    };
  }
}
