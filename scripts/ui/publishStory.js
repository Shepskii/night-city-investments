/**
 * Publishing a story, and digging for rumours (F1c)
 * @file scripts/ui/publishStory.js
 * @description A Media chooses an exposé or a puff piece, a headline and any evidence, and sends it to the
 *              GM's service, which rolls: Luck cannot be spent on whether the public believes it. Digging
 *              for rumours is a skill roll, with Luck, against a total the Media cannot see.
 */

import { MAX_LUCK_PER_ROLL, STORY_ANGLES, STORY_RULES, believability } from '../engine/index.js';
import { BusinessClient } from '../services/BusinessClient.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { RUMOUR_USES, StoryService } from '../services/StoryService.js';
import { escapeHtml } from '../utils/text.js';
import { L } from './format.js';

/**
 * @param {Actor} actor - the Media
 * @param {{ticker: string, name: string}} company
 */
export async function publishStory(actor, { ticker, name }) {
  const rank = StoryService.rankOf(actor);
  if (!rank) return ui.notifications.warn(L('NCI.Business.Reason.not-media'));
  const evidence = StoryService.evidenceOf(actor, ticker);
  const list = evidence.length
    ? evidence.map((item) => `<label class="checkbox"><input type="checkbox" name="evidence" value="${escapeHtml(item.id)}"> ${escapeHtml(item.name)}</label>`).join('')
    : `<p class="nci-muted">${L('NCI.Story.NoEvidence')}</p>`;
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: L('NCI.Story.Title', { name }) },
    position: { width: 460 },
    content: `<p>${L('NCI.Story.Hint', { base: believability(rank), bonus: STORY_RULES.bonus, many: STORY_RULES.many, manyBonus: STORY_RULES.manyBonus, cap: STORY_RULES.cap[Math.min(10, rank)] })}</p>`
      + `<label>${L('NCI.Story.Angle')} <select name="angle">${STORY_ANGLES.map((a) => `<option value="${a}">${L(`NCI.Story.AngleName.${a}`)}</option>`).join('')}</select></label>`
      + `<label>${L('NCI.Story.Headline')} <input type="text" name="headline" maxlength="${STORY_RULES.headlineMax}"></label>`
      + `<fieldset><legend>${L('NCI.Story.Evidence')}</legend>${list}</fieldset>`,
    ok: {
      label: L('NCI.Story.Publish'),
      callback: (e, button) => ({
        angle: button.form.elements.angle.value,
        headline: button.form.elements.headline.value,
        evidence: [...button.form.querySelectorAll('[name="evidence"]:checked')].map((box) => box.value),
      }),
    },
    rejectClose: false,
  });
  if (!picked?.angle) return null;
  return BusinessClient.submit(actor, 'publishStory', { ticker, ...picked });
}

/**
 * @param {Actor} actor - the Media
 * @param {{ticker: string, name: string}} company
 */
export async function digRumours(actor, { ticker, name }) {
  if (!StoryService.rankOf(actor)) return ui.notifications.warn(L('NCI.Business.Reason.not-media'));
  const luckMax = Math.min(MAX_LUCK_PER_ROLL, SkillAdapter.luck(actor));
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: L('NCI.Rumour.Title', { name }) },
    position: { width: 420 },
    content: `<p>${L('NCI.Rumour.Hint')}</p>`
      + `<label>${L('NCI.Ownership.Skill')} <select name="use">${RUMOUR_USES.map((u, i) => `<option value="${i}">${u.skill}</option>`).join('')}</select></label>`
      + `<label>${L('NCI.Ownership.LuckLeft', { n: SkillAdapter.luck(actor) })} <input type="number" name="luck" min="0" max="${luckMax}" step="1" value="0" ${luckMax ? '' : 'disabled'}></label>`,
    ok: {
      label: L('NCI.Rumour.Dig'),
      callback: (e, button) => ({ use: RUMOUR_USES[Number(button.form.elements.use.value)], luck: Math.min(luckMax, Math.max(0, Math.floor(Number(button.form.elements.luck.value) || 0))) }),
    },
    rejectClose: false,
  });
  if (!picked?.use) return null;
  const { messageId } = await SkillAdapter.leverCheck(actor, { dv: null, title: L('NCI.Rumour.Title', { name }), use: picked.use, levers: { luck: picked.luck } });
  if (!messageId) return null;
  return BusinessClient.submit(actor, 'rumourRoll', { ticker, use: picked.use, rollId: messageId });
}
