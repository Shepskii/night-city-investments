/**
 * Company suggestions
 * @file scripts/engine/suggest.js
 * @description Names that look like corporations but have no company yet: organisations on NCM
 *              contacts and clients of gigs. The GM can turn one into a company or dismiss it.
 *              Pure; no Foundry globals.
 */

import { normalizeName, resolveClient } from './gigImpact.js';

/** Organisations that are part of this module or NCM itself and never become companies. */
export const SUGGEST_EXCLUDE = Object.freeze(['night city market', 'ncpd', 'night city messenger', 'unaffiliated', 'none', 'independent', 'freelance']);

const STOP = new Set(['the', 'and', 'of', 'for']);

/** A short ticker for a name, avoiding the ones in `taken`: ARA from Arasaka, TT from Trauma Team. */
export function suggestTicker(name, taken = []) {
  const used = new Set([...taken].map((t) => String(t).toUpperCase()));
  const words = normalizeName(name).split(' ').filter((w) => w && !STOP.has(w));
  const letters = (w) => w.replace(/[^a-z]/g, '').toUpperCase();
  const first = letters(words[0] ?? '');
  const initials = words.map(letters).filter(Boolean).map((w) => w[0]).join('').slice(0, 4);

  const candidates = [first.slice(0, 3), words.length > 1 ? initials : '', first.slice(0, 4), first.slice(0, 2), initials]
    .filter((t) => t.length >= 2);
  for (const t of candidates) if (!used.has(t)) return t;

  const stem = (candidates[0] ?? 'NEW').slice(0, 3);
  for (let n = 2; n < 100; n++) if (!used.has(`${stem}${n}`)) return `${stem}${n}`.slice(0, 6);
  return stem;
}

/**
 * @param {{name: string, from: 'contact'|'gig'}[]} sources
 * @param {object[]} companies
 * @param {{mappings?: object, exclude?: string[], taken?: string[], limit?: number}} [opts]
 * @returns {{name: string, key: string, ticker: string, count: number, from: string[]}[]}
 */
export function suggestCompanies(sources, companies, { mappings = {}, exclude = SUGGEST_EXCLUDE, taken = [], limit = 30 } = {}) {
  const skip = new Set(exclude.map(normalizeName));
  const groups = new Map();
  for (const { name, from } of sources) {
    const text = String(name ?? '').trim();
    const key = normalizeName(text);
    if (key.length < 2 || skip.has(key)) continue;
    const g = groups.get(key) ?? { name: text, key, count: 0, from: new Set() };
    g.count++;
    g.from.add(from);
    groups.set(key, g);
  }

  const used = [...taken, ...companies.map((c) => c.ticker)];
  const out = [];
  for (const g of [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))) {
    if (resolveClient({ client: g.name }, companies, mappings).status !== 'unmatched') continue;
    const ticker = suggestTicker(g.name, used);
    used.push(ticker);
    out.push({ name: g.name, key: g.key, ticker, count: g.count, from: [...g.from].sort() });
    if (out.length >= limit) break;
  }
  return out;
}
