import { describe, expect, it } from "vitest";
import { MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT, decodeTexture, encodePng, godotPicturesInside, isGodotPack, isUnityPack, unityPicturesInside, type ByteSource, type PictureFound } from "@zaisma/core";
import { decompressLz4Block } from "../../packages/core/src/scan/lz4.ts";
import { decompressLzma } from "../../packages/core/src/scan/lzma.ts";
import { UNITY_FORMAT, godotPack, lz4Literals, readPng, rgbaPixels, serializedFile, sprite, texture2d, unityBundle, unityWebData, videoClip } from "../engine-packs.ts";

const TEXTURE_2D = 28;
const SPRITE = 213;
const VIDEO_CLIP = 329;

const sourceOf = (bytes: Uint8Array): ByteSource & { readCount: number } => {
  const source = { sizeBytes: bytes.length, readCount: 0, read: async (startIndex: number, sizeBytes: number) => (source.readCount++, bytes.slice(startIndex, startIndex + sizeBytes)) };
  return source;
};
const collect = async (found: AsyncGenerator<PictureFound>) => {
  const all: PictureFound[] = [];
  for await (const item of found) all.push(item);
  return all;
};
const pixelAt = (picture: { widthPixelCount: number; rgba: Uint8Array }, x: number, y: number) => [...picture.rgba.subarray((y * picture.widthPixelCount + x) * 4, (y * picture.widthPixelCount + x) * 4 + 4)];
/** Red counts across, green counts up from the first stored row, so a flip shows. */
const gradient = (widthPixelCount: number, heightPixelCount: number) => rgbaPixels(widthPixelCount, heightPixelCount, (x, y) => [x * 4, y * 4, 200, 255]);
const mp4 = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypisom"), ...new Array(200).fill(1)]);

describe("GPU texture decoding", () => {
  it("decodes raw RGBA with its bottom row first into a picture with its top row first", () => {
    const picture = decodeTexture("rgba8", gradient(64, 64), 64, 64, { isBottomUp: true })!;
    expect(picture.widthPixelCount).toBe(64);
    expect(pixelAt(picture, 0, 0)).toEqual([0, 63 * 4, 200, 255]);
    expect(pixelAt(picture, 5, 63)).toEqual([20, 0, 200, 255]);
  });

  it("decodes BC1, ETC1 and a one-color ASTC block", () => {
    // BC1: color 0 pure red, color 1 pure blue, every pixel index 0 except the last (index 1).
    const bc1 = decodeTexture("bc1", new Uint8Array([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0x40]), 4, 4)!;
    expect(pixelAt(bc1, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(bc1, 3, 3)).toEqual([0, 0, 255, 255]);
    // ETC1, individual mode: both sub-blocks base color 0x88 gray, table 0, every pixel +2.
    const etc1 = decodeTexture("etc1", new Uint8Array([0x88, 0x88, 0x88, 0x00, 0, 0, 0, 0]), 4, 4)!;
    expect(pixelAt(etc1, 2, 1)).toEqual([0x8a, 0x8a, 0x8a, 255]);
    // ASTC void-extent block: one 8-bit color.
    const astc = decodeTexture("astc_6x6", new Uint8Array([0xfc, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0, 10, 0, 20, 0, 30, 0, 40]), 6, 6)!;
    expect(pixelAt(astc, 5, 5)).toEqual([10, 20, 30, 40]);
  });

  it("shrinks a big texture to at most the sent size, and crops a region", () => {
    const wide = decodeTexture("rgba8", rgbaPixels(2048, 8, () => [9, 9, 9, 255]), 2048, 8)!;
    expect(wide.widthPixelCount).toBe(MAXIMUM_SENT_PICTURE_SIDE_PIXEL_COUNT);
    expect(wide.heightPixelCount).toBe(4);
    const crop = decodeTexture("rgba8", gradient(64, 64), 64, 64, { region: { columnIndex: 8, rowIndex: 16, widthPixelCount: 4, heightPixelCount: 4 } })!;
    expect(crop.widthPixelCount).toBe(4);
    expect(pixelAt(crop, 0, 0)).toEqual([32, 64, 200, 255]);
    expect(decodeTexture("rgba8", gradient(8, 8), 8, 8, { region: { columnIndex: 6, rowIndex: 0, widthPixelCount: 4, heightPixelCount: 4 } })).toBeNull();
  });

  it("writes a PNG that reads back to the same pixels", async () => {
    const picture = decodeTexture("rgba8", gradient(40, 40), 40, 40)!;
    const png = await encodePng(picture);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await readPng(png)).toEqual(picture);
  });
});

