/**
 * Calibration for NPC-owned companies (N0, DESIGN §36.17, proposed). Runs without Foundry.
 *
 *   node tools/simulate-npc-company.mjs [--seeds 300] [--weeks 52] [--base 12] [--answer 1]
 *
 * Runs the module's real weekly close for a year at each stage, with each candidate running profile choosing the
 * week's actions and rolling them from the seed. The baseline is what a business does today with nobody at the
 * controls but a manager. Then what a player's job is worth against running a business, and what a company costs in
 * engine time. No corporations are hostile and nothing is listed, so press, raids and price do not come into it.
 */

import { BUSINESS_DEFAULTS as P, ARCHETYPES, advanceBusiness, applyBusinessRequest, normalizeBusiness, resolveRoll, createRng, stageDv, enactHire, wageOf } from '../scripts/engine/index.js';
import { cprD10 } from '../scripts/engine/checks.js';
import { bandOf } from '../scripts/engine/rolls.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const SEEDS = arg('seeds', 300);
const WEEKS = arg('weeks', 52);
const BASE = arg('base', 12);
const ANSWER = arg('answer', 1);
const DAY = 20003;
const OWNER = { id: 'owner', name: 'Owner', wealth: 500000 };
const STAGES = ['side business', 'registered', 'company'];

/** Where a company of each stage starts: Capacity, cash, and who it employs. */
const START = [
  { capacity: 1, till: 1500, staff: [['floor', 10]] },
  { capacity: 3, till: 5000, staff: [['manager', 12], ['floor', 11], ['floor', 11]] },
  { capacity: 8, till: 25000, staff: [['manager', 13], ['floor', 12], ['floor', 12], ['floor', 12], ['bookkeeper', 12], ['sales', 12], ['security', 12]] },
];
const OFFICE = ['contracts'];

/** What each profile does with the week's slots, first choice first: shop actions, then a company's. */
const PROFILES = {
  'manager only (today)': { shop: [], company: [] },
  Steady: { shop: ['work', 'keepSafe', 'promote'], company: [...OFFICE, 'books', 'permits'] },
  Growing: { shop: ['work', 'promote', 'fixUp'], company: [...OFFICE, 'relations', 'books'] },
  'Cost-cutting': { shop: ['work', 'source', 'keepSafe'], company: [...OFFICE, 'books', 'relations'] },
  Shady: { shop: ['work', 'source', 'promote'], company: [...OFFICE, 'shortcuts', 'relations'] },
  // With a target: above it, what would win Reputation gives way to something else.
  'Growing, target 70': { shop: ['work', 'promote', 'fixUp'], company: [...OFFICE, 'relations', 'books'], target: 70, shopFill: 'keepSafe', companyFill: 'permits' },
  'Cost-cutting, target 60': { shop: ['work', 'source', 'keepSafe'], company: [...OFFICE, 'books', 'relations'], target: 60, shopFill: 'keepSafe', companyFill: 'permits' },
  'Shady, target 60': { shop: ['work', 'source', 'promote'], company: [...OFFICE, 'shortcuts', 'relations'], target: 60, shopFill: 'keepSafe', companyFill: 'permits' },
};
const WINS_REPUTATION = ['promote', 'relations'];

const check = (base, die, dv) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: null }, dv }) });
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];
const eb = (x) => Math.round(x).toLocaleString('en-US').padStart(9);
const pct = (x) => `${Math.round(x * 100)}%`.padStart(5);

function found(seed) {
  const apply = (business, request, chk) => applyBusinessRequest({
    business, request: { key: `k${Math.random()}`, ...request }, actor: OWNER, day: DAY, check: chk,
    context: { approval: false, weekday: 1, actors: {}, newId: 'b1', seed },
  });
  const made = apply(null, { type: 'found', name: 'NPC Co', archetype: 'clinic', cash: 4000 }).business;
  return apply(made, { type: 'setupRoll', businessId: 'b1', use: ARCHETYPES.clinic.trade[0] }, check(14, 9, 13)).business;
}

function company(stage, seed) {
  const s = START[stage];
  const b = normalizeBusiness({ ...found(seed), till: s.till, stage });
  b.state.capacity = s.capacity;
  b.state.reputation = 50;
  if (stage >= 1) b.state.compliance = 50;
  delete b.period.event;
  s.staff.forEach(([post, base], i) => {
    b.candidates = [{ id: `c${i}`, name: `Staff ${i}`, post, base, pct: 1, expires: DAY + 9999 }];
    const done = enactHire(b, { candidateId: `c${i}`, post, pct: 1 }, DAY, {});
    if (!done.ok) throw new Error(`hire ${post} at stage ${stage}: ${done.reason}`);
  });
  return b;
}

function slot(b, rng, action, extra = {}) {
  const roll = cprD10(() => rng.int(1, 10));
  const dv = stageDv(b.stage);
  return { action, by: OWNER.id, use: 'skill', approach: 'standard', luck: 0, bonus: 0, band: bandOf(BASE + roll.total - dv, roll.crit), total: BASE + roll.total, dv, ...extra };
}

