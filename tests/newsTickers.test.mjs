import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTickers } from '../scripts/engine/newsFeed.js';

const assets = [
  { name: 'Arasaka', ticker: 'ARA' },
  { name: 'Arasaka Security', ticker: 'ASEC' },
  { name: 'Concrete & Copper (Fund)', ticker: 'CCF' },
  { name: 'Biotechnica', ticker: 'BIO' },
  { name: 'SOLO', ticker: 'SOLO' },
];

test('the ticker follows the name, once, in any wording', () => {
  assert.equal(withTickers('Arasaka declares a dividend of 0.39 eb per share.', assets), 'Arasaka (ARA) declares a dividend of 0.39 eb per share.');
  assert.equal(withTickers('The Arasaka offer was oversubscribed.', assets), 'The Arasaka (ARA) offer was oversubscribed.');
  assert.equal(withTickers('Arasaka beats Biotechnica, and Arasaka gloats.', assets), 'Arasaka (ARA) beats Biotechnica (BIO), and Arasaka gloats.');
  assert.equal(withTickers('Concrete & Copper (Fund) pays out.', assets), 'Concrete & Copper (Fund) (CCF) pays out.');
});

test('a longer name is not mistaken for a shorter one, nor part of a word for a name', () => {
  assert.equal(withTickers('Arasaka Security wins a contract.', assets), 'Arasaka Security (ASEC) wins a contract.');
  assert.equal(withTickers('Biotechnical failures abound.', assets), 'Biotechnical failures abound.');
});

test('a headline that already has it, or has nothing to add, is left alone', () => {
  const done = 'Biotechnica (BIO) is doing badly.';
  assert.equal(withTickers(done, assets), done);
  assert.equal(withTickers(withTickers('Arasaka and Biotechnica merge.', assets), assets), 'Arasaka (ARA) and Biotechnica (BIO) merge.');
  assert.equal(withTickers('Trading is halted.', assets), 'Trading is halted.');
  assert.equal(withTickers('SOLO soars.', assets), 'SOLO soars.', 'a name that is its ticker');
  assert.equal(withTickers('Nothing to go on.', []), 'Nothing to go on.');
});
