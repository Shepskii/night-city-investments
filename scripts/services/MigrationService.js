/**
 * Migration service: brings a world's stored data up to the current schema.
 * @file scripts/services/MigrationService.js
 * @description Runs on the active GM's client when the world loads, before anything reads or writes
 *              the data. The steps themselves are pure (engine/migrations.js).
 */

import { MODULE_ID, SETTINGS, FLAGS } from '../utils/constants.js';
import { log, isActiveGM, L } from '../utils/helpers.js';
import { runMigrations, latestSchemaVersion } from '../engine/index.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';


const STORE_FLAGS = { controls: FLAGS.CONTROLS, gigs: FLAGS.GIGS, heat: FLAGS.HEAT };
const STORE_SETTERS = { controls: 'setControls', gigs: 'setGigs', heat: 'setHeat' };

export const MigrationService = {
  /** The schema version this world was last brought to (1 for a world that has never been migrated). */
  version() {
    return Math.floor(Number(game.settings.get(MODULE_ID, SETTINGS.SCHEMA_VERSION))) || 1;
  },

  latest: latestSchemaVersion,

  /** What the migration steps may read and write. */
  context() {
    return {
      // Characters' portfolios, and every syndicate's account (DESIGN §30).
      portfolios: () => [...game.actors.filter((a) => PortfolioRepository.hasPortfolio(a)), ...this._syndicates()]
        .map((a) => ({ id: a.id, name: a.name, data: PortfolioRepository.raw(a) })),
      savePortfolio: (id, data) => PortfolioRepository.save(PortfolioRepository.accountOf(id), data),
      stores: () => Object.fromEntries(Object.entries(STORE_FLAGS).map(([name, flag]) => [name, MarketStore.readRecord(flag)])),
      saveStore: (name, data) => MarketStore[STORE_SETTERS[name]](data),
      saveVersion: (n) => game.settings.set(MODULE_ID, SETTINGS.SCHEMA_VERSION, n),
    };
  },

  /** Every syndicate's account that has a portfolio, whatever its status. */
  _syndicates() {
    return SyndicateRepository.all().map((s) => SyndicateRepository.account(s.id)).filter((a) => a && PortfolioRepository.hasPortfolio(a));
  },

  /** Run any steps this world has not had yet. Active GM only. */
  async run() {
    if (!isActiveGM()) return null;
    const result = await runMigrations({ from: this.version(), ctx: this.context() });
    if (!result.ok) {
      log.error(`Migration to v${result.failed.version} (${result.failed.id}) failed`, result.failed.error);
      ui.notifications.error(L('NCI.Migration.Failed', { version: result.failed.version }));
    } else if (result.applied.length) {
      log.info(`Stored data brought to schema v${result.version}`, result.applied);
    } else if (result.newer) {
      log.warn(`This world's data is schema v${result.version}, newer than this module understands (v${latestSchemaVersion()})`);
    }
    return result;
  },
};
