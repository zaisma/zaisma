import { env, SELF } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAccount, createGame, personOwner } from "@zaisma/core";
import "../../apps/site/src/index.ts";
import { FIRST_PAINT_SCRIPT_TEXTS } from "../../apps/site/src/html.ts";
import { PAGE_CACHE_HEADER, withGuestPageCache } from "../../apps/site/src/guest-page-cache.ts";
import { handleSpeedReports, pageSpeedAnswer, SPEED_REPORT_PATH } from "../../apps/site/src/speed-reports.ts";
import type { Env } from "../../apps/site/src/env.ts";

/**
 * Pages that show with their first bytes: a page carries everything its first paint needs (its own styles and the first-paint pieces,
 * each allowed by its hash) and names every file only for after it; guests' pages come from the cache near them; real visits report
 * their speed with nothing that names them.
 */

const SITE = "https://zaisma.test";
const SLUG = "first-bytes-game";
const GUEST_PAGES = ["/", "/games", `/g/${SLUG}`, "/@First_Bytes", "/legal/privacy", "/legal/terms", "/developers/covers", "/developers/backgrounds"];

const sha256Base64 = async (text: string): Promise<string> => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))));

beforeAll(async () => {
  await env.DB.exec(`DELETE FROM versions WHERE id = 'v-first-bytes'; DELETE FROM games WHERE slug = '${SLUG}';`);
  await createAccount(env.DB, { id: "first-bytes-dev", username: "First_Bytes", ageBand: "18+" });
  const game = await createGame(env.DB, { slug: SLUG, title: "First Bytes", description: "A game that loads.", ownerId: (await personOwner(env.DB, "first-bytes-dev")).id, visibility: "listed" });
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, patch_notes, published_at_ms, created_at_ms) VALUES ('v-first-bytes', ?, 'games/first-bytes/v1', 1, 0, 'approved', '', 1, 0)").bind(game.id).run();
  await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = 'v-first-bytes' WHERE slug = ?").bind(SLUG).run();
});

afterAll(async () => {
  await env.DB.exec(`DELETE FROM versions WHERE id = 'v-first-bytes'; DELETE FROM games WHERE slug = '${SLUG}';`);
});

describe("a page's first paint", () => {
  it("waits for no file: its head names none, and it carries its own styles and first-paint pieces, each allowed by its hash", async () => {
    for (const path of [...GUEST_PAGES, "/signin"]) {
      const response = await SELF.fetch(`${SITE}${path}`);
      const page = await response.text();
      expect(response.status, path).toBe(200);
      const head = page.slice(0, page.indexOf("</head>"));
      // Structured data for search engines is a data block, never run.
      expect(head.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ""), path).not.toMatch(/<script\b|<link[^>]*rel="(stylesheet|preload)"/);
      expect(head.match(/<style data-first-paint>([\s\S]*?)<\/style>/)?.[1]?.length ?? 0, path).toBeGreaterThan(1000);
      const policy = response.headers.get("content-security-policy") ?? "";
      const pieces = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((found) => found[1]!);
      expect(pieces.length, path).toBeGreaterThan(3);
      for (const piece of pieces) {
        expect(FIRST_PAINT_SCRIPT_TEXTS, path).toContain(piece);
        expect(policy, path).toContain(`'sha256-${await sha256Base64(piece)}'`);
      }
      // The whole sheet and the script files are named at the body's end, for after the first paint.
      expect(page, path).toMatch(/<link rel="preload" as="style" href="\/css\/site(-steel)?\.[0-9a-f]{16}\.css" fetchpriority="low" data-site-style>/);
      expect(page, path).toMatch(/<link rel="preload" as="script" href="\/js\/components\.[0-9a-f]{16}\.js" fetchpriority="low" data-page-script>/);
      expect(response.headers.get("link"), path).toBeNull();
    }
  });

  it("is the same for every guest each time, so a guest's copy can be kept", async () => {
    for (const path of GUEST_PAGES) {
      const once = await (await SELF.fetch(`${SITE}${path}`)).text();
      const again = await (await SELF.fetch(`${SITE}${path}`)).text();
      expect(again, path).toBe(once);
    }
  });
});

