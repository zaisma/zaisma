import { createExecutionContext, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_REVIEW_LIMITS, blobKey, createAccount, createApiKey, createGame, createVersion, gameById, manifestKey, newId, personOwner, sha256Hex, testerLinkVersion, addTesterLink, usualDurationMin, versionById, type Finding, type Manifest } from "@zaisma/core";
import { moveAiReviewOn, moveWaitingAiReviews, publishWithReview, requestAiReview, scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { publishDue } from "../../apps/site/src/cleanup.ts";
import { previewLinkToken } from "../../apps/site/src/preview-links.ts";
import type { BatchRequest, BatchResult, ReviewBatchClient } from "../../apps/site/src/review-batches.ts";
import { readerPromptSha256 } from "../../apps/site/src/review-readers.ts";
import { VERSION } from "../../apps/site/src/schemas.ts";
import worker from "../../apps/site/src/index.ts";
import { schemaProblems } from "../schema-check.ts";
import { connectedImages, judgeSays, readsNothing, seesNothing } from "./scan-stubs.ts";
import { CLEAN_GAME, letPublish } from "../helpers.ts";

const SITE = "https://zaisma.test";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key", REVIEW_READER_MODEL: "claude-haiku-5-5", REVIEW_JUDGE_MODEL: "claude-sonnet-5-5", AI_REVIEW_MONTHLY_BUDGET_CENTS: "2000" };
const reject: Finding = { stage: "ai", severity: "reject", code: "ai_other", message: "It fakes plays." };

let clockMs = Date.now() - 3_600_000;
let judgeCallCount = 0;
let readerCallCount = 0;
const deps = (verdict: "pass" | "reject" = "pass", extra: Partial<ScanDeps> = {}): ScanDeps => ({
  images: connectedImages,
  readCode: async (...input) => (readerCallCount++, readsNothing(...input)),
  readPictures: seesNothing,
  judge: async (...input) => (judgeCallCount++, judgeSays(verdict, verdict === "reject" ? [reject] : [])(...input)),
  ...extra,
});

/** A stand-in for Anthropic's batches: every request is answered with `answer` once a test ends the batch. */
function batches(answer: (request: BatchRequest) => BatchResult["message"]) {
  const made: { id: string; requests: BatchRequest[]; isEnded: boolean; isCanceled: boolean }[] = [];
  const client: ReviewBatchClient = {
    create: async (_key, requests) => (made.push({ id: `batch_${made.length}`, requests, isEnded: false, isCanceled: false }), made.at(-1)!.id),
    isEnded: async (_key, id) => made.find((batch) => batch.id === id)!.isEnded,
    results: async function* (_key, id) {
      for (const request of made.find((batch) => batch.id === id)!.requests) yield { custom_id: request.custom_id, model: request.params.model, message: answer(request) };
    },
    cancel: async (_key, id) => void (made.find((batch) => batch.id === id)!.isCanceled = true),
  };
  return { client, made, endAll: () => made.forEach((batch) => (batch.isEnded = true)) };
}
const usage = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as BatchResult["message"] extends infer M ? (M extends { usage: infer U } ? U : never) : never;
const toMessage = (body: unknown) => ({ content: [{ type: "text", text: JSON.stringify(body), citations: null }], stop_reason: "end_turn", usage }) as NonNullable<BatchResult["message"]>;
const passingAnswer = (request: BatchRequest) => (String(request.params.model).includes("sonnet") ? toMessage({ verdict: "pass", summary: "A game.", has_sexual_content_involving_minors: false, followed_ruling_numbers: [], findings: [] }) : toMessage({ items: [] }));

async function uploaded(gameId: string, files: Record<string, string>, publish = true): Promise<string> {
  const versionId = newId("version");
  const manifest: Manifest = { files: {} };
  for (const [path, text] of Object.entries(files)) {
    const sha256 = await sha256Hex(new TextEncoder().encode(text));
    await env.GAMES.put(blobKey(sha256), text);
    manifest.files[path] = { sha256 };
  }
  await env.GAMES.put(manifestKey(versionId), JSON.stringify(manifest));
  await createVersion(env.DB, { id: versionId, gameId, r2Prefix: `manifests/${versionId}`, fileCount: Object.keys(files).length, sizeBytes: 0, kind: "files", publishWhenApprovedEnabled: publish });
  await env.DB.prepare("UPDATE versions SET created_at_ms = ? WHERE id = ?").bind((clockMs += 1000), versionId).run();
  return versionId;
}

const OWNER = "owner_review";
const earn = () => env.DB.prepare("UPDATE owners SET is_established = 1, is_zaisma_account = 1 WHERE id = ?").bind(OWNER).run();
const makeGame = (slug: string, visibility: "draft" | "private" | "listed" | "unlisted" = "listed") => createGame(env.DB, { slug, title: "Sky Hopper", description: "", ownerId: OWNER, visibility });
const row = async (versionId: string) => (await versionById(env.DB, versionId))!;
const liveOf = async (gameId: string) => (await gameById(env.DB, gameId))!.live_version_id;

beforeEach(async () => {
  judgeCallCount = 0;
  readerCallCount = 0;
  for (const statement of ["DELETE FROM read_files", "DELETE FROM review_batches", "DELETE FROM tester_links", "DELETE FROM api_keys", "DELETE FROM audit_log", "DELETE FROM performance_checks", "DELETE FROM versions", "UPDATE games SET live_version_id = NULL, owner_id = NULL", "DELETE FROM games", "DELETE FROM owner_cards", "DELETE FROM owners WHERE id = 'owner_review'", "DELETE FROM ai_usage"]) await env.DB.prepare(statement).run();
  await env.DB.prepare("INSERT INTO owners (id, kind, created_at_ms) VALUES (?, 'person', 1)").bind(OWNER).run();
});

describe("after the fixed checks", () => {
  it("never reviews a version only its developer can reach, and it never waits", async () => {
    const game = await makeGame("only-me", "private");
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    expect(await liveOf(game.id)).toBe(version);
    expect((await row(version)).ai_review_status).toBe("not_started");
    expect(judgeCallCount + readerCallCount).toBe(0);
  });

  it("leaves a draft ready with no review", async () => {
    const game = await makeGame("a-draft");
    const version = await uploaded(game.id, CLEAN_GAME, false);
    await scanVersion(testEnv, version, deps());
    expect(await row(version)).toMatchObject({ scan_status: "approved", ai_review_status: "not_started", published_at_ms: null });
    expect(previewLinkToken(await row(version))).not.toBeNull();
  });

  it("publishes an established developer's version straight away, with the review behind it", async () => {
    await earn();
    const game = await makeGame("goes-first");
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    expect(await liveOf(game.id)).toBe(version);
    expect(await row(version)).toMatchObject({ ai_review_status: "waiting", ai_review_speed: "batch", is_open_before_ai_review: 1 });
  });

  it("lets a developer who could go first go live only once it passes", async () => {
    await earn();
    const game = await makeGame("waits-by-choice");
    const version = await uploaded(game.id, CLEAN_GAME);
    await env.DB.prepare("UPDATE versions SET publish_after_ai_review_enabled = 1 WHERE id = ?").bind(version).run();
    await scanVersion(testEnv, version, deps());
    expect(await liveOf(game.id)).toBeNull();
    expect((await row(version)).is_open_before_ai_review).toBe(0);
  });

  it("reviews a developer's first game at once and goes live when it passes", async () => {
    const game = await makeGame("first-game");
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    expect(await liveOf(game.id)).toBeNull();
    expect(await row(version)).toMatchObject({ ai_review_status: "waiting", ai_review_speed: "at_once" });
    await moveAiReviewOn(testEnv, version, deps());
    expect(await liveOf(game.id)).toBe(version);
    expect((await row(version)).ai_review_status).toBe("passed");
    expect(judgeCallCount).toBe(1);
    expect((await env.DB.prepare("SELECT 1 FROM audit_log WHERE game_id = ? AND action = 'published'").bind(game.id).first())).not.toBeNull();
  });

  it("reviews a game with many players at once", async () => {
    await earn();
    const game = await makeGame("big-game");
    await env.DB.prepare("INSERT INTO play_days (game_id, date, started_play_count, play_count, player_count, new_player_count, play_duration_sec) VALUES (?, ?, 0, ?, 0, 0, 0)").bind(game.id, new Date().toISOString().slice(0, 10), AI_REVIEW_LIMITS.minimumAtOnceWeeklyPlayCount).run();
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    expect((await row(version)).ai_review_speed).toBe("at_once");
  });

  it("treats the buyers of a hidden paid game as other people", async () => {
    const game = await makeGame("sold-hidden", "private");
    await env.DB.prepare("UPDATE games SET full_game_item_name = 'full_game' WHERE id = ?").bind(game.id).run();
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    expect(await liveOf(game.id)).toBeNull();
  });
});

describe("batches", () => {
  it("reads, then judges, then goes live, counting what it cost once and at half price", async () => {
    const game = await makeGame("batched");
    const earlier = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, earlier, deps());
    await moveAiReviewOn(testEnv, earlier, deps());
    await env.DB.prepare("DELETE FROM ai_usage").run();
    judgeCallCount = 0;

    const { client, made, endAll } = batches(passingAnswer);
    const update = await uploaded(game.id, { ...CLEAN_GAME, "game.js": "let speed = 2; addEventListener('keydown', jump);" });
    await scanVersion(testEnv, update, deps());
    expect(await row(update)).toMatchObject({ ai_review_speed: "batch", ai_review_status: "waiting" });
    expect(await liveOf(game.id)).toBe(earlier);

    const batched = deps("pass", { batches: client });
    await moveAiReviewOn(testEnv, update, batched);
    expect((await row(update)).ai_review_status).toBe("reviewing");
    expect(made.length).toBe(1);
    // A retried message changes nothing while a batch runs.
    await moveAiReviewOn(testEnv, update, batched);
    expect(made.length).toBe(1);

    endAll();
    expect(await moveWaitingAiReviews(testEnv, { batches: client })).toBeGreaterThan(0);
    await moveAiReviewOn(testEnv, update, batched);
    const finished = await row(update);
    if (finished.ai_review_status === "reviewing") {
      endAll();
      await moveWaitingAiReviews(testEnv, { batches: client });
      await moveAiReviewOn(testEnv, update, batched);
    }
    expect((await row(update)).ai_review_status).toBe("passed");
    expect(await liveOf(game.id)).toBe(update);
    expect(judgeCallCount).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS row_count FROM review_batches WHERE version_id = ?").bind(update).first<{ row_count: number }>()).toEqual({ row_count: 0 });
    const spent = await env.DB.prepare("SELECT review_cost_cents FROM ai_usage").first<{ review_cost_cents: number }>();
    const requestCount = made.reduce((count, batch) => count + batch.requests.length, 0);
    const haikuInputCentsPerMillion = 10;
    expect(spent!.review_cost_cents).toBeLessThanOrEqual((requestCount * 300) / 2);
    expect(spent!.review_cost_cents).toBeGreaterThanOrEqual(haikuInputCentsPerMillion / 2);
  });

  it("asks directly what a batch couldn't answer, once", async () => {
    await earn();
    const game = await makeGame("batch-fails");
    const { client, endAll } = batches((request) => (String(request.params.model).includes("sonnet") ? passingAnswer(request) : null));
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    const batched = deps("pass", { batches: client });
    await moveAiReviewOn(testEnv, version, batched);
    endAll();
    await moveWaitingAiReviews(testEnv, { batches: client });
    await moveAiReviewOn(testEnv, version, batched);
    const askedOnce = readerCallCount;
    expect(askedOnce).toBeGreaterThan(0);
    endAll();
    await moveWaitingAiReviews(testEnv, { batches: client });
    await moveAiReviewOn(testEnv, version, batched);
    expect(readerCallCount).toBe(askedOnce);
    expect((await row(version)).ai_review_status).toBe("passed");
  });

  it("drops an older version's review when a newer one's starts, and ignores what comes late", async () => {
    await earn();
    const game = await makeGame("only-newest");
    const { client, made } = batches(passingAnswer);
    const first = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, first, deps());
    await moveAiReviewOn(testEnv, first, deps("pass", { batches: client }));
    expect(made.length).toBe(1);
    const second = await uploaded(game.id, { ...CLEAN_GAME, "game.js": "let speed = 3;" });
    await env.DB.prepare("UPDATE versions SET publish_when_approved_enabled = 1 WHERE id = ?").bind(second).run();
    // A newer upload going live: the older one is no longer live, so its review stops.
    const withClient = await scanVersionUsing(second, client);
    expect(withClient).toBe("waiting");
    expect((await row(first)).ai_review_status).toBe("not_started");
    expect(made[0]!.isCanceled).toBe(true);
    await moveAiReviewOn(testEnv, first, deps("pass", { batches: client }));
    expect((await row(first)).ai_review_status).toBe("not_started");
  });
});

