/**
 * Player businesses
 * @file scripts/engine/business.js
 * @description The side-business loop of DESIGN §27.0, as built in B1: founding a business with
 *              partners, the setup roll, the weekly operating period and its five actions,
 *              complementary checks, the till, capped owner draws, the buy-out rule, and closing.
 *              Pure; no Foundry globals. The GM's service reads the dice from the player's chat card
 *              before anything here sees them (`check`), so nothing here trusts a request's numbers.
 *
 * Requests (from a character's business outbox):
 *   { key, type: 'found', name, archetype, location?, cash, gear?, invite?, sweat?, heirId? }
 *   { key, type: 'join', businessId, cash, gear?, heirId? }      an invited character accepts
 *   { key, type: 'decline', businessId }
 *   { key, type: 'contribute', businessId, cash, gear? }         while forming, or a top-up once open
 *
 * `gear` in a request is `[{uuid}]`, Foundry items dragged in. The GM's service looks each one up
 * and passes what it found as `context.gear` (see `itemGear`); a name or value in the request itself
 * is never used.
 *   { key, type: 'withdraw', businessId }                        while forming: take your money back
 *   { key, type: 'setupRoll', businessId, use, rollId }
 *   { key, type: 'action', businessId, action, use, rollId }     take this week's slot
 *   { key, type: 'assist', businessId, forAction, use, rollId }  a complementary check (no slot)
 *   { key, type: 'draw', businessId, amount }
 *   { key, type: 'setHeir', businessId, heirId }
 *   { key, type: 'leave', businessId }                           offer your stake to the others
 *   { key, type: 'buyout', businessId, sellerId }
 *   { key, type: 'proposeClose', businessId }
 *   { key, type: 'setLine', businessId, uuid, qty }              what the workshop makes (P1a); no uuid stops it
 *   { key, type: 'buyStock', businessId, uuid, count }           buy stock for your own sheet (P1b)
 *   { key, type: 'consign', businessId, gear: [{uuid}] }         put items from your sheet in the shop (P1b)
 *   { key, type: 'takeBack', businessId, uuid }                  take a consignment back (P1b)
 *   { key, type: 'vote', businessId, proposalId, yes }
 *
 * `use` is how the roll was made: `{kind: 'skill', skill, stat}`, `{kind: 'ability', ability}` or
 * `{kind: 'hire', hire}` (see businessConfig.js), or `{kind: 'staff', staffId}`: an employee called in
 * for overtime (DESIGN §32), who rolls their best for it. Days are whole market days (`marketDay`).
 *
 * Employees (businessStaff.js):
 *   { key, type: 'recruitRoll', businessId, post, use, rollId }   look for someone for a post
 *   { key, type: 'propose', kind: 'hire', candidateId | actorId, post, pct }   pct: % of the going rate
 *   { key, type: 'propose', kind: 'fire', staffId }
 *   { key, type: 'acceptJob' | 'declineJob' | 'quitJob', businessId }        from the employee's own character
 *
 * Employees as people (businessPeople.js, E2):
 *   { key, type: 'vetRoll', businessId, post, use, rollId }      check every applicant waiting for a post
 *   { key, type: 'bonus', businessId, staffId, quarters }        quarters of a week's wage, from the cash
 *   { key, type: 'train', businessId, staffId }                  E3: a course: their best skill for the post +1
 *   { key, type: 'trainRoll', businessId, staffId, use, rollId } E3: a mentor's lesson, rolled (Education)
 *   { key, type: 'askStaff', businessId, staffId, roll }         E3: ask a player character on the staff for a roll:
 *                                                                roll {type: 'action', action} | {type: 'respond'} | {type: 'assist', forAction}
 *   { key, type: 'cancelAsk', businessId, askId }                withdrawn by whoever runs it, or declined by the employee
 *   { key, type: 'addTeam', businessId, post, name, actorId? }   E3: an Exec puts a member of their Teamwork team in a role
 *                                                                (actorId: an NPC actor already made, dragged into the Hire window)
 *   { key, type: 'staffRoll', businessId, askId, use, rollId }   from the employee's own character: the roll asked of them
 *   { key, type: 'refuseRaise', businessId, staffId }
 *   { key, type: 'rejectApplicant', businessId, candidateId }    turn an applicant away
 *   { key, type: 'movePost', businessId, staffId, post }
 *   { key, type: 'propose', kind: 'pay', staffId, pct }          a new share of the going rate
 *   { key, type: 'propose', kind: 'grant', staffId, pct }        E3: shares for an employee, pct of the company (0.5 to 5)
 *   { key, type: 'propose', kind: 'payout', pct }                B5c: a listed company's payout ratio, 0 to 100 in steps of 10
 *
 * Projects (businessGrowth.js):
 *   { key, type: 'propose', kind: 'project', project }   project: expansion, refit, security, storefront or staffRoom
 *   { key, type: 'propose', kind: 'expansion' }          the same as project 'expansion' (older windows)
 *
 * `context.traits` is the business's hidden traits (applicant or employee id to trait), from the GM's
 * hidden state; a result's `traits` are new ones for the service to keep there, never on the record.
 */

import { fenceCheck, fenceWeek, makesThings, buyStock, clearStock, consignStock, handOffer, handStock, produceCheck, productionWeek, salesWeek, setLine, takeBackStock } from './businessProduction.js';
import { approachOf, dvOf, HIRE_TIERS } from './rolls.js';
import { drawEvent, eventUses, settleEvent, hostileAct, factionFallout } from './businessEvents.js';
import { aimCheck, giftFor } from './factions.js';
import { campaignCheck, runCampaign, runBlackOps } from './businessCampaign.js';
import { supplyCut, runSupply, runVenue, backupWait } from './businessRoles.js';
import { ROOM_ACTIONS, kindProfile, roomCheck, roomKinds, roomWeek, takeDirty, openRoom, roomBust, bustFallout, roomEvent, roomEventFallout, turnInformant, informants, dealCut, runDealRoll, takeDeal, endDeal } from './businessFronts.js';
import { normalizeName, gigTags } from './gigImpact.js';
import {
  fixerOffer, takeFixerLoan, bankCheck, applyBankRoll, repayLoan, payLoans, investorOffer, inviteInvestor, acceptInvestment,
  angelCheck, findAngel, applyAngelRoll, openLoans, averageProfit,
} from './businessFinance.js';
import {
  POSTS, ARCHETYPES, ACTIONS, BUSINESS_DEFAULTS, EVENTS, districtOf, isDistrict, stageDv, actionUses, helpUses, setupUses, usesInclude, useKey, actionFor, actionIdsFor, COMPANY_ACTION_IDS,
} from './businessConfig.js';
import {
  BUSINESS_SCHEMA, BUSINESS_STATUS, weekdayOf, nextBoundary, newPeriod, int, clamp, text, normalizeBusiness, archetypeOf, holders, voters,
  partnerOf, gearValue, totalUnits, bookValue, unitValue, shareOf, lastDigest, drawAllowance, fundingShortfall, hireFee, stateBands,
  fail, close, addLedger, holderActorId,
} from './businessRecord.js';
import {
  daysLeft, spendDays, activeProject, expansionOffer, addProjectDays, milestones, stepUpCheck, applyStepUp, votingUnits,
  projectOffer, startProject, protectionFactor, reputationBaseline, PROJECT_KINDS,
} from './businessGrowth.js';
import {
  canCharter, startCharter, charterRollCheck, applyCharterRoll, approveCharter, dropCharter, fundCharter,
} from './businessCharter.js';
import {
  companyWeek, reportCheck, closeReportWeek, canRun, officerProposal, applyOfficerProposal, infoCheck, applyInternalAudit, applyDiligence,
} from './businessCompany.js';
import {
  canList, startListing, approveListing, rejectListing, prospectusCheck, applyProspectusRoll, payoutOffer,
} from './businessListing.js';
import {
  activeStaff, recruitCheck, applyRecruit, hireOffer, enactHire, answerJob, quitJob, fireOffer, enactFire, staffRoll, payOvertime, staffShifts,
  staffWeek, payWages, staffOf, shiftsOf, overtimePay,
} from './businessStaff.js';
import {
  teamCare, idleStaff, loyaltyWeek, vetCheck, applyVet, payBonus, payOffer, enactPay, refuseRaise, movePost, rejectApplicant, applyTraining, mentorCheck, askOf, askCheck, grantOffer, enactGrant, vestGrants, addTeamMember,
} from './businessPeople.js';
import {
  issueOffer, startIssue, takeRights, buybackOffer, startBuyback, sellBack, closeCapital, capitalRollCheck, applyOfferingRoll, applyTimingRoll,
} from './businessCapital.js';
import { takeoverOffer, makeTakeover, tenderShares, defenceCheck, applyDefence } from './businessTakeover.js';
import { checkSolvency, ADMINISTRATION_REFUSES } from './businessInsolvency.js';
import { layerCheck, addLayer, dropLayers } from './businessOwnership.js';

export { daysLeft, spendDays, activeProject, expansionOffer, milestones, stepUpCheck, projectOffer, PROJECT_KINDS };
export { upgradesOf, protectionFactor, breakInFactor, reputationBaseline } from './businessGrowth.js';
export { fixerOffer, bankCheck, angelCheck, openLoans, averageProfit };

export {
  BUSINESS_SCHEMA, BUSINESS_STATUS, weekdayOf, nextBoundary, normalizeBusiness, archetypeOf, holders, voters,
  partnerOf, gearValue, totalUnits, bookValue, unitValue, shareOf, lastDigest, drawAllowance, fundingShortfall, hireFee, stateBands, holderActorId,
};

export const BUSINESS_REQUESTS = Object.freeze([
  'found', 'join', 'decline', 'contribute', 'withdraw', 'setupRoll', 'action', 'assist', 'draw', 'setHeir', 'leave', 'buyout',
  'propose', 'proposeClose', 'vote', 'stepUpRoll', 'addDays', 'respond', 'takeDirty', 'lieLow', 'gangDealOfficer', 'loanRoll', 'angelRoll', 'repayLoan', 'charterRoll', 'charterFund', 'reportRoll', 'auditRoll', 'diligenceRoll', 'prospectusRoll',
  'recruitRoll', 'acceptJob', 'declineJob', 'quitJob', 'vetRoll', 'bonus', 'train', 'refuseRaise', 'movePost', 'rejectApplicant', 'askStaff', 'cancelAsk', 'addTeam', 'teamCare',
  'rightsTake', 'sellBack', 'issueRoll', 'buybackRoll', 'bid', 'tender', 'defenceRoll', 'hideRoll', 'dropLayer',
  'setLine', 'buyStock', 'consign', 'takeBack',
]);

/** Item types that are not things a business can own. */
const NOT_GEAR = new Set(['skill', 'role', 'criticalInjury', 'netarch']);

/**
 * Read a Foundry item as gear: its name, its book value (the market price times how many there are)
 * and whether it is on the character's own sheet, in which case it leaves the sheet when the request
 * goes through. Used by the player's window to show what was dropped and by the GM's service to
 * check it again.
 * @param {{type: string, name: string, img?: string, system?: object, ownerId?: string|null}} item
 *        `ownerId` is the actor the item belongs to, or null for a library or compendium item
 * @param {string} actorId - the character putting it in
 * @returns {{ok: true, name: string, value: number, img: string, fromActor: boolean} | {ok: false, reason: string}}
 */
