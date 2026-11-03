/**
 * Calibration for player production (DESIGN §36.10). Runs without Foundry.
 *
 *   node tools/simulate-production.mjs [--seeds 200] [--weeks 52] [--price 0.7] [--limit 0.5] [--bank 4] [--runmax 20]
 *
 * Grows a business with the growth model, holds it at each stage for `weeks`, and runs one line on its
 * benches beside the ordinary trade. For each price category it prints what the line adds to a week's
 * profit, against what that stage earns already, and the weeks a workshop takes to pay for itself.
 * `--bank` is how many weeks of unused sales limit carry over: without any, an item dearer than a
 * week's limit could never sell.
 */

import { createRng } from '../scripts/engine/rng.js';
import { cprD10 } from '../scripts/engine/checks.js';
import { CREWS, DEFAULTS, band, createBusiness, stepPeriod } from './business-model.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const SEEDS = arg('seeds', 200);
const WEEKS = arg('weeks', 52);
const SALE = arg('price', 0.7);
const LIMIT = arg('limit', 0.5);
const BANK = arg('bank', 4);
const RUN_MAX = arg('runmax', 20);

/** The rulebook's Fabrication table: DV, days at the bench per item (8 hours a day), market price, materials. */
const TIERS = [
  { id: 'Everyday', dv: 9, days: 1 / 8, price: 20, materials: 10 },
  { id: 'Costly', dv: 13, days: 6 / 8, price: 50, materials: 20 },
  { id: 'Premium', dv: 17, days: 1, price: 100, materials: 50 },
  { id: 'Expensive', dv: 21, days: 7, price: 500, materials: 100 },
  { id: 'V.Expensive', dv: 24, days: 14, price: 1000, materials: 500 },
  { id: 'Luxury', dv: 29, days: 28, price: 5000, materials: 1000 },
];
const STAGES = [
  { name: 'Shop', benches: 1, workshop: 1500, top: 'Premium' },
  { name: 'Registered', benches: 2, workshop: 4000, top: 'V.Expensive' },
  { name: 'Company', benches: 4, workshop: 12000, top: 'Luxury' },
];
/** The share of a run that comes out sellable, by band. A failure makes nothing and keeps the materials. */
const YIELD = { fumble: 0, failure: 0, narrow: 0.5, solid: 0.75, strong: 0.9, exceptional: 1 };

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const traffic = (rep) => 0.6 + (Math.max(0, Math.min(100, rep)) / 100) * 0.8;

/** The business as this crew has it `extra` weeks after reaching `stage`, or just before it moves on. */
function grown(crew, stage, seed, extra) {
  const b = createBusiness();
  while (b.stage < stage && b.period < 150 && !b.closed) stepPeriod(b, crew, seed, DEFAULTS);
  if (b.stage !== stage || b.closed) return null;
  for (let i = 0; i < extra; i++) {
    const next = structuredClone(b);
    stepPeriod(next, crew, seed, DEFAULTS);
    if (next.stage !== stage || next.closed) break;
    Object.assign(b, next);
  }
  return b;
}

function line(tier, crew, stageDef, b, seed) {
  const rng = createRng(seed, 'production', tier.id);
  const made = (stageDef.benches * 7) / tier.days;
  const takings = DEFAULTS.archetype.takings * b.capacity * traffic(b.reputation);
  const weekLimit = takings * LIMIT;
  const salePrice = tier.price * SALE;
  const banked = weekLimit * Math.max(BANK, 1);
  let stock = 0; let allowance = 0; let due = 0; let net = 0; let sold = 0;
  for (let w = 0; w < WEEKS; w++) {
    // Long items take weeks: bench time adds up, and a run is sized to what could sell, with one roll a run.
    due = Math.min(due + made, Math.max(made, 1));
    const wanted = Math.ceil(Math.max(banked / salePrice, 1)) - stock;
    const run = Math.min(Math.floor(due), Math.max(0, wanted), RUN_MAX);
    if (run >= 1) {
      due -= run;
      const r = cprD10(() => rng.int(1, 10));
      const share = YIELD[band(crew.work + r.total - tier.dv, r.crit)];
      // Only what comes out sellable uses materials: as the book has it, a failure costs the time.
      // A passed roll makes at least one.
      const good = share > 0 ? Math.max(1, Math.floor(run * share)) : 0;
      net -= good * tier.materials;
      stock += good;
    }
    allowance = BANK > 0 ? Math.min(allowance + weekLimit, banked) : weekLimit;
    const selling = Math.min(stock, Math.floor(allowance / salePrice));
    stock -= selling; allowance -= selling * salePrice; net += selling * salePrice; sold += selling;
  }
  return { weekly: net / WEEKS, sold: sold / WEEKS };
}

console.log(`Production: ${SEEDS} seeds, ${WEEKS} weeks, shop sells at ${SALE * 100}% of market, limit ${LIMIT * 100}% of takings, ${BANK} weeks of limit banked`);
const crews = { expert: { ...CREWS.strong, work: 18 }, ...CREWS };
for (const [name, crew] of Object.entries(crews)) {
  console.log(`\n${name} crew (trade roll base ${crew.work})`);
  STAGES.forEach((stageDef, stage) => {
    for (const [when, extra] of [['new', 0], ['mature', 60]]) {
      const businesses = Array.from({ length: SEEDS }, (_, i) => grown(crew, stage, `prod-${i}`, extra)).filter(Boolean);
      if (!businesses.length) continue;
      const ordinary = median(businesses.map((b) => {
        const recent = b.profits.slice(-8);
        return recent.reduce((x, c) => x + c, 0) / Math.max(1, recent.length);
      }));
      console.log(`  ${stageDef.name} ${when}: ${stageDef.benches} bench(es), workshop ${stageDef.workshop} eb, ordinary profit ${Math.round(ordinary)} eb/wk, takings ~${Math.round(median(businesses.map((b) => DEFAULTS.archetype.takings * b.capacity * traffic(b.reputation))))} eb/wk`);
      const top = TIERS.findIndex((t) => t.id === stageDef.top);
      for (const tier of TIERS.slice(0, top + 1)) {
        const runs = businesses.map((b, i) => line(tier, crew, stageDef, b, `line-${i}`));
        const weekly = median(runs.map((r) => r.weekly));
        const pay = weekly > 0 ? Math.round(stageDef.workshop / weekly) : '-';
        console.log(`    ${tier.id.padEnd(12)} DV${String(tier.dv).padEnd(3)} adds ${String(Math.round(weekly)).padStart(6)} eb/wk (${String(Math.round((weekly / Math.max(1, ordinary)) * 100)).padStart(4)}% of ordinary), sells ${median(runs.map((r) => r.sold)).toFixed(1).padStart(5)}/wk, pays back in ${pay} wks`);
      }
    }
  });
}
