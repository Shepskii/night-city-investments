/**
 * Jobs at market corporations (N4, DESIGN §36.17): the GM's side
 * @file scripts/services/EmployerService.js
 * @description The GM sets up an employer for a market company; players apply from the job board, work the weekly shift
 *              and are paid from outside the game's economy when its week closes. Requests from players run in the
 *              business request queue, routed here by the employer's id.
 */

import {
  EMPLOYER_PREFIX, answerEmployer, autoHires, canApplyEmployer, canShiftEmployer, closeEmployerWeeks, createEmployer, decideEmployerApplication,
  decideEmployerPromotion, dismissEmployee, employeesOf, employerBoardEntry, employerJob, employerUses, offerEmployerJob, promotedEmployerWage,
  recordApplication, updateEmployer, useKey, workEmployerShift,
} from '../engine/index.js';
import { MODULE_ID, FLAGS, HOOKS, SETTINGS } from '../utils/constants.js';
import { isCharacter, log } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { EmployerRepository } from '../data/EmployerRepository.js';
import { L } from '../ui/format.js';
import { jobsOf } from './BusinessClient.js';
import { BusinessService } from './BusinessService.js';
import { HeatService } from './HeatService.js';
import { JobService } from './JobService.js';
import { SkillAdapter } from './SkillAdapter.js';

const activeGM = () => game.users.activeGM?.id === game.user.id;
const day = () => BusinessService.day();
const gmOnly = (fn) => (activeGM() ? BusinessService._queue.run(fn) : Promise.resolve({ ok: false, reason: 'not-gm' }));

