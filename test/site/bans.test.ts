import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createApiKey, gameBySlug, markSha256, personOwner, sha256Hex, versionById, type ScanReport } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { stopCopy } from "../../apps/site/src/copies.ts";
import { ADMIN_TOOLS } from "../../apps/site/src/admin-mcp.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { judgeSays, passingScanDeps, readsNothing, seesNothing } from "./scan-stubs.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// Account bans (apps/site/src/bans.ts) through the admin MCP, the developer API and MCP, Stripe's events and the
// copy check, against stand-ins for Supabase and Stripe.

const SITE = "https://zaisma.test";
const LOCAL = "http://localhost";
const EVENTS_SECRET = "whsec_test_zaisma";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key", DEV_ADMIN: "1" };
const deps: ScanDeps = { ...passingScanDeps(), readCode: readsNothing, readPictures: seesNothing, judge: judgeSays("pass") };

const tokens = new Map<string, string>();
/** The email Supabase knows each account by. */
const authEmails = new Map<string, string>();
/** The card fingerprint Stripe answers for each payment intent or payment method. */
const cardFingerprints = new Map<string, string>();
const emails: { to: string; subject: string }[] = [];
let alerts: string[] = [];
let nextId = 1;

async function api(accountId: string, path: string, init: { method?: string; body?: unknown; raw?: Uint8Array } = {}) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
    headers: { authorization: `Bearer ${tokens.get(accountId)}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
  const answer = response.headers.get("content-type")?.includes("json") ? ((await response.json()) as any) : null;
  if (!response.ok && answer) expect(errorProblems(answer, response.status)).toEqual([]);
  return { status: response.status, answer };
}

async function developerTool(accountId: string, name: string, toolArguments: Record<string, unknown> = {}): Promise<any> {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tokens.get(accountId)}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await response.json()) as any;
  if (result.isError) return result.structuredContent.error;
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

async function adminTool(name: string, toolArguments: Record<string, unknown> = {}): Promise<any> {
  const response = await SELF.fetch(`${LOCAL}/admin/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }) });
  const { result } = (await response.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent.error;
  }
  expect(schemaProblems(ADMIN_TOOLS.find((candidate) => candidate.name === name)!.outputSchema, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

async function developer(accountId: string, username: string, email: string) {
  await createAccount(env.DB, { id: accountId, username, ageBand: "18+" });
  await letPublish(env.DB, accountId);
  tokens.set(accountId, (await createApiKey(env.DB, accountId, "laptop")).token);
  authEmails.set(accountId, email);
}

/** What the upload command does: send what's missing and make the version, then scan it. */
async function push(accountId: string, slug: string, files: Record<string, string>) {
  const list = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const bytes = new TextEncoder().encode(content);
      return { path, sha256: await sha256Hex(bytes), size_bytes: bytes.byteLength, bytes };
    }),
  );
  const { answer: plan } = await api(accountId, `/games/${slug}/uploads`, { body: { files: list.map(({ bytes: _, ...file }) => file) } });
  for (const file of list.filter((listed) => (plan.missing_file_hashes as string[]).includes(listed.sha256))) await api(accountId, `/files/${file.sha256}`, { method: "PUT", raw: file.bytes });
  const { status, answer } = await api(accountId, `/games/${slug}/versions`, { body: { files: list.map(({ bytes: _, ...file }) => file) } });
  expect(status).toBe(201);
  const report = await scanVersion(testEnv, answer.version.id, deps);
  return { versionId: answer.version.id as string, report };
}

