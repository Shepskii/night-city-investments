/**
 * Player businesses
 * @file scripts/engine/business.js
 * @description The side-business loop of DESIGN §26.0, as built in B1: founding a business with
 *              partners, the setup roll, the weekly operating period and its five actions,
 *              complementary checks, the till, capped owner draws, the buy-out rule, and closing.
 *              Pure; no Foundry globals. The GM's service reads the dice from the player's chat card
 *              before anything here sees them (`check`), so nothing here trusts a request's numbers.
 *
 * Requests (from a character's business outbox):
 *   { key, type: 'found', name, archetype, location?, cash, gear?, invite?, sweat?, heirId? }
 *   { key, type: 'join', businessId, cash, gear?, heirId? }      an invited character accepts
 *   { key, type: 'decline', businessId }
 *   { key, type: 'contribute', businessId, cash, gear? }         while forming
 *   { key, type: 'withdraw', businessId }                        while forming: take your money back
 *   { key, type: 'setupRoll', businessId, use, rollId }
 *   { key, type: 'action', businessId, action, use, rollId }     take this week's slot
 *   { key, type: 'assist', businessId, forAction, use, rollId }  a complementary check (no slot)
 *   { key, type: 'draw', businessId, amount }
 *   { key, type: 'setHeir', businessId, heirId }
 *   { key, type: 'leave', businessId }                           offer your stake to the others
 *   { key, type: 'buyout', businessId, sellerId }
 *   { key, type: 'proposeClose', businessId }
 *   { key, type: 'vote', businessId, proposalId, yes }
 *
 * `use` is how the roll was made: `{kind: 'skill', skill, stat}`, `{kind: 'ability', ability}` or
 * `{kind: 'hire', hire}` (see businessConfig.js). Days are whole market days (`marketDay`).
 */

import { approachOf, dvOf, HIRE_TIERS } from './rolls.js';
import {
  ARCHETYPES, ACTIONS, BUSINESS_DEFAULTS, stageDv, actionUses, helpUses, setupUses, usesInclude, useKey,
} from './businessConfig.js';
import {
  BUSINESS_SCHEMA, BUSINESS_STATUS, weekdayOf, nextBoundary, newPeriod, int, clamp, text, normalizeBusiness, archetypeOf, holders, voters,
  partnerOf, gearValue, totalUnits, bookValue, unitValue, shareOf, lastDigest, drawAllowance, fundingShortfall, hireFee, stateBands,
  fail, close, addLedger,
} from './businessRecord.js';
import {
  daysLeft, spendDays, activeProject, expansionOffer, startExpansion, addProjectDays, milestones, stepUpCheck, applyStepUp, votingUnits,
} from './businessGrowth.js';

export { daysLeft, activeProject, expansionOffer, milestones, stepUpCheck };

export {
  BUSINESS_SCHEMA, BUSINESS_STATUS, weekdayOf, nextBoundary, normalizeBusiness, archetypeOf, holders, voters,
  partnerOf, gearValue, totalUnits, bookValue, unitValue, shareOf, lastDigest, drawAllowance, fundingShortfall, hireFee, stateBands,
};

export const BUSINESS_REQUESTS = Object.freeze([
  'found', 'join', 'decline', 'contribute', 'withdraw', 'setupRoll', 'action', 'assist', 'draw', 'setHeir', 'leave', 'buyout',
  'propose', 'proposeClose', 'vote', 'stepUpRoll', 'addDays',
]);

/** Requests that carry a roll. */
export const ROLL_REQUESTS = Object.freeze(['setupRoll', 'action', 'assist', 'stepUpRoll']);

/**
 * What each kind of proposal needs to pass (DESIGN §26.0): closing and stepping up need every partner
 * with a vote; starting an expansion is a day-to-day choice, a majority of the voting units.
 */
export const PROPOSAL_RULES = Object.freeze({ close: 'unanimous', stepUp: 'unanimous', expansion: 'majority' });

// ── What a roll needs ────────────────────────────────────────────────────────

