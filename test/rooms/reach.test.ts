import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { issueRoomKey } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";

// Game server reach and secrets: a sandboxed game server's fetch() goes through the gateway
// (apps/rooms/src/outbound.ts), which takes only https to the hosts the game lists, and the game's
// secrets (apps/rooms/src/secrets.ts) reach it as server.secrets and room.secrets. The internet here is
// vitest.config.ts's stand-in, which answers with what it was sent.

const ROOMS = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

async function addGame(slug: string, server: string, allowedHosts: string[], multiplayerMode = "none") {
  const gameId = `game_${slug.replace(/-/g, "")}`;
  const versionId = `version_${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, game_server_allowed_hosts, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, ?, 'page', ?, 0, 0)")
    .bind(gameId, slug, slug, versionId, multiplayerMode, JSON.stringify(allowedHosts))
    .run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, gameId, `games/${versionId}`).run();
  await e.GAMES.put(`games/${versionId}/zaisma-server.js`, server);
  return { gameId, versionId };
}

/** Set a secret as the developer API does: in the game's secrets object, with the time on the game for its rooms. */
async function setSecret(gameId: string, name: string, secretValue: string) {
  const atMs = Date.now();
  await e.GAME_SECRETS.get(e.GAME_SECRETS.idFromName(gameId)).setSecret(name, secretValue, atMs);
  await e.DB.prepare("UPDATE games SET secrets_changed_at_ms = ? WHERE id = ?").bind(atMs, gameId).run();
  await e.GAME_SERVER_OBJECTS.get(e.GAME_SERVER_OBJECTS.idFromName(gameId)).secretsChanged();
}

let address = 0;
async function newPass(slug: string) {
  const roomKey = await issueRoomKey(e.DB, `game_${slug.replace(/-/g, "")}`);
  const response = await SELF.fetch(`${ROOMS}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `192.0.2.${++address % 250}` }, body: JSON.stringify({ gameSlug: slug, roomKey }) });
  return response.json<{ pass: string }>();
}

async function send(slug: string, request: unknown) {
  const { pass } = await newPass(slug);
  const response = await SELF.fetch(`${ROOMS}/v1/requests/${slug}`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `192.0.2.${++address % 250}` }, body: JSON.stringify({ pass, request }) });
  return response.json<any>();
}

// Calls the address it's given with the secret API_TOKEN, and answers what came back or how it was refused.
const CALLER = `
export default {
  async onRequest(player, request, server) {
    try {
      const response = await fetch(request.url, { headers: { authorization: server.secrets.API_TOKEN ?? "none" } });
      return { httpStatus: response.status, location: response.headers.get("location"), body: response.status === 200 ? await response.json() : null };
    } catch (error) {
      return { errorName: error.name, code: error.code ?? null, message: error.message };
    }
  },
};`;