export function itemGear(item, actorId, p = BUSINESS_DEFAULTS) {
  if (!item?.name || NOT_GEAR.has(item.type)) return fail('bad-item');
  if (item.ownerId && item.ownerId !== actorId) return fail('not-your-item');
  // Loaded ammunition is marked installed too; only installed cyberware is part of the character.
  if (item.type === 'cyberware' && item.system?.isInstalled) return fail('item-installed');
  const price = Number(item.system?.price?.market ?? item.system?.price ?? 0) || 0;
  const amount = Math.max(1, Math.floor(Number(item.system?.amount) || 1));
  // Cyberpunk RED prices ammunition per box of 10 rounds.
  const value = Math.round(item.type === 'ammo' ? price * Math.ceil(amount / 10) : price * amount);
  if (value <= 0) return fail('no-price');
  if (value > p.maxGearValue) return fail('bad-gear');
  return { ok: true, name: text(item.name, 60) + (amount > 1 ? ` ×${amount}` : ''), value, img: String(item.img ?? ''), fromActor: !!item.ownerId };
}

/** Requests that carry a roll. */
export const ROLL_REQUESTS = Object.freeze(['setupRoll', 'action', 'assist', 'stepUpRoll', 'respond', 'loanRoll', 'angelRoll', 'charterRoll', 'reportRoll', 'auditRoll', 'diligenceRoll', 'recruitRoll', 'vetRoll', 'trainRoll', 'staffRoll', 'prospectusRoll', 'issueRoll', 'buybackRoll', 'defenceRoll', 'hideRoll']);

/**
 * What each kind of proposal needs to pass (DESIGN §27.0): closing and stepping up need every partner
 * with a vote; starting an expansion is a day-to-day choice, a majority of the voting units.
 */
export const PROPOSAL_RULES = Object.freeze({
  close: 'unanimous', stepUp: 'unanimous', expansion: 'majority', project: 'majority', fixerLoan: 'majority', bankLoan: 'majority', investor: 'unanimous', angel: 'unanimous',
  // A company's officers are elected and dismissed by a majority of the shares (B4c).
  elect: 'majority', dismiss: 'majority',
  // Taking an employee on, or letting one go (DESIGN §32).
  hire: 'majority', fire: 'majority', pay: 'majority',
  // Paying a partner's Housing and Lifestyle (B7d).
  coverLiving: 'majority', stopLiving: 'majority',
  // Giving stock to a partner, for nothing (P1b).
  handStock: 'majority',
  // A share grant for an employee (E3, company only).
  grant: 'majority',
  // A listed company's payout ratio (B5c).
  payout: 'majority',
  // New shares and buybacks for a company (B6a).
  issue: 'majority', buyback: 'majority',
  // A gang's deal on the back room (U1c).
  gangDeal: 'majority', endGangDeal: 'majority',
});

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
export function rollSpec(b, request, actorId, { day, operatorRank = 0, params: p = BUSINESS_DEFAULTS, traits = null } = {}) {
  const arch = archetypeOf(b);
  const me = partnerOf(b, actorId);
  const use = request.use ?? null;
  if (use && (!['skill', 'ability', 'hire', 'staff'].includes(use.kind) || (use.kind === 'hire' && !HIRE_TIERS[use.hire]))) return fail('bad-use');

  if (request.type === 'setupRoll') {
    if (b.status !== 'forming') return fail('not-forming');
    if (me?.status !== 'active') return fail('not-partner');
    if (b.partners.some((x) => x.status === 'invited')) return fail('invites-pending');
    if (b.setup?.passed) return fail('setup-done');
    if (b.setup?.retryDay != null && day < b.setup.retryDay) return fail('setup-delay');
    if (!holders(b).some((x) => x.cash + gearValue(x) > 0)) return fail('no-contribution');
    return allowed(setupUses(arch), use, { dv: dvOf(p.setupDv), allowHire: true, bonusAvailable: false, funds: b.escrow, operatorRank, p, b, overtime: null, traits });
  }

  if (b.status !== 'open') return fail('not-open');
  // A player character on the staff rolling what a partner asked of them (E3): not a partner themselves.
  if (request.type === 'staffRoll') return askedSpec(b, request, actorId, use, { day, operatorRank, p, traits, extraAvailable: false });
  if (me?.status !== 'active' || !me.voting) return fail('not-partner');
  const extraAvailable = daysLeft(b, actorId, p) > 0;

  if (request.type === 'stepUpRoll') {
    const check = stepUpCheck(b, actorId, day, p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till - p.registration.fee, operatorRank, p, b, traits });
  }

  if (request.type === 'hideRoll') {
    // A holder builds a layer over their holding (B6d): Bureaucracy or Accounting, their own skill.
    const check = layerCheck(b, actorId, request, p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: check.dv, allowHire: false, bonusAvailable: false, extraAvailable: false, funds: b.till, operatorRank, p, b, traits });
  }

  if (request.type === 'defenceRoll') {
    // The target's officers defend against a takeover offer (B6b), once; a hired professional may too.
    if (!canRun(b, actorId)) return fail('not-officer');
    const check = defenceCheck(b, p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till, operatorRank, p, b, traits });
  }

  if (request.type === 'issueRoll' || request.type === 'buybackRoll') {
    // An officer makes a listed company's offering roll or times its buyback (B6a); a hired professional may too.
    if (!canRun(b, actorId)) return fail('not-officer');
    const check = capitalRollCheck(b, request.type === 'issueRoll' ? 'issue' : 'buyback', p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till, operatorRank, p, b, traits });
  }

  if (request.type === 'prospectusRoll') {
    // Officers make the prospectus rolls (B5a); a hired professional may too.
    if (!canRun(b, actorId)) return fail('not-officer');
    const check = prospectusCheck(b, request.part, p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till, operatorRank, p, b, traits });
  }

  if (request.type === 'charterRoll') {
    const check = charterRollCheck(b, actorId, request.part, p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till, operatorRank, p, b, traits });
  }

  if (request.type === 'loanRoll' || request.type === 'angelRoll') {
    const can = request.type === 'loanRoll' ? bankCheck(b, actorId, day, p) : angelCheck(b, actorId, day, p);
    if (!can.ok) return can;
    return allowed(can.uses, use, { dv: can.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till, operatorRank, p, b, traits });
  }

  // A company is run by its officers; any holder may still help (a complementary check).
  if (['action', 'respond', 'reportRoll', 'auditRoll', 'diligenceRoll', 'recruitRoll', 'vetRoll', 'trainRoll'].includes(request.type) && !canRun(b, actorId)) return fail('not-officer');

  if (request.type === 'recruitRoll') {
    const check = recruitCheck(b, request.post, day, p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till - check.cost, operatorRank, p, b, traits });
  }

  if (request.type === 'vetRoll') {
    const check = vetCheck(b, request.post, day, p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till - check.cost, operatorRank, p, b, traits });
  }

  if (request.type === 'trainRoll') {
    // The mentor's own lesson: no hired professional, no employee called in.
    const check = mentorCheck(b, request.staffId, actorId, day, p);
    if (!check.ok) return check;
    return allowed(check.uses, use, { dv: stageDv(b.stage, p), allowHire: false, bonusAvailable: false, extraAvailable: check.extraAvailable, funds: b.till - check.cost, p, b, overtime: null, traits });
  }

  if (request.type === 'auditRoll' || request.type === 'diligenceRoll') {
    const check = infoCheck(b, request.type === 'auditRoll' ? 'audit' : 'diligence', day, p);
    if (!check.ok) return check;
    // The player's window knows the target only by the name typed; the GM's service finds its id before the roll is applied.
    const named = String(request.targetName ?? '').trim().toLowerCase();
    if (request.type === 'diligenceRoll' && (request.targetId ? request.targetId === b.id : !named || named === b.name.toLowerCase())) return fail('bad-target');
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till - check.cost, operatorRank, p, b, traits });
  }

  if (request.type === 'respond') {
    const event = b.period.event;
    if (!event || !EVENTS[event.kind]) return fail('no-event');
    if (b.period.slots.some((s) => s.action === 'respond')) return fail('event-answered');
    if (b.period.slots.length >= (p.stages[b.stage]?.slots ?? 1)) return fail('no-slot');
    // A staff event's own employee (the one off sick, caught stealing, being poached...) cannot answer it.
    if (use?.kind === 'staff' && event.staffId && use.staffId === event.staffId) return fail('staff-involved');
    // A Lawman's Backup answers a raid once a month (X1).
    const uses = eventUses(b, event.kind).filter((u) => !(['raid', 'bust'].includes(event.kind) && u.ability === 'Backup' && backupWait(b, day, p) > 0));
    return allowed(uses, use, { dv: stageDv(b.stage, p), allowHire: true, bonusAvailable: false, extraAvailable, funds: b.till, operatorRank, p, b, traits });
  }

  if (request.type === 'action') {
    if (!actionFor(b.stage, request.action)) return fail('bad-action');
    const slots = p.stages[b.stage]?.slots ?? 1;
    if (b.period.slots.length >= slots) return fail('no-slot');
    if (b.period.slots.some((s) => s.action === request.action)) return fail('action-taken');
    // An action aimed at a faction (F1b): some must be, and the gift has to be there.
    const aim = p.standing.aims[request.action];
    if (aim?.required && !request.factionId) return fail('no-faction');
    if (request.factionId && !aim && request.action !== 'dealGang') return fail('bad-faction');
    if (request.factionId && aim && b.till < giftFor(b, p)) return fail('no-gift');
    if (request.action === 'campaign' || request.action === 'blackOps') {
      const campaign = campaignCheck(b, request.targetTicker, day, p, request.action === 'blackOps' ? p.crime.blackOpsCost : p.campaign.cost);
      if (!campaign.ok) return campaign;
    }
    // A gang deals only at neutral or better (U1c).
    if (request.action === 'dealGang' && (!request.factionId || dealCut(b.standings?.[request.factionId] ?? 'neutral', p) == null)) return fail('gang-refuses');
    if (request.action === 'bribeRegulator' && b.till < p.crime.bribeCost) return fail('no-funds');
    const bonusAvailable = b.period.bonuses.some((x) => x.action === request.action && !x.used);
    // The back room's actions need it open, and its kind says how it is worked (U1a).
    const room = ROOM_ACTIONS.includes(request.action) ? roomCheck(b, request.action, p, day) : null;
    if (room && !room.ok) return room;
    // A run takes a workshop and a line, and rolls at the book's DV for the item (P1a).
    const run = request.action === 'produce' ? produceCheck(b, p) : null;
    if (run && !run.ok) return run;
    if (request.action === 'fence') {
      const fence = fenceCheck(b);
      if (!fence.ok) return fence;
    }
    // A role's own action takes that role: no hired help (X1).
    const allowHire = !actionFor(b.stage, request.action).roleOnly;
    return allowed(room?.uses ?? actionUses(request.action, arch, b.stage), use, { dv: run?.dv ?? stageDv(b.stage, p), allowHire, bonusAvailable, extraAvailable, funds: b.till, operatorRank, p, b, traits });
  }

  if (request.type === 'assist') {
    if (!actionFor(b.stage, request.forAction)) return fail('bad-action');
    // An employee called in to help is a helper of their own; the partner who called them may still help.
    if (b.period.helpers.includes(use?.kind === 'staff' ? use.staffId : actorId)) return fail('helped');
    if (b.period.slots.some((s) => s.action === request.forAction)) return fail('action-taken');
    return allowed(helpUses(request.forAction, arch, b.stage), use, { dv: dvOf(p.helpDv), allowHire: false, bonusAvailable: false, extraAvailable, funds: b.till, p, b, overtime: 'help', traits });
  }

  if (request.type === 'reportRoll') {
    const check = reportCheck(b, p);
    if (!check.ok) return check;
    // A bookkeeper's work on the figures is the complementary +1 (DESIGN §32).
    const bookkeeper = activeStaff(b).some((s) => s.post === 'bookkeeper');
    return allowed(check.uses, use, { dv: check.dv, allowHire: true, bonusAvailable: bookkeeper, extraAvailable, funds: b.till, operatorRank, p, b, traits });
  }
  return fail('bad-request');
}

