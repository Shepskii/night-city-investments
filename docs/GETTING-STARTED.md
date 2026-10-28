# Getting started

A short path from a fresh install to a market your players can trade on. For the full feature list see the [README](../README.md).

## What you need

- Foundry VTT v12, the Cyberpunk RED Core system, and Night City Messenger (NCM). NCM carries every mail, and broker contacts live in its directory.
- Optional: Night City Map and the [Night City Map bridge](https://github.com/Shepskii/night-city-map-night-city-investments-bridge), so completed and failed gigs move share prices.

After installing or updating, hard-reload your browser (Ctrl+Shift+R). Foundry does not cache-bust module scripts.

## Set up the market (about five minutes)

1. **Open the GM Console.** In the scene controls, choose the Token Controls group and press the sliders button, "Market GM Console".
2. **Companies tab: "Import starter corporations".** That adds twenty Cyberpunk RED corporations as journal entries (in a "Night City Investments" folder). Edit or delete any of them, or press "New company" to add your own. The journal text is the public description players read.
3. **Funds tab: "Import starter funds".** That adds six pooled funds (two indexes, two sector funds, a managed fund and a themed one). The NC12 holds only the twelve largest corporations.
4. **Pick how time passes.** By default the market ticks on the in-world clock: one tick for every 10 minutes of Simple Calendar time (change "Tick interval" in module settings), so it keeps pace however fast the calendar runs. If you jump forward in the calendar, the market catches up a game day at a time, and going back only gives it the new date. "Market tick mode" also offers one tick per in-world day (which rolls back if you roll the date back), or manual only. Either way you can press "Advance 1 tick" or "Advance 1 day" in the Market tab.
5. **Brokers tab: add at least one broker.** Pick a character ("Make broker from character") or tag an NCM contact. A broker's Accounting skill sets how fast and how cheap they are. A character with a Personality on their sheet writes in that voice.
6. **Tools tab: run the self-check** (and "Create macros" if you want them). A clean self-check means the companies, funds, prices and portfolios agree with one another.

The market opens at the next tick. Press "Advance 1 tick" once to start it.

## What your players do

1. Open the **Market Terminal** (scene controls, chart button).
2. On the **Portfolio** tab, choose a character, then **deposit** eddies from their wallet into the brokerage balance.
3. Pick a **broker** (cheaper, slower) or connect to a **CorpNet terminal** for direct trading (instant, dearer, needs an Accounting check). Funds can only be traded through a broker.
4. **Buy and sell** from a company's page. Orders can be market, limit or stop, good for a day or until cancelled.
5. Optional, per player: switch on notifications (order results, dividends, price alerts, statements, rumours, headlines) in the Portfolio tab. Players can also mail their broker: `BUY 10 ARA`, `SELL ALL MIL`, `STATUS`, `HELP`.

A GM must be online for orders to be processed. If none is, requests wait in the player's outbox and run when one connects.

## Running the market during a game

| You want to... | Use |
|---|---|
| Move time on | Market tab: Advance 1, 7 or 30 ticks. Or let the calendar clock do it |
| Nudge the whole market, a sector or one company | Market tab: sentiment bias (with a duration and a fade) |
| Make a storm or a boom | Market tab: force a regime. Volatility: multiplier. Halt: pause trading |
| Make a story event hit a company | Events tab: a shock with a delay (and a public headline), or a glide to a target price |
| See what a nudge will do before you commit | The **Preview** button next to bias, shock and glide |
| Take back a tick | Market tab: Undo last tick (refused once a player's money has moved because of it) |
| Pay a special dividend, split, buy out, delist or bankrupt a company | Corporate actions tab |
| Launch a new company | Companies tab: untick Listed, set an IPO date, price and window |

Prices move a little each tick, but anything that takes days (a gig's delay, a sentiment change, a heat window) runs on game days, not ticks. "Advance 30 ticks" in the Market tab is therefore about five hours of game time at the default interval, not 30 days; use **Advance 1 day** to move a whole game day at once. If you jump forward in Simple Calendar, the market catches up a game day at a time, so effects that fell due in the jump happen. Going back only gives the market the new date.

## Gigs and insider trading (optional)

With the Night City Map bridge installed, a gig marked Completed or Failed queues a price impact on its client's company in the **Gigs** tab. You approve it (the default) or let the module apply it, and the price reacts a few days later. The Gigs tab also handles clients that do not match any company: map them once and the choice is remembered.

Turn on "Track insider-trading heat" to watch for characters who trade a gig's client in the gap before the news shows in the price. The **Heat** tab shows each character's hidden heat. With "Warn and penalise suspicious trading" on, brokers and NCPD Financial Crimes send warnings, and the worst offenders face a fine, a frozen account or a dropped broker that you approve first. Warned players can try to cover their tracks with skill rolls. Players never see the number.

## Housekeeping

- **Self-check** (Tools tab, or the "NCI: Self-check" macro, or `game.nightcity.investments.verify()` in the console): lists problems such as a fund that holds a deleted company, a negative balance, or a company with no price.
- **Companies to consider** (Tools tab): organisations from NCM contacts and gigs that are not on the market. Create one with the name and a ticker already filled in, or ignore it.
- **Recent trades** (Tools tab): the latest fills across all portfolios.
- **Resetting the market** (Market tab) erases prices and history and starts every company again from its initial price. Player portfolios are kept.
- **Updating:** a new release upgrades stored data on its own the first time the GM loads in. See the Tools tab for the version.
- **Do not give players access** to the journal named "NCI GM Control". It holds the hidden fair values, the true market regime and heat.
