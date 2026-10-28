/**
 * World self-check
 * @file scripts/engine/verify.js
 * @description Looks over a snapshot of the world's data and reports anything that is wrong or
 *              looks wrong. Pure: the Foundry layer builds the snapshot (DiagnosticsService).
 *
 *   levels: ok (fine), info (worth knowing), warn (probably wrong), fail (broken)
 */

import { sanitizeCompany } from './companyConfig.js';
import { committedCash, normalizePortfolio } from './portfolioModel.js';

export const VERIFY_LEVELS = ['ok', 'info', 'warn', 'fail'];
export const VERIFY_CHECKS = ['schema', 'ncm', 'wire', 'seed', 'control', 'companies', 'market', 'funds', 'brokers', 'portfolios', 'holdings', 'heat'];

const list = (items, max = 6) => (items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', '));
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * @param {object} snap
 * @param {{stored: number, latest: number}} snap.schema
 * @param {{available: boolean, wire: boolean}} snap.ncm
 * @param {boolean} snap.seed
 * @param {boolean} snap.control - the GM control journal exists
 * @param {object[]} snap.companies - stored company configs
 * @param {{hasState: boolean, companies: object, funds: object, tickIndex: number}} snap.market - the public state
 * @param {object[]} snap.funds
 * @param {object[]} snap.brokers
 * @param {{id: string, name: string, portfolio: object}[]} snap.portfolios
 * @param {{enabled: boolean, pending: number}} snap.heat
 * @returns {{ok: boolean, counts: Object<string, number>, checks: {id: string, level: string, detail: string}[]}}
 */
export function verifyWorld(snap) {
  const checks = [];
  const add = (id, level, detail = '') => checks.push({ id, level, detail });

  const { stored, latest } = snap.schema;
  if (stored === latest) add('schema', 'ok', `v${latest}`);
  else if (stored < latest) add('schema', 'warn', `v${stored}, expected v${latest}`);
  else add('schema', 'warn', `v${stored}, newer than this module's v${latest}`);

  add('ncm', snap.ncm.available ? 'ok' : 'warn');
  add('wire', snap.ncm.wire ? 'ok' : 'info');
  add('seed', snap.seed ? 'ok' : 'warn');
  add('control', snap.control ? 'ok' : 'warn');

  // Companies
  const companies = snap.companies ?? [];
  const bad = [];
  const seen = new Set();
  const dupes = new Set();
  for (const c of companies) {
    if (!sanitizeCompany(c).ok) bad.push(c.ticker || c.name || c.id);
    if (seen.has(c.ticker)) dupes.add(c.ticker);
    seen.add(c.ticker);
  }
  if (!companies.length) add('companies', 'warn', '0 companies');
  else if (bad.length) add('companies', 'fail', `invalid: ${list(bad)}`);
  else if (dupes.size) add('companies', 'fail', `duplicate tickers: ${list([...dupes])}`);
  else add('companies', 'ok', `${companies.length}`);

  // Market state
  const pub = snap.market ?? {};
  const prices = pub.companies ?? {};
  const navs = pub.funds ?? {};
  const problems = [];
  const ids = new Set(companies.map((c) => c.id));
  const unpriced = companies.filter((c) => c.listed && c.status === 'active' && !prices[c.id]).map((c) => c.ticker);
  const orphans = Object.keys(prices).filter((id) => !ids.has(id));
  const broken = Object.entries(prices).filter(([, s]) => !finite(s?.price) || s.price <= 0).map(([id]) => id);
  if (!pub.hasState) add('market', companies.length ? 'warn' : 'info', 'not started');
  else {
    if (broken.length) problems.push(['fail', `bad price: ${list(broken)}`]);
    if (unpriced.length) problems.push(['warn', `no price yet: ${list(unpriced)}`]);
    if (orphans.length) problems.push(['warn', `price for a deleted company: ${list(orphans)}`]);
    if (!finite(pub.tickIndex)) problems.push(['fail', 'no tick counter']);
    const worst = problems.some(([l]) => l === 'fail') ? 'fail' : problems.length ? 'warn' : 'ok';
    add('market', worst, problems.length ? problems.map(([, t]) => t).join('; ') : `day ${pub.tickIndex}`);
  }

  // Funds
  const funds = snap.funds ?? [];
  const fundProblems = [];
  let fundLevel = 'ok';
  for (const f of funds) {
    const missing = (f.components ?? []).filter((c) => !ids.has(c.companyId)).map((c) => c.companyId);
    const weight = (f.components ?? []).reduce((s, c) => s + (finite(c.weight) ? c.weight : 0), 0);
    if (missing.length) { fundProblems.push(`${f.ticker} holds ${list(missing)}, which no longer exists`); fundLevel = 'fail'; }
    else if (!(weight > 0)) { fundProblems.push(`${f.ticker} has no weights`); fundLevel = 'fail'; }
    else if (pub.hasState && f.status === 'active' && !navs[f.id]) { fundProblems.push(`${f.ticker} has no NAV yet`); if (fundLevel === 'ok') fundLevel = 'warn'; }
  }
  add('funds', funds.length ? fundLevel : 'info', funds.length ? (fundProblems.join('; ') || `${funds.length}`) : '0 funds');

  // Brokers
  const brokers = snap.brokers ?? [];
  add('brokers', brokers.length ? 'ok' : 'info', brokers.length ? `${brokers.length}` : '0 brokers');

  // Portfolios
  const assets = new Set([...ids, ...funds.map((f) => f.id)]);
  const broke = [];
  const stray = [];
  for (const { id, name, portfolio } of snap.portfolios ?? []) {
    const p = normalizePortfolio(portfolio);
    const label = name || id;
    const lotsBad = p.lots.some((l) => !finite(l.qty) || l.qty <= 0 || !finite(l.unitCost ?? 0));
    const reserved = committedCash(p.orders);
    if (!finite(p.cash) || p.cash < 0 || lotsBad || reserved > p.cash + 0.5) broke.push(label);
    const unknown = new Set([...p.lots.map((l) => l.assetId), ...p.orders.filter((o) => o.status === 'open').map((o) => o.assetId)].filter((a) => !assets.has(a)));
    if (unknown.size) stray.push(`${label}: ${list([...unknown], 3)}`);
  }
  const count = (snap.portfolios ?? []).length;
  add('portfolios', broke.length ? 'fail' : count ? 'ok' : 'info', broke.length ? `check: ${list(broke)}` : `${count}`);
  add('holdings', stray.length ? 'warn' : 'ok', stray.length ? `unknown assets (${list(stray, 4)})` : '');

  // Heat
  const heat = snap.heat ?? {};
  add('heat', heat.pending ? 'info' : 'ok', heat.pending ? `${heat.pending} penalty case(s) waiting` : heat.enabled ? 'on' : 'off');

  const counts = Object.fromEntries(VERIFY_LEVELS.map((l) => [l, checks.filter((c) => c.level === l).length]));
  return { ok: counts.fail === 0, counts, checks };
}
