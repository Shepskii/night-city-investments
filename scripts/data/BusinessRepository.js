/**
 * Business repository: each player business is a private JournalEntry.
 * @file scripts/data/BusinessRepository.js
 * @description The record is a flag on the journal, saved in the one-write wrapped form, and only the
 *              GM writes it. The journal's ownership is None by default and Observer for the users of
 *              its partners' characters (invited ones included, so they can see the invitation), so
 *              only they find it in their windows. Foundry still sends the journal to every client,
 *              so a player at the browser console can read it. Its hidden part lives in the control
 *              journal (MarketStore.getBusinessesHidden), kept from players' windows in the same way.
 */

import { normalizeBusiness, shareOf, bookValue } from '../engine/index.js';
import { MODULE_ID, FLAGS, BUSINESS_FOLDER_NAME } from '../utils/constants.js';
import { SyndicateRepository } from './SyndicateRepository.js';
import { unwrap } from '../utils/helpers.js';

const LEVELS = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;

/**
 * Partners whose players should see the business: those invited and those holding units. A partner
 * who declined, or left (bought out, or before it opened), loses it. Holders stay `active` when a
 * business closes, so its last partners keep the record and nobody else regains it.
 */
const SEEN_BY = new Set(['invited', 'active', 'leaving']);

export const BusinessRepository = {
  /**
   * Business journals this user may read. A player who loses access (declined, sold out) can keep a
   * stale copy until they reload, so it is checked here rather than trusted.
   */
  journals() {
    return game.journal.filter((j) => j.getFlag(MODULE_ID, FLAGS.BUSINESS) && (game.user.isGM || j.testUserPermission?.(game.user, 'OBSERVER') !== false));
  },

  /** Every business this client can read, newest first. */
  all() {
    return this.journals()
      .map((j) => normalizeBusiness(foundry.utils.deepClone(unwrap(j.getFlag(MODULE_ID, FLAGS.BUSINESS)))))
      .filter((b) => b.id)
      .sort((a, b) => b.createdDay - a.createdDay || a.name.localeCompare(b.name));
  },

  get(id) {
    return this.all().find((b) => b.id === id) ?? null;
  },

  journalOf(id) {
    return this.journals().find((j) => unwrap(j.getFlag(MODULE_ID, FLAGS.BUSINESS))?.id === id) ?? null;
  },

  /** Businesses a character is part of or invited to, closed ones included if they were a partner at the end. */
  forActor(actorId) {
    return this.all().filter((b) => b.partners.some((p) => p.actorId === actorId && SEEN_BY.has(p.status)));
  },

  /**
   * An owner's stakes in businesses still open, at book value times their share. The owner is a
   * character or a syndicate (whose stakes count in its value per unit, DESIGN §31).
   */
  stakesOf(ownerId) {
    return Math.round(this.all().filter((b) => b.status === 'open').reduce((sum, b) => sum + shareOf(b, ownerId) * bookValue(b), 0));
  },

  /**
   * Bring who can see a partner's businesses up to date without touching their records: used when a
   * syndicate's members change, since its members' users are among them. GM only.
   */
  async refreshOwnership(partnerId) {
    if (!game.user.isGM) return 0;
    let changed = 0;
    for (const business of this.all().filter((b) => b.partners.some((p) => p.actorId === partnerId))) {
      const journal = this.journalOf(business.id);
      if (!journal) continue;
      const ownership = this.ownershipFor(business);
      const current = journal.ownership ?? {};
      const gone = Object.keys(current).filter((id) => id !== 'default' && !(id in ownership) && !game.users?.get?.(id)?.isGM);
      if (!gone.length && Object.entries(ownership).every(([id, level]) => current[id] === level)) continue;
      await journal.update({ ownership: { ...ownership, ...Object.fromEntries(gone.map((id) => [`-=${id}`, null])) } });
      changed++;
    }
    return changed;
  },

  /**
   * The ownership a business's journal should have: Observer for the users of its partners'
   * characters, and of the active members of any syndicate that is a partner.
   */
  ownershipFor(business) {
    const ownership = { default: LEVELS().NONE };
    for (const p of business.partners.filter((x) => SEEN_BY.has(x.status))) {
      const syndicate = game.actors.get(p.actorId) ? null : SyndicateRepository.get(p.actorId);
      const actors = syndicate
        ? syndicate.members.filter((m) => m.status === 'active').map((m) => game.actors.get(m.actorId)).filter(Boolean)
        : [game.actors.get(p.actorId)];
      for (const actor of actors) {
        for (const user of game.users?.filter?.((u) => !u.isGM && actor?.testUserPermission?.(u, 'OWNER')) ?? []) {
          ownership[user.id] = LEVELS().OBSERVER;
        }
      }
    }
    return ownership;
  },

  async ensureFolder() {
    const existing = game.folders.find((f) => f.type === 'JournalEntry' && f.name === BUSINESS_FOLDER_NAME);
    return existing ?? Folder.create({ name: BUSINESS_FOLDER_NAME, type: 'JournalEntry' });
  },

  /** Create or replace a business record. GM only. */
  async save(business) {
    if (!game.user.isGM) return false;
    const journal = this.journalOf(business.id);
    const ownership = this.ownershipFor(business);
    if (!journal) {
      const folder = await this.ensureFolder();
      await JournalEntry.create({
        name: business.name,
        folder: folder.id,
        ownership,
        flags: { [MODULE_ID]: { [FLAGS.BUSINESS]: [business] } },
      });
      return true;
    }
    const changes = {};
    if (journal.name !== business.name) changes.name = business.name;
    const current = journal.ownership ?? {};
    const gone = Object.keys(current).filter((id) => id !== 'default' && !(id in ownership) && !game.users?.get?.(id)?.isGM);
    if (gone.length || Object.entries(ownership).some(([id, level]) => current[id] !== level)) {
      // An ownership update is merged into what is there, so a user who should lose access is removed by name.
      changes.ownership = { ...ownership, ...Object.fromEntries(gone.map((id) => [`-=${id}`, null])) };
    }
    if (Object.keys(changes).length) await journal.update(changes);
    await journal.setFlag(MODULE_ID, FLAGS.BUSINESS, [business]);
    return true;
  },

  /** Delete a business's journal and its hidden state. GM only. */
  async remove(id) {
    if (!game.user.isGM) return false;
    const journal = this.journalOf(id);
    if (!journal) return false;
    await journal.delete();
    return true;
  },
};