/**
 * Everything the GM's service must know before it reads a roll card: whether the request could go
 * ahead at all (so a request that would be refused does not use up the card), the DV, the ways it
 * may be rolled, whether a hire is allowed, and whether a complementary bonus is waiting. With no
 * `use` in the request it only says whether the roll can be made and how (the roll dialog asks
 * this); with one it also checks the use, and gives it back with the business's own stat and DV
 * (some uses roll at a higher DV). `extraAvailable` says whether the roller has a business day to
 * spend on extra time.
 * @returns {{ok: true, dv: number, uses: object[], use?: object, allowHire: boolean, bonusAvailable: boolean, extraAvailable: boolean} | {ok: false, reason: string}}
 */
export function rollSpec(b, request, actorId, { day, operatorRank = 0, params: p = BUSINESS_DEFAULTS } = {}) {
  const arch = archetypeOf(b);
  const me = partnerOf(b, actorId);
  const use = request.use ?? null;
  if (use && (!['skill', 'ability', 'hire'].includes(use.kind) || (use.kind === 'hire' && !HIRE_TIERS[use.hire]))) return fail('bad-use');

  if (request.type === 'setupRoll') {
    if (b.status !== 'forming') return fail('not-forming');
    if (me?.status !== 'active') return fail('not-partner');
    if (b.partners.some((x) => x.status === 'invited')) return fail('invites-pending');
    if (b.setup?.passed) return fail('setup-done');
    if (b.setup?.retryDay != null && day < b.setup.retryDay) return fail('setup-delay');
    if (!holders(b).some((x) => x.cash + gearValue(x) > 0)) return fail('no-contribution');
    return allowed(setupUses(arch), use, { dv: dvOf(p.setupDv), allowHire: true, bonusAvailable: false, funds: b.escrow, operatorRank, p });
  }

  if (b.status !== 'open') return fail('not-open');
  if (me?.status !== 'active' || !me.voting) return fail('not-partner');
  const extraAvailable = daysLeft(b, actorId, p) > 0;

  if (request.type === 'stepUpRoll') {
    const check = stepUpCheck(b, actorId, day, p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till - p.registration.fee, operatorRank, p });
  }

  if (request.type === 'action') {
    if (!ACTIONS[request.action]) return fail('bad-action');
    const slots = p.stages[b.stage]?.slots ?? 1;
    if (b.period.slots.length >= slots) return fail('no-slot');
    if (b.period.slots.some((s) => s.action === request.action)) return fail('action-taken');
    const bonusAvailable = b.period.bonuses.some((x) => x.action === request.action && !x.used);
    return allowed(actionUses(request.action, arch), use, { dv: stageDv(b.stage, p), allowHire: true, bonusAvailable, extraAvailable, funds: b.till, operatorRank, p });
  }

  if (request.type === 'assist') {
    if (!ACTIONS[request.forAction]) return fail('bad-action');
    if (b.period.helpers.includes(actorId)) return fail('helped');
    if (b.period.slots.some((s) => s.action === request.forAction)) return fail('action-taken');
    return allowed(helpUses(request.forAction, arch), use, { dv: dvOf(p.helpDv), allowHire: false, bonusAvailable: false, extraAvailable });
  }
  return fail('bad-request');
}

function allowed(uses, use, { funds = 0, operatorRank = 0, p = BUSINESS_DEFAULTS, ...spec }) {
  if (use?.kind === 'hire') {
    if (!spec.allowHire) return fail('hire-not-allowed');
    if (funds < hireFee(use.hire, operatorRank, p)) return fail('no-funds');
    return { ok: true, uses, use, extraAvailable: false, ...spec };
  }
  if (use && !usesInclude(uses, use)) return fail('bad-use');
  // The skill's stat (and any DV step) is the business's own, not what the request says.
  const own = use ? uses.find((u) => useKey(u) === useKey(use)) : null;
  return { ok: true, uses, extraAvailable: false, ...spec, ...(own ? { use: own, dv: spec.dv + (own.dvAdd ?? 0) } : {}) };
}

// ── Applying a request ───────────────────────────────────────────────────────

