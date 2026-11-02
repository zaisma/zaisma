import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, createGame, personOwner, publishVersion, versionById } from "@zaisma/core";
import "../../apps/site/src/index.ts";
import { errorProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

/** A publish is a quiet patch unless the developer marks it a big update, and only a marked version going live for the first time is news. */

const SITE = "https://zaisma.test";
const DAY_MS = 86_400_000;
let token = "";
let versionNumber = 0;

async function api(path: string, method = "GET", body?: unknown) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) expect(errorProblems(await response.clone().json(), response.status)).toEqual([]);
  return response;
}
const answer = async (response: Response) => {
  expect(response.ok).toBe(true);
  return (await response.json()) as { game: Record<string, string | null>; version: Record<string, unknown> };
};
const refusedWith = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

/** A version that passed and has never been live. */
async function draft(gameId: string, patchNotes = ""): Promise<string> {
  const id = `version_bigupdate${(versionNumber += 1)}`;
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, kind, patch_notes, publish_when_approved_enabled, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', 'zip', ?, 0, ?)").bind(id, gameId, `games/x/${id}`, patchNotes, versionNumber).run();
  return id;
}
const publish = (versionId: string, body?: unknown) => api(`/games/hop/versions/${versionId}/publish`, "POST", body);
const dates = () => env.DB.prepare("SELECT first_published_at_ms, big_update_at_ms, recently_updated_at_ms FROM games WHERE slug = 'hop'").first<{ first_published_at_ms: number | null; big_update_at_ms: number | null; recently_updated_at_ms: number | null }>();
/** The game as if first released this many days ago. */
const releasedAgo = (agoDays: number) => env.DB.prepare("UPDATE games SET first_published_at_ms = ? WHERE slug = 'hop'").bind(Date.now() - agoDays * DAY_MS).run();

