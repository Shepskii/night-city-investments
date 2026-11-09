import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, normalizeBusiness, ARCHETYPES, BUSINESS_DEFAULTS as P,
  pressTruths, pressChance, drawPress, approvePress, spikePress, printPress, hostileAct, EVENTS,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';
import { readFileSync } from 'node:fs';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const MONDAY = 1;
const DAY = 20003;
const check = (base, die, dv) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv }) });

function apply(business, request, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: `k${Math.random()}`, ...request }, actor: MED, day: DAY, check: extra.check,
    context: { approval: false, weekday: MONDAY, actors: {}, newId: 'b1', seed: 'test', ...extra.context },
  });
  assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

function clinic() {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 4000 }).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: ARCHETYPES.clinic.trade[0] }, { check: check(14, 9, 13) }).business;
  const out = normalizeBusiness({ ...b, till: 3000 });
  out.state.capacity = 1;
  delete out.period.event;
  return out;
}

const corp = (value) => ({ id: 'ara', name: 'Arasaka', value });
const relations = (value, extra = {}, top = {}) => ({ hostile: [], exposure: 0, press: { frequency: 1, approval: true, underworld: true, corps: [corp(value)], media: [{ name: 'Network 54', ticker: 'N54' }], ...extra }, ...top });
const event = (over = {}) => ({ kind: 'press', story: 'smear', factionName: 'Network 54', factionId: 'ara', grudge: 'Arasaka', rank: 6, printDay: 0, ...over });

/** A week with a story already on it, believed or not, closed with this answer. */
function closeWith(story, { believed = true, percent = -5, band = null, rank = 6, stage = null } = {}) {
  const b = clinic();
  if (stage != null) b.stage = stage;
  b.period.event = event({ story, rank, printed: true, believed, percent });
  if (band) b.period.slots.push({ action: 'respond', event: 'press', by: 'med', band });
  return advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test' });
}
const result = (out) => out.events.find((e) => e.type === 'pressResult');
/** Reputation the story took: settling toward 50 is the same whether or not it landed. */
const repAfter = (out) => out.business.state.reputation;

test('what can truthfully be told follows what has happened', () => {
  const b = clinic();
  assert.deepEqual(pressTruths(b), []);
  b.digests = [{ profit: -10 }];
  assert.deepEqual(pressTruths(b), ['money']);
  b.digests = [];
  assert.deepEqual(pressTruths(b, { exposure: 20 }), ['crime']);
  assert.deepEqual(pressTruths(b, { exposure: 20, underworld: false }), [], 'crime goes with the Underworld setting');
  b.state.reputation = 30;
  assert.deepEqual(pressTruths(b), ['service']);
  b.state.reputation = 50;
  b.digests = [{ profit: 10, event: { kind: 'bust' } }];
  assert.deepEqual(pressTruths(b), ['crime'], 'a recent raid');
});

test('the chance follows the worst standing and the setting', () => {
  assert.equal(pressChance(40, true), 0, 'a friend runs nothing');
  assert.equal(pressChance(0, false), 0, 'neutral needs something true');
  assert.equal(pressChance(0, true), 0.01);
  assert.equal(pressChance(-30, false), 0.04);
  assert.equal(pressChance(-30, false, 2), 0.08, 'Often');
  assert.equal(pressChance(-60, false), 0.04, 'the very edge is still wary');
  assert.ok(Math.abs(pressChance(-61, false) - 0.105) < 1e-9, 'twice the hostile act just past it');
  assert.ok(Math.abs(pressChance(-100, false) - 0.3) < 1e-9, 'and at the worst');
});

