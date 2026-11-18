import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';
import { resolveRoll } from '../scripts/engine/rolls.js';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Rook', 0, false]] });
const [alice] = env.actors;
const chats = [];
installFakeChat(chats);

let S;
let E;

before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    NewsService: (await load('../scripts/services/NewsService.js')).NewsService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    BusinessRepository: (await load('../scripts/data/BusinessRepository.js')).BusinessRepository,
    BusinessService: (await load('../scripts/services/BusinessService.js')).BusinessService,
    HeatService: (await load('../scripts/services/HeatService.js')).HeatService,
  };
  E = await load('../scripts/engine/index.js');
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await load('../scripts/init/registerBusinessSystem.js')).registerBusinessSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  await init.runPhase('init');
  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  env.store.set('businessesEnabled', true);
});

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const DAY = 20003;
const checkOf = (die, crit = null) => ({ ok: true, result: resolveRoll({ base: 14, roll: { total: die, crit }, dv: 13 }) });
const send = (business, request, check, context = {}) => E.applyBusinessRequest({
  business, request: { key: `k${Math.random()}`, ...request }, actor: MED, day: DAY, check,
  context: { approval: false, weekday: 1, actors: {}, newId: 'b1', seed: 'test', factions: [], ...context },
});

/** A clinic, open, with its week under way and no event. */
function shop(id = 'b1', { till = 3000 } = {}) {
  let b = send(null, { type: 'found', name: 'Back Room', archetype: 'clinic', district: 'ocz', cash: 4000 }).business;
  b = send(b, { type: 'setupRoll', businessId: 'b1', use: E.ARCHETYPES.clinic.trade[0] }, checkOf(9)).business;
  const out = E.normalizeBusiness({ ...b, id, till });
  out.state.capacity = 1;
  delete out.period.event;
  return out;
}

/** An NPC's clinic with two hands: a loyal one and a steady one. */
function rival(id = 'bus_rival') {
  const b = shop(id);
  b.name = 'Kabuki Chrome';
  b.npcRun = { ownerId: 'npc', level: 'skilled', profile: 'steady', auto: true };
  b.staff = [
    { id: 'stf_rook', actorId: null, name: 'Rook', source: 'recruit', post: 'floor', bases: { 'skill:Paramedic': 12 }, pct: 1, wage: 200, status: 'active', owed: 0, loyalty: 64, hiredDay: 1 },
    { id: 'stf_vex', actorId: null, name: 'Vex', source: 'recruit', post: 'floor', bases: { 'skill:Paramedic': 10 }, pct: 1, wage: 150, status: 'active', owed: 0, loyalty: 30, hiredDay: 1 },
  ];
  return b;
}

// ── The rules ────────────────────────────────────────────────────────────────

test('X2b DVs: a poaching by loyalty, a sabotage by the rival\'s stage and security; players see DVs, not loyalty or wages', () => {
  assert.equal(E.poachDv(64), 16);
  assert.equal(E.poachDv(30), 13);
  assert.equal(E.poachDv(0), 10);
  const r = rival();
  assert.equal(E.sabotageDv(E.rivalView(r)), E.stageDv(r.stage));
  r.upgrades = { ...r.upgrades, security: 2 };
  assert.equal(E.sabotageDv(E.rivalView(r)), E.stageDv(r.stage) + 2);
  const pub = E.publicRival(r);
  assert.deepEqual(pub.staff, [{ id: 'stf_rook', name: 'Rook', post: 'floor', dv: 16 }, { id: 'stf_vex', name: 'Vex', post: 'floor', dv: 13 }]);
  assert.ok(!JSON.stringify(pub).includes('loyalty') && !JSON.stringify(pub).includes('wage'), 'nothing more');
  assert.equal(E.isRival(r), true);
  assert.equal(E.isRival(shop()), false, 'a player\'s business is not a rival');
  // Both actions are on the shop's and the company's lists; sabotage is crime.
  assert.ok(E.ACTION_IDS.includes('poach') && E.COMPANY_ACTION_IDS.includes('sabotage'));
  assert.ok(E.CRIME_ACTIONS.includes('sabotage') && !E.CRIME_ACTIONS.includes('poach'));
  assert.equal(E.SKILLS.stealth.skill, 'Stealth');
});