/**
 * Apply one request.
 * @param {object} o
 * @param {object|null} o.business - the business it is for (null for 'found')
 * @param {object} o.request
 * @param {{id: string, name: string, wealth: number}} o.actor - who sent it
 * @param {number} o.day - today, as a market day
 * @param {object} [o.check] - the verified roll (`SkillAdapter.verifyLevers`), for a roll request
 * @param {object} [o.context]
 *   approval      a new business waits for the GM before it opens
 *   weekday       the day operating periods end on (0 = Sunday)
 *   operatorRank  the best Operator rank among the partners, for hire fees
 *   actors        { [id]: name } characters a request may name (invites, heirs)
 *   wealthOf      (actorId) => wealth, for a buy-out's buyer
 *   newId         the id to give a new business
 * @param {object} [o.params]
 * @returns {{ok: true, business: object, wealth: object, events: object[]} | {ok: false, reason: string}}
 *          `wealth` maps actorId -> the change to that character's eddies
 */
export function applyBusinessRequest({ business, request, actor, day, check = null, context = {}, params: p = BUSINESS_DEFAULTS }) {
  const ctx = { approval: true, weekday: 1, operatorRank: 0, actors: {}, wealthOf: () => 0, ...context };
  const out = { wealth: {}, events: [] };
  const pay = (actorId, amount) => {
    out.wealth[actorId] = (out.wealth[actorId] ?? 0) + amount;
  };

  if (request.type === 'found') {
    const made = found(request, actor, day, ctx, p);
    if (!made.ok) return made;
    pay(actor.id, -made.business.escrow);
    return { ok: true, business: made.business, ...out };
  }

  if (!business) return fail('no-business');
  if (ROLL_REQUESTS.includes(request.type) && !request.use) return fail('bad-use');
  const b = structuredClone(normalizeBusiness(business));
  const me = partnerOf(b, actor.id);
  const log = (kind, amount, note = {}) => addLedger(b, { day, kind, amount, actorId: actor.id, ...note }, p);

  switch (request.type) {
    case 'join': {
      if (b.status !== 'forming') return fail('not-forming');
      if (me?.status !== 'invited') return fail('not-invited');
      const money = contribution(request, actor, p);
      if (!money.ok) return money;
      Object.assign(me, { status: 'active', name: actor.name, cash: money.cash, gear: money.gear, heirId: heirOf(request.heirId, actor.id, ctx) });
      b.escrow += money.cash;
      pay(actor.id, -money.cash);
      log('contribution', money.cash, { gear: gearValue(me) });
      tryOpen(b, day, ctx, out.events, p);
      break;
    }
    case 'decline':
      if (b.status !== 'forming') return fail('not-forming');
      if (me?.status !== 'invited') return fail('not-invited');
      me.status = 'declined';
      break;
    case 'contribute': {
      if (b.status !== 'forming') return fail('not-forming');
      if (me?.status !== 'active') return fail('not-partner');
      const money = contribution(request, actor, p, p.maxGearItems - me.gear.length);
      if (!money.ok) return money;
      if (!money.cash && !money.gear.length) return fail('bad-amount');
      me.cash += money.cash;
      me.gear.push(...money.gear);
      b.escrow += money.cash;
      pay(actor.id, -money.cash);
      log('contribution', money.cash, { gear: money.gear.reduce((a, g) => a + g.value, 0) });
      tryOpen(b, day, ctx, out.events, p);
      break;
    }
    case 'withdraw': {
      if (b.status !== 'forming') return fail('not-forming');
      if (me?.status !== 'active') return fail('not-partner');
      const refund = refundShare(b, me);
      b.escrow -= refund;
      me.status = 'left';
      pay(actor.id, refund);
      log('refund', -refund);
      if (!holders(b).length) close(b, day, 'cancelled');
      else if (b.founderId === actor.id) b.founderId = holders(b)[0].actorId;
      break;
    }
    case 'setupRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      const arch = archetypeOf(b);
      if (request.use.kind === 'hire') {
        const fee = hireFee(request.use.hire, ctx.operatorRank, p);
        b.escrow -= fee;
        log('hire', -fee);
      }
      const r = check.result;
      out.events.push({ type: 'roll', action: 'setup', band: r.band, exposure: r.exposure });
      if (r.success) {
        const [min, max] = arch.setup;
        const cost = Math.round((max - (max - min) * clamp(r.margin / 8, 0, 1)) / 50) * 50;
        b.setup = { passed: true, band: r.band, cost, capacity: p.setupCapacity[r.band] ?? 1, by: actor.id, day };
        tryOpen(b, day, ctx, out.events, p);
      } else {
        const rule = r.band === 'fumble' ? p.setupFumble : p.setupFailure;
        // Never more than half of what the partners have put in, so one bad roll cannot wipe them out.
        const loss = Math.min(Math.floor(b.escrow * p.setupLossCap), Math.round(arch.setup[0] * rule.loss));
        b.escrow -= loss;
        b.setup = { passed: false, band: r.band, retryDay: day + rule.delay, by: actor.id, day };
        if (loss) log('setupLoss', -loss);
      }
      break;
    }
    case 'action': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      if (request.use.kind === 'hire') {
        const fee = hireFee(request.use.hire, ctx.operatorRank, p);
        b.till -= fee;
        log('hire', -fee);
      }
      const r = check.result;
      if (r.bonus) {
        const bonus = b.period.bonuses.find((x) => x.action === request.action && !x.used);
        if (bonus) bonus.used = true;
      }
      if (r.extra) spendDays(b, actor.id, 1);
      b.period.slots.push({
        action: request.action, by: actor.id, use: useKey(request.use), band: r.band, total: r.total, dv: r.dv, approach: r.approach, luck: r.luck, bonus: r.bonus,
      });
      out.events.push({ type: 'roll', action: request.action, band: r.band, exposure: r.exposure });
      break;
    }
    case 'assist': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      b.period.helpers.push(actor.id);
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      if (r.success) b.period.bonuses.push({ id: request.key, action: request.forAction, by: actor.id, used: false });
      out.events.push({ type: 'roll', action: 'assist', forAction: request.forAction, band: r.band, exposure: r.exposure });
      break;
    }
    case 'draw': {
      if (b.status !== 'open') return fail('not-open');
      if (!me || (me.status !== 'active' && me.status !== 'leaving')) return fail('not-partner');
      const amount = int(request.amount);
      if (amount < 1) return fail('bad-amount');
      if (amount > drawAllowance(b, actor.id)) return fail('over-allowance');
      b.till -= amount;
      b.period.draws[actor.id] = (b.period.draws[actor.id] ?? 0) + amount;
      pay(actor.id, amount);
      log('draw', -amount);
      break;
    }
    case 'setHeir':
      if (!me || !['active', 'leaving', 'invited'].includes(me.status)) return fail('not-partner');
      me.heirId = heirOf(request.heirId, actor.id, ctx);
      if (request.heirId && !me.heirId) return fail('bad-heir');
      break;
    case 'leave':
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active') return fail('not-partner');
      if (voters(b).length <= 1 && me.voting) return fail('only-partner');
      me.status = 'leaving';
      me.leavingSince = day;
      out.events.push({ type: 'leaving', actorId: actor.id });
      break;
    case 'buyout': {
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting) return fail('not-partner');
      const seller = partnerOf(b, request.sellerId);
      if (!seller || seller.status !== 'leaving' || seller.actorId === actor.id) return fail('not-for-sale');
      const price = Math.max(0, Math.round(seller.units * unitValue(b)));
      if (price > actor.wealth) return fail('insufficient-funds');
      me.units += seller.units;
      seller.units = 0;
      seller.status = 'left';
      pay(actor.id, -price);
      pay(seller.actorId, price);
      log('buyout', 0, { price, sellerId: seller.actorId });
      break;
    }
    case 'propose':
    case 'proposeClose': {
      const kind = request.type === 'proposeClose' ? 'close' : request.kind;
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting) return fail('not-partner');
      if (!PROPOSAL_RULES[kind]) return fail('bad-request');
      if (b.proposals.some((x) => x.kind === kind)) return fail('proposal-open');
      const can = canPropose(b, kind, p);
      if (!can.ok) return can;
      b.proposals.push({ id: request.key, kind, by: actor.id, day, expires: day + p.proposalDays, votes: { [actor.id]: true } });
      settleProposals(b, day, out, p);
      break;
    }
    case 'stepUpRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      if (request.use.kind === 'hire') {
        const fee = hireFee(request.use.hire, ctx.operatorRank, p);
        b.till -= fee;
        log('hire', -fee);
      }
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      const { stepped } = applyStepUp(b, actor.id, r, day, p);
      out.events.push({ type: 'roll', action: 'stepUp', band: r.band, exposure: r.exposure }, ...(stepped ? [{ type: 'steppedUp', stage: b.stage }] : []));
      break;
    }
    case 'addDays': {
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting) return fail('not-partner');
      const added = addProjectDays(b, actor.id, request.projectId, request.days, { growthRate: ctx.growthRate ?? 1, day, params: p });
      if (!added.ok) return added;
      if (added.done) out.events.push({ type: 'projectDone', projectId: request.projectId });
      break;
    }
    case 'vote': {
      if (b.status !== 'open') return fail('not-open');
      if (!me || !me.voting || (me.status !== 'active' && me.status !== 'leaving')) return fail('not-partner');
      const proposal = b.proposals.find((x) => x.id === request.proposalId);
      if (!proposal) return fail('no-proposal');
      proposal.votes[actor.id] = request.yes === true;
      settleProposals(b, day, out, p);
      break;
    }
    default:
      return fail('bad-request');
  }
  return { ok: true, business: b, ...out };
}

