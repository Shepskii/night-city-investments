import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [['Alice', 1000, true]] });
const [alice] = env.actors;
const MOD = 'night-city-investments';

let MarketStore, PortfolioRepository;

before(async () => {
  ({ MarketStore } = await import('../scripts/data/MarketStore.js'));
  ({ PortfolioRepository } = await import('../scripts/data/PortfolioRepository.js'));
});

test('saving a GM record replaces it, so a removed key does not linger', async () => {
  await MarketStore.setHidden({ companies: { ARA: { fair: 10 }, MIL: { fair: 20 } } });
  await MarketStore.setHidden({ companies: { ARA: { fair: 11 } } });
  assert.deepEqual(MarketStore.getHidden(), { companies: { ARA: { fair: 11 } } });
});

test('a GM record saved before v0.9.7, unwrapped, still reads', async () => {
  const journal = MarketStore.controlJournal();
  journal.flags[MOD].engine = { companies: { OLD: { fair: 5 } } };
  assert.deepEqual(MarketStore.getHidden(), { companies: { OLD: { fair: 5 } } });
  await MarketStore.setHidden({ companies: {} });
  assert.deepEqual(MarketStore.getHidden(), { companies: {} }, 'and the next save replaces it');
});

test('saving a portfolio replaces it, and an unwrapped one still reads', async () => {
  await PortfolioRepository.save(alice, { cash: 5, brokerBans: { b1: 9 } });
  await PortfolioRepository.save(alice, { cash: 6, brokerBans: {} });
  assert.deepEqual(PortfolioRepository.get(alice).brokerBans, {});

  alice.flags[MOD].portfolio = { cash: 7 };
  assert.equal(PortfolioRepository.hasPortfolio(alice), true);
  assert.equal(PortfolioRepository.get(alice).cash, 7);
});
