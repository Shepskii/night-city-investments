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
| 6b | Insider-trading heat, in stages (§22). **H1 done (v0.7.0, retuned in v0.7.1):** hidden heat recorded from audited gig windows, GM Heat tab. **H2 and H3 done (v0.8.0):** warnings, NCPD enquiries, fines, freezes and dropped brokers with GM approval, and skill-roll cover-up actions. H4 (gig runner from the bridge) to come |
| Later | Player syndicates, short selling and margin, options |

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

`scripts/bridge-0.1.0.js` is one file. `diffGigs(known, gigs)` compares each gig's status with the last look and returns the gigs that went from open (hidden, offer, active) to `done` or `failed`. The first look only records statuses, so gigs finished before the bridge loaded are not reported; a finished gig flipped between done and failed is not reported again; a gig created already finished is not reported. `createBridge()` takes its inputs as functions, so it is tested without Foundry. It scans on three triggers: a wrap of the map's `onClick` (same trick as the sibling bridges), the `updateSetting` hook for `night-city-map.state`, and a one-second poll. Only the active GM queues reports, but every GM client keeps its record of statuses so a handover loses nothing. Reports wait in an outbox and are retried (up to 20 attempts) if the core is missing, too old, or throws. It sends `{gigId, sourceKey: "gig:<id>:<outcome>", outcome, client, reward, title, desc, notes}`. One world setting turns reporting off.

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
  - *knowledge* is 1 for anyone, 0.4 for a character sent a rumour about it (rumours are an opt-in feature, so following one must not be a trap), and 1.5 for the gig's runner. The runner list is not filled in yet (needs the bridge to send `takenBy`, stage H4), so for now it is always empty.
  - *route* is 1 for direct trades and 0.7 for broker trades.
  - One audit adds at most 100 heat to a character.
  - **Rule of thumb** (a 30,000 eb portfolio, early in the window, no rumour): one medium trade is about 14 direct or 10 through a broker; two direct, or three broker, medium trades reach "noticed" (25); one 6,000 eb trade does on its own; two 12,000 eb trades make a character "investigated". Late in the window, or after a rumour, it takes more.
- **Tiers.** Quiet 0 to 24, Noticed 25 to 49, Flagged 50 to 74, Investigated 75 and up (see H2 for what each does).
- **Record.** `{characters: {actorId: {heat, tick, name, log[20]}}, windows[40], audits[30]}`. Heat is stored with the tick it was set and faded when read. A market reset clears it (ticks start again from zero).
- **For later stages and other modules.** Hooks `night-city-investments.heatAudit` (`{window, results}`) and `.heatChanged`; `api.gm.heat` has `heatOf`, `tierOf` and `snapshot`.
- **Still to come.** The bridge sending `takenBy` so a gig's runner counts for more (H4). Undo is not affected: heat is only changed by audits, and an audit never runs twice for one window.

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

Decisions so far: Crew Tools cannot be changed, so everything is NCI-side or in a bridge. Hustle income stays personal and is unrelated to a company. Payouts are capped. Syndicate holdings are visible to every member. The GM approves every company charter. All durations are game days (§25) and all writes follow the request, GM-executor pattern. The operating period is **weekly** with **monthly** published reports, to match weekly game sessions (§26.4).

**Roll rule: every player roll is triggered by the player.** Nothing in this section rolls for a player. A roll happens only when the player presses its Roll button (charter, business actions, report preparation, layering or investigating ownership), and the work is never forced on them.
- **Where it runs.** The roll is made on the player's own client as a normal Foundry roll with a chat card (and Dice So Nice), using `SkillAdapter.check` (stat + skill + 1d10, a 10 explodes, a 1 subtracts). The request carries the chat message id, not a total.
- **What the executor checks.** The active GM's executor loads that chat message, confirms it was authored by the requesting user and has not been used before, re-reads the stat and skill from the actor, and recomputes the total from the raw die. It then applies the DV, cost, allowance and cooldown. A total supplied in a request is never trusted. This model is **built (v0.9.5)** for the terminal check and the H3 cover-up actions (`SkillAdapter.check` on the player's client, `SkillAdapter.verify` on the GM's). It also checks that the card's author owns the actor, that the card is no more than 10 minutes older than the request, and marks it used by the request key, so a retried request is fine and a second one is not. A player who edits their own chat data could still forge dice; that is the usual table-trust limit, and the GM sees every card.
- **Not rolling is a valid choice.** An action nobody rolls simply does not happen. The weekly result is then the baseline (§26.4), with at most a small GM-tunable drift. The system's own event draw is not a player roll and stays on the engine.
- **One roll, one use.** A roll belongs to the action it was made for and cannot be reused. Retries, fees and delays are counted from the roll, in game days.

