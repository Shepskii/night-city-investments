import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Cass', 50000, true], ['Nina', 50000, false]] });
const [alice, cass, nina] = env.actors;
const { chats } = installFakeChat();

let S;
let E;
let items;

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
  items = (await load('./helpers/fakeItems.mjs')).installFakeItems();
  items.prepare(cass);
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
    // As saved: the runner lingers in `runners` (a flag update merges), but their player is an observer now.
    const idle = { id: 'sess1', architectureId: 'arch1', status: 'idle', runner: { userId: null, actorUuid: null }, failedNodeIds: [], runners: { u1: { runner, failedNodeIds: ['n2'] } }, observers: ['u1'] };
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

// ── A real run on NET Architect (NCI Edition) (ticket 11) ────────────────────

const FORK = 'cpr-net-architect-nci-edition';
const ORIGINAL = 'cpr-net-architect';

/** Which NET modules are active, each with this API, until the returned undo. */
function useModules({ fork = false, original = false, api = {} } = {}) {
  const get = game.modules.get;
  game.modules.get = (id) => {
    if (id === FORK) return fork ? { active: true, title: 'NET Architect (NCI Edition)', api } : undefined;
    if (id === ORIGINAL) return original ? { active: true, title: 'NET Architect', api } : undefined;
    return get(id);
  };
  return () => { game.modules.get = get; };
}

test('the NET module: the fork when it is active, preferred over the original, which still works alone', async () => {
  const { NetArchitectAdapter } = await import('../scripts/integrations/NetArchitectAdapter.js');
  let undo = useModules({ fork: true });
  try {
    assert.equal(NetArchitectAdapter.present(), true);
    assert.equal(NetArchitectAdapter.onFork(), true);
  } finally { undo(); }
  undo = useModules({ fork: true, original: true });
  try {
    assert.equal(NetArchitectAdapter.onFork(), true, 'the fork, when both are');
    assert.equal(NetArchitectAdapter.moduleId(), FORK);
  } finally { undo(); }
  undo = useModules({ original: true });
  try {
    assert.equal(NetArchitectAdapter.present(), true);
    assert.equal(NetArchitectAdapter.onFork(), false);
    assert.equal(NetArchitectAdapter.moduleId(), ORIGINAL);
  } finally { undo(); }
  undo = useModules({});
  try {
    assert.equal(NetArchitectAdapter.present(), false);
  } finally { undo(); }
});

/**
 * A world on the fork: Cass a Netrunner (Interface 4) and her player u1, the authority GM gm1 and a second GM gm2,
 * Nina Noodles linked to the architecture arch1, heat on. Runs `body`, then puts everything back.
 */
async function onTheFork(body, { modules = { fork: true }, api = {} } = {}) {
  const { SkillAdapter, BusinessService, HeatService } = S;
  const { MODULE_ID, FLAGS, SETTINGS } = await import('../scripts/utils/constants.js');
  const undo = useModules({ ...modules, api });
  const users = game.users;
  const user = game.user;
  const baseFor = SkillAdapter.baseFor;
  const restore = globalThis.fromUuid;
  const links = env.store.get(SETTINGS.NET_ARCH_LINKS);
  const gm1 = { id: 'gm1', isGM: true, active: true };
  const gm2 = { id: 'gm2', isGM: true, active: true };
  game.users = Object.assign([gm1, gm2, { id: 'u1', isGM: false, active: true }], { activeGM: gm1 });
  game.user = gm1;
  cass.uuid = `Actor.${cass.id}`;
  alice.uuid = `Actor.${alice.id}`;
  SkillAdapter.baseFor = (actor, use) => (use.ability === 'Interface' && actor.id === cass.id ? { base: 4, name: 'Interface', parts: 'Interface 4' } : baseFor.call(SkillAdapter, actor, use));
  env.store.set(SETTINGS.NET_ARCHITECT, true);
  env.store.set(SETTINGS.NET_ARCH_LINKS, { 'b:bus_npcshop': 'arch1' });
  env.store.set('heatEnabled', true);
  await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN);
  await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN_LIVE);
  await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN_SESSION);
  await HeatService.setHeat(cass.id, 10);
  try {
    await body({ BusinessService, HeatService, MODULE_ID, FLAGS, gm1, gm2, asGm: (u) => { game.user = u; } });
  } finally {
    undo();
    game.users = users;
    game.user = user;
    SkillAdapter.baseFor = baseFor;
    globalThis.fromUuid = restore;
    env.store.set(SETTINGS.NET_ARCH_LINKS, links);
    env.store.set(SETTINGS.NET_ARCHITECT, false);
    env.store.set('heatEnabled', false);
    await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN);
    await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN_LIVE);
    await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN_SESSION);
  }
}

