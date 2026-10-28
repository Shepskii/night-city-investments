/**
 * Constants
 * @file scripts/utils/constants.js
 */

export const MODULE_ID = 'night-city-investments';
export const MODULE_TITLE = 'Night City Investments';
export const MODULE_SHORT = 'NCI';
export const SOCKET = `module.${MODULE_ID}`;
export const API_VERSION = '0.9.7';

/** Schema version for every persisted store; each bump has a step in engine/migrations.js. */
export const SCHEMA_VERSION = 2;

export const SETTINGS = Object.freeze({
  SCHEMA_VERSION: 'schemaVersion',
  TICK_MODE: 'tickMode',
  REAL_TIME_MINUTES: 'realTimeMinutes',
  GIG_IMPACT_APPROVAL: 'gigImpactApproval',
  GIG_IMPACTS: 'gigImpacts',
  GIG_IMPACT_SCALE: 'gigImpactScale',
  GIG_TIPS: 'gigTips',
  HEAT_ENABLED: 'heatEnabled',
  HEAT_STRENGTH: 'heatStrength',
  HEAT_CONSEQUENCES: 'heatConsequences',
  HEAT_PENALTY_APPROVAL: 'heatPenaltyApproval',
  BROKER_ORDER_MODE: 'brokerOrderMode',
  DEPOSIT_FEE: 'depositFee',
  DIRECT_EXECUTION: 'directOrderExecution',
  DIRECT_COMMISSION_BPS: 'directCommissionBps',
  DIRECT_MODE: 'directTradingMode',
  DIRECT_FLAT_FEE: 'directFlatFee',
  CORPNET_DV: 'corpnetDV',
  CORPNET_NETWORK: 'corpnetNetwork',
  SESSION_TICKS: 'sessionTicks',
  LOCKOUT_TICKS: 'lockoutTicks',
  SETTLEMENT_DAYS: 'settlementDays',
  SHOW_TICKER: 'showTicker',
  BROKER_DEFS: 'brokerDefs',
  FUND_DEFS: 'fundDefs',
  WORLD_SEED: 'worldSeed',
  MARKET_STATE: 'marketState',
  MARKET_HISTORY: 'marketHistory',
  NEWS_FEED: 'newsFeed',
  DIVIDEND_RECORDS: 'dividendRecords',
  DEBUG_MODE: 'debugMode',
});

/** Flag keys under flags[MODULE_ID] on journals. */
export const FLAGS = Object.freeze({
  COMPANY: 'company',
  CONTROL: 'control',
  ENGINE: 'engine',
  /** On the GM-only control journal: biases, scheduled impacts, forced regime. */
  CONTROLS: 'controls',
  /** On the GM-only control journal: the last few pre-tick snapshots, for "undo last tick". */
  SNAPSHOTS: 'snapshots',
  /** On the GM-only control journal: gig outcomes waiting for a mapping or approval, their history, and the client mappings. */
  GIGS: 'gigs',
  /** On the GM-only control journal: each character's insider-trading heat, the watch windows and the audits. */
  HEAT: 'heat',
  /** On world macros this module created: which starter macro it is, so it is not made twice. */
  MACRO: 'macro',
  /** On actors. Written only by the GM executor. */
  PORTFOLIO: 'portfolio',
  /** On actors. Written only by the owning player; the GM only reads it. */
  OUTBOX: 'outbox',
  /** On actors. Player-owned preferences such as the watchlist and notification channels. */
  PREFS: 'prefs',
  /** On actors. Written only by the GM: the character is at a terminal with CorpNet access. */
  GRANT: 'terminalGrant',
});

/** Tag on an NCM master contact that makes it a broker. */
export const BROKER_TAG = 'broker';
/** Tag on the system contact that sends market mail. */
export const WIRE_TAG = 'market-wire';
export const WIRE_NAME = 'Night City Market Wire';
/** Tag on the system contact that sends notices from NCPD Financial Crimes. */
export const NCPD_TAG = 'ncpd-fincrime';
export const NCPD_NAME = 'NCPD Financial Crimes';

/** Foundry hooks fired by this module. */
export const HOOKS = Object.freeze({
  /** Every part of the API is attached and the market is running: `api`. `apiReady` fires earlier, with only the basics. */
  READY: `${MODULE_ID}.ready`,
  MARKET_UPDATED: `${MODULE_ID}.marketUpdated`,
  COMPANIES_CHANGED: `${MODULE_ID}.companiesChanged`,
  PRICE_TICK: `${MODULE_ID}.priceTick`,
  PORTFOLIO_UPDATED: `${MODULE_ID}.portfolioUpdated`,
  ORDER_FILLED: `${MODULE_ID}.orderFilled`,
  PORTFOLIO_EVENTS: `${MODULE_ID}.portfolioEvents`,
  DIVIDEND_PAID: `${MODULE_ID}.dividendPaid`,
  CORPORATE_ACTION: `${MODULE_ID}.corporateAction`,
  NEWS_POSTED: `${MODULE_ID}.newsPosted`,
  /** A gig outcome was handled: `{status, record}` with status applied, pending, unmatched, ignored or discarded. */
  GIG_IMPACT: `${MODULE_ID}.gigImpact`,
  GIGS_CHANGED: `${MODULE_ID}.gigsChanged`,
  /** A heat audit finished: `{window, results}`. Nothing in the module acts on it yet; it is for later phases and other modules. */
  HEAT_AUDIT: `${MODULE_ID}.heatAudit`,
  /** A penalty was proposed, approved or dismissed: `{penalty}`. */
  HEAT_PENALTY: `${MODULE_ID}.heatPenalty`,
  HEAT_CHANGED: `${MODULE_ID}.heatChanged`,
});

/** Most unprocessed requests a player may have waiting at once. */
export const OUTBOX_LIMIT = 30;

export const COMPANY_FOLDER_NAME = 'Night City Investments';
export const CONTROL_JOURNAL_NAME = 'NCI GM Control';