describe("Unity bundle compression", () => {
  it("unpacks LZ4 literals and matches, and refuses a broken block", () => {
    expect(new TextDecoder().decode(decompressLz4Block(lz4Literals(new TextEncoder().encode("a long enough line of text")), 26))).toBe("a long enough line of text");
    // "abcd", then 8 bytes copied from 4 back, then "xyz".
    expect(new TextDecoder().decode(decompressLz4Block(new Uint8Array([0x44, 97, 98, 99, 100, 4, 0, 0x30, 120, 121, 122]), 15))).toBe("abcdabcdabcdxyz");
    expect(() => decompressLz4Block(new Uint8Array([0x44, 97, 98, 99, 100, 9, 0]), 15)).toThrow();
  });

  it("unpacks LZMA as Unity stores it, and refuses broken data", () => {
    const packed = Uint8Array.from(
      atob(
        "XQAAgAAALRhJJ2biK0MRBIIcmKTciKBLXY+QE2ZfStPkgS+SecekImc/4iyN7IV+nzMYnxtZRHtXAUDnA+1k0SVonaWmRNy69BdgFMkF7cqq4+9eobhpfOsyIDrzpL5y1oLbyMds6hoiPoRj59Wro0jM2XRcz936JlaaghZ6pmoQ7CbCfoTPs4B4+BEtNpxfvfsd/0BMxmU04VFXrfCARXoQcZG5/b3BXv7KKsxL1rXB2Kf1ZaqPQoEN2Px1bVD8NIpUhT1tUa0bHL35vVbswSKAAUz5bVV2mNCp9d2OgpbWbTM3c471ggO1Df4e3aoonbK6gDHZNt1Z9lVD2PHliYhCNa5p4XPh//w5wAA=",
      ),
      (character) => character.charCodeAt(0),
    );
    const expected = new Uint8Array([...new TextEncoder().encode("Zaisma texture test. ".repeat(40)), ...Array.from({ length: 256 }, (_, i) => i)]);
    expect(decompressLzma(packed, expected.length)).toEqual(expected);
    expect(() => decompressLzma(packed.subarray(0, 60), expected.length)).toThrow();
  });
});

