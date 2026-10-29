/**
 * Player syndicates
 * @file scripts/engine/syndicate.js
 * @description A crew's shared brokerage account (DESIGN §31): members buy units with cash from
 *              their own brokerage balance, officers trade the account up to a limit, bigger
 *              decisions go to a vote by units, and members redeem units at NAV. Pure; no Foundry
 *              globals. The syndicate's portfolio is an ordinary one, so trades go through the
 *              executor: this module only says which terminal requests to run on it.
 *
 * Requests (from a member's syndicate outbox; every one but `found` names `syndicateId`):
 *   { key, type: 'found', name, invite? }
 *   { key, type: 'join' } | { key, type: 'decline' }               an invited character answers
 *   { key, type: 'deposit', amount }                               from the member's brokerage cash
 *   { key, type: 'redeem', units }                                 paid at NAV after the settlement delay
 *   { key, type: 'leave' }                                         redeem every unit and go
 *   { key, type: 'trade', request }                                officers: a terminal request (SYNDICATE_TRADES)
 *   { key, type: 'propose', kind, ... }                            see PROPOSAL_KINDS
 *   { key, type: 'vote', proposalId, yes }
 *
 * A syndicate can also be a business partner (B3b): its officers act for it through the business
 * service, which pays from and into this account. Its business stakes, at book value, count in its
 * value (`context.stakes`), and a syndicate holding any cannot be wound up.
 *
 * The books are `{ syndicate, portfolio, members }`: the record, the syndicate's own portfolio, and
 * the brokerage portfolios of its members by actor id. Every function returns new books.
 */

import { committedCash, emptyPortfolio, normalizePortfolio, valuePortfolio, OPEN } from './portfolioModel.js';

export const SYNDICATE_SCHEMA = 1;
export const SYNDICATE_STATUS = Object.freeze(['pending', 'active', 'closed']);

export const SYNDICATE_DEFAULTS = Object.freeze({
  /** Officers may place an order up to this estimated value without a vote. */
  tradeLimit: 5000,
  /** A proposal lapses after this many game days. */
  proposalDays: 7,
  /** Open proposals at once. */
  maxProposals: 6,
  ledgerCap: 120,
  maxMembers: 12,
});

/** The terminal requests an officer can make for the syndicate's account. */
export const SYNDICATE_TRADES = Object.freeze([
  'placeOrder', 'cancelOrder', 'setBroker', 'connectTerminal', 'disconnectTerminal', 'setDrip', 'setAlert', 'removeAlert', 'requestStatement', 'subscribeIpo',
]);

/** What the members can vote on. */
export const PROPOSAL_KINDS = Object.freeze(['trade', 'business', 'admit', 'remove', 'role', 'limit', 'dissolve']);

/** Business requests that spend the syndicate's money, and so can be put to the members when over the limit. */
export const BUSINESS_SPENDS = Object.freeze(['found', 'join', 'contribute', 'buyout']);

const SEEN_BY = ['invited', 'active'];
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const whole = (v) => Math.floor(Number(v) || 0);
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const fail = (reason) => ({ ok: false, reason });

/** Fill in a stored record's missing fields. Does not mutate the input. */
export function normalizeSyndicate(raw) {
  const s = raw ?? {};
  return {
    schema: SYNDICATE_SCHEMA,
    id: s.id ?? null,
    name: s.name ?? '',
    status: SYNDICATE_STATUS.includes(s.status) ? s.status : 'active',
    founderId: s.founderId ?? null,
    createdDay: s.createdDay ?? 0,
    closedDay: s.closedDay ?? null,
    members: (s.members ?? []).map((m) => ({
      actorId: m.actorId,
      name: m.name ?? '',
      role: m.role === 'officer' ? 'officer' : 'member',
      status: m.status ?? 'active',
      units: round2(m.units),
      joinedDay: m.joinedDay ?? null,
      leaving: !!m.leaving,
    })),
    rules: { tradeLimit: whole(s.rules?.tradeLimit ?? SYNDICATE_DEFAULTS.tradeLimit), proposalDays: whole(s.rules?.proposalDays ?? SYNDICATE_DEFAULTS.proposalDays) },
    proposals: s.proposals ?? [],
    redemptions: s.redemptions ?? [],
    ledger: s.ledger ?? [],
  };
}

