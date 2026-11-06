import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountById, createAccount, createApiKey, deleteAccount, newId, sendFriendRequest, type ImageMatcher } from "@zaisma/core";
import { decideChatReview } from "../../apps/site/src/chat-review.ts";
import type { Env } from "../../apps/site/src/env.ts";
import { clearSafetyPause, detailsOf, eraseOldReports, NCMEC_LIMITS, pauseAccount, reportById, reportMatch, sendByPerson, sendWaitingReports, type MatchInput } from "../../apps/site/src/ncmec.ts";
import { scanVersion } from "../../apps/site/src/scan.ts";
import { makeZip } from "../helpers.ts";
import { errorProblems } from "../schema-check.ts";
import { passingScanDeps } from "./scan-stubs.ts";

const NCMEC_URL = "https://ncmec.test/ispws";
const testEnv = { ...env, NCMEC_USERNAME: "zaisma", NCMEC_PASSWORD: "test-password", NCMEC_API_URL: NCMEC_URL } as unknown as Env;
const DAY_MS = 86_400_000;

interface NcmecCall {
  path: string;
  body: string;
  authorization: string | null;
}

/** NCMEC's API, answering as its documentation shows; the paths in `failing` answer 500. Everything else answers 404. */
function fakeNcmec(failing: string[] = []) {
  const calls: NcmecCall[] = [];
  let reportNumber = 1000;
  let fileNumber = 0;
  const xml = (text: string, status = 200) => new Response(text, { status, headers: { "content-type": "text/xml" } });
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(NCMEC_URL)) return new Response("Not found", { status: 404 });
    const path = url.slice(NCMEC_URL.length);
    const body = init?.body instanceof ReadableStream ? await new Response(init.body).text() : String(init?.body ?? "");
    calls.push({ path, body, authorization: new Headers(init?.headers).get("authorization") });
    if (failing.includes(path)) return xml("<reportResponse><responseCode>1000</responseCode><responseDescription>Server error</responseDescription></reportResponse>", 500);
    if (path === "/submit") return xml(`<reportResponse><responseCode>0</responseCode><responseDescription>Success</responseDescription><reportId>${++reportNumber}</reportId></reportResponse>`);
    if (path === "/upload") return xml(`<reportResponse><responseCode>0</responseCode><responseDescription>Success</responseDescription><reportId>${reportNumber}</reportId><fileId>file${++fileNumber}</fileId><hash>d41d8cd98f00b204e9800998ecf8427e</hash></reportResponse>`);
    if (path === "/finish") return xml(`<reportDoneResponse><responseCode>0</responseCode><reportId>${reportNumber}</reportId><files><fileId>file${fileNumber}</fileId></files></reportDoneResponse>`);
    return xml(`<reportResponse><responseCode>0</responseCode><responseDescription>Success</responseDescription><reportId>${reportNumber}</reportId></reportResponse>`);
  };
  return { calls, fake };
}

let accountNumber = 0;
async function makeAccount() {
  accountNumber++;
  return createAccount(env.DB, { id: `ncmec-account-${accountNumber}`, username: `ncmec_user_${accountNumber}`, ageBand: "18+" });
}

const match = (accountId: string | null, overrides: Partial<MatchInput> = {}): MatchInput => ({
  where: "a cover image for sky-hopper",
  gameId: null,
  versionId: null,
  accountId,
  incidentUrl: "https://zaisma.test/g/sky-hopper",
  connectionAddress: "203.0.113.7",
  uploadedAtMs: Date.now() - 1000,
  media: [{ path: "cover image", contentType: "image/png", matchMessage: "Arachnid Shield: <known> & listed (the exact file).", isPubliclyAvailable: false, bytes: new Uint8Array([137, 80, 78, 71]) }],
  ...overrides,
});

const accountRow = (id: string) => env.DB.prepare("SELECT safety_paused_at_ms, chat_stopped_reason FROM accounts WHERE id = ?").bind(id).first<{ safety_paused_at_ms: number | null; chat_stopped_reason: string | null }>();

