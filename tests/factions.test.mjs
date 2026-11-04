import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_DEFAULTS, DISTRICTS, normalizeFaction, standingBand, matchFaction, turfFactions, gigStanding, moveStanding, driftStanding, standingBands, matchBusiness,
  findTarget, targetShare, gigTags, resolveClient, applyBusinessRequest, advanceBusiness, rollSpec, normalizeBusiness, drawEvent, hostileAct, hostileChance, factionEffects, factionFallout,
  giftFor, campaignKind, believability, storyPercent, rollStory, storyCheck, rumourLevel, freshRumours, STORY_RULES, isBigEvent, sceneCandidate, startScene, sceneToRoll, settleScene, supplyCut, runVenue, backupWait, quashEffect, BACK_ROOMS, roomKinds, roomWeek, payOffCost, bookValue, raidChance, roomBust, bustFallout, informants, turnInformant, dealCut, ARCHETYPES, SKILLS, ABILITIES,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';
import { postOffered, postOpen, wageOf, askingWage } from '../scripts/engine/businessStaff.js';
import { projectOffer, startProject } from '../scripts/engine/businessGrowth.js';
import { starterFactions } from '../scripts/data/starter-factions.js';
import { STARTER_COMPANIES } from '../scripts/data/starter-companies.js';

const S = BUSINESS_DEFAULTS.standing;

test('a faction keeps only real districts and a known kind', () => {
  const f = normalizeFaction({ id: 'x', name: '  Tyger   Claws ', kind: 'nonsense', ticker: 'abc', districts: ['watson', 'atlantis', 'watson'] });
  assert.deepEqual([f.name, f.kind, f.ticker, f.districts], ['Tyger Claws', 'other', 'ABC', ['watson']]);
});

test('the bands: hostile, wary, neutral, friendly, allied', () => {
  assert.deepEqual([-61, -60, -21, -20, 0, 19, 20, 59, 60, 100].map((v) => standingBand(v)), ['hostile', 'wary', 'wary', 'neutral', 'neutral', 'neutral', 'friendly', 'friendly', 'allied', 'allied']);
});

test('a gig\'s client names a faction by name, alias or ticker; a district names its gangs', () => {
  const factions = [{ id: 'a', name: 'Biotechnica', ticker: 'BIO', aliases: ['Biotechnica Corp'], districts: [] }, { id: 'b', name: 'Maelstrom', ticker: '', aliases: [], districts: ['ocz'] }];
  assert.equal(matchFaction('biotechnica corp', factions).id, 'a');
  assert.equal(matchFaction('BIO', factions).id, 'a');
  assert.equal(matchFaction('Mr Johnson', factions), null);
  assert.equal(matchFaction('', factions), null);
  assert.deepEqual(turfFactions(factions, 'ocz').map((f) => f.id), ['b']);
  assert.deepEqual(turfFactions(factions, ''), []);
});

test('standing moves by the gig, fades, and cannot be farmed: repeats count less, and a week holds at most the cap', () => {
  assert.equal(gigStanding({ outcome: 'done', reward: 1000 }), S.gig.done);
  assert.equal(gigStanding({ outcome: 'failed', reward: 1000 }), S.gig.failed);
  assert.equal(gigStanding({ outcome: 'done', reward: 100000 }), S.gig.done * S.gig.size[1], 'a big job has a limit');

  const first = moveStanding(null, 10, 100);
  assert.deepEqual([first.applied, first.entry.value], [10, 10]);
  const second = moveStanding(first.entry, 10, 101);
  assert.equal(second.applied, 5, 'a second favour soon after counts half');
  const capped = moveStanding({ value: 0, weekStart: 100, moved: 14, recent: [] }, 10, 101);
  assert.equal(capped.applied, S.weeklyCap - 14, 'the week\'s cap');
  const nextWeek = moveStanding({ value: 14, weekStart: 100, moved: 14, recent: [] }, 10, 107);
  assert.equal(nextWeek.applied, 10, 'a new week');
  assert.equal(moveStanding({ value: 99, weekStart: 0, moved: 0, recent: [] }, 10, 100).entry.value, 100, 'never past 100');

  assert.equal(driftStanding({ value: 10 }).value, 10 - S.drift);
  assert.equal(driftStanding({ value: -10 }).value, -10 + S.drift);
  assert.equal(driftStanding({ value: 1 }).value, 0, 'not past 0');
  assert.deepEqual(standingBands({ a: { value: 30 }, b: { value: -70 } }), { a: 'friendly', b: 'hostile' });
});

test('the starter list: unique ids, real districts, every corporation linked to a starter company', () => {
  const list = starterFactions();
  assert.equal(new Set(list.map((f) => f.id)).size, list.length);
  assert.equal(list.filter((f) => f.kind === 'corp').length, STARTER_COMPANIES.length);
  for (const f of list.filter((x) => x.kind === 'gang')) {
    assert.ok(f.districts.length > 0, f.name);
    for (const d of f.districts) assert.ok(DISTRICTS[d], `${f.name}: ${d}`);
  }
});

test('a tag names a business by its id, name or ticker; a tag on nothing else matches it', () => {
  const businesses = [{ id: 'bus_x', name: 'Charter Test Clinic', status: 'open', company: { ticker: 'SCX' } }, { id: 'bus_y', name: 'Closed Shop', status: 'closed' }];
  for (const notes of ['[NCI: bus_x]', '[NCI: Charter Test Clinic]', '[nci: charter test clinic]', '[NCI: SCX]']) {
    assert.deepEqual(matchBusiness({ notes }, businesses), { businessId: 'bus_x', how: 'tag' }, notes);
  }
  assert.equal(matchBusiness({ notes: '[NCI: ARA]' }, businesses), null, 'a market company is not a business');
  assert.equal(matchBusiness({ notes: '[NCI: Closed Shop]' }, businesses), null);
});

test('a gig\'s target: the GM\'s tag first, then the one faction its text names, never its client', () => {
  const factions = [
    { id: 'mil', name: 'Militech', ticker: 'MIL', aliases: [], districts: [] }, { id: 'bio', name: 'Biotechnica', ticker: 'BIO', aliases: [], districts: [] },
    { id: 'mael', name: 'Maelstrom', ticker: '', aliases: [], districts: [] },
  ];
  const companies = [{ name: 'Orbital Air', ticker: 'ORB' }];
  assert.deepEqual(findTarget({ client: 'Biotechnica', notes: '[NCI target: Militech]' }, factions, companies), { name: 'Militech', factionId: 'mil', ticker: 'MIL', how: 'tag' });
  assert.deepEqual(findTarget({ notes: '[nci target: ORB]' }, factions, companies), { name: 'Orbital Air', factionId: null, ticker: 'ORB', how: 'tag' }, 'a company with no faction');
  assert.equal(findTarget({ notes: '[NCI target: Nobody]' }, factions, companies), null);
  assert.equal(findTarget({ client: 'Militech', notes: '[NCI target: Militech]' }, factions, companies), null, 'not its own client');
  assert.deepEqual(findTarget({ client: 'Biotechnica', desc: 'Hit the Maelstrom crew at the docks.' }, factions), { name: 'Maelstrom', factionId: 'mael', ticker: '', how: 'text' });
  assert.equal(findTarget({ client: 'Biotechnica', desc: 'A Biotechnica courier run.' }, factions), null, 'its own client, mentioned');
  assert.equal(findTarget({ desc: 'Militech and Maelstrom are fighting.' }, factions), null, 'two named: not sure which');
  assert.deepEqual([targetShare('done'), targetShare('failed')], [S.target.done, S.target.failed]);
});

test('the GM\'s tags: client, target and contract, with spaces, in any order; a client tag overrides the client field', () => {
  assert.deepEqual(gigTags('Notes. [NCI target: Night Corp] more [nci contract: Charter Test Clinic] [NCI client: Kiroshi Optical]'), { client: 'Kiroshi Optical', target: 'Night Corp', contract: 'Charter Test Clinic' });
  assert.deepEqual(gigTags('[NCI: ARA]'), { client: '', target: '', contract: '' }, 'the older tag is not these');
  assert.deepEqual(gigTags(undefined), { client: '', target: '', contract: '' });

  const companies = [{ id: 'KIR', ticker: 'KIR', name: 'Kiroshi Optical', aliases: ['Kiroshi'] }, { id: 'ARA', ticker: 'ARA', name: 'Arasaka', aliases: [] }];
  for (const name of ['Kiroshi Optical', 'kiroshi', 'KIR']) {
    const out = resolveClient({ client: 'Arasaka', notes: `[NCI client: ${name}]` }, companies);
    assert.deepEqual([out.status, out.companyId, out.how], ['matched', 'KIR', 'tag'], name);
  }
  assert.equal(resolveClient({ client: 'Mr Johnson', notes: '[NCI client: Nobody Inc]' }, companies).status, 'unmatched', 'a tag naming nobody');
  assert.equal(resolveClient({ client: 'Arasaka', notes: '[NCI: KIR]' }, companies).companyId, 'KIR', 'the older tag still works');

  const businesses = [{ id: 'bus_x', name: 'Charter Test Clinic', status: 'open', company: { ticker: 'SCX' } }];
  assert.deepEqual(matchBusiness({ notes: '[NCI contract: Charter Test Clinic]' }, businesses), { businessId: 'bus_x', how: 'tag' });
  assert.deepEqual(matchBusiness({ notes: '[NCI contract: SCX]' }, businesses), { businessId: 'bus_x', how: 'tag' });
  assert.deepEqual(matchBusiness({ client: 'Someone', notes: '[NCI client: Charter Test Clinic]' }, businesses), { businessId: 'bus_x', how: 'exact' }, 'a business as the client: its own gig');
  assert.equal(matchBusiness({ notes: '[NCI client: Biotechnica]' }, businesses), null);
  const factions = [{ id: 'bio', name: 'Biotechnica', ticker: 'BIO', aliases: [], districts: [] }];
  assert.equal(findTarget({ client: 'Mr Johnson', desc: 'A Biotechnica job', notes: '[NCI client: Biotechnica]' }, factions), null, 'the tagged client is not its own target');
});