export const memberOf = (s, actorId) => s.members.find((m) => m.actorId === actorId) ?? null;
export const activeMembers = (s) => s.members.filter((m) => m.status === 'active');
export const isOfficer = (s, actorId) => memberOf(s, actorId)?.status === 'active' && memberOf(s, actorId)?.role === 'officer';
/** Actor ids of the characters whose users may read the syndicate. */
export const seenBy = (s) => s.members.filter((m) => SEEN_BY.includes(m.status)).map((m) => m.actorId);
export const syndicateUnits = (s) => round2(activeMembers(s).reduce((a, m) => a + m.units, 0));

/** Cash the account can spend now: its balance less what open buy orders hold. */
export const freeCash = (portfolio) => Math.max(0, portfolio.cash - committedCash(portfolio.orders));

/**
 * What the syndicate is worth: the portfolio's total value at market plus its business stakes at book
 * value, the units in issue, and the value per unit (1 eb while there are none).
 * @param {Object<string, number>} prices - assetId -> price
 * @param {number} [stakes] - its stakes in businesses, at book value
 */
export function navOf(s, portfolio, prices = {}, stakes = 0) {
  const total = valuePortfolio(normalizePortfolio(portfolio), prices).total + Math.max(0, Number(stakes) || 0);
  const units = syndicateUnits(s);
  return { total, units, nav: units > 0 ? total / units : 1 };
}

/** A member's units still free to redeem: those not already waiting in a redemption. */
export function freeUnits(s, actorId) {
  const queued = s.redemptions.filter((r) => r.actorId === actorId && r.status === 'waiting').reduce((a, r) => a + r.units, 0);
  return round2((memberOf(s, actorId)?.units ?? 0) - queued);
}

/** The estimated value of an order, for the officers' limit: quantity times the limit or market price. */
export function orderValue(order, market = {}) {
  const price = order.orderType === 'market' || !(Number(order.limit) > 0) ? Number(market[order.assetId]?.price ?? 0) : Number(order.limit);
  return Math.round(Math.max(0, Number(order.qty) || 0) * price);
}

/** Has the account nothing but cash, and no business stakes, so it can be wound up? */
export const isLiquid = (portfolio, stakes = 0) => !portfolio.lots.length && !portfolio.orders.some((o) => o.status === OPEN) && !(portfolio.unsettled ?? []).length && !(stakes > 0);

const clone = (books) => ({
  syndicate: structuredClone(normalizeSyndicate(books.syndicate)),
  portfolio: structuredClone(normalizePortfolio(books.portfolio)),
  members: Object.fromEntries(Object.entries(books.members ?? {}).map(([id, p]) => [id, structuredClone(normalizePortfolio(p))])),
});

function addLedger(s, entry) {
  s.ledger = [...s.ledger, entry].slice(-SYNDICATE_DEFAULTS.ledgerCap);
}

/**
 * Move cash between a member's account and the syndicate's, with a line in each ledger: the member's
 * reads `syndicate<What>`, the syndicate's `member<What>`.
 * @param {'Deposit'|'Redeem'|'Payout'} what
 */
function moveCash(b, actorId, amount, tick, ref, what) {
  const mine = b.members[actorId];
  mine.cash = round2(mine.cash - amount);
  b.portfolio.cash = round2(b.portfolio.cash + amount);
  mine.ledger = [...mine.ledger, { ts: tick, kind: `syndicate${what}`, assetId: null, qty: 0, amount: -amount, ref, syndicateId: b.syndicate.id }];
  b.portfolio.ledger = [...b.portfolio.ledger, { ts: tick, kind: `member${what}`, assetId: null, qty: 0, amount, ref, actorId }];
}

/**
 * Apply one member's request.
 * @param {object} o
 * @param {object|null} o.books - null for `found`
 * @param {object} o.request
 * @param {{id: string, name: string}} o.actor - the member making it
 * @param {number} o.day - the market day
 * @param {number} o.tick
 * @param {Object<string, {price: number}>} [o.market] - for valuing the account and orders
 * @param {object} [o.context]
 *   approval        the GM approves new syndicates
 *   actors          { [id]: name } characters a request may name
 *   newId           the id for a new syndicate
 *   settlementDays  days before a redemption is paid
 *   stakes          its business stakes at book value
 * @returns {{ok: false, reason: string} | {ok: true, books: object, trades: object[], business: object[], events: object[], changed: string[]}}
 *          `trades` are executor requests to run on the syndicate's portfolio; `business` the business
 *          requests a passed proposal wants made for the syndicate; `changed` the member portfolios
 *          that changed
 */
