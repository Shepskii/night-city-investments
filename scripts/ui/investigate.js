/**
 * Investigating a hidden holding (B6d)
 * @file scripts/ui/investigate.js
 * @description Ask which skill to use and how much Luck, roll against a total the roller cannot see,
 *              and send the investigation to the GM's service, which reads the roll back.
 */

import { BUSINESS_DEFAULTS, MAX_LUCK_PER_ROLL, investigationCost } from '../engine/index.js';
import { CrewToolsAdapter } from '../integrations/CrewToolsAdapter.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { WealthAdapter } from '../services/WealthAdapter.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { BusinessClient, receiptsOf } from '../services/BusinessClient.js';
import { L } from './format.js';
import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { unwrap } from '../utils/helpers.js';

/** What this character has found behind a register row's layer (by its ref): the names, outside in. */
export function discoveredBehind(actor, ref) {
  if (!actor || !ref) return [];
  return (unwrap(actor.getFlag?.(MODULE_ID, FLAGS.DISCOVERIES)) ?? {})[ref] ?? [];
}

/** A register row's name with what the viewer has found behind it: "Kestrel Holdings → Alvarez Financial (nominee) → Splice". */
export function withDiscoveries(label, actor, ref) {
  const found = discoveredBehind(actor, ref);
  return found.length ? [label, ...found].join(' → ') : label;
}

const useLabel = (u) => (u.kind === 'ability' ? u.ability : u.skill);

/** What an investigation takes from this character, before any bribe. */
function costText(actor) {
  const cost = investigationCost(BusinessRepository.forActor(actor.id), actor.id, null, CrewToolsAdapter.gmParams());
  return cost.businessId ? L('NCI.Ownership.CostDay', { name: cost.businessName }) : L('NCI.Ownership.CostFee', { fee: cost.fee });
}

/**
 * @param {Actor} actor - the investigating character
 * @param {{ticker?: string, businessId?: string, ref: string, label: string}} target - a register row
 */
export async function investigate(actor, { ticker = null, businessId = null, ref, label }) {
  if (!actor) return ui.notifications.warn(L('NCI.Errors.NoActor'));
  const { uses, days, bribe } = BUSINESS_DEFAULTS.ownership.investigate;
  // Once a week for each holding: refused here, before any dice or Luck are spent. The GM's service
  // notes each try on the character; a receipt covers a try made before it did.
  const today = BusinessClient.day();
  const tried = (unwrap(actor.getFlag?.(MODULE_ID, FLAGS.INVESTIGATED)) ?? {})[ref];
  const recent = receiptsOf(actor).results.some((r) => r.type === 'investigate' && r.ok && r.investigation?.ref === ref && today - r.day < days);
  if ((Number.isFinite(tried) && today - tried < days) || recent) return ui.notifications.warn(L('NCI.Business.Reason.investigate-wait'));
  // Luck from the sheet's pool, at most what a roll allows.
  const luckMax = Math.min(MAX_LUCK_PER_ROLL, SkillAdapter.luck(actor));
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: L('NCI.Ownership.InvestigateTitle', { label }) },
    position: { width: 420 },
    content: `<p>${L('NCI.Ownership.InvestigateHint')}</p>`
      + `<p>${costText(actor)} ${L('NCI.Ownership.CostBribe', { bribe })}</p>`
      + `<label>${L('NCI.Ownership.Skill')} <select name="use">${uses.map((u, i) => `<option value="${i}">${useLabel(u)}</option>`).join('')}</select></label>`
      + `<label>${L('NCI.Ownership.LuckLeft', { n: SkillAdapter.luck(actor) })} <input type="number" name="luck" min="0" max="${luckMax}" step="1" value="0" ${luckMax ? '' : 'disabled'}></label>`,
    ok: { label: L('NCI.Ownership.Investigate'), callback: (e, button) => ({ use: uses[Number(button.form.elements.use.value)], luck: Math.min(luckMax, Math.max(0, Math.floor(Number(button.form.elements.luck.value) || 0))) }) },
    rejectClose: false,
  });
  if (!picked?.use) return null;
  // Refused here if it cannot be paid for, before any dice or Luck are spent.
  if (investigationCost(BusinessRepository.forActor(actor.id), actor.id, picked.use, CrewToolsAdapter.gmParams()).fee > WealthAdapter.get(actor)) {
    return ui.notifications.warn(L('NCI.Business.Reason.insufficient-funds'));
  }
  const { messageId } = await SkillAdapter.leverCheck(actor, { dv: null, title: L('NCI.Ownership.InvestigateTitle', { label }), use: picked.use, levers: { luck: picked.luck } });
  if (!messageId) return null;
  return BusinessClient.submit(actor, 'investigate', { ...(ticker ? { ticker } : {}), ...(businessId ? { businessId } : {}), ref, use: picked.use, rollId: messageId });
}