const started = (extra = {}) => ({ sessionId: 'fs1', architectureId: 'arch1', actorUuid: `Actor.${cass.id}`, userId: 'u1', ...extra });
const whispersSince = (n) => chats.slice(n).filter((c) => c.whisper?.length);

test("on the fork, a run on a linked architecture with the week free is the runner's real run, however it started", async () => {
  await onTheFork(async ({ BusinessService, MODULE_ID, FLAGS }) => {
    await BusinessService.onLiveRunStarted(started());
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN), BusinessService.day(), "the week's NET run is used");
    const asked = cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE);
    assert.equal(asked.sessionId, 'fs1');
    assert.equal(asked.architectureId, 'arch1');
    assert.deepEqual({ kind: asked.target.kind, id: asked.target.id, name: asked.target.name }, { kind: 'npc', id: 'bus_npcshop', name: 'Nina Noodles' });
  });
});

test('on the fork, a run with the week already used is whispered to the runner and the GM as not counting, and ignored', async () => {
  await onTheFork(async ({ BusinessService, MODULE_ID, FLAGS }) => {
    const earlier = BusinessService.day() - 2;
    await cass.setFlag(MODULE_ID, FLAGS.NET_RUN, earlier);
    const n = chats.length;
    await BusinessService.onLiveRunStarted(started());
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN), earlier, 'the week is as it was');
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), undefined, 'not followed');
    const [told] = whispersSince(n);
    assert.ok(told, 'a whisper');
    assert.match(told.content, /NotCounted/);
    assert.match(told.content, /Nina Noodles/);
    assert.ok(told.whisper.includes('u1') && told.whisper.includes('gm1'), 'to the runner and the GM');
  });
});

test('on the fork, a run on an architecture linked to no target, or by someone who is no Netrunner, is ignored', async () => {
  await onTheFork(async ({ BusinessService, MODULE_ID, FLAGS }) => {
    const n = chats.length;
    await BusinessService.onLiveRunStarted(started({ architectureId: 'arch-unlinked' }));
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN), undefined);
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), undefined);
    await BusinessService.onLiveRunStarted(started({ actorUuid: `Actor.${alice.id}` }));
    assert.equal(alice.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), undefined);
    assert.equal(whispersSince(n).length, 0, 'nobody is told anything');
  });
});

