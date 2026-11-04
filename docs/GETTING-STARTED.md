# Getting started

From a fresh install to a market your players can trade on, then every setting explained. For what players do, see the [player guide](PLAYER-GUIDE.md); for running it at the table, the [GM guide](GM-GUIDE.md).

## What you need

**Required**
- Foundry VTT v12
- Cyberpunk RED Core
- [Night City Messenger](https://github.com/christinophrappuccino/night-city-messenger): carries every mail, broker contact and payslip

**Optional**
- [Night City Map](https://github.com/samroaleksej-bit/night-city-map) with the [Night City Map – Night City Investments bridge](https://github.com/Shepskii/night-city-map-night-city-investments-bridge), so completed and failed gigs move share prices
- [Night City Map - Night City Messenger Bridge](<https://github.com/Shepskii/night-city-map-night-city-messenger-bridge>): for gig briefings, outcomes, completion payments and night market access messages to players 
- [Simple Calendar](<https://github.com/vigoren/foundryvtt-simple-calendar>), for the in-world clock the market ticks on
- [Pneuma's Crew Tools](<https://github.com/GMPneuma/PneumaCrewTools>), for linking downtime to business actions
- [Pneuma's Visual Tools](<https://github.com/GMPneuma/PneumaVisualTools>), for visual themes

## Install

1. In Foundry's **Add-on Modules**, choose Install Module and paste the manifest URL: `https://github.com/Shepskii/night-city-investments/releases/latest/download/module.json`. Or unzip a release into `Data/modules/night-city-investments`.
2. In your world, enable **Night City Investments** (and Night City Messenger) in Manage Modules.
3. After installing or updating, every user should hard-reload their browser (Ctrl+Shift+R). Foundry loads module code at login, so a client that has not reloaded keeps the old version.

## Where the buttons are

In the scene controls, the **Token Controls** group (the first one) gains:

- **Market Terminal** (chart icon), for everyone: trading, portfolios and syndicates.
- **Business** (shop icon), for everyone: player businesses (hidden when player businesses are turned off).
- **Market GM Console** (sliders icon), for GMs only.

Each window can also be given a key in Configure Controls, and the GM Console's Audit tab (under Tools) makes macros for them.

## First-time setup (about five minutes)

1. **Open the GM Console.**
2. **Companies tab: Import starter corporations.** This adds twenty Cyberpunk RED corporations as journal entries in a "Night City Investments" folder. Edit or delete any of them, or press New company. The journal text is the public description.
3. **Funds tab: Import starter funds.** This adds six pooled funds: two indexes, two sector funds, a managed fund and a themed one.
4. **Brokers tab: add at least one broker.** Make a character a broker, or tag a Night City Messenger contact. A broker's Accounting skill sets how fast and how cheap they are, and a character with a Personality on their sheet writes in that voice.
5. **Check the settings** below, especially the market clock and the business week.
6. **Tools > Audit: run the self-check**, and press Create macros if you want them. A clean self-check means the companies, funds, prices and portfolios agree.
7. **Market tab: Advance 1 tick.** The market opens.

**One rule for the GM:** do not give players access to the journal named **"NCI GM Control"**. It holds the hidden state: fair values, the true market regime, insider-trading heat, businesses' Exposure and staff traits. (It is hidden from play, not secret: a player at the browser's developer console could still read it.)

A GM must be online for anything players do to happen. Requests wait in the player's outbox until one connects.

## Settings

All are world settings, set by the GM in Configure Settings → Night City Investments, unless marked *per user*.

### The market clock

| Setting | Default | What it does |
|---|---|---|
| Market tick mode | In-world clock | **In-world clock:** one tick every set number of in-world minutes. A jump forward in the calendar is caught up a game day at a time; going back just takes the new date. **In-world day:** one tick per day the calendar moves, and rolling the date back rolls the market back. **Manual:** only when the GM advances it. |
| Tick interval (in-world minutes) | 10 | For the in-world clock: how finely prices move. Anything that lasts days (a gig's delay, a broker's speed, a heat window) is counted in game days, so this does not change how long things take. |

Advancing the market by hand moves the calendar with it, except in manual mode. The **market date** is what dividends, fund payouts, IPOs and statements fall due on. If a world's market has got ahead of its calendar, the Market tab says so and offers to close the gap.

### Trading

| Setting | Default | What it does |
|---|---|---|
| Direct trading access | Terminal | **Terminal:** direct trades need a CorpNet connection and a passed Accounting check. **Open:** anyone may trade directly, with no check. |
| Direct order execution | Next tick | Only with Open access: fill a direct trade at the next tick, or at once at the current quote. |
| Direct trading commission (basis points) | 200 | The commission on direct trades (100 = 1%). Brokers charge a share of it. |
| Direct trading flat fee (eb) | 5 | Charged on every direct trade; brokers charge less. |
| Terminal check DV | 13 | The DV for INT + Accounting + 1d10 to open a direct trading session. |
| Terminal network | CORPNET | The Night City Messenger network a device must be on to trade directly. |
| Session length (market days) | 1 | How long a passed check keeps direct trading open. |
| Lockout after a failed check (market days) | 1 | How long a failed check locks a character out (a fumble doubles it). |
| Deposit fee (eb) | 0 | A flat fee on each deposit into a brokerage balance. |
| Sale settlement delay (days) | 0 | How long sale proceeds take to become spendable. |
| Broker order handling | Auto | **Auto:** mailed orders run after the broker's delay. **Manual:** each waits in the GM's queue. |
| Show the market ticker strip | Off | *Per user.* A price strip at the top of the screen. |

### Gigs and insider trading

| Setting | Default | What it does |
|---|---|---|
| Gig outcomes move the market | On | Needs the bridge. Off ignores completed and failed gigs. |
| GM approves gig impacts | On | Impacts wait in the Gigs tab for approval. Off applies confident matches at once. |
| Gig impact strength | 1 | Scales every gig impact (1: a 1,000 eb job moves its client about 1.5%). |
| Mail rumours before a gig shows in the price | Off | Players who hold or watch the client, and have turned on rumours, get a vague mail first. |
| Track insider-trading heat | Off | Records a hidden heat score for trades placed ahead of news (gigs, and listed player companies' reports). |
| Heat strength | 1 | Scales how much heat each suspicious trade adds. |
| Warn and penalise suspicious trading | On | With heat tracked: broker warnings, NCPD enquiries, slower brokers while flagged, and penalties at the top. Off only records heat. |
| GM approves penalties | On | Fines, freezes and dropped brokers wait in the Heat tab for you. |

### Player businesses

| Setting | Default | What it does |
|---|---|---|
| Player businesses | On | The Business window and businesses' weekly closes. Off stops them; nothing is deleted. |
| New businesses need GM approval | On | A business that has passed its setup roll waits in the Businesses tab until you let it open. |
| Business week ends on | Monday | Every business's week closes on the first market tick on or after this weekday. The day of your weekly session works well. With Simple Calendar, its own weekdays are used. |
| Business growth rate | 1 | How fast businesses build Reputation and Capacity; 1.5 suits a campaign that wants them to grow sooner. |
| Payslips by Messenger | On | A player character who works for a player business gets a weekly payslip mail with their wage attached to claim. Off pays it straight to their sheet. |
| Listing threshold (eb) | 500,000 | The market valuation a chartered company must hold on three monthly reports before it can apply to list. Lower it to let companies list sooner. |

### Syndicates

| Setting | Default | What it does |
|---|---|---|
| Player syndicates | On | Players may found syndicates. Off refuses new requests; existing ones keep their holdings. |
| New syndicates need GM approval | On | A founded syndicate waits in the Syndicates tab; no money can be paid in until you approve. |
| Mail syndicate members | On | Members are mailed when proposals open and are decided, payments fail, redemptions are paid, and on wind-up. |

### Other

| Setting | Default | What it does |
|---|---|---|
| Debug logging | Off | *Per user.* Extra diagnostics in the browser console. |

## Keeping it healthy

- **Self-check** (Audit tab, the "NCI: Self-check" macro, or `game.nightcity.investments.verify()` in the console) lists problems such as a fund holding a deleted company or a negative balance. It changes nothing.
- **Updates** bring stored data up to date by themselves the first time the GM loads in; the Audit tab shows the data version.
- **Resetting the market** (Market tab) restarts prices and history from each company's initial price. Portfolios are kept.
- If something a player did seems ignored after an update, check that the GM's client has reloaded.
