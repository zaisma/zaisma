import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createApiKey, createVersion, gameBySlug, versionById, type PerformanceObservations } from "@zaisma/core";
import { checkVersion, handlePerformanceBatch, queuePerformanceCheck, type ChromeRun, type PerformanceJob } from "../../apps/site/src/performance-check.ts";
import { passVersion } from "../../apps/site/src/scan.ts";
import { VERSION } from "../../apps/site/src/schemas.ts";
import { schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

/**
 * Every version is started in Chrome (apps/site/src/performance-check.ts): a version that passes is queued once,
 * within the developer's 20 runs a day; a run saves its report; three failed runs are could_not_run; and the API
 * answers it as performance_check. Chrome itself is a stand-in that says what it saw.
 */

const SITE = "https://zaisma.test";
let token = "";

const api = async (path: string, init: { method?: string; body?: unknown; raw?: Uint8Array } = {}) =>
  SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
  });

const sha256Of = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** A WAV header saying a minute of CD audio, in a 10 MB file. */
function wav(): Uint8Array {
  const bytes = new Uint8Array(10 * 1024 * 1024);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint32(28, 176_400, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, bytes.length - 44, true);
  return bytes;
}

/** Uploads a version of the game through the API, and lets it pass as the scan would. */
async function passedVersion(slug: string, files: Record<string, Uint8Array> = { "index.html": new TextEncoder().encode("<!doctype html><canvas></canvas>") }): Promise<string> {
  const list = [];
  for (const [path, bytes] of Object.entries(files)) {
    const sha256 = await sha256Of(bytes);
    list.push({ path, sha256, size_bytes: bytes.length });
    expect((await api(`/files/${sha256}`, { method: "PUT", raw: bytes })).status).toBeLessThan(300);
  }
  const created = await api(`/games/${slug}/versions`, { body: { files: list } });
  expect(created.status).toBe(201);
  const { version } = (await created.json()) as { version: { id: string } };
  await env.DB.prepare("UPDATE versions SET scan_status = 'approved' WHERE id = ?").bind(version.id).run();
  await passVersion(env, (await versionById(env.DB, version.id))!, "Passed the scan");
  return version.id;
}

/** What a stand-in Chrome saw: a first frame after 3.2 s, its page, a script and a data file, and one missing file. */
const sawGame =
  (fields: Partial<PerformanceObservations> = {}): ChromeRun =>
  async (_env, pageUrl, gameBaseUrl) => {
    expect(pageUrl).toMatch(/^https:\/\/zaisma\.test\/p\/version_/);
    const openedAtMs = 5_000_000;
    return {
      browserVersion: "HeadlessChrome/128.0.6613.84",
      gameBaseUrl,
      openedAtMs,
      firstDrawAtMs: openedAtMs + 3200,
      isDrawnWithGpu: true,
      requests: [
        { url: gameBaseUrl, startedAtMs: openedAtMs, finishedAtMs: openedAtMs + 40, httpStatus: 200, downloadedSizeBytes: 900, fetchDestination: "document", fetchMode: "navigate", blockedReason: null },
        { url: `${gameBaseUrl}game.js`, startedAtMs: openedAtMs + 50, finishedAtMs: openedAtMs + 300, httpStatus: 200, downloadedSizeBytes: 40_000, fetchDestination: "script", fetchMode: "no-cors", blockedReason: null },
        { url: `${gameBaseUrl}levels/one.json`, startedAtMs: openedAtMs + 320, finishedAtMs: openedAtMs + 900, httpStatus: 200, downloadedSizeBytes: 2_000_000, fetchDestination: "empty", fetchMode: "cors", blockedReason: null },
        { url: `${gameBaseUrl}levels/two.json`, startedAtMs: openedAtMs + 330, finishedAtMs: openedAtMs + 400, httpStatus: 404, downloadedSizeBytes: 300, fetchDestination: "empty", fetchMode: "cors", blockedReason: null },
      ],
      errors: [],
      longTaskDurationsMs: [120],
      memorySizeBytes: 80_000_000,
      maximumRunDurationSec: 120,
      ...fields,
    };
  };

