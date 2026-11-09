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

/**
 * Districts from Night City Map that the list above does not have, as the GM's setting holds them. They live here so
 * that the weekly close and the events need no new arguments; `DistrictService` keeps this in step on every client.
 */
let extraDistricts = {};

export function setExtraDistricts(defs = {}) {
  extraDistricts = Object.fromEntries(Object.entries(defs ?? {}).filter(([id, d]) => !Object.hasOwn(DISTRICTS, id) && Number.isFinite(d?.traffic)));
}

export const districtOf = (id) => (Object.hasOwn(DISTRICTS, id) ? DISTRICTS[id] : Object.hasOwn(extraDistricts, id) ? extraDistricts[id] : { id: '', traffic: 1, rent: 1, risk: 1 });

/** Whether a business or faction may be in this district: one of ours, or one remembered from the map, even if the map has since lost it. */
export const isDistrict = (id) => Object.hasOwn(DISTRICTS, id) || Object.hasOwn(extraDistricts, id);

export const districtIds = () => [...Object.keys(DISTRICTS), ...Object.keys(extraDistricts)];

/**
 * A new district's numbers, by the map's danger (1 corporate to 5 hot zone): the rounded average of the districts above at
 * that danger. Danger 0 is water, which holds no businesses. Anything else gets plain numbers, for the GM to adjust.
 */
export const DISTRICT_DANGER = Object.freeze({
  1: Object.freeze({ traffic: 1.2, rent: 1.5, risk: 0.65 }),
  2: Object.freeze({ traffic: 1, rent: 1, risk: 0.95 }),
  3: Object.freeze({ traffic: 0.95, rent: 0.95, risk: 1.2 }),
  4: Object.freeze({ traffic: 0.8, rent: 0.65, risk: 1.5 }),
  5: Object.freeze({ traffic: 0.6, rent: 0.5, risk: 2 }),
});
const PLAIN_DISTRICT = Object.freeze({ traffic: 1, rent: 1, risk: 1 });

/** Numbers as the GM typed them, within what the module's own districts span and a little more. */
export function cleanDistrictNumbers({ traffic, rent, risk } = {}) {
  const fit = (value, low, high) => Math.max(low, Math.min(high, Math.round((Number(value) || 1) * 100) / 100));
  return { traffic: fit(traffic, 0.2, 2), rent: fit(rent, 0.2, 2), risk: fit(risk, 0.2, 3) };
}

/**
 * Bring the remembered districts up to date with the map's. Ours are skipped, and so is water. One the map has lost is kept.
 * @param {object} defs - id to `{id, name, danger, traffic, rent, risk, edited}`
 * @param {{id: string, en?: string, ru?: string, danger?: number}[]} list - the map's; its own names are in `ru`, with `en` empty
 * @returns {{defs: object, changed: boolean}}
 */
export function mergeMapDistricts(defs, list) {
  const next = { ...defs };
  let changed = false;
  for (const d of list ?? []) {
    if (!d?.id || Object.hasOwn(DISTRICTS, d.id) || d.danger === 0) continue;
    const name = d.en || d.ru || d.id;
    const was = next[d.id];
    const numbers = was?.edited ? {} : DISTRICT_DANGER[d.danger] ?? PLAIN_DISTRICT;
    const entry = { ...was, id: d.id, name, danger: d.danger ?? null, ...numbers };
    if (JSON.stringify(entry) !== JSON.stringify({ ...was })) {
      next[d.id] = entry;
      changed = true;
    }
  }
  return { defs: next, changed };
}

/** In display order. */
export const ACTION_IDS = Object.freeze(['work', 'promote', 'source', 'fixUp', 'keepSafe', 'court', 'respects', 'campaign', 'supply', 'venue']);

/**
 * The weekly actions (DESIGN §27.0; `court` and `respects`, F1b). `skills` roll the action itself (`work` uses the
 * archetype's trade skills); `help` are the extra skills and abilities a complementary check for it
 * may use, on top of the action's own.
 */
export const ACTIONS = Object.freeze({
  work: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.humanPerception, A.medicine, A.charismaticImpact] }),
  promote: Object.freeze({ skills: [S.persuasion, S.wardrobe, S.composition], abilities: [A.credibility, A.charismaticImpact], help: [S.streetwise, S.localExpert] }),
  source: Object.freeze({ skills: [S.trading, S.streetwise], abilities: [A.operator, A.moto], help: [S.business, S.localExpert] }),
  fixUp: Object.freeze({ skills: [S.basicTech], abilities: [A.maker], help: [S.electronics, S.landVehicleTech] }),
  keepSafe: Object.freeze({ skills: [S.tactics, S.persuasion], abilities: [A.combatAwareness, A.backup], help: [S.streetwise, S.humanPerception] }),
  court: Object.freeze({ skills: [S.business, S.persuasion, S.trading], abilities: [A.operator, A.charismaticImpact, A.credibility], help: [S.humanPerception, S.librarySearch] }),
  respects: Object.freeze({ skills: [S.streetwise, S.persuasion], abilities: [A.operator, A.charismaticImpact], help: [S.localExpert, S.humanPerception] }),
  supply: Object.freeze({ skills: [], abilities: [A.moto], help: [S.driveLand, S.trading], roleOnly: true }),
  venue: Object.freeze({ skills: [], abilities: [A.charismaticImpact], help: [S.playInstrument, S.persuasion], roleOnly: true }),
  campaign: Object.freeze({ skills: [S.composition, S.persuasion, S.librarySearch], abilities: [A.interface], help: [S.humanPerception, S.streetwise] }),
  roomWork: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.humanPerception] }),
  launder: Object.freeze({ skills: [], abilities: [], help: [S.business, S.librarySearch] }),
  payOff: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.persuasion] }),
  dealGang: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.localExpert] }),
  bigNight: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.persuasion] }),
  coverTrail: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.librarySearch] }),
  newSupplier: Object.freeze({ skills: [], abilities: [], help: [S.trading, S.streetwise] }),
  callFavour: Object.freeze({ skills: [], abilities: [], help: [S.persuasion, S.streetwise] }),
  clientWash: Object.freeze({ skills: [], abilities: [], help: [S.business, S.librarySearch] }),
  produce: Object.freeze({ skills: [], abilities: [A.maker], help: [S.basicTech, S.trading] }),
  fence: Object.freeze({ skills: [S.trading, S.streetwise], abilities: [A.operator], help: [S.business, S.localExpert] }),
});