### 26.1 Syndicates

- **A shared account.** A syndicate is an actor flagged `syndicate` with an ordinary portfolio, so the terminal, executor, valuation and statements work unchanged. Every member sees its **holdings, positions, orders and ledger**. Members have ownership of the actor; writes still go through requests.
- **Units.** A member's deposit buys units at the current NAV (fund arithmetic), and a stake is units × NAV. Withdrawals are pro rata, by vote or by redemption request, with the usual delays. Fees (founder's cut, management fee) are GM-tunable sinks.
- **Roles and rules.** Founder, officer, member. Each syndicate picks an approval rule per action type (any officer, majority of officers, majority of units) for trades above a size, withdrawals, admission and removal, rule changes and dissolution. Proposals have a game-day deadline and are voted on in the terminal. The GM can force or veto.
- **Broker and treasurer.** One assigned broker. A designated treasurer's Accounting skill sets terms, or "best member's" if the syndicate prefers.
- **Heat is collective.** A rumour sent to one member is knowledge for all (`tipped`). Same-day orders by members add up for the size factor, so splitting trades does not avoid heat. Penalties land on the account, and the GM may pass them to members.
- **Later:** optional market impact for large pooled orders, and coordinated campaigns using Trading and Bribery rolls.

### 26.2 Forming a player company

1. **Draft a charter:** name, ticker, sector, authorised capital, founders and their stakes (characters or a syndicate), and whether a listing is intended (a note only: listing must be earned, §26.4a).
2. **Pay the filing fee** (scaled by sector and authorised capital). It is spent on the attempt whether or not it succeeds.
3. **Three skill rolls**, each made by a founder on their own client when they choose to press Roll (see the roll rule above), against a DV set by sector and size. Each slot stays open until it is rolled, and any founder can take it:

   | Roll | Skill | Covers |
   |---|---|---|
   | Business plan | Business | the concept, market and management |
   | Registration | Bureaucracy | licences, permits, jurisdiction |
   | Capital structure | Accounting | books, share structure, filings |

   Founders can share the three rolls between them, with a capped crew-assist bonus.
4. **Outcome.** All three must pass. A failure costs the fee and sets a **refiling delay** (default 7 game days). Rolls that passed are kept for 30 game days and the retry fee is lower, so a failure is a setback and not a dead end. A fumble adds to the delay. A pass sets the **capital quote** (§26.2a).
5. **GM approval.** The GM reviews the charter, the rolls and the quote, and may edit the terms, approve or reject (a rejection can refund the fee, by setting).
6. **Fund it.** Players deposit the quoted starting capital into the company account within the funding window (§26.2a). Nothing is formed until it is fully funded.
7. **Signed.** The company is formed as **private**, with a cap table made of restricted shares in the contributors' portfolios.

**Charter quality.** The margins of the three rolls add up to a quality score *Q*, clamped to a band. *Q* sets the **IPO offering price**: price = the company's market valuation per share (§26.4a) × a *Q* factor (about ±15%), and also the size of the float that investors will take. An optional prospectus roll at listing (Trading for the offering, Accounting for the filing) can nudge it further. This price applies only once the company has met the listing requirements (§26.4a).

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

**Interaction with the other rolls.** The Business and Bureaucracy margins do not change the quote; they only feed *Q* (the IPO price). A founder with a poor Accounting skill can improve the quote by having a better accountant make the roll, since any founder may take the slot.

### 26.3 Ownership and control

- **Cap table.** Shares are ordinary lots in portfolios (`assetId` = the company). While the company is private they are flagged `restricted`: they cannot be sold on the market, only transferred privately (GM approval optional). A listing opens the float and lifts the restriction on the shares sold.
- **Holders** can be characters, syndicates, the broker's nominee account, or the company's own treasury. A founder can be an individual or a syndicate, so a company can be owned collectively either way.
- **Control.** Holders of more than half the votes control the company. Officers are elected by shareholders weighted by shares. Only officers may take business actions, and the officer who chooses an action rolls it.
- **Takeovers and dilution.** Building a controlling stake transfers control, with GM approval. New issues, buybacks and delistings use the existing corporate actions.

### 26.4 Business activity

