import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcCompany, setNpcRun, npcWeek, npcActions, npcDraw, advanceBusiness, canRun, postOpen, BUSINESS_DEFAULTS as P } from '../scripts/engine/index.js';

const DAY = 20003;
const input = (over = {}) => ({ id: 'n1', name: 'Kiroshi Fish', archetype: 'clinic', owner: { id: 'npc1', name: 'Mr Hands' }, stage: 1, level: 'skilled', profile: 'steady', cash: 5000, day: DAY, weekday: 1, seed: 'test', ...over });
const made = (over) => {
  const out = createNpcCompany(input(over));
  assert.equal(out.ok, true, out.reason);
  return out.business;
};
const actions = (b) => b.period.slots.map((s) => s.action);

test('it opens at once at the stage asked for, owned by the NPC', () => {
  const b = made();
  assert.equal(b.status, 'open');
  assert.equal(b.stage, 1);
  assert.equal(b.state.capacity, 3);
  assert.equal(b.state.compliance, P.complianceBaseline);
  assert.equal(b.till, 5000);
  assert.deepEqual(b.npcRun, { ownerId: 'npc1', level: 'skilled', profile: 'steady', auto: true });
  assert.equal(b.partners[0].actorId, 'npc1');
  assert.equal(b.partners[0].voting, true, 'the GM can act as them');
  assert.equal(canRun(b, 'npc1'), true);
});

test('a company has a ticker and its owner as an officer', () => {
  const b = made({ stage: 2, ticker: 'kfs', cash: 25000 });
  assert.equal(b.company.ticker, 'KFS');
  assert.ok(b.company.sector);
  assert.equal(canRun(b, 'npc1'), true);
});

test('it starts staffed, with roles left open', () => {
  assert.deepEqual(made({ stage: 0 }).staff, []);
  const registered = made();
  assert.deepEqual(registered.staff.map((s) => s.post), ['manager', 'floor']);
  assert.equal(registered.staff[0].status, 'active');
  assert.equal(registered.staff[0].bases && Object.values(registered.staff[0].bases)[0], P.npc.levels.skilled - P.npc.staffLess);
  assert.deepEqual(registered.candidates, []);
  assert.equal(postOpen(registered, 'floor').ok, true, 'a role for the job board');
  const company = made({ stage: 2, ticker: 'KFS' });
  assert.equal(company.staff.length, 5);
  assert.equal(company.staff.length < P.staff.headcount[2], true);
});

test('what is refused', () => {
  const reason = (over) => createNpcCompany(input(over)).reason;
  assert.equal(reason({ name: '  ' }), 'bad-name');
  assert.equal(reason({ archetype: 'moon' }), 'bad-archetype');
  assert.equal(reason({ owner: null }), 'bad-owner');
  assert.equal(reason({ stage: 3 }), 'bad-stage');
  assert.equal(reason({ level: 'god' }), 'bad-level');
  assert.equal(reason({ profile: 'evil' }), 'bad-profile');
  assert.equal(reason({ cash: 99 }), 'bad-cash');
  assert.equal(reason({ stage: 2, ticker: 'x' }), 'bad-ticker');
  assert.equal(reason({ stage: 2, ticker: 'ARA', taken: ['ara'] }), 'ticker-taken');
  assert.equal(createNpcCompany(input({ ticker: 'x' })).ok, true, 'only a company needs one');
});

const quiet = (over) => {
  const b = made(over);
  b.period.event = null;
  return b;
};

test('the week fills the free slots from the profile', () => {
  const b = quiet({ profile: 'growing' });
  npcWeek(b, 'seed');
  assert.deepEqual(actions(b), ['work', 'promote']);
  assert.equal(b.period.slots[0].by, 'npc1');
  assert.ok(b.period.slots[0].band);
});

test('it leaves what the GM did alone and takes only what is left', () => {
  const b = quiet({ profile: 'growing' });
  b.period.slots.push({ action: 'source', by: 'npc1', band: 'strong' });
  npcWeek(b, 'seed');
  assert.deepEqual(actions(b), ['source', 'work']);
  const full = quiet({ profile: 'growing' });
  full.period.slots.push({ action: 'source', by: 'npc1' }, { action: 'fixUp', by: 'npc1' });
  npcWeek(full, 'seed');
  assert.equal(full.period.slots.length, 2);
  const same = quiet({ profile: 'growing' });
  same.period.slots.push({ action: 'work', by: 'npc1' });
  npcWeek(same, 'seed');
  assert.deepEqual(actions(same), ['work', 'promote'], 'the action already done is not done twice');
});

test('an event is answered with the last free slot', () => {
  const b = quiet({ profile: 'growing' });
  b.period.event = { kind: 'theft' };
  npcWeek(b, 'seed');
  assert.deepEqual(actions(b), ['work', 'respond']);
  assert.equal(b.period.slots[1].event, 'theft');
});

