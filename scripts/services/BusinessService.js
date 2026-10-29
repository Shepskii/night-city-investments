/**
 * Business service: the GM-side executor for player businesses.
 * @file scripts/services/BusinessService.js
 * @description Runs only on the active GM client. It reads each character's business outbox, reads
 *              the dice of any roll back from its chat card, applies the request with the pure engine,
 *              moves the eddies, and saves the record. After each market tick it brings every open
 *              business up to the market's date, closing the weeks that have ended. Everything goes
 *              through one serial queue.
 */

import {
  applyBusinessRequest, advanceBusiness, approveBusiness, rejectBusiness, markLeaving, rollSpec, dayIndex, ROLL_REQUESTS, PROCESSED_CAP,
} from '../engine/index.js';
import { MODULE_ID, FLAGS, SETTINGS, HOOKS } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { SerialQueue } from '../utils/queue.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { MarketClock } from './MarketClockService.js';
import { SkillAdapter } from './SkillAdapter.js';
import { WealthAdapter } from './WealthAdapter.js';
import { receiptsOf, pendingBusinessRequests, operatorRankOf } from './BusinessClient.js';

const RESULTS_CAP = 40;
const WEALTH_REASON = 'Night City Investments: business';

class BusinessServiceImpl {
  constructor() {
    this._queue = new SerialQueue('Business service task');
  }

  enabled() {
    return game.settings.get(MODULE_ID, SETTINGS.BUSINESSES_ENABLED) !== false;
  }

  /** Today, as a market day. */
  day() {
    return dayIndex(MarketClock.nowMs());
  }

  weekday() {
    const d = Math.floor(Number(game.settings.get(MODULE_ID, SETTINGS.BUSINESS_WEEKDAY)));
    return d >= 0 && d <= 6 ? d : 1;
  }

  growthRate() {
    const g = Number(game.settings.get(MODULE_ID, SETTINGS.BUSINESS_GROWTH_RATE));
    return Number.isFinite(g) && g > 0 ? g : 1;
  }

  /** Every character a request may name, by id. */
  actors() {
    return Object.fromEntries(game.actors.filter((a) => a.type === 'character').map((a) => [a.id, a.name]));
  }

  context(business) {
    return {
      approval: game.settings.get(MODULE_ID, SETTINGS.BUSINESS_APPROVAL) !== false,
      weekday: this.weekday(),
      growthRate: this.growthRate(),
      operatorRank: business ? operatorRankOf(business) : 0,
      actors: this.actors(),
      newId: `bus_${foundry.utils.randomID(12)}`,
    };
  }

  /** Handle whatever is waiting in one character's business outbox. */
  processActor(actor) {
    if (!isActiveGM()) return Promise.resolve();
    return this._queue.run(() => this._process(actor));
  }

  /** Handle every character's outbox. Run at startup. */
  sweepAll() {
    if (!isActiveGM()) return Promise.resolve();
    return this._queue.run(async () => {
      for (const actor of game.actors.filter((a) => a.type === 'character')) await this._process(actor);
    });
  }

  async _process(actor) {
    for (const request of pendingBusinessRequests(actor)) {
      try {
        await this._handle(actor, request);
      } catch (error) {
        log.error(`Business request ${request.type} failed`, error);
        await this._receipt(actor, request, { ok: false, reason: 'error' });
      }
    }
  }

  async _handle(actor, request) {
    if (!this.enabled()) return this._receipt(actor, request, { ok: false, reason: 'disabled' });
    const business = request.type === 'found' ? null : BusinessRepository.get(request.businessId);
    if (request.type !== 'found' && !business) return this._receipt(actor, request, { ok: false, reason: 'no-business' });

    const day = this.day();
    const context = this.context(business);
    let check = null;
    if (business && ROLL_REQUESTS.includes(request.type) && request.use) {
      // The same checks the engine makes, first, so a request that would be refused does not use up its card.
      const spec = rollSpec(business, request, actor.id, { day, operatorRank: context.operatorRank });
      if (spec.ok) {
        check = await SkillAdapter.verifyLevers(actor, request, {
          dv: spec.dv, use: request.use.kind === 'hire' ? request.use : spec.use, bonusAvailable: spec.bonusAvailable, extraAvailable: spec.extraAvailable, allowHire: spec.allowHire,
        });
      }
    }

    const out = applyBusinessRequest({
      business, request, actor: { id: actor.id, name: actor.name, wealth: WealthAdapter.get(actor) }, day, check, context,
    });
    if (out.ok) await this._commit(out);
    return this._receipt(actor, request, out);
  }

