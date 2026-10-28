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