/**
 * Check a roll's use against what the roll allows. A hired professional needs the fee; an employee
 * called in for overtime (`overtime` is 'roll' or 'help', null where none can be) needs a shift left
 * and the pay, and rolls their best use for it, with its DV step.
 */
/**
 * What a player character on call may roll for the roll a partner asked of them: the roll's own skills
 * and DV, with their own Luck and any +1 waiting, but no extra time (business days are the partners'),
 * no hired professional and no employee; the overtime must still be payable, and they need a shift left.
 */
function askedSpec(b, request, actorId, use, { day, operatorRank, p, traits }) {
  const ask = askOf(b, request.askId);
  if (!ask) return fail('no-ask');
  const staff = staffOf(b, ask.staffId);
  if (staff?.status !== 'active' || staff.actorId !== actorId) return fail('not-asked');
  if (shiftsOf(b, staff.id) >= p.staff.maxShifts) return fail('no-shifts');
  const cost = overtimePay(b, staff, ask.roll.type === 'assist' ? 'help' : 'roll', p);
  if (b.till < cost) return fail('no-funds');
  let inner;
  if (ask.roll.type === 'assist') {
    // A help is the employee's own, whoever else has helped.
    if (!actionFor(b.stage, ask.roll.forAction)) return fail('bad-action');
    if (b.period.helpers.includes(staff.id)) return fail('helped');
    if (b.period.slots.some((s) => s.action === ask.roll.forAction)) return fail('action-taken');
    inner = { ok: true, uses: helpUses(ask.roll.forAction, archetypeOf(b), b.stage), dv: dvOf(p.helpDv), bonusAvailable: false };
  } else {
    inner = rollSpec(b, { ...ask.roll, use: null }, ask.by, { day, operatorRank, params: p, traits });
    if (!inner.ok) return inner;
  }
  return allowed(inner.uses, use, { dv: inner.dv, allowHire: false, bonusAvailable: inner.bonusAvailable, extraAvailable: false, funds: b.till - cost, p, b, overtime: null, traits, pay: cost });
}