export function applySyndicateRequest({ books, request, actor, day, tick, market = {}, context = {} }) {
  const ctx = { approval: true, actors: {}, settlementDays: 0, ...context };
  const out = { trades: [], business: [], events: [], changed: new Set() };

  if (request.type === 'found') {
    const name = text(request.name, 40);
    if (name.length < 2) return fail('bad-name');
    if (!ctx.newId) return fail('no-id');
    const invite = [...new Set((request.invite ?? []).filter((id) => id !== actor.id && id in ctx.actors))].slice(0, SYNDICATE_DEFAULTS.maxMembers - 1);
    const syndicate = normalizeSyndicate({
      id: ctx.newId,
      name,
      status: ctx.approval ? 'pending' : 'active',
      founderId: actor.id,
      createdDay: day,
      members: [
        { actorId: actor.id, name: actor.name, role: 'officer', status: 'active', units: 0, joinedDay: day },
        ...invite.map((id) => ({ actorId: id, name: ctx.actors[id], role: 'member', status: 'invited', units: 0 })),
      ],
    });
    addLedger(syndicate, { day, kind: 'founded', actorId: actor.id });
    out.events.push({ type: ctx.approval ? 'awaitingApproval' : 'founded' });
    return { ok: true, books: { syndicate, portfolio: emptyPortfolio(), members: {} }, trades: [], business: [], events: out.events, changed: [] };
  }

  if (!books?.syndicate) return fail('no-syndicate');
  const b = clone(books);
  const s = b.syndicate;
  if (s.status === 'closed') return fail('closed');
  const me = memberOf(s, actor.id);

  switch (request.type) {
    case 'join':
      if (me?.status !== 'invited') return fail('not-invited');
      if (activeMembers(s).length >= SYNDICATE_DEFAULTS.maxMembers) return fail('full');
      Object.assign(me, { status: 'active', name: actor.name, joinedDay: day, role: 'member', units: 0, leaving: false });
      addLedger(s, { day, kind: 'joined', actorId: actor.id });
      out.events.push({ type: 'joined', actorId: actor.id });
      break;
    case 'decline':
      if (me?.status !== 'invited') return fail('not-invited');
      me.status = 'declined';
      break;
    default: {
      if (s.status !== 'active') return fail('not-active');
      if (me?.status !== 'active') return fail('not-member');
      const done = memberRequest(b, me, request, { day, tick, market, ctx, out });
      if (!done.ok) return done;
    }
  }
  settle(b, { day, tick, market, ctx, out });
  return { ok: true, books: b, trades: out.trades, business: out.business, events: out.events, changed: [...out.changed] };
}

function memberRequest(b, me, request, { day, tick, market, ctx, out }) {
  const s = b.syndicate;
  const prices = pricesOf(market);
  switch (request.type) {
    case 'deposit': {
      const amount = whole(request.amount);
      if (amount < 1) return fail('bad-amount');
      const mine = b.members[me.actorId];
      if (!mine) return fail('no-portfolio');
      if (amount > freeCash(mine)) return fail('insufficient-cash');
      const { nav } = navOf(s, b.portfolio, prices, ctx.stakes);
      const units = round2(amount / nav);
      if (!(units > 0)) return fail('bad-amount');
      moveCash(b, me.actorId, amount, tick, request.key, 'Deposit');
      me.units = round2(me.units + units);
      addLedger(s, { day, kind: 'deposit', actorId: me.actorId, amount, units, nav: round2(nav) });
      out.changed.add(me.actorId);
      out.events.push({ type: 'deposit', actorId: me.actorId, amount, units });
      return { ok: true, units, nav };
    }
    case 'redeem':
    case 'leave': {
      const all = request.type === 'leave';
      const units = all ? freeUnits(s, me.actorId) : round2(request.units);
      if (!all && !(units > 0)) return fail('bad-amount');
      if (units > freeUnits(s, me.actorId) + 1e-9) return fail('not-enough-units');
      // The last holder cannot cash out while the account still holds anything: the members dissolve it instead.
      const othersHold = activeMembers(s).some((m) => m.actorId !== me.actorId && m.units > 0);
      if (!othersHold && units > 0 && units >= freeUnits(s, me.actorId) - 1e-9 && !isLiquid(b.portfolio, ctx.stakes)) return fail('dissolve-instead');
      if (all && activeMembers(s).length === 1) return fail('dissolve-instead');
      if (all) me.leaving = true;
      if (units > 0) queueRedemption(s, me.actorId, units, request.key, day, ctx);
      else if (all) me.status = 'left';
      out.events.push({ type: all ? 'leaving' : 'redeemQueued', actorId: me.actorId, units });
      return { ok: true };
    }
    case 'trade': {
      if (!isOfficer(s, me.actorId)) return fail('not-officer');
      const inner = request.request ?? {};
      if (!SYNDICATE_TRADES.includes(inner.type)) return fail('bad-request');
      if (inner.type === 'placeOrder' && orderValue(inner, market) > s.rules.tradeLimit) return fail('over-limit');
      out.trades.push({ ...inner, key: request.key });
      return { ok: true };
    }
    case 'propose':
      return propose(b, me, request, { day, market, ctx, out });
    case 'vote': {
      const proposal = s.proposals.find((x) => x.id === request.proposalId);
      if (!proposal) return fail('no-proposal');
      proposal.votes[me.actorId] = !!request.yes;
      return { ok: true };
    }
    default:
      return fail('bad-request');
  }
}

