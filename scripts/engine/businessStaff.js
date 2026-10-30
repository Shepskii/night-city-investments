/**
 * Player businesses: employees
 * @file scripts/engine/businessStaff.js
 * @description Employees (DESIGN §33, E1): characters, player or NPC, and recruits found on the street,
 *              working in a business's posts for a wage. Their skills, read from the post they hold,
 *              lift what the business earns each week; a manager works the shop and security answers
 *              trouble when no partner does; a partner can call an employee in to make one of the
 *              business's rolls for overtime pay. Pure; no Foundry globals.
 *
 * An employee: `{ id, actorId, name, source, post, bases, pct, wage, hiredDay, status, owed }`.
 *   source   'pc' (a player character), 'npc' (an NPC actor) or 'recruit' (found with a recruiting roll; no actor)
 *   bases    their base by use key (`skill:Business`, `ability:Maker` holds the rank), read by the GM's
 *            service from the character's sheet and refreshed each week; a recruit's is set at hiring
 *   pct      the share of the going rate the partners offered; `wage` is what that comes to now
 *   status   'offered' (waiting for the character, or the GM for an NPC) or 'active'
 *   owed     wages the cash could not cover, paid first the next week
 */

import { createRng } from './rng.js';
import { cprD10 } from './checks.js';
import { bandOf } from './rolls.js';
import { BUSINESS_DEFAULTS, POSTS, SKILLS, ABILITIES, EVENTS, useKey, stageDv } from './businessConfig.js';
import { archetypeOf, fail, int, addLedger, partnerOf } from './businessRecord.js';

/** Every use an employee's sheet is read for: each skill and role ability a business roll names. */
export const STAFF_USES = Object.freeze([...Object.values(SKILLS), ...Object.values(ABILITIES)]);

/** A base as a level: green, skilled, expert or master. */
export function levelOf(base, p = BUSINESS_DEFAULTS) {
  return p.staff.levels.find(([upTo]) => base <= upTo)[1];
}

export const activeStaff = (b) => (b.staff ?? []).filter((s) => s.status === 'active');
export const staffOf = (b, id) => (b.staff ?? []).find((s) => s.id === id) ?? null;

/** What counts for a post here: `[{use, adj}]`, adj being taken off a skill that counts a level lower. */
export function postUses(post, arch, p = BUSINESS_DEFAULTS) {
  const def = POSTS[post];
  if (!def) return [];
  const lower = [...(def.lower ?? []), ...(def.lowerTrade ? arch?.trade ?? [] : [])];
  return [
    ...(def.trade ? [...(arch?.trade ?? []), ...(arch?.abilities ?? [])] : []),
    ...def.uses,
  ].map((use) => ({ use, adj: 0 })).concat(lower.map((use) => ({ use, adj: -p.staff.lowerBy })));
}

/** An employee's base in one use, for a roll: stat + skill, or a role ability's rank. */
export function staffBase(staff, use, p = BUSINESS_DEFAULTS) {
  const stored = staff.bases?.[useKey(use)];
  if (stored != null) return int(stored);
  return use.kind === 'ability' ? 0 : p.staff.recruitOther;
}

/**
 * An employee's base for a post: their best base among what counts for it. A role ability counts as
 * its rank plus `abilityBonus` (a level above that rank as a skill); one they lack does not count.
 */
export function postBase(staff, post, arch, p = BUSINESS_DEFAULTS) {
  const values = postUses(post, arch, p).map(({ use, adj }) => {
    const base = staffBase(staff, use, p);
    if (use.kind === 'ability') return base > 0 ? base + p.staff.abilityBonus + adj : 0;
    return base + adj;
  });
  return Math.max(0, ...values);
}

/** The going weekly wage for a base at a stage. */
export const goingRate = (base, stage, p = BUSINESS_DEFAULTS) => Math.round(base * (p.staff.rate[stage] ?? p.staff.rate.at(-1)));

