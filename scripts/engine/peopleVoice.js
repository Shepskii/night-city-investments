/**
 * People's voices (M3 step 3, DESIGN §36.4)
 * @file scripts/engine/peopleVoice.js
 * @description How an employee, an NPC owner or a corporation's HR words its mail. A person writes by their
 *              Personality (the Cyberpunk RED table): from their sheet, or, for a recruit with none, one fixed by
 *              their staff id so they always write the same way (the user's choice, 2026-11-11). The Personality
 *              frames the mail with a greeting and a sign-off; the line itself is by what the mail is about and the
 *              writer's mood: an employee's loyalty (devoted, content or sullen), or an employee's performance for
 *              the employer. The lines live in data/people-voices. Pure.
 */

import { pickLine, fillLine, resolvePersonality, VOICE_PERSONALITIES } from './brokerVoice.js';
import { refNumber } from './orgVoice.js';

/** A person's Personality: the one their sheet names, or one fixed by their id. */
export function personalityOf(id, sheetText = null) {
  return resolvePersonality(sheetText) ?? VOICE_PERSONALITIES[Number(refNumber(`personality:${id}`)) % VOICE_PERSONALITIES.length];
}

/** An employee's mood from their loyalty band (businessStaff `loyaltyBand`): three tones, the user's choice. */
export const moodOf = (band) => (band === 'sullen' ? 'sullen' : band === 'steady' ? 'content' : 'devoted');

/**
 * A person's mail, or null when there is no line for this kind.
 * @param {object} o
 * @param {object} o.frames - greetings and sign-offs by Personality
 * @param {object} o.lines - by kind, then by tone (`lines` for any)
 * @param {string} o.personality
 * @param {string} o.kind
 * @param {string} [o.tone]
 * @param {object} [o.data] - values for {tokens}
 * @param {string[]} [o.after] - lines kept as they are, after the voiced line and before the sign-off (a payslip's figures)
 * @param {() => number} [o.rng]
 * @returns {{paragraphs: string[]}|null}
 */
export function peopleMail({ frames, lines, personality, kind, tone = null, data = {}, after = [], rng = Math.random }) {
  const pools = lines?.[kind];
  if (!pools) return null;
  const pool = (tone && pools[tone]?.length ? pools[tone] : null) ?? pools.lines;
  if (!pool?.length) return null;
  const frame = frames?.[personality] ?? {};
  const pick = (list, key) => (list?.length ? fillLine(pickLine(list, key, rng) ?? '', data) : '');
  return {
    paragraphs: [
      pick(frame.greetings, `people:${personality}:greet`),
      fillLine(pickLine(pool, `people:${kind}:${tone ?? 'lines'}`, rng), data),
      ...after,
      pick(frame.signoffs, `people:${personality}:sign`),
    ].filter(Boolean),
  };
}
