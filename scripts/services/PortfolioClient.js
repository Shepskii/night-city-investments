/**
 * Portfolio client: the player's side of the outbox.
 * @file scripts/services/PortfolioClient.js
 * @description Players never change a portfolio. They append a request to the actor's outbox flag
 *              and the active GM's executor handles it. Writes from this client are serialised so
 *              two quick clicks cannot overwrite each other.
 */

import { MODULE_ID, FLAGS, SETTINGS, OUTBOX_LIMIT } from '../utils/constants.js';
import { moverThreshold, HEAT_ACTIONS, canAttempt } from '../engine/index.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { SkillAdapter } from './SkillAdapter.js';
import { TerminalAccess } from './TerminalAccess.js';
import { SerialQueue } from '../utils/queue.js';

class PortfolioClientImpl {
  constructor() {
    this._chain = new SerialQueue('Portfolio client write');
    /** Keys submitted from this client, so results can be announced to the right person. */
    this.submitted = new Set();
  }

  _write(fn) {
    return this._chain.run(fn);
  }

  /**
   * Queue a request for the GM executor.
   * @param {Actor} actor
   * @param {'deposit'|'withdraw'|'placeOrder'|'cancelOrder'} type
   * @param {object} payload - the request fields (see engine/executor.js)
   * @returns {Promise<string|null>} the request key, or null if the outbox is full
   */
  async submit(actor, type, payload = {}) {
    if (PortfolioRepository.pending(actor).length >= OUTBOX_LIMIT) {
      ui.notifications.warn(game.i18n.localize('NCI.Errors.OutboxFull'));
      return null;
    }
    const key = foundry.utils.randomID(16);
    this.submitted.add(key);
    await this._write(async () => {
      const current = PortfolioRepository.outbox(actor);
      await actor.setFlag(MODULE_ID, FLAGS.OUTBOX, [...current, { key, type, ...payload, ts: Date.now() }]);
    });
    if (!game.users.activeGM) ui.notifications.info(game.i18n.localize('NCI.Notify.QueuedNoGM'));
    return key;
  }

  /**
   * Remove requests the executor has handled. Players prune their own outbox; a GM prunes only
   * actors that no player owns, so the two never write the same flag at once.
   */
  async prune(actor) {
    if (!actor.isOwner) return;
    if (game.user.isGM && actor.hasPlayerOwner) return;
    await this._write(async () => {
      const processed = new Set(PortfolioRepository.get(actor).processed);
      const current = PortfolioRepository.outbox(actor);
      const keep = current.filter((r) => !processed.has(r.key));
      if (keep.length !== current.length) await actor.setFlag(MODULE_ID, FLAGS.OUTBOX, keep);
    });
  }

  /** Add or remove a company from the actor's watchlist. */
  async toggleWatch(actor, assetId) {
    await this._write(async () => {
      const prefs = actor.getFlag(MODULE_ID, FLAGS.PREFS) ?? {};
      const list = new Set(prefs.watchlist ?? []);
      if (list.has(assetId)) list.delete(assetId);
      else list.add(assetId);
      await actor.setFlag(MODULE_ID, FLAGS.PREFS, { ...prefs, watchlist: [...list] });
    });
  }

  /** Choose a broker (or none). The GM checks the choice is a real, available broker. */
  setBroker(actor, brokerId) {
    return this.submit(actor, 'setBroker', { brokerId: brokerId || null });
  }

  /**
   * Ask to open a direct-trading session. The access claim and the Accounting roll are both made
   * here, on the player's own client (NCM keeps network state in browser memory, and the roll is
   * the player's to make); the GM's executor checks the roll card and decides.
   */
  async connectTerminal(actor) {
    const claim = TerminalAccess.claim();
    const rollId = await TerminalAccess.roll(actor, claim);
    return this.submit(actor, 'connectTerminal', { claim, ...(rollId ? { rollId } : {}) });
  }

  cancelWithdrawal(actor, withdrawalId) {
    return this.submit(actor, 'cancelWithdrawal', { withdrawalId });
  }

  /** Ask to be told when an asset passes a price (`above`/`below`, in eb) or moves by a percentage in a day (`move`). */
  setAlert(actor, { assetId, kind, value, once = true }) {
    return this.submit(actor, 'setAlert', { assetId, kind, value, once });
  }

  removeAlert(actor, alertId) {
    return this.submit(actor, 'removeAlert', { alertId });
  }

  /**
   * Try to cover your tracks. The player rolls the skill check here, on their own client, when they
   * press the button (it is skipped when the action could not go ahead anyway, and the GM explains
   * why). It costs eddies from the brokerage balance whether it works or not.
   * @param {'mask'|'books'|'front'|'bribe'} action
   */
  async heatAction(actor, action) {
    let rollId = null;
    const def = HEAT_ACTIONS[action];
    const enabled = game.settings.get(MODULE_ID, SETTINGS.HEAT_ENABLED) === true;
    if (def && canAttempt({ portfolio: PortfolioRepository.get(actor), actionId: action, tick: MarketStore.time(), enabled }).ok) {
      ({ messageId: rollId } = await SkillAdapter.check(actor, {
        dv: def.dv, skill: def.skill, stat: def.stat, title: game.i18n.format('NCI.Heat.Action.CheckTitle', { action: game.i18n.localize(`NCI.Heat.Action.${action}.Name`) }),
      }));
    }
    return this.submit(actor, 'heatAction', { action, ...(rollId ? { rollId } : {}) });
  }

  /** Ask for a brokerage statement by mail. */
  requestStatement(actor) {
    return this.submit(actor, 'requestStatement');
  }

  /** Choose how to hear about one category: 'mail', 'chat' or 'off'. */
  async setNotify(actor, category, channel) {
    await this._write(async () => {
      const prefs = actor.getFlag(MODULE_ID, FLAGS.PREFS) ?? {};
      await actor.setFlag(MODULE_ID, FLAGS.PREFS, { ...prefs, notify: { ...(prefs.notify ?? {}), [category]: channel } });
    });
  }

  /** How big a one-day move (percent) makes a holding a "mover" for the movers notice. */
  async setMoverPct(actor, pct) {
    await this._write(async () => {
      const prefs = actor.getFlag(MODULE_ID, FLAGS.PREFS) ?? {};
      await actor.setFlag(MODULE_ID, FLAGS.PREFS, { ...prefs, moverPct: moverThreshold(pct) });
    });
  }
}

export const PortfolioClient = new PortfolioClientImpl();
