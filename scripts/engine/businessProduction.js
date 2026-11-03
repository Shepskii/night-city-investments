/**
 * Player businesses: production (P1, DESIGN §36.10)
 * @file scripts/engine/businessProduction.js
 * @description A workshop's benches, the line it makes and its runs, by the rulebook's Fabrication table: a run
 *              takes the book's time per item and one roll at the book's DV, and only what comes out sellable uses
 *              materials. Stock is held on the record as `b.stock`; the GM's service keeps real items to match on
 *              a storeroom sheet. Pure; no Foundry globals.
 *
 * A line:  `{ uuid, name, type, img, price, qty }`, `qty` being the most a run should make.
 * A run:   `{ uuid, name, type, img, price, cost, count, left }`, `left` being the bench days still to do.
 * A stack: `{ uuid, name, type, img, price, cost, count, illegal, owner }` in `b.stock`. `owner` is the character a
 *          consigned stack still belongs to: it costs the business nothing, and is no part of its book value. What
 *          the business's own stock cost stands in `b.assets`, so book value and valuation count it.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, fail, stateBands, text } from './businessRecord.js';
import { approachOf } from './rolls.js';

/** Item types with an `amount`, which stack as one item on a sheet; anything else is one item each. */
export const STACKING_TYPES = Object.freeze(['ammo', 'clothing', 'drug', 'gear']);

/** The Fabrication table's row for a market price: the lowest price category it fits under, or null above them all. */
export const tierOf = (price, p = BUSINESS_DEFAULTS) => (Number(price) > 0 ? p.production.tiers.find((t) => price <= t.price) ?? null : null);

/** The dearest price category this business can make at its stage. */
export const topTierOf = (b, p = BUSINESS_DEFAULTS) => p.production.tiers.find((t) => t.id === p.production.top[b.stage]) ?? p.production.tiers[0];

/** Whether this kind of business makes anything by default. A GM's own additions to the list are the catalog's. */
export const makesThings = (b, p = BUSINESS_DEFAULTS) => (p.production.makes[b.archetype] ?? []).length > 0;

/** Whether an item is on a business type's default list: its type, and any narrower kind of upgrade or named gear. */
export function madeByDefault(archetype, item, p = BUSINESS_DEFAULTS) {
  return (p.production.makes[archetype] ?? []).some((rule) => rule.type === item.type
    && (!rule.kind || rule.kind === item.kind)
    && (!rule.names || rule.names.includes(item.name)));
}

/** How many benches the business has: the workshop built at its highest stage so far sets them. */
export function benchesOf(b, p = BUSINESS_DEFAULTS) {
  const built = b.upgrades?.workshop ?? [];
  return built.length ? p.production.benches[Math.max(...built)] ?? p.production.benches.at(-1) : 0;
}

export const hasWorkshop = (b, p = BUSINESS_DEFAULTS) => benchesOf(b, p) > 0;

/** Items on the shelves that are one item each, for the storeroom's limit. */
export const looseStock = (b) => (b.stock ?? []).filter((s) => !s.owner && !STACKING_TYPES.includes(s.type)).reduce((a, s) => a + s.count, 0);

/** What the shop sells an item for. */
export const salePrice = (price, p = BUSINESS_DEFAULTS) => Math.round(price * p.production.sale.price);

/** A week's sales limit, in eb, from that week's takings. */
export function salesLimit(b, takings, p = BUSINESS_DEFAULTS) {
  const s = p.production.sale;
  return Math.round(takings * s.limitShare * (s.reputation[stateBands(b, p).reputation] ?? 1));
}

/** What the business's own stock stands at in its assets, with any run on the benches. */
export function stockCost(b) {
  const run = b.production?.run;
  return (b.stock ?? []).filter((s) => !s.owner).reduce((a, s) => a + s.cost * s.count, 0) + (run ? run.cost * run.count : 0);
}

/** One stack: the business's own, or a consignment. */
const stackOf = (b, uuid) => (b.stock ?? []).find((s) => s.uuid === uuid) ?? null;

/** Take items off a stack, and what they cost out of the assets. */
function takeOff(b, stack, count) {
  stack.count -= count;
  if (!stack.owner) b.assets = Math.max(0, b.assets - stack.cost * count);
  b.stock = b.stock.filter((s) => s.count > 0);
}

/**
 * What a run of a line would be: the book's DV, time and materials, and how many it can make: what
 * the benches do in a week (one item, if it takes longer), the most a run makes, what the partners
 * asked for, and the room left on the shelves.
 * @returns {{ok: true, tier: object, dv: number, days: number, materials: number, size: number} | {ok: false, reason: string}}
 */
