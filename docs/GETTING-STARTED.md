# Getting started

From a fresh install to a market your players can trade on, then every setting explained. For what players do, see the [player guide](PLAYER-GUIDE.md); for running it at the table, the [GM guide](GM-GUIDE.md).

## What you need

**Required**
- Foundry VTT v12
- Cyberpunk RED Core
- [Night City Messenger](https://github.com/christinophrappuccino/night-city-messenger): carries every mail, broker contact and payslip

**Optional**
- [Night City Map](https://github.com/samroaleksej-bit/night-city-map) with the [Night City Map – Night City Investments bridge](https://github.com/Shepskii/night-city-map-night-city-investments-bridge), so completed and failed gigs move share prices, and each open player business gets a pin on the map
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

Each window can also be given a key in Configure Controls, and the GM Console's Audit tab (under Tools) makes macros for them. Foundry only lets Trusted players and above run script macros, so other players use the buttons.

## First-time setup

### The market (about five minutes)

1. **Open the GM Console.**
2. **Companies tab: Import starter corporations.** This adds twenty Cyberpunk RED corporations as journal entries in a "Night City Investments" folder. Edit or delete any of them, or press New company. The journal text is the public description.
3. **Funds tab: Import starter funds.** This adds six pooled funds: two indexes, two sector funds, a managed fund and a themed one.
4. **Brokers tab: add at least one broker.** Make a character a broker, or tag a Night City Messenger contact. A broker's Accounting skill sets how fast and how cheap they are, and a character with a Personality on their sheet writes in that voice.
5. **Check the settings** below, especially the market clock and the business week.
6. **Market tab: Advance 1 tick.** Prices start to move. In the In-world day mode a tick is a whole day, so this moves the calendar on a day as well.
7. **Tools > Audit: run the self-check**, and press Create macros if you want them. A clean self-check means the companies, funds, prices and portfolios agree.

**One rule for the GM:** do not give players access to the journal named **"NCI GM Control"**. It holds the hidden state: fair values, the true market regime, insider-trading heat, businesses' Exposure and staff traits. (It is hidden from play, not secret: a player at the browser's developer console could still read it.)

A GM must be online for anything players do to happen. Requests wait in the player's outbox until one connects.

### Player businesses (a few minutes more)

Skip this if you turn **Player businesses** off.

1. **Choose the week's end.** Set **Business week ends on** to the day of your weekly session.
2. **Tools > Factions: Import starter factions.** This adds 20 corporations and 13 Night City gangs, by district, to edit as you like. Until there are factions, **Court a client** and **Pay respects** aren't offered, and no gangs sit on anyone's turf.
3. **Decide about the underworld.** **Underworld content** is on by default, which lets businesses open back rooms and make illegal goods, and lets companies commit crime. Turn it off for a game that stays legal.
4. **Tools > Production: check what each business type can make.** The defaults come from the system's compendiums. Nothing is illegal until you mark it, so mark what counts as illegal in your game, such as hard drugs.
5. **Make NPCs hireable, if you want them.** Tag an NPC's Night City Messenger contact `staff` or `employee`. Players can also hire generated recruits, and each other's characters, with nothing to set up.
6. **With Pneuma's Crew Tools active,** business days come from downtime, so characters have none to spend until you act. Award days as usual, and open Downtime once for each character. Or turn off **Business days come from Crew Tools downtime** to give each voting partner 3 business days a week instead.

## Settings

All are world settings, set by the GM in Configure Settings → Night City Investments, unless marked *per user*.

### The market clock

| Setting | Default | What it does |
|---|---|---|
| Market tick mode | In-world clock | **In-world clock:** one tick every set number of in-world minutes. A jump forward in the calendar is caught up a game day at a time; going back just takes the new date. **In-world day:** one tick per day the calendar moves, and rolling the date back rolls the market back. **Manual:** only when the GM advances it. |
| Tick interval (in-world minutes) | 10 | For the in-world clock: how finely prices move. Anything that lasts days (a gig's delay, a broker's speed, a heat window) is counted in game days, so this does not change how long things take. |

In both the in-world modes the market only moves when in-world time passes, so a stopped calendar means a still market. Advancing the market by hand moves the calendar with it, except in manual mode, so in-world time passes for everything that reads the calendar. The **market date** is what dividends, fund payouts, IPOs and statements fall due on. If a world's market has got ahead of its calendar, the Market tab says so and offers to close the gap.

### Trading

| Setting | Default | What it does |
|---|---|---|
| Direct trading access | Terminal | **Terminal:** direct trades need a CorpNet connection and a passed Accounting check. **Open:** anyone may trade directly, with no check. |
| Direct order execution | Next tick | Only with Open access: fill a direct trade at the next tick, or at once at the current quote. |
| Direct trading commission (basis points) | 200 | The commission on direct trades (100 = 1%). Brokers charge a share of it. |
| Direct trading flat fee (eb) | 5 | Charged on every direct trade; brokers charge less. |
| Terminal check DV | 13 | The DV for INT + Accounting + 1d10 to open a direct trading session. |
| Terminal network | CORPNET | The Night City Messenger network a device must be on to trade directly. With Messenger's Network simulation off, everyone counts as connected. |
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
| Business week ends on | Monday | Every business's week closes on the first market tick on or after this weekday. The day of your weekly session works well. With Simple Calendar, its own weekdays are used. A calendar whose weekdays restart each month makes a week close early at the month's end; takings, wages and upkeep scale down to match. |
| Business growth rate | 1 | How fast businesses build Reputation and Capacity; 1.5 suits a campaign that wants them to grow sooner. |
| Payslips by Messenger | On | A player character who works for a player business gets a weekly payslip mail with their wage attached to claim. Off pays it straight to their sheet. |
| Listing threshold (eb) | 500,000 | The market valuation a chartered company must hold on three monthly reports before it can apply to list. Lower it to let companies list sooner. |
| Business days come from Crew Tools downtime | On | Needs Crew Tools. On: extra time, project days and mentoring spend a character's downtime, with no weekly allowance. Off: 3 business days a week for each voting partner. |
| Underworld content | On | Lets a business open a back room and make illegal items, and a company commit crime. Off: nothing new opens, and illegal lines stop. A back room already open keeps running, and goods already made can still be fenced. |
| Share contacts with players | On | A character who picks a broker, or founds a business with an NPC partner, gets that person in their Night City Messenger contacts. Contacts already shared stay if you turn it off. |
| Back room events | Normal | How often a back room that was worked last week draws trouble of its own: Rare, Normal or Often. |
| Smears, leaks and stories need GM approval | On | A business's successful campaign, or a Media's believed story, waits on the Pending tab until you let it run. Off: they run at once. |

### Syndicates

| Setting | Default | What it does |
|---|---|---|
| Player syndicates | On | Players may found syndicates. Off refuses new requests; existing ones keep their holdings. |
| New syndicates need GM approval | On | A founded syndicate waits in the Syndicates tab; no money can be paid in until you approve. |
| Mail syndicate members | On | Members are mailed when proposals open and are decided, payments fail, redemptions are paid, and on wind-up. |

### Other

| Setting | Default | What it does |
|---|---|---|
| Date format | DD-MM-YYYY | How dates show in this module's windows and mails, for everyone: DD-MM-YYYY, YYYY-MM-DD or MM-DD-YYYY. Mails already sent keep the format they had. |
| Colour theme | Night City red | *Per user.* With Pneuma's Visual Tools, match its skins and colours in this module's windows and ticker. Stays red if none is active. |
| Debug logging | Off | *Per user.* Extra diagnostics in the browser console. |

## Keeping it healthy

- **Self-check** (Audit tab, the "NCI: Self-check" macro, or `game.nightcity.investments.verify()` in the console) lists problems such as a fund holding a deleted company or a negative balance. It changes nothing.
- **Updates** bring stored data up to date by themselves the first time the GM loads in; the Audit tab shows the data version.
- **A market ahead of its calendar** can come from hand advances on a version before 0.21.0. The Market tab says by how many days, and **Move the calendar on** closes the gap. It moves the calendar only, and nothing happens until you press it.
- **Resetting the market** (Market tab) restarts prices and history from each company's initial price. Portfolios are kept.
- If something a player did seems ignored after an update, check that the GM's client has reloaded.