describe("reports to NCMEC", () => {
  let alerts: string[];
  let ncmec: ReturnType<typeof fakeNcmec>;
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM ncmec_reports; DELETE FROM chat_reviews; DELETE FROM friend_requests;");
    alerts = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void alerts.push(String(line)));
    ncmec = fakeNcmec();
    vi.stubGlobal("fetch", ncmec.fake);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports a match by itself, says nobody viewed it, keeps the file and pauses the account", async () => {
    const account = await makeAccount();
    const report = (await reportMatch(testEnv, match(account.id)))!;

    expect(report).toMatchObject({ report_source: "image_match", ncmec_report_status: "sent", ncmec_report_number: "1001", account_id: account.id, send_attempt_count: 1, last_error: null });
    expect(report.erase_at_ms! - report.sent_at_ms!).toBe(NCMEC_LIMITS.keptDurationDays * DAY_MS);
    expect(ncmec.calls.map((call) => call.path)).toEqual(["/submit", "/upload", "/fileinfo", "/finish"]);
    expect(ncmec.calls.every((call) => call.authorization === `Basic ${btoa("zaisma:test-password")}`)).toBe(true);

    const [submitted, uploaded, described, finished] = ncmec.calls;
    expect(submitted!.body).toContain("<incidentType>Child Pornography (possession, manufacture, and distribution)</incidentType>");
    expect(submitted!.body).toContain(`<screenName>${account.username}</screenName>`);
    expect(submitted!.body).toContain(`<espIdentifier>${account.id}</espIdentifier>`);
    expect(submitted!.body).toContain("<ipCaptureEvent><ipAddress>203.0.113.7</ipAddress><eventName>Upload</eventName>");
    expect(submitted!.body).toContain("<accountTemporarilyDisabled>true</accountTemporarilyDisabled>");
    expect(submitted!.body).toContain("<email>safety@zaisma.com</email>");
    expect(uploaded!.body).toContain('name="id"\r\n\r\n1001');
    expect(uploaded!.body).toContain('filename="cover_image"');
    expect(described!.body).toContain("<reportId>1001</reportId><fileId>file1</fileId>");
    expect(described!.body).toContain("<fileViewedByEsp>false</fileViewedByEsp>");
    expect(described!.body).toContain("<publiclyAvailable>false</publiclyAvailable>");
    expect(described!.body).toContain("Arachnid Shield: &lt;known&gt; &amp; listed (the exact file).");
    expect(finished!.body).toBe("id=1001");

    const kept = await env.REPORTED!.get(detailsOf(report).files[0]!.kept_key);
    expect(new Uint8Array(await kept!.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(await accountRow(account.id)).toMatchObject({ chat_stopped_reason: "in_review" });
    expect((await accountRow(account.id))!.safety_paused_at_ms).toBeGreaterThan(0);
    expect(alerts).toEqual(["[alert] URGENT: known abuse material in a cover image for sky-hopper: reported to NCMEC, 1001"]);
    // The keys never reach what's kept.
    expect(JSON.stringify(await reportById(testEnv, report.id))).not.toContain("test-password");
  });

  it("stops at the daily brake past 3 accounts, but not for an account that matched already, and a person's press sends it", async () => {
    const accounts = [await makeAccount(), await makeAccount(), await makeAccount(), await makeAccount()];
    for (const account of accounts.slice(0, 3)) expect((await reportMatch(testEnv, match(account.id)))!.ncmec_report_status).toBe("sent");
    const braked = (await reportMatch(testEnv, match(accounts[3]!.id)))!;
    expect(braked.ncmec_report_status).toBe("stopped_by_brake");
    expect(ncmec.calls.filter((call) => call.path === "/submit")).toHaveLength(3);
    expect(alerts.at(-1)).toContain("the daily brake stopped it");
    // Paused all the same.
    expect((await accountRow(accounts[3]!.id))!.safety_paused_at_ms).toBeGreaterThan(0);
    expect((await reportMatch(testEnv, match(accounts[0]!.id)))!.ncmec_report_status).toBe("sent");

    expect((await sendByPerson(testEnv, braked.id, "admin"))!.ncmec_report_status).toBe("sent");
    expect(await sendByPerson(testEnv, braked.id, "admin")).toBeNull();
  });

  it("tries again every run, takes back a half-made report first, and fails with an alert after its tries", async () => {
    const account = await makeAccount();
    ncmec = fakeNcmec(["/upload"]);
    vi.stubGlobal("fetch", ncmec.fake);
    const report = (await reportMatch(testEnv, match(account.id)))!;
    expect(report).toMatchObject({ ncmec_report_status: "waiting", ncmec_report_number: "1001", send_attempt_count: 1 });
    expect(report.last_error).toContain("NCMEC answered /upload with 500, code 1000: Server error");
    expect(alerts.at(-1)).toContain("report to NCMEC not sent yet");

    for (let run = 2; run <= NCMEC_LIMITS.maximumSendAttemptCount; run++) await sendWaitingReports(testEnv);
    expect(ncmec.calls.filter((call) => call.path === "/retract").map((call) => call.body)).toEqual(["id=1001", "id=1002", "id=1003", "id=1004", "id=1005"]);
    expect(await reportById(testEnv, report.id)).toMatchObject({ ncmec_report_status: "failed", send_attempt_count: NCMEC_LIMITS.maximumSendAttemptCount });
    expect(alerts.at(-1)).toBe("[alert] URGENT: a report to NCMEC failed: file it by hand");
    expect(await sendWaitingReports(testEnv)).toBe(0);

    ncmec = fakeNcmec();
    vi.stubGlobal("fetch", ncmec.fake);
    expect((await sendByPerson(testEnv, report.id, "admin"))!.ncmec_report_status).toBe("sent");
    expect(ncmec.calls[0]).toMatchObject({ path: "/retract", body: "id=1006" });
  });

  it("without NCMEC's keys, fails at once and tells Julius to file it by hand", async () => {
    const account = await makeAccount();
    const report = (await reportMatch(env as unknown as Env, match(account.id)))!;
    expect(report).toMatchObject({ ncmec_report_status: "failed", last_error: "NCMEC_USERNAME and NCMEC_PASSWORD aren't set" });
    expect(ncmec.calls).toEqual([]);
    expect(alerts.at(-1)).toContain("report to NCMEC failed, file it by hand");
  });

  it("reports a version once, with the matched file from the scan", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const form = new FormData();
    form.set("title", "Matched Game");
    form.set("slug", "ncmec-matched");
    form.set("description", "A test.");
    form.set("zip", new File([makeZip({ "index.html": "<!doctype html><p>hi</p>", "art/hero.png": png })], "game.zip", { type: "application/zip" }));
    const { versionId } = (await (await SELF.fetch("http://localhost/admin/api/games", { method: "POST", body: form })).json()) as { versionId: string };
    const matcher: ImageMatcher = {
      check: async (media) => ({
        provider: "test",
        isConnected: true,
        checkedMediaCount: media.length,
        findings: media.filter((each) => each.path === "art/hero.png").map((each) => ({ stage: "images" as const, severity: "hold" as const, code: "known_illegal_image" as const, message: "Arachnid Shield: test (the exact file).", path: each.path })),
      }),
    };
    await scanVersion(testEnv, versionId, passingScanDeps({ images: matcher }));
    const { results } = await env.DB.prepare("SELECT * FROM ncmec_reports WHERE version_id = ?").bind(versionId).all<{ id: string; details_json: string; ncmec_report_status: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]!.ncmec_report_status).toBe("sent");
    const [file] = (JSON.parse(results[0]!.details_json) as { files: { original_path: string; kept_key: string; match_message: string }[] }).files;
    expect(file).toMatchObject({ original_path: "art/hero.png", match_message: "Arachnid Shield: test (the exact file)." });
    expect(new Uint8Array(await (await env.REPORTED!.get(file!.kept_key))!.arrayBuffer())).toEqual(png);
    // The same version matched again (a re-check) isn't reported again.
    expect((await reportMatch(testEnv, match(null, { versionId })))!.id).toBe(results[0]!.id);
    await env.DB.exec("DELETE FROM versions WHERE game_id IN (SELECT id FROM games WHERE slug = 'ncmec-matched'); DELETE FROM games WHERE slug = 'ncmec-matched';");
  });

  it("keeps what was reported a year, through deleting the account, then erases it with its files", async () => {
    const account = await makeAccount();
    const report = (await reportMatch(testEnv, match(account.id)))!;
    const keptKey = detailsOf(report).files[0]!.kept_key;
    await deleteAccount(env.DB, account.id);
    expect(await eraseOldReports(testEnv)).toBe(0);
    expect(await env.REPORTED!.head(keptKey)).not.toBeNull();
    expect(detailsOf((await reportById(testEnv, report.id))!).account?.username).toBe(account.username);

    await env.DB.prepare("UPDATE ncmec_reports SET erase_at_ms = ? WHERE id = ?").bind(Date.now() - 1, report.id).run();
    expect(await eraseOldReports(testEnv)).toBe(1);
    expect(await reportById(testEnv, report.id)).toBeNull();
    expect(await env.REPORTED!.head(keptKey)).toBeNull();
  });

  it("a paused account can't make games, post or send friend requests until a person clears it", async () => {
    const account = await makeAccount();
    const friend = await makeAccount();
    await env.DB.prepare("UPDATE accounts SET can_publish = 1 WHERE id = ?").bind(account.id).run();
    const { token } = await createApiKey(env.DB, account.id, "test");
    const api = (path: string, body?: unknown) =>
      SELF.fetch(`https://zaisma.test/api/dev${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "cf-connecting-ip": `198.51.100.${accountNumber}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    await pauseAccount(testEnv, account.id);

    const refused = await api("/games", { title: "Paused Game", slug: `paused-${accountNumber}` });
    const answer = (await refused.json()) as { error: { code: string } };
    expect(refused.status).toBe(403);
    expect(answer.error.code).toBe("account_paused");
    expect(errorProblems(answer, refused.status)).toEqual([]);
    const posted = await api("/forum", { kind: "question", title: "A question", category: "general", body_markdown: "Hello there." });
    expect(((await posted.json()) as { error: { code: string } }).error.code).toBe("account_paused");
    expect(((await (await api("/access")).json()) as { safety_paused_at: string | null }).safety_paused_at).not.toBeNull();
    expect(await sendFriendRequest(env.DB, (await accountById(env.DB, account.id))!, friend.player_id, null)).toMatchObject({ status: "sent" });
    expect(await env.DB.prepare("SELECT answer FROM friend_requests WHERE sender_account_id = ?").bind(account.id).first()).toEqual({ answer: "turned_down" });

    expect(await clearSafetyPause(testEnv, account.id, "admin")).toBe(true);
    expect(await accountRow(account.id)).toEqual({ safety_paused_at_ms: null, chat_stopped_reason: null });
    expect(await clearSafetyPause(testEnv, account.id, "admin")).toBe(false);
    expect((await api("/games", { title: "Paused Game", slug: `paused-${accountNumber}` })).status).toBe(201);
    await env.DB.exec(`DELETE FROM games WHERE slug = 'paused-${accountNumber}';`);
  });

  it("a confirmed chat review waits ready for a person's press, which sends it", async () => {
    const sender = await makeAccount();
    const reviewId = newId("chat_review");
    await env.DB.prepare("INSERT INTO chat_reviews (id, sender_account_id, game_id, source, text, recent_texts_json, created_at_ms) VALUES (?, ?, 'game_ncmectest', 'rooms', 'u home alone? <send pics>', '[\"hey\"]', ?)").bind(reviewId, sender.id, Date.now()).run();
    const review = (await env.DB.prepare("SELECT * FROM chat_reviews WHERE id = ?").bind(reviewId).first<Parameters<typeof decideChatReview>[1]>())!;

    await decideChatReview(testEnv, review, "remove_chat", "ai");
    const ready = (await env.DB.prepare("SELECT * FROM ncmec_reports WHERE chat_review_id = ?").bind(reviewId).first<{ id: string; ncmec_report_status: string }>())!;
    expect(ready.ncmec_report_status).toBe("ready");
    expect(ncmec.calls).toEqual([]);

    await decideChatReview(testEnv, review, "report_to_ncmec", "admin");
    expect(await reportById(testEnv, ready.id)).toMatchObject({ ncmec_report_status: "sent", report_source: "chat_review" });
    expect(ncmec.calls[0]!.body).toContain("<incidentType>Online Enticement of Children for Sexual Acts</incidentType>");
    expect(ncmec.calls[0]!.body).toContain("u home alone? &lt;send pics&gt;");
    expect(ncmec.calls.map((call) => call.path)).toEqual(["/submit", "/finish"]);
    expect((await env.DB.prepare("SELECT reported_at_ms FROM chat_reviews WHERE id = ?").bind(reviewId).first<{ reported_at_ms: number }>())!.reported_at_ms).toBeGreaterThan(0);
  });

  it("the admin page lists reports and paused accounts; its buttons send and clear", async () => {
    const accounts = [await makeAccount(), await makeAccount(), await makeAccount(), await makeAccount()];
    for (const account of accounts) await reportMatch(testEnv, match(account.id));
    const braked = (await env.DB.prepare("SELECT id FROM ncmec_reports WHERE ncmec_report_status = 'stopped_by_brake'").first<{ id: string }>())!;
    const page = await (await SELF.fetch("http://localhost/admin/ncmec")).text();
    expect(page).toContain("Stopped by the daily brake");
    expect(page).toContain("Sent, report 1001");
    expect(page).toContain(`@${accounts[3]!.username}`);

    // The site's own env has no NCMEC keys here, so the press ends at failed, with why.
    await SELF.fetch(`http://localhost/admin/ncmec/${braked.id}/send`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect(await reportById(testEnv, braked.id)).toMatchObject({ ncmec_report_status: "failed", last_error: "NCMEC_USERNAME and NCMEC_PASSWORD aren't set" });
    await SELF.fetch(`http://localhost/admin/ncmec/accounts/${accounts[3]!.id}/clear-pause`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await accountRow(accounts[3]!.id))!.safety_paused_at_ms).toBeNull();
  });
});
