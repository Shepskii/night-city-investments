/**
 * Market store: where market state lives.
 * @file scripts/data/MarketStore.js
 * @description
 *   public state + history  -> world settings (every client can read, only the GM writes)
 *   hidden engine state     -> a GM-only journal flag (fair value, true regime): never sent to players
 */

import { emptyHistory, emptyNews, emptyGigs, emptyHeat, normalizeControls, normalizeGigs, normalizeHeat, timeOf } from '../engine/index.js';
import { MODULE_ID, SETTINGS, FLAGS, CONTROL_JOURNAL_NAME } from '../utils/constants.js';

const clone = (v) => foundry.utils.deepClone(v);

/**
 * GM-only records are stored wrapped in a one-element array. Foundry merges an object into the flag
 * already there, so a key removed from the record would linger; an array always replaces the old
 * value, so one write saves the record exactly. Unwrapped values are from before v0.9.7.
 */
const unwrap = (stored) => (Array.isArray(stored) ? stored[0] : stored);

/** Serialises changes to the dividend records, which the dividend and fund distribution services both write. */
let recordsQueue = Promise.resolve();

export const MarketStore = {
  /** Public state; an empty object until the market has been initialised. */
  getPublic() {
    return clone(game.settings.get(MODULE_ID, SETTINGS.MARKET_STATE) ?? {});
  },

  hasState() {
    return !!this.getPublic().schema;
  },

  /**
   * The market clock in game days (a float): what every duration, delay and expiry is measured on.
   * A market from before the clock existed has none stored, and then it is the tick count, which was
   * one day per tick.
   */
  time() {
    return timeOf(this.getPublic());
  },

  setPublic(value) {
    return game.settings.set(MODULE_ID, SETTINGS.MARKET_STATE, value);
  },

  getHistory() {
    const h = clone(game.settings.get(MODULE_ID, SETTINGS.MARKET_HISTORY) ?? {});
    return h.series ? h : emptyHistory();
  },

  setHistory(value) {
    return game.settings.set(MODULE_ID, SETTINGS.MARKET_HISTORY, value);
  },

  /** The GM-only journal; players never receive it because its default ownership is NONE. */
  controlJournal() {
    return game.journal.find((j) => j.getFlag(MODULE_ID, FLAGS.CONTROL));
  },

  async ensureControlJournal() {
    if (!game.user.isGM) return null;
    const existing = this.controlJournal();
    if (existing) return existing;
    return JournalEntry.create({
      name: CONTROL_JOURNAL_NAME,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [MODULE_ID]: { [FLAGS.CONTROL]: true } },
    });
  },

  /** Hidden engine state, or null (always null on a player client). */
  getHidden() {
    return this.readRecord(FLAGS.ENGINE);
  },

  setHidden(value) {
    return this._writeRecord(FLAGS.ENGINE, value);
  },

  /** A GM-only record from the control journal, or null. */
  readRecord(flag) {
    const stored = unwrap(this.controlJournal()?.getFlag(MODULE_ID, flag));
    return stored ? clone(stored) : null;
  },

  /** Replace a GM-only record in one write. */
  async _writeRecord(flag, value) {
    const journal = await this.ensureControlJournal();
    if (!journal) return;
    await journal.setFlag(MODULE_ID, flag, [value]);
  },

  async clearAll() {
    await this.setPublic({});
    await this.setHistory(emptyHistory());
    await this.setNews(emptyNews());
    await this.setDividendRecords({});
    const journal = this.controlJournal();
    if (journal) {
      await journal.unsetFlag(MODULE_ID, FLAGS.ENGINE);
      await journal.unsetFlag(MODULE_ID, FLAGS.CONTROLS);
      await journal.unsetFlag(MODULE_ID, FLAGS.SNAPSHOTS);
      // Ticks start again from zero, so the queue and history would no longer line up; mappings stay.
      const gigs = this.readRecord(FLAGS.GIGS);
      if (gigs) await this.setGigs({ ...emptyGigs(), mappings: normalizeGigs(gigs).mappings });
      // Heat is measured in ticks too, so it starts again with them.
      if (journal.getFlag(MODULE_ID, FLAGS.HEAT)) await this.setHeat(emptyHeat());
    }
  },

  /** Pre-tick snapshots, oldest first. GM only: they hold the hidden state. */
  getSnapshots() {
    const stored = this.controlJournal()?.getFlag(MODULE_ID, FLAGS.SNAPSHOTS);
    return Array.isArray(stored) ? clone(stored) : [];
  },

  /** The list is an array already, so Foundry replaces it outright. */
  async setSnapshots(list) {
    const journal = await this.ensureControlJournal();
    if (!journal) return;
    await journal.setFlag(MODULE_ID, FLAGS.SNAPSHOTS, list);
  },

  /** GM control state (biases, impacts, forced regime). Only the GM can read it. */
  getControls() {
    return normalizeControls(this.readRecord(FLAGS.CONTROLS));
  },

  setControls(value) {
    return this._writeRecord(FLAGS.CONTROLS, value);
  },

  /** Gig outcomes: the approval queue, the history and the client mappings. GM only. */
  getGigs() {
    return normalizeGigs(this.readRecord(FLAGS.GIGS));
  },

  setGigs(value) {
    return this._writeRecord(FLAGS.GIGS, value);
  },

  /** Insider-trading heat, the watch windows and the audits. GM only: players cannot read the control journal. */
  getHeat() {
    return normalizeHeat(this.readRecord(FLAGS.HEAT));
  },

  setHeat(value) {
    return this._writeRecord(FLAGS.HEAT, value);
  },

  /** Each player business's hidden state, by business id: `{ [id]: { exposure } }`. GM only. */
  getBusinessesHidden() {
    return this.readRecord(FLAGS.BUSINESSES) ?? {};
  },

  setBusinessesHidden(value) {
    return this._writeRecord(FLAGS.BUSINESSES, value);
  },

  getNews() {
    const feed = clone(game.settings.get(MODULE_ID, SETTINGS.NEWS_FEED) ?? {});
    return feed.items ? feed : emptyNews();
  },

  setNews(value) {
    return game.settings.set(MODULE_ID, SETTINGS.NEWS_FEED, value);
  },

  /** { [companyId]: { lastKey, perShare, tick, date } } */
  getDividendRecords() {
    return clone(game.settings.get(MODULE_ID, SETTINGS.DIVIDEND_RECORDS) ?? {});
  },

  setDividendRecords(value) {
    return game.settings.set(MODULE_ID, SETTINGS.DIVIDEND_RECORDS, value);
  },

  /**
   * Change the dividend records against a fresh read, after any change already under way, so two
   * writers never save a copy that misses the other's change.
   * @param {(records: object) => (object|null)} fn - the new records, or null to leave them as they are
   * @returns {Promise<boolean>} whether the records were written
   */
  updateDividendRecords(fn) {
    const task = recordsQueue.then(async () => {
      const next = fn(this.getDividendRecords());
      if (!next) return false;
      await this.setDividendRecords(next);
      return true;
    });
    recordsQueue = task.catch(() => undefined);
    return task;
  },
};
