/**
 * Skill adapter: reads a character's Accounting skill and rolls checks.
 * @file scripts/services/SkillAdapter.js
 * @description Cyberpunk RED skills are Items of type 'skill' (system.level, system.stat); the
 *              governing stat is at actor.system.stats.<stat>.value. This reads the sheet the same
 *              way Night City Messenger does, without depending on its internals. Rolls use Foundry's
 *              dice, so Dice So Nice shows them, and a chat card records the check.
 */

import { cprD10, evaluateCheck, normalizeLevers, resolveRoll, HIRE_TIERS } from '../engine/index.js';
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
    const item = this._skillItem(actor, skill);
    const level = Number(item?.system?.level ?? item?.system?.value ?? 0) || 0;
    const statName = String(item?.system?.stat ?? defaultStat).toLowerCase();
    const raw = actor?.system?.stats?.[statName];
    const stat = Number(raw?.value ?? raw ?? 0) || 0;
    return { found: !!item, level, stat, statName, total: stat + level };
  },

  /**
   * A skill item by name. Some Cyberpunk RED skills carry a qualifier on the sheet, such as
   * "Local Expert (Your Home)" or "Play Instrument (Guitar)": an exact name wins, and otherwise the
   * character's best qualified version of the skill counts.
   */
  _skillItem(actor, skill) {
    const skills = actor?.items?.filter?.((i) => i.type === 'skill') ?? [];
    const exact = skills.find((i) => norm(i.name) === norm(skill));
    if (exact) return exact;
    const level = (i) => Number(i.system?.level ?? i.system?.value ?? 0) || 0;
    return skills
      .filter((i) => /\(.*\)\s*$/.test(i.name) && norm(i.name.replace(/\s*\(.*\)\s*$/, '')) === norm(skill))
      .sort((a, b) => level(b) - level(a))[0] ?? null;
  },

  /**
   * A role ability's rank. Cyberpunk RED roles are Items of type 'role' (system.rank,
   * system.mainRoleAbility); a character with two roles that share an ability uses the higher rank.
   * @returns {{found: boolean, rank: number}}
   */
  readAbility(actor, ability) {
    const ranks = (actor?.items?.filter?.((i) => i.type === 'role' && norm(i.system?.mainRoleAbility) === norm(ability)) ?? [])
      .map((i) => Number(i.system?.rank) || 0);
    return ranks.length ? { found: true, rank: Math.max(...ranks) } : { found: false, rank: 0 };
  },

  /** The character's LUCK pool now. */
  luck(actor) {
    const raw = actor?.system?.stats?.luck;
    return Math.max(0, Number(raw?.value ?? raw ?? 0) || 0);
  },

  /**
   * What a roll adds to the d10: stat + skill, a role ability's rank, or a hired professional's
   * fixed base. `use` is `{kind: 'skill', skill, stat}`, `{kind: 'ability', ability}` or `{kind: 'hire', hire}`.
   * @returns {{base: number, name: string, parts: string}} `parts` is the breakdown for the chat card
   */
  baseFor(actor, use) {
    // An employee's base comes from the business's record (the GM's rollSpec puts it on the use), not the caller's sheet.
    if (use.kind === 'staff') {
      const base = Number(use.base) || 0;
      return { base, name: `staff:${use.staffId}`, parts: `${L('NCI.Roll.Employee')} ${base}` };
    }
    if (use.kind === 'hire') {
      const base = HIRE_TIERS[use.hire] ?? HIRE_TIERS.cheap;
      return { base, name: `hire:${use.hire}`, parts: `${L(`NCI.Roll.Hire.${use.hire}`)} ${base}` };
    }
    if (use.kind === 'ability') {
      const { rank } = this.readAbility(actor, use.ability);
      return { base: rank, name: use.ability, parts: `${escapeHtml(use.ability)} ${rank}` };
    }
    const s = this.read(actor, use.skill, use.stat);
    return { base: s.total, name: use.skill, parts: `${escapeHtml(s.statName.toUpperCase())} ${s.stat} + ${escapeHtml(use.skill)} ${s.level}` };
  },

  /**
   * Roll a business check with the levers the player chose (DESIGN §26), on the player's own client.
   * Luck is spent from the sheet before the dice are rolled, as the rules have it, and the card
   * records the pool beforehand so the GM can see it really went down.
   * @param {Actor} actor
   * @param {{dv: number, title: string, use: object, levers?: object}} o
   * @returns {Promise<{result: object, roll: object, messageId: string|null}>}
   */
  async leverCheck(actor, { dv, title, use, levers = {} }) {
    // A hired professional or an employee cannot use the character's Luck, or their business days.
    const l = normalizeLevers({ ...levers, ...(use.kind === 'staff' ? { luck: 0, extra: 0 } : {}), hire: use.kind === 'hire' ? use.hire : null });
    const base = this.baseFor(actor, use);
    const luckBefore = this.luck(actor);
    const luck = Math.min(l.luck, luckBefore);
    if (luck > 0) await actor.update({ 'system.stats.luck.value': luckBefore - luck });

    const first = await this.rollOne();
    const dice = [first];
    if (first.value === 10 || first.value === 1) dice.push(await this.rollOne());
    const queue = dice.map((d) => d.value);
    const roll = cprD10(() => queue.shift());
    const result = resolveRoll({ base: base.base, roll, dv, levers: { ...l, luck } });

    const messageId = await this._postLevers(actor, {
      title, base, roll, result, dice: dice.map((d) => d.roll).filter(Boolean),
      flag: {
        actorId: actor.id, skill: base.name, kind: use.kind, dice: dice.map((d) => d.value),
        levers: { approach: l.approach, luck, luckBefore, bonus: l.bonus, extra: l.extra, hire: l.hire },
      },
    });
    return { result, roll, messageId };
  },

  /**
   * GM side of `leverCheck`: read the card back as `verify` does, then the levers. The base is the
   * GM's own (the sheet now, or the hire tier); Luck counts only if the pool went down by that much
   * since the roll; the bonus only if the business has one waiting (`bonusAvailable`); extra time
   * only if the character has a business day left (`extraAvailable`); a hired professional only where
   * the action allows one.
   * @param {Actor} actor
   * @param {{rollId?: string, key: string, ts?: number}} request
   * @param {{dv: number, use: object, bonusAvailable?: boolean, extraAvailable?: boolean, allowHire?: boolean}} spec
   * @returns {Promise<{ok: true, result: object, levers: object, base: number} | {ok: false, reason: string}>}
   */
  async verifyLevers(actor, request, { dv, use, bonusAvailable = false, extraAvailable = false, allowHire = false }) {
    if (use.kind === 'hire' && !allowHire) return { ok: false, reason: 'hire-not-allowed' };
    const name = use.kind === 'hire' ? `hire:${use.hire}` : use.kind === 'staff' ? `staff:${use.staffId}` : use.kind === 'ability' ? use.ability : use.skill;
    const card = await this._readCard(actor, request, name);
    if (!card.ok) return card;

    const claimed = card.flag.levers ?? {};
    const luckClaimed = Math.max(0, Math.floor(Number(claimed.luck) || 0));
    const before = Number(claimed.luckBefore);
    const luckOk = use.kind !== 'hire' && use.kind !== 'staff' && luckClaimed > 0 && Number.isFinite(before) && luckClaimed <= before && this.luck(actor) <= before - luckClaimed;
    const levers = normalizeLevers({
      approach: claimed.approach,
      luck: luckOk ? luckClaimed : 0,
      bonus: bonusAvailable && Number(claimed.bonus) > 0 ? 1 : 0,
      extra: extraAvailable && use.kind !== 'staff' && Number(claimed.extra) > 0 ? 1 : 0,
      hire: use.kind === 'hire' ? use.hire : null,
    });

    const { base } = this.baseFor(actor, use);
    return { ok: true, base, levers, result: resolveRoll({ base, roll: card.roll, dv, levers }) };
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
    const card = await this._readCard(actor, request, skillName);
    if (!card.ok) return card;
    const skill = this.read(actor, skillName, stat);
    return { ok: true, stat: skill.stat, level: skill.level, dv, roll: card.roll };
  },

  /**
   * Find a request's roll card and check it: for this actor and this skill (or ability, or hire),
   * posted by someone who owns the actor, recent, and unused (or used by this same request). Marks
   * it used by the request and gives back its dice as a CPR roll.
   * @returns {Promise<{ok: true, flag: object, roll: object} | {ok: false, reason: string}>}
   */
  async _readCard(actor, request, skillName) {
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

    const queue = [...values];
    return { ok: true, flag, roll: cprD10(() => queue.shift()) };
  },

  async _postLevers(actor, { title, base, roll, result, dice, flag }) {
    if (typeof ChatMessage === 'undefined') return null;
    const crit = roll.crit ? ` (${L(`NCI.Check.Crit.${roll.crit}`)})` : '';
    const extras = [
      result.luck ? ` + ${L('NCI.Roll.Luck')} ${result.luck}` : '',
      result.bonus ? ` + ${L('NCI.Roll.Help')} ${result.bonus}` : '',
      result.extra ? ` + ${L('NCI.Roll.ExtraTime')} ${result.extra}` : '',
    ].join('');
    const approach = result.approach === 'standard' ? '' : ` (${L(`NCI.Roll.Approach.${result.approach}`)})`;
    const content = `<div class="nci-chat"><strong>${escapeHtml(title)}</strong><br>`
      + `${base.parts}${extras} + d10 [${roll.rolls.join(', ')}]${crit} = <strong>${result.total}</strong>`
      + ` ${L('NCI.Check.Versus')} DV ${result.dv}${approach}<br><strong>${escapeHtml(L(`NCI.Roll.Band.${result.band}`))}</strong></div>`;
    try {
      const message = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker?.({ actor }),
        content,
        rolls: dice,
        flags: { [MODULE_ID]: { [CHECK_FLAG]: flag } },
      });
      return message?.id ?? null;
    } catch (error) {
      console.warn('NCI | could not post the check to chat', error);
      return null;
    }
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
