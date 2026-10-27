import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT_RULES, CONTENT_RULE_DETAILS, KNOWN_IMAGE_CODE, PLAN_LIMITS, REVIEW_LIMITS, arachnidShield, blobKey, createGame, createVersion, gameById, gameBySlug, heldVersions, manifestKey, newId, notConnected, sha256Hex, versionById, type EvidenceItem, type ImageMatcher, type Manifest, type ScanJob, type ScanReport } from "@zaisma/core";
import { handleScanBatch, imageMatcher, passVersion, queueImageChecks, recheckImages, replaceWaitingVersions, rescanWaiting, scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { dailyCleanup } from "../../apps/site/src/cleanup.ts";
import { judgeSays, readsNothing, seesNothing } from "./scan-stubs.ts";
import { gatherEvidence, type CodeChunk, type ReadCode } from "../../apps/site/src/review-readers.ts";
import { judgeVersion, settle, type JudgeBrief, type JudgeVersion } from "../../apps/site/src/review-judge.ts";
import { CLEAN_GAME, makeZip, minifiedBundle } from "../helpers.ts";
import { pageDataOf } from "../strict-scripts.ts";

const LOCAL = "http://localhost";
const testEnv = { ...env, DEV_ADMIN: "1", ANTHROPIC_API_KEY: "test-key" };

const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", isConnected: true, checkedMediaCount: imgs.length, findings: [] }) };

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const picture = (tail: string) => bytes([0x89], "PNG\r\n\x1a\n", tail);
// A stand-in for Arachnid Shield: files whose bytes end in "BAD" match. It records what it was sent.
let sent: { type: string; body: string }[] = [];
const shield = arachnidShield("user:pass", {
  baseUrl: "https://shield.test",
  fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = await new Response(init!.body).text();
    sent.push({ type: new Headers(init!.headers).get("content-type")!, body });
    const bad = body.endsWith("BAD");
    return new Response(JSON.stringify({ classification: bad ? "csam" : "no-known-match", match_type: bad ? "exact" : null }));
  }) as typeof fetch,
});
/** Readers that find nothing, and a judge with this verdict. */
const aiSays = (verdict: "pass" | "hold" | "reject", isChildSafety = false): Omit<ScanDeps, "images"> => ({
  readCode: readsNothing,
  readPictures: seesNothing,
  judge: judgeSays(verdict, verdict === "pass" ? [] : [{ stage: "ai", severity: verdict, code: "ai_other", message: "test concern" }], isChildSafety),
});
/** The same, counting the judge's calls in `calls`. */
const countedAiSays = (calls: { judgeCallCount: number }, verdict: "pass" | "hold" | "reject" = "pass"): Omit<ScanDeps, "images"> => {
  const said = aiSays(verdict);
  return { ...said, judge: async (...input) => (calls.judgeCallCount++, said.judge(...input)) };
};

async function upload(files: Record<string, string | Uint8Array>, slug = "test-game", origin?: string) {
  const form = new FormData();
  form.set("title", "Test Game");
  form.set("slug", slug);
  form.set("description", "A test.");
  form.set("zip", new File([makeZip(files)], "game.zip", { type: "application/zip" }));
  return SELF.fetch(`${LOCAL}/admin/api/games`, { method: "POST", body: form, headers: origin ? { Origin: origin } : {} });
}

async function uploadAndScan(files: Record<string, string | Uint8Array>, deps: ScanDeps, slug = "test-game") {
  const res = await upload(files, slug);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { versionId: string; gameId: string };
  const report = await scanVersion(testEnv, body.versionId, deps);
  return { ...body, report };
}

beforeEach(async () => {
  sent = [];
  await env.DB.exec("DELETE FROM reports; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM games; DELETE FROM ai_usage;");
  const all = await env.GAMES.list();
  if (all.objects.length) await env.GAMES.delete(all.objects.map((o) => o.key));
});

describe("upload", () => {
  it("stores the files and queues a scan", async () => {
    const res = await upload(CLEAN_GAME);
    expect(res.status).toBe(201);
    const { versionId, gameId } = (await res.json()) as { versionId: string; gameId: string };
    const v = await versionById(env.DB, versionId);
    expect(v?.scan_status).toBe("scanning");
    expect(v?.file_count).toBe(3);
    expect(await env.GAMES.head(`games/${gameId}/${versionId}/index.html`)).not.toBeNull();
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("pending");
  });

  it("explains bad zips and leaves nothing behind", async () => {
    const res = await upload({ ...CLEAN_GAME, "a.png": new Uint8Array([0x4d, 0x5a, 0, 0]) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Windows program/);
    expect(await gameBySlug(env.DB, "test-game")).toBeNull();
    expect((await env.GAMES.list({ prefix: "games/" })).objects).toHaveLength(0);
  });

  it("refuses reserved link names", async () => {
    const res = await upload(CLEAN_GAME, "admin");
    expect(res.status).toBe(400);
  });

  it("refuses admin posts from other sites", async () => {
    expect((await upload(CLEAN_GAME, "test-game", "https://evil.example")).status).toBe(403);
  });
});

describe("admin lock", () => {
  it("refuses admin pages without a Cloudflare Access login", async () => {
    expect((await SELF.fetch("https://zaisma.test/admin")).status).toBe(403);
    expect((await SELF.fetch("https://zaisma.test/admin/api/games", { method: "POST" })).status).toBe(403);
    expect((await SELF.fetch("https://zaisma.test/admin", { headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } })).status).toBe(403);
  });

  it("opens on localhost in dev", async () => {
    expect((await SELF.fetch(`${LOCAL}/admin`)).status).toBe(200);
  });
});

