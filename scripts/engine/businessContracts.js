/**
 * Player businesses: market contracts (C1, DESIGN §36.19)
 * @file scripts/engine/businessContracts.js
 * @description A market corporation orders goods from a player's workshop. An offer is drawn at a month's close and
 *              waits for the GM, or the GM writes one; once offered, the partners vote on it as on spending. Signed,
 *              the advance goes into the cash, the benches' runs of the item fill it before stock, and stock can be put
 *              towards it. Delivered at a close once the count is made: the rest of the price, standing with the buyer
 *              and, if it is listed, a small lift in its price. Late or short at the deadline: what was made is paid at
 *              the shop's price, the advance counted against it, and standing and Reputation fall. Pure.
 *
 * A contract: `{ id, status, corp: {id, name, ticker, factionId, listed}, item: {uuid, name, type, img, price}, count,
 *              made, cost, unit, total, advance, drawnDay, offeredDay, expires, signedDay, due, byHand }`.
 * `status`: 'held' (waiting for the GM), 'offered' (the partners' vote), 'open', and once finished 'done', 'late',
 *           'declined' or 'lapsed'. `cost` is what the items made for it cost in materials: they stay in the assets until
 *           it is delivered.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, fail, text } from './businessRecord.js';
import { createRng } from './rng.js';
import { standingBand } from './factions.js';
import { benchesOf, hasWorkshop, tierOf, topTierOf, salePrice } from './businessProduction.js';

const LIVE = Object.freeze(['held', 'offered', 'open']);
const int = (v) => Math.floor(Number(v) || 0);

export const liveContracts = (b) => (b.contracts ?? []).filter((c) => LIVE.includes(c.status));
export const openContracts = (b) => (b.contracts ?? []).filter((c) => c.status === 'open');
export const contractOf = (b, id) => (b.contracts ?? []).find((c) => c.id === id) ?? null;

/** How many contracts a business may have at once: drawn, offered or open. */
export const contractLimit = (b, p = BUSINESS_DEFAULTS) => p.contracts.most[b.stage] ?? 1;

/** Whether a business can take a contract at all: open, with a workshop, and a player's. */
export const takesContracts = (b, p = BUSINESS_DEFAULTS) => b.status === 'open' && hasWorkshop(b, p) && !b.npcRun;

/** The sectors whose corporations buy what this kind of business makes. */
export const contractSectors = (b, p = BUSINESS_DEFAULTS) => p.contracts.sectors[b.archetype] ?? [];

/** A month's chance of an offer from a corporation the business stands this well with. */
export const contractChance = (value, p = BUSINESS_DEFAULTS) => p.contracts.chance[standingBand(value, p)] ?? 0;

/** What the item list offers a corporation: legal, priced, and no dearer than the workshop can make at its stage. */
export function contractItems(b, items, p = BUSINESS_DEFAULTS) {
  const top = topTierOf(b, p);
  return (items ?? []).filter((r) => !r.illegal && tierOf(r.price, p) && r.price <= top.price);
}

/**
 * An order's terms for an item: so many weeks of the benches' output, at most a run's worth a week, at the full
 * market price each, with the advance.
 */
export function contractTerms(b, item, weeks, p = BUSINESS_DEFAULTS) {
  const tier = tierOf(item?.price, p);
  if (!tier) return fail('bad-line');
  const week = Math.min(p.production.runMax, (benchesOf(b, p) * p.production.benchDays) / tier.days);
  const count = Math.max(1, Math.floor(weeks * week));
  return termsFor(count, item.price, p);
}

const termsFor = (count, unit, p) => {
  const total = Math.round(count * unit);
  return { ok: true, count, unit: Math.round(unit), total, advance: Math.round(total * p.contracts.advance) };
};

const itemOf = (r) => ({ uuid: String(r.uuid), name: text(r.name, 60), type: String(r.type ?? ''), img: String(r.img ?? ''), price: Math.round(Number(r.price) || 0) });
const corpOf = (c) => ({ id: String(c.id ?? c.ticker ?? ''), name: text(c.name, 60), ticker: String(c.ticker ?? '').toUpperCase(), factionId: c.factionId ?? null, listed: !!c.listed });

/** Keep the live contracts and the last few finished. */
function tidy(b, p) {
  const done = (b.contracts ?? []).filter((c) => !LIVE.includes(c.status));
  b.contracts = [...liveContracts(b), ...done.slice(-p.contracts.keep)];
}

/**
 * A month's close: perhaps an offer from a corporation in a sector that buys what the workshop makes. It waits for the
 * GM as 'held'. `relations` is the GM's side: `{frequency, corps: [{id, name, ticker, sector, factionId, value, listed}], items}`.
 * @returns {object|null} the contract drawn
 */
