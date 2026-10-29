import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [['Medtech', 4000, true]] });
const [med] = env.actors;
game.users = Object.assign([{ id: 'gm1', isGM: true }], { activeGM: { id: 'gm1' }, get: () => null });

let S;
let engine;
before(async () => {
  engine = await import('../scripts/engine/index.js');
  S = {
    Gigs: (await import('../scripts/services/GigImpactService.js')).GigImpactService,
    Repo: (await import('../scripts/data/BusinessRepository.js')).BusinessRepository,
  };
  const { resolveRoll } = await import('../scripts/engine/rolls.js');
  const day = Math.floor(env.clock.ms / 86_400_000);
  const ctx = { approval: false, weekday: 1, newId: 'bus_clinic' };
  let b = engine.applyBusinessRequest({ business: null, request: { key: 'f', type: 'found', name: 'Back Room Clinic', archetype: 'clinic', cash: 3000 }, actor: { id: med.id, name: 'Medtech', wealth: 4000 }, day, context: ctx }).business;
  b = engine.applyBusinessRequest({
    business: b, request: { key: 's', type: 'setupRoll', use: { kind: 'skill', skill: 'Cybertech', stat: 'tech' } }, actor: { id: med.id, name: 'Medtech', wealth: 0 }, day,
    check: { ok: true, result: resolveRoll({ base: 14, roll: { total: 9, crit: null }, dv: 13 }) }, context: ctx,
  }).business;
  await S.Repo.save(b);
});

const clinic = () => S.Repo.get('bus_clinic');

test('a gig for a players\' business waits for the GM in its own place, then changes the business', async () => {
  const before = clinic().state.reputation;
  const out = await S.Gigs.report({ gigId: 'g1', outcome: 'done', client: 'Back Room Clinic', reward: 2000, title: 'Patch up a VIP' });
  assert.deepEqual([out.status, out.businessId], ['pending', 'bus_clinic']);
  const queued = (await import('../scripts/data/MarketStore.js')).MarketStore.getGigs().pending[0];
  assert.equal(queued.kind, 'business');
  assert.equal(queued.reputation, 4, 'the planned effect is shown before approval');
  assert.equal(clinic().state.reputation, before, 'nothing happens yet');

  const approved = await S.Gigs.approveBusiness(queued.id);
  assert.equal(approved.status, 'applied');
  assert.equal(clinic().state.reputation, before + 4);
  assert.equal(clinic().boost, 0.1);
  const history = (await import('../scripts/data/MarketStore.js')).MarketStore.getGigs().history.at(-1);
  assert.deepEqual([history.status, history.businessId, history.reputation], ['applied', 'bus_clinic', 4]);
});

test('with approval off it applies at once, and the same gig is never counted twice', async () => {
  env.store.set('gigImpactApproval', false);
  const before = clinic().state.reputation;
  const out = await S.Gigs.report({ gigId: 'g2', outcome: 'failed', notes: 'for [NCI: bus_clinic]', client: 'A stranger', reward: 2000 });
  assert.equal(out.status, 'applied');
  assert.equal(clinic().state.reputation, before - 3, 'a failure, at half strength after a recent gig');
  assert.equal((await S.Gigs.report({ gigId: 'g2', outcome: 'failed', notes: 'for [NCI: bus_clinic]', client: 'A stranger', reward: 2000 })).status, 'duplicate');
});
