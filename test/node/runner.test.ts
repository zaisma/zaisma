import { afterAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { createServer } from "node:http";
import WebSocket from "ws";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { symlinkSync, writeFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { createSocket } from "node:dgram";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer } from "../../packages/game-server/bin/node.js";
// @ts-expect-error plain JavaScript without type declarations
import { localRoomStates, passKeysFrom, profilesFrom } from "../../packages/game-server/bin/node-parts.js";
import { ERROR_TEXT, GameServerError, defineGameServer, generateSigningKey, loadSigningKey, relay, signPass, type Purchase } from "../../packages/game-server/src/internal.ts";
import { signTestReceipt } from "../helpers.ts";
import { makeCertificate } from "../../packages/game-server/bin/local-play-certificate.js";
import { playTranscript, transcriptGameServerOptions, type TranscriptDriver } from "../rooms-transcript.ts";
import { temporaryFolder } from "../temporary-folder.ts";

const ISS = "https://rooms.zaisma.test";
const ORIGIN = "https://arena.zaismausercontent.com";
const signing = await loadSigningKey(await generateSigningKey());
const server = startServer({ gameServer: relay, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null });
await new Promise((r) => server.httpServer.once("listening", r));
const port = (server.httpServer.address() as { port: number }).port;
afterAll(() => server.close());

async function pass(sub: string, aud = "arena") {
  const now = Math.floor(Date.now() / 1000);
  return signPass(signing, { sub, name: sub.toUpperCase(), aud, iss: ISS, pass_version_number: 1, kind: "guest", iat: now, exp: now + 60 });
}

function connect(origin = ORIGIN, path = "/v1/rooms/arena/ABCDEF", on = port) {
  const ws = new WebSocket(`ws://localhost:${on}${path}`, { origin });
  const inbox: any[] = [];
  const waiters: ((message: any) => void)[] = [];
  // Probes are answered at once, as the SDK does, and kept apart with what came before each.
  const probes: { probe: any; afterTypes: string[] }[] = [];
  const types: string[] = [];
  ws.on("message", (raw, isBinary) => {
    // Bytes come as a binary frame: who they're from (none for the game server), then the bytes.
    const frame = isBinary ? new Uint8Array(raw as Buffer) : null;
    const text = isBinary ? "" : raw.toString();
    const message = frame ? { type: "bytes", fromPlayerId: frame[0] ? new TextDecoder().decode(frame.subarray(1, 1 + frame[0])) : null, bytes: [...frame.subarray(1 + frame[0]!)] } : text === "pong" ? { type: "pong" } : JSON.parse(text);
    if (message.type === "probe") {
      probes.push({ probe: message, afterTypes: [...types] });
      return ws.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
    }
    types.push(message.type);
    const waiter = waiters.shift();
    waiter ? waiter(message) : inbox.push(message);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  const open = new Promise((r) => ws.on("open", r));
  const say = (message: object) => ws.send(JSON.stringify(message));
  return { ws, next, closed, open, say, probes };
}

const until = async (client: { next: () => Promise<any> }, type: string) => {
  for (;;) {
    const message = await client.next();
    if (message.type === type) return message;
  }
};

async function serve(gameServer: object) {
  const own = startServer({ gameServer: gameServer, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null });
  await new Promise((r) => own.httpServer.once("listening", r));
  return { own, at: (own.httpServer.address() as { port: number }).port };
}

describe("Node runner", () => {
  it("runs the same game server with Zaisma player passes", async () => {
    const a = connect();
    const b = connect();
    await Promise.all([a.open, b.open]);
    a.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") });
    // Only Zaisma rooms end a match on a timer: on the developer's own server endsAt stays null.
    expect(await a.next()).toMatchObject({ type: "welcome", me: { id: "a", name: "A" }, hostPlayerId: "a", endsAt: null });
    b.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("b") });
    expect((await b.next()).type).toBe("welcome");
    await a.next(); // players: a
    await a.next(); // players: a, b
    a.say({ type: "message", data: "hi" });
    await b.next(); // b's players list
    expect(await b.next()).toEqual({ type: "message", data: "hi", fromPlayerId: "a" });
    a.ws.close();
    b.ws.close();
  });

  it("lists a room only when its first hello asks for it", async () => {
    const listed = connect(ORIGIN, "/v1/rooms/arena/LSTDAA");
    const unlisted = connect(ORIGIN, "/v1/rooms/arena/LSTDBB");
    await Promise.all([listed.open, unlisted.open]);
    listed.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a"), room: { isListed: true } });
    unlisted.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("b") });
    expect((await listed.next()).room.isListed).toBe(true);
    expect((await unlisted.next()).room.isListed).toBe(false);
    listed.ws.close();
    unlisted.ws.close();
  });

  it("takes bytes for the game server and sends bytes back, as Zaisma rooms do", async () => {
    const a = connect();
    const b = connect();
    await Promise.all([a.open, b.open]);
    a.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") });
    await until(a, "welcome");
    b.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("b") });
    await until(b, "welcome");
    // The relay passes them on, from a.
    a.ws.send(new Uint8Array([3, 4, 5]));
    expect(await until(b, "bytes")).toEqual({ type: "bytes", fromPlayerId: "a", bytes: [3, 4, 5] });
    a.ws.send(new Uint8Array(16 * 1024 + 1));
    expect(await until(a, "error")).toMatchObject({ code: "too_big" });
    a.ws.close();
    b.ws.close();

    // A game server of its own, answering bytes with bytes.
    const { own, at } = await serve(defineGameServer({ setup: () => ({}), onBytes: (_state, player, room, bytes) => room.sendBytes(player.id, bytes.map((byte) => byte * 2)) }));
    const c = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await c.open;
    c.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("c") });
    await until(c, "welcome");
    c.ws.send(new Uint8Array([1, 2]));
    expect(await until(c, "bytes")).toEqual({ type: "bytes", fromPlayerId: null, bytes: [2, 4] });
    c.ws.close();
    own.close();
  });

  it("probes each player right after welcome, and the game server reads their ping and the room's clock", async () => {
    const pinging = defineGameServer({
      setup: () => ({}),
      onMessage: (_s, player, room, _data) => room.send(player.id, { pingDurationMs: room.pingDurationMs(player.id), serverTimeMs: room.serverTimeMs() }),
    });
    const { own, at } = await serve(pinging);
    const a = connect(ORIGIN, "/v1/rooms/arena/PNGCLK", at);
    await a.open;
    a.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") });
    expect((await a.next()).type).toBe("welcome");
    while (a.probes.length < 2) await new Promise((r) => setTimeout(r, 10));
    expect(a.probes[0]).toMatchObject({ probe: { type: "probe", probeNumber: 1, pingDurationMs: null }, afterTypes: ["welcome"] });
    // The answer to the first probe brings another, carrying the ping the room measured.
    expect(typeof a.probes[1]!.probe.pingDurationMs).toBe("number");
    a.say({ type: "message", data: "ping?" });
    const answer = await until(a, "message");
    expect(typeof answer.data.pingDurationMs).toBe("number");
    expect(Math.abs(answer.data.serverTimeMs - Date.now())).toBeLessThan(1000);
    a.ws.close();
    await own.close();
  });

  it("frees a connection that falls too far behind at once", async () => {
    // About 2 MB a second to a player who never answers a probe.
    const flooding = defineGameServer({ ticksPerSec: 20, setup: () => ({}), onTick: (_s, _tickDurationSec, room) => room.broadcast("x".repeat(100 * 1024)) });
    const { own, at } = await serve(flooding);
    const ws = new WebSocket(`ws://localhost:${at}/v1/rooms/arena/SLWCNX`, { origin: ORIGIN });
    const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") }));
    // Closed with 4003, then terminate(): behind a real backlog the client sees an abnormal close (1006); either way the SDK reconnects.
    expect([1006, 4003]).toContain(await closed);
    await own.close();
  });

  it("starts a room with friends' Join off when its maker asks, as Zaisma rooms do", async () => {
    const a = connect(ORIGIN, "/v1/rooms/arena/FJ2KMN");
    await a.open;
    a.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a"), room: { friendJoinsEnabled: false } });
    expect(await a.next()).toMatchObject({ type: "welcome", room: { friendJoinsEnabled: false } });
    // The relay's host turns it back on.
    a.say({ type: "room", room: { friendJoinsEnabled: true } });
    expect(await until(a, "room")).toMatchObject({ room: { friendJoinsEnabled: true } });
    a.ws.close();
  });

  it("looks up an account's name, since its pass carries none, and turns away a deleted account", async () => {
    const lookedUp: string[] = [];
    const profiles = async (playerId: string) => {
      lookedUp.push(playerId);
      return playerId === "player_owl" ? { id: playerId, name: "Night_Owl" } : null;
    };
    const own = startServer({ gameServer: relay, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null, loadProfile: profiles });
    await new Promise((r) => own.httpServer.once("listening", r));
    const at = (own.httpServer.address() as { port: number }).port;
    const accountPass = async (sub: string) => {
      const now = Math.floor(Date.now() / 1000);
      return signPass(signing, { sub, aud: "arena", iss: ISS, pass_version_number: 1, kind: "account", iat: now, exp: now + 60 });
    };
    const owl = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await owl.open;
    owl.say({ type: "hello", protocolVersionNumber: 1, pass: await accountPass("player_owl") });
    expect((await owl.next()).me).toEqual({ id: "player_owl", name: "Night_Owl", kind: "account" });
    const gone = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await gone.open;
    gone.say({ type: "hello", protocolVersionNumber: 1, pass: await accountPass("player_gone") });
    expect(await gone.next()).toMatchObject({ type: "error", code: "bad_pass" });
    // Guests' names come in their passes, so they're never looked up.
    expect(lookedUp).toEqual(["player_owl", "player_gone"]);
    owl.ws.close();
    own.close();
  });

  it("turns an account away as busy, never crashing, when Zaisma can't be reached for its name", async () => {
    const own = startServer({ gameServer: relay, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null, loadProfile: async () => { throw new Error("Couldn't look up player_owl"); } });
    await new Promise((r) => own.httpServer.once("listening", r));
    const at = (own.httpServer.address() as { port: number }).port;
    const now = Math.floor(Date.now() / 1000);
    const owl = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await owl.open;
    owl.say({ type: "hello", protocolVersionNumber: 1, pass: await signPass(signing, { sub: "player_owl", aud: "arena", iss: ISS, pass_version_number: 1, kind: "account", iat: now, exp: now + 60 }) });
    expect(await owl.next()).toMatchObject({ type: "error", code: "busy" });
    // Busy closes with the try-again code (1013), not the final one (4001).
    expect(await owl.closed).toBe(1013);
    // Every other refusal is final.
    const stranger = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await stranger.open;
    stranger.say({ type: "hello", protocolVersionNumber: 1, pass: "not-a-pass" });
    expect(await stranger.next()).toMatchObject({ type: "error", code: "bad_pass" });
    expect(await stranger.closed).toBe(4001);
    own.close();
  });

  it("turns a hello away as busy, and keeps its matches, when Zaisma's keys or an account's name are slow to come", async () => {
    let status = 503;
    let requestCount = 0;
    const zaisma = createServer((request, response) => {
      requestCount++;
      response.writeHead(status).end("later");
    });
    await new Promise<void>((r) => zaisma.listen(0, r));
    onTestFinished(() => void zaisma.close());
    const issuerUrl = `http://localhost:${(zaisma.address() as { port: number }).port}`;
    const own = startServer({ gameServer: relay, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl, loadPassKeys: passKeysFrom(`${issuerUrl}/.well-known/jwks.json`), loadProfile: profilesFrom(issuerUrl), roomStateFile: null });
    await new Promise((r) => own.httpServer.once("listening", r));
    onTestFinished(() => void own.close());
    const at = (own.httpServer.address() as { port: number }).port;
    // The keys can't be fetched (503): busy, the try-again close.
    const first = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await first.open;
    first.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("player_one") });
    expect(await first.next()).toMatchObject({ type: "error", code: "busy" });
    expect(await first.closed).toBe(1013);
    // Account names ask to slow down (429).
    const keyed = startServer({ gameServer: relay, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], loadProfile: profilesFrom(issuerUrl), roomStateFile: null });
    await new Promise((r) => keyed.httpServer.once("listening", r));
    onTestFinished(() => void keyed.close());
    status = 429;
    const keyedAt = (keyed.httpServer.address() as { port: number }).port;
    const now = Math.floor(Date.now() / 1000);
    const second = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", keyedAt);
    await second.open;
    second.say({ type: "hello", protocolVersionNumber: 1, pass: await signPass(signing, { sub: "player_owl", aud: "arena", iss: ISS, pass_version_number: 1, kind: "account", iat: now, exp: now + 60 }) });
    expect(await second.next()).toMatchObject({ type: "error", code: "busy" });
    expect(await second.closed).toBe(1013);
    expect(requestCount).toBeGreaterThan(0);
    // And the runner still takes a guest.
    const guest = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", keyedAt);
    await guest.open;
    guest.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("player_guest") });
    expect((await guest.next()).me).toMatchObject({ id: "player_guest" });
    guest.ws.close();
  });

  it("keeps the keys it has when a refresh fails, and asks for new ones at most every 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-10-16T13:45:00Z") });
    onTestFinished(() => void vi.useRealTimers());
    let isUp = true;
    let fetchCount = 0;
    const zaisma = createServer((request, response) => {
      fetchCount++;
      if (!isUp) return void response.writeHead(503).end();
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [{ kid: "key_one" }] }));
    });
    await new Promise<void>((r) => zaisma.listen(0, r));
    onTestFinished(() => void zaisma.close());
    const loadKeys = passKeysFrom(`http://localhost:${(zaisma.address() as { port: number }).port}/.well-known/jwks.json`);
    expect(await loadKeys()).toEqual([{ kid: "key_one" }]);
    expect(fetchCount).toBe(1);
    // A pass with a key ID it doesn't know asks for a refresh: too soon after the last fetch, so the keys it has answer.
    expect(await loadKeys(true)).toEqual([{ kid: "key_one" }]);
    expect(fetchCount).toBe(1);
    // Later it does ask, and Zaisma is down: the keys it has still answer.
    isUp = false;
    vi.setSystemTime(Date.parse("2026-10-16T13:45:31Z"));
    expect(await loadKeys(true)).toEqual([{ kid: "key_one" }]);
    expect(fetchCount).toBe(2);
    // And a day later, with Zaisma still down, the old keys serve until it's back.
    vi.setSystemTime(Date.parse("2026-10-17T13:45:00Z"));
    expect(await loadKeys()).toEqual([{ kid: "key_one" }]);
  });

  it("names OutsideCallError, as Zaisma's game servers can, though nothing here refuses a call", () => {
    const OutsideCallError = (globalThis as unknown as { OutsideCallError: new (...given: string[]) => Error }).OutsideCallError;
    expect(typeof OutsideCallError).toBe("function");
    expect(new Error("an ordinary failure") instanceof OutsideCallError).toBe(false);
    expect(new OutsideCallError("host_not_allowed", "x isn't listed.", "List it.") instanceof OutsideCallError).toBe(true);
  });

  it("seats a pass of a kind added after v1 as a guest, as Zaisma rooms do", async () => {
    const own = startServer({ gameServer: relay, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null });
    await new Promise((r) => own.httpServer.once("listening", r));
    const at = (own.httpServer.address() as { port: number }).port;
    const now = Math.floor(Date.now() / 1000);
    const later = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await later.open;
    later.say({ type: "hello", protocolVersionNumber: 1, pass: await signPass(signing, { sub: "player_later", name: "Swift Fox 42", aud: "arena", iss: ISS, pass_version_number: 1, kind: "studio", iat: now, exp: now + 60 }) });
    expect((await later.next()).me).toEqual({ id: "player_later", name: "Swift Fox 42", kind: "guest" });
    later.ws.close();
    own.close();
  });

  it("gives the game server what an account owns from its pass, as Zaisma rooms do, and never players' games", async () => {
    const profiles = async (playerId: string) => ({ id: playerId, name: "Gold_Owl" });
    const wardrobe = defineGameServer({ maximumPlayerCount: 4, setup: () => ({}), onJoin: (_state: unknown, player: { id: string; ownedItemNames?: string[] }, room: { send(playerId: string, data: unknown): void }) => room.send(player.id, { owned: player.ownedItemNames ?? null }) });
    const own = startServer({ gameServer: wardrobe, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null, loadProfile: profiles });
    await new Promise((r) => own.httpServer.once("listening", r));
    const at = (own.httpServer.address() as { port: number }).port;
    const now = Math.floor(Date.now() / 1000);
    const owner = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await owner.open;
    owner.say({ type: "hello", protocolVersionNumber: 1, pass: await signPass(signing, { sub: "player_owl", aud: "arena", iss: ISS, pass_version_number: 1, kind: "account", owned_item_names: ["gold_crown"], iat: now, exp: now + 60 }) });
    const welcome = await owner.next();
    expect(welcome.me).toEqual({ id: "player_owl", name: "Gold_Owl", kind: "account" });
    expect(await until(owner, "message")).toEqual({ type: "message", data: { owned: ["gold_crown"] }, fromPlayerId: null });
    owner.ws.close();
    own.close();
  });

  it("finds blocks between accounts in their passes, and tells both players' games", async () => {
    const checked: boolean[] = [];
    const watcher = defineGameServer({ setup: () => ({}), onJoin: (_state, player, room) => void (player.id === "player_mia" && checked.push(room.hasBlockBetween("player_kit", "player_mia"))) });
    const own = startServer({ gameServer: watcher, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null, loadProfile: async (playerId: string) => ({ id: playerId, name: playerId.slice(7) }) });
    await new Promise((r) => own.httpServer.once("listening", r));
    const at = (own.httpServer.address() as { port: number }).port;
    const accountPass = async (sub: string, playerTag: string, blockTagIds: string[]) => {
      const now = Math.floor(Date.now() / 1000);
      return signPass(signing, { sub, aud: "arena", iss: ISS, pass_version_number: 1, kind: "account", player_tag_id: playerTag, block_player_tag_ids: blockTagIds, iat: now, exp: now + 60 });
    };
    const kit = connect(ORIGIN, "/v1/rooms/arena/WALLED", at);
    await kit.open;
    kit.say({ type: "hello", protocolVersionNumber: 1, pass: await accountPass("player_kit", "block_tag_kit", ["block_tag_mia"]) });
    expect((await kit.next()).type).toBe("welcome");
    // Mia's pass is from before the block: Kit's alone is enough.
    const mia = connect(ORIGIN, "/v1/rooms/arena/WALLED", at);
    await mia.open;
    mia.say({ type: "hello", protocolVersionNumber: 1, pass: await accountPass("player_mia", "block_tag_mia", []) });
    expect((await mia.next()).type).toBe("welcome");
    expect(await until(mia, "blocks")).toEqual({ type: "blocks", playerIds: ["player_kit"] });
    expect(await until(kit, "blocks")).toEqual({ type: "blocks", playerIds: ["player_mia"] });
    expect(checked).toEqual([true]);
    kit.ws.close();
    mia.ws.close();
    await own.close();
  });

  it("finds friends between accounts in their passes, for room.areFriends", async () => {
    const checked: boolean[] = [];
    const watcher = defineGameServer({ setup: () => ({}), onJoin: (_state, player, room) => void (player.id !== "player_kit" && checked.push(room.areFriends("player_kit", player.id))) });
    const own = startServer({ gameServer: watcher, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null, loadProfile: async (playerId: string) => ({ id: playerId, name: playerId.slice(7) }) });
    await new Promise((r) => own.httpServer.once("listening", r));
    const at = (own.httpServer.address() as { port: number }).port;
    const accountPass = async (sub: string, playerTag: string, friendTagIds: string[]) => {
      const now = Math.floor(Date.now() / 1000);
      return signPass(signing, { sub, aud: "arena", iss: ISS, pass_version_number: 1, kind: "account", player_tag_id: playerTag, friend_player_tag_ids: friendTagIds, iat: now, exp: now + 60 });
    };
    const enter = async (sub: string, playerTag: string, friendTagIds: string[]) => {
      const c = connect(ORIGIN, "/v1/rooms/arena/FRNDSA", at);
      await c.open;
      c.say({ type: "hello", protocolVersionNumber: 1, pass: await accountPass(sub, playerTag, friendTagIds) });
      expect((await c.next()).type).toBe("welcome");
      return c;
    };
    // Kit and Mia list each other; Cy lists Kit, but Kit doesn't list Cy.
    const players = [await enter("player_kit", "player_tag_kit", ["player_tag_mia"]), await enter("player_mia", "player_tag_mia", ["player_tag_kit"]), await enter("player_cy", "player_tag_cy", ["player_tag_kit"])];
    expect(checked).toEqual([true, false]);
    for (const player of players) player.ws.close();
    await own.close();
  });

  it("refuses other origins, unknown rooms, passes for other games and the old short hello", async () => {
    // Told why before the close, so a browser game can read it: it never sees why a socket closed.
    const evil = connect("https://evil.example");
    expect(await evil.next()).toMatchObject({ type: "error", code: "bad_origin" });
    expect(await evil.closed).toBe(4001);
    const unknown = connect(ORIGIN, "/v1/rooms/other-game/ABCDEF");
    expect(await unknown.next()).toMatchObject({ type: "error", code: "game_unavailable" });
    expect(await unknown.closed).toBe(4001);
    const c = connect();
    await c.open;
    c.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("c", "other-game") });
    expect(await c.next()).toMatchObject({ type: "error", code: "bad_pass" });
    expect(await c.closed).toBe(4001);
    const old = connect();
    await old.open;
    old.say({ t: "hello", pass: await pass("d") });
    expect(await old.next()).toMatchObject({ type: "error", code: "no_hello" });
  });

  it("brings rooms back with their state after a restart, from its room state file", async () => {
    const file = join(temporaryFolder("zaisma-room-states-"), "rooms.sqlite");
    const racer = defineGameServer({
      ticksPerSec: 50,
      stateSaveIntervalSec: 1,
      setup: () => ({ tickCount: 0, restored: null as unknown }),
      onTick: (state) => void state.tickCount++,
      onRestored: (state, restoreInfo, room) => void (state.restored = { ...restoreInfo, awayReasons: room.players.map((player) => room.awayReason(player.id)) }),
      onMessage: (state, player, room, _message) => room.send(player.id, { tickCount: state.tickCount, restored: state.restored }),
    });
    const start = async () => {
      const own = startServer({ gameServer: racer, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: file });
      await new Promise((r) => own.httpServer.once("listening", r));
      return { own, at: (own.httpServer.address() as { port: number }).port };
    };
    const first = await start();
    const lucas = connect(ORIGIN, "/v1/rooms/arena/RSTRTN", first.at);
    await lucas.open;
    lucas.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("lucas") });
    expect((await lucas.next()).type).toBe("welcome");
    // Emma plays a little and leaves: she isn't brought back, though the state doesn't say she left.
    const emma = connect(ORIGIN, "/v1/rooms/arena/RSTRTN", first.at);
    await emma.open;
    emma.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("emma") });
    expect((await emma.next()).type).toBe("welcome");
    await new Promise((r) => setTimeout(r, 1100));
    emma.ws.close(1000);
    await emma.closed;
    await new Promise((r) => setTimeout(r, 50));
    // A clean stop saves every room, so nothing is lost.
    await first.own.close();
    const tickCountAtStop = JSON.parse(localRoomStates(file).read("RSTRTN").stateJson).tickCount;
    expect(tickCountAtStop).toBeGreaterThan(0);
    // The time lost is the clock's between the save and the room's return, so the clock (only) stands 3 seconds after the save:
    // a restart on a busy machine takes as long as it takes, and the room still says exactly what was lost.
    const { savedAtMs } = localRoomStates(file).read("RSTRTN");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(savedAtMs + 3000);
    onTestFinished(() => void vi.useRealTimers());

    const second = await start();
    const back = connect(ORIGIN, "/v1/rooms/arena/RSTRTN", second.at);
    await back.open;
    back.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("lucas") });
    expect((await back.next()).type).toBe("welcome");
    back.say({ type: "message", data: "how" });
    const how = (await until(back, "message")).data;
    expect(how.tickCount).toBeGreaterThanOrEqual(tickCountAtStop);
    expect(how.restored).toMatchObject({ lostDurationSec: 3, savedAt: new Date(savedAtMs).toISOString(), awayReasons: ["lost"] });
    back.ws.close();
    await second.own.close();
  });

  it("lets spectators watch on your own server as in Zaisma rooms, and tells them when the last player leaves", async () => {
    const { own, at } = await serve(
      defineGameServer({
        maximumPlayerCount: 1,
        maximumSpectatorCount: 1,
        setup: () => ({}),
        onSpectatorJoin: (_state, spectator, room) => room.send(spectator.id, { watching: room.spectators.length }),
        onMessage: (_state, _player, room, message) => room.broadcast({ said: message }, { audience: "spectators" }),
      }),
    );
    const path = "/v1/rooms/arena/WATCHN";
    // Nobody's playing: nothing to watch.
    const early = connect(ORIGIN, path, at);
    await early.open;
    early.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("early"), isSpectator: true });
    expect(await until(early, "error")).toMatchObject({ code: "room_not_running" });

    const player = connect(ORIGIN, path, at);
    await player.open;
    player.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("p") });
    await until(player, "welcome");
    // The room is full, but there's room to watch.
    const watcher = connect(ORIGIN, path, at);
    await watcher.open;
    watcher.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("w"), isSpectator: true });
    expect(await until(watcher, "welcome")).toMatchObject({ isSpectator: true, spectatorCount: 1 });
    expect(await until(watcher, "message")).toEqual({ type: "message", data: { watching: 1 }, fromPlayerId: null });
    const second = connect(ORIGIN, path, at);
    await second.open;
    second.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("w2"), isSpectator: true });
    expect(await until(second, "error")).toMatchObject({ code: "spectators_full" });

    player.say({ type: "message", data: "go" });
    expect(await until(watcher, "message")).toEqual({ type: "message", data: { said: "go" }, fromPlayerId: null });
    watcher.say({ type: "message", data: "me too" });
    expect(await until(watcher, "error")).toMatchObject({ code: "spectator_cannot_send" });

    player.ws.close(1000);
    expect(await until(watcher, "ended")).toEqual({ type: "ended", message: "The match ended.", endReason: "no_players" });
    expect(await watcher.closed).toBe(4000);
    await own.close();
  });

  it("sends state sync, and holds latest-only messages while a socket is backed up, as Zaisma rooms do", async () => {
    const game = defineGameServer({
      stateSyncEnabled: true,
      setup: () => ({ moveCount: 0 }),
      onMessage(state, _player, room, message) {
        if (message === "move") state.moveCount++;
        else room.broadcast({ type: "aim", angle: message }, { delivery: "latest_only", latestKey: "aim" });
      },
      stateView: (state, viewer) => ({ moveCount: state.moveCount, me: viewer.id }),
    });
    const { own, at } = await serve(game);
    const a = connect(ORIGIN, "/v1/rooms/arena/STATEA", at);
    await a.open;
    a.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") });
    const { serverTimeMs, ...full } = await until(a, "state");
    expect(full).toEqual({ type: "state", full: { moveCount: 0, me: "a" } });
    expect(serverTimeMs).toBeGreaterThan(0);
    a.say({ type: "message", data: "move" });
    expect(await until(a, "state")).toMatchObject({ changes: [[["moveCount"], 1]] });
    // Its socket holds 100 KB not yet sent: the game's latest-only messages wait, and state sync skips it.
    // The runner's own sockets (they carry zaismaSeenAtMs) report a backlog; every other socket reports its own.
    let bufferedSizeBytes = 100 * 1024;
    // The runner has its own copy of ws, so its sockets are that copy's.
    const RunnerWebSocket = createRequire(join(import.meta.dirname, "../../packages/game-server/bin/node.js"))("ws");
    const realBufferedAmount = Object.getOwnPropertyDescriptor(RunnerWebSocket.prototype, "bufferedAmount")!;
    Object.defineProperty(RunnerWebSocket.prototype, "bufferedAmount", { get() { return this.zaismaSeenAtMs === undefined ? realBufferedAmount.get!.call(this) : bufferedSizeBytes; }, configurable: true });
    onTestFinished(() => void Object.defineProperty(RunnerWebSocket.prototype, "bufferedAmount", realBufferedAmount));
    for (const angle of [10, 20, 30]) a.say({ type: "message", data: angle });
    a.say({ type: "message", data: "move" });
    await new Promise((r) => setTimeout(r, 120));
    bufferedSizeBytes = 0;
    // Drained: the newest aim, then a full copy of the state.
    expect(await a.next()).toEqual({ type: "message", data: { type: "aim", angle: 30 }, fromPlayerId: null });
    expect(await a.next()).toMatchObject({ type: "state", full: { moveCount: 2, me: "a" } });
    a.ws.close();
    own.close();
  });

  it("won't start a game server with an option it doesn't take", () => {
    expect(() => startServer({ gameServer: { tickRate: 20, setup: () => ({}) } as never, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [], roomStateFile: null })).toThrow(
      "tickRate isn't a game server option",
    );
  });

  it("closes startServer's options: an unknown or wrong-kind option is a coded error before anything listens", () => {
    const base = { gameServer: relay, gameSlug: "arena", port: 0 };
    const refused = (options: object) => {
      try {
        startServer(options as never);
      } catch (error) {
        return error as GameServerError;
      }
      throw new Error("startServer started");
    };
    expect(refused({ ...base, server: relay })).toMatchObject({ name: "GameServerError", code: "unknown_option", field: "server" });
    expect(refused({ ...base, rooms: 1 })).toMatchObject({ code: "unknown_option", field: "rooms" });
    expect(refused({ gameSlug: "arena" })).toMatchObject({ code: "bad_option", field: "gameServer" });
    expect(refused({ ...base, gameSlug: "Not A Slug" })).toMatchObject({ code: "bad_option", field: "gameSlug" });
    expect(refused({ ...base, port: "8080" })).toMatchObject({ code: "bad_option", field: "port" });
    expect(refused({ ...base, port: 70000 })).toMatchObject({ code: "bad_option", field: "port" });
    expect(refused({ ...base, origins: "https://arena.example" })).toMatchObject({ code: "bad_option", field: "origins" });
    expect(refused({ ...base, loadPassKeys: [] })).toMatchObject({ code: "bad_option", field: "loadPassKeys" });
    expect(refused({ ...base, database: {} })).toMatchObject({ code: "bad_option", field: "database" });
    expect(refused({ ...base, roomStateFile: 3 })).toMatchObject({ code: "bad_option", field: "roomStateFile" });
    expect(refused({ ...base, server: relay }).message).toContain("startServer takes: gameServer, gameSlug, port");
    // The fast lane: all three or none, a port, and certificate files it can read.
    expect(refused({ ...base, webtransportPort: 4433 })).toMatchObject({ code: "bad_option", field: "certificatePath" });
    expect(refused({ ...base, webtransportPort: 4433 }).message).toContain("The fast lane needs certificatePath and certificateKeyPath too.");
    expect(refused({ ...base, certificateKeyPath: "privkey.pem" })).toMatchObject({ code: "bad_option", field: "webtransportPort" });
    expect(refused({ ...base, webtransportPort: "443", certificatePath: "a.pem", certificateKeyPath: "b.pem" })).toMatchObject({ code: "bad_option", field: "webtransportPort" });
    expect(refused({ ...base, webtransportPort: 443, certificatePath: 3, certificateKeyPath: "b.pem" })).toMatchObject({ code: "bad_option", field: "certificatePath" });
    expect(refused({ ...base, webtransportPort: 443, certificatePath: "/no/such/fullchain.pem", certificateKeyPath: "b.pem" })).toMatchObject({ code: "bad_option", field: "certificatePath" });
  });

  it("answers { close, httpServer, fastLaneReady }, listens on the port given, and close() resolves once it has stopped", async () => {
    const running = startServer({ gameServer: relay, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null });
    expect(Object.keys(running).sort()).toEqual(["close", "fastLaneReady", "httpServer"]);
    // No fast lane asked for: ready at once.
    await expect(running.fastLaneReady).resolves.toBeUndefined();
    await new Promise((r) => running.httpServer.once("listening", r));
    expect(running.httpServer.listening).toBe(true);
    await running.close();
    expect(running.httpServer.listening).toBe(false);
  });

  it("restores a turn-based room with its state only, with no onRestored (a ticking room is restored with it, above)", async () => {
    const file = join(temporaryFolder("zaisma-turn-based-"), "rooms.sqlite");
    const restored: unknown[] = [];
    const turnBased = defineGameServer({ setup: () => ({ moves: 0 }), onRestored: (_state, restoreInfo) => void restored.push(restoreInfo), onMessage: (state, player, room) => ((state.moves += 1), room.send(player.id, { moves: state.moves })) });
    const start = async (gameServer: object) => {
      const own = startServer({ gameServer: gameServer as never, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: file });
      await new Promise((r) => own.httpServer.once("listening", r));
      return { own, at: (own.httpServer.address() as { port: number }).port };
    };
    const first = await start(turnBased);
    const lucas = connect(ORIGIN, "/v1/rooms/arena/TRNBSD", first.at);
    await lucas.open;
    lucas.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("lucas") });
    expect((await lucas.next()).type).toBe("welcome");
    lucas.say({ type: "message", data: "move" });
    expect((await until(lucas, "message")).data).toEqual({ moves: 1 });
    lucas.ws.close(1000);
    await lucas.closed;
    await new Promise((r) => setTimeout(r, 50));
    await first.own.close();
    const second = await start(turnBased);
    const back = connect(ORIGIN, "/v1/rooms/arena/TRNBSD", second.at);
    await back.open;
    back.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("lucas") });
    expect((await back.next()).type).toBe("welcome");
    back.say({ type: "message", data: "move" });
    // The state came back (moves 2, not 1), and a turn-based room hears nothing of a restore, as in Zaisma's rooms.
    expect((await until(back, "message")).data).toEqual({ moves: 2 });
    expect(restored).toEqual([]);
    back.ws.close(1000);
    await second.own.close();
  });

  it("brings a turn-based match's players back as dropped players after a restart: onRestored, then onBack, and no second onJoin", async () => {
    const file = join(temporaryFolder("zaisma-turn-based-restart-"), "rooms.sqlite");
    const events: string[] = [];
    const turnBased = defineGameServer({
      setup: () => ({ moves: 0 }),
      onJoin: (_state, player) => void events.push(`join ${player.id}`),
      onRestored: (_state, restoreInfo, room) => void events.push(`restored ${room.players.map((player) => `${player.id}:${room.awayReason(player.id)}`).join(",")} ${restoreInfo.lostDurationSec >= 0}`),
      onBack: (_state, player) => void events.push(`back ${player.id}`),
      onMessage: (state, player, room) => ((state.moves += 1), room.send(player.id, { moves: state.moves })),
    });
    const start = async () => {
      const own = startServer({ gameServer: turnBased as never, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: file });
      await new Promise((r) => own.httpServer.once("listening", r));
      return { own, at: (own.httpServer.address() as { port: number }).port };
    };
    const first = await start();
    const players = await Promise.all(["lucas", "maya"].map(async (id) => ({ id, client: connect(ORIGIN, "/v1/rooms/arena/TRNRST", first.at), pass: await pass(id) })));
    for (const { client, pass: passText } of players) {
      await client.open;
      client.say({ type: "hello", protocolVersionNumber: 1, pass: passText });
      await until(client, "welcome");
    }
    players[0]!.client.say({ type: "message", data: "move" });
    expect((await until(players[0]!.client, "message")).data).toEqual({ moves: 1 });
    // The server stops with both in the match.
    await first.own.close();
    await Promise.all(players.map(({ client }) => client.closed));
    const second = await start();
    const back = connect(ORIGIN, "/v1/rooms/arena/TRNRST", second.at);
    await back.open;
    back.say({ type: "hello", protocolVersionNumber: 1, pass: players[0]!.pass });
    await until(back, "welcome");
    expect(events).toEqual(["join lucas", "join maya", "restored lucas:lost,maya:lost true", "back lucas"]);
    back.say({ type: "message", data: "move" });
    expect((await until(back, "message")).data).toEqual({ moves: 2 });
    back.ws.close(1000);
    await second.own.close();
  });

  it("gives a player one room of the game at a time: joining another closes the first, and onLeave hears \"left\"", async () => {
    const left: string[] = [];
    const { own, at } = await serve(defineGameServer({ setup: () => ({}), onLeave: (_state, player, _room, leaveInfo) => void left.push(`${player.id} ${leaveInfo.reason}`) }));
    const lucas = await pass("lucas");
    const maya = await pass("maya");
    const hello = async (code: string, passText: string) => {
      const client = connect(ORIGIN, `/v1/rooms/arena/${code}`, at);
      await client.open;
      client.say({ type: "hello", protocolVersionNumber: 1, pass: passText });
      await until(client, "welcome");
      return client;
    };
    const first = await hello("RMAAAA", lucas);
    const friend = await hello("RMAAAA", maya);
    const second = await hello("RMBBBB", lucas);
    expect(await first.closed).toBe(4001);
    expect(left).toEqual(["lucas left"]);
    // The room they left lists them gone to the one who stayed.
    expect((await until(friend, "players")).players.map((player: { id: string }) => player.id)).toContain("maya");
    // The newer room keeps them, and a second tab of the same room still replaces the connection, as before.
    const again = await hello("RMBBBB", lucas);
    expect(await second.closed).toBe(4001);
    expect(left).toEqual(["lucas left"]);
    again.ws.close(1000);
    friend.ws.close(1000);
    await own.close();
  });

  it("lets a game raise maximumRoomCountPerPlayer: both rooms keep the player, and a third closes the oldest", async () => {
    const left: string[] = [];
    const { own, at } = await serve(defineGameServer({ maximumRoomCountPerPlayer: 2, setup: () => ({}), onLeave: (_state, _player, room, leaveInfo) => void left.push(`${room.roomCode} ${leaveInfo.reason}`) }));
    const lucas = await pass("lucas");
    const hello = async (code: string) => {
      const client = connect(ORIGIN, `/v1/rooms/arena/${code}`, at);
      await client.open;
      client.say({ type: "hello", protocolVersionNumber: 1, pass: lucas });
      await until(client, "welcome");
      return client;
    };
    const a = await hello("RMDDDD");
    const b = await hello("RMEEEE");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(left).toEqual([]);
    const c = await hello("RMFFFF");
    expect(await a.closed).toBe(4001);
    expect(left).toEqual(["RMDDDD left"]);
    b.ws.close(1000);
    c.ws.close(1000);
    await own.close();
  });

  it("starts from the command line through a symlink, as npm's bin is, and prints usage for an unknown flag", async () => {
    const folder = temporaryFolder("zaisma-bin-");
    const link = join(folder, "zaisma-game-server");
    symlinkSync(join(import.meta.dirname, "../../packages/game-server/bin/node.js"), link);
    const bare = spawnSync(process.execPath, [link], { encoding: "utf8" });
    expect(bare.stdout).toContain("Usage: zaisma-game-server <server.ts | relay> --game <slug>");
    const unknown = spawnSync(process.execPath, [link, "relay", "--game", "arena", "--nope", "1"], { encoding: "utf8" });
    expect(unknown.status).toBe(1);
    expect(unknown.stdout + unknown.stderr).toContain("Usage: zaisma-game-server");
    const badPort = spawnSync(process.execPath, [link, "relay", "--game", "arena", "--port", "abc"], { encoding: "utf8" });
    expect(badPort.status).toBe(1);
    expect(badPort.stdout + badPort.stderr).toContain("(bad_option)");
    expect(badPort.stderr).not.toContain("    at ");
    // The fast lane's three flags come together: one alone names the other two, then the usage line.
    const fastLaneAlone = spawnSync(process.execPath, [link, "relay", "--game", "arena", "--webtransport-port", "4433"], { encoding: "utf8" });
    expect(fastLaneAlone.status).toBe(1);
    expect(fastLaneAlone.stdout).toContain("The fast lane needs --certificate-path and --certificate-key-path too");
    expect(fastLaneAlone.stdout).toContain("[--webtransport-port 443 --certificate-path fullchain.pem --certificate-key-path privkey.pem]");
  });

  it("reserves a room for some players, with its setup data and nobody else", async () => {
    // A lobby that sends the first two players to a match of their own; the match keeps what each brought.
    const lobby = defineGameServer({
      setup: (setupData: unknown) => ({ setupData, brought: {} as Record<string, unknown> }),
      onJoin(s, p, room, joinData) {
        s.brought[p.id] = joinData;
        if (!s.setupData && room.players.length === 2) room.reserve({ playerIds: room.players.map((x) => x.id), setupData: { map: "Docks" } });
        if (s.setupData) room.send(p.id, s);
      },
    });
    const { own, at } = await serve(lobby);
    const a = connect(ORIGIN, "/v1/rooms/arena/LBBYAA", at);
    const b = connect(ORIGIN, "/v1/rooms/arena/LBBYAA", at);
    await Promise.all([a.open, b.open]);
    a.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") });
    await until(a, "welcome");
    b.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("b") });
    const { roomCode } = await until(a, "move");
    expect((await until(b, "move")).roomCode).toBe(roomCode);

    const stranger = connect(ORIGIN, `/v1/rooms/arena/${roomCode}`, at);
    await stranger.open;
    stranger.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("c") });
    expect(await stranger.next()).toMatchObject({ type: "error", code: "room_closed" });
    const m = connect(ORIGIN, `/v1/rooms/arena/${roomCode}`, at);
    await m.open;
    m.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a"), joinData: { character: "knight" } });
    expect(await until(m, "message")).toEqual({ type: "message", data: { setupData: { map: "Docks" }, brought: { a: { character: "knight" } } }, fromPlayerId: null });
    for (const c of [a, b, m]) c.ws.close();
    await own.close();
  });

  it("moves players to another room that's running, which gets the join data and can say no", async () => {
    const world = defineGameServer({
      setup: () => ({}),
      onJoin(_s, p, room, joinData, joinInfo) {
        if (joinInfo.fromRoomCode) room.send(p.id, { arrived: joinData, fromRoomCode: joinInfo.fromRoomCode });
      },
      onMessage(_s, p, room, message) {
        room.moveTo(String(message), { playerIds: [p.id], joinData: { door: "north" } });
      },
      onMoved(_s, moveResult, room) {
        for (const refusal of moveResult.refusals) room.send(refusal.player.id, { stayed: refusal.code });
      },
    });
    const { own, at } = await serve(world);
    const forest = connect(ORIGIN, "/v1/rooms/arena/FRSTAA", at);
    const town = connect(ORIGIN, "/v1/rooms/arena/TWNAAA", at);
    await Promise.all([forest.open, town.open]);
    forest.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("f") });
    await until(forest, "welcome");
    town.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") });
    await until(town, "welcome");

    town.say({ type: "message", data: "ZZZZZZ" });
    expect(await until(town, "message")).toEqual({ type: "message", data: { stayed: "room_not_running" }, fromPlayerId: null });
    town.say({ type: "message", data: "FRSTAA" });
    expect(await until(town, "move")).toEqual({ type: "move", roomCode: "FRSTAA" });

    const moved = connect(ORIGIN, "/v1/rooms/arena/FRSTAA", at);
    await moved.open;
    moved.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a"), joinData: { door: "cheat" } });
    expect(await until(moved, "message")).toEqual({ type: "message", data: { arrived: { door: "north" }, fromRoomCode: "TWNAAA" }, fromPlayerId: null });
    for (const c of [forest, town, moved]) c.ws.close();
    await own.close();
  });

  it("answers pings, takes players who walk away out of the match with their seat held, and lets them back", async () => {
    const duel = defineGameServer({
      maximumPlayerCount: 2,
      setup: () => ({}),
      onJoin(_s, p, room, _joinData, joinInfo) {
        room.broadcast({ joined: p.id, isReturning: joinInfo.isReturning });
      },
      onLeave(_s, p, room, leaveInfo) {
        room.broadcast({ left: p.id, reason: leaveInfo.reason });
      },
    });
    const { own, at } = await serve(duel);
    const a = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    const b = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    await Promise.all([a.open, b.open]);
    a.ws.send("ping");
    expect(await a.next()).toEqual({ type: "pong" });
    a.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") });
    expect((await until(a, "welcome")).awayChecks).toEqual({ idleTimeoutSec: 600, hiddenTimeoutSec: null });
    b.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("b") });
    await until(b, "welcome");

    b.say({ type: "idle" });
    expect(await until(b, "away")).toEqual({ type: "away", awayReason: "idle", seatHoldDurationSec: 300 });
    expect((await until(a, "message")).data).toEqual({ joined: "a", isReturning: false });
    expect((await until(a, "message")).data).toEqual({ joined: "b", isReturning: false });
    expect((await until(a, "message")).data).toEqual({ left: "b", reason: "idle" });
    // The held seat keeps the room full.
    const c = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    await c.open;
    c.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("c") });
    expect(await c.next()).toMatchObject({ type: "error", code: "room_full" });

    b.say({ type: "back" });
    await until(b, "welcome");
    expect((await until(a, "message")).data).toEqual({ joined: "b", isReturning: true });
    for (const x of [a, b]) x.ws.close();
    await own.close();
  });
  it("keeps a player whose connection dropped in the match until they're back, and takes them out at the next sweep once their time runs out", async () => {
    const duel = defineGameServer({
      maximumPlayerCount: 2,
      reconnectTimeoutSec: 1,
      setup: () => ({}),
      onAway: (_s, p, room, awayInfo) => room.broadcast({ away: p.id, reason: awayInfo.reason, awayReason: room.awayReason(p.id) }),
      onBack: (_s, p, room) => room.broadcast({ back: p.id }),
      onLeave: (_s, p, room, leaveInfo) => room.broadcast({ left: p.id, reason: leaveInfo.reason }),
    });
    const { own, at } = await serve(duel);
    const a = connect(ORIGIN, "/v1/rooms/arena/DRPNDE", at);
    await a.open;
    a.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") });
    await until(a, "welcome");
    const bPass = await pass("b");
    const b = connect(ORIGIN, "/v1/rooms/arena/DRPNDE", at);
    await b.open;
    b.say({ type: "hello", protocolVersionNumber: 1, pass: bPass });
    await until(b, "welcome");

    // b's connection drops: a's game sees them reconnecting, and the game server hears it.
    b.ws.terminate();
    expect((await until(a, "message")).data).toEqual({ away: "b", reason: "lost", awayReason: "lost" });
    expect((await until(a, "players")).players.map((p: any) => [p.id, p.awayReason])).toEqual([["a", null], ["b", "lost"]]);
    const again = connect(ORIGIN, "/v1/rooms/arena/DRPNDE", at);
    await again.open;
    again.say({ type: "hello", protocolVersionNumber: 1, pass: bPass });
    await until(again, "welcome");
    expect((await until(a, "message")).data).toEqual({ back: "b" });

    // Dropped again and not back: within the 5-second sweep after their second runs out, they leave the match.
    const droppedAtMs = Date.now();
    again.ws.terminate();
    expect((await until(a, "message")).data).toEqual({ away: "b", reason: "lost", awayReason: "lost" });
    expect((await until(a, "message")).data).toEqual({ left: "b", reason: "lost" });
    expect(Date.now() - droppedAtMs).toBeLessThan(7000);
    a.ws.close();
    await own.close();
  }, 10_000);
});

