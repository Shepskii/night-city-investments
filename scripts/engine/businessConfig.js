/**
 * Business tables
 * @file scripts/engine/businessConfig.js
 * @description Archetypes, actions and the numbers the business loop runs on (DESIGN §27.0). The
 *              values come from the B0 simulator (tools/business-model.mjs) and are its calibrated
 *              starting point. Pure; no Foundry globals.
 */

import { DV_LADDER } from './rolls.js';

const skill = (name, stat) => Object.freeze({ kind: 'skill', skill: name, stat });
const ability = (name) => Object.freeze({ kind: 'ability', ability: name });

/** Cyberpunk RED skills the business loop uses, with the stat each falls back on. */
export const SKILLS = Object.freeze({
  accounting: skill('Accounting', 'int'),
  basicTech: skill('Basic Tech', 'tech'),
  brawling: skill('Brawling', 'dex'),
  bribery: skill('Bribery', 'cool'),
  bureaucracy: skill('Bureaucracy', 'int'),
  business: skill('Business', 'int'),
  composition: skill('Composition', 'int'),
  conversation: skill('Conversation', 'emp'),
  cybertech: skill('Cybertech', 'tech'),
  driveLand: skill('Drive Land Vehicle', 'ref'),
  education: skill('Education', 'int'),
  electronics: skill('Electronics/Security Tech', 'tech'),
  handgun: skill('Handgun', 'ref'),
  humanPerception: skill('Human Perception', 'emp'),
  interrogation: skill('Interrogation', 'cool'),
  landVehicleTech: skill('Land Vehicle Tech', 'tech'),
  librarySearch: skill('Library Search', 'int'),
  localExpert: skill('Local Expert', 'int'),
  meleeWeapon: skill('Melee Weapon', 'dex'),
  paramedic: skill('Paramedic', 'tech'),
  perception: skill('Perception', 'int'),
  personalGrooming: skill('Personal Grooming', 'cool'),
  persuasion: skill('Persuasion', 'cool'),
  photography: skill('Photography/Film', 'tech'),
  playInstrument: skill('Play Instrument', 'tech'),
  streetwise: skill('Streetwise', 'cool'),
  tactics: skill('Tactics', 'int'),
  trading: skill('Trading', 'cool'),
  wardrobe: skill('Wardrobe & Style', 'cool'),
  weaponstech: skill('Weaponstech', 'tech'),
});

/** Role abilities, by the name Cyberpunk RED gives them (`system.mainRoleAbility`). */
export const ABILITIES = Object.freeze({
  backup: ability('Backup'),
  teamwork: ability('Teamwork'),
  charismaticImpact: ability('Charismatic Impact'),
  combatAwareness: ability('Combat Awareness'),
  credibility: ability('Credibility'),
  interface: ability('Interface'),
  maker: ability('Maker'),
  medicine: ability('Medicine'),
  moto: ability('Moto'),
  operator: ability('Operator'),
});

const S = SKILLS;
const A = ABILITIES;

/**
 * The ten archetypes (four from B1, six from B2). `takings` and `costs` are weekly, at Capacity 1 and a neutral
 * Reputation; `setup` is the range a setup roll's band picks from; `trade` are the skills that work
 * the shop; `abilities` are the role abilities that fit its setup and its complementary checks.
 */
export const ARCHETYPES = Object.freeze({
  clinic: Object.freeze({ id: 'clinic', takings: 260, costs: 180, setup: [1000, 3000], trade: [S.cybertech, S.paramedic], abilities: [A.medicine, A.maker] }),
  garage: Object.freeze({ id: 'garage', takings: 240, costs: 165, setup: [800, 2500], trade: [S.basicTech, S.landVehicleTech], abilities: [A.maker, A.moto] }),
  bar: Object.freeze({ id: 'bar', takings: 250, costs: 175, setup: [1000, 3000], trade: [S.conversation, S.persuasion, S.playInstrument], abilities: [A.charismaticImpact, A.operator] }),
  infoShop: Object.freeze({ id: 'infoShop', takings: 230, costs: 155, setup: [700, 2200], trade: [S.librarySearch, S.electronics], abilities: [A.interface, A.operator] }),
  boutique: Object.freeze({ id: 'boutique', takings: 240, costs: 165, setup: [900, 2800], trade: [S.wardrobe, S.personalGrooming], abilities: [A.credibility, A.charismaticImpact] }),
  gunShop: Object.freeze({ id: 'gunShop', takings: 270, costs: 190, setup: [1500, 3000], trade: [S.weaponstech, S.trading], abilities: [A.operator, A.maker] }),
  courier: Object.freeze({ id: 'courier', takings: 220, costs: 150, setup: [600, 2000], trade: [S.driveLand, S.localExpert], abilities: [A.moto, A.operator] }),
  security: Object.freeze({ id: 'security', takings: 250, costs: 175, setup: [800, 2500], trade: [S.tactics, S.persuasion], abilities: [A.combatAwareness, A.backup] }),
  media: Object.freeze({ id: 'media', takings: 225, costs: 155, setup: [700, 2200], trade: [S.composition, S.photography], abilities: [A.credibility] }),
  foodStall: Object.freeze({ id: 'foodStall', takings: 200, costs: 135, setup: [500, 1500], trade: [S.streetwise, S.localExpert], abilities: [A.operator] }),
});

/**
 * Night City's districts, with the ids Night City Map uses. `traffic` multiplies takings, `rent`
 * multiplies rent and licence fees, and `risk` multiplies protection money and how often trouble
 * comes. A business with no district is average on all three.
 */