function found(request, actor, day, ctx, p) {
  const name = text(request.name, 60);
  if (!name) return fail('bad-name');
  if (!ARCHETYPES[request.archetype]) return fail('bad-archetype');
  const money = contribution(request, actor, p);
  if (!money.ok) return money;

  const invite = [...new Set((request.invite ?? []).map(String))].filter((id) => id !== actor.id);
  if (invite.length > p.maxPartners - 1) return fail('too-many-partners');
  if (invite.some((id) => !(id in ctx.actors))) return fail('bad-partner');

  const founders = new Set([actor.id, ...invite]);
  let sweat = null;
  if (request.sweat?.actorId && Number(request.sweat.pct) > 0) {
    const pct = int(request.sweat.pct);
    if (!founders.has(request.sweat.actorId) || pct > p.maxSweatPct) return fail('bad-sweat');
    sweat = { actorId: request.sweat.actorId, pct };
  }

  const business = normalizeBusiness({
    id: ctx.newId,
    name,
    archetype: request.archetype,
    location: text(request.location, 80),
    status: 'forming',
    founderId: actor.id,
    createdDay: day,
    partners: [
      { actorId: actor.id, name: actor.name, status: 'active', cash: money.cash, gear: money.gear, heirId: heirOf(request.heirId, actor.id, ctx) },
      ...invite.map((id) => ({ actorId: id, name: ctx.actors[id], status: 'invited', cash: 0, gear: [] })),
    ],
    agreement: { sweat, buyoutDays: p.buyoutDays },
    escrow: money.cash,
  });
  addLedger(business, { day, kind: 'founded', amount: money.cash, actorId: actor.id, gear: gearValue(business.partners[0]) }, p);
  return { ok: true, business };
}

