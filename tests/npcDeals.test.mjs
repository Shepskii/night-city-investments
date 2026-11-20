import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';
import { resolveRoll } from '../scripts/engine/rolls.js';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Bob', 20000, true]] });
const [alice, bob] = env.actors;
installFakeChat([]);

let S;
let E;

before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    BusinessRepository: (await load('../scripts/data/BusinessRepository.js')).BusinessRepository,
    BusinessService: (await load('../scripts/services/BusinessService.js')).BusinessService,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    WealthAdapter: (await load('../scripts/services/WealthAdapter.js')).WealthAdapter,
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
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const DAY = 20003;
const checkOf = (die) => ({ ok: true, result: resolveRoll({ base: 14, roll: { total: die, crit: null }, dv: 13 }) });
const send = (business, request, check = null, actor = MED, day = DAY) => E.applyBusinessRequest({
  business, request: { key: `k${Math.random()}`, ...request }, actor, day, check,
  context: { approval: false, weekday: 1, actors: {}, newId: 'b1', seed: 'test', factions: [] },
});
/** The rules with an offer certain to come, so the draw can be tested. */
const sure = () => ({ ...E.BUSINESS_DEFAULTS, npcDeals: { ...E.BUSINESS_DEFAULTS.npcDeals, chance: 1 } });

/** A clinic run by the Medtech, open, with its week under way. */
function shop(id = 'b1', { till = 6000 } = {}) {
  let b = send(null, { type: 'found', name: 'Clinic', archetype: 'clinic', district: 'ocz', cash: 4000 }).business;
  b = send(b, { type: 'setupRoll', businessId: 'b1', use: E.ARCHETYPES.clinic.trade[0] }, checkOf(9)).business;
  const out = E.normalizeBusiness({ ...b, id, till });
  delete out.period.event;
  return out;
}

/** The Fixer as a second partner with a vote. */
const withFixer = (b, units = 1000) => {
  b.partners.push({ actorId: 'fix', name: 'Fixer', status: 'active', cash: 1000, gear: [], units, voting: true, heirId: null, leavingSince: null });
  return b;
};

/** An NPC investor already on the table, silent. */
const withInvestor = (b, units = 500) => {
  b.partners.push({ actorId: 'npc:inv1', actorRef: 'inv1', npc: true, name: 'Mira Sato', status: 'active', cash: 1000, gear: [], units, voting: false, heirId: null, leavingSince: null });
  return b;
};

// ── An NPC buys in ───────────────────────────────────────────────────────────

test('X2c an investor\'s offer comes at a month\'s close after profitable weeks, to an unlisted player business', () => {
  const b = shop();
  const investors = [{ ref: 'inv1', name: 'Mira Sato' }];
  assert.equal(E.npcDealEligible(b, [10, 10, 10, 10]), true);
  assert.equal(E.npcDealEligible(b, [10, 10, 10]), false, 'four weeks');
  assert.equal(E.npcDealEligible(b, [10, -1, 10, 10]), false, 'every one a profit');
  assert.equal(E.npcDealEligible({ ...b, npcRun: { auto: true } }, [10, 10, 10, 10]), false, 'not an NPC\'s company');
  assert.equal(E.npcDealEligible({ ...b, listing: { status: 'listed' } }, [10, 10, 10, 10]), false, 'not listed');
  assert.equal(E.npcDealEligible({ ...b, listing: { status: 'scheduled' } }, [10, 10, 10, 10]), false, 'nor on its way');
  assert.equal(E.drawNpcDeal(b, [], [10, 10, 10, 10], 's', DAY, sure()), null, 'no investor contacts, no offer');

  const deal = E.drawNpcDeal(b, investors, [10, 10, 10, 10], 's', DAY, sure());
  assert.equal(deal.status, 'held');
  assert.equal(deal.kind, 'units', 'one voting partner: new units only');
  assert.equal(deal.investor.name, 'Mira Sato');
  const share = deal.units / (E.totalUnits(b) + deal.units);
  assert.ok(share >= 0.095 && share <= 0.205, `10-20% of the business (${share})`);
  assert.ok(deal.price >= E.unitValue(b) - 0.01, 'at least book value');
  assert.equal(E.drawNpcDeal(b, investors, [10, 10, 10, 10], 's', DAY, sure()), null, 'one at a time');

  // The premium for good Reputation, up to 20%.
  assert.equal(E.unitsPremium(50), 0);
  assert.equal(E.unitsPremium(100), 0.2);
  assert.ok(Math.abs(E.unitsPremium(75) - 0.1) < 1e-9);
});

