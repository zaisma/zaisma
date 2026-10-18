import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEPT_PLAYED_GAME_COUNT, MAXIMUM_WEBHOOK_ATTEMPT_COUNT, accountDeletionReach, createAccount, createApiKey, createGame, createReport, deleteAccount, queuePlayerErase, recordPlayed, signatureFor, useSignInGrant } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { judgeSays, readsNothing, seesNothing } from "./scan-stubs.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { adminForm } from "../../apps/site/src/admin.ts";
import { deliverDueWebhooks, eraseDuePlayers, noticeFreeUseAlerts, tellAccountDeleted, tellAlertNotices, tellGameServerErrors } from "../../apps/site/src/webhooks.ts";
import { triageReports, type TriageDeps } from "../../apps/site/src/triage.ts";
import { WEBHOOK_EVENT } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

const SITE = "https://zaisma.test";
const HOOKS = "https://hooks.skyhopper.io/zaisma";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const pass: ScanDeps = {
  images: { check: async (images) => ({ provider: "test", isConnected: true, checkedMediaCount: images.length, findings: [] }) },
  readCode: readsNothing,
  readPictures: seesNothing,
  judge: judgeSays("pass"),
};

let token = "";
let other = "";
let nextId = 1;

/** What the developer's server got, and how it answers. */
interface Received {
  url: string;
  headers: Headers;
  body: string;
}
let received: Received[] = [];
let answerStatus = 200;
const realFetch = globalThis.fetch;

async function tool(name: string, args: Record<string, unknown> = {}, key = token): Promise<any> {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
  });
  const { result } = (await response.json()) as { result: { content: { text: string }[]; isError?: boolean; structuredContent?: any } };
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** Checks a request the Standard Webhooks way, from the spec, without Zaisma's own code. */
async function isSignedBy(request: Received, signingSecret: string): Promise<boolean> {
  const secretBytes = Uint8Array.from(atob(signingSecret.slice("whsec_".length)), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = `${request.headers.get("webhook-id")}.${request.headers.get("webhook-timestamp")}.${request.body}`;
  const signatures = (request.headers.get("webhook-signature") ?? "").split(" ").map((part) => part.replace(/^v1,/, ""));
  for (const signature of signatures) {
    const signatureBytes = Uint8Array.from(atob(signature), (character) => character.charCodeAt(0));
    if (await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(signed))) return true;
  }
  return false;
}

async function publishedGame(slug: string) {
  await tool("create_game", { title: slug.replace(/-/g, " "), slug });
  const upload = await tool("upload_files", { slug, files: [{ path: "index.html", content_text: `<!doctype html><p>${slug}</p>` }] });
  return upload.version.id as string;
}

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM webhook_deliveries; DELETE FROM webhooks; DELETE FROM reports; DELETE FROM ai_usage; DELETE FROM blobs; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
  await letPublish(env.DB, "dev-2");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  other = (await createApiKey(env.DB, "dev-2", "claude")).token;
  received = [];
  answerStatus = 200;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://hooks.skyhopper.io/")) return realFetch(input, init);
    received.push({ url, headers: new Headers(init?.headers), body: String(init?.body) });
    return new Response(answerStatus === 204 ? null : "ok", { status: answerStatus });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signatures", () => {
  it("match Standard Webhooks' own example", async () => {
    // From the Standard Webhooks spec's test vectors (github.com/standard-webhooks/standard-webhooks).
    expect(await signatureFor("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}')).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });
});

describe("making webhooks", () => {
  it("makes, lists, changes and deletes one, with its secret answered only when made or replaced", async () => {
    const made = await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["bug_reported", "bug_reported"] });
    expect(made.webhook).toMatchObject({ endpoint_url: HOOKS, event_kinds: ["bug_reported"], game_slugs: null, pending_delivery_count: 0, failed_delivery_count: 0 });
    expect(made.signing_secret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(made.next_steps).toEqual([{ tool: "test_webhook", arguments: { webhook_id: made.webhook.id }, after_sec: null, reason: expect.any(String) }]);

    const listed = await tool("list_webhooks");
    expect(listed.webhooks).toEqual([made.webhook]);
    expect(JSON.stringify(listed)).not.toContain(made.signing_secret);

    const changed = await tool("update_webhook", { webhook_id: made.webhook.id, event_kinds: ["scan_status_changed"] });
    expect(changed.webhook.event_kinds).toEqual(["scan_status_changed"]);
    expect(changed.signing_secret).toBeNull();
    expect(changed.next_steps).toEqual([]);
    const replaced = await tool("update_webhook", { webhook_id: made.webhook.id, replace_signing_secret: true });
    expect(replaced.signing_secret).toMatch(/^whsec_/);
    expect(replaced.signing_secret).not.toBe(made.signing_secret);

    // Someone else's webhook looks like no webhook.
    expect((await tool("delete_webhook", { webhook_id: made.webhook.id }, other)).error.code).toBe("no_webhook");
    expect(await tool("delete_webhook", { webhook_id: made.webhook.id })).toEqual({ removed_webhook_id: made.webhook.id, next_steps: [] });
    expect((await tool("list_webhooks")).webhooks).toEqual([]);
  });

  it("refuses addresses it shouldn't send to, kinds it doesn't have and games that aren't yours", async () => {
    const make = (args: Record<string, unknown>) => tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["bug_reported"], ...args });
    for (const endpointUrl of ["http://hooks.skyhopper.io/zaisma", "https://203.0.113.9/hook", "https://localhost/hook", "https://zaisma.com/api/dev/games", "https://sky.zaismausercontent.com/", "https://zaisma.test/x", "https://user:pass@hooks.skyhopper.io/", "not a url"]) {
      expect((await make({ endpoint_url: endpointUrl })).error, endpointUrl).toMatchObject({ code: "bad_endpoint_url", field: "endpoint_url" });
    }
    expect((await make({ event_kinds: ["all"] })).error).toMatchObject({ code: "bad_event_kinds", field: "event_kinds" });
    await tool("create_game", { title: "Their Game", slug: "their-game" }, other);
    expect((await make({ game_slugs: ["their-game"] })).error).toMatchObject({ code: "no_game", field: "game_slugs[0]" });

    for (let i = 0; i < 10; i++) await make({});
    expect((await make({})).error.code).toBe("too_many_webhooks");
  });
});

