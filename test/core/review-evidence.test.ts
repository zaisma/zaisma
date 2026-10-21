import { describe, expect, it } from "vitest";
import { REVIEW_LIMITS, chunkText, isSameItem, isTweak, keepQuotedItems, reviewCostCents, type EvidenceItem } from "@zaisma/core";

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
