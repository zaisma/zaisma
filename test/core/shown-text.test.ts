import { describe, expect, it } from "vitest";
import { checkShownText, hiddenCharacterOf } from "@zaisma/core";

// Shown text (docs/DECISIONS.md, "Stored values safe where they show"): any language and emoji, nothing invisible, nothing that flips direction.

const title = (input: unknown) => checkShownText(input, { field: "title", maximumCharacterCount: 80, isRequired: true });

describe("shown text", () => {
  it("takes any language and emoji, tidied", () => {
    for (const given of ["Sky Hopper", "東方の空", "سماء القفز", "Привет мир", "Café Ünter", "👨‍👩‍👧 Family Run", "🏴󠁧󠁢󠁳󠁣󠁴󠁿 Highland Clash", "मेरा खेल", "❤️ Hearts", "עולם‏ 2"]) {
      expect(title(given), given).toEqual({ text: given });
    }
    expect(title("  Sky \t  Hopper ")).toEqual({ text: "Sky Hopper" });
    // NFC: the same letters always stored the same way.
    expect(title("Café")).toEqual({ text: "Café" });
  });

  it("refuses invisible characters and ones that flip direction, naming the one it found", () => {
    for (const [given, character] of [
      ["Sky‮Hopper", "U+202E"],
      ["Sky⁦Hopper", "U+2066"],
      ["Sky​Hopper", "U+200B"],
      ["Sky⁠Hopper", "U+2060"],
      ["Za­isma", "U+00AD"],
      ["ㅤHopper", "U+3164"],
      ["Sky\u0007Hopper", "U+0007"],
      ["Sky\u{e0041}Hopper", "U+E0041"],
    ]) {
      const checked = title(given);
      expect("problem" in checked && checked.problem.message, given).toContain(character);
      expect("problem" in checked && checked.problem.field).toBe("title");
    }
  });

  it("needs something visible when it's required, and keeps to its length in characters", () => {
    expect("problem" in title("⠀")).toBe(true);
    expect("problem" in title("")).toBe(true);
    expect("problem" in title(42)).toBe(true);
    expect(title("🐉".repeat(80))).toEqual({ text: "🐉".repeat(80) });
    expect("problem" in title("a".repeat(81))).toBe(true);
    expect(checkShownText("", { field: "description", maximumCharacterCount: 500, isMultiline: true })).toEqual({ text: "" });
  });

  it("keeps line breaks and tabs in a block, and nowhere else", () => {
    expect(checkShownText("Fixed:\r\n\t- jumps", { field: "patch_notes", maximumCharacterCount: 100, isMultiline: true })).toEqual({ text: "Fixed:\n\t- jumps" });
    expect(title("Sky\nHopper")).toEqual({ text: "Sky Hopper" });
    expect(hiddenCharacterOf("Fixed:\n\t- jumps")).toBeNull();
  });
});
