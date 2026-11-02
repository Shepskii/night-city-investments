/**
 * Answering a regulator's case (R1)
 * @file scripts/ui/answerCase.js
 * @description Ask which skill and how much Luck, roll against a total the officer cannot see, and send
 *              the answer to the GM's service, which reads the roll back.
 */

import { BUSINESS_DEFAULTS, MAX_LUCK_PER_ROLL, backupWait } from '../engine/index.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { BusinessClient } from '../services/BusinessClient.js';
import { L } from './format.js';

/**
 * @param {Actor} account - the picked account: a character, or a syndicate as one of its officers
 * @param {object} business
 */
export async function answerCase(account, business) {
  const roller = account?.isSyndicate ? account.as : account;
  if (!roller) return ui.notifications.warn(L('NCI.Errors.NoActor'));
  const { bribe } = BUSINESS_DEFAULTS.regulator;
  // Backup only for a Lawman, and once a month (X1).
  const uses = BUSINESS_DEFAULTS.regulator.uses.filter((u) => u.kind !== 'ability' || (SkillAdapter.baseFor(roller, u).base > 0 && backupWait(business, BusinessClient.day()) === 0));
  const luckLeft = SkillAdapter.luck(roller);
  const luckMax = Math.min(MAX_LUCK_PER_ROLL, luckLeft);
  const title = L('NCI.Regulator.RollTitle', { name: business.name });
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    position: { width: 420 },
    content: `<p>${L('NCI.Regulator.RollHint', { bribe })}</p>`
      + `<label>${L('NCI.Ownership.Skill')} <select name="use">${uses.map((u, i) => `<option value="${i}">${u.skill ?? u.ability}</option>`).join('')}</select></label>`
      + `<label>${L('NCI.Ownership.LuckLeft', { n: luckLeft })} <input type="number" name="luck" min="0" max="${luckMax}" step="1" value="0" ${luckMax ? '' : 'disabled'}></label>`,
    ok: { label: L('NCI.Regulator.Answer'), callback: (e, button) => ({ use: uses[Number(button.form.elements.use.value)], luck: Math.min(luckMax, Math.max(0, Math.floor(Number(button.form.elements.luck.value) || 0))) }) },
    rejectClose: false,
  });
  if (!picked?.use) return null;
  // The company must be able to pay the bribe: refused here, before any dice or Luck are spent.
  if (picked.use.skill === 'Bribery' && business.till < bribe) return ui.notifications.warn(L('NCI.Business.Reason.no-funds'));
  const { messageId } = await SkillAdapter.leverCheck(roller, { dv: null, title, use: picked.use, levers: { luck: picked.luck } });
  if (!messageId) return null;
  return BusinessClient.submit(account, 'caseRoll', { businessId: business.id, use: picked.use, rollId: messageId });
}
