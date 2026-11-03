/**
 * Player businesses: employees
 * @file scripts/engine/businessStaff.js
 * @description Employees (DESIGN §32, E1): characters, player or NPC, and recruits found on the street,
 *              working in a business's posts for a wage. Their skills, read from the post they hold,
 *              lift what the business earns each week; a manager works the shop and security answers
 *              trouble when no partner does; a partner can call an employee in to make one of the
 *              business's rolls for overtime pay. Pure; no Foundry globals.
 *
 * An employee: `{ id, actorId, name, source, post, bases, pct, wage, hiredDay, status, owed, loyalty, ... }`.
 *   source   'pc' (a player character), 'npc' (an NPC actor) or 'recruit' (found with a recruiting roll; no actor)
 *   bases    their base by use key (`skill:Business`, `ability:Maker` holds the rank), read by the GM's
 *            service from the character's sheet and refreshed each week; a recruit's is set at hiring
 *   pct      the share of the going rate the partners offered; `wage` is what that comes to now
 *   status   'offered' (waiting for the character, or the GM for an NPC) or 'active'
 *   owed     wages the cash could not cover, paid first the next week
 *   loyalty  0 to 100 for an NPC or a recruit (E2, businessPeople.js); null for a player character
 *   candidateId  the applicant a recruit was; their hidden trait is kept under it (see traitOf)
 *   revealed a trait the partners know of (vetting, or a thief caught), or 'none' when vetted clean
 */

import { createRng } from './rng.js';
import { cprD10 } from './checks.js';
import { bandOf } from './rolls.js';
import { BUSINESS_DEFAULTS, POSTS, SKILLS, ABILITIES, EVENTS, useKey, stageDv } from './businessConfig.js';
import { archetypeOf, fail, int, addLedger, partnerOf } from './businessRecord.js';
import { exposureBand } from './businessCompany.js';
import { payOffCost } from './businessFronts.js';
import { hasIllegalStock, hasWorkshop, produceCheck } from './businessProduction.js';

/** Every use an employee's sheet is read for: each skill and role ability a business roll names. */
export const STAFF_USES = Object.freeze([...Object.values(SKILLS), ...Object.values(ABILITIES)]);

/** A base as a level: green, skilled, expert or master. */
export function levelOf(base, p = BUSINESS_DEFAULTS) {
  return p.staff.levels.find(([upTo]) => base <= upTo)[1];
}

export const activeStaff = (b) => (b.staff ?? []).filter((s) => s.status === 'active');
export const staffOf = (b, id) => (b.staff ?? []).find((s) => s.id === id) ?? null;

// ── Loyalty and traits (E2) ──────────────────────────────────────────────────

/** Whether an employee has loyalty: NPCs and recruits do; a player character's is the player's. */
export const hasLoyalty = (staff) => staff.source !== 'pc';

/** An employee's hidden trait, from the GM's hidden state (`traits` maps applicant or employee id to a trait). */
export const traitOf = (traits, staff) => traits?.[staff.candidateId ?? staff.id] ?? null;

/** Loyalty as a band the partners see: sullen, steady, loyal or devoted. */
export function loyaltyBand(loyalty, p = BUSINESS_DEFAULTS) {
  return p.staff.loyalty.bands.find(([upTo]) => loyalty <= upTo)[1];
}

/** Move an employee's loyalty, within 0 to 100 (a dedicated employee never below their floor). */
export function moveLoyalty(staff, by, traits = null, p = BUSINESS_DEFAULTS) {
  // An Exec's team answer to their own Loyalty (`care`, businessPeople.js) instead.
  if (!hasLoyalty(staff) || !by || staff.source === 'team') return;
  // Dedicated staff stay at 40 or above; shares vesting keep anyone at 50 or above (E3).
  const floor = Math.max(traitOf(traits, staff) === 'dedicated' ? p.staff.loyalty.dedicatedFloor : 0, staff.grant ? p.staff.grants.floor : 0);
  staff.loyalty = Math.max(floor, Math.min(loyaltyCap(staff, p), Math.round((staff.loyalty ?? p.staff.loyalty.start) + by)));
}