/** A contribution's cash and gear, checked against what the character has. */
function contribution(request, actor, p, gearRoom = p.maxGearItems) {
  const cash = int(request.cash);
  if (cash < 0) return fail('bad-amount');
  if (cash > actor.wealth) return fail('insufficient-funds');
  const gear = (request.gear ?? [])
    .map((g) => ({ name: text(g?.name, 60), value: int(g?.value) }))
    .filter((g) => g.name && g.value > 0);
  if (gear.length > gearRoom || gear.some((g) => g.value > 20000)) return fail('bad-gear');
  return { ok: true, cash, gear };
}

function heirOf(heirId, self, ctx) {
  return heirId && heirId !== self && heirId in ctx.actors ? String(heirId) : null;
}

/** A partner's part of the escrow, in proportion to the cash they put in (losses and fees are shared). */
function refundShare(b, partner) {
  const cash = holders(b).reduce((a, x) => a + x.cash, 0);
  return cash > 0 ? Math.floor((b.escrow * partner.cash) / cash) : 0;
}

/** Once the setup roll has passed and the money is there, the business opens (or waits for the GM). */
function tryOpen(b, day, ctx, events, p) {
  if (b.status !== 'forming' || !b.setup?.passed || fundingShortfall(b) > 0) return;
  if (ctx.approval) {
    b.status = 'pending';
    events.push({ type: 'awaitingApproval' });
    return;
  }
  openBusiness(b, day, ctx.weekday, p);
  events.push({ type: 'opened' });
}

