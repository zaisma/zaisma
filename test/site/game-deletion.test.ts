import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, gameBySlug, ownerGameDeletions, personOwner, sha256Hex, type ImageMatcher } from "@zaisma/core";
import { publishDue } from "../../apps/site/src/cleanup.ts";
import { callerFor } from "../../apps/site/src/developer.ts";
import { answerGameDeletionRequest } from "../../apps/site/src/game-deletion-requests.ts";
import { deleteDueGames } from "../../apps/site/src/game-deletion.ts";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { letPublish } from "../helpers.ts";
import { judgeSays, readsNothing, seesNothing } from "./scan-stubs.ts";

const SITE = "https://zaisma.test";
const DAY_MS = 86_400_000;
const enc = (text: string) => new TextEncoder().encode(text);
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const connected: ImageMatcher = { check: async (media) => ({ provider: "test", isConnected: true, checkedMediaCount: media.length, findings: [] }) };
const pass: ScanDeps = { images: connected, readCode: readsNothing, readPictures: seesNothing, judge: judgeSays("pass") };

let token = "";
let ownerId = "";

async function api(path: string, init: { method?: string; body?: unknown; raw?: Uint8Array } = {}) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}` },
    body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
  return { status: response.status, answer: (await response.json()) as any };
}

async function push(files: Record<string, string>) {
  const list = await Promise.all(Object.entries(files).map(async ([path, text]) => ({ path, sha256: await sha256Hex(enc(text)), size_bytes: enc(text).byteLength })));
  const plan = await api("/games/hop/uploads", { body: { files: list } });
  for (const file of list.filter((each) => plan.answer.missing_file_hashes.includes(each.sha256))) {
    expect((await api(`/files/${file.sha256}`, { method: "PUT", raw: enc(files[file.path]!) })).status).toBe(200);
  }
  const made = await api("/games/hop/versions", { body: { files: list } });
  expect(made.status).toBe(201);
  return made.answer.version.id as string;
}

const storage = async () => (await api("/storage")).answer.storage;

describe("deleting a game", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM game_deletions; DELETE FROM game_deletion_requests; DELETE FROM retired_game_slugs; DELETE FROM games_ever_played; DELETE FROM blobs; DELETE FROM blob_owners; DELETE FROM owned_blobs; DELETE FROM versions; DELETE FROM games; DELETE FROM api_keys; DELETE FROM owners; DELETE FROM accounts;");
    await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
    await letPublish(env.DB, "dev-1");
    token = (await createApiKey(env.DB, "dev-1", "laptop")).token;
    ownerId = (await personOwner(env.DB, "dev-1")).id;
    expect((await api("/games", { body: { title: "Hop", slug: "hop" } })).status).toBe(201);
  });

  const hop = async () => (await gameBySlug(env.DB, "hop"))!;
  const someoneElsePlayed = async () => env.DB.prepare("INSERT INTO games_ever_played (account_id, game_id, first_played_at_ms) VALUES ('another-player', ?, 1)").bind((await hop()).id).run();
  const tappedCaller = async () => ({ ...(await callerFor(env, new Request(SITE), "dev-1"))!, isPasskeyConfirmed: true });
  const deleteHop = () => api("/games/hop", { method: "DELETE", body: { confirm_slug: "hop" } });

  it("waits a week for a game nobody else played, still the developer's, with its link held and its files counted", async () => {
    const version = await push({ "index.html": "<p>waiting</p>" });
    await scanVersion(testEnv, version, pass);
    const storedSizeBytes = (await storage()).stored_size_bytes;
    expect((await api("/games/hop", { method: "DELETE", body: { confirm_slug: "nope" } })).answer.error.code).toBe("bad_confirm_slug");
    const before = Date.now();
    const deleted = await deleteHop();
    expect(deleted.status).toBe(200);
    expect(deleted.answer).toMatchObject({ is_deleted: true, storage: { stored_size_bytes: storedSizeBytes }, next_steps: [{ tool: "bring_back_game" }] });
    expect(Date.parse(deleted.answer.erases_at)).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 1000);
    expect(await hop()).toMatchObject({ review_status: "removed" });
    expect((await hop()).owner_id).toBe(ownerId);
    expect(await env.DB.prepare("SELECT slug FROM retired_game_slugs WHERE slug = 'hop'").first()).toBeNull();
    const { game } = (await api("/games/hop")).answer;
    expect(game).toMatchObject({ erases_at: deleted.answer.erases_at, is_erase_now_allowed: true });
    expect((await api("/games")).answer.games.map((listed: { slug: string }) => listed.slug)).toEqual(["hop"]);
    // Asking again answers the same date.
    expect((await deleteHop()).answer.erases_at).toBe(deleted.answer.erases_at);
    // Not erased before its date.
    await deleteDueGames(env);
    expect(await gameBySlug(env.DB, "hop")).not.toBeNull();
  });

  it("keeps a game other people played running until its developer taps their passkey", async () => {
    await someoneElsePlayed();
    const before = await hop();
    const asked = await deleteHop();
    expect(asked.status).toBe(403);
    expect(asked.answer.error.code).toBe("confirmation_needed");
    const requestId = asked.answer.error.game_deletion_request_id as string;
    expect(asked.answer.error.confirm_url).toContain(`game_deletion_request=${requestId}`);
    expect(await hop()).toMatchObject({ review_status: before.review_status, owner_id: ownerId });
    expect(await env.DB.prepare("SELECT 1 FROM game_deletions WHERE game_id = ?").bind(before.id).first()).toBeNull();
    expect((await api(`/games/hop/deletion-requests/${requestId}`)).answer.game_deletion_request).toMatchObject({ request_kind: "delete_game", game_slug: "hop", request_status: "waiting", is_asked_from_dashboard: false });
    expect((await api("/games/hop/deletion-requests/game_deletion_request_nothing")).answer.error.code).toBe("no_game_deletion_request");

    const caller = (await callerFor(env, new Request(SITE), "dev-1"))!;
    await expect(answerGameDeletionRequest(env, caller, requestId, "approved")).rejects.toMatchObject({ code: "confirmation_needed" });
    expect((await answerGameDeletionRequest(env, { ...caller, accountId: "someone-else", isPasskeyConfirmed: true }, requestId, "approved")).outcome).toBe("not_waiting");
    expect(await hop()).toMatchObject({ review_status: before.review_status });

    expect(await answerGameDeletionRequest(env, await tappedCaller(), requestId, "approved")).toEqual({ outcome: "answered", gameSlug: "hop" });
    expect(await hop()).toMatchObject({ review_status: "removed", owner_id: ownerId });
    expect((await api("/games/hop")).answer.game).toMatchObject({ is_erase_now_allowed: false });
    expect((await api(`/games/hop/deletion-requests/${requestId}`)).answer.game_deletion_request.request_status).toBe("approved");
    // An approved request can't be answered twice.
    expect((await answerGameDeletionRequest(env, await tappedCaller(), requestId, "approved")).outcome).toBe("not_waiting");
  });

  it("changes nothing when its developer declines, or the request's day passes", async () => {
    await someoneElsePlayed();
    const declined = (await deleteHop()).answer.error.game_deletion_request_id as string;
    expect((await answerGameDeletionRequest(env, (await callerFor(env, new Request(SITE), "dev-1"))!, declined, "declined")).outcome).toBe("answered");
    expect(await env.DB.prepare("SELECT 1 FROM game_deletions WHERE game_id = ?").bind((await hop()).id).first()).toBeNull();
    const expired = (await deleteHop()).answer.error.game_deletion_request_id as string;
    await env.DB.prepare("UPDATE game_deletion_requests SET expires_at_ms = 1 WHERE id = ?").bind(expired).run();
    expect((await answerGameDeletionRequest(env, await tappedCaller(), expired, "approved")).outcome).toBe("not_waiting");
    expect(await env.DB.prepare("SELECT 1 FROM game_deletions WHERE game_id = ?").bind((await hop()).id).first()).toBeNull();
  });

  it("brings a game back as it was before, a hold included, and not past its week or a takedown since", async () => {
    expect((await api("/games/hop/bring-back", { method: "POST" })).answer.error.code).toBe("not_waiting_to_erase");
    const held = JSON.stringify({ code: "reported", message: "Being looked at." });
    await env.DB.prepare("UPDATE games SET review_status = 'held', review_reason = ? WHERE slug = 'hop'").bind(held).run();
    await deleteHop();
    const back = await api("/games/hop/bring-back", { method: "POST" });
    expect(back.answer).toMatchObject({ is_brought_back: true });
    expect(await hop()).toMatchObject({ review_status: "held", review_reason: held, owner_id: ownerId });
    expect(await env.DB.prepare("SELECT 1 FROM game_deletions WHERE game_id = ?").bind((await hop()).id).first()).toBeNull();

    await deleteHop();
    await env.DB.prepare("UPDATE games SET review_reason = ? WHERE slug = 'hop'").bind(JSON.stringify({ code: "taken_down", message: "Broke a rule." })).run();
    expect((await api("/games/hop/bring-back", { method: "POST" })).answer.error.code).toBe("game_removed");
    await env.DB.prepare("UPDATE game_deletions SET erases_at_ms = 1").run();
    expect((await api("/games/hop/bring-back", { method: "POST" })).answer.error.code).toBe("already_erasing");
  });

  it("erases a game on its date: its link is retired, it leaves its developer's games and its files stop counting", async () => {
    const version = await push({ "index.html": "<p>gone</p>" });
    await scanVersion(testEnv, version, pass);
    await deleteHop();
    await env.DB.prepare("UPDATE game_deletions SET next_attempt_at_ms = 0, erases_at_ms = 0").run();
    await deleteDueGames(env);
    expect(await gameBySlug(env.DB, "hop")).toBeNull();
    expect(await env.DB.prepare("SELECT slug FROM retired_game_slugs WHERE slug = 'hop'").first()).toEqual({ slug: "hop" });
    expect((await api("/games")).answer.games).toEqual([]);
    expect((await storage()).stored_size_bytes).toBe(0);
  });

  it("erases at once only with the tap, and only a game nobody else played", async () => {
    expect((await api("/games/hop/erase-now", { body: { confirm_slug: "hop" } })).answer.error.code).toBe("not_waiting_to_erase");
    await deleteHop();
    expect((await api("/games/hop/erase-now", { body: { confirm_slug: "nope" } })).answer.error.code).toBe("bad_confirm_slug");
    const asked = await api("/games/hop/erase-now", { body: { confirm_slug: "hop" } });
    expect(asked.answer.error.code).toBe("confirmation_needed");
    expect(await env.DB.prepare("SELECT erases_at_ms > ? AS is_later FROM game_deletions").bind(Date.now()).first("is_later")).toBe(1);
    await someoneElsePlayed();
    expect((await answerGameDeletionRequest(env, await tappedCaller(), asked.answer.error.game_deletion_request_id, "approved").catch((error) => error)).code).toBe("played_by_others");
    await env.DB.prepare("DELETE FROM games_ever_played").run();
    expect((await answerGameDeletionRequest(env, await tappedCaller(), asked.answer.error.game_deletion_request_id, "approved")).outcome).toBe("answered");
    await deleteDueGames(env);
    expect(await gameBySlug(env.DB, "hop")).toBeNull();
  });

  it("erases at once when the developer's account goes during the week", async () => {
    await deleteHop();
    await env.DB.prepare("UPDATE game_deletions SET next_attempt_at_ms = ?").bind(Date.now() + DAY_MS).run();
    await env.DB.batch(ownerGameDeletions(env.DB, ownerId));
    expect(await env.DB.prepare("SELECT erases_at_ms, next_attempt_at_ms <= ? AS is_due FROM game_deletions").bind(Date.now()).first()).toEqual({ erases_at_ms: null, is_due: 1 });
  });

  it("doesn't publish a waiting game at its scheduled time", async () => {
    const version = await push({ "index.html": "<p>later</p>" });
    await scanVersion(testEnv, version, pass);
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = 1 WHERE id = ?").bind(version).run();
    await deleteHop();
    expect(await publishDue(testEnv)).toBe(0);
    expect((await hop()).live_version_id).toBeNull();
  });
});
