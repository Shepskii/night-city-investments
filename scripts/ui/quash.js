/**
 * A Lawman quashing an investigation (X1)
 * @file scripts/ui/quash.js
 * @description Calling in a favour with Backup, from the market window's heat panel. Refused here if it cannot
 *              go ahead, before any dice or Luck are spent; the GM's service reads the roll back.
 */

import { ABILITIES, BUSINESS_DEFAULTS, MAX_LUCK_PER_ROLL } from '../engine/index.js';
import { BusinessClient, receiptsOf } from '../services/BusinessClient.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { WealthAdapter } from '../services/WealthAdapter.js';
import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { L } from './format.js';

/** Days until this character can call in another favour; 0 when they can now. */
export function quashWait(actor) {
  const { days } = BUSINESS_DEFAULTS.roles.quash;
  const today = BusinessClient.day();
  const flagged = actor?.getFlag?.(MODULE_ID, FLAGS.QUASHED);
  const receipt = receiptsOf(actor).results.filter((r) => r.type === 'quashRoll' && r.ok).at(-1)?.day;
  const last = Math.max(Number.isFinite(flagged) ? flagged : -Infinity, Number.isFinite(receipt) ? receipt : -Infinity);
  return Number.isFinite(last) ? Math.max(0, last + days - today) : 0;
}

/** @param {Actor} actor - the Lawman */
export async function quashRoll(actor) {
  const { cost } = BUSINESS_DEFAULTS.roles.quash;
  if (!(SkillAdapter.baseFor(actor, ABILITIES.backup).base > 0)) return ui.notifications.warn(L('NCI.Business.Reason.not-lawman'));
  if (quashWait(actor) > 0) return ui.notifications.warn(L('NCI.Business.Reason.quash-wait'));
  if (WealthAdapter.get(actor) < cost) return ui.notifications.warn(L('NCI.Business.Reason.insufficient-funds'));
  const title = L('NCI.Heat.Action.quash.Name');
  const luckLeft = SkillAdapter.luck(actor);
  const luckMax = Math.min(MAX_LUCK_PER_ROLL, luckLeft);
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    position: { width: 420 },
    content: `<p>${L('NCI.Heat.Action.quash.Desc')}</p>`
      + `<label>${L('NCI.Ownership.LuckLeft', { n: luckLeft })} <input type="number" name="luck" min="0" max="${luckMax}" step="1" value="0" ${luckMax ? '' : 'disabled'}></label>`,
    ok: { label: title, callback: (e, button) => ({ luck: Math.min(luckMax, Math.max(0, Math.floor(Number(button.form.elements.luck.value) || 0))) }) },
    rejectClose: false,
  });
  if (!picked) return null;
  const { messageId } = await SkillAdapter.leverCheck(actor, { dv: BUSINESS_DEFAULTS.roles.quash.dv, title, use: ABILITIES.backup, levers: { luck: picked.luck } });
  if (!messageId) return null;
  return BusinessClient.submit(actor, 'quashRoll', { use: ABILITIES.backup, rollId: messageId });
}