export const DISTRICTS = Object.freeze(Object.fromEntries([
  ['exec', 1.25, 1.6, 0.6], ['westbrook', 1.2, 1.45, 0.7], ['japan', 1.15, 1.15, 1.1], ['watson', 1.1, 1.0, 1.0],
  ['china', 1.1, 1.0, 1.1], ['europe', 1.05, 1.1, 0.9], ['marina', 1.0, 1.15, 0.9], ['uni', 1.0, 1.0, 0.9],
  ['glen', 1.0, 1.05, 0.9], ['heywood', 1.0, 0.95, 1.0], ['bank', 0.95, 0.9, 1.2], ['med', 0.95, 0.9, 1.2],
  ['rancho', 0.9, 0.9, 0.9], ['south', 0.85, 0.75, 1.4], ['hind', 0.8, 0.8, 1.2], ['ocz', 0.8, 0.65, 1.6],
  ['pacifica', 0.75, 0.6, 1.6], ['morro', 0.7, 0.75, 1.3], ['oldcorp', 0.6, 0.5, 2.0], ['oldcc', 0.6, 0.5, 2.0],
].map(([id, traffic, rent, risk]) => [id, Object.freeze({ id, traffic, rent, risk })])));

export const districtOf = (id) => DISTRICTS[id] ?? { id: '', traffic: 1, rent: 1, risk: 1 };

/** In display order. */
export const ACTION_IDS = Object.freeze(['work', 'promote', 'source', 'fixUp', 'keepSafe']);

/**
 * The five weekly actions (DESIGN §27.0). `skills` roll the action itself (`work` uses the
 * archetype's trade skills); `help` are the extra skills and abilities a complementary check for it
 * may use, on top of the action's own.
 */
export const ACTIONS = Object.freeze({
  work: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.humanPerception, A.medicine, A.charismaticImpact] }),
  promote: Object.freeze({ skills: [S.persuasion, S.wardrobe, S.composition], abilities: [A.credibility, A.charismaticImpact], help: [S.streetwise, S.localExpert] }),
  source: Object.freeze({ skills: [S.trading, S.streetwise], abilities: [A.operator, A.moto], help: [S.business, S.localExpert] }),
  fixUp: Object.freeze({ skills: [S.basicTech], abilities: [A.maker], help: [S.electronics, S.landVehicleTech] }),
  keepSafe: Object.freeze({ skills: [S.tactics, S.persuasion], abilities: [A.combatAwareness, A.backup], help: [S.streetwise, S.humanPerception] }),
});

/** A chartered company's five actions (DESIGN §27.4, §31): they replace the shop actions at stage 2. */
export const COMPANY_ACTION_IDS = Object.freeze(['contracts', 'books', 'relations', 'permits', 'shortcuts']);

/** Each company action's skill, its alternatives at DV +2, the role abilities that fit, and its help. */
export const COMPANY_ACTIONS = Object.freeze({
  contracts: Object.freeze({
    skills: [S.business, Object.freeze({ ...S.persuasion, dvAdd: 2 }), Object.freeze({ ...S.trading, dvAdd: 2 })],
    abilities: [A.teamwork, A.operator, A.maker], help: [S.librarySearch, S.humanPerception],
  }),
  books: Object.freeze({ skills: [S.accounting, Object.freeze({ ...S.business, dvAdd: 2 })], abilities: [A.moto], help: [S.librarySearch, S.business] }),
  relations: Object.freeze({
    skills: [S.trading, Object.freeze({ ...S.persuasion, dvAdd: 2 }), Object.freeze({ ...S.wardrobe, dvAdd: 2 })],
    abilities: [A.credibility, A.charismaticImpact], help: [S.humanPerception, S.wardrobe],
  }),
  permits: Object.freeze({
    skills: [S.bureaucracy, Object.freeze({ ...S.localExpert, dvAdd: 2 }), Object.freeze({ ...S.persuasion, dvAdd: 2 })],
    abilities: [A.backup], help: [S.localExpert, S.librarySearch],
  }),
  shortcuts: Object.freeze({ skills: [S.bribery, Object.freeze({ ...S.streetwise, dvAdd: 2 })], abilities: [A.operator], help: [S.streetwise, S.humanPerception] }),
});

/** The action ids a business at this stage can take. */
export const actionIdsFor = (stage) => (stage >= 2 ? COMPANY_ACTION_IDS : ACTION_IDS);
/** The definition of an action, for this stage. */
export const actionFor = (stage, id) => (stage >= 2 ? COMPANY_ACTIONS[id] : ACTIONS[id]) ?? null;

/** Employees' posts, in display order (DESIGN §32). */
export const POST_IDS = Object.freeze(['floor', 'manager', 'security', 'bookkeeper', 'sales', 'publicist', 'compliance']);

/**
 * What each post needs: the first stage it exists at, the skills and abilities that count for it
 * (`trade` adds the archetype's trade skills and abilities), and those that count a level lower.
 */
export const POSTS = Object.freeze({
  floor: Object.freeze({ stage: 0, uses: [], trade: true }),
  manager: Object.freeze({ stage: 0, uses: [S.business], lowerTrade: true }),
  security: Object.freeze({ stage: 0, uses: [S.tactics, S.brawling, S.handgun, S.meleeWeapon, S.humanPerception, A.combatAwareness, A.backup] }),
  bookkeeper: Object.freeze({ stage: 1, uses: [S.accounting], lower: [S.business] }),
  sales: Object.freeze({ stage: 2, uses: [S.business, S.persuasion, S.trading] }),
  publicist: Object.freeze({ stage: 2, uses: [S.composition, S.wardrobe, S.persuasion, A.credibility, A.charismaticImpact] }),
  compliance: Object.freeze({ stage: 2, uses: [S.bureaucracy, S.localExpert] }),
});

const byBand = (values) => Object.freeze(Object.fromEntries(['fumble', 'failure', 'narrow', 'solid', 'strong', 'exceptional'].map((b, i) => [b, values[i]])));