/** A chartered company's five actions (DESIGN §27.4, §31): they replace the shop actions at stage 2. */
export const COMPANY_ACTION_IDS = Object.freeze(['contracts', 'books', 'relations', 'permits', 'shortcuts', 'campaign', 'supply', 'venue', 'dumping', 'bribeRegulator', 'blackOps']);

/** Each company action's skill, its alternatives at DV +2, the role abilities that fit, and its help. */
export const COMPANY_ACTIONS = Object.freeze({
  contracts: Object.freeze({
    skills: [S.business, Object.freeze({ ...S.persuasion, dvAdd: 2 }), Object.freeze({ ...S.trading, dvAdd: 2 })],
    abilities: [A.teamwork, A.operator, A.maker], help: [S.librarySearch, S.humanPerception],
  }),
  produce: Object.freeze({ skills: [], abilities: [A.maker], help: [S.basicTech, S.trading] }),
  fence: Object.freeze({ skills: [S.trading, S.streetwise], abilities: [A.operator], help: [S.business, S.localExpert] }),
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
  supply: Object.freeze({ skills: [], abilities: [A.moto], help: [S.driveLand, S.trading], roleOnly: true }),
  venue: Object.freeze({ skills: [], abilities: [A.charismaticImpact], help: [S.playInstrument, S.persuasion], roleOnly: true }),
  campaign: Object.freeze({ skills: [S.composition, S.persuasion, S.librarySearch], abilities: [A.interface], help: [S.humanPerception, S.streetwise] }),
  roomWork: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.humanPerception] }),
  launder: Object.freeze({ skills: [], abilities: [], help: [S.business, S.librarySearch] }),
  payOff: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.persuasion] }),
  dealGang: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.localExpert] }),
  bigNight: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.persuasion] }),
  coverTrail: Object.freeze({ skills: [], abilities: [], help: [S.streetwise, S.librarySearch] }),
  newSupplier: Object.freeze({ skills: [], abilities: [], help: [S.trading, S.streetwise] }),
  callFavour: Object.freeze({ skills: [], abilities: [], help: [S.persuasion, S.streetwise] }),
  clientWash: Object.freeze({ skills: [], abilities: [], help: [S.business, S.librarySearch] }),
  // Corporate crime (U1c).
  dumping: Object.freeze({ skills: [S.business, Object.freeze({ ...S.trading, dvAdd: 2 })], abilities: [A.operator], help: [S.accounting, S.bureaucracy] }),
  bribeRegulator: Object.freeze({ skills: [S.bribery], abilities: [A.operator], help: [S.bureaucracy, S.persuasion] }),
  blackOps: Object.freeze({ skills: [S.tactics, S.streetwise], abilities: [A.operator, A.interface], help: [S.librarySearch, S.humanPerception] }),
});

/**
 * What each front can hide (U1a, DESIGN §36.1), and the skills and abilities each is worked with. Where a front
 * has more than one, the partners choose when they open it.
 */
/** A kind of back room: its profile (`backRoom.profiles`) and what it rolls. */
const roomKind = (profile, uses) => Object.freeze({ profile, uses: Object.freeze(uses) });

