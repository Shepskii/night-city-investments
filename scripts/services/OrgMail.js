/**
 * Organisations' mail in their own voice (M3 step 2, DESIGN §36.4)
 * @file scripts/services/OrgMail.js
 * @description Words a mail from a gang, a corporation, a paper or an official sender in its style: a faction's own
 *              (picked on the Factions tab, or its default), a paper's, or the sender's for officials, who also put
 *              a reference in the subject. Every function returns null when there is no voice for the mail, and the
 *              caller keeps its plain wording.
 */

import { orgMail, factionStyle, outletStyle, eventTones, refNumber } from '../engine/index.js';
import { OFFICIALS } from '../data/org-voices/officials.js';
import { GANG_VOICES } from '../data/org-voices/gangs.js';
import { CORP_VOICES } from '../data/org-voices/corps.js';
import { OUTLET_VOICES } from '../data/org-voices/outlets.js';
import { FactionRepository } from '../data/FactionRepository.js';
import { CompanyRepository } from '../data/CompanyRepository.js';

const sectorOf = (f) => (f?.ticker ? CompanyRepository.all().find((c) => c.ticker === f.ticker)?.sector ?? null : null);

export const OrgMail = {
  /** A subject with an official sender's reference in front. */
  subject(subject, mail) {
    return mail?.ref ? `${mail.ref}: ${subject}` : subject;
  },

  /** An official sender's mail; `key` keeps the same reference for the same matter. */
  official(sender, kind, data, key) {
    return orgMail({ voices: OFFICIALS, style: sender, kind, data: { ...data, ref: refNumber(`${sender}:${key}`) } });
  },

  /** A faction's style. */
  styleOf(f) {
    return factionStyle(f, sectorOf(f));
  },

  /** A gang's or a corporation's mail, in its style. */
  faction(factionId, kind, data = {}, tones = []) {
    const f = FactionRepository.get(factionId);
    if (!f) return null;
    const corp = f.kind === 'corp';
    return orgMail({ voices: corp ? CORP_VOICES : GANG_VOICES, style: this.styleOf(f), fallback: corp ? 'legal' : 'street', kind, tones, data: { gang: f.name, ...data } });
  },

  /** A paper's mail: in the style of the faction it is, if it is one, and Broadcast otherwise. */
  outlet(name, factionId, kind, data = {}, also = []) {
    const byId = factionId ? FactionRepository.get(factionId) : null;
    const f = byId?.name === name ? byId : FactionRepository.list().find((x) => x.name === name) ?? null;
    const style = f ? outletStyle(f, sectorOf(f)) : 'broadcast';
    return orgMail({ voices: OUTLET_VOICES, style, fallback: 'broadcast', kind, also, data: { outlet: name, ...data } });
  },

  /** The week's event from an organisation, or null for a person (the staff speak for themselves). */
  event(b, event, sender) {
    const data = { name: b.name, outlet: event.factionName ?? '' };
    const week = `${b.id}:${b.period?.index ?? ''}`;
    switch (sender?.kind) {
      case 'faction': return this.faction(sender.factionId, event.kind, data, eventTones(b, { ...event, factionId: sender.factionId }));
      case 'outlet': return this.outlet(sender.name, sender.factionId ?? null, 'pressAsk', data);
      case 'city': return this.official('city', event.kind === 'raid' ? 'raid' : 'inspection', data, week);
      case 'ncpd': return this.official('vice', 'bust', data, b.id);
      case 'collectors': return this.official('collections', 'collectors', data, b.id);
      default: return null;
    }
  },
};
