/**
 * A cache of the records a repository keeps on journals.
 * @file scripts/data/journalRecordCache.js
 * @description Reading every business (or syndicate) scans the journals and copies and normalises
 *              each record, so a repository keeps the result: its records, in its order, and an
 *              index by id. The cache is cleared whenever a journal carrying the repository's flag is
 *              created, updated or deleted. Those hooks run on every client, so a change made on
 *              another client clears it here too. The repository's own writes clear it as well.
 *              It is also rebuilt if this client's user or GM status changes, since which journals a
 *              user may read depends on them. Callers get copies, never the cached records.
 */

import { MODULE_ID } from '../utils/constants.js';
import { unwrap } from '../utils/helpers.js';

const JOURNAL_HOOKS = ['createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry'];

/**
 * @param {string} flag - the module flag that holds each journal's record, in the one-write wrapped form
 * @param {{ journals: () => object[], normalize: (record: object) => object }} source - the journals this client may
 *   read, and how a record read from one is normalised. Records without an `id` are left out; the rest are kept
 *   newest first (`createdDay`), then by name.
 * @returns {{ all: () => object[], get: (id: string) => object|null, write: (fn: () => Promise<any>) => Promise<any> }}
 */
export function journalRecordCache(flag, { journals, normalize }) {
  let cached = null;

  const read = () => journals()
    .map((j) => normalize(foundry.utils.deepClone(unwrap(j.getFlag(MODULE_ID, flag)))))
    .filter((record) => record.id)
    .sort((a, b) => b.createdDay - a.createdDay || a.name.localeCompare(b.name));

  const clear = () => {
    cached = null;
  };

  const current = () => {
    const key = { journals: game.journal, userId: game.user?.id, isGM: !!game.user?.isGM };
    if (cached && Object.entries(key).every(([k, v]) => cached.key[k] === v)) return cached;
    const list = read();
    const byId = new Map();
    // As a scan would, the first in order wins if two journals hold the same id.
    for (const record of list) if (!byId.has(record.id)) byId.set(record.id, record);
    cached = { key, list, byId };
    return cached;
  };

  /** Whether a journal change concerns this repository: the journal carries the flag, or the change sets or removes it. */
  const concerns = (journal, changes) => {
    if (journal?.getFlag?.(MODULE_ID, flag)) return true;
    const flags = changes?.flags;
    return !!flags && (`-=${MODULE_ID}` in flags || (!!flags[MODULE_ID] && (flag in flags[MODULE_ID] || `-=${flag}` in flags[MODULE_ID])));
  };

  // On import, so the cache is cleared before any other handler of these hooks reads it.
  for (const hook of JOURNAL_HOOKS) {
    globalThis.Hooks?.on?.(hook, (journal, changes) => {
      if (cached && concerns(journal, hook === 'updateJournalEntry' ? changes : null)) clear();
    });
  }

  return {
    all: () => foundry.utils.deepClone(current().list),
    get: (id) => {
      const record = current().byId.get(id);
      return record ? foundry.utils.deepClone(record) : null;
    },
    /** Run a write to the repository's journals, then clear the cache, whether the write worked or not. */
    write: async (fn) => {
      try {
        return await fn();
      } finally {
        clear();
      }
    },
  };
}
