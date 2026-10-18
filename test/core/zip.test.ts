import { describe, expect, it } from "vitest";
import { UploadError, forbiddenContent, listGameFiles, unpackGameFiles } from "@zaisma/core";
import { CLEAN_GAME, makeZip } from "../helpers.ts";

const unpackAll = (zip: Uint8Array) => {
  const entries = listGameFiles(zip);
  return [...unpackGameFiles(zip, entries, 64)].flat();
};

describe("game zips", () => {
  it("accepts a clean game and unpacks every file", () => {
    const files = unpackAll(makeZip(CLEAN_GAME));
    expect(files.map((f) => f.path).sort()).toEqual(["assets/data.json", "game.js", "index.html"]);
  });

  it("strips a single top folder", () => {
    const files = unpackAll(makeZip({ "my-game/index.html": "<p>hi</p>", "my-game/a.js": "1" }));
    expect(files.map((f) => f.path).sort()).toEqual(["a.js", "index.html"]);
  });

  it("drops Mac and Windows junk files", () => {
    const files = unpackAll(makeZip({ ...CLEAN_GAME, "__MACOSX/._index.html": "x", ".DS_Store": "x" }));
    expect(files).toHaveLength(3);
  });

  it("needs index.html", () => {
    expect(() => listGameFiles(makeZip({ "game.js": "1" }))).toThrow(/index\.html/);
  });

  it("rejects disallowed file types", () => {
    expect(() => listGameFiles(makeZip({ ...CLEAN_GAME, "setup.exe": "x" }))).toThrow(/\.exe files/);
    expect(() => listGameFiles(makeZip({ ...CLEAN_GAME, "run.sh": "x" }))).toThrow(UploadError);
  });

  it("rejects pre-compressed builds with a helpful message", () => {
    expect(() => listGameFiles(makeZip({ ...CLEAN_GAME, "Build/game.wasm.gz": "x" }))).toThrow(/Turn off compression/);
  });

  it("rejects a program disguised as an image", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
    expect(() => unpackAll(makeZip({ ...CLEAN_GAME, "sprite.png": exe }))).toThrow(/Windows program/);
  });

  it("rejects nested archives and scripts by content", () => {
    expect(forbiddenContent(makeZip({ a: "1" }))).toMatch(/zip/);
    expect(forbiddenContent(new TextEncoder().encode("#!/bin/sh\nrm -rf /"))).toMatch(/shell script/);
    expect(forbiddenContent(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).toMatch(/Linux/);
    expect(forbiddenContent(new TextEncoder().encode("<!doctype html>"))).toBeNull();
  });

  it("rejects path traversal", () => {
    expect(() => listGameFiles(makeZip({ ...CLEAN_GAME, "../evil.js": "1" }))).toThrow(/Unsafe path/);
    expect(() => listGameFiles(makeZip({ ...CLEAN_GAME, "a/../../evil.js": "1" }))).toThrow(/Unsafe path/);
  });

  it("rejects hidden files", () => {
    expect(() => listGameFiles(makeZip({ ...CLEAN_GAME, ".env.json": "{}" }))).toThrow(/Hidden files/);
  });

  it("rejects too many files", () => {
    const many: Record<string, string> = { "index.html": "x" };
    for (let i = 0; i < 2001; i++) many[`f/${i}.txt`] = "";
    expect(() => listGameFiles(makeZip(many))).toThrow(/limit is 2000/);
  });

  it("rejects files that aren't zips", () => {
    expect(() => listGameFiles(new TextEncoder().encode("not a zip"))).toThrow(/readable zip/);
  });
});
