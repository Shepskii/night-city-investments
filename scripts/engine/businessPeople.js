/**
 * Player businesses: employees as people
 * @file scripts/engine/businessPeople.js
 * @description E2 of DESIGN §33: loyalty and what moves it, quitting, hidden traits and vetting,
 *              bonuses, pay changes and raises asked for, moving an employee to another post, and
 *              the staff events in the weekly event table. Traits are kept in the GM's hidden state,
 *              never on the record; whatever needs one is given `traits` (applicant or employee id to
 *              trait, see traitOf). Pure; no Foundry globals.
 */

import { createRng } from './rng.js';
import { bandPassed } from './rolls.js';
import { BUSINESS_DEFAULTS, EVENTS, POSTS } from './businessConfig.js';
import { archetypeOf, fail, addLedger, clamp } from './businessRecord.js';
import {
  activeStaff, staffOf, hasLoyalty, traitOf, moveLoyalty, postOpen, postBase, wageOf,
} from './businessStaff.js';

/** Staff with loyalty and a life of their own: NPCs and recruits who have started. */
export const npcStaff = (b) => activeStaff(b).filter(hasLoyalty);

// ── Staff events ─────────────────────────────────────────────────────────────

/**
 * How likely a staff event is to be drawn this week, against the other events' weights: none without
 * NPC staff; a pay dispute only at a company with enough unhappy staff; an accident only where the
 * work is dangerous; light fingers more often with a thief or a sullen hand on the staff.
 */
export function staffEventWeight(b, kind, traits = null, p = BUSINESS_DEFAULTS) {
  const def = EVENTS[kind];
  const staff = npcStaff(b);
  if (!staff.length) return 0;
  const ev = p.staff.events;
  if (kind === 'payDispute') {
    const average = staff.reduce((a, s) => a + s.loyalty, 0) / staff.length;
    if (staff.length < ev.disputeStaff || average >= ev.disputeLoyalty) return 0;
  }
  if (kind === 'accident' && !ev.accidents.includes(b.archetype)) return 0;
  if (kind === 'lightFingers' && staff.some((s) => traitOf(traits, s) === 'lightFingers' || s.loyalty < p.staff.loyalty.quitBelow)) {
    return def.weight * p.staff.traits.lightFingersWeight;
  }
  return def.weight;
}

/** Who a staff event is about, drawn with it: someone off sick or hurt, or the best hand a rival wants. */
export function staffEventTarget(b, kind, rng, p = BUSINESS_DEFAULTS) {
  const staff = npcStaff(b);
  if (!staff.length || !['sickDay', 'accident', 'poaching'].includes(kind)) return null;
  if (kind === 'poaching') {
    const arch = archetypeOf(b);
    return [...staff].sort((a, c) => postBase(c, c.post, arch, p) - postBase(a, a.post, arch, p))[0].id;
  }
  return staff[rng.int(0, staff.length - 1)].id;
}

const answerOf = (slots) => slots.find((s) => s.action === 'respond') ?? null;
const passed = (slots) => !!answerOf(slots) && bandPassed(answerOf(slots).band);

/** Whether every NPC employee has had a bonus this week (that settles a pay dispute too). */
const allBonused = (b) => npcStaff(b).every((s) => (b.period.staffBonus ?? {})[s.id]);

/**
 * Who does no work this week: someone off sick (unless the event was answered), anyone still hurt from
 * an accident, and everyone in a pay dispute nobody settled.
 * @returns {Set<string>}
 */
export function idleStaff(b) {
  const idle = new Set(activeStaff(b).filter((s) => s.outUntil != null && s.outUntil >= b.period.index).map((s) => s.id));
  const event = b.period.event;
  const slots = b.period.slots;
  if (event?.kind === 'sickDay' && event.staffId && !passed(slots)) idle.add(event.staffId);
  if (event?.kind === 'payDispute' && !passed(slots) && !allBonused(b)) for (const s of activeStaff(b)) idle.add(s.id);
  return idle;
}

/**
 * How this week's staff event turned out, when the week closes, as settleEvent reports an event.
 * `change` is what it does to the takings; `cost` is paid from the cash besides (medical bills);
 * `notes` say what happened to whom (`{kind, staffId, name}`), for the digest.
 * @returns {{kind, outcome, band, change, cost, notes}}
 */
