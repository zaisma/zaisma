import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createApiKey, createReport, deleteAccount, signatureFor } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { adminForm } from "../../apps/site/src/admin.ts";
import { deliverDueWebhooks } from "../../apps/site/src/webhooks.ts";
import { triageReports, type TriageDeps } from "../../apps/site/src/triage.ts";
import { WEBHOOK_EVENT } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";

const SITE = "https://zaisma.test";
const HOOKS = "https://hooks.skyhopper.io/zaisma";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const pass: ScanDeps = {
  images: { check: async (images) => ({ provider: "test", isConnected: true, checkedMediaCount: images.length, findings: [] }) },
  ai: async () => ({ report: { model: "test", verdict: "pass", summary: "fine", input_token_count: 10, output_token_count: 1 }, findings: [], isChildSafety: false }),
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
  await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
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
