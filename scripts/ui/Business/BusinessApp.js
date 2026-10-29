/**
 * Business window: running a player business, apart from the Market Terminal (DESIGN §26.8a).
 * @file scripts/ui/Business/BusinessApp.js
 * @description Tabs: Overview, This week, Projects, Ledger, Partners, Growth. A character with no business sees Start a
 *              business. Everything a player does here is a request for the GM, as in the terminal,
 *              and every roll is made only when the player presses Roll.
 */

import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient } from '../../services/BusinessClient.js';
import { BaseApplication } from '../BaseApplication.js';
import { RollDialogApp } from './RollDialogApp.js';
import { L } from '../format.js';
import { pickerContext, startContext, businessContext, usableActors } from './context.js';

const TABS = ['overview', 'week', 'projects', 'ledger', 'partners', 'growth'];

/** Read a named input from the form block around the clicked button. */
const field = (target, name) => target.closest('.nci-form')?.querySelector(`[name="${name}"]`);
const value = (target, name) => field(target, name)?.value ?? '';
const amount = (target, name) => Math.floor(Number(value(target, name)) || 0);

/** One line of gear from a form block, if both its name and value are filled in. */
function gearFrom(target) {
  const name = value(target, 'gearName').trim();
  const worth = amount(target, 'gearValue');
  return name && worth > 0 ? [{ name, value: worth }] : [];
}

export class BusinessApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    id: 'nci-business',
    window: { title: 'NCI.Business.Title', icon: 'fas fa-store' },
    position: { width: 760, height: 660 },
    actions: {
      switchTab: BusinessApp._onTab,
      startNew: BusinessApp._onStartNew,
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
      proposeExpansion: BusinessApp._onProposeExpansion,
      addDays: BusinessApp._onAddDays,
      proposeStepUp: BusinessApp._onProposeStepUp,
      stepUpRoll: BusinessApp._onStepUpRoll,
      respond: BusinessApp._onRespond,
      proposeFixerLoan: BusinessApp._onProposeFixerLoan,
      proposeBankLoan: BusinessApp._onProposeBankLoan,
      loanRoll: BusinessApp._onLoanRoll,
      repayLoan: BusinessApp._onRepayLoan,
      proposeInvestor: BusinessApp._onProposeInvestor,
      proposeAngel: BusinessApp._onProposeAngel,
      angelRoll: BusinessApp._onAngelRoll,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/business/business.hbs` },
  };

  /** Open the window, optionally on one business (from the GM Console). */
  static open(options = {}) {
    const app = super.open(options);
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

  tab = 'overview';
  actorId = (usableActors().find((a) => a.id === game.user.character?.id) ?? usableActors()[0])?.id ?? null;
  businessId = null;
  /** Showing the Start a business form instead of a business. */
  starting = false;
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
      this.render();
    });
    this.element.querySelector('select[name="businessId"]')?.addEventListener('change', (event) => {
      this.businessId = event.target.value;
      this.starting = false;
      this.render();
    });
  }

  get actor() {
    return this.actorId ? game.actors.get(this.actorId) ?? null : null;
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

  static async _onFound(event, target) {
    if (!this.actor) return;
    const invite = [...this.element.querySelectorAll('input[name="invite"]:checked')].map((el) => el.value);
    const sweatPct = amount(target, 'sweatPct');
    const key = await BusinessClient.submit(this.actor, 'found', {
      name: value(target, 'name').trim(),
      archetype: value(target, 'archetype'),
      location: value(target, 'location').trim(),
      district: value(target, 'district'),
      cash: amount(target, 'cash'),
      gear: gearFrom(target),
      invite,
      sweat: sweatPct > 0 ? { actorId: value(target, 'sweatTo') || this.actor.id, pct: sweatPct } : null,
    });
    if (key) {
      this.starting = false;
      this.tab = 'overview';
    }
  }

  static _onJoin(event, target) {
    return this._send('join', { cash: amount(target, 'cash'), gear: gearFrom(target) });
  }

  static _onDecline() {
    return this._send('decline');
  }

  static _onContribute(event, target) {
    return this._send('contribute', { cash: amount(target, 'cash'), gear: gearFrom(target) });
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
    if (await this._confirm('NCI.Business.LeaveConfirm')) return this._send('leave');
  }

  static _onBuyout(event, target) {
    return this._send('buyout', { sellerId: target.dataset.id });
  }

  static async _onProposeClose() {
    if (await this._confirm('NCI.Business.CloseConfirm')) return this._send('proposeClose');
  }

  static _onVote(event, target) {
    return this._send('vote', { proposalId: target.dataset.id, yes: target.dataset.yes === 'true' });
  }

  static _onProposeExpansion() {
    return this._send('propose', { kind: 'expansion' });
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
    RollDialogApp.ask({ actorId: this.actor.id, businessId: business.id, request: { ...request, businessId: business.id }, title });
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
    const context = { picker, tab: this.tab };
    for (const t of TABS) context[`is${t[0].toUpperCase()}${t.slice(1)}`] = t === this.tab;
    context.tabs = TABS.map((t) => ({ id: t, label: L(`NCI.Business.Tab.${t}`), active: t === this.tab }));
    if (!this.actor) return { ...context, noActor: true };
    if (!business) return { ...context, start: startContext(this) };
    return { ...context, business: businessContext(business, this.actor) };
  }
}
