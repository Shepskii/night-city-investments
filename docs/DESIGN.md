# Night City Investments: design and development log

This is the module's design record and build log, kept as the work goes. Part 1 is the original design of the market and its foundations, with the decisions taken (§14). Part 2 records what each market release built, in order. Part 3 is player businesses and syndicates: their design (§27), then each phase as built, in order. Part 4 holds the proposals not yet built and, last, the roadmap (§37).

For using the module, see the [README](../README.md), [Getting started](GETTING-STARTED.md), the [player guide](PLAYER-GUIDE.md) and the [GM guide](GM-GUIDE.md).

## Contents

**Part 1. Foundations**

- §1 Goals
- §2 Ecosystem fit and dependencies
- §3 Architecture principles
- §4 Data model
- §5 Price model ("realistic-ish")
- §6 Orders, trading, and execution
- §7 Dividends
- §8 Pool investments (funds)
- §9 Messenger integration
- §10 Night City Map integration (separate bridge module)
- §11 GM controls
- §12 Additional core functions
- §13 File tree
- §14 Decisions

**Part 2. The market, as built**

- §15 Phase 4 as built (v0.4.0)
- §16 Phase 3 completion (v0.4.1)
- §17 Phase 5 (v0.5.0)
- §18 Phase 5 optional extras (v0.5.1)
- §19 Phase 6: Night City Map bridge (v0.6.0)
- §20 Broker voices (v0.6.1)
- §21 Insider-trading heat (H1 v0.7.1, H2 and H3 v0.8.0)
- §22 Phase 7: tools, migrations and docs (v0.9.0)
- §23 Tick clock, previews and broker removal (v0.9.2)
- §24 The game-day clock (v0.9.3)
- §25 After-tick order and dividend records (v0.9.7)
- §26 Market date, price paths and cleanups (v0.9.7)

**Part 3. Player businesses and syndicates**

- §27 Player businesses and syndicates: the design
- §28 Phase B1: side businesses (v0.10.0)
- §29 Phase B2: growing (v0.11.0)
- §30 Phase B3: syndicates (v0.12.0)
- §31 Phase B4: chartered companies (v0.12.0)
- §32 Employees (E1 and E2 in v0.12.0, E3 in v0.13.0)
- §33 Projects beside expansion (v0.12.0)
- §34 Phase B5: going public (v0.14.0)
- §35 Phase B6: corporate play (v0.15.0)

**Part 4. What comes next**

- §36 Proposal: after E3, B5 and B6
- §37 Roadmap

# Part 1. Foundations

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
6. **Hidden state stays out of players' windows.** GM-only parameters such as secret bias, scheduled events, true fair value, insider-trading heat, a business's Exposure and its applicants' hidden traits are stored in a **GM-only JournalEntry** (ownership NONE for players), and no window shows them to a player. This hides them from play, not from a determined player: Foundry sends every world document (and every world setting) to every connected client whatever its ownership, so anyone at the browser console can read the journal's flags. Confirmed in the test world on 2026-10-31, when a player client read a company's Exposure. The same holds for the business and syndicate journals: ownership decides who finds them in their windows, not whose client holds them. Truly secret state would need the GM's client to keep it and send players only bands; that has not been built, by choice.
7. **Every cash movement is a ledger line.** It is written to our trade log and, for deposits and withdrawals, to CPR `system.wealth.transactions`.

## 4. Data model

### 4.1 Company = JournalEntry (GM created)

Companies live in a dedicated Journal folder. The GM-authored page text is the public lore, and journal ownership controls who sees it.

Two implementation options:

- **Flags plus a "Company Editor" dialog.** The Company Editor also creates and deletes companies.
- A custom JournalEntryPage sub-type was considered and dropped (§14).

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

The performance chart on the terminal is not stored: `portfolioPnl` (`scripts/engine/portfolioHistory.js`) rebuilds it from the ledger and the daily closes, so it reaches back only as far as the ledger keeps (200 entries) and leaves out private stakes, which have no daily price.

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

> **Superseded in part by §15 (Phase 4 as built).** Broker tiers are replaced by skill-derived terms, and funds are broker-only.
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

*As built: see §19. The core API differs a little from the sketch below (`reportImpact` takes the gig's own fields and does the client matching itself).*

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
  - Suggest companies from NCM master-contact `organization` values and from NCMap gig `client` strings. Built in phase 7 (§22).
  - Migrating the old macro (`world.nightCityMarket`, `Acciones X` items) is **dropped**: it will not be needed.
- **Starter content (compendium):** an editable starter set of real Cyberpunk RED corporations (for example Arasaka, Militech, Biotechnica, Trauma Team, Petrochem, Kang Tao). The GM can edit or delete any of them and can create new companies from the Company Editor. The macro's Spanish real-world companies are not carried over.
- **Macros:** world macros created from the GM Console's Tools tab (open the terminal, open the console, advance a tick, run the self-check). A compendium pack was not used: Foundry packs are binary databases, and plain world macros are easy to edit and leave in place.
- **Public API and hooks** (`apiVersion`): documented in [API.md](API.md). The hooks are `night-city-investments.priceTick`, `.orderFilled`, `.dividendPaid`, `.companiesChanged` and `.apiReady`, plus `.ready` once the whole API is attached.
- **Migrations:** a single `schemaVersion` world setting and an ordered list of pure steps (`engine/migrations.js`), run by the active GM on load (§22).
- **i18n:** English only (`lang/en.json`). Strings still go through `game.i18n`.
- **Audit and diagnostics:** a GM trade log and a `game.nightcity.investments.verify()` self-check, both in the Tools tab (§22).

## 13. File tree

The plan as first drawn up, kept for the record; the README's Layout lists the folders as they are now.

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

**Entry points:** "Market Terminal" (all users) and "Market GM Console" (GM only) buttons in the Token Controls scene-control group, where other modules already add theirs, plus `game.nightcity.investments.open()` for macros. A separate group on the `controls` layer was tried and dropped: Foundry v12 selects the first group on a layer, so it blocked Night City Messenger's group. A keybinding is now registered for each window (§22), unbound by default.

## 14. Decisions

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

# Part 2. The market, as built

## 15. Phase 4 as built (v0.4.0)

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
2. Check: the player rolls INT + Accounting + 1d10 (a 10 explodes, a 1 subtracts) against the DV (default 13) when they press Connect, on their own client, with a chat card and Dice So Nice. Numbers in a request are never trusted. From v0.9.5 the request carries only the card's id; see §27.0.
3. A pass opens a session for N market days (default 1). A fail locks the character out for M market days (default 1), doubled on a fumble.

**Funds** (`engine/funds.js`): NAV is derived from the components' prices with a divisor, earns their dividend yield and pays an expense ratio each tick. Splits multiply the weights so value is unchanged; editing a fund rebases the divisor so the NAV does not jump. Funds are market-only and broker-only. A broker's skill waives up to 90% of the entry or exit charge and shifts execution timing in the client's favour (a seeded draw per order, so a skilled broker usually beats NAV and a rookie often does not). Closing a fund pays every holder its current NAV.

**Mail.** A client mails their assigned broker: `BUY 10 ARA`, `SELL 5 MIL @ 80`, `SELL ALL ARA`, `WITHDRAW 5000`, `STATUS`, `CANCEL <ref>`, `HELP`. Only the assigned broker acts on a client's mail. Each message is handled once (by message id). Replies carry the broker's voice by grade. Players can also trade from the UI.

**Notifications** are opt-in per category (order results, dividends, headlines, daily digest) with mail, chat or off. Defaults: order results and dividends by mail, headlines and digest off. A broker-paid withdrawal is always mailed, because the mail carries the money. Market mail comes from a send-only "Night City Market Wire" contact.

**Safety.** A withdrawal is marked paid before its mail is sent. If the mail fails, the money returns to the balance and the player is told. Broker fee profiles are snapshotted onto each order, so a later skill or setting change cannot reprice an open order.

**Leaving CorpNet ends the session** (added after B3). Each player's client listens to NCM's network events (`network:changed`, `connected`, `disconnected`, `authSuccess`) through `NcmAdapter.onNetworkChange`, and `NetworkWatcher` checks once at startup too. When the client is no longer on CorpNet, or no longer signed in to it, it sends `disconnectTerminal` for every live session on the user's own characters that came from the network; the executor ends it and the player is told. A session the GM granted is not tied to the network and stays. A syndicate's session records the officer who opened it (`session.by`), and ends when that officer leaves.

**Not yet verified in a live world:** NCM's `message:sent` payload for a contact with no linked actor, that players can message an unshared broker contact, and the `Roll` and chat card for the Accounting check. The Node tests use a fake Foundry and a fake NCM.

## 16. Phase 3 completion (v0.4.1)

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

## 17. Phase 5 (v0.5.0)

**Price alerts** (`engine/alerts.js`). A player picks a stock or fund and a condition: rises above a price, falls below a price, or moves by N% (0.5 to 50) in one day. Alerts live on the portfolio, set through the normal request outbox (`setAlert`, `removeAlert`) so only the GM writes them, up to 20 each. They are checked after every tick, after orders are worked. An alert fires when it first becomes true. A "once" alert is then spent; a repeating one disarms until the condition clears, so it does not fire every tick. A price alert that is already true when set is refused rather than firing on the next tick. The last ten that fired are kept on the portfolio and shown in the terminal, whatever the notification channel; the alert itself is delivered by the "Price alerts" category (mail from the market wire by default, or chat, or off).

**Statements** (`engine/statements.js`, `StatementService`). A statement shows the opening and closing value, money paid in and out, trading, fees, dividends, performance, realised and unrealised profit, and every holding with its share of the portfolio. Performance strips out deposits and withdrawals (a refunded withdrawal counts as neither), so it is the return on the money, not the movement of the balance. Flows are summed from the account ledger, which keeps the latest 200 entries, so a very busy month can under-count.
- **On request:** "Send me a statement" on the Portfolio tab, or `STATEMENT` mailed to a broker. Always mailed, by the player's broker or the market wire. It does not move the monthly baseline.
- **Monthly:** on the first tick of each in-world month, to players who have turned on the "Monthly statement" category (off by default). The baseline moves forward for everyone whether or not it is sent, and a portfolio seen for the first time only records one, so opting in never produces a statement for the whole history.

**Fund rebalancing** (`engine/funds.js`). A fund has `rebalance: none | monthly | quarterly`. Holdings are fixed share counts, so winners slowly take over the fund; a rebalance re-weights them back to the value mix recorded when the fund was created or last edited (`targets`). The divisor is rebased in the same step, so the NAV does not move. A bankrupt holding drops out and the rest scale up. The first tick a fund is seen only records its period, so creating or importing a fund never rebalances at once. Like dividends, it follows the in-world calendar, so a market that is advanced by hand without moving the clock does not rebalance. Because a rebalance changes a fund's definition, which an undo snapshot does not hold, that tick cannot be undone.

**Manager alpha.** `managerAlpha` is a yearly excess return (-10% to +10%) added to the fund's daily accrual alongside dividends and the expense ratio. A positive value is a manager who beats the holdings, a negative one a drag. It is deterministic; there is no random "skill" draw. Starter funds: NC12, NC20 and INFR rebalance quarterly; CHRM is a managed fund (monthly, +1.5% a year).

**Not built:** the optional capital-gains tax, which was left out on purpose. The other optional extras shipped in v0.5.1 (§18).

## 18. Phase 5 optional extras (v0.5.1)

**Sale-settlement delay.** A world setting, `settlementDays` (0 to 5, default 0, so nothing changes unless the GM turns it on). A sale still fills as before, but its proceeds do not reach the cash balance at once. They are held on `portfolio.unsettled` as `{id, assetId, amount, releaseTick}` and credited by `releaseSettled` at the start of the first tick on or after `releaseTick`. Settling money counts towards total value (so performance and statements do not jump) but cannot be spent, traded with or withdrawn, and an undo is not affected by it. The filled-order mail, the Trade window, the Portfolio summary and statements all say when it will arrive.

**Fund redemption delay.** A fund has `redeemDelay` (0 to 10 days). A fund sale settles after the larger of the world delay and the fund's own. Starter fund CHRM has 2 days.

**Distributing funds.** A fund is `accumulating` (the default; income stays in the NAV) or `distributing`. A distributing fund leaves its yield out of the NAV and accumulates it as `owed` per unit. At the start of each period (`distributionFrequency`: monthly or quarterly, on the in-world calendar, like rebalancing) the amount owed is fixed as `lastDist {key, perUnit, tick}`, and `FundDistributionService` pays it to holders as cash through the same dividend path as company dividends. Each period is paid once (the portfolio's `paid` list makes it idempotent), only units held before the fixing tick qualify, and a headline and the usual dividend notice go out. Starter fund SAFE distributes quarterly.

**Holdings movers.** A new notification category, `movers` (off by default). Players choose a threshold (1% to 50%, default 5%) on the Portfolio tab. After a tick, a holding that moved by at least that much in a day is listed in one message by mail or chat.

**Market ticker.** A client setting, `showTicker` (off by default), adds a slim strip of prices to the page. It always shows the NC index. After it come the player's **watched companies** (the star on a company's market page), up to four, in the order they were added, each marked with a star and shown even when flat; a watched company that is not trading is skipped. With nothing watched it shows the day's biggest movers as before (the two best gainers and two worst losers). The strip follows the player's assigned character, or the first one they own; a GM sees the watchlist only if they have an assigned character, and otherwise the movers. It refreshes with the market and when the watchlist changes, and a click opens the Market Terminal. It is a per-user setting, so each player decides for themselves.

**Not built:** capital-gains tax (excluded by decision).

## 19. Phase 6: Night City Map bridge (v0.6.0)

Two pieces: the core half in this module, and a small separate module, `night-city-map-night-city-investments-bridge` (v0.1.0, requires Night City Map and this module), that watches the map.

### The bridge module

`scripts/bridge-<version>.js` is one file (the version in its name stops browsers keeping an old copy after an update). `diffGigs(known, gigs)` compares each gig's status with the last look and returns the gigs that went from open (hidden, offer, active) to `done` or `failed`. The first look only records statuses, so gigs finished before the bridge loaded are not reported; a finished gig flipped between done and failed is not reported again; a gig created already finished is not reported. `createBridge()` takes its inputs as functions, so it is tested without Foundry. From v0.2.0 it scans whenever the map saves its gigs (the `updateSetting` and `createSetting` hooks for `night-city-map.state`): every gig change goes through the map's `save()`, so it needs no poll and no wrap of the map's code. Only the active GM queues reports, but every GM client keeps its record of statuses so a handover loses nothing. Reports wait in an outbox and are retried (up to 20 attempts) if the core is missing, too old, or throws. It sends `{gigId, sourceKey: "gig:<id>:<outcome>", outcome, client, reward, title, desc, notes, takenBy, runners}`, where `runners` is the character the map's `takenBy` names (§21, H4). One world setting turns reporting off.

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

Optional rumours: world setting `gigTips` (off by default) and a player notification category `tips` (off by default). When an impact is applied, opted-in players who hold or watch the company get a vague mail that says which way, never why. It comes from the player's own broker, in the broker's voice (§20), or from the market wire if they have no broker. The gig's headline, when the price starts to move, is also mailed this way to players who opted in to "Market headlines" (a broker-voiced lead-in, then the headline); all other news mail stays on the wire. The "from a gig" marker travels only with the in-session `newsPosted` hook, never in the stored public feed.

The Gigs tab of the GM Console lists what needs a company, what awaits approval, the saved mappings (with a form to add one), a form to report an outcome by hand (with the company named or left to be found), and the latest 15 outcomes. The tab title shows how many items need attention, and a notification tells the GM when one arrives. New settings: `gigImpacts` (master switch, on), `gigImpactScale` (1), `gigTips` (off); `gigImpactApproval` already existed.

### Not built

The insider-trading "heat" mechanic from §10 is being built in stages (§21). Gigs finished before the bridge was installed are deliberately not back-filled; the manual report covers them.

## 20. Broker voices (v0.6.1)

Modelled on the Night City Map / Night City Messenger bridge, where a fixer's mail follows the Personality on their character sheet.

- **Where the voice comes from.** `BrokerRepository.personalityFor` reads `system.lifepath.personality` from the broker's linked actor and matches it by keyword (`engine/brokerVoice.js`, `resolvePersonality`) to one of the ten Cyberpunk RED Personality entries: shy, rebellious, arrogant, moody, picky, stable, silly, sneaky, intellectual, friendly. "Friendly and outgoing", "FRIENDLY" and "quite friendly really" all work.
- **The fallback.** A broker with no linked sheet, a blank Personality, or text that matches none of the ten gets exactly the old mail: the facts, then the sign-off for their skill grade. Nothing about their terms, speed or skill changes with the voice; it is wording only.
- **What a voiced mail looks like.** A greeting, a line that suits the situation, the facts exactly as before, and a sign-off (which replaces the skill-grade sign-off). Subjects are unchanged, since players quote the order reference.
- **Situations.** Seventeen kinds, each tagged by `MailService` in a `voice: {kind, data}` on the mail spec: order accepted; bought; sold (flat, at a gain or at a loss, from the realised profit); rejected (orders and mailed requests); expired; withdrawal queued, paid and failed; cancelled; request not understood; help; account report (status and statements); not a client; and a rumour that is good or bad (§19).
- **Variety.** Each personality has five greetings, five sign-offs and four lines for every situation, except rumours, which have eight good-news lines, eight bad-news lines and six "hedges". A line is chosen at random and is never the one used last time from that pool. `{ticker}` and `{name}` are filled in where the mail has a company.
- **Rumours.** A voiced rumour is built entirely from the broker's pools: a greeting, a rumour line, a hedge ("you did not hear it from me"), and a sign-off. That is several hundred combinations per personality. A player with no broker, or a broker with no voice, gets the standard wording, which is also varied (4 subjects, 8 good-news lines, 8 bad-news lines, 6 hedges in `NCI.Mail.Tip`, picked at random with no immediate repeats).
- **Where it applies.** Only mail sent as a broker (`MailService.fromBroker`): replies to mailed orders, fills and other order notices, withdrawal mail, statements and rumours from the player's own broker. Market-wire mail (dividends, headlines, digest, movers, alerts) and chat notices stay as they were.
- **Content.** The lines are in `data/broker-voices.js` and `data/voices/<personality>.js`, English only, not in `lang/en.json`, like the starter companies. A test checks every personality has every pool, no repeats, only valid tokens, and no line shared between voices.
- **GM view.** The Brokers tab shows each broker's voice ("Voice: Sneaky and deceptive" or "Standard"). The voice is not editable: change the Personality on the sheet.

## 21. Insider-trading heat (H1 v0.7.1, H2 and H3 v0.8.0)

A gig outcome is private until its price effect starts to show. A character who trades the client in that gap, in the direction the news will move it, draws **heat**: a hidden 0 to 100 score per character that halves about every week. H1 records it; H2 warns and penalises; H3 lets a warned player fight back with skill rolls. The H1 text below is still accurate; H2 and H3 are described after it.

- **Off by default.** World setting `heatEnabled`; `heatStrength` (0.25 to 3, default 1) scales every gain.
- **Hidden.** The record lives in the GM-only control journal (`flags.night-city-investments.heat`), not on any actor, so no player window shows it (a player at the browser console could still read it; see §3, principle 6). The GM Console's Heat tab shows it, read-only.
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

A warned player can **cover their tracks** from the portfolio tab. Every attempt is a CPR roll (stat + skill + 1d10, with a natural 10 exploding and a natural 1 subtracting) made by the player on their own client when they press the button, against a DV, like the terminal's access check (`SkillAdapter.check`; the request carries the chat card's id and `SkillAdapter.verify` rebuilds the dice for `settings.checks`, see §27.0). It costs money whether or not it works and goes on a cooldown.

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

## 22. Phase 7: tools, migrations and docs (v0.9.0)

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

## 23. Tick clock, previews and broker removal (v0.9.2)

- **Default tick mode is the in-world clock** (§5.1): one tick per `realTimeMinutes` of Simple Calendar time, a date change moves the market date without a tick. `lastMs` joins `lastDay` in the public state; `_write` keeps it unless a caller supplies a new one.
- **Advance buttons** read "Advance 1 / 7 / 30 ticks" and "Advance N", and the starter macro is "Advance Market One Tick".
- **Previews open under their button.** The Market tab's sentiment preview sits below the sentiment form's Preview button, and the Events tab's shock and glide previews below theirs. The result block is one inline Handlebars partial (`previewBlock`) used three times; the stored preview carries its `kind` so only the matching form shows it. **From v0.9.6 the Preview button is the toggle** (`_togglePreview`): while its own preview is open it reads "Close preview" and pressing it closes the preview, and there is no separate close button under the result. Opening another kind's preview replaces the current one.
- **Removing a broker** (`BrokerRepository.remove`). A broker is an NCM contact with the `broker` tag, and the contact is never touched. Removal writes `{removed: true}` to that broker's entry in the `brokerDefs` setting, and `list`, `isBroker` and the picker honour it, so the broker disappears from the market and from mail handling. It is refused while a character has them as their broker (`assigned`) or still has an open order or a pending withdrawal through them (`busy`), because the first would leave a player with no broker and the second could not be mailed or paid. Making the same contact or character a broker again clears the flag.

## 24. The game-day clock (v0.9.3)

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

## 25. After-tick order and dividend records (v0.9.7)

- **One after-tick sequence** (`init/registerTickSequence.js`). What the active GM runs after a market tick used to hang off three `priceTick` listeners in the market, portfolio and broker registrars, all started at once and none awaited. It is now one list, run in order with each step awaited: IPO listings, automatic splits, dividends, fund distributions, gig headlines, orders (with alerts and withdrawals), the heat audit, notifications, statements. Each tick's sequence waits for the previous one, and a failing step is logged without stopping the rest. Corporate events come first so orders are worked against the listings and splits as they now stand.
- **Dividend records are changed through `MarketStore.updateDividendRecords(fn)`**, which applies `fn` to a fresh read inside a queue. The dividend service used to write back, at the end of its check, a copy it had read at the start, which could erase a fund distribution recorded meanwhile; the fund's distribution was then announced again on the next tick. `settlementDistributionsFlow.test.mjs` covers the case.

## 26. Market date, price paths and cleanups (v0.9.7)

- **The market's own date** (`marketDay` in `engine/clock.js`). It is `lastDay` (the calendar day of the last tick) plus `lead`, the game days a GM has advanced the market by hand. `lead` is engine state, so undo and calendar rollback restore it. Ticks that follow the calendar leave `lead` alone and take each tick's date from the calendar (one per day in the day mode, today in the in-world clock mode); `advance`/`advanceDays` add the whole game days they cover. `MarketClock.nowMs()`, `date()` and `dateString()` now give the market's date, and only the tick service reads the calendar itself, through `MarketClock.calendarMs()`. Dividends, fund rebalances and distributions (now dated per tick inside a run), IPO dates, monthly statements and the dates on news, heat and records all follow it. Before, a manual-mode advance moved prices but nothing that fell due on a date. The Market tab is relabelled "Market date" and says when the market is ahead of the calendar or in manual mode.
- **Gig runners (H4).** `api.events.reportImpact` takes `runners`, the ids of the characters who ran the gig; the bridge (v0.2.0) sends them. See §21.
- **Price paths** (`engine/pricePath.js`). `_runTicks` records every company price and fund NAV after each tick of a run and puts the path on the `priceTick` payload. The after-tick sequence hands it to `PortfolioService.onTick`, and `runOrders` and `checkAlerts` look at the part of it while each order was live (eligible to expiry) or since each alert was set. A limit the path reached fills at the limit; a stop at its level across the spread; met at the run's end, the end price is used as before. Price alerts fire on the path's high or low and report it. Daily-move alerts still compare today's close with yesterday's.
- **One-write saves.** GM records in the control journal and portfolios on actors are stored wrapped in a one-element array, which Foundry replaces rather than merges, so a save is a single write and removed keys cannot linger. Readers accept the old unwrapped form; `MarketStore.readRecord` and `PortfolioRepository.raw` are the readers the migrations use.
- **Shared helpers.** `L` lives in `utils/helpers.js` (`ui/format.js` re-exports it); `timeOf(state)` in `engine/clock.js` replaces the `time ?? tickIndex ?? 0` fallbacks; `utils/queue.js` `SerialQueue` replaces the hand-written queues. Awaiting a queue waits for everything queued so far, so `await X._queue` keeps working.
- **GM Console split** into `ui/GMConsole/tabs/<tab>.js` (each exports `actions` and `context(app)`) and `templates/gm/console/<tab>.hbs` partials, preloaded through the part's `templates`. Only the open tab's data is built.
- **Tests renamed by feature** (`brokersFlow`, `dividendsSplits`, `windows`...). Tests move the market's date with the market (`tests/helpers/marketDate.mjs`), not with the fake calendar, and their `settle` helpers wait for the after-tick sequence.

# Part 3. Player businesses and syndicates

## 27. Player businesses and syndicates: the design

Decisions so far: Crew Tools cannot be changed, so everything is NCI-side or in a bridge. Businesses start small and grow (§27.0): a side business needs no charter, and the charter and the listing are later stages a business earns. Hustle income stays personal and is unrelated to a company; a business's profit is separate, and reaches its owners only through capped draws or dividends. Payouts are capped. Syndicate holdings are visible to every member. The GM approves every company charter. All durations are game days (§24) and all writes follow the request, GM-executor pattern. The operating period is **weekly** with **monthly** published reports, to match weekly game sessions (§27.4).

**Roll rule: every player roll is triggered by the player.** Nothing in this section rolls for a player. A roll happens only when the player presses its Roll button (charter, business actions, report preparation, layering or investigating ownership), and the work is never forced on them.
- **Where it runs.** The roll is made on the player's own client as a normal Foundry roll with a chat card (and Dice So Nice), using `SkillAdapter.check` (stat + skill + 1d10, a 10 explodes, a 1 subtracts). The request carries the chat message id, not a total.
- **What the executor checks.** The active GM's executor loads that chat message, confirms it was authored by the requesting user and has not been used before, re-reads the stat and skill from the actor, and recomputes the total from the raw die. It then applies the DV, cost, allowance and cooldown. A total supplied in a request is never trusted. This model is **built (v0.9.5)** for the terminal check and the H3 cover-up actions (`SkillAdapter.check` on the player's client, `SkillAdapter.verify` on the GM's). It also checks that the card's author owns the actor, that the card is no more than 10 minutes older than the request, and marks it used by the request key, so a retried request is fine and a second one is not. A player who edits their own chat data could still forge dice; that is the usual table-trust limit, and the GM sees every card.
- **Not rolling is a valid choice.** An action nobody rolls simply does not happen. The weekly result is then the baseline (§27.4), with at most a small GM-tunable drift. The system's own event draw is not a player roll and stays on the engine.
- **One roll, one use.** A roll belongs to the action it was made for and cannot be reused. Retries, fees and delays are counted from the roll, in game days.

