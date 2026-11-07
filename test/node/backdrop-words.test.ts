import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Words flat on the backdrop stay readable (backdropWords, apps/site/src/components/panes.ts). The backdrop's own picture was measured where those words sit
 * (from a tenth to about two thirds down, the first seven tenths across), and the sums below hold each picture to its measure: change a picture and this
 * fails until it's measured again. A seasonal backdrop gets its own row here before it ships.
 */
const MEASURED_BACKDROPS = [
  { themeName: "light", pictureSha256Start: "76aaf1bc3672b4ed", inkLuminance: 0.008, closestLuminance: 0.381 },
  { themeName: "dark", pictureSha256Start: "6c561440dd9a0671", inkLuminance: 0.946, closestLuminance: 0.051 },
];
/** Large words' floor (WCAG): the line, and what the smaller line has to reach until the light backdrop is calmer under it. */
const LEAST_CONTRAST_RATIO = 3;

const foundations = readFileSync("apps/site/src/components/foundations.ts", "utf8");

describe("words on the backdrop", () => {
  for (const backdrop of MEASURED_BACKDROPS) {
    it(`stay readable on the ${backdrop.themeName} backdrop`, () => {
      const picture = foundations.match(new RegExp(`\\[data-theme-choice="${backdrop.themeName}"\\][^{]*\\{ --own-backdrop-still: url\\(data:image/webp;base64,([^)]+)\\)`))![1]!;
      expect(createHash("sha256").update(picture).digest("hex").slice(0, 16), "The backdrop changed: measure it again, then change this row").toBe(backdrop.pictureSha256Start);
      const lighter = Math.max(backdrop.inkLuminance, backdrop.closestLuminance), darker = Math.min(backdrop.inkLuminance, backdrop.closestLuminance);
      expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(LEAST_CONTRAST_RATIO);
    });
  }

  it("come only from the Backdrop words piece, in its own ink", () => {
    const tokens = readFileSync("apps/site/src/components/tokens.ts", "utf8");
    expect(tokens).toContain("--backdrop-ink: #14171C;");
    expect(tokens).toContain("--backdrop-ink: #F7F9FC;");
  });
});