export const EmployerService = {
  all: () => EmployerRepository.all(),

  /** Save, then everything that follows from it: the jobs on characters, the board, pay and mail. */
  async _commit(e, { events = [], wealth = {} } = {}) {
    await EmployerRepository.save(e);
    Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { employerId: e.id });
    await this._sync(e);
    await JobService.publish();
    const out = { business: e, events };
    await BusinessService._payslips(out);
    await BusinessService._pay(wealth);
    await JobService.onEvents(out);
  },

  /** Mirror each character's job here onto their sheet, the same shape as a job at a business; one ended is taken off. */
  async _sync(e, gone = false) {
    const holding = new Set(gone ? [] : e.staff.map((s) => s.actorId));
    for (const actor of game.actors.filter((a) => isCharacter(a) && (holding.has(a.id) || jobsOf(a).some((j) => j.businessId === e.id)))) {
      const kept = jobsOf(actor).filter((j) => j.businessId !== e.id);
      const staff = gone ? null : e.staff.find((s) => s.actorId === actor.id);
      const jobs = staff ? [...kept, employerJob(e, staff)] : kept;
      if (JSON.stringify(jobs) !== JSON.stringify(jobsOf(actor))) await actor.setFlag(MODULE_ID, FLAGS.JOBS, [jobs]);
    }
  },

  // ── The GM ─────────────────────────────────────────────────────────────────

  create({ companyId, archetype, dv, location, roles }) {
    return gmOnly(async () => {
      const company = CompanyRepository.get(companyId);
      if (!company) return { ok: false, reason: 'no-company' };
      if (EmployerRepository.forCompany(companyId)) return { ok: false, reason: 'employer-exists' };
      const made = createEmployer({ id: `${EMPLOYER_PREFIX}${foundry.utils.randomID(12)}`, companyId, name: company.name, ticker: company.ticker, archetype, dv, location, roles, day: day() });
      if (!made.ok) return made;
      await this._commit(made.employer);
      return { ok: true, employer: made.employer };
    });
  },

  update(id, changes) {
    return gmOnly(async () => {
      const e = EmployerRepository.get(id);
      if (!e) return { ok: false, reason: 'no-employer' };
      const done = updateEmployer(e, changes);
      if (!done.ok) return done;
      // The company's name may have changed on the market.
      const company = CompanyRepository.get(e.companyId);
      if (company) Object.assign(e, { name: company.name, ticker: company.ticker });
      await this._commit(e);
      return { ok: true };
    });
  },

  /** No more jobs there: everyone working for it is let go, with a week's pay. */
  remove(id) {
    return gmOnly(async () => {
      const e = EmployerRepository.get(id);
      if (!e) return { ok: false, reason: 'no-employer' };
      const wealth = Object.fromEntries(e.staff.filter((s) => s.status === 'active').map((s) => [s.actorId, s.wage]));
      await EmployerRepository.remove(id);
      Hooks.callAll(HOOKS.BUSINESSES_CHANGED, { employerId: id });
      await this._sync(e, true);
      await JobService.publish();
      await BusinessService._pay(wealth);
      for (const [actorId, paid] of Object.entries(wealth)) await this._mailSacked(e, actorId, paid);
      return { ok: true };
    });
  },

  offer(id, actorId, post) {
    return gmOnly(async () => {
      const e = EmployerRepository.get(id);
      const actor = game.actors.get(actorId);
      if (!e) return { ok: false, reason: 'no-employer' };
      if (!actor?.hasPlayerOwner || !isCharacter(actor)) return { ok: false, reason: 'no-character' };
      const done = offerEmployerJob(e, { actorId, name: actor.name, post }, day());
      if (!done.ok) return done;
      await this._commit(e);
      return { ok: true };
    });
  },

  dismiss(id, staffId) {
    return gmOnly(async () => {
      const e = EmployerRepository.get(id);
      if (!e) return { ok: false, reason: 'no-employer' };
      const done = dismissEmployee(e, staffId);
      if (!done.ok) return done;
      await this._commit(e, { wealth: done.paid ? { [done.staff.actorId]: done.paid } : {} });
      if (done.staff.status === 'active') await this._mailSacked(e, done.staff.actorId, done.paid);
      return { ok: true };
    });
  },

  _mailSacked(e, actorId, paid) {
    return BusinessService._mailAccount(actorId, L('NCI.Jobs.JobSubject', { name: e.name }), [L('NCI.Jobs.Sacked', { name: e.name, paid })]).catch((error) => log.warn('Mail failed', error));
  },

  decide(id, applicationId, yes) {
    return gmOnly(async () => {
      const e = EmployerRepository.get(id);
      if (!e) return { ok: false, reason: 'no-employer' };
      const done = decideEmployerApplication(e, applicationId, yes, day());
      if (!done.ok) return done;
      await this._commit(e);
      if (done.hired) await this._noteInsider(e, done.staff.actorId);
      await JobService._tell(done.application, e, done.hired, done.staff?.wage ?? 0);
      return { ok: true };
    });
  },

  promote(id, staffId, yes) {
    return gmOnly(async () => {
      const e = EmployerRepository.get(id);
      if (!e) return { ok: false, reason: 'no-employer' };
      const done = decideEmployerPromotion(e, staffId, yes, day());
      if (!done.ok) return done;
      await this._commit(e);
      if (yes) await BusinessService._mailAccount(done.staff.actorId, L('NCI.Jobs.JobSubject', { name: e.name }), [L('NCI.Jobs.Promoted', { name: e.name, wage: done.staff.wage })]);
      return { ok: true };
    });
  },

  // ── Players' requests, already in the GM's request queue ────────────────────

  async apply(actor, request) {
    const e = EmployerRepository.get(request.companyId);
    if (!e || !actor.hasPlayerOwner) return { ok: false, reason: 'job-closed' };
    const today = day();
    const open = canApplyEmployer(e, actor.id, request.post, today);
    if (!open.ok) return open;
    const use = employerUses(e, request.post).find((u) => useKey(u) === useKey(request.use ?? {})) ?? null;
    if (!use) return { ok: false, reason: 'bad-use' };
    const check = await SkillAdapter.verifyLevers(actor, request, { dv: e.dv, use });
    if (!check.ok) return check;
    const { band } = check.result;
    const made = recordApplication(e, { id: foundry.utils.randomID(10), actorId: actor.id, name: actor.name, post: request.post, band, day: today });
    const automatic = made.result === 'waiting' && game.settings.get(MODULE_ID, SETTINGS.JOB_AUTO) === true && autoHires(band);
    const decided = automatic ? decideEmployerApplication(e, made.application.id, true, today) : null;
    await this._commit(e);
    if (made.result === 'refused') await JobService._tell({ actorId: actor.id, post: request.post }, e, false);
    if (decided?.ok) {
      await this._noteInsider(e, actor.id);
      await JobService._tell(made.application, e, true, decided.staff.wage);
    }
    return { ok: true };
  },

  async shift(actor, request) {
    const e = EmployerRepository.get(request.companyId);
    if (!e) return { ok: false, reason: 'job-closed' };
    const can = canShiftEmployer(e, actor.id);
    if (!can.ok) return can;
    if (JobService.shiftWorked(actor.id, e.id)) return { ok: false, reason: 'shift-done' };
    const use = employerUses(e, can.staff.post).find((u) => useKey(u) === useKey(request.use ?? {})) ?? null;
    if (!use) return { ok: false, reason: 'bad-use' };
    const check = await SkillAdapter.verifyLevers(actor, request, { dv: e.dv, use });
    if (!check.ok) return check;
    workEmployerShift(e, actor.id, check.result.band);
    await this._commit(e);
    return { ok: true };
  },

  /** Taking the GM's offer, turning it down, or quitting. */
  async answer(actor, request) {
    const e = EmployerRepository.get(request.businessId);
    if (!e) return { ok: false, reason: 'job-closed' };
    const done = answerEmployer(e, actor.id, request.type, day());
    if (!done.ok) return done;
    await this._commit(e);
    if (request.type === 'acceptJob') await this._noteInsider(e, actor.id);
    return { ok: true };
  },

  // ── Time, the board, Pending and heat ──────────────────────────────────────

  /** After a tick: close every employer's weeks that have ended. */
  async onTick() {
    if (!activeGM()) return;
    for (const e of EmployerRepository.all()) {
      const out = closeEmployerWeeks(e, day());
      if (out.weeks) await this._commit(out.employer, out);
    }
  },

  boardEntries: () => EmployerRepository.all().map((e) => employerBoardEntry(e)).filter(Boolean),

  /** Whether this character has worked a shift this week at an employer other than `exceptId`. */
  shiftWorked: (actorId, exceptId = null) => EmployerRepository.all().some((e) => e.id !== exceptId && e.period.shifts[actorId]),

  waiting: () => EmployerRepository.all().flatMap((e) => e.applications.map((a) => ({ business: e, application: a }))),

  promotions: () => EmployerRepository.all().flatMap((e) => e.staff.filter((s) => s.promotion && s.status === 'active').map((staff) => ({ business: e, staff, raised: promotedEmployerWage(staff) }))),

  /** Employees of a market company, who trade it as insiders do. */
  employeesOf: (companyId) => employeesOf(EmployerRepository.all(), companyId),

  /** One just taken on counts as an insider on any window already open on their company. */
  _noteInsider(e, actorId) {
    return HeatService.noteRunner(e.companyId, actorId).catch((error) => log.warn('Heat note failed', error));
  },

  /** Characters' jobs here mirrored again, as at startup. */
  async syncAll() {
    for (const e of EmployerRepository.all()) await this._sync(e);
  },

  /** For the GM's console: whether a company already has one. */
  hasEmployer: (companyId) => !!EmployerRepository.forCompany(companyId),
};