/** Scans a version, with its review asked for through this batch client. */
async function scanVersionUsing(versionId: string, client: ReviewBatchClient): Promise<string> {
  const spy = vi.fn();
  void spy;
  await scanVersion(testEnv, versionId, deps("pass", { batches: client }));
  // requestAiReview in the scan uses the real client's cancel only with a key and a running batch: ask again through the stand-in.
  const version = await row(versionId);
  const game = (await gameById(env.DB, version.game_id))!;
  await requestAiReview(testEnv, game, version, "system", client);
  return (await row(versionId)).ai_review_status;
}

describe("a stop", () => {
  it("rolls players back to the last version that passed, with the reason on the version", async () => {
    await earn();
    const game = await makeGame("rolls-back");
    const good = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, good, deps());
    await env.DB.prepare("UPDATE versions SET ai_review_speed = 'at_once' WHERE id = ?").bind(good).run();
    await moveAiReviewOn(testEnv, good, deps());
    const bad = await uploaded(game.id, { ...CLEAN_GAME, "game.js": "let cheat = 1;" });
    await scanVersion(testEnv, bad, deps());
    expect(await liveOf(game.id)).toBe(bad);
    await env.DB.prepare("UPDATE versions SET ai_review_speed = 'at_once' WHERE id = ?").bind(bad).run();
    await moveAiReviewOn(testEnv, bad, deps("reject"));
    expect(await liveOf(game.id)).toBe(good);
    expect(await row(bad)).toMatchObject({ scan_status: "rejected", ai_review_status: "stopped" });
    expect(await env.DB.prepare("SELECT 1 FROM audit_log WHERE game_id = ? AND action = 'ai-review-rolled-back'").bind(game.id).first()).not.toBeNull();
  });

  it("leaves the game with nothing live and says why when no earlier version passed", async () => {
    await earn();
    const game = await makeGame("taken-down");
    const bad = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, bad, deps());
    await env.DB.prepare("UPDATE versions SET ai_review_speed = 'at_once' WHERE id = ?").bind(bad).run();
    await moveAiReviewOn(testEnv, bad, deps("reject"));
    const after = (await gameById(env.DB, game.id))!;
    expect(after.live_version_id).toBeNull();
    expect(after.review_status).toBe("pending");
    expect(JSON.parse(after.review_reason!).code).toBe("ai_other");
    // A fix goes live the ordinary way, and clears the reason. The ruling closed going first, so its review comes first.
    const fix = await uploaded(game.id, { ...CLEAN_GAME, "game.js": "let fair = 1;" });
    await scanVersion(testEnv, fix, deps());
    expect((await gameById(env.DB, game.id))!.live_version_id).toBeNull();
    await moveAiReviewOn(testEnv, fix, deps());
    const fixed = (await gameById(env.DB, game.id))!;
    expect(fixed.live_version_id).toBe(fix);
    expect(fixed.review_reason).toBeNull();
  });
});

