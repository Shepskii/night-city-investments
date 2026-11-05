import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISTRICTS, DISTRICT_DANGER, cleanDistrictNumbers, districtIds, districtOf, isDistrict, mergeMapDistricts, normalizeFaction, setExtraDistricts,
} from '../scripts/engine/index.js';
import { DISTRICTS as MAP_DISTRICTS } from './fixtures/mapDistricts.mjs';

const custom = (id, ru, danger) => ({ id, ru, en: '', x: 0.5, y: 0.5, danger });

test('a new district gets numbers from its danger; ours and water are left out', () => {
  const { defs, changed } = mergeMapDistricts({}, [
    { id: 'watson', en: 'Watson Development', danger: 2 },
    { id: 'norcal', en: 'NorCal Military Base', danger: 3 },
    { id: 'delbay', en: 'Del Coronado Bay', danger: 0 },
    custom('cdport', 'Old Port', 4),
  ]);
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(defs).sort(), ['cdport', 'norcal']);
  assert.equal(defs.norcal.name, 'NorCal Military Base');
  assert.equal(defs.cdport.name, 'Old Port', "the map keeps a GM's name in `ru`");
  assert.equal(defs.cdport.risk, DISTRICT_DANGER[4].risk);
  assert.equal(mergeMapDistricts(defs, [custom('cdport', 'Old Port', 4)]).changed, false, 'and nothing new writes nothing');
});

test('the danger table is the average of our own districts at that danger', () => {
  const known = MAP_DISTRICTS.filter((d) => DISTRICTS[d.id]);
  for (const danger of [1, 2, 3, 4, 5]) {
    const here = known.filter((d) => d.danger === danger).map((d) => DISTRICTS[d.id]);
    assert.ok(here.length, `danger ${danger}`);
    for (const key of ['traffic', 'rent', 'risk']) {
      const mean = here.reduce((a, d) => a + d[key], 0) / here.length;
      assert.ok(Math.abs(DISTRICT_DANGER[danger][key] - mean) <= 0.06, `danger ${danger} ${key}: ${DISTRICT_DANGER[danger][key]} against ${mean}`);
    }
  }
});

test('renames and new danger follow the map, a district it lost stays, and the GM\'s numbers are kept', () => {
  const first = mergeMapDistricts({}, [custom('cdport', 'Old Port', 4), custom('cdgone', 'Gone Quarter', 2)]).defs;
  const renamed = mergeMapDistricts(first, [custom('cdport', 'New Port', 2)]);
  assert.equal(renamed.defs.cdport.name, 'New Port');
  assert.equal(renamed.defs.cdport.risk, DISTRICT_DANGER[2].risk);
  assert.equal(renamed.defs.cdgone.name, 'Gone Quarter', 'kept, though the map lost it');

  const edited = { ...first, cdport: { ...first.cdport, ...cleanDistrictNumbers({ traffic: 1.4, rent: 0.7, risk: 0.5 }), edited: true } };
  const after = mergeMapDistricts(edited, [custom('cdport', 'New Port', 5)]);
  assert.equal(after.defs.cdport.name, 'New Port', 'the name still follows');
  assert.deepEqual([after.defs.cdport.traffic, after.defs.cdport.rent, after.defs.cdport.risk], [1.4, 0.7, 0.5], 'the numbers do not');
});

test('numbers the GM types are held within reason', () => {
  assert.deepEqual(cleanDistrictNumbers({ traffic: 9, rent: -1, risk: 'x' }), { traffic: 2, rent: 0.2, risk: 1 });
});

test('a remembered district works as ours do, for businesses and factions', () => {
  const defs = mergeMapDistricts({}, [custom('cdport', 'Old Port', 5)]).defs;
  try {
    assert.equal(isDistrict('cdport'), false, 'unknown until the setting is read');
    assert.equal(normalizeFaction({ id: 'f', name: 'F', kind: 'gang', districts: ['cdport', 'watson'] }).districts.join(), 'watson');
    setExtraDistricts(defs);
    assert.ok(isDistrict('cdport'));
    assert.ok(districtIds().includes('cdport'));
    assert.equal(districtOf('cdport').traffic, DISTRICT_DANGER[5].traffic);
    assert.equal(normalizeFaction({ id: 'f', name: 'F', kind: 'gang', districts: ['cdport', 'watson'] }).districts.join(), 'cdport,watson');
    assert.equal(isDistrict('constructor'), false, 'and nothing inherited counts');
    setExtraDistricts({ watson: { traffic: 9 } });
    assert.equal(districtOf('watson').traffic, DISTRICTS.watson.traffic, 'ours cannot be replaced');
  } finally {
    setExtraDistricts({});
  }
  assert.equal(districtOf('cdport').traffic, 1, 'gone, it reads as no district at all');
});
