import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handPress, runPress, startHandPress, printPress, printCharacterPress, spansLimit, STORY_RULES, storyPercent, BUSINESS_DEFAULTS as P } from '../scripts/engine/index.js';
import { readFileSync } from 'node:fs';

const outlet = { name: 'Network 54', rank: 6 };
const shop = (over = {}) => ({ id: 'b1', status: 'open', press: null, period: { index: 3, startDay: 100, endDay: 107, event: null }, ...over });
const hand = (over = {}) => handPress({ story: 'smear', outlet, ...over });

test('a story run by hand starts at once in a free week', () => {
  const b = shop();
  assert.deepEqual(runPress(b, hand(), 102), { ok: true, when: 'now' });
  assert.equal(b.period.event.kind, 'press');
  assert.equal(b.period.event.printDay, 102 + P.press.printDays);
  assert.equal(b.press.lastDay, 102, 'it starts the 28 days');
});

test('in a busy week it waits for the next, and the event under way is left alone', () => {
  const b = shop({ period: { index: 3, startDay: 100, endDay: 107, event: { kind: 'accident' } } });
  assert.deepEqual(runPress(b, hand(), 102), { ok: true, when: 'next' });
  assert.equal(b.period.event.kind, 'accident');
  assert.equal(b.press.queued.story, 'smear');
  assert.equal(runPress(b, hand(), 103).reason, 'press-queued', 'only one can wait');
});

test('it ignores the limit, and starts it', () => {
  const b = shop({ press: { lastDay: 100 } });
  assert.equal(spansLimit(102, [b.press.lastDay]), true);
  assert.equal(runPress(b, hand(), 102).ok, true);
  assert.equal(spansLimit(120, [b.press.lastDay]), true);
});

test('it replaces a story the GM had still to decide on', () => {
  const b = shop({ press: { lastDay: 100, held: { kind: 'press' } } });
  runPress(b, hand(), 102);
  assert.equal(b.press.held, null);
});

test('a closed business can\'t have one', () => {
  assert.equal(runPress(shop({ status: 'closed' }), hand(), 102).reason, 'not-open');
  assert.equal(runPress(shop({ period: null }), hand(), 102).reason, 'not-open');
});

test('starting a waiting story clears it and dates it from its own week', () => {
  const b = shop({ press: { lastDay: 95, queued: hand() } });
  startHandPress(b, b.press.queued, 100);
  assert.equal(b.press.queued, null);
  assert.equal(b.press.lastDay, 100);
  assert.equal(b.period.event.printDay, 103);
});

const printed = (force) => {
  const b = shop();
  runPress(b, handPress({ story: 'crime', outlet, believed: force }), 100);
  printPress(b, 103, 'seed', { events: [] });
  return b.period.event;
};

test('the GM can decide whether it is believed', () => {
  const yes = printed(true);
  assert.equal(yes.believed, true);
  assert.equal(yes.percent, storyPercent(6, STORY_RULES.fullMargin / 2, 'expose'), 'the middle of the range');
  const no = printed(false);
  assert.equal(no.believed, false);
  assert.equal(no.percent, 0);
});

test('left alone, it is rolled', () => {
  assert.equal('force' in hand(), false);
  const story = { story: 'dirty', rank: 6 };
  printCharacterPress(story, 1);
  assert.equal(story.believed, true);
  const late = { story: 'dirty', rank: 6 };
  printCharacterPress(late, 10);
  assert.equal(late.believed, false);
});

test('a forced decision reaches a story about a character', () => {
  const story = { story: 'dirty', rank: 6, force: false };
  printCharacterPress(story, 1);
  assert.equal(story.believed, false, 'a low die does not overrule the GM');
  const sure = { story: 'dirty', rank: 6, force: true };
  printCharacterPress(sure, 10);
  assert.equal(sure.believed, true);
});

test('the headline is kept only if the GM wrote one', () => {
  assert.equal('headline' in hand(), false);
  assert.equal(hand({ headline: 'Words' }).headline, 'Words');
});

test('every level of a press rumour and every refusal has words', () => {
  const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url))).NCI;
  for (const level of ['vague', 'typical', 'substantial', 'detailed']) assert.ok(lang.Rumour.press[level], level);
  for (const reason of ['press-queued', 'press-busy', 'press-no-stake', 'press-no-heat', 'press-no-underworld', 'press-bad-kind', 'press-no-outlet']) assert.ok(lang.Press.Run.Reason[reason], reason);
});

test('startPeriod takes a waiting story first, and leaves it to collectors or a grudge', () => {
  const src = readFileSync(new URL('../scripts/engine/business.js', import.meta.url), 'utf8');
  assert.match(src, /const queued = !b\.collectors && !b\.grudge \? b\.press\?\.queued \?\? null : null;/);
  assert.match(src, /const event = queued \?\? roomBust/);
});
