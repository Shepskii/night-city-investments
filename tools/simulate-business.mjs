/**
 * Monte-Carlo calibration harness for player businesses (DESIGN §26.0). Runs without Foundry.
 *
 *   node tools/simulate-business.mjs [--seeds 300] [--periods 120] [--growth 1]
 *
 * For a strong, an average and a weak crew running a side business, prints how many weekly
 * operating periods it takes to register, to charter and to become eligible to list, how many
 * businesses close, and the typical weekly profit when each stage is left. The design target is
 * that a well-run (strong) crew becomes eligible to list in about 30 to 40 periods.
 */

import { CREWS, DEFAULTS, runBusiness } from './business-model.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const SEEDS = Number(arg('seeds', 300));
const PERIODS = Number(arg('periods', 120));
const params = { ...DEFAULTS, growthRate: Number(arg('growth', DEFAULTS.growthRate)) };

const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const fmt = (xs) => (xs.length ? `${quantile(xs, 0.5)} (${quantile(xs, 0.1)}–${quantile(xs, 0.9)})` : '—');
const pct = (n) => `${Math.round((n / SEEDS) * 100)}%`;
const eb = (x) => (x == null ? '—' : `${Math.round(x).toLocaleString('en-US')} eb`);

console.log(`Business growth: ${SEEDS} seeds, up to ${PERIODS} weekly periods, growth rate ${params.growthRate}`);
console.log(`Archetype: ${params.archetype.name}. Periods shown as median (10th–90th percentile), among businesses that got there.\n`);

for (const [name, crew] of Object.entries(CREWS)) {
  const runs = Array.from({ length: SEEDS }, (_, i) => runBusiness(crew, `sim-${i}`, { maxPeriods: PERIODS, params }));
  const reached = (key) => runs.map((r) => r[key]).filter((v) => v != null);
  const profitOn = (stage) => quantile(runs.map((r) => r.profitAt[stage]).filter((v) => v != null), 0.5);
  console.log(`${name} crew`);
  console.log(`  registered:        ${pct(reached('registered').length).padStart(4)}  after ${fmt(reached('registered'))} periods; weekly profit on leaving stage 0: ${eb(profitOn(0))}`);
  console.log(`  chartered:         ${pct(reached('chartered').length).padStart(4)}  after ${fmt(reached('chartered'))} periods; weekly profit on leaving stage 1: ${eb(profitOn(1))}`);
  console.log(`  eligible to list:  ${pct(reached('eligible').length).padStart(4)}  after ${fmt(reached('eligible'))} periods`);
  console.log(`  closed:            ${pct(reached('closed').length).padStart(4)}`);
  console.log(`  weekly profit at the end: median ${eb(quantile(runs.map((r) => r.weekly), 0.5))}\n`);
}
