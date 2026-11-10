# GM guide

How to run the market at the table, steer it, approve and check what players do, and read the hidden state. For installation and settings see [Getting started](GETTING-STARTED.md); for what players see, the [player guide](PLAYER-GUIDE.md).

## The market in your Night City

Technically speaking, Cyberpunk RED describes no stock exchange in Night City, so this one is the module's invention. A framing that sits well with the setting: with the old global NET gone, it is a local exchange spanning several of Ziggurat's air-gapped CitiNets, reached through brokers' Agents or a CorpNet connected terminal or device. Global names like Arasaka trade thinly here, on rumour. The starter companies are starting points; two of them (Night Corp and Kang Tao) are best known from the 2077 era, so remove or replace them if you prefer.

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
| **Pending** | | Every decision waiting for you, one row each, with its type. Act on it there, or click the row to open the relevant tab for more detail |
| **Market** | Market | The clock, steering (bias, regime, volatility, halt), undo, reset |
| | Events | Shocks, glides, headlines, setting a price, giving evidence, the event queue |
| | Corp actions | Special dividends, splits, buyouts, delistings, bankruptcies |
| | Brokers | Brokers and terminal access for direct trade |
| **Players** | Businesses | Every player business: its true state, owners, staff and faction standing, with **Open** at the top of each entry and your other buttons at the foot |
| | Syndicates | Each syndicate's account and members, with your buttons at the foot: approving it, passing or vetoing its proposals |
| | Heat | Insider-trading heat, penalties, watch windows and audits, and each business's Exposure |
| **Tools** | Gigs | Gig impacts from Night City Map: approval and client mapping |
| | Companies | Creating, editing, importing and launching companies (IPOs) |
| | Funds | Creating, editing, importing and closing funds |
| | Factions | The list of corporations and gangs |
| | Production | What each kind of business can make, and which items are illegal |
| | Audit | Self-check, macros, suggested companies, recent trades, your recent actions |

A tab shows how many decisions are waiting on it as a small number beside its name, a group shows the total for its tabs, and Pending the total of all. Syndicate proposals are not counted: members' votes settle them, though you can still pass or veto one.

## Pending

One list of everything waiting for you, across every tab, each row with its type: a new business, a charter, a gig, a heat penalty, a story, suggested REP and IP. Fields and buttons on the row let you act from there. What each decision means is under its tab below.

## Market group

### Market tab

#### Running time

- By default the market ticks with the **in-world clock** (one tick per 10 in-world minutes), so it keeps pace with Simple Calendar. A jump forward is caught up a game day at a time, so anything that fell due happens.
- **Advance 1 / 7 / 30 ticks** and **Advance 1 day** (Market tab) work in every mode. At the default interval 30 ticks is about five hours; use **Advance 1 day** to move a whole day.
- **Advancing by hand moves the calendar too**, in the day and in-world clock modes, by the whole days it adds, so in-world time passes for everything that reads the calendar. Manual mode leaves the calendar alone.
- The **market date** is what dividends, fund payouts, IPOs and statements follow. A world that advanced by hand on an earlier version may have it ahead of the calendar: the Market tab says by how many days, and **Move the calendar on** closes the gap. It moves the calendar only, never the market.
- Player **businesses** close their week on the first tick on or after the weekday in settings. If you move the calendar back past the start of a business's week, that week runs from the new date, with a note in its digest, so its weeks go on closing. Other dates already set on it, such as the next try at a step-up, charter or listing, keep waiting for the date they were given.

#### Steering the market

