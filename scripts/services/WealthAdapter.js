/**
 * Wealth adapter: the only place that touches Cyberpunk RED's `system.wealth`.
 * @file scripts/services/WealthAdapter.js
 * @description The CPR wealth object is { value, transactions: [[description, reason], ...] }.
 *              The transaction wording matches what Night City Messenger writes when eddies are claimed.
 */

export const WealthAdapter = {
  get(actor) {
    return Number(actor?.system?.wealth?.value ?? 0);
  },

  /** Set wealth to `newValue` and log the change in the actor's transaction list. */
  async set(actor, newValue, reason) {
    const wealth = foundry.utils.deepClone(actor.system.wealth);
    const diff = newValue - wealth.value;
    if (diff === 0) return;
    wealth.value = newValue;
    wealth.transactions ??= [];
    wealth.transactions.push([`${diff > 0 ? 'Increased' : 'Decreased'} by ${Math.abs(diff)} to ${newValue}`, reason]);
    await actor.update({ 'system.wealth': wealth });
  },
};