/** What an employee is paid now: the going rate for their post's base, times the share offered. */
export function wageOf(b, staff, p = BUSINESS_DEFAULTS) {
  return Math.round(goingRate(postBase(staff, staff.post, archetypeOf(b), p), b.stage, p) * (staff.pct ?? 1));
}

/** How many floor staff the business has room for: its Capacity, rounded down, and at least one. */
export const floorRoom = (b) => Math.max(1, Math.floor(b.state.capacity));

/** Whether another employee could take this post (offers waiting count as places taken). */
export function postOpen(b, post, p = BUSINESS_DEFAULTS) {
  const def = POSTS[post];
  if (!def) return fail('bad-post');
  if (b.stage < def.stage) return fail('post-later');
  const staff = (b.staff ?? []).filter((s) => s.status === 'active' || s.status === 'offered');
  if (staff.length >= (p.staff.headcount[b.stage] ?? 0)) return fail('no-headcount');
  if (post === 'manager' && staff.some((s) => s.post === 'manager')) return fail('post-taken');
  if (post === 'floor' && staff.filter((s) => s.post === 'floor').length >= floorRoom(b)) return fail('no-floor-room');
  return { ok: true };
}

// ── Recruiting ───────────────────────────────────────────────────────────────

/** Whether a recruiting roll can be made now, for a post, and its DV, skills and cost. */
export function recruitCheck(b, post, day, p = BUSINESS_DEFAULTS) {
  const r = p.staff.recruit;
  const open = postOpen(b, post, p);
  if (!open.ok) return open;
  if (b.lastRecruit != null && day < b.lastRecruit + r.cooldown) return fail('recruit-delay');
  if ((b.candidates ?? []).filter((c) => c.expires >= day).length >= r.maxCandidates) return fail('too-many-candidates');
  const cost = r.cost[b.stage] ?? r.cost.at(-1);
  if (b.till < cost) return fail('no-funds');
  return { ok: true, dv: stageDv(b.stage, p), uses: [...r.uses], cost };
}

/**
 * Record a recruiting roll: the cost is spent; a pass finds a candidate for the post, drawn from the
 * seed and the request, whose level the band sets. A failure finds nobody.
 * @returns {object|null} the candidate
 */
export function applyRecruit(b, { result, day, post, key, seed = 'nci', by }, p = BUSINESS_DEFAULTS) {
  const r = p.staff.recruit;
  const cost = r.cost[b.stage] ?? r.cost.at(-1);
  b.till -= cost;
  b.lastRecruit = day;
  addLedger(b, { day, kind: 'recruit', amount: -cost, actorId: by }, p);
  b.candidates = (b.candidates ?? []).filter((c) => c.expires >= day);
  if (!result.success) return null;
  const rng = createRng(seed, 'recruit', b.id, key);
  const levels = r.levels[result.band] ?? ['green'];
  const level = levels[rng.int(0, levels.length - 1)];
  const candidate = {
    id: key,
    name: `${r.firstNames[rng.int(0, r.firstNames.length - 1)]} ${r.lastNames[rng.int(0, r.lastNames.length - 1)]}`,
    post,
    level,
    base: p.staff.recruitBase[level],
    expires: day + r.candidateDays,
  };
  b.candidates = [...b.candidates, candidate];
  return candidate;
}

// ── Hiring, accepting, firing ────────────────────────────────────────────────

/**
 * Whether a hire can be proposed, and its terms: a candidate found by recruiting, or a character
 * (a player character, or an NPC linked to a Messenger contact tagged staff or employee), for a post
 * at a share of the going rate (`pct`, as a percentage).
 * @param {object} ctx - `staffActors` maps the characters that may be hired to 'pc' or 'npc'; `actors` their names
 */
