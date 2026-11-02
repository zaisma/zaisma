import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { addCreditEntry, blobKey, createAccount, createApiKey, gameBySlug, notConnected, ownedBlobKey, personOwner, sha256Hex, storageOf, utcDateOf, versionById, type ImageMatcher } from "@zaisma/core";
import { dailyCleanup } from "../../apps/site/src/cleanup.ts";
import { chargeStorage } from "../../apps/site/src/hosting-job.ts";
import { MAXIMUM_PACK_PICTURE_COUNT, ScanContinues, matchMedia, scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { judgeUnpaidStorage } from "../../apps/site/src/unpaid-storage.ts";
import { letPublish } from "../helpers.ts";
import { judgeSays, readsNothing, seesNothing } from "./scan-stubs.ts";

const SITE = "https://zaisma.test";
const GB = 1024 ** 3;
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

const listed = async (files: Record<string, string>) => Promise.all(Object.entries(files).map(async ([path, text]) => ({ path, sha256: await sha256Hex(enc(text)), size_bytes: enc(text).byteLength })));

async function push(files: Record<string, string>) {
  const list = await listed(files);
  const plan = await api("/games/hop/uploads", { body: { files: list } });
  expect(plan.status).toBe(200);
  for (const file of list.filter((each) => plan.answer.missing_file_hashes.includes(each.sha256))) {
    expect((await api(`/files/${file.sha256}`, { method: "PUT", raw: enc(files[file.path]!) })).status).toBe(200);
  }
  const made = await api("/games/hop/versions", { body: { files: list } });
  expect(made.status).toBe(201);
  return made.answer.version.id as string;
}

const storage = async () => (await api("/storage")).answer.storage;
const setStored = (sizeBytes: number) => env.DB.prepare("UPDATE owners SET stored_size_bytes = ? WHERE id = ?").bind(sizeBytes, ownerId).run();
const addCredit = (cents: number) => addCreditEntry(env.DB, { ownerId, entryKind: "top_up", amountCents: cents, stripeObjectId: `pi_${cents}` });

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM blobs; DELETE FROM blob_owners; DELETE FROM owned_blobs; DELETE FROM game_deletions; DELETE FROM retired_game_slugs; DELETE FROM owner_cards; DELETE FROM owner_new_data_days; DELETE FROM owner_storage_months; DELETE FROM credit_entries; DELETE FROM spending_requests; DELETE FROM api_keys; DELETE FROM tester_links; DELETE FROM versions; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  const all = await env.GAMES.list();
  if (all.objects.length) await env.GAMES.delete(all.objects.map((object) => object.key));
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "laptop")).token;
  ownerId = (await personOwner(env.DB, "dev-1")).id;
  expect((await api("/games", { body: { title: "Hop", slug: "hop" } })).status).toBe(201);
});

