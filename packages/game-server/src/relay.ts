import { defineGameServer } from "./room.ts";

/**
 * The built-in game server for games without server code: passes each message to everyone else.
 * With no server code to decide, the room's first player may hide, show, open and close it, and
 * each player's game sets its own idle check (joinRoom({ idle })).
 */
export const relay = defineGameServer({
  maxPlayers: 16,
  hostControls: true,
  idleAfter: "client",
  setup: () => ({}),
  onMessage(_state, player, msg, room) {
    room.broadcast({ from: player.id, data: msg }, { except: player.id });
  },
});
