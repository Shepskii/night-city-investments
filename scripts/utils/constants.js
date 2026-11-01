/**
 * Constants
 * @file scripts/utils/constants.js
 */

export const MODULE_ID = 'night-city-investments';
export const MODULE_TITLE = 'Night City Investments';
export const MODULE_SHORT = 'NCI';
export const SOCKET = `module.${MODULE_ID}`;
export const API_VERSION = '0.11.0';

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
  BUSINESSES_ENABLED: 'businessesEnabled',
  BUSINESS_APPROVAL: 'businessApproval',
  BUSINESS_WEEKDAY: 'businessWeekday',
  BUSINESS_GROWTH_RATE: 'businessGrowthRate',
  SYNDICATES_ENABLED: 'syndicatesEnabled',
  SYNDICATE_APPROVAL: 'syndicateApproval',
  SYNDICATE_MAIL: 'syndicateMail',
  STAFF_MAIL: 'staffMail',
  LISTING_THRESHOLD: 'listingThreshold',
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
  /** On a business's journal: its record, which its partners can read. Written only by the GM. */
  BUSINESS: 'business',
  /** On the GM-only control journal: each business's hidden state (Exposure), by business id. */
  BUSINESSES: 'businesses',
  /** On actors. Business requests, written only by the owning player. */
  BUSINESS_OUTBOX: 'businessOutbox',
  /** On actors. Which business requests the GM has handled, and how. Written only by the GM. */
  BUSINESS_RECEIPTS: 'businessReceipts',
  /** On actors. The jobs a character holds or is offered at player businesses (DESIGN §32). Written only by the GM. */
  JOBS: 'jobs',
  /** On a syndicate's journal: its record, which its members can read. Written only by the GM. (Its account is the `portfolio` flag beside it.) */
  SYNDICATE: 'syndicate',
  /** On actors. Syndicate requests, written only by the owning player. */
  SYNDICATE_OUTBOX: 'syndicateOutbox',
  /** On actors. Which syndicate requests the GM has handled, and how. Written only by the GM. */
  SYNDICATE_RECEIPTS: 'syndicateReceipts',
});

/** Tag on an NCM master contact that makes it a broker. */
export const BROKER_TAG = 'broker';
/** Tag on an NCM master contact whose linked character may be invited to invest in a business. */
export const INVESTOR_TAG = 'investor';
/** Tags on an NCM master contact whose linked character may be hired as an employee (DESIGN §32). */
export const STAFF_TAGS = Object.freeze(['staff', 'employee']);
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
  /** A business record was created, changed or removed, or a character's business receipts changed. */
  BUSINESSES_CHANGED: `${MODULE_ID}.businessesChanged`,
  /** A business's week closed: `{businessId, digest}`. */
  BUSINESS_PERIOD: `${MODULE_ID}.businessPeriod`,
  /** A syndicate record was created, changed or removed, or a character's syndicate receipts changed. */
  SYNDICATES_CHANGED: `${MODULE_ID}.syndicatesChanged`,
});

/** Most unprocessed requests a player may have waiting at once. */
export const OUTBOX_LIMIT = 30;

export const COMPANY_FOLDER_NAME = 'Night City Investments';
export const BUSINESS_FOLDER_NAME = 'NCI Businesses';
export const SYNDICATE_FOLDER_NAME = 'NCI Syndicates';
export const CONTROL_JOURNAL_NAME = 'NCI GM Control';
