/**
 * Business window: running a player business, apart from the Market Terminal (DESIGN §27.8a).
 * @file scripts/ui/Business/BusinessApp.js
 * @description Tabs: Overview, This week, Projects, Ledger, Partners, Staff, Growth. A character with no business sees Start a
 *              business. Everything a player does here is a request for the GM, as in the terminal,
 *              and every roll is made only when the player presses Roll.
 */

import { ProductionCatalog } from '../../data/ProductionCatalog.js';
import { BUSINESS_DEFAULTS, itemGear, partnerOf, limitLeft, canRun } from '../../engine/index.js';
import { isCharacter } from '../../utils/helpers.js';
import { SyndicateRepository } from '../../data/SyndicateRepository.js';
import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient, isNpcActor, CONTACT_PREFIX } from '../../services/BusinessClient.js';
import { SyndicateClient } from '../../services/SyndicateClient.js';
import { accountFor, ownerOf } from '../accounts.js';
import { BaseApplication } from '../BaseApplication.js';
import { RollDialogApp } from './RollDialogApp.js';
import { jobsOf } from '../../services/BusinessClient.js';
import { HireDialogApp } from './HireDialogApp.js';
import { EmployeeDialogApp } from './EmployeeDialogApp.js';
import { CashbookDialogApp } from './CashbookDialogApp.js';
import { ReportDialogApp } from './ReportDialogApp.js';
import { L } from '../format.js';
import { investigate } from '../investigate.js';
import { answerCase } from '../answerCase.js';
import { pickerContext, startContext, businessContext, usableActors, jobsContext, termKey } from './context.js';
import { pendingRows } from './pending.js';
import { CrewToolsAdapter } from '../../integrations/CrewToolsAdapter.js';

/** The folders along the top, and the tabs in each. */
const FOLDERS = Object.freeze({
  pending: ['pending'],
  overview: ['overview'],
  financial: ['ledger', 'reports'],
  operations: ['week', 'production', 'staff', 'projects', 'backRoom'],
  ownership: ['partners', 'growth'],
});
const TABS = Object.values(FOLDERS).flat();
const folderOf = (tab) => Object.keys(FOLDERS).find((id) => FOLDERS[id].includes(tab));

/** Read a named input from the form block around the clicked button. */
const field = (target, name) => target.closest('.nci-form')?.querySelector(`[name="${name}"]`);
const value = (target, name) => field(target, name)?.value ?? '';
const amount = (target, name) => Math.floor(Number(value(target, name)) || 0);

/** Which of these names a search matches, as indexes: none until something is typed, and at most `max`. */
export function matchInvites(query, names, max = 8) {
  const wanted = String(query ?? '').trim().toLowerCase();
  if (!wanted) return [];
  return names.map((name, i) => [String(name).toLowerCase().includes(wanted), i]).filter(([hit]) => hit).slice(0, max).map(([, i]) => i);
}

/** What the Start a business form holds that a redraw would lose. */
const START_FIELDS = ['name', 'archetype', 'district', 'location', 'cash', 'sweatPct', 'sweatTo'];

/** The forms that take gear, each with its own drop zone. */
const GEAR_FORMS = ['start', 'join', 'contribute', 'consign'];