describe("sending events", () => {
  it("sends a signed test event once, and says how it went", async () => {
    const { webhook, signing_secret: signingSecret } = await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["bug_reported"] });
    const tested = await tool("test_webhook", { webhook_id: webhook.id });
    expect(tested.delivery).toMatchObject({ webhook_id: webhook.id, delivery_status: "delivered", attempt_count: 1, next_attempt_at: null, failure_message: null });
    expect(tested.delivery.webhook_event).toMatchObject({ kind: "test", game: null, version: null, bug_report: null });
    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request!.headers.get("webhook-id")).toBe(tested.delivery.webhook_event.id);
    expect(Math.abs(Number(request!.headers.get("webhook-timestamp")) - Date.now() / 1000)).toBeLessThan(60);
    expect(await isSignedBy(request!, signingSecret)).toBe(true);
    expect(JSON.parse(request!.body)).toEqual(tested.delivery.webhook_event);

    answerStatus = 500;
    const failed = await tool("test_webhook", { webhook_id: webhook.id });
    expect(failed.delivery).toMatchObject({ delivery_status: "failed", attempt_count: 1, failure_message: expect.stringContaining("500") });
  });

  it("tells a webhook about scans and what players get, as the API answers them", async () => {
    const versionId = await publishedGame("sky-hopper");
    const { webhook, signing_secret: signingSecret } = await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["scan_status_changed", "live_version_changed"], game_slugs: ["sky-hopper"] });
    const ignored = await publishedGame("not-watched");
    await scanVersion(testEnv, ignored, pass);

    await scanVersion(testEnv, versionId, pass);
    expect(received).toHaveLength(1);
    const scanned = JSON.parse(received[0]!.body);
    expect(schemaProblems(WEBHOOK_EVENT, scanned)).toEqual([]);
    expect(scanned).toMatchObject({ kind: "scan_status_changed", game: { slug: "sky-hopper" }, version: { id: versionId, scan_status: "approved" }, bug_report: null });
    expect(scanned.version).toEqual((await tool("get_version", { slug: "sky-hopper", version_id: versionId })).version);

    // Published through the MCP, the event goes out after the answer.
    await tool("publish_version", { slug: "sky-hopper", version_id: versionId });
    await vi.waitFor(() => expect(received).toHaveLength(2));
    const published = JSON.parse(received[1]!.body);
    expect(published).toMatchObject({ kind: "live_version_changed", game: { slug: "sky-hopper", review_status: "live" }, version: { id: versionId, is_live: true } });
    expect(await isSignedBy(received[1]!, signingSecret)).toBe(true);
    expect(received[1]!.headers.get("webhook-id")).not.toBe(received[0]!.headers.get("webhook-id"));

    const { deliveries, next_cursor: nextCursor } = await tool("list_webhook_deliveries", { webhook_id: webhook.id });
    expect(deliveries.map((delivery: { webhook_event: { kind: string } }) => delivery.webhook_event.kind)).toEqual(["live_version_changed", "scan_status_changed"]);
    expect(nextCursor).toBeNull();
  });

  it("tells a webhook when a game is taken down, and when a person passes a bug on", async () => {
    await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["review_status_changed", "bug_reported"] });
    const versionId = await publishedGame("sky-hopper");
    await scanVersion(testEnv, versionId, pass);
    await tool("publish_version", { slug: "sky-hopper", version_id: versionId });
    const game = (await env.DB.prepare("SELECT id FROM games WHERE slug = 'sky-hopper'").first<{ id: string }>())!;

    const takedown = new FormData();
    takedown.set("reason", "Copies another game's art.");
    takedown.set("content_rule", "copyright");
    await adminForm(testEnv, `/admin/games/${game.id}/takedown`, takedown, "admin:julius@example.com");
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]!.body)).toMatchObject({ kind: "review_status_changed", game: { review_status: "removed", review_reason: { message: expect.stringContaining("Copies another game's art.") } } });

    const reportId = await createReport(env.DB, { gameId: game.id, reason: "broken", playerText: "Stuck on level 2", versionId });
    await adminForm(testEnv, `/admin/report-groups/${reportId}/bug`, new FormData(), "admin:julius@example.com");
    expect(received).toHaveLength(2);
    const bug = JSON.parse(received[1]!.body);
    expect(schemaProblems(WEBHOOK_EVENT, bug)).toEqual([]);
    expect(bug).toMatchObject({ kind: "bug_reported", bug_report: { id: reportId, player_text: "Stuck on level 2", version_id: versionId } });
    expect(bug.bug_report).toEqual((await tool("get_reports", { slug: "sky-hopper" })).bug_reports[0]);
  });

  it("tells a webhook about a bug report triage sorted, with the summary get_reports shows", async () => {
    await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["bug_reported"] });
    const versionId = await publishedGame("sky-hopper");
    const game = (await env.DB.prepare("SELECT id FROM games WHERE slug = 'sky-hopper'").first<{ id: string }>())!;
    const reportId = await createReport(env.DB, { gameId: game.id, reason: "broken", playerText: "Freezes when I press jump twice", versionId });
    const sortsAsBug: TriageDeps = {
      random: () => 0.5,
      ai: async () => ({
        severity: "normal",
        category: "broken",
        summary: "Jumping twice freezes the game.",
        recommendation: "bug",
        why: "A technical problem.",
        same_as: "",
        precedent: "",
        fit: "none",
        draft: { title: "", applies_when: "", decision: "", why: "" },
        input_token_count: 500,
        output_token_count: 50,
      }),
    };
    await triageReports(testEnv, sortsAsBug);
    expect(received).toHaveLength(1);
    const bug = JSON.parse(received[0]!.body);
    expect(bug).toMatchObject({ kind: "bug_reported", bug_report: { id: reportId, summary: "Jumping twice freezes the game." } });
    expect(bug.bug_report).toEqual((await tool("get_reports", { slug: "sky-hopper" })).bug_reports[0]);
  });

  it("tries again later, and gives up after the last try", async () => {
    const { webhook } = await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["scan_status_changed"] });
    const versionId = await publishedGame("sky-hopper");
    answerStatus = 503;
    await scanVersion(testEnv, versionId, pass);
    expect(received).toHaveLength(1);
    let [delivery] = (await tool("list_webhook_deliveries", { webhook_id: webhook.id })).deliveries;
    expect(delivery).toMatchObject({ delivery_status: "pending", attempt_count: 1, failure_message: expect.stringContaining("503") });
    expect(Date.parse(delivery.next_attempt_at) - Date.now()).toBeGreaterThan(4 * 60_000);
    expect((await tool("list_webhooks")).webhooks[0]).toMatchObject({ pending_delivery_count: 1, failed_delivery_count: 0 });

    // Not due yet: the cron leaves it.
    await deliverDueWebhooks(testEnv);
    expect(received).toHaveLength(1);
    for (let attempt = 2; attempt <= 6; attempt++) {
      await env.DB.exec("UPDATE webhook_deliveries SET next_attempt_at_ms = 0 WHERE delivery_status = 'pending'");
      await deliverDueWebhooks(testEnv);
      expect(received).toHaveLength(attempt);
    }
    // Every try is the same event, signed again.
    expect(new Set(received.map((request) => request.headers.get("webhook-id"))).size).toBe(1);
    expect(new Set(received.map((request) => request.body)).size).toBe(1);
    [delivery] = (await tool("list_webhook_deliveries", { webhook_id: webhook.id })).deliveries;
    expect(delivery).toMatchObject({ delivery_status: "failed", attempt_count: 6, next_attempt_at: null });
    expect((await tool("list_webhooks")).webhooks[0]).toMatchObject({ pending_delivery_count: 0, failed_delivery_count: 1 });
    await env.DB.exec("UPDATE webhook_deliveries SET next_attempt_at_ms = 0");
    await deliverDueWebhooks(testEnv);
    expect(received).toHaveLength(6);

    // A server that's back takes the next one.
    answerStatus = 204;
    const next = await publishedGame("cave-crew");
    await scanVersion(testEnv, next, pass);
    expect((await tool("list_webhook_deliveries", { webhook_id: webhook.id })).deliveries[0]).toMatchObject({ delivery_status: "delivered", attempt_count: 1 });
  });

  it("sends nothing about other developers' games, and goes with the account", async () => {
    await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["scan_status_changed"] });
    const theirs = await (async () => {
      await tool("create_game", { title: "Their Game", slug: "their-game" }, other);
      return (await tool("upload_files", { slug: "their-game", files: [{ path: "index.html", content_text: "<p>theirs</p>" }] }, other)).version.id as string;
    })();
    await scanVersion(testEnv, theirs, pass);
    expect(received).toEqual([]);

    await deleteAccount(env.DB, "dev-1");
    expect(await env.DB.prepare("SELECT COUNT(*) AS webhook_count FROM webhooks").first("webhook_count")).toBe(0);
  });
});

