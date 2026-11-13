/**
 * Gangs in the press (G1, DESIGN §36.18): how often a gang on a business's turf puts a story about, and what it costs
 * over a year. Runs the module's own draw and fallout (businessPress.js) without Foundry.
 *
 *   node tools/simulate-gang-press.mjs [--seeds 2000] [--weeks 52] [--answer 0.8] [--base 12]
 *
 * A bar on the gang's turf, with an open back room at low Exposure, is followed for a year at a fixed standing. A
 * story is answered `answer` of the time, at roll base `base` against DV 15. A story's week is taken from the event
 * slot; the 28-day limit applies. Reputation is not drifted back, so its loss is the harm in full.
 */

import { drawPress, pressFallout, placePress, normalizeBusiness, bandOf, cprD10, createRng, BUSINESS_DEFAULTS as P } from '../scripts/engine/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const SEEDS = arg('seeds', 2000);
const WEEKS = arg('weeks', 52);
const ANSWER = arg('answer', 0.8);
const BASE = arg('base', 12);

function year(standing, seed) {
  const b = normalizeBusiness({
    id: `bus_${seed}`, name: 'Sim Bar', status: 'open', stage: 0, archetype: 'bar', district: 'watson', till: 1000,
    partners: [{ actorId: 'a', status: 'active', units: 10, voting: true }],
    state: { capacity: 1, reputation: 60, costFactor: 1 },
    digests: [{ index: 0, profit: 100 }],
    backRoom: { status: 'open', kind: 'gambling', dirty: 0 },
    period: { index: 1, startDay: 7, endDay: 14, slots: [], event: null },
  });
  const rel = { exposure: 10, press: { frequency: 1, approval: false, underworld: true, corps: [], media: [], gangs: [{ id: 'g', name: 'Gang', value: standing, turf: true, outlet: 'Gang Sheet' }] } };
  const rng = createRng('sim-answer', seed);
  const tally = { stories: 0, kinds: {}, landed: 0, reputation: 0, keepAwayWeeks: 0, tips: 0 };
  const startRep = b.state.reputation;
  for (let w = 1; w <= WEEKS; w++) {
    b.period = { index: w, startDay: w * 7, endDay: w * 7 + 7, slots: [], event: null };
    b.digests = [{ index: w - 1, profit: 100 }];
    const event = drawPress(b, `sim${seed}`, P, rel);
    if (!event) continue;
    placePress(b, event, false);
    tally.stories++;
    tally.kinds[event.story] = (tally.kinds[event.story] ?? 0) + 1;
    // Believability as the engine judges it at print; good word and a tip are always "believed".
    const e = b.period.event;
    if (['snitch', 'friendly'].includes(e.story)) e.believed = true;
    else e.believed = rng.int(1, 10) <= Math.max(0, 3 - (e.story === 'smear' ? P.press.smearPenalty : 0));
    e.percent = -1;
    let outcome = 'unanswered';
    if (e.story !== 'friendly' && rng.chance(ANSWER)) {
      const r = cprD10(() => rng.int(1, 10));
      const band = bandOf(BASE + r.total - 15, r.crit);
      outcome = band === 'fumble' ? 'fumbled' : ['failure'].includes(band) ? 'failed' : 'answered';
    }
    const [res] = pressFallout(b, { outcome }, P);
    if (res.scale) tally.landed++;
    if (e.story === 'keepAway' && res.scale) tally.keepAwayWeeks += 2;
    if (e.story === 'snitch' && res.scale) tally.tips++;
    b.press = { lastDay: w * 7 };
  }
  tally.reputation = b.state.reputation - startRep;
  return tally;
}

const mean = (xs) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
for (const [label, standing] of [['hostile (-80)', -80], ['hostile (-60)', -61], ['wary (-40)', -40], ['friendly (40)', 40], ['allied (80)', 80]]) {
  const runs = Array.from({ length: SEEDS }, (_, i) => year(standing, i));
  const kinds = {};
  for (const r of runs) for (const [k, n] of Object.entries(r.kinds)) kinds[k] = (kinds[k] ?? 0) + n / SEEDS;
  console.log(`${label.padEnd(14)} stories ${mean(runs.map((r) => r.stories)).toFixed(2)}/yr, landed ${mean(runs.map((r) => r.landed)).toFixed(2)}, Reputation ${mean(runs.map((r) => r.reputation)).toFixed(2)}, keep-away weeks ${mean(runs.map((r) => r.keepAwayWeeks)).toFixed(2)}, tips landed ${mean(runs.map((r) => r.tips)).toFixed(2)}`);
  console.log(`${''.padEnd(14)} by kind: ${Object.entries(kinds).map(([k, n]) => `${k} ${n.toFixed(2)}`).join(', ')}`);
}
