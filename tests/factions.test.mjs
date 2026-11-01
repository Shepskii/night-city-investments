import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_DEFAULTS, DISTRICTS, normalizeFaction, standingBand, matchFaction, turfFactions, gigStanding, moveStanding, driftStanding, standingBands, matchBusiness,
  findTarget, targetShare, gigTags, resolveClient,
} from '../scripts/engine/index.js';
import { starterFactions } from '../scripts/data/starter-factions.js';
import { STARTER_COMPANIES } from '../scripts/data/starter-companies.js';

const S = BUSINESS_DEFAULTS.standing;

test('a faction keeps only real districts and a known kind', () => {
  const f = normalizeFaction({ id: 'x', name: '  Tyger   Claws ', kind: 'nonsense', ticker: 'abc', districts: ['watson', 'atlantis', 'watson'] });
  assert.deepEqual([f.name, f.kind, f.ticker, f.districts], ['Tyger Claws', 'other', 'ABC', ['watson']]);
});

test('the bands: hostile, wary, neutral, friendly, allied', () => {
  assert.deepEqual([-61, -60, -21, -20, 0, 19, 20, 59, 60, 100].map((v) => standingBand(v)), ['hostile', 'wary', 'wary', 'neutral', 'neutral', 'neutral', 'friendly', 'friendly', 'allied', 'allied']);
});

test('a gig\'s client names a faction by name, alias or ticker; a district names its gangs', () => {
  const factions = [{ id: 'a', name: 'Biotechnica', ticker: 'BIO', aliases: ['Biotechnica Corp'], districts: [] }, { id: 'b', name: 'Maelstrom', ticker: '', aliases: [], districts: ['ocz'] }];
  assert.equal(matchFaction('biotechnica corp', factions).id, 'a');
  assert.equal(matchFaction('BIO', factions).id, 'a');
  assert.equal(matchFaction('Mr Johnson', factions), null);
  assert.equal(matchFaction('', factions), null);
  assert.deepEqual(turfFactions(factions, 'ocz').map((f) => f.id), ['b']);
  assert.deepEqual(turfFactions(factions, ''), []);
});

test('standing moves by the gig, fades, and cannot be farmed: repeats count less, and a week holds at most the cap', () => {
  assert.equal(gigStanding({ outcome: 'done', reward: 1000 }), S.gig.done);
  assert.equal(gigStanding({ outcome: 'failed', reward: 1000 }), S.gig.failed);
  assert.equal(gigStanding({ outcome: 'done', reward: 100000 }), S.gig.done * S.gig.size[1], 'a big job has a limit');

  const first = moveStanding(null, 10, 100);
  assert.deepEqual([first.applied, first.entry.value], [10, 10]);
  const second = moveStanding(first.entry, 10, 101);
  assert.equal(second.applied, 5, 'a second favour soon after counts half');
  const capped = moveStanding({ value: 0, weekStart: 100, moved: 14, recent: [] }, 10, 101);
  assert.equal(capped.applied, S.weeklyCap - 14, 'the week\'s cap');
  const nextWeek = moveStanding({ value: 14, weekStart: 100, moved: 14, recent: [] }, 10, 107);
  assert.equal(nextWeek.applied, 10, 'a new week');
  assert.equal(moveStanding({ value: 99, weekStart: 0, moved: 0, recent: [] }, 10, 100).entry.value, 100, 'never past 100');

  assert.equal(driftStanding({ value: 10 }).value, 10 - S.drift);
  assert.equal(driftStanding({ value: -10 }).value, -10 + S.drift);
  assert.equal(driftStanding({ value: 1 }).value, 0, 'not past 0');
  assert.deepEqual(standingBands({ a: { value: 30 }, b: { value: -70 } }), { a: 'friendly', b: 'hostile' });
});

test('the starter list: unique ids, real districts, every corporation linked to a starter company', () => {
  const list = starterFactions();
  assert.equal(new Set(list.map((f) => f.id)).size, list.length);
  assert.equal(list.filter((f) => f.kind === 'corp').length, STARTER_COMPANIES.length);
  for (const f of list.filter((x) => x.kind === 'gang')) {
    assert.ok(f.districts.length > 0, f.name);
    for (const d of f.districts) assert.ok(DISTRICTS[d], `${f.name}: ${d}`);
  }
});

test('a tag names a business by its id, name or ticker; a tag on nothing else matches it', () => {
  const businesses = [{ id: 'bus_x', name: 'Charter Test Clinic', status: 'open', company: { ticker: 'SCX' } }, { id: 'bus_y', name: 'Closed Shop', status: 'closed' }];
  for (const notes of ['[NCI: bus_x]', '[NCI: Charter Test Clinic]', '[nci: charter test clinic]', '[NCI: SCX]']) {
    assert.deepEqual(matchBusiness({ notes }, businesses), { businessId: 'bus_x', how: 'tag' }, notes);
  }
  assert.equal(matchBusiness({ notes: '[NCI: ARA]' }, businesses), null, 'a market company is not a business');
  assert.equal(matchBusiness({ notes: '[NCI: Closed Shop]' }, businesses), null);
});

