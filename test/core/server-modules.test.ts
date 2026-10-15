import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { blobKey, isServerPath, serverModules, type Manifest } from "@zaisma/core";

/** A manifest of these files, each stored at its size: a manifest says where files are, storage knows their size. */
async function files(sizes: Record<string, number>): Promise<Manifest> {
  const entries = await Promise.all(
    Object.entries(sizes).map(async ([path, sizeBytes], i) => {
      const sha256 = String(i).padStart(64, "0");
      await env.GAMES.put(blobKey(sha256), new Uint8Array(sizeBytes));
      return [path, { sha256 }] as const;
    }),
  );
  return { files: Object.fromEntries(entries) };
}
const v = { kind: "files" as const, r2_prefix: "" };

describe("a game's own game server in its upload", () => {
  it("is the zaisma-server/ folder's .js files when it has index.js, else zaisma-server.js", async () => {
    const both = await serverModules(env.GAMES, v, await files({ "index.html": 9, "zaisma-server.js": 5, "zaisma-server/index.js": 5, "zaisma-server/lib/a.js": 5, "zaisma-server/levels.json": 5, "zaisma-server/physics.wasm": 5, "zaisma-server/notes.txt": 5 }));
    expect(both).toMatchObject({ entry: "zaisma-server/index.js" });
    expect((both as { files: { path: string }[] }).files.map((f) => f.path)).toEqual(["zaisma-server/index.js", "zaisma-server/lib/a.js", "zaisma-server/levels.json", "zaisma-server/physics.wasm"]);
    expect(await serverModules(env.GAMES, v, await files({ "zaisma-server.js": 5, "zaisma-server/lib/a.js": 5 }))).toMatchObject({ entry: "zaisma-server.js", files: [{ path: "zaisma-server.js" }] });
    expect(await serverModules(env.GAMES, v, await files({ "index.html": 9, "server/index.js": 5 }))).toBeNull();
  });

  it("is refused over 5 MB or 500 files", async () => {
    expect(await serverModules(env.GAMES, v, await files({ "zaisma-server/index.js": 3_000_000, "zaisma-server/physics.wasm": 3_000_000 }))).toEqual({ error: "A game server can be up to 5 MB." });
    const many = Object.fromEntries([["zaisma-server/index.js", 1], ...Array.from({ length: 500 }, (_, i) => [`zaisma-server/f${i}.js`, 1])]);
    expect(await serverModules(env.GAMES, v, await files(many))).toEqual({ error: "A game server can have up to 500 files." });
  });

  it("is never served to players, whichever way it's laid out", () => {
    expect(["zaisma-server.js", "zaisma-server/index.js", "zaisma-server/lib/a.js"].every(isServerPath)).toBe(true);
    expect(["server/index.js", "index.html", "js/zaisma-server.js"].some(isServerPath)).toBe(false);
  });
});
