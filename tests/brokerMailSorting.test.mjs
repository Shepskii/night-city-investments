import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketCommand, parseOrderText } from '../scripts/engine/index.js';

const portfolio = {
  lots: [], orders: [{ id: 'o_abc123', status: 'open', assetId: 'a1' }], withdrawals: [],
};
const resolveAsset = (ticker) => (ticker === 'ARA' ? { assetId: 'a1', kind: 'stock' } : null);
const read = (subject, ...body) => marketCommand({ text: `${subject}\n${body.join('\n')}`, portfolio, resolveAsset });
const cmd = (...mail) => read(...mail)?.cmd ?? null;

test('ordinary mail to a broker is not market business', () => {
  assert.equal(read('Friday', 'Are we still on for the job?'), null);
  assert.equal(read('', ''), null);
  assert.equal(read('Please buy me some ARA stock'), null);
});

test('an order counts wherever it is, with chat around it', () => {
  assert.equal(cmd('BUY 10 ARA'), 'buy');
  assert.equal(cmd('Instructions', 'Hi there,', 'sell 5 shares of ara @ 80', 'Thanks'), 'sell');
  assert.equal(cmd('Hello', 'WITHDRAW 5,000 eb'), 'withdraw');
});

test('a ticker that is not on the market is ordinary mail', () => {
  assert.equal(read('Stock', 'Buy 10 grenades'), null);
  assert.equal(read('Sell 5 guns'), null);
  assert.equal(read('Stock', 'buy 0 guns'), null);
  assert.equal(read('Stock', 'buy 10 shares'), null);
  assert.equal(cmd('Stock', 'Sell 5 guns', 'BUY 1 ARA'), 'buy', 'and does not hide a real order after it');
});

test('a one-word request must be the whole message', () => {
  for (const word of ['STATUS', 'Statement', 'help', 'Help?', 'Balance']) {
    assert.ok(read(word), `${word} as the subject of an empty mail`);
    assert.ok(read('Instructions', word), `${word} as the whole body`);
  }
  assert.equal(read('Help!', 'They are right behind me'), null);
  assert.equal(read('Hey', 'Help!', 'Call me back'), null);
  assert.equal(read('Status', 'Do you have an update on the shipment?'), null);
  assert.equal(cmd('Help', 'BUY 1 ARA'), 'buy', 'and it does not hide a real order');
});

test('a cancel counts only for the sender\'s own open order or withdrawal', () => {
  assert.equal(cmd('CANCEL ABC123'), 'cancel');
  assert.equal(cmd('Please', 'cancel abc123'), 'cancel');
  assert.equal(read('Plans', 'Cancel dinner'), null);
  assert.equal(read('CANCEL FFFFFF'), null);
  const withdrawing = { ...portfolio, withdrawals: [{ id: 'w_xyz789', status: 'pending' }] };
  assert.equal(marketCommand({ text: 'CANCEL XYZ789', portfolio: withdrawing, resolveAsset })?.cmd, 'cancel');
});

test('an order the broker must refuse still gets its answer', () => {
  assert.equal(read('buy 0 ARA').error, 'bad-quantity');
  assert.equal(read('withdraw 0').error, 'bad-amount');
  assert.equal(cmd('sell all ara'), 'sell', 'even with no shares to sell');
  assert.equal(cmd('Note', 'buy 0 ARA', 'BUY 1 ARA'), 'buy', 'and a good order after it wins');
});

test('the pre-filled Write to your broker text is not market business', () => {
  assert.equal(read('Instructions', '(Delete this and write one order per mail.)', 'For example, to buy 10 shares of Arasaka write the word Buy, then 10, then the ticker ARA.'), null);
  assert.equal(parseOrderText('BUY 10 ARA').cmd, 'buy', 'the plain parser is unchanged');
});
