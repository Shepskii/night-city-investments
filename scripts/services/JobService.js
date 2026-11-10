/**
 * The job board (N2, DESIGN §36.17)
 * @file scripts/services/JobService.js
 * @description The GM's side. Players can't read an NPC company's record, so what they may see of its open roles is
 *              published in a world setting. An application is a roll, checked here against the character's own
 *              card, and waits on Pending unless the world accepts good rolls by itself.
 */

import { BUSINESS_DEFAULTS, autoHires, boardEntry, canApply, canShift, decideApplication, decidePromotion, isEmployerId, normalizeBusiness, noteShiftDay, openRoles, promotedWage, recordApplication, shiftUses, stageDv, useKey, workShift } from '../engine/index.js';
import { MODULE_ID, FLAGS, SETTINGS } from '../utils/constants.js';
import { MarketStore } from '../data/MarketStore.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { L } from '../ui/format.js';
import { BusinessService } from './BusinessService.js';
import { EmployerService } from './EmployerService.js';
import { SkillAdapter } from './SkillAdapter.js';

const activeGM = () => game.users.activeGM?.id === game.user.id;
const postName = (post) => L(`NCI.Staff.Post.${post}`);

export const JobService = {
  /** Put what players may see where they can read it, if it has changed. */
  async publish() {
    if (!activeGM()) return;
    const businesses = BusinessRepository.all().filter((b) => b.npcRun);
    const key = (b, actorId) => `${b.id}:${actorId}`;
    // Market corporations' jobs (N4) sit on the same board.
    const employers = EmployerService.all();
    const all = [...businesses, ...employers];
    const board = {
      companies: [...businesses.map((b) => boardEntry(b, game.actors.get(b.npcRun.ownerId)?.name ?? '')).filter(Boolean), ...EmployerService.boardEntries()],
      tried: Object.fromEntries(all.flatMap((b) => Object.entries(b.jobTries ?? {}).map(([actorId, day]) => [key(b, actorId), day]))),
      waiting: Object.fromEntries(all.flatMap((b) => (b.applications ?? []).map((a) => [key(b, a.actorId), a.post]))),
    };
    if (JSON.stringify(board) !== JSON.stringify(game.settings.get(MODULE_ID, SETTINGS.JOB_BOARD))) await game.settings.set(MODULE_ID, SETTINGS.JOB_BOARD, board);
  },

  /** Every application waiting for the GM. */
  waiting() {
    return [...BusinessRepository.all().flatMap((b) => (b.applications ?? []).map((a) => ({ business: b, application: a }))), ...EmployerService.waiting()];
  },

  /** Each character's recent shift days, at any job: a shift anywhere excuses the week at their other jobs. */
  shiftDays() {
    return MarketStore.readRecord(FLAGS.SHIFT_DAYS) ?? {};
  },

  noteShift(actorId, day) {
    return MarketStore._writeRecord(FLAGS.SHIFT_DAYS, noteShiftDay(this.shiftDays(), actorId, day));
  },

  /** Whether this character has worked the week's one shift anywhere but `exceptId` (N3, N4). */
  shiftWorked(actorId, exceptId = null) {
    return BusinessRepository.all().some((o) => o.id !== exceptId && o.npcRun && o.period?.shifts?.[actorId]) || EmployerService.shiftWorked(actorId, exceptId);
  },

  async _tell(application, company, hired, wage = 0) {
    const name = company.name;
    await BusinessService._mailJob(company, application.actorId, L('NCI.Jobs.Subject', { name }), [hired ? L('NCI.Jobs.Hired', { name, post: postName(application.post), wage }) : L('NCI.Jobs.Turned', { name, post: postName(application.post) })]);
  },

  /** A character applies. Runs in the GM's request queue. */
  async apply(actor, request) {
    if (isEmployerId(request.companyId)) return EmployerService.apply(actor, request);
    const stored = BusinessRepository.get(request.companyId);
    if (!stored || !actor.hasPlayerOwner) return { ok: false, reason: 'job-closed' };
    const b = normalizeBusiness(structuredClone(stored));
    const day = BusinessService.day();
    const open = canApply(b, actor.id, request.post, day);
    if (!open.ok) return open;
    const use = openRoles(b).find((r) => r.post === request.post)?.uses.find((u) => useKey(u) === useKey(request.use ?? {})) ?? null;
    if (!use) return { ok: false, reason: 'bad-use' };
    const check = await SkillAdapter.verifyLevers(actor, request, { dv: stageDv(b.stage), use });
    if (!check.ok) return check;
    const { band } = check.result;
    const made = recordApplication(b, { id: foundry.utils.randomID(10), actorId: actor.id, name: actor.name, post: request.post, band, day });
    const automatic = made.result === 'waiting' && game.settings.get(MODULE_ID, SETTINGS.JOB_AUTO) === true && autoHires(band);
    const decided = automatic ? decideApplication(b, made.application.id, true, day, { basesOf: (id) => BusinessService.basesOf(id) }) : null;
    await BusinessService._commit({ ok: true, business: b, wealth: {}, events: [] });
    if (made.result === 'refused') await this._tell({ actorId: actor.id, post: request.post }, b, false);
    if (decided?.ok) await this._tell(made.application, b, true, decided.staff.wage);
    return { ok: true, business: b };
  },

  /** A player works the week's shift (N3). One a week in all, whatever jobs they hold. Runs in the GM's request queue. */
  async shift(actor, request) {
    if (isEmployerId(request.companyId)) return EmployerService.shift(actor, request);
    const stored = BusinessRepository.get(request.companyId);
    if (!stored) return { ok: false, reason: 'job-closed' };
    const b = normalizeBusiness(structuredClone(stored));
    const can = canShift(b, actor.id);
    if (!can.ok) return can;
    if (this.shiftWorked(actor.id, b.id)) return { ok: false, reason: 'shift-done' };
    const use = shiftUses(b, can.staff).find((u) => useKey(u) === useKey(request.use ?? {})) ?? null;
    if (!use) return { ok: false, reason: 'bad-use' };
    const check = await SkillAdapter.verifyLevers(actor, request, { dv: stageDv(b.stage), use });
    if (!check.ok) return check;
    workShift(b, actor.id, check.result.band);
    await this.noteShift(actor.id, BusinessService.day());
    await BusinessService._commit({ ok: true, business: b, wealth: {}, events: [] });
    return { ok: true, business: b };
  },

  /** Players at NPC companies who have earned a promotion, waiting for the GM. */
  promotions() {
    return [
      ...BusinessRepository.all().filter((b) => b.npcRun && b.status === 'open').flatMap((b) => (b.staff ?? []).filter((s) => s.promotion).map((staff) => ({ business: b, staff, raised: promotedWage(b, staff) }))),
      ...EmployerService.promotions(),
    ];
  },

  /** The GM's answer to a promotion. */
  promote(businessId, staffId, yes) {
    if (isEmployerId(businessId)) return EmployerService.promote(businessId, staffId, yes);
    if (!activeGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return BusinessService._queue.run(async () => {
      const stored = BusinessRepository.get(businessId);
      if (!stored) return { ok: false, reason: 'no-business' };
      const b = normalizeBusiness(structuredClone(stored));
      const done = decidePromotion(b, staffId, yes, BusinessService.day());
      if (!done.ok) return done;
      await BusinessService._commit({ ok: true, business: b, wealth: {}, events: [] });
      if (yes) await BusinessService._mailJob(b, done.staff.actorId, L('NCI.Jobs.JobSubject', { name: b.name }), [L('NCI.Jobs.Promoted', { name: b.name, wage: done.staff.wage })]);
      return { ok: true };
    });
  },

  /** What a week's close at an NPC's company tells its player employees: a warning, or the sack. */
  async onEvents(out) {
    const b = out.business;
    for (const e of out.events ?? []) {
      if (e.type === 'shiftWarned') await BusinessService._mailJob(b, e.actorId, L('NCI.Jobs.JobSubject', { name: b.name }), [L('NCI.Jobs.WarnedMail', { name: b.name })]);
      if (e.type === 'shiftSacked') await BusinessService._mailJob(b, e.actorId, L('NCI.Jobs.JobSubject', { name: b.name }), [L('NCI.Jobs.Sacked', { name: b.name, paid: e.paid ?? 0 })]);
    }
  },

  /** The GM's answer on Pending. */
  decide(businessId, id, yes) {
    if (isEmployerId(businessId)) return EmployerService.decide(businessId, id, yes);
    if (!activeGM()) return Promise.resolve({ ok: false, reason: 'not-gm' });
    return BusinessService._queue.run(async () => {
      const stored = BusinessRepository.get(businessId);
      if (!stored) return { ok: false, reason: 'no-business' };
      const b = normalizeBusiness(structuredClone(stored));
      const done = decideApplication(b, id, yes, BusinessService.day(), { basesOf: (actorId) => BusinessService.basesOf(actorId) }, BUSINESS_DEFAULTS);
      if (!done.ok) return done;
      await BusinessService._commit({ ok: true, business: b, wealth: {}, events: [] });
      await this._tell(done.application, b, done.hired, done.staff?.wage ?? 0);
      return { ok: true };
    });
  },
};
