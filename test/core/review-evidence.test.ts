import { describe, expect, it } from "vitest";
import { REVIEW_LIMITS, changedRegions, chunkText, contentPieces, isSameItem, isTweak, keepQuotedItems, reviewCostCents, type EvidenceItem } from "@zaisma/core";
import { minifiedBundle } from "../helpers.ts";

const item = (fields: Partial<EvidenceItem>): EvidenceItem => ({ kind: "connects_to", subject: "api.example.invalid", detail: "d", path: "game.js", quote: "", file_sha256: "", source: "reader", ...fields });

describe("chunkText", () => {
  it("cuts 500,000 characters into three overlapping pieces", () => {
    const text = Array.from({ length: 500_000 }, (_, index) => String.fromCharCode(97 + (index % 26))).join("");
    const pieces = chunkText(text);
    expect(pieces).toHaveLength(3);
    expect(pieces.every((piece) => piece.length <= REVIEW_LIMITS.readerChunkCharacterCount)).toBe(true);
    const overlap = REVIEW_LIMITS.readerChunkOverlapCharacterCount;
    expect(pieces[1]!.slice(0, overlap)).toBe(pieces[0]!.slice(-overlap));
    expect(pieces.at(-1)!.endsWith(text.slice(-1000))).toBe(true);
    expect(chunkText("short")).toEqual(["short"]);
  });
});

describe("contentPieces and changedRegions", () => {
  const bundle = minifiedBundle(3_000_000);
  const edited = (text: string, atIndex: number, replacement: string) => text.slice(0, atIndex) + replacement + text.slice(atIndex + replacement.length);

  it("keeps the same boundaries away from an edit, within the piece sizes", async () => {
    const pieces = await contentPieces(bundle);
    expect(pieces[0]!.startIndex).toBe(0);
    expect(pieces.at(-1)!.endIndex).toBe(bundle.length);
    for (const [index, piece] of pieces.entries()) {
      if (index > 0) expect(piece.startIndex).toBe(pieces[index - 1]!.endIndex);
      if (index < pieces.length - 1) expect(piece.endIndex - piece.startIndex).toBeGreaterThanOrEqual(REVIEW_LIMITS.changedPieceMinimumCharacterCount);
      expect(piece.endIndex - piece.startIndex).toBeLessThanOrEqual(REVIEW_LIMITS.changedPieceMaximumCharacterCount);
    }
    const averageCharacterCount = bundle.length / pieces.length;
    expect(averageCharacterCount).toBeGreaterThan(REVIEW_LIMITS.changedPieceAverageCharacterCount / 2);
    expect(averageCharacterCount).toBeLessThan(REVIEW_LIMITS.changedPieceAverageCharacterCount * 2);

    // An edit near the start, and one inserted characters later: the boundaries far from it stay, only shifted.
    const after = await contentPieces(`${bundle.slice(0, 1000)}let extra = 42;${bundle.slice(1000)}`);
    const farEnds = new Set(pieces.filter((piece) => piece.startIndex > 100_000).map((piece) => piece.endIndex + "let extra = 42;".length));
    const afterFar = after.filter((piece) => piece.startIndex > 100_100);
    expect(afterFar.length).toBeGreaterThan(0);
    expect(afterFar.every((piece) => farEnds.has(piece.endIndex))).toBe(true);
  });

  it("finds one small region for a 20-character edit in a 3 MB one-line bundle", async () => {
    const regions = await changedRegions(bundle, edited(bundle, 1_500_000, "fetch('x.invalid');;"));
    expect(regions).toHaveLength(1);
    expect(regions[0]!.endIndex - regions[0]!.startIndex).toBeLessThan(40_000);
    expect(regions[0]!.startIndex).toBeLessThan(1_500_000 - REVIEW_LIMITS.changedRegionContextCharacterCount);
    expect(regions[0]!.endIndex).toBeGreaterThan(1_500_020 + REVIEW_LIMITS.changedRegionContextCharacterCount);
  });

  it("finds nothing in an unchanged text, and all of a rewritten one", async () => {
    expect(await changedRegions(bundle, bundle)).toEqual([]);
    const rewritten = minifiedBundle(200_000, 7);
    expect(await changedRegions(minifiedBundle(200_000, 3), rewritten)).toEqual([{ startIndex: 0, endIndex: rewritten.length }]);
    expect(await changedRegions("", "short")).toEqual([{ startIndex: 0, endIndex: 5 }]);
  });
});