describe("game server reach and secrets", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("calls the hosts the game lists, with its secrets, and nothing else", async () => {
    const { gameId } = await addGame("caller", CALLER, ["api.example.test", "*.cdn.example.test"]);
    await setSecret(gameId, "API_TOKEN", "token-one");

    const reached = await send("caller", { url: "https://api.example.test/scores" });
    expect(reached.answer).toEqual({ httpStatus: 200, location: null, body: { host: "api.example.test", path: "/scores", method: "GET", authorization: "token-one" } });
    // A name under a "*." entry.
    expect((await send("caller", { url: "https://eu.cdn.example.test/level.json" })).answer.body.host).toBe("eu.cdn.example.test");

    // Anything else throws an OutsideCallError saying what to do, and never goes out.
    const unlisted = (await send("caller", { url: "https://elsewhere.example.test/" })).answer;
    expect(unlisted).toMatchObject({ errorName: "OutsideCallError", code: "host_not_allowed" });
    expect(unlisted.message).toContain('game_server_allowed_hosts ["api.example.test","*.cdn.example.test","elsewhere.example.test"]');
    expect((await send("caller", { url: "https://cdn.example.test/" })).answer.code).toBe("host_not_allowed");
    expect((await send("caller", { url: "http://api.example.test/" })).answer.code).toBe("not_https");
    expect((await send("caller", { url: "https://203.0.113.9/" })).answer.code).toBe("unreachable_host");
    expect((await send("caller", { url: "https://localhost/" })).answer.code).toBe("unreachable_host");
    // Zaisma's own domains, and this Zaisma's addresses.
    expect((await send("caller", { url: "https://zaisma.com/api/dev/games" })).answer.code).toBe("unreachable_host");
    expect((await send("caller", { url: "https://rooms.zaisma.test/v1/requests/caller" })).answer.code).toBe("unreachable_host");
  });

  it("follows no redirect to an unlisted host, and only Zaisma's refusals count as refusals", async () => {
    await addGame("redirected", CALLER, ["api.example.test"]);
    const redirected = (await send("redirected", { url: "https://api.example.test/redirect" })).answer;
    // Either the game server sees the redirect itself, or following it is refused: it never reaches the other host.
    expect(redirected.body?.host).not.toBe("elsewhere.example.test");
    expect(redirected.httpStatus === 302 || redirected.code === "host_not_allowed").toBe(true);

    // A server can't pass its answer off as Zaisma refusing the call.
    expect((await send("redirected", { url: "https://api.example.test/claims-refusal" })).answer).toMatchObject({ httpStatus: 200, body: {} });
  });

  it("uses changed secrets from the next call", async () => {
    const { gameId } = await addGame("rotated", CALLER, ["api.example.test"]);
    expect((await send("rotated", { url: "https://api.example.test/" })).answer.body.authorization).toBe("none");
    await setSecret(gameId, "API_TOKEN", "token-one");
    expect((await send("rotated", { url: "https://api.example.test/" })).answer.body.authorization).toBe("token-one");
    await setSecret(gameId, "API_TOKEN", "token-two");
    expect((await send("rotated", { url: "https://api.example.test/" })).answer.body.authorization).toBe("token-two");
  });

  it("gives a room's game server the game's secrets, and new ones when they change", async () => {
    const { gameId } = await addGame(
      "secret-room",
      `export default {
        setup: () => ({}),
        onMessage(state, player, message, room) { room.send(player.id, { token: room.secrets.API_TOKEN ?? null, names: Object.keys(room.secrets) }); },
      };`,
      [],
      "own",
    );
    await setSecret(gameId, "API_TOKEN", "token-one");

    const { pass } = await newPass("secret-room");
    const up = await SELF.fetch(`${ROOMS}/v1/rooms/secret-room/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `192.0.2.${++address % 250}` } });
    const ws = up.webSocket!;
    ws.accept();
    const fromGame: any[] = [];
    const waiters: ((message: any) => void)[] = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string);
      if (message.type !== "message" && message.type !== "error") return;
      const waiter = waiters.shift();
      waiter ? waiter(message) : fromGame.push(message);
    });
    const next = () => (fromGame.length ? Promise.resolve(fromGame.shift()) : new Promise<any>((resolve) => waiters.push(resolve)));
    ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass }));
    ws.send(JSON.stringify({ type: "message", data: "secrets?" }));
    expect((await next()).data).toEqual({ token: "token-one", names: ["API_TOKEN"] });

    // The room reads them again when it next checks the game (every minute; here at once).
    await setSecret(gameId, "API_TOKEN", "token-two");
    const room = e.ROOMS.get(e.ROOMS.idFromName("secret-room:ABCDEF"));
    await runInDurableObject(room, (instance) => (instance as unknown as { gameStillLive(): Promise<boolean> }).gameStillLive());
    ws.send(JSON.stringify({ type: "message", data: "secrets?" }));
    expect((await next()).data).toEqual({ token: "token-two", names: ["API_TOKEN"] });
    ws.close();
  });
});
