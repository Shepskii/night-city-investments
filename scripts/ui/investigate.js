/**
 * Investigating a hidden holding (B6d)
 * @file scripts/ui/investigate.js
 * @description Ask which skill to use and how much Luck, roll against a total the roller cannot see,
 *              and send the investigation to the GM's service, which reads the roll back.
 */

import { BUSINESS_DEFAULTS } from '../engine/index.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { BusinessClient } from '../services/BusinessClient.js';
import { L } from './format.js';

const useLabel = (u) => (u.kind === 'ability' ? u.ability : u.skill);

/**
 * @param {Actor} actor - the investigating character
 * @param {{ticker?: string, businessId?: string, ref: string, label: string}} target - a register row
 */
export async function investigate(actor, { ticker = null, businessId = null, ref, label }) {
  if (!actor) return ui.notifications.warn(L('NCI.Errors.NoActor'));
  const uses = BUSINESS_DEFAULTS.ownership.investigate.uses;
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: L('NCI.Ownership.InvestigateTitle', { label }) },
    content: `<p>${L('NCI.Ownership.InvestigateHint')}</p>`
      + `<label>${L('NCI.Ownership.Skill')} <select name="use">${uses.map((u, i) => `<option value="${i}">${useLabel(u)}</option>`).join('')}</select></label>`
      + `<label>${L('NCI.Roll.Luck')} <input type="number" name="luck" min="0" step="1" value="0"></label>`,
    ok: { label: L('NCI.Ownership.Investigate'), callback: (e, button) => ({ use: uses[Number(button.form.elements.use.value)], luck: Math.max(0, Math.floor(Number(button.form.elements.luck.value) || 0)) }) },
    rejectClose: false,
  });
  if (!picked?.use) return null;
  const { messageId } = await SkillAdapter.leverCheck(actor, { dv: null, title: L('NCI.Ownership.InvestigateTitle', { label }), use: picked.use, levers: { luck: picked.luck } });
  if (!messageId) return null;
  return BusinessClient.submit(actor, 'investigate', { ...(ticker ? { ticker } : {}), ...(businessId ? { businessId } : {}), ref, use: picked.use, rollId: messageId });
}