test('X2b poaching: the employee\'s DV, room needed here; a pass hires them at 10% more, and the rival hears', () => {
  const b = shop();
  const r = rival();
  const view = E.rivalView(r);
  const use = E.SKILLS.persuasion;
  const req = { type: 'action', action: 'poach', targetId: r.id, staffId: 'stf_rook', rival: view, use };
  assert.equal(E.rollSpec(b, req, 'med', { day: DAY }).dv, 16);
  assert.equal(E.rollSpec(b, { ...req, rival: null }, 'med', { day: DAY }).reason, 'bad-target');
  assert.equal(E.rollSpec(b, { ...req, staffId: 'nobody' }, 'med', { day: DAY }).reason, 'no-staff');
  assert.equal(E.rollSpec(b, { ...req, use: E.SKILLS.stealth }, 'med', { day: DAY }).reason, 'bad-use', 'Persuasion or Bribery');
  // What the board shows is enough for the window's roll.
  assert.equal(E.rollSpec(b, { ...req, rival: E.publicRival(r) }, 'med', { day: DAY }).dv, 16);
  // No room: a shop has a single place.
  const full = shop();
  full.staff = [{ ...r.staff[1], id: 'stf_mine' }];
  assert.equal(E.rollSpec(full, req, 'med', { day: DAY }).reason, 'no-headcount');

  const won = send(b, { ...req, businessId: 'b1' }, checkOf(9));
  assert.equal(won.ok, true, won.reason);
  const hired = won.business.staff.find((s) => s.name === 'Rook');
  assert.equal(hired.status, 'active');
  assert.ok(hired.wage >= 220, `paid 10% more (${hired.wage})`);
  assert.equal(hired.poachedFrom.businessId, r.id);
  assert.deepEqual(E.normalizeBusiness(won.business).staff.find((s) => s.name === 'Rook').poachedFrom, hired.poachedFrom, 'kept when the record is saved');
  assert.equal(won.business.period.slots.at(-1).factionName, 'Kabuki Chrome', 'the slot says who it was aimed at');
  const ev = won.events.find((e) => e.type === 'rivalMove');
  assert.deepEqual([ev.move, ev.rivalId, ev.staffId, ev.success], ['poach', r.id, 'stf_rook', true]);
  assert.equal(ev.exposure, undefined, 'poaching is not crime');

  const lost = send(b, { ...req, businessId: 'b1' }, checkOf(-5));
  assert.equal(lost.ok, true);
  assert.ok(!lost.business.staff.some((s) => s.name === 'Rook'));
  assert.equal(lost.events.find((e) => e.type === 'rivalMove').success, false);
});

test('X2b sabotage: the rival\'s DV; Exposure here whatever the roll, more on a fumble; a pass cuts its takings', () => {
  const b = shop();
  const r = rival();
  const req = { type: 'action', businessId: 'b1', action: 'sabotage', targetId: r.id, rival: E.rivalView(r), use: E.SKILLS.stealth };
  assert.equal(E.rollSpec(b, req, 'med', { day: DAY }).dv, E.stageDv(r.stage));
  const won = send(b, req, checkOf(9)).events.find((e) => e.type === 'rivalMove');
  assert.deepEqual([won.success, won.cut, won.exposure], [true, E.BUSINESS_DEFAULTS.rivals.sabotage.cut, 5]);
  const narrow = send(b, req, { ok: true, result: { ...resolveRoll({ base: 14, roll: { total: 1, crit: null }, dv: 13 }), band: 'narrow' } }).events.find((e) => e.type === 'rivalMove');
  assert.equal(narrow.cut, E.BUSINESS_DEFAULTS.rivals.sabotage.narrowCut);
  const missed = send(b, req, checkOf(-3)).events.find((e) => e.type === 'rivalMove');
  assert.deepEqual([missed.success, missed.cut, missed.exposure], [false, 0, 5]);
  const fumble = send(b, req, checkOf(-5, 'fumble')).events.find((e) => e.type === 'rivalMove');
  assert.deepEqual([fumble.band, fumble.exposure], ['fumble', 10]);
  assert.equal(send(b, { ...req, targetId: b.id, rival: E.rivalView(b) }, checkOf(9)).reason, 'bad-target', 'never itself');
});

