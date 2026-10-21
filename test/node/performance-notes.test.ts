import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSET_NOTE_LIMITS, assetHeadSizes, audioDurationSec, findAssetNotes, imageSizePx, type AssetFile } from "../../packages/cli/performance.mjs";
import { checkGameFiles } from "../../packages/cli/check.mjs";

/**
 * The asset notes (packages/cli/performance.mjs): files that could be much smaller, each with about what it saves
 * and the fix, the same in `zaisma check`, check_game and the run in Chrome after upload. Files are made up here:
 * only their first bytes and their sizes matter.
 */

const ROOT = join(import.meta.dirname, "../..");
const MEGABYTE_BYTES = 1024 * 1024;

const bytesOf = (...parts: (number[] | string | Uint8Array)[]) => {
  const chunks = parts.map((part) => (typeof part === "string" ? new TextEncoder().encode(part) : part instanceof Uint8Array ? part : Uint8Array.from(part)));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let index = 0;
  for (const chunk of chunks) {
    out.set(chunk, index);
    index += chunk.length;
  }
  return out;
};
const uint32 = (number: number, isLittleEndian = false) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, number, isLittleEndian);
  return bytes;
};
const uint16 = (number: number, isLittleEndian = false) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, number, isLittleEndian);
  return bytes;
};
const png = (widthPx: number, heightPx: number) => bytesOf([0x89], "PNG\r\n\x1a\n", uint32(13), "IHDR", uint32(widthPx), uint32(heightPx), [8, 6, 0, 0, 0]);
const jpeg = (widthPx: number, heightPx: number) => bytesOf([0xff, 0xd8, 0xff, 0xe0], uint16(16), "JFIF\0", new Uint8Array(9), [0xff, 0xc0], uint16(17), [8], uint16(heightPx), uint16(widthPx), [3], new Uint8Array(9));
const webpLossless = (widthPx: number, heightPx: number) => bytesOf("RIFF", uint32(100, true), "WEBPVP8L", uint32(50, true), [0x2f], uint32((widthPx - 1) | ((heightPx - 1) << 14), true), new Uint8Array(8));
const wav = (dataSizeBytes: number, byteRate = 176_400) => bytesOf("RIFF", uint32(dataSizeBytes + 36, true), "WAVE", "fmt ", uint32(16, true), uint16(1, true), uint16(2, true), uint32(44_100, true), uint32(byteRate, true), uint16(4, true), uint16(16, true), "data", uint32(dataSizeBytes, true));
/** AIFF with 44.1 kHz written as an 80-bit extended number. */
const aiff = (frameCount: number) => bytesOf("FORM", uint32(1000), "AIFF", "COMM", uint32(18), uint16(2), uint32(frameCount), uint16(16), [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
const glb = (json: object) => {
  const jsonText = JSON.stringify(json);
  return bytesOf("glTF", uint32(2, true), uint32(1000, true), uint32(jsonText.length, true), "JSON", jsonText);
};

const file = (path: string, sizeBytes: number, headBytes: Uint8Array | null = null, contentText: string | null = null): AssetFile => ({ path, sizeBytes, contentText, headBytes });
const WEBGL_GAME = file("game.js", 2000, null, "const gl = canvas.getContext('webgl2');");
const textures = (count: number, sizeBytes: number) => Array.from({ length: count }, (_, i) => file(`textures/rock-${i}.png`, sizeBytes, png(2048, 2048)));

describe("the asset notes", () => {
  it("read images' sizes and sounds' lengths from their first bytes", () => {
    expect(imageSizePx(png(2048, 1024))).toEqual({ widthPx: 2048, heightPx: 1024 });
    expect(imageSizePx(jpeg(4096, 2048))).toEqual({ widthPx: 4096, heightPx: 2048 });
    expect(imageSizePx(webpLossless(1000, 500))).toEqual({ widthPx: 1000, heightPx: 500 });
    expect(imageSizePx(bytesOf("not an image at all, just words"))).toBeNull();
    expect(audioDurationSec(wav(176_400 * 60), 176_400 * 60 + 44)).toBeCloseTo(60);
    expect(audioDurationSec(aiff(44_100 * 30), 10 * MEGABYTE_BYTES)).toBeCloseTo(30);
  });

  it("ask for the first bytes of what they read, and a .gltf whole", () => {
    const sizes = assetHeadSizes([
      { path: "big.png", sizeBytes: 2 * MEGABYTE_BYTES },
      { path: "icon.png", sizeBytes: 2000 },
      { path: "music.wav", sizeBytes: 9 * MEGABYTE_BYTES },
      { path: "scene.gltf", sizeBytes: 300_000 },
      { path: "scene.bin", sizeBytes: 9 * MEGABYTE_BYTES },
    ]);
    expect([...sizes]).toEqual([["big.png", 65_536], ["music.wav", 65_536], ["scene.gltf", 300_000]]);
  });

  it("say a WebGL game's big textures could be KTX2, with the estimate, and nothing for a game without WebGL", () => {
    // 2048×2048 at about 2 bits a pixel with mipmaps is about 1.33 MB each.
    const notes = findAssetNotes([WEBGL_GAME, ...textures(20, 5 * MEGABYTE_BYTES)]);
    expect(notes).toHaveLength(1);
    const estimatedSizeBytes = 20 * Math.round(2048 * 2048 * ASSET_NOTE_LIMITS.ktx2BytesPerPixel);
    expect(notes[0]).toEqual({
      code: "images_could_be_ktx2",
      message: "100 MB of PNG, JPEG and WebP textures could be about 27 MB as KTX2, and use about a quarter of the graphics memory.",
      path: null,
      saved_size_bytes: 100 * MEGABYTE_BYTES - estimatedSizeBytes,
      fix: expect.stringContaining("KTX2Loader"),
    });
    expect(findAssetNotes([file("game.js", 2000, null, "ctx = canvas.getContext('2d');"), ...textures(20, 5 * MEGABYTE_BYTES)])).toEqual([]);
    // The run in Chrome says what the game drew with, whatever its code says.
    expect(findAssetNotes([file("game.js", 2000, null, "ctx = canvas.getContext('2d');"), ...textures(20, 5 * MEGABYTE_BYTES)], { isDrawnWithGpu: true })).toHaveLength(1);
    // Textures KTX2 wouldn't halve, or too few to matter, say nothing.
    expect(findAssetNotes([WEBGL_GAME, ...textures(20, 1.2 * MEGABYTE_BYTES)])).toEqual([]);
    expect(findAssetNotes([WEBGL_GAME, ...textures(3, 5 * MEGABYTE_BYTES)])).toEqual([]);
    // An image whose first bytes weren't read is left out.
    expect(findAssetNotes([WEBGL_GAME, ...textures(20, 5 * MEGABYTE_BYTES).map((texture) => ({ ...texture, headBytes: null }))])).toEqual([]);
  });

  it("say WAV and AIFF audio could be Ogg Opus, by its length", () => {
    const dataSizeBytes = 10 * MEGABYTE_BYTES;
    const [note] = findAssetNotes([file("music/theme.wav", dataSizeBytes + 44, wav(dataSizeBytes))]);
    const estimatedSizeBytes = Math.round((dataSizeBytes / 176_400) * ASSET_NOTE_LIMITS.opusBytesPerSec);
    expect(note).toMatchObject({ code: "audio_could_be_opus", path: "music/theme.wav", message: "10 MB of WAV and AIFF audio could be about 1 MB as Ogg Opus.", saved_size_bytes: dataSizeBytes + 44 - estimatedSizeBytes });
    expect(note!.fix).toContain("libopus");
    expect(note!.fix).toContain(".m4a");
    expect(findAssetNotes([file("click.wav", 50_000, wav(49_956))])).toEqual([]);
  });

  it("say glTF models without mesh compression could be smaller, counting the .bin files a .gltf names", () => {
    const [plain] = findAssetNotes([file("models/city.glb", 10 * MEGABYTE_BYTES, glb({ asset: { version: "2.0" } }))]);
    expect(plain).toMatchObject({ code: "models_could_be_smaller", path: "models/city.glb", message: "10 MB of glTF models have no mesh compression.", saved_size_bytes: null });
    expect(findAssetNotes([file("models/city.glb", 10 * MEGABYTE_BYTES, glb({ asset: { version: "2.0" }, extensionsUsed: ["EXT_meshopt_compression"] }))])).toEqual([]);
    expect(findAssetNotes([file("models/city.glb", 10 * MEGABYTE_BYTES, glb({ asset: { version: "2.0" }, extensionsUsed: ["KHR_draco_mesh_compression"] }))])).toEqual([]);
    const gltf = JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "city%20data.bin", byteLength: 9 }] });
    const [split] = findAssetNotes([file("models/city.gltf", gltf.length, new TextEncoder().encode(gltf)), file("models/city data.bin", 9 * MEGABYTE_BYTES)]);
    expect(split).toMatchObject({ code: "models_could_be_smaller", path: "models/city.gltf" });
  });

  it("find Godot's debug export, and not its release export or the other samples", () => {
    const debugLoader = readFileSync(join(ROOT, "test/engines/godot/debug-loader.js"), "utf8");
    const [note] = findAssetNotes([file("index.js", debugLoader.length, null, debugLoader)]);
    expect(note).toEqual({ code: "development_build", message: "This is a Godot development build: bigger and slower for players.", path: "index.js", saved_size_bytes: null, fix: "Untick Export With Debug in the export dialog and export again." });
    // From its first bytes too, as the run reads a loader from storage.
    expect(findAssetNotes([file("index.js", debugLoader.length, new TextEncoder().encode(debugLoader).subarray(0, 65_536))])[0]?.code).toBe("development_build");
    for (const loader of ["godot/build/index.js", "unity/build/Build/build.loader.js", "three/build/index.html"]) {
      const text = readFileSync(join(ROOT, "test/engines", loader), "utf8");
      expect(findAssetNotes([file(loader, text.length, null, text)]), loader).toEqual([]);
    }
  });

  it("come with the game check, never as problems", () => {
    const debugLoader = readFileSync(join(ROOT, "test/engines/godot/debug-loader.js"), "utf8");
    const answer = checkGameFiles([
      { path: "index.html", sizeBytes: 50, contentText: '<!doctype html><script src="index.js"></script>' },
      { path: "index.js", sizeBytes: debugLoader.length, contentText: debugLoader },
      { path: "index.wasm", sizeBytes: 50_000_000, contentText: null },
    ]);
    expect(answer.performance_notes.map((note) => note.code)).toEqual(["development_build"]);
    expect(answer.problems.map((problem) => problem.code)).not.toContain("development_build");
  });
});
