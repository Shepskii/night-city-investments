/**
 * Player businesses: events by mail (M2, DESIGN §36.4)
 * @file scripts/engine/eventMail.js
 * @description Who an event comes from, when someone is behind it: a faction's move, the press, the city, NCPD, a
 *              fixer's collectors, a former employee, or one of the staff. The GM's service turns the sender into a
 *              Night City Messenger contact and mails those who can answer the event. Pure.
 */

import { EVENTS } from './businessConfig.js';

/** A faction's moves that it makes known itself. */
const FACTION_KINDS = Object.freeze(['shakedown', 'sabotage', 'smear']);
/** Staff events an employee would write about themselves. */
const STAFF_KINDS = Object.freeze(['sickDay', 'payDispute', 'poaching', 'accident', 'doubleBooked', 'fullTimeOffer']);

/**
 * Who an event comes from, or null when nobody is behind it (a breakdown, a shortage, a windfall).
 * @returns {{kind: 'faction'|'outlet'|'city'|'ncpd'|'collectors'|'staff'|'formerStaff', factionId?: string, name?: string, staffId?: string}|null}
 */
export function eventSender(b, event) {
  const kind = event?.kind;
  if (!kind || !EVENTS[kind]) return null;
  // The paper that prints it, never the corporation that may be behind it.
  if (kind === 'press') return event.factionName ? { kind: 'outlet', name: event.factionName, ...(event.factionId ? { factionId: event.factionId } : {}) } : null;
  // A faction's raid is the inspectors it tipped off, so the city sends it.
  if (kind === 'raid' || kind === 'inspection') return { kind: 'city' };
  if (kind === 'bust') return { kind: 'ncpd' };
  if (kind === 'collectors') return { kind: 'collectors' };
  if (kind === 'grudge') return event.formerStaffId ? { kind: 'formerStaff', staffId: event.formerStaffId } : null;
  if (kind === 'roomFavour' || kind === 'roomBigOrder') return b?.backRoom?.factionId ? { kind: 'faction', factionId: b.backRoom.factionId } : null;
  if (STAFF_KINDS.includes(kind)) return event.staffId ? { kind: 'staff', staffId: event.staffId } : null;
  if (FACTION_KINDS.includes(kind) && event.factionId) return { kind: 'faction', factionId: event.factionId };
  return null;
}

/** Whether an event is the back room's business, for only those who know of it. */
export const eventIsRoom = (event) => event?.kind === 'bust' || !!EVENTS[event?.kind]?.room;

/**
 * The week's event and its sender, if it is still to be mailed, marking it so it is mailed once. An NPC's company has
 * nobody to mail. An event with no sender is marked too, so it isn't looked at again.
 * @returns {{event: object, sender: object}|null}
 */
export function takeEventMail(b) {
  const event = b?.period?.event;
  if (!event || event.mailed || b.npcRun) return null;
  event.mailed = true;
  const sender = eventSender(b, event);
  return sender ? { event, sender } : null;
}
