import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';

const DAY_MS = 86_400_000;
const env = installFakeFoundry({ actors: [['Medtech', 3000, true], ['Fixer', 3000, true], ['Solo', 3000, true]] });
const [med, fix, solo] = env.actors;
med.system.stats = { tech: { value: 7 }, luck: { value: 4, max: 4 } };
med.items = [{ type: 'skill', name: 'Cybertech', system: { level: 5, stat: 'tech' } }];
fix.system.stats = { cool: { value: 6 }, luck: { value: 3, max: 3 } };
fix.items = [
  { type: 'skill', name: 'Streetwise', system: { level: 4, stat: 'cool' } },
  { type: 'role', name: 'Fixer', system: { rank: 4, mainRoleAbility: 'Operator' } },
];
solo.system.stats = {};
solo.items = [];

// Three players, one per character, and the GM.
const users = [{ id: 'u_med', isGM: false }, { id: 'u_fix', isGM: false }, { id: 'u_solo', isGM: false }, { id: 'gm1', isGM: true }];
game.users = Object.assign(users, { activeGM: users[3], get: (id) => users.find((u) => u.id === id) });
for (const actor of env.actors) {
  const owner = `u_${actor.name === 'Medtech' ? 'med' : actor.name === 'Fixer' ? 'fix' : 'solo'}`;
  // The fake chat posts cards as this client's user, the GM, with only an id.
  actor.testUserPermission = (user) => user.isGM || user.id === 'gm1' || user.id === owner;
  const wealthUpdate = actor.update.bind(actor);
  actor.update = async (d) => {
    if ('system.stats.luck.value' in d) actor.system.stats.luck.value = d['system.stats.luck.value'];
    return wealthUpdate(d);
  };
}
const fake = installFakeChat();

let BusinessClient;
let BusinessService;
let BusinessRepository;
let receiptsOf;
let dice = [];
before(async () => {
  ({ BusinessClient, receiptsOf } = await import('../scripts/services/BusinessClient.js'));
  ({ BusinessService } = await import('../scripts/services/BusinessService.js'));
  ({ BusinessRepository } = await import('../scripts/data/BusinessRepository.js'));
  const { SkillAdapter } = await import('../scripts/services/SkillAdapter.js');
  SkillAdapter.rollOne = async () => ({ value: dice.shift() ?? 5, roll: null });
});

const lastResult = (actor) => receiptsOf(actor).results.at(-1);
const wealth = (actor) => actor.system.wealth.value;
const business = () => BusinessRepository.all()[0];
const send = async (actor, type, payload) => {
  await BusinessClient.submit(actor, type, payload);
  await BusinessService.processActor(actor);
  return lastResult(actor);
};

test('the Medtech founds a clinic and invites the Fixer', async () => {
  const r = await send(med, 'found', { name: 'Back Room', archetype: 'clinic', location: 'Watson', cash: 1000, gear: [{ name: 'Surgical kit', value: 800 }], invite: [fix.id] });
  assert.equal(r.ok, true, r.reason);
  assert.equal(wealth(med), 2000);
  const b = business();
  assert.equal(b.status, 'forming');
  const journal = BusinessRepository.journalOf(b.id);
  assert.deepEqual(journal.ownership, { default: 0, u_med: 2, u_fix: 2 }, 'the partners, invited ones too, and nobody else');
});

test('the Fixer joins, then makes the setup roll with Operator; the GM approves', async () => {
  assert.equal((await send(fix, 'join', { businessId: business().id, cash: 1500 })).ok, true);
  assert.equal(wealth(fix), 1500);

  dice = [9]; // Operator 4 + 9 = 13 against DV 13: a narrow pass
  await BusinessClient.roll(fix, business(), { type: 'setupRoll', businessId: business().id, use: { kind: 'ability', ability: 'Operator' } }, { title: 'Setup' });
  await BusinessService.processActor(fix);
  assert.equal(lastResult(fix).ok, true, lastResult(fix).reason);
  assert.equal(business().status, 'pending', 'GM approval is on by default');

  const out = await BusinessService.approve(business().id);
  assert.equal(out.ok, true);
  const b = business();
  assert.equal(b.status, 'open');
  assert.ok(b.till > 0, `the till: ${b.till}`);
});