describe("past the budget", () => {
  it("goes on with the fixed checks alone, and nobody waits for a person", async () => {
    await env.DB.prepare("INSERT INTO ai_usage (month, review_cost_cents, review_call_count) VALUES (?, 2000, 1)").bind(new Date().toISOString().slice(0, 7)).run();
    const game = await makeGame("past-budget");
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    await moveAiReviewOn(testEnv, version, deps());
    expect(await row(version)).toMatchObject({ scan_status: "approved", ai_review_status: "skipped" });
    expect(await liveOf(game.id)).toBe(version);
    expect(judgeCallCount + readerCallCount).toBe(0);
    expect(JSON.parse((await row(version)).scan_report!).findings.map((finding: Finding) => [finding.code, finding.severity])).toContainEqual(["ai_review_budget_used", "info"]);
  });
});

describe("reading each file once", () => {
  const review = async (slug: string, files: Record<string, string>, verdict: "pass" | "reject" = "pass") => {
    const game = await makeGame(slug);
    const version = await uploaded(game.id, files);
    await scanVersion(testEnv, version, deps());
    await moveAiReviewOn(testEnv, version, deps(verdict));
    return version;
  };

  it("never reads a file a version that passed already had read, whoever sends it", async () => {
    await review("first-reader", CLEAN_GAME);
    const read = readerCallCount;
    expect(read).toBeGreaterThan(0);
    await review("second-reader", CLEAN_GAME);
    expect(readerCallCount).toBe(read);
  });

  it("shares nothing from a version that was stopped", async () => {
    await review("stopped-reader", CLEAN_GAME, "reject");
    expect(await env.DB.prepare("SELECT COUNT(*) AS row_count FROM read_files").first<{ row_count: number }>()).toEqual({ row_count: 0 });
  });

  it("reads again when the reader's prompt or model is new", async () => {
    await review("first-prompt", CLEAN_GAME);
    const prompt = await readerPromptSha256(testEnv.REVIEW_READER_MODEL);
    await env.DB.prepare("UPDATE read_files SET reader_prompt_sha256 = 'older' WHERE reader_prompt_sha256 = ?").bind(prompt).run();
    const read = readerCallCount;
    await review("second-prompt", CLEAN_GAME);
    expect(readerCallCount).toBeGreaterThan(read);
  });

  it("re-reads a file whose read found child safety: it's never shared", async () => {
    const childSafetyRead: ScanDeps["readCode"] = async (_key, _model, chunk) => ({ items: chunk.files.map((file) => ({ kind: "content" as const, subject: "child_safety", detail: "", path: file.path, quote: file.text.slice(0, 5) })), outcome: "read", costCents: 0, inputTokenCount: 0, outputTokenCount: 0 });
    const game = await makeGame("never-shared");
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    await moveAiReviewOn(testEnv, version, deps("pass", { readCode: childSafetyRead }));
    expect(await env.DB.prepare("SELECT COUNT(*) AS row_count FROM read_files").first<{ row_count: number }>()).toEqual({ row_count: 0 });
  });
});

