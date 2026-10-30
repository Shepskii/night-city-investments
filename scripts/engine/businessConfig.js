/**
 * Business tables
 * @file scripts/engine/businessConfig.js
 * @description Archetypes, actions and the numbers the business loop runs on (DESIGN §26.0). The
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
  bribery: skill('Bribery', 'cool'),
  bureaucracy: skill('Bureaucracy', 'int'),
  business: skill('Business', 'int'),
  composition: skill('Composition', 'int'),
  conversation: skill('Conversation', 'emp'),
  cybertech: skill('Cybertech', 'tech'),
  driveLand: skill('Drive Land Vehicle', 'ref'),
  electronics: skill('Electronics/Security Tech', 'tech'),
  humanPerception: skill('Human Perception', 'emp'),
  landVehicleTech: skill('Land Vehicle Tech', 'tech'),
  librarySearch: skill('Library Search', 'int'),
  localExpert: skill('Local Expert', 'int'),
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
 * The five weekly actions (DESIGN §26.0). `skills` roll the action itself (`work` uses the
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
  /** Side business to registered business (DESIGN §26.0). Bureaucracy, or Local Expert or Persuasion at DV +2. */
  registration: Object.freeze({
    // Reputation drifts back toward 50 and events knock it down, so the bar is near that baseline, not on it.
    fee: 500, minWeeks: 4, minProfit: 100, minReputation: 45, dv: 'difficult', delay: 7, fumbleDelay: 14,
    uses: Object.freeze([SKILLS.bureaucracy, Object.freeze({ ...SKILLS.localExpert, dvAdd: 2 }), Object.freeze({ ...SKILLS.persuasion, dvAdd: 2 })]),
    /** The registration roll's band sets the Compliance the registered business starts with. */
    compliance: Object.freeze({ narrow: 45, solid: 50, strong: 55, exceptional: 60 }),
  }),
  /** Registered business to chartered company (DESIGN §32, B4a). */
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
    /** The Startup tier's range for the capital quote (§26.2a), times the sector factor. */
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
   * Weekly events (DESIGN §26.4): the chance of one each week before the district's risk, less once
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
   * Money from outside (DESIGN §26.0). A fixer lends quickly at a steep weekly rate; a bank, to a
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
   * Gigs run for a player's own business (DESIGN §26.5) change its business, not a share price:
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
});

/** The DV for a stage's actions. */
export const stageDv = (stage, p = BUSINESS_DEFAULTS) => DV_LADDER[p.stages[stage]?.dv ?? 'everyday'];

/** Every way an action may be rolled: its own skills (or the trade skills, for work) and abilities. */
export function actionUses(actionId, archetype) {
  const action = ACTIONS[actionId];
  if (!action) return [];
  const own = actionId === 'work' ? [...(archetype?.trade ?? [])] : [...action.skills];
  return [...own, ...action.abilities];
}

/**
 * Every way a complementary check for an action may be rolled: its `help` skills and the archetype's
 * abilities. As in the rules, a complementary check is a different, related skill, so the action's
 * own skills and abilities are left out (otherwise a lone owner would help themselves each week).
 */
export function helpUses(actionId, archetype) {
  const action = ACTIONS[actionId];
  if (!action) return [];
  const own = new Set(actionUses(actionId, archetype).map(useKey));
  return dedupeUses([...action.help, ...(archetype?.abilities ?? [])]).filter((u) => !own.has(useKey(u)));
}

/** Every way the setup roll may be rolled: the trade skills, Business, the archetype's abilities, Operator and Maker. */
export function setupUses(archetype) {
  return dedupeUses([...(archetype?.trade ?? []), S.business, ...(archetype?.abilities ?? []), A.operator, A.maker]);
}

export const useKey = (use) => (use.kind === 'ability' ? `ability:${use.ability}` : use.kind === 'hire' ? `hire:${use.hire}` : `skill:${use.skill}`);

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
