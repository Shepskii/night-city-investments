/**
 * A Lawman opening an investigation (X2d)
 * @file scripts/ui/inquiry.js
 * @description From the market window's heat panel: pick an NPC's business or a market corporation, then roll
 *              Backup. Refused here if it cannot go ahead, before any dice or Luck are spent; the GM's service reads
 *              the roll back, counts any evidence, and does the rest.
 */

import { ABILITIES, BUSINESS_DEFAULTS, MAX_LUCK_PER_ROLL, inquiryWait as waitFrom } from '../engine/index.js';
import { BusinessClient, receiptsOf } from '../services/BusinessClient.js';
import { SkillAdapter } from '../services/SkillAdapter.js';
import { WealthAdapter } from '../services/WealthAdapter.js';
import { MODULE_ID, FLAGS, SETTINGS } from '../utils/constants.js';
import { escapeHtml } from '../utils/text.js';
import { L } from './format.js';

/** Who may be investigated, as the GM's client publishes it. */
export function inquiryTargets() {
  const board = game.settings.get(MODULE_ID, SETTINGS.JOB_BOARD) ?? {};
  return { npc: board.inquiry?.npc ?? [], corps: board.inquiry?.corps ?? [] };
}

/** Days until this character can open another investigation; 0 when they can now. */
export function inquiryWait(actor) {
  const flagged = actor?.getFlag?.(MODULE_ID, FLAGS.INQUIRED);
  const receipt = receiptsOf(actor).results.filter((r) => r.type === 'inquiryRoll' && r.ok).at(-1)?.day;
  const last = Math.max(Number.isFinite(flagged) ? flagged : -Infinity, Number.isFinite(receipt) ? receipt : -Infinity);
  return waitFrom(Number.isFinite(last) ? last : null, BusinessClient.day());
}

/** The target picker's options, grouped, each with its DV. */
function targetOptions({ npc, corps }) {
  const option = (value, name, dv) => `<option value="${escapeHtml(value)}">${escapeHtml(name)} (${escapeHtml(L('NCI.Heat.Action.inquiry.Dv', { dv }))})</option>`;
  const group = (label, rows) => (rows.length ? `<optgroup label="${escapeHtml(label)}">${rows.join('')}</optgroup>` : '');
  return group(L('NCI.Heat.Action.inquiry.Npc'), npc.map((t) => option(`b:${t.id}`, t.name, t.dv)))
    + group(L('NCI.Heat.Action.inquiry.Corps'), corps.map((t) => option(`c:${t.ticker}`, `${t.name} (${t.ticker})`, t.dv)));
}

/** @param {Actor} actor - the Lawman */
export async function inquiryRoll(actor) {
  const { cost } = BUSINESS_DEFAULTS.roles.inquiry;
  if (!(SkillAdapter.baseFor(actor, ABILITIES.backup).base > 0)) return ui.notifications.warn(L('NCI.Business.Reason.not-lawman'));
  if (inquiryWait(actor) > 0) return ui.notifications.warn(L('NCI.Business.Reason.inquiry-wait'));
  if (WealthAdapter.get(actor) < cost) return ui.notifications.warn(L('NCI.Business.Reason.insufficient-funds'));
  const targets = inquiryTargets();
  if (!targets.npc.length && !targets.corps.length) return ui.notifications.warn(L('NCI.Heat.Action.inquiry.None'));
  const title = L('NCI.Heat.Action.inquiry.Name');
  const luckLeft = SkillAdapter.luck(actor);
  const luckMax = Math.min(MAX_LUCK_PER_ROLL, luckLeft);
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    position: { width: 460 },
    content: `<p>${L('NCI.Heat.Action.inquiry.Desc')}</p>`
      + `<label>${L('NCI.Heat.Action.inquiry.Target')} <select name="target"><option value="">${L('NCI.Heat.Action.inquiry.Pick')}</option>${targetOptions(targets)}</select></label>`
      + `<label>${L('NCI.Ownership.LuckLeft', { n: luckLeft })} <input type="number" name="luck" min="0" max="${luckMax}" step="1" value="0" ${luckMax ? '' : 'disabled'}></label>`,
    ok: {
      label: title,
      callback: (e, button) => ({
        target: button.form.elements.target.value,
        luck: Math.min(luckMax, Math.max(0, Math.floor(Number(button.form.elements.luck.value) || 0))),
      }),
    },
    rejectClose: false,
  });
  if (!picked?.target) return null;
  const [kind, id] = picked.target.split(':');
  const chosen = kind === 'b' ? targets.npc.find((t) => t.id === id) : targets.corps.find((t) => t.ticker === id);
  if (!chosen) return null;
  // The card shows the target's own DV; evidence the GM's side finds comes off it there.
  const { messageId } = await SkillAdapter.leverCheck(actor, { dv: chosen.dv, title: `${title}: ${chosen.name}`, use: ABILITIES.backup, levers: { luck: picked.luck } });
  if (!messageId) return null;
  return BusinessClient.submit(actor, 'inquiryRoll', { use: ABILITIES.backup, rollId: messageId, target: picked.target });
}