test('on the fork, the runner leaving settles their run: a pass with the shard, traced with a failed or compromised node, else a plain fail', async () => {
  await onTheFork(async ({ BusinessService, HeatService, MODULE_ID, FLAGS }) => {
    const { BUSINESS_DEFAULTS } = E;
    const left = (extra = {}) => ({ sessionId: 'fs1', actorUuid: `Actor.${cass.id}`, userId: 'u1', failedNodeIds: [], compromisedNodeIds: [], itemsTaken: [], ...extra });
    const result = (n) => whispersSince(n).map((c) => c.content).find((t) => /NetRunLive\.Result/.test(t));
    const begin = async (sessionId) => {
      await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN);
      await BusinessService.onLiveRunStarted(started({ sessionId }));
      assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE)?.sessionId, sessionId);
    };

    // A pass: the shard about the target came out with them (filled in when taken), nothing failed.
    await begin('fs1');
    const [shard] = await cass.createEmbeddedDocuments('Item', [{
      name: 'Data shard: Nina Noodles', type: 'gear', system: { description: { value: '' } },
      flags: { [MODULE_ID]: { [FLAGS.EVIDENCE]: { live: false, businessId: 'bus_npcshop', ticker: null, name: 'Nina Noodles', source: 'netarchitect', bonus: 4, used: false } }, [FORK]: { lootClaim: 'fs1:n3:att1' } },
    }]);
    let n = chats.length;
    await BusinessService.onLiveRunnerLeft(left({ itemsTaken: [{ nodeId: 'n3', attachmentId: 'att1', sourceUuid: 'Item.src', itemUuid: shard.uuid }] }));
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), undefined, 'settled');
    assert.equal(HeatService.heatOf(cass.id), 10, 'not traced');
    assert.match(result(n), /Result\.success /);
    await cass.deleteEmbeddedDocuments('Item', [shard.id]);

    // Traced: a node failed on the way, and no shard.
    await begin('fs2');
    n = chats.length;
    await BusinessService.onLiveRunnerLeft(left({ sessionId: 'fs2', failedNodeIds: ['n2'] }));
    assert.equal(HeatService.heatOf(cass.id), 10 + BUSINESS_DEFAULTS.roles.netRun.heat);
    assert.match(result(n), /Result\.failureTraced/);

    // A plain fail: out without the data, unseen.
    await HeatService.setHeat(cass.id, 10);
    await begin('fs3');
    n = chats.length;
    await BusinessService.onLiveRunnerLeft(left({ sessionId: 'fs3' }));
    assert.equal(HeatService.heatOf(cass.id), 10);
    assert.match(result(n), /Result\.failure /);
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), undefined);
  });
});

test('on the fork, with several GMs connected only the authority GM counts and settles, and a runner is settled once a run', async () => {
  await onTheFork(async ({ BusinessService, HeatService, MODULE_ID, FLAGS, gm1, gm2, asGm }) => {
    const left = { sessionId: 'fs1', actorUuid: `Actor.${cass.id}`, userId: 'u1', failedNodeIds: ['n2'], compromisedNodeIds: [], itemsTaken: [] };
    const n0 = chats.length;
    // Every client hears the hooks; the second GM leaves them alone.
    asGm(gm2);
    await BusinessService.onLiveRunStarted(started());
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN), undefined, 'not counted by the second GM');
    asGm(gm1);
    await BusinessService.onLiveRunStarted(started());
    await BusinessService.onLiveRunStarted(started());
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE)?.sessionId, 'fs1', 'counted once, with no whisper for the repeat');
    asGm(gm2);
    await BusinessService.onLiveRunnerLeft(left);
    assert.ok(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), 'not settled by the second GM');
    asGm(gm1);
    const n = chats.length;
    await BusinessService.onLiveRunnerLeft(left);
    await BusinessService.onLiveRunnerLeft(left);
    await BusinessService.onLiveRunEnded({ sessionId: 'fs1' });
    assert.equal(HeatService.heatOf(cass.id), 10 + E.BUSINESS_DEFAULTS.roles.netRun.heat, 'traced once');
    assert.equal(whispersSince(n).length, 1, 'one result');
    assert.ok(!whispersSince(n0).some((c) => /NotCounted/.test(c.content)), 'the repeat start is not whispered as not counting');
  });
});

test('on the fork, a runner the GM adds back into a run they were settled from is not counted again, nor told it won\'t count', async () => {
  await onTheFork(async ({ BusinessService, MODULE_ID, FLAGS }) => {
    await BusinessService.onLiveRunStarted(started());
    const day = cass.getFlag(MODULE_ID, FLAGS.NET_RUN);
    await BusinessService.onLiveRunnerLeft({ sessionId: 'fs1', actorUuid: cass.uuid, userId: 'u1', failedNodeIds: [], compromisedNodeIds: [], itemsTaken: [] });
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), undefined, 'settled');
    const n = chats.length;
    // The GM adds Cass back: the fork fires runStarted again, with the same session.
    await BusinessService.onLiveRunStarted(started());
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN), day, 'the week as it was');
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), undefined, 'not followed again');
    assert.equal(whispersSince(n).length, 0, 'nobody is told anything');
  });
});

