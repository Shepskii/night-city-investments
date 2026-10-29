/**
 * Calibration on the real business engine (DESIGN §26.9, "every phase finishes with a simulator
 * check"). Runs without Foundry.
 *
 *   node tools/simulate-engine.mjs [--seeds 300] [--weeks 80] [--growth 1] [--archetype clinic] [--district ""]
 *
 * Unlike tools/simulate-business.mjs, which runs the B0 prototype, this plays a business through
 * scripts/engine/business.js week by week, with the same strong, average and weak crews: a partner's
 * complementary check, answering the week's event when there is one, working the shop, using the
 * second slot once registered, expansions with business days, registering when the milestones are
 * met, and draws. It reports how many weeks it takes to register, the weekly profit on registering,
 * and how many businesses close.
 */

import { CREWS } from './business-model.mjs';
import {
  applyBusinessRequest, advanceBusiness, milestones, activeProject, expansionOffer, normalizeBusiness, BUSINESS_DEFAULTS, ARCHETYPES,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';
import { cprD10 } from '../scripts/engine/checks.js';
import { createRng } from '../scripts/engine/rng.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const SEEDS = Number(arg('seeds', 300));
const WEEKS = Number(arg('weeks', 80));
const GROWTH = Number(arg('growth', 1));
const ARCHETYPE = arg('archetype', 'clinic');
const DISTRICT = arg('district', '');
const START = 20003; // a Monday
const ME = { id: 'owner', name: 'Owner' };

/** One player business run by `crew` for up to WEEKS weeks. */
export function runEngine(crew, seed, { weeks = WEEKS, growthRate = GROWTH, archetype = ARCHETYPE, district = DISTRICT } = {}) {
  const rng = createRng(seed, 'engine-sim');
  let n = 0;
  const roll = (base, dv) => ({ ok: true, result: resolveRoll({ base, roll: cprD10(() => rng.int(1, 10)), dv }) });
  const ctx = { approval: false, weekday: 1, newId: 'sim', seed, growthRate, actors: { owner: 'Owner' } };
  let day = START;
  const send = (business, request, check = null) => {
    const out = applyBusinessRequest({ business, request: { key: `k${n++}`, ...request }, actor: { ...ME, wealth: 1e9 }, day, check, context: ctx });
    return out.ok ? out.business : business;
  };

  // The B0 prototype's start: 1,500 eb of gear and 1,500 eb in the till, at Capacity 1.
  const trade = ARCHETYPES[archetype].trade[0];
  ctx.gear = [{ name: 'Kit', value: 1500 }];
  let b = send(null, { type: 'found', name: 'Sim', archetype, district, cash: 1500 });
  ctx.gear = [];
  b = send(b, { type: 'setupRoll', use: trade }, { ok: true, result: resolveRoll({ base: 30, roll: { total: 5, crit: null }, dv: 13 }) });
  b = normalizeBusiness({ ...b, till: 1500, assets: 1500 });
  b.state.capacity = 1;

  const result = { registered: null, closed: null, profitAtRegistration: null };
  for (let week = 0; week < weeks && b.status === 'open'; week++) {
    const stage = BUSINESS_DEFAULTS.stages[b.stage];
    const dv = b.stage ? 15 : 13;

    // A partner's complementary check for the work, then the event if there is one, then the shop.
    const help = roll(crew.support, 13);
    if (help.result.success) b.period.bonuses.push({ id: `h${week}`, action: 'work', by: 'owner', used: false });
    if (b.period.event) b = send(b, { type: 'respond', use: trade }, roll(crew.admin, dv));
    if (b.period.slots.length < stage.slots) {
      const bonus = b.period.bonuses.some((x) => !x.used) ? 1 : 0;
      const r = roll(crew.work + bonus, dv);
      b = send(b, { type: 'action', action: 'work', use: trade }, r);
    }
    // A registered business's second slot goes where the business most needs it.
    if (b.period.slots.length < stage.slots) {
      const [action, base] = b.state.reputation < 70 ? ['promote', crew.promote] : b.state.capacity < stage.capacityCap ? ['fixUp', crew.fixUp] : ['source', crew.source];
      const use = action === 'promote' ? { kind: 'skill', skill: 'Persuasion', stat: 'cool' } : action === 'fixUp' ? { kind: 'skill', skill: 'Basic Tech', stat: 'tech' } : { kind: 'skill', skill: 'Trading', stat: 'cool' };
      b = send(b, { type: 'action', action, use }, roll(base, dv));
    }

    // Expansion: a crew reinvests once the till covers it with a reserve, and puts its days in.
    const offer = expansionOffer(b);
    if (!activeProject(b) && offer.ok && b.till >= offer.cost * 1.2) b = send(b, { type: 'propose', kind: 'expansion' });
    const project = activeProject(b);
    if (project) b = send(b, { type: 'addDays', projectId: project.id, days: Math.min(BUSINESS_DEFAULTS.businessDays, project.daysNeeded - project.days) });

    // Register as soon as the milestones allow.
    if (b.stage === 0 && milestones(b).met) {
      if (!b.stepUp?.approved) b = send(b, { type: 'propose', kind: 'stepUp' });
      if (b.stepUp?.approved && (b.stepUp.retryDay == null || day >= b.stepUp.retryDay)) {
        b = send(b, { type: 'stepUpRoll', use: { kind: 'skill', skill: 'Bureaucracy', stat: 'int' } }, roll(crew.admin, 15));
        if (b.stage === 1 && result.registered == null) {
          result.registered = week + 1;
          const recent = b.digests.slice(-4);
          result.profitAtRegistration = recent.reduce((a, d) => a + d.profit, 0) / recent.length;
        }
      }
    }

    // Close the week, then draw the crew's share of the profit.
    day = b.period.endDay;
    const out = advanceBusiness(b, day, { weekday: 1, growthRate, seed });
    b = out.business;
    if (b.status === 'closed') {
      result.closed = week + 1;
      break;
    }
    const last = b.digests.at(-1);
    const draw = last.profit > 0 ? Math.floor(last.profit * crew.drawShare) : 0;
    if (draw > 0) b = send(b, { type: 'draw', amount: Math.min(draw, b.till) });
  }
  result.weekly = b.digests.slice(-4).reduce((a, d) => a + d.profit, 0) / Math.max(1, b.digests.slice(-4).length);
  result.final = b;
  return result;
}

const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const fmt = (xs) => (xs.length ? `${quantile(xs, 0.5)} (${quantile(xs, 0.1)}–${quantile(xs, 0.9)})` : '—');
const pct = (k) => `${Math.round((k / SEEDS) * 100)}%`;
const eb = (x) => (x == null ? '—' : `${Math.round(x).toLocaleString('en-US')} eb`);

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('simulate-engine.mjs')) {
  console.log(`Business engine: ${SEEDS} seeds, up to ${WEEKS} weeks, growth rate ${GROWTH}, ${ARCHETYPE}${DISTRICT ? ` in ${DISTRICT}` : ''}`);
  console.log('Weeks shown as median (10th–90th percentile), among businesses that got there.\n');
  for (const [name, crew] of Object.entries(CREWS)) {
    const runs = Array.from({ length: SEEDS }, (_, i) => runEngine(crew, `sim-${i}`));
    const registered = runs.map((r) => r.registered).filter((v) => v != null);
    const closed = runs.filter((r) => r.closed != null).length;
    console.log(`${name} crew`);
    console.log(`  registered: ${pct(registered.length).padStart(4)}  after ${fmt(registered)} weeks; weekly profit then: ${eb(quantile(runs.map((r) => r.profitAtRegistration).filter((v) => v != null), 0.5))}`);
    console.log(`  closed:     ${pct(closed).padStart(4)}`);
    console.log(`  weekly profit at the end: median ${eb(quantile(runs.map((r) => r.weekly), 0.5))}\n`);
  }
}