describe("scan and publish", () => {
  it("holds every game while image matching isn't connected", async () => {
    const { report } = await uploadAndScan(CLEAN_GAME, { images: notConnected, ...aiSays("pass") });
    expect(report.decision).toBe("held");
    expect(report.findings.map((f) => f.code)).toContain("image_matching_off");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("pending");
  });

  it("publishes a clean game automatically once every check is connected", async () => {
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("pass") });
    expect(report.decision).toBe("approved");
    const game = await gameBySlug(env.DB, "test-game");
    expect(game?.review_status).toBe("live");

    const home = await (await SELF.fetch(`${LOCAL}/`)).text();
    expect(home).toContain('"slug":"test-game"');
    const page = await SELF.fetch(`${LOCAL}/g/test-game`);
    const html = await page.text();
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-pointer-lock"');
    expect(html).not.toContain("allow-top-navigation");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("marks a build that needs threads, and its game page and frame say so", async () => {
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("pass") });
    expect(report.has_threads).toBe(false);
    const plainPage = await (await SELF.fetch(`${LOCAL}/g/test-game`)).text();
    expect(pageDataOf(plainPage, "game-page-data").has_threads).toBe(false);

    const threaded = await uploadAndScan({ ...CLEAN_GAME, "index.html": "<!doctype html><title>Threads</title><script>const GODOT_THREADS_ENABLED = true;</script>" }, { images: connected, ...aiSays("pass") }, "threaded-game");
    expect(threaded.report.decision).toBe("approved");
    expect(threaded.report.has_threads).toBe(true);
    const page = await (await SELF.fetch(`${LOCAL}/g/threaded-game`)).text();
    expect(pageDataOf(page, "game-page-data").has_threads).toBe(true);
    expect(page).toContain('allow="fullscreen; gamepad; autoplay; web-share; clipboard-write; cross-origin-isolated"');
  });

  it("rejects a crypto miner", async () => {
    const { report } = await uploadAndScan({ ...CLEAN_GAME, "game.js": "new CoinHive.Anonymous('k').start()" }, { images: connected, ...aiSays("pass") });
    expect(report.decision).toBe("rejected");
  });

  it("holds what the AI holds", async () => {
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("hold") });
    expect(report.decision).toBe("held");
  });

  it("holds (never rejects) child-safety flags so they can be reported", async () => {
    const { report, versionId } = await uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("reject", true) });
    expect(report.decision).toBe("held");
    expect(report.is_child_safety).toBe(true);
    expect((await versionById(env.DB, versionId))?.scan_status).toBe("held");
  });

  it("holds games without calling the AI once the monthly budget is used", async () => {
    await env.DB.prepare("INSERT INTO ai_usage (month, review_cost_cents) VALUES (?, 10000)").bind(new Date().toISOString().slice(0, 7)).run();
    const calls = { judgeCallCount: 0 };
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ...countedAiSays(calls) });
    expect(calls.judgeCallCount).toBe(0);
    expect(report.decision).toBe("held");
    expect(report.findings.map((f) => f.code)).toContain("ai_review_budget_used");
  });

  it("lets the admin approve a held game", async () => {
    const { versionId, gameId } = await uploadAndScan(CLEAN_GAME, { images: notConnected, ...aiSays("pass") });
    const res = await SELF.fetch(`${LOCAL}/admin/versions/${versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect(res.status).toBe(303);
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
    const detail = await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}`)).text();
    expect(detail).toContain("approved");
    expect(detail).toContain("dev@localhost");
  });

  it("connects Arachnid Shield only when its key is set", () => {
    expect(imageMatcher(env)).toBe(notConnected);
    expect(imageMatcher({ ...env, ARACHNID_SHIELD_KEY: "user:pass" })).not.toBe(notConnected);
    // PhotoDNA needs both its key and the photodna Worker.
    expect(imageMatcher({ ...env, PHOTODNA_KEY: "key", PHOTODNA: undefined })).toBe(notConnected);
  });

  it("holds known abuse images, keeps them from the AI and never lets them be approved", async () => {
    const calls = { judgeCallCount: 0 };
    const files = { ...CLEAN_GAME, "art/hero.png": picture("fine"), "art/other.png": picture("BAD") };
    const { report, versionId, gameId } = await uploadAndScan(files, { images: shield, ...countedAiSays(calls) });
    expect(sent.map((s) => s.type)).toEqual(["image/png", "image/png"]);
    expect(report.decision).toBe("held");
    expect(report.is_child_safety).toBe(true);
    expect(report.images).toEqual({ provider: "arachnid-shield", is_connected: true, checked_media_count: 2, reused_media_count: 0 });
    expect(report.findings.filter((f) => f.code === KNOWN_IMAGE_CODE).map((f) => f.path)).toEqual(["art/other.png"]);
    expect(calls.judgeCallCount).toBe(0);
    expect(report.ai?.verdict).toBe("skipped");

    // Nothing is deleted, and a person can't approve it, only keep it off.
    expect(await env.GAMES.head(`games/${gameId}/${versionId}/art/other.png`)).not.toBeNull();
    const detail = await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}`)).text();
    expect(detail).toContain("Known abuse images");
    expect(detail).not.toContain(`/admin/versions/${versionId}/approve`);
    expect(detail).toContain(`/admin/versions/${versionId}/reject`);
    const approve = await SELF.fetch(`${LOCAL}/admin/versions/${versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect(approve.status).toBe(409);
    expect((await versionById(env.DB, versionId))?.scan_status).toBe("held");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("pending");
  });

  it("finds pictures and videos under other names, inside code, and in videos, but not in sound", async () => {
    const webm = (codec: string, tail = "") => bytes([0x1a, 0x45, 0xdf, 0xa3], "webm", [0x86, codec.length + 0x80], codec, tail);
    const files = {
      ...CLEAN_GAME,
      "index.html": `<!doctype html><img src="data:image/png;base64,${btoa(String.fromCharCode(...picture("x".repeat(60) + "BAD")))}"><script src="game.js"></script>`,
      "data/level.dat": picture("BAD"),
      "assets/data.json": picture("fine"),
      "audio/theme.mp3": bytes("ID3", [4, 0, 0, 0], "music"),
      "audio/theme.webm": webm("A_OPUS"),
      "video/intro.webm": webm("V_VP9"),
      "video/outro.mp4": bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 2, 0], "BAD"),
    };
    const { report } = await uploadAndScan(files, { images: shield, ...aiSays("pass") });
    expect(sent.map((s) => `${s.type}`).sort()).toEqual(["image/png", "image/png", "image/png", "video/mp4", "video/webm"]);
    expect(report.findings.filter((f) => f.code === KNOWN_IMAGE_CODE).map((f) => f.path).sort()).toEqual(["data/level.dat", "index.html (picture 1 in the code)", "video/outro.mp4"]);
    expect(report.decision).toBe("held");
  });

  it("matches games that passed before matching was connected, once, and hides a live one that matches", async () => {
    // Approved by a person while matching wasn't connected, and live.
    const clean = await uploadAndScan(CLEAN_GAME, { images: notConnected, ...aiSays("pass") }, "clean-game");
    const bad = await uploadAndScan({ ...CLEAN_GAME, "art/pic.bin": picture("BAD") }, { images: notConnected, ...aiSays("pass") }, "bad-game");
    for (const v of [clean, bad]) await SELF.fetch(`${LOCAL}/admin/versions/${v.versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await gameBySlug(env.DB, "bad-game"))?.review_status).toBe("live");

    expect(await queueImageChecks(env, notConnected)).toBe(0);
    expect(await queueImageChecks(env, shield)).toBe(2);
    const deps = { images: shield, ...aiSays("pass") };
    await recheckImages(testEnv, clean.versionId, deps);
    await recheckImages(testEnv, bad.versionId, deps);

    // The clean one is noted as checked and stays up; it isn't queued again.
    expect((await gameBySlug(env.DB, "clean-game"))?.review_status).toBe("live");
    expect(JSON.parse((await versionById(env.DB, clean.versionId))!.scan_report!).images).toMatchObject({ provider: "arachnid-shield", is_connected: true });
    expect(await queueImageChecks(env, shield)).toBe(0);
    // Once PhotoDNA is connected too, it's queued again for PhotoDNA's check.
    expect(await queueImageChecks(env, shield, ["arachnid-shield", "photodna"])).toBe(1);

    // The matching one comes off at once, keeps its files, and can't be put back.
    const v = (await versionById(env.DB, bad.versionId))!;
    expect(v.scan_status).toBe("held");
    expect(v.preview_link_key).toBeNull();
    expect((JSON.parse(v.scan_report!) as ScanReport).is_child_safety).toBe(true);
    expect((await gameBySlug(env.DB, "bad-game"))?.review_status).toBe("held");
    expect(await env.GAMES.head(`games/${bad.gameId}/${bad.versionId}/art/pic.bin`)).not.toBeNull();
    const restore = await (await SELF.fetch(`${LOCAL}/admin/games/${bad.gameId}/restore`, { method: "POST", body: new FormData() })).text();
    expect(restore).toContain("matched known abuse material");
    expect((await gameBySlug(env.DB, "bad-game"))?.review_status).toBe("held");
    const game = await SELF.fetch(`${LOCAL}/g/bad-game`);
    expect(game.status).not.toBe(200);
  });

  it("runs an image check queued before migration 0034 as an image check, never as a full scan", async () => {
    const clean = await uploadAndScan(CLEAN_GAME, { images: notConnected, ...aiSays("pass") }, "clean-game");
    await SELF.fetch(`${LOCAL}/admin/versions/${clean.versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    const calls = { judgeCallCount: 0 };
    const settled: string[] = [];
    const message = { body: { versionId: clean.versionId, images: true }, attempts: 1, ack: () => settled.push("ack"), retry: () => settled.push("retry") };
    await handleScanBatch({ messages: [message] } as unknown as MessageBatch<ScanJob>, testEnv, { images: shield, ...countedAiSays(calls) });
    expect(settled).toEqual(["ack"]);
    expect(calls.judgeCallCount).toBe(0);
    expect(JSON.parse((await versionById(env.DB, clean.versionId))!.scan_report!).images).toMatchObject({ provider: "arachnid-shield", is_connected: true });
  });

  it("publishes a clean game with pictures once Arachnid Shield passes them", async () => {
    const shield = arachnidShield("user:pass", { fetch: (async () => new Response(JSON.stringify({ classification: "no-known-match" }))) as typeof fetch });
    const { report } = await uploadAndScan({ ...CLEAN_GAME, "a.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }, { images: shield, ...aiSays("pass") });
    expect(report.decision).toBe("approved");
    expect(report.images.checked_media_count).toBe(1);
  });

  it("keeps players on the old version while a new one is held", async () => {
    const first = await uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("pass") });
    // A new address in the changed file: not a tweak, so the judge decides.
    await uploadAndScan({ ...CLEAN_GAME, "index.html": '<p>v2</p><script src="https://cdn.example.invalid/x.js"></script>' }, { images: connected, ...aiSays("hold") });
    const game = await gameBySlug(env.DB, "test-game");
    expect(game?.review_status).toBe("live");
    expect(game?.live_version_id).toBe(first.versionId);
  });
});

