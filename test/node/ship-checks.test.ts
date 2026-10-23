import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_LOGIN_PREFIX,
  ACCESS_RESOURCE_METADATA_PREFIX,
  BACKUP_BUCKET_URL,
  adminAccessProblems,
  backupBucketProblems,
  bucketAccessProblems,
  bucketNames,
  checkBuckets,
  checkCliOnNpm,
  checkSecurityAddresses,
  checkUrl,
  gameHeaderProblems,
  httpsRedirectProblems,
  privateAddressProblems,
  securityTxtProblems,
  siteHeaderProblems,
  // @ts-expect-error: a plain JavaScript script without types
} from "../../scripts/ship-checks.mjs";

/** scripts/ship-checks.mjs: what `npm run ship` tries on the live site after every deploy ("Security checks on every ship." in docs/DECISIONS.md). */

const ROOT = join(import.meta.dirname, "../..");
const HSTS = "max-age=31536000; includeSubDomains";
const SITE_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'";
const GAME_PAGE_POLICY = SITE_POLICY.replace("script-src 'self'", "script-src 'self' https://challenges.cloudflare.com");
const GAME_POLICY = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; form-action 'none'; base-uri 'self'; object-src 'none'; frame-ancestors https://zaisma.com";
const siteHeaders = (extra: Record<string, string> = {}) => new Headers({ "strict-transport-security": HSTS, "content-security-policy": SITE_POLICY, "x-content-type-options": "nosniff", ...extra });
const gameHeaders = (extra: Record<string, string> = {}) => new Headers({ "strict-transport-security": HSTS, "content-security-policy": GAME_POLICY, "x-content-type-options": "nosniff", ...extra });
const answer = (status: number, headers: Record<string, string> = {}, body = "") => new Response(body, { status, headers });

afterEach(() => vi.unstubAllGlobals());