/**
 * Open a business: contributions become units (one per eb of cash or gear at book value, plus any
 * sweat slice), the setup cost becomes its fit-out, and the rest of the money its till.
 */
export function openBusiness(business, day, weekday, p = BUSINESS_DEFAULTS) {
  const b = business;
  const partners = holders(b);
  for (const x of partners) x.units = x.cash + gearValue(x);
  const sweat = b.agreement.sweat;
  const sweatPartner = sweat ? partnerOf(b, sweat.actorId) : null;
  if (sweatPartner && (sweatPartner.status === 'active')) {
    const base = partners.reduce((a, x) => a + x.units, 0);
    sweatPartner.units += Math.round((base * sweat.pct) / (100 - sweat.pct));
  }
  for (const x of b.partners.filter((x) => x.status === 'invited')) x.status = 'declined';

  const gear = partners.reduce((a, x) => a + gearValue(x), 0);
  const cashSpent = Math.max(0, b.setup.cost - gear);
  b.assets = Math.max(b.setup.cost, gear);
  b.till = b.escrow - cashSpent;
  b.escrow = 0;
  b.state.capacity = b.setup.capacity;
  b.status = 'open';
  b.openedDay = day;
  b.period = newPeriod(1, day, weekday);
  addLedger(b, { day, kind: 'opened', amount: -cashSpent }, p);
  return b;
}

/** GM: let a business that is waiting open. */
export function approveBusiness(business, day, weekday, p = BUSINESS_DEFAULTS) {
  const b = structuredClone(normalizeBusiness(business));
  if (b.status !== 'pending') return fail('not-pending');
  return { ok: true, business: openBusiness(b, day, weekday, p), wealth: {} };
}

/** GM: turn a business down before it opens. Every partner gets their share of the escrow back. */
export function rejectBusiness(business, day, p = BUSINESS_DEFAULTS) {
  const b = structuredClone(normalizeBusiness(business));
  if (b.status !== 'pending' && b.status !== 'forming') return fail('not-pending');
  const wealth = {};
  const shares = holders(b).map((x) => [x, refundShare(b, x)]);
  for (const [x, refund] of shares) {
    if (refund > 0) wealth[x.actorId] = refund;
    addLedger(b, { day, kind: 'refund', amount: -refund, actorId: x.actorId }, p);
  }
  b.escrow = 0;
  close(b, day, 'rejected');
  return { ok: true, business: b, wealth };
}

/** GM: a partner has died or left the table, so the buy-out rule applies to their stake. */
export function markLeaving(business, actorId, day) {
  const b = structuredClone(normalizeBusiness(business));
  const x = partnerOf(b, actorId);
  if (b.status !== 'open' || x?.status !== 'active') return fail('not-partner');
  x.status = 'leaving';
  x.leavingSince = day;
  return { ok: true, business: b, wealth: {} };
}

/** Pay out what is left (the till and the gear's salvage) by units, and close. */
function liquidate(b, day, reason, out, p) {
  const salvage = Math.round(b.assets * (reason === 'failed' ? p.salvage.failed : p.salvage.closed));
  const pot = Math.max(0, b.till + salvage);
  const units = totalUnits(b);
  let paid = 0;
  for (const x of holders(b)) {
    const share = units > 0 ? Math.floor((pot * x.units) / units) : 0;
    if (share > 0) out.wealth[x.actorId] = (out.wealth[x.actorId] ?? 0) + share;
    paid += share;
  }
  addLedger(b, { day, kind: 'liquidation', amount: -paid, salvage }, p);
  b.till = 0;
  b.assets = 0;
  close(b, day, reason);
  out.events.push({ type: 'closed', reason, paid });
}

