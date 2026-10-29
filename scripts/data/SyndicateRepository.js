/**
 * Syndicate repository: each player syndicate is a private JournalEntry.
 * @file scripts/data/SyndicateRepository.js
 * @description The journal carries two flags, both saved in the one-write wrapped form and written
 *              only by the GM: the record (`syndicate`) and the syndicate's own brokerage account
 *              (`portfolio`, an ordinary portfolio, so PortfolioRepository reads it as it reads a
 *              character's). Ownership is None by default and Observer for the users of its invited
 *              and active members' characters, so nobody else's client receives it.
 */

import { normalizeSyndicate, normalizePortfolio, seenBy, activeMembers } from '../engine/index.js';
import { MODULE_ID, FLAGS, SYNDICATE_FOLDER_NAME } from '../utils/constants.js';
import { unwrap } from '../utils/helpers.js';

const LEVELS = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;
const recordOf = (journal) => unwrap(journal?.getFlag(MODULE_ID, FLAGS.SYNDICATE));

export const SyndicateRepository = {
  /** Syndicate journals this user may read (checked, since a member who left keeps a stale copy until they reload). */
  journals() {
    return game.journal.filter((j) => recordOf(j) && (game.user.isGM || j.testUserPermission?.(game.user, 'OBSERVER') !== false));
  },

  /** Every syndicate this client can read, newest first. */
  all() {
    return this.journals()
      .map((j) => normalizeSyndicate(foundry.utils.deepClone(recordOf(j))))
      .filter((s) => s.id)
      .sort((a, b) => b.createdDay - a.createdDay || a.name.localeCompare(b.name));
  },

  get(id) {
    return this.all().find((s) => s.id === id) ?? null;
  },

  /** The journal holding a syndicate. It stands in for an actor wherever a portfolio is read. */
  journalOf(id) {
    return this.journals().find((j) => recordOf(j)?.id === id) ?? null;
  },

  /** The syndicate's own brokerage account. */
  portfolio(id) {
    const journal = this.journalOf(id);
    return normalizePortfolio(foundry.utils.deepClone(unwrap(journal?.getFlag(MODULE_ID, FLAGS.PORTFOLIO)) ?? null));
  },

  /**
   * The syndicate as a brokerage account: it stands in for an actor wherever the market reads or
   * writes a portfolio, and its users are its active members' users. `members()` are their actors.
   */
  account(id) {
    const journal = this.journalOf(id);
    const syndicate = journal ? normalizeSyndicate(foundry.utils.deepClone(recordOf(journal))) : null;
    if (!syndicate?.id) return null;
    const members = () => activeMembers(syndicate).map((m) => game.actors.get(m.actorId)).filter(Boolean);
    return {
      id: syndicate.id,
      name: syndicate.name,
      type: 'syndicate',
      isSyndicate: true,
      syndicate,
      journal,
      members,
      hasPlayerOwner: true,
      get isOwner() {
        return game.user.isGM || members().some((a) => a.isOwner);
      },
      getFlag: (scope, key) => journal.getFlag(scope, key),
      setFlag: (scope, key, value) => journal.setFlag(scope, key, value),
      testUserPermission: (user, level) => members().some((a) => a.testUserPermission?.(user, level)),
    };
  },

  /** Every syndicate that trades, as an account. */
  accounts() {
    return this.all().filter((s) => s.status === 'active').map((s) => this.account(s.id)).filter(Boolean);
  },

  /** Syndicates a character belongs to or is invited to. */
  forActor(actorId) {
    return this.all().filter((s) => seenBy(s).includes(actorId));
  },

  /** The ownership a syndicate's journal should have: Observer for the users of its invited and active members. */
  ownershipFor(syndicate) {
    const ownership = { default: LEVELS().NONE };
    for (const actorId of seenBy(syndicate)) {
      const actor = game.actors.get(actorId);
      for (const user of game.users?.filter?.((u) => !u.isGM && actor?.testUserPermission?.(u, 'OWNER')) ?? []) {
        ownership[user.id] = LEVELS().OBSERVER;
      }
    }
    return ownership;
  },

  async ensureFolder() {
    const existing = game.folders.find((f) => f.type === 'JournalEntry' && f.name === SYNDICATE_FOLDER_NAME);
    return existing ?? Folder.create({ name: SYNDICATE_FOLDER_NAME, type: 'JournalEntry' });
  },

  /**
   * Create or replace a syndicate's record and, if given, its account, in one write. GM only.
   * @param {object} syndicate
   * @param {object} [portfolio]
   */
  async save(syndicate, portfolio = null) {
    if (!game.user.isGM) return false;
    const journal = this.journalOf(syndicate.id);
    const ownership = this.ownershipFor(syndicate);
    const flags = { [FLAGS.SYNDICATE]: [syndicate], ...(portfolio ? { [FLAGS.PORTFOLIO]: [portfolio] } : {}) };
    if (!journal) {
      const folder = await this.ensureFolder();
      await JournalEntry.create({ name: syndicate.name, folder: folder.id, ownership, flags: { [MODULE_ID]: flags } });
      return true;
    }
    const changes = { flags: { [MODULE_ID]: flags } };
    if (journal.name !== syndicate.name) changes.name = syndicate.name;
    const current = journal.ownership ?? {};
    const gone = Object.keys(current).filter((id) => id !== 'default' && !(id in ownership) && !game.users?.get?.(id)?.isGM);
    if (gone.length || Object.entries(ownership).some(([id, level]) => current[id] !== level)) {
      // An ownership update is merged into what is there, so a user who should lose access is removed by name.
      changes.ownership = { ...ownership, ...Object.fromEntries(gone.map((id) => [`-=${id}`, null])) };
    }
    await journal.update(changes);
    return true;
  },

  /** Delete a syndicate's journal. GM only. */
  async remove(id) {
    if (!game.user.isGM) return false;
    const journal = this.journalOf(id);
    if (!journal) return false;
    await journal.delete();
    return true;
  },
};
