/**
 * Broker repository: brokers are NCM master contacts tagged "broker".
 * @file scripts/data/BrokerRepository.js
 * @description A broker's skill comes from their character sheet when the contact is linked to an
 *              actor (INT + Accounting). A contact with no sheet uses a rating the GM sets here.
 *              Their trading terms are derived from that skill and the GM's direct-trading terms.
 */

import { brokerTerms, skillGrade, resolvePersonality } from '../engine/index.js';
import { MODULE_ID, SETTINGS, BROKER_TAG } from '../utils/constants.js';
import { NcmAdapter } from '../integrations/NcmAdapter.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { PortfolioRepository } from './PortfolioRepository.js';
import { TradingSettings } from '../services/TradingSettings.js';

/** Used when a broker has no sheet and the GM has not set a rating. */
export const DEFAULT_MANUAL_TOTAL = 8;

const clone = (v) => foundry.utils.deepClone(v);

export const BrokerRepository = {
  /** GM settings per broker contact: { enabled, manualTotal, minWithdrawal }. */
  defs() {
    return clone(game.settings.get(MODULE_ID, SETTINGS.BROKER_DEFS) ?? {});
  },

  /** GM only. */
  async setDef(contactId, patch) {
    if (!game.user.isGM) return false;
    const defs = this.defs();
    defs[contactId] = { ...defs[contactId], ...patch };
    await game.settings.set(MODULE_ID, SETTINGS.BROKER_DEFS, defs);
    return true;
  },

  /** Is this NCM contact a broker? A broker the GM has removed no longer counts, though its tag stays on the contact. */
  isBroker(contactId) {
    const contact = NcmAdapter.contact(contactId);
    return !!contact?.tags?.some((t) => String(t).toLowerCase() === BROKER_TAG) && !this.defs()[contactId]?.removed;
  },

  /** The broker contact for a linked actor, if there is one. */
  byActor(actorId) {
    const contact = NcmAdapter.contactForActor(actorId);
    return contact && this.isBroker(contact.id) ? contact : null;
  },

  /** Where a broker's Accounting total comes from. */
  skillFor(contact, def = {}) {
    const actor = contact.actorId ? game.actors.get(contact.actorId) : null;
    if (actor) {
      const s = SkillAdapter.read(actor);
      return { total: s.total, stat: s.stat, level: s.level, found: s.found, source: 'sheet', actorId: actor.id };
    }
    const total = Number.isFinite(Number(def.manualTotal)) ? Number(def.manualTotal) : DEFAULT_MANUAL_TOTAL;
    return { total, stat: null, level: null, found: false, source: 'manual', actorId: null };
  },

  /**
   * The Personality on the broker's character sheet (CPR keeps it at `system.lifepath.personality`),
   * as one of the ten table entries. Null with no sheet, a blank entry or one we do not recognise, and
   * then the broker writes in the standard wording.
   */
  personalityFor(contact) {
    const actor = contact.actorId ? game.actors.get(contact.actorId) : null;
    return resolvePersonality(actor?.system?.lifepath?.personality);
  },

  /** Every broker with their skill and the terms that skill gives them. */
  list() {
    const direct = TradingSettings.direct();
    const defs = this.defs();
    return NcmAdapter.brokerContacts().filter((contact) => !defs[contact.id]?.removed).map((contact) => {
      const def = defs[contact.id] ?? {};
      const skill = this.skillFor(contact, def);
      const enabled = def.enabled !== false;
      return {
        id: contact.id,
        name: contact.name,
        email: contact.email ?? '',
        portrait: contact.portrait ?? null,
        organization: contact.organization ?? '',
        enabled,
        available: enabled,
        minWithdrawal: Math.max(0, Number(def.minWithdrawal) || 0),
        skill,
        grade: skillGrade(skill.total),
        personality: this.personalityFor(contact),
        terms: brokerTerms(skill.total, direct),
      };
    });
  },

  get(id) {
    return this.list().find((b) => b.id === id) ?? null;
  },

  /**
   * Who is still tied to this broker: characters who have them as their broker, and characters
   * with open orders or a withdrawal waiting that they are handling.
   * @returns {{assigned: string[], busy: string[]}} character names
   */
  usage(brokerId) {
    const assigned = [];
    const busy = [];
    for (const actor of game.actors.filter((a) => PortfolioRepository.hasPortfolio(a))) {
      const p = PortfolioRepository.get(actor);
      if (p.brokerContactId === brokerId) assigned.push(actor.name);
      else if (p.orders.some((o) => o.status === 'open' && o.brokerId === brokerId)
        || p.withdrawals.some((w) => w.status === 'pending' && w.brokerId === brokerId)) busy.push(actor.name);
    }
    return { assigned, busy };
  },

  /**
   * GM only. Remove a broker from the market. Nothing is changed on the broker's character or NCM
   * contact (the contact keeps its broker tag); the module just stops treating them as a broker.
   * Refused while any character has them as their broker, or still has orders or a withdrawal with them.
   * @returns {Promise<{ok: boolean, reason?: 'gm-only'|'unknown'|'assigned'|'busy', names?: string[]}>}
   */
  async remove(brokerId) {
    if (!game.user.isGM) return { ok: false, reason: 'gm-only' };
    if (!this.get(brokerId)) return { ok: false, reason: 'unknown' };
    const { assigned, busy } = this.usage(brokerId);
    if (assigned.length) return { ok: false, reason: 'assigned', names: assigned };
    if (busy.length) return { ok: false, reason: 'busy', names: busy };
    const defs = this.defs();
    defs[brokerId] = { removed: true };
    await game.settings.set(MODULE_ID, SETTINGS.BROKER_DEFS, defs);
    return { ok: true };
  },

  /** Bring back a broker that was removed, if there is anything to bring back. */
  async _restore(contactId) {
    if (this.defs()[contactId]?.removed) await this.setDef(contactId, { removed: false });
  },

  /**
   * GM only. Make a character a broker: reuse their NCM contact (tagging it) or create one linked
   * to the actor, so their Accounting skill is read from the sheet.
   * @returns {Promise<boolean>}
   */
  async makeBrokerFromActor(actorId) {
    if (!game.user.isGM) return false;
    const actor = game.actors.get(actorId);
    if (!actor) return false;
    const existing = NcmAdapter.contactForActor(actorId);
    if (existing) {
      const ok = await NcmAdapter.tagAsBroker(existing.id);
      if (ok) await this._restore(existing.id);
      return ok;
    }
    const created = await NcmAdapter.addContact({
      name: actor.name,
      actorId,
      portrait: actor.img,
      tags: [BROKER_TAG],
      role: 'broker',
      organization: '',
    });
    return !!created;
  },

  /** GM only. Tag an existing NCM contact (with no sheet) as a broker. */
  async makeBrokerFromContact(contactId) {
    if (!game.user.isGM) return false;
    const ok = await NcmAdapter.tagAsBroker(contactId);
    if (ok) await this._restore(contactId);
    return ok;
  },

  /** NCM contacts that are not brokers yet (or were removed as brokers), for the "add broker" picker. */
  candidateContacts() {
    const defs = this.defs();
    return NcmAdapter.allContacts()
      .filter((c) => !c.sendOnly && (!c.tags?.some((t) => String(t).toLowerCase() === BROKER_TAG) || defs[c.id]?.removed))
      .map((c) => ({ id: c.id, name: c.name, hasActor: !!c.actorId }));
  },

  /** The `brokers` map the pure executor takes. */
  executorMap() {
    return Object.fromEntries(this.list().map((b) => [b.id, {
      available: b.available, name: b.name, terms: b.terms, minWithdrawal: b.minWithdrawal,
    }]));
  },
};
