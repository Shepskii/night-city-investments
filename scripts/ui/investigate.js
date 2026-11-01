/**
 * Investigating a hidden holding (B6d)
 * @file scripts/ui/investigate.js
 * @description Ask which skill to use and how much Luck, roll against a total the roller cannot see,
 *              and send the investigation to the GM's service, which reads the roll back.
 */

import { BUSINESS_DEFAULTS } from '../engine/index.js';
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

/**
 * @param {Actor} actor - the investigating character
 * @param {{ticker?: string, businessId?: string, ref: string, label: string}} target - a register row
 */
export async function investigate(actor, { ticker = null, businessId = null, ref, label }) {
  if (!actor) return ui.notifications.warn(L('NCI.Errors.NoActor'));
  const { uses, days } = BUSINESS_DEFAULTS.ownership.investigate;
  // Once a week for each holding: refused here, before any dice or Luck are spent.
  const today = BusinessClient.day();
  if (receiptsOf(actor).results.some((r) => r.type === 'investigate' && r.ok && r.investigation?.ref === ref && today - r.day < days)) {
    return ui.notifications.warn(L('NCI.Business.Reason.investigate-wait'));
  }
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: L('NCI.Ownership.InvestigateTitle', { label }) },
    position: { width: 420 },
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
