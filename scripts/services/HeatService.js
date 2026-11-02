/**
 * Heat service: watches for insider trading around gig outcomes, and acts on it. GM client only.
 * @file scripts/services/HeatService.js
 * @description When a gig impact is queued, a watch window opens on its company. Once the effect
 *              starts to show (and orders placed inside the window have filled), every character's
 *              fills in it are scored and their hidden heat goes up. Then, if consequences are on:
 *
 *                noticed       the broker sends a nervous warning, in their voice
 *                flagged       NCPD Financial Crimes sends a routine enquiry; new broker orders are
 *                              slower and dearer while the heat lasts
 *                investigated  a penalty (a fine, a frozen account, or a broker who walks away) is
 *                              chosen. By default it waits for the GM's approval.
 *
 *              Players can bring heat down with skill-roll actions (see engine/heatActions.js); their
 *              results arrive as portfolio results and are applied here, once each.
 *
 *              The record lives in the GM-only control journal, so no player window shows it (a player
 *              at the browser console could still read it; see MarketStore).
 */

import {
  makeWindow, addWindow, windowReady, auditWindow, applyAudit, currentHeat, heatTier, valuePortfolio, normalizeHeat, HEAT_TUNING,
  concealedHolders, BUSINESS_DEFAULTS,
  warningsFor, tierRank, planInvestigation, makePenalty, sanitizePenaltyEdits, applyFine, applyFreeze, applyBrokerDrop, PENALTY_TUNING,
  applyHeatEffect, setCharacterHeat, setWarned, upsertPenalty, timeOf,
} from '../engine/index.js';
import { MODULE_ID, SETTINGS, HOOKS } from '../utils/constants.js';
import { log, isActiveGM, L } from '../utils/helpers.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { BrokerRepository } from '../data/BrokerRepository.js';
import { MarketClock } from './MarketClockService.js';
import { MailService } from './MailService.js';
import { PortfolioService } from './PortfolioService.js';
import { SerialQueue } from '../utils/queue.js';

const setting = (key) => game.settings.get(MODULE_ID, key);
const newId = () => foundry.utils.randomID(8);

/** Accounts with a portfolio: characters, and syndicates (whose heat is collective, DESIGN §30). */
const traders = () => PortfolioRepository.accounts().filter((a) => PortfolioRepository.hasPortfolio(a));

class HeatServiceImpl {
  constructor() {
    this._queue = new SerialQueue('Heat service task', { ok: false });
  }

  enabled() {
    return setting(SETTINGS.HEAT_ENABLED) === true;
  }

  strength() {
    return Number(setting(SETTINGS.HEAT_STRENGTH)) || 1;
  }

  /** Warnings, enquiries and penalties switched on? (Heat is still recorded when they are off.) */
  consequencesOn() {
    return setting(SETTINGS.HEAT_CONSEQUENCES) !== false;
  }

  approvalRequired() {
    return setting(SETTINGS.HEAT_PENALTY_APPROVAL) !== false;
  }

  tick() {
    return MarketStore.time();
  }

  /** A character's heat right now (GM client only; players have no access to the record). */
  heatOf(actorId) {
    return currentHeat(MarketStore.getHeat().characters[actorId], this.tick());
  }

  tierOf(actorId) {
    return heatTier(this.heatOf(actorId));
  }

  /**
   * Open a watch window for a gig impact that has just been queued. Does nothing when heat is off.
   * @param {object} rec - the gig record (`sourceKey`, `gigId`, `companyId`, `outcome`, `tick`, `date`, `delayDays`)
   * @param {{tipped?: string[], runners?: string[]}} [who] - characters who were sent a rumour, or ran the gig
   */
  openWindow(rec, { tipped = [], runners = [] } = {}) {
    if (!isActiveGM() || !this.enabled()) return Promise.resolve(null);
    return this._queue.run(async () => {
      const impact = MarketStore.getControls().impacts.find((i) => i.sourceKey === rec.sourceKey);
      const nowTick = this.tick();
      const window = makeWindow({
        id: newId(),
        sourceKey: rec.sourceKey,
        gigId: rec.gigId ?? null,
        companyId: rec.companyId,
        outcome: rec.outcome,
        openTick: rec.tick ?? nowTick,
        closeTick: impact?.onsetTick ?? nowTick + Math.max(0, Math.floor(rec.delayDays ?? 1) - 1),
        openDate: rec.date ?? '',
        tipped,
        runners,
      });
      const heat = MarketStore.getHeat();
      if (heat.windows.some((w) => w.sourceKey === rec.sourceKey)) return null;
      await MarketStore.setHeat(addWindow(heat, window));
      Hooks.callAll(HOOKS.HEAT_CHANGED);
      return window;
    });
  }

