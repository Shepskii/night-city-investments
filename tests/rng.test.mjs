import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashSeed } from '../scripts/engine/rng.js';

test('same seed parts give the same stream', () => {
  const a = createRng('w', 5, 'ARA');
  const b = createRng('w', 5, 'ARA');
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
});

test('different parts give different streams', () => {
  assert.notEqual(hashSeed('w', 5, 'ARA'), hashSeed('w', 5, 'MIL'));
  assert.notEqual(createRng('w', 5, 'ARA').next(), createRng('w', 6, 'ARA').next());
});

test('next() stays in [0, 1)', () => {
  const r = createRng('range');
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
  }
});

test('studentT has about unit variance and heavier tails than normal', () => {
  const r = createRng('t');
  const n = 40000;
  const xs = Array.from({ length: n }, () => r.studentT(5));
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / n;
  assert.ok(Math.abs(m) < 0.05, `mean ${m}`);
  assert.ok(Math.abs(v - 1) < 0.1, `variance ${v}`);
  const extreme = xs.filter((x) => Math.abs(x) > 3).length / n;
  assert.ok(extreme > 0.004, `tail mass ${extreme}`);
});

test('weighted honours weights', () => {
  const r = createRng('w');
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 5000; i++) counts[r.weighted({ a: 3, b: 1 })]++;
  assert.ok(counts.a > counts.b * 2);
});