describe("siteHeaderProblems", () => {
  it("holds for zaisma.com's headers, with and without Cloudflare's check in script-src", () => {
    expect(siteHeaderProblems(siteHeaders())).toEqual([]);
    expect(siteHeaderProblems(siteHeaders({ "content-security-policy": GAME_PAGE_POLICY }))).toEqual([]);
  });
  it("names what slipped", () => {
    const without = siteHeaders();
    without.delete("strict-transport-security");
    expect(siteHeaderProblems(without)).toContain("no Strict-Transport-Security");
    expect(siteHeaderProblems(siteHeaders({ "strict-transport-security": "max-age=300; includeSubDomains" })).join()).toContain("is under 31536000");
    expect(siteHeaderProblems(siteHeaders({ "strict-transport-security": "max-age=31536000" }))).toContain("Strict-Transport-Security lacks includeSubDomains");
    expect(siteHeaderProblems(siteHeaders({ "content-security-policy": SITE_POLICY.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") }))).toContain("script-src allows 'unsafe-inline'");
    expect(siteHeaderProblems(siteHeaders({ "content-security-policy": SITE_POLICY.replace("frame-ancestors 'none'", "frame-ancestors *") }))).toContain("frame-ancestors isn't 'none'");
    const noSniff = siteHeaders();
    noSniff.delete("x-content-type-options");
    expect(siteHeaderProblems(noSniff)).toContain("X-Content-Type-Options isn't nosniff");
  });
});

describe("gameHeaderProblems", () => {
  it("holds for the game domain's headers", () => expect(gameHeaderProblems(gameHeaders())).toEqual([]));
  it("names what slipped", () => {
    expect(gameHeaderProblems(gameHeaders({ "content-security-policy": GAME_POLICY.replace("https://zaisma.com", "https://evil.example") }))).toContain("frame-ancestors isn't https://zaisma.com");
    const without = gameHeaders();
    without.delete("content-security-policy");
    expect(gameHeaderProblems(without)).toContain("no Content-Security-Policy");
  });
});

describe("the address judges", () => {
  it("httpsRedirectProblems wants a 301 or 308 to exactly the https address", () => {
    const expected = "https://zaisma.com/g/arena";
    expect(httpsRedirectProblems(answer(308, { location: expected }), expected)).toEqual([]);
    expect(httpsRedirectProblems(answer(200), expected)).toHaveLength(1);
    expect(httpsRedirectProblems(answer(308, { location: "https://zaisma.com/" }), expected)).toHaveLength(1);
  });
  it("backupBucketProblems wants a refusal for a request without a signature", () => {
    expect(backupBucketProblems(answer(403))).toEqual([]);
    expect(backupBucketProblems(answer(401))).toEqual([]);
    expect(backupBucketProblems(answer(200))).toEqual(["answered 200 without being signed in"]);
    expect(backupBucketProblems(answer(404))).toEqual(["answered 404 without being signed in"]);
  });
  it("privateAddressProblems wants exactly 404", () => {
    expect(privateAddressProblems(answer(404))).toEqual([]);
    expect(privateAddressProblems(answer(200))).toEqual(["answered 200"]);
    expect(privateAddressProblems(answer(302))).toEqual(["answered 302"]);
  });
  it("adminAccessProblems wants Cloudflare Access's answer: a redirect to its login, or its OAuth 401", () => {
    expect(adminAccessProblems(answer(302, { location: `${ACCESS_LOGIN_PREFIX}zaisma.com?kid=1` }))).toEqual([]);
    expect(adminAccessProblems(answer(303, { location: `${ACCESS_LOGIN_PREFIX}zaisma.com?kid=1` }))).toEqual([]);
    const accessOauth = `Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token", resource_metadata="${ACCESS_RESOURCE_METADATA_PREFIX}admin"`;
    expect(adminAccessProblems(answer(401, { "www-authenticate": accessOauth }))).toEqual([]);
    expect(adminAccessProblems(answer(200))).toHaveLength(1);
    expect(adminAccessProblems(answer(403))).toHaveLength(1);
    expect(adminAccessProblems(answer(302, { location: "/signin" }))).toHaveLength(1);
    // A 401 from the origin, or one naming metadata anywhere else, isn't Access.
    expect(adminAccessProblems(answer(401))).toHaveLength(1);
    expect(adminAccessProblems(answer(401, { "www-authenticate": 'Bearer realm="zaisma"' }))).toHaveLength(1);
    expect(adminAccessProblems(answer(401, { "www-authenticate": 'Bearer resource_metadata="https://zaisma.com/.well-known/oauth-protected-resource"' }))).toHaveLength(1);
    expect(adminAccessProblems(answer(401, { "www-authenticate": 'Bearer resource_metadata="https://evil.example/.well-known/cloudflare-access-protected-resource/admin"' }))).toHaveLength(1);
    expect(adminAccessProblems(answer(200, { "www-authenticate": accessOauth }))).toHaveLength(1);
  });
  it("ACCESS_LOGIN_PREFIX uses the team domain in apps/site/wrangler.jsonc", () => {
    const team = readFileSync(join(ROOT, "apps/site/wrangler.jsonc"), "utf8").match(/"ACCESS_TEAM_DOMAIN": "([^"]+)"/)![1];
    expect(ACCESS_LOGIN_PREFIX.startsWith(`https://${team}/`)).toBe(true);
  });
});

const DISABLED = "Public access via the r2.dev URL is disabled.";
const NO_DOMAINS = "There are no custom domains connected to this bucket.";

describe("buckets", () => {
  it("bucketNames reads wrangler's list", () => {
    expect(bucketNames("Listing buckets...\nname:           zaisma-games\ncreation_date:  2026-01-01\n\nname:           zaisma-saves\ncreation_date:  2026-01-02\n")).toEqual(["zaisma-games", "zaisma-saves"]);
  });
  it("bucketAccessProblems", () => {
    expect(bucketAccessProblems(DISABLED, NO_DOMAINS)).toEqual([]);
    const publicDevUrl = bucketAccessProblems("Public access is enabled at 'https://pub-abc.r2.dev'.", NO_DOMAINS);
    expect(publicDevUrl).toEqual(["public r2.dev address is on: https://pub-abc.r2.dev"]);
    expect(bucketAccessProblems(DISABLED, "domain: files.example.com")[0]).toContain("custom domain connected: domain: files.example.com");
    expect(bucketAccessProblems("Error: not signed in", "Error: not signed in")).toHaveLength(2);
  });
  const wrangler = (publicBucket?: string) => (argumentList: string[]) => {
    if (argumentList[1] === "bucket" && argumentList[2] === "list") return { exitCode: 0, output: "name: zaisma-games\n\nname: zaisma-saves\n" };
    if (argumentList[2] === "dev-url") return { exitCode: 0, output: argumentList[4] === publicBucket ? "Public access is enabled at 'https://pub-x.r2.dev'." : DISABLED };
    return { exitCode: 0, output: NO_DOMAINS };
  };
  it("checkBuckets fails when it can't list", () => {
    const results = checkBuckets(() => ({ exitCode: 1, output: "not signed in" }));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "R2 buckets", isPass: false, isSecurity: true });
  });
  it("checkBuckets passes private buckets and fails a public one", () => {
    expect(checkBuckets(wrangler()).map((result: { isPass: boolean; isSecurity: boolean }) => [result.isPass, result.isSecurity])).toEqual([[true, true], [true, true]]);
    const results = checkBuckets(wrangler("zaisma-saves"));
    expect(results.map((result: { isPass: boolean }) => result.isPass)).toEqual([true, false]);
    expect(results[1].note).toContain("bucket zaisma-saves");
  });
});

describe("securityTxtProblems", () => {
  const now = new Date("2026-10-19T00:00:00Z");
  const file = (expires: string, contact = "Contact: mailto:security@zaisma.com") => `${contact}\nExpires: ${expires}\nPreferred-Languages: en\n`;
  it("holds for a live file with the security contact that hasn't expired", () => {
    expect(securityTxtProblems(answer(200), file("2026-11-18T00:00:00.000Z"), now)).toEqual([]);
  });
  it("names what's wrong: a missing file, a wrong contact, an unreadable or past Expires", () => {
    expect(securityTxtProblems(answer(404), "", now)).toEqual(["answered 404"]);
    expect(securityTxtProblems(answer(200), file("2026-11-18T00:00:00.000Z", "Contact: mailto:someone@else.test"), now)).toEqual(["no Contact: mailto:security@zaisma.com"]);
    expect(securityTxtProblems(answer(200), "Contact: mailto:security@zaisma.com\n", now)).toEqual(["no readable Expires"]);
    expect(securityTxtProblems(answer(200), file("2026-10-18T00:00:00.000Z"), now)).toEqual(["Expires is in the past"]);
  });
});

describe("checkUrl", () => {
  const options = { retryWaitMs: 0 };
  it("retries a thrown fetch", async () => {
    const fetchStub = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(answer(200, {}, "ok"));
    vi.stubGlobal("fetch", fetchStub);
    const result = await checkUrl("thing", "https://x.test/", {}, (response: Response) => (response.status === 200 ? [] : ["bad"]), options);
    expect(result.isPass).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
  it("doesn't retry a security answer that is wrong", async () => {
    const fetchStub = vi.fn().mockImplementation(async () => answer(200));
    vi.stubGlobal("fetch", fetchStub);
    const result = await checkUrl("door", "https://x.test/", {}, privateAddressProblems, { ...options, isSecurity: true, isRetriedOnProblem: false });
    expect(result).toMatchObject({ isPass: false, isSecurity: true, note: "door: answered 200" });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
  it("retries a 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(answer(503)).mockResolvedValueOnce(answer(404)));
    const result = await checkUrl("door", "https://x.test/", {}, privateAddressProblems, { ...options, isSecurity: true, isRetriedOnProblem: false });
    expect(result.isPass).toBe(true);
  });
  it("follows a redirect on the same origin only when asked, and never to another origin", async () => {
    const fetchStub = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://x.test/") return answer(302, { location: "/_zaisma/versions/v1/" });
      if (url === "https://x.test/away") return answer(302, { location: "https://elsewhere.test/" });
      return answer(200);
    });
    vi.stubGlobal("fetch", fetchStub);
    const isOk = (response: Response) => (response.status === 200 ? [] : [`answered ${response.status}`]);
    expect(await checkUrl("page", "https://x.test/", {}, isOk, { ...options, isSecurity: true, isRetriedOnProblem: false })).toMatchObject({ isPass: false, note: "page: answered 302" });
    expect(await checkUrl("page", "https://x.test/", {}, isOk, { ...options, isSecurity: true, isSameOriginRedirectFollowed: true })).toMatchObject({ isPass: true });
    expect(fetchStub).toHaveBeenLastCalledWith("https://x.test/_zaisma/versions/v1/", expect.anything());
    expect(await checkUrl("away", "https://x.test/away", {}, isOk, { ...options, isSecurity: true, isRetriedOnProblem: false, isSameOriginRedirectFollowed: true })).toMatchObject({ isPass: false, note: "away: answered 302" });
  });
  it("retries a header problem that clears", async () => {
    const withoutHsts = siteHeaders();
    withoutHsts.delete("strict-transport-security");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { headers: withoutHsts })).mockResolvedValueOnce(new Response("", { headers: siteHeaders() })));
    const result = await checkUrl("headers", "https://x.test/", {}, (response: Response) => siteHeaderProblems(response.headers), { ...options, isSecurity: true });
    expect(result.isPass).toBe(true);
  });
});