/** Whether a proposal of this kind could pass now (checked again when it does). */
function canPropose(b, kind, p) {
  if (kind === 'stepUp') {
    if (b.stepUp?.approved) return fail('already-agreed');
    const m = milestones(b, p);
    if (!m.available) return fail('no-step-up');
    if (!m.met) return fail('milestones');
  }
  if (kind === 'expansion') return expansionOffer(b, p);
  return { ok: true };
}

/**
 * Settle every open proposal by its rule (PROPOSAL_RULES). Unanimous: every voting partner says yes,
 * and one no ends it. Majority: more than half the voting units say yes; it ends once half or more
 * say no. A proposal that passes takes effect at once.
 */
function settleProposals(b, day, out, p) {
  const all = votingUnits(b);
  for (const proposal of [...b.proposals]) {
    const vs = voters(b);
    const units = (want) => vs.filter((x) => proposal.votes[x.actorId] === want).reduce((a, x) => a + x.units, 0);
    const unanimous = PROPOSAL_RULES[proposal.kind] === 'unanimous';
    const failed = unanimous ? vs.some((x) => proposal.votes[x.actorId] === false) : all > 0 && units(false) * 2 >= all;
    const passed = unanimous ? vs.every((x) => proposal.votes[x.actorId] === true) : units(true) * 2 > all;
    if (!failed && !passed) continue;
    b.proposals = b.proposals.filter((x) => x !== proposal);
    if (failed) {
      out.events.push({ type: 'proposalFailed', kind: proposal.kind });
      continue;
    }
    out.events.push({ type: 'proposalPassed', kind: proposal.kind });
    if (proposal.kind === 'close') liquidate(b, day, 'closed', out, p);
    if (proposal.kind === 'stepUp') b.stepUp = { approved: true, retryDay: null };
    if (proposal.kind === 'expansion') {
      const started = startExpansion(b, proposal.id, day, p);
      if (!started.ok) out.events.push({ type: 'proposalVoid', kind: proposal.kind, reason: started.reason });
    }
  }
}

// ── Time passing ─────────────────────────────────────────────────────────────

/**
 * Bring a business up to `day`: settle stakes whose buy-out window has run out, and close each
 * operating period that has ended, in order.
 * @param {object} business
 * @param {number} day
 * @param {{weekday?: number, growthRate?: number, actors?: object, params?: object}} [o]
 * @returns {{business: object, wealth: object, events: object[], changed: boolean}}
 */
export function advanceBusiness(business, day, { weekday = 1, growthRate = 1, actors = {}, params: p = BUSINESS_DEFAULTS } = {}) {
  const b = structuredClone(normalizeBusiness(business));
  const out = { wealth: {}, events: [] };
  if (b.status !== 'open' || !b.period) return { business: b, ...out, changed: false };
  let changed = settleLeavers(b, day, actors, out);
  const lapsed = b.proposals.filter((x) => x.expires != null && day > x.expires);
  if (lapsed.length) {
    b.proposals = b.proposals.filter((x) => !lapsed.includes(x));
    out.events.push(...lapsed.map((x) => ({ type: 'proposalLapsed', kind: x.kind })));
    changed = true;
  }

  let closes = 0;
  while (b.status === 'open' && b.period.endDay <= day && closes < p.catchUpPeriods) {
    closePeriod(b, { growthRate, weekday, params: p }, out);
    closes++;
    changed = true;
  }
  // A longer jump than the catch-up allows: the weeks beyond it are skipped, not simulated.
  if (b.status === 'open' && b.period.endDay <= day) {
    b.period = newPeriod(b.period.index + 1, day, weekday);
    out.events.push({ type: 'periodsSkipped' });
  }
  return { business: b, ...out, changed };
}