describe("the evidence-first review", () => {
  const month = () => new Date().toISOString().slice(0, 7);
  const usage = () => env.DB.prepare("SELECT review_cost_cents, review_call_count, scan_call_count, input_token_count FROM ai_usage WHERE month = ?").bind(month()).first<{ review_cost_cents: number; review_call_count: number; scan_call_count: number; input_token_count: number }>();
  const judgedAtMs = (versionId: string) => env.DB.prepare("SELECT judged_at_ms FROM versions WHERE id = ?").bind(versionId).first<number | null>("judged_at_ms");
  let alerts: string[];
  beforeEach(() => {
    alerts = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void alerts.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());

  /** Readers that list one connects_to item per address they're shown, counting their calls. */
  const countingReaders = (calls: { readerCallCount: number; judgeCallCount: number }): Omit<ScanDeps, "images"> => {
    const readCode: ReadCode = async (_key, _model, chunk) => {
      calls.readerCallCount++;
      const items = chunk.files.flatMap((file) => [...file.text.matchAll(/new WebSocket\(host \+ "(\w+)"\)/g)].map((match) => ({ kind: "connects_to" as const, subject: `${match[1]}.example.invalid`, detail: "Connects to a host built from pieces.", path: file.path, quote: match[0] })));
      return { items, outcome: "read", costCents: 0.5, inputTokenCount: 1000, outputTokenCount: 50 };
    };
    return { ...countedAiSays(calls), readCode, readPictures: seesNothing };
  };

  it("reads, then judges a first upload, and reuses both for the same files again", async () => {
    const calls = { readerCallCount: 0, judgeCallCount: 0 };
    const first = await uploadAndScan(CLEAN_GAME, { images: connected, ...countingReaders(calls) });
    expect(first.report.decision).toBe("approved");
    expect(first.report.ai).toMatchObject({ judge_model: "claude-sonnet-5-5", reader_model: "claude-haiku-5-5", verdict: "pass", reused_from_version_id: null });
    expect(calls).toEqual({ readerCallCount: 1, judgeCallCount: 1 });
    expect(await judgedAtMs(first.versionId)).toBeGreaterThan(0);
    expect(first.report.read_file_sha256s).toHaveLength(3);
    expect(await usage()).toMatchObject({ review_cost_cents: 1.5, review_call_count: 2, scan_call_count: 1, input_token_count: 0 });

    // The same files: nothing to read, nothing new in the evidence, so the verdict is reused.
    const again = await uploadAndScan(CLEAN_GAME, { images: connected, ...countingReaders(calls) });
    expect(again.report.decision).toBe("approved");
    expect(again.report.ai).toMatchObject({ verdict: "reused", reused_from_version_id: first.versionId, cost_cents: 0 });
    expect(calls).toEqual({ readerCallCount: 1, judgeCallCount: 1 });
    expect(await judgedAtMs(again.versionId)).toBeNull();

    // A new host in a changed file: read again and judged.
    const changed = await uploadAndScan({ ...CLEAN_GAME, "game.js": `${CLEAN_GAME["game.js"]} const socket = new WebSocket(host + "relay");` }, { images: connected, ...countingReaders(calls) });
    expect(calls).toEqual({ readerCallCount: 2, judgeCallCount: 2 });
    expect(changed.report.ai?.verdict).toBe("pass");
    expect(changed.report.evidence).toContainEqual(expect.objectContaining({ kind: "connects_to", subject: "relay.example.invalid", path: "game.js", source: "reader" }));
  });

  it("passes the fix for a held protection attempt on the cheap reads, and judges a version that still has it", async () => {
    const calls = { readerCallCount: 0, judgeCallCount: 0 };
    // Readers: a link opened after a timer is link_without_tap, and a tap that opens a registered link is an ordinary link.
    const readCode: ReadCode = async (_key, _model, chunk) => {
      calls.readerCallCount++;
      const items = chunk.files.flatMap((file) => [
        ...[...file.text.matchAll(/setTimeout\(\(\) => window\.open\([^)]*\)/g)].map((match) => ({ kind: "protection_attempt" as const, subject: "link_without_tap", detail: "Opens a site on a timer.", path: file.path, quote: match[0] })),
        ...[...file.text.matchAll(/Zaisma\.links\.open\("(\w+)"\)/g)].map((match) => ({ kind: "opens_link" as const, subject: match[1]!, detail: "Opens a registered link.", path: file.path, quote: match[0] })),
      ]);
      return { items, outcome: "read", costCents: 0.5, inputTokenCount: 1000, outputTokenCount: 50 };
    };
    const judge = async (...input: Parameters<typeof judgeVersion>) => {
      calls.judgeCallCount++;
      const [, , brief] = input;
      const isDodging = brief.items.some((evidenceItem) => evidenceItem.kind === "protection_attempt");
      return judgeSays(isDodging ? "hold" : "pass", isDodging ? [{ stage: "ai", severity: "hold", code: "ai_protection_dodged", message: "Opens a site with no tap." }] : [])(...input);
    };
    const deps = { images: connected, readCode, readPictures: seesNothing, judge };
    const withScript = (script: string) => ({ ...CLEAN_GAME, "game.js": `${CLEAN_GAME["game.js"]} ${script}` });

    const held = await uploadAndScan(withScript('setTimeout(() => window.open("https://shop.example.invalid"), 30000);'), deps);
    expect(held.report.decision).toBe("held");
    expect(held.report.findings.map((finding) => finding.code)).toContain("ai_protection_dodged");
    expect(calls.judgeCallCount).toBe(1);

    // The fix swaps the timer for a tap on a registered link: a new link subject, nothing the hold stood on, no judged review (only the changed file is read, 0.5 cents).
    const fixed = await uploadAndScan(withScript('button.onclick = () => Zaisma.links.open("shop");'), deps);
    expect(fixed.report.decision).toBe("approved");
    expect(fixed.report.ai).toMatchObject({ verdict: "reused", reused_from_version_id: held.versionId, cost_cents: 0.5 });
    expect(calls.judgeCallCount).toBe(1);
    expect(await judgedAtMs(fixed.versionId)).toBeNull();

    // A version that still has it is judged and held again.
    const again = await uploadAndScan(withScript('setTimeout(() => window.open("https://other.example.invalid"), 1000);'), deps);
    expect(again.report.decision).toBe("held");
    expect(calls.judgeCallCount).toBe(2);
  });

  it("never uses a version held for anything else as the baseline for a cheap pass", async () => {
    const calls = { judgeCallCount: 0 };
    const held = await uploadAndScan(CLEAN_GAME, { images: connected, ...countedAiSays(calls, "hold") });
    expect(held.report.decision).toBe("held");
    expect(calls.judgeCallCount).toBe(1);
    await uploadAndScan(CLEAN_GAME, { images: connected, ...countedAiSays(calls, "hold") });
    expect(calls.judgeCallCount).toBe(2);
  });

  it("drops a reader's item whose quote isn't in the file", async () => {
    const madeUp: ReadCode = async (_key, _model, chunk) => ({
      items: [
        { kind: "asks_player", subject: "email", detail: "Asks for an email.", path: chunk.files[0]!.path, quote: "prompt('Your email?')" },
        { kind: "content", subject: "allowed_content", detail: "A score counter.", path: "game.js", quote: "let score = 0;" },
      ],
      outcome: "read",
      costCents: 0.1,
      inputTokenCount: 10,
      outputTokenCount: 1,
    });
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("pass"), readCode: madeUp });
    expect(report.evidence?.map((item) => item.kind)).toEqual(["content"]);
  });

  it("holds an owner's 6th judged version in a day without an alert, and judges it once a review frees up", async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO owners (id, kind, created_at_ms) VALUES ('owner_daily', 'person', 1)").run();
    const calls = { judgeCallCount: 0 };
    const versions: string[] = [];
    for (let index = 1; index <= 6; index++) {
      const uploaded = await upload(CLEAN_GAME, `daily-${index}`);
      const { versionId, gameId } = (await uploaded.json()) as { versionId: string; gameId: string };
      await env.DB.prepare("UPDATE games SET owner_id = 'owner_daily' WHERE id = ?").bind(gameId).run();
      await scanVersion(testEnv, versionId, { images: connected, ...countedAiSays(calls) });
      versions.push(versionId);
    }
    expect(calls.judgeCallCount).toBe(5);
    const waiting = (await versionById(env.DB, versions[5]!))!;
    expect(waiting.scan_status).toBe("held");
    expect(JSON.parse(waiting.scan_report!).findings.map((finding: { code: string }) => finding.code)).toEqual(["daily_large_reviews_used"]);
    expect(alerts.filter((line) => line.includes("needs review"))).toEqual([]);
    expect(await rescanWaiting(testEnv)).toBe(0);

    // A day later the reviews free up: the cron queues it, and its scan reuses the reading and judges it.
    await env.DB.prepare("UPDATE versions SET judged_at_ms = judged_at_ms - ? WHERE judged_at_ms IS NOT NULL").bind(25 * 60 * 60 * 1000).run();
    expect(await rescanWaiting(testEnv)).toBe(1);
    expect((await versionById(env.DB, versions[5]!))!.scan_status).toBe("scanning");
    const readerCalls = { readerCallCount: 0, judgeCallCount: 0 };
    const report = await scanVersion(testEnv, versions[5]!, { images: connected, ...countingReaders(readerCalls) });
    expect(report.decision).toBe("approved");
    expect(readerCalls).toEqual({ readerCallCount: 0, judgeCallCount: 1 });
  });

  it("stops at the monthly budget, and tells Julius once a month at 80%", async () => {
    await env.DB.prepare("INSERT INTO ai_usage (month, review_cost_cents) VALUES (?, 7999)").bind(month()).run();
    await uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("pass") }, "budget-one");
    await uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("pass") }, "budget-two");
    expect(alerts.filter((line) => line.startsWith("[alert] AI review budget"))).toEqual(["[alert] AI review budget at 80%"]);
    await env.DB.prepare("UPDATE ai_usage SET review_cost_cents = 10000").run();
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("pass") }, "budget-three");
    expect(report.findings.map((finding) => finding.code)).toContain("ai_review_budget_used");
  });

  it("asks the judge again when it declines, holds when it declines every try, and turns a reject that cites no evidence into a hold", async () => {
    // Each call to the API answers the next body in the list, the last one from then on.
    const answers = (...bodies: Record<string, unknown>[]) => {
      let callIndex = 0;
      return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        const body = bodies[Math.min(callIndex++, bodies.length - 1)];
        return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: "end_turn", usage: { input_tokens: 2000, output_tokens: 100 }, ...body }), { headers: { "Content-Type": "application/json" } });
      });
    };
    const verdict = (fields: Record<string, unknown>) => ({ content: [{ type: "text", text: JSON.stringify({ summary: "S.", has_sexual_content_involving_minors: false, findings: [], ...fields }) }] });
    const refusal = { stop_reason: "refusal", content: [] };
    const items: EvidenceItem[] = [{ kind: "content", subject: "sexual", detail: "A picture.", path: "art/a.png", quote: "", file_sha256: "", source: "reader" }];
    const brief = { title: "T", description: "", fileCount: 1, items, pictures: [] };

    // Declined once, answered on the second try: its verdict counts, and both tries are paid for.
    let fetchSpy = answers(refusal, verdict({ verdict: "pass" }));
    const retried = await judgeVersion("test-key", "claude-sonnet-5-5", brief);
    expect(retried).toMatchObject({ verdict: "pass", declinedAttemptCount: 1, findings: [] });
    expect(retried.costCents).toBeCloseTo(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchSpy.mock.calls[1]![1] as RequestInit).body))).not.toHaveProperty("fallbacks");

    // Declined every try: a person looks.
    vi.restoreAllMocks();
    fetchSpy = answers(refusal);
    const refused = await judgeVersion("test-key", "claude-sonnet-5-5", brief);
    expect(refused).toMatchObject({ verdict: "hold", declinedAttemptCount: 3 });
    expect(refused.findings.map((finding) => finding.code)).toEqual(["ai_review_declined"]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // A picture's item has no quote and is proof all the same; a finding that cites nothing is held for a person.
    vi.restoreAllMocks();
    answers(verdict({ verdict: "reject", findings: [{ code: "ai_sexual_content", evidence_item_numbers: [1], message: "A picture." }] }));
    const picture = await judgeVersion("test-key", "claude-sonnet-5-5", brief);
    expect(picture.verdict).toBe("reject");
    expect(picture.findings).toEqual([{ stage: "ai", severity: "reject", code: "ai_sexual_content", message: "A picture.", path: "art/a.png" }]);
    vi.restoreAllMocks();
    answers(verdict({ verdict: "reject", findings: [{ code: "ai_sexual_content", evidence_item_numbers: [], message: "A picture." }] }));
    const uncited = await judgeVersion("test-key", "claude-sonnet-5-5", brief);
    expect(uncited.verdict).toBe("hold");
    expect(uncited.findings).toEqual([{ stage: "ai", severity: "hold", code: "ai_sexual_content", message: "A picture." }]);
  });

  it("holds more code than the review reads, without reading it", async () => {
    const calls = { readerCallCount: 0, judgeCallCount: 0 };
    const big = "x".repeat(REVIEW_LIMITS.readerChunkCharacterCount - REVIEW_LIMITS.readerChunkOverlapCharacterCount).repeat(REVIEW_LIMITS.maximumReaderChunkCount + 1);
    const gathered = await gatherEvidence(
      { apiKey: "k", readerModel: "claude-haiku-5-5", readerContext: { title: "T", description: "", fileList: [], checkItems: [] }, texts: [{ path: "big.js", text: big, sha256: "a" }], pictures: [], previous: null },
      countingReaders(calls),
    );
    expect(gathered.findings.map((finding) => finding.code)).toEqual(["too_much_code"]);
    expect(calls.readerCallCount).toBe(0);
  });
});

