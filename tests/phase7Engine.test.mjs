import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameData, MIGRATIONS, latestSchemaVersion, pendingMigrations, runMigrations,
  tradeLog, suggestCompanies, suggestTicker, SUGGEST_EXCLUDE, verifyWorld, VERIFY_CHECKS, VERIFY_LEVELS,
  sanitizeCompany, emptyPortfolio, normalizePortfolio, emptyHeat, emptyGigs, emptyControls,
} from '../scripts/engine/index.js';
import { STARTER_COMPANIES } from '../scripts/data/starter-companies.js';
import { STARTER_FUNDS } from '../scripts/data/starter-funds.js';

// ── Migrations ───────────────────────────────────────────────────────────────

test('sameData compares by content, not key order', () => {
  assert.equal(sameData({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true);
  assert.equal(sameData({ a: 1 }, { a: 1, b: 0 }), false);
  assert.equal(sameData([1, 2], [2, 1]), false);
  assert.equal(sameData({ a: [] }, { a: {} }), false);
  assert.equal(sameData(null, null), true);
  assert.equal(sameData(null, {}), false);
});

const makeCtx = ({ portfolios = [], stores = {} } = {}) => {
  const saved = { portfolios: {}, stores: {}, versions: [] };
  return {
    saved,
    portfolios: () => portfolios,
    savePortfolio: (id, d) => { saved.portfolios[id] = d; },
    stores: () => stores,
    saveStore: (name, d) => { saved.stores[name] = d; },
    saveVersion: (n) => { saved.versions.push(n); },
  };
};

test('the latest schema version is the highest step, and steps run oldest first', () => {
  assert.equal(latestSchemaVersion(), Math.max(...MIGRATIONS.map((m) => m.version)));
  assert.equal(latestSchemaVersion([]), 1);
  const steps = [{ version: 4 }, { version: 2 }, { version: 3 }];
  assert.deepEqual(pendingMigrations(2, steps).map((s) => s.version), [3, 4]);
  assert.deepEqual(pendingMigrations(4, steps), []);
});

test('the normalise step rewrites old portfolios and stores, and leaves current ones alone', async () => {
  const { schema, ...old } = emptyPortfolio();
  delete old.heatAware; delete old.brokerBans; delete old.unsettled; delete old.alerts;
  const ctx = makeCtx({
    portfolios: [
      { id: 'a1', name: 'Old', data: { ...old, cash: 500 } },
      { id: 'a2', name: 'Current', data: emptyPortfolio() },
    ],
    stores: { controls: { schema: 1, biases: [] }, gigs: emptyGigs(), heat: { schema: 1, characters: {} }, },
  });
  const out = await runMigrations({ from: 1, ctx });
  assert.equal(out.ok, true);
  assert.equal(out.version, latestSchemaVersion());
  assert.deepEqual(Object.keys(ctx.saved.portfolios), ['a1'], 'only the stale portfolio is rewritten');
  assert.equal(ctx.saved.portfolios.a1.cash, 500, 'its data is kept');
  assert.deepEqual(ctx.saved.portfolios.a1.unsettled, []);
  assert.equal(ctx.saved.portfolios.a1.heatAware, false);
  assert.deepEqual(Object.keys(ctx.saved.stores).sort(), ['controls', 'heat'], 'the gigs store was already current');
  assert.deepEqual(ctx.saved.stores.heat.windows, []);
  assert.deepEqual(ctx.saved.versions, [latestSchemaVersion()]);
  assert.equal(out.applied[0].portfolios, 1);
});

test('migrating is idempotent: a second run changes nothing', async () => {
  const stale = { ...emptyPortfolio(), alerts: undefined, cash: 5 };
  delete stale.alerts;
  const first = makeCtx({ portfolios: [{ id: 'a', name: 'A', data: stale }] });
  await runMigrations({ from: 1, ctx: first });
  const rewritten = first.saved.portfolios.a;
  const second = makeCtx({ portfolios: [{ id: 'a', name: 'A', data: rewritten }], stores: { controls: emptyControls(), heat: emptyHeat() } });
  const out = await runMigrations({ from: 1, ctx: second });
  assert.deepEqual(second.saved.portfolios, {});
  assert.deepEqual(second.saved.stores, {});
  assert.equal(out.applied[0].portfolios, 0);
});

test('a world already on the latest version runs nothing, and a newer one is left alone', async () => {
  const ctx = makeCtx({ portfolios: [{ id: 'a', name: 'A', data: { cash: 1 } }] });
  const now = await runMigrations({ from: latestSchemaVersion(), ctx });
  assert.deepEqual([now.ok, now.applied.length, ctx.saved.versions.length], [true, 0, 0]);
  const newer = await runMigrations({ from: 99, ctx });
  assert.deepEqual([newer.ok, newer.newer, newer.version, newer.applied.length], [true, true, 99, 0]);
  assert.deepEqual(ctx.saved.portfolios, {}, 'nothing is rewritten by an older module');
  const junk = await runMigrations({ from: 'x', ctx: makeCtx() });
  assert.equal(junk.from, 1, 'a bad stored version counts as 1');
});

test('a failing step stops the run, keeps earlier progress, and reports which step failed', async () => {
  const versions = [];
  const steps = [
    { version: 2, id: 'one', up: async () => ({ done: true }) },
    { version: 3, id: 'two', up: async () => { throw new Error('boom'); } },
    { version: 4, id: 'three', up: async () => { versions.push('ran'); } },
  ];
  const out = await runMigrations({ from: 1, steps, ctx: { saveVersion: (n) => versions.push(n) } });
  assert.equal(out.ok, false);
  assert.deepEqual(out.failed, { version: 3, id: 'two', error: 'boom' });
  assert.equal(out.version, 2, 'the world stays on the last good version');
  assert.deepEqual(versions, [2]);
  assert.deepEqual(out.applied.map((a) => a.id), ['one']);
});

// ── Trade log ────────────────────────────────────────────────────────────────

const order = (id, o) => ({ id, status: 'filled', side: 'buy', assetId: 'ARA', qty: 10, fillPrice: 100, fees: 5, route: 'direct', filledTick: 1, ...o });

test('the trade log lists only fills, newest first, across portfolios', () => {
  const entries = [
    { actorId: 'a', name: 'Alice', portfolio: { orders: [order('o1', { filledTick: 3 }), order('o2', { status: 'cancelled' }), order('o3', { status: 'open' }), order('o4', { filledTick: 7, side: 'sell', qty: 4, fillPrice: 125.5, realized: 50 })] } },
    { actorId: 'b', name: 'Bob', portfolio: { orders: [order('o5', { filledTick: 7, assetId: 'MIL', route: 'broker', brokerId: 'c1' })] } },
    { actorId: 'c', name: 'Cy', portfolio: null },
  ];
  const rows = tradeLog(entries);
  assert.deepEqual(rows.map((r) => r.orderId), ['o4', 'o5', 'o1']);
  assert.equal(rows[0].gross, 502);
  assert.equal(rows[0].realized, 50);
  assert.deepEqual([rows[1].route, rows[1].brokerId], ['broker', 'c1']);
  assert.deepEqual(tradeLog(entries, { actorId: 'b' }).map((r) => r.name), ['Bob']);
  assert.deepEqual(tradeLog(entries, { assetId: 'MIL' }).map((r) => r.orderId), ['o5']);
  assert.equal(tradeLog(entries, { limit: 1 }).length, 1);
});

// ── Suggestions ──────────────────────────────────────────────────────────────

const COMPANIES = STARTER_COMPANIES.map(({ lore, ...c }) => sanitizeCompany(c).company);

test('tickers are short, readable and never clash', () => {
  assert.equal(suggestTicker('Kerosene Dynamics'), 'KER');
  assert.equal(suggestTicker('Kerosene Dynamics', ['KER']), 'KD');
  assert.equal(suggestTicker('Kerosene Dynamics', ['KER', 'KD']), 'KERO');
  assert.equal(suggestTicker('The Bank of Night City'), 'BAN');
  assert.match(suggestTicker('Ab', ['AB']), /^AB\d$/);
  const taken = ['AAA', 'AA', 'AAAA'];
  assert.match(suggestTicker('Aaaa', taken), /^AAA\d$/);
  assert.ok(suggestTicker('!!!').length >= 2, 'even a name with no letters gets something');
});

test('suggestions skip known companies, system organisations, ignored names and near-misses', () => {
  const sources = [
    { name: 'Arasaka', from: 'contact' },
    { name: 'Arasaka Corporation', from: 'gig' },
    { name: 'Night City Market', from: 'contact' },
    { name: 'NCPD', from: 'contact' },
    { name: 'Hexagon Logistics', from: 'contact' },
    { name: 'Hexagon Logistics', from: 'gig' },
    { name: 'hexagon logistics.', from: 'gig' },
    { name: 'Cobalt Freight', from: 'gig' },
    { name: 'Orbital Air', from: 'contact' },
    { name: '', from: 'contact' },
    { name: 'X', from: 'contact' },
  ];
  const mappings = { 'orbital air': { companyId: 'ignore' } };
  const out = suggestCompanies(sources, COMPANIES, { mappings });
  assert.deepEqual(out.map((s) => s.name), ['Hexagon Logistics', 'Cobalt Freight']);
  assert.equal(out[0].count, 3, 'spellings are merged');
  assert.deepEqual(out[0].from, ['contact', 'gig']);
  assert.equal(new Set(out.map((s) => s.ticker)).size, 2, 'each suggestion has its own ticker');
  assert.ok(out.every((s) => !COMPANIES.some((c) => c.ticker === s.ticker)), 'and none is a ticker already in use');
  assert.equal(suggestCompanies(sources, COMPANIES, { limit: 1 }).length, 1);
  assert.ok(SUGGEST_EXCLUDE.includes('ncpd'));
});

// ── Self-check ───────────────────────────────────────────────────────────────

const healthy = () => {
  const companies = COMPANIES.map((c) => ({ ...c, listed: true }));
  const prices = Object.fromEntries(companies.map((c) => [c.id, { price: 100 }]));
  const funds = STARTER_FUNDS.map((f) => ({
    id: f.ticker,
    ticker: f.ticker,
    status: 'active',
    components: f.components.split(',').map((part) => {
      const [ticker, weight] = part.trim().split(/\s+/);
      return { companyId: companies.find((c) => c.ticker === ticker)?.id ?? ticker, weight: Number(weight) };
    }),
  }));
  return {
    schema: { stored: 2, latest: 2 },
    ncm: { available: true, wire: true },
    seed: true,
    control: true,
    companies,
    market: { hasState: true, tickIndex: 5, companies: prices, funds: Object.fromEntries(funds.map((f) => [f.id, { nav: 10 }])) },
    funds,
    brokers: [{ id: 'b1' }],
    portfolios: [{ id: 'a1', name: 'Alice', portfolio: { ...emptyPortfolio(), cash: 1000, lots: [{ id: 'l1', assetId: companies[0].id, qty: 5, unitCost: 100 }] } }],
    heat: { enabled: true, pending: 0 },
  };
};
const levelOf = (report, id) => report.checks.find((c) => c.id === id)?.level;

test('a healthy world passes, with one result per check', () => {
  const report = verifyWorld(healthy());
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => c.level !== 'ok')));
  assert.deepEqual(report.checks.map((c) => c.id), VERIFY_CHECKS);
  assert.ok(report.checks.every((c) => VERIFY_LEVELS.includes(c.level)));
  assert.equal(report.counts.fail, 0);
  assert.equal(Object.values(report.counts).reduce((a, b) => a + b, 0), VERIFY_CHECKS.length);
});

