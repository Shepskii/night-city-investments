# GM guide

How to run the market at the table, steer it, approve and check what players do, and read the hidden state. For installation and settings see [Getting started](GETTING-STARTED.md); for what players see, the [player guide](PLAYER-GUIDE.md).

## The market in your Night City

Technically speaking, Cyberpunk RED describes no stock exchange in Night City, so this one is the module's invention. A framing that sits well with the setting: with the old global NET gone, it is a local exchange on one of Ziggurat's air-gapped CitiNets, reached through brokers' Agents or a CorpNet terminal. Global names like Arasaka trade thinly here, on rumour. The starter companies are starting points; two of them (Night Corp and Kang Tao) are best known from the 2077 era, so remove or replace them if you prefer.

Re-importing does not overwrite companies a world already has.

## How it works underneath

- **Your client does the work.** Players never change portfolios or businesses themselves. Each action is saved as a request on their own character, and the **active GM's** client carries it out and writes the result back. With no GM online, requests wait.
- **Player rolls are player rolls.** A roll happens on the player's client when they press its button, with a normal chat card. Your client reads the dice back from the card and uses its own copy of the character's stat, skill and the DV, so a request cannot claim a total, and a card can be used only once.
- **Hidden state** lives in the GM-only journal **"NCI GM Control"**: fair values, the true regime, insider-trading heat, businesses' Exposure and staff traits. Never give players access to it. (It is hidden from play, not secret: Foundry sends every document to every client, so a player at the browser console could still read it.)
- **After an update,** reload every client, the GM's included. A client that has not reloaded runs the old code.

## The GM Console

Open it from the scene controls (sliders icon). The top row of buttons picks a group, and the second row a tab in it:

| Group | Tab | For |
|---|---|---|
| **Pending** | | Every decision waiting for you, one row each; click a row to go to its tab |
| **Market** | Market | The clock, steering (bias, regime, volatility, halt), undo, reset |
| | Events | Shocks, glides, headlines, setting a price |
| | Corp actions | Special dividends, splits, buyouts, delistings, bankruptcies |
| | Brokers | Brokers and terminal grants |
| **Players** | Businesses | Every player business: its true state, owners, staff and faction standing, with your buttons at the foot of each entry |
| | Syndicates | Each syndicate's account and members, with your buttons at the foot: approving it, passing or vetoing its proposals |
| | Heat | Insider-trading heat, penalties, watch windows and audits |
| **Tools** | Gigs | Gig impacts from Night City Map: approval and client mapping |
| | Companies | Creating, editing, importing and launching companies (IPOs) |
| | Funds | Creating, editing, importing and closing funds |
| | Factions | The list of corporations and gangs |
| | Audit | Self-check, macros, suggested companies, recent trades, your recent actions |

A tab shows how many decisions are waiting on it as a small number beside its name, a group shows the total for its tabs, and Pending the total of all. Syndicate proposals are not counted: members' votes settle them, though you can still pass or veto one.

## Running time

- By default the market ticks with the **in-world clock** (one tick per 10 in-world minutes), so it keeps pace with Simple Calendar. A jump forward is caught up a game day at a time, so anything that fell due happens.
- **Advance 1 / 7 / 30 ticks** and **Advance 1 day** (Market tab) work in every mode. At the default interval 30 ticks is about five hours; use **Advance 1 day** to move a whole day.
- The **market date** is the calendar date plus any days you advanced by hand. Dividends, fund payouts, IPOs and statements follow it. The Market tab warns when it is ahead of the calendar.
- Player **businesses** close their week on the first tick on or after the weekday in settings.

## Steering the market