describe("webhooks to the game server", () => {
  /** The stand-in game servers (test/site/rooms-database-worker.ts): what they were sent, and how they answer next. */
  const gameServers = () => (env as unknown as { GAME_SERVER_WEBHOOKS: { takeSent(nextFailureMessage: string | null): Promise<{ gameId: string; eventJson: string }[]> } }).GAME_SERVER_WEBHOOKS;
  beforeEach(async () => {
    await gameServers().takeSent(null);
  });

  it("send a game's events to its own game server, unsigned and nowhere else", async () => {
    const versionId = await publishedGame("sky-hopper");
    await publishedGame("cave-crew");
    const made = await tool("create_webhook", { destination_kind: "game_server", event_kinds: ["scan_status_changed"], game_slugs: ["sky-hopper"] });
    expect(made.webhook).toMatchObject({ destination_kind: "game_server", endpoint_url: null, event_kinds: ["scan_status_changed"], game_slugs: ["sky-hopper"] });
    expect(made.next_steps[0]).toMatchObject({ tool: "test_webhook", reason: expect.stringContaining("onWebhook") });

    const tested = await tool("test_webhook", { webhook_id: made.webhook.id });
    expect(tested.delivery).toMatchObject({ delivery_status: "delivered", attempt_count: 1, failure_message: null });
    const game = (await env.DB.prepare("SELECT id FROM games WHERE slug = 'sky-hopper'").first<{ id: string }>())!;
    let sent = await gameServers().takeSent(null);
    expect(sent).toEqual([{ gameId: game.id, eventJson: JSON.stringify(tested.delivery.webhook_event) }]);

    await scanVersion(testEnv, await publishedGame("not-watched"), pass);
    await scanVersion(testEnv, versionId, pass);
    sent = await gameServers().takeSent("onWebhook threw: Discord answered 401 (zaisma-server.js:12:9)");
    expect(sent.map((event) => event.gameId)).toEqual([game.id]);
    const event = JSON.parse(sent[0]!.eventJson);
    expect(schemaProblems(WEBHOOK_EVENT, event)).toEqual([]);
    expect(event).toMatchObject({ kind: "scan_status_changed", game: { slug: "sky-hopper" }, version: { id: versionId } });
    expect(received).toEqual([]);

    // What onWebhook threw is the failure, and the event waits for its next try like any other.
    const second = (await tool("upload_files", { slug: "sky-hopper", files: [{ path: "index.html", content_text: "<!doctype html><p>sky hopper 2</p>" }] })).version.id as string;
    await scanVersion(testEnv, second, pass);
    const [delivery] = (await tool("list_webhook_deliveries", { webhook_id: made.webhook.id })).deliveries;
    expect(delivery).toMatchObject({ delivery_status: "pending", attempt_count: 1, failure_message: "onWebhook threw: Discord answered 401 (zaisma-server.js:12:9)" });
    await gameServers().takeSent(null);
    await env.DB.exec("UPDATE webhook_deliveries SET next_attempt_at_ms = 0 WHERE delivery_status = 'pending'");
    await deliverDueWebhooks(testEnv);
    expect((await tool("list_webhook_deliveries", { webhook_id: made.webhook.id })).deliveries[0]).toMatchObject({ delivery_status: "delivered", attempt_count: 2, failure_message: null });
  });

  it("take one of your games, and no address", async () => {
    await publishedGame("sky-hopper");
    await publishedGame("cave-crew");
    await tool("create_game", { title: "Their Game", slug: "their-game" }, other);
    const make = (args: Record<string, unknown>) => tool("create_webhook", { destination_kind: "game_server", event_kinds: ["bug_reported"], game_slugs: ["sky-hopper"], ...args });
    expect((await make({ destination_kind: "discord" })).error).toMatchObject({ code: "bad_destination_kind", field: "destination_kind" });
    expect((await make({ endpoint_url: HOOKS })).error).toMatchObject({ code: "bad_endpoint_url", field: "endpoint_url" });
    expect((await make({ game_slugs: undefined })).error).toMatchObject({ code: "missing_field", field: "game_slugs" });
    expect((await make({ game_slugs: null })).error).toMatchObject({ code: "bad_game_slugs", field: "game_slugs" });
    expect((await make({ game_slugs: ["sky-hopper", "cave-crew"] })).error).toMatchObject({ code: "bad_game_slugs", field: "game_slugs" });
    expect((await make({ game_slugs: ["their-game"] })).error).toMatchObject({ code: "no_game", field: "game_slugs[0]" });
    expect((await make({ endpoint_url: null })).webhook).toMatchObject({ destination_kind: "game_server", endpoint_url: null });
  });

  it("move to your own server and back, keeping what fits", async () => {
    await publishedGame("sky-hopper");
    await publishedGame("cave-crew");
    const { webhook } = await tool("create_webhook", { destination_kind: "game_server", event_kinds: ["bug_reported"], game_slugs: ["sky-hopper"] });
    const update = (args: Record<string, unknown>) => tool("update_webhook", { webhook_id: webhook.id, ...args });
    expect((await update({ game_slugs: null })).error).toMatchObject({ code: "bad_game_slugs" });
    expect((await update({ endpoint_url: HOOKS })).error).toMatchObject({ code: "bad_endpoint_url" });
    expect((await update({ destination_kind: "endpoint_url" })).error).toMatchObject({ code: "missing_field", field: "endpoint_url" });
    expect((await update({ game_slugs: ["cave-crew"] })).webhook).toMatchObject({ destination_kind: "game_server", game_slugs: ["cave-crew"] });

    const moved = await update({ destination_kind: "endpoint_url", endpoint_url: HOOKS });
    expect(moved.webhook).toMatchObject({ destination_kind: "endpoint_url", endpoint_url: HOOKS, game_slugs: ["cave-crew"] });
    expect(moved.next_steps[0]).toMatchObject({ tool: "test_webhook" });
    expect((await update({ game_slugs: null })).webhook.game_slugs).toBeNull();
    // Back to a game server: it needs one game again, and the address goes.
    expect((await update({ destination_kind: "game_server" })).error).toMatchObject({ code: "bad_game_slugs" });
    expect((await update({ destination_kind: "game_server", game_slugs: ["sky-hopper"] })).webhook).toMatchObject({ destination_kind: "game_server", endpoint_url: null, game_slugs: ["sky-hopper"] });
  });

  it("stop reaching a game that isn't yours any more", async () => {
    await publishedGame("sky-hopper");
    const { webhook } = await tool("create_webhook", { destination_kind: "game_server", event_kinds: ["bug_reported"], game_slugs: ["sky-hopper"] });
    await env.DB.exec("UPDATE games SET owner_id = NULL WHERE slug = 'sky-hopper'");
    const tested = await tool("test_webhook", { webhook_id: webhook.id });
    expect(tested.delivery).toMatchObject({ delivery_status: "failed", failure_message: expect.stringContaining("no game sky-hopper") });
    expect(await gameServers().takeSent(null)).toEqual([]);
  });
});

