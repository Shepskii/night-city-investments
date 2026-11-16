import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Cass', 50000, true], ['Nina', 50000, false]] });
const [alice, cass, nina] = env.actors;
installFakeChat();

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
    StoryService: (await load('../scripts/services/StoryService.js')).StoryService,
    SkillAdapter: (await load('../scripts/services/SkillAdapter.js')).SkillAdapter,
    HeatService: (await load('../scripts/services/HeatService.js')).HeatService,
  };
  E = await load('../scripts/engine/index.js');
  (await load('./helpers/fakeItems.mjs')).installFakeItems().prepare(cass);
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

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.NewsService._queue, S.BusinessService._queue, S.HeatService._queue]) await q;
  }
};

// ── The rules ────────────────────────────────────────────────────────────────

test('NET run: a week between, the DV by stage or size, and what the roll does', () => {
  const rules = E.BUSINESS_DEFAULTS.roles.netRun;
  assert.equal(E.netRunWait(null, 100), 0);
  assert.equal(E.netRunWait(100, 103), rules.days - 3);
  assert.equal(E.netRunWait(100, 100 + rules.days), 0);
  assert.equal(E.netRunDv({ kind: 'npc', stage: 0 }), 15);
  assert.equal(E.netRunDv({ kind: 'npc', stage: 1 }), 17);
  assert.equal(E.netRunDv({ kind: 'npc', stage: 2 }), 19);
  const corps = [{ ticker: 'AAA', cap: 1 }, { ticker: 'BBB', cap: 5 }, { ticker: 'CCC', cap: 9 }];
  assert.equal(E.netRunDv({ kind: 'corp', ticker: 'AAA' }, corps), 17);
  assert.equal(E.netRunDv({ kind: 'corp', ticker: 'CCC' }, corps), 21);
  assert.deepEqual(E.netRunEffect('narrow'), { outcome: 'success', shard: true, heat: 0, standing: 0, ice: false });
  assert.deepEqual(E.netRunEffect('failure'), { outcome: 'failure', shard: false, heat: rules.heat, standing: rules.standing, ice: false });
  assert.deepEqual(E.netRunEffect('fumble'), { outcome: 'fumble', shard: false, heat: rules.heat, standing: rules.standing, ice: true });
});

test('a shard matches its ticker, or an unlisted business by its id, until it is used', () => {
  assert.equal(E.evidenceMatches({ ticker: 'MIL' }, { ticker: 'MIL' }), true);
  assert.equal(E.evidenceMatches({ ticker: 'MIL', used: true }, { ticker: 'MIL' }), false);
  assert.equal(E.evidenceMatches({ ticker: null, businessId: 'bus_x' }, { ticker: null, businessId: 'bus_x' }), true);
  assert.equal(E.evidenceMatches({ ticker: null, businessId: 'bus_y' }, { ticker: null, businessId: 'bus_x' }), false, 'no ticker is not a match');
});

// ── The GM's side ────────────────────────────────────────────────────────────

