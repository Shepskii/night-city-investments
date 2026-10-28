/**
 * Broker voices
 * @file scripts/engine/brokerVoice.js
 * @description A broker whose character sheet has a Personality gets mail in that voice: a greeting,
 *              a line that fits what the mail is about, the facts as usual, and a sign-off. The lines
 *              themselves live in data/broker-voices.js. A broker without a sheet, or with a
 *              Personality that is not one of the ten from the Cyberpunk RED table, gets none of this
 *              and keeps the standard wording. Pure; no Foundry globals.
 */

/** The ten entries of the Cyberpunk RED Personality table. */
export const VOICE_PERSONALITIES = ['shy', 'rebellious', 'arrogant', 'moody', 'picky', 'stable', 'silly', 'sneaky', 'intellectual', 'friendly'];

/** What a broker's mail can be about. Each personality has a pool of lines for each. */
export const VOICE_KINDS = [
  'accepted', 'filledBuy', 'filledSell', 'filledGain', 'filledLoss', 'rejected', 'expired', 'queued', 'paid',
  'failed', 'cancelled', 'unrecognised', 'help', 'report', 'notClient', 'tipUp', 'tipDown', 'warning', 'dropped',
];

/** Pools every mail draws on besides its own kind. */
export const VOICE_FRAME = ['greetings', 'signoffs'];

/** Optional extra pools a mail can ask for after its facts (a rumour's "take it with a pinch of salt"). */
export const VOICE_EXTRAS = ['tipHedge'];

/** Matched as keywords so slightly reworded sheet text ("Shy and Secretive", "shy / quiet") still works. */
const PERSONALITY_KEYWORDS = [
  ['shy', 'shy'],
  ['rebellious', 'rebellious'],
  ['arrogant', 'arrogant'],
  ['moody', 'moody'],
  ['picky', 'picky'],
  ['stable', 'stable'],
  ['silly', 'silly'],
  ['sneaky', 'sneaky'],
  ['intellectual', 'intellectual'],
  ['friendly', 'friendly'],
];

/** The personality named in a sheet's Personality text, or null. */
export function resolvePersonality(text) {
  const value = String(text ?? '').toLowerCase();
  return PERSONALITY_KEYWORDS.find(([keyword]) => value.includes(keyword))?.[1] ?? null;
}

/** Last line used from each pool, so the same line is not sent twice running. */
const lastUsed = new Map();

export function resetVoiceMemory() {
  lastUsed.clear();
}

/**
 * A random line from a pool, never the one used last time from that pool (unless it is the only one).
 * @param {string[]} pool
 * @param {string} memoryKey
 * @param {() => number} [rng]
 */
export function pickLine(pool, memoryKey, rng = Math.random) {
  if (!Array.isArray(pool) || !pool.length) return null;
  let index = Math.floor(rng() * pool.length) % pool.length;
  if (pool.length > 1 && lastUsed.get(memoryKey) === index) index = (index + 1 + Math.floor(rng() * (pool.length - 1))) % pool.length;
  lastUsed.set(memoryKey, index);
  return pool[index];
}

/** Fill {tokens} from `data`; a token with no value is left out. */
export const fillLine = (line, data = {}) => String(line).replace(/\{(\w+)\}/g, (_, key) => data[key] ?? '').replace(/\s{2,}/g, ' ').trim();

/**
 * The paragraphs of a voiced mail, or null when the broker has no voice (use the standard mail).
 * @param {object} o
 * @param {Object<string, Object<string, string[]>>} o.voices - the line pools, by personality
 * @param {string|null} o.personality
 * @param {string} o.kind - one of VOICE_KINDS
 * @param {Object<string, string>} [o.data] - values for {tokens} in the lines
 * @param {string[]} o.lines - the facts, kept exactly as they are
 * @param {boolean} [o.standalone] - the voiced line says it all, so the standard facts are left out
 * @param {string} [o.after] - a pool (one of VOICE_EXTRAS) to add after the facts
 * @param {() => number} [o.rng]
 * @returns {{paragraphs: string[], signed: boolean} | null} `signed` is false when the voice has no sign-off, so the caller adds its own
 */
export function composeVoiced({ voices, personality, kind, data = {}, lines, standalone = false, after = null, rng }) {
  const voice = personality ? voices?.[personality] : null;
  if (!voice) return null;
  const say = (key) => {
    const line = pickLine(voice[key], `${personality}:${key}`, rng);
    return line ? fillLine(line, data) : '';
  };
  const signoff = say('signoffs');
  const body = [say('greetings'), say(kind), ...(standalone ? [] : lines), after ? say(after) : ''];
  return { paragraphs: [...body, signoff].filter(Boolean), signed: !!signoff };
}
