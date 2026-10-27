import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { restoreRuleOf } from "../../apps/site/src/restore-rules.ts";

// A restore from the backups (apps/site/src/restore.ts) brings a key back only by a rule in restore-rules.ts.
// Every function the code calls to make the key or prefix of an R2 read, write or delete is here with a key
// it makes, so a new kind of file fails this test until it has a rule, and can't be left out of a restore by accident.

const ROOT = join(import.meta.dirname, "..", "..");

/** Each name that makes a key or prefix in the game files or saves bucket, and one backup key it makes. */
const R2_KEY_EXAMPLES: Record<string, string> = {
  blobKey: "zaisma-games/blobs/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  ownedBlobKey: "zaisma-games/owned/owner_1/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  manifestKey: "zaisma-games/manifests/version_1.json",
  fileKey: "zaisma-games/games/game_1/version_1/index.html",
  imageKey: "zaisma-games/images/game_1/image_1",
  cardImageKey: "zaisma-games/images/game_1/image_1.card.jpg",
  sizedImageKey: "zaisma-games/images/game_1/image_1.w640.webp",
  imageCopyKeys: "zaisma-games/images/game_1/image_1.w320.webp",
  heldImageKey: "zaisma-games/held-images/game_1/image_1",
  shaderKey: "zaisma-games/shaders/game_1/shader_1.glsl",
  shaderManifestKey: "zaisma-games/shaders/game_1/shader_1.json",
  shaderStillKey: "zaisma-games/shaders/game_1/shader_1.still.png",
  shaderFrameKey: "zaisma-games/shaders/game_1/shader_1.frame-0.png",
  shaderKeys: "zaisma-games/shaders/game_1/shader_1.glsl",
  forumMediaKey: "zaisma-games/forum-media/media_1",
  forumHeldKey: "zaisma-games/forum-held/media_1",
  reportPictureKey: "zaisma-games/report-pictures/report_1.jpg",
  logKey: "zaisma-games/logs/game_1/79739972/1761500000000-room",
  logPrefix: "zaisma-games/logs/game_1/79739972/1761500000000-room",
  logDayPrefix: "zaisma-games/logs/game_1/79739972/1761500000000-room",
  shaderCheckSheetKey: "zaisma-games/shader-checks/sheet_1.png",
  shaderCheckRunPrefix: "zaisma-games/shader-check-runs/owner_1/1761500000000-run",
  brotliKeyOf: "zaisma-games/brotli/blobs/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  saveKey: "zaisma-saves/account_1/game_1/save_7_9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.json",
  unversionedSaveKey: "zaisma-saves/account_1/game_1.json",
  saveCopyKey: "zaisma-saves/account_1/game_1/copy_1.json",
  keptKey: "zaisma-games/held-images/game_1/shader_1.still.png",
};

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

const sourceFolders = [...readdirSync(join(ROOT, "apps")).map((app) => join(ROOT, "apps", app, "src")), ...readdirSync(join(ROOT, "packages")).map((name) => join(ROOT, "packages", name, "src"))].filter((folder) => {
  try {
    return readdirSync(folder).length > 0;
  } catch {
    return false;
  }
});

describe("what a restore brings back", () => {
  it("has a rule for every key and prefix the code makes", () => {
    const names = new Set<string>();
    const writtenKeys = new Set<string>();
    for (const file of sourceFolders.flatMap(sourceFiles)) {
      const source = readFileSync(file, "utf8");
      // A function making the key of a call on a bucket, or the prefix of a listing.
      for (const match of source.matchAll(/\b(?:GAMES|SAVES|bucket)\.(?:put|get|delete|head)\(\s*\[?\s*(?:\.\.\.)?(\w+)\(|\bprefix:\s*(\w+)\(|\bdelete(?:Under|Keys)\([^,]+,\s*(?:\w+\.map\(\(\w+\) => )?(\w+)\(/g)) names.add((match[1] ?? match[2] ?? match[3])!);
      // A key written out in place, with a stand-in for each value in it.
      for (const match of source.matchAll(/\b(GAMES|SAVES)\.(?:put|get|delete|head)\(`([a-z][^`]*)`/g)) writtenKeys.add(`zaisma-${match[1]!.toLowerCase()}/${match[2]!.replace(/\$\{[^}]*\}/g, "value_1")}`);
    }
    const unsorted = [...names].filter((name) => !(name in R2_KEY_EXAMPLES));
    expect(unsorted, "a new kind of R2 key: give it an example key here and a rule in apps/site/src/restore-rules.ts").toEqual([]);
    expect(writtenKeys.size).toBeGreaterThan(0);
    for (const backupKey of writtenKeys) {
      const rule = restoreRuleOf(backupKey);
      expect(rule.kind === "never" ? rule.reason : rule.kind, backupKey).not.toMatch(/^no rule|^not a /);
    }
    for (const [name, backupKey] of Object.entries(R2_KEY_EXAMPLES)) {
      const rule = restoreRuleOf(backupKey);
      expect(rule.kind === "never" ? rule.reason : rule.kind, name).not.toMatch(/^no rule|^not a /);
    }
  });

  it("brings back a save, a game's files and its database only with what owns them", () => {
    expect(restoreRuleOf("zaisma-saves/account_1/game_1.json")).toMatchObject({ kind: "owned", ownerValues: ["account_1", "game_1"], contentType: "application/json" });
    expect(restoreRuleOf("zaisma-saves/account_1/game_1/save_7_9f86d081.json")).toMatchObject({ kind: "owned", ownerValues: ["account_1", "game_1", "7", "9f86d081"] });
    expect(restoreRuleOf("zaisma-saves/account_1/game_1/copy_1.json")).toMatchObject({ kind: "owned", ownerValues: ["copy_1", "account_1", "game_1"] });
    expect(restoreRuleOf("zaisma-games/games/game_1/k2m4x9/assets/level 2.png")).toMatchObject({ kind: "owned", ownerSql: expect.stringContaining("r2_prefix"), ownerValues: ["games/game_1/k2m4x9", "games/game_1"] });
    expect(restoreRuleOf("zaisma-games/images/game_1/image_1.card.jpg")).toMatchObject({ kind: "owned", ownerValues: ["image_1", "game_1"], contentType: "image/jpeg" });
    expect(restoreRuleOf("game-databases/game_1.sql")).toMatchObject({ kind: "owned", ownerValues: ["game_1"] });
    expect(restoreRuleOf("kept-rooms/game_1/ABCDEF.jsonl")).toMatchObject({ kind: "owned", ownerValues: ["game_1", "ABCDEF"] });
    expect(restoreRuleOf("zaisma-games/brotli/blobs/abc")).toMatchObject({ kind: "never" });
    expect(restoreRuleOf("main-database.sql")).toMatchObject({ kind: "never" });
    expect(restoreRuleOf("zaisma-games/something-new/x")).toEqual({ kind: "never", reason: "no rule for this kind of game file" });
  });
});
