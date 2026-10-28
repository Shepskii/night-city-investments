/**
 * Market store: where market state lives.
 * @file scripts/data/MarketStore.js
 * @description
 *   public state + history  -> world settings (every client can read, only the GM writes)
 *   hidden engine state     -> a GM-only journal flag (fair value, true regime): never sent to players
 */

import { emptyHistory, emptyNews, emptyGigs, emptyHeat, normalizeControls, normalizeGigs, normalizeHeat } from '../engine/index.js';
import { MODULE_ID, SETTINGS, FLAGS, CONTROL_JOURNAL_NAME } from '../utils/constants.js';

const clone = (v) => foundry.utils.deepClone(v);

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
    const pub = this.getPublic();
    return pub.time ?? pub.tickIndex ?? 0;
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
    const journal = this.controlJournal();
    const hidden = journal?.getFlag(MODULE_ID, FLAGS.ENGINE);
    return hidden ? clone(hidden) : null;
  },

  async setHidden(value) {
    const journal = await this.ensureControlJournal();
    if (!journal) return;
    // Replace rather than merge, so removed companies do not linger.
    await journal.unsetFlag(MODULE_ID, FLAGS.ENGINE);
    await journal.setFlag(MODULE_ID, FLAGS.ENGINE, value);
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
      const gigs = journal.getFlag(MODULE_ID, FLAGS.GIGS);
      if (gigs) await this.setGigs({ ...emptyGigs(), mappings: normalizeGigs(clone(gigs)).mappings });
      // Heat is measured in ticks too, so it starts again with them.
      if (journal.getFlag(MODULE_ID, FLAGS.HEAT)) await this.setHeat(emptyHeat());
    }
  },

  /** Pre-tick snapshots, oldest first. GM only: they hold the hidden state. */
  getSnapshots() {
    const stored = this.controlJournal()?.getFlag(MODULE_ID, FLAGS.SNAPSHOTS);
    return Array.isArray(stored) ? clone(stored) : [];
  },

  async setSnapshots(list) {
    const journal = await this.ensureControlJournal();
    if (!journal) return;
    await journal.unsetFlag(MODULE_ID, FLAGS.SNAPSHOTS);
    if (list.length) await journal.setFlag(MODULE_ID, FLAGS.SNAPSHOTS, list);
  },

  /** GM control state (biases, impacts, forced regime). Only the GM can read it. */
  getControls() {
    const stored = this.controlJournal()?.getFlag(MODULE_ID, FLAGS.CONTROLS);
    return normalizeControls(stored ? clone(stored) : null);
  },

  async setControls(value) {
    const journal = await this.ensureControlJournal();
    if (!journal) return;
    await journal.unsetFlag(MODULE_ID, FLAGS.CONTROLS);
    await journal.setFlag(MODULE_ID, FLAGS.CONTROLS, value);
  },

  /** Gig outcomes: the approval queue, the history and the client mappings. GM only. */
  getGigs() {
    const stored = this.controlJournal()?.getFlag(MODULE_ID, FLAGS.GIGS);
    return normalizeGigs(stored ? clone(stored) : null);
  },

  async setGigs(value) {
    const journal = await this.ensureControlJournal();
    if (!journal) return;
    await journal.unsetFlag(MODULE_ID, FLAGS.GIGS);
    await journal.setFlag(MODULE_ID, FLAGS.GIGS, value);
  },

  /** Insider-trading heat, the watch windows and the audits. GM only: players cannot read the control journal. */
  getHeat() {
    const stored = this.controlJournal()?.getFlag(MODULE_ID, FLAGS.HEAT);
    return normalizeHeat(stored ? clone(stored) : null);
  },

  async setHeat(value) {
    const journal = await this.ensureControlJournal();
    if (!journal) return;
    await journal.unsetFlag(MODULE_ID, FLAGS.HEAT);
    await journal.setFlag(MODULE_ID, FLAGS.HEAT, value);
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
};
