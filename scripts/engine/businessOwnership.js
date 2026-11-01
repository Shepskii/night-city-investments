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
export function addLayer(b, holderId, { kind, name, day, result }) {
  const n = kind === 'nominee' ? text(name, 60) : text(name, 40);
  if (!bandPassed(result.band)) return { added: false, kind, name: n, index: -1 };
  b.masks = { ...(b.masks ?? {}), [holderId]: [...masksOf(b, holderId), { kind, name: n, day, lastFee: day }] };
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
