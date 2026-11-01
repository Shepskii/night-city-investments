/**
 * Mail service: composes and sends the mail this module generates.
 * @file scripts/services/MailService.js
 * @description Broker mail is written in the broker's voice (a sign-off that matches their skill
 *              grade). Market mail (dividends, headlines, digests) comes from a send-only
 *              "Night City Market Wire" contact. All text lives in lang/en.json under NCI.Mail.
 */

import { orderRef, composeVoiced, pickLine, GIG_TIP_VARIANTS, HEAT_MAIL_VARIANTS } from '../engine/index.js';
import { escapeHtml } from '../utils/text.js';
import { BROKER_VOICES } from '../data/broker-voices.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { BrokerRepository } from '../data/BrokerRepository.js';
import { NcmAdapter } from '../integrations/NcmAdapter.js';
import { L } from '../utils/helpers.js';

const eb = (n) => Math.round(n).toLocaleString();
const price = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const days = (n) => L(n === 1 ? 'NCI.Mail.Days.one' : 'NCI.Mail.Days.many', { n });

/** Requests that came in by mail, so the generic "order received" notice is not sent twice. */
const mailKeys = new Set();

/** HTML paragraphs from plain lines. Every line is escaped. */
export const html = (lines) => lines.filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join('');

/** Display name and ticker for a stock or fund id. */
export function assetLabel(assetId) {
  const c = CompanyRepository.get(assetId);
  if (c) return { name: c.name, ticker: c.ticker };
  const f = FundRepository.get(assetId);
  return f ? { name: f.name, ticker: f.ticker } : { name: assetId, ticker: assetId };
}

/**
 * Send one mail to an account: to the character, or to every active member of a syndicate (DESIGN
 * §30). Money attached to a syndicate's mail would be paid to each member, so none is ever attached.
 * Succeeds if any copy was delivered.
 */
async function sendTo(actor, mail) {
  if (!actor?.isSyndicate) return NcmAdapter.send({ ...mail, toActorId: actor.id });
  let last = { ok: false, error: 'no-members' };
  for (const member of actor.members()) {
    const sent = await NcmAdapter.send({ ...mail, eddies: 0, toActorId: member.id, subject: `${actor.name}: ${mail.subject}` });
    if (sent.ok) last = sent;
    else if (!last.ok) last = sent;
  }
  return last;
}

