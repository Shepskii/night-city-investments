/**
 * Market Terminal context helpers: funds, trading access, withdrawals and notification choices.
 * @file scripts/ui/MarketTerminal/context.js
 */

import {
  getSeries, rangeStats, describeTerms, sessionActive, lockedOut, fundComposition, normalizeNotify, moverThreshold,
  NOTIFY_CATEGORIES, NOTIFY_CHANNELS, dueWithdrawals, ipoStatus, ipoPrice, ipoOrdersFor, dayIndex,
  HEAT_ACTIONS, HEAT_ACTION_IDS, canAttempt, cooldownLeft, isFrozen,
} from '../../engine/index.js';
import { MODULE_ID, FLAGS, SETTINGS } from '../../utils/constants.js';
import { CompanyRepository } from '../../data/CompanyRepository.js';
import { BrokerRepository } from '../../data/BrokerRepository.js';
import { PortfolioRepository } from '../../data/PortfolioRepository.js';
import { MarketClock } from '../../services/MarketClockService.js';
import { TradingSettings } from '../../services/TradingSettings.js';
import { TerminalAccess } from '../../services/TerminalAccess.js';
import { SkillAdapter } from '../../services/SkillAdapter.js';
import { sparkline, lineChart } from '../components/chart.js';
import { L, money, whole, pct, trendClass } from '../format.js';

const RANGES = [30, 90, 365];

/**
 * The "cover your tracks" panel and the frozen-account notice. The panel only appears once the
 * character has been warned (`heatAware`), so nobody learns the feature exists, or what their
 * heat is, from the window alone. Nothing here reads the GM-only heat record.
 */
export function heatContext(actor, portfolio, tick) {
  const on = game.settings.get(MODULE_ID, SETTINGS.HEAT_ENABLED) === true && game.settings.get(MODULE_ID, SETTINGS.HEAT_CONSEQUENCES) !== false;
  const frozen = isFrozen(portfolio, tick);
  const bans = Object.values(portfolio.brokerBans ?? {}).filter((until) => until > tick);
  // Cover-up actions are a character's own; a syndicate's account never shows them (DESIGN §31).
  const show = on && portfolio.heatAware === true && !actor?.isSyndicate;

  const actions = show ? HEAT_ACTION_IDS.map((id) => {
    const def = HEAT_ACTIONS[id];
    const skill = SkillAdapter.read(actor, def.skill, def.stat);
    const can = canAttempt({ portfolio, actionId: id, tick, enabled: on });
    const wait = cooldownLeft(portfolio, id, tick);
    return {
      id,
      name: L(`NCI.Heat.Action.${id}.Name`),
      desc: L(`NCI.Heat.Action.${id}.Desc`),
      skill: L('NCI.Heat.Panel.Skill', { skill: def.skill, total: skill.total, dv: def.dv }),
      cost: L('NCI.Heat.Panel.Cost', { cost: def.cost.toLocaleString() }),
      status: wait > 0 ? L('NCI.Heat.Panel.ReadyIn', { n: Math.ceil(wait - 1e-6) }) : portfolio.cash < def.cost ? L('NCI.Heat.Panel.TooPoor') : L('NCI.Heat.Panel.Ready'),
      canUse: can.ok,
    };
  }) : [];

  return {
    show,
    actions,
    frozen: frozen ? L('NCI.Heat.Panel.Frozen', { until: Math.ceil(portfolio.frozenUntilTick - 1e-6) }) : '',
    banned: bans.length ? L('NCI.Heat.Panel.BrokerBan', { until: Math.ceil(Math.max(...bans) - 1e-6) }) : '',
  };
}

/** Table rows for the funds list. */
export function fundRows(funds, pub, history) {
  return funds.filter((f) => pub.funds?.[f.id]).map((f) => {
    const s = pub.funds[f.id];
    const change = s.prevNav ? (s.nav - s.prevNav) / s.prevNav : 0;
    return {
      id: f.id,
      ticker: f.ticker,
      name: f.name,
      kind: L(`NCI.FundKind.${f.kind}`),
      nav: money(s.nav),
      change: pct(change),
      cls: trendClass(change),
      spark: sparkline(getSeries(history, f.id, 30)),
      closed: f.status !== 'active',
    };
  });
}

