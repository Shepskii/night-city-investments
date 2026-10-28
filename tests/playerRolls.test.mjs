import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';

const env = installFakeFoundry({ actors: [['Alice', 1000, true], ['Bob', 1000, true]] });
const [alice, bob] = env.actors;
alice.system.stats = { int: { value: 5 }, cool: { value: 6 } };
alice.items = [
  { type: 'skill', name: 'Accounting', system: { level: 4, stat: 'int' } },
  { type: 'skill', name: 'Bribery', system: { level: 3, stat: 'cool' } },
];
bob.system.stats = { int: { value: 2 } };
bob.items = [{ type: 'skill', name: 'Accounting', system: { level: 1, stat: 'int' } }];

const chats = [];
const fake = installFakeChat(chats);
game.i18n.localize = (k) => k;
game.i18n.format = (k) => k;

let SkillAdapter;
let dice = [];
before(async () => {
  SkillAdapter = (await import('../scripts/services/SkillAdapter.js')).SkillAdapter;
  SkillAdapter.rollOne = async () => ({ value: dice.shift() ?? 5, roll: null });
});

const roll = async (actor = alice, opts = {}) => (await SkillAdapter.check(actor, { dv: 13, ...opts })).messageId;
const request = (rollId, extra = {}) => ({ key: `k${Math.random()}`, rollId, ts: Date.now(), ...extra });

test('a posted check carries the id the request will quote', async () => {
  dice = [7];
  const id = await roll();
  assert.ok(id, 'the card has an id');
  assert.deepEqual(fake.messages.get(id).getFlag('night-city-investments', 'check').dice, [7]);
});

test('the GM reads the dice from the card and uses its own stat, skill and DV', async () => {
  dice = [7];
  const id = await roll();
  const out = await SkillAdapter.verify(alice, request(id), { dv: 15 });
  assert.equal(out.ok, true);
  assert.deepEqual([out.stat, out.level, out.dv, out.roll.total], [5, 4, 15, 7]);

  dice = [7];
  const other = await roll();
  alice.system.stats.int.value = 8;
  const later = await SkillAdapter.verify(alice, request(other), { dv: 13 });
  alice.system.stats.int.value = 5;
  assert.equal(later.stat, 8, 'a changed sheet is read fresh, not from the card');
});

test('criticals need their second die, and nothing else is accepted', async () => {
  dice = [10, 4];
  const crit = await SkillAdapter.verify(alice, request(await roll()), { dv: 13 });
  assert.deepEqual([crit.ok, crit.roll.total, crit.roll.crit], [true, 14, 'success']);

  dice = [1, 6];
  const fumble = await SkillAdapter.verify(alice, request(await roll()), { dv: 13 });
  assert.deepEqual([fumble.ok, fumble.roll.crit], [true, 'fumble']);

  const forge = (dice) => {
    const m = fake.messages.get(id);
    m.flags['night-city-investments'].check.dice = dice;
  };
  dice = [5];
  var id = await roll();
  forge([10]);
  assert.equal((await SkillAdapter.verify(alice, request(id), { dv: 13 })).reason, 'roll-invalid', 'a crit with no second die');
  forge([5, 9]);
  assert.equal((await SkillAdapter.verify(alice, request(id), { dv: 13 })).reason, 'roll-invalid', 'a second die with no crit');
  forge([11]);
  assert.equal((await SkillAdapter.verify(alice, request(id), { dv: 13 })).reason, 'roll-invalid', 'a die out of range');
});

test('a request with no roll, or a roll that does not exist, is refused', async () => {
  assert.equal((await SkillAdapter.verify(alice, request(undefined), { dv: 13 })).reason, 'no-roll');
  assert.equal((await SkillAdapter.verify(alice, request('nope'), { dv: 13 })).reason, 'roll-missing');
});

test('a card is for one actor and one skill', async () => {
  dice = [9];
  const id = await roll();
  assert.equal((await SkillAdapter.verify(bob, request(id), { dv: 13 })).reason, 'roll-mismatch', "someone else's actor");
  assert.equal((await SkillAdapter.verify(alice, request(id), { dv: 13, skill: 'Bribery', stat: 'cool' })).reason, 'roll-mismatch', 'a different skill');
});

test('a card cannot be used twice, but the same request can be retried', async () => {
  dice = [9];
  const id = await roll();
  const first = request(id);
  assert.equal((await SkillAdapter.verify(alice, first, { dv: 13 })).ok, true);
  assert.equal((await SkillAdapter.verify(alice, first, { dv: 13 })).ok, true, 'a retry of the same request');
  assert.equal((await SkillAdapter.verify(alice, request(id), { dv: 13 })).reason, 'roll-used', 'a second request');
});

test('only a card made just before the request counts', async () => {
  dice = [9];
  const id = await roll();
  const made = fake.messages.get(id).timestamp;
  assert.equal((await SkillAdapter.verify(alice, request(id, { ts: made + 11 * 60 * 1000 }), { dv: 13 })).reason, 'roll-stale', 'saved up for later');
  dice = [9];
  const early = await roll();
  assert.equal((await SkillAdapter.verify(alice, request(early, { ts: fake.messages.get(early).timestamp - 5 * 60 * 1000 }), { dv: 13 })).reason, 'roll-stale', 'rolled after the request claims to be sent');
});

test('a card from someone who does not own the actor is refused', async () => {
  dice = [9];
  const id = await roll();
  alice.testUserPermission = () => false;
  const out = await SkillAdapter.verify(alice, request(id), { dv: 13 });
  delete alice.testUserPermission;
  assert.equal(out.reason, 'roll-mismatch');
});