export class BusinessApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    id: 'nci-business',
    window: { title: 'NCI.Business.Title', icon: 'fas fa-store' },
    position: { width: 1200, height: 660 },
    actions: {
      switchTab: BusinessApp._onTab,
      pendingOpen: BusinessApp._onPendingOpen,
      pendingAct: BusinessApp._onPendingAct,
      synVote: BusinessApp._onSynVote,
      synJoin: BusinessApp._onSynAnswer,
      synDecline: BusinessApp._onSynAnswer,
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
      setLine: BusinessApp._onSetLine,
      buyStock: BusinessApp._onBuyStock,
      handStock: BusinessApp._onHandStock,
      takeBackStock: BusinessApp._onTakeBackStock,
      consignStock: BusinessApp._onConsignStock,
      clearLine: BusinessApp._onClearLine,
      openStoreroom: BusinessApp._onOpenStoreroom,
      takeDirty: BusinessApp._onTakeDirty,
      gangDeal: BusinessApp._onGangDeal,
      endGangDeal: BusinessApp._onEndGangDeal,
      lieLow: BusinessApp._onLieLow,
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
      hideRoll: BusinessApp._onHideRoll,
      answerCase: BusinessApp._onAnswerCase,
      investigate: BusinessApp._onInvestigate,
      dropLayer: BusinessApp._onDropLayer,
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
      addInvite: BusinessApp._onAddInvite,
      removeInvite: BusinessApp._onRemoveInvite,
      openHire: BusinessApp._onOpenHire,
      proposeHire: BusinessApp._onProposeHire,
      proposeFire: BusinessApp._onProposeFire,
      proposeCover: BusinessApp._onProposeCover,
      proposeStopCover: BusinessApp._onProposeStopCover,
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
  /** The tab last open in each folder, to go back to when the folder is chosen again. */
  lastInFolder = {};
  actorId = (usableActors().find((a) => a.id === game.user.character?.id) ?? usableActors()[0])?.id ?? null;
  businessId = null;
  /** Showing the Start a business form instead of a business. */
  starting = false;
  /** A business just asked for, to show once the GM has made it: `{ name, known }`, where `known` is what the character had before. */
  founding = null;
  /** Who the Start a business form will invite: `{id, name, npc}`. */
  inviteDrafts = [];
  /** What is typed on that form, kept across a redraw. */
  startValues = null;
  /** Items dragged into each form and not sent yet: `{uuid, name, value, img, fromActor}`. */
  gearDrafts = { start: [], join: [], contribute: [], consign: [] };
  _refresh = () => this.render();

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Hooks.on(HOOKS.BUSINESSES_CHANGED, this._refresh);
    Hooks.on(HOOKS.SYNDICATES_CHANGED, this._refresh);
    // The "no GM online" warning follows who is connected.
    Hooks.on('userConnected', this._refresh);
    // A contact tagged while the Start a business form is open can be found at once.
    Hooks.on('updateSetting', this._contactsChanged);
  }

  _contactsChanged = (setting) => {
    if (this.starting && setting?.key === 'night-city-messenger.masterContacts') this.render();
  };

  _onClose(options) {
    Hooks.off('updateSetting', this._contactsChanged);
    Hooks.off(HOOKS.BUSINESSES_CHANGED, this._refresh);
    Hooks.off(HOOKS.SYNDICATES_CHANGED, this._refresh);
    Hooks.off('userConnected', this._refresh);
    super._onClose?.(options);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector('select[name="actorId"]')?.addEventListener('change', (event) => {
      this.actorId = event.target.value;
      this.businessId = null;
      this.starting = false;
      this.founding = null;
      this.inviteDrafts = [];
      this.startValues = null;
      this._clearGear();
      this.render();
    });
    this.element.querySelector('select[name="businessId"]')?.addEventListener('change', (event) => {
      this.businessId = event.target.value;
      this.starting = false;
      this._clearGear();
      this.render();
    });
    // Choosing a back room shows what that kind does, and asks a connected one for its faction (U2).
    this.element.querySelectorAll('[data-room-choice]').forEach((box) => {
      const pick = box.querySelector('[name="roomKind"]');
      const show = () => {
        box.querySelectorAll('[data-room-info]').forEach((info) => { info.hidden = info.dataset.roomInfo !== pick.value; });
        const faction = box.querySelector('[data-room-faction]');
        if (faction) faction.hidden = !pick.selectedOptions[0]?.dataset.connected;
      };
      pick.addEventListener('change', show);
      show();
    });
    this.element.querySelectorAll('.nci-drop').forEach((zone) => {
      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('nci-over');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('nci-over'));
      zone.addEventListener('drop', (event) => {
        zone.classList.remove('nci-over');
        if (zone.dataset.invite !== undefined) this._onDropInvite(event);
        else this._onDropGear(event, zone.dataset.gear);
      });
    });
    this._restoreStartForm();
    const search = this.element.querySelector('[name="inviteSearch"]');
    const choices = [...this.element.querySelectorAll('[data-invite-option]')];
    // Set on the element, as the theme's button rules outrank a plain `hidden`.
    const setShown = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
    const words = choices.map((o) => o.dataset.search ?? o.textContent);
    search?.addEventListener('input', () => {
      const shown = new Set(matchInvites(search.value, words));
      choices.forEach((o, i) => setShown(o, shown.has(i)));
      setShown(this.element.querySelector('[data-invite-none]'), !!search.value.trim() && !shown.size);
      // Say when there are more than fit, so a name further down the list isn't taken for missing.
      const more = matchInvites(search.value, words, Infinity).length - shown.size;
      const note = this.element.querySelector('[data-invite-more]');
      if (note) note.textContent = more > 0 ? L('NCI.Business.InviteMore', { count: more }) : '';
      setShown(note, more > 0);
    });
    // Enter takes the first match: this form has nothing else for it to do.
    search?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      choices.find((o) => o.style.display !== 'none' && !o.disabled)?.click();
    });
  }

  /** A redraw of the Start a business form must not lose what has been typed, as dragging someone in redraws it. */
  async _preRender(context, options) {
    await super._preRender?.(context, options);
    if (!this.starting || !this.element?.querySelector) return;
    const read = (name) => this.element.querySelector(`[name="${name}"]`)?.value;
    if (read('name') === undefined) return;
    this.startValues = Object.fromEntries(START_FIELDS.map((name) => [name, read(name)]));
  }

  _restoreStartForm() {
    if (!this.starting || !this.startValues) return;
    for (const [name, value] of Object.entries(this.startValues)) {
      const input = this.element.querySelector(`[name="${name}"]`);
      if (input && value !== undefined && (input.tagName !== 'SELECT' || [...input.options].some((o) => o.value === value))) input.value = value;
    }
  }

  /** Someone to invite, from the drop zone or the menu. Refused here; the GM's side checks them again. */
  _addInvite(entry) {
    if (!entry?.id || entry.id === this.actor?.id) return false;
    if (this.inviteDrafts.some((x) => x.id === entry.id)) return false;
    if (this.inviteDrafts.length >= BUSINESS_DEFAULTS.maxPartners - 1) {
      ui.notifications.warn(L('NCI.Business.Reason.too-many-partners'));
      return false;
    }
    this.inviteDrafts.push(entry);
    return true;
  }

  /** A character dragged from the Actors directory: a player's is invited as usual, and an NPC's goes to the GM to answer. */
  async _onDropInvite(event) {
    event.preventDefault();
    const data = TextEditor.getDragEventData(event);
    const actor = data?.type === 'Actor' && data.uuid ? await fromUuid(data.uuid) : null;
    const known = actor && game.actors.get(actor.id) === actor;
    const pc = known && isCharacter(actor) && actor.hasPlayerOwner;
    if (!known || !(pc || isNpcActor(actor))) return ui.notifications.warn(L('NCI.Business.Reason.bad-partner'));
    return this._addInvite({ id: actor.id, name: actor.name, npc: !pc }) ? this.render() : null;
  }

  static _onAddInvite(event, target) {
    const { id } = target.dataset;
    if (target.disabled) return;
    // A Messenger contact with no actor goes by its name on the button (DESIGN §36.16).
    if (id?.startsWith(CONTACT_PREFIX)) {
      if (this._addInvite({ id, name: target.dataset.name, npc: true })) this.render();
      return;
    }
    const actor = game.actors.get(id);
    const account = actor ?? SyndicateRepository.get(id);
    if (account && this._addInvite({ id, name: account.name, npc: isNpcActor(actor) })) this.render();
  }

  static _onRemoveInvite(event, target) {
    this.inviteDrafts = this.inviteDrafts.filter((x) => x.id !== target.dataset.id);
    this.render();
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
    // Refused here, before any roll or request: the shop takes no illegal goods (P1c).
    if (form === 'consign' && ProductionCatalog.isIllegal(item)) return ui.notifications.warn(L('NCI.Business.Reason.item-illegal'));
    if (this.gearDrafts[form].some((g) => g.uuid === item.uuid)) return null;
    this.gearDrafts[form].push({ uuid: item.uuid, name: read.name, value: read.value, img: read.img, fromActor: read.fromActor });
    return this.render();
  }

  /** Items dragged for one character or business do not carry over to another. */
  _clearGear() {
    this.gearDrafts = { start: [], join: [], contribute: [], consign: [] };
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

  /** Move to the business just founded, as soon as it exists. */
  _followFounded() {
    if (!this.founding) return;
    const { name, known } = this.founding;
    const made = BusinessRepository.forActor(this.actorId).find((b) => b.name === name && !known.includes(b.id));
    if (!made) return;
    this.businessId = made.id;
    this.founding = null;
  }

  /** The business on screen: the chosen one, or the character's first that is not closed. */
  get business() {
    const list = this.actor ? BusinessRepository.forActor(this.actor.id) : [];
    const chosen = list.find((b) => b.id === this.businessId) ?? (game.user.isGM && this.businessId ? BusinessRepository.get(this.businessId) : null);
    return chosen ?? list.find((b) => b.status !== 'closed') ?? list[0] ?? null;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  static _onTab(event, target) {
    const { tab, group } = target.dataset;
    const chosen = group ? this.lastInFolder[group] ?? FOLDERS[group]?.[0] : tab;
    if (TABS.includes(chosen)) {
      this.tab = chosen;
      this.lastInFolder[folderOf(chosen)] = chosen;
    }
    this.render();
  }

  /** A row on the Pending tab: its business's tab, or the terminal for a syndicate. A click among its fields stays put. */
  static async _onPendingOpen(event, target) {
    if (event?.target?.closest?.('.nci-rowactions')) return;
    const { account, business, tab, terminal } = target.dataset;
    if (terminal) {
      const { MarketTerminalApp } = await import('../MarketTerminal/MarketTerminalApp.js');
      const app = MarketTerminalApp.open({ actorId: account });
      app.tab = 'portfolio';
      app.sub = terminal;
      app.render();
      return;
    }
    this.actorId = account;
    this.businessId = business ?? null;
    this.starting = false;
    this.tab = tab;
    this.lastInFolder[folderOf(tab)] = tab;
    this.render();
  }

  /** A button on a Pending row: its tab's own action, as the account and on the business the row is about, whichever are picked. */
  static async _onPendingAct(event, target) {
    const { do: action, account, business } = target.dataset;
    const handler = BusinessApp.DEFAULT_OPTIONS.actions[action];
    if (!handler) return;
    const picked = { actorId: this.actorId, businessId: this.businessId };
    this.actorId = account ?? this.actorId;
    this.businessId = business ?? this.businessId;
    try {
      await handler.call(this, event, target);
    } finally {
      Object.assign(this, picked);
    }
  }

  /** A vote in a syndicate, from the Pending tab; its account's character votes. */
  static _onSynVote(event, target) {
    const voter = ownerOf(this.actor);
    if (!voter) return undefined;
    return SyndicateClient.submit(voter, 'vote', { syndicateId: target.dataset.syndicate, proposalId: target.dataset.id, yes: target.dataset.yes === 'true' });
  }

  /** An invitation to a syndicate, from the Pending tab. */
  static _onSynAnswer(event, target) {
    const character = ownerOf(this.actor);
    if (!character) return undefined;
    return SyndicateClient.submit(character, target.dataset.do === 'synJoin' ? 'join' : 'decline', { syndicateId: target.dataset.syndicate });
  }

  static _onStartNew() {
    this.tab = 'overview';
    this.starting = true;
    this.render();
  }

  /** Leave the Start a business form: back to the business it was opened from, or close the window if there is none. */
  static _onCancelStart() {
    this.starting = false;
    this.gearDrafts.start = [];
    this.inviteDrafts = [];
    this.startValues = null;
    if (!this.business) return this.close();
    return this.render();
  }

  static async _onFound(event, target) {
    if (!this.actor) return;
    const invite = this.inviteDrafts.map((x) => x.id);
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
    const known = BusinessRepository.forActor(this.actor.id).map((b) => b.id);
    const proposed = await this._proposeIfOver('found', request, request.cash, request.name);
    const key = proposed ?? await BusinessClient.submit(this.actor, 'found', request);
    if (key) {
      this.starting = false;
      this.tab = 'overview';
      // Sent to a syndicate's vote, nothing is made yet, and it may never be.
      this.founding = proposed ? null : { name: request.name, known };
      this.inviteDrafts = [];
      this.startValues = null;
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
    // Aimed at a faction (F1b): the pick in the action's own row.
    const aimed = target.closest('tr')?.querySelector('[name="aimFaction"]')?.value;
    // A campaign's pick is a company (F1c).
    const aim = aimed ? { [action === 'campaign' || action === 'blackOps' ? 'targetTicker' : 'factionId']: aimed } : {};
    this._roll({ type: 'action', action, ...aim }, `${this.business?.name ?? ''}: ${L(`NCI.Business.Action.${action}.Name`)}`);
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
  /** Choose what the workshop makes (P1a). */
  static _onSetLine(event, target) {
    const box = target.closest('[data-line-form]');
    const uuid = box?.querySelector('[name="lineItem"]')?.value ?? '';
    if (!uuid) return null;
    return this._send('setLine', { uuid, qty: Number(box.querySelector('[name="lineQty"]')?.value) || undefined });
  }

  static _onClearLine() {
    return this._send('setLine', { uuid: '' });
  }

  /** Buy stock for the picked character's own sheet (P1b). */
  static _onBuyStock(event, target) {
    const row = target.closest('tr');
    return this._send('buyStock', { uuid: target.dataset.uuid, count: Number(row?.querySelector('[name="stockCount"]')?.value) || 1 });
  }

  /** Propose giving stock to a partner, for nothing. */
  static _onHandStock(event, target) {
    const row = target.closest('tr');
    return this._send('propose', { kind: 'handStock', uuid: target.dataset.uuid, count: Number(row?.querySelector('[name="stockCount"]')?.value) || 1, actorId: row?.querySelector('[name="handTo"]')?.value ?? '' });
  }

  static _onTakeBackStock(event, target) {
    return this._send('takeBack', { uuid: target.dataset.uuid });
  }

  /** Put the items dropped in the box in the shop, still the character's until they sell. */
  static _onConsignStock() {
    const gear = this._takeGear('consign');
    return gear.length ? this._send('consign', { gear }) : null;
  }

  /** Open the storeroom sheet, to look. */
  static _onOpenStoreroom() {
    game.actors.find((a) => a.getFlag?.(MODULE_ID, 'stockFor') === this.businessId)?.sheet?.render(true);
  }

  static _onProposeProject(event, target) {
    // A back room's kind is picked in its row (U1a), and a connected one's faction with it (U2).
    const row = target.closest('tr');
    const pick = row?.querySelector('[name="roomKind"]');
    const room = pick?.value;
    const roomFaction = pick?.selectedOptions?.[0]?.dataset.connected ? row.querySelector('[name="roomFaction"]')?.value : null;
    return this._send('propose', { kind: 'project', project: target.dataset.kind, ...(room ? { room } : {}), ...(roomFaction ? { roomFaction } : {}) });
  }

  /** Put a gang's offer to the partners (U1c). */
  static _onGangDeal() {
    if (this.business?.stage >= 2) return this._send('gangDealOfficer', {});
    return this._send('propose', { kind: 'gangDeal' });
  }

  /** Ask the partners to end the deal (U1c). */
  static _onEndGangDeal() {
    if (this.business?.stage >= 2) return this._send('gangDealOfficer', { end: true });
    return this._send('propose', { kind: 'endGangDeal' });
  }

  /** Dirty cash straight into a partner's hand (U1a). */
  static _onTakeDirty(event, target) {
    const box = target.closest('.nci-actions')?.querySelector('[name="dirtyAmount"]');
    return this._send('takeDirty', { amount: Math.floor(Number(box?.value) || 0) });
  }

  /** Nothing behind the shop this week (U1a). */
  static _onLieLow() {
    return this._send('lieLow', {});
  }

  /** Ask the others to pay a partner's Housing and Lifestyle from the cash each month, or to stop (B7d). */
  static _onProposeCover(event, target) {
    return this._send('propose', { kind: 'coverLiving', actorId: target.dataset.id });
  }

  static _onProposeStopCover(event, target) {
    return this._send('propose', { kind: 'stopLiving', actorId: target.dataset.id });
  }

  static async _onAddDays(event, target) {
    const days = amount(target, 'days');
    // With Crew Tools, the days come out of downtime first, and only what the project still needs (B7b).
    if (CrewToolsAdapter.active() && days > 0) {
      const project = this.business?.projects.find((x) => x.id === target.dataset.id);
      const needed = project ? Math.min(days, project.daysNeeded - project.days) : 0;
      if (needed < 1) return null;
      const downtime = await CrewToolsAdapter.spend(this.actor, needed, L('NCI.Downtime.Reason', { name: this.business.name, what: L(`NCI.Project.Kind.${project.kind}`) }));
      return downtime ? this._send('addDays', { projectId: project.id, days: needed, downtime }) : null;
    }
    return this._send('addDays', { projectId: target.dataset.id, days });
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

  /** Add a layer over this holding (B6d): the broker's nominee first, then a named shell company. */
  static _onHideRoll(event, target) {
    const name = value(target, 'shellName').trim();
    this._roll({ type: 'hideRoll', ...(name ? { name } : {}) }, L('NCI.Ownership.RollTitle', { name: this.business?.name ?? '' }));
  }

  /** An officer answers a regulator's case (R1). */
  static _onAnswerCase() {
    return this.business ? answerCase(this.actor, this.business) : null;
  }

  /** Look behind another shareholder's layers (B6d), as the picked character. */
  static _onInvestigate(event, target) {
    const actor = this.actor?.isSyndicate ? this.actor.as : this.actor;
    return investigate(actor, { businessId: this.business?.id, ref: target.dataset.ref, label: target.dataset.label });
  }

  /** Take the outermost layer off this holding (B6d). */
  static async _onDropLayer() {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: L('NCI.Ownership.Drop') }, content: `<p>${L('NCI.Ownership.DropConfirm')}</p>`, rejectClose: false });
    return ok ? this._send('dropLayer', {}) : null;
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

  /** A week in the Reports tab's digests: its cashbook, in a window of its own. */
  static _onOpenCashbook(event, target) {
    const business = this.business;
    if (!business) return;
    CashbookDialogApp.ask({ businessId: business.id, index: Number(target.dataset.index), officer: !this.actor || canRun(business, this.actor.id) });
  }

  /** A report in the Reports tab's monthly reports: its real and reported figures, in a window of its own. */
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
    // From the Pending tab, the action it stands for.
    const type = target.dataset.do ?? target.dataset.action;
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
    await ProductionCatalog.load();
    this._followFounded();
    const picker = pickerContext(this);
    const business = this.starting ? null : this.business;
    if (business) this.businessId = business.id;
    const context = {
      picker,
      tab: this.tab,
      isSyndicate: !!this.actor?.isSyndicate,
      // A member who is not an officer sees the syndicate's businesses but cannot act for it.
      readOnly: !!this.actor?.isSyndicate && !this.actor.isOfficer && this.tab !== 'pending',
      gearDrafts: Object.fromEntries(GEAR_FORMS.map((f) => [f, this.gearDrafts[f].map((g) => ({ ...g, value: g.value.toLocaleString() }))])),
    };
    const shown = this.actor && business ? businessContext(business, this.actor) : null;
    // A company's back room is its officers' secret, so the tab is not there for anyone else (U1).
    const hasTab = (t) => (t !== 'backRoom' || !!shown?.seesBackRoom) && (t !== 'production' || !!shown?.seesProduction);
    if (shown && !hasTab(this.tab)) this.tab = 'week';
    context.tab = this.tab;
    for (const t of TABS) context[`is${t[0].toUpperCase()}${t.slice(1)}`] = t === this.tab;
    const tabLabel = (t) => ({ id: t, label: L(termKey(business, `NCI.Business.Tab.${t}`)), active: t === this.tab });
    context.pendingRows = this.actor ? pendingRows(this.actor) : [];
    // With no business to show, or only an invitation, there is just this list and the Overview's form.
    const whole = !!shown && !shown.invited;
    const folder = whole || this.tab === 'pending' ? folderOf(this.tab) : 'overview';
    context.folders = this.actor ? Object.keys(FOLDERS).filter((id) => whole || id === 'pending' || id === 'overview').map((id) => ({
      id,
      label: L(`NCI.Business.Folder.${id}`),
      active: id === folder,
      count: id === 'pending' ? context.pendingRows.length : 0,
    })) : [];
    context.subTabs = whole && FOLDERS[folder].length > 1 ? FOLDERS[folder].filter(hasTab).map(tabLabel) : [];
    if (!this.actor) return { ...context, noActor: true };
    // The jobs this character holds or is offered at other people's businesses (DESIGN §32).
    context.jobs = jobsContext(this.actor);
    if (!business) return { ...context, start: startContext(this) };
    return { ...context, business: shown };
  }
}