export function runOffer(b, line, p = BUSINESS_DEFAULTS, part = 1) {
  const tier = tierOf(line?.price, p);
  if (!tier) return fail('bad-line');
  if (tier.price > topTierOf(b, p).price) return fail('line-too-dear');
  const week = benchesOf(b, p) * p.production.benchDays * part;
  const room = STACKING_TYPES.includes(line.type) ? Infinity : (p.production.storeCap[b.stage] ?? 0) - looseStock(b);
  const size = Math.min(Math.max(1, Math.floor(week / tier.days)), p.production.runMax, Math.max(1, line.qty ?? p.production.runMax), room);
  return size >= 1 ? { ok: true, tier, dv: tier.dv, days: tier.days, materials: tier.materials, size } : fail('store-full');
}

/** Whether a run can start this week, and at what DV, before any dice. */
export function produceCheck(b, p = BUSINESS_DEFAULTS) {
  if (!hasWorkshop(b, p)) return fail('no-workshop');
  const line = b.production?.line;
  if (!line) return fail('no-line');
  if (b.production.run) return fail('run-going');
  // Illegal items wait for the back room's own runs (P1c).
  if (line.illegal) return fail('illegal-line');
  const offer = runOffer(b, line, p);
  if (!offer.ok) return offer;
  // Enough for one item: a run makes what the cash can pay for.
  return b.till >= offer.materials ? offer : fail('no-funds');
}

/** Choose what the benches make, or (no item) stop. The GM's service found the item on the business's list. */
export function setLine(b, item, qty, p = BUSINESS_DEFAULTS) {
  if (!hasWorkshop(b, p)) return fail('no-workshop');
  if (!item) {
    b.production = { ...b.production, line: null };
    return { ok: true };
  }
  if (item.illegal) return fail('illegal-line');
  const tier = tierOf(item.price, p);
  if (!tier) return fail('bad-line');
  if (tier.price > topTierOf(b, p).price) return fail('line-too-dear');
  const wanted = Math.max(1, Math.min(p.production.runMax, Math.floor(Number(qty) || p.production.runMax)));
  b.production = { ...b.production, line: { uuid: item.uuid, name: item.name, type: item.type, img: item.img ?? '', price: item.price, illegal: !!item.illegal, qty: wanted } };
  return { ok: true };
}

/** Put finished items on the shelves, as one stack for each kind of item. */
export function addStock(b, run) {
  const stack = (b.stock ?? []).find((s) => s.uuid === run.uuid);
  const { uuid, name, type, img, price, cost, count, illegal } = run;
  if (stack) {
    // What the stack cost, on average, so that selling part of it takes out its share.
    stack.cost = Math.round(((stack.cost * stack.count) + (cost * count)) / (stack.count + count));
    stack.count += count;
  } else {
    b.stock = [...(b.stock ?? []), { uuid, name, type, img, price, cost, count, illegal: !!illegal }];
  }
}

/**
 * The week at the benches, at its close: a passed roll starts a run, paying for what comes out
 * sellable, and the benches work on any run going. A failure costs the week, not the materials.
 * What comes off the benches is announced as a `stockMade` event, for the storeroom sheet.
 */
export function productionWeek(b, day, out, p = BUSINESS_DEFAULTS) {
  if (!hasWorkshop(b, p)) return;
  // A short week gives the benches less time, as it gives the shop less takings.
  const part = Math.min(1, (b.period.endDay - b.period.startDay) / 7);
  const note = (kind, name) => { b.pendingNotes = [...(b.pendingNotes ?? []), { kind, name }]; };
  const slot = b.period.slots.find((s) => s.action === 'produce');
  const line = b.production?.line;
  if (slot && line && !b.production.run) {
    const offer = runOffer(b, line, p, part);
    // Careful or Bold moved the DV, so they move the yield too, as they do any action's effect.
    const share = Math.min(1, (p.production.yield[slot.band] ?? 0) * approachOf(slot.approach).effect);
    if (!offer.ok || share <= 0) {
      note('runFailed', line.name);
    } else {
      // At least one comes of a passed roll; the cash may stop it short of the rest.
      const sellable = Math.max(1, Math.floor(offer.size * share));
      const count = Math.min(sellable, Math.floor(Math.max(0, b.till) / offer.materials));
      if (count < 1) {
        note('runNoCash', line.name);
      } else {
        const paid = count * offer.materials;
        b.till -= paid;
        // Materials become stock: they leave the cash, not the books.
        b.assets += paid;
        addLedger(b, { day, kind: 'materials', amount: -paid, itemName: line.name, count }, p);
        const { uuid, name, type, img, price, illegal } = line;
        b.production.run = { uuid, name, type, img, price, illegal: !!illegal, cost: offer.materials, count, left: offer.size * offer.days };
      }
    }
  }
  const run = b.production?.run;
  if (!run) return;
  run.left -= benchesOf(b, p) * p.production.benchDays * part;
  if (run.left > 1e-6) return;
  addStock(b, run);
  b.production.run = null;
  note('madeStock', `${run.count} × ${run.name}`);
  out.events.push({ type: 'stockMade', item: { uuid: run.uuid, type: run.type }, count: run.count });
}

