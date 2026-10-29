import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySyndicateRequest, advanceSyndicate, approveSyndicate, decideProposal, closeSyndicate, navOf, freeUnits, syndicateUnits, memberOf, emptyPortfolio,
} from '../scripts/engine/index.js';

const MED = { id: 'med', name: 'Medtech' };
const FIX = { id: 'fix', name: 'Fixer' };
const SOLO = { id: 'solo', name: 'Solo' };
const ACTORS = { med: 'Medtech', fix: 'Fixer', solo: 'Solo' };
const DAY = 20003;
const MARKET = { ARA: { price: 100 }, MIL: { price: 40 } };

const account = (cash) => ({ ...emptyPortfolio(), cash });
let n = 0;

function apply(books, request, actor, extra = {}) {
  const out = applySyndicateRequest({
    books, request: { key: `k${++n}`, ...request }, actor, day: extra.day ?? DAY, tick: extra.tick ?? 1, market: extra.market ?? MARKET,
    context: { approval: false, actors: ACTORS, newId: 's1', settlementDays: 2, ...extra.context },
  });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/** The Medtech founds the syndicate and the Fixer joins; each has 10,000 eb in their own brokerage account. */
function crew() {
  let books = apply(null, { type: 'found', name: 'Back Room Capital', invite: ['fix', 'nobody'] }, MED).books;
  books = { ...books, members: { med: account(10000), fix: account(10000) } };
  books = apply(books, { type: 'join' }, FIX).books;
  return books;
}

/** A crew that has paid in: the Medtech 3,000 eb, the Fixer 1,500. */
function funded() {
  let books = crew();
  books = apply(books, { type: 'deposit', amount: 3000 }, MED).books;
  books = apply(books, { type: 'deposit', amount: 1500 }, FIX).books;
  return books;
}

/** Give the syndicate's account a holding, as a filled order would. */
const hold = (books, assetId, qty, price) => ({
  ...books,
  portfolio: { ...books.portfolio, cash: books.portfolio.cash - qty * price, lots: [...books.portfolio.lots, { assetId, qty, price, tick: 1 }] },
});

test('a character founds a syndicate as its first officer; with GM approval on, it waits', () => {
  const pending = apply(null, { type: 'found', name: 'Back Room Capital', invite: ['fix', 'med', 'nobody'] }, MED, { context: { approval: true } }).books.syndicate;
  assert.equal(pending.status, 'pending');
  assert.deepEqual(pending.members.map((m) => [m.actorId, m.role, m.status]), [['med', 'officer', 'active'], ['fix', 'member', 'invited']], 'only known characters, and never the founder twice');
  assert.equal(apply({ syndicate: pending, portfolio: emptyPortfolio(), members: { med: account(100) } }, { type: 'deposit', amount: 10 }, MED, { expect: false }).reason, 'not-active');
  assert.equal(approveSyndicate(pending).syndicate.status, 'active');
  assert.equal(apply(null, { type: 'found', name: 'X' }, MED, { expect: false }).reason, 'bad-name');
});

test('the invited join or decline; nobody else can', () => {
  const books = crew();
  assert.equal(memberOf(books.syndicate, 'fix').status, 'active');
  assert.equal(apply(books, { type: 'join' }, SOLO, { expect: false }).reason, 'not-invited');
  const declined = apply(apply(null, { type: 'found', name: 'Other', invite: ['solo'] }, MED).books, { type: 'decline' }, SOLO).books;
  assert.equal(memberOf(declined.syndicate, 'solo').status, 'declined');
});

test('a deposit moves cash from the member\'s own account and buys units at NAV', () => {
  let books = crew();
  const first = apply(books, { type: 'deposit', amount: 3000 }, MED);
  books = first.books;
  assert.deepEqual(first.changed, ['med']);
  assert.equal(books.members.med.cash, 7000);
  assert.equal(books.portfolio.cash, 3000);
  assert.equal(memberOf(books.syndicate, 'med').units, 3000, 'one unit per eb while none exist');
  assert.equal(books.members.med.ledger.at(-1).kind, 'syndicateDeposit');
  assert.equal(books.portfolio.ledger.at(-1).kind, 'memberDeposit', 'the same payment, as the syndicate sees it');

  // The account doubles in value: the next eddie buys half a unit.
  books = hold(books, 'ARA', 30, 100);
  const doubled = { ...MARKET, ARA: { price: 200 } };
  books = apply(books, { type: 'deposit', amount: 1500 }, FIX, { market: doubled }).books;
  assert.equal(memberOf(books.syndicate, 'fix').units, 750);
  assert.equal(navOf(books.syndicate, books.portfolio, { ARA: 200 }).nav, 2);

  assert.equal(apply(books, { type: 'deposit', amount: 99999 }, FIX, { expect: false }).reason, 'insufficient-cash');
  const held = { ...books, members: { ...books.members, fix: { ...books.members.fix, orders: [{ id: 'o', status: 'open', side: 'buy', reserve: 8000 }] } } };
  assert.equal(apply(held, { type: 'deposit', amount: 1000 }, FIX, { expect: false }).reason, 'insufficient-cash', 'cash held for open orders cannot be paid in');
  assert.equal(apply(books, { type: 'deposit', amount: 100 }, SOLO, { expect: false }).reason, 'not-member');
});

test('officers trade up to the limit; anything bigger is proposed', () => {
  const books = funded();
  const small = apply(books, { type: 'trade', request: { type: 'placeOrder', route: 'direct', side: 'buy', assetId: 'ARA', qty: 40, orderType: 'market' } }, MED);
  assert.equal(small.trades.length, 1);
  assert.equal(small.trades[0].type, 'placeOrder');
  assert.equal(small.trades[0].key, `k${n}`, 'the executor result carries the member\'s request key');

  assert.equal(apply(books, { type: 'trade', request: { type: 'placeOrder', side: 'buy', assetId: 'ARA', qty: 60, orderType: 'market' } }, MED, { expect: false }).reason, 'over-limit');
  assert.equal(apply(books, { type: 'trade', request: { type: 'placeOrder', side: 'buy', assetId: 'ARA', qty: 60, orderType: 'limit', limit: 50 } }, MED).ok, true, 'a limit order is valued at its limit');
  assert.equal(apply(books, { type: 'trade', request: { type: 'placeOrder', side: 'buy', assetId: 'ARA', qty: 1 } }, FIX, { expect: false }).reason, 'not-officer');
  assert.equal(apply(books, { type: 'trade', request: { type: 'deposit', amount: 5 } }, MED, { expect: false }).reason, 'bad-request');
});

test('a proposal passes on a majority of units: the Medtech\'s 3,000 of 4,500 carry a big trade at once', () => {
  const out = apply(funded(), { type: 'propose', kind: 'trade', order: { side: 'buy', assetId: 'ARA', qty: 60, orderType: 'market' } }, MED);
  assert.equal(out.books.syndicate.proposals.length, 0);
  assert.deepEqual(out.trades.map((t) => [t.type, t.qty, t.key]), [['placeOrder', 60, out.events.find((e) => e.type === 'proposed').proposalId]]);
  assert.ok(out.events.some((e) => e.type === 'proposalPassed'));
});

test('the minority\'s proposal waits for votes, fails on a majority no, and lapses after 7 days', () => {
  const books = funded();
  let out = apply(books, { type: 'propose', kind: 'limit', amount: 20000 }, FIX);
  assert.equal(out.books.syndicate.proposals.length, 1, 'the Fixer\'s 1,500 units are not a majority');
  const id = out.books.syndicate.proposals[0].id;
  const yes = apply(out.books, { type: 'vote', proposalId: id, yes: true }, MED);
  assert.equal(yes.books.syndicate.rules.tradeLimit, 20000);
  const no = apply(out.books, { type: 'vote', proposalId: id, yes: false }, MED);
  assert.equal(no.books.syndicate.rules.tradeLimit, 5000);
  assert.ok(no.events.some((e) => e.type === 'proposalFailed'));

  const later = advanceSyndicate({ books: out.books, day: DAY + 8, tick: 9 });
  assert.equal(later.books.syndicate.proposals.length, 0);
  assert.ok(later.events.some((e) => e.type === 'proposalLapsed'));
  out = apply(books, { type: 'propose', kind: 'limit', amount: 1 }, FIX);
  assert.equal(apply(out.books, { type: 'propose', kind: 'limit', amount: 2 }, FIX, { expect: false }).reason, 'already-proposed');
});

test('members vote to admit a character, to make an officer, and to remove a member', () => {
  let books = funded();
  books = apply(books, { type: 'propose', kind: 'admit', actorId: 'solo' }, MED).books;
  assert.equal(memberOf(books.syndicate, 'solo').status, 'invited');
  books = apply(books, { type: 'propose', kind: 'role', actorId: 'fix', role: 'officer' }, MED).books;
  assert.equal(memberOf(books.syndicate, 'fix').role, 'officer');

  books = apply(books, { type: 'propose', kind: 'remove', actorId: 'fix' }, MED).books;
  const fix = memberOf(books.syndicate, 'fix');
  assert.deepEqual([fix.leaving, fix.role, books.syndicate.redemptions.length], [true, 'member', 1], 'a removed member\'s units are redeemed');
  const paid = advanceSyndicate({ books, day: DAY + 2, tick: 3, market: MARKET }).books;
  assert.equal(memberOf(paid.syndicate, 'fix').status, 'left');
  assert.equal(paid.members.fix.cash, 10000, 'the Fixer has their 1,500 eb back');
});

test('a redemption is paid at NAV after the settlement delay, and waits while the cash is held', () => {
  let books = funded();
  books = apply(books, { type: 'redeem', units: 500 }, FIX).books;
  assert.equal(freeUnits(books.syndicate, 'fix'), 1000);
  assert.equal(apply(books, { type: 'redeem', units: 1001 }, FIX, { expect: false }).reason, 'not-enough-units');
  assert.equal(advanceSyndicate({ books, day: DAY + 1, tick: 2, market: MARKET }).books.syndicate.redemptions[0].status, 'waiting', 'not due yet');

  // The account has gained 20%, but nearly all its cash is held for a buy order.
  const grown = hold(books, 'ARA', 9, 100);
  const busy = { ...grown, portfolio: { ...grown.portfolio, orders: [{ id: 'o', status: 'open', side: 'buy', reserve: 3500 }] } };
  const market = { ...MARKET, ARA: { price: 200 } };
  assert.equal(advanceSyndicate({ books: busy, day: DAY + 2, tick: 3, market }).books.syndicate.redemptions[0].status, 'waiting', 'too little free cash');

  const paid = advanceSyndicate({ books: grown, day: DAY + 2, tick: 3, market });
  const { nav } = navOf(grown.syndicate, grown.portfolio, { ARA: 200 });
  assert.equal(nav, 1.2, "3,600 eb of cash and 1,800 eb of shares over 4,500 units");
  assert.equal(paid.books.members.fix.cash, 8500 + Math.floor(500 * nav));
  assert.equal(memberOf(paid.books.syndicate, 'fix').units, 1000);
  assert.ok(paid.events.some((e) => e.type === 'redeemed'));
});

test('leaving redeems every unit; the last member must dissolve instead', () => {
  let books = funded();
  books = apply(books, { type: 'leave' }, FIX).books;
  books = advanceSyndicate({ books, day: DAY + 2, tick: 3, market: MARKET }).books;
  assert.equal(memberOf(books.syndicate, 'fix').status, 'left');
  assert.equal(syndicateUnits(books.syndicate), 3000);
  assert.equal(apply(books, { type: 'leave' }, MED, { expect: false }).reason, 'dissolve-instead');
  assert.equal(apply(hold(books, 'ARA', 10, 100), { type: 'redeem', units: 3000 }, MED, { expect: false }).reason, 'dissolve-instead');
});

test('dissolving needs an account of nothing but cash, then pays it out by units and closes', () => {
  const books = funded();
  assert.equal(apply(hold(books, 'ARA', 10, 100), { type: 'propose', kind: 'dissolve' }, MED, { expect: false }).reason, 'not-liquid');
  const grown = { ...books, portfolio: { ...books.portfolio, cash: 6000 } };
  const out = apply(grown, { type: 'propose', kind: 'dissolve' }, MED);
  assert.equal(out.books.syndicate.status, 'closed');
  assert.equal(out.books.members.med.cash, 7000 + 4000);
  assert.equal(out.books.members.fix.cash, 8500 + 2000);
  assert.equal(out.books.portfolio.cash, 0);
  assert.deepEqual(out.changed.sort(), ['fix', 'med']);
  assert.equal(apply(out.books, { type: 'deposit', amount: 1 }, MED, { expect: false }).reason, 'closed');
});

test('the GM can pass or veto a proposal, and close a syndicate holding only cash', () => {
  const books = apply(funded(), { type: 'propose', kind: 'limit', amount: 9000 }, FIX).books;
  const id = books.syndicate.proposals[0].id;
  const passed = decideProposal({ books, proposalId: id, how: 'pass', day: DAY, tick: 1 });
  assert.equal(passed.books.syndicate.rules.tradeLimit, 9000);
  const vetoed = decideProposal({ books, proposalId: id, how: 'veto', day: DAY, tick: 1 });
  assert.deepEqual([vetoed.books.syndicate.rules.tradeLimit, vetoed.books.syndicate.proposals.length], [5000, 0]);
  const closed = closeSyndicate({ books, day: DAY, tick: 1 });
  assert.equal(closed.books.syndicate.status, 'closed');
  assert.equal(closeSyndicate({ books: hold(books, 'ARA', 1, 100), day: DAY, tick: 1 }).reason, 'not-liquid');
});

test('an officer puts a business payment over the limit to the members; once it passes, it is handed to the business side', () => {
  const books = funded();
  const out = apply(books, { type: 'propose', kind: 'business', business: { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 8000, gear: [{ uuid: 'x' }] }, amount: 8000, label: 'Back Room' }, MED);
  assert.equal(out.business.length, 1, 'the Medtech holds the majority, so it passes at once');
  assert.deepEqual([out.business[0].request.type, out.business[0].request.cash, out.business[0].request.gear], ['found', 8000, []], 'cash only');
  assert.equal(out.business[0].label, 'Back Room');
  assert.equal(apply(books, { type: 'propose', kind: 'business', business: { type: 'draw' }, amount: 1 }, MED, { expect: false }).reason, 'bad-request', 'only payments into a business');
  assert.equal(apply(books, { type: 'propose', kind: 'business', business: { type: 'found' }, amount: 1 }, FIX, { expect: false }).reason, 'not-officer');
});

test('business stakes count in the value per unit, and a syndicate holding any cannot be dissolved', () => {
  const books = funded();
  assert.equal(navOf(books.syndicate, books.portfolio, {}, 4500).nav, 2, '4,500 eb of cash and 4,500 eb of stakes over 4,500 units');
  assert.equal(apply(books, { type: 'propose', kind: 'dissolve' }, MED, { expect: false, context: { stakes: 100 } }).reason, 'not-liquid');
  const deposit = apply(books, { type: 'deposit', amount: 1000 }, FIX, { context: { stakes: 4500 } });
  assert.equal(memberOf(deposit.books.syndicate, 'fix').units, 1500 + 500, 'paying in buys at the value with the stakes in it');
});
