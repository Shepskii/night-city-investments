/**
 * Back room profiles (U2a, DESIGN §36.12): every kind's numbers, and that today's rooms play as they did.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHETYPES, BACK_ROOMS, BUSINESS_DEFAULTS as P, SKILLS, ABILITIES, normalizeBusiness, raidChance, roomCheck, roomKinds, roomProfile, roomWeek,
} from '../scripts/engine/index.js';

const room = (archetype, kind, dirty = 0) => normalizeBusiness({
  id: 'b1', name: 'Front', archetype, status: 'open', stage: 1, till: 1000,
  partners: [{ actorId: 'med', name: 'Medtech', status: 'active', voting: true, cash: 0, gear: [], units: 100 }],
  backRoom: { kind, status: 'open', dirty, day: 0 },
  period: { index: 1, startDay: 0, endDay: 7, slots: [], bonuses: [], helpers: [], overtime: {}, draws: {} },
  state: { capacity: 2, reputation: 50, costFactor: 1 },
});
const worked = (archetype, kind, band = 'solid', approach = 'standard') => {
  const b = room(archetype, kind);
  b.period.slots = [{ action: 'roomWork', by: 'med', band, approach }];
  return { b, week: roomWeek(b, 1000, 1, P) };
};
/** A kind of each profile that is on the list. */
const KINDS = { steady: ['clinic', 'ripping'], loud: ['bar', 'fightPit'], quiet: ['clinic', 'backAlleySurgery'], hungry: ['clinic', 'streetPharmacy'], connected: ['bar', 'fixersRoom'], laundering: ['boutique', 'launderette'] };

test('the map: 34 kinds across all ten businesses, each with three or four, and every use one that exists', () => {
  const all = Object.values(BACK_ROOMS).flatMap((kinds) => Object.values(kinds));
  assert.equal(all.length, 34);
  assert.equal(all.filter((k) => k.profile === 'steady').length, 10, 'every current kind but Laundering for others');
  assert.deepEqual(Object.keys(BACK_ROOMS).sort(), Object.keys(ARCHETYPES).sort());
  for (const [front, kinds] of Object.entries(BACK_ROOMS)) {
    assert.ok([3, 4].includes(Object.keys(kinds).length), front);
    for (const [id, kind] of Object.entries(kinds)) {
      assert.ok(P.backRoom.profiles[kind.profile], `${front}.${id} has a profile`);
      assert.ok(kind.uses.length >= 2, `${front}.${id} has something to roll`);
      const known = [...Object.values(SKILLS), ...Object.values(ABILITIES)];
      for (const use of kind.uses) assert.ok(known.includes(use), `${front}.${id}`);
    }
  }
});

test('every kind of a front is offered', () => {
  for (const [front, kinds] of Object.entries(BACK_ROOMS)) assert.deepEqual(roomKinds({ archetype: front }), Object.keys(kinds));
});

test('the kinds that were there before U2 are Steady, but Laundering for others, as decided', () => {
  const before = { clinic: ['ripping'], garage: ['chopShop'], bar: ['gambling', 'brothel'], infoShop: ['dataFence'], gunShop: ['blackArms'], courier: ['smuggling'], foodStall: ['deadDrop'], media: ['blackmail'], security: ['racket'] };
  for (const [front, ids] of Object.entries(before)) for (const id of ids) assert.equal(BACK_ROOMS[front][id].profile, 'steady', `${front}.${id}`);
  assert.equal(BACK_ROOMS.boutique.launderette.profile, 'laundering');
});

test('a Steady room plays exactly as a room did before profiles', () => {
  const { b, week } = worked('clinic', 'ripping', 'solid');
  assert.equal(week.earned, Math.round(260 * 2 * P.backRoom.share * 1.1));
  assert.equal(week.supply, 0);
  assert.equal(b.backRoom.dirty, week.earned);
  assert.equal(week.exposure, P.backRoom.workExposure.solid);
  assert.equal(raidChance(room('clinic', 'ripping'), 40), P.backRoom.raid.chance.high);
  assert.deepEqual([...roomCheck(room('clinic', 'ripping'), 'roomWork').uses], [...BACK_ROOMS.clinic.ripping.uses]);
});