test("on the fork, a run that ends with a runner NCI missed leaving settles them from the fork's session if it is still there, else from what was kept, with a warning", async () => {
  let session = null;
  const api = { getActiveSession: () => session };
  await onTheFork(async ({ BusinessService, HeatService, MODULE_ID, FLAGS }) => {
    // The session is still there: Cass failed a node on the way, so she is traced.
    await BusinessService.onLiveRunStarted(started());
    session = { id: 'fs1', compromisedNodeIds: [], runners: { u1: { runner: { actorUuid: cass.uuid, userId: 'u1' }, failedNodeIds: ['n2'] } } };
    const [traced] = await BusinessService.onLiveRunEnded({ sessionId: 'fs1' });
    assert.equal(traced.traced, true, 'traced from the session');
    assert.equal(HeatService.heatOf(cass.id), 10 + E.BUSINESS_DEFAULTS.roles.netRun.heat);
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), undefined, 'settled');

    // A node compromised in the run traces her too.
    await HeatService.setHeat(cass.id, 10);
    await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN);
    await BusinessService.onLiveRunStarted(started({ sessionId: 'fs2' }));
    session = { id: 'fs2', compromisedNodeIds: ['n3'], runners: { u1: { runner: { actorUuid: cass.uuid, userId: 'u1' }, failedNodeIds: [] } } };
    assert.equal((await BusinessService.onLiveRunEnded({ sessionId: 'fs2' }))[0].traced, true, 'traced by a compromised node');

    // Gone (or another run's): settled with what was kept, and a warning.
    await HeatService.setHeat(cass.id, 10);
    await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN);
    await BusinessService.onLiveRunStarted(started({ sessionId: 'fs3' }));
    session = { id: 'other', compromisedNodeIds: ['n3'], runners: {} };
    const warn = console.warn;
    const warned = [];
    console.warn = (...args) => warned.push(args.join(' '));
    try {
      const [plain] = await BusinessService.onLiveRunEnded({ sessionId: 'fs3' });
      assert.equal(plain.traced, false);
    } finally {
      console.warn = warn;
    }
    assert.equal(HeatService.heatOf(cass.id), 10);
    assert.equal(warned.length, 1, 'a warning');
    assert.match(warned[0], /fs3/);
  }, { api });
});

test("on the fork, a run asked for on the heat panel is confirmed by the GM, started through the API, and counted by the fork's hook, once", async () => {
  const { SETTINGS } = await import('../scripts/utils/constants.js');
  const starts = [];
  const asks = [];
  let session = null;
  const api = {
    getActiveSession: () => session,
    // The fork saves the run, then fires runStarted on this client; NCI's listener queues it.
    startNetrun: async (architectureId, actorUuid, options) => {
      starts.push({ architectureId, actorUuid, options });
      session = { id: 'fs9', architectureId };
      S.BusinessService._queue.run(() => S.BusinessService.onLiveRunStarted({ sessionId: 'fs9', architectureId, actorUuid, userId: options.userId }));
    },
  };
  const applications = globalThis.foundry.applications;
  globalThis.foundry.applications = { api: { DialogV2: { confirm: async (o) => { asks.push(o); return true; } } } };
  try {
    await onTheFork(async ({ BusinessService, MODULE_ID, FLAGS }) => {
      // Another target on the same architecture, linked first: the run is still the one the panel asked for.
      const corp = BusinessService.inquiryTargets().corps[0];
      env.store.set(SETTINGS.NET_ARCH_LINKS, { [`c:${corp.ticker}`]: 'arch1', 'b:bus_npcshop': 'arch1' });
      const n = chats.length;
      const out = await BusinessService._netRunLive(cass, { target: 'b:bus_npcshop', userId: 'u1' });
      assert.equal(out.netRun.outcome, 'asked');
      await settle();
      assert.equal(asks.length, 1, 'the GM is asked');
      assert.deepEqual(starts.map((s) => [s.architectureId, s.actorUuid, s.options.userId]), [['arch1', `Actor.${cass.id}`, 'u1']]);
      assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN), BusinessService.day());
      const asked = cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE);
      assert.equal(asked.sessionId, 'fs9');
      assert.equal(asked.target.kind, 'npc');
      assert.equal(asked.target.ticker, null, 'nothing of the other target');
      assert.ok(!whispersSince(n).some((c) => /NotCounted/.test(c.content)), 'not told it won\'t count');
    }, { api });
  } finally {
    globalThis.foundry.applications = applications;
  }
});

