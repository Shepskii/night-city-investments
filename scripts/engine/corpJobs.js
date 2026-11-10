/**
 * Jobs at a market corporation (N4, DESIGN §36.17)
 * @file scripts/engine/corpJobs.js
 * @description A small employer record tied to a market company. It has no cash and no business behind it: the GM sets
 *              its kind, which gives each post its skills, and each role's wage and headcount. Applications and the
 *              shift follow the NPC companies' rules (N2, N3); the wage comes from outside the game's economy, so a
 *              week's close pays it and moves standing, and nothing else. Pure.
 */

import { ARCHETYPES, BUSINESS_DEFAULTS, POSTS } from './businessConfig.js';
import { clamp, fail } from './businessRecord.js';
import { postUses } from './businessStaff.js';
import { bossBand, judgeWeek, shiftedIn, standingOf } from './businessJobs.js';

export const EMPLOYER_PREFIX = 'emp_';
export const isEmployerId = (id) => typeof id === 'string' && id.startsWith(EMPLOYER_PREFIX);

const WEEK = 7;
const int = (n, d = 0) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : d);

/** Each role the GM opened: how many, and the week's wage. Unknown posts and empty roles are dropped. */
function cleanRoles(roles, p) {
  const c = p.npc.corp;
  return Object.fromEntries(Object.entries(roles ?? {})
    .filter(([post]) => c.posts.includes(post))
    .map(([post, r]) => [post, { count: clamp(int(r?.count), 0, c.maxCount), wage: clamp(int(r?.wage), 0, c.maxWage) }])
    .filter(([, r]) => r.count > 0 && r.wage > 0));
}

function cleanStaff(s) {
  return {
    id: String(s.id), actorId: String(s.actorId), name: String(s.name ?? ''), post: String(s.post),
    status: s.status === 'offered' ? 'offered' : 'active',
    base: int(s.base), pct: Number(s.pct) || 1, wage: int(s.wage),
    ...(s.hiredDay != null ? { hiredDay: int(s.hiredDay) } : {}),
    ...(s.standing != null ? { standing: Number(s.standing) } : {}),
    ...(s.warned ? { warned: true } : {}),
    ...(s.promotion ? { promotion: true } : {}),
    ...(s.promotedDay != null ? { promotedDay: int(s.promotedDay) } : {}),
    ...(s.promotions ? { promotions: int(s.promotions) } : {}),
  };
}

/** An employer record as stored, whatever was read. */
export function normalizeEmployer(e, p = BUSINESS_DEFAULTS) {
  return {
    id: String(e.id), companyId: String(e.companyId ?? ''), name: String(e.name ?? ''), ticker: String(e.ticker ?? ''),
    archetype: ARCHETYPES[e.archetype] ? e.archetype : 'security',
    dv: clamp(int(e.dv, p.npc.corp.dv), 9, 30),
    location: String(e.location ?? ''),
    open: e.open !== false,
    roles: cleanRoles(e.roles, p),
    staff: (e.staff ?? []).filter((s) => s?.id && s.actorId && POSTS[s.post]).map(cleanStaff),
    applications: (e.applications ?? []).filter((a) => a?.id && a.actorId),
    jobTries: { ...(e.jobTries ?? {}) },
    period: { startDay: int(e.period?.startDay), endDay: int(e.period?.endDay, int(e.period?.startDay) + WEEK), shifts: { ...(e.period?.shifts ?? {}) } },
    createdDay: int(e.createdDay),
  };
}

/** A new employer for a market company. @returns {{ok: true, employer: object}|{ok: false, reason: string}} */
export function createEmployer({ id, companyId, name, ticker, archetype, dv, location = '', roles, day }, p = BUSINESS_DEFAULTS) {
  if (!companyId) return fail('no-company');
  if (!ARCHETYPES[archetype]) return fail('bad-archetype');
  const employer = normalizeEmployer({ id, companyId, name, ticker, archetype, dv, location, roles, period: { startDay: day, endDay: day + WEEK }, createdDay: day }, p);
  if (!Object.keys(employer.roles).length) return fail('no-roles');
  return { ok: true, employer };
}

const wageOf = (staff) => Math.round(staff.base * staff.pct);

/** The GM changes the kind, DV, place, roles or whether it's hiring. A role's new wage reaches those in it at once. */
export function updateEmployer(e, { archetype, dv, location, roles, open }, p = BUSINESS_DEFAULTS) {
  if (archetype != null) {
    if (!ARCHETYPES[archetype]) return fail('bad-archetype');
    e.archetype = archetype;
  }
  if (dv != null) e.dv = clamp(int(dv, e.dv), 9, 30);
  if (location != null) e.location = String(location);
  if (open != null) e.open = !!open;
  if (roles) {
    e.roles = cleanRoles(roles, p);
    for (const s of e.staff) {
      if (!e.roles[s.post]) continue;
      s.base = e.roles[s.post].wage;
      s.wage = wageOf(s);
    }
  }
  return { ok: true, employer: e };
}

