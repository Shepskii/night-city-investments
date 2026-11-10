import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peopleMail, personalityOf, moodOf, VOICE_PERSONALITIES, CORP_STYLES, OUTLET_STYLES } from '../scripts/engine/index.js';
import { STAFF_FRAMES, STAFF_LINES } from '../scripts/data/people-voices/staff.js';
import { OWNER_FRAMES, OWNER_LINES, HR_VOICES } from '../scripts/data/people-voices/employers.js';

const first = () => 0;

test('a recruit keeps one Personality, and a sheet\'s Personality wins', () => {
  assert.equal(personalityOf('stf_r1'), personalityOf('stf_r1'));
  assert.ok(VOICE_PERSONALITIES.includes(personalityOf('stf_r1')));
  const seen = new Set(Array.from({ length: 60 }, (_, i) => personalityOf(`stf_${i}`)));
  assert.ok(seen.size >= 6, 'recruits come out varied');
  assert.equal(personalityOf('stf_r1', 'Shy and Secretive'), 'shy');
  assert.equal(personalityOf('stf_r1', 'nonsense'), personalityOf('stf_r1'), 'an unknown sheet entry falls back');
});

test('loyalty bands make three moods', () => {
  assert.deepEqual(['sullen', 'steady', 'loyal', 'devoted'].map(moodOf), ['sullen', 'content', 'devoted', 'devoted']);
});

test('a person\'s mail: their greeting, the line for their mood, figures kept, their sign-off', () => {
  const frames = { shy: { greetings: ['Um, hi.'], signoffs: ['- {staff}'] } };
  const lines = { sickDay: { sullen: ['Not coming in to {name}.'], lines: ['Sick.'] } };
  assert.deepEqual(peopleMail({ frames, lines, personality: 'shy', kind: 'sickDay', tone: 'sullen', data: { name: 'Shack', staff: 'Dex' }, after: ['Figure.'], rng: first }).paragraphs,
    ['Um, hi.', 'Not coming in to Shack.', 'Figure.', '- Dex']);
  assert.equal(peopleMail({ frames, lines, personality: 'shy', kind: 'sickDay', tone: 'devoted', rng: first }).paragraphs[1], 'Sick.', 'a mood with no lines uses the plain ones');
  assert.equal(peopleMail({ frames, lines, personality: 'shy', kind: 'nothing' }), null);
});

const tokensOf = (line) => [...String(line).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const bad = (label, pools, allowed) => Object.entries(pools).flatMap(([k, v]) => (Array.isArray(v) ? v : Object.values(v).flat())
  .flatMap((line) => tokensOf(line).filter((t) => !allowed.includes(t)).map((t) => `${label}.${k}: {${t}}`)));

test('every person\'s line names only facts its mail has', () => {
  const employer = { hired: ['name', 'post', 'wage'], turned: ['name', 'post'], warned: ['name'], sacked: ['name', 'paid'], promoted: ['name', 'wage'], payslip: ['name'] };
  const problems = [
    ...Object.entries(STAFF_FRAMES).flatMap(([p, f]) => bad(`staffFrame.${p}`, f, ['staff', 'name'])),
    ...bad('staff', STAFF_LINES, ['name', 'staff', 'other']),
    ...Object.entries(OWNER_FRAMES).flatMap(([p, f]) => bad(`ownerFrame.${p}`, f, ['name'])),
    ...Object.entries(OWNER_LINES).flatMap(([k, v]) => bad(`owner.${k}`, { [k]: v }, employer[k])),
    ...Object.entries(HR_VOICES).flatMap(([s, v]) => Object.entries(v).flatMap(([k, pools]) => bad(`hr.${s}.${k}`, { [k]: pools }, employer[k] ?? ['name']))),
  ];
  assert.deepEqual(problems, []);
});

test('everyone has their lines: every Personality a frame, every moment three moods, every corporate style an HR', () => {
  for (const p of VOICE_PERSONALITIES) {
    assert.ok(STAFF_FRAMES[p]?.greetings?.length && STAFF_FRAMES[p]?.signoffs?.length, `staff ${p}`);
    assert.ok(OWNER_FRAMES[p]?.greetings?.length && OWNER_FRAMES[p]?.signoffs?.length, `owner ${p}`);
  }
  for (const kind of ['sickDay', 'payDispute', 'poaching', 'accident', 'doubleBooked', 'fullTimeOffer', 'asks']) {
    for (const mood of ['devoted', 'content', 'sullen']) assert.ok(STAFF_LINES[kind]?.[mood]?.length >= 3, `${kind}.${mood}`);
  }
  for (const kind of ['quit', 'walked', 'unpaid', 'poached']) assert.ok(STAFF_LINES[kind]?.lines?.length >= 3, kind);
  for (const style of CORP_STYLES.filter((s) => !OUTLET_STYLES.includes(s))) {
    for (const kind of ['hired', 'turned', 'warned', 'sacked', 'promoted']) assert.ok(HR_VOICES[style]?.[kind]?.lines?.length >= 3, `${style}.${kind}`);
    for (const band of ['thinIce', 'shaky', 'reliable', 'trusted']) assert.ok(HR_VOICES[style].payslip[band]?.length, `${style}.payslip.${band}`);
  }
  for (const kind of ['hired', 'turned', 'warned', 'sacked', 'promoted']) assert.ok(OWNER_LINES[kind]?.lines?.length >= 3, `owner.${kind}`);
});