test('a kind no longer known plays as Steady', () => {
  assert.equal(roomProfile(room('clinic', 'somethingOld')), P.backRoom.profiles.steady);
  assert.equal(roomProfile({ archetype: 'clinic', backRoom: null }), P.backRoom.profiles.steady);
});

test('each profile moves the money, the Exposure and the raids as the map says', () => {
  const steady = worked(...KINDS.steady).week;
  const earned = (name) => worked(...KINDS[name]).week;
  const bar = worked('bar', 'gambling').week;
  assert.equal(earned('loud').earned, Math.round(250 * 2 * P.backRoom.share * (1 + 0.1 * 1.5) * 1.5), 'half as much again, swinging further');
  assert.equal(earned('loud').exposure, 2 * 1.5);
  assert.ok(earned('loud').earned > bar.earned);
  assert.equal(earned('quiet').earned, Math.round(260 * 2 * P.backRoom.share * (1 + 0.1 * 0.75) * 0.65));
  assert.equal(earned('quiet').exposure, 1);
  assert.equal(earned('connected').exposure, 2 * 0.75 - 0.5, 'and it sheds a little for the week worked');
  assert.equal(earned('connected').earned, Math.round(250 * 2 * P.backRoom.share * 1.1 * 0.5));
  assert.equal(earned('laundering').exposure, 2 * 0.75);
  assert.ok(steady.earned > earned('quiet').earned);

  const high = 40;
  const chance = P.backRoom.raid.chance.high;
  assert.equal(raidChance(room(...KINDS.loud), high), chance * 1.25);
  assert.equal(raidChance(room(...KINDS.quiet), high), chance * 0.5);
  assert.equal(raidChance(room(...KINDS.hungry), high), chance);
  assert.equal(raidChance(room(...KINDS.quiet), 0), 0, 'clean is still clean');
});

test('a Hungry room pays for supplies out of what it earns, and says so', () => {
  const { b, week } = worked(...KINDS.hungry);
  assert.equal(week.earned, Math.round(260 * 2 * P.backRoom.share * 1.1 * 1.5));
  assert.equal(week.supply, Math.round(week.earned * 0.25));
  assert.equal(b.backRoom.dirty, week.earned - week.supply);
  assert.equal(week.exposure, 2 * 1.25);
  const fumbled = worked(...KINDS.hungry, 'fumble').week;
  assert.deepEqual([fumbled.earned, fumbled.supply], [0, 0]);
});

test('a Laundering room washes twice as much, whatever else is in the room', () => {
  const wash = (kinds) => {
    const b = room(...kinds, 5000);
    b.period.slots = [{ action: 'launder', by: 'med', band: 'strong' }];
    return roomWeek(b, 1000, 1, P).laundered;
  };
  assert.equal(wash(KINDS.steady), 1000 * P.backRoom.launderCap);
  assert.equal(wash(KINDS.laundering), 1000 * P.backRoom.launderCap * 2);
  const short = room(...KINDS.laundering, 100);
  short.period.slots = [{ action: 'launder', by: 'med', band: 'strong' }];
  assert.equal(roomWeek(short, 1000, 1, P).laundered, 100, 'no more than there is');
});

test('a short week scales a profile\'s money as it does any room\'s', () => {
  const b = room(...KINDS.loud);
  b.period.slots = [{ action: 'roomWork', by: 'med', band: 'solid', approach: 'standard' }];
  const full = roomWeek(structuredClone(b), 1000, 1, P).earned;
  const part = roomWeek(structuredClone(b), 1000, 3 / 7, P).earned;
  assert.equal(part, Math.round(250 * 2 * P.backRoom.share * (1 + 0.1 * 1.5) * 1.5 * (3 / 7)));
  assert.ok(part < full);
});

test('the names are ready for every kind, draft or not', async () => {
  const { readFileSync } = await import('node:fs');
  const lang = JSON.parse(readFileSync('lang/en.json', 'utf8'));
  for (const kinds of Object.values(BACK_ROOMS)) {
    for (const id of Object.keys(kinds)) assert.ok(lang.NCI.BackRoom.Kind[id], id);
  }
});

