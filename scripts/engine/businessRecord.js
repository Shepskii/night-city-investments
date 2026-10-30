/**
 * Player businesses: the record
 * @file scripts/engine/businessRecord.js
 * @description The stored business record and what every part of the business engine reads from
 *              it: days and operating periods, the partners and their units, book value, bands, and
 *              the ledger. Pure; no Foundry globals. business.js re-exports all of it.
 */

import { BUSINESS_DEFAULTS, ARCHETYPES } from './businessConfig.js';

export const BUSINESS_SCHEMA = 1;

/** Statuses: forming (gathering partners and money), pending (waiting for the GM), open, closed. */
export const BUSINESS_STATUS = Object.freeze(['forming', 'pending', 'open', 'closed']);

// ── Days and periods ─────────────────────────────────────────────────────────

/** 0 = Sunday. Day 0 of the epoch was a Thursday. */
export const weekdayOf = (day) => (((day + 4) % 7) + 7) % 7;

/** The first day after `day` that falls on `weekday`: where an operating period ends. */
export function nextBoundary(day, weekday) {
  let d = day + 1;
  while (weekdayOf(d) !== weekday) d++;
  return d;
}

export function newPeriod(index, startDay, weekday) {
  return { index, startDay, endDay: nextBoundary(startDay, weekday), slots: [], bonuses: [], helpers: [], draws: {}, days: {} };
}

// ── The record ───────────────────────────────────────────────────────────────

export const int = (v) => Math.round(Number(v) || 0);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const text = (v, max) => String(v ?? '').trim().slice(0, max);

/** Fill in every field a stored record may be missing, so readers never need a default. */
export function normalizeBusiness(raw) {
  const b = raw ?? {};
  return {
    schema: BUSINESS_SCHEMA,
    id: String(b.id ?? ''),
    name: String(b.name ?? ''),
    archetype: ARCHETYPES[b.archetype] ? b.archetype : 'clinic',
    location: String(b.location ?? ''),
    /** A Night City district id (businessConfig DISTRICTS), or '' for none. */
    district: String(b.district ?? ''),
    stage: int(b.stage),
    status: BUSINESS_STATUS.includes(b.status) ? b.status : 'forming',
    founderId: b.founderId ?? null,
    createdDay: int(b.createdDay),
    openedDay: b.openedDay ?? null,
    closedDay: b.closedDay ?? null,
    closeReason: b.closeReason ?? null,
    partners: (b.partners ?? []).map((p) => ({
      actorId: String(p.actorId),
      name: String(p.name ?? ''),
      status: p.status ?? 'active',
      cash: int(p.cash),
      gear: (p.gear ?? []).map((g) => ({
        name: String(g.name ?? ''),
        value: int(g.value),
        ...(g.uuid ? { uuid: String(g.uuid) } : {}),
        ...(g.img ? { img: String(g.img) } : {}),
        // An item that came off the partner's sheet, kept so it can be given back if the business never opens.
        ...(g.item ? { item: g.item } : {}),
        ...(g.returned ? { returned: true } : {}),
      })),
      units: int(p.units),
      voting: p.voting !== false,
      heirId: p.heirId ?? null,
      leavingSince: p.leavingSince ?? null,
      ...(p.offer ? { offer: { amount: int(p.offer.amount), price: Number(p.offer.price) } } : {}),
      ...(p.npc ? { npc: true } : {}),
    })),
    agreement: {
      sweat: b.agreement?.sweat?.actorId ? { actorId: b.agreement.sweat.actorId, pct: clamp(int(b.agreement.sweat.pct), 0, 100) } : null,
      decision: 'majority',
      buyoutDays: int(b.agreement?.buyoutDays ?? BUSINESS_DEFAULTS.buyoutDays),
    },
    setup: b.setup ?? null,
    state: {
      capacity: Number(b.state?.capacity ?? 1),
      reputation: Number(b.state?.reputation ?? 50),
      costFactor: Number(b.state?.costFactor ?? 1),
      // Registered businesses only (stage 1 and up).
      compliance: b.state?.compliance == null ? null : Number(b.state.compliance),
    },
    escrow: int(b.escrow),
    till: int(b.till),
    assets: int(b.assets),
    period: b.period ?? null,
    digests: b.digests ?? [],
    ledger: b.ledger ?? [],
    losingPeriods: int(b.losingPeriods),
    proposals: b.proposals ?? [],
    projects: b.projects ?? [],
    /** The partners' agreement to step up, and when a failed registration may be tried again. */
    stepUp: b.stepUp ?? null,
    loans: b.loans ?? [],
    /** What the partners have agreed to and not yet rolled for: `bankLoan` (true), `angel` ({total, name}). */
    approved: b.approved ?? {},
    /** When a refused bank loan or angel may be asked again, as a market day. */
    retry: b.retry ?? {},
    /** A fixer's payment was missed: collectors come next week. */
    collectors: b.collectors === true,
    /** Gigs run for the business, newest last, and next week's takings change from them. */
    gigs: b.gigs ?? [],
    boost: Number(b.boost ?? 0),
    /** The market day it registered (stage 1), since B4. */
    registeredDay: b.registeredDay ?? null,
    /** A charter under way, refused or formed (DESIGN §32, businessCharter.js). */
    charter: b.charter ?? null,
    /** Once chartered: `{ ticker, sector, charteredDay }`. */
    company: b.company ?? null,
  };
}