describe("guest pages from the cache near the player", () => {
  const cachedEnv = { ...env, GUEST_PAGE_CACHE_SECONDS: "60" } as unknown as Env;
  const keeping: Promise<unknown>[] = [];
  const ctx = { waitUntil: (work: Promise<unknown>) => keeping.push(work), passThroughOnException: () => {} } as unknown as ExecutionContext;
  let renderCount = 0;
  const render = (headers: Record<string, string> = {}) => async () => {
    renderCount++;
    return new Response(`<p>made ${renderCount}</p>`, { headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
  };
  const open = async (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) => {
    const response = await withGuestPageCache(new Request(`${SITE}${path}`, init), cachedEnv, ctx, render(headers));
    await Promise.all(keeping.splice(0));
    return { cacheState: response.headers.get(PAGE_CACHE_HEADER), text: await response.text() };
  };

  it("answers a guest's second visit from the cache, for each kind of device and country apart", async () => {
    renderCount = 0;
    expect(await open("/g/cache-one")).toEqual({ cacheState: "miss", text: "<p>made 1</p>" });
    expect(await open("/g/cache-one")).toEqual({ cacheState: "hit", text: "<p>made 1</p>" });
    expect((await open("/g/cache-one", { headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) Mobile Safari" } })).cacheState).toBe("miss");
    expect((await open("/g/cache-one", { cf: { country: "DE" } } as RequestInit)).cacheState).toBe("miss");
    expect(renderCount).toBe(3);
  });

  it("never keeps a signed-in viewer's page, one that sets a cookie or says no-store, or a page off the list", async () => {
    renderCount = 0;
    expect((await open("/g/cache-two", { headers: { Cookie: "__Host-zaisma_in=1" } })).cacheState).toBeNull();
    expect((await open("/g/cache-two", { headers: { Cookie: "__Host-zaisma_in=1" } })).cacheState).toBeNull();
    await open("/g/cache-three", {}, { "Set-Cookie": "zaisma_guest=1" });
    expect((await open("/g/cache-three")).cacheState).toBe("miss");
    await open("/g/cache-four", {}, { "Cache-Control": "no-store" });
    expect((await open("/g/cache-four")).cacheState).toBe("miss");
    expect((await open("/account")).cacheState).toBeNull();
    expect((await open("/g/cache-five", { method: "POST" })).cacheState).toBeNull();
  });

  it("keeps nothing where it's turned off (tests, the local preview)", async () => {
    const response = await withGuestPageCache(new Request(`${SITE}/g/cache-six`), env as unknown as Env, ctx, render());
    expect(response.headers.get(PAGE_CACHE_HEADER)).toBeNull();
  });
});

describe("speed on the live site", () => {
  const report = { page_name: "Home", visit_kind: "switched", first_paint_delay_ms: 2840, device_kind: "phone", connection_kind: "3g" };
  const send = (body: unknown, written: unknown[]) =>
    handleSpeedReports(
      new Request(`${SITE}${SPEED_REPORT_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: SITE }, body: typeof body === "string" ? body : JSON.stringify(body) }),
      { ...env, PAGE_SPEED: { writeDataPoint: (point: unknown) => written.push(point) } } as unknown as Env,
      SPEED_REPORT_PATH,
    );

  it("keeps a report with nothing in it that names the player or the device", async () => {
    const written: unknown[] = [];
    expect((await send(report, written))!.status).toBe(204);
    expect(written).toEqual([{ indexes: ["Home"], blobs: ["Home", "switched", "phone", "3g"], doubles: [2840] }]);
  });

  it("refuses a report with a field it doesn't take, a value off its list or a delay out of range, and keeps nothing", async () => {
    const written: unknown[] = [];
    for (const bad of [{ ...report, guest_id: "guest_1" }, { ...report, page_name: "Somewhere" }, { ...report, visit_kind: "reloaded" }, { ...report, first_paint_delay_ms: -1 }, { ...report, first_paint_delay_ms: 1.5 }, { ...report, first_paint_delay_ms: 120_001 }, { ...report, connection_kind: "5g" }, "not json"]) {
      const response = (await send(bad, written))!;
      expect(response.status, JSON.stringify(bad)).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("bad_speed_report");
    }
    expect(written).toEqual([]);
  });

  it("takes reports only from Zaisma's pages, and only sent", async () => {
    expect((await SELF.fetch(`${SITE}${SPEED_REPORT_PATH}`)).status).toBe(405);
    expect((await SELF.fetch(`${SITE}${SPEED_REPORT_PATH}`, { method: "POST", headers: { Origin: "https://elsewhere.test" }, body: JSON.stringify(report) })).status).toBe(403);
    expect((await SELF.fetch(`${SITE}${SPEED_REPORT_PATH}`, { method: "POST", headers: { Origin: SITE }, body: JSON.stringify(report) })).status).toBe(204);
  });

  it("is read by the admin MCP's get_page_speed from Analytics Engine", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(`${String(input)} ${String(init?.body)}`);
      return Response.json({ data: [{ page_name: "Home", visit_kind: "opened", report_count: "12", median_first_paint_delay_ms: 2900.4, p75_first_paint_delay_ms: 3300, p95_first_paint_delay_ms: 5100 }] });
    });
    try {
      const answer = await pageSpeedAnswer({ ...env, CLOUDFLARE_ACCOUNT_ID: "account-test", ANALYTICS_API_TOKEN: "token-test", CLOUDFLARE_API_URL: "https://cloudflare.test" } as unknown as Env, { dayCount: 7, isByDeviceKind: false });
      expect(answer.pages).toEqual([{ page_name: "Home", visit_kind: "opened", device_kind: null, report_count: 12, median_first_paint_delay_ms: 2900, p75_first_paint_delay_ms: 3300, p95_first_paint_delay_ms: 5100 }]);
      expect(asked[0]).toContain("https://cloudflare.test/accounts/account-test/analytics_engine/sql");
      expect(asked[0]).toContain("INTERVAL '7' DAY");
    } finally {
      vi.unstubAllGlobals();
    }
    await expect(pageSpeedAnswer({ ...env, CLOUDFLARE_ACCOUNT_ID: undefined } as unknown as Env, { dayCount: 7, isByDeviceKind: false })).rejects.toThrow("CLOUDFLARE_ACCOUNT_ID");
  });
});
