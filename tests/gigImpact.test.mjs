import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName, coreName, similarity, parseReward, resolveClient, planGigImpact, gigHeadlineKey, recentGigAbs, GIG_TUNING,
  emptyGigs, normalizeGigs, addPending, removePending, addHistory, isKnownGig, setMapping, removeMapping, sanitizeGigEdits,
  amountToPercent, GIG_HISTORY_CAP, GIG_HEADLINE_VARIANTS, collectImpacts, makeImpact,
} from '../scripts/engine/index.js';
import { STARTER_COMPANIES } from '../scripts/data/starter-companies.js';

const companies = STARTER_COMPANIES.map((c) => ({ id: c.ticker, ticker: c.ticker, name: c.name, aliases: c.aliases }));
const pick = (gig, mappings) => resolveClient(gig, companies, mappings);

test('names are compared without case, punctuation, accents or legal suffixes', () => {
  assert.equal(normalizeName('  Arasaka  Corp. '), 'arasaka corp');
  assert.equal(normalizeName('Café & Sons'), 'cafe and sons');
  assert.equal(coreName('Trauma Team International'), 'trauma team');
  assert.equal(coreName('The Militech Group'), 'militech');
  assert.equal(coreName('Group'), 'group', 'never strips a name down to nothing');
  assert.ok(similarity('arasaka', 'arasaki') > 0.8);
  assert.ok(similarity('arasaka', 'militech') < 0.4);
});

test('a reward is read from free text', () => {
  assert.equal(parseReward(1500), 1500);
  assert.equal(parseReward('1500eb'), 1500);
  assert.equal(parseReward('1,500 eb'), 1500);
  assert.equal(parseReward('5 000 eb'), 5000);
  assert.equal(parseReward('2k'), 2000);
  assert.equal(parseReward('1.5k eb'), 1500);
  assert.equal(parseReward('0.5m'), 500000);
  assert.equal(parseReward('500 eb × team (hard)'), 500);
  assert.equal(parseReward('a favour'), 0);
  assert.equal(parseReward(''), 0);
  assert.equal(parseReward(null), 0);
  assert.equal(parseReward(-5), 0);
});

test('a client resolves by exact name, ticker, alias and legal-suffix variants', () => {
  assert.deepEqual(pick({ client: 'Arasaka' }), { status: 'matched', companyId: 'ARA', how: 'exact', needsReview: false, clientKey: 'arasaka' });
  assert.equal(pick({ client: 'ARASAKA CORPORATION' }).companyId, 'ARA');
  assert.equal(pick({ client: 'Trauma Team' }).companyId, 'TTI', 'an alias');
  assert.equal(pick({ client: 'Militech International Armaments' }).companyId, 'MIL');
  assert.equal(pick({ client: 'kiroshi' }).companyId, 'KIR');
  assert.equal(pick({ client: 'ZET' }).companyId, 'ZET', 'a ticker on its own');
  assert.equal(pick({ client: 'Night Corp' }).companyId, 'NCP');
});

test('a name inside the client text counts, but a ticker inside a phrase does not', () => {
  const r = pick({ client: 'Arasaka Security Division, Night City branch' });
  assert.equal(r.companyId, 'ARA');
  assert.equal(r.how, 'contains');
  assert.equal(r.needsReview, false);
  assert.equal(pick({ client: 'Paranormal ARA research' }).status, 'unmatched', 'tickers are never matched inside a phrase');
  assert.equal(pick({ client: 'a corp fixer' }).status, 'unmatched');
});

test('a near miss is matched but must be reviewed; two close companies are ambiguous', () => {
  const r = pick({ client: 'Arasakka' });
  assert.equal(r.companyId, 'ARA');
  assert.equal(r.how, 'fuzzy');
  assert.equal(r.needsReview, true);

  const twins = [{ id: 'A', ticker: 'AAA', name: 'Northwind Systems', aliases: [] }, { id: 'B', ticker: 'BBB', name: 'Northwand Systems', aliases: [] }];
  const amb = resolveClient({ client: 'Northwynd Systems' }, twins, {});
  assert.equal(amb.status, 'ambiguous');
  assert.deepEqual(amb.candidates.sort(), ['A', 'B']);
  const both = resolveClient({ client: 'Kiroshi Dynalar joint venture' }, companies, {});
  assert.equal(both.status, 'ambiguous');
  assert.deepEqual(both.candidates.sort(), ['DYN', 'KIR']);
});

test('saved mappings win, can ignore a client, and are skipped when the company is gone', () => {
  const key = normalizeName('Mr. Johnson');
  assert.equal(pick({ client: 'Mr. Johnson' }).status, 'unmatched');
  const mapped = pick({ client: 'MR JOHNSON' }, { [key]: { companyId: 'MIL' } });
  assert.deepEqual([mapped.status, mapped.companyId, mapped.how, mapped.needsReview], ['matched', 'MIL', 'mapping', false]);
  assert.equal(pick({ client: 'Mr. Johnson' }, { [key]: { companyId: 'ignore' } }).status, 'ignored');
  assert.equal(pick({ client: 'Mr. Johnson' }, { [key]: { companyId: 'GONE' } }).status, 'unmatched');
  assert.equal(pick({ client: 'Arasaka' }, { arasaka: { companyId: 'BIO' } }).companyId, 'BIO', 'a mapping beats a name match');
});