test('the week\'s digest keeps what a Hungry room spent on supplies, and a close plays the profile', async () => {
  const { advanceBusiness } = await import('../scripts/engine/index.js');
  const b = room(...KINDS.hungry, 0);
  b.period.slots = [{ action: 'roomWork', by: 'med', band: 'solid', approach: 'standard' }];
  const closed = advanceBusiness(b, 8, { seed: 'u2a' });
  const digest = closed.business.digests.at(-1);
  assert.ok(digest.room.earned > 0);
  assert.equal(digest.room.supply, Math.round(digest.room.earned * 0.25));
  const steady = room(...KINDS.steady, 0);
  steady.period.slots = [{ action: 'roomWork', by: 'med', band: 'solid', approach: 'standard' }];
  assert.equal(advanceBusiness(steady, 8, { seed: 'u2a' }).business.digests.at(-1).room.supply, undefined, 'a room with no supplies says nothing of them');
});

test('a connected room lifts standing for a week worked, with the faction it chose', () => {
  const connected = (factionId) => {
    const b = room(...KINDS.connected);
    if (factionId) b.backRoom.factionId = factionId;
    return b;
  };
  const b = connected('tyger');
  b.period.slots = [{ action: 'roomWork', by: 'med', band: 'solid', approach: 'standard' }];
  assert.deepEqual(roomWeek(b, 1000, 1, P).standing, { factionId: 'tyger', amount: 1 });
  const idle = connected('tyger');
  assert.equal(roomWeek(idle, 1000, 1, P).standing, undefined, 'not a week it did not work');
  const none = connected();
  none.period.slots = b.period.slots;
  assert.equal(roomWeek(none, 1000, 1, P).standing, undefined, 'a world with no factions');
  const steady = room(...KINDS.steady);
  steady.backRoom.factionId = 'tyger';
  steady.period.slots = b.period.slots;
  assert.equal(roomWeek(steady, 1000, 1, P).standing, undefined, 'only a connected room');
});

test('the close passes a connected room\'s standing on', async () => {
  const { advanceBusiness } = await import('../scripts/engine/index.js');
  const b = room(...KINDS.connected);
  b.backRoom.factionId = 'tyger';
  b.period.slots = [{ action: 'roomWork', by: 'med', band: 'solid', approach: 'standard' }];
  const events = advanceBusiness(b, 8, { seed: 'u2b' }).events;
  assert.deepEqual(events.filter((e) => e.type === 'factionMove'), [{ type: 'factionMove', factionId: 'tyger', amount: 1, steady: true }]);
});

test('a connected room\'s week is always a full +1, and leaves other dealings with the faction at full value', async () => {
  const { moveStanding, driftStanding, advanceBusiness } = await import('../scripts/engine/index.js');
  let entry = null;
  for (const [week, expected] of [[0, 1], [7, 1], [14, 1], [21, 1], [28, 1]]) {
    if (entry) entry = driftStanding(entry);
    const moved = moveStanding(entry, 1, week * 1, undefined, { steady: true });
    assert.equal(moved.applied, 1, `week starting ${week}`);
    entry = moved.entry;
    assert.equal(entry.value, expected, 'from nothing it holds at 1');
  }
  assert.deepEqual(entry.recent, [], 'none of it counts as a recent dealing');
  assert.equal(moveStanding(entry, 6, 30).applied, 6, 'so a gig for them keeps its full value');

  let high = { value: 20, weekStart: 0, moved: 0, recent: [] };
  for (let week = 1; week <= 4; week += 1) high = moveStanding(driftStanding(high), 1, week * 7, undefined, { steady: true }).entry;
  assert.equal(high.value, 16, 'from higher up it slows the fade to 1 a week');

  const once = moveStanding(null, 6, 0).entry;
  assert.equal(moveStanding(once, 6, 1).applied, 3, 'other repeat dealings are still divided');

  const b = room(...KINDS.connected, 0);
  b.backRoom.factionId = 'gang_x';
  b.backRoom.factionName = 'X';
  b.period.slots = [{ action: 'roomWork', by: 'med', band: 'solid', approach: 'standard' }];
  const closed = advanceBusiness(b, 8, { seed: 'u2' });
  assert.ok(closed.events.some((e) => e.type === 'factionMove' && e.factionId === 'gang_x' && e.amount === 1 && e.steady === true), 'and a close sends it as steady');
});
