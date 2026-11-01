/**
 * Hidden ownership (B6d)
 * @file scripts/engine/businessOwnership.js
 * @description A shareholder in a chartered or listed player company can hide behind layers: first a
 *              broker's nominee, then up to two shell companies they name. Each layer is built with a
 *              roll whose total is kept in the GM's hidden state (the layer's strength), costs its
 *              holder a setup fee and a monthly fee, and lapses if the fee cannot be paid. Registers
 *              show the outermost layer's name in the holder's place; the holder still votes through
 *              it. The record keeps who is behind each mask; the GM's service decides who sees it.
 *              Pure.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { fail, partnerOf, unitValue } from './businessRecord.js';
import { isListed } from './businessListing.js';
import { bandPassed, dvOf } from './rolls.js';

const text = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** A holder's layers, innermost first (the last is the one a register shows). */
export const masksOf = (b, holderId) => b.masks?.[holderId] ?? [];

/** The outermost layer a register shows in this holder's place, or null when they are not hidden. */
export const outerMask = (b, holderId) => masksOf(b, holderId).at(-1) ?? null;

/** What a holder's shares are worth now: the market price when listed, book value otherwise. */
export function holdingValue(b, holderId, marketPrice = 0) {
  const units = partnerOf(b, holderId)?.units ?? 0;
  return Math.round(units * (isListed(b) ? Math.max(0, marketPrice) : unitValue(b)));
}

/** A layer's setup fee and monthly fee, as a share of the holding's value. */
export function layerFees(value, p = BUSINESS_DEFAULTS) {
  const o = p.ownership;
  return { setup: Math.max(o.minSetup, Math.round(value * o.setupRate)), monthly: Math.max(o.minMonthly, Math.round(value * o.monthlyRate)) };
}

/**
 * Whether this holder can add a layer now, and how it is rolled: the first is a broker's nominee, the
 * next ones shell companies they name (a name nobody uses on this company).
 */
export function layerCheck(b, holderId, { name } = {}, p = BUSINESS_DEFAULTS) {
  if (b.stage !== 2 || b.status !== 'open') return fail('not-company');
  const me = partnerOf(b, holderId);
  if (!me || !['active', 'leaving'].includes(me.status) || !(me.units > 0) || me.npc) return fail('not-partner');
  const layers = masksOf(b, holderId);
  if (layers.length >= p.ownership.maxLayers) return fail('layers-full');
  const kind = layers.length ? 'shell' : 'nominee';
  if (kind === 'shell') {
    const n = text(name, 40);
    if (!n) return fail('no-name');
    const taken = Object.values(b.masks ?? {}).flat().some((m) => m.name.toLowerCase() === n.toLowerCase())
      || b.partners.some((x) => x.name?.toLowerCase() === n.toLowerCase());
    if (taken) return fail('name-taken');
  }
  return { ok: true, kind, dv: dvOf(p.ownership.dv), uses: [...p.ownership.uses] };
}

/**
 * Record a layer roll. A pass adds the layer (its total goes to the GM's hidden state, not here); a
 * failure adds nothing. The fee is paid either way, by the service.
 * @returns {{added: boolean, kind: string, name: string, index: number}}
 */
export function addLayer(b, holderId, { kind, name, day, result, ref = null }) {
  const n = kind === 'nominee' ? text(name, 60) : text(name, 40);
  if (!bandPassed(result.band)) return { added: false, kind, name: n, index: -1 };
  // `ref` names the layer to an investigator without saying whose it is.
  b.masks = { ...(b.masks ?? {}), [holderId]: [...masksOf(b, holderId), { kind, name: n, day, lastFee: day, ...(ref ? { ref } : {}) }] };
  return { added: true, kind, name: n, index: b.masks[holderId].length - 1 };
}