export function drawContract(b, relations, seed, day, p = BUSINESS_DEFAULTS) {
  if (!relations?.frequency || !takesContracts(b, p) || liveContracts(b).length >= contractLimit(b, p)) return null;
  const items = contractItems(b, relations.items, p);
  const sectors = contractSectors(b, p);
  const taken = new Set(liveContracts(b).map((c) => c.corp.id));
  const corps = (relations.corps ?? []).filter((c) => sectors.includes(c.sector) && !taken.has(c.id) && contractChance(c.value, p) > 0);
  if (!items.length || !corps.length) return null;
  const rng = createRng(seed, 'business-contract', b.id, b.period?.index ?? 0);
  // Each corporation in turn, in a random order, has its chance; the first to come up makes the offer.
  const order = corps.map((c) => ({ c, k: rng.next() })).sort((x, y) => x.k - y.k).map((x) => x.c);
  const corp = order.find((c) => rng.chance(contractChance(c.value, p) * relations.frequency));
  if (!corp) return null;
  const item = items[rng.int(0, items.length - 1)];
  const weeks = rng.int(p.contracts.weeks[0], p.contracts.weeks[1]);
  const terms = contractTerms(b, item, weeks, p);
  if (!terms.ok) return null;
  const contract = {
    id: `ct_${b.id.slice(-6)}_${day}_${(b.contracts ?? []).length}`, status: 'held', corp: corpOf(corp), item: itemOf(item),
    count: terms.count, made: 0, cost: 0, unit: terms.unit, total: terms.total, advance: terms.advance, drawnDay: day, weeks: Math.round(p.contracts.dueDays / 7),
  };
  b.contracts = [...(b.contracts ?? []), contract];
  return contract;
}

/** Put an offer to the partners: a vote by the rule for spending, lapsing after its days. */
function propose(b, c, day, p) {
  c.status = 'offered';
  c.offeredDay = day;
  c.expires = day + p.contracts.offerDays;
  b.proposals = [...b.proposals, { id: c.id, kind: 'contract', by: null, day, expires: c.expires, votes: {}, terms: { contractId: c.id } }];
}

/** The GM's changes to a drawn offer's terms: the count, the price each, and the weeks to deliver. */
function applyEdits(c, edits = {}, p) {
  const count = int(edits.count);
  const unit = Number(edits.unit);
  const weeks = int(edits.weeks);
  if (edits.count != null && edits.count !== '' && count < 1) return fail('bad-amount');
  if (edits.unit != null && edits.unit !== '' && !(unit > 0)) return fail('bad-amount');
  const terms = termsFor(count >= 1 ? count : c.count, unit > 0 ? unit : c.unit, p);
  Object.assign(c, { count: terms.count, unit: terms.unit, total: terms.total, advance: terms.advance });
  if (weeks >= 1) c.weeks = Math.min(12, weeks);
  return { ok: true };
}

/** The GM offers a drawn contract, with any changes to its terms. */
export function offerContract(b, id, edits, day, p = BUSINESS_DEFAULTS) {
  const c = contractOf(b, id);
  if (c?.status !== 'held') return fail('no-contract');
  if (!takesContracts(b, p)) return fail('no-workshop');
  const done = applyEdits(c, edits, p);
  if (!done.ok) return done;
  propose(b, c, day, p);
  return { ok: true, contract: c };
}

/** The GM drops a drawn contract: nobody hears of it. */
export function dropContract(b, id) {
  const c = contractOf(b, id);
  if (c?.status !== 'held') return fail('no-contract');
  b.contracts = b.contracts.filter((x) => x !== c);
  return { ok: true };
}

/**
 * The GM writes a contract by hand: a corporation, an item off the business's list, the count, the price each and the
 * weeks to deliver. It goes straight to the partners.
 */
export function writeContract(b, { corp, item, count, unit, weeks }, day, p = BUSINESS_DEFAULTS) {
  if (!takesContracts(b, p)) return fail('no-workshop');
  if (liveContracts(b).length >= contractLimit(b, p)) return fail('contract-limit');
  if (!corp?.name) return fail('no-corp');
  if (!item?.uuid || !tierOf(item.price, p)) return fail('bad-line');
  if (item.illegal) return fail('illegal-line');
  const n = int(count);
  if (n < 1) return fail('bad-amount');
  const terms = termsFor(n, Number(unit) > 0 ? Number(unit) : item.price, p);
  const c = {
    id: `ct_${b.id.slice(-6)}_${day}_${(b.contracts ?? []).length}`, status: 'held', corp: corpOf(corp), item: itemOf(item),
    count: terms.count, made: 0, cost: 0, unit: terms.unit, total: terms.total, advance: terms.advance, drawnDay: day,
    weeks: Math.max(1, Math.min(12, int(weeks) || Math.round(p.contracts.dueDays / 7))), byHand: true,
  };
  b.contracts = [...(b.contracts ?? []), c];
  propose(b, c, day, p);
  return { ok: true, contract: c };
}

