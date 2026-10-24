import { defineGameServer } from "./room.ts";

/**
 * The built-in game server for games without server code: passes each message and bytes on to
 * everyone else as they were sent, with fromPlayerId saying whose they are. With no server code to decide, the
 * room's first player may hide, show, open and close it, and each player's game sets its own idle check
 * (joinRoom({ idleTimeoutSec, idleCheckEnabled })).
 */
export const relay = defineGameServer({
  // Not the rooms' 100: the relay sends every message to everyone, so a room's sends grow with the square of its players.
  maximumPlayerCount: 16,
  hostControlsEnabled: true,
  idleCheck: "client",
  setup: () => ({}),
  onMessage(state, player, message, room) {
    room.broadcast(message, { exceptPlayerId: player.id, fromPlayerId: player.id });
  },
  onBytes(state, player, bytes, room) {
    room.broadcastBytes(bytes, { exceptPlayerId: player.id, fromPlayerId: player.id });
  },
});
