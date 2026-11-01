/**
 * Business window: running a player business, apart from the Market Terminal (DESIGN §27.8a).
 * @file scripts/ui/Business/BusinessApp.js
 * @description Tabs: Overview, This week, Projects, Ledger, Partners, Staff, Growth. A character with no business sees Start a
 *              business. Everything a player does here is a request for the GM, as in the terminal,
 *              and every roll is made only when the player presses Roll.
 */

import { itemGear, partnerOf, limitLeft } from '../../engine/index.js';
import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient } from '../../services/BusinessClient.js';
import { SyndicateClient } from '../../services/SyndicateClient.js';
import { accountFor } from '../accounts.js';
import { BaseApplication } from '../BaseApplication.js';
import { RollDialogApp } from './RollDialogApp.js';
import { jobsOf } from '../../services/BusinessClient.js';
import { HireDialogApp } from './HireDialogApp.js';
import { EmployeeDialogApp } from './EmployeeDialogApp.js';
import { CashbookDialogApp } from './CashbookDialogApp.js';
import { ReportDialogApp } from './ReportDialogApp.js';
import { L } from '../format.js';
import { pickerContext, startContext, businessContext, usableActors, jobsContext, termKey } from './context.js';

const TABS = ['overview', 'ledger', 'week', 'projects', 'staff', 'partners', 'growth'];

/** Read a named input from the form block around the clicked button. */
const field = (target, name) => target.closest('.nci-form')?.querySelector(`[name="${name}"]`);
const value = (target, name) => field(target, name)?.value ?? '';
const amount = (target, name) => Math.floor(Number(value(target, name)) || 0);

/** The forms that take gear, each with its own drop zone. */
const GEAR_FORMS = ['start', 'join', 'contribute'];

