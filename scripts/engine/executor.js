/**
 * Request executor
 * @file scripts/engine/executor.js
 * @description Pure logic the GM client runs on a player's requests and on each tick. Given a
 *              portfolio and inputs it returns a new portfolio, the new wealth, results and events.
 *              No Foundry globals.
 *
 * Requests (from the player's outbox, or built from a broker mail):
 *   { key, type: 'deposit', amount }
 *   { key, type: 'withdraw', amount }                 broker-paid if a broker is assigned, else direct
 *   { key, type: 'cancelWithdrawal', withdrawalId }
 *   { key, type: 'placeOrder', route, side, assetId, qty, orderType, limit?, expiry? }
 *   { key, type: 'cancelOrder', orderId }
 *   { key, type: 'setBroker', brokerId }              null clears
 *   { key, type: 'connectTerminal' }                  open a direct-trading session (needs a check)
 *   { key, type: 'disconnectTerminal', reason? }      the player left CorpNet: end a session that came from it
 *   { key, type: 'setDrip', assetId, enabled }
 *   { key, type: 'subscribeIpo', assetId, qty }       reserve cash for an IPO offer (see ipo.js)
 *   { key, type: 'setAlert', assetId, kind, value, once }   a price alert (see alerts.js)
 *   { key, type: 'removeAlert', alertId }
 *   { key, type: 'requestStatement' }                 ask for a statement by mail (built by the GM service)
 *
 * `market` maps assetId -> { listed, active, price, liquidity, kind?: 'fund', fund?: {loadBps, exitBps, minBuy}, ipo?: {open, price} }.
 *
 * `settings`:
 *   mode      'terminal' (direct trading needs a live terminal session) | 'open' (legacy: anyone may trade directly)
 *   direct    { commissionBps, flatFee }              the direct-trade fee profile
 *   brokers   { [contactId]: { available, terms, minWithdrawal? } }   terms from brokerTerms()
 *   access    { sessionTicks, lockoutTicks }
 *   checks    { [requestKey]: { access:{ok, reason?, source}, stat, level, dv, roll, terminalId? } }
 *             built by the GM service from the real dice; the executor never trusts a request's own numbers
 *   depositFee, seed, settlementDays, dt (game days one tick covers; 1 when omitted)
 *   Legacy shape (no `mode`): { depositFee, feeProfile, instant } behaves as mode 'open'.
 */

import { quote } from './quotes.js';
import { pathRange } from './pricePath.js';
import { TIME_EPS } from './clock.js';
import { checkTrigger, validateOrder, executeFill, computeFees } from './orderEngine.js';
import { planDeposit, planDirectWithdrawal } from './cash.js';
import { brokerTermsFeeProfile, fundOrderPrice } from './executorSupport.js';
import { pickLatency } from './brokerTerms.js';
import { evaluateCheck, planSession, sessionActive, lockedOut } from './checks.js';
import { holdWithdrawal, refundWithdrawal } from './withdrawals.js';
import { planSubscription } from './ipo.js';
import { planAlert, removeAlert } from './alerts.js';
import { runHeatAction } from './heatActions.js';
import { isFrozen, brokerBanned } from './heatPenalty.js';
import {
  normalizePortfolio, trimPortfolio, estimateOrder, committedCash, reservedShares, releaseSettled, OPEN, PROCESSED_CAP,
} from './portfolioModel.js';

export const GTC_TICKS = 90;
export const ORDER_TYPES = ['market', 'limit', 'stop'];
export const EXPIRIES = ['day', 'gtc'];
export const ROUTES = ['direct', 'broker'];
/** Extra room reserved on a fund buy, because broker timing can move the price against the client. */
export const FUND_RESERVE_BUFFER = 0.0075;

const orderIdFor = (key) => `o_${key}`;
const modeOf = (settings) => settings.mode ?? 'open';
const directProfile = (settings) => settings.direct ?? settings.feeProfile ?? {};
const brokerFor = (p, settings) => {
  const b = p.brokerContactId ? settings.brokers?.[p.brokerContactId] : null;
  return b?.available ? b : null;
};

/** A character the authorities are watching waits longer and pays more for a broker (see heatPenalty.js). */
const brokerLatency = (terms, settings, key) => pickLatency(terms, settings.seed ?? 'nci', key) + (settings.scrutiny?.latencyAdd ?? 0);
const brokerProfile = (terms, settings) => {
  const profile = brokerTermsFeeProfile(terms);
  const mult = settings.scrutiny?.feeMult ?? 1;
  return mult === 1 ? profile : { ...profile, commissionBps: Math.round(profile.commissionBps * mult * 100) / 100 };
};