describe("Chat in the Node runner's rooms", () => {
  it("delivers room.chat to those who may read it, after onChat and Zaisma's filter (checkChat)", async () => {
    // Zaisma's chat check, as checkChat calls it: it stops "snap" and says what it was sent.
    const checked: Record<string, unknown>[] = [];
    const zaisma = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const asked = JSON.parse(body);
        checked.push(asked);
        const isStopped = String(asked.text).includes("snap");
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ isAllowed: !isStopped, reason: isStopped ? "contact_details" : null, message: isStopped ? "Contact details can't be sent here." : null, hasSwearing: false, hasSlur: false }));
      });
    });
    await new Promise<void>((r) => zaisma.listen(0, r));
    onTestFinished(() => void zaisma.close());
    const issuerUrl = `http://localhost:${(zaisma.address() as { port: number }).port}`;
    const talker = defineGameServer({ setup: () => ({}), onChat: (_state, _player, _room, chatInfo) => chatInfo.text !== "stop" });
    const own = startServer({ gameServer: talker, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl, loadPassKeys: async () => [signing.publicKey], roomStateFile: null, loadProfile: async (playerId: string) => ({ id: playerId, name: playerId.slice(7) }) });
    await new Promise((r) => own.httpServer.once("listening", r));
    onTestFinished(() => void own.close());
    const at = (own.httpServer.address() as { port: number }).port;
    const nowSec = Math.floor(Date.now() / 1000);
    const passes: Record<string, string> = {};
    const enter = async (sub: string, claims: Record<string, unknown>) => {
      passes[sub] = await signPass(signing, { sub, aud: "arena", iss: issuerUrl, pass_version_number: 1, iat: nowSec, exp: nowSec + 60, ...claims } as never);
      const client = connect(ORIGIN, "/v1/rooms/arena/CHATRM", at);
      await client.open;
      client.say({ type: "hello", protocolVersionNumber: 1, pass: passes[sub] });
      const welcome = await client.next();
      expect(welcome.type).toBe("welcome");
      return { ...client, welcome };
    };
    const ana = await enter("player_ana", { kind: "account", who_can_chat: "anyone", chat_group_id: "chat_group_a" });
    const ben = await enter("player_ben", { kind: "account", who_can_chat: "anyone", chat_group_id: "chat_group_a" });
    const tom = await enter("player_tom", { kind: "account", who_can_chat: "anyone", chat_group_id: "chat_group_b" });
    const guest = await enter("player_guest", { kind: "guest", name: "Swift Fox 42" });
    expect([ana.welcome.canChat, guest.welcome.canChat]).toEqual([true, false]);
    let chatNumber = 0;
    const chat = async (client: typeof ana, text: string) => {
      const number = ++chatNumber;
      client.say({ type: "chat", chatNumber: number, text });
      for (;;) {
        const message = await client.next();
        if (message.chatNumber === number) return message;
      }
    };

    // Ben, in Ana's chat group, reads her; Tom, in another, never does; Zaisma checked it with Ben's pass alone.
    expect(await chat(ana, "good game")).toMatchObject({ type: "chat_sent" });
    expect(await until(ben, "chat")).toMatchObject({ fromPlayerId: "player_ana", text: "good game", hasSwearing: false, hasSlur: false });
    expect(checked.at(-1)).toMatchObject({ gameSlug: "arena", senderPass: passes.player_ana, receiverPasses: [passes.player_ben], text: "good game", isAdultFilterEnabled: false });
    expect(await chat(ana, "add me on snap")).toMatchObject({ type: "chat_stopped", reason: "contact_details", message: "Contact details can't be sent here." });
    expect(await chat(ana, "stop")).toMatchObject({ type: "chat_stopped", reason: "stopped_by_game" });
    expect(await chat(guest, "hi")).toMatchObject({ type: "error", code: "chat_not_allowed" });
    // Tom alone in his group: it went, to nobody, and Zaisma wasn't asked.
    const checkCount = checked.length;
    expect(await chat(tom, "anyone?")).toMatchObject({ type: "chat_sent" });
    expect(checked).toHaveLength(checkCount);
    // Nothing of Ana's ever reached Tom or the guest.
    const nothingIn = (client: typeof ana) => Promise.race([until(client, "chat"), new Promise((r) => setTimeout(() => r(null), 150))]);
    expect([await nothingIn(tom), await nothingIn(guest)]).toEqual([null, null]);
    for (const client of [ana, ben, tom, guest]) client.ws.close();
  });
});

