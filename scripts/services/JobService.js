/**
 * The job board (N2, DESIGN §36.17)
 * @file scripts/services/JobService.js
 * @description The GM's side. Players can't read an NPC company's record, so what they may see of its open roles is
 *              published in a world setting. An application is a roll, checked here against the character's own
 *              card, and waits on Pending unless the world accepts good rolls by itself.
 */

import { BUSINESS_DEFAULTS, autoHires, boardEntry, canApply, decideApplication, normalizeBusiness, openRoles, recordApplication, stageDv, useKey } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { L } from '../ui/format.js';
import { BusinessService } from './BusinessService.js';
import { SkillAdapter } from './SkillAdapter.js';

const activeGM = () => game.users.activeGM?.id === game.user.id;
const postName = (post) => L(`NCI.Staff.Post.${post}`);

export const JobService = {
  /** Put what players may see where they can read it, if it has changed. */
  async publish() {
    if (!activeGM()) return;
    const businesses = BusinessRepository.all().filter((b) => b.npcRun);
    const key = (b, actorId) => `${b.id}:${actorId}`;
    const board = {
      companies: businesses.map((b) => boardEntry(b, game.actors.get(b.npcRun.ownerId)?.name ?? '')).filter(Boolean),
      tried: Object.fromEntries(businesses.flatMap((b) => Object.entries(b.jobTries ?? {}).map(([actorId, day]) => [key(b, actorId), day]))),
      waiting: Object.fromEntries(businesses.flatMap((b) => (b.applications ?? []).map((a) => [key(b, a.actorId), a.post]))),
    };
    if (JSON.stringify(board) !== JSON.stringify(game.settings.get(MODULE_ID, SETTINGS.JOB_BOARD))) await game.settings.set(MODULE_ID, SETTINGS.JOB_BOARD, board);
  },

  /** Every application waiting for the GM. */
  waiting() {
    return BusinessRepository.all().flatMap((b) => (b.applications ?? []).map((a) => ({ business: b, application: a })));
  },

  async _tell(application, company, hired, wage = 0) {
    const name = company.name;
    await BusinessService._mailAccount(application.actorId, L('NCI.Jobs.Subject', { name }), [hired ? L('NCI.Jobs.Hired', { name, post: postName(application.post), wage }) : L('NCI.Jobs.Turned', { name, post: postName(application.post) })]);
  },

  /** A character applies. Runs in the GM's request queue. */
  async apply(actor, request) {
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

  /** The GM's answer on Pending. */
  decide(businessId, id, yes) {
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
