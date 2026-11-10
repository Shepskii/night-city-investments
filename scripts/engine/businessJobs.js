/**
 * The job board: player characters applying to work at an NPC's company (N2, DESIGN §36.17)
 * @file scripts/engine/businessJobs.js
 * @description What a company can offer, one application a week from each character, and the GM's answer. A failed
 *              roll is refused there and then, as there is nothing to approve. Pure.
 */

import { BUSINESS_DEFAULTS, POSTS, POST_IDS, stageDv, ARCHETYPES } from './businessConfig.js';
import { fail, addLedger, clamp } from './businessRecord.js';
import { bandPassed } from './rolls.js';
import { activeStaff, answerJob, enactFire, enactHire, postOpen, postRate, postUses, wageOf } from './businessStaff.js';

/** Whether a business can have a job board at all: an NPC's, open, and big enough for a job to be worth more than owning. */
export const hasJobBoard = (b, p = BUSINESS_DEFAULTS) => !!b.npcRun && b.status === 'open' && b.stage >= p.npc.jobs.boardStage;

/** The roles this company could fill now. The back room's posts aren't advertised. */
export function openRoles(b, p = BUSINESS_DEFAULTS) {
  if (!hasJobBoard(b, p)) return [];
  const arch = ARCHETYPES[b.archetype];
  return POST_IDS.filter((post) => !POSTS[post].backRoom && postOpen(b, post, p).ok).map((post) => ({
    post,
    // A rough figure: what an applicant is paid depends on their skills and their roll.
    wage: Math.round(postRate(post, p.npc.jobs.guideBase, b.stage, p)),
    uses: postUses(post, arch, p).filter((u) => u.adj === 0).map((u) => u.use),
  })).filter((r) => r.uses.length);
}

/** What the job board shows of a company, for players, who can't read its record. */
export function boardEntry(b, ownerName, p = BUSINESS_DEFAULTS) {
  const roles = openRoles(b, p);
  return roles.length ? { businessId: b.id, name: b.name, archetype: b.archetype, stage: b.stage, owner: ownerName, location: b.location ?? '', dv: stageDv(b.stage, p), roles } : null;
}

/** Whether this character may apply for this role now. */
export function canApply(b, actorId, post, day, p = BUSINESS_DEFAULTS) {
  if (!hasJobBoard(b, p)) return fail('job-closed');
  if (b.partners.some((x) => x.actorId === actorId && ['active', 'leaving', 'invited'].includes(x.status))) return fail('is-partner');
  if ((b.staff ?? []).some((s) => s.actorId === actorId)) return fail('already-staff');
  if ((b.applications ?? []).some((a) => a.actorId === actorId)) return fail('job-waiting');
  if (b.jobTries?.[actorId] != null && day - b.jobTries[actorId] < p.npc.jobs.waitDays) return fail('job-wait');
  if (POSTS[post]?.backRoom) return fail('job-closed');
  return postOpen(b, post, p);
}

/**
 * The application's roll has been made. A failure is refused at once; anything else waits for the GM.
 * @returns {{ok: true, result: 'refused'|'waiting', application?: object}}
 */
export function recordApplication(b, { id, actorId, name, post, band, day }, p = BUSINESS_DEFAULTS) {
  b.jobTries = { ...Object.fromEntries(Object.entries(b.jobTries ?? {}).filter(([, d]) => day - d < p.npc.jobs.waitDays)), [actorId]: day };
  if (!bandPassed(band)) return { ok: true, result: 'refused' };
  const application = { id, actorId, name, post, band, day };
  b.applications = [...(b.applications ?? []), application];
  return { ok: true, result: 'waiting', application };
}

/** Whether a roll this good can be accepted without asking the GM, if the world's setting allows it. */
export const autoHires = (band, p = BUSINESS_DEFAULTS) => p.npc.jobs.autoBands.includes(band);

/**
 * The GM's answer. Hired, they start at once, as applying was their acceptance; a better roll gets a better wage.
 * @param {object} ctx - `basesOf(actorId)` reads a character's bases from their sheet
 * @returns {{ok: true, hired: boolean, application: object, staff?: object}|{ok: false, reason: string}}
 */
export function decideApplication(b, id, yes, day, ctx = {}, p = BUSINESS_DEFAULTS) {
  const application = (b.applications ?? []).find((a) => a.id === id);
  if (!application) return fail('no-application');
  if (!yes) {
    b.applications = b.applications.filter((a) => a !== application);
    return { ok: true, hired: false, application };
  }
  const made = enactHire(b, { actorId: application.actorId, name: application.name, source: 'pc', post: application.post, pct: p.npc.jobs.pct[application.band] ?? 1 }, day, ctx, p);
  if (!made.ok) return made;
  answerJob(b, made.staff.id, true, day, p);
  b.applications = b.applications.filter((a) => a !== application);
  addLedger(b, { day, kind: 'jobApplicant', amount: 0, staffName: application.name }, p);
  return { ok: true, hired: true, application, staff: made.staff };
}

// ── The shift (N3) ───────────────────────────────────────────────────────────

/** Where a player character stands with the boss, 0 to 100. Kept from them as a number. */
export const standingOf = (staff, p = BUSINESS_DEFAULTS) => staff.standing ?? p.npc.shift.start;

