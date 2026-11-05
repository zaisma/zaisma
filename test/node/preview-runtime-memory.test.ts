import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The preview's runtime keeps its memory flat while real-time rooms tick (scripts/preview/run.mjs): the local trace capture is off, since it
 * keeps every call into a room's game server, 20 a second per room, and V8 does a full garbage collection with each small one, since only a
 * full one frees what each of those calls leaves in the runtime. Both are environment variables Miniflare reads by name, so an update that
 * renames one would bring the growth back without a word. And servers.mjs runs on what Miniflare and wrangler export, which an update could
 * take away.
 */

const ROOT = join(import.meta.dirname, "../..");

function serversSpawn(): string | undefined {
  const run = readFileSync(join(ROOT, "scripts/preview/run.mjs"), "utf8");
  return run.split("\n").find((line) => line.includes("const spawnServers = "));
}

function installedMiniflare(): string {
  const require = createRequire(join(ROOT, "node_modules/wrangler/package.json"));
  return readFileSync(join(dirname(require.resolve("miniflare")), "index.js"), "utf8");
}

describe("the preview's runtime memory", () => {
  it("runs its servers with the trace capture off and full garbage collections", () => {
    const spawn = serversSpawn();
    expect(spawn).toContain('X_LOCAL_OBSERVABILITY: "false"');
    expect(spawn).toContain("MINIFLARE_WORKERD_V8_FLAGS: V8_FLAGS");
    expect(readFileSync(join(ROOT, "scripts/preview/run.mjs"), "utf8")).toContain('const V8_FLAGS = "--gc-global --optimize-for-size";');
  });

  it("uses what servers.mjs needs from the installed wrangler and Miniflare", () => {
    const miniflareRequire = createRequire(join(ROOT, "node_modules/wrangler/package.json"));
    expect(typeof miniflareRequire("miniflare").convertV4MiniflareOptions).toBe("function");
    expect(readFileSync(join(ROOT, "node_modules/wrangler/wrangler-dist/cli.js"), "utf8")).toContain("exports.unstable_getMiniflareWorkerOptions");
  });

  it("uses the variables the installed Miniflare reads", () => {
    const miniflare = installedMiniflare();
    expect(miniflare).toMatch(/variableName: "X_LOCAL_OBSERVABILITY",\s*defaultValue: true/);
    expect(miniflare).toMatch(/v8Flags: process\.env\.MINIFLARE_WORKERD_V8_FLAGS \? process\.env\.MINIFLARE_WORKERD_V8_FLAGS\.split\(" "\)/);
  });
});
