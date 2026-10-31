import { afterEach, describe, expect, it, vi } from "vitest";
import { TRUSTED_LINK_DOMAINS, canOpenLink, checkLinkSites, checkLinks, isTrustedLinkHost, linkAudience, openedLinkUrl, type GameLink } from "@zaisma/core";

// Registered links (docs/DECISIONS.md, "Games open outside links only through Zaisma"): what a game's
// list takes, who each link opens for, and the address a game can open under one.

const link = (destinationUrl: string, change: Partial<GameLink> = {}): GameLink => ({ link_name: "store", destination_url: destinationUrl, is_on_game_page: false, review_reason: null, checked_at_ms: null, ...change });
const problemOf = (given: unknown) => {
  const checked = checkLinks(given);
  return "problem" in checked ? checked.problem : null;
};

afterEach(() => vi.unstubAllGlobals());

describe("a game's list of links", () => {
  it("takes up to 20 named https addresses, tidied", () => {
    const checked = checkLinks([
      { link_name: "store", destination_url: " https://Kit.itch.io/sky-hopper ", is_on_game_page: true },
      { link_name: "discord_server", destination_url: "https://discord.gg/skyhopper", is_on_game_page: false },
    ]);
    expect(checked).toEqual({
      links: [
        { link_name: "store", destination_url: "https://kit.itch.io/sky-hopper", is_on_game_page: true, review_reason: null, checked_at_ms: null },
        { link_name: "discord_server", destination_url: "https://discord.gg/skyhopper", is_on_game_page: false, review_reason: null, checked_at_ms: null },
      ],
    });
    expect(checkLinks([])).toEqual({ links: [] });
  });

  it("refuses shorteners, IP addresses, user names, plain http, Zaisma's own domains and more, saying where", () => {
    const at = (destinationUrl: unknown) => problemOf([{ link_name: "store", destination_url: destinationUrl, is_on_game_page: true }])?.field;
    for (const destinationUrl of ["https://bit.ly/3xYz", "https://www.tinyurl.com/abc", "https://203.0.113.9/buy", "https://[2001:db8::1]/", "https://kit@evil.example/", "https://kit:hunter2@kit.itch.io/", "http://kit.itch.io/", "kit.itch.io/sky-hopper", "https://localhost/", "https://zaisma.com/g/sky-hopper", "https://sky-hopper.zaismausercontent.com/", `https://example.com/${"a".repeat(500)}`, 42]) {
      expect(at(destinationUrl), String(destinationUrl)).toBe("links[0].destination_url");
    }
    expect(problemOf([{ link_name: "Store", destination_url: "https://kit.itch.io/", is_on_game_page: true }])?.field).toBe("links[0].link_name");
    expect(problemOf([{ link_name: "store", destination_url: "https://kit.itch.io/", is_on_game_page: true }, { link_name: "store", destination_url: "https://ko-fi.com/kit", is_on_game_page: true }])?.field).toBe("links[1].link_name");
    expect(problemOf([{ link_name: "store", destination_url: "https://kit.itch.io/", is_on_game_page: "yes" }])?.field).toBe("links[0].is_on_game_page");
    expect(problemOf([{ link_name: "store", destination_url: "https://kit.itch.io/" }])?.field).toBe("links[0].is_on_game_page");
    expect(problemOf([{ link_name: "store", destination_url: "https://kit.itch.io/", is_on_game_page: true, title: "Store" }])?.field).toBe("links[0].title");
    expect(problemOf({ store: "https://kit.itch.io/" })?.field).toBe("links");
    expect(problemOf(Array.from({ length: 21 }, (_, i) => ({ link_name: `link_${i}`, destination_url: "https://kit.itch.io/", is_on_game_page: false })))?.field).toBe("links");
  });
});

describe("who a link opens for", () => {
  it("everyone on a trusted store, payment or video site, signed-in adults anywhere else once the developer's standing opens it, nobody when flagged", () => {
    for (const destinationUrl of ["https://kit.itch.io/sky-hopper", "https://www.patreon.com/kit", "https://ko-fi.com/kit", "https://store.steampowered.com/app/1", "https://buy.stripe.com/abc", "https://www.youtube.com/watch?v=1"]) {
      expect(linkAudience(link(destinationUrl), false), destinationUrl).toBe("everyone");
    }
    for (const destinationUrl of ["https://discord.gg/skyhopper", "https://t.me/skyhopper", "https://www.instagram.com/kit", "https://steamcommunity.com/id/kit", "https://skyhopper.example/", "https://notitch.io/"]) {
      expect(linkAudience(link(destinationUrl), true), destinationUrl).toBe("signed_in_adults");
      expect(linkAudience(link(destinationUrl), false), destinationUrl).toBe("waiting_for_standing");
    }
    const flagged = link("https://kit.itch.io/", { review_reason: { code: "link_flagged", message: "Listed.", content_rule: "malware" } });
    expect(linkAudience(flagged, true)).toBe("nobody");
    expect(canOpenLink(flagged, true, true)).toBe(false);
    expect(canOpenLink(link("https://discord.gg/skyhopper"), true, true)).toBe(true);
    expect(canOpenLink(link("https://discord.gg/skyhopper"), true, false)).toBe(false);
    expect(canOpenLink(link("https://discord.gg/skyhopper"), false, true)).toBe(false);
    expect(canOpenLink(link("https://kit.itch.io/"), false, false)).toBe(true);
  });

  it("never trusts a chat app or a social network with private messages", () => {
    for (const host of ["discord.com", "discord.gg", "telegram.org", "t.me", "whatsapp.com", "wa.me", "snapchat.com", "instagram.com", "tiktok.com", "twitch.tv", "x.com", "facebook.com", "reddit.com", "steamcommunity.com"]) {
      expect(isTrustedLinkHost(host), host).toBe(false);
      expect(isTrustedLinkHost(`www.${host}`), host).toBe(false);
    }
    expect(TRUSTED_LINK_DOMAINS.every((domain) => domain === domain.toLowerCase() && !domain.includes("/"))).toBe(true);
  });
});