| You want to... | Use |
|---|---|
| Nudge the whole market, a sector or one company | Market tab: a **sentiment bias**, with a duration and an optional fade-out |
| Make a boom or a storm | Market tab: **force a regime**, or raise the **volatility** multiplier |
| Stop all trading | Market tab: **halt** |
| See what a change will do first | The **Preview** button beside bias, shock and glide: 200 simulated futures, with and without it |
| Take back the last tick | Market tab: **Undo last tick** (refused once a player's money moved because of it, or after a split, price change or new company) |
| Start prices again | Market tab: **Reset market** (portfolios are kept) |

[Price model](PRICE-MODEL.md) explains what each control does to prices.

### Events tab

| You want to... | Use |
|---|---|
| Make a story event hit a company | Events tab: a **shock**, with a delay, a persistence level and an optional public headline |
| Walk a price to a target | Events tab: a **glide** over N days |
| Fix a price outright | Events tab: **set price** |
| Post news | Events tab: **headline** |
| See what a change will do first | The **Preview** button beside bias, shock and glide: 200 simulated futures, with and without it |

**Media stories** wait on Market > Events (and the Pending tab) once believed, unless you turn off the approval setting: **Let it run** or **Spike it**. Give a character evidence for one on Market > Events. A successful investigation or due diligence on a listed company makes evidence by itself.

**Rumours** run by themselves: a player's Media gets a mail every few days if their roll beats the DV and there is anything to hear. You have nothing to do.

### Corp actions tab

Special dividends, stock splits, buyouts, delistings and bankruptcies. Each updates the market, every portfolio and the news.

### Brokers tab

- **Make a broker** from a character (their Accounting is read from the sheet) or tag a Night City Messenger contact (you set a rating). A broker's skill sets their speed (1–5 days) and fees. A character with a Personality on their sheet writes in that voice.
- Set a minimum withdrawal, disable a broker, or remove one nobody is using.
- **Terminal access:** grant a character direct trading without a CorpNet connection.
- With **Broker order handling** set to Manual, mailed orders wait for you.
- A broker can also be a character your players talk to. Only mail holding a market command gets an automatic reply, and an order sent to someone else's broker is refused. Everything else stays in the broker's inbox for you to answer, including an order for a ticker that doesn't exist, so watch for players' typos.

## Players group

### Businesses tab

This tab lists every business with its true state, Exposure included, and an **Open** button that opens it in the Business window. Suggested REP and IP wait under **Waiting**, with new businesses. To change a business's Exposure by hand, use the **Heat** tab. The decisions waiting for you:

| When | You |
|---|---|
| A new business has passed its setup roll (approval on) | **Approve** it to open, or **reject** it (everyone's money goes back) |
| A charter's rolls are done | **Approve** the charter (the funding window opens, or it forms at once if net assets cover the quote), or **reject** it (the fee is not refunded) |
| A company applies to list | **Approve** the listing (the prospectus rolls open), or **turn it down** (the fee is not refunded; they may try again in 14 days). The tab shows the valuation, float and hidden Exposure |
| A business offers an NPC a job | **Accept** or **decline** for the NPC |
| A new business invites an NPC as a founding partner | Enter what they put in, then **Join**, or **Decline**. The setup roll waits for your answer |
| An item left a **storeroom sheet** by your hand | Say what became of it: **Sold** at the shop's price (the money goes to the business, or to a consignment's owner less the shop's cut), **Given away** or **Lost** |
| A player has left the table | Mark the partner as **leaving**, so the others can buy them out or the stake passes to the heir |
| A character or syndicate bids for a company | **Approve the offer** (the whole offer is held from the bidder's brokerage balance, or the bid lapses if they cannot cover it; it opens for 7 days) or **refuse** it. The tab then shows the offer and what players have tendered |
| A company is in **administration** (net assets below zero at two closes in a row) | **Restructure** it (its cash pays what it can, keeping four weeks of upkeep; the rest of the debt becomes non-voting shares for its creditors, shown as Receivers, diluting the holders; Reputation and Compliance −10) or **Wind it up** (assets sold at half value; owed wages, then loans, then holders; it closes, and a listed company's shares leave portfolios). The tab shows its net assets, loans, wages owed and overdraft. If its owners put in enough cash, it comes out by itself at a close |
| A company's **black ops** succeeded (approval on) | The same as a campaign, with a bigger move on the price. A fumble is a scandal and a regulator's case by itself |
| A business's **campaign** against a company succeeded (approval on) | **Let it run** (a generic headline, a price dip of up to 2%, a heat window), or **stop it**. The 1,000 eb stays spent. A setting turns this approval off |
| A **back room** is finished (approval on) | **Let it open**, or **turn it down**; what it cost stays spent. The underworld setting stops new ones |
| A **big event** comes up: a raid on a back room, a back room's own serious trouble, a tipped-off raid, sabotage, a smear, collectors, a grudge, a hostile faction's poaching, a heavy shakedown | **Run as a scene** to play it at the table: you get a hook, and the weeks carry on while it waits. Then **They won**, **They lost**, or **Back to a roll**. Leave it alone and it's a normal event |
| A company lost a **regulator's case**, or nobody answered it | **Approve the penalty** (change the proposed fine first if you like) or **Drop the case**. See below |
| A listed company is under the **delisting review** | **Give it time** (the review clears), or **Delist** it: it buys back the float (borrowing what its cash lacks) and goes private. Delisting cannot be undone |

The rest runs itself: weeks close, events are drawn, wages are paid, reports are published, and takeover offers close and settle when their 7 days are up.

**Contacts in Messenger:** with **Share contacts with players** on, a character who picks a broker gets that broker as a contact, and everyone who has joined a business gets its NPC partners. Those running a business also get its NPC staff and whoever mails them an event, and an employee gets their employer. GM notes aren't copied, but tags are, so players can see a contact's tags.

**Events by mail:** with **Business events by mail** on, an event with someone behind it is mailed to those who can answer it (the partners, or a company's officers) from that someone, so you can answer in their voice. A faction's shakedown, sabotage or smear comes from the faction, a story from the paper's news desk, an inspection or a faction's raid from Night City Inspections, a raid on a back room from NCPD, the collectors from Collections, a grudge from the employee who was let go, and a staff event from the employee. A back room's favour or big order comes from its faction. Breakdowns, shortages, windfalls and the like send nothing. The contacts are made in your Messenger directory the first time they're needed, in a folder called Night City Investments, where you can rename them or give them portraits. To use one of your own contacts for a faction, type its name in the faction's **Messenger contact** on the Factions tab. Job mail, payslips included, comes from the employer: a corporation's Human Resources, made the same way, or an NPC company's owner. A player's business still pays through the market wire.

**NPC partners:** a player can invite an NPC when founding a business, by searching for them on the form. The search finds Night City Messenger contacts tagged `investor`. The tag can sit among others, such as `Investor Broker` or `investor; fixer`. Players can search by the NPC's name, the contact's name or its alias. A contact with no linked actor can be a partner by its name alone. One linked to a player's character is found as that character. One linked to anything other than a character or mook can't be a partner: in your search it shows greyed out with the reason. You can also drag any NPC onto the form yourself. What you enter comes off no sheet, and what they earn doesn't reach their sheet either: their stake is off-screen money. They hold units but have no vote and take no actions, so they can't hold up a decision.

**NPC staff:** tag an NPC's Night City Messenger contact `staff` or `employee` to make them hireable. An NPC actor (not a player's character) can also join an Exec's team.

**Gigs for a player's business:** a gig whose client is a player business changes its Reputation and takings once approved in the Gigs tab.

**A back room at a company** is the officers' secret: other shareholders see only plain ledger lines and a raid as an inspection, and a raid that shuts it there shuts it for good. They would find out through a scandal, if it's listed, or through you.

**Kinds of back room.** There are 34, three or four for each kind of business, and the partners choose one when they propose the room. Each has a profile: Steady, Loud, Quiet, Hungry, Connected or Laundering. The [Player Guide](PLAYER-GUIDE.md#kinds-of-back-room) lists them all with their numbers. Two are dark enough that you may want a word at the table before a player chooses them: Organ brokering at a clinic and People running at a courier service. There's no setting to remove a kind, but with approval on, you can turn the room down when it's finished. What it cost stays spent, so say so early.

A room already open before these kinds existed keeps its numbers, apart from **Laundering for others** at a boutique, which now plays as Laundering.

**A Connected room** adds a full +1 standing a week worked with the faction chosen on opening, whatever the roll, and that +1 doesn't count as a repeat dealing, so gigs for that faction keep their value. Standing fades 2 a week, so from zero it holds at 1, and from higher up it falls by 1 a week rather than 2. If your world has no factions, the room opens without one and adds no standing.

**A back room's own trouble.** A room worked last week may draw an event of its own, in place of the week's usual one: about 8% of weeks, set by **Back room events** in the module settings (Rare, Normal or Often). A Steady room only draws the two every room shares. The [Player Guide](PLAYER-GUIDE.md#when-a-back-room-goes-wrong) lists them. Each is answered with the room's own skills and leaves the shop's takings alone. A loose end, a bad batch, a favour asked and a rival operation can be run as a scene. At a company, shareholders who aren't officers see a back room's trouble as an inspection in the reports, as they do a raid.

#### REP and Improvement Points from businesses

A business's big moments suggest REP and IP on the **Pending** tab, and under **Waiting** at the top of the Businesses tab, one row for each character running it: officers at a company, active voting partners below that, and a syndicate's officers for a syndicate. Change the numbers, then **Apply** or **Dismiss**. Nothing touches a sheet until you do.

| Milestone | REP | IP |
|---|---|---|
| Registered | 3 | 10 |
| Chartered | 4 | 20 |
| Went public | 7 | 30 |
| Took control in a takeover (the bidder) | 7 | 30 |
| Fought off a takeover (after a defence roll) | 5 | 20 |
| A big-event scene, won or lost | - | 20 or 10 |
| Lost a regulator's case | 4 | - |
| Unmasked as a hidden holder (the holder) | 6 | - |
| Wound up | 5 | - |
| A back-room raid lost | 4 | - |

REP follows the rulebook: a level replaces the old one only if it is higher, and a bad deed has a level too, since being known for something is being known. The sheet's REP log says what it was for, so you can use that at the table. Dismiss a scene's row for anyone who was not there. Routine rolls suggest nothing.

#### Regulators

Exposure has consequences. A case opens by chance at a monthly report (low 5%, moderate 15%, high 35%), or at once when a corp plant is fired, a Shortcuts roll is fumbled, or NCPD unmasks a holder of over 25% of a company. You can also press **Open a regulator's case** on any company, or **Drop the case** at any stage.

An officer has 14 days to answer, rolling against 14 + 1d10, plus 2 at moderate Exposure or 4 at high. Players see neither the total nor the band; the Businesses tab shows you the Exposure. A win clears half of it. A loss or silence waits for you with a proposed fine (5% of book value, 10% at high Exposure). Approving it takes the fine and 10 Compliance, and a listed company makes the news. A fumble or high Exposure makes it serious: a listing application stops, or the last three reports are restated at their real figures.

#### Hidden ownership

Players can hide their shareholdings behind layers (a broker's nominee, then shell companies). Nothing waits for you, but you see everything:

- **The owners table** on the Businesses tab lists each hidden holder with every layer and its strength (the layer roll's total).
- **Everyone else** sees the outermost layer: on the Shareholders tab, in the votes, and on a listed company's public register on the terminal.
- **Concealment** (hiding over 5% of a listed company) runs itself: weekly heat and Exposure, and a monthly NCPD audit (14 + 1d10 against the outer layer's strength plus 2 for each beneath). One that sees through unmasks and fines the holder, makes the news, and dents the price the next day (a tenth of the hidden stake, 2% to 8%).
- **Investigations** by players roll against a layer's strength plus 2 for each layer they have already peeled. What each investigator has found is kept in the hidden state, and they learn it by mail.
- Like the rest of the hidden state, the strengths and what investigators know live in the "NCI GM Control" journal.

#### Checking outcomes

- **The Business window, opened from the Businesses tab,** shows a business as its owners see it. Each weekly digest on the Reports tab opens a cashbook of that week's income and expenses. Each monthly report opens to show the **real figures beside the reported ones** (an aggressive report inflates the reported profit).
- **Exposure** (the hidden trail from Shortcuts, Bold rolls and the rest) is on the Businesses tab. An internal audit by the officers can find and cut it, and it counts against a listing.
- **Staff traits** (light fingers, loose lips, a corp plant, a moonlighter, dedicated, connected) are in the hidden state. Vetting shows them to players.

#### Crew Tools downtime

With Pneuma's Crew Tools active, **Business days come from Crew Tools downtime** is on by default: extra time, project days and mentoring spend a character's downtime, with no weekly allowance. Award days as usual, and open Downtime once for each character, or they have none to spend. Each spend shows in their Downtime Log as "NCI: business: what it was for". You can check it there: a player owns that log, as they do their chat cards. An investigation's legwork becomes money. Turn the setting off for the 3 business days a week without Crew Tools' involvement.

**NPC companies.** **New NPC company**, at the top of the Businesses tab, makes a company owned and run by one of your NPCs. Choose its kind, an NPC owner and their skill, a stage, how it's run and its starting cash; a company at the top stage also needs a ticker. It opens at once, and a registered business or company comes with some staff already hired, leaving roles open. Each week it runs itself when the week closes, answering its own events. To step in, press **Open** on its entry and act as the owner: it leaves alone whatever you did and fills in only what's left. Untick **Runs itself** to run a company entirely by hand. Each week its profit is paid out to the owner and leaves the game, as long as it keeps about eight weeks of costs in cash, so what you start it with stays in. The profile only makes a difference from the registered stage up, because a side business has one action a week and that is work.

**The job board.** Open roles at an NPC's registered business or company appear to players on the **Jobs** tab of the market window. A character applies with one roll, once a week per company. A failed roll is turned down automatically, and a pass waits on **Pending** for you to hire or turn down, unless **Hire good job applicants automatically** is on, which takes a solid roll or better at once. To offer someone a job yourself, open the company as its owner and use **Hire** on the Staff tab: the player gets an offer to accept. A side business doesn't advertise, but you can still offer a job there.

**Shifts.** A player character working at an NPC company can **Work a shift** once a week, from **Your jobs**. A good shift earns them a bonus and raises their **performance**; a poor one or a missed week lowers it. With more than one job, a shift at any of them excuses the week at the others. They see their performance only as a band. Fall to the bottom and they're warned by mail, and a week later let go with a week's pay. Once they're trusted, **Pending** asks you about a promotion: a 10% raise, or not now. Jobs at player businesses don't have shifts: the owners ask for overtime instead.

**Jobs at market corporations.** On the **Job Market** tab, under **Players**, give a market company such as Arasaka jobs for player characters. Pick a **kind of work**, which gives each role its skills (a clinic's floor works with Cybertech or Paramedic), the DV to apply and work a shift, and for each role how many places and the week's wage. The roles go on the market window's **Jobs** tab beside the NPC companies, and applications reach **Pending** as theirs do; you can also **Offer a job** from the company's entry. Pending opens the Job Market for these. There are no books behind it: the wage and a good shift's bonus are paid from outside the game's economy each week, and standing, warnings, the sack and promotions work as at an NPC company, with a promotion a 10% raise and no cap. Under **Edit jobs** you can change the wages (those in a role get the new wage at once), stop hiring, or remove the jobs, which lets everyone go with a week's pay. With insider heat on, an employee trading their company's shares while a gig's window is open on it counts as if they had run the gig.

### Syndicates tab

- **Approve** or **reject** a newly founded syndicate (with approval on). No money is paid in until you approve.
- **Pass** or **veto** any open proposal.
- **Close** a syndicate.

### Heat tab

With **Track insider-trading heat** on, a watch window opens on a company whenever news is coming: a gig's client before the effect shows, or a listed player company between its report and the price move. When the window closes, trades placed in it in the direction of the news add hidden **heat** to the account that made them (runners and officers count most, tipped characters less, a skilled broker's clients less).

The tab shows each character's heat, open windows, recent audits with the trades that counted, and penalties. With consequences on, heat brings a broker's warning, then an NCPD enquiry and slower, dearer broker orders, and at the top a **penalty** (a fine, a frozen account or a dropped broker) that waits for you to **approve, change or dismiss**. You can also set a character's heat by hand.

**Business Exposure** is here too: each open business, with its band and a field to set it by hand. A back room's band follows at once.

## Tools group

### Gigs tab

**Requires the Night City Map and Night City Map - Night City Investments Bridge modules.**

Gigs in Night City map that are marked Completed or Failed queue a price impact on the associated client and/or target.

- **Needs a company:** a client that matches no company by name, ticker or alias. Pick one (or ignore the client); the choice is remembered for the client's other gigs.
- **Waiting for approval:** change the size, delay or headline, then approve, or discard.
- **Report an outcome by hand** for a gig the bridge did not report or that was not created in Night City Map.
- For a gig you wrote with no client, add a tag to its GM notes.

A 1,000 eb job moves its client about 1.5%, a failure 1.3 times as much, shown one to three days later with a generic headline. Each gig moves the market only once.

**Tags in a gig's GM notes** say who it involves, by name, ticker or alias:

| Tag | Means |
|---|---|
| `[NCI client: <name/ticker>]` | The client. Supersedes the gig's client field |
| `[NCI target: <name/ticker>]` | Who it was aimed at |
| `[NCI contract: <player business name/ticker>]` | Done for this player business, making it a contract |

A contract tag naming no open business waits on the Gigs tab with a warning, since it is probably a typo.

**What a gig affects:**
- **A freelance gig** (the default, including everything Night City Map generates) moves the client's share price and its target's. No player business is touched.
- **A contract** (`[NCI contract: ...]`, by the business's name, ticker or id). As well as the client's and target's prices, the named player business's Reputation and takings move, its own share price if it is listed, and its standing with the client and target. A gig whose client *is* the player business counts the same way, without needing the tag.
- **A target:** gigs don't report one, so tag it (a faction or a market company). Failing that, if the title or description names exactly one faction, the approval card asks you to tick that it really is the target. A target moves opposite to the client: half as much on a success, a quarter on a failure.

Private businesses, gangs and unknown clients have no share price, so only the other effects apply. A gang as a freelance gig's client asks for no mapping: only its target's price moves, and with no target the gig is simply recorded. The approval card lists every party before you approve.

### Companies tab

Create, edit, delete or import companies. Each has a sector, volatility, beta, liquidity, a dividend policy and optional aliases (for matching gig clients). Tick **automatic split** to split when the price passes a threshold.
**Launch a company later** with an IPO: untick Listed, set a listing date, an offer price, a subscription window and an optional share cap. Players subscribe from the Market tab; oversubscription fills pro rata. **List now** launches it early.

### Funds tab

Create, edit, import, or close a fund (holders are paid out). A fund can rebalance and carry a manager's yearly edge.

### Factions tab

**Districts from Night City Map.** Without the map, businesses choose from this module's 20 districts. With it, the founding form lists the districts on the map now, and updates when you change them with its **Districts** button, including your own in place of the built-in ones. Water districts aren't offered.

A district this module doesn't know appears in a table at the foot of this tab, with traffic, rent and risk starting from the map's danger, for you to adjust. Its name follows the map, and a change of danger moves its numbers until you save your own. If you remove a district from the map, it can't be chosen for a new business, but businesses and factions already there keep it, with its name and numbers.

The map's **Start from built-in** button makes new districts rather than linking to the old ones, so copies use numbers from their danger, and existing businesses in the originals carry on as they are. Faction turf uses district ids, listed on this tab.

This tab holds the corporations and gangs businesses can stand well or badly with. Press **Import starter factions** to add the market's corporations and Night City's gangs by district, then edit, add or remove as you like. Link a corporation to its ticker, and give a gang its districts, so businesses there see it.

Players can raise a business's standing with a faction: a shop uses **Court a client** or **Pay respects**, and a company aims **Chase contracts** or **Investor relations**. Each costs a gift from the cash. Standing then changes costs: corporations in the business's sector move its running costs by up to 15%, and gangs on its turf move protection money and shakedowns by up to 50%.

A hostile faction (standing below -60) may act against the business, up to 15% of weeks: a smear, sabotage, a tipped-off raid or poaching. These run by themselves as the week's event, and the players answer them as usual. A smear that lands dips a listed company's price by up to 2%. Beating a gang's shakedown by force costs 3 standing with that gang.

**Stories in the press.** A corporation with a grudge may run a story against a business, set by **Stories in the press** in the module settings (Off, Rare, Normal or Often). A hostile corporation is the likeliest and goes to a media company if the world has one, a wary one is less likely, and a neutral one only has a small chance if something true can be told. A business gets at most one story in 28 days. With **Press stories need GM approval** on, each waits on Pending showing who is behind it and why it's true, and you can reword the headline, **Let it run** or **Spike it**. The owners see nothing until you decide, and a story you leave undecided goes when the week closes. With stories on, these replace a hostile corporation's smear. As a guide, a business at standing -80 draws six or seven stories in a 52-week year from a media company, most of them not believed. If the owners answer most of them, about one a year lands, costing about 2 Reputation in the year and, if listed, about 2% of its price. The cost to them is mainly the weekly responses it takes up.

**Run a story** on Market > Events runs one by hand: pick who it's about, the kind, who prints it and whether to roll for belief or decide it yourself. It ignores the 28-day limit but starts it. If the business already has an event this week, the story becomes next week's. A player's Media may hear of any story in the days before it prints, once you've let it run.

With heat tracking on, a story can also name a **character** whose heat has been 25 or more in the last four weeks. It waits on Pending the same way. Once you let it run, the character gets a mail and has seven days to answer on their Pending tab. It prints after three days and lands on the seventh. If believed, it adds heat and costs the business they run with the worst standing some Reputation. A headline is public and names the character (except a hidden stake, which names only the company), so spike any that would out someone before you want them outed.

Each business's entry on the **Businesses** tab shows its true standing with the factions it knows, and has a control to set one by hand. Its owners only see the band.

Standing runs from -100 to 100 for each business; its owners see only a band (hostile, wary, neutral, friendly, allied). It fades 2 points a week and moves at most 15 a week; you can set it by hand on the same tab.

### Production tab

Businesses with a workshop make real items from the system's compendiums, by the rulebook's Fabrication table. The player guide has the rules. You have little to do while it runs: weekly sales, runs and fences happen at the close.

**The lists.** Tools > Production shows what each kind of business can make, with each item's price category and DV. The defaults come from the core compendiums, by item type, with a short list of named gear for bars, food stalls, media and garages. Drop an item from any compendium or the Items directory into the box to add it, or take one off with the trash button; **Put back** restores a default. Stage limits still apply: up to Premium for a side business, Very Expensive once registered, and Luxury for a company. Couriers and security firms make nothing, and can't build a workshop even if you add items for them.

**Illegal items.** **Mark illegal** applies wherever the item is made. It then needs an open back room to make, or a company's officers, and only a fence will take it. Nothing is illegal until you mark it, so decide what counts in your game. A line already set on the item follows your mark from its next run, but stock already made stays legal. With the **Underworld content** setting off, nobody can make illegal items, and any illegal line stops at once, with a note in that business's digest. A run already on the benches finishes, and goods already made can still go to a fence.

**Storeroom sheets.** Each business's stock gets a container actor called "Stock — *business*", in a **Night City Investments** actor folder. Those running the business can look at it, but can't drag from it or buy from it. Its cart icon still shows, and clicking it gives a permission warning. The business's record holds the money, and the sheet follows the record:

- **Taking an item off the sheet by hand** raises a question on Pending (see the Businesses tab). The record counts it gone at once, but its cost stays on the books until you answer.
- **Adding an item by hand** isn't noticed, and stays outside the record: the shop won't sell it, and closing doesn't count it. It disappears with the sheet if the business closes.
- **Don't rename or stack items by hand.** The sheet recognises its items by a hidden mark, and older ones by name.

**Reading the numbers.** The Businesses tab shows the true state, Exposure included. A workshop is worth having and isn't a way to print money: on its best line, a small or registered business adds about 40% to 65% to its ordinary profit and pays off in about 20 to 25 weeks, while a company adds under 10%. `npm run simulate:production` shows the working if you want to change the numbers in `businessConfig.js`.

**A company's illegal work** is its officers' secret, as a back room is: others see "Other costs" and "Other income" in the ledger. It adds Exposure, which is what regulators' cases draw on, and fencing there adds twice as much.

### Audit tab

- **Your recent actions:** a log of what you did to the market.
- **Recent trades** lists the latest fills across every portfolio.
- **The self-check** (or `game.nightcity.investments.verify()`) looks over companies, funds, the market, portfolios and the Messenger link, and lists anything broken or odd. It changes nothing.
- **Companies to consider** lists organisations on Messenger contacts and gigs that are not on the market, ready to create in one click.

## Console scripts

For testing or fixing things live, the module's services can be loaded in the browser console on the GM's client:

```js
const { BusinessService } = await import('/modules/night-city-investments/scripts/services/BusinessService.js');
```

Change data only through the services, never by editing flags by hand, so the GM's queue and the hooks stay in step. The public API (`game.nightcity.investments`) is described in [API](API.md).