describe("deleting an account reaches developers", () => {
  const gameServers = () => (env as unknown as { GAME_SERVER_WEBHOOKS: { takeSent(nextFailureMessage: string | null): Promise<{ gameId: string; eventJson: string }[]> } }).GAME_SERVER_WEBHOOKS;
  const gameId = async (slug: string) => (await env.DB.prepare("SELECT id FROM games WHERE slug = ?").bind(slug).first<{ id: string }>())!.id;

  /** Mia, a player who played sky-hopper, saved in cave-crew and signed in to a site; deleted the way /account/delete does it. */
  async function miaPlaysAndDeletes(): Promise<string> {
    await createAccount(env.DB, { id: "mia", username: "mia_plays", ageBand: "18+" });
    const playerId = (await env.DB.prepare("SELECT player_id FROM accounts WHERE id = 'mia'").first<{ player_id: string }>())!.player_id;
    await recordPlayed(env.DB, "mia", await gameId("sky-hopper"));
    await env.DB.prepare("INSERT INTO saves (account_id, game_id, version_number, sha256, size_bytes, updated_at_ms) VALUES ('mia', ?, 1, 'x', 2, 0)").bind(await gameId("cave-crew")).run();
    const app = await (await SELF.fetch(`${SITE}/api/dev/sign-in-apps`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Hop Online", kind: "public", redirect_urls: ["https://hop.example.test/back"] }) })).json<any>();
    await useSignInGrant(env.DB, "mia", app.sign_in_app.id);
    const reach = await accountDeletionReach(env.DB, "mia");
    expect(reach).toEqual({ playerId, gameIds: [await gameId("cave-crew"), await gameId("sky-hopper")].sort(), signInAppIds: [app.sign_in_app.id] });
    await deleteAccount(env.DB, "mia");
    await tellAccountDeleted(testEnv, reach);
    return playerId;
  }

  // Played games and saves point at games, so they go before the next test deletes the games.
  const forget = () => env.DB.exec("DELETE FROM player_erases; DELETE FROM games_ever_played; DELETE FROM played; DELETE FROM saves; DELETE FROM sign_in_grants; DELETE FROM sign_in_codes; DELETE FROM sign_in_apps;");
  afterEach(forget);
  beforeEach(async () => {
    await forget();
    await gameServers().takeSent(null);
    // A developer of its own per test: these make many calls, and the API's limit is per account.
    const developerId = `dev-${crypto.randomUUID().slice(0, 8)}`;
    await createAccount(env.DB, { id: developerId, username: `Dev_${developerId.slice(4)}`, ageBand: "18+" });
    await letPublish(env.DB, developerId);
    token = (await createApiKey(env.DB, developerId, "claude")).token;
    await publishedGame("sky-hopper");
    await publishedGame("cave-crew");
  });

  it("tells each game the player played and each site they signed in to, with their player ID", async () => {
    const everything = await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["account_deleted"] });
    await tool("create_webhook", { endpoint_url: `${HOOKS}/sky`, event_kinds: ["account_deleted"], game_slugs: ["sky-hopper"] });
    await tool("create_webhook", { destination_kind: "game_server", event_kinds: ["account_deleted"], game_slugs: ["sky-hopper"] });
    await tool("create_webhook", { endpoint_url: `${HOOKS}/scans`, event_kinds: ["scan_status_changed"] });
    const playerId = await miaPlaysAndDeletes();

    const events = received.map((request) => ({ url: request.url, event: JSON.parse(request.body) }));
    for (const { event } of events) {
      expect(schemaProblems(WEBHOOK_EVENT, event)).toEqual([]);
      expect(event).toMatchObject({ kind: "account_deleted", player_id: playerId, version: null, bug_report: null });
    }
    const said = events.map(({ url, event }) => `${url} ${event.game?.slug ?? event.sign_in_app.name}`).sort();
    // A webhook limited to games never takes a site's event, and the scans webhook takes none.
    expect(said).toEqual([`${HOOKS} Hop Online`, `${HOOKS} cave-crew`, `${HOOKS} sky-hopper`, `${HOOKS}/sky sky-hopper`]);
    expect(events.find(({ event }) => event.sign_in_app)!.event.game).toBeNull();
    expect(await isSignedBy(received.find((request) => request.url === HOOKS)!, everything.signing_secret)).toBe(true);
    // The game's own game server gets it too.
    const sent = await gameServers().takeSent(null);
    expect(sent.map((event) => JSON.parse(event.eventJson))).toEqual([expect.objectContaining({ kind: "account_deleted", player_id: playerId, game: expect.objectContaining({ slug: "sky-hopper" }) })]);
    // Every other event says player_id and sign_in_app too, as null.
    const tested = await tool("test_webhook", { webhook_id: everything.webhook.id });
    expect(tested.delivery.webhook_event).toMatchObject({ kind: "test", player_id: null, sign_in_app: null });
  });

  it("erases the player from each game's database unless the game turned it off", async () => {
    for (const slug of ["sky-hopper", "cave-crew"]) {
      await tool("query_database", { slug, sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)" });
    }
    expect((await tool("update_game", { slug: "cave-crew", deleted_account_erase_enabled: false })).game.deleted_account_erase_enabled).toBe(false);
    await createAccount(env.DB, { id: "mia", username: "mia_plays", ageBand: "18+" });
    const miaPlayerId = (await env.DB.prepare("SELECT player_id FROM accounts WHERE id = 'mia'").first<{ player_id: string }>())!.player_id;
    for (const slug of ["sky-hopper", "cave-crew"]) {
      await tool("query_database", { slug, sql: "INSERT INTO scores VALUES (?, 10), ('player_kai', 20)", values: [miaPlayerId] });
    }
    await recordPlayed(env.DB, "mia", await gameId("sky-hopper"));
    await recordPlayed(env.DB, "mia", await gameId("cave-crew"));
    const reach = await accountDeletionReach(env.DB, "mia");
    await deleteAccount(env.DB, "mia");
    await tellAccountDeleted(testEnv, reach);
    expect((await tool("query_database", { slug: "sky-hopper", sql: "SELECT player_id FROM scores" })).rows).toEqual([{ player_id: "player_kai" }]);
    expect((await tool("query_database", { slug: "cave-crew", sql: "SELECT player_id FROM scores ORDER BY best_score" })).rows).toEqual([{ player_id: miaPlayerId }, { player_id: "player_kai" }]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS erase_count FROM player_erases").first("erase_count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS played_count FROM games_ever_played WHERE account_id = 'mia'").first("played_count")).toBe(0);
  });

  it("remembers every game played, not only Continue playing's newest 20", async () => {
    await createAccount(env.DB, { id: "mia", username: "mia_plays", ageBand: "18+" });
    const ownerId = (await env.DB.prepare("SELECT owner_id FROM games WHERE slug = 'sky-hopper'").first<{ owner_id: string }>())!.owner_id;
    await recordPlayed(env.DB, "mia", await gameId("sky-hopper"), Date.now() - 60_000);
    for (let i = 0; i < KEPT_PLAYED_GAME_COUNT; i++) {
      const game = await createGame(env.DB, { slug: `filler-${i}`, title: `Filler ${i}`, description: "", ownerId });
      await recordPlayed(env.DB, "mia", game.id, Date.now() + i);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS played_count FROM played WHERE account_id = 'mia' AND game_id = ?").bind(await gameId("sky-hopper")).first("played_count")).toBe(0);
    expect((await accountDeletionReach(env.DB, "mia")).gameIds).toContain(await gameId("sky-hopper"));
  });

  it("tries an erase again while the database doesn't answer, and says when it failed for good", async () => {
    await tool("query_database", { slug: "sky-hopper", sql: "CREATE TABLE players (player_id TEXT PRIMARY KEY)" });
    await tool("query_database", { slug: "sky-hopper", sql: "CREATE TABLE trophies (owner TEXT REFERENCES players (player_id))" });
    const sky = await gameId("sky-hopper");
    // No game databases connected: the erase waits.
    await queuePlayerErase(env.DB, sky, "player_waiting");
    await eraseDuePlayers({ ...testEnv, GAME_DATABASES: undefined });
    expect(await env.DB.prepare("SELECT erase_status, attempt_count FROM player_erases WHERE player_id = 'player_waiting'").first()).toEqual({ erase_status: "pending", attempt_count: 0 });
    await eraseDuePlayers(testEnv);
    expect(await env.DB.prepare("SELECT COUNT(*) AS erase_count FROM player_erases WHERE player_id = 'player_waiting'").first("erase_count")).toBe(0);

    // A foreign key refuses it every try: after the last, it's an alert with the IDs to erase by hand.
    await tool("query_database", { slug: "sky-hopper", sql: "INSERT INTO players VALUES ('player_stuck')" });
    await tool("query_database", { slug: "sky-hopper", sql: "INSERT INTO trophies VALUES ('player_stuck')" });
    await queuePlayerErase(env.DB, sky, "player_stuck");
    await eraseDuePlayers(testEnv);
    expect(await env.DB.prepare("SELECT erase_status, attempt_count FROM player_erases WHERE player_id = 'player_stuck'").first()).toEqual({ erase_status: "pending", attempt_count: 1 });
    expect((await tool("get_game", { slug: "sky-hopper" })).alerts).toEqual([]);
    await env.DB.exec(`UPDATE player_erases SET attempt_count = ${MAXIMUM_WEBHOOK_ATTEMPT_COUNT - 1}, next_attempt_at_ms = 0`);
    await eraseDuePlayers(testEnv);
    const [alert] = (await tool("get_game", { slug: "sky-hopper" })).alerts;
    expect(alert).toEqual({ kind: "player_erase_failed", message: expect.stringContaining("players"), fix: expect.stringContaining("erase_player with each player_id: player_stuck"), version_id: null });
    // Once the developer fixes what stopped it, the erase the fix names works.
    await tool("query_database", { slug: "sky-hopper", sql: "DELETE FROM trophies" });
    expect((await tool("erase_player", { slug: "sky-hopper", player_id: "player_stuck" })).erased_tables).toEqual([{ table_name: "players", erased_row_count: 1 }]);
  });
});

describe("room events", () => {
  const gameServers = () => (env as unknown as { GAME_SERVER_WEBHOOKS: { takeSent(nextFailureMessage: string | null): Promise<{ gameId: string; eventJson: string }[]> } }).GAME_SERVER_WEBHOOKS;
  const today = () => new Date().toISOString().slice(0, 10);
  const gameId = async (slug: string) => (await env.DB.prepare("SELECT id FROM games WHERE slug = ?").bind(slug).first<{ id: string }>())!.id;
  const events = () => received.map((request) => JSON.parse(request.body));

  async function api(path: string, key = token): Promise<any> {
    const response = await SELF.fetch(`${SITE}/api/dev${path}`, { headers: { authorization: `Bearer ${key}` } });
    expect(response.status).toBe(200);
    return response.json();
  }

  async function addError(slug: string, versionId: string, message: string, firstAtMs = Date.now() - 60_000) {
    await env.DB.prepare("INSERT INTO game_server_errors (game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms, told_webhooks_at_ms) VALUES (?, ?, 'crash', ?, 3, ?, ?, NULL)")
      .bind(await gameId(slug), versionId, message, firstAtMs, firstAtMs + 30_000)
      .run();
  }

  async function setUse(slug: string, columns: { room_play_duration_sec?: number; game_server_request_count?: number }) {
    await env.DB.prepare("INSERT OR REPLACE INTO room_usage (game_id, date, room_play_duration_sec, game_server_request_count) VALUES (?, ?, ?, ?)")
      .bind(await gameId(slug), today(), columns.room_play_duration_sec ?? 0, columns.game_server_request_count ?? 0)
      .run();
  }

  async function tellAlerts() {
    await noticeFreeUseAlerts(testEnv);
    await tellAlertNotices(testEnv);
  }

  // Calls are limited per account each minute, so each test here has an account of its own.
  let accountNumber = 0;
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM alert_notices; DELETE FROM game_server_errors; DELETE FROM room_usage;");
    await gameServers().takeSent(null);
    accountNumber++;
    await createAccount(env.DB, { id: `dev-room-${accountNumber}`, username: `Room_Dev_${accountNumber}`, ageBand: "18+" });
    await letPublish(env.DB, `dev-room-${accountNumber}`);
    token = (await createApiKey(env.DB, `dev-room-${accountNumber}`, "claude")).token;
  });

  it("are kinds a webhook takes", async () => {
    const made = await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["game_server_error_found", "alert_raised"] });
    expect(made.webhook.event_kinds).toEqual(["game_server_error_found", "alert_raised"]);
    const response = await SELF.fetch(`${SITE}/api/dev/webhooks`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ endpoint_url: HOOKS, event_kinds: ["alert_raised"] }),
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as any).webhook.event_kinds).toEqual(["alert_raised"]);
  });

  it("tell a webhook about a new game server error once, as get_stats lists it", async () => {
    const versionId = await publishedGame("sky-hopper");
    await env.DB.exec("UPDATE games SET multiplayer_mode = 'own' WHERE slug = 'sky-hopper'");
    await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["game_server_error_found"] });
    await addError("sky-hopper", versionId, "TypeError: state.players is undefined (zaisma-server.js:14:3)");

    await tellGameServerErrors(testEnv);
    expect(received).toHaveLength(1);
    const [event] = events();
    expect(schemaProblems(WEBHOOK_EVENT, event)).toEqual([]);
    expect(event).toMatchObject({ kind: "game_server_error_found", game: { slug: "sky-hopper" }, version: { id: versionId }, bug_report: null, alert: null });
    const stats = await api("/games/sky-hopper/stats");
    expect(stats.game_server_errors).toHaveLength(1);
    expect(event.game_server_error).toEqual(stats.game_server_errors[0]);
    expect(event.version.id).toBe(event.game_server_error.version_id);

    await tellGameServerErrors(testEnv);
    expect(received).toHaveLength(1);
  });

  it("send at most 20 game server errors a game a day, marking the rest told", async () => {
    const versionId = await publishedGame("sky-hopper");
    await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["game_server_error_found"] });
    const startMs = Date.now() - 3_600_000;
    for (let i = 0; i < 21; i++) await addError("sky-hopper", versionId, `Error ${i} (zaisma-server.js:${i + 1}:1)`, startMs + i * 1000);

    await tellGameServerErrors(testEnv);
    expect(received).toHaveLength(20);
    expect(events().map((event) => event.game_server_error.message)).toEqual(Array.from({ length: 20 }, (_, i) => `Error ${i} (zaisma-server.js:${i + 1}:1)`));
    const last = await env.DB.prepare("SELECT told_webhooks_at_ms FROM game_server_errors WHERE message = 'Error 20 (zaisma-server.js:21:1)'").first<number | null>("told_webhooks_at_ms");
    expect(last).not.toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS untold_count FROM game_server_errors WHERE told_webhooks_at_ms IS NULL").first("untold_count")).toBe(0);

    await tellGameServerErrors(testEnv);
    expect(received).toHaveLength(20);
  });

  it("never send an error onWebhook threw back to the game's own game server", async () => {
    const versionId = await publishedGame("sky-hopper");
    await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["game_server_error_found"] });
    await tool("create_webhook", { destination_kind: "game_server", event_kinds: ["game_server_error_found"], game_slugs: ["sky-hopper"] });

    await addError("sky-hopper", versionId, "onWebhook threw: Discord answered 401 (zaisma-server.js:12:9)");
    await tellGameServerErrors(testEnv);
    expect(events().map((event) => event.game_server_error.message)).toEqual(["onWebhook threw: Discord answered 401 (zaisma-server.js:12:9)"]);
    expect(await gameServers().takeSent(null)).toEqual([]);

    // Any other error reaches both.
    await addError("sky-hopper", versionId, "onJoin threw: oops (zaisma-server.js:3:9)");
    await tellGameServerErrors(testEnv);
    expect(received).toHaveLength(2);
    const sent = await gameServers().takeSent(null);
    expect(sent.map((each) => JSON.parse(each.eventJson).game_server_error.message)).toEqual(["onJoin threw: oops (zaisma-server.js:3:9)"]);
  });

  it("tell a webhook when rooms are nearly used, once a month, then when they pause", async () => {
    await publishedGame("sky-hopper");
    await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["alert_raised"] });
    await setUse("sky-hopper", { room_play_duration_sec: 850 * 3600 });

    await tellAlerts();
    expect(received).toHaveLength(1);
    const [event] = events();
    expect(schemaProblems(WEBHOOK_EVENT, event)).toEqual([]);
    expect(event).toMatchObject({ kind: "alert_raised", game: { slug: "sky-hopper" }, version: null, game_server_error: null, alert: { kind: "rooms_nearly_paused" } });
    const { alerts } = await api("/games/sky-hopper");
    expect(event.alert).toEqual(alerts.find((alert: { kind: string }) => alert.kind === "rooms_nearly_paused"));

    await tellAlerts();
    expect(received).toHaveLength(1);

    await setUse("sky-hopper", { room_play_duration_sec: 1000 * 3600 });
    await tellAlerts();
    expect(received).toHaveLength(2);
    expect(events()[1].alert.kind).toBe("rooms_paused");
    expect(events()[1].alert).toEqual((await api("/games/sky-hopper")).alerts.find((alert: { kind: string }) => alert.kind === "rooms_paused"));
    await tellAlerts();
    expect(received).toHaveLength(2);
  });

  it("tell an address that requests paused, but not the game's own game server", async () => {
    await publishedGame("sky-hopper");
    await tool("create_webhook", { endpoint_url: HOOKS, event_kinds: ["alert_raised"] });
    await tool("create_webhook", { destination_kind: "game_server", event_kinds: ["alert_raised"], game_slugs: ["sky-hopper"] });
    await setUse("sky-hopper", { game_server_request_count: 1_000_000 });

    await tellAlerts();
    // Straight past the heads-up: only the paused alert goes out.
    expect(events().map((event) => event.alert.kind)).toEqual(["requests_paused"]);
    expect(schemaProblems(WEBHOOK_EVENT, events()[0])).toEqual([]);
    expect(await gameServers().takeSent(null)).toEqual([]);
  });

  it("go only to webhooks that take alert_raised, for the developer's own games", async () => {
    await publishedGame("sky-hopper");
    await tool("create_webhook", { endpoint_url: `${HOOKS}/bugs`, event_kinds: ["bug_reported", "game_server_error_found"] });
    await tool("create_webhook", { endpoint_url: `${HOOKS}/theirs`, event_kinds: ["alert_raised"] }, other);
    await tool("create_webhook", { endpoint_url: `${HOOKS}/alerts`, event_kinds: ["alert_raised"] });
    await setUse("sky-hopper", { room_play_duration_sec: 900 * 3600 });

    await tellAlerts();
    expect(received.map((request) => request.url)).toEqual([`${HOOKS}/alerts`]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS untold_count FROM alert_notices WHERE told_webhooks_at_ms IS NULL").first("untold_count")).toBe(0);
  });
});