export const MailService = {
  mailKeys,

  /**
   * A broker mails a client. A broker whose sheet has a recognised Personality writes in that voice:
   * a greeting, a line to suit the situation (`voice.kind`), the facts, then a sign-off. Any other
   * broker gets the standard wording, signed to match their skill grade.
   */
  async fromBroker(brokerId, actor, { subject, lines, eddies = 0, voice = null }) {
    const broker = BrokerRepository.get(brokerId);
    if (!broker) return { ok: false, error: 'no-broker' };
    const voiced = voice
      ? composeVoiced({ voices: BROKER_VOICES, personality: broker.personality, kind: voice.kind, data: voice.data, lines, standalone: voice.standalone, after: voice.after })
      : null;
    const paragraphs = voiced
      ? (voiced.signed ? voiced.paragraphs : [...voiced.paragraphs, L(`NCI.Mail.Sign.${broker.grade}`)])
      : [...lines, L(`NCI.Mail.Sign.${broker.grade}`)];
    return sendTo(actor, { fromContactId: brokerId, subject, body: html(paragraphs), eddies });
  },

  /** The market wire mails a client. */
  async fromWire(actor, { subject, lines, eddies = 0 }) {
    const wire = await NcmAdapter.ensureWire();
    if (!wire) return { ok: false, error: 'no-wire' };
    return sendTo(actor, { fromContactId: wire.id, subject, body: html(lines), eddies });
  },

  /** The system contact NCPD Financial Crimes mails a client. */
  async fromNcpd(actor, { subject, lines }) {
    const ncpd = await NcmAdapter.ensureNcpd();
    if (!ncpd) return { ok: false, error: 'no-ncpd' };
    return sendTo(actor, { fromContactId: ncpd.id, subject, body: html(lines) });
  },

  // ── Broker replies and notices ─────────────────────────────────────────────

  orderAccepted(order, { tick }) {
    const a = assetLabel(order.assetId);
    const ref = orderRef(order.id);
    return {
      subject: L('NCI.Mail.Accepted.Subject', { ref }),
      voice: { kind: 'accepted', data: { ticker: a.ticker, name: a.name } },
      lines: [
        L('NCI.Mail.Accepted.Line1', { side: L(`NCI.Side.${order.side}`), qty: order.qty, name: a.name, ticker: a.ticker }),
        L('NCI.Mail.Accepted.Line2', { days: days(Math.max(1, Math.ceil(order.eligibleTick - tick - 1e-6))) }),
        L('NCI.Mail.Accepted.Line3', { ref }),
      ],
    };
  },

  orderFilled(event) {
    const a = assetLabel(event.assetId);
    const ref = orderRef(event.orderId);
    const lines = [
      L('NCI.Mail.Filled.Line1', { side: L(`NCI.Side.${event.side}`), qty: event.qty, name: a.name, price: price(event.price) }),
      L('NCI.Mail.Filled.Line2', { fees: eb(event.fees), total: eb(event.side === 'buy' ? event.gross + event.fees : event.gross - event.fees) }),
    ];
    if (event.assetType === 'fund' && typeof event.timingBps === 'number') {
      lines.push(L(event.timingBps >= 0 ? 'NCI.Mail.Filled.TimingBetter' : 'NCI.Mail.Filled.TimingWorse', { bps: Math.abs(Math.round(event.timingBps)) }));
    }
    if (event.side === 'sell' && typeof event.realized === 'number') {
      lines.push(L('NCI.Mail.Filled.Realized', { pnl: `${event.realized >= 0 ? '+' : ''}${eb(event.realized)}` }));
    }
    if (event.waiting) lines.push(L('NCI.Mail.Filled.Waiting', { name: a.name, qty: event.waiting }));
    if (event.side === 'sell' && event.settleDays > 0) {
      lines.push(L('NCI.Mail.Filled.Settles', { days: days(event.settleDays) }));
    }
    const kind = event.side === 'buy' ? 'filledBuy' : event.realized > 0 ? 'filledGain' : event.realized < 0 ? 'filledLoss' : 'filledSell';
    return { subject: L('NCI.Mail.Filled.Subject', { ref }), lines, voice: { kind, data: { ticker: a.ticker, name: a.name } } };
  },

  orderRejected(event) {
    const a = assetLabel(event.assetId);
    return {
      subject: L('NCI.Mail.Rejected.Subject', { ref: orderRef(event.orderId) }),
      voice: { kind: 'rejected' },
      lines: [L('NCI.Mail.Rejected.Line1', { side: L(`NCI.Side.${event.side}`), qty: event.qty, name: a.name }), L('NCI.Mail.Rejected.Line2', { reason: L(`NCI.Reasons.${event.reason}`) })],
    };
  },

  orderExpired(event) {
    const a = assetLabel(event.assetId);
    return {
      subject: L('NCI.Mail.Expired.Subject', { ref: orderRef(event.orderId) }),
      voice: { kind: 'expired', data: { ticker: a.ticker, name: a.name } },
      lines: [L('NCI.Mail.Expired.Line1', { side: L(`NCI.Side.${event.side}`), qty: event.qty, name: a.name })],
    };
  },

  withdrawalQueued(result) {
    const ref = orderRef(result.withdrawalId);
    return {
      subject: L('NCI.Mail.WithdrawalQueued.Subject', { ref }),
      voice: { kind: 'queued' },
      lines: [
        L('NCI.Mail.WithdrawalQueued.Line1', { amount: eb(result.amount), fee: eb(result.fee) }),
        L('NCI.Mail.WithdrawalQueued.Line2', { days: days(Math.max(1, Math.ceil(result.releaseTick - result.tick - 1e-6))), ref }),
      ],
    };
  },

  /** Sent with the money attached as claimable eddies. */
  withdrawalPaid(w) {
    return {
      subject: L('NCI.Mail.WithdrawalPaid.Subject', { amount: eb(w.amount) }),
      voice: { kind: 'paid' },
      lines: [L('NCI.Mail.WithdrawalPaid.Line1', { amount: eb(w.amount) }), L('NCI.Mail.WithdrawalPaid.Line2', { fee: eb(w.fee) })],
      eddies: w.amount,
    };
  },

  withdrawalFailed(w) {
    return {
      subject: L('NCI.Mail.WithdrawalFailed.Subject'),
      voice: { kind: 'failed' },
      lines: [L('NCI.Mail.WithdrawalFailed.Line1', { amount: eb(w.amount + w.fee) })],
    };
  },

  cancelled(kind, ref) {
    return { subject: L('NCI.Mail.Cancelled.Subject', { ref }), lines: [L(`NCI.Mail.Cancelled.${kind}`, { ref })], voice: { kind: 'cancelled' } };
  },

  rejectedRequest(reason, ticker) {
    return {
      subject: L('NCI.Mail.RejectedRequest.Subject'),
      voice: { kind: 'rejected' },
      lines: [L('NCI.Mail.RejectedRequest.Line1', { reason: L(`NCI.Reasons.${reason}`), ticker: ticker ?? '' })],
    };
  },

  unrecognised() {
    return { subject: L('NCI.Mail.Unrecognised.Subject'), lines: [L('NCI.Mail.Unrecognised.Line1'), L('NCI.Mail.Help.Commands')], voice: { kind: 'unrecognised' } };
  },

  help() {
    return {
      subject: L('NCI.Mail.Help.Subject'),
      voice: { kind: 'help' },
      lines: [L('NCI.Mail.Help.Line1'), L('NCI.Mail.Help.Commands'), L('NCI.Mail.Help.Line2')],
    };
  },

  notClient() {
    return { subject: L('NCI.Mail.NotClient.Subject'), lines: [L('NCI.Mail.NotClient.Line1')], voice: { kind: 'notClient' } };
  },

  /** @param {{cash: number, holdings: number, openOrders: number, positions: object[]}} s */
  status(s) {
    return {
      subject: L('NCI.Mail.Status.Subject'),
      voice: { kind: 'report' },
      lines: [
        L('NCI.Mail.Status.Line1', { cash: eb(s.cash), holdings: eb(s.holdings), orders: s.openOrders }),
        ...s.positions.map((p) => L('NCI.Mail.Status.Position', { ticker: p.ticker, qty: p.qty, value: eb(p.value), pnl: `${p.pnl >= 0 ? '+' : ''}${eb(p.pnl)}` })),
      ],
    };
  },

  // ── Market wire ────────────────────────────────────────────────────────────

  dividend({ name, perShare, payout }) {
    return {
      subject: L('NCI.Mail.Dividend.Subject', { name }),
      lines: [L('NCI.Mail.Dividend.Line1', { name, perShare: price(perShare) }), L('NCI.Mail.Dividend.Line2', { payout: eb(payout) })],
    };
  },

  /**
   * A rumour about a company, sent ahead of a gig's effect on the price. Says which way, never why.
   * Every part is picked at random from several wordings. A broker with a voice writes the whole
   * thing themselves (`standalone`), with their own hedge afterwards; otherwise the standard
   * wording is used.
   */
  tip({ name, ticker, outcome }) {
    const data = { name, ticker };
    const pick = (group) => {
      const n = GIG_TIP_VARIANTS[group];
      const pool = Array.from({ length: n }, (_, i) => `NCI.Mail.Tip.${group}.${i + 1}`);
      return L(pickLine(pool, `tip:${group}`), data);
    };
    return {
      subject: pick('Subject'),
      voice: { kind: outcome === 'failed' ? 'tipDown' : 'tipUp', data, standalone: true, after: 'tipHedge' },
      lines: [pick(outcome === 'failed' ? 'Down' : 'Up'), pick('Hedge')],
    };
  },

  /** A heat-mail wording picked at random from NCI.Mail.Heat.<group>.<n>, never the one used last time. */
  _heatLine(group, count, data) {
    const pool = Array.from({ length: count }, (_, i) => `NCI.Mail.Heat.${group}.${i + 1}`);
    return L(pickLine(pool, `heat:${group}`), data);
  },

  /** A broker's nervous word to a client whose trading has been noticed. Never says how much, or who noticed. */
  heatWarning() {
    return {
      subject: this._heatLine('WarningSubject', HEAT_MAIL_VARIANTS.WarningSubject),
      voice: { kind: 'warning', data: {} },
      lines: [this._heatLine('WarningLine', HEAT_MAIL_VARIANTS.WarningLine), this._heatLine('WarningAdvice', HEAT_MAIL_VARIANTS.WarningAdvice)],
    };
  },

  /** NCPD Financial Crimes asks, politely, about a client's recent trades. */
  ncpdEnquiry() {
    return {
      subject: this._heatLine('EnquirySubject', HEAT_MAIL_VARIANTS.EnquirySubject),
      lines: [this._heatLine('EnquiryLine', HEAT_MAIL_VARIANTS.EnquiryLine), this._heatLine('EnquiryAdvice', HEAT_MAIL_VARIANTS.EnquiryAdvice)],
    };
  },

  /**
   * NCPD's notice of a penalty that has been applied.
   * @param {'fine'|'freeze'} kind
   * @param {{paid?: number, shortfall?: number, days?: number}} p
   */
  ncpdPenalty(kind, { paid = 0, shortfall = 0, days = 0 } = {}) {
    if (kind === 'freeze') {
      return { subject: L('NCI.Mail.Heat.Freeze.Subject'), lines: [L('NCI.Mail.Heat.Freeze.Line1', { days: days === 1 ? L('NCI.Mail.Days.one', { n: 1 }) : L('NCI.Mail.Days.many', { n: days }) }), L('NCI.Mail.Heat.Freeze.Line2')] };
    }
    return {
      subject: L('NCI.Mail.Heat.Fine.Subject'),
      lines: [L('NCI.Mail.Heat.Fine.Line1', { amount: eb(paid) }), shortfall > 0 ? L('NCI.Mail.Heat.Fine.Short', { amount: eb(shortfall) }) : '', L('NCI.Mail.Heat.Fine.Line2')],
    };
  },

  /** A broker tells a client they can no longer act for them. */
  brokerDropped() {
    return {
      subject: L('NCI.Mail.Heat.Dropped.Subject'),
      voice: { kind: 'dropped', data: {} },
      lines: [L('NCI.Mail.Heat.Dropped.Line1'), L('NCI.Mail.Heat.Dropped.Line2')],
    };
  },

  headline(item) {
    return { subject: item.headline, lines: [item.headline] };
  },

  /** A gig's market headline sent by a broker, with their rumour-style lead-in. */
  gigHeadline(item) {
    const company = CompanyRepository.get(item.companyIds?.[0]);
    return {
      subject: item.headline,
      lines: [item.headline],
      voice: { kind: item.tone === 'down' ? 'tipDown' : 'tipUp', data: { name: company?.name ?? '', ticker: company?.ticker ?? '' } },
    };
  },

  /** Holdings that moved a lot today. `movers` is from `moversOf`. */
  movers(movers, threshold) {
    return {
      subject: L('NCI.Mail.Movers.Subject'),
      lines: [
        L('NCI.Mail.Movers.Line1', { pct: threshold }),
        ...movers.map((m) => L('NCI.Mail.Movers.Mover', {
          ticker: assetLabel(m.assetId).ticker, pct: `${m.changePct >= 0 ? '+' : ''}${(m.changePct * 100).toFixed(1)}%`,
          price: price(m.price), delta: `${m.delta >= 0 ? '+' : ''}${eb(m.delta)}`,
        })),
      ],
    };
  },

  /** A price alert has come true. `ev` is an `alertFired` event. */
  alert(ev) {
    const a = assetLabel(ev.assetId);
    const data = { name: a.name, ticker: a.ticker, price: price(ev.price), value: price(ev.value) };
    const line = ev.kind === 'move'
      ? L('NCI.Mail.Alert.Move', { ...data, pct: `${(((ev.price - ev.prevClose) / ev.prevClose) * 100).toFixed(1)}%`, value: ev.value })
      : L(ev.kind === 'above' ? 'NCI.Mail.Alert.Above' : 'NCI.Mail.Alert.Below', data);
    return { subject: L('NCI.Mail.Alert.Subject', { ticker: a.ticker }), lines: [line] };
  },

  /** A brokerage statement from `engine/statements.js`. */
  statement(s) {
    const f = s.flows;
    const signed = (n) => `${n >= 0 ? '+' : ''}${eb(n)}`;
    const lines = [
      s.fromTick === null ? L('NCI.Mail.Statement.PeriodAll', { to: Math.floor(s.toTick + 1e-6) }) : L('NCI.Mail.Statement.Period', { from: Math.floor(s.fromTick + 1e-6), to: Math.floor(s.toTick + 1e-6) }),
      s.opening === null ? '' : L('NCI.Mail.Statement.Opening', { opening: eb(s.opening) }),
      L('NCI.Mail.Statement.Value', { total: eb(s.closing.total), cash: eb(s.closing.cash), holdings: eb(s.closing.holdings) }),
      s.closing.unsettled ? L('NCI.Mail.Statement.Settling', { amount: eb(s.closing.unsettled) }) : '',
      L('NCI.Mail.Statement.Flows', {
        deposits: eb(f.deposits), withdrawals: eb(f.withdrawals), bought: eb(f.bought), sold: eb(f.sold), fees: eb(f.fees),
      }),
      L('NCI.Mail.Statement.Income', { dividends: eb(f.dividends), reinvested: eb(f.reinvested) }),
      s.gain === null ? '' : L('NCI.Mail.Statement.Performance', { gain: signed(s.gain), pct: `${s.gainPct >= 0 ? '+' : ''}${(s.gainPct * 100).toFixed(2)}%` }),
      L('NCI.Mail.Statement.Realized', { realized: signed(s.realized), unrealized: signed(s.unrealized) }),
      s.openOrders ? L('NCI.Mail.Statement.OpenOrders', { n: s.openOrders }) : '',
    ];
    if (!s.positions.length) lines.push(L('NCI.Mail.Statement.NoPositions'));
    for (const p of s.positions) {
      lines.push(L('NCI.Mail.Statement.Position', {
        ticker: assetLabel(p.assetId).ticker, qty: p.qty, price: price(p.price), value: eb(p.value),
        weight: `${(p.weight * 100).toFixed(0)}%`, pnl: signed(p.unrealized), pnlpct: `${(p.unrealizedPct * 100).toFixed(1)}%`,
      }));
    }
    return { subject: L('NCI.Mail.Statement.Subject', { to: Math.floor(s.toTick + 1e-6) }), lines, voice: { kind: 'report' } };
  },

  digest(d) {
    return {
      subject: L('NCI.Mail.Digest.Subject'),
      lines: [
        L('NCI.Mail.Digest.Line1', { holdings: eb(d.holdings), change: `${d.change >= 0 ? '+' : ''}${eb(d.change)}`, pct: `${(d.changePct * 100).toFixed(2)}%` }),
        ...d.movers.map((m) => L('NCI.Mail.Digest.Mover', { ticker: assetLabel(m.assetId).ticker, pct: `${(m.changePct * 100).toFixed(2)}%`, delta: `${m.delta >= 0 ? '+' : ''}${eb(m.delta)}` })),
      ],
    };
  },
};
