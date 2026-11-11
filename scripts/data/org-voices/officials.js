/**
 * Official senders' voices (M3 step 2): the exchange, the regulator, the insolvency court, NCPD and the city, and a
 * fixer's collectors. Each has a reference for the subject ({ref} is a number that stays with the matter), optional
 * sign-offs, and three lines for each kind of mail. Every line carries the mail's facts. English only.
 */

export const OFFICIALS = Object.freeze({
  exchange: {
    ref: 'NCX Notice {ref}',
    signoffs: ['Listings Desk, Night City Exchange', 'Night City Exchange, Market Operations', 'NCX Listings and Disclosure'],
    review: {
      again: [
        '{name} ({ticker}) is under review again: its market value of {value} eb has been below the {floor} eb floor for {n} reports since the last review was cleared. The Exchange will not extend its patience indefinitely.',
        'A second listing review, {name} ({ticker}). Market value {value} eb, floor {floor} eb, {n} reports below it. The previous review was closed in the company\'s favour; this one may not be.',
      ],
      deep: [
        '{name} ({ticker}) is valued at {value} eb, far below the {floor} eb listing floor, for {n} reports running. The listing is under review, and the gap is wide.',
        'Listing review opened: {name} ({ticker}), at {value} eb against a {floor} eb floor for {n} reports. At this distance from the floor, delisting is a real prospect.',
      ],
      lines: [
        'Notice is given that {name} ({ticker}) has closed below the {floor} eb listing floor for {n} consecutive reports, at a market value of {value} eb. The listing is under review and may be withdrawn, with the company taken private.',
        '{name} ({ticker}) is valued at {value} eb, under the {floor} eb floor for {n} reports running. The Exchange has opened a review of its listing; delisting is one possible outcome.',
        'Listing review opened: {name} ({ticker}). Market value {value} eb against a floor of {floor} eb, for {n} reports in a row. A decision on its continued listing will follow.',
      ],
    },
    delisted: {
      borrowed: [
        '{name} ({ticker}) has been removed from the Exchange. The company bought back its public float, partly with borrowed money.',
        'Delisting complete: {name} ({ticker}). The buyback of its float was financed in part by a loan, and trading has ended.',
      ],
      lines: [
        '{name} ({ticker}) has been removed from the Exchange. The company has repurchased its public float.',
        'Delisting complete: {name} ({ticker}). Its public shares have been bought back by the company, and trading has ended.',
        'With effect from today, {name} ({ticker}) is no longer listed. The company has taken its float back in-house.',
      ],
    },
    open: {
      generous: [
        'A tender offer has been registered for {name}: {bidder} offers {price} eb a share for up to {shares} shares, open until {date}. At a {premium}% premium, the market is likely to find it attractive.',
        'Tender offer, {name}. Bidder: {bidder}. Price: {price} eb a share, a substantial {premium}% premium. Maximum: {shares} shares. Closes: {date}.',
      ],
      thin: [
        'A tender offer has been registered for {name}: {bidder} offers {price} eb a share for up to {shares} shares, until {date}. The premium is a thin {premium}%.',
        'Tender offer, {name}. Bidder: {bidder}. Price: {price} eb a share, only {premium}% over the reference. Maximum: {shares} shares. Closes: {date}.',
      ],
      lines: [
        'A tender offer has been registered for {name}: {bidder} offers {price} eb a share for up to {shares} shares, a {premium}% premium, open until {date}.',
        'Tender offer, {name}. Bidder: {bidder}. Price: {price} eb a share, a {premium}% premium. Maximum: {shares} shares. Closes: {date}.',
        '{bidder} has made a tender offer for {name} at {price} eb a share ({premium}% over market), for up to {shares} shares. Holders may tender until {date}.',
      ],
    },
    approved: {
      generous: [
        'Your tender offer for {name} is registered: {price} eb a share for up to {shares} shares, open until {date}. {escrow} eb is in escrow. A {premium}% premium should draw sellers.',
        'Offer accepted for registration. {name}: {price} eb a share, a {premium}% premium, up to {shares} shares, until {date}. Escrow of {escrow} eb is held from your brokerage balance.',
      ],
      thin: [
        'Your tender offer for {name} is registered: {price} eb a share for up to {shares} shares, until {date}, with {escrow} eb in escrow. At {premium}% over the reference, holders may not be tempted.',
        'Offer accepted for registration. {name}: {price} eb a share, up to {shares} shares, until {date}. Escrow: {escrow} eb. The Exchange notes the premium is only {premium}%.',
      ],
      lines: [
        'Your tender offer for {name} is registered: {price} eb a share for up to {shares} shares, open until {date}. {escrow} eb has been placed in escrow from your brokerage balance.',
        'Offer accepted for registration. {name}: {price} eb a share, up to {shares} shares, until {date}. Escrow of {escrow} eb is held from your brokerage balance.',
        'The Exchange has opened your bid for {name} at {price} eb a share, for up to {shares} shares, closing {date}. {escrow} eb is held in escrow against it.',
      ],
    },
    unfunded: { lines: [
      'Your bid for {name} has lapsed: your brokerage balance could not cover the {escrow} eb escrow it requires.',
      'Bid lapsed, {name}. Required escrow of {escrow} eb was not available in your brokerage balance.',
      'The Exchange could not take {escrow} eb in escrow from your brokerage balance, so your bid for {name} has lapsed.',
    ] },
    rejected: { lines: [
      'The Exchange has declined to register your takeover bid for {name}.',
      'Your tender offer for {name} has been refused registration.',
      'Bid refused: {name}. The Exchange will not open your offer.',
    ] },
    closed: {
      nothing: [
        "{bidder}'s offer for {name} has closed with no shares bought. Any shares you tendered remain yours.",
        'Tender offer closed, {name}: {bidder} acquired no shares. Nothing has changed hands.',
      ],
      defended: [
        "{bidder}'s offer for {name} has closed short of control, after the company's officers resisted it: {shares} shares bought at {price} eb. Anything you tendered has been paid into your brokerage balance.",
        'Tender offer closed, {name}. Against the board\'s opposition, {bidder} acquired {shares} shares at {price} eb, not enough for control. Proceeds for shares you tendered are in your brokerage balance.',
      ],
      lines: [
        "{bidder}'s offer for {name} has closed: {shares} shares bought at {price} eb. Anything you tendered has been paid into your brokerage balance.",
        'Tender offer closed, {name}. {bidder} acquired {shares} shares at {price} eb each. Proceeds for shares you tendered are in your brokerage balance.',
        "The offer for {name} is complete. {bidder} bought {shares} shares at {price} eb; your tendered shares, if any, have been settled to your brokerage balance.",
      ],
    },
    control: {
      defended: [
        "{bidder}'s offer for {name} has closed, and despite the officers' defence, {bidder} now controls the company with {shares} shares bought at {price} eb. Anything you tendered has been paid into your brokerage balance.",
        'Change of control, {name}, over the opposition of its officers. {bidder} acquired {shares} shares at {price} eb. Proceeds for shares you tendered are in your brokerage balance.',
      ],
      lines: [
        "{bidder}'s offer for {name} has closed: {shares} shares bought at {price} eb, and {bidder} now controls the company. Anything you tendered has been paid into your brokerage balance.",
        'Change of control, {name}. {bidder} acquired {shares} shares at {price} eb and now holds control. Proceeds for shares you tendered are in your brokerage balance.',
        'The offer for {name} is complete, and control has passed to {bidder}, who bought {shares} shares at {price} eb. Your tendered shares, if any, have been settled to your brokerage balance.',
      ],
    },
    bidderClosed: {
      nothing: [
        'Your offer for {name} has closed with no shares tendered. The full {refund} eb escrow has been returned to your brokerage balance.',
        'Offer closed, {name}: no shares acquired. Escrow returned in full: {refund} eb.',
      ],
      defended: [
        "Your offer for {name} has closed short of control after the company's officers fought it: you bought {shares} shares at {price} eb. {refund} eb of the escrow has been returned to your brokerage balance.",
        'Offer settled against the target\'s defence, {name}. Acquired: {shares} shares at {price} eb. Escrow returned: {refund} eb.',
      ],
      lines: [
        'Your offer for {name} has closed: you bought {shares} shares at {price} eb. {refund} eb of the escrow has been returned to your brokerage balance.',
        'Offer settled, {name}. Acquired: {shares} shares at {price} eb. Escrow returned: {refund} eb.',
        'Your tender offer for {name} is complete, with {shares} shares bought at {price} eb each. The unused {refund} eb of escrow is back in your brokerage balance.',
      ],
    },
    bidderControl: {
      defended: [
        "Your offer for {name} has closed, and despite its officers' defence, you bought {shares} shares at {price} eb and now control the company. {refund} eb of the escrow has been returned to your brokerage balance.",
        'Change of control, {name}, against the board\'s opposition: you acquired {shares} shares at {price} eb and hold control. Escrow returned: {refund} eb.',
      ],
      lines: [
        'Your offer for {name} has closed: you bought {shares} shares at {price} eb and now control the company. {refund} eb of the escrow has been returned to your brokerage balance.',
        'Change of control, {name}: you acquired {shares} shares at {price} eb and hold control. Escrow returned: {refund} eb.',
        'Your offer for {name} is complete. With {shares} shares bought at {price} eb, control is yours. The unused {refund} eb of escrow is back in your brokerage balance.',
      ],
    },
  },

  regulator: {
    ref: 'Case NC-REG-{ref}',
    signoffs: ['Business Regulation Office, City of Night City', 'Office of Business Regulation, Compliance Division', 'BRO Case Management'],
    open: { lines: [
      'We have opened a case against {name}: {why}. A response from an officer of the company is required by {date}.',
      'This office has grounds to examine {name}: {why}. An officer of the company must respond no later than {date}.',
      'Notice of investigation: {name}. Grounds: {why}. Response due from a company officer by {date}.',
    ] },
    won: { lines: [
      'Our case against {name} is closed. We found nothing we could use.',
      'Following review of the response, the case against {name} is closed with no further action.',
      'Case closed: {name}. The company has satisfied this office, for now.',
    ] },
    lost: { lines: [
      'Our case against {name} has been decided against the company. A penalty will follow.',
      "The company's response did not satisfy this office. The case against {name} is upheld, and a penalty is being determined.",
      'Finding against {name}. Notice of penalty will follow separately.',
    ] },
    silent: { lines: [
      'No response to our case against {name} was received by the deadline, so it has been decided against the company. A penalty will follow.',
      'The deadline in the case against {name} has passed without a response. The case is upheld by default, and a penalty is being determined.',
      'No officer of {name} responded in time. The finding is against the company; notice of penalty will follow.',
    ] },
    dropped: { lines: [
      'Our case against {name} has been dropped.',
      'This office has withdrawn its case against {name}. No further action will be taken.',
      'Case withdrawn: {name}.',
    ] },
    fined: { lines: [
      '{name} has been fined {fine} eb.',
      'Notice of penalty: {name} is fined {fine} eb.',
      'Following the finding against it, {name} is ordered to pay a penalty of {fine} eb.',
    ] },
  },

  court: {
    ref: 'Matter NCIC-{ref}',
    signoffs: ["Night City Insolvency Court, Administrator's Office", 'Office of the Court-Appointed Administrator', 'NCIC Insolvency Registry'],
    in: { lines: [
      '{name} has had more debts than assets for two weekly closes (net assets {net} eb), and has been placed in administration.',
      'I have been appointed administrator of {name}, whose liabilities have exceeded its assets for two weekly closes (net assets {net} eb).',
      'By order of this court, {name} is in administration. Net assets stood at {net} eb at two successive weekly closes.',
    ] },
    out: { lines: [
      "{name}'s net assets are above zero again, and its administration has ended.",
      '{name} is solvent once more. The administration is discharged with immediate effect.',
      'Administration of {name} is ended: its net assets have returned above zero.',
    ] },
    restructured: { lines: [
      '{name} has been restructured: of its {debts} eb of debts, {paid} eb was paid from its cash, and the rest became {shares} new shares held by its creditors, without a vote. Any new shares make yours a smaller part of the company. It is out of administration.',
      'Restructuring of {name} is complete. {paid} eb of its {debts} eb debts was paid in cash; the balance was converted into {shares} new shares issued to creditors, diluting existing holders. The administration is discharged.',
      'By order of this court, {name} is restructured: {paid} eb of {debts} eb owed was settled from cash, and the remainder exchanged for {shares} new creditor shares. Existing holdings are diluted accordingly. Administration ends.',
    ] },
    woundUp: { lines: [
      '{name} has been wound up. Its assets were sold; {wages} eb went to wages owed and {loans} eb to its lenders, and what was left was shared out at {perShare} eb a share, paid to you in eddies.',
      'Liquidation of {name} is complete. From the sale of its assets, {wages} eb settled wages owed and {loans} eb its lenders. The remainder was distributed at {perShare} eb a share, paid to you directly.',
      '{name} is dissolved by order of this court. Wages owed received {wages} eb, lenders {loans} eb, and holders {perShare} eb a share, which has been paid to you.',
    ] },
    woundUpListed: { lines: [
      "{name} has been wound up. Its assets were sold; {wages} eb went to wages owed and {loans} eb to its lenders, and what was left was paid at {perShare} eb a share into holders' brokerage balances. Its shares have left their portfolios.",
      "Liquidation of {name} is complete. {wages} eb settled wages owed and {loans} eb its lenders; holders received {perShare} eb a share in their brokerage balances, and the shares are cancelled.",
      "{name} is dissolved by order of this court. Wages owed received {wages} eb, lenders {loans} eb, and shareholders {perShare} eb a share, paid to their brokerage balances. The shares no longer exist.",
    ] },
  },

  vice: {
    ref: 'NCPD Vice ref. V-{ref}',
    signoffs: ['NCPD Vice, Organised Crime Unit', 'Det. Sgt., NCPD Vice', 'NCPD Vice Division'],
    bust: { lines: [
      'NCPD has reason to believe the premises of {name} are being used for illegal activity. Officers will be attending.',
      'Acting on information received, NCPD Vice will search the premises of {name}. Do not obstruct the officers.',
      'This is notice that NCPD Vice is investigating illegal activity at {name}. Expect officers this week.',
    ] },
    won: { lines: [
      'Officers found no grounds for further action at {name}. The matter is closed, for now.',
      'The search of {name} produced nothing actionable. The file stays open.',
      'No evidence was recovered at {name}. Consider yourself lucky.',
    ] },
    lost: { lines: [
      'Officers seized {seized} eb in illicit funds at {name}, and a fine of {fine} eb has been issued.',
      'The search of {name} recovered {seized} eb in proceeds of crime, now seized. A penalty of {fine} eb is imposed.',
      'Seizure notice, {name}: {seized} eb confiscated. Fine: {fine} eb.',
    ] },
    shut: { lines: [
      'Officers seized {seized} eb in illicit funds at {name}, a fine of {fine} eb has been issued, and the operation has been closed down.',
      'The illegal operation at {name} has been shut down. {seized} eb seized; a {fine} eb penalty imposed.',
      'Closure notice, {name}: the illicit operation is closed, {seized} eb confiscated, fine {fine} eb.',
    ] },
  },

  financialCrimes: {
    ref: 'NCPD FC ref. FC-{ref}',
    signoffs: ['NCPD Financial Crimes', 'Financial Crimes Division, NCPD', 'NCPD FC, Disclosure Enforcement'],
    unmasked: { lines: [
      'Financial Crimes has looked behind the layers over your {pct}% of {name} ({ticker}), above the 5% disclosure threshold. Your holding is now on the register under your own name, and you have been fined {fine} eb.',
      'Your concealed holding of {pct}% in {name} ({ticker}) exceeded the 5% disclosure threshold. It has been entered on the register in your name, with a penalty of {fine} eb.',
      'Undisclosed beneficial ownership: {pct}% of {name} ({ticker}), above the 5% threshold. The holding is now registered to you. Fine: {fine} eb.',
    ] },
  },

  city: {
    ref: 'Inspection NCB-{ref}',
    signoffs: ['Night City Inspections, City of Night City', 'Building and Licensing Inspectorate', 'City Inspections, Licensing Division'],
    inspection: { lines: [
      'Notice of inspection: {name} is due an inspection this week. Have your licences and records ready.',
      'Routine inspection scheduled: {name}. An inspector will call this week to review licences, books and premises.',
      'This is notice that {name} will be inspected this week. Failure to cooperate is an offence.',
    ] },
    raid: { lines: [
      'Notice of inspection: following a report, officers will attend {name} this week. Have your licences and records ready.',
      'Acting on information received, the Inspectorate will examine {name} this week. A full review of licences and records is required.',
      'A complaint has been lodged concerning {name}. Inspectors will attend this week; all records must be available.',
    ] },
    inspectionAnswer: {
      stopped: ["Inspection complete: {name} meets its licence conditions.", "No breaches were found at {name}.", "The inspection of {name} is closed with no further action."],
      halved: ["Inspection complete: minor breaches found at {name}. A notice follows.", "{name} was found partly compliant.", "Some conditions were not met at {name}."],
      full: ["Inspection complete: {name} is in breach of its licence conditions.", "Serious breaches were recorded at {name}.", "{name} failed inspection."],
    },
    raidAnswer: {
      stopped: ["The inspection prompted by a report found nothing actionable at {name}.", "The complaint against {name} is not upheld.", "No breach found at {name}. The report is closed."],
      halved: ["The report against {name} is partly upheld.", "Some irregularities were found at {name}.", "Minor breaches recorded at {name}."],
      full: ["The report against {name} is upheld. Breaches recorded.", "{name} was found in breach following the report.", "The complaint against {name} is upheld in full."],
    },
  },

  collections: {
    ref: 'Account {ref}',
    collectors: { lines: [
      'You missed a payment. Some friends of ours will be coming by {name} to talk about it.',
      "Your payment didn't arrive. We're sending someone round to {name} to see why.",
      'Late is late. Expect company at {name} this week.',
    ] },
    collectorsAnswer: {
      stopped: ["We had a nice chat. Keep your payments on time.", "Understanding reached. Pay on time.", "We're square. Don't be late again."],
      halved: ["Some understanding was reached. Not enough.", "Our friends made their point. Partly.", "You'll pay the rest."],
      full: ["Our friends made their point. Pay on time.", "That was a lesson. Learn it.", "Next time we won't be so gentle."],
    },
  },
});
