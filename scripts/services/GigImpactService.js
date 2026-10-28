/**
 * Gig impact service: turns Night City Map gig outcomes into market impacts. GM client only.
 * @file scripts/services/GigImpactService.js
 * @description The bridge module calls `report()` when a gig is completed or failed. The client is
 *              matched to a company, the size and delay of the reaction are worked out, and the GM
 *              either approves it (the default) or it is queued at once. A client that cannot be
 *              matched waits in a "needs mapping" list. Each impact is keyed (`gig:<id>:done`), so a
 *              gig can never move the market twice. All state lives in the GM-only control journal.
 */

import {
  GIG_OUTCOMES, resolveClient, parseReward, planGigImpact, gigHeadlineKey, recentGigAbs, isKnownGig,
  addPending, removePending, addHistory, setMapping, removeMapping, sanitizeGigEdits, normalizeName,
  makeImpact, percentToAmount, logEntry,
} from '../engine/index.js';
import { MODULE_ID, SETTINGS, HOOKS } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { MarketClock } from './MarketClockService.js';
import { TickService } from './TickService.js';
import { NewsService } from './NewsService.js';
import { NotificationService } from './NotificationService.js';
import { HeatService } from './HeatService.js';
import { MailService } from './MailService.js';

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const newId = () => foundry.utils.randomID(8);
const setting = (key) => game.settings.get(MODULE_ID, key);

const tradable = (company, pub) => !!company && company.status === 'active' && company.listed && !!pub.companies?.[company.id];

const historyEntry = (rec, status, extra = {}) => ({
  sourceKey: rec.sourceKey,
  gigId: rec.gigId ?? null,
  title: rec.title,
  client: rec.client,
  outcome: rec.outcome,
  reward: rec.reward,
  companyId: rec.companyId ?? null,
  how: rec.how ?? null,
  amount: rec.amount ?? 0,
  percent: rec.percent ?? 0,
  delayDays: rec.delayDays ?? 0,
  tick: rec.tick,
  date: rec.date,
  status,
  ...extra,
});

class GigImpactServiceImpl {
  constructor() {
    this._queue = Promise.resolve();
  }

  _enqueue(fn) {
    this._queue = this._queue.then(fn).catch((error) => {
      log.error('Gig impact task failed', error);
      return { ok: false, status: 'failed' };
    });
    return this._queue;
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  enabled() {
    return setting(SETTINGS.GIG_IMPACTS) !== false;
  }

  approvalRequired() {
    return setting(SETTINGS.GIG_IMPACT_APPROVAL) !== false;
  }

  scale() {
    return Number(setting(SETTINGS.GIG_IMPACT_SCALE)) || 1;
  }

  tipsOn() {
    return setting(SETTINGS.GIG_TIPS) === true;
  }

  // ── Reading (any client, but only the GM has the mappings and queue) ───────

  /** Which company would this gig be about? Does not change anything. */
  resolve(gig) {
    return resolveClient(gig ?? {}, CompanyRepository.all({ includeUnlisted: true }), MarketStore.getGigs().mappings);
  }

  /** Has this source key already been handled or queued? */
  known(sourceKey) {
    return isKnownGig(MarketStore.getGigs(), String(sourceKey));
  }

  /** Counts for the GM Console. */
  counts() {
    const { pending } = MarketStore.getGigs();
    return { review: pending.filter((p) => p.kind === 'review').length, mapping: pending.filter((p) => p.kind === 'mapping').length };
  }

  // ── Reporting an outcome ───────────────────────────────────────────────────

  /**
   * A gig was completed or failed.
   * @param {{gigId?: string, sourceKey?: string, outcome: 'done'|'failed', client?: string, reward?: number|string, title?: string, notes?: string, desc?: string}} payload
   * @returns {Promise<{ok: boolean, status: 'applied'|'pending'|'unmatched'|'ignored'|'duplicate'|'disabled'|'invalid'|'not-gm'|'failed', id?: string, companyId?: string, percent?: number, delayDays?: number}>}
   */
  report(payload) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    const outcome = payload?.outcome;
    const sourceKey = String(payload?.sourceKey ?? (payload?.gigId ? `gig:${payload.gigId}:${outcome}` : ''));
    if (!GIG_OUTCOMES.includes(outcome) || !sourceKey) return Promise.resolve({ ok: false, status: 'invalid' });
    if (!this.enabled()) return Promise.resolve({ ok: true, status: 'disabled' });
    return this._enqueue(() => this._report({ ...payload, outcome, sourceKey }));
  }