// ── F1b: actions aimed at a faction, and what standing does ─────────

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const DAY = 20003;
const checkOf = (die) => ({ ok: true, result: resolveRoll({ base: 14, roll: { total: die, crit: null }, dv: 13 }) });
const LIST = [
  { id: 'tti', name: 'Trauma Team', kind: 'corp', ticker: 'TTI', sector: 'health', districts: [] },
  { id: 'bio', name: 'Biotechnica', kind: 'corp', ticker: 'BIO', sector: 'biotech', districts: [] },
  { id: 'mael', name: 'Maelstrom', kind: 'gang', districts: ['ocz'] },
  { id: 'claws', name: 'Tyger Claws', kind: 'gang', districts: ['ocz'] },
];
const send = (business, request, check, context = {}) => applyBusinessRequest({
  business, request: { key: `k${Math.random()}`, ...request }, actor: MED, day: DAY, check,
  context: { approval: false, weekday: 1, actors: {}, newId: 'b1', seed: 'test', factions: LIST, ...context },
});
function shop({ till = 3000 } = {}) {
  let b = send(null, { type: 'found', name: 'Back Room', archetype: 'clinic', district: 'ocz', cash: 4000 }).business;
  b = send(b, { type: 'setupRoll', businessId: 'b1', use: ARCHETYPES.clinic.trade[0] }, checkOf(9)).business;
  const out = normalizeBusiness({ ...b, till });
  out.state.capacity = 1;
  delete out.period.event;
  return out;
}

test('an aimed action needs a faction of the right kind and the gift; the gift goes whatever the roll', () => {
  const b = shop();
  const use = SKILLS.persuasion;
  assert.equal(rollSpec(b, { type: 'action', action: 'court', use }, 'med', { day: DAY }).reason, 'no-faction');
  assert.equal(rollSpec(b, { type: 'action', action: 'work', factionId: 'tti', use: ARCHETYPES.clinic.trade[0] }, 'med', { day: DAY }).reason, 'bad-faction');
  assert.equal(rollSpec(shop({ till: 50 }), { type: 'action', action: 'court', factionId: 'tti', use }, 'med', { day: DAY }).reason, 'no-gift');
  assert.equal(send(b, { type: 'action', businessId: 'b1', action: 'court', factionId: 'mael', use }, checkOf(9)).reason, 'bad-faction', 'a gang is not courted');
  assert.equal(send(b, { type: 'action', businessId: 'b1', action: 'respects', factionId: 'tti', use }, checkOf(9)).reason, 'bad-faction', 'nor does a corporation take respects');

  const failed = send(b, { type: 'action', businessId: 'b1', action: 'court', factionId: 'tti', use }, checkOf(-5));
  assert.equal(failed.ok, true, failed.reason);
  assert.equal(failed.business.till, b.till - giftFor(b));
  assert.equal(failed.business.ledger.at(-1).kind, 'factionGift');
  const deal = failed.events.find((e) => e.type === 'factionDeal');
  assert.deepEqual([deal.factionId, deal.band], ['tti', 'failure']);
  assert.equal(BUSINESS_DEFAULTS.standing.deal.failure, 0);
  assert.equal(failed.business.period.slots.at(-1).factionName, 'Trauma Team');
});

test('the gift rises with the stage, and a company may aim Contracts and Relations or not at all', () => {
  assert.deepEqual([0, 1, 2, 3].map((stage) => giftFor({ stage })), [100, 300, 1000, 1000]);
  const b = normalizeBusiness({ ...shop(), stage: 2, company: { ticker: 'BRC', sector: 'health', charteredDay: DAY }, officers: ['med'] });
  assert.equal(rollSpec(b, { type: 'action', action: 'contracts', use: SKILLS.business }, 'med', { day: DAY }).ok, true, 'no aim is fine');
  const aimed = send(b, { type: 'action', businessId: 'b1', action: 'contracts', factionId: 'tti', use: SKILLS.business }, checkOf(9));
  assert.equal(aimed.ok, true, aimed.reason);
  assert.equal(aimed.business.till, b.till - 1000);
  assert.equal(send(b, { type: 'action', businessId: 'b1', action: 'contracts', factionId: 'mael', use: SKILLS.business }, checkOf(9)).reason, 'bad-faction');
  const unaimed = send(b, { type: 'action', businessId: 'b1', action: 'contracts', use: SKILLS.business }, checkOf(9));
  assert.equal(unaimed.business.till, b.till, 'no aim, no gift');
  assert.ok(!unaimed.events.some((e) => e.type === 'factionDeal'));
});

test('standing moves running costs and protection money, each within its cap; the business\'s sector is what counts', () => {
  const with_ = (standings, archetype = 'clinic') => factionEffects({ archetype, district: 'ocz', standings }, LIST);
  assert.deepEqual(['allied', 'friendly', 'neutral', 'wary', 'hostile'].map((band) => with_({ tti: band }).cost.toFixed(2)), ['0.90', '0.95', '1.00', '1.05', '1.10']);
  assert.equal(with_({ bio: 'allied' }).cost, 1, 'another sector\'s corporation does nothing');
  assert.equal(factionEffects({ archetype: 'bar', company: { sector: 'health' }, standings: { tti: 'allied' } }, LIST).cost.toFixed(2), '0.90', 'a company goes by its own sector');
  assert.deepEqual(['allied', 'friendly', 'wary', 'hostile'].map((band) => with_({ mael: band }).protection), [0.5, 0.75, 1.25, 1.5]);
  assert.equal(with_({ mael: 'allied', claws: 'allied' }).protection, 0.5, 'capped');
  assert.equal(with_({ mael: 'allied', claws: 'hostile' }).protection, 1, 'a friend and an enemy cancel out');
  assert.equal(with_({ mael: 'friendly' }).shakedown, 0.75);

  const corps = [{ id: 'a', kind: 'corp', sector: 'health' }, { id: 'b', kind: 'corp', sector: 'health' }];
  assert.equal(factionEffects({ archetype: 'clinic', standings: { a: 'hostile', b: 'hostile' } }, corps).cost, 1.15, 'costs are capped at 15%');
});

test('at the close, friendly terms lower the upkeep and hostile ones raise it, without changing the stored Cost base', () => {
  const b = shop();
  const close = (relations) => advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test', relations }).business;
  const none = close(null);
  const good = close({ cost: 0.9, protection: 0.5, shakedown: 0.5, gangs: [], hostile: [] });
  const bad = close({ cost: 1.1, protection: 1.5, shakedown: 1.5, gangs: [], hostile: [] });
  const upkeep = (x) => x.digests.at(-1).upkeep;
  assert.ok(upkeep(good) < upkeep(none) && upkeep(none) < upkeep(bad), `${upkeep(good)} ${upkeep(none)} ${upkeep(bad)}`);
  assert.equal(good.state.costFactor, none.state.costFactor);
  const costs = good.digests.at(-1).costs;
  assert.equal(costs.running + costs.rent + costs.licence + costs.protection, upkeep(good), 'the cashbook still adds up');
});

test('a hostile faction may act, at most 15% of weeks, and names itself; no hostile faction leaves the draws as they were', () => {
  assert.deepEqual([-60, -80, -100].map((v) => hostileChance(v).toFixed(2)), ['0.05', '0.10', '0.15']);
  const b = shop();
  const week = (i) => ({ ...b, period: { ...b.period, index: i } });
  assert.equal(hostileAct(b, 'test', BUSINESS_DEFAULTS, null), null);
  assert.equal(hostileAct(b, 'test', BUSINESS_DEFAULTS, { hostile: [] }), null);

  const acts = (faction) => Array.from({ length: 2000 }, (_, i) => hostileAct(week(i), 'test', BUSINESS_DEFAULTS, { hostile: [faction] })).filter(Boolean);
  const corp = acts({ id: 'tti', name: 'Trauma Team', kind: 'corp', value: -100 });
  assert.ok(corp.length > 220 && corp.length < 380, `about 15%: ${corp.length}`);
  assert.deepEqual([...new Set(corp.map((a) => a.kind))].sort(), ['raid', 'smear'], 'no staff to poach');
  assert.equal(corp[0].factionName, 'Trauma Team');
  const gang = acts({ id: 'mael', name: 'Maelstrom', kind: 'gang', value: -100 });
  assert.deepEqual([...new Set(gang.map((a) => a.kind))].sort(), ['raid', 'sabotage']);

  const plain = Array.from({ length: 200 }, (_, i) => drawEvent(week(i), 'test')?.kind ?? null);
  const quiet = { cost: 1, protection: 1, shakedown: 1, gangs: [], hostile: [] };
  assert.deepEqual(Array.from({ length: 200 }, (_, i) => drawEvent(week(i), 'test', BUSINESS_DEFAULTS, null, quiet)?.kind ?? null), plain);
});

