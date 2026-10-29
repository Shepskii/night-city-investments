/**
 * Syndicate service: the GM-side executor for syndicates (DESIGN §31).
 * @file scripts/services/SyndicateService.js
 * @description Runs only on the active GM client. It reads each character's syndicate outbox, applies
 *              the requests with the pure engine, runs officers' trades through the market's own
 *              executor on the syndicate's account, and writes the syndicate, the members' brokerage
 *              accounts it touched, and a receipt. A deposit or a redemption changes a member's own
 *              portfolio, so all of it runs in step with order processing (PortfolioService's queue).
 */

import {
  applySyndicateRequest, advanceSyndicate, approveSyndicate, decideProposal, closeSyndicate, applyRequests, dayIndex, PROCESSED_CAP,
} from '../engine/index.js';
import { MODULE_ID, FLAGS, SETTINGS, HOOKS } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { MarketClock } from './MarketClockService.js';
import { PortfolioService } from './PortfolioService.js';
import { TradingSettings } from './TradingSettings.js';
import { syndicateReceipts, pendingSyndicateRequests } from './SyndicateClient.js';
import { BusinessService } from './BusinessService.js';
import { SyndicateCash } from './SyndicateCash.js';
import { SyndicateMail, describeProposal } from './SyndicateMail.js';
import { BusinessRepository } from '../data/BusinessRepository.js';

const RESULTS_CAP = 20;

class SyndicateServiceImpl {
  constructor() {
    /** Business requests passed proposals want made, run once the portfolio queue is free. */
    this._after = [];
    /** Mail and ownership updates waiting for the portfolio queue to be free: `{ syndicateId, events, members }`. */
    this._notices = [];
  }

  enabled() {
    return game.settings.get(MODULE_ID, SETTINGS.SYNDICATES_ENABLED) !== false;
  }

  day() {
    return dayIndex(MarketClock.nowMs());
  }

  tick() {
    return MarketStore.time();
  }

  /** Every character a request may name, by id. */
  actors() {
    return Object.fromEntries(game.actors.filter((a) => a.type === 'character').map((a) => [a.id, a.name]));
  }

  /** @param {number} [stakes] - the syndicate's business stakes at book value, which count in its value */
  context(stakes = 0) {
    return {
      approval: game.settings.get(MODULE_ID, SETTINGS.SYNDICATE_APPROVAL) !== false,
      actors: this.actors(),
      newId: `syn_${foundry.utils.randomID(12)}`,
      settlementDays: TradingSettings.settlementDays(),
      stakes,
    };
  }

  /** The record, the syndicate's account and its members' own accounts. */
  books(id) {
    const syndicate = SyndicateRepository.get(id);
    if (!syndicate) return null;
    const members = {};
    for (const m of syndicate.members) {
      const actor = game.actors.get(m.actorId);
      if (actor) members[m.actorId] = PortfolioRepository.get(actor);
    }
    return { syndicate, portfolio: SyndicateRepository.portfolio(id), members, stakes: SyndicateCash.stakesOf(id) };
  }

  /**
   * Make the business requests that passed proposals asked for. They run in the business service's
   * queue, which pays the syndicate through the portfolio queue, so they wait until that is free.
   */
  async _flush() {
    for (const job of this._after.splice(0)) {
      const out = await BusinessService.applyFor(job.syndicateId, job.request);
      if (out.ok) continue;
      await SyndicateCash.noteFailed(job.syndicateId, { label: job.label, reason: out.reason });
      const s = SyndicateRepository.get(job.syndicateId);
      const text = s ? describeProposal(s, { kind: 'business', business: job.request, amount: job.amount, label: job.label }) : job.label;
      this._notices.push({ syndicateId: job.syndicateId, events: [{ type: 'agreedFailed', text, reason: out.reason }] });
    }
    for (const notice of this._notices.splice(0)) {
      if (notice.members) await BusinessRepository.refreshOwnership(notice.syndicateId);
      await SyndicateMail.send(notice.syndicateId, notice.events);
    }
  }