test('a draw needs a corporation, respects the limit, and picks the outlet by standing', () => {
  const certain = { frequency: 100 };
  const b = clinic();
  assert.equal(drawPress(b, 's', P, null), null, 'stories off');
  assert.equal(drawPress(b, 's', P, relations(-80, { corps: [] })), null, 'no corporation');
  const hostile = drawPress(b, 's', P, relations(-80, certain));
  assert.equal(hostile.kind, 'press');
  assert.equal(hostile.story, 'smear', 'a clean business can only be smeared');
  assert.equal(hostile.factionName, 'Network 54');
  assert.equal(hostile.rank, 6);
  assert.equal(hostile.grudge, 'Arasaka');
  assert.equal(hostile.printDay, b.period.startDay + 3);
  const none = drawPress(b, 's', P, relations(-80, { ...certain, media: [] }));
  assert.equal(none.factionName, 'Arasaka', 'no media company in this world: its own press');
  assert.equal(none.rank, 4);
  const wary = drawPress(b, 's', P, relations(-30, certain));
  assert.equal(wary.factionName, 'Arasaka', 'only a hostile corporation goes to the media');
  b.press = { lastDay: b.period.startDay - 27 };
  assert.equal(drawPress(b, 's', P, relations(-80, certain)), null, 'inside the 28 days');
  b.press = { lastDay: b.period.startDay - 28 };
  assert.ok(drawPress(b, 's', P, relations(-80, certain)), 'and after them');
});

test('the worst corporation is the one with the grudge', () => {
  const b = clinic();
  const out = drawPress(b, 's', P, relations(0, { frequency: 100, corps: [corp(10), { id: 'mil', name: 'Militech', value: -40 }], media: [] }));
  assert.equal(out.grudge, 'Militech');
});

test('with stories on, a hostile corporation does not also smear, and its other acts are no likelier', () => {
  const b = clinic();
  const hostile = [{ id: 'ara', name: 'Arasaka', kind: 'corp', value: -100 }];
  let raids = [0, 0]; let smears = [0, 0];
  for (let i = 0; i < 3000; i++) {
    b.period.index = i;
    const off = hostileAct(b, 'seed', P, { hostile });
    const on = hostileAct(b, 'seed', P, { hostile, press: {} });
    if (off?.kind === 'raid') raids[0] += 1;
    if (on?.kind === 'raid') raids[1] += 1;
    if (off?.kind === 'smear') smears[0] += 1;
    if (on?.kind === 'smear') smears[1] += 1;
  }
  assert.ok(smears[0] > 0);
  assert.equal(smears[1], 0);
  assert.equal(raids[1], raids[0]);
});

test('a story waits for the GM, showing the owners nothing, and only then is the week\'s event', () => {
  const b = clinic();
  const out = advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test', relations: relations(-80, { frequency: 100 }) });
  const next = out.business;
  assert.ok(next.press.held, 'waiting');
  assert.equal(next.period.event, undefined, 'and not on the week');
  assert.equal(next.press.lastDay, next.period.startDay);
  assert.equal(approvePress(next, '  A   headline ').ok, true);
  assert.equal(next.period.event.kind, 'press');
  assert.equal(next.period.event.headline, 'A headline');
  assert.equal(next.press.held, null);
  assert.equal(approvePress(next, 'x').reason, 'no-story');
});

test('with approval off it goes straight on the week', () => {
  const b = clinic();
  const out = advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test', relations: relations(-80, { frequency: 100, approval: false }) });
  assert.equal(out.business.period.event.kind, 'press');
  assert.equal(out.business.press.held, null);
});

test('a spiked story still starts the limit, and an undecided one lapses with its week', () => {
  const b = clinic();
  const first = advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test', relations: relations(-80, { frequency: 100 }) }).business;
  const spiked = structuredClone(first);
  assert.equal(spikePress(spiked).ok, true);
  assert.equal(spiked.press.held, null);
  assert.equal(spiked.press.lastDay, first.press.lastDay);
  assert.equal(spikePress(spiked).reason, 'no-story');
  const lapsed = advanceBusiness(first, first.period.endDay, { weekday: MONDAY, seed: 'test', relations: relations(-80, { frequency: 100 }) }).business;
  assert.equal(lapsed.press.held, null, 'nobody decided, and it is inside the limit so nothing replaced it');
});

