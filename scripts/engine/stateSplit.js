/**
 * Public / hidden state split
 * @file scripts/engine/stateSplit.js
 * @description The engine state includes values players must not see (fair value, volatility
 *              ratio, the true regime). World settings reach every client, so the state is split:
 *              the public half goes in a world setting, the hidden half in a GM-only journal.
 *              Pure; no Foundry globals.
 */

export const MOODS = {
  bull: 'risk-on',
  sideways: 'steady',
  bear: 'risk-off',
  crash: 'panic',
  recovery: 'rebounding',
};

/** Soft label shown to players instead of the true regime. */
export const marketMood = (regime) => MOODS[regime] ?? 'steady';

/**
 * @param {object} state - engine state
 * @param {number|null} lastDay - in-world day index of the last tick
 * @returns {{pub: object, hidden: object}}
 */
export function splitState(state, lastDay) {
  const pub = { schema: 1, tickIndex: state.tickIndex, time: state.time ?? state.tickIndex, lastDay, mood: marketMood(state.regime), companies: {} };
  const hidden = { schema: 1, regime: state.regime, regimeAge: state.regimeAge, companies: {} };
  for (const [id, c] of Object.entries(state.companies)) {
    pub.companies[id] = { price: c.price, prevClose: c.prevClose };
    hidden.companies[id] = { fair: c.fair, vol: c.vol, floorTicks: c.floorTicks ?? 0 };
  }
  return { pub, hidden };
}

/** Rebuild the engine state from its two halves. Missing hidden values default sensibly. */
export function mergeState(pub, hidden) {
  const state = {
    tickIndex: pub?.tickIndex ?? 0,
    time: pub?.time ?? pub?.tickIndex ?? 0,
    regime: hidden?.regime ?? 'sideways',
    regimeAge: hidden?.regimeAge ?? 0,
    companies: {},
  };
  for (const [id, c] of Object.entries(pub?.companies ?? {})) {
    const h = hidden?.companies?.[id] ?? {};
    state.companies[id] = {
      price: c.price,
      prevClose: c.prevClose,
      fair: h.fair ?? c.price,
      vol: h.vol ?? 1,
      floorTicks: h.floorTicks ?? 0,
    };
  }
  return state;
}

/** Drop companies that no longer exist from a state. */
export function pruneState(state, keepIds) {
  const keep = new Set(keepIds);
  return {
    ...state,
    companies: Object.fromEntries(Object.entries(state.companies).filter(([id]) => keep.has(id))),
  };
}
