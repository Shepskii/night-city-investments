/**
 * Player businesses: stories in the press (S1a, DESIGN §36.13)
 * @file scripts/engine/businessPress.js
 * @description A corporation with a grudge runs a story against a business. It is drawn as a week opens, in place of
 *              what the week would have held. With approval on it waits for the GM, and the owners see nothing until
 *              it is let run; then it is the week's event. It prints a few days in, when the public decides whether
 *              to believe it, and what it does lands when the week closes. What the owners say in answer is the
 *              week's response, as for any event. Pure; the GM's service does the news, the price and the mail.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { fail, clamp } from './businessRecord.js';
import { createRng } from './rng.js';
import { exposureBand } from './businessCompany.js';
import { hostileChance, standingBand } from './factions.js';
import { believability, storyPercent, STORY_RULES } from './stories.js';
import { heatTier } from './heat.js';
import { bandPassed } from './rolls.js';

/**
 * The public makes up its mind about a story that has printed. A GM who ran it by hand may have decided already
 * (`force`): believed, it moves the price by the middle of the outlet's range.
 */
function judgeStory(story, die, p) {
  const smear = story.story === 'smear';
  const target = Math.max(0, believability(story.rank, smear ? 0 : 1) - (smear ? p.press.smearPenalty : 0));
  story.printed = true;
  story.believed = story.force ?? die <= target;
  story.percent = story.believed ? storyPercent(story.rank, story.force ? STORY_RULES.fullMargin / 2 : target - die, 'expose') : 0;
}

/** Whether the last few weeks' digests hold any of these events. */
const recentEvent = (b, kinds, p) => b.digests.slice(-p.press.lookbackWeeks).some((d) => kinds.includes(d.event?.kind));

/**
 * What could truthfully be printed about this business now. A smear needs nothing, so it isn't here.
 * @param {object} b
 * @param {{exposure?: number, underworld?: boolean}} o - the hidden Exposure, and whether crime is in this world's game
 * @returns {string[]} kinds of story
 */
export function pressTruths(b, { exposure = 0, underworld = true } = {}, p = BUSINESS_DEFAULTS) {
  const r = p.press;
  const out = [];
  const lost = b.digests.slice(-r.lookbackWeeks).some((d) => d.profit < 0);
  if (lost || (b.state.compliance != null && b.state.compliance < r.poorState)) out.push('money');
  if (underworld && (['moderate', 'high'].includes(exposureBand(exposure, p)) || recentEvent(b, r.raids, p))) out.push('crime');
  if (b.state.reputation < r.poorState || (b.stockQueries ?? []).length || recentEvent(b, r.accidents, p)) out.push('service');
  return out;
}

/** The weekly chance of a story, from the worst standing with a corporation. */
export function pressChance(worst, hasTruth, frequency = 1, p = BUSINESS_DEFAULTS) {
  const band = standingBand(worst, p);
  const base = band === 'hostile' ? hostileChance(worst, p) * p.press.hostileDraw
    : band === 'wary' ? p.press.chance.wary
      : band === 'neutral' && hasTruth ? p.press.chance.neutral
        : 0;
  return Math.min(1, base * frequency);
}

/**
 * A story for the week now opening, or none.
 * @param {object} b - with the new period on it
 * @param {object|null} relations - `relations.press` is `{frequency, approval, underworld, corps: {id, name, value}[], media: {name, ticker}[]}`; none means stories are off
 * @returns {object|null} the event
 */
export function drawPress(b, seed = 'nci', p = BUSINESS_DEFAULTS, relations = null) {
  const press = relations?.press;
  if (!press?.corps?.length) return null;
  const day = b.period.startDay;
  if (spansLimit(day, [b.press?.lastDay, press.sharedLastDay], p)) return null;
  const worst = [...press.corps].sort((x, y) => x.value - y.value)[0];
  const truths = pressTruths(b, { exposure: relations.exposure ?? 0, underworld: press.underworld !== false }, p);
  const rng = createRng(seed, 'business-press', b.id, b.period.index);
  if (!rng.chance(pressChance(worst.value, truths.length > 0, press.frequency, p))) return null;
  const story = truths.length && !rng.chance(p.press.smearShare) ? truths[rng.int(0, truths.length - 1)] : 'smear';
  // A hostile corporation goes to a media company if the world has one; otherwise it prints it itself.
  const media = standingBand(worst.value, p) === 'hostile' && press.media?.length ? press.media[rng.int(0, press.media.length - 1)] : null;
  return {
    kind: 'press',
    story,
    grudge: worst.name,
    factionId: worst.id,
    factionName: media?.name ?? worst.name,
    rank: media ? p.press.rank.media : p.press.rank.own,
    printDay: day + p.press.printDays,
    truths,
  };
}