test("on the fork, the heat panel's target is forgotten once the runner's run starts, even a run NCI doesn't count", async () => {
  const { SETTINGS } = await import('../scripts/utils/constants.js');
  await onTheFork(async ({ BusinessService, MODULE_ID, FLAGS }) => {
    const corp = BusinessService.inquiryTargets().corps[0];
    const npc = BusinessService._runTarget('b:bus_npcshop');
    // The panel asked for Nina Noodles on arch1, but the run that started was on an architecture linked to nothing.
    BusinessService._expectedRuns.set(cass.uuid, { target: npc, architectureId: 'arch1' });
    await BusinessService.onLiveRunStarted(started({ architectureId: 'arch-unlinked' }));
    // Later Cass jacks in at an access point on arch1, where the corporation is linked first: it counts against that.
    env.store.set(SETTINGS.NET_ARCH_LINKS, { [`c:${corp.ticker}`]: 'arch1', 'b:bus_npcshop': 'arch1' });
    await BusinessService.onLiveRunStarted(started({ sessionId: 'fs2' }));
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE)?.target.ticker, corp.ticker, 'the first linked target, not the old ask');
  });
});

test('on the original NET Architect, a heat panel run is counted at its start and settled from the saved session, as before; fork hooks change nothing', async () => {
  let session = null;
  const api = {
    getActiveSession: () => session,
    startNetrun: async (architectureId, actorUuid, options) => {
      session = { id: 'os1', architectureId, runner: { userId: options.userId, actorUuid }, failedNodeIds: [], runners: {} };
    },
  };
  const applications = globalThis.foundry.applications;
  globalThis.foundry.applications = { api: { DialogV2: { confirm: async () => true } } };
  try {
    await onTheFork(async ({ BusinessService, HeatService, MODULE_ID, FLAGS }) => {
      await BusinessService.onLiveRunStarted(started());
      assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN), undefined, 'the fork\'s hooks are not followed');

      await BusinessService._netRunLive(cass, { target: 'b:bus_npcshop', userId: 'u1' });
      await settle();
      assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN), BusinessService.day());
      assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE).sessionId, 'os1');

      const [shard] = await cass.createEmbeddedDocuments('Item', [{
        name: 'Data shard: Nina Noodles', type: 'gear', system: { description: { value: '' } },
        flags: { [MODULE_ID]: { [FLAGS.EVIDENCE]: { live: false, businessId: 'bus_npcshop', ticker: null, name: 'Nina Noodles', bonus: 4, used: false } }, [ORIGINAL]: { lootClaim: 'os1:n3:att1' } },
      }]);
      await BusinessService.onLiveRunnerLeft({ sessionId: 'os1', actorUuid: cass.uuid, failedNodeIds: ['n1'], compromisedNodeIds: [], itemsTaken: [] });
      assert.ok(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE), 'still followed from the saved session');
      const [result] = await BusinessService.watchLiveRuns(null);
      assert.equal(result.outcome, 'success');
      assert.equal(result.traced, false);
      assert.equal(HeatService.heatOf(cass.id), 10);
      await cass.deleteEmbeddedDocuments('Item', [shard.id]);
    }, { modules: { original: true }, api });
  } finally {
    globalThis.foundry.applications = applications;
  }
});

// ── The fork's data shard, made and attached by NCI (ticket 12) ──────────────

