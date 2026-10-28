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
  basicTech: skill('Basic Tech', 'tech'),
  business: skill('Business', 'int'),
  composition: skill('Composition', 'int'),
  conversation: skill('Conversation', 'emp'),
  cybertech: skill('Cybertech', 'tech'),
  electronics: skill('Electronics/Security Tech', 'tech'),
  humanPerception: skill('Human Perception', 'emp'),
  landVehicleTech: skill('Land Vehicle Tech', 'tech'),
  librarySearch: skill('Library Search', 'int'),
  localExpert: skill('Local Expert', 'int'),
  paramedic: skill('Paramedic', 'tech'),
  persuasion: skill('Persuasion', 'cool'),
  playInstrument: skill('Play Instrument', 'tech'),
  streetwise: skill('Streetwise', 'cool'),
  tactics: skill('Tactics', 'int'),
  trading: skill('Trading', 'cool'),
  wardrobe: skill('Wardrobe & Style', 'cool'),
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
 * The four archetypes of B1. `takings` and `costs` are weekly, at Capacity 1 and a neutral
 * Reputation; `setup` is the range a setup roll's band picks from; `trade` are the skills that work
 * the shop; `abilities` are the role abilities that fit its setup and its complementary checks.
 */
export const ARCHETYPES = Object.freeze({
  clinic: Object.freeze({ id: 'clinic', takings: 260, costs: 180, setup: [1000, 3000], trade: [S.cybertech, S.paramedic], abilities: [A.medicine, A.maker] }),
  garage: Object.freeze({ id: 'garage', takings: 240, costs: 165, setup: [800, 2500], trade: [S.basicTech, S.landVehicleTech], abilities: [A.maker, A.moto] }),
  bar: Object.freeze({ id: 'bar', takings: 250, costs: 175, setup: [1000, 3000], trade: [S.conversation, S.persuasion, S.playInstrument], abilities: [A.charismaticImpact, A.operator] }),
  infoShop: Object.freeze({ id: 'infoShop', takings: 230, costs: 155, setup: [700, 2200], trade: [S.librarySearch, S.electronics], abilities: [A.interface, A.operator] }),
});

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
  source: Object.freeze({ skills: [S.trading, S.streetwise], abilities: [A.operator], help: [S.business, S.localExpert] }),
  fixUp: Object.freeze({ skills: [S.basicTech], abilities: [A.maker], help: [S.electronics, S.landVehicleTech] }),
  keepSafe: Object.freeze({ skills: [S.tactics, S.persuasion], abilities: [A.combatAwareness, A.backup], help: [S.streetwise, S.humanPerception] }),
});

const byBand = (values) => Object.freeze(Object.fromEntries(['fumble', 'failure', 'narrow', 'solid', 'strong', 'exceptional'].map((b, i) => [b, values[i]])));

export const BUSINESS_DEFAULTS = Object.freeze({
  /** Per stage: action slots, the DV step of its actions, the Capacity ceiling, weekly rent and protection, the fix-up scale. */
  stages: Object.freeze([
    Object.freeze({ slots: 1, dv: 'everyday', capacityCap: 1.6, rent: 7, protection: 8, fixUpScale: 1 }),
  ]),
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
  /** The most weekly closes run at once after the calendar jumps. */
  catchUpPeriods: 8,
  digestCap: 12,
  ledgerCap: 120,
  maxGearItems: 6,
  maxPartners: 6,
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