test('friendly gangs bring fewer shakedowns and hostile ones more, and a shakedown names a gang on the turf', () => {
  const b = shop();
  const count = (factor) => Array.from({ length: 3000 }, (_, i) => drawEvent({ ...b, period: { ...b.period, index: i } }, 'test', BUSINESS_DEFAULTS, null, { shakedown: factor, gangs: [{ id: 'mael', name: 'Maelstrom' }, { id: 'claws', name: 'Tyger Claws' }] })).filter((e) => e?.kind === 'shakedown');
  const [few, usual, many] = [0.5, 1, 1.5].map(count);
  assert.ok(few.length < usual.length && usual.length < many.length, `${few.length} ${usual.length} ${many.length}`);
  assert.deepEqual([...new Set(usual.map((e) => e.factionName))].sort(), ['Maelstrom', 'Tyger Claws']);
  const none = drawEvent({ ...b, period: { ...b.period, index: 1 } }, 'test');
  assert.equal(none?.factionId, undefined);
});

test('what a faction\'s event leaves behind: force costs standing, a raid Exposure, a smear the price, each only when it counts', () => {
  const withEvent = (kind, slots = [], staff = []) => ({ staff, period: { index: 7, event: { kind, factionId: 'mael', factionName: 'Maelstrom' }, slots } });
  const combat = `ability:${ABILITIES.combatAwareness.ability}`;
  const answered = { outcome: 'answered' };
  const by = (use, who = 'med') => [{ action: 'respond', use, by: who }];
  assert.deepEqual(factionFallout(withEvent('shakedown', by(combat)), answered), [{ type: 'factionMove', factionId: 'mael', amount: -3 }]);
  assert.deepEqual(factionFallout(withEvent('shakedown', by('skill:Persuasion')), answered), [], 'talking costs nothing');
  assert.deepEqual(factionFallout(withEvent('shakedown', by(undefined, 's1'), [{ id: 's1', post: 'security' }]), answered).map((e) => e.amount), [-3], 'security staff count as force');
  assert.deepEqual(factionFallout(withEvent('shakedown', by(combat)), { outcome: 'failed' }), [], 'losing the fight is not beating them');
  assert.deepEqual(factionFallout(withEvent('raid'), { outcome: 'unanswered' }).map((e) => e.exposure), [5]);
  assert.deepEqual(factionFallout(withEvent('raid'), { outcome: 'failed' }).map((e) => e.exposure), [3]);
  assert.deepEqual(factionFallout(withEvent('raid'), answered), []);
  assert.deepEqual(factionFallout(withEvent('smear'), { outcome: 'fumbled' }).map((e) => [e.amount, e.period]), [[-0.02, 7]]);
  assert.deepEqual(factionFallout(withEvent('smear'), { outcome: 'failed' }).map((e) => e.amount), [-0.01]);
  assert.deepEqual(factionFallout({ staff: [], period: { event: { kind: 'shakedown' }, slots: by(combat) } }, answered), [], 'no gang, no standing');
  assert.deepEqual(factionFallout(withEvent('smear'), null), []);
});

test('closing real weeks brings a hostile faction\'s acts and names the gang in a shakedown, and without them leaves the weeks as they were', () => {
  const weeks = (relations, n = 80) => {
    let b = shop();
    const events = [];
    for (let i = 0; i < n; i++) {
      b = advanceBusiness({ ...b, till: 50000 }, b.period.endDay, { weekday: 1, seed: 'test', relations }).business;
      events.push(b.period.event ?? null);
    }
    return events;
  };
  const quiet = { cost: 1, protection: 1, shakedown: 1, gangs: [], hostile: [] };
  const hostile = weeks({ ...quiet, hostile: [{ id: 'mael', name: 'Maelstrom', kind: 'gang', value: -100 }] });
  const acts = hostile.filter((e) => e?.factionId === 'mael');
  assert.ok(acts.length > 3, `a hostile faction acts in real weeks: ${acts.length}`);
  assert.ok(acts.every((e) => ['sabotage', 'raid', 'poaching', 'shakedown'].includes(e.kind) && e.factionName === 'Maelstrom'));

  const turf = weeks({ ...quiet, gangs: [{ id: 'claws', name: 'Tyger Claws' }] }).filter((e) => e?.kind === 'shakedown');
  assert.ok(turf.length > 0 && turf.every((e) => e.factionName === 'Tyger Claws'), 'a shakedown names the gang');
  assert.deepEqual(weeks(quiet).map((e) => e?.kind ?? null), weeks(null).map((e) => e?.kind ?? null), 'nothing changes with no factions involved');
});

// ── F1c: smear and leak campaigns ───────────────────────────────────

test('a campaign needs a target, the cash and a month since the last one; the cost goes whatever the roll', () => {
  const b = shop();
  const use = SKILLS.persuasion;
  const companies = [{ ticker: 'ARA', name: 'Arasaka' }, { ticker: 'SCX', name: 'Own Co' }];
  const run = (business, die, ticker = 'ARA', context = {}) => send(business, { type: 'action', businessId: 'b1', action: 'campaign', targetTicker: ticker, use }, checkOf(die), { companies, ...context });
  assert.equal(rollSpec(b, { type: 'action', action: 'campaign', use }, 'med', { day: DAY }).reason, 'no-target');
  assert.equal(rollSpec(shop({ till: 500 }), { type: 'action', action: 'campaign', targetTicker: 'ARA', use }, 'med', { day: DAY }).reason, 'no-gift');
  assert.equal(rollSpec({ ...b, company: { ticker: 'ARA' } }, { type: 'action', action: 'campaign', targetTicker: 'ARA', use }, 'med', { day: DAY }).reason, 'bad-target', 'not its own');
  assert.equal(run(b, 9, 'NOPE').reason, 'bad-target');

  const missed = run(b, -5);
  assert.equal(missed.ok, true, missed.reason);
  assert.equal(missed.business.till, b.till - BUSINESS_DEFAULTS.campaign.cost);
  assert.equal(missed.business.campaign, null, 'a failure reaches nobody');
  assert.equal(missed.business.ledger.at(-1).kind, 'campaign');
  assert.equal(rollSpec({ ...missed.business, period: { ...missed.business.period, slots: [] } }, { type: 'action', action: 'campaign', targetTicker: 'ARA', use }, 'med', { day: DAY + 27 }).reason, 'campaign-wait');
  assert.equal(rollSpec({ ...missed.business, period: { ...missed.business.period, slots: [] } }, { type: 'action', action: 'campaign', targetTicker: 'ARA', use }, 'med', { day: DAY + 28 }).ok, true);

  const waits = run(b, 9).business.campaign;
  assert.deepEqual([waits.status, waits.ticker, waits.name, waits.kind, waits.actorId], ['awaiting', 'ARA', 'Arasaka', 'smear', 'med']);
  assert.ok(waits.percent < 0 && waits.percent >= -2);
  const straight = run(b, 9, 'ARA', { campaignApproval: false });
  assert.equal(straight.business.campaign, null);
  assert.equal(straight.events.find((e) => e.type === 'campaignLands').campaign.ticker, 'ARA', 'with approval off it lands at once');
  assert.equal(campaignKind('skill:Library Search'), 'leak');
  assert.equal(campaignKind('ability:Interface'), 'leak');
  assert.equal(campaignKind('skill:Persuasion'), 'smear');
  assert.equal(campaignKind('staff:s1'), 'smear');

  const caught = send(b, { type: 'action', businessId: 'b1', action: 'campaign', targetTicker: 'ARA', use }, { ok: true, result: resolveRoll({ base: 14, roll: { total: -5, crit: 'fumble' }, dv: 13 }) }, { companies });
  const event = caught.events.find((e) => e.type === 'campaignCaught');
  assert.deepEqual([event.ticker, event.exposure], ['ARA', BUSINESS_DEFAULTS.campaign.caughtExposure]);
});

// ── F1c: Media stories ──────────────────────────────────────────────

test('Believability by rank, evidence as the rules have it, and a price move within the rank\'s limit, either way', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rank) => believability(rank)), [2, 2, 3, 3, 4, 4, 5, 5, 6, 7]);
  assert.deepEqual([0, 1, 4, 5].map((n) => believability(5, n)), [4, 5, 5, 7]);
  assert.equal(believability(10, 5), 10, 'never past 10');
  assert.deepEqual([1, 3, 5, 7, 9].map((rank) => storyPercent(rank, 3, 'puff')), [2, 4, 7, 10, 12]);
  assert.deepEqual([1, 3, 5, 7, 9].map((rank) => storyPercent(rank, 0, 'expose')), [-1.2, -2.4, -4.2, -6, -7.2]);
  assert.deepEqual(rollStory({ rank: 5, pieces: 1, die: 5, angle: 'expose' }), { target: 5, believed: true, percent: -4.2 });
  assert.deepEqual(rollStory({ rank: 5, pieces: 0, die: 5, angle: 'expose' }), { target: 4, believed: false, percent: 0 });
});