/** Nodes of the architecture arch1, as the fork's editor saves them. */
const NODES = [
  { id: 'n1', type: 'access', name: 'Front door' },
  { id: 'n2', type: 'password', name: 'Gate' },
  { id: 'n3', type: 'data', name: 'Ledgers' },
  { id: 'n4', type: 'file', name: 'Mail' },
  { id: 'n5', type: 'objective', name: 'Core' },
  { id: 'n6', type: 'objective', name: 'Vault' },
];

/**
 * On the fork, with arch1 in its world compendium and its `addRunItem` recording what it is given; the shards NCI makes
 * are world Items. `body` gets what was attached, and the fork's API.
 */
async function withFork(body, { nodes = NODES, addRunItem, modules = { fork: true } } = {}) {
  const attached = [];
  const api = {
    getActiveSession: () => null,
    addRunItem: addRunItem ?? (async (nodeId, itemUuid, options) => { attached.push({ nodeId, itemUuid, visible: options?.visible }); return `att${attached.length}`; }),
  };
  const doc = { getFlag: (scope, key) => (scope === FORK && key === 'architecture' ? { id: 'arch1', name: 'Noodle net', nodes } : undefined) };
  const packs = game.packs;
  const Item = globalThis.Item;
  game.packs = { get: (id) => (id === `world.${FORK}` ? { getDocuments: async () => [doc] } : undefined) };
  globalThis.Item = { createDocuments: async (list) => list.map((data) => items.library(data)) };
  try {
    await onTheFork((ctx) => body({ ...ctx, attached, api }), { api, modules });
  } finally {
    game.packs = packs;
    globalThis.Item = Item;
  }
}

test("on the fork, a counted run gets the target's data shard on the node the GM chose, visible to the runner", async () => {
  await withFork(async ({ BusinessService, MODULE_ID, FLAGS, attached }) => {
    const { NetArchitectAdapter } = await import('../scripts/integrations/NetArchitectAdapter.js');
    await NetArchitectAdapter.link('b:bus_npcshop', 'arch1', 'n4');
    await BusinessService.onLiveRunStarted(started());
    assert.equal(attached.length, 1, 'one shard');
    const [{ nodeId, itemUuid, visible }] = attached;
    assert.equal(nodeId, 'n4');
    assert.equal(visible, true);
    const shard = await fromUuid(itemUuid);
    assert.equal(shard.name, 'NCI.NetRunLive.ShardName {"name":"Nina Noodles"}');
    assert.deepEqual(shard.flags[MODULE_ID][FLAGS.EVIDENCE], { live: true, kind: 'npc', ticker: null, businessId: 'bus_npcshop', name: 'Nina Noodles', used: false });
  });
});

test('on the fork, with no node chosen (or one the architecture no longer has) the shard goes on the first objective node, then file, then data', async () => {
  const runWith = async (nodes, link) => {
    let nodeId = null;
    await withFork(async ({ BusinessService, attached }) => {
      if (link) env.store.set('netArchitectLinks', { 'b:bus_npcshop': link });
      await BusinessService.onLiveRunStarted(started());
      assert.equal(attached.length, 1);
      nodeId = attached[0].nodeId;
    }, { nodes });
    return nodeId;
  };
  assert.equal(await runWith(NODES), 'n5', 'an old link, a plain architecture id: the first objective node');
  assert.equal(await runWith(NODES, { architectureId: 'arch1', nodeId: 'gone' }), 'n5', 'the chosen node was deleted');
  assert.equal(await runWith(NODES.filter((n) => n.type !== 'objective')), 'n4', 'then a file node');
  assert.equal(await runWith(NODES.filter((n) => n.type !== 'objective' && n.type !== 'file')), 'n3', 'then a data node');
});

