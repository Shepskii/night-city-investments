/**
 * Scene control placement
 * @file scripts/ui/sceneControls.js
 * @description The market buttons live in Foundry's Token Controls group, alongside the buttons
 *              other modules already add there. Pure; no Foundry globals.
 */

/** Name of Foundry v12's Token Controls group. */
export const TOKEN_CONTROL_ID = 'token';

/**
 * Add the market tools to the controls array Foundry passes to `getSceneControlButtons`.
 * Safe to call more than once on the same array: existing copies of these tools are replaced.
 * @param {object[]} controls - the v12 controls array (mutated)
 * @param {object[]} tools - tool definitions
 * @returns {boolean} true if the Token Controls group was found and the tools were added
 */
export function addMarketControls(controls, tools) {
  const group = controls.find((c) => c.name === TOKEN_CONTROL_ID);
  if (!group) return false;
  const names = new Set(tools.map((t) => t.name));
  group.tools = [...group.tools.filter((t) => !names.has(t.name)), ...tools];
  return true;
}