describe("Pictures inside Unity builds", () => {
  const sheet = gradient(64, 64);
  const assets = serializedFile([
    { classId: TEXTURE_2D, pathId: 101, bytes: texture2d("Hero", 64, 64, UNITY_FORMAT.rgba32, sheet) },
    { classId: TEXTURE_2D, pathId: 102, bytes: texture2d("Sky", 64, 32, UNITY_FORMAT.rgba32, gradient(64, 32), { streamedFrom: { path: "archive:/CAB-1/CAB-1.resS", offset: 16 } }) },
    { classId: TEXTURE_2D, pathId: 103, bytes: texture2d("Mask", 64, 64, UNITY_FORMAT.alpha8, new Uint8Array(64 * 64)) },
    { classId: TEXTURE_2D, pathId: 104, bytes: texture2d("Dot", 16, 16, UNITY_FORMAT.rgba32, gradient(16, 16)) },
    { classId: SPRITE, pathId: 201, bytes: sprite("Hero_0", 101, [0, 32, 32, 32]) },
    { classId: SPRITE, pathId: 202, bytes: sprite("Hero_whole", 101, [0, 0, 64, 64]) },
    { classId: VIDEO_CLIP, pathId: 301, bytes: videoClip("Intro", "archive:/CAB-1/CAB-1.resource", 8, mp4.length) },
  ]);
  const resS = new Uint8Array([...new Uint8Array(16), ...gradient(64, 32)]);
  const resource = new Uint8Array([...new Uint8Array(8), ...mp4]);
  const pngInside = encodePng({ widthPixelCount: 64, heightPixelCount: 64, rgba: rgbaPixels(64, 64, (x, y) => [(x * 73 + y * 151) % 256, (x * y * 31) % 256, (x + y * 7) % 256, 255]) });
  const bundle = async () => unityBundle([
    { name: "CAB-1", bytes: assets },
    { name: "CAB-1.resS", bytes: resS },
    { name: "CAB-1.resource", bytes: resource },
    { name: "CAB-1.notes", bytes: new Uint8Array([...new Uint8Array(500), ...(await pngInside), ...new Uint8Array(500)]) },
  ]);
  const build = async () =>
    unityWebData([
      { name: "boot.config", bytes: new TextEncoder().encode("gfx-enable-gfx-jobs=1") },
      { name: "data.unity3d", bytes: await bundle() },
    ]);

  it("finds every texture, the part of a sheet each sprite shows, videos, and picture files in compressed bundles", async () => {
    expect(isUnityPack(await build())).toBe(true);
    const found = await collect(unityPicturesInside(sourceOf(await build())));
    expect(found.map((item) => `${item.label} ${item.type}`)).toEqual(['texture "Hero" image/png', 'texture "Sky" image/png', 'sprite "Hero_0" image/png', 'video "Intro" video/mp4', "picture 1 in CAB-1.notes image/png"]);
    const hero = await readPng(await found[0]!.body());
    expect(pixelAt(hero, 0, 0)).toEqual([0, 63 * 4, 200, 255]);
    const sky = await readPng(await found[1]!.body());
    expect([sky.widthPixelCount, sky.heightPixelCount]).toEqual([64, 32]);
    const crop = await readPng(await found[2]!.body());
    expect([crop.widthPixelCount, crop.heightPixelCount]).toEqual([32, 32]);
    expect(pixelAt(crop, 0, 31)).toEqual([0, 32 * 4, 200, 255]);
    expect(await found[3]!.body()).toEqual(mp4);
    expect(await found[4]!.body()).toEqual(await pngInside);
  });

  it("names each texture by its pixels, so the same texture in another build is known", async () => {
    const first = await collect(unityPicturesInside(sourceOf(await build())));
    const again = await collect(unityPicturesInside(sourceOf(unityBundle([{ name: "CAB-9", bytes: serializedFile([{ classId: TEXTURE_2D, pathId: 5, bytes: texture2d("Renamed", 64, 64, UNITY_FORMAT.rgba32, sheet) }]) }], { isCompressed: false }))));
    expect(again.map((item) => item.label)).toEqual(['texture "Renamed"']);
    expect(again[0]!.sha256).toBe(first[0]!.sha256);
    const changed = await collect(unityPicturesInside(sourceOf(unityBundle([{ name: "CAB-9", bytes: serializedFile([{ classId: TEXTURE_2D, pathId: 5, bytes: texture2d("Hero", 64, 64, UNITY_FORMAT.rgba32, gradient(64, 64).fill(1, 0, 4)) }]) }]))));
    expect(changed[0]!.sha256).not.toBe(first[0]!.sha256);
  });

  it("skips a texture whose data doesn't fit its size, and passes what isn't a Unity pack", async () => {
    const misread = texture2d("Broken", 64, 64, UNITY_FORMAT.rgba32, gradient(64, 64));
    new DataView(misread.buffer).setInt32(28, 1000, true); // Its whole data size.
    expect(await collect(unityPicturesInside(sourceOf(unityBundle([{ name: "CAB-2", bytes: serializedFile([{ classId: TEXTURE_2D, pathId: 1, bytes: misread }]) }]))))).toEqual([]);
    const notUnity = new Uint8Array(4000).fill(7);
    expect(isUnityPack(notUnity)).toBe(false);
    expect(await collect(unityPicturesInside(sourceOf(notUnity)))).toEqual([]);
    const whole = await build();
    const cut = whole.slice(0, whole.length - 3000);
    await expect(collect(unityPicturesInside(sourceOf(cut)))).resolves.toBeInstanceOf(Array);
  });
});

describe("Pictures inside Godot packs", () => {
  it("finds Godot 4 and Godot 3 textures, decoded top row first", async () => {
    const pack = godotPack([
      { version: 4, widthPixelCount: 32, heightPixelCount: 32, format: 5, pixels: gradient(32, 32) },
      { version: 3, widthPixelCount: 32, heightPixelCount: 32, format: 17, pixels: new Uint8Array(64 * 8).fill(0).map((_, i) => (i % 8 === 1 ? 0xf8 : 0)) },
      { version: 4, widthPixelCount: 8, heightPixelCount: 8, format: 5, pixels: gradient(8, 8) },
    ]);
    expect(isGodotPack(pack)).toBe(true);
    const found = await collect(godotPicturesInside(sourceOf(pack)));
    expect(found.map((item) => item.label)).toEqual(["texture 1", "texture 2"]);
    const first = await readPng(await found[0]!.body());
    expect(pixelAt(first, 3, 0)).toEqual([12, 0, 200, 255]);
    const second = await readPng(await found[1]!.body());
    expect(pixelAt(second, 0, 0)).toEqual([255, 0, 0, 255]);
  });
});