  /** Someone has heard a rumour about this move (F1c): on its open window, they count as tipped. */
  noteTipped(sourceKey, actorId) {
    if (!isActiveGM() || !this.enabled()) return Promise.resolve();
    return this._queue.run(async () => {
      const heat = MarketStore.getHeat();
      const window = heat.windows.find((w) => w.sourceKey === sourceKey && w.status === 'open');
      if (!window || window.tipped.includes(actorId) || window.runners.includes(actorId)) return;
      await MarketStore.setHeat({ ...heat, windows: heat.windows.map((w) => (w === window ? { ...w, tipped: [...w.tipped, actorId] } : w)) });
    });
  }

  /** After a tick: audit every window that has closed, apply players' cover-up results, and let warnings re-arm. */
  onTick() {
    if (!isActiveGM() || !this.enabled()) return Promise.resolve();
    return this._queue.run(async () => {
      const pub = MarketStore.getPublic();
      const tick = timeOf(pub);
      const actors = traders();
      for (const actor of actors) await this._reconcile(actor);

      const portfolios = actors.map((a) => ({ actor: a, p: PortfolioRepository.get(a) }));
      const ready = MarketStore.getHeat().windows.filter((w) => windowReady(w, tick, portfolios.map(({ p }) => p.orders)));
      for (const window of ready) await this._audit(window, portfolios, pub, tick);
      await this._rearm(tick);
    });
  }

  async _audit(window, portfolios, pub, tick) {
    const prices = {};
    for (const [id, c] of Object.entries(pub.companies ?? {})) prices[id] = c.price;
    for (const [id, f] of Object.entries(pub.funds ?? {})) prices[id] = f.nav;

    // A skilled broker leaves a smaller trail, so each broker's grade sets their clients' share.
    const brokerFactors = Object.fromEntries(BrokerRepository.list().map((b) => [b.id, HEAT_TUNING.brokerFactor[b.grade] ?? 1]));

    const results = auditWindow({
      window,
      strength: this.strength(),
      portfolios: portfolios.map(({ actor, p }) => ({
        actorId: actor.id, name: actor.name, orders: p.orders, value: valuePortfolio(p, prices).total, brokerFactors,
        // A syndicate knows what any of its members knows.
        ...(actor.isSyndicate ? { aliases: actor.members().map((m) => m.id) } : {}),
      })),
    });
    // A holder concealing more than the disclosure threshold of this company draws more heat (B6d).
    const listed = BusinessRepository.all().find((b) => b.company?.ticker === window.companyId && b.listing?.status === 'listed');
    if (listed) {
      const concealed = new Set(concealedHolders(listed).map((x) => x.holderId));
      for (const r of results) if (concealed.has(r.actorId)) r.gain = Math.round(r.gain * BUSINESS_DEFAULTS.ownership.insider * 10) / 10;
    }
    const next = applyAudit(MarketStore.getHeat(), { window, results, tick, date: MarketClock.dateString() });
    await MarketStore.setHeat(next);
    Hooks.callAll(HOOKS.HEAT_AUDIT, { window, results });
    Hooks.callAll(HOOKS.HEAT_CHANGED);

    if (this.consequencesOn()) {
      for (const result of results) await this._consequences(window, result, tick);
    }
  }

  // ── Consequences ───────────────────────────────────────────────────────────

  async _consequences(window, result, tick) {
    const actor = PortfolioRepository.accountOf(result.actorId);
    if (!actor) return;
    try {
      const heat = MarketStore.getHeat();
      const entry = heat.characters[actor.id];
      const now = currentHeat(entry, tick);
      const w = warningsFor({ heat: now, warnedRank: entry?.warned ?? 0 });
      await MarketStore.setHeat(setWarned(heat, actor.id, w.warnedRank));
      for (const tier of w.send) await this._warn(actor, tier);

      const applied = (MarketStore.getHeat().audits.at(-1)?.results ?? []).find((r) => r.actorId === actor.id)?.applied ?? result.gain;
      if (w.tier === 'investigated' && applied > 0) await this._investigate(actor, window, result, now, tick);
    } catch (error) {
      log.error('Applying heat consequences failed', error);
    }
  }

  /** Make the character aware (so the cover-up actions show), and tell them in the right voice. */
  async _warn(actor, tier) {
    const portfolio = PortfolioRepository.get(actor);
    let delivered = false;
    if (tier === 'noticed' && portfolio.brokerContactId) {
      delivered = (await MailService.fromBroker(portfolio.brokerContactId, actor, MailService.heatWarning())).ok;
    } else if (tier === 'flagged') {
      delivered = (await MailService.fromNcpd(actor, MailService.ncpdEnquiry())).ok;
    }
    if (delivered) await this._makeAware(actor);
    Hooks.callAll(HOOKS.HEAT_CHANGED);
  }

