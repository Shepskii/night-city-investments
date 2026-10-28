/**
 * A fake chat log for tests that roll skill checks. Posting a card stores a message the GM side can
 * look up by id (`game.messages.get`), the way Foundry does, so a player roll can be verified.
 * Call after the fake `game` exists.
 * @param {object[]} [chats] - receives the data of every card posted
 */
export function installFakeChat(chats = []) {
  const messages = new Map();
  let n = 1;
  globalThis.ChatMessage = {
    getSpeaker: () => ({}),
    create: async (data) => {
      chats.push(data);
      const message = {
        id: `chat${n++}`,
        content: data.content,
        author: { id: globalThis.game.user.id },
        timestamp: Date.now(),
        rolls: [],
        flags: structuredClone(data.flags ?? {}),
        getFlag(scope, key) { return this.flags[scope]?.[key]; },
        async setFlag(scope, key, value) {
          this.flags[scope] ??= {};
          this.flags[scope][key] = structuredClone(value);
        },
      };
      messages.set(message.id, message);
      return message;
    },
  };
  globalThis.game.messages = { get: (id) => messages.get(id) };
  return { messages, chats };
}