test('X2b the GM\'s moves: a poaching of the best-paid hand or a sabotage, from the rival, now or next week; lost, the hand joins it', () => {
  const b = shop();
  b.staff = [
    { id: 'stf_a', actorId: null, name: 'Ash', source: 'recruit', post: 'floor', bases: {}, pct: 1, wage: 120, status: 'active', owed: 0, loyalty: 40, hiredDay: 1 },
  ];
  const r = rival();
  assert.equal(E.rivalEvent(b, shop('x'), 'sabotage').reason, 'bad-target', 'only an NPC company');
  assert.equal(E.rivalEvent(r, r, 'sabotage').reason, 'not-player');
  const poach = E.rivalEvent(b, r, 'poach');
  assert.deepEqual([poach.event.kind, poach.event.staffId, poach.event.factionName, poach.event.rivalBusiness.id], ['poaching', 'stf_a', 'Kabuki Chrome', r.id]);
  assert.deepEqual(E.queueRivalEvent(b, poach.event), { ok: true, when: 'now' });
  const sabotage = E.rivalEvent(b, r, 'sabotage');
  assert.deepEqual(E.queueRivalEvent(b, sabotage.event), { ok: true, when: 'next' });
  assert.equal(E.queueRivalEvent(b, sabotage.event).reason, 'rival-queued');
  assert.equal(E.normalizeBusiness(structuredClone(b)).rivalQueued.kind, 'sabotage', 'kept on the record');
  assert.equal(E.rivalEvent(shop(), r, 'poach').reason, 'no-staff');

  // Lost, the employee goes to the rival.
  const settled = E.settleStaffEvent(b, 1000, [], {});
  assert.equal(settled.cross.kind, 'poachedTo');
  assert.equal(settled.cross.to, r.id);
  assert.equal(settled.cross.staff.name, 'Ash');
});

test('X2b an aggressive NPC company: now and then a move against a player business near it or in its trade', () => {
  const r = rival();
  const targets = [{ id: 'far', name: 'Far', district: 'heywood', archetype: 'bar', staff: 0 }, { id: 'near', name: 'Near', district: 'ocz', archetype: 'bar', staff: 2 }];
  const always = { chance: () => true, int: (lo) => lo };
  assert.equal(E.drawRivalMove(r, targets, always), null, 'not aggressive');
  r.npcRun.aggressive = true;
  assert.deepEqual(E.drawRivalMove(r, targets, always), { targetId: 'near', targetName: 'Near', kind: 'poach' });
  assert.equal(E.drawRivalMove(r, targets, { ...always, chance: () => false }), null);
  assert.equal(E.drawRivalMove(r, [targets[0]], { ...always, int: (lo, hi) => hi }).kind, 'story', 'nobody to poach there');
  r.npcRun.move = { targetId: 'near' };
  assert.equal(E.drawRivalMove(r, targets, always), null, 'one at a time');
  // The GM's switch, and turning it off drops a waiting move.
  const set = E.setNpcRun(r, { aggressive: false });
  assert.deepEqual([set.business.npcRun.aggressive, set.business.npcRun.move], [false, null]);
});

// ── The GM's side ────────────────────────────────────────────────────────────