  /** GM Console form: report an outcome by hand, optionally naming the company outright. */
  reportManual({ client = '', outcome, reward = 0, title = '', companyId = '' }) {
    const company = companyId ? CompanyRepository.get(companyId) : null;
    return this.report({
      gigId: `manual-${newId()}`,
      outcome,
      client,
      reward,
      title,
      notes: company ? `[NCI: ${company.id}]` : '',
    });
  }

  async _report(p) {
    const gigs = MarketStore.getGigs();
    if (isKnownGig(gigs, p.sourceKey)) return { ok: true, status: 'duplicate' };

    const pub = MarketStore.getPublic();
    const base = {
      id: newId(),
      sourceKey: p.sourceKey,
      gigId: p.gigId ?? null,
      title: String(p.title ?? '').slice(0, 120),
      client: String(p.client ?? '').slice(0, 120),
      outcome: p.outcome,
      reward: parseReward(p.reward),
      tick: pub.time ?? pub.tickIndex ?? 0,
      date: MarketClock.dateString(),
    };
    const res = resolveClient(
      { client: p.client, notes: p.notes, text: [p.title, p.desc, p.notes].filter(Boolean).join(' ') },
      CompanyRepository.all({ includeUnlisted: true }),
      gigs.mappings,
    );

    if (res.status === 'ignored') return this._finish(addHistory(gigs, historyEntry(base, 'ignored', { reason: res.how })), 'ignored', base);

    if (res.status === 'matched') {
      const company = CompanyRepository.get(res.companyId);
      if (!tradable(company, pub)) return this._finish(addHistory(gigs, historyEntry({ ...base, companyId: res.companyId, how: res.how }, 'ignored', { reason: 'not-tradable' })), 'ignored', base);
      const rec = this._planned({ ...base, companyId: company.id, how: res.how }, gigs, company);
      if (this.approvalRequired() || res.needsReview) {
        const queued = { ...rec, kind: 'review', reason: res.needsReview ? res.how : 'approval' };
        await this._commit(addPending(gigs, queued));
        this._notice('Review', queued);
        Hooks.callAll(HOOKS.GIG_IMPACT, { status: 'pending', record: queued });
        return { ok: true, status: 'pending', id: queued.id, companyId: company.id, percent: rec.percent, delayDays: rec.delayDays };
      }
      return this._applyAndFinish(gigs, rec);
    }

    const queued = { ...base, kind: 'mapping', reason: res.status, clientKey: res.clientKey, candidates: res.candidates ?? [], companyId: null };
    await this._commit(addPending(gigs, queued));
    this._notice('Mapping', queued);
    Hooks.callAll(HOOKS.GIG_IMPACT, { status: 'unmatched', record: queued });
    return { ok: true, status: 'unmatched', id: queued.id };
  }

  /** A record with its size, delay and headline filled in. */
  _planned(rec, gigs, company) {
    const plan = planGigImpact({
      outcome: rec.outcome,
      reward: rec.reward,
      scale: this.scale(),
      recentAbs: recentGigAbs(gigs, company.id, rec.tick),
      key: rec.sourceKey,
    });
    const headline = L(gigHeadlineKey({ outcome: rec.outcome, percent: plan.percent, key: rec.sourceKey }), { name: company.name, ticker: company.ticker });
    return { ...rec, ...plan, headline };
  }

  async _commit(gigs) {
    await MarketStore.setGigs(gigs);
    Hooks.callAll(HOOKS.GIGS_CHANGED);
  }

  async _finish(gigs, status, record) {
    await this._commit(gigs);
    Hooks.callAll(HOOKS.GIG_IMPACT, { status, record });
    return { ok: true, status };
  }

  _notice(kind, rec) {
    const company = rec.companyId ? CompanyRepository.get(rec.companyId) : null;
    const text = L(`NCI.Gig.Notice.${kind}`, { client: rec.client || rec.title || '?', name: company?.name ?? '', outcome: L(`NCI.Gig.Outcome.${rec.outcome}`).toLowerCase() });
    if (kind === 'Mapping') ui.notifications.warn(text);
    else ui.notifications.info(text);
  }

  // ── Applying ───────────────────────────────────────────────────────────────

