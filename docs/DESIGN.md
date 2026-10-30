# Night City Investments — Design & Module Structure

Status: proposal v0.2. Nothing is built yet. Decisions are recorded in §15.

## 1. Goals

A stock-market and investment layer for Cyberpunk RED in Foundry VTT. It has three parts:

- A player GUI opened from a scene-control button, like Night City Messenger (NCM).
- A believable, GM-steerable price model.
- Hooks into Night City Map (gig outcomes) and NCM (brokers and notifications).

### What we learned from the sample macro (`nc_stock_market.txt`)

Keep the good ideas and replace the weak ones.

| Macro behaviour | Problem | Replacement |
|---|---|---|
| One shared world-setting blob with prices and 30 history points | Unbounded growth, no schema, no versioning | Separate stores by concern, with schema versions and migrations (§4) |
| Shares are one embedded `Item` per share, cost basis parsed out of the description text | Inventory clutter, fragile | Lot ledger on the actor (§4.3) |
| Needs a selected token; the player's client mutates wealth directly | No authority, no audit trail | GM-authoritative executor with an outbox (§3) |
| Uniform ±5% random walk plus a ratio-to-base hack and a flat 5 eb bid/ask | Unrealistic and not tunable | Factor model, regimes, volatility clustering, fair-value reversion (§5) |
| Dividends are a player button paying 2% of price whenever clicked | Exploitable, ignores time | Scheduled, idempotent, per-company policy (§7) |
| Events are random BULL/BEAR flavour text | Not tied to the story | Impact queue with delay and decay, fed by GM and by gigs (§5.4, §10) |
| Tick runs only when someone clicks "advance" | No relation to game time | Tick tied to the in-world clock, with a manual option (§5.1) |

Features to keep: a bid/ask display, an over/undervalued label, SVG sparklines, a P&L report on sale, chat-card flavour, and a `wealth.transactions` ledger entry for every trade.

## 2. Ecosystem fit and dependencies

Established conventions in the sibling modules:

- Foundry **v12**, ES modules, `ApplicationV2` + Handlebars (NCM `BaseApplication`).
- Phased initializer (`preInit/init/ready/postReady`) with `init/register*.js` files.
- A scene-control group registered via `getSceneControlButtons`.
- A public API at `game.modules.get(id).api` and mirrored hooks (`night-city-messenger.apiReady`).
- Separate **bridge modules** for cross-module glue (`night-city-map-night-city-messenger-bridge`, `night-city-map-forien-quest-log-bridge`).

| Dependency | Type | Why |
|---|---|---|
| `cyberpunk-red-core` | system, required | `system.wealth.value` and `system.wealth.transactions` |
| `night-city-messenger` | module, **required** | Brokers, notifications, in-world time. Players without a broker use chat cards (§9.3) |
| `night-city-map` | optional, via a **separate bridge module** | Gig outcomes. NCMap has no hooks, so the glue is fragile and lives outside core |

Proposed packages:

- `night-city-investments` — core (this folder).
- `night-city-map-night-city-investments-bridge` — gig outcome → market impact (§10).

## 3. Architecture principles

1. **Pure engine, thin Foundry adapter.** `scripts/engine/` has no Foundry globals. It covers the price model, orders, dividends, fund NAV, and a seeded PRNG. It is unit-testable in Node and tunable with a CLI Monte-Carlo tool (`tools/simulate.mjs`).
2. **GM-authoritative.** Only the active GM client (`game.users.activeGM`) mutates market state, wealth, or holdings. Players never write the market.
3. **Outbox + socket.** A player action is written to the player's own actor flag `pendingRequests` (durable, even if no GM is online) and a socket ping wakes the GM executor. The executor also sweeps on `ready` and on `updateActor`. All requests carry an idempotency key.
4. **Serial op queue.** One promise chain on the GM client, the same pattern as the bridges' `enqueueDelivery`, so ticks, fills, and dividends never interleave.
5. **Deterministic ticks.** A tick's random numbers come from a seeded PRNG, `hash(worldSeed, tickIndex, companyId)`. Catching up after a time skip is reproducible and not double-applied.
6. **Hidden state stays hidden.** World settings are sent to every client, so GM-only parameters such as secret bias, scheduled events, and true fair value are stored in a **GM-only JournalEntry** (ownership NONE for players), which Foundry does not send to players.
7. **Every cash movement is a ledger line.** It is written to our trade log and, for deposits and withdrawals, to CPR `system.wealth.transactions`.

## 4. Data model

### 4.1 Company = JournalEntry (GM created)

Companies live in a dedicated Journal folder. The GM-authored page text is the public lore, and journal ownership controls who sees it.

Two implementation options:

- **Flags plus a "Company Editor" dialog.** The Company Editor also creates and deletes companies.
- A custom JournalEntryPage sub-type was considered and dropped (§15).

Public config, in the flag `night-city-investments.company`:

```jsonc
{
  "id": "co_ara", "ticker": "ARA", "name": "Arasaka Corporation",
  "sector": "security", "hq": "Corporate Center", "ceo": "…",
  "aliases": ["Arasaka", "Arasaka Corp"],   // matching gig.client strings, NCM organization
  "listed": true, "ipo": { "date": null, "price": null },
  "initialPrice": 240, "sharesOutstanding": 5000000,
  "volatility": 3,          // 1-5 rating -> daily sigma
  "beta": 1.1, "liquidity": 3,
  "dividend": { "policy": "fixed|yield|none", "perShare": 2, "yield": 0.02,
                "frequency": "monthly|quarterly|annual", "payoutDay": 1 },
  "split": { "auto": true, "above": 500, "ratio": 2 },
  "status": "active|halted|delisted|bankrupt|acquired"
}
```

GM-only state, in the hidden journal `NCI GM Control`:

- Hidden bias per company, sector, or the whole market.
- Fair value and fundamentals growth.
- Scheduled and secret events.
- The impact queue (§5.4).
- The pending-approval queue for gig impacts.
- The world seed.

### 4.2 Market state (public world settings, split by concern)

| Setting | Contents | Write rate |
|---|---|---|
| `marketState` | clock (`lastTickIndex`, `lastTickWorldTime`), regime label (the displayed name only), per-company `{price, prevClose, dayHigh, dayLow, status}`, index values | once per tick |
| `marketHistory` | per company: daily closes as integer cents in a ring buffer (about 365 days) plus a weekly downsample | once per tick |
| `newsFeed` | last ~200 items `{id, ts, scope, companyIds, headline, body, tone, public}` | on news |
| `fundDefs` | GM-defined funds (§8) | rare |
| `brokerDefs` | broker config keyed by NCM contact id (§9.2) | rare |
| `settings` | tick mode, delays, fees, deposit fee, notification defaults | rare |

Splitting keeps world-setting write payloads small. At about 40 companies × 365 daily closes, history is roughly 100 KB.

### 4.3 Portfolio = actor flags (`flags.night-city-investments.portfolio`)

```jsonc
{
  "schema": 1,
  "brokerContactId": "…",                // NCM master contact id
  "cash": 0,                             // brokerage balance (eb); see §4.4
  "lots": [ { "id":"l1", "assetType":"stock|fund", "assetId":"co_ara",
              "qty": 10, "unitCost": 238, "acquiredTick": 412, "drip": false } ],
  "orders": [ /* §6 */ ],
  "ledger": [ { "ts":0, "kind":"buy|sell|dividend|fee|tax|fund-dist|deposit|withdraw|withdraw-refund",
                "assetId":"…", "qty":0, "amount":0, "ref":"orderId" } ],   // capped, oldest summarised
  "watchlist": ["co_ara"], "alerts": [ { "assetId":"…", "dir":"above", "price":300, "once":true } ],
  "prefs": { /* notification prefs, §9.4 */ },
  "pendingRequests": [ { "key": "uuid", "type": "placeOrder|cancelOrder|…", "payload": {} } ]
}
```

- It uses **lots, not Items.** Per-lot cost basis gives FIFO/average-cost P&L without parsing text.
- Optional: one cosmetic "Brokerage Statement" Item (a datashard) per actor, as the in-fiction proof of the account.
- Trust model: owners can technically edit their own flags from the console. The GM executor validates every request against the ledger. This is acceptable for a tabletop game.
- Money model: see §4.4. Trades, dividends and fees move the **brokerage balance** (`portfolio.cash`). CPR `system.wealth.value` is touched only by deposits and withdrawals.
- A `WealthAdapter` wraps all CPR wealth access so a system change touches one file.

### 4.4 Brokerage balance, deposits, and withdrawals

Each portfolio has a brokerage balance, `portfolio.cash` (whole eb). Buys, sells, dividends, fund distributions, fees, and taxes all move this balance. CPR `system.wealth.value` changes only through deposits and withdrawals.

**Deposit** (Portfolio tab → Deposit):

- The player enters an amount. The GM executor checks that `system.wealth.value` covers it, debits wealth (with a `wealth.transactions` entry such as `["Deposit to brokerage", "Night City Investments"]`), and credits `portfolio.cash`.
- It is immediate and needs no broker. The player sees the new balance on the next render.
- Optional GM setting: a flat deposit fee, default none.

**Withdrawal** (Portfolio tab → Withdraw):

- **With an assigned broker:**
  1. The request becomes a `withdraw` order. The GM executor validates the balance and immediately moves `amount + fee` out of `portfolio.cash` into a hold, so the same eb cannot be withdrawn or traded twice.
  2. After the broker's latency (the same `latency` range as trades), the broker sends an NCM mail from its contact with the amount attached as claimable eddies (`sendMessage({..., eddies: amount})`, the same mechanism the NCMap bridge uses for gig payments).
  3. The player claims it in NCM. NCM's claim flow credits `system.wealth.value` and writes the wealth transaction itself, so we never touch wealth on this path.
  4. The ledger records `withdraw` at send time. If delivery fails, the hold is released with a `withdraw-refund` line.
- **Without a broker:** the withdrawal is direct and immediate. The GM executor moves the amount from `portfolio.cash` to `system.wealth.value` with a wealth transaction entry, and no mail is sent.
- The broker's fee for withdrawals is `flatFee + bps`, from the same broker profile as trades (§9.2). A broker may set `minWithdrawal`.
- Free-text mail to the broker also accepts `WITHDRAW 5000`. Deposits are UI-only.
- Rules: no negative balance, a pending-withdrawal list shown on the Portfolio tab, and cancellation allowed until the mail is sent (the hold is released).
- Sell proceeds are available for withdrawal immediately unless the optional T+N settlement delay (§6) is enabled.

## 5. Price model ("realistic-ish")

### 5.1 Clock and tick

`tickMode` is one of:

- `realTime` (default, "in-world clock") — one tick for every `realTimeMinutes` (default 10) of in-world clock time, read from the NCM `TimeService` (`api.time`, which follows Simple Calendar when installed; a standard 24 hour, 60 minute, 60 second day), falling back to `game.time.worldTime`. The pure rule is `realTimeDue` (`engine/clock.js`). The public state holds `lastDay` (the market's date) and `lastMs` (when the last tick happened on that clock). **A jump forward catches up** (`realTimeDue`): every whole day in the elapsed in-world time runs as a day-sized tick (`dt = 1`) and the rest as ordinary interval ticks, so a week skipped in Simple Calendar is a week of game time, prices move over it, and impacts, headlines and heat windows that fell due in it happen. Each part is capped at 60 steps (the timer then restarts). The part-interval left over is kept so the rhythm stays steady. **Going back, in date or within a day, only gives the market the new date and restarts its timer, with no tick and no undo.** A normal midnight crossing is just intervals. The GM presses "Advance 1 / 7 / 30 ticks" for extra ticks in any mode.
- `worldTime` — one tick per in-world day. After a time skip, run N catch-up ticks, capped (for example 60). **The market stays aligned with the calendar.** `lastDay` is the day the market has been simulated to. If the date is rolled back, the market undoes one tick per day given back (`TickService._rollBack`, using the undo snapshots), as far as it can: it stops at the oldest remembered snapshot (5 ticks) or at a tick that has already moved a player's money. Whatever cannot be undone leaves the market that many days ahead of the calendar, and it does not tick again until the calendar has caught up with it and passed it. The GM is told once, by a notification, whenever that changes. Forward moves then re-run the undone days with the same seed.
- `manual` — the GM presses "Advance N ticks" (like the macro).

A world that has never changed the setting moves to `realTime` when this version is installed (it is the registered default); one that chose a mode keeps it.

Optional intraday sub-ticks for display only.

### 5.2 Return model (per company *i*, per tick *t*)

```
r_i,t = μ_i                              // slow drift (company growth)
      + β_i · M_t                        // market factor (CAPM-style correlation)
      + γ_i · S_sector,t                 // sector factor
      + σ_i,t · z_i,t                    // idiosyncratic noise, fat-tailed
      + J_i,t                            // rare jump (earnings, scandal, corp-war)
      + Σ impact increments (§5.4)       // scheduled/gig/GM events
      + bias_i,t                         // GM steering (§11)
      + κ · ln(F_i,t / P_i,t-1)          // weak pull toward fair value F

P_i,t = P_i,t-1 · exp(r_i,t)             // floored at a min price; penny-delist rule
```

- `z ~ standardised Student-t (df≈5)`, for fat tails.
- **Market regime `M_t`:** a sticky Markov chain over `bull / sideways / bear / crash / recovery`. Each regime has its own drift and a volatility multiplier. Mean duration is 20–60 ticks. Crash is short and violent, and is usually followed by recovery. Players see a soft label ("Risk-on", "Jittery", …), not the hidden regime.
- **Volatility clustering (GARCH(1,1)-lite):** `σ²_t = σ̄²(1−a−b) + a·ε²_{t−1} + b·σ²_{t−1}`, with `a≈0.08`, `b≈0.88`.
- **Fair value `F`:** drifts slowly. Events with a permanent component shift it. `κ≈0.01–0.03` per tick gives a 25–70 tick half-life. This replaces the macro's ratio hack, and "Under/Overvalued" can be derived as `P/F` (shown with noise so players don't read the true value).
- **Volatility rating → daily σ** (tunable, in `settings`):

| Rating | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| daily σ | 0.8% | 1.5% | 2.5% | 4% | 6% |

- **Quotes:** `bid = P(1 − s/2)`, `ask = P(1 + s/2)`, with `s = baseSpread / liquidity`. This replaces the flat ±5 eb.
- **Optional market impact:** `ΔP ∝ sign · λ · sqrt(qty / ADV_ref)`, so a rich PC buying heavily moves a thin stock.
- **Circuit breaker:** halt trading for the rest of the tick if the move exceeds X%.

### 5.3 Corporate actions

- Dividends (§7).
- Splits (automatic when the price passes a threshold; all lots are adjusted).
- IPO (a company listed at a future date, with an offering window).
- Buyout (a cash-out price).
- Bankruptcy (price → 0, holdings wiped).
- Delisting.

All are GM-triggerable and story-hookable.

### 5.4 Event impact kernel (delay and decay)

Each queued impact is `{ target, A, tOnset, τ_up, τ_dn, p, source, status }`. The cumulative response is:

```
H(t) = A · (1 − e^{−(t−tOnset)/τ_up}) · ( p + (1−p)·e^{−(t−tOnset)/τ_dn} )
increment at tick t = H(t) − H(t−1)
```

- `tOnset = eventTime + delay`, and the delay is jittered.
- `p` is the permanent fraction; it also bumps `F`.
- The queue is the single entry point for GM nudges, scripted events, and gig outcomes.
- It is idempotent: each impact has a `sourceKey` such as `gig:<id>:done`.

### 5.5 Calibration

`tools/simulate.mjs` runs N seeds × T ticks and reports annualised volatility, max drawdown, correlation matrix, and regime time-in-state. Tuning targets: "movement is visible within one session" while "no random −90% in a week".

## 6. Orders, trading, and execution

Order: `{ id, assetType, assetId, side, qty, type: market|limit|stop, limit?, expiry: day|gtc|date, via: ui|broker, brokerContactId, status, submittedAt, executeAt, filledAt, fillPrice, fees, reject? }`

`status`: `submitted → pending (until executeAt) → working (limit/stop) → filled | cancelled | rejected | expired`.

- **Price is set at execution time, not submission time.** The latency is the cost of a slow broker.
- **Direct UI orders** execute at the next tick, or immediately if the player's broker tier is "instant" (a pricey corp desk).
- **Validation (GM executor):** brokerage balance covers the cost plus fees, enough shares, company status and halt, minimum order, daily limit, broker allows the asset class.
- **Fees:** `flat + bps`, set by broker tier. Optional capital-gains tax, applied on sell from the lot P&L. Fees are charged to the brokerage balance.
- **Settlement:** an optional T+N delay before sale proceeds become available in the balance (a good roleplay hook).
- **Stretch (not v1):** short selling, margin and margin calls, options.

## 7. Dividends

- Policy per company: `fixed` per share, `yield` on price at the ex-date, or `none`. Frequency is monthly, quarterly, or annual on the in-world calendar.
- Flow: declare (visible in news) → ex-date snapshot of holders (lots at that tick) → pay-date credit via the GM executor.
- Idempotency key `companyId:periodIndex`. It is stored per actor as `lastPaidPeriod`, so a repeat click or reload cannot double-pay.
- DRIP toggle per lot or fund: the dividend is reinvested as shares at the tick price, with no fee.
- Dividend cut or hike is a valid impact event.
- GM "Declare special dividend" and "Pay now" buttons replace the macro's player button.
- Each payout is credited to the brokerage balance (or reinvested by DRIP), plus an NCM statement (opt-in, §9.4).

## 8. Pool investments (funds)

Definition (GM, `fundDefs`):

```jsonc
{ "id":"fd_nc50", "name":"Night City 50 Index", "kind":"index|sector|managed|themed",
  "components":[{"companyId":"co_ara","weight":0.12}],
  "rebalance":"quarterly", "expenseRatio":0.008, "minBuy":500,
  "redeemDelayTicks":2, "exitFee":0.005,
  "distribution":"accumulating|distributing", "managerAlpha":0.0002 }
```

- **NAV is derived, not simulated:** `NAV = Σ wᵢ·Pᵢ / divisor`, minus daily expense-ratio accrual, plus the optional manager alpha. Component dividends are either rolled into NAV or distributed.
- Funds buy and sell as units, using the same order lifecycle, with the redemption delay.
- Index composites (`NCX-50`, sector indices) come free from the same component logic and drive the market ticker and the "vs. index" chart overlay.
- **Later phase, player syndicates:** a crew pool owned by several actors. Units track each member's share, and trades need one member's approval or a majority vote. This also covers a "corp slush fund" story hook.

## 9. Messenger integration

> **Superseded in part by §16 (Phase 4 as built).** Broker tiers are replaced by skill-derived terms, and funds are broker-only.
### 9.1 What we consume from NCM (checked against the NCM source)

| Need | API |
|---|---|
| Send mail | `game.nightcity.messageService.sendMessage({toActorId, fromContactId?, subject, body, priority})` |
| Find brokers | `game.nightcity.masterContactService.filterByTag('broker')`, `getContact`, `getByActorId` (the pattern the NCMap bridge uses for `FIXER_TAG`) |
| Inbound player→broker messages | Hook `night-city-messenger.message:sent` (fires GM-side on delivery) |
| In-world time | `game.modules.get('night-city-messenger').api.time` |
| Groups and personalities | `contactGroupService`; the bridge's `resolvePersonality` pattern gives broker voice |

**Verify before building:**

- The documented `message:sent` payload has ids and a subject but no body, so fetch the body via the message repository by `messageId`.
- Confirm that a *player → NPC master contact* message is deliverable when the contact has no recipient actor. Fallback: a structured Order Composer in our own UI that sends the mail on the player's behalf.

### 9.2 Brokers

- GM tags NCM contacts `broker` and adds a **Broker profile** in our GM console (`brokerDefs`, keyed by contact id):
  `{ tier, commissionBps, flatFee, latency: {minTicks, maxTicks}, minAccount, minWithdrawal, assetClasses, personality, tipsSkill }`.
- Tiers, as examples: *Net-kiosk discount* (cheap, slow, 2–3 days), *Street fixer broker* (mid), *Corp desk* (expensive, instant).
- Each player picks, or the GM assigns, a broker at portfolio creation (`portfolio.brokerContactId`).
- **Player → broker flows:**
  1. **Free-text mail** to the broker contact, for example `BUY 10 ARA`, `SELL 5 SAM @ 80`, `WITHDRAW 5000`, `STATUS`, `CANCEL <ref>`. A lenient grammar parser creates an order. The broker replies "got it, executing within ~2 days" in its own voice.
  2. **Structured composer** from the portfolio UI (same result, no parsing risk).
- **Completion:** after the broker latency, the order fills at the then-current price. The broker mails a confirmation (fill price, fees, P&L). Failures reply with the reason (insufficient funds, halted).
- **Withdrawals** are completed by the broker mailing the funds as claimable eddies (§4.4).
- **Parse failures** get an in-voice "didn't catch that" with a syntax hint.
- **Optional manual-broker mode:** orders land in the GM's queue to approve or edit, so the GM can roleplay the broker.
- **Dedupe:** use `message:sent` only, because `message:received` can fire twice. Key by `messageId`.
- **Broker extras:** market tips and rumours (true or false depending on broker quality), and trust (a `contacts:trustChanged` hook can raise or lower tip quality).

### 9.3 Graceful degradation

Players without an assigned broker use the direct UI (next-tick execution) and chat cards for notifications, as the macro did. NCM itself is a hard dependency.

### 9.4 Notifications (opt-in/out)

- A "Night City Market Wire" NCM contact or network is the sender for market mail.
- Categories × channel per actor (`portfolio.prefs`), editable by the player:
  - Categories: order fills, dividends, holdings movers (threshold %), price alerts, daily digest, GM headlines, market-wide events.
  - Channels: NCM mail, chat card, toast, off.
- **Transactional mail** (fills, dividends) defaults on; **marketing-style** mail (digests, headlines) defaults off or on per GM setting.
- **Rate limiting:** digest bundling and a per-in-world-day cap per actor, so inboxes are not spammed.
- Delivery runs GM-side.
- **Click-through:** mail contains `data-nci-company="ARA"` spans. A document-level handler opens the company card, the same trick the NCMap bridge uses with `data-ncm-map-location`.

## 10. Night City Map integration (separate bridge module)

