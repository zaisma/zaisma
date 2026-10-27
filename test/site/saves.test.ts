import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { addSaveCopy, canonicalSave, createAccount, createGame, saveFromParts, saveHash, saveKey, saveRow, unversionedSaveKey, type SaveCopy, type SaveCopyReason } from "@zaisma/core";
import { changeSaveAsDeveloper, readSave, restoreSaveAsPlayer, storedSaveText } from "../../apps/site/src/saves.ts";

/**
 * Cloud saves as stored: each version's file written before its row moves, the file from before versions had
 * their own still read, and the history trimmed to five in the same step that adds a copy. The game page's
 * endpoint (/api/saves) is tested with a signed-in browser in accounts.test.ts, the developer API in saves-api.test.ts.
 */

const ACCOUNT_ID = "saves-player";
let gameId = "";
const H = 3600_000;
const DAY = 24 * H;
const NOW_MS = Date.now();

const textOf = (localStorageItems: Record<string, string>) => canonicalSave(saveFromParts(localStorageItems, []));
const current = async () => (await saveRow(env.DB, ACCOUNT_ID, gameId))!;
const history = async () => (await env.DB.prepare("SELECT id FROM save_history WHERE account_id = ? ORDER BY saved_at_ms DESC").bind(ACCOUNT_ID).all<{ id: string }>()).results.map((row) => row.id);
/** The player's game saving, through the same path a restore takes. */
const playerSaves = (localStorageItems: Record<string, string>) => restoreSaveAsPlayer(env, ACCOUNT_ID, gameId, textOf(localStorageItems), null);
/** A saves bucket that behaves like the real one, except where `override` says. */
const bucketWith = (override: Partial<Record<"get" | "put", (...given: never[]) => unknown>>) =>
  ({ get: env.SAVES.get.bind(env.SAVES), put: env.SAVES.put.bind(env.SAVES), delete: env.SAVES.delete.bind(env.SAVES), ...override }) as unknown as R2Bucket;

beforeEach(async () => {
  // Its own player, and a fresh game each test: other files' rows stay as they are.
  await env.DB.prepare("DELETE FROM save_history WHERE account_id = ?").bind(ACCOUNT_ID).run();
  await env.DB.prepare("DELETE FROM saves WHERE account_id = ?").bind(ACCOUNT_ID).run();
  if (!(await env.DB.prepare("SELECT 1 FROM accounts WHERE id = ?").bind(ACCOUNT_ID).first())) await createAccount(env.DB, { id: ACCOUNT_ID, username: "Save_Player", ageBand: "18+" });
  gameId = (await createGame(env.DB, { slug: `owl-saves-${crypto.randomUUID().slice(0, 8)}`, title: "Owl Saves", description: "" })).id;
});

describe("a save's files", () => {
  it("writes each version's file before its row moves, so a save that can't be stored leaves the version before whole", async () => {
    await playerSaves({ level: "3" });
    const before = await current();
    const failing = { ...env, SAVES: bucketWith({ put: () => Promise.reject(new Error("R2 is down")) }) };
    await expect(changeSaveAsDeveloper(failing, ACCOUNT_ID, gameId, () => textOf({ level: "10" }), null)).rejects.toThrow("R2 is down");
    await expect(restoreSaveAsPlayer(failing, ACCOUNT_ID, gameId, textOf({ level: "1" }), null)).rejects.toThrow("R2 is down");
    expect(await current()).toEqual(before);
    const row = await current();
    expect(await readSave(env, row)).toBe(textOf({ level: "3" }));
    expect(row.sha256).toBe(await saveHash(textOf({ level: "3" })));
  });

  it("reads the version as it is now when another save moves it on mid-read, its fields and text matching", async () => {
    await playerSaves({ level: "3" });
    const row = await current();
    let isMovedOn = false;
    // Another device's save lands between reading the row and reading its file, and deletes that file.
    const saves = bucketWith({
      get: async (key: string) => {
        if (!isMovedOn) {
          isMovedOn = true;
          await playerSaves({ level: "4" });
        }
        return env.SAVES.get(key);
      },
    });
    expect(await readSave({ ...env, SAVES: saves }, row)).toBe(textOf({ level: "4" }));
    expect(row).toMatchObject({ version_number: 2, sha256: await saveHash(textOf({ level: "4" })) });
  });

  it("deletes the version it moved on from, and the file a save from before versions had", async () => {
    await env.DB.prepare("INSERT INTO saves (account_id, game_id, version_number, sha256, size_bytes, saved_at_ms, changed_by_kind) VALUES (?, ?, 4, ?, 10, ?, 'player')")
      .bind(ACCOUNT_ID, gameId, await saveHash(textOf({ level: "3" })), NOW_MS)
      .run();
    await env.SAVES.put(unversionedSaveKey(ACCOUNT_ID, gameId), textOf({ level: "3" }));
    // A save stored before each version had its own file still reads.
    expect(await readSave(env, await current())).toBe(textOf({ level: "3" }));
    await playerSaves({ level: "4" });
    await playerSaves({ level: "5" });
    const row = await current();
    expect(row.version_number).toBe(6);
    expect((await env.SAVES.list({ prefix: `${ACCOUNT_ID}/${gameId}` })).objects.map((object) => object.key).filter((key) => !key.includes("/save_copy_"))).toEqual([saveKey(ACCOUNT_ID, gameId, 6, row.sha256)]);
    expect(await storedSaveText(env, row)).toBe(textOf({ level: "5" }));
  });

  it("stores one file when the same save is stored twice at the same moment, and never deletes the one the row names", async () => {
    await playerSaves({ level: "3" });
    await Promise.all([playerSaves({ level: "4" }), playerSaves({ level: "4" })]);
    const row = await current();
    expect(await readSave(env, row)).toBe(textOf({ level: "4" }));
  });
});

