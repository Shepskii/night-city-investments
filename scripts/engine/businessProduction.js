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
 * A stack: `{ uuid, name, type, img, price, cost, count, illegal }` in `b.stock`.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, fail } from './businessRecord.js';
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
export const looseStock = (b) => (b.stock ?? []).filter((s) => !STACKING_TYPES.includes(s.type)).reduce((a, s) => a + s.count, 0);

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
