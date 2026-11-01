/**
 * Company definition validation
 * @file scripts/engine/companyConfig.js
 * @description Cleans and validates the public config a GM enters for a company. Pure; no Foundry globals.
 */

import { SECTORS } from './config.js';

export const DIVIDEND_POLICIES = ['none', 'fixed', 'yield'];
export const DIVIDEND_FREQUENCIES = ['monthly', 'quarterly', 'annual'];
export const COMPANY_STATUSES = ['active', 'halted', 'delisted', 'bankrupt', 'acquired'];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);
const round2 = (n) => Math.round(n * 100) / 100;

/** Uppercase letters, digits and dots only, at most 6 characters. */
export function normalizeTicker(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 6);
}

function cleanAliases(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[,\n]/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const alias = String(raw).trim();
    const key = alias.toLowerCase();
    if (alias && !seen.has(key)) {
      seen.add(key);
      out.push(alias);
    }
  }
  return out;
}

/** IPO schedule: a listing date (YYYY-MM-DD), an optional offer price, a subscription window and a cap on shares for players. */
function cleanIpo(value) {
  const v = value ?? {};
  const date = String(v.date ?? '').trim();
  const real = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
  const price = round2(num(v.price, NaN));
  return {
    date: real ? date : '',
    price: price >= 1 ? price : null,
    windowDays: clamp(Math.round(num(v.windowDays, 0)), 0, 30),
    allocation: Math.max(0, Math.round(num(v.allocation, 0))),
  };
}

/**
 * Validate and normalise a company definition.
 * @param {object} input - raw form data or stored config
 * @returns {{ok: true, company: object} | {ok: false, errors: string[]}}
 */
export function sanitizeCompany(input) {
  const errors = [];
  const name = String(input.name ?? '').trim();
  const ticker = normalizeTicker(input.ticker);
  if (!name) errors.push('name-required');
  if (ticker.length < 2) errors.push('ticker-invalid');

  const initialPrice = round2(num(input.initialPrice, NaN));
  if (!(initialPrice >= 1)) errors.push('price-invalid');

  if (errors.length) return { ok: false, errors };

  const d = input.dividend ?? {};
  const policy = DIVIDEND_POLICIES.includes(d.policy) ? d.policy : 'none';
  const frequency = DIVIDEND_FREQUENCIES.includes(d.frequency) ? d.frequency : 'quarterly';

  return {
    ok: true,
    company: {
      id: input.id ? String(input.id) : ticker,
      ticker,
      name,
      sector: SECTORS.includes(input.sector) ? input.sector : 'other',
      hq: String(input.hq ?? '').trim(),
      ceo: String(input.ceo ?? '').trim(),
      aliases: cleanAliases(input.aliases),
      listed: input.listed !== false,
      initialPrice,
      sharesOutstanding: Math.max(0, Math.round(num(input.sharesOutstanding, 1_000_000))),
      volatility: clamp(Math.round(num(input.volatility, 3)), 1, 5),
      beta: round2(clamp(num(input.beta, 1), 0, 3)),
      liquidity: clamp(Math.round(num(input.liquidity, 3)), 1, 5),
      dividend: {
        policy,
        frequency,
        perShare: round2(Math.max(0, num(d.perShare, 0))),
        yield: Math.round(clamp(num(d.yield, 0), 0, 1) * 10000) / 10000,
        payoutDay: clamp(Math.round(num(d.payoutDay, 1)), 1, 28),
      },
      status: COMPANY_STATUSES.includes(input.status) ? input.status : 'active',
      ipo: cleanIpo(input.ipo),
      // A listed player company's public register (B6d): holders as a register shows them.
      register: Array.isArray(input.register)
        ? input.register.slice(0, 40).map((r) => ({
          label: String(r.label ?? '').slice(0, 60), kind: String(r.kind ?? 'holder').slice(0, 12), shares: Math.max(0, Math.round(num(r.shares, 0))), pct: round2(num(r.pct, 0)),
          ...(r.ref ? { ref: String(r.ref).slice(0, 40) } : {}),
        }))
        : [],
      // A listed player company's secondary offering (B6a): new shares at a price, open to the end day.
      offering: input.offering?.price > 0 && input.offering?.shares > 0
        ? { price: round2(num(input.offering.price, 0)), shares: Math.round(num(input.offering.shares, 0)), endDay: Math.round(num(input.offering.endDay, 0)) }
        : null,
      // A player company (B5b): the business record it lists.
      ...(input.businessId ? { businessId: String(input.businessId) } : {}),
      /** Cumulative split factor, so index levels and resets stay on the post-split basis. */
      splitFactor: Math.max(1, Math.round(num(input.splitFactor, 1) * 10000) / 10000),
      split: {
        auto: !!input.split?.auto,
        above: Math.max(1, round2(num(input.split?.above, 500))),
        ratio: clamp(Math.round(num(input.split?.ratio, 2)), 2, 20),
      },
    },
  };
}
