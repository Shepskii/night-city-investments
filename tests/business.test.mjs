import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, approveBusiness, rejectBusiness, markLeaving, rollSpec, normalizeBusiness,
  drawAllowance, fundingShortfall, unitValue, shareOf, totalUnits, weekdayOf, nextBoundary, hireFee, SKILLS, BUSINESS_DEFAULTS,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 5000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 5000 };
const SOLO = { id: 'solo', name: 'Solo', wealth: 5000 };
const ACTORS = { med: 'Medtech', fix: 'Fixer', solo: 'Solo' };
const MONDAY = 1;
// A Monday: day 20000 is 2024-10-04, a Friday, so 20003 is a Monday.
const DAY = 20003;

const ctx = (extra = {}) => ({ approval: false, weekday: MONDAY, actors: ACTORS, newId: 'b1', ...extra });
const check = (base, die, dv, levers = {}) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv, levers }) });
const cybertech = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };

function apply(business, request, actor, extra = {}) {
  const out = applyBusinessRequest({ business, request: { key: `k${Math.random()}`, ...request }, actor, day: extra.day ?? DAY, check: extra.check, context: ctx(extra.context) });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/** The worked example: the Medtech brings 1,000 eb and her surgical gear, the Fixer 1,500 eb, with a 5% sweat slice. */
function foundClinic(extra = {}) {
  let out = apply(null, {
    type: 'found', name: 'Back Room', archetype: 'clinic', location: 'Watson', cash: 1000, invite: ['fix'], sweat: { actorId: 'med', pct: 5 },
  }, MED, { ...extra, context: { ...extra.context, gear: [{ name: 'Surgical kit', value: 800 }] } });
  out = apply(out.business, { type: 'join', businessId: 'b1', cash: 1500 }, FIX, extra);
  return out.business;
}

const openClinic = (die = 9) => apply(foundClinic(), { type: 'setupRoll', businessId: 'b1', use: { kind: 'ability', ability: 'Operator' } }, FIX, { check: check(4, die, 13) }).business;

test('days: periods end on the chosen weekday', () => {
  assert.equal(weekdayOf(DAY), MONDAY);
  assert.equal(nextBoundary(DAY, MONDAY), DAY + 7);
  assert.equal(nextBoundary(DAY + 2, MONDAY), DAY + 7);
});

test('founding holds the money in escrow and invites the partners', () => {
  const out = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 1000, invite: ['fix'] }, MED);
  assert.equal(out.business.status, 'forming');
  assert.equal(out.business.escrow, 1000);
  assert.deepEqual(out.wealth, { med: -1000 });
  assert.equal(out.business.partners[1].status, 'invited');
  assert.equal(apply(null, { type: 'found', name: 'X', archetype: 'clinic', cash: 9000 }, MED, { expect: false }).reason, 'insufficient-funds');
  assert.equal(apply(null, { type: 'found', name: 'X', archetype: 'casino', cash: 0 }, MED, { expect: false }).reason, 'bad-archetype');
  assert.equal(apply(null, { type: 'found', name: 'X', archetype: 'clinic', cash: 0, sweat: { actorId: 'med', pct: 20 } }, MED, { expect: false }).reason, 'bad-sweat');
});

test('the setup roll waits for every invitation to be answered', () => {
  const b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 1000, invite: ['fix'] }, MED).business;
  assert.equal(rollSpec(b, { type: 'setupRoll', use: cybertech }, 'med', { day: DAY }).reason, 'invites-pending');
  const declined = apply(b, { type: 'decline', businessId: 'b1' }, FIX).business;
  assert.equal(rollSpec(declined, { type: 'setupRoll', use: cybertech }, 'med', { day: DAY }).ok, true);
});

test('a passed setup roll opens the clinic: units, sweat, fit-out and till', () => {
  const b = openClinic(9); // Operator 4 + 9 = 13 against DV 13: narrow
  assert.equal(b.status, 'open');
  assert.equal(b.setup.band, 'narrow');
  assert.equal(b.setup.cost, 3000, 'a narrow pass needs the top of the range');
  const [med, fix] = b.partners;
  assert.equal(fix.units, 1500);
  // The Medtech's 1,800 units plus the sweat slice: 3,300 x 5/95, about 174.
  assert.equal(med.units, 1800 + 174);
  assert.equal(b.assets, 3000);
  assert.equal(b.till, 2500 - (3000 - 800));
  assert.ok(Math.abs(shareOf(b, 'med') + shareOf(b, 'fix') - 1) < 1e-9);
  assert.equal(b.period.endDay, DAY + 7);
});