describe("who reaches a version before its review", () => {
  it("keeps a tester link shut until the review lets the version through", async () => {
    const game = await makeGame("tester-gate", "private");
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    const link = await addTesterLink(env.DB, game.id, "Team", { versionChoice: "live", pickedVersionId: null, endsAtMs: null });
    const current = (await gameById(env.DB, game.id))!;
    expect(await testerLinkVersion(env.DB, current, link)).toBeNull();
    await requestAiReview(testEnv, current, await row(version));
    await env.DB.prepare("UPDATE versions SET ai_review_speed = 'at_once' WHERE id = ?").bind(version).run();
    await moveAiReviewOn(testEnv, version, deps());
    expect((await testerLinkVersion(env.DB, current, link))?.id).toBe(version);
  });

  it("opens a tester link at once for a developer who has earned it", async () => {
    await earn();
    const game = await makeGame("tester-earned", "private");
    const version = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, version, deps());
    const link = await addTesterLink(env.DB, game.id, "Team", { versionChoice: "live", pickedVersionId: null, endsAtMs: null });
    expect((await testerLinkVersion(env.DB, (await gameById(env.DB, game.id))!, link))?.id).toBe(version);
  });

  it("opens an unreviewed preview only for the game's signed-in developer", async () => {
    const game = await makeGame("preview-gate", "private");
    const version = await uploaded(game.id, CLEAN_GAME, false);
    await scanVersion(testEnv, version, deps());
    const { token } = previewLinkToken(await row(version))!;
    const signedOut = await SELF.fetch(`${SITE}/p/${token}`, { redirect: "manual" });
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("location")).toContain("/signin?next=");
    await env.DB.prepare("UPDATE versions SET ai_review_status = 'passed' WHERE id = ?").bind(version).run();
    const reviewed = await SELF.fetch(`${SITE}/p/${token}`, { redirect: "manual" });
    expect(reviewed.status).toBe(302);
    expect(reviewed.headers.get("location")).toContain("_zaisma/enter?grant=");
  });
});

