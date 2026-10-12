import { relay, type GameServer } from "@zaisma/game-server";

/**
 * Built-in game servers, by the name set on a game in admin. While only Zaisma
 * uploads games, game servers are trusted code built into this Worker. When outside
 * developers upload, this becomes "load the game's server into a Dynamic Worker".
 */
export const GAME_SERVERS: Record<string, GameServer> = {
  relay,
};

export function gameServer(name: string | null): GameServer | null {
  return name && Object.hasOwn(GAME_SERVERS, name) ? GAME_SERVERS[name]! : null;
}