test('on the fork, with no node to hold the data the run still counts, without a shard, and the GM is told; so too if the fork refuses it', async () => {
  await withFork(async ({ BusinessService, MODULE_ID, FLAGS, attached }) => {
    const n = chats.length;
    await BusinessService.onLiveRunStarted(started());
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE)?.sessionId, 'fs1', 'counted');
    assert.equal(attached.length, 0, 'no shard');
    const [told] = whispersSince(n);
    assert.match(told.content, /NoShardNode/);
    assert.deepEqual(told.whisper, ['gm1', 'gm2'], 'to the GMs only');
  }, { nodes: NODES.filter((n) => ['access', 'password'].includes(n.type)) });

  await withFork(async ({ BusinessService, MODULE_ID, FLAGS }) => {
    const n = chats.length;
    await BusinessService.onLiveRunStarted(started());
    assert.equal(cass.getFlag(MODULE_ID, FLAGS.NET_RUN_LIVE)?.sessionId, 'fs1', 'counted');
    const [told] = whispersSince(n);
    assert.match(told.content, /ShardNotAttached/);
    assert.match(told.content, /No active NETRUN/);
    assert.deepEqual(told.whisper, ['gm1', 'gm2']);
  }, { addRunItem: async () => { throw new Error('No active NETRUN.'); } });
});

test("on the fork, when NCI can't make the shard the GM is told why in words, never a code", async () => {
  await withFork(async ({ BusinessService, attached }) => {
    const n = chats.length;
    // The world refuses the Item.
    globalThis.Item = { createDocuments: async () => [] };
    await BusinessService.onLiveRunStarted(started());
    assert.equal(attached.length, 0);
    const [told] = whispersSince(n);
    assert.match(told.content, /ShardNotAttached/);
    assert.match(told.content, /NetRunLive\.ShardReason\.not-made/);
    assert.doesNotMatch(told.content, /undefined/);
  });
  await withFork(async ({ BusinessService }) => {
    const make = BusinessService.makeLiveShard;
    BusinessService.makeLiveShard = async () => ({ ok: false, reason: 'something-new' });
    try {
      const n = chats.length;
      await BusinessService.onLiveRunStarted(started());
      const [told] = whispersSince(n);
      assert.match(told.content, /NetRunLive\.ShardReason\.unknown/, 'a reason it has no words for: the generic one');
      assert.doesNotMatch(told.content, /something-new/);
    } finally {
      BusinessService.makeLiveShard = make;
    }
  });
});

test("on the fork, a run NCI doesn't count gets no shard", async () => {
  await withFork(async ({ BusinessService, MODULE_ID, FLAGS, attached }) => {
    await cass.setFlag(MODULE_ID, FLAGS.NET_RUN, BusinessService.day() - 1);
    await BusinessService.onLiveRunStarted(started());
    assert.equal(attached.length, 0, 'the week was used');
    await cass.unsetFlag(MODULE_ID, FLAGS.NET_RUN);
    await BusinessService.onLiveRunStarted(started({ architectureId: 'arch-unlinked' }));
    await BusinessService.onLiveRunStarted(started({ actorUuid: `Actor.${alice.id}` }));
    assert.equal(attached.length, 0, 'unlinked, or no Netrunner');
  });
});