/** Put a drawn story in place: waiting for the GM if approval is on, and as the week's event if not. */
export function placePress(b, event, approval) {
  b.press = { ...(b.press ?? {}), lastDay: b.period.startDay, held: approval ? event : null };
  if (!approval) b.period.event = event;
}

/** The GM lets a waiting story run, with the headline they want. It becomes this week's event. */
export function approvePress(b, headline, p = BUSINESS_DEFAULTS) {
  const event = b.press?.held;
  if (!event) return fail('no-story');
  if (b.period?.event) return fail('event-busy');
  const words = String(headline ?? '').trim().replace(/\s+/g, ' ').slice(0, STORY_RULES.headlineMax);
  b.period.event = { ...event, ...(words ? { headline: words } : {}) };
  b.press = { ...b.press, held: null };
  return { ok: true };
}

/** The GM spikes a waiting story. The 28 days still run from when it was drawn. */
export function spikePress(b) {
  if (!b.press?.held) return fail('no-story');
  b.press = { ...b.press, held: null };
  return { ok: true };
}

/**
 * A story the GM runs by hand (S1c). Nothing has to be true, and it needs no grudge.
 * @param {{story: string, outlet: {name: string, rank: number, factionId?: string}, headline?: string, believed?: boolean|null}} o
 */
export function handPress({ story, outlet, headline = '', believed = null }) {
  return {
    kind: 'press',
    story,
    grudge: null,
    factionId: outlet.factionId ?? null,
    factionName: outlet.name,
    rank: outlet.rank,
    truths: [],
    byHand: true,
    ...(headline ? { headline } : {}),
    ...(believed == null ? {} : { force: believed }),
  };
}

/** A hand-run story becomes the week's event, ahead of one the GM had still to decide on. */
export function startHandPress(b, event, day, p = BUSINESS_DEFAULTS) {
  b.period.event = { ...event, printDay: day + p.press.printDays };
  b.press = { ...(b.press ?? {}), lastDay: day, held: null, queued: null };
}

/**
 * The GM runs a story on a business: now if the week is free, and as next week's event if it is not. It ignores the
 * 28 days but starts them, so a drawn story can't follow straight after.
 * @returns {{ok: boolean, when?: 'now'|'next', reason?: string}}
 */
export function runPress(b, event, day, p = BUSINESS_DEFAULTS) {
  if (b.status !== 'open' || !b.period) return fail('not-open');
  if (b.press?.queued) return fail('press-queued');
  if (b.period.event) {
    b.press = { ...(b.press ?? {}), lastDay: day, queued: event };
    return { ok: true, when: 'next' };
  }
  startHandPress(b, event, day, p);
  return { ok: true, when: 'now' };
}

/** A story the GM never answered goes when its week does. */
export function lapsePress(b) {
  if (b.press?.held) b.press = { ...b.press, held: null };
}

/**
 * The story goes to print once its day comes, and the public makes up its mind. `force` prints it whatever the day:
 * a short week can close first. Believability is rolled here and kept from the owners until the close.
 * @returns {boolean} whether it printed
 */
export function printPress(b, day, seed, out, p = BUSINESS_DEFAULTS, force = false) {
  const event = b.period?.event;
  if (event?.kind !== 'press' || event.printed || (!force && day < event.printDay)) return false;
  judgeStory(event, createRng(seed, 'press-print', b.id, b.period.index).int(1, 10), p);
  out.events.push({ type: 'pressPrinted', story: event.story, outlet: event.factionName, headline: event.headline ?? null });
  return true;
}

