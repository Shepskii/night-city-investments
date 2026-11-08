import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [['Client', 1000, true], ['Broker Bob', 0, false]] });
const [client, bob] = env.actors;
const gm = { id: 'gm1', isGM: true };
game.user = gm;
game.users = Object.assign([gm], { activeGM: gm, get: () => gm });

const contacts = [
  { id: 'c_main', name: 'Main', tags: ['broker'], actorId: null },
  { id: 'c_alias', name: 'Alias', tags: [], actorId: null, identityOf: 'c_main' },
  { id: 'c_bob', name: 'Bob', tags: ['BROKER'], actorId: bob.id },
  { id: 'c_bob2', name: 'Bob at work', tags: [], actorId: bob.id },
  { id: 'c_other', name: 'Other', tags: [], actorId: null },
  { id: 'c_taggedAlias', name: 'Tagged', tags: ['broker'], actorId: null, identityOf: 'c_other' },
];
game.nightcity = { masterContactService: {
  getAll: () => contacts, getContact: (id) => contacts.find((c) => c.id === id) ?? null,
  getByActorId: (id) => contacts.find((c) => c.actorId === id) ?? null,
} };

let NcmAdapter;
let BrokerRepository;
let BrokerService;
before(async () => {
  ({ NcmAdapter } = await import('../scripts/integrations/NcmAdapter.js'));
  ({ BrokerRepository } = await import('../scripts/data/BrokerRepository.js'));
  ({ BrokerService } = await import('../scripts/services/BrokerService.js'));
});

test('simple network mode counts as connected and signed in, and a real network still asks', () => {
  game.nightcity.networkService = { simple: true, isOnNetwork: () => false, getNetwork: () => ({ requiresAuth: true }), isAuthenticated: () => false };
  assert.deepEqual(NcmAdapter.networkState('CORPNET'), { known: true, on: true, authenticated: true, requiresAuth: false });
  game.nightcity.networkService.simple = false;
  assert.deepEqual(NcmAdapter.networkState('CORPNET'), { known: true, on: false, authenticated: false, requiresAuth: true });
  delete game.nightcity.networkService;
  assert.equal(NcmAdapter.networkState('CORPNET').known, false, 'and no Messenger network service is still unknown');
});

test('a mail finds its broker by any of that person\'s addresses, and no one else', () => {
  const id = (to) => BrokerRepository.brokerFor(to)?.id ?? null;
  assert.equal(id({ toContactId: 'c_main' }), 'c_main');
  assert.equal(id({ toContactId: 'c_alias' }), 'c_main', 'an alias of a contact-only broker');
  assert.equal(id({ toContactId: 'c_bob2', toActorId: bob.id }), 'c_bob', 'another contact linked to a broker\'s character');
  assert.equal(id({ toActorId: bob.id }), 'c_bob', 'the character alone');
  assert.equal(id({ toContactId: 'c_taggedAlias' }), 'c_taggedAlias', 'the address written to comes first');
  assert.equal(id({ toContactId: 'c_other' }), 'c_taggedAlias', 'a main contact whose alias is the broker');
  assert.equal(id({ toContactId: 'nobody' }), null);
  assert.equal(id({}), null);
});

test('an order mailed to an alias is read from the inbox it landed in, and handled as the broker\'s', async () => {
  const handled = [];
  const handle = BrokerService.handle;
  BrokerService.handle = async (actor, contactId, text, messageId) => { handled.push([actor.id, contactId, text, messageId]); return 'applied'; };
  game.nightcity.messageRepository = { getMessage: async (inbox, id) => (inbox === 'c_main' && id === 'm1' ? { subject: 'Order', body: '<p>buy 5 ARA</p>' } : null) };
  try {
    await BrokerService.onMessageSent({ messageId: 'm1', toContactId: 'c_alias', fromActorId: client.id, subject: 'Order' });
    assert.equal(handled.length, 1);
    assert.deepEqual(handled[0].slice(0, 2), [client.id, 'c_main']);
    assert.match(handled[0][2], /buy 5 ARA/, 'with the body, not just the subject');
    await BrokerService.onMessageSent({ messageId: 'm2', toContactId: 'nobody', fromActorId: client.id, subject: 'Hi' });
    assert.equal(handled.length, 1, 'a mail to anyone else is left alone');
  } finally {
    BrokerService.handle = handle;
    delete game.nightcity.messageRepository;
  }
});
