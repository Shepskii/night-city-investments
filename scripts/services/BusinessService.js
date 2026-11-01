/**
 * Business service: the GM-side executor for player businesses.
 * @file scripts/services/BusinessService.js
 * @description Runs only on the active GM client. It reads each character's business outbox, reads
 *              the dice of any roll back from its chat card, applies the request with the pure engine,
 *              moves the eddies, and saves the record. After each market tick it brings every open
 *              business up to the market's date, closing the weeks that have ended. Everything goes
 *              through one serial queue.
 *
 *              A syndicate can be a partner (DESIGN §30, B3b). An officer's request that names a
 *              `syndicateId` is made for the syndicate: the engine sees the syndicate as the partner,
 *              the roll is the officer's own, the money comes from and goes to the syndicate's
 *              account (SyndicateCash), and it brings no gear. A payment over the officers' trade limit
 *              is refused; the members vote on it instead, and it is then made with `applyFor`.
 */

import {
  applyBusinessRequest, advanceBusiness, approveBusiness, rejectBusiness, markLeaving, rollSpec, dayIndex, ROLL_REQUESTS, PROCESSED_CAP,
  applyBusinessGig, planBusinessGig, itemGear, isOfficer, limitLeft, approveBusinessCharter, rejectBusinessCharter, diligenceView,
  STAFF_USES, useKey, refreshStaffBases, answerJob, normalizeBusiness, traitOf, proposalOutcome, asksFor, EVENTS, markElsewhere, BUSINESS_DEFAULTS, refreshTeams, approveBusinessListing, rejectBusinessListing,
  isListed, listingCompany, scheduleListing, completeListing, syncListedHolders, heldQty, timeOf, earningsTarget, earningsAmount, makeImpact, payListedDividend,
  reviewListing, clearReview, delistCompany,
  buybackDay, settleOffering, dailySellCap, ipoDemand, allocationRatio, settleIpoOrders, normalizePortfolio,
  takeoverReference, openTakeover, dropTakeover, settleTakeover, takeoverPremium, sellableQty, consumeLotsFifo, committedCash,
  restructure, windUp, holdingValue, layerFees, layerFeesDue, dropLayers, pruneMasks, outerMask,
  concealedHolders, auditConcealment, unmask, createRng, holderByRef, investigationTarget, scandalHit, investigationCost, spendDays,
  caseOf, caseChance, regulatorTotal, openCase, caseAnswerCheck, caseBribe, payCaseBribe, winCase, loseCase, applyCaseLoss, dropCase, caseTrigger,
} from '../engine/index.js';
import { MODULE_ID, FLAGS, SETTINGS, HOOKS } from '../utils/constants.js';
import { L, log, isActiveGM, isCharacter, isItemPile, unwrap } from '../utils/helpers.js';
import { SerialQueue } from '../utils/queue.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { MarketClock } from './MarketClockService.js';
import { SkillAdapter } from './SkillAdapter.js';
import { WealthAdapter } from './WealthAdapter.js';
import { receiptsOf, pendingBusinessRequests, operatorRankOf, investorActors, staffActors, jobsOf } from './BusinessClient.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { SyndicateCash } from './SyndicateCash.js';
import { MailService } from './MailService.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { PortfolioService } from './PortfolioService.js';
import { TickService } from './TickService.js';
import { NewsService } from './NewsService.js';
import { HeatService } from './HeatService.js';
import { BrokerRepository } from '../data/BrokerRepository.js';