test('who may publish: a Media, once a week, and with new evidence for a company just in the news', () => {
  const base = { rank: 4, angle: 'expose', ticker: 'ARA', day: 100, actorId: 'a', pieces: 0, recent: [] };
  assert.equal(storyCheck(base).ok, true);
  assert.equal(storyCheck({ ...base, rank: 0 }).reason, 'not-media');
  assert.equal(storyCheck({ ...base, angle: 'rant' }).reason, 'bad-angle');
  assert.equal(storyCheck({ ...base, ticker: '' }).reason, 'no-target');
  assert.equal(storyCheck({ ...base, recent: [{ actorId: 'a', ticker: 'BIO', day: 94 }] }).reason, 'story-wait');
  assert.equal(storyCheck({ ...base, recent: [{ actorId: 'a', ticker: 'BIO', day: 93 }] }).ok, true);
  const topic = [{ actorId: 'b', ticker: 'ARA', day: 80 }];
  assert.equal(storyCheck({ ...base, recent: topic }).reason, 'story-same-topic');
  assert.equal(storyCheck({ ...base, recent: topic, pieces: 1 }).ok, true, 'new evidence');
  assert.equal(storyCheck({ ...base, recent: [{ actorId: 'b', ticker: 'ARA', day: 70 }] }).ok, true, 'long enough ago');
});

test('how much a rumour says, and what a Media has not heard', () => {
  const { passive, active } = STORY_RULES.rumour;
  assert.deepEqual([6, 7, 9, 11, 13, 20].map((t) => rumourLevel(t, passive)), [-1, 0, 1, 2, 3, 3]);
  assert.deepEqual([12, 13, 15, 17, 21].map((t) => rumourLevel(t, active)), [-1, 0, 1, 2, 3]);
  const sources = [{ sourceKey: 'a' }, { sourceKey: 'b', by: 'me' }, { sourceKey: 'c' }];
  assert.deepEqual(freshRumours(sources, {}, 0, 'me').map((s) => s.sourceKey), ['a', 'c'], 'not their own');
  assert.deepEqual(freshRumours(sources, { a: 1 }, 1, 'me').map((s) => s.sourceKey), ['c'], 'not what they have heard at that level');
  assert.deepEqual(freshRumours(sources, { a: 1 }, 2, 'me').map((s) => s.sourceKey), ['a', 'c'], 'more of the same is news');
});

// ── X1: big events as scenes ────────────────────────────────────────

test('which events are big, and only an unanswered one can become a scene', () => {
  assert.deepEqual(['raid', 'sabotage', 'smear', 'collectors', 'grudge'].map((kind) => isBigEvent({ kind })), [true, true, true, true, true]);
  assert.equal(isBigEvent({ kind: 'theft' }), false);
  assert.equal(isBigEvent({ kind: 'shakedown', factionId: 'x' }), false, 'an ordinary shakedown');
  assert.equal(isBigEvent({ kind: 'shakedown', factionId: 'x', heavy: true }), true);
  assert.equal(isBigEvent({ kind: 'poaching', staffId: 's' }), false, 'an ordinary poaching');
  assert.equal(isBigEvent({ kind: 'poaching', staffId: 's', factionId: 'x' }), true);
  assert.equal(isBigEvent(null), false);
  const b = shop();
  b.period.event = { kind: 'raid', factionId: 'tti', factionName: 'Trauma Team' };
  assert.equal(sceneCandidate(b).kind, 'raid');
  assert.equal(sceneCandidate({ ...b, period: { ...b.period, slots: [{ action: 'respond' }] } }), null);
  assert.equal(sceneCandidate({ ...b, scene: { event: { kind: 'raid' } } }), null);
});

test('a scene leaves the week, the weeks run on, and it waits; won, lost or back to a roll', () => {
  const start = () => {
    const b = structuredClone(shop());
    b.period.event = { kind: 'raid', factionId: 'tti', factionName: 'Trauma Team' };
    b.digests = [{ index: 1, takings: 1000 }];
    b.state.compliance = 50;
    return b;
  };
  const b = start();
  assert.equal(startScene(b, DAY).ok, true);
  assert.equal(b.period.event, null);
  assert.equal(b.scene.event.kind, 'raid');
  assert.equal(startScene(b, DAY).reason, 'no-scene');
  const later = advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test' }).business;
  assert.equal(later.scene.event.kind, 'raid', 'a week closing leaves it waiting');
  assert.equal(later.digests.at(-1).event, undefined, 'and it costs that week nothing');

  const won = structuredClone(b);
  const rep = won.state.reputation;
  const till = won.till;
  assert.deepEqual(settleScene(won, true, DAY), { ok: true, events: [] });
  assert.equal(won.state.reputation, rep + BUSINESS_DEFAULTS.scene.wonReputation);
  assert.deepEqual([won.scene, won.till], [null, till]);
  assert.equal(settleScene(won, true, DAY).reason, 'no-scene');

  const lost = structuredClone(b);
  const out = settleScene(lost, false, DAY);
  assert.equal(lost.till, till - 150, '15% of the last week');
  assert.equal(lost.state.compliance, 42, 'the raid\'s own hit');
  assert.equal(out.events[0].exposure, BUSINESS_DEFAULTS.standing.hostile.raidExposure, 'and what it leaves behind');
  assert.equal(lost.ledger.at(-1).kind, 'sceneLost');

  const back = structuredClone(b);
  assert.equal(sceneToRoll(back).ok, true);
  assert.deepEqual([back.scene, back.period.event.kind], [null, 'raid']);
  const busy = structuredClone(b);
  busy.period.event = { kind: 'theft' };
  assert.equal(sceneToRoll(busy).reason, 'event-busy');
});

test('a lost poaching scene takes the employee, unless they are devoted', () => {
  const start = (loyalty) => {
    const b = structuredClone(shop());
    b.staff = [{ id: 's1', name: 'Nix', status: 'active', post: 'floor', wage: 100, loyalty }];
    b.scene = { event: { kind: 'poaching', staffId: 's1', factionId: 'tti' }, day: DAY };
    settleScene(b, false, DAY);
    return b.staff.length;
  };
  assert.equal(start(50), 0);
  assert.equal(start(BUSINESS_DEFAULTS.staff.loyalty.devoted), 1);
});

test('a shakedown is heavy when the gang is hostile', () => {
  const b = shop();
  const draws = (relations) => Array.from({ length: 3000 }, (_, i) => drawEvent({ ...b, period: { ...b.period, index: i } }, 'test', BUSINESS_DEFAULTS, null, relations)).filter((e) => e?.kind === 'shakedown');
  const gangs = [{ id: 'mael', name: 'Maelstrom' }];
  assert.ok(draws({ shakedown: 1, gangs, hostile: [{ id: 'mael' }] }).every((e) => e.heavy));
  assert.ok(draws({ shakedown: 1, gangs, hostile: [] }).every((e) => !e.heavy));
});

// ── X1: Nomads, Rockerboys and Lawmen ───────────────────────────────

test('a Nomad\'s supply contract cuts running costs for four weeks, and a fumble loses the shipment', () => {
  const b = shop();
  const before = b.till;
  const moto = ABILITIES.moto;
  const out = send(b, { type: 'action', businessId: 'b1', action: 'supply', use: moto }, checkOf(9));
  assert.equal(out.ok, true, out.reason);
  const { cut, until } = out.business.supply;
  assert.ok(cut >= 0.03 && cut <= 0.1);
  assert.equal(until, b.period.index + 3);
  assert.equal(out.business.till, before, 'nothing spent on a pass');
  assert.deepEqual([b.period.index, until, until + 1].map((i) => supplyCut(out.business, i)), [cut, cut, 0], 'four weeks, then over');
  assert.equal(supplyCut(b, b.period.index), 0);

  const lost = send(b, { type: 'action', businessId: 'b1', action: 'supply', use: moto }, { ok: true, result: resolveRoll({ base: 14, roll: { total: -5, crit: 'fumble' }, dv: 13 }) });
  assert.equal(lost.business.till, before - BUSINESS_DEFAULTS.roles.supply.shipment[0]);
  assert.equal(lost.business.ledger.at(-1).kind, 'shipmentLost');
  assert.equal(lost.business.supply, null);

  const close = (x) => advanceBusiness(x, x.period.endDay, { weekday: 1, seed: 'test' }).business.digests.at(-1).costs.running;
  assert.ok(close(out.business) < close(b), 'the close charges less');
});

test('a role\'s own action takes that role: no hired help, and only the ability', () => {
  const b = shop();
  assert.equal(rollSpec(b, { type: 'action', action: 'supply', use: { kind: 'hire', hire: 'good' } }, 'med', { day: DAY }).reason, 'hire-not-allowed');
  assert.equal(rollSpec(b, { type: 'action', action: 'supply', use: SKILLS.persuasion }, 'med', { day: DAY }).reason, 'bad-use');
  assert.equal(rollSpec(b, { type: 'action', action: 'venue', use: ABILITIES.moto }, 'med', { day: DAY }).reason, 'bad-use');
  assert.equal(rollSpec(b, { type: 'action', action: 'venue', use: ABILITIES.charismaticImpact }, 'med', { day: DAY }).ok, true);
  const company = normalizeBusiness({ ...b, stage: 2, company: { ticker: 'BRC', sector: 'health', charteredDay: DAY }, officers: ['med'] });
  assert.equal(rollSpec(company, { type: 'action', action: 'supply', use: ABILITIES.moto }, 'med', { day: DAY }).ok, true, 'a company too');
});