const taken = (e, post) => e.staff.filter((s) => s.post === post).length;

/** The skills a post here is worked and applied for with: its own, from the kind the GM gave the corporation. */
export const employerUses = (e, post, p = BUSINESS_DEFAULTS) => postUses(post, ARCHETYPES[e.archetype], p).filter((u) => u.adj === 0).map((u) => u.use);

/** The roles with a place free. */
export function employerRoles(e, p = BUSINESS_DEFAULTS) {
  if (!e.open) return [];
  return Object.entries(e.roles).filter(([post, r]) => taken(e, post) < r.count)
    .map(([post, r]) => ({ post, wage: r.wage, uses: employerUses(e, post, p) })).filter((r) => r.uses.length);
}

/** What the job board shows of it, in the shape of an NPC company's entry. */
export function employerBoardEntry(e, p = BUSINESS_DEFAULTS) {
  const roles = employerRoles(e, p);
  return roles.length ? { businessId: e.id, name: e.name, ticker: e.ticker, archetype: e.archetype, stage: 2, owner: '', location: e.location, dv: e.dv, roles } : null;
}

/** Whether this character may apply for this role now. */
export function canApplyEmployer(e, actorId, post, day, p = BUSINESS_DEFAULTS) {
  if (!e.open) return fail('job-closed');
  if (e.staff.some((s) => s.actorId === actorId)) return fail('already-staff');
  if (e.applications.some((a) => a.actorId === actorId)) return fail('job-waiting');
  if (e.jobTries[actorId] != null && day - e.jobTries[actorId] < p.npc.jobs.waitDays) return fail('job-wait');
  if (!employerRoles(e, p).some((r) => r.post === post)) return fail('job-closed');
  return { ok: true };
}

function addStaff(e, { id, actorId, name, post, status, pct, day }) {
  const staff = cleanStaff({ id, actorId, name, post, status, base: e.roles[post].wage, pct, ...(status === 'active' ? { hiredDay: day } : {}) });
  staff.wage = wageOf(staff);
  e.staff.push(staff);
  return staff;
}

/** The GM's answer to an application: hired, they start at once, a better roll on a better wage. */
export function decideEmployerApplication(e, id, yes, day, p = BUSINESS_DEFAULTS) {
  const application = e.applications.find((a) => a.id === id);
  if (!application) return fail('no-application');
  e.applications = e.applications.filter((a) => a !== application);
  if (!yes) return { ok: true, hired: false, application };
  if (!e.roles[application.post] || taken(e, application.post) >= e.roles[application.post].count) return fail('post-full');
  const staff = addStaff(e, { id: `stf_${application.actorId}`, actorId: application.actorId, name: application.name, post: application.post, status: 'active', pct: p.npc.jobs.pct[application.band] ?? 1, day });
  return { ok: true, hired: true, application, staff };
}

/** The GM offers a character a role, at its wage; they accept or turn it down from Your jobs. */
export function offerEmployerJob(e, { actorId, name, post }, day) {
  if (e.staff.some((s) => s.actorId === actorId)) return fail('already-staff');
  if (!e.roles[post]) return fail('job-closed');
  if (taken(e, post) >= e.roles[post].count) return fail('post-full');
  e.applications = e.applications.filter((a) => a.actorId !== actorId);
  return { ok: true, staff: addStaff(e, { id: `stf_${actorId}`, actorId, name, post, status: 'offered', pct: 1, day }) };
}

/** The character's answer to an offer, or their notice. Quitting is at once, with nothing owed either way. */
export function answerEmployer(e, actorId, type, day) {
  const staff = e.staff.find((s) => s.actorId === actorId);
  if (!staff) return fail('not-staff');
  if (type === 'acceptJob') {
    if (staff.status !== 'offered') return fail('not-offered');
    staff.status = 'active';
    staff.hiredDay = day;
    return { ok: true, staff };
  }
  if (type === 'declineJob' && staff.status !== 'offered') return fail('not-offered');
  e.staff = e.staff.filter((s) => s !== staff);
  return { ok: true, staff };
}

/** The GM lets someone go: a week's pay. */
export function dismissEmployee(e, staffId) {
  const staff = e.staff.find((s) => s.id === staffId);
  if (!staff) return fail('not-staff');
  e.staff = e.staff.filter((s) => s !== staff);
  return { ok: true, staff, paid: staff.status === 'active' ? staff.wage : 0 };
}

