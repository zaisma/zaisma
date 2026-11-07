import { env, runInDurableObject, SELF } from "cloudflare:test";
import { afterAll, beforeAll, describe, it } from "vitest";
import { bodyProblem, createAccount, issueRoomKey } from "@zaisma/core";
import { BUSY_CLOSE_CODE, ROOM_MESSAGE_DOORS } from "@zaisma/game-server/internal";
import { ROOM_ADDRESS_DOORS } from "../../apps/rooms/src/doors.ts";
import type { Env } from "../../apps/rooms/src/index.ts";
import { cellOf, ownLimitOnly, pastLimitProblem, problemWithAnswer, tooLongFor, wrongValueOf, type CallAnswer, type CallerKind, type GridCell } from "./cells.ts";

/**
 * Every address on rooms.zaisma.com and the `hello` that joins a room, by every kind of caller (test/grid/cells.ts). A game's
 * page is proven by its Origin, and a player by their pass: another site's page is another account here, a pass for another game
 * is another game's key, and a game that's down is its banned developer's.
 */

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const EVIL = "https://evil.example.test";
const e = env as unknown as Env;
let address = 0;
let gameNumber = 0;

async function addGame(status = "live"): Promise<{ id: string; slug: string }> {
  const n = ++gameNumber;
  const id = `grid${n}`;
  const slug = `grid-room-${n}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, 'v1', 'relay', 'page', 0, 0)").bind(id, slug, slug, status).run();
  return { id, slug };
}

/** A room's own address answers only a WebSocket's opening, with its origin checked after that. */
const hit = (method: string, path: string, origin: string | null, body?: Record<string, unknown>) =>
  SELF.fetch(`${R}${path}`, { method, redirect: "manual", headers: { ...(origin ? { Origin: origin } : {}), ...(/^\/v1\/rooms\/[^/]+\/[^/]+$/.test(path) ? { Upgrade: "websocket" } : {}), "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, ...(body ? { body: JSON.stringify(body) } : {}) });

/**
 * A refused socket opens to say why, since a browser's page can't read a status (refusedSocket), so here that counts as the door's
 * 403. A room that let it in answers a ping.
 */
async function socketStatus(socket: WebSocket): Promise<number> {
  socket.accept();
  const status = new Promise<number>((resolve) => {
    socket.addEventListener("message", (event) => resolve(event.data === "pong" ? 101 : 403));
    socket.addEventListener("close", () => resolve(403));
  });
  socket.send("ping");
  const given = await status;
  socket.close();
  return given;
}

/** How a socket closed, or 0 when it opened and answered instead. */
async function socketClose(socket: WebSocket): Promise<number> {
  socket.accept();
  const code = new Promise<number>((resolve) => {
    socket.addEventListener("message", (event) => event.data === "pong" && resolve(0));
    socket.addEventListener("close", (event) => resolve(event.code));
  });
  socket.send("ping");
  const given = await code;
  socket.close();
  return given;
}

const answered = async (response: Response): Promise<CallAnswer> => ({ http_status: response.webSocket ? await socketStatus(response.webSocket) : response.status, location: response.headers.get("location"), is_owners_changed: false, is_private_value_shown: false });

const passFor = async (game: { id: string; slug: string }, accountId?: string) => (await (await hit("POST", "/v1/pass", ORIGIN, { gameSlug: game.slug, roomKey: await issueRoomKey(e.DB, game.id, accountId) })).json<{ pass: string }>()).pass;

/** Whether a pass opens a room: the room's first answer, or its closing. */
async function helloAnswer(game: { slug: string }, pass: string): Promise<string> {
  return (await helloReply(game, pass)).type;
}

/** The room's first answer to a hello, as its type and, for a refusal, its code; "refused" when it closed with none. */
async function helloReply(game: { slug: string }, pass: string): Promise<{ type: string; code?: string }> {
  const response = await SELF.fetch(`${R}/v1/rooms/${game.slug}/K7Q2MX`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  const socket = response.webSocket;
  if (!socket) return { type: "refused" };
  socket.accept();
  const first = new Promise<{ type: string; code?: string }>((resolve) => {
    socket.addEventListener("message", (event) => {
      const reply = typeof event.data === "string" ? (JSON.parse(event.data) as { type: string; code?: string }) : { type: "bytes" };
      if (reply.type !== "probe") resolve(reply);
    });
    socket.addEventListener("close", () => resolve({ type: "refused" }));
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, room: { isListed: true } }));
  const answer = await first;
  socket.close();
  return answer;
}

/** What the owner's page sends each address, with the player's proof where it takes one. Addresses not named here take nothing but the game's name. */
const BODIES: Readonly<Record<string, (proof: string) => Record<string, unknown>>> = {
  "/v1/friends": (proof) => ({ pass: proof }),
  "/v1/friends/room": (proof) => ({ pass: proof, roomCode: "K7Q2MX" }),
  "/v1/chat/check": (proof) => ({ senderPass: proof, receiverPasses: [], text: "hello" }),
  "/v1/items/unhandled": (proof) => ({ pass: proof }),
  "/v1/items/handled": (proof) => ({ pass: proof }),
  "/v1/pass": (proof) => ({ roomKey: proof }),
  "/v1/relay": (proof) => ({ roomKey: proof }),
  "/v1/requests/:slug": (proof) => ({ pass: proof, request: {} }),
  "/v1/report": () => ({ reason: "cheating" }),
  "/v1/filter": () => ({ text: "hello" }),
};
/** The fields that hold a player's proof: a pass, or the room key that gets one. */
const PROOF_FIELDS = ["pass", "senderPass", "roomKey"];
/** Addresses whose owner's call takes more than a stand-in here, and where it's tried. */
const OWNER_NOT_PROVEN: Readonly<Record<string, string>> = {
  "/v1/requests/:slug": "A game server's request to its own site: test/rooms/reach.test.ts.",
  "/v1/relay": "Cloudflare's relay: test/rooms/rooms.test.ts.",
  "/v1/friends/room": "A friend's room: test/rooms/rooms.test.ts.",
  "/v1/chat/check": "A chat a game checks with its own server: test/rooms/rooms.test.ts.",
  "/v1/items/handled": "A purchase to mark: test/rooms/rooms.test.ts.",
  "/v1/report": "A player reported from a room: test/rooms/rooms.test.ts.",
  "/v1/rooms/:slug/:room_code": "A WebSocket, tried below as the hello that opens it.",
};

describe("every address on rooms.zaisma.com", () => {
  beforeAll(async () => {
    await createAccount(e.DB, { id: "grid-rooms-owner", username: "Rooms_Owner", ageBand: "18+" });
    await e.DB.prepare("UPDATE accounts SET banned_at_ms = NULL WHERE id = 'grid-rooms-owner'").run();
  });
  afterAll(() => e.DB.exec("DELETE FROM room_keys; DELETE FROM games; DELETE FROM accounts;"));

  it.for(ROOM_ADDRESS_DOORS.map((door) => [`rooms:${door.path}`, door] as const))("%s", { timeout: 60_000 }, async ([doorId, door], { task }) => {
    const cells: GridCell[] = (task.meta.grid_cells = []);
    const push = (callerKind: CallerKind, problem: string | null) => cells.push(cellOf(doorId, callerKind, problem));
    const game = await addGame();
    const other = await addGame();
    const down = await addGame("removed");
    const method = door.method === "ANY" ? "GET" : door.method;
    const pathOf = (slug: string) => door.path.replace(":slug", slug).replace(":room_code", "K7Q2MX").replace(":player_id", "player_grid");
    const pass = await passFor(game, "grid-rooms-owner");
    const othersPass = await passFor(other, "grid-rooms-owner");
    const { takes, limit } = door.contract;
    const fields = takes.body?.kind === "json" ? takes.body.fields : {};
    const bodyOf = (slug: string, proof: string) => (method === "POST" ? { ...("gameSlug" in fields ? { gameSlug: slug } : {}), ...BODIES[door.path]?.(proof) } : undefined);
    const takesRoomKey = "roomKey" in fields;
    const ownersProof = takesRoomKey ? await issueRoomKey(e.DB, game.id, "grid-rooms-owner") : pass;

    // The owner's page past the door's own limit, on every address with one: only that door's counter refuses, so the shared one in
    // front of every address lets it through, and a socket must close as too busy, not open.
    if ("level" in limit) {
      const own = ownLimitOnly(limit, door.path);
      const roomsWorker = (await import("../../apps/rooms/src/index.ts")).default as unknown as { fetch: (request: Request, env: Env) => Promise<Response> };
      const proof = takesRoomKey ? await issueRoomKey(e.DB, game.id, "grid-rooms-owner") : pass;
      const body = bodyOf(game.slug, proof);
      const isSocket = /\/:room_code$/.test(door.path);
      const past = await roomsWorker.fetch(
        new Request(`${R}${pathOf(game.slug)}`, { method, headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}`, ...(isSocket ? { Upgrade: "websocket" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }),
        { ...e, ...own.bindings } as unknown as Env,
      );
      const closeCode = past.webSocket ? await socketClose(past.webSocket) : null;
      const isRefused = closeCode === null ? past.status === 429 : closeCode === BUSY_CLOSE_CODE;
      cells.push(cellOf(doorId, "past_limit", pastLimitProblem(own.isCounted(), isRefused, closeCode === null ? String(past.status) : `a socket closed with ${closeCode}`)));
    }

    if (door.contract.whoMayCall === "anyone") {
      const answer = await answered(await hit(method, pathOf(game.slug), null));
      for (const callerKind of ["owner", "another_account", "stranger", "banned_developer", "banned_account", "weaker_key", "another_games_key"] as const) push(callerKind, answer.http_status >= 500 ? `Answered ${answer.http_status}.` : null);
      return;
    }

    // A body the door wouldn't take is refused for its shape, so its answer would prove nothing about who's calling.
    const ownersBody = bodyOf(game.slug, ownersProof);
    if (takes.body?.kind === "json" && ownersBody && bodyProblem(fields, takes.body.required ?? [], ownersBody)) {
      push("owner", "The grid's own body doesn't fit the door's shape, so no caller here was tried.");
      return;
    }

    // A wrong shape and a door past its limit are refused before any of its own code runs.
    if (takes.body?.kind === "json") {
      const answers = [await hit(method, pathOf(game.slug), ORIGIN, { gameSlug: game.slug, zzz_no_such_field: "x" })];
      const fieldToBreak = Object.entries(takes.body.fields).find(([name, shape]) => name !== "gameSlug" && wrongValueOf(shape) !== undefined);
      if (fieldToBreak) answers.push(await hit(method, pathOf(game.slug), ORIGIN, { gameSlug: game.slug, [fieldToBreak[0]]: wrongValueOf(fieldToBreak[1]) }));
      const passed = answers.find((answer) => answer.status < 400 || answer.status >= 500);
      cells.push(cellOf(doorId, "wrong_shape", passed ? `Answered ${passed.status} to a request of the wrong shape.` : null));
    } else {
      const queryField = Object.entries(takes.query).find(([, shape]) => tooLongFor(shape));
      if (queryField) {
        const answer = await hit(method, `${pathOf(game.slug)}?${queryField[0]}=${tooLongFor(queryField[1])}`, ORIGIN);
        cells.push(cellOf(doorId, "wrong_shape", answer.status >= 400 && answer.status < 500 ? null : `Answered ${answer.status} to a request of the wrong shape.`));
      }
    }
    if (!(door.path in OWNER_NOT_PROVEN)) push("owner", problemWithAnswer("goes_through", null, await answered(await hit(method, pathOf(game.slug), ORIGIN, bodyOf(game.slug, ownersProof)))));
    // Another site's page, and no page at all: the same body, from where a game's page isn't, and a door a game's page proves says so
    // itself. A pass proves its holder from anywhere, a game's server included, so at such a door they come without one.
    const fromElsewhere = async (origin: string | null) => {
      const answer = await answered(await hit(method, pathOf(game.slug), origin, bodyOf(game.slug, door.contract.whoMayCall === "pass_holder" ? "not-a-pass" : ownersProof)));
      return door.contract.whoMayCall === "game_page" && answer.http_status !== 403 ? `Answered ${answer.http_status}, where a game's page is what proves the caller.` : problemWithAnswer("refused", null, answer);
    };
    push("another_account", await fromElsewhere(EVIL));
    push("stranger", await fromElsewhere(null));
    // A game that's down.
    push("banned_developer", problemWithAnswer("refused", null, await answered(await hit(method, pathOf(down.slug), ORIGIN, bodyOf(down.slug, ownersProof)))));
    // Where a pass or a room key proves the player: one for another game, and a token that isn't one.
    if (PROOF_FIELDS.some((field) => field in fields)) {
      const othersProof = takesRoomKey ? await issueRoomKey(e.DB, other.id, "grid-rooms-owner") : othersPass;
      push("another_games_key", problemWithAnswer("refused", null, await answered(await hit(method, pathOf(game.slug), ORIGIN, bodyOf(game.slug, othersProof)))));
      push("weaker_key", problemWithAnswer("refused", null, await answered(await hit(method, pathOf(game.slug), ORIGIN, bodyOf(game.slug, "not-a-pass")))));
    }
    // A whole-account ban: a new pass doesn't carry the account.
    if (door.path === "/v1/pass") {
      await e.DB.prepare("UPDATE accounts SET banned_at_ms = 1, ban_scope = 'whole_account' WHERE id = 'grid-rooms-owner'").run();
      const made = await hit("POST", "/v1/pass", ORIGIN, { gameSlug: game.slug, roomKey: await issueRoomKey(e.DB, game.id, "grid-rooms-owner") });
      const player = made.status < 400 ? (await made.json<{ player: { kind: string } }>()).player : null;
      push("banned_account", player?.kind === "account" ? "Gave a closed account a pass as itself." : null);
      await e.DB.prepare("UPDATE accounts SET banned_at_ms = NULL, ban_scope = NULL WHERE id = 'grid-rooms-owner'").run();
    }
  });

  it.for([["room-message:hello"]] as const)("%s", { timeout: 60_000 }, async ([doorId], { task }) => {
    const cells: GridCell[] = (task.meta.grid_cells = []);
    const game = await addGame();
    const other = await addGame();
    const isRefused = (answer: string) => (answer === "welcome" ? "Let in, where a room should refuse this pass." : null);
    cells.push(cellOf(doorId, "owner", (await helloAnswer(game, await passFor(game))) === "welcome" ? null : "Refused the game's own pass."));
    cells.push(cellOf(doorId, "another_games_key", isRefused(await helloAnswer(game, await passFor(other)))));
    cells.push(cellOf(doorId, "stranger", isRefused(await helloAnswer(game, "not-a-pass"))));
    cells.push(cellOf(doorId, "another_account", isRefused(await helloAnswer(game, "a.b.c"))));
    // Past its own limit, in a room of its own: the room's bindings refuse only the hello's counter, and the room must say it's busy.
    const limited = await addGame();
    const { limit } = ROOM_MESSAGE_DOORS.hello;
    if ("level" in limit) {
      const own = ownLimitOnly(limit, "hello");
      await runInDurableObject(e.ROOMS.get(e.ROOMS.idFromName(`${limited.slug}:K7Q2MX`)), (room: object) => {
        const roomEnv = room as unknown as { env: Env };
        roomEnv.env = { ...roomEnv.env, ...own.bindings } as unknown as Env;
      });
      const reply = await helloReply(limited, await passFor(limited));
      cells.push(cellOf(doorId, "past_limit", pastLimitProblem(own.isCounted(), reply.type === "error" && reply.code === "busy", reply.code ? `${reply.type} ${reply.code}` : reply.type)));
    }
  });
});
