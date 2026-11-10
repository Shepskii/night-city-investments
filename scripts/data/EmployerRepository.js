/**
 * Employers at market corporations (N4, DESIGN §36.17)
 * @file scripts/data/EmployerRepository.js
 * @description Every employer in one GM-only record on the control journal, by id. Players never read it: what they may
 *              see is published on the job board and mirrored onto their characters' jobs. A market reset leaves it.
 */

import { normalizeEmployer } from '../engine/index.js';
import { FLAGS } from '../utils/constants.js';
import { MarketStore } from './MarketStore.js';

const read = () => MarketStore.readRecord(FLAGS.EMPLOYERS) ?? {};

export const EmployerRepository = {
  /** Every employer, by company name. Empty on a player's client. */
  all() {
    return Object.values(read()).map((e) => normalizeEmployer(e)).sort((a, b) => a.name.localeCompare(b.name));
  },

  get(id) {
    const e = read()[id];
    return e ? normalizeEmployer(e) : null;
  },

  forCompany(companyId) {
    return this.all().find((e) => e.companyId === companyId) ?? null;
  },

  async save(employer) {
    await MarketStore._writeRecord(FLAGS.EMPLOYERS, { ...read(), [employer.id]: normalizeEmployer(employer) });
  },

  async remove(id) {
    const { [id]: gone, ...rest } = read();
    if (gone) await MarketStore._writeRecord(FLAGS.EMPLOYERS, rest);
  },
};
