/**
 * Scene control placement
 * @file scripts/ui/sceneControls.js
 * @description The market buttons live in Foundry's Token Controls group, alongside the buttons
 *              other modules already add there. Pure; no Foundry globals.
 */

/** Name of Foundry v12's Token Controls group. */
export const TOKEN_CONTROL_ID = 'token';

/** Key of Foundry v13's Token Controls group. */
export const TOKEN_CONTROL_KEY_V13 = 'tokens';

/**
 * Add the market tools to the controls Foundry passes to `getSceneControlButtons`: v12's array of
 * groups (each group's tools an array, a button's handler `onClick`), or v13's record of groups
 * (each group's tools a record keyed by name, a button's handler `onChange` and its place `order`).
 * Safe to call more than once on the same controls: existing copies of these tools are replaced.
 * @param {object[]|Record<string, object>} controls - the controls (mutated)
 * @param {object[]} tools - tool definitions, in v12's form (with `onClick`)
 * @returns {boolean} true if the Token Controls group was found and the tools were added
 */
export function addMarketControls(controls, tools) {
  if (Array.isArray(controls)) {
    const group = controls.find((c) => c.name === TOKEN_CONTROL_ID);
    if (!group) return false;
    const names = new Set(tools.map((t) => t.name));
    group.tools = [...group.tools.filter((t) => !names.has(t.name)), ...tools];
    return true;
  }
  const group = controls?.[TOKEN_CONTROL_KEY_V13];
  if (!group?.tools) return false;
  for (const { onClick, ...tool } of tools) {
    const order = group.tools[tool.name]?.order ?? Object.keys(group.tools).length;
    group.tools[tool.name] = { ...tool, order, ...(onClick && { onChange: () => onClick() }) };
  }
  return true;
}