// ── Reading a business ───────────────────────────────────────────────────────

export const archetypeOf = (b) => ARCHETYPES[b.archetype];

/** Partners who hold or will hold units: active, or leaving but not yet bought out. */
export const holders = (b) => b.partners.filter((p) => p.status === 'active' || p.status === 'leaving');

/** Partners who decide things: holders with a vote. */
export const voters = (b) => holders(b).filter((p) => p.voting);

export const partnerOf = (b, actorId) => b.partners.find((p) => p.actorId === actorId) ?? null;

export const gearValue = (p) => p.gear.reduce((a, g) => a + g.value, 0);

export const totalUnits = (b) => holders(b).reduce((a, p) => a + p.units, 0);

/** Book value: the till and the gear and fit-out, at what they cost. */
export const bookValue = (b) => b.till + b.assets;

export const unitValue = (b) => {
  const units = totalUnits(b);
  return units > 0 ? bookValue(b) / units : 0;
};

/** A partner's share of the units, 0..1. */
export const shareOf = (b, actorId) => {
  const units = totalUnits(b);
  const p = partnerOf(b, actorId);
  return units > 0 && p && (p.status === 'active' || p.status === 'leaving') ? p.units / units : 0;
};

export const lastDigest = (b) => b.digests.at(-1) ?? null;

/** What a partner may still draw this period: their share of last week's profit, less what they drew. */
export function drawAllowance(b, actorId) {
  const last = lastDigest(b);
  if (b.status !== 'open' || !last || last.profit <= 0 || !b.period) return 0;
  const share = Math.floor(last.profit * shareOf(b, actorId));
  return Math.max(0, Math.min(share - (b.period.draws[actorId] ?? 0), b.till));
}

/** The cash a forming business still needs before it can open, once the setup roll has passed. */
export function fundingShortfall(b) {
  if (!b.setup?.passed) return null;
  const gear = holders(b).reduce((a, p) => a + gearValue(p), 0);
  return Math.max(0, Math.max(0, b.setup.cost - gear) - b.escrow);
}

/** A hired professional's fee, less a Fixer partner's Operator discount. */
export function hireFee(tier, operatorRank = 0, p = BUSINESS_DEFAULTS) {
  const base = p.hireFees[tier] ?? p.hireFees.cheap;
  const off = Math.min(p.operatorDiscount.max, Math.max(0, operatorRank) * p.operatorDiscount.perRank);
  return Math.round(base * (1 - off));
}

/** How a business's state reads to its owners: bands, not numbers. */
export function stateBands(b, p = BUSINESS_DEFAULTS) {
  const rep = b.state.reputation;
  const cap = b.state.capacity / (p.stages[b.stage]?.capacityCap ?? 1.6);
  const cost = b.state.costFactor;
  return {
    reputation: rep < 35 ? 'poor' : rep < 50 ? 'modest' : rep < 65 ? 'good' : 'excellent',
    capacity: cap < 0.6 ? 'cramped' : cap < 0.8 ? 'room' : cap < 0.97 ? 'busy' : 'full',
    costs: cost > 0.97 ? 'high' : cost > 0.9 ? 'fair' : cost > 0.82 ? 'lean' : 'tight',
    ...(b.state.compliance == null ? {} : { compliance: b.state.compliance < 35 ? 'poor' : b.state.compliance < 50 ? 'shaky' : b.state.compliance < 65 ? 'sound' : 'spotless' }),
  };
}

/** A refusal, with its reason. */
export function fail(reason) {
  return { ok: false, reason };
}

/** Mark a business closed. */
export function close(b, day, reason) {
  b.status = 'closed';
  b.closedDay = day;
  b.closeReason = reason;
  b.proposals = [];
}

/** Add a ledger entry, keeping the last `ledgerCap`. */
export function addLedger(b, entry, p) {
  b.ledger = [...b.ledger, { ...entry, amount: int(entry.amount) }].slice(-p.ledgerCap);
}
