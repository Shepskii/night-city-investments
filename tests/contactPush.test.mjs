import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { parseOrderText } from '../scripts/engine/orderParser.js';

const env = installFakeFoundry({ actors: [['Client', 1000, true]] });
const [client] = env.actors;
const pushed = [];
const composed = [];
let answer = { ok: true, data: {} };
const api = { v2: {
  directory: { pushToPlayer: async (c, a) => { pushed.push([c, a]); return answer; } },
  open: { composer: async (o) => { composed.push(o); return { ok: true, data: true }; } },
} };
const realGet = game.modules.get;
game.modules.get = (id) => (id === 'night-city-messenger' ? { active: true, api } : realGet(id));

let NcmAdapter;
let BusinessService;
const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8')).NCI.Access;
const { MODULE_ID, SETTINGS } = await import('../scripts/utils/constants.js');
before(async () => {
  ({ NcmAdapter } = await import('../scripts/integrations/NcmAdapter.js'));
  ({ BusinessService } = await import('../scripts/services/BusinessService.js'));
});

test('a contact is pushed through Messenger\'s API, and the world can turn that off', async () => {
  pushed.length = 0;
  assert.equal(await NcmAdapter.pushContact('c1', client.id), true);
  assert.deepEqual(pushed, [['c1', client.id]]);
  assert.equal(await NcmAdapter.pushContact('c1', 'not-an-actor'), false, 'a syndicate has no contact list');
  assert.equal(await NcmAdapter.pushContact('', client.id), false);
  await game.settings.set(MODULE_ID, SETTINGS.SHARE_CONTACTS, false);
  assert.equal(await NcmAdapter.pushContact('c2', client.id), false);
  await game.settings.set(MODULE_ID, SETTINGS.SHARE_CONTACTS, true);
  assert.equal(pushed.length, 1);
  answer = { ok: false, error: 'nope' };
  assert.equal(await NcmAdapter.pushContact('c3', client.id), false, 'a refusal is not a failure of what asked');
  answer = { ok: true, data: {} };
});

test('without Messenger\'s API it does nothing', async () => {
  const saved = api.v2;
  delete api.v2;
  try {
    assert.equal(await NcmAdapter.pushContact('c1', client.id), false);
    assert.equal(NcmAdapter.canCompose(), false);
    assert.equal(await NcmAdapter.compose({ fromActorId: client.id, contact: { id: 'c' } }), false);
  } finally {
    api.v2 = saved;
  }
});

test('everyone who has joined gets the business\'s NPC partners, by actor or by contact alone', async () => {
  game.nightcity = { masterContactService: { getByActorId: (id) => (id === 'npc_actor' ? { id: 'c_linked' } : null) } };
  pushed.length = 0;
  await BusinessService._shareNpcPartners({ partners: [
    { actorId: client.id, status: 'active' },
    { actorId: 'syn_x', status: 'active' },
    { actorId: 'someone_invited', status: 'invited' },
    { actorId: 'npc:npc_actor', actorRef: 'npc_actor', npc: true, status: 'active' },
    { actorId: 'npc:contact:c_only', npc: true, status: 'active' },
    { actorId: 'npc:contact:c_no', npc: true, status: 'declined' },
    { actorId: 'npc:staff1', npc: true, status: 'active' },
  ] });
  assert.deepEqual(pushed, [['c_linked', client.id], ['c_only', client.id]]);
});

test('the pre-filled broker mail has nothing in it the parser would act on', () => {
  const body = lang.WriteBrokerBody.split('\n').map((l) => `<p>${l}</p>`).join('');
  assert.equal(parseOrderText(`${lang.WriteBrokerSubject}\n${body}`).ok, false);
  for (const line of lang.WriteBrokerBody.split('\n')) assert.equal(parseOrderText(line).ok, false, line);
  assert.equal(parseOrderText(`${lang.WriteBrokerSubject}\nBUY 10 ARA\n${body}`).cmd, parseOrderText('BUY 10 ARA').cmd, 'and an order written above it still reads');
});

test('the composer gets a broker with no actor by contact and address', async () => {
  composed.length = 0;
  assert.equal(await NcmAdapter.compose({ fromActorId: client.id, contact: { id: 'c9', name: 'Bob', email: 'b@x' }, subject: 'S', body: 'B' }), true);
  assert.deepEqual(composed[0].recipients, [{ actorId: null, contactId: 'c9', email: 'b@x', name: 'Bob' }]);
  assert.equal(composed[0].fromActorId, client.id);
});
