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
  if (b.press?.lastDay != null && day - b.press.lastDay < p.press.limitDays) return null;
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
  const die = createRng(seed, 'press-print', b.id, b.period.index).int(1, 10);
  const smear = event.story === 'smear';
  const target = Math.max(0, believability(event.rank, smear ? 0 : 1) - (smear ? p.press.smearPenalty : 0));
  event.printed = true;
  event.believed = die <= target;
  event.percent = event.believed ? storyPercent(event.rank, target - die, 'expose') : 0;
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
