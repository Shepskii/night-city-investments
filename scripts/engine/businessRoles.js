/**
 * Player businesses: what Nomads, Rockerboys and Lawmen bring (X1)
 * @file scripts/engine/businessRoles.js
 * @description A Nomad's supply contract (Moto) cuts the running costs for a few weeks; a Rockerboy's gig at the
 *              venue (Charismatic Impact) lifts this week's takings and Reputation, most of all at a bar or club.
 *              A Lawman's Backup answers a raid or a regulator's case, once a month, and can quash their own heat.
 *              Pure.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, clamp } from './businessRecord.js';
import { bandPassed } from './rolls.js';

/** What a supply contract takes off the running costs in the week `index`: a share, or 0. */
export const supplyCut = (b, index, p = BUSINESS_DEFAULTS) => (b.supply && index <= b.supply.until ? Math.min(p.roles.supply.maxCut, b.supply.cut) : 0);

/** The week's supply contract: a share off for some weeks, or a lost shipment on a fumble. */
export function runSupply(b, { band, day }, p = BUSINESS_DEFAULTS) {
  const rules = p.roles.supply;
  if (band === 'fumble') {
    const lost = rules.shipment[Math.min(b.stage ?? 0, rules.shipment.length - 1)];
    b.till -= lost;
    addLedger(b, { day, kind: 'shipmentLost', amount: -lost }, p);
    return;
  }
  if (!bandPassed(band)) return;
  b.supply = { cut: rules.cut[band], until: b.period.index + rules.weeks - 1 };
}

/** The week's gig at the venue: takings this week, and Reputation, more at a bar or club. */
export function runVenue(b, { band }, p = BUSINESS_DEFAULTS) {
  const rules = p.roles.venue;
  const scale = rules.venues.includes(b.archetype) ? rules.venueScale : 1;
  b.boost = clamp(b.boost + rules.takings[band] * scale, -p.gigs.boostCap, p.gigs.boostCap);
  b.state.reputation = clamp(b.state.reputation + rules.reputation[band] * scale, 0, 100);
}

/** Days until Backup can answer a raid or a case for this business again; 0 when it can now. */
export const backupWait = (b, day, p = BUSINESS_DEFAULTS) => (b.lastBackupDay == null ? 0 : Math.max(0, b.lastBackupDay + p.roles.backup.days - day));

/** What a Lawman quashing their heat does, from their roll. */
export function quashEffect(band, p = BUSINESS_DEFAULTS) {
  const rules = p.roles.quash;
  if (band === 'fumble') return { outcome: 'fumble', reduce: 0, add: rules.fumble };
  return bandPassed(band) ? { outcome: 'success', reduce: rules.reduce, add: 0 } : { outcome: 'failure', reduce: 0, add: 0 };
}
