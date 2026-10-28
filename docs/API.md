# API

For macros and other modules. Everything hangs off one object:

```js
const nci = game.modules.get('night-city-investments').api;
// or, once the game is ready, the same object under the Night City namespace:
const nci2 = game.nightcity.investments;
```

Wait for the `night-city-investments.ready` hook if you load early. It fires once every part of the API is attached (`night-city-investments.apiReady` fires slightly earlier, with only `apiVersion` and `engine` in place):

```js
Hooks.once('night-city-investments.ready', (api) => { /* api.market, api.portfolio, api.gm ... */ });
```

`api.apiVersion` is the module version (`"0.9.6"`). Pieces are added as the module starts, so read them at `ready` or later. Anything marked **GM** only works on the **active GM's** client and quietly refuses elsewhere (it returns `null`, `[]` or `{ ok: false, status: 'not-gm' }`). Players never write market state: they can only make requests for their own characters.

## Windows and checks

| Call | What it does |
|---|---|
| `api.open()` | Open the Market Terminal. |
| `api.openGM()` | Open the GM Console (GM only). |
| `api.verify({ silent })` | **GM.** Self-check of companies, funds, the market, portfolios and the NCM link. Returns `{ ok, counts, checks: [{ id, level, detail }] }` (levels: `ok`, `info`, `warn`, `fail`). Unless `silent`, it also logs a summary and shows a notification. |
| `api.schemaVersion` | The stored-data schema this module version expects. |

## Market (read-only, any client)

| Call | Returns |
|---|---|
| `api.market.companies()` | Company definitions the user can see (unlisted ones only for a GM), sorted by ticker. |
| `api.market.company(idOrTicker)` | One company, or `null`. |
| `api.market.state()` | Public state: `{ tickIndex, time, mood, companies: { [id]: { price, prevClose, ... } }, funds: { [id]: { nav, prevNav } } }`. `time` is the market clock in game days (a float); `prevClose` is the previous game day's close. Fair values and the true regime are never in it. |
| `api.market.history()` | Price history `{ series: { [id]: [...] } }`. |
| `api.market.news()` | The public news feed. |
| `api.market.advance(ticks = 1)` | **GM.** Advance the market by that many ticks (each a fraction of a game day in the in-world clock mode, a whole day otherwise). The game days they cover move the market's date on past the calendar's. |

## Portfolios (the calling user's own characters)

These write a request into the actor's outbox, which the active GM's client carries out. Each returns the request key (or `null` if the outbox is full). Watch for the result with the `portfolioEvents` hook, or read `results` on the portfolio.

```js
const actor = game.actors.getName('Johnny');
await api.portfolio.deposit(actor, 5000);
await api.portfolio.placeOrder(actor, { route: 'broker', side: 'buy', assetId: 'ARA', qty: 10, orderType: 'market', expiry: 'day' });
api.portfolio.get(actor);   // { cash, lots, orders, ledger, ... }
```

| Call | Notes |
|---|---|
| `api.portfolio.get(actor)` | The stored portfolio, with missing fields filled in. |
| `api.portfolio.pending(actor)` | Requests the GM has not handled yet. |
| `api.portfolio.deposit(actor, amount)` | From the character's wallet into the brokerage balance. |
| `api.portfolio.withdraw(actor, amount)` | Back to the wallet. With a broker it is delayed and paid by mail. |
| `api.portfolio.placeOrder(actor, order)` | `order`: `route` (`'direct'` or `'broker'`), `side` (`'buy'` or `'sell'`), `assetId` (a company or fund id), `qty`, `orderType` (`'market'`, `'limit'`, `'stop'`), `limit` (for limit and stop), `expiry` (`'day'` or `'gtc'`). |
| `api.portfolio.cancelOrder(actor, orderId)` | Cancel an open order. |

## Brokers, funds, terminal