test('a Rockerboy\'s gig lifts takings and Reputation, more at a bar, within the limit on a boost', () => {
  const at = (archetype, band) => {
    const b = { archetype, boost: 0, state: { reputation: 50 } };
    runVenue(b, { band });
    return [Math.round(b.boost * 1000) / 1000, b.state.reputation];
  };
  assert.deepEqual(at('clinic', 'solid'), [0.1, 52]);
  assert.deepEqual(at('bar', 'solid'), [0.15, 53]);
  assert.deepEqual(at('clinic', 'failure'), [0, 50]);
  assert.deepEqual(at('clinic', 'fumble'), [-0.05, 48]);
  const capped = { archetype: 'bar', boost: 0.25, state: { reputation: 99 } };
  runVenue(capped, { band: 'exceptional' });
  assert.deepEqual([capped.boost, capped.state.reputation], [BUSINESS_DEFAULTS.gigs.boostCap, 100]);
});

test('a Lawman\'s Backup answers a raid once a month for a business, and quashing heat by the roll', () => {
  const b = shop();
  b.period.event = { kind: 'raid' };
  const backup = ABILITIES.backup;
  const first = send(b, { type: 'respond', businessId: 'b1', use: backup }, checkOf(9));
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.business.lastBackupDay, DAY);
  const again = { ...first.business, period: { ...first.business.period, slots: [], event: { kind: 'raid' } } };
  assert.equal(rollSpec(again, { type: 'respond', use: backup }, 'med', { day: DAY + 27 }).reason, 'bad-use');
  assert.equal(rollSpec(again, { type: 'respond', use: backup }, 'med', { day: DAY + 28 }).ok, true);
  assert.equal(rollSpec(again, { type: 'respond', use: SKILLS.persuasion }, 'med', { day: DAY + 1 }).ok, true, 'other answers are fine');
  assert.deepEqual([backupWait(again, DAY + 10), backupWait(again, DAY + 28), backupWait(b, DAY)], [18, 0, 0]);
  const shakedown = { ...first.business, period: { ...first.business.period, slots: [], event: { kind: 'shakedown' } } };
  assert.equal(rollSpec(shakedown, { type: 'respond', use: backup }, 'med', { day: DAY + 1 }).ok, true, 'only a raid is limited');

  const q = BUSINESS_DEFAULTS.roles.quash;
  assert.deepEqual(quashEffect('solid'), { outcome: 'success', reduce: q.reduce, add: 0 });
  assert.deepEqual(quashEffect('failure'), { outcome: 'failure', reduce: 0, add: 0 });
  assert.deepEqual(quashEffect('fumble'), { outcome: 'fumble', reduce: 0, add: q.fumble });
  assert.ok(BUSINESS_DEFAULTS.regulator.uses.some((u) => u.ability === 'Backup'));
});

// ── U1a: back rooms and dirty cash ──────────────────────────────────

const withRoom = (extra = {}) => normalizeBusiness({ ...shop(), backRoom: { kind: 'ripping', status: 'open', dirty: 1000, day: DAY, ...extra } });

test('every front has a back room with real skills, and every kind has words', () => {
  for (const [front, kinds] of Object.entries(BACK_ROOMS)) {
    assert.ok(ARCHETYPES[front], front);
    for (const [kind, { uses }] of Object.entries(kinds)) {
      assert.ok(uses.length > 0 && uses.every((u) => u?.kind), `${front} ${kind}`);
    }
  }
  assert.deepEqual(Object.keys(ARCHETYPES).filter((a) => !BACK_ROOMS[a]), []);
  assert.deepEqual(roomKinds({ archetype: 'bar' }), ['gambling', 'brothel', 'fightPit', 'fixersRoom']);
});

test('opening one: a project a shop can vote for, off the books, that waits for the GM', () => {
  const b = shop();
  const assets = b.assets;
  assert.equal(projectOffer(b, 'backRoom').ok, true);
  assert.equal(projectOffer({ ...b, stage: 2 }, 'backRoom').reason, 'not-at-company');
  assert.equal(projectOffer({ ...b, backRoom: { kind: 'ripping' } }, 'backRoom').reason, 'has-back-room');
  const started = structuredClone(b);
  assert.equal(startProject(started, 'backRoom', 'p1', DAY, BUSINESS_DEFAULTS, 'ripping').ok, true);
  assert.equal(started.assets, assets, 'nothing on the books');
  assert.equal(started.till, b.till - BUSINESS_DEFAULTS.projects.backRoom.cost[0]);
  assert.equal(started.projects.at(-1).room, 'ripping');
  const proposed = (room, context) => send(b, { type: 'propose', businessId: 'b1', kind: 'project', project: 'backRoom', room }, null, context);
  assert.equal(proposed('gambling').reason, 'bad-project', 'not what a clinic hides');
  assert.equal(proposed('fightPit').reason, 'bad-project', 'a kind from another front');
  assert.equal(proposed('ripping', { underworld: false }).reason, 'bad-project', 'switched off');
  assert.equal(proposed('ripping').ok, true);
});

test('working it earns dirty cash and adds Exposure; lying low stops the work and cuts Exposure', () => {
  const b = withRoom({ dirty: 0 });
  b.state.capacity = 1;
  const rules = BUSINESS_DEFAULTS.backRoom;
  b.period.slots = [{ action: 'roomWork', band: 'solid', approach: 'standard' }];
  const out = roomWeek(b, 1000);
  assert.equal(out.earned, Math.round(ARCHETYPES.clinic.takings * rules.share * BUSINESS_DEFAULTS.effects.work.solid));
  assert.equal(b.backRoom.dirty, out.earned);
  assert.equal(out.exposure, rules.workExposure.solid);
  const fumble = withRoom({ dirty: 0 });
  fumble.period.slots = [{ action: 'roomWork', band: 'fumble', approach: 'standard' }];
  assert.deepEqual([roomWeek(fumble, 1000).earned, fumble.backRoom.dirty], [0, 0]);
  const low = withRoom();
  low.period.slots = [{ action: 'lieLow', band: 'solid' }, { action: 'roomWork', band: 'solid', approach: 'standard' }];
  const lying = roomWeek(low, 1000);
  assert.deepEqual([lying.low, lying.earned, lying.exposure], [true, 0, -rules.lieLow]);
  assert.equal(roomWeek(shop(), 1000), null, 'no back room');
  assert.equal(roomWeek(withRoom({ status: 'pending' }), 1000), null, 'not yet open');
});

test('laundering is capped by the week\'s legitimate takings, and a bookkeeper makes it cleaner', () => {
  const run = (band, dirty = 1000, staff = []) => {
    const b = withRoom({ dirty });
    b.staff = staff;
    b.period.slots = [{ action: 'launder', band }];
    const till = b.till;
    const out = roomWeek(b, 1000);
    return { moved: out.laundered, exposure: out.exposure, cash: b.till - till, left: b.backRoom.dirty };
  };
  assert.deepEqual(run('strong'), { moved: 300, exposure: 0, cash: 300, left: 700 }, '30% of the takings');
  assert.deepEqual(run('narrow'), { moved: 150, exposure: 2, cash: 150, left: 850 });
  assert.deepEqual(run('failure'), { moved: 0, exposure: 2, cash: 0, left: 1000 });
  assert.deepEqual(run('strong', 100), { moved: 100, exposure: 0, cash: 100, left: 0 }, 'only what there is');
  assert.equal(run('narrow', 1000, [{ status: 'active', post: 'bookkeeper' }]).exposure, 1);
});

test('a pay-off spends dirty cash, and actions need a room and the money; taking it leaves a trail', () => {
  const b = withRoom();
  b.period.slots = [{ action: 'payOff', band: 'strong' }];
  const out = roomWeek(b, 1000);
  assert.deepEqual([out.paid, out.exposure, b.backRoom.dirty], [150, -7, 850]);
  assert.equal(payOffCost({ stage: 1 }), 300);
  const use = SKILLS.bribery;
  assert.equal(rollSpec(shop(), { type: 'action', action: 'payOff', use }, 'med', { day: DAY }).reason, 'no-back-room');
  assert.equal(rollSpec(withRoom({ dirty: 100 }), { type: 'action', action: 'payOff', use }, 'med', { day: DAY }).reason, 'no-dirty');
  assert.equal(rollSpec(withRoom(), { type: 'action', action: 'payOff', use }, 'med', { day: DAY }).ok, true);
  assert.equal(rollSpec(withRoom({ dirty: 0 }), { type: 'action', action: 'launder', use: SKILLS.accounting }, 'med', { day: DAY }).reason, 'no-dirty');
  assert.equal(rollSpec(withRoom(), { type: 'action', action: 'roomWork', use: SKILLS.cybertech }, 'med', { day: DAY }).ok, true);
  assert.equal(rollSpec(withRoom(), { type: 'action', action: 'roomWork', use: SKILLS.trading }, 'med', { day: DAY }).reason, 'bad-use');
  const lying = withRoom();
  lying.stage = 1;
  lying.period.slots = [{ action: 'lieLow', band: 'solid' }];
  assert.equal(rollSpec(lying, { type: 'action', action: 'roomWork', use: SKILLS.cybertech }, 'med', { day: DAY }).reason, 'lying-low');
});

