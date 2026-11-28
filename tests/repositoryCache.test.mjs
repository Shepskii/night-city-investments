import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

// The business and syndicate repositories answer from a cache cleared by the journal hooks: these
// check that what they answer is always what is in the journals, read afresh.
const env = installFakeFoundry({ actors: [['Alice', 1000, true]] });
const MOD = 'night-city-investments';

let BusinessRepository, SyndicateRepository;
before(async () => {
  ({ BusinessRepository } = await import('../scripts/data/BusinessRepository.js'));
  ({ SyndicateRepository } = await import('../scripts/data/SyndicateRepository.js'));
});

const names = (list) => list.map((r) => r.name);
const businessJournal = (id) => game.journal.find((j) => j.getFlag(MOD, 'business')?.[0]?.id === id);
const syndicateJournal = (id) => game.journal.find((j) => j.getFlag(MOD, 'syndicate')?.[0]?.id === id);

/** Another client changed a journal: Foundry applies the change to this client's copy, then calls the hook. */
const fromElsewhere = (journal, flag, record) => {
  journal.flags[MOD][flag] = [record];
  env.callAll('updateJournalEntry', journal, { flags: { [MOD]: { [flag]: [record] } } }, {}, 'gm2');
};

test('businesses come newest first, then by name, normalised, and get finds each', async () => {
  await BusinessRepository.save({ id: 'b_old', name: 'Old Clinic', createdDay: 3, status: 'open', partners: [] });
  await BusinessRepository.save({ id: 'b_zed', name: 'Zed Bar', createdDay: 9, partners: [] });
  await BusinessRepository.save({ id: 'b_amy', name: 'Amy Garage', createdDay: 9, partners: [] });
  // A record with no id is not a business.
  await JournalEntry.create({ name: 'Broken', flags: { [MOD]: { business: [{ name: 'No id' }] } } });

  assert.deepEqual(names(BusinessRepository.all()), ['Amy Garage', 'Zed Bar', 'Old Clinic']);
  const zed = BusinessRepository.get('b_zed');
  assert.equal(zed.archetype, 'clinic', 'a missing archetype is filled in');
  assert.equal(zed.status, 'forming', 'and a missing status');
  assert.deepEqual(zed.partners, []);
  assert.deepEqual(BusinessRepository.get('b_old'), BusinessRepository.all()[2]);
  assert.equal(BusinessRepository.get('b_nobody'), null);
});

test('a saved business reads back changed', async () => {
  const before = BusinessRepository.get('b_old');
  await BusinessRepository.save({ ...before, till: 450, name: 'Old Clinic II' });
  assert.equal(BusinessRepository.get('b_old').till, 450);
  assert.equal(BusinessRepository.all().find((b) => b.id === 'b_old').name, 'Old Clinic II');
});

test("a caller's copy of a business can't change what the next caller reads", () => {
  const one = BusinessRepository.get('b_zed');
  one.till = 999_999;
  one.partners.push({ actorId: 'a_x' });
  const list = BusinessRepository.all();
  list[0].name = 'Scribbled';
  list.reverse();
  assert.equal(BusinessRepository.get('b_zed').till, 0);
  assert.deepEqual(BusinessRepository.get('b_zed').partners, []);
  assert.deepEqual(names(BusinessRepository.all()), ['Amy Garage', 'Zed Bar', 'Old Clinic II']);
});

test('a business journal created, changed or deleted outside the repository shows at once', async () => {
  assert.equal(BusinessRepository.get('b_new'), null);
  await JournalEntry.create({ name: 'New Bar', flags: { [MOD]: { business: [{ id: 'b_new', name: 'New Bar', createdDay: 20 }] } } });
  assert.equal(BusinessRepository.all()[0].name, 'New Bar', 'created');

  await businessJournal('b_new').setFlag(MOD, 'business', [{ id: 'b_new', name: 'New Bar', createdDay: 20, till: 75 }]);
  assert.equal(BusinessRepository.get('b_new').till, 75, 'changed');

  fromElsewhere(businessJournal('b_zed'), 'business', { id: 'b_zed', name: 'Zed Bar', createdDay: 1, till: 30 });
  assert.equal(BusinessRepository.get('b_zed').till, 30, 'changed on another client');
  assert.deepEqual(names(BusinessRepository.all()), ['New Bar', 'Amy Garage', 'Old Clinic II', 'Zed Bar'], 'and sorted again');

  await businessJournal('b_new').delete();
  assert.equal(BusinessRepository.get('b_new'), null, 'deleted');
  assert.deepEqual(names(BusinessRepository.all()), ['Amy Garage', 'Old Clinic II', 'Zed Bar']);
  assert.equal(await BusinessRepository.remove('b_amy'), true);
  assert.deepEqual(names(BusinessRepository.all()), ['Old Clinic II', 'Zed Bar'], 'removed through the repository');
});

test("a player sees a business once its journal's ownership lets them, and not after", async () => {
  const journal = businessJournal('b_zed');
  journal.testUserPermission = (user) => user.isGM || journal.ownership[user.id] >= 2;
  const gm = game.user;
  try {
    game.user = { id: 'u_alice', isGM: false };
    assert.equal(BusinessRepository.get('b_zed'), null);
    await journal.update({ ownership: { default: 0, u_alice: 2 } });
    assert.equal(BusinessRepository.get('b_zed')?.name, 'Zed Bar', 'given Observer');
    await journal.update({ ownership: { default: 0 } });
    assert.equal(BusinessRepository.get('b_zed'), null, 'and taken away');
  } finally {
    game.user = gm;
  }
  assert.equal(BusinessRepository.get('b_zed')?.name, 'Zed Bar', 'the GM still sees it');
});

test('syndicates come newest first, normalised, and follow saves, hooks and deletes', async () => {
  await SyndicateRepository.save({ id: 's_one', name: 'Crew One', createdDay: 2, members: [] }, { cash: 100 });
  await SyndicateRepository.save({ id: 's_two', name: 'Crew Two', createdDay: 5, members: [{ actorId: 'a_Alice', units: 3 }] });
  assert.deepEqual(names(SyndicateRepository.all()), ['Crew Two', 'Crew One']);
  const two = SyndicateRepository.get('s_two');
  assert.deepEqual([two.status, two.members[0].role, two.rules.tradeLimit], ['active', 'member', 5000], 'missing fields filled in');
  assert.deepEqual(names(SyndicateRepository.forActor('a_Alice')), ['Crew Two']);

  two.members[0].units = 1000;
  assert.equal(SyndicateRepository.get('s_two').members[0].units, 3, "a caller's copy can't change it");

  await SyndicateRepository.save({ ...SyndicateRepository.get('s_one'), name: 'Crew Uno' });
  assert.equal(SyndicateRepository.get('s_one').name, 'Crew Uno', 'saved');
  assert.equal(SyndicateRepository.portfolio('s_one').cash, 100, 'its account untouched');

  fromElsewhere(syndicateJournal('s_one'), 'syndicate', { id: 's_one', name: 'Crew Uno', createdDay: 8, members: [] });
  assert.deepEqual(names(SyndicateRepository.all()), ['Crew Uno', 'Crew Two'], 'changed on another client');

  await SyndicateRepository.remove('s_two');
  assert.equal(SyndicateRepository.get('s_two'), null, 'deleted');
  assert.deepEqual(names(SyndicateRepository.forActor('a_Alice')), []);
});
