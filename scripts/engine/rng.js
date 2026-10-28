/**
 * Seeded random numbers
 * @file scripts/engine/rng.js
 * @description Deterministic PRNG so a given (seed, tick, scope) always produces the same
 *              draws. No Foundry globals.
 */

/** FNV-1a over the joined parts, then an avalanche mix. Returns an unsigned 32-bit int. */
export function hashSeed(...parts) {
  const str = parts.map(String).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: small, fast, good enough for game simulation. Returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a random stream from any number of seed parts.
 * @param {...(string|number)} parts - e.g. (worldSeed, tickIndex, 'ARA')
 */
export function createRng(...parts) {
  const next = mulberry32(hashSeed(...parts));
  let spare = null;

  /** Standard normal via Box-Muller. */
  const normal = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };

  /** Student-t scaled to unit variance, for fat-tailed returns. `df` is rounded and floored at 3. */
  const studentT = (df = 5) => {
    const d = Math.max(3, Math.round(df));
    const z = normal();
    let chi = 0;
    for (let i = 0; i < d; i++) {
      const n = normal();
      chi += n * n;
    }
    return (z / Math.sqrt(chi / d)) * Math.sqrt((d - 2) / d);
  };

  /** True with probability p. */
  const chance = (p) => next() < p;

  /** Integer in [min, max] inclusive. */
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));

  /** Pick a key from a { key: weight } map. */
  const weighted = (weights) => {
    const entries = Object.entries(weights);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = next() * total;
    for (const [key, w] of entries) {
      roll -= w;
      if (roll < 0) return key;
    }
    return entries[entries.length - 1][0];
  };

  return { next, normal, studentT, chance, int, weighted };
}
