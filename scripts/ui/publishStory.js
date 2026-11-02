/**
 * Publishing a story (F1c)
 * @file scripts/ui/publishStory.js
 * @description A Media chooses an exposé or a puff piece, a headline and any evidence, and sends it to the
 *              GM's service, which rolls: Luck cannot be spent on whether the public believes it.
 */

import { STORY_ANGLES, STORY_RULES, believability } from '../engine/index.js';
import { BusinessClient } from '../services/BusinessClient.js';
import { StoryService } from '../services/StoryService.js';
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
