/**
 * Default model tuning
 * @file scripts/engine/config.js
 * @description All tunable constants for the price model in one place. The Foundry layer may
 *              override any of these from module settings; tools/simulate.mjs is used to tune them.
 */

export const SECTORS = [
  'security', 'arms', 'biotech', 'tech', 'energy', 'finance',
  'transport', 'media', 'health', 'consumer', 'construction', 'other',
];

export const REGIMES = ['bull', 'sideways', 'bear', 'crash', 'recovery'];

export const DEFAULT_MODEL_CONFIG = Object.freeze({
  /** Daily sigma for volatility ratings 1..5. */
  volatilityDaily: [0.006, 0.011, 0.018, 0.03, 0.045],
  /** Fat-tail degrees of freedom for the idiosyncratic noise (Student-t). */
  studentDf: 5,
  /** GARCH(1,1)-lite persistence: a = reaction to the last shock, b = decay of past volatility. */
  garchA: 0.08,
  garchB: 0.88,
  /** Bounds on the volatility ratio h (variance relative to the long-run level). */
  garchMin: 0.25,
  garchMax: 9,
  /** Daily pull toward fair value, applied to ln(F / P). Roughly a 35-tick half-life. */
  kappa: 0.02,
  /** Company growth drift per tick when a company does not set its own. */
  defaultDrift: 0.0002,
  /** Market factor noise and sector factor noise, per tick. */
  sigmaMarket: 0.012,
  sigmaSector: 0.006,
  /** Rare idiosyncratic jumps: chance per tick, size in multiples of the company's sigma. */
  jumpChance: 0.004,
  jumpSigmaMult: 4,
  /** A single tick's log return is clamped to this; beyond circuitBreaker the stock is flagged. */
  maxMove: 0.5,
  circuitBreaker: 0.25,
  minPrice: 1,
  /** Market regimes: per-tick market drift, volatility multiplier, expected duration, next-state weights. */
  regimes: {
    bull: { drift: 0.0015, volMult: 0.9, meanDuration: 45, next: { sideways: 0.6, bear: 0.3, crash: 0.1 } },
    sideways: { drift: 0.0, volMult: 1.0, meanDuration: 35, next: { bull: 0.45, bear: 0.5, crash: 0.05 } },
    bear: { drift: -0.002, volMult: 1.3, meanDuration: 30, next: { sideways: 0.5, crash: 0.15, recovery: 0.35 } },
    crash: { drift: -0.015, volMult: 2.5, meanDuration: 8, next: { recovery: 0.8, bear: 0.2 } },
    recovery: { drift: 0.004, volMult: 1.5, meanDuration: 25, next: { bull: 0.6, sideways: 0.4 } },
  },
  /** Spread (fraction of price) by liquidity rating 1..5. */
  spreadByLiquidity: [0.04, 0.025, 0.015, 0.01, 0.006],
  /** Optional market impact of large orders. */
  marketImpact: { enabled: false, lambda: 0.02, advRef: 1000 },
});

/** Defaults applied to a company definition that omits fields. */
export const COMPANY_DEFAULTS = Object.freeze({
  sector: 'other',
  volatility: 3,
  beta: 1,
  sectorBeta: 1,
  liquidity: 3,
  status: 'active',
});

/**
 * Direct trading (a terminal with CorpNet access): instant and the most expensive way to trade.
 * Every broker's terms are derived from these, so a broker is always cheaper and slower.
 */
export const DIRECT_DEFAULTS = Object.freeze({
  commissionBps: 200,
  flatFee: 5,
  /** Difficulty value of the Accounting check needed to open a terminal session ("Everyday"). */
  dv: 13,
  /** A session covers this many market ticks, counting the one it opens on. */
  sessionTicks: 1,
  /** After a failed check the character cannot try again for this many ticks (doubled on a fumble). */
  lockoutTicks: 1,
  /** NCM network the character must be connected to. */
  network: 'CORPNET',
});

/**
 * How a broker's terms follow their Accounting total (INT + Accounting level, so roughly 2 to 20).
 * To make skilled brokers CHEAPER instead of dearer, swap the two costFactor values.
 */
export const BROKER_TUNING = Object.freeze({
  skillMin: 4,
  skillMax: 20,
  /** Share of the direct cost a broker charges: low skill at `min`, high skill at `max`. Always below 1. */
  costFactor: { min: 0.3, max: 0.85 },
  /** Market ticks (in-world days) a broker takes to act. Direct is 0, so a broker is always slower. */
  latencyBands: [
    { upTo: 6, min: 3, max: 5 },
    { upTo: 9, min: 2, max: 4 },
    { upTo: 12, min: 2, max: 3 },
    { upTo: 15, min: 1, max: 2 },
    { upTo: 99, min: 1, max: 1 },
  ],
  grades: [
    { upTo: 6, key: 'rookie' },
    { upTo: 9, key: 'competent' },
    { upTo: 12, key: 'seasoned' },
    { upTo: 15, key: 'expert' },
    { upTo: 99, key: 'elite' },
  ],
  /** Pooled funds only: how skill helps a broker's buys and sells. */
  fund: {
    /** Largest share of a fund's entry/exit charge a top broker waives. */
    loadRebateMax: 0.9,
    /** Average price improvement (bps) for a low and a high skill broker; low skill can be negative. */
    timingMeanBps: { min: -10, max: 30 },
    timingSigmaBps: 12,
  },
});