test('a complementary check, then the week\'s roll with Luck and the bonus', async () => {
  const id = business().id;
  dice = [6];
  await BusinessClient.roll(fix, business(), { type: 'assist', businessId: id, forAction: 'work', use: { kind: 'skill', skill: 'Streetwise', stat: 'cool' } }, { title: 'Steer patients' });
  await BusinessService.processActor(fix);
  assert.equal(lastResult(fix).ok, true, lastResult(fix).reason);
  assert.equal(business().period.bonuses.length, 1);

  dice = [5];
  await BusinessClient.roll(med, business(), { type: 'action', businessId: id, action: 'work', use: { kind: 'skill', skill: 'Cybertech', stat: 'tech' } }, { title: 'Work', levers: { luck: 2, bonus: 1 } });
  await BusinessService.processActor(med);
  assert.equal(lastResult(med).ok, true, lastResult(med).reason);
  const slot = business().period.slots[0];
  // TECH 7 + Cybertech 5 + Luck 2 + help 1 + 5 = 20 against DV 13: margin 7, strong.
  assert.deepEqual([slot.luck, slot.bonus, slot.total, slot.band], [2, 1, 20, 'strong']);
  assert.equal(med.system.stats.luck.value, 2);
});

test('a roll card cannot be used for a second request', async () => {
  const id = business().id;
  const used = [...fake.messages.values()].at(-1).id;
  await BusinessClient.submit(med, 'action', { businessId: id, action: 'promote', use: { kind: 'skill', skill: 'Cybertech', stat: 'tech' }, rollId: used });
  await BusinessService.processActor(med);
  assert.equal(lastResult(med).ok, false);
});

test('the week closes on the market\'s date, and the partners draw their shares', async () => {
  const b = business();
  env.clock.ms += (b.period.endDay - Math.floor(env.clock.ms / DAY_MS)) * DAY_MS;
  assert.equal(await BusinessService.onTick(), 1);
  const after = business();
  assert.equal(after.digests.length, 1);
  assert.ok(env.hooksFired.some((h) => h.name === 'night-city-investments.businessPeriod'));
  const profit = after.digests[0].profit;
  assert.ok(profit > 0, `profit ${profit}`);

  const before = wealth(fix);
  const share = Math.floor(profit * (after.partners[1].units / (after.partners[0].units + after.partners[1].units)));
  assert.equal((await send(fix, 'draw', { businessId: after.id, amount: share })).ok, true);
  assert.equal(wealth(fix), before + share);
  assert.equal((await send(fix, 'draw', { businessId: after.id, amount: 1 })).reason, 'over-allowance');
});

test('someone who is not a partner is refused, and nothing changes', async () => {
  const before = JSON.stringify(business());
  const r = await send(solo, 'draw', { businessId: business().id, amount: 5 });
  assert.deepEqual([r.ok, r.reason], [false, 'not-partner']);
  assert.equal(JSON.stringify(business()), before);
});

test('when the partners close the clinic, its money is paid out and the record stays for them', async () => {
  const id = business().id;
  await send(med, 'proposeClose', { businessId: id });
  const proposal = business().proposals[0];
  const [m, f] = [wealth(med), wealth(fix)];
  assert.equal((await send(fix, 'vote', { businessId: id, proposalId: proposal.id, yes: true })).ok, true);
  assert.equal(business().status, 'closed');
  assert.ok(wealth(med) > m && wealth(fix) > f);
  assert.ok(BusinessRepository.forActor(med.id).length === 1, 'a closed business still shows to its partners');
});