test('the self-check flags each kind of problem at the right level', () => {
  const snap = healthy();
  const [first, second] = snap.companies;

  let r = verifyWorld({ ...snap, schema: { stored: 1, latest: 2 } });
  assert.equal(levelOf(r, 'schema'), 'warn');
  r = verifyWorld({ ...snap, schema: { stored: 5, latest: 2 } });
  assert.match(r.checks[0].detail, /newer/);

  r = verifyWorld({ ...snap, ncm: { available: false, wire: false }, seed: false, control: false });
  assert.deepEqual(['ncm', 'wire', 'seed', 'control'].map((id) => levelOf(r, id)), ['warn', 'info', 'warn', 'warn']);

  r = verifyWorld({ ...snap, companies: [{ ...first, initialPrice: 0 }, second] });
  assert.equal(levelOf(r, 'companies'), 'fail');
  assert.equal(r.ok, false);
  r = verifyWorld({ ...snap, companies: [first, { ...second, ticker: first.ticker }] });
  assert.match(r.checks.find((c) => c.id === 'companies').detail, /duplicate/);
  assert.equal(levelOf(verifyWorld({ ...snap, companies: [], market: { hasState: false } }), 'companies'), 'warn');

  const prices = { ...snap.market.companies };
  delete prices[first.id];
  prices.GHOST = { price: 10 };
  prices[second.id] = { price: NaN };
  r = verifyWorld({ ...snap, market: { ...snap.market, companies: prices } });
  const market = r.checks.find((c) => c.id === 'market');
  assert.equal(market.level, 'fail');
  assert.ok(market.detail.includes(first.ticker) && market.detail.includes('GHOST') && market.detail.includes('bad price'));
  assert.equal(levelOf(verifyWorld({ ...snap, market: { hasState: false } }), 'market'), 'warn');
});

