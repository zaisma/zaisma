import { env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { RENTED_SHARE_TEXT, createAccount, issueRoomKey, monthStartDateOf } from "@zaisma/core";
import roomsWorker, { type Env } from "../../apps/rooms/src/index.ts";
import type { Room } from "../../apps/rooms/src/room.ts";

// Real players go last inside each game (packages/core/src/rented-share.ts), as the rooms Worker and a room apply it.

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;
const RENTED = { PREVIEW_NETWORK_NUMBER: "16509" };
const HOME = { PREVIEW_NETWORK_NUMBER: "7922" };
const GAME = "arena";
const GAME_ID = "garena";
let address = 0;

const call = (path: string, body: Record<string, unknown>, worker: Partial<Env> = HOME) =>
  roomsWorker.fetch(new Request(`${R}${path}`, { method: "POST", headers: { origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: GAME, ...body }) }) as never, { ...e, ...worker } as Env);

async function passFor(accountId: string | null = null, isReturningBrowser = false, worker: Partial<Env> = HOME) {
  const roomKey = await issueRoomKey(e.DB, GAME_ID, accountId, Date.now(), isReturningBrowser);
  return (await (await call("/v1/pass", { roomKey }, worker)).json()) as { pass: string; playShare: string; player: { id: string } };
}