/** Whether this character can work a shift here this week. */
export function canShiftEmployer(e, actorId) {
  const staff = e.staff.find((s) => s.actorId === actorId && s.status === 'active');
  if (!staff) return fail('not-staff');
  if (e.period.shifts[actorId]) return fail('shift-done');
  return { ok: true, staff };
}

export function workEmployerShift(e, actorId, band) {
  const can = canShiftEmployer(e, actorId);
  if (!can.ok) return can;
  e.period.shifts = { ...e.period.shifts, [actorId]: band };
  return { ok: true };
}

/** What a promotion would pay: 10% more. Nothing caps it; the GM set the wage. */
export const promotedEmployerWage = (staff, p = BUSINESS_DEFAULTS) => Math.round(staff.base * (Math.round((staff.pct + p.npc.shift.raise) * 100) / 100));

export function decideEmployerPromotion(e, staffId, yes, day, p = BUSINESS_DEFAULTS) {
  const staff = e.staff.find((s) => s.id === staffId && s.status === 'active');
  if (!staff?.promotion) return fail('no-promotion');
  delete staff.promotion;
  staff.promotedDay = day;
  if (yes) {
    staff.pct = Math.round((staff.pct + p.npc.shift.raise) * 100) / 100;
    staff.promotions = (staff.promotions ?? 0) + 1;
    staff.standing = p.npc.shift.afterPromotion;
    staff.wage = wageOf(staff);
  }
  return { ok: true, staff };
}

/**
 * Close every week that has ended by `day`. Each pays its wage, part of it for a week started part way through, and the
 * shift's bonus; standing moves as at an NPC's company, and one let go gets a week's pay.
 * @returns {{employer: object, events: object[], wealth: object, weeks: number}}
 */
export function closeEmployerWeeks(e, day, p = BUSINESS_DEFAULTS, shiftDays = {}) {
  const events = [];
  const wealth = {};
  let weeks = 0;
  while (e.period.endDay <= day && weeks < p.npc.corp.catchUp) {
    const { startDay, endDay } = e.period;
    for (const staff of e.staff.filter((s) => s.status === 'active')) {
      const from = Math.max(startDay, staff.hiredDay ?? startDay);
      const band = e.period.shifts[staff.actorId];
      const paid = Math.round((staff.wage * clamp(endDay - from, 0, WEEK)) / WEEK);
      const bonus = Math.round(staff.wage * (p.npc.shift.bonus[band] ?? 0));
      events.push({ type: 'payslip', actorId: staff.actorId, post: staff.post, wage: staff.wage, paid, bonus });
      const verdict = judgeWeek(staff, band, from > startDay || shiftedIn(shiftDays, staff.actorId, startDay, endDay), endDay, p);
      if (verdict === 'sack') {
        e.staff = e.staff.filter((s) => s !== staff);
        wealth[staff.actorId] = (wealth[staff.actorId] ?? 0) + staff.wage;
        events.push({ type: 'shiftSacked', actorId: staff.actorId, paid: staff.wage });
      } else if (verdict === 'warn') {
        events.push({ type: 'shiftWarned', actorId: staff.actorId });
      }
    }
    e.period = { startDay: endDay, endDay: endDay + WEEK, shifts: {} };
    weeks++;
  }
  // A calendar jumped further than that starts afresh, from today.
  if (e.period.endDay <= day) e.period = { startDay: day, endDay: day + WEEK, shifts: {} };
  return { employer: e, events, wealth, weeks };
}

/** What Your jobs needs of a job here: the same shape as a job at a business. */
export function employerJob(e, staff, p = BUSINESS_DEFAULTS) {
  return {
    businessId: e.id, businessName: e.name, ticker: e.ticker, corp: true, archetype: e.archetype, stage: 2,
    staffId: staff.id, post: staff.post, status: staff.status, wage: staff.wage, hiredDay: staff.hiredDay ?? null, owed: 0, overtime: 0, asks: [],
    ...(staff.status === 'active' ? { boss: { band: bossBand(standingOf(staff, p), p), warned: !!staff.warned, done: e.period.shifts[staff.actorId] ?? null, dv: e.dv, uses: employerUses(e, staff.post, p) } } : {}),
  };
}

/** The player characters working for a market company, for insider heat. */
export const employeesOf = (employers, companyId) => employers.filter((e) => e.companyId === companyId).flatMap((e) => e.staff.filter((s) => s.status === 'active').map((s) => s.actorId));