/** The most loyalty an employee can have: below devoted while they hold a second job (E3). */
export const loyaltyCap = (staff, p = BUSINESS_DEFAULTS) => (staff.elsewhere ? p.staff.loyalty.devoted - 1 : 100);

/**
 * Note on each NPC employee the other business they also work for, if any, and the overtime shifts
 * they have worked there this week (E3, DESIGN §32.5); the GM's service does this before every change,
 * from every open business. A recruit only ever works for one business, and a player character's
 * second job is their own affair. Returns whether anything changed.
 * @param {object[]} others - every business (this one is skipped)
 */
export function markElsewhere(b, others, p = BUSINESS_DEFAULTS) {
  let changed = false;
  for (const s of b.staff ?? []) {
    let where = null;
    if (s.source === 'npc' && s.actorId && s.status === 'active') {
      for (const o of others) {
        if (o.id === b.id || o.status !== 'open') continue;
        const there = (o.staff ?? []).find((x) => x.actorId === s.actorId && x.status === 'active');
        if (there) {
          where = { businessId: o.id, name: o.name, shifts: o.period?.overtime?.[there.id] ?? 0 };
          break;
        }
      }
    }
    if (JSON.stringify(where) !== JSON.stringify(s.elsewhere ?? null)) {
      if (where) s.elsewhere = where;
      else delete s.elsewhere;
      if (where && s.loyalty != null) s.loyalty = Math.min(s.loyalty, loyaltyCap(s, p));
      changed = true;
    }
  }
  return changed;
}

/** Loyalty to start with: more for pay above the going rate, less below it. */
export const startLoyalty = (pct, p = BUSINESS_DEFAULTS) => Math.round(p.staff.loyalty.start + ((pct - 1) / 0.1) * p.staff.loyalty.perTen);

export const devoted = (staff, p = BUSINESS_DEFAULTS) => hasLoyalty(staff) && (staff.loyalty ?? 0) >= p.staff.loyalty.devoted;

/**
 * Whether a member of an Exec's team fails their Loyalty save this week: 1d6 under their Loyalty, the rulebook's save.
 * Drawn from the business and the week, as a moonlighter's week is, so both clients agree and a better Loyalty can
 * still bring them round. Those who fail neither take a task nor do their post's work.
 */
export function teamRefuses(b, staff) {
  if (staff.source !== 'team') return false;
  return createRng('nci', 'teamSave', b.id, b.period?.index ?? 0, staff.id).int(1, 6) >= (staff.care ?? 0);
}

/** Whether a team member's Exec gave them this week off. */
export const onTimeOff = (b, staff) => staff.source === 'team' && staff.careWeek?.week === b.period?.index && staff.careWeek.done.includes('timeOff');

/** Whether a moonlighter has other work this week, drawn from the business and the week. */
export function moonlighting(b, staff, traits, p = BUSINESS_DEFAULTS) {
  if (traitOf(traits, staff) !== 'moonlighter') return false;
  return createRng('nci', 'moonlight', b.id, b.period?.index ?? 0, staff.id).chance(p.staff.traits.moonlighting);
}

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

/**
 * An employee's base in one use, for a roll: stat + skill, or a role ability's rank, and what training
 * has added to a skill (E3; kept apart from `bases`, which an NPC's sheet refreshes every week).
 */
export function staffBase(staff, use, p = BUSINESS_DEFAULTS) {
  const key = useKey(use);
  const stored = staff.bases?.[key];
  if (use.kind === 'ability') return stored != null ? int(stored) : 0;
  return (stored != null ? int(stored) : p.staff.recruitOther) + int(staff.training?.[key] ?? 0);
}

/**
 * An employee's best for a post: the use that counts most and what it comes to. A role ability counts
 * as its rank plus `abilityBonus` (a level above that rank as a skill); one they lack does not count.
 * @returns {{base: number, use: object|null, adj: number}} `adj` is what a skill a level lower took off
 */
export function postBest(staff, post, arch, p = BUSINESS_DEFAULTS) {
  let best = { base: 0, use: null, adj: 0 };
  for (const { use, adj } of postUses(post, arch, p)) {
    const own = staffBase(staff, use, p);
    const base = use.kind === 'ability' ? (own > 0 ? own + p.staff.abilityBonus + adj : 0) : own + adj;
    if (base > best.base) best = { base, use, adj };
  }
  return best;
}