test('a [NCI: ...] tag in the notes names the company or skips the gig', () => {
  assert.equal(pick({ client: 'Unknown', notes: 'Job for a friend [NCI: kan]' }).companyId, 'KAN');
  assert.equal(pick({ client: 'Unknown', notes: '[invest=BIO]' }).how, 'tag');
  assert.equal(pick({ client: 'Arasaka', notes: '[NCI: ignore]' }).status, 'ignored');
  assert.equal(pick({ client: 'Unknown', notes: '[NCI: NOPE]' }).status, 'unmatched', 'an unknown tag falls through');
});

test('with no usable client, a company named in the gig text is offered for review', () => {
  const r = pick({ client: '', text: 'Extract a courier from the Kendachi tower before dawn' });
  assert.equal(r.companyId, 'KEN');
  assert.equal(r.how, 'mention');
  assert.equal(r.needsReview, true);
  assert.equal(pick({ client: '', text: 'Pick up a parcel' }).status, 'unmatched');
  assert.equal(pick({ client: '' }).status, 'unmatched');
});

test('impact size: failures hit harder, bigger rewards move more, and it is capped', () => {
  const done = planGigImpact({ outcome: 'done', reward: 1000, key: 'k' });
  const failed = planGigImpact({ outcome: 'failed', reward: 1000, key: 'k' });
  assert.ok(done.amount > 0 && failed.amount < 0);
  assert.ok(Math.abs(failed.amount) > done.amount * 1.25, 'failure is weighted about 1.3x');
  assert.ok(done.percent > 1 && done.percent < 2, `a 1,000 eb job is about +1.5%: ${done.percent}`);
  assert.ok(planGigImpact({ outcome: 'done', reward: 50_000, key: 'k' }).amount > done.amount * 2);
  assert.ok(planGigImpact({ outcome: 'done', reward: 0, key: 'k' }).amount > 0, 'even a favour matters a little');
  const huge = planGigImpact({ outcome: 'failed', reward: 1e12, scale: 3, key: 'k' });
  assert.ok(Math.abs(huge.amount) <= GIG_TUNING.hardCap + 1e-9);
  assert.equal(amountToPercent(Math.log(1.05)), 5);
});

test('the GM scale multiplies the impact, within its range', () => {
  const one = planGigImpact({ outcome: 'done', reward: 2000, scale: 1, key: 'k' }).amount;
  assert.ok(Math.abs(planGigImpact({ outcome: 'done', reward: 2000, scale: 2, key: 'k' }).amount - one * 2) < 1e-3);
  assert.equal(planGigImpact({ outcome: 'done', reward: 2000, scale: 99, key: 'k' }).amount, planGigImpact({ outcome: 'done', reward: 2000, scale: 3, key: 'k' }).amount);
  assert.equal(planGigImpact({ outcome: 'done', reward: 2000, scale: 0, key: 'k' }).amount, one, 'a zero scale falls back to normal');
});

test('recent impacts on the same company reduce the next one, but never to nothing', () => {
  const fresh = planGigImpact({ outcome: 'done', reward: 3000, key: 'k' });
  const busy = planGigImpact({ outcome: 'done', reward: 3000, recentAbs: 0.05, key: 'k' });
  const swamped = planGigImpact({ outcome: 'done', reward: 3000, recentAbs: 5, key: 'k' });
  assert.ok(busy.amount < fresh.amount && busy.saturated);
  assert.ok(Math.abs(swamped.amount - fresh.amount * GIG_TUNING.minRoom) < 1e-3);
  assert.equal(fresh.saturated, false);

  let gigs = emptyGigs();
  const hit = (companyId, tick, amount, status = 'applied') => { gigs = addHistory(gigs, { sourceKey: `${companyId}${tick}`, companyId, tick, amount, status }); };
  hit('ARA', 10, 0.03);
  hit('ARA', 12, -0.02);
  hit('ARA', 3, 0.05);
  hit('MIL', 11, 0.04);
  hit('ARA', 11, 0.09, 'discarded');
  assert.ok(Math.abs(recentGigAbs(gigs, 'ARA', 13) - 0.05) < 1e-9, 'only recent, applied and the same company');
  assert.equal(recentGigAbs(gigs, 'ARA', 40), 0);
});

test('the delay is 1 to 3 days, the same for the same gig, and varies between gigs', () => {
  const delays = new Set();
  for (let i = 0; i < 60; i++) {
    const d = planGigImpact({ outcome: 'done', reward: 1000, key: `gig:${i}:done` }).delayDays;
    assert.ok(d >= 1 && d <= 3);
    delays.add(d);
  }
  assert.deepEqual([...delays].sort(), [1, 2, 3]);
  assert.equal(planGigImpact({ outcome: 'done', reward: 1000, key: 'x' }).delayDays, planGigImpact({ outcome: 'done', reward: 1000, key: 'x' }).delayDays);
});

