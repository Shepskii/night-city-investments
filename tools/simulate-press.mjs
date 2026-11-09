/**
 * Calibration for press stories against players (S1, DESIGN §36.13, proposed). Runs without Foundry.
 *
 *   node tools/simulate-press.mjs [--seeds 2000] [--weeks 52] [--base 12] [--answer 0.8] [--staff 1] [--smearShare 0.2]
 *
 * One business, or one character, is followed for a year at a fixed worst standing or starting heat. It compares
 * today's hostile smear with stories at several draw rates, then looks for a spiral: harm making the next story true.
 * Reputation, the price and Believability use the module's own numbers. What takes a loss week at each Reputation
 * band (LOSS_WEEK) is a stand-in, as a real week's profit depends on the whole business, and a crew is taken to do
 * nothing to win Reputation back, so recovery is drift alone: both make a spiral look worse than play would.
 */

import { createRng } from '../scripts/engine/rng.js';
import { cprD10 } from '../scripts/engine/checks.js';
import { bandOf } from '../scripts/engine/rolls.js';
import { rollStory } from '../scripts/engine/stories.js';
import { HEAT_TUNING, decayHeat, heatTier } from '../scripts/engine/heat.js';
import { BUSINESS_DEFAULTS as P, exposureBand } from '../scripts/engine/index.js';
import { hostileChance } from '../scripts/engine/factions.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const SEEDS = arg('seeds', 2000);
const WEEKS = arg('weeks', 52);
const BASE = arg('base', 12);
const ANSWER = arg('answer', 0.8);
const STAFF = arg('staff', 1);
const SMEAR_SHARE = arg('smearShare', 0.2);
const DV = 15;

/** The outlets decided in §36.13. */
const OWN_PRESS = 4;
const MEDIA = 6;

/** The chance a week of being a loss, by Reputation band: a stand-in, see above. */
const LOSS_WEEK = { poor: 0.5, modest: 0.1, good: 0.03, excellent: 0.02 };
const repBand = (rep) => (rep < 35 ? 'poor' : rep < 50 ? 'modest' : rep < 65 ? 'good' : 'excellent');

