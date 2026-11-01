# Player guide

How to trade on Night City's market, pool money in a syndicate, found and run your own business. Your GM decides which parts are switched on in your game.

Everything you do is sent to the GM's client, which carries it out. If no GM is online, it waits and happens when one connects. Results show in the window and, where it says so, by Night City Messenger mail.

---

# Part 1. The market

Open the **Market Terminal** from the scene controls (the chart icon in the first group).

## The terminal

- **Market tab:** every company and fund, with its price, the day's move and a trend line. Click a row for the company page: a chart, the 52-week range, dividend terms, the description, the latest news, a watchlist star, and Buy and Sell buttons. Upcoming IPOs and open share offerings are listed below the table.
- **Portfolio tab:** pick your character at the top, then see your balances, holdings with average cost and profit or loss, open and recent orders, the account ledger, your syndicates and your stakes in private businesses. Click a holding to open its market page.
- **News tab:** market headlines, corporate actions and anything the GM posts.

## Your brokerage balance

Trading uses a **brokerage balance**, separate from the eddies on your sheet.

- **Deposit** moves eddies from your sheet into the balance (your GM may charge a small fee).
- **Withdraw** moves them back. With a broker, the withdrawal takes the broker's delay and arrives as claimable eddies in a Messenger mail. With no broker it is immediate.
- Every transfer shows in your sheet's wealth history and the account ledger.
- If your GM uses a settlement delay, sale proceeds count toward your value at once but cannot be spent until they settle.

## Two ways to trade

Choose in the Trade window's "Trade through".

**Through a broker** (cheaper, slower). Pick a broker on the Portfolio tab. A broker's skill sets how many market days an order takes (1 to 5) and their fee, which is always less than trading directly. You can also mail your broker in Night City Messenger:

| Mail | Does |
|---|---|
| `BUY 10 ARA` | buy 10 shares at market |
| `SELL 5 MIL @ 80` | a limit order to sell 5 at 80 eb |
| `SELL ALL ARA` | sell your whole holding |
| `WITHDRAW 5000` | withdraw 5,000 eb |
| `STATUS` | your balance and holdings |
| `STATEMENT` | a full statement |
| `CANCEL <ref>` | cancel an order |
| `HELP` | the list of commands |

Brokers reply and confirm fills in character, in their own voice.

**Direct** (instant, dearer). You need a device on the **CorpNet** network in Night City Messenger (or a terminal grant from the GM). Press **Connect to the market terminal** on the Portfolio tab and roll INT + Accounting + 1d10 against the DV. A pass opens a trading session for a while; a failure locks you out for a time (longer on a fumble).

**Funds** can only be traded through a broker.

## Orders

- **Market:** fill at the current price. Buys fill at the ask, sells at the bid.
- **Limit:** buy at or below, or sell at or above, a price you set.
- **Stop:** sell (or buy) once the price crosses a level.
- **Good for the day** or **until cancelled**. Open orders are listed on the Portfolio tab, where you can cancel them.

A limit or stop that the price reached during a run of ticks fills even if the price has moved away again.

## Funds, dividends and IPOs

- **Funds** hold several companies. Their unit value follows the companies' prices, plus dividends, less a yearly charge. A skilled broker waives more of a fund's entry and exit charges. Some funds pay their income out as cash.
- **Dividends** are paid into your balance on the company's payout day if you held the shares before it was declared. Switch on **reinvestment** per holding to buy more shares with them.
- **IPOs:** a new company can open for subscription before it lists. Press Subscribe and choose how many shares. Your money is held, not spent, until the listing; if the offer is oversubscribed you get fewer shares. A listed player company's **new share offering** works the same way.

## Alerts, statements and notifications

- **Price alerts** (Portfolio tab): be told when a stock or fund rises above or falls below a price, or moves by a set percentage in a day. Once or repeating.
- **Statements:** press **Send me a statement**, or mail `STATEMENT` to your broker. Monthly statements are opt-in.
- **Notifications** (Portfolio tab): choose, per category, mail, chat or off: order results, dividends, price alerts, the monthly statement, big movers, rumours, market headlines and a daily digest.
- **Ticker strip:** a per-user setting that shows a price strip at the top of your screen.