function queueRedemption(s, actorId, units, key, day, ctx) {
  s.redemptions = [...s.redemptions, { id: `r_${key}`, actorId, units: round2(units), day, payableDay: day + Math.max(0, whole(ctx.settlementDays)), status: 'waiting' }];
}

function propose(b, me, request, { day, market, ctx, out }) {
  const s = b.syndicate;
  const kind = request.kind;
  if (!PROPOSAL_KINDS.includes(kind)) return fail('bad-request');
  if (s.proposals.length >= SYNDICATE_DEFAULTS.maxProposals) return fail('too-many-proposals');
  const proposal = { id: `p_${request.key}`, kind, by: me.actorId, day, ends: day + s.rules.proposalDays, votes: { [me.actorId]: true } };
  const target = request.actorId ? memberOf(s, request.actorId) : null;
  switch (kind) {
    case 'trade': {
      if (!isOfficer(s, me.actorId)) return fail('not-officer');
      const o = request.order ?? {};
      if (!['buy', 'sell'].includes(o.side) || !o.assetId || !(Number(o.qty) > 0)) return fail('bad-order');
      proposal.order = { route: o.route ?? 'direct', side: o.side, assetId: o.assetId, qty: whole(o.qty), orderType: o.orderType ?? 'market', ...(o.limit ? { limit: Number(o.limit) } : {}), expiry: o.expiry ?? 'gtc' };
      proposal.value = orderValue(proposal.order, market);
      break;
    }
    case 'admit':
      if (!(request.actorId in ctx.actors)) return fail('bad-member');
      if (target && SEEN_BY.includes(target.status)) return fail('already-member');
      proposal.actorId = request.actorId;
      break;
    case 'remove':
      if (target?.status !== 'active' || request.actorId === me.actorId) return fail('bad-member');
      proposal.actorId = request.actorId;
      break;
    case 'role':
      if (target?.status !== 'active' || !['officer', 'member'].includes(request.role)) return fail('bad-member');
      if (target.role === request.role) return fail('no-change');
      proposal.actorId = request.actorId;
      proposal.role = request.role;
      break;
    case 'limit': {
      const amount = whole(request.amount);
      if (amount < 0) return fail('bad-amount');
      proposal.amount = amount;
      break;
    }
    case 'business': {
      if (!isOfficer(s, me.actorId)) return fail('not-officer');
      const r = request.business ?? {};
      if (!BUSINESS_SPENDS.includes(r.type)) return fail('bad-request');
      // A syndicate puts in cash only.
      proposal.business = { ...r, gear: [] };
      proposal.amount = whole(request.amount);
      proposal.label = text(request.label, 60);
      break;
    }
    case 'dissolve':
      if (!isLiquid(b.portfolio, ctx.stakes)) return fail('not-liquid');
      break;
    default:
      return fail('bad-request');
  }
  const same = s.proposals.some((x) => x.kind === kind && (x.actorId ?? null) === (proposal.actorId ?? null) && !['trade', 'business'].includes(kind));
  if (same) return fail('already-proposed');
  s.proposals = [...s.proposals, proposal];
  out.events.push({ type: 'proposed', kind, proposalId: proposal.id });
  return { ok: true, proposalId: proposal.id };
}