/** Says hello to a room from a network, and answers its first word: "welcome", or the code it was refused with. */
async function join(code: string, given: { pass: string; playShare?: string }, worker: Partial<Env>, signs: Record<string, unknown> = {}) {
  const response = await roomsWorker.fetch(new Request(`${R}/v1/rooms/${GAME}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } }) as never, { ...e, ...worker } as Env);
  const socket = response.webSocket!;
  socket.accept();
  const first = new Promise<{ type: string; code?: string; message?: string }>((resolve) => socket.addEventListener("message", (event) => resolve(JSON.parse(event.data as string))));
  socket.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: given.pass, playShare: given.playShare, ...signs }));
  const answer = await first;
  return { socket, answer };
}

const stopShare = (stoppedAtMs = Date.now()) =>
  e.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, rented_share_stopped_at_ms) VALUES (?, ?, ?) ON CONFLICT (game_id, month_start_date) DO UPDATE SET rented_share_stopped_at_ms = excluded.rented_share_stopped_at_ms").bind(GAME_ID, monthStartDateOf(Date.now()), stoppedAtMs).run();

describe("the rented share", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_hosting_months; DELETE FROM room_keys; DELETE FROM games_ever_played; DELETE FROM accounts; DELETE FROM games;");
    await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', 'v1', 'relay', 'page', 0, 0)").bind(GAME_ID, GAME, GAME).run();
  });

  it("gives a pass a word it can't read, and never puts any of it in the pass", async () => {
    const { pass, playShare } = await passFor();
    expect(playShare).toEqual(expect.any(String));
    const claims = JSON.parse(atob(pass.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(Object.keys(claims).join(" ")).not.toMatch(/share|rented|network|history/i);
  });

  it("lets everyone play while the share lasts, on any network", async () => {
    const { answer } = await join("AAAAAA", await passFor(), RENTED);
    expect(answer.type).toBe("welcome");
  });

  it("stops a newcomer on a rented network once the share is used, with the words that say why", async () => {
    await stopShare();
    const { answer } = await join("AAAAAB", await passFor(), RENTED);
    expect(answer).toMatchObject({ type: "error", code: "rented_share_used", message: RENTED_SHARE_TEXT });
  });

  it("keeps everyone else playing once the share is used, however full the game is", async () => {
    await stopShare();
    expect((await join("AAAAAC", await passFor(), HOME)).answer.type).toBe("welcome");
    // A browser that played this game before, on any network.
    expect((await join("AAAAAD", await passFor(null, true), RENTED)).answer.type).toBe("welcome");
    // An account with history, on any network.
    await createAccount(e.DB, { id: "old-account", username: "Old_Hand", ageBand: "18+" });
    await e.DB.prepare("UPDATE accounts SET created_at_ms = ? WHERE id = 'old-account'").bind(Date.now() - 8 * 86_400_000).run();
    expect((await join("AAAAAE", await passFor("old-account"), RENTED)).answer.type).toBe("welcome");
  });

  it("counts a brand-new account like a guest: no script clears the bar by signing up", async () => {
    await stopShare();
    await createAccount(e.DB, { id: "new-account", username: "New_Hand", ageBand: "18+" });
    const { answer } = await join("AAAAAF", await passFor("new-account"), RENTED);
    expect(answer).toMatchObject({ code: "rented_share_used" });
  });

  it("takes both signs together on any network, and neither alone", async () => {
    await stopShare();
    const bothSigns = { hasGraphicsChip: false, isInputSeen: false };
    expect((await join("AAAAAG", await passFor(), HOME, bothSigns)).answer).toMatchObject({ code: "rented_share_used" });
    expect((await join("AAAAAH", await passFor(), HOME, { ...bothSigns, isInputSeen: true })).answer.type).toBe("welcome");
    expect((await join("AAAAAM", await passFor(), HOME, { ...bothSigns, hasGraphicsChip: true })).answer.type).toBe("welcome");
  });

  it("lets a whole school play from one address: limits count the player", async () => {
    const SCHOOL = "198.51.100.251";
    const answers = [];
    for (let playerNumber = 0; playerNumber < 25; playerNumber++) {
      const roomKey = await issueRoomKey(e.DB, GAME_ID);
      answers.push(await roomsWorker.fetch(new Request(`${R}/v1/pass`, { method: "POST", headers: { origin: ORIGIN, "cf-connecting-ip": SCHOOL }, body: JSON.stringify({ gameSlug: GAME, roomKey }) }) as never, { ...e, ...HOME } as Env));
    }
    expect(answers.map((answer) => answer.status)).toEqual(Array(25).fill(200));
  });

  it("has a game past its share of the shared database wait with new joins, and keeps its running match", async () => {
    const refusing = { limit: async () => ({ success: false }) };
    const refusedPass = await call("/v1/pass", { roomKey: await issueRoomKey(e.DB, GAME_ID) }, { ...HOME, GAME_LIMIT: refusing } as Partial<Env>);
    expect(refusedPass.status).toBe(503);
    expect(await refusedPass.json()).toMatchObject({ error: { code: "busy" } });
    const inMatch = await passFor();
    const { answer: first } = await join("AAAAAN", inMatch, HOME);
    expect(first.type).toBe("welcome");
    const newcomer = await passFor();
    const room = (e.ROOMS as unknown as DurableObjectNamespace<Room>).get(e.ROOMS.idFromName(`${GAME}:AAAAAN`));
    await runInDurableObject(room, (instance) => void ((instance as unknown as { env: Partial<Env> }).env.GAME_LIMIT = refusing as never));
    try {
      expect((await join("AAAAAN", inMatch, HOME)).answer.type).toBe("welcome");
      expect((await join("AAAAAN", newcomer, HOME)).answer).toMatchObject({ type: "error", code: "busy" });
    } finally {
      await runInDurableObject(room, (instance) => void delete (instance as unknown as { env: Partial<Env> }).env.GAME_LIMIT);
    }
  });

  it("doesn't take a forged word for history", async () => {
    await stopShare();
    const { pass } = await passFor();
    expect((await join("AAAAAJ", { pass, playShare: "forged.word" }, RENTED)).answer).toMatchObject({ code: "rented_share_used" });
  });

  it("stops the relay and game server requests too, and only for the share", async () => {
    await stopShare();
    const onShare = await call("/v1/relay", { roomKey: await issueRoomKey(e.DB, GAME_ID) }, RENTED);
    expect(await onShare.json()).toMatchObject({ error: { code: "rented_share_used", message: RENTED_SHARE_TEXT } });
    expect(onShare.status).toBe(403);
    const atHome = await call("/v1/relay", { roomKey: await issueRoomKey(e.DB, GAME_ID) }, HOME);
    expect(((await atHome.json()) as { error?: { code: string } }).error?.code).not.toBe("rented_share_used");
  });

  it("splits a shared room's use by who played it, with nothing about any player", async () => {
    const { socket: rented, answer } = await join("AAAAAK", await passFor(), RENTED);
    expect(answer.type).toBe("welcome");
    const { socket: home } = await join("AAAAAK", await passFor(), HOME);
    const room = (e.ROOMS as unknown as DurableObjectNamespace<Room>).get(e.ROOMS.idFromName(`${GAME}:AAAAAK`));
    rented.close();
    home.close();
    await runInDurableObject(room, async (object: Room) => {
      await (object as unknown as { recordUsage(isEnded: boolean): Promise<void> }).recordUsage(false);
    });
    const row = await e.DB.prepare("SELECT rented_share_room_use_cents, room_connection_count FROM room_usage WHERE game_id = ?").bind(GAME_ID).first<{ rented_share_room_use_cents: number; room_connection_count: number }>();
    expect(row!.room_connection_count).toBeGreaterThanOrEqual(2);
    expect(row!.rented_share_room_use_cents).toBeGreaterThan(0);
  });
});