let gameId = "";
beforeEach(async () => {
  await env.DB.exec("DELETE FROM versions; DELETE FROM api_keys; DELETE FROM games WHERE slug = 'hop'; DELETE FROM games WHERE slug LIKE 'zaisma%'");
  await createAccount(env.DB, { id: "big-dev", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "big-dev");
  await env.DB.prepare("UPDATE owners SET is_zaisma_account = 0 WHERE account_id = 'big-dev'").run();
  token = (await createApiKey(env.DB, "big-dev", "laptop")).token;
  const owner = await personOwner(env.DB, "big-dev");
  gameId = (await createGame(env.DB, { slug: "hop", title: "Hop", description: "", ownerId: owner.id, visibility: "listed" })).id;
});

describe("publishing", () => {
  it("is a quiet patch unless it's marked", async () => {
    await publish(await draft(gameId));
    const released = (await dates())!;
    expect(released.first_published_at_ms).not.toBeNull();
    const patched = await answer(await publish(await draft(gameId, "Fixed the jump on ladders.")));
    expect(patched.version.is_big_update).toBe(false);
    expect(await dates()).toEqual(released);
    expect(patched.game.big_update_at).toBeNull();
    expect(patched.game.first_published_at).toBe(patched.game.recently_updated_at);
    // Its notes still show in the game's Updates.
    await env.DB.prepare("UPDATE games SET visibility = 'unlisted' WHERE id = ?").bind(gameId).run();
    expect(await (await SELF.fetch(`${SITE}/g/hop`)).text()).toContain("Fixed the jump on ladders.");
  });

  it("counts a marked big update: the tag's date, and a move up once 30 days have passed", async () => {
    await publish(await draft(gameId));
    await releasedAgo(31);
    const marked = await answer(await publish(await draft(gameId), { is_big_update: true, patch_notes: "Three new worlds." }));
    expect(marked.version).toMatchObject({ is_big_update: true, patch_notes: "Three new worlds." });
    expect(marked.game.big_update_at).not.toBeNull();
    expect(marked.game.recently_updated_at).toBe(marked.game.big_update_at);
    await env.DB.prepare("UPDATE games SET visibility = 'unlisted' WHERE id = ?").bind(gameId).run();
    expect(await (await SELF.fetch(`${SITE}/g/hop`)).text()).toMatch(/Updated\b/);
  });

  it("moves a game up at most once every 30 days, while the Updated date has no limit", async () => {
    await publish(await draft(gameId));
    // The release is the first move: 5 days on, the date moves and the place doesn't.
    await releasedAgo(5);
    const soon = (await answer(await publish(await draft(gameId, "New world."), { is_big_update: true }))).game;
    expect(soon.big_update_at).not.toBeNull();
    expect(soon.recently_updated_at).toBe(soon.first_published_at);
    // Moved 31 days ago: it moves. Moved just now: it doesn't.
    await env.DB.prepare("UPDATE games SET recently_updated_at_ms = ? WHERE id = ?").bind(Date.now() - 31 * DAY_MS, gameId).run();
    const moved = (await dates())!;
    await publish(await draft(gameId, "Another world."), { is_big_update: true });
    const afterMove = (await dates())!;
    expect(afterMove.recently_updated_at_ms!).toBeGreaterThan(moved.recently_updated_at_ms!);
    await publish(await draft(gameId, "And another."), { is_big_update: true });
    expect((await dates())!.recently_updated_at_ms).toBe(afterMove.recently_updated_at_ms);
    expect((await dates())!.big_update_at_ms!).toBeGreaterThanOrEqual(afterMove.big_update_at_ms!);
  });

  it("treats a marked first release as the release", async () => {
    await publish(await draft(gameId, "Out now."), { is_big_update: true });
    const released = (await dates())!;
    expect(released.first_published_at_ms).not.toBeNull();
    expect(released.big_update_at_ms).toBeNull();
    expect(released.recently_updated_at_ms).toBeNull();
  });

  it("never counts a rollback or a republish, and keeps the first date", async () => {
    const first = await draft(gameId, "One.");
    await publish(first);
    const second = await draft(gameId, "Two.");
    await publish(second);
    const before = (await dates())!;
    const firstLive = (await versionById(env.DB, first))!.first_published_at_ms;
    await publish(first);
    await publish(first);
    expect(await dates()).toEqual(before);
    expect((await versionById(env.DB, first))!.first_published_at_ms).toBe(firstLive);
    // A version's own date in Updates doesn't move, though it went live again.
    expect((await versionById(env.DB, first))!.published_at_ms!).toBeGreaterThanOrEqual(firstLive!);
  });

  it("refuses what can't be a big update, closed", async () => {
    await publish(await draft(gameId, "One."));
    const live = (await env.DB.prepare("SELECT live_version_id FROM games WHERE id = ?").bind(gameId).first<{ live_version_id: string }>())!.live_version_id;
    const noNotes = await draft(gameId);
    expect(await refusedWith(await publish(noNotes, { is_big_update: true }))).toBe("big_update_needs_patch_notes");
    expect(await refusedWith(await publish(noNotes, { is_big_update: "yes" }))).toBe("bad_is_big_update");
    expect(await refusedWith(await publish(live, { is_big_update: true }))).toBe("big_update_already_live");
    expect(await refusedWith(await publish(live, { patch_notes: "Rewritten." }))).toBe("bad_patch_notes");
    expect(await refusedWith(await publish(noNotes, { patch_notes: 7 }))).toBe("bad_patch_notes");
    expect(await refusedWith(await publish(noNotes, { is_big: true }))).toBe("unknown_field");
    expect((await versionById(env.DB, noNotes))!.published_at_ms).toBeNull();
  });

  it("passes a retry of a publish already marked", async () => {
    await publish(await draft(gameId));
    const marked = await draft(gameId, "New world.");
    await answer(await publish(marked, { is_big_update: true }));
    const before = (await dates())!;
    await answer(await publish(marked, { is_big_update: true, patch_notes: "New world." }));
    expect(await dates()).toEqual(before);
  });

  it("keeps the mark on a scheduled publish, until it's cancelled", async () => {
    await publish(await draft(gameId));
    await releasedAgo(40);
    const scheduled = await draft(gameId);
    const atIso = new Date(Date.now() + DAY_MS).toISOString();
    expect(await refusedWith(await publish(scheduled, { scheduled_publish_at: atIso, is_big_update: true }))).toBe("big_update_needs_patch_notes");
    const answered = await answer(await publish(scheduled, { scheduled_publish_at: atIso, is_big_update: true, patch_notes: "A new season." }));
    expect(answered.version).toMatchObject({ is_big_update: true, patch_notes: "A new season." });
    expect((await dates())!.big_update_at_ms).toBeNull();
    // The publish-later job goes live with what's stored.
    await publishVersion(env.DB, (await versionById(env.DB, scheduled))!);
    expect((await dates())!.big_update_at_ms).not.toBeNull();
    const cancelled = await draft(gameId, "Later.");
    await answer(await publish(cancelled, { scheduled_publish_at: atIso, is_big_update: true }));
    await answer(await api(`/games/hop/versions/${cancelled}/publish`, "DELETE"));
    expect((await versionById(env.DB, cancelled))!.is_big_update).toBe(0);
  });

  it("takes the mark on an upload only with publish_when_approved", async () => {
    const bytes = new TextEncoder().encode("<!doctype html><title>Hop</title>");
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const files = [{ path: "index.html", sha256, size_bytes: bytes.length }];
    await api("/games/hop/uploads", "POST", { files });
    await SELF.fetch(`${SITE}/api/dev/files/${sha256}`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: bytes });
    expect(await refusedWith(await api("/games/hop/versions", "POST", { files, is_big_update: true, patch_notes: "New." }))).toBe("bad_is_big_update");
    expect(await refusedWith(await api("/games/hop/versions", "POST", { files, publish_when_approved: true, is_big_update: "yes", patch_notes: "New." }))).toBe("bad_is_big_update");
    expect(await refusedWith(await api("/games/hop/versions", "POST", { files, publish_when_approved: true, is_big_update: true }))).toBe("big_update_needs_patch_notes");
    const uploaded = (await (await api("/games/hop/versions", "POST", { files, publish_when_approved: true, is_big_update: true, patch_notes: "New." })).json()) as { version: { is_big_update: boolean } };
    expect(uploaded.version.is_big_update).toBe(true);
  });
});

describe("a title holding the word Zaisma", () => {
  const createdWith = (title: string, slug: string) => api("/games", "POST", { title, slug });

  it("is refused when it's saved, in any case, and a longer word is fine", async () => {
    expect(await refusedWith(await createdWith("Zaisma Quest", "zaisma-quest"))).toBe("title_names_zaisma");
    expect(await refusedWith(await createdWith("ZAISMA!", "zaisma-shout"))).toBe("title_names_zaisma");
    expect((await createdWith("Zaismatic", "zaismatic")).status).toBe(201);
    expect(await refusedWith(await api("/games/hop", "PATCH", { title: "The Zaisma Run" }))).toBe("title_names_zaisma");
    expect((await api("/games/hop", "PATCH", { title: "Hop Again" })).ok).toBe(true);
  });

  it("is fine on Zaisma's own games", async () => {
    await env.DB.prepare("UPDATE owners SET is_zaisma_account = 1 WHERE account_id = 'big-dev'").run();
    expect((await createdWith("Zaisma Quest", "zaisma-quest")).status).toBe(201);
    expect((await api("/games/hop", "PATCH", { title: "The Zaisma Run" })).ok).toBe(true);
  });
});