export const BUSINESS_DEFAULTS = Object.freeze({
  /**
   * Per stage: action slots, the DV step of its actions, the Capacity ceiling, weekly rent, licence fees
   * and protection money, the fix-up scale, and the expansion project it can take on (eb, Capacity
   * gained, business days of work). Registering trades protection money for rent and licence fees.
   */
  stages: Object.freeze([
    Object.freeze({ slots: 1, dv: 'everyday', capacityCap: 1.6, rent: 7, licence: 0, protection: 8, fixUpScale: 1, expansion: Object.freeze({ cost: 1500, gain: 0.25, days: 3 }) }),
    Object.freeze({ slots: 2, dv: 'difficult', capacityCap: 4.5, rent: 25, licence: 10, protection: 5, fixUpScale: 6, expansion: Object.freeze({ cost: 2500, gain: 0.8, days: 6 }) }),
    // A chartered company (B4): the B0 prototype's stage 2, with 150 eb a week of fixed costs.
    Object.freeze({ slots: 3, dv: 'professional', capacityCap: 14, rent: 90, licence: 45, protection: 15, fixUpScale: 14, expansion: Object.freeze({ cost: 8000, gain: 1.5, days: 9 }) }),
  ]),
  /** Business days each partner with a vote has a week, for projects and extra time, without Crew Tools. */
  businessDays: 3,
  /**
   * Projects beside an expansion (the stage's `expansion` above): paid from the cash when the partners
   * agree, then finished with business days, one project at a time. `cost` and `days` are by stage.
   *   refit       the Cost base down `cut` at once, never below its floor; again whenever there is room
   *   security    levels up to `levels`: each cuts protection money by `protection`, and break-ins come
   *               `breakIns` times as often per level
   *   storefront  Reputation up `reputation` at once, once a stage; once there is one, Reputation
   *               settles `target` higher
   *   staffRoom   once a stage: `headcount` more places each, and paid weeks lift NPC staff loyalty to
   *               `paidCap` rather than 60
   */
  projects: Object.freeze({
    refit: Object.freeze({ cost: Object.freeze([600, 1500, 5000]), days: Object.freeze([2, 4, 6]), cut: 0.05 }),
    security: Object.freeze({ cost: Object.freeze([800, 2000, 6000]), days: Object.freeze([2, 3, 5]), levels: 2, protection: 0.25, breakIns: 0.5 }),
    storefront: Object.freeze({ cost: Object.freeze([700, 1800, 6000]), days: Object.freeze([2, 4, 6]), reputation: 5, target: 3 }),
    staffRoom: Object.freeze({ cost: Object.freeze([500, 1200, 4000]), days: Object.freeze([2, 3, 5]), headcount: 1, paidCap: 70 }),
  }),
  /** Side business to registered business (DESIGN §27.0). Bureaucracy, or Local Expert or Persuasion at DV +2. */
  registration: Object.freeze({
    // Reputation drifts back toward 50 and events knock it down, so the bar is near that baseline, not on it.
    fee: 500, minWeeks: 4, minProfit: 100, minReputation: 45, dv: 'difficult', delay: 7, fumbleDelay: 14,
    uses: Object.freeze([SKILLS.bureaucracy, Object.freeze({ ...SKILLS.localExpert, dvAdd: 2 }), Object.freeze({ ...SKILLS.persuasion, dvAdd: 2 })]),
    /** The registration roll's band sets the Compliance the registered business starts with. */
    compliance: Object.freeze({ narrow: 45, solid: 50, strong: 55, exceptional: 60 }),
  }),
  /** Registered business to chartered company (DESIGN §31, B4a). */
  charter: Object.freeze({
    fee: 2000, minWeeks: 12, minProfit: 400, minExpansions: 1,
    /** The three rolls: each part's DV step and skills (alternatives at DV +2). A track record makes the plan easier. */
    parts: Object.freeze({
      plan: Object.freeze({ dv: 'everyday', uses: Object.freeze([SKILLS.business, Object.freeze({ ...SKILLS.persuasion, dvAdd: 2 }), Object.freeze({ ...SKILLS.trading, dvAdd: 2 })]) }),
      registration: Object.freeze({ dv: 'difficult', uses: Object.freeze([SKILLS.bureaucracy, Object.freeze({ ...SKILLS.localExpert, dvAdd: 2 }), Object.freeze({ ...SKILLS.persuasion, dvAdd: 2 })]) }),
      capital: Object.freeze({ dv: 'difficult', uses: Object.freeze([SKILLS.accounting, Object.freeze({ ...SKILLS.business, dvAdd: 2 })]) }),
    }),
    /** A failed capital structure roll: game days before the partners may try again. Passed parts are kept this long. */
    refile: 7, fumbleRefile: 14, keepDays: 30,
    /** The Startup tier's range for the capital quote (§27.2a), times the sector factor. */
    kmin: 5000, kmax: 12000,
    sectorFactor: Object.freeze({ media: 0.8, consumer: 0.8, security: 1.3, arms: 1.3, biotech: 1.5, energy: 1.5 }),
    /** Each business type's market sector. */
    sectors: Object.freeze({
      clinic: 'health', garage: 'transport', bar: 'consumer', infoShop: 'tech', boutique: 'consumer',
      gunShop: 'arms', courier: 'transport', security: 'security', media: 'media', foodStall: 'consumer',
    }),
    /** The business plan's band shifts Reputation, the registration's Compliance, when the company is formed. */
    reputation: byBand([-8, -5, 0, 3, 5, 8]),
    compliance: byBand([-10, -6, 0, 3, 5, 8]),
    fundingDays: 14,
    /** Owners may pay in up to this much over the shortfall. */
    extraShare: 0.5,
  }),
  /** Compliance (registered businesses) drifts back toward this, like Reputation. */
  complianceBaseline: 50,
  /** Proposals lapse after this many game days without passing. */
  proposalDays: 7,
  /** What each band does. `work` multiplies the week's takings; the rest add to the state. */
  effects: Object.freeze({
    work: byBand([0.6, 0.85, 1.0, 1.1, 1.2, 1.35]),
    promote: byBand([-3, 0, 2, 4, 6, 8]),
    source: byBand([-0.02, 0, 0.01, 0.02, 0.03, 0.04]),
    fixUp: byBand([-0.02, 0, 0.03, 0.05, 0.07, 0.1]),
    /** The share of the week's protection money saved; a fumble pays half as much again. */
    keepSafe: byBand([-0.5, 0, 0.25, 0.5, 0.75, 1]),
  }),
  /** Takings in a week nobody works the shop: between a failed and a narrow roll. */
  unworked: 0.9,
  /** Reputation drifts this share of the way back to 50 each week; the Cost base creeps up. */
  reputationDrift: 0.03,
  costCreep: 0.005,
  costFloor: 0.75,
  setupDv: 'everyday',
  /** The setup roll's band sets the Capacity the business opens with. */
  setupCapacity: Object.freeze({ narrow: 0.85, solid: 1, strong: 1.1, exceptional: 1.2 }),
  /** A failed setup loses this share of the archetype's lowest setup cost and waits this many game days. */
  setupFailure: Object.freeze({ loss: 1 / 3, delay: 7 }),
  setupFumble: Object.freeze({ loss: 1 / 2, delay: 14 }),
  /** Either loss is capped at this share of the money held for the business. */
  setupLossCap: 0.5,
  helpDv: 'everyday',
  /**
   * A chartered company's actions (bands: fumble, failure, narrow, solid, strong, exceptional).
   * Contracts multiply the week's takings and lift Reputation a little; the books cut the Cost base;
   * investor relations lift Reputation; permits lift Compliance and cut the protection money;
   * shortcuts (Bribery) multiply the takings most, and always add Exposure.
   */
  company: Object.freeze({
    contracts: byBand([0.6, 0.85, 1.0, 1.12, 1.22, 1.38]),
    contractsReputation: byBand([-2, 0, 1, 1, 2, 3]),
    books: byBand([-0.03, 0, 0.015, 0.03, 0.045, 0.06]),
    relations: byBand([-3, 0, 2, 4, 6, 8]),
    permits: byBand([-6, 0, 2, 4, 6, 8]),
    permitsProtection: byBand([-0.5, 0, 0.25, 0.5, 0.75, 1]),
    shortcuts: byBand([0.7, 0.9, 1.15, 1.3, 1.45, 1.6]),
    shortcutsExposure: byBand([12, 6, 3, 3, 2, 2]),
    /** A fumbled shortcut is noticed: Compliance falls this much. */
    shortcutsFumbleCompliance: 8,
  }),
  /**
   * The monthly report (DESIGN §27.4): every 4 weeks after the charter the company sums its weeks. In
   * the report's last week an officer may prepare it (Accounting, Business at DV +2): the band shifts
   * the profit it reports, Bold (aggressive reporting) doubles the shift and adds Exposure. The total is
   * kept, for an audit later (§27.6).
   */
  /**
   * Information rolls (DESIGN §27.4, B4c). An internal audit (Accounting, Business at DV +2) reveals the
   * company's own Exposure band and, on a strong or better roll, wipes some of it out; due diligence
   * (Library Search or Business) reveals another business's state bands and a range for its value.
   * Each costs eb from the company's cash and can be done once a week.
   */
  info: Object.freeze({
    dv: 'difficult',
    auditUses: Object.freeze([S.accounting, Object.freeze({ ...S.business, dvAdd: 2 })]),
    diligenceUses: Object.freeze([S.librarySearch, S.business]),
    auditCost: 300,
    diligenceCost: 200,
    cooldown: 7,
    auditCut: Object.freeze({ strong: 5, exceptional: 10 }),
    /** Exposure bands: below each threshold. */
    exposureBands: Object.freeze([[5, 'clean'], [15, 'low'], [30, 'moderate'], [Infinity, 'high']]),
    /** Due diligence's value range: ± this share of book value, by band. */
    spread: Object.freeze({ narrow: 0.3, solid: 0.2, strong: 0.1, exceptional: 0.05 }),
    intelCap: 5,
  }),
  report: Object.freeze({
    weeks: 4,
    dv: 'difficult',
    uses: Object.freeze([S.accounting, Object.freeze({ ...S.business, dvAdd: 2 })]),
    shift: byBand([-0.08, -0.03, 0, 0.03, 0.06, 0.1]),
    boldExposure: 4,
    cap: 12,
  }),
  /**
   * Going public (B5, DESIGN §27.4a). V must reach `threshold` (a world setting overrides it) on the
   * last `sustained` reports, with `minReports` reports and `minDays` since the charter, Compliance at
   * `compliance`, and hidden Exposure under `exposureCap`. Cash paid in counts toward V only after
   * `lockinDays`. Agreeing pays `fee` of V. The prospectus rolls are at DV `dv`; a failure waits
   * `retryDays`. The offer price is V per share times 1 + the rolls' `factor` (each doubled if Bold,
   * within `maxFactor`); the float the shareholders agree (`minFloat` to `maxFloat`) is capped by the
   * offering's `demand`. After listing, the rest is locked for `lockupDays`.
   */
  /**
   * A company's capital (B6a). New shares: `minPct` to `maxPct` of the shares there are, in `step`s; a
   * rights issue is open `windowDays`. Buybacks: a budget of at least `minBudget`; a tender is open
   * `windowDays`. A listed company's offering roll (`offering`) sets the discount to the market price
   * (a failure pulls it, and the price takes `failHit`); its subscription window is `windowDays`. A
   * buyback's timing roll (`timing`) sets what it pays over or under the market price.
   */
  /**
   * Takeovers (B6b): a tender offer is open `days`. NPC holders and the market's float tender all their
   * shares at a premium of `accept.all` over the reference price or more, half at `accept.half` or more,
   * none below; the target's officers' defence roll moves both bars by its `shift`.
   */
  takeover: Object.freeze({
    days: 7,
    accept: Object.freeze({ all: 0.2, half: 0.1 }),
    defence: Object.freeze({
      dv: 'professional',
      uses: Object.freeze([S.persuasion, S.business]),
      shift: byBand([-0.05, 0, 0.03, 0.05, 0.08, 0.12]),
    }),
  }),
  capital: Object.freeze({
    issue: Object.freeze({ minPct: 0.05, maxPct: 0.3, step: 0.05, windowDays: 14 }),
    buyback: Object.freeze({ minBudget: 500, windowDays: 14 }),
    offering: Object.freeze({
      dv: 'professional', windowDays: 5, failHit: -0.03,
      uses: Object.freeze([S.trading, Object.freeze({ ...S.persuasion, dvAdd: 2 })]),
      discount: byBand([0, 0, 0.1, 0.05, 0.03, 0]),
    }),
    timing: Object.freeze({
      dv: 'professional',
      uses: Object.freeze([S.trading, Object.freeze({ ...S.business, dvAdd: 2 })]),
      price: byBand([0.03, 0.02, 0, -0.02, -0.04, -0.06]),
    }),
  }),
  listing: Object.freeze({
    threshold: 500000, sustained: 3, minReports: 3, minDays: 56, compliance: 50, exposureCap: 15, lockinDays: 28,
    fee: 0.02, dv: 'professional', retryDays: 14, minFloat: 0.2, maxFloat: 0.4, floatStep: 0.05, lockupDays: 28, maxFactor: 0.15,
    /** The IPO's subscription window, from the offer being set to the listing day (B5b). */
    ipoWindowDays: 5,
    /** After listing (B5c): a report moves fair value toward V per share, at most this far (a log-return) either way, from the day after. */
    earningsCap: 0.5,
    earningsDelayDays: 1,
    /** Dividends after listing (B5c, §27.7): the payout ratio by default and its steps, at most `monthlyYield` of V a month, at most `holderCap` eb to one holder. */
    dividend: Object.freeze({ payout: 0.3, step: 0.1, monthlyYield: 0.01, holderCap: 5000 }),
    /** The liquidity cap (B5c): each market day the market buys at most this share of the float from players, by the offering's demand, plus `perOperatorRank` for each rank of a Fixer officer's Operator. */
    liquidity: Object.freeze({ daily: byBand([0.1, 0.1, 0.1, 0.15, 0.2, 0.3]), perOperatorRank: 0.02 }),
    /** The delisting review (B5c): market value under `below` of the threshold on `reports` reports in a row puts it under review, and the price takes `hit` (a log-return). */
    review: Object.freeze({ below: 0.6, reports: 3, hit: -0.05 }),
    multiples: Object.freeze({ tech: 14, biotech: 13, health: 12, finance: 11, security: 10, arms: 10, media: 9, energy: 9, transport: 8, construction: 7, consumer: 7, other: 6 }),
    uses: Object.freeze({
      filing: Object.freeze([S.accounting, Object.freeze({ ...S.business, dvAdd: 2 })]),
      offering: Object.freeze([S.trading, Object.freeze({ ...S.persuasion, dvAdd: 2 })]),
    }),
    factor: byBand([0, 0, -0.05, 0, 0.07, 0.15]),
    demand: byBand([0.2, 0.2, 0.2, 0.25, 0.3, 0.4]),
  }),
  /**
   * Employees (DESIGN §32, E1). An employee's base for a post is their best stat + skill among the
   * post's skills (a fitting role ability counts as its rank + `abilityBonus`, a skill a level lower
   * takes `lowerBy` off), read as a level. Their wage is a rate per point of that base each week,
   * times the share of the going rate the partners offered. Overtime pays a share of a week's wage.
   */
  staff: Object.freeze({
    /** The most employees by stage. Floor staff are also limited to the Capacity, rounded down. */
    headcount: Object.freeze([1, 3, 8]),
    /** Levels: up to and including each base. */
    levels: Object.freeze([[8, 'green'], [12, 'skilled'], [15, 'expert'], [Infinity, 'master']]),
    /** A recruit has their own base in their post's skills (see `recruit`); everything else they roll at this. */
    recruitOther: 7,
    abilityBonus: 9,
    lowerBy: 3,
    /** eb a week per point of base, by stage (part-time at a side business). */
    rate: Object.freeze([5, 9, 14]),
    /**
     * Masters ask more (E2): each point of base above `premiumFrom` costs `premium` times the rate on
     * top, so the best margin is at Expert until a company is near its ceiling.
     */
    premiumFrom: 15,
    premium: 2,
    /** The share of the going rate the partners may offer. */
    offer: Object.freeze({ min: 0.8, max: 1.5 }),
    /** Floor staff lift the takings by (base − floorBase) × floorLift each; sales by half that. In total, at most the stage's cap. */
    floorBase: 6,
    floorLift: 0.015,
    salesShare: 0.5,
    liftCap: Object.freeze([0.15, 0.35, 0.6]),
    /** With a salesperson, Reputation drifts toward this rather than 50. */
    salesReputation: 55,
    /** By level: a bookkeeper's weekly cut to the Cost base, a publicist's Reputation, a compliance officer's Compliance. */
    bookkeeper: Object.freeze({ green: 0.003, skilled: 0.005, expert: 0.0075, master: 0.01 }),
    publicist: Object.freeze({ green: 0.5, skilled: 0.8, expert: 1.2, master: 1.5 }),
    compliance: Object.freeze({ green: 0.5, skilled: 0.8, expert: 1.2, master: 1.5 }),
    /** Overtime, as a share of a week's wage: a roll of the business's own, or a complementary check. */
    overtime: Object.freeze({ roll: 0.5, help: 0.25 }),
    maxShifts: 2,
    /** A fired employee is paid this many weeks' wages. */
    severanceWeeks: 1,
    /**
     * Loyalty (E2, DESIGN §32.4), 0 to 100, for NPCs and recruits (a player character's is the
     * player's own). It starts at `start`, moved `perTen` for each 10% of the going rate offered above
     * or below it; a paid week adds `paidWeek` up to `paidCap`, a profitable month `profitMonth`, a
     * bonus `bonusPerQuarter` for each quarter of a week's wage. Below `quitBelow` an employee may quit
     * as a week closes (`quitChance`), below `walkBelow` they walk out, and `unpaidWeeks` weeks owed
     * in a row make them quit. At `devoted` they get +1 on overtime, shrug off poaching, and security
     * or compliance answers a band better.
     */
    loyalty: Object.freeze({
      start: 50, perTen: 5, paidWeek: 2, paidCap: 60, missed: -15, profitMonth: 3, bonusPerQuarter: 5, extraShift: -3,
      cut: -10, refused: -10, unanswered: -2, dispute: -5,
      quitBelow: 25, quitChance: 0.25, walkBelow: 10, unpaidWeeks: 2, devoted: 75, dedicatedFloor: 40,
      bands: Object.freeze([[24, 'sullen'], [49, 'steady'], [74, 'loyal'], [Infinity, 'devoted']]),
    }),
    /** A bonus is paid in quarters of a week's wage, at most this many, once a week per employee. */
    bonusQuarters: 4,
    /**
     * Training (E3): once every `every` days an NPC employee's best skill for their post rises by 1, for
     * `perPoint` eb per point of it now (`courseFactor` times that on a course, with no mentor), at most
     * `max` over what training has added and never above `cap`. A mentor is a partner whose own base
     * in the skill is higher, and spends `mentorDays` business days on it.
     */
    /**
     * Share grants (E3, company only): new shares without a vote for an employee, sized as a share of
     * the company (`step` to `max`, all grants together no more than `max`), vesting after `vestDays`;
     * while vesting, loyalty rises by `loyalty` and stays at `floor` or above.
     */
    grants: Object.freeze({ max: 0.05, step: 0.005, vestDays: 84, loyalty: 20, floor: 50 }),
    /**
     * An Exec's team (E3): one member for each `per` ranks of Teamwork, rounded up; their base in their
     * role's skills by the Exec's rank (`bases`: up to and including each rank); `loyalty` to start.
     */
    team: Object.freeze({ per: 3, bases: Object.freeze([[3, 8], [6, 11], [9, 14], [Infinity, 16]]), loyalty: 75 }),
    training: Object.freeze({
      every: 28, perPoint: 50, courseFactor: 2, mentorDays: 2, max: 4, cap: 18,
      /** A mentor's roll (the user's choice): Education, or Persuasion a step harder, at the stage's DV. */
      uses: Object.freeze([S.education, Object.freeze({ ...S.persuasion, dvAdd: 2 })]),
      /** An exceptional lesson: they can train again after this many days. A fumble costs loyalty. */
      quickEvery: 14,
      fumbleLoyalty: -5,
    }),
    /** At each month's end an employee below `below` loyalty asks for `step` more of the going rate, until the next month's end. */
    raise: Object.freeze({ below: 50, step: 0.1 }),
    /** Vetting the applicants for a post: one roll checks them all. */
    vet: Object.freeze({ uses: Object.freeze([S.humanPerception, S.librarySearch, A.interface]), dv: 13, cost: 50 }),
    /**
     * Hidden traits, drawn with each applicant (`chance`, more often from a failed advert) and kept in
     * the GM's hidden state. A corp plant is drawn only at a company (loose lips in its place before).
     */
    traits: Object.freeze({
      chance: 0.2,
      failureChance: 0.35,
      weights: Object.freeze({ lightFingers: 3, looseLips: 2, corpPlant: 1, moonlighter: 3, dedicated: 2, connected: 2 }),
      good: Object.freeze(['dedicated', 'connected']),
      /** Light fingers: the event comes this much more often, and costs this much more. */
      lightFingersWeight: 3,
      lightFingersLoss: 1.5,
      /** A moonlighter has other work one week in three, and turns overtime down. */
      moonlighting: 1 / 3,
      /** Connected: a manager's or salesperson's base counts this much higher, unseen. */
      connected: 3,
      /** A corp plant: Exposure each week, and on being fired. */
      plantExposure: 1,
      plantFired: 5,
    }),
    /** Staff events (DESIGN §32.4). */
    events: Object.freeze({
      /** Light fingers: the share of the week's takings that goes missing, unanswered. */
      theft: Object.freeze([0.05, 0.15]),
      /** An accident at work: medical costs by stage. */
      accident: Object.freeze([100, 250, 500]),
      /** A pay dispute needs this many staff, on average below this loyalty. */
      disputeStaff: 4,
      disputeLoyalty: 50,
      /** A star turn answered well: Reputation. */
      starTurn: 2,
      /** Firing a sullen employee: the chance of a grudge (vandalism) the next week. */
      grudge: 0.5,
      /** Archetypes where accidents happen. */
      accidents: Object.freeze(['garage', 'gunShop', 'security', 'courier']),
      /** Two jobs wear people down: a sick day or an accident this much more likely (E3). */
      twoJobsStrain: 4 / 3,
    }),
    /**
     * Advertising a job: the roll, its cost by stage, how often, and how long applicants wait. The band
     * sets how many apply (`count`, the seed picks within it), the range of their base in the post's
     * skills (`base`), and the range of what they ask, as a share of the going rate (`ask`): a poor
     * advert brings fewer, weaker applicants who ask more; a fumble brings nobody.
     */
    recruit: Object.freeze({
      uses: Object.freeze([S.business, S.streetwise, S.librarySearch]),
      cost: Object.freeze([50, 100, 200]),
      cooldown: 7,
      candidateDays: 7,
      count: Object.freeze({ failure: [1, 1], narrow: [1, 2], solid: [2, 2], strong: [2, 3], exceptional: [3, 3] }),
      base: Object.freeze({ failure: [6, 8], narrow: [7, 11], solid: [9, 12], strong: [10, 14], exceptional: [12, 17] }),
      ask: Object.freeze({ failure: [1.1, 1.4], narrow: [1.0, 1.3], solid: [0.95, 1.2], strong: [0.9, 1.15], exceptional: [0.85, 1.1] }),
      firstNames: Object.freeze(['Ana', 'Benji', 'Chen', 'Dara', 'Eli', 'Farah', 'Gus', 'Hana', 'Ivo', 'Jade', 'Kofi', 'Lupe', 'Marek', 'Nia', 'Oz', 'Priya', 'Rico', 'Suki', 'Teo', 'Vera']),
      lastNames: Object.freeze(['Alvarez', 'Brook', 'Cho', 'Dunn', 'Esposito', 'Faulk', 'Grant', 'Hale', 'Ito', 'Jansen', 'Kowalski', 'Lam', 'Moreau', 'Nakamura', 'Ortiz', 'Petrov', 'Ruiz', 'Silva', 'Tran', 'Voss']),
    }),
  }),
  /** A hired professional's fee by tier, from the till; a Fixer's Operator takes 5% off per rank, up to 40%. */
  hireFees: Object.freeze({ cheap: 50, good: 150, best: 400 }),
  operatorDiscount: Object.freeze({ perRank: 0.05, max: 0.4 }),
  /** Sweat equity is capped at this percentage of the units. */
  maxSweatPct: 10,
  buyoutDays: 14,
  /** Weeks of losses in a row with the till below zero that close the business. */
  failurePeriods: 2,
  /** What the gear fetches when a business closes: when it fails, and when the partners choose to. */
  salvage: Object.freeze({ failed: 0.25, closed: 0.5 }),
  /**
   * Weekly events (DESIGN §27.4): the chance of one each week before the district's risk, less once
   * registered. An event is answered with a slot and a roll before the week closes; unanswered, it
   * costs its share of the week's takings. A good event (a windfall) only pays if answered well.
   */
  events: Object.freeze({
    chance: 0.25,
    registeredFactor: 0.8,
    /** The share of the week's takings lost: unanswered, failed, fumbled. A success loses nothing. */
    loss: Object.freeze({ unanswered: 0.15, failure: 0.1, fumble: 0.2 }),
    /** A windfall answered well adds this share of the week's takings, by band. */
    windfall: byBand([0, 0, 0.05, 0.15, 0.2, 0.3]),
  }),
  /**
   * Money from outside (DESIGN §27.0). A fixer lends quickly at a steep weekly rate; a bank, to a
   * registered business only, after an Accounting or Business roll whose band sets the limit (in
   * weeks of average profit) and the rate. Repayments come out of the till as each week closes;
   * interest counts against the week's profit, the principal does not.
   */
  loans: Object.freeze({
    fixer: Object.freeze({ limits: Object.freeze([2000, 4000]), rate: 0.05, weeks: 10, lateFee: 0.1, reputation: -2 }),
    bank: Object.freeze({
      minStage: 1, dv: 'difficult', uses: Object.freeze([SKILLS.accounting, SKILLS.business]), weeks: 20, lateFee: 0.05, compliance: -10, delay: 14,
      limitWeeks: byBand([0, 0, 6, 10, 14, 20]),
      rate: byBand([0, 0, 0.015, 0.012, 0.01, 0.008]),
    }),
  }),
  /**
   * Investors, for registered businesses. A character buys new units at the price the partners
   * agreed. An NPC angel is won with a Persuasion or Trading roll against the angel's 12 + d10: the
   * band sets how much of the book value it puts in and the premium or discount on the unit price.
   */
  investors: Object.freeze({
    minStage: 1,
    angel: Object.freeze({
      base: 12, delay: 14, uses: Object.freeze([SKILLS.persuasion, SKILLS.trading]),
      /** Who the angel turns out to be. */
      names: Object.freeze(['Mira Sato', 'Dex Okafor', 'Lena Varga', 'Tomas Reyes', 'Ilse Brandt', 'Kai Mendoza', 'Yuki Hart', 'Rafael Quist']),
      share: byBand([0, 0, 0.2, 0.3, 0.4, 0.5]),
      premium: byBand([0, 0, -0.1, 0, 0.1, 0.2]),
    }),
  }),
  /**
   * Gigs run for a player's own business (DESIGN §27.5) change its business, not a share price:
   * Reputation at once, and next week's takings. The size follows the reward (a reward of `reward`
   * eb is size 1, within `size`), and each gig for the business in the last `windowDays` weakens the
   * next, so a crew cannot farm its own business.
   */
  gigs: Object.freeze({
    reward: 2000,
    size: Object.freeze([0.25, 1.5]),
    windowDays: 28,
    done: Object.freeze({ reputation: 4, takings: 0.1 }),
    failed: Object.freeze({ reputation: -6, takings: -0.1 }),
    boostCap: 0.3,
    logCap: 20,
  }),
  /** The most weekly closes run at once after the calendar jumps. */
  catchUpPeriods: 8,
  digestCap: 12,
  ledgerCap: 120,
  maxGearItems: 6,
  /** The most book value one item of gear may carry. */
  maxGearValue: 100000,
  maxPartners: 6,
});