export function settleStaffEvent(b, takings, slots, { traits = null, seed = 'nci', day = 0 } = {}, p = BUSINESS_DEFAULTS) {
  const event = b.period.event;
  const def = EVENTS[event.kind];
  const answer = answerOf(slots);
  const band = answer?.band ?? null;
  const outcome = !answer ? 'unanswered' : band === 'fumble' ? 'fumbled' : bandPassed(band) ? 'answered' : 'failed';
  const out = { kind: event.kind, outcome, band, change: 0, cost: 0, notes: [] };
  const target = event.staffId ? staffOf(b, event.staffId) : null;
  const note = (kind, s) => out.notes.push({ kind, staffId: s.id, name: s.name });
  const rng = createRng(seed, 'staff-event', b.id, b.period.index);
  const ev = p.staff.events;

  switch (event.kind) {
    case 'starTurn':
      out.outcome = !answer ? 'unanswered' : bandPassed(band) ? 'windfall' : 'missed';
      if (out.outcome === 'windfall') b.state.reputation = clamp(b.state.reputation + ev.starTurn, 0, 100);
      return out;
    case 'sickDay':
      // The work was lost already (idleStaff); nothing else is.
      if (target && outcome !== 'answered') note('sick', target);
      return out;
    case 'accident': {
      if (!target || outcome === 'answered') return out;
      const cost = Math.round((ev.accident[b.stage] ?? ev.accident.at(-1)) * (outcome === 'failed' ? 0.5 : 1));
      out.cost = cost;
      // Out for next week too.
      target.outUntil = b.period.index + 1;
      note('hurt', target);
      return out;
    }
    case 'poaching': {
      if (!target || outcome === 'answered' || (b.period.raised ?? {})[target.id]) return out;
      if ((target.loyalty ?? 0) >= p.staff.loyalty.devoted) {
        note('stayed', target);
        return out;
      }
      b.staff = b.staff.filter((s) => s !== target);
      addLedger(b, { day, kind: 'poached', amount: 0, staffName: target.name }, p);
      note('poached', target);
      return out;
    }
    case 'lightFingers': {
      const staff = npcStaff(b);
      const thief = staff.find((s) => traitOf(traits, s) === 'lightFingers')
        ?? [...staff].sort((a, c) => a.loyalty - c.loyalty)[0];
      if (outcome === 'answered') {
        if (thief) {
          thief.caught = true;
          if (traitOf(traits, thief) === 'lightFingers') thief.revealed = 'lightFingers';
          note('caught', thief);
        }
        return out;
      }
      const [lo, hi] = ev.theft;
      const scale = (thief && traitOf(traits, thief) === 'lightFingers' ? p.staff.traits.lightFingersLoss : 1) * (outcome === 'failed' ? 0.5 : 1);
      out.change = -Math.round(takings * (lo + rng.next() * (hi - lo)) * scale);
      return out;
    }
    case 'payDispute': {
      if (outcome === 'answered' || allBonused(b)) {
        out.outcome = 'answered';
        return out;
      }
      for (const s of npcStaff(b)) moveLoyalty(s, p.staff.loyalty.dispute, traits, p);
      out.change = -Math.round(takings * p.events.loss[outcome === 'fumbled' ? 'fumble' : outcome === 'failed' ? 'failure' : 'unanswered']);
      return out;
    }
    default:
      return def ? out : null;
  }
}

// ── The week's loyalty ───────────────────────────────────────────────────────

/**
 * After the wages, as a week closes: each NPC employee's loyalty moves (a paid week, a missed wage, a
 * profitable month, trouble left unanswered), raises are asked for at a month's end (and one ignored
 * counts as refused), and those who have had enough quit. A corp plant reports in.
 * @param {object} o
 * @param {boolean} o.monthEnd - this week ends a month (every fourth)
 * @param {number} o.monthProfit - the profit of the month's weeks
 * @param {boolean} o.unanswered - a bad event was left unanswered this week
 * @returns {{notes: object[], exposure: number}}
 */
