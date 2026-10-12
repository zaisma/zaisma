import { defineGameServer } from "./room.ts";

/** The built-in game server for games without server code: passes each message to everyone else. */
export const relay = defineGameServer({
  maxPlayers: 16,
  setup: () => ({}),
  onMessage(_state, player, msg, room) {
    room.broadcast({ from: player.id, data: msg }, { except: player.id });
  },
});