describe("what an account stores", () => {
  it("counts a file shared between versions once, and what's stored by standing, card and Pro", async () => {
    expect(await storage()).toMatchObject({ stored_size_bytes: 0, included_size_bytes: 10 * GB, maximum_stored_size_bytes: 10 * GB, allowance_kind: "new", maximum_new_data_size_bytes: 10 * GB, monthly_storage_budget_cents: null, price_per_gigabyte_month_cents: 12 });
    await push({ "index.html": "<p>one</p>" });
    const size = enc("<p>one</p>").byteLength;
    expect(await storage()).toMatchObject({ stored_size_bytes: size, new_data_today_size_bytes: size });
    await push({ "index.html": "<p>one</p>", "copy/same.html": "<p>one</p>" });
    expect((await storage()).stored_size_bytes).toBe(size);

    await env.DB.prepare("INSERT INTO owner_cards (owner_id, card_fingerprint_sha256, first_paid_at_ms) VALUES (?, 'card', 1)").bind(ownerId).run();
    expect(await storage()).toMatchObject({ allowance_kind: "paid_by_card", included_size_bytes: 50 * GB, maximum_new_data_size_bytes: 25 * GB });
    await env.DB.prepare("DELETE FROM owner_cards").run();
    await env.DB.prepare("UPDATE owners SET stripe_account_id = 'acct_1', can_take_stripe_payments = 1 WHERE id = ?").bind(ownerId).run();
    expect((await storage()).allowance_kind).toBe("new");
    await env.DB.prepare("UPDATE owners SET is_established = 1 WHERE id = ?").bind(ownerId).run();
    expect(await storage()).toMatchObject({ allowance_kind: "established", included_size_bytes: 50 * GB });
    await env.DB.prepare("UPDATE owners SET pro_until_ms = ? WHERE id = ?").bind(Date.now() + DAY_MS, ownerId).run();
    expect(await storage()).toMatchObject({ allowance_kind: "pro", included_size_bytes: 500 * GB, maximum_new_data_size_bytes: 100 * GB });
  });

  it("refuses at the list, naming what to delete, and lets a list that adds nothing through", async () => {
    const old = await push({ "index.html": "<p>old</p>" });
    await scanVersion(testEnv, old, pass);
    const live = await push({ "index.html": "<p>live</p>" });
    await scanVersion(testEnv, live, pass);
    await api(`/games/hop/versions/${live}/publish`, { body: {} });
    await setStored(10 * GB);

    const big = [{ path: "index.html", sha256: "a".repeat(64), size_bytes: 1 }, { path: "world.bin", sha256: "b".repeat(64), size_bytes: 400 * 1024 ** 2 }];
    const refused = await api("/games/hop/uploads", { body: { files: big } });
    expect(refused.status).toBe(413);
    expect(refused.answer.error).toMatchObject({ code: "storage_full", message: expect.stringContaining("10 GB") });
    expect(refused.answer.error.fix).toContain(`hop's ${old}`);
    expect(refused.answer.error.fix).not.toContain(live);
    expect(refused.answer.error.fix).toContain("delete_version");

    // What's already stored adds nothing, however full the account is, and the live game stays.
    expect((await api("/games/hop/uploads", { body: { files: await listed({ "index.html": "<p>live</p>" }) } })).status).toBe(200);
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBe(live);
  });

  it("refuses a file at its own door too, and a big file whose real size doesn't fit", async () => {
    await setStored(10 * GB);
    const text = enc("one more file");
    const sha = await sha256Hex(text);
    expect((await api(`/files/${sha}`, { method: "PUT", raw: text })).answer.error.code).toBe("storage_full");
    expect((await api(`/files/${sha}/parts`, { body: { size_bytes: 3000 } })).answer.error.code).toBe("storage_full");

    await setStored(10 * GB - 10);
    const big = enc("x".repeat(3000));
    const bigSha = await sha256Hex(big);
    const start = (await api(`/files/${bigSha}/parts`, { body: { size_bytes: 1 } })).answer;
    const part = (await api(`/files/${bigSha}/parts/1?upload_id=${encodeURIComponent(start.upload_id)}`, { method: "PUT", raw: big })).answer;
    const done = await api(`/files/${bigSha}/parts/done`, { body: { upload_id: start.upload_id, parts: [part] } });
    expect(done.answer.error.code).toBe("storage_full");
    expect(await env.GAMES.head(ownedBlobKey(ownerId, bigSha))).toBeNull();
    expect((await storage()).stored_size_bytes).toBe(10 * GB - 10);
  });

  it("stops new data at the day's limit, under parallel sends, until midnight UTC", async () => {
    const limit = 10 * GB;
    const sends = ["first", "second", "third"].map(enc);
    await env.DB.prepare("INSERT INTO owner_new_data_days (owner_id, date, new_data_size_bytes) VALUES (?, ?, ?)").bind(ownerId, utcDateOf(Date.now()), limit - sends[0]!.byteLength).run();
    const answers = await Promise.all(sends.map(async (bytes) => api(`/files/${await sha256Hex(bytes)}`, { method: "PUT", raw: bytes })));
    expect(answers.filter((each) => each.status === 200)).toHaveLength(1);
    const refused = answers.find((each) => each.status === 429)!;
    expect(refused.answer.error).toMatchObject({ code: "new_data_limit", retry_after_sec: expect.any(Number) });
    expect(refused.answer.error.retry_after_sec).toBeLessThanOrEqual(DAY_MS / 1000);
    expect((await storage()).new_data_today_size_bytes).toBeLessThanOrEqual(limit);
  });

  it("gives back the day's reservation when a file doesn't match its hash", async () => {
    const wrong = await api(`/files/${"c".repeat(64)}`, { method: "PUT", raw: enc("x") });
    expect(wrong.answer.error.code).toBe("hash_mismatch");
    expect((await storage()).new_data_today_size_bytes).toBe(0);
  });
});