function allowed(uses, use, { funds = 0, operatorRank = 0, p = BUSINESS_DEFAULTS, b = null, overtime = 'roll', traits = null, ...spec }) {
  if (use?.kind === 'staff') {
    if (!overtime || !b) return fail('staff-not-allowed');
    const call = staffRoll(b, use, uses, overtime, funds, p, traits);
    if (!call.ok) return call;
    return { ok: true, uses, ...spec, use: call.use, dv: spec.dv + call.dvAdd, extraAvailable: false, overtime: call.cost };
  }
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
  const ctx = { approval: true, weekday: 1, operatorRank: 0, actors: {}, wealthOf: () => 0, gear: [], traits: {}, ...context };
  const out = { wealth: {}, events: [], items: {}, taken: {}, traits: {} };
  const pay = (actorId, amount) => {
    out.wealth[actorId] = (out.wealth[actorId] ?? 0) + amount;
  };

  if (request.type === 'found') {
    const made = found(request, actor, day, ctx, p);
    if (!made.ok) return made;
    pay(actor.id, -made.business.escrow);
    take(out, actor.id, made.business.partners[0].gear);
    return { ok: true, business: made.business, ...out };
  }

  if (!business) return fail('no-business');
  if (ROLL_REQUESTS.includes(request.type) && !request.use) return fail('bad-use');
  const b = structuredClone(normalizeBusiness(business));
  // A company in administration takes cash in, but nothing that acts, draws, decides or moves capital (B6c).
  if (b.administration && ADMINISTRATION_REFUSES.includes(request.type)) return fail('administration');
  const me = partnerOf(b, actor.id);
  const log = (kind, amount, note = {}) => addLedger(b, { day, kind, amount, actorId: actor.id, ...note }, p);
  /** Pay for who made the roll: a hired professional's fee, or an employee's overtime (`kind` 'roll' or 'help'). */
  const spendFor = (kind) => {
    if (request.use.kind === 'hire') {
      const fee = hireFee(request.use.hire, ctx.operatorRank, p);
      b.till -= fee;
      log('hire', -fee);
    } else if (request.use.kind === 'staff') {
      const paid = payOvertime(b, request.use.staffId, kind, day, actor.id, p, ctx.traits);
      if (paid.actorId) pay(paid.actorId, paid.cost);
    }
  };
  /** Who a slot or a help is by: the partner, or the employee they called in. */
  const rollerId = () => (request.use?.kind === 'staff' ? request.use.staffId : actor.id);

  switch (request.type) {
    case 'join': {
      if (me?.status !== 'invited') return fail('not-invited');
      if (b.status === 'open' && me.offer) {
        // An investor buying in on the terms the partners agreed.
        const done = acceptInvestment(b, me, actor.wealth, day, p);
        if (!done.ok) return done;
        me.name = actor.name;
        me.heirId = heirOf(request.heirId, actor.id, ctx);
        pay(actor.id, -done.amount);
        break;
      }
      if (b.status !== 'forming') return fail('not-forming');
      const money = contribution(request, actor, p, p.maxGearItems, ctx.gear);
      if (!money.ok) return money;
      Object.assign(me, { status: 'active', name: actor.name, cash: money.cash, gear: money.gear, heirId: heirOf(request.heirId, actor.id, ctx) });
      take(out, actor.id, money.gear);
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
      const running = b.status === 'open';
      if (!running && b.status !== 'forming') return fail('not-forming');
      if (me?.status !== 'active') return fail('not-partner');
      const money = contribution(request, actor, p, p.maxGearItems - me.gear.length, ctx.gear);
      if (!money.ok) return money;
      if (!money.cash && !money.gear.length) return fail('bad-amount');
      const worth = money.gear.reduce((a, g) => a + g.value, 0);
      take(out, actor.id, money.gear);
      me.cash += money.cash;
      me.gear.push(...money.gear);
      pay(actor.id, -money.cash);
      log('contribution', money.cash, { gear: worth });
      if (running) {
        // A top-up: the money goes into the till and the gear into the fit-out. Nobody's units
        // change, so every holder gains in proportion to their stake.
        b.till += money.cash;
        b.assets += worth;
      } else {
        b.escrow += money.cash;
        tryOpen(b, day, ctx, out.events, p);
      }
      break;
    }
    case 'withdraw': {
      if (b.status !== 'forming') return fail('not-forming');
      if (me?.status !== 'active') return fail('not-partner');
      const refund = refundShare(b, me);
      b.escrow -= refund;
      me.status = 'left';
      pay(actor.id, refund);
      giveBack(out, me);
      log('refund', -refund);
      if (!holders(b).length) close(b, day, 'cancelled');
      else if (b.founderId === actor.id) b.founderId = holders(b)[0].actorId;
      break;
    }
    case 'setupRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
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
    case 'buyStock': {
      if (request.syndicateId) return fail('syndicate-no-items');
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || (b.stage >= 2 && !canRun(b, actor.id))) return fail('not-officer');
      const bought = buyStock(b, actor, String(request.uuid ?? ''), request.count, day, out, p);
      if (!bought.ok) return bought;
      break;
    }
    case 'consign': {
      if (request.syndicateId) return fail('syndicate-no-items');
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active') return fail('not-partner');
      if (!makesThings(b, p)) return fail('no-workshop-use');
      const consigned = consignStock(b, actor, ctx.gear, day, out, p);
      if (!consigned.ok) return consigned;
      take(out, actor.id, ctx.gear);
      break;
    }
    case 'takeBack': {
      const back = takeBackStock(b, actor, String(request.uuid ?? ''), day, out, p);
      if (!back.ok) return back;
      break;
    }
    case 'setLine': {
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting || !canRun(b, actor.id)) return fail('not-officer');
      // The GM's service found the item on this kind of business's list; the request's own word for it is not used.
      if (request.uuid && !ctx.lineItem) return fail('bad-line');
      // A world with its underworld switched off has no illegal production (P1c).
      if (request.uuid && ctx.lineItem.illegal && ctx.underworld === false) return fail('illegal-off');
      const set = setLine(b, request.uuid ? ctx.lineItem : null, request.qty, p);
      if (!set.ok) return set;
      break;
    }
    case 'action': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      const dealing = request.action === 'dealGang';
      const aim = request.factionId && !dealing ? aimCheck(b, request.action, request.factionId, ctx.factions ?? [], p) : null;
      if (aim && !aim.ok) return aim;
      const aimsAtCompany = request.action === 'campaign' || request.action === 'blackOps';
      const target = aimsAtCompany ? (ctx.companies ?? []).find((c) => c.ticker === request.targetTicker) : null;
      if (aimsAtCompany && !target) return fail('bad-target');
      // A gang on the turf (U1c).
      const gang = dealing ? (ctx.factions ?? []).find((f) => f.id === request.factionId && f.kind === 'gang' && f.districts?.includes(b.district)) : null;
      if (dealing && !gang) return fail('bad-faction');
      spendFor('roll');
      const r = check.result;
      if (r.bonus) {
        const bonus = b.period.bonuses.find((x) => x.action === request.action && !x.used);
        if (bonus) bonus.used = true;
      }
      if (r.extra) spendDays(b, actor.id, 1);
      b.period.slots.push({
        action: request.action, by: rollerId(), use: useKey(request.use), band: r.band, total: r.total, dv: r.dv, approach: r.approach, luck: r.luck, bonus: r.bonus,
        ...(aim ? { factionId: aim.faction.id, factionName: aim.faction.name } : {}),
        ...(target ? { factionName: target.name } : {}),
        ...(gang ? { factionId: gang.id, factionName: gang.name } : {}),
      });
      out.events.push({ type: 'roll', action: request.action, band: r.band, exposure: r.exposure });
      if (aim) {
        b.till -= aim.gift;
        addLedger(b, { day, kind: 'factionGift', amount: -aim.gift }, p);
        out.events.push({ type: 'factionDeal', factionId: aim.faction.id, band: r.band });
      }
      if (dealing) runDealRoll(b, { faction: gang, band: r.band, day }, p);
      if (request.action === 'bribeRegulator') {
        payRegulator(b, r.band, day, out, p);
      }
      if (request.action === 'blackOps') out.events.push(...runBlackOps(b, { ticker: target.ticker, name: target.name, band: r.band, actorId: actor.id, day, approval: ctx.campaignApproval !== false }, p));
      if (request.action === 'supply') runSupply(b, { band: r.band, day }, p);
      if (request.action === 'venue') runVenue(b, { band: r.band }, p);
      if (target && request.action === 'campaign') {
        out.events.push(...runCampaign(b, { ticker: target.ticker, name: target.name, useKey: useKey(request.use), band: r.band, actorId: actor.id, day, approval: ctx.campaignApproval !== false }, p));
      }
      break;
    }
    case 'assist': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('help');
      b.period.helpers.push(rollerId());
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      if (r.success) b.period.bonuses.push({ id: request.key, action: request.forAction, by: rollerId(), used: false });
      out.events.push({ type: 'roll', action: 'assist', forAction: request.forAction, band: r.band, exposure: r.exposure });
      break;
    }
    case 'takeDirty': {
      if (me?.status !== 'active' || !me.voting) return fail('not-partner');
      // At a company, the back room is the officers' secret.
      if (!canRun(b, actor.id)) return fail('not-officer');
      const taken = takeDirty(b, request.amount, p);
      if (!taken.ok) return taken;
      pay(actor.id, taken.amount);
      log('dirtyTaken', 0);
      out.events.push({ type: 'dirtyTaken', exposure: taken.exposure });
      break;
    }
    case 'gangDealOfficer': {
      if (b.stage < 2) return fail('not-company');
      if (me?.status !== 'active' || !me.voting || !canRun(b, actor.id)) return fail('not-officer');
      const done = request.end ? endDeal(b) : takeDeal(b, day);
      if (!done.ok) return done;
      if (request.end) out.events.push({ type: 'factionMove', factionId: done.factionId, amount: p.backRoom.deal.end });
      break;
    }
    case 'lieLow': {
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting || !canRun(b, actor.id)) return fail('not-partner');
      if (!openRoom(b)) return fail('no-back-room');
      if (b.period.slots.length >= (p.stages[b.stage]?.slots ?? 1)) return fail('no-slot');
      if (b.period.slots.some((s) => ['lieLow', 'roomWork', 'bigNight', 'fence'].includes(s.action))) return fail('action-taken');
      b.period.slots.push({ action: 'lieLow', by: actor.id, use: 'none', band: 'solid', total: 0, dv: 0, approach: 'standard', luck: 0, bonus: 0 });
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
      if (b.status === 'closed') return fail('not-open');
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
      const can = canPropose(b, kind, request, { ...ctx, day }, p);
      if (!can.ok) return can;
      // A shareholders' vote would tell them all, so at a company the officers fill the back room's posts.
      if (kind === 'hire' && b.stage >= 2 && POSTS[can.terms.post]?.backRoom) {
        if (!canRun(b, actor.id)) return fail('not-officer');
        const done = enactHire(b, can.terms, day, ctx, p);
        if (!done.ok) return done;
        out.events.push({ type: done.staff.status === 'active' ? 'hired' : 'jobOffered', staffId: done.staff.id, actorId: done.staff.actorId });
        break;
      }
      b.proposals.push({ id: request.key, kind, by: actor.id, day, expires: day + p.proposalDays, votes: { [actor.id]: true }, ...(can.terms ? { terms: can.terms } : {}) });
      settleProposals(b, day, out, p, ctx);
      break;
    }
    case 'stepUpRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      const { stepped } = applyStepUp(b, actor.id, r, day, p);
      out.events.push({ type: 'roll', action: 'stepUp', band: r.band, exposure: r.exposure }, ...(stepped ? [{ type: 'steppedUp', stage: b.stage }] : []));
      break;
    }
    case 'charterRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      const done = applyCharterRoll(b, actor.id, request.part, r, day, p);
      out.events.push({ type: 'roll', action: `charter.${request.part}`, band: r.band, exposure: r.exposure });
      if (done.refused) out.events.push({ type: 'charterRefused' });
      if (done.awaiting) out.events.push({ type: 'charterAwaiting' });
      break;
    }
    case 'issueRoll':
    case 'buybackRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      if (request.type === 'issueRoll' && !(ctx.marketPrice > 0)) return fail('no-price');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      out.events.push({ type: 'roll', action: request.type, band: r.band, exposure: r.exposure });
      if (request.type === 'issueRoll') {
        const done = applyOfferingRoll(b, actor.id, r, { day, price: ctx.marketPrice }, p);
        out.events.push({ type: done.failed ? 'offeringFailed' : 'offeringSet' });
      } else {
        applyTimingRoll(b, actor.id, r, day, p);
        out.events.push({ type: 'buybackTimed' });
      }
      break;
    }
    case 'prospectusRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      const done = applyProspectusRoll(b, actor.id, request.part, r, day, p);
      out.events.push({ type: 'roll', action: `prospectus.${request.part}`, band: r.band, exposure: r.exposure });
      if (done.ready) out.events.push({ type: 'listingReady' });
      if (done.failed) out.events.push({ type: 'listingFailed' });
      break;
    }
    case 'reportRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      const bold = r.approach === 'bold';
      b.reportPrep = { band: r.band, total: r.total ?? null, bold, by: actor.id, day };
      out.events.push({ type: 'roll', action: 'report', band: r.band, exposure: (r.exposure ?? 0) + (bold ? p.report.boldExposure : 0) });
      break;
    }
    case 'auditRoll':
    case 'diligenceRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      if (request.type === 'auditRoll') {
        const done = applyInternalAudit(b, { result: r, day, exposure: ctx.exposure ?? 0, by: actor.id }, p);
        // A passed audit turns up who has been talking (U1b).
        const mole = r.success ? informants(b, ctx.traits)[0] : null;
        if (mole) b.lastAudit.informant = mole.name;
        out.events.push({ type: 'roll', action: 'audit', band: r.band, exposure: (r.exposure ?? 0) + done.exposure });
      } else {
        applyDiligence(b, { result: r, day, targetId: request.targetId, target: ctx.targets?.[request.targetId] ?? null, by: actor.id }, p);
        // What it found can back a Media's story, if the target is on the market (F1c).
        if (b.intel?.at(-1)?.bands) out.events.push({ type: 'evidenceFound', targetId: request.targetId, actorId: actor.id });
        out.events.push({ type: 'roll', action: 'diligence', band: r.band, exposure: r.exposure ?? 0 });
      }
      break;
    }
    case 'recruitRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      const { applicants, traits } = applyRecruit(b, { result: r, day, post: request.post, key: request.key, seed: ctx.seed, by: actor.id }, p);
      Object.assign(out.traits, traits);
      out.events.push({ type: 'roll', action: 'recruit', band: r.band, exposure: r.exposure ?? 0 }, { type: 'applicants', post: request.post, applicants });
      break;
    }
    case 'vetRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      const checked = applyVet(b, { result: r, day, post: request.post, traits: ctx.traits, by: actor.id }, p);
      out.events.push({ type: 'roll', action: 'vet', band: r.band, exposure: r.exposure ?? 0 }, { type: 'vetted', post: request.post, count: checked.length });
      break;
    }
    case 'askStaff': {
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting) return fail('not-partner');
      if (!canRun(b, actor.id)) return fail('not-officer');
      const roll = request.roll ?? {};
      const can = askCheck(b, request.staffId, roll, p);
      if (!can.ok) return can;
      // The roll must be one the partner could make now (a free slot, an unanswered event).
      if (roll.type !== 'assist') {
        const now = rollSpec(b, { type: roll.type, action: roll.action, use: null }, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
        if (!now.ok) return now;
      } else if (!actionFor(b.stage, roll.forAction) || b.period.slots.some((s) => s.action === roll.forAction)) return fail('action-taken');
      const clean = roll.type === 'action' ? { type: 'action', action: roll.action } : roll.type === 'assist' ? { type: 'assist', forAction: roll.forAction } : { type: 'respond' };
      b.period.asks = [...(b.period.asks ?? []), { id: request.key, staffId: request.staffId, roll: clean, by: actor.id, day }];
      out.events.push({ type: 'asked', staffId: request.staffId, roll: clean });
      break;
    }
    case 'addTeam': {
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting) return fail('not-partner');
      if (!canRun(b, actor.id)) return fail('not-officer');
      // The Exec's own Teamwork rank, read from their sheet by the GM's service.
      const rank = Number(ctx.basesOf?.(actor.id)?.['ability:Teamwork'] ?? 0);
      const done = addTeamMember(b, { actorId: actor.id, post: request.post, name: request.name, rank, day, key: request.key, memberId: request.actorId ?? null, teamActors: ctx.teamActors ?? {} }, p);
      if (!done.ok) return done;
      out.events.push({ type: 'teamJoined', staffId: done.staff.id });
      break;
    }
    case 'teamCare': {
      if (b.status !== 'open') return fail('not-open');
      const done = teamCare(b, request.staffId, actor.id, request.how, day, p);
      if (!done.ok) return done;
      break;
    }
    case 'cancelAsk': {
      const ask = askOf(b, request.askId);
      if (!ask) return fail('no-ask');
      // Withdrawn by whoever runs the business, or declined by the employee asked.
      const employee = staffOf(b, ask.staffId)?.actorId === actor.id;
      if (!employee && !(me?.status === 'active' && me.voting && canRun(b, actor.id))) return fail('not-partner');
      b.period.asks = b.period.asks.filter((a) => a.id !== ask.id);
      out.events.push({ type: 'askCancelled', staffId: ask.staffId, declined: employee });
      break;
    }
    case 'staffRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      const ask = askOf(b, request.askId);
      const staff = staffOf(b, ask.staffId);
      payOvertime(b, staff.id, ask.roll.type === 'assist' ? 'help' : 'roll', day, ask.by, p, ctx.traits);
      b.period.asks = b.period.asks.filter((a) => a.id !== ask.id);
      const r = check.result;
      const roll = { use: useKey(request.use), band: r.band, total: r.total, dv: r.dv, approach: r.approach, luck: r.luck };
      if (ask.roll.type === 'action') {
        if (r.bonus) {
          const bonus = b.period.bonuses.find((x) => x.action === ask.roll.action && !x.used);
          if (bonus) bonus.used = true;
        }
        b.period.slots.push({ action: ask.roll.action, by: staff.id, ...roll, bonus: r.bonus });
      } else if (ask.roll.type === 'respond') {
        b.period.slots.push({ action: 'respond', event: b.period.event.kind, by: staff.id, ...roll, bonus: 0 });
      } else {
        b.period.helpers.push(staff.id);
        if (r.success) b.period.bonuses.push({ id: request.key, action: ask.roll.forAction, by: staff.id, used: false });
      }
      out.events.push({ type: 'roll', action: ask.roll.type === 'action' ? ask.roll.action : ask.roll.type, band: r.band, exposure: r.exposure, staffId: staff.id });
      break;
    }
    case 'trainRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      const r = check.result;
      // The mentor's own base in the skill, from their sheet, must be higher (checked before anything is spent).
      const done = applyTraining(b, request.staffId, { mentor: true, basesOf: ctx.basesOf, by: actor.id, day, result: r }, p);
      if (!done.ok) return done;
      spendFor('roll');
      if (r.extra) spendDays(b, actor.id, 1);
      out.events.push({ type: 'roll', action: 'train', band: r.band, exposure: r.exposure ?? 0 }, { type: 'trained', staffId: request.staffId, learned: done.learned, band: r.band });
      break;
    }
    case 'bonus':
    case 'train':
    case 'refuseRaise':
    case 'movePost':
    case 'rejectApplicant': {
      // Day-to-day running: whoever runs the business (an officer, at a company).
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting) return fail('not-partner');
      if (!canRun(b, actor.id)) return fail('not-officer');
      if (request.type === 'bonus') {
        const done = payBonus(b, request.staffId, request.quarters, day, actor.id, ctx.traits, p);
        if (!done.ok) return done;
        if (done.actorId) pay(done.actorId, done.amount);
        out.events.push({ type: 'bonus', staffId: request.staffId, amount: done.amount });
      } else if (request.type === 'train') {
        // A course; a mentor's lesson is rolled (trainRoll).
        if (request.mentor) return fail('mentor-roll');
        const done = applyTraining(b, request.staffId, { mentor: false, by: actor.id, day }, p);
        if (!done.ok) return done;
        out.events.push({ type: 'trained', staffId: request.staffId, skill: done.skill, base: done.base });
      } else if (request.type === 'rejectApplicant') {
        const done = rejectApplicant(b, request.candidateId, day, actor.id, p);
        if (!done.ok) return done;
      } else if (request.type === 'refuseRaise') {
        const done = refuseRaise(b, request.staffId, day, ctx.traits, p);
        if (!done.ok) return done;
      } else {
        const done = movePost(b, request.staffId, request.post, day, actor.id, p);
        if (!done.ok) return done;
        out.events.push({ type: 'moved', staffId: request.staffId, post: request.post });
      }
      break;
    }
    case 'acceptJob':
    case 'declineJob': {
      // From the employee's own character: the job they were offered here.
      const job = (b.staff ?? []).find((s) => s.actorId === actor.id && s.status === 'offered');
      if (!job) return fail('no-offer');
      const done = answerJob(b, job.id, request.type === 'acceptJob', day, p);
      if (!done.ok) return done;
      out.events.push({ type: request.type === 'acceptJob' ? 'jobAccepted' : 'jobDeclined', staffId: job.id });
      break;
    }
    case 'quitJob': {
      const job = (b.staff ?? []).find((s) => s.actorId === actor.id);
      if (!job) return fail('not-staff');
      quitJob(b, job.id, day, p);
      out.events.push({ type: 'quit', staffId: job.id });
      break;
    }
    case 'hideRoll': {
      // The service checks the fee and the broker first and passes them in (`ctx.hide`); it is paid either way.
      if (!ctx.hide?.ok) return fail(ctx.hide?.reason ?? 'no-broker');
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      const kind = layerCheck(b, actor.id, request, p).kind;
      const r = check.result;
      const done = addLayer(b, actor.id, { kind, name: kind === 'nominee' ? ctx.hide.broker : request.name, day, result: r, ref: ctx.newId });
      out.events.push({ type: 'layerRolled', holderId: actor.id, kind, name: done.name, added: done.added, band: r.band, fee: ctx.hide.fee });
      if (done.added) out.layerTotals = [...(out.layerTotals ?? []), { holderId: actor.id, index: done.index, total: r.total }];
      break;
    }
    case 'dropLayer': {
      const done = dropLayers(b, actor.id);
      if (!done.ok) return done;
      out.events.push({ type: 'layerDropped', holderId: actor.id });
      break;
    }
    case 'bid': {
      // A tender offer for the company (B6b), by anyone; it waits for the GM.
      const can = takeoverOffer(b, actor.id, request);
      if (!can.ok) return can;
      makeTakeover(b, actor, can.terms, day, p);
      out.events.push({ type: 'takeoverBid', bidderId: actor.id, price: can.terms.price, shares: can.terms.shares });
      break;
    }
    case 'tender': {
      const done = tenderShares(b, actor.id, request.qty, day);
      if (!done.ok) return done;
      out.events.push({ type: 'tendered', qty: done.qty });
      break;
    }
    case 'defenceRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      applyDefence(b, actor.id, r, day, p);
      out.events.push({ type: 'roll', action: 'defenceRoll', band: r.band, exposure: r.exposure }, { type: 'takeoverDefended', band: r.band });
      break;
    }
    case 'rightsTake': {
      // A holder takes up new shares in a rights issue (B6a).
      const done = takeRights(b, actor, request.qty, day, p);
      if (!done.ok) return done;
      pay(actor.id, -done.cost);
      out.events.push({ type: 'rightsTaken', qty: Math.floor(Number(request.qty)), cost: done.cost });
      break;
    }
    case 'sellBack': {
      // A holder sells units back in a tender (B6a).
      const done = sellBack(b, actor, request.qty, day, p);
      if (!done.ok) return done;
      pay(actor.id, done.cash);
      out.events.push({ type: 'soldBack', qty: Math.floor(Number(request.qty)), cash: done.cash });
      break;
    }
    case 'charterFund': {
      const done = fundCharter(b, actor, request.cash, day, p);
      if (!done.ok) return done;
      pay(actor.id, -done.cash);
      if (done.formed) out.events.push({ type: 'chartered' });
      break;
    }
    case 'respond': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      b.period.slots.push({
        action: 'respond', event: b.period.event.kind, by: rollerId(), use: useKey(request.use), band: r.band, total: r.total, dv: r.dv, approach: r.approach, luck: r.luck, bonus: 0,
      });
      out.events.push({ type: 'roll', action: 'respond', band: r.band, exposure: r.exposure });
      if (['raid', 'bust'].includes(b.period.event.kind) && request.use?.ability === 'Backup') b.lastBackupDay = day;
      break;
    }
    case 'loanRoll':
    case 'angelRoll': {
      const spec = rollSpec(b, request, actor.id, { day, operatorRank: ctx.operatorRank, params: p, traits: ctx.traits });
      if (!spec.ok) return spec;
      if (!check?.ok) return fail(check?.reason ?? 'no-roll');
      spendFor('roll');
      const r = check.result;
      if (r.extra) spendDays(b, actor.id, 1);
      if (request.type === 'loanRoll') {
        const loan = applyBankRoll(b, { id: request.key, result: r, amount: request.amount, day }, p);
        out.events.push({ type: 'roll', action: 'bankLoan', band: r.band, exposure: r.exposure }, { type: 'bankLoan', ...loan });
      } else {
        const angel = applyAngelRoll(b, { id: request.key, result: r, day }, p);
        out.events.push({ type: 'roll', action: 'angel', band: r.band, exposure: r.exposure }, { type: 'angel', ...angel });
      }
      break;
    }
    case 'repayLoan': {
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting) return fail('not-partner');
      const paid = repayLoan(b, request.loanId, request.amount, day, p);
      if (!paid.ok) return paid;
      break;
    }
    case 'addDays': {
      if (b.status !== 'open') return fail('not-open');
      if (me?.status !== 'active' || !me.voting) return fail('not-partner');
      const added = addProjectDays(b, actor.id, request.projectId, request.days, { growthRate: ctx.growthRate ?? 1, day, approval: ctx.approval !== false, params: p });
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
      settleProposals(b, day, out, p, ctx);
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
  const money = contribution(request, actor, p, p.maxGearItems, ctx.gear);
  if (!money.ok) return money;

  const invite = [...new Set((request.invite ?? []).map(String))].filter((id) => id !== actor.id);
  if (invite.length > p.maxPartners - 1) return fail('too-many-partners');
  // An NPC is a silent partner under an `npc:` id, as an angel is: the GM answers for it, and its money stays off its sheet.
  // A Messenger contact with no actor is one too, by the contact alone (`contact:` ids).
  const npcs = { ...(ctx.teamActors ?? {}), ...(ctx.investorContacts ?? {}) };
  if (invite.some((id) => !(id in ctx.actors) && !(id in npcs))) return fail('bad-partner');
  const partnerId = (id) => (id in npcs ? `npc:${id}` : id);
  const founders = new Set([actor.id, ...invite.map(partnerId)]);
  let sweat = null;
  if (request.sweat?.actorId && Number(request.sweat.pct) > 0) {
    const pct = int(request.sweat.pct);
    const sweatId = partnerId(request.sweat.actorId);
    if (!founders.has(sweatId) || pct > p.maxSweatPct) return fail('bad-sweat');
    sweat = { actorId: sweatId, pct };
  }

  const business = normalizeBusiness({
    id: ctx.newId,
    name,
    archetype: request.archetype,
    location: text(request.location, 80),
    district: isDistrict(request.district) ? request.district : '',
    status: 'forming',
    founderId: actor.id,
    createdDay: day,
    partners: [
      { actorId: actor.id, name: actor.name, status: 'active', cash: money.cash, gear: money.gear, heirId: heirOf(request.heirId, actor.id, ctx) },
      ...invite.map((id) => (id in npcs
        ? { actorId: partnerId(id), ...(id.startsWith('contact:') ? {} : { actorRef: id }), name: npcs[id], status: 'invited', cash: 0, gear: [], voting: false, npc: true }
        : { actorId: id, name: ctx.actors[id], status: 'invited', cash: 0, gear: [] })),
    ],
    agreement: { sweat, buyoutDays: p.buyoutDays },
    escrow: money.cash,
  });
  addLedger(business, { day, kind: 'founded', amount: money.cash, actorId: actor.id, gear: gearValue(business.partners[0]) }, p);
  return { ok: true, business };
}