  /** Handle whatever is waiting in one character's syndicate outbox. */
  processActor(actor) {
    if (!isActiveGM()) return Promise.resolve();
    return PortfolioService.exclusive(() => this._process(actor)).then(() => this._flush());
  }

  /** Handle every character's syndicate outbox. Run at startup. */
  sweepAll() {
    if (!isActiveGM()) return Promise.resolve();
    return PortfolioService.exclusive(async () => {
      for (const actor of game.actors.filter((a) => a.type === 'character')) await this._process(actor);
    }).then(() => this._flush());
  }

  async _process(actor) {
    for (const request of pendingSyndicateRequests(actor)) {
      try {
        await this._handle(actor, request);
      } catch (error) {
        log.error(`Syndicate request ${request.type} failed`, error);
        await this._receipt(actor, request, { ok: false, reason: 'error' });
      }
    }
  }

  async _handle(actor, request) {
    if (!this.enabled()) return this._receipt(actor, request, { ok: false, reason: 'disabled' });
    const books = request.type === 'found' ? null : this.books(request.syndicateId);
    if (request.type !== 'found' && !books) return this._receipt(actor, request, { ok: false, reason: 'no-syndicate' });
    if (books && !books.members[actor.id]) books.members[actor.id] = PortfolioRepository.get(actor);

    const out = applySyndicateRequest({
      books, request, actor: { id: actor.id, name: actor.name }, day: this.day(), tick: this.tick(), market: PortfolioService.market(), context: this.context(books?.stakes ?? 0),
    });
    if (!out.ok) return this._receipt(actor, request, out);
    const { results } = await this._commit(out, actor);
    const inner = results.find((r) => r.key === request.key) ?? null;
    return this._receipt(actor, request, { ok: inner ? inner.ok : true, ...(inner && !inner.ok ? { reason: inner.reason } : {}), syndicateId: out.books.syndicate.id, ...(inner ? { inner } : {}) });
  }

  /**
   * Save what the engine returned: run any trades on the syndicate's account (the officer's own roll
   * opens a terminal session), then write the syndicate and every member account that changed.
   * @param {Actor|null} officer - the member whose request it was, for a terminal roll
   */
  async _commit(out, officer = null) {
    const { syndicate } = out.books;
    const activeIds = (s) => (s?.members ?? []).filter((m) => m.status === 'active').map((m) => m.actorId).sort().join();
    const membersChanged = activeIds(SyndicateRepository.get(syndicate.id)) !== activeIds(syndicate);
    const notices = [...out.events];
    let portfolio = out.books.portfolio;
    let events = [];
    let results = [];
    if (out.trades.length) {
      const tick = this.tick();
      const checks = officer ? await PortfolioService._checks(officer, out.trades, portfolio, tick) : {};
      const ran = applyRequests({
        portfolio, requests: out.trades, wealth: 0, tick, market: PortfolioService.market(), settings: PortfolioService.settings(checks, { id: syndicate.id }),
      });
      portfolio = ran.portfolio;
      events = ran.events;
      const keys = new Set(out.trades.map((t) => t.key));
      results = portfolio.results.filter((r) => keys.has(r.key));
      // The officer who opened a session is the one at the terminal: leaving CorpNet ends it.
      const opened = results.some((r) => r.type === 'connectTerminal' && r.passed && !r.already);
      if (opened && officer && portfolio.session) portfolio = { ...portfolio, session: { ...portfolio.session, by: officer.id } };
      // A trade the members agreed that could not be placed is noted, and they are told.
      for (const r of results.filter((x) => !x.ok && String(x.key).startsWith('p_'))) {
        const proposal = out.events.find((e) => e.proposal?.id === r.key)?.proposal;
        const text = proposal ? describeProposal(syndicate, proposal) : '';
        syndicate.ledger = [...syndicate.ledger, { day: this.day(), kind: 'tradeFailed', text, reason: r.reason }].slice(-120);
        notices.push({ type: 'agreedFailed', text, reason: r.reason });
      }
    }
    await SyndicateRepository.save(syndicate, portfolio);
    for (const job of out.business ?? []) this._after.push({ syndicateId: syndicate.id, ...job });
    if (notices.length || membersChanged) this._notices.push({ syndicateId: syndicate.id, events: notices, members: membersChanged });
    for (const actorId of out.changed) {
      const actor = game.actors.get(actorId);
      if (actor && out.books.members[actorId]) await PortfolioRepository.save(actor, out.books.members[actorId]);
    }
    const account = SyndicateRepository.account(syndicate.id);
    if (account && (events.length || results.length)) PortfolioService._emit(account, events, results);
    Hooks.callAll(HOOKS.SYNDICATES_CHANGED, { syndicateId: syndicate.id, events: out.events });
    return { results, events };
  }