function recordResult(p, request, tick, result) {
  return {
    ...p,
    processed: [...p.processed, request.key].slice(-PROCESSED_CAP),
    results: [...p.results, { key: request.key, type: request.type, tick, ...result }],
  };
}

/**
 * Walk open orders that are eligible this tick and fill, reject or expire them.
 * @param {object} o
 * @param {string[]} [o.onlyIds] - restrict to these order ids (used for instant execution)
 * @param {object} [o.feeProfile] - fallback fee profile for orders that carry none
 * @param {number} [o.settleDays] - sale proceeds wait this many ticks (funds can wait longer: their own redemption delay)
 * @param {object} [o.path] - the prices along the run of ticks just made (pricePath.js), so a limit or stop reached during it fills
 * @returns {{portfolio: object, events: object[]}}
 */
export function runOrders({ portfolio, tick, market, feeProfile = {}, onlyIds = null, seed = 'nci', settleDays = 0, path = null }) {
  let p = normalizePortfolio(portfolio);
  const events = [];

  const due = p.orders
    .filter((o) => o.status === OPEN && tick >= o.eligibleTick - TIME_EPS && (!onlyIds || onlyIds.includes(o.id)))
    .sort((a, b) => a.submittedTick - b.submittedTick || (a.id < b.id ? -1 : 1));

  const close = (order, patch) => {
    p = { ...p, orders: p.orders.map((x) => (x.id === order.id ? { ...x, status: patch.status, ...patch } : x)) };
  };
  const reject = (order, reason) => {
    close(order, { status: 'rejected', reason, closedTick: tick });
    events.push({ type: 'orderRejected', orderId: order.id, assetId: order.assetId, side: order.side, qty: order.qty, route: order.route, reason });
  };

  for (const order of due) {
    const asset = market[order.assetId];
    if (!asset?.active) {
      reject(order, 'halted');
      continue;
    }

    const isFund = asset.kind === 'fund';
    let price;
    let timingBps = null;

    if (isFund) {
      const priced = fundOrderPrice({ order, asset, seed });
      price = priced.price;
      timingBps = priced.timingBps;
    } else {
      // Only the part of the run while the order was live counts.
      const range = path ? pathRange(path, order.assetId, order.eligibleTick, order.expiresTick ?? Infinity) : null;
      const trig = checkTrigger(order, quote(asset.price, asset.liquidity), range);
      if (!trig.triggered) {
        if (tick >= order.expiresTick - TIME_EPS) {
          close(order, { status: 'expired', closedTick: tick });
          events.push({ type: 'orderExpired', orderId: order.id, assetId: order.assetId, side: order.side, qty: order.qty, route: order.route });
        }
        continue;
      }
      price = trig.price;
    }

    const profile = order.feeProfile ?? feeProfile;
    const gross = Math.round(order.qty * price);
    const fees = computeFees(gross, profile);
    const check = validateOrder({
      order,
      price,
      cash: p.cash,
      lots: p.lots,
      fees,
      minOrder: isFund && order.side === 'buy' ? (asset.fund?.minBuy ?? 0) : 0,
      reservedQty: reservedShares(p.orders, order.assetId, order.id),
    });
    if (!check.ok) {
      reject(order, check.reason);
      continue;
    }

    const fill = executeFill({
      portfolio: p, order, price, fees, tick, lotId: `lot_${order.id}`,
      settleTicks: order.side === 'sell' ? Math.max(settleDays, isFund ? (asset.fund?.redeemDelay ?? 0) : 0) : 0,
    });
    if (!fill.ok) {
      reject(order, fill.reason);
      continue;
    }

    p = fill.portfolio;
    p = { ...p, stats: { ...p.stats, realized: p.stats.realized + (fill.realized ?? 0) } };
    close(order, {
      status: 'filled', filledTick: tick, closedTick: tick, fillPrice: price, fees, realized: fill.realized, timingBps,
    });
    events.push({
      type: 'orderFilled',
      orderId: order.id,
      side: order.side,
      assetId: order.assetId,
      assetType: order.assetType,
      route: order.route,
      brokerId: order.brokerId ?? null,
      qty: order.qty,
      price,
      gross: fill.gross,
      fees,
      realized: fill.realized,
      timingBps,
      settleDays: fill.settleTicks ?? 0,
    });
  }

  return { portfolio: p, events };
}