  _makeAware(actor) {
    return PortfolioService.transformActor(actor, (p) => (p.heatAware ? { portfolio: p, changed: false } : { portfolio: { ...p, heatAware: true } }));
  }

  async _investigate(actor, window, result, heat, tick) {
    const current = MarketStore.getHeat();
    if (current.penalties.some((p) => p.actorId === actor.id && p.status === 'pending')) return;

    const portfolio = PortfolioRepository.get(actor);
    const plan = planInvestigation({ actorId: actor.id, sourceKey: window.sourceKey, heat, trades: result.trades, brokerId: portfolio.brokerContactId });
    const penalty = makePenalty({
      id: newId(), actorId: actor.id, name: actor.name, plan, tick, date: MarketClock.dateString(), sourceKey: window.sourceKey, heat,
      status: this.approvalRequired() ? 'pending' : 'applied',
    });
    await MarketStore.setHeat(upsertPenalty(MarketStore.getHeat(), penalty));
    Hooks.callAll(HOOKS.HEAT_PENALTY, { penalty });
    Hooks.callAll(HOOKS.HEAT_CHANGED);

    if (penalty.status === 'pending') {
      ui.notifications.info(L('NCI.Heat.Notice.Pending', { name: actor.name }));
      return;
    }
    await this._execute(penalty);
  }

  /** Carry out a penalty: change the portfolio, tell the player, and let the heat settle. */
  async _execute(penalty) {
    const actor = PortfolioRepository.accountOf(penalty.actorId);
    if (!actor) return;
    const tick = this.tick();
    const ref = `heat:${penalty.id}`;
    const settled = { ...penalty, status: 'applied', appliedTick: tick };

    if (penalty.kind === 'fine') {
      const out = await PortfolioService.transformActor(actor, (p) => applyFine(p, { amount: penalty.params.amount, tick, ref }));
      settled.result = { paid: out?.paid ?? 0, shortfall: out?.shortfall ?? penalty.params.amount };
      await MailService.fromNcpd(actor, MailService.ncpdPenalty('fine', settled.result));
    } else if (penalty.kind === 'freeze') {
      const out = await PortfolioService.transformActor(actor, (p) => applyFreeze(p, { days: penalty.params.days, tick }));
      settled.result = { untilTick: out?.untilTick ?? tick + penalty.params.days };
      await MailService.fromNcpd(actor, MailService.ncpdPenalty('freeze', { days: penalty.params.days }));
    } else {
      const brokerId = penalty.params.brokerId ?? PortfolioRepository.get(actor).brokerContactId;
      const out = await PortfolioService.transformActor(actor, (p) => applyBrokerDrop(p, { brokerId, banDays: penalty.params.banDays, tick }));
      settled.result = { dropped: !!out?.dropped, brokerId };
      if (out?.dropped && brokerId) await MailService.fromBroker(brokerId, actor, MailService.brokerDropped());
    }

    // The case is closed: the pressure eases, though a character who keeps at it will be back.
    let heat = upsertPenalty(MarketStore.getHeat(), settled);
    const entry = heat.characters[actor.id];
    heat = setCharacterHeat(heat, { actorId: actor.id, name: actor.name, value: currentHeat(entry, tick) * PENALTY_TUNING.heatAfter, tick, date: MarketClock.dateString() });
    heat = setWarned(heat, actor.id, tierRank(heatTier(heat.characters[actor.id].heat)));
    await MarketStore.setHeat(heat);
    await this._makeAware(actor);
    Hooks.callAll(HOOKS.HEAT_PENALTY, { penalty: settled });
    Hooks.callAll(HOOKS.HEAT_CHANGED);
  }

  // ── The GM's decisions ─────────────────────────────────────────────────────