test('taking dirty cash: to the partner, Exposure per thousand, never more than there is', () => {
  const b = withRoom({ dirty: 2500 });
  const before = b.till;
  const taken = send(b, { type: 'takeDirty', businessId: 'b1', amount: 2100 });
  assert.equal(taken.ok, true, taken.reason);
  assert.equal(taken.business.backRoom.dirty, 400);
  assert.equal(taken.business.till, before, 'not from the cash');
  assert.equal(taken.wealth.med, 2100);
  assert.equal(taken.events.find((e) => e.type === 'dirtyTaken').exposure, 6);
  assert.equal(send(b, { type: 'takeDirty', businessId: 'b1', amount: 3000 }).reason, 'no-dirty');
  assert.equal(send(b, { type: 'takeDirty', businessId: 'b1', amount: 0 }).reason, 'bad-amount');
});

test('dirty cash is off the books, and a week closes with it in the digest', () => {
  const b = withRoom({ dirty: 500 });
  b.state.capacity = 1;
  const book = bookValue(shop());
  assert.equal(bookValue(b), book, 'not in book value');
  b.period.slots = [{ action: 'roomWork', band: 'solid', approach: 'standard', by: 'med' }];
  const closed = advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test' });
  const digest = closed.business.digests.at(-1);
  assert.ok(digest.room.earned > 0);
  assert.equal(digest.takings, advanceBusiness(withRoom({ dirty: 0, status: 'pending' }), b.period.endDay, { weekday: 1, seed: 'test' }).business.digests.at(-1).takings, 'the shop\'s takings are its own');
  assert.ok(closed.events.some((e) => e.type === 'backRoomWeek' && e.exposure > 0));
});

// ── U1b: raids and informants ───────────────────────────────────────

const staffer = (id, extra = {}) => ({ id, name: id, status: 'active', source: 'npc', post: 'floor', wage: 100, loyalty: 50, ...extra });

test('the odds of a raid: by Exposure, an informant and sullen staff; none without an open room or a known Exposure', () => {
  const b = withRoom();
  assert.deepEqual([0, 5, 15, 30].map((e) => raidChance(b, e)), [0, 0.03, 0.1, 0.25]);
  const staffed = { ...b, staff: [staffer('a'), staffer('b', { loyalty: 10 }), staffer('c', { loyalty: 20 }), staffer('d', { loyalty: 25 }), staffer('e', { loyalty: 5 }), staffer('f', { loyalty: 10, source: 'pc' })] };
  assert.equal(raidChance(staffed, 0), 0.06, 'each sullen one, within the cap, player characters aside');
  assert.equal(Math.round(raidChance({ ...b, staff: [staffer('a')] }, 5, { a: 'informant' }) * 100), 8);
  assert.equal(roomBust(shop(), 'test', BUSINESS_DEFAULTS, { exposure: 30 }), null, 'no room');
  assert.equal(roomBust(b, 'test', BUSINESS_DEFAULTS, null), null, 'no hidden state known');
  const week = (i) => ({ ...b, period: { ...b.period, index: i } });
  const raids = Array.from({ length: 2000 }, (_, i) => roomBust(week(i), 'test', BUSINESS_DEFAULTS, { exposure: 30 })).filter(Boolean);
  assert.ok(raids.length > 420 && raids.length < 580, `about 25%: ${raids.length}`);
  assert.equal(raids[0].kind, 'bust');
  assert.equal(Array.from({ length: 500 }, (_, i) => roomBust(week(i), 'test', BUSINESS_DEFAULTS, { exposure: 0 })).filter(Boolean).length, 0, 'clean means none');
});

test('what a raid leaves behind: a win, a failure, the worst, and high Exposure', () => {
  const r = BUSINESS_DEFAULTS.backRoom.raid;
  const run = (outcome, room = {}) => {
    const b = withRoom({ dirty: 1000, ...room });
    const till = b.till;
    const events = bustFallout(b, { kind: 'bust' }, outcome, DAY);
    return { events, dirty: b.backRoom.dirty, status: b.backRoom.status, fine: till - b.till };
  };
  assert.deepEqual(run('answered'), { events: [{ type: 'bustWon', exposure: -r.winClear }], dirty: 1000, status: 'open', fine: 0 });
  assert.deepEqual(run('failed'), { events: [{ type: 'bustLost', seized: 500, fine: r.fineFail, shut: false, heat: 0 }], dirty: 500, status: 'open', fine: r.fineFail });
  assert.deepEqual(run('unanswered'), { events: [{ type: 'bustLost', seized: 1000, fine: r.fineLost, shut: true, heat: r.heat }], dirty: 0, status: 'shut', fine: r.fineLost });
  assert.equal(run('fumbled').status, 'shut');
  assert.equal(run('failed', { band: 'high' }).status, 'shut', 'high Exposure shuts it on a failure too');
  assert.deepEqual(bustFallout(withRoom(), { kind: 'raid' }, 'unanswered', DAY), [], 'a tipped-off raid is another thing');
  assert.deepEqual(bustFallout(withRoom(), null, undefined, DAY), []);
});

test('a raid closes through the week; a shut room can be built again, and the shop carries on', () => {
  const b = withRoom({ dirty: 1000 });
  b.period.event = { kind: 'bust' };
  const out = advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test' });
  assert.equal(out.business.backRoom.status, 'shut');
  assert.equal(out.business.backRoom.dirty, 0);
  assert.equal(out.business.status, 'open', 'the business stands');
  assert.equal(out.business.digests.at(-1).event.kind, 'bust');
  assert.ok(out.events.some((e) => e.type === 'bustLost'));
  assert.equal(projectOffer(out.business, 'backRoom').ok, true, 'it can be built again');
  assert.equal(rollSpec(out.business, { type: 'action', action: 'roomWork', use: SKILLS.cybertech }, 'med', { day: DAY }).reason, 'no-back-room');
});

test('a raid can be run as a scene: won clears Exposure, lost shuts the room', () => {
  assert.equal(isBigEvent({ kind: 'bust' }), true);
  const scene = () => {
    const b = withRoom({ dirty: 800 });
    b.scene = { event: { kind: 'bust' }, day: DAY };
    return b;
  };
  const won = scene();
  assert.deepEqual(settleScene(won, true, DAY).events, [{ type: 'bustWon', exposure: -BUSINESS_DEFAULTS.backRoom.raid.winClear }]);
  assert.equal(won.backRoom.dirty, 800);
  const lost = scene();
  const till = lost.till;
  assert.equal(settleScene(lost, false, DAY).events.find((e) => e.type === 'bustLost').seized, 800);
  assert.equal(lost.backRoom.status, 'shut');
  assert.equal(lost.till, till - BUSINESS_DEFAULTS.backRoom.raid.fineLost, 'the fine comes out of the real cash');
});

test('a hand works the room when no partner did, not when lying low', () => {
  const hired = (slots = []) => {
    const b = withRoom({ dirty: 0 });
    b.staff = [staffer('h', { post: 'hand', bases: { 'skill:Cybertech': 12 }, hiredDay: DAY })];
    b.period.slots = slots;
    b.state.capacity = 1;
    return advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test' }).business;
  };
  assert.ok(hired().digests.at(-1).actions.some((a) => a.action === 'roomWork' && a.staff), 'on their own');
  assert.ok(!hired([{ action: 'lieLow', by: 'med', band: 'solid', use: 'none', approach: 'standard' }]).digests.at(-1).actions.some((a) => a.action === 'roomWork'), 'lying low');
});

test('a launderer washes dirty cash when no partner did, and only with a room and something to wash', () => {
  const week = (room, slots = [], make = withRoom) => {
    const b = make(room);
    b.staff = [staffer('l', { post: 'launderer', bases: { 'skill:Accounting': 12 }, hiredDay: DAY })];
    b.period.slots = slots;
    return advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test' }).business.digests.at(-1).actions.filter((a) => a.action === 'launder');
  };
  assert.equal(week({ dirty: 1000 })[0].staff, true);
  assert.equal(week({ dirty: 0 }).length, 0, 'nothing to wash');
  assert.equal(week({ status: 'shut', dirty: 1000 }).length, 0, 'a shut room');
  const lying = [{ action: 'lieLow', by: 'med', band: 'solid', use: 'none', approach: 'standard' }];
  assert.equal(week({ dirty: 1000 }, lying).length, 0, 'lying low');
  const partner = [{ action: 'launder', by: 'med', band: 'solid', use: 'none', approach: 'standard' }];
  assert.equal(week({ dirty: 1000 }, partner)[0].staff, undefined, 'a partner got there first');
});

