import { createExecutionContext, env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SECURITY_LOG_LIMITS, SPIKE_THRESHOLDS, createAccount, createApiKey, createGame, createWebhook, personOwner, NO_WHERE } from "@zaisma/core";
import worker from "../../apps/site/src/index.ts";
import { ADMIN_TOOLS } from "../../apps/site/src/admin-mcp.ts";
import { noteWrongPassword } from "../../apps/site/src/device-marks.ts";
import { ACTIVITY, WEBHOOK_EVENT } from "../../apps/site/src/schemas.ts";
import { logSecurityEvent, type SecurityEventRow } from "../../apps/site/src/security-log.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";

// Security alerts (apps/site/src/security-alerts.ts) through the security log, the developer API, webhooks and
// the admin MCP: who gets an email, the hourly cap, the security_alert webhook, spikes and script reports. The
// account page and dashboard's side is in accounts.test.ts ("security alerts on the account page and dashboard"),
// which has the sign-in stand-in.

const SITE = "https://zaisma.test";
const HOOKS = "https://hooks.example.com/zaisma";
const ACCOUNT_ID = "alert-dev";
const EMAIL = "sam@example.com";

let emails: { to: string; subject: string; text: string }[] = [];
let hooked: { url: string; body: Record<string, unknown> }[] = [];
let accountEmail: string | null = EMAIL;
let realFetch: typeof fetch;

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM webhook_deliveries; DELETE FROM webhooks; DELETE FROM security_events; DELETE FROM security_places; DELETE FROM security_spikes; DELETE FROM blocked_scripts; DELETE FROM sign_in_networks; DELETE FROM wrong_passwords; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  emails = [];
  hooked = [];
  accountEmail = EMAIL;
  realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://outbox.test") {
      emails.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }
    if (url.origin === "https://supabase.test" && url.pathname === `/auth/v1/admin/users/${ACCOUNT_ID}`) return accountEmail ? Response.json({ id: ACCOUNT_ID, email: accountEmail }) : Response.json({ id: ACCOUNT_ID, email: `${ACCOUNT_ID}@no-mail.zaisma.com` });
    if (url.href.startsWith("https://hooks.example.com/")) {
      hooked.push({ url: url.href, body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    }
    return realFetch(input, init);
  });
  await createAccount(env.DB, { id: ACCOUNT_ID, username: "Sam_Builds", ageBand: "18+" });
});

afterEach(() => vi.unstubAllGlobals());

const row = (kind: SecurityEventRow["kind"], extra: Partial<SecurityEventRow> = {}): SecurityEventRow => ({
  accountId: ACCOUNT_ID,
  gameId: null,
  kind,
  doneBy: "you",
  apiKeyId: null,
  apiKeyName: null,
  signInKind: null,
  versionId: null,
  subjectName: null,
  where: { ...NO_WHERE, device: "Chrome on a Mac", networkName: "Vodafone", cityName: "Manchester", countryCode: "GB", networkNumber: 64500 },
  isWhereKept: true,
  isNewPlace: false,
  ...extra,
});

const statusOf = async (eventNumber: number | null) => (await env.DB.prepare("SELECT security_alert_status FROM security_events WHERE id = ?").bind(eventNumber).first<{ security_alert_status: string | null }>())?.security_alert_status;

async function api(path: string, token: string) {
  const response = await worker.fetch(new Request(`${SITE}/api/dev${path}`, { headers: { authorization: `Bearer ${token}` } }), env, createExecutionContext());
  const answer = (await response.json()) as any;
  if (!response.ok) expect(errorProblems(answer, response.status)).toEqual([]);
  return answer;
}

