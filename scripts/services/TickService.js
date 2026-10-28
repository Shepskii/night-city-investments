/**
 * Tick service: advances the market. Runs on the active GM client only.
 * @file scripts/services/TickService.js
 * @description
 *   - worldTime mode: one tick per in-world day, caught up (capped) after time skips
 *   - realTime mode:  one tick every N real minutes while a GM is connected
 *   - manual mode:    only when the GM advances it from the console
 *   All work goes through a serial queue so ticks and company syncs never interleave.
 */

import {
  DEFAULT_MODEL_CONFIG, createInitialState, addCompanyToState, stepMarket, ticksDue, realTimeDue, dayIndex, dayOf, addTime, minutesToDays,
  appendClose, pruneHistory, replaceLastClose, splitState, mergeState, pruneState,
  normalizeControls, resolveControls, pruneControls, dropImpacts, collectImpacts,
  makeFundState, stepFundState, refreshFundState, rebaseFundState, fundPrices, truncateHistory, restoreExpired, logEntry,
  fundTargets, rebalanceDue, applyRebalance, distributionDue, applyDistribution,
} from '../engine/index.js';
import { MODULE_ID, SETTINGS, HOOKS } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { MarketClock } from './MarketClockService.js';

const CLOCK_POLL_MS = 15_000;
const MAX_MANUAL_TICKS = 365;
/** How many ticks back the snapshot ring buffer remembers. Undo only ever steps back one at a time. */
export const SNAPSHOT_CAP = 5;

class TickServiceImpl {
  constructor() {
    this._queue = Promise.resolve();
    this._started = false;
    /** Days the market is ahead of the calendar that the GM has already been told about. */
    this._notedAhead = 0;
    /** Has a player's money moved because of this tick? Set by the portfolio system; an undo is refused if so. */
    this._settledCheck = () => false;
  }

  /** Let the portfolio system say whether a tick can still be undone. */
  setSettledCheck(fn) {
    this._settledCheck = fn;
  }

  /** Begin watching the clock. Safe to call on every client; only the active GM acts. */
  start() {
    if (this._started) return;
    this._started = true;
    Hooks.on('updateWorldTime', () => this.checkClock());
    // Simple Calendar announces its own date changes, which also covers a rolled-back date.
    Hooks.on('simple-calendar-date-time-change', () => this.checkClock());
    setInterval(() => this.checkClock(), CLOCK_POLL_MS);
    this.checkClock();
  }

  _enqueue(fn) {
    this._queue = this._queue.then(fn).catch((error) => log.error('Tick service task failed', error));
    return this._queue;
  }

  get mode() {
    return game.settings.get(MODULE_ID, SETTINGS.TICK_MODE);
  }

  /**
   * How many game days one tick covers: the tick interval as a fraction of a day in the in-world
   * clock mode, and a whole day in the day and manual modes. Everything that lasts "days" (a gig's
   * delay, a sentiment bias, a heat window) is measured in game days, so it does not depend on this.
   */
  get tickDays() {
    if (this.mode !== 'realTime') return 1;
    return minutesToDays(Math.max(1, Number(game.settings.get(MODULE_ID, SETTINGS.REAL_TIME_MINUTES)) || 10));
  }

  /** Look at the clock and run any ticks that are due. */
  checkClock() {
    if (!isActiveGM()) return Promise.resolve();
    return this._enqueue(() => this._checkClock());
  }

  /** Add or remove companies in the market to match the journals. */
  syncCompanies() {
    if (!isActiveGM()) return Promise.resolve();
    return this._enqueue(() => this._sync());
  }

  /** GM-triggered ticks, regardless of tick mode. */
  advance(ticks = 1) {
    if (!isActiveGM()) {
      ui.notifications.warn(game.i18n.localize('NCI.Errors.NotActiveGM'));
      return Promise.resolve();
    }
    const n = Math.min(MAX_MANUAL_TICKS, Math.max(1, Math.floor(ticks)));
    return this._enqueue(async () => {
      await this._sync();
      if (!MarketStore.hasState()) return;
      await this._runTicks(n, MarketStore.getPublic().lastDay ?? dayIndex(MarketClock.nowMs()));
    });
  }