test('X2b on the GM\'s side: the rival loses a poached hand or its takings, the board shows rivals, the GM hears; Make a move and an aggressive move', async () => {
  const { BusinessService, BusinessRepository, MarketStore } = S;
  const mine = shop('bus_mine');
  mine.partners = mine.partners.map((p) => ({ ...p, actorId: alice.id }));
  const r = rival();
  await BusinessRepository.save(mine);
  await BusinessRepository.save(r);
  await MarketStore.setBusinessesHidden({ ...MarketStore.getBusinessesHidden(), [r.id]: { exposure: 0, traits: { stf_rook: 'looseLips' } } });

  // On the board, for players' windows.
  const board = BusinessService.rivalTargets();
  assert.deepEqual(board.map((x) => x.id), [r.id]);
  assert.equal(board[0].staff.length, 2);

  // A poaching that landed: gone from the rival, with their trait.
  const said = chats.length;
  await BusinessService._rivalEvents({ business: mine, events: [{ type: 'rivalMove', move: 'poach', rivalId: r.id, staffId: 'stf_rook', staffName: 'Rook', band: 'solid', success: true, actorId: alice.id }] });
  let after = BusinessRepository.get(r.id);
  assert.ok(!after.staff.some((s) => s.id === 'stf_rook'));
  assert.equal(after.pendingNotes.at(-1).kind, 'poached');
  assert.equal(MarketStore.getBusinessesHidden()[mine.id]?.traits?.stf_rook, 'looseLips', 'the trait went with them');
  assert.equal(MarketStore.getBusinessesHidden()[r.id].traits.stf_rook, undefined);
  assert.ok(chats.length > said && chats.at(-1).whisper, 'the GM hears, in a whisper');
  assert.match(chats.at(-1).content, /NCI\.Rival\.GMNoteTitle \{&quot;rival&quot;:/, 'the title names the rival as its string expects');

  // A failed one: more loyal where they are.
  const vexBefore = after.staff.find((s) => s.id === 'stf_vex').loyalty;
  await BusinessService._rivalEvents({ business: mine, events: [{ type: 'rivalMove', move: 'poach', rivalId: r.id, staffId: 'stf_vex', staffName: 'Vex', band: 'failure', success: false, actorId: alice.id }] });
  after = BusinessRepository.get(r.id);
  assert.ok(after.staff.find((s) => s.id === 'stf_vex').loyalty > vexBefore);

  // A sabotage that landed: its next takings and its Reputation.
  const rep = after.state.reputation;
  await BusinessService._rivalEvents({ business: mine, events: [{ type: 'rivalMove', move: 'sabotage', rivalId: r.id, band: 'solid', success: true, cut: 0.2, exposure: 5, actorId: alice.id }] });
  after = BusinessRepository.get(r.id);
  assert.equal(after.boost, -0.2);
  assert.equal(after.state.reputation, rep - 3);

  // The GM's Make a move: sabotage now, then a poaching queued for next week.
  const vexHand = { ...after.staff.find((s) => s.id === 'stf_vex'), id: 'stf_mine', name: 'Mo' };
  await BusinessRepository.save({ ...BusinessRepository.get(mine.id), staff: [vexHand] });
  const now = await BusinessService.runRivalMove(mine.id, r.id, 'sabotage');
  assert.deepEqual([now.ok, now.when], [true, 'now']);
  assert.equal(BusinessRepository.get(mine.id).period.event.factionName, 'Kabuki Chrome');
  const next = await BusinessService.runRivalMove(mine.id, r.id, 'poach');
  assert.deepEqual([next.ok, next.when], [true, 'next']);
  assert.equal(BusinessRepository.get(mine.id).rivalQueued.staffId, 'stf_mine');
  assert.equal((await BusinessService.runRivalMove(mine.id, mine.id, 'sabotage')).reason, 'bad-target');
  assert.equal((await BusinessService.runRivalMove(r.id, r.id, 'sabotage')).ok, false);

  // The poaching lost at the close: Mo works for the rival now, paid more.
  await BusinessService._twoJobs({ events: [{ type: 'twoJobs', businessId: mine.id, kind: 'poachedTo', to: r.id, staffName: 'Mo', staff: vexHand }] });
  const mo = BusinessRepository.get(r.id).staff.find((s) => s.name === 'Mo');
  assert.ok(mo && mo.wage > vexHand.wage);

  // An aggressive company proposes a move, held for the GM, who makes it or drops it.
  await BusinessRepository.save({ ...BusinessRepository.get(r.id), npcRun: { ...BusinessRepository.get(r.id).npcRun, aggressive: true, move: { targetId: mine.id, targetName: mine.name, kind: 'story', day: S.BusinessService.day() } } });
  const dropped = await BusinessService.answerRivalMove(r.id, false);
  assert.equal(dropped.ok, true);
  assert.equal(BusinessRepository.get(r.id).npcRun.move, null);
  assert.equal((await BusinessService.answerRivalMove(r.id, true)).reason, 'no-move');
  // Left too long, a move lapses.
  await BusinessRepository.save({ ...BusinessRepository.get(r.id), npcRun: { ...BusinessRepository.get(r.id).npcRun, move: { targetId: mine.id, targetName: mine.name, kind: 'sabotage', day: S.BusinessService.day() - 30 } } });
  await BusinessService._rivalMoves();
  assert.equal(BusinessRepository.get(r.id).npcRun.move, null);
  await BusinessRepository.save({ ...BusinessRepository.get(r.id), status: 'closed' });
  await BusinessRepository.save({ ...BusinessRepository.get(mine.id), status: 'closed' });
});
