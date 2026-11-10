/**
 * People's mail in their own voice (M3 step 3, DESIGN §36.4)
 * @file scripts/services/PeopleMail.js
 * @description Words a mail from an employee (by their Personality and their loyalty), an NPC owner (by the
 *              Personality on their sheet) or a corporation's HR (in its corporation's style), with the employee's
 *              performance setting the employer's tone. Every function returns null when there is no voice, and the
 *              caller keeps its plain wording.
 */

import { peopleMail, personalityOf, resolvePersonality, moodOf, loyaltyBand, bossBand, standingOf, isEmployerId, factionStyle } from '../engine/index.js';
import { STAFF_FRAMES, STAFF_LINES } from '../data/people-voices/staff.js';
import { OWNER_FRAMES, OWNER_LINES, HR_VOICES } from '../data/people-voices/employers.js';
import { FactionRepository } from '../data/FactionRepository.js';
import { CompanyRepository } from '../data/CompanyRepository.js';

/** The Personality written on an actor's sheet, if it has one. */
const sheetPersonality = (actorId) => (actorId ? game.actors?.get?.(actorId)?.system?.lifepath?.personality ?? null : null);

export const PeopleMail = {
  /** An employee's Personality: their sheet's, or the one their staff id fixes (a recruit's). */
  personalityOf(staff) {
    return personalityOf(staff.id, sheetPersonality(staff.actorId));
  },

  /** A staff event, from the employee, by their mood. */
  staffEvent(b, event, staff) {
    if (!staff) return null;
    return peopleMail({
      frames: STAFF_FRAMES, lines: STAFF_LINES, personality: this.personalityOf(staff), kind: event.kind,
      tone: moodOf(loyaltyBand(staff.loyalty ?? 50)),
      data: { name: b.name, staff: staff.name, other: event.rival?.name ?? staff.elsewhere?.name ?? '' },
    });
  },

  /**
   * What an employee writes when they ask for a raise or leave (`asks`, `quit`, `walked`, `unpaid`, `poached`). One
   * who has left is gone from the record, so their Personality comes from their id (and a tagged NPC's sheet).
   */
  staffNote(b, note) {
    const staff = (b.staff ?? []).find((s) => s.id === note.staffId);
    const actorId = staff?.actorId ?? (String(note.staffId).startsWith('stf_') ? String(note.staffId).slice(4) : null);
    return peopleMail({
      frames: STAFF_FRAMES, lines: STAFF_LINES, personality: personalityOf(note.staffId, sheetPersonality(actorId)), kind: note.kind,
      tone: staff ? moodOf(loyaltyBand(staff.loyalty ?? 50)) : 'sullen',
      data: { name: b.name, staff: note.name ?? staff?.name ?? '' },
    });
  },

  /** A corporation's HR style: its faction's, by ticker, among the styles HR has; Legal otherwise. */
  hrStyle(e) {
    const f = FactionRepository.list().find((x) => x.kind === 'corp' && x.ticker && x.ticker === e.ticker);
    const sector = CompanyRepository.all().find((c) => c.ticker === e.ticker)?.sector ?? null;
    const style = factionStyle(f ?? { kind: 'corp', ticker: e.ticker }, sector);
    return HR_VOICES[style] ? style : 'legal';
  },

  /**
   * A job's mail from its employer (`hired`, `turned`, `warned`, `sacked`, `promoted`, `payslip`), or null at a
   * player's business. `band` is the employee's performance, for a payslip's note; `after` keeps lines as they are.
   */
  employer(b, kind, data = {}, { band = null, after = [] } = {}) {
    if (isEmployerId(b?.id)) {
      const style = this.hrStyle(b);
      return peopleMail({ frames: { [style]: HR_VOICES[style] }, lines: HR_VOICES[style], personality: style, kind, tone: band, data: { name: b.name, ...data }, after });
    }
    const ownerId = b?.npcRun?.ownerId;
    if (!ownerId) return null;
    // An owner with no Personality on their sheet is Stable (the user's choice).
    return peopleMail({ frames: OWNER_FRAMES, lines: OWNER_LINES, personality: resolvePersonality(sheetPersonality(ownerId)) ?? 'stable', kind, tone: band, data: { name: b.name, ...data }, after });
  },

  /** An employee's performance band at an NPC's company or a corporation, by their character. */
  bandOf(b, actorId) {
    const staff = (b?.staff ?? []).find((s) => s.actorId === actorId);
    return staff ? bossBand(standingOf(staff)) : null;
  },
};
