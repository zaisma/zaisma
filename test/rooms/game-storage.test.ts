import { createExecutionContext, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { newId } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";
import { gameDatabaseObject, type GameDatabaseObject } from "../../apps/rooms/src/database.ts";
import { gameSecretsObject } from "../../apps/rooms/src/secrets.ts";
import type { GameServerObject } from "../../apps/rooms/src/game-server.ts";
import { GameStorageService } from "../../apps/rooms/src/game-storage.ts";

const e = env as unknown as Env;
const gameServerOf = (gameId: string) => e.GAME_SERVER_OBJECTS.get(e.GAME_SERVER_OBJECTS.idFromName(gameId));

describe("deleting a game's storage", () => {
  it("empties its database, secrets and game server object, and clears their alarms", async () => {
    const gameId = newId("game");
    const database = gameDatabaseObject(e, gameId);
    await database.query("CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER)", []);
    await database.query("INSERT INTO scores VALUES ('player_ana', 10)", []);
    await gameSecretsObject(e, gameId).setSecret("DISCORD_TOKEN", "abc", Date.now());
    await runInDurableObject(gameServerOf(gameId), async (object: GameServerObject, state) => {
      state.storage.kv.put("game_id", gameId);
      state.storage.kv.put("schedules", { versionId: "version_world" });
      await state.storage.setAlarm(Date.now() + 3600_000);
      void object;
    });

    const service = new GameStorageService(createExecutionContext(), e);
    expect(await service.deleteGameStorage(gameId)).toEqual({ failureMessage: null });

    const tables = await runInDurableObject(database, (object: GameDatabaseObject) => object.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'", []));
    expect(tables).toEqual({ queryResult: [] });
    expect(await gameSecretsObject(e, gameId).listSecrets()).toEqual([]);
    await runInDurableObject(gameServerOf(gameId), async (_object: GameServerObject, state) => {
      expect(state.storage.kv.get("schedules")).toBeUndefined();
      expect(state.storage.kv.get("game_id")).toBeUndefined();
      expect(await state.storage.getAlarm()).toBeNull();
    });
    // Safe to repeat.
    expect(await service.deleteGameStorage(gameId)).toEqual({ failureMessage: null });
  });
});