function placeOrder({ p, request, tick, market, settings }) {
  const mode = modeOf(settings);
  const side = request.side;
  const orderType = request.orderType ?? 'market';
  const expiry = request.expiry ?? 'day';
  const qty = Number(request.qty);
  const limit = request.limit === undefined || request.limit === null ? null : Number(request.limit);
  const fail = (reason) => ({ p, result: { ok: false, reason } });

  const route = request.route ?? (mode === 'open' ? 'direct' : null);
  if (!ROUTES.includes(route)) return fail('invalid-route');
  if (side !== 'buy' && side !== 'sell') return fail('invalid-side');
  if (!ORDER_TYPES.includes(orderType) || !EXPIRIES.includes(expiry)) return fail('invalid-order');
  if (!Number.isInteger(qty) || qty <= 0) return fail('invalid-qty');
  if (orderType !== 'market' && !(limit > 0)) return fail('invalid-limit');
  if (isFrozen(p, tick)) return fail('account-frozen');

  const asset = market[request.assetId];
  if (!asset?.listed) return fail('unknown-asset');
  if (!asset.active) return fail('halted');
  const isFund = asset.kind === 'fund';

  // Funds are a broker's job: no direct dealing, and only at the day's NAV.
  if (isFund && route === 'direct') return fail('fund-needs-broker');
  if (isFund && orderType !== 'market') return fail('fund-market-only');

  let profile;
  let eligibleTick;
  let broker = null;

  if (route === 'direct') {
    if (mode === 'terminal') {
      if (!sessionActive(p, tick)) return fail('no-terminal-session');
      eligibleTick = tick;
    } else {
      eligibleTick = settings.instant ? tick : tick + (settings.dt ?? 1);
    }
    profile = directProfile(settings);
  } else {
    broker = brokerFor(p, settings);
    if (!broker) return fail('no-broker');
    eligibleTick = tick + brokerLatency(broker.terms, settings, request.key);
    profile = brokerProfile(broker.terms, settings);
  }

  let est;
  if (isFund) {
    const unit = asset.price * (1 + ((asset.fund?.loadBps ?? 0) / 10000) + FUND_RESERVE_BUFFER);
    est = estimateOrder({ side, qty, price: side === 'buy' ? unit : asset.price, feeProfile: profile });
    if (side === 'buy' && est.gross < (asset.fund?.minBuy ?? 0)) return fail('below-minimum');
  } else {
    const q = quote(asset.price, asset.liquidity);
    const refPrice = orderType === 'limit' && side === 'buy' ? Math.max(limit, q.ask) : q.ask;
    est = estimateOrder({ side, qty, price: side === 'buy' ? refPrice : q.bid, feeProfile: profile });
  }

  if (side === 'buy') {
    if (p.cash - committedCash(p.orders) < est.total) return fail('insufficient-funds');
  } else {
    const held = p.lots.filter((l) => l.assetId === request.assetId).reduce((s, l) => s + l.qty, 0);
    if (held - reservedShares(p.orders, request.assetId) < qty) return fail('insufficient-shares');
  }

  const order = {
    id: orderIdFor(request.key),
    side,
    assetType: isFund ? 'fund' : 'stock',
    assetId: request.assetId,
    qty,
    type: orderType,
    limit: orderType === 'market' ? null : limit,
    expiry,
    route,
    brokerId: broker ? p.brokerContactId : null,
    feeProfile: profile,
    terms: broker && isFund
      ? { loadRebate: broker.terms.loadRebate, timingMeanBps: broker.terms.timingMeanBps, timingSigmaBps: broker.terms.timingSigmaBps }
      : null,
    status: OPEN,
    submittedTick: tick,
    eligibleTick,
    expiresTick: expiry === 'gtc' ? eligibleTick + GTC_TICKS : eligibleTick + (eligibleTick === tick ? 1 : 0),
    reserve: side === 'buy' ? est.total : 0,
  };
  return { p: { ...p, orders: [...p.orders, order] }, result: { ok: true, orderId: order.id, route, eligibleTick }, order };
}