/** Stakes nobody bought within the window pass to the named heir as non-voting units, or lapse. */
function settleLeavers(b, day, actors, out) {
  let changed = false;
  for (const x of b.partners.filter((y) => y.status === 'leaving' && day >= (y.leavingSince ?? day) + b.agreement.buyoutDays)) {
    const heirId = x.heirId && x.heirId !== x.actorId ? x.heirId : null;
    if (heirId) {
      const heir = partnerOf(b, heirId);
      if (heir && (heir.status === 'active' || heir.status === 'leaving')) heir.units += x.units;
      else if (heir) Object.assign(heir, { status: 'active', units: x.units, voting: false, cash: 0, gear: [] });
      else b.partners.push({ actorId: heirId, name: actors[heirId] ?? heirId, status: 'active', cash: 0, gear: [], units: x.units, voting: false, heirId: null, leavingSince: null });
    }
    out.events.push({ type: heirId ? 'inherited' : 'stakeLapsed', actorId: x.actorId, heirId });
    x.units = 0;
    x.status = 'left';
    changed = true;
  }
  return changed;
}

const traffic = (rep) => 0.6 + (clamp(rep, 0, 100) / 100) * 0.8;

/** Close the current operating period: the week's takings and upkeep, the state, the digest. */
function closePeriod(b, { growthRate, weekday, params: p }, out) {
  const stage = p.stages[b.stage] ?? p.stages[0];
  const arch = archetypeOf(b);
  const fx = p.effects;
  const g = growthRate;
  const slot = (action) => b.period.slots.find((s) => s.action === action);
  const scale = (s) => approachOf(s.approach).effect;

  const work = slot('work');
  const workMult = work ? 1 + (fx.work[work.band] - 1) * scale(work) : p.unworked;
  const promote = slot('promote');
  if (promote) b.state.reputation += fx.promote[promote.band] * scale(promote) * g;
  const source = slot('source');
  if (source) b.state.costFactor = Math.max(p.costFloor, b.state.costFactor - fx.source[source.band] * scale(source));
  const fixUp = slot('fixUp');
  if (fixUp) b.state.capacity = clamp(b.state.capacity + fx.fixUp[fixUp.band] * stage.fixUpScale * scale(fixUp) * g, 0.5, stage.capacityCap);
  const safe = slot('keepSafe');
  const protection = safe ? 1 - fx.keepSafe[safe.band] * scale(safe) : 1;

  b.state.reputation = clamp(b.state.reputation + (50 - b.state.reputation) * p.reputationDrift, 0, 100);
  if (b.state.compliance != null) b.state.compliance = clamp(b.state.compliance + (p.complianceBaseline - b.state.compliance) * p.reputationDrift, 0, 100);
  b.state.costFactor = Math.min(1, b.state.costFactor + p.costCreep);

  // A first period that began part-way through a week earns for the days it ran.
  const part = Math.min(1, (b.period.endDay - b.period.startDay) / 7);
  const takings = Math.round(arch.takings * b.state.capacity * traffic(b.state.reputation) * workMult * part);
  const upkeep = Math.round((arch.costs * b.state.capacity ** 0.85 * b.state.costFactor + stage.rent + (stage.licence ?? 0) + stage.protection * protection) * part);
  const profit = takings - upkeep;
  b.till += profit;

  const digest = {
    index: b.period.index,
    startDay: b.period.startDay,
    endDay: b.period.endDay,
    takings,
    upkeep,
    profit,
    till: b.till,
    worked: !!work,
    actions: b.period.slots.map((s) => ({ action: s.action, by: s.by, band: s.band })),
    bands: stateBands(b, p),
  };
  b.digests = [...b.digests, digest].slice(-p.digestCap);
  addLedger(b, { day: b.period.endDay, kind: 'takings', amount: takings, period: b.period.index }, p);
  addLedger(b, { day: b.period.endDay, kind: 'upkeep', amount: -upkeep, period: b.period.index }, p);
  out.events.push({ type: 'periodClosed', digest });

  b.losingPeriods = b.till < 0 ? b.losingPeriods + 1 : 0;
  if (b.losingPeriods >= p.failurePeriods) {
    liquidate(b, b.period.endDay, 'failed', out, p);
    return;
  }
  b.period = newPeriod(b.period.index + 1, b.period.endDay, weekday);
}
