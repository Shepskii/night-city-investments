import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../styles/night-city-investments.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const blockAt = (start) => css.slice(css.indexOf(start), css.indexOf('}', css.indexOf(start)));
const tokensIn = (block) => new Set([...block.matchAll(/^\s*(--nci-[\w-]+):/gm)].map((m) => m[1]));
const base = blockAt('.nci-app,\n.nci-ticker {');
const matched = blockAt('html.nci-theme-pvt:is(');
/** Colours that mean the same on any skin: the neutral Capacity scale, blue on either. */
const NEUTRAL = new Set(['#4f9bd9', '#1f3346', '#2a4d6e', '#3a6f9c', '#5a9fd6']);

test('every colour in the stylesheet is a token, so a theme reaches all of it', () => {
  const rules = css.replace(base, '').replace(matched, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = [...rules.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0]).filter((c) => !NEUTRAL.has(c));
  // A token's fallback, for use outside the windows, is the only other place a colour may be.
  assert.deepEqual(literals.filter((c) => c !== '#ffb347'), []);
});

test('matching a skin sets every token that would otherwise stay dark', () => {
  const missing = [...tokensIn(base)].filter((t) => !tokensIn(matched).has(t));
  assert.deepEqual(missing, []);
  assert.ok(tokensIn(base).size > 30);
});

test('matching reads what Visual Tools publishes, and only applies with a skin or colours active', () => {
  assert.match(css, /html\.nci-theme-pvt:is\(\[data-pvt-base\], \.pvt-custom-theme\) :is\(\.nci-app, \.nci-ticker\)/);
  for (const name of ['--pvt-custom-main', '--pvt-base-accent', '--cpr-background-window', '--cpr-text-normal', '--cpr-text-chat-success', '--cpr-text-chat-failure', '--cpr-background-tab-active']) assert.ok(matched.includes(`var(${name}`), name);
});

test('the setting: the class follows the choice, and needs the module', async () => {
  const { applyTheme, matchesVisualTools, THEMES } = await import('../scripts/core/theme.js');
  const toggled = [];
  const before = { game: globalThis.game, document: globalThis.document };
  let choice = THEMES.nightCity;
  let active = true;
  globalThis.game = { modules: new Map([['pneuma-visualtools', { get active() { return active; } }]]), settings: { get: () => choice } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { classList: { toggle: (name, on) => toggled.push([name, on]) } } } });
  try {
    applyTheme();
    choice = THEMES.visualTools;
    assert.equal(matchesVisualTools(), true);
    applyTheme();
    active = false;
    assert.equal(matchesVisualTools(), false, 'chosen, then the module turned off');
    applyTheme();
    assert.deepEqual(toggled, [['nci-theme-pvt', false], ['nci-theme-pvt', true], ['nci-theme-pvt', false]]);
  } finally {
    globalThis.game = before.game;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: before.document });
  }
});