describe("the history of earlier versions", () => {
  let copyNumber = 0;
  /** A copy of progress played `hoursAgo` and kept `keptHoursAgo` (when it was played, unless said). */
  const copy = (hoursAgo: number, copyReason: SaveCopyReason = "hourly", keptHoursAgo = hoursAgo): SaveCopy => ({
    id: `save_copy_c${hoursAgo}x${copyNumber++}`,
    account_id: ACCOUNT_ID,
    game_id: gameId,
    saved_at_ms: NOW_MS - hoursAgo * H,
    kept_at_ms: NOW_MS - keptHoursAgo * H,
    copy_reason: copyReason,
    sha256: `sha-${hoursAgo}-${copyNumber}`,
    size_bytes: 10,
    version_id: null,
  });
  /** Add copies one at a time, as they were kept, and answer what's left, newest first. */
  async function kept(copies: SaveCopy[]) {
    for (const each of copies) await addSaveCopy(env.DB, each, NOW_MS);
    return history();
  }

  it("keeps five: the newest always, then routine copies go first, oldest first", async () => {
    const copies = [copy(6), copy(5, "smaller"), copy(4), copy(3), copy(2, "account_lost"), copy(1), copy(0)];
    expect(await kept(copies)).toEqual([copies[6]!.id, copies[5]!.id, copies[4]!.id, copies[3]!.id, copies[1]!.id]);
  });

  it("drops the oldest when every other copy is protected", async () => {
    const copies = [copy(5, "account_lost"), copy(4, "restore"), copy(3, "smaller"), copy(2, "account_lost"), copy(1, "device_lost"), copy(0)];
    expect(await kept(copies)).toEqual(copies.slice(1).reverse().map((each) => each.id));
  });

  it("never drops the copy being added, even one of progress played long ago, and says so", async () => {
    const newer = [copy(4, "account_lost"), copy(3, "smaller"), copy(2, "restore"), copy(1, "account_lost"), copy(0, "smaller")];
    await kept(newer);
    const old = copy(35 * 24, "developer", 0);
    const { dropped, heldById } = await addSaveCopy(env.DB, old, NOW_MS);
    expect(heldById).toBe(old.id);
    expect(dropped.map((each) => each.id)).toEqual([newer[0]!.id]);
    expect(await history()).toContain(old.id);
  });

  it("protects a copy for 30 days from when it was kept, not from when its progress was played", async () => {
    // Kept today, of progress last played 31 days ago: protected. Kept 31 days ago: routine now.
    const keptToday = copy(31 * 24, "developer", 0);
    const keptLongAgo = copy(32 * 24, "account_lost", 31 * 24);
    const left = await kept([keptLongAgo, keptToday, copy(4), copy(3), copy(2), copy(1), copy(0)]);
    expect(left).toContain(keptToday.id);
    expect(left).not.toContain(keptLongAgo.id);
    expect(left).toHaveLength(5);
  });

  it("never leaves more than five when copies are kept at the same moment, and keeps the same progress once", async () => {
    await kept([copy(30), copy(20), copy(10)]);
    await Promise.all([copy(4, "device_lost"), copy(3, "device_lost"), copy(2, "device_lost"), copy(1, "device_lost")].map((each) => addSaveCopy(env.DB, each, NOW_MS)));
    expect(await history()).toHaveLength(5);
    const same = [copy(0, "device_lost"), copy(0, "device_lost")].map((each) => ({ ...each, sha256: "same-progress" }));
    const answers = await Promise.all(same.map((each) => addSaveCopy(env.DB, each, NOW_MS)));
    expect(new Set(answers.map((answer) => answer.heldById)).size).toBe(1);
    expect((await env.DB.prepare("SELECT COUNT(*) AS copy_count FROM save_history WHERE sha256 = 'same-progress'").first<{ copy_count: number }>())!.copy_count).toBe(1);
  });
});