test('a better setup roll costs less and opens with more Capacity', () => {
  const strong = apply(foundClinic(), { type: 'setupRoll', businessId: 'b1', use: { kind: 'ability', ability: 'Operator' } }, FIX, { check: check(10, 9, 13) }).business;
  assert.equal(strong.setup.band, 'strong');
  assert.equal(strong.setup.cost, 1500);
  assert.equal(strong.state.capacity, 1.1);
});

test('with GM approval on, a funded business waits, and the GM opens or refuses it', () => {
  const pending = apply(foundClinic(), { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(12, 6, 13), context: { approval: true } });
  assert.equal(pending.business.status, 'pending');
  assert.deepEqual(pending.events.map((e) => e.type), ['roll', 'awaitingApproval']);
  const opened = approveBusiness(pending.business, DAY, MONDAY);
  assert.equal(opened.business.status, 'open');

  const refused = rejectBusiness(pending.business, DAY);
  assert.equal(refused.business.status, 'closed');
  assert.deepEqual(refused.wealth, { med: 1000, fix: 1500 }, 'all the cash back; the gear never left');
});

test('a failed setup roll loses some money and must wait; a fumble loses more', () => {
  const failed = apply(foundClinic(), { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(5, 5, 13) }).business;
  assert.equal(failed.status, 'forming');
  assert.equal(failed.escrow, 2500 - 333);
  assert.equal(rollSpec(failed, { type: 'setupRoll', use: cybertech }, 'med', { day: DAY + 3 }).reason, 'setup-delay');
  assert.equal(rollSpec(failed, { type: 'setupRoll', use: cybertech }, 'med', { day: DAY + 7 }).ok, true);

  const fumbled = apply(foundClinic(), { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(5, -3, 13) }).business;
  assert.equal(fumbled.setup.band, 'fumble');
  assert.equal(fumbled.escrow, 2000);
  assert.equal(fumbled.setup.retryDay, DAY + 14);
});

test('a business short of money waits after its setup roll until a partner puts more in', () => {
  let b = apply(null, { type: 'found', name: 'Stall', archetype: 'clinic', cash: 500 }, MED).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(12, 3, 13) }).business;
  assert.equal(b.status, 'forming');
  assert.equal(fundingShortfall(b), b.setup.cost - 500);
  b = apply(b, { type: 'contribute', businessId: 'b1', cash: fundingShortfall(b) }, MED).business;
  assert.equal(b.status, 'open');
  assert.equal(b.till, 0);
});

test('a partner who withdraws before opening gets their cash back', () => {
  const b = foundClinic();
  const out = apply(b, { type: 'withdraw', businessId: 'b1' }, FIX);
  assert.deepEqual(out.wealth, { fix: 1500 });
  assert.equal(out.business.escrow, 1000);
  const last = apply(out.business, { type: 'withdraw', businessId: 'b1' }, MED);
  assert.equal(last.business.status, 'closed');
  assert.equal(last.business.closeReason, 'cancelled');
});

test('the roll spec admits the action\'s skills, with the business\'s own stat, and refuses the rest', () => {
  const b = openClinic();
  const spec = rollSpec(b, { type: 'action', action: 'work', use: { kind: 'skill', skill: 'Cybertech', stat: 'cool' } }, 'med', { day: DAY });
  assert.equal(spec.ok, true);
  assert.equal(spec.use.stat, 'tech', 'the stat comes from the table, not the request');
  assert.equal(rollSpec(b, { type: 'action', action: 'work', use: SKILLS.persuasion }, 'med', { day: DAY }).reason, 'bad-use');
  assert.equal(rollSpec(b, { type: 'action', action: 'promote', use: SKILLS.persuasion }, 'med', { day: DAY }).ok, true);
  assert.equal(rollSpec(b, { type: 'assist', forAction: 'work', use: SKILLS.streetwise }, 'fix', { day: DAY }).ok, true);
  assert.equal(rollSpec(b, { type: 'assist', forAction: 'work', use: { kind: 'hire', hire: 'good' } }, 'fix', { day: DAY }).reason, 'hire-not-allowed');
  assert.equal(rollSpec(b, { type: 'action', action: 'work', use: cybertech }, 'solo', { day: DAY }).reason, 'not-partner');
});

test('one slot a week at a side business, and a complementary +1 used once', () => {
  let b = openClinic();
  // The Fixer steers patients her way: Streetwise, a complementary check that uses no slot.
  b = apply(b, { type: 'assist', businessId: 'b1', forAction: 'work', use: SKILLS.streetwise }, FIX, { check: check(10, 6, 13) }).business;
  assert.equal(b.period.bonuses.length, 1);
  assert.equal(rollSpec(b, { type: 'assist', forAction: 'work', use: SKILLS.streetwise }, 'fix', { day: DAY }).reason, 'helped', 'one check a week each');
  const spec = rollSpec(b, { type: 'action', action: 'work', use: cybertech }, 'med', { day: DAY });
  assert.equal(spec.bonusAvailable, true);

  b = apply(b, { type: 'action', businessId: 'b1', action: 'work', use: cybertech }, MED, { check: check(12, 4, 13, { bonus: 1 }) }).business;
  assert.equal(b.period.bonuses[0].used, true);
  assert.equal(b.period.slots[0].band, 'Solid'.toLowerCase());
  assert.equal(rollSpec(b, { type: 'action', action: 'promote', use: SKILLS.persuasion }, 'fix', { day: DAY }).reason, 'no-slot');
});