test('a fixer acts only once Exposure has run up: a pay-off, or at a company a bribe paid from the cash', () => {
  const close = (b, exposure) => advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test', relations: { exposure } });
  const fixer = staffer('f', { post: 'fixer', bases: { 'skill:Bribery': 12 }, hiredDay: DAY });
  const shopWith = (room) => {
    const b = withRoom(room);
    b.staff = [{ ...fixer }];
    return b;
  };
  const did = (out, action) => out.business.digests.at(-1).actions.some((a) => a.action === action && a.staff);
  assert.equal(did(close(shopWith({ dirty: 5000 }), 10), 'payOff'), false, 'low Exposure: no money spent for nothing');
  assert.equal(did(close(shopWith({ dirty: 5000 }), 15), 'payOff'), true, 'moderate');
  assert.equal(did(close(shopWith({ dirty: 5000 }), 40), 'payOff'), true, 'high');
  assert.equal(did(close(shopWith({ dirty: 0 }), 40), 'payOff'), false, 'nothing to pay with');
  assert.equal(did(close(shopWith({ dirty: 0 }), 40), 'bribeRegulator'), false, 'a shop has no regulator to bribe');

  const firm = (extra = {}) => {
    const b = companyOf(extra);
    b.staff = [{ ...fixer }];
    return b;
  };
  const noRoom = firm();
  const bribed = close(noRoom, 40);
  assert.equal(did(bribed, 'bribeRegulator'), true, 'a company with no room');
  assert.ok(bribed.business.ledger.some((e) => e.kind === 'regulatorBribe' && e.amount === -BUSINESS_DEFAULTS.crime.bribeCost), 'from the cash');
  assert.ok(bribed.events.some((e) => e.type === 'regulatorBribed'));
  assert.equal(did(close(firm(), 10), 'bribeRegulator'), false, 'low Exposure');
  const floor = BUSINESS_DEFAULTS.crime.fixerFloor + BUSINESS_DEFAULTS.crime.bribeCost;
  assert.equal(did(close(firm({ till: floor - 1 }), 40), 'bribeRegulator'), false, 'it would leave too little cash');
  assert.equal(did(close(firm({ till: floor }), 40), 'bribeRegulator'), true, 'exactly enough left');
  const oneJob = close(firm({ backRoom: { kind: 'ripping', status: 'open', dirty: 5000, day: DAY } }), 40);
  assert.equal(did(oneJob, 'payOff'), true, 'dirty money first');
  assert.equal(did(oneJob, 'bribeRegulator'), false, 'and one job a week');
  const low = firm();
  low.period.slots = [{ action: 'lieLow', by: 'med', band: 'solid', use: 'none', approach: 'standard' }];
  assert.equal(did(close(low, 40), 'bribeRegulator'), false, 'lying low');
});

test('the back room\'s posts: where they are offered, what they are paid, and what they risk', () => {
  assert.equal(postOffered(shop(), 'hand'), false);
  assert.equal(postOffered(shop(), 'fixer'), false);
  assert.equal(postOpen(shop(), 'launderer').reason, 'no-back-room');
  for (const post of ['hand', 'launderer', 'fixer']) assert.equal(postOffered(withRoom(), post), true, post);
  assert.equal(postOffered(withRoom({ status: 'shut' }), 'hand'), false, 'a shut room');
  assert.equal(postOffered(companyOf(), 'fixer'), true, 'any company has a use for a fixer');
  assert.equal(postOffered(companyOf(), 'launderer'), false, 'but the rest need a room');
  assert.equal(postOffered(companyOf(), 'floor'), true);

  const same = { bases: { 'skill:Business': 12, 'skill:Bribery': 12 } };
  const manager = wageOf(shop(), staffer('a', { post: 'manager', ...same }));
  const fixer = wageOf(withRoom(), staffer('b', { post: 'fixer', ...same }));
  assert.ok(Math.abs(fixer - manager * 1.5) <= 1, `half as much again: ${manager} and ${fixer}`);
  assert.ok(Math.abs(askingWage(withRoom(), { post: 'fixer', base: 12 }) - askingWage(withRoom(), { post: 'floor', base: 12 }) * 1.5) <= 1);

  const r = BUSINESS_DEFAULTS.backRoom.raid;
  const chance = (staff) => {
    const b = withRoom();
    b.staff = staff;
    return raidChance(b, 10);
  };
  const near = (a, e) => assert.ok(Math.abs(a - e) < 1e-9, `${a} and ${e}`);
  const base = chance([staffer('x')]);
  near(chance([staffer('x'), staffer('y', { post: 'fixer' })]), base + r.crew);
  near(chance([staffer('x', { loyalty: 10 })]), base + r.sullen);
  near(chance([staffer('y', { post: 'fixer', loyalty: 10 })]), base + r.crew + r.sullen * r.sullenCrew, 'a sullen one counts double');
});

test('at a company, officers hire for the back room without a vote', () => {
  const company = (officers) => {
    const b = companyOf({ officers });
    b.candidates = [{ id: 'c1', name: 'Rex', post: 'fixer', base: 12, pct: 1, level: 'skilled', expires: DAY + 7 }];
    return b;
  };
  assert.equal(send(company(['other']), { type: 'propose', businessId: 'b1', kind: 'hire', candidateId: 'c1' }).reason, 'not-officer');
  const hired = send(company(['med']), { type: 'propose', businessId: 'b1', kind: 'hire', candidateId: 'c1' });
  assert.equal(hired.ok, true, hired.reason);
  assert.deepEqual(hired.business.proposals, [], 'nothing for the shareholders to read');
  assert.equal(hired.business.staff.at(-1).post, 'fixer');
});

test('an informant adds Exposure and can be named; an employee may turn; only with a room', () => {
  const rules = BUSINESS_DEFAULTS.backRoom.informant;
  const b = withRoom();
  b.staff = [staffer('a', { name: 'Rat' }), staffer('b')];
  const traits = { a: 'informant' };
  assert.deepEqual(informants(b, traits).map((s) => s.name), ['Rat']);
  b.period.slots = [];
  assert.equal(roomWeek(b, 1000, 1, BUSINESS_DEFAULTS, traits).exposure, rules.exposure);
  b.period.slots = [{ action: 'payOff', band: 'strong' }];
  assert.equal(roomWeek(b, 1000, 1, BUSINESS_DEFAULTS, traits).informant, 'Rat', 'a strong pay-off names them');
  b.period.slots = [{ action: 'payOff', band: 'narrow' }];
  assert.equal(roomWeek(b, 1000, 1, BUSINESS_DEFAULTS, traits).informant, undefined);
  const turned = Array.from({ length: 1000 }, (_, i) => turnInformant({ ...b, period: { ...b.period, index: i } }, {}, 'test')).filter(Boolean);
  assert.ok(turned.length > 15 && turned.length < 90, `a small weekly chance: ${turned.length}`);
  assert.deepEqual(Object.values(turned[0]), ['informant']);
  assert.equal(turnInformant({ ...shop(), staff: b.staff }, {}, 'test'), null);
});

// ── U1c: gang deals and corporate crime ─────────────────────────────

const fumbleOf = () => ({ ok: true, result: resolveRoll({ base: 14, roll: { total: -5, crit: 'fumble' }, dv: 13 }) });

test('asking a gang: neutral or better on the turf; a pass brings an offer by band and standing', () => {
  const use = SKILLS.streetwise;
  const b = withRoom();
  b.standings = { mael: 'friendly', claws: 'wary' };
  const ask = (x, factionId, check = checkOf(9)) => send(x, { type: 'action', businessId: 'b1', action: 'dealGang', factionId, use }, check);
  assert.equal(rollSpec(b, { type: 'action', action: 'dealGang', use }, 'med', { day: DAY }).reason, 'gang-refuses', 'no gang named');
  assert.equal(rollSpec(b, { type: 'action', action: 'dealGang', factionId: 'claws', use }, 'med', { day: DAY }).reason, 'gang-refuses', 'wary');
  assert.equal(ask(b, 'tti').reason, 'bad-faction', 'not a gang');
  const offered = ask(b, 'mael');
  assert.equal(offered.ok, true, offered.reason);
  const { offer } = offered.business.backRoom;
  assert.deepEqual([offer.factionId, offer.name, offer.cut], ['mael', 'Maelstrom', 0.25]);
  assert.ok(offer.cash >= 1000);
  assert.equal(offered.business.till, b.till, 'asking costs no gift');
  assert.equal(ask(b, 'mael', checkOf(-5)).business.backRoom.offer, null, 'a failure, no offer');
  assert.deepEqual([dealCut('allied'), dealCut('friendly'), dealCut('neutral'), dealCut('wary'), dealCut('hostile')], [0.2, 0.25, 0.3, null, null]);
});

test('taking a deal and ending it go through a vote; the money moves, and ending costs standing', () => {
  const b = withRoom({ dirty: 100, offer: { factionId: 'mael', name: 'Maelstrom', cash: 2000, cut: 0.25, day: DAY } });
  const taken = send(b, { type: 'propose', businessId: 'b1', kind: 'gangDeal' });
  assert.equal(taken.ok, true, taken.reason);
  const room = taken.business.backRoom;
  assert.deepEqual([room.deal.name, room.deal.cut, room.dirty, room.offer], ['Maelstrom', 0.25, 2100, null], 'a sole owner\'s vote carries it');
  assert.equal(send(withRoom(), { type: 'propose', businessId: 'b1', kind: 'gangDeal' }).reason, 'no-offer');
  const ended = send(taken.business, { type: 'propose', businessId: 'b1', kind: 'endGangDeal' });
  assert.equal(ended.ok, true, ended.reason);
  assert.equal(ended.business.backRoom.deal, null);
  assert.equal(ended.business.backRoom.dirty, 100);
  assert.deepEqual(ended.events.find((e) => e.type === 'factionMove'), { type: 'factionMove', factionId: 'mael', amount: BUSINESS_DEFAULTS.backRoom.deal.end });
  assert.equal(send(withRoom(), { type: 'propose', businessId: 'b1', kind: 'endGangDeal' }).reason, 'no-deal');
});

