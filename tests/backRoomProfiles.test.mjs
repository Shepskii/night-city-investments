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
  assert.equal(all.filter((k) => !k.draft).length, 11, 'the ones offered today');
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

test('only today\'s kinds are offered until U2b, and the requests hold to that', () => {
  assert.deepEqual(roomKinds({ archetype: 'clinic' }), ['ripping']);
  assert.deepEqual(roomKinds({ archetype: 'bar' }), ['gambling', 'brothel']);
  assert.deepEqual(roomKinds({ archetype: 'boutique' }), ['launderette']);
  for (const front of Object.keys(BACK_ROOMS)) assert.ok(roomKinds({ archetype: front }).length >= 1);
});

test('every current kind is Steady, but Laundering for others, as decided', () => {
  for (const [front, kinds] of Object.entries(BACK_ROOMS)) {
    for (const [id, kind] of Object.entries(kinds)) {
      if (kind.draft) continue;
      assert.equal(kind.profile, id === 'launderette' ? 'laundering' : 'steady', `${front}.${id}`);
    }
  }
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