/** An employee's base for a post: their best base among what counts for it (see postBest). */
export const postBase = (staff, post, arch, p = BUSINESS_DEFAULTS) => postBest(staff, post, arch, p).base;

/** The going weekly wage for a base at a stage: a rate per point, and more for each point a Master has above Expert. */
export function goingRate(base, stage, p = BUSINESS_DEFAULTS) {
  const st = p.staff;
  return Math.round((base + st.premium * Math.max(0, base - st.premiumFrom)) * (st.rate[stage] ?? st.rate.at(-1)));
}

/** The going weekly wage for a base in a post: what the back room's posts pay on top. */
export const postRate = (post, base, stage, p = BUSINESS_DEFAULTS) => Math.round(goingRate(base, stage, p) * (POSTS[post]?.rate ?? 1));

/** What an employee is paid now: the going rate for their post's base, times the share offered. */
export function wageOf(b, staff, p = BUSINESS_DEFAULTS) {
  // An Exec's team takes no wage (E3).
  if (staff.source === 'team') return 0;
  return Math.round(postRate(staff.post, postBase(staff, staff.post, archetypeOf(b), p), b.stage, p) * (staff.pct ?? 1));
}

/** How many employees the business may have: the stage's headcount, and a place more for each staff room. */
export const headcountOf = (b, p = BUSINESS_DEFAULTS) => (p.staff.headcount[b.stage] ?? 0) + (b.upgrades?.staffRoom?.length ?? 0) * p.projects.staffRoom.headcount;

/** How many floor staff the business has room for: its Capacity, rounded down, and at least one. */
export const floorRoom = (b) => Math.max(1, Math.floor(b.state.capacity));

/** Whether this business has a use for a post: the back room's need a room, but for a company's fixer. */
export function postOffered(b, post) {
  if (post === 'maker') return hasWorkshop(b);
  if (!POSTS[post]?.backRoom) return true;
  return (post === 'fixer' && b.stage >= 2) || b.backRoom?.status === 'open';
}

/**
 * Whether another employee could take this post (offers waiting count as places taken). With
 * `exceptId`, whether that employee could move to it from their own post.
 */
export function postOpen(b, post, p = BUSINESS_DEFAULTS, exceptId = null) {
  const def = POSTS[post];
  if (!def) return fail('bad-post');
  if (b.stage < def.stage) return fail('post-later');
  if (!postOffered(b, post)) return fail('no-back-room');
  const staff = (b.staff ?? []).filter((s) => (s.status === 'active' || s.status === 'offered') && s.id !== exceptId);
  if (!exceptId && staff.length >= headcountOf(b, p)) return fail('no-headcount');
  if (post === 'manager' && staff.some((s) => s.post === 'manager')) return fail('post-taken');
  if (post === 'floor' && staff.filter((s) => s.post === 'floor').length >= floorRoom(b)) return fail('no-floor-room');
  return { ok: true };
}

// ── Recruiting ───────────────────────────────────────────────────────────────

/** Whether a job can be advertised now, for a post, and the roll's DV, skills and cost. */
export function recruitCheck(b, post, day, p = BUSINESS_DEFAULTS) {
  const r = p.staff.recruit;
  const open = postOpen(b, post, p);
  if (!open.ok) return open;
  if (b.lastRecruit != null && day < b.lastRecruit + r.cooldown) return fail('recruit-delay');
  const cost = r.cost[b.stage] ?? r.cost.at(-1);
  if (b.till < cost) return fail('no-funds');
  return { ok: true, dv: stageDv(b.stage, p), uses: [...r.uses], cost };
}

/**
 * Record an advert for a post: the cost is spent, and the applicants the band brings are drawn from
 * the seed and the request, each with their own base in the post's skills, the wage they ask (a
 * share of the going rate) and perhaps a hidden trait. They replace any applicants still waiting for
 * that post. A fumble brings nobody. The traits are not put on the record: the GM's service keeps
 * them in its hidden state.
 * @returns {{applicants: object[], traits: object}} `traits` maps applicant id to trait
 */
