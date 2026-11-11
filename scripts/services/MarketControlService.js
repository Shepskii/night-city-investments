/**
 * Market control service: the GM's sentiment, regime, volatility, halt and shock tools.
 * @file scripts/services/MarketControlService.js
 * @description GM client only. Everything here edits the hidden control state through the tick
 *              service's queue, so changes land cleanly between ticks. Nothing here sets a price
 *              directly (see CorporateActionService.setPrice for that).
 */

import {
  makeBias, makeImpact, parseTarget, percentToAmount, SHOCK_PERSISTENCE, logEntry, REGIMES, makeGlide, glideFeasible, GLIDE_NOISE,
} from '../engine/index.js';
import { isActiveGM, L } from '../utils/helpers.js';
import { TickService } from './TickService.js';
import { NewsService } from './NewsService.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { MarketStore } from '../data/MarketStore.js';

const newId = () => foundry.utils.randomID(8);
const stamp = (tick, kind, extra = {}) => ({ ts: Date.now(), tick, kind, ...extra });

export const MarketControlService = {
  /**
   * Add a sentiment bias. `value` is in sigma units per tick (-3..3). It starts on the next tick.
   * @param {{target: string, value: number, days: number, decay?: 'flat'|'linear'}} o - target like "market", "sector:arms", "company:ARA"
   */
  addBias({ target, value, days, decay = 'flat' }) {
    const parsed = parseTarget(target);
    if (!isActiveGM() || !parsed || !(Number(days) >= 1) || !Number.isFinite(Number(value))) return Promise.resolve(false);
    return TickService.updateControls((controls, { tick, dt }) => logEntry({
      ...controls,
      biases: [...controls.biases, makeBias({ id: newId(), target: parsed, value, startTick: tick + dt, duration: days, decay })],
    }, stamp(tick, 'bias', { target, value: Number(value), days: Number(days) }))).then(() => true);
  },

  removeBias(id) {
    return TickService.updateControls((controls) => ({ ...controls, biases: controls.biases.filter((b) => b.id !== id) }));
  },

  /** Force a regime for a number of ticks (starting next tick). */
  forceRegime(regime, days) {
    if (!REGIMES.includes(regime) || !(Number(days) >= 1)) return Promise.resolve(false);
    return TickService.updateControls((controls, { tick }) => logEntry({
      ...controls,
      forceRegime: { regime, untilTick: tick + Math.floor(Number(days)) },
    }, stamp(tick, 'regime', { regime, days: Number(days) }))).then(() => true);
  },

  clearRegime() {
    return TickService.updateControls((controls) => ({ ...controls, forceRegime: null }));
  },

  /** Global volatility multiplier, 0.25 to 4. */
  setVolatility(multiplier) {
    const m = Math.min(4, Math.max(0.25, Number(multiplier)));
    if (!Number.isFinite(m)) return Promise.resolve(false);
    return TickService.updateControls((controls, { tick }) => logEntry({ ...controls, volMult: m }, stamp(tick, 'volatility', { value: m }))).then(() => true);
  },

  /** Halt or resume price movement for the whole market. */
  async setHalt(halted) {
    await TickService.updateControls((controls, { tick }) => logEntry({ ...controls, haltAll: !!halted }, stamp(tick, 'halt', { halted: !!halted })));
    await NewsService.post({ headline: L(halted ? 'NCI.News.HaltAll' : 'NCI.News.ResumeAll'), tone: 'neutral' });
    return true;
  },

  /**
   * Queue a one-off shock as a scheduled impact.
   * @param {{target: string, percent: number, delayDays?: number, persistence?: 'temporary'|'standard'|'lasting', headline?: string}} o
   */
  async addShock({ target, percent, delayDays = 0, persistence = 'standard', headline = '' }) {
    const parsed = parseTarget(target);
    const pct = Number(percent);
    if (!isActiveGM() || !parsed || !Number.isFinite(pct) || pct === 0) return false;
    const shape = SHOCK_PERSISTENCE[persistence] ?? SHOCK_PERSISTENCE.standard;

    await TickService.updateControls((controls, { tick }) => logEntry({
      ...controls,
      impacts: [...controls.impacts, makeImpact({
        id: newId(),
        target: parsed,
        amount: percentToAmount(pct),
        onsetTick: tick + Math.max(0, Math.floor(Number(delayDays) || 0)),
        source: 'gm',
        meta: { percent: pct, persistence, target },
        ...shape,
      })],
    }, stamp(tick, 'shock', { target, percent: pct, delayDays: Number(delayDays) || 0 })));

    if (headline.trim()) {
      await NewsService.post({
        headline: headline.trim(),
        tone: pct > 0 ? 'up' : 'down',
        companyIds: parsed.type === 'company' ? [parsed.id] : [],
        source: 'gm',
      });
    }
    return true;
  },

  removeImpact(id) {
    return TickService.updateControls((controls) => ({ ...controls, impacts: controls.impacts.filter((i) => i.id !== id) }));
  },

  /**
   * Script a company's price: steer it toward `target` over `days` ticks, landing on it exactly on
   * the last one. It starts on the next tick and replaces any glide the company already has.
   * @param {{companyId: string, target: number, days: number, noise?: 'low'|'medium'|'high'}} o
   * @returns {Promise<boolean>} false when the inputs are not usable (unknown company, a target that needs an absurdly steep move)
   */
  async addGlide({ companyId, target, days, noise = 'medium' }) {
    const price = MarketStore.getPublic().companies?.[companyId]?.price;
    const company = CompanyRepository.get(companyId);
    const n = Math.floor(Number(days));
    const goal = Math.round(Number(target) * 100) / 100;
    if (!isActiveGM() || !company || company.status !== 'active' || !price) return false;
    if (!(n >= 1) || !glideFeasible(price, goal, n)) return false;

    await TickService.updateControls((controls, { tick, dt }) => logEntry({
      ...controls,
      glides: [
        ...controls.glides.filter((g) => g.companyId !== companyId),
        makeGlide({ id: newId(), companyId, target: goal, startTick: tick + dt, duration: n, noise: GLIDE_NOISE[noise] ?? GLIDE_NOISE.medium }),
      ],
    }, stamp(tick, 'glide', { companyId, from: price, to: goal, days: n })));
    return true;
  },

  removeGlide(id) {
    return TickService.updateControls((controls) => ({ ...controls, glides: controls.glides.filter((g) => g.id !== id) }));
  },

  /** Options for a target picker: the whole market, each sector in use, each company. */
  targetOptions() {
    const companies = CompanyRepository.all({ includeUnlisted: true });
    const sectors = [...new Set(companies.map((c) => c.sector))].sort();
    return [
      { value: 'market', label: L('NCI.Controls.WholeMarket'), group: 'market' },
      ...sectors.map((s) => ({ value: `sector:${s}`, label: L(`NCI.Sector.${s}`), group: 'sector' })),
      ...companies.map((c) => ({ value: `company:${c.id}`, label: `${c.ticker} ${c.name}`, group: 'company' })),
    ];
  },
};
