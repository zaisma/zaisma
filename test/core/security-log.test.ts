import { describe, expect, it } from "vitest";
import { describeSecurityEvent, deviceFor, foldKeyFor, isReadOnlySql, placeSha256For, whereFrom } from "@zaisma/core";

const CHROME_ON_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SAFARI_ON_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
const FIREFOX_ON_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
const EDGE_ON_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
const CHROME_ON_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

describe("deviceFor", () => {
  it("names a browser and its system", () => {
    expect(deviceFor(CHROME_ON_WINDOWS, "you")).toBe("Chrome on a Windows PC");
    expect(deviceFor(SAFARI_ON_IPHONE, "you")).toBe("Safari on an iPhone");
    expect(deviceFor(FIREFOX_ON_LINUX, "you")).toBe("Firefox on a Linux computer");
    expect(deviceFor(EDGE_ON_WINDOWS, "you")).toBe("Edge on a Windows PC");
    expect(deviceFor(CHROME_ON_ANDROID, "you")).toBe("Chrome on an Android phone");
    expect(deviceFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SomethingNew/1.0", "you")).toBe("A browser on a Mac");
  });

  it("names the upload command with its version, and a program by its first token", () => {
    expect(deviceFor("zaisma-cli/0.9.1", "api_key")).toBe("the upload command 0.9.1");
    expect(deviceFor("curl/8.4.0", "api_key")).toBe("curl/8.4.0");
    expect(deviceFor("", "api_key")).toBe("a program");
  });

  it("says nothing for an AI or Zaisma, whose tool names are their own claims", () => {
    expect(deviceFor(CHROME_ON_WINDOWS, "ai")).toBeNull();
    expect(deviceFor("zaisma-cli/0.9.1", "zaisma")).toBeNull();
  });
});

describe("whereFrom", () => {
  it("takes what Cloudflare says, cleaned", () => {
    const where = whereFrom({ asn: 64500, asOrganization: "Vodafone", city: "Manchester", region: "England", country: "GB" }, CHROME_ON_WINDOWS, "you", "203.0.113.9");
    expect(where).toEqual({ device: "Chrome on a Windows PC", networkName: "Vodafone", cityName: "Manchester", regionName: "England", countryCode: "GB", networkNumber: 64500, connectionAddress: "203.0.113.9" });
  });

  it("is all null without Cloudflare's properties, and cuts a long network name", () => {
    expect(whereFrom(undefined, "", "api_key", null)).toEqual({ device: "a program", networkName: null, cityName: null, regionName: null, countryCode: null, networkNumber: null, connectionAddress: null });
    expect(whereFrom({ asOrganization: "x".repeat(200), country: "gb", asn: 0 }, "", "ai", null)).toMatchObject({ networkName: "x".repeat(60), countryCode: null, networkNumber: null });
  });
});

describe("placeSha256For", () => {
  const where = whereFrom({ asn: 64500, country: "GB" }, "", "api_key", null);
  it("is null without a network or country, and differs between keys at one place", async () => {
    expect(await placeSha256For("key_a", whereFrom({ country: "GB" }, "", "api_key", null))).toBeNull();
    expect(await placeSha256For("key_a", whereFrom({ asn: 64500 }, "", "api_key", null))).toBeNull();
    const first = await placeSha256For("key_a", where);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await placeSha256For("key_b", where)).not.toBe(first);
    expect(await placeSha256For("key_a", where)).toBe(first);
  });
});

describe("foldKeyFor", () => {
  it("is null for a kind that isn't folded and changes at the hour", () => {
    expect(foldKeyFor("version_uploaded", "game_1", "api_key", "k", 0)).toBeNull();
    const first = foldKeyFor("database_written", "game_1", "ai", "k", 1000);
    expect(first).toBe(foldKeyFor("database_written", "game_1", "ai", "k", 3_599_999));
    expect(foldKeyFor("database_written", "game_1", "ai", "k", 3_600_000)).not.toBe(first);
    expect(foldKeyFor("database_written", "game_2", "ai", "k", 1000)).not.toBe(first);
  });
});

describe("isReadOnlySql", () => {
  it("is true only for SELECT, EXPLAIN and VALUES after comments", () => {
    expect(isReadOnlySql("SELECT * FROM scores")).toBe(true);
    expect(isReadOnlySql("  -- note\nselect 1")).toBe(true);
    expect(isReadOnlySql("/* x */ EXPLAIN QUERY PLAN SELECT 1")).toBe(true);
    expect(isReadOnlySql("VALUES (1)")).toBe(true);
    expect(isReadOnlySql("WITH x AS (SELECT 1) DELETE FROM scores")).toBe(false);
    expect(isReadOnlySql("PRAGMA user_version = 2")).toBe(false);
    expect(isReadOnlySql("CREATE TABLE a (b TEXT)")).toBe(false);
    expect(isReadOnlySql("")).toBe(false);
  });
});

describe("describeSecurityEvent", () => {
  it("says how a sign-in was made", () => {
    expect(describeSecurityEvent("signed_in_new_device", "passkey")).toBe("Signed in with a passkey on a new device");
    expect(describeSecurityEvent("signed_in_new_device", "password")).toBe("Signed in with your password on a new device");
    expect(describeSecurityEvent("signed_in_new_device", null)).toBe("Signed in on a new device");
    expect(describeSecurityEvent("password_changed", null)).toBe("Changed your password");
  });
});
