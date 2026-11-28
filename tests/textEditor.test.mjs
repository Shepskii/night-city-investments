import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textEditor } from '../scripts/utils/helpers.js';

const foundryBefore = globalThis.foundry;
const restore = () => {
  globalThis.foundry = foundryBefore;
  delete globalThis.TextEditor;
};

test('the namespaced TextEditor (v13) is preferred over the global', (t) => {
  t.after(restore);
  const namespaced = { name: 'namespaced' };
  globalThis.TextEditor = { name: 'global' };
  globalThis.foundry = { ...foundryBefore, applications: { ux: { TextEditor: { implementation: namespaced } } } };
  assert.equal(textEditor(), namespaced);
});

test('without the namespaced one (v12), the global TextEditor is used', (t) => {
  t.after(restore);
  const global = { name: 'global' };
  globalThis.TextEditor = global;
  globalThis.foundry = { ...foundryBefore, applications: { api: {} } };
  assert.equal(textEditor(), global);
  globalThis.foundry = undefined;
  assert.equal(textEditor(), global, 'even with no foundry namespace at all');
});
