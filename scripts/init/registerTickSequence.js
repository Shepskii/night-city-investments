/**
 * After-tick sequence: the one place that says what runs after a market tick, and in what order.
 * @file scripts/init/registerTickSequence.js
 * @description Each step is awaited before the next, and each tick's sequence waits for the one
 *              before it, so steps never overlap or race over shared records. A failing step is
 *              logged and the rest still run.
 */

import { HOOKS } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { SerialQueue } from '../utils/queue.js';
import { IpoService } from '../services/IpoService.js';
import { CorporateActionService } from '../services/CorporateActionService.js';
import { DividendService } from '../services/DividendService.js';
import { FundDistributionService } from '../services/FundDistributionService.js';
import { GigImpactService } from '../services/GigImpactService.js';
import { PortfolioService } from '../services/PortfolioService.js';
import { HeatService } from '../services/HeatService.js';
import { NotificationService } from '../services/NotificationService.js';
import { StatementService } from '../services/StatementService.js';

/** In order. `data` is the `priceTick` hook's payload. */
const STEPS = [
  // Corporate events first, so orders below are worked against listings and splits as they now stand.
  ['IPO listings', () => IpoService.onTick()],
  ['Automatic splits', () => CorporateActionService.onTick()],
  ['Dividends', () => DividendService.onTick()],
  ['Fund distributions', () => FundDistributionService.onTick()],
  ['Gig headlines', () => GigImpactService.onTick()],
  ['Orders, alerts and withdrawals', (data) => PortfolioService.onTick(data)],
  // After orders have been worked, so the audit never waits a tick for an order that is about to fill.
  ['Heat audit', () => HeatService.onTick()],
  ['Notifications', (data) => NotificationService.onTick(data)],
  ['Statements', () => StatementService.onTick()],
];

export const TickSequence = {
  _queue: new SerialQueue('After-tick sequence'),

  /** Run every step for one tick, after any earlier tick's sequence has finished. */
  run(data) {
    return this._queue.run(async () => {
      for (const [name, step] of STEPS) {
        try {
          await step(data);
        } catch (error) {
          log.error(`After-tick step failed: ${name}`, error);
        }
      }
    });
  },
};

export function registerTickSequence(initializer) {
  initializer.register('init', 60, 'After-tick sequence', () => {
    Hooks.on(HOOKS.PRICE_TICK, (data) => {
      if (isActiveGM()) TickSequence.run(data);
    });
  });
}
