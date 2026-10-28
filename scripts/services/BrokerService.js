/**
 * Broker service: reads mail players send to their broker and acts on it. GM client only.
 * @file scripts/services/BrokerService.js
 * @description A player mails their broker "BUY 10 ARA", "SELL ALL NC12", "WITHDRAW 500", "STATUS"
 *              and so on. Only the player's own assigned broker acts on their mail. Each mail is
 *              handled once (by message id), and the broker replies in character.
 */

import { parseOrderText, mailCommandToRequest, orderRef } from '../engine/index.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { BrokerRepository } from '../data/BrokerRepository.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { NcmAdapter } from '../integrations/NcmAdapter.js';
import { PortfolioService } from './PortfolioService.js';
import { NotificationService } from './NotificationService.js';
import { MailService } from './MailService.js';
import { StatementService } from './StatementService.js';

const SEEN_CAP = 500;
const seen = new Set();

const stripHtml = (s) => String(s ?? '')
  .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/g, '&');

/** Stock or fund for a ticker, as the mail translator wants it. */
function resolveAsset(ticker) {
  const c = CompanyRepository.getByTicker(ticker);
  if (c) return { assetId: c.id, kind: 'stock' };
  const f = FundRepository.getByTicker(ticker);
  return f ? { assetId: f.id, kind: 'fund' } : null;
}

const tickerOf = (assetId) => CompanyRepository.get(assetId)?.ticker ?? FundRepository.get(assetId)?.ticker ?? assetId;

export const BrokerService = {
  /** Handler for NCM's `message:sent` hook (fires on the GM client that delivered the mail). */
  async onMessageSent(data) {
    if (!isActiveGM() || !data?.messageId) return;
    const contactId = data.toContactId ?? BrokerRepository.byActor(data.toActorId)?.id;
    if (!contactId || !BrokerRepository.isBroker(contactId)) return;

    const actor = game.actors.get(data.fromActorId);
    if (!actor || actor.type !== 'character') return;

    if (seen.has(data.messageId)) return;
    seen.add(data.messageId);
    if (seen.size > SEEN_CAP) seen.delete(seen.values().next().value);

    const contact = NcmAdapter.contact(contactId);
    const message = await NcmAdapter.getMessage([actor.id, contact?.actorId, contactId], data.messageId);
    const text = `${message?.subject ?? data.subject ?? ''}\n${stripHtml(message?.body)}`;

    try {
      await this.handle(actor, contactId, text, data.messageId);
    } catch (error) {
      log.error('Handling broker mail failed', error);
    }
  },

  /**
   * Act on the text of one mail to a broker.
   * @returns {Promise<'ignored'|'not-client'|'replied'|'applied'>}
   */
  async handle(actor, contactId, text, messageId) {
    const key = `mail_${messageId}`;
    const portfolio = PortfolioRepository.get(actor);
    if (portfolio.processed.includes(key)) return 'ignored';

    const reply = (spec) => MailService.fromBroker(contactId, actor, spec);

    if (portfolio.brokerContactId !== contactId) {
      await PortfolioService.markProcessed(actor, key);
      await reply(MailService.notClient());
      return 'not-client';
    }

    const cmd = mailCommandToRequest({ parsed: parseOrderText(text), key, portfolio, resolveAsset });

    if (!cmd.ok) {
      await PortfolioService.markProcessed(actor, key);
      await reply(cmd.reason === 'unrecognised' ? MailService.unrecognised() : MailService.rejectedRequest(cmd.reason, cmd.ticker));
      return 'replied';
    }

    if (cmd.reply) {
      await PortfolioService.markProcessed(actor, key);
      if (cmd.reply === 'statement') {
        await StatementService.sendRequested(actor);
        return 'replied';
      }
      await reply(cmd.reply === 'help' ? MailService.help() : MailService.status(this._status(actor)));
      return 'replied';
    }

    MailService.mailKeys.add(key);
    const out = await PortfolioService.applyNow(actor, cmd.request);
    if (!out?.result) return 'ignored';
    await reply(this._replyFor(cmd.request, out, actor));
    return 'applied';
  },

  _status(actor) {
    const prices = {};
    for (const [id, c] of Object.entries(PortfolioService.market())) prices[id] = c.price;
    return NotificationService.statusOf(actor, prices, tickerOf);
  },

  /** The reply to send once a mail's request has been through the executor. */
  _replyFor(request, { result, portfolio }, actor) {
    const tick = result.tick;
    if (!result.ok) return MailService.rejectedRequest(result.reason, request.assetId ? tickerOf(request.assetId) : '');

    switch (request.type) {
      case 'placeOrder': {
        const order = portfolio.orders.find((o) => o.id === result.orderId);
        return MailService.orderAccepted(order, { tick });
      }
      case 'withdraw':
        // Only a broker-handled withdrawal is queued; anything else already completed, so just report the account.
        return result.pending ? MailService.withdrawalQueued({ ...result, tick }) : MailService.status(this._status(actor));
      case 'cancelOrder':
        return MailService.cancelled('order', orderRef(request.orderId));
      case 'cancelWithdrawal':
        return MailService.cancelled('withdrawal', orderRef(request.withdrawalId));
      default:
        return MailService.unrecognised();
    }
  },
};