/** The detail page for one fund. */
export function fundDetail(fund, pub, history, range, { hasActor }) {
  const s = pub.funds[fund.id];
  const change = s.prevNav ? (s.nav - s.prevNav) / s.prevNav : 0;
  const series = getSeries(history, fund.id, range);
  const year = rangeStats(getSeries(history, fund.id, 365));
  const periodChange = rangeStats(series).change;

  const prices = Object.fromEntries(Object.entries(pub.companies ?? {}).map(([id, c]) => [id, c.price]));
  const composition = fundComposition(fund, prices).map((c) => {
    const co = CompanyRepository.get(c.companyId);
    return { ticker: co?.ticker ?? c.companyId, name: co?.name ?? '', share: `${(c.share * 100).toFixed(1)}%` };
  });

  return {
    isFund: true,
    id: fund.id,
    ticker: fund.ticker,
    name: fund.name,
    kind: L(`NCI.FundKind.${fund.kind}`),
    nav: money(s.nav),
    change: pct(change),
    cls: trendClass(change),
    high: year.high !== null ? money(year.high) : '—',
    low: year.low !== null ? money(year.low) : '—',
    periodChange: pct(periodChange),
    periodCls: trendClass(periodChange),
    expense: `${(fund.expenseRatio * 100).toFixed(2)}%`,
    load: `${(fund.loadBps / 100).toFixed(2)}%`,
    exit: `${(fund.exitBps / 100).toFixed(2)}%`,
    minBuy: whole(fund.minBuy),
    rebalance: L(`NCI.FundRebalance.${fund.rebalance ?? 'none'}`),
    distribution: fund.distribution === 'distributing'
      ? L('NCI.FundDistribution.distributing', { freq: L(`NCI.FundRebalance.${fund.distributionFrequency ?? 'quarterly'}`).toLowerCase() })
      : L('NCI.FundDistribution.accumulating'),
    redeemDelay: fund.redeemDelay ? L('NCI.Fund.RedeemDays', { n: fund.redeemDelay }) : L('NCI.Fund.RedeemNone'),
    alpha: fund.managerAlpha ? `${fund.managerAlpha > 0 ? '+' : ''}${(fund.managerAlpha * 100).toFixed(2)}%` : '',
    description: fund.description,
    composition,
    closed: fund.status !== 'active',
    tradable: fund.status === 'active' && hasActor,
    chart: lineChart(series),
    ranges: RANGES.map((r) => ({ value: r, label: L('NCI.Terminal.Days', { n: r }), active: r === range })),
  };
}

const daysText = (min, max) => (min === max ? `${min}` : `${min}-${max}`);

/** Announced IPOs: when they list, the offer price, and whether subscriptions are open. */
export function ipoRows(actor) {
  const today = dayIndex(MarketClock.nowMs());
  const portfolio = actor ? PortfolioRepository.get(actor) : null;
  return CompanyRepository.upcomingIpos().map((c) => {
    const st = ipoStatus(c, today);
    const mine = portfolio ? ipoOrdersFor(portfolio, c.id)[0] : null;
    const open = st.state === 'window';
    return {
      id: c.id,
      ticker: c.ticker,
      name: c.name,
      sector: L(`NCI.Sector.${c.sector}`),
      date: c.ipo.date,
      price: money(ipoPrice(c)),
      status: open
        ? L('NCI.Ipo.WindowOpen', { n: Math.max(0, st.daysToList) })
        : st.state === 'due' ? L('NCI.Ipo.ListingToday') : L('NCI.Ipo.OpensIn', { n: Math.max(0, st.daysToList - (c.ipo.windowDays || 0)) }),
      noWindow: !(c.ipo.windowDays > 0) && st.state !== 'due',
      capped: c.ipo.allocation > 0 ? L('NCI.Ipo.Capped', { n: c.ipo.allocation.toLocaleString() }) : '',
      canSubscribe: open && !!actor && !mine,
      subscribed: mine ? L('NCI.Ipo.YouAsked', { qty: mine.qty }) : '',
    };
  }).concat(offeringRows(portfolio, today));
}

