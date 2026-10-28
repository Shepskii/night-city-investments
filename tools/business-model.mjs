/**
 * Business growth model, for calibration (DESIGN §26.0, §26.2a, §26.4a). A prototype in tools/: the
 * B1 phase builds the real engine from it, and its numbers are the starting point for that engine's
 * tuning. Pure; runs without Foundry.
 *
 * One call to `stepPeriod` is one weekly operating period. Every roll goes through the rulebook's
 * d10 (a 10 explodes, a 1 subtracts) and the outcome bands of DESIGN §26.
 */

import { createRng } from '../scripts/engine/rng.js';
import { cprD10 } from '../scripts/engine/checks.js';

export const DV = { everyday: 13, difficult: 15, professional: 17 };

/** A crew expands once the till covers the next expansion with this much to spare. */
const EXPANSION_RESERVE = 1.2;

/** Outcome bands by margin (total minus DV); a natural 1 that fails is a fumble, a critical is exceptional. */
export function band(margin, crit) {
  if (crit === 'fumble' && margin < 0) return 'fumble';
  if (margin < 0) return 'failure';
  if (crit === 'success' || margin >= 8) return 'exceptional';
  if (margin >= 6) return 'strong';
  if (margin >= 2) return 'solid';
  return 'narrow';
}

const BANDS = ['fumble', 'failure', 'narrow', 'solid', 'strong', 'exceptional'];
const byBand = (values) => Object.fromEntries(BANDS.map((b, i) => [b, values[i]]));

export const DEFAULTS = {
  /** A back-room ripperdoc clinic at stage 0: base weekly takings and costs at Capacity 1. */
  archetype: { name: 'Ripperdoc clinic', takings: 260, costs: 180 },
  growthRate: 1,
  /** Per stage: action slots, the DV of its actions, the Capacity ceiling, fixed weekly costs, expansion cost and gain. */
  stages: [
    { name: 'Side business', slots: 1, dv: DV.everyday, capacityCap: 1.6, fixed: 15, expansionCost: 1500, expansionGain: 0.25, fixUpScale: 1 },
    { name: 'Registered business', slots: 2, dv: DV.difficult, capacityCap: 4.5, fixed: 40, expansionCost: 2500, expansionGain: 0.8, fixUpScale: 6 },
    { name: 'Chartered company', slots: 3, dv: DV.professional, capacityCap: 14, fixed: 150, expansionCost: 8000, expansionGain: 1.5, fixUpScale: 14 },
  ],
  /** What each outcome band does, per action. */
  work: byBand([0.6, 0.85, 1.0, 1.1, 1.2, 1.35]),
  promote: byBand([-3, 0, 2, 4, 6, 8]),
  source: byBand([-0.02, 0, 0.01, 0.02, 0.03, 0.04]),
  fixUp: byBand([-0.02, 0, 0.03, 0.05, 0.07, 0.1]),
  eventChance: 0.25,
  /** An unanswered event costs this share of the week's takings; a failed answer, the smaller share. */
  eventLoss: { unanswered: 0.15, failed: 0.1 },
  registration: { fee: 500, minPeriods: 4, minProfit: 100, minReputation: 50, dv: DV.difficult },
  // A growing business charters at the Startup tier (DESIGN §26.2a), which its net assets largely cover.
  charter: { fee: 2000, minLedgers: 3, minProfit: 400, dv: DV.difficult, kmin: 5000, kmax: 12000 },
  listing: { threshold: 500000, sustained: 3, minReports: 3, minPeriods: 8, multiple: 10 },
  periodsPerMonth: 4,
};

/**
 * A crew: the skill base (stat + skill) it brings to each kind of roll, who supports with
 * complementary checks, and how it spends: the share of profit drawn, and outside money for the charter.
 */
export const CREWS = {
  strong: { work: 14, promote: 12, fixUp: 11, source: 13, admin: 12, support: 12, drawShare: 0.25, outsideMoney: 8000 },
  average: { work: 11, promote: 10, fixUp: 9, source: 10, admin: 10, support: 10, drawShare: 0.4, outsideMoney: 5000 },
  weak: { work: 9, promote: 8, fixUp: 7, source: 8, admin: 8, support: 8, drawShare: 0.5, outsideMoney: 3000 },
};

export function createBusiness() {
  return {
    stage: 0, period: 0, capacity: 1, reputation: 50, costFactor: 1, till: 1500, assets: 1500, owners: 0,
    profits: [], losingPeriods: 0, ledgers: 0, reports: [], expansions: 0, closed: false,
    milestones: {}, chartered: null,
  };
}