describe("The Node runner, for the fullest pass Zaisma makes", () => {
  /** An account owning every one of a game's 1,000 items with 40-character names, with 200 friends and 100 blocks. */
  async function fullestPass() {
    const now = Math.floor(Date.now() / 1000);
    const tag = (i: number) => `player_tag_${i.toString(16).padStart(20, "0")}`;
    return signPass(signing, {
      sub: "player_collector",
      aud: "arena",
      iss: ISS,
      pass_version_number: 1,
      kind: "account",
      who_can_chat: "anyone",
      chat_group_id: "chat_group_0123456789abcdef0123",
      player_tag_id: tag(0),
      friend_player_tag_ids: Array.from({ length: 200 }, (_, i) => tag(i + 1)),
      block_player_tag_ids: Array.from({ length: 100 }, (_, i) => tag(i + 500)),
      owned_item_names: Array.from({ length: 1000 }, (_, i) => `skin_${String(i).padStart(4, "0")}_`.padEnd(40, "x")),
      iat: now,
      exp: now + 600,
    });
  }
  const wardrobe = defineGameServer({
    maximumPlayerCount: 4,
    setup: () => ({}),
    onJoin: (_state: unknown, player: { id: string; ownedItemNames?: string[] }, room: { send(playerId: string, data: unknown): void }) => room.send(player.id, { ownedItemCount: (player.ownedItemNames ?? []).length }),
    onRequest: (player: { ownedItemNames?: string[] }) => ({ ownedItemCount: (player.ownedItemNames ?? []).length }),
  });
  async function serveWardrobe() {
    const own = startServer({ gameServer: wardrobe, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null, loadProfile: async (playerId: string) => ({ id: playerId, name: "Emma_Clarke" }) });
    await new Promise((r) => own.httpServer.once("listening", r));
    return { own, at: (own.httpServer.address() as { port: number }).port };
  }

  it("answers onRequest with every item it owns", async () => {
    const { own, at } = await serveWardrobe();
    const response = await fetch(`http://localhost:${at}/v1/requests/arena`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain" }, body: JSON.stringify({ pass: await fullestPass(), request: { type: "wardrobe" } }) });
    expect({ httpStatus: response.status, body: await response.json() }).toEqual({ httpStatus: 200, body: { answer: { ownedItemCount: 1000 } } });
    await own.close();
  });

  it("lets it into a room as Zaisma rooms do, and answers too_big for joinData over 4 KB with it", async () => {
    const { own, at } = await serveWardrobe();
    const pass = await fullestPass();
    const joining = connect(ORIGIN, "/v1/rooms/arena/WRDRBE", at);
    await joining.open;
    joining.say({ type: "hello", protocolVersionNumber: 1, pass, joinData: { outfit: "x".repeat(4000) } });
    expect(await until(joining, "message")).toEqual({ type: "message", data: { ownedItemCount: 1000 }, fromPlayerId: null });
    joining.ws.close();
    const tooMuch = connect(ORIGIN, "/v1/rooms/arena/WRDRBF", at);
    await tooMuch.open;
    tooMuch.say({ type: "hello", protocolVersionNumber: 1, pass, joinData: { outfit: "x".repeat(5000) } });
    expect(await until(tooMuch, "error")).toMatchObject({ code: "too_big" });
    await own.close();
  });
});

describe("Kept rooms on the developer's own server", () => {
  const DAY_MS = 24 * 3600 * 1000;
  const roomStateFile = () => join(temporaryFolder("zaisma-kept-rooms-"), "rooms.sqlite");
  const savedRoom = (isKept: boolean) => ({ isListed: true, isOpen: true, friendJoinsEnabled: true, name: null, labels: {}, ...(isKept ? { isKept: true } : {}) });

  it("sleeps with its state when everyone leaves, outlives the daily sweep, wakes having lost nothing, and goes when it ends", async () => {
    const file = roomStateFile();
    const world = defineGameServer({
      ticksPerSec: 50,
      stateSaveIntervalSec: 1,
      setup: () => ({ stoneCount: 0, restored: null as unknown }),
      onTick: () => {},
      onJoin: (_state, _player, room) => room.setKept(true),
      onRestored: (state, restoreInfo) => void (state.restored = restoreInfo),
      onMessage(state, player, room, message) {
        if (message === "build") state.stoneCount++;
        if (message === "end") return room.end("The world is gone.");
        room.send(player.id, { stoneCount: state.stoneCount, restored: state.restored, isKept: room.isKept, roomCode: room.roomCode });
      },
    });
    const start = async () => {
      const own = startServer({ gameServer: world, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: file });
      await new Promise((r) => own.httpServer.once("listening", r));
      return { own, at: (own.httpServer.address() as { port: number }).port };
    };

    const first = await start();
    const olivia = connect(ORIGIN, "/v1/rooms/arena/KEPTWD", first.at);
    await olivia.open;
    olivia.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("olivia") });
    await until(olivia, "welcome");
    for (const _ of [1, 2, 3]) olivia.say({ type: "message", data: "build" });
    // The game server knows which room it's in, as in Zaisma rooms.
    expect((await until(olivia, "message")).data).toMatchObject({ stoneCount: 1, isKept: true, roomCode: "KEPTWD" });
    await until(olivia, "message");
    expect((await until(olivia, "message")).data).toMatchObject({ stoneCount: 3 });
    // She leaves, so the room empties and sleeps, saved as it emptied.
    olivia.ws.close(1000);
    await olivia.closed;
    await new Promise((r) => setTimeout(r, 50));
    await first.own.close();
    const asLeft = localRoomStates(file).read("KEPTWD");
    expect(asLeft).toMatchObject({ isSavedEmpty: true, matchPlayers: [], savedRoom: { isKept: true } });
    expect(JSON.parse(asLeft.stateJson).stoneCount).toBe(3);

    // Three days later the daily sweep of states older than a day passes it by.
    const savedAtMs = Date.now() - 3 * DAY_MS;
    const sqlite = new DatabaseSync(file);
    sqlite.prepare("UPDATE room_states SET saved_at_ms = ? WHERE room_code = ?").run(savedAtMs, "KEPTWD");
    sqlite.close();
    localRoomStates(file).removeOlder(Date.now() - DAY_MS, []);
    expect(localRoomStates(file).read("KEPTWD")).toMatchObject({ savedAtMs, isSavedEmpty: true });

    // Someone joins and it wakes as it was, having lost nothing in its sleep.
    const second = await start();
    const noah = connect(ORIGIN, "/v1/rooms/arena/KEPTWD", second.at);
    await noah.open;
    noah.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("noah") });
    await until(noah, "welcome");
    noah.say({ type: "message", data: "how" });
    expect((await until(noah, "message")).data).toEqual({ stoneCount: 3, restored: { savedAt: new Date(savedAtMs).toISOString(), lostDurationSec: 0, savedVersionId: null }, isKept: true, roomCode: "KEPTWD" });

    // room.end() ends it for good: its saved state goes.
    noah.say({ type: "message", data: "end" });
    await noah.closed;
    for (let tryCount = 0; tryCount < 50 && localRoomStates(file).read("KEPTWD"); tryCount++) await new Promise((r) => setTimeout(r, 20));
    expect(localRoomStates(file).read("KEPTWD")).toBeNull();
    await second.own.close();
  });

  it("deletes ordinary rooms' states older than a day and keeps kept rooms' and newer ones", () => {
    const states = localRoomStates(roomStateFile());
    const oldMs = Date.now() - 2 * DAY_MS;
    states.write("KEPTAA", { stateJson: "{}", matchPlayers: [], savedRoom: savedRoom(true), savedAtMs: oldMs, isSavedEmpty: true });
    states.write("PLAINA", { stateJson: "{}", matchPlayers: [], savedRoom: savedRoom(false), savedAtMs: oldMs, isSavedEmpty: true });
    states.write("FRESHA", { stateJson: "{}", matchPlayers: [], savedRoom: savedRoom(false), savedAtMs: Date.now() });
    states.write("RUNNIN", { stateJson: "{}", matchPlayers: [], savedRoom: savedRoom(false), savedAtMs: oldMs });
    states.removeOlder(Date.now() - DAY_MS, ["RUNNIN"]);
    expect(states.read("KEPTAA")).toMatchObject({ savedAtMs: oldMs, isSavedEmpty: true, savedRoom: { isKept: true } });
    expect(states.read("PLAINA")).toBeNull();
    expect(states.read("FRESHA")).toMatchObject({ isSavedEmpty: false });
    expect(states.read("RUNNIN")).not.toBeNull();
    // markEmpty: a state unchanged since its last save now counts as saved as the room emptied, with the room as it is.
    states.markEmpty("FRESHA", savedRoom(true), []);
    expect(states.read("FRESHA")).toMatchObject({ isSavedEmpty: true, savedRoom: { isKept: true } });
  });

  it("drops the room states of an older runner, with a log line, and starts a file in the current format", () => {
    const file = roomStateFile();
    const older = new DatabaseSync(file);
    older.exec("CREATE TABLE room_states (room_code TEXT PRIMARY KEY, state_json TEXT NOT NULL, match_players_json TEXT NOT NULL, saved_room_json TEXT NOT NULL, saved_at_ms INTEGER NOT NULL)");
    older.prepare("INSERT INTO room_states VALUES (?, ?, ?, ?, ?)").run("OLDERA", '{"laps":7}', "[]", JSON.stringify(savedRoom(false)), 1_760_000_000_000);
    older.close();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => void warn.mockRestore());
    const states = localRoomStates(file);
    expect(states.read("OLDERA")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Saved room states from an older runner were dropped; rooms start fresh.");
    states.write("NEWERA", { stateJson: '{"laps":8}', matchPlayers: [], savedRoom: savedRoom(true), savedAtMs: 1_760_000_001_000, isSavedEmpty: true });
    const check = new DatabaseSync(file);
    expect(check.prepare("SELECT name FROM pragma_table_info('room_states')").all().map((column) => (column as { name: string }).name)).toEqual(["room_code", "format_version", "state_json", "saved_room_json", "saved_at_ms", "is_saved_empty", "is_kept"]);
    expect(check.prepare("SELECT format_version, is_kept FROM room_states").all()).toEqual([{ format_version: 1, is_kept: 1 }]);
    check.close();
    // Opened again in the same format, it keeps its rooms and says nothing.
    expect(localRoomStates(file).read("NEWERA")).toMatchObject({ stateJson: '{"laps":8}', isSavedEmpty: true });
    expect(warn).toHaveBeenCalledTimes(1);
    // A file saved in another format_version is dropped too.
    const other = new DatabaseSync(file);
    other.exec("UPDATE room_states SET format_version = 2");
    other.close();
    expect(localRoomStates(file).read("NEWERA")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("saves a room as snake_case and reads back everything a restore needs", () => {
    const file = roomStateFile();
    const states = localRoomStates(file);
    const mia = { id: "player_mia", name: "Mia", kind: "account", ownedItemNames: ["skin_red-dragon"] };
    const kit = { id: "player_lucas", name: "Lucas", kind: "guest" };
    const room = {
      isListed: false,
      isOpen: false,
      friendJoinsEnabled: false,
      name: "Docks",
      labels: { mapName: "docks" },
      knownPlayerIds: ["player_mia", "player_lucas"],
      setupData: { mapName: "docks", nested: { stoneCount: 3 } },
      keptOut: { player_emma: "banned" },
      expected: { player_noah: { joinData: { team: "red" }, fromRoomCode: "ABCDEF", untilMs: 1_760_000_060_000 } },
      held: { player_mia: { player: mia, reason: "lost", untilMs: 1_760_000_030_000 } },
      kept: { player_lucas: "idle" },
      reconnecting: { player_lucas: { player: kit, untilMs: 1_760_000_020_000 } },
      lobbyRoomCode: "LOBBYX",
      endsAt: "2026-10-24T12:00:00.000Z",
      accountBlocks: [["player_mia", "player_lucas"]],
      sessionBlocks: [["player_mia", "player_lucas"]],
      friendships: [["player_mia", "player_lucas"]],
      isKept: true,
    };
    states.write("SNAKEA", { stateJson: '{"stoneCount":3}', matchPlayers: [mia, kit], savedRoom: room, savedAtMs: 1_760_000_000_000, isSavedEmpty: false });
    const check = new DatabaseSync(file);
    const stored = JSON.parse((check.prepare("SELECT saved_room_json FROM room_states").get() as { saved_room_json: string }).saved_room_json);
    check.close();
    expect(Object.keys(stored).sort()).toEqual(["account_blocks", "ends_at_ms", "expected", "friend_joins_enabled", "friendships", "held", "is_listed", "is_open", "kept", "kept_out", "known_player_ids", "labels", "lobby_room_code", "match_players", "name", "reconnecting", "session_blocks", "setup_data"]);
    expect(stored.expected.player_noah).toEqual({ join_data: { team: "red" }, from_room_code: "ABCDEF", until_ms: 1_760_000_060_000 });
    expect(stored.held.player_mia).toEqual({ player: { id: "player_mia", name: "Mia", kind: "account", owned_item_names: ["skin_red-dragon"] }, reason: "lost", until_ms: 1_760_000_030_000 });
    // The game's own data keeps its own names.
    expect(stored.setup_data).toEqual({ mapName: "docks", nested: { stoneCount: 3 } });
    expect(stored.labels).toEqual({ mapName: "docks" });
    expect(localRoomStates(file).read("SNAKEA")).toEqual({ stateJson: '{"stoneCount":3}', matchPlayers: [mia, kit], savedRoom: room, savedAtMs: 1_760_000_000_000, isSavedEmpty: false });
  });
});

describe("The v1 room contract on the Node runner", () => {
  const hello = async (sub: string) => ({ type: "hello", protocolVersionNumber: 1, pass: await pass(sub) });

  it("turns away a first message that isn't a hello with no_hello, three ways, and closes with 4001", async () => {
    const message = connect();
    await message.open;
    message.say({ type: "message", data: 1 });
    expect(await message.next()).toEqual({ type: "error", code: "no_hello", message: ERROR_TEXT.no_hello });
    expect(await message.closed).toBe(4001);

    // A hello whose pass isn't a string.
    const numberPass = connect();
    await numberPass.open;
    numberPass.say({ type: "hello", protocolVersionNumber: 1, pass: 12345 });
    expect(await numberPass.next()).toEqual({ type: "error", code: "no_hello", message: ERROR_TEXT.no_hello });
    expect(await numberPass.closed).toBe(4001);

    // A hello as a binary frame: bytes only come after it.
    const binary = connect();
    await binary.open;
    binary.ws.send(new TextEncoder().encode(JSON.stringify(await hello("binary"))));
    expect(await binary.next()).toEqual({ type: "error", code: "no_hello", message: ERROR_TEXT.no_hello });
    expect(await binary.closed).toBe(4001);
  });

  it("turns away the player past maximumPlayerCount with room_full and 4001, and takes a newcomer once a seat is free", async () => {
    const { own, at } = await serve(defineGameServer({ maximumPlayerCount: 2, setup: () => ({}) }));
    const path = "/v1/rooms/arena/FULLAA";
    const [a, b, c] = [connect(ORIGIN, path, at), connect(ORIGIN, path, at), connect(ORIGIN, path, at)];
    await Promise.all([a.open, b.open, c.open]);
    a.say(await hello("a"));
    await until(a, "welcome");
    b.say(await hello("b"));
    await until(b, "welcome");
    c.say(await hello("c"));
    expect(await c.next()).toEqual({ type: "error", code: "room_full", message: ERROR_TEXT.room_full });
    expect(await c.closed).toBe(4001);
    b.ws.close(1000);
    await b.closed;
    // The seat is held for no one once b has left on purpose.
    const d = connect(ORIGIN, path, at);
    await d.open;
    d.say(await hello("d"));
    expect((await until(d, "welcome")).type).toBe("welcome");
    a.ws.close();
    d.ws.close();
    await own.close();
  });

  it("drops a reserved room nobody joins after 10 minutes, on a fake clock", async () => {
    const lobby = defineGameServer({ setup: () => ({}), onMessage: (_state, player, room, _message) => room.reserve({ playerIds: [player.id], setupData: null }) });
    const { own, at } = await serve(lobby);
    const a = connect(ORIGIN, "/v1/rooms/arena/RSRVDX", at);
    await a.open;
    a.say(await hello("a"));
    await until(a, "welcome");
    // Only timers are faked, from here: sockets keep running on real time.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => void vi.useRealTimers());
    a.say({ type: "message", data: "reserve" });
    const { roomCode } = await until(a, "move");
    // It waits for its players, closed to everyone else, until the 10 minutes are up.
    const early = connect(ORIGIN, `/v1/rooms/arena/${roomCode}`, at);
    await early.open;
    early.say(await hello("b"));
    expect(await until(early, "error")).toMatchObject({ code: "room_closed" });
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    const late = connect(ORIGIN, `/v1/rooms/arena/${roomCode}`, at);
    await late.open;
    late.say(await hello("b"));
    expect(await until(late, "error")).toMatchObject({ code: "room_closed" });
    vi.advanceTimersByTime(1);
    // Dropped: the same code is a new room again, which takes anyone.
    const after = connect(ORIGIN, `/v1/rooms/arena/${roomCode}`, at);
    await after.open;
    after.say(await hello("b"));
    expect((await until(after, "welcome")).type).toBe("welcome");
    vi.useRealTimers();
    after.ws.close();
    a.ws.close();
    await own.close();
  });

  it("tells everyone the match ended with endReason game when the game ends it, with its message or the default, and closes with 4000", async () => {
    const game = defineGameServer({ setup: () => ({}), onMessage: (_state, _player, room, message) => (message === "end with message" ? room.end("Good game.") : room.end()) });
    for (const [said, endMessage] of [["end with message", "Good game."], ["end", "The match is over."]] as const) {
      const { own, at } = await serve(game);
      const [a, b] = [connect(ORIGIN, "/v1/rooms/arena/ENDAAA", at), connect(ORIGIN, "/v1/rooms/arena/ENDAAA", at)];
      await Promise.all([a.open, b.open]);
      a.say(await hello("a"));
      await until(a, "welcome");
      b.say(await hello("b"));
      await until(b, "welcome");
      a.say({ type: "message", data: said });
      expect(await until(a, "ended")).toEqual({ type: "ended", message: endMessage, endReason: "game" });
      expect(await until(b, "ended")).toEqual({ type: "ended", message: endMessage, endReason: "game" });
      expect([await a.closed, await b.closed]).toEqual([4000, 4000]);
      await own.close();
    }
  });

  it("plays the v1 rooms transcript, field for field", async () => {
    const { own, at } = await serve(defineGameServer(transcriptGameServerOptions() as never));
    const driver: TranscriptDriver = {
      runtime: "node",
      newPlayer: async (label) => {
        const playerId = `player_transcript_${label}`;
        return { playerId, name: playerId.toUpperCase(), pass: await pass(playerId) };
      },
      connect: async (how, roomCode) => {
        const client = how === "other_site" ? connect("https://evil.example", `/v1/rooms/arena/${roomCode}`, at) : connect(ORIGIN, `/v1/rooms/${how === "unknown_game" ? "other-game" : "arena"}/${roomCode}`, at);
        await client.open;
        return { send: (data) => client.ws.send(data), next: client.next, closed: client.closed, close: (code) => client.ws.close(code) };
      },
      action: async (action) => {
        throw new Error(`The Node runner can't ${action}`);
      },
    };
    const { stepCount } = await playTranscript(driver);
    expect(stepCount).toBeGreaterThan(20);
    await own.close();
  });
});

describe("onPurchase and onRefund on the developer's own server", () => {
  const receiptSigning = (async () => loadSigningKey(await generateSigningKey()))();
  const PLAYER_ID = "player_owl";

  /** The developer API as the runner calls it: the game's purchase_delivery, a player's unhandled purchases, and marking one handled. */
  async function fakeDeveloperApi(purchaseDelivery: string, purchases: Record<string, unknown>[]) {
    const calls: string[] = [];
    const handled = new Set<string>();
    const api = createServer((request, response) => {
      const route = `${request.method} ${request.url}`;
      calls.push(`${route} ${request.headers.authorization}`);
      const answer = (httpStatus: number, body: unknown) => {
        response.writeHead(httpStatus, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (route === "GET /games/arena/items") return answer(200, { purchase_delivery: purchaseDelivery });
      if (route === `GET /games/arena/players/${PLAYER_ID}/items`) return answer(200, { player_id: PLAYER_ID, owned_item_names: [], unhandled_purchases: purchases.filter((purchase) => !handled.has(purchase.id as string)) });
      const marking = /^POST \/games\/arena\/purchases\/([a-z0-9_]+)\/handled$/.exec(route);
      if (marking) {
        if (handled.has(marking[1]!)) return answer(409, { error: { code: "already_handled", message: "It was marked handled already.", fix: "Nothing to do." } });
        handled.add(marking[1]!);
        return answer(200, { is_handled: true });
      }
      answer(404, { error: { code: "not_found", message: route, fix: "Check the path." } });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => void api.close());
    return { calls, handled, purchases, developerApiUrl: `http://127.0.0.1:${(api.address() as { port: number }).port}` };
  }

  const storedPurchase = (id: string, fields: Record<string, unknown> = {}) => ({
    id, item_name: "revive", item_kind: "consumable", item_count: 3, purchase_source: "sale", purchase_status: "completed", game_account_id: null,
    paid_minor_units: 199, currency_code: "usd", purchased_at: "2026-10-24T10:00:00.000Z", refunded_at: null, receipt: `receipt_${id}`, ...fields,
  });

  type TakenState = { got: Purchase[]; refunded: string[] };
  const taker = (hooks: Record<string, unknown> = {}) =>
    defineGameServer({
      maximumPlayerCount: 4,
      setup: (): TakenState => ({ got: [], refunded: [] }),
      onPurchase: (state: TakenState, player: { id: string }, room: { send(playerId: string, data: unknown): void }, purchase: Purchase) => {
        state.got.push(purchase);
        room.send(player.id, { bought: purchase.id, itemName: purchase.itemName, itemCount: purchase.itemCount });
      },
      onRefund: (state: TakenState, player: { id: string }, room: { send(playerId: string, data: unknown): void }, purchase: Purchase) => {
        state.refunded.push(purchase.id as string);
        room.send(player.id, { refunded: purchase.id, purchaseStatus: purchase.purchaseStatus });
      },
      ...hooks,
    });

  async function serveWithKey(gameServer: object, developerApiUrl: string, options: Record<string, unknown> = {}) {
    const own = startServer({ gameServer, gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], loadReceiptKeys: async () => [(await receiptSigning).publicKey], roomStateFile: null, loadProfile: async () => ({ name: "Gold_Owl" }), zaismaKey: "zk_test_key", developerApiUrl, ...options });
    await new Promise((resolve) => own.httpServer.once("listening", resolve));
    onTestFinished(() => void own.close());
    return { own, at: (own.httpServer.address() as { port: number }).port };
  }

  async function joinAsAccount(at: number) {
    const nowSec = Math.floor(Date.now() / 1000);
    const client = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await client.open;
    client.say({ type: "hello", protocolVersionNumber: 1, pass: await signPass(signing, { sub: PLAYER_ID, aud: "arena", iss: ISS, pass_version_number: 1, kind: "account", iat: nowSec, exp: nowSec + 60 }) });
    expect((await client.next()).type).toBe("welcome");
    onTestFinished(() => client.ws.close());
    return client;
  }

  const eventually = async (isTrue: () => boolean) => {
    for (let attempt = 0; attempt < 100 && !isTrue(); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isTrue()).toBe(true);
  };

  it("won't start with onPurchase or onRefund and no ZAISMA_KEY", () => {
    vi.stubEnv("ZAISMA_KEY", "");
    onTestFinished(() => void vi.unstubAllEnvs());
    const options = { gameSlug: "arena", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [], roomStateFile: null };
    expect(() => startServer({ ...options, gameServer: taker() })).toThrow(/onPurchase needs zaismaKey/);
    expect(() => startServer({ ...options, gameServer: defineGameServer({ setup: () => ({}), onRefund: () => undefined }) })).toThrow(/onRefund needs zaismaKey/);
    // A game server without them needs no key.
    const plain = startServer({ ...options, gameServer: relay });
    plain.close();
  });

  it("takes the key from the environment too", async () => {
    vi.stubEnv("ZAISMA_KEY", "zk_from_environment");
    onTestFinished(() => void vi.unstubAllEnvs());
    const api = await fakeDeveloperApi("game_server", [storedPurchase("purchase_owl1")]);
    const { at } = await serveWithKey(taker(), api.developerApiUrl, { zaismaKey: undefined });
    const client = await joinAsAccount(at);
    expect(await until(client, "message")).toMatchObject({ data: { bought: "purchase_owl1" } });
    expect(api.calls.every((call) => call.endsWith("Bearer zk_from_environment"))).toBe(true);
  });

  it("hands an account's purchase to onPurchase once, with the developer API's fields in camelCase, and marks it handled", async () => {
    const api = await fakeDeveloperApi("game_server", [storedPurchase("purchase_owl1")]);
    const state: TakenState = { got: [], refunded: [] };
    const { at } = await serveWithKey(taker({ setup: () => state }), api.developerApiUrl);
    const client = await joinAsAccount(at);
    expect(await until(client, "message")).toEqual({ type: "message", data: { bought: "purchase_owl1", itemName: "revive", itemCount: 3 }, fromPlayerId: null });
    await eventually(() => api.handled.has("purchase_owl1"));
    expect(state.got).toEqual([{ id: "purchase_owl1", itemName: "revive", itemKind: "consumable", itemCount: 3, purchaseSource: "sale", purchaseStatus: "completed", gameAccountId: null, paidMinorUnits: 199, currencyCode: "usd", purchasedAt: "2026-10-24T10:00:00.000Z", refundedAt: null, receipt: "receipt_purchase_owl1" }]);
    expect(api.calls.filter((call) => call.startsWith("POST ")).map((call) => call.split(" ")[1])).toEqual(["/games/arena/purchases/purchase_owl1/handled"]);
    expect(api.calls.every((call) => call.endsWith("Bearer zk_test_key"))).toBe(true);

    // A rejoin finds it handled, and the game_server setting is cached, so the server only asks for the player's items again.
    client.ws.close();
    await client.closed;
    const again = await joinAsAccount(at);
    again.say({ type: "message", data: "ping" });
    await eventually(() => api.calls.filter((call) => call.startsWith(`GET /games/arena/players/${PLAYER_ID}/items`)).length === 2);
    expect(state.got).toHaveLength(1);
    expect(api.calls.filter((call) => call.startsWith("GET /games/arena/items "))).toHaveLength(1);
    expect(api.calls.filter((call) => call.startsWith("POST "))).toHaveLength(1);
  });

  it("hands a refund to onRefund, not onPurchase", async () => {
    const api = await fakeDeveloperApi("game_server", [storedPurchase("purchase_owl1", { purchase_status: "refunded", refunded_at: "2026-10-24T11:00:00.000Z" })]);
    const state: TakenState = { got: [], refunded: [] };
    const { at } = await serveWithKey(taker({ setup: () => state }), api.developerApiUrl);
    const client = await joinAsAccount(at);
    expect(await until(client, "message")).toEqual({ type: "message", data: { refunded: "purchase_owl1", purchaseStatus: "refunded" }, fromPlayerId: null });
    await eventually(() => api.handled.has("purchase_owl1"));
    expect(state.got).toEqual([]);
    expect(state.refunded).toEqual(["purchase_owl1"]);
  });

  it("marks a purchase handled even when Zaisma answers that it already was", async () => {
    const api = await fakeDeveloperApi("game_server", [storedPurchase("purchase_owl1")]);
    // Another server of the same game marks it just before this one does.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => void errors.mockRestore());
    const { at } = await serveWithKey(taker({ onPurchase: (_state: TakenState, player: { id: string }, room: { send(playerId: string, data: unknown): void }, purchase: { id: string }) => {
      api.handled.add(purchase.id);
      room.send(player.id, { bought: purchase.id });
    } }), api.developerApiUrl);
    const client = await joinAsAccount(at);
    expect(await until(client, "message")).toMatchObject({ data: { bought: "purchase_owl1" } });
    await eventually(() => api.calls.some((call) => call.startsWith("POST ")));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(errors.mock.calls.filter(([line]) => String(line).includes("Couldn't hand purchases over"))).toEqual([]);
  });

  it("lets go of a purchase whose hook threw and hands it over on the player's next join", async () => {
    const api = await fakeDeveloperApi("game_server", [storedPurchase("purchase_owl1")]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => void errors.mockRestore());
    let isBroken = true;
    const { at } = await serveWithKey(taker({ onPurchase: (_state: TakenState, player: { id: string }, room: { send(playerId: string, data: unknown): void }, purchase: { id: string }) => {
      if (isBroken) throw new Error("revive bug");
      room.send(player.id, { bought: purchase.id });
    } }), api.developerApiUrl);
    const first = await joinAsAccount(at);
    await eventually(() => errors.mock.calls.some(([line, error]) => line === "Game server error:" && String(error).includes("revive bug")));
    expect(api.handled.size).toBe(0);
    expect(api.calls.filter((call) => call.startsWith("POST "))).toEqual([]);

    isBroken = false;
    first.ws.close();
    await first.closed;
    const second = await joinAsAccount(at);
    expect(await until(second, "message")).toMatchObject({ data: { bought: "purchase_owl1" } });
    await eventually(() => api.handled.has("purchase_owl1"));
  });

  it("hands a purchase over once after zaisma:purchase messages with a receipt that checks out, and ignores forged ones", async () => {
    const api = await fakeDeveloperApi("game_server", []);
    const state: TakenState = { got: [], refunded: [] };
    const { at } = await serveWithKey(taker({ setup: () => state }), api.developerApiUrl);
    const client = await joinAsAccount(at);
    const askedCount = () => api.calls.filter((call) => call.startsWith(`GET /games/arena/players/${PLAYER_ID}/items`)).length;
    await eventually(() => askedCount() === 1);

    // The player buys in their game after joining: Zaisma's record gains the purchase.
    api.purchases.push(storedPurchase("purchase_owl1"));
    // A receipt signed with another key, one for another player, and none at all: the server asks Zaisma for nothing.
    const otherKey = await loadSigningKey(await generateSigningKey());
    client.say({ type: "zaisma:purchase", purchaseId: "purchase_owl2", receipt: await signTestReceipt(otherKey, "arena", ISS, { sub: PLAYER_ID, purchase_id: "purchase_owl2" }) });
    client.say({ type: "zaisma:purchase", purchaseId: "purchase_owl3", receipt: await signTestReceipt(await receiptSigning, "arena", ISS, { sub: "player_someone_else", purchase_id: "purchase_owl3" }) });
    client.say({ type: "zaisma:purchase", purchaseId: "purchase_owl4" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(askedCount()).toBe(1);
    expect(state.got).toEqual([]);

    const receipt = await signTestReceipt(await receiptSigning, "arena", ISS, { sub: PLAYER_ID, purchase_id: "purchase_owl1" });
    client.say({ type: "zaisma:purchase", purchaseId: "purchase_owl1", receipt });
    client.say({ type: "zaisma:purchase", purchaseId: "purchase_owl1", receipt });
    expect(await until(client, "message")).toMatchObject({ data: { bought: "purchase_owl1" } });
    await eventually(() => api.handled.has("purchase_owl1"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(state.got).toHaveLength(1);
    expect(api.calls.filter((call) => call.startsWith("POST "))).toHaveLength(1);
  });

  it("hands nothing over when the game's purchase_delivery is game, and asks for no player's items", async () => {
    const api = await fakeDeveloperApi("game", [storedPurchase("purchase_owl1")]);
    const state: TakenState = { got: [], refunded: [] };
    const { at } = await serveWithKey(taker({ setup: () => state }), api.developerApiUrl);
    const client = await joinAsAccount(at);
    await eventually(() => api.calls.some((call) => call.startsWith("GET /games/arena/items ")));
    client.say({ type: "message", data: "ping" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(state.got).toEqual([]);
    expect(api.handled.size).toBe(0);
    expect(api.calls.some((call) => call.includes("/players/"))).toBe(false);
    expect(api.calls.some((call) => call.startsWith("POST "))).toBe(false);
  });

  it("hands guests nothing, without asking Zaisma", async () => {
    const api = await fakeDeveloperApi("game_server", [storedPurchase("purchase_owl1")]);
    const { at } = await serveWithKey(taker(), api.developerApiUrl);
    const nowSec = Math.floor(Date.now() / 1000);
    const guest = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await guest.open;
    guest.say({ type: "hello", protocolVersionNumber: 1, pass: await signPass(signing, { sub: PLAYER_ID, name: "Swift Fox 42", aud: "arena", iss: ISS, pass_version_number: 1, kind: "guest", iat: nowSec, exp: nowSec + 60 }) });
    expect((await guest.next()).type).toBe("welcome");
    onTestFinished(() => guest.ws.close());
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(api.calls).toEqual([]);
  });
});

// The fast lane's WebTransport server and its Node client are optional packages: without them, these cases can't run.
const FAST_LANE_PACKAGE = "@fails-components/webtransport";
const fastLanePackage = await import(FAST_LANE_PACKAGE).then(async (module) => (await module.quicheLoaded, module)).catch(() => null);

describe.skipIf(!fastLanePackage)(`The fast lane (WebTransport) on the Node runner${fastLanePackage ? "" : `, skipped: ${FAST_LANE_PACKAGE} and its HTTP/3 package aren't installed`}`, () => {
  /** A free UDP port, for the fast lane to listen on. */
  async function freeUdpPort(): Promise<number> {
    const socket = createSocket("udp4");
    await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
    const { port: udpPort } = socket.address();
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    return udpPort;
  }

  /** A runner with a fast lane on a certificate made here; the client trusts it by its hash, as a browser can for a short-lived one. */
  async function serveFastLane(gameServer: object, origins: string[]) {
    const folder = temporaryFolder("zaisma-fast-lane-");
    const { certificatePem, keyPem } = makeCertificate(["127.0.0.1", "localhost"], Date.now(), undefined, 12);
    writeFileSync(join(folder, "fullchain.pem"), certificatePem);
    writeFileSync(join(folder, "privkey.pem"), keyPem);
    const webtransportPort = await freeUdpPort();
    const own = startServer({ gameServer, gameSlug: "arena", port: 0, origins, issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null, webtransportPort, certificatePath: join(folder, "fullchain.pem"), certificateKeyPath: join(folder, "privkey.pem") });
    await own.fastLaneReady;
    onTestFinished(() => own.close());
    const certificateHash = new Uint8Array(new X509Certificate(certificatePem).fingerprint256.split(":").map((pair) => parseInt(pair, 16)));
    return { webtransportPort, certificateHash };
  }

  /** A fast-lane client as the SDK is one: a stream of [length][kind][payload] frames, and [kind][payload] datagrams. */
  async function fastLaneClient(at: { webtransportPort: number; certificateHash: Uint8Array }, path: string) {
    const session = new fastLanePackage!.WebTransport(`https://127.0.0.1:${at.webtransportPort}${path}`, { serverCertificateHashes: [{ algorithm: "sha-256", value: at.certificateHash }] });
    await session.ready;
    const stream = await session.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    const datagramWriter = (session.datagrams.createWritable ? session.datagrams.createWritable() : session.datagrams.writable).getWriter();
    const inbox: { message: any; isDatagram: boolean }[] = [];
    const waiters: ((received: { message: any; isDatagram: boolean }) => void)[] = [];
    const take = (kind: number, payload: Uint8Array, isDatagram: boolean) => {
      const message = kind === 1 ? { type: "bytes", bytes: [...payload] } : (() => {
        const text = new TextDecoder().decode(payload);
        return text === "pong" ? { type: "pong" } : JSON.parse(text);
      })();
      // Probes are answered at once, as the SDK does.
      if (message.type === "probe") return void say({ type: "probe_answer", probeNumber: message.probeNumber });
      const waiter = waiters.shift();
      waiter ? waiter({ message, isDatagram }) : inbox.push({ message, isDatagram });
    };
    void (async () => {
      const reader = stream.readable.getReader();
      let buffered = new Uint8Array(0);
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        buffered = new Uint8Array([...buffered, ...value]);
        while (buffered.length >= 5) {
          const sizeBytes = new DataView(buffered.buffer, buffered.byteOffset).getUint32(0);
          if (buffered.length < 5 + sizeBytes) break;
          take(buffered[4]!, buffered.slice(5, 5 + sizeBytes), false);
          buffered = buffered.slice(5 + sizeBytes);
        }
      }
    })();
    void (async () => {
      const reader = session.datagrams.readable.getReader();
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        take(value[0], value.slice(1), true);
      }
    })();
    const frame = (text: string) => {
      const payload = new TextEncoder().encode(text);
      const framed = new Uint8Array(5 + payload.length);
      new DataView(framed.buffer).setUint32(0, payload.length);
      framed[4] = 0;
      framed.set(payload, 5);
      return framed;
    };
    // A send still in flight when the server closes the session (a refusal) fails with the session's close, which the
    // test reads from closed instead: left unhandled, it would fail the run whenever the close wins the race.
    const say = (message: object) => void writer.write(frame(JSON.stringify(message))).catch(() => {});
    const sayDatagram = (message: object) => void datagramWriter.write(new Uint8Array([0, ...new TextEncoder().encode(JSON.stringify(message))])).catch(() => {});
    const next = () => (inbox.length ? Promise.resolve(inbox.shift()!) : new Promise<{ message: any; isDatagram: boolean }>((resolve) => waiters.push(resolve)));
    const until = async (type: string) => {
      for (;;) {
        const received = await next();
        if (received.message.type === type) return received;
      }
    };
    return { session, say, sayDatagram, until, closed: session.closed as Promise<{ closeCode: number; reason: string }> };
  }

  it("lets a player in with a pass, carries latest-only sends as datagrams both ways and the rest on the stream", async () => {
    const heard: unknown[] = [];
    const game = defineGameServer({
      ticksPerSec: 20,
      setup: () => ({}),
      onMessage(_state, player, room, message) {
        heard.push(message);
        if (message === "ask") room.send(player.id, { type: "answer" });
        else room.broadcast({ type: "aim", angle: message }, { delivery: "latest_only", latestKey: "aim" });
      },
    });
    const at = await serveFastLane(game, []);
    const a = await fastLaneClient(at, "/v1/rooms/arena/FASTAA");
    a.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("a") });
    expect((await a.until("welcome")).message.me).toMatchObject({ id: "a" });
    // A latest-only send from the player, as a datagram, reaches onMessage; the room's latest-only broadcast comes back as one.
    a.sayDatagram({ type: "message", data: 30 });
    const aim = await a.until("message");
    expect(aim).toEqual({ message: { type: "message", data: { type: "aim", angle: 30 }, fromPlayerId: null }, isDatagram: true });
    expect(heard).toEqual([30]);
    // A reliable one goes on the stream, both ways.
    a.say({ type: "message", data: "ask" });
    expect(await a.until("message")).toEqual({ message: { type: "message", data: { type: "answer" }, fromPlayerId: null }, isDatagram: false });
    a.session.close();
  });

  it("refuses a session from another page, with the WebSocket's code and close", async () => {
    const at = await serveFastLane(relay, [ORIGIN]);
    const stranger = await fastLaneClient(at, "/v1/rooms/arena/FASTAB");
    stranger.say({ type: "hello", protocolVersionNumber: 1, pass: await pass("b") });
    expect((await stranger.until("error")).message).toMatchObject({ type: "error", code: "bad_origin" });
    expect((await stranger.closed).closeCode).toBe(4001);
  });
});