describe("the judge decides from the tests", () => {
  const items: EvidenceItem[] = [
    { kind: "player_text", subject: "read_by_others", detail: "A chat box.", path: "chat.js", quote: "socket.send(text)", file_sha256: "", source: "reader" },
    { kind: "content", subject: "sexual", detail: "Nudity.", path: "art/ending.png", quote: "", file_sha256: "", source: "reader" },
    { kind: "content", subject: "lifelike_gore", detail: "Lifelike gore.", path: "gore.js", quote: "drawWound()", file_sha256: "", source: "reader" },
  ];
  const answer = (verdict: "pass" | "hold" | "reject", findings: { code: string; evidence_item_numbers: number[] }[]) =>
    settle({ verdict, summary: "A game.", has_sexual_content_involving_minors: false, findings: findings.map((finding) => ({ ...finding, message: `${finding.code}.` })) }, items);

  it("rejects a finding that cites the evidence, whatever verdict the judge picked, a picture's included", () => {
    expect(answer("hold", [{ code: "ai_free_text_chat", evidence_item_numbers: [1] }])).toMatchObject({ verdict: "reject", findings: [{ code: "ai_free_text_chat", severity: "reject", path: "chat.js" }] });
    expect(answer("hold", [{ code: "ai_sexual_content", evidence_item_numbers: [2] }])).toMatchObject({ verdict: "reject", findings: [{ code: "ai_sexual_content", severity: "reject", path: "art/ending.png" }] });
    expect(answer("hold", [{ code: "ai_lifelike_gore", evidence_item_numbers: [3] }, { code: "ai_free_text_chat", evidence_item_numbers: [1] }]).verdict).toBe("reject");
  });

  it("holds for a person only for lifelike gore alone, a finding with no evidence, or a judge that stops a game with no finding", () => {
    expect(answer("pass", [{ code: "ai_lifelike_gore", evidence_item_numbers: [3] }])).toMatchObject({ verdict: "hold", findings: [{ code: "ai_lifelike_gore", severity: "hold" }] });
    expect(answer("reject", [{ code: "ai_malware", evidence_item_numbers: [9] }])).toMatchObject({ verdict: "hold", findings: [{ code: "ai_malware", severity: "hold" }] });
    expect(answer("hold", [])).toMatchObject({ verdict: "hold", findings: [{ code: "ai_concern" }] });
    expect(answer("pass", [])).toMatchObject({ verdict: "pass", findings: [] });
  });
});