export function applyRecruit(b, { result, day, post, key, seed = 'nci', by }, p = BUSINESS_DEFAULTS) {
  const r = p.staff.recruit;
  const cost = r.cost[b.stage] ?? r.cost.at(-1);
  b.till -= cost;
  b.lastRecruit = day;
  addLedger(b, { day, kind: 'recruit', amount: -cost, actorId: by }, p);
  b.candidates = (b.candidates ?? []).filter((c) => c.expires >= day && c.post !== post);
  const count = r.count[result.band];
  if (!count) return { applicants: [], traits: {} };
  const rng = createRng(seed, 'recruit', b.id, key);
  const pick = ([lo, hi]) => rng.int(lo, hi);
  const applicants = Array.from({ length: pick(count) }, (_, i) => {
    const [lo, hi] = r.ask[result.band];
    const base = pick(r.base[result.band]);
    return {
      id: `${key}-${i + 1}`,
      name: `${r.firstNames[rng.int(0, r.firstNames.length - 1)]} ${r.lastNames[rng.int(0, r.lastNames.length - 1)]}`,
      post,
      level: levelOf(base, p),
      base,
      // What they ask, to the nearest 5% of the going rate.
      pct: Math.round((lo + rng.next() * (hi - lo)) * 20) / 20,
      expires: day + r.candidateDays,
    };
  });
  b.candidates = [...b.candidates, ...applicants];
  const traits = {};
  for (const a of applicants) {
    // Someone may answer the advert to get a look at the back room (U1b).
    const trait = b.backRoom?.status === 'open' && rng.chance(p.backRoom.informant.applicant) ? 'informant' : drawTrait(rng, result.band, b.stage, p);
    if (trait) traits[a.id] = trait;
  }
  return { applicants, traits };
}

/** A hidden trait for an applicant, or none. A corp plant only turns up at a company. */
function drawTrait(rng, band, stage, p = BUSINESS_DEFAULTS) {
  const t = p.staff.traits;
  if (!rng.chance(band === 'failure' ? t.failureChance : t.chance)) return null;
  const trait = rng.weighted({ ...t.weights });
  return trait === 'corpPlant' && stage < 2 ? 'looseLips' : trait;
}

/** What an applicant asks a week here: the going rate for their base, times their share. */
export const askingWage = (b, candidate, p = BUSINESS_DEFAULTS) => Math.round(postRate(candidate.post, candidate.base, b.stage, p) * (candidate.pct ?? 1));

// ── Hiring, accepting, firing ────────────────────────────────────────────────

/**
 * Whether a hire can be proposed, and its terms: an applicant to an advert, on what they asked, or a
 * character (a player character, or an NPC linked to a Messenger contact tagged staff or employee), for
 * a post at a share of the going rate (`pct`, as a percentage).
 * @param {object} ctx - `staffActors` maps the characters that may be hired to 'pc' or 'npc'; `staffNames` their names
 */
