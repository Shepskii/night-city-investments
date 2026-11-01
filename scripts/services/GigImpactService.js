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
  GIG_OUTCOMES, resolveClient, matchBusiness, parseReward, planGigImpact, gigHeadlineKey, recentGigAbs, isKnownGig,
  addPending, removePending, addHistory, setMapping, removeMapping, sanitizeGigEdits, normalizeName,
  makeImpact, percentToAmount, logEntry, timeOf,
  matchFaction, findTarget, targetShare, gigTags,
} from '../engine/index.js';
import { MODULE_ID, SETTINGS, HOOKS } from '../utils/constants.js';
import { log, isActiveGM, L, isCharacter } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { FactionRepository } from '../data/FactionRepository.js';
import { BusinessService } from './BusinessService.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { MarketClock } from './MarketClockService.js';
import { TickService } from './TickService.js';
import { NewsService } from './NewsService.js';
import { NotificationService } from './NotificationService.js';
import { HeatService } from './HeatService.js';
import { MailService } from './MailService.js';
import { SerialQueue } from '../utils/queue.js';

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
  businessId: rec.businessId ?? null,
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
    this._queue = new SerialQueue('Gig impact task', { ok: false, status: 'failed' });
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
   * @param {{gigId?: string, sourceKey?: string, outcome: 'done'|'failed', client?: string, reward?: number|string, title?: string, notes?: string, desc?: string, runners?: string[]}} payload
   *        `runners` are the ids of the characters who ran the gig; their trades count as the best informed
   * @returns {Promise<{ok: boolean, status: 'applied'|'pending'|'unmatched'|'ignored'|'duplicate'|'disabled'|'invalid'|'not-gm'|'failed', id?: string, companyId?: string, percent?: number, delayDays?: number}>}
   */
  report(payload) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    const outcome = payload?.outcome;
    const sourceKey = String(payload?.sourceKey ?? (payload?.gigId ? `gig:${payload.gigId}:${outcome}` : ''));
    if (!GIG_OUTCOMES.includes(outcome) || !sourceKey) return Promise.resolve({ ok: false, status: 'invalid' });
    if (!this.enabled()) return Promise.resolve({ ok: true, status: 'disabled' });
    return this._queue.run(() => this._report({ ...payload, outcome, sourceKey }));
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
    // The GM's tags: a client tag stands in for the gig's client field.
    const tags = gigTags(p.notes);
    const clientName = tags.client || p.client;
    const base = {
      id: newId(),
      sourceKey: p.sourceKey,
      gigId: p.gigId ?? null,
      title: String(p.title ?? '').slice(0, 120),
      client: String(clientName ?? '').slice(0, 120),
      outcome: p.outcome,
      reward: parseReward(p.reward),
      tick: timeOf(pub),
      date: MarketClock.dateString(),
      runners: this._runners(p.runners),
    };
    const factions = FactionRepository.list();
    // Who it was aimed at, if anyone: the GM's tag, or the one faction its text names (F1a).
    const aimed = findTarget(p, factions, CompanyRepository.all({ includeUnlisted: true }));
    if (aimed) base.target = aimed;
    // A gig for a player's business, by the GM's tag or because the business is its client (F1a).
    const own = matchBusiness({ client: p.client, notes: p.notes }, BusinessRepository.all());
    // A contract tag naming no open business: most likely a typo, so the gig waits for the GM to see it.
    if (tags.contract && !own) base.contractUnknown = tags.contract;
    if (own) {
      // A tagged business is a contractor: its standing with the client moves, and the client's price.
      // A business that is itself the client has nobody else to stand with.
      const contractor = own.how === 'tag';
      const faction = contractor ? matchFaction(clientName, factions) : null;
      const res = contractor
        ? resolveClient({ client: clientName, notes: '', text: [p.title, p.desc].filter(Boolean).join(' ') }, CompanyRepository.all({ includeUnlisted: true }), gigs.mappings)
        : null;
      const clientCompany = res?.status === 'matched' ? CompanyRepository.get(res.companyId) : null;
      return this._businessGig(gigs, {
        ...base, businessId: own.businessId, how: own.how,
        ...(faction ? { factionId: faction.id, factionName: faction.name } : {}),
        clientCompanyId: clientCompany && tradable(clientCompany, pub) ? clientCompany.id : null,
        clientNeedsReview: !!res?.needsReview,
      });
    }

    const res = resolveClient(
      // The GM's tags are not the gig's text: a name in one is not a mention.
      { client: p.client, notes: p.notes, text: [p.title, p.desc, String(p.notes ?? '').replace(/\[[^\]]*\]/g, ' ')].filter(Boolean).join(' ') },
      CompanyRepository.all({ includeUnlisted: true }),
      gigs.mappings,
    );

    if (res.status === 'ignored') return this._finish(addHistory(gigs, historyEntry(base, 'ignored', { reason: res.how })), 'ignored', base);

    // A client with no shares (a gang): nothing to map or move for it, only its target's price, if it has one.
    const sure = res.status === 'matched' && !res.needsReview;
    const clientFaction = sure ? null : matchFaction(clientName, factions);
    if (clientFaction && !clientFaction.ticker) {
      const [hit] = this._targetExtra(base, gigs);
      if (!hit) return this._finish(addHistory(gigs, historyEntry(base, 'ignored', { reason: 'no-shares' })), 'ignored', base);
      const rec = { ...base, ...hit, how: 'tag' };
      if (this.approvalRequired() || base.target.how === 'text') {
        const queued = { ...rec, kind: 'review', reason: 'approval', target: null };
        await this._commit(addPending(gigs, queued));
        this._notice('Review', queued);
        Hooks.callAll(HOOKS.GIG_IMPACT, { status: 'pending', record: queued });
        return { ok: true, status: 'pending', id: queued.id, companyId: rec.companyId, percent: rec.percent, delayDays: rec.delayDays };
      }
      return this._applyAndFinish(gigs, rec);
    }

    if (res.status === 'matched') {
      const company = CompanyRepository.get(res.companyId);
      if (!tradable(company, pub)) return this._finish(addHistory(gigs, historyEntry({ ...base, companyId: res.companyId, how: res.how }, 'ignored', { reason: 'not-tradable' })), 'ignored', base);
      const rec = this._planned({ ...base, companyId: company.id, how: res.how }, gigs, company);
      if (this.approvalRequired() || res.needsReview || rec.target?.how === 'text' || rec.contractUnknown) {
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

  /** Queue a player business's gig for the GM, or apply it when approval is off. */
  async _businessGig(gigs, rec) {
    const planned = { ...rec, ...(BusinessService.planGig(rec) ?? {}), extras: this._businessExtras(rec, gigs) };
    // A near-miss on the client, or a target only found in the text, waits for the GM whatever the setting.
    if (this.approvalRequired() || rec.clientNeedsReview || rec.target?.how === 'text') {
      const queued = { ...planned, kind: 'business', reason: 'approval' };
      await this._commit(addPending(gigs, queued));
      this._notice('Business', queued);
      Hooks.callAll(HOOKS.GIG_IMPACT, { status: 'pending', record: queued });
      return { ok: true, status: 'pending', id: queued.id, businessId: rec.businessId };
    }
    return this._applyBusinessGig(gigs, planned);
  }

  async _applyBusinessGig(startGigs, rec) {
    const final = this._confirmed(rec);
    const out = await BusinessService.applyGig(final);
    const status = out.ok ? 'applied' : 'ignored';
    const gigs = out.ok ? await this._applyExtras(startGigs, final) : startGigs;
    await this._commit(addHistory(gigs, historyEntry({ ...rec, ...(out.plan ?? {}) }, status, out.ok ? { reputation: out.plan.reputation, takings: out.plan.takings } : { reason: out.reason })));
    Hooks.callAll(HOOKS.GIG_IMPACT, { status, record: rec });
    return { ok: true, status, businessId: rec.businessId };
  }

  /** Approve a queued gig for a player's business. */
  approveBusiness(id, { useTarget = false } = {}) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._queue.run(async () => {
      const gigs = MarketStore.getGigs();
      const rec = gigs.pending.find((p) => p.id === id && p.kind === 'business');
      if (!rec) return { ok: false, status: 'unknown' };
      return this._applyBusinessGig(removePending(gigs, id), { ...rec, targetConfirmed: useTarget });
    });
  }

  /** The characters among a report's runners. Anything else (an unknown id, an NPC) is dropped. */
  _runners(ids) {
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids.map(String))].filter((id) => isCharacter(game.actors.get(id))).slice(0, 10);
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
    return { ...rec, ...plan, headline, extras: [...(rec.extras ?? []), ...this._targetExtra(rec, gigs, company.id)] };
  }

  /**
   * A gig's move on one other company's price: `share` of what the gig would do to it. Each is its own
   * market impact with its own headline, sized and limited as any gig is.
   */
  _extraImpact(rec, gigs, company, share, role) {
    const plan = planGigImpact({
      outcome: rec.outcome, reward: rec.reward, scale: this.scale(), recentAbs: recentGigAbs(gigs, company.id, rec.tick), key: `${rec.sourceKey}:${role}`,
    });
    const amount = Math.round(plan.amount * share * 10_000) / 10_000;
    const percent = Math.round((Math.exp(amount) - 1) * 1000) / 10;
    const outcome = amount < 0 ? 'failed' : 'done';
    return {
      ...plan, role, amount, percent, companyId: company.id, name: company.name, sourceKey: `${rec.sourceKey}:${role}`, outcome,
      headline: L(gigHeadlineKey({ outcome, percent, key: `${rec.sourceKey}:${role}` }), { name: company.name, ticker: company.ticker }),
    };
  }

  /** The target's price, moving the other way from the client's. Nothing if it has no shares, or is a party already. */
  _targetExtra(rec, gigs, ...partyIds) {
    if (!rec.target?.ticker || partyIds.includes(rec.target.ticker)) return [];
    const company = CompanyRepository.get(rec.target.ticker);
    return tradable(company, MarketStore.getPublic()) ? [this._extraImpact(rec, gigs, company, targetShare(rec.outcome), 'target')] : [];
  }

  /** Every price a business's gig moves: the client's, the business's own if it is listed, and the target's. */
  _businessExtras(rec, gigs) {
    const pub = MarketStore.getPublic();
    const out = [];
    const client = rec.clientCompanyId ? CompanyRepository.get(rec.clientCompanyId) : null;
    if (client) out.push(this._extraImpact(rec, gigs, client, 1, 'client'));
    const ticker = BusinessRepository.get(rec.businessId)?.company?.ticker;
    const own = ticker && ticker !== client?.id ? CompanyRepository.get(ticker) : null;
    if (tradable(own, pub)) out.push(this._extraImpact(rec, gigs, own, 1, 'contractor'));
    return [...out, ...this._targetExtra(rec, gigs, ...out.map((e) => e.companyId))];
  }

  /** A target found only in a gig's text counts once the GM has confirmed it; a tagged one always does. */
  _confirmed(rec) {
    if (rec.target?.how !== 'text' || rec.targetConfirmed) return rec;
    return { ...rec, target: null, extras: (rec.extras ?? []).filter((e) => e.role !== 'target') };
  }

  /** Queue a gig's other impacts, each in the history, with its own heat window. Returns the new gigs record. */
  async _applyExtras(startGigs, rec) {
    let gigs = startGigs;
    for (const e of rec.extras ?? []) {
      const one = { ...rec, ...e, businessId: null };
      await this._queueImpact(one);
      gigs = addHistory(gigs, historyEntry(one, 'applied'));
      const holders = e.role === 'contractor' ? (BusinessRepository.get(rec.businessId)?.partners ?? []).filter((p) => !p.market && !p.npc).map((p) => p.actorId) : [];
      const tipped = e.role === 'client' ? await this._tip(one) : [];
      try {
        await HeatService.openWindow(one, { tipped: [...tipped, ...holders], runners: rec.runners ?? [] });
      } catch (error) {
        log.error('Opening a heat window failed', error);
      }
    }
    return gigs;
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
    const name = company?.name ?? (rec.businessId ? BusinessRepository.get(rec.businessId)?.name : '') ?? '';
    const text = L(`NCI.Gig.Notice.${kind}`, { client: rec.client || rec.title || '?', name, outcome: L(`NCI.Gig.Outcome.${rec.outcome}`).toLowerCase() });
    if (kind === 'Mapping') ui.notifications.warn(text);
    else ui.notifications.info(text);
  }

  // ── Applying ───────────────────────────────────────────────────────────────

  /** Queue the impact on the market, record it, and tell the players who asked to hear rumours. */
  async _applyAndFinish(startGigs, plain) {
    const rec = this._confirmed(plain);
    await this._queueImpact(rec);
    const gigs = await this._applyExtras(startGigs, rec);
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
    return this._queue.run(async () => {
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

  /** After an impact is queued: send any rumours, then open a heat watch window recording who was tipped off and who ran it. */
  async _afterApply(rec) {
    const tipped = await this._tip(rec);
    try {
      await HeatService.openWindow(rec, { tipped, runners: rec.runners ?? [] });
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
      for (const actor of game.actors.filter((a) => isCharacter(a) && PortfolioRepository.hasPortfolio(a))) {
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
    return this._queue.run(async () => {
      const gigs = MarketStore.getGigs();
      const rec = gigs.pending.find((p) => p.id === id && p.kind === 'review');
      if (!rec || !tradable(CompanyRepository.get(rec.companyId), MarketStore.getPublic())) return { ok: false, status: 'unknown' };

      const fixed = sanitizeGigEdits({ percent: edits.percent ?? rec.percent, delayDays: edits.delayDays ?? rec.delayDays });
      if (fixed.percent == null || fixed.delayDays == null) return { ok: false, status: 'invalid' };
      const final = {
        ...rec,
        targetConfirmed: !!edits.useTarget,
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
    return this._queue.run(async () => {
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
    return this._queue.run(async () => {
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
    return this._queue.run(async () => {
      const gigs = setMapping(MarketStore.getGigs(), clientKey, target, String(client).trim());
      return this._settle(gigs, gigs.pending.filter((p) => p.kind === 'mapping' && p.clientKey === clientKey), target);
    });
  }

  removeMapping(clientKey) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._queue.run(async () => {
      await this._commit(removeMapping(MarketStore.getGigs(), clientKey));
      return { ok: true, status: 'removed' };
    });
  }

  clearHistory() {
    if (!isActiveGM()) return Promise.resolve({ ok: false, status: 'not-gm' });
    return this._queue.run(async () => {
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
          const final = this._confirmed(planned);
          await this._queueImpact(final);
          gigs = await this._applyExtras(gigs, final);
          gigs = addHistory(gigs, historyEntry(final, 'applied'));
          applied += 1;
          Hooks.callAll(HOOKS.GIG_IMPACT, { status: 'applied', record: final });
          await this._afterApply(final);
        }
      }
    }
    await this._commit(gigs);
    return { ok: true, status: 'mapped', applied, queued };
  }
}

export const GigImpactService = new GigImpactServiceImpl();