describe("a scheduled release", () => {
  it("starts its review a day ahead, and goes live once it passes if it's late", async () => {
    const game = await makeGame("scheduled-release");
    const earlier = await uploaded(game.id, CLEAN_GAME);
    await scanVersion(testEnv, earlier, deps());
    await moveAiReviewOn(testEnv, earlier, deps());
    const version = await uploaded(game.id, { ...CLEAN_GAME, "game.js": "let launch = 1;" }, false);
    await scanVersion(testEnv, version, deps());
    const nowMs = Date.now();
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = ? WHERE id = ?").bind(nowMs + 48 * 3_600_000, version).run();
    await moveWaitingAiReviews(testEnv, {}, nowMs);
    expect((await row(version)).ai_review_status).toBe("not_started");
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = ? WHERE id = ?").bind(nowMs + 3_600_000, version).run();
    await moveWaitingAiReviews(testEnv, {}, nowMs);
    expect((await row(version)).ai_review_status).toBe("waiting");

    // Its time comes before the review ends: players stay where they are.
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = ? WHERE id = ?").bind(nowMs - 60_000, version).run();
    await publishDue(testEnv, nowMs);
    expect(await liveOf(game.id)).toBe(earlier);
    await env.DB.prepare("UPDATE versions SET ai_review_speed = 'at_once' WHERE id = ?").bind(version).run();
    await moveAiReviewOn(testEnv, version, deps());
    await publishDue(testEnv, nowMs);
    expect(await liveOf(game.id)).toBe(version);
  });
});

