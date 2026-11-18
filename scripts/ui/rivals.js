/**
 * NPC rivals on the job board (X2b)
 * @file scripts/ui/rivals.js
 * @description What a player's window knows of the NPC companies it may move against: published by the GM's service
 *              with the job board, each with its DV and the employees who may be poached, with theirs.
 */

import { MODULE_ID, SETTINGS } from '../utils/constants.js';

/** The rivals on the board, but never the business itself. */
export function boardRivals(exceptId = null) {
  const board = game.settings.get(MODULE_ID, SETTINGS.JOB_BOARD) ?? {};
  return (board.rivals ?? []).filter((r) => r.id !== exceptId);
}

/** The rival a pick on the Work tab names: `rivalId`, or `rivalId:staffId` for a poaching. */
export function rivalRequest(action, value, exceptId = null) {
  const [targetId, staffId] = String(value ?? '').split(':');
  const rival = boardRivals(exceptId).find((r) => r.id === targetId) ?? null;
  return { targetId, ...(action === 'poach' ? { staffId } : {}), rival };
}