/**
 * The kinds of event. `weight` is how often each comes up, `uses` answer it (with `trade` adding the
 * archetype's trade skills), `security` events are also covered by a successful Keep it safe that
 * week, and `hit` is what an unanswered or failed event does to the state on top of the lost takings.
 * `stage` limits an event to registered businesses.
 */
export const EVENTS = Object.freeze({
  shakedown: Object.freeze({ weight: 3, security: true, uses: [S.persuasion, S.streetwise, A.combatAwareness, A.backup], hit: Object.freeze({}) }),
  theft: Object.freeze({ weight: 2, security: true, uses: [S.perception, S.electronics, S.tactics, A.combatAwareness, A.interface], hit: Object.freeze({}) }),
  breakdown: Object.freeze({ weight: 2, trade: true, uses: [S.basicTech, A.maker], hit: Object.freeze({ capacity: -0.05 }) }),
  shortage: Object.freeze({ weight: 2, uses: [S.trading, S.streetwise, S.business, A.operator, A.moto], hit: Object.freeze({ costFactor: 0.02 }) }),
  rival: Object.freeze({ weight: 2, uses: [S.persuasion, S.business, S.composition, A.credibility, A.charismaticImpact], hit: Object.freeze({ reputation: -2 }) }),
  trouble: Object.freeze({ weight: 2, trade: true, uses: [S.humanPerception, S.persuasion, S.conversation], hit: Object.freeze({ reputation: -1 }) }),
  inspection: Object.freeze({ weight: 2, stage: 1, uses: [S.bureaucracy, Object.freeze({ ...S.localExpert, dvAdd: 2 }), Object.freeze({ ...S.bribery, dvAdd: 2 }), A.backup], hit: Object.freeze({ compliance: -8 }) }),
  windfall: Object.freeze({ weight: 2, good: true, trade: true, uses: [S.business, S.trading, A.operator], hit: Object.freeze({}) }),
  /** Never drawn: it comes the week after a missed fixer-loan payment. */
  collectors: Object.freeze({ weight: 0, security: true, uses: [S.persuasion, S.streetwise, S.trading, A.combatAwareness, A.operator], hit: Object.freeze({ reputation: -3 }) }),
  /** Never drawn: it may come the week after a sullen employee is fired. */
  grudge: Object.freeze({ weight: 0, security: true, uses: [S.persuasion, S.streetwise, S.tactics, A.combatAwareness], hit: Object.freeze({ reputation: -2, capacity: -0.05 }) }),
  /**
   * Staff events (E2, DESIGN §32.4): drawn only when the business has NPC staff, each settled in
   * businessPeople.js. `staffId` on the event names the employee it is about, where there is one.
   */
  sickDay: Object.freeze({ weight: 2, staff: true, uses: [S.paramedic, A.medicine], hit: Object.freeze({}) }),
  lightFingers: Object.freeze({ weight: 1, staff: true, uses: [S.humanPerception, S.interrogation, S.librarySearch], hit: Object.freeze({}) }),
  payDispute: Object.freeze({ weight: 3, staff: true, stage: 2, uses: [S.persuasion, S.business], hit: Object.freeze({}) }),
  poaching: Object.freeze({ weight: 2, staff: true, uses: [S.persuasion], hit: Object.freeze({}) }),
  accident: Object.freeze({ weight: 2, staff: true, uses: [S.paramedic, A.medicine], hit: Object.freeze({}) }),
  starTurn: Object.freeze({ weight: 2, staff: true, good: true, uses: [S.business, S.persuasion], hit: Object.freeze({}) }),
  /**
   * Two jobs (E3, DESIGN §32.5): drawn only when an NPC employee also works for another business
   * (`twoJobs`), about one of them; `rival` on the event names the other business.
   */
  doubleBooked: Object.freeze({ weight: 2, staff: true, twoJobs: true, uses: [S.persuasion, S.business], hit: Object.freeze({}) }),
  fullTimeOffer: Object.freeze({ weight: 1, staff: true, twoJobs: true, uses: [S.persuasion], hit: Object.freeze({}) }),
  talkingShop: Object.freeze({ weight: 2, staff: true, twoJobs: true, uses: [S.humanPerception, S.interrogation], hit: Object.freeze({}) }),
});

