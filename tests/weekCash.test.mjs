import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBusinessRequest, advanceBusiness, normalizeBusiness, proposalOutcome } from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';
import { isCharacter, isItemPile } from '../scripts/utils/helpers.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const MONDAY = 1;
const DAY = 20003;
const check = (base, die, dv) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: null }, dv, levers: {} }) });

function apply(business, request, actor, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: `k${Math.random()}`, ...request }, actor, day: extra.day ?? DAY, check: extra.check,
    context: { approval: false, weekday: MONDAY, actors: { med: 'Medtech', fix: 'Fixer' }, newId: 'b1', growthRate: 1 },
  });
  assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

function clinic() {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 3000, invite: ['fix'] }, MED).business;
  b = apply(b, { type: 'join', businessId: 'b1', cash: 1500 }, FIX).business;
  return apply(b, { type: 'setupRoll', businessId: 'b1', use: { kind: 'skill', skill: 'Cybertech', stat: 'tech' } }, MED, { check: check(14, 9, 13) }).business;
}

test('each week keeps the cash it started with, and its digest the wages paid', () => {
  let b = clinic();
  assert.equal(b.period.opening, b.till, 'the first week starts with the cash at opening');
  const staff = { id: 'stf_a', actorId: null, name: 'Hand', source: 'recruit', post: 'floor', bases: { 'skill:Paramedic': 12 }, pct: 1, wage: 108, hiredDay: DAY, status: 'active', owed: 30, loyalty: 50, candidateId: 'a' };
  b = normalizeBusiness({ ...b, staff: [staff] });
  delete b.period.event;
  // A draw-like payment during the week moves the cash; the digest must account for it.
  const opening = b.period.opening;
  b.till -= 25;
  const out = advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test' });
  const d = out.events.find((e) => e.type === 'periodClosed').digest;
  assert.equal(d.opening, opening);
  assert.ok(d.paid >= d.wages, 'back pay owed goes out with the week\'s wages');
  const other = d.till - d.opening - d.takings + d.upkeep + d.paid;
  assert.equal(other, -25 - (d.interest ?? 0) - (d.repaid ?? 0) - (d.event?.cost ?? 0), 'what is left over is exactly the other money in and out');
  assert.equal(out.business.period.opening, d.till, 'the next week starts where this one closed');
});

test('a proposal carried by the request itself says what happened', () => {
  assert.equal(proposalOutcome([]), null);
  assert.deepEqual(proposalOutcome([{ type: 'proposalPassed', kind: 'hire' }, { type: 'hired', staffId: 's' }]), { outcome: 'passed', kind: 'hire', detail: 'hired' });
  assert.deepEqual(proposalOutcome([{ type: 'proposalPassed', kind: 'hire' }, { type: 'jobOffered', staffId: 's' }]), { outcome: 'passed', kind: 'hire', detail: 'jobOffered' });
  assert.deepEqual(proposalOutcome([{ type: 'proposalPassed', kind: 'pay' }, { type: 'payChanged' }]), { outcome: 'passed', kind: 'pay' });
  assert.deepEqual(proposalOutcome([{ type: 'proposalPassed', kind: 'project' }, { type: 'proposalVoid', kind: 'project', reason: 'no-funds' }]), { outcome: 'void', kind: 'project', reason: 'no-funds' });
  assert.deepEqual(proposalOutcome([{ type: 'proposalFailed', kind: 'fire' }]), { outcome: 'failed', kind: 'fire' });
  // The Medtech's majority hires an applicant at once.
  let b = clinic();
  b = normalizeBusiness({ ...b, stage: 1, candidates: [{ id: 'c1', name: 'Ana', post: 'floor', level: 'skilled', base: 12, pct: 1, expires: DAY + 7 }] });
  const out = apply(b, { type: 'propose', businessId: 'b1', kind: 'hire', candidateId: 'c1' }, MED);
  const settled = proposalOutcome(out.events);
  assert.deepEqual(settled, { outcome: 'passed', kind: 'hire', detail: 'hired' });
});

test('an Item Piles pile made from a character is not a person', () => {
  const pile = { type: 'character', flags: { 'item-piles': { data: { enabled: true, type: 'pile' } } } };
  assert.equal(isItemPile(pile), true);
  assert.equal(isCharacter(pile), false);
  assert.equal(isCharacter({ type: 'character', flags: { 'item-piles': { data: { enabled: false } } } }), true, 'a pile switched off is a character again');
  assert.equal(isCharacter({ type: 'character', flags: {} }), true);
  assert.equal(isCharacter({ type: 'container' }), false);
});
