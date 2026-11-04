/**
 * Calibration for back room profiles (DESIGN §36.12, proposed). Runs without Foundry.
 *
 *   node tools/simulate-backrooms.mjs [--seeds 400] [--weeks 52] [--capacity 3] [--takings 250] [--base 12]
 *
 * A sensible crew runs a registered business's room for a year, with two action slots: it works the room, launders
 * what it can, pays people off at moderate Exposure and lies low at high. Raids come by Exposure band, as the module
 * rolls them, and a crew that fails or fumbles one pays as the module charges. A room that is shut stays shut. `steady`
 * is every back room as it is today, so the others read against it.
 */

import { createRng } from '../scripts/engine/rng.js';
import { cprD10 } from '../scripts/engine/checks.js';
import { bandOf } from '../scripts/engine/rolls.js';
import { BUSINESS_DEFAULTS as P, exposureBand } from '../scripts/engine/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const SEEDS = arg('seeds', 400);
const WEEKS = arg('weeks', 52);
const CAPACITY = arg('capacity', 3);
const TAKINGS = arg('takings', 250);
const BASE = arg('base', 12);
const DV = 15;

/**
 * What a profile changes. `earn` scales the room's money; `swing` stretches how far the band moves it; `exposure` scales
 * what working it adds; `raid` scales the chance of a raid; `supply` is the share of what it earned spent on stock each
 * week, out of dirty cash; `launder` scales how much can be washed a week; `quietWeek` is Exposure shed in a week worked.
 */
export const PROFILES = {
  steady: { earn: 1, swing: 1, exposure: 1, raid: 1, supply: 0, launder: 1, quietWeek: 0 },
  loud: { earn: 1.5, swing: 1.5, exposure: 1.5, raid: 1.25, supply: 0, launder: 1, quietWeek: 0 },
  quiet: { earn: 0.65, swing: 0.75, exposure: 0.5, raid: 0.5, supply: 0, launder: 1, quietWeek: 0 },
  hungry: { earn: 1.5, swing: 1, exposure: 1.25, raid: 1, supply: 0.25, launder: 1, quietWeek: 0 },
  connected: { earn: 0.5, swing: 1, exposure: 0.75, raid: 1, supply: 0, launder: 1, quietWeek: 0.5 },
  laundering: { earn: 0.8, swing: 1, exposure: 0.75, raid: 1, supply: 0, launder: 2, quietWeek: 0 },
};

const rollBand = (rng, base, dv) => {
  const r = cprD10(() => rng.int(1, 10));
  return bandOf(base + r.total - dv, r.crit);
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function year(profile, seed) {
  const rng = createRng(seed, 'back-room');
  const r = P.backRoom;
  const takings = TAKINGS * CAPACITY;
  let dirty = 0; let exposure = 0; let open = true;
  const t = { earned: 0, washed: 0, paidOff: 0, supply: 0, fines: 0, seized: 0, raids: 0, weeksShut: 0, exposureSum: 0, shutAt: null };
  for (let w = 0; w < WEEKS; w++) {
    if (!open) { t.weeksShut += 1; continue; }
    t.exposureSum += exposure;
    // A raid comes first, and takes the week's answer: a slot.
    let slots = 2;
    if (rng.chance(Math.min(1, r.raid.chance[exposureBand(exposure)] * profile.raid))) {
      t.raids += 1;
      slots -= 1;
      const band = rollBand(rng, BASE, DV);
      if (band === 'fumble') {
        t.seized += dirty; dirty = 0; t.fines += r.raid.fineLost; open = false; t.shutAt = w;
      } else if (band === 'failure') {
        const taken = Math.floor(dirty * r.raid.failShare);
        t.seized += taken; dirty -= taken; t.fines += r.raid.fineFail;
        if (exposureBand(exposure) === 'high') { open = false; t.shutAt = w; }
      } else {
        exposure = Math.max(0, exposure - r.raid.winClear);
      }
      if (!open) continue;
    }
    const heat = exposureBand(exposure);
    // At high Exposure it stops work: lie low, and pay someone if there is the money. Otherwise work, then clean up.
    if (heat === 'high') {
      exposure = Math.max(0, exposure - r.lieLow);
      slots -= 1;
    } else if (slots > 0) {
      const band = rollBand(rng, BASE, DV);
      const scale = 1 + (P.effects.work[band] - 1) * profile.swing;
      const earned = band === 'fumble' ? 0 : Math.round(TAKINGS * CAPACITY * r.share * scale * profile.earn);
      const supply = Math.round(earned * profile.supply);
      dirty += earned - supply;
      t.earned += earned; t.supply += supply;
      exposure = Math.max(0, exposure + r.workExposure[band] * profile.exposure - profile.quietWeek);
      slots -= 1;
    }
    if (slots > 0 && ['moderate', 'high'].includes(heat) && dirty >= r.payOff[1]) {
      const band = rollBand(rng, BASE, DV);
      dirty -= r.payOff[1]; t.paidOff += r.payOff[1];
      exposure = Math.max(0, exposure + r.payOffExposure[band]);
    } else if (slots > 0 && dirty > 0) {
      const band = rollBand(rng, BASE, DV);
      const washed = Math.min(dirty, Math.round(takings * r.launderCap * profile.launder * r.launderShare[band]));
      dirty -= washed; t.washed += washed;
      exposure += r.launderExposure[band];
    }
  }
  return { ...t, dirtyLeft: dirty, exposureEnd: exposure, open, avgExposure: t.exposureSum / Math.max(1, WEEKS - t.weeksShut) };
}

const eb = (n) => `${Math.round(n).toLocaleString('en-US')}`.padStart(6);
console.log(`Back room profiles: ${SEEDS} years, ${WEEKS} weeks, Capacity ${CAPACITY}, ${TAKINGS} eb base takings, roll base ${BASE} against DV ${DV}`);
console.log('profile     earned/wk  clean/wk  kept/wk*  fines+seized/yr  raids/yr  avg Exp  shut within a year');
for (const [name, profile] of Object.entries(PROFILES)) {
  const runs = Array.from({ length: SEEDS }, (_, i) => year(profile, `${name}-${i}`));
  const kept = runs.map((x) => x.washed + x.dirtyLeft);
  console.log(`${name.padEnd(11)} ${eb(mean(runs.map((x) => x.earned)) / WEEKS)}    ${eb(mean(runs.map((x) => x.washed)) / WEEKS)}    ${eb(mean(kept) / WEEKS)}          ${eb(mean(runs.map((x) => x.fines + x.seized)))}     ${mean(runs.map((x) => x.raids)).toFixed(1).padStart(4)}    ${mean(runs.map((x) => x.avgExposure)).toFixed(0).padStart(4)}     ${String(Math.round((runs.filter((x) => !x.open).length / SEEDS) * 100)).padStart(3)}%`);
}
console.log('* what the crew ended up with a week: laundered, plus dirty cash still in hand, after supply, pay-offs, seizures.');