  /** Queue the impact on the market, record it, and tell the players who asked to hear rumours. */
  async _applyAndFinish(gigs, rec) {
    await this._queueImpact(rec);
    await this._commit(addHistory(gigs, historyEntry(rec, 'applied')));
    Hooks.callAll(HOOKS.GIG_IMPACT, { status: 'applied', record: rec });
    await this._afterApply(rec);
    return { ok: true, status: 'applied', companyId: rec.companyId, percent: rec.percent, delayDays: rec.delayDays };
  }

  /** The effect first shows `delayDays` game days on; the kernel counts from one tick before that. */
  _queueImpact(rec) {
    return TickService.updateControls((controls, { tick, dt }) => {
      if (controls.impacts.some((i) => i.sourceKey === rec.sourceKey)) return controls;
      return logEntry({
        ...controls,
        impacts: [...controls.impacts, makeImpact({
          id: newId(),
          target: { type: 'company', id: rec.companyId },
          amount: rec.amount,
          onsetTick: tick + Math.max(0, Math.floor(rec.delayDays) - dt),
          sourceKey: rec.sourceKey,
          source: 'gig',
          permanent: rec.permanent,
          tauDown: rec.tauDown,
          meta: { percent: rec.percent, gigId: rec.gigId, companyId: rec.companyId, headline: rec.headline || '', headlinePosted: !rec.headline },
        })],
      }, { ts: Date.now(), tick, kind: 'gig', companyId: rec.companyId, percent: rec.percent, days: Math.floor(rec.delayDays) });
    });
  }

  /** After a tick: publish the headline of any gig impact that has just started to show. */
  onTick() {
    if (!isActiveGM()) return Promise.resolve();
    return this._enqueue(async () => {
      const tick = MarketStore.time();
      const due = MarketStore.getControls().impacts.filter((i) => i.source === 'gig' && i.meta?.headline && !i.meta.headlinePosted && tick > i.onsetTick);
      if (!due.length) return;
      for (const i of due) await NewsService.post({ headline: i.meta.headline, tone: i.amount > 0 ? 'up' : 'down', companyIds: [i.target.id], source: 'gig' });
      const ids = new Set(due.map((i) => i.id));
      await TickService.updateControls((controls) => ({
        ...controls,
        impacts: controls.impacts.map((i) => (ids.has(i.id) ? { ...i, meta: { ...i.meta, headlinePosted: true } } : i)),
      }));
    });
  }

  /** After an impact is queued: send any rumours, then open a heat watch window recording who was tipped off. */
  async _afterApply(rec) {
    const tipped = await this._tip(rec);
    try {
      await HeatService.openWindow(rec, { tipped });
    } catch (error) {
      log.error('Opening a heat window failed', error);
    }
  }

  /**
   * Optional rumour mail, sent before the effect shows, to opted-in players who hold or watch the company.
   * @returns {Promise<string[]>} the ids of the characters it was sent to
   */
  async _tip(rec) {
    const sent = [];
    if (!this.tipsOn()) return sent;
    const company = CompanyRepository.get(rec.companyId);
    if (!company) return sent;
    try {
      for (const actor of game.actors.filter((a) => a.type === 'character' && PortfolioRepository.hasPortfolio(a))) {
        if (NotificationService.prefs(actor).tips === 'off') continue;
        const portfolio = PortfolioRepository.get(actor);
        const involved = portfolio.lots.some((l) => l.assetId === company.id) || PortfolioRepository.watchlist(actor).includes(company.id);
        if (!involved) continue;
        const out = await NotificationService.notify(actor, 'tips', MailService.tip({ name: company.name, ticker: company.ticker, outcome: rec.outcome }), portfolio.brokerContactId ?? null);
        if (out?.ok !== false) sent.push(actor.id);
      }
    } catch (error) {
      log.error('Sending gig tips failed', error);
    }
    return sent;
  }

  // ── GM decisions ───────────────────────────────────────────────────────────

