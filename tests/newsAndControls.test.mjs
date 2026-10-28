import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyNews, makeNewsItem, addNews, latestNews, NEWS_CAP, parseTarget, percentToAmount, SHOCK_PERSISTENCE,
  appendClose, emptyHistory, replaceLastClose, getSeries, createInitialState, sanitizeCompany, equalWeightIndex,
} from '../scripts/engine/index.js';

test('news items are cleaned, capped and listed newest first', () => {
  let feed = emptyNews();
  feed = addNews(feed, makeNewsItem({ id: '1', tick: 1, headline: '  Arasaka up  ', tone: 'up', companyIds: ['ARA', 'ARA', ''] }));
  feed = addNews(feed, makeNewsItem({ id: '2', tick: 2, headline: 'Markets quiet', tone: 'weird' }));
  assert.equal(feed.items[0].headline, 'Arasaka up');
  assert.deepEqual(feed.items[0].companyIds, ['ARA']);
  assert.equal(feed.items[1].tone, 'neutral');
  assert.deepEqual(latestNews(feed).map((i) => i.id), ['2', '1']);
  assert.deepEqual(latestNews(feed, { companyId: 'ARA' }).map((i) => i.id), ['1']);
  assert.equal(addNews(feed, makeNewsItem({ id: '3', tick: 3, headline: '   ' })).items.length, 2, 'blank headlines are ignored');
  for (let i = 0; i < NEWS_CAP + 10; i++) feed = addNews(feed, makeNewsItem({ id: `n${i}`, tick: i, headline: `h${i}` }));
  assert.equal(feed.items.length, NEWS_CAP);
  assert.equal(addNews(null, makeNewsItem({ id: 'x', tick: 0, headline: 'ok' })).items.length, 1);
});

test('target keys parse to targets', () => {
  assert.deepEqual(parseTarget('market'), { type: 'market' });
  assert.deepEqual(parseTarget('sector:arms'), { type: 'sector', id: 'arms' });
  assert.deepEqual(parseTarget('company:ARA'), { type: 'company', id: 'ARA' });
  assert.equal(parseTarget('company:'), null);
  assert.equal(parseTarget('nonsense'), null);
  assert.equal(parseTarget(undefined), null);
});

test('shock percentages convert to log returns and persistence presets exist', () => {
  assert.ok(Math.abs(percentToAmount(10) - Math.log(1.1)) < 1e-12);
  assert.ok(percentToAmount(-50) < 0);
  assert.ok(Number.isFinite(percentToAmount(-9999)), 'extreme values are clamped');
  assert.ok(SHOCK_PERSISTENCE.lasting.permanent > SHOCK_PERSISTENCE.standard.permanent);
  assert.ok(SHOCK_PERSISTENCE.standard.permanent > SHOCK_PERSISTENCE.temporary.permanent);
});

test('replaceLastClose changes only the newest close', () => {
  let h = appendClose(emptyHistory(), 'A', 0, 10);
  h = appendClose(h, 'A', 1, 11);
  assert.deepEqual(getSeries(replaceLastClose(h, 'A', 15), 'A'), [10, 15]);
  assert.equal(replaceLastClose(h, 'NOPE', 1), h);
});

test('split factor keeps the index and a reset on the post-split basis', () => {
  const co = sanitizeCompany({ name: 'X', ticker: 'XX', initialPrice: 200, splitFactor: 4 }).company;
  assert.equal(co.splitFactor, 4);
  assert.equal(sanitizeCompany({ name: 'X', ticker: 'XX', initialPrice: 200 }).company.splitFactor, 1);
  assert.equal(sanitizeCompany({ name: 'X', ticker: 'XX', initialPrice: 200, splitFactor: 0.2 }).company.splitFactor, 1);
  assert.equal(createInitialState({ companies: [co] }).companies.XX.price, 50);
  const idx = equalWeightIndex([{ price: 50, prevClose: 50, base: co.initialPrice / co.splitFactor }]);
  assert.equal(idx.level, 100);
});

test('split settings are sanitised', () => {
  const c = sanitizeCompany({ name: 'X', ticker: 'XX', initialPrice: 10, split: { auto: true, above: 0, ratio: 99 } }).company;
  assert.equal(c.split.auto, true);
  assert.equal(c.split.above, 1);
  assert.equal(c.split.ratio, 20);
  assert.deepEqual(sanitizeCompany({ name: 'X', ticker: 'XX', initialPrice: 10 }).company.split, { auto: false, above: 500, ratio: 2 });
});
