/**
 * Reminders, the weekly business mail and adverts (M, DESIGN §36.4)
 * @file scripts/services/ReminderService.js
 * @description After each tick, a reminder a day before a deadline, from whoever owns it: a business for its votes,
 *              week and books, a paper for its story, the regulator for its case, an employee for their raise, the
 *              Exchange for a tender offer, a treasury for its motions. Each is sent once (the keys are kept on the
 *              GM-only control journal). As a week closes, its runners get the week by mail if they asked for it,
 *              and a business that promoted itself well, or opened a storefront, sends other characters an advert.
 *              Each character picks mail, chat or nothing under Notifications. GM client only.
 */

import {
  businessReminders, syndicateReminders, storyReminders, pruneSent, waitingFor, adReason, dayIndex, archetypeOf,
} from '../engine/index.js';
import { createRng } from '../engine/rng.js';
import { FLAGS } from '../utils/constants.js';
import { L, log, isActiveGM, isCharacter, eventName } from '../utils/helpers.js';
import { MarketStore } from '../data/MarketStore.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { MarketClock } from './MarketClockService.js';
import { ContactService } from './ContactService.js';
import { DistrictService } from './DistrictService.js';
import { MailService } from './MailService.js';
import { NotificationService } from './NotificationService.js';

const read = () => {
  const r = MarketStore.readRecord(FLAGS.BUSINESS_MAIL) ?? {};
  return { sent: r.sent ?? {}, ads: r.ads ?? {} };
};
const write = (r) => MarketStore._writeRecord(FLAGS.BUSINESS_MAIL, r);
const eb = (n) => Math.round(Number(n) || 0).toLocaleString();
const AD_VARIANTS = 4;

/** Characters an account stands for: itself, or a syndicate's active members (its officers, for `officers`). */
function peopleOf(id, { officers = false } = {}) {
  if (game.actors.get(id)) return [id];
  return (SyndicateRepository.get(id)?.members ?? [])
    .filter((m) => m.status === 'active' && (!officers || m.role === 'officer') && game.actors.get(m.actorId))
    .map((m) => m.actorId);
}

