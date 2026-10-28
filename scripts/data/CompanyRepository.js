/**
 * Company repository: companies are JournalEntries flagged with their config.
 * @file scripts/data/CompanyRepository.js
 * @description The flag holds the public config; the journal's text page is the public lore.
 *              Creating, editing and deleting is GM-only. Everyone reads what they can see.
 */

import { sanitizeCompany } from '../engine/index.js';
import { MODULE_ID, FLAGS, COMPANY_FOLDER_NAME } from '../utils/constants.js';
import { textToHtml, htmlToText } from '../utils/text.js';

const LEVELS = () => CONST.DOCUMENT_OWNERSHIP_LEVELS;

function loreOf(journal) {
  if (!journal.testUserPermission(game.user, 'OBSERVER')) return '';
  const page = journal.pages.contents.find((p) => p.type === 'text');
  return page?.text?.content ?? '';
}

function toCompany(journal) {
  const config = journal.getFlag(MODULE_ID, FLAGS.COMPANY);
  if (!config) return null;
  return {
    ...config,
    journalId: journal.id,
    lore: loreOf(journal),
    loreText: htmlToText(loreOf(journal)),
    canEdit: journal.isOwner,
  };
}

export const CompanyRepository = {
  /** Journals that define a company. */
  journals() {
    return game.journal.filter((j) => j.getFlag(MODULE_ID, FLAGS.COMPANY));
  },

  /**
   * All companies the current user can see. Unlisted companies are visible to GMs only.
   */
  all({ includeUnlisted = game.user.isGM } = {}) {
    return this.journals()
      .map(toCompany)
      .filter((c) => c && (includeUnlisted || c.listed))
      .sort((a, b) => a.ticker.localeCompare(b.ticker));
  },

  get(id) {
    return this.all({ includeUnlisted: true }).find((c) => c.id === id) ?? null;
  },

  /** Companies with a listing date coming up. Everyone can see them (they are announced, not yet trading). */
  upcomingIpos() {
    return this.journals()
      .map(toCompany)
      .filter((c) => c && !c.listed && c.ipo?.date)
      .sort((a, b) => a.ipo.date.localeCompare(b.ipo.date));
  },

  getByTicker(ticker) {
    const t = String(ticker ?? '').toUpperCase();
    return this.all({ includeUnlisted: true }).find((c) => c.ticker === t) ?? null;
  },

  async ensureFolder() {
    const existing = game.folders.find((f) => f.type === 'JournalEntry' && f.name === COMPANY_FOLDER_NAME);
    return existing ?? Folder.create({ name: COMPANY_FOLDER_NAME, type: 'JournalEntry' });
  },

  /**
   * Create or update a company. GM only.
   * @param {object} input - form data; include `id` to update
   * @param {{lore?: string}} [opts] - plain-text lore; omit to leave the journal text untouched
   * @returns {Promise<{ok: true, company: object} | {ok: false, errors: string[]}>}
   */
  async save(input, { lore } = {}) {
    if (!game.user.isGM) return { ok: false, errors: ['gm-only'] };

    const result = sanitizeCompany(input);
    if (!result.ok) return result;
    const company = result.company;

    const clash = this.all({ includeUnlisted: true }).find((c) => c.ticker === company.ticker && c.id !== company.id);
    if (clash) return { ok: false, errors: ['ticker-taken'] };

    const existing = input.id ? this.journals().find((j) => j.getFlag(MODULE_ID, FLAGS.COMPANY)?.id === input.id) : null;
    const journalName = `${company.name} (${company.ticker})`;

    if (existing) {
      await existing.update({ name: journalName });
      await existing.setFlag(MODULE_ID, FLAGS.COMPANY, company);
      if (lore !== undefined) await this._writeLore(existing, lore);
      return { ok: true, company };
    }

    if (this.get(company.id)) return { ok: false, errors: ['ticker-taken'] };
    const folder = await this.ensureFolder();
    await JournalEntry.create({
      name: journalName,
      folder: folder.id,
      ownership: { default: LEVELS().OBSERVER },
      flags: { [MODULE_ID]: { [FLAGS.COMPANY]: company } },
      pages: [{ name: 'Overview', type: 'text', text: { content: textToHtml(lore ?? ''), format: 1 } }],
    });
    return { ok: true, company };
  },

  async _writeLore(journal, lore) {
    const html = textToHtml(lore);
    const page = journal.pages.contents.find((p) => p.type === 'text');
    if (page) return page.update({ 'text.content': html });
    return journal.createEmbeddedDocuments('JournalEntryPage', [
      { name: 'Overview', type: 'text', text: { content: html, format: 1 } },
    ]);
  },

  /** Delete a company's journal. GM only. */
  async remove(id) {
    if (!game.user.isGM) return false;
    const journal = this.journals().find((j) => j.getFlag(MODULE_ID, FLAGS.COMPANY)?.id === id);
    if (!journal) return false;
    await journal.delete();
    return true;
  },
};
