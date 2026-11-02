import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_DEFAULTS, DISTRICTS, normalizeFaction, standingBand, matchFaction, turfFactions, gigStanding, moveStanding, driftStanding, standingBands, matchBusiness,
  findTarget, targetShare, gigTags, resolveClient, applyBusinessRequest, advanceBusiness, rollSpec, normalizeBusiness, drawEvent, hostileAct, hostileChance, factionEffects, factionFallout,
  giftFor, campaignKind, believability, storyPercent, rollStory, storyCheck, rumourLevel, freshRumours, STORY_RULES, isBigEvent, sceneCandidate, startScene, sceneToRoll, settleScene, ARCHETYPES, SKILLS, ABILITIES,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';
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