function roll(rng, base, dv, bonus = 0) {
  const r = cprD10(() => rng.int(1, 10));
  const margin = base + bonus + r.total - dv;
  return { margin, band: band(margin, r.crit) };
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const traffic = (rep) => 0.6 + (Math.max(0, Math.min(100, rep)) / 100) * 0.8;

/** Valuation V (DESIGN §26.4a): net assets plus annualised profit at the sector multiple, profit floored at zero. */
export function valuation(b, p = DEFAULTS) {
  const weekly = Math.max(0, avg(b.profits.slice(-12)));
  return b.till + b.assets + weekly * 52 * p.listing.multiple;
}

/** Run one weekly operating period; mutates and returns the business. */
export function stepPeriod(b, crew, seed, p = DEFAULTS) {
  if (b.closed) return b;
  const rng = createRng(seed, 'business', b.period);
  const stage = p.stages[b.stage];
  const g = p.growthRate;
  let slots = stage.slots;

  // A partner's complementary check (no slot): +1 to the first roll if it succeeds.
  let bonus = roll(rng, crew.support, DV.everyday).margin >= 0 ? 1 : 0;
  const take = () => { const v = bonus; bonus = 0; return v; };

  // An event takes the first slot when one comes up; the crew answers it.
  let eventLoss = 0;
  if (rng.chance(p.eventChance)) {
    const answer = roll(rng, crew.admin, DV.difficult, take());
    slots -= 1;
    eventLoss = answer.margin >= 0 ? 0 : p.eventLoss.failed;
  }

  let workMult = 1;
  for (let s = 0; s < slots; s++) {
    // One slot works the shop; the rest go where the business most needs them.
    if (s === 0) {
      workMult = p.work[roll(rng, crew.work, stage.dv, take()).band];
    } else if (b.reputation < 70) {
      b.reputation += p.promote[roll(rng, crew.promote, stage.dv, take()).band] * g;
    } else if (b.capacity < stage.capacityCap) {
      b.capacity = Math.min(stage.capacityCap, b.capacity + p.fixUp[roll(rng, crew.fixUp, stage.dv, take()).band] * stage.fixUpScale * g);
    } else {
      b.costFactor = Math.max(0.75, b.costFactor - p.source[roll(rng, crew.source, stage.dv, take()).band]);
    }
  }
  b.reputation += (50 - b.reputation) * 0.03; // neglect drift toward the baseline
  b.costFactor = Math.min(1, b.costFactor + 0.005);

  const takings = p.archetype.takings * b.capacity * traffic(b.reputation) * workMult * (1 - eventLoss);
  const costs = p.archetype.costs * b.capacity ** 0.85 * b.costFactor + stage.fixed;
  const profit = takings - costs;
  b.profits.push(profit);
  b.till += profit;
  const draw = profit > 0 ? profit * crew.drawShare : 0;
  b.till -= draw;
  b.owners += draw;
  b.period += 1;

  // Expansion: a well-run crew reinvests once the till covers the next expansion with a reserve left.
  if (b.capacity < stage.capacityCap && b.till >= stage.expansionCost * EXPANSION_RESERVE) {
    b.till -= stage.expansionCost;
    b.assets += stage.expansionCost;
    b.capacity = Math.min(stage.capacityCap, b.capacity + stage.expansionGain * g);
    b.expansions += 1;
  }

  b.losingPeriods = b.till < 0 ? b.losingPeriods + 1 : 0;
  if (b.losingPeriods >= 2) {
    b.closed = true;
    b.milestones.closed = b.period;
    return b;
  }

  if (b.period % p.periodsPerMonth === 0) {
    b.ledgers += 1;
    if (b.stage === 2) b.reports.push(valuation(b, p));
  }
  stepUp(b, crew, rng, p);
  return b;
}

function stepUp(b, crew, rng, p) {
  const recent = avg(b.profits.slice(-4));
  if (b.stage === 0) {
    const r = p.registration;
    if (b.period >= r.minPeriods && recent >= r.minProfit && b.reputation >= r.minReputation && b.till >= r.fee) {
      b.till -= r.fee;
      if (roll(rng, crew.admin, r.dv).margin >= 0) {
        b.stage = 1;
        b.ledgers = 0;
        b.milestones.registered = b.period;
      }
    }
  } else if (b.stage === 1) {
    const c = p.charter;
    if (b.ledgers >= c.minLedgers && recent >= c.minProfit && b.expansions > 0 && b.till >= c.fee) {
      b.till -= c.fee;
      const accounting = roll(rng, crew.admin, c.dv);
      if (accounting.margin < 0) return;
      const quote = c.kmax - (c.kmax - c.kmin) * Math.max(0, Math.min(1, accounting.margin / 8));
      const due = Math.max(0, quote - (b.till + b.assets)); // net assets count toward the quote (§26.2a)
      if (due > b.owners + crew.outsideMoney) return;
      b.owners -= Math.min(b.owners, due);
      b.till += due;
      b.stage = 2;
      b.chartered = b.period;
      b.milestones.chartered = b.period;
    }
  } else if (b.stage === 2 && !b.milestones.eligible) {
    const l = p.listing;
    const last = b.reports.slice(-l.sustained);
    if (b.reports.length >= l.minReports && b.period - b.chartered >= l.minPeriods
      && last.length === l.sustained && last.every((v) => v >= l.threshold)) {
      b.milestones.eligible = b.period;
    }
  }
}

/** Run a business until it is eligible to list, closes, or `maxPeriods` pass. */
export function runBusiness(crew, seed, { maxPeriods = 120, params = DEFAULTS } = {}) {
  const b = createBusiness();
  const profitAt = {};
  while (b.period < maxPeriods && !b.closed && !b.milestones.eligible) {
    const before = b.stage;
    stepPeriod(b, crew, seed, params);
    if (b.stage !== before) profitAt[before] = avg(b.profits.slice(-4));
  }
  return { ...b.milestones, periods: b.period, profitAt, weekly: avg(b.profits.slice(-4)), value: valuation(b, params) };
}