describe("re-uploads checked against their hold", () => {
  let alerts: string[];
  let clockMs: number;
  beforeEach(() => {
    alerts = [];
    clockMs = Date.now() - 60_000;
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void alerts.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());

  /** A file-by-file version of a game, as the developer API makes one: blobs, a manifest, and the newer versions replacing waiting ones. */
  const filesVersion = async (gameId: string, files: Record<string, string>): Promise<string> => {
    const versionId = newId("version");
    const manifest: Manifest = { files: {} };
    for (const [path, text] of Object.entries(files)) {
      const sha256 = await sha256Hex(new TextEncoder().encode(text));
      await env.GAMES.put(blobKey(sha256), text);
      manifest.files[path] = { sha256 };
    }
    await env.GAMES.put(manifestKey(versionId), JSON.stringify(manifest));
    await createVersion(env.DB, { id: versionId, gameId, r2Prefix: `manifests/${versionId}`, fileCount: Object.keys(files).length, sizeBytes: 0, kind: "files" });
    await env.DB.prepare("UPDATE versions SET created_at_ms = ? WHERE id = ?").bind((clockMs += 1000), versionId).run();
    await replaceWaitingVersions(testEnv, gameId, versionId);
    return versionId;
  };
  /** Readers that list a content item for each flag("<subject>") in the code, counting their calls. */
  const readsFlags = (calls: { readerCallCount: number }): ReadCode => async (_key, _model, chunk) => {
    calls.readerCallCount++;
    const items = chunk.files.flatMap((file) => [...file.text.matchAll(/flag\("(\w+)"\)/g)].map((match) => ({ kind: "content" as const, subject: match[1]!, detail: "Flagged.", path: file.path, quote: match[0] })));
    return { items, outcome: "read", costCents: 0.5, inputTokenCount: 100, outputTokenCount: 10 };
  };
  type JudgeFinding = { code: string; path: string };
  /** A judge that answers these findings, citing the items in their files, settled as the real judge settles them. */
  const judgeFinds = (briefs: JudgeBrief[], findings: (brief: JudgeBrief) => JudgeFinding[]): JudgeVersion => async (_key, _model, brief) => {
    briefs.push(brief);
    const found = findings(brief);
    const parsed = {
      verdict: found.length ? ("hold" as const) : ("pass" as const),
      summary: "A castle game.",
      has_sexual_content_involving_minors: false,
      findings: found.map((finding) => ({ code: finding.code, evidence_item_numbers: [brief.items.findIndex((evidenceItem) => evidenceItem.path === finding.path) + 1], message: `${finding.code} in ${finding.path}` })),
    };
    return { ...settle(parsed, brief.items, brief.earlierHold), followedReviewPrecedentNumbers: [], declinedAttemptCount: 0, costCents: 1, inputTokenCount: 10, outputTokenCount: 1 };
  };
  const HELD_FOR_GORE = { "index.html": CLEAN_GAME["index.html"], "game.js": 'flag("real_people");', "gore.js": 'flag("lifelike_gore");' };
  const FIXED = { "index.html": CLEAN_GAME["index.html"], "game.js": 'flag("real_people");', "gore.js": "// Stylized sparks.", "chat.js": 'flag("faked_plays");' };

  it("checks a fix against its hold: what the held version already had stays passed, except malware", async () => {
    const cases: { fixFinding: JudgeFinding; decision: ScanReport["decision"] }[] = [
      { fixFinding: { code: "ai_other", path: "game.js" }, decision: "approved" },
      { fixFinding: { code: "ai_other", path: "chat.js" }, decision: "rejected" },
      { fixFinding: { code: "ai_malware", path: "game.js" }, decision: "rejected" },
    ];
    for (const [index, { fixFinding, decision }] of cases.entries()) {
      const game = await createGame(env.DB, { slug: `ember-keep-${index}`, title: "Ember Keep", description: "Hold the keep." });
      const briefs: JudgeBrief[] = [];
      const deps: ScanDeps = { images: connected, readCode: readsFlags({ readerCallCount: 0 }), readPictures: seesNothing, judge: judgeFinds(briefs, (brief) => (brief.earlierHold ? [fixFinding] : [{ code: "ai_lifelike_gore", path: "gore.js" }])) };
      const held = await scanVersion(testEnv, await filesVersion(game.id, HELD_FOR_GORE), deps);
      expect(held.decision).toBe("held");
      expect(briefs[0]!.earlierHold).toBeUndefined();

      const fixed = await scanVersion(testEnv, await filesVersion(game.id, FIXED), deps);
      const brief = briefs[1]!;
      expect(brief.earlierHold).toMatchObject({ findings: [{ code: "ai_lifelike_gore", path: "gore.js" }], addedPaths: ["chat.js"], changedPaths: ["gore.js"], removedPaths: [] });
      expect(brief.earlierHold!.carriedItemNumbers).toEqual([brief.items.findIndex((evidenceItem) => evidenceItem.path === "game.js") + 1]);
      expect(fixed.decision).toBe(decision);
      expect(fixed.findings.find((finding) => finding.code === fixFinding.code)?.severity).toBe(decision === "approved" ? "info" : "reject");
    }
  });

  it("holds a version unread past 30 small reviews a day, and lets one with nothing new to read through", async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO owners (id, kind, created_at_ms) VALUES ('owner_small', 'person', 1)").run();
    const game = await createGame(env.DB, { slug: "small-reviews", title: "Small Reviews", description: "A test.", ownerId: "owner_small" });
    const calls = { readerCallCount: 0 };
    const deps: ScanDeps = { images: connected, readCode: readsFlags(calls), readPictures: seesNothing, judge: judgeSays("pass") };
    const first = await filesVersion(game.id, CLEAN_GAME);
    await scanVersion(testEnv, first, deps);
    expect((await versionById(env.DB, first))!.read_at_ms).toBeGreaterThan(0);
    for (let index = 1; index < PLAN_LIMITS.free.maximumSmallReviewsPerDay; index++) {
      await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms, read_at_ms) VALUES (?, ?, 'none', 0, 0, 'rejected', 1, ?)").bind(newId("version"), game.id, Date.now()).run();
    }
    const readerCallCount = calls.readerCallCount;

    const same = await scanVersion(testEnv, await filesVersion(game.id, CLEAN_GAME), deps);
    expect(same.decision).toBe("approved");

    const changed = await scanVersion(testEnv, await filesVersion(game.id, { ...CLEAN_GAME, "game.js": "let score = 1;" }), deps);
    expect(changed.findings.map((finding) => finding.code)).toEqual(["daily_small_reviews_used"]);
    expect(changed.evidence).toBeUndefined();
    expect(changed.findings[0]!.message).toContain("Zaisma Pro has 100 small reviews a day.");
    expect(calls.readerCallCount).toBe(readerCallCount);
    expect(alerts.filter((line) => line.includes("needs review"))).toEqual([]);
  });

  it("gives a developer with Zaisma Pro 100 small reviews a day, where free has 30", async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO owners (id, kind, created_at_ms, pro_until_ms) VALUES ('owner_pro_small', 'person', 1, ?)").bind(Date.now() + 86_400_000).run();
    const game = await createGame(env.DB, { slug: "pro-small-reviews", title: "Pro Small Reviews", description: "A test.", ownerId: "owner_pro_small" });
    const calls = { readerCallCount: 0 };
    const deps: ScanDeps = { images: connected, readCode: readsFlags(calls), readPictures: seesNothing, judge: judgeSays("pass") };
    await scanVersion(testEnv, await filesVersion(game.id, CLEAN_GAME), deps);
    const readRows = async (count: number) => {
      for (let index = 0; index < count; index++) {
        await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms, read_at_ms) VALUES (?, ?, 'none', 0, 0, 'rejected', 1, ?)").bind(newId("version"), game.id, Date.now()).run();
      }
    };
    await readRows(PLAN_LIMITS.free.maximumSmallReviewsPerDay);
    const withinPro = await scanVersion(testEnv, await filesVersion(game.id, { ...CLEAN_GAME, "game.js": "let score = 1;" }), deps);
    expect(withinPro.findings.map((finding) => finding.code)).not.toContain("daily_small_reviews_used");
    await readRows(PLAN_LIMITS.pro.maximumSmallReviewsPerDay);
    const overPro = await scanVersion(testEnv, await filesVersion(game.id, { ...CLEAN_GAME, "game.js": "let score = 2;" }), deps);
    expect(overPro.findings.find((finding) => finding.code === "daily_small_reviews_used")?.message).not.toContain("Zaisma Pro");
  });

  it("gives a developer with Zaisma Pro 20 large reviews a day, and names Pro only to one without it", async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO owners (id, kind, created_at_ms, pro_until_ms) VALUES ('owner_pro', 'person', 1, ?)").bind(Date.now() + 86_400_000).run();
    await env.DB.prepare("INSERT OR IGNORE INTO owners (id, kind, created_at_ms) VALUES ('owner_free', 'person', 1)").run();
    const proGame = await createGame(env.DB, { slug: "pro-reviews", title: "Pro Reviews", description: "A test.", ownerId: "owner_pro" });
    const freeGame = await createGame(env.DB, { slug: "free-reviews", title: "Free Reviews", description: "A test.", ownerId: "owner_free" });
    const judgedRows = async (gameId: string, count: number) => {
      for (let index = 0; index < count; index++) {
        await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms, judged_at_ms) VALUES (?, ?, 'none', 0, 0, 'rejected', 1, ?)").bind(newId("version"), gameId, Date.now()).run();
      }
    };
    const deps: ScanDeps = { images: connected, ...aiSays("pass") };

    await judgedRows(proGame.id, PLAN_LIMITS.free.maximumLargeReviewsPerDay);
    const withinPro = await scanVersion(testEnv, await filesVersion(proGame.id, CLEAN_GAME), deps);
    expect(withinPro.findings.map((finding) => finding.code)).not.toContain("daily_large_reviews_used");

    await judgedRows(proGame.id, PLAN_LIMITS.pro.maximumLargeReviewsPerDay);
    const otherProGame = await createGame(env.DB, { slug: "pro-reviews-two", title: "Pro Reviews Two", description: "A test.", ownerId: "owner_pro" });
    const overPro = (await scanVersion(testEnv, await filesVersion(otherProGame.id, CLEAN_GAME), deps)).findings.find((finding) => finding.code === "daily_large_reviews_used");
    expect(overPro?.message).toContain("20 large reviews");
    expect(overPro?.message).not.toContain("Zaisma Pro");

    await judgedRows(freeGame.id, PLAN_LIMITS.free.maximumLargeReviewsPerDay);
    const overFree = (await scanVersion(testEnv, await filesVersion(freeGame.id, CLEAN_GAME), deps)).findings.find((finding) => finding.code === "daily_large_reviews_used");
    expect(overFree?.message).toContain("5 large reviews");
    expect(overFree?.message).toContain("Zaisma Pro has 20 large reviews a day.");
  });

  it("steps a waiting version aside for a newer one, never live over it, but keeps a child-safety hold", async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO owners (id, kind, created_at_ms) VALUES ('owner_wait', 'person', 1)").run();
    const game = await createGame(env.DB, { slug: "step-aside", title: "Step Aside", description: "A test.", ownerId: "owner_wait" });
    for (let index = 0; index < PLAN_LIMITS.free.maximumLargeReviewsPerDay; index++) {
      await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms, judged_at_ms) VALUES (?, ?, 'none', 0, 0, 'rejected', 1, ?)").bind(newId("version"), game.id, Date.now()).run();
    }
    const deps: ScanDeps = { images: connected, ...aiSays("pass") };
    const first = await filesVersion(game.id, CLEAN_GAME);
    expect((await scanVersion(testEnv, first, deps)).findings.map((finding) => finding.code)).toEqual(["daily_large_reviews_used"]);
    const second = await filesVersion(game.id, { ...CLEAN_GAME, "game.js": "let score = 2;" });
    const replaced = (await versionById(env.DB, first))!;
    expect(replaced.replaced_by_version_id).toBe(second);
    expect((await heldVersions(env.DB)).map((version) => version.id)).not.toContain(first);
    await env.DB.prepare("UPDATE versions SET judged_at_ms = judged_at_ms - ? WHERE judged_at_ms IS NOT NULL").bind(25 * 60 * 60 * 1000).run();
    expect(await rescanWaiting(testEnv)).toBe(0);

    // A person approving it anyway: a draft, never live over the newer version.
    await passVersion(testEnv, replaced, "Approved by a person");
    expect((await versionById(env.DB, first))!.scan_status).toBe("approved");
    expect((await gameById(env.DB, game.id))!.live_version_id).toBeNull();

    // Child safety stays in the queue.
    const flagged = await filesVersion(game.id, { ...CLEAN_GAME, "game.js": "let score = 3;" });
    await scanVersion(testEnv, flagged, { images: connected, ...aiSays("hold", true) });
    await filesVersion(game.id, { ...CLEAN_GAME, "game.js": "let score = 4;" });
    expect((await versionById(env.DB, flagged))!.replaced_by_version_id).toBeNull();
  });

  it("emails needs review once per game in the queue, and URGENT every time", async () => {
    const game = await createGame(env.DB, { slug: "one-email", title: "One Email", description: "A test." });
    const first = await filesVersion(game.id, CLEAN_GAME);
    await scanVersion(testEnv, first, { images: connected, ...aiSays("hold") });
    expect(alerts.filter((line) => line.includes("one-email needs review"))).toHaveLength(1);
    const second = await filesVersion(game.id, { ...CLEAN_GAME, "game.js": "let score = 5;" });
    expect((await versionById(env.DB, first))!.replaced_by_version_id).toBe(second);
    expect((await scanVersion(testEnv, second, { images: connected, ...aiSays("hold") })).decision).toBe("held");
    expect(alerts.filter((line) => line.includes("one-email needs review"))).toHaveLength(1);
    const third = await filesVersion(game.id, { ...CLEAN_GAME, "game.js": "let score = 6;" });
    await scanVersion(testEnv, third, { images: connected, ...aiSays("hold", true) });
    expect(alerts.filter((line) => line.includes("URGENT child-safety flag on one-email"))).toHaveLength(1);
  });

  describe("readers read only what changed in a file", () => {
    const bundle = minifiedBundle(1_000_000);
    const withFlags = (text: string) => `flag("real_people");${text.slice(0, 600_000)}flag("lifelike_gore");${text.slice(600_000)}`;

    it("reads only the changed regions of a big file, keeping earlier items still quoted in it", async () => {
      const game = await createGame(env.DB, { slug: "big-bundle", title: "Big Bundle", description: "A test." });
      const sentChunks: CodeChunk[] = [];
      const reads = readsFlags({ readerCallCount: 0 });
      const deps: ScanDeps = { images: connected, readCode: async (...input) => (sentChunks.push(input[2]), reads(...input)), readPictures: seesNothing, judge: judgeSays("pass") };
      const first = await scanVersion(testEnv, await filesVersion(game.id, { ...CLEAN_GAME, "bundle.js": withFlags(bundle) }), deps);
      expect(first.evidence!.filter((evidenceItem) => evidenceItem.path === "bundle.js").map((evidenceItem) => evidenceItem.subject).sort()).toEqual(["lifelike_gore", "real_people"]);

      // One string changed in the middle, and the gore flag edited away near the end.
      sentChunks.length = 0;
      const changed = withFlags(`${bundle.slice(0, 300_000)}"a new string"${bundle.slice(300_014)}`).replace('flag("lifelike_gore");', 'flag("allowed_content");');
      const changedSha256 = await sha256Hex(new TextEncoder().encode(changed));
      const second = await scanVersion(testEnv, await filesVersion(game.id, { ...CLEAN_GAME, "bundle.js": changed }), deps);
      const sentParts = sentChunks.flatMap((chunk) => chunk.files).filter((file) => file.path === "bundle.js");
      expect(sentParts.length).toBeGreaterThan(0);
      expect(sentParts.every((file) => file.isChangedOnly)).toBe(true);
      expect(sentParts.reduce((characterCount, file) => characterCount + file.text.length, 0)).toBeLessThan(changed.length / 10);
      expect(second.evidence!.filter((evidenceItem) => evidenceItem.path === "bundle.js").map((evidenceItem) => [evidenceItem.subject, evidenceItem.file_sha256])).toEqual(
        expect.arrayContaining([["real_people", changedSha256], ["allowed_content", changedSha256]]),
      );
      expect(second.evidence!.some((evidenceItem) => evidenceItem.subject === "lifelike_gore")).toBe(false);
      expect(second.read_file_sha256s).toContain(changedSha256);

      // A file mostly rewritten is read whole.
      sentChunks.length = 0;
      await scanVersion(testEnv, await filesVersion(game.id, { ...CLEAN_GAME, "bundle.js": withFlags(minifiedBundle(1_000_000, 9)) }), deps);
      const wholeParts = sentChunks.flatMap((chunk) => chunk.files).filter((file) => file.path === "bundle.js");
      expect(wholeParts.some((file) => file.isChangedOnly)).toBe(false);
      expect(wholeParts.reduce((characterCount, file) => characterCount + file.text.length, 0)).toBeGreaterThan(1_000_000);
    });

    it("looks a file up on VirusTotal once, reuses a not-known for a day, and stores no failed lookup", async () => {
      await env.DB.exec("DELETE FROM antivirus_lookups;");
      const lookedUp: string[] = [];
      const answerBySha = new Map<string, number>();
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.startsWith("https://www.virustotal.com/")) return realFetch(input, init);
        const sha256 = url.split("/").at(-1)!;
        lookedUp.push(sha256);
        const status = answerBySha.get(sha256) ?? 404;
        return status === 200 ? Response.json({ data: { attributes: { last_analysis_stats: { malicious: 0 } } } }) : new Response(null, { status });
      }) as typeof fetch;
      try {
        const scanEnv = { ...testEnv, VT_API_KEY: "test-vt-key" };
        const game = await createGame(env.DB, { slug: "antivirus", title: "Antivirus", description: "A test." });
        const shaOf = async (text: string) => sha256Hex(new TextEncoder().encode(text));
        const known = "let known = 1;";
        const failing = "let failing = 1;";
        answerBySha.set(await shaOf(known), 200).set(await shaOf(failing), 500);
        const files = { "index.html": CLEAN_GAME["index.html"], "known.js": known, "unknown.js": "let unknown = 1;", "failing.js": failing };
        const deps: ScanDeps = { images: connected, ...aiSays("pass") };

        await scanVersion(scanEnv, await filesVersion(game.id, files), deps);
        expect(lookedUp).toHaveLength(4);
        const second = await scanVersion(scanEnv, await filesVersion(game.id, files), deps);
        expect(lookedUp.slice(4)).toEqual([await shaOf(failing)]);
        expect(second.findings.map((finding) => finding.code)).toContain("antivirus_unavailable");
        const rows = await env.DB.prepare("SELECT sha256, malicious_engine_count FROM antivirus_lookups").all<{ sha256: string; malicious_engine_count: number | null }>();
        const countBySha = new Map(rows.results.map((row) => [row.sha256, row.malicious_engine_count]));
        expect(countBySha.size).toBe(3);
        expect(countBySha.get(await shaOf(known))).toBe(0);
        expect(countBySha.get(await shaOf("let unknown = 1;"))).toBeNull();
        expect(countBySha.has(await shaOf(failing))).toBe(false);

        // A day later the not-known file is looked up again; the known one waits out its week.
        await env.DB.prepare("UPDATE antivirus_lookups SET looked_up_at_ms = looked_up_at_ms - ?").bind(25 * 60 * 60 * 1000).run();
        lookedUp.length = 0;
        await scanVersion(scanEnv, await filesVersion(game.id, files), deps);
        expect(lookedUp.sort()).toEqual([await shaOf(failing), await shaOf("let unknown = 1;"), await shaOf(CLEAN_GAME["index.html"])].sort());
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  });
});

