/**
 * Starter companies: well-known Cyberpunk RED corporations with generic, original descriptions.
 * Ratings are starting points; the GM can edit or delete any of them.
 *
 * `shares` is shares outstanding in millions. Together with the price it sets the market cap, which
 * is what "largest corporations" means for the NC12 index in starter-funds.js.
 * @file scripts/data/starter-companies.js
 */

const co = (ticker, name, sector, initialPrice, shares, volatility, beta, liquidity, dividend, lore, aliases = []) => ({
  ticker, name, sector, initialPrice, sharesOutstanding: shares * 1_000_000, volatility, beta, liquidity, dividend, lore, aliases,
});

const div = (policy, frequency, value) => (policy === 'none'
  ? { policy: 'none' }
  : { policy, frequency, ...(policy === 'fixed' ? { perShare: value } : { yield: value }), payoutDay: 1 });

export const STARTER_COMPANIES = [
  co('ARA', 'Arasaka', 'security', 180, 5, 5, 1.4, 2, div('none'),
    'The old giant of corporate security and banking, its Night City tower a nuclear ruin since the war. Pulled back to Japan and split by a brewing succession fight, it trades thin here, on rumours of its return.', ['Arasaka Corporation']),
  co('MIL', 'Militech', 'arms', 180, 6, 4, 1.3, 4, div('yield', 'quarterly', 0.015),
    'A major arms manufacturer and military contractor. Share price tends to swing with every flare-up of conflict.', ['Militech International Armaments']),
  co('BIO', 'Biotechnica', 'biotech', 130, 6, 3, 0.9, 4, div('fixed', 'quarterly', 0.8),
    'An agricultural and genetic engineering giant that feeds much of the city. Trades on food supply and patent news.', ['Biotechnica Corp']),
  co('PET', 'Petrochem', 'energy', 95, 7, 2, 0.8, 4, div('yield', 'monthly', 0.03),
    'The energy MegaCorp behind CHOOH2, smaller since Continental split away with half its gas stations. Still a reliable dividend payer that moves with fuel prices.', []),
  co('TTI', 'Trauma Team International', 'health', 110, 4, 2, 0.6, 3, div('yield', 'quarterly', 0.025),
    'Premium emergency medical response sold by subscription. Defensive, and rarely the first to fall.', ['Trauma Team']),
  co('KAN', 'Kang Tao', 'arms', 75, 5.5, 4, 1.2, 3, div('none'),
    'A smart-weapons manufacturer that favours growth over payouts.', []),
  co('KEN', 'Kendachi', 'tech', 85, 5, 3, 1.1, 3, div('fixed', 'annual', 2),
    'A cybernetics and consumer-electronics maker with a loyal customer base.', ['Kendachi Mercantile']),
  co('ZET', 'Zetatech', 'tech', 60, 1.5, 5, 1.6, 2, div('none'),
    'A high-risk electronics and computing firm. Thinly traded and prone to wild swings.', []),
  co('ORB', 'Orbital Air', 'transport', 45, 5, 3, 1.0, 3, div('fixed', 'quarterly', 0.25),
    'An airline and orbital transport operator. Sensitive to travel demand and fuel costs.', []),
  co('SOV', 'SovOil', 'energy', 70, 6, 3, 0.9, 3, div('yield', 'quarterly', 0.03),
    'An oil and gas producer with long-running regional ties.', []),
  co('CON', 'Continental Brands', 'consumer', 55, 7, 2, 0.7, 4, div('fixed', 'quarterly', 0.4),
    'Food and consumer goods, and the Oasis stores: one of the few reliable places to buy groceries. Communities that cross it pay more, for less. Slow, steady and not as harmless as it looks.', ['Oasis']),
  co('N54', 'Network 54', 'media', 40, 5, 4, 1.0, 3, div('none'),
    'A news and entertainment network. Ratings and scandals move the price.', ['Network 54 News']),
  co('ZHI', 'Zhirafa Technical Manufacturing', 'construction', 65, 3, 3, 1.0, 3, div('fixed', 'annual', 1.2),
    'A Russian maker of cheap, tough, customisable construction bots. Its machines raise half the skyline and clear what is left of the old one, and it moves cargo where bigger firms cannot. Orders follow city building booms.', ['Zhirafa']),
  co('ZIG', 'Ziggurat', 'tech', 95, 4, 3, 1.1, 3, div('yield', 'quarterly', 0.015),
    'The NeoCorp that builds the air-gapped CitiNets and apps the city runs on, the market\'s own local exchange among them. Born in Night City and spreading across North America. Essential and hard to replace.', []),
  co('ROC', 'Rocklin Augmentics', 'biotech', 125, 2, 4, 1.2, 3, div('none'),
    'Cyberlimbs with a look all their own, and a rising NeoCorp thanks to its deals with the Nomads. A growth story that reinvests everything and lives or dies on its next product line.', ['Rocklin']),
  co('DGL', 'Danger Gal', 'security', 35, 1, 4, 0.9, 2, div('none'),
    'Night City\'s premier investigation and security NeoCorp, with a small, loyal client list. Thinly traded, and a single high-profile case can move the price.', ['Danger Girl']),
  co('DYN', 'Dynalar Technologies', 'tech', 150, 5, 3, 1.2, 4, div('yield', 'quarterly', 0.01),
    'One of the best-known cyberware manufacturers, with a catalogue that runs from street-level implants to executive chrome. Rides on product launches and recalls.', ['Dynalar']),
  co('HAM', 'Hammered Industries', 'consumer', 50, 5, 3, 0.8, 3, div('fixed', 'quarterly', 0.3),
    'Consumer goods and narcotics under one roof. Demand holds up in any weather, but a raid or a bad batch makes the headlines.', ['Hammered']),
  co('KIR', 'Kiroshi Optical', 'tech', 110, 4, 3, 1.1, 4, div('fixed', 'annual', 1.5),
    'The specialist in optical cyberware: eyes, overlays and the software behind them. A premium brand with a steady upgrade cycle.', ['Kiroshi']),
  co('NCP', 'Night Corp', 'construction', 80, 9, 2, 0.8, 4, div('yield', 'quarterly', 0.025),
    'Manages the city\'s infrastructure: power, water, transit and the roads in between. A utility-style stock that pays out and moves slowly.', ['Night Corporation']),
];
