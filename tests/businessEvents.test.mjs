import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, rollSpec, normalizeBusiness, drawEvent, eventChance, eventUses, SKILLS, ARCHETYPES, DISTRICTS, BUSINESS_DEFAULTS,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const MONDAY = 1;
const DAY = 20003;
const check = (base, die, dv) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv }) });
const cybertech = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };

function apply(business, request, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: `k${Math.random()}`, ...request }, actor: MED, day: DAY, check: extra.check,
    context: { approval: false, weekday: MONDAY, actors: {}, newId: 'b1', seed: 'test', ...extra.context },
  });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/** An open clinic, optionally in a district, with this week's event set by hand. */
function clinic({ district = '', event = null, archetype = 'clinic' } = {}) {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype, district, cash: 4000 }).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: ARCHETYPES[archetype].trade[0] }, { check: check(14, 9, 13) }).business;
  const out = normalizeBusiness({ ...b, till: 3000 });
  out.state.capacity = 1;
  if (event) out.period.event = { kind: event };
  else delete out.period.event;
  return out;
}

const closeWeek = (b) => advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test' });

test('the same week of the same business always draws the same event', () => {
  const b = clinic();
  const draws = Array.from({ length: 40 }, (_, i) => drawEvent({ ...b, period: { ...b.period, index: i + 1 } }, 'test')?.kind ?? null);
  assert.deepEqual(draws, Array.from({ length: 40 }, (_, i) => drawEvent({ ...b, period: { ...b.period, index: i + 1 } }, 'test')?.kind ?? null));
  assert.ok(draws.some(Boolean) && draws.some((d) => d === null), 'some weeks have one, some do not');
  assert.ok(!draws.includes('inspection'), 'no inspections before a business is registered');
});

test('a dangerous district has more trouble, and a registered business a little less', () => {
  const ocz = clinic({ district: 'ocz' });
  const exec = clinic({ district: 'exec' });
  assert.ok(eventChance(ocz) > eventChance(clinic()) && eventChance(clinic()) > eventChance(exec));
  assert.ok(eventChance({ ...ocz, stage: 1 }) < eventChance(ocz));
  const hits = (b) => Array.from({ length: 400 }, (_, i) => drawEvent({ ...b, period: { ...b.period, index: i } }, 'stats')).filter(Boolean).length;
  assert.ok(hits(ocz) > hits(exec) * 2, `${hits(ocz)} against ${hits(exec)}`);
});

test('an unanswered event costs 15% of the week\'s takings and leaves its mark', () => {
  const calm = closeWeek(clinic()).business.digests[0];
  const rival = closeWeek(clinic({ event: 'rival' })).business;
  const d = rival.digests[0];
  assert.equal(d.event.outcome, 'unanswered');
  assert.equal(d.takings, calm.takings - Math.round(calm.takings * 0.15));
  assert.ok(rival.state.reputation < closeWeek(clinic()).business.state.reputation, 'Reputation down');
});

test('answering takes a slot and a roll: a success avoids the loss, a failure costs less, a fumble more', () => {
  const b = clinic({ event: 'breakdown' });
  assert.ok(eventUses(b, 'breakdown').some((u) => u.skill === 'Cybertech'), 'the trade\'s own skills can fix its kit');
  const spec = rollSpec(b, { type: 'respond', use: SKILLS.basicTech }, 'med', { day: DAY });
  assert.equal(spec.ok, true);
  const answered = apply(b, { type: 'respond', businessId: 'b1', use: SKILLS.basicTech }, { check: check(10, 6, 13) }).business;
  assert.equal(rollSpec(answered, { type: 'action', action: 'work', use: cybertech }, 'med', { day: DAY }).reason, 'no-slot', 'the side business\'s only slot is used');
  const base = closeWeek(clinic()).business.digests[0].takings;
  // Unworked in each case, so the takings differ only by the event.
  assert.equal(closeWeek(answered).business.digests[0].takings, base);
  const failed = closeWeek(apply(b, { type: 'respond', businessId: 'b1', use: SKILLS.basicTech }, { check: check(5, 5, 13) }).business).business;
  assert.equal(failed.digests[0].takings, base - Math.round(base * 0.1));
  const fumbled = closeWeek(apply(b, { type: 'respond', businessId: 'b1', use: SKILLS.basicTech }, { check: check(5, -2, 13) }).business).business;
  assert.equal(fumbled.digests[0].event.outcome, 'fumbled');
  assert.equal(fumbled.digests[0].takings, base - Math.round(base * 0.2));
});

test('a successful Keep it safe deals with a shakedown or a break-in too', () => {
  const b = apply(clinic({ event: 'shakedown' }), { type: 'action', businessId: 'b1', action: 'keepSafe', use: SKILLS.tactics }, { check: check(10, 6, 13) }).business;
  assert.equal(closeWeek(b).business.digests[0].event.outcome, 'covered');
  const rival = apply(clinic({ event: 'rival' }), { type: 'action', businessId: 'b1', action: 'keepSafe', use: SKILLS.tactics }, { check: check(10, 6, 13) }).business;
  assert.equal(closeWeek(rival).business.digests[0].event.outcome, 'unanswered', 'but not a rival');
});

test('a big order pays only when it is answered well', () => {
  const base = closeWeek(clinic()).business.digests[0].takings;
  assert.equal(closeWeek(clinic({ event: 'windfall' })).business.digests[0].takings, base, 'ignored, nothing is lost');
  const taken = apply(clinic({ event: 'windfall' }), { type: 'respond', businessId: 'b1', use: SKILLS.business }, { check: check(10, 6, 13) }).business;
  const d = closeWeek(taken).business.digests[0];
  assert.equal(d.event.outcome, 'windfall');
  assert.equal(d.takings, base + Math.round(base * 0.15));
});

test('districts change takings, rent and protection', () => {
  const plain = closeWeek(clinic()).business.digests[0];
  const exec = closeWeek(clinic({ district: 'exec' })).business.digests[0];
  const ocz = closeWeek(clinic({ district: 'ocz' })).business.digests[0];
  assert.ok(exec.takings > plain.takings && plain.takings > ocz.takings);
  assert.ok(exec.upkeep > plain.upkeep, 'Executive Zone rent');
  assert.equal(Object.keys(DISTRICTS).length, 20);
  assert.equal(apply(null, { type: 'found', name: 'X', archetype: 'clinic', district: 'atlantis', cash: 0 }).business.district, '', 'an unknown district is none');
});

test('all ten archetypes can be founded, and Moto sources supplies', () => {
  assert.equal(Object.keys(ARCHETYPES).length, 10);
  for (const id of Object.keys(ARCHETYPES)) assert.equal(clinic({ archetype: id }).status, 'open', id);
  assert.equal(rollSpec(clinic(), { type: 'action', action: 'source', use: { kind: 'ability', ability: 'Moto' } }, 'med', { day: DAY }).ok, true);
  assert.equal(BUSINESS_DEFAULTS.events.chance, 0.25);
});
