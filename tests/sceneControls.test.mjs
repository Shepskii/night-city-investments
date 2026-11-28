import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMarketControls, TOKEN_CONTROL_ID } from '../scripts/ui/sceneControls.js';

const tools = () => [{ name: 'nci-terminal' }, { name: 'nci-gm-console' }];
const controls = () => [
  { name: TOKEN_CONTROL_ID, layer: 'tokens', tools: [{ name: 'select' }, { name: 'ncm' }] },
  { name: 'night-city-messenger', layer: 'controls', tools: [{ name: 'ncm-inbox' }] },
];
const names = (group) => group.tools.map((t) => t.name);

test('market tools are added to the Token Controls group, after the existing tools', () => {
  const c = controls();
  assert.equal(addMarketControls(c, tools()), true);
  assert.deepEqual(names(c[0]), ['select', 'ncm', 'nci-terminal', 'nci-gm-console']);
});

test('no group is created and other groups are untouched', () => {
  const c = controls();
  addMarketControls(c, tools());
  assert.equal(c.length, 2);
  assert.deepEqual(names(c[1]), ['ncm-inbox']);
  assert.equal(c.some((g) => g.name === 'night-city-investments'), false);
});

test('calling it twice does not duplicate tools, and a player gets only the player tool', () => {
  const c = controls();
  addMarketControls(c, tools());
  addMarketControls(c, tools());
  assert.deepEqual(names(c[0]), ['select', 'ncm', 'nci-terminal', 'nci-gm-console']);

  const p = controls();
  addMarketControls(p, [{ name: 'nci-terminal' }]);
  assert.deepEqual(names(p[0]), ['select', 'ncm', 'nci-terminal']);
});

test('without a Token Controls group nothing is added and it reports that', () => {
  const c = [{ name: 'night-city-messenger', layer: 'controls', tools: [] }];
  assert.equal(addMarketControls(c, tools()), false);
  assert.deepEqual(c[0].tools, []);
});

// Foundry v13 passes a record of groups, the Token Controls under `tokens`, with each group's
// tools a record keyed by name; a button's handler is `onChange` and its place is `order`.
const v13Controls = () => ({
  tokens: { name: 'tokens', tools: { select: { name: 'select', order: 0 }, ncm: { name: 'ncm', order: 1 } } },
  'night-city-messenger': { name: 'night-city-messenger', tools: { 'ncm-inbox': { name: 'ncm-inbox', order: 0 } } },
});
const v13Names = (group) => Object.values(group.tools).sort((a, b) => a.order - b.order).map((t) => t.name);

test('on v13 the market tools are added to the tokens group, keyed by name, after the existing tools', () => {
  const c = v13Controls();
  assert.equal(addMarketControls(c, tools()), true);
  assert.deepEqual(v13Names(c.tokens), ['select', 'ncm', 'nci-terminal', 'nci-gm-console']);
  assert.equal(c.tokens.tools['nci-terminal'].name, 'nci-terminal');
  assert.deepEqual(Object.keys(c), ['tokens', 'night-city-messenger'], 'no group is created');
  assert.deepEqual(v13Names(c['night-city-messenger']), ['ncm-inbox'], 'and other groups are untouched');
});

test("on v13 a button's click handler is its onChange, not the deprecated onClick", () => {
  const c = v13Controls();
  const opened = [];
  addMarketControls(c, [{ name: 'nci-terminal', button: true, onClick: () => opened.push('terminal') }]);
  const tool = c.tokens.tools['nci-terminal'];
  assert.equal(tool.onClick, undefined);
  assert.equal(tool.button, true);
  tool.onChange({}, true);
  assert.deepEqual(opened, ['terminal']);
});

test('on v13 calling it twice does not duplicate tools or move them', () => {
  const c = v13Controls();
  addMarketControls(c, tools());
  addMarketControls(c, tools());
  assert.deepEqual(v13Names(c.tokens), ['select', 'ncm', 'nci-terminal', 'nci-gm-console']);
  assert.equal(Object.keys(c.tokens.tools).length, 4);
});

test('on v13 without a tokens group nothing is added and it reports that', () => {
  const c = { 'night-city-messenger': { name: 'night-city-messenger', tools: {} } };
  assert.equal(addMarketControls(c, tools()), false);
  assert.deepEqual(c['night-city-messenger'].tools, {});
  assert.equal(addMarketControls(undefined, tools()), false, 'nor with nothing at all');
});
