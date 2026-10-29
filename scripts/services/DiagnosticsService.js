/**
 * Diagnostics service: the GM's self-check, trade log and company suggestions.
 * @file scripts/services/DiagnosticsService.js
 * @description Gathers what the pure engine functions need from Foundry. GM only: a player cannot
 *              read other characters' portfolios or the control journal.
 */

import { MODULE_ID, SETTINGS, WIRE_TAG, BROKER_TAG } from '../utils/constants.js';
import { log, L } from '../utils/helpers.js';
import { verifyWorld, tradeLog, suggestCompanies } from '../engine/index.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { BrokerRepository } from '../data/BrokerRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { NcmAdapter } from '../integrations/NcmAdapter.js';
import { MigrationService } from './MigrationService.js';


export const DiagnosticsService = {
  /** Every character, and every syndicate, that has a portfolio, with the portfolio. */
  portfolios() {
    const syndicates = SyndicateRepository.all().map((s) => SyndicateRepository.account(s.id)).filter(Boolean);
    return [...game.actors, ...syndicates]
      .filter((a) => PortfolioRepository.hasPortfolio(a))
      .map((a) => ({ id: a.id, actorId: a.id, name: a.name, portfolio: PortfolioRepository.get(a) }));
  },

  snapshot() {
    const pub = MarketStore.getPublic();
    return {
      schema: { stored: MigrationService.version(), latest: MigrationService.latest() },
      ncm: { available: NcmAdapter.available(), wire: NcmAdapter.contactsTagged(WIRE_TAG).length > 0 },
      seed: !!game.settings.get(MODULE_ID, SETTINGS.WORLD_SEED),
      control: !!MarketStore.controlJournal(),
      companies: CompanyRepository.all({ includeUnlisted: true }),
      market: { ...pub, hasState: !!pub.schema },
      funds: FundRepository.all(),
      brokers: BrokerRepository.list(),
      portfolios: this.portfolios(),
      heat: {
        enabled: game.settings.get(MODULE_ID, SETTINGS.HEAT_ENABLED) === true,
        pending: MarketStore.getHeat().penalties.filter((p) => p.status === 'pending').length,
      },
    };
  },

  /**
   * Check the world's data and say what is wrong. GM only.
   * @param {{silent?: boolean}} [opts] - silent skips the console summary and notification
   * @returns {{ok: boolean, counts: object, checks: object[]} | null}
   */
  verify({ silent = false } = {}) {
    if (!game.user.isGM) {
      if (!silent) ui.notifications.warn(L('NCI.Errors.gm-only'));
      return null;
    }
    const report = verifyWorld(this.snapshot());
    if (!silent) {
      const { fail, warn } = report.counts;
      log.info(`Self-check: ${report.counts.ok} ok, ${report.counts.info} info, ${warn} warning(s), ${fail} failure(s)`);
      for (const c of report.checks.filter((x) => x.level !== 'ok')) log[c.level === 'fail' ? 'error' : 'warn'](`${c.id} (${c.level}): ${c.detail}`);
      const key = fail ? 'NCI.Verify.SummaryFail' : warn ? 'NCI.Verify.SummaryWarn' : 'NCI.Verify.SummaryOk';
      ui.notifications[fail ? 'error' : warn ? 'warn' : 'info'](L(key, { fail, warn }));
    }
    return report;
  },

  /** Recent fills across every portfolio, newest first. GM only. */
  tradeLog(opts = {}) {
    if (!game.user.isGM) return [];
    return tradeLog(this.portfolios(), opts);
  },

  /** Corporations named on NCM contacts and gigs that have no company yet. GM only. */
  suggestions(limit = 12) {
    if (!game.user.isGM) return [];
    const gigs = MarketStore.getGigs();
    const sources = [
      ...NcmAdapter.allContacts()
        .filter((c) => !c.sendOnly && !c.tags?.some((t) => String(t).toLowerCase() === BROKER_TAG))
        .map((c) => ({ name: c.organization, from: 'contact' })),
      ...[...gigs.pending, ...gigs.history].map((g) => ({ name: g.client, from: 'gig' })),
    ];
    return suggestCompanies(sources, CompanyRepository.all({ includeUnlisted: true }), {
      mappings: gigs.mappings,
      taken: FundRepository.all().map((f) => f.ticker),
      limit,
    });
  },
};
