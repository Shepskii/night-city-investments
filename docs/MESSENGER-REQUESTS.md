# Requests for Night City Messenger

From Night City Investments, a module that sends a lot of mail through Night City Messenger: market news, broker replies, payslips with claimable eddies, and mail from gangs, corporations, staff and officials, each from a directory contact of its own. Request 11 is from the Scene Tools Access Point Bridge, which opens Messenger terminals and NET Architect netruns at Pneuma's Scene Tools access points.

These are requests, not changes. Night City Messenger is your module, and nothing here has been changed in it. They were first checked against 2.3.3, with v2 API 2.1.0.

**Checked again against 2.4.0, with v2 API 2.2.0.** Requests 1 to 10 are all still open, except that `shards.addEntry` now covers half of request 7. Line numbers below are from 2.4.0. Thank you for the 2.2.0 additions: `terminals.create`, `addFile` and `registerCommand`, `shards`, `items.keyTag` and the HUD timers all open up new things for other modules.

## 1. Toast previews show raw HTML (a bug)

A mail whose body is HTML shows its tags in the toast, for example `"<p>Testing one toast.</p>"`. The preview is the body's first 100 characters, taken as is:

- `scripts/services/MessageService.js:739` (still there in 2.4.0): `preview: data.body?.substring(0, 100) || ''`
- `scripts/integrations/DocumentSyncBridge.js:356`: `preview: (msgFlags.body || '').substring(0, 100)`

Every module that sends HTML gets this, and Messenger's own composer may too. v2 already strips tags for its message summaries (`publicApi.js:76`, `messageSummary`), so the same treatment would fix the toast:

```js
String(body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
```

Decoding entities such as `&#39;` and `&amp;` would also help, since a sender's apostrophe arrives escaped. Optionally, `sendMessage` could accept a `preview` field for a sender that wants to choose the line.

## 2. `v2.messages.send` drops eddies and anonymous senders

`messages.send` builds its own data object (`publicApi.js:164-165`), so `eddies` and `anonymous` never reach `messageService.sendMessage`. This module sends payslips, withdrawals and living costs as claimable eddies, and rumours from an anonymous source. For these it still calls the v1 service, `game.nightcity.messageService.sendMessage`. Passing those two fields through, with the same GM-only checks, would let it move to v2.

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

2.2.0's `networks.forScene(sceneId)` says which networks reach a scene, but not whether this client is on or signed in to one, so this request still stands.

Direct trading needs the character on CorpNet and signed in. `v2.networks` gives the current network but not whether this client is signed in to a given one, so this module calls `networkService.isOnNetwork`, `isAuthenticated`, `getNetwork(id).requiresAuth` and `simple`. It also listens on the internal event bus for `network:changed`, `network:connected`, `network:disconnected` and `network:authSuccess`. Two additions would cover it: `networks.state(networkId)`, returning `{ on, authenticated, requiresAuth }`, and a public `network:changed` event.

## 7. Making a data shard

Evidence found in play would become a data shard through `game.nightcity.messenger.convertToDataShard(item)` and `addShardMessage(item, {...})`. 2.2.0's `shards.addEntry` now covers the second. What's left is turning an existing item into a shard: a GM-only `shards.convert(itemIdOrUuid)`, alongside `terminals.create`, would finish it.

## 8. Many toasts for one player (a suggestion, not a bug)

When one player owns several characters who get the same mail, for example three partners in one business, each inbox's copy toasts on that screen. That's correct, and your de-duplication by message id works. A player running several characters might still prefer copies that arrive within a few seconds with the same subject and sender folded into one toast ("3 inboxes").

## 9. Conversations

Broker orders are read only from mail, because Conversations has no public event. A `conversation:message` event, with the conversation, sender and text, would let modules answer there too.

## 10. Docs

`docs/API.md` refers to an `INTEGRATION.md` that isn't in the `docs` folder.

## 11. Terminals and netruns

The Scene Tools Access Point Bridge lets a player log in at a terminal through `open.terminal`, and jack in to a NET Architect netrun at the same access point. The missing link is the netrun's result: when a Netrunner beats the run, the bridge can't unlock the terminal account it protects. Today the GM sets the terminal's hacking to **GM decides** and answers the PASS / FAIL prompt by hand.

The internals are there: `TerminalService.recordLoginSuccess(item, accountId, actorId)` for one character, `forceUnlock(item)` and `relock(item)` for the whole machine, and the NET_RESOLVE request and result for the GM's prompt (`ui/content/NetResolve.js`). Public versions of a few of them would close the gap:

- **List a terminal's accounts.** A GM-only `terminals.accounts(itemIdOrUuid)` returning `[{ id, name, requiresAuth, network }]`, without passwords, so the GM can choose which account a run opens.
- **Unlock an account for a character.** A GM-only `terminals.unlock(itemIdOrUuid, accountId, actorId)` that does what a correct password does for that character. Also `terminals.forceUnlock(itemIdOrUuid)` and `terminals.relock(itemIdOrUuid)` for the whole machine, as the GM's buttons do.
- **Hear about logins.** A public `terminal:login` event with `{ itemId, accountId, actorId, how }`, where `how` is password, hack or GM, so other modules can react: a netrun that knows its target is already open, or an alarm on a watched account.
- **Answer GM decides from a module.** A public `terminal:hackRequested` event when the PASS / FAIL prompt opens, with its `requestId`, the terminal, the account and the actor, plus a GM-only `terminals.resolveHack(requestId, 'pass' | 'fail')`. The bridge could then answer the prompt from the netrun's outcome, with the GM's prompt still there as the fallback.
- **Open as a character (minor).** `open.terminal(itemIdOrUuid, { actorId })`, as `game.nightcity.openTerminal(item, { actor })` already does. Players can switch character inside the terminal, so this is a nicety.

Thank you for the v2 API. `pushToPlayer`, `open.composer` and the public events have already replaced several workarounds here.