/** What a story leaves behind when its week closes. */
export function pressFallout(b, settled, p = BUSINESS_DEFAULTS) {
  const event = b.period.event;
  if (event?.kind !== 'press' || !settled) return [];
  const scale = !event.believed || settled.outcome === 'answered' ? 0 : settled.outcome === 'failed' ? 0.5 : 1;
  const rules = p.press.kinds[event.story];
  if (rules.reputation && scale) b.state.reputation = clamp(b.state.reputation + rules.reputation * scale, 0, 100);
  const percent = scale ? (rules.price ? event.percent : rules.pricePercent ?? 0) * scale : 0;
  return [{
    type: 'pressResult',
    story: event.story,
    outlet: event.factionName,
    believed: !!event.believed,
    scale,
    outcome: settled.outcome,
    percent,
    period: b.period.index,
    ...(rules.exposure && scale ? { exposure: rules.exposure * scale } : {}),
    regCase: !!rules.regCase && scale === 1 && event.rank >= STORY_RULES.caseRank && b.stage >= 1,
  }];
}

// ── Characters (S1b) ─────────────────────────────────────────────────────────

/** The highest heat noted in the last few weeks. Heat halves every week, so a spike must outlast itself to be news. */
export function heatPeak(peaks, week, p = BUSINESS_DEFAULTS) {
  const window = p.press.character.windowWeeks;
  return Math.max(0, ...Object.entries(peaks ?? {}).filter(([w]) => week - Number(w) < window).map(([, v]) => v));
}

/** Note this week's heat if it is the highest so far, and forget weeks too old to matter. */
export function notePeak(peaks, week, heat, p = BUSINESS_DEFAULTS) {
  const window = p.press.character.windowWeeks;
  const kept = Object.fromEntries(Object.entries(peaks ?? {}).filter(([w]) => week - Number(w) < window));
  if (heat > (kept[week] ?? 0)) kept[week] = heat;
  return kept;
}

/** The weekly chance of a story about a character, from their recent peak. */
export function characterPressChance(heat, frequency = 1, p = BUSINESS_DEFAULTS) {
  return Math.min(1, (p.press.character.chance[heatTier(heat)] ?? 0) * frequency);
}

/** What could truthfully be printed about a character whose recent peak is this. */
export function characterTruths(heat, stake = null) {
  return [...(heatTier(heat) === 'quiet' ? [] : ['dirty']), ...(stake ? ['hidden'] : [])];
}

/** Whether any of these days is inside the limit, counting back from `day`. */
export const spansLimit = (day, days, p = BUSINESS_DEFAULTS) => days.some((d) => d != null && day - d < p.press.limitDays);

/**
 * A story about a character. A corporation with a grudge against a business they run is behind it if there is one;
 * otherwise a media company has picked it up by itself, so with neither there is nobody to print it.
 * @returns {object|null}
 */
export function drawCharacterPress({ id, actorId, name, day, truths, worst = null, businessId = null, stake = null, media = [], rng }, p = BUSINESS_DEFAULTS) {
  const useMedia = media.length && (!worst || standingBand(worst.value, p) === 'hostile');
  if (!useMedia && !worst) return null;
  const chosen = useMedia ? media[rng.int(0, media.length - 1)] : null;
  const story = truths.length && !rng.chance(p.press.smearShare) ? truths[rng.int(0, truths.length - 1)] : 'smear';
  return {
    id,
    actorId,
    name,
    day,
    status: 'held',
    story,
    outlet: chosen?.name ?? worst.name,
    grudge: worst?.name ?? null,
    rank: chosen ? p.press.rank.media : p.press.rank.own,
    businessId,
    ...(story === 'hidden' ? { stake } : {}),
  };
}

/** The public makes up its mind. Kept from the character until the end. */
export function printCharacterPress(story, die, p = BUSINESS_DEFAULTS) {
  judgeStory(story, die, p);
}

export function answerCharacterPress(story, band) {
  story.answer = band;
}

/** What it does at the end of its seven days: answered well none of it, badly half, and in silence or a fumble all. */
export function settleCharacterPress(story, p = BUSINESS_DEFAULTS) {
  const rules = p.press.character.kinds[story.story];
  const scale = !story.believed || (story.answer && bandPassed(story.answer)) ? 0 : story.answer && story.answer !== 'fumble' ? 0.5 : 1;
  const heat = (story.rank >= STORY_RULES.caseRank ? rules.heatMedia ?? rules.heat : rules.heat) * scale;
  return { scale, heat, reputation: rules.reputation * scale, percent: scale && rules.priceShare ? story.percent * rules.priceShare * scale : 0 };
}