/**
 * The week's shop sales, at its close: up to the limit, dearest first. The limit left over carries, so an item dearer
 * than a week's limit is saved up for rather than crowded out, unless it is beyond what can ever be saved. Illegal
 * items are not for the shop. The business's own stock pays into the cash, and the profit is what it made over cost;
 * a consigned item pays its owner, less the shop's cut, which is all profit.
 * @returns {{sold: number, kept: number, margin: number, owners: number}}
 */
export function salesWeek(b, takings, day, out, p = BUSINESS_DEFAULTS) {
  const none = { sold: 0, kept: 0, margin: 0, owners: 0 };
  if (!(b.stock ?? []).length) {
    if (b.production) b.production.allowance = 0;
    return none;
  }
  const limit = salesLimit(b, takings, p);
  const most = limit * p.production.sale.bank;
  let room = Math.min((b.production.allowance ?? 0) + limit, most);
  const totals = { ...none };
  const shelves = b.stock.filter((s) => !s.illegal && s.count > 0).sort((x, y) => y.price - x.price);
  for (const stack of shelves) {
    const price = salePrice(stack.price, p);
    if (price > most) continue;
    const count = Math.min(stack.count, Math.floor(room / price));
    // Hold the limit for this one, not the cheaper things after it.
    if (count < 1) break;
    const gross = count * price;
    room -= gross;
    totals.sold += gross;
    if (stack.owner) {
      const share = Math.round(gross * (1 - p.production.sale.consignCut));
      out.wealth[stack.owner] = (out.wealth[stack.owner] ?? 0) + share;
      totals.owners += share;
      totals.kept += gross - share;
      totals.margin += gross - share;
    } else {
      totals.kept += gross;
      totals.margin += gross - stack.cost * count;
    }
    const { uuid, name, type, owner } = stack;
    takeOff(b, stack, count);
    out.events.push({ type: 'stockSold', uuid, name, itemType: type, owner: owner ?? null, count });
    b.pendingNotes = [...(b.pendingNotes ?? []), { kind: 'soldStock', name: `${count} × ${name}` }];
  }
  b.production.allowance = room;
  if (totals.sold) {
    b.till += totals.kept;
    addLedger(b, { day, kind: 'stockSales', amount: totals.margin, sold: totals.sold }, p);
    if (totals.kept - totals.margin) addLedger(b, { day, kind: 'stockCostBack', amount: totals.kept - totals.margin }, p);
  }
  return totals;
}

/** A partner buys stock: at cost, or at a company, where it would come out of other shareholders' pockets, at the shop's price. */
export function buyStock(b, actor, uuid, count, day, out, p = BUSINESS_DEFAULTS) {
  const stack = stackOf(b, uuid);
  if (!stack || stack.owner) return fail('no-stock');
  const n = Math.floor(Number(count) || 0);
  if (n < 1 || n > stack.count) return fail('bad-amount');
  const each = b.stage >= 2 ? salePrice(stack.price, p) : stack.cost;
  const total = each * n;
  if (total > actor.wealth) return fail('insufficient-funds');
  b.till += total;
  out.wealth[actor.id] = (out.wealth[actor.id] ?? 0) - total;
  const { name, type } = stack;
  takeOff(b, stack, n);
  addLedger(b, { day, kind: 'stockBought', amount: total, actorId: actor.id, name: actor.name, itemName: name, count: n }, p);
  out.events.push({ type: 'stockTaken', uuid, name, itemType: type, owner: null, count: n, actorId: actor.id });
  return { ok: true };
}

/** Whether a stack can be handed to a partner, and the proposal's terms. */
export function handOffer(b, partner, uuid, count) {
  const stack = stackOf(b, uuid);
  if (!stack || stack.owner) return fail('no-stock');
  const n = Math.floor(Number(count) || 0);
  if (n < 1 || n > stack.count) return fail('bad-amount');
  return { ok: true, terms: { uuid, name: stack.name, count: n, actorId: partner.actorId, who: partner.name } };
}

