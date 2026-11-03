/**
 * Player businesses: what a character gets out of them (B7c, DESIGN §36.9)
 * @file scripts/engine/businessRewards.js
 * @description A business's big moments suggest REP and Improvement Points to the GM, who applies, changes or dismisses
 *              each one. The levels follow the rulebook's scale, by how widely a deed gets known (4 the local area, 7 a
 *              news story). A bad deed has a level of its own, as the rulebook has it: being known for something is being
 *              known. Either way a new level replaces REP only if it is higher. Routine rolls give nothing, so neither
 *              can be farmed. Pure.
 */

import { voters } from './businessRecord.js';
import { officersOf } from './businessCompany.js';

/** Each milestone's suggestion. */
export const REWARDS = Object.freeze({
  registered: Object.freeze({ rep: 3, ip: 10 }),
  chartered: Object.freeze({ rep: 4, ip: 20 }),
  listed: Object.freeze({ rep: 7, ip: 30 }),
  takeoverControl: Object.freeze({ rep: 7, ip: 30 }),
  takeoverFoughtOff: Object.freeze({ rep: 5, ip: 20 }),
  sceneWon: Object.freeze({ rep: 0, ip: 20 }),
  sceneLost: Object.freeze({ rep: 0, ip: 10 }),
  caseLost: Object.freeze({ rep: 4, ip: 0 }),
  unmasked: Object.freeze({ rep: 6, ip: 0 }),
  woundUp: Object.freeze({ rep: 5, ip: 0 }),
  raidLost: Object.freeze({ rep: 4, ip: 0 }),
});

/** Those running a business, who a milestone reaches: officers at a company, any active partner with a vote below that. */
export function rewardRunners(b) {
  if (b.stage >= 2) return officersOf(b);
  return voters(b).filter((x) => x.status === 'active').map((x) => x.actorId);
}

/** The most REP goes: the rulebook's scale stops at 10. */
export const REP_MAX = 10;

/**
 * What a suggestion would do to a character's sheet, as the GM has set it: REP only if higher, IP on top.
 * @returns {{rep: number|null, ip: number, gained: number}} `rep` is the new value, or null if it stays; `ip` the new total
 */
export function rewardChange({ rep = 0, ip = 0 }, { rep: currentRep = 0, ip: currentIp = 0 }) {
  const level = Math.max(0, Math.min(REP_MAX, Math.round(Number(rep) || 0)));
  const gain = Math.max(0, Math.round(Number(ip) || 0));
  return { rep: level > currentRep ? level : null, ip: currentIp + gain, gained: gain };
}

/** Whether a suggestion would change anything for this character: one that would not is not worth the GM's time. */
export const rewardMatters = (kind, currentRep) => REWARDS[kind].ip > 0 || REWARDS[kind].rep > currentRep;
