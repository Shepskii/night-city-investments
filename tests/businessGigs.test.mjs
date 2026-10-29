import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, normalizeBusiness, matchBusiness, planBusinessGig, applyBusinessGig,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const DAY = 20003;
const check = (base, die, dv) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: null }, dv }) });

function clinic(name = 'Back Room Clinic', id = 'b1') {
  let b = applyBusinessRequest({ business: null, request: { key: 'f', type: 'found', name, archetype: 'clinic', cash: 4000 }, actor: MED, day: DAY, context: { approval: false, weekday: 1, newId: id } }).business;
  b = applyBusinessRequest({ business: b, request: { key: 's', type: 'setupRoll', use: { kind: 'skill', skill: 'Cybertech', stat: 'tech' } }, actor: MED, day: DAY, check: check(14, 9, 13), context: { approval: false, weekday: 1 } }).business;
  const out = normalizeBusiness(b);
  delete out.period.event;
  return out;
}

test('a gig is matched to an open player business by a tag, an exact name, or a name inside the client', () => {
  const list = [clinic('Back Room Clinic', 'b1'), clinic('Splice Garage', 'b2')];
  assert.deepEqual(matchBusiness({ client: 'Someone', notes: 'paid by [NCI: b2]' }, list), { businessId: 'b2', how: 'tag' });
  assert.deepEqual(matchBusiness({ client: 'back room clinic' }, list), { businessId: 'b1', how: 'exact' });
  assert.deepEqual(matchBusiness({ client: 'The owner of Splice Garage, Watson' }, list), { businessId: 'b2', how: 'contains' });
  assert.equal(matchBusiness({ client: 'Arasaka' }, list), null);
  assert.equal(matchBusiness({ client: 'Back Room Clinic' }, [{ ...list[0], status: 'closed' }]), null, 'only open businesses');
});

test('a gig moves Reputation at once and next week\'s takings, more for a bigger reward, and a failure hurts more', () => {
  const b = clinic();
  const small = planBusinessGig(b, { outcome: 'done', reward: 500, day: DAY });
  const big = planBusinessGig(b, { outcome: 'done', reward: 4000, day: DAY });
  const failed = planBusinessGig(b, { outcome: 'failed', reward: 2000, day: DAY });
  assert.ok(big.reputation > small.reputation && small.reputation > 0);
  assert.deepEqual([failed.reputation, failed.takings], [-6, -0.1]);

  const done = applyBusinessGig(b, { key: 'g1', outcome: 'done', reward: 2000, day: DAY }).business;
  assert.equal(done.state.reputation, b.state.reputation + 4);
  assert.equal(done.boost, 0.1);
  assert.equal(applyBusinessGig(done, { key: 'g1', outcome: 'done', reward: 2000, day: DAY }).reason, 'duplicate');

  const plain = advanceBusiness(b, b.period.endDay, { weekday: 1 }).business.digests[0];
  const boosted = advanceBusiness(done, done.period.endDay, { weekday: 1 }).business;
  assert.ok(boosted.digests[0].takings > plain.takings);
  assert.equal(boosted.digests[0].boost, 0.1);
  assert.equal(boosted.boost, 0, 'the boost is spent once');
});

test('each gig for the same business within four weeks counts for less', () => {
  let b = clinic();
  b = applyBusinessGig(b, { key: 'g1', outcome: 'done', reward: 2000, day: DAY }).business;
  b = applyBusinessGig(b, { key: 'g2', outcome: 'done', reward: 2000, day: DAY + 3 }).business;
  assert.equal(b.gigs[1].reputation, 2, 'half, after one recent gig');
  assert.equal(planBusinessGig(b, { outcome: 'done', reward: 2000, day: DAY + 40 }).reputation, 4, 'full again a month later');
});
