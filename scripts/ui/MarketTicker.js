/**
 * Market ticker strip: an optional compact HUD element with the NC index and either the player's
 * watched companies or, if there are none, the day's biggest movers.
 * @file scripts/ui/MarketTicker.js
 * @description Each player switches it on in their own client settings. It is one small element on
 *              the page, refreshed whenever the market or the player's watchlist changes; clicking it
 *              opens the Market Terminal. It shows only what the terminal already shows to everyone.
 */

import { MODULE_ID, SETTINGS, HOOKS } from '../utils/constants.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { tickerView, tickerHtml } from './components/ticker.js';
import { MarketTerminalApp } from './MarketTerminal/MarketTerminalApp.js';

const ELEMENT_ID = 'nci-ticker';

/**
 * Whose watchlist the strip follows: a player's assigned (or first owned) character. A GM has no
 * character of their own to watch for, so only an assigned one counts and otherwise the strip
 * shows the movers.
 */
function watchedIds() {
  const actor = game.user.isGM ? game.user.character : PortfolioRepository.defaultActor();
  return actor ? { actorId: actor.id, ids: PortfolioRepository.watchlist(actor) } : { actorId: null, ids: [] };
}

export const MarketTicker = {
  /** Start listening. Safe to call more than once. */
  start() {
    if (this._started) return;
    this._started = true;
    for (const hook of [HOOKS.MARKET_UPDATED, HOOKS.COMPANIES_CHANGED]) Hooks.on(hook, () => this.refresh());
    // A watchlist is a flag on the character, so a change to it arrives as an actor update.
    Hooks.on('updateActor', (actor, changes) => {
      if (changes?.flags?.[MODULE_ID] && actor.id === watchedIds().actorId) this.refresh();
    });
    this.refresh();
  },

  enabled() {
    return !!game.settings.get(MODULE_ID, SETTINGS.SHOW_TICKER);
  },

  /** Draw, update or remove the strip to match the setting and the market. */
  refresh() {
    let el = document.getElementById(ELEMENT_ID);
    const view = this.enabled() ? this.view() : null;
    if (!view) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = ELEMENT_ID;
      el.className = 'nci-ticker';
      el.title = game.i18n.localize('NCI.Ticker.Open');
      el.addEventListener('click', () => MarketTerminalApp.open());
      document.body.appendChild(el);
    }
    el.innerHTML = tickerHtml(view, game.i18n.localize('NCI.Ticker.Index'));
  },

  /** The numbers for the strip, or null until the market has started. */
  view() {
    const pub = MarketStore.getPublic();
    if (!pub.schema) return null;
    return tickerView({ quotes: pub.companies ?? {}, companies: CompanyRepository.all(), watched: watchedIds().ids });
  },
};