test('X2c new units: the GM offers them, changed, and a majority vote brings the investor in, silent', () => {
  let b = shop();
  b.npcDeal = { id: 'nd1', status: 'held', kind: 'units', investor: { ref: 'inv1', name: 'Mira Sato' }, units: 100, price: 2, amount: 200, drawnDay: DAY };
  assert.equal(E.offerNpcDeal(b, { units: 0 }, DAY).reason, 'bad-amount');
  const offered = E.offerNpcDeal(b, { units: '300', price: '2.5' }, DAY);
  assert.equal(offered.ok, true);
  assert.deepEqual([b.npcDeal.status, b.npcDeal.units, b.npcDeal.amount, b.npcDeal.expires], ['offered', 300, 750, DAY + 7]);
  assert.equal(b.proposals.at(-1).kind, 'npcDeal');
  assert.equal(b.proposals.at(-1).by, null, 'nobody\'s proposal: the investor\'s');
  const till = b.till;
  const units = E.totalUnits(b);
  const out = send(b, { type: 'vote', businessId: 'b1', proposalId: 'nd1', yes: true });
  assert.equal(out.ok, true, out.reason);
  b = out.business;
  const inv = E.partnerOf(b, 'npc:inv1');
  assert.deepEqual([inv.units, inv.voting, inv.npc, inv.actorRef, inv.cash], [300, false, true, 'inv1', 750]);
  assert.equal(b.till, till + 750);
  assert.equal(E.totalUnits(b), units + 300);
  assert.equal(b.npcDeal, null);
  assert.ok(out.events.some((e) => e.type === 'npcDealTaken'));
  assert.equal(b.ledger.at(-1).kind, 'investment');
});

test('X2c a vote against, or no vote in time, ends the offer; the GM can drop one before', () => {
  const b = withFixer(shop());
  b.npcDeal = { id: 'nd2', status: 'held', kind: 'units', investor: { ref: 'inv1', name: 'Mira Sato' }, units: 100, price: 2, amount: 200, drawnDay: DAY };
  E.offerNpcDeal(b, {}, DAY);
  const no = send(structuredClone(b), { type: 'vote', businessId: 'b1', proposalId: 'nd2', yes: false });
  assert.equal(no.business.npcDeal, null);
  assert.ok(no.events.some((e) => e.type === 'npcDealDeclined'));
  const later = E.advanceBusiness(structuredClone(b), DAY + 8);
  assert.equal(later.business.npcDeal, null);
  assert.ok(later.events.some((e) => e.type === 'npcDealLapsed'));
  const held = shop();
  held.npcDeal = { id: 'nd3', status: 'held', kind: 'units', investor: { ref: 'inv1', name: 'X' }, units: 1, price: 1, amount: 1 };
  assert.equal(E.dropNpcDeal(held).ok, true);
  assert.equal(held.npcDeal, null);
});

