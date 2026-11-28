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

/** foundry.utils.isNewerVersion as Foundry has it (v12 and v13): whether v1 is strictly newer than v0, part by part. */
function isNewerVersion(v1, v0) {
  if (typeof v1 === 'number' && typeof v0 === 'number') return v1 > v0;
  const isNumeric = (p) => p !== '' && Number.isFinite(Number(p));
  const v1Parts = String(v1).split('.');
  const v0Parts = String(v0).split('.');
  for (const [i, p1] of v1Parts.entries()) {
    const p0 = v0Parts[i];
    if (p0 === undefined) return true;
    if (isNumeric(p0) && isNumeric(p1)) {
      if (p1 !== p0) return Number(p1) > Number(p0);
    }
    if (p1 !== p0) return p1 > p0;
  }
  if (v0Parts.length > v1Parts.length) return false;
  return v1Parts.join('.') !== v0Parts.join('.');
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
    async update(d) {
      // Foundry merges a flags update into the flags already there (arrays are replaced).
      const { flags, ...rest } = d;
      Object.assign(this, rest);
      if (flags) {
        merge(this.flags, structuredClone(flags));
        this._changed({ flags });
      }
    }
    testUserPermission() { return true; }
    get isOwner() { return true; }
    _changed() {}
  }

  // As in Foundry, every write to a journal calls its hook, with the change, once the journal holds it.
  class FakeJournal extends FakeDoc {
    constructor(data) { super(data); this.id = `j${FakeJournal.n++}`; }
    async update(d) {
      const { flags, ...rest } = d;
      Object.assign(this, rest);
      if (flags) merge(this.flags, structuredClone(flags));
      callAll('updateJournalEntry', this, structuredClone(d), {}, game.user?.id);
    }
    async unsetFlag(scope, key) {
      delete this.flags[scope]?.[key];
      callAll('updateJournalEntry', this, { flags: { [scope]: { [`-=${key}`]: null } } }, {}, game.user?.id);
    }
    _changed(changes) { callAll('updateJournalEntry', this, structuredClone(changes), {}, game.user?.id); }
    async delete() {
      game.journal.splice(game.journal.indexOf(this), 1);
      callAll('deleteJournalEntry', this, {}, game.user?.id);
    }
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
    async update(d) {
      if (d['system.wealth']) this.system.wealth = structuredClone(d['system.wealth']);
      if (d['system.reputation']) this.system.reputation = structuredClone(d['system.reputation']);
      if (d['system.improvementPoints']) this.system.improvementPoints = structuredClone(d['system.improvementPoints']);
      if (d['system.stats.luck.value'] != null && this.system.stats?.luck) this.system.stats.luck.value = d['system.stats.luck.value'];
    }
    _changed(changes) { callAll('updateActor', this, changes); }
  }

  const actors = actorSpecs.map(([name, wealth, owned]) => new FakeActor(name, wealth, owned));

  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2 } };
  globalThis.Hooks = {
    callAll,
    on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    off: (name, fn) => handlers.set(name, (handlers.get(name) ?? []).filter((h) => h !== fn)),
  };
  globalThis.ui = { notifications: { warn: (m) => notices.push(['warn', m]), info: (m) => notices.push(['info', m]) } };
  globalThis.Folder = { create: async (d) => ({ id: 'f1', ...d }) };
  globalThis.JournalEntry = {
    create: async (d) => {
      const j = new FakeJournal(d);
      game.journal.push(j);
      callAll('createJournalEntry', j, {}, game.user?.id);
      return j;
    },
  };
  globalThis.foundry = {
    utils: {
      deepClone: (v) => structuredClone(v),
      randomID: () => Math.random().toString(36).slice(2, 18),
      hasProperty: (obj, path) => path.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), obj) !== undefined,
      isNewerVersion,
    },
  };
  globalThis.game = {
    user: { id: 'gm1', isGM: true, character: null },
    users: { activeGM: { id: 'gm1' } },
    journal: [],
    folders: [],
    actors: Object.assign([...actors], { get: (id) => actors.find((a) => a.id === id) }),
    time: { worldTime: 0, advance: async function (seconds) { this.worldTime += seconds; clock.ms += seconds * 1000; } },
    i18n: { localize: (k) => k, format: (k, d) => (d ? `${k} ${JSON.stringify(d)}` : k) },
    modules: { get: () => ({ api: { time: { getCurrentTimeMs: () => clock.ms } } }) },
    settings: {
      get: (mod, key) => (store.has(key) ? store.get(key) : { tickMode: 'worldTime', worldSeed: '', depositFee: 0, directOrderExecution: 'nextTick', directCommissionBps: 0, directTradingMode: 'open' }[key]),
      set: async (mod, key, value) => { store.set(key, structuredClone(value)); },
    },
  };

  return { store, handlers, notices, hooksFired, clock, actors, callAll };
}
