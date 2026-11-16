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
    SkillAdapter: (await load('../scripts/services/SkillAdapter.js')).SkillAdapter,
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

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.NewsService._queue, S.BusinessService._queue, S.HeatService._queue]) await q;
  }
};

// ── The rules ────────────────────────────────────────────────────────────────

test('investigation: a month between, the DV by target, and evidence off the DV', () => {
  const rules = E.BUSINESS_DEFAULTS.roles.inquiry;
  assert.equal(E.inquiryWait(null, 100), 0);
  assert.equal(E.inquiryWait(100, 110), rules.days - 10);
  assert.equal(E.inquiryWait(100, 100 + rules.days), 0);
  const corps = [{ ticker: 'AAA', cap: 1 }, { ticker: 'BBB', cap: 5 }, { ticker: 'CCC', cap: 9 }, { ticker: 'DDD', cap: 3 }, { ticker: 'EEE', cap: 7 }, { ticker: 'FFF', cap: 11 }];
  assert.equal(E.inquiryDv({ kind: 'npc' }), rules.dv.npc);
  assert.equal(E.inquiryDv({ kind: 'corp', ticker: 'AAA' }, corps), rules.dv.corp[0], 'the smallest');
  assert.equal(E.inquiryDv({ kind: 'corp', ticker: 'BBB' }, corps), rules.dv.corp[1], 'the middle');
  assert.equal(E.inquiryDv({ kind: 'corp', ticker: 'FFF' }, corps), rules.dv.corp[2], 'the largest');
  assert.equal(E.inquiryTarget(19, true), 19 - rules.evidence);
  assert.equal(E.inquiryTarget(19, false), 19);
});

test('investigation: a story about the target in the last four weeks is evidence', () => {
  const recent = [{ ticker: 'MIL', day: 90 }, { ticker: 'ARA', day: 50 }];
  assert.equal(E.hasEvidence(recent, 'MIL', 100), true);
  assert.equal(E.hasEvidence(recent, 'ARA', 100), false, 'too old');
  assert.equal(E.hasEvidence(recent, 'BIO', 100), false);
  assert.equal(E.hasEvidence(recent, null, 100), false, 'an unlisted NPC business has no stories');
});

test('investigation: a pass opens a case on an NPC business, or drops a corporation by the roll; a fumble is heat and a story', () => {
  const rules = E.BUSINESS_DEFAULTS.roles.inquiry;
  assert.deepEqual(E.inquiryEffect('solid', { kind: 'npc' }), { outcome: 'success', regCase: true, percent: 0, standing: 0, heat: 0, story: false });
  assert.equal(E.inquiryEffect('narrow', { kind: 'corp' }).percent, -2);
  assert.equal(E.inquiryEffect('strong', { kind: 'corp' }).percent, -4);
  assert.equal(E.inquiryEffect('exceptional', { kind: 'corp' }).percent, -6);
  assert.equal(E.inquiryEffect('solid', { kind: 'corp' }).standing, rules.standing);
  assert.deepEqual(E.inquiryEffect('failure', { kind: 'corp' }), { outcome: 'failure', regCase: false, percent: 0, standing: 0, heat: 0, story: false });
  assert.deepEqual(E.inquiryEffect('fumble', { kind: 'npc' }), { outcome: 'fumble', regCase: false, percent: 0, standing: 0, heat: rules.heat, story: true });
});

test('a case can open on an NPC business of any size only for an investigation', () => {
  const b = { stage: 0, status: 'open', regCase: null, ledger: [] };
  assert.equal(E.openCase(b, { reason: 'gm', day: 5 }).reason, 'not-company');
  assert.equal(E.openCase(b, { reason: 'inquiry', day: 5, anyStage: true }).ok, true);
  assert.equal(b.regCase.reason, 'inquiry');
  assert.equal(b.regCase.status, 'notice');
});

// ── The GM's side ────────────────────────────────────────────────────────────

