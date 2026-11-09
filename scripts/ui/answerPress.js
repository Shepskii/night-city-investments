/**
 * Answering a story in the press about your character (S1b)
 * @file scripts/ui/answerPress.js
 * @description One roll, with Luck if they want, from the Pending tab. Refused here, before any dice or Luck, if
 *              there is nothing to answer or it has been answered already.
 */

import { BUSINESS_DEFAULTS, MAX_LUCK_PER_ROLL } from '../engine/index.js';
import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { BusinessClient } from '../services/BusinessClient.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { L } from './format.js';

export async function answerPress(actor) {
  const notice = actor?.getFlag?.(MODULE_ID, FLAGS.PRESS_NOTICE);
  if (!notice) return ui.notifications.warn(L('NCI.Business.Reason.no-press'));
  if (notice.answered) return ui.notifications.warn(L('NCI.Business.Reason.press-answered'));
  const { uses, answerDv } = BUSINESS_DEFAULTS.press.character;
  const luckMax = Math.min(MAX_LUCK_PER_ROLL, SkillAdapter.luck(actor));
  const title = L('NCI.Press.Char.Title', { outlet: notice.outlet });
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    position: { width: 420 },
    content: `<p>${L('NCI.Press.Char.Hint', { dv: answerDv })}</p>`
      + `<label>${L('NCI.Ownership.Skill')} <select name="use">${uses.map((u, i) => `<option value="${i}">${u.skill ?? u.ability}</option>`).join('')}</select></label>`
      + `<label>${L('NCI.Ownership.LuckLeft', { n: SkillAdapter.luck(actor) })} <input type="number" name="luck" min="0" max="${luckMax}" step="1" value="0" ${luckMax ? '' : 'disabled'}></label>`,
    ok: {
      label: L('NCI.Press.Char.Answer'),
      callback: (e, button) => ({ use: uses[Number(button.form.elements.use.value)], luck: Math.min(luckMax, Math.max(0, Math.floor(Number(button.form.elements.luck.value) || 0))) }),
    },
    rejectClose: false,
  });
  if (!picked?.use) return null;
  const { messageId } = await SkillAdapter.leverCheck(actor, { dv: answerDv, title, use: picked.use, levers: { luck: picked.luck } });
  if (!messageId) return null;
  return BusinessClient.submit(actor, 'pressAnswer', { storyId: notice.id, use: picked.use, rollId: messageId });
}