test('the week closes on its boundary; working the shop beats leaving it', () => {
  const worked = apply(openClinic(), { type: 'action', businessId: 'b1', action: 'work', use: cybertech }, MED, { check: check(12, 9, 13) }).business;
  const early = advanceBusiness(worked, DAY + 6, { weekday: MONDAY });
  assert.equal(early.changed, false);
  const closed = advanceBusiness(worked, DAY + 7, { weekday: MONDAY });
  const idle = advanceBusiness(openClinic(), DAY + 7, { weekday: MONDAY });
  const [w, i] = [closed.business.digests[0], idle.business.digests[0]];
  assert.ok(w.takings > i.takings, `${w.takings} > ${i.takings}`);
  assert.equal(closed.business.till, worked.till + w.profit);
  assert.equal(closed.business.period.index, 2);
  assert.equal(closed.business.period.slots.length, 0, 'the slots reset');
  assert.ok(i.profit > 20 && i.profit < 150, `a side business earns within its band: ${i.profit}`);
});

test('a calendar jump closes each missed week, up to the catch-up cap', () => {
  const out = advanceBusiness(openClinic(), DAY + 7 * 3, { weekday: MONDAY });
  assert.equal(out.business.digests.length, 3);
  const far = advanceBusiness(openClinic(), DAY + 7 * 20, { weekday: MONDAY });
  assert.equal(far.business.digests.length, BUSINESS_DEFAULTS.catchUpPeriods);
  assert.equal(far.events.at(-1).type, 'periodsSkipped');
});

test('owners draw up to their share of last week\'s profit, once', () => {
  const b = advanceBusiness(openClinic(), DAY + 7, { weekday: MONDAY }).business;
  const profit = b.digests[0].profit;
  const allowed = drawAllowance(b, 'fix');
  assert.equal(allowed, Math.floor(profit * shareOf(b, 'fix')));
  const out = apply(b, { type: 'draw', businessId: 'b1', amount: allowed }, FIX);
  assert.deepEqual(out.wealth, { fix: allowed });
  assert.equal(drawAllowance(out.business, 'fix'), 0);
  assert.equal(apply(out.business, { type: 'draw', businessId: 'b1', amount: 1 }, FIX, { expect: false }).reason, 'over-allowance');
});

test('a leaving partner\'s stake can be bought at book value', () => {
  let b = apply(openClinic(), { type: 'leave', businessId: 'b1' }, MED).business;
  const price = Math.round(b.partners[0].units * unitValue(b));
  const out = apply(b, { type: 'buyout', businessId: 'b1', sellerId: 'med' }, FIX);
  assert.deepEqual(out.wealth, { fix: -price, med: price });
  assert.equal(shareOf(out.business, 'fix'), 1);
  assert.equal(out.business.partners[0].status, 'left');
});

test('a stake nobody buys passes to the named heir without a vote, or lapses', () => {
  let b = apply(openClinic(), { type: 'setHeir', businessId: 'b1', heirId: 'solo' }, MED).business;
  b = markLeaving(b, 'med', DAY + 1).business;
  const units = b.partners[0].units;
  assert.equal(advanceBusiness(b, DAY + 6, { weekday: MONDAY, actors: ACTORS }).business.partners[0].status, 'leaving');
  const later = advanceBusiness(b, DAY + 15, { weekday: MONDAY, actors: ACTORS }).business;
  const heir = later.partners.find((x) => x.actorId === 'solo');
  assert.deepEqual([heir.units, heir.voting, heir.status], [units, false, 'active']);
  assert.ok(drawAllowance(later, 'solo') >= 0);
  assert.equal(rollSpec(later, { type: 'action', action: 'work', use: cybertech }, 'solo', { day: DAY + 15 }).reason, 'not-partner', 'an heir does not run the business');

  const lapsed = advanceBusiness(markLeaving(openClinic(), 'med', DAY).business, DAY + 14, { weekday: MONDAY }).business;
  assert.equal(totalUnits(lapsed), 1500);
});

