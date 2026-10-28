/**
 * Starter funds: simple pooled funds over the starter corporations. Components are tickers.
 * NC12 holds the twelve largest by market cap (see starter-companies.js); a test keeps that true.
 * @file scripts/data/starter-funds.js
 */

export const STARTER_FUNDS = [
  {
    ticker: 'NC12', name: 'Night City 12 Index', kind: 'index', initialNav: 100,
    components: 'ARA 1, MIL 1, BIO 1, DYN 1, NCP 1, PET 1, TTI 1, KIR 1, KEN 1, SOV 1, KAN 1, CON 1',
    expenseRatio: 0.006, loadBps: 60, exitBps: 20, minBuy: 200, rebalance: 'quarterly',
    description: 'The twelve largest listed corporations in equal measure. The broad, boring bet on the city.',
  },
  {
    ticker: 'NC20', name: 'Night City Total Market Fund', kind: 'index', initialNav: 100,
    components: 'ARA 1, MIL 1, BIO 1, DYN 1, NCP 1, PET 1, TTI 1, KIR 1, KEN 1, SOV 1, KAN 1, CON 1, ZIG 1, ROC 1, HAM 1, ORB 1, N54 1, ZHI 1, ZET 1, DGL 1',
    expenseRatio: 0.008, loadBps: 70, exitBps: 25, minBuy: 200, rebalance: 'quarterly',
    description: 'Every listed corporation, big and small. More exposure to the risky end of the market than the NC12.',
  },
  {
    ticker: 'ARMS', name: 'Combat Zone Arms Fund', kind: 'sector', initialNav: 100,
    components: 'MIL 3, KAN 2, ARA 2, DGL 1',
    expenseRatio: 0.009, loadBps: 90, exitBps: 30, minBuy: 300,
    description: 'Weapons makers and security firms. Does best when the streets are loud.',
  },
  {
    ticker: 'CHRM', name: 'Chrome & Steel Cyberware Fund', kind: 'managed', initialNav: 100,
    components: 'DYN 3, KIR 3, KEN 2, ROC 2',
    expenseRatio: 0.012, loadBps: 100, exitBps: 35, minBuy: 300, rebalance: 'monthly', managerAlpha: 0.015, redeemDelay: 2,
    description: 'Actively managed by a team that knows the implant trade. Rises with product launches and falls with recalls and lawsuits; the manager aims to beat the sector by about 1.5% a year. Redemptions take two days.',
  },
  {
    ticker: 'INFR', name: 'Concrete & Copper Infrastructure Fund', kind: 'sector', initialNav: 100,
    components: 'NCP 3, ZIG 3, ZHI 2, PET 1',
    expenseRatio: 0.007, loadBps: 70, exitBps: 25, minBuy: 250, rebalance: 'quarterly',
    description: 'The companies that keep the city running and keep building it. Slow, essential and well paid.',
  },
  {
    ticker: 'SAFE', name: 'Steady Hands Income Fund', kind: 'themed', initialNav: 100,
    components: 'TTI 3, CON 3, NCP 3, PET 2, SOV 2, BIO 2, ZIG 2',
    expenseRatio: 0.007, loadBps: 70, exitBps: 25, minBuy: 250, distribution: 'distributing', distributionFrequency: 'quarterly',
    description: 'Dividend payers and defensive names. Pays its income out as cash every quarter. Slow, steady and hard to shake.',
  },
];
