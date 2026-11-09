import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heatPeak, notePeak, characterPressChance, characterTruths, spansLimit, drawCharacterPress, printCharacterPress, answerCharacterPress, settleCharacterPress, drawPress, normalizeStories,
  createRng, BUSINESS_DEFAULTS as P,
} from '../scripts/engine/index.js';
import { readFileSync } from 'node:fs';

const rng = () => createRng('t', 'press');
const worst = (value) => ({ id: 'ara', name: 'Arasaka', value, businessId: 'b1' });
const media = [{ name: 'Network 54', ticker: 'N54' }];
const base = { id: 's1', actorId: 'a1', name: 'Boar', day: 100, truths: ['dirty'], rng: rng() };
const story = (over = {}) => ({ story: 'dirty', rank: 6, printed: true, believed: true, percent: -7, ...over });

test('a peak lasts four weeks, then is forgotten', () => {
  let p = notePeak({}, 10, 60);
  p = notePeak(p, 11, 12);
  assert.equal(heatPeak(p, 11), 60);
  assert.equal(heatPeak(p, 13), 60, 'three weeks on');
  assert.equal(heatPeak(p, 14), 12, 'four weeks on, week 10 has gone');
  p = notePeak(p, 15, 0);
  assert.deepEqual(Object.keys(p), [], 'old weeks are pruned, and a week of no heat notes nothing');
  assert.equal(heatPeak(undefined, 5), 0);
});

test('a week keeps its highest', () => {
  assert.equal(notePeak(notePeak({}, 3, 50), 3, 20)[3], 50);
  assert.equal(notePeak(notePeak({}, 3, 20), 3, 50)[3], 50);
});

test('the chance follows the heat tier and the setting', () => {
  assert.equal(characterPressChance(24), 0);
  assert.equal(characterPressChance(25), 0.02);
  assert.equal(characterPressChance(50), 0.04);
  assert.equal(characterPressChance(75), 0.08);
  assert.equal(characterPressChance(75, 2), 0.16);
  assert.equal(characterPressChance(25, 0.5), 0.01);
});

test('what is true of a character', () => {
  assert.deepEqual(characterTruths(10), []);
  assert.deepEqual(characterTruths(30), ['dirty']);
  assert.deepEqual(characterTruths(30, { ticker: 'SCX' }), ['dirty', 'hidden']);
});

test('the 28 days are shared', () => {
  assert.equal(spansLimit(100, [null, 73]), true);
  assert.equal(spansLimit(100, [72]), false);
  assert.equal(spansLimit(100, [undefined]), false);
});

test('who prints it', () => {
  const none = { ...base, media: [], rng: rng() };
  assert.equal(drawCharacterPress(none), null, 'no grudge and no media: nobody to print it');
  const m = drawCharacterPress({ ...base, media, rng: rng() });
  assert.equal(m.outlet, 'Network 54');
  assert.equal(m.rank, 6);
  assert.equal(m.grudge, null);
  const wary = drawCharacterPress({ ...base, worst: worst(-30), media, rng: rng() });
  assert.equal(wary.outlet, 'Arasaka', 'a wary corporation prints its own');
  assert.equal(wary.rank, 4);
  const hostile = drawCharacterPress({ ...base, worst: worst(-90), media, rng: rng() });
  assert.equal(hostile.outlet, 'Network 54');
  assert.equal(hostile.grudge, 'Arasaka');
  const alone = drawCharacterPress({ ...base, worst: worst(-90), media: [], rng: rng() });
  assert.equal(alone.outlet, 'Arasaka');
  assert.equal(alone.status, 'held');
});

test('a smear is the only story with nothing true to tell, and a hidden stake carries the company', () => {
  assert.equal(drawCharacterPress({ ...base, truths: [], media, rng: rng() }).story, 'smear');
  let found = null;
  for (let i = 0; i < 50 && !found; i++) {
    const s = drawCharacterPress({ ...base, truths: ['hidden'], stake: { ticker: 'SCX', name: 'Clinic' }, media, rng: createRng('x', i) });
    if (s.story === 'hidden') found = s;
  }
  assert.deepEqual(found.stake, { ticker: 'SCX', name: 'Clinic' });
});

test('Believability is as for a business story', () => {
  const low = story({ printed: false, rank: 6 });
  printCharacterPress(low, 5);
  assert.equal(low.believed, true, 'rank 6 is 4, and a true story adds 1');
  const high = story({ printed: false, rank: 6 });
  printCharacterPress(high, 6);
  assert.equal(high.believed, false);
  assert.equal(high.percent, 0);
  const smear = story({ story: 'smear', printed: false, rank: 6 });
  printCharacterPress(smear, 4);
  assert.equal(smear.believed, false, 'a smear is harder to believe');
});

test('silence costs all, a poor answer half, a good one nothing, and a story nobody believed nothing', () => {
  assert.equal(settleCharacterPress(story()).scale, 1);
  const halved = story(); answerCharacterPress(halved, 'failure');
  assert.equal(settleCharacterPress(halved).scale, 0.5);
  const fumbled = story(); answerCharacterPress(fumbled, 'fumble');
  assert.equal(settleCharacterPress(fumbled).scale, 1);
  const good = story(); answerCharacterPress(good, 'solid');
  assert.equal(settleCharacterPress(good).scale, 0);
  assert.equal(settleCharacterPress(story({ believed: false })).scale, 0);
});

test('each kind does what the plan says', () => {
  assert.deepEqual(settleCharacterPress(story()), { scale: 1, heat: 15, reputation: -2.5, percent: 0 });
  assert.equal(settleCharacterPress(story({ rank: 4 })).heat, 10, 'less from a corporation\'s own press');
  const hidden = settleCharacterPress(story({ story: 'hidden', percent: -8 }));
  assert.equal(hidden.heat, 15);
  assert.equal(hidden.percent, -4, 'half the limit');
  assert.equal(settleCharacterPress(story({ story: 'smear' })).heat, 5);
});

test('a character\'s story holds off a story about a business they run', () => {
  const b = { id: 'b1', digests: [], state: { reputation: 50, compliance: null }, period: { startDay: 100, index: 3 }, press: null, stockQueries: [] };
  const relations = (shared) => ({ exposure: 0, press: { frequency: 100, corps: [{ id: 'a', name: 'A', value: -80 }], media: [], sharedLastDay: shared } });
  assert.equal(drawPress(b, 's', P, relations(90)), null);
  assert.ok(drawPress(b, 's', P, relations(60)));
});

test('the record keeps what it did not know about', () => {
  const r = normalizeStories({ pending: [{ id: 'x' }] });
  assert.deepEqual(r.press, { peaks: {}, lastDay: {}, lastCheck: null, stories: [] });
  const again = normalizeStories({ ...r, press: { ...r.press, lastCheck: 7 } });
  assert.equal(again.press.lastCheck, 7);
});

test('its wording exists', () => {
  const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8')).NCI;
  for (const k of Object.keys(P.press.character.kinds)) {
    for (const g of ['Story', 'Angle', 'Headline']) assert.ok(lang.Press[g][k], `${g}.${k}`);
  }
  for (const k of ['dirty', 'hidden', 'smearCharacter']) assert.ok(lang.Press.Why[k], k);
  for (const k of ['Subject', 'Told', 'Title', 'Hint', 'Answer', 'ResultSubject', 'Ignored', 'Answered', 'Halved', 'Full']) assert.ok(lang.Press.Char[k], k);
  assert.ok(lang.Business.Pending.Need.press);
  assert.ok(lang.Pending.Need.pressCharacter);
  assert.ok(lang.Business.Reason['no-press']);
});