/** The partners agreed: the items go to one of them, at no charge, and what they cost leaves the books. */
export function handStock(b, terms, day, out, p = BUSINESS_DEFAULTS) {
  const stack = stackOf(b, terms.uuid);
  if (!stack || stack.owner || stack.count < terms.count) return fail('no-stock');
  const { name, type } = stack;
  takeOff(b, stack, terms.count);
  addLedger(b, { day, kind: 'stockHanded', amount: 0, name: terms.who, itemName: name, count: terms.count }, p);
  out.events.push({ type: 'stockTaken', uuid: terms.uuid, name, itemType: type, owner: null, count: terms.count, actorId: terms.actorId });
  return { ok: true };
}

/** A character puts items from their own sheet in the shop, still theirs until they sell. Priced as their sheet has them. */
export function consignStock(b, actor, gear, day, out, p = BUSINESS_DEFAULTS) {
  const mine = gear.filter((g) => g.item);
  if (!mine.length) return fail('not-your-item');
  for (const g of mine) {
    const amount = Math.max(1, Math.floor(Number(g.item.system?.amount) || 1));
    // Ammunition is priced by the box, as `itemGear` reads it.
    const count = g.item.type === 'ammo' ? Math.ceil(amount / 10) : amount;
    b.stock = [...(b.stock ?? []), {
      uuid: g.uuid, name: text(g.item.name, 60), type: g.item.type, img: g.img ?? '', price: Math.round(g.value / count), cost: 0, count, illegal: false, owner: actor.id,
    }];
    addLedger(b, { day, kind: 'stockConsigned', amount: 0, actorId: actor.id, name: actor.name, itemName: g.item.name }, p);
    const { _sourceId, ...item } = g.item;
    out.events.push({ type: 'stockConsigned', uuid: g.uuid, owner: actor.id, item });
  }
  return { ok: true };
}

/** A consignment's owner takes what is left of it back. */
export function takeBackStock(b, actor, uuid, day, out, p = BUSINESS_DEFAULTS) {
  const stack = stackOf(b, uuid);
  if (stack?.owner !== actor.id) return fail('not-your-item');
  const { name, type, count } = stack;
  takeOff(b, stack, count);
  addLedger(b, { day, kind: 'stockReturned', amount: 0, actorId: actor.id, name: actor.name, itemName: name }, p);
  out.events.push({ type: 'stockTaken', uuid, name, itemType: type, owner: actor.id, count, actorId: actor.id });
  return { ok: true };
}

/**
 * A business closes: what its stock cost goes into the pot in full, rather than at salvage, and consigned items go home.
 * @returns {number} the eb its own stock adds to the salvage
 */
export function clearStock(b, out) {
  const value = stockCost(b);
  const returned = (b.stock ?? []).filter((s) => s.owner).map((s) => ({ uuid: s.uuid, name: s.name, itemType: s.type, owner: s.owner, count: s.count }));
  if (b.stock?.length || b.production?.run || b.upgrades?.workshop?.length) out.events.push({ type: 'stockClosed', returned });
  b.stock = [];
  b.stockQueries = [];
  b.production = { line: null, run: null, allowance: 0 };
  return value;
}

/** How many of a stack the record has that the sheet has not: the GM moved them by hand. The GM says what happened. */
export function raiseStockQuery(b, stack, missing, day) {
  stack.count -= missing;
  b.stockQueries = [...(b.stockQueries ?? []), {
    id: `sq_${day}_${b.stockQueries?.length ?? 0}_${stack.uuid.slice(-8)}`, name: stack.name, cost: stack.cost, price: stack.price, owner: stack.owner ?? null, count: missing,
  }];
  b.stock = b.stock.filter((s) => s.count > 0);
}

/** What the GM says became of items moved by hand: sold at the shop's price, given to someone, or lost. */
export function settleStockQuery(b, id, what, day, out, p = BUSINESS_DEFAULTS) {
  const q = (b.stockQueries ?? []).find((x) => x.id === id);
  if (!q) return fail('no-query');
  if (!['sold', 'given', 'lost'].includes(what)) return fail('bad-query');
  const worth = what === 'sold' ? salePrice(q.price, p) * q.count : 0;
  const share = q.owner ? Math.round(worth * (1 - p.production.sale.consignCut)) : 0;
  if (q.owner && share) out.wealth[q.owner] = (out.wealth[q.owner] ?? 0) + share;
  if (!q.owner) b.assets = Math.max(0, b.assets - q.cost * q.count);
  b.till += worth - share;
  addLedger(b, { day, kind: `stock${what[0].toUpperCase()}${what.slice(1)}`, amount: worth - share, itemName: q.name, count: q.count }, p);
  b.stockQueries = b.stockQueries.filter((x) => x.id !== id);
  return { ok: true };
}