/** A batch of one job, as the queue hands it over, recording what happened to it. */
function batchOf(versionId: string, attemptCount: number) {
  const happened: string[] = [];
  const message = { id: "m", timestamp: new Date(), attempts: attemptCount, body: { versionId }, ack: () => happened.push("ack"), retry: (options?: { delaySeconds?: number }) => happened.push(`retry ${options?.delaySeconds}`) };
  return { batch: { queue: "zaisma-performance-in-tests", messages: [message], ackAll() {}, retryAll() {} } as unknown as MessageBatch<PerformanceJob>, happened };
}

const rowOf = (versionId: string) => env.DB.prepare("SELECT * FROM performance_checks WHERE version_id = ?").bind(versionId).first<{ check_status: string; report: string | null; start_files: string | null }>();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM performance_checks; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "laptop")).token;
  expect((await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } })).status).toBe(201);
});
afterEach(() => vi.restoreAllMocks());

describe("every version is started in Chrome", () => {
  it("queues a version once when it passes, and answers it as waiting", async () => {
    const sent = vi.spyOn(env.PERFORMANCE_QUEUE, "send");
    const versionId = await passedVersion("sky-hopper");
    expect(sent.mock.calls).toEqual([[{ versionId }]]);
    // Passing it again (a person, after a report) adds nothing.
    await passVersion(env, (await versionById(env.DB, versionId))!, "Approved by a person");
    expect(sent).toHaveBeenCalledTimes(1);
    const { version } = (await (await api(`/games/sky-hopper/versions/${versionId}`)).json()) as { version: Record<string, unknown> };
    expect(schemaProblems(VERSION, version)).toEqual([]);
    expect(version.performance_check).toEqual({
      check_status: "waiting",
      checked_at: null,
      browser_description: "Chrome on a computer with no graphics card",
      loading_duration_sec: null,
      start_download_size_bytes: null,
      start_file_count: null,
      start_memory_size_bytes: null,
      longest_start_task_duration_ms: null,
      notes: [],
    });
  });

  it("marks a developer's 21st version of the day over the limit, and never queues it", async () => {
    const nowMs = Date.now();
    const ownerId = (await gameBySlug(env.DB, "sky-hopper"))!.owner_id;
    const insert = (versionId: string, queuedAtMs: number) => env.DB.prepare("INSERT INTO performance_checks (version_id, owner_id, check_status, queued_at_ms) VALUES (?, ?, 'checked', ?)").bind(versionId, ownerId, queuedAtMs).run();
    for (let i = 0; i < 20; i++) await insert(`version_earlier${i}`, nowMs - 1000);
    // One from yesterday doesn't count.
    await insert("version_yesterday", nowMs - 86_400_000 * 2);
    const sent = vi.spyOn(env.PERFORMANCE_QUEUE, "send");
    const versionId = await passedVersion("sky-hopper");
    expect(sent).not.toHaveBeenCalled();
    expect((await rowOf(versionId))?.check_status).toBe("over_daily_limit");
  });

  it("measures up to 60 versions a day for a developer with Zaisma Pro", async () => {
    const nowMs = Date.now();
    const ownerId = (await gameBySlug(env.DB, "sky-hopper"))!.owner_id;
    await env.DB.prepare("UPDATE owners SET pro_until_ms = ? WHERE id = ?").bind(nowMs + 86_400_000, ownerId).run();
    const insert = (versionId: string) => env.DB.prepare("INSERT INTO performance_checks (version_id, owner_id, check_status, queued_at_ms) VALUES (?, ?, 'checked', ?)").bind(versionId, ownerId, nowMs - 1000).run();
    for (let i = 0; i < 20; i++) await insert(`version_earlier${i}`);
    const sent = vi.spyOn(env.PERFORMANCE_QUEUE, "send");
    const versionId = await passedVersion("sky-hopper");
    expect(sent).toHaveBeenCalledTimes(1);
    expect((await rowOf(versionId))?.check_status).toBe("waiting");
    for (let i = 21; i < 60; i++) await insert(`version_earlier${i}`);
    const lastVersionId = await passedVersion("sky-hopper", { "index.html": new TextEncoder().encode("<!doctype html><canvas></canvas><!-- another -->") });
    expect((await rowOf(lastVersionId))?.check_status).toBe("over_daily_limit");
  });

  it("saves a run's report, and answers it through get_version and get_game", async () => {
    const versionId = await passedVersion("sky-hopper", { "index.html": new TextEncoder().encode("<!doctype html><script src=game.js></script>"), "music/theme.wav": wav() });
    await checkVersion(env, versionId, sawGame());
    const row = await rowOf(versionId);
    expect(row?.check_status).toBe("checked");
    expect(JSON.parse(row!.start_files!)).toEqual([
      { path: "game.js", destination: "script", is_cors_request: false, downloaded_size_bytes: 40_000 },
      { path: "levels/one.json", destination: "fetch", is_cors_request: true, downloaded_size_bytes: 2_000_000 },
    ]);
    const { version } = (await (await api(`/games/sky-hopper/versions/${versionId}`)).json()) as { version: { performance_check: Record<string, unknown> } };
    expect(schemaProblems(VERSION, version)).toEqual([]);
    expect(version.performance_check).toMatchObject({
      check_status: "checked",
      browser_description: "Chrome 128 on a computer with no graphics card",
      loading_duration_sec: 3.2,
      start_download_size_bytes: 900 + 40_000 + 2_000_000 + 300,
      start_file_count: 4,
      start_memory_size_bytes: 80_000_000,
      longest_start_task_duration_ms: 120,
    });
    expect((version.performance_check.notes as { code: string }[]).map((note) => note.code)).toEqual(["missing_file_at_start", "audio_could_be_opus"]);
    // Its start files stay inside.
    expect(JSON.stringify(version)).not.toContain("start_files");
    const { versions } = (await (await api("/games/sky-hopper")).json()) as { versions: { id: string; performance_check: { check_status: string } }[] };
    expect(versions.find((listed) => listed.id === versionId)?.performance_check.check_status).toBe("checked");
  });

  it("tries a failed run again later, and after three says it couldn't run", async () => {
    const versionId = await passedVersion("sky-hopper");
    const broken: ChromeRun = async () => {
      throw new Error("Browser Rendering: too many browsers");
    };
    const first = batchOf(versionId, 1);
    await handlePerformanceBatch(first.batch, env, broken);
    expect(first.happened).toEqual(["retry 60"]);
    expect((await rowOf(versionId))?.check_status).toBe("waiting");
    const third = batchOf(versionId, 3);
    await handlePerformanceBatch(third.batch, env, broken);
    expect(third.happened).toEqual(["ack"]);
    expect((await rowOf(versionId))?.check_status).toBe("could_not_run");
    // And then it isn't run again.
    const again = batchOf(versionId, 1);
    let isRun = false;
    await handlePerformanceBatch(again.batch, env, async (...input) => ((isRun = true), sawGame()(...input)));
    expect(isRun).toBe(false);
  });

  it("leaves zip versions out, and answers null for them", async () => {
    const game = (await gameBySlug(env.DB, "sky-hopper"))!;
    await createVersion(env.DB, { id: "version_zipped1", gameId: game.id, r2Prefix: `games/${game.id}/version_zipped1`, fileCount: 1, sizeBytes: 10, kind: "zip", patchNotes: "", publishWhenApprovedEnabled: false });
    await queuePerformanceCheck(env, (await versionById(env.DB, "version_zipped1"))!);
    expect(await rowOf("version_zipped1")).toBeNull();
    const { version } = (await (await api("/games/sky-hopper/versions/version_zipped1")).json()) as { version: { performance_check: unknown } };
    expect(version.performance_check).toBeNull();
  });
});