const pricesOf = (market) => Object.fromEntries(Object.entries(market ?? {}).map(([id, m]) => [id, Number(m?.price ?? 0)]));

/** Each active member's vote weight: their units, or one each while no units exist. */
function weights(s) {
  const members = activeMembers(s);
  const units = syndicateUnits(s);
  return { members, weight: (m) => (units > 0 ? m.units : 1), all: units > 0 ? units : members.length };
}

/**
 * Settle what can be settled now: proposals that have passed, failed or lapsed, then redemptions that
 * are due and that the cash covers. Run after every request and on each market tick.
 */
function settle(b, { day, tick, market, ctx, out }) {
  const s = b.syndicate;
  for (const proposal of [...s.proposals]) {
    const { members, weight, all } = weights(s);
    const said = (yes) => members.filter((m) => proposal.votes[m.actorId] === yes).reduce((a, m) => a + weight(m), 0);
    const passed = said(true) * 2 > all;
    const failed = all > 0 && said(false) * 2 >= all;
    const lapsed = !passed && !failed && day > proposal.ends;
    if (!passed && !failed && !lapsed) continue;
    s.proposals = s.proposals.filter((x) => x !== proposal);
    if (!passed) {
      out.events.push({ type: lapsed ? 'proposalLapsed' : 'proposalFailed', kind: proposal.kind, proposalId: proposal.id });
      continue;
    }
    const done = enact(b, proposal, { day, tick, market, ctx, out });
    out.events.push(done.ok ? { type: 'proposalPassed', kind: proposal.kind, proposalId: proposal.id } : { type: 'proposalVoid', kind: proposal.kind, proposalId: proposal.id, reason: done.reason });
    if (s.status === 'closed') return;
  }
  payRedemptions(b, { day, tick, market, out, stakes: ctx.stakes });
}

function enact(b, proposal, { day, tick, market, ctx, out }) {
  const s = b.syndicate;
  const target = proposal.actorId ? memberOf(s, proposal.actorId) : null;
  switch (proposal.kind) {
    case 'trade':
      out.trades.push({ ...proposal.order, type: 'placeOrder', key: proposal.id });
      return { ok: true };
    case 'business':
      out.business.push({ key: proposal.id, request: proposal.business, by: proposal.by, label: proposal.label ?? '' });
      return { ok: true };
    case 'admit':
      if (target) Object.assign(target, { status: 'invited', role: 'member', units: 0, leaving: false });
      else s.members.push({ actorId: proposal.actorId, name: ctx.actors[proposal.actorId] ?? '', role: 'member', status: 'invited', units: 0, joinedDay: null, leaving: false });
      return { ok: true };
    case 'remove': {
      if (target?.status !== 'active') return fail('bad-member');
      target.leaving = true;
      target.role = 'member';
      const units = freeUnits(s, target.actorId);
      if (units > 0) queueRedemption(s, target.actorId, units, proposal.id, day, ctx);
      else if (target.units <= 0) target.status = 'left';
      return { ok: true };
    }
    case 'role':
      if (target?.status !== 'active') return fail('bad-member');
      target.role = proposal.role;
      return { ok: true };
    case 'limit':
      s.rules.tradeLimit = proposal.amount;
      return { ok: true };
    case 'dissolve':
      return dissolve(b, { day, tick, out, stakes: ctx.stakes });
    default:
      return { ok: true };
  }
}

/** Pay the cash out by units into the members' brokerage balances, and close the syndicate. */
function dissolve(b, { day, tick, out, stakes = 0 }) {
  const s = b.syndicate;
  if (!isLiquid(b.portfolio, stakes)) return fail('not-liquid');
  const holders = activeMembers(s).filter((m) => m.units > 0);
  const units = syndicateUnits(s);
  const cash = Math.max(0, Math.floor(b.portfolio.cash));
  if (holders.some((m) => !b.members[m.actorId])) return fail('no-portfolio');
  let left = cash;
  const shares = holders.map((m) => ({ m, amount: Math.floor((cash * m.units) / units) }));
  for (const x of shares) left -= x.amount;
  if (shares.length) shares.reduce((a, x) => (x.m.units > a.m.units ? x : a)).amount += left;
  for (const { m, amount } of shares) {
    if (amount > 0) moveCash(b, m.actorId, -amount, tick, `dissolve_${s.id}`, 'Payout');
    out.changed.add(m.actorId);
    addLedger(s, { day, kind: 'payout', actorId: m.actorId, amount, units: m.units });
    m.units = 0;
  }
  for (const m of s.members.filter((x) => ['active', 'invited'].includes(x.status))) m.status = 'left';
  s.redemptions = s.redemptions.map((r) => (r.status === 'waiting' ? { ...r, status: 'cancelled' } : r));
  s.proposals = [];
  s.status = 'closed';
  s.closedDay = day;
  addLedger(s, { day, kind: 'dissolved' });
  out.events.push({ type: 'dissolved' });
  return { ok: true };
}

