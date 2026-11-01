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
  checkPackageOnNpm,
  checkSecurityAddresses,
  checkUrl,
  firstPaintHashSources,
  gameHeaderProblems,
  httpsRedirectProblems,
  privateAddressProblems,
  securityTxtProblems,
  siteHeaderProblems,
  // @ts-expect-error: a plain JavaScript script without types
} from "../../scripts/ship-checks.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { isNetworkFailure } from "../../scripts/ship-resume.mjs";

/** scripts/ship-checks.mjs: what `npm run ship` tries on the live site after every deploy ("Security checks on every ship." in docs/DECISIONS.md). */

const ROOT = join(import.meta.dirname, "../..");
const HSTS = "max-age=31536000; includeSubDomains; preload";
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
  it("allows exactly the hashes of the first-paint pieces this checkout ships, and no other", async () => {
    const hashSources: string[] = await firstPaintHashSources();
    expect(hashSources.length).toBeGreaterThan(10);
    for (const source of hashSources) expect(source).toMatch(/^'sha256-[A-Za-z0-9+/]{43}='$/);
    const policy = SITE_POLICY.replace("script-src 'self'", `script-src 'self' ${hashSources.join(" ")}`);
    expect(siteHeaderProblems(siteHeaders({ "content-security-policy": policy }), hashSources)).toEqual([]);
    expect(siteHeaderProblems(siteHeaders({ "content-security-policy": policy }))).toContain(`script-src allows ${hashSources[0]}`);
    const other = `'sha256-${"A".repeat(43)}='`;
    expect(siteHeaderProblems(siteHeaders({ "content-security-policy": `${policy.replace("script-src 'self'", `script-src 'self' ${other}`)}` }), hashSources)).toEqual([`script-src allows ${other}`]);
  }, 60_000);
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
  const said = (output: string, exitCode = 0) => ({ exitCode, output });
  it("bucketAccessProblems", () => {
    expect(bucketAccessProblems(said(DISABLED), said(NO_DOMAINS))).toEqual([]);
    const publicDevUrl = bucketAccessProblems(said("Public access is enabled at 'https://pub-abc.r2.dev'."), said(NO_DOMAINS));
    expect(publicDevUrl).toEqual(["public r2.dev address is on: https://pub-abc.r2.dev"]);
    const connected = "Listing custom domains connected to bucket 'zaisma-games'...\ndomain:            files.example.com\nenabled:           Yes\n\ndomain:            cdn.example.com\nenabled:           No\n";
    expect(bucketAccessProblems(said(DISABLED), said(connected))).toEqual(["custom domain connected: files.example.com, cdn.example.com"]);
    expect(bucketAccessProblems(said("Error: not signed in", 1), said("Error: not signed in", 1))).toHaveLength(2);
  });
  it("bucketAccessProblems says it couldn't check when wrangler gave no answer, never that a domain is connected", () => {
    // What the Oct 30, 2026 ship got: the request failed and wrangler's output ended with where it wrote its log.
    const failedRequest = said("Listing custom domains connected to bucket 'zaisma-games'...\n\n✘ [ERROR] fetch failed\n\nIf you think this is a bug then please create an issue\n🪵  Logs were written to \"/Users/x/.wrangler/logs/wrangler.log\"\n", 1);
    expect(bucketAccessProblems(said(DISABLED), failedRequest)).toEqual(["couldn't check its custom domains (wrangler exited 1: fetch failed)"]);
    expect(bucketAccessProblems(said(DISABLED), said("🪵  Logs were written to \"/Users/x/wrangler.log\"\n"))).toEqual(["couldn't check its custom domains (wrangler answered with nothing)"]);
    // The line has to be wrangler's own, not a word in an error.
    expect(bucketAccessProblems(said(`✘ [ERROR] not ${DISABLED}`), said(NO_DOMAINS))[0]).toMatch(/^couldn't check its r2\.dev address/);
    // A non-zero exit never passes, whatever it printed.
    expect(bucketAccessProblems(said(DISABLED), said(NO_DOMAINS, 1))).toHaveLength(1);
  });
  it("the failed request's note reads as the network going away, so ship tries again", () => {
    const note = bucketAccessProblems(said(DISABLED), said("✘ [ERROR] fetch failed", 1))[0];
    expect(isNetworkFailure(note)).toBe(true);
  });
  const wrangler = (publicBucket?: string) => (argumentList: string[]) => {
    if (argumentList[1] === "bucket" && argumentList[2] === "list") return { exitCode: 0, output: "name: zaisma-games\n\nname: zaisma-saves\n" };
    if (argumentList[2] === "dev-url") return { exitCode: 0, output: argumentList[4] === publicBucket ? "Public access is enabled at 'https://pub-x.r2.dev'." : DISABLED };
    return { exitCode: 0, output: NO_DOMAINS };
  };
  it("checkBuckets fails when it can't list", () => {
    const results = checkBuckets(() => ({ exitCode: 1, output: "not signed in" }));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "R2 buckets", isPass: false, isSecurity: true, isChecked: false });
  });
  it("checkBuckets marks a bucket it couldn't read as unchecked, and one it read as checked", () => {
    const run = (argumentList: string[]) => {
      if (argumentList[2] === "list") return { exitCode: 0, output: "name: zaisma-games\n\nname: zaisma-saves\n" };
      if (argumentList[2] === "dev-url") return { exitCode: 0, output: argumentList[4] === "zaisma-saves" ? "Public access is enabled at 'https://pub-x.r2.dev'." : DISABLED };
      return argumentList[4] === "zaisma-games" ? { exitCode: 1, output: "✘ [ERROR] fetch failed" } : { exitCode: 0, output: NO_DOMAINS };
    };
    const [games, saves] = checkBuckets(run);
    expect(games).toMatchObject({ isPass: false, isChecked: false, note: "bucket zaisma-games: couldn't check its custom domains (wrangler exited 1: fetch failed)" });
    expect(saves).toMatchObject({ isPass: false, isChecked: true, note: "bucket zaisma-saves: public r2.dev address is on: https://pub-x.r2.dev" });
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
  const options = { retryWaitMs: 0, attemptCount: 2, hashSources: [] };
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

describe("checkPackageOnNpm", () => {
  const cliWorkflow = "https://github.com/zaisma/zaisma/actions/workflows/publish-cli.yml";
  const serverWorkflow = "https://github.com/zaisma/zaisma/actions/workflows/publish-game-server.yml";
  it("passes when the registry has the version, asking for the scoped package's own address", async () => {
    const fetched = vi.fn().mockResolvedValue(answer(200));
    vi.stubGlobal("fetch", fetched);
    expect(await checkPackageOnNpm("@zaisma/cli", "0.9.1", cliWorkflow)).toMatchObject({ isPass: true, note: "@zaisma/cli 0.9.1 on npm" });
    expect(fetched.mock.calls[0]![0]).toBe("https://registry.npmjs.org/@zaisma%2fcli/0.9.1");
  });
  it("checks the game server package at its own address", async () => {
    const fetched = vi.fn().mockResolvedValue(answer(200));
    vi.stubGlobal("fetch", fetched);
    expect(await checkPackageOnNpm("@zaisma/game-server", "1.0.0", serverWorkflow)).toMatchObject({ isPass: true, name: "@zaisma/game-server on npm", note: "@zaisma/game-server 1.0.0 on npm" });
    expect(fetched.mock.calls[0]![0]).toBe("https://registry.npmjs.org/@zaisma%2fgame-server/1.0.0");
  });
  it("fails when it isn't there and waitSec is 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(404)));
    const result = await checkPackageOnNpm("@zaisma/game-server", "1.0.0", serverWorkflow, { waitSec: 0 });
    expect(result.isPass).toBe(false);
    expect(result.note).toContain("@zaisma/game-server 1.0.0 not on npm yet");
  });
  it("names the workflow when it waited and the version never came", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(404)));
    const result = await checkPackageOnNpm("@zaisma/cli", "0.9.1", cliWorkflow, { waitSec: 0.01, pollSec: 0 });
    expect(result.isPass).toBe(false);
    expect(result.note).toContain(cliWorkflow);
  });
  it("waits for it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(answer(404)).mockResolvedValueOnce(answer(200)));
    expect((await checkPackageOnNpm("@zaisma/cli", "0.9.1", cliWorkflow, { waitSec: 1, pollSec: 0 })).isPass).toBe(true);
  });
  it("keeps waiting past waitSec while the publish workflow's run is still queued or running, and says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(404)));
    const readPublishRunStatus = vi.fn().mockResolvedValue("queued");
    const result = await checkPackageOnNpm("@zaisma/game-server", "1.13.0", serverWorkflow, { waitSec: 0.001, runningWaitSec: 0.02, pollSec: 0, readPublishRunStatus });
    expect(readPublishRunStatus).toHaveBeenCalled();
    expect(result).toMatchObject({ isPass: false, isChecked: true });
    expect(result.note).toBe(`@zaisma/game-server 1.13.0 still publishing after 0 min (its run is queued): see ${serverWorkflow}`);
  });
  it("stops at waitSec once the publish run is done or can't be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(404)));
    for (const status of ["completed", null]) {
      const readPublishRunStatus = vi.fn().mockResolvedValue(status);
      const result = await checkPackageOnNpm("@zaisma/cli", "0.9.1", cliWorkflow, { waitSec: 0.001, runningWaitSec: 60, pollSec: 0, readPublishRunStatus });
      expect(readPublishRunStatus).toHaveBeenCalledTimes(1);
      expect(result.note).toBe(`@zaisma/cli 0.9.1 not on npm after 0 min: see ${cliWorkflow}`);
    }
  });
  it("finds the version that came while the run was still going", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(answer(404)).mockResolvedValueOnce(answer(404)).mockResolvedValue(answer(200)));
    const waited = await checkPackageOnNpm("@zaisma/cli", "0.9.1", cliWorkflow, { waitSec: 0.000001, runningWaitSec: 60, pollSec: 0, readPublishRunStatus: async () => "in_progress" });
    expect(waited.isPass).toBe(true);
  });
});