export function hireOffer(b, request, ctx, day, p = BUSINESS_DEFAULTS) {
  const pct = Math.round(Number(request.pct ?? 100)) / 100;
  if (!(pct >= p.staff.offer.min && pct <= p.staff.offer.max)) return fail('bad-wage');
  if (request.candidateId) {
    const candidate = (b.candidates ?? []).find((c) => c.id === request.candidateId && c.expires >= day);
    if (!candidate) return fail('no-candidate');
    const open = postOpen(b, candidate.post, p);
    if (!open.ok) return open;
    return { ok: true, terms: { candidateId: candidate.id, name: candidate.name, post: candidate.post, pct } };
  }
  const actorId = String(request.actorId ?? '');
  const source = ctx.staffActors?.[actorId];
  if (!source) return fail('not-staff');
  if (partnerOf(b, actorId) && ['active', 'leaving', 'invited'].includes(partnerOf(b, actorId).status)) return fail('is-partner');
  if ((b.staff ?? []).some((s) => s.actorId === actorId)) return fail('already-staff');
  const open = postOpen(b, request.post, p);
  if (!open.ok) return open;
  return { ok: true, terms: { actorId, name: ctx.actors?.[actorId] ?? actorId, source, post: request.post, pct } };
}

/**
 * A hire the partners agreed to. A recruit starts at once; a character is offered the job and accepts
 * it from their own window (the GM accepts for an NPC).
 * @param {object} ctx - `basesOf(actorId)` reads a character's bases from their sheet
 */
export function enactHire(b, terms, day, ctx, p = BUSINESS_DEFAULTS) {
  const post = terms.post;
  const open = postOpen(b, post, p);
  if (!open.ok) return open;
  let staff;
  if (terms.candidateId) {
    const candidate = (b.candidates ?? []).find((c) => c.id === terms.candidateId);
    if (!candidate) return fail('no-candidate');
    const bases = Object.fromEntries(postUses(post, archetypeOf(b), p).filter(({ use }) => use.kind === 'skill').map(({ use }) => [useKey(use), candidate.base]));
    staff = { id: `stf_${candidate.id}`, actorId: null, name: candidate.name, source: 'recruit', post, bases, pct: terms.pct, hiredDay: day, status: 'active', owed: 0 };
    b.candidates = b.candidates.filter((c) => c !== candidate);
  } else {
    staff = {
      id: `stf_${terms.actorId}`, actorId: terms.actorId, name: terms.name, source: terms.source, post,
      bases: ctx.basesOf?.(terms.actorId) ?? {}, pct: terms.pct, hiredDay: null, status: 'offered', owed: 0,
    };
  }
  staff.wage = wageOf(b, staff, p);
  b.staff = [...(b.staff ?? []), staff];
  addLedger(b, { day, kind: staff.status === 'active' ? 'hired' : 'jobOffered', amount: 0, staffName: staff.name }, p);
  return { ok: true, staff };
}

/** The character offered a job takes it, or turns it down. */
export function answerJob(b, staffId, yes, day, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, staffId);
  if (staff?.status !== 'offered') return fail('no-offer');
  if (!yes) {
    b.staff = b.staff.filter((s) => s !== staff);
    addLedger(b, { day, kind: 'jobDeclined', amount: 0, staffName: staff.name }, p);
    return { ok: true };
  }
  staff.status = 'active';
  staff.hiredDay = day;
  staff.wage = wageOf(b, staff, p);
  addLedger(b, { day, kind: 'hired', amount: 0, staffName: staff.name }, p);
  return { ok: true };
}

/** An employee leaves of their own accord: no severance. */
export function quitJob(b, staffId, day, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, staffId);
  if (!staff) return fail('not-staff');
  b.staff = b.staff.filter((s) => s !== staff);
  addLedger(b, { day, kind: 'quit', amount: 0, staffName: staff.name }, p);
  return { ok: true };
}

/** Whether firing can be proposed. */
export function fireOffer(b, staffId) {
  const staff = staffOf(b, staffId);
  return staff ? { ok: true, terms: { staffId, name: staff.name } } : fail('not-staff');
}

/**
 * A firing the partners agreed to: an employee who started is paid a week's wage (and what they are
 * owed) from the cash, as far as it goes; a player character's goes to their eddies.
 * @returns {{ok: true, paid: number, actorId: string|null}}
 */