async function adminTool(name: string): Promise<any> {
  const response = await SELF.fetch("http://localhost/admin/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }) });
  const { result } = (await response.json()) as { result: { structuredContent: unknown; isError?: boolean } };
  expect(result.isError).toBeFalsy();
  expect(schemaProblems(ADMIN_TOOLS.find((candidate) => candidate.name === name)!.outputSchema, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

describe("security alerts", () => {
  it("email the account for a risky event, say so in get_activity, and stay quiet for the rest", async () => {
    const changed = await logSecurityEvent(env, row("password_changed"));
    expect(emails.map((sent) => [sent.to, sent.subject])).toEqual([[EMAIL, "Your Zaisma password was changed"]]);
    expect(emails[0]!.text).toContain("Chrome on a Mac · Vodafone, near Manchester, UK");
    expect(await statusOf(changed)).toBe("emailed");
    // A passkey added has its own wait email; a key removed isn't risky.
    await logSecurityEvent(env, row("passkey_added"));
    await logSecurityEvent(env, row("api_key_removed"));
    expect(emails).toHaveLength(1);

    const { token } = await createApiKey(env.DB, ACCOUNT_ID, "Reader");
    const activity = await api("/activity", token);
    expect(schemaProblems(ACTIVITY, activity)).toEqual([]);
    expect(activity.events.find((event: any) => event.kind === "password_changed").security_alert_status).toBe("emailed");
    expect(activity.events.find((event: any) => event.kind === "passkey_added").security_alert_status).toBeNull();
    expect(activity.unseen_security_alerts).toEqual([]);
  });

  it("leave out where when the account doesn't keep it", async () => {
    await logSecurityEvent(env, row("passkey_removed", { isWhereKept: false, subjectName: "iPhone" }));
    expect(emails[0]!.subject).toBe("A passkey was removed from your Zaisma account");
    expect(emails[0]!.text).toContain("Removed a passkey: iPhone, on your Zaisma account Sam_Builds,");
    expect(emails[0]!.text).not.toContain("Vodafone");
  });

  it("wait on the pages without an email, and past 10 emails an hour", async () => {
    accountEmail = null;
    const made = await logSecurityEvent(env, row("api_key_created", { subjectName: "CI" }));
    expect(emails).toEqual([]);
    expect(await statusOf(made)).toBe("unseen");

    accountEmail = EMAIL;
    await env.DB.prepare("UPDATE security_events SET security_alert_status = 'emailed'").run();
    for (let i = 1; i < SECURITY_LOG_LIMITS.maximumAlertEmailCountPerHour; i++) await logSecurityEvent(env, row("password_changed"));
    expect(emails).toHaveLength(SECURITY_LOG_LIMITS.maximumAlertEmailCountPerHour - 1);
    const eleventh = await logSecurityEvent(env, row("password_changed"));
    expect(emails).toHaveLength(SECURITY_LOG_LIMITS.maximumAlertEmailCountPerHour - 1);
    expect(await statusOf(eleventh)).toBe("unseen");

    const { token } = await createApiKey(env.DB, ACCOUNT_ID, "Reader");
    const activity = await api("/activity", token);
    expect(schemaProblems(ACTIVITY, activity)).toEqual([]);
    expect(activity.unseen_security_alerts.map((event: any) => event.kind)).toEqual(["password_changed"]);
  });

  it("count a sign-in only from a new network, and a removed app only when Zaisma removed it", async () => {
    expect(await statusOf(await logSecurityEvent(env, row("signed_in_new_device", { signInKind: "password" })))).toBeNull();
    expect(await statusOf(await logSecurityEvent(env, row("signed_in_new_device", { signInKind: "password", isNewPlace: true })))).toBe("emailed");
    expect(emails.at(-1)!.text).toContain("Signed in with your password on a new device");
    expect(await statusOf(await logSecurityEvent(env, row("connected_app_removed", { subjectName: "claude.ai" })))).toBeNull();
    expect(await statusOf(await logSecurityEvent(env, row("connected_app_removed", { subjectName: "claude.ai", doneBy: "zaisma", where: NO_WHERE })))).toBe("emailed");
    expect(emails.at(-1)!.subject).toBe("Zaisma disconnected an app from your account");
  });

  it("go to a webhook for every game at an endpoint_url, never one limited to a game or a game server", async () => {
    const owner = await personOwner(env.DB, ACCOUNT_ID);
    await createGame(env.DB, { slug: "sky-hopper", title: "Sky Hopper", description: "", ownerId: owner.id, visibility: "draft" });
    await createWebhook(env.DB, { ownerId: owner.id, destinationKind: "endpoint_url", endpointUrl: `${HOOKS}/all`, eventKinds: ["security_alert"], gameSlugs: null });
    await createWebhook(env.DB, { ownerId: owner.id, destinationKind: "endpoint_url", endpointUrl: `${HOOKS}/one-game`, eventKinds: ["security_alert"], gameSlugs: ["sky-hopper"] });
    await createWebhook(env.DB, { ownerId: owner.id, destinationKind: "game_server", endpointUrl: null, eventKinds: ["security_alert"], gameSlugs: ["sky-hopper"] });
    await createWebhook(env.DB, { ownerId: owner.id, destinationKind: "endpoint_url", endpointUrl: `${HOOKS}/bugs`, eventKinds: ["bug_reported"], gameSlugs: null });
    await logSecurityEvent(env, row("api_key_new_place", { doneBy: "api_key", apiKeyName: "GitHub Actions", isNewPlace: true }));
    expect(hooked.map((hook) => hook.url)).toEqual([`${HOOKS}/all`]);
    const event = hooked[0]!.body;
    expect(schemaProblems(WEBHOOK_EVENT, event)).toEqual([]);
    expect(event).toMatchObject({ kind: "security_alert", game: null, security_event: { kind: "api_key_new_place", api_key_name: "GitHub Actions", network_name: "Vodafone", security_alert_status: "emailed" } });
    const deliveries = await env.DB.prepare("SELECT COUNT(*) AS delivery_count FROM webhook_deliveries").first<{ delivery_count: number }>();
    expect(deliveries!.delivery_count).toBe(1);
  });
});

describe("spikes across Zaisma", () => {
  it("alert the admin once when wrong passwords from one network reach the threshold in an hour, and list it in the admin MCP", async () => {
    const log = vi.spyOn(console, "log");
    const wrong = () => new Request(`${SITE}/signin`, { cf: { asn: 64500, asOrganization: "Vodafone" } as unknown as IncomingRequestCfProperties });
    const thresholdCount = SPIKE_THRESHOLDS.wrong_passwords_from_network;
    for (let i = 0; i < thresholdCount - 1; i++) await noteWrongPassword(wrong(), env, ACCOUNT_ID, false);
    const spikeLines = () => log.mock.calls.flat().filter((line) => String(line).startsWith("[alert] Spike:"));
    expect(spikeLines()).toEqual([]);
    await noteWrongPassword(wrong(), env, ACCOUNT_ID, false);
    await noteWrongPassword(wrong(), env, ACCOUNT_ID, false);
    expect(spikeLines()).toEqual([`[alert] Spike: ${thresholdCount} wrong passwords in an hour from network AS64500 (Vodafone)`]);
    log.mockRestore();

    const { security_spikes: spikes } = await adminTool("list_security_spikes");
    expect(spikes).toMatchObject([{ spike_kind: "wrong_passwords_from_network", autonomous_system: "AS64500", network_name: "Vodafone", occurrence_count: thresholdCount + 1, threshold_count: thresholdCount }]);
  });

  it("count keys made across Zaisma", async () => {
    await logSecurityEvent(env, row("api_key_created", { subjectName: "CI" }));
    const counted = await env.DB.prepare("SELECT network_number, occurrence_count FROM security_spikes WHERE spike_kind = 'api_keys_created'").first();
    expect(counted).toEqual({ network_number: 0, occurrence_count: 1 });
  });
});

describe("script policy reports", () => {
  let address = 1;
  const report = (body: unknown, contentType = "application/csp-report", ip = `192.0.2.${address++}`) =>
    SELF.fetch(`${SITE}/csp-reports`, { method: "POST", headers: { "content-type": contentType, "cf-connecting-ip": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const legacy = (blocked: string, page = "https://zaisma.test/g/sky-hopper?play=1") => ({ "csp-report": { "document-uri": page, "effective-directive": "script-src-elem", "blocked-uri": blocked } });

  it("keep both shapes, folded, with only the origin and the page's path, and the admin MCP lists them", async () => {
    expect((await report(legacy("https://evil.example/x.js?token=abc"))).status).toBe(204);
    await report(legacy("https://evil.example/other.js"));
    await report([{ type: "csp-violation", url: "https://zaisma.test/forum", body: { documentURL: "https://zaisma.test/forum", effectiveDirective: "script-src-elem", blockedURL: "inline" } }], "application/reports+json");
    const { blocked_scripts: blocked } = await adminTool("list_blocked_scripts");
    expect(blocked).toMatchObject([
      { violated_directive: "script-src-elem", blocked_source: "https://evil.example", page_path: "/g/sky-hopper", occurrence_count: 2 },
      { violated_directive: "script-src-elem", blocked_source: "inline", page_path: "/forum", occurrence_count: 1 },
    ]);
  });

  it("drop browser extensions' reports, big bodies and junk, and stop one address past 30 a minute", async () => {
    await report(legacy("chrome-extension://abcdef/inject.js"));
    await report({ "csp-report": { "document-uri": "https://zaisma.test/", "effective-directive": "script-src-elem", "blocked-uri": "inline", "source-file": "moz-extension://x/y.js" } });
    await report(JSON.stringify(legacy("https://evil.example/a.js")) + " ".repeat(17_000));
    await report("not json");
    expect(await env.DB.prepare("SELECT COUNT(*) AS row_count FROM blocked_scripts").first()).toEqual({ row_count: 0 });
    for (let i = 0; i < 31; i++) expect((await report(legacy("https://evil.example/a.js"), "application/csp-report", "192.0.2.250")).status).toBe(204);
    expect(await env.DB.prepare("SELECT occurrence_count FROM blocked_scripts").first()).toEqual({ occurrence_count: 30 });
  });

  it("are asked for by every zaisma.com page's policy", async () => {
    const response = await SELF.fetch(`${SITE}/`);
    expect(response.headers.get("content-security-policy")).toContain("report-uri /csp-reports; report-to csp");
    expect(response.headers.get("reporting-endpoints")).toBe('csp="/csp-reports"');
  });
});