export const BACK_ROOMS = Object.freeze({
  clinic: Object.freeze({
    ripping: roomKind('steady', [S.cybertech, S.paramedic, A.medicine]),
    backAlleySurgery: roomKind('quiet', [S.paramedic, S.cybertech, A.medicine]),
    streetPharmacy: roomKind('hungry', [S.paramedic, S.trading, A.medicine]),
    organBrokering: roomKind('loud', [S.cybertech, S.streetwise, A.medicine]),
  }),
  garage: Object.freeze({
    chopShop: roomKind('steady', [S.basicTech, S.landVehicleTech, A.maker]),
    vehicleCloning: roomKind('quiet', [S.landVehicleTech, S.electronics, A.maker]),
    getawayOutfitting: roomKind('connected', [S.landVehicleTech, S.streetwise, A.maker]),
  }),
  bar: Object.freeze({
    gambling: roomKind('steady', [S.streetwise, S.persuasion, A.charismaticImpact]),
    brothel: roomKind('steady', [S.persuasion, S.humanPerception, S.wardrobe, A.charismaticImpact]),
    fightPit: roomKind('loud', [S.streetwise, S.brawling, A.charismaticImpact]),
    fixersRoom: roomKind('connected', [S.conversation, S.streetwise, A.operator]),
  }),
  infoShop: Object.freeze({
    dataFence: roomKind('steady', [S.librarySearch, A.interface]),
    identityForgery: roomKind('quiet', [S.librarySearch, S.bureaucracy, A.interface]),
    blackIce: roomKind('loud', [S.electronics, S.librarySearch, A.interface]),
  }),
  gunShop: Object.freeze({
    blackArms: roomKind('steady', [S.weaponstech, S.trading, A.operator]),
    illegalMods: roomKind('quiet', [S.weaponstech, S.basicTech, A.maker]),
    armingGang: roomKind('connected', [S.trading, S.streetwise, A.operator]),
  }),
  courier: Object.freeze({
    smuggling: roomKind('steady', [S.driveLand, S.localExpert, A.moto]),
    hotGoods: roomKind('quiet', [S.driveLand, S.streetwise, A.moto]),
    peopleRunning: roomKind('loud', [S.driveLand, S.streetwise, A.moto]),
  }),
  boutique: Object.freeze({
    launderette: roomKind('laundering', [S.business, S.streetwise]),
    newFaces: roomKind('quiet', [S.personalGrooming, S.wardrobe, A.medicine]),
    counterfeits: roomKind('hungry', [S.wardrobe, S.trading, A.maker]),
    secondBooks: roomKind('laundering', [S.accounting, S.business]),
  }),
  foodStall: Object.freeze({
    deadDrop: roomKind('steady', [S.business, S.streetwise]),
    streetDealing: roomKind('hungry', [S.streetwise, S.localExpert, A.operator]),
    lookouts: roomKind('connected', [S.streetwise, S.localExpert, A.operator]),
    cashTill: roomKind('laundering', [S.business, S.accounting]),
  }),
  media: Object.freeze({
    blackmail: roomKind('steady', [S.composition, S.photography, A.credibility]),
    bootlegs: roomKind('hungry', [S.photography, S.electronics, A.credibility]),
    paidStories: roomKind('connected', [S.composition, S.persuasion, A.credibility]),
  }),
  security: Object.freeze({
    racket: roomKind('steady', [S.tactics, S.persuasion, A.combatAwareness]),
    protection: roomKind('connected', [S.tactics, S.streetwise, A.combatAwareness]),
    insideJobs: roomKind('loud', [S.tactics, S.interrogation, A.backup]),
  }),
});

/** The action ids a business at this stage can take. */
export const actionIdsFor = (stage) => (stage >= 2 ? COMPANY_ACTION_IDS : ACTION_IDS);
/** The definition of an action, for this stage. */
export const actionFor = (stage, id) => (stage >= 2 ? COMPANY_ACTIONS[id] : ACTIONS[id]) ?? null;