test('the cut comes out each week; falling short costs standing; a hostile gang walks away', () => {
  const deal = { factionId: 'mael', name: 'Maelstrom', cut: 0.25, cash: 2000 };
  const worked = withRoom({ dirty: 0, deal });
  worked.state.capacity = 1;
  worked.period.slots = [{ action: 'roomWork', band: 'solid', approach: 'standard' }];
  const out = roomWeek(worked, 1000);
  assert.equal(out.cut, Math.max(BUSINESS_DEFAULTS.backRoom.deal.minimum, Math.round(out.earned * 0.25)));
  assert.equal(worked.backRoom.dirty, out.earned - out.cut);
  const idle = withRoom({ dirty: 500, deal });
  idle.period.slots = [];
  assert.equal(roomWeek(idle, 1000).cut, BUSINESS_DEFAULTS.backRoom.deal.minimum, 'at least the minimum');
  const broke = withRoom({ dirty: 10, deal });
  broke.period.slots = [];
  const short = roomWeek(broke, 1000);
  assert.deepEqual([short.unpaid, broke.backRoom.dirty], ['mael', 10]);
  const cross = withRoom({ dirty: 500, deal });
  cross.standings = { mael: 'hostile' };
  cross.period.slots = [];
  assert.equal(roomWeek(cross, 1000).dealEnded, 'Maelstrom');
  assert.equal(cross.backRoom.deal, null);
  const closed = advanceBusiness(broke, broke.period.endDay, { weekday: 1, seed: 'test' });
  assert.deepEqual(closed.events.find((e) => e.type === 'factionMove'), { type: 'factionMove', factionId: 'mael', amount: BUSINESS_DEFAULTS.backRoom.deal.unpaid });
});

test('a gang with a deal charges no protection and sends no shakedowns; a shut room ends the deal', () => {
  const list = [{ id: 'mael', name: 'Maelstrom', kind: 'gang', districts: ['ocz'] }, { id: 'claws', name: 'Claws', kind: 'gang', districts: ['ocz'] }];
  const deal = { factionId: 'mael', name: 'Maelstrom', cut: 0.25, cash: 1 };
  const room = (standings) => ({ archetype: 'clinic', district: 'ocz', standings, backRoom: { deal } });
  const two = factionEffects(room({}), list);
  assert.equal(two.protection, 0.5, 'its share of the money goes');
  assert.deepEqual(two.gangs.map((g) => g.id), ['claws'], 'and only the others come shaking');
  const one = factionEffects(room({}), [list[0]]);
  assert.deepEqual([one.protection, one.shakedown, one.gangs], [0, 0, []]);
  assert.equal(factionEffects({ archetype: 'clinic', district: 'ocz', standings: {} }, list).protection, 1, 'no deal');
  const b = withRoom({ dirty: 100, deal });
  bustFallout(b, { kind: 'bust' }, 'unanswered', DAY);
  assert.equal(b.backRoom.deal, null);
});

const companyOf = (extra = {}) => normalizeBusiness({ ...shop(), stage: 2, till: 20000, company: { ticker: 'BRC', sector: 'health', charteredDay: DAY }, officers: ['med'], ...extra });

test('dumping lifts the takings furthest and leaves the most behind, and a fumble is a scandal', () => {
  const week = (band) => {
    const b = companyOf();
    b.period.slots = [{ action: 'dumping', band, approach: 'standard', by: 'med' }];
    b.state.capacity = 1;
    return advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test' });
  };
  const contracts = companyOf();
  contracts.state.capacity = 1;
  contracts.period.slots = [{ action: 'contracts', band: 'solid', approach: 'standard', by: 'med' }];
  const plain = advanceBusiness(contracts, contracts.period.endDay, { weekday: 1, seed: 'test' }).business.digests.at(-1).gross;
  const dumped = week('solid');
  assert.ok(dumped.business.digests.at(-1).gross > plain, 'more than contracts');
  assert.equal(dumped.events.find((e) => e.type === 'shortcuts').exposure, BUSINESS_DEFAULTS.crime.dumpingExposure.solid);
  assert.ok(!dumped.events.some((e) => e.type === 'crimeScandal'));
  assert.equal(week('fumble').events.find((e) => e.type === 'crimeScandal').percent, BUSINESS_DEFAULTS.crime.scandal.dumping);
});

test('a bribed regulator: paid whatever the roll, Exposure by band, and a good roll eases an open case', () => {
  const use = SKILLS.bribery;
  const b = companyOf({ regCase: { status: 'notice', reason: 'report', openedDay: DAY, endDay: DAY + 14 } });
  const paid = send(b, { type: 'action', businessId: 'b1', action: 'bribeRegulator', use }, checkOf(9));
  assert.equal(paid.ok, true, paid.reason);
  assert.equal(paid.business.till, b.till - BUSINESS_DEFAULTS.crime.bribeCost);
  assert.ok(paid.events.find((e) => e.type === 'regulatorBribed').exposure < 0);
  assert.equal(paid.business.regCase.eased, true);
  const narrow = send(b, { type: 'action', businessId: 'b1', action: 'bribeRegulator', use }, { ok: true, result: { ...resolveRoll({ base: 14, roll: { total: 1, crit: null }, dv: 13 }), band: 'narrow' } });
  assert.equal(narrow.business.regCase.eased, undefined, 'a narrow one does not');
  assert.equal(send(b, { type: 'action', businessId: 'b1', action: 'bribeRegulator', use }, fumbleOf()).events.find((e) => e.type === 'regulatorBribed').exposure, BUSINESS_DEFAULTS.crime.bribeExposure.fumble);
  assert.equal(rollSpec(companyOf({ till: 10 }), { type: 'action', action: 'bribeRegulator', use }, 'med', { day: DAY }).reason, 'no-funds');
});

test('black ops work as a campaign, at more cost and a bigger move; traced back, it is worse', () => {
  const use = SKILLS.tactics;
  const companies = [{ ticker: 'ARA', name: 'Arasaka' }];
  const run = (check, context = {}) => send(companyOf(), { type: 'action', businessId: 'b1', action: 'blackOps', targetTicker: 'ARA', use }, check, { companies, ...context });
  const b = companyOf();
  const done = run(checkOf(9));
  assert.equal(done.ok, true, done.reason);
  assert.equal(done.business.till, b.till - BUSINESS_DEFAULTS.crime.blackOpsCost);
  assert.deepEqual([done.business.campaign.status, done.business.campaign.kind, done.business.campaign.ticker], ['awaiting', 'blackOps', 'ARA']);
  assert.ok(done.business.campaign.percent <= -2);
  assert.equal(done.business.lastCampaignDay, DAY, 'the same month\'s limit');
  assert.equal(rollSpec({ ...done.business, campaign: null, period: { ...done.business.period, slots: [] } }, { type: 'action', action: 'campaign', targetTicker: 'ARA', use: SKILLS.persuasion }, 'med', { day: DAY + 1 }).reason, 'campaign-wait');
  assert.equal(run(checkOf(9), { campaignApproval: false }).events.find((e) => e.type === 'campaignLands').campaign.kind, 'blackOps');
  const caught = run(fumbleOf()).events.find((e) => e.type === 'campaignCaught');
  assert.deepEqual([caught.blackOps, caught.exposure], [true, BUSINESS_DEFAULTS.crime.blackOpsCaught]);
  assert.equal(rollSpec(companyOf({ till: 1000 }), { type: 'action', action: 'blackOps', targetTicker: 'ARA', use }, 'med', { day: DAY }).reason, 'no-gift');
});

// ── A back room at a company: the officers' secret ──────────────────

test('at a company, only officers take dirty cash and settle a deal, without a vote; a shut room stays shut', () => {
  const company = (officers, room = {}) => normalizeBusiness({ ...shop(), stage: 2, till: 20000, company: { ticker: 'BRC', sector: 'health', charteredDay: DAY }, officers, backRoom: { kind: 'ripping', status: 'open', dirty: 3000, ...room } });
  assert.equal(send(company(['other']), { type: 'takeDirty', businessId: 'b1', amount: 100 }).reason, 'not-officer');
  assert.equal(send(company(['med']), { type: 'takeDirty', businessId: 'b1', amount: 100 }).ok, true);
  assert.equal(send(withRoom(), { type: 'takeDirty', businessId: 'b1', amount: 100 }).ok, true, 'any partner of a smaller business');

  const offer = { offer: { factionId: 'mael', name: 'Maelstrom', cash: 2000, cut: 0.25, day: DAY } };
  assert.equal(send(company(['med'], offer), { type: 'propose', businessId: 'b1', kind: 'gangDeal' }).reason, 'officers-decide', 'no shareholders\' vote');
  assert.equal(send(company(['other'], offer), { type: 'gangDealOfficer', businessId: 'b1' }).reason, 'not-officer');
  const taken = send(company(['med'], offer), { type: 'gangDealOfficer', businessId: 'b1' });
  assert.equal(taken.ok, true, taken.reason);
  assert.deepEqual([taken.business.backRoom.deal.name, taken.business.backRoom.dirty], ['Maelstrom', 5000]);
  assert.equal(taken.business.proposals.length, 0);
  const ended = send(taken.business, { type: 'gangDealOfficer', businessId: 'b1', end: true });
  assert.equal(ended.ok, true, ended.reason);
  assert.equal(ended.business.backRoom.deal, null);
  assert.equal(ended.events.find((e) => e.type === 'factionMove').amount, BUSINESS_DEFAULTS.backRoom.deal.end);
  assert.equal(send(withRoom(offer), { type: 'gangDealOfficer', businessId: 'b1' }).reason, 'not-company', 'a smaller business votes');

  assert.equal(projectOffer(company(['med'], { status: 'shut' }), 'backRoom').reason, 'not-at-company', 'for good');
  assert.equal(projectOffer(withRoom({ status: 'shut' }), 'backRoom').ok, true, 'a shop can build again');
});