test('X2c a partner\'s whole stake: theirs alone to sell, for the money, and they leave', () => {
  let b = withFixer(shop());
  // Drawn as a stake only with another voting partner left.
  const deals = Array.from({ length: 30 }, (_, i) => E.drawNpcDeal(structuredClone(b), [{ ref: 'inv1', name: 'Mira Sato' }], [1, 1, 1, 1], `s${i}`, DAY, sure()));
  assert.ok(deals.some((d) => d?.kind === 'stake') && deals.some((d) => d?.kind === 'units'), 'both kinds come');
  const stake = deals.find((d) => d?.kind === 'stake');
  assert.ok(Math.abs(stake.price - Math.round(E.unitValue(b) * 1.15 * 100) / 100) < 0.011, 'book value plus 15%');

  b.npcDeal = { id: 'nd4', status: 'held', kind: 'stake', investor: { ref: 'inv1', name: 'Mira Sato' }, units: 1000, price: 3, amount: 3000, sellerId: 'fix', sellerName: 'Fixer' };
  E.offerNpcDeal(b, {}, DAY);
  assert.equal(b.proposals.some((x) => x.kind === 'npcDeal'), false, 'no vote: the holder answers');
  assert.equal(send(structuredClone(b), { type: 'npcStake', businessId: 'b1', yes: true }).reason, 'no-deal', 'nobody else can');
  const out = send(b, { type: 'npcStake', businessId: 'b1', yes: true }, null, FIX);
  assert.equal(out.ok, true, out.reason);
  b = out.business;
  assert.equal(E.partnerOf(b, 'fix').status, 'left');
  assert.equal(E.partnerOf(b, 'npc:inv1').units, 1000);
  assert.equal(out.wealth.fix, 3000, 'paid to the seller');
  assert.equal(b.ledger.at(-1).kind, 'npcStake');
  const kept = withFixer(shop());
  kept.npcDeal = { id: 'nd5', status: 'offered', kind: 'stake', investor: { ref: 'inv1', name: 'X' }, units: 1000, price: 3, amount: 3000, sellerId: 'fix', expires: DAY + 7 };
  const said = send(kept, { type: 'npcStake', businessId: 'b1', yes: false }, null, FIX);
  assert.equal(said.business.npcDeal, null);
  assert.equal(E.partnerOf(said.business, 'fix').status, 'active');
});

// ── A player buys from an NPC ────────────────────────────────────────────────