test('the self-check finds broken funds and portfolios', () => {
  const snap = healthy();
  const fund = snap.funds[0];

  let r = verifyWorld({ ...snap, funds: [{ ...fund, components: [{ companyId: 'GONE', weight: 1 }] }, ...snap.funds.slice(1)] });
  assert.equal(levelOf(r, 'funds'), 'fail');
  assert.match(r.checks.find((c) => c.id === 'funds').detail, /GONE/);
  r = verifyWorld({ ...snap, funds: [{ ...fund, components: fund.components.map((c) => ({ ...c, weight: 0 })) }] });
  assert.match(r.checks.find((c) => c.id === 'funds').detail, /no weights/);
  r = verifyWorld({ ...snap, market: { ...snap.market, funds: {} } });
  assert.equal(levelOf(r, 'funds'), 'warn');

  const asset = snap.companies[0].id;
  const pf = (patch) => [{ id: 'x', name: 'Xan', portfolio: { ...emptyPortfolio(), cash: 100, ...patch } }];
  assert.equal(levelOf(verifyWorld({ ...snap, portfolios: pf({ cash: -1 }) }), 'portfolios'), 'fail');
  assert.equal(levelOf(verifyWorld({ ...snap, portfolios: pf({ cash: NaN }) }), 'portfolios'), 'fail');
  assert.equal(levelOf(verifyWorld({ ...snap, portfolios: pf({ lots: [{ id: 'l', assetId: asset, qty: 0, unitCost: 1 }] }) }), 'portfolios'), 'fail');
  const overspent = pf({ orders: [{ id: 'o', status: 'open', side: 'buy', assetId: asset, qty: 1, reserve: 500 }] });
  assert.equal(levelOf(verifyWorld({ ...snap, portfolios: overspent }), 'portfolios'), 'fail', 'more reserved than the balance holds');
  const orphan = verifyWorld({ ...snap, portfolios: pf({ lots: [{ id: 'l', assetId: 'DELETED', qty: 1, unitCost: 1 }] }) });
  assert.equal(levelOf(orphan, 'holdings'), 'warn');
  assert.ok(orphan.checks.find((c) => c.id === 'holdings').detail.includes('Xan: DELETED'));
  assert.equal(orphan.ok, true, 'an orphan holding is a warning, not a failure');

  assert.equal(levelOf(verifyWorld({ ...snap, heat: { enabled: true, pending: 2 } }), 'heat'), 'info');
  assert.equal(levelOf(verifyWorld({ ...snap, brokers: [] }), 'brokers'), 'info');
});

test('a long list of problems is shortened in the detail', () => {
  const snap = healthy();
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, portfolio: { ...emptyPortfolio(), cash: -5 } }));
  const detail = verifyWorld({ ...snap, portfolios: many }).checks.find((c) => c.id === 'portfolios').detail;
  assert.match(detail, /and 4 more/);
  assert.equal(normalizePortfolio(null).cash, 0);
});
