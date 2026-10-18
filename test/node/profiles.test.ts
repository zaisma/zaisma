import { describe, expect, it } from "vitest";
import { playedPeriodOf, readProfileText } from "../../packages/core/src/profiles.ts";

/** What players write on their profile, and the rough times Played shows (docs/DECISIONS.md, "What a profile shows"). */

describe("profiles", () => {
  const adult = { age_band: "18+" as const };
  const teen = { age_band: "16-17" as const };

  it("tidies a name and bio, keeping up to 4 lines of bio", () => {
    expect(readProfileText({ display_name: "  Kit  ", bio: "Line one\r\n\r\n  Line two  " }, teen)).toEqual({ profileText: { display_name: "Kit", bio: "Line one\nLine two", link_urls: [] } });
    expect(readProfileText({ display_name: "", bio: "" }, teen)).toEqual({ profileText: { display_name: null, bio: null, link_urls: [] } });
    expect(readProfileText({ bio: "a\nb\nc\nd\ne" }, teen)).toMatchObject({ field: "bio" });
    expect(readProfileText({ display_name: "x".repeat(31) }, teen)).toMatchObject({ field: "display_name" });
  });

  it("refuses contact details at once, like chat", () => {
    expect(readProfileText({ bio: "add me on discord" }, adult)).toMatchObject({ field: "bio" });
    expect(readProfileText({ display_name: "kit.com" }, adult)).toMatchObject({ field: "display_name" });
  });

  it("takes up to 3 https links, only on 18+ profiles", () => {
    expect(readProfileText({ link_urls: ["instagram.com/kit", "https://kit.itch.io/"] }, adult)).toEqual({ profileText: { display_name: null, bio: null, link_urls: ["https://instagram.com/kit", "https://kit.itch.io/"] } });
    expect(readProfileText({ link_urls: ["https://instagram.com/kit"] }, teen)).toMatchObject({ field: "link_urls" });
    for (const bad of ["http://example.com", "javascript:alert(1)", "https://1.2.3.4/", "https://user:pass@example.com", "localhost"]) {
      expect(readProfileText({ link_urls: [bad] }, adult)).toMatchObject({ field: "link_urls" });
    }
    expect(readProfileText({ link_urls: ["a.com", "b.com", "c.com", "d.com"] }, adult)).toMatchObject({ field: "link_urls" });
  });

  it("says when a game was played only roughly", () => {
    const nowMs = Date.UTC(2026, 9, 17, 12);
    const hoursAgo = (hourCount: number) => nowMs - hourCount * 3600_000;
    expect(playedPeriodOf(hoursAgo(2), nowMs)).toBe("today");
    expect(playedPeriodOf(hoursAgo(30), nowMs)).toBe("this_week");
    expect(playedPeriodOf(hoursAgo(24 * 20), nowMs)).toBe("this_month");
    expect(playedPeriodOf(hoursAgo(24 * 40), nowMs)).toBe("earlier");
  });
});
