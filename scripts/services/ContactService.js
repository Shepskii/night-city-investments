/**
 * Contact service: the Night City Messenger contacts that events and jobs come from (M2, DESIGN §36.4)
 * @file scripts/services/ContactService.js
 * @description A faction, a paper, the city, a fixer's collectors, one of the staff, an NPC owner or a corporation's
 *              HR each send their mail from a contact of their own. One is made in the GM's directory the first time
 *              it is needed, unless the GM has linked one, and the link is kept on the GM-only control journal with a
 *              note of who each contact has been given to, so nobody is given one twice. GM only.
 */

import { MarketStore } from '../data/MarketStore.js';
import { FactionRepository } from '../data/FactionRepository.js';
import { NcmAdapter } from '../integrations/NcmAdapter.js';
import { isEmployerId } from '../engine/index.js';
import { FLAGS, MODULE_ID, SETTINGS } from '../utils/constants.js';
import { L, log } from '../utils/helpers.js';

/** The tag on every contact this module makes to send from, and the directory folder they go in. */
export const SENDER_TAG = 'nci-sender';
const FOLDER = 'Night City Investments';

const read = () => {
  const r = MarketStore.readRecord(FLAGS.NCM_CONTACTS) ?? {};
  return { senders: r.senders ?? {}, shared: r.shared ?? {} };
};
const write = (r) => MarketStore._writeRecord(FLAGS.NCM_CONTACTS, r);
/** A made-up address from a name: `Tyger Claws` at `net` is `contact@tygerclaws.net`. */
const address = (name, domain, box = 'contact') => `${box}@${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'nc'}.${domain}`;

export const ContactService = {
  /** Each sender's key, to the contact id it sends from. */
  senders() {
    return read().senders;
  },

  /** The contact a sender's key has, if it is still in the directory. */
  linked(key) {
    const id = read().senders[key];
    return id && NcmAdapter.contact(id) ? id : null;
  },

  /** GM: link a contact to a sender, or with none, let the next mail make one. */
  async link(key, contactId) {
    if (!game.user.isGM) return { ok: false, reason: 'not-gm' };
    const r = read();
    if (contactId) r.senders[key] = contactId;
    else delete r.senders[key];
    await write(r);
    return { ok: true };
  },

  /** The contact for a key, made by `make` the first time (or again, if the GM deleted it). Null without Messenger. */
  async ensure(key, make) {
    const id = this.linked(key);
    if (id) return id;
    if (!game.user.isGM || !NcmAdapter.available()) return null;
    let contact = null;
    try {
      contact = await make();
    } catch (error) {
      log.warn(`Could not make a Messenger contact for ${key}`, error);
    }
    if (!contact?.id) return null;
    const r = read();
    r.senders[key] = contact.id;
    await write(r);
    return contact.id;
  },

  _make(data) {
    return NcmAdapter.addContact({ folder: FOLDER, notes: L('NCI.Contacts.Notes'), ...data, tags: [SENDER_TAG, ...(data.tags ?? [])] });
  },

  /**
   * Give a contact to characters who don't have it from us yet, if the world shares contacts. A push that didn't
   * happen (no Messenger, a refusal) is tried again next time.
   */
  async share(contactId, actorIds) {
    if (!contactId || game.settings.get(MODULE_ID, SETTINGS.SHARE_CONTACTS) === false) return;
    const done = new Set(read().shared[contactId] ?? []);
    const fresh = [...new Set(actorIds)].filter((id) => id && !done.has(id) && game.actors.get(id));
    if (!fresh.length) return;
    const pushed = [];
    for (const id of fresh) if (await NcmAdapter.pushContact(contactId, id)) pushed.push(id);
    if (!pushed.length) return;
    const r = read();
    r.shared[contactId] = [...new Set([...(r.shared[contactId] ?? []), ...pushed])];
    await write(r);
  },

  // ── Senders ─────────────────────────────────────────────────────────────────

  faction(factionId) {
    const f = FactionRepository.get(factionId);
    if (!f) return Promise.resolve(null);
    return this.ensure(`faction:${f.id}`, () => this._make({ name: f.name, organization: f.name, email: address(f.name, f.kind === 'corp' ? 'corp' : 'net'), type: 'organization' }));
  },

  /** The paper that prints a story: the faction, if it is one, or a news desk of its own. */
  outlet(name, factionId = null) {
    const f = factionId ? FactionRepository.get(factionId) : null;
    if (f && f.name === name) return this.faction(f.id);
    const named = FactionRepository.list().find((x) => x.name === name);
    if (named) return this.faction(named.id);
    return this.ensure(`outlet:${name}`, () => this._make({ name: L('NCI.Contacts.Desk', { name }), organization: name, email: address(name, 'news', 'desk') }));
  },

  city() {
    return this.ensure('city', () => this._make({ name: L('NCI.Contacts.City'), organization: L('NCI.Contacts.CityOrg'), email: 'inspections@nightcity.gov' }));
  },

  async ncpd() {
    return (await NcmAdapter.ensureNcpd())?.id ?? null;
  },

  collectors() {
    return this.ensure('collectors', () => this._make({ name: L('NCI.Contacts.Collectors'), email: 'collections@darknet.nc' }));
  },

  /**
   * One of a business's NPC staff: a tagged NPC's own contact, or one made for a recruit. Kept under the business and
   * the employee, so a former employee's grudge can still come from them.
   */
  async staff(b, staff) {
    const key = `staff:${b.id}:${staff.id}`;
    if (staff.source === 'pc') return null;
    const own = staff.actorId ? NcmAdapter.contactForActor(staff.actorId)?.id : null;
    if (own) {
      if (read().senders[key] !== own) await this.link(key, own);
      return own;
    }
    return this.ensure(key, () => this._make({ name: staff.name, organization: b.name, role: L(`NCI.Staff.Post.${staff.post}`) }));
  },

  /** A former employee, if they were ever given a contact. */
  formerStaff(b, staffId) {
    return Promise.resolve(this.linked(`staff:${b.id}:${staffId}`));
  },

  /**
   * A job's employer, for a player character working there: a corporation's HR, or an NPC company's owner. Null for
   * a player's business, whose mail stays with the market wire.
   */
  async employer(b) {
    if (isEmployerId(b?.id)) return this.ensure(`employer:${b.id}`, () => this._make({ name: L('NCI.Contacts.Hr', { name: b.name }), organization: b.name, email: address(b.ticker || b.name, 'corp', 'hr'), type: 'organization' }));
    const ownerId = b?.npcRun?.ownerId;
    if (!ownerId) return null;
    const own = NcmAdapter.contactForActor(ownerId)?.id;
    if (own) return own;
    const owner = game.actors.get(ownerId);
    return owner ? this.ensure(`owner:${ownerId}`, () => this._make({ name: owner.name, actorId: owner.id, organization: b.name, portrait: owner.img ?? null })) : null;
  },

  /** The contact an event's sender sends from (see `eventSender`). */
  forSender(b, sender) {
    switch (sender?.kind) {
      case 'faction': return this.faction(sender.factionId);
      case 'outlet': return this.outlet(sender.name, sender.factionId ?? null);
      case 'city': return this.city();
      case 'ncpd': return this.ncpd();
      case 'collectors': return this.collectors();
      case 'formerStaff': return this.formerStaff(b, sender.staffId);
      case 'staff': {
        const staff = (b.staff ?? []).find((s) => s.id === sender.staffId);
        return staff ? this.staff(b, staff) : Promise.resolve(null);
      }
      default: return Promise.resolve(null);
    }
  },
};