test('on the fork, the shard NCI attached is filled in when taken, counts as a real run\'s evidence, and settles the run as a pass', async () => {
  await withFork(async ({ BusinessService, HeatService, MODULE_ID, FLAGS, attached }) => {
    const { StoryService } = S;
    const messenger = StoryService.toMessenger;
    const sent = [];
    StoryService.toMessenger = async (item, info) => { sent.push(info); };
    try {
      await BusinessService.onLiveRunStarted(started());
      const source = await fromUuid(attached[0].itemUuid);
      // The fork copies the attached Item onto the runner's actor, flags and all, marking where it came from.
      const data = source.toObject();
      delete data._id;
      data.flags[FORK] = { lootClaim: `fs1:${attached[0].nodeId}:att1` };
      const [taken] = await cass.createEmbeddedDocuments('Item', [data]);
      taken.update = async function (d) {
        for (const [path, value] of Object.entries(d)) {
          const keys = path.split('.');
          let at = this;
          for (const k of keys.slice(0, -1)) at = (at[k] ??= {});
          at[keys.at(-1)] = value;
        }
      };
      await BusinessService.fillLiveShard(taken);
      const flag = taken.flags[MODULE_ID][FLAGS.EVIDENCE];
      assert.equal(flag.live, false, 'filled in');
      assert.equal(flag.bonus, E.BUSINESS_DEFAULTS.roles.netRun.liveEvidence, "a real run's weight");
      assert.match(flag.note, /Nina 100%/, 'the ledger as of now');
      assert.equal(sent.length, 1, 'shown in Messenger');
      assert.ok(StoryService.evidenceFor(cass, { ticker: null, businessId: 'bus_npcshop' }).includes(taken), 'evidence about the target');

      const n = chats.length;
      const [result] = [await BusinessService.onLiveRunnerLeft({
        sessionId: 'fs1', actorUuid: cass.uuid, userId: 'u1', failedNodeIds: [], compromisedNodeIds: [],
        itemsTaken: [{ nodeId: attached[0].nodeId, attachmentId: 'att1', sourceUuid: source.uuid, itemUuid: taken.uuid }],
      })];
      assert.equal(result.outcome, 'success');
      assert.equal(result.traced, false);
      assert.equal(HeatService.heatOf(cass.id), 10);
      assert.ok(whispersSince(n).some((c) => /Result\.success /.test(c.content)));
      await cass.deleteEmbeddedDocuments('Item', [taken.id]);
    } finally {
      StoryService.toMessenger = messenger;
    }
  });
});

test("the GM Console's NET runs tab: on the fork, a linked target offers its architecture's nodes for the data and no manual shard; on the original, the manual shard", async () => {
  const { context, pickArchitecture } = await import('../scripts/ui/GMConsole/tabs/netRuns.js');
  const { NetArchitectAdapter } = await import('../scripts/integrations/NetArchitectAdapter.js');
  const rowOf = () => context({ render() {} }).netRuns.rows.find((r) => r.key === 'b:bus_npcshop');
  await withFork(async () => {
    await NetArchitectAdapter.link('b:bus_npcshop', 'arch1', 'n4');
    await NetArchitectAdapter.load();
    const row = rowOf();
    assert.equal(row.manualShard, false);
    assert.deepEqual(row.nodes.map((o) => o.value), ['', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'], 'the default, then each node');
    assert.equal(row.nodes.find((o) => o.selected).value, 'n4', 'the chosen node');
    assert.match(row.nodes[4].label, /Mail/);
    await NetArchitectAdapter.link('b:bus_npcshop', 'arch1');
    assert.equal(rowOf().nodes.find((o) => o.selected).value, '', 'no node chosen: the default');
    const other = context({ render() {} }).netRuns.rows.find((r) => r.key !== 'b:bus_npcshop');
    assert.equal(other.nodes.length, 0, 'an unlinked target has none');
  });
  await withFork(async () => {
    await NetArchitectAdapter.load();
    await NetArchitectAdapter.link('b:bus_npcshop', '');
    // Choosing an architecture for an unlinked target offers its nodes at once, before Save.
    const app = { render() {} };
    pickArchitecture(app, 'b:bus_npcshop', 'arch1');
    const row = context(app).netRuns.rows.find((r) => r.key === 'b:bus_npcshop');
    assert.equal(row.options.find((o) => o.selected).value, 'arch1', 'the architecture chosen');
    assert.deepEqual(row.nodes.map((o) => o.value), ['', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'], "its nodes, before it's saved");
    assert.equal(row.nodes.find((o) => o.selected).value, '', 'the default');
    assert.equal(row.linked, false, 'not linked until saved');
    pickArchitecture(app, 'b:bus_npcshop', '');
    assert.equal(context(app).netRuns.rows.find((r) => r.key === 'b:bus_npcshop').nodes.length, 0, 'no architecture, no nodes');
  });
  await withFork(async () => {
    await NetArchitectAdapter.load();
    const row = rowOf();
    assert.equal(row.manualShard, true);
    assert.equal(row.nodes.length, 0);
  }, { modules: { original: true } });
});