function cancelOrder({ p, request, tick }) {
  const order = p.orders.find((o) => o.id === request.orderId && o.status === OPEN);
  if (!order) return { p, result: { ok: false, reason: 'not-found' } };
  return {
    p: { ...p, orders: p.orders.map((o) => (o.id === order.id ? { ...o, status: 'cancelled', closedTick: tick } : o)) },
    result: { ok: true, orderId: order.id },
  };
}

function withdraw({ p, w, request, tick, settings }) {
  const amount = Number(request.amount);
  const broker = brokerFor(p, settings);
  if (isFrozen(p, tick)) return { p, w, result: { ok: false, reason: 'account-frozen' } };

  if (broker) {
    const latency = brokerLatency(broker.terms, settings, request.key);
    const fee = computeFees(amount, brokerProfile(broker.terms, settings));
    const held = holdWithdrawal({
      portfolio: p, key: request.key, amount, fee, brokerId: p.brokerContactId, tick, latency, minWithdrawal: broker.minWithdrawal ?? 0,
    });
    if (!held.ok) return { p, w, result: { ok: false, reason: held.reason } };
    return { p: held.portfolio, w, result: { ok: true, amount, fee, pending: true, releaseTick: held.withdrawal.releaseTick, withdrawalId: held.withdrawal.id } };
  }

  const plan = planDirectWithdrawal({ wealth: w, cash: p.cash, amount });
  if (!plan.ok) return { p, w, result: { ok: false, reason: plan.reason } };
  return {
    p: {
      ...p,
      cash: plan.cash,
      ledger: [...p.ledger, { ts: tick, kind: 'withdraw', assetId: null, qty: 0, amount: -amount, ref: request.key }],
    },
    w: plan.wealth,
    result: { ok: true, amount },
  };
}

function connectTerminal({ p, request, tick, settings }) {
  if (modeOf(settings) !== 'terminal') return { p, result: { ok: false, reason: 'not-required' } };
  if (lockedOut(p, tick)) return { p, result: { ok: false, reason: 'locked-out', lockoutUntilTick: p.lockoutUntilTick } };
  if (sessionActive(p, tick)) return { p, result: { ok: true, passed: true, already: true, validThroughTick: p.session.validThroughTick } };

  const supplied = settings.checks?.[request.key];
  if (!supplied) return { p, result: { ok: false, reason: 'no-terminal' } };
  if (!supplied.access?.ok) return { p, result: { ok: false, reason: supplied.access?.reason ?? 'no-terminal' } };

  const check = evaluateCheck({ stat: supplied.stat, level: supplied.level, roll: supplied.roll, dv: supplied.dv });
  const plan = planSession({
    check,
    tick,
    sessionTicks: settings.access?.sessionTicks ?? 1,
    lockoutTicks: settings.access?.lockoutTicks ?? 1,
    dt: settings.dt ?? 1,
    source: supplied.access.source,
    terminalId: supplied.terminalId ?? null,
  });
  const detail = { total: check.total, dv: check.dv, base: check.base, rolls: supplied.roll.rolls ?? [supplied.roll.total], crit: check.crit };

  if (plan.passed) {
    return { p: { ...p, session: plan.session }, result: { ok: true, passed: true, validThroughTick: plan.session.validThroughTick, ...detail } };
  }
  return { p: { ...p, lockoutUntilTick: plan.lockoutUntilTick }, result: { ok: true, passed: false, lockoutUntilTick: plan.lockoutUntilTick, ...detail } };
}

/**
 * Apply a batch of requests. Already-processed keys are skipped, so replays are harmless.
 * @param {object} o
 * @param {object} o.portfolio
 * @param {object[]} o.requests
 * @param {number} o.wealth - the actor's current CPR wealth
 * @param {number} o.tick
 * @returns {{portfolio: object, wealth: number, events: object[], changed: boolean}}
 */