describe("reports and takedowns", () => {
  async function liveGame() {
    return uploadAndScan(CLEAN_GAME, { images: connected, ...aiSays("pass") });
  }
  const report = (reason: string, details = "") => {
    const form = new FormData();
    form.set("reason", reason);
    form.set("details", details);
    return SELF.fetch(`${LOCAL}/g/test-game/report`, { method: "POST", body: form, headers: { "CF-Connecting-IP": "203.0.113.9" } });
  };

  it("stores a report with no reporter data", async () => {
    await liveGame();
    expect((await report("broken", "won't load")).status).toBe(200);
    const row = await env.DB.prepare("SELECT * FROM reports").first<Record<string, unknown>>();
    expect(row?.player_text).toBe("won't load");
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
    const cols = (await env.DB.prepare("PRAGMA table_info(reports)").all<{ name: string }>()).results.map((c) => c.name);
    expect(cols.sort()).toEqual(["bug_report_at_ms", "closed_at_ms", "game_id", "has_block_between", "has_picture", "id", "is_bug_report", "is_passed_to_developer", "passed_to_developer_at_ms", "player_id", "player_name", "player_reason", "player_text", "precedent_id", "reason", "report_group_id", "report_status", "reported_at_ms", "reported_chat_json", "room_code", "room_name", "severity_index", "triage", "triage_attempt_count", "triaged_at_ms", "version_id"]);
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
  });

  it("hides a game straight away on a child-safety report", async () => {
    await liveGame();
    await report("child_safety");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("held");
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(404);
  });

  // The plate beside the game sends JSON from zaisma.com itself.
  // Each report comes from its own address, so the rate limit stays out of the way.
  let address = 10;
  const fromPlate = (body: Record<string, unknown>, slug = "test-game", origin = LOCAL) =>
    SELF.fetch(`${LOCAL}/g/${slug}/report`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": `203.0.113.${address++}` }, body: JSON.stringify(body) });

  it("takes a report from the plate with the version and room, and nothing about the reporter", async () => {
    const { versionId } = await liveGame();
    const res = await fromPlate({ reason: "broken", details: "stuck on level 2", room: "abcdef" });
    expect(await res.json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    const row = await env.DB.prepare("SELECT * FROM reports").first<Record<string, unknown>>();
    expect(row).toMatchObject({ reason: "broken", player_text: "stuck on level 2", version_id: versionId, room_code: "ABCDEF", player_id: "" });
    expect(JSON.stringify(row)).not.toContain("203.0.113.");
  });

  it("takes a report about a player, with their temporary ID, and leaves the game up", async () => {
    await liveGame();
    const res = await fromPlate({ reason: "sexual", details: "", room: "ABCDEF", player: { id: "player_0123456789abcdef", name: "Swift Fox 42" } });
    expect(await res.json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    const row = await env.DB.prepare("SELECT * FROM reports").first<Record<string, unknown>>();
    expect(row).toMatchObject({ reason: "player", player_reason: "sexual", player_id: "player_0123456789abcdef", player_name: "Swift Fox 42", room_code: "ABCDEF" });
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
    expect((await fromPlate({ reason: "cheating", player: { id: "<script>", name: "x" } })).status).toBe(400);
  });

  it("says when a report hid the game", async () => {
    await liveGame();
    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: true, is_update_paused: false });
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("held");
  });

  const DAY = 86400_000;
  const live = async () => (await gameBySlug(env.DB, "test-game"))!;

  it("pauses a recent update instead of hiding an established game, once", async () => {
    const first = await liveGame();
    await env.DB.prepare("UPDATE versions SET published_at_ms = ? WHERE id = ?").bind(Date.now() - 30 * DAY, first.versionId).run();
    const update = await uploadAndScan({ ...CLEAN_GAME, "index.html": "<p>v2</p>" }, { images: connected, ...aiSays("pass") });
    expect((await live()).live_version_id).toBe(update.versionId);

    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: true });
    expect(await live()).toMatchObject({ review_status: "live", live_version_id: first.versionId });
    expect((await versionById(env.DB, update.versionId))?.scan_status).toBe("held");

    // The version players went back to can't be paused again by reports.
    expect(await (await fromPlate({ reason: "illegal" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect(await live()).toMatchObject({ review_status: "live", live_version_id: first.versionId });

    // A person puts the update back in one click, and then reports can't pause it either.
    await SELF.fetch(`${LOCAL}/admin/versions/${update.versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await live()).live_version_id).toBe(update.versionId);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE report_status = 'open'").first("n")).toBe(0);
    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect((await live()).live_version_id).toBe(update.versionId);
  });

  it("leaves an established game up when its version is more than a week old", async () => {
    const { versionId } = await liveGame();
    await env.DB.prepare("UPDATE versions SET published_at_ms = ? WHERE id = ?").bind(Date.now() - 8 * DAY, versionId).run();
    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect((await live()).review_status).toBe("live");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(1);
  });

  it("hides a brand-new game only until a person clears it", async () => {
    const { gameId } = await liveGame();
    expect(await (await fromPlate({ reason: "illegal" })).json()).toEqual({ has_reported: true, is_game_hidden: true, is_update_paused: false });
    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/restore`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await live()).review_status).toBe("live");
    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect((await live()).review_status).toBe("live");
  });

  it("refuses plate reports sent from other sites", async () => {
    await liveGame();
    expect((await fromPlate({ reason: "broken" }, "test-game", "https://evil.example")).status).toBe(403);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(0);
  });

  it("takes reports on private games, and answers the same for games that don't exist", async () => {
    await liveGame();
    await env.DB.exec("UPDATE games SET visibility = 'private'");
    expect(await (await fromPlate({ reason: "broken" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(1);
    expect(await (await fromPlate({ reason: "broken" }, "no-such-game")).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(1);
    // The plain form never shows a private game's name.
    expect(await (await SELF.fetch(`${LOCAL}/g/test-game/report`)).text()).not.toContain("Test Game");
  });

  // The start of a JPEG is enough for the server's check.
  const JPEG = "data:image/jpeg;base64," + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4));

  it("keeps a picture of the game when the player includes one, and shows it only in admin", async () => {
    const { gameId } = await liveGame();
    await fromPlate({ reason: "sexual", details: "on level 5", picture: JPEG });
    const row = await env.DB.prepare("SELECT id, has_picture FROM reports").first<{ id: string; has_picture: number }>();
    expect(row?.has_picture).toBe(1);
    expect(await env.GAMES.head(`report-pictures/${row!.id}.jpg`)).not.toBeNull();
    const pic = await SELF.fetch(`${LOCAL}/admin/reports/${row!.id}/picture`);
    expect(pic.headers.get("content-type")).toBe("image/jpeg");
    expect(await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}`)).text()).toContain(`/admin/reports/${row!.id}/picture`);
  });

  it("never keeps a picture with a child-safety report, or anything that isn't a JPEG", async () => {
    await liveGame();
    await fromPlate({ reason: "child_safety", picture: JPEG });
    await fromPlate({ reason: "broken", picture: "data:image/png;base64,iVBORw0KGgo=" });
    expect((await env.DB.prepare("SELECT has_picture FROM reports").all<{ has_picture: number }>()).results).toEqual([{ has_picture: 0 }, { has_picture: 0 }]);
    expect((await env.GAMES.list({ prefix: "report-pictures/" })).objects).toHaveLength(0);
  });

  it("deletes pictures 30 days after the report is closed", async () => {
    const { gameId } = await liveGame();
    await fromPlate({ reason: "broken", picture: JPEG });
    await dailyCleanup(env, Date.now() + 60 * 86400_000);
    expect((await env.GAMES.list({ prefix: "report-pictures/" })).objects).toHaveLength(1); // Still open.
    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/dismiss`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await dailyCleanup(env, Date.now() + 29 * 86400_000)).deletedPictureCount).toBe(0);
    expect((await dailyCleanup(env, Date.now() + 31 * 86400_000)).deletedPictureCount).toBe(1);
    expect((await env.GAMES.list({ prefix: "report-pictures/" })).objects).toHaveLength(0);
    expect(await env.DB.prepare("SELECT has_picture FROM reports").first("has_picture")).toBe(0);
  });

  it("refuses an unknown reason", async () => {
    await liveGame();
    await report("lol");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(0);
  });

  it("takes a game down in one step, with the rule it broke and a reason in the audit log", async () => {
    const { gameId } = await liveGame();
    const noReason = await SELF.fetch(`${LOCAL}/admin/games/${gameId}/takedown`, { method: "POST", body: new FormData() });
    expect(await noReason.text()).toContain("Pick the rule it broke and say why");
    const noRule = new FormData();
    noRule.set("reason", "The login screen asks for a Steam password");
    expect(await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}/takedown`, { method: "POST", body: noRule })).text()).toContain("Pick the rule it broke");
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(200);

    const form = new FormData();
    form.set("reason", "The login screen asks for a Steam password");
    form.set("content_rule", "malware");
    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/takedown`, { method: "POST", body: form, redirect: "manual" });
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(410);
    expect(await (await SELF.fetch(`${LOCAL}/`)).text()).not.toContain('"slug":"test-game"');
    const log = await env.DB.prepare("SELECT action, reason, actor FROM audit_log WHERE action = 'takedown'").first();
    expect(log).toEqual({ action: "takedown", reason: "The login screen asks for a Steam password", actor: "dev@localhost" });
    const removed = await env.DB.prepare("SELECT review_status, review_reason FROM games WHERE id = ?").bind(gameId).first<{ review_status: string; review_reason: string }>();
    expect(removed!.review_status).toBe("removed");
    expect(JSON.parse(removed!.review_reason)).toEqual({ code: "taken_down", message: "The login screen asks for a Steam password", content_rule: "malware" });

    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/restore`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(200);
    expect(await env.DB.prepare("SELECT review_reason FROM games WHERE id = ?").bind(gameId).first("review_reason")).toBeNull();
  });

  const notice = (gameId: string, noticeKind: string, reason: string) => {
    const form = new FormData();
    form.set("notice_kind", noticeKind);
    form.set("reason", reason);
    return SELF.fetch(`${LOCAL}/admin/games/${gameId}/notice`, { method: "POST", body: form, redirect: "manual" });
  };

  it("hides a game on a defamation notice until a fixed version is checked, and it can still get versions", async () => {
    const { gameId } = await liveGame();
    expect(await (await notice(gameId, "libel", "x")).text()).toContain("Pick the kind of notice");
    expect(await (await notice(gameId, "defamation", " ")).text()).toContain("Pick the kind of notice");
    expect((await notice(gameId, "defamation", "The ending calls Emma Clarke the town's thief")).status).toBe(303);
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(404);
    const held = await gameBySlug(env.DB, "test-game");
    expect(held!.review_status).toBe("held");
    expect(JSON.parse(held!.review_reason!)).toEqual({ code: "defamation_notice", message: "A defamation notice names this: The ending calls Emma Clarke the town's thief", content_rule: "defamation" });
    expect(await env.DB.prepare("SELECT reason FROM audit_log WHERE action = 'notice-held'").first("reason")).toBe("The ending calls Emma Clarke the town's thief");
    expect(await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}`)).text()).toContain("Held on a notice");

    // A fixed version goes live behind the hold, and Zaisma is told; the game stays hidden until a person shows it again.
    const fixed = await uploadAndScan({ ...CLEAN_GAME, "index.html": "<!doctype html><p>Fixed</p>" }, { images: connected, ...aiSays("pass") });
    expect((await gameBySlug(env.DB, "test-game"))).toMatchObject({ review_status: "held", live_version_id: fixed.versionId });
    expect(await env.DB.prepare("SELECT reason FROM audit_log WHERE action = 'notice-fix-published'").first("reason")).toContain(fixed.versionId);
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(404);

    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/restore`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(200);
  });

  it("holds a game on a copyright notice the same way, and never one that's taken down", async () => {
    const { gameId } = await liveGame();
    await notice(gameId, "copyright", "The soundtrack is the artist's album");
    expect(JSON.parse((await gameBySlug(env.DB, "test-game"))!.review_reason!)).toEqual({ code: "copyright_notice", message: "A copyright (DMCA) notice names this: The soundtrack is the artist's album", content_rule: "copyright" });

    const form = new FormData();
    form.set("reason", "Malware");
    form.set("content_rule", "malware");
    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/takedown`, { method: "POST", body: form, redirect: "manual" });
    expect(await (await notice(gameId, "copyright", "Again")).text()).toContain("already taken down");
    expect((await gameBySlug(env.DB, "test-game"))!.review_status).toBe("removed");
  });

  it("tells no one when a game held for another reason publishes", async () => {
    const { gameId } = await liveGame();
    await report("child_safety");
    await uploadAndScan({ ...CLEAN_GAME, "index.html": "<!doctype html><p>Next</p>" }, { images: connected, ...aiSays("pass") });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'notice-fix-published' AND game_id = ?").bind(gameId).first("n")).toBe(0);
  });
});