describe("checkSecurityAddresses", () => {
  const redirectTo = (url: string) => answer(308, { location: url });
  function liveStub(overrides: Record<string, () => Response> = {}) {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (overrides[url]) return overrides[url]();
      if (url.startsWith("http://zaisma.com/")) return redirectTo(url.replace("http:", "https:"));
      if (url.startsWith("http://")) return redirectTo(url.replace("http:", "https:"));
      if (url.includes("ship-check")) {
        if (url.includes("/api/dev/games/")) return answer(200, {}, JSON.stringify({ game: { visibility: "private", review_status: "live" }, versions: [{ is_live: true }] }));
        return answer(404);
      }
      if (url.endsWith("/admin") || url.endsWith("/admin/mcp")) return answer(302, { location: `${ACCESS_LOGIN_PREFIX}zaisma.com` });
      if (url.startsWith(BACKUP_BUCKET_URL)) return answer(url === BACKUP_BUCKET_URL ? 403 : 401);
      // A game's page opens at its version's own address.
      if (url === "https://arena.zaismausercontent.com/") return answer(302, { location: "/_zaisma/versions/version_1/", "cache-control": "no-store" });
      if (url.includes("zaismausercontent.com")) return new Response("game", { headers: gameHeaders() });
      return new Response("page", { headers: siteHeaders({ "content-security-policy": url.includes("/g/") ? GAME_PAGE_POLICY : SITE_POLICY }) });
    });
  }
  const options = { retryWaitMs: 0, attemptCount: 2 };
  it("passes when everything answers as live does after this slice", async () => {
    vi.stubGlobal("fetch", liveStub());
    const results = await checkSecurityAddresses({ ...options, zaismaKey: "key" });
    expect(results.filter((result: { isPass: boolean }) => !result.isPass)).toEqual([]);
    expect(results.every((result: { isSecurity: boolean }) => result.isSecurity)).toBe(true);
  });
  it("fails when the private game opens", async () => {
    vi.stubGlobal("fetch", liveStub({ "https://ship-check.zaismausercontent.com/": () => answer(200) }));
    const results = await checkSecurityAddresses(options);
    const result = results.find((one: { name: string }) => one.name === "private check game");
    expect(result.isPass).toBe(false);
    expect(result.note).toContain("https://ship-check.zaismausercontent.com/ answered 200");
  });
  it("says it isn't confirmed private without a key", async () => {
    vi.stubGlobal("fetch", liveStub());
    const results = await checkSecurityAddresses(options);
    expect(results.find((one: { name: string }) => one.name === "private check game").note).toContain("no ZAISMA_KEY");
  });
  it("fails when the API says the check game is listed", async () => {
    const listed = JSON.stringify({ game: { visibility: "listed", review_status: "live" }, versions: [{ is_live: true }] });
    vi.stubGlobal("fetch", liveStub({ "https://zaisma.com/api/dev/games/ship-check": () => answer(200, {}, listed) }));
    const results = await checkSecurityAddresses({ ...options, zaismaKey: "key" });
    expect(results.find((one: { name: string }) => one.name === "private check game").note).toContain("isn't a private live game");
  });
  it("fails when /admin opens", async () => {
    vi.stubGlobal("fetch", liveStub({ "https://zaisma.com/admin": () => answer(200) }));
    const results = await checkSecurityAddresses(options);
    expect(results.find((one: { name: string }) => one.name === "/admin").isPass).toBe(false);
  });
});

describe("checkCliOnNpm", () => {
  it("passes when the registry has the version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200)));
    expect(await checkCliOnNpm("0.9.1")).toMatchObject({ isPass: true, note: "CLI 0.9.1 on npm" });
  });
  it("fails naming the workflow when it isn't there and waitSec is 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(404)));
    const result = await checkCliOnNpm("0.9.1", { waitSec: 0 });
    expect(result.isPass).toBe(false);
    expect(result.note).toContain("Publish CLI workflow");
  });
  it("waits for it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(answer(404)).mockResolvedValueOnce(answer(200)));
    expect((await checkCliOnNpm("0.9.1", { waitSec: 1, pollSec: 0 })).isPass).toBe(true);
  });
});