export function loyaltyWeek(b, { monthEnd = false, monthProfit = 0, unanswered = false, traits = null, seed = 'nci', day = 0 } = {}, p = BUSINESS_DEFAULTS) {
  const L = p.staff.loyalty;
  // A staff room lets a paid week lift loyalty higher.
  const paidCap = b.upgrades?.staffRoom?.length ? p.projects.staffRoom.paidCap : L.paidCap;
  const notes = [];
  let exposure = 0;
  for (const s of npcStaff(b)) {
    if (traitOf(traits, s) === 'corpPlant') exposure += p.staff.traits.plantExposure;
    if (s.owed > 0) {
      moveLoyalty(s, L.missed, traits, p);
      s.unpaid = (s.unpaid ?? 0) + 1;
    } else {
      s.unpaid = 0;
      if (s.loyalty < paidCap) moveLoyalty(s, Math.min(L.paidWeek, paidCap - s.loyalty), traits, p);
    }
    if (unanswered) moveLoyalty(s, L.unanswered, traits, p);
    if (monthEnd) {
      if (monthProfit > 0) moveLoyalty(s, L.profitMonth, traits, p);
      if (s.ask) {
        moveLoyalty(s, L.refused, traits, p);
        delete s.ask;
      }
      if (s.loyalty < p.staff.raise.below && s.pct < p.staff.offer.max) {
        s.ask = { pct: Math.min(p.staff.offer.max, Math.round((s.pct + p.staff.raise.step) * 100) / 100), day };
        notes.push({ kind: 'asks', staffId: s.id, name: s.name });
      }
    }
    const rng = createRng(seed, 'quit', b.id, b.period.index, s.id);
    const why = s.unpaid >= L.unpaidWeeks ? 'unpaid' : s.loyalty < L.walkBelow ? 'walked'
      : s.loyalty < L.quitBelow && rng.chance(L.quitChance) ? 'quit' : null;
    if (why) {
      b.staff = b.staff.filter((x) => x !== s);
      addLedger(b, { day, kind: 'quit', amount: 0, staffName: s.name }, p);
      notes.push({ kind: why, staffId: s.id, name: s.name });
    }
  }
  return { notes, exposure };
}

// ── Vetting ──────────────────────────────────────────────────────────────────

/** Applicants for a post still waiting and not yet checked. */
const unvetted = (b, post, day) => (b.candidates ?? []).filter((c) => c.post === post && c.expires >= day && !c.vetted);

/** Whether the applicants for a post can be vetted now, and the roll's DV, skills and cost. */
export function vetCheck(b, post, day, p = BUSINESS_DEFAULTS) {
  const v = p.staff.vet;
  if (!unvetted(b, post, day).length) return fail('no-applicants');
  if (b.till < v.cost) return fail('no-funds');
  return { ok: true, dv: v.dv, uses: [...v.uses], cost: v.cost };
}

/**
 * Record a vetting roll: the cost is spent, and a pass shows each applicant's trait, or that they are
 * clean (`revealed`); a strong pass also their exact skill (`vetted: 'full'`). A failure tells nothing,
 * and these applicants cannot be checked again.
 */
export function applyVet(b, { result, day, post, traits = null, by }, p = BUSINESS_DEFAULTS) {
  const cost = p.staff.vet.cost;
  b.till -= cost;
  addLedger(b, { day, kind: 'vet', amount: -cost, actorId: by }, p);
  const full = result.band === 'strong' || result.band === 'exceptional';
  const checked = unvetted(b, post, day);
  for (const c of checked) {
    if (!result.success) {
      c.vetted = 'failed';
      continue;
    }
    c.vetted = full ? 'full' : 'traits';
    c.revealed = traits?.[c.id] ?? 'none';
  }
  return checked;
}

/** Turn an applicant away: they leave the list (and their hidden trait goes with them). */
export function rejectApplicant(b, candidateId, day, by, p = BUSINESS_DEFAULTS) {
  const candidate = (b.candidates ?? []).find((c) => c.id === candidateId);
  if (!candidate) return fail('no-candidate');
  b.candidates = b.candidates.filter((c) => c !== candidate);
  addLedger(b, { day, kind: 'rejected', amount: 0, actorId: by, staffName: candidate.name }, p);
  return { ok: true };
}

