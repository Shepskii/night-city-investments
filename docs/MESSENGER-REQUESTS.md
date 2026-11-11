# Requests for Night City Messenger

From Night City Investments, a module that sends a lot of mail through Night City Messenger: market news, broker replies, payslips with claimable eddies, and mail from gangs, corporations, staff and officials, each from a directory contact of its own.

These are requests, not changes. Night City Messenger is your module, and nothing here has been changed in it. They were checked against 2.3.3, with v2 API 2.1.0; the test server runs 2.3.4. Line numbers are from 2.3.3.

## 1. Toast previews show raw HTML (a bug)

A mail whose body is HTML shows its tags in the toast, for example `"<p>Testing one toast.</p>"`. The preview is the body's first 100 characters, taken as is:

- `scripts/services/MessageService.js:739`: `preview: data.body?.substring(0, 100) || ''`
- `scripts/integrations/DocumentSyncBridge.js:356`: `preview: (msgFlags.body || '').substring(0, 100)`

Every module that sends HTML gets this, and Messenger's own composer may too. v2 already strips tags for its message summaries (`publicApi.js:73`, `messageSummary`), so the same treatment would fix the toast:

```js
String(body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
```

Decoding entities such as `&#39;` and `&amp;` would also help, since a sender's apostrophe arrives escaped. Optionally, `sendMessage` could accept a `preview` field for a sender that wants to choose the line.

## 2. `v2.messages.send` drops eddies and anonymous senders

`messages.send` builds its own data object (`publicApi.js:146-147`), so `eddies` and `anonymous` never reach `messageService.sendMessage`. This module sends payslips, withdrawals and living costs as claimable eddies, and rumours from an anonymous source. For these it still calls the v1 service, `game.nightcity.messageService.sendMessage`. Passing those two fields through, with the same GM-only checks, would let it move to v2.

## 3. Directory contacts: tags, lookups and module flags

- **Tags in summaries.** `contactSummary` has no `tags`, `organization`, `alias`, `type` or `folder`. This module finds brokers, investors and staff by tag, so it reads `masterContactService.filterByTag` and `getAll`.
- **Lookups.** `directory.find({ tag, actorId })` would replace `filterByTag` and `getByActorId`. Some of these reads happen on players' clients (inviting a partner by search, picking a broker), where `directory` is GM-only. A player-safe lookup that returns names and tags without GM notes would cover them.
- **Flags for a module's own contacts.** This module makes contacts for factions, papers, the city and so on. It keeps its own map from its keys to contact ids, on a GM-only journal, so it can find them again. A `flags: { [moduleId]: {...} }` field on a contact, kept by add, update and summaries, would let it find its own contacts without that map.
- **Tags typed with spaces.** The directory form splits tags on commas only, so a GM who types "investor broker" gets one tag holding both words. This module now matches tag words, but a hint in the form, or splitting on spaces and semicolons too, would save GMs a puzzle.

## 4. Pushing contacts to players

- **Already there?** `directory.pushToPlayer` doesn't say whether the character already had the contact, so this module records who it has given each contact to. A `{ alreadyHad: true }` in the result, or a `directory.holders(contactId)` call, would do.
- **Taking one back.** There's no way to remove a pushed contact, so a broker a character dropped stays in their list. A `directory.pullFromPlayer(contactId, actorId)` would cover it.

## 5. Reading one message

To read a broker order from a reply, this module needs the whole body. v2's `listFor` gives a 140-character preview, so it calls `messageRepository.getMessage(inboxId, messageId)` and tries each inbox key in turn. A GM-only `messages.get(messageId)`, or `get(inboxId, messageId)` with the body, would replace that.

## 6. Network state

Direct trading needs the character on CorpNet and signed in. `v2.networks` gives the current network but not whether this client is signed in to a given one, so this module calls `networkService.isOnNetwork`, `isAuthenticated`, `getNetwork(id).requiresAuth` and `simple`. It also listens on the internal event bus for `network:changed`, `network:connected`, `network:disconnected` and `network:authSuccess`. Two additions would cover it: `networks.state(networkId)`, returning `{ on, authenticated, requiresAuth }`, and a public `network:changed` event.

## 7. Making a data shard

Evidence found in play becomes a data shard through `game.nightcity.messenger.convertToDataShard(item)` and `addShardMessage(item, {...})`. v2 can open shards but not make them. A GM-only `shards.create(item, { from, to, subject, body })` would do.

## 8. Many toasts for one player (a suggestion, not a bug)

When one player owns several characters who get the same mail, for example three partners in one business, each inbox's copy toasts on that screen. That's correct, and your de-duplication by message id works. A player running several characters might still prefer copies that arrive within a few seconds with the same subject and sender folded into one toast ("3 inboxes").

## 9. Conversations

Broker orders are read only from mail, because Conversations has no public event. A `conversation:message` event, with the conversation, sender and text, would let modules answer there too.

## 10. Docs

`docs/API.md` refers to an `INTEGRATION.md` that isn't in the `docs` folder.

Thank you for the v2 API. `pushToPlayer`, `open.composer` and the public events have already replaced several workarounds here.
