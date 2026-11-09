/**
 * Companies owned and run by the GM's NPCs (N1, DESIGN §36.17)
 * @file scripts/engine/businessNpc.js
 * @description The week an NPC owner runs by itself. It happens as the week closes and takes only the slots still
 *              free, so whatever the GM did as the owner stands and stepping in needs no switch. Pure; the rolls come
 *              from the seed.
 */

import { BUSINESS_DEFAULTS, stageDv } from './businessConfig.js';
import { addLedger } from './businessRecord.js';
import { createRng } from './rng.js';
import { cprD10 } from './checks.js';
import { bandOf } from './rolls.js';

/** What the owner wants to do this week, first choice first, given the Reputation target. */
export function npcActions(b, p = BUSINESS_DEFAULTS) {
  const r = p.npc;
  const profile = r.profiles[b.npcRun.profile] ?? r.profiles.steady;
  const side = b.stage >= 2 ? 'company' : 'shop';
  const enough = profile.target != null && b.state.reputation >= profile.target;
  return [...new Set(profile[side].map((a) => (enough && r.winsReputation.includes(a) ? r.fill[side] : a)))];
}

/** Fill the slots left free this week. An event comes out of the last of them, as it would for a partner. */
export function npcWeek(b, seed = 'nci', p = BUSINESS_DEFAULTS) {
  const run = b.npcRun;
  if (!run?.auto) return;
  const slots = b.period.slots;
  const free = (p.stages[b.stage]?.slots ?? 1) - slots.length;
  if (free <= 0) return;
  const base = p.npc.levels[run.level] ?? p.npc.levels.skilled;
  const dv = stageDv(b.stage, p);
  const push = (action, extra = {}) => {
    const rng = createRng(seed, 'npc', b.id, b.period.index, action);
    const roll = cprD10(() => rng.int(1, 10));
    const total = base + roll.total;
    slots.push({ action, by: run.ownerId, use: 'npc', band: bandOf(total - dv, roll.crit), total, dv, approach: 'standard', luck: 0, bonus: 0, ...extra });
  };
  const event = b.period.event;
  const answer = !!event && !b.scene && !slots.some((s) => s.action === 'respond');
  const taken = new Set(slots.map((s) => s.action));
  for (const action of npcActions(b, p).filter((a) => !taken.has(a)).slice(0, free - (answer ? 1 : 0))) push(action);
  if (answer) push('respond', { event: event.kind });
}

/**
 * The week's profit goes to the owner, and out of the game, so a company that runs itself doesn't pile up money nobody
 * can use. Only what is above the reserve goes, so a poor company builds up first, and what the GM started it with
 * stays in. Only a full week counts.
 * @returns {number} what was paid out
 */
export function npcDraw(b, weekly, profit, part, day, p = BUSINESS_DEFAULTS) {
  if (!b.npcRun?.auto || part < 1) return 0;
  const draw = Math.floor(Math.min(profit, b.till - p.npc.reserveWeeks * weekly));
  if (draw <= 0) return 0;
  b.till -= draw;
  addLedger(b, { day, kind: 'ownerDraw', amount: -draw }, p);
  return draw;
}
