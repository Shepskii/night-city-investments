import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [] });
const { stampRows, rowKey, stampText } = await import('../scripts/ui/GMConsole/pendingStamps.js');

const settle = () => new Promise((r) => setTimeout(r, 0));

test('a row is stamped on the game clock when first seen, keeps its stamp, and loses it when it goes', async () => {
  env.clock.ms = Date.UTC(2047, 9, 28, 1, 2);
  const a = { tab: 'businesses', businessId: 'b1', kind: 'npcBid', id: 'x1', item: 'Splice Chrome Clinic' };
  const b = { tab: 'businesses', businessId: 'b1', kind: 'npcBid', id: 'x2', item: 'Splice Chrome Clinic' };
  stampRows([a], { prune: true });
  await settle();
  assert.match(a.seenText, /01:02$/);
  assert.equal(env.store.get('pendingSeen')[rowKey(a)], env.clock.ms);

  // Later: the first keeps its time; a second of the same kind gets its own.
  env.clock.ms = Date.UTC(2047, 9, 29, 13, 45);
  const again = { ...a };
  stampRows([again, b], { prune: true });
  await settle();
  assert.match(again.seenText, /01:02$/);
  assert.match(b.seenText, /13:45$/);
  assert.equal(b.seenText, stampText(Date.UTC(2047, 9, 29, 13, 45)));

  // A tab's own list stamps without dropping the rest.
  stampRows([{ ...b }]);
  await settle();
  assert.ok(env.store.get('pendingSeen')[rowKey(a)]);

  // Settled: its stamp goes with it.
  stampRows([b], { prune: true });
  await settle();
  assert.equal(env.store.get('pendingSeen')[rowKey(a)], undefined);
  assert.ok(env.store.get('pendingSeen')[rowKey(b)]);
});

test('only the active GM writes stamps; another client reads them', async () => {
  const before = structuredClone(env.store.get('pendingSeen'));
  game.users.activeGM = { id: 'someone-else' };
  try {
    const fresh = { tab: 'heat', kind: 'penalty', id: 'p9', item: 'Pat' };
    stampRows([fresh], { prune: true });
    await settle();
    assert.equal(fresh.seenText, '');
    assert.deepEqual(env.store.get('pendingSeen'), before);
  } finally {
    game.users.activeGM = { id: 'gm1' };
  }
});
