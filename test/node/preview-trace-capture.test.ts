import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The preview runs wrangler with its local trace capture off (scripts/preview/run.mjs): left on, it keeps every call
 * into a real-time room's game server, 20 a second per room, in the runtime's memory. The switch is an environment
 * variable wrangler reads by name, so a wrangler update that renames it would turn the capture back on without a word.
 */

const ROOT = join(import.meta.dirname, "../..");

describe("the preview's trace capture", () => {
  it("is off in the wrangler the preview starts", () => {
    const run = readFileSync(join(ROOT, "scripts/preview/run.mjs"), "utf8");
    const spawn = run.split("\n").find((line) => line.includes("serversProcess = spawn("));
    expect(spawn).toContain('X_LOCAL_OBSERVABILITY: "false"');
  });

  it("is still switched by the variable the installed wrangler reads", () => {
    const require = createRequire(join(ROOT, "node_modules/wrangler/package.json"));
    const miniflare = readFileSync(join(dirname(require.resolve("miniflare")), "index.js"), "utf8");
    expect(miniflare).toMatch(/variableName: "X_LOCAL_OBSERVABILITY",\s*defaultValue: true/);
  });
});
