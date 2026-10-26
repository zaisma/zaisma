import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gameHeaders } from "../../packages/core/src/index.ts";
import { localGameHeaders, ONLY_ON_ZAISMA_PATHS, SERVED_ZAISMA_PATHS } from "../../packages/game-server/bin/local-play.js";
import { FRAME_ALLOW, FRAME_SANDBOX } from "../../packages/game-server/bin/local-play-bench.js";

// The bench (packages/game-server/bin/local-play.js) serves and frames the game as Zaisma does: the same _zaisma/
// files, the same headers and the same sandbox, held here to the games Worker and the game page so they can't drift.

const ROOT = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("the bench matches Zaisma", () => {
  it("serves every _zaisma/ file the games Worker serves, or says it's only on Zaisma", () => {
    const worker = new Set([...read("apps/games/src/index.ts").matchAll(/filePath === "(_zaisma\/[^"]+)"/g)].map((match) => match[1]));
    expect([...SERVED_ZAISMA_PATHS, ...ONLY_ON_ZAISMA_PATHS].sort()).toEqual([...worker].sort());
  });

  it("frames the game with the game page's sandbox and permissions", () => {
    const page = read("apps/site/src/pages.ts");
    expect(page).toContain(`sandbox="${FRAME_SANDBOX}"`);
    expect(page).toContain(`allow="${FRAME_ALLOW}"`);
  });

  it("gives the game's files the games Worker's headers", () => {
    const origins = ["http://localhost:4802", "ws://localhost:4802"];
    expect(localGameHeaders("text/html; charset=utf-8", "http://localhost:4800", origins)).toEqual(Object.fromEntries([...gameHeaders("text/html; charset=utf-8", "http://localhost:4800", origins).entries()].map(([name, headerValue]) => [name.replace(/(^|-)([a-z])/g, (_: string, dash: string, letter: string) => dash + letter.toUpperCase()), headerValue])));
  });

  it("draws QR codes with the same encoder as the site", () => {
    expect(read("packages/game-server/src/qr-code.ts")).toBe(read("packages/core/src/qr-code.ts"));
  });
});