/**
 * The GM answers a founding invitation for an NPC. What it puts in is the GM's word and comes off no sheet.
 * @param {object} b - the business, changed in place
 * @param {string} partnerId - the partner's `npc:` id
 * @param {{yes: boolean, cash?: number}} answer
 */
export function answerNpcPartner(b, partnerId, { yes, cash = 0 }, day, p = BUSINESS_DEFAULTS) {
  if (b.status !== 'forming') return fail('not-forming');
  const x = b.partners.find((y) => y.actorId === partnerId && y.npc && y.status === 'invited');
  if (!x) return fail('not-invited');
  if (!yes) {
    x.status = 'declined';
    return { ok: true };
  }
  const amount = Number(cash);
  if (!Number.isFinite(amount) || amount < 0) return fail('bad-amount');
  x.status = 'active';
  x.cash = int(amount);
  b.escrow += x.cash;
  addLedger(b, { day, kind: 'contribution', amount: x.cash, actorId: x.actorId, gear: 0 }, p);
  return { ok: true };
}

/**
 * A contribution's cash and gear, checked against what the character has. The gear is what the GM's
 * service found when it looked up the items dragged in (`itemGear`), never the request's own word.
 */
function contribution(request, actor, p, gearRoom = p.maxGearItems, found = []) {
  const cash = int(request.cash);
  if (cash < 0) return fail('bad-amount');
  if (cash > actor.wealth) return fail('insufficient-funds');
  const gear = found
    .map((g) => ({
      name: text(g?.name, 60), value: int(g?.value), ...(g.uuid ? { uuid: g.uuid } : {}), ...(g.img ? { img: g.img } : {}), ...(g.item ? { item: g.item } : {}),
    }))
    .filter((g) => g.name && g.value > 0);
  if (gear.length > gearRoom || gear.some((g) => g.value > p.maxGearValue)) return fail('bad-gear');
  return { ok: true, cash, gear };
}

/** Items that come off a character's sheet with a request (the service deletes them once it is saved). */
function take(out, actorId, gear) {
  const ids = gear.filter((g) => g.item && g.item._sourceId).map((g) => g.item._sourceId);
  if (ids.length) out.taken[actorId] = [...(out.taken[actorId] ?? []), ...ids];
}

