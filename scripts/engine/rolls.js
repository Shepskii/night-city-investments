/**
 * Roll levers
 * @file scripts/engine/rolls.js
 * @description The choices a player makes around a business roll (DESIGN §27): the DV ladder, the
 *              approach, Luck, a complementary bonus, a hired professional, and the outcome bands
 *              every check is read through. Pure; no Foundry globals. The dice come from the caller.
 */

/** The rulebook's DV ladder. A table names a step rather than a number, so a GM tunes by step. */
export const DV_LADDER = Object.freeze({ everyday: 13, difficult: 15, professional: 17, heroic: 21, incredible: 24 });

/** Careful lowers the DV and the effect; Bold raises both, and leaves some Exposure. */
export const APPROACHES = Object.freeze({
  careful: Object.freeze({ dv: -2, effect: 0.75, exposure: 0 }),
  standard: Object.freeze({ dv: 0, effect: 1, exposure: 0 }),
  bold: Object.freeze({ dv: 3, effect: 1.25, exposure: 1 }),
});

/** A hired NPC's fixed base replaces the character's stat and skill. */
export const HIRE_TIERS = Object.freeze({ cheap: 10, good: 13, best: 16 });

/** Bands from worst to best. */
export const BANDS = Object.freeze(['fumble', 'failure', 'narrow', 'solid', 'strong', 'exceptional']);

/** How much of an action's effect each band gives (DESIGN §27). A fumble has its own effect. */
export const BAND_SCALE = Object.freeze({ fumble: 0, failure: 0, narrow: 0.25, solid: 1, strong: 1.5, exceptional: 2 });

/** The most Luck one roll may take, whatever the pool holds. */
export const MAX_LUCK_PER_ROLL = 10;

/**
 * The outcome band for a margin (total minus DV). A natural 1 that fails is a fumble; a critical
 * success is exceptional whatever the margin, as long as it passes.
 */
export function bandOf(margin, crit = null) {
  if (margin < 0) return crit === 'fumble' ? 'fumble' : 'failure';
  if (crit === 'success' || margin >= 8) return 'exceptional';
  if (margin >= 6) return 'strong';
  if (margin >= 2) return 'solid';
  return 'narrow';
}

export const bandPassed = (band) => band !== 'fumble' && band !== 'failure';

export const approachOf = (id) => APPROACHES[id] ?? APPROACHES.standard;

/** A DV from a ladder step name or a number. */
export function dvOf(step) {
  if (Number.isFinite(Number(step)) && step !== '' && step !== null) return Math.round(Number(step));
  return DV_LADDER[step] ?? DV_LADDER.everyday;
}

/**
 * Clean up the levers a player asked for: an approach that exists, whole Luck in range, a bonus of
 * 0 or 1, extra time of 0 or 1 (a business day spent on the roll), and a hire tier that exists. A
 * hired professional cannot use Luck, which is a character's own.
 * @param {{approach?: string, luck?: number, bonus?: number, extra?: number, hire?: string|null}} [levers]
 */
export function normalizeLevers(levers = {}) {
  const hire = levers.hire && HIRE_TIERS[levers.hire] ? levers.hire : null;
  const luck = hire ? 0 : Math.max(0, Math.min(MAX_LUCK_PER_ROLL, Math.floor(Number(levers.luck) || 0)));
  return {
    approach: APPROACHES[levers.approach] ? levers.approach : 'standard',
    luck,
    bonus: Number(levers.bonus) > 0 ? 1 : 0,
    extra: Number(levers.extra) > 0 ? 1 : 0,
    hire,
  };
}

/**
 * Read one roll through the levers.
 * @param {{base: number, roll: {total: number, crit?: string|null}, dv: number, levers?: object}} o
 *        `base` is stat + skill, a role ability's rank, or a hired professional's fixed base
 * @returns {{base: number, roll: number, luck: number, bonus: number, total: number, dv: number, margin: number,
 *            band: string, success: boolean, crit: string|null, approach: string, effect: number, exposure: number}}
 *          `effect` is the band's share of the effect times the approach's scale
 */
export function resolveRoll({ base, roll, dv, levers = {} }) {
  const l = normalizeLevers(levers);
  const approach = approachOf(l.approach);
  const finalDv = Math.round(Number(dv) || 0) + approach.dv;
  const total = (Number(base) || 0) + l.luck + l.bonus + l.extra + roll.total;
  const margin = total - finalDv;
  const band = bandOf(margin, roll.crit ?? null);
  return {
    base: Number(base) || 0,
    roll: roll.total,
    luck: l.luck,
    bonus: l.bonus,
    extra: l.extra,
    total,
    dv: finalDv,
    margin,
    band,
    success: bandPassed(band),
    crit: roll.crit ?? null,
    approach: l.approach,
    effect: BAND_SCALE[band] * approach.effect,
    exposure: approach.exposure,
  };
}

/**
 * What each band would mean for a roll, before it is made: the preview the roll dialog shows.
 * @param {{base: number, dv: number, levers?: object}} o
 * @returns {{dv: number, needed: number, chance: number, bands: {band: string, chance: number}[]}}
 *          `needed` is the d10 total that passes; `chance` and each band's share are exact over the d10
 */
export function previewRoll({ base, dv, levers = {} }) {
  const counts = Object.fromEntries(BANDS.map((b) => [b, 0]));
  let pass = 0;
  // Every outcome of the CPR d10 is one of 8 plain faces, or a 10 or a 1 followed by a second d10.
  const add = (total, crit, weight) => {
    const r = resolveRoll({ base, roll: { total, crit }, dv, levers });
    counts[r.band] += weight;
    if (r.success) pass += weight;
  };
  for (let face = 2; face <= 9; face++) add(face, null, 10);
  for (let extra = 1; extra <= 10; extra++) {
    add(10 + extra, 'success', 1);
    add(1 - extra, 'fumble', 1);
  }
  const l = normalizeLevers(levers);
  const finalDv = Math.round(Number(dv) || 0) + approachOf(l.approach).dv;
  return {
    dv: finalDv,
    needed: finalDv - ((Number(base) || 0) + l.luck + l.bonus + l.extra),
    chance: pass / 100,
    bands: BANDS.map((band) => ({ band, chance: counts[band] / 100 })),
  };
}