  /**
   * Approve a waiting penalty, optionally with a different fine or length.
   * @param {string} id
   * @param {{amount?: number, days?: number}} [edits]
   */
  approvePenalty(id, edits = {}) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._queue.run(async () => {
      const penalty = MarketStore.getHeat().penalties.find((p) => p.id === id && p.status === 'pending');
      if (!penalty) return { ok: false, status: 'unknown' };
      const fixed = sanitizePenaltyEdits(penalty.kind, { amount: edits.amount ?? penalty.params.amount, days: edits.days ?? penalty.params.days ?? penalty.params.banDays });
      if (!fixed) return { ok: false, status: 'invalid' };
      await this._execute({ ...penalty, params: { ...penalty.params, ...fixed } });
      return { ok: true, status: 'applied' };
    });
  }

  dismissPenalty(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._queue.run(async () => {
      const penalty = MarketStore.getHeat().penalties.find((p) => p.id === id && p.status === 'pending');
      if (!penalty) return { ok: false, status: 'unknown' };
      await MarketStore.setHeat(upsertPenalty(MarketStore.getHeat(), { ...penalty, status: 'dismissed', appliedTick: this.tick() }));
      Hooks.callAll(HOOKS.HEAT_PENALTY, { penalty: { ...penalty, status: 'dismissed' } });
      Hooks.callAll(HOOKS.HEAT_CHANGED);
      return { ok: true, status: 'dismissed' };
    });
  }

  /** Set a character's heat outright (0 clears it). Lowering it re-arms the warnings. */
  setHeat(actorId, value) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    const actor = PortfolioRepository.accountOf(actorId);
    const v = Number(value);
    if (!actor || !Number.isFinite(v)) return Promise.resolve({ ok: false, status: 'invalid' });
    return this._queue.run(async () => {
      let heat = setCharacterHeat(MarketStore.getHeat(), { actorId, name: actor.name, value: v, tick: this.tick(), date: MarketClock.dateString() });
      const entry = heat.characters[actorId];
      const rank = tierRank(heatTier(currentHeat(entry, this.tick())));
      if ((entry.warned ?? 0) > rank) heat = setWarned(heat, actorId, rank);
      await MarketStore.setHeat(heat);
      Hooks.callAll(HOOKS.HEAT_CHANGED);
      return { ok: true, status: 'set' };
    });
  }

  // ── Players' cover-up actions ──────────────────────────────────────────────

  /** A portfolio result arrived: apply any cover-up action it contains. */
  onPortfolioEvents({ actorId, results = [] }) {
    if (!isActiveGM() || !this.enabled() || !results.some((r) => r.type === 'heatAction')) return Promise.resolve();
    const actor = PortfolioRepository.accountOf(actorId);
    if (!actor) return Promise.resolve();
    return this._queue.run(() => this._reconcile(actor));
  }

  /**
   * Apply every cover-up result on a portfolio that the heat record has not seen yet. Safe to run
   * again (each request key is applied once), so a crash between the portfolio and the record heals.
   */
  async _reconcile(actor) {
    const results = PortfolioRepository.get(actor).results.filter((r) => r.type === 'heatAction' && r.ok);
    if (!results.length) return;
    let heat = MarketStore.getHeat();
    let changed = false;
    for (const r of results) {
      const out = applyHeatEffect(heat, { actorId: actor.id, name: actor.name, key: r.key, action: r.action, tick: r.tick, date: MarketClock.dateString() }, r);
      if (!out.applied) continue;
      heat = out.heat;
      changed = true;
    }
    if (!changed) return;
    const entry = heat.characters[actor.id];
    heat = setWarned(heat, actor.id, Math.min(entry.warned ?? 0, tierRank(heatTier(currentHeat(entry, this.tick())))));
    await MarketStore.setHeat(heat);
    Hooks.callAll(HOOKS.HEAT_CHANGED);
  }

  /** Heat that has faded below a tier lets that tier's warning go out again later. */
  async _rearm(tick) {
    let heat = MarketStore.getHeat();
    let changed = false;
    for (const [actorId, entry] of Object.entries(heat.characters)) {
      const rank = tierRank(heatTier(currentHeat(entry, tick)));
      if ((entry.warned ?? 0) > rank) {
        heat = setWarned(heat, actorId, rank);
        changed = true;
      }
    }
    if (changed) await MarketStore.setHeat(heat);
  }

  /** The record, for the GM Console: every character with heat (faded to now), the windows, audits and penalties. */
  snapshot() {
    const heat = normalizeHeat(MarketStore.getHeat());
    const tick = this.tick();
    const characters = Object.entries(heat.characters)
      .map(([actorId, e]) => {
        const now = currentHeat(e, tick);
        return {
          actorId,
          name: game.actors.get(actorId)?.name ?? e.name ?? actorId,
          heat: now,
          tier: heatTier(now),
          tick: e.tick,
          log: e.log ?? [],
          cover: e.cover && tick <= e.cover.until ? e.cover : null,
        };
      })
      .sort((a, b) => b.heat - a.heat);
    return { tick, characters, windows: heat.windows, audits: heat.audits, penalties: heat.penalties };
  }
}

export const HeatService = new HeatServiceImpl();