/** Give a partner's items back when the business never opens: the service recreates them on the sheet. */
function giveBack(out, partner) {
  const items = partner.gear.filter((g) => g.item).map((g) => {
    const { _sourceId, ...data } = g.item;
    return data;
  });
  if (items.length) out.items[partner.actorId] = [...(out.items[partner.actorId] ?? []), ...items];
  partner.gear = partner.gear.map(({ item, ...g }) => ({ ...g, ...(item ? { returned: true } : {}) }));
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
  openBusiness(b, day, ctx.weekday, p, ctx.seed);
  events.push({ type: 'opened' });
}

/**
 * Open a business: contributions become units (one per eb of cash or gear at book value, plus any
 * sweat slice), the setup cost becomes its fit-out, and the rest of the money its till.
 */
export function openBusiness(business, day, weekday, p = BUSINESS_DEFAULTS, seed = 'nci') {
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
  startPeriod(b, 1, day, weekday, seed, p);
  addLedger(b, { day, kind: 'opened', amount: -cashSpent }, p);
  return b;
}

/** GM: let a business that is waiting open. */
export function approveBusiness(business, day, weekday, p = BUSINESS_DEFAULTS, seed = 'nci') {
  const b = structuredClone(normalizeBusiness(business));
  if (b.status !== 'pending') return fail('not-pending');
  return { ok: true, business: openBusiness(b, day, weekday, p, seed), wealth: {} };
}

/** GM: approve a charter waiting for it (DESIGN §31): it is formed at once, or its funding window opens. */
export function approveBusinessCharter(business, day, p = BUSINESS_DEFAULTS) {
  const b = structuredClone(normalizeBusiness(business));
  const done = approveCharter(b, day, p);
  if (!done.ok) return done;
  return { ok: true, business: b, wealth: {}, events: [{ type: done.formed ? 'chartered' : 'charterFunding' }] };
}

/** GM: turn a charter down. Anything paid in is refunded; the fee is not. */
export function rejectBusinessCharter(business, day, p = BUSINESS_DEFAULTS) {
  const b = structuredClone(normalizeBusiness(business));
  if (!['awaiting', 'funding', 'rolling'].includes(b.charter?.status)) return fail('not-awaiting');
  const wealth = dropCharter(b, day, 'rejected', p);
  return { ok: true, business: b, wealth, events: [{ type: 'charterRejected' }] };
}

/** GM: approve a listing waiting for it (B5a): the prospectus rolls open. */
export function approveBusinessListing(business, day, p = BUSINESS_DEFAULTS) {
  const b = structuredClone(normalizeBusiness(business));
  const done = approveListing(b, day, p);
  if (!done.ok) return done;
  addLedger(b, { day, kind: 'listingApproved', amount: 0 }, p);
  return { ok: true, business: b, wealth: {}, events: [{ type: 'listingApproved' }] };
}

/** GM: turn a listing down (the fee is not refunded). */
export function rejectBusinessListing(business, day, p = BUSINESS_DEFAULTS) {
  const b = structuredClone(normalizeBusiness(business));
  const done = rejectListing(b, day, p);
  if (!done.ok) return done;
  return { ok: true, business: b, wealth: {}, events: [{ type: 'listingRejected' }] };
}

/** GM: turn a business down before it opens. Every partner gets their share of the escrow back. */
export function rejectBusiness(business, day, p = BUSINESS_DEFAULTS) {
  const b = structuredClone(normalizeBusiness(business));
  if (b.status !== 'pending' && b.status !== 'forming') return fail('not-pending');
  const wealth = {};
  const out = { items: {} };
  const shares = holders(b).map((x) => [x, refundShare(b, x)]);
  for (const [x, refund] of shares) {
    if (refund > 0) wealth[x.actorId] = refund;
    addLedger(b, { day, kind: 'refund', amount: -refund, actorId: x.actorId }, p);
    giveBack(out, x);
  }
  b.escrow = 0;
  close(b, day, 'rejected');
  return { ok: true, business: b, wealth, items: out.items };
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
  // Stock goes in at what it cost; the rest of the assets at their salvage (P1b).
  const stock = clearStock(b, out);
  const salvage = stock + Math.round(Math.max(0, b.assets - stock) * (reason === 'failed' ? p.salvage.failed : p.salvage.closed));
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

/**
 * Whether a proposal of this kind could pass now (checked again when it does), and its terms: the
 * amount of a fixer's loan, or who an investor is, how much they put in and at what price per unit.
 */
function canPropose(b, kind, request, ctx, p) {
  switch (kind) {
    case 'stepUp': {
      // A chartered company steps up by listing, which names the float (B5a).
      if (b.stage === 2) {
        const can = canList(b, { float: request.float, day: ctx.day, threshold: ctx.listingThreshold }, p);
        return can.ok ? { ok: true, terms: { float: can.float } } : can;
      }
      // A registered business steps up by chartering, which names its ticker (B4a).
      if (b.stage === 1) {
        const can = canCharter(b, { ticker: request.ticker, day: ctx.day, taken: ctx.tickers ?? [] }, p);
        return can.ok ? { ok: true, terms: { ticker: can.ticker } } : can;
      }
      if (b.stepUp?.approved) return fail('already-agreed');
      const m = milestones(b, p);
      if (!m.available) return fail('no-step-up');
      if (!m.met) return fail('milestones');
      return { ok: true };
    }
    case 'expansion':
      return expansionOffer(b, p);
    case 'project': {
      if (!PROJECT_KINDS.includes(request.project)) return fail('bad-project');
      // A back room is the underworld's, which a world can switch off; its kind must suit the front (U1a).
      if (request.project === 'backRoom' && (ctx.underworld === false || !roomKinds(b).includes(request.room))) return fail('bad-project');
      // A connected room chooses its faction on opening, if the world has any (U2).
      let roomFaction = null;
      if (request.project === 'backRoom' && kindProfile(b.archetype, request.room) === 'connected' && (ctx.factions ?? []).length) {
        roomFaction = ctx.factions.find((f) => f.id === request.roomFaction) ?? null;
        if (!roomFaction) return fail('no-faction');
      }
      const offer = projectOffer(b, request.project, p);
      return offer.ok ? { ok: true, terms: { project: request.project, cost: offer.cost, days: offer.days, ...(request.project === 'backRoom' ? { room: request.room } : {}), ...(roomFaction ? { roomFaction: { id: roomFaction.id, name: roomFaction.name } } : {}) } } : fail(offer.reason);
    }
    // A shareholders' vote would tell them all, so at a company the officers settle it (`gangDealOfficer`).
    case 'gangDeal':
      if (b.stage >= 2) return fail('officers-decide');
      return b.backRoom?.offer && !b.backRoom.deal ? { ok: true, terms: { name: b.backRoom.offer.name } } : fail('no-offer');
    case 'endGangDeal':
      if (b.stage >= 2) return fail('officers-decide');
      return b.backRoom?.deal ? { ok: true, terms: { name: b.backRoom.deal.name } } : fail('no-deal');
    case 'elect':
    case 'dismiss':
      return officerProposal(b, kind, request.actorId);
    case 'hire':
      return hireOffer(b, request, ctx, ctx.day, p);
    case 'fire':
      return fireOffer(b, request.staffId);
    case 'pay':
      return payOffer(b, request, p);
    case 'handStock': {
      const partner = partnerOf(b, String(request.actorId ?? ''));
      if (partner?.status !== 'active' || ctx.isSyndicate?.(partner.actorId)) return fail('bad-partner');
      return handOffer(b, partner, String(request.uuid ?? ''), request.count);
    }
    case 'coverLiving': {
      const partner = partnerOf(b, String(request.actorId ?? ''));
      if (partner?.status !== 'active' || !partner.voting) return fail('bad-partner');
      if ((b.covered ?? []).includes(partner.actorId)) return fail('already-covered');
      // A character's sheet says what they pay; a syndicate has no sheet.
      const cost = ctx.livingCostOf?.(partner.actorId);
      if (!(cost > 0)) return fail('no-living-costs');
      return { ok: true, terms: { actorId: partner.actorId, name: partner.name, cost } };
    }
    case 'stopLiving': {
      const partner = partnerOf(b, String(request.actorId ?? ''));
      if (!(b.covered ?? []).includes(request.actorId)) return fail('not-covered');
      return { ok: true, terms: { actorId: request.actorId, name: partner?.name ?? '' } };
    }
    case 'grant':
      return grantOffer(b, request.staffId, request.pct, p);
    case 'payout':
      return payoutOffer(b, request.pct, p);
    case 'issue':
      return issueOffer(b, request.pct, p);
    case 'buyback':
      return buybackOffer(b, request.budget, p);
    case 'fixerLoan': {
      const offer = fixerOffer(b, request.amount, p);
      return offer.ok ? { ok: true, terms: { amount: offer.amount } } : offer;
    }
    case 'bankLoan':
      if (b.stage < p.loans.bank.minStage) return fail('not-registered');
      if (b.approved.bankLoan) return fail('already-agreed');
      if (openLoans(b).some((l) => l.kind === 'bank')) return fail('loan-open');
      return { ok: true };
    case 'investor': {
      const offer = investorOffer(b, request, ctx.actors, p);
      // Only the characters the service allows (player characters, NCM brokers and investors), when it says.
      if (offer.ok && ctx.investors && !ctx.investors.includes(offer.actorId)) return fail('not-investor');
      return offer.ok ? { ok: true, terms: { actorId: offer.actorId, amount: offer.amount, price: offer.price } } : offer;
    }
    case 'angel':
      if (b.stage < p.investors.minStage) return fail('not-registered');
      if (b.approved.angel) return fail('already-agreed');
      return { ok: true };
    default:
      return { ok: true };
  }
}

/**
 * Settle every open proposal by its rule (PROPOSAL_RULES). Unanimous: every voting partner says yes,
 * and one no ends it. Majority: more than half the voting units say yes; it ends once half or more
 * say no. A proposal that passes takes effect at once.
 */
function settleProposals(b, day, out, p, ctx = {}) {
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
    if (proposal.kind === 'stepUp' && b.stage === 0) b.stepUp = { approved: true, retryDay: null };
    if (proposal.kind === 'stepUp' && b.stage === 2) {
      const started = startListing(b, { float: proposal.terms?.float, day }, p);
      if (!started.ok) out.events.push({ type: 'proposalVoid', kind: proposal.kind, reason: started.reason });
      continue;
    }
    if (proposal.kind === 'stepUp' && b.stage === 1) {
      const started = startCharter(b, { ticker: proposal.terms?.ticker, day }, p);
      if (!started.ok) out.events.push({ type: 'proposalVoid', kind: proposal.kind, reason: started.reason });
      continue;
    }
    const done = enact(b, proposal, day, p, ctx, out);
    if (!done.ok) out.events.push({ type: 'proposalVoid', kind: proposal.kind, reason: done.reason });
  }
}

/**
 * What became of a proposal the request itself settled (one made, or a vote cast, that carried it at
 * once), so the proposer is told what happened rather than that a proposal was made. `detail` says
 * whether a hire took the employee on or offered them the job.
 * @returns {{outcome: 'passed'|'failed'|'void', kind: string, detail?: string, reason?: string}|null}
 */
