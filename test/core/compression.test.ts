import { describe, expect, it } from "vitest";
import { brotliKeyOf, isCompressible, isCompressibleType } from "@zaisma/core";

describe("Brotli copies", () => {
  it("are tried for every file that isn't a page, compressed already or tiny", () => {
    for (const path of ["game.wasm", "Build/game.data", "index.pck", "scene.bin", "levels/one.json"]) expect(isCompressible(path, 2048), path).toBe(true);
    for (const path of ["index.html", "hero.png", "music.ogg", "intro.mp4", "font.woff2"]) expect(isCompressible(path, 2048), path).toBe(false);
    expect(isCompressible("a.js", 500)).toBe(false);
    expect(isCompressibleType("a.js")).toBe(true);
  });

  it("sit beside the file, under its storage key", () => {
    expect(brotliKeyOf(`blobs/${"ab".repeat(32)}`)).toBe(`brotli/blobs/${"ab".repeat(32)}`);
    expect(brotliKeyOf(`owned/owner_1/${"cd".repeat(32)}`)).toBe(`brotli/owned/owner_1/${"cd".repeat(32)}`);
  });
});