export const ReminderService = {
  day() {
    return dayIndex(MarketClock.nowMs());
  },

  /** Those running a business, as characters: its partners, or a company's officers. An NPC's company has nobody. */
  runnersOf(b) {
    if (b.npcRun) return [];
    const accounts = b.stage < 2 ? b.partners.filter((x) => !x.npc && x.status === 'active' && x.units > 0).map((x) => x.actorId) : (b.officers ?? []);
    return [...new Set(accounts.flatMap((id) => peopleOf(id)))];
  },

  /** Who a reminder is for, as characters. A syndicate holding a vote is reminded through its officers, who cast it. */
  recipients(r, b = null) {
    if (r.to === 'runners') return b ? this.runnersOf(b) : [];
    return [...new Set(r.to.flatMap((id) => peopleOf(id, { officers: r.kind === 'vote' })))];
  },

  /** The contact a reminder comes from, and the name chat shows. */
  async sender(r, b = null, s = null) {
    const from = r.from ?? {};
    try {
      switch (from.kind) {
        case 'business': return { id: await ContactService.business(b), alias: b?.name ?? '' };
        case 'syndicate': return { id: await ContactService.syndicate(s), alias: L('NCI.Contacts.Treasury', { name: s?.name ?? '' }) };
        case 'outlet': return { id: from.name ? await ContactService.outlet(from.name, from.factionId ?? null) : null, alias: from.name || L('NCI.Contacts.Editor') };
        case 'regulator': return { id: await ContactService.regulator(), alias: L('NCI.Contacts.Regulator') };
        case 'exchange': return { id: await ContactService.exchange(), alias: L('NCI.Contacts.Exchange') };
        case 'staff': {
          const staff = (b?.staff ?? []).find((x) => x.id === from.staffId);
          return { id: staff ? await ContactService.staff(b, staff) : null, alias: staff?.name ?? b?.name ?? '' };
        }
        default: return { id: null, alias: '' };
      }
    } catch (error) {
      log.warn('Could not find a reminder\'s sender', error);
      return { id: null, alias: '' };
    }
  },

  /** A reminder's words. */
  words(r) {
    const data = { ...r.data, till: eb(r.data.till), loans: eb(r.data.loans), wages: eb(r.data.wages), total: eb(r.data.total), price: eb(r.data.price) };
    return {
      subject: L(`NCI.Remind.Subject.${r.kind}`, data),
      lines: [L(`NCI.Remind.Line.${r.kind}`, data)],
      footer: L(`NCI.Remind.Footer.${r.kind}`, data),
    };
  },

  /** Every reminder due now, with what it is about. */
  due(day) {
    const out = [];
    for (const b of BusinessRepository.all().filter((x) => x.status === 'open')) {
      for (const r of businessReminders(b, day)) out.push({ r, b });
    }
    for (const s of SyndicateRepository.all().filter((x) => x.status === 'active')) {
      for (const r of syndicateReminders(s, day)) out.push({ r, s });
    }
    for (const r of storyReminders(MarketStore.getStories()?.press?.stories ?? [], day)) out.push({ r });
    return out;
  },

  /** After each tick: send what is a day from its deadline, once each. */
  async onTick() {
    if (!isActiveGM()) return 0;
    const day = this.day();
    const record = read();
    const sent = pruneSent(record.sent, day);
    let count = 0;
    for (const { r, b = null, s = null } of this.due(day)) {
      if (sent[r.key] != null) continue;
      sent[r.key] = day;
      const ids = this.recipients(r, b);
      if (!ids.length) continue;
      const from = await this.sender(r, b, s);
      const spec = this.words(r);
      for (const id of ids) {
        const actor = game.actors.get(id);
        if (!actor) continue;
        try {
          const result = await NotificationService.deliver(actor, 'reminders', spec, from);
          if (result?.ok && !result.skipped) count++;
        } catch (error) {
          log.warn(`Reminder to ${actor.name} failed`, error);
        }
      }
    }
    if (count || Object.keys(sent).length !== Object.keys(record.sent).length) await write({ ...record, sent });
    return count;
  },

  /** The week's mail for one runner: the figures, the week's event, and what is waiting on them. */
  weekMail(b, digest, actorId) {
    const accounts = [actorId, ...b.partners.filter((x) => SyndicateRepository.get(x.actorId)?.members?.some((m) => m.actorId === actorId && m.status === 'active')).map((x) => x.actorId)];
    const w = waitingFor(b, accounts);
    const items = [
      w.votes ? L('NCI.WeekMail.Votes', { n: w.votes }) : '',
      w.raises.length ? L('NCI.WeekMail.Raises', { names: w.raises.join(', ') }) : '',
      w.applicants ? L('NCI.WeekMail.Applicants', { n: w.applicants }) : '',
      w.regCase ? L('NCI.WeekMail.Case') : '',
    ].filter(Boolean);
    const profit = digest.profit ?? 0;
    // Everything the profit counts, so the figures add up to it: the shop's margin on stock, wages due, loan
    // interest, an event's bill, and anything else (shift bonuses) as other costs.
    const margin = digest.stock?.margin ?? 0;
    const wages = digest.wages ?? 0;
    const interest = digest.interest ?? 0;
    const bill = digest.event?.cost ?? 0;
    const sundry = Math.round((digest.takings ?? 0) + margin - (digest.upkeep ?? 0) - wages - interest - bill - profit);
    const more = [
      margin ? L('NCI.WeekMail.Sales', { n: eb(margin) }) : '',
      wages ? L('NCI.WeekMail.Wages', { n: eb(wages) }) : '',
      interest ? L('NCI.WeekMail.Loans', { n: eb(interest) }) : '',
      bill ? L('NCI.WeekMail.Bill', { n: eb(bill) }) : '',
      sundry > 0 ? L('NCI.WeekMail.Sundry', { n: eb(sundry) }) : '',
    ].join('');
    // Money that moved outside the week's sums (draws, living costs, top-ups), so the cash adds up.
    const rest = digest.opening != null ? Math.round(digest.till - digest.opening - profit) : 0;
    const other = rest ? L('NCI.WeekMail.Other', { dir: L(rest < 0 ? 'NCI.WeekMail.Out' : 'NCI.WeekMail.In'), n: eb(Math.abs(rest)) }) : '';
    return {
      subject: L('NCI.WeekMail.Subject', { name: b.name, date: MarketClock.displayDate(digest.endDay * 86400000) }),
      lines: [
        L('NCI.WeekMail.Figures', { takings: eb(digest.takings), upkeep: eb(digest.upkeep), more, other, result: L(profit < 0 ? 'NCI.WeekMail.Loss' : 'NCI.WeekMail.Profit'), profit: eb(Math.abs(profit)), till: eb(digest.till) }),
        digest.event?.kind ? L('NCI.WeekMail.Event', { event: eventName(digest.event) }) : '',
        items.length ? L('NCI.WeekMail.Waiting', { items: items.join('; ') }) : L('NCI.WeekMail.Nothing'),
      ].filter(Boolean),
      footer: L('NCI.WeekMail.Footer'),
    };
  },

  /**
   * A business has been saved: mail each runner who asked for it the weeks that closed, and send an advert if the
   * business has earned one. Called by the business service after its own mail.
   */
  async afterCommit(b, events = []) {
    if (!isActiveGM() || !b || b.npcRun) return;
    const closed = events.filter((e) => e.type === 'periodClosed').map((e) => e.digest).filter(Boolean);
    if (closed.length) {
      const ids = this.runnersOf(b);
      const from = ids.length ? { id: await ContactService.business(b).catch(() => null), alias: b.name } : null;
      for (const id of ids) {
        const actor = game.actors.get(id);
        if (!actor || NotificationService.prefs(actor).business === 'off') continue;
        for (const digest of closed) {
          await NotificationService.deliver(actor, 'business', this.weekMail(b, digest, id), from).catch((error) => log.warn(`Weekly mail to ${actor.name} failed`, error));
        }
      }
    }
    await this.advertise(b, closed).catch((error) => log.warn(`Advert from ${b.name} failed`, error));
  },

  /** The advert's words: one of four, by the business and the day. */
  adWords(b, reason, day) {
    const n = createRng('nci-ad', b.id, day).int(1, AD_VARIANTS);
    const kind = archetypeOf(b) ? L(`NCI.Business.Archetype.${b.archetype}.Name`) : '';
    // The district, as the street knows it: the business's own location may be a note such as a back room.
    const data = { name: b.name, location: (b.district && DistrictService.name(b.district)) || L('NCI.Ads.Anywhere'), kind: kind.toLowerCase() };
    return {
      subject: L(`NCI.Ads.Subject.${n}`, data),
      lines: [L(`NCI.Ads.Line.${n}`, data), reason === 'storefront' ? L('NCI.Ads.Storefront') : ''].filter(Boolean),
      footer: L('NCI.Ads.Footer'),
    };
  },

  /** Player characters who might read an advert: not those who run or hold the business. */
  audience(b) {
    const inside = new Set([...this.runnersOf(b), ...b.partners.flatMap((x) => peopleOf(x.actorId))]);
    return game.actors.filter((a) => isCharacter(a) && a.hasPlayerOwner && !inside.has(a.id));
  },

  /** Send an advert if the business has earned one; at most once in four weeks. */
  async advertise(b, closed) {
    const day = this.day();
    const record = read();
    const seen = record.ads[b.id] ?? {};
    const reason = adReason(b, closed, seen, day);
    if (!reason) return 0;
    record.ads[b.id] = { lastDay: day, storefronts: reason === 'storefront' ? [...(seen.storefronts ?? []), b.stage] : (seen.storefronts ?? []) };
    await write(record);
    const from = { id: await ContactService.business(b).catch(() => null), alias: b.name };
    const spec = this.adWords(b, reason, day);
    let count = 0;
    for (const actor of this.audience(b)) {
      const result = await NotificationService.deliver(actor, 'junk', spec, from).catch(() => null);
      if (result?.ok && !result.skipped) count++;
    }
    return count;
  },
};
