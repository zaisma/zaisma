import { describe, expect, it } from "vitest";
import { glassTint, pngPixels, toneOfPng } from "../../apps/site/src/background-tone.ts";
import { png } from "./png-stub.ts";

/**
 * A background's tone (apps/site/src/background-tone.ts): its average color and the glass over it, measured from a PNG the way
 * Cloudflare Images and the shader check's browser write them.
 */

describe("a background's tone", () => {
  it("reads a PNG's pixels back exactly, filters undone", async () => {
    const rgba = (await pngPixels(await png(4, 3, (x, y) => [x * 60, y * 90, 200])))!;
    expect([...rgba.subarray(0, 8)]).toEqual([0, 0, 200, 255, 60, 0, 200, 255]);
    expect([...rgba.subarray((1 * 4 + 3) * 4, (1 * 4 + 3) * 4 + 4)]).toEqual([180, 90, 200, 255]);
  });

  it("puts smoked glass over a dark background and light glass over a bright one", async () => {
    const night = (await toneOfPng(await png(32, 18, () => [14, 10, 40])))!;
    expect(night).toMatchObject({ average_color: "#0E0A28", is_glass_smoked: 1 });
    const snow = (await toneOfPng(await png(32, 18, () => [236, 240, 246])))!;
    expect(snow).toMatchObject({ average_color: "#ECF0F6", is_glass_smoked: 0 });
    expect(glassTint(snow)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.\d\d\)$/);
  });

  it("measures the whole picture, never one part of it", async () => {
    // Bright on top, dark below: one choice for all of it.
    const split = (await toneOfPng(await png(20, 20, (_x, y) => (y < 10 ? [240, 240, 240] : [10, 10, 10]))))!;
    expect(split.average_color).toBe("#7D7D7D");
  });

  it("answers null for what isn't a PNG it reads", async () => {
    expect(await toneOfPng(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