*As built: see §20. The core API differs a little from the sketch below (`reportImpact` takes the gig's own fields and does the client matching itself).*

**Facts about NCMap** (checked in its source):

- No hooks. State is `game.settings.get('night-city-map','state').quests[]`, with `status ∈ {hidden, offer, active, done, failed}`.
- A gig has the free-text fields `client`, `fixer`, `reward`, `title`, `giver`, `target`.
- The public API is `game.modules.get('night-city-map').api = { open, close, ui, agent, call }`.
- The sibling bridges detect transitions by wrapping `api.ui.onClick` and by diffing the quests array. The new bridge does the same (poll fallback, like the Quest Log bridge's 1 s interval).

**Bridge responsibilities:**

1. On a transition to `done` or `failed`, resolve `gig.client` to a company:
   - exact or alias match against the company `aliases`, then
   - fuzzy match, then
   - a GM mapping table `clientString → companyId`.

   Unmatched clients land in a "Needs mapping" list. Nothing is applied until mapped (or ignored).
2. Call the core API: `api.events.reportImpact({ companyId, sourceKey, kind: 'gig', outcome: 'done'|'failed', reward, delayTicks? })`.
3. The core computes the impact:
   - `A = sign · clamp(k · log10(1 + reward/refReward), ±cap)`. Failure is weighted heavier than success (about 1.3×), and there is a per-company weekly saturation cap.
   - Delay is 1–3 ticks plus jitter. Shape comes from the §5.4 kernel with a moderate permanent fraction.
   - Optional **GM approval** (default on): the impact appears in the "Pending impacts" tab, where the GM can edit the magnitude, delay, or headline, or discard it.
4. **News:** a generic templated headline ("Arasaka shares edge up amid reports of a smooth logistics run…") with no gig spoilers, so the GM can edit before publishing.

**Roleplay hook (optional, GM toggle):** a *tip* mail from the broker to the player before the effect lands ("hearing murmurs about X"), and an insider-trading "heat" mechanic: trading the client company right after a gig carries a risk of an NCPD financial-crimes event.

## 11. GM controls

GM Console (`GMConsoleApp`), with controls that act on **model parameters, not raw prices**, so the market stays plausible:

- **Global sentiment** slider (−3…+3 σ-units of drift) with a duration in ticks and a decay curve.
- **Per-company and per-sector bias** (the same slider and duration).
- **Force regime:** bull, bear, crash, recovery, sideways.
- **Volatility multiplier**, global or per company.
- **One-off shock** (±%) applied immediately or scheduled, via the impact queue.
- **Scripted glide:** steer a company toward a target price over N ticks, with noise on top ("storyline path").
- **Freeze / halt / unhalt** a company or the whole market.
- **Set price** (an escape hatch, logged), and **undo last tick** (a snapshot ring buffer).
- **Monte-Carlo preview:** shows the cone of likely outcomes for a planned bias or event before applying it.
- **Impact queue** and **gig-approval queue**.
- **Broker order queue** (manual-broker mode, including withdrawals) and **order inspector**, with a GM adjust-balance tool (logged).
- **Time controls:** advance N ticks, tick mode, re-seed, and a full reset (with a confirmation).

## 12. Additional core functions

- **Watchlists and price alerts.**
- **Charts:** SVG line and sparkline (as in the macro), 7/30/90/365-day ranges, an overlay against the index, and an optional candle view once there is intraday data.
- **Company detail card:** lore, sector, market cap, 52-week range, beta/volatility, dividend yield, news, a "held by you" panel.
- **Portfolio:** brokerage balance with deposit and withdraw controls (§4.4), positions, average cost, realised and unrealised P&L, allocation, income history, and monthly statement export (NCM mail or a journal page).
- **Taxes and fees:** optional, GM-configurable.
- **Market ticker widget:** an optional compact HUD strip (the `NCX-50` index and top movers).
- **Importer:**
  - Suggest companies from NCM master-contact `organization` values and from NCMap gig `client` strings. Built in phase 7 (§23).
  - Migrating the old macro (`world.nightCityMarket`, `Acciones X` items) is **dropped**: it will not be needed.
- **Starter content (compendium):** an editable starter set of real Cyberpunk RED corporations (for example Arasaka, Militech, Biotechnica, Trauma Team, Petrochem, Kang Tao). The GM can edit or delete any of them and can create new companies from the Company Editor. The macro's Spanish real-world companies are not carried over.
- **Macros:** world macros created from the GM Console's Tools tab (open the terminal, open the console, advance a tick, run the self-check). A compendium pack was not used: Foundry packs are binary databases, and plain world macros are easy to edit and leave in place.
- **Public API and hooks** (`apiVersion`): documented in [API.md](API.md). The hooks are `night-city-investments.priceTick`, `.orderFilled`, `.dividendPaid`, `.companiesChanged` and `.apiReady`, plus `.ready` once the whole API is attached.
- **Migrations:** a single `schemaVersion` world setting and an ordered list of pure steps (`engine/migrations.js`), run by the active GM on load (§23).
- **i18n:** English only (`lang/en.json`). Strings still go through `game.i18n`.
- **Audit and diagnostics:** a GM trade log and a `game.nightcity.investments.verify()` self-check, both in the Tools tab (§23).

## 13. Proposed file tree

```
night-city-investments/
├─ module.json                      # system dep, NCM relationship, socket:true, esmodules, packs
├─ README.md  LICENSE
├─ docs/  DESIGN.md  GETTING-STARTED.md  PRICE-MODEL.md  API.md
├─ lang/en.json
├─ styles/night-city-investments.css
├─ templates/
│  ├─ terminal/    (market, company, portfolio, orders, funds, news, settings)
│  ├─ gm/          (overview, companies, controls, impacts, brokers, funds, tools)
│  ├─ dialogs/     (trade, company-editor, fund-editor, broker-editor)
│  └─ cards/       (chat + mail HTML partials)
├─ packs/          (nci-companies  JournalEntry starter set,  nci-macros-player/gm  Macro)
├─ tools/simulate.mjs               # Monte-Carlo calibration harness (Node, no Foundry)
├─ tests/                           # engine unit tests (Node)
└─ scripts/
   ├─ main.js                       # entry; registers init tasks (NCM-style initializer)
   ├─ core/        ModuleInitializer, SettingsManager, SocketManager, EventBus,
   │               GMExecutor (active-GM check, op queue, outbox sweep), MigrationRunner
   ├─ engine/      (PURE, no Foundry globals)
   │   ├─ rng.js (seeded PRNG)          ├─ marketModel.js (factors, regimes, GARCH)
   │   ├─ impactKernel.js               ├─ quotes.js (spread, slippage)
   │   ├─ orderEngine.js (fill rules)   ├─ dividends.js, corporateActions.js
   │   ├─ fundNav.js                    └─ orderParser.js (broker text grammar)
   ├─ data/        CompanyRepository (journals), MarketStateStore, HistoryStore,
   │               PortfolioRepository (actor flags), NewsStore, FundStore, BrokerStore
   ├─ services/    MarketClockService, TickService, TradingService, CashService (deposit/withdraw),
   │               DividendService,
   │               FundService, ImpactService, NewsService, BrokerService,
   │               NotificationService, WealthAdapter, AlertService, ImportService
   ├─ integrations/ NCMAdapter (send mail, tags, hooks, time), ChatCards,
   │               IntegrationBridge (module API + mirrored hooks), MacroAPI,
   │               MessengerLinks (data-nci-company click handler)
   ├─ ui/
   │   ├─ BaseApplication.js        # ApplicationV2 + Handlebars base, theme-aware
   │   ├─ MarketTerminal/           # player app: tabs + company drawer
   │   ├─ TradeDialog/
   │   ├─ GMConsole/                # AdminPanel-style tab app
   │   ├─ CompanyEditor/  FundEditor/  BrokerEditor/
   │   └─ components/               # chart (SVG), sparkline, ticker strip
   ├─ init/        registerCoreServices, registerUIComponents (scene control group),
   │               registerMarketSystem, registerTradingSystem, registerBrokerSystem,
   │               registerIntegrations, registerGMTools, registerReadyServices
   └─ utils/       constants.js, helpers.js, format.js
```

Bridge repo `night-city-map-night-city-investments-bridge`: `module.json`, `lang/en.json`, `scripts/bridge.js` (transition detection, client→company resolver, mapping UI, `reportImpact` caller).

**Entry points:** "Market Terminal" (all users) and "Market GM Console" (GM only) buttons in the Token Controls scene-control group, where other modules already add theirs, plus `game.nightcity.investments.open()` for macros. A separate group on the `controls` layer was tried and dropped: Foundry v12 selects the first group on a layer, so it blocked Night City Messenger's group. A keybinding is now registered for each window (§23), unbound by default.

## 14. Roadmap

| Phase | Deliverable |
|---|---|
| 0 | Scaffolding, pure engine, seeded PRNG, `tools/simulate.mjs` calibrated, unit tests. **Done (v0.0.1):** engine, simulator and 41 tests exist; in-game windows are placeholders, and the model needs further tuning against real play |
| 1 | Companies as journals, tick service, market and company UI (read-only), GM tick controls. **Done (v0.1.0):** all of these exist and are tested against a fake Foundry runtime; the windows have not yet been tried in a live Foundry world |
| 2 | Portfolio, lots, brokerage balance with deposits and direct withdrawals, direct orders, GM executor and outbox, CPR wealth ledger, P&L. **Done (v0.2.0):** all of these exist and are tested against a fake Foundry runtime; the windows have not yet been tried in a live Foundry world. Broker-routed withdrawals come with Phase 4 |
| 3 | Dividends and corporate actions, GM bias/shock/regime controls, impact queue. **Done (v0.3.0, completed in v0.4.1):** dividends (scheduled, special, reinvestment), splits (manual and automatic), buyouts, delistings, bankruptcies, IPOs with a subscription window, sentiment biases, forced regimes, volatility, market halt, the scheduled-impact queue, scripted glides, the Monte-Carlo preview, undo last tick, set price, a GM action log and a public news feed. See §17. Dividends use a simple rule in place of an ex-date snapshot: only shares held before the declaration tick qualify, which is the same thing as an ex-date on the declaration tick |
| 4 | **Done (v0.4.0), see §16.** Skill-based brokers, direct terminal trading with an Accounting check, broker-only funds, mail orders and replies, delayed fills, broker-processed withdrawals paid as claimable eddies, opt-in notifications |
| 5 | **Done (v0.5.0, extras in v0.5.1), see §18 and §19.** Price alerts, brokerage statements (on request and monthly), fund rebalancing and manager alpha, then settlement and redemption delays, distributing funds, a movers notification and a ticker strip. Capital-gains tax was left out on purpose. (Funds and watchlists shipped earlier, in Phase 4 and Phase 2) |
| 6 | **Done (v0.6.0), see §20.** Night City Map bridge (gig outcome → impact), approval queue, client mapping, Gigs tab. The bridge is a separate module, `night-city-map-night-city-investments-bridge` |
| 7 | **Done (v0.9.0), see §23.** Starter pack (already in since phase 1), API docs, self-check, trade log, company suggestions, starter macros, keybindings, data migrations. The macro importer was dropped: it will not be needed |
| 6b | Insider-trading heat, in stages (§22). **H1 done (v0.7.0, retuned in v0.7.1):** hidden heat recorded from audited gig windows, GM Heat tab. **H2 and H3 done (v0.8.0):** warnings, NCPD enquiries, fines, freezes and dropped brokers with GM approval, and skill-roll cover-up actions. H4 (gig runner from the bridge) done (v0.9.7) |
| 0.9.7 | **Done (v0.9.7).** Released the work that had been unreleased: the after-tick sequence and dividend-records fix (§27), the market date, price paths and cleanups (§28), and gig runners for heat (H4) |
| B0 | **Done, see §26.9 (B0 findings).** Groundwork for player businesses and syndicates: the business growth simulator (`tools/business-model.mjs`), the storage schema, and the Crew Tools spike (from its source; a run in the test world is still to do) |
| B1 | **Done (v0.10.0), see §29.** Side businesses: the roll levers, the Business window and the GM's Businesses tab, partnerships, four archetypes, the weekly loop |
| B2 | **Done (v0.11.0), see §30.** Growing: events, loans, registration, investors, expansion projects, private holdings in the portfolio, locations, role abilities, gigs for own business |
| B3 | **Built (v0.12), see §31; not yet released.** Player syndicates, and syndicates owning or investing in businesses |
| B4 | **Built (v0.13), see §32; not yet released.** Chartered companies: the charter, the company loop, monthly reports, officers and control |
| E | **E1 and E2 built (v0.13), see §33.9 and §33.10; E3 proposed, see §33.** Employees: player characters, tagged NPCs and recruits working in posts for wages, overtime rolls, loyalty, staff events, training and share grants; before B5 |
| Projects | **Built (v0.13), see §34; not yet released.** Projects beside expansion: refit, security upgrade, storefront, staff room; the Projects tab reworked |
| B5 | **v0.14.** Going public: valuation, listing checklist, prospectus rolls, the IPO, earnings impacts and capped payouts |
| B6 | **v0.15.** Corporate play: takeovers, buybacks, insolvency, hidden ownership and investigations |
| B7 | Downtime bridge (separate module, after B2): company work through Crew Tools downtime, businesses on Night City Map |
| F1 | **Proposed, see §35.3.** Faction standing with corps and gangs, moved by gigs and business actions; smear campaigns through the impact pipeline; after B6 |
| U1 | **Proposed, see §35.1.** Fronts: back rooms, dirty cash and laundering, raids, gang relationships; after F1 and B6 |
| P1 | **Proposed, see §35.2.** Production: workshops, lines, stock, selling and fencing; after E3 |
| M | **Proposed, see §35.4.** Further Night City Messenger integration, alongside each step |
| Later | Short selling and margin, options |

## 15. Decisions

All earlier open questions are resolved.

1. **Foundry v12 only**, matching the sibling modules. The scene-control code uses the v12 array form, and v13 support is out of scope.
2. **NCM is a hard dependency** (`relationships.requires`). The chat-card fallback in §9.3 is for players without a broker, not for a missing NCM.
3. **Company storage is flags plus a Company Editor dialog.** The custom journal page sub-type is dropped.
4. **One tick per in-world day** from the NCM clock, with the `manual` and `realTime` overrides in §5.1.
5. **A brokerage balance holds trading cash.** Players deposit from and withdraw to CPR `system.wealth` in the portfolio interface (§4.4). Deposits are immediate. Withdrawals go through the assigned broker and arrive as claimable eddies by NCM mail. With no broker assigned, they are immediate.
6. **GM approval of gig impacts is on by default**, with a setting to make them automatic.
7. **Broker orders are auto-processed by default.** Manual GM approval stays as an optional setting.
8. **The starter pack uses real Cyberpunk RED corporations**, and the GM can create, edit, and delete companies at any time. The Company Editor and importer are core features, not extras.
9. **English only.** `lang/en.json` is the sole language file and there is no translation work in the roadmap. All user-facing strings still go through `game.i18n` so a language can be added later.
10. **A GM must be online to process fills.** Requests queue in the player outbox until a GM connects.

## 16. Phase 4 as built (v0.4.0)

These rules came from the user's Phase 4 brief and replace the earlier tier-based sketch in §6, §8 and §9.2.

**Three ways in, ranked by cost and speed**

| Route | Speed | Cost | Access |
|---|---|---|---|
| Direct terminal | Same tick | Highest: commission 200 bps + 5 eb flat (settings) | A CorpNet terminal, then a passed Accounting check |
| Broker | 1 to 5 market days by skill | A share of the direct cost, always lower | A broker chosen on the Portfolio tab |
| Fund, via broker only | Broker speed | Fund load and exit, reduced by skill | A broker; never direct |

**Broker skill.** A broker's Accounting total is INT + the Accounting skill level on their character sheet (the same data model Night City Messenger reads). A contact with no sheet uses a GM-set rating (default 8). Grades: rookie ≤ 6, competent ≤ 9, seasoned ≤ 12, expert ≤ 15, elite above. Terms come from `engine/brokerTerms.js` and `BROKER_TUNING` in `engine/config.js`.

- Latency in market days: ≤ 6: 3 to 5; 7 to 9: 2 to 4; 10 to 12: 2 to 3; 13 to 15: 1 to 2; 16+: 1. Direct is the same tick, so a broker is always slower. The exact delay per order is a seeded draw, so it is reproducible.
- **Cost direction (a decision to confirm):** skilled brokers are faster, better at funds and cost **more**, from 30% of the direct cost (low skill) up to 85% (high skill). They never reach 100%. To make skill make brokers cheaper instead, swap the two `costFactor` values in `BROKER_TUNING`.
- Withdrawals through a broker use the same fee and delay, and arrive as claimable eddies by mail.

**Direct trading** (`directTradingMode: terminal`, the default; `open` restores the 0.3 behaviour)

1. Access: the player's client is on the CorpNet network (and signed in, if the network needs it) in Night City Messenger, or the GM has granted the character terminal access. NCM keeps its network state in browser memory, so the player's client reads it and sends the claim with the request. The GM cannot verify it, which is a table-trust trade-off.
2. Check: the player rolls INT + Accounting + 1d10 (a 10 explodes, a 1 subtracts) against the DV (default 13) when they press Connect, on their own client, with a chat card and Dice So Nice. Numbers in a request are never trusted. From v0.9.5 the request carries only the card's id; see §26.0.
3. A pass opens a session for N market days (default 1). A fail locks the character out for M market days (default 1), doubled on a fumble.

**Funds** (`engine/funds.js`): NAV is derived from the components' prices with a divisor, earns their dividend yield and pays an expense ratio each tick. Splits multiply the weights so value is unchanged; editing a fund rebases the divisor so the NAV does not jump. Funds are market-only and broker-only. A broker's skill waives up to 90% of the entry or exit charge and shifts execution timing in the client's favour (a seeded draw per order, so a skilled broker usually beats NAV and a rookie often does not). Closing a fund pays every holder its current NAV.

**Mail.** A client mails their assigned broker: `BUY 10 ARA`, `SELL 5 MIL @ 80`, `SELL ALL ARA`, `WITHDRAW 5000`, `STATUS`, `CANCEL <ref>`, `HELP`. Only the assigned broker acts on a client's mail. Each message is handled once (by message id). Replies carry the broker's voice by grade. Players can also trade from the UI.

**Notifications** are opt-in per category (order results, dividends, headlines, daily digest) with mail, chat or off. Defaults: order results and dividends by mail, headlines and digest off. A broker-paid withdrawal is always mailed, because the mail carries the money. Market mail comes from a send-only "Night City Market Wire" contact.

**Safety.** A withdrawal is marked paid before its mail is sent. If the mail fails, the money returns to the balance and the player is told. Broker fee profiles are snapshotted onto each order, so a later skill or setting change cannot reprice an open order.

**Leaving CorpNet ends the session** (added after B3). Each player's client listens to NCM's network events (`network:changed`, `connected`, `disconnected`, `authSuccess`) through `NcmAdapter.onNetworkChange`, and `NetworkWatcher` checks once at startup too. When the client is no longer on CorpNet, or no longer signed in to it, it sends `disconnectTerminal` for every live session on the user's own characters that came from the network; the executor ends it and the player is told. A session the GM granted is not tied to the network and stays. A syndicate's session records the officer who opened it (`session.by`), and ends when that officer leaves.

**Not yet verified in a live world:** NCM's `message:sent` payload for a contact with no linked actor, that players can message an unshared broker contact, and the `Roll` and chat card for the Accounting check. The Node tests use a fake Foundry and a fake NCM.

## 17. Phase 3 completion (v0.4.1)

Four items from �5.3 and �11 had been left out of v0.3.0. They are now built.

**Scripted glide** (`engine/marketControls.js`, `marketModel.js`). The GM picks a company, a target price and a number of days. Each tick the company moves an even share of the remaining distance, keeps a chosen share of its usual noise (smooth 25%, natural 50%, wild 100%), and lands on the target exactly on the last day. Fair value moves with it, so the price does not snap back afterwards. A glide that would need more than about 20% a day is refused. One glide per company; starting a new one replaces the old. Glides ignore sentiment biases and queued shocks while they run.

**Undo last tick** (`TickService.undoLastTick`, `UndoService`). Before each tick the full engine state (including the hidden fair value and regime), fund states and controls are snapshotted into a five-entry ring buffer on the GM-only control journal. Undo restores prices, fund NAVs, hidden state and history, and brings back any bias, glide or forced regime that the undone tick used up; everything else the GM did since is kept. The clock is left alone, so a world-time market does not simply tick again at once. Advancing again re-simulates the tick, with the same random numbers unless the controls were changed, which makes undo a "what if" tool. It is refused when:
- a player's money has already moved because of that tick (a fill, a dividend, a drip or a paid broker withdrawal), because undoing would leave portfolios inconsistent with prices; or
- anything has changed the market's shape since (a split, a GM price change, a new or removed company or fund, a listing). Those clear the buffer.

**Monte-Carlo preview** (`engine/preview.js`, `PreviewService`). From the Market and Events tabs the GM can preview a sentiment bias, a shock or a glide before applying it. It runs 200 simulated futures with and without the change, using the same random numbers for both so the gap is the effect and not luck, and draws the middle 80% band and median for each, plus a one-line summary. The futures use their own seeds and never the world's, so the preview shows what is likely and cannot reveal what will happen. A sector or the whole market is shown as an index starting at 100.

**IPOs** (`engine/ipo.js`, `IpoService`). A company carries `ipo: { date, price, windowDays, allocation }`. Untick Listed and set a date and it lists on that in-world date (checked after every tick), or the GM can press "List now".
- Announced IPOs appear for everyone under "Upcoming IPOs". The offer price defaults to the initial price.
- In the window (the last `windowDays` days) a player can subscribe for shares. The money is reserved, not spent, so it counts against spendable balance and can be cancelled until listing. One subscription per company at a time.
- On listing the price is set to the offer price (fair value too), the chart starts fresh, and every subscription is filled at the offer price with no fees. If `allocation` is set and the offer is oversubscribed, each subscription is filled in proportion, rounded down (a subscription that rounds to nothing is released unfilled). Headlines announce the listing and any oversubscription.
- An unlisted company cannot be traded before it lists.

## 18. Phase 5 (v0.5.0)

**Price alerts** (`engine/alerts.js`). A player picks a stock or fund and a condition: rises above a price, falls below a price, or moves by N% (0.5 to 50) in one day. Alerts live on the portfolio, set through the normal request outbox (`setAlert`, `removeAlert`) so only the GM writes them, up to 20 each. They are checked after every tick, after orders are worked. An alert fires when it first becomes true. A "once" alert is then spent; a repeating one disarms until the condition clears, so it does not fire every tick. A price alert that is already true when set is refused rather than firing on the next tick. The last ten that fired are kept on the portfolio and shown in the terminal, whatever the notification channel; the alert itself is delivered by the "Price alerts" category (mail from the market wire by default, or chat, or off).

**Statements** (`engine/statements.js`, `StatementService`). A statement shows the opening and closing value, money paid in and out, trading, fees, dividends, performance, realised and unrealised profit, and every holding with its share of the portfolio. Performance strips out deposits and withdrawals (a refunded withdrawal counts as neither), so it is the return on the money, not the movement of the balance. Flows are summed from the account ledger, which keeps the latest 200 entries, so a very busy month can under-count.
- **On request:** "Send me a statement" on the Portfolio tab, or `STATEMENT` mailed to a broker. Always mailed, by the player's broker or the market wire. It does not move the monthly baseline.
- **Monthly:** on the first tick of each in-world month, to players who have turned on the "Monthly statement" category (off by default). The baseline moves forward for everyone whether or not it is sent, and a portfolio seen for the first time only records one, so opting in never produces a statement for the whole history.

**Fund rebalancing** (`engine/funds.js`). A fund has `rebalance: none | monthly | quarterly`. Holdings are fixed share counts, so winners slowly take over the fund; a rebalance re-weights them back to the value mix recorded when the fund was created or last edited (`targets`). The divisor is rebased in the same step, so the NAV does not move. A bankrupt holding drops out and the rest scale up. The first tick a fund is seen only records its period, so creating or importing a fund never rebalances at once. Like dividends, it follows the in-world calendar, so a market that is advanced by hand without moving the clock does not rebalance. Because a rebalance changes a fund's definition, which an undo snapshot does not hold, that tick cannot be undone.

**Manager alpha.** `managerAlpha` is a yearly excess return (-10% to +10%) added to the fund's daily accrual alongside dividends and the expense ratio. A positive value is a manager who beats the holdings, a negative one a drag. It is deterministic; there is no random "skill" draw. Starter funds: NC12, NC20 and INFR rebalance quarterly; CHRM is a managed fund (monthly, +1.5% a year).

**Not built:** the optional capital-gains tax, which was left out on purpose. The other optional extras shipped in v0.5.1 (§19).

## 19. Phase 5 optional extras (v0.5.1)

**Sale-settlement delay.** A world setting, `settlementDays` (0 to 5, default 0, so nothing changes unless the GM turns it on). A sale still fills as before, but its proceeds do not reach the cash balance at once. They are held on `portfolio.unsettled` as `{id, assetId, amount, releaseTick}` and credited by `releaseSettled` at the start of the first tick on or after `releaseTick`. Settling money counts towards total value (so performance and statements do not jump) but cannot be spent, traded with or withdrawn, and an undo is not affected by it. The filled-order mail, the Trade window, the Portfolio summary and statements all say when it will arrive.

**Fund redemption delay.** A fund has `redeemDelay` (0 to 10 days). A fund sale settles after the larger of the world delay and the fund's own. Starter fund CHRM has 2 days.

**Distributing funds.** A fund is `accumulating` (the default; income stays in the NAV) or `distributing`. A distributing fund leaves its yield out of the NAV and accumulates it as `owed` per unit. At the start of each period (`distributionFrequency`: monthly or quarterly, on the in-world calendar, like rebalancing) the amount owed is fixed as `lastDist {key, perUnit, tick}`, and `FundDistributionService` pays it to holders as cash through the same dividend path as company dividends. Each period is paid once (the portfolio's `paid` list makes it idempotent), only units held before the fixing tick qualify, and a headline and the usual dividend notice go out. Starter fund SAFE distributes quarterly.

**Holdings movers.** A new notification category, `movers` (off by default). Players choose a threshold (1% to 50%, default 5%) on the Portfolio tab. After a tick, a holding that moved by at least that much in a day is listed in one message by mail or chat.

**Market ticker.** A client setting, `showTicker` (off by default), adds a slim strip of prices to the page. It always shows the NC index. After it come the player's **watched companies** (the star on a company's market page), up to four, in the order they were added, each marked with a star and shown even when flat; a watched company that is not trading is skipped. With nothing watched it shows the day's biggest movers as before (the two best gainers and two worst losers). The strip follows the player's assigned character, or the first one they own; a GM sees the watchlist only if they have an assigned character, and otherwise the movers. It refreshes with the market and when the watchlist changes, and a click opens the Market Terminal. It is a per-user setting, so each player decides for themselves.

**Not built:** capital-gains tax (excluded by decision).

## 20. Phase 6: Night City Map bridge (v0.6.0)

Two pieces: the core half in this module, and a small separate module, `night-city-map-night-city-investments-bridge` (v0.1.0, requires Night City Map and this module), that watches the map.

### The bridge module

`scripts/bridge-<version>.js` is one file (the version in its name stops browsers keeping an old copy after an update). `diffGigs(known, gigs)` compares each gig's status with the last look and returns the gigs that went from open (hidden, offer, active) to `done` or `failed`. The first look only records statuses, so gigs finished before the bridge loaded are not reported; a finished gig flipped between done and failed is not reported again; a gig created already finished is not reported. `createBridge()` takes its inputs as functions, so it is tested without Foundry. From v0.2.0 it scans whenever the map saves its gigs (the `updateSetting` and `createSetting` hooks for `night-city-map.state`): every gig change goes through the map's `save()`, so it needs no poll and no wrap of the map's code. Only the active GM queues reports, but every GM client keeps its record of statuses so a handover loses nothing. Reports wait in an outbox and are retried (up to 20 attempts) if the core is missing, too old, or throws. It sends `{gigId, sourceKey: "gig:<id>:<outcome>", outcome, client, reward, title, desc, notes, takenBy, runners}`, where `runners` is the character the map's `takenBy` names (§22, H4). One world setting turns reporting off.

### Core API

`game.modules.get('night-city-investments').api.events`:

- `reportImpact(payload)` → `{ok, status, ...}`, status one of `applied`, `pending`, `unmatched`, `ignored`, `duplicate`, `disabled`, `invalid`, `not-gm`. Works only on the active GM's client.
- `resolveClient(clientOrGig)`: which company would this be, with no side effects.
- `isReported(sourceKey)`.
- `api.gm.gigs` is the service (`approve`, `discard`, `mapClient`, `addMapping`, `removeMapping`, `reportManual`, `clearHistory`). Hooks: `night-city-investments.gigImpact` (`{status, record}`) and `.gigsChanged`.

### Matching a client (`engine/gigImpact.js`)

In order, the first that finds a company wins: a `[NCI: ARA]` tag in the gig's notes (or `[NCI: ignore]`); the GM's saved mapping for that client; an exact name, ticker or alias, ignoring case, punctuation and legal suffixes ("Trauma Team International" = "Trauma Team"); a company name inside the client text ("Arasaka Security Division"), never a ticker, and never a one-word remainder such as "night" from "Night Corp"; a near miss (edit distance, 80% or better); and last a company named in the gig's title, description or notes. Two companies at the same level of match make the client ambiguous, which is treated as unmatched. Tag, mapping, exact and contained matches are trusted. A near miss or a mention is always held for GM review, even with approval off. NCMap gigs only have a `client` field when generated, so hand-written gigs rely on the tag or on a mention.

### Size and timing

`A = sign · min(cap, k·log10(1 + reward/1000) + floor)`, with `k=0.03`, `floor=0.5%`, `cap=8%`, failures ×1.3, then × the world setting "Gig impact strength" (0.25 to 3), then × the room left: the company's recent gig impacts (7 ticks, summed in size) use up a soft cap of 10%, but never more than 80% of an impact. A hard cap of about 12% remains. A 1,000 eb success is about +1.5%, a failure about -2%. The reward is read from the free-text field (`1,500 eb`, `2k`, `500 eb × team` and so on, first figure wins, 0 if none).

The effect shows `delayDays` ticks from now (1 to 3, chosen from the gig's key so it is repeatable). Through the §5.4 kernel with the impact's `onsetTick = tick + delay - 1`, nothing moves before then. A success is `permanent: 0.35, tauDown: 12`, a failure `0.5, 14`. The impact goes into the control journal's impact list with `source: 'gig'`, so it shows in the Events queue and the log, and the existing undo and preview machinery treat it like any other.

### Approval, mapping and history

A GM-only record on the control journal (`flags.night-city-investments.gigs`): `pending[]`, `history[]` (latest 100) and `mappings{}`.

- `pending` items are of kind `review` (a company is known; waiting to be approved) or `mapping` (no company; waiting for the GM to choose one or ignore the client).
- With "GM approves gig impacts" on (the default), every matched gig waits as a `review`. The GM can change the size (±30%), the delay (0 to 30 days) and the headline before approving. Off, a trusted match is applied at once.
- Mapping a client saves the choice (unless unticked) and settles every other waiting gig from that client. With approval on they become `review` items, with it off they are applied.
- Each gig is keyed by `sourceKey`. A key in `pending` or `history` is a `duplicate`, and the control list is also checked, so no gig moves the market twice, even if the bridge re-reports or a write is interrupted.
- A company that is not trading (delisted, bankrupt or not yet listed) cannot take an impact; the gig is recorded as ignored.
- A market reset clears pending and history (the tick numbers start again) but keeps the mappings.

### Headlines, rumours and the GM's view

The headline is chosen from thirty-two generic lines (eight for each of success and failure, mild and strong), with the company's name and nothing about the gig. It is stored on the impact and published by `GigImpactService.onTick` on the first tick the price actually moves, so the news lines up with the chart. Leaving the field blank publishes nothing.

Optional rumours: world setting `gigTips` (off by default) and a player notification category `tips` (off by default). When an impact is applied, opted-in players who hold or watch the company get a vague mail that says which way, never why. It comes from the player's own broker, in the broker's voice (§21), or from the market wire if they have no broker. The gig's headline, when the price starts to move, is also mailed this way to players who opted in to "Market headlines" (a broker-voiced lead-in, then the headline); all other news mail stays on the wire. The "from a gig" marker travels only with the in-session `newsPosted` hook, never in the stored public feed.

The Gigs tab of the GM Console lists what needs a company, what awaits approval, the saved mappings (with a form to add one), a form to report an outcome by hand (with the company named or left to be found), and the latest 15 outcomes. The tab title shows how many items need attention, and a notification tells the GM when one arrives. New settings: `gigImpacts` (master switch, on), `gigImpactScale` (1), `gigTips` (off); `gigImpactApproval` already existed.

### Not built

The insider-trading "heat" mechanic from §10 is being built in stages (§22). Gigs finished before the bridge was installed are deliberately not back-filled; the manual report covers them.

## 22. Insider-trading heat (H1 v0.7.1, H2 and H3 v0.8.0)

A gig outcome is private until its price effect starts to show. A character who trades the client in that gap, in the direction the news will move it, draws **heat**: a hidden 0 to 100 score per character that halves about every week. H1 records it; H2 warns and penalises; H3 lets a warned player fight back with skill rolls. The H1 text below is still accurate; H2 and H3 are described after it.

- **Off by default.** World setting `heatEnabled`; `heatStrength` (0.25 to 3, default 1) scales every gain.
- **Hidden.** The record lives in the GM-only control journal (`flags.night-city-investments.heat`), not on any actor, so players cannot read it. The GM Console's Heat tab shows it, read-only.
- **The window.** `HeatService.openWindow` runs when a gig impact is queued (so a discarded gig never opens one). It runs from the day the outcome was *reported* (so a trade made while the impact waited for approval is still caught) to the impact's `onsetTick`, the last tick before the price starts to move.
- **The audit.** Nothing is scored live. After a tick, `HeatService.onTick` audits each window that has closed and whose in-window orders have all filled, or 10 ticks after closing at the latest (slow broker orders). One pass scores every character's filled orders. That makes it deterministic, independent of order latency, and cheap.
- **What counts** (`engine/heat.js`, `scoreTrade`): a filled stock order placed inside the window, in the news's direction (a buy before good news, a sale before bad), of at least 250 eb. Funds are ignored, as are trades the other way, earlier holdings, and orders placed before the window (even if they filled during it).
- **How much.** `gain = 14 × strength × size × earliness × knowledge × route`, where 14 is what one *medium* trade (3,000 eb, or 10% of the portfolio) earns when it is as suspicious as it can be.
  - *size* counts how many medium trades it is, half by eb and half by share of the portfolio. It grows in proportion up to 4, so a 6,000 eb trade on a 30,000 eb portfolio is worth two medium trades and a 12,000 eb one is worth four. Bigger trades therefore draw more heat, and a small portfolio feels a trade more than a rich one does.
  - *earliness* is 1 on the first day of the window, falling to 0.6 on the last.
  - *knowledge* is 1 for anyone, 0.4 for a character sent a rumour about it (rumours are an opt-in feature, so following one must not be a trap), and 1.5 for the gig's runner. Runners come from the report's `runners` (actor ids), which the bridge fills from the map's `takenBy` (stage H4).
  - *route* is 1 for direct trades and 0.7 for broker trades.
  - One audit adds at most 100 heat to a character.
  - **Rule of thumb** (a 30,000 eb portfolio, early in the window, no rumour): one medium trade is about 14 direct or 10 through a broker; two direct, or three broker, medium trades reach "noticed" (25); one 6,000 eb trade does on its own; two 12,000 eb trades make a character "investigated". Late in the window, or after a rumour, it takes more.
- **Tiers.** Quiet 0 to 24, Noticed 25 to 49, Flagged 50 to 74, Investigated 75 and up (see H2 for what each does).
- **Record.** `{characters: {actorId: {heat, tick, name, log[20]}}, windows[40], audits[30]}`. Heat is stored with the tick it was set and faded when read. A market reset clears it (ticks start again from zero).
- **For later stages and other modules.** Hooks `night-city-investments.heatAudit` (`{window, results}`) and `.heatChanged`; `api.gm.heat` has `heatOf`, `tierOf` and `snapshot`.
- **Runners (H4).** The bridge looks up the character a player took the gig as (the map's `takenBy`, a character or user name) and reports their id in `runners`. `GigImpactService` keeps the ids of existing characters on the record, so they wait with it through approval or mapping, and opens the window with them. Undo is not affected: heat is only changed by audits, and an audit never runs twice for one window.

### H2: warnings and consequences (v0.8.0)

Setting `heatConsequences` (default on; needs `heatEnabled`) switches this on, and `heatPenaltyApproval` (default on) makes the GM approve penalties. Pure rules are in `engine/heatPenalty.js`; orchestration is `HeatService`.

- **Warnings.** One per tier crossed upward, re-armed once heat falls back below it. *Noticed*: a mail from the player's broker in the broker's voice (voice kind `warning`, with the standard wording as the fallback). A player with no broker hears nothing at this tier. *Flagged*: a routine enquiry from the **NCPD Financial Crimes** NCM contact (`ensureNcpd`). Wording is varied (`HEAT_MAIL_VARIANTS`). Warnings are always sent when consequences are on; there is no player opt-out.
- **Heat awareness.** Once a warning has been delivered the portfolio gets `heatAware`, which is what reveals the cover-up panel in the terminal. Players never see the number.
- **Scrutiny while flagged.** Broker orders take one extra day and the commission is x1.5 (`scrutinyFor`, applied in the executor via `settings.scrutiny`).
- **Investigation.** At *investigated* a character has one case open at a time. `planInvestigation` picks (seeded) a **fine** (50%), a **freeze** (30%) or a **dropped broker** (20%; with no broker that share goes to the others).
  - *Fine:* 10 to 25% of the flagged trades' value, minimum 100 eb, taken from the brokerage balance (a ledger line of kind `fine`). A shortfall is noted in the mail and not carried as debt. Seizure of gains is folded into the fine.
  - *Freeze:* 2 to 5 days. `frozenUntilTick` blocks orders and withdrawals (`account-frozen`); deposits still work; open non-IPO orders are voided.
  - *Dropped broker:* the broker is unassigned, their open orders are cancelled, and that broker will not take the player back for 14 days (`brokerBans`, `broker-refuses`). The broker sends a "dropped" mail in their voice.
  - With approval on, the case waits in the GM's Heat tab; the GM edits the amount or days and approves, or dismisses. Players cannot create or alter penalties: the executor has no GM-only request types. Approving carries it out, mails the player (NCPD for a fine or freeze, the broker for a drop) and halves the heat so a character is not re-penalised for the same trades.
- **Broker skill.** A better broker leaves a smaller trail on trades they place: `brokerFactor` from 1 (rookie) down to 0.65 (elite) multiplies broker-route heat.
- **Audit timing.** The audit runs after the portfolio system has worked the tick's open orders, so an order that fills on the closing tick is included.

### H3: counter-play with skill rolls (v0.8.0)

A warned player can **cover their tracks** from the portfolio tab. Every attempt is a CPR roll (stat + skill + 1d10, with a natural 10 exploding and a natural 1 subtracting) made by the player on their own client when they press the button, against a DV, like the terminal's access check (`SkillAdapter.check`; the request carries the chat card's id and `SkillAdapter.verify` rebuilds the dice for `settings.checks`, see §26.0). It costs money whether or not it works and goes on a cooldown.

| Action | Skill (stat) | DV | Cost (eb) | Cooldown (days) | Heat removed | Failure |
|---|---|---|---|---|---|---|
| Mask the pattern | Trading (INT) | 13 | 150 | 1 | 8 | fumble adds 4 |
| Cook the books | Accounting (INT) | 15 | 500 | 3 | 15 | fumble adds 6 |
| Front company | Business (INT) | 15 | 1,500 | 7 | 5 now, and new audits give half heat for 7 days | fumble adds 8 |
| Pay someone off | Bribery (COOL) | 17 | 3,000 | 7 | 30 | a miss adds 8, a fumble 20 |

- A critical success removes x1.5. A skill the character does not have counts as level 0 (a stat-only roll).
- The result comes back as a chat card and a notification. The effect is applied by `HeatService` from the executor's `heatAction` event, once per request key, so a repeated sweep cannot apply it twice.
- Funds act as cover simply because they draw no heat. The GM's scrub is the Heat tab's set and clear controls, which also bypass the approval step.
- Hook `night-city-investments.heatPenalty` fires when a case is proposed, approved or dismissed.

## 23. Phase 7: tools, migrations and docs (v0.9.0)

The finishing pass. The macro importer was dropped, and the starter pack had been in since phase 1.

- **Migrations** (`engine/migrations.js`, `services/MigrationService.js`). The world setting `schemaVersion` (hidden, default 1) records how far the stored data has been brought. `MIGRATIONS` is an ordered list of `{version, id, up(ctx)}`; `runMigrations` runs the ones after the stored version and records each as it finishes, so a failure part-way keeps its progress and the version stays on the last good step. The steps are pure: everything they read and write comes through `ctx` (portfolios, the GM stores, the version). The active GM runs them at `ready`, before the portfolio sweep and the tick service. A world saved by a newer module is left alone and a warning is logged. Step 2 (`normalize-stored-data`) writes back every portfolio and the controls, gigs and heat stores with the fields added since v0.1, so nothing relies on a read-time default. It only adds fields; the flag merge in Foundry means it can never remove one. To add a step, bump `SCHEMA_VERSION` in `constants.js` and append to `MIGRATIONS`.
- **Self-check** (`engine/verify.js`, `DiagnosticsService.verify`). Looks over a snapshot of the world and returns one result per check (schema version, NCM mail, the wire contact, the world seed, the control journal, companies, market state, funds, brokers, portfolios, holdings, heat) at a level of `ok`, `info`, `warn` or `fail`. Examples: an invalid or duplicate company, a price that is zero or NaN, a fund holding a deleted company, a negative balance, more cash reserved by open buy orders than the balance holds, lots or open orders on an asset that no longer exists (a warning, since deleting a company is allowed). It changes nothing. Run from the Tools tab, the macro, or `game.nightcity.investments.verify()`.
- **Trade log** (`engine/tradeLog.js`). The latest filled orders across every portfolio, newest first, in the Tools tab and `api.gm.tools.tradeLog`. It is read from each portfolio's closed orders, so it only reaches back as far as the last 40 per character.
- **Company suggestions** (`engine/suggest.js`). Organisations on NCM contacts (not the market wire or brokers) and clients of gigs that match no company, merged by normalised name and ranked by how often they appear. The same matcher the Gigs tab uses decides what is already covered, so a name that would match an alias is not suggested. Each gets a ticker (`suggestTicker`). "Create" opens the Company Editor with the name and ticker filled in. "Ignore" saves a gig mapping to `ignore`, which also means gigs for that client move no price.
- **Macros** (`services/MacroService.js`). The Tools tab creates four world macros (open the terminal, open the console, advance a tick, run the self-check), each tagged with `flags.night-city-investments.macro` so none is made twice, and a deleted one can be made again. Only the terminal macro is visible to players; Foundry lets only Trusted players and above run script macros by default, so the scene-control button remains the main way in.
- **Keybindings.** "Open the Market Terminal" and "Open the Market GM Console" (restricted to GMs) are registered with no default key, so they can never clash with a key a table already uses.
- **API.** `api.verify`, `api.schemaVersion`, `api.gm.tools`, and the `night-city-investments.ready` hook, fired when every part of the API is attached. `apiReady` still fires earlier with only the basics.
- **Docs.** [GETTING-STARTED.md](GETTING-STARTED.md) (a GM's first session), [PRICE-MODEL.md](PRICE-MODEL.md) (the model with its real numbers) and [API.md](API.md) (every supported call and hook).
- **Not built:** the macro importer, a compendium macro pack (packs are binary databases and world macros are easier to edit), taxes, and a v13 port.

## 21. Broker voices (v0.6.1)

Modelled on the Night City Map / Night City Messenger bridge, where a fixer's mail follows the Personality on their character sheet.

- **Where the voice comes from.** `BrokerRepository.personalityFor` reads `system.lifepath.personality` from the broker's linked actor and matches it by keyword (`engine/brokerVoice.js`, `resolvePersonality`) to one of the ten Cyberpunk RED Personality entries: shy, rebellious, arrogant, moody, picky, stable, silly, sneaky, intellectual, friendly. "Friendly and outgoing", "FRIENDLY" and "quite friendly really" all work.
- **The fallback.** A broker with no linked sheet, a blank Personality, or text that matches none of the ten gets exactly the old mail: the facts, then the sign-off for their skill grade. Nothing about their terms, speed or skill changes with the voice; it is wording only.
- **What a voiced mail looks like.** A greeting, a line that suits the situation, the facts exactly as before, and a sign-off (which replaces the skill-grade sign-off). Subjects are unchanged, since players quote the order reference.
- **Situations.** Seventeen kinds, each tagged by `MailService` in a `voice: {kind, data}` on the mail spec: order accepted; bought; sold (flat, at a gain or at a loss, from the realised profit); rejected (orders and mailed requests); expired; withdrawal queued, paid and failed; cancelled; request not understood; help; account report (status and statements); not a client; and a rumour that is good or bad (§20).
- **Variety.** Each personality has five greetings, five sign-offs and four lines for every situation, except rumours, which have eight good-news lines, eight bad-news lines and six "hedges". A line is chosen at random and is never the one used last time from that pool. `{ticker}` and `{name}` are filled in where the mail has a company.
- **Rumours.** A voiced rumour is built entirely from the broker's pools: a greeting, a rumour line, a hedge ("you did not hear it from me"), and a sign-off. That is several hundred combinations per personality. A player with no broker, or a broker with no voice, gets the standard wording, which is also varied (4 subjects, 8 good-news lines, 8 bad-news lines, 6 hedges in `NCI.Mail.Tip`, picked at random with no immediate repeats).
- **Where it applies.** Only mail sent as a broker (`MailService.fromBroker`): replies to mailed orders, fills and other order notices, withdrawal mail, statements and rumours from the player's own broker. Market-wire mail (dividends, headlines, digest, movers, alerts) and chat notices stay as they were.
- **Content.** The lines are in `data/broker-voices.js` and `data/voices/<personality>.js`, English only, not in `lang/en.json`, like the starter companies. A test checks every personality has every pool, no repeats, only valid tokens, and no line shared between voices.
- **GM view.** The Brokers tab shows each broker's voice ("Voice: Sneaky and deceptive" or "Standard"). The voice is not editable: change the Personality on the sheet.

## 24. Tick clock, previews and broker removal (v0.9.2)

- **Default tick mode is the in-world clock** (§5.1): one tick per `realTimeMinutes` of Simple Calendar time, a date change moves the market date without a tick. `lastMs` joins `lastDay` in the public state; `_write` keeps it unless a caller supplies a new one.
- **Advance buttons** read "Advance 1 / 7 / 30 ticks" and "Advance N", and the starter macro is "Advance Market One Tick".
- **Previews open under their button.** The Market tab's sentiment preview sits below the sentiment form's Preview button, and the Events tab's shock and glide previews below theirs. The result block is one inline Handlebars partial (`previewBlock`) used three times; the stored preview carries its `kind` so only the matching form shows it. **From v0.9.6 the Preview button is the toggle** (`_togglePreview`): while its own preview is open it reads "Close preview" and pressing it closes the preview, and there is no separate close button under the result. Opening another kind's preview replaces the current one.
- **Removing a broker** (`BrokerRepository.remove`). A broker is an NCM contact with the `broker` tag, and the contact is never touched. Removal writes `{removed: true}` to that broker's entry in the `brokerDefs` setting, and `list`, `isBroker` and the picker honour it, so the broker disappears from the market and from mail handling. It is refused while a character has them as their broker (`assigned`) or still has an open order or a pending withdrawal through them (`busy`), because the first would leave a player with no broker and the second could not be mailed or paid. Making the same contact or character a broker again clears the flag.

## 25. The game-day clock (v0.9.3)

A tick is now a fraction of a game day in the in-world clock mode (10 minutes by default, 1/144 of a day), so nothing that lasts "days" can be counted in ticks. The market has its own clock in **game days**, and every duration is measured on it.

- **`time`.** A float in the public state (`pub.time`; `MarketStore.time()` reads it, falling back to the tick count for a market from before it existed, since a tick was a day then). Each tick adds `dt` days: `TickService.tickDays` is the tick interval over 1440 in the in-world clock mode, and 1 in the day and manual modes. `addTime` snaps the sum to 1e-9 and `dayOf` forgives 1e-6, so a day of small steps lands on the whole number. With whole-day ticks `time` equals `tickIndex`, so a market in the day modes behaves exactly as before, and the tests that predate the clock pass unchanged.
- **Fields that hold a time.** `startTick`, `onsetTick`, `eligibleTick`, `expiresTick`, `releaseTick`, `openTick`, `closeTick`, `frozenUntilTick`, `heatCooldowns`, ledger `ts` and so on keep their names but now hold game-day times. Delays and durations (a gig's one to three days, a bias, a glide, a forced regime, a broker's speed, settlement, a heat window, its half-life, a cooldown, a freeze, a ban, a terminal session or lockout) are added to `time` in days, so they mean the same at any tick size. Anything shown to a player or GM is rounded up to whole days (`daysLeft`, `daysInclusive` in `ui/format.js`).
- **The price model scales with `dt`** (`marketModel.js`): drift, the pull toward fair value and a bias are rates (times `dt`), random movement goes with the square root of `dt`, the chance of a jump or a regime change is per day, and the volatility ratio's decay is `b^dt`. A ten-minute tick moves a price a hundred times less than a day tick would, and ten days of ten-minute ticks match ten day ticks in spread and drift (`gameDaysEngine.test.mjs` checks this). With `dt = 1` every formula reduces to the old one.
- **Events.** The impact kernel's increment is `H(t) - H(t - dt)`, so the same total arrives over the same days. A gig impact's onset is `time + delayDays - dt`, so its first effect shows `delayDays` game days after it was reported, and its heat window closes then. `resolveControls` and `pruneControls` take `dt`. A glide counts its remaining ticks from its days.
- **History** holds one close per game day: several ticks in a day keep updating that day's close, a day with no tick repeats the one before, and an undo puts the day's close back to the earlier price. `prevClose`, `prevNav` and every "today's move" (the ticker, alerts, the daily digest, big movers) are against the previous game day's close, and the digest and movers go out only on the first tick of a day (the `priceTick` hook carries `newDay`, `days` and `time`).
- **Funds** accrue their expense ratio, yield and manager's alpha per day. **Dividends** go to shares bought before the start of the payout day, not before the tick.
- **Undo** asks "has money moved?" with the clock time of the tick, which is what ledger entries are stamped with.
- **Calendar jumps catch up.** A jump forward in the in-world clock mode runs the whole days in it as day-sized ticks (§5.1), so game time follows the calendar and events that fell due in it happen. Going back only changes the market date. The GM Console's **Advance 1 day** runs one day-sized tick (`TickService.advanceDays`), which is the same as a tick in the day and manual modes.

### Rumours and the heat window (v0.9.4)

A rumour is mailed at the moment a gig outcome is tracked (`GigImpactService._tip`, from `_afterApply`), not on a tick, so ticks do not delay it. What gives players time to act is the gig's delay, which is 1 to 3 game days: the price effect starts that many days after the report (`onsetTick = time + delayDays - dt`), and the public headline is posted once it has. The heat window opens at the report (`openTick` is the clock at that moment, even if the GM approved the impact later) and closes when the effect begins, so it spans the same game days, and it records who was sent a rumour. A rumour therefore leads the effect by the full delay at any tick size, and a trade in that gap is what the audit looks at. If a gig waits for approval, the delay counts from the approval.

## 26. Proposal: syndicates and player-owned companies (not built)

Decisions so far: Crew Tools cannot be changed, so everything is NCI-side or in a bridge. Businesses start small and grow (§26.0): a side business needs no charter, and the charter and the listing are later stages a business earns. Hustle income stays personal and is unrelated to a company; a business's profit is separate, and reaches its owners only through capped draws or dividends. Payouts are capped. Syndicate holdings are visible to every member. The GM approves every company charter. All durations are game days (§25) and all writes follow the request, GM-executor pattern. The operating period is **weekly** with **monthly** published reports, to match weekly game sessions (§26.4).

**Roll rule: every player roll is triggered by the player.** Nothing in this section rolls for a player. A roll happens only when the player presses its Roll button (charter, business actions, report preparation, layering or investigating ownership), and the work is never forced on them.
- **Where it runs.** The roll is made on the player's own client as a normal Foundry roll with a chat card (and Dice So Nice), using `SkillAdapter.check` (stat + skill + 1d10, a 10 explodes, a 1 subtracts). The request carries the chat message id, not a total.
- **What the executor checks.** The active GM's executor loads that chat message, confirms it was authored by the requesting user and has not been used before, re-reads the stat and skill from the actor, and recomputes the total from the raw die. It then applies the DV, cost, allowance and cooldown. A total supplied in a request is never trusted. This model is **built (v0.9.5)** for the terminal check and the H3 cover-up actions (`SkillAdapter.check` on the player's client, `SkillAdapter.verify` on the GM's). It also checks that the card's author owns the actor, that the card is no more than 10 minutes older than the request, and marks it used by the request key, so a retried request is fine and a second one is not. A player who edits their own chat data could still forge dice; that is the usual table-trust limit, and the GM sees every card.
- **Not rolling is a valid choice.** An action nobody rolls simply does not happen. The weekly result is then the baseline (§26.4), with at most a small GM-tunable drift. The system's own event draw is not a player roll and stays on the engine.
- **One roll, one use.** A roll belongs to the action it was made for and cannot be reused. Retries, fees and delays are counted from the roll, in game days.

**Player levers on every roll.** A roll is a decision, not only a button. Cyberpunk RED's own levers apply, and the player sees what is at stake before rolling.
- **Who rolls.** Any officer (or, for the charter, any founder) may take a roll, so the crew chooses its best character for the job.
- **Approach.** Before rolling, the player picks **Careful** (DV −2, the effect scaled down), **Standard**, or **Bold** (DV +3, the effect scaled up, and some Exposure). Aggressive reporting (§26.4) is the Bold approach to report preparation.
- **Luck.** The player may spend LUCK points on the roll, as the rules allow. The roll dialog asks how many before rolling.
- **Complementary skill (+1).** A successful related check earlier in the same operating period, by anyone in the crew, leaves a one-use +1 on the company for the matching action (for example Library Search as market research before a Business roll, Human Perception to read the counterparty before a Bribery roll, Local Expert before a Bureaucracy roll). At most one is used per roll. A **role ability** can be the complementary check where it fits the action (a Fixer's Operator before Source supplies or a capital raise, a Media's Credibility before Promote, a Netrunner's Interface before due diligence), so every partner has a roll that matters each period without adding action slots. This replaces an ad-hoc crew-assist bonus, and gives characters who are not officers something to do.
- **Extra time (+1).** Spending an extra downtime day on the action (through the Crew Tools bridge, §26.8, or the native allowance) adds +1, as the rules allow for taking extra time.
- **Hired professionals.** A crew missing a skill an action needs (an Accounting roll for the charter, say) can hire an NPC professional for that one roll: an accountant, a lawyer, a broker. The fee is paid from the business (a Fixer's Operator lowers it), and the NPC's fixed base (GM table: about 10 for a cheap hire, 13 for a good one, 16 for the best) replaces the character's stat and skill. A player still presses Roll and may still add a complementary bonus, but not Luck, which is a character's own. It keeps every crew able to progress while rewarding characters who have the skill.
- **Preview.** Before rolling, the dialog shows the DV, the approach's effect, and what each outcome band would mean, so who rolls and how much Luck to spend are informed choices.

**DVs** follow the rulebook's ladder: Everyday 13, Difficult 15, Professional 17, Heroic 21, Incredible 24. A table maps each action, sector and size to a step on it, so a GM can tune by naming a step rather than a number.

**Outcome bands.** Every check uses the same bands, so the margin (total minus DV) always matters, as it already does for the capital quote (§26.2a):

| Band | Margin | Meaning |
|---|---|---|
| Fumble | natural 1 that fails | the action's fumble effect |
| Failure | below 0 | no effect; the cost is still paid |
| Narrow | 0 to 1 | a quarter of the effect |
| Solid | 2 to 5 | the effect |
| Strong | 6 to 7 | one and a half times the effect |
| Exceptional | 8 or more, or a critical | double the effect |

**Opposed rolls** are used where a person opposes the action, as the rules do: the acting roll must beat the opponent's skill total, which may be a stored total from an earlier roll (§26.6) or an NPC's skill from a GM table.

**What the executor also verifies.** The roll card records the approach, the Luck spent, and any complementary bonus used. The executor checks that the actor's LUCK pool went down by the Luck claimed, consumes the stored complementary bonus (it cannot be used twice), applies the approach's DV, and recomputes the total from the raw dice as before. The roll itself is still never trusted.


### 26.0 Stages: from side business to listed company

Most player enterprises in Night City are small: a garage, a ripperdoc's back room, a bar, an info shop. They start with a little gear and a lot of hustle, and only a few grow big enough to justify a charter, let alone a listing. The design therefore has four stages, and a business moves up by meeting a stage's milestones and passing a step-up roll. Growing is meant to be the usual path to a large company, and the cheaper one (§26.2a).

| Stage | What it is | To start or step up | Weekly profit (typical) | Action slots | Reporting | Money in |
|---|---|---|---|---|---|---|
| 0. Side business | unregistered: a stall, a garage bay, a back-room clinic | a founding agreement, one setup roll, 500 to 3,000 eb of gear and stock, no charter, GM approval by setting | 20 to 150 eb | 1 | weekly digest | owners' own money, fixer loans |
| 1. Registered business | a licensed shop, bar, clinic or outfit | milestones below + a registration roll + a fee | 150 to 600 eb | 2 | private monthly ledger | + bank loans, private investors |
| 2. Chartered company | §26.2: a company with a cap table and officers | milestones below + the charter (§26.2) | 600 eb and up | 2 to 4 by capacity (§26.4) | monthly report (§26.4) | + private placements, capital raises |
| 3. Listed company | §26.4a | the listing requirements | market priced | as a company | public report | + IPO and the market |

The profit bands are calibrated against the valuation (§26.4a): at a typical sector multiple of 10, a side business is worth about 12,000 to 80,000 eb, a registered business about 90,000 to 330,000, and a chartered company reaches the 500,000 eb listing threshold at around 850 eb of weekly profit. A registered business stays under the threshold even at the top sector multiple, so a listing always passes through the charter. Measured with the business simulator (B0, §26.9), at the default **growth rate** of 1 a strong crew that reinvests becomes eligible to list in about 50 operating periods, an average crew in about 80, and a weak crew rarely. The milestones alone set a floor of about 28 periods (4 before registering, 3 monthly ledgers before the charter, and 3 reports above the threshold before a listing), so no business lists sooner however well it is run. The growth rate setting scales every growth effect to fit the campaign's pace: at 1.5 a strong crew lists in about 40 periods and an average one in about 64.

**Ownership and partners.** A business has a cap table from the day it opens, so several characters can found it together and nothing has to be restructured as it grows:
- **Units.** Each partner's contribution buys units at book value: cash at face value, and gear brought in (a surgical kit, a workshop's tools) at a book value the partners agree and the GM can review. Money put in later buys units at the current book value per unit, so early partners are not diluted unfairly. Units sit in the partners' portfolios like restricted shares (§26.3).
- **The founding agreement**, made when the business opens and changed only unanimously, records:
  - **Sweat equity:** an optional slice of units for the partner who will do most of the work (default 0%, capped at 10% as in §26.2a).
  - **The decision rule:** majority of units for day-to-day choices, such as who takes each action slot, draws, loans and projects. Unanimity is needed to admit an investor, sell or close the business, step up a stage, or change the agreement. The partners may choose stricter rules, as a syndicate does (§26.1).
  - **The buy-out rule.** Night City is lethal, so when a partner dies, leaves the campaign or wants out, the remaining partners may buy the stake at book value within 14 game days (from the till, their own money, or a loan). Otherwise it passes to whoever the character named, as non-voting units that still receive draws. The GM can apply it when a player leaves the table.
- **Draws and decisions follow units.** A syndicate can be a partner, or own the whole business, acting by its own approval rules (§26.1).
- **Into a company.** At the charter, units convert one-for-one into restricted shares, so the cap table carries straight on to the company and, later, the float (§26.2a).

**Setting up.** Opening a side business takes one player-triggered roll, by any partner, using the archetype's trade skill, Business, or a role ability that fits (a Fixer's Operator finding the space and second-hand gear, a Tech's Maker building the equipment). The outcome band sets how much of the 500 to 3,000 eb setup cost the business needs and the Capacity it opens with. A failure costs a third of the setup money and a delay of 7 game days.

**Archetypes.** A small business is created from an archetype, which sets its base takings and costs, the events it draws, and the **trade skills** that run it. Trade skills are what let any character, not only an Exec or Fixer, run a business:

| Archetype | Trade skills | Roles that fit |
|---|---|---|
| Garage or chop shop | Basic Tech, Land Vehicle Tech | Tech, Nomad |
| Ripperdoc clinic | Cybertech, Paramedic | Medtech, Tech |
| Bar or club | Conversation, Persuasion, Play Instrument | Rockerboy, Fixer |
| Boutique or salon | Wardrobe & Style, Personal Grooming | Media, Exec |
| Gun shop | Weaponstech, Trading | Solo, Fixer |
| Info shop or data broker | Library Search, Electronics/Security Tech | Netrunner, Fixer |
| Courier service | Drive Land Vehicle, Local Expert | Nomad |
| Security outfit | Tactics, Persuasion | Solo, Lawman |
| Screamsheet or media outlet | Composition, Photography/Film | Media |
| Food stall | Streetwise, Local Expert | anyone |

The GM can add archetypes. A business at stage 2 or above maps its archetype to a market sector (§26.4) for the backdrop and the earnings multiple.

**Location.** A small business has an address: a place on Night City Map (one of its locations, or a pin the GM adds). The district sets foot traffic (a multiplier on takings) and risk (how often shakedowns and gang trouble come up), so a stall in the Combat Zone is cheap and dangerous and a boutique in the Executive Zone is the reverse. Showing businesses on the map is a job for the map bridge.

**The small business loop (stages 0 and 1).** It runs on the weekly operating period (§26.4) but is simpler than a company's: no officers (the partners decide by their founding agreement), no public report, and fewer, more personal actions. Partners who do not take the slot still play a part through complementary checks, including role abilities (the player levers above). Each action uses a slot and is an ordinary player-triggered roll with the levers (Luck, complementary +1, approach):

| Action | Skills | Effect |
|---|---|---|
| Work the shop | the archetype's trade skills | the week's takings: the outcome band scales the archetype's base takings |
| Promote | Persuasion, Wardrobe & Style, Composition; Media Credibility, Rockerboy Charismatic Impact | Reputation and foot traffic up for the next periods |
| Source supplies | Trading, Streetwise; Fixer Operator | the Cost base down, or rare stock in |
| Fix the place up | Basic Tech; Tech Maker | Capacity up (more takings possible) |
| Keep it safe | event responses (§26.4), Tactics, Persuasion; Solo or Lawman | answers shakedowns, theft, gang trouble |

An unrolled week is not a closed shop: takings default to the archetype's baseline, with neglect drift (§26.4). The business may also take on **expansion projects** (a second chair, a bigger bay, a second location) with a day requirement, tracked like §26.8's projects and paid from the till; finishing one raises Capacity.

**Money at the small stages.**
- **The till.** Takings go into the business's own account; rent, stock, wages, licence fees (registered only) and protection money (unregistered, or in rough districts) come out each period.
- **Owner draws.** Owners may draw up to the last closed period's profit, split by units, into their wallet (stage 0) or brokerage balance (stage 1), as a request through the executor. This is the small-business equivalent of a capped dividend (§26.7): it cannot exceed what the business earned, and draining the till leaves nothing to grow with.
- **Loans.** A **fixer loan** (stage 0 up): quick, no paperwork, a high weekly rate, and missed payments bring heat and a visit. A **bank loan** (stage 1 up): an Accounting or Business roll sets the rate and limit from the business's ledger; lower rates, and missed payments hurt Compliance. Repayments come out of the till each period.
- **Private investors** (stage 1 up): another player, a syndicate, or an NPC angel buys new units for cash, admitted unanimously by the partners. A player or syndicate investor buys at book value per unit unless the partners agree a premium. An NPC angel's price comes from a Persuasion or Trading roll opposed by the angel's skill. Investors become holders, so a later charter starts with them on the cap table.
- **Failure.** A till below zero for two periods with no loan to cover it closes the business; its gear sells for a fraction of its value. Owners can start again.

**Stepping up.** Milestones are shown as a checklist, like listing eligibility (§26.4a), and the step-up roll is player-triggered:

| Step | Milestones (defaults) | Roll | On failure |
|---|---|---|---|
| Side → Registered | 4 periods operating, average profit of 100 eb a week over the last 4, Reputation of at least 45, just under the baseline (§30) | Registration: Bureaucracy (Local Expert or Persuasion at DV +2), plus a fee of about 500 eb | the fee is spent and a delay of 7 game days; nothing is lost |
| Registered → Chartered | 3 monthly ledgers, average profit of 400 eb a week over the last 4 periods, Capacity from at least one expansion | the charter (§26.2), with the business plan roll one DV step easier for a business with a track record | as §26.2 |
| Chartered → Listed | §26.4a | the prospectus rolls (§26.4a) | as §26.4a |

Registering lowers protection costs and shakedown risk, unlocks bank loans and investors, and brings licence fees and Compliance. A business can also stay at its stage for good; that is a normal choice.

**Gigs and heat at the small stages.** Gigs naming the business as client affect its takings and Reputation as for companies (§26.5). A business has no share price until it is listed, so before then there is no insider-trading window; investors in a private business trade only privately.

**Worked example: a Medtech and a Fixer.** Two characters open a back-room ripperdoc clinic in Watson and mean to take it public.
1. **Founding (stage 0).** The Medtech puts in 1,000 eb and her surgical gear (book value 800); the Fixer puts in 1,500 eb. That is 1,800 units to 1,500, about 55% to 45%, and they agree a 5% sweat slice for the Medtech, who will do the surgery. The Fixer makes the setup roll with **Operator**, finding the space and second-hand gear, and a Strong result keeps the setup cost low.
2. **Weekly, with one slot.** The Medtech takes **Work the shop** with Cybertech, which sets the week's takings. The Fixer rolls Streetwise to steer patients her way, a complementary check that adds +1 and uses no slot. When a gang comes for protection money, the response uses the slot that week: the Fixer answers with Persuasion, and the surgery waits. Draws split 55/45.
3. **Registering (stage 1, two slots).** Neither partner has Bureaucracy, so the Fixer rolls Persuasion at DV +2. Now both act each week: the Medtech works the shop, and the Fixer sources chrome with Operator, takes a bank loan for a second chair (an expansion project), and brings in a Solo character as an investor, admitted unanimously, buying new units at book value.
4. **Chartering (stage 2).** The clinic's net assets go toward the capital quote, and the units become restricted shares, the Solo included. The Fixer rolls the business plan (Business, or Persuasion at DV +2). With no Accounting in the crew, they hire a good accountant for the capital structure roll, the Fixer's Operator lowering the fee. Both partners are elected officers.
5. **Listing (stage 3).** Once the requirements are met, the Fixer carries the prospectus **Trading** roll, and his Operator widens the NPC buyers for the float. The Medtech's part is the one that lifts the valuation: keeping the earnings up.

Each role keeps a clear job the whole way: the Medtech makes the money, the Fixer makes the deals. If the Medtech is flatlined along the way, the buy-out rule lets the Fixer buy her stake at book value, or it passes to whoever she named.

### 26.1 Syndicates

- **A shared account.** A syndicate is an actor flagged `syndicate` with an ordinary portfolio, so the terminal, executor, valuation and statements work unchanged. Every member sees its **holdings, positions, orders and ledger**. Members have ownership of the actor; writes still go through requests.
- **Units.** A member's deposit buys units at the current NAV (fund arithmetic), and a stake is units × NAV. Restricted shares of a private player company have no market price, so they count in the NAV at the company's valuation *V* per share (§26.4a), updated at each monthly report. Withdrawals are pro rata, by vote or by redemption request, with the usual delays. Fees (founder's cut, management fee) are GM-tunable sinks.
- **Roles and rules.** Founder, officer, member. Each syndicate picks an approval rule per action type (any officer, majority of officers, majority of units) for trades above a size, withdrawals, admission and removal, rule changes and dissolution. Proposals have a game-day deadline and are voted on in the terminal. The GM can force or veto.
- **Broker and treasurer.** One assigned broker. A designated treasurer's Accounting skill sets terms, or "best member's" if the syndicate prefers.
- **Heat is collective.** A rumour sent to one member is knowledge for all (`tipped`). Same-day orders by members add up for the size factor, so splitting trades does not avoid heat. Penalties land on the account, and the GM may pass them to members.
- **Later:** optional market impact for large pooled orders, and coordinated campaigns using Trading and Bribery rolls.

### 26.2 Forming a player company

A company can be chartered from scratch or by growing a registered business (§26.0); the steps are the same, and a growing business brings its track record and its net assets (§26.2a).

1. **Draft a charter:** name, ticker, sector, authorised capital, founders and their stakes (characters or a syndicate), and whether a listing is intended (a note only: listing must be earned, §26.4a).
2. **Pay the filing fee** (scaled by sector and authorised capital). It is spent on the attempt whether or not it succeeds.
3. **Three skill rolls**, each made by a founder on their own client when they choose to press Roll (see the roll rule above), against a DV set by sector and size. Each slot stays open until it is rolled, and any founder can take it:

   | Roll | Skill | Covers |
   |---|---|---|
   | Business plan | Business | the concept, market and management |
   | Registration | Bureaucracy | licences, permits, jurisdiction |
   | Capital structure | Accounting | books, share structure, filings |

   Founders can share the three rolls between them. Help from the rest of the crew uses the complementary skill rule (+1, see the player levers above), not a separate bonus.
4. **Outcome.** Only the **capital structure (Accounting)** roll must pass for the charter to proceed: a failure there costs the fee and sets a **refiling delay** (default 7 game days), and a fumble adds to the delay. A failed **business plan** or **registration** roll is a setback, not a refusal: the company starts weaker (see below), and a failed registration adds a delay of 3 game days and a surcharge on the fee. Rolls that passed are kept for 30 game days and the retry fee is lower. Requiring all three to pass would refuse most ordinary crews: a character with stat 6 and skill 4 passes DV 15 about 60% of the time, so all three pass only about 22% of the time. A passed Accounting roll sets the **capital quote** (§26.2a).
5. **GM approval.** The GM reviews the charter, the rolls and the quote, and may edit the terms, approve or reject (a rejection can refund the fee, by setting).
6. **Fund it.** Players deposit the quoted starting capital into the company account within the funding window (§26.2a). Nothing is formed until it is fully funded.
7. **Signed.** The company is formed as **private**, with a cap table made of restricted shares in the contributors' portfolios.

**Starting state.** Each charter roll's outcome band (see the player levers) sets where the company starts, so the rolls matter from day one rather than months later at a listing:

| Roll | Sets |
|---|---|
| Business plan (Business) | starting Reputation and Revenue run-rate |
| Registration (Bureaucracy) | starting Compliance |
| Capital structure (Accounting) | the capital quote (§26.2a) |

A failed business plan or registration starts that part of the state below the sector baseline; an exceptional one starts it above. The IPO price, if the company ever lists, comes from the prospectus rolls at that time (§26.4a), not from the charter.

### 26.2a Starting capital

A company cannot be formed on paper alone. The founders must put real eb in, and how much depends on how well the **capital structure (Accounting) roll** went.

**The range.** Each sector and size tier has a GM-tunable **minimum** *Kmin* and **maximum** *Kmax* (suggested defaults below). The quote from a passed roll is always within it, so no roll can make a company free or unaffordable. Only the fumble penalty goes above Kmax.

| Size tier | Authorised capital | Kmin | Kmax |
|---|---|---|---|
| Startup | up to 25,000 | 5,000 | 12,000 |
| Small | up to 100,000 | 20,000 | 50,000 |
| Established | up to 400,000 | 75,000 | 200,000 |

Sector multiplier on both (GM table): Media and retail 0.8, tech and services 1.0, security and arms 1.3, biotech and energy 1.5.

**The quote.** With *margin* = the Accounting total minus its DV (a critical success adds 4):

quote = Kmax − (Kmax − Kmin) × clamp(margin / 8, 0, 1), rounded to the nearest 100 eb.

For a Small company this gives:

| Accounting outcome | Margin | Starting capital |
|---|---|---|
| Fumble, or any failed roll | none | **No company.** The fee is lost and a refiling delay starts. A fumble doubles the delay, and the refiled quote is Kmax plus 10% |
| Narrow pass | 0 to 1 | about 46,000 to 50,000 (near Kmax) |
| Solid pass | 2 to 5 | about 31,000 to 42,500 |
| Strong pass | 6 to 7 | about 24,000 to 27,500 |
| Excellent or critical | 8 or more | 20,000 (Kmin) |

A failed roll always refuses the charter, with no exceptions and no GM override for near misses.

**Funding.**
1. **A funding window** opens when the GM approves the charter: 14 game days by default (two operating periods), which the GM can extend. The quote is fixed for the window, whatever the market does.
2. **One or more contributors.** Any founder (or a syndicate, by its own approval rule) can deposit from their **brokerage balance** to the company account with a Deposit action. Each contribution is a normal request through the executor and posts a `capital` ledger entry. They are not a CPR wealth transfer.
3. **Escrow.** Deposits are held until the quote is met. If the window lapses or the GM cancels the charter, every contribution is refunded in full (the filing fee is not).
4. **Shares follow money.** Founding shares are issued at par in proportion to what each contributor put in, so the cap table is a record of who paid. The charter may reserve a **sweat equity** slice (default 0%, GM cap 10%) for the founders who made the rolls.
5. **Extra is allowed**, up to 50% over the quote, and becomes opening cash. It buys shares like any other contribution.
6. **Formation.** When the total reaches the quote, the company is formed and the escrow becomes its capital.

**Afterwards.** Founding capital is the company's money, not the players'. It cannot be withdrawn, only paid out as capped dividends (§26.7) or bought back, and a lock-in (default 28 game days) stops a company being formed and drained straight away. Fees and the lock-in are the sinks that stop a quick eb machine.

**Growing into a charter.** A growing business charters at the tier that fits its size, usually **Startup**: the business simulator (B0) showed that a registered business's net assets and its owners' savings rarely reach a Small quote, while they largely cover a Startup one. When a registered business is chartered (§26.0), its **net assets** (the till, gear and completed expansions, at book value, less debts) count toward the capital quote, so the owners pay in only the difference. Its units convert one-for-one into restricted shares, so partners and investors keep their stakes on the company's cap table. Earned capital is not new money, so the lock-in on valuation (§26.4a) does not apply to it; only cash newly paid in waits. This is what makes growing the cheaper path to a large company.

**Interaction with the other rolls.** The Business and Bureaucracy margins do not change the quote; they set the starting Reputation, Revenue and Compliance (§26.2). A founder with a poor Accounting skill can improve the quote by having a better accountant make the roll, since any founder may take the slot, and by spending Luck or using a complementary bonus on it.

### 26.3 Ownership and control

- **Cap table.** Shares are ordinary lots in portfolios (`assetId` = the company). While the company is private they are flagged `restricted`: they cannot be sold on the market, only transferred privately (GM approval optional). A listing opens the float and lifts the restriction on the shares sold.
- **Holders** can be characters, syndicates, the broker's nominee account, or the company's own treasury. A founder can be an individual or a syndicate, so a company can be owned collectively either way.
- **Control.** Holders of more than half the votes control the company. Officers are elected by shareholders weighted by shares. Only officers may take business actions, and the officer who chooses an action rolls it.
- **Takeovers and dilution.** Building a controlling stake transfers control, with GM approval. New issues, buybacks and delistings use the existing corporate actions.

### 26.4 Business activity

- **Stage.** This loop is for chartered companies (stage 2 and up). Side and registered businesses use the simpler loop in §26.0, and a business keeps its state (Reputation, Capacity, Cost base and so on) when it steps up.
- **State.** Visible to officers: Capital, Revenue run-rate, Cost base, Reputation, Compliance, Operating capacity. Hidden: **Exposure**, which comes from shortcuts and aggressive reporting, like heat.
- **Cycle: weekly operating period, monthly report.**
  - **Weekly period.** One period is 7 game days, anchored to a GM-chosen weekday (default: the day of the weekly session) and run on the game-day clock, so the first tick on or after the boundary closes it. Catch-up after a calendar jump closes each missed period in order, up to a cap.
  - **What closes a week.** Outcome = state + the sector's backdrop + the actions the officers rolled that week + the GM-editable event tables. It updates the business state and is **private to officers** as a short weekly digest in the terminal. It does not move the share price.
  - **Monthly report.** On the in-world month boundary (the same rule as statements and monthly dividends; every 28 game days if there is no calendar), the company publishes a report that sums the weeks closed in that month (four or five). The result is a headline and an **earnings impact** on fair value (the surprise against expectations), with delay and decay. Dividends follow the report, still capped (§26.7).
  - **Actions per week.** The **company** has a number of action slots each operating period, set by its Operating capacity (default 2 for a startup, 3 for a small company, 4 for an established one; a GM setting). The officers decide together who takes each slot and rolls, so the question is who is best at the job, and adding officers does not add actions. Costs are paid from company capital. The slots reset when a period closes. Complementary checks (the player levers) do not use a slot.
  - **Report preparation.** In the last week of the month an officer may roll Accounting to prepare the report. No roll means standard reporting: no bonus and no risk. Aggressive reporting is the Bold approach: a bigger surprise now and more Exposure later. The roll's total is stored, and a later regulator audit of that report is an opposed check against it (§26.6).
  - **Event responses.** When the weekly event draw produces an event (a strike, a supply shortage, a PR crisis, a rival's move), officers get a prompt in the terminal before the week closes, naming the skills that can answer it (for example Persuasion to calm the union, Business to find a new supplier, Bureaucracy to contest a fine). A response uses an action slot and is an ordinary player-triggered roll. If nobody responds, the event's default outcome applies, so not rolling stays a valid choice.
  - **Neglect.** With no actions in a period, reputation, compliance and capacity drift slightly toward the sector baseline. The drift is small and GM-tunable (it can be set to zero).
- **Skill actions** (a player-triggered roll with DV, cost and a weekly allowance):

  | Skill | Action | On success | On fumble |
  |---|---|---|---|
  | Business | chase contracts, expand, restructure | revenue and reputation up | costs up, a client lost |
  | Accounting | tighten the books, plan tax, prepare filings | margin up; reporting safer | audit finding, restatement |
  | Trading | investor relations, raise capital, time a buyback | sentiment and capital in | failed raise, a dip |
  | Bureaucracy | permits, compliance, licences | unlocks steps, less regulatory drag | delay, fine |
  | Bribery | shortcuts and rivals | large, fast gain | Exposure up, scandal, NCPD interest |

  The outcome band scales the effect (a critical is Exceptional). Reporting integrity is an Accounting roll: aggressive reporting lifts the stock now and raises audit risk later. Bribery against a person (an official, a rival's employee) is opposed by that person's skill from a GM table rather than a fixed DV.
- **Alternative skills.** Business, Bureaucracy and Accounting are mostly Exec and Fixer skills, so each action also accepts a related skill at DV +2, and a crew without those roles can still run a company:

  | Action | Alternatives at DV +2 |
  |---|---|
  | Business: chase contracts | Persuasion, Trading |
  | Bureaucracy: permits | Local Expert, Persuasion |
  | Accounting: tighten the books | Business |
  | Trading: investor relations | Persuasion, Wardrobe & Style |
  | Bribery: shortcuts | Streetwise |

- **Role abilities.** Each role's special ability gives the company something only that character can do. An action using a role ability takes a slot and is rolled with the ability's rank as the rules describe:

  | Role | Ability | In a player company |
  |---|---|---|
  | Exec | Teamwork | the Exec's team works for the company: one extra action slot each period, or Rank/2 added to a Business roll |
  | Fixer | Operator | better deals: lower fees and capital quote, an easier capital raise, more NPC buyers for a thin stock (§26.7) |
  | Media | Credibility | plant a story: Reputation up, a bad report softened, or a rival smeared, through the news feed |
  | Netrunner | Interface | corporate espionage: reveal a rival's Exposure band or one of its ownership layers (§26.6) |
  | Rockerboy | Charismatic Impact | an endorsement: a Reputation and sales boost, strongest for media and retail |
  | Tech | Maker | product development: Operating capacity or Revenue up |
  | Nomad | Moto | logistics: the Cost base down |
  | Lawman | Backup | a friend on the force: an NCPD audit or penalty softened |
  | Solo, Medtech | — | security and staff care: a defence roll against sabotage and accident events |

- **Information rolls.** Some rolls reveal rather than change, so hidden state can be found by playing:
  - **Internal audit** (Accounting): reveals the company's own Exposure band, and on a Strong or Exceptional result reduces it, at a cost from capital.
  - **Due diligence** (Library Search or Business): reveals a rival company's business state bands, or a private company's valuation range before a deal.
  - **Read the room** (Human Perception): before a negotiation or a vote, reveals whether the counterparty is bluffing; succeeding gives the complementary +1 to the negotiating roll.
  - **Street talk** (Streetwise): surfaces a market rumour about a sector or company.
- **Insider windows.** An owner trading before their own results is the strongest heat case. Officers see weekly digests, so for them the window opens at the first weekly close of the month, with weight rising each week, and ends at publication. Other holders get the usual window from the final weekly close to publication (default 2 game days, a GM setting). Both run on the existing engine.

### 26.4a Going public: listing eligibility

A player company stays **private** until it has earned a listing. The Draft charter's "listing intended" box only records intent. It never opens the IPO flow (§19, `IpoService`) by itself.

**Valuation.** A private company has no share price, so the engine computes a **market valuation** *V* from its business state. Players cannot set it, and it is recalculated at every monthly report:

*V* = (net assets + capital) + (annualised net profit of the last 3 monthly reports × the sector earnings multiple)

- Net profit is clamped at zero, so a loss-making company is valued on assets alone.
- The sector multiple is a GM table (default 6 to 14).
- Capital that was put in recently does not count at once: new founding or extra capital joins *V* only after the lock-in (§26.2a), so paying in a lump sum does not buy a listing. The same goes for any later capital raise.
- The GM can apply a one-off valuation adjustment with a reason, and it is logged.

**Requirements.** A company can apply when all of these hold:

| Requirement | Default |
|---|---|
| Valuation | *V* at or above the **listing threshold** of 500,000 eb (above the top charter tier, GM-tunable) |
| Sustained | at or above it on 3 consecutive monthly reports (a single spike does not count) |
| Track record | at least 3 published monthly reports and 56 game days since formation |
| Compliance | at or above the GM's minimum, with no open audit finding |
| Exposure | hidden Exposure below its cap. The checklist shows this as "unresolved compliance concerns" without the number; an internal audit (§26.4) reveals the band and can bring it down |
| Float | the founders agree to float at least 20% of the shares, and to keep a 28-day lock-up on the rest |

**The steps.**
1. **Eligibility is shown, not rolled.** Officers see a checklist of the requirements and their current standing. Nothing in it is a roll.
2. **Apply for listing.** An officer pays a listing fee (a percentage of *V*, a sink) and the GM approves.
3. **Prospectus rolls, player-triggered.** An officer rolls Accounting (the filing) and Trading (the offering), with the usual levers (Luck, complementary bonus, approach). A pass is required for each. A failure costs the fee and a refiling delay (default 14 game days).
4. **Offering price and float.** Price = *V* per share × a prospectus factor from the two rolls' outcome bands (about ±15%, so market reality dominates; a Bold offering widens it). The float size is capped by NPC demand (§26.7), which the Trading roll's band also sets.
5. **IPO flow.** The company then runs through the standard announced IPO and subscription window. The first price comes from that offering, and its first day of trading starts the usual price model.

**After listing.** *V* is replaced by the market price. A **delisting review** applies hysteresis: a market capitalisation under 60% of the threshold for 3 consecutive reports (a GM setting) puts the company under review, and the GM can delist it or give it time. A company that fails the requirements after applying simply does not proceed, with no penalty beyond the fee.

**Not eligible is a normal state.** Until then the company trades in private only (§26.3), with its restricted shares, and gets the full business loop. Listing is a milestone, not a requirement.

### 26.5 Gigs for a player's own company

When a gig run by players names a player business or company as its **client** (at any stage, §26.0), it is a **business activity**, not a market rumour:
- `resolveClient` matches the player company as it does any client, but the outcome is applied to the company's **business state** (reputation and revenue up on success, down on failure, scaled by reward and capped) instead of as a direct price impact. The company acquiring assets, contracts or goodwill is outside NCI and is handled in play.
- The reward itself is paid or not by Night City Map as usual; NCI does not turn it into company cash.
- The price follows only through the next report, so the usual delay applies. GM approval is on by default, with monthly caps and diminishing returns to stop self-dealing.
- The players who ran it are the **gig runners**, which is exactly what heat stage H4 was reserved for (weight 1.5), so an owner trading around their own gig draws the most heat.
- A gig for a **rival** company as client works the same way, and a GM can use it for storylines.

### 26.6 Hidden ownership

Yes, with layers and costs, so concealment is a game and not a switch.
- **Layers.** (a) **Nominee through a broker:** the shares are held in the broker's nominee account and the public register shows the broker. (b) **A syndicate:** the register shows its name, and the member list is visible to members only. (c) **A syndicate holding a syndicate:** a chain, with each layer costing fees and a Bureaucracy or Accounting roll. Control rights still work through a nominee.
- **Rules that make it risky.** There is a disclosure threshold (default 5% of a listed company). Staying hidden above it is concealment, which adds Exposure and heat, and it fails if the regulator looks. A concealed holder trading around company events has a heat multiplier.
- **Uncovering.** Building a layer is a roll by its owner (Bureaucracy or Accounting), and its total is stored with the layer. Other players can investigate with a downtime-driven Library Search, Streetwise or Bribery roll, or a Netrunner's Interface (§26.4), started and rolled by the investigator. It is an **opposed** check: the investigator must beat the stored total of the layer they are trying to see through, plus 2 for each layer above it, so a well-built shell stays hard to crack and a careless one does not. A regulator's audit is decided by the engine or GM, not by a player roll; where it tests a report, it is opposed by that report's stored preparation total (§26.4). Brokers and syndicate members can leak by chance (engine), or be bribed by a player who chooses to roll Bribery. A takeover or an audit can unmask.
- **Where the truth lives.** The real holder is always in the GM-readable portfolio. Players' clients never receive other portfolios, and the register players see is computed by the GM and published as a public setting containing only what is disclosed.

### 26.7 Capped payouts

- **Dividends** = min(declared, profit-based, a GM sector ceiling × company size, a per-holder monthly eb cap). The excess stays in the company as capital, and its effect on the price is itself capped.
- **Sinks:** filing and registration fees, the listing fee, a withholding rate on dividends, broker commissions.
- **IPO proceeds:** a new issue raises company capital, not player cash. A sale of founders' shares pays real eb only as far as buyers exist; NPC demand per IPO is capped.
- **Liquidity:** a player company has limited depth. The market's usual infinite liquidity is replaced by a per-game-day NPC absorption cap sized by float and the offering's Trading band (raised by a Fixer's Operator, §26.4), with market impact on, so a thin stock cannot be used as an eb machine.

### 26.8 Downtime with Crew Tools, bridge only

Crew Tools exposes `api.downtime` (`getState`, `use`, `startNextSession`), `api.calendar`, `api.headquarters`, `discoverPlayerAccounts` and `appendPayoutRecord`, but no completion hook and no way to register an activity.
- A **bridge module** (like the Night City Map ones) adds a **Company Work** panel. Choosing an activity spends days through `downtime.use` as a free-form spend with a recognisable description, then sends NCI a request carrying the resulting event.
- NCI's executor **verifies** the event in the character's downtime log (read-only) before it applies the action, and uses its id to stay idempotent. The player presses Roll for the action; the executor never rolls for them.
- A week of downtime lines up with a weekly operating period, and Crew Tools expires unspent days at "Start Next Session", so unspent company days lapse with the session. A company action is allowed only in the period it was started in.
- **Projects with a day requirement and slots** are tracked by NCI itself, since Crew Tools cannot host them: each spend adds progress.
- **Crew help:** other characters spending days on the same project add progress and a capped bonus.
- **Without Crew Tools**, a native allowance (a few business days per game week) takes its place.
- **The spike** (B0, §26.9) answered from the Crew Tools source: `use` takes positional arguments and returns no event id, so the bridge tags the event through `projectId`; a player's client may call it; events are kept on the character's Downtime Log page. Still to run in the test world.
- **Other links, read-only:** rent and lifestyle as company overhead, HQ improvements as capacity, faction reputation as a bias on company reputation, `appendPayoutRecord` for dividends if you want one ledger.

### 26.8a The Business window, separate from the market

Running a business is a different activity from trading shares, so it has its own window, the **Business window**, and the Market Terminal stays the stock market. A private business never appears in the market at all; the two windows meet only where a business touches the market: its owners' holdings, a listing, and a listed company's own page.

**Opening it.** A Business button beside the market buttons in the Token Controls, a keybinding (unbound by default, like the others), a starter macro, and, through the map bridge, the business's place on Night City Map. A player sees only the businesses their characters hold units or shares in, with a picker when there are several; anyone else's private business is invisible to them. A character with none sees **Start a business**, which opens the founding flow.

**Tabs**, following the business loop (§26.0, §26.4):

| Tab | Shows | Actions |
|---|---|---|
| Overview | stage, archetype, location, the state as bands (Reputation, Capacity, Cost base, Compliance), the till, the next step-up's checklist | |
| This week | the operating period: action slots and who has taken each, complementary bonuses waiting, event prompts with their deadline | take a slot and roll (with the dialog's preview and levers, §26), make a complementary check, answer an event |
| Ledger | takings, costs, draws, loan payments, and each period's digest; monthly ledgers or reports from stage 1 | draw, take or repay a loan |
| Partners | the cap table (units, or shares from stage 2) and the founding agreement; officers from stage 2 | propose and vote (admit an investor, change the agreement, elect officers), buy out a stake, transfer units privately |
| Projects | expansion projects and their progress, including crew days from downtime (§26.8) | start, fund or add days to a project |
| Growth | the step-up checklist and, from stage 2, the listing checklist (§26.4a) | step up, apply for a listing, make the prospectus rolls |

Everything a player does here is a request through the executor, like the terminal's, and every roll is player-triggered (§26).

**Where it links into the market.**
- **Private holdings in the portfolio.** The terminal's Portfolio tab lists a character's stakes in private businesses in their own section, valued at book value (stages 0 and 1) or *V* (stage 2, §26.4a), read-only and clearly marked as not tradable, each with **Manage in Business window**. They count toward the portfolio's value and statements but cannot be ordered on the market.
- **Applying for a listing.** When the Growth tab's listing checklist is complete, officers apply there, pay the listing fee and make the prospectus rolls (§26.4a). On the GM's approval, NCI creates the company's market entry from the business record (name, ticker, sector, description, offer price, float) and runs the standard announced IPO (§19): it appears in the terminal's upcoming IPOs, and any character, including other players, subscribes there as for any IPO. Until then the market knows nothing about the business.
- **Once listed.** The terminal's company page shows **Manage company** to the company's officers, opening the Business window on it, and the Business window's Overview shows **View on market**, opening the terminal at the company's page. Founders' shares stay restricted through the lock-up, then trade like any shares, from the terminal.
- **Delisting** (§26.4a) removes the market entry; the company stays in the Business window as a private company.

**The GM's side.** A **Businesses** tab in the GM Console lists every business at every stage, with its true state (Exposure included) and owners, and holds what needs the GM: setups and step-ups awaiting approval (by setting), charters, listing applications, loan reviews, event draws, buy-outs and disputes. The GM can open any business in the Business window to see it as its owners do.

**Data.** Business records live apart from the market's: the player-visible part in a per-business document its owners can read, and the hidden part (Exposure, NPC investors' skills, the stored totals for opposed rolls) in the GM-only control journal, as the market's hidden state is (§4). The market's company list gains an entry only when a listing is approved.

### 26.9 Development phases

The work is split into phases that each end with something usable at the table. Syndicates are not first: small businesses are where most players will start, so the first playable phase is a side business. Syndicates do not depend on businesses and run as a parallel track, joining up when a syndicate owns or invests in one. The phases are labelled B0 to B7 in the roadmap (§14).

**Before B0:** the work already done was released as **v0.9.7** (§27 and §28, and the gig runners for heat, H4), so the phases start from a released, tested base.

| Phase | Version | Playable outcome |
|---|---|---|
| B0 Groundwork | none | nothing for players; the questions below are answered |
| B1 Side businesses | v0.10 | the Medtech and Fixer open the clinic and earn from it |
| B2 Growing | v0.11 | the clinic registers, takes a loan, opens a second chair and brings in an investor |
| B3 Syndicates (parallel) | v0.12 | a crew pools money and trades as one account |
| B4 Chartered companies | v0.13 | the clinic becomes a company with officers and monthly reports |
| B5 Going public | v0.14 | an IPO other players subscribe to in the terminal |
| B6 Corporate play | v0.15 | takeovers, buybacks, hidden owners and investigations |
| B7 Downtime bridge (separate module) | after B2 | company work spends Crew Tools downtime |

**B0 Groundwork.**
- **Crew Tools spike** (§26.8): the signature of `downtime.use`, whether it returns an event id, whether a player client may call it, and how free-form events appear. The B7 design depends on it.
- **Business growth simulator:** extend `tools/simulate.mjs` to run a business over many operating periods, check the target of 30 to 40 periods from side business to listing eligibility (§26.0), and tune the profit bands before any of it ships.
- **Storage:** one document per business that its owners can read, with hidden fields in the control journal (§26.8a); the schema version and migration path.

**B0 findings.**
- **Business simulator.** `tools/business-model.mjs` is a prototype of the business loop (stages, the weekly actions with the rulebook d10 and outcome bands, complementary checks, events, the till, draws, expansions, registration, the charter's capital quote, the listing checklist and *V*), run by `npm run simulate:business` (`tools/simulate-business.mjs`) for a strong, an average and a weak crew over many seeds, with node tests (`tests/businessModel.test.mjs`). B1 builds the engine from it, and its values are B1's starting point. It leaves out loans, investors, role-ability actions, Luck and alternative skills, which all speed growth, so play should run a little faster than it.
- **Results at growth rate 1** (periods to reach each stage, median):

  | Crew | Registered | Chartered | Eligible to list | Closed |
  |---|---|---|---|---|
  | Strong | 7 | 32 | 52 | 0% |
  | Average | 11 | 53 | 80 | 3% |
  | Weak | 26 | 95 (55% get there) | 14% within 120 periods | 7% |

  Weekly profit when leaving each stage stays inside the §26.0 bands (about 136 eb leaving the side business, 570 eb leaving the registered stage).
- **Design changes from it.** The growth target in §26.0 is replaced by these measured figures and the floor of about 28 periods. A growing business charters at the Startup tier (§26.2a): with the Small tier, even a strong crew took about 85 periods to fund its charter.
- **Calibrated starting values** for B1 (all GM-tunable): one, two and three action slots by stage; expansions costing 1,500, 2,500 and 8,000 eb for +0.25, +0.8 and +1.5 Capacity; Capacity ceilings of 1.6, 4.5 and 14; fix-up gains scaled ×1, ×6 and ×14 by stage; an event in a quarter of periods.
- **Storage.** A business is a JournalEntry in its own folder, like a company, but private: default ownership None, and Observer for the users of its partners' characters, so they read it and nothing else does. Its player-visible record (archetype, location, state bands, till, ledger, founding agreement, projects) is a flag on it, saved in the one-write wrapped form (§28). Its hidden part (Exposure, stored totals for opposed rolls, NPC investors' skills) is keyed by business id in the GM-only control journal. Partners' units are lots in their portfolios, as restricted shares are (§26.3). Each record carries its own `schema` number, and changes go through the existing migration steps (§23).
- **Crew Tools spike: answered from the source** (Pneuma's Crew Tools v1.0.10, Foundry v12, read from the built `scripts/pneuma-crewtools.js`; not yet run in the test world, where Crew Tools is not installed). The four questions in §26.8:
  - **Signature.** `game.modules.get("pneuma-crewtools").api.downtime.use(days, kind, reason, actorId = game.user.character.id, extra = {})`, with positional arguments. For company work `kind` is `"spend"` (the other kinds it accepts, `rest`, `crafting` and `hustle`, carry their own rules). `days` is a positive whole number no larger than the character's unspent balance, and `reason` is 1 to 500 characters, trimmed. Of `extra`, only `projectId` and `roleItemId` are kept on the event; a `requestId` passed there is ignored, since Crew Tools makes its own.
  - **No event id comes back.** `use` resolves to `undefined`. The event it records is `{ id, requestId, actorId, kind, days, period, date, reason, projectId, roleItemId }`, with `id` and `requestId` both generated inside Crew Tools. So that NCI can find it again, the bridge puts NCI's request key in `projectId`. Crew Tools reads `projectId` only on TECH events and stores it as given on a spend.
  - **A player's client may call it.** It checks that the user owns the actor (or is a GM) and writes straight to the character's journal "Crew Tools — *name*", which Crew Tools gives Owner permission to the actor's owners. There is no GM relay: Crew Tools' socket is only a lock between clients. A GM must have opened Downtime once to prepare that journal, or `use` throws, and one day stays reserved while a Medtech workday is open. `startNextSession` is first-active-GM only; it records the unspent days as an `expire` event and moves `period` on by one.
  - **Where free-form events appear.** On the character journal's **Downtime Log** page: `flags.pneuma-crewtools.downtime.events`, in the same shape as the Crew Tools ledger (`version`, `period`, `accounts`, `events`), with `downtimeBalance` beside it and the event as a row in the page's table (the reason as text). `api.downtime.getState(actorId)` returns the same events, merged, and a player can call it. Crew Tools calls no hook of its own when downtime changes; the page's `updateJournalEntryPage` is the only signal.
- **What this means for B7** (§26.8, otherwise unchanged). The bridge calls `use(days, "spend", "NCI · <business> · <action>", actorId, { projectId: <NCI request key> })` on the player's client, then reads the Downtime Log for the event with that `projectId` and sends NCI its `id`. NCI's executor re-reads the page and checks that the event exists, belongs to that actor, is a `spend` of the claimed days in the current `period`, and that its id has not been used. The trust limit is the one the roll cards already have (§26): the player owns the page and could edit it, so the GM's view of the Downtime Log is the check.

**B1 Side businesses (v0.10).**
- **Roll levers** in `SkillAdapter` (§26): the roll dialog with the DV preview, approach, Luck, the complementary bonus (role abilities included) and hired professionals; outcome bands and the DV ladder; the executor's checks for Luck and stored bonuses. Every later phase uses them.
- **The Business window** (§26.8a): Overview, This week, Ledger and Partners tabs, and the Start a business flow; the GM Console's Businesses tab, with approvals and each business's true state.
- **Ownership** (§26.0): partnership units, and the founding agreement with sweat equity, decision rule and buy-out rule.
- **Archetypes:** four to start (ripperdoc clinic, garage, bar, info shop) and the setup roll.
- **The weekly loop:** the five actions, the till, upkeep, capped owner draws, neglect drift, and failure and closure.

**B2 Growing (v0.11).**
- Weekly events and event responses.
- Fixer loans; registration as the first step up (stage 1, two action slots); bank loans; private investors (players, and NPC angels through an opposed roll).
- Expansion projects; the Projects and Growth tabs with the step-up checklist.
- Private holdings, read-only, in the terminal's Portfolio tab (§26.8a).
- Location: district foot traffic and risk.
- Role abilities as business actions.
- Gigs for a player's own business (§26.5); the runners already come from the bridge.
- The remaining six archetypes.

**B3 Syndicates (v0.12, alongside B1 and B2).**
- The syndicate account (§26.1): units and NAV, roles, proposals and votes with deadlines, the broker and treasurer, and collective heat.
- Integration: a syndicate as a business partner or owner, with private stakes valued at book value or *V* in its NAV.

**B4 Chartered companies (v0.13).**
- The charter (§26.2, §26.2a): three rolls with the graded outcome, the starting state, the capital quote, the funding window and escrow, net assets credited for a growing business, and units converting to restricted shares.
- The company loop (§26.4): action slots by capacity, the five skill actions with alternative skills, report preparation (Bold reporting included), private monthly reports, Compliance and Exposure.
- Information rolls: internal audit and due diligence.
- Officers, elections and control (§26.3).

**B5 Going public (v0.14).**
- The valuation *V*, the listing checklist, the listing application and the prospectus rolls (§26.4a).
- On approval, the company's market entry and the standard IPO flow.
- Earnings impacts on fair value, capped dividends and the liquidity cap (§26.7), insider windows for officers (§26.4), and the delisting review.
- The links between the Business window and the terminal: Manage company and View on market (§26.8a).

**B6 Corporate play (v0.15).**
- Takeovers, dilution, buybacks and insolvency for companies.
- Hidden ownership (§26.6): nominees, syndicate chains, the disclosure threshold, opposed investigations, and Netrunner espionage.
- Coordinated syndicate campaigns.

**B7 Downtime bridge (a separate module, any time after B2).**
- Company Work through Crew Tools downtime (§26.8): extra time (+1), crew days on projects, and the expiry rules. Until it ships, B2's native allowance of business days stands in.
- Businesses shown on Night City Map through the map bridge.

**Every phase finishes the same way:** node tests for the pure parts and flow tests against the fake Foundry, as the existing suite does; a schema migration if stored data changes; a run in the test world before release; and, from B1, a simulator check against the growth target.

## 27. After-tick order and dividend records (v0.9.7)

- **One after-tick sequence** (`init/registerTickSequence.js`). What the active GM runs after a market tick used to hang off three `priceTick` listeners in the market, portfolio and broker registrars, all started at once and none awaited. It is now one list, run in order with each step awaited: IPO listings, automatic splits, dividends, fund distributions, gig headlines, orders (with alerts and withdrawals), the heat audit, notifications, statements. Each tick's sequence waits for the previous one, and a failing step is logged without stopping the rest. Corporate events come first so orders are worked against the listings and splits as they now stand.
- **Dividend records are changed through `MarketStore.updateDividendRecords(fn)`**, which applies `fn` to a fresh read inside a queue. The dividend service used to write back, at the end of its check, a copy it had read at the start, which could erase a fund distribution recorded meanwhile; the fund's distribution was then announced again on the next tick. `settlementDistributionsFlow.test.mjs` covers the case.

## 28. Market date, price paths and cleanups (v0.9.7)

- **The market's own date** (`marketDay` in `engine/clock.js`). It is `lastDay` (the calendar day of the last tick) plus `lead`, the game days a GM has advanced the market by hand. `lead` is engine state, so undo and calendar rollback restore it. Ticks that follow the calendar leave `lead` alone and take each tick's date from the calendar (one per day in the day mode, today in the in-world clock mode); `advance`/`advanceDays` add the whole game days they cover. `MarketClock.nowMs()`, `date()` and `dateString()` now give the market's date, and only the tick service reads the calendar itself, through `MarketClock.calendarMs()`. Dividends, fund rebalances and distributions (now dated per tick inside a run), IPO dates, monthly statements and the dates on news, heat and records all follow it. Before, a manual-mode advance moved prices but nothing that fell due on a date. The Market tab is relabelled "Market date" and says when the market is ahead of the calendar or in manual mode.
- **Gig runners (H4).** `api.events.reportImpact` takes `runners`, the ids of the characters who ran the gig; the bridge (v0.2.0) sends them. See §22.
- **Price paths** (`engine/pricePath.js`). `_runTicks` records every company price and fund NAV after each tick of a run and puts the path on the `priceTick` payload. The after-tick sequence hands it to `PortfolioService.onTick`, and `runOrders` and `checkAlerts` look at the part of it while each order was live (eligible to expiry) or since each alert was set. A limit the path reached fills at the limit; a stop at its level across the spread; met at the run's end, the end price is used as before. Price alerts fire on the path's high or low and report it. Daily-move alerts still compare today's close with yesterday's.
- **One-write saves.** GM records in the control journal and portfolios on actors are stored wrapped in a one-element array, which Foundry replaces rather than merges, so a save is a single write and removed keys cannot linger. Readers accept the old unwrapped form; `MarketStore.readRecord` and `PortfolioRepository.raw` are the readers the migrations use.
- **Shared helpers.** `L` lives in `utils/helpers.js` (`ui/format.js` re-exports it); `timeOf(state)` in `engine/clock.js` replaces the `time ?? tickIndex ?? 0` fallbacks; `utils/queue.js` `SerialQueue` replaces the hand-written queues. Awaiting a queue waits for everything queued so far, so `await X._queue` keeps working.
- **GM Console split** into `ui/GMConsole/tabs/<tab>.js` (each exports `actions` and `context(app)`) and `templates/gm/console/<tab>.hbs` partials, preloaded through the part's `templates`. Only the open tab's data is built.
- **Tests renamed by feature** (`brokersFlow`, `dividendsSplits`, `windows`...). Tests move the market's date with the market (`tests/helpers/marketDate.mjs`), not with the fake calendar, and their `settle` helpers wait for the after-tick sequence.

## 29. Phase B1: side businesses (v0.10.0)

B1 as built, with the decisions made while building it. The design it follows is §26 and §26.0; what is not built yet is listed at the end.

**The roll levers** (`engine/rolls.js`, `SkillAdapter.leverCheck` and `verifyLevers`). The DV ladder, the outcome bands and the approaches as §26 has them (Careful DV −2 at three quarters of the effect, Bold DV +3 at a quarter more, with 1 Exposure). The roll dialog previews the DV, the d10 needed and each band's chance, worked out exactly over the CPR d10. A role ability rolls its rank (the `role` item's `system.rank`, matched on `system.mainRoleAbility`). A hired professional's fixed base (10, 13 or 16) replaces stat and skill and cannot take Luck; the fee (50, 150 or 400 eb) comes from the business, less 5% per rank of the best Operator among the partners, up to 40%.
- **Luck is spent on the player's own client** when they press Roll: the sheet's `system.stats.luck.value` goes down first, as the rules have it, and the card records the pool before. The GM counts the Luck only if the pool is now at least that much lower than the card says it was; otherwise the roll stands without it.
- **The +1 counts only if the business has one waiting** for that action, whatever the card claims, and it is used up by the roll.
- `verify` and `verifyLevers` share the card checks (`_readCard`): the right actor and skill, posted by an owner, recent, unused.

**Requests** go in their own outbox flag, `businessOutbox`, with the GM's receipts in `businessReceipts`, rather than in the portfolio outbox, so neither executor has to skip the other's requests. `rollSpec` makes the same checks the engine will make before the GM reads a card, so a request that would be refused does not use up the roll; with no `use` it answers what the roll may be made with, which the dialog asks.

**Storage.** As B0 settled (§26.9): one journal per business in the "NCI Businesses" folder, ownership None and Observer for the users of its partners' characters (invited ones too, so they can see the invitation; declined or departed ones are removed with `-=` keys, since Foundry merges an ownership update), the record wrapped in a one-element array, and the hidden part (`exposure`) by business id in the control journal. Records carry `schema: 1`; there was nothing earlier to migrate, so the world schema stays at 2.
- **One change from B0: the cap table is on the business record, not lots in the partners' portfolios.** The Partners tab must show every partner's stake, and players cannot read each other's portfolios. B2's private holdings in the Portfolio tab (§26.8a) will read the record, so nothing is stored twice.

**Founding.** A founder names the business, picks an archetype, puts in eddies (taken from the wallet at once and held in escrow) and gear (a name and a book value, at most 20,000 eb an item; the GM sees it on the Businesses tab), and invites up to five partners, who join with their own contributions or decline. The setup roll waits until every invitation is answered, because units are counted when it opens.
- **The setup roll** uses the archetype's trade skills, Business, the archetype's abilities, Operator or Maker, or a hired professional (paid from escrow), at DV 13. A pass sets the setup cost like the capital quote (§26.2a): the top of the archetype's range less the range times margin/8, to the nearest 50 eb. Its band sets the opening Capacity (narrow 0.85, solid 1, strong 1.1, exceptional 1.2). A failure loses a third of the archetype's lowest setup cost and waits 7 game days; a fumble loses half and waits 14. Either loss is capped at half the money held for the business, so one bad roll cannot wipe the partners out (added after a fumble in the test world took a garage's whole 400 eb).
- **Opening.** Gear counts toward the setup cost first; the cash makes up the rest, and what is left is the till. A business short of money waits until a partner puts more in. With "New businesses need GM approval" on (the default) it then waits in the Businesses tab; turning it down refunds the escrow by cash put in. Units are one per eb of cash or gear, and the sweat slice is added on top so that it is that percentage of the whole.
- A partner can take their money back out before it opens; if the last one does, it is cancelled.

**The week.** Each business's operating week ends on the weekday the "Business week ends on" setting names (Monday by default), checked against the market's date after every market tick, as the last step of the after-tick sequence. Up to 8 missed weeks are closed in order after a jump; beyond that they are skipped. A first week that began part-way through earns for the days it ran.
- A side business has one slot a week. Each action can be taken once a week, by any partner with a vote. Each partner may also make one complementary check a week for an action nobody has taken yet; a success leaves +1 for it.
- The action effects are the B0 simulator's tables, scaled by the approach and the growth rate. **Keep it safe** cuts that week's protection money (the stage's fixed costs are 7 eb rent and 8 eb protection); B2's events will give it more to do. A week nobody works the shop trades at 0.9 of the usual takings.
- Reputation drifts 3% of the way back to 50 each week and the Cost base creeps up 0.005, as in the simulator. The owners see the state as bands (Reputation poor to excellent, Capacity, Cost base), never the numbers; the GM's tab has the numbers and the Exposure.

**Money.**
- **Draws.** Each partner, voting or not, may draw up to their share of last week's profit, once a week, into their wallet. No vote is needed: a draw is capped by what the business earned, as §26.0 asks.
- **Leaving.** A partner may offer their stake (or the GM marks them as leaving, for a character who has died or left the table). For 14 game days the others may buy it at book value per unit; after that it passes to the heir they named, as units without a vote that still draw, or lapses if there is no heir, so the others' shares grow.
- **Closing** needs every partner with a vote: one refusal ends the proposal. The gear sells for half its book value and everything is paid out by units. A till below zero at the close of two weeks running closes it as failed, with the gear at a quarter.

**Windows.** The Business window and the GM's Businesses tab as §26.8a describes, without the Projects and Growth tabs (B2). It opens from a Token Controls button (hidden when businesses are off), an unbound keybinding, a starter macro and `api.openBusiness()`. Players get a notice when each of their requests is done or refused.

**Settings.** Player businesses on or off (on), GM approval of new businesses (on), the weekday the week ends on (Monday), and the growth rate (1, from 0.5 to 2).

**Simulator check.** Run through the same strong, average and weak crews, B1's engine earns what the B0 prototype does at stage 0 when the prototype's events are off: 118, 92 and 71 eb a week on average over the first four weeks, against 123, 92 and 72 (the strong crew's prototype business has bought an expansion by then). With the prototype's events on, B1 earns about 10% more, until B2 adds them.

**Not built yet** (B2 unless noted): weekly events and event responses; registration and the later stages; loans and investors; expansion projects and the Projects and Growth tabs; location effects (the location is a note for now); role abilities as actions (they can be used for the setup roll and complementary checks); the six other archetypes; extra time from downtime (B7); private holdings in the Portfolio tab.

**Tested in the test world** (Foundry 12.343, Cyberpunk RED Core v0.92.4) before release: founding, invitations and joining, the setup roll (a real fumble included), GM approval, complementary checks, an action with Luck and the +1 on a real sheet, the weekly close and catch-up over a 14-day jump, draws, a refused close vote, leaving, a buy-out and closing; a business journal reaching only its partners' players. It found and fixed: the roll dialog failing to open (`title` is read-only on ApplicationV2), qualified skills such as Local Expert (Your Home) reading as 0, a lone owner helping themselves with the action's own skill, abilities at rank 0 in the dialog, a stale "no GM online" warning, a fumble taking the whole escrow (now capped at half), and a closed business reappearing for partners who had sold out. Not tried live: failure after two losing weeks, and a stake passing to an heir or lapsing (both covered by tests).

## 30. Phase B2: growing (v0.11.0)

B2 as built, with the decisions made while building it. The design it follows is §26.0, §26.4 (events) and §26.5 (gigs). The engine is now split into `businessRecord.js` (the record and its readers), `business.js` (requests, proposals and the week), `businessGrowth.js`, `businessEvents.js` and `businessFinance.js`.

**Proposals.** One `propose` request covers every decision, each kind with its rule (`PROPOSAL_RULES`): closing, stepping up, an investor and an angel need every partner with a vote; an expansion, a fixer's loan and going to a bank need a majority of the voting units (more than half to pass; it fails once half or more say no). A proposal takes effect the moment it passes, and lapses after 7 game days. `proposeClose` stays as an alias. One proposal of each kind may be open at a time.

**Business days and extra time.** Without Crew Tools (§26.8), each partner with a vote has 3 business days a week, which lapse when the week closes. They pay for expansion work and for **extra time**: one day for +1 on a roll, a new lever in the roll dialog, which the GM counts only if the character has a day left.

**Stage 1, the registered business.** Two action slots at DV 15, a Capacity ceiling of 4.5, fix-ups scaled ×6, rent 25 and licence fees 10 a week in place of most of the protection money (5), and a Compliance standing that starts from the registration roll's band (45 to 60) and drifts back to 50 like Reputation. Inspections come only to registered businesses.
- **Registering.** The checklist (four full weeks open, an average of 100 eb a week over the last four, counting a short first week at its weekly rate, Reputation 45, and the 500 eb fee in the till), then every partner's agreement, then the registration roll: Bureaucracy at DV 15, or Local Expert or Persuasion at DV +2 (each use can now carry its own DV step, shown in the dialog). The fee is paid whatever the result; a refusal waits 7 game days, a fumble 14.
- **Reputation 45, not 50.** The simulator showed half the average crews never registering with a bar of 50: events knock Reputation down and at a side business it only drifts back toward 50, so it settled just under. The bar is near the baseline instead of on it.

**Expansion projects.** Started by a majority, paid from the till at once (the fit-out is worth what it cost), finished with business days, and then Capacity rises: 1,500 eb, 3 days and +0.25 at stage 0; 2,500 eb, 6 days and +0.8 at stage 1, scaled by the growth rate and up to the stage's ceiling. One at a time.

**Weekly events** (`businessEvents.js`). The engine draws an event when a week starts, from the world seed, the business and the week, so a week always draws the same thing; it is not a player's roll. The chance is 25%, times the district's risk, times 0.8 once registered. Eight kinds: a shakedown, a break-in, a breakdown, a shortage, a rival, trouble with a customer, an inspection (registered only) and a big order, each answered with the skills and abilities it names (some add the trade's own skills; an inspection takes Bureaucracy, or Local Expert or Bribery at DV +2).
- Answering takes a slot and a roll, at the stage's DV. Unanswered, an event costs 15% of the week's takings and leaves its mark (a breakdown Capacity −0.05, a shortage Cost base +0.02, a rival Reputation −2, trouble Reputation −1, an inspection Compliance −8); a failed answer costs 10% and half the mark, a fumble 20%. A successful Keep it safe that week also deals with a shakedown or a break-in. A big order pays 5% to 30% more takings only if answered well. Debt collectors (never drawn) come the week after a missed fixer payment.
- At a side business answering uses the only slot, so the shop goes unworked that week; that is the trade-off the design wants.
- The shakedown's Reputation hit was dropped and the others softened, for the same reason as the Reputation bar above.

**Districts.** Twenty, with Night City Map's ids (the bays are left out), chosen when the business is founded. Each sets foot traffic (×0.6 in the ruined centre to ×1.25 in the Executive Zone, on takings), rent (×0.5 to ×1.6, on rent and licence fees) and risk (×0.6 to ×2, on protection money and how often events come). No district is average on all three. The free-text location stays as a note; showing businesses on the map is for the map bridge (B7).

**The other six archetypes.** Boutique (Wardrobe & Style, Personal Grooming), gun shop (Weaponstech, Trading; dear to set up), courier (Drive Land Vehicle, Local Expert), security outfit (Tactics, Persuasion), screamsheet (Composition, Photography/Film) and food stall (Streetwise, Local Expert; cheap). Their takings and costs keep the clinic's margin.

**Role abilities as actions.** B1 already let the abilities in §26.0's table roll the actions they fit (Credibility and Charismatic Impact to promote, Operator to source, Maker to fix up, Combat Awareness and Backup to keep it safe); B2 adds Moto to sourcing and lets abilities answer events. Exec Teamwork (an extra slot) is a chartered company's (B4).

**Loans** (`businessFinance.js`). Interest counts against the week's profit; the principal repaid comes out of the till but is not a cost. Repayments are taken as each week closes, and loans can be paid off early.
- **A fixer's loan**, at any stage, on a majority: up to 2,000 eb (4,000 once registered), 5% of the balance a week, a tenth of the principal repaid each week. A missed payment adds a 10% late fee, costs 2 Reputation and sends the collectors. This is deliberately harsh, a trap for the desperate (decided after the test world showed a full 2,000 eb loan costing a side business about 300 eb a week against roughly 110 eb of profit): players should borrow small, or pay back early. Repayments come out after the week's takings, so a week that earns its payment makes it.
- **A bank loan**, for a registered business: a majority agrees, then a partner rolls Accounting or Business at DV 15 (a hired accountant allowed). The band sets the limit, 6 to 20 weeks of the last four weeks' average profit, and the rate, 1.5% down to 0.8% a week, over 20 weeks; the loan is what the partners asked for, up to the limit. A missed payment adds 5% and costs 10 Compliance. A refusal waits 14 days.

**Investors**, for registered businesses only (§26.0).
- **A character**: every partner agrees on who, how much and the price per unit (book value unless the partners set one). Who may be invited: a player character, or a character linked to a Night City Messenger contact tagged `broker` or `investor` (`investorActors`; the GM's service checks the same list and refuses anyone else with `not-investor`). A contact with no linked character is not offered, since an investor pays from a character's wealth and accepts through that character; the GM accepts for an NPC investor from their own window. The character is then invited, sees the offer in their Business window, and pays in to become a voting partner.
- **An angel**: once every partner agrees, the angel is found: its skill total (12 + d10, drawn from the seed and the proposal) and name are stored, so the partners know who they are pitching to and the dialog's preview is exact. The pitch is a Persuasion or Trading roll against that total, the CPR opposed roll with the NPC's die already cast. The band sets how much of the book value the angel puts in (20% to 50%) and the price (10% under book to 20% over). An angel holds units without a vote; its share of the profit stays in the business (it draws nothing), and it is paid like any holder if the business closes. A failed pitch waits 14 days. This replaces rolling the angel's die after the player's, which would have let the player's card say one thing and the GM's result another.

**Topping up a running business.** An active partner can put more eddies and gear into an open business from the Ledger tab (the `contribute` request, which before only worked while forming). The eddies go into the till and the gear's book value into the fit-out (`assets`). No units are issued, so every holder's stake gains in proportion and the payer gets no bigger share; that keeps control where it is and needs no vote. Gear from the partner's sheet leaves it for good, as with any gear once a business has opened.

**Gear is dragged in as items.** The gear a partner brings (when founding, joining or putting more in) is no longer a name and a value typed in: they drag Foundry items into a drop zone, from their character's sheet, the Items directory or a compendium, and the window lists them with their book value before sending. The book value is the item's market price times its quantity (`system.price.market` × `system.amount`). The request carries only the items' uuids; the GM's service looks each one up and reads it again (`itemGear`), so a value in the request is never used. Refused: an item on another character's sheet, installed cyberware, a skill, role, critical injury or NET architecture, and an item with no price. An item from the partner's own sheet moves into the business: the GM's side deletes it from the sheet once the request is saved, keeps a copy in the gear entry, and recreates it on the sheet if the business never opens (the partner withdraws, or the GM turns it down). Once the business has opened, gear is its property and goes with its fit-out; it is not handed back at closing. An item from the library or a compendium is a copy and nothing leaves a sheet.

**Private holdings in the Portfolio tab** (§26.8a). A character's stakes in open businesses, valued at book value times their share, not tradable, each with a button to the Business window, counted in the portfolio's total. Statements leave them out for now.

**Gigs for a player's own business** (§26.5). A gig is matched to an open player business before any company: a `[NCI: <business id>]` tag, the business's exact name, or its name inside the client text. Its outcome moves Reputation at once and next week's takings: at a reward of 2,000 eb a success is +4 and +10%, a failure −6 and −10%, scaled by the reward (0.25 to 1.5) and divided by one more for each gig for the same business in the last 28 days. With GM approval on (the default) it waits in its own section of the Gigs tab with the planned effect shown; the history names the business. A business has no share price yet, so there is no insider-trading window; heat for its gig runners waits for listing (B5).

**Windows.** The Business window gains Projects and Growth tabs, the week's event with an Answer button, loans on the Ledger tab and investors on the Partners tab, every kind of proposal on the Partners tab with its rule, the district, Compliance, and the digest's event, loan and gig lines. The GM's Businesses tab shows each business's district and week's event.

**Simulator** (`tools/simulate-engine.mjs`, `npm run simulate:engine`). It plays a business through the real engine with the B0 crews. At growth rate 1, after the Reputation changes above, strong, average and weak crews register in a median of 8, 11 and 28 weeks (100%, 99% and 94% within 80 weeks), against the B0 prototype's 7, 11 and 26, with weekly profit on registering of 139, 114 and 110 eb (the prototype's 136, 116 and 109) and 0 to 2% closing.

**Not built yet:** chartering and everything after it (B4 to B6); the GM editing the event tables; statements counting private stakes; moving a business to another district; Crew Tools downtime in place of business days (B7).

**Tested in the test world** (Foundry 12.343, Cyberpunk RED Core v0.92.4): gear dragged from a sheet (one item and several), valued from the item, leaving the sheet and coming back when the business was cancelled; founding in a district; a fixer's loan, an expansion finished with business days, answering events (a shortage, a breakdown, debt collectors) with extra time and Luck; weekly closes with interest, a missed payment and the collectors; the registration checklist, agreement and roll with a hired professional; a bank loan; finding an angel and a failed pitch; a character invited as an investor accepting from their own window; private stakes in the Portfolio tab. It found and fixed: loaded ammunition refused as installed and priced per round; a player's stale copy of a business they had left; a loan payment checked before the week's takings came in; the dialog offering a hire the till could not pay. Not tried live: a successful angel pitch, an inspection, a gig for a player's business, and the registered business's second slot (all covered by tests).

## 31. Phase B3: syndicates (built for v0.12)

A syndicate is a crew's shared brokerage account: members pool money, officers trade it on the market, and everyone holds units in it. This section turns §26.1 into what is built, with the choices made at the start of B3. It is built in two steps: **B3a**, the account (below), then **B3b**, syndicates as partners and owners of businesses.

**Choices made for B3** (decided before building):
- **Control.** Officers trade freely up to a size limit the members set. A bigger trade, admitting or removing a member, making someone an officer or not, changing the limit, and dissolving all go to a **vote by units**, open for 7 game days. This replaces §26.1's per-action approval rules, which would have needed a rules editor and more to explain.
- **Money in** comes from a member's own **brokerage balance**, not their eddies: a deposit moves cash from the member's account into the syndicate's and buys units at the current value per unit (NAV). A member who wants to pay in eddies deposits them into their own account first.
- **Money out.** A member redeems units at NAV. The money goes back into the member's brokerage balance after the market's settlement delay, from the syndicate's cash; if there is not enough cash, the redemption waits until the officers sell enough. Leaving is redeeming every unit.
- **Founding.** A player founds a syndicate from the terminal and invites members. A setting, on by default as for businesses, makes the GM approve it first.

**Storage.** A syndicate is a JournalEntry in an "NCI Syndicates" folder, as a business is, and not an actor as §26.1 first said: a journal keeps it out of the Actors directory, off character sheets and out of every list of characters, and its users' access is the business pattern (ownership None, Observer for the users of its invited and active members). The journal carries two flags, both saved in the one-write wrapped form (§28): `syndicate`, the record, and `portfolio`, an ordinary portfolio. Because the portfolio is ordinary, the executor, orders, fees, brokers, terminal sessions, dividends, splits, IPO subscriptions, alerts and statements all work on it unchanged.

**The record.** `{ schema, id, name, status, founderId, createdDay, members, rules, proposals, redemptions, ledger, closedDay }`.
- `status` is `pending` (waiting for the GM), `active` or `closed`.
- Each member is `{ actorId, name, role: 'officer'|'member', status: 'invited'|'active'|'declined'|'left', units, joinedDay }`. The founder starts as an officer.
- `rules` is `{ tradeLimit, proposalDays }`: 5,000 eb and 7 days to start.

**Units and NAV.** NAV per unit is the syndicate portfolio's total value (cash, unsettled proceeds and positions at market, as the terminal values any portfolio) divided by the units in issue, and 1 eb while no units exist. Units are kept to two decimals. A deposit buys `amount / NAV` units; a redemption pays `units × NAV` at the time it is paid.

**Requests.** Members never write the syndicate's flags. A member's character carries a `syndicateOutbox`, as it carries a business outbox, and every request names the syndicate. So the GM always knows which member asked, which a shared outbox on the syndicate could not show.
- `found { name, invite }`, then `join` or `decline` for the invited.
- `deposit { amount }` and `redeem { units }` (all of them to leave).
- `trade { request }`, officers only: one of the terminal's own requests (place or cancel an order, choose a broker, connect to the terminal, dividend reinvestment, price alerts, a statement, an IPO subscription), run by the executor on the syndicate's portfolio. An order whose estimated cost is over the trade limit is refused with "over the limit", and the officer proposes it instead.
- `propose { kind, ... }` and `vote { proposalId, yes }`. The kinds are `trade` (an order over the limit, placed as soon as it passes), `admit` (invite a character), `remove` (a member, whose units are redeemed), `role` (make a member an officer, or not), `limit` (a new trade limit) and `dissolve`.

**Votes.** A proposal passes when members holding more than half the units say yes, and fails once half or more say no; it lapses after `proposalDays`. While no units exist, each active member has one vote. Dissolving needs the portfolio to hold no positions and no open orders (the officers sell first); when it passes, the cash is paid out by units into the members' brokerage balances and the syndicate closes.

**Trading.** In the terminal the account picker lists each syndicate a user's characters belong to, as "*Syndicate* (as *character*)", beside the characters themselves. With a syndicate chosen, the Market and Portfolio tabs show the syndicate's account, and the trade dialog, broker choice, alerts and orders send `trade` requests through the member's character. Direct trading needs the syndicate's own terminal session, opened by an officer's Accounting roll; the broker's terms are the broker's own, so §26.1's treasurer is not needed. The Portfolio tab gains a Syndicate panel: members, units and stakes, NAV, deposit and redeem, waiting redemptions, proposals and votes, the trade limit, and invitations.

**Heat is collective.** The syndicate's trades are audited as one account and recorded under the syndicate's id. It counts as the gig's runner if any member ran it, and as tipped if any member was sent the rumour. Freezes and dropped brokers land on the syndicate's account; warnings and NCPD mail go to every active member. Cover-up actions stay with characters. Adding members' personal trades to the syndicate's for the size factor (§26.1) waits for coordinated campaigns (B6).

**Mail.** Anything the market would mail to an account (fills by broker, statements, alerts, paid withdrawals) goes to every active member of a syndicate.

**GM Console.** A Syndicates tab: each syndicate with its members, units, NAV and portfolio, approving or refusing pending ones, passing or vetoing a proposal, and closing a syndicate.

**B3a as built.** The engine is `scripts/engine/syndicate.js` (pure, with `tests/syndicate.test.mjs`); storage `SyndicateRepository` (its `account(id)` stands in for an actor wherever a portfolio is read or written, and `PortfolioRepository.accounts()` lists characters and active syndicates for the GM's services); the GM side `SyndicateService`, run in the portfolio service's queue because deposits and redemptions write members' own accounts, with a "Syndicates" step after orders in the after-tick sequence; the player side `SyndicateClient` and `SyndicateWatcher`; the terminal's picker, Syndicate panel and founding form (`ui/accounts.js`, `ui/MarketTerminal/syndicateContext.js`); the trade dialog's limit note and proposal; and the GM Console's Syndicates tab. Two settings: player syndicates on or off, and GM approval of new ones (both on by default). Each side of a cash movement has its own ledger line: the member's reads "paid into a syndicate", "redeemed from a syndicate" or "paid out by a dissolved syndicate", and the syndicate's "paid in by a member" and so on. `tests/syndicateFlow.test.mjs` runs the services from founding to dissolving, and `tests/syndicateWindows.test.mjs` renders the windows. Not yet tried in the test world.

**B3b: syndicates in businesses, as built.** A syndicate can be a business partner or its only owner. Choices made at the start of B3b:
- **Its officers act for it.** Any officer takes the syndicate's turns in a business (the weekly slot, helping, the setup roll and the rest), rolling with their own skills and Luck; members who are not officers cannot.
- **Any officer casts its vote** on a business proposal.
- **The officers' trade limit applies to business money too.** An officer can found, join, top up or buy in up to the limit; a bigger payment goes to the syndicate's members as a `business` proposal, and is made once it passes.
- **Cash only.** A syndicate has no inventory, so it brings no gear; its officers bring gear as partners in their own right.

How it works:
- **Acting for it.** In the Business window an officer picks "*syndicate* (as *officer*)", beside their characters. The window sends the officer's request with the syndicate's id (`syndicateId`); `BusinessService` checks the officer, then runs the request with the syndicate as the partner (the engine needed no change: it knows partners only by id), the officer's roll verified from the officer's card, and the syndicate's free cash as its wealth.
- **The limit.** The business engine is pure, so the service runs a request first without saving it; if the syndicate would pay more than its limit, the request is refused (`over-limit`) and nothing is written. The Business window does not send it at all: it puts it to the members instead. A passed `business` proposal is made by `BusinessService.applyFor`, after the portfolio queue is free; if the business side then refuses it, the syndicate's history says why.
- **Money.** Every payment to or from a syndicate partner (paying in, a refund, a draw, a buy-out, a payout on closing) goes through `SyndicateCash` into its brokerage account, with a line in the account's ledger ("paid into a business", "received from a business") and in its history.
- **Value.** Its stakes in open businesses, at book value times its share, count in its value per unit (deposits and redemptions are priced with them), and show in its Private businesses list; a syndicate holding any stake cannot be dissolved (it must leave or sell first).
- **Who sees the business.** The users of a syndicate partner's active members can read the business's record.
- **Inviting a syndicate.** The Start a business form, and the partners' investor list, offer active syndicates as well as characters.

**After the B3 review (built for v0.12).**
- **The limit is a daily allowance.** Each officer may trade, and put into businesses, up to the limit per game day without a vote: every order counts at its estimated value (buys and sells), and so does every business payment they make. What each officer has used is kept on the record (`spent`, by game day); the panel and the trade dialog show what is left, and anything over goes to the members. This closes splitting a big trade into small orders.
- **Mail to members** (a world setting, on by default). From the market wire by Night City Messenger: every active member hears when a proposal opens (with who proposed it and when the vote closes) and its outcome (passed, turned down, lapsed, vetoed, or passed but impossible), and when a trade or business payment the members agreed then fails; a member hears alone that their redemption was paid, and the members at the end that the syndicate was wound up (`SyndicateMail`).
- **Operator for syndicate partners.** A syndicate partner counts the Operator rank of its officers, so a Fixer officer cheapens the business's hired professionals as a Fixer partner does.
- **Members see its businesses.** The Business window offers a syndicate to every active member; one who is not an officer sees its businesses read-only. A Portfolio row opens the Business window as the account picked in the terminal, and a change in a syndicate's members updates who can see its businesses at once (`BusinessRepository.refreshOwnership`), not at the business's next save.
- **Smaller fixes.** No units are sold while a syndicate is worth nothing (they would cost nothing); any member may end a terminal session they opened as an officer; a trade the members agreed that cannot be placed is noted in the syndicate's history; a business payment takes money before it pays any out, so a short payer stops it cleanly; data upgrades and the self-check include syndicates' accounts.

## 32. Phase B4: chartered companies (built for v0.13)

A registered business that has grown far enough becomes a **chartered company**: stage 2 of the same business record (§26.0), with a cap table of shares, more action slots, the five company actions, monthly reports and elected officers. This section turns §26.2 to §26.4 into what is built. It is built in three steps: **B4a** the charter, **B4b** the company loop, **B4c** officers, control and information rolls.

**Choices made for B4** (decided before building):
- **Growing only.** A company is chartered by growing a registered business; chartering from scratch is left for later. The business's net assets count toward the capital quote and its units become shares.
- **Funding in eddies.** What the owners add to fund the charter comes from their characters' eddies, as every business payment does (a syndicate partner pays from its account, B3b). §26.2a's brokerage-balance deposits are not used.
- **The cap table stays on the record** until a listing (B5) turns it into market shares in portfolios. Units become shares one-for-one, so nothing is converted, and a private company's shares can never be sold on the market by mistake.
- **The five company actions** (Business, Accounting, Trading, Bureaucracy, Bribery, each with alternative skills at DV +2) replace the shop actions at stage 2 (B4b).

### 32.1 B4a: the charter

**Milestones** (Registered → Chartered, §26.0): 12 weeks registered (three monthly ledgers of four weeks), an average profit of 400 eb a week over the last 4, at least one finished expansion, and the filing fee (2,000 eb, the B0 prototype's) in the till. Then every partner with a vote agrees to charter (the `stepUp` proposal, as for registering), naming the company's ticker (two to five letters, not taken by a market company or another charter). The filing fee is paid from the till when they agree, and is spent whatever happens.

**The three rolls**, each a `charterRoll` request any partner with a vote can make on their own client, in any order, with the usual levers (Luck, the complementary bonus, extra time, a hired professional paid from the till):

| Part | Skill (alternatives at DV +2) | DV | Sets |
|---|---|---|---|
| Business plan | Business (Persuasion, Trading) | Everyday 13: a business with a track record finds it one step easier | starting Reputation |
| Registration | Bureaucracy (Local Expert, Persuasion) | Difficult 15 | starting Compliance |
| Capital structure | Accounting (Business) | Difficult 15 | the capital quote |

Each part is rolled once. A failed business plan or registration is a setback, not a refusal: the company starts with less Reputation or Compliance. A failed **capital structure** roll refuses the charter: the fee is lost, and the partners may agree to try again after 7 game days (14 after a fumble); a business plan or registration roll that passed is kept for 30 game days, so only what failed is rolled again.

**The capital quote** (§26.2a), set by the capital structure roll: quote = Kmax − (Kmax − Kmin) × clamp(margin / 8, 0, 1), rounded to 100 eb, with the Startup tier's Kmin 5,000 and Kmax 12,000 times the sector factor (media and consumer 0.8; tech, transport, health, finance, construction and others 1.0; security and arms 1.3; biotech and energy 1.5). The business type maps to a market sector (a clinic is health, a garage and a courier transport, a bar, boutique and food stall consumer, an info shop tech, a gun shop arms, a security outfit security, a media outfit media). The business's **net assets** (its cash and fit-out, less what it owes on loans) count toward the quote, so the owners pay in only the shortfall.

**GM approval.** Every charter waits for the GM, as §26 decided, in the Businesses tab: the rolls, the quote, the net assets and the shortfall. The GM approves or turns it down (a turned-down charter refunds anything paid in; the fee is not refunded).

**Funding.** On approval, a funding window of 14 game days opens. Any partner pays in (`charterFund`) from their eddies, up to the shortfall plus 50%, and each payment buys new shares at the business's book value per unit at the time, so existing holders are not diluted below what their stake is worth. When the shortfall is met the company is formed; if the window lapses, every payment is refunded and the charter fails (the partners may agree again). With no shortfall, the company is formed the moment the GM approves.

**Formed.** The business becomes stage 2: its units are now shares (the same numbers), what was paid in goes into its cash, it has the ticker and its market sector, and the business plan and registration bands shift its Reputation and Compliance. Until B4b, a chartered company runs the stage-2 weekly loop with the shop actions, using the B0 prototype's stage 2: three action slots, actions at DV 17 (Professional), a Capacity ceiling of 14, 150 eb a week of rent, licences and protection, and expansions of 8,000 eb for +1.5 Capacity.

**B4a as built.** The charter is `scripts/engine/businessCharter.js` (pure, with `tests/businessCharter.test.mjs`), wired into the business engine: the stage-1 `stepUp` proposal names the ticker (checked against the market's and other charters' tickers, which the service passes as `context.tickers`), `charterRoll` (one of `plan`, `registration`, `capital`) and `charterFund` requests, `approveBusinessCharter` and `rejectBusinessCharter` for the GM (the Businesses tab), and the funding window lapsing on the weekly advance. A business now records the day it registered (`registeredDay`; older ones are read from their ledger). The Growth tab shows the charter's milestones, sector and quote range, the ticker form, each roll's result with its Roll button, what the GM is weighing, and the funding form; the roll dialog says what each band of each charter roll means. A syndicate partner's charter payment counts against its officer's daily limit like any other payment in. Not yet tried in the test world.

### 32.2 B4b: the company loop

**The five company actions** replace the shop actions at stage 2 (three slots a week, at DV 17), each with alternative skills at DV +2 and the role abilities that fit:

| Action | Skill (alternatives at DV +2), abilities | Effect by band |
|---|---|---|
| Chase contracts | Business (Persuasion, Trading); Teamwork, Operator, Maker | multiplies the week's takings (60% to 138%) and lifts Reputation a little |
| Tighten the books | Accounting (Business); Moto | the Cost base down (up to 6%) |
| Investor relations | Trading (Persuasion, Wardrobe & Style); Credibility, Charismatic Impact | Reputation up (up to 8) |
| Permits and compliance | Bureaucracy (Local Expert, Persuasion); Backup | Compliance up (up to 8), and less protection money that week |
| Shortcuts | Bribery (Streetwise); Operator | multiplies the takings most (70% to 160%), always adds Exposure (more on a failure), and a fumble costs 8 Compliance |

A week with neither contracts nor shortcuts is an unworked week, as a shop's week without Work the shop is. Capacity grows only through expansions at this stage. Complementary checks work as before.

**The monthly report.** Every four weeks after the charter, the company publishes a report summing those weeks (takings, upkeep, profit). In the report's last week an officer may prepare it (`reportRoll`: Accounting, or Business at DV +2): the band shifts the profit it reports (−8% to +10%); Bold is **aggressive reporting**, doubling the shift and adding Exposure. With no preparation the report shows what was earned. The roll's total and band are kept with the report, for an audit later (§26.6). While the company is private the report moves nothing on the market; from B5 the reported profit feeds the valuation and the earnings impact. Reports show in the Ledger tab; the This week tab says which week of the month it is and offers the preparation in the last.

**Built:** `scripts/engine/businessCompany.js` (the company's week, `reportCheck`, `closeReportWeek`), the company actions in `businessConfig.js` (`COMPANY_ACTIONS`, `actionIdsFor`), tests in `tests/businessCompany.test.mjs`.

### 32.3 B4c: officers, control and information

**Officers.** At the charter every partner with a vote becomes an officer (they ran the business). After that the shareholders elect (`elect`) and dismiss (`dismiss`) officers by a majority of the shares, through the usual proposals; a company always keeps at least one. Only officers run a company: they take its action slots, answer its events, prepare its report and make the information rolls. Any holder may still help with a complementary check, so a shareholder who is not an officer has a roll that matters. Control is the existing majority rule: holders of more than half the shares carry every majority proposal. The Partners tab marks officers and offers the elections; the This week tab tells a shareholder who is not an officer why they cannot act.

**Information rolls** (once a week each, paid from the company's cash):
- **Internal audit** (Accounting, Business at DV +2; 300 eb). A pass tells the officers the company's Exposure band (clean, low, moderate, high), which is otherwise hidden; a strong result also wipes 5 points of it out, an exceptional one 10. The GM's service passes the hidden Exposure to the engine and lowers it, never below zero.
- **Due diligence** (Library Search or Business; 200 eb) on another business, named as the players know it (their client cannot list other businesses, so nothing is revealed about which exist): a pass tells its state bands and a range for its book value, ±30% on a narrow pass down to ±5% on an exceptional one. What it found is kept with the company (the last five).

**Built:** officers and the information rolls in `scripts/engine/businessCompany.js` (`officersOf`, `canRun`, `officerProposal`, `infoCheck`, `applyInternalAudit`, `applyDiligence`, `exposureBand`), the `elect` and `dismiss` proposal kinds, `auditRoll` and `diligenceRoll` requests, and the service resolving a due diligence target by name. Tests in `tests/businessCompany.test.mjs` and `tests/businessWindows.test.mjs`. None of B4 has been tried in the test world yet.

## 33. Employees (E1 and E2 built; E3 proposed)

Characters, player or NPC, can work for a player business as **employees**. Partners own a business and run it; employees work in it for a wage. Their skills lift what the business earns according to the job they hold, they can be called in to make the business's rolls for overtime pay, and they bring loyalty, staff events and training with them. Employees work at every stage (§26.0) and for a syndicate's business too (B3b), so this phase sits beside B1 to B4 rather than after them. It should be built before going public (B5), because wages change a company's profit, and so its valuation.

**Choices made** (decided before writing this):
- **Who can be hired:**
  - a player character, who accepts an offer, as an investor does (§30);
  - an NPC actor linked to a Night City Messenger contact tagged `staff` or `employee` (the same rule as investors, with its own tags);
  - a **recruit** found on the street with a recruiting roll: a generated name and skill level, so the GM need not build an actor for every shop hand.
- **Posts.** An employee holds a post, and the post decides which of their skills count and what they do for the business.
- **From stage 0.** A side business can take on 1 employee, a registered business 3, a chartered company 8. Wages make early hires a cost rather than a gain, so the business's growth decides when staff pay off.
- **Extras in the design:** loyalty, staff events and vetting, training and share grants, and an Exec's Teamwork team as staff.

### 33.1 Skill levels and posts

**Skill base.** An employee's base in a skill is stat + skill, the number a roll adds to the d10 (§26). An employee's base for a post is their best base among the post's skills. A role ability that fits the business (a Medtech's Medicine at a clinic, a Tech's Maker at a garage) counts one level higher. Bases fall into four levels, matching the hired professionals' fixed bases (10, 13 and 16):

| Level | Base | A recruit's base |
|---|---|---|
| Green | 8 or less | 7 |
| Skilled | 9 to 12 | 10 |
| Expert | 13 to 15 | 13 |
| Master | 16 or more | 16 |

**Reading skills.** Players' clients cannot read an NPC actor's sheet, so the GM's service reads the NPC's sheet when they are hired and again each week. It records their base in every skill and ability a business roll names (`bases`), and the roll dialog and the Staff tab read from that record. A recruit has their level's base in their post's skills and is Green (7) in everything else. A player character's bases are read from their own sheet, as for a partner.

**Posts.** A business may have one manager; the other posts take as many people as its headcount allows. Floor staff are also limited to the business's Capacity, rounded down (at least 1), so expansions make room for more hands.

| Post | Stage | Skills that count | What it does each week |
|---|---|---|---|
| Floor | any | the archetype's trade skills (§29); its role abilities count one level higher | lifts the takings by (base − 6) × 1.5%: 6% for a base of 10, 15% for 16 |
| Manager | any | Business, or the trade skills at one level lower | when no partner works the shop (or, at stage 2, chases contracts), the manager does: the engine rolls the action with the manager's base against the stage's DV, drawn from the seed when the week closes, so the week is not unworked. A side business's crew can go on gigs without losing the week |
| Security | any | Tactics, Brawling, Handgun, Melee Weapon, Human Perception; Combat Awareness and Backup a level higher | a shakedown, break-in or trouble with a customer that no partner answers is answered by security, drawn from the seed, without using a slot |
| Bookkeeper | registered and up | Accounting (Business a level lower) | the Cost base trimmed by 0.3% to 1% a week, down to its floor, and the complementary +1 for preparing the monthly report |
| Sales | company | Business, Persuasion, Trading | the takings up by half a floor post's lift, and Reputation drifts toward 55 rather than 50 |
| Publicist | company | Composition, Wardrobe & Style, Persuasion; Credibility and Charismatic Impact a level higher | Reputation up by 0.5 to 1.5 a week |
| Compliance | company | Bureaucracy, Local Expert | Compliance up by 0.5 to 1.5 a week, and an inspection is answered as security answers a shakedown |

Floor lift is capped in total by stage: 15% at a side business, 35% registered and 60% chartered. The figures above are starting values, to be calibrated with the growth simulator, aiming at these results:
- a floor hire roughly breaks even near the registered stage's Capacity ceiling, and earns clearly at stage 2;
- a better employee costs more and earns more, with the best margin at Expert;
- an employee's overtime is never dearer than a hired professional of the same level.

### 33.2 Wages and overtime

**Wages.** An employee's going rate is a rate per point of their post's base each week: 5 eb at a side business (part-time), 9 eb registered and 14 eb at a company. So a Skilled floor hand with a base of 12 costs 60, 108 or 168 eb a week. The partners may offer more or less than the going rate: each 10% above it adds 5 to starting loyalty, each 10% below takes 5 off, and an NPC or recruit refuses less than 80%. Wages are an upkeep line, paid from the cash when the week closes, after the takings and before loan payments, and they count against the week's profit. A player character's wage goes to their eddies, with a payslip by Messenger mail if the world setting is on (as for syndicate mail).

**Unpaid wages.** If the cash cannot cover every wage, those left unpaid are owed (back pay, paid first next week) and lose 15 loyalty. Two weeks unpaid and they quit.

**Overtime.** A partner (an officer, at a company) can call an employee in for any of the business's rolls: an action slot, a complementary check, an event response, a report preparation, an audit or due diligence. In the roll dialog, the employee appears beside the hired professionals (`use: {kind: 'staff', staffId}`), with their base for the skill chosen and the overtime pay:

| Overtime | Pay, from the cash |
|---|---|
| Taking an action slot, answering an event, preparing a report, an information roll | 50% of a week's wage |
| A complementary check (+1) | 25% of a week's wage |

The usual levers apply except Luck, which is a character's own, and extra time, since the overtime is their time. A player-character employee can roll their own overtime on their own client, with their own Luck, once a partner has put them on call for that week. Each employee works at most two overtime shifts a week, and each shift after the first costs 3 loyalty. Overtime is the cheaper way to get a roll made: a Skilled employee's overtime at a registered business costs about 54 eb, where a hired professional of the same level costs 150.

### 33.3 Hiring, leaving and firing

**Recruiting** (`recruitRoll`). A partner looks for someone for a post: a Business, Streetwise or Library Search roll at the stage's DV, costing 50, 100 or 200 eb by stage for the ads, the fixer's cut and the drinks. The band sets the candidate's level: a narrow pass Green or Skilled, solid Skilled, strong Expert, exceptional Expert or Master. The candidate is drawn from the seed: their name, their level, and perhaps a hidden trait (§33.4). A failed roll finds nobody, and a fumble finds someone worse than nobody: a candidate with a bad trait. A candidate waits 7 days to be hired.

**Hiring.** A `hire` proposal names the candidate, NPC or player character, the post and the wage. It passes on a majority of the votes (a majority of the shares at a company). A player character must accept the offer from their own window; the GM accepts for an NPC from the Businesses tab, as for an NPC investor. A partner cannot also be an employee of the same business.

**Leaving.**
- **Quitting.** An employee whose loyalty falls below 25 may quit when a week closes (drawn from the seed), and one below 10 quits at once. A player character can quit any time, with a week's notice.
- **Firing.** A `fire` proposal passes on a majority and costs a week's wage in severance. Firing an employee with loyalty below 25 may bring a grudge event later.
- **When a partner leaves.** An Exec's team leaves with the Exec (§33.5).

**A player character's view.** An employee who is a player character is not given the business's record (that would show them its ledger). The GM's service mirrors their job onto their own actor as a flag: the business, their post, their wage, their loyalty, whether they are on call, and any roll asked of them. The Business window shows that to them as a Job view.

### 33.4 Loyalty, vetting and staff events

**Loyalty**, from 0 to 100, starts at 50 (moved by the wage offered) and is shown to the partners as a band (sullen, steady, loyal, devoted).

| Moves it up | Moves it down |
|---|---|
| a paid week: +2, up to 60 | a missed wage: −15 |
| a profitable month: +3 | a second overtime shift in a week: −3 |
| a bonus (paid from the cash): +5 per quarter-week's wage | a pay cut, or a refused raise: −10 |
| a share grant (§33.5): +20 | an event left unanswered that hurt the shop: −2 |

Below 25 an employee may quit, steals more readily and gives poaching offers a hearing. At 75 and above they get +1 on their overtime rolls, ignore poaching, and a security or compliance employee answers events as if one band better.

**Vetting** (`vetRoll`). Before hiring, a partner may check a candidate: Human Perception (an interview) or Library Search (a records search), or a Netrunner's Interface, at DV 13, costing 50 eb. A pass reveals any hidden trait. A trait is drawn with the candidate (about one in five has one) and kept in the GM-only control journal, like Exposure. The GM sees every trait in the Businesses tab.

| Trait | Effect |
|---|---|
| Light fingers | theft events are more likely and cost more |
| Loose lips | rivals' due diligence on this business gets a band better (B6) |
| Corp plant | a company only: 1 Exposure a week, and a whistleblower risk if fired (B6) |
| Moonlighter | refuses one overtime call in three |
| Dedicated (good) | loyalty never falls below 40 |
| Connected (good) | a recruit's level counts one higher for Manager and Sales |

**Staff events.** These join the weekly event table (§30) when a business has staff, answered as other events are:

| Event | Unanswered | Answered with |
|---|---|---|
| Sick day | one employee's post does nothing this week | Paramedic, Medicine, or overtime cover |
| Light fingers | 5% to 15% of the week's takings missing | Human Perception, Interrogation, Library Search; a pass catches the thief, who can be fired without severance |
| Pay dispute (company, 4 or more staff, average loyalty below 50) | the staff down tools: an unworked week, and −5 loyalty each | Persuasion or Business; or a bonus |
| Poaching offer | the best employee leaves, unless their loyalty is 75 or more | Persuasion; or a 10% raise |
| Accident at work (garage, gun shop, security, courier) | medical costs from the cash, and the employee is out for a week | Paramedic, Medicine |
| Star turn (good) | Reputation +2 if answered | Business or Persuasion, to make the most of it |

### 33.5 Training, share grants and an Exec's team

**Training.** Once every 4 weeks per employee, the partners can pay to raise an NPC employee's base in their post's skills by 1. It costs 50 eb per point of their current base and 2 business days from a partner whose own base is higher (a mentor), or twice the eb with no mentor (a course). Training can raise a base by at most 4 over what it was at hiring, and to no more than 18. A better employee wants a better wage: at the next month's end they ask for the new going rate, and refusing them costs 10 loyalty. A player character trains with their own Improvement Points as usual, and the service reads their sheet's new bases.

**Share grants** (company only). A `grant` proposal, passed on a majority of the shares, issues new shares without a vote to an employee, up to 5% of the company in total across all grants. They vest after 12 weeks and are lost if the employee leaves first. While vesting they add 20 loyalty and keep it at 50 or above. Once vested, the employee holds them like an angel investor (§30): a share of every payout, and a share of the proceeds if the company closes. From B5 they take part in the listing like any holder.

**An Exec's team.** A partner who is an Exec may staff their Teamwork team as employees: one team member for each 3 ranks of Teamwork, rounded up. Their level comes from the Exec's rank: Green at ranks 1 to 3, Skilled at 4 to 6, Expert at 7 to 9, Master at 10. Team members take no wage, start with 75 loyalty, take headcount places, and leave if the Exec leaves the business. This sits beside Teamwork's use as an ability on Chase contracts (§32.2).

### 33.6 Other links

- **Gigs** (§26.5). An employee in trouble (kidnapped, arrested, owing a gang) is a ready gig hook for the GM. Through the map bridge a gig can name an employee, and its outcome moves their loyalty, or brings them back.
- **Syndicates** (B3b). A syndicate's business hires like any other. Its officers act for it, and wages and overtime count against the officer's daily limit.
- **Going public** (B5). A bookkeeper and every officer see the weekly digests, so a player-character bookkeeper trading the company's shares falls in the officers' insider window (§26.4).
- **Corporate play** (B6). A fired disloyal employee, or a corp plant, can be the source a regulator's investigation starts from. A rival poaching your staff is a B6 move.
- **Perks for player-character employees.** A staff discount, such as cheaper installs at the clinic or repairs at the garage, is shown on their Job view as a note for the GM to honour. The module does not change prices on the sheet.

### 33.7 Record, requests and windows

- **Record.** The business record gains:
  - `staff`: one entry per employee, holding the id, the actor id (or none, for a recruit), the name, the source (`pc`, `npc`, `recruit` or `team`), the post, the bases, the wage, the day hired, loyalty, back pay owed, this week's overtime shifts, when they last trained, and any grant;
  - `candidates`: recruits waiting to be hired, with their expiry.

  Traits stay in the control journal, and a schema migration adds the empty lists.
- **Requests:**
  - `recruitRoll` and `vetRoll`;
  - the proposal kinds `hire`, `fire` and `grant`;
  - `acceptJob` and `quitJob`, for a player character;
  - `setPost`, `onCall`, `bonus` and `train`;
  - `{kind: 'staff'}` as a roll's use, checked by the GM's service like a hire.
- **Windows.**
  - **Business window:** a Staff tab (the staff, their posts, levels, wages and loyalty bands, candidates, recruiting and vetting); wages and overtime lines on the Ledger tab and in the digest; employees in the roll dialog. A player-character employee sees the Job view.
  - **GM Console:** the Businesses tab shows each employee's true loyalty and traits, and NPC offers waiting to be accepted.

### 33.8 Phasing

| Step | What is built |
|---|---|
| E1 Staff | posts, levels, wages, headcount, hiring player characters, tagged NPCs and recruits, overtime in the roll dialog, the Staff tab and Job view |
| E2 People | loyalty, quitting and firing, vetting and traits, staff events, bonuses |
| E3 Careers | training, share grants, an Exec's team, and the B5 and B6 links when those phases are built |

Each step ends as the others do: engine tests, flow tests, a schema migration, a simulator check of the wage and lift targets in §33.1, and a run in the test world.

### 33.9 E1 as built

E1 is `scripts/engine/businessStaff.js` (pure), wired into the business engine, with `tests/businessStaff.test.mjs` and `tests/staffFlow.test.mjs`. It follows §33.1 to §33.3, with these decisions made while building it:

- **Pay is a share of the going rate.** The partners offer 80% to 150% of the going rate (`pct`), not a sum in eb. Players' clients cannot read an NPC's sheet, so they cannot know the eb before hiring. The wage is worked out again each week from the employee's base for the post, the stage and that share, so it follows the employee's skills, and it rises when the business steps up.
- **Abilities.** A fitting role ability counts for a post as its rank + 9 (rank 4 counts as 13, Expert). For an overtime roll an employee uses an ability at its rank, as a partner does.
- **Overtime.** An employee called in rolls their best use for the roll, an alternative skill's DV step counted against it (`{kind: 'staff', staffId}`, which the GM's service fills in with the base from the record). The partner presses Roll, and the card is checked like any other. The employee cannot use Luck or business days, and the overtime is paid from the cash when the roll counts. An employee helping (a complementary check) is a helper of their own, so the partner who called them in may still help.
- **Automatic shifts.** The manager's work and security's answer are each a slot marked `staff`, rolled from the seed when the week closes. They are added before the week is counted and do not use one of the partners' slots. A manager at a company chases contracts. A compliance officer answers an inspection the same way.
- **Wages** are paid after the takings and upkeep and before the loans, as far as the cash goes. They count against the week's profit, and the digest and the ledger show them. What the cash cannot cover is owed and paid first the next week; E1 does not yet make anyone quit over it.
- **A player character's job** is mirrored onto their own actor (`flags.night-city-investments.jobs`) by the GM's service after every change to the business. The Business window shows it as **Your jobs**, with Take the job, Turn it down and Quit. A player character can quit at once, without notice or severance.
- **The Hire window, and advertising.** Each open post on the Staff tab has a Hire button that opens a window for that post (`HireDialogApp`): hire a character at a share of the going rate, or **advertise the job**, the recruiting roll (Business, Streetwise or Library Search at the stage's DV, 50, 100 or 200 eb, once a week). An advert brings applicants, not one candidate. The band sets how many (a failure 1 weak applicant, narrow 1 or 2, solid 2, strong 2 or 3, exceptional 3; a fumble nobody), the range of their base in the post's skills (6–8 on a failure up to 12–17 on an exceptional roll), and what each asks as a share of the going rate (110–140% on a failure down to 85–110% on an exceptional roll), each drawn from the seed. An applicant is hired on what they ask. A new advert for a post replaces the applicants still waiting for it, so the old limit of three candidates waiting is gone. Applicants wait 7 days, listed at the foot of the Staff tab, where they are hired; the Hire window closes once the advert's roll is made. The staff table's Skill column names the skill that counts for each employee's post (a role ability with its rank, or a skill a level lower).
- **Dragging a character into the Hire window.** The "Hire a character" block of a role's Hire window takes a character dragged from the Actors directory. The window checks the character can be hired there (a player character or a tagged NPC, not a partner, not already on the staff, the role open), asks for confirmation, and proposes the hire at the pay set in the form. (At first the Staff tab's posts took the drop, with a pay field above them; both were removed.) The Staff tab calls posts *roles*.
- **NPC offers** wait in the GM Console's Businesses tab, which counts them among what needs the GM. A recruit starts at once.
- **No migration.** The record's normalizer fills in the new fields (`staff`, `candidates`, `lastRecruit`, and `overtime` on the week), so stored businesses need no step.

**Checked against §33.1's targets** (a clinic at neutral Reputation, no district; the floor post's lift against its wage, before upkeep):

| Stage, Capacity | Base 9 | 12 | 13 | 16 |
|---|---|---|---|---|
| side business, 1.3 | −30 | −30 | −30 | −29 |
| registered, 4.5 | −28 | −3 | +6 | +32 |
| company, 8 | −32 | +19 | +36 | +88 |
| company, 14 | +38 | +160 | +200 | +322 |

A floor hire breaks even near the registered stage's ceiling and earns clearly as a company, as intended. At a side business staff are only worth their other work (a manager freeing the crew, overtime). Overtime is cheaper than hiring a professional (a Skilled employee's roll at a registered business is 54 eb against 150). One target is missed: the margin keeps rising with the level instead of peaking at Expert, because the lift grows faster with the base than the wage does. It is left for the simulator pass with E2, where loyalty and poaching also weigh on dear staff.

**Also fixed:** the vote lines for electing and dismissing officers had no text (`NCI.Business.Proposed.elect` and `dismiss`), and several requests from B4 had no confirmation message.

**Not built yet:** a player character rolling their own overtime with their own Luck (on call), and everything in E3 (training, share grants, an Exec's team). The payslip, changing an employee's post, and the rest of the list E1 left are built in E2 (§33.10). Not yet tried in the test world.

### 33.10 E2 as built

E2 is `scripts/engine/businessPeople.js` (pure), with small hooks in `businessStaff.js`, `businessEvents.js` and the weekly close, tested in `tests/businessPeople.test.mjs` and `tests/staffFlow.test.mjs`. It follows §33.3 and §33.4, with these decisions made before and while building it:

- **Masters ask more.** This fixes the target E1 missed. Each point of base above 15 costs three times the rate (`premiumFrom` 15, `premium` 2), so a Master's going rate at a registered business is (16 + 2) × 9 = 162 eb, not 144. Measured with the engine (a clinic, a solid week's work, the floor post's margin against having no one):

  | Stage, Capacity | Base 9 | 12 | 13 | 15 | 16 | 17 |
  |---|---|---|---|---|---|---|
  | side business, 1.3 | −28 | −27 | −26 | −25 | −34 | −49 |
  | registered, 4.5 | −23 | +8 | +18 | **+39** | +31 | +23 |
  | company, 8 | −21 | +43 | +64 | **+107** | +100 | +93 |
  | company, 14 | +59 | +202 | +250 | +345 | +365 | +384 |

  The best margin is now at Expert, except at a company near its Capacity ceiling, where a Master still earns more.
- **Loyalty** is kept for NPCs and recruits only; a player character's is the player's own (shown as a dash). It follows the table in §33.4: it starts at 50, ±5 for each 10% of the going rate offered (an applicant starts at 50, being paid what they asked). A paid week adds +2 up to 60, a missed wage −15, a profitable month (every fourth week) +3, a second overtime shift −3, an unanswered bad event −2. The partners see the band (sullen below 25, steady, loyal, devoted from 75); the GM sees the number in the Businesses tab. At a week's close an employee below 25 quits one week in four (drawn from the seed), one below 10 walks out, and two weeks owed in a row make them quit. Devoted staff get +1 on overtime, ignore poaching, and roll security's and compliance's automatic answers a band better.
- **Pay changes and raises.** A `pay` proposal (majority) sets a new share of the going rate: a raise gives +5 loyalty per 10%, a cut −5 per 10% and another −10. At each month's end an employee below 50 loyalty asks for 10% more (up to 150%). Agreeing is a pay proposal at what they asked; **Turn it down** (`refuseRaise`) costs 10 loyalty, and so does ignoring it until the next month's end.
- **Bonuses** (`bonus`): one to four quarters of a week's wage, paid at once from the cash, +5 loyalty per quarter, once a week per employee. A player character's goes to their eddies.
- **Moving post** (`movePost`) is day-to-day running, not a vote: whoever runs the business moves an employee to another post that has room, at the same share of the going rate for their skill there.
- **The Employee window** (`EmployeeDialogApp`) opens from the Manage button on each row of the staff table. It covers pay (and any raise asked for), a bonus, moving post and letting them go. The staff table gains a Loyalty column and notes: a known trait, a thief caught, hurt at work, a raise asked for. An offer still waiting keeps a Withdraw button in the row.
- **Traits** are drawn with each applicant (one in five; about one in three from a failed advert), from the same seed as the advert. They are kept in the GM's hidden state (`traits`, by applicant id; a recruit keeps their applicant id as `candidateId`), never on the record, and the service drops traits of people who have gone. NPC actors hired directly have no trait: the GM plays them as written. What each does:
  - **light fingers:** the light fingers event three times as likely, and 1.5× the loss;
  - **loose lips:** due diligence on the business counts a band better (the B4c roll, through the service's target list);
  - **corp plant:** a company only (loose lips before), 1 Exposure a week and 5 when fired;
  - **moonlighter:** has other work one week in three, and turns overtime down that week (`moonlighting`);
  - **dedicated:** loyalty never below 40;
  - **connected:** a manager's or salesperson's base counts 3 higher for the week's own work, unseen (their wage does not show it).
- **Vetting** (`vetRoll`): a Vet button over each post's applicants checks them all with one roll (Human Perception, Library Search or Interface, DV 13, 50 eb). A pass sets each applicant's `revealed` to their trait or `none`; a strong or exceptional pass also shows their exact base (`vetted: 'full'`). A failure tells nothing, and those applicants cannot be vetted again. Until a strong vetting shows their base, applicants show only their level and their ask as a share of the going rate; afterwards, their base and their ask in eb. A recruit hired keeps what vetting showed.
- **Staff events** join the weekly table only when there are NPC staff, each with its own settling (`settleStaffEvent`). Sick day, accident and poaching name the employee (`staffId`) when drawn.
  - **Sick day:** unless answered (Paramedic or Medicine), that employee's post does nothing this week.
  - **Light fingers:** unanswered, 5–15% of the takings go missing (half on a failed answer). A pass catches the thief: the employee with the trait, otherwise the least loyal. A caught thief (`caught`) can be let go without severance, and a trait caught this way is known (`revealed`).
  - **Pay dispute:** a company with 4 or more NPC staff averaging below 50 loyalty. Unless answered (Persuasion or Business) or every NPC employee has had a bonus this week, all staff do nothing this week, each loses 5 loyalty, and the usual share of the takings is lost.
  - **Poaching offer:** for the best NPC hand. They leave unless the event is answered (Persuasion), they had a raise of 10% or more this week, or they are devoted.
  - **Accident at work:** garage, gun shop, security and courier only. Unanswered, medical bills of 100, 250 or 500 eb by stage come from the cash (half on a failed answer), and the employee is out this week and the next (`outUntil`).
  - **Star turn** (good): answered well, Reputation +2.
  - **Grudge:** not in the table. Letting a sullen employee go brings it the next week half the time (`b.grudge`, as the fixer's collectors). It is a security event that hits Reputation and Capacity.
- **Payslips.** As a week closes, each player character on the staff gets a Night City Messenger mail from the market wire with their wage, what was paid and anything owed. A world setting, *Payslips by Messenger*, turns it off.
- **The digest** lists what happened to the staff (off sick, hurt, poached, caught, asks for a raise, quit, walked out, quit unpaid), and an accident's medical bills.
- **No migration.** The normalizer fills in loyalty (50, or none for a player character) and keeps the new fields.

**Not built yet:** a player character on call rolling their own overtime with their own Luck, and E3.

## 34. Projects beside expansion (built 2026-10-31)

The Projects tab offered only an expansion (§30). Four more kinds of project now sit beside it, chosen by the user, each paid from the cash once a majority of the votes agrees (a `project` proposal naming the kind; the older `expansion` proposal still works) and finished with business days. **One project at a time.** Costs and days are by stage (side business / registered / company):

| Project | Cost (eb) | Days | Effect |
|---|---|---|---|
| Expansion | 1,500 / 2,500 / 8,000 | 3 / 6 / 9 | Capacity +0.25 / +0.8 / +1.5, up to the stage's ceiling (as before) |
| Refit | 600 / 1,500 / 5,000 | 2 / 4 / 6 | Cost base −0.05 at once, never below its floor; repeatable while there is room, since the Cost base creeps back up |
| Security upgrade | 800 / 2,000 / 6,000 | 2 / 3 / 5 | Levels 1 and 2: each cuts protection money by 25% and halves how often break-ins are drawn |
| Storefront | 700 / 1,800 / 6,000 | 2 / 4 / 6 | Reputation +5 at once, once a stage; once there is one, Reputation settles 3 higher (53, or 58 with a salesperson) |
| Staff room | 500 / 1,200 / 4,000 | 2 / 3 / 5 | Once a stage: one more headcount place each, and paid weeks lift NPC staff loyalty to 70 rather than 60 (E2) |

What a project builds is added to the business's assets at cost, as an expansion's fit-out is. Upgrades are kept on the record (`upgrades`: security's level, and the stages a storefront and a staff room were built at); the normalizer fills it in, so no migration.

**The tab** follows the Work and Staff tabs: a short intro; Capacity as a bar against the stage's ceiling, with the next expansion's gain hatched; the project under way with a progress bar, who has put days in (`crew`), and the add-days row; a table of every kind with what it would do from where the business stands, its cost and days, a Propose button under the header's "Business days left 3/3", and why it cannot start, in figures for money ("Needs 2,000 eb; the cash holds 1,300 eb"); and a table of the projects finished, with their cost, days, result and crew.

## 35. Proposal: after E3, B5 and B6 (not built)

Four directions for player businesses once employees (E3), going public (B5) and corporate play (B6) are in. The user settled the main choices on 2026-10-31 (§35.6); the rest is still a sketch. They share one new idea, **standing with factions** (§35.3), which comes first in the phasing (§35.5) even though it is the third topic.

**Everything stays in this module.** Other modules are read only through a bridge (the map bridge, the Crew Tools bridge B7, Night City Messenger's API), and nothing here depends on one being installed.

**What already exists to build on:**
- **Hidden state and investigations:** the GM-only control journal already keeps each business's Exposure, and NCPD Financial Crimes already audits, warns and penalises (§22, heat). B6 adds investigations and hidden ownership.
- **Night City Map:** it keeps a list of gangs for each district (`GANGS` in its `encounters.js`), keyed by the same district ids as a business (Tyger Claws, Voodoo Boys and 6th Street in Watson; Maelstrom, Red Chrome Legion and Iron Sights in South Night City; none in the Executive Zone). Its gigs already reach this module through the map bridge, with a client, a reward and a runner.
- **Crew Tools:** it already runs a Maker's fabrication and upgrade projects from compendium items, and downtime "crafting, or hustle". The B7 bridge (§26.8) already plans to spend its downtime on business work.
- **Night City Messenger:** contacts and tags (staff, broker, investor), mail from the market wire and from NCPD, data shards, networks with ICE, access logs and traces, contact breaches, scheduled messages and contact groups.
- **The market:** gig impacts on a company's price with a delay and a headline (`impactKernel`), sector moods, and insider-trading heat for runners and tipped characters.

### 35.1 Underworld: a front for illegal work

**The idea.** A business can run a **back room**: an illegal operation behind the legitimate shop, which the front hides and launders. It earns more than the shop, in money the books cannot show, and it carries the risk of raids, gangs, informants and investigations. **Underworld content is on by default**; a world setting turns it off. Opening a back room waits for the GM, as a new business does, when the business-approval setting is on.

**What players see:** the dirty cash in eddies (it is theirs to spend or launder), but the back room's Exposure, the raid risk and their standing with gangs only as bands, as Exposure is now.

**What each front hides** (the archetype decides the operation, its skills, and the trouble it draws):

| Front | Back room | Its skills | Draws |
|---|---|---|---|
| Clinic | Black-market cyberware, ripping, scrubbing stolen chrome | Cybertech, Paramedic; Medicine | Scavengers, Bozos, NCPD |
| Garage | Chop shop, untraceable rides | Basic Tech, Land Vehicle Tech; Maker | Gangs whose rides you strip, insurers |
| Bar | Gambling, dealing, a meeting place | Streetwise, Persuasion; Charismatic Impact | Rival dealers, vice raids |
| Bar, club | A brothel or dollhouse (dolls running on behaviour chips) | Persuasion, Human Perception, Wardrobe & Style; Charismatic Impact; Cybertech for the chips | Vice raids, the gang that runs the district's trade, chip suppliers, clients who talk |
| Info shop | Data fencing, a netrunner's den | Library Search, Interface | Corp netsec, NetWatch |
| Gun shop | Unregistered arms, military-grade kit | Weaponstech, Trading; Operator | Militech-style corp security, NCPD |
| Courier | Smuggling | Drive Land Vehicle, Local Expert; Moto | Customs, rival smugglers |
| Boutique, food stall | Laundering for others, a dead drop | Business, Streetwise | Whoever's money it is |
| Media | Blackmail, braindance bootlegs | Composition, Photography; Credibility | The people in the footage |
| Security | Muscle for hire, protection rackets | Tactics, Persuasion; Combat Awareness | Rival crews |

**How it would work** (a first sketch):
- **One kind per front.** Where a front has more than one kind of back room (a bar or club: gambling and dealing, or a brothel or dollhouse), the partners choose one when they open it.
- **A brothel or dollhouse** (bar or club) staffs its back room with employees (E1) in a new role, so their loyalty and traits matter more than anywhere else: a sullen worker or an informant is the likeliest leak. A dollhouse also needs behaviour chips, a running cost and a Cybertech check that can go wrong (an event). Like the rest of §35.1 it is handled in game terms only: takings, risk, events, with no explicit content in the module's text.
- **Opening one** is a project (§34) with its own roll, and waits for the GM's approval when the business-approval setting is on. Its size grows like the front's Capacity, and it is capped by it: a back room cannot outgrow its front without being obvious.
- **Dirty money.** The back room's takings go to a separate **dirty cash** pot, not the till: off the books, out of the monthly report, and not counted in book value or a listed company's valuation. Partners can take it as eddies with no draw cap, but every eddy raises Exposure.
- **Laundering** moves dirty cash into the till through the front's takings. It is capped at a share of the legitimate takings each week (around 25–40%, by front): a launder action (Accounting, Business; Bribery at DV +2). A bookkeeper (E1) makes it cleaner. A poor roll leaves traces that an audit, an inspection or B6's investigators can find.
- **Weekly actions:** "Work the back room" (the operation's skills), "Launder", "Pay off" (Bribery: cuts Exposure and raid odds), and "Lie low" (no takings, Exposure falls faster).
- **Staff (E1/E2):** new roles a back room unlocks, such as fence, runner, cook or chemist, and muscle (the security role). The corp plant trait becomes an **informant**, the most dangerous trait there is. Loyalty matters more: a sullen employee who knows about the back room can sell you out.
- **Events:** a raid (NCPD, corp security or NetWatch by front), a rival operation muscling in, a bad batch, an informant, a gang taking a cut, and an offer you can't refuse. A raid answered badly means fines, seized dirty cash and gear, Compliance and Reputation hits, and NCPD heat for the partners, with B6's investigation opened.
- **Gangs (with §35.3):** the district's gangs take an interest. Protection money stops being only a cost line and becomes a relationship: pay, refuse, or make a deal. A gang can offer to be a silent partner, putting in money for a cut, an underworld angel with strings attached; your standing with it moves its demands and its protection.
- **At a company (stage 2):** corporate crime instead of a back room: dumping, bribing regulators and off-books black ops. This grows from the company's Shortcuts action and Exposure, and ties into B6's regulator and investigations.

**Still to decide:** whether dirty cash counts as an asset (and so can be stolen or seized); the laundering caps and the Exposure they cost; whether a raid can close a business outright; and whether a gang can take a stake in the cap table, seen or hidden (as B6's hidden ownership).

### 35.2 Production: making goods

**The idea.** Businesses whose trade is making things can **produce stock**: items from the Cyberpunk RED compendiums that are sold through the shop, given to the partners, or (with a back room) fenced. This module does business-scale stock lines; a single character's crafting stays with Crew Tools.

**Which businesses make what:**

| Business | Lines | Notes |
|---|---|---|
| Gun shop | Ammunition, weapon attachments, then weapons | the clearest fit; illegal kit only through a back room |
| Garage | Vehicle upgrades, parts | installs on a character's vehicle are a service, not stock |
| Clinic | Cyberware and its options, pharmaceuticals | installs stay with the GM and the sheet; the clinic sells the chrome |
| Info shop | Programs, data, cyberdeck hardware | a netrunner's den sells black ICE |
| Boutique | Fashion and clothing items | Wardrobe & Style |
| Media | Braindance recordings, screamsheets | low value, high Reputation |
| Bar, food stall | Food and drink | flavour; their value is in takings, not stock |
| Courier, security | None | service businesses |

**How it would work** (a first sketch):
- **A workshop** is a project (§34) that opens production, with one or two **lines** by stage. A line names a GM-approved list of compendium items for that business type (set in the GM Console, with defaults), so players cannot produce anything they like.
- **A production run** picks an item and a quantity. Materials come from the cash (about half the market price, as Cyberpunk RED's fabrication rules), the time comes from business days or floor staff's time, and a roll uses the trade skill or Maker at the fabrication DV for the item's price category. The band sets how many come out good, and whether any are excellent quality.
- **Stock** sits on the business record as an asset at cost: in book value, and counted for B5's valuation. The items themselves are kept on the business's **stock sheet** (below).
- **Selling stock** goes through the shop: each week some stock sells at a margin, limited by Capacity and Reputation, and adds to takings. A partner can also buy an item at cost, or the GM can let one be taken onto a sheet (made from the compendium entry, as gear comes back now when a business never opens). A back room fences illegal stock at a higher margin, with Exposure.
- **Crew Tools (B7):** a business workshop gives a player character's own Crew Tools fabrication or upgrade project a facility bonus (cheaper or faster). The business can also commission a player character Tech's project, paying them from the cash. Nothing is duplicated: Crew Tools keeps the crafting rules.
- **The market:** a production contract with a listed company in the sector (a supplier or a buyer) counts as a contract for that company and lifts it a little, as a small gig does. Selling large volumes in a sector could nudge that sector's mood.

**The stock sheet** (the user's choice: production goes to an inventory). Each producing business gets a Cyberpunk RED **container** actor as its storeroom, the way Crew Tools makes its "Upgrade Projects" containers:
- **Made by the GM's service** when the first workshop is finished: named "Stock — <business>", in a "Night City Investments" actor folder, flagged with the business's id (`flags.night-city-investments.stockFor`). Like every non-character actor, it is left out of the module's character lists.
- **Owned by the GM; partners (and officers, at a company) are Observers.** They can open the sheet and see real items with their art, descriptions and stats, but cannot drag them out. Its Cyberpunk RED container settings are set so players cannot sell to it, take from it, move, edit or delete items (these flags need checking against the system's version).
- **The business record stays in charge of the money.** It lists the stock (the item, how many, the unit cost) and the service keeps the sheet's items in step after each production run, sale or hand-out. Taking an item goes through a request in the Business window: buy it at cost into the character's eddies, give it to a partner (it is created on their sheet from the container's copy and leaves the container), sell it through the shop, or fence it. So the till, eddies and book value always move together.
- **The GM may still move items by hand.** The service notices an item added to or removed from the container (Foundry's item hooks) and asks the GM what it was: written off, given away, or stock found. It never guesses.
- **Later, perhaps:** Cyberpunk RED's shop mode, with characters buying straight from the sheet and the price going into the till, if the system gives a hook for a purchase. To check.

**Still to decide:** how fast stock sells through the shop, and whether it can go stale; caps on production value per week, so eddies cannot be farmed; and whether quality is tracked.

### 35.3 Faction standing, and moving markets

**The idea.** A **business** has **standing** with factions: corporations and gangs. Standing runs from −100 to 100 and drifts back toward 0. Players see it only as a band (hostile, wary, neutral, friendly, allied); the GM sees the number. Characters' own reputation stays with Crew Tools: this module does not track it, though a Crew Tools bridge (B7) could later let a partner's reputation help a roll aimed at a faction.

- **Factions** are a GM-edited list kept in this module. Each has a name, a kind (corp, gang or other), a linked market company (its ticker) for a corp, and the districts it holds for a gang. The module ships its own starting list of the canonical gangs by district, with Night City Map's district ids, so a business's district already names whose turf it is on. With the map bridge installed, the GM can import the map's gang list instead.
- **What moves standing:**
  - **Gigs:** a map gig for a client faction raises standing with it on success and lowers it on failure, scaled like gig impacts. A gig against a faction's interests lowers it, where the gig names a target or rival.
  - **Business actions:** a company's Contracts and Relations actions can be aimed at a named faction. So can new actions for smaller businesses: "Court a client", "Pay respects" (to a gang) and "Undercut a rival".
  - **Events and the back room:** answering a gang's shakedown, refusing protection, serving a rival, or getting caught.
  - **Each faction's standing moves at most so much a week, and repeated favours count for less** (as gigs for your own business do now), so it cannot be farmed.
- **What standing does:**
  - Friendly corps give supplier discounts (Cost base), contract bonuses, and access: a supply contract, an investor, a buyer for a listed company's shares in B6.
  - Friendly gangs mean less protection money and fewer shakedowns, and they offer partnerships.
  - Hostile factions bring events: sabotage, a smear campaign, a raid tipped off, poaching your staff (E2), or a hostile bid (B6).
- **Moving market prices** with what already exists:
  - A gig's effect on a company's price stays as it is. Standing adds who you have helped or hurt.
  - New actions aimed at a listed company, such as a smear campaign (Composition, Persuasion) or a leak (Library Search, with an Interface or netrunner element), go through the impact pipeline with a delay and a generic headline. Anyone who trades the target before the news lands draws insider-trading heat (§22), the same rule as gig runners.
  - Once B5 has listed player companies, factions can act against them too: a hostile corp's smear campaign moves your price.
  - Coordinated campaigns (several characters or a syndicate trading together) were left for B6 in §31; standing and these actions belong with them.

**Still to decide:** how big a smear campaign can move a price, and how it sits with the GM's approval of gig impacts; whether a syndicate's businesses share one standing or each keep their own; and whether a faction can be hidden from players until they first deal with it.

### 35.4 Further Night City Messenger integration

**Built so far:** mail from the market wire (broker replies, syndicate mail, payslips), NCPD Financial Crimes notices, CorpNet sessions gating direct trading, and contacts tagged staff, broker or investor, read for hiring and investors.

**Options, roughly in order of value for the effort:**
1. **Events arrive as messages.** A shakedown comes from the gang's contact, an inspection from the city, a poaching offer from the rival, with a link that opens the Work tab to answer it. The GM can write in that contact's voice. This uses existing mail plus a contact per sender (created or reused, like the market wire).
2. **The weekly digest by mail** to partners who want it, with the profit, the cash and anything waiting (votes, raises asked for, applicants), and a link to the cashbook. A per-character setting, beside the payslips.
3. **Staff as contacts.** A hired recruit becomes a Night City Messenger contact (name, generated portrait, tagged staff), so players can message them and the GM can answer. Loyalty moments arrive as messages from them ("we need to talk about my pay"). Applicants answer an advert by mail.
4. **A business's own inbox:** each business as a contact with an address. Customers, suppliers, gangs and corps write to it, and the partners read it together (a contact group for the partners and officers).
5. **Underworld (§35.1):** a fixer contact offers fence deals; gangs send demands; messages that burn after reading. **Data shards** as evidence: the back room's real ledger is a shard that B6's investigators can find, a rival can steal, or a player can use for blackmail.
6. **Networks:** a company's intranet as a Messenger network, with ICE and access logs. Officers read insider documents there, and its access log is evidence for insider-trading heat (who read the monthly report before it was published). An info shop's or back room's network can be breached as an event (Messenger's breach and trace).
7. **Scheduled reminders:** loan payments due, a raise asked for that runs out, a charter's funding window closing, sent with Messenger's scheduling.
8. **Marketing:** a storefront project (§34) or a Promote action could send spam mail from the business to characters. Flavour, low priority.

**To check before building:** which of these Messenger's integration API already exposes to other modules (its `IntegrationBridge`) and which need new API in Messenger. Then, for each, whether messages are sent from the GM's client only (as now) or a player's.

### 35.5 Phasing

| Step | What | Needs |
|---|---|---|
| F1 Factions | the faction list and standing; gigs and business actions moving it; standing's effects on costs and events; smear campaigns through the impact pipeline | B6 (hostile bids, coordinated campaigns) |
| U1 Fronts | back rooms, dirty cash, laundering, raids, gang relationships, informants | F1, B6 (investigations, hidden ownership) |
| P1 Production | workshops, lines, production runs, stock, selling and fencing | E3 (staff time); B7 for the Crew Tools link; U1 for fencing |
| M | the Messenger options, alongside each step: events as messages and the digest with F1; staff as contacts any time; shards and networks with U1 and B6 | a check of Messenger's API |

Each step ends as the others do: engine tests, flow tests, a simulator check that nothing becomes a money farm (dirty cash and production first), and a run in the test world.

### 35.6 Decisions (2026-10-31)

1. **Underworld content is on by default**, with a world setting to turn it off.
2. **Standing belongs to the business.** Characters' reputation is managed by Crew Tools.
3. **Everything stays in this module** unless it can be done through a bridge: the faction list, standing and the starting gang list are this module's own.
4. **Production goes to an inventory:** a container actor for each producing business, as its stock sheet (§35.2), with the business record in charge of the money.
5. **Players see dirty cash as values**; Exposure and standing only as bands.
6. **Factions first** (F1), then fronts (U1), then production (P1).