test('closing needs every partner: one no ends the proposal, all yes pays out by units', () => {
  let b = advanceBusiness(openClinic(), DAY + 7, { weekday: MONDAY }).business;
  b = apply(b, { type: 'proposeClose', businessId: 'b1' }, MED).business;
  const id = b.proposals[0].id;
  const no = apply(b, { type: 'vote', businessId: 'b1', proposalId: id, yes: false }, FIX);
  assert.equal(no.business.proposals.length, 0);
  assert.equal(no.business.status, 'open');

  const yes = apply(b, { type: 'vote', businessId: 'b1', proposalId: id, yes: true }, FIX);
  assert.equal(yes.business.status, 'closed');
  const pot = b.till + Math.round(b.assets * BUSINESS_DEFAULTS.salvage.closed);
  const paid = Object.values(yes.wealth).reduce((a, x) => a + x, 0);
  assert.ok(pot - paid <= 2 && paid <= pot, `${paid} of ${pot}`);
  assert.ok(yes.wealth.med > yes.wealth.fix, 'the Medtech holds more units');
});

test('a till below zero for two weeks closes the business', () => {
  const b = normalizeBusiness({ ...openClinic(), till: -400 });
  b.state.capacity = 0.5;
  const out = advanceBusiness(b, DAY + 14, { weekday: MONDAY });
  assert.equal(out.business.status, 'closed');
  assert.equal(out.business.closeReason, 'failed');
  assert.equal(out.events.at(-1).type, 'closed');
});

test('hired professionals cost the till, less a Fixer\'s Operator', () => {
  assert.equal(hireFee('good'), 150);
  assert.equal(hireFee('good', 4), 120);
  assert.equal(hireFee('best', 20), 240, 'the discount is capped');
  const b = openClinic();
  const out = apply(b, { type: 'action', businessId: 'b1', action: 'work', use: { kind: 'hire', hire: 'good' } }, MED, { check: check(13, 5, 13), context: { operatorRank: 4 } });
  assert.equal(out.business.till, b.till - 120);
});

test('a complementary check must be a different, related skill from the action\'s own', () => {
  const b = openClinic();
  assert.equal(rollSpec(b, { type: 'assist', forAction: 'work', use: cybertech }, 'med', { day: DAY }).reason, 'bad-use', 'Cybertech works the shop, so it cannot help it');
  assert.equal(rollSpec(b, { type: 'assist', forAction: 'work', use: SKILLS.humanPerception }, 'med', { day: DAY }).ok, true);
  assert.equal(rollSpec(b, { type: 'assist', forAction: 'fixUp', use: { kind: 'ability', ability: 'Maker' } }, 'med', { day: DAY }).reason, 'bad-use', 'Maker fixes the place up itself');
  assert.equal(rollSpec(b, { type: 'assist', forAction: 'work', use: { kind: 'ability', ability: 'Maker' } }, 'med', { day: DAY }).ok, true, 'but can help with the work');
});

test('a failed setup never loses more than half the money put in', () => {
  let b = apply(null, { type: 'found', name: 'Garage', archetype: 'garage', cash: 400 }, MED).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: SKILLS.basicTech }, MED, { check: check(8, -4, 13) }).business;
  assert.equal(b.setup.band, 'fumble');
  assert.equal(b.escrow, 200, 'half of 400, not the 400 that half the lowest setup cost would take');
});

test('gear is read from an item: its market price times how many there are, and only things a business can own', async () => {
  const { itemGear } = await import('../scripts/engine/index.js');
  const kit = { type: 'gear', name: 'Medtech bag', img: 'bag.webp', system: { price: { market: 500 } } };
  assert.deepEqual(itemGear({ ...kit, ownerId: 'med' }, 'med'), { ok: true, name: 'Medtech bag', value: 500, img: 'bag.webp', fromActor: true });
  assert.equal(itemGear(kit, 'med').fromActor, false, 'from the library: a copy, nothing leaves a sheet');
  assert.deepEqual([itemGear({ type: 'ammo', name: 'Basic ammo', system: { price: { market: 10 }, amount: 30 } }, 'med').value, itemGear({ type: 'ammo', name: 'Basic ammo', system: { price: { market: 10 }, amount: 30 } }, 'med').name], [300, 'Basic ammo ×30']);
  assert.equal(itemGear({ ...kit, ownerId: 'fix' }, 'med').reason, 'not-your-item');
  assert.equal(itemGear({ type: 'cyberware', name: 'Cyberarm', system: { price: { market: 500 }, isInstalled: true }, ownerId: 'med' }, 'med').reason, 'item-installed');
  assert.equal(itemGear({ type: 'skill', name: 'Cybertech', system: {} }, 'med').reason, 'bad-item');
  assert.equal(itemGear({ type: 'gear', name: 'Junk', system: { price: { market: 0 } } }, 'med').reason, 'no-price');
});
