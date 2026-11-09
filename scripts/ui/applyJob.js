/**
 * The job board in the Business window (N2)
 * @file scripts/ui/applyJob.js
 * @description What a character can apply for, read from what the GM published, and the application itself: one roll,
 *              with Luck if they want. Refused here, before any dice or Luck, if the role has gone or they must wait.
 */

import { BUSINESS_DEFAULTS, MAX_LUCK_PER_ROLL } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';
import { BusinessClient, jobsOf } from '../services/BusinessClient.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { L, whole } from './format.js';

const board = () => game.settings.get(MODULE_ID, SETTINGS.JOB_BOARD) ?? { companies: [], tried: {}, waiting: {} };

/** Why this character can't apply to this company now, or null. */
function blocked(data, businessId, actorId) {
  const key = `${businessId}:${actorId}`;
  if (data.waiting?.[key]) return 'job-waiting';
  const tried = data.tried?.[key];
  return tried != null && BusinessClient.day() - tried < BUSINESS_DEFAULTS.npc.jobs.waitDays ? 'job-wait' : null;
}

/** The rows of the board for a character. A syndicate, or an NPC owner the GM is acting as, sees none. */
export function jobBoardRows(actor) {
  if (!actor || actor.isSyndicate || !actor.hasPlayerOwner) return [];
  const data = board();
  const mine = new Set(jobsOf(actor).map((j) => j.businessId));
  return data.companies.filter((c) => !mine.has(c.businessId)).flatMap((c) => c.roles.map((r) => {
    const reason = blocked(data, c.businessId, actor.id);
    return {
      businessId: c.businessId,
      name: c.name,
      archetype: L(`NCI.Business.Archetype.${c.archetype}.Name`),
      location: c.location,
      owner: c.owner,
      post: r.post,
      postName: L(`NCI.Staff.Post.${r.post}`),
      wage: whole(r.wage),
      blocked: reason ? L(`NCI.Business.Reason.${reason}`) : '',
    };
  }));
}

export async function applyJob(actor, businessId, post) {
  const data = board();
  const company = data.companies.find((c) => c.businessId === businessId);
  const role = company?.roles.find((r) => r.post === post);
  if (!role) return ui.notifications.warn(L('NCI.Business.Reason.job-closed'));
  const reason = blocked(data, businessId, actor.id);
  if (reason) return ui.notifications.warn(L(`NCI.Business.Reason.${reason}`));
  const luckMax = Math.min(MAX_LUCK_PER_ROLL, SkillAdapter.luck(actor));
  const title = L('NCI.Jobs.Title', { post: L(`NCI.Staff.Post.${post}`), name: company.name });
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    position: { width: 420 },
    content: `<p>${L('NCI.Jobs.Hint', { dv: company.dv })}</p>`
      + `<label>${L('NCI.Ownership.Skill')} <select name="use">${role.uses.map((u, i) => `<option value="${i}">${u.skill ?? u.ability}</option>`).join('')}</select></label>`
      + `<label>${L('NCI.Ownership.LuckLeft', { n: SkillAdapter.luck(actor) })} <input type="number" name="luck" min="0" max="${luckMax}" step="1" value="0" ${luckMax ? '' : 'disabled'}></label>`,
    ok: {
      label: L('NCI.Jobs.Apply'),
      callback: (e, button) => ({ use: role.uses[Number(button.form.elements.use.value)], luck: Math.min(luckMax, Math.max(0, Math.floor(Number(button.form.elements.luck.value) || 0))) }),
    },
    rejectClose: false,
  });
  if (!picked?.use) return null;
  const { messageId } = await SkillAdapter.leverCheck(actor, { dv: company.dv, title, use: picked.use, levers: { luck: picked.luck } });
  if (!messageId) return null;
  return BusinessClient.submit(actor, 'jobApply', { companyId: businessId, post, use: picked.use, rollId: messageId });
}
