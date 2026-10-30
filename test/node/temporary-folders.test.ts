// Test runs leave nothing in the system's temporary folder: every test makes its temporary folders with test/temporary-folder.ts,
// which removes them after its file, never with mkdtemp itself (whose folders stayed, about 1,450 of them on one Mac by Oct 30, 2026).
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
/** The helper itself, and the engine samples, which are other projects' builds. */
const LEFT_OUT = ["test/temporary-folder.ts", "test/engines"];

function testSources(folder = join(ROOT, "test")): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (LEFT_OUT.includes(relative(ROOT, path))) return [];
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : testSources(path);
    return /\.(ts|mts|mjs|js)$/.test(entry.name) ? [relative(ROOT, path)] : [];
  });
}

describe("temporary folders in tests", () => {
  it("are made with temporaryFolder, which removes them, never with mkdtemp", () => {
    const raw = testSources().filter((path) => /\bmkdtemp(Sync)?\(/.test(readFileSync(join(ROOT, path), "utf8")));
    expect(raw, "make these with temporaryFolder(prefix) from test/temporary-folder.ts").toEqual([]);
  });
});