- **State.** Visible to officers: Capital, Revenue run-rate, Cost base, Reputation, Compliance, Operating capacity. Hidden: **Exposure**, which comes from shortcuts and aggressive reporting, like heat.
- **Cycle: weekly operating period, monthly report.**
  - **Weekly period.** One period is 7 game days, anchored to a GM-chosen weekday (default: the day of the weekly session) and run on the game-day clock, so the first tick on or after the boundary closes it. Catch-up after a calendar jump closes each missed period in order, up to a cap.
  - **What closes a week.** Outcome = state + the sector's backdrop + the actions the officers rolled that week + the GM-editable event tables. It updates the business state and is **private to officers** as a short weekly digest in the terminal. It does not move the share price.
  - **Monthly report.** On the in-world month boundary (the same rule as statements and monthly dividends; every 28 game days if there is no calendar), the company publishes a report that sums the weeks closed in that month (four or five). The result is a headline and an **earnings impact** on fair value (the surprise against expectations), with delay and decay. Dividends follow the report, still capped (§26.7).
  - **Actions per week.** Each officer may take actions with a per-period allowance (default one roll per skill per week, a GM setting), so the old per-action cooldown is replaced by the period. Costs are paid from company capital. The allowance resets when a period closes.
  - **Report preparation.** In the last week of the month an officer may roll Accounting to prepare the report. No roll means standard reporting: no bonus and no risk. Aggressive reporting is an Accounting option for a bigger surprise now and more Exposure later.
  - **Neglect.** With no actions in a period, reputation, compliance and capacity drift slightly toward the sector baseline. The drift is small and GM-tunable (it can be set to zero).
- **Skill actions** (a player-triggered roll with DV, cost and a weekly allowance):

  | Skill | Action | On success | On fumble |
  |---|---|---|---|
  | Business | chase contracts, expand, restructure | revenue and reputation up | costs up, a client lost |
  | Accounting | tighten the books, plan tax, prepare filings | margin up; reporting safer | audit finding, restatement |
  | Trading | investor relations, raise capital, time a buyback | sentiment and capital in | failed raise, a dip |
  | Bureaucracy | permits, compliance, licences | unlocks steps, less regulatory drag | delay, fine |
  | Bribery | shortcuts and rivals | large, fast gain | Exposure up, scandal, NCPD interest |

  A critical success multiplies the effect. Reporting integrity is an Accounting roll: aggressive reporting lifts the stock now and raises audit risk later.
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
| Exposure | hidden Exposure below its cap. High Exposure delays a listing without telling the officers why |
| Float | the founders agree to float at least 20% of the shares, and to keep a 28-day lock-up on the rest |

**The steps.**
1. **Eligibility is shown, not rolled.** Officers see a checklist of the requirements and their current standing. Nothing in it is a roll.
2. **Apply for listing.** An officer pays a listing fee (a percentage of *V*, a sink) and the GM approves.
3. **Prospectus rolls, player-triggered.** An officer rolls Accounting (the filing) and Trading (the offering). A pass is required for each. A failure costs the fee and a refiling delay (default 14 game days). The margins feed the offering price with *Q* (§26.2).
4. **Offering price and float.** Price = *V* per share × a *Q* factor (about ±15%, so market reality dominates), and the float size is capped by NPC demand (§26.7).
5. **IPO flow.** The company then runs through the standard announced IPO and subscription window. The first price comes from that offering, and its first day of trading starts the usual price model.

**After listing.** *V* is replaced by the market price. A **delisting review** applies hysteresis: a market capitalisation under 60% of the threshold for 3 consecutive reports (a GM setting) puts the company under review, and the GM can delist it or give it time. A company that fails the requirements after applying simply does not proceed, with no penalty beyond the fee.

**Not eligible is a normal state.** Until then the company trades in private only (§26.3), with its restricted shares, and gets the full business loop. Listing is a milestone, not a requirement.

### 26.5 Gigs for a player's own company

When a gig run by players names a player company as its **client**, it is a **business activity**, not a market rumour:
- `resolveClient` matches the player company as it does any client, but the outcome is applied to the company's **business state** (reputation and revenue up on success, down on failure, scaled by reward and capped) instead of as a direct price impact. The company acquiring assets, contracts or goodwill is outside NCI and is handled in play.
- The reward itself is paid or not by Night City Map as usual; NCI does not turn it into company cash.
- The price follows only through the next report, so the usual delay applies. GM approval is on by default, with monthly caps and diminishing returns to stop self-dealing.
- The players who ran it are the **gig runners**, which is exactly what heat stage H4 was reserved for (weight 1.5), so an owner trading around their own gig draws the most heat.
- A gig for a **rival** company as client works the same way, and a GM can use it for storylines.

### 26.6 Hidden ownership