describe("pages", () => {
  it("escapes game text", async () => {
    await env.DB.prepare("INSERT INTO games (id, slug, title, description, review_status, live_version_id, created_at_ms, updated_at_ms) VALUES ('x1', 'xss-game', '<script>alert(1)</script>', '\"><img onerror=1>', 'live', 'v1', 0, 0)").run();
    const home = await (await SELF.fetch(`${LOCAL}/`)).text();
    expect(home).not.toContain("<script>alert(1)");
    // The title reaches the home only in its data block, with < escaped.
    expect(home).toContain("\\u003cscript>alert(1)");
    expect(home).not.toContain('<img onerror');
  });

  it("serves the legal pages and the logo", async () => {
    expect((await SELF.fetch(`${LOCAL}/legal/dmca`)).status).toBe(200);
    expect(await (await SELF.fetch(`${LOCAL}/legal/defamation`)).text()).toContain("mailto:safety@zaisma.com");
    expect((await SELF.fetch(`${LOCAL}/legal/content-rules`)).status).toBe(200);
    expect((await SELF.fetch(`${LOCAL}/nope`)).status).toBe(404);
  });

  it("wraps every page in the glass header and footer, with bodies not yet rebuilt in Steel", async () => {
    const home = await (await SELF.fetch(`${LOCAL}/`)).text();
    // The home is rebuilt in the new look; a page not yet rebuilt (the forum) is still in Steel.
    expect(home).not.toContain('<main class="steel">');
    expect(await (await SELF.fetch(`${LOCAL}/forum`)).text()).toContain('<main class="steel" data-covers-backdrop>');
    expect(home).toContain('<header class="top glass');
    const foot = home.slice(home.indexOf('<footer class="foot glass"'));
    for (const [words, href] of [["For game developers", "/dashboard"], ["Forum", "/forum"], ["Source code", "https://github.com/zaisma/zaisma"], ["Content rules", "/legal/content-rules"], ["Privacy", "/legal/privacy"], ["Security", "/legal/security"], ["Copyright (DMCA)", "/legal/dmca"], ["Defamation", "/legal/defamation"]] as const)
      expect(foot).toMatch(new RegExp(`href="${href.replace(/[.()]/g, "\\$&")}"[^>]*>[\\s\\S]*?${words.replace(/[()]/g, "\\$&")}`));
    expect(foot).toContain("Zaisma is open source, under the MIT license.");
    // Off a developer page the developer tabs are folded away, out of reach.
    expect(home).toContain('<a href="/developers" class="foldable folded" tabindex="-1" aria-hidden="true">Developer</a>');
    // A legal page doesn't know who's looking: its header says Sign in.
    expect(await (await SELF.fetch(`${LOCAL}/legal/privacy`)).text()).toMatch(/<a class="[^"]*run-wrap[^"]*" href="\/signin"/);
  });

  it("opens the developer tabs on the forum and the cover guide, and sends /developers to the dashboard", async () => {
    const forum = await (await SELF.fetch(`${LOCAL}/forum`)).text();
    expect(forum).toContain('<a href="/developers" class="foldable">Developer</a>');
    expect(forum).toContain('<a href="/forum" class="foldable" aria-current="page">Forum</a>');
    const guide = await (await SELF.fetch(`${LOCAL}/developers/covers`)).text();
    expect(guide).toContain('<a href="/developers" class="foldable" aria-current="page">Developer</a>');
    const front = await SELF.fetch(`${LOCAL}/developers`, { redirect: "manual" });
    expect(front.status).toBe(302);
    expect(new URL(front.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("shows a Fine and a Not fine example under every content rule", async () => {
    const page = await (await SELF.fetch(`${LOCAL}/legal/content-rules`)).text();
    for (const rule of Object.keys(CONTENT_RULES)) {
      // Each rule is a fold row anchored by its name: its test in the head, Fine and Not fine under it.
      const item = page.match(new RegExp(`<details class="fold-row" id="${rule}">([\\s\\S]*?)</details>`))?.[1] ?? "";
      expect(item, rule).toContain(CONTENT_RULE_DETAILS[rule as keyof typeof CONTENT_RULE_DETAILS].test.replace(/"/g, "&quot;").slice(0, 30));
      expect(item, rule).toContain("<dt>Fine</dt>");
      expect(item, rule).toContain("<dt>Not fine</dt>");
    }
    expect(page).not.toContain("review doesn");
  });
});