export function enactFire(b, staffId, day, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, staffId);
  if (!staff) return fail('not-staff');
  const due = staff.status === 'active' ? wageOf(b, staff, p) * p.staff.severanceWeeks + (staff.owed ?? 0) : 0;
  const paid = Math.max(0, Math.min(due, b.till));
  b.till -= paid;
  b.staff = b.staff.filter((s) => s !== staff);
  addLedger(b, { day, kind: 'fired', amount: -paid, staffName: staff.name }, p);
  return { ok: true, paid, actorId: staff.source === 'pc' ? staff.actorId : null };
}

// ── Overtime ─────────────────────────────────────────────────────────────────

/** Overtime for one call: a share of the employee's weekly wage. */
export function overtimePay(b, staff, kind, p = BUSINESS_DEFAULTS) {
  return Math.round(wageOf(b, staff, p) * (p.staff.overtime[kind] ?? p.staff.overtime.roll));
}

/** Overtime shifts an employee has worked this week. */
export const shiftsOf = (b, staffId) => b.period?.overtime?.[staffId] ?? 0;

/**
 * An employee called in for a roll: whether they can be, and the use they roll with, their best for
 * this roll (an alternative skill's DV step counted against it), with its base.
 * @returns {{ok: true, use: object, dvAdd: number, cost: number} | {ok: false, reason: string}}
 */
export function staffRoll(b, use, uses, kind, funds, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, use.staffId);
  if (staff?.status !== 'active') return fail('not-staff');
  if (shiftsOf(b, staff.id) >= p.staff.maxShifts) return fail('no-shifts');
  const cost = overtimePay(b, staff, kind, p);
  if (funds < cost) return fail('no-funds');
  const best = uses
    .map((u) => ({ u, base: staffBase(staff, u, p), dvAdd: u.dvAdd ?? 0 }))
    .filter((x) => x.u.kind !== 'ability' || x.base > 0)
    .sort((a, c) => (c.base - c.dvAdd) - (a.base - a.dvAdd))[0];
  if (!best) return fail('bad-use');
  return { ok: true, use: { kind: 'staff', staffId: staff.id, via: useKey(best.u), base: best.base }, dvAdd: best.dvAdd, cost };
}

/** Pay an employee's overtime from the cash and count the shift. A player character's goes to their eddies. */
export function payOvertime(b, staffId, kind, day, by, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, staffId);
  const cost = overtimePay(b, staff, kind, p);
  b.till -= cost;
  b.period.overtime = { ...(b.period.overtime ?? {}), [staffId]: shiftsOf(b, staffId) + 1 };
  addLedger(b, { day, kind: 'overtime', amount: -cost, actorId: by, staffName: staff.name }, p);
  return { cost, actorId: staff.source === 'pc' ? staff.actorId : null };
}

// ── The week ─────────────────────────────────────────────────────────────────

/** Roll a check for an employee, from the seed: the week's draw, as an event is, not a player's roll. */
function autoRoll(b, staff, base, dv, seed, what) {
  const rng = createRng(seed, 'staff', b.id, b.period.index, staff.id, what);
  const roll = cprD10(() => rng.int(1, 10));
  const total = base + roll.total;
  return { band: bandOf(total - dv, roll.crit), total, dv };
}

/**
 * Before a week closes: what the staff did without a partner. A manager works the shop (or chases
 * contracts, at a company) when no partner did; security answers a security event, and a compliance
 * officer an inspection, that nobody answered. Each is a slot of its own, marked `staff`.
 */