describe("the address a game opens under a link", () => {
  it("adds a path under the link's and query parameters beside its own", () => {
    expect(openedLinkUrl(link("https://kit.itch.io/sky-hopper"), "/buy", { item: "sword", player: "player_8f3k2m" })).toEqual({ url: "https://kit.itch.io/sky-hopper/buy?item=sword&player=player_8f3k2m" });
    expect(openedLinkUrl(link("https://kit.itch.io/sky-hopper/"), "/buy/", null)).toEqual({ url: "https://kit.itch.io/sky-hopper/buy/" });
    expect(openedLinkUrl(link("https://store.example/"), "/items/sword", null)).toEqual({ url: "https://store.example/items/sword" });
    expect(openedLinkUrl(link("https://www.patreon.com/join/kit?tier=1"), null, { from: "game" })).toEqual({ url: "https://www.patreon.com/join/kit?tier=1&from=game" });
    expect(openedLinkUrl(link("https://kit.itch.io/sky-hopper"), undefined, undefined)).toEqual({ url: "https://kit.itch.io/sky-hopper" });
  });

  it("never leaves the link's site or path, or changes what its address sets", () => {
    const base = link("https://kit.itch.io/sky-hopper?tier=1");
    for (const path of ["/../other-game", "/%2e%2e/other-game", "/./buy", "buy", "//evil.example/", "/buy?item=sword", "/buy#top", "/a\\b", "/a//b", 7, `/${"a".repeat(500)}`]) {
      expect(openedLinkUrl(base, path, null), String(path)).toMatchObject({ code: "bad_link_path" });
    }
    for (const query of [{ tier: "2" }, { item: 3 }, ["item", "sword"], "item=sword", { "": "x" }, Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]))]) {
      expect(openedLinkUrl(base, null, query), JSON.stringify(query)).toMatchObject({ code: "bad_link_query" });
    }
  });
});

describe("checking a link's site", () => {
  const answers = new Map<string, unknown>();
  const asked: string[] = [];
  const stubDns = () =>
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const host = url.searchParams.get("name")!;
      asked.push(host);
      const answer = answers.get(host);
      if (answer === "down") return new Response("", { status: 502 });
      return Response.json({ Status: 0, Answer: [{ name: host, type: 1, TTL: 60, data: answer === "listed" ? "0.0.0.0" : "93.184.216.34" }] });
    });

  it("flags a site Cloudflare lists, asks each host once, and keeps what it had when Cloudflare can't answer", async () => {
    stubDns();
    answers.set("evil.example", "listed");
    answers.set("down.example", "down");
    asked.length = 0;
    const links = [link("https://kit.itch.io/a"), link("https://kit.itch.io/b", { link_name: "other" }), link("https://evil.example/", { link_name: "evil" }), link("https://down.example/", { link_name: "down" })];
    const checked = await checkLinkSites(links, [], { dnsUrl: "https://dns.test/dns-query", nowMs: 1000 });
    expect(asked.sort()).toEqual(["down.example", "evil.example", "kit.itch.io"]);
    expect(checked.map((each) => [each.link_name, each.review_reason?.code ?? null, each.checked_at_ms])).toEqual([
      ["store", null, 1000],
      ["other", null, 1000],
      ["evil", "link_flagged", 1000],
      ["down", null, null],
    ]);
    // Unchanged addresses aren't asked again when the list is set, unless it's the daily check.
    asked.length = 0;
    await checkLinkSites(checked, checked, { dnsUrl: "https://dns.test/dns-query", nowMs: 2000 });
    expect(asked).toEqual(["down.example"]);
    asked.length = 0;
    answers.set("evil.example", "down");
    const again = await checkLinkSites(checked, checked, { dnsUrl: "https://dns.test/dns-query", nowMs: 3000, isRecheck: true });
    expect(asked.sort()).toEqual(["down.example", "evil.example", "kit.itch.io"]);
    // Cloudflare can't answer for the flagged site: it stays flagged.
    expect(again.find((each) => each.link_name === "evil")).toMatchObject({ review_reason: { code: "link_flagged" }, checked_at_ms: 1000 });
  });
});