function plan(b, rng, profile) {
  const count = P.stages[b.stage]?.slots ?? 1;
  const over = profile.target != null && b.state.reputation >= profile.target;
  const fill = b.stage >= 2 ? profile.companyFill : profile.shopFill;
  const actions = (b.stage >= 2 ? profile.company : profile.shop).slice(0, count).map((a) => (over && WINS_REPUTATION.includes(a) ? fill : a));
  if (!actions.length) return;
  // An event takes the last of the week's slots.
  const event = b.period.event;
  if (event && rng.chance(ANSWER)) actions[actions.length - 1] = null;
  b.period.slots.push(...actions.map((a) => (a ? slot(b, rng, a) : slot(b, rng, 'respond', { event: event.kind }))));
}

function year(stage, profile, i) {
  const seed = `n0-${stage}-${i}`;
  const rng = createRng(seed, 'plan');
  let b = company(stage, seed);
  const start = b.till;
  const profits = [];
  let weeks = 0;
  for (let w = 0; w < WEEKS && b.status === 'open'; w++) {
    plan(b, rng, profile);
    const before = b.period.index;
    b = advanceBusiness(b, b.period.endDay, { weekday: 1, seed, relations: null }).business;
    if (b.period?.index === before && b.status === 'open') throw new Error('the week did not close');
    profits.push(b.digests.at(-1)?.profit ?? 0);
    weeks += 1;
  }
  return { change: b.till - start, broke: b.status !== 'open' || b.till < 0, owed: (b.staff ?? []).reduce((a, s) => a + (s.owed ?? 0), 0) > 0, profit: profits.reduce((a, x) => a + x, 0) / Math.max(1, weeks), reputation: b.state.reputation, wages: (b.staff ?? []).reduce((a, s) => a + wageOf(b, s), 0) };
}

console.log(`NPC companies: ${SEEDS} seeds, ${WEEKS} weeks, owner base ${BASE}, events answered ${pct(ANSWER).trim()}`);
const results = {};
for (const stage of [0, 1, 2]) {
  console.log(`\n${STAGES[stage]}  (DV ${stageDv(stage)}, ${P.stages[stage].slots} slot(s) a week)`);
  console.log('  profile                 profit/wk  cash change (10th, median, 90th)         broke   owes  Rep end');
  for (const [name, profile] of Object.entries(PROFILES)) {
    const runs = Array.from({ length: SEEDS }, (_, i) => year(stage, profile, i));
    const change = runs.map((r) => r.change);
    const profit = quantile(runs.map((r) => r.profit), 0.5);
    results[`${stage}:${name}`] = { profit, wages: runs[0].wages };
    console.log(`  ${name.padEnd(22)} ${eb(profit)}  ${eb(quantile(change, 0.1))} ${eb(quantile(change, 0.5))} ${eb(quantile(change, 0.9))}   ${pct(runs.filter((r) => r.broke).length / SEEDS)}  ${pct(runs.filter((r) => r.owed).length / SEEDS)}  ${Math.round(runs.reduce((a, r) => a + r.reputation, 0) / SEEDS)}`);
  }
}

// ── A player's job ───────────────────────────────────────────────────────────
/** A share of a week's wage for each band of a shift. Starting numbers, for this run to judge. */
const SHIFT = { fumble: 0, failure: 0, narrow: 0.1, solid: 0.25, strong: 0.4, exceptional: 0.5 };
console.log('\nA player\'s job for a year, against owning (a floor job at the going rate; bonus from the weekly shift, no Luck)');
console.log('  stage           base  wage/wk  bonus/wk  job/yr     owner profit/wk (Steady)  job as share of owning');
for (const stage of [0, 1, 2]) {
  for (const base of [9, 12, 15]) {
    const b = company(stage, 'job');
    b.staff = [];
    b.candidates = [{ id: 'pc', name: 'PC', post: 'floor', base, pct: 1, expires: DAY + 9999 }];
    enactHire(b, { candidateId: 'pc', post: 'floor', pct: 1 }, DAY, {});
    const wage = wageOf(b, b.staff[0]);
    const rng = createRng('shift', stage, base);
    let bonus = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const roll = cprD10(() => rng.int(1, 10));
      bonus += SHIFT[bandOf(base + roll.total - stageDv(stage), roll.crit)] * wage;
    }
    bonus /= n;
    const owner = results[`${stage}:Steady`].profit;
    console.log(`  ${STAGES[stage].padEnd(14)} ${String(base).padStart(4)} ${eb(wage)} ${eb(bonus)} ${eb((wage + bonus) * WEEKS)}  ${eb(owner)}                 ${owner > 0 ? pct((wage + bonus) / owner) : '   —'}`);
  }
}

// ── Engine time ──────────────────────────────────────────────────────────────
const started = performance.now();
const runs = 200;
for (let i = 0; i < runs; i++) year(2, PROFILES.Steady, 100000 + i);
const each = (performance.now() - started) / (runs * WEEKS);
console.log(`\nEngine time: ${each.toFixed(2)} ms for one company-week at the largest stage, without saving it.`);
