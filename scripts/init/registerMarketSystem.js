/**
 * Market system: company journal hooks, tick service, public market API.
 * @file scripts/init/registerMarketSystem.js
 */

import { MODULE_ID, FLAGS, HOOKS } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { TickService } from '../services/TickService.js';
import { DividendService } from '../services/DividendService.js';
import { FundDistributionService } from '../services/FundDistributionService.js';
import { CorporateActionService } from '../services/CorporateActionService.js';
import { MarketControlService } from '../services/MarketControlService.js';
import { NewsService } from '../services/NewsService.js';
import { IpoService } from '../services/IpoService.js';
import { UndoService } from '../services/UndoService.js';
import { PreviewService } from '../services/PreviewService.js';
import { GigImpactService } from '../services/GigImpactService.js';
import { HeatService } from '../services/HeatService.js';

/** A journal (or one of its pages) changed: tell open windows, and let the GM resync the market. */
function onJournalChange(journal) {
  if (!journal?.getFlag?.(MODULE_ID, FLAGS.COMPANY)) return;
  Hooks.callAll(HOOKS.COMPANIES_CHANGED);
  if (isActiveGM()) TickService.syncCompanies();
}

export function registerMarketSystem(initializer) {
  initializer.register('init', 30, 'Company journal hooks', () => {
    // Rolling the calendar back undoes ticks, but never ones that have already moved a player's money.
    TickService.setSettledCheck((tickIndex) => UndoService.isSettled(tickIndex));
    for (const hook of ['createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry']) {
      Hooks.on(hook, (journal) => onJournalChange(journal));
    }
    for (const hook of ['createJournalEntryPage', 'updateJournalEntryPage', 'deleteJournalEntryPage']) {
      Hooks.on(hook, (page) => onJournalChange(page.parent));
    }

    // After each tick the active GM checks dividend schedules and auto-split thresholds.
    Hooks.on(HOOKS.PORTFOLIO_EVENTS, (data) => {
      if (isActiveGM()) HeatService.onPortfolioEvents(data);
    });
    Hooks.on(HOOKS.PRICE_TICK, () => {
      if (!isActiveGM()) return;
      IpoService.onTick();
      DividendService.onTick();
      FundDistributionService.onTick();
      CorporateActionService.onTick();
      GigImpactService.onTick();
      // The heat audit runs from the portfolio system's tick hook, after orders have been worked.
    });
  });

  initializer.register('ready', 40, 'Market API', () => {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) return;
    api.market = {
      companies: () => CompanyRepository.all(),
      company: (idOrTicker) => CompanyRepository.get(idOrTicker) ?? CompanyRepository.getByTicker(idOrTicker),
      state: () => MarketStore.getPublic(),
      history: () => MarketStore.getHistory(),
      news: () => MarketStore.getNews(),
      advance: (ticks = 1) => TickService.advance(ticks),
    };
    // For other modules (the Night City Map bridge). `reportImpact` only works on the active GM's client.
    api.events = {
      reportImpact: (payload) => GigImpactService.report(payload),
      resolveClient: (gig) => GigImpactService.resolve(typeof gig === 'string' ? { client: gig } : gig),
      isReported: (sourceKey) => GigImpactService.known(sourceKey),
    };
    // GM-only helpers; each one checks that it is running on the active GM's client.
    api.gm = {
      controls: MarketControlService,
      corporateActions: CorporateActionService,
      dividends: DividendService,
      news: NewsService,
      ipo: IpoService,
      undo: UndoService,
      preview: PreviewService,
      gigs: GigImpactService,
      heat: HeatService,
    };
  });

  initializer.register('ready', 50, 'Tick service', async () => {
    if (isActiveGM()) await MarketStore.ensureControlJournal();
    TickService.start();
    log.info('Tick service started');
  });
}