test('failures last longer than successes', () => {
  const done = planGigImpact({ outcome: 'done', reward: 1000, key: 'k' });
  const failed = planGigImpact({ outcome: 'failed', reward: 1000, key: 'k' });
  assert.ok(failed.permanent > done.permanent && failed.tauDown > done.tauDown);
});

test('a gig impact goes through the impact kernel: nothing before it starts, then a ramp', () => {
  const plan = planGigImpact({ outcome: 'failed', reward: 4000, key: 'gig:1:failed' });
  const tick = 10;
  const impact = makeImpact({
    id: 'i', target: { type: 'company', id: 'ARA' }, amount: plan.amount, onsetTick: tick + plan.delayDays - 1,
    permanent: plan.permanent, tauDown: plan.tauDown, source: 'gig', sourceKey: 'gig:1:failed',
  });
  const co = [{ id: 'ARA', beta: 1 }];
  const at = (t) => collectImpacts([impact], co, t).returns.ARA ?? 0;
  for (let t = tick; t < tick + plan.delayDays; t++) assert.equal(at(t), 0, `tick ${t} is before the effect shows`);
  assert.ok(at(tick + plan.delayDays) < 0, 'it shows on the first tick of the delay');
  let total = 0;
  for (let t = tick; t < tick + 60; t++) total += at(t);
  assert.ok(total < plan.amount * plan.permanent * 0.8 && total > plan.amount * 1.1, `settles toward its permanent part: ${total}`);
});

test('headlines are generic and chosen from the outcome and size', () => {
  const keys = new Set();
  for (let i = 0; i < 400; i++) keys.add(gigHeadlineKey({ outcome: 'done', percent: 1.2, key: `k${i}` }));
  assert.deepEqual([...keys].sort(), Array.from({ length: GIG_HEADLINE_VARIANTS }, (_, n) => `NCI.Gig.Headline.done.mild.${n + 1}`));
  assert.equal(GIG_HEADLINE_VARIANTS, 8);
  assert.match(gigHeadlineKey({ outcome: 'failed', percent: -5, key: 'x' }), /^NCI\.Gig\.Headline\.failed\.strong\.[1-8]$/);
  assert.match(gigHeadlineKey({ outcome: 'failed', percent: -1, key: 'x' }), /\.failed\.mild\./);
  assert.equal(gigHeadlineKey({ outcome: 'done', percent: 2, key: 'same' }), gigHeadlineKey({ outcome: 'done', percent: 2, key: 'same' }));
});

test('the queue keeps pending items and a capped history, and knows what it has seen', () => {
  let g = normalizeGigs(null);
  assert.deepEqual(g, emptyGigs());
  g = addPending(g, { id: 'a', sourceKey: 'gig:1:done', kind: 'review' });
  assert.equal(isKnownGig(g, 'gig:1:done'), true);
  assert.equal(isKnownGig(g, 'gig:2:done'), false);
  g = removePending(g, 'a');
  assert.equal(isKnownGig(g, 'gig:1:done'), false);
  g = addHistory(g, { sourceKey: 'gig:1:done', status: 'applied' });
  assert.equal(isKnownGig(g, 'gig:1:done'), true, 'handled gigs are remembered');
  for (let i = 0; i < GIG_HISTORY_CAP + 20; i++) g = addHistory(g, { sourceKey: `k${i}`, status: 'applied' });
  assert.equal(g.history.length, GIG_HISTORY_CAP);
  assert.equal(normalizeGigs({ pending: 'nope', mappings: null }).pending.length, 0);
});

test('mappings are added and removed without touching the rest', () => {
  let g = setMapping(emptyGigs(), 'mr johnson', 'MIL', 'Mr. Johnson');
  g = setMapping(g, 'fixer', 'ignore');
  assert.deepEqual(g.mappings['mr johnson'], { companyId: 'MIL', label: 'Mr. Johnson' });
  assert.equal(g.mappings.fixer.label, 'fixer');
  assert.equal(setMapping(g, '', 'MIL'), g, 'an empty key is refused');
  g = removeMapping(g, 'mr johnson');
  assert.deepEqual(Object.keys(g.mappings), ['fixer']);
});

test('GM edits are clamped to a sensible size and delay', () => {
  assert.deepEqual(sanitizeGigEdits({ percent: 2.5, delayDays: 2 }), { percent: 2.5, delayDays: 2 });
  assert.deepEqual(sanitizeGigEdits({ percent: 400, delayDays: 400 }), { percent: 30, delayDays: 30 });
  assert.deepEqual(sanitizeGigEdits({ percent: -400, delayDays: -4 }), { percent: -30, delayDays: 0 });
  assert.deepEqual(sanitizeGigEdits({ percent: 0, delayDays: 'x' }), { percent: null, delayDays: null });
});