/** An event as Stripe signs it. */
async function stripeEvent(event: unknown): Promise<Response> {
  const body = JSON.stringify(event);
  const signedAtSec = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(EVENTS_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${signedAtSec}.${body}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return SELF.fetch(`${SITE}/stripe/events`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${signedAtSec},v1=${signature}` }, body });
}

async function topUp(accountId: string, paymentIntentId: string) {
  const ownerId = (await personOwner(env.DB, accountId)).id;
  const response = await stripeEvent({
    id: `evt_${paymentIntentId}`,
    type: "checkout.session.completed",
    data: { object: { id: `cs_${paymentIntentId}`, mode: "payment", payment_status: "paid", payment_intent: paymentIntentId, amount_subtotal: 2000, amount_total: 2000, metadata: { owner_id: ownerId } } },
  });
  expect(response.status).toBe(200);
}

const accountRow = (accountId: string) => env.DB.prepare("SELECT banned_at_ms, ban_scope, ban_reason, ban_content_rule FROM accounts WHERE id = ?").bind(accountId).first();
const markCount = async (kind: string) => (await env.DB.prepare("SELECT COUNT(*) AS mark_count FROM banned_marks WHERE mark_kind = ?").bind(kind).first<{ mark_count: number }>())!.mark_count;

let realFetch: typeof fetch;
beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM ban_matches; DELETE FROM banned_marks; DELETE FROM owner_cards; DELETE FROM credit_entries; DELETE FROM checked_files; DELETE FROM blobs; DELETE FROM blob_owners; DELETE FROM owned_blobs; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM security_events; DELETE FROM reports; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  tokens.clear();
  authEmails.clear();
  cardFingerprints.clear();
  emails.length = 0;
  alerts = [];
  realFetch = globalThis.fetch;
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("[alert]")) alerts.push(line);
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://outbox.test") {
      const sent = JSON.parse(String(init?.body)) as { to: string; subject: string };
      emails.push({ to: sent.to, subject: sent.subject });
      return new Response("ok");
    }
    const user = url.origin === "https://supabase.test" ? url.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/) : null;
    if (user) return Response.json({ id: decodeURIComponent(user[1]!), email: authEmails.get(decodeURIComponent(user[1]!)) });
    const paymentIntent = url.hostname === "api.stripe.com" ? url.pathname.match(/^\/v1\/payment_intents\/(.+)$/) : null;
    if (paymentIntent) {
      expect(url.searchParams.get("expand[0]")).toBe("payment_method");
      return Response.json({ id: paymentIntent[1], payment_method: { id: "pm_x", card: { fingerprint: cardFingerprints.get(paymentIntent[1]!) } } });
    }
    const paymentMethod = url.hostname === "api.stripe.com" ? url.pathname.match(/^\/v1\/payment_methods\/(.+)$/) : null;
    if (paymentMethod) return Response.json({ id: paymentMethod[1], card: { fingerprint: cardFingerprints.get(paymentMethod[1]!) } });
    return realFetch(input, init);
  });
  await developer("dev-1", "Emma_Builds", "emma@example.com");
  expect((await api("dev-1", "/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } })).status).toBe(201);
  expect((await api("dev-1", "/games", { body: { title: "Cave Run", slug: "cave-run" } })).status).toBe(201);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a developer ban", () => {
  it("takes down every game, and leaves only get_access, list_games and the export", async () => {
    const banned = await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "developer", why: "Its game asked players for their passwords.", content_rule: "malware" });
    expect(banned).toMatchObject({ username: "Emma_Builds", ban_scope: "developer", taken_down_game_slugs: ["sky-hopper", "cave-run"], banned_mark_count: 1, next_steps: [] });
    for (const slug of ["sky-hopper", "cave-run"]) expect((await gameBySlug(env.DB, slug))!.review_status).toBe("removed");
    // The developer hears by email, with why and how to appeal.
    expect(emails).toEqual([{ to: "emma@example.com", subject: "Zaisma banned your account's developer side" }]);
    expect(await accountRow("dev-1")).toMatchObject({ ban_scope: "developer", ban_reason: "Its game asked players for their passwords.", ban_content_rule: "malware" });

    const refused = await api("dev-1", "/games", { body: { title: "Another One" } });
    expect(refused.status).toBe(403);
    expect(refused.answer.error).toMatchObject({ code: "account_banned", message_for_people: "Zaisma banned this account's developer side for breaking the content rules: Its game asked players for their passwords." });
    for (const name of ["create_game", "upload_files", "publish_version", "get_game"]) {
      const toolArguments = name === "create_game" ? { title: "Again" } : name === "upload_files" ? { slug: "sky-hopper", files: [{ path: "index.html", content_text: "<p>hi</p>" }] } : name === "publish_version" ? { slug: "sky-hopper", version_id: "version_8f3k2m9q1x7c4v6b0n5z" } : { slug: "sky-hopper" };
      expect((await developerTool("dev-1", name, toolArguments)).code, name).toBe("account_banned");
    }

    const access = await developerTool("dev-1", "get_access");
    expect(access).toMatchObject({ ban_scope: "developer", banned_at: expect.stringMatching(/Z$/) });
    expect((await developerTool("dev-1", "list_games")).games).toHaveLength(2);
    expect((await api("dev-1", "/games/sky-hopper/export")).status).toBe(200);
    expect((await api("dev-1", "/games/sky-hopper/export/download")).status).toBe(200);
  });

  it("never shows why for child safety", async () => {
    await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "developer", why: "Abuse material.", content_rule: "child_safety" });
    const refused = await api("dev-1", "/games/sky-hopper");
    expect(refused.answer.error.message_for_people).toBe("Zaisma banned this account's developer side for breaking Zaisma's rules.");
  });

  it("widens to the whole account, and answers already_banned otherwise", async () => {
    await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "developer", why: "Phishing." });
    expect((await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "developer", why: "Again." })).code).toBe("already_banned");
    expect(await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "whole_account", why: "Illegal content." })).toMatchObject({ ban_scope: "whole_account", taken_down_game_slugs: [] });
    expect((await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "whole_account", why: "Again." })).code).toBe("already_banned");
  });

  it("refuses unknown usernames, scopes and rules", async () => {
    expect((await adminTool("ban_account", { username: "Nobody_Here", ban_scope: "developer", why: "x" })).code).toBe("unknown_username");
    expect((await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "forever", why: "x" })).code).toBe("bad_ban_scope");
    expect((await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "developer", why: "x", content_rule: "taste" })).code).toBe("bad_content_rule");
    expect((await adminTool("ban_account", { username: "", ban_scope: "developer", why: "x" })).code).toBe("bad_username");
    expect((await adminTool("unban_account", { username: "Emma_Builds", why: "x" })).code).toBe("not_banned");
  });
});

describe("a whole-account ban", () => {
  it("turns its API keys off, so every call answers account_banned", async () => {
    await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "whole_account", why: "Illegal content.", content_rule: "child_safety" });
    // A closed account hears at its next sign-in, not by email.
    expect(emails).toEqual([]);
    const refused = await api("dev-1", "/access");
    expect(refused.status).toBe(403);
    expect(refused.answer.error).toMatchObject({ code: "account_banned", message_for_people: "This account is closed for breaking Zaisma's rules." });
    const row = await env.DB.prepare("SELECT turned_off_at_ms, found_in, social_stopped_at_ms, sessions_ended_at_ms FROM api_keys JOIN accounts ON accounts.id = api_keys.account_id WHERE accounts.id = 'dev-1'").first<Record<string, number | null>>();
    expect(row).toMatchObject({ found_in: null, turned_off_at_ms: expect.any(Number), social_stopped_at_ms: expect.any(Number), sessions_ended_at_ms: expect.any(Number) });
  });
});

describe("what a ban carries to new accounts", () => {
  it("keeps the cards that paid, the Stripe account and the email as hashes, and unban lifts them", async () => {
    cardFingerprints.set("pi_card_1", "fp_family_card");
    await topUp("dev-1", "pi_card_1");
    await topUp("dev-1", "pi_card_1");
    expect((await env.DB.prepare("SELECT card_fingerprint_sha256 FROM owner_cards").all()).results).toEqual([{ card_fingerprint_sha256: await markSha256("card", "fp_family_card") }]);
    await env.DB.prepare("UPDATE owners SET stripe_account_id = 'acct_banned_1' WHERE account_id = 'dev-1'").run();

    expect((await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "developer", why: "Phishing.", content_rule: "malware" })).banned_mark_count).toBe(3);
    expect([await markCount("card"), await markCount("stripe_account"), await markCount("email")]).toEqual([1, 1, 1]);
    const marks = (await env.DB.prepare("SELECT mark_sha256 FROM banned_marks").all<{ mark_sha256: string }>()).results.map((mark) => mark.mark_sha256);
    expect(marks).toContain(await markSha256("email", " Emma@Example.com "));
    expect(marks.join()).not.toMatch(/emma|acct_|fp_/);

    const unbanned = await adminTool("unban_account", { username: "Emma_Builds", why: "Wrong account." });
    expect(unbanned.next_steps.map((step: { arguments: { slug: string } }) => step.arguments.slug)).toEqual(["sky-hopper", "cave-run"]);
    expect(await markCount("card") + (await markCount("stripe_account")) + (await markCount("email"))).toBe(0);
    expect(await accountRow("dev-1")).toMatchObject({ banned_at_ms: null, ban_scope: null });
    // Games stay down until each is restored.
    expect((await gameBySlug(env.DB, "sky-hopper"))!.review_status).toBe("removed");
    expect((await api("dev-1", "/access")).answer.ban_scope).toBeNull();
  });

  it("sends a banned card on another account to a person, once, and decide_ban_match bans or closes it", async () => {
    cardFingerprints.set("pi_card_1", "fp_shared");
    await topUp("dev-1", "pi_card_1");
    await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "developer", why: "Phishing.", content_rule: "malware" });

    await developer("dev-2", "Liam_Plays", "liam@example.com");
    cardFingerprints.set("pi_card_2", "fp_shared");
    cardFingerprints.set("pi_card_3", "fp_shared");
    await topUp("dev-2", "pi_card_2");
    await topUp("dev-2", "pi_card_3");
    expect(alerts).toEqual(["[alert] A card banned with @Emma_Builds paid on @Liam_Plays"]);
    const { ban_matches: matches } = await adminTool("list_ban_matches");
    expect(matches).toEqual([{ ban_match_id: expect.stringMatching(/^ban_match_/), username: "Liam_Plays", mark_kind: "card", banned_username: "Emma_Builds", found_at: expect.any(String), decision: null }]);

    expect(await adminTool("decide_ban_match", { ban_match_id: matches[0].ban_match_id, decision: "not_the_same_person", why: "Her brother." })).toMatchObject({ decision: "not_the_same_person" });
    expect((await accountRow("dev-2"))!.banned_at_ms).toBeNull();
    expect((await adminTool("decide_ban_match", { ban_match_id: matches[0].ban_match_id, decision: "banned", why: "x" })).code).toBe("ban_match_decided");
    expect((await adminTool("decide_ban_match", { ban_match_id: "ban_match_8f3k2m9q1x7c4v6b0n5z", decision: "banned", why: "x" })).code).toBe("no_ban_match");

    // A new match once the last is decided; banned bans the developer side with the first account's rule.
    cardFingerprints.set("pi_card_4", "fp_shared");
    await topUp("dev-2", "pi_card_4");
    const { ban_matches: again } = await adminTool("list_ban_matches");
    expect(again.map((match: { decision: string | null }) => match.decision)).toEqual([null, "not_the_same_person"]);
    await adminTool("decide_ban_match", { ban_match_id: again[0].ban_match_id, decision: "banned", why: "The same person." });
    expect(await accountRow("dev-2")).toMatchObject({ ban_scope: "developer", ban_content_rule: "malware" });
  });

  it("never holds up a payment when Stripe can't say the card", async () => {
    await topUp("dev-1", "pi_without_card");
    expect((await env.DB.prepare("SELECT COUNT(*) AS entry_count FROM credit_entries WHERE entry_kind = 'top_up'").first<{ entry_count: number }>())!.entry_count).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS card_count FROM owner_cards").first<{ card_count: number }>())!.card_count).toBe(0);
  });
});

describe("a banned account's files", () => {
  it("hold another account's upload of them for a person, and the banned account hears nothing", async () => {
    const files = { "index.html": "<!doctype html><script src=game.js></script>", "game.js": "const level = 'banned original';", "data.json": '{"levels":["one","two"]}' };
    await push("dev-1", "sky-hopper", files);
    await env.DB.prepare("UPDATE blob_owners SET created_at_ms = created_at_ms - 60000").run();
    await env.DB.prepare("UPDATE owned_blobs SET created_at_ms = created_at_ms - 60000").run();
    await adminTool("ban_account", { username: "Emma_Builds", ban_scope: "developer", why: "Phishing.", content_rule: "malware" });

    await developer("dev-2", "Liam_Plays", "liam@example.com");
    expect((await api("dev-2", "/games", { body: { title: "Hopper Again", slug: "hopper-again" } })).status).toBe(201);
    const { versionId, report } = await push("dev-2", "hopper-again", files);
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "matches_banned_account_files", severity: "hold" }));
    expect(report.findings.map((finding) => finding.code)).not.toContain("matches_another_developers_game");
    const { answer } = await api("dev-2", `/games/hopper-again/versions/${versionId}`);
    expect(answer.version.findings).toContainEqual(expect.objectContaining({ code: "matches_banned_account_files", content_rule: null, fix: "A person checks it within a day." }));

    const version = (await versionById(env.DB, versionId))!;
    expect((JSON.parse(version.scan_report!) as ScanReport).matched_game).toBeTruthy();
    expect(await stopCopy(testEnv, version, "julius@zaisma.test")).toBe(true);
    // Only the ban's own email reached the banned account, never one about the copy.
    expect(emails).toEqual([{ to: "emma@example.com", subject: "Zaisma banned your account's developer side" }]);
    expect(await env.DB.prepare("SELECT 1 FROM audit_log WHERE action = 'copy-stopped'").first()).toBeNull();
  });
});