/** The DV for a stage's actions. */
export const stageDv = (stage, p = BUSINESS_DEFAULTS) => DV_LADDER[p.stages[stage]?.dv ?? 'everyday'];

/** Every way an action may be rolled: its own skills (or the trade skills, for work) and abilities. */
export function actionUses(actionId, archetype, stage = 0) {
  const action = actionFor(stage, actionId);
  if (!action) return [];
  const own = actionId === 'work' ? [...(archetype?.trade ?? [])] : [...action.skills];
  return [...own, ...action.abilities];
}

/**
 * Every way a complementary check for an action may be rolled: its `help` skills and the archetype's
 * abilities. As in the rules, a complementary check is a different, related skill, so the action's
 * own skills and abilities are left out (otherwise a lone owner would help themselves each week).
 */
export function helpUses(actionId, archetype, stage = 0) {
  const action = actionFor(stage, actionId);
  if (!action) return [];
  const own = new Set(actionUses(actionId, archetype, stage).map(useKey));
  return dedupeUses([...action.help, ...(archetype?.abilities ?? [])]).filter((u) => !own.has(useKey(u)));
}

/** Every way the setup roll may be rolled: the trade skills, Business, the archetype's abilities, Operator and Maker. */
export function setupUses(archetype) {
  return dedupeUses([...(archetype?.trade ?? []), S.business, ...(archetype?.abilities ?? []), A.operator, A.maker]);
}

export const useKey = (use) => (use.kind === 'ability' ? `ability:${use.ability}` : use.kind === 'hire' ? `hire:${use.hire}`
  : use.kind === 'staff' ? `staff:${use.staffId}` : `skill:${use.skill}`);

function dedupeUses(list) {
  const seen = new Set();
  return list.filter((u) => {
    const k = useKey(u);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Is `use` one of `allowed` (a hire is checked separately)? */
export const usesInclude = (allowed, use) => !!use && allowed.some((u) => useKey(u) === useKey(use));