// ── Pay, bonuses and posts ───────────────────────────────────────────────────

/** Whether a bonus can be paid: quarters of a week's wage, once a week for each employee. */
export function bonusCheck(b, staffId, quarters, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, staffId);
  if (staff?.status !== 'active') return fail('not-staff');
  const q = Math.round(Number(quarters));
  if (!(q >= 1 && q <= p.staff.bonusQuarters)) return fail('bad-amount');
  if ((b.period.staffBonus ?? {})[staff.id]) return fail('bonus-given');
  const amount = Math.round((wageOf(b, staff, p) * q) / 4);
  if (b.till < amount) return fail('no-funds');
  return { ok: true, staff, quarters: q, amount };
}

/** Pay a bonus from the cash. A player character's goes to their eddies. */
export function payBonus(b, staffId, quarters, day, by, traits = null, p = BUSINESS_DEFAULTS) {
  const can = bonusCheck(b, staffId, quarters, p);
  if (!can.ok) return can;
  b.till -= can.amount;
  b.period.staffBonus = { ...(b.period.staffBonus ?? {}), [staffId]: can.amount };
  moveLoyalty(can.staff, p.staff.loyalty.bonusPerQuarter * can.quarters, traits, p);
  addLedger(b, { day, kind: 'bonus', amount: -can.amount, actorId: by, staffName: can.staff.name }, p);
  return { ok: true, amount: can.amount, actorId: can.staff.source === 'pc' ? can.staff.actorId : null };
}

/** Whether a change of pay can be proposed: a new share of the going rate (`pct`, as a percentage). */
export function payOffer(b, request, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, request.staffId);
  if (staff?.status !== 'active') return fail('not-staff');
  const pct = Math.round(Number(request.pct)) / 100;
  if (!(pct >= p.staff.offer.min && pct <= p.staff.offer.max)) return fail('bad-wage');
  if (pct === staff.pct) return fail('same-pay');
  return { ok: true, terms: { staffId: staff.id, name: staff.name, pct, from: staff.pct } };
}

/**
 * A change of pay the partners agreed to. A raise moves loyalty up as a better offer would have, and
 * answers a raise they asked for if it is enough; a cut hurts more than the difference. A raise of a
 * tenth or more this week also keeps them from a rival's offer.
 */
export function enactPay(b, terms, day, traits = null, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, terms.staffId);
  if (staff?.status !== 'active') return fail('not-staff');
  const by = terms.pct - staff.pct;
  const steps = (by / 0.1) * p.staff.loyalty.perTen;
  moveLoyalty(staff, by > 0 ? steps : steps + p.staff.loyalty.cut, traits, p);
  if (staff.ask && terms.pct >= staff.ask.pct - 1e-9) delete staff.ask;
  if (by >= 0.1 - 1e-9) b.period.raised = { ...(b.period.raised ?? {}), [staff.id]: true };
  staff.pct = terms.pct;
  staff.wage = wageOf(b, staff, p);
  addLedger(b, { day, kind: by > 0 ? 'raise' : 'payCut', amount: 0, staffName: staff.name }, p);
  return { ok: true, staff };
}

/** The partners turn down a raise an employee asked for. */
export function refuseRaise(b, staffId, day, traits = null, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, staffId);
  if (!staff?.ask) return fail('no-ask');
  delete staff.ask;
  moveLoyalty(staff, p.staff.loyalty.refused, traits, p);
  addLedger(b, { day, kind: 'raiseRefused', amount: 0, staffName: staff.name }, p);
  return { ok: true };
}

/** Move an employee to another post that has room; their pay follows their skill there. */
export function movePost(b, staffId, post, day, by, p = BUSINESS_DEFAULTS) {
  const staff = staffOf(b, staffId);
  if (staff?.status !== 'active') return fail('not-staff');
  if (!POSTS[post]) return fail('bad-post');
  if (staff.post === post) return fail('same-post');
  const open = postOpen(b, post, p, staff.id);
  if (!open.ok) return open;
  staff.post = post;
  staff.wage = wageOf(b, staff, p);
  addLedger(b, { day, kind: 'moved', amount: 0, actorId: by, staffName: staff.name }, p);
  return { ok: true, staff };
}