/** What a kind does in full when believed and unanswered (§36.13). */
const KINDS = {
  money: { reputation: -2, price: true },
  crime: { reputation: -5, exposure: 5, price: true },
  service: { reputation: -5 },
  smear: { reputation: -3, flat: -2 },
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const answerBand = (rng) => {
  const r = cprD10(() => rng.int(1, 10));
  return bandOf(BASE + r.total - DV, r.crit);
};
/** How much of the harm lands: answered none, failed half, unanswered or fumbled all. */
function harmScale(rng, answer) {
  if (!rng.chance(answer)) return 1;
  const band = answerBand(rng);
  return band === 'fumble' ? 1 : band === 'failure' ? 0.5 : 0;
}

/** Which kinds are true of this business now. */
function trueKinds(s, feedback) {
  const rep = feedback ? s.reputation : s.startReputation;
  const out = [];
  if (feedback ? s.lossWeeks > 0 : s.startLoss) out.push('money');
  if (['moderate', 'high'].includes(exposureBand(feedback ? s.exposure : s.startExposure))) out.push('crime');
  if (rep < 35) out.push('service');
  return out;
}

function chooseKind(rng, s, feedback) {
  const kinds = trueKinds(s, feedback);
  if (!kinds.length || rng.chance(SMEAR_SHARE)) return 'smear';
  return kinds[rng.int(0, kinds.length - 1)];
}

/** A year of stories at a weekly chance. `limitWeeks` 0 is no limit. */
function storyYear(seed, { chance, rank, limitWeeks = 4, feedback = true, answer = ANSWER, exposure = 0, reputation = 50 }) {
  const rng = createRng(seed, 'press');
  const s = { reputation, startReputation: reputation, exposure, startExposure: exposure, lossWeeks: 0, startLoss: false };
  const lossLog = [];
  const t = { drawn: 0, believed: 0, landed: 0, reputation: 0, price: 0, cases: 0, slots: 0, poorWeeks: 0, kinds: {} };
  let queued = false;
  let nextAllowed = 0;
  for (let w = 0; w < WEEKS; w++) {
    if (queued) {
      queued = false;
      const kind = chooseKind(rng, s, feedback);
      t.kinds[kind] = (t.kinds[kind] ?? 0) + 1;
      // Owners see the reporter at the week's start, so they answer before they know whether it will be believed.
      const scale = harmScale(rng, answer);
      if (answer > 0) t.slots += answer;
      const die = rng.int(1, 10);
      const smearPenalty = kind === 'smear' ? 1 : 0;
      const pieces = kind === 'smear' ? 0 : 1;
      const read = rollStory({ rank, pieces, die: die + smearPenalty, angle: 'expose' });
      if (read.believed) {
        t.believed += 1;
        if (scale > 0) {
          t.landed += 1;
          const k = KINDS[kind];
          const lost = k.reputation * scale;
          s.reputation = Math.max(0, s.reputation + lost);
          t.reputation += lost;
          t.price += (k.price ? read.percent : (k.flat ?? 0)) * scale;
          if (k.exposure) s.exposure += k.exposure * scale;
          if (kind === 'crime' && rank >= 5 && scale === 1) t.cases += 1;
        }
      }
    }
    const loss = rng.chance(LOSS_WEEK[repBand(s.reputation)]);
    lossLog.push(loss ? 1 : 0);
    s.lossWeeks = lossLog.slice(-4).reduce((a, b) => a + b, 0);
    s.reputation += (50 - s.reputation) * P.reputationDrift;
    s.exposure = Math.max(0, s.exposure - 0.5);
    if (s.reputation < 35) t.poorWeeks += 1;
    if (w >= nextAllowed && rng.chance(chance)) {
      queued = true;
      t.drawn += 1;
      nextAllowed = limitWeeks ? w + limitWeeks : w + 1;
    }
  }
  return { ...t, endReputation: s.reputation };
}

/** Today: a hostile corporation's act is a smear one time in two, or three with NPC staff to poach. It lands unless answered. */
function todayYear(seed, { chance, answer = ANSWER, reputation = 50 }) {
  const rng = createRng(seed, 'today');
  const t = { drawn: 0, landed: 0, reputation: 0, price: 0, poorWeeks: 0 };
  let rep = reputation;
  const smearOdds = STAFF ? 1 / 3 : 1 / 2;
  for (let w = 0; w < WEEKS; w++) {
    if (rng.chance(chance) && rng.chance(smearOdds)) {
      t.drawn += 1;
      const scale = harmScale(rng, answer);
      if (scale > 0) {
        t.landed += 1;
        rep = Math.max(0, rep - 3 * scale);
        t.reputation -= 3 * scale;
        t.price += -2 * scale;
      }
    }
    rep += (50 - rep) * P.reputationDrift;
    if (rep < 35) t.poorWeeks += 1;
  }
  return { ...t, endReputation: rep };
}

/** A character with no business: heat fades, a story adds to it, and more heat means a likelier story. */
function characterYear(seed, { start, chances, limitWeeks = 4, answer = 0.8, media = false, feedback = true, hold = false }) {
  const rng = createRng(seed, 'press-character');
  const perWeek = 7;
  let heat = start;
  let queued = false;
  let nextAllowed = 0;
  const t = { drawn: 0, believed: 0, heat: 0, peak: start };
  for (let w = 0; w < WEEKS; w++) {
    if (queued) {
      queued = false;
      const smear = heat < HEAT_TUNING.tiers.noticed || rng.chance(SMEAR_SHARE);
      const rank = media ? MEDIA : OWN_PRESS;
      const read = rollStory({ rank, pieces: smear ? 0 : 1, die: rng.int(1, 10) + (smear ? 1 : 0), angle: 'expose' });
      if (read.believed) {
        t.believed += 1;
        const scale = harmScale(rng, answer);
        const add = (smear ? 5 : rank >= 5 ? 15 : 10) * scale;
        heat += add; t.heat += add;
      }
    }
    heat = decayHeat(heat, 0, perWeek, HEAT_TUNING.halfLifeTicks);
    // `hold`: someone who keeps trading on what they know, so their heat never falls below where it started.
    if (hold) heat = Math.max(heat, start);
    t.peak = Math.max(t.peak, heat);
    const tier = heatTier(feedback ? heat : start);
    if (w >= nextAllowed && rng.chance(chances[tier] ?? 0)) {
      queued = true;
      t.drawn += 1;
      nextAllowed = w + limitWeeks;
    }
  }
  return { ...t, endHeat: heat };
}

const runs = (fn, tag, o) => Array.from({ length: SEEDS }, (_, i) => fn(`${tag}-${i}`, o));
const avg = (xs, key) => mean(xs.map((x) => x[key]));
const n1 = (v, w = 6) => v.toFixed(1).padStart(w);
const pct = (xs, test) => `${Math.round((xs.filter(test).length / xs.length) * 100)}%`.padStart(5);

console.log(`Press stories: ${SEEDS} years, ${WEEKS} weeks, roll base ${BASE} against DV ${DV}, ${Math.round(ANSWER * 100)}% of events answered, smear share ${Math.round(SMEAR_SHARE * 100)}%`);

// ── 1. Hostile: does a believability roll weaken it, and what draw rate makes up for that? ─────────────────
console.log('\n1. Hostile standing, clean business (only smears can be told): a year\'s harm');
console.log('standing  who                 drawn  believed  landed  Rep lost  price %');
for (const value of [-60, -80, -100]) {
  const chance = hostileChance(value, P);
  const today = runs(todayYear, `t${value}`, { chance });
  console.log(`${String(value).padEnd(9)} today's smear       ${n1(avg(today, 'drawn'))}      ---  ${n1(avg(today, 'landed'))}   ${n1(avg(today, 'reputation'))}   ${n1(avg(today, 'price'))}`);
  for (const [label, rank] of [['own press', OWN_PRESS], ['media', MEDIA]]) {
    for (const draw of [1, 2, 3]) {
      const xs = runs(storyYear, `s${value}${rank}${draw}`, { chance: Math.min(1, chance * draw), rank });
      console.log(`${''.padEnd(9)} ${`${label} x${draw}`.padEnd(18)} ${n1(avg(xs, 'drawn'))}   ${n1(avg(xs, 'believed'))}  ${n1(avg(xs, 'landed'))}   ${n1(avg(xs, 'reputation'))}   ${n1(avg(xs, 'price'))}`);
    }
  }
}

// ── 2. The same, with something true to tell ───────────────────────────────────────────────────────────────
console.log('\n2. Hostile (-80), a business with Exposure at 20 (a crime expose is true)');
console.log('who                 drawn  believed  landed  Rep lost  price %  cases  slots spent');
for (const [label, rank] of [['own press', OWN_PRESS], ['media', MEDIA]]) {
  for (const draw of [1, 2, 3]) {
    const xs = runs(storyYear, `e${rank}${draw}`, { chance: Math.min(1, hostileChance(-80, P) * draw), rank, exposure: 20 });
    console.log(`${`${label} x${draw}`.padEnd(18)} ${n1(avg(xs, 'drawn'))}   ${n1(avg(xs, 'believed'))}  ${n1(avg(xs, 'landed'))}   ${n1(avg(xs, 'reputation'))}   ${n1(avg(xs, 'price'))}  ${n1(avg(xs, 'cases'), 5)}  ${n1(avg(xs, 'slots'), 5)}`);
  }
}

// ── 3. A spiral ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n3. A spiral: hostile at -100, media outlet, x3 draw. "Fixed" holds the facts as they were at the start, so a low start keeps Bad service true all year');
console.log('start Rep  limit     answered  facts     stories/yr  end Rep  weeks poor  ended poor');
const ch100 = Math.min(1, hostileChance(-100, P) * 3);
for (const reputation of [50, 36, 25]) {
  for (const [label, limitWeeks] of [['28 days', 4], ['14 days', 2], ['none', 0]]) {
    for (const answer of [0.8, 0]) {
      for (const feedback of [true, false]) {
        const xs = runs(storyYear, `sp${reputation}${limitWeeks}${answer}${feedback}`, { chance: ch100, rank: MEDIA, limitWeeks, answer, feedback, reputation });
        console.log(`${String(reputation).padEnd(10)} ${label.padEnd(9)} ${`${Math.round(answer * 100)}%`.padEnd(9)} ${(feedback ? 'can spiral' : 'fixed').padEnd(10)} ${n1(avg(xs, 'drawn'), 8)}   ${n1(avg(xs, 'endReputation'))}     ${n1(avg(xs, 'poorWeeks'), 6)}     ${pct(xs, (x) => x.endReputation < 35)}`);
      }
    }
  }
}

// ── 4. Lower standings against the plan's table ─────────────────────────────────────────────────────────────
console.log('\n4. Below hostile (own press, x1): stories a year, and what the setting does');
console.log('band                        setting  chance  stories/yr  believed  Rep lost');
const bands = [['wary', 0.04, 0], ['neutral, true story to tell', 0.01, 20]];
for (const [name, chance, exposure] of bands) {
  for (const [setting, f] of [['Rare', 0.5], ['Normal', 1], ['Often', 2]]) {
    const xs = runs(storyYear, `b${name}${f}`, { chance: chance * f, rank: OWN_PRESS, exposure });
    console.log(`${name.padEnd(27)} ${setting.padEnd(7)}  ${`${(chance * f * 100).toFixed(1)}%`.padStart(5)}   ${n1(avg(xs, 'drawn'), 7)}   ${n1(avg(xs, 'believed'), 7)}   ${n1(avg(xs, 'reputation'))}`);
  }
}

// ── 5. Characters ───────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n5. A character with no business, heat half-life ${HEAT_TUNING.halfLifeTicks} ticks: 2% at 25, 4% at 50, 8% at 75`);
console.log('situation          start heat  outlet     stories/yr  believed  heat added  end heat');
const chances = { noticed: 0.02, flagged: 0.04, investigated: 0.08 };
for (const [situation, hold] of [['one spike, fades', false], ['keeps drawing heat', true]]) {
  for (const start of [25, 50, 75, 100]) {
    for (const [label, media] of [['own press', false], ['media', true]]) {
      const xs = runs(characterYear, `c${hold}${start}${media}`, { start, chances, media, hold });
      console.log(`${situation.padEnd(18)} ${String(start).padEnd(11)} ${label.padEnd(10)} ${n1(avg(xs, 'drawn'), 8)}   ${n1(avg(xs, 'believed'), 7)}   ${n1(avg(xs, 'heat'), 8)}   ${n1(avg(xs, 'endHeat'), 6)}`);
    }
  }
}