  async _receipt(actor, request, out) {
    const r = syndicateReceipts(actor);
    const result = {
      key: request.key, type: request.type, ok: out.ok, ...(out.ok ? {} : { reason: out.reason }),
      syndicateId: out.syndicateId ?? request.syndicateId ?? null, day: this.day(), ...(out.inner ? { inner: out.inner } : {}),
    };
    await actor.setFlag(MODULE_ID, FLAGS.SYNDICATE_RECEIPTS, [{
      processed: [...r.processed, request.key].slice(-PROCESSED_CAP),
      results: [...r.results, result].slice(-RESULTS_CAP),
    }]);
    return result;
  }

  // ── Time passing ───────────────────────────────────────────────────────────

  /** After a tick: settle lapsed proposals and pay the redemptions that have come due and are covered. */
  onTick() {
    if (!isActiveGM() || !this.enabled()) return Promise.resolve(0);
    return PortfolioService.exclusive(async () => {
      let changed = 0;
      for (const s of SyndicateRepository.all().filter((x) => x.status === 'active')) {
        const books = this.books(s.id);
        const out = advanceSyndicate({ books, day: this.day(), tick: this.tick(), market: PortfolioService.market(), context: this.context(books.stakes) });
        if (!out.events.length && !out.changed.length && !out.trades.length) continue;
        await this._commit(out);
        changed++;
      }
      return changed;
    }).then(async (changed) => {
      await this._flush();
      return changed;
    });
  }

  // ── The GM's decisions ─────────────────────────────────────────────────────

  /** Let a pending syndicate start. */
  approve(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return PortfolioService.exclusive(async () => {
      const out = approveSyndicate(SyndicateRepository.get(id));
      if (!out.ok) return out;
      await SyndicateRepository.save(out.syndicate);
      Hooks.callAll(HOOKS.SYNDICATES_CHANGED, { syndicateId: id });
      return { ok: true };
    });
  }

  /** Turn a pending syndicate down: nothing has been paid in yet, so its journal is simply removed. */
  reject(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return PortfolioService.exclusive(async () => {
      if (SyndicateRepository.get(id)?.status !== 'pending') return { ok: false, reason: 'not-pending' };
      await SyndicateRepository.remove(id);
      Hooks.callAll(HOOKS.SYNDICATES_CHANGED, { syndicateId: id });
      return { ok: true };
    });
  }

  /** Force a proposal through, or strike it out. */
  decide(id, proposalId, how) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return PortfolioService.exclusive(async () => {
      const books = this.books(id);
      if (!books) return { ok: false, reason: 'no-syndicate' };
      const out = decideProposal({ books, proposalId, how, day: this.day(), tick: this.tick(), market: PortfolioService.market(), context: this.context(books.stakes) });
      if (!out.ok) return out;
      await this._commit(out);
      return { ok: true };
    }).then(async (result) => {
      await this._flush();
      return result;
    });
  }

  /** Wind a syndicate up: its account must hold nothing but cash, which is paid out by units. */
  close(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return PortfolioService.exclusive(async () => {
      const books = this.books(id);
      if (!books) return { ok: false, reason: 'no-syndicate' };
      const out = closeSyndicate({ books, day: this.day(), tick: this.tick(), stakes: books.stakes });
      if (!out.ok) return out;
      await this._commit(out);
      return { ok: true };
    }).then(async (result) => {
      await this._flush();
      return result;
    });
  }
}

export const SyndicateService = new SyndicateServiceImpl();