| You want to... | Use |
|---|---|
| Nudge the whole market, a sector or one company | Market tab: a **sentiment bias**, with a duration and an optional fade-out |
| Make a boom or a storm | Market tab: **force a regime**, or raise the **volatility** multiplier |
| Stop all trading | Market tab: **halt** |
| Make a story event hit a company | Events tab: a **shock**, with a delay, a persistence level and an optional public headline |
| Walk a price to a target | Events tab: a **glide** over N days |
| Fix a price outright | Events tab: **set price** |
| Post news | Events tab: **headline** |
| See what a change will do first | The **Preview** button beside bias, shock and glide: 200 simulated futures, with and without it |
| Take back the last tick | Market tab: **Undo last tick** (refused once a player's money moved because of it, or after a split, price change or new company) |
| Start prices again | Market tab: **Reset market** (portfolios are kept) |

The Events tab keeps a log of recent GM actions. [Price model](PRICE-MODEL.md) explains what each control does to prices.

## Companies, funds and corporate actions

- **Companies tab:** create, edit, delete or import companies. Each has a sector, volatility, beta, liquidity, a dividend policy and optional aliases (for matching gig clients). Tick **automatic split** to split when the price passes a threshold.
- **Launch a company later** with an IPO: untick Listed, set a listing date, an offer price, a subscription window and an optional share cap. Players subscribe from the Market tab; oversubscription fills pro rata. **List now** launches it early.
- **Funds tab:** create, edit, import, or close a fund (holders are paid out). A fund can rebalance and carry a manager's yearly edge.
- **Actions tab:** special dividends, stock splits, buyouts, delistings and bankruptcies. Each updates the market, every portfolio and the news.

## Brokers and direct trading

- **Make a broker** from a character (their Accounting is read from the sheet) or tag a Night City Messenger contact (you set a rating). A broker's skill sets their speed (1–5 days) and fees. A character with a Personality on their sheet writes in that voice.
- Set a minimum withdrawal, disable a broker, or remove one nobody is using.
- **Terminal access:** grant a character direct trading without a CorpNet connection.
- With **Broker order handling** set to Manual, mailed orders wait for you.

## Gigs (with the Night City Map bridge)

A gig marked Completed or Failed queues a price impact on its client. In the **Gigs** tab:

- **Needs a company:** a client that matches no company by name, ticker or alias. Pick one (or ignore the client); the choice is remembered for the client's other gigs.
- **Waiting for approval:** change the size, delay or headline, then approve, or discard.
- **Report an outcome by hand** for a gig the bridge did not report.
- For a gig you wrote with no client, add `[NCI: ARA]` (or `[NCI: ignore]`) to its GM notes.

A 1,000 eb job moves its client about 1.5%, a failure 1.3 times as much, shown one to three days later with a generic headline. Each gig moves the market only once.

## Insider-trading heat

With **Track insider-trading heat** on, a watch window opens on a company whenever news is coming: a gig's client before the effect shows, or a listed player company between its report and the price move. When the window closes, trades placed in it in the direction of the news add hidden **heat** to the account that made them (runners and officers count most, tipped characters less, a skilled broker's clients less).

The **Heat** tab shows each character's heat, open windows, recent audits with the trades that counted, and penalties. With consequences on, heat brings a broker's warning, then an NCPD enquiry and slower, dearer broker orders, and at the top a **penalty** (a fine, a frozen account or a dropped broker) that waits for you to **approve, change or dismiss**. You can also set a character's heat by hand.

## Syndicates

In the **Syndicates** tab:

- **Approve** or **reject** a newly founded syndicate (with approval on). No money is paid in until you approve.
- **Pass** or **veto** any open proposal.
- **Close** a syndicate.

## Player businesses

The **Businesses** tab lists every business with its true state, Exposure included, and an **Open** button that opens it in the Business window. The decisions waiting for you:

| When | You |
|---|---|
| A new business has passed its setup roll (approval on) | **Approve** it to open, or **reject** it (everyone's money goes back) |
| A charter's rolls are done | **Approve** the charter (the funding window opens, or it forms at once if net assets cover the quote), or **reject** it (the fee is not refunded) |
| A company applies to list | **Approve** the listing (the prospectus rolls open), or **turn it down** (the fee is not refunded; they may try again in 14 days). The tab shows the valuation, float and hidden Exposure |
| A business offers an NPC a job | **Accept** or **decline** for the NPC |
| A player has left the table | Mark the partner as **leaving**, so the others can buy them out or the stake passes to the heir |
| A character or syndicate bids for a company | **Approve the offer** (the whole offer is held from the bidder's brokerage balance, or the bid lapses if they cannot cover it; it opens for 7 days) or **refuse** it. The tab then shows the offer and what players have tendered |
| A company is in **administration** (net assets below zero at two closes in a row) | **Restructure** it (its cash pays what it can, keeping four weeks of upkeep; the rest of the debt becomes non-voting shares for its creditors, shown as Receivers, diluting the holders; Reputation and Compliance −10) or **Wind it up** (assets sold at half value; owed wages, then loans, then holders; it closes, and a listed company's shares leave portfolios). The tab shows its net assets, loans, wages owed and overdraft. If its owners put in enough cash, it comes out by itself at a close |
| A company lost a **regulator's case**, or nobody answered it | **Approve the penalty** (change the proposed fine first if you like) or **Drop the case**. See below |
| A listed company is under the **delisting review** | **Give it time** (the review clears), or **Delist** it: it buys back the float (borrowing what its cash lacks) and goes private. Delisting cannot be undone |

The rest runs itself: weeks close, events are drawn, wages are paid, reports are published, and takeover offers close and settle when their 7 days are up.

**NPC staff:** tag an NPC's Night City Messenger contact `staff` or `employee` to make them hireable. An NPC actor (not a player's character) can also join an Exec's team.

**Gigs for a player's business:** a gig whose client is a player business changes its Reputation and takings once approved in the Gigs tab.

## Factions

Players can raise a business's standing with a faction: a shop uses **Court a client** or **Pay respects**, and a company aims **Chase contracts** or **Investor relations**. Each costs a gift from the cash. Standing then changes costs: corporations in the business's sector move its running costs by up to 15%, and gangs on its turf move protection money and shakedowns by up to 50%.

A hostile faction (standing below -60) may act against the business, up to 15% of weeks: a smear, sabotage, a tipped-off raid or poaching. These run by themselves as the week's event, and the players answer them as usual. A smear that lands dips a listed company's price by up to 2%. Beating a gang's shakedown by force costs 3 standing with that gang.

The **Factions** tab holds the corporations and gangs businesses can stand well or badly with. Press **Import starter factions** to add the market's corporations and Night City's gangs by district, then edit, add or remove as you like. Link a corporation to its ticker, and give a gang its districts, so businesses there see it.

Each business's entry on the **Businesses** tab shows its true standing with the factions it knows, and has a control to set one by hand. Its owners only see the band.

Standing runs from -100 to 100 for each business; its owners see only a band (hostile, wary, neutral, friendly, allied). It fades 2 points a week and moves at most 15 a week; you can set it by hand on the same tab.

**Tags in a gig's GM notes** say who it involves, by name, ticker or alias:

| Tag | Means |
|---|---|
| `[NCI client: Biotechnica]` | The client. Overrides the gig's client field |
| `[NCI target: Militech]` | Who it was aimed at |
| `[NCI contract: Charter Test Clinic]` | Done for this player business, making it a contract |

The older `[NCI: ARA]` (a client's ticker, or a business), `[NCI: ignore]` and `[NCI: skip]` still work. A contract tag naming no open business waits on the Gigs tab with a warning, since it is probably a typo.

**What a gig affects:**
- **A freelance gig** (the default, including everything Night City Map generates) moves the client's share price and its target's. No player business is touched.
- **A contract** (`[NCI contract: ...]`, by the business's name, ticker or id). As well as the client's and target's prices, that business's Reputation and takings move, its own share price if it is listed, and its standing with the client and target. A gig whose client *is* the business counts the same way, without needing the tag.
- **A target:** gigs don't report one, so tag it (a faction or a market company). Failing that, if the title or description names exactly one faction, the approval card asks you to tick that it really is the target. A target moves opposite to the client: half as much on a success, a quarter on a failure.

Private businesses, gangs and unknown clients have no share price, so only the other effects apply. A gang as a freelance gig's client asks for no mapping: only its target's price moves, and with no target the gig is simply recorded. The approval card lists every party before you approve.

## Regulators

Exposure now has consequences. A case opens by chance at a monthly report (low 5%, moderate 15%, high 35%), or at once when a corp plant is fired, a Shortcuts roll is fumbled, or NCPD unmasks a holder of over 25% of a company. You can also press **Open a regulator's case** on any company, or **Drop the case** at any stage.

An officer has 14 days to answer, rolling against 14 + 1d10, plus 2 at moderate Exposure or 4 at high. Players see neither the total nor the band; the Businesses tab shows you the Exposure. A win clears half of it. A loss or silence waits for you with a proposed fine (5% of book value, 10% at high Exposure). Approving it takes the fine and 10 Compliance, and a listed company makes the news. A fumble or high Exposure makes it serious: a listing application stops, or the last three reports are restated at their real figures.

## Hidden ownership

Players can hide their shareholdings behind layers (a broker's nominee, then shell companies). Nothing waits for you, but you see everything:

- **The owners table** on the Businesses tab lists each hidden holder with every layer and its strength (the layer roll's total).
- **Everyone else** sees the outermost layer: on the Shareholders tab, in the votes, and on a listed company's public register on the terminal.
- **Concealment** (hiding over 5% of a listed company) runs itself: weekly heat and Exposure, and a monthly NCPD audit (14 + 1d10 against the outer layer's strength plus 2 for each beneath). One that sees through unmasks and fines the holder, makes the news, and dents the price the next day (a tenth of the hidden stake, 2% to 8%).
- **Investigations** by players roll against a layer's strength plus 2 for each layer they have already peeled. What each investigator has found is kept in the hidden state, and they learn it by mail.
- Like the rest of the hidden state, the strengths and what investigators know live in the "NCI GM Control" journal.

## Checking outcomes

- **The Business window, opened from the Businesses tab,** shows a business as its owners see it. Each weekly digest on the Ledger tab opens a cashbook of that week's income and expenses. Each monthly report opens to show the **real figures beside the reported ones** (an aggressive report inflates the reported profit).
- **Exposure** (the hidden trail from Shortcuts, Bold rolls and the rest) is on the Businesses tab. An internal audit by the officers can find and cut it, and it counts against a listing.
- **Staff traits** (light fingers, loose lips, a corp plant, a moonlighter, dedicated, connected) are in the hidden state. Vetting shows them to players.
- **Recent trades** (Audit tab) lists the latest fills across every portfolio.
- **The self-check** (Audit tab, or `game.nightcity.investments.verify()`) looks over companies, funds, the market, portfolios and the Messenger link, and lists anything broken or odd. It changes nothing.
- **Companies to consider** (Audit tab) lists organisations on Messenger contacts and gigs that are not on the market, ready to create in one click.

## Console scripts

For testing or fixing things live, the module's services can be loaded in the browser console on the GM's client:

```js
const { BusinessService } = await import('/modules/night-city-investments/scripts/services/BusinessService.js');
```

Change data only through the services, never by editing flags by hand, so the GM's queue and the hooks stay in step. The public API (`game.nightcity.investments`) is described in [API](API.md).
