# Night City Investments

Stock market, portfolios, brokers and dividends for Cyberpunk RED in Foundry VTT. Works with Night City Messenger. If using the Night City Map module, adding the  Night City Map Night City Investments Bridge allows gig outcomes to influence share prices.

## Requirements

- Foundry VTT v12
- Cyberpunk RED Core
- [Night City Messenger](https://github.com/christinophrappuccino/night-city-messenger)

### Optional
- [Night City Map](https://github.com/samroaleksej-bit/night-city-map) (checked against v0.21.0)
- [Night City Map Night City Investments Bridge](https://github.com/Shepskii/night-city-map-night-city-investments-bridge)

## Installation

Unzip the release folder to the `Data\Modules` folder in your Foundry instance - `Data/modules/night-city-map-night-city-messenger-bridge`. Enable the module . 

Or install through Foundry with the manifest: https://github.com/Shepskii/night-city-investments/releases/latest/download/module.json

While loaded in your World, enable Night City Investments in the Module Management.

Start with [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).
See [docs/PRICE-MODEL.md](docs/PRICE-MODEL.md) for how prices move, and [docs/API.md](docs/API.md) for macros and other modules.

**Where the buttons are:** in the scene controls' **Token Controls** group (the first one), after the other buttons: "Market Terminal" (chart icon) for everyone and "Market GM Console" (sliders icon) for GMs.

## Features

- **Companies** are journal entries (in a "Night City Investments" folder). The GM creates and edits them in the GM Console, or imports the starter set of Cyberpunk RED corporations. The journal text is the public description.
- **The market ticks on the in-world clock** (the default): one tick for every set number of minutes of Simple Calendar time (the "Tick interval" setting, 10 by default; a standard 24-hour, 60-minute, 60-second day). Prices move in small steps, but everything that lasts days (a gig's delay, a sentiment change, a heat window, a broker's speed, an order's life, how long a freeze lasts) is counted in **game days**, so it takes the same time whatever the interval. The chart keeps one close per game day, and "today's move" is against the previous day's close. If you jump forward in the calendar, the market catches up a game day at a time (up to 60), so effects that fell due in the jump happen; going back only gives the market the new date. Two other modes in the "Market tick mode" setting: one tick per in-world day, and manual only. In the day mode, rolling the calendar back rolls the market back with it, one tick per day, as far as the remembered ticks allow and never past a tick that has already moved a player's money. Anything it cannot roll back leaves the market ahead of the calendar, and it waits for the date to catch up before ticking again. The GM Console's "Advance 1 / 7 / 30 ticks" buttons and "Advance 1 day" work in every mode.
- **The market has its own date.** It is the calendar date of the last tick plus the game days the GM has advanced the market by hand. Following the calendar with no hand advances, it is simply the calendar date; in manual mode it moves only when you advance the market. Dividends, fund distributions and rebalances, IPO listings and monthly statements fall due on the market date, so advancing a month by hand pays the month's dividends. The Market tab says when the market date is ahead of the calendar.
- **Orders and alerts see the whole run.** After a run of several ticks, open limit and stop orders and price alerts are checked against every price in the run, not only where it ended: a limit the price reached and left fills at the limit, a stop at its level (across the spread), and an alert reports the price that set it off.
- **Market Terminal** (scene controls):
  - Market tab: a price table with trend lines, and a company page with a chart, 52-week range, dividend terms, description, Buy / Sell buttons and a watchlist star.
  - Portfolio tab: pick a character, then see the brokerage balance, holdings, average cost, profit and loss, open and recent orders, and the account ledger. Click a holding to open that company's (or fund's) market page; "Back to portfolio" returns.
- **Brokerage balance:** a character deposits eb from their wallet (`system.wealth`) into the balance, trades with it, and withdraws back to the wallet. Every transfer is logged in the character's CPR wealth transactions and in the account ledger.
- **Orders:** market, limit and stop orders, good for the day or until cancelled. Buys fill at the ask and sells at the bid, at the price when they execute.
- **Two ways to trade** (the Trade window's "Trade through" choice):
  - **Through a broker** (cheaper, slower): the player picks a broker on the Portfolio tab. The broker's **Accounting skill** (INT + level, read from their character sheet) sets their speed (1 to 5 market days per order) and their fees (always a share of the direct fees, never more). Orders can also be mailed to the broker in Night City Messenger: `BUY 10 ARA`, `SELL 5 MIL @ 80`, `SELL ALL ARA`, `WITHDRAW 5000`, `STATUS`, `STATEMENT`, `CANCEL <ref>`, `HELP`. The broker replies and confirms fills in character.
  - **Direct** (instant, most expensive): fills in the same market tick. Needs a terminal on the **CorpNet** network (or a GM grant) and a passed **Accounting check** (INT + Accounting + 1d10 against a DV, rolled by the player when they press Connect, with a chat card). A pass opens a trading session; a fail locks the character out for a while (a fumble doubles it). Switch to "Open to everyone" in settings for no check.
- **Funds:** pooled investments over several companies. Their unit value follows the companies' prices (plus dividends, less an expense ratio). Funds can **only be traded through a broker**, at market. A skilled broker waives more of the fund's entry and exit charges and gets better timing. A fund can **rebalance** monthly or quarterly back to its original mix, and an actively **managed** fund can carry a yearly manager's edge (set in the Fund Editor).
- **Price alerts:** on the Portfolio tab, get told when a stock or fund rises above or falls below a price, or moves by a set percentage in a day. Once-only or repeating. Delivered by mail (default), chat or not at all, and always listed in the terminal.
- **Statements:** "Send me a statement" on the Portfolio tab, or mail `STATEMENT` to your broker, for a summary of value, money in and out, trading, dividends, performance and every holding. Monthly statements are opt-in.
- **Settlement and funds that pay out:** the GM can make sale proceeds take 0 to 5 days to arrive (the "Sale settlement delay (days)" setting); settling money counts towards your value but cannot be spent. A fund can have its own redemption delay, and a **distributing** fund pays its income out as cash each month or quarter instead of reinvesting it.
- **Movers and ticker:** an opt-in "Big movers" notice lists holdings that moved by your chosen percentage in a day. A per-user "Show the market ticker strip" setting adds a price strip to the page: the NC index plus up to four companies you have starred, or the day's biggest movers if you have none.
- **Broker voices:** a broker whose character sheet has a Personality (any of the ten from the Cyberpunk RED table) writes to you in that voice: a greeting, a line that fits the situation (a sale at a profit, a rejected order, a payout, a rumour...), the facts, and a sign-off, all varied from one mail to the next. A broker with no sheet, or no recognised Personality, keeps the standard wording. The GM sees each broker's voice in the Brokers tab.
- **Insider-trading heat (off by default):** with "Track insider-trading heat" on, the module watches for trades on a gig's client in the gap before the effect shows on the price, and records a hidden heat score per character (halving about weekly) in the GM Console's Heat tab. Players cannot see it. With "Warn and penalise suspicious trading" on (the default once heat is tracked), rising heat brings a nervous word from the player's broker, then an enquiry from NCPD Financial Crimes, with slower and dearer broker orders while flagged. At the top a fine, a frozen account or a dropped broker waits in the Heat tab for you to approve, change or dismiss (turn "GM approves penalties" off to apply them at once). A warned player can try to cover their tracks from their portfolio tab, each attempt a skill roll (Trading, Accounting, Business or Bribery) that costs eddies whether or not it works.
- **Withdrawals:** with a broker, a withdrawal is held at once, takes the broker's delay, and is paid as claimable eddies in a Night City Messenger mail (cancellable before then; refunded if the mail cannot be sent). With no broker it goes straight to the wallet.
- **Notifications** are opt-in per player and per category (order results, dividends, price alerts, monthly statement, big movers, rumours, market headlines, daily digest), by mail, chat or off. Broker withdrawal payouts are always mailed.
- **Gig outcomes (needs the bridge module):** when a gig is completed or failed in Night City Map, the client's company reacts after one to three days. A failure moves the price more than a success, and a bigger reward moves it further. The GM approves each impact by default, and a client that cannot be matched waits to be mapped. See "Gig outcomes" below.
- **Player syndicates:** a crew pools money in a shared brokerage account. A player founds one from the terminal's Portfolio tab and invites the others; members pay in from their own brokerage balances and hold units in it at its value per unit. Officers trade its account from the terminal like their own (picking "*syndicate* (as *character*)" in the character list), up to a limit; bigger orders, admitting or removing members, making officers, changing the limit and dissolving go to a vote by units. Members redeem units at their value after the settlement delay. Its heat is collective: it counts as knowing whatever any member knows. A syndicate can also be a business partner or owner: its officers run its stake from the Business window, rolling with their own skills, paying from its account (cash only) and voting for it; payments over the officers' limit go to the members first, and its business stakes count in its value. The limit is each officer's per game day, and members are mailed by Night City Messenger when a proposal opens or is decided, and when their redemption is paid. The GM approves new syndicates (a setting) and can pass or veto any proposal in the GM Console's Syndicates tab.
- **Player businesses (side and registered businesses so far):** in the **Business** window (its own scene-control button, apart from the terminal), a character founds a small business (ten kinds, from a ripperdoc clinic or a garage to a gun shop or a food stall) in one of Night City's districts, which set its foot traffic, rent and risk, puts in eddies and gear (items dragged from the character's sheet, the Items directory or a compendium, valued at their market price; an item from the sheet moves into the business and comes back if it never opens), and invites partners, who put in their own. Units follow what each partner put in, with an optional sweat-equity slice. Once everyone has answered, any partner makes the **setup roll**, which sets the setup cost and the Capacity it opens with; the GM approves it by default. Each **operating week** (closing on the weekday set in the settings) has one action slot: Work the shop, Promote, Source supplies, Fix the place up or Keep it safe. Partners who do not take the slot can make a **complementary check** for +1. Every roll is the player's to make, with a dialog that shows the DV and the chance of each result before rolling, and the levers: Careful, Standard or Bold, Luck, the +1, or a hired professional paid from the business's cash. The week's takings go into the business's cash, and each partner may draw their share of last week's profit. A partner who leaves can be bought out at book value, or the stake passes to their named heir; closing needs every partner, and cash below zero for two weeks closes it anyway. Each week may bring an event (a shakedown, a breakdown, a rival, an inspection, a big order...) that a partner answers with a slot and a roll, or lets cost the week's takings. Expansions, agreed by a majority and finished with business days (three a week each), raise Capacity. When the checklist is met and every partner agrees, a registration roll makes it a registered business: two slots, lower protection money, dearer rent and licences, and a Compliance standing. Money from outside: a fixer's loan, a bank loan for a registered business (rolled), an investor the partners invite, or an angel won with an opposed pitch. Stakes show, read-only, in the terminal's Portfolio tab, and a gig run for the players' own business changes its Reputation and takings once the GM approves it. Chartering a company comes next (DESIGN §26.9).
- **Market GM Console** (GM only), in ten tabs:
  - Market: advance the clock, reset, and steer the market with sentiment biases (market, sector or company, with a duration and optional fade-out), a forced regime, a volatility multiplier, and a market-wide halt.
  - Events: queue a one-off shock with a delay and a persistence level, optionally with a public headline; script a **glide** that steers a company to a target price over N days; post headlines; set a price directly; see a log of recent GM actions.
  - **Preview** (Market and Events tabs): before applying a bias, shock or glide, press its Preview button and see the range of outcomes over 200 simulated futures, with and without it. The result opens directly below that button, and the button then reads "Close preview": press it again to close.
  - **Undo last tick** (Market tab): step the market back one tick. Refused once a player's money has moved because of that tick, or after a split, price change or new company. Advancing again re-runs the tick.
  - Corporate actions: special dividends, stock splits, buyouts, delistings and bankruptcies. Each one updates the market, every player's portfolio and the news.
  - Companies: create, edit, delete and import companies. A company can be launched later with an **IPO**: untick Listed, set a listing date, an offer price, a subscription window and an optional share cap. Players subscribe from the Market tab; the listing fills subscriptions pro rata if oversubscribed. "List now" launches it early.
  - Funds: create, edit, close (holders are paid out) and import funds.
  - Brokers: make a character or an NCM contact a broker, set a rating for contacts with no sheet, a minimum withdrawal, enable or disable, remove (only when no character is using them, or has orders or a withdrawal with them; the character and the NCM contact are not changed, and you can make them a broker again), and grant terminal access to characters.
  - Gigs: approve, edit or discard queued gig impacts; map unknown clients to companies; report an outcome by hand; see recent gig outcomes.
  - Heat: each character's hidden insider-trading heat, penalties waiting for approval, open watch windows and recent audits.
  - Businesses: every player business with its true state (Exposure included), businesses waiting for approval, the buy-out rule for a partner who has left the table, and a button to open any business in the Business window.
  - **Tools:** a **self-check** that looks over companies, funds, the market, portfolios and the Night City Messenger link and lists anything broken or odd (nothing is changed); a button that creates the starter **macros**; **companies to consider**, which lists organisations named on NCM contacts and gigs that are not on the market yet, so you can create one in a click (or ignore it); and the **recent trades** across every portfolio.
- **Macros and keys:** the Tools tab makes macros for opening the terminal, the Business window and the console, advancing a tick and running the self-check. Foundry only lets Trusted players and above run script macros, so players can also use the scene-control buttons. All three windows can also be given a key in Configure Controls (unbound by default).
- **Updates look after your data.** Each release that changes how data is stored brings existing worlds up to date by itself when the GM loads in (the Tools tab shows the version). It only adds missing fields and never removes anything.
- **Dividends:** each company has a policy (none, fixed per share, or a yield), a frequency and a payout day, and pays on the market date. Each period is paid once. Shares bought on the declaration tick do not qualify. Players can switch on reinvestment per holding.
- **Splits** can be automatic when a price reaches a threshold set in the Company Editor. Charts, cost basis and open orders are adjusted so nothing jumps.
- **News tab:** dividend, split, buyout, bankruptcy and halt headlines appear automatically, plus anything the GM posts.
- **GM runs the show.** Players never write portfolios. A player's action is saved as a request on their own character, and the active GM's client carries it out. If no GM is online, requests wait and run when one connects.
- Fair value and the true market regime are hidden from players. They are stored in a GM-only journal named "NCI GM Control". Do not give players access to it.

## Setting up brokers and direct trading

1. In the GM Console's **Brokers** tab, make a character a broker ("Make broker from character") or tag an existing NCM contact. A character's Accounting skill is read from their sheet (an `Accounting` skill item and their INT). A contact with no sheet uses a rating you set.
2. Players choose a broker on the Portfolio tab, and can then mail them from Night City Messenger.
3. For direct trading, a player's device must be connected to the CorpNet network in Night City Messenger (the network id is a setting), or you grant the character terminal access in the Brokers tab, then they press "Connect to the market terminal" on the Portfolio tab. Settings control the commission, flat fee, DV, session length and lockout.

The CorpNet connection is held in the player's browser by Night City Messenger, so the module reads it on the player's client and trusts it (the usual table-trust trade-off). The Accounting roll is made by the player on their own client, when they press Connect. The GM's side reads the dice back from the roll's chat card and uses its own copy of the character's stat, skill and the DV, so a request cannot supply a total, and a card can be used only once. The same goes for the cover-up rolls.

## Gig outcomes

Install and enable [night-city-map-night-city-investments-bridge](https://github.com/Shepskii/night-city-map-night-city-investments-bridge) alongside [Night City Map](https://github.com/samroaleksej-bit/night-city-map). It reports each gig you mark Completed or Failed. Then in the GM Console's **Gigs** tab:

- **Needs a company:** a client that does not match any company by name, ticker or alias waits here. Pick a company (or "Ignore this client"). The choice is saved, and settles every other waiting gig from the same client. Add aliases in the Company Editor to avoid most of this.
- **Waiting for approval:** the default. Change the size, the delay or the headline, then approve. Turn "GM approves gig impacts" off in settings to apply a confidently matched client at once; a near-miss spelling or a company only mentioned in the gig text always waits for you.
- **Size and timing:** about +1.5% for a 1,000 eb job and more for bigger ones, a failure 1.3 times as strong, up to 8% before the "Gig impact strength" setting. Several gigs on one company in a week have a diminishing effect. The effect shows one to three days later, and a generic headline that never gives the gig away is published when it does.
- **Notes tag:** a gig you wrote yourself has no client field, so add `[NCI: ARA]` to its GM notes to name the company, or `[NCI: ignore]` to skip it.
- **Rumours (optional):** turn on "Mail rumours before a gig shows in the price" and players who hold or watch the company, and have switched on "Rumours" in their notifications, get a vague mail first. It comes from their own broker, in the broker's voice, or from the market wire if they have none. Players who have switched on "Market headlines" also get the gig's headline from their broker rather than the wire.

Each gig can move the market only once, whatever happens to the bridge. Gigs that were already finished before the bridge was installed are not reported; use "Report an outcome by hand".


## Development

The price engine in `scripts/engine/` has no Foundry dependencies, so it runs and tests in Node (v20 or newer). The template test renders the real windows with Handlebars, so run `npm install` once first (it only installs a dev dependency).

```
node --test                  # unit tests (or: npm test)
node tools/simulate.mjs      # Monte-Carlo calibration report (or: npm run simulate)
node tools/simulate.mjs --seeds 500 --ticks 730
```

To try the module in Foundry, place this folder in your `Data/modules/` directory and enable it in a Cyberpunk RED world. Open the GM Console from the Token Controls group in the scene controls, import the starter corporations, and the market opens at the next tick.

## Layout

```
scripts/engine/    pure price model, orders, portfolio, request executor, cash, dividends, funds, broker terms, skill checks, mail parser
scripts/data/      company journals, market store, portfolio, broker and fund repositories, starter companies and funds
scripts/services/  tick service, portfolio executor/client/watcher, broker mail, notifications, fund service, skill and terminal access, wealth adapter, market clock, import, migrations, diagnostics, macros
scripts/integrations/  the one door to Night City Messenger (mail, contacts, networks)
scripts/core/      initializer, settings
scripts/init/      startup registration (settings, API, scene controls, market, broker and tools systems)
scripts/ui/        ApplicationV2 windows (Market Terminal, GM Console, Company Editor, Fund Editor, Trade dialog)
tools/             simulate.mjs calibration harness
tests/             unit tests, plus an integration test against a fake Foundry runtime
docs/              GETTING-STARTED.md, PRICE-MODEL.md, API.md, DESIGN.md
```

## License

MIT
