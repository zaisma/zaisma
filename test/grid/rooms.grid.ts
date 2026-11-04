import { env, SELF } from "cloudflare:test";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createAccount, issueRoomKey } from "@zaisma/core";
import { ROOM_ADDRESS_DOORS } from "../../apps/rooms/src/doors.ts";
import type { Env } from "../../apps/rooms/src/index.ts";
import { cellOf, problemWithAnswer, type CallAnswer, type CallerKind, type GridCell } from "./cells.ts";

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

const hit = (method: string, path: string, origin: string | null, body?: Record<string, unknown>) =>
  SELF.fetch(`${R}${path}`, { method, redirect: "manual", headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, ...(body ? { body: JSON.stringify(body) } : {}) });

const answered = async (response: Response): Promise<CallAnswer> => ({ http_status: response.status, location: response.headers.get("location"), is_owners_changed: false, is_private_value_shown: false });

const passFor = async (game: { id: string; slug: string }, accountId?: string) => (await (await hit("POST", "/v1/pass", ORIGIN, { gameSlug: game.slug, roomKey: await issueRoomKey(e.DB, game.id, accountId) })).json<{ pass: string }>()).pass;

/** Whether a pass opens a room: the room's first answer, or its closing. */
async function helloAnswer(game: { slug: string }, pass: string): Promise<string> {
  const response = await SELF.fetch(`${R}/v1/rooms/${game.slug}/K7Q2MX`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  const socket = response.webSocket;
  if (!socket) return "refused";
  socket.accept();
  const first = new Promise<string>((resolve) => {
    socket.addEventListener("message", (event) => {
      const type = typeof event.data === "string" ? (JSON.parse(event.data) as { type: string }).type : "bytes";
      if (type !== "probe") resolve(type);
    });
    socket.addEventListener("close", () => resolve("refused"));
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, room: { isListed: true } }));
  const answer = await first;
  socket.close();
  return answer;
}

/** What the owner's page sends each address. Addresses not named here take nothing but the game's name. */
const BODIES: Readonly<Record<string, (pass: string) => Record<string, unknown>>> = {
  "/v1/friends": (pass) => ({ pass }),
  "/v1/friends/room": (pass) => ({ pass, roomCode: "K7Q2MX" }),
  "/v1/chat/check": (pass) => ({ pass, text: "hello" }),
  "/v1/items/unhandled": (pass) => ({ pass }),
  "/v1/items/handled": (pass) => ({ pass }),
  "/v1/relay": (pass) => ({ pass }),
  "/v1/report": (pass) => ({ pass, reason: "cheating" }),
  "/v1/filter": () => ({ text: "hello" }),
};
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
    const bodyOf = (slug: string, given: string) => (method === "POST" ? { gameSlug: slug, ...(door.path === "/v1/pass" ? { roomKey: given } : BODIES[door.path]?.(given) ?? {}) } : undefined);
    const ownersProof = door.path === "/v1/pass" ? await issueRoomKey(e.DB, game.id, "grid-rooms-owner") : pass;

    if (door.contract.whoMayCall === "anyone") {
      const answer = await answered(await hit(method, pathOf(game.slug), null));
      for (const callerKind of ["owner", "another_account", "stranger", "banned_developer", "banned_account", "weaker_key", "another_games_key"] as const) push(callerKind, answer.http_status >= 500 ? `Answered ${answer.http_status}.` : null);
      return;
    }

    if (!(door.path in OWNER_NOT_PROVEN)) push("owner", problemWithAnswer("goes_through", null, await answered(await hit(method, pathOf(game.slug), ORIGIN, bodyOf(game.slug, ownersProof)))));
    // Another site's page, and no page at all: the same body, from where a game's page isn't.
    push("another_account", problemWithAnswer("refused", null, await answered(await hit(method, pathOf(game.slug), EVIL, bodyOf(game.slug, ownersProof)))));
    push("stranger", problemWithAnswer("refused", null, await answered(await hit(method, pathOf(game.slug), null, bodyOf(game.slug, ownersProof)))));
    // A game that's down.
    push("banned_developer", problemWithAnswer("refused", null, await answered(await hit(method, pathOf(down.slug), ORIGIN, bodyOf(down.slug, ownersProof)))));
    // Where a pass proves the player: a pass for another game, and a token that isn't one.
    const isPassDoor = door.contract.trusts.includes("player_pass") && method === "POST" && door.path in BODIES;
    if (isPassDoor) {
      push("another_games_key", problemWithAnswer("refused", null, await answered(await hit(method, pathOf(game.slug), ORIGIN, bodyOf(game.slug, othersPass)))));
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
  });
});