/** Pay the redemptions that are due, oldest first, while the cash covers them. */
function payRedemptions(b, { day, tick, market, out, stakes = 0 }) {
  const s = b.syndicate;
  const { nav } = navOf(s, b.portfolio, pricesOf(market), stakes);
  for (const r of s.redemptions.filter((x) => x.status === 'waiting' && x.payableDay <= day)) {
    const member = memberOf(s, r.actorId);
    if (!member || !b.members[r.actorId]) continue;
    const units = Math.min(r.units, member.units);
    const amount = Math.floor(units * nav);
    if (amount > freeCash(b.portfolio)) break;
    moveCash(b, r.actorId, -amount, tick, r.id, 'Redeem');
    member.units = round2(member.units - units);
    r.status = 'paid';
    r.amount = amount;
    r.paidDay = day;
    if (member.leaving && member.units <= 0 && !s.redemptions.some((x) => x.actorId === r.actorId && x.status === 'waiting')) member.status = 'left';
    addLedger(s, { day, kind: 'redeem', actorId: r.actorId, amount, units });
    out.changed.add(r.actorId);
    out.events.push({ type: 'redeemed', actorId: r.actorId, amount, units });
  }
  s.redemptions = [...s.redemptions.filter((x) => x.status === 'waiting'), ...s.redemptions.filter((x) => x.status !== 'waiting').slice(-20)];
}

/**
 * The market moved or a day passed: settle lapsed proposals and pay redemptions that have come due.
 * @returns {{books: object, trades: object[], events: object[], changed: string[]}}
 */
export function advanceSyndicate({ books, day, tick, market = {}, context = {} }) {
  const b = clone(books);
  const out = { trades: [], business: [], events: [], changed: new Set() };
  if (b.syndicate.status === 'active') settle(b, { day, tick, market, ctx: { actors: {}, settlementDays: 0, ...context }, out });
  return { books: b, trades: out.trades, business: out.business, events: out.events, changed: [...out.changed] };
}

/** GM: let a pending syndicate start trading. */
export function approveSyndicate(syndicate) {
  const s = structuredClone(normalizeSyndicate(syndicate));
  if (s.status !== 'pending') return fail('not-pending');
  s.status = 'active';
  return { ok: true, syndicate: s };
}

/**
 * GM: force a proposal through or strike it out. A forced proposal is enacted as if it had passed.
 * @param {'pass'|'veto'} how
 */
export function decideProposal({ books, proposalId, how, day, tick, market = {}, context = {} }) {
  const b = clone(books);
  const s = b.syndicate;
  const proposal = s.proposals.find((x) => x.id === proposalId);
  if (!proposal) return fail('no-proposal');
  const out = { trades: [], business: [], events: [], changed: new Set() };
  s.proposals = s.proposals.filter((x) => x !== proposal);
  if (how === 'pass') {
    const done = enact(b, proposal, { day, tick, market, ctx: { actors: {}, settlementDays: 0, ...context }, out });
    if (!done.ok) return done;
  }
  out.events.push({ type: how === 'pass' ? 'proposalPassed' : 'proposalVetoed', kind: proposal.kind, proposalId, forced: true });
  return { ok: true, books: b, trades: out.trades, business: out.business, events: out.events, changed: [...out.changed] };
}

/** GM: close a syndicate that is pending or holds nothing but cash, paying the cash out by units. */
export function closeSyndicate({ books, day, tick, stakes = 0 }) {
  const b = clone(books);
  const out = { trades: [], business: [], events: [], changed: new Set() };
  if (b.syndicate.status === 'closed') return fail('closed');
  const done = dissolve(b, { day, tick, out, stakes });
  if (!done.ok) return done;
  return { ok: true, books: b, trades: [], business: [], events: out.events, changed: [...out.changed] };
}