export function hireOffer(b, request, ctx, day, p = BUSINESS_DEFAULTS) {
  // An applicant is hired on what they asked.
  if (request.candidateId) {
    const candidate = (b.candidates ?? []).find((c) => c.id === request.candidateId && c.expires >= day);
    if (!candidate) return fail('no-candidate');
    const open = postOpen(b, candidate.post, p);
    if (!open.ok) return open;
    return { ok: true, terms: { candidateId: candidate.id, name: candidate.name, post: candidate.post, pct: candidate.pct ?? 1 } };
  }
  const pct = Math.round(Number(request.pct ?? 100)) / 100;
  if (!(pct >= p.staff.offer.min && pct <= p.staff.offer.max)) return fail('bad-wage');
  const actorId = String(request.actorId ?? '');
  const source = ctx.staffActors?.[actorId];
  if (!source) return fail('not-staff');
  if (partnerOf(b, actorId) && ['active', 'leaving', 'invited'].includes(partnerOf(b, actorId).status)) return fail('is-partner');
  if ((b.staff ?? []).some((s) => s.actorId === actorId)) return fail('already-staff');
  const open = postOpen(b, request.post, p);
  if (!open.ok) return open;
  return { ok: true, terms: { actorId, name: ctx.staffNames?.[actorId] ?? ctx.actors?.[actorId] ?? actorId, source, post: request.post, pct } };
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
    staff = {
      id: `stf_${candidate.id}`, actorId: null, name: candidate.name, source: 'recruit', post, bases, pct: terms.pct, hiredDay: day, status: 'active', owed: 0,
      // They asked for what they are paid, so they start level.
      loyalty: p.staff.loyalty.start, candidateId: candidate.id, ...(candidate.revealed ? { revealed: candidate.revealed } : {}),
    };
    b.candidates = b.candidates.filter((c) => c !== candidate);
  } else {
    staff = {
      id: `stf_${terms.actorId}`, actorId: terms.actorId, name: terms.name, source: terms.source, post,
      bases: ctx.basesOf?.(terms.actorId) ?? {}, pct: terms.pct, hiredDay: null, status: 'offered', owed: 0,
      loyalty: terms.source === 'pc' ? null : startLoyalty(terms.pct, p),
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
 * owed) from the cash, as far as it goes; a player character's goes to their eddies. A thief who was
 * caught gets no severance. A sullen employee may come back to make trouble (a grudge, next week),
 * and a corp plant takes what they know with them (Exposure).
 * @returns {{ok: true, paid: number, actorId: string|null, exposure: number}}
 */
export function enactFire(b, staffId, day, p = BUSINESS_DEFAULTS, { traits = null, seed = 'nci' } = {}) {
  const staff = staffOf(b, staffId);
  if (!staff) return fail('not-staff');
  const severance = staff.status === 'active' && !staff.caught ? wageOf(b, staff, p) * p.staff.severanceWeeks : 0;
  const due = severance + (staff.status === 'active' ? staff.owed ?? 0 : 0);
  const paid = Math.max(0, Math.min(due, b.till));
  b.till -= paid;
  b.staff = b.staff.filter((s) => s !== staff);
  if (staff.source === 'team') b.teamLost = { ...(b.teamLost ?? {}), [staff.leader]: (b.teamLost?.[staff.leader] ?? 0) + 1 };
  addLedger(b, { day, kind: 'fired', amount: -paid, staffName: staff.name }, p);
  if (staff.status === 'active' && hasLoyalty(staff) && staff.loyalty < p.staff.loyalty.quitBelow
    && createRng(seed, 'grudge', b.id, staff.id, day).chance(p.staff.events.grudge)) b.grudge = true;
  const exposure = ['corpPlant', 'informant'].includes(traitOf(traits, staff)) ? p.staff.traits.plantFired : 0;
  return { ok: true, paid, actorId: staff.source === 'pc' ? staff.actorId : null, exposure };
}

// ── Overtime ─────────────────────────────────────────────────────────────────

/** Overtime for one call: a share of the employee's weekly wage. */
export function overtimePay(b, staff, kind, p = BUSINESS_DEFAULTS) {
  // An Exec's team member is paid overtime as if on the going rate for their skill (E3).
  const wage = staff.source === 'team' ? postRate(staff.post, postBase(staff, staff.post, archetypeOf(b), p), b.stage, p) : wageOf(b, staff, p);
  return Math.round(wage * (p.staff.overtime[kind] ?? p.staff.overtime.roll));
}

/** Overtime shifts an employee has worked this week. */
export const shiftsOf = (b, staffId) => b.period?.overtime?.[staffId] ?? 0;

/**
 * An employee called in for a roll: whether they can be, and the use they roll with, their best for
 * this roll (an alternative skill's DV step counted against it), with its base.
 * @returns {{ok: true, use: object, dvAdd: number, cost: number} | {ok: false, reason: string}}
 */
export function staffRoll(b, use, uses, kind, funds, p = BUSINESS_DEFAULTS, traits = null) {
  const staff = staffOf(b, use.staffId);
  if (staff?.status !== 'active') return fail('not-staff');
  if (shiftsOf(b, staff.id) >= p.staff.maxShifts) return fail('no-shifts');
  // Two jobs: a person's shifts are shared across every employer (E3).
  if (shiftsOf(b, staff.id) + (staff.elsewhere?.shifts ?? 0) >= p.staff.maxShifts) return fail('shifts-elsewhere');
  if (moonlighting(b, staff, traits, p)) return fail('moonlighting');
  // A team member's save is drawn for the week, so a refusal is known before any dice roll (B7a).
  if (teamRefuses(b, staff)) return fail('team-refused');
  if (onTimeOff(b, staff)) return fail('team-off');
  const cost = overtimePay(b, staff, kind, p);
  if (funds < cost) return fail('no-funds');
  const best = uses
    .map((u) => ({ u, base: staffBase(staff, u, p), dvAdd: u.dvAdd ?? 0 }))
    .filter((x) => x.u.kind !== 'ability' || x.base > 0)
    .sort((a, c) => (c.base - c.dvAdd) - (a.base - a.dvAdd))[0];
  if (!best) return fail('bad-use');
  // A devoted employee puts in that bit more (E2).
  const base = best.base + (devoted(staff, p) ? 1 : 0);
  return { ok: true, use: { kind: 'staff', staffId: staff.id, via: useKey(best.u), base }, dvAdd: best.dvAdd, cost };
}

/**
 * Pay an employee's overtime from the cash and count the shift. A player character's goes to their
 * eddies. A second shift in a week wears on loyalty.
 */
export function payOvertime(b, staffId, kind, day, by, p = BUSINESS_DEFAULTS, traits = null) {
  const staff = staffOf(b, staffId);
  const cost = overtimePay(b, staff, kind, p);
  b.till -= cost;
  if (shiftsOf(b, staffId) >= 1) moveLoyalty(staff, p.staff.loyalty.extraShift, traits, p);
  b.period.overtime = { ...(b.period.overtime ?? {}), [staffId]: shiftsOf(b, staffId) + 1 };
  addLedger(b, { day, kind: 'overtime', amount: -cost, actorId: by, staffName: staff.name }, p);
  // A player character's overtime is paid with the week's wage, on their payslip (E3).
  if (staff.source === 'pc' && staff.actorId) b.period.pcOvertime = { ...(b.period.pcOvertime ?? {}), [staff.actorId]: (b.period.pcOvertime?.[staff.actorId] ?? 0) + cost };
  return { cost, actorId: null };
}

// ── The week ─────────────────────────────────────────────────────────────────

const BANDS = ['fumble', 'failure', 'narrow', 'solid', 'strong', 'exceptional'];

/**
 * Roll a check for an employee, from the seed: the week's draw, as an event is, not a player's roll.
 * `better` lifts the result a band (a devoted employee answering trouble).
 */
function autoRoll(b, staff, base, dv, seed, what, better = false) {
  const rng = createRng(seed, 'staff', b.id, b.period.index, staff.id, what);
  const roll = cprD10(() => rng.int(1, 10));
  const total = base + roll.total;
  const band = bandOf(total - dv, roll.crit);
  return { band: better ? BANDS[Math.min(BANDS.length - 1, BANDS.indexOf(band) + 1)] : band, total, dv };
}

/** Staff at work this week: active, and not off sick, injured or downing tools (`idle`). */
const working = (b, idle) => activeStaff(b).filter((s) => !idle?.has(s.id));

/** A post's base for the week's own work: a connected manager or salesperson counts higher, unseen. */
function workBase(staff, post, arch, traits, p) {
  const connected = (post === 'manager' || post === 'sales') && traitOf(traits, staff) === 'connected' ? p.staff.traits.connected : 0;
  return postBase(staff, post, arch, p) + connected;
}

/**
 * Before a week closes: what the staff did without a partner. A manager works the shop (or chases
 * contracts, at a company) when no partner did; security answers a security event, and a compliance
 * officer an inspection, that nobody answered; the back room's posts do its work, unless the business is
 * lying low. Each is a slot of its own, marked `staff`.
 * @param {object} [o]
 * @param {number|null} [o.exposure] - the GM's hidden Exposure: a fixer only acts when it has run up
 */
export function staffShifts(b, seed = 'nci', p = BUSINESS_DEFAULTS, { idle = null, traits = null, exposure = null } = {}) {
  const arch = archetypeOf(b);
  const staff = working(b, idle);
  const slots = b.period.slots;
  const dv = stageDv(b.stage, p);
  const manager = staff.find((s) => s.post === 'manager');
  const worked = b.stage >= 2 ? slots.some((s) => s.action === 'contracts' || s.action === 'shortcuts') : slots.some((s) => s.action === 'work');
  if (manager && !worked) {
    const action = b.stage >= 2 ? 'contracts' : 'work';
    slots.push({ action, by: manager.id, staff: true, approach: 'standard', bonus: 0, ...autoRoll(b, manager, workBase(manager, 'manager', arch, traits, p), dv, seed, action) });
  }
  // A maker runs the line in a week nobody did (P1a), at the book's DV for the item.
  const maker = staff.find((s) => s.post === 'maker');
  const run = maker && !slots.some((s) => s.action === 'produce') ? produceCheck(b, p) : null;
  if (run?.ok) slots.push({ action: 'produce', by: maker.id, staff: true, approach: 'standard', bonus: 0, ...autoRoll(b, maker, workBase(maker, 'maker', arch, traits, p), run.dv, seed, 'produce') });
  // The back room's posts, each doing what nobody else did (U1b).
  const shift = (who, post, action) => slots.push({ action, by: who.id, staff: true, approach: 'standard', bonus: 0, ...autoRoll(b, who, workBase(who, post, arch, traits, p), dv, seed, action) });
  const taken = (action) => slots.some((s) => s.action === action);
  const room = b.backRoom?.status === 'open' ? b.backRoom : null;
  if (!taken('lieLow')) {
    const hand = staff.find((s) => s.post === 'hand');
    if (hand && room && !taken('roomWork')) shift(hand, 'hand', 'roomWork');
    // The Hand moves illegal goods too, on top of the room's work; legal stock is for a partner to decide (P1c).
    if (hand && room && !taken('fence') && hasIllegalStock(b)) shift(hand, 'hand', 'fence');
    const launderer = staff.find((s) => s.post === 'launderer');
    if (launderer && room && !taken('launder') && (room.dirty > 0 || taken('roomWork'))) shift(launderer, 'launderer', 'launder');
    const fixer = staff.find((s) => s.post === 'fixer');
    if (fixer && exposure != null && ['moderate', 'high'].includes(exposureBand(exposure, p))) {
      if (room && !taken('payOff') && room.dirty >= payOffCost(b, p)) shift(fixer, 'fixer', 'payOff');
      else if (b.stage >= 2 && !taken('bribeRegulator') && b.till - p.crime.bribeCost >= p.crime.fixerFloor) shift(fixer, 'fixer', 'bribeRegulator');
    }
  }
  const event = b.period.event;
  const def = event ? EVENTS[event.kind] : null;
  if (def && !def.good && !def.staff && !slots.some((s) => s.action === 'respond')) {
    const post = event.kind === 'inspection' ? 'compliance' : def.security || event.kind === 'trouble' ? 'security' : null;
    const who = post ? staff.find((s) => s.post === post) : null;
    if (who) {
      const roll = autoRoll(b, who, postBase(who, post, arch, p), dv, seed, 'respond', devoted(who, p));
      slots.push({ action: 'respond', event: event.kind, by: who.id, staff: true, approach: 'standard', bonus: 0, ...roll });
    }
  }
}

/**
 * What the staff do to the week: the lift to the takings from floor and sales staff (capped by stage),
 * and the drift a bookkeeper, publicist, compliance officer and salesperson bring.
 * @returns {{lift: number, reputationTarget: number|null}}
 */
export function staffWeek(b, growthRate = 1, p = BUSINESS_DEFAULTS, { idle = null, traits = null } = {}) {
  const st = p.staff;
  const arch = archetypeOf(b);
  const staff = working(b, idle);
  const each = (post) => staff.filter((s) => s.post === post).map((s) => ({ s, base: workBase(s, post, arch, traits, p) }));
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
    // An Exec's team member's skill follows the Exec's rank, not their own sheet (E3).
    if (!staff.actorId || staff.source === 'team') continue;
    const bases = basesOf(staff.actorId);
    if (!bases || JSON.stringify(bases) === JSON.stringify(staff.bases)) continue;
    staff.bases = bases;
    staff.wage = wageOf(b, staff, p);
    changed = true;
  }
  return changed;
}

