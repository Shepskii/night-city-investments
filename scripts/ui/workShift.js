/**
 * The week's shift at an NPC's company (N3)
 * @file scripts/ui/workShift.js
 * @description One roll, with Luck if they want, from Your jobs. Refused here, before any dice or Luck, if a shift has
 *              been worked this week at any of their jobs.
 */

import { MAX_LUCK_PER_ROLL } from '../engine/index.js';
import { BusinessClient, jobsOf } from '../services/BusinessClient.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { L } from './format.js';

export async function workShift(actor, businessId) {
  const jobs = jobsOf(actor);
  const job = jobs.find((j) => j.businessId === businessId);
  if (!job?.boss) return ui.notifications.warn(L('NCI.Business.Reason.job-closed'));
  if (jobs.some((j) => j.boss?.done)) return ui.notifications.warn(L('NCI.Business.Reason.shift-done'));
  const { uses, dv } = job.boss;
  const luckMax = Math.min(MAX_LUCK_PER_ROLL, SkillAdapter.luck(actor));
  const title = L('NCI.Jobs.ShiftTitle', { name: job.businessName });
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    position: { width: 420 },
    content: `<p>${L('NCI.Jobs.ShiftHint', { dv })}</p>`
      + `<label>${L('NCI.Ownership.Skill')} <select name="use">${uses.map((u, i) => `<option value="${i}">${u.skill ?? u.ability}</option>`).join('')}</select></label>`
      + `<label>${L('NCI.Ownership.LuckLeft', { n: SkillAdapter.luck(actor) })} <input type="number" name="luck" min="0" max="${luckMax}" step="1" value="0" ${luckMax ? '' : 'disabled'}></label>`,
    ok: {
      label: L('NCI.Jobs.Work'),
      callback: (e, button) => ({ use: uses[Number(button.form.elements.use.value)], luck: Math.min(luckMax, Math.max(0, Math.floor(Number(button.form.elements.luck.value) || 0))) }),
    },
    rejectClose: false,
  });
  if (!picked?.use) return null;
  const { messageId } = await SkillAdapter.leverCheck(actor, { dv, title, use: picked.use, levers: { luck: picked.luck } });
  if (!messageId) return null;
  return BusinessClient.submit(actor, 'shiftRoll', { companyId: businessId, use: picked.use, rollId: messageId });
}