test('a Netrunner runs: an NPC ledger or a corporation\'s pipeline as a shard; a shard is evidence an investigation uses up; a failure is traced, a fumble is ICE', async () => {
  const { SkillAdapter, HeatService, MarketStore, BusinessService, BusinessRepository, StoryService } = S;
  const { MODULE_ID, FLAGS } = await import('../scripts/utils/constants.js');
  const baseFor = SkillAdapter.baseFor;
  const verifyLevers = SkillAdapter.verifyLevers;
  const rolled = { band: 'solid' };
  const dvs = [];
  SkillAdapter.baseFor = (actor, use) => (['Interface', 'Backup'].includes(use.ability) && actor.id === cass.id ? { base: 4, name: use.ability, parts: `${use.ability} 4` } : baseFor.call(SkillAdapter, actor, use));
  SkillAdapter.verifyLevers = async (actor, request, { dv }) => { dvs.push(dv); return { ok: true, result: { ...rolled } }; };
  env.store.set('heatEnabled', true);
  const day = BusinessService.day();
  const partner = (actor, units, extra = {}) => ({ actorId: actor.id, name: actor.name, status: 'active', cash: 0, gear: [], units, voting: true, heirId: null, leavingSince: null, ...extra });
  await BusinessRepository.save(E.normalizeBusiness({
    id: 'bus_npcshop', name: 'Nina Noodles', archetype: 'foodStall', status: 'open', stage: 1, createdDay: day - 60, openedDay: day - 60,
    partners: [partner(nina, 100)], till: 2345, assets: 1000, npcRun: { ownerId: nina.id, level: 4, profile: 'steady', auto: true },
    state: { capacity: 3, reputation: 40, costFactor: 1, compliance: 50 },
    period: { index: 1, startDay: day, endDay: day + 7, slots: [], bonuses: [], helpers: [], draws: {}, days: {}, overtime: {} },
  }));
  const run = (actor, target) => BusinessService._netRun(actor, { key: `n${Math.random()}`, target });
  const shards = (actor) => [...actor.items].filter((i) => i.flags?.[MODULE_ID]?.[FLAGS.EVIDENCE]);
  try {
    const targets = BusinessService.inquiryTargets();
    const npcTarget = targets.npc.find((t) => t.id === 'bus_npcshop');
    assert.equal(npcTarget.netDv, 17, 'a shop is stage 1');
    const corp = targets.corps[0];
    assert.ok([17, 19, 21].includes(corp.netDv));

    assert.equal((await run(alice, 'b:bus_npcshop')).reason, 'not-netrunner');

    // An NPC's business: its real ledger, for 100 eb, and a week to wait.
    const wealth = cass.system.wealth.value;
    const npc = await run(cass, 'b:bus_npcshop');
    await settle();
    assert.equal(npc.ok, true);
    assert.deepEqual(npc.netRun, { outcome: 'success', kind: 'npc', name: 'Nina Noodles' });
    assert.equal(dvs.at(-1), 17);
    assert.equal(cass.system.wealth.value, wealth - E.BUSINESS_DEFAULTS.roles.netRun.cost);
    const [ledger] = shards(cass);
    const flag = ledger.flags[MODULE_ID][FLAGS.EVIDENCE];
    assert.equal(flag.businessId, 'bus_npcshop');
    assert.equal(flag.source, 'netrun');
    assert.match(flag.note, /2,345/);
    assert.match(flag.note, /Nina 100%/);
    assert.match(flag.note, /Exposure/);
    assert.equal((await run(cass, `c:${corp.ticker}`)).reason, 'netrun-wait');

    // The shard is evidence for an investigation of that business, used up whatever the roll.
    await BusinessService._inquire(cass, { key: `i${Math.random()}`, target: 'b:bus_npcshop' });
    await settle();
    assert.equal(dvs.at(-1), E.BUSINESS_DEFAULTS.roles.inquiry.dv.npc - E.BUSINESS_DEFAULTS.roles.inquiry.evidence, 'the shard takes 2 off');
    assert.equal(StoryService.evidenceFor(cass, { ticker: null, businessId: 'bus_npcshop' }).length, 0, 'used up');

    // A corporation: what is coming its way, and the Netrunner counts as tipped.
    await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN);
    const key = `test:${corp.ticker}`;
    await S.TickService.updateControls((controls, { tick: now }) => ({
      ...controls,
      impacts: [...controls.impacts, E.makeImpact({ id: 'imp_test', target: { type: 'company', id: corp.ticker }, amount: E.percentToAmount(5), onsetTick: now + 2, permanent: 1, sourceKey: key, source: 'report', meta: {} })],
    }));
    await HeatService.openWindow({ sourceKey: key, companyId: corp.ticker, outcome: 'success', delayDays: 2 }, {});
    await settle();
    const hit = await run(cass, `c:${corp.ticker}`);
    await settle();
    assert.equal(hit.netRun.kind, 'corp');
    const pipeline = shards(cass).find((i) => i.flags[MODULE_ID][FLAGS.EVIDENCE].ticker === corp.ticker);
    assert.ok(pipeline, 'a shard about the corporation');
    assert.ok(StoryService.evidenceOf(cass, corp.ticker).length, 'evidence for a story too');
    assert.ok(MarketStore.getHeat().windows.find((w) => w.sourceKey === key).tipped.includes(cass.id), 'trading on it is insider dealing');

    // A fumble: traced, and ICE for the GM.
    await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN);
    rolled.band = 'fumble';
    await HeatService.setHeat(cass.id, 20);
    const chats = env.chat?.messages?.length ?? 0;
    const bad = await run(cass, `c:${corp.ticker}`);
    await settle();
    assert.equal(bad.netRun.outcome, 'fumble');
    assert.equal(HeatService.heatOf(cass.id), 20 + E.BUSINESS_DEFAULTS.roles.netRun.heat);
    if (env.chat?.messages) assert.ok(env.chat.messages.length > chats, 'the GM hears of the ICE');
  } finally {
    SkillAdapter.baseFor = baseFor;
    SkillAdapter.verifyLevers = verifyLevers;
    env.store.set('heatEnabled', false);
    await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN);
    await cass.unsetFlag(MODULE_ID, FLAGS.INQUIRED);
  }
});

// ── A real run on NET Architect (X2a) ────────────────────────────────────────

test('a real run: the shard decides a pass, a failed node a trace; its shard counts for more', () => {
  const rules = E.BUSINESS_DEFAULTS.roles.netRun;
  assert.deepEqual(E.liveRunOutcome({ shard: true }), { outcome: 'success', traced: false, heat: 0, standing: 0 });
  assert.deepEqual(E.liveRunOutcome({ shard: false, failed: 1 }), { outcome: 'failure', traced: true, heat: rules.heat, standing: rules.standing });
  assert.equal(E.liveRunOutcome({ shard: true, compromised: 2 }).traced, true);
  assert.equal(E.evidenceWeight({ bonus: rules.liveEvidence }), 4);
  assert.equal(E.evidenceWeight({}), E.BUSINESS_DEFAULTS.roles.inquiry.evidence);
  assert.equal(E.inquiryTarget(19, 4), 15);
  assert.equal(E.inquiryTarget(19, true), 17);
  assert.equal(E.evidenceMatches({ live: true, ticker: 'MIL' }, { ticker: 'MIL' }), false, 'a shard still on its node is no one\'s evidence');
});

