import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain JavaScript runner without type declarations
import { startServer } from "../../packages/game-server/bin/node.js";
import { defineGameServer, generateSigningKey, loadSigningKey, relay, signPass } from "../../packages/game-server/src/index.ts";

const ISS = "https://rooms.zaisma.test";
const ORIGIN = "https://arena.zaismausercontent.com";
const signing = await loadSigningKey(await generateSigningKey());
const server = startServer({ server: relay, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey], roomStateFile: null });
await new Promise((r) => server.wss.once("listening", r));
const port = (server.wss.address() as { port: number }).port;
afterAll(() => server.close());

async function pass(sub: string, aud = "arena") {
  const now = Math.floor(Date.now() / 1000);
  return signPass(signing, { sub, name: sub.toUpperCase(), aud, iss: ISS, kind: "guest", iat: now, exp: now + 60 });
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
  const own = startServer({ server: gameServer, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey], roomStateFile: null });
  await new Promise((r) => own.wss.once("listening", r));
  return { own, at: (own.wss.address() as { port: number }).port };
}

describe("Node runner", () => {
  it("runs the same game server with Zaisma player passes", async () => {
    const a = connect();
    const b = connect();
    await Promise.all([a.open, b.open]);
    a.say({ type: "hello", pass: await pass("a") });
    // Only Zaisma rooms end a match on a timer: on the developer's own server endsAt stays null.
    expect(await a.next()).toMatchObject({ type: "welcome", me: { id: "a", name: "A" }, hostPlayerId: "a", endsAt: null });
    b.say({ type: "hello", pass: await pass("b") });
    expect((await b.next()).type).toBe("welcome");
    await a.next(); // players: a
    await a.next(); // players: a, b
    a.say({ type: "message", data: "hi" });
    await b.next(); // b's players list
    expect(await b.next()).toEqual({ type: "message", data: { fromPlayerId: "a", data: "hi" } });
    a.ws.close();
    b.ws.close();
  });

  it("takes bytes for the game server and sends bytes back, as Zaisma rooms do", async () => {
    const a = connect();
    const b = connect();
    await Promise.all([a.open, b.open]);
    a.say({ type: "hello", pass: await pass("a") });
    await until(a, "welcome");
    b.say({ type: "hello", pass: await pass("b") });
    await until(b, "welcome");
    // The relay passes them on, from a.
    a.ws.send(new Uint8Array([3, 4, 5]));
    expect(await until(b, "bytes")).toEqual({ type: "bytes", fromPlayerId: "a", bytes: [3, 4, 5] });
    a.ws.send(new Uint8Array(16 * 1024 + 1));
    expect(await until(a, "error")).toMatchObject({ code: "too_big" });
    a.ws.close();
    b.ws.close();

    // A game server of its own, answering bytes with bytes.
    const { own, at } = await serve(defineGameServer({ setup: () => ({}), onBytes: (_state, player, bytes, room) => room.sendBytes(player.id, bytes.map((byte) => byte * 2)) }));
    const c = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await c.open;
    c.say({ type: "hello", pass: await pass("c") });
    await until(c, "welcome");
    c.ws.send(new Uint8Array([1, 2]));
    expect(await until(c, "bytes")).toEqual({ type: "bytes", fromPlayerId: null, bytes: [2, 4] });
    c.ws.close();
    own.close();
  });

  it("probes each player right after welcome, and the game server reads their ping and the room's clock", async () => {
    const pinging = defineGameServer({
      setup: () => ({}),
      onMessage: (_s, player, _data, room) => room.send(player.id, { pingDurationMs: room.pingDurationMs(player.id), serverTimeMs: room.serverTimeMs() }),
    });
    const { own, at } = await serve(pinging);
    const a = connect(ORIGIN, "/v1/rooms/arena/PNGCLK", at);
    await a.open;
    a.say({ type: "hello", pass: await pass("a") });
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
    ws.send(JSON.stringify({ type: "hello", pass: await pass("a") }));
    // Closed with 4003, then terminate(): behind a real backlog the client sees an abnormal close (1006); either way the SDK reconnects.
    expect([1006, 4003]).toContain(await closed);
    await own.close();
  });

  it("starts a room with friends' Join off when its maker asks, as Zaisma rooms do", async () => {
    const a = connect(ORIGIN, "/v1/rooms/arena/FJ2KMN");
    await a.open;
    a.say({ type: "hello", pass: await pass("a"), room: { friendJoinsEnabled: false } });
    expect(await a.next()).toMatchObject({ type: "welcome", room: { friendJoinsEnabled: false } });
    // The relay's host turns it back on.
    a.say({ type: "room", friendJoinsEnabled: true });
    expect(await until(a, "room")).toMatchObject({ room: { friendJoinsEnabled: true } });
    a.ws.close();
  });

  it("looks up an account's name, since its pass carries none, and turns away a deleted account", async () => {
    const lookedUp: string[] = [];
    const profiles = async (playerId: string) => {
      lookedUp.push(playerId);
      return playerId === "player_owl" ? { id: playerId, name: "Night_Owl" } : null;
    };
    const own = startServer({ server: relay, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey], roomStateFile: null, profiles });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const accountPass = async (sub: string) => {
      const now = Math.floor(Date.now() / 1000);
      return signPass(signing, { sub, aud: "arena", iss: ISS, kind: "account", iat: now, exp: now + 60 });
    };
    const owl = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await owl.open;
    owl.say({ type: "hello", pass: await accountPass("player_owl") });
    expect((await owl.next()).me).toEqual({ id: "player_owl", name: "Night_Owl", kind: "account" });
    const gone = connect(ORIGIN, "/v1/rooms/arena/ABCDEF", at);
    await gone.open;
    gone.say({ type: "hello", pass: await accountPass("player_gone") });
    expect(await gone.next()).toMatchObject({ type: "error", code: "bad_pass" });
    // Guests' names come in their passes, so they're never looked up.
    expect(lookedUp).toEqual(["player_owl", "player_gone"]);
    owl.ws.close();
    own.close();
  });

  it("finds blocks between accounts in their passes, and tells both players' games", async () => {
    const checked: boolean[] = [];
    const watcher = defineGameServer({ setup: () => ({}), onJoin: (_state, player, room) => void (player.id === "player_mia" && checked.push(room.hasBlockBetween("player_kit", "player_mia"))) });
    const own = startServer({ server: watcher, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey], roomStateFile: null, profiles: async (playerId: string) => ({ id: playerId, name: playerId.slice(7) }) });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const accountPass = async (sub: string, playerTag: string, blockTagIds: string[]) => {
      const now = Math.floor(Date.now() / 1000);
      return signPass(signing, { sub, aud: "arena", iss: ISS, kind: "account", player_tag: playerTag, block_tag_ids: blockTagIds, iat: now, exp: now + 60 });
    };
    const kit = connect(ORIGIN, "/v1/rooms/arena/WALLED", at);
    await kit.open;
    kit.say({ type: "hello", pass: await accountPass("player_kit", "block_tag_kit", ["block_tag_mia"]) });
    expect((await kit.next()).type).toBe("welcome");
    // Mia's pass is from before the block: Kit's alone is enough.
    const mia = connect(ORIGIN, "/v1/rooms/arena/WALLED", at);
    await mia.open;
    mia.say({ type: "hello", pass: await accountPass("player_mia", "block_tag_mia", []) });
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
    const own = startServer({ server: watcher, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey], roomStateFile: null, profiles: async (playerId: string) => ({ id: playerId, name: playerId.slice(7) }) });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const accountPass = async (sub: string, playerTag: string, friendTagIds: string[]) => {
      const now = Math.floor(Date.now() / 1000);
      return signPass(signing, { sub, aud: "arena", iss: ISS, kind: "account", player_tag: playerTag, friend_tag_ids: friendTagIds, iat: now, exp: now + 60 });
    };
    const enter = async (sub: string, playerTag: string, friendTagIds: string[]) => {
      const c = connect(ORIGIN, "/v1/rooms/arena/FRNDSA", at);
      await c.open;
      c.say({ type: "hello", pass: await accountPass(sub, playerTag, friendTagIds) });
      expect((await c.next()).type).toBe("welcome");
      return c;
    };
    // Kit and Mia list each other; Cy lists Kit, but Kit doesn't list Cy.
    const players = [await enter("player_kit", "player_tag_kit", ["player_tag_mia"]), await enter("player_mia", "player_tag_mia", ["player_tag_kit"]), await enter("player_cy", "player_tag_cy", ["player_tag_kit"])];
    expect(checked).toEqual([true, false]);
    for (const player of players) player.ws.close();
    await own.close();
  });

  it("refuses other origins, passes for other games and the old short hello", async () => {
    expect(await connect("https://evil.example").closed).toBe(4001);
    const c = connect();
    await c.open;
    c.say({ type: "hello", pass: await pass("c", "other-game") });
    expect(await c.next()).toMatchObject({ type: "error", code: "bad_pass" });
    expect(await c.closed).toBe(4001);
    const old = connect();
    await old.open;
    old.say({ t: "hello", pass: await pass("d") });
    expect(await old.next()).toMatchObject({ type: "error", code: "no_hello" });
  });

  it("brings rooms back with their state after a restart, from its room state file", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "zaisma-room-states-")), "rooms.sqlite");
    const racer = defineGameServer({
      ticksPerSec: 50,
      stateSaveIntervalSec: 1,
      setup: () => ({ tickCount: 0, restored: null as unknown }),
      onTick: (state) => void state.tickCount++,
      onRestored: (state, restoreInfo, room) => void (state.restored = { ...restoreInfo, awayReasons: room.players.map((player) => room.awayReason(player.id)) }),
      onMessage: (state, player, _message, room) => room.send(player.id, { tickCount: state.tickCount, restored: state.restored }),
    });
    const start = async () => {
      const own = startServer({ server: racer, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey], roomStateFile: file });
      await new Promise((r) => own.wss.once("listening", r));
      return { own, at: (own.wss.address() as { port: number }).port };
    };
    const first = await start();
    const lucas = connect(ORIGIN, "/v1/rooms/arena/RSTRTN", first.at);
    await lucas.open;
    lucas.say({ type: "hello", pass: await pass("lucas") });
    expect((await lucas.next()).type).toBe("welcome");
    // Emma plays a little and leaves: she isn't brought back, though the state doesn't say she left.
    const emma = connect(ORIGIN, "/v1/rooms/arena/RSTRTN", first.at);
    await emma.open;
    emma.say({ type: "hello", pass: await pass("emma") });
    expect((await emma.next()).type).toBe("welcome");
    await new Promise((r) => setTimeout(r, 1100));
    emma.ws.close(1000);
    await emma.closed;
    await new Promise((r) => setTimeout(r, 50));
    // A clean stop saves every room, so nothing is lost.
    await first.own.close();
    const tickCountAtStop = first.own.rooms.get("RSTRTN").core.state.tickCount;
    expect(tickCountAtStop).toBeGreaterThan(0);

    const second = await start();
    const back = connect(ORIGIN, "/v1/rooms/arena/RSTRTN", second.at);
    await back.open;
    back.say({ type: "hello", pass: await pass("lucas") });
    expect((await back.next()).type).toBe("welcome");
    back.say({ type: "message", data: "how" });
    const how = (await until(back, "message")).data;
    expect(how.tickCount).toBeGreaterThanOrEqual(tickCountAtStop);
    expect(how.restored).toMatchObject({ lostDurationSec: 0, awayReasons: ["lost"] });
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
        onMessage: (_state, _player, message, room) => room.broadcast({ said: message }, { audience: "spectators" }),
      }),
    );
    const path = "/v1/rooms/arena/WATCHN";
    // Nobody's playing: nothing to watch.
    const early = connect(ORIGIN, path, at);
    await early.open;
    early.say({ type: "hello", pass: await pass("early"), isSpectator: true });
    expect(await until(early, "error")).toMatchObject({ code: "no_room" });

    const player = connect(ORIGIN, path, at);
    await player.open;
    player.say({ type: "hello", pass: await pass("p") });
    await until(player, "welcome");
    // The room is full, but there's room to watch.
    const watcher = connect(ORIGIN, path, at);
    await watcher.open;
    watcher.say({ type: "hello", pass: await pass("w"), isSpectator: true });
    expect(await until(watcher, "welcome")).toMatchObject({ isSpectator: true, spectatorCount: 1 });
    expect(await until(watcher, "message")).toEqual({ type: "message", data: { watching: 1 } });
    const second = connect(ORIGIN, path, at);
    await second.open;
    second.say({ type: "hello", pass: await pass("w2"), isSpectator: true });
    expect(await until(second, "error")).toMatchObject({ code: "watching_full" });

    player.say({ type: "message", data: "go" });
    expect(await until(watcher, "message")).toEqual({ type: "message", data: { said: "go" } });
    watcher.say({ type: "message", data: "me too" });
    expect(await until(watcher, "error")).toMatchObject({ code: "spectator_cannot_send" });

    player.ws.close(1000);
    expect(await until(watcher, "ended")).toEqual({ type: "ended", message: "The match ended." });
    expect(await watcher.closed).toBe(4000);
    await own.close();
  });

  it("sends state sync, and holds latest-only messages while a socket is backed up, as Zaisma rooms do", async () => {
    const game = defineGameServer({
      stateSyncEnabled: true,
      setup: () => ({ moveCount: 0 }),
      onMessage(state, _player, message, room) {
        if (message === "move") state.moveCount++;
        else room.broadcast({ type: "aim", angle: message }, { delivery: "latest_only" });
      },
      stateView: (state, viewer) => ({ moveCount: state.moveCount, me: viewer.id }),
    });
    const { own, at } = await serve(game);
    const a = connect(ORIGIN, "/v1/rooms/arena/STATEA", at);
    await a.open;
    a.say({ type: "hello", pass: await pass("a") });
    const { serverTimeMs, ...full } = await until(a, "state");
    expect(full).toEqual({ type: "state", full: { moveCount: 0, me: "a" } });
    expect(serverTimeMs).toBeGreaterThan(0);
    a.say({ type: "message", data: "move" });
    expect(await until(a, "state")).toMatchObject({ changes: [[["moveCount"], 1]] });
    // Its socket holds 100 KB not yet sent: the game's latest-only messages wait, and state sync skips it.
    const socket = own.rooms.get("STATEA").sockets.get("a");
    let bufferedSizeBytes = 100 * 1024;
    Object.defineProperty(socket, "bufferedAmount", { get: () => bufferedSizeBytes, configurable: true });
    for (const angle of [10, 20, 30]) a.say({ type: "message", data: angle });
    a.say({ type: "message", data: "move" });
    await new Promise((r) => setTimeout(r, 120));
    bufferedSizeBytes = 0;
    // Drained: the newest aim, then a full copy of the state.
    expect(await a.next()).toEqual({ type: "message", data: { type: "aim", angle: 30 } });
    expect(await a.next()).toMatchObject({ type: "state", full: { moveCount: 2, me: "a" } });
    a.ws.close();
    own.close();
  });

  it("won't start a game server with an option it doesn't take", () => {
    expect(() => startServer({ server: { tickRate: 20, setup: () => ({}) }, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [], roomStateFile: null })).toThrow(
      "tickRate isn't a game server option",
    );
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
    a.say({ type: "hello", pass: await pass("a") });
    await until(a, "welcome");
    b.say({ type: "hello", pass: await pass("b") });
    const { roomCode } = await until(a, "move");
    expect((await until(b, "move")).roomCode).toBe(roomCode);

    const stranger = connect(ORIGIN, `/v1/rooms/arena/${roomCode}`, at);
    await stranger.open;
    stranger.say({ type: "hello", pass: await pass("c") });
    expect(await stranger.next()).toMatchObject({ type: "error", code: "closed" });
    const m = connect(ORIGIN, `/v1/rooms/arena/${roomCode}`, at);
    await m.open;
    m.say({ type: "hello", pass: await pass("a"), joinData: { character: "knight" } });
    expect(await until(m, "message")).toEqual({ type: "message", data: { setupData: { map: "Docks" }, brought: { a: { character: "knight" } } } });
    for (const c of [a, b, m]) c.ws.close();
    await own.close();
  });

  it("moves players to another room that's running, which gets the join data and can say no", async () => {
    const world = defineGameServer({
      setup: () => ({}),
      onJoin(_s, p, room, joinData, joinInfo) {
        if (joinInfo.fromRoomCode) room.send(p.id, { arrived: joinData, fromRoomCode: joinInfo.fromRoomCode });
      },
      onMessage(_s, p, message, room) {
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
    forest.say({ type: "hello", pass: await pass("f") });
    await until(forest, "welcome");
    town.say({ type: "hello", pass: await pass("a") });
    await until(town, "welcome");

    town.say({ type: "message", data: "ZZZZZZ" });
    expect(await until(town, "message")).toEqual({ type: "message", data: { stayed: "no_room" } });
    town.say({ type: "message", data: "FRSTAA" });
    expect(await until(town, "move")).toEqual({ type: "move", roomCode: "FRSTAA" });

    const moved = connect(ORIGIN, "/v1/rooms/arena/FRSTAA", at);
    await moved.open;
    moved.say({ type: "hello", pass: await pass("a"), joinData: { door: "cheat" } });
    expect(await until(moved, "message")).toEqual({ type: "message", data: { arrived: { door: "north" }, fromRoomCode: "TWNAAA" } });
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
    a.say({ type: "hello", pass: await pass("a") });
    expect((await until(a, "welcome")).awayChecks).toEqual({ idleTimeoutSec: 600, hiddenTimeoutSec: null });
    b.say({ type: "hello", pass: await pass("b") });
    await until(b, "welcome");

    b.say({ type: "idle" });
    expect(await until(b, "away")).toEqual({ type: "away", reason: "idle", seatHoldDurationSec: 300 });
    expect((await until(a, "message")).data).toEqual({ joined: "a", isReturning: false });
    expect((await until(a, "message")).data).toEqual({ joined: "b", isReturning: false });
    expect((await until(a, "message")).data).toEqual({ left: "b", reason: "idle" });
    // The held seat keeps the room full.
    const c = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    await c.open;
    c.say({ type: "hello", pass: await pass("c") });
    expect(await c.next()).toMatchObject({ type: "error", code: "full" });

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
      onAway: (_s, p, room, reason) => room.broadcast({ away: p.id, reason, awayReason: room.awayReason(p.id) }),
      onBack: (_s, p, room) => room.broadcast({ back: p.id }),
      onLeave: (_s, p, room, leaveInfo) => room.broadcast({ left: p.id, reason: leaveInfo.reason }),
    });
    const { own, at } = await serve(duel);
    const a = connect(ORIGIN, "/v1/rooms/arena/DRPNDE", at);
    await a.open;
    a.say({ type: "hello", pass: await pass("a") });
    await until(a, "welcome");
    const bPass = await pass("b");
    const b = connect(ORIGIN, "/v1/rooms/arena/DRPNDE", at);
    await b.open;
    b.say({ type: "hello", pass: bPass });
    await until(b, "welcome");

    // b's connection drops: a's game sees them reconnecting, and the game server hears it.
    b.ws.terminate();
    expect((await until(a, "message")).data).toEqual({ away: "b", reason: "lost", awayReason: "lost" });
    expect((await until(a, "players")).players.map((p: any) => [p.id, p.awayReason])).toEqual([["a", null], ["b", "lost"]]);
    const again = connect(ORIGIN, "/v1/rooms/arena/DRPNDE", at);
    await again.open;
    again.say({ type: "hello", pass: bPass });
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