Yes, with layers and costs, so concealment is a game and not a switch.
- **Layers.** (a) **Nominee through a broker:** the shares are held in the broker's nominee account and the public register shows the broker. (b) **A syndicate:** the register shows its name, and the member list is visible to members only. (c) **A syndicate holding a syndicate:** a chain, with each layer costing fees and a Bureaucracy or Accounting roll. Control rights still work through a nominee.
- **Rules that make it risky.** There is a disclosure threshold (default 5% of a listed company). Staying hidden above it is concealment, which adds Exposure and heat, and it fails if the regulator looks. A concealed holder trading around company events has a heat multiplier.
- **Uncovering.** Other players can investigate (a downtime-driven Library Search, Streetwise or Bribery roll, started and rolled by the investigator, against a DV that rises with each layer). Building a layer is a roll by its owner. A regulator's audit is decided by the engine or GM, not by a player roll. Brokers and syndicate members can leak by chance (engine), or be bribed by a player who chooses to roll Bribery. A takeover or an audit can unmask.
- **Where the truth lives.** The real holder is always in the GM-readable portfolio. Players' clients never receive other portfolios, and the register players see is computed by the GM and published as a public setting containing only what is disclosed.

### 26.7 Capped payouts

- **Dividends** = min(declared, profit-based, a GM sector ceiling × company size, a per-holder monthly eb cap). The excess stays in the company as capital, and its effect on the price is itself capped.
- **Sinks:** filing and registration fees, the listing fee, a withholding rate on dividends, broker commissions.
- **IPO proceeds:** a new issue raises company capital, not player cash. A sale of founders' shares pays real eb only as far as buyers exist; NPC demand per IPO is capped.
- **Liquidity:** a player company has limited depth. The market's usual infinite liquidity is replaced by a per-game-day NPC absorption cap sized by float and *Q*, with market impact on, so a thin stock cannot be used as an eb machine.

### 26.8 Downtime with Crew Tools, bridge only

Crew Tools exposes `api.downtime` (`getState`, `use`, `startNextSession`), `api.calendar`, `api.headquarters`, `discoverPlayerAccounts` and `appendPayoutRecord`, but no completion hook and no way to register an activity.
- A **bridge module** (like the Night City Map ones) adds a **Company Work** panel. Choosing an activity spends days through `downtime.use` as a free-form spend with a recognisable description, then sends NCI a request carrying the resulting event.
- NCI's executor **verifies** the event in the character's downtime log (read-only) before it applies the action, and uses its id to stay idempotent. The player presses Roll for the action; the executor never rolls for them.
- A week of downtime lines up with a weekly operating period, and Crew Tools expires unspent days at "Start Next Session", so unspent company days lapse with the session. A company action is allowed only in the period it was started in.
- **Projects with a day requirement and slots** are tracked by NCI itself, since Crew Tools cannot host them: each spend adds progress.
- **Crew help:** other characters spending days on the same project add progress and a capped bonus.
- **Without Crew Tools**, a native allowance (a few business days per game week) takes its place.
- **Risks to confirm in a spike:** the exact signature of `use`, whether it returns an event id, whether a player client may call it, and how free-form events appear in the journal.
- **Other links, read-only:** rent and lifestyle as company overhead, HQ improvements as capacity, faction reputation as a bias on company reputation, `appendPayoutRecord` for dividends if you want one ledger.

### 26.9 Build order

1. Syndicate account, with units, roles, votes and visible positions.
2. Syndicate heat, broker and treasurer.
3. Charter flow: fee, three rolls, delay, the capital quote and funding window, GM approval and a private company with its cap table.
4. Business state, the five skill actions and the weekly period with monthly reports, as player-triggered rolls verified from the chat message.
5. Bridge module: Company Work through Crew Tools downtime, and projects.
6. Gigs for own company, and runner knowledge for heat (H4).
7. Listing: the valuation and eligibility checklist (§26.4a), the prospectus rolls, monthly reports, earnings impacts, the IPO price from *Q*, capped payouts and liquidity.
8. Control changes: takeovers, dilution, buybacks, insolvency.
9. Hidden ownership: nominee, then syndicate chains, disclosure threshold, and investigations.

## 27. After-tick order and dividend records (unreleased)

- **One after-tick sequence** (`init/registerTickSequence.js`). What the active GM runs after a market tick used to hang off three `priceTick` listeners in the market, portfolio and broker registrars, all started at once and none awaited. It is now one list, run in order with each step awaited: IPO listings, automatic splits, dividends, fund distributions, gig headlines, orders (with alerts and withdrawals), the heat audit, notifications, statements. Each tick's sequence waits for the previous one, and a failing step is logged without stopping the rest. Corporate events come first so orders are worked against the listings and splits as they now stand.
- **Dividend records are changed through `MarketStore.updateDividendRecords(fn)`**, which applies `fn` to a fresh read inside a queue. The dividend service used to write back, at the end of its check, a copy it had read at the start, which could erase a fund distribution recorded meanwhile; the fund's distribution was then announced again on the next tick. `phase5ExtrasFlow.test.mjs` covers the case.
