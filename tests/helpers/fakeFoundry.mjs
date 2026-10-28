/**
 * A minimal fake Foundry runtime for integration tests: journals, actors, hooks, settings, clock.
 * Install it BEFORE importing any module code that touches Foundry globals.
 */

function merge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = merge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
    else target[k] = v;
  }
  return target;
}

export function installFakeFoundry({ actors: actorSpecs = [], now = Date.UTC(2045, 2, 15, 12) } = {}) {
  const store = new Map();
  const handlers = new Map();
  const notices = [];
  const hooksFired = [];
  const clock = { ms: now };

  const callAll = (name, ...args) => {
    hooksFired.push({ name, args });
    for (const fn of handlers.get(name) ?? []) fn(...args);
  };

  class FakeDoc {
    constructor(data) {
      this.name = data.name;
      this.ownership = data.ownership ?? { default: 0 };
      this.flags = structuredClone(data.flags ?? {});
      this.pages = { contents: (data.pages ?? []).map((p) => ({ ...structuredClone(p), update: async function (d) { this.text.content = d['text.content']; } })) };
    }
    getFlag(scope, key) { return this.flags[scope]?.[key]; }
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = value && typeof value === 'object' && !Array.isArray(value)
        ? merge(this.flags[scope][key] ?? {}, structuredClone(value))
        : structuredClone(value);
      this._changed({ flags: { [scope]: { [key]: value } } });
    }
    async unsetFlag(scope, key) { delete this.flags[scope]?.[key]; }
    async update(d) { Object.assign(this, d); }
    testUserPermission() { return true; }
    get isOwner() { return true; }
    _changed() {}
  }

  class FakeJournal extends FakeDoc {
    constructor(data) { super(data); this.id = `j${FakeJournal.n++}`; }
    async delete() { game.journal.splice(game.journal.indexOf(this), 1); }
  }
  FakeJournal.n = 1;

  class FakeActor extends FakeDoc {
    constructor(name, wealth, hasPlayerOwner = true) {
      super({ name });
      this.id = `a_${name}`;
      this.type = 'character';
      this.system = { wealth: { value: wealth, transactions: [] } };
      this.hasPlayerOwner = hasPlayerOwner;
    }
    async update(d) { if (d['system.wealth']) this.system.wealth = structuredClone(d['system.wealth']); }
    _changed(changes) { callAll('updateActor', this, changes); }
  }

  const actors = actorSpecs.map(([name, wealth, owned]) => new FakeActor(name, wealth, owned));

  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2 } };
  globalThis.Hooks = { callAll, on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  globalThis.ui = { notifications: { warn: (m) => notices.push(['warn', m]), info: (m) => notices.push(['info', m]) } };
  globalThis.Folder = { create: async (d) => ({ id: 'f1', ...d }) };
  globalThis.JournalEntry = { create: async (d) => { const j = new FakeJournal(d); game.journal.push(j); return j; } };
  globalThis.foundry = {
    utils: {
      deepClone: (v) => structuredClone(v),
      randomID: () => Math.random().toString(36).slice(2, 18),
      hasProperty: (obj, path) => path.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), obj) !== undefined,
    },
  };
  globalThis.game = {
    user: { id: 'gm1', isGM: true, character: null },
    users: { activeGM: { id: 'gm1' } },
    journal: [],
    folders: [],
    actors: Object.assign([...actors], { get: (id) => actors.find((a) => a.id === id) }),
    time: { worldTime: 0 },
    i18n: { localize: (k) => k, format: (k, d) => (d ? `${k} ${JSON.stringify(d)}` : k) },
    modules: { get: () => ({ api: { time: { getCurrentTimeMs: () => clock.ms } } }) },
    settings: {
      get: (mod, key) => (store.has(key) ? store.get(key) : { tickMode: 'worldTime', worldSeed: '', depositFee: 0, directOrderExecution: 'nextTick', directCommissionBps: 0, directTradingMode: 'open' }[key]),
      set: async (mod, key, value) => { store.set(key, structuredClone(value)); },
    },
  };

  return { store, handlers, notices, hooksFired, clock, actors, callAll };
}