  /**
   * Approve a queued impact, optionally with the GM's own size, delay and headline.
   * @param {string} id
   * @param {{percent?: number, delayDays?: number, headline?: string}} [edits]
   */
  approve(id, edits = {}) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._enqueue(async () => {
      const gigs = MarketStore.getGigs();
      const rec = gigs.pending.find((p) => p.id === id && p.kind === 'review');
      if (!rec || !tradable(CompanyRepository.get(rec.companyId), MarketStore.getPublic())) return { ok: false, status: 'unknown' };

      const fixed = sanitizeGigEdits({ percent: edits.percent ?? rec.percent, delayDays: edits.delayDays ?? rec.delayDays });
      if (fixed.percent == null || fixed.delayDays == null) return { ok: false, status: 'invalid' };
      const final = {
        ...rec,
        percent: fixed.percent,
        amount: Math.round(percentToAmount(fixed.percent) * 10_000) / 10_000,
        delayDays: fixed.delayDays,
        headline: edits.headline == null ? rec.headline : String(edits.headline).trim().slice(0, 200),
      };
      return this._applyAndFinish(removePending(gigs, id), final);
    });
  }

  /** Throw a queued item away: nothing happens to the market. */
  discard(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._enqueue(async () => {
      const gigs = MarketStore.getGigs();
      const rec = gigs.pending.find((p) => p.id === id);
      if (!rec) return { ok: false, status: 'unknown' };
      return this._finish(addHistory(removePending(gigs, id), historyEntry(rec, 'discarded')), 'discarded', rec);
    });
  }

  /**
   * Say which company a client is, or that it should be ignored.
   * @param {string} id - a "needs mapping" item
   * @param {string} target - a company id, or 'ignore'
   * @param {{remember?: boolean}} [opts] - save the choice for every later gig from this client (default), and settle the other waiting items from it
   */
  mapClient(id, target, { remember = true } = {}) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._enqueue(async () => {
      let gigs = MarketStore.getGigs();
      const rec = gigs.pending.find((p) => p.id === id && p.kind === 'mapping');
      if (!rec || !this._validTarget(target)) return { ok: false, status: 'unknown' };
      let batch = [rec];
      if (remember && rec.clientKey) {
        gigs = setMapping(gigs, rec.clientKey, target, rec.client);
        batch = gigs.pending.filter((p) => p.kind === 'mapping' && p.clientKey === rec.clientKey);
      }
      return this._settle(gigs, batch, target);
    });
  }

  /** Save a client mapping ahead of time, and settle anything already waiting on it. */
  addMapping(client, target) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    const clientKey = normalizeName(client);
    if (!clientKey || !this._validTarget(target)) return Promise.resolve({ ok: false, status: 'invalid' });
    return this._enqueue(async () => {
      const gigs = setMapping(MarketStore.getGigs(), clientKey, target, String(client).trim());
      return this._settle(gigs, gigs.pending.filter((p) => p.kind === 'mapping' && p.clientKey === clientKey), target);
    });
  }

  removeMapping(clientKey) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._enqueue(async () => {
      await this._commit(removeMapping(MarketStore.getGigs(), clientKey));
      return { ok: true, status: 'removed' };
    });
  }

  clearHistory() {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._enqueue(async () => {
      await this._commit({ ...MarketStore.getGigs(), history: [] });
      return { ok: true, status: 'cleared' };
    });
  }

  _validTarget(target) {
    return target === 'ignore' || !!CompanyRepository.get(target);
  }

  /** Move waiting "needs mapping" items on, now that their client is known. */
  async _settle(startGigs, batch, target) {
    let gigs = startGigs;
    const pub = MarketStore.getPublic();
    const company = target === 'ignore' ? null : CompanyRepository.get(target);
    let applied = 0;
    let queued = 0;
    for (const rec of batch) {
      gigs = removePending(gigs, rec.id);
      if (!company) {
        gigs = addHistory(gigs, historyEntry(rec, 'ignored', { reason: 'mapping' }));
      } else if (!tradable(company, pub)) {
        gigs = addHistory(gigs, historyEntry({ ...rec, companyId: company.id }, 'ignored', { reason: 'not-tradable' }));
      } else {
        const planned = this._planned({ ...rec, companyId: company.id, how: 'mapping' }, gigs, company);
        if (this.approvalRequired()) {
          gigs = addPending(gigs, { ...planned, kind: 'review', reason: 'approval', candidates: [] });
          queued += 1;
        } else {
          await this._queueImpact(planned);
          gigs = addHistory(gigs, historyEntry(planned, 'applied'));
          applied += 1;
          Hooks.callAll(HOOKS.GIG_IMPACT, { status: 'applied', record: planned });
          await this._afterApply(planned);
        }
      }
    }
    await this._commit(gigs);
    return { ok: true, status: 'mapped', applied, queued };
  }
}

export const GigImpactService = new GigImpactServiceImpl();
