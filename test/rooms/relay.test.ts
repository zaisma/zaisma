import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../apps/rooms/src/index.ts";
import { syncRelayUse } from "../../apps/rooms/src/relay.ts";
import { createAccount, isHostingPaused, issueRoomKey, monthStartDateOf, roomUseThisMonth } from "@zaisma/core";

// Players never connect straight to each other: relay credentials for the relay script (packages/sdk/relay.js).
const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

async function addGame(slug: string, accountRequirement = "none") {
  const id = `game_${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, account_requirement, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', 'v1', 'none', ?, 0, 0)")
    .bind(id, slug, slug, accountRequirement)
    .run();
  return id;
}

let address = 0;
const relay = (gameSlug: string, roomKey: unknown, origin = ORIGIN) =>
  SELF.fetch(`${R}/v1/relay`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain", "cf-connecting-ip": `203.0.113.${++address % 250}` }, body: JSON.stringify({ gameSlug, roomKey }) });

describe("relay credentials", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_hosting_months; DELETE FROM room_keys; DELETE FROM accounts WHERE id = 'supabase-user-relayed'; DELETE FROM games;");
  });

  it("gives a checked browser of the game relay servers only, tagged with the game, and counts them", async () => {
    const id = await addGame("duel");
    const answer = await relay("duel", await issueRoomKey(e.DB, id));
    expect(answer.status).toBe(200);
    expect(answer.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const { iceServers, expiresAt } = await answer.json<{ iceServers: { urls: string[]; username: string; credential: string }[]; expiresAt: string }>();
    // No STUN, which would only tell the player their own address, and not port 53, which browsers block.
    expect(iceServers).toEqual([{ urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: `relay-user-${id}-21600`, credential: "relay-secret" }]);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(5.9 * 3_600_000);
    const usage = await e.DB.prepare("SELECT relay_credential_count FROM room_usage WHERE game_id = ?").bind(id).first();
    expect(usage).toEqual({ relay_credential_count: 1 });
  });

  it("gives none to another site, without the check's key, to guests of a game that needs accounts, or while the game's hosting is paused", async () => {
    const id = await addGame("duel");
    expect((await relay("duel", await issueRoomKey(e.DB, id), "https://evil.example")).status).toBe(403);
    expect(await (await relay("duel", "room_key_madeup")).json()).toMatchObject({ error: { code: "unchecked" } });
    expect((await relay("duel", await issueRoomKey(e.DB, "game_other"))).status).toBe(403);

    const membersId = await addGame("members", "whole_game");
    expect(await (await relay("members", await issueRoomKey(e.DB, membersId))).json()).toMatchObject({ error: { code: "account_needed" } });
    const account = await createAccount(e.DB, { id: "supabase-user-relayed", username: "relayed_member", ageBand: "18+" });
    expect((await relay("members", await issueRoomKey(e.DB, membersId, account.id))).status).toBe(200);
    // A game for older players: a younger account gets no relay either.
    await e.DB.prepare("UPDATE games SET minimum_player_age_years = 18 WHERE id = ?").bind(membersId).run();
    const teen = await createAccount(e.DB, { id: "supabase-user-relayed-teen", username: "relayed_teen", ageBand: "16-17" });
    expect(await (await relay("members", await issueRoomKey(e.DB, membersId, teen.id))).json()).toMatchObject({ error: { code: "game_not_open_to_player" } });
    expect((await relay("members", await issueRoomKey(e.DB, membersId, account.id))).status).toBe(200);

    // The site's hosting job paused the game's hosting: no new relayed connections, whatever the month's use says.
    const month = monthStartDateOf();
    await e.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, paused_at_ms) VALUES (?, ?, 499, NULL)").bind(id, month).run();
    expect((await isHostingPaused(e.DB, id)).isPaused).toBe(false);
    expect((await relay("duel", await issueRoomKey(e.DB, id))).status).toBe(200);
    await e.DB.prepare("UPDATE game_hosting_months SET paused_at_ms = ?, paused_reason = 'free_used' WHERE game_id = ? AND month_start_date = ?").bind(Date.now(), id, month).run();
    expect((await isHostingPaused(e.DB, id)).isPaused).toBe(true);
    expect(await (await relay("duel", await issueRoomKey(e.DB, id))).json()).toMatchObject({ error: { code: "hosting_paused" } });
    // Last month's pause is over.
    await e.DB.prepare("UPDATE game_hosting_months SET month_start_date = '2020-01-01' WHERE game_id = ?").bind(id).run();
    expect((await relay("duel", await issueRoomKey(e.DB, id))).status).toBe(200);
  });

  it("reads each game's relayed data back from Cloudflare, for the hosting meter", async () => {
    const id = await addGame("duel");
    const quietId = await addGame("quiet");
    const nowMs = Date.now();
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const yesterday = new Date(nowMs - 86_400_000).toISOString().slice(0, 10);
    // Credentials from yesterday, still at work today; a game whose players never got any isn't asked about.
    await e.DB.prepare("INSERT INTO room_usage (game_id, date, relay_credential_count) VALUES (?, ?, 3), (?, ?, 1)").bind(id, yesterday, quietId, today).run();
    await addGame("never");
    await syncRelayUse(e, e.DB, nowMs);
    const { results } = await e.DB.prepare("SELECT game_id, date, relayed_size_bytes FROM room_usage ORDER BY game_id, date").all();
    expect(results).toEqual([
      { game_id: id, date: yesterday, relayed_size_bytes: 10_000_000 },
      { game_id: id, date: today, relayed_size_bytes: 30_000_000 },
      { game_id: quietId, date: today, relayed_size_bytes: 0 },
    ]);
    // Read again an hour later: the same day's total, never added twice.
    await syncRelayUse(e, e.DB, nowMs);
    const use = await roomUseThisMonth(e.DB, id, nowMs);
    const thisMonthBytes = (yesterday.slice(0, 7) === today.slice(0, 7) ? 10_000_000 : 0) + 30_000_000;
    expect(use).toEqual({ roomPlayDurationSec: 0, relayedSizeBytes: thisMonthBytes, gameServerCpuDurationMs: 0 });
  });
});
