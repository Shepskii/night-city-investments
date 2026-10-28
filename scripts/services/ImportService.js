/**
 * Starter-company import.
 * @file scripts/services/ImportService.js
 */

import { STARTER_COMPANIES } from '../data/starter-companies.js';
import { CompanyRepository } from '../data/CompanyRepository.js';

export const ImportService = {
  /**
   * Create the starter corporations that do not exist yet (matched by ticker).
   * @returns {Promise<{created: number, skipped: number}>}
   */
  async importStarter() {
    let created = 0;
    let skipped = 0;
    for (const { lore, ...config } of STARTER_COMPANIES) {
      if (CompanyRepository.getByTicker(config.ticker)) {
        skipped++;
        continue;
      }
      const result = await CompanyRepository.save(config, { lore });
      if (result.ok) created++;
      else skipped++;
    }
    return { created, skipped };
  },
};
