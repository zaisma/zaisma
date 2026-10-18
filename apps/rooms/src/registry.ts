import { defineGameServer, relay, type GameServer } from "@zaisma/game-server";
import arena from "../../../examples/arena/server.ts";
import { SANDBOX } from "./sandbox.ts";
import fourInARow from "../../../examples/four-in-a-row/server.ts";

/**
 * Built-in game servers, by the name set on a game in admin. While only Zaisma
 * uploads games, game servers are trusted code built into this Worker. A game set to "sandbox"
 * runs its own game server in a Dynamic Worker instead (sandbox.ts).
 */
export const GAME_SERVERS: Record<string, GameServer> = {
  relay,
  arena: defineGameServer(arena),
  "four-in-a-row": defineGameServer(fourInARow),
};

/** Whether a game's rooms run on Zaisma: a built-in game server, or the game's own in a sandbox. */
export function usesRooms(name: string | null): boolean {
  return name === SANDBOX || gameServer(name) !== null;
}

export function gameServer(name: string | null): GameServer | null {
  return name && Object.hasOwn(GAME_SERVERS, name) ? GAME_SERVERS[name]! : null;
}