**Player levers on every roll.** A roll is a decision, not only a button. Cyberpunk RED's own levers apply, and the player sees what is at stake before rolling.
- **Who rolls.** Any officer (or, for the charter, any founder) may take a roll, so the crew chooses its best character for the job.
- **Approach.** Before rolling, the player picks **Careful** (DV −2, the effect scaled down), **Standard**, or **Bold** (DV +3, the effect scaled up, and some Exposure). Aggressive reporting (§27.4) is the Bold approach to report preparation.
- **Luck.** The player may spend LUCK points on the roll, as the rules allow. The roll dialog asks how many before rolling.
- **Complementary skill (+1).** A successful related check earlier in the same operating period, by anyone in the crew, leaves a one-use +1 on the company for the matching action (for example Library Search as market research before a Business roll, Human Perception to read the counterparty before a Bribery roll, Local Expert before a Bureaucracy roll). At most one is used per roll. A **role ability** can be the complementary check where it fits the action (a Fixer's Operator before Source supplies or a capital raise, a Media's Credibility before Promote, a Netrunner's Interface before due diligence), so every partner has a roll that matters each period without adding action slots. This replaces an ad-hoc crew-assist bonus, and gives characters who are not officers something to do.
- **Extra time (+1).** Spending an extra downtime day on the action (through the Crew Tools bridge, §27.8, or the native allowance) adds +1, as the rules allow for taking extra time.
- **Hired professionals.** A crew missing a skill an action needs (an Accounting roll for the charter, say) can hire an NPC professional for that one roll: an accountant, a lawyer, a broker. The fee is paid from the business (a Fixer's Operator lowers it), and the NPC's fixed base (GM table: about 10 for a cheap hire, 13 for a good one, 16 for the best) replaces the character's stat and skill. A player still presses Roll and may still add a complementary bonus, but not Luck, which is a character's own. It keeps every crew able to progress while rewarding characters who have the skill.
- **Preview.** Before rolling, the dialog shows the DV, the approach's effect, and what each outcome band would mean, so who rolls and how much Luck to spend are informed choices.

**DVs** follow the rulebook's ladder: Everyday 13, Difficult 15, Professional 17, Heroic 21, Incredible 24. A table maps each action, sector and size to a step on it, so a GM can tune by naming a step rather than a number.

**Outcome bands.** Every check uses the same bands, so the margin (total minus DV) always matters, as it already does for the capital quote (§27.2a):

| Band | Margin | Meaning |
|---|---|---|
| Fumble | natural 1 that fails | the action's fumble effect |
| Failure | below 0 | no effect; the cost is still paid |
| Narrow | 0 to 1 | a quarter of the effect |
| Solid | 2 to 5 | the effect |
| Strong | 6 to 7 | one and a half times the effect |
| Exceptional | 8 or more, or a critical | double the effect |

**Opposed rolls** are used where a person opposes the action, as the rules do: the acting roll must beat the opponent's skill total, which may be a stored total from an earlier roll (§27.6) or an NPC's skill from a GM table.

**What the executor also verifies.** The roll card records the approach, the Luck spent, and any complementary bonus used. The executor checks that the actor's LUCK pool went down by the Luck claimed, consumes the stored complementary bonus (it cannot be used twice), applies the approach's DV, and recomputes the total from the raw dice as before. The roll itself is still never trusted.


### 27.0 Stages: from side business to listed company

Most player enterprises in Night City are small: a garage, a ripperdoc's back room, a bar, an info shop. They start with a little gear and a lot of hustle, and only a few grow big enough to justify a charter, let alone a listing. The design therefore has four stages, and a business moves up by meeting a stage's milestones and passing a step-up roll. Growing is meant to be the usual path to a large company, and the cheaper one (§27.2a).

| Stage | What it is | To start or step up | Weekly profit (typical) | Action slots | Reporting | Money in |
|---|---|---|---|---|---|---|
| 0. Side business | unregistered: a stall, a garage bay, a back-room clinic | a founding agreement, one setup roll, 500 to 3,000 eb of gear and stock, no charter, GM approval by setting | 20 to 150 eb | 1 | weekly digest | owners' own money, fixer loans |
| 1. Registered business | a licensed shop, bar, clinic or outfit | milestones below + a registration roll + a fee | 150 to 600 eb | 2 | private monthly ledger | + bank loans, private investors |
| 2. Chartered company | §27.2: a company with a cap table and officers | milestones below + the charter (§27.2) | 600 eb and up | 2 to 4 by capacity (§27.4) | monthly report (§27.4) | + private placements, capital raises |
| 3. Listed company | §27.4a | the listing requirements | market priced | as a company | public report | + IPO and the market |

The profit bands are calibrated against the valuation (§27.4a): at a typical sector multiple of 10, a side business is worth about 12,000 to 80,000 eb, a registered business about 90,000 to 330,000, and a chartered company reaches the 500,000 eb listing threshold at around 850 eb of weekly profit. A registered business stays under the threshold even at the top sector multiple, so a listing always passes through the charter. Measured with the business simulator (B0, §27.9), at the default **growth rate** of 1 a strong crew that reinvests becomes eligible to list in about 50 operating periods, an average crew in about 80, and a weak crew rarely. The milestones alone set a floor of about 28 periods (4 before registering, 3 monthly ledgers before the charter, and 3 reports above the threshold before a listing), so no business lists sooner however well it is run. The growth rate setting scales every growth effect to fit the campaign's pace: at 1.5 a strong crew lists in about 40 periods and an average one in about 64.

**Ownership and partners.** A business has a cap table from the day it opens, so several characters can found it together and nothing has to be restructured as it grows:
- **Units.** Each partner's contribution buys units at book value: cash at face value, and gear brought in (a surgical kit, a workshop's tools) at a book value the partners agree and the GM can review. Money put in later buys units at the current book value per unit, so early partners are not diluted unfairly. Units sit in the partners' portfolios like restricted shares (§27.3).
- **The founding agreement**, made when the business opens and changed only unanimously, records:
  - **Sweat equity:** an optional slice of units for the partner who will do most of the work (default 0%, capped at 10% as in §27.2a).
  - **The decision rule:** majority of units for day-to-day choices, such as who takes each action slot, draws, loans and projects. Unanimity is needed to admit an investor, sell or close the business, step up a stage, or change the agreement. The partners may choose stricter rules, as a syndicate does (§27.1).
  - **The buy-out rule.** Night City is lethal, so when a partner dies, leaves the campaign or wants out, the remaining partners may buy the stake at book value within 14 game days (from the till, their own money, or a loan). Otherwise it passes to whoever the character named, as non-voting units that still receive draws. The GM can apply it when a player leaves the table.
- **Draws and decisions follow units.** A syndicate can be a partner, or own the whole business, acting by its own approval rules (§27.1).
- **Into a company.** At the charter, units convert one-for-one into restricted shares, so the cap table carries straight on to the company and, later, the float (§27.2a).

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

The GM can add archetypes. A business at stage 2 or above maps its archetype to a market sector (§27.4) for the backdrop and the earnings multiple.

**Location.** A small business has an address: a place on Night City Map (one of its locations, or a pin the GM adds). The district sets foot traffic (a multiplier on takings) and risk (how often shakedowns and gang trouble come up), so a stall in the Combat Zone is cheap and dangerous and a boutique in the Executive Zone is the reverse. Showing businesses on the map is a job for the map bridge.

**The small business loop (stages 0 and 1).** It runs on the weekly operating period (§27.4) but is simpler than a company's: no officers (the partners decide by their founding agreement), no public report, and fewer, more personal actions. Partners who do not take the slot still play a part through complementary checks, including role abilities (the player levers above). Each action uses a slot and is an ordinary player-triggered roll with the levers (Luck, complementary +1, approach):

| Action | Skills | Effect |
|---|---|---|
| Work the shop | the archetype's trade skills | the week's takings: the outcome band scales the archetype's base takings |
| Promote | Persuasion, Wardrobe & Style, Composition; Media Credibility, Rockerboy Charismatic Impact | Reputation and foot traffic up for the next periods |
| Source supplies | Trading, Streetwise; Fixer Operator | the Cost base down, or rare stock in |
| Fix the place up | Basic Tech; Tech Maker | Capacity up (more takings possible) |
| Keep it safe | event responses (§27.4), Tactics, Persuasion; Solo or Lawman | answers shakedowns, theft, gang trouble |

An unrolled week is not a closed shop: takings default to the archetype's baseline, with neglect drift (§27.4). The business may also take on **expansion projects** (a second chair, a bigger bay, a second location) with a day requirement, tracked like §27.8's projects and paid from the till; finishing one raises Capacity.

**Money at the small stages.**
- **The till.** Takings go into the business's own account; rent, stock, wages, licence fees (registered only) and protection money (unregistered, or in rough districts) come out each period.
- **Owner draws.** Owners may draw up to the last closed period's profit, split by units, into their wallet (stage 0) or brokerage balance (stage 1), as a request through the executor. This is the small-business equivalent of a capped dividend (§27.7): it cannot exceed what the business earned, and draining the till leaves nothing to grow with.
- **Loans.** A **fixer loan** (stage 0 up): quick, no paperwork, a high weekly rate, and missed payments bring heat and a visit. A **bank loan** (stage 1 up): an Accounting or Business roll sets the rate and limit from the business's ledger; lower rates, and missed payments hurt Compliance. Repayments come out of the till each period.
- **Private investors** (stage 1 up): another player, a syndicate, or an NPC angel buys new units for cash, admitted unanimously by the partners. A player or syndicate investor buys at book value per unit unless the partners agree a premium. An NPC angel's price comes from a Persuasion or Trading roll opposed by the angel's skill. Investors become holders, so a later charter starts with them on the cap table.
- **Failure.** A till below zero for two periods with no loan to cover it closes the business; its gear sells for a fraction of its value. Owners can start again.

**Stepping up.** Milestones are shown as a checklist, like listing eligibility (§27.4a), and the step-up roll is player-triggered:

| Step | Milestones (defaults) | Roll | On failure |
|---|---|---|---|
| Side → Registered | 4 periods operating, average profit of 100 eb a week over the last 4, Reputation of at least 45, just under the baseline (§29) | Registration: Bureaucracy (Local Expert or Persuasion at DV +2), plus a fee of about 500 eb | the fee is spent and a delay of 7 game days; nothing is lost |
| Registered → Chartered | 3 monthly ledgers, average profit of 400 eb a week over the last 4 periods, Capacity from at least one expansion | the charter (§27.2), with the business plan roll one DV step easier for a business with a track record | as §27.2 |
| Chartered → Listed | §27.4a | the prospectus rolls (§27.4a) | as §27.4a |

Registering lowers protection costs and shakedown risk, unlocks bank loans and investors, and brings licence fees and Compliance. A business can also stay at its stage for good; that is a normal choice.

**Gigs and heat at the small stages.** Gigs naming the business as client affect its takings and Reputation as for companies (§27.5). A business has no share price until it is listed, so before then there is no insider-trading window; investors in a private business trade only privately.

**Worked example: a Medtech and a Fixer.** Two characters open a back-room ripperdoc clinic in Watson and mean to take it public.
1. **Founding (stage 0).** The Medtech puts in 1,000 eb and her surgical gear (book value 800); the Fixer puts in 1,500 eb. That is 1,800 units to 1,500, about 55% to 45%, and they agree a 5% sweat slice for the Medtech, who will do the surgery. The Fixer makes the setup roll with **Operator**, finding the space and second-hand gear, and a Strong result keeps the setup cost low.
2. **Weekly, with one slot.** The Medtech takes **Work the shop** with Cybertech, which sets the week's takings. The Fixer rolls Streetwise to steer patients her way, a complementary check that adds +1 and uses no slot. When a gang comes for protection money, the response uses the slot that week: the Fixer answers with Persuasion, and the surgery waits. Draws split 55/45.
3. **Registering (stage 1, two slots).** Neither partner has Bureaucracy, so the Fixer rolls Persuasion at DV +2. Now both act each week: the Medtech works the shop, and the Fixer sources chrome with Operator, takes a bank loan for a second chair (an expansion project), and brings in a Solo character as an investor, admitted unanimously, buying new units at book value.
4. **Chartering (stage 2).** The clinic's net assets go toward the capital quote, and the units become restricted shares, the Solo included. The Fixer rolls the business plan (Business, or Persuasion at DV +2). With no Accounting in the crew, they hire a good accountant for the capital structure roll, the Fixer's Operator lowering the fee. Both partners are elected officers.
5. **Listing (stage 3).** Once the requirements are met, the Fixer carries the prospectus **Trading** roll, and his Operator widens the NPC buyers for the float. The Medtech's part is the one that lifts the valuation: keeping the earnings up.

Each role keeps a clear job the whole way: the Medtech makes the money, the Fixer makes the deals. If the Medtech is flatlined along the way, the buy-out rule lets the Fixer buy her stake at book value, or it passes to whoever she named.

### 27.1 Syndicates

- **A shared account.** A syndicate is an actor flagged `syndicate` with an ordinary portfolio, so the terminal, executor, valuation and statements work unchanged. Every member sees its **holdings, positions, orders and ledger**. Members have ownership of the actor; writes still go through requests.
- **Units.** A member's deposit buys units at the current NAV (fund arithmetic), and a stake is units × NAV. Restricted shares of a private player company have no market price, so they count in the NAV at the company's valuation *V* per share (§27.4a), updated at each monthly report. Withdrawals are pro rata, by vote or by redemption request, with the usual delays. Fees (founder's cut, management fee) are GM-tunable sinks.
- **Roles and rules.** Founder, officer, member. Each syndicate picks an approval rule per action type (any officer, majority of officers, majority of units) for trades above a size, withdrawals, admission and removal, rule changes and dissolution. Proposals have a game-day deadline and are voted on in the terminal. The GM can force or veto.
- **Broker and treasurer.** One assigned broker. A designated treasurer's Accounting skill sets terms, or "best member's" if the syndicate prefers.
- **Heat is collective.** A rumour sent to one member is knowledge for all (`tipped`). Same-day orders by members add up for the size factor, so splitting trades does not avoid heat. Penalties land on the account, and the GM may pass them to members.
- **Later:** optional market impact for large pooled orders, and coordinated campaigns using Trading and Bribery rolls.

### 27.2 Forming a player company

A company can be chartered from scratch or by growing a registered business (§27.0); the steps are the same, and a growing business brings its track record and its net assets (§27.2a).

1. **Draft a charter:** name, ticker, sector, authorised capital, founders and their stakes (characters or a syndicate), and whether a listing is intended (a note only: listing must be earned, §27.4a).
2. **Pay the filing fee** (scaled by sector and authorised capital). It is spent on the attempt whether or not it succeeds.
3. **Three skill rolls**, each made by a founder on their own client when they choose to press Roll (see the roll rule above), against a DV set by sector and size. Each slot stays open until it is rolled, and any founder can take it:

   | Roll | Skill | Covers |
   |---|---|---|
   | Business plan | Business | the concept, market and management |
   | Registration | Bureaucracy | licences, permits, jurisdiction |
   | Capital structure | Accounting | books, share structure, filings |

   Founders can share the three rolls between them. Help from the rest of the crew uses the complementary skill rule (+1, see the player levers above), not a separate bonus.
4. **Outcome.** Only the **capital structure (Accounting)** roll must pass for the charter to proceed: a failure there costs the fee and sets a **refiling delay** (default 7 game days), and a fumble adds to the delay. A failed **business plan** or **registration** roll is a setback, not a refusal: the company starts weaker (see below), and a failed registration adds a delay of 3 game days and a surcharge on the fee. Rolls that passed are kept for 30 game days and the retry fee is lower. Requiring all three to pass would refuse most ordinary crews: a character with stat 6 and skill 4 passes DV 15 about 60% of the time, so all three pass only about 22% of the time. A passed Accounting roll sets the **capital quote** (§27.2a).
5. **GM approval.** The GM reviews the charter, the rolls and the quote, and may edit the terms, approve or reject (a rejection can refund the fee, by setting).
6. **Fund it.** Players deposit the quoted starting capital into the company account within the funding window (§27.2a). Nothing is formed until it is fully funded.
7. **Signed.** The company is formed as **private**, with a cap table made of restricted shares in the contributors' portfolios.

**Starting state.** Each charter roll's outcome band (see the player levers) sets where the company starts, so the rolls matter from day one rather than months later at a listing:

| Roll | Sets |
|---|---|
| Business plan (Business) | starting Reputation and Revenue run-rate |
| Registration (Bureaucracy) | starting Compliance |
| Capital structure (Accounting) | the capital quote (§27.2a) |

A failed business plan or registration starts that part of the state below the sector baseline; an exceptional one starts it above. The IPO price, if the company ever lists, comes from the prospectus rolls at that time (§27.4a), not from the charter.

### 27.2a Starting capital

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

**Afterwards.** Founding capital is the company's money, not the players'. It cannot be withdrawn, only paid out as capped dividends (§27.7) or bought back, and a lock-in (default 28 game days) stops a company being formed and drained straight away. Fees and the lock-in are the sinks that stop a quick eb machine.

**Growing into a charter.** A growing business charters at the tier that fits its size, usually **Startup**: the business simulator (B0) showed that a registered business's net assets and its owners' savings rarely reach a Small quote, while they largely cover a Startup one. When a registered business is chartered (§27.0), its **net assets** (the till, gear and completed expansions, at book value, less debts) count toward the capital quote, so the owners pay in only the difference. Its units convert one-for-one into restricted shares, so partners and investors keep their stakes on the company's cap table. Earned capital is not new money, so the lock-in on valuation (§27.4a) does not apply to it; only cash newly paid in waits. This is what makes growing the cheaper path to a large company.

**Interaction with the other rolls.** The Business and Bureaucracy margins do not change the quote; they set the starting Reputation, Revenue and Compliance (§27.2). A founder with a poor Accounting skill can improve the quote by having a better accountant make the roll, since any founder may take the slot, and by spending Luck or using a complementary bonus on it.

### 27.3 Ownership and control

- **Cap table.** Shares are ordinary lots in portfolios (`assetId` = the company). While the company is private they are flagged `restricted`: they cannot be sold on the market, only transferred privately (GM approval optional). A listing opens the float and lifts the restriction on the shares sold.
- **Holders** can be characters, syndicates, the broker's nominee account, or the company's own treasury. A founder can be an individual or a syndicate, so a company can be owned collectively either way.
- **Control.** Holders of more than half the votes control the company. Officers are elected by shareholders weighted by shares. Only officers may take business actions, and the officer who chooses an action rolls it.
- **Takeovers and dilution.** Building a controlling stake transfers control, with GM approval. New issues, buybacks and delistings use the existing corporate actions.

### 27.4 Business activity

- **Stage.** This loop is for chartered companies (stage 2 and up). Side and registered businesses use the simpler loop in §27.0, and a business keeps its state (Reputation, Capacity, Cost base and so on) when it steps up.
- **State.** Visible to officers: Capital, Revenue run-rate, Cost base, Reputation, Compliance, Operating capacity. Hidden: **Exposure**, which comes from shortcuts and aggressive reporting, like heat.
- **Cycle: weekly operating period, monthly report.**
  - **Weekly period.** One period is 7 game days, anchored to a GM-chosen weekday (default: the day of the weekly session) and run on the game-day clock, so the first tick on or after the boundary closes it. Catch-up after a calendar jump closes each missed period in order, up to a cap.
  - **What closes a week.** Outcome = state + the sector's backdrop + the actions the officers rolled that week + the GM-editable event tables. It updates the business state and is **private to officers** as a short weekly digest in the terminal. It does not move the share price.
  - **Monthly report.** On the in-world month boundary (the same rule as statements and monthly dividends; every 28 game days if there is no calendar), the company publishes a report that sums the weeks closed in that month (four or five). The result is a headline and an **earnings impact** on fair value (the surprise against expectations), with delay and decay. Dividends follow the report, still capped (§27.7).
  - **Actions per week.** The **company** has a number of action slots each operating period, set by its Operating capacity (default 2 for a startup, 3 for a small company, 4 for an established one; a GM setting). The officers decide together who takes each slot and rolls, so the question is who is best at the job, and adding officers does not add actions. Costs are paid from company capital. The slots reset when a period closes. Complementary checks (the player levers) do not use a slot.
  - **Report preparation.** In the last week of the month an officer may roll Accounting to prepare the report. No roll means standard reporting: no bonus and no risk. Aggressive reporting is the Bold approach: a bigger surprise now and more Exposure later. The roll's total is stored, and a later regulator audit of that report is an opposed check against it (§27.6).
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
  | Fixer | Operator | better deals: lower fees and capital quote, an easier capital raise, more NPC buyers for a thin stock (§27.7) |
  | Media | Credibility | plant a story: Reputation up, a bad report softened, or a rival smeared, through the news feed |
  | Netrunner | Interface | corporate espionage: reveal a rival's Exposure band or one of its ownership layers (§27.6) |
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

### 27.4a Going public: listing eligibility

A player company stays **private** until it has earned a listing. The Draft charter's "listing intended" box only records intent. It never opens the IPO flow (§18, `IpoService`) by itself.

**Valuation.** A private company has no share price, so the engine computes a **market valuation** *V* from its business state. Players cannot set it, and it is recalculated at every monthly report:

*V* = (net assets + capital) + (annualised net profit of the last 3 monthly reports × the sector earnings multiple)

- Net profit is clamped at zero, so a loss-making company is valued on assets alone.
- The sector multiple is a GM table (default 6 to 14).
- Capital that was put in recently does not count at once: new founding or extra capital joins *V* only after the lock-in (§27.2a), so paying in a lump sum does not buy a listing. The same goes for any later capital raise.
- The GM can apply a one-off valuation adjustment with a reason, and it is logged.

**Requirements.** A company can apply when all of these hold:

| Requirement | Default |
|---|---|
| Valuation | *V* at or above the **listing threshold** of 500,000 eb (above the top charter tier, GM-tunable) |
| Sustained | at or above it on 3 consecutive monthly reports (a single spike does not count) |
| Track record | at least 3 published monthly reports and 56 game days since formation |
| Compliance | at or above the GM's minimum, with no open audit finding |
| Exposure | hidden Exposure below its cap. The checklist shows this as "unresolved compliance concerns" without the number; an internal audit (§27.4) reveals the band and can bring it down |
| Float | the founders agree to float at least 20% of the shares, and to keep a 28-day lock-up on the rest |

**The steps.**
1. **Eligibility is shown, not rolled.** Officers see a checklist of the requirements and their current standing. Nothing in it is a roll.
2. **Apply for listing.** An officer pays a listing fee (a percentage of *V*, a sink) and the GM approves.
3. **Prospectus rolls, player-triggered.** An officer rolls Accounting (the filing) and Trading (the offering), with the usual levers (Luck, complementary bonus, approach). A pass is required for each. A failure costs the fee and a refiling delay (default 14 game days).
4. **Offering price and float.** Price = *V* per share × a prospectus factor from the two rolls' outcome bands (about ±15%, so market reality dominates; a Bold offering widens it). The float size is capped by NPC demand (§27.7), which the Trading roll's band also sets.
5. **IPO flow.** The company then runs through the standard announced IPO and subscription window. The first price comes from that offering, and its first day of trading starts the usual price model.

**After listing.** *V* is replaced by the market price. A **delisting review** applies hysteresis: a market capitalisation under 60% of the threshold for 3 consecutive reports (a GM setting) puts the company under review, and the GM can delist it or give it time. A company that fails the requirements after applying simply does not proceed, with no penalty beyond the fee.

**Not eligible is a normal state.** Until then the company trades in private only (§27.3), with its restricted shares, and gets the full business loop. Listing is a milestone, not a requirement.

### 27.5 Gigs for a player's own company

When a gig run by players names a player business or company as its **client** (at any stage, §27.0), it is a **business activity**, not a market rumour:
- `resolveClient` matches the player company as it does any client, but the outcome is applied to the company's **business state** (reputation and revenue up on success, down on failure, scaled by reward and capped) instead of as a direct price impact. The company acquiring assets, contracts or goodwill is outside NCI and is handled in play.
- The reward itself is paid or not by Night City Map as usual; NCI does not turn it into company cash.
- The price follows only through the next report, so the usual delay applies. GM approval is on by default, with monthly caps and diminishing returns to stop self-dealing.
- The players who ran it are the **gig runners**, which is exactly what heat stage H4 was reserved for (weight 1.5), so an owner trading around their own gig draws the most heat.
- A gig for a **rival** company as client works the same way, and a GM can use it for storylines.

### 27.6 Hidden ownership

Yes, with layers and costs, so concealment is a game and not a switch.
- **Layers.** (a) **Nominee through a broker:** the shares are held in the broker's nominee account and the public register shows the broker. (b) **A syndicate:** the register shows its name, and the member list is visible to members only. (c) **A syndicate holding a syndicate:** a chain, with each layer costing fees and a Bureaucracy or Accounting roll. Control rights still work through a nominee.
- **Rules that make it risky.** There is a disclosure threshold (default 5% of a listed company). Staying hidden above it is concealment, which adds Exposure and heat, and it fails if the regulator looks. A concealed holder trading around company events has a heat multiplier.
- **Uncovering.** Building a layer is a roll by its owner (Bureaucracy or Accounting), and its total is stored with the layer. Other players can investigate with a downtime-driven Library Search, Streetwise or Bribery roll, or a Netrunner's Interface (§27.4), started and rolled by the investigator. It is an **opposed** check: the investigator must beat the stored total of the layer they are trying to see through, plus 2 for each layer above it, so a well-built shell stays hard to crack and a careless one does not. A regulator's audit is decided by the engine or GM, not by a player roll; where it tests a report, it is opposed by that report's stored preparation total (§27.4). Brokers and syndicate members can leak by chance (engine), or be bribed by a player who chooses to roll Bribery. A takeover or an audit can unmask.
- **Where the truth lives.** The real holder is always in the GM-readable portfolio. No player window shows another's portfolio, and the register players see is computed by the GM and published as a public setting containing only what is disclosed (a player at the browser console could still read the portfolios themselves; see §3, principle 6).

### 27.7 Capped payouts

- **Dividends** = min(declared, profit-based, a GM sector ceiling × company size, a per-holder monthly eb cap). The excess stays in the company as capital, and its effect on the price is itself capped.
- **Sinks:** filing and registration fees, the listing fee, a withholding rate on dividends, broker commissions.
- **IPO proceeds:** a new issue raises company capital, not player cash. A sale of founders' shares pays real eb only as far as buyers exist; NPC demand per IPO is capped.
- **Liquidity:** a player company has limited depth. The market's usual infinite liquidity is replaced by a per-game-day NPC absorption cap sized by float and the offering's Trading band (raised by a Fixer's Operator, §27.4), with market impact on, so a thin stock cannot be used as an eb machine.

### 27.8 Downtime with Crew Tools, bridge only

Crew Tools exposes `api.downtime` (`getState`, `use`, `startNextSession`), `api.calendar`, `api.headquarters`, `discoverPlayerAccounts` and `appendPayoutRecord`, but no completion hook and no way to register an activity.
- A **bridge module** (like the Night City Map ones) adds a **Company Work** panel. Choosing an activity spends days through `downtime.use` as a free-form spend with a recognisable description, then sends NCI a request carrying the resulting event.
- NCI's executor **verifies** the event in the character's downtime log (read-only) before it applies the action, and uses its id to stay idempotent. The player presses Roll for the action; the executor never rolls for them.
- A week of downtime lines up with a weekly operating period, and Crew Tools expires unspent days at "Start Next Session", so unspent company days lapse with the session. A company action is allowed only in the period it was started in.
- **Projects with a day requirement and slots** are tracked by NCI itself, since Crew Tools cannot host them: each spend adds progress.
- **Crew help:** other characters spending days on the same project add progress and a capped bonus.
- **Without Crew Tools**, a native allowance (a few business days per game week) takes its place.
- **The spike** (B0, §27.9) answered from the Crew Tools source: `use` takes positional arguments and returns no event id, so the bridge tags the event through `projectId`; a player's client may call it; events are kept on the character's Downtime Log page. Still to run in the test world.
- **Other links, read-only:** rent and lifestyle as company overhead, HQ improvements as capacity, faction reputation as a bias on company reputation, `appendPayoutRecord` for dividends if you want one ledger.

### 27.8a The Business window, separate from the market

Running a business is a different activity from trading shares, so it has its own window, the **Business window**, and the Market Terminal stays the stock market. A private business never appears in the market at all; the two windows meet only where a business touches the market: its owners' holdings, a listing, and a listed company's own page.

**Opening it.** A Business button beside the market buttons in the Token Controls, a keybinding (unbound by default, like the others), a starter macro, and, through the map bridge, the business's place on Night City Map. A player sees only the businesses their characters hold units or shares in, with a picker when there are several; anyone else's private business is invisible to them. A character with none sees **Start a business**, which opens the founding flow.

**Tabs**, following the business loop (§27.0, §27.4):

| Tab | Shows | Actions |
|---|---|---|
| Overview | stage, archetype, location, the state as bands (Reputation, Capacity, Cost base, Compliance), the till, the next step-up's checklist | |
| This week | the operating period: action slots and who has taken each, complementary bonuses waiting, event prompts with their deadline | take a slot and roll (with the dialog's preview and levers, §27), make a complementary check, answer an event |
| Ledger | takings, costs, draws, loan payments, and each period's digest; monthly ledgers or reports from stage 1 | draw, take or repay a loan |
| Partners | the cap table (units, or shares from stage 2) and the founding agreement; officers from stage 2 | propose and vote (admit an investor, change the agreement, elect officers), buy out a stake, transfer units privately |
| Projects | expansion projects and their progress, including crew days from downtime (§27.8) | start, fund or add days to a project |
| Growth | the step-up checklist and, from stage 2, the listing checklist (§27.4a) | step up, apply for a listing, make the prospectus rolls |

Everything a player does here is a request through the executor, like the terminal's, and every roll is player-triggered (§27).

**Where it links into the market.**
- **Private holdings in the portfolio.** The terminal's Portfolio tab lists a character's stakes in private businesses in their own section, valued at book value (stages 0 and 1) or *V* (stage 2, §27.4a), read-only and clearly marked as not tradable, each with **Manage in Business window**. They count toward the portfolio's value and statements but cannot be ordered on the market.
- **Applying for a listing.** When the Growth tab's listing checklist is complete, officers apply there, pay the listing fee and make the prospectus rolls (§27.4a). On the GM's approval, NCI creates the company's market entry from the business record (name, ticker, sector, description, offer price, float) and runs the standard announced IPO (§18): it appears in the terminal's upcoming IPOs, and any character, including other players, subscribes there as for any IPO. Until then the market knows nothing about the business.
- **Once listed.** The terminal's company page shows **Manage company** to the company's officers, opening the Business window on it, and the Business window's Overview shows **View on market**, opening the terminal at the company's page. Founders' shares stay restricted through the lock-up, then trade like any shares, from the terminal.
- **Delisting** (§27.4a) removes the market entry; the company stays in the Business window as a private company.

**The GM's side.** A **Businesses** tab in the GM Console lists every business at every stage, with its true state (Exposure included) and owners, and holds what needs the GM: setups and step-ups awaiting approval (by setting), charters, listing applications, loan reviews, event draws, buy-outs and disputes. The GM can open any business in the Business window to see it as its owners do.

**Data.** Business records live apart from the market's: the player-visible part in a per-business document its owners can read, and the hidden part (Exposure, NPC investors' skills, the stored totals for opposed rolls) in the GM-only control journal, as the market's hidden state is (§4). The market's company list gains an entry only when a listing is approved.

### 27.9 Development phases

The work is split into phases that each end with something usable at the table. Syndicates are not first: small businesses are where most players will start, so the first playable phase is a side business. Syndicates do not depend on businesses and run as a parallel track, joining up when a syndicate owns or invests in one. The phases are labelled B0 to B7 in the roadmap (§37).

**Before B0:** the work already done was released as **v0.9.7** (§25 and §26, and the gig runners for heat, H4), so the phases start from a released, tested base.

| Phase | Version | Playable outcome |
|---|---|---|
| B0 Groundwork | none | nothing for players; the questions below are answered |
| B1 Side businesses | v0.10 | the Medtech and Fixer open the clinic and earn from it |
| B2 Growing | v0.11 | the clinic registers, takes a loan, opens a second chair and brings in an investor |
| B3 Syndicates (parallel) | v0.12 | a crew pools money and trades as one account |
| B4 Chartered companies | v0.12 | the clinic becomes a company with officers and monthly reports |
| B5 Going public | v0.14 | an IPO other players subscribe to in the terminal |
| B6 Corporate play | v0.15.0 | takeovers, buybacks, hidden owners and investigations |
| B7 Downtime bridge (separate module) | after B2 | company work spends Crew Tools downtime |

**B0 Groundwork.**
- **Crew Tools spike** (§27.8): the signature of `downtime.use`, whether it returns an event id, whether a player client may call it, and how free-form events appear. The B7 design depends on it.
- **Business growth simulator:** extend `tools/simulate.mjs` to run a business over many operating periods, check the target of 30 to 40 periods from side business to listing eligibility (§27.0), and tune the profit bands before any of it ships.
- **Storage:** one document per business that its owners can read, with hidden fields in the control journal (§27.8a); the schema version and migration path.

**B0 findings.**
- **Business simulator.** `tools/business-model.mjs` is a prototype of the business loop (stages, the weekly actions with the rulebook d10 and outcome bands, complementary checks, events, the till, draws, expansions, registration, the charter's capital quote, the listing checklist and *V*), run by `npm run simulate:business` (`tools/simulate-business.mjs`) for a strong, an average and a weak crew over many seeds, with node tests (`tests/businessModel.test.mjs`). B1 builds the engine from it, and its values are B1's starting point. It leaves out loans, investors, role-ability actions, Luck and alternative skills, which all speed growth, so play should run a little faster than it.
- **Results at growth rate 1** (periods to reach each stage, median):

  | Crew | Registered | Chartered | Eligible to list | Closed |
  |---|---|---|---|---|
  | Strong | 7 | 32 | 52 | 0% |
  | Average | 11 | 53 | 80 | 3% |
  | Weak | 26 | 95 (55% get there) | 14% within 120 periods | 7% |

  Weekly profit when leaving each stage stays inside the §27.0 bands (about 136 eb leaving the side business, 570 eb leaving the registered stage).
- **Design changes from it.** The growth target in §27.0 is replaced by these measured figures and the floor of about 28 periods. A growing business charters at the Startup tier (§27.2a): with the Small tier, even a strong crew took about 85 periods to fund its charter.
- **Calibrated starting values** for B1 (all GM-tunable): one, two and three action slots by stage; expansions costing 1,500, 2,500 and 8,000 eb for +0.25, +0.8 and +1.5 Capacity; Capacity ceilings of 1.6, 4.5 and 14; fix-up gains scaled ×1, ×6 and ×14 by stage; an event in a quarter of periods.
- **Storage.** A business is a JournalEntry in its own folder, like a company, but private: default ownership None, and Observer for the users of its partners' characters, so they read it and nothing else does. Its player-visible record (archetype, location, state bands, till, ledger, founding agreement, projects) is a flag on it, saved in the one-write wrapped form (§26). Its hidden part (Exposure, stored totals for opposed rolls, NPC investors' skills) is keyed by business id in the GM-only control journal. Partners' units are lots in their portfolios, as restricted shares are (§27.3). Each record carries its own `schema` number, and changes go through the existing migration steps (§22).
- **Crew Tools spike: answered from the source** (Pneuma's Crew Tools v1.0.10, Foundry v12, read from the built `scripts/pneuma-crewtools.js`; not yet run in the test world, where Crew Tools is not installed). The four questions in §27.8:
  - **Signature.** `game.modules.get("pneuma-crewtools").api.downtime.use(days, kind, reason, actorId = game.user.character.id, extra = {})`, with positional arguments. For company work `kind` is `"spend"` (the other kinds it accepts, `rest`, `crafting` and `hustle`, carry their own rules). `days` is a positive whole number no larger than the character's unspent balance, and `reason` is 1 to 500 characters, trimmed. Of `extra`, only `projectId` and `roleItemId` are kept on the event; a `requestId` passed there is ignored, since Crew Tools makes its own.
  - **No event id comes back.** `use` resolves to `undefined`. The event it records is `{ id, requestId, actorId, kind, days, period, date, reason, projectId, roleItemId }`, with `id` and `requestId` both generated inside Crew Tools. So that NCI can find it again, the bridge puts NCI's request key in `projectId`. Crew Tools reads `projectId` only on TECH events and stores it as given on a spend.
  - **A player's client may call it.** It checks that the user owns the actor (or is a GM) and writes straight to the character's journal "Crew Tools — *name*", which Crew Tools gives Owner permission to the actor's owners. There is no GM relay: Crew Tools' socket is only a lock between clients. A GM must have opened Downtime once to prepare that journal, or `use` throws, and one day stays reserved while a Medtech workday is open. `startNextSession` is first-active-GM only; it records the unspent days as an `expire` event and moves `period` on by one.
  - **Where free-form events appear.** On the character journal's **Downtime Log** page: `flags.pneuma-crewtools.downtime.events`, in the same shape as the Crew Tools ledger (`version`, `period`, `accounts`, `events`), with `downtimeBalance` beside it and the event as a row in the page's table (the reason as text). `api.downtime.getState(actorId)` returns the same events, merged, and a player can call it. Crew Tools calls no hook of its own when downtime changes; the page's `updateJournalEntryPage` is the only signal.
- **What this means for B7** (§27.8, otherwise unchanged). The bridge calls `use(days, "spend", "NCI · <business> · <action>", actorId, { projectId: <NCI request key> })` on the player's client, then reads the Downtime Log for the event with that `projectId` and sends NCI its `id`. NCI's executor re-reads the page and checks that the event exists, belongs to that actor, is a `spend` of the claimed days in the current `period`, and that its id has not been used. The trust limit is the one the roll cards already have (§27): the player owns the page and could edit it, so the GM's view of the Downtime Log is the check.

**B1 Side businesses (v0.10).**
- **Roll levers** in `SkillAdapter` (§27): the roll dialog with the DV preview, approach, Luck, the complementary bonus (role abilities included) and hired professionals; outcome bands and the DV ladder; the executor's checks for Luck and stored bonuses. Every later phase uses them.
- **The Business window** (§27.8a): Overview, This week, Ledger and Partners tabs, and the Start a business flow; the GM Console's Businesses tab, with approvals and each business's true state.
- **Ownership** (§27.0): partnership units, and the founding agreement with sweat equity, decision rule and buy-out rule.
- **Archetypes:** four to start (ripperdoc clinic, garage, bar, info shop) and the setup roll.
- **The weekly loop:** the five actions, the till, upkeep, capped owner draws, neglect drift, and failure and closure.

**B2 Growing (v0.11).**
- Weekly events and event responses.
- Fixer loans; registration as the first step up (stage 1, two action slots); bank loans; private investors (players, and NPC angels through an opposed roll).
- Expansion projects; the Projects and Growth tabs with the step-up checklist.
- Private holdings, read-only, in the terminal's Portfolio tab (§27.8a).
- Location: district foot traffic and risk.
- Role abilities as business actions.
- Gigs for a player's own business (§27.5); the runners already come from the bridge.
- The remaining six archetypes.

**B3 Syndicates (v0.12, alongside B1 and B2).**
- The syndicate account (§27.1): units and NAV, roles, proposals and votes with deadlines, the broker and treasurer, and collective heat.
- Integration: a syndicate as a business partner or owner, with private stakes valued at book value or *V* in its NAV.

**B4 Chartered companies (v0.12).**
- The charter (§27.2, §27.2a): three rolls with the graded outcome, the starting state, the capital quote, the funding window and escrow, net assets credited for a growing business, and units converting to restricted shares.
- The company loop (§27.4): action slots by capacity, the five skill actions with alternative skills, report preparation (Bold reporting included), private monthly reports, Compliance and Exposure.
- Information rolls: internal audit and due diligence.
- Officers, elections and control (§27.3).

**B5 Going public (v0.14.0).**
- The valuation *V*, the listing checklist, the listing application and the prospectus rolls (§27.4a).
- On approval, the company's market entry and the standard IPO flow.
- Earnings impacts on fair value, capped dividends and the liquidity cap (§27.7), insider windows for officers (§27.4), and the delisting review.
- The links between the Business window and the terminal: Manage company and View on market (§27.8a).

**B6 Corporate play (v0.15.0).**
- Takeovers, dilution, buybacks and insolvency for companies.
- Hidden ownership (§27.6): nominees, syndicate chains, the disclosure threshold, opposed investigations, and Netrunner espionage.
- Coordinated syndicate campaigns.

**B7 Downtime bridge (a separate module, any time after B2).**
- Company Work through Crew Tools downtime (§27.8): extra time (+1), crew days on projects, and the expiry rules. Until it ships, B2's native allowance of business days stands in.
- Businesses shown on Night City Map through the map bridge.

**Every phase finishes the same way:** node tests for the pure parts and flow tests against the fake Foundry, as the existing suite does; a schema migration if stored data changes; a run in the test world before release; and, from B1, a simulator check against the growth target.

## 28. Phase B1: side businesses (v0.10.0)

B1 as built, with the decisions made while building it. The design it follows is §27 and §27.0; what is not built yet is listed at the end.

**The roll levers** (`engine/rolls.js`, `SkillAdapter.leverCheck` and `verifyLevers`). The DV ladder, the outcome bands and the approaches as §27 has them (Careful DV −2 at three quarters of the effect, Bold DV +3 at a quarter more, with 1 Exposure). The roll dialog previews the DV, the d10 needed and each band's chance, worked out exactly over the CPR d10. A role ability rolls its rank (the `role` item's `system.rank`, matched on `system.mainRoleAbility`). A hired professional's fixed base (10, 13 or 16) replaces stat and skill and cannot take Luck; the fee (50, 150 or 400 eb) comes from the business, less 5% per rank of the best Operator among the partners, up to 40%.
- **Luck is spent on the player's own client** when they press Roll: the sheet's `system.stats.luck.value` goes down first, as the rules have it, and the card records the pool before. The GM counts the Luck only if the pool is now at least that much lower than the card says it was; otherwise the roll stands without it.
- **The +1 counts only if the business has one waiting** for that action, whatever the card claims, and it is used up by the roll.
- `verify` and `verifyLevers` share the card checks (`_readCard`): the right actor and skill, posted by an owner, recent, unused.

**Requests** go in their own outbox flag, `businessOutbox`, with the GM's receipts in `businessReceipts`, rather than in the portfolio outbox, so neither executor has to skip the other's requests. `rollSpec` makes the same checks the engine will make before the GM reads a card, so a request that would be refused does not use up the roll; with no `use` it answers what the roll may be made with, which the dialog asks.

**Storage.** As B0 settled (§27.9): one journal per business in the "NCI Businesses" folder, ownership None and Observer for the users of its partners' characters (invited ones too, so they can see the invitation; declined or departed ones are removed with `-=` keys, since Foundry merges an ownership update), the record wrapped in a one-element array, and the hidden part (`exposure`) by business id in the control journal. Records carry `schema: 1`; there was nothing earlier to migrate, so the world schema stays at 2.
- **One change from B0: the cap table is on the business record, not lots in the partners' portfolios.** The Partners tab must show every partner's stake, and the module never reads another character's portfolio from a player's client. B2's private holdings in the Portfolio tab (§27.8a) will read the record, so nothing is stored twice.

**Founding.** A founder names the business, picks an archetype, puts in eddies (taken from the wallet at once and held in escrow) and gear (a name and a book value, at most 20,000 eb an item; the GM sees it on the Businesses tab), and invites up to five partners, who join with their own contributions or decline. The setup roll waits until every invitation is answered, because units are counted when it opens.
- **The setup roll** uses the archetype's trade skills, Business, the archetype's abilities, Operator or Maker, or a hired professional (paid from escrow), at DV 13. A pass sets the setup cost like the capital quote (§27.2a): the top of the archetype's range less the range times margin/8, to the nearest 50 eb. Its band sets the opening Capacity (narrow 0.85, solid 1, strong 1.1, exceptional 1.2). A failure loses a third of the archetype's lowest setup cost and waits 7 game days; a fumble loses half and waits 14. Either loss is capped at half the money held for the business, so one bad roll cannot wipe the partners out (added after a fumble in the test world took a garage's whole 400 eb).
- **Opening.** Gear counts toward the setup cost first; the cash makes up the rest, and what is left is the till. A business short of money waits until a partner puts more in. With "New businesses need GM approval" on (the default) it then waits in the Businesses tab; turning it down refunds the escrow by cash put in. Units are one per eb of cash or gear, and the sweat slice is added on top so that it is that percentage of the whole.
- A partner can take their money back out before it opens; if the last one does, it is cancelled.

**The week.** Each business's operating week ends on the weekday the "Business week ends on" setting names (Monday by default), checked against the market's date after every market tick, as the last step of the after-tick sequence. Up to 8 missed weeks are closed in order after a jump; beyond that they are skipped. A first week that began part-way through earns for the days it ran.
- A side business has one slot a week. Each action can be taken once a week, by any partner with a vote. Each partner may also make one complementary check a week for an action nobody has taken yet; a success leaves +1 for it.
- The action effects are the B0 simulator's tables, scaled by the approach and the growth rate. **Keep it safe** cuts that week's protection money (the stage's fixed costs are 7 eb rent and 8 eb protection); B2's events will give it more to do. A week nobody works the shop trades at 0.9 of the usual takings.
- Reputation drifts 3% of the way back to 50 each week and the Cost base creeps up 0.005, as in the simulator. The owners see the state as bands (Reputation poor to excellent, Capacity, Cost base), never the numbers; the GM's tab has the numbers and the Exposure.

**Money.**
- **Draws.** Each partner, voting or not, may draw up to their share of last week's profit, once a week, into their wallet. No vote is needed: a draw is capped by what the business earned, as §27.0 asks.
- **Leaving.** A partner may offer their stake (or the GM marks them as leaving, for a character who has died or left the table). For 14 game days the others may buy it at book value per unit; after that it passes to the heir they named, as units without a vote that still draw, or lapses if there is no heir, so the others' shares grow.
- **Closing** needs every partner with a vote: one refusal ends the proposal. The gear sells for half its book value and everything is paid out by units. A till below zero at the close of two weeks running closes it as failed, with the gear at a quarter.

**Windows.** The Business window and the GM's Businesses tab as §27.8a describes, without the Projects and Growth tabs (B2). It opens from a Token Controls button (hidden when businesses are off), an unbound keybinding, a starter macro and `api.openBusiness()`. Players get a notice when each of their requests is done or refused.

**Settings.** Player businesses on or off (on), GM approval of new businesses (on), the weekday the week ends on (Monday), and the growth rate (1, from 0.5 to 2).

**Simulator check.** Run through the same strong, average and weak crews, B1's engine earns what the B0 prototype does at stage 0 when the prototype's events are off: 118, 92 and 71 eb a week on average over the first four weeks, against 123, 92 and 72 (the strong crew's prototype business has bought an expansion by then). With the prototype's events on, B1 earns about 10% more, until B2 adds them.

**Not built yet** (B2 unless noted): weekly events and event responses; registration and the later stages; loans and investors; expansion projects and the Projects and Growth tabs; location effects (the location is a note for now); role abilities as actions (they can be used for the setup roll and complementary checks); the six other archetypes; extra time from downtime (B7); private holdings in the Portfolio tab.

**Tested in the test world** (Foundry 12.343, Cyberpunk RED Core v0.92.4) before release: founding, invitations and joining, the setup roll (a real fumble included), GM approval, complementary checks, an action with Luck and the +1 on a real sheet, the weekly close and catch-up over a 14-day jump, draws, a refused close vote, leaving, a buy-out and closing; a business journal reaching only its partners' players. It found and fixed: the roll dialog failing to open (`title` is read-only on ApplicationV2), qualified skills such as Local Expert (Your Home) reading as 0, a lone owner helping themselves with the action's own skill, abilities at rank 0 in the dialog, a stale "no GM online" warning, a fumble taking the whole escrow (now capped at half), and a closed business reappearing for partners who had sold out. Not tried live: failure after two losing weeks, and a stake passing to an heir or lapsing (both covered by tests).

## 29. Phase B2: growing (v0.11.0)

B2 as built, with the decisions made while building it. The design it follows is §27.0, §27.4 (events) and §27.5 (gigs). The engine is now split into `businessRecord.js` (the record and its readers), `business.js` (requests, proposals and the week), `businessGrowth.js`, `businessEvents.js` and `businessFinance.js`.

**Proposals.** One `propose` request covers every decision, each kind with its rule (`PROPOSAL_RULES`): closing, stepping up, an investor and an angel need every partner with a vote; an expansion, a fixer's loan and going to a bank need a majority of the voting units (more than half to pass; it fails once half or more say no). A proposal takes effect the moment it passes, and lapses after 7 game days. `proposeClose` stays as an alias. One proposal of each kind may be open at a time.

**Business days and extra time.** Without Crew Tools (§27.8), each partner with a vote has 3 business days a week, which lapse when the week closes. They pay for expansion work and for **extra time**: one day for +1 on a roll, a new lever in the roll dialog, which the GM counts only if the character has a day left.

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

**Role abilities as actions.** B1 already let the abilities in §27.0's table roll the actions they fit (Credibility and Charismatic Impact to promote, Operator to source, Maker to fix up, Combat Awareness and Backup to keep it safe); B2 adds Moto to sourcing and lets abilities answer events. Exec Teamwork (an extra slot) is a chartered company's (B4).

**Loans** (`businessFinance.js`). Interest counts against the week's profit; the principal repaid comes out of the till but is not a cost. Repayments are taken as each week closes, and loans can be paid off early.
- **A fixer's loan**, at any stage, on a majority: up to 2,000 eb (4,000 once registered), 5% of the balance a week, a tenth of the principal repaid each week. A missed payment adds a 10% late fee, costs 2 Reputation and sends the collectors. This is deliberately harsh, a trap for the desperate (decided after the test world showed a full 2,000 eb loan costing a side business about 300 eb a week against roughly 110 eb of profit): players should borrow small, or pay back early. Repayments come out after the week's takings, so a week that earns its payment makes it.
- **A bank loan**, for a registered business: a majority agrees, then a partner rolls Accounting or Business at DV 15 (a hired accountant allowed). The band sets the limit, 6 to 20 weeks of the last four weeks' average profit, and the rate, 1.5% down to 0.8% a week, over 20 weeks; the loan is what the partners asked for, up to the limit. A missed payment adds 5% and costs 10 Compliance. A refusal waits 14 days.

**Investors**, for registered businesses only (§27.0).
- **A character**: every partner agrees on who, how much and the price per unit (book value unless the partners set one). Who may be invited: a player character, or a character linked to a Night City Messenger contact tagged `broker` or `investor` (`investorActors`; the GM's service checks the same list and refuses anyone else with `not-investor`). A contact with no linked character is not offered, since an investor pays from a character's wealth and accepts through that character; the GM accepts for an NPC investor from their own window. The character is then invited, sees the offer in their Business window, and pays in to become a voting partner.
- **An angel**: once every partner agrees, the angel is found: its skill total (12 + d10, drawn from the seed and the proposal) and name are stored, so the partners know who they are pitching to and the dialog's preview is exact. The pitch is a Persuasion or Trading roll against that total, the CPR opposed roll with the NPC's die already cast. The band sets how much of the book value the angel puts in (20% to 50%) and the price (10% under book to 20% over). An angel holds units without a vote; its share of the profit stays in the business (it draws nothing), and it is paid like any holder if the business closes. A failed pitch waits 14 days. This replaces rolling the angel's die after the player's, which would have let the player's card say one thing and the GM's result another.

**Topping up a running business.** An active partner can put more eddies and gear into an open business from the Ledger tab (the `contribute` request, which before only worked while forming). The eddies go into the till and the gear's book value into the fit-out (`assets`). No units are issued, so every holder's stake gains in proportion and the payer gets no bigger share; that keeps control where it is and needs no vote. Gear from the partner's sheet leaves it for good, as with any gear once a business has opened.

**Gear is dragged in as items.** The gear a partner brings (when founding, joining or putting more in) is no longer a name and a value typed in: they drag Foundry items into a drop zone, from their character's sheet, the Items directory or a compendium, and the window lists them with their book value before sending. The book value is the item's market price times its quantity (`system.price.market` × `system.amount`). The request carries only the items' uuids; the GM's service looks each one up and reads it again (`itemGear`), so a value in the request is never used. Refused: an item on another character's sheet, installed cyberware, a skill, role, critical injury or NET architecture, and an item with no price. An item from the partner's own sheet moves into the business: the GM's side deletes it from the sheet once the request is saved, keeps a copy in the gear entry, and recreates it on the sheet if the business never opens (the partner withdraws, or the GM turns it down). Once the business has opened, gear is its property and goes with its fit-out; it is not handed back at closing. An item from the library or a compendium is a copy and nothing leaves a sheet.

**Private holdings in the Portfolio tab** (§27.8a). A character's stakes in open businesses, valued at book value times their share, not tradable, each with a button to the Business window, counted in the portfolio's total. Statements leave them out for now.

**Gigs for a player's own business** (§27.5). A gig is matched to an open player business before any company: a `[NCI: <business id>]` tag, the business's exact name, or its name inside the client text. Its outcome moves Reputation at once and next week's takings: at a reward of 2,000 eb a success is +4 and +10%, a failure −6 and −10%, scaled by the reward (0.25 to 1.5) and divided by one more for each gig for the same business in the last 28 days. With GM approval on (the default) it waits in its own section of the Gigs tab with the planned effect shown; the history names the business. A business has no share price yet, so there is no insider-trading window; heat for its gig runners waits for listing (B5).

**Windows.** The Business window gains Projects and Growth tabs, the week's event with an Answer button, loans on the Ledger tab and investors on the Partners tab, every kind of proposal on the Partners tab with its rule, the district, Compliance, and the digest's event, loan and gig lines. The GM's Businesses tab shows each business's district and week's event.

**Simulator** (`tools/simulate-engine.mjs`, `npm run simulate:engine`). It plays a business through the real engine with the B0 crews. At growth rate 1, after the Reputation changes above, strong, average and weak crews register in a median of 8, 11 and 28 weeks (100%, 99% and 94% within 80 weeks), against the B0 prototype's 7, 11 and 26, with weekly profit on registering of 139, 114 and 110 eb (the prototype's 136, 116 and 109) and 0 to 2% closing.

**Not built yet:** chartering and everything after it (B4 to B6); the GM editing the event tables; statements counting private stakes; moving a business to another district; Crew Tools downtime in place of business days (B7).

**Tested in the test world** (Foundry 12.343, Cyberpunk RED Core v0.92.4): gear dragged from a sheet (one item and several), valued from the item, leaving the sheet and coming back when the business was cancelled; founding in a district; a fixer's loan, an expansion finished with business days, answering events (a shortage, a breakdown, debt collectors) with extra time and Luck; weekly closes with interest, a missed payment and the collectors; the registration checklist, agreement and roll with a hired professional; a bank loan; finding an angel and a failed pitch; a character invited as an investor accepting from their own window; private stakes in the Portfolio tab. It found and fixed: loaded ammunition refused as installed and priced per round; a player's stale copy of a business they had left; a loan payment checked before the week's takings came in; the dialog offering a hire the till could not pay. Not tried live: a successful angel pitch, an inspection, a gig for a player's business, and the registered business's second slot (all covered by tests).

## 30. Phase B3: syndicates (v0.12.0)

A syndicate is a crew's shared brokerage account: members pool money, officers trade it on the market, and everyone holds units in it. This section turns §27.1 into what is built, with the choices made at the start of B3. It is built in two steps: **B3a**, the account (below), then **B3b**, syndicates as partners and owners of businesses.

**Choices made for B3** (decided before building):
- **Control.** Officers trade freely up to a size limit the members set. A bigger trade, admitting or removing a member, making someone an officer or not, changing the limit, and dissolving all go to a **vote by units**, open for 7 game days. This replaces §27.1's per-action approval rules, which would have needed a rules editor and more to explain.
- **Money in** comes from a member's own **brokerage balance**, not their eddies: a deposit moves cash from the member's account into the syndicate's and buys units at the current value per unit (NAV). A member who wants to pay in eddies deposits them into their own account first.
- **Money out.** A member redeems units at NAV. The money goes back into the member's brokerage balance after the market's settlement delay, from the syndicate's cash; if there is not enough cash, the redemption waits until the officers sell enough. Leaving is redeeming every unit.
- **Founding.** A player founds a syndicate from the terminal and invites members. A setting, on by default as for businesses, makes the GM approve it first.

**Storage.** A syndicate is a JournalEntry in an "NCI Syndicates" folder, as a business is, and not an actor as §27.1 first said: a journal keeps it out of the Actors directory, off character sheets and out of every list of characters, and its users' access is the business pattern (ownership None, Observer for the users of its invited and active members). The journal carries two flags, both saved in the one-write wrapped form (§26): `syndicate`, the record, and `portfolio`, an ordinary portfolio. Because the portfolio is ordinary, the executor, orders, fees, brokers, terminal sessions, dividends, splits, IPO subscriptions, alerts and statements all work on it unchanged.

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

**Trading.** In the terminal the account picker lists each syndicate a user's characters belong to, as "*Syndicate* (as *character*)", beside the characters themselves. With a syndicate chosen, the Market and Portfolio tabs show the syndicate's account, and the trade dialog, broker choice, alerts and orders send `trade` requests through the member's character. Direct trading needs the syndicate's own terminal session, opened by an officer's Accounting roll; the broker's terms are the broker's own, so §27.1's treasurer is not needed. The Portfolio tab gains a Syndicate panel: members, units and stakes, NAV, deposit and redeem, waiting redemptions, proposals and votes, the trade limit, and invitations.

**Heat is collective.** The syndicate's trades are audited as one account and recorded under the syndicate's id. It counts as the gig's runner if any member ran it, and as tipped if any member was sent the rumour. Freezes and dropped brokers land on the syndicate's account; warnings and NCPD mail go to every active member. Cover-up actions stay with characters. Adding members' personal trades to the syndicate's for the size factor (§27.1) waits for coordinated campaigns (B6).

**Mail.** Anything the market would mail to an account (fills by broker, statements, alerts, paid withdrawals) goes to every active member of a syndicate.

**GM Console.** A Syndicates tab: each syndicate with its members, units, NAV and portfolio, approving or refusing pending ones, passing or vetoing a proposal, and closing a syndicate.

**B3a as built.** The engine is `scripts/engine/syndicate.js` (pure, with `tests/syndicate.test.mjs`); storage `SyndicateRepository` (its `account(id)` stands in for an actor wherever a portfolio is read or written, and `PortfolioRepository.accounts()` lists characters and active syndicates for the GM's services); the GM side `SyndicateService`, run in the portfolio service's queue because deposits and redemptions write members' own accounts, with a "Syndicates" step after orders in the after-tick sequence; the player side `SyndicateClient` and `SyndicateWatcher`; the terminal's picker, Syndicate panel and founding form (`ui/accounts.js`, `ui/MarketTerminal/syndicateContext.js`); the trade dialog's limit note and proposal; and the GM Console's Syndicates tab. Two settings: player syndicates on or off, and GM approval of new ones (both on by default). Each side of a cash movement has its own ledger line: the member's reads "paid into a syndicate", "redeemed from a syndicate" or "paid out by a dissolved syndicate", and the syndicate's "paid in by a member" and so on. `tests/syndicateFlow.test.mjs` runs the services from founding to dissolving, and `tests/syndicateWindows.test.mjs` renders the windows.

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

**Tested in the test world** (v0.12.0, 2026-10-31): a syndicate as a business partner, an officer acting for it from the Business window's account picker, a draw paid into the syndicate's account, its NAV counting the business stake, and an officer's order over the daily limit becoming a vote, carried at once by the officer's own units. It found and fixed: members mailed "vote on this" for a proposal already carried (they now hear only how it ended, and the proposer is told what happened). Not tried live: redemptions and dissolving, the other syndicate mails, and a non-officer member's read-only view (all covered by tests).

## 31. Phase B4: chartered companies (v0.12.0)

A registered business that has grown far enough becomes a **chartered company**: stage 2 of the same business record (§27.0), with a cap table of shares, more action slots, the five company actions, monthly reports and elected officers. This section turns §27.2 to §27.4 into what is built. It is built in three steps: **B4a** the charter, **B4b** the company loop, **B4c** officers, control and information rolls.

**Choices made for B4** (decided before building):
- **Growing only.** A company is chartered by growing a registered business; chartering from scratch is left for later. The business's net assets count toward the capital quote and its units become shares.
- **Funding in eddies.** What the owners add to fund the charter comes from their characters' eddies, as every business payment does (a syndicate partner pays from its account, B3b). §27.2a's brokerage-balance deposits are not used.
- **The cap table stays on the record** until a listing (B5) turns it into market shares in portfolios. Units become shares one-for-one, so nothing is converted, and a private company's shares can never be sold on the market by mistake.
- **The five company actions** (Business, Accounting, Trading, Bureaucracy, Bribery, each with alternative skills at DV +2) replace the shop actions at stage 2 (B4b).

### 31.1 B4a: the charter

**Milestones** (Registered → Chartered, §27.0): 12 weeks registered (three monthly ledgers of four weeks), an average profit of 400 eb a week over the last 4, at least one finished expansion, and the filing fee (2,000 eb, the B0 prototype's) in the till. Then every partner with a vote agrees to charter (the `stepUp` proposal, as for registering), naming the company's ticker (two to five letters, not taken by a market company or another charter). The filing fee is paid from the till when they agree, and is spent whatever happens.

**The three rolls**, each a `charterRoll` request any partner with a vote can make on their own client, in any order, with the usual levers (Luck, the complementary bonus, extra time, a hired professional paid from the till):

| Part | Skill (alternatives at DV +2) | DV | Sets |
|---|---|---|---|
| Business plan | Business (Persuasion, Trading) | Everyday 13: a business with a track record finds it one step easier | starting Reputation |
| Registration | Bureaucracy (Local Expert, Persuasion) | Difficult 15 | starting Compliance |
| Capital structure | Accounting (Business) | Difficult 15 | the capital quote |

Each part is rolled once. A failed business plan or registration is a setback, not a refusal: the company starts with less Reputation or Compliance. A failed **capital structure** roll refuses the charter: the fee is lost, and the partners may agree to try again after 7 game days (14 after a fumble); a business plan or registration roll that passed is kept for 30 game days, so only what failed is rolled again.

**The capital quote** (§27.2a), set by the capital structure roll: quote = Kmax − (Kmax − Kmin) × clamp(margin / 8, 0, 1), rounded to 100 eb, with the Startup tier's Kmin 5,000 and Kmax 12,000 times the sector factor (media and consumer 0.8; tech, transport, health, finance, construction and others 1.0; security and arms 1.3; biotech and energy 1.5). The business type maps to a market sector (a clinic is health, a garage and a courier transport, a bar, boutique and food stall consumer, an info shop tech, a gun shop arms, a security outfit security, a media outfit media). The business's **net assets** (its cash and fit-out, less what it owes on loans) count toward the quote, so the owners pay in only the shortfall.

**GM approval.** Every charter waits for the GM, as §27 decided, in the Businesses tab: the rolls, the quote, the net assets and the shortfall. The GM approves or turns it down (a turned-down charter refunds anything paid in; the fee is not refunded).

**Funding.** On approval, a funding window of 14 game days opens. Any partner pays in (`charterFund`) from their eddies, up to the shortfall plus 50%, and each payment buys new shares at the business's book value per unit at the time, so existing holders are not diluted below what their stake is worth. When the shortfall is met the company is formed; if the window lapses, every payment is refunded and the charter fails (the partners may agree again). With no shortfall, the company is formed the moment the GM approves.

**Formed.** The business becomes stage 2: its units are now shares (the same numbers), what was paid in goes into its cash, it has the ticker and its market sector, and the business plan and registration bands shift its Reputation and Compliance. Until B4b, a chartered company runs the stage-2 weekly loop with the shop actions, using the B0 prototype's stage 2: three action slots, actions at DV 17 (Professional), a Capacity ceiling of 14, 150 eb a week of rent, licences and protection, and expansions of 8,000 eb for +1.5 Capacity.

**B4a as built.** The charter is `scripts/engine/businessCharter.js` (pure, with `tests/businessCharter.test.mjs`), wired into the business engine: the stage-1 `stepUp` proposal names the ticker (checked against the market's and other charters' tickers, which the service passes as `context.tickers`), `charterRoll` (one of `plan`, `registration`, `capital`) and `charterFund` requests, `approveBusinessCharter` and `rejectBusinessCharter` for the GM (the Businesses tab), and the funding window lapsing on the weekly advance. A business now records the day it registered (`registeredDay`; older ones are read from their ledger). The Growth tab shows the charter's milestones, sector and quote range, the ticker form, each roll's result with its Roll button, what the GM is weighing, and the funding form; the roll dialog says what each band of each charter roll means. A syndicate partner's charter payment counts against its officer's daily limit like any other payment in.

### 31.2 B4b: the company loop

**The five company actions** replace the shop actions at stage 2 (three slots a week, at DV 17), each with alternative skills at DV +2 and the role abilities that fit:

| Action | Skill (alternatives at DV +2), abilities | Effect by band |
|---|---|---|
| Chase contracts | Business (Persuasion, Trading); Teamwork, Operator, Maker | multiplies the week's takings (60% to 138%) and lifts Reputation a little |
| Tighten the books | Accounting (Business); Moto | the Cost base down (up to 6%) |
| Investor relations | Trading (Persuasion, Wardrobe & Style); Credibility, Charismatic Impact | Reputation up (up to 8) |
| Permits and compliance | Bureaucracy (Local Expert, Persuasion); Backup | Compliance up (up to 8), and less protection money that week |
| Shortcuts | Bribery (Streetwise); Operator | multiplies the takings most (70% to 160%), always adds Exposure (more on a failure), and a fumble costs 8 Compliance |

A week with neither contracts nor shortcuts is an unworked week, as a shop's week without Work the shop is. Capacity grows only through expansions at this stage. Complementary checks work as before.

**The monthly report.** Every four weeks after the charter, the company publishes a report summing those weeks (takings, upkeep, profit). In the report's last week an officer may prepare it (`reportRoll`: Accounting, or Business at DV +2): the band shifts the profit it reports (−8% to +10%); Bold is **aggressive reporting**, doubling the shift and adding Exposure. With no preparation the report shows what was earned. The roll's total and band are kept with the report, for an audit later (§27.6). While the company is private the report moves nothing on the market; from B5 the reported profit feeds the valuation and the earnings impact. Reports show in the Ledger tab; the This week tab says which week of the month it is and offers the preparation in the last.

**Built:** `scripts/engine/businessCompany.js` (the company's week, `reportCheck`, `closeReportWeek`), the company actions in `businessConfig.js` (`COMPANY_ACTIONS`, `actionIdsFor`), tests in `tests/businessCompany.test.mjs`.

### 31.3 B4c: officers, control and information

**Officers.** At the charter every partner with a vote becomes an officer (they ran the business). After that the shareholders elect (`elect`) and dismiss (`dismiss`) officers by a majority of the shares, through the usual proposals; a company always keeps at least one. Only officers run a company: they take its action slots, answer its events, prepare its report and make the information rolls. Any holder may still help with a complementary check, so a shareholder who is not an officer has a roll that matters. Control is the existing majority rule: holders of more than half the shares carry every majority proposal. The Partners tab marks officers and offers the elections; the This week tab tells a shareholder who is not an officer why they cannot act.

**Information rolls** (once a week each, paid from the company's cash):
- **Internal audit** (Accounting, Business at DV +2; 300 eb). A pass tells the officers the company's Exposure band (clean, low, moderate, high), which is otherwise hidden; a strong result also wipes 5 points of it out, an exceptional one 10. The GM's service passes the hidden Exposure to the engine and lowers it, never below zero.
- **Due diligence** (Library Search or Business; 200 eb) on another business, named as the players know it (their client cannot list other businesses, so nothing is revealed about which exist): a pass tells its state bands and a range for its book value, ±30% on a narrow pass down to ±5% on an exceptional one. What it found is kept with the company (the last five).

**Built:** officers and the information rolls in `scripts/engine/businessCompany.js` (`officersOf`, `canRun`, `officerProposal`, `infoCheck`, `applyInternalAudit`, `applyDiligence`, `exposureBand`), the `elect` and `dismiss` proposal kinds, `auditRoll` and `diligenceRoll` requests, and the service resolving a due diligence target by name. Tests in `tests/businessCompany.test.mjs` and `tests/businessWindows.test.mjs`.

**Tested in the test world** (v0.12.0, 2026-10-31, on "Charter Test Clinic", a registered clinic made to meet the milestones): the milestones, agreement and fee; the three charter rolls (a hired professional, extra time); GM approval forming the company at once (its net assets covered the quote); the five-action Work tab, Chase contracts and Shortcuts lifting the takings and leaving Exposure; internal audits (a fumble, a pass, an exceptional one wiping Exposure); due diligence; two monthly reports, one standard and one Bold; an investor invited and accepting; an officer elected and dismissed, the last officer kept. It found and fixed: due diligence refused from a player's window (the target is named, and only the GM's service finds its id); weeks closing on the wrong weekday after New Year, because the world's Simple Calendar restarts its weekdays each year (weeks now close on the calendar's own closing day, asked date by date); the charter waiting line when the net assets cover the quote; an audit not saying what it found before wiping it. Changed on the user's request: the monthly report on the Ledger tab, each report opening a window with the real figures beside the reported ones, and shareholders holding shares in place of partners holding units from chartering on. Not tried live: the funding window, a refused or failed charter, and the other three company actions (all covered by tests).

## 32. Employees (E1 and E2 in v0.12.0, E3 in v0.13.0)

Characters, player or NPC, can work for a player business as **employees**. Partners own a business and run it; employees work in it for a wage. Their skills lift what the business earns according to the job they hold, they can be called in to make the business's rolls for overtime pay, and they bring loyalty, staff events and training with them. Employees work at every stage (§27.0) and for a syndicate's business too (B3b), so this phase sits beside B1 to B4 rather than after them. It should be built before going public (B5), because wages change a company's profit, and so its valuation.

**Choices made** (decided before writing this):
- **Who can be hired:**
  - a player character, who accepts an offer, as an investor does (§29);
  - an NPC actor linked to a Night City Messenger contact tagged `staff` or `employee` (the same rule as investors, with its own tags);
  - a **recruit** found on the street with a recruiting roll: a generated name and skill level, so the GM need not build an actor for every shop hand.
- **Posts.** An employee holds a post, and the post decides which of their skills count and what they do for the business.
- **From stage 0.** A side business can take on 1 employee, a registered business 3, a chartered company 8. Wages make early hires a cost rather than a gain, so the business's growth decides when staff pay off.
- **Extras in the design:** loyalty, staff events and vetting, training and share grants, and an Exec's Teamwork team as staff.

### 32.1 Skill levels and posts

**Skill base.** An employee's base in a skill is stat + skill, the number a roll adds to the d10 (§27). An employee's base for a post is their best base among the post's skills. A role ability that fits the business (a Medtech's Medicine at a clinic, a Tech's Maker at a garage) counts one level higher. Bases fall into four levels, matching the hired professionals' fixed bases (10, 13 and 16):

| Level | Base | A recruit's base |
|---|---|---|
| Green | 8 or less | 7 |
| Skilled | 9 to 12 | 10 |
| Expert | 13 to 15 | 13 |
| Master | 16 or more | 16 |

**Reading skills.** A player cannot open an NPC actor's sheet, and the module does not read actors a player does not own from that player's client, so the GM's service reads the NPC's sheet when they are hired and again each week. It records their base in every skill and ability a business roll names (`bases`), and the roll dialog and the Staff tab read from that record. A recruit has their level's base in their post's skills and is Green (7) in everything else. A player character's bases are read from their own sheet, as for a partner.

**Posts.** A business may have one manager; the other posts take as many people as its headcount allows. Floor staff are also limited to the business's Capacity, rounded down (at least 1), so expansions make room for more hands.

| Post | Stage | Skills that count | What it does each week |
|---|---|---|---|
| Floor | any | the archetype's trade skills (§28); its role abilities count one level higher | lifts the takings by (base − 6) × 1.5%: 6% for a base of 10, 15% for 16 |
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

### 32.2 Wages and overtime

**Wages.** An employee's going rate is a rate per point of their post's base each week: 5 eb at a side business (part-time), 9 eb registered and 14 eb at a company. So a Skilled floor hand with a base of 12 costs 60, 108 or 168 eb a week. The partners may offer more or less than the going rate: each 10% above it adds 5 to starting loyalty, each 10% below takes 5 off, and an NPC or recruit refuses less than 80%. Wages are an upkeep line, paid from the cash when the week closes, after the takings and before loan payments, and they count against the week's profit. A player character's wage comes attached to a payslip by Messenger mail, for them to claim (as a broker's withdrawal does); with the world setting off, or a mail that cannot be sent, it goes straight to their eddies instead.

**Unpaid wages.** If the cash cannot cover every wage, those left unpaid are owed (back pay, paid first next week) and lose 15 loyalty. Two weeks unpaid and they quit.

**Overtime.** A partner (an officer, at a company) can call an employee in for any of the business's rolls: an action slot, a complementary check, an event response, a report preparation, an audit or due diligence. In the roll dialog, the employee appears beside the hired professionals (`use: {kind: 'staff', staffId}`), with their base for the skill chosen and the overtime pay:

| Overtime | Pay, from the cash |
|---|---|
| Taking an action slot, answering an event, preparing a report, an information roll | 50% of a week's wage |
| A complementary check (+1) | 25% of a week's wage |

The usual levers apply except Luck, which is a character's own, and extra time, since the overtime is their time. A player-character employee can roll their own overtime on their own client, with their own Luck, once a partner has put them on call for that week. Each employee works at most two overtime shifts a week, and each shift after the first costs 3 loyalty. Overtime is the cheaper way to get a roll made: a Skilled employee's overtime at a registered business costs about 54 eb, where a hired professional of the same level costs 150.

### 32.3 Hiring, leaving and firing

**Recruiting** (`recruitRoll`). A partner looks for someone for a post: a Business, Streetwise or Library Search roll at the stage's DV, costing 50, 100 or 200 eb by stage for the ads, the fixer's cut and the drinks. The band sets the candidate's level: a narrow pass Green or Skilled, solid Skilled, strong Expert, exceptional Expert or Master. The candidate is drawn from the seed: their name, their level, and perhaps a hidden trait (§32.4). A failed roll finds nobody, and a fumble finds someone worse than nobody: a candidate with a bad trait. A candidate waits 7 days to be hired.

**Hiring.** A `hire` proposal names the candidate, NPC or player character, the post and the wage. It passes on a majority of the votes (a majority of the shares at a company). A player character must accept the offer from their own window; the GM accepts for an NPC from the Businesses tab, as for an NPC investor. A partner cannot also be an employee of the same business.

**Leaving.**
- **Quitting.** An employee whose loyalty falls below 25 may quit when a week closes (drawn from the seed), and one below 10 quits at once. A player character can quit any time, with a week's notice.
- **Firing.** A `fire` proposal passes on a majority and costs a week's wage in severance. Firing an employee with loyalty below 25 may bring a grudge event later.
- **When a partner leaves.** An Exec's team leaves with the Exec (§32.5).

**A player character's view.** An employee who is a player character is not given the business's record (that would show them its ledger). The GM's service mirrors their job onto their own actor as a flag: the business, their post, their wage, their loyalty, whether they are on call, and any roll asked of them. The Business window shows that to them as a Job view.

### 32.4 Loyalty, vetting and staff events

**Loyalty**, from 0 to 100, starts at 50 (moved by the wage offered) and is shown to the partners as a band (sullen, steady, loyal, devoted).

| Moves it up | Moves it down |
|---|---|
| a paid week: +2, up to 60 | a missed wage: −15 |
| a profitable month: +3 | a second overtime shift in a week: −3 |
| a bonus (paid from the cash): +5 per quarter-week's wage | a pay cut, or a refused raise: −10 |
| a share grant (§32.5): +20 | an event left unanswered that hurt the shop: −2 |

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

**Staff events.** These join the weekly event table (§29) when a business has staff, answered as other events are:

| Event | Unanswered | Answered with |
|---|---|---|
| Sick day | one employee's post does nothing this week | Paramedic, Medicine, or overtime cover |
| Light fingers | 5% to 15% of the week's takings missing | Human Perception, Interrogation, Library Search; a pass catches the thief, who can be fired without severance |
| Pay dispute (company, 4 or more staff, average loyalty below 50) | the staff down tools: an unworked week, and −5 loyalty each | Persuasion or Business; or a bonus |
| Poaching offer | the best employee leaves, unless their loyalty is 75 or more | Persuasion; or a 10% raise |
| Accident at work (garage, gun shop, security, courier) | medical costs from the cash, and the employee is out for a week | Paramedic, Medicine |
| Star turn (good) | Reputation +2 if answered | Business or Persuasion, to make the most of it |

### 32.5 Training, share grants and an Exec's team

**Training** (built in E3, see §32.11). Once every 4 weeks per employee, the partners can pay to raise an NPC employee's base in their post's skills by 1. It costs 50 eb per point of their current base and 2 business days from a partner whose own base is higher (a mentor), or twice the eb with no mentor (a course). Training can raise a base by at most 4 over what it was at hiring, and to no more than 18. A better employee wants a better wage: at the next month's end they ask for the new going rate, and refusing them costs 10 loyalty. A player character trains with their own Improvement Points as usual, and the service reads their sheet's new bases.

**Share grants** (company only). A `grant` proposal, passed on a majority of the shares, issues new shares without a vote to an employee, up to 5% of the company in total across all grants. They vest after 12 weeks and are lost if the employee leaves first. While vesting they add 20 loyalty and keep it at 50 or above. Once vested, the employee holds them like an angel investor (§29): a share of every payout, and a share of the proceeds if the company closes. From B5 they take part in the listing like any holder.

**An Exec's team.** A partner who is an Exec may staff their Teamwork team as employees: one team member for each 3 ranks of Teamwork, rounded up. Their level comes from the Exec's rank: Green at ranks 1 to 3, Skilled at 4 to 6, Expert at 7 to 9, Master at 10. Team members take no wage, start with 75 loyalty, take headcount places, and leave if the Exec leaves the business. This sits beside Teamwork's use as an ability on Chase contracts (§31.2).

**Two jobs: divided loyalties** (E3; the user's choices, 2026-10-31). An NPC may hold jobs at two businesses at once (in the test world, Tyger is security at the Splice Chrome Clinic and at Charter Test Clinic). Today the two jobs know nothing of each other. In E3 the GM's service notices an NPC with another employer (the same actor on another business's staff) and passes that to each business's week, as it passes traits. Recruits only ever work for one business; a player character with two jobs is the player's own affair, and none of this applies to them.

- **Shared shifts.** A person works at most 2 overtime shifts a week in total, across every employer. A business calling in an employee who has already worked their shifts elsewhere is refused ("they have already worked their shifts this week").
- **Staff events, only for an employee with another employer:**
  - **Double-booked.** Both businesses need them the same week. Answered with Persuasion or Business, they work your shift; otherwise they are off for you that week, like a sick day.
  - **A full-time offer.** The other employer, named, tries to take them on full time: answered as a poaching offer (Persuasion, or a raise). Lost, they quit you and stay with the rival, so the two businesses' players compete for one employee. The other business does not roll; the event is yours to answer.
  - **Talking shop.** They let something slip about you at their other job. Unanswered, the other business gains a free due diligence report on yours (your bands and a range for your value, as §31.3). Caught with Human Perception or Interrogation, nothing leaks; on a strong or better result you learn about them instead (a due diligence report on the other business).
- **Strain.** While they hold two jobs they cannot reach the devoted band at either (loyalty stops at 74), and their chance of a sick day or an accident at work is a third higher.
- **Seen by whom.** Each business's Staff tab notes "also works for <business>" once the business has run into it: from the first two-jobs event (NPCs are not vetted, so vetting cannot show it). The GM's Businesses tab always shows it.
- **Settled 2026-10-31:** the other business's owners are told, by a line in their weekly digest, when a two-jobs event at your business touches them (a full-time offer won, something let slip). No "no second job" pay term.

### 32.6 Other links

- **Gigs** (§27.5). An employee in trouble (kidnapped, arrested, owing a gang) is a ready gig hook for the GM. Through the map bridge a gig can name an employee, and its outcome moves their loyalty, or brings them back.
- **Syndicates** (B3b). A syndicate's business hires like any other. Its officers act for it, and wages and overtime count against the officer's daily limit.
- **Going public** (B5). A bookkeeper and every officer see the weekly digests, so a player-character bookkeeper trading the company's shares falls in the officers' insider window (§27.4).
- **Corporate play** (B6). A fired disloyal employee, or a corp plant, can be the source a regulator's investigation starts from. A rival poaching your staff is a B6 move.
- **Perks for player-character employees.** A staff discount, such as cheaper installs at the clinic or repairs at the garage, is shown on their Job view as a note for the GM to honour. The module does not change prices on the sheet.

### 32.7 Record, requests and windows

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

### 32.8 Phasing

| Step | What is built |
|---|---|
| E1 Staff | posts, levels, wages, headcount, hiring player characters, tagged NPCs and recruits, overtime in the roll dialog, the Staff tab and Job view |
| E2 People | loyalty, quitting and firing, vetting and traits, staff events, bonuses |
| E3 Careers | training, share grants, an Exec's team, two jobs (divided loyalties, §32.5), and the B5 and B6 links when those phases are built |

Each step ends as the others do: engine tests, flow tests, a schema migration, a simulator check of the wage and lift targets in §32.1, and a run in the test world.

### 32.9 E1 as built

E1 is `scripts/engine/businessStaff.js` (pure), wired into the business engine, with `tests/businessStaff.test.mjs` and `tests/staffFlow.test.mjs`. It follows §32.1 to §32.3, with these decisions made while building it:

- **Pay is a share of the going rate.** The partners offer 80% to 150% of the going rate (`pct`), not a sum in eb. A player cannot open an NPC's sheet, so they do not know the eb before hiring. The wage is worked out again each week from the employee's base for the post, the stage and that share, so it follows the employee's skills, and it rises when the business steps up.
- **Abilities.** A fitting role ability counts for a post as its rank + 9 (rank 4 counts as 13, Expert). For an overtime roll an employee uses an ability at its rank, as a partner does.
- **Overtime.** An employee called in rolls their best use for the roll, an alternative skill's DV step counted against it (`{kind: 'staff', staffId}`, which the GM's service fills in with the base from the record). The partner presses Roll, and the card is checked like any other. The employee cannot use Luck or business days, and the overtime is paid from the cash when the roll counts. An employee helping (a complementary check) is a helper of their own, so the partner who called them in may still help.
- **Automatic shifts.** The manager's work and security's answer are each a slot marked `staff`, rolled from the seed when the week closes. They are added before the week is counted and do not use one of the partners' slots. A manager at a company chases contracts. A compliance officer answers an inspection the same way.
- **Wages** are paid after the takings and upkeep and before the loans, as far as the cash goes. They count against the week's profit, and the digest and the ledger show them. What the cash cannot cover is owed and paid first the next week; E1 does not yet make anyone quit over it.
- **A player character's job** is mirrored onto their own actor (`flags.night-city-investments.jobs`) by the GM's service after every change to the business. The Business window shows it as **Your jobs**, with Take the job, Turn it down and Quit. A player character can quit at once, without notice or severance.
- **The Hire window, and advertising.** Each open post on the Staff tab has a Hire button that opens a window for that post (`HireDialogApp`): hire a character at a share of the going rate, or **advertise the job**, the recruiting roll (Business, Streetwise or Library Search at the stage's DV, 50, 100 or 200 eb, once a week). An advert brings applicants, not one candidate. The band sets how many (a failure 1 weak applicant, narrow 1 or 2, solid 2, strong 2 or 3, exceptional 3; a fumble nobody), the range of their base in the post's skills (6–8 on a failure up to 12–17 on an exceptional roll), and what each asks as a share of the going rate (110–140% on a failure down to 85–110% on an exceptional roll), each drawn from the seed. An applicant is hired on what they ask. A new advert for a post replaces the applicants still waiting for it, so the old limit of three candidates waiting is gone. Applicants wait 7 days, listed at the foot of the Staff tab, where they are hired; the Hire window closes once the advert's roll is made. The staff table's Skill column names the skill that counts for each employee's post (a role ability with its rank, or a skill a level lower).
- **Dragging a character into the Hire window.** The "Hire a character" block of a role's Hire window takes a character dragged from the Actors directory. The window checks the character can be hired there (a player character or a tagged NPC, not a partner, not already on the staff, the role open), asks for confirmation, and proposes the hire at the pay set in the form. (At first the Staff tab's posts took the drop, with a pay field above them; both were removed.) The Staff tab calls posts *roles*.
- **NPC offers** wait in the GM Console's Businesses tab, which counts them among what needs the GM. A recruit starts at once.
- **No migration.** The record's normalizer fills in the new fields (`staff`, `candidates`, `lastRecruit`, and `overtime` on the week), so stored businesses need no step.

**Checked against §32.1's targets** (a clinic at neutral Reputation, no district; the floor post's lift against its wage, before upkeep):

| Stage, Capacity | Base 9 | 12 | 13 | 16 |
|---|---|---|---|---|
| side business, 1.3 | −30 | −30 | −30 | −29 |
| registered, 4.5 | −28 | −3 | +6 | +32 |
| company, 8 | −32 | +19 | +36 | +88 |
| company, 14 | +38 | +160 | +200 | +322 |

A floor hire breaks even near the registered stage's ceiling and earns clearly as a company, as intended. At a side business staff are only worth their other work (a manager freeing the crew, overtime). Overtime is cheaper than hiring a professional (a Skilled employee's roll at a registered business is 54 eb against 150). One target is missed: the margin keeps rising with the level instead of peaking at Expert, because the lift grows faster with the base than the wage does. It is left for the simulator pass with E2, where loyalty and poaching also weigh on dear staff.

**Also fixed:** the vote lines for electing and dismissing officers had no text (`NCI.Business.Proposed.elect` and `dismiss`), and several requests from B4 had no confirmation message.

**Not built yet:** a player character rolling their own overtime with their own Luck (on call), and everything in E3 (training, share grants, an Exec's team). The payslip, changing an employee's post, and the rest of the list E1 left are built in E2 (§32.10).

### 32.10 E2 as built

E2 is `scripts/engine/businessPeople.js` (pure), with small hooks in `businessStaff.js`, `businessEvents.js` and the weekly close, tested in `tests/businessPeople.test.mjs` and `tests/staffFlow.test.mjs`. It follows §32.3 and §32.4, with these decisions made before and while building it:

- **Masters ask more.** This fixes the target E1 missed. Each point of base above 15 costs three times the rate (`premiumFrom` 15, `premium` 2), so a Master's going rate at a registered business is (16 + 2) × 9 = 162 eb, not 144. Measured with the engine (a clinic, a solid week's work, the floor post's margin against having no one):

  | Stage, Capacity | Base 9 | 12 | 13 | 15 | 16 | 17 |
  |---|---|---|---|---|---|---|
  | side business, 1.3 | −28 | −27 | −26 | −25 | −34 | −49 |
  | registered, 4.5 | −23 | +8 | +18 | **+39** | +31 | +23 |
  | company, 8 | −21 | +43 | +64 | **+107** | +100 | +93 |
  | company, 14 | +59 | +202 | +250 | +345 | +365 | +384 |

  The best margin is now at Expert, except at a company near its Capacity ceiling, where a Master still earns more.
- **Loyalty** is kept for NPCs and recruits only; a player character's is the player's own (shown as a dash). It follows the table in §32.4: it starts at 50, ±5 for each 10% of the going rate offered (an applicant starts at 50, being paid what they asked). A paid week adds +2 up to 60, a missed wage −15, a profitable month (every fourth week) +3, a second overtime shift −3, an unanswered bad event −2. The partners see the band (sullen below 25, steady, loyal, devoted from 75); the GM sees the number in the Businesses tab. At a week's close an employee below 25 quits one week in four (drawn from the seed), one below 10 walks out, and two weeks owed in a row make them quit. Devoted staff get +1 on overtime, ignore poaching, and roll security's and compliance's automatic answers a band better.
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
- **Payslips.** As a week closes, each player character on the staff gets a Night City Messenger mail from the market wire with their wage, what was paid and anything owed, and the wage paid attached for them to claim (changed for v0.12.0; it used to go straight to their sheet). A world setting, *Payslips by Messenger*, turns the mail off, and the wage then goes straight to their sheet, as it does if the mail cannot be sent.
- **The digest** lists what happened to the staff (off sick, hurt, poached, caught, asks for a raise, quit, walked out, quit unpaid), and an accident's medical bills.
- **No migration.** The normalizer fills in loyalty (50, or none for a player character) and keeps the new fields.

**Not built yet:** nothing left of E3 (§32.11); the B5 and B6 links come with those phases.

**Tested in the test world** (v0.12.0, 2026-10-31, at the Splice Chrome Clinic): overtime for a help and for a slot, a second shift's loyalty cost, an advert, vetting with an exceptional result, turning an applicant away, hiring, a bonus, a raise, moving an employee to another role, weekly loyalty, staff events (a star turn, a sick day), letting an employee go, an NPC offered a job and the GM answering, and a fourth hire once a staff room was built. It found and fixed: the employee a staff event is about could answer it; Item Piles actors offered as heirs and hires; "Proposal made." shown for a proposal the proposer's units carried at once. Changed on the user's request: a player character's wage comes on their payslip mail to claim. Not tried live: a player character's job from offer to payslip, raises asked at a month's end, hidden traits at work, and a sullen employee quitting or stealing (all covered by tests).

### 32.11 E3 as built

**The user's choices (2026-10-31).** Build E3 in this order, each part tested and committed before the next: training, a player character on call, two jobs, share grants, the Exec's team. A player character on call is asked for a roll by a partner (an officer, at a company): the slot, event or check appears in their Job view with a Roll button, rolled with their own skills and Luck. A player character's overtime goes onto that week's payslip, claimed with the wage, as wages are. For two jobs, the other business's owners are told in their weekly digest (§32.5).

**Training (E3a).**
- **What it raises.** The employee's best skill for their post, not every skill of the post: the one that counts (a role ability is not trained). It rises by 1, kept apart from the employee's `bases` (`staff.training`, by skill), because an NPC's sheet is read again every week and would wipe it; `staffBase` adds it on top. Moving to another post keeps it on that skill.
- **Who.** NPC and recruit staff only; a player character improves with their own Improvement Points (refused as `not-trainable`). Whoever runs the business asks for it, from the Employee window, like a bonus.
- **Cost and limits** (`staff.training`): 50 eb per point of the skill now from the cash with a mentor, twice that on a course; a mentor is the asking partner, whose own base in the skill (read from their sheet by the GM's service, `basesOf`) must be higher, and who spends 2 business days. Once every 28 days (`trainedDay`); at most +4 from training; never above 18.
- **A mentor's lesson is a roll** (the user's choice, 2026-10-31): the mentor rolls Education, or Persuasion a step harder, at the stage's DV, from the Employee window's Mentor button (`trainRoll`), with every usual lever (approach, Luck, extra time) but no hired professional and no employee called in. The eb and the 2 business days are spent whatever the result. Narrow or better teaches (+1); a failure teaches nothing; an exceptional lesson also lets them train again after 14 days; a fumble teaches nothing and costs 5 loyalty. A course is not rolled, and always teaches. The mentor's own base in the trained skill is still checked (the GM's service reads their sheet) before anything is spent.
- **Pay.** No raise is asked for afterwards, as the plan had it: a wage is worked out from the employee's base every week, so it rises with the trained skill from the next close.
- **Windows.** The Employee window's Training section names the skill and how far training has taken it, whether the account picked can mentor, the two buttons with their cost, and when training can next be done. Ledger lines "trained, mentored by…" and "sent on a course by…".
- **Tests.** `tests/businessPeople.test.mjs` (course, mentor, delay, limit, player character, a sheet re-read) and `tests/staffFlow.test.mjs` (the window, and a course through the GM's service).

**A player character on call (E3b).**
- **Asking.** Whoever runs the business asks a player character on the staff for one of this week's rolls from their Employee window's On call section (`askStaff`): a free action slot, the week's event, or a help with an action not yet taken. The roll must be one the partner could make now. One request at a time per employee, kept on the week (`period.asks`); it lapses when the week closes. The partner can withdraw it, and the employee can decline it (`cancelAsk`). An NPC is still called in from the roll dialog, as before.
- **The employee's roll.** The GM's service mirrors each request onto the player character's job (`jobs[].asks`) with what their roll dialog needs (the ways it may be rolled, the DV, any +1 waiting, the overtime, what each result means), since an employee cannot read the business. Their Job view shows it with Roll and Decline buttons; the roll dialog opens from the job, and they roll with their own skills and Luck (`staffRoll`), with the approach and any +1 waiting, but no extra time (business days are the partners') and no hired professional. The GM's service checks everything again: the request is still theirs, they have an overtime shift left, the cash can pay, the slot is still free.
- **What it counts as.** The slot, the event's answer or the help is the employee's (`by` their staff id), as an NPC's overtime is. It is one of their two shifts a week.
- **Overtime on the payslip** (the user's choice): a player character's overtime, whether asked for or called in from the roll dialog, comes from the cash when they roll and is added to that week's payslip (`period.pcOvertime`), claimed from the mail with the wage. The payslip says how much was overtime.
- **Tests.** `tests/staffFlow.test.mjs` runs it end to end: the Employee window's options, asking, the job carrying the request, the Job view, the roll dialog from the job, the roll counting with Nova's own Luck, the overtime for the payslip, and declining. (The fake Foundry's characters now record Luck spent.)

**Two jobs (E3c)**, as §32.5 planned, with these choices made in building it:
- **Where else.** Before every request and every weekly close, the GM's service notes on each NPC employee the other business they also work for, from every open business (`staff.elsewhere`: its id, name, and the overtime shifts they have worked there this week; `markElsewhere`). Only NPCs: a recruit works for one business, and a player character's second job is theirs to juggle. Players' windows show it only once known (`knownElsewhere`, set by the first two-jobs event); the GM's Businesses tab always does.
- **Shared shifts.** Calling them in is refused once their shifts here and there make two (`shifts-elsewhere`). The roll dialog reads the record as last saved, so it may still offer them; the GM's service, which notes the shifts first, refuses.
- **Strain.** Their loyalty cannot go above 74 while they hold two jobs (`loyaltyCap`, applied whenever loyalty moves and when the second job is first noted), and sick days and accidents are a third likelier where anyone on the staff is torn.
- **The events** (weights 2, 1 and 2; drawn only when someone has a second job, about one of them; the event names the other business as drawn):
  - *Double-booked:* answered with Persuasion or Business they work here; otherwise they are idle this week, like a sick day.
  - *A full-time offer:* answered with Persuasion, or a raise of 10% or more this week, they stay; otherwise they leave this business (ledger "left to work full time…") and the other business's next digest says they now work there full time.
  - *Talking shop:* answered with Human Perception or Interrogation and passed, nothing leaks; a strong or exceptional answer also gives this business a due diligence report on the other. Otherwise the other business gets a report on this one (its bands and a value within ±20%), and a digest note.
- **Reaching the other business.** The weekly close reports the event's effect on the other business (`twoJobs`), and the GM's service carries it out after saving: a report added to its `intel`, and a note added to its `pendingNotes`, which its next close puts in that week's digest. Reports are kept for every business, though the Work tab lists them only at a company.
- **Fixed in passing:** the "if nobody answers" line of a staff event never named the employee (it showed `{name}`).
- **Tests.** `tests/businessPeople.test.mjs` (marking, shared shifts, the cap, the weights, each event, the notes) and `tests/staffFlow.test.mjs` (a leak reaching the other business, the Staff and GM tabs, the event on the Work tab).

**Share grants (E3d)** (the user's choices, 2026-10-31: any employee, sized as a share of the company, kept after leaving):
- **Proposing.** At a company only, from the Employee window's Share grant section: a `grant` proposal naming a share of the company, 0.5% to 5% in half-percent steps, passed on a majority of the shares. All grants together, vested and vesting, may come to no more than 5% (`grantedShare`; refused as `grant-cap`). One grant vesting per employee at a time.
- **Vesting.** An agreed grant (`staff.grant`: the share, the day granted, the day it vests) vests 84 days later, at the first weekly close on or after that day (`vestGrants`). New shares are issued then, without a vote, so the grant is exactly its share of the company at that moment. A player character holds them in their own name, as a holder who can draw their share like any other (added to their stake if they already hold one); an NPC or recruit holds them quietly, as an angel does (`npc:<staff id>`). Holders from grants are marked `grant` (`grantUnits`). They keep them if they leave or are let go; an employee who leaves before vesting loses the grant.
- **Loyalty.** An agreed grant lifts loyalty by 20, and while it vests loyalty cannot fall below 50 (the two-jobs cap of 74 still applies above).
- **Windows.** The Employee window shows a grant vesting (and when), the share vested, and what is left of the 5%; the Staff tab notes both; the vote reads "proposes granting … 2% of the company in shares"; the digest notes a grant vesting. From B5 granted shares take part in a listing like any holder's.
- **Tests.** `tests/businessPeople.test.mjs` (company only, the steps and the cap, loyalty and its floor, an NPC's and a player character's grant vesting to exactly their share, a grant lost on leaving) and `tests/businessWindows.test.mjs` (the Employee window's Share grant section).
- **Linking.** An NPC holding granted shares is recorded under `npc:<staff id>` with their character (`actorRef`), so the Shareholders tab and the GM's owners table link to it as they do a player character (`holderActorId`, which also finds the character from the staff entry for a holding saved before).

**An Exec's team (E3e)** (the user's choices, 2026-10-31: the Exec names each member; overtime costs as if on the going rate; no training or share grants):
- **Adding.** A partner who runs the business and has Teamwork (read from their sheet) sees a "Your team" section in each role's Hire window and adds a member there, typing a name (one is offered): `addTeam`. One member for each 3 ranks of Teamwork, rounded up; the role must have room, as for any hire (they take headcount places). Their base in the role's skills is set by the Exec's rank: 8 at ranks 1–3, 11 at 4–6, 14 at 7–9, 16 at 10 (`staff.team`); a skill counting a level lower takes that off, as for anyone. Moved to another role, they keep their level in its skills. A team member already made can be dragged from the Actors directory onto the team section instead (the user's request, 2026-10-31): an NPC actor (character or mook, not a player's character, not a partner, not on the staff, listed by the GM's service as `teamActors`), who keeps their name and sheet link; their skill in the role still follows the Exec's rank, and the weekly re-reading of sheets leaves a team member's bases alone.
- **On the staff.** Source `team`, with the Exec (`leader`) and their level (`teamBase`). They take no wage (shown as "unpaid"), start at 75 loyalty, never ask for a raise, cannot have their pay changed, be trained or be granted shares; they can be given a bonus, moved, asked for overtime (paid as if on the going rate for their skill), and let go. Staff events and two-jobs rules apply to them as to any NPC.
- **Following the Exec.** Before every request and weekly close the GM's service brings each team in step (`refreshTeams`): a team whose Exec is no longer an active partner leaves; a changed rank moves the members' level, and a smaller team loses its newest members; the digest notes who left.
- **Tests.** `tests/businessPeople.test.mjs` (the size and level by rank, the refusals, overtime, the refresh, leaving with the Exec) and `tests/staffFlow.test.mjs` (the Hire window, a member joining through the GM's service, the Staff tab).

**E3 is complete** (training, on call, two jobs, share grants, an Exec's team), released in v0.13.0.

**Tried in the test world before release** (2026-10-31): a player character (Bunk) on call at Charter Test Clinic, their overtime held for the payslip, which then led to payslips naming overtime apart from the wage and the Job view showing overtime due; two jobs for Tyger, at both clinics, marked at each, loyalty capped at 74, and a Double-booked event drawn and shown on the Work tab (once clients were reloaded); an Exec's team member dragged in from the Actors directory. Training, share grants vesting and the other two-jobs events are covered by the tests but were not seen live.

## 33. Projects beside expansion (v0.12.0)

The Projects tab offered only an expansion (§29). Four more kinds of project now sit beside it, chosen by the user, each paid from the cash once a majority of the votes agrees (a `project` proposal naming the kind; the older `expansion` proposal still works) and finished with business days. **One project at a time.** Costs and days are by stage (side business / registered / company):

| Project | Cost (eb) | Days | Effect |
|---|---|---|---|
| Expansion | 1,500 / 2,500 / 8,000 | 3 / 6 / 9 | Capacity +0.25 / +0.8 / +1.5, up to the stage's ceiling (as before) |
| Refit | 600 / 1,500 / 5,000 | 2 / 4 / 6 | Cost base −0.05 at once, never below its floor; repeatable while there is room, since the Cost base creeps back up |
| Security upgrade | 800 / 2,000 / 6,000 | 2 / 3 / 5 | Levels 1 and 2: each cuts protection money by 25% and halves how often break-ins are drawn |
| Storefront | 700 / 1,800 / 6,000 | 2 / 4 / 6 | Reputation +5 at once, once a stage; once there is one, Reputation settles 3 higher (53, or 58 with a salesperson) |
| Staff room | 500 / 1,200 / 4,000 | 2 / 3 / 5 | Once a stage: one more headcount place each, and paid weeks lift NPC staff loyalty to 70 rather than 60 (E2) |

What a project builds is added to the business's assets at cost, as an expansion's fit-out is. Upgrades are kept on the record (`upgrades`: security's level, and the stages a storefront and a staff room were built at); the normalizer fills it in, so no migration.

**The tab** follows the Work and Staff tabs: a short intro; Capacity as a bar against the stage's ceiling, with the next expansion's gain hatched; the project under way with a progress bar, who has put days in (`crew`), and the add-days row; a table of every kind with what it would do from where the business stands, its cost and days, a Propose button under the header's "Business days left 3/3", and why it cannot start, in figures for money ("Needs 2,000 eb; the cash holds 1,300 eb"); and a table of the projects finished, with their cost, days, result and crew.

**Tested in the test world** (v0.12.0): a staff room, built with business days and making room for a fourth employee. Not tried live: a refit, a security upgrade and a storefront (covered by tests).

## 34. Phase B5: going public (v0.14.0)

The plan is §27.4a (listing eligibility), §27.7 (capped payouts) and the B5 entry in §27.9's phasing.

**The user's choices (2026-10-31).**
- **In three parts,** each tested and committed before the next: B5a, the valuation, the listing checklist, agreeing to list and the prospectus rolls; B5b, the listing itself (the market entry, the IPO window, holdings into portfolios); B5c, after listing (report earnings moving the price, capped dividends, the liquidity cap, insider windows, the delisting review, the links between the Business window and the terminal).
- **Holdings into portfolios.** At listing each character's or syndicate's shares become a holding of the new ticker in their brokerage portfolio, locked for 28 days (the lock-up), then tradable; NPC holders (angels, granted NPCs) stay as untraded other holders; the float is new shares sold in the IPO, raising cash for the company.
- **Control follows holdings.** After listing, votes follow the shares held in characters' and syndicates' portfolios, read at each vote; officers must hold shares; shares held by nobody in particular do not vote.
- **The threshold stays at 500,000 eb,** as a world setting (*Listing threshold*) the GM can lower.

**B5a as built** (`scripts/engine/businessListing.js`, `tests/businessListing.test.mjs`).
- **The valuation V** (`valuation`): net assets, less cash newly paid in (investments, top-ups, charter payments, an angel's money) within the 28-day lock-in, plus the last three monthly reports' **reported** profit, averaged and annualised (13 four-week months; never below zero), times the sector multiple (`listing.multiples`: tech 14, biotech 13, health 12, finance 11, security and arms 10, media and energy 9, transport 8, construction and consumer 7, other 6). Reported profit counts, so aggressive reporting lifts V as it would a share price. Each monthly report records V (`report.valuation`); the report window shows it.
- **The checklist** (`listingMilestones`, the Growth tab at stage 2, "To become a Listed company"): V at the threshold now; V at the threshold on the last 3 reports in a row; at least 3 reports; 56 days since the charter; Compliance 50 or more; no unresolved compliance concerns (the GM's service marks hidden Exposure of 15 or more as `listingConcerns` before every change, so players see only the line); and the listing fee in the cash.
- **Agreeing.** A `stepUp` proposal at stage 2 naming the float (20% to 40% in 5% steps), needing every shareholder with a vote, as the charter does. When it passes the fee (2% of V) is paid from the cash and the listing waits for the GM (`listing.status` 'awaiting'). A listing turned down or failed may be agreed again after 14 days; the fee is never refunded.
- **The GM** approves or turns it down in the Businesses tab, which shows V, the float and the hidden Exposure.
- **The prospectus rolls** (`prospectusRoll`, officers only, a hired professional allowed): the filing (Accounting, or Business at DV +2) and the offering (Trading, or Persuasion at DV +2), at DV 17, with the usual levers. A failure ends the attempt. Both passed, the **offer** is set: the price per share is V per share times 1 + the average of the two results' factors (narrow −5%, solid 0, strong +7%, exceptional +15%, each doubled if rolled Bold, within ±15%); the float is the one agreed, capped by the offering's demand (narrow 20%, solid 25%, strong 30%, exceptional 40%), as new shares making that share of the company. The status is then 'ready'; B5b takes it from there.

**B5b as built** (`businessListing.js`, `BusinessService` `_scheduleListing`, `onIpo` and `_syncHolders`, `tests/listingFlow.test.mjs`).
- **The market company.** When both prospectus rolls pass (status 'ready'), the GM's service makes the market company under the ticker (`listingCompany`): the business's name and sector, its `businessId`, unlisted, priced at the offer, its shares outstanding those held plus the float, a thin market (liquidity 1), and an IPO 5 days on (`listing.ipoWindowDays`) at the offer price with the float as the players' allocation. The listing becomes 'scheduled'; the offering shows on the terminal, and anyone may subscribe. A ticker already taken by another company stops it (a warning in the console).
- **Listing day.** The market's IPO service lists the company and fills the subscriptions as for any IPO; its corporate-action hook calls `BusinessService.onIpo`, which completes the listing (`completeListing`): the whole float is sold (what players did not take, the market did), so the company's cash gains the float at the offer price (ledger "IPO proceeds"); the market's shares are a silent holding (`npc:market`, shown as "Public float (the market)"); each character's and syndicate's shares become a lot of the ticker in their brokerage portfolio at the offer price, **locked up** for 28 days (`lockedUntil`, in market days); NPC holders stay on the record. The status is 'listed'.
- **The lock-up.** A locked lot counts as held but cannot be sold: an order is refused as "locked-up", and a sale takes only free lots (`sellableQty`, `consumeLotsFifo` with the tick).
- **Shareholders follow holdings** (`syncListedHolders`, before every request and weekly close): each account's shares of the ticker set its units and vote; one who sold out leaves; a new buyer joins, with a vote; the market's holding is the rest of the shares outstanding. Officers who no longer hold shares drop out, as officers must be voting holders.
- **Stage.** A listed company still runs on stage 2's numbers (its slots, costs, headcount); windows call it a "Listed company" (stage 3's name). Draws stop once listed (dividends come with B5c). The Portfolio tab's private businesses and syndicate values leave a listed company out: its shares are a market holding now.

**B5c as built** (`businessListing.js` `earningsTarget`, `payoutOffer`, `payListedDividend`; `BusinessService` `_afterReports` and `_payDividend`).
- **Report earnings.** Each monthly report of a listed company moves the stock's fair value toward its valuation per share (the report's valuation over the shares outstanding), as a permanent market impact a day later (`listing.earningsDelayDays`), the move capped at ±50% (`earningsCap`); the report makes the market news. Each report moves it once.
- **Dividends.** Shareholders vote a payout ratio (`payout` proposal, a majority, 0% to 100% in steps of 10%; 30% to start). Each monthly report then pays that share of the reported profit, capped at 1% of the valuation and by the company's cash, split per share (rounded down to the cent): characters' and syndicates' shares are paid into their brokerage balance (counted as dividends received, at most 5,000 eb each a report), the market's float silently. The company's ledger shows "Dividend paid"; the report window shows the amount per share. A loss pays nothing.
- **The liquidity cap** (`dailySellCap`, `PortfolioService.tradingMarket`). Each market day the market buys at most a share of the float from players: 10% by default (narrow demand), 15% solid, 20% strong, 30% exceptional, plus 2% for each rank of a Fixer officer's Operator (a syndicate officer counts its own officers). What every account sold of the ticker today counts against it. A sale beyond it fills in part (its own filled order) and the rest stays open, waiting for the next market day (`waiting: 'liquidity'`, shown on the terminal as "Waiting for buyers"; a broker's fill mail says how many wait). Buying is not limited.
- **Insider heat** (`BusinessService._insiderWindow`, with insider tracking on). Officers and shareholders see a report before the market moves on it, so a report that moves the price opens a heat watch window on the ticker, from the report to the move, as for a gig. Officers count as knowing as well as a gig's runners, other shareholders as tipped; a syndicate's members count as their syndicate. The audit, heat and consequences then follow §21 as usual.
- **Links.** Once its offering is on the market, the Business window's header has "View on market", opening the terminal on the company's page as the same account. On the terminal, a player company's page has "Manage company" for its officers and shareholders (a syndicate account counts as the syndicate and the character acting for it) and the GM, opening its Business window.
- **The delisting review** (`reviewListing`, `clearReview`, `delistCompany`; `BusinessService` `_review`, `giveTime`, `delist`). At each report, a market value (price times shares) under 60% of the listing threshold counts a low report; any other report starts the count again. Three in a row put the company under review: a market headline, a mail to every shareholder (a syndicate's active members each), and a 5% dip in fair value. The Business window shows the count and the review. On the GM Console's Businesses tab the GM may **give it time** (the review clears and the count starts again, so three more low reports bring it back) or **delist** it: the company buys the market's float back at the market price from its cash, borrowing from the bank what it lacks; the holders' shares leave their portfolios (open orders on the ticker are cancelled) and are units on the record again; the market company is marked delisted; it is a private stage 2 company again, draws and private stakes as before. A delisted company does not list again.

**Tested in the test world** (v0.14.0, on "Charter Test Clinic", made to meet the checklist): the Growth tab's listing checklist, valuation and float choice, and the IPO proposal; GM approval and the prospectus rolls; the IPO window and the listing day; dividends; the links between the Business window and the terminal; the daily cap on sales; the lock-up refusing a sale; and the delisting review opened (by a console script running the real review over three low reports) and cleared with Give it time; a report moving the price; and insider heat around a report. It found and fixed: the float menu and button out of line, a stray "Propose registering" on a company, the ticker not shown once set (now in the header, the listing text and the Portfolio tab), the proposal worded as registering rather than listing, and player messages naming the GM where the market decides. Not tried live: delisting itself (covered by tests).

## 35. Phase B6: corporate play (v0.15.0)

The user's choices (2026-10-31):
- **In four parts,** each tested and committed before the next: B6a, new share issues and buybacks; B6b, takeovers; B6c, insolvency; B6d, hidden ownership and investigations. Coordinated syndicate campaigns move to F1 (§36.3), where standing and campaigns already belong together.
- **Takeovers** are tender offers: a character or syndicate offers a price per share for a company, open 7 days, approved by the GM first. Player holders accept or decline; NPC holders and the market's float accept by a rule (the premium over the price). Passing 50% gives control, and the officers can then be replaced by vote. For listed and private companies alike.
- **Insolvency:** two weekly closes in a row with net assets below zero (cash and assets under the loans and wages owed) put a company into administration: actions stop, and the GM restructures it (lenders take shares, the old holders diluted) or winds it up (assets sold at a discount, lenders first, holders take what is left; a listed company is delisted at that value).
- **Hidden ownership** as §27.6 in full: a broker's nominee account, syndicates hiding their members, chains of syndicates, each layer built with a roll whose total is stored; the 5% disclosure threshold on listed companies, concealment above it adding Exposure; opposed investigations (Library Search, Streetwise, Bribery, or a Netrunner's Interface).
- **New shares:** a private company's rights issue at book value, each holder taking their share in a 14-day window, the rest lapsing; a listed company's secondary offering through the market at a discount, after an officer's Trading roll. Either is voted by a majority of the shares, and the money goes to the company.
- **Buybacks:** the shareholders vote a budget (majority). A listed company buys from the market's float at the market price day by day, within the daily cap, and retires the shares; an officer's Trading roll ("time a buyback") gets a better price. A private company offers book value, and holders may sell units back in a 14-day window.

**B6a as built** (`businessCapital.js`, `BusinessService` `_capitalEvents` and `_marketCapital`, `tests/businessCapital.test.mjs`, `tests/listingFlow.test.mjs`).
- **Proposals.** `issue` (5% to 30% of the shares there are, in 5% steps) and `buyback` (a budget of at least 500 eb that the cash covers), each a majority of the shares, a chartered company only, and not while a listing is under way. The terms are checked again when the vote carries.
- **A rights issue** (a private company): the new shares are priced at book value per share when proposed. Each active holder (NPC holders aside) is entitled to the new shares in proportion to what they hold when it carries, and takes some or all of them (`rightsTake`) from their own eddies or their syndicate's account (a syndicate over its limit puts it to its members, like other business spending); the money goes into the cash and the shares are theirs at once. After 14 days it closes, and what nobody took lapses.
- **A tender** (a private company's buyback): any holder may sell shares back (`sellBack`) at book value, paid from the cash into their account, while the budget and the cash last and for 14 days; the shares are retired. Someone must still hold shares.
- **A secondary offering** (a listed company's new shares): once voted, an officer makes the offering roll (`issueRoll`: Trading, or Persuasion at DV +2, DV 17, a hired professional allowed). A failure pulls it and the price dips 3%. A pass sets the price at the market price less a discount by the result (narrow 10%, solid 5%, strong 3%, exceptional none) and opens a 5-day window: the offering goes on the market company's record (`offering`), so the terminal lists it beside the IPOs and anyone subscribes for it as for an IPO (the money held, not spent). When the window has closed, the next tick settles it: subscriptions filled at the offer price (pro rata if oversubscribed), the market taking the rest, the whole sum into the company's cash ("New shares sold on the market"), the shares outstanding raised, and fair value diluted to the company's value plus the money raised, over the new share count. Each step makes the news.
- **A market buyback** (a listed company's): once voted, an officer times it (`buybackRoll`: Trading, or Business at DV +2), which sets what it pays against the market price (fumble +3%, failure +2%, narrow 0, solid −2%, strong −4%, exceptional −6%). Then each market day it buys from the market's float, at most the daily cap (§34, the liquidity cap), while the budget and the cash last; the shares are retired, so every holder's share rises. It ends when the budget, the cash or the float runs out. The start and the end make the news.
- **The window:** a Capital block on the Shareholders tab, with the proposals, the offer, the tender, the offering or the buyback under way, the officers' rolls, and the holder's own part in it.

The user's B6b choices (2026-11-01): any character or syndicate may bid for any chartered company, private or listed; the whole offer is held in escrow from the bidder's brokerage balance; NPC holders and the float accept all their shares at a premium of 20% or more over the reference price, half at 10–20%, none below; holders who decline keep their shares (no squeeze-out); the target's officers may make one defence roll that moves those bars.

**B6b as built** (`businessTakeover.js`, `BusinessService` `approveTakeover`, `rejectTakeover` and `_closeTakeovers`, `tests/businessTakeover.test.mjs`, `tests/listingFlow.test.mjs`).
- **The bid** (`bid`): from the terminal's Portfolio tab, naming the target by its ticker (a bidder cannot read a business they are not in; the GM's service finds it), a price per share and the most shares wanted, up to all the bidder does not hold. One offer at a time per company, and none while a listing is under way. It waits for the GM in the Businesses tab.
- **Approval:** the whole offer (price × shares) is held from the bidder's brokerage balance, less what their open buy orders reserve; a bidder who cannot cover it loses the bid. It opens for 7 days, its premium measured against the reference fixed now: the market price for a listed company, book value per share for a private one. Holders and the bidder are mailed; a listed company's offer makes the news. A refused bid holds nothing.
- **Tendering** (`tender`): each holder chooses how many of their shares to tender from the Takeover block on the Shareholders tab, and may change it (0 withdraws) until the close. The bidder cannot tender to themselves.
- **Defence** (`defenceRoll`): once per offer, an officer of the target rolls Persuasion or Business at DV 17 (a hired professional allowed). The result shifts the premium NPC holders and the float want: fumble −5 points, failure 0, narrow +3, solid +5, strong +8, exceptional +12.
- **The close** (the first tick after the last day): NPC holders and the float tender all, half or none by the premium; players' tenders count up to what they hold (a listed company's, up to what they can still sell, so locked shares cannot be tendered). If more is tendered than wanted, each is scaled down pro rata, the shares lost to rounding going to the largest remainders so a full offer buys exactly what it asked for. The bidder pays the price for each share from the escrow: players are paid into their brokerage balances, NPCs' and the float's money leaves the game, and the rest of the escrow returns to the bidder. A private company's shares move on its record (the bidder joins as a voting shareholder); a listed company's move between portfolios, and the shareholders are read from them again. Passing 50% gives the bidder the majority of the votes, so they can elect and dismiss officers; nothing else changes. Everyone involved is mailed, and a listed company's result makes the news.

**Tested in the test world** (2026-11-01, on Charter Test Clinic, SCX): a bid for a market corporation refused ("no open player company"); a bid by ticker waiting for the GM, shown in the target's Takeover block; GM approval holding the escrow; a failed defence roll, and a second refused; the close after a market advance, with the float and an NPC holder tendering at a 25% premium, the shares into the bidder's portfolio, the unspent escrow returned, control reported, and the news; a secondary offering settling in the same advance. Then: a bid the bidder could not cover lapsing on approval with nothing held; a refused bid; a syndicate's bid at a 15% premium, with a player tendering from the Takeover block and the float and an NPC tendering half, scaled down to exactly the 2 shares wanted, the syndicate becoming a shareholder. It found and fixed: a scaled-down offer buying one share short through rounding (49 of 50); the Takeover block now says how many of a listed holder's shares are free to tender, and the box allows no more. Not tried live: a private company's takeover (no chartered private company in the test world; covered by tests).

The user's B6c choices (2026-11-01): companies only (side and registered businesses keep B1's failure rule); in administration a company is frozen but still trading, and cash put in can rescue it; restructuring swaps the debts for shares; winding up pays creditors first.

**B6c as built** (`businessInsolvency.js`, `BusinessService` `_insolvencyEvents`, `restructureBusiness` and `windUpBusiness`, `tests/businessInsolvency.test.mjs`, `tests/listingFlow.test.mjs`).
- **The test** (`solvency`): cash (if positive) and assets, less the loans, the wages owed and any overdraft (`debtsOf`). Unlike the charter's net assets, it is not held at zero.
- **Administration** (`checkSolvency`, at each weekly close of a chartered or listed company): two closes in a row below zero put it into administration. Its open proposals end, a rights issue, a tender, a buyback or an offering roll not yet made stops (a listed offering already on the market still settles), and these requests are refused: actions, help, answering events, business days, draws, proposals, the roll requests, staff bonuses, training, asks and team members, rights, selling back, takeover bids, tenders and defence. Cash put in (a top-up) is still taken, and the weeks still close with their takings, costs and events. A close at or above zero ends administration by itself. A listed company pays no dividend meanwhile. On the way in, shareholders are mailed and a listed company's news reports it, its fair value dented 10%; on the way out, they are mailed again.
- **The B1 failure rule** (cash below zero for two losing weeks closes the business) now applies to side and registered businesses only.
- **Restructuring** (the GM, `restructure`): first the cash pays what it can of the wages owed (a player character's into their eddies) and then the loans, keeping four weeks of upkeep (the average of the last four digests) as working cash. What is still owed, and any overdraft, is written off for new shares at half the book value per share after those payments (at least 0.01 eb), held by one NPC holder, its creditors (`npc:creditors`, shown as "Receivers"), without a vote; the old holders are diluted only by what the cash could not cover, and not at all if it covered everything. Reputation and Compliance drop 10, the cash is set to at least zero, and it leaves administration. A listed company's new shares are added to the market company, its fair value diluted to match, and it makes the news.
- **Winding up** (the GM, `windUp`): the assets sell at half their book value. With the cash, that pays the wages owed first (a player character's into their eddies, an NPC's leaving the game), then the loans, then what is left goes to the holders by shares: a private company's player holders in eddies; a listed company's holders into their brokerage balances for the shares in their portfolios, which leave them (open orders on it cancelled), the market company marked bankrupt, and the news told. NPC holders' and the float's share leaves the game. Gear does not come back. The business closes ("wound up").
- **The windows:** a banner on the Business window while in administration (net assets, debts, what is stopped, how cash in can end it); on the GM Console's Businesses tab, the balance (net assets, loans, wages owed, overdraft) and Restructure and Wind up buttons, each with a confirmation.
- Also fixed in B6b: each seller in a takeover is paid rounded down, so the payments never come to more than the escrow (one in six runs came to 1 eb over).

**Tested in the test world** (2026-11-01, on Charter Test Clinic, SCX, pushed under by a console script adding an interest-free test loan): going into administration at a weekly close; the restructure writing the loan off for creditors' shares, the market company's share count following, Reputation and Compliance down 10, the ledger and the news. It found and fixed: the creditors' holder shown as "?" (now "Receivers (the creditors' shares)", and the float labelled too on the GM Console); the restructure converting the whole debt into shares while the company held 196,520 eb of cash, giving its creditors 67% (on the user's choice, the cash now pays first, keeping four weeks of upkeep); the "put in" line shown for the float and the receivers (now hidden). Then: a rescue by a shareholder's top-up, the company coming out at the next close; and a restructure under the cash-first rule, 199,250 eb paid from the cash, four weeks of upkeep (1,995 eb) kept, and only the 15,158 eb left owed turned into shares. Not tried live: winding up (covered by tests).

The user's B6d choices (2026-11-01): any company's register can hide a holder (chartered or listed), shown as the layer in their place, voting through it; each layer is a roll with a stored total, a setup fee and a monthly fee; above 5% of a listed company hiding is concealment, bringing heat, Exposure and NCPD audits that can unmask with a fine, and insider heat counting double; anyone may investigate with an opposed roll that reveals one layer at a time, a fumble tipping off the holder, and a takeover unmasking those who tendered. Syndicates cannot be members of syndicates, so a chain is built from shell layers instead (the user's choice): behind the broker's nominee, up to two shell companies the holder names.

**B6d as built** (`businessOwnership.js`, `BusinessService` `_hideTerms`, `_ownershipEvents`, `_layerFees` and `_publishRegister`, `tests/businessOwnership.test.mjs`, `tests/listingFlow.test.mjs`).
- **Layers** (`hideRoll`, from the Hidden ownership block on the Shareholders tab, for a holder of a chartered or listed company): the first is the holder's broker's nominee (they need a broker), the next up to two shell companies they name (a name new on that register). Each is a Bureaucracy or Accounting roll at DV 15 with the usual levers (no hired professional); its chat card is whispered to the roller and the GMs. A pass adds the layer; its roll total, the layer's strength, is kept in the GM's hidden state (`hidden[businessId].layers[holderId]`, innermost first), never on the business record. The setup fee, 1% of the holding's value (at least 500 eb), is paid from the holder's brokerage balance pass or fail; a syndicate's comes from its account.
- **Upkeep:** each layer costs 0.25% of the holding's value (at least 50 eb) every 28 days from the brokerage balance. A fee that cannot be paid ends that layer and every one outside it, and the holder is mailed. `dropLayer` takes the outer layer off at no refund. A holder who sells out loses their layers.
- **What others see:** the cap table and the votes on the Shareholders tab show a hidden holder as their outermost layer ("Vex (nominee)", or the shell's name); the holder and the GM see both. A listed company publishes its register on its market record (`register`), shown on the terminal's company page as Shareholders. The GM Console's owners table shows each layer and its strength.
- **Concealment** (`concealedHolders`, `auditConcealment`, `BusinessService._concealment`): a holder hiding more than 5% of a listed company is concealing, and their Hidden ownership block says so. Each week it adds 1 Exposure to the company and, with heat tracking on, 6 heat to the holder. Each month NCPD Financial Crimes may look: a 10% chance plus the holder's heat over 200 (at most 60%), seeded by the company, the holder and the day. If it looks, it rolls 14 + 1d10 against the layers' defence: the outer layer's strength plus 2 for each layer beneath it. Seeing through strips every layer (the register shows the holder's own name), fines them 5% of the holding's value from their brokerage balance (as far as it goes), puts it in the news, and mails them. On the user's choice the scandal also dents the stock: a lasting fall in fair value of a tenth of the hidden stake (between 2% and 8%; a 77% stake costs 7.7%) from the next day. The timers are kept in the GM's hidden state. A concealed holder's insider heat on their own company counts double in the heat audit.
- **Investigations** (`investigate`, `holderByRef`, `investigationTarget`, `BusinessService._investigate`): any character can look behind a hidden holder from an Investigate button on a register row (the terminal's Shareholders table for a listed company, the Shareholders tab for a holder of a private one). The row names the outer layer by an opaque reference (`ref`), not the holder. They choose Library Search, Streetwise, Bribery or Interface and roll against a total they cannot see (the chat card shows their total and no DV). The GM's service reads the roll back against the next layer they have not seen through, from the outside in: its strength plus 2 for each layer they have already peeled. A win is recorded for that investigator in the hidden state and mailed to them alone: the next layer's name, or, behind the last, who the holder is. The register does not change. A fumble mails the holder that someone is asking questions. Each investigator may try each holding once a week. A try takes a business day from the investigator's business with the most days left, or 100 eb in legwork if they have none free (the user's choice, so any character can still investigate); a roll of Bribery costs 200 eb more; all spent whatever it finds. The receipt says whether anything was found.
- **Takeovers unmask:** a hidden holder who sells into a takeover is on the record under their own name afterwards.
- Also fixed: every B6 request (rights, selling back, the offering and timing rolls, bids, tenders, the defence roll, layers) now has its own "done" notice; before, the notice showed its language key.

**Tested in the test world** (2026-11-01 and 02, on Charter Test Clinic, SCX): layers built by Splice (a fumble that still paid its fee, then a nominee and a shell), the whispered roll cards, the public register and the cap table showing the shell, the holder's own view, the concealment warning; Boar's investigation from the terminal (a hidden DV on the card, a win mailed to him alone, the weekly limit); NCPD's monthly audit seeing through twice, unmasking and fining Splice, with the news. It found and fixed: other shareholders' rows showing a hidden holder's office and money put in; the Investigate button on one's own layer; the investigation dialog too wide; a second try within the week rolling before it was refused (each try is now noted on the investigator, and the button refuses first); the Business window showing a GM the truth while viewing as another character (it now shows that character's view; the GM Console keeps the truth); an investigator's finds not shown to them (kept on their character and added to the register row); an investigator's progress carrying over when the layers were rebuilt. Not tried live: a monthly fee lapsing a layer, a takeover unmasking a seller, and a fumbled investigation tipping off the holder (all covered by tests).

# Part 4. What comes next

## 36. Proposal: after E3, B5 and B6

Four directions for player businesses once employees (E3), going public (B5) and corporate play (B6) are in. The user settled the main choices on 2026-10-31 (§36.6); the rest is still a sketch. They share one new idea, **standing with factions** (§36.3), which comes first in the phasing (§36.5) even though it is the third topic.

**Everything stays in this module.** Other modules are read only through a bridge (the map bridge, the Crew Tools bridge B7, Night City Messenger's API), and nothing here depends on one being installed.

**What already exists to build on:**
- **Hidden state and investigations:** the GM-only control journal already keeps each business's Exposure, and NCPD Financial Crimes already audits, warns and penalises (§21, heat). B6 adds investigations and hidden ownership.
- **Night City Map:** it keeps a list of gangs for each district (`GANGS` in its `encounters.js`), keyed by the same district ids as a business (Tyger Claws, Voodoo Boys and 6th Street in Watson; Maelstrom, Red Chrome Legion and Iron Sights in South Night City; none in the Executive Zone). Its gigs already reach this module through the map bridge, with a client, a reward and a runner.
- **Crew Tools:** it already runs a Maker's fabrication and upgrade projects from compendium items, and downtime "crafting, or hustle". The B7 bridge (§27.8) already plans to spend its downtime on business work.
- **Night City Messenger:** contacts and tags (staff, broker, investor), mail from the market wire and from NCPD, data shards, networks with ICE, access logs and traces, contact breaches, scheduled messages and contact groups.
- **The market:** gig impacts on a company's price with a delay and a headline (`impactKernel`), sector moods, and insider-trading heat for runners and tipped characters.

### 36.1 Underworld: a front for illegal work

**The idea.** A business can run a **back room**: an illegal operation behind the legitimate shop, which the front hides and launders. It earns more than the shop, in money the books cannot show, and it carries the risk of raids, gangs, informants and investigations. **Underworld content is on by default**; a world setting turns it off. Opening a back room waits for the GM, as a new business does, when the business-approval setting is on.

**What players see:** the dirty cash in eddies (it is theirs to spend or launder), but the back room's Exposure, the raid risk and their standing with gangs only as bands, as Exposure is now.

**U1 choices (the user, 2026-11-02).** Three parts: U1a, back rooms, dirty cash, laundering, pay-offs and lying low; U1b, raids and informants, with new staff roles; U1c, gang deals and corporate crime. Dirty cash is a pot out of book value and valuation that a raid can seize and an audit find; partners can take it as eddies, adding Exposure; laundering is capped at 30% of the week's legitimate takings for every front. The worst raid shuts the back room until reopened, not the business. A gang as a silent partner takes a cut recorded on the back room, not units.

**U1a as built** (`businessFronts.js`, `BACK_ROOMS`, `BusinessService` `approveBackRoom`, `rejectBackRoom`; the underworld setting, on by default). A back room is a project at a shop or registered business, voted on as others are, costing 1,500 or 4,000 eb and 3 or 5 business days, and adding nothing to the books; a bar chooses gambling and dealing, or a brothel or dollhouse. Finished, it waits for the GM when the business-approval setting is on. Its weekly actions take slots: **Work the back room** earns 60% of what the front's Capacity would take by band, into dirty cash, adding 8, 4, 3, 2, 1 or 1 Exposure; **Launder** (Accounting, Business; Bribery at DV +2) moves up to 30% of the week's legitimate takings by band, adding 6, 2, 2, 1, 0 or 0 Exposure, one less with a bookkeeper; **Pay someone off** (Bribery, 150, 300 or 600 eb of dirty cash) moves Exposure by +5, 0, -3, -5, -7 or -10; **Lie low** takes a slot with no roll, stops the work and takes 3 off Exposure. A partner can take any dirty cash as eddies, adding 2 Exposure per 1,000 eb. Owners see the dirty cash and Exposure as a band; the digest records each week's figures, though the cash book only shows what was laundered. Dirty cash is lost if the business closes. A company that charters keeps its back room's actions but cannot open one.

Tested in the test world (2026-11-02): the GM's approval, working the room on the Work tab, its dirty cash and Exposure at the close, a failed pay-off and a solid launder together, taking cash straight, and lying low. Found while testing: the take button could not read its amount, and the work could still be rolled while lying low. Opening one through a real vote and the 30% cap are tested in the engine tests only.

**U1b as built** (`businessFronts.js` `raidChance`, `roomBust`, `bustFallout`, `informants`, `turnInformant`; the `bust` event; the `hand` post; the user's choices, 2026-11-02).
- **Raids.** With a room open, the week's chance of a raid is 0, 3, 10 or 25% by Exposure band, +5% with an informant on the staff, and +2% for each employee with loyalty below 30, within 6%. It comes in place of what the week would have drawn, is answered with Bureaucracy, Persuasion, Tactics, Bribery or Backup (once a month), and is a big event the GM can run as a scene.
- **What it does.** A win clears 5 Exposure. A failure seizes half the dirty cash and fines 500 eb, with the usual share of takings and -8 Compliance, -3 Reputation at half strength. Left unanswered or fumbled, all the dirty cash, 1,000 eb, the full hits, 15 heat for each partner, and the room shut until it is built again as a project; high Exposure shuts it on a failure too. The shop carries on. The owners get a mail.
- **The back-room hand.** A new post, offered only while a room is open, using the trade's skills. They work the room when no partner did, unless the business is lying low.
- **Informants.** A hidden trait: an applicant to a business with a room is one 10% of the time, and an employee with no trait may turn, 2% a week. Each adds 2 Exposure a week, and firing one adds 5, as a corp plant. A passed internal audit, or a strong or better pay-off, names them; vetting shows them, as other traits. The GM sees them on the staff table.

Tested in the test world (2026-11-02): a raid left unanswered, seizing 528 eb, a 1,000 eb fine, the room shut, 15 heat for each character partner and none for a syndicate, the owners' mails, and the shop still open; the hand's post offered; an informant on the GM's staff table and not on the player's. A shut room stops the informant's weekly Exposure. Not run live: a raid won or failed, one run as a scene, a hand working the room, an informant being found or turning.

**Back-room staff** (added 2026-11-02, after U1c; the user's choices). `POSTS` marks `hand`, `launderer` (Accounting, Business) and `fixer` (Bribery, Streetwise) as `backRoom`, at `rate` 1.5 times the going wage (`postRate`). `staffShifts` gives each a slot of its own when nobody took the action and the business is not lying low: the hand works the room, the launderer washes if there is dirty cash or work this week, and the fixer, at moderate Exposure or higher, pays off from the dirty cash, or at a company with none bribes the regulator from the cash (`payRegulator`, one job a week), if `crime.fixerFloor` would be left. `postOffered` needs an open room, except for a company's fixer. `raidChance` adds `crew` for each of them, and a sullen one counts `sullenCrew` times. At a company a hire for these posts skips the vote (the officers fill them, as they settle a gang deal), and other shareholders see them as general staff, with their applicants hidden. Dumping and black ops stay officers' decisions.

**U1c as built** (`businessFronts.js` `runDealRoll`, `takeDeal`, `endDeal`; `businessCampaign.js` `runBlackOps`; `BusinessService._scandal`; the user's choices, 2026-11-02).
- **A gang as a silent partner.** With a room open, **Deal with a gang** (Streetwise, Persuasion, Operator) picks a gang on the turf at neutral or better. A pass brings an offer of 1,000 to 2,500 eb by band, for 30%, 25% or 20% of the room's takings at neutral, friendly or allied, at least 100 eb a week. Partners vote to take it, and the money goes into the dirty cash. While it runs, that gang charges no share of the protection money, sends no shakedowns, and its standing does not fade. A week the cut cannot be paid costs 5 standing; if the gang turns hostile it walks away, keeping what it put in. Partners can vote to end it: the money goes back, at -15 standing. A shut room ends the deal.
- **Corporate crime, at a company.** **Dump the waste** multiplies the takings by 0.8 to 1.8 by band, with 15, 8, 5, 4, 3 or 3 Exposure. **Bribe a regulator** costs 1,000 eb from the cash and moves Exposure by +8, 0, -4, -6, -8 or -12, and from solid up takes 3 off an open case's total. **Black ops** cost 2,500 eb and work as a campaign, sharing its monthly limit and the GM's approval, for -2 to -4% on the target and -10 standing; a fumble is 15 Exposure, -15 standing, a regulator's case, and a scandal. The underworld setting hides all three.
- **Scandal.** A listed company's crime coming out posts a headline, dips its price and opens a heat window: -3% for a failed raid or a fumbled dumping, -5% for a raid left unanswered or fumbled, -8% for black ops traced back.

Tested in the test world (2026-11-02): a gang's offer at neutral through the Work tab, with a hostile gang left off the list; the partners' vote carried by a majority holder and the money in the dirty cash; the minimum cut at the close, the gang's share off the protection money, and its standing held; failed dumping and bribe rolls, with the bribe still paid; black ops through the GM's approval, with the headline, the -3% impact, -10 standing and the Exposure. Not run live: ending a deal, a deal falling short or a gang walking away, a bribe easing a case, black ops traced back, and any scandal, which the flow tests cover.

**A back room at a company** (the user's decisions, 2026-11-02). A business that charters keeps its back room, and it stays the officers' secret. Only they see its card, its actions and the company's crime actions, take dirty cash, and hear of a raid; only they draw its heat; and they take or end a gang's deal themselves, since a shareholders' vote would tell everyone. To other shareholders the money still adds up: a laundering, a raid's fine, a bribe or black ops read as other income or costs, a raid on the room as an inspection, and a scandal as news. A raid that shuts the room at a company shuts it for good: a company cannot build one. The post of back-room hand can still be seen on the staff list.

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
- **A brothel or dollhouse** (bar or club) staffs its back room with employees (E1) in a new role, so their loyalty and traits matter more than anywhere else: a sullen worker or an informant is the likeliest leak. A dollhouse also needs behaviour chips, a running cost and a Cybertech check that can go wrong (an event). Like the rest of §36.1 it is handled in game terms only: takings, risk, events, with no explicit content in the module's text.
- **Opening one** is a project (§33) with its own roll, and waits for the GM's approval when the business-approval setting is on. Its size grows like the front's Capacity, and it is capped by it: a back room cannot outgrow its front without being obvious.
- **Dirty money.** The back room's takings go to a separate **dirty cash** pot, not the till: off the books, out of the monthly report, and not counted in book value or a listed company's valuation. Partners can take it as eddies with no draw cap, but every eddy raises Exposure.
- **Laundering** moves dirty cash into the till through the front's takings. It is capped at a share of the legitimate takings each week (around 25–40%, by front): a launder action (Accounting, Business; Bribery at DV +2). A bookkeeper (E1) makes it cleaner. A poor roll leaves traces that an audit, an inspection or B6's investigators can find.
- **Weekly actions:** "Work the back room" (the operation's skills), "Launder", "Pay off" (Bribery: cuts Exposure and raid odds), and "Lie low" (no takings, Exposure falls faster).
- **Staff (E1/E2):** new roles a back room unlocks, such as fence, runner, cook or chemist, and muscle (the security role). The corp plant trait becomes an **informant**, the most dangerous trait there is. Loyalty matters more: a sullen employee who knows about the back room can sell you out.
- **Events:** a raid (NCPD, corp security or NetWatch by front), a rival operation muscling in, a bad batch, an informant, a gang taking a cut, and an offer you can't refuse. A raid answered badly means fines, seized dirty cash and gear, Compliance and Reputation hits, and NCPD heat for the partners, with B6's investigation opened.
- **Gangs (with §36.3):** the district's gangs take an interest. Protection money stops being only a cost line and becomes a relationship: pay, refuse, or make a deal. A gang can offer to be a silent partner, putting in money for a cut, an underworld angel with strings attached; your standing with it moves its demands and its protection.
- **At a company (stage 2):** corporate crime instead of a back room: dumping, bribing regulators and off-books black ops. This grows from the company's Shortcuts action and Exposure, and ties into B6's regulator and investigations.

**Still to decide:** whether dirty cash counts as an asset (and so can be stolen or seized); the laundering caps and the Exposure they cost; whether a raid can close a business outright; and whether a gang can take a stake in the cap table, seen or hidden (as B6's hidden ownership).

### 36.2 Production: making goods

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
- **A workshop** is a project (§33) that opens production, with one or two **lines** by stage. A line names a GM-approved list of compendium items for that business type (set in the GM Console, with defaults), so players cannot produce anything they like.
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

**Superseded where they differ by §36.10,** the plan as the user decided it.

### 36.3 Faction standing, and moving markets

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
  - New actions aimed at a listed company, such as a smear campaign (Composition, Persuasion) or a leak (Library Search, with an Interface or netrunner element), go through the impact pipeline with a delay and a generic headline. Anyone who trades the target before the news lands draws insider-trading heat (§21), the same rule as gig runners.
  - Once B5 has listed player companies, factions can act against them too: a hostile corp's smear campaign moves your price.
  - Coordinated campaigns (several characters or a syndicate trading together) were left for B6 in §30; standing and these actions belong with them.

**Still to decide:** how big a smear campaign can move a price, and how it sits with the GM's approval of gig impacts; whether a syndicate's businesses share one standing or each keep their own; and whether a faction can be hidden from players until they first deal with it.

### 36.4 Further Night City Messenger integration

**Built so far:** mail from the market wire (broker replies, syndicate mail, payslips), NCPD Financial Crimes notices, CorpNet sessions gating direct trading, and contacts tagged staff, broker or investor, read for hiring and investors.

**Options, roughly in order of value for the effort:**
1. **Events arrive as messages.** A shakedown comes from the gang's contact, an inspection from the city, a poaching offer from the rival, with a link that opens the Work tab to answer it. The GM can write in that contact's voice. This uses existing mail plus a contact per sender (created or reused, like the market wire).
2. **The weekly digest by mail** to partners who want it, with the profit, the cash and anything waiting (votes, raises asked for, applicants), and a link to the cashbook. A per-character setting, beside the payslips.
3. **Staff as contacts.** A hired recruit becomes a Night City Messenger contact (name, generated portrait, tagged staff), so players can message them and the GM can answer. Loyalty moments arrive as messages from them ("we need to talk about my pay"). Applicants answer an advert by mail.
4. **A business's own inbox:** each business as a contact with an address. Customers, suppliers, gangs and corps write to it, and the partners read it together (a contact group for the partners and officers).
5. **Underworld (§36.1):** a fixer contact offers fence deals; gangs send demands; messages that burn after reading. **Data shards** as evidence: the back room's real ledger is a shard that B6's investigators can find, a rival can steal, or a player can use for blackmail.
6. **Networks:** a company's intranet as a Messenger network, with ICE and access logs. Officers read insider documents there, and its access log is evidence for insider-trading heat (who read the monthly report before it was published). An info shop's or back room's network can be breached as an event (Messenger's breach and trace).
7. **Scheduled reminders:** loan payments due, a raise asked for that runs out, a charter's funding window closing, sent with Messenger's scheduling.
8. **Marketing:** a storefront project (§33) or a Promote action could send spam mail from the business to characters. Flavour, low priority.

**To check before building:** which of these Messenger's integration API already exposes to other modules (its `IntegrationBridge`) and which need new API in Messenger. Then, for each, whether messages are sent from the GM's client only (as now) or a player's.

### 36.5 Phasing

| Step | What | Needs |
|---|---|---|
| R1 Regulators, R2 Role abilities | Exposure opens cases that players fight; player abilities at rank + 9 (§36.7) | none; before F1 |
| F1 Factions | the faction list and standing; gigs and business actions moving it; standing's effects on costs and events; smear campaigns through the impact pipeline; Media stories and rumours (§36.7) | B6 (hostile bids, coordinated campaigns), R1 |
| X1 Player rivalry | private share deals, NET runs, moves against a rival, events as scenes, more for Lawmen, Nomads and Rockerboys (§36.7) | F1, M for shards |
| U1 Fronts | back rooms, dirty cash, laundering, raids, gang relationships, informants | F1, B6 (investigations, hidden ownership) |
| P1 Production | workshops, lines, production runs, stock, selling and fencing | E3 (staff time); B7 for the Crew Tools link; U1 for fencing |
| M | the Messenger options, alongside each step: events as messages and the digest with F1; staff as contacts any time; shards and networks with U1 and B6 | a check of Messenger's API |

Each step ends as the others do: engine tests, flow tests, a simulator check that nothing becomes a money farm (dirty cash and production first), and a run in the test world.

### 36.6 Decisions (2026-10-31)

1. **Underworld content is on by default**, with a world setting to turn it off.
2. **Standing belongs to the business.** Characters' reputation is managed by Crew Tools.
3. **Everything stays in this module** unless it can be done through a bridge: the faction list, standing and the starting gang list are this module's own.
4. **Production goes to an inventory:** a container actor for each producing business, as its stock sheet (§36.2), with the business record in charge of the money.
5. **Players see dirty cash as values**; Exposure and standing only as bands.
6. **Factions first** (F1), then fronts (U1), then production (P1).

### 36.7 After the rules and lore review (2026-11-02; v0.16.0 onward)

A review of the module against Cyberpunk RED's rules and setting found the core rolls sound (STAT + Skill + 1d10, the DV ladder, Luck, the districts) and most Roles underused. Done at once, ahead of the steps below: hidden holders no longer named in proposals or the ledger; investigations cost a business day or legwork money, and Bribery a bribe (§35); Danger Gal renamed from "Danger Girl"; Arasaka made thin, volatile and without a dividend; five starter companies redescribed from R. Talsorian's own accounts; and the market framed as a local exchange on a Ziggurat CitiNet (GM guide).

**R1 Regulators as built, v0.16.0** (`businessRegulator.js`, `BusinessService` `_regulatorEvents`, `_answerCase`, `_lapseCases`, `openCaseByHand`, `dropCaseByHand` and `approveCaseFine`, `scripts/ui/answerCase.js`, `tests/businessRegulator.test.mjs`). Before this, Exposure only blocked a listing and showed in audits.
- **What opens a case** (chartered and listed companies, one at a time). At each monthly report, seeded by the company and the report: clean never, low 5%, moderate 15%, high 35%. At once: a fired corp plant, a fumbled Shortcuts roll, or an NCPD unmasking of a holder of over 25% of the company. The GM can open one from the Businesses tab, or drop one at any stage.
- **The answer.** The company has 14 days. An officer answers once, from a banner in the Business window: Bureaucracy, Accounting, or Bribery (500 eb from the company's cash, spent whatever happens; refused before rolling if it cannot pay). They roll against a total they cannot see: 14 + 1d10, plus 0 at low Exposure, 2 at moderate and 4 at high. Players never see the band. The shareholders are mailed when it opens and when it ends.
- **A win** closes the case and clears half the Exposure.
- **A loss,** or no answer in the 14 days, waits on the GM with a proposed fine: 5% of book value, 10% at high Exposure. Approving (the GM may change the sum, or drop the case instead) takes the fine from the cash, even past zero, and 10 Compliance; a listed company makes the news. A fumble or high Exposure makes it serious: a listing application not yet on the market stops (the fee spent, 14 days to reapply), or with none, the last three reports go back to their real figures and their valuations are capped to match.

**R2 Role abilities as built, v0.16.0** (`SkillAdapter.rollBase`). Where a business roll offers a role ability, a player rolls rank + 9 + 1d10, the same as staff (`staff.abilityBonus`): rank 4 is +13, and the dialog shows both ("rank 4: +13"). A character without the ability is not offered it. `SkillAdapter.baseFor` stays the bare rank, because staff bases and team sizes are built on it. A use marked `plain` is the ability itself and keeps rank + 1d10: so far an investigation's Interface, and later Credibility's rumours and NET runs. The business simulator does not model abilities separately; its strong crew, whose bases cover this range, still grows at a sensible pace.

**A template bug found while building this:** on the GM Console's Businesses tab the takeover and administration blocks (v0.15.0) were nested inside the listing section, so they showed only while a listing was under way or a delisting review was open. SCX had one open during the live tests, which hid the fault. Any other company's bid or administration had no buttons. They now stand alone, and `tests/businessWindows.test.mjs` renders each of these states.

**Tested in the test world** (2026-11-02, on Charter Test Clinic, SCX): a case opened by the GM; an officer's answer through the dialog (a hidden total on the card, Luck limited to the pool), lost; the penalty approved with a changed fine, with the ledger, Compliance and the news; a second case unanswered for 14 days, lapsing as lost, and dropped; a player's Maker offered at rank 4: +13 in a company action's roll dialog; and the takeover buttons showing on a company with no review open. Changed on the user's request: the fine box and its buttons lined up, and room under the Answer button. Not tried live: a won case clearing Exposure, Bribery's cost, a serious loss, and the automatic openings (a report's chance, a fired plant, a fumbled Shortcuts roll, a big unmasking), all covered by tests.

**F1 choices (the user, 2026-11-02).** Three parts: F1a, factions, standing and gigs; F1b, actions aimed at a faction, and standing's effects; F1c, moving markets. Each business keeps its own standing. Effects are noticeable but capped: a friendly corporation in its sector takes up to 5% off the Cost base (10% allied), a friendly gang on its turf cuts protection money by 25% (50% allied) with fewer shakedowns, and hostile factions reverse that and bring their own events (sabotage, smear, a raid tipped off, poaching), all capped at 15%. A Media's published story has the largest effect on a price; anyone else's smear or leak through a business is capped near 2%, with a cost and a monthly limit; each waits for the GM by default, a setting turning that off, and trading the target beforehand draws insider heat.

**F1a as built** (`factions.js`, `FactionRepository`, `data/starter-factions.js`, `BusinessService` `_moveStanding`, `_standingWeek` and `setStanding`, the GM's Factions tab, `tests/factions.test.mjs`).
- **The list.** A GM Console tab adds, edits and removes factions: a name, a kind (corporation, gang or other), a ticker for a corporation, and home districts for a gang. Import adds a starter list, the market's starter corporations and thirteen gangs by district (from Night City Map's list); it never overwrites. Kept in a world setting every client can read, since players' windows need the names.
- **Standing.** From -100 to 100, for each business and faction, in the GM's hidden state (`hidden[businessId].standing`). A business's record holds only the band (`standings`): hostile below -60, wary below -20, neutral below 20, friendly below 60, allied from there. It fades 2 points a week toward 0 at each weekly close. It moves at most 15 in any seven days, and each favour in the last 28 days makes the next count for less. The GM can set it by hand, past those limits.
- **Gigs (the user's rule): an outcome moves both reputation and share price for everyone it touches.**
  - **A freelance gig** (any other, including everything Night City Map generates): the client's share price, and its target's. No player business is affected.
  - **The tags** (`gigTags`, the user's scheme): `[NCI client: name]`, overriding the gig's client field; `[NCI target: name]`; `[NCI contract: business]`. The older `[NCI: ...]` still names a client's ticker, a business or `ignore`.
  - **A contract** (`[NCI contract: Charter Test Clinic]`, by name, ticker or id; one naming no open business waits for the GM with a warning, and counts as freelance): the business's Reputation and takings as before, and its own share price if it is listed, at the same size as the client's; the client's share price; the target's. Its standing with a client faction moves: +6 on a success, -8 on a failure, scaled by reward (1,000 eb is 1; between 0.5 and 3).
  - **A business's own gig** (its client is the business, no tag needed): as a contract, with no client to move or stand well with. A target is still hit, and standing with it moves.
  - **The target.** Gigs report none (Night City Map's `{target}` is a place in the text), so it is the GM's tag, `[NCI target: Militech]`, a faction or a market company; or failing that the one faction the title or description names, which waits for the GM to tick even with approval off. A target moves the opposite way to the client: half the client's move on a success, a quarter on a failure (it fended it off). Standing with it moves the same way, by the same shares.
  - **A gang as a freelance client** (a faction with no ticker) asks for no mapping: only its target's price moves, and with no target the gig is recorded as having moved nothing. A mapping or a `[NCI: ARA]` tag still wins, if the GM has tied the gang to a company.
  - **The exceptions:** a private business, a gang and an unknown client have no share price to move; a freelance gig has no business, so moves no standing; `[NCI: ignore]` and a client the GM ignores count for nothing; a halted or delisted company's price does not move.
  - Each moved price is its own impact, with its own delay, generic headline, recent-gigs limit, history line and heat window (a contractor's shareholders count as tipped).
- **The windows.** The Overview tab has a table of the factions the business has dealt with and the gangs on its turf (always shown), in Negative, Neutral and Friendly columns, with the band beside each name outside Neutral. The GM's Businesses tab shows the numbers.

**F1b as built** (`factions.js` `aimCheck`, `factionEffects`, `hostileChance`; `businessEvents.js` `hostileAct`, `factionFallout`; `BusinessService` `_factionEvents`; `tests/factions.test.mjs`). The user's choices, 2026-11-02.
- **Working on a faction.** A shop or registered business has two new actions: *Court a client* (a corporation or other faction) and *Pay respects* (a gang). A company aims its existing actions instead: *Chase contracts* (a corporation or other) and *Investor relations* (any), which keep their normal effect. Either costs a gift from the cash, 100, 300 or 1,000 eb by stage, spent whatever the roll. By band, standing moves -4, 0, 3, 5, 7 or 10, under F1a's limits. Only raising is on offer: moving against a faction comes with F1c. The actions are not offered until the list has a faction of the right kind. A player on the staff cannot be asked for these rolls, so an ask makes no aimed roll; NPC staff can be called in as usual.
- **What standing does.** Each corporation in the business's sector moves its running costs, not the stored Cost base: allied -10%, friendly -5%, wary +5%, hostile +10%, the total within 15%. A corporation's sector is its company's; a business's is its company's, or its type's. Each gang on its turf moves protection money and how often shakedowns are drawn: allied -50%, friendly -25%, wary +25%, hostile +50%, the total within 50%. The Overview tab says what they come to.
- **Hostile acts.** The faction with the lowest standing below -60 may act in a week: 5% at -60, up to 15% at -100. It replaces what the week would have drawn, and answers like any event. A corporation or other faction smears (Reputation -3, and a listed company's price -2%, with a news line that names no faction); a gang sabotages (Capacity -0.05; Keep it safe covers it); either can tip off a raid (Compliance -8 and 5 Exposure) or poach a staff member, if there are NPC staff. A failed answer does half of each. They run by themselves, without waiting for the GM.
- **Shakedowns** name a gang on the turf, if there is one. Beating one with Combat Awareness, Backup, or an employee in a security post costs 3 standing with it; any other answer costs nothing.
- **Left out:** the contract bonuses, supply contracts and investors of §36.3, and a hostile bid from a faction.
- **A bug the live test found:** a week's close started the next week without the faction data, so only a long calendar jump passed it on. Hostile factions never acted and shakedowns named no gang, while costs and protection money, read at the close itself, worked. The engine tests had called `hostileAct` directly and the flow test set each event by hand; `tests/factions.test.mjs` now closes real weeks.
- **Tested in the test world** (2026-11-02): gifts of 300 and 1,000 eb on a registered business and a company; running costs 10% down with an allied corporation in the sector, and protection money 50% up with hostile gangs; a shakedown named, beaten by security staff and costing 3 standing; an unanswered smear (takings, Reputation, one -2% impact, a news line naming no faction); and a seeded poaching act from Tyger Claws starting a week by itself. A raid's Exposure and Compliance were tested only in the flow tests.

**F1c choices (the user, 2026-11-02).** Three steps: campaigns, then Media stories with evidence shards, then rumours. A believed story moves a price up to 2% at rank 1-2, 4% at 3-4, 7% at 5-6, 10% at 7-8 and 12% at 9-10, either way (an exposé or a puff piece). Evidence is a physical item in the inventory, made by the GM or dropped by a successful investigation or due diligence; it works without Night City Messenger, and is a real Messenger shard when that is active. Once used it stays in the inventory, marked, and no longer counts for that company. Only Medias publish stories.

**F1c campaigns as built** (`businessCampaign.js`, `BusinessService` `_landCampaign`, `approveCampaign`, `rejectCampaign`, `tests/factions.test.mjs`). *Run a campaign* is a weekly action at every stage, aimed at any listed company but the business's own: a smear (Composition, Persuasion) or a leak (Library Search, Interface), 1,000 eb whatever the roll, one in 28 days. The target's price falls by 1%, 1.5%, 2% or 2% by band, from two days after it lands. With the world setting on (the default) a success waits on the Pending and Businesses tabs. Landing posts a generic headline, queues the impact, opens an insider-heat window (whoever ran it as a runner, the other owners as tipped), and costs 5 standing with a target that is a faction. A fumble lands nothing, costs 8 standing and adds 5 Exposure.

**F1c stories as built** (`stories.js`, `StoryService`, `scripts/ui/publishStory.js`). A character with Credibility gets **Publish a story** on a company's market page, as an exposé or a puff piece, with an optional headline and any unused evidence about that company. The GM's service rolls 1d10 against Believability (2, 2, 3, 3, 4, 4, 5, 5, 6, 7 by rank), +1 with any evidence and +3 in all with more than four pieces; no Luck. A believed story moves the price by 60% of the rank's limit, up to all of it at a margin of 3. The world setting that holds campaigns holds stories too, on Market > Events and the Pending tab. Landing posts a headline under the Media's name, queues the impact for the next day, opens a heat window with the Media as runner, adds 10 heat if they hold the company, and for an exposé at rank 5 or more opens a regulator's case on a player company. A Media publishes once in 7 days; another story on a company within 30 days needs new evidence. Evidence is an inventory item with a flag naming the company, made on Tools > Audit, or by a successful investigation or due diligence on a listed company; with Night City Messenger active it is also a data shard. Using one marks it, whatever the roll. **Left out:** standing, since it belongs to businesses and a story is a character's.

**F1c rumours as built** (`stories.js` `rumourLevel`, `freshRumours`; `StoryService` `onTick`, `digRumours`, `rumourSources`; `HeatService.noteTipped`). What can be heard is a queued price move not yet showing (from a gig, a report, a campaign or a story) or a hidden holding over the disclosure limit; a Media does not hear of their own. **Passively,** every 3 days the GM's service rolls Credibility rank + 1d10 for each player's Media against DV 7, 9, 11 and 13, and mails the first thing they have not heard at that level or better: vague, then which way, then why, then the size and when. **Actively,** once a week, a company's market page has **Dig for rumours**: Conversation, Streetwise or Library Search, with Luck, against a total the Media cannot see, at DV 13, 15, 17 and 21, on that company alone. A Media told of a move counts as tipped on its heat window. **Left out** of the plan: unpublished reports as a source, since an honest difference only shows once a report is out.

**F1c tested in the test world** (2026-11-02): a campaign rolled by called-in staff, its cost and overtime, approval from the Pending tab, one -1% impact, a generic headline, a heat window and -5 standing; a story by a rank 4 Media through the dialog, with evidence raising 3 to 4, approval, a -3.5% impact, a headline under their name, the heat window, and the once-a-week refusal leaving unused evidence alone; Messenger shards on evidence made by the GM's service; digging for rumours through the dialog, with nothing to find; and a passive rumour at level 2 on the campaign's move. Found while testing: `SkillAdapter.baseFor` returns an object, which a stub had hidden; a story's save wiped the rumour record; and a second dig rolled before being refused. Not run live: a fumbled campaign, a leak, an exposé's regulator case at rank 5, a dig that finds something, and evidence from an investigation.

**GM Console layout (2026-11-02, the user's request).** The tabs sit in groups, a top row of groups and a second row of tabs: Pending; Market (Market, Events, Corp actions, Brokers); Players (Businesses, Syndicates, Heat); Tools (Gigs, Companies, Funds, Factions, Audit). The Audit tab is what earlier sections call the Tools tab, and it has the GM's recent actions as well, from Events. A group's button goes to its last open tab and shows the total waiting on its tabs. On the Businesses tab, a running business's entry reads top to bottom: its state and alerts, a table each of owners, staff and standing, then every GM button together at the foot; a syndicate's entry follows the same form, with a table of members. Standing moved there from the Factions tab, which now holds only the list.

**Tab style (2026-11-02; the user chose Option B of three mockups).** After Night City Messenger's dashboard: a flat strip with an underline on the open tab, uppercase Rajdhani, and a small Share Tech Mono pill for a count. On the GM Console the groups are folder tabs above that strip; the Business and terminal windows have the strip alone, and the market window's index and mood sit on its Market tab, below the strip. No icons on tabs for now. The two fonts are bundled in `assets/fonts` (SIL OFL), so the look does not depend on Messenger being installed. Colours are kept as they are, with the tabs' own in `--nci-tab-*` and `--nci-count-*`, to be changed later. A release's `module.zip` must include `assets`.

**F1 additions: Media stories (planned with F1, §36.3; F1c).** Built on Credibility as published (Roll20's rules text):
- **Rumours.** Passive: at least twice a week, the GM's service rolls Credibility rank + 1d10 against a rumour's Passive DV (vague 7, typical 9, substantial 11, detailed 13) and passes on the highest beaten, drawn from pending gig impacts, unpublished reports and hidden holdings. Active: stat + skill against the Active DV (13, 15, 17, 21).
- **Publishing.** A Media publishes a story naming a company. They roll 1d10 against Believability by rank (2/10 at rank 1–2, up to 7/10 at rank 10), +1 for one piece of verifiable evidence and +2 more for over four pieces. Luck cannot be spent, and the same topic needs new information to run again.
- **The market.** A believed story queues an impact through the existing pipeline, its size capped by rank (the rules' reach: neighbourhood at rank 1–2, citywide at 5–6, mid-level corporations can fall at 7–8), with a headline under the Media's name. It can move faction standing, and open an R1 case. Publishing while holding a position in the company draws heat as market manipulation.
- **Still to decide:** impact sizes, what counts as evidence (investigation finds and stolen ledgers are the obvious ones), and whether non-Medias can plant stories through a Media contact.

**X1 as started (the user, 2026-11-02): without the rivalry parts, from events as scenes and the roles; the rest stays proposed below.**

**X1 events as scenes as built** (`businessScenes.js`, `BusinessService` `runScene`, `settleScene`, `sceneToRoll`). A big event is a sabotage, a raid, a smear, collectors, a grudge, a hostile faction's poaching, or a shakedown from a gang hostile to the business. While one is unanswered it is on the Pending and Businesses tabs with **Run as a scene**; left alone, it stays an ordinary event. Running it lifts it out of the week, so the weeks run on while it waits for a session: the GM gets a whispered hook, the owners a mail, and it stays on Pending. The GM then says **They won** (Reputation +2), **They lost** (15% of the last week's takings, the event's own hit, and what it leaves behind: Exposure, a dip in the price, the employee gone), or **Back to a roll**, which needs this week to have no event of its own.

Tested in the test world (2026-11-02): a raid on the Pending tab, run as a scene with the whispered hook and the owners' mails, then lost (15% of the week's takings, Compliance and Exposure). Winning and going back to a roll are tested in the flow tests.

**X1 roles as built** (`businessRoles.js`, `scripts/ui/quash.js`, `BusinessService._quash`, `HeatService.applyQuash`). The user's choices, 2026-11-02.
- **Nomad: Supply contract.** A weekly action at every stage, rolled with Moto (no hired help). Running costs fall by 3, 5, 8 or 10% by band for four weeks, on top of what factions do; a new contract replaces the old one. A fumble loses a shipment: 200, 500 or 1,500 eb by stage.
- **Rockerboy: Gig at the venue.** A weekly action at every stage, rolled with Charismatic Impact. This week's takings move by -5 to +20% and Reputation by -2 to +4 by band, half as much again at a bar or club, within the existing limit on a week's boost. It is shown only to someone with the ability, or a business with an employee who has it, as is the Nomad's. It is not against a rival: that is left with the rest of X1's rivalry.
- **Lawman: Backup.** Backup can answer a regulator's case, and a raid as before, at most once in 28 days for each business. **Call in a favour** joins the heat panel in the market window: Backup against DV 17, 1,000 eb whatever comes of it, once in 28 days. A pass takes 25 off the character's own heat and dismisses their pending penalties; a fumble adds 15 heat. The panel shows only to a character aware of their heat, as the other cover-ups do. **Launching an investigation** is left out, as it belongs with rivalry.

Tested in the test world (2026-11-02): a Supply contract rolled with Moto, offering no hired help, at 8% through its four weeks; a Gig at the venue through an employee with Charismatic Impact, fumbled, with its effects; and Call in a favour: refused before any dice without the money, then passed (60 heat to 35, a pending fine dismissed, 1,000 eb spent, 28 days on the panel). Not run live: running costs at a close under a contract, a lost shipment, a bar's larger gig, Backup in a raid or a case, a fumbled favour.

**X1 Player rivalry (proposed, after F1).**
- **Private share deals.** A holder offers shares to a named character at a price; on acceptance they move on the record, or between portfolios for a listed company (off the market, and outside the daily cap). A Fixer's Operator can find a buyer, or take a fee for introducing one. Today shares only change hands on the terminal, by tender, or in a buy-out when someone leaves.
- **NET runs.** A Netrunner runs against a company's NET to steal its real ledger (a data shard through Night City Messenger), showing the true figures behind a report, or to look behind a hidden holder. These count as evidence for stories and can start a case. To decide: a full Night City Messenger network with ICE, or an abstract opposed Interface roll first.
- **Moves against a rival.** Deliberate poaching of a rival's staff (an opposed roll against loyalty, where today poaching is only a random event), sabotage, and bribing a broker or syndicate member for what they know about a hidden holder (from §27.6, not built in B6).
- **Events as scenes.** A big event (a heavy shakedown, a raid, a sabotage) can become a gig on Night City Map or a Messenger hook for the GM, in place of a single roll.
- **Roles still to serve:** a Lawman launching or quashing a financial investigation and calling Backup in a raid; a Nomad's supply contracts, since Nomads control the transport routes; a Rockerboy's gigs at a venue, for it or against a rival's.

**B7 and character ties (proposed).**
- **Downtime (B7, §27.8).** Business days spend Crew Tools downtime, so business work competes with Hustles and gig-hunting, as the rules' free days do.
- **REP and Improvement Points.** Character REP rises at major milestones (a charter, a listing, a takeover) and falls with an unmasking or a lost case; important business scenes award IP. Business Reputation stays separate.
- **Living costs.** A business can cover a partner's or an Exec's monthly Housing or Lifestyle, at a cost to its cash, as a corporation houses an Exec.
- **Teamwork in full.** Team members get real Loyalty checks in place of a fixed 75, once the rulebook's procedure and team sizes are checked.

The order: R1 and R2, then F1 with Media stories, then X1, then B7 and character ties. U1 and P1 stay as planned, after F1; X1's NET runs share Messenger work with U1 (§36.4).

### 36.8 The windows reworked, and what came with them (2026-11-02 and 03; v0.19.0)

The user's requests after U1, each built and committed on its own. Colours, layout and wording changes are not all listed; the commits have them.

- **Market Terminal** (5da8102, 6af679b). Folders Market, News, Portfolio and Settings, in the GM Console's style; Portfolio has Overview, Brokerage, Investments and Ledger. The Overview's chart is `portfolioPnl` (§4.3). The companies and funds tables share columns (`nci-listcols`), as do syndicates and private businesses (`nci-holdcols`).
- **Business window** (168dd3c). Folders Overview, Financial (Ledger, Reports), Operations (Work, Staff, Projects, Back Room) and Ownership (Partners or Shareholders, Growth). Back Room holds the room's panel, company crime, Shortcuts and campaigns, and is not there for a company's non-officers, who therefore cannot help on those actions. A raid shows on Work and Back Room.
- **Exposure as a bar** (32ff590, 639db8d). Bands only, on the Back Room tab and in the Overview's standings, while a room is running, and at a company for officers only. A company with no room still has to audit to learn it.
- **Back-room staff** (6832c3d, ac97d68): see §36.1, U1c. A fixer's own bribes keep `crime.fixerFloor` (5,000 eb) in the cash; the live test saw a small company paying 1,000 eb a week against 701 eb of takings.
- **Tickers in news** (`withTickers`, `newsFeed.js`). Added where a headline is posted and again where it is shown, so older entries and GM-written ones have them. Exact names only: "Kiroshi" does not match "Kiroshi Optical".
- **Pending, for the GM** (69884c2). Each row has its home tab's buttons and fields, run by that tab's own handlers (`tabs/pending.js`); a click elsewhere on the row opens the tab. A big event's "leave it as a roll" is no button: doing nothing is that choice.
- **Pending, for players** (96e9377, `Business/pending.js`). A folder with a count: everything a character could settle now across their businesses, those of syndicates they are officers of, their jobs and their syndicates, read from what the tabs would offer (`businessContext`), so the rules stay in one place. Buttons go through `pendingAct`, which runs a tab's action as the row's account and business and restores the pickers. Left out on purpose: the week's optional actions. Left out for now: an employee's request for a raise, which would need to open the Employee window.
- **Colour theme** (c4e9f69, 8feab74; `core/theme.js`). A client setting, Night City red or Match Pneuma's Visual Tools, offered only with that module active. Every colour in the stylesheet is a token (a test holds to this). Matching reads what that module publishes, `data-pvt-base`, `--pvt-*` and `--cpr-*`, under `html.nci-theme-pvt`, and mixes the rest, so no colours of theirs are copied. It applies with any of its five skins (Dark, Light, Pneuma Dark, Pneuma Light, Pneuma Hub) or Colorize alone. The ticker takes `pneuma-theme-technical`, the class that module uses to reach something that is not a window. The skins' success and failure colours are drawn toward the text colour, because some are too faint for small text; losses on Dark's alternate rows are still 3.7:1.

**Tested in the test world** (2026-11-02 and 03): the folders and tabs of both windows; a Launderer and a Fixer at a weekly close; votes refused and agreed from the player's Pending, as a character and as a syndicate, with a row opening its tab; all five skins and Colorize by screenshot and measured contrast. **Not yet tried live:** the GM Console's Pending actions, spacing and aligned tables and the Factions layout, on any skin (the user's login); on a player's Pending, job offers, invitations, takeovers and roll rows, for want of any open; the cash floor at a close.

### 36.9 B7: downtime, the map and character ties (the user's choices, 2026-11-03)

- **Downtime** replaces the weekly business days when Crew Tools is active, for the same uses (projects, extra time); weekly actions still cost none. It is built in, used if present, reversing §27.8's "bridge only": Crew Tools has nothing to attach a bridge to, and this module would need the checks anyway.
- **The map:** each open business gets a pin in its district, which the GM can move and the bridge keeps; extending the existing bridge module.
- **REP:** a milestone suggests a level on the GM's Pending tab; applied only if higher, as the rulebook has it. **IP:** the GM awards it at big scenes and milestones from Pending; routine rolls give none.
- **Living costs:** partners vote to cover a character's sheet costs, paid monthly from the cash as claimable eddies on a payslip, so it works with Crew Tools' rent or without.
- **The order:** the Teamwork fix (B7a), then downtime (B7b), REP and IP (B7c), living costs (B7d), the map (B7e).

**B7a Teamwork as built** (`businessPeople.js` `teamSize`, `teamCare`, `teamWeek`; `businessStaff.js` `teamRefuses`). Checked against the core rulebook, which the build before this got wrong: one member each at ranks 3, 5 and 9, not one per 3 ranks from rank 1.
- **Loyalty** is `care` on the employee, the rulebook's: 1d6 + 1 to start, at most 10 between weeks and uncapped within one. It is apart from the staff's 0 to 100, which stays at a fixed value so that raid risk, quitting and raises leave them alone. Existing members draw a value; any over the new limit stay (`overLimit`) until they go.
- **The save** is 1d6 under it, drawn from the business and the week, so a refusal is known before any dice roll, and raising Loyalty can still bring them round. One who fails is not offered for rolls and does not do their post's work that week.
- **Moves.** The business week stands in for the rulebook's session. A week with nothing done costs 1. Their Exec can, once a week each, thank them (+1), give a 200 eb perk (+4) or a paid week off (+6, no work). The rulebook's other gains and losses are for the table: the GM sets the number on the Businesses tab.
- **At 0 or below** at a close they betray the Exec and go, leaving 15 Exposure. The rulebook has them try to sell the Exec out at 0 and leave below 0 at a session's end; one close does both. The Exec's next member, likewise after letting one go, starts at Loyalty 1 and costs 200 eb.
- **Tested in the test world** (2026-11-03, Claw, Teamwork 4, at Splice Chrome Clinic): the Hire window's limit; a member joining at a drawn Loyalty; each care button once a week, for the Exec only; a week off stopping work and calls; the cap at a close; the GM's number field; a refusal shown on the Staff tab with no offer in the roll dialog; a betrayal at a close, with the ledger, the digest and 15 Exposure; a replacement at Loyalty 1 for 200 eb. The live test found that a member on a week off could still be called in, and that five kinds of request had no done message, four of them already released (now a test).

**B7b Crew Tools downtime as built** (`integrations/CrewToolsAdapter.js`; checked against Crew Tools 1.0.13). A world setting, on by default, offered only with Crew Tools active.
- **What changes.** Extra time on a roll, project days and a mentor's days come from the character's downtime, and the weekly 3 are gone. Weekly actions still cost none. An officer acting for a syndicate spends their own. An investigation's legwork is money, since it took its day from whichever business had one spare and has none to take now.
- **How.** The player's client spends first, so a roll that cannot be paid for is never made: `downtime.use(days, 'spend', reason, characterId, { projectId: key })`, with a one-time key, and sends `{key, days}` with the request. It works out the balance as Crew Tools does, awards less all else, since it does not expose one. The engine is unchanged: `params.businessDays` is the balance on the client and 0 on the GM's side, where a verified spend credits the request by making `period.days` negative. The credit is used by that request, and the week's record is not saved if it is refused.
- **The check.** The spend must be in the character's log, theirs, a `spend`, of the days claimed, in Crew Tools' current period, and not already counted (`downtimeUsed`). The player owns that log and could edit it, as with a roll's chat card (§27.8).
- **Spent is spent.** Crew Tools has no refund, so a day spent for a request the GM's side then refuses is lost. The client makes the same checks first, so this takes a race or a change in between.
- **Tested in the test world** (2026-11-03, Crew Tools 1.0.13, at Splice Chrome Clinic): balances read from the real log; a character not yet prepared told why, with nothing to spend; project days from two partners, the second asking for more than was needed and spending only what was; a reused key, a forged one and no claim, all refused with nothing changed; a roll with extra time, spending first and carrying its +1 on the card. Mentoring has been tried only against a stand-in.

**B7c REP and IP as built** (`engine/businessRewards.js`, `BusinessService` `_suggestReward`, `_rewardEvents`, `applyReward`, `dismissReward`). Suggestions wait in the GM's hidden state (`hidden[businessId].rewards`), on Pending and on the business's entry, and nothing touches a sheet until the GM applies one, with the numbers as they set them. The table is in the GM Guide. The levels follow the rulebook's scale (4 the local area, 7 a news story, 8 regular headlines). Bad deeds raise REP only if higher, as the rulebook has it, not lowering it as §36.7 first had it. A suggestion that would change nothing, such as a REP-only one at or below a character's REP, is not made. A wound-up business's still wait, though it is closed. Scene suggestions go to all running the business, since the module does not know who took part: the GM dismisses any who were not there.
**Tested in the test world** (2026-11-03): a suggestion on Pending, its IP changed and applied, with both logs on the sheet. The takeover, listing, unmasking, fine and wind-up calls have not run for real.

**B7d Living costs as built** (`business.js` `payLiving`, `coverLiving` and `stopLiving`; `BusinessService` `livingCostOf`, `_livingCosts`). A majority of the votes can have the business pay a partner's Housing and Lifestyle (`system.lifestyle.housing.cost` and `.lifeStyle.cost`; Fashion, extras and Trauma Team are left out). At each report month's close it pays what the sheet shows then, by payslip mail, or straight to the sheet with staff mail off, so it works with Crew Tools' rent or without. It is an owner's take, so in the ledger but not against the week's profit. One the cash cannot cover goes without that month, with a note in the digest; one no longer an active partner is dropped; a business in administration pays none. A player sets their own sheet, so the ledger is the GM's check, and the vote shows the sum.
**Tested in the test world** (2026-11-03): a partner's proposal, voted through from Pending; three closes, paying 1,100 eb at the month's end only, with the ledger line and a message to claim.

**B7e The map as built** (the bridge module's `syncPins`, 0.3.0; `BusinessService.directory`, `api.gm.businessDirectory`). The bridge's active GM client keeps a pin in Night City Map's own data for each open business, at its district's centre, offset so that several do not stack, with its name, kind, stage and location. The directory holds nothing else, so a back room or a balance cannot reach the map. Pins are Night City Map's ordinary custom pins: the GM moves one in its Arrange mode, edits or hides it, and the bridge keeps that, rewriting the text only when the business's own changes. It remembers what it has placed, in a setting of its own, so a pin the GM deletes stays deleted. A closed business's pin goes. A custom map's own districts have other ids: its pins start at the map's centre, for the GM to move. Night City Map has no API for pins, so the bridge writes its `state` setting and reads district positions from its `data.js`, both checked against 0.27.1.
**Tested in the test world** (2026-11-03): both open businesses' pins, seen as a player with the right text; one already moved by the GM. A pin deleted and a business closed have been tried only in tests. A business's location is the player's own words, shown as written.

### 36.10 P1 Production: the plan (the user's choices, 2026-11-03; not built)

**Against the rulebook.** Fabrication's table (core rulebook, Maker): Cheap and Everyday DV 9, 1 hour; Costly DV 13, 6 hours; Premium DV 17, 1 day; Expensive DV 21, 1 week; Very Expensive DV 24, 2 weeks; Luxury and Super Luxury DV 29, 1 month. Materials cost one price category lower (Super Luxury, half its price), and a failure costs the time, not the materials. So §36.2's "about half the market price" was wrong: a 500 eb item takes 100 eb.

**Decisions.**
- **Runs: bench time, by the book.** A workshop's benches each give 7 days of work a week. A run takes the book's time per item, materials from the cash when it starts, and one roll at the book's DV. Faster items come in larger numbers. A failure wastes the time, not the materials.
- **Who: a weekly action, or a new Maker post.** A partner takes an action slot to run production, rolling trade skills or Maker. A Maker on the staff runs the queued line when nobody does, as a manager works the shop.
- **Items: by type and stage, the GM can edit.** Each business type has default item types, capped by stage: up to Premium for a shop, Very Expensive once registered, Luxury for a company. A new GM tab adds, removes and marks items illegal.
- **Selling: weekly shop sales, limited.** The shop sells stock at a discount to market price, up to a limit set by Capacity and Reputation, into takings. Partners can buy at cost.
- **Stock: the storeroom sheet,** as §36.2 has it: a "Stock" container of real items that partners may view, the record holding the money, and taking an item done through the Business window. If the GM moves one by hand, Pending asks what it was.
- **Fencing:** with an open back room, a weekly Fence action sells stock for dirty cash at a better margin, adding Exposure. Illegal items can only be sold this way.
- **Quality and spoilage:** the roll sets how many come out sellable. No separate quality, and stock does not go stale.
- **Links:** a character can consign a finished item, such as one made with Crew Tools, to the stock at its value; Crew Tools keeps the crafting rules. No facility bonus, which Crew Tools has no way to accept. Market contracts wait for a later phase.

**Why bench time should not be a farm.** A bench-week at full price, less materials: Premium 7 items at a 50 eb margin, 350 eb; Expensive 1 at 400 eb; Very Expensive half of one at 500 eb, 250 eb; Luxury a quarter of one at 4,000 eb, 1,000 eb. Everyday looks like 56 items at a 10 eb margin, 560 eb, which the sales limit holds back. That is about what a business already earns in a week, and it is before the shop's discount, failed rolls and the sales limit.

**Numbers, as the simulator left them** (`npm run simulate:production`). Benches 1, 2 and 4 by stage. The workshop project costs 1,500, 4,000 and 12,000 eb, and takes 3, 5 and 9 days; it is built once a stage, and building it again at a higher stage gives that stage's benches. The shop sells at 70% of market price. The weekly sales limit is half the week's ordinary takings, moved by the Reputation band. Fencing pays 90% of market price in dirty cash.

**What the simulator changed.** On its best line, a strong or average crew's mature shop or registered business adds about 40% to 65% to its ordinary profit, and the workshop pays for itself in about 20 to 25 weeks. A company adds under 10%, and takes about a year. So it is not a farm, and it matters most to a small business. Three rules came of it:
- **Only what comes out sellable uses materials,** as the book's "a failure costs the time" suggests. Paying for a whole run made Premium and Very Expensive lines lose money. A passed roll always makes at least one.
- **A run makes at most 20 items.** Otherwise a company's best line was 150 Everyday items a week. The storeroom also holds at most 25, 50 and 100 items that do not stack (weapons, armor, cyberware, programs, cyberdecks, upgrades and vehicles): only ammunition, clothing, drugs and gear have an amount.
- **For P1b: up to 4 weeks of unused sales limit carry over.** Without that, an item dearer than a week's limit can never sell.

A Maker with a base of 14 costs more than a shop's line earns (70 eb a week against 40 to 65), about what a registered business's best line earns (126 eb against 98 to 209), and a little less than a company's (196 eb against 142 to 279), so a small shop's line is really a partner's week. Very Expensive and Luxury items rarely pass at the book's DV (24 and 29), so they suit only the best makers: at a roll base of 14 or less they add 5% or less to profit.

**Which businesses make what** (defaults, by the compendium's item types): gun shop, weapons, ammunition and weapon attachments; garage, vehicle upgrades and gear; clinic, cyberware and drugs; info shop, programs and cyberdeck hardware; boutique, clothing; media, gear such as recordings; bar and food stall, gear such as food and drink; courier and security, none.

**The parts, in order.** Each ends as the others do, with tests and a run in the test world.
- **P1a:** the workshop project and benches, item lists and the GM's tab, runs and the Maker post, stock on the record and the storeroom sheet. The simulator check comes first.
- **P1b:** weekly shop sales, buying at cost, handing an item to a partner, consigning, stock in book value and valuation, and Pending's question when the GM moves an item by hand.
- **P1c:** fencing, and illegal items made through a back room.

**Illegal production through a back room (the user's choices, 2026-11-03; built in P1c with fencing).** Until then, items marked illegal stay off every line.
- **Setup:** a workshop and an open back room. The workshop's benches do the work, with no new project or room kind. If the room shuts, illegal lines stop.
- **Risk:** each illegal run adds Exposure as working the room does (`workExposure`, 1 to 8 by band). A lost raid seizes illegal stock in the same share as dirty cash: part of it on a failure, all of it when unanswered or fumbled.
- **Paying and running:** materials come from the room's dirty cash, then the ordinary cash if that runs short. A partner or the Maker runs it, the Maker at the back room's rate (1.5 times) while on illegal work. The ledger uses plain words, as back-room lines do.
- **Companies:** no room needed. It is the officers' secret, and each run adds Exposure.

**Checked live, 2026-11-03.** Observer access is enough for a sheet players can see but not take from: the sheet stops a drag, and CPR's `_purchaseItem` refuses anyone who is not an owner, for whole and part purchases. Its cart icon still shows, and clicking it gives a permission warning. Direct sales through vendor mode would need players to own the sheet, so they stay in the Business window.

**P1b as decided (the user's choices, 2026-11-03).**
- **Sales limit:** half the week's takings, times 0.75, 1, 1.1 or 1.25 by Reputation band (Poor, Modest, Good, Excellent), with up to 4 weeks' worth carried. Dearest first, holding the limit for a dear item rather than selling cheaper ones past it.
- **Buying:** any active partner at a shop or registered business pays cost, with no vote. At a company, officers pay the shop's price (70% of market), since cost would come out of other shareholders' pockets.
- **Handing over:** a majority vote gives items to a partner for nothing.
- **Consigning:** the item stays its owner's until sold, and they get the sale price less the shop's 30% (49% of market). It uses the sales limit, is not in book value, and can be taken back.
- **Book value:** materials move from cash to assets, so stock counts at cost in book value and valuation. Only what a sale made over cost is profit.
- **Closing:** stock goes into the pot at cost rather than at salvage, consigned items go back, and the storeroom sheet is deleted. A run on the benches counts too.
- **The GM moving stock by hand:** Pending asks whether it was sold, given or lost. Only items leaving the sheet are asked about; anything the GM adds by hand stays outside the record.

**P1c as decided (the user's choices, 2026-11-04).**
- **Fencing:** a weekly action, on the Back Room tab, rolling Trading, Streetwise or Operator. The limit is the week's takings × 0.5 × the band (Narrow 0.5, Solid 0.75, Strong 1, Exceptional 1.25), and a passed roll always moves at least one item, with no carry-over. It pays 90% of market price in dirty cash, illegal goods first, dearest first, and adds Exposure as working the room does.
- **Who and what:** a partner can fence any of the business's own stock. A Hand, in a week no partner does, fences illegal stock only, on top of working the room. Consignments are not fenced.
- **Companies:** an officer's fence pays into the cash, shown to other holders as a plain line, and adds Exposure at twice the back room's rate. Its action, line, stock and notes are hidden from those not running it.
- **Off the books:** illegal stock is no part of the assets, so a closing pays nothing for it. Dirty cash pays for its materials first, then the cash.
- **Consigning:** the shop refuses illegal goods, at the drop and again at the GM's service.

**To check while building:** how item quantities and ammunition stacks work when items are created.

### 36.11 The market date and the calendar (the user's choice, 2026-11-04)

A hand advance used to move only the market, building a `lead` over the calendar that never closed. Now, outside manual mode, it also moves the calendar by the whole days it added (`TickService._moveCalendar`), so in-world time passes for everything reading the calendar. A gap already there is left for the Market tab's **Move the calendar on** button, so that the first press after updating does not jump the calendar without warning. Both move the calendar first and only then turn lead into calendar days, so the market date never changes, the clock check finds nothing due, and a calendar that cannot move changes nothing. A GM's undo still leaves the clock alone.

The short business periods seen in testing are the calendar's: the test world's Simple Calendar restarts its weekdays on the 1st of each month, so a week can close after 2 or 3 days. Takings, wages, upkeep, bench time and the sales and fence limits all scale with the period. Merging them is the user's choice, still open.

### 36.12 Back room kinds and profiles (the user's choices, 2026-11-04; done in v0.21.1)

**Decided.**
- **Kinds:** keep all 34 below, the two marked *dark* included.
- **Connected:** +1 standing a week worked, with one faction the partners choose when opening the room. Standing fades 2 points a week, so this slows the fade rather than building it alone. The +1 is always a full +1: it skips the division of repeat dealings within 28 days, and is not counted as one, so gigs for that faction keep their value (the user's choice after the live test, which saw +1 then +0.5).
- **Laundering for others** moves to the Laundering profile, so rooms already open at a boutique change with it. Every other current kind stays Steady.
- **Kind-specific events** wait for later, a bad batch for Hungry kinds included.
- **Raid fines** stay flat for now, for future consideration.

**Where it stood before U2.** Every kind plays the same today: `BACK_ROOMS` sets only its name and the skills it rolls. Earnings, Exposure, raids and laundering are one set of numbers, and only a bar has a choice. This gives each kind of business more to choose from, and makes the choice matter.

**The profiles.** Each kind has one. Current kinds are Steady, which is today's numbers exactly, so a room already open plays on unchanged, apart from Laundering for others, as above.

| Profile | Earns | Exposure from work | Raid chance | Laundering | Its own rule |
|---|---|---|---|---|---|
| **Steady** | 100% | 100% | 100% | 100% | None: the room as it is today |
| **Loud** | 150% | 150% | 125% | 100% | The roll swings the money half as far again |
| **Quiet** | 65% | 50% | 50% | 100% | The roll moves the money three quarters as far |
| **Hungry** | 150% | 125% | 100% | 100% | A quarter of what it earns goes on supplies, out of dirty cash |
| **Connected** | 50% | 75% | 100% | 100% | Sheds 0.5 Exposure a week worked, and +1 standing a week worked with a faction chosen on opening |
| **Laundering** | 80% | 75% | 100% | 200% | The cap on washing dirty cash is doubled |

**What they do over a year,** from `npm run simulate:backrooms`: a registered business at Capacity 3, 1,500 years, a crew that works the room, launders, pays off at moderate Exposure and lies low at high. *Kept* is what is left each week: laundered, plus dirty cash in hand, after supplies, pay-offs, fines and seizures. *Shut* is the chance the room is shut within the year.

| | Roll base 12 | | | | Roll base 15 | | | |
|---|---|---|---|---|---|---|---|---|
| **Profile** | **Kept** | **Clean** | **Raids** | **Shut** | **Kept** | **Clean** | **Raids** | **Shut** |
| Steady | 153 | 34 | 3.5 | 35% | 310 | 97 | 2.6 | 23% |
| Loud | 165 | 17 | 4.6 | 60% | 460 | 73 | 3.7 | 32% |
| Quiet | 122 | 64 | 1.5 | 16% | 221 | 129 | 1.1 | 10% |
| Hungry | 144 | 24 | 3.8 | 45% | 329 | 85 | 2.8 | 26% |
| Connected | 69 | 56 | 3.1 | 35% | 161 | 122 | 2.1 | 20% |
| Laundering | 144 | 91 | 3.1 | 31% | 273 | 218 | 2.3 | 20% |

So no profile beats Steady on both money and safety, and skill matters most to Loud. Connected earns least on purpose, and needs its standing rule to be worth choosing, which the simulator does not price. Hungry is close to Steady for a little more risk, and with its bad batch event left for later, it stays that way for now.

**The map.** All skills and abilities below exist today.

| Business | Kind | Status | Profile | Rolls | The trouble it draws |
|---|---|---|---|---|---|
| Ripperdoc clinic | Black-market chrome | Current | Steady | Cybertech, Paramedic; Medicine | NCPD, stolen-chrome owners |
| | Back-alley surgery | New | Quiet | Paramedic, Cybertech; Medicine | Patients who talk |
| | Street pharmacy | New | Hungry | Paramedic, Trading; Medicine | Rival dealers, bad batches |
| | Organ brokering | New, *dark* | Loud | Cybertech, Streetwise; Medicine | NCPD, the donors' friends |
| Garage | Chop shop | Current | Steady | Basic Tech, Land Vehicle Tech; Maker | The owners, NCPD |
| | Vehicle cloning | New | Quiet | Land Vehicle Tech, Electronics; Maker | A paper trail |
| | Getaway outfitting | New | Connected | Land Vehicle Tech, Streetwise; Maker | Whoever the crew robbed |
| Bar or club | Gambling and dealing | Current | Steady | Streetwise, Persuasion; Charismatic Impact | Rival dealers, vice raids |
| | Brothel or dollhouse | Current | Steady | Persuasion, Human Perception, Wardrobe; Charismatic Impact | Vice raids, the district's gang |
| | Fight pit | New | Loud | Streetwise, Brawling; Charismatic Impact | Vice raids, dead fighters |
| | Fixers' meeting room | New | Connected | Conversation, Streetwise; Operator | Everyone's enemies |
| Info shop | Data fencing | Current | Steady | Library Search; Interface | NetWatch, the data's owners |
| | Identity forgery | New | Quiet | Library Search, Bureaucracy; Interface | A customer who gets caught |
| | Black ICE for hire | New | Loud | Electronics, Library Search; Interface | NetWatch |
| Gun shop | Unregistered arms | Current | Steady | Weaponstech, Trading; Operator | NCPD, Militech's lawyers |
| | Illegal modifications | New | Quiet | Weaponstech, Basic Tech; Maker | A gun traced back |
| | Arming a gang | New | Connected | Trading, Streetwise; Operator | That gang's enemies |
| Courier service | Smuggling | Current | Steady | Drive Land Vehicle, Local Expert; Moto | Border checks, hijackers |
| | Hot goods transport | New | Quiet | Drive Land Vehicle, Streetwise; Moto | Hijackers |
| | People running | New, *dark* | Loud | Drive Land Vehicle, Streetwise; Moto | NCPD, corp security |
| Boutique or salon | Laundering for others | Current | Laundering | Business, Streetwise | The clients' enemies |
| | Disguises and new faces | New | Quiet | Personal Grooming, Wardrobe; Medicine | A customer who gets caught |
| | Counterfeit labels | New | Hungry | Wardrobe, Trading; Maker | The brand's lawyers |
| | Second set of books | New | Laundering | Accounting, Business | Auditors |
| Food stall | A dead drop | Current | Steady | Business, Streetwise | Whoever is watching |
| | Street dealing | New | Hungry | Streetwise, Local Expert; Operator | Rival dealers |
| | Lookouts and informants | New | Connected | Streetwise, Local Expert; Operator | Those being watched |
| | The cash till | New | Laundering | Business, Accounting | Auditors |
| Screamsheet | Blackmail and bootlegs | Current | Steady | Composition, Photography; Credibility | The targets |
| | Braindance bootlegs | New | Hungry | Photography, Electronics; Credibility | The studios |
| | Paid-for stories | New | Connected | Composition, Persuasion; Credibility | A rival paper |
| Security outfit | Muscle and rackets | Current | Steady | Tactics, Persuasion; Combat Awareness | Gangs, NCPD |
| | Protection for hire | New | Connected | Tactics, Streetwise; Combat Awareness | Whoever they protect against |
| | Inside jobs | New | Loud | Tactics, Interrogation; Backup | The clients, NCPD |

That is 11 kinds today and 23 new ones, 34 in all, giving each kind of business three or four. The two marked *dark* can be dropped on taste.

**How it would be built.** `BACK_ROOMS` gives each kind a `profile`, and `backRoom.profiles` holds the numbers. `roomWeek` reads them for earnings, Exposure and laundering, `raidChance` for the raid, and the Projects tab shows each kind's profile in plain words beside the choice. A room's `kind` is already stored, so there is nothing to migrate, and an unknown kind reads as Steady.

**Found on the way, whatever is decided here.** A small room run by a weak crew rarely lasts today: at Capacity 1.3 and a roll base of 10, about 93% of rooms are shut within a year, and the crew keeps about 10 eb a week of the 59 eb it earns. The fines are flat (500 and 1,000 eb) whatever the size of the room. Scaling them by Capacity would be fairer, and is a change to today's balance, so it is the user's call. The model gives every room two action slots and a registered business's DV, so a real side business, with one slot and an easier DV, will differ: this wants a closer look before anything changes.

**As built and tested live (v0.21.1, 2026-11-04).** A Street pharmacy at the clinic and a Fixers' meeting room at a new bar ran for up to three weeks in the test world, and their supply costs, Exposure and standing matched the sums to the decimal. The test changed one rule: a Connected room's +1 was divided as a repeat dealing, so the second week gave +0.5, and it is now `steady` in `moveStanding`, always in full and never a recent dealing. A staff informant's +2 Exposure was seen in the same run. **Not seen live, in tests only:** the Loud, Quiet and Laundering profiles, a raid on a room with a profile, Laundering for others at a boutique, and a gig's full value alongside a Connected room.

**Found alongside it, also in v0.21.1.** When the calendar moves back past the start of a business's week, that week runs from the new date with what was done in it, and the digest says so (`advanceBusiness`, note `weekRestarted`). The user chose to leave other waiting dates as they are: retries at a step-up, charter, listing or setup, and campaign cooldowns, keep waiting for the date they were given. The Business window also moves to a new business once it exists (`_followFounded`); a founding sent to a syndicate's vote was not tried live.

**Parts, to be shown in turn as P1's were.** U2a: the profiles in the engine, and every kind's numbers, tested against the simulator. U2b: the new kinds, choosing one on the Projects tab with its profile in plain words, and a Connected room's faction. The guides follow.

### 36.13 Press: stories against players (the user's choices, 2026-11-04; not built)

**Decided.**
- **Characters** are driven by the worst standing of any business they run, plus their heat. They get no standing of their own.
- **Mostly true stories,** with room for tabloid falsehoods: the smear needs no facts and is harder to believe. To be set in S1a: when something true can be told, a smear is the pick about one time in five (a starting number).
- **GM approval** by default.
- **Character REP** is never touched by a story.
- **Gangs** don't feed outlets for now; a future addition.
- **How often** is a GM setting: proposed as Rare, Normal or Often, at half, the table's and double the weekly chances. The 28-day limit stays whichever is chosen.

**The idea.** Stories only run one way today: a player's Media writes about a market company. This runs them the other way. Non-player companies, driven by how they stand with the players, run stories against player companies and individual characters. What a story does depends on what it says: a listed company's price, a business's Reputation, Exposure, or a character's heat.

**What exists to build on.**

| Piece | Today | Use here |
|---|---|---|
| Standing | Hidden, per business, -100 to 100; characters have none | The driver for businesses |
| A hostile corporation's smear (F1b) | 5% to 15% a week, hostile only, in place of the week's event. Answered with Persuasion, Composition, Credibility or Charismatic Impact. Lost: Reputation -3, and -2% if listed | The way a story reaches a business and gets answered |
| `rollStory` and `STORY_RULES` | Believability and the price limit by Credibility rank | The same rules, with an outlet's rank |
| `makeImpact` and `_scandal` | A delayed price move, a headline, and heat windows for those who knew | How a story reaches the price |
| `rumourSources` | A player's Media hears of delayed price moves | Hearing of a story before it runs |
| Pending, and `campaignApproval` | **Let it run** or **Spike it** for player stories | GM approval |
| `HeatService.setHeat`, and tiers at 25, 50 and 75 | Heat is per character, and only with tracking on | What a story about a character adds |
| Exposure, regulators' cases, hidden holdings | Hidden state, with `caseRank` 5 opening a case on a believed expose | What makes a story true |

**Who runs a story.** A *grudge* and an *outlet*. The grudge is the faction with the reason, and the outlet is who prints it: a corporation may be its own, or use a market company in the media sector such as Network 54. An outlet has a rank that sets Believability and the price limit, as a Media's Credibility does. A gang has no outlet of its own and stays with sabotage for now; feeding an outlet is a future addition.

**What sets one off.** A weekly check at the close, for each open business, with a chance by its worst standing with a corporation. Numbers are starting points, for the simulator to check.

| Worst standing | Chance a week | Over a year of 52 weeks |
|---|---|---|
| Friendly or allied, none worse | 0% | None; a later option is that a friend warns you or spikes one |
| Neutral | 0%, or 1% with a true story to tell | About 0.5 |
| Wary | 4% | About 2 |
| Hostile | The current 5% to 15% | About 3 to 8 |

These sit within one event a week, and a target gets at most one story in 28 days, so bad standing can't stack a story on every other penalty it already brings. At hostile, the story takes the place of the smear rather than adding to it.

**Characters** have no standing, so a character takes **the worst standing of any business they run**, and adds **their heat**: from *noticed* (25) a story can name them even with no business. Giving characters their own standing is possible, but gigs, gifts and the Overview tab would all need to learn it, which is a much larger job. Without heat tracking and without a business, a character is never a target.

**What a story says.** Each kind needs a fact to be true, so stories follow what the players have actually done, and evidence raises Believability as it does for a Media: +1 for one fact, +3 for more than four. Only the smear needs nothing.

| Kind | Target | True when | If believed and not answered |
|---|---|---|---|
| **Money trouble** | Business | A loss in recent weeks, a late report, or poor Compliance | Listed: price by the outlet's limit. Reputation -2 |
| **Crime expose** | Business | Exposure moderate or higher, or a recent raid | Listed: price. Reputation -5, Exposure +5. From rank 5, a regulator's case on a registered or larger business |
| **Bad service** | Business | Low Reputation, or a recent accident or stock query | Reputation -5 |
| **Dirty dealing** | Character | Heat *noticed* or higher | Heat +10, or +15 from rank 5 |
| **Hidden stake** | Character | A concealed holding in a listed company | Heat +15, the company's price by half the limit; unmasking it is a later step |
| **Smear** | Either | Always; Believability -1 | A business: Reputation -3, and -2% if listed. A character: heat +5 |

A story about a character also costs the business they run with the worst standing some Reputation: half of what the same story would cost it directly. Character REP is left alone, as decided.

**Answering.**
- **A business** answers as it does a smear, with the week's response roll. Answered stops it; failed halves it; unanswered or fumbled takes it in full. A big one can be run as a scene (X1).
- **A character** has no week to spend, so a notice comes by mail, with **Answer** on the Pending tab and seven days to roll Persuasion, Composition, Bribery or Credibility, as a regulator's case is answered. Silence takes it in full.
- **A player's Media** can hear of it first: a story waits three days before it runs, and is a rumour source meanwhile, so a Media can warn a friend. Trading on that draws insider heat, as other rumours do. A puff piece still works against the price afterward.

**The GM.** On by default with approval, under a new setting: each story waits on Pending with its grudge, outlet, kind and why it was true, for **Let it run** or **Spike it**, and the GM can reword the headline. **Run a story** on Market > Events does one by hand, whatever the chance. Kinds follow other settings: Crime expose goes with Underworld content, and the character kinds need heat tracking.

**Things to watch.**
- **It tells players something.** A true story confirms hidden state: a crime expose says that someone is looking at your back room, though no number. At a company, other shareholders learn what the officers kept quiet, which §36.1 already allows through a scandal.
- **Naming characters in public.** Headlines go to everyone, so a character's story outs them to the table. Approval is the GM's check on it.
- **A spiral.** A hit to Reputation and price can make Money trouble and Bad service true, feeding more. The 28-day limit slows this; the simulator should show whether it's enough.
- **The clock.** A year of 52 weeks may be many sessions or a few, which is why how often is a setting.

**Parts, if built, shown in turn.** S1a: the engine, a business as the target, price, Reputation and Exposure, approval. S1b: characters, heat, answering by mail. S1c: rumours beforehand, **Run a story**, and the simulator's numbers in the guides.

### 36.14 Back room events and actions, by profile (proposed, 2026-11-04; not built)

**The idea.** U2 made rooms differ in their numbers. This makes them differ in what happens and what you can choose. Each profile gets **one thing that goes wrong** because of what makes it different, and **one action only it has**, so choosing a room means choosing its troubles. This takes up what §36.12 left for later, and the list in §36.1 that was never built: a bad batch, a rival operation and an offer you can't refuse. Raids, informants and gang deals exist already and stay as they are.

**How it fits what exists.**
- **One event a week.** The order today is a raid, then a hostile faction's act, then the ordinary table (`business.js` close). A room event goes after the hostile act and before the ordinary table, so it replaces that week's ordinary event and the total of one a week holds.
- **Only in a week the room is worked.** A room lying low or left idle draws none. That keeps a player's choice in charge of it.
- **Answered as events are,** with the week's response roll, using the skills the room's kind rolls. Answered stops it, failed halves it, and unanswered or fumbled takes it in full. Big ones can be played as scenes (X1).
- **New actions take a slot,** which is the real cost: a shop has one action a week, and a registered business two. Each is on the Back Room tab, rolls the kind's skills, and is refused before any dice if it can't work.
- **What they change is mostly dirty cash and Exposure,** so `settleEvent`'s `applyHit` needs those two added, or a fallout step as a raid has.
- **At a company** a room is the officers' secret, so its events must look like something else to other shareholders, as a raid looks like an inspection.
- **With Underworld content off,** rooms still open follow the same rule as raids.

**Profiles: what goes wrong, and what only they can do.** Numbers are starting points for the simulator.

| Profile | Event: what goes wrong | If not answered | Action only it has | What it does |
|---|---|---|---|---|
| **Steady** | None of its own | | None of its own | The plain room, as §36.12 promises; only the shared events below |
| **Loud** | **Too much noise:** it drew a crowd, and someone filmed it | Exposure +6, Reputation -3 | **A big night:** once in 28 days | This week's room earnings x1.5 on a pass, and its Exposure from work x2 whatever the roll |
| **Quiet** | **A loose end:** a customer talks | Exposure +8, which is a lot for a room that seldom gains any | **Cover the trail** | No earnings needed: Exposure -2 to -5 by band, free but it takes the slot. Lying low earns nothing and sheds 3, so this is for a crew with a spare slot |
| **Hungry** | **A bad batch:** the supplies were wrong | The week's earnings lost, Reputation -5; a fumble adds Exposure +5 | **Find a new supplier:** once in 28 days | A pass takes supplies from 25% to 15% for four weeks. A failure makes the next bad batch twice as likely, in the same four weeks |
| **Connected** | **A favour asked:** the chosen faction wants something | Standing with them -5, which the room's +1 a week takes long to recover | **Call in a favour:** needs friendly or better | Spend 5 standing to clear Exposure -5, or to stop this week's shakedown. Once S1 is built, to spike a press story too |
| **Laundering** | **The books don't add up:** the trail shows | Exposure +6, and up to a quarter of the dirty cash lost. A bookkeeper makes it less likely | **Wash for a client:** once in 28 days | Earns a fee in dirty cash, a share of the takings cap, and adds Exposure as laundering does |

**Shared by every room.** Rarer, and for Steady the only variety.

| Event | What happens | If not answered |
|---|---|---|
| **A rival operation** | Another crew moves in on the room's trade | The week's earnings halved, and Exposure +2 |
| **An offer you can't refuse** | A good event: a big order from someone you'd rather not owe. It can be turned down at no cost | Answered and passed: 150% of the week's earnings in dirty cash, Exposure +4. Failed: Exposure +4 and nothing else |

**How often.** A room event in about 8% of weeks worked, 80% from the profile's own event and 20% from the shared ones, for about 4 a year in a room worked every week. It's within one event a week, so the rise in trouble is smaller than that. A Steady room would see only the shared events, at about 1 a year.

**What the simulator must check.** Whether the events undo §36.12's balance: Quiet's safety, Loud's reward for skill, and whether Hungry at last has a real cost for its 150%. Connected earned least on purpose and needs its action to be worth choosing, and the simulator can't price standing, so it needs a judgement from play. The events should also be checked against the 93% of small rooms already shut within a year (§36.12), because they mustn't make a weak crew's small room worse still.

**Each kind tells it in its own words.** The numbers come from the profile and the words from the kind, so 34 rooms need 34 lines of text and no new rules. These draw on the troubles §36.12 already lists. The two dark kinds and the brothel stay non-graphic.

| Business | Kind | Profile | The event as it reads |
|---|---|---|---|
| Ripperdoc clinic | Black-market chrome | Steady | Shared only |
| | Back-alley surgery | Quiet | A patient talks |
| | Street pharmacy | Hungry | A bad batch goes out |
| | Organ brokering | Loud | A donor's friends come asking |
| Garage | Chop shop | Steady | Shared only |
| | Vehicle cloning | Quiet | A cloned plate gets flagged |
| | Getaway outfitting | Connected | The crew wants a car for a job of its own |
| Bar or club | Gambling and dealing | Steady | Shared only |
| | Brothel or dollhouse | Steady | Shared only |
| | Fight pit | Loud | A fight goes too far, on camera |
| | Fixers' meeting room | Connected | A fixer wants a meeting kept off the books |
| Info shop | Data fencing | Steady | Shared only |
| | Identity forgery | Quiet | A customer is caught with your work |
| | Black ICE for hire | Loud | NetWatch traces a job |
| Gun shop | Unregistered arms | Steady | Shared only |
| | Illegal modifications | Quiet | A gun is traced back to you |
| | Arming a gang | Connected | The gang wants credit |
| Courier service | Smuggling | Steady | Shared only |
| | Hot goods transport | Quiet | A driver is stopped and talks |
| | People running | Loud | A run goes wrong in public |
| Boutique or salon | Laundering for others | Laundering | A client's money has been followed |
| | Disguises and new faces | Quiet | A customer is recognised, and says who did it |
| | Counterfeit labels | Hungry | A run of fakes falls apart |
| | Second set of books | Laundering | The two sets stop agreeing |
| Food stall | A dead drop | Steady | Shared only |
| | Street dealing | Hungry | A bad batch hits the block |
| | Lookouts and informants | Connected | Your watchers are asked to watch someone for free |
| | The cash till | Laundering | The takings look too good for a stall |
| Screamsheet | Blackmail and bootlegs | Steady | Shared only |
| | Braindance bootlegs | Hungry | A bad copy burns a customer |
| | Paid-for stories | Connected | A patron wants a story run |
| Security outfit | Muscle and rackets | Steady | Shared only |
| | Protection for hire | Connected | A client wants more than protection |
| | Inside jobs | Loud | A job is traced to your guards |

**Things to watch.**
- **Too much to read.** Six events and five actions join the Back Room tab; only those for this room should show.
- **Connected's favour needs friendly.** The room alone holds standing at 1, so its action only opens with gifts or gigs on top. That's deliberate, but a player may not see why, so the tab should say.
- **Laundering's client work** could later take another player business's dirty cash, which would be a good link and a larger job. It's left out here.
- **S1 and this overlap slightly.** A crime expose (§36.13) reads as a loose end told to the press. Neither needs the other, except Call in a favour against a story.

**Parts, if built, shown in turn.** U3a: the room event table in the engine, the six events and the simulator's numbers. U3b: the actions on the Back Room tab. U3c: each kind's words, scenes, how they look at a company, and the guides.

**Still to decide:** whether Steady gets shared events or none; whether kinds get their own words; and how often.

## 37. Roadmap

| Phase | Deliverable |
|---|---|
| 0 | Scaffolding, pure engine, seeded PRNG, `tools/simulate.mjs` calibrated, unit tests. **Done (v0.0.1):** engine, simulator and 41 tests exist; in-game windows are placeholders, and the model needs further tuning against real play |
| 1 | Companies as journals, tick service, market and company UI (read-only), GM tick controls. **Done (v0.1.0):** all of these exist and are tested against a fake Foundry runtime; the windows have not yet been tried in a live Foundry world |
| 2 | Portfolio, lots, brokerage balance with deposits and direct withdrawals, direct orders, GM executor and outbox, CPR wealth ledger, P&L. **Done (v0.2.0):** all of these exist and are tested against a fake Foundry runtime; the windows have not yet been tried in a live Foundry world. Broker-routed withdrawals come with Phase 4 |
| 3 | Dividends and corporate actions, GM bias/shock/regime controls, impact queue. **Done (v0.3.0, completed in v0.4.1):** dividends (scheduled, special, reinvestment), splits (manual and automatic), buyouts, delistings, bankruptcies, IPOs with a subscription window, sentiment biases, forced regimes, volatility, market halt, the scheduled-impact queue, scripted glides, the Monte-Carlo preview, undo last tick, set price, a GM action log and a public news feed. See §16. Dividends use a simple rule in place of an ex-date snapshot: only shares held before the declaration tick qualify, which is the same thing as an ex-date on the declaration tick |
| 4 | **Done (v0.4.0), see §15.** Skill-based brokers, direct terminal trading with an Accounting check, broker-only funds, mail orders and replies, delayed fills, broker-processed withdrawals paid as claimable eddies, opt-in notifications |
| 5 | **Done (v0.5.0, extras in v0.5.1), see §17 and §18.** Price alerts, brokerage statements (on request and monthly), fund rebalancing and manager alpha, then settlement and redemption delays, distributing funds, a movers notification and a ticker strip. Capital-gains tax was left out on purpose. (Funds and watchlists shipped earlier, in Phase 4 and Phase 2) |
| 6 | **Done (v0.6.0), see §19.** Night City Map bridge (gig outcome → impact), approval queue, client mapping, Gigs tab. The bridge is a separate module, `night-city-map-night-city-investments-bridge` |
| 7 | **Done (v0.9.0), see §22.** Starter pack (already in since phase 1), API docs, self-check, trade log, company suggestions, starter macros, keybindings, data migrations. The macro importer was dropped: it will not be needed |
| 6b | Insider-trading heat, in stages (§21). **H1 done (v0.7.0, retuned in v0.7.1):** hidden heat recorded from audited gig windows, GM Heat tab. **H2 and H3 done (v0.8.0):** warnings, NCPD enquiries, fines, freezes and dropped brokers with GM approval, and skill-roll cover-up actions. H4 (gig runner from the bridge) done (v0.9.7) |
| 0.9.7 | **Done (v0.9.7).** Released the work that had been unreleased: the after-tick sequence and dividend-records fix (§25), the market date, price paths and cleanups (§26), and gig runners for heat (H4) |
| B0 | **Done, see §27.9 (B0 findings).** Groundwork for player businesses and syndicates: the business growth simulator (`tools/business-model.mjs`), the storage schema, and the Crew Tools spike (from its source; a run in the test world is still to do) |
| B1 | **Done (v0.10.0), see §28.** Side businesses: the roll levers, the Business window and the GM's Businesses tab, partnerships, four archetypes, the weekly loop |
| B2 | **Done (v0.11.0), see §29.** Growing: events, loans, registration, investors, expansion projects, private holdings in the portfolio, locations, role abilities, gigs for own business |
| B3 | **Done (v0.12.0), see §30.** Player syndicates, and syndicates owning or investing in businesses |
| B4 | **Done (v0.12.0), see §31.** Chartered companies: the charter, the company loop, monthly reports, officers and control |
| E | **E1 and E2 done (v0.12.0), see §32.9 and §32.10; E3 done (v0.13.0), see §32.11.** Employees: player characters, tagged NPCs and recruits working in posts for wages, overtime rolls, loyalty, staff events, training and share grants; before B5 |
| Projects | **Done (v0.12.0), see §33.** Projects beside expansion: refit, security upgrade, storefront, staff room; the Projects tab reworked |
| B5 | **Done (v0.14.0), see §34.** Going public: valuation, listing checklist, prospectus rolls, the IPO, earnings impacts and capped payouts |
| B6 | **Done (v0.15.0), see §35.** Corporate play: takeovers, buybacks, insolvency, hidden ownership and investigations |
| R1 | **Done (v0.16.0), see §36.7.** Regulators: Exposure opens cases, by a monthly chance and by triggers, that an officer fights with an opposed roll; fines wait for the GM |
| R2 | **Done (v0.16.0), see §36.7.** Role abilities: a player rolls rank + 9 in business rolls, as staff do |
| F1 | **Done (v0.17.0), see §36.3 and §36.7.** Faction standing with corps and gangs, moved by gigs and business actions; smear campaigns through the impact pipeline; Media rumours and published stories moving prices; after R1 |
| X1 | **Part done (v0.18.0), see §36.7:** big events as scenes, and more for Lawmen, Nomads and Rockerboys. **Still proposed:** player rivalry: private share deals, Netrunner runs on a company's NET, poaching and sabotage; after F1 |
| B7 | **Done (v0.20.0), see §36.9.** B7a Teamwork against the rulebook, B7b Crew Tools downtime, B7c REP and IP, B7d living costs and B7e businesses on Night City Map, with the bridge at 0.3.0 |
| U1 | **Done (v0.19.0), see §36.1 and §36.8.** Fronts: back rooms, dirty cash and laundering, raids, gang relationships, back-room staff; after F1 and B6 |
| UI | **Done (v0.19.0), see §36.8.** The Market Terminal and Business window in folders and tabs, Pending for GM and players, Exposure as a bar, tickers in news, a colour theme matching Pneuma's Visual Tools |
| P1 | **Done (v0.21.0), see §36.10.** P1a workshops, item lists and the GM's tab, runs, the Maker post and the storeroom sheet; P1b shop sales, buying, handing over, consigning, stock in book value and closing; P1c fencing and illegal production through a back room. Also: one control height, and hand advances moving the calendar (§36.11) |
| U2 | **Done (v0.21.1), see §36.12.** More back room kinds, each with a profile that changes how it plays |
| U3 | **Proposed, see §36.14.** Back room events and actions, one of each for each profile, with each kind telling them in its own words |
| S1 | **Planned, see §36.13.** Press: non-player companies run stories against player companies and characters, driven by standing and heat |
| M | **Proposed, see §36.4.** Further Night City Messenger integration, alongside each step |
| Later | Short selling and margin, options |
