/**
 * Fake Foundry items for tests that drag gear into a business: `fromUuid`, items on a character's
 * sheet (with `items.get` and the embedded create and delete calls), and items in the library.
 * Call after the fake `game` and its actors exist.
 */
export function installFakeItems() {
  const registry = new Map();
  let n = 0;
  globalThis.fromUuid = async (uuid) => registry.get(uuid) ?? null;

  const make = (data, parent = null) => {
    const id = data._id ?? `item${++n}`;
    const item = {
      ...structuredClone({ ...data, _id: undefined }),
      id,
      uuid: parent ? `Actor.${parent.id}.Item.${id}` : `Item.${id}`,
      documentName: 'Item',
      parent,
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
      async setFlag(scope, key, value) { (this.flags ??= {})[scope] = { ...this.flags[scope], [key]: value }; },
      toObject() {
        const { id: _i, uuid: _u, documentName: _d, parent: _p, toObject: _t, getFlag: _g, setFlag: _s, ...rest } = this;
        return structuredClone({ ...rest, _id: this.id });
      },
    };
    registry.set(item.uuid, item);
    return item;
  };

  /** Give the actor sheet-item support, once. */
  const prepare = (actor) => {
    if (actor._fakeItems) return;
    actor._fakeItems = true;
    actor.documentName = 'Actor';
    actor.items = Object.assign(actor.items ?? [], { get: (id) => actor.items.find((i) => i.id === id) });
    actor.deleteEmbeddedDocuments = async (type, ids) => {
      for (const id of ids) {
        const at = actor.items.findIndex((i) => i.id === id);
        if (at >= 0) registry.delete(actor.items.splice(at, 1)[0].uuid);
      }
    };
    actor.createEmbeddedDocuments = async (type, list) => list.map((data) => {
      const item = make(data, actor);
      actor.items.push(item);
      return item;
    });
  };

  return {
    /** Put an item on an actor's sheet and return it. */
    give(actor, data) {
      prepare(actor);
      const item = make(data, actor);
      actor.items.push(item);
      return item;
    },
    /** An item in the Items directory. */
    library: (data) => make(data),
    prepare,
  };
}