export function applyRequests({ portfolio, requests, wealth, tick, market, settings }) {
  let p = releaseSettled(normalizePortfolio(portfolio), tick).portfolio;
  let w = wealth;
  const events = [];
  let changed = false;

  for (const request of requests ?? []) {
    if (!request?.key || p.processed.includes(request.key)) continue;
    changed = true;
    let result;

    switch (request.type) {
      case 'deposit': {
        const fee = settings.depositFee ?? 0;
        const plan = planDeposit({ wealth: w, cash: p.cash, amount: Number(request.amount), fee });
        if (!plan.ok) {
          result = { ok: false, reason: plan.reason };
          break;
        }
        w = plan.wealth;
        const amount = Number(request.amount);
        const ledger = [...p.ledger, { ts: tick, kind: 'deposit', assetId: null, qty: 0, amount, ref: request.key }];
        if (fee) ledger.push({ ts: tick, kind: 'fee', assetId: null, qty: 0, amount: -fee, ref: request.key });
        p = { ...p, cash: plan.cash, ledger };
        result = { ok: true, amount };
        break;
      }
      case 'withdraw': {
        const out = withdraw({ p, w, request, tick, settings });
        p = out.p;
        w = out.w;
        result = out.result;
        break;
      }
      case 'cancelWithdrawal': {
        const refunded = refundWithdrawal(p, request.withdrawalId, tick, 'cancelled');
        if (refunded.ok) p = refunded.portfolio;
        result = refunded.ok ? { ok: true, withdrawalId: request.withdrawalId } : { ok: false, reason: refunded.reason };
        break;
      }
      case 'placeOrder': {
        const placed = placeOrder({ p, request, tick, market, settings });
        p = placed.p;
        result = placed.result;
        if (result.ok && placed.order.eligibleTick <= tick + TIME_EPS) {
          const run = runOrders({ portfolio: p, tick, market, onlyIds: [result.orderId], seed: settings.seed, settleDays: settings.settlementDays ?? 0 });
          p = run.portfolio;
          events.push(...run.events);
        }
        break;
      }
      case 'subscribeIpo': {
        const sub = planSubscription({
          portfolio: p, key: request.key, assetId: request.assetId, qty: request.qty, asset: market[request.assetId], tick,
        });
        if (sub.ok) p = sub.portfolio;
        result = sub.ok ? { ok: true, orderId: sub.orderId, reserve: sub.reserve } : { ok: false, reason: sub.reason };
        break;
      }
      case 'setAlert': {
        const planned = planAlert({
          portfolio: p, key: request.key, assetId: request.assetId, kind: request.kind, value: request.value, once: request.once !== false,
          asset: market[request.assetId], tick,
        });
        if (planned.ok) p = planned.portfolio;
        result = planned.ok ? { ok: true, alertId: planned.alertId } : { ok: false, reason: planned.reason };
        break;
      }
      case 'removeAlert': {
        const removed = removeAlert(p, request.alertId);
        if (removed.ok) p = removed.portfolio;
        result = removed.ok ? { ok: true } : { ok: false, reason: removed.reason };
        break;
      }
      case 'requestStatement':
        // The statement itself is built and mailed by the GM service once this result is recorded.
        result = { ok: true };
        break;
      case 'cancelOrder': {
        const cancelled = cancelOrder({ p, request, tick });
        p = cancelled.p;
        result = cancelled.result;
        break;
      }
      case 'setBroker': {
        const id = request.brokerId || null;
        if (id && !settings.brokers?.[id]?.available) {
          result = { ok: false, reason: 'unknown-broker' };
          break;
        }
        if (brokerBanned(p, id, tick)) {
          result = { ok: false, reason: 'broker-refuses' };
          break;
        }
        p = { ...p, brokerContactId: id };
        result = { ok: true, brokerId: id };
        break;
      }
      case 'heatAction': {
        const out = runHeatAction({ portfolio: p, request, tick, enabled: settings.heat?.enabled === true, supplied: settings.checks?.[request.key] });
        p = out.portfolio;
        result = out.result;
        break;
      }
      case 'connectTerminal': {
        const out = connectTerminal({ p, request, tick, settings });
        p = out.p;
        result = out.result;
        break;
      }
      case 'disconnectTerminal': {
        // Only a session opened through the network ends; one the GM granted is not tied to it.
        const ended = !!p.session && p.session.source !== 'grant';
        if (ended) {
          p = { ...p, session: null };
          events.push({ type: 'sessionEnded', reason: request.reason ?? 'no-network' });
        }
        result = { ok: true, ended };
        break;
      }
      case 'setDrip': {
        if (typeof request.assetId !== 'string' || !request.assetId) {
          result = { ok: false, reason: 'unknown-asset' };
          break;
        }
        p = { ...p, drip: { ...p.drip, [request.assetId]: !!request.enabled } };
        result = { ok: true, assetId: request.assetId, enabled: !!request.enabled };
        break;
      }
      default:
        result = { ok: false, reason: 'unknown-request' };
    }

    p = recordResult(p, request, tick, result);
  }

  return { portfolio: trimPortfolio(p), wealth: w, events, changed };
}