test('an event the GM answered, or is playing as a scene, is left', () => {
  const answered = quiet({ profile: 'growing' });
  answered.period.event = { kind: 'theft' };
  answered.period.slots.push({ action: 'respond', event: 'theft', by: 'npc1', band: 'solid' });
  npcWeek(answered, 'seed');
  assert.deepEqual(actions(answered), ['respond', 'work']);
  const scene = quiet({ profile: 'growing' });
  scene.period.event = { kind: 'theft' };
  scene.scene = { event: { kind: 'theft' } };
  npcWeek(scene, 'seed');
  assert.deepEqual(actions(scene), ['work', 'promote']);
});

test('at its target a profile stops winning Reputation', () => {
  const b = quiet({ profile: 'growing' });
  assert.deepEqual(npcActions(b).slice(0, 2), ['work', 'promote']);
  b.state.reputation = 70;
  assert.deepEqual(npcActions(b).slice(0, 2), ['work', 'keepSafe']);
  const c = quiet({ stage: 2, ticker: 'KFS', profile: 'growing' });
  c.state.reputation = 90;
  assert.deepEqual(npcActions(c), ['contracts', 'permits', 'books']);
});

test('nothing happens with Runs itself off, or to a player business', () => {
  const b = quiet();
  b.npcRun.auto = false;
  npcWeek(b, 'seed');
  assert.deepEqual(actions(b), []);
  const player = quiet();
  player.npcRun = null;
  npcWeek(player, 'seed');
  assert.deepEqual(actions(player), []);
});

test('the same seed rolls the same week, and a different action its own dice', () => {
  const roll = () => { const b = quiet({ profile: 'growing' }); npcWeek(b, 'seed'); return b.period.slots.map((s) => s.total); };
  assert.deepEqual(roll(), roll());
});

test('the week\'s profit leaves as the owner\'s draw, keeping the reserve', () => {
  const b = made();
  b.till = 3000;
  assert.equal(npcDraw(b, 300, 200, 1, DAY), 200, 'the profit, not everything above the reserve');
  assert.equal(b.till, 2800);
  assert.equal(b.ledger.at(-1).kind, 'ownerDraw');
  assert.equal(b.ledger.at(-1).amount, -200);
  b.till = 2500;
  assert.equal(npcDraw(b, 300, 200, 1, DAY), 100, 'only what is above the reserve');
  assert.equal(npcDraw(b, 300, 200, 1, DAY), 0, 'nothing once at the reserve');
  b.till = 9000;
  assert.equal(npcDraw(b, 300, -50, 1, DAY), 0, 'not from a loss');
  assert.equal(npcDraw(b, 300, 200, 0.5, DAY), 0, 'not a part week');
  b.npcRun.auto = false;
  assert.equal(npcDraw(b, 300, 200, 1, DAY), 0, 'not when the GM is running it');
  b.npcRun = null;
  assert.equal(npcDraw(b, 300, 200, 1, DAY), 0);
});

test('a real week closes, with the owner\'s work and draw on it', () => {
  const b = made({ cash: 40000, profile: 'growing' });
  b.period.event = null;
  const out = advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test' });
  assert.equal(out.business.status, 'open');
  const digest = out.business.digests.at(-1);
  assert.ok(digest.actions.some((a) => a.action === 'work' && a.by === 'npc1'));
  if (b.period.endDay - b.period.startDay === 7 && digest.profit > 0) assert.equal(digest.ownerDraw, digest.profit);
});

test('changing how it is run', () => {
  const b = made();
  const out = setNpcRun(b, { profile: 'shady', level: 'master', auto: false });
  assert.deepEqual(out.business.npcRun, { ownerId: 'npc1', level: 'master', profile: 'shady', auto: false });
  assert.equal(setNpcRun(b, { level: 'god' }).reason, 'bad-level');
  assert.equal(setNpcRun(b, { profile: 'evil' }).reason, 'bad-profile');
  assert.equal(setNpcRun({ ...b, npcRun: null }, {}).reason, 'not-npc');
});

test('every level, profile and refusal has words', () => {
  const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url))).NCI;
  const npc = lang.GMBusiness.Npc;
  for (const k of Object.keys(P.npc.levels)) assert.ok(npc.Level[k], k);
  for (const k of Object.keys(P.npc.profiles)) assert.ok(npc.Profile[k], k);
  for (const k of ['bad-name', 'bad-archetype', 'bad-owner', 'bad-stage', 'bad-level', 'bad-profile', 'bad-cash', 'bad-ticker', 'ticker-taken', 'not-npc']) assert.ok(npc.Reason[k], k);
  assert.ok(lang.Business.Ledger.ownerDraw);
});