/** Employees' posts, in display order (DESIGN §32). */
export const POST_IDS = Object.freeze(['floor', 'manager', 'security', 'bookkeeper', 'sales', 'publicist', 'compliance', 'maker', 'hand', 'launderer', 'fixer']);

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
  /** Runs the workshop's line in a week no partner does (P1a). */
  maker: Object.freeze({ stage: 0, uses: [A.maker], trade: true }),
  /**
   * The back room's own posts (U1b), at `rate` times the going wage, each acting when nobody else did. The hand works
   * the room and the launderer washes its money, while there is one; the fixer pays people off when Exposure runs up,
   * and at a company, room or none, bribes the regulator.
   */
  hand: Object.freeze({ stage: 0, uses: [], trade: true, backRoom: true, rate: 1.5 }),
  launderer: Object.freeze({ stage: 0, uses: [S.accounting, S.business], backRoom: true, rate: 1.5 }),
  fixer: Object.freeze({ stage: 0, uses: [S.bribery, S.streetwise], backRoom: true, rate: 1.5 }),
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
    /** A back room (U1a): off the books, so what it costs is no asset. Not at a company, whose crime is its own (U1c). */
    backRoom: Object.freeze({ cost: Object.freeze([1500, 4000]), days: Object.freeze([3, 5]) }),
    /** A workshop (P1a): built again at a higher stage, it has that stage's benches. */
    workshop: Object.freeze({ cost: Object.freeze([1500, 4000, 12000]), days: Object.freeze([3, 5, 9]) }),
  }),
  /**
   * Production (P1a, DESIGN §36.10), checked with tools/simulate-production.mjs. `tiers` is the rulebook's Fabrication
   * table: the market price each category goes up to, the DV, bench days per item (8 hours a day), and materials, one
   * category lower. Each bench gives `benchDays` a week, and what is made is capped by `top` for the stage, `runMax` a
   * run and, for items that do not stack, `storeCap` on the shelves. `yield` is the share of a run that comes out
   * sellable, by band. `makes` is what each business type makes by default.
   */
  production: Object.freeze({
    benches: Object.freeze([1, 2, 4]),
    benchDays: 7,
    runMax: 20,
    storeCap: Object.freeze([25, 50, 100]),
    top: Object.freeze(['premium', 'veryExpensive', 'luxury']),
    tiers: Object.freeze([
      Object.freeze({ id: 'cheap', price: 10, dv: 9, days: 1 / 8, materials: 5 }),
      Object.freeze({ id: 'everyday', price: 20, dv: 9, days: 1 / 8, materials: 10 }),
      Object.freeze({ id: 'costly', price: 50, dv: 13, days: 6 / 8, materials: 20 }),
      Object.freeze({ id: 'premium', price: 100, dv: 17, days: 1, materials: 50 }),
      Object.freeze({ id: 'expensive', price: 500, dv: 21, days: 7, materials: 100 }),
      Object.freeze({ id: 'veryExpensive', price: 1000, dv: 24, days: 14, materials: 500 }),
      Object.freeze({ id: 'luxury', price: 5000, dv: 29, days: 28, materials: 1000 }),
      Object.freeze({ id: 'superLuxury', price: 10000, dv: 29, days: 28, materials: 5000 }),
    ]),
    yield: Object.freeze({ fumble: 0, failure: 0, narrow: 0.5, solid: 0.75, strong: 0.9, exceptional: 1 }),
    /**
     * Selling (P1b): the shop's `price` as a share of market price; a week's limit as `limitShare` of its takings, moved
     * by the Reputation band, with up to `bank` weeks of it carried over; what the shop keeps of a consigned item's sale.
     */
    sale: Object.freeze({
      price: 0.7,
      limitShare: 0.5,
      bank: 4,
      reputation: Object.freeze({ poor: 0.75, modest: 1, good: 1.1, excellent: 1.25 }),
      consignCut: 0.3,
    }),
    /**
     * Fencing (P1c): `price` as a share of market price, in dirty cash, or at a company, in its cash; a week's limit as
     * `limitShare` of its takings, times `band`; a company has no laundering to pay for, so `companyExposure` times the
     * back room's Exposure for the work.
     */
    fence: Object.freeze({
      price: 0.9,
      limitShare: 0.5,
      band: Object.freeze({ fumble: 0, failure: 0, narrow: 0.5, solid: 0.75, strong: 1, exceptional: 1.25 }),
      companyExposure: 2,
    }),
    makes: Object.freeze({
      gunShop: Object.freeze([{ type: 'weapon' }, { type: 'ammo' }, { type: 'itemUpgrade', kind: 'weapon' }]),
      garage: Object.freeze([{ type: 'itemUpgrade', kind: 'vehicle' }, { type: 'gear', names: ['Techtool', 'Tech Bag', 'Duct Tape', 'Flashlight', 'Road Flare', 'Rope (60m/yd)', 'Techscanner'] }]),
      clinic: Object.freeze([{ type: 'cyberware' }, { type: 'drug' }]),
      infoShop: Object.freeze([{ type: 'program' }, { type: 'cyberdeck' }, { type: 'itemUpgrade', kind: 'cyberdeck' }]),
      boutique: Object.freeze([{ type: 'clothing' }]),
      media: Object.freeze([{ type: 'gear', names: ['Audio Recorder', 'Video Camera', 'Memory Chip', 'Braindance Viewer', 'Virtuality Goggles', 'Radio Scanner/Music Player', 'Pocket Amplifier'] }]),
      bar: Object.freeze([{ type: 'gear', names: ['Kibble Pack', 'MRE', 'Food Stick'] }]),
      foodStall: Object.freeze([{ type: 'gear', names: ['Kibble Pack', 'MRE', 'Food Stick'] }]),
    }),
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
  /**
   * Companies owned and run by the GM's NPCs (N1, DESIGN §36.17). The owner's level is the base of the week's rolls.
   * A profile's actions are first choice first, as far as the stage's slots go. At its Reputation `target`, what wins
   * Reputation gives way to `fill`. The week's profit leaves as the owner's draw, as far as cash stays above `reserveWeeks` of the week's upkeep and wages.
   */
  npc: Object.freeze({
    levels: Object.freeze({ green: 9, skilled: 12, expert: 15, master: 17 }),
    profiles: Object.freeze({
      steady: Object.freeze({ shop: Object.freeze(['work', 'keepSafe', 'promote']), company: Object.freeze(['contracts', 'books', 'permits']), target: null }),
      growing: Object.freeze({ shop: Object.freeze(['work', 'promote', 'fixUp']), company: Object.freeze(['contracts', 'relations', 'books']), target: 70 }),
      costCutting: Object.freeze({ shop: Object.freeze(['work', 'source', 'keepSafe']), company: Object.freeze(['contracts', 'books', 'relations']), target: 60 }),
      shady: Object.freeze({ shop: Object.freeze(['work', 'source', 'promote']), company: Object.freeze(['contracts', 'shortcuts', 'relations']), target: 60 }),
    }),
    winsReputation: Object.freeze(['promote', 'relations']),
    fill: Object.freeze({ shop: 'keepSafe', company: 'permits' }),
    reserveWeeks: 8,
    minCash: 100,
    /** By stage: where it starts, and the staff it opens with, at the owner's level less `staffLess`. Roles are left open for the job board. */
    start: Object.freeze([
      Object.freeze({ capacity: 1, staff: Object.freeze([]) }),
      Object.freeze({ capacity: 3, staff: Object.freeze(['manager', 'floor']) }),
      Object.freeze({ capacity: 8, staff: Object.freeze(['manager', 'floor', 'floor', 'bookkeeper', 'sales']) }),
    ]),
    staffLess: 1,
    /**
     * The job board (N2): from which stage, how long a character waits between tries at one company, the base the
     * shown wage is worked out at, the share of the going rate each band of the application earns, and which bands
     * a world may hire without asking the GM.
     */
    jobs: Object.freeze({
      boardStage: 1,
      waitDays: 7,
      guideBase: 12,
      /** The most an NPC's company pays a player character, as a share of the wage the board shows. */
      wageCap: 1.5,
      pct: Object.freeze({ narrow: 0.9, solid: 1, strong: 1.1, exceptional: 1.2 }),
      autoBands: Object.freeze(['solid', 'strong', 'exceptional']),
    }),
  }),
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
  /**
   * Insolvency (B6c): a company with net assets below zero at `periods` closes in a row goes into
   * administration. Restructuring pays what it can from the cash (keeping `reserveWeeks` of upkeep) and
   * turns the rest of its debts into shares at `priceShare` of book value per share (at least `minPrice`),
   * with standing hits; winding up sells its assets at `salvage` of book value.
   * Going into administration dents a listed company's price by `hit` (a log-return).
   */
  /**
   * What roles bring (X1). A supply contract takes `cut` off the running costs for `weeks`, a fumble losing
   * `shipment` eb by stage. A gig at the venue adds `takings` and `reputation`, times `venueScale` at the `venues`.
   * Backup answers a raid or a case once in `backup.days`. Quashing costs `cost` eb, once in `days`, and takes
   * `reduce` heat and any pending penalty; a fumble adds `fumble`.
   */
  roles: Object.freeze({
    supply: Object.freeze({ weeks: 4, maxCut: 0.1, cut: byBand([0, 0, 0.03, 0.05, 0.08, 0.1]), shipment: Object.freeze([200, 500, 1500]) }),
    venue: Object.freeze({ takings: byBand([-0.05, 0, 0.05, 0.1, 0.15, 0.2]), reputation: byBand([-2, 0, 1, 2, 3, 4]), venues: Object.freeze(['bar']), venueScale: 1.5 }),
    backup: Object.freeze({ days: 28 }),
    quash: Object.freeze({ dv: 17, cost: 1000, days: 28, reduce: 25, fumble: 15 }),
  }),
  /**
   * A back room (U1a). A worked week earns `share` of what the front's Capacity would take, by the week's work
   * band. `workExposure` is what working it adds, by band; lying low takes `lieLow` off. Laundering moves up to
   * `launderCap` of the week's legitimate takings, `launderShare` of that by band, adding `launderExposure`, less
   * `bookkeeper` with one on the staff. A pay-off costs `payOff` eb of dirty cash by stage and moves Exposure by
   * `payOffExposure`. Taking cash straight adds `takeExposure` for each `takeEvery` eb.
   */
  backRoom: Object.freeze({
    /**
     * How each kind of room plays (U2, DESIGN §36.12), checked with tools/simulate-backrooms.mjs. `earn` scales its money,
     * and `swing` how far the band moves it; `exposure` scales what working it adds, and `quietWeek` is Exposure shed by a
     * week's work; `raid` scales the Exposure band's chance of a raid; `supply` is the share of what it earns spent on
     * stock, out of dirty cash; `launder` scales what can be washed in a week; `standing` is what a week's work adds with
     * the faction chosen on opening it. Steady is every room before U2.
     */
    profiles: Object.freeze({
      steady: Object.freeze({ earn: 1, swing: 1, exposure: 1, raid: 1, supply: 0, launder: 1, quietWeek: 0 }),
      loud: Object.freeze({ earn: 1.5, swing: 1.5, exposure: 1.5, raid: 1.25, supply: 0, launder: 1, quietWeek: 0 }),
      quiet: Object.freeze({ earn: 0.65, swing: 0.75, exposure: 0.5, raid: 0.5, supply: 0, launder: 1, quietWeek: 0 }),
      hungry: Object.freeze({ earn: 1.5, swing: 1, exposure: 1.25, raid: 1, supply: 0.25, launder: 1, quietWeek: 0 }),
      connected: Object.freeze({ earn: 0.5, swing: 1, exposure: 0.75, raid: 1, supply: 0, launder: 1, quietWeek: 0.5, standing: 1 }),
      laundering: Object.freeze({ earn: 0.8, swing: 1, exposure: 0.75, raid: 1, supply: 0, launder: 2, quietWeek: 0 }),
    }),
    /**
     * What goes wrong in a room that was worked last week (U3, DESIGN §36.14). `chance` of an event a week, times the
     * world's `frequency`; a room with an event of its own (`byProfile`) draws a shared one `shared` of the time, and one
     * without draws only those. Each event's numbers are its full effect: a failed answer takes half, a passed one none.
     */
    events: Object.freeze({
      chance: 0.08,
      shared: 0.2,
      frequency: Object.freeze({ rare: 0.5, normal: 1, often: 2 }),
      byProfile: Object.freeze({ loud: 'roomNoise', quiet: 'roomLooseEnd', hungry: 'roomBadBatch', connected: 'roomFavour', laundering: 'roomBooks' }),
      roomNoise: Object.freeze({ exposure: 6, reputation: -3 }),
      roomLooseEnd: Object.freeze({ exposure: 8 }),
      roomBadBatch: Object.freeze({ lost: 1, reputation: -5, fumbleExposure: 5 }),
      roomFavour: Object.freeze({ standing: -5 }),
      roomBooks: Object.freeze({ exposure: 6, dirty: 0.25, bookkeeper: 0.5 }),
      roomRival: Object.freeze({ lost: 0.5, exposure: 2 }),
      roomBigOrder: Object.freeze({ pay: 1.5, exposure: 4 }),
    }),
    /**
     * What each profile alone can do (U3b, DESIGN §36.14). `days` is the wait between uses. A big night stands in for the
     * week's work: on a pass it earns `earn` times as much, and its Exposure from work is `exposure` times as much on any roll.
     * Covering the trail moves Exposure by band. A new supplier sets the supply share to `supply` for `weeks` on a pass, and on
     * a failure makes a bad batch `risk` times as likely for as long. A favour costs `cost` standing, and takes `exposure` off
     * or stops a shakedown. A client's wash pays `fee` of what the same roll could launder, in dirty cash.
     */
    actions: Object.freeze({
      bigNight: Object.freeze({ earn: 1.5, exposure: 2, days: 28 }),
      coverTrail: Object.freeze({ exposure: byBand([0, 0, -2, -3, -4, -5]) }),
      newSupplier: Object.freeze({ supply: 0.15, weeks: 4, risk: 2, days: 28 }),
      callFavour: Object.freeze({ cost: 5, exposure: -5, bands: Object.freeze(['friendly', 'allied']) }),
      clientWash: Object.freeze({ fee: 0.5, days: 28 }),
    }),
    share: 0.6,
    workExposure: byBand([8, 4, 3, 2, 1, 1]),
    lieLow: 3,
    launderCap: 0.3,
    launderShare: byBand([0, 0, 0.5, 0.75, 1, 1]),
    launderExposure: byBand([6, 2, 2, 1, 0, 0]),
    launderUses: Object.freeze([S.accounting, S.business, Object.freeze({ ...S.bribery, dvAdd: 2 })]),
    bookkeeper: 1,
    payOff: Object.freeze([150, 300, 600]),
    payOffExposure: byBand([5, 0, -3, -5, -7, -10]),
    payOffUses: Object.freeze([S.bribery]),
    takeEvery: 1000,
    takeExposure: 2,
    /**
     * Raids on it (U1b). The weekly `chance` by Exposure band, more with an informant on the staff and with
     * each sullen employee (loyalty below `sullenBelow`, within `sullenCap`). A win clears `winClear` Exposure.
     * Failing seizes `failShare` of the dirty cash, with a fine of `fineFail`; left unanswered or fumbled, all of
     * it, `fineLost`, `heat` for each partner, and the room shut; high Exposure shuts it on a failure too.
     */
    raid: Object.freeze({
      chance: Object.freeze({ clean: 0, low: 0.03, moderate: 0.1, high: 0.25 }),
      informant: 0.05, sullen: 0.02, sullenBelow: 30, sullenCap: 0.06,
      // Everyone working the room is another who could be seen, and a sullen one of them knows twice as much.
      crew: 0.01, sullenCrew: 2,
      winClear: 5, failShare: 0.5, fineFail: 500, fineLost: 1000, heat: 15,
    }),
    /**
     * A gang as a silent partner (U1c). Asked with `dealUses`, a gang at neutral or better offers `cash` by band for
     * `cut` of the room's takings by standing, at least `minimum` eb a week. It charges no protection and sends no
     * shakedowns. A week it cannot be paid costs `unpaid` standing; ending it costs `end` standing and the cash back.
     */
    deal: Object.freeze({
      uses: Object.freeze([S.streetwise, S.persuasion, A.operator]),
      cash: byBand([0, 0, 1000, 1500, 2000, 2500]),
      cut: Object.freeze({ neutral: 0.3, friendly: 0.25, allied: 0.2 }),
      minimum: 100, unpaid: -5, end: -15,
    }),
    /** An informant (U1b): how often an applicant is one, how often an employee turns in a week, and the Exposure each adds. */
    informant: Object.freeze({ applicant: 0.1, turn: 0.02, exposure: 2 }),
  }),
  /**
   * Corporate crime (U1c). Dumping multiplies the week's takings, with `dumpingExposure`. A regulator's bribe costs
   * `bribeCost` eb and moves Exposure by `bribeExposure`; from `easeFrom` up it also takes `ease` off a case's total.
   * Black ops work as a campaign (the same month's limit and the GM's approval), costing `blackOpsCost`, with a bigger
   * move on the target, and `blackOpsCaught` Exposure and a case on a fumble. `scandal` is the price's fall, in percent,
   * when crime at a listed company comes out.
   */
  crime: Object.freeze({
    dumping: byBand([0.8, 0.95, 1.2, 1.4, 1.6, 1.8]),
    dumpingExposure: byBand([15, 8, 5, 4, 3, 3]),
    bribeCost: 1000,
    /** A fixer bribes the regulator on their own only if this much cash would be left. */
    fixerFloor: 5000,
    bribeExposure: byBand([8, 0, -4, -6, -8, -12]),
    ease: 3,
    easeFrom: Object.freeze(['solid', 'strong', 'exceptional']),
    blackOpsCost: 2500,
    blackOpsSize: byBand([0, 0, -2, -3, -4, -4]),
    blackOpsStanding: -10,
    blackOpsCaught: 15,
    blackOpsCaughtStanding: -15,
    scandal: Object.freeze({ raidFailed: -3, raidLost: -5, dumping: -3, caught: -8 }),
  }),
  /** A big event played out at the table (X1): what winning it does for Reputation. */
  scene: Object.freeze({ wonReputation: 2 }),
  /**
   * A smear or leak campaign (F1c): `cost` eb whatever the roll, one in `days`; `size` is the target's
   * move by band, in percent, from `delayDays` on. Landing costs `standing` with a target that is a faction,
   * and a fumble is `caughtStanding` and `caughtExposure`.
   */
  campaign: Object.freeze({ cost: 1000, days: 28, delayDays: 2, size: byBand([0, 0, -1, -1.5, -2, -2]), standing: -5, caughtStanding: -8, caughtExposure: 5 }),
  /**
   * Standing with factions (F1a, DESIGN §36.3): the bands players see; at most `weeklyCap` of movement
   * in seven days; `drift` back toward 0 each week. A gig for a faction moves it `done` or `failed`,
   * scaled by its reward over `reward` within `size`; each in the last `windowDays` makes it count less.
   */
  standing: Object.freeze({
    bands: Object.freeze([[-60, 'hostile'], [-20, 'wary'], [20, 'neutral'], [60, 'friendly'], [Infinity, 'allied']]),
    weeklyCap: 15, drift: 2,
    gig: Object.freeze({ done: 6, failed: -8, reward: 1000, size: Object.freeze([0.5, 3]), windowDays: 28 }),
    /** A gig's target moves the other way from its client, by this share of the client's move: price and standing alike. */
    target: Object.freeze({ done: -0.5, failed: -0.25 }),
    /**
     * Working on a faction (F1b): which actions may be aimed, at which kinds, and which must be. An aimed
     * action costs a `gift` from the cash, by stage, whatever the roll; `deal` is how far each band moves standing.
     */
    aims: Object.freeze({
      court: Object.freeze({ kinds: Object.freeze(['corp', 'other']), required: true }),
      respects: Object.freeze({ kinds: Object.freeze(['gang']), required: true }),
      contracts: Object.freeze({ kinds: Object.freeze(['corp', 'other']) }),
      relations: Object.freeze({ kinds: Object.freeze(['corp', 'gang', 'other']) }),
    }),
    gift: Object.freeze([100, 300, 1000]),
    deal: byBand([-4, 0, 3, 5, 7, 10]),
    /**
     * What standing does (F1b). Each corporation in the business's sector moves the Cost base, and each gang
     * on its turf the protection money and how often it comes shaking the business down; each total has a `cap`.
     */
    effects: Object.freeze({
      cost: Object.freeze({ hostile: 0.1, wary: 0.05, friendly: -0.05, allied: -0.1, cap: 0.15 }),
      protection: Object.freeze({ hostile: 0.5, wary: 0.25, friendly: -0.25, allied: -0.5, cap: 0.5 }),
    }),
    /**
     * A hostile faction's acts (F1b): the worst one's weekly chance, from `chance[0]` as it turns hostile to
     * `chance[1]` at -100. A smear not stopped moves a listed company's price by `smear` (a log-return), a raid
     * adds `raidExposure`; half of each when answered badly. Beating a gang's shakedown by force costs `force`.
     */
    hostile: Object.freeze({ chance: Object.freeze([0.05, 0.15]), smear: -0.02, raidExposure: 5, force: -3 }),
  }),
  /**
   * Stories in the press (S1, DESIGN §36.13). `chance` is weekly below hostile; at hostile it is the hostile act's
   * chance times `hostileDraw`. `limitDays` between stories for one target; of what can truthfully be told, a smear is
   * picked `smearShare` of the time. A corporation's own press and a media company have fixed Credibility ranks.
   * `frequency` is the world setting. `kinds` is what each does in full, if believed and not answered.
   */
  press: Object.freeze({
    chance: Object.freeze({ wary: 0.04, neutral: 0.01 }),
    hostileDraw: 2,
    limitDays: 28,
    smearShare: 0.2,
    smearPenalty: 1,
    printDays: 3,
    rank: Object.freeze({ own: 4, media: 6 }),
    frequency: Object.freeze({ rare: 0.5, normal: 1, often: 2 }),
    lookbackWeeks: 4,
    poorState: 35,
    raids: Object.freeze(['bust', 'raid']),
    accidents: Object.freeze(['accident']),
    /**
     * A character's story (S1b): the weekly chance by heat tier, read from the highest heat of the last `windowWeeks`.
     * `answerDays` to roll one of `uses` against `answerDv`. `heat` is what it adds, `heatMedia` from a media company;
     * `reputation` falls on the business they run with the worst standing, half what the nearest business story costs.
     */
    character: Object.freeze({
      chance: Object.freeze({ noticed: 0.02, flagged: 0.04, investigated: 0.08 }),
      windowWeeks: 4,
      answerDays: 7,
      answerDv: 15,
      uses: Object.freeze([S.persuasion, S.composition, S.bribery, A.credibility]),
      kinds: Object.freeze({
        dirty: Object.freeze({ heat: 10, heatMedia: 15, reputation: -2.5 }),
        hidden: Object.freeze({ heat: 15, reputation: -1, priceShare: 0.5 }),
        smear: Object.freeze({ heat: 5, reputation: -1.5 }),
      }),
    }),
    kinds: Object.freeze({
      money: Object.freeze({ reputation: -2, price: true }),
      crime: Object.freeze({ reputation: -5, exposure: 5, price: true, regCase: true }),
      service: Object.freeze({ reputation: -5 }),
      smear: Object.freeze({ reputation: -3, pricePercent: -2 }),
    }),
  }),
  /**
   * Regulators (R1, DESIGN §36.7): the chance of a case at each monthly report, by Exposure band; `notice`
   * days to answer. An officer rolls `uses` (Bribery costs `bribe` eb from the cash) against `base` + 1d10
   * + `bonus` by band; a win clears `clearShare` of the Exposure. A loss is a fine of `fine` of book value
   * (`fineHigh` at high Exposure) and `compliance`. Unmasking a holder of over `unmaskShare` opens a case.
   */
  regulator: Object.freeze({
    chance: Object.freeze({ clean: 0, low: 0.05, moderate: 0.15, high: 0.35 }),
    bonus: Object.freeze({ clean: 0, low: 0, moderate: 2, high: 4 }),
    base: 14, notice: 14, clearShare: 0.5, fine: 0.05, fineHigh: 0.1, compliance: -10, bribe: 500, unmaskShare: 0.25,
    uses: Object.freeze([S.bureaucracy, S.accounting, S.bribery, A.backup]),
  }),
  /**
   * Hidden ownership (B6d): at most `maxLayers` layers on a holding (a broker's nominee, then shells),
   * each a roll at DV `dv`; a setup fee of `setupRate` of the holding's value (at least `minSetup`) and a
   * fee of `monthlyRate` (at least `minMonthly`) every `feeDays`.
   */
  ownership: Object.freeze({
    maxLayers: 3, dv: 'difficult', setupRate: 0.01, minSetup: 500, monthlyRate: 0.0025, minMonthly: 50, feeDays: 28,
    uses: Object.freeze([S.bureaucracy, S.accounting]),
    /**
     * Concealment: hiding more than `disclosure` of a listed company adds `heat` (with heat tracking on)
     * and `exposure` to the company each week; each month NCPD looks with a chance of `chance` plus heat
     * over `heatDivisor` (at most `maxChance`), rolling `base` + 1d10 against the layers; seeing through
     * fines the holder `fine` of the holding's value. Insider heat for a concealed holder counts `insider` times.
     */
    disclosure: 0.05, heat: 6, exposure: 1, insider: 2, fine: 0.05,
    /**
     * Investigating a hidden holding: these skills, once a week per investigator and holding. It takes
     * a business day from one of the investigator's businesses, or `legwork` eb with none free; a roll
     * of Bribery costs `bribe` eb more, whatever it finds.
     */
    investigate: Object.freeze({ uses: Object.freeze([S.librarySearch, S.streetwise, S.bribery, Object.freeze({ ...A.interface, plain: true })]), days: 7, legwork: 100, bribe: 200 }),
    audit: Object.freeze({ chance: 0.1, heatDivisor: 200, maxChance: 0.6, base: 14, days: 28 }),
    /** An unmasking is a scandal: fair value dips `perShare` of the hidden stake, within `min` and `max`, from the next day. */
    scandal: Object.freeze({ perShare: 0.1, min: 0.02, max: 0.08, delayDays: 1 }),
  }),
  insolvency: Object.freeze({
    periods: 2, salvage: 0.5, hit: -0.1,
    restructure: Object.freeze({ priceShare: 0.5, minPrice: 0.01, reputation: -10, compliance: -10, reserveWeeks: 4 }),
  }),
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
     * An Exec's team (E3, B7a): a member at each of `ranks` of Teamwork (the rulebook's); their base in their role's
     * skills by the Exec's rank (`bases`: up to and including each rank). `loyalty` only keeps them out of the staff
     * loyalty rules, which do not apply to them. What counts is `care`, the rulebook's Loyalty: 1d6 + 1 to start, or
     * `replacement` and `fee` after losing one; at most `cap` between weeks; what the Exec can do about it each week;
     * `neglect` in a week with no gain; and what a betrayal leaves behind.
     */
    team: Object.freeze({
      ranks: Object.freeze([3, 5, 9]),
      bases: Object.freeze([[3, 8], [6, 11], [9, 14], [Infinity, 16]]),
      loyalty: 75,
      care: Object.freeze({ cap: 10, replacement: 1, fee: 200, compliment: 1, perk: 4, perkCost: 200, timeOff: 6, neglect: -1, betrayExposure: 15 }),
    }),
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
  /** Never drawn at random: a hostile faction's acts (F1b), which name the faction. */
  sabotage: Object.freeze({ weight: 0, security: true, uses: [S.basicTech, S.tactics, A.combatAwareness, A.maker], hit: Object.freeze({ capacity: -0.05 }) }),
  smear: Object.freeze({ weight: 0, uses: [S.persuasion, S.composition, A.credibility, A.charismaticImpact], hit: Object.freeze({ reputation: -3 }) }),
  raid: Object.freeze({ weight: 0, uses: [S.bureaucracy, S.persuasion, S.tactics, A.backup], hit: Object.freeze({ compliance: -8 }) }),
  /** Never drawn at random: a story in the press (S1). What it does is `press.kinds`, by what it says. */
  press: Object.freeze({ weight: 0, press: true, uses: [S.persuasion, S.composition, A.credibility, A.charismaticImpact], hit: Object.freeze({}) }),
  /** Never drawn at random: a raid on a back room, by its Exposure (U1b). */
  bust: Object.freeze({ weight: 0, uses: [S.bureaucracy, S.persuasion, S.tactics, S.bribery, A.backup], hit: Object.freeze({ compliance: -8, reputation: -3 }) }),
  /** Never drawn at random: what goes wrong in a back room (U3). Answered with the skills of the room's kind; see `roomEventFallout`. */
  roomNoise: Object.freeze({ weight: 0, room: true, uses: [], hit: Object.freeze({}) }),
  roomLooseEnd: Object.freeze({ weight: 0, room: true, uses: [], hit: Object.freeze({}) }),
  roomBadBatch: Object.freeze({ weight: 0, room: true, uses: [], hit: Object.freeze({}) }),
  roomFavour: Object.freeze({ weight: 0, room: true, uses: [], hit: Object.freeze({}) }),
  roomBooks: Object.freeze({ weight: 0, room: true, uses: [], hit: Object.freeze({}) }),
  roomRival: Object.freeze({ weight: 0, room: true, uses: [], hit: Object.freeze({}) }),
  roomBigOrder: Object.freeze({ weight: 0, room: true, good: true, uses: [], hit: Object.freeze({}) }),
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
  const own = actionId === 'work' || actionId === 'produce' ? [...(archetype?.trade ?? [])] : [...action.skills];
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
