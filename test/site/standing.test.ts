import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createApiKey, noteRuling, personOwner, recordReturningPlay, standingOf } from "@zaisma/core";
import { issueTicket } from "../../apps/site/src/plays.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { ADMIN_TOOLS } from "../../apps/site/src/admin-mcp.ts";
import { checkStanding } from "../../apps/site/src/standing.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// Account standing (packages/core/src/standing.ts, apps/site/src/standing.ts): counted plays by signed-in players,
// the daily count, rulings, cards and bans, what GET /access and get_access say, and the admin MCP's set_zaisma_account.

const SITE = "https://zaisma.test";
const LOCAL = "http://localhost";
const SUPABASE = "https://supabase.test";
const DAY = 86_400_000;
/** A fixed now, so nothing here reads the real clock's date. */
const NOW = 1_800_000_000_000;
const realFetch = globalThis.fetch;
let token = "";
let nextId = 1;
let ownerId = "";
let signingKeys: CryptoKeyPair;
let publicKey: JsonWebKey;

const b64url = (given: ArrayBuffer | string) =>
  btoa(typeof given === "string" ? given : String.fromCharCode(...new Uint8Array(given)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The session cookie of a signed-in account, as Supabase would sign it. */
async function sessionCookie(accountId: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "standing-test-key", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ sub: accountId, email: "", aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }] }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `__Host-zaisma=${header}.${claims}.${b64url(signature)}~r-${accountId}`;
}