test('a gig\'s target: the GM\'s tag first, then the one faction its text names, never its client', () => {
  const factions = [
    { id: 'mil', name: 'Militech', ticker: 'MIL', aliases: [], districts: [] }, { id: 'bio', name: 'Biotechnica', ticker: 'BIO', aliases: [], districts: [] },
    { id: 'mael', name: 'Maelstrom', ticker: '', aliases: [], districts: [] },
  ];
  const companies = [{ name: 'Orbital Air', ticker: 'ORB' }];
  assert.deepEqual(findTarget({ client: 'Biotechnica', notes: '[NCI target: Militech]' }, factions, companies), { name: 'Militech', factionId: 'mil', ticker: 'MIL', how: 'tag' });
  assert.deepEqual(findTarget({ notes: '[nci target: ORB]' }, factions, companies), { name: 'Orbital Air', factionId: null, ticker: 'ORB', how: 'tag' }, 'a company with no faction');
  assert.equal(findTarget({ notes: '[NCI target: Nobody]' }, factions, companies), null);
  assert.equal(findTarget({ client: 'Militech', notes: '[NCI target: Militech]' }, factions, companies), null, 'not its own client');
  assert.deepEqual(findTarget({ client: 'Biotechnica', desc: 'Hit the Maelstrom crew at the docks.' }, factions), { name: 'Maelstrom', factionId: 'mael', ticker: '', how: 'text' });
  assert.equal(findTarget({ client: 'Biotechnica', desc: 'A Biotechnica courier run.' }, factions), null, 'its own client, mentioned');
  assert.equal(findTarget({ desc: 'Militech and Maelstrom are fighting.' }, factions), null, 'two named: not sure which');
  assert.deepEqual([targetShare('done'), targetShare('failed')], [S.target.done, S.target.failed]);
});

test('the GM\'s tags: client, target and contract, with spaces, in any order; a client tag overrides the client field', () => {
  assert.deepEqual(gigTags('Notes. [NCI target: Night Corp] more [nci contract: Charter Test Clinic] [NCI client: Kiroshi Optical]'), { client: 'Kiroshi Optical', target: 'Night Corp', contract: 'Charter Test Clinic' });
  assert.deepEqual(gigTags('[NCI: ARA]'), { client: '', target: '', contract: '' }, 'the older tag is not these');
  assert.deepEqual(gigTags(undefined), { client: '', target: '', contract: '' });

  const companies = [{ id: 'KIR', ticker: 'KIR', name: 'Kiroshi Optical', aliases: ['Kiroshi'] }, { id: 'ARA', ticker: 'ARA', name: 'Arasaka', aliases: [] }];
  for (const name of ['Kiroshi Optical', 'kiroshi', 'KIR']) {
    const out = resolveClient({ client: 'Arasaka', notes: `[NCI client: ${name}]` }, companies);
    assert.deepEqual([out.status, out.companyId, out.how], ['matched', 'KIR', 'tag'], name);
  }
  assert.equal(resolveClient({ client: 'Mr Johnson', notes: '[NCI client: Nobody Inc]' }, companies).status, 'unmatched', 'a tag naming nobody');
  assert.equal(resolveClient({ client: 'Arasaka', notes: '[NCI: KIR]' }, companies).companyId, 'KIR', 'the older tag still works');

  const businesses = [{ id: 'bus_x', name: 'Charter Test Clinic', status: 'open', company: { ticker: 'SCX' } }];
  assert.deepEqual(matchBusiness({ notes: '[NCI contract: Charter Test Clinic]' }, businesses), { businessId: 'bus_x', how: 'tag' });
  assert.deepEqual(matchBusiness({ notes: '[NCI contract: SCX]' }, businesses), { businessId: 'bus_x', how: 'tag' });
  assert.deepEqual(matchBusiness({ client: 'Someone', notes: '[NCI client: Charter Test Clinic]' }, businesses), { businessId: 'bus_x', how: 'exact' }, 'a business as the client: its own gig');
  assert.equal(matchBusiness({ notes: '[NCI client: Biotechnica]' }, businesses), null);
  const factions = [{ id: 'bio', name: 'Biotechnica', ticker: 'BIO', aliases: [], districts: [] }];
  assert.equal(findTarget({ client: 'Mr Johnson', desc: 'A Biotechnica job', notes: '[NCI client: Biotechnica]' }, factions), null, 'the tagged client is not its own target');
});