describe("keepQuotedItems", () => {
  const files = new Map([["game.js", "const socket = new WebSocket(host +\n  'relay');"]]);
  it("keeps items whose quote is in their file, whitespace aside, and check items and pictures as they are", () => {
    const kept = [item({ quote: "new WebSocket(host + 'relay')" }), item({ source: "check", quote: "anything" }), item({ kind: "content", subject: "sexual", path: "art/a.png", quote: "" })];
    expect(keepQuotedItems(kept, files)).toEqual(kept);
  });
  it("drops an item whose quote isn't in its file, or that has no quote for code", () => {
    expect(keepQuotedItems([item({ quote: "prompt('email')" }), item({ quote: "" }), item({ path: "other.js", quote: "x" })], files)).toEqual([]);
  });
});

describe("isTweak", () => {
  const judged = [item({}), item({ kind: "player_text", subject: "shown_locally" }), item({ kind: "content", subject: "allowed_content" })];
  it("is a tweak with the same kinds and subjects, whatever the quotes and paths", () => {
    expect(isTweak([item({ path: "bundle.js", quote: "changed" }), item({ kind: "content", subject: "allowed_content" })], judged)).toBe(true);
    expect(isTweak([], judged)).toBe(true);
  });
  it("isn't with a new player_text subject, a new content subject or a protection attempt", () => {
    expect(isTweak([item({ kind: "player_text", subject: "read_by_others" })], judged)).toBe(false);
    expect(isTweak([item({ kind: "content", subject: "crypto" })], judged)).toBe(false);
    expect(isTweak([item({ kind: "protection_attempt", subject: "link_without_tap" })], judged)).toBe(false);
  });
  it("compares links and addresses by kind alone, so a new host or a registered link never costs a judged review", () => {
    expect(isTweak([item({ subject: "new.example.invalid" })], judged)).toBe(true);
    expect(isTweak([item({ kind: "opens_link", subject: "discord" })], [item({ kind: "opens_link", subject: "discord.example.invalid" })])).toBe(true);
    expect(isTweak([item({ kind: "opens_link", subject: "discord" })], judged)).toBe(false);
  });
  it("passes the fix for a hold when it adds nothing and no longer has what the hold stood on", () => {
    const held = [item({ kind: "protection_attempt", subject: "link_without_tap" }), item({ kind: "opens_link", subject: "shop.example.invalid" }), item({ kind: "player_text", subject: "read_by_others" })];
    expect(isTweak([item({ kind: "opens_link", subject: "shop" })], held, true)).toBe(true);
    expect(isTweak([item({ kind: "protection_attempt", subject: "link_without_tap" })], held, true)).toBe(false);
    expect(isTweak([item({ kind: "player_text", subject: "read_by_others" })], held, true)).toBe(false);
    expect(isTweak([item({ kind: "asks_player", subject: "email" })], [...held, item({ kind: "asks_player", subject: "email" })], true)).toBe(false);
    expect(isTweak([item({ kind: "content", subject: "crypto" })], held, true)).toBe(false);
  });
});

describe("isSameItem", () => {
  it("is the same item only with the same kind, subject, path and quote", () => {
    expect(isSameItem(item({}), item({ detail: "Said another way.", file_sha256: "other" }))).toBe(true);
    expect(isSameItem(item({}), item({ path: "other.js" }))).toBe(false);
    expect(isSameItem(item({}), item({ quote: "another line" }))).toBe(false);
    expect(isSameItem(item({}), item({ subject: "other.example.invalid" }))).toBe(false);
  });
});

describe("reviewCostCents", () => {
  const usage = { inputTokenCount: 1_000_000, outputTokenCount: 100_000, cacheReadTokenCount: 1_000_000, cacheWriteTokenCount: 0 };
  it("prices each model in cents, and an unknown one as Opus", () => {
    expect(reviewCostCents("claude-haiku-5-5", usage)).toBeCloseTo(10 + 5 + 1);
    expect(reviewCostCents("claude-sonnet-5-5", usage)).toBeCloseTo(200 + 100 + 20);
    expect(reviewCostCents("claude-opus-5-5", usage)).toBeCloseTo(400 + 200 + 20);
    expect(reviewCostCents("claude-next", usage)).toBeCloseTo(reviewCostCents("claude-opus-5-5", usage));
    expect(reviewCostCents("claude-sonnet-5-5", { inputTokenCount: 0, outputTokenCount: 0, cacheReadTokenCount: 0, cacheWriteTokenCount: 1_000_000 })).toBeCloseTo(250);
  });
});