/** The partners agreed: the contract is signed, and the advance goes into the cash. */
export function signContract(b, id, day, p = BUSINESS_DEFAULTS) {
  const c = contractOf(b, id);
  if (c?.status !== 'offered') return fail('no-contract');
  c.status = 'open';
  c.signedDay = day;
  c.due = day + (c.weeks ?? 4) * 7;
  b.till += c.advance;
  addLedger(b, { day, kind: 'contractAdvance', amount: c.advance, name: c.corp.name, itemName: c.item.name, count: c.count }, p);
  return { ok: true, contract: c };
}

/** The offer was turned down, or ran out before the vote. */
export function endOffer(b, id, status) {
  const c = contractOf(b, id);
  if (c?.status !== 'offered') return null;
  c.status = status;
  return c;
}

/**
 * Items off the benches: they fill any open contract for the same item, oldest first, at what they cost.
 * @returns {number} how many are left over, for the shelves
 */
export function fillContracts(b, run) {
  let left = run.count;
  if (run.illegal) return left;
  for (const c of openContracts(b).filter((x) => x.item.uuid === run.uuid)) {
    const take = Math.min(left, c.count - c.made);
    if (take < 1) continue;
    c.made += take;
    c.cost += take * run.cost;
    left -= take;
    b.pendingNotes = [...(b.pendingNotes ?? []), { kind: 'contractFilled', name: `${take} × ${c.item.name}`, corp: c.corp.name }];
    if (!left) break;
  }
  return left;
}

/** Whether stock can go towards a contract, and how many at most. */
export function stockFor(b, id) {
  const c = contractOf(b, id);
  if (c?.status !== 'open') return fail('no-contract');
  const stack = (b.stock ?? []).find((s) => s.uuid === c.item.uuid && !s.owner && !s.illegal);
  if (!stack) return fail('no-stock');
  const most = Math.min(stack.count, c.count - c.made);
  return most >= 1 ? { ok: true, most, stack, contract: c } : fail('contract-full');
}

/** A partner puts the business's own stock of the item towards a contract. What it cost stays in the assets until delivery. */
export function stockToContract(b, id, count, out) {
  const can = stockFor(b, id);
  if (!can.ok) return can;
  const n = int(count);
  if (n < 1 || n > can.most) return fail('bad-amount');
  const { stack, contract: c } = can;
  stack.count -= n;
  c.made += n;
  c.cost += n * stack.cost;
  b.stock = b.stock.filter((s) => s.count > 0);
  out.events.push({ type: 'stockSold', uuid: stack.uuid, name: stack.name, itemType: stack.type, owner: null, count: n });
  return { ok: true };
}

/**
 * The week's close: every open contract that has its count is delivered, and any whose deadline has come is settled
 * for what was made. The money goes into the cash; the profit is the price less what the items cost.
 * @returns {{margin: number, done: object[], late: object[]}}
 */
export function contractsWeek(b, day, out, p = BUSINESS_DEFAULTS) {
  const week = { margin: 0, done: [], late: [] };
  for (const c of openContracts(b)) {
    const full = c.made >= c.count;
    if (!full && day < c.due) continue;
    const worth = full ? c.total : c.made * salePrice(c.unit, p);
    b.till += worth - c.advance;
    b.assets = Math.max(0, b.assets - c.cost);
    week.margin += worth - c.cost;
    c.status = full ? 'done' : 'late';
    c.settledDay = day;
    c.paid = worth;
    // The profit at the close; what the items cost coming back out of the stock, less the advance already in, is other money.
    addLedger(b, { day, kind: full ? 'contractDelivered' : 'contractLate', amount: worth - c.cost, name: c.corp.name, itemName: c.item.name, count: c.made }, p);
    if (c.cost - c.advance) addLedger(b, { day, kind: 'contractSettle', amount: c.cost - c.advance, name: c.corp.name }, p);
    if (c.corp.factionId) out.events.push({ type: 'factionMove', factionId: c.corp.factionId, amount: full ? p.contracts.standing.done : p.contracts.standing.late });
    if (!full) b.state.reputation = Math.max(0, b.state.reputation + p.contracts.reputation);
    const entry = { id: c.id, corp: c.corp.name, ticker: c.corp.ticker, item: c.item.name, count: c.count, made: c.made, paid: worth, advance: c.advance };
    (full ? week.done : week.late).push(entry);
    out.events.push({ type: full ? 'contractDone' : 'contractLate', contract: { ...entry, listed: c.corp.listed, factionId: c.corp.factionId } });
  }
  tidy(b, p);
  return week;
}
