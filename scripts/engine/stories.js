/**
 * Media stories (F1c)
 * @file scripts/engine/stories.js
 * @description A Media character publishes a story naming a company, an exposé or a puff piece. Whether the
 *              public believes it is a 1d10 against Believability by Credibility rank, as the rules have it,
 *              with a bonus for evidence and no Luck. A believed story moves the price, up to a limit by rank.
 *              Pure; the GM's service holds the record and the evidence items.
 */

export const STORY_RULES = Object.freeze({
  /** Believability out of 10, by rank 0 to 10. */
  believability: Object.freeze([0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7]),
  /** The most a believed story moves a price, in percent, by rank 0 to 10. */
  cap: Object.freeze([0, 2, 2, 4, 4, 7, 7, 10, 10, 12, 12]),
  /** How much of the cap a bare success moves it; a margin of `fullMargin` moves it the whole cap. */
  minShare: 0.6,
  fullMargin: 3,
  /** Evidence: +1 for any, +`manyBonus` in all for more than `many` pieces. */
  bonus: 1,
  many: 4,
  manyBonus: 3,
  /** A Media may publish once in `waitDays`; a company's story within `sameTopicDays` needs new evidence. */
  waitDays: 7,
  sameTopicDays: 30,
  delayDays: 1,
  /** Publishing about a company you hold draws this much heat. A believed exposé from this rank opens a regulator's case on a player company. */
  holdingHeat: 10,
  caseRank: 5,
  headlineMax: 120,
});

export const STORY_ANGLES = Object.freeze(['expose', 'puff']);

const rankOf = (rank) => Math.max(0, Math.min(10, Math.floor(Number(rank) || 0)));

/** What evidence adds to Believability. */
export const evidenceBonus = (pieces, r = STORY_RULES) => (pieces > r.many ? r.manyBonus : pieces > 0 ? r.bonus : 0);

/** Believability out of 10: the die must come up this or under. */
export function believability(rank, pieces = 0, r = STORY_RULES) {
  return Math.min(10, r.believability[rankOf(rank)] + evidenceBonus(pieces, r));
}

/** How far a believed story moves the price, in percent: negative for an exposé. */
export function storyPercent(rank, margin, angle, r = STORY_RULES) {
  const share = r.minShare + (1 - r.minShare) * Math.min(1, Math.max(0, margin) / r.fullMargin);
  const size = Math.round(r.cap[rankOf(rank)] * share * 10) / 10;
  return angle === 'puff' ? size : -size;
}

/**
 * Whether this Media may publish now.
 * @param {{rank: number, angle: string, ticker: string, day: number, actorId: string, pieces: number, recent: object[]}} o -
 *        `recent` is the record of stories, `{actorId, ticker, day}`
 */
export function storyCheck({ rank, angle, ticker, day, actorId, pieces, recent = [] }, r = STORY_RULES) {
  if (rankOf(rank) < 1) return { ok: false, reason: 'not-media' };
  if (!STORY_ANGLES.includes(angle)) return { ok: false, reason: 'bad-angle' };
  if (!ticker) return { ok: false, reason: 'no-target' };
  if (recent.some((s) => s.actorId === actorId && day - s.day < r.waitDays)) return { ok: false, reason: 'story-wait' };
  if (!pieces && recent.some((s) => s.ticker === ticker && day - s.day < r.sameTopicDays)) return { ok: false, reason: 'story-same-topic' };
  return { ok: true };
}

/** The result of the die. */
export function rollStory({ rank, pieces, die, angle }, r = STORY_RULES) {
  const target = believability(rank, pieces, r);
  const believed = die <= target;
  return { target, believed, percent: believed ? storyPercent(rank, target - die, angle, r) : 0 };
}

/** The record of stories, kept tidy. */
export const normalizeStories = (value) => ({
  pending: Array.isArray(value?.pending) ? value.pending : [],
  recent: Array.isArray(value?.recent) ? value.recent.slice(-200) : [],
});