const RESULTS_CAP = 40;
/** Requests that may bring gear: the items are looked up here, never taken from the request. */
const GEAR_REQUESTS = ['found', 'join', 'contribute'];
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

  /**
   * The day business weeks close on, as a test the engine applies day by day: the setting is a weekday
   * on the world's calendar, and Simple Calendar's weeks need not run on unbroken across a year.
   */
  weekday() {
    const d = Math.floor(Number(game.settings.get(MODULE_ID, SETTINGS.BUSINESS_WEEKDAY)));
    const target = d >= 0 && d <= 6 ? d : 1;
    return (day) => MarketClock.weekdayOf(day) === target;
  }

  /** The world seed: weekly events are drawn from it, the business and the week. */
  seed() {
    return game.settings.get(MODULE_ID, SETTINGS.WORLD_SEED) || 'nci';
  }

  growthRate() {
    const g = Number(game.settings.get(MODULE_ID, SETTINGS.BUSINESS_GROWTH_RATE));
    return Number.isFinite(g) && g > 0 ? g : 1;
  }

  /** Every character a request may name, by id. */
  actors() {
    return Object.fromEntries([
      ...game.actors.filter((a) => isCharacter(a)).map((a) => [a.id, a.name]),
      // A syndicate can be invited as a partner or an investor too (DESIGN §30, B3b).
      ...SyndicateRepository.all().filter((s) => s.status === 'active').map((s) => [s.id, s.name]),
    ]);
  }

  /** A business's hidden traits (applicant or employee id to trait), kept from the players (E2). */
  traitsOf(businessId) {
    return businessId ? MarketStore.getBusinessesHidden()[businessId]?.traits ?? {} : {};
  }

  context(business) {
    const hidden = MarketStore.getBusinessesHidden();
    return {
      approval: game.settings.get(MODULE_ID, SETTINGS.BUSINESS_APPROVAL) !== false,
      weekday: this.weekday(),
      growthRate: this.growthRate(),
      seed: this.seed(),
      operatorRank: business ? operatorRankOf(business) : 0,
      actors: this.actors(),
      investors: investorActors().map((a) => a.id),
      // Who may be hired, and their bases read from their sheets (DESIGN §32).
      staffActors: Object.fromEntries(staffActors().map((a) => [a.id, a.source])),
      staffNames: Object.fromEntries(staffActors().map((a) => [a.id, a.name])),
      basesOf: (id) => this.basesOf(id),
      // The listing threshold (B5a), a world setting.
      listingThreshold: this.listingThreshold(),
      // A listed company's price now, for its offering roll (B6a).
      marketPrice: business?.company?.ticker ? (MarketStore.getPublic().companies?.[business.company.ticker]?.price ?? 0) : 0,
      // NPC actors an Exec may bring as a team member (E3): not a player's character.
      teamActors: Object.fromEntries(game.actors.filter((a) => ['character', 'mook'].includes(a.type) && !isItemPile(a) && !a.hasPlayerOwner).map((a) => [a.id, a.name])),
      newId: `bus_${foundry.utils.randomID(12)}`,
      tickers: this.tickersTaken(business?.id),
      // Kept out of players' windows: an internal audit reads it, and due diligence sees the other businesses (B4c).
      exposure: business ? (hidden[business.id]?.exposure ?? 0) : 0,
      // A target with loose lips on its staff tells due diligence more (E2).
      targets: Object.fromEntries(BusinessRepository.all().filter((t) => t.status === 'open' && t.id !== business?.id).map((t) => [t.id, {
        ...diligenceView(t),
        leaky: (t.staff ?? []).some((s) => s.status === 'active' && traitOf(hidden[t.id]?.traits, s) === 'looseLips'),
      }])),
      traits: business ? hidden[business.id]?.traits ?? {} : {},
    };
  }

  /** The valuation a company must reach to list (B5a): the world setting, or the default. */
  listingThreshold() {
    const v = Number(game.settings.get(MODULE_ID, SETTINGS.LISTING_THRESHOLD));
    return v > 0 ? v : BUSINESS_DEFAULTS.listing.threshold;
  }

  /** Whether a business's hidden Exposure is over the listing cap: shown to players only as "unresolved concerns" (B5a). Returns whether it changed. */
  _markConcerns(business) {
    const over = (MarketStore.getBusinessesHidden()[business.id]?.exposure ?? 0) >= BUSINESS_DEFAULTS.listing.exposureCap;
    if (!!business.listingConcerns === over) return false;
    business.listingConcerns = over;
    return true;
  }

  /**
   * A listed company's monthly report reaches the market (B5c): the stock's fair value moves toward its
   * valuation per share over a few days (the market's impact kernel, wholly permanent), and the news
   * carries the report.
   */
  async _afterReports(out) {
    const b = out.business;
    if (!isListed(b)) return;
    const ticker = b.company?.ticker;
    for (const e of out.events.filter((x) => x.type === 'reportPublished')) {
      const report = e.report;
      const price = MarketStore.getPublic().companies?.[ticker]?.price ?? 0;
      const target = earningsTarget(b, report);
      const amount = earningsAmount(target, price);
      const key = `report:${b.id}:${report.index}`;
      if (amount) {
        await TickService.updateControls((controls, { tick }) => (controls.impacts.some((i) => i.sourceKey === key) ? controls : {
          ...controls,
          impacts: [...controls.impacts, makeImpact({
            id: `imp_${b.id}_${report.index}`, target: { type: 'company', id: ticker }, amount, onsetTick: tick + BUSINESS_DEFAULTS.listing.earningsDelayDays,
            permanent: 1, sourceKey: key, source: 'report', meta: { businessId: b.id, report: report.index, target: Math.round(target * 100) / 100 },
          })],
        }));
        await this._insiderWindow(b, key, amount);
      }
      await this._payDividend(b.id, report);
      await NewsService.post({
        headline: L('NCI.News.PlayerReport', { name: b.name, ticker, profit: Math.round(report.reported).toLocaleString(), value: Math.round(report.valuation).toLocaleString() }),
        tone: report.reported > 0 ? 'up' : 'down',
        companyIds: [ticker],
      });
      await this._review(b.id, report);
    }
  }

  /**
   * The delisting review (B5c): a listed company worth too little on the market for reports in a row
   * goes under review, for the GM to delist or give time. The market hears of it and the price dips;
   * every shareholder is told.
   */
  async _review(businessId, report) {
    const stored = BusinessRepository.get(businessId);
    if (!stored || !isListed(stored) || stored.listing.reviewedReport === report.index) return;
    const b = normalizeBusiness(structuredClone(stored));
    const ticker = b.company?.ticker;
    const price = MarketStore.getPublic().companies?.[ticker]?.price ?? 0;
    const marketCap = price * (b.listing.shares ?? 0);
    const threshold = this.listingThreshold();
    const done = reviewListing(b, { marketCap, threshold, day: this.day() });
    b.listing.reviewedReport = report.index;
    await BusinessRepository.save(b);
    if (!done.opened) return;
    const key = `review:${b.id}:${report.index}`;
    await TickService.updateControls((controls, { tick }) => (controls.impacts.some((i) => i.sourceKey === key) ? controls : {
      ...controls,
      impacts: [...controls.impacts, makeImpact({
        id: `imp_review_${b.id}_${report.index}`, target: { type: 'company', id: ticker }, amount: BUSINESS_DEFAULTS.listing.review.hit, onsetTick: tick,
        permanent: 1, sourceKey: key, source: 'review', meta: { businessId: b.id },
      })],
    }));
    const value = Math.round(marketCap).toLocaleString();
    await NewsService.post({ headline: L('NCI.News.ListingReview', { name: b.name, ticker }), tone: 'down', companyIds: [ticker] });
    await this._mailHolders(b, L('NCI.Listing.Mail.ReviewSubject', { name: b.name }), [L('NCI.Listing.Mail.Review', { name: b.name, ticker, value, floor: Math.round(threshold * BUSINESS_DEFAULTS.listing.review.below).toLocaleString(), n: BUSINESS_DEFAULTS.listing.review.reports })]);
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
  }

  /** A mail to each of a company's shareholders: characters directly, a syndicate's active members each. */
  async _mailHolders(b, subject, lines) {
    const ids = new Set();
    for (const p of b.partners.filter((x) => !x.npc && x.status === 'active' && x.units > 0)) {
      if (game.actors.get(p.actorId)) ids.add(p.actorId);
      else for (const m of SyndicateRepository.get(p.actorId)?.members ?? []) if (m.status === 'active') ids.add(m.actorId);
    }
    for (const id of ids) {
      const actor = game.actors.get(id);
      if (!actor) continue;
      try {
        await MailService.fromWire(actor, { subject, lines });
      } catch (error) {
        log.warn('Shareholder mail failed', error);
      }
    }
  }

  /**
   * A listed company's offering or buyback has moved on (B6a): an offering set by its roll goes on the
   * market company's record, where the terminal shows it for subscription; a pulled offering dents the
   * price. Each makes the news.
   */
  async _capitalEvents(out) {
    const b = out.business;
    const ticker = b?.company?.ticker;
    if (!ticker || !isListed(b)) return;
    for (const e of out.events) {
      if (e.type === 'offeringSet' && b.capital?.issue?.status === 'open') {
        const issue = b.capital.issue;
        const company = CompanyRepository.get(ticker);
        if (company) await CompanyRepository.save({ ...company, offering: { price: issue.price, shares: issue.shares, endDay: issue.endDay } });
        await NewsService.post({ headline: L('NCI.News.Offering', { name: b.name, ticker, shares: issue.shares.toLocaleString(), price: issue.price.toLocaleString() }), tone: 'neutral', companyIds: [ticker] });
      } else if (e.type === 'offeringFailed') {
        const key = `offering:${b.id}:${this.day()}`;
        await TickService.updateControls((controls, { tick }) => (controls.impacts.some((i) => i.sourceKey === key) ? controls : {
          ...controls,
          impacts: [...controls.impacts, makeImpact({
            id: `imp_offer_${b.id}_${this.day()}`, target: { type: 'company', id: ticker }, amount: BUSINESS_DEFAULTS.capital.offering.failHit, onsetTick: tick,
            permanent: 1, sourceKey: key, source: 'offering', meta: { businessId: b.id },
          })],
        }));
        await NewsService.post({ headline: L('NCI.News.OfferingPulled', { name: b.name, ticker }), tone: 'down', companyIds: [ticker] });
      } else if (e.type === 'buybackTimed') {
        await NewsService.post({ headline: L('NCI.News.Buyback', { name: b.name, ticker, budget: Math.round(b.capital?.buyback?.budget ?? 0).toLocaleString() }), tone: 'up', companyIds: [ticker] });
      }
    }
  }

  /**
   * Each market day for listed companies (B6a): an offering whose window has closed is settled (the
   * subscribers' shares filled, pro rata if oversubscribed, the market taking the rest, the money to
   * the company, the price diluted), and a buyback buys its day's shares from the float.
   */
  async _marketCapital() {
    const day = this.day();
    const pub = MarketStore.getPublic();
    for (const stored of BusinessRepository.all().filter((x) => x.status === 'open' && isListed(x))) {
      const issue = stored.capital?.issue;
      const bb = stored.capital?.buyback;
      const due = issue?.status === 'open' && day > issue.endDay;
      const buying = bb?.status === 'buying' && bb.lastDay !== day;
      if (!due && !buying) continue;
      const b = normalizeBusiness(structuredClone(stored));
      const ticker = b.company.ticker;
      const price = pub.companies?.[ticker]?.price ?? 0;
      let changed = false;
      if (due) {
        const tick = timeOf(pub);
        const portfolios = PortfolioRepository.accounts().filter((a) => PortfolioRepository.hasPortfolio(a)).map((a) => normalizePortfolio(PortfolioRepository.get(a)));
        const ratio = allocationRatio(ipoDemand(portfolios, ticker), issue.shares);
        await PortfolioService.transformAll((p) => {
          const out = settleIpoOrders(p, ticker, issue.price, ratio, tick);
          return out.changed ? out : null;
        });
        const before = b.listing.shares ?? 0;
        const done = settleOffering(b, day);
        if (done.ok && price > 0 && before > 0) {
          // The company is worth what it was plus the money raised, over more shares.
          const amount = Math.log(((price * before + done.proceeds) / (before + done.shares)) / price);
          const key = `offering:${b.id}:settled:${day}`;
          await TickService.updateControls((controls, { tick: now }) => (controls.impacts.some((i) => i.sourceKey === key) ? controls : {
            ...controls,
            impacts: [...controls.impacts, makeImpact({
              id: `imp_offerdone_${b.id}_${day}`, target: { type: 'company', id: ticker }, amount, onsetTick: now, permanent: 1, sourceKey: key, source: 'offering', meta: { businessId: b.id },
            })],
          }));
        }
        await NewsService.post({ headline: L('NCI.News.OfferingDone', { name: b.name, ticker, shares: done.shares.toLocaleString(), proceeds: Math.round(done.proceeds).toLocaleString() }), tone: 'neutral', companyIds: [ticker] });
        changed = true;
      }
      if (buying) {
        const d = buybackDay(b, { price, cap: dailySellCap(b, PortfolioService._fixerOperator(b)), day });
        if (d.qty > 0 && d.done) await NewsService.post({ headline: L('NCI.News.BuybackDone', { name: b.name, ticker }), tone: 'neutral', companyIds: [ticker] });
        changed = true;
      }
      if (!changed) continue;
      const company = CompanyRepository.get(ticker);
      if (company) await CompanyRepository.save({ ...company, sharesOutstanding: b.listing.shares, ...(due ? { offering: null } : {}) });
      this._syncHolders(b);
      await BusinessRepository.save(b);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
    }
  }

  /**
   * Officers and shareholders see a report before the market does (B5c): with insider tracking on, a
   * watch window runs from the report to the price moving, as for a gig. Officers know it as well as a
   * gig's runners; other shareholders as if tipped. A syndicate's members count as their syndicate.
   */
  async _insiderWindow(b, sourceKey, amount) {
    const officers = new Set(b.officers ?? []);
    const holders = b.partners.filter((p) => !p.market && p.status === 'active' && p.units > 0).map((p) => p.actorId);
    await HeatService.openWindow(
      { sourceKey, companyId: b.company.ticker, outcome: amount < 0 ? 'failed' : 'success', date: MarketClock.dateString(), delayDays: BUSINESS_DEFAULTS.listing.earningsDelayDays },
      { runners: [...officers], tipped: holders.filter((id) => !officers.has(id)) },
    );
  }

  /**
   * A listed company's shareholders are whoever holds its shares (B5b): read from every brokerage
   * portfolio (characters and syndicates) before each change. Returns whether anything changed.
   */
  _syncHolders(business) {
    if (!isListed(business)) return false;
    const { holdings, names } = this._holdingsOf(business.company?.ticker);
    return syncListedHolders(business, holdings, names);
  }

  /** Who holds a ticker in their brokerage portfolio (characters and syndicates), and how many shares. */
  _holdingsOf(companyId) {
    const holdings = {};
    const names = {};
    for (const account of PortfolioRepository.accounts().filter((a) => PortfolioRepository.hasPortfolio(a))) {
      const qty = heldQty(PortfolioRepository.get(account).lots ?? [], companyId);
      if (qty > 0) {
        holdings[account.id] = qty;
        names[account.id] = account.name;
      }
    }
    return { holdings, names };
  }

  /**
   * A listed company's dividend after a report (B5c): the cash pays it, and each holder's share goes into
   * their brokerage balance, as a market dividend does (counted in their dividends received).
   */
  async _payDividend(businessId, report) {
    const stored = BusinessRepository.get(businessId);
    // A company in administration pays no dividend (B6c).
    if (!stored || !isListed(stored) || stored.administration) return;
    const b = normalizeBusiness(structuredClone(stored));
    if ((b.reports ?? []).find((r) => r.index === report.index)?.dividend) return;
    const ticker = b.company?.ticker;
    const { holdings } = this._holdingsOf(ticker);
    const tick = timeOf(MarketStore.getPublic());
    const done = payListedDividend(b, report, holdings, this.day());
    if (done.paid <= 0) return;
    await BusinessRepository.save(b);
    for (const [id, amount] of Object.entries(done.payments)) {
      const account = game.actors.get(id) ?? SyndicateRepository.account(id);
      if (!account) continue;
      await PortfolioService.transformActor(account, (p) => ({
        portfolio: {
          ...p,
          cash: (p.cash ?? 0) + amount,
          ledger: [...(p.ledger ?? []), { ts: tick, kind: 'dividend', assetId: ticker, qty: holdings[id], amount, ref: `div:${businessId}:${report.index}` }],
          stats: { ...(p.stats ?? {}), dividends: (p.stats?.dividends ?? 0) + amount },
        },
        changed: true,
      }));
    }
  }

  /**
   * An offer ready to list (both prospectus rolls passed) becomes a market company under its ticker,
   * unlisted, with its IPO window open (B5b, §27.4a step 5): players subscribe on the terminal, and on
   * the listing day the market's IPO service lists it. Nothing happens if the company exists already.
   */
  async _scheduleListing(business) {
    if (business?.listing?.status !== 'ready') return;
    const day = this.day();
    const input = listingCompany(business, day);
    const existing = CompanyRepository.get(input.id);
    if (existing && existing.businessId !== business.id) {
      log.warn(`Listing ${business.name}: the ticker ${input.id} is taken by another company`);
      return;
    }
    if (!existing) {
      const made = await CompanyRepository.save(input);
      if (!made.ok) {
        log.warn(`Listing ${business.name} failed`, made.errors);
        return;
      }
    }
    const b = normalizeBusiness(structuredClone(BusinessRepository.get(business.id) ?? business));
    if (scheduleListing(b, day).ok) await BusinessRepository.save(b);
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
  }

  /**
   * The market listed a company (its IPO filled): if it is a player company, finish the listing
   * (B5b): the float's proceeds into its cash, and each character's or syndicate's shares into their
   * brokerage portfolio, locked up; then the shareholders are read from the portfolios.
   */
  onIpo(companyId) {
    if (!isActiveGM()) return Promise.resolve();
    return this._queue.run(async () => {
      const company = CompanyRepository.get(companyId);
      if (!company?.businessId) return;
      const stored = BusinessRepository.get(company.businessId);
      if (!stored) return;
      const b = normalizeBusiness(structuredClone(stored));
      const tick = timeOf(MarketStore.getPublic());
      const done = completeListing(b, { day: this.day(), tick });
      if (!done.ok) return;
      const price = b.listing.offer.price;
      for (const h of done.holdings) {
        const account = game.actors.get(h.actorId) ?? SyndicateRepository.account(h.actorId);
        if (!account) continue;
        await PortfolioService.transformActor(account, (p) => ({
          portfolio: {
            ...p,
            lots: [...(p.lots ?? []), { id: `lot_list_${company.id}_${h.actorId}`, assetType: 'stock', assetId: company.id, qty: h.units, unitCost: price, acquiredTick: tick, drip: false, lockedUntil: done.lockedUntil }],
            ledger: [...(p.ledger ?? []), { ts: tick, kind: 'listing', assetId: company.id, qty: h.units, amount: 0, ref: b.id }],
          },
          changed: true,
        }));
      }
      this._syncHolders(b);
      await BusinessRepository.save(b);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
    });
  }

  /** A character's base in every skill and role ability a business roll names, from their sheet. */
  basesOf(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return null;
    return Object.fromEntries(STAFF_USES.map((use) => [useKey(use), SkillAdapter.baseFor(actor, use).base]));
  }

  /** Tickers a new charter cannot use: the market's companies', and every other business's charter or company. */
  tickersTaken(exceptId = null) {
    const fromBusinesses = BusinessRepository.all()
      .filter((b) => b.id !== exceptId)
      .map((b) => b.company?.ticker ?? (b.charter && b.charter.status !== 'failed' ? b.charter.ticker : null))
      .filter(Boolean);
    return [...CompanyRepository.all({ includeUnlisted: true }).map((c) => c.ticker), ...fromBusinesses];
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
      for (const actor of game.actors.filter((a) => isCharacter(a))) await this._process(actor);
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

  /**
   * The partner a request is made as: the character, or for an officer acting for a syndicate, the
   * syndicate, with its free cash as its wealth.
   */
  _partnerFor(actor, request) {
    if (!request.syndicateId) return { ok: true, partner: { id: actor.id, name: actor.name, wealth: WealthAdapter.get(actor) }, syndicate: null };
    const syndicate = SyndicateRepository.get(request.syndicateId);
    if (syndicate?.status !== 'active') return { ok: false, reason: 'no-syndicate' };
    if (!isOfficer(syndicate, actor.id)) return { ok: false, reason: 'not-officer' };
    if ((request.gear ?? []).length) return { ok: false, reason: 'syndicate-gear' };
    return { ok: true, partner: { id: syndicate.id, name: syndicate.name, wealth: SyndicateCash.available(syndicate.id) }, syndicate };
  }

  async _handle(actor, request) {
    if (!this.enabled()) return this._receipt(actor, request, { ok: false, reason: 'disabled' });
    // Looking behind a hidden holding (B6d) reads only the GM's hidden state and changes no business.
    if (request.type === 'investigate') return this._receipt(actor, request, await this._investigate(actor, request));
    // Answering a regulator's case (R1) rolls against a total only the GM's service holds.
    if (request.type === 'caseRoll') return this._receipt(actor, request, await this._answerCase(actor, request));
    const as = this._partnerFor(actor, request);
    if (!as.ok) return this._receipt(actor, request, as);
    // A takeover bid names its target by ticker, as the bidder knows it; they cannot read its record (B6b).
    if (request.type === 'bid' && !request.businessId) {
      const ticker = String(request.ticker ?? '').trim().toUpperCase();
      const target = BusinessRepository.all().find((t) => t.status === 'open' && t.stage === 2 && t.company?.ticker === ticker);
      if (!target) return this._receipt(actor, request, { ok: false, reason: 'no-target' });
      request = { ...request, businessId: target.id };
    }
    const stored = request.type === 'found' ? null : BusinessRepository.get(request.businessId);
    if (request.type !== 'found' && !stored) return this._receipt(actor, request, { ok: false, reason: 'no-business' });
    // Where else its NPC staff work, and their shifts there, before anything is checked (E3).
    const business = stored ? normalizeBusiness(structuredClone(stored)) : null;
    if (business) {
      markElsewhere(business, BusinessRepository.all());
      this._markConcerns(business);
      this._syncHolders(business);
      // An Exec's team follows the Exec: their rank now, and whether they are still a partner (E3).
      const team = refreshTeams(business, (id) => this.basesOf(id), this.day());
      if (team.notes.length) business.pendingNotes = [...(business.pendingNotes ?? []), ...team.notes];
    }
    // Due diligence names its target as a player knows it, by name; a player's client cannot list them (B4c).
    if (request.type === 'diligenceRoll' && !request.targetId) {
      const wanted = String(request.targetName ?? '').trim().toLowerCase();
      const target = BusinessRepository.all().find((t) => t.status === 'open' && t.id !== business?.id && t.name.trim().toLowerCase() === wanted);
      if (!target) return this._receipt(actor, request, { ok: false, reason: 'no-target' });
      request = { ...request, targetId: target.id };
    }

    const day = this.day();
    const context = this.context(business);
    if (request.type === 'hideRoll' && business) context.hide = this._hideTerms(business, as.partner.id, context.marketPrice);
    if (GEAR_REQUESTS.includes(request.type)) {
      const gear = await this.resolveGear(actor, request.gear);
      if (!gear.ok) return this._receipt(actor, request, gear);
      context.gear = gear.gear;
    }
    let check = null;
    if (business && ROLL_REQUESTS.includes(request.type) && request.use) {
      // The same checks the engine makes, first, so a request that would be refused does not use up its card.
      const spec = rollSpec(business, request, as.partner.id, { day, operatorRank: context.operatorRank });
      if (spec.ok) {
        check = await SkillAdapter.verifyLevers(actor, request, {
          dv: spec.dv, use: request.use.kind === 'hire' ? request.use : spec.use, bonusAvailable: spec.bonusAvailable, extraAvailable: spec.extraAvailable, allowHire: spec.allowHire,
        });
      }
    }

    const out = applyBusinessRequest({ business, request, actor: as.partner, day, check, context });
    // The engine is pure, so this is a dry run until it is committed: a syndicate's payment over what
    // this officer has left of the day's limit goes to its members instead.
    if (out.ok && as.syndicate && -(out.wealth?.[as.syndicate.id] ?? 0) > limitLeft(as.syndicate, actor.id, day)) {
      return this._receipt(actor, request, { ok: false, reason: 'over-limit' });
    }
    if (out.ok) await this._commit(out, { officerId: as.syndicate ? actor.id : null });
    return this._receipt(actor, request, out);
  }

  /**
   * Make a business request for a syndicate whose members have voted for it (no limit, no roll: only
   * the money requests in engine.BUSINESS_SPENDS).
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  applyFor(syndicateId, request) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      try {
        const syndicate = SyndicateRepository.get(syndicateId);
        if (syndicate?.status !== 'active') return { ok: false, reason: 'no-syndicate' };
        const business = request.type === 'found' ? null : BusinessRepository.get(request.businessId);
        if (request.type !== 'found' && !business) return { ok: false, reason: 'no-business' };
        const out = applyBusinessRequest({
          business,
          request: { ...request, gear: [] },
          actor: { id: syndicate.id, name: syndicate.name, wealth: SyndicateCash.available(syndicate.id) },
          day: this.day(),
          context: this.context(business),
        });
        if (out.ok) await this._commit(out);
        return out.ok ? { ok: true } : { ok: false, reason: out.reason };
      } catch (error) {
        log.error('A syndicate business request failed', error);
        return { ok: false, reason: 'error' };
      }
    });
  }

  /**
   * Look up the items a request names (`[{uuid}]`) and read them as gear: from the requesting
   * character's own sheet, or from the Items directory or a compendium. An item on another
   * character's sheet, installed cyberware, a skill or a role, or an item with no price is refused.
   * An item from the sheet is kept in full so it can be given back if the business never opens.
   * @returns {Promise<{ok: true, gear: object[]} | {ok: false, reason: string}>}
   */
  async resolveGear(actor, requested = []) {
    const uuids = [...new Set((Array.isArray(requested) ? requested : []).map((g) => String(g?.uuid ?? '')).filter(Boolean))];
    const gear = [];
    for (const uuid of uuids) {
      const item = await fromUuid(uuid).catch(() => null);
      if (!item || item.documentName !== 'Item') return { ok: false, reason: 'item-missing' };
      const owner = item.parent?.documentName === 'Actor' ? item.parent : null;
      const read = itemGear({ type: item.type, name: item.name, img: item.img, system: item.system, ownerId: owner?.id ?? null }, actor.id);
      if (!read.ok) return read;
      gear.push({
        name: read.name, value: read.value, uuid, img: read.img,
        ...(read.fromActor ? { item: { ...item.toObject(), _id: undefined, _sourceId: item.id } } : {}),
      });
    }
    return { ok: true, gear };
  }

  /**
   * Eddies first, then the record, then the items that moved, then the hidden state; then tell everyone.
   * @param {{officerId?: string|null}} [by] - the officer who made a syndicate's payment, for its daily limit
   */
  async _commit(out, { officerId = null } = {}) {
    await this._pay(out.wealth, out.business, officerId);
    // A layer hides a holding: a holder who has sold out loses theirs (B6d).
    pruneMasks(out.business);
    await BusinessRepository.save(out.business);
    await this._moveItems(out);
    await this._saveHidden(out);
    await this._syncJobs(out.business);
    await this._payslips(out);
    await this._twoJobs(out);
    await this._scheduleListing(out.business);
    await this._capitalEvents(out);
    await this._insolvencyEvents(out);
    await this._ownershipEvents(out);
    await this._regulatorEvents(out);
    await this._publishRegister(out.business);
    await this._afterReports(out);
    for (const event of out.events.filter((e) => e.type === 'periodClosed')) {
      Hooks.callAll(HOOKS.BUSINESS_PERIOD, { businessId: out.business.id, digest: event.digest });
    }
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: out.business.id, events: out.events });
  }

  /**
   * The hidden state a change brings: Exposure, and the traits of new applicants (E2). Traits of people
   * who have gone (applicants who lapsed, staff who left) are dropped.
   */
  async _saveHidden(out) {
    const exposure = out.events.reduce((a, e) => a + (e.exposure ?? 0), 0);
    const hidden = MarketStore.getBusinessesHidden();
    const entry = hidden[out.business.id] ?? { exposure: 0 };
    const people = new Set([...(out.business.candidates ?? []).map((c) => c.id), ...(out.business.staff ?? []).map((s) => s.candidateId ?? s.id)]);
    const traits = Object.fromEntries(Object.entries({ ...(entry.traits ?? {}), ...(out.traits ?? {}) }).filter(([id]) => people.has(id)));
    const sameTraits = JSON.stringify(traits) === JSON.stringify(entry.traits ?? {});
    // Each hidden holding's layer strengths (B6d), trimmed to the layers it still has.
    const layers = {};
    for (const [id, list] of Object.entries(out.business.masks ?? {})) layers[id] = (entry.layers?.[id] ?? []).slice(0, list.length);
    for (const t of out.layerTotals ?? []) (layers[t.holderId] ??= [])[t.index] = t.total;
    const sameLayers = JSON.stringify(layers) === JSON.stringify(entry.layers ?? {});
    if (!exposure && sameTraits && sameLayers) return;
    // An internal audit can wipe some Exposure out, but never below none.
    const next = { ...entry, exposure: Math.max(0, (entry.exposure ?? 0) + exposure) };
    if (Object.keys(traits).length) next.traits = traits;
    else delete next.traits;
    if (Object.keys(layers).length) next.layers = layers;
    else delete next.layers;
    await MarketStore.setBusinessesHidden({ ...hidden, [out.business.id]: next });
  }

  /**
   * Pay each player character on the staff as a week closes: a payslip by Messenger mail with the wage
   * attached, for them to claim. With payslip mail turned off, or a mail that cannot be sent (no
   * Messenger, no market wire), the wage goes straight to their sheet instead, so it is never lost.
   */
  async _payslips(out) {
    const mail = game.settings.get(MODULE_ID, SETTINGS.STAFF_MAIL) !== false;
    const eb = (n) => Math.round(Number(n) || 0).toLocaleString();
    for (const slip of out.events.filter((e) => e.type === 'payslip')) {
      const actor = game.actors.get(slip.actorId);
      if (!actor) continue;
      // The wage paid, and any overtime this week (E3), both claimed from the payslip.
      const wage = Math.max(0, Math.round(Number(slip.paid) || 0));
      const overtime = Math.max(0, Math.round(Number(slip.overtime) || 0));
      const paid = wage + overtime;
      let sent = false;
      if (mail) {
        try {
          const result = await MailService.fromWire(actor, {
            // Wage and overtime each on a line of their own, so a week with overtime says so.
            subject: L(overtime ? 'NCI.Staff.Payslip.SubjectOvertime' : 'NCI.Staff.Payslip.Subject', { name: out.business.name }),
            lines: [
              L('NCI.Staff.Payslip.Body', { name: out.business.name, post: L(`NCI.Staff.Post.${slip.post}`), wage: eb(slip.wage), paid: eb(wage) }),
              ...(overtime ? [L('NCI.Staff.Payslip.Overtime', { overtime: eb(overtime), shifts: slip.shifts || 1 })] : []),
              ...(paid ? [L(overtime ? 'NCI.Staff.Payslip.AttachedBoth' : 'NCI.Staff.Payslip.Attached', { paid: eb(paid), wage: eb(wage), overtime: eb(overtime) })] : []),
              ...(slip.owed ? [L('NCI.Staff.Payslip.Owed', { owed: eb(slip.owed) })] : []),
            ],
            eddies: paid,
          });
          sent = !!result?.ok;
        } catch (error) {
          log.warn('Payslip mail failed', error);
        }
      }
      if (!sent && paid) await this._pay({ [actor.id]: paid }, out.business);
    }
  }

  /**
   * A two-jobs event reaching the other business (E3, DESIGN §32.5): something let slip there gives it a
   * due diligence report on this one, and a note in its next digest; one caught well gives this one a
   * report on the other; an employee gone full time there is noted in its digest.
   */
  async _twoJobs(out) {
    const day = this.day();
    const report = (about, by) => {
      const view = diligenceView(about);
      const spread = BUSINESS_DEFAULTS.info.spread.solid;
      return {
        targetId: about.id, name: view.name, day, band: 'solid', by, heard: true, bands: view.bands,
        range: [Math.round((view.value * (1 - spread)) / 100) * 100, Math.round((view.value * (1 + spread)) / 100) * 100],
      };
    };
    const cap = BUSINESS_DEFAULTS.info.intelCap;
    for (const e of out.events.filter((x) => x.type === 'twoJobs')) {
      const here = BusinessRepository.get(e.businessId);
      const other = BusinessRepository.get(e.to ?? e.from);
      if (!here || !other) continue;
      if (e.kind === 'leak') {
        await BusinessRepository.save(normalizeBusiness({
          ...other, intel: [...(other.intel ?? []), report(here, null)].slice(-cap),
          pendingNotes: [...(other.pendingNotes ?? []), { kind: 'heardTalk', name: e.staffName, rival: here.name }],
        }));
      } else if (e.kind === 'learn') {
        await BusinessRepository.save(normalizeBusiness({ ...here, intel: [...(here.intel ?? []), report(other, null)].slice(-cap) }));
      } else if (e.kind === 'gainedFullTime') {
        await BusinessRepository.save(normalizeBusiness({ ...other, pendingNotes: [...(other.pendingNotes ?? []), { kind: 'gainedFullTime', name: e.staffName, rival: here.name }] }));
      }
    }
  }

  /** Take contributed items off the sheets they came from, and give back those a refund returns. */
  async _moveItems({ taken = {}, items = {} }) {
    for (const [actorId, ids] of Object.entries(taken)) {
      const actor = game.actors.get(actorId);
      const still = ids.filter((id) => actor?.items?.get?.(id));
      if (still.length) await actor.deleteEmbeddedDocuments('Item', still);
    }
    for (const [actorId, data] of Object.entries(items)) {
      const actor = game.actors.get(actorId);
      if (actor && data.length) await actor.createEmbeddedDocuments('Item', data);
    }
  }

  /**
   * Pay each partner: a character in eddies, a syndicate into its brokerage account. Money is taken
   * before any is paid out, so a payer who turns out to be short stops it before anyone is paid.
   */
  async _pay(wealth, business = null, officerId = null) {
    const moves = Object.entries(wealth ?? {}).sort(([, a], [, b]) => a - b);
    for (const [actorId, delta] of moves) {
      if (!delta) continue;
      if (SyndicateCash.isSyndicate(actorId)) {
        const paid = await SyndicateCash.pay(actorId, delta, { businessId: business?.id ?? null, businessName: business?.name ?? '', officerId });
        if (!paid.ok) throw new Error(`Syndicate ${actorId} could not pay ${-delta} eb: ${paid.reason}`);
        continue;
      }
      const actor = game.actors.get(actorId);
      if (!actor) continue;
      await WealthAdapter.set(actor, WealthAdapter.get(actor) + delta, WEALTH_REASON);
    }
  }

  /**
   * Mirror the jobs at a business onto the player characters who hold or are offered them, so they see
   * their job without seeing the business's books (DESIGN §32); a job that has ended is taken off.
   */
  async _syncJobs(business) {
    const holding = new Set((business.staff ?? []).filter((s) => s.source === 'pc' && s.actorId).map((s) => s.actorId));
    for (const actor of game.actors.filter((a) => isCharacter(a) && (holding.has(a.id) || jobsOf(a).some((j) => j.businessId === business.id)))) {
      const kept = jobsOf(actor).filter((j) => j.businessId !== business.id);
      const staff = business.status === 'open' ? (business.staff ?? []).find((s) => s.actorId === actor.id) : null;
      const jobs = staff ? [...kept, {
        businessId: business.id, businessName: business.name, archetype: business.archetype, stage: business.stage,
        staffId: staff.id, post: staff.post, status: staff.status, wage: staff.wage, hiredDay: staff.hiredDay, owed: staff.owed,
        // Overtime worked this week, paid with the next payslip (E3).
        overtime: business.period?.pcOvertime?.[actor.id] ?? 0,
        // The rolls a partner asked of them (E3), with what their roll dialog needs, since they cannot read the business.
        asks: this._asksFor(business, staff, actor),
      }] : kept;
      if (JSON.stringify(jobs) !== JSON.stringify(jobsOf(actor))) await actor.setFlag(MODULE_ID, FLAGS.JOBS, [jobs]);
    }
  }

  /**
   * The rolls asked of a player character on the staff, as their roll dialog needs them: what it is,
   * who asked, the ways they may roll it and the DV (for their own sheet), any +1 waiting, the overtime,
   * and what each result would mean. One they can no longer make (the slot taken) is left out.
   */
  _asksFor(business, staff, actor) {
    const day = this.day();
    return asksFor(business, staff.id).map((ask) => {
      const spec = rollSpec(business, { type: 'staffRoll', askId: ask.id, use: null }, actor.id, { day, operatorRank: this.context(business).operatorRank });
      if (!spec.ok) return null;
      const r = ask.roll;
      const event = business.period.event?.kind;
      const what = r.type === 'action' ? L(`NCI.Business.Action.${r.action}.Name`)
        : r.type === 'respond' ? L('NCI.Staff.AskRespond', { event: event ? L(`NCI.Event.${event}.Name`) : '' })
          : L('NCI.Staff.AskHelp', { action: L(`NCI.Business.Action.${r.forAction}.Name`) });
      return {
        id: ask.id, what, by: business.partners.find((x) => x.actorId === ask.by)?.name ?? '',
        uses: spec.uses, dv: spec.dv, bonusAvailable: !!spec.bonusAvailable, pay: spec.pay ?? 0,
        meaning: r.type === 'action' ? r.action : r.type === 'respond' ? (EVENTS[event]?.good ? 'respondGood' : 'respond') : 'assist',
      };
    }).filter(Boolean);
  }

  async _receipt(actor, request, out) {
    const r = receiptsOf(actor);
    const result = {
      key: request.key, type: request.type, ok: out.ok, ...(out.ok ? {} : { reason: out.reason }),
      businessId: out.business?.id ?? request.businessId ?? null, day: this.day(),
    };
    // A proposal (or a vote) that carried at once: say what happened, not that a proposal was made.
    const settled = out.ok ? proposalOutcome(out.events) : null;
    // A step up carried at once is registering, chartering or listing, by the stage.
    if (settled?.kind === 'stepUp' && !settled.detail) settled.detail = ['stepUp', 'stepUpCharter', 'stepUpList'][out.business?.stage] ?? 'stepUp';
    if (settled) result.proposal = settled;
    // An investigation's result (B6d): whether it found anything (what, comes by mail).
    if (out.investigation) result.investigation = out.investigation;
    // A regulator's case answered (R1): won or lost.
    if (out.caseResult) result.caseResult = out.caseResult;
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
      const opts = { weekday: this.weekday(), growthRate: this.growthRate(), actors: this.actors(), seed: this.seed() };
      let changed = 0;
      for (const stored of BusinessRepository.all().filter((b) => b.status === 'open')) {
        // Employees' skills are read again from their sheets before the week is counted.
        const business = normalizeBusiness(structuredClone(stored));
        const reread = refreshStaffBases(business, (id) => this.basesOf(id));
        const marked = markElsewhere(business, BusinessRepository.all()) | this._markConcerns(business) | this._syncHolders(business);
        const team = refreshTeams(business, (id) => this.basesOf(id), day);
        if (team.notes.length) business.pendingNotes = [...(business.pendingNotes ?? []), ...team.notes];
        const out = advanceBusiness(business, day, { ...opts, traits: this.traitsOf(business.id) });
        if (!out.changed && !reread && !marked && !team.changed) continue;
        await this._commit({ ...out, ok: true });
        changed++;
      }
      await this._marketCapital();
      await this._closeTakeovers();
      await this._layerFees();
      await this._concealment();
      await this._lapseCases();
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
    return this._gm(id, (b) => approveBusiness(b, this.day(), this.weekday(), undefined, this.seed()));
  }

  /** Turn a business down before it opens; everyone's money goes back. */
  reject(id) {
    return this._gm(id, (b) => rejectBusiness(b, this.day()));
  }

  /** Approve a charter waiting for the GM (DESIGN §31): formed at once, or its funding window opens. */
  approveCharter(id) {
    return this._gm(id, (b) => approveBusinessCharter(b, this.day()));
  }

  /** Turn a charter down: anything paid in is refunded; the filing fee is not. */
  rejectCharter(id) {
    return this._gm(id, (b) => rejectBusinessCharter(b, this.day()));
  }

  /** Approve a listing waiting for the GM (B5a): the prospectus rolls open. */
  approveListing(id) {
    return this._gm(id, (b) => approveBusinessListing(b, this.day()));
  }

  /** Turn a listing down: the fee is not refunded. */
  rejectListing(id) {
    return this._gm(id, (b) => rejectBusinessListing(b, this.day()));
  }

  /**
   * Approve a takeover offer (B6b): the whole offer is held from the bidder's brokerage balance, and it
   * opens for its days, its premium measured against the price now. A bidder who cannot cover it loses
   * the offer. The holders and the bidder are told; a listed company's offer makes the news.
   */
  approveTakeover(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const stored = BusinessRepository.get(id);
      if (stored?.takeover?.status !== 'awaiting') return { ok: false, reason: 'no-takeover' };
      const b = normalizeBusiness(structuredClone(stored));
      const t = b.takeover;
      const day = this.day();
      const account = this._account(t.bidderId);
      const escrow = Math.round(t.price * t.shares);
      const held = account && PortfolioRepository.hasPortfolio(account) ? PortfolioRepository.get(account) : null;
      const cash = held ? (held.cash ?? 0) - committedCash(held.orders ?? []) : 0;
      if (!account || cash < escrow) {
        dropTakeover(b, day, 'no-funds');
        await BusinessRepository.save(b);
        await this._mailAccount(t.bidderId, L('NCI.Takeover.Mail.UnfundedSubject', { name: b.name }), [L('NCI.Takeover.Mail.Unfunded', { name: b.name, escrow: escrow.toLocaleString() })]);
        Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
        return { ok: false, reason: 'no-funds' };
      }
      const tick = timeOf(MarketStore.getPublic());
      await PortfolioService.transformActor(account, (p) => ({
        portfolio: { ...p, cash: (p.cash ?? 0) - escrow, ledger: [...(p.ledger ?? []), { ts: tick, kind: 'takeoverEscrow', amount: -escrow, ref: b.id }] },
        changed: true,
      }));
      const ticker = b.company?.ticker ?? '';
      openTakeover(b, { day, reference: takeoverReference(b, MarketStore.getPublic().companies?.[ticker]?.price ?? 0) });
      await BusinessRepository.save(b);
      const terms = { name: b.name, ticker, bidder: t.bidderName, price: t.price.toLocaleString(), shares: t.shares.toLocaleString(), premium: Math.round(takeoverPremium(b.takeover) * 100), date: this._dayText(b.takeover.endDay) };
      await this._mailHolders(b, L('NCI.Takeover.Mail.OpenSubject', terms), [L('NCI.Takeover.Mail.Open', terms)]);
      await this._mailAccount(t.bidderId, L('NCI.Takeover.Mail.ApprovedSubject', terms), [L('NCI.Takeover.Mail.Approved', { ...terms, escrow: escrow.toLocaleString() })]);
      if (isListed(b)) await NewsService.post({ headline: L('NCI.News.Takeover', terms), tone: 'up', companyIds: [ticker] });
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
      return { ok: true, business: b };
    });
  }

  /** Turn a takeover offer down (B6b): nothing was held yet; the bidder is told. */
  rejectTakeover(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const stored = BusinessRepository.get(id);
      if (stored?.takeover?.status !== 'awaiting') return { ok: false, reason: 'no-takeover' };
      const b = normalizeBusiness(structuredClone(stored));
      const t = b.takeover;
      dropTakeover(b, this.day());
      await BusinessRepository.save(b);
      await this._mailAccount(t.bidderId, L('NCI.Takeover.Mail.RejectedSubject', { name: b.name }), [L('NCI.Takeover.Mail.Rejected', { name: b.name })]);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
      return { ok: true, business: b };
    });
  }

  /**
   * Close the takeover offers whose time is up (B6b): the tendered shares are bought at the price (a
   * listed company's between portfolios, a private one's on the record), the sellers paid into their
   * brokerage balances, the rest of the escrow returned to the bidder. Everyone involved is told.
   */
  async _closeTakeovers() {
    const day = this.day();
    for (const stored of BusinessRepository.all().filter((x) => x.takeover?.status === 'open' && day > x.takeover.endDay)) {
      const b = normalizeBusiness(structuredClone(stored));
      const listed = isListed(b);
      const ticker = b.company?.ticker;
      const tick = timeOf(MarketStore.getPublic());
      const t = b.takeover;
      let held = null;
      let sellable = null;
      if (listed) {
        this._syncHolders(b);
        held = {};
        sellable = {};
        for (const account of PortfolioRepository.accounts().filter((a) => PortfolioRepository.hasPortfolio(a))) {
          const lots = PortfolioRepository.get(account).lots ?? [];
          held[account.id] = heldQty(lots, ticker);
          sellable[account.id] = sellableQty(lots, ticker, tick);
        }
      }
      const done = settleTakeover(b, { day, sellable, held });
      if (!done.ok) continue;
      for (const r of done.transfers.filter((x) => !x.npc && !x.market)) {
        const account = this._account(r.actorId);
        if (!account) continue;
        await PortfolioService.transformActor(account, (p) => {
          const lots = listed ? consumeLotsFifo(p.lots ?? [], ticker, r.qty, tick)?.lots ?? p.lots : p.lots;
          return {
            portfolio: { ...p, lots, cash: (p.cash ?? 0) + r.cash, ledger: [...(p.ledger ?? []), { ts: tick, kind: 'tendered', assetId: ticker ?? '', qty: -r.qty, amount: r.cash, ref: b.id }] },
            changed: true,
          };
        });
      }
      const bidder = this._account(done.bidderId);
      if (bidder) {
        await PortfolioService.transformActor(bidder, (p) => ({
          portfolio: {
            ...p,
            cash: (p.cash ?? 0) + done.refund,
            lots: listed && done.acquired > 0
              ? [...(p.lots ?? []), { id: `lot_takeover_${b.id}_${day}`, assetType: 'stock', assetId: ticker, qty: done.acquired, unitCost: t.price, acquiredTick: tick, drip: false }]
              : (p.lots ?? []),
            ledger: [...(p.ledger ?? []), { ts: tick, kind: 'takeoverSettled', assetId: ticker ?? '', qty: done.acquired, amount: done.refund, ref: b.id }],
          },
          changed: true,
        }));
      }
      if (listed) this._syncHolders(b);
      // Selling into a takeover puts a hidden holder's name on the record (B6d).
      for (const r of done.transfers.filter((x) => !x.npc && !x.market)) unmask(b, r.actorId);
      await BusinessRepository.save(b);
      await this._saveHidden({ business: b, events: [] });
      await this._publishRegister(b);
      const terms = { name: b.name, ticker: ticker ?? '', bidder: t.bidderName, shares: done.acquired.toLocaleString(), price: t.price.toLocaleString(), refund: done.refund.toLocaleString() };
      const key = done.control ? 'Control' : 'Closed';
      await this._mailHolders(b, L('NCI.Takeover.Mail.ClosedSubject', terms), [L(`NCI.Takeover.Mail.${key}`, terms)]);
      await this._mailAccount(done.bidderId, L('NCI.Takeover.Mail.ClosedSubject', terms), [L(`NCI.Takeover.Mail.Bidder${key}`, terms)]);
      if (listed) await NewsService.post({ headline: L(done.control ? 'NCI.News.TakeoverControl' : 'NCI.News.TakeoverClosed', terms), tone: 'neutral', companyIds: [ticker] });
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
    }
  }

  /**
   * What a layer over this holding costs, and whether it can be paid (B6d): the setup fee from the
   * holder's brokerage balance; a first layer is their broker's nominee, so they need a broker.
   */
  _hideTerms(business, holderId, marketPrice) {
    const account = this._account(holderId);
    if (!account || !PortfolioRepository.hasPortfolio(account)) return { ok: false, reason: 'no-brokerage' };
    const p = PortfolioRepository.get(account);
    const broker = p.brokerContactId ? BrokerRepository.list().find((x) => x.id === p.brokerContactId) : null;
    const first = !(business.masks?.[holderId]?.length);
    if (first && !broker) return { ok: false, reason: 'no-broker' };
    const fee = layerFees(holdingValue(business, holderId, marketPrice)).setup;
    if ((p.cash ?? 0) - committedCash(p.orders ?? []) < fee) return { ok: false, reason: 'insufficient-funds' };
    return { ok: true, fee, broker: broker?.name ?? '' };
  }

  /** A layer roll was made (B6d): its setup fee is paid from the holder's brokerage balance, pass or fail. */
  async _ownershipEvents(out) {
    for (const e of out.events.filter((x) => x.type === 'layerRolled' && x.fee > 0)) {
      const account = this._account(e.holderId);
      if (!account) continue;
      const tick = timeOf(MarketStore.getPublic());
      await PortfolioService.transformActor(account, (p) => ({
        portfolio: { ...p, cash: (p.cash ?? 0) - e.fee, ledger: [...(p.ledger ?? []), { ts: tick, kind: 'layerFee', amount: -e.fee, ref: out.business.id }] },
        changed: true,
      }));
    }
  }

  /**
   * Each layer's monthly fee (B6d), from its holder's brokerage balance. A fee that cannot be paid ends
   * that layer and every one outside it; the holder is told.
   */
  async _layerFees() {
    const day = this.day();
    const pub = MarketStore.getPublic();
    for (const stored of BusinessRepository.all().filter((x) => x.status === 'open' && Object.keys(x.masks ?? {}).length)) {
      const due = layerFeesDue(stored, day);
      if (!due.length) continue;
      const b = normalizeBusiness(structuredClone(stored));
      const price = pub.companies?.[b.company?.ticker]?.price ?? 0;
      const tick = timeOf(pub);
      for (const holderId of [...new Set(due.map((d) => d.holderId))]) {
        const account = this._account(holderId);
        const fee = layerFees(holdingValue(b, holderId, price)).monthly;
        for (const { index } of due.filter((d) => d.holderId === holderId)) {
          const p = account && PortfolioRepository.hasPortfolio(account) ? PortfolioRepository.get(account) : null;
          if (!p || (p.cash ?? 0) - committedCash(p.orders ?? []) < fee) {
            const lost = b.masks[holderId]?.[index]?.name ?? '';
            dropLayers(b, holderId, index);
            await this._mailAccount(holderId, L('NCI.Ownership.Mail.LapsedSubject', { name: b.name }), [L('NCI.Ownership.Mail.Lapsed', { name: b.name, layer: lost, fee: fee.toLocaleString() })]);
            break;
          }
          await PortfolioService.transformActor(account, (q) => ({
            portfolio: { ...q, cash: (q.cash ?? 0) - fee, ledger: [...(q.ledger ?? []), { ts: tick, kind: 'layerFee', amount: -fee, ref: b.id }] },
            changed: true,
          }));
          b.masks[holderId][index].lastFee = day;
        }
      }
      await BusinessRepository.save(b);
      await this._saveHidden({ business: b, events: [] });
      await this._publishRegister(b);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
    }
  }

  /**
   * Concealment (B6d): a hidden holder of more than 5% of a listed company. Each week it adds heat to
   * the holder (with heat tracking on) and Exposure to the company; each month NCPD may look, and seeing
   * through the layers unmasks the holder publicly, with a fine from their brokerage balance.
   */
  async _concealment({ random = null } = {}) {
    const day = this.day();
    const P = BUSINESS_DEFAULTS.ownership;
    for (const stored of BusinessRepository.all().filter((x) => x.status === 'open' && isListed(x) && Object.keys(x.masks ?? {}).length)) {
      const concealed = concealedHolders(stored);
      if (!concealed.length) continue;
      const hidden = MarketStore.getBusinessesHidden();
      const entry = structuredClone(hidden[stored.id] ?? { exposure: 0 });
      const timers = entry.concealment ?? {};
      let b = null;
      let caseOpened = false;
      for (const { holderId, share } of concealed) {
        const t = timers[holderId] ?? { week: day, audit: day };
        if (day - t.week >= 7) {
          t.week = day;
          entry.exposure = (entry.exposure ?? 0) + P.exposure;
          if (HeatService.enabled() && PortfolioRepository.accountOf(holderId)) await HeatService.setHeat(holderId, HeatService.heatOf(holderId) + P.heat);
        }
        if (day - t.audit >= P.audit.days) {
          t.audit = day;
          // Seeded by the company, the holder and the day; a test may pass its own numbers.
          const rng = createRng(`${this.seed()}:audit:${stored.id}:${holderId}:${day}`);
          const look = auditConcealment(entry.layers?.[holderId] ?? [], HeatService.heatOf(holderId) ?? 0, random ?? (() => rng.next()));
          if (look.unmasked) {
            b ??= normalizeBusiness(structuredClone(stored));
            const price = MarketStore.getPublic().companies?.[b.company.ticker]?.price ?? 0;
            const fine = Math.round(holdingValue(b, holderId, price) * P.fine);
            unmask(b, holderId);
            delete entry.layers?.[holderId];
            delete timers[holderId];
            const account = this._account(holderId);
            if (account && PortfolioRepository.hasPortfolio(account) && fine > 0) {
              const tick = timeOf(MarketStore.getPublic());
              await PortfolioService.transformActor(account, (p) => {
                const paid = Math.min(fine, Math.max(0, p.cash ?? 0));
                return { portfolio: { ...p, cash: (p.cash ?? 0) - paid, ledger: [...(p.ledger ?? []), { ts: tick, kind: 'concealmentFine', amount: -paid, ref: b.id }] }, changed: true };
              });
            }
            const name = account?.name ?? '';
            const terms = { name: b.name, ticker: b.company.ticker, holder: name, pct: Math.round(share * 1000) / 10, fine: fine.toLocaleString() };
            await NewsService.post({ headline: L('NCI.News.Unmasked', terms), tone: 'down', companyIds: [b.company.ticker] });
            // The scandal weighs on the stock from the next day, more for a bigger hidden stake.
            const key = `unmask:${b.id}:${holderId}:${day}`;
            await TickService.updateControls((controls, { tick: now }) => (controls.impacts.some((i) => i.sourceKey === key) ? controls : {
              ...controls,
              impacts: [...controls.impacts, makeImpact({
                id: `imp_unmask_${b.id}_${day}`, target: { type: 'company', id: b.company.ticker }, amount: scandalHit(share), onsetTick: now + P.scandal.delayDays,
                permanent: 1, sourceKey: key, source: 'unmasked', meta: { businessId: b.id },
              })],
            }));
            await this._mailAccount(holderId, L('NCI.Ownership.Mail.UnmaskedSubject', terms), [L('NCI.Ownership.Mail.Unmasked', terms)]);
            // A big enough holder found hiding brings the regulators to the company too (R1).
            if (share > BUSINESS_DEFAULTS.regulator.unmaskShare && openCase(b, { reason: 'unmasked', day }).ok) caseOpened = true;
            continue;
          }
        }
        timers[holderId] = t;
      }
      entry.concealment = timers;
      await MarketStore.setBusinessesHidden({ ...MarketStore.getBusinessesHidden(), [stored.id]: entry });
      if (b) {
        await BusinessRepository.save(b);
        await this._publishRegister(b);
        if (caseOpened) await this._mailCaseOpened(b);
        Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
      }
    }
  }

  /**
   * Regulators may open a case after a change (R1): at once on a trigger in its events (a fired corp
   * plant, a fumbled Shortcuts roll), or by a chance at each monthly report, rising with Exposure.
   */
  async _regulatorEvents(out) {
    const stored = out.business;
    if (!stored || stored.stage !== 2 || stored.status !== 'open' || caseOf(stored)) return;
    const exposure = MarketStore.getBusinessesHidden()[stored.id]?.exposure ?? 0;
    let reason = caseTrigger(out.events);
    if (!reason) {
      const report = out.events.find((e) => e.type === 'reportPublished')?.report;
      if (!report) return;
      const rng = createRng(`${this.seed()}:case:${stored.id}:${report.index}`);
      if (rng.next() >= caseChance(exposure)) return;
      reason = 'report';
    }
    const b = normalizeBusiness(structuredClone(BusinessRepository.get(stored.id) ?? stored));
    if (!openCase(b, { reason, day: this.day() }).ok) return;
    await BusinessRepository.save(b);
    await this._mailCaseOpened(b);
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
  }

  async _mailCaseOpened(b) {
    const terms = { name: b.name, date: this._dayText(b.regCase.endDay), why: L(`NCI.Regulator.Reason.${b.regCase.reason}`) };
    await this._mailHolders(b, L('NCI.Regulator.Mail.OpenSubject', terms), [L('NCI.Regulator.Mail.Open', terms)]);
  }

  /**
   * An officer answers a case (R1): their roll is read back against the regulator's total, which also
   * counts the Exposure band players cannot see. A win clears half the Exposure; a loss waits on the GM.
   */
  async _answerCase(actor, request) {
    const stored = BusinessRepository.get(request.businessId);
    if (!stored) return { ok: false, reason: 'no-business' };
    const as = this._partnerFor(actor, request);
    if (!as.ok) return as;
    const can = caseAnswerCheck(stored, as.partner.id);
    if (!can.ok) return can;
    const use = (request.use && BUSINESS_DEFAULTS.regulator.uses.find((u) => useKey(u) === useKey(request.use))) ?? null;
    if (!use) return { ok: false, reason: 'bad-use' };
    const bribe = caseBribe(use);
    if (bribe > stored.till) return { ok: false, reason: 'no-funds' };
    const hidden = MarketStore.getBusinessesHidden();
    const exposure = hidden[stored.id]?.exposure ?? 0;
    const rng = createRng(`${this.seed()}:caseRoll:${stored.id}:${stored.regCase.openedDay}`);
    const check = await SkillAdapter.verifyLevers(actor, request, { dv: regulatorTotal(exposure, () => rng.next()), use });
    if (!check.ok) return check;
    const day = this.day();
    const b = normalizeBusiness(structuredClone(stored));
    if (bribe) payCaseBribe(b, bribe, day);
    const r = check.result;
    if (r.success) {
      winCase(b, day);
      await MarketStore.setBusinessesHidden({ ...hidden, [b.id]: { ...(hidden[b.id] ?? {}), exposure: Math.floor(exposure * (1 - BUSINESS_DEFAULTS.regulator.clearShare)) } });
    } else {
      loseCase(b, { day, exposure, fumble: r.band === 'fumble' });
    }
    await BusinessRepository.save(b);
    await this._mailHolders(b, L('NCI.Regulator.Mail.AnsweredSubject', { name: b.name }), [L(r.success ? 'NCI.Regulator.Mail.Won' : 'NCI.Regulator.Mail.Lost', { name: b.name })]);
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
    return { ok: true, business: b, caseResult: { success: r.success, band: r.band } };
  }

  /** A case nobody answered in time is lost (R1), and waits on the GM like any other. */
  async _lapseCases() {
    const day = this.day();
    const hidden = MarketStore.getBusinessesHidden();
    for (const stored of BusinessRepository.all().filter((x) => x.status === 'open' && x.regCase?.status === 'notice' && day > x.regCase.endDay)) {
      const b = normalizeBusiness(structuredClone(stored));
      loseCase(b, { day, exposure: hidden[b.id]?.exposure ?? 0, silent: true });
      await BusinessRepository.save(b);
      await this._mailHolders(b, L('NCI.Regulator.Mail.AnsweredSubject', { name: b.name }), [L('NCI.Regulator.Mail.Silent', { name: b.name })]);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
    }
  }

  /** The GM opens a case by hand (R1). */
  openCaseByHand(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const stored = BusinessRepository.get(id);
      if (!stored) return { ok: false, reason: 'no-business' };
      const b = normalizeBusiness(structuredClone(stored));
      const done = openCase(b, { reason: 'gm', day: this.day() });
      if (!done.ok) return done;
      await BusinessRepository.save(b);
      await this._mailCaseOpened(b);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
      return { ok: true, business: b };
    });
  }

  /** The GM drops a case at any stage (R1): nothing further happens, and the owners are told. */
  dropCaseByHand(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const stored = BusinessRepository.get(id);
      if (!stored?.regCase) return { ok: false, reason: 'no-case' };
      const b = normalizeBusiness(structuredClone(stored));
      dropCase(b, this.day());
      await BusinessRepository.save(b);
      await this._mailHolders(b, L('NCI.Regulator.Mail.AnsweredSubject', { name: b.name }), [L('NCI.Regulator.Mail.Dropped', { name: b.name })]);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
      return { ok: true, business: b };
    });
  }

  /** The GM approves a lost case's fine, perhaps changed (R1): the fine, the Compliance hit, and any further penalty. */
  approveCaseFine(id, fine = null) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const stored = BusinessRepository.get(id);
      if (stored?.regCase?.status !== 'lost') return { ok: false, reason: 'no-case' };
      const b = normalizeBusiness(structuredClone(stored));
      const done = applyCaseLoss(b, { day: this.day(), fine });
      if (!done.ok) return done;
      await BusinessRepository.save(b);
      const terms = { name: b.name, ticker: b.company?.ticker ?? '', fine: done.fine.toLocaleString() };
      const more = done.stopped ? 'Stopped' : done.restated ? 'Restated' : null;
      await this._mailHolders(b, L('NCI.Regulator.Mail.FinedSubject', terms), [L('NCI.Regulator.Mail.Fined', terms), ...(more ? [L(`NCI.Regulator.Mail.${more}`, terms)] : [])]);
      if (done.listed) await NewsService.post({ headline: L('NCI.News.CaseLost', terms), tone: 'down', companyIds: [b.company.ticker] });
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
      return { ok: true, business: b, ...done };
    });
  }

  /**
   * An investigation of a hidden holding (B6d): any character, naming the register row's layer (by its
   * reference) and the company (by ticker, or by id from the Business window). Their roll (Library
   * Search, Streetwise, Bribery or Interface) is read back against the next layer they have not seen
   * through: its strength, plus 2 for each layer they have. A win tells them (by mail) the next layer
   * down, or who is behind it; a fumble tells the holder someone is digging. Once a week each.
   */
  async _investigate(actor, request) {
    const P = BUSINESS_DEFAULTS.ownership.investigate;
    const ticker = String(request.ticker ?? '').trim().toUpperCase();
    const stored = request.businessId ? BusinessRepository.get(request.businessId) : BusinessRepository.all().find((x) => x.status === 'open' && x.company?.ticker === ticker);
    if (!stored) return { ok: false, reason: 'no-target' };
    const holderId = holderByRef(stored, request.ref);
    if (!holderId) return { ok: false, reason: 'nothing-hidden' };
    if (holderId === actor.id) return { ok: false, reason: 'own-holding' };
    const use = (request.use && P.uses.find((u) => useKey(u) === useKey(request.use))) ?? null;
    if (!use) return { ok: false, reason: 'bad-use' };
    const day = this.day();
    const hidden = MarketStore.getBusinessesHidden();
    const entry = structuredClone(hidden[stored.id] ?? { exposure: 0 });
    // What this investigator has peeled, and when they last tried: started again when the layers change.
    const stale = entry.known?.[actor.id]?.[holderId];
    const mine = stale?.ref === request.ref ? stale : { peeled: 0, tried: -Infinity, ref: request.ref };
    // The investigator's own record of when they last tried, so their window refuses before rolling.
    const noteTried = async (when) => {
      const tried = unwrap(actor.getFlag(MODULE_ID, FLAGS.INVESTIGATED)) ?? {};
      if (tried[request.ref] !== when) await actor.setFlag(MODULE_ID, FLAGS.INVESTIGATED, [{ ...tried, [request.ref]: when }]);
    };
    if (day - mine.tried < P.days) {
      await noteTried(mine.tried);
      return { ok: false, reason: 'investigate-wait' };
    }
    const target = investigationTarget(stored, holderId, entry.layers?.[holderId] ?? [], mine.peeled);
    if (!target.ok) return target;
    const cost = investigationCost(BusinessRepository.all(), actor.id, use);
    const wealth = WealthAdapter.get(actor);
    if (cost.fee > wealth) return { ok: false, reason: 'insufficient-funds' };
    const check = await SkillAdapter.verifyLevers(actor, request, { dv: target.dv, use });
    if (!check.ok) return check;
    // The legwork: a business day from one of their businesses, or money; a bribe on top. Spent whatever it finds.
    if (cost.fee > 0) await WealthAdapter.set(actor, wealth - cost.fee, L('NCI.Ownership.CostReason', { name: stored.name }));
    if (cost.businessId) {
      const own = normalizeBusiness(structuredClone(BusinessRepository.get(cost.businessId)));
      spendDays(own, actor.id, 1);
      await BusinessRepository.save(own);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: own.id });
    }
    const r = check.result;
    mine.tried = day;
    await noteTried(day);
    const company = stored.name;
    if (r.success) {
      mine.peeled += 1;
      const holder = this._account(holderId);
      const found = target.reveals ? (target.reveals.kind === 'nominee' ? L('NCI.Ownership.Nominee', { broker: target.reveals.name }) : target.reveals.name) : (holder?.name ?? '?');
      await this._mailAccount(actor.id, L('NCI.Ownership.Mail.FoundSubject', { name: company }), [L(target.reveals ? 'NCI.Ownership.Mail.FoundLayer' : 'NCI.Ownership.Mail.FoundHolder', { name: company, found })]);
      // On the investigator too, keyed by the register row's layer, so their own windows show what they found.
      const known = unwrap(actor.getFlag(MODULE_ID, FLAGS.DISCOVERIES)) ?? {};
      await actor.setFlag(MODULE_ID, FLAGS.DISCOVERIES, [{ ...known, [request.ref]: [...(known[request.ref] ?? []), found].slice(0, 4) }]);
    } else if (r.band === 'fumble') {
      await this._mailAccount(holderId, L('NCI.Ownership.Mail.TippedSubject', { name: company }), [L('NCI.Ownership.Mail.Tipped', { name: company })]);
    }
    entry.known = { ...(entry.known ?? {}), [actor.id]: { ...(entry.known?.[actor.id] ?? {}), [holderId]: mine } };
    await MarketStore.setBusinessesHidden({ ...MarketStore.getBusinessesHidden(), [stored.id]: { ...MarketStore.getBusinessesHidden()[stored.id], known: entry.known } });
    // The layer looked at goes on the receipt, so the investigator's own window knows the week is used.
    return { ok: true, investigation: { success: r.success, band: r.band, ref: request.ref }, businessId: stored.id };
  }

  /**
   * A listed company's public register (B6d), on its market record for every client: each holder by
   * the name a register shows (the outermost layer of a hidden one), with the market's float.
   */
  async _publishRegister(business) {
    if (!business || !isListed(business)) return;
    const company = CompanyRepository.get(business.company?.ticker);
    if (!company) return;
    const total = business.listing.shares || 1;
    const register = business.partners
      .filter((x) => ['active', 'leaving'].includes(x.status) && x.units > 0)
      .map((x) => {
        const mask = outerMask(business, x.actorId);
        return {
          label: x.market ? '' : (mask ? mask.name : x.name), kind: x.market ? 'market' : x.creditors ? 'creditors' : mask?.kind ?? (x.npc ? 'npc' : 'holder'),
          shares: x.units, pct: Math.round((x.units / total) * 1000) / 10, ...(mask?.ref ? { ref: mask.ref } : {}),
        };
      })
      .sort((a, c) => c.shares - a.shares);
    if (JSON.stringify(register) === JSON.stringify(company.register ?? [])) return;
    await CompanyRepository.save({ ...company, register });
  }

  /** A character or a syndicate's account, by id. */
  _account(id) {
    return game.actors.get(id) ?? SyndicateRepository.account(id) ?? null;
  }

  /** A mail to an account: a character directly, a syndicate's active members each. */
  async _mailAccount(id, subject, lines) {
    const ids = game.actors.get(id) ? [id] : (SyndicateRepository.get(id)?.members ?? []).filter((m) => m.status === 'active').map((m) => m.actorId);
    for (const actorId of ids) {
      const actor = game.actors.get(actorId);
      if (!actor) continue;
      try {
        await MailService.fromWire(actor, { subject, lines });
      } catch (error) {
        log.warn('Takeover mail failed', error);
      }
    }
  }

  /** A game day as the calendar shows it, for mails. */
  _dayText(day) {
    return MarketClock.dateString(day * 86400000);
  }

  /**
   * A company has gone into administration, or come out of it (B6c): its shareholders are told, and a
   * listed company's news reports it, the price taking a dent on the way in.
   */
  async _insolvencyEvents(out) {
    const b = out.business;
    if (!b) return;
    const ticker = isListed(b) ? b.company?.ticker : null;
    for (const e of out.events) {
      if (e.type === 'administration') {
        const terms = { name: b.name, ticker: ticker ?? '', net: Math.round(e.net ?? 0).toLocaleString() };
        await this._mailHolders(b, L('NCI.Insolvency.Mail.InSubject', terms), [L('NCI.Insolvency.Mail.In', terms)]);
        if (ticker) {
          const key = `administration:${b.id}:${this.day()}`;
          await TickService.updateControls((controls, { tick }) => (controls.impacts.some((i) => i.sourceKey === key) ? controls : {
            ...controls,
            impacts: [...controls.impacts, makeImpact({
              id: `imp_admin_${b.id}_${this.day()}`, target: { type: 'company', id: ticker }, amount: BUSINESS_DEFAULTS.insolvency.hit, onsetTick: tick,
              permanent: 1, sourceKey: key, source: 'administration', meta: { businessId: b.id },
            })],
          }));
          await NewsService.post({ headline: L('NCI.News.Administration', terms), tone: 'down', companyIds: [ticker] });
        }
      } else if (e.type === 'administrationEnded') {
        await this._mailHolders(b, L('NCI.Insolvency.Mail.OutSubject', { name: b.name }), [L('NCI.Insolvency.Mail.Out', { name: b.name })]);
        if (ticker) await NewsService.post({ headline: L('NCI.News.AdministrationEnded', { name: b.name, ticker }), tone: 'up', companyIds: [ticker] });
      }
    }
  }

  /**
   * Restructure a company in administration (B6c): its debts become shares for its creditors. A listed
   * company's new shares are added to the market, and its price diluted to match.
   */
  restructureBusiness(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const stored = BusinessRepository.get(id);
      if (!stored?.administration) return { ok: false, reason: 'not-administration' };
      const b = normalizeBusiness(structuredClone(stored));
      this._syncHolders(b);
      const before = b.listing?.shares ?? 0;
      const out = { wealth: {}, events: [] };
      const done = restructure(b, this.day(), BUSINESS_DEFAULTS, out);
      if (!done.ok) return done;
      await this._commit({ ok: true, business: b, wealth: out.wealth, events: [{ type: 'restructured', shares: done.shares }] });
      const ticker = isListed(b) ? b.company.ticker : null;
      if (ticker) {
        const company = CompanyRepository.get(ticker);
        if (company) await CompanyRepository.save({ ...company, sharesOutstanding: b.listing.shares });
        if (before > 0 && done.shares > 0) {
          const key = `restructure:${b.id}:${this.day()}`;
          await TickService.updateControls((controls, { tick }) => (controls.impacts.some((i) => i.sourceKey === key) ? controls : {
            ...controls,
            impacts: [...controls.impacts, makeImpact({
              id: `imp_restructure_${b.id}_${this.day()}`, target: { type: 'company', id: ticker }, amount: Math.log(before / b.listing.shares), onsetTick: tick,
              permanent: 1, sourceKey: key, source: 'restructure', meta: { businessId: b.id },
            })],
          }));
        }
        await NewsService.post({ headline: L('NCI.News.Restructured', { name: b.name, ticker }), tone: 'neutral', companyIds: [ticker] });
      }
      const terms = { name: b.name, shares: done.shares.toLocaleString(), debts: done.debts.toLocaleString(), paid: done.paid.toLocaleString() };
      await this._mailHolders(b, L('NCI.Insolvency.Mail.RestructuredSubject', terms), [L('NCI.Insolvency.Mail.Restructured', terms)]);
      return { ok: true, ...done };
    });
  }

  /**
   * Wind up a company in administration (B6c): it closes, paying owed wages, then its loans, then its
   * holders by shares. A listed company's holders are paid into their brokerage balances for the shares
   * in their portfolios, which leave them; the market company is marked bankrupt.
   */
  windUpBusiness(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const stored = BusinessRepository.get(id);
      if (!stored?.administration) return { ok: false, reason: 'not-administration' };
      const b = normalizeBusiness(structuredClone(stored));
      this._syncHolders(b);
      const ticker = isListed(b) ? b.company.ticker : null;
      const mailTo = structuredClone(b);
      const out = { wealth: {}, events: [] };
      const done = windUp(b, this.day(), out);
      if (!done.ok) return done;
      await this._commit({ ok: true, business: b, wealth: out.wealth, events: out.events });
      if (ticker) {
        const tick = timeOf(MarketStore.getPublic());
        for (const account of PortfolioRepository.accounts().filter((a) => PortfolioRepository.hasPortfolio(a))) {
          const p0 = PortfolioRepository.get(account);
          const qty = heldQty(p0.lots ?? [], ticker);
          const open = (p0.orders ?? []).some((o) => o.assetId === ticker && o.status === 'open');
          if (!qty && !open) continue;
          const paid = Math.floor(qty * done.perShare);
          await PortfolioService.transformActor(account, (p) => ({
            portfolio: {
              ...p,
              cash: (p.cash ?? 0) + paid,
              lots: (p.lots ?? []).filter((l) => l.assetId !== ticker),
              orders: (p.orders ?? []).map((o) => (o.assetId === ticker && o.status === 'open' ? { ...o, status: 'cancelled', closedTick: tick, reason: 'wound-up' } : o)),
              ledger: qty ? [...(p.ledger ?? []), { ts: tick, kind: 'windUp', assetId: ticker, qty: -qty, amount: paid, ref: b.id }] : (p.ledger ?? []),
            },
            changed: true,
          }));
        }
        const company = CompanyRepository.get(ticker);
        if (company) await CompanyRepository.save({ ...company, status: 'bankrupt', offering: null });
        await NewsService.post({ headline: L('NCI.News.WoundUp', { name: b.name, ticker, perShare: done.perShare.toLocaleString() }), tone: 'down', companyIds: [ticker] });
      }
      const terms = { name: b.name, perShare: done.perShare.toLocaleString(), wages: Math.round(done.wages).toLocaleString(), loans: Math.round(done.loans).toLocaleString() };
      await this._mailHolders(mailTo, L('NCI.Insolvency.Mail.WoundUpSubject', terms), [L(ticker ? 'NCI.Insolvency.Mail.WoundUpListed' : 'NCI.Insolvency.Mail.WoundUp', terms)]);
      return { ok: true, ...done };
    });
  }

  /** Give a company under the delisting review time (B5c): the review clears and the count starts again. */
  giveTime(id) {
    return this._gm(id, (b) => {
      const copy = normalizeBusiness(structuredClone(b));
      const done = clearReview(copy, { day: this.day() });
      return done.ok ? { ok: true, business: copy, wealth: {}, events: [{ type: 'reviewCleared' }] } : done;
    });
  }

  /**
   * Delist a company under review (B5c): it buys the market's float back and goes private again. The
   * holders' shares leave their portfolios (open orders on it are cancelled) and are units on the
   * record again; the market company is marked delisted. The news and every shareholder hear of it.
   */
  delist(id) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const stored = BusinessRepository.get(id);
      if (!stored) return { ok: false, reason: 'no-business' };
      const b = normalizeBusiness(structuredClone(stored));
      this._syncHolders(b);
      const ticker = b.company?.ticker;
      const price = MarketStore.getPublic().companies?.[ticker]?.price ?? 0;
      const day = this.day();
      const done = delistCompany(b, { price, day, loanId: `loan_delist_${b.id}_${day}` });
      if (!done.ok) return done;
      await this._commit({ business: b, wealth: {}, events: [{ type: 'delisted', cost: done.cost, borrowed: done.borrowed }] });

      const tick = timeOf(MarketStore.getPublic());
      for (const account of PortfolioRepository.accounts().filter((a) => PortfolioRepository.hasPortfolio(a))) {
        const qty = heldQty(PortfolioRepository.get(account).lots ?? [], ticker);
        const open = (PortfolioRepository.get(account).orders ?? []).some((o) => o.assetId === ticker && o.status === 'open');
        if (!qty && !open) continue;
        await PortfolioService.transformActor(account, (p) => ({
          portfolio: {
            ...p,
            lots: (p.lots ?? []).filter((l) => l.assetId !== ticker),
            orders: (p.orders ?? []).map((o) => (o.assetId === ticker && o.status === 'open' ? { ...o, status: 'cancelled', closedTick: tick, reason: 'delisted' } : o)),
            ledger: qty ? [...(p.ledger ?? []), { ts: tick, kind: 'delisting', assetId: ticker, qty: -qty, amount: 0, ref: b.id }] : (p.ledger ?? []),
          },
          changed: true,
        }));
      }
      const company = CompanyRepository.get(ticker);
      if (company) await CompanyRepository.save({ ...company, status: 'delisted' });
      await NewsService.post({ headline: L('NCI.News.PlayerDelisted', { name: b.name, ticker, price: price.toLocaleString() }), tone: 'down', companyIds: [ticker] });
      await this._mailHolders(b, L('NCI.Listing.Mail.DelistedSubject', { name: b.name }), [L('NCI.Listing.Mail.Delisted', { name: b.name, ticker })]);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { businessId: b.id });
      return { ok: true, business: b, ...done };
    });
  }

  /** The GM answers a job offer for an NPC (DESIGN §32). */
  answerOffer(id, staffId, yes) {
    return this._gm(id, (b) => {
      const copy = normalizeBusiness(structuredClone(b));
      const done = answerJob(copy, staffId, yes, this.day());
      return done.ok ? { ok: true, business: copy, wealth: {}, events: [{ type: yes ? 'jobAccepted' : 'jobDeclined', staffId }] } : done;
    });
  }

  /** A partner has died or left the table: the others may buy the stake, or it goes to the heir. */
  partnerLeaves(id, actorId) {
    return this._gm(id, (b) => markLeaving(b, actorId, this.day()));
  }

  /**
   * A gig run for a player's own business (DESIGN §27.5): its outcome changes the business's
   * Reputation and next week's takings. Called by the gig service, once the GM has approved it or
   * straight away when approval is off.
   * @param {{businessId: string, sourceKey: string, outcome: 'done'|'failed', reward: number}} rec
   */
  applyGig(rec) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return this._queue.run(async () => {
      const business = BusinessRepository.get(rec.businessId);
      if (!business) return { ok: false, reason: 'no-business' };
      const out = applyBusinessGig(business, { key: rec.sourceKey, outcome: rec.outcome, reward: rec.reward, day: this.day() });
      if (!out.ok) return out;
      await this._commit(out);
      return { ok: true, plan: out.plan };
    });
  }

  /** What a gig would do to a business now, for the GM's approval queue. */
  planGig(rec) {
    const business = BusinessRepository.get(rec.businessId);
    return business ? planBusinessGig(business, { outcome: rec.outcome, reward: rec.reward, day: this.day() }) : null;
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
