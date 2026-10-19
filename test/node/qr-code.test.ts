import { describe, expect, it } from "vitest";
import { linkBrand, qrCodeModules, qrCodeSvg, QR_CODE_LIMITS } from "../../packages/core/src/index.ts";

// The QR encoder behind Share, the dashboard and get_qr_code (packages/core/src/qr-code.ts). Its codes
// were checked against a decoder (jsQR) when it was written; these tests hold the shape every reader
// relies on, so a change that breaks it fails here.

/** Whether the 7 by 7 finder pattern sits with its top left corner at (column, row). */
function hasFinderAt(modules: boolean[][], columnIndex: number, rowIndex: number): boolean {
  for (let rowOffsetIndex = 0; rowOffsetIndex < 7; rowOffsetIndex++) {
    for (let columnOffsetIndex = 0; columnOffsetIndex < 7; columnOffsetIndex++) {
      const ringIndex = Math.max(Math.abs(columnOffsetIndex - 3), Math.abs(rowOffsetIndex - 3));
      if (modules[rowIndex + rowOffsetIndex]![columnIndex + columnOffsetIndex] !== (ringIndex !== 2)) return false;
    }
  }
  return true;
}

describe("QR codes", () => {
  it("pick the smallest version that holds the link, with finder patterns in three corners", () => {
    for (const [text, sideModuleCount] of [
      ["a", 21],
      ["https://zaisma.com/g/sky-hopper", 29],
      ["https://zaisma.com/g/sky-hopper?room=K7PQ2M", 33],
      ["x".repeat(QR_CODE_LIMITS.maximumTextBytes), 57],
    ] as const) {
      const modules = qrCodeModules(text);
      expect(modules).toHaveLength(sideModuleCount);
      expect(modules.every((row) => row.length === sideModuleCount)).toBe(true);
      expect([hasFinderAt(modules, 0, 0), hasFinderAt(modules, sideModuleCount - 7, 0), hasFinderAt(modules, 0, sideModuleCount - 7)]).toEqual([true, true, true]);
      // Timing pattern: alternating modules along row and column 6.
      for (let moduleIndex = 8; moduleIndex < sideModuleCount - 8; moduleIndex++) {
        expect(modules[6]![moduleIndex]).toBe(moduleIndex % 2 === 0);
        expect(modules[moduleIndex]![6]).toBe(moduleIndex % 2 === 0);
      }
    }
  });

  it("are the same for the same text, and different for another", () => {
    expect(qrCodeSvg("https://zaisma.com/g/sky-hopper")).toBe(qrCodeSvg("https://zaisma.com/g/sky-hopper"));
    expect(qrCodeSvg("https://zaisma.com/g/sky-hopper")).not.toBe(qrCodeSvg("https://zaisma.com/g/sky-hoppers"));
  });

  it("draw as an SVG on white with a four-module margin, and refuse text that doesn't fit", () => {
    const svg = qrCodeSvg("https://zaisma.com/g/sky-hopper");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 37 37"/);
    expect(svg).toContain('<rect width="37" height="37" fill="#fff"/>');
    expect(svg).toContain('M4 4h7v1h-7z');
    expect(() => qrCodeModules("x".repeat(QR_CODE_LIMITS.maximumTextBytes + 1))).toThrow(RangeError);
  });
});

describe("developer links' looks", () => {
  it("know each site by its address, and show any other site's address", () => {
    expect(linkBrand("https://store.steampowered.com/app/480/Sky_Hopper/")).toEqual({ brand: "steam", label: "Wishlist on Steam" });
    expect(linkBrand("https://steamcommunity.com/groups/skyhopper")).toEqual({ brand: "steam", label: "Steam" });
    expect(linkBrand("https://emma.itch.io/sky-hopper")).toEqual({ brand: "itch", label: "itch.io" });
    expect(linkBrand("https://discord.gg/skyhopper")).toEqual({ brand: "discord", label: "Discord" });
    expect(linkBrand("https://www.youtube.com/@skyhopper")).toEqual({ brand: "youtube", label: "YouTube" });
    expect(linkBrand("https://twitter.com/skyhopper")).toEqual({ brand: "x", label: "X" });
    expect(linkBrand("https://ko-fi.com/emma")).toEqual({ brand: "kofi", label: "Ko-fi" });
    expect(linkBrand("https://www.skyhopper.dev/press")).toEqual({ brand: "website", label: "skyhopper.dev" });
    // A look-alike domain is just a website.
    expect(linkBrand("https://notdiscord.gg/skyhopper")).toEqual({ brand: "website", label: "notdiscord.gg" });
  });
});