## Insider trading

If your GM tracks it, trading a company in the gap between learning news (a gig you ran, a rumour, your own company's report) and the price moving on it draws **heat**. You never see the number, but you may hear from your broker, then from NCPD Financial Crimes. A watched character's broker orders become slower and dearer, and the worst cases bring a fine, a frozen account or a broker who drops you.

Once warned, you can try to **cover your tracks** from the Portfolio tab. Each attempt is a skill roll (Trading, Accounting, Business or Bribery) that costs eddies whether it works or not.

---

# Part 2. Syndicates

A syndicate is a crew's shared brokerage account.

## Founding and joining

- On the Portfolio tab, **Found a syndicate**, name it and invite other characters. Your GM may need to approve it before anyone pays in.
- Members **pay in** from their own brokerage balance and receive **units** at the syndicate's value per unit.
- To leave, **redeem** units for their value, paid after the settlement delay.

## Running it

- **Officers** trade the syndicate's account from the terminal: in the character list, pick "*syndicate* (as *character*)". Each officer has a **daily limit** for orders and business payments.
- Anything over the limit becomes a **proposal**, decided by a vote of units, as are admitting or removing members, making officers, changing the limit, and dissolving. Proposals last 7 days.
- Members get Messenger mail when proposals open and are decided, and when redemptions are paid.
- **Heat is shared:** the syndicate counts as knowing whatever any member knows.

## In a business

A syndicate can found, join or invest in a player business. Its officers act for it in the Business window (pick the syndicate in the account list): they roll with their own skills and Luck, pay from its account (cash only, no gear), and cast its vote. Payments over an officer's limit go to the members first. Its business stakes count in its value.

---

# Part 3. Player businesses

Open the **Business** window from the scene controls (the shop icon). Pick your character (or a syndicate you are an officer of) at the top.

## Founding a business

1. Press **Start a business**. Choose a name, one of ten kinds (ripperdoc clinic, garage or chop shop, bar or club, info shop, boutique or salon, gun shop, courier service, security outfit, screamsheet, food stall) and a district, which sets foot traffic, rent and risk.
2. Put in **eddies**, and **gear** dragged from your sheet, the Items directory or a compendium (valued at its price). Gear from your sheet moves into the business and comes back if it never opens.
3. **Invite partners.** Each answers and puts in their own. Units follow what each put in, with an optional sweat-equity slice for one partner.
4. Once everyone has answered, any partner makes the **setup roll**. It sets the setup cost and the Capacity the business opens with. Your GM may need to approve it.

## The week

A business week closes on the weekday your GM chose.

- **Actions:** a side business has one action slot a week, a registered business two, and a company three. A side business can Work the shop, Promote, Source supplies, Fix the place up, or Keep it safe. A partner takes the slot and rolls.
- **Help:** partners who do not take a slot can make a complementary check for +1 on it.
- **Events:** a week may bring an event (a shakedown, a breakdown, a rival, an inspection, a big order, a staff problem). A partner answers it with a slot and a roll, or lets it cost the week.
- **The close:** takings go into the business's **cash**, and upkeep, wages and loan payments come out. The **Ledger** tab keeps a digest of each week; click one for its cashbook.
- **Draws:** each partner may draw their share of last week's profit.
- **Standing:** Reputation, Capacity, Cost base and (once registered) Compliance move with your results, and the Overview tab charts them.

## Projects

Agreed by a majority of units, paid from the cash, and finished with **business days** (each partner has three a week):

- **Expansion:** more Capacity.
- **Refit:** a lower Cost base.
- **Security upgrade:** less protection money and fewer break-ins.
- **Storefront:** more Reputation.
- **Staff room:** room for one more employee, and happier staff.

## The roll dialog

Every roll is yours to make, when you press its button. The dialog shows the DV and your chance of each result before you roll, and these levers:

- **Approach:** Careful (safer, smaller effect), Standard, or Bold (bigger swings, and at a company a trail of Exposure).
- **Luck:** spend Luck points from your sheet, +1 each.
- **Help:** +1 if a partner made a complementary check this week.
- **Extra time:** spend a business day for +1.
- **Hire a professional:** a hired skill level, paid from the business's cash.
- **An employee:** call on a staff member's skill, for overtime pay.

Results run from fumble, failure, narrow, solid and strong to exceptional, and the dialog says what each does.

## Money from outside

- **A fixer's loan:** quick, small and dear; agreed by a majority.
- **A bank loan:** for a registered business, after a roll; the result sets how much and at what rate.
- **An investor:** a character, a contact or a syndicate the partners invite to buy in at a price.
- **An angel:** found with an opposed pitch roll.
- **Top-ups:** any partner can add cash, which buys no new units.

## Partners, heirs and closing

- **Decisions** on the Partners tab: most need a majority of units; closing and stepping up need everyone.
- **Name an heir** for your stake.
- **Leaving:** the other partners may buy your units at book value within 14 days; after that they pass to your heir, or lapse.
- **Closing** needs every partner; the money and gear are shared out. A business whose cash stays below zero for two losing weeks closes anyway.

## Growing: registration

On the **Growth** tab, once the checklist is met (4 weeks open, 100 eb a week profit, Reputation 45, and the 500 eb fee), every partner agrees and someone makes the **registration roll**. A registered business has two slots, pays less protection money but dearer rent and licences, and gains a **Compliance** standing.

## Growing: a chartered company

Once registered for 12 weeks, making 400 eb a week, with an expansion done, every partner can agree to **charter**, naming a ticker (the 2,000 eb fee is paid at once). Then three rolls, any partner may make them:

- **Business plan:** your starting Reputation.
- **Registration:** your starting Compliance.
- **Capital structure:** the capital quote. The business's net assets count toward it; a failure refuses the charter.

The GM approves, then the partners pay any shortfall within a funding window. The business becomes a **company**: units become shares and partners become shareholders, with three slots a week and the company actions:

- **Chase contracts:** takings.
- **Tighten the books:** costs.
- **Investor relations:** standing with investors.
- **Permits and compliance:** Compliance.
- **Shortcuts:** more takings now, and a trail of hidden Exposure.

**Officers** run a company, elected and dismissed by a majority of the shares; only officers take its actions. Every four weeks it publishes a **monthly report**, which an officer may prepare (Accounting; Bold dresses it up, at a risk). Each report on the Ledger tab opens to show the real figures beside the reported ones. Officers can **audit** the company's hidden Exposure and run **due diligence** on a rival business.

## Going public

The Growth tab shows the company's **market valuation**: net assets plus a year of reported profit at its sector's multiple. To list:

1. The valuation must hold the listing threshold (500,000 eb unless your GM changed it) on three monthly reports, with a clean record (Compliance, no hidden concerns) and 56 days since the charter.
2. Every shareholder agrees, choosing a **float** (20–40% of the company); the 2% fee is paid.
3. The market accepts the application (the GM's decision).
4. Officers make two **prospectus rolls**: the filing sets the price and the offering sets the demand. A failure ends the attempt.
5. The **IPO** opens on the terminal for five days. On the listing day the float's sale pays the company, and your shares move into your brokerage portfolio, **locked up for 28 days**.

Once listed:

- **The shareholders are whoever holds the shares.** Buying or selling on the terminal changes your vote.
- **Reports move the price** toward the valuation per share.
- **Dividends:** the shareholders vote a payout ratio (30% to start). Each report pays it into everyone's brokerage balance.
- **Selling is limited:** the market buys only a share of the float each day, so a big sale takes days.
- **Officers' and holders' trades** around a report draw insider heat, if your GM tracks it.
- **"View on market"** in the Business window and **"Manage company"** on the terminal link the two.
- A company worth too little for three reports goes **under review**, and the market may delist it, taking it private again.

## Capital: new shares and buybacks

At a company, the **Capital** block on the Shareholders tab offers two proposals, each decided by a majority of the shares:

- **New shares** (5–30% more). A private company offers them to its holders at book value for 14 days, each in proportion to what they hold; what nobody takes lapses. A listed company sells them on the market: an officer's roll sets the discount, and anyone may subscribe on the terminal for five days.
- **A buyback** with a budget from the company's cash. A private company buys at book value from any holder who sells in the next 14 days. A listed company's officer times it with a roll, then the company buys from the market each day until the budget runs out. The shares bought are retired, so everyone's share rises.

## Takeovers

Any character or syndicate can bid for a chartered player company, private or listed.

- **Bidding:** on the terminal's Portfolio tab, under **Takeover bid**, give the company's ticker, a price per share and the most shares you want. The market (your GM) approves the bid first. Then the whole offer is held from your brokerage balance while it is open for 7 days.
- **At the close** you buy what holders tendered, up to the shares you asked for (scaled down if more came in). What you did not spend comes back to your balance.
- **Holders** see the offer in the **Takeover** block on the Shareholders tab, and choose how many shares to tender (you can change it until the close). Shares still locked up after a listing cannot be tendered. Anything sold is paid into your brokerage balance.
- **NPC holders and the market's float** tender all their shares if the premium over the reference price is 20% or more, half at 10–20%, and none below. The reference is the market price, or book value per share for a private company.
- **Defence:** the target's officers may make one defence roll (Persuasion or Business). A good result makes NPC holders and the float want a higher premium; a fumble makes them keener.
- **Control:** a bidder who ends with more than half the shares controls the votes, and can elect and dismiss officers. Holders who did not tender keep their shares.

## Insolvency

A company (chartered or listed) whose debts (its loans, the wages it owes and any overdraft) are more than its cash and assets at two weekly closes in a row goes into **administration**. A banner on the Business window says so.

- **While in administration** nobody can take actions, draw, vote, issue or buy back shares, or bid and tender. The weeks still close, and the takings, costs and events carry on. A listed company pays no dividend, and its price takes a hit.
- **Rescue it** by putting cash in from the Ledger tab. If its net assets are above zero at a weekly close, it comes out of administration by itself.
- **Otherwise the market (your GM) decides:**
  - **Restructuring** writes the debts off in exchange for new shares, held by the creditors with no vote. Your shares become a smaller part of the company, and its Reputation and Compliance drop.
  - **Winding up** sells the assets at half their value. Owed wages are paid first, then the loans, then whatever is left goes to the holders by shares: in eddies for a private company, or into brokerage balances for a listed one. Then the business closes.

Side and registered businesses don't go into administration: they still close when their cash stays below zero for two losing weeks.

## Employees

A business can take on staff: one at a side business, three for registered, eight as a company. Open roles are on the **Staff** tab.

- **Who:** a player character, an NPC your GM has tagged as staff in Messenger, or a recruit found by **advertising** (a recruiting roll brings applicants). **Vetting** shows their real skill and any hidden traits.
- **Roles:** floor staff lift the takings, a manager works the shop when no partner does, security answers trouble nobody answered, and a bookkeeper helps with the books. A company adds sales, publicist and compliance roles.
- **Pay:** a weekly wage that follows their skill, offered at 80–150% of the going rate. Partners can call any employee in for one of the week's rolls, for overtime.
- **Loyalty** (NPCs): paid weeks, good months, bonuses, training and share grants raise it. Missed wages, extra shifts, pay cuts and refused raises lower it. Sullen staff steal and quit; devoted staff try harder.
- **Manage** an employee for pay, bonuses, moving role, **training** (a course, or mentoring by a more skilled partner who rolls Education) and letting them go.
- **Share grants:** at a company, the shareholders can grant an employee shares, which vest after 12 weeks.
- **An Exec's team:** an Exec partner can bring their Teamwork team onto the staff. Name new members, or drag NPC actors into the Hire window. They are unpaid and loyal, and they leave with the Exec.

## Working for someone else's business

A player character can take a job at another player's business.

- Accept or quit it in your own Business window, where the **Job** view shows it.
- Your wage arrives on a weekly **payslip** by Messenger, with the money attached to claim, plus any overtime.
- A partner may put you **on call**: they ask you for one of the week's rolls, and you make it from your Job view with your own skills and Luck.