/** Listed player companies' secondary offerings open now (B6a), as rows beside the IPOs. */
function offeringRows(portfolio, today) {
  return CompanyRepository.all().filter((c) => c.listed && c.offering && today <= c.offering.endDay).map((c) => {
    const mine = portfolio ? ipoOrdersFor(portfolio, c.id)[0] : null;
    return {
      id: c.id,
      ticker: c.ticker,
      name: c.name,
      sector: L(`NCI.Sector.${c.sector}`),
      date: L('NCI.Ipo.Secondary'),
      price: money(c.offering.price),
      status: L('NCI.Ipo.OfferingOpen', { n: Math.max(0, c.offering.endDay - today) }),
      capped: L('NCI.Ipo.Capped', { n: c.offering.shares.toLocaleString() }),
      canSubscribe: !!portfolio && !mine,
      subscribed: mine ? L('NCI.Ipo.YouAsked', { qty: mine.qty }) : '',
    };
  });
}

/** The "Trading access" panel: broker, direct terminal, withdrawals and notification choices. */
export function accessContext(actor, portfolio, tick) {
  const mode = TradingSettings.mode();
  const direct = TradingSettings.direct();

  const brokers = BrokerRepository.list().filter((b) => b.available);
  const current = brokers.find((b) => b.id === portfolio.brokerContactId) ?? null;

  const brokerInfo = current ? (() => {
    const d = describeTerms(current.terms);
    return {
      name: current.name,
      grade: L(`NCI.Grade.${current.grade}`),
      total: current.skill.total,
      fromSheet: current.skill.source === 'sheet',
      noSkillItem: current.skill.source === 'sheet' && !current.skill.found,
      commission: `${d.commissionPct}%`,
      flatFee: d.flatFee,
      days: daysText(d.minDays, d.maxDays),
      rebate: `${Math.round(current.terms.loadRebate * 100)}%`,
    };
  })() : null;

  const claim = TerminalAccess.claim();
  const granted = TerminalAccess.granted(actor?.isSyndicate ? actor.as : actor);
  const active = sessionActive(portfolio, tick);
  const locked = lockedOut(portfolio, tick);

  const prefs = normalizeNotify(actor.getFlag?.(MODULE_ID, FLAGS.PREFS)?.notify);
  const notify = NOTIFY_CATEGORIES.map((key) => ({
    key,
    label: L(`NCI.Notify.Category.${key}`),
    options: NOTIFY_CHANNELS.map((c) => ({ value: c, label: L(`NCI.Notify.Channel.${c}`), selected: prefs[key] === c })),
  }));

  const withdrawals = portfolio.withdrawals.filter((w) => w.status === 'pending').map((w) => ({
    id: w.id,
    text: L('NCI.Access.WithdrawalLine', { amount: whole(w.amount), fee: whole(w.fee) }),
    when: dueWithdrawals(portfolio, tick).some((d) => d.id === w.id)
      ? L('NCI.Access.WithdrawalDue')
      : L('NCI.Access.WithdrawalIn', { n: Math.max(1, Math.ceil(w.releaseTick - tick - 1e-6)) }),
  }));

  return {
    mode,
    terminalMode: mode === 'terminal',
    brokerOptions: [
      { id: '', label: L('NCI.Access.NoBroker'), selected: !current },
      ...brokers.map((b) => ({ id: b.id, label: `${b.name} (${L(`NCI.Grade.${b.grade}`)}, ${b.skill.total})`, selected: b.id === portfolio.brokerContactId })),
    ],
    hasBrokers: brokers.length > 0,
    broker: brokerInfo,
    direct: { commission: `${(direct.commissionBps / 100).toFixed(2)}%`, flatFee: direct.flatFee, dv: direct.dv },
    terminal: {
      active,
      validThrough: portfolio.session ? Math.ceil(portfolio.session.validThroughTick - 1e-6) : undefined,
      locked,
      until: Math.ceil((portfolio.lockoutUntilTick ?? 0) - 1e-6),
      claimOk: claim.ok,
      claimReason: claim.ok ? '' : L(`NCI.Reasons.${claim.reason}`),
      granted,
      canConnect: !active && !locked && (claim.ok || granted),
      source: portfolio.session?.source === 'grant' ? L('NCI.Access.SourceGrant') : L('NCI.Access.SourceNetwork'),
    },
    withdrawals,
    notify,
    moverPct: moverThreshold(actor.getFlag?.(MODULE_ID, FLAGS.PREFS)?.moverPct),
  };
}