  /**
   * GM-triggered: move game time on by whole days, each as one day-sized tick. In the day and manual
   * modes this is the same as `advance`; in the in-world clock mode it saves pressing the tick
   * button a hundred and forty-four times a day.
   */
  advanceDays(days = 1) {
    if (!isActiveGM()) {
      ui.notifications.warn(game.i18n.localize('NCI.Errors.NotActiveGM'));
      return Promise.resolve();
    }
    const n = Math.min(MAX_MANUAL_TICKS, Math.max(1, Math.floor(days)));
    return this._enqueue(async () => {
      await this._sync();
      if (!MarketStore.hasState()) return;
      await this._runTicks(n, MarketStore.getPublic().lastDay ?? dayIndex(MarketClock.nowMs()), undefined, 1);
    });
  }

  /**
   * Change the GM's market controls (biases, impacts, forced regime...) in step with ticking.
   * @param {(controls: object, info: {tick: number, dt: number, tickIndex: number}) => object} fn - returns the new
   *        controls. `tick` is the market clock in game days and `dt` the days one tick covers.
   */
  updateControls(fn) {
    if (!isActiveGM()) return Promise.resolve();
    return this._enqueue(async () => {
      await MarketStore.setControls(fn(normalizeControls(MarketStore.getControls()), {
        tick: MarketStore.time(), dt: this.tickDays, tickIndex: MarketStore.getPublic().tickIndex ?? 0,
      }));
      Hooks.callAll(HOOKS.MARKET_UPDATED);
    });
  }

  /**
   * Change the engine state and history directly (splits, GM price changes).
   * @param {(ctx: {state: object, history: object, tick: number}) => ({state?: object, history?: object} | void)} fn
   */
  mutateState(fn) {
    if (!isActiveGM()) return Promise.resolve();
    return this._enqueue(async () => {
      await this._sync();
      const pub = MarketStore.getPublic();
      if (!pub.schema) return;
      const state = mergeState(pub, MarketStore.getHidden());
      const history = MarketStore.getHistory();
      const out = (await fn({ state, history, tick: state.time ?? state.tickIndex })) ?? {};
      const next = out.state ?? state;
      const f = this._fundStates({ state: next, prevFunds: pub.funds ?? {}, history: out.history ?? history, mode: 'refresh' });
      await this._dropSnapshots();
      await this._write(next, pub.lastDay ?? null, f.history, f.funds);
    });
  }

  /** Can the last tick be undone (as far as the market itself goes)? */
  undoAvailable() {
    const pub = MarketStore.getPublic();
    const snap = MarketStore.getSnapshots().at(-1);
    return !!pub.schema && !!snap && snap.tickIndex === (pub.tickIndex ?? 0) - 1;
  }

