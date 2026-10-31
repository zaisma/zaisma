import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { startServer } from "../../packages/game-server/bin/node.js";
// @ts-expect-error plain JavaScript without type declarations
import { checkedStartServerOptions, localRoomStates } from "../../packages/game-server/bin/node-parts.js";
import { defineGameServer, generateSigningKey, loadSigningKey, signPass } from "../../packages/game-server/src/internal.ts";
import { ROOT } from "./surface.ts";
import { temporaryFolder } from "../temporary-folder.ts";

/**
 * The runner's v1 contract: what a developer's own server is started with and how it answers. runner.json is
 * the snapshot (startServer's option names and defaults, the answer's keys, the command line, the routes and the
 * room_states table), and room-states-v1.sqlite is a room state file as v1 wrote it, which a runner of any later
 * version must still bring back. From v1 all of it only grows. npm run contracts:baseline writes both.
 */

const SNAPSHOT = join(import.meta.dirname, "v1/runner.json");
const ABCDEFE = join(import.meta.dirname, "v1/room-states-v1.sqlite");
const isWritingBaseline = Boolean(process.env.CONTRACTS_WRITE_BASELINE);
const NODE_FILE = join(ROOT, "packages/game-server/bin/node.js");

type RunnerSnapshot = {
  startServerOptions: string[];
  startServerDefaults: Record<string, unknown>;
  answerKeys: string[];
  commandLineFlags: string[];
  routes: string[];
  roomStatesColumns: Record<string, string>;
};

const gameServer = defineGameServer({ setup: () => ({}) });

/** What the runner is today, read by running it. */
function runnerNow(): RunnerSnapshot {
  const startServerOptions = (() => {
    try {
      checkedStartServerOptions({ nothingLikeThis: 1 }, "https://rooms.zaisma.com");
    } catch (error) {
      return /startServer takes: (.*)\.$/.exec((error as Error).message.split(" Give")[0]!.replace(/ \(unknown_option\)$/, ""))?.[1]?.split(", ") ?? [];
    }
    return [];
  })();
  const defaults = checkedStartServerOptions({ gameServer, gameSlug: "my-game" }, "https://rooms.zaisma.com");
  const file = join(temporaryFolder("zaisma-runner-v1-"), "states.sqlite");
  localRoomStates(file).write("COLUMN", { stateJson: "{}", matchPlayers: [], savedRoom: {}, savedAtMs: 0 });
  const database = new DatabaseSync(file);
  const columns = database.prepare("SELECT name, type FROM pragma_table_info('room_states')").all() as { name: string; type: string }[];
  database.close();
  const usage = spawnSync(process.execPath, [NODE_FILE], { encoding: "utf8" }).stdout;
  const source = readFileSync(NODE_FILE, "utf8");
  return {
    startServerOptions: startServerOptions.sort(),
    startServerDefaults: { port: defaults.port, origins: defaults.origins, issuerUrl: defaults.issuerUrl },
    answerKeys: ["close", "httpServer"],
    commandLineFlags: [...usage.matchAll(/--([a-z-]+)/g)].map((match) => match[1]!).filter((flag, index, flags) => flags.indexOf(flag) === index).sort(),
    routes: ["/v1/rooms/<game>/<code>", ...["/v1/requests/<game>", "/v1/webhooks"].filter((route) => source.includes(route.replace("<game>", "${gameSlug}")) || source.includes(route))].sort(),
    roomStatesColumns: Object.fromEntries(columns.map((column) => [column.name, column.type])),
  };
}

describe("runner v1", () => {
  if (isWritingBaseline) {
    it("writes the runner snapshot and the room state file", () => {
      writeFileSync(SNAPSHOT, `${JSON.stringify(runnerNow(), null, 2)}\n`);
      if (existsSync(ABCDEFE)) return;
      const states = localRoomStates(ABCDEFE);
      states.write("ABCDEF", { stateJson: '{"count":7}', matchPlayers: [], savedRoom: { isListed: false, isOpen: true, friendJoinsEnabled: true, name: "Docks", labels: {}, knownPlayerIds: [], setupData: { mapName: "docks" }, keptOut: {}, expected: {}, held: {}, kept: {}, reconnecting: {}, accountBlocks: [], sessionBlocks: [], friendships: [] }, savedAtMs: 1_760_000_000_000, isSavedEmpty: true });
    });
    return;
  }

  it("keeps everything the v1 runner snapshot has", () => {
    const was = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as RunnerSnapshot;
    const now = runnerNow();
    for (const list of ["startServerOptions", "answerKeys", "commandLineFlags", "routes"] as const) {
      expect(was[list].filter((name) => !now[list].includes(name)), `${list} only grows from v1`).toEqual([]);
    }
    expect(now.startServerDefaults).toEqual(was.startServerDefaults);
    for (const [name, type] of Object.entries(was.roomStatesColumns)) expect(now.roomStatesColumns[name], `room_states.${name}`).toBe(type);
  });

  it("brings back a room from a room state file as v1 wrote it", async () => {
    const file = join(temporaryFolder("zaisma-runner-v1-"), "room-states.sqlite");
    copyFileSync(ABCDEFE, file);
    const signing = await loadSigningKey(await generateSigningKey());
    const issuer = "https://rooms.zaisma.test";
    const origin = "https://arena.zaismausercontent.com";
    const running = startServer({
      gameServer: defineGameServer({ setup: () => ({ count: 0 }), onMessage: (state, player, room) => void room.send(player.id, { count: state.count }) }),
      gameSlug: "arena",
      port: 0,
      origins: [origin],
      issuerUrl: issuer,
      loadPassKeys: async () => [signing.publicKey],
      roomStateFile: file,
    });
    await new Promise((resolve) => running.httpServer.once("listening", resolve));
    const socket = new WebSocket(`ws://localhost:${(running.httpServer.address() as { port: number }).port}/v1/rooms/arena/ABCDEF`, { origin });
    const seen: any[] = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "probe") socket.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
      else seen.push(message);
    });
    await new Promise((resolve) => socket.on("open", resolve));
    const now = Math.floor(Date.now() / 1000);
    socket.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: await signPass(signing, { sub: "player_v1", name: "V1", aud: "arena", iss: issuer, pass_version_number: 1, kind: "guest", iat: now, exp: now + 60 }) }));
    await expect.poll(() => seen.some((message) => message.type === "welcome"), { message: JSON.stringify(seen) }).toBe(true);
    socket.send(JSON.stringify({ type: "message", data: "count" }));
    await expect.poll(() => seen.find((message) => message.type === "message")?.data).toEqual({ count: 7 });
    socket.close();
    await running.close();
  });
});