/** Take a holder's outermost layer off (or, with `from`, that layer and every one outside it). */
export function dropLayers(b, holderId, from = null) {
  const layers = masksOf(b, holderId);
  if (!layers.length) return fail('no-layer');
  const keep = layers.slice(0, from ?? layers.length - 1);
  const masks = { ...(b.masks ?? {}) };
  if (keep.length) masks[holderId] = keep;
  else delete masks[holderId];
  b.masks = masks;
  return { ok: true, dropped: layers.length - keep.length };
}

/** Holders no longer holding shares lose their masks (a layer hides a holding, not a person). */
export function pruneMasks(b) {
  let changed = false;
  for (const id of Object.keys(b.masks ?? {})) {
    const me = partnerOf(b, id);
    if (!me || !['active', 'leaving'].includes(me.status) || !(me.units > 0)) {
      delete b.masks[id];
      changed = true;
    }
  }
  return changed;
}

/** Layers whose monthly fee has fallen due: `[{holderId, index}]`, innermost first. */
export function layerFeesDue(b, day, p = BUSINESS_DEFAULTS) {
  const due = [];
  for (const [holderId, layers] of Object.entries(b.masks ?? {})) {
    layers.forEach((m, index) => { if (day >= (m.lastFee ?? m.day) + p.ownership.feeDays) due.push({ holderId, index }); });
  }
  return due;
}

// ── Concealment (B6d) ────────────────────────────────────────────────────────

/**
 * Holders hiding more than the disclosure threshold of a listed company: concealment. Returns their
 * ids and shares of the company.
 */
export function concealedHolders(b, p = BUSINESS_DEFAULTS) {
  if (!isListed(b)) return [];
  const total = b.listing.shares || 0;
  if (!total) return [];
  return Object.keys(b.masks ?? {})
    .map((holderId) => ({ holderId, share: (partnerOf(b, holderId)?.units ?? 0) / total }))
    .filter((x) => x.share > p.ownership.disclosure);
}

/** How strong a hidden holding's layers are against an audit: the outer layer, plus 2 for each one beneath it. */
export const layerDefence = (totals = []) => (totals.length ? totals.at(-1) + 2 * (totals.length - 1) : 0);

/**
 * NCPD Financial Crimes' monthly look at a concealed holding: whether it looks (a chance that rises with
 * the holder's heat) and, if it does, whether it sees through (its total against the layers' defence).
 * `rng` gives numbers in [0, 1).
 * @returns {{audited: boolean, total?: number, defence?: number, unmasked: boolean}}
 */
export function auditConcealment(totals, heat, rng, p = BUSINESS_DEFAULTS) {
  const a = p.ownership.audit;
  const chance = Math.min(a.maxChance, a.chance + Math.max(0, heat) / a.heatDivisor);
  if (rng() >= chance) return { audited: false, unmasked: false };
  const total = a.base + 1 + Math.floor(rng() * 10);
  const defence = layerDefence(totals);
  return { audited: true, total, defence, unmasked: total > defence };
}

/** Strip every layer from a holder: they are on the register under their own name. */
export function unmask(b, holderId) {
  if (!b.masks?.[holderId]) return false;
  const masks = { ...b.masks };
  delete masks[holderId];
  b.masks = masks;
  return true;
}

// ── Investigations (B6d) ─────────────────────────────────────────────────────

/** The holder whose outer layer has this reference (what a register row names). */
export function holderByRef(b, ref) {
  return Object.entries(b.masks ?? {}).find(([, layers]) => layers.at(-1)?.ref === ref)?.[0] ?? null;
}

/**
 * What an investigator is up against: the next layer they have not seen through (from the outside in,
 * `peeled` already done), its strength plus 2 for each layer still above it... that is, each one they
 * have peeled. Returns the DV, the layer's index, and what a win reveals: the next layer down, or the
 * holder when it was the last.
 */
export function investigationTarget(b, holderId, totals, peeled = 0) {
  const layers = masksOf(b, holderId);
  const index = layers.length - 1 - peeled;
  if (index < 0) return fail('nothing-hidden');
  return { ok: true, index, dv: (totals[index] ?? 0) + 2 * peeled, reveals: index > 0 ? layers[index - 1] : null };
}