test('a Lawman investigates: an NPC business gets a case, a corporation a headline and a price drop; evidence helps, a month between, a fumble is a smear', async () => {
  const { SkillAdapter, HeatService, MarketStore, BusinessService, BusinessRepository } = S;
  const { MODULE_ID, FLAGS } = await import('../scripts/utils/constants.js');
  const baseFor = SkillAdapter.baseFor;
  const verifyLevers = SkillAdapter.verifyLevers;
  const rolled = { band: 'solid' };
  const dvs = [];
  SkillAdapter.baseFor = (actor, use) => (use.ability === 'Backup' && actor.id === cass.id ? { base: 4, name: 'Backup', parts: 'Backup 4' } : baseFor.call(SkillAdapter, actor, use));
  SkillAdapter.verifyLevers = async (actor, request, { dv }) => { dvs.push(dv); return { ok: true, result: { ...rolled } }; };
  env.store.set('heatEnabled', true);
  const day = BusinessService.day();
  const partner = (actor, units, extra = {}) => ({ actorId: actor.id, name: actor.name, status: 'active', cash: 0, gear: [], units, voting: true, heirId: null, leavingSince: null, ...extra });
  await BusinessRepository.save(E.normalizeBusiness({
    id: 'bus_npcshop', name: 'Nina Noodles', archetype: 'foodStall', status: 'open', stage: 0, createdDay: day - 60, openedDay: day - 60,
    partners: [partner(nina, 100)], till: 2000, assets: 1000, npcRun: { ownerId: nina.id, level: 4, profile: 'steady', auto: true },
    state: { capacity: 3, reputation: 40, costFactor: 1, compliance: 50 },
    period: { index: 1, startDay: day, endDay: day + 7, slots: [], bonuses: [], helpers: [], draws: {}, days: {}, overtime: {} },
  }));
  await BusinessRepository.save(E.normalizeBusiness({
    id: 'bus_cass', name: 'Cass Security', archetype: 'gunShop', status: 'open', stage: 0, createdDay: day - 60, openedDay: day - 60,
    partners: [partner(cass, 100)], till: 2000, assets: 1000, state: { capacity: 3, reputation: 40, costFactor: 1, compliance: 50 },
    period: { index: 1, startDay: day, endDay: day + 7, slots: [], bonuses: [], helpers: [], draws: {}, days: {}, overtime: {} },
  }));
  const inquire = (actor, target) => BusinessService._inquire(actor, { key: `i${Math.random()}`, target });
  try {
    const targets = BusinessService.inquiryTargets();
    assert.deepEqual(targets.npc.map((t) => t.id), ['bus_npcshop'], 'only NPCs\' businesses, not Cass\'s own');
    assert.ok(targets.corps.length >= 3, 'the market\'s corporations');
    const corp = targets.corps[0];
    assert.ok(E.BUSINESS_DEFAULTS.roles.inquiry.dv.corp.includes(corp.dv));

    assert.equal((await inquire(alice, 'b:bus_npcshop')).reason, 'not-lawman');
    assert.equal((await inquire(cass, 'b:bus_cass')).reason, 'no-target', 'a player\'s business is not a target');

    // An NPC's business: a case, a fee, and a month to wait.
    const wealth = cass.system.wealth.value;
    const npc = await inquire(cass, 'b:bus_npcshop');
    await settle();
    assert.equal(npc.ok, true);
    assert.deepEqual(npc.inquiry, { outcome: 'success', kind: 'npc', name: 'Nina Noodles', evidence: false, percent: 0 });
    assert.equal(dvs.at(-1), E.BUSINESS_DEFAULTS.roles.inquiry.dv.npc);
    assert.equal(cass.system.wealth.value, wealth - E.BUSINESS_DEFAULTS.roles.inquiry.cost);
    const regCase = BusinessRepository.get('bus_npcshop').regCase;
    assert.equal(regCase.reason, 'inquiry');
    assert.equal(regCase.status, 'notice');
    assert.equal((await inquire(cass, `c:${corp.ticker}`)).reason, 'inquiry-wait');

    // A corporation, with a story about it lately as evidence: a headline, a queued drop, and standing.
    await cass.unsetFlag(MODULE_ID, FLAGS.INQUIRED);
    rolled.band = 'strong';
    const stories = MarketStore.getStories();
    await MarketStore.setStories({ ...stories, recent: [...(stories.recent ?? []), { actorId: alice.id, ticker: corp.ticker, day }] });
    const hit = await inquire(cass, `c:${corp.ticker}`);
    await settle();
    assert.equal(hit.inquiry.evidence, true);
    assert.equal(hit.inquiry.percent, 4);
    assert.equal(dvs.at(-1), corp.dv - E.BUSINESS_DEFAULTS.roles.inquiry.evidence, 'evidence takes 2 off');
    const impact = MarketStore.getControls().impacts.find((i) => i.sourceKey === `inquiry:${cass.id}:${day}`);
    assert.ok(impact, 'the drop is queued');
    assert.equal(impact.target.id, corp.ticker);
    assert.ok(impact.amount < 0);
    assert.ok(MarketStore.getNews().items.some((n) => (n.companyIds ?? []).includes(corp.ticker) && /investigation|Inquiry/i.test(n.headline)), "a headline");
    assert.ok(MarketStore.getHeat().windows.some((w) => w.sourceKey === `inquiry:${cass.id}:${day}` && w.runners.includes(cass.id)), 'the Lawman knows it is coming');

    // A fumble: heat, and a smear from the corporation that waits for the GM.
    await cass.unsetFlag(MODULE_ID, FLAGS.INQUIRED);
    rolled.band = 'fumble';
    await HeatService.setHeat(cass.id, 20);
    const press = MarketStore.getStories().press;
    await MarketStore.setStories({ ...MarketStore.getStories(), press: { ...press, stories: (press.stories ?? []).filter((s) => s.actorId !== cass.id) } });
    const bad = await inquire(cass, `c:${corp.ticker}`);
    await settle();
    assert.equal(bad.inquiry.outcome, 'fumble');
    assert.equal(HeatService.heatOf(cass.id), 20 + E.BUSINESS_DEFAULTS.roles.inquiry.heat);
    const smear = MarketStore.getStories().press.stories.find((s) => s.actorId === cass.id);
    assert.equal(smear?.story, 'smear');
    assert.equal(smear.status, 'held', 'it waits for the GM as any story does');
    assert.equal(smear.outlet, corp.name);
  } finally {
    SkillAdapter.baseFor = baseFor;
    SkillAdapter.verifyLevers = verifyLevers;
    env.store.set('heatEnabled', false);
    await cass.unsetFlag(MODULE_ID, FLAGS.INQUIRED);
  }
});