test('X2c a partner\'s offer for an NPC holder\'s units: the GM accepts, declines or counters, and a counter is the buyer\'s to take', () => {
  const b = withInvestor(shop());
  assert.equal(send(structuredClone(b), { type: 'npcBid', businessId: 'b1', sellerId: 'npc:inv1', units: 501, price: 2 }).reason, 'bad-amount', 'no more than they hold');
  assert.equal(send(structuredClone(b), { type: 'npcBid', businessId: 'b1', sellerId: 'med', units: 1, price: 2 }).reason, 'not-for-sale', 'only an NPC holder');
  assert.equal(send(structuredClone(b), { type: 'npcBid', businessId: 'b1', sellerId: 'npc:inv1', units: 100, price: 600 }, null, { ...MED, wealth: 100 }).reason, 'insufficient-funds');
  let out = send(b, { type: 'npcBid', businessId: 'b1', sellerId: 'npc:inv1', units: 200, price: 2.5 });
  assert.equal(out.ok, true, out.reason);
  const bid = out.business.npcBids[0];
  assert.deepEqual([bid.status, bid.units, bid.price, bid.sellerName], ['held', 200, 2.5, 'Mira Sato']);
  assert.equal(send(out.business, { type: 'npcBid', businessId: 'b1', sellerId: 'npc:inv1', units: 1, price: 1 }).reason, 'bid-waiting');

  // Accepted, paid from the buyer.
  const accepted = structuredClone(out.business);
  assert.equal(E.answerBid(accepted, bid.id, { answer: 'accept', wealth: 100 }, DAY).reason, 'insufficient-funds');
  const done = E.answerBid(accepted, bid.id, { answer: 'accept', wealth: 5000 }, DAY);
  assert.deepEqual([done.ok, done.amount], [true, 500]);
  assert.equal(E.partnerOf(accepted, 'npc:inv1').units, 300);
  assert.equal(accepted.npcBids.length, 0);

  // Countered, then taken by the buyer at the new price.
  const countered = structuredClone(out.business);
  assert.equal(E.answerBid(countered, bid.id, { answer: 'counter', price: 2.5 }, DAY).reason, 'bad-amount', 'a counter changes the price');
  E.answerBid(countered, bid.id, { answer: 'counter', price: '3' }, DAY);
  assert.deepEqual([countered.npcBids[0].status, countered.npcBids[0].price, countered.npcBids[0].expires], ['countered', 3, DAY + 7]);
  out = send(countered, { type: 'npcCounter', businessId: 'b1', bidId: bid.id, yes: true });
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.wealth.med, -600);
  assert.equal(E.partnerOf(out.business, 'med').units > E.partnerOf(b, 'med').units, true);
  assert.equal(out.business.ledger.at(-1).kind, 'npcBought');

  // A counter left to run out.
  const left = structuredClone(countered);
  const lapsed = E.advanceBusiness(left, DAY + 8);
  assert.equal(lapsed.business.npcBids.length, 0);
  assert.ok(lapsed.events.some((e) => e.type === 'bidLapsed'));

  // Declined.
  const declined = structuredClone(out.business);
  declined.npcBids = [{ ...bid, id: 'bid2' }];
  assert.equal(E.answerBid(declined, 'bid2', { answer: 'decline' }, DAY).ok, true);
  assert.equal(declined.npcBids.length, 0);

  // The receivers can be bought from too; a holder sold out leaves the table.
  const r = shop();
  r.partners.push({ actorId: 'npc:creditors', name: '', status: 'active', cash: 0, gear: [], units: 50, voting: false, heirId: null, leavingSince: null, npc: true, creditors: true });
  const rb = send(r, { type: 'npcBid', businessId: 'b1', sellerId: 'npc:creditors', units: 50, price: 1 }).business;
  E.answerBid(rb, rb.npcBids[0].id, { answer: 'accept', wealth: 100 }, DAY);
  assert.equal(E.partnerOf(rb, 'npc:creditors').status, 'left');
});

test('X2c a block of a listed company\'s public shares: the size, the premium, once a week', () => {
  const b = shop();
  b.listing = { status: 'listed', shares: 2000 };
  b.partners.push({ actorId: 'npc:market', name: '', status: 'active', cash: 0, gear: [], units: 600, voting: false, heirId: null, leavingSince: null, npc: true, market: true });
  assert.equal(E.blockMost(b), 100, '5% of the shares');
  assert.equal(E.blockLeast(10), 11);
  const ask = (units, price, cash = 10000, day = DAY) => E.blockCheck(b, 'alice', { units, price, marketPrice: 10, cash, day });
  assert.equal(ask(101, 12).reason, 'block-size');
  assert.equal(ask(50, 10.99).reason, 'block-price');
  assert.equal(ask(50, 12, 100).reason, 'insufficient-funds');
  const ok = ask(50, 12);
  assert.deepEqual([ok.ok, ok.amount], [true, 600]);
  E.placeBlock(b, { id: 'alice', name: 'Alice' }, { key: 'blk1' }, ok, DAY);
  assert.equal(b.npcBids[0].listed, true);
  E.closeBlock(b, 'blk1', DAY, 600);
  assert.equal(ask(50, 12, 10000, DAY + 3).reason, 'block-week');
  assert.equal(ask(50, 12, 10000, DAY + 7).ok, true);
  assert.equal(send(b, { type: 'npcBid', businessId: 'b1', sellerId: 'npc:market', units: 1, price: 1 }).reason, 'listed', 'a listed company\'s shares go by the block');
});

// ── The GM's side ────────────────────────────────────────────────────────────