test('a shard taken in a real run is filled in as of then; jack-out settles the run the Netrunner asked for', async () => {
  const { BusinessService, StoryService, HeatService, BusinessRepository } = S;
  const { MODULE_ID, FLAGS } = await import('../scripts/utils/constants.js');
  env.store.set('heatEnabled', true);
  const restore = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => (uuid === `Actor.${cass.id}` ? cass : restore?.(uuid));
  try {
    // NET Architect copies the item, flags and all, and marks where it came from.
    const [item] = await cass.createEmbeddedDocuments('Item', [{
      name: 'Data shard: Nina Noodles', type: 'gear', system: { description: { value: '' } },
      flags: { [MODULE_ID]: { [FLAGS.EVIDENCE]: { live: true, kind: 'npc', businessId: 'bus_npcshop', ticker: null, name: 'Nina Noodles', used: false } }, 'cpr-net-architect': { lootClaim: 'sess1:node:att' } },
    }]);
    item.update = async function (d) {
      for (const [path, value] of Object.entries(d)) {
        const keys = path.split('.');
        let at = this;
        for (const k of keys.slice(0, -1)) at = (at[k] ??= {});
        at[keys.at(-1)] = value;
      }
    };
    await BusinessService.fillLiveShard(item);
    const flag = item.flags[MODULE_ID][FLAGS.EVIDENCE];
    assert.equal(flag.live, false);
    assert.equal(flag.bonus, 4);
    assert.match(flag.note, /Nina 100%/);
    assert.ok(StoryService.evidenceFor(cass, { ticker: null, businessId: 'bus_npcshop' }).includes(item), 'now evidence about the business');

    // The run Cass asked for, followed as NET Architect saves it: in it, a failed node, then jacked out (dropped from it).
    cass.uuid = `Actor.${cass.id}`;
    await cass.setFlag(MODULE_ID, FLAGS.NET_RUN_LIVE, { target: { kind: 'npc', id: 'bus_npcshop', name: 'Nina Noodles', ticker: null }, architectureId: 'arch1', day: 1 });
    await HeatService.setHeat(cass.id, 10);
    const runner = { userId: 'u1', actorUuid: cass.uuid };
    assert.deepEqual(await BusinessService.watchLiveRuns({ id: 'sess1', architectureId: 'arch1', runner, failedNodeIds: [], runners: { u1: { runner, failedNodeIds: [] } } }), []);
    assert.deepEqual(await BusinessService.watchLiveRuns({ id: 'sess1', architectureId: 'arch1', runner, failedNodeIds: ['n2'], runners: { u1: { runner, failedNodeIds: ['n2'] } } }), []);
    assert.deepEqual(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE).failed, ['n2'], 'the failed node is remembered');
    const idle = { id: 'sess1', architectureId: 'arch1', status: 'idle', runner: { userId: null, actorUuid: null }, failedNodeIds: [], runners: {} };
    const [result] = await BusinessService.watchLiveRuns(idle);
    assert.equal(result.outcome, 'success');
    assert.equal(result.traced, true);
    assert.equal(HeatService.heatOf(cass.id), 10 + E.BUSINESS_DEFAULTS.roles.netRun.heat);
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), undefined, 'settled once');
    assert.deepEqual(await BusinessService.watchLiveRuns(null), [], 'nothing left to settle');

    // The real run's shard counts 4 in an investigation.
    const { SkillAdapter } = S;
    const baseFor = SkillAdapter.baseFor;
    const verifyLevers = SkillAdapter.verifyLevers;
    const dvs = [];
    SkillAdapter.baseFor = (actor, use) => (use.ability === 'Backup' && actor.id === cass.id ? { base: 4, name: 'Backup', parts: 'Backup 4' } : baseFor.call(SkillAdapter, actor, use));
    SkillAdapter.verifyLevers = async (actor, request, { dv }) => { dvs.push(dv); return { ok: true, result: { band: 'failure' } }; };
    try {
      await cass.unsetFlag(MODULE_ID, FLAGS.INQUIRED);
      await BusinessService._inquire(cass, { key: `i${Math.random()}`, target: 'b:bus_npcshop' });
      assert.equal(dvs.at(-1), E.BUSINESS_DEFAULTS.roles.inquiry.dv.npc - 4);
      assert.equal(StoryService.evidenceFlag(item).used, true);
    } finally {
      SkillAdapter.baseFor = baseFor;
      SkillAdapter.verifyLevers = verifyLevers;
      await cass.unsetFlag(MODULE_ID, FLAGS.INQUIRED);
    }
    assert.ok(BusinessRepository.get('bus_npcshop'));
  } finally {
    globalThis.fromUuid = restore;
    env.store.set('heatEnabled', false);
  }
});