export function staffShifts(b, seed = 'nci', p = BUSINESS_DEFAULTS) {
  const arch = archetypeOf(b);
  const staff = activeStaff(b);
  const slots = b.period.slots;
  const dv = stageDv(b.stage, p);
  const manager = staff.find((s) => s.post === 'manager');
  const worked = b.stage >= 2 ? slots.some((s) => s.action === 'contracts' || s.action === 'shortcuts') : slots.some((s) => s.action === 'work');
  if (manager && !worked) {
    const action = b.stage >= 2 ? 'contracts' : 'work';
    slots.push({ action, by: manager.id, staff: true, approach: 'standard', bonus: 0, ...autoRoll(b, manager, postBase(manager, 'manager', arch, p), dv, seed, action) });
  }
  const event = b.period.event;
  const def = event ? EVENTS[event.kind] : null;
  if (def && !def.good && !slots.some((s) => s.action === 'respond')) {
    const post = event.kind === 'inspection' ? 'compliance' : def.security || event.kind === 'trouble' ? 'security' : null;
    const who = post ? staff.find((s) => s.post === post) : null;
    if (who) slots.push({ action: 'respond', event: event.kind, by: who.id, staff: true, approach: 'standard', bonus: 0, ...autoRoll(b, who, postBase(who, post, arch, p), dv, seed, 'respond') });
  }
}

/**
 * What the staff do to the week: the lift to the takings from floor and sales staff (capped by stage),
 * and the drift a bookkeeper, publicist, compliance officer and salesperson bring.
 * @returns {{lift: number, reputationTarget: number|null}}
 */
export function staffWeek(b, growthRate = 1, p = BUSINESS_DEFAULTS) {
  const st = p.staff;
  const arch = archetypeOf(b);
  const staff = activeStaff(b);
  const each = (post) => staff.filter((s) => s.post === post).map((s) => ({ s, base: postBase(s, post, arch, p) }));
  const per = (base) => Math.max(0, base - st.floorBase) * st.floorLift;
  const floor = each('floor').slice(0, floorRoom(b)).reduce((a, x) => a + per(x.base), 0);
  const sales = each('sales').reduce((a, x) => a + per(x.base) * st.salesShare, 0);
  const lift = Math.min(st.liftCap[b.stage] ?? st.liftCap.at(-1), floor + sales);
  for (const { base } of each('bookkeeper')) b.state.costFactor = Math.max(p.costFloor, b.state.costFactor - st.bookkeeper[levelOf(base, p)]);
  for (const { base } of each('publicist')) b.state.reputation += st.publicist[levelOf(base, p)] * growthRate;
  for (const { base } of each('compliance')) if (b.state.compliance != null) b.state.compliance += st.compliance[levelOf(base, p)];
  return { lift, reputationTarget: each('sales').length ? st.salesReputation : null };
}

/**
 * Pay the week's wages from the cash, after the takings and upkeep: what is owed first, then this
 * week's (for the days the week ran). What the cash cannot cover is owed. A player character's wage
 * goes to their eddies.
 * @returns {{wages: number, paid: number, owed: number, pay: object}} `pay` maps actorId to eddies
 */
export function payWages(b, part, day, p = BUSINESS_DEFAULTS) {
  const pay = {};
  let wages = 0;
  let paid = 0;
  for (const staff of activeStaff(b)) {
    staff.wage = wageOf(b, staff, p);
    const due = Math.round(staff.wage * part) + (staff.owed ?? 0);
    wages += Math.round(staff.wage * part);
    const now = Math.max(0, Math.min(due, b.till));
    b.till -= now;
    paid += now;
    staff.owed = due - now;
    if (now && staff.source === 'pc' && staff.actorId) pay[staff.actorId] = (pay[staff.actorId] ?? 0) + now;
  }
  if (paid) addLedger(b, { day, kind: 'wages', amount: -paid }, p);
  return { wages, paid, owed: activeStaff(b).reduce((a, s) => a + (s.owed ?? 0), 0), pay };
}

/** Read every employee's bases again from their sheet (a recruit has no sheet). */
export function refreshStaffBases(b, basesOf, p = BUSINESS_DEFAULTS) {
  let changed = false;
  for (const staff of b.staff ?? []) {
    if (!staff.actorId) continue;
    const bases = basesOf(staff.actorId);
    if (!bases || JSON.stringify(bases) === JSON.stringify(staff.bases)) continue;
    staff.bases = bases;
    staff.wage = wageOf(b, staff, p);
    changed = true;
  }
  return changed;
}