/** The band a player is shown for their standing. */
export const bossBand = (value, p = BUSINESS_DEFAULTS) => p.npc.shift.bands.find(([below]) => value < below)?.[1] ?? 'trusted';

/** The skills a shift can be worked with: the role's own. */
export const shiftUses = (b, staff, p = BUSINESS_DEFAULTS) => postUses(staff.post, ARCHETYPES[b.archetype], p).filter((u) => u.adj === 0).map((u) => u.use);

/** Whether this character can work a shift here this week. */
export function canShift(b, actorId) {
  if (!b.npcRun || b.status !== 'open' || !b.period) return fail('job-closed');
  const staff = activeStaff(b).find((s) => s.source === 'pc' && s.actorId === actorId);
  if (!staff) return fail('not-staff');
  if (b.period.shifts?.[actorId]) return fail('shift-done');
  return { ok: true, staff };
}

/** The shift's roll has been made: it counts when the week closes. */
export function workShift(b, actorId, band) {
  const can = canShift(b, actorId);
  if (!can.ok) return can;
  b.period.shifts = { ...(b.period.shifts ?? {}), [actorId]: band };
  return { ok: true };
}

/** What this week's shifts do to the takings, as a share. */
export function shiftLift(b, p = BUSINESS_DEFAULTS) {
  if (!b.npcRun) return 0;
  return Object.values(b.period.shifts ?? {}).reduce((sum, band) => sum + (p.npc.shift.lift[band] ?? 0), 0);
}

/** A good shift's bonus, from the cash as far as it goes. @returns {object} actorId to eb */
export function payShiftBonuses(b, day, p = BUSINESS_DEFAULTS) {
  const paid = {};
  if (!b.npcRun) return paid;
  for (const staff of activeStaff(b).filter((s) => s.source === 'pc' && s.actorId)) {
    const band = b.period.shifts?.[staff.actorId];
    const amount = Math.min(Math.round(staff.wage * (p.npc.shift.bonus[band] ?? 0)), Math.max(0, b.till));
    if (amount <= 0) continue;
    b.till -= amount;
    paid[staff.actorId] = amount;
    addLedger(b, { day, kind: 'shiftBonus', amount: -amount, staffName: staff.name }, p);
  }
  return paid;
}

/**
 * The week's close for the company's player employees: standing moves with the shift or the lack of one, the bottom
 * band brings a warning and then the sack with a week's pay, and a trusted employee is put up for promotion.
 */
export function shiftWeek(b, part, day, out, p = BUSINESS_DEFAULTS) {
  if (!b.npcRun) return;
  for (const staff of activeStaff(b).filter((s) => s.source === 'pc' && s.actorId)) {
    // A week they weren't there for the whole of costs nothing.
    const newcomer = staff.hiredDay != null && staff.hiredDay > b.period.startDay;
    const verdict = judgeWeek(staff, b.period.shifts?.[staff.actorId], part < 1 || newcomer, day, p);
    if (verdict === 'sack') {
      const fired = enactFire(b, staff.id, day, p);
      if (fired.ok) {
        if (fired.paid) out.wealth[staff.actorId] = (out.wealth[staff.actorId] ?? 0) + fired.paid;
        out.events.push({ type: 'shiftSacked', actorId: staff.actorId, paid: fired.paid });
      }
    } else if (verdict === 'warn') {
      out.events.push({ type: 'shiftWarned', actorId: staff.actorId });
    }
  }
}

/**
 * One employee's week with the boss, wherever they work: standing moves with the shift or the lack of one (none if the
 * week is `excused`), the bottom band warns and then sacks, and trusted puts them up for promotion.
 * @returns {'sack'|'warn'|null}
 */
export function judgeWeek(staff, band, excused, day, p = BUSINESS_DEFAULTS) {
  const r = p.npc.shift;
  const move = band ? r.moves[band] ?? 0 : excused ? 0 : r.skip;
  staff.standing = clamp(standingOf(staff, p) + move, 0, 100);
  if (staff.standing < r.bands[0][0]) {
    if (staff.warned) return 'sack';
    staff.warned = true;
    return 'warn';
  }
  delete staff.warned;
  if (staff.standing >= r.promoteAt && !staff.promotion && (staff.promotedDay == null || day - staff.promotedDay >= r.promoteEvery)) staff.promotion = true;
  return null;
}

/** What a promotion would pay: a raise, and their own cap lifted by as much, so one at the cap is raised too. */
export const promotedWage = (b, staff, p = BUSINESS_DEFAULTS) => wageOf(b, { ...staff, pct: Math.round((staff.pct + p.npc.shift.raise) * 100) / 100, promotions: (staff.promotions ?? 0) + 1 }, p);

/** The GM's answer to a promotion: a raise, with the cap lifted by as much, and a fresh start; or not now, and asked again later. */
export function decidePromotion(b, staffId, yes, day, p = BUSINESS_DEFAULTS) {
  const staff = activeStaff(b).find((s) => s.id === staffId);
  if (!staff?.promotion) return fail('no-promotion');
  delete staff.promotion;
  staff.promotedDay = day;
  if (yes) {
    staff.pct = Math.round((staff.pct + p.npc.shift.raise) * 100) / 100;
    staff.promotions = (staff.promotions ?? 0) + 1;
    staff.standing = p.npc.shift.afterPromotion;
    staff.wage = wageOf(b, staff, p);
  }
  return { ok: true, staff };
}
