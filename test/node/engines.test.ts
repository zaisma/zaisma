import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decide, staticScan } from "@zaisma/core";
import { CHECKED_TEXT_EXTENSIONS, PRECOMPRESSED_EXTENSIONS, checkGameFiles, extensionOf } from "../../packages/cli/check.mjs";

/**
 * The engine samples (test/engines/<engine>/build): a web export from each engine Zaisma says runs
 * unchanged, as the engine wrote it. The check finds nothing the upload command doesn't fix, and the
 * scan's own stage holds nothing. scripts/engines/play.mjs takes them the rest of the way, through the
 * real upload, scan and game page in the preview (GitHub's "Engine exports" job).
 */

const ROOT = join(import.meta.dirname, "../..");
const ENGINES = join(ROOT, "test/engines");
const engines = readdirSync(ENGINES, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

function filesOf(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesOf(join(folder, entry.name)) : [join(folder, entry.name)]));
}

/** A build's files as the check reads them, and as the scan does once the upload command has unpacked them. */
function buildOf(engine: string) {
  const folder = join(ENGINES, engine, "build");
  const files = filesOf(folder).map((full) => ({ path: relative(folder, full).split("\\").join("/"), full }));
  const checked = files.map(({ path, full }) => ({ path, sizeBytes: statSync(full).size, contentText: CHECKED_TEXT_EXTENSIONS.includes(extensionOf(path)) ? readFileSync(full, "utf8") : null }));
  const scanned = files.flatMap(({ path, full }) => {
    const extension = extensionOf(path);
    const isPacked = PRECOMPRESSED_EXTENSIONS.includes(extension);
    const unpackedPath = isPacked ? path.slice(0, -extension.length - 1) : path;
    if (!CHECKED_TEXT_EXTENSIONS.includes(extensionOf(unpackedPath))) return [];
    const bytes = readFileSync(full);
    const text = (isPacked ? (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : brotliDecompressSync(bytes)) : bytes).toString("utf8");
    return [{ path: unpackedPath, text }];
  });
  return { checked, scanned };
}

describe("engine samples", () => {
  it("has a web export from each engine Zaisma says runs unchanged, with what made it", () => {
    expect(engines).toEqual(expect.arrayContaining(["bevy", "godot", "macroquad", "phaser", "three", "unity"]));
    for (const engine of engines) {
      expect(existsSync(join(ENGINES, engine, "build/index.html")), `${engine}/build/index.html`).toBe(true);
      expect(existsSync(join(ENGINES, engine, "README.md")), `${engine}/README.md`).toBe(true);
    }
  });

  it.each(engines)("%s: the check finds nothing the upload command doesn't fix", (engine) => {
    const { problems } = checkGameFiles(buildOf(engine).checked);
    expect(problems.filter((problem) => !problem.is_fixed_by_upload_command)).toEqual([]);
  });

  it.each(engines)("%s: the scan's own stage holds nothing", (engine) => {
    const { findings } = staticScan(buildOf(engine).scanned);
    expect(findings.filter((finding) => finding.severity !== "info")).toEqual([]);
    expect(decide(findings)).toBe("approved");
  });
});