export class BusinessApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    id: 'nci-business',
    window: { title: 'NCI.Business.Title', icon: 'fas fa-store' },
    position: { width: 1200, height: 660 },
    actions: {
      switchTab: BusinessApp._onTab,
      viewOnMarket: BusinessApp._onViewOnMarket,
      startNew: BusinessApp._onStartNew,
      cancelStart: BusinessApp._onCancelStart,
      found: BusinessApp._onFound,
      join: BusinessApp._onJoin,
      decline: BusinessApp._onDecline,
      contribute: BusinessApp._onContribute,
      withdraw: BusinessApp._onWithdraw,
      setupRoll: BusinessApp._onSetupRoll,
      actionRoll: BusinessApp._onActionRoll,
      helpRoll: BusinessApp._onHelpRoll,
      draw: BusinessApp._onDraw,
      setHeir: BusinessApp._onSetHeir,
      leave: BusinessApp._onLeave,
      buyout: BusinessApp._onBuyout,
      proposeClose: BusinessApp._onProposeClose,
      vote: BusinessApp._onVote,
      proposeProject: BusinessApp._onProposeProject,
      addDays: BusinessApp._onAddDays,
      proposeStepUp: BusinessApp._onProposeStepUp,
      stepUpRoll: BusinessApp._onStepUpRoll,
      proposeCharter: BusinessApp._onProposeCharter,
      charterRoll: BusinessApp._onCharterRoll,
      proposeListing: BusinessApp._onProposeListing,
      proposePayout: BusinessApp._onProposePayout,
      proposeIssue: BusinessApp._onProposeIssue,
      proposeBuyback: BusinessApp._onProposeBuyback,
      takeRights: BusinessApp._onTakeRights,
      sellBack: BusinessApp._onSellBack,
      issueRoll: BusinessApp._onIssueRoll,
      tender: BusinessApp._onTender,
      defenceRoll: BusinessApp._onDefenceRoll,
      buybackRoll: BusinessApp._onBuybackRoll,
      prospectusRoll: BusinessApp._onProspectusRoll,
      charterFund: BusinessApp._onCharterFund,
      reportRoll: BusinessApp._onReportRoll,
      auditRoll: BusinessApp._onAuditRoll,
      diligenceRoll: BusinessApp._onDiligenceRoll,
      proposeElect: BusinessApp._onProposeElect,
      proposeDismiss: BusinessApp._onProposeDismiss,
      respond: BusinessApp._onRespond,
      proposeFixerLoan: BusinessApp._onProposeFixerLoan,
      proposeBankLoan: BusinessApp._onProposeBankLoan,
      loanRoll: BusinessApp._onLoanRoll,
      repayLoan: BusinessApp._onRepayLoan,
      proposeInvestor: BusinessApp._onProposeInvestor,
      proposeAngel: BusinessApp._onProposeAngel,
      angelRoll: BusinessApp._onAngelRoll,
      removeGear: BusinessApp._onRemoveGear,
      openHire: BusinessApp._onOpenHire,
      proposeHire: BusinessApp._onProposeHire,
      proposeFire: BusinessApp._onProposeFire,
      openEmployee: BusinessApp._onOpenEmployee,
      openCashbook: BusinessApp._onOpenCashbook,
      openReport: BusinessApp._onOpenReport,
      rejectApplicant: BusinessApp._onRejectApplicant,
      vetApplicants: BusinessApp._onVetApplicants,
      acceptJob: BusinessApp._onJob,
      declineJob: BusinessApp._onJob,
      quitJob: BusinessApp._onJob,
      rollAsked: BusinessApp._onRollAsked,
      declineAsk: BusinessApp._onDeclineAsk,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/business/business.hbs` },
  };

  /**
   * Open the window, optionally on one business (from the GM Console, or a Portfolio row) and as one
   * account (a character, or `syn:<syndicate>:<character>`).
   */
  static open(options = {}) {
    const app = super.open(options);
    if (options.actorId && accountFor(options.actorId)) app.actorId = options.actorId;
    if (options.businessId) {
      app.businessId = options.businessId;
      const business = BusinessRepository.get(options.businessId);
      const holder = business?.partners.find((p) => ['active', 'leaving'].includes(p.status) && game.actors.get(p.actorId));
      if (holder && !BusinessRepository.forActor(app.actorId ?? '').some((b) => b.id === business.id)) app.actorId = holder.actorId;
      app.starting = false;
      app.render();
    }
    return app;
  }

  /** A listed company's page on the market terminal (B5c), as the same account. */
  static async _onViewOnMarket(event, target) {
    const { MarketTerminalApp } = await import('../MarketTerminal/MarketTerminalApp.js');
    MarketTerminalApp.open({ assetId: target.dataset.id, actorId: this.actorId });
  }

  tab = 'overview';
  actorId = (usableActors().find((a) => a.id === game.user.character?.id) ?? usableActors()[0])?.id ?? null;
  businessId = null;
  /** Showing the Start a business form instead of a business. */
  starting = false;
  /** Items dragged into each form and not sent yet: `{uuid, name, value, img, fromActor}`. */
  gearDrafts = { start: [], join: [], contribute: [] };
  _refresh = () => this.render();

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Hooks.on(HOOKS.BUSINESSES_CHANGED, this._refresh);
    // The "no GM online" warning follows who is connected.
    Hooks.on('userConnected', this._refresh);
  }

  _onClose(options) {
    Hooks.off(HOOKS.BUSINESSES_CHANGED, this._refresh);
    Hooks.off('userConnected', this._refresh);
    super._onClose?.(options);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector('select[name="actorId"]')?.addEventListener('change', (event) => {
      this.actorId = event.target.value;
      this.businessId = null;
      this.starting = false;
      this._clearGear();
      this.render();
    });
    this.element.querySelector('select[name="businessId"]')?.addEventListener('change', (event) => {
      this.businessId = event.target.value;
      this.starting = false;
      this._clearGear();
      this.render();
    });
    this.element.querySelectorAll('.nci-drop').forEach((zone) => {
      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('nci-over');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('nci-over'));
      zone.addEventListener('drop', (event) => {
        zone.classList.remove('nci-over');
        this._onDropGear(event, zone.dataset.gear);
      });
    });
  }

  /**
   * An item dragged from a character's sheet, the Items directory or a compendium. It is read here
   * so the player sees its book value at once; the GM's side looks it up again when the request
   * arrives and only trusts its own reading.
   */
  async _onDropGear(event, form) {
    event.preventDefault();
    if (!GEAR_FORMS.includes(form) || !this.actor) return;
    const data = TextEditor.getDragEventData(event);
    if (data?.type !== 'Item' || !data.uuid) return ui.notifications.warn(L('NCI.Business.Reason.bad-item'));
    const item = await fromUuid(data.uuid);
    if (!item) return ui.notifications.warn(L('NCI.Business.Reason.item-missing'));
    const owner = item.parent?.documentName === 'Actor' ? item.parent : null;
    const read = itemGear({ type: item.type, name: item.name, img: item.img, system: item.system, ownerId: owner?.id ?? null }, this.actor.id);
    if (!read.ok) return ui.notifications.warn(L(`NCI.Business.Reason.${read.reason}`));
    if (this.gearDrafts[form].some((g) => g.uuid === item.uuid)) return null;
    this.gearDrafts[form].push({ uuid: item.uuid, name: read.name, value: read.value, img: read.img, fromActor: read.fromActor });
    return this.render();
  }

  /** Items dragged for one character or business do not carry over to another. */
  _clearGear() {
    this.gearDrafts = { start: [], join: [], contribute: [] };
  }

  static _onRemoveGear(event, target) {
    this.gearDrafts[target.dataset.form]?.splice(Number(target.dataset.index), 1);
    this.render();
  }

  /** The dragged items of one form, as the request sends them (their uuids only), and clear them. */
  _takeGear(form) {
    const gear = this.gearDrafts[form].map((g) => ({ uuid: g.uuid }));
    this.gearDrafts[form] = [];
    return gear;
  }

  /** The picked account: a character, or a syndicate picked as one of its officers (DESIGN §30, B3b). */
  get actor() {
    return accountFor(this.actorId);
  }

  /**
   * For a syndicate, a payment over the officers' limit goes to its members as a proposal instead of
   * to the business. Returns the proposal's key, or null when the request should go ahead.
   */
  async _proposeIfOver(type, payload, amount, label) {
    const account = this.actor;
    if (!account?.isSyndicate || !(amount > limitLeft(account.syndicate, account.as.id, BusinessClient.day()))) return null;
    const key = await SyndicateClient.submit(account.as, 'propose', { syndicateId: account.id, kind: 'business', business: { type, ...payload }, amount, label });
    if (key) ui.notifications.info(L('NCI.Business.ProposedToSyndicate', { name: account.name, amount: amount.toLocaleString() }));
    return key ?? 'refused';
  }

  /** The business on screen: the chosen one, or the character's first that is not closed. */
  get business() {
    const list = this.actor ? BusinessRepository.forActor(this.actor.id) : [];
    const chosen = list.find((b) => b.id === this.businessId) ?? (game.user.isGM && this.businessId ? BusinessRepository.get(this.businessId) : null);
    return chosen ?? list.find((b) => b.status !== 'closed') ?? list[0] ?? null;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  static _onTab(event, target) {
    if (TABS.includes(target.dataset.tab)) this.tab = target.dataset.tab;
    this.render();
  }

  static _onStartNew() {
    this.starting = true;
    this.render();
  }

  /** Leave the Start a business form: back to the business it was opened from, or close the window if there is none. */
  static _onCancelStart() {
    this.starting = false;
    this.gearDrafts.start = [];
    if (!this.business) return this.close();
    return this.render();
  }

  static async _onFound(event, target) {
    if (!this.actor) return;
    const invite = [...this.element.querySelectorAll('input[name="invite"]:checked')].map((el) => el.value);
    const sweatPct = amount(target, 'sweatPct');
    const request = {
      name: value(target, 'name').trim(),
      archetype: value(target, 'archetype'),
      location: value(target, 'location').trim(),
      district: value(target, 'district'),
      cash: amount(target, 'cash'),
      gear: this._takeGear('start'),
      invite,
      sweat: sweatPct > 0 ? { actorId: value(target, 'sweatTo') || this.actor.id, pct: sweatPct } : null,
    };
    const key = (await this._proposeIfOver('found', request, request.cash, request.name))
      ?? await BusinessClient.submit(this.actor, 'found', request);
    if (key) {
      this.starting = false;
      this.tab = 'overview';
    }
  }

  static async _onJoin(event, target) {
    const payload = { cash: amount(target, 'cash'), gear: this._takeGear('join') };
    // An investor's offer sets what it pays, whatever is typed.
    const offer = this.business && this.actor ? partnerOf(this.business, this.actor.id)?.offer : null;
    if (await this._proposeIfOver('join', { businessId: this.business?.id, ...payload }, offer?.amount ?? payload.cash, this.business?.name)) return null;
    return this._send('join', payload);
  }

  static _onDecline() {
    return this._send('decline');
  }

  static async _onContribute(event, target) {
    const payload = { cash: amount(target, 'cash'), gear: this._takeGear('contribute') };
    if (await this._proposeIfOver('contribute', { businessId: this.business?.id, ...payload }, payload.cash, this.business?.name)) return null;
    return this._send('contribute', payload);
  }

  static async _onWithdraw() {
    if (await this._confirm('NCI.Business.WithdrawConfirm')) return this._send('withdraw');
  }

  static _onSetupRoll() {
    this._roll({ type: 'setupRoll' }, L('NCI.Business.SetupTitle', { name: this.business?.name ?? '' }));
  }

  static _onActionRoll(event, target) {
    const action = target.dataset.id;
    this._roll({ type: 'action', action }, `${this.business?.name ?? ''}: ${L(`NCI.Business.Action.${action}.Name`)}`);
  }

  static _onHelpRoll(event, target) {
    const forAction = target.dataset.id;
    this._roll({ type: 'assist', forAction }, L('NCI.Business.HelpTitle', { action: L(`NCI.Business.Action.${forAction}.Name`) }));
  }

  static _onDraw(event, target) {
    return this._send('draw', { amount: amount(target, 'amount') });
  }

  static _onSetHeir(event, target) {
    return this._send('setHeir', { heirId: value(target, 'heirId') || null });
  }

  static async _onLeave() {
    if (await this._confirm(termKey(this.business, 'NCI.Business.LeaveConfirm'))) return this._send('leave');
  }

  static _onBuyout(event, target) {
    return this._send('buyout', { sellerId: target.dataset.id });
  }

  static async _onProposeClose() {
    if (await this._confirm(termKey(this.business, 'NCI.Business.CloseConfirm'))) return this._send('proposeClose');
  }

  static _onVote(event, target) {
    return this._send('vote', { proposalId: target.dataset.id, yes: target.dataset.yes === 'true' });
  }

  /** A project's Propose button on the Projects tab: any kind, a majority of the votes. */
  static _onProposeProject(event, target) {
    return this._send('propose', { kind: 'project', project: target.dataset.kind });
  }

  static _onAddDays(event, target) {
    return this._send('addDays', { projectId: target.dataset.id, days: amount(target, 'days') });
  }

  static async _onProposeStepUp() {
    if (await this._confirm('NCI.Business.StepUpConfirm')) return this._send('propose', { kind: 'stepUp' });
  }

  static _onRespond() {
    const kind = this.business?.period?.event?.kind;
    this._roll({ type: 'respond' }, L('NCI.Business.AnswerTitle', { event: kind ? L(`NCI.Event.${kind}.Name`) : '' }));
  }

  static _onProposeFixerLoan(event, target) {
    return this._send('propose', { kind: 'fixerLoan', amount: amount(target, 'loanAmount') });
  }

  static _onProposeBankLoan() {
    return this._send('propose', { kind: 'bankLoan' });
  }

  static _onLoanRoll(event, target) {
    this._roll({ type: 'loanRoll', amount: amount(target, 'bankAmount') }, L('NCI.Business.BankTitle', { name: this.business?.name ?? '' }));
  }

  static _onRepayLoan(event, target) {
    return this._send('repayLoan', { loanId: target.dataset.id, amount: Math.floor(Number(target.closest('.nci-gig')?.querySelector('[name="repay"]')?.value) || 0) });
  }

  static _onProposeInvestor(event, target) {
    const price = Number(value(target, 'investPrice'));
    return this._send('propose', { kind: 'investor', actorId: value(target, 'investor'), amount: amount(target, 'investAmount'), ...(price > 0 ? { price } : {}) });
  }

  static _onProposeAngel() {
    return this._send('propose', { kind: 'angel' });
  }

  static _onAngelRoll() {
    this._roll({ type: 'angelRoll' }, L('NCI.Business.AngelTitle', { name: this.business?.approved?.angel?.name ?? '' }));
  }

  /** Every partner with a vote must agree to charter; the ticker is named now (DESIGN §31). */
  static async _onProposeCharter(event, target) {
    const ticker = value(target, 'ticker').trim().toUpperCase();
    if (ticker.length < 2) return ui.notifications.warn(L('NCI.Business.Reason.bad-ticker'));
    if (await this._confirm('NCI.Charter.Confirm')) return this._send('propose', { kind: 'stepUp', ticker });
    return null;
  }

  /** Agree to list (B5a): every shareholder with a vote, naming the float; the fee is paid when agreed. */
  static async _onProposeListing(event, target) {
    const float = Number(value(target, 'float'));
    if (!(float > 0)) return null;
    if (await this._confirm('NCI.Listing.Confirm')) return this._send('propose', { kind: 'stepUp', float });
    return null;
  }

  /** Propose a listed company's payout ratio (B5c): a majority of the shares. */
  static _onProposePayout(event, target) {
    const pct = Number(value(target, 'payoutPct'));
    return Number.isFinite(pct) ? this._send('propose', { kind: 'payout', pct }) : null;
  }

  /** Propose new shares, as a share of the shares there are now (B6a). */
  static _onProposeIssue(event, target) {
    const pct = Number(value(target, 'issuePct'));
    return Number.isFinite(pct) ? this._send('propose', { kind: 'issue', pct }) : null;
  }

  /** Propose a buyback with a budget from the company's cash (B6a). */
  static _onProposeBuyback(event, target) {
    return this._send('propose', { kind: 'buyback', budget: amount(target, 'buybackBudget') });
  }

  /** Take up shares in a rights issue, paid from the account (a syndicate over its limit puts it to a vote). */
  static async _onTakeRights(event, target) {
    const qty = amount(target, 'rightsQty');
    const cost = Math.round(qty * (this.business?.capital?.issue?.price ?? 0));
    if (await this._proposeIfOver('rightsTake', { businessId: this.business?.id, qty }, cost, this.business?.name)) return null;
    return this._send('rightsTake', { qty });
  }

  /** Tender shares to a takeover offer, or change how many (0 withdraws) (B6b). */
  static _onTender(event, target) {
    return this._send('tender', { qty: amount(target, 'tenderQty') });
  }

  /** The officers' defence against a takeover offer (B6b): Persuasion or Business. */
  static _onDefenceRoll() {
    this._roll({ type: 'defenceRoll' }, L('NCI.Takeover.DefendTitle', { name: this.business?.name ?? '' }));
  }

  /** A listed company's offering roll (B6a): Trading sets the discount. */
  static _onIssueRoll() {
    this._roll({ type: 'issueRoll' }, L('NCI.Capital.OfferingTitle', { name: this.business?.name ?? '' }));
  }

  /** Time a listed company's buyback (B6a): Trading sets the price it pays. */
  static _onBuybackRoll() {
    this._roll({ type: 'buybackRoll' }, L('NCI.Capital.TimingTitle', { name: this.business?.name ?? '' }));
  }

  /** Sell units back to the company in a tender. */
  static _onSellBack(event, target) {
    return this._send('sellBack', { qty: amount(target, 'sellBackQty') });
  }

  /** A prospectus roll: the filing (Accounting) or the offering (Trading). */
  static _onProspectusRoll(event, target) {
    const part = target.dataset.part;
    this._roll({ type: 'prospectusRoll', part }, L('NCI.Listing.RollTitle', { part: L(`NCI.Listing.Part.${part}`), name: this.business?.name ?? '' }));
  }

  static _onCharterRoll(event, target) {
    const part = target.dataset.part;
    this._roll({ type: 'charterRoll', part }, L('NCI.Charter.RollTitle', { part: L(`NCI.Charter.Part.${part}`), name: this.business?.name ?? '' }));
  }

  static async _onCharterFund(event, target) {
    const cash = amount(target, 'cash');
    if (await this._proposeIfOver('charterFund', { businessId: this.business?.id, cash }, cash, this.business?.name)) return null;
    return this._send('charterFund', { cash });
  }

  /** Prepare the monthly report (DESIGN §27.4): Accounting; Bold in the dialog is aggressive reporting. */
  static _onReportRoll() {
    this._roll({ type: 'reportRoll' }, L('NCI.Company.PrepareTitle', { name: this.business?.name ?? '' }));
  }

  static _onAuditRoll() {
    this._roll({ type: 'auditRoll' }, L('NCI.Company.AuditTitle', { name: this.business?.name ?? '' }));
  }

  /** Due diligence on another business, named as the player knows it (B4c). */
  static _onDiligenceRoll(event, target) {
    const targetName = value(target, 'targetName').trim();
    if (!targetName) return ui.notifications.warn(L('NCI.Business.Reason.no-target'));
    return this._roll({ type: 'diligenceRoll', targetName }, L('NCI.Company.DiligenceTitle', { name: targetName }));
  }

  static _onProposeElect(event, target) {
    return this._send('propose', { kind: 'elect', actorId: target.dataset.id });
  }

  static _onProposeDismiss(event, target) {
    return this._send('propose', { kind: 'dismiss', actorId: target.dataset.id });
  }

  /** A post's Hire button (DESIGN §32): the Hire window, to hire a character or advertise the job. */
  static _onOpenHire(event, target) {
    const business = this.business;
    if (!business || !this.actor) return;
    HireDialogApp.ask({ actorId: this.actorId, businessId: business.id, post: target.dataset.post });
  }

  /** An employee's Manage button (E2): the Employee window, for pay, a bonus, a move or letting them go. */
  static _onOpenEmployee(event, target) {
    const business = this.business;
    if (!business || !this.actor) return;
    EmployeeDialogApp.ask({ actorId: this.actorId, businessId: business.id, staffId: target.dataset.id });
  }

  /** A week in the Ledger tab's digests: its cashbook, in a window of its own. */
  static _onOpenCashbook(event, target) {
    const business = this.business;
    if (!business) return;
    CashbookDialogApp.ask({ businessId: business.id, index: Number(target.dataset.index) });
  }

  /** A report in the Ledger tab's monthly reports: its real and reported figures, in a window of its own. */
  static _onOpenReport(event, target) {
    const business = this.business;
    if (!business) return;
    ReportDialogApp.ask({ businessId: business.id, index: Number(target.dataset.index) });
  }

  /** Vet every applicant waiting for a post: one roll. */
  static _onVetApplicants(event, target) {
    const post = target.dataset.post;
    this._roll({ type: 'vetRoll', post }, L('NCI.Staff.VetTitle', { post: L(`NCI.Staff.Post.${post}`), name: this.business?.name ?? '' }));
  }

  /** Turn an applicant away: they leave the list. */
  static async _onRejectApplicant(event, target) {
    if (await this._confirm('NCI.Staff.RejectConfirm')) return this._send('rejectApplicant', { candidateId: target.dataset.id });
    return null;
  }

  /** An applicant waiting from an advert, hired on what they asked. */
  static _onProposeHire(event, target) {
    return this._send('propose', { kind: 'hire', candidateId: target.dataset.id });
  }

  static async _onProposeFire(event, target) {
    if (await this._confirm('NCI.Staff.FireConfirm')) return this._send('propose', { kind: 'fire', staffId: target.dataset.id });
    return null;
  }

  /** An employee's answer to an offer, or their notice, sent from their own character to the business named. */
  static async _onJob(event, target) {
    const type = target.dataset.action;
    if (type === 'quitJob' && !(await this._confirm('NCI.Staff.QuitConfirm'))) return null;
    if (!this.actor || this.actor.isSyndicate) return null;
    return BusinessClient.submit(this.actor, type, { businessId: target.dataset.id });
  }

  /** A roll a partner asked of this character as an employee (E3): the roll dialog, from their job. */
  static _onRollAsked(event, target) {
    if (!this.actor || this.actor.isSyndicate) return null;
    const job = jobsOf(this.actor).find((j) => j.businessId === target.dataset.business);
    const ask = job?.asks?.find((a) => a.id === target.dataset.id);
    if (!ask) return null;
    return RollDialogApp.ask({
      actorId: this.actorId, businessId: job.businessId, request: { type: 'staffRoll', businessId: job.businessId, askId: ask.id },
      title: `${job.businessName}: ${ask.what}`, asked: { ...ask, businessName: job.businessName },
    });
  }

  /** Turn a roll asked of them down. */
  static _onDeclineAsk(event, target) {
    if (!this.actor || this.actor.isSyndicate) return null;
    return BusinessClient.submit(this.actor, 'cancelAsk', { businessId: target.dataset.business, askId: target.dataset.id });
  }

  static _onStepUpRoll() {
    this._roll({ type: 'stepUpRoll' }, L('NCI.Business.StepUpTitle', { name: this.business?.name ?? '' }));
  }

  _send(type, payload = {}) {
    const business = this.business;
    if (!this.actor || !business) return null;
    return BusinessClient.submit(this.actor, type, { businessId: business.id, ...payload });
  }

  _roll(request, title) {
    const business = this.business;
    if (!this.actor || !business) return;
    RollDialogApp.ask({ actorId: this.actorId, businessId: business.id, request: { ...request, businessId: business.id }, title });
  }

  async _confirm(key) {
    const result = await foundry.applications.api.DialogV2.confirm({
      window: { title: L('NCI.Business.Title') },
      content: `<p>${L(key)}</p>`,
      rejectClose: false,
      modal: true,
    });
    return !!result;
  }

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext() {
    const picker = pickerContext(this);
    const business = this.starting ? null : this.business;
    if (business) this.businessId = business.id;
    const context = {
      picker,
      tab: this.tab,
      isSyndicate: !!this.actor?.isSyndicate,
      // A member who is not an officer sees the syndicate's businesses but cannot act for it.
      readOnly: !!this.actor?.isSyndicate && !this.actor.isOfficer,
      gearDrafts: Object.fromEntries(GEAR_FORMS.map((f) => [f, this.gearDrafts[f].map((g) => ({ ...g, value: g.value.toLocaleString() }))])),
    };
    for (const t of TABS) context[`is${t[0].toUpperCase()}${t.slice(1)}`] = t === this.tab;
    context.tabs = TABS.map((t) => ({ id: t, label: L(termKey(business, `NCI.Business.Tab.${t}`)), active: t === this.tab }));
    if (!this.actor) return { ...context, noActor: true };
    // The jobs this character holds or is offered at other people's businesses (DESIGN §32).
    context.jobs = jobsContext(this.actor);
    if (!business) return { ...context, start: startContext(this) };
    return { ...context, business: businessContext(business, this.actor) };
  }
}
