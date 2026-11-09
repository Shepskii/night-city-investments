/**
 * The job board: player characters applying to work at an NPC's company (N2, DESIGN §36.17)
 * @file scripts/engine/businessJobs.js
 * @description What a company can offer, one application a week from each character, and the GM's answer. A failed
 *              roll is refused there and then, as there is nothing to approve. Pure.
 */

import { BUSINESS_DEFAULTS, POSTS, POST_IDS, stageDv, ARCHETYPES } from './businessConfig.js';
import { fail, addLedger } from './businessRecord.js';
import { bandPassed } from './rolls.js';
import { answerJob, enactHire, postOpen, postRate, postUses } from './businessStaff.js';

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