describe("the usual time", () => {
  it("is what most reviews took, measured, and a default until there are enough", () => {
    expect(usualDurationMin([], "batch")).toBe(AI_REVIEW_LIMITS.defaultBatchDurationMin);
    expect(usualDurationMin([], "at_once")).toBe(AI_REVIEW_LIMITS.defaultAtOnceDurationMin);
    const minutes = (...counts: number[]) => counts.map((count) => count * 60_000);
    expect(usualDurationMin(minutes(10, 20, 31, 40, 300), "batch")).toBe(40);
    expect(usualDurationMin(minutes(1, 1, 1, 1, 2), "at_once")).toBe(1);
  });
});

describe("the API and MCP", () => {
  const api = (path: string, token: string, method = "GET", body?: unknown, testing = testEnv) =>
    worker.fetch(new Request(`${SITE}/api/dev${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), testing, createExecutionContext());

  async function setUp(slug: string, visibility: "private" | "listed") {
    const accountId = `dev-${slug}`;
    await createAccount(env.DB, { id: accountId, username: `Dev_${slug.replace(/-/g, "_").slice(0, 12)}`, ageBand: "18+" });
    await letPublish(env.DB, accountId);
    const owner = (await personOwner(env.DB, accountId)).id;
    const { token } = await createApiKey(env.DB, accountId, "laptop");
    const game = await createGame(env.DB, { slug, title: "Sky Hopper", description: "", ownerId: owner, visibility });
    const version = await uploaded(game.id, CLEAN_GAME, false);
    await scanVersion(testEnv, version, deps());
    return { game, version, token };
  }

  it("says before publishing whether a review follows and how long it usually takes, and starts one on request", async () => {
    const { version, token, game } = await setUp("api-times", "listed");
    const before = (await (await api(`/games/${game.slug}/versions/${version}`, token)).json()) as { version: Record<string, unknown> };
    expect(schemaProblems(VERSION, before.version)).toEqual([]);
    expect(before.version).toMatchObject({ ai_review_status: "not_started", is_ai_review_needed_to_publish: true, usual_ai_review_duration_min: AI_REVIEW_LIMITS.defaultAtOnceDurationMin });
    const started = (await (await api(`/games/${game.slug}/versions/${version}/ai-review`, token, "POST")).json()) as { version: Record<string, unknown>; next_steps: { tool: string }[] };
    expect(started.version.ai_review_status).toBe("waiting");
    expect(started.next_steps[0]!.tool).toBe("get_version");
    const again = (await (await api(`/games/${game.slug}/versions/${version}/ai-review`, token, "POST")).json()) as { version: Record<string, unknown> };
    expect(again.version.ai_review_requested_at).toBe(started.version.ai_review_requested_at);
  });

  it("keeps a hidden game hidden until the review passes when it's set listed", async () => {
    const { version, token, game } = await setUp("api-visibility", "private");
    await env.DB.prepare("INSERT INTO game_images (id, game_id, kind, r2_key, review_status, size_bytes, content_type, created_at_ms) VALUES (?, ?, 'screenshot', 'none', 'approved', 1, 'image/png', 1)").bind(newId("image"), game.id).run().catch(() => {});
    await publishWithReview(testEnv, game, await row(version), "Published");
    const answered = (await (await api(`/games/${game.slug}`, token, "PATCH", { visibility: "unlisted" })).json()) as { game: { visibility: string; visibility_after_ai_review: string } };
    expect(answered.game).toMatchObject({ visibility: "private", visibility_after_ai_review: "unlisted" });
    await env.DB.prepare("UPDATE versions SET ai_review_speed = 'at_once' WHERE id = ?").bind(version).run();
    await moveAiReviewOn(testEnv, version, deps());
    expect(await gameById(env.DB, game.id)).toMatchObject({ visibility: "unlisted", visibility_after_ai_review: null });
  });

  it("refuses publish_after_ai_review_enabled that isn't true or false", async () => {
    const { version, token, game } = await setUp("api-refuses", "private");
    const refused = await api(`/games/${game.slug}/versions/${version}/publish`, token, "POST", { publish_after_ai_review_enabled: "yes" });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("bad_publish_after_ai_review_enabled");
  });
});
