/**
 * NCM adapter: everything this module needs from Night City Messenger, behind one door.
 * @file scripts/integrations/NcmAdapter.js
 * @description NCM exposes its services at game.nightcity (its stable `api` object does not yet
 *              include messaging). Every call here is guarded, so a missing or changed NCM degrades
 *              to "no mail" instead of breaking the market.
 */

import { BROKER_TAG, WIRE_TAG, WIRE_NAME, NCPD_TAG, NCPD_NAME } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

const svc = (name) => game.nightcity?.[name] ?? null;

export const NcmAdapter = {
  /** Can mail be sent right now? */
  available() {
    return typeof svc('messageService')?.sendMessage === 'function';
  },

  /** Is the network service there to ask about CorpNet? */
  hasNetworks() {
    return typeof svc('networkService')?.isOnNetwork === 'function';
  },

  // ── Contacts ───────────────────────────────────────────────────────────────

  contactsTagged(tag) {
    try {
      return svc('masterContactService')?.filterByTag?.(tag) ?? [];
    } catch (error) {
      log.warn('Could not list NCM contacts', error);
      return [];
    }
  },

  /**
   * Contacts with this tag as a word in any of their tags. Messenger splits tags on commas only, so a GM who types
   * "Investor Broker" or "investor; fixer" gets one tag holding both words, which an exact match misses.
   */
  contactsWithTagWord(tag) {
    const wanted = String(tag).toLowerCase();
    try {
      const all = svc('masterContactService')?.getAll?.() ?? [];
      return all.filter((c) => (c.tags ?? []).some((t) => String(t).toLowerCase().split(/[^a-z0-9_-]+/).includes(wanted)));
    } catch (error) {
      log.warn('Could not list NCM contacts', error);
      return [];
    }
  },

  brokerContacts() {
    return this.contactsTagged(BROKER_TAG);
  },

  contact(id) {
    try {
      return svc('masterContactService')?.getContact?.(id) ?? null;
    } catch {
      return null;
    }
  },

  contactForActor(actorId) {
    try {
      return svc('masterContactService')?.getByActorId?.(actorId) ?? null;
    } catch {
      return null;
    }
  },

  /** Every contact in NCM's master directory. */
  allContacts() {
    try {
      return svc('masterContactService')?.getAll?.() ?? [];
    } catch {
      return [];
    }
  },

  /** GM only. Adds a contact to NCM's master directory. */
  async addContact(data) {
    const result = await svc('masterContactService')?.addContact?.(data);
    return result?.success ? result.contact : null;
  },

  /** GM only. Adds the broker tag to an existing contact. */
  async tagAsBroker(contactId) {
    const contact = this.contact(contactId);
    if (!contact) return false;
    const tags = [...new Set([...(contact.tags ?? []), BROKER_TAG])];
    const result = await svc('masterContactService')?.updateContact?.(contactId, { tags });
    return !!result?.success;
  },

  /** The system contact that sends market mail. GM only (it creates the contact the first time). */
  async ensureWire() {
    const existing = this.contactsTagged(WIRE_TAG)[0];
    if (existing) return existing;
    return this.addContact({
      name: WIRE_NAME,
      email: 'wire@nightcity.market',
      tags: [WIRE_TAG],
      organization: 'Night City Market',
      sendOnly: true,
      notes: 'Created by Night City Investments. Sends market news, dividends and digests.',
    });
  },

  /** The system contact that sends official notices (an NCPD enquiry, a fine). GM only: it creates the contact the first time. */
  async ensureNcpd() {
    const existing = this.contactsTagged(NCPD_TAG)[0];
    if (existing) return existing;
    return this.addContact({
      name: NCPD_NAME,
      email: 'fincrimes@ncpd.gov',
      tags: [NCPD_TAG],
      organization: 'NCPD',
      sendOnly: true,
      notes: 'Created by Night City Investments. Sends enquiries and penalty notices about insider trading.',
    });
  },

  // ── Mail ───────────────────────────────────────────────────────────────────

  /**
   * Send a mail from a contact to a character. The body is HTML. `eddies` attaches claimable money.
   * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
   */
  async send({ fromContactId, toActorId, subject, body, eddies = 0 }) {
    const service = svc('messageService');
    if (typeof service?.sendMessage !== 'function') return { ok: false, error: 'ncm-unavailable' };
    try {
      const result = await service.sendMessage({
        priority: 'normal',
        fromContactId,
        toActorId,
        subject: String(subject).slice(0, 190),
        body,
        ...(eddies > 0 ? { eddies: Math.round(eddies) } : {}),
      });
      return result?.success ? { ok: true, messageId: result.messageId } : { ok: false, error: result?.error ?? 'send-failed' };
    } catch (error) {
      log.warn('Sending NCM mail failed', error);
      return { ok: false, error: String(error?.message ?? error) };
    }
  },

  /**
   * Read a message by id. The same mail sits in the sender's and the recipient's inbox, so try each
   * inbox key until one has it.
   * @param {string[]} inboxIds - actor ids and/or contact ids to look in
   */
  async getMessage(inboxIds, messageId) {
    const repo = svc('messageRepository');
    if (typeof repo?.getMessage !== 'function') return null;
    for (const id of inboxIds.filter(Boolean)) {
      try {
        const message = await repo.getMessage(id, messageId);
        if (message) return message;
      } catch {
        // Try the next inbox.
      }
    }
    return null;
  },

  /**
   * Call `fn` whenever this client's network changes (switching, a dead zone, a network edited or
   * removed). Returns false when NCM has no event bus to listen to.
   */
  onNetworkChange(fn) {
    const bus = svc('eventBus');
    if (typeof bus?.on !== 'function') return false;
    for (const event of ['network:changed', 'network:connected', 'network:disconnected', 'network:authSuccess']) bus.on(event, fn);
    return true;
  },

  /** CorpNet (or whichever network) state of this client: are we on it, and signed in? */
  networkState(networkId) {
    const net = svc('networkService');
    if (typeof net?.isOnNetwork !== 'function') return { known: false, on: false, authenticated: false, requiresAuth: false };
    const on = !!net.isOnNetwork(networkId);
    const requiresAuth = !!net.getNetwork?.(networkId)?.requiresAuth;
    const authenticated = typeof net.isAuthenticated === 'function' ? !!net.isAuthenticated(networkId) : !requiresAuth;
    return { known: true, on, authenticated, requiresAuth };
  },
};