test('X2c on the GM\'s side: an offer for an NPC\'s units paid from the sheet; a block from the brokerage into the portfolio', async () => {
  const { BusinessService, BusinessRepository, PortfolioRepository, MarketStore, WealthAdapter } = S;
  const mine = withInvestor(shop('bus_x2c'));
  mine.partners = mine.partners.map((p) => (p.actorId === 'med' ? { ...p, actorId: alice.id, name: 'Alice' } : p));
  mine.npcBids = [{ id: 'bid_s1', status: 'held', buyerId: alice.id, buyerName: 'Alice', sellerId: 'npc:inv1', sellerName: 'Mira Sato', units: 100, price: 2, day: DAY }];
  await BusinessRepository.save(mine);
  const wealth = WealthAdapter.get(alice);
  const done = await BusinessService.answerBid(mine.id, 'bid_s1', 'accept');
  assert.equal(done.ok, true, done.reason);
  assert.equal(WealthAdapter.get(alice), wealth - 200, 'paid from the sheet');
  assert.equal(E.partnerOf(BusinessRepository.get(mine.id), 'npc:inv1').units, 400);

  // A listed company, its public shares with the market.
  const ticker = Object.keys(MarketStore.getPublic().companies)[0];
  const price = MarketStore.getPublic().companies[ticker].price;
  const listed = shop('bus_x2c_listed');
  listed.partners = listed.partners.map((p) => (p.actorId === 'med' ? { ...p, actorId: bob.id, name: 'Bob' } : p));
  const held = E.totalUnits(listed);
  listed.company = { ticker };
  listed.listing = { status: 'listed', shares: held + 1000 };
  listed.partners.push({ actorId: 'npc:market', name: '', status: 'active', cash: 0, gear: [], units: 1000, voting: false, heirId: null, leavingSince: null, npc: true, market: true });
  await BusinessRepository.save(listed);
  await PortfolioRepository.save(alice, { ...PortfolioRepository.get(alice), cash: 100000 });
  // Bob's shares are in his portfolio, as a listed company's are.
  await PortfolioRepository.save(bob, { ...PortfolioRepository.get(bob), lots: [{ id: 'lot_bob', assetType: 'stock', assetId: ticker, qty: held, unitCost: 1, acquiredTick: 0, drip: false }] });

  const each = Math.round((Math.ceil(price * 1.1 * 100) / 100 + 0.01) * 100) / 100;
  const bad = await BusinessService._block({ id: alice.id, name: 'Alice' }, { key: 'blkS', type: 'blockOffer', ticker, units: 10, price: price });
  assert.equal(bad.reason, 'block-price');
  const placed = await BusinessService._block({ id: alice.id, name: 'Alice' }, { key: 'blkS', type: 'blockOffer', ticker, units: 10, price: each });
  assert.equal(placed.ok, true, placed.reason);
  assert.equal(PortfolioRepository.get(alice).blockOffers[0].status, 'held', 'the buyer sees their offer');
  // Countered by the GM, taken by the buyer.
  assert.equal((await BusinessService.answerBid(listed.id, 'blkS', 'counter', Math.round((each + 1) * 100) / 100)).ok, true);
  assert.equal(PortfolioRepository.get(alice).blockOffers[0].status, 'countered');
  const cash = PortfolioRepository.get(alice).cash;
  const taken = await BusinessService._block({ id: alice.id, name: 'Alice' }, { type: 'blockCounter', ticker, bidId: 'blkS', yes: true });
  assert.equal(taken.ok, true, taken.reason);
  const after = PortfolioRepository.get(alice);
  const counter = Math.round((each + 1) * 100) / 100;
  const amount = Math.round(10 * counter);
  assert.equal(after.cash, cash - amount, 'from the brokerage');
  const lot = after.lots.find((l) => l.id === 'lot_block_blkS');
  assert.deepEqual([lot.qty, lot.unitCost, lot.feePerUnit], [10, counter, 0]);
  assert.deepEqual(after.blockOffers, []);
  const record = BusinessRepository.get(listed.id);
  assert.equal(record.partners.find((x) => x.market).units, 990, 'the market\'s holding follows');
  assert.equal(record.partners.find((x) => x.actorId === alice.id)?.units, 10, 'and the buyer is a holder');
});