| Call | Returns |
|---|---|
| `api.brokers.list()` / `.get(id)` | Brokers (NCM contacts tagged `broker`) with their skill, grade, personality voice and trading terms. |
| `api.funds.list()` / `.get(id)` | Fund definitions (components, fees, rebalance and distribution settings). |
| `api.terminal.claim()` | This client's CorpNet access: `{ ok, network, on, authenticated }`. |
| `api.terminal.connect(actor)` | Ask to open a direct-trading session. The Accounting check is rolled on the calling client (the player's) and verified by the GM's executor. |

## Events from other modules

For the Night City Map bridge, or any module that knows a company has had news.

```js
const out = await api.events.reportImpact({
  gigId: 'abc123',            // or sourceKey: 'myModule:thing:42'
  outcome: 'done',            // 'done' | 'failed'
  client: 'Arasaka',
  reward: 3000,               // a number, or text such as "1,500 eb" or "2k"
  title: 'Courier job',
  notes: '[NCI: ARA]',        // optional: name the company outright, or [NCI: ignore]
  desc: '',
});
// out: { ok, status, id?, companyId?, percent?, delayDays? }
// status: applied | pending | unmatched | ignored | duplicate | disabled | invalid | not-gm | failed
```

- `api.events.reportImpact(payload)`: **GM.** Each source key can move the market once; reporting it again returns `duplicate`.
- `api.events.resolveClient(gig)`: which company a gig client would match. `gig` is a string or `{ client, notes, text }`. Returns `{ status: 'matched' | 'ignored' | 'ambiguous' | 'unmatched', companyId?, how?, needsReview?, candidates? }`.
- `api.events.isReported(sourceKey)`: has this key been reported already?

## GM services: `api.gm`

All **GM**. Useful from macros and scripts.

| Object | Calls |
|---|---|
| `api.gm.controls` | `addBias({ target, value, days, decay })`, `removeBias(id)`, `forceRegime(regime, days)`, `clearRegime()`, `setVolatility(multiplier)`, `setHalt(halted)`, `addShock({ target, percent, delayDays, persistence, headline })`, `removeImpact(id)`, `addGlide({ companyId, target, days, noise })`, `removeGlide(id)`, `targetOptions()` |
| `api.gm.corporateActions` | `split(companyId, ratio)`, `buyout(companyId, price)`, `delist(companyId)`, `bankrupt(companyId)`, `setPrice(companyId, price)` |
| `api.gm.dividends` | `declareSpecial(companyId, perShare)` |
| `api.gm.ipo` | `listNow(companyId)` |
| `api.gm.news` | `post({ headline, tone, companyIds })` |
| `api.gm.undo` | `available()`, `undo()` |
| `api.gm.preview` | `run(scenario, days)` |
| `api.gm.funds` | `save(input)`, `importStarter()`, `liquidate(id)` |
| `api.gm.gigs` | `report`, `approve(id, edits)`, `discard(id)`, `mapClient`, `addMapping(client, target)`, `removeMapping(key)`, `counts()` |
| `api.gm.heat` | `heatOf(actorId)`, `tierOf(actorId)`, `snapshot()`, `setHeat(actorId, value)`, `approvePenalty(id, edits)`, `dismissPenalty(id)` |
| `api.gm.tools` | `verify(opts)`, `tradeLog({ limit, actorId, assetId })`, `suggestions(limit)`, `createMacros()`, `migrate()` |

`api.gm.tools.tradeLog()` returns the latest fills newest first: `{ tick, actorId, name, side, assetId, qty, price, gross, fees, route, brokerId, realized }`.

## Pure engine

`api.engine` is the whole pure engine (`scripts/engine/index.js`): the price model, order and portfolio rules, validation (`sanitizeCompany`, `sanitizeFund`) and the migration, self-check and suggestion functions. It touches no Foundry globals, so it is safe to call from anywhere and is what the tests run against.

## Hooks

Fired with `Hooks.callAll`, on every client unless noted. Names are prefixed `night-city-investments.`.

| Hook | Payload | When |
|---|---|---|
| `apiReady` | `api` | The API object exists, with only `apiVersion` and `engine`. |
| `ready` | `api` | Every part of the API is attached. Use this one. |
| `marketUpdated` | none | Market state changed; windows refresh. |
| `companiesChanged` | none | A company journal changed. |
| `priceTick` | `{ tickIndex, time, ticks, dt, newDay, days, results }` | After a tick (or several) was run. `time` is the market clock in game days, `dt` the days one tick covers, `newDay` whether a new game day started, `days` how many. `results[id]` has `open`, `close`, `r`. |
| `portfolioUpdated` | `actorId` | A portfolio changed. |
| `portfolioEvents` | `{ actorId, events, results }` | **GM client.** What the executor did for one character: order fills, rejections, payouts, and the result of each request. |
| `orderFilled` | `{ actorId, orderId, side, assetId, route, qty, price, gross, fees, ... }` | **GM client.** One per fill. |
| `dividendPaid` | `{ companyId, perShare, key, portfolios, payouts }` | **GM client.** A dividend or fund distribution was paid. |
| `corporateAction` | `{ type, companyId, ... }` | **GM client.** `type` is `split`, `buyout`, `delist`, `bankrupt` or `ipo`. |
| `newsPosted` | the news item | A headline was posted. |
| `gigImpact` | `{ status, record }` | A gig outcome was handled (applied, pending, unmatched, ignored, discarded). |
| `gigsChanged` | none | The gig queue or history changed. |
| `heatAudit` | `{ window, results }` | **GM client.** A heat audit finished. |
| `heatPenalty` | `{ penalty }` | **GM client.** A penalty was proposed, approved or dismissed. |
| `heatChanged` | none | Heat changed. |

Night City Messenger's `night-city-messenger.message:sent` hook is how a broker notices mail from a player.

## Data you can read directly

- Company: a journal flagged `flags.night-city-investments.company` (config) with the lore as its text page.
- Portfolio: `actor.flags.night-city-investments.portfolio`. **Written only by the GM executor.** Do not write it yourself.
- Outbox: `actor.flags.night-city-investments.outbox`. Written only by the owning player through `api.portfolio`.
- Settings: world settings under `night-city-investments`.
- The journal named "NCI GM Control" holds hidden state (fair values, the regime, heat, gig queue). It is GM-only. Do not expose it.

## Stability

The calls above are the supported surface. `apiVersion` follows the module version, so check it if you depend on a call added recently. Internal files under `scripts/` can change without notice.