  /** Eddies first, then the record, then the hidden state; then tell everyone. */
  async _commit(out) {
    await this._pay(out.wealth);
    await BusinessRepository.save(out.business);
    const exposure = out.events.reduce((a, e) => a + (e.exposure ?? 0), 0);
    if (exposure) {
      const hidden = MarketStore.getBusinessesHidden();
      const entry = hidden[out.business.id] ?? { exposure: 0 };
      await MarketStore.setBusinessesHidden({ ...hidden, [out.business.id]: { ...entry, exposure: entry.exposure + exposure } });
    }
    for (const event of out.events.filter((e) => e.type === 'periodClosed')) {
      Hooks.callAll(HOOKS.BUSINESS_PERIOD, { businessId: out.business.id, digest: event.digest });
    }
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: out.business.id, events: out.events });
  }

  async _pay(wealth) {
    for (const [actorId, delta] of Object.entries(wealth ?? {})) {
      const actor = game.actors.get(actorId);
      if (!actor || !delta) continue;
      await WealthAdapter.set(actor, WealthAdapter.get(actor) + delta, WEALTH_REASON);
    }
  }

  async _receipt(actor, request, out) {
    const r = receiptsOf(actor);
    const result = {
      key: request.key, type: request.type, ok: out.ok, ...(out.ok ? {} : { reason: out.reason }),
      businessId: out.business?.id ?? request.businessId ?? null, day: this.day(),
    };
    await actor.setFlag(MODULE_ID, FLAGS.BUSINESS_RECEIPTS, [{
      processed: [...r.processed, request.key].slice(-PROCESSED_CAP),
      results: [...r.results, result].slice(-RESULTS_CAP),
    }]);
    return result;
  }

  // ── Time passing ───────────────────────────────────────────────────────────

  /** After a tick: bring every open business up to the market's date. */
  onTick() {
    if (!isActiveGM() || !this.enabled()) return Promise.resolve(0);
    return this._queue.run(async () => {
      const day = this.day();
      const opts = { weekday: this.weekday(), growthRate: this.growthRate(), actors: this.actors() };
      let changed = 0;
      for (const business of BusinessRepository.all().filter((b) => b.status === 'open')) {
        const out = advanceBusiness(business, day, opts);
        if (!out.changed) continue;
        await this._commit({ ...out, ok: true });
        changed++;
      }
      return changed;
    });
  }

  // ── The GM's decisions ─────────────────────────────────────────────────────

  _gm(id, fn) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const business = BusinessRepository.get(id);
      if (!business) return { ok: false, reason: 'no-business' };
      const out = fn(business);
      if (!out.ok) return out;
      await this._commit({ events: [], ...out });
      return { ok: true, business: out.business };
    });
  }

  /** Let a business waiting for approval open. */
  approve(id) {
    return this._gm(id, (b) => approveBusiness(b, this.day(), this.weekday()));
  }

  /** Turn a business down before it opens; everyone's money goes back. */
  reject(id) {
    return this._gm(id, (b) => rejectBusiness(b, this.day()));
  }

  /** A partner has died or left the table: the others may buy the stake, or it goes to the heir. */
  partnerLeaves(id, actorId) {
    return this._gm(id, (b) => markLeaving(b, actorId, this.day()));
  }

  /** Delete a business record outright, with its hidden state. No money moves. */
  remove(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const removed = await BusinessRepository.remove(id);
      if (!removed) return { ok: false, reason: 'no-business' };
      const hidden = MarketStore.getBusinessesHidden();
      if (id in hidden) {
        delete hidden[id];
        await MarketStore.setBusinessesHidden(hidden);
      }
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: id, events: [{ type: 'removed' }] });
      return { ok: true };
    });
  }

  /** Every business with its hidden state, for the GM's tab. */
  snapshot() {
    const hidden = MarketStore.getBusinessesHidden();
    return BusinessRepository.all().map((b) => ({ business: b, hidden: hidden[b.id] ?? { exposure: 0 } }));
  }
}

export const BusinessService = new BusinessServiceImpl();
