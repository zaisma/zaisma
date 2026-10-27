import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as publicSurface from "../../packages/game-server/src/index.ts";

/**
 * What npm publishes for @zaisma/game-server: the build in packages/game-server/dist, made the way the
 * publish workflow makes it. Its package.json, its entries, its types, and the command it installs.
 */

const PACKAGE_DIR = join(import.meta.dirname, "../../packages/game-server");
const DIST_DIR = join(PACKAGE_DIR, "dist");

describe("the built @zaisma/game-server package", () => {
  beforeAll(() => {
    execFileSync(process.execPath, [join(PACKAGE_DIR, "scripts/build.mjs")], { cwd: PACKAGE_DIR, stdio: "pipe" });
  }, 120_000);

  afterAll(() => {
    rmSync(DIST_DIR, { recursive: true, force: true });
  });

  it("has the fields npm needs, and no internal entry", () => {
    const built = JSON.parse(readFileSync(join(DIST_DIR, "package.json"), "utf8"));
    const source = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"));
    expect(built.name).toBe("@zaisma/game-server");
    expect(built.version).toBe(source.version);
    expect(built.license).toBe("MIT");
    expect(built.type).toBe("module");
    expect(Object.keys(built.exports).sort()).toEqual([".", "./node", "./package.json"]);
    expect(built.bin).toEqual({ "zaisma-game-server": "bin/node.js" });
    for (const file of ["README.md", "LICENSE", "src/index.js", "src/index.d.ts", "bin/node.js", "bin/node.d.ts"]) expect(existsSync(join(DIST_DIR, file)), file).toBe(true);
  });

  it("exports from its index exactly what the repository's public surface exports", async () => {
    const built = await import(pathToFileURL(join(DIST_DIR, "src/index.js")).href);
    expect(Object.keys(built).sort()).toEqual(Object.keys(publicSurface).sort());
  });

  it("prints its usage when started with no arguments", () => {
    let output = "";
    try {
      output = execFileSync(process.execPath, [join(DIST_DIR, "bin/node.js")], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      output = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`;
    }
    expect(output).toContain("--game");
    expect(output).toContain("play-locally");
  });

  it("carries play-locally, with the SDK it serves", () => {
    for (const file of ["bin/local-play.js", "bin/local-play-bench.js", "bin/local-play-runner.js", "bin/local-play.d.ts", "src/qr-code.js", "sdk/zaisma.js", "sdk/zaisma.d.ts", "sdk/saves.js", "sdk/relay.js", "sdk/picture.js", "bench/glass.js", "bench/brand/fonts/OFL.txt", "bench/brand/zaisma-mark-metal.svg"]) expect(existsSync(join(DIST_DIR, file)), file).toBe(true);
    for (const file of ["bin/local-play.js", "bin/local-play-runner.js"]) expect(readFileSync(join(DIST_DIR, file), "utf8"), file).not.toMatch(/\.\.\/src\/[a-z-]+\.ts"/);
  });
});