test('it prints on its day, once, and the same way every time', () => {
  const b = clinic();
  b.period.event = event({ printDay: DAY + 10 });
  const out = { events: [] };
  assert.equal(printPress(b, DAY + 9, 's', out), false);
  assert.equal(printPress(b, DAY + 10, 's', out), true);
  assert.equal(out.events[0].type, 'pressPrinted');
  const { believed, percent } = b.period.event;
  assert.equal(printPress(b, DAY + 11, 's', out), false, 'once');
  const again = clinic();
  again.period.event = event({ printDay: DAY + 10 });
  printPress(again, DAY + 10, 's', { events: [] });
  assert.equal(again.period.event.believed, believed);
  assert.equal(again.period.event.percent, percent);
  assert.equal(believed, percent < 0);
});

test('a week that closes before the print day still prints it', () => {
  const b = clinic();
  b.period.event = event({ printDay: b.period.endDay + 5 });
  const out = advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test' });
  assert.ok(out.events.some((e) => e.type === 'pressPrinted'));
  assert.ok(result(out));
});

test('believed and unanswered it costs in full, a poor answer half, and a good one nothing', () => {
  const baseline = repAfter(closeWith('service', { believed: false }));
  const full = closeWith('service');
  assert.equal(result(full).scale, 1);
  assert.ok(Math.abs(baseline - repAfter(full) - 5) < 1e-9);
  const halved = closeWith('service', { band: 'failure' });
  assert.equal(result(halved).scale, 0.5);
  assert.ok(Math.abs(baseline - repAfter(halved) - 2.5) < 1e-9);
  const fumbled = closeWith('service', { band: 'fumble' });
  assert.equal(result(fumbled).scale, 1);
  const answered = closeWith('service', { band: 'solid' });
  assert.equal(result(answered).scale, 0);
  assert.equal(repAfter(answered), baseline);
});

test('a story nobody believes does nothing, answered or not', () => {
  const out = closeWith('crime', { believed: false });
  const r = result(out);
  assert.equal(r.believed, false);
  assert.equal(r.scale, 0);
  assert.equal(r.percent, 0);
  assert.equal(r.exposure, undefined);
  assert.equal(r.regCase, false);
});

test('each kind does what the plan says', () => {
  const crime = result(closeWith('crime', { percent: -7, stage: 1 }));
  assert.equal(crime.percent, -7);
  assert.equal(crime.exposure, 5);
  assert.equal(crime.regCase, true, 'rank 6 on a registered business');
  assert.equal(result(closeWith('crime', { rank: 4, stage: 1 })).regCase, false, 'a corporation\'s own press opens no case');
  assert.equal(result(closeWith('crime', { stage: 0 })).regCase, false, 'nor on one not registered');
  assert.equal(result(closeWith('crime', { band: 'failure', stage: 1 })).regCase, false, 'nor a story half answered');
  assert.equal(result(closeWith('crime', { percent: -7, band: 'failure' })).percent, -3.5);
  assert.equal(result(closeWith('money', { percent: -4 })).percent, -4);
  assert.equal(result(closeWith('service', { percent: -4 })).percent, 0, 'bad service moves no price');
  assert.equal(result(closeWith('smear', { percent: -4 })).percent, -2, 'a smear moves it a fixed amount');
});

test('the story is answered like any event, and takes no takings', () => {
  assert.ok(EVENTS.press.uses.length > 0);
  assert.equal(EVENTS.press.weight, 0, 'never drawn at random');
  const out = closeWith('service');
  assert.equal(out.business.digests.at(-1).event.kind, 'press');
  assert.equal(out.business.digests.at(-1).event.change, 0);
});

test('its wording exists for every kind', () => {
  const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8')).NCI;
  for (const story of Object.keys(P.press.kinds)) {
    for (const group of ['Story', 'Angle', 'Headline', 'Why']) assert.ok(lang.Press[group][story], `${group}.${story}`);
  }
  for (const m of ['Subject', 'Ignored', 'Answered', 'Halved', 'Full']) assert.ok(lang.Press.Mail[m], m);
  assert.ok(lang.Event.press.Name);
  assert.ok(lang.Pending.Need.press);
  assert.ok(lang.Pending.Kind.press);
});