  /**
   * Step the market back one tick: prices, funds, history and the controls the tick used up. The
   * clock is left alone, so a world-time market does not simply tick again at once; advancing later
   * re-simulates the tick (the same random numbers, so the same result unless the GM has changed
   * the controls in between).
   * @param {(tickIndex: number) => (boolean|Promise<boolean>)} [isSettled] - true when player money
   *        has already moved because of that tick, which would make an undo inconsistent
   * @returns {Promise<{ok: boolean, reason?: string, tickIndex?: number}>}
   */
  undoLastTick(isSettled = this._settledCheck) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, reason: 'not-active-gm' });
    return this._enqueue(() => this._undoOne({ isSettled, moveClock: false }));
  }

  /**
   * Undo one tick inside the queue. `moveClock` also moves the market's day back by one, which is
   * what the calendar does when it is rolled back; a GM's own undo leaves the day alone.
   */
  async _undoOne({ isSettled, moveClock }) {
    const pub = MarketStore.getPublic();
    const snaps = MarketStore.getSnapshots();
    const snap = snaps.at(-1);
    const undone = pub.tickIndex ?? 0;
    if (!pub.schema || !snap || snap.tickIndex !== undone - 1) return { ok: false, reason: 'nothing-to-undo' };
    // Money is stamped with the market clock, so ask about the clock time of the tick being undone.
    const undoneTime = MarketStore.time();
    if (await isSettled(undoneTime)) return { ok: false, reason: 'settled' };

    const before = snap.state.time ?? snap.tickIndex;
    const controls = logEntry(
      restoreExpired(MarketStore.getControls(), snap.controls, undoneTime, undoneTime - before || 1),
      { ts: Date.now(), tick: snap.tickIndex, kind: 'undo', from: undone, to: snap.tickIndex },
    );
    await MarketStore.setControls(controls);
    const day = moveClock && pub.lastDay != null ? pub.lastDay - 1 : (pub.lastDay ?? null);
    // The day's close is the last price of the day, so after the cut it goes back to the earlier price.
    let history = truncateHistory(MarketStore.getHistory(), dayOf(before));
    for (const [id, c] of Object.entries(snap.state.companies)) history = replaceLastClose(history, id, c.price);
    for (const [id, f] of Object.entries(snap.funds ?? {})) history = replaceLastClose(history, id, f.nav);
    await this._write(snap.state, day, history, snap.funds);
    await MarketStore.setSnapshots(snaps.slice(0, -1));
    Hooks.callAll(HOOKS.MARKET_UPDATED);
    log.info(`Undid tick ${undone}; the market is back at tick ${snap.tickIndex}`);
    return { ok: true, tickIndex: snap.tickIndex };
  }

  /**
   * The calendar has been rolled back to before the market's last tick. Undo as many ticks as there
   * are days to give back, as far as the snapshots and the players' money allow. Whatever cannot be
   * undone leaves the market ahead of the calendar, and it does not tick again until the calendar
   * has caught up (`ticksDue` returns nothing while the market is ahead).
   */
  async _rollBack(ahead) {
    let undone = 0;
    while (undone < ahead) {
      const out = await this._undoOne({ isSettled: this._settledCheck, moveClock: true });
      if (!out.ok) break;
      undone++;
    }
    const remaining = ahead - undone;
    if (undone || remaining !== this._notedAhead) {
      const key = remaining ? (undone ? 'NCI.Clock.RolledBackAhead' : 'NCI.Clock.Ahead') : 'NCI.Clock.RolledBack';
      ui.notifications.info(game.i18n.format(key, { n: undone, ahead: remaining, tick: MarketStore.getPublic().tickIndex ?? 0 }));
    }
    this._notedAhead = remaining;
    return { undone, remaining };
  }

  /** The state before an undoable tick no longer matches the market (a split, a price change, a new company). */
  async _dropSnapshots() {
    if (MarketStore.getSnapshots().length) await MarketStore.setSnapshots([]);
  }

  /**
   * Store a fund definition and bring its state in line, inside the tick queue. An edit to an
   * existing fund keeps its NAV where it is (the divisor is rebased), so editing never moves the price.
   */
  saveFund(def) {
    if (!isActiveGM()) return Promise.resolve();
    return this._enqueue(async () => {
      await this._sync();
      const pub = MarketStore.getPublic();
      const prev = pub.funds?.[def.id];
      if (!pub.schema || !prev) {
        await FundRepository.put(def);
        await this._sync();
        return;
      }
      const state = mergeState(pub, MarketStore.getHidden());
      const { prices } = this._fundContext(state);
      // An edit also sets the value mix the fund will rebalance back to.
      const stored = { ...def, targets: fundTargets(def, prices) };
      await FundRepository.put(stored);
      const funds = { ...pub.funds, [def.id]: rebaseFundState(prev, stored, prices) };
      await this._dropSnapshots();
      await this._write(state, pub.lastDay ?? null, MarketStore.getHistory(), funds);
    });
  }

  /** Wipe the market and start again from each company's initial price, with a new seed. */
  reset() {
    if (!isActiveGM()) return Promise.resolve();
    return this._enqueue(async () => {
      await MarketStore.clearAll();
      await game.settings.set(MODULE_ID, SETTINGS.WORLD_SEED, foundry.utils.randomID(16));
      await this._sync();
      log.info('Market reset');
    });
  }

  async _checkClock() {
    if (!isActiveGM()) return;
    const mode = this.mode;
    if (mode === 'manual') return;

    await this._sync();
    if (!MarketStore.hasState()) return;

    if (mode === 'realTime') {
      const pub = MarketStore.getPublic();
      const minutes = Math.max(1, Number(game.settings.get(MODULE_ID, SETTINGS.REAL_TIME_MINUTES)) || 10);
      const due = realTimeDue({ lastDay: pub.lastDay ?? null, lastMs: pub.lastMs ?? null, nowMs: MarketClock.nowMs(), intervalMs: minutes * 60_000 });
      if (due.resync) {
        if (pub.lastDay !== due.day || pub.lastMs !== due.ms) await MarketStore.setPublic({ ...pub, lastDay: due.day, lastMs: due.ms });
        return;
      }
      if (due.skipped) log.warn(`Market skipped ${due.skipped} steps of a calendar jump; simulating the most recent ones`);
      if (due.dayTicks > 0) await this._runTicks(due.dayTicks, due.day, due.ticks > 0 ? undefined : due.ms, 1);
      if (due.ticks > 0) await this._runTicks(due.ticks, due.day, due.ms);
      // A date that changed with no tick due still gives the market its new date.
      if (!due.dayTicks && !due.ticks && pub.lastDay !== due.day) await MarketStore.setPublic({ ...pub, lastDay: due.day });
      return;
    }

    const pub = MarketStore.getPublic();
    const due = ticksDue({ lastDay: pub.lastDay ?? null, nowMs: MarketClock.nowMs() });
    if (due.rebaseline) {
      await MarketStore.setPublic({ ...pub, lastDay: due.day });
      return;
    }
    if (due.ahead > 0) {
      await this._rollBack(due.ahead);
      return;
    }
    this._notedAhead = 0;
    if (due.skipped) log.warn(`Market skipped ${due.skipped} days; simulating the most recent ${due.ticks}`);
    if (due.ticks > 0) await this._runTicks(due.ticks, due.day);
  }

  async _seed() {
    let seed = game.settings.get(MODULE_ID, SETTINGS.WORLD_SEED);
    if (!seed) {
      seed = foundry.utils.randomID(16);
      await game.settings.set(MODULE_ID, SETTINGS.WORLD_SEED, seed);
    }
    return seed;
  }

  async _sync() {
    if (!isActiveGM()) return;
    const companies = CompanyRepository.all({ includeUnlisted: true });
    const pub = MarketStore.getPublic();

    if (!pub.schema) {
      if (!companies.length) return;
      await this._seed();
      await MarketStore.ensureControlJournal();
      const state = createInitialState({ companies });
      let history = MarketStore.getHistory();
      for (const c of companies) history = appendClose(history, c.id, 0, state.companies[c.id].price);
      await this._ensureTargets(state);
      const f = this._fundStates({ state, prevFunds: {}, history, mode: 'sync' });
      await this._write(state, dayIndex(MarketClock.nowMs()), f.history, f.funds, MarketClock.nowMs());
      log.info(`Market created with ${companies.length} companies`);
      return;
    }

    let state = mergeState(pub, MarketStore.getHidden());
    let history = MarketStore.getHistory();
    const ids = companies.map((c) => c.id);
    const prevFunds = pub.funds ?? {};
    let changed = false;

    for (const c of companies) {
      if (state.companies[c.id]) continue;
      state = addCompanyToState(state, c);
      history = appendClose(history, c.id, dayOf(state.time), state.companies[c.id].price);
      changed = true;
    }
    if (Object.keys(state.companies).some((id) => !ids.includes(id))) {
      state = pruneState(state, ids);
      changed = true;
    }

    await this._ensureTargets(state);
    const f = this._fundStates({ state, prevFunds, history, mode: 'sync' });
    history = pruneHistory(f.history, [...ids, ...Object.keys(f.funds)]);
    const fundsChanged = Object.keys(f.funds).sort().join() !== Object.keys(prevFunds).sort().join();
    if (changed || fundsChanged) {
      await this._dropSnapshots();
      await this._write(state, pub.lastDay ?? null, history, f.funds);
    }
  }

  /** Funds' view of the market: company prices, with a bankrupt company worth nothing. */
  _fundContext(state) {
    const companies = CompanyRepository.all({ includeUnlisted: true });
    const byId = Object.fromEntries(companies.map((c) => [c.id, c]));
    const raw = Object.fromEntries(Object.entries(state.companies).map(([id, c]) => [id, c.price]));
    return { defs: FundRepository.all(), byId, prices: fundPrices(raw, byId) };
  }

  /**
   * Bring fund states in line with the market.
   *   sync:    create missing funds at their initial NAV, drop removed ones
   *   refresh: recompute NAVs for new prices (after a split or a GM price change); no time passes
   *   step:    one tick: dividends accrue in, the expense ratio comes out, the manager's alpha is added,
   *            a due rebalance is made, and a close is recorded
   * @param {object[]} [o.defs] - fund definitions to use instead of the stored ones (a rebalance earlier in the same run)
   * @returns {{funds: object, history: object, defs: object[], rebalanced: object[]}}
   */
  _fundStates({ state, prevFunds, history, mode, defs: given = null, dt = 1, newDay = true }) {
    const ctx = this._fundContext(state);
    const { byId, prices } = ctx;
    const defs = given ?? ctx.defs;
    const funds = {};
    const nextDefs = [];
    const rebalanced = [];
    let h = history;
    for (const def of defs) {
      const prev = prevFunds[def.id];
      let current = def;
      if (!prev) {
        funds[def.id] = makeFundState(def, prices);
        h = appendClose(h, def.id, dayOf(state.time), funds[def.id].nav);
      } else if (mode === 'step') {
        let next = stepFundState(prev, def, prices, byId, { dt, newDay });
        const due = rebalanceDue(def, next, MarketClock.date());
        if (due.due) {
          const out = applyRebalance(def, next, prices, due.key);
          current = out.fund;
          next = out.state;
          rebalanced.push(current);
        } else if (due.mark) {
          next = { ...next, rebalanceKey: due.mark };
        }
        const dist = distributionDue(def, next, MarketClock.date());
        if (dist.due) next = applyDistribution(next, dist.key, state.time);
        else if (dist.mark) next = { ...next, distKey: dist.mark };
        funds[def.id] = next;
        h = appendClose(h, def.id, dayOf(state.time), funds[def.id].nav);
      } else if (mode === 'refresh') {
        funds[def.id] = refreshFundState(prev, def, prices);
        h = replaceLastClose(h, def.id, funds[def.id].nav);
      } else {
        funds[def.id] = prev;
      }
      nextDefs.push(current);
    }
    return { funds, history: h, defs: nextDefs, rebalanced };
  }

  /** Give every fund the value mix it will rebalance back to, if it has none yet. */
  async _ensureTargets(state) {
    const { defs, prices } = this._fundContext(state);
    for (const def of defs) {
      if (!def.targets) await FundRepository.put({ ...def, targets: fundTargets(def, prices) });
    }
  }

  async _runTicks(n, day, ms, dtOverride = null) {
    const companies = CompanyRepository.all({ includeUnlisted: true });
    if (!companies.length) return;
    const seed = await this._seed();
    let state = mergeState(MarketStore.getPublic(), MarketStore.getHidden());
    let history = MarketStore.getHistory();
    let controls = normalizeControls(MarketStore.getControls());
    let funds = MarketStore.getPublic().funds ?? {};
    let defs = null;
    const rebalancedDefs = new Map();

    let last = null;
    let newDay = false;
    const startDay = dayOf(state.time);
    const dt = dtOverride ?? this.tickDays;
    const snapshots = [];
    for (let i = 0; i < n; i++) {
      snapshots.push({ tickIndex: state.tickIndex, time: state.time, state, funds, controls });
      const time = addTime(state.time, dt);
      const impacts = collectImpacts(controls.impacts, companies, time, dt);
      last = stepMarket({
        state, companies, seed, config: DEFAULT_MODEL_CONFIG, controls: resolveControls(controls, time, dt), impacts, dt,
      });
      state = last.state;
      newDay ||= last.newDay;
      controls = pruneControls(dropImpacts(controls, impacts.expired), time, dt);
      for (const [id, s] of Object.entries(state.companies)) {
        history = appendClose(history, id, dayOf(state.time), s.price);
      }
      const f = this._fundStates({ state, prevFunds: funds, history, mode: 'step', defs, dt, newDay: last.newDay });
      funds = f.funds;
      history = f.history;
      defs = f.defs;
      for (const def of f.rebalanced) rebalancedDefs.set(def.id, def);
    }

    // A rebalance changes a fund's definition, which a snapshot does not hold, so it cannot be undone.
    for (const def of rebalancedDefs.values()) await FundRepository.put(def);
    await MarketStore.setControls(controls);
    await this._write(state, day, history, funds, ms);
    if (rebalancedDefs.size) await this._dropSnapshots();
    else await MarketStore.setSnapshots([...MarketStore.getSnapshots(), ...snapshots].slice(-SNAPSHOT_CAP));
    Hooks.callAll(HOOKS.PRICE_TICK, {
      tickIndex: state.tickIndex, time: state.time, ticks: n, dt, newDay, days: dayOf(state.time) - startDay, results: last?.results ?? {},
    });
    log.debug(`Advanced ${n} tick(s) to ${state.tickIndex}`);
  }

  /**
   * Write history and hidden state first, public state last, so listeners see consistent data.
   * `ms` is when the last tick happened on the in-world clock (real-time mode); left out, it is kept.
   */
  async _write(state, day, history, funds, ms) {
    const { pub, hidden } = splitState(state, day);
    pub.funds = funds ?? MarketStore.getPublic().funds ?? {};
    pub.lastMs = ms !== undefined ? ms : (MarketStore.getPublic().lastMs ?? null);
    await MarketStore.setHistory(history);
    await MarketStore.setHidden(hidden);
    await MarketStore.setPublic(pub);
  }
}

export const TickService = new TickServiceImpl();
