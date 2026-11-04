# Night City Investments

A living stock market for Cyberpunk RED in Foundry VTT. Characters trade corporate shares and funds through brokers or a CorpNet terminal, pool money in syndicates, and build their own businesses from a back-alley side hustle into a listed company. The GM steers the market, and gigs from Night City Map can move share prices.

## Requirements

- Foundry VTT v12
- Cyberpunk RED Core
- [Night City Messenger](https://github.com/christinophrappuccino/night-city-messenger): carries every mail, broker contact and payslip

Optional:
- [Night City Map](https://github.com/samroaleksej-bit/night-city-map) with the [Night City Map – Night City Investments bridge](https://github.com/Shepskii/night-city-map-night-city-investments-bridge), so completed and failed gigs move share prices
- [Night City Map - Night City Messenger Bridge](<https://github.com/Shepskii/night-city-map-night-city-messenger-bridge>): for gig briefings, outcomes, completion payments and night market access messages to players 
- [Simple Calendar](<https://github.com/vigoren/foundryvtt-simple-calendar>), for the in-world clock the market ticks on
- [Pneuma's Crew Tools](<https://github.com/GMPneuma/PneumaCrewTools>), for linking downtime to business actions
- [Pneuma's Visual Tools](<https://github.com/GMPneuma/PneumaVisualTools>), for visual themes

## Installation

Install through Foundry with the manifest URL:

```
https://github.com/Shepskii/night-city-investments/releases/latest/download/module.json
```

Or unzip a release into `Data/modules/night-city-investments`. Then enable **Night City Investments** in your world's Module Management.

## Documentation

| Guide | For |
|---|---|
| [Getting started](docs/GETTING-STARTED.md) | Installing, first-time setup and every setting |
| [Player guide](docs/PLAYER-GUIDE.md) | The market and syndicates, running a business from founding to listing, and the underworld |
| [GM guide](docs/GM-GUIDE.md) | Steering the market, approving and checking players' actions, and the hidden state |
| [Price model](docs/PRICE-MODEL.md) | How prices move |
| [API](docs/API.md) | Macros and other modules |
| [Design log](docs/DESIGN.md) | The design and how each phase was built, with the roadmap |

## Features

### The market
- **Companies as journal entries.** Import a starter set of twenty Cyberpunk RED corporations and six funds, or write your own. The journal text is the public description.
- **Prices that behave like a market.** A market factor, sectors, regimes (calm, boom, storm), noise and a hidden fair value move each company. The market ticks on the in-world clock, a tick per day, or by hand, and catches up when the calendar jumps forward.
- **Dividends, splits and IPOs.** Each company has a dividend policy, and automatic splits keep high prices tradable. The GM can launch new companies with a subscription window.
- **News.** A public feed carries market headlines, corporate actions and anything the GM posts.

### Trading
- **The Market Terminal.** It has a price table, company pages with charts, a watchlist, and a Portfolio folder with holdings, profit and loss, orders and the account ledger.
- **A brokerage balance.** Characters move eddies from their sheet into a trading account and back, and every move is logged.
- **Brokers or a CorpNet terminal.** A broker is a character or a Messenger contact. Their Accounting skill sets how quickly and how cheaply they trade, and they answer mailed orders (`BUY 10 ARA`) in their own voice. Direct trading is instant and dearer, and it needs a CorpNet connection and an Accounting check.
- **Orders, funds, alerts and statements.** Place market, limit and stop orders. Funds are pooled and traded through brokers. Price alerts, monthly statements and opt-in notifications are delivered by mail or chat.

### Syndicates
- **Pooled accounts.** A crew pays into one brokerage account and holds units in it. Officers trade it up to a daily limit, and anything bigger goes to a vote by units. Members redeem their units at the account's value.
- **Business partners.** A syndicate can own or invest in a player business, with its officers acting for it.

### Player businesses
- **Start small.** Found one of ten kinds of business (a ripperdoc clinic, a garage, a bar, a gun shop...) in a Night City district, with partners, eddies and gear from your sheet.
- **A weekly loop.** Each week you choose actions and make skill rolls, with Careful, Standard or Bold approaches, Luck, help and hired professionals. Then come the takings, upkeep and events, and partners draw their share of the profit.
- **Grow it.** Projects improve the premises. Loans and investors bring in money. Registration, a charter, then a company with officers and monthly reports.
- **Employees.** Hire player characters, NPCs or recruits into roles, and pay them weekly. NPC staff have loyalty, hidden traits, training, share grants and their own events.
- **Go public.** List the company on the market through an IPO. Shares then sit in portfolios, reports move the price, and dividends follow a payout ratio the shareholders vote. A daily liquidity cap and a delisting review keep it honest.
- **Corporate play.** Issue new shares, buy shares back, bid for another company with a tender offer, survive (or not) administration when debts outgrow assets, hide behind nominees and shell companies while rivals dig, and answer to regulators when shortcuts leave a trail.

### Production
- **Workshops.** Most kinds of business can build benches and make real items from the system's compendiums, by the rulebook's Fabrication table: its DVs, its times and its materials costs.
- **A storeroom you can see.** What you make sits on a sheet of real items that those running the business can look at, with the money kept on the business's record. Hire a Maker to run the line when no partner does.
- **Selling it.** The shop sells stock each week up to a limit set by takings and Reputation. Partners can buy at cost, vote to hand items over, or consign their own for a cut.
- **The black market.** With a back room, or quietly at a company, make goods the GM has marked illegal and sell them through a fence for dirty cash. They stay off the books, add Exposure, and a raid can seize them.

### Moving the market
- **Campaigns.** A business can run a smear or a leak against a listed company, for a small dip in its price.
- **Media stories.** A Media publishes an exposé or a puff piece, with Believability by Credibility rank as in the rules, backed by evidence shards. Medias also hear rumours by mail, or dig for them.

### Fronts
- **Back rooms.** A shop or registered business can run something illegal behind the front, from 34 kinds across ten kinds of business, each playing to its own profile of risk and reward: dirty cash, laundering, pay-offs, raids and informants, with gang deals on the side. At a chartered company it is the officers' secret, and companies have crime of their own.
- **Back-room staff.** Hire a hand, a launderer or a fixer to work it when nobody else does, for more pay and more risk. Exposure shows as a bar, in bands, never as a number.

### Windows
- **Folders and tabs.** The Market Terminal and the Business window are arranged like the GM Console.
- **Pending lists.** GMs and players each get one list of what is waiting for them, and can act on it there. A click on a row opens the detail.
- **Colour themes.** With Pneuma's Visual Tools installed, each player can have the windows match its skins and colours.

### Character ties
- **Crew Tools downtime.** With Pneuma's Crew Tools active, project days and extra time spend a character's downtime, so business work competes with everything else they could do.
- **REP and Improvement Points.** A business's big moments, good and bad, suggest awards for the GM to apply, change or dismiss.
- **Living costs.** Partners can vote for the business to pay a partner's Housing and Lifestyle each month.
- **An Exec's team.** Team sizes and Loyalty follow the rulebook: look after them, or they sell you out.
- **On the map.** With the Night City Map bridge, each open business gets a pin the GM can move, edit or delete.

### Roles and scenes
- **Role actions.** A Nomad's supply contract cuts running costs, a Rockerboy's gig lifts takings and Reputation, and a Lawman's Backup answers raids and cases and can call in a favour against their own heat.
- **Big events as scenes.** The GM can play out a raid, sabotage or a hostile faction's move at the table, with a ready hook, while the weeks carry on.

### For the GM
- **The GM Console.** Advance time and steer sentiment, regimes and volatility. Queue shocks, glides and corporate actions, preview their effect over simulated futures, and undo a tick.
- **Approvals.** Gig impacts, penalties, new businesses, charters, listings, syndicates, NPC job offers, campaigns and Media stories can each wait for the GM, all listed on one Pending tab.
- **Gig outcomes** (with the bridge). A completed or failed gig moves its client's share price a few days later.
- **Insider-trading heat** (optional). A hidden score watches for trades placed ahead of news. Brokers and NCPD warn, and penalties wait for approval.
- **Hidden from play.** Fair value, the true regime, heat, a business's Exposure, its staff's traits and the strength of hidden owners' layers stay out of players' windows.
- **Factions.** Corporations and gangs with a standing for each business. It moves with contracts and gifts, changes running costs and protection money, and hostile factions act against a business.
- **Tools.** A self-check, starter macros, suggested companies from Messenger contacts and gigs, and a log of recent trades.

### How it runs
The active GM's client carries out every player action. A player's request waits in their outbox until a GM is online. Each release brings stored data up to date by itself.

## Development

The engine in `scripts/engine/` has no Foundry dependencies, so it runs and tests in Node (v20 or newer). Run `npm install` once, for the template test.

```
npm test                     # unit, flow and window tests
npm run simulate             # Monte-Carlo calibration report
```

```
scripts/engine/        pure logic: prices, orders, portfolios, funds, businesses, syndicates, listing, capital
scripts/data/          repositories: companies, market store, portfolios, brokers, funds, businesses, syndicates
scripts/services/      the GM-side services and player clients
scripts/integrations/  the one door to Night City Messenger
scripts/core/, init/   initialisation, settings, registration
scripts/ui/            ApplicationV2 windows: Market Terminal, Business window, GM Console and dialogs
templates/, styles/, lang/
tools/                 calibration and business-model simulators
tests/                 Node tests against a fake Foundry runtime
docs/                  the guides above
```

### AI disclosure

This module is developed with generative AI. Code, tests and documentation were written with assistance from Anthropic's Claude, using Claude Code, and most commits carry a `Co-Authored-By: Claude` line. The maintainer reviews all code, directs the work, decides the design and rules, and tests changes in a working Foundry environment.

## License

MIT. The bundled fonts, Rajdhani and Share Tech Mono, are under the SIL Open Font License; each licence is in its folder under `assets/fonts`.
