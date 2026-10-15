import { defineGameServer } from "./room.ts";

/**
 * The built-in game server for games without server code: passes each message to everyone else, as
 * { fromPlayerId, data }. With no server code to decide, the room's first player may hide, show, open
 * and close it, and each player's game sets its own idle check (joinRoom({ idleTimeoutSec, idleCheckEnabled })).
 */
export const relay = defineGameServer({
  maximumPlayerCount: 16,
  hostControlsEnabled: true,
  idleCheck: "client",
  setup: () => ({}),
  onMessage(state, player, message, room) {
    room.broadcast({ fromPlayerId: player.id, data: message }, { exceptPlayerId: player.id });
  },
});
