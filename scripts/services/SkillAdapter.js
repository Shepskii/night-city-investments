/**
 * Skill adapter: reads a character's Accounting skill and rolls checks.
 * @file scripts/services/SkillAdapter.js
 * @description Cyberpunk RED skills are Items of type 'skill' (system.level, system.stat); the
 *              governing stat is at actor.system.stats.<stat>.value. This reads the sheet the same
 *              way Night City Messenger does, without depending on its internals. Rolls use Foundry's
 *              dice, so Dice So Nice shows them, and a chat card records the check.
 */

import { cprD10, evaluateCheck } from '../engine/index.js';
import { MODULE_ID } from '../utils/constants.js';
import { escapeHtml } from '../utils/text.js';
import { L } from '../utils/helpers.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** A roll is made when the player presses the button, so a request carrying one is acted on soon after. */
const ROLL_MAX_AGE_MS = 10 * 60 * 1000;
const ROLL_SKEW_MS = 60 * 1000;
const CHECK_FLAG = 'check';

export const SKILL_NAME = 'Accounting';
export const SKILL_STAT = 'int';

export const SkillAdapter = {
  /**
   * Read a skill from a character sheet.
   * @returns {{found: boolean, level: number, stat: number, statName: string, total: number}}
   */
  read(actor, skill = SKILL_NAME, defaultStat = SKILL_STAT) {
    const item = actor?.items?.find?.((i) => i.type === 'skill' && norm(i.name) === norm(skill));
    const level = Number(item?.system?.level ?? item?.system?.value ?? 0) || 0;
    const statName = String(item?.system?.stat ?? defaultStat).toLowerCase();
    const raw = actor?.system?.stats?.[statName];
    const stat = Number(raw?.value ?? raw ?? 0) || 0;
    return { found: !!item, level, stat, statName, total: stat + level };
  },

  /** Roll one d10 with Foundry's dice. Overridden in tests. */
  async rollOne() {
    const roll = new Roll('1d10');
    await roll.evaluate();
    return { value: roll.total, roll };
  },

  /**
   * Roll a CPR skill check for a character and post it to chat. Accounting by default (the
   * terminal check); other skills name themselves and the stat to fall back on. This runs on the
   * client of the player who pressed the button; the chat card it posts is what the GM's executor
   * later checks (`verify`), so `messageId` is what a request carries.
   * @returns {{check: object, roll: {total: number, rolls: number[], crit: string|null}, skill: object, messageId: string|null}}
   */
  async check(actor, { dv, title = L('NCI.Check.Title'), skill: skillName = SKILL_NAME, stat = SKILL_STAT }) {
    const skill = this.read(actor, skillName, stat);
    const first = await this.rollOne();
    const dice = [first];
    if (first.value === 10 || first.value === 1) dice.push(await this.rollOne());

    const queue = dice.map((d) => d.value);
    const roll = cprD10(() => queue.shift());
    const check = evaluateCheck({ stat: skill.stat, level: skill.level, roll, dv });

    const messageId = await this._post(actor, {
      skill, skillName, roll, check, title, dice: dice.map((d) => d.roll).filter(Boolean), values: dice.map((d) => d.value),
    });
    return { check, roll, skill, messageId };
  },

  /**
   * GM side: turn a player's roll card back into a check, without trusting anything the request
   * says about the result. The card must exist, be for this actor and skill, come from someone who
   * owns the actor, be recent and unused. The dice are read from the card and the stat, skill level
   * and DV are the GM's own, so a card cannot choose its own total. A card is marked as used by the
   * request, so a retry of the same request is fine and a second request is not.
   * @param {Actor} actor
   * @param {{rollId?: string, key: string, ts?: number}} request
   * @param {{dv: number, skill?: string, stat?: string}} spec
   * @returns {Promise<{ok: true, stat: number, level: number, dv: number, roll: object} | {ok: false, reason: string}>}
   */
  async verify(actor, request, { dv, skill: skillName = SKILL_NAME, stat = SKILL_STAT }) {
    const fail = (reason) => ({ ok: false, reason });
    if (!request.rollId) return fail('no-roll');

    const message = game.messages?.get?.(request.rollId);
    const flag = message?.getFlag?.(MODULE_ID, CHECK_FLAG);
    if (!message || !flag) return fail('roll-missing');
    if (flag.actorId !== actor.id || norm(flag.skill) !== norm(skillName)) return fail('roll-mismatch');

    const author = message.author && typeof message.author === 'object' ? message.author : game.users?.get?.(message.author ?? message.user);
    if (!author || !actor.testUserPermission?.(author, 'OWNER')) return fail('roll-mismatch');

    if (Number.isFinite(message.timestamp) && Number.isFinite(request.ts)) {
      const age = request.ts - message.timestamp;
      if (age < -ROLL_SKEW_MS || age > ROLL_MAX_AGE_MS) return fail('roll-stale');
    }
    if (flag.used && flag.used !== request.key) return fail('roll-used');

    const rolled = Array.isArray(message.rolls) && message.rolls.length ? message.rolls.map((r) => r.total) : flag.dice;
    const values = Array.isArray(rolled) ? rolled.map(Number) : [];
    const crit = values[0] === 1 || values[0] === 10;
    if (!values.length || values.length !== (crit ? 2 : 1) || values.some((v) => !Number.isInteger(v) || v < 1 || v > 10)) return fail('roll-invalid');

    if (flag.used !== request.key) {
      try {
        await message.setFlag(MODULE_ID, CHECK_FLAG, { ...flag, used: request.key });
      } catch (error) {
        console.warn('NCI | could not mark a roll as used', error);
        return fail('roll-unverified');
      }
    }

    const skill = this.read(actor, skillName, stat);
    const queue = [...values];
    return { ok: true, stat: skill.stat, level: skill.level, dv, roll: cprD10(() => queue.shift()) };
  },

  async _post(actor, { skill, skillName = SKILL_NAME, roll, check, title, dice, values = [] }) {
    // Foundry's classes are plain globals, not properties of globalThis, so test with typeof.
    if (typeof ChatMessage === 'undefined') return null;
    const outcome = L(check.success ? 'NCI.Check.Success' : 'NCI.Check.Failure');
    const crit = roll.crit ? ` (${L(`NCI.Check.Crit.${roll.crit}`)})` : '';
    const content = `<div class="nci-chat"><strong>${escapeHtml(title)}</strong><br>`
      + `${escapeHtml(skill.statName.toUpperCase())} ${skill.stat} + ${escapeHtml(skillName)} ${skill.level} + d10 [${roll.rolls.join(', ')}]${crit} = <strong>${check.total}</strong>`
      + ` ${L('NCI.Check.Versus')} DV ${check.dv}<br><strong>${escapeHtml(outcome)}</strong></div>`;
    try {
      const message = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker?.({ actor }),
        content,
        rolls: dice,
        flags: { [MODULE_ID]: { [CHECK_FLAG]: { actorId: actor.id, skill: skillName, dice: values } } },
      });
      return message?.id ?? null;
    } catch (error) {
      console.warn('NCI | could not post the check to chat', error);
      return null;
    }
  },
};