export function proposalOutcome(events = []) {
  const settled = events.find((e) => ['proposalPassed', 'proposalFailed'].includes(e.type));
  if (!settled) return null;
  if (settled.type === 'proposalFailed') return { outcome: 'failed', kind: settled.kind };
  const voided = events.find((e) => e.type === 'proposalVoid' && e.kind === settled.kind);
  if (voided) return { outcome: 'void', kind: settled.kind, reason: voided.reason };
  const hire = events.find((e) => ['hired', 'jobOffered'].includes(e.type));
  return { outcome: 'passed', kind: settled.kind, ...(settled.kind === 'hire' && hire ? { detail: hire.type } : {}) };
}

/** What a proposal that has passed does. */
function enact(b, proposal, day, p, ctx, out) {
  switch (proposal.kind) {
    case 'expansion':
      return startProject(b, 'expansion', proposal.id, day, p);
    case 'project':
      return startProject(b, proposal.terms.project, proposal.id, day, p, proposal.terms.room ?? null, proposal.terms.roomFaction ?? null);
    case 'gangDeal':
      return takeDeal(b, day);
    case 'endGangDeal': {
      const ended = endDeal(b);
      if (ended.ok) out.events.push({ type: 'factionMove', factionId: ended.factionId, amount: p.backRoom.deal.end });
      return ended;
    }
    case 'fixerLoan':
      return takeFixerLoan(b, proposal.id, proposal.terms.amount, day, p);
    case 'bankLoan':
      b.approved = { ...b.approved, bankLoan: true };
      return { ok: true };
    case 'investor':
      inviteInvestor(b, proposal.terms, ctx.actors ?? {});
      return { ok: true };
    case 'elect':
    case 'dismiss':
      return applyOfficerProposal(b, proposal.kind, proposal.terms.actorId);
    case 'hire': {
      const done = enactHire(b, proposal.terms, day, ctx, p);
      if (done.ok) out.events.push({ type: done.staff.status === 'active' ? 'hired' : 'jobOffered', staffId: done.staff.id, actorId: done.staff.actorId });
      return done;
    }
    case 'fire': {
      const done = enactFire(b, proposal.terms.staffId, day, p, { traits: ctx.traits, seed: ctx.seed });
      if (done.ok && done.actorId && done.paid) out.wealth[done.actorId] = (out.wealth[done.actorId] ?? 0) + done.paid;
      if (done.ok) out.events.push({ type: 'fired', staffId: proposal.terms.staffId, exposure: done.exposure });
      return done;
    }
    case 'handStock':
      return handStock(b, proposal.terms, day, out, p);
    case 'coverLiving':
      b.covered = [...new Set([...(b.covered ?? []), proposal.terms.actorId])];
      return { ok: true };
    case 'stopLiving':
      b.covered = (b.covered ?? []).filter((id) => id !== proposal.terms.actorId);
      return { ok: true };
    case 'pay': {
      const done = enactPay(b, proposal.terms, day, ctx.traits, p);
      if (done.ok) out.events.push({ type: 'payChanged', staffId: proposal.terms.staffId, pct: proposal.terms.pct });
      return done;
    }
    case 'payout':
      b.listing.payout = proposal.terms.ratio;
      addLedger(b, { day, kind: 'payoutSet', amount: 0 }, p);
      return { ok: true };
    case 'issue': {
      // The terms are checked again: the cash or the shares may have moved since the proposal.
      const again = issueOffer(b, proposal.terms.pct, p);
      return again.ok ? startIssue(b, again.terms, day, p) : again;
    }
    case 'buyback': {
      const again = buybackOffer(b, proposal.terms.budget, p);
      return again.ok ? startBuyback(b, again.terms, day, p) : again;
    }
    case 'grant': {
      const done = enactGrant(b, proposal.terms, day, ctx.traits, p);
      if (done.ok) out.events.push({ type: 'granted', staffId: proposal.terms.staffId, share: proposal.terms.share });
      return done;
    }
    case 'angel':
      findAngel(b, ctx.seed ?? 'nci', proposal.id, p.investors.angel.names, p);
      return { ok: true };
    default:
      return { ok: true };
  }
}

// ── Gigs for a player's own business ─────────────────────────────────────────

/**
 * Which open player business a gig is for, if any: a `[NCI: <business id>]` tag in its notes, or a
 * client that names the business, exactly or within the client's text.
 * @returns {{businessId: string, how: 'tag'|'exact'|'contains'}|null}
 */
export function matchBusiness(gig, businesses) {
  const open = businesses.filter((b) => b.status === 'open');
  // The GM's tag names the business by its id, its name or its ticker: `[NCI contract: ...]`, or the older `[NCI: ...]`.
  const tags = gigTags(gig.notes);
  const tag = tags.contract || /\[NCI:\s*([^\]]+?)\s*\]/i.exec(String(gig.notes ?? ''))?.[1];
  const named = tag ? normalizeName(tag) : '';
  const tagged = tag ? open.find((b) => b.id === tag || normalizeName(b.name) === named || (b.company?.ticker && normalizeName(b.company.ticker) === named)) : null;
  if (tagged) return { businessId: tagged.id, how: 'tag' };
  const client = normalizeName(tags.client || gig.client);
  if (!client) return null;
  const exact = open.find((b) => normalizeName(b.name) === client);
  if (exact) return { businessId: exact.id, how: 'exact' };
  const inside = open.filter((b) => normalizeName(b.name).length >= 4 && client.includes(normalizeName(b.name)));
  return inside.length === 1 ? { businessId: inside[0].id, how: 'contains' } : null;
}

/** What a gig would do to a business: Reputation now and next week's takings, weaker after recent gigs. */
export function planBusinessGig(b, { outcome, reward, day }, p = BUSINESS_DEFAULTS) {
  const g = p.gigs;
  const terms = g[outcome] ?? g.done;
  const size = clamp((Number(reward) || 0) / g.reward, g.size[0], g.size[1]);
  const recent = b.gigs.filter((x) => day - x.day < g.windowDays).length;
  const scale = size / (1 + recent);
  return { reputation: Math.round(terms.reputation * scale * 10) / 10, takings: Math.round(terms.takings * scale * 1000) / 1000, recent };
}