describe("deleting", () => {
  it("frees only the files no other version has, at once, and a released file counts again when sent again", async () => {
    const first = await push({ "index.html": "<p>keep</p>", "only.json": "[1]" });
    await scanVersion(testEnv, first, pass);
    const second = await push({ "index.html": "<p>keep</p>" });
    await scanVersion(testEnv, second, pass);
    const size = enc("<p>keep</p>").byteLength;
    expect((await storage()).stored_size_bytes).toBe(size + enc("[1]").byteLength);

    const deleted = await api(`/games/hop/versions/${first}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(deleted.answer).toMatchObject({ is_deleted: true, storage: { stored_size_bytes: size } });
    expect(await versionById(env.DB, first)).toBeNull();
    const only = await sha256Hex(enc("[1]"));
    // Who sent it first stays, for copies, but it must be sent again.
    expect(await env.DB.prepare("SELECT released_at_ms FROM blob_owners WHERE sha256 = ?").bind(only).first<{ released_at_ms: number }>()).toMatchObject({ released_at_ms: expect.any(Number) });
    const plan = await api("/games/hop/uploads", { body: { files: await listed({ "index.html": "<p>keep</p>", "only.json": "[1]" }) } });
    expect(plan.answer.missing_file_hashes).toEqual([only]);
    await api(`/files/${only}`, { method: "PUT", raw: enc("[1]") });
    expect((await storage()).stored_size_bytes).toBe(size + enc("[1]").byteLength);
  });

  it("refuses a version in use, being scanned or kept for a person", async () => {
    const live = await push({ "index.html": "<p>live</p>" });
    expect((await api(`/games/hop/versions/${live}`, { method: "DELETE" })).answer.error.code).toBe("still_scanning");
    await scanVersion(testEnv, live, pass);
    await api(`/games/hop/versions/${live}/publish`, { body: {} });
    expect((await api(`/games/hop/versions/${live}`, { method: "DELETE" })).answer.error.code).toBe("version_in_use");

    const draft = await push({ "index.html": "<p>draft</p>" });
    await scanVersion(testEnv, draft, pass);
    expect((await storage()).deletable_versions.map((version: { version_id: string }) => version.version_id)).toEqual([draft]);
    await env.DB.prepare("UPDATE versions SET report_held_at_ms = 1 WHERE id = ?").bind(draft).run();
    expect((await api(`/games/hop/versions/${draft}`, { method: "DELETE" })).answer.error.code).toBe("kept_for_review");
    expect((await storage()).deletable_versions).toEqual([]);
  });

  it("deletes a whole game with its slug typed again, and retires its link", async () => {
    const version = await push({ "index.html": "<p>gone</p>" });
    await scanVersion(testEnv, version, pass);
    expect((await api("/games/hop", { method: "DELETE", body: { confirm_slug: "nope" } })).answer.error.code).toBe("bad_confirm_slug");
    const deleted = await api("/games/hop", { method: "DELETE", body: { confirm_slug: "hop" } });
    expect(deleted.status).toBe(200);
    expect(deleted.answer).toMatchObject({ is_deleted: true, storage: { stored_size_bytes: 0 } });
    const game = (await gameBySlug(env.DB, "hop"))!;
    expect(game).toMatchObject({ review_status: "removed", owner_id: null });
    expect(await env.DB.prepare("SELECT requested_by_kind FROM game_deletions WHERE game_id = ?").bind(game.id).first()).toEqual({ requested_by_kind: "developer" });
    expect(await env.DB.prepare("SELECT slug FROM retired_game_slugs WHERE slug = 'hop'").first()).toEqual({ slug: "hop" });
    expect((await api("/games")).answer.games).toEqual([]);
  });

  it("refuses a game kept for child safety, and one being scanned", async () => {
    const version = await push({ "index.html": "<p>flag</p>" });
    expect((await api("/games/hop", { method: "DELETE", body: { confirm_slug: "hop" } })).answer.error.code).toBe("still_scanning");
    await env.DB.prepare(`UPDATE versions SET scan_status = 'held', scan_report = '{"is_child_safety":1,"findings":[]}' WHERE id = ?`).bind(version).run();
    expect((await api("/games/hop", { method: "DELETE", body: { confirm_slug: "hop" } })).answer.error.code).toBe("kept_for_review");
  });

  it("takes files nobody holds after a day, unless their owner sent something since yesterday", async () => {
    const lonely = enc("sent, never a version");
    const sha = await sha256Hex(lonely);
    await api(`/files/${sha}`, { method: "PUT", raw: lonely });
    await env.DB.prepare("UPDATE blobs SET created_at_ms = created_at_ms - ?").bind(2 * DAY_MS).run();
    await env.DB.prepare("UPDATE blob_owners SET created_at_ms = created_at_ms - ?").bind(2 * DAY_MS).run();
    // Still sending: a game too big for a day's new data goes up over several.
    await dailyCleanup(env, Date.now());
    expect(await env.GAMES.head(blobKey(sha))).not.toBeNull();
    expect((await storage()).stored_size_bytes).toBe(lonely.byteLength);

    await dailyCleanup(env, Date.now() + 3 * DAY_MS);
    expect(await env.GAMES.head(blobKey(sha))).toBeNull();
    expect((await storage()).stored_size_bytes).toBe(0);
  });
});

describe("a storage budget", () => {
  it("needs the developer's passkey to start or rise, not to stop or fall", async () => {
    const refused = await api("/storage", { method: "PATCH", body: { monthly_storage_budget_cents: 1000 } });
    expect(refused.answer.error).toMatchObject({ code: "confirmation_needed", spending_request_id: expect.any(String) });
    const request = await api(`/spending-requests/${refused.answer.error.spending_request_id}`);
    expect(request.answer.spending_request).toMatchObject({ request_kind: "storage_budget", requested_change: { monthly_budget_cents: 1000 }, current_setting: { monthly_budget_cents: null } });

    expect((await api("/storage", { method: "PATCH", body: { monthly_storage_budget_cents: 5 } })).answer.error.code).toBe("bad_monthly_storage_budget_cents");
    await env.DB.prepare("UPDATE owners SET monthly_storage_budget_cents = 1000 WHERE id = ?").bind(ownerId).run();
    expect((await api("/storage", { method: "PATCH", body: { monthly_storage_budget_cents: 500 } })).answer.storage.monthly_storage_budget_cents).toBe(500);
    expect((await api("/storage", { method: "PATCH", body: { monthly_storage_budget_cents: null } })).answer.storage.monthly_storage_budget_cents).toBeNull();
  });

  it("buys room with the budget and the balance", async () => {
    await env.DB.prepare("UPDATE owners SET monthly_storage_budget_cents = 1200 WHERE id = ?").bind(ownerId).run();
    expect((await storage()).maximum_stored_size_bytes).toBe(10 * GB);
    await addCredit(600);
    expect((await storage()).maximum_stored_size_bytes).toBe(60 * GB);
    await addCredit(100_000);
    expect((await storage()).maximum_stored_size_bytes).toBe(110 * GB);
  });

  it("charges each day once, up to the budget and the balance, and writes off the rest with nothing deleted", async () => {
    const day = Date.UTC(2026, 10, 2, 3);
    await env.DB.prepare("UPDATE owners SET monthly_storage_budget_cents = 1000 WHERE id = ?").bind(ownerId).run();
    await addCredit(1000);
    await setStored(110 * GB); // 100 GB past what's included: 40 cents a day in a 30-day month.
    await chargeStorage(env, day);
    await chargeStorage(env, day + 60_000);
    const charged = await env.DB.prepare("SELECT charged_cents, written_off_cents FROM owner_storage_months WHERE owner_id = ?").bind(ownerId).first();
    expect(charged).toEqual({ charged_cents: 40, written_off_cents: 0 });
    expect(await env.DB.prepare("SELECT credit_balance_cents FROM owners WHERE id = ?").bind(ownerId).first()).toEqual({ credit_balance_cents: 960 });
    expect(await env.DB.prepare("SELECT amount_cents, game_id FROM credit_entries WHERE entry_kind = 'storage_charge'").first()).toEqual({ amount_cents: -40, game_id: null });

    await env.DB.prepare("UPDATE owners SET credit_balance_cents = 10 WHERE id = ?").bind(ownerId).run();
    await chargeStorage(env, day + DAY_MS);
    expect(await env.DB.prepare("SELECT charged_cents, written_off_cents FROM owner_storage_months WHERE owner_id = ?").bind(ownerId).first()).toEqual({ charged_cents: 50, written_off_cents: 30 });
    expect(await env.DB.prepare("SELECT amount_cents FROM credit_entries WHERE entry_kind = 'written_off'").first()).toEqual({ amount_cents: 30 });
    expect((await storage()).stored_size_bytes).toBe(110 * GB);
  });

  it("charges nothing inside what's included, or with no budget", async () => {
    await addCredit(1000);
    await setStored(110 * GB);
    await chargeStorage(env, Date.UTC(2026, 10, 2, 3));
    await env.DB.prepare("UPDATE owners SET monthly_storage_budget_cents = 1000, stored_size_bytes = ? WHERE id = ?").bind(9 * GB, ownerId).run();
    await chargeStorage(env, Date.UTC(2026, 10, 3, 3));
    expect(await env.DB.prepare("SELECT COUNT(*) AS row_count FROM owner_storage_months").first()).toEqual({ row_count: 0 });
  });
});

describe("storage past the limit with nothing paying for it", () => {
  const clock = (ownerColumn: string) => env.DB.prepare(`SELECT ${ownerColumn} AS value FROM owners WHERE id = ?`).bind(ownerId).first<{ value: number | null }>().then((row) => row!.value);
  const passed = async (text: string) => {
    const version = await push({ "index.html": text });
    await scanVersion(testEnv, version, pass);
    return version;
  };
  /** Each file counts 6 GB, so a few versions take an account past 10 GB. */
  const makeFilesBig = async () => {
    await env.DB.prepare("UPDATE blobs SET size_bytes = ?").bind(6 * GB).run();
    await env.DB.prepare("UPDATE owners SET stored_size_bytes = (SELECT COUNT(*) FROM blob_owners WHERE owner_id = owners.id) * ?").bind(6 * GB).run();
  };

  it("starts a clock, warns before its end, then deletes drafts and the oldest versions only until it fits, live kept", async () => {
    const draft = await passed("<p>draft</p>");
    const older = await passed("<p>older</p>");
    await api(`/games/hop/versions/${older}/publish`, { body: {} });
    const newer = await passed("<p>newer</p>");
    await api(`/games/hop/versions/${newer}/publish`, { body: {} });
    const live = await passed("<p>live</p>");
    await api(`/games/hop/versions/${live}/publish`, { body: {} });
    await makeFilesBig();

    const startMs = Date.now();
    await judgeUnpaidStorage(env, startMs);
    expect(await clock("storage_unpaid_since_ms")).toBe(startMs);
    expect((await storage()).unpaid_files_delete_at).toBe(new Date(startMs + 14 * DAY_MS).toISOString());
    expect(await clock("storage_unpaid_warned_at_ms")).toBeNull();

    await judgeUnpaidStorage(env, startMs + 11 * DAY_MS);
    expect(await clock("storage_unpaid_warned_at_ms")).toBe(startMs + 11 * DAY_MS);
    expect(await versionById(env.DB, draft)).not.toBeNull();

    await judgeUnpaidStorage(env, startMs + 14 * DAY_MS);
    expect(await versionById(env.DB, draft)).toBeNull();
    expect(await versionById(env.DB, older)).toBeNull();
    expect(await versionById(env.DB, newer)).toBeNull();
    expect(await versionById(env.DB, live)).not.toBeNull();
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBe(live);
    expect((await storage()).stored_size_bytes).toBe(6 * GB);
    // It fits now, so the next day's run stops the clock.
    await judgeUnpaidStorage(env, startMs + 15 * DAY_MS);
    expect(await clock("storage_unpaid_since_ms")).toBeNull();
  });

  it("stops the delete there when only a live version is left, and keeps what a person needs", async () => {
    const kept = await passed("<p>kept</p>");
    await env.DB.prepare("UPDATE versions SET report_held_at_ms = 1 WHERE id = ?").bind(kept).run();
    const live = await passed("<p>live</p>");
    await api(`/games/hop/versions/${live}/publish`, { body: {} });
    await makeFilesBig();
    const startMs = Date.now();
    await judgeUnpaidStorage(env, startMs);
    await judgeUnpaidStorage(env, startMs + 14 * DAY_MS);
    expect(await versionById(env.DB, kept)).not.toBeNull();
    expect(await versionById(env.DB, live)).not.toBeNull();
    // Nothing more is due once the day has passed, though it's still over.
    expect((await storageOf(env.DB, ownerId, startMs + 14 * DAY_MS)).unpaidFilesDeleteAtMs).toBeNull();
  });

  it("doesn't start while Stripe tries a renewal, a card's plan is failing, a ruling's wait runs or a ban stands", async () => {
    const startMs = Date.now();
    await setStored(12 * GB);
    await env.DB.prepare("UPDATE owners SET stripe_subscription_id = 'sub_1', pro_until_ms = ? WHERE id = ?").bind(startMs - 1000, ownerId).run();
    await judgeUnpaidStorage(env, startMs);
    expect(await clock("storage_unpaid_since_ms")).toBeNull();
    await env.DB.prepare("UPDATE owners SET stripe_subscription_id = NULL, credit_plan_status = 'payment_failing' WHERE id = ?").bind(ownerId).run();
    await judgeUnpaidStorage(env, startMs);
    expect(await clock("storage_unpaid_since_ms")).toBeNull();
    await env.DB.prepare("UPDATE owners SET credit_plan_status = NULL, last_ruling_at_ms = ? WHERE id = ?").bind(startMs - DAY_MS, ownerId).run();
    await judgeUnpaidStorage(env, startMs);
    expect(await clock("storage_unpaid_since_ms")).toBeNull();
    await env.DB.prepare("UPDATE owners SET last_ruling_at_ms = NULL WHERE id = ?").bind(ownerId).run();
    await judgeUnpaidStorage(env, startMs);
    expect(await clock("storage_unpaid_since_ms")).toBe(startMs);
  });

  it("stops the clock once credit and a budget cover it", async () => {
    const startMs = Date.now();
    await setStored(12 * GB);
    await judgeUnpaidStorage(env, startMs);
    expect((await storage()).unpaid_files_delete_at).not.toBeNull();
    await env.DB.prepare("UPDATE owners SET monthly_storage_budget_cents = 1000 WHERE id = ?").bind(ownerId).run();
    await addCredit(1000);
    expect((await storage()).unpaid_files_delete_at).toBeNull();
    await judgeUnpaidStorage(env, startMs + DAY_MS);
    expect(await clock("storage_unpaid_since_ms")).toBeNull();
  });
});

describe("picture matching", () => {
  const stored = (index: number) => ({ path: `art/${index}.png`, key: `art/${index}.png`, sha256: String(index).padStart(64, "0"), sizeBytes: 100 });

  it("covers every file however many there are, in parts, with no hold for a person", async () => {
    const seen: number[] = [];
    const matcher: ImageMatcher = { check: async (media) => (seen.push(media.length), { provider: "test", isConnected: true, checkedMediaCount: media.length, findings: [] }) };
    const result = await matchMedia(env, Array.from({ length: 5001 }, (_, index) => stored(index)), [], [], matcher);
    expect(result.checkedMediaCount).toBe(5001);
    expect(result.findings).toEqual([]);
    expect(seen).toEqual([1000, 1000, 1000, 1000, 1000, 1]);
    expect(MAXIMUM_PACK_PICTURE_COUNT).toBe(10_000);
  });

  it("goes back on the queue when out of time, and picks up where it stopped", async () => {
    const seen: string[] = [];
    const matcher: ImageMatcher = { check: async (media) => (seen.push(...media.map((each) => each.path)), { provider: "test", isConnected: true, checkedMediaCount: media.length, findings: [] }) };
    await expect(matchMedia(env, Array.from({ length: 1500 }, (_, index) => stored(index)), [], [], matcher, Date.now(), 0)).rejects.toBeInstanceOf(ScanContinues);
    expect(seen).toHaveLength(1000);
    expect(matcher).not.toBe(notConnected);
  });
});