async function tool(name: string, toolArguments: Record<string, unknown> = {}): Promise<any> {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await response.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

async function adminTool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const response = await SELF.fetch(`${LOCAL}/admin/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }) });
  const { result } = (await response.json()) as any;
  expect(result.isError).toBeFalsy();
  expect(schemaProblems(ADMIN_TOOLS.find((candidate) => candidate.name === name)!.outputSchema, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** Players who came back to the developer's game: accounts a week old that played on 3 days, each counted on the game on 2. */
async function returningPlayers(playerCount: number, options: { createdAtMs?: number; countedPlayDayCount?: number; gameCountedDayCount?: number; idStart?: number } = {}) {
  for (let i = 0; i < playerCount; i++) {
    const id = `player-${(options.idStart ?? 0) + i}`;
    await createAccount(env.DB, { id, username: `Player_${(options.idStart ?? 0) + i}`, ageBand: "18+" });
    await env.DB.prepare("UPDATE accounts SET created_at_ms = ?, counted_play_day_count = ? WHERE id = ?").bind(options.createdAtMs ?? NOW - 30 * DAY, options.countedPlayDayCount ?? 3, id).run();
    await env.DB.prepare("INSERT INTO game_returning_players (game_id, account_id, first_counted_date, last_counted_date, counted_day_count) VALUES ('g-standing', ?, '2026-12-01', '2026-12-02', ?)").bind(id, options.gameCountedDayCount ?? 2).run();
  }
}

const developerAgeDays = (days: number) => env.DB.prepare("UPDATE accounts SET created_at_ms = ? WHERE id = 'dev-1'").bind(NOW - days * DAY).run();
const standing = () => standingOf(env.DB, ownerId, NOW);

beforeAll(async () => {
  signingKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = (await crypto.subtle.exportKey("jwk", signingKeys.publicKey)) as JsonWebKey;
});

beforeEach(async () => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "standing-test-key", alg: "ES256" }] });
    return realFetch(input, init);
  });
  await env.DB.exec(
    "DELETE FROM game_returning_players; DELETE FROM play_days; DELETE FROM play_returns; DELETE FROM play_tickets; DELETE FROM play_networks; DELETE FROM owner_cards; DELETE FROM banned_marks; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  await createAccount(env.DB, { id: "dev-1", username: "Emma_Novak", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  ownerId = (await personOwner(env.DB, "dev-1")).id;
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, owner_id, created_at_ms, updated_at_ms) VALUES ('g-standing', 'standing-game', 'Standing Game', 'live', 'listed', 'v-standing', ?, 0, 0)").bind(ownerId).run();
  await developerAgeDays(30);
});

afterEach(() => vi.unstubAllGlobals());

describe("counted plays", () => {
  it("count a signed-in player once a day per game, toward the game and the player's own days", async () => {
    await createAccount(env.DB, { id: "player-a", username: "Liam_Walker", ageBand: "18+" });
    await recordReturningPlay(env.DB, "g-standing", "player-a", "2026-12-01");
    await recordReturningPlay(env.DB, "g-standing", "player-a", "2026-12-01");
    const row = () => env.DB.prepare("SELECT first_counted_date, last_counted_date, counted_day_count FROM game_returning_players WHERE account_id = 'player-a'").first();
    const days = () => env.DB.prepare("SELECT counted_play_day_count, last_counted_play_date FROM accounts WHERE id = 'player-a'").first();
    expect(await row()).toEqual({ first_counted_date: "2026-12-01", last_counted_date: "2026-12-01", counted_day_count: 1 });
    expect(await days()).toEqual({ counted_play_day_count: 1, last_counted_play_date: "2026-12-01" });
    await recordReturningPlay(env.DB, "g-standing", "player-a", "2026-12-02");
    expect(await row()).toEqual({ first_counted_date: "2026-12-01", last_counted_date: "2026-12-02", counted_day_count: 2 });
    expect(await days()).toEqual({ counted_play_day_count: 2, last_counted_play_date: "2026-12-02" });
  });

  it("come from the game page for a signed-in player, never a guest or the developer", async () => {
    await createAccount(env.DB, { id: "player-a", username: "Liam_Walker", ageBand: "18+" });
    const counted = async (cookie: string | null) => {
      const ticket = await issueTicket(env.DB, "g-standing", { first: null, last: null, cfirst: null, clast: null });
      await env.DB.prepare("UPDATE play_tickets SET issued_at_ms = issued_at_ms - 60000 WHERE id = ?").bind(ticket).run();
      const response = await SELF.fetch(`${SITE}/api/plays/standing-game`, { method: "POST", body: JSON.stringify({ ticket, counted: true }), headers: { "content-type": "text/plain", origin: SITE, ...(cookie ? { cookie } : {}) } });
      expect(response.status).toBe(204);
    };
    await counted(null);
    expect((await env.DB.prepare("SELECT COUNT(*) AS row_count FROM game_returning_players").first<{ row_count: number }>())!.row_count).toBe(0);
    await counted(await sessionCookie("dev-1"));
    expect((await env.DB.prepare("SELECT COUNT(*) AS row_count FROM game_returning_players").first<{ row_count: number }>())!.row_count).toBe(0);
    await counted(await sessionCookie("player-a"));
    expect(await env.DB.prepare("SELECT account_id, counted_day_count FROM game_returning_players").all().then((answer) => answer.results)).toEqual([{ account_id: "player-a", counted_day_count: 1 }]);
    expect((await env.DB.prepare("SELECT play_count FROM play_days WHERE game_id = 'g-standing'").first<{ play_count: number }>())!.play_count).toBe(3);
  });
});

describe("the daily count", () => {
  it("makes a 14-day-old developer with 20 returning players established, opening links and search engines", async () => {
    await returningPlayers(20);
    expect(await standing()).toMatchObject({ isEstablishedDeveloper: false, outsideLinksEnabled: false, searchEnginesEnabled: false });
    await developerAgeDays(14);
    await checkStanding(env, NOW);
    expect(await standing()).toMatchObject({ isEstablishedDeveloper: true, outsideLinksEnabled: true, searchEnginesEnabled: true, returningPlayerCount: 20, accountAgeDays: 14 });
  });

  it("doesn't with 19, a 13-day-old account, players who played on 2 days, or the developer's own account", async () => {
    const counted = async () => {
      await env.DB.prepare("UPDATE owners SET standing_checked_at_ms = NULL").run();
      await checkStanding(env, NOW);
      return standing();
    };
    await returningPlayers(19);
    expect(await counted()).toMatchObject({ isEstablishedDeveloper: false, returningPlayerCount: 19 });
    // The developer's own plays never count.
    await env.DB.prepare("UPDATE accounts SET counted_play_day_count = 3 WHERE id = 'dev-1'").run();
    await env.DB.prepare("INSERT INTO game_returning_players (game_id, account_id, first_counted_date, last_counted_date, counted_day_count) VALUES ('g-standing', 'dev-1', '2026-12-01', '2026-12-05', 5)").run();
    expect(await counted()).toMatchObject({ isEstablishedDeveloper: false, returningPlayerCount: 19 });
    // A player whose account played on only 2 days, or is 6 days old, or came back on one day, doesn't count.
    await returningPlayers(1, { idStart: 100, countedPlayDayCount: 2 });
    await returningPlayers(1, { idStart: 101, createdAtMs: NOW - 6 * DAY });
    await returningPlayers(1, { idStart: 102, gameCountedDayCount: 1 });
    expect(await counted()).toMatchObject({ isEstablishedDeveloper: false, returningPlayerCount: 19 });
    await returningPlayers(1, { idStart: 103 });
    await developerAgeDays(13);
    expect(await counted()).toMatchObject({ isEstablishedDeveloper: false, returningPlayerCount: 20, accountAgeDays: 13 });
    await developerAgeDays(14);
    expect(await counted()).toMatchObject({ isEstablishedDeveloper: true });
  });

  it("counts each owner once a day", async () => {
    await returningPlayers(20);
    await checkStanding(env, NOW - DAY / 2);
    await env.DB.exec("DELETE FROM game_returning_players;");
    await checkStanding(env, NOW);
    expect((await standing()).returningPlayerCount).toBe(20);
    await checkStanding(env, NOW + DAY);
    expect((await standing()).returningPlayerCount).toBe(0);
  });
});

describe("rulings, cards and bans", () => {
  it("a game taken down closes links and search engines at once, and they open again 30 days later", async () => {
    await returningPlayers(20);
    await checkStanding(env, NOW);
    await noteRuling(env.DB, ownerId, NOW);
    expect(await standingOf(env.DB, ownerId, NOW + 1)).toMatchObject({ outsideLinksEnabled: false, searchEnginesEnabled: false, rulingWaitEndsAtMs: NOW + 30 * DAY });
    expect(await (await SELF.fetch(`${SITE}/sitemap.xml`)).text()).not.toContain("standing-game");
    await checkStanding(env, NOW + 29 * DAY);
    expect(await standingOf(env.DB, ownerId, NOW + 29 * DAY)).toMatchObject({ isEstablishedDeveloper: false });
    await checkStanding(env, NOW + 31 * DAY);
    expect(await standingOf(env.DB, ownerId, NOW + 31 * DAY)).toMatchObject({ isEstablishedDeveloper: true, outsideLinksEnabled: true, searchEnginesEnabled: true, rulingWaitEndsAtMs: null });
  });

  it("a card that paid Zaisma or a Stripe account opens links, never search engines; a banned card opens nothing", async () => {
    await env.DB.prepare("INSERT INTO owner_cards (owner_id, card_fingerprint_sha256, first_paid_at_ms) VALUES (?, 'card-sha', ?)").bind(ownerId, NOW).run();
    expect(await standing()).toMatchObject({ hasCardOrStripeAccount: true, outsideLinksEnabled: true, searchEnginesEnabled: false });
    await env.DB.prepare("INSERT INTO banned_marks (mark_kind, mark_sha256, banned_account_id, banned_at_ms) VALUES ('card', 'card-sha', 'someone-else', ?)").bind(NOW).run();
    expect(await standing()).toMatchObject({ hasCardOrStripeAccount: false, outsideLinksEnabled: false });
    await env.DB.prepare("UPDATE owners SET stripe_account_id = 'acct_standing', can_take_stripe_payments = 0 WHERE id = ?").bind(ownerId).run();
    expect(await standing()).toMatchObject({ outsideLinksEnabled: false });
    await env.DB.prepare("UPDATE owners SET can_take_stripe_payments = 1 WHERE id = ?").bind(ownerId).run();
    expect(await standing()).toMatchObject({ hasCardOrStripeAccount: true, outsideLinksEnabled: true, searchEnginesEnabled: false });
  });

  it("a banned developer's standing opens nothing", async () => {
    await env.DB.prepare("UPDATE owners SET is_established = 1, can_take_stripe_payments = 1, stripe_account_id = 'acct_banned' WHERE id = ?").bind(ownerId).run();
    await env.DB.prepare("UPDATE accounts SET banned_at_ms = ?, ban_scope = 'developer' WHERE id = 'dev-1'").bind(NOW).run();
    expect(await standing()).toMatchObject({ isEstablishedDeveloper: false, outsideLinksEnabled: false, searchEnginesEnabled: false, isBanned: true });
  });

  it("Zaisma's own accounts are established from the start, by the admin MCP", async () => {
    expect(await adminTool("set_zaisma_account", { username: "Emma_Novak", is_zaisma_account: true })).toEqual({ username: "Emma_Novak", is_zaisma_account: true, next_steps: [] });
    expect(await standing()).toMatchObject({ isEstablishedDeveloper: true, searchEnginesEnabled: true });
    expect(await (await SELF.fetch(`${SITE}/sitemap.xml`)).text()).toContain("standing-game");
    await adminTool("set_zaisma_account", { username: "Emma_Novak", is_zaisma_account: false });
    expect(await standing()).toMatchObject({ isEstablishedDeveloper: false });
  });
});

describe("get_access", () => {
  it("says what's open, how far along the account is, and offers a card or Stripe account while links wait", async () => {
    await env.DB.prepare("UPDATE owners SET returning_player_count = 12 WHERE id = ?").bind(ownerId).run();
    const waiting = await tool("get_access");
    expect(waiting.standing).toEqual({
      is_established_developer: false,
      outside_links_enabled: false,
      search_engines_enabled: false,
      returning_player_count: 12,
      minimum_returning_player_count: 20,
      account_age_days: expect.any(Number),
      minimum_account_age_days: 14,
      has_card_or_stripe_account: false,
      last_ruling_at: null,
      ruling_wait_ends_at: null,
      message_for_people: expect.stringContaining("12 so far"),
    });
    expect(waiting.next_steps.map((step: { tool: string }) => step.tool)).toEqual(["top_up_credit", "connect_stripe_account"]);
    await env.DB.prepare("INSERT INTO owner_cards (owner_id, card_fingerprint_sha256, first_paid_at_ms) VALUES (?, 'card-sha', ?)").bind(ownerId, NOW).run();
    const withCard = await tool("get_access");
    expect(withCard.standing).toMatchObject({ outside_links_enabled: true, search_engines_enabled: false, has_card_or_stripe_account: true });
    expect(withCard.standing.message_for_people).toMatch(/^Links to other sites are open\. Search engines find your games once/);
    expect(withCard.next_steps).toEqual([]);
  });
});