/** Apply a gig outcome to a business. Once per gig (`key`). */
export function applyBusinessGig(business, { key, outcome, reward, day }, p = BUSINESS_DEFAULTS) {
  const b = structuredClone(normalizeBusiness(business));
  if (b.status !== 'open') return fail('not-open');
  if (b.gigs.some((x) => x.key === key)) return fail('duplicate');
  const plan = planBusinessGig(b, { outcome, reward, day }, p);
  b.state.reputation = clamp(b.state.reputation + plan.reputation, 0, 100);
  b.boost = clamp(b.boost + plan.takings, -p.gigs.boostCap, p.gigs.boostCap);
  b.gigs = [...b.gigs, { key, outcome, day, reputation: plan.reputation, takings: plan.takings }].slice(-p.gigs.logCap);
  addLedger(b, { day, kind: outcome === 'done' ? 'gigDone' : 'gigFailed', amount: 0 }, p);
  return { ok: true, business: b, wealth: {}, events: [{ type: 'gig', outcome, ...plan }], plan };
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
export function advanceBusiness(business, day, { weekday = 1, growthRate = 1, actors = {}, seed = 'nci', traits = {}, relations = null, params: p = BUSINESS_DEFAULTS } = {}) {
  const b = structuredClone(normalizeBusiness(business));
  const out = { wealth: {}, events: [] };
  if (b.status !== 'open' || !b.period) return { business: b, ...out, changed: false };
  let changed = settleLeavers(b, day, actors, out);
  // A charter's funding window that has run out: everything paid in is refunded (B4a).
  if (b.charter?.status === 'funding' && day > b.charter.fundingEnds) {
    for (const [actorId, cash] of Object.entries(dropCharter(b, day, 'lapsed', p))) out.wealth[actorId] = (out.wealth[actorId] ?? 0) + cash;
    out.events.push({ type: 'charterLapsed' });
    changed = true;
  }
  // A rights issue's or a tender's window that has run out (B6a).
  if (closeCapital(b, day, p)) changed = true;
  const lapsed = b.proposals.filter((x) => x.expires != null && day > x.expires);
  if (lapsed.length) {
    b.proposals = b.proposals.filter((x) => !lapsed.includes(x));
    out.events.push(...lapsed.map((x) => ({ type: 'proposalLapsed', kind: x.kind })));
    changed = true;
  }

  // The calendar went back past this week's start, and it would wait years to close. It runs from today, as it stands.
  if (b.status === 'open' && b.period.startDay > day) {
    b.period = { ...b.period, startDay: day, endDay: nextBoundary(day, weekday) };
    b.pendingNotes = [...(b.pendingNotes ?? []), { kind: 'weekRestarted', name: '' }];
    changed = true;
  }

  let closes = 0;
  while (b.status === 'open' && b.period.endDay <= day && closes < p.catchUpPeriods) {
    closePeriod(b, { growthRate, weekday, seed, traits, relations, params: p }, out);
    closes++;
    changed = true;
  }
  // A longer jump than the catch-up allows: the weeks beyond it are skipped, not simulated.
  if (b.status === 'open' && b.period.endDay <= day) {
    startPeriod(b, b.period.index + 1, day, weekday, seed, p, traits, relations);
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

/** Start an operating period, and draw its event. */
function startPeriod(b, index, startDay, weekday, seed, p, traits = null, relations = null) {
  b.period = newPeriod(index, startDay, weekday);
  // The cash the week starts with, so its digest can account for every eddie in and out.
  b.period.opening = b.till;
  // A hostile faction's act comes in place of what the week would have drawn (F1b).
  // So does a raid on a back room (U1b).
  // So does trouble of the room's own, from a week it was worked (U3).
  const event = roomBust(b, seed, p, relations, traits) ?? hostileAct(b, seed, p, relations) ?? roomEvent(b, seed, p, relations) ?? drawEvent(b, seed, p, traits, relations);
  if (b.collectors) {
    // A missed payment to a fixer: the collectors come in place of whatever else the week held.
    b.period.event = { kind: 'collectors' };
    b.collectors = false;
  } else if (b.grudge) {
    // A sullen employee who was let go comes back to make a point.
    b.period.event = { kind: 'grudge' };
    b.grudge = false;
  } else if (event) {
    b.period.event = event;
  }
}

/**
 * A month's end: the business pays the Housing and Lifestyle of those it covers, as their sheets now have them, to be
 * claimed from a payslip (B7d). One who has gone is dropped; one the cash cannot cover goes without this month.
 * It is what an owner takes out of a business, so it does not count against the week's profit.
 */
function payLiving(b, living, day, out, p) {
  b.covered = (b.covered ?? []).filter((id) => partnerOf(b, id)?.status === 'active');
  if (b.administration) return;
  for (const actorId of b.covered) {
    const amount = Math.round(Number(living[actorId]) || 0);
    if (amount <= 0) continue;
    if (b.till < amount) {
      b.pendingNotes = [...(b.pendingNotes ?? []), { kind: 'livingShort', name: partnerOf(b, actorId).name }];
      continue;
    }
    b.till -= amount;
    addLedger(b, { day, kind: 'livingCosts', amount: -amount, actorId }, p);
    out.events.push({ type: 'livingCosts', actorId, amount });
  }
}

/** A bribe to the regulator: paid whatever comes of it; a good roll also helps with a case already open. */
function payRegulator(b, band, day, out, p) {
  b.till -= p.crime.bribeCost;
  addLedger(b, { day, kind: 'regulatorBribe', amount: -p.crime.bribeCost }, p);
  out.events.push({ type: 'regulatorBribed', exposure: p.crime.bribeExposure[band] });
  if (b.regCase?.status === 'notice' && p.crime.easeFrom.includes(band)) b.regCase.eased = true;
}

/** Close the current operating period: the week's takings and upkeep, the state, the digest. */
function closePeriod(b, { growthRate, weekday, seed = 'nci', traits = {}, relations = null, params: p }, out) {
  const stage = p.stages[b.stage] ?? p.stages[0];
  const arch = archetypeOf(b);
  const fx = p.effects;
  const g = growthRate;
  const slot = (action) => b.period.slots.find((s) => s.action === action);
  const scale = (s) => approachOf(s.approach).effect;
  // Who is off this week (sick, hurt, or downing tools), then what the rest did without a partner:
  // a manager working the shop, security answering trouble.
  const idle = idleStaff(b);
  staffShifts(b, seed, p, { idle, traits, exposure: relations?.exposure ?? null });
  productionWeek(b, b.period.endDay, out, p);
  const bribed = slot('bribeRegulator');
  if (bribed?.staff) payRegulator(b, bribed.band, b.period.endDay, out, p);

  // A chartered company takes the five company actions; a smaller business the shop actions.
  let work;
  let workMult;
  let protection;
  if (b.stage >= 2) {
    const week = companyWeek(b, { growthRate: g, params: p });
    work = week.worked;
    workMult = week.workMult;
    protection = week.protection;
    if (week.exposure) out.events.push({ type: 'shortcuts', exposure: week.exposure });
    if (week.scandal) out.events.push({ type: 'crimeScandal', percent: p.crime.scandal.dumping, key: `dumping:${b.period.index}` });
  } else {
    work = slot('work');
    workMult = work ? 1 + (fx.work[work.band] - 1) * scale(work) : p.unworked;
    const promote = slot('promote');
    if (promote) b.state.reputation += fx.promote[promote.band] * scale(promote) * g;
    const source = slot('source');
    if (source) b.state.costFactor = Math.max(p.costFloor, b.state.costFactor - fx.source[source.band] * scale(source));
    const fixUp = slot('fixUp');
    if (fixUp) b.state.capacity = clamp(b.state.capacity + fx.fixUp[fixUp.band] * stage.fixUpScale * scale(fixUp) * g, 0.5, stage.capacityCap);
    const safe = slot('keepSafe');
    protection = safe ? 1 - fx.keepSafe[safe.band] * scale(safe) : 1;
  }

  // Floor and sales staff lift the takings; a bookkeeper, publicist and compliance officer move the state.
  const team = staffWeek(b, g, p, { idle, traits });
  workMult *= 1 + team.lift;
  // Reputation settles toward 50 (55 with a salesperson), higher with a storefront.
  b.state.reputation = clamp(b.state.reputation + (reputationBaseline(b, team.reputationTarget ?? 50, p) - b.state.reputation) * p.reputationDrift, 0, 100);
  if (b.state.compliance != null) b.state.compliance = clamp(b.state.compliance + (p.complianceBaseline - b.state.compliance) * p.reputationDrift, 0, 100);
  b.state.costFactor = Math.min(1, b.state.costFactor + p.costCreep);

  // A first period that began part-way through a week earns for the days it ran.
  const part = Math.min(1, (b.period.endDay - b.period.startDay) / 7);
  const district = districtOf(b.district);
  // Gigs run for the business since last week move this week's takings, once.
  const base = Math.round(arch.takings * b.state.capacity * traffic(b.state.reputation) * district.traffic * workMult * (1 + b.boost) * part);
  const boost = b.boost;
  b.boost = 0;
  const event = settleEvent(b, base, b.period.slots, p, { traits, seed, day: b.period.endDay });
  out.events.push(...factionFallout(b, event, p));
  out.events.push(...bustFallout(b, b.period.event, event?.outcome, b.period.endDay, p));
  out.events.push(...roomEventFallout(b, b.period.event, event, part, p));
  const takings = Math.max(0, base + (event?.change ?? 0));
  // What goes out the back goes first (P1c), then what is left is sold over the counter (P1b).
  const fenced = fenceWeek(b, takings, b.period.endDay, out, p);
  const sales = salesWeek(b, takings, b.period.endDay, out, p);
  // What went on behind the shop this week (U1a).
  const room = roomWeek(b, takings, part, p, traits);
  if (room?.exposure) out.events.push({ type: 'backRoomWeek', exposure: room.exposure });
  if (room?.unpaid) out.events.push({ type: 'factionMove', factionId: room.unpaid, amount: p.backRoom.deal.unpaid });
  if (room?.standing) out.events.push({ type: 'factionMove', ...room.standing, steady: true });
  if (room?.favour) out.events.push({ type: 'factionMove', ...room.favour, steady: true });
  if (room?.dealEnded) out.events.push({ type: 'gangDealEnded', name: room.dealEnded });
  const turned = turnInformant(b, traits, seed, p);
  if (turned) out.traits = { ...out.traits, ...turned };
  // A security upgrade cuts the protection money for good.
  // So do friendly gangs on the turf, and hostile ones raise it; corporations in its sector move the Cost base (F1b).
  const fixed = (stage.rent + (stage.licence ?? 0)) * district.rent + stage.protection * protection * (relations?.protection ?? 1) * protectionFactor(b, p) * district.risk;
  // A Nomad's supply contract takes a share off too, while it runs (X1).
  const costBase = b.state.costFactor * (relations?.cost ?? 1) * (1 - supplyCut(b, b.period.index, p));
  const upkeep = Math.round((arch.costs * b.state.capacity ** 0.85 * costBase + fixed) * part);
  // What the upkeep is made of, for the week's cashbook; protection money takes the rounding.
  const running = Math.round(arch.costs * b.state.capacity ** 0.85 * costBase * part);
  const rent = Math.round(stage.rent * district.rent * part);
  const licence = Math.round((stage.licence ?? 0) * district.rent * part);
  const costs = { running, rent, licence, protection: upkeep - running - rent - licence };
  // The week's takings come in before its loan payments go out, so a week that earns the payment makes it.
  b.till += takings - upkeep;
  // A staff event's bills (an accident at work) come out of the cash too.
  const eventCost = event?.cost ?? 0;
  if (eventCost) {
    b.till -= eventCost;
    addLedger(b, { day: b.period.endDay, kind: 'medical', amount: -eventCost }, p);
  }
  // Wages next, as far as the cash goes, then the loans.
  const wages = payWages(b, part, b.period.endDay, p);
  // A payslip for each player character on the staff (DESIGN §32.2). Their wage is not paid to their
  // sheet here: the GM's service attaches it to the payslip mail for them to claim (`paid`).
  for (const s of activeStaff(b).filter((x) => x.source === 'pc' && x.actorId)) {
    out.events.push({
      type: 'payslip', actorId: s.actorId, staffId: s.id, post: s.post, wage: Math.round(s.wage * part), paid: wages.pay[s.actorId] ?? 0, owed: s.owed ?? 0,
      overtime: b.period.pcOvertime?.[s.actorId] ?? 0, shifts: shiftsOf(b, s.id),
    });
  }
  const loans = payLoans(b, b.period.endDay, p);
  const profit = takings + sales.margin - upkeep - eventCost - wages.wages - loans.interest;
  b.till -= loans.interest + loans.principal;

  // The staff's week: loyalty, raises asked for at a month's end, and who has had enough (E2).
  const monthEnd = b.period.index % p.report.weeks === 0;
  if (monthEnd) payLiving(b, relations?.living ?? {}, b.period.endDay, out, p);
  const monthProfit = profit + b.digests.slice(-(p.report.weeks - 1)).reduce((a, d) => a + d.profit, 0);
  const unanswered = !!event && !EVENTS[event.kind]?.good && event.outcome === 'unanswered';
  const people = loyaltyWeek(b, { monthEnd, monthProfit, unanswered, traits, seed, day: b.period.endDay }, p);
  if (people.exposure) out.events.push({ type: 'plant', exposure: people.exposure });
  // A two-jobs event reaching the other business: the GM's service carries it out there (E3).
  if (event?.cross) out.events.push({ type: 'twoJobs', businessId: b.id, ...event.cross });
  // What reached this business from another's two-jobs event this week, for its digest.
  // Share grants that have vested by the close (E3).
  const vested = vestGrants(b, b.period.endDay, p);
  const notes = [...(event?.notes ?? []), ...people.notes, ...vested, ...(b.pendingNotes ?? [])];
  b.pendingNotes = [];

  const digest = {
    index: b.period.index,
    startDay: b.period.startDay,
    endDay: b.period.endDay,
    takings,
    // The takings before the week's event, and the upkeep's parts (cashbook).
    gross: base,
    upkeep,
    costs,
    profit,
    till: b.till,
    ...(b.period.opening != null ? { opening: b.period.opening } : {}),
    ...(loans.interest || loans.principal || loans.missed.length ? { interest: loans.interest, repaid: loans.principal, missed: loans.missed } : {}),
    ...(wages.wages || wages.owed || wages.paid ? { wages: wages.wages, paid: wages.paid, owed: wages.owed } : {}),
    worked: !!work,
    ...(sales.sold ? { stock: sales } : {}),
    ...(fenced ? { fenced } : {}),
    ...(room ? { room: { earned: room.earned, ...(room.supply ? { supply: room.supply } : {}), laundered: room.laundered, paid: room.paid, low: room.low, ...(room.cut ? { cut: room.cut } : {}), ...(room.unpaid ? { unpaid: true } : {}), ...(room.informant ? { informant: room.informant } : {}) } } : {}),
    ...(event ? { event: { kind: event.kind, outcome: event.outcome, band: event.band, change: event.change, ...(b.period.event?.factionName ? { faction: b.period.event.factionName } : {}), ...(eventCost ? { cost: eventCost } : {}) } } : {}),
    ...(notes.length ? { staff: notes } : {}),
    ...(boost ? { boost } : {}),
    actions: b.period.slots.map((s) => ({ action: s.action, by: s.by, band: s.band, ...(s.staff ? { staff: true } : {}), ...(s.illegal ? { illegal: true } : {}) })),
    bands: stateBands(b, p),
  };
  b.digests = [...b.digests, digest].slice(-p.digestCap);
  addLedger(b, { day: b.period.endDay, kind: 'takings', amount: takings, period: b.period.index }, p);
  addLedger(b, { day: b.period.endDay, kind: 'upkeep', amount: -upkeep, period: b.period.index }, p);
  out.events.push({ type: 'periodClosed', digest });
  if (b.stage >= 2) closeReportWeek(b, b.period.endDay, out, p);

  b.losingPeriods = b.till < 0 ? b.losingPeriods + 1 : 0;
  if (b.stage >= 2) {
    // A company goes into administration instead of failing (B6c): the GM restructures or winds it up.
    const s = checkSolvency(b, b.period.endDay, p);
    if (s.entered) out.events.push({ type: 'administration', net: b.administration.net });
    if (s.ended) out.events.push({ type: 'administrationEnded' });
  } else if (b.losingPeriods >= p.failurePeriods) {
    liquidate(b, b.period.endDay, 'failed', out, p);
    return;
  }
  startPeriod(b, b.period.index + 1, b.period.endDay, weekday, seed, p, traits, relations);
}
