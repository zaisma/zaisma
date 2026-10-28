import { env, SELF } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addTesterLink, createAccount, createApiKey, createGame, personOwner } from "@zaisma/core";
import "../../apps/site/src/index.ts";
import { pageScripts } from "../../apps/site/src/page-scripts.ts";
import { pageScriptPaths, strictScriptProblems } from "../strict-scripts.ts";
import { defaultScrollbarProblems } from "../own-scrollbars.ts";

/**
 * Strict scripts on zaisma.com (docs/DECISIONS.md): every page runs only the site's own script files.
 * This renders the pages a stranger, a player on a game's page and admin see, in each of their states,
 * and fails on an inline script, an on… attribute, a javascript: address or a script-src that allows
 * more (test/strict-scripts.ts). Signed-in pages are checked as accounts.test.ts's browser opens them,
 * and the site's code itself in test/node/strict-scripts.test.ts.
 */

const SITE = "https://zaisma.test";
const LOCAL = "http://localhost";
const SLUGS = ["strict-solo", "strict-arena", "strict-members", "strict-draft"];

let testerToken = "";
let topicId = "";
const loaded = new Set<string>();

async function checkPage(url: string): Promise<{ status: number; page: string }> {
  const response = await SELF.fetch(url, { redirect: "manual" });
  const page = await response.text();
  expect(response.status, url).toBeLessThan(500);
  if (!(response.headers.get("content-type") ?? "").startsWith("text/html")) return { status: response.status, page };
  expect(strictScriptProblems(page, response.headers.get("content-security-policy")), url).toEqual([]);
  // And Zaisma's own scrollbar, never the browser's; the buy sheet's Stripe frame never scrolls (it's as tall as what Stripe draws).
  if (!url.endsWith("/buy/stripe-frame")) expect(defaultScrollbarProblems(page), url).toEqual([]);
  for (const path of pageScriptPaths(page)) loaded.add(path);
  return { status: response.status, page };
}

beforeAll(async () => {
  // Supabase says Google and Discord are on, so the sign-in pages show them too.
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input) === "https://supabase.test/auth/v1/settings" ? Promise.resolve(Response.json({ external: { google: true, discord: true } })) : realFetch(input, init),
  );
  await env.DB.exec(`DELETE FROM tester_links WHERE game_id IN (SELECT id FROM games WHERE slug LIKE 'strict-%'); DELETE FROM versions WHERE id = 'v-strict'; DELETE FROM games WHERE slug LIKE 'strict-%';`);
  await createAccount(env.DB, { id: "strict-dev", username: "Strict_Dev", ageBand: "18+" });
  const owner = await personOwner(env.DB, "strict-dev");
  // A title and words that try to break out of the page, as a developer could write them.
  const sneaky = `Solo "><script>alert(1)</script><img src=x onerror=alert(1)> javascript:alert(1)`;
  const games = await Promise.all(SLUGS.map((slug) => createGame(env.DB, { slug, title: slug === "strict-solo" ? sneaky : slug, description: sneaky, ownerId: owner.id, visibility: slug === "strict-draft" ? "draft" : "listed" })));
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, patch_notes, published_at_ms, created_at_ms) VALUES ('v-strict', ?, 'games/strict/v1', 1, 0, 'approved', ?, ?, 0)").bind(games[0]!.id, sneaky, Date.now()).run();
  await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = 'v-strict', devices = 'phone' WHERE slug LIKE 'strict-%'").run();
  await env.DB.prepare("UPDATE games SET multiplayer_mode = 'relay', account_requirement = 'multiplayer', room_browsing = 'page' WHERE slug = 'strict-arena'").run();
  await env.DB.prepare("UPDATE games SET account_requirement = 'whole_game', cloud_saves_enabled = 0 WHERE slug = 'strict-members'").run();
  testerToken = (await addTesterLink(env.DB, games[3]!.id, "Playtesters")).token;
  const key = (await createApiKey(env.DB, "strict-dev", "claude")).token;
  const posted = await SELF.fetch(`${SITE}/api/dev/forum`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ is_public: true, kind: "question", category: "pages", title: "Strict pages?", text_markdown: `Does [this](javascript:alert(1)) or <img src=x onerror=alert(1)> run? ${sneaky}`, author_kind: "developer" }),
  });
  const answer = (await posted.json()) as { topic?: { id: string } };
  expect(answer.topic, JSON.stringify(answer)).toBeDefined();
  topicId = answer.topic!.id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await env.DB.exec(`DELETE FROM tester_links WHERE game_id IN (SELECT id FROM games WHERE slug LIKE 'strict-%'); DELETE FROM versions WHERE id = 'v-strict'; DELETE FROM games WHERE slug LIKE 'strict-%';`);
});

describe("every page runs only the site's own script files", () => {
  it("the home page, a game's pages in each state, and tester links", async () => {
    await checkPage(`${SITE}/`);
    for (const slug of SLUGS.slice(0, 3)) {
      for (const query of ["", "?play", "?room=BCDFGH"]) expect((await checkPage(`${SITE}/g/${slug}${query}`)).status).toBe(200);
      await checkPage(`${SITE}/g/${slug}/report`);
    }
    expect((await checkPage(`${SITE}/t/${testerToken}`)).status).toBe(200);
    await checkPage(`${SITE}/g/strict-arena/rooms`);
    expect((await checkPage(`${SITE}/g/strict-draft`)).status).toBe(404);
  });

  it("signing in, making an account, profiles, the forum, the rules and the design gallery", async () => {
    for (const path of ["/games", "/signin", "/signin?next=%2Fg%2Fstrict-solo", "/signin/email", "/join", "/@Strict_Dev", "/forum", `/forum/${topicId}`, "/forum/out?to=https%3A%2F%2Fexample.com%2Fpage", "/forum/out?to=javascript%3Aalert(1)", "/legal/content-rules", "/legal/privacy", "/legal/dmca", "/legal/security", "/no-such-page", "/dashboard", "/friends", "/design", "/design/actions/buttons", "/design/layout", "/design/panes/glass?theme=dark", "/buy/stripe-frame"]) {
      await checkPage(`${SITE}${path}`);
    }
  });

  it("admin", async () => {
    for (const path of ["/admin", "/admin/reports", "/admin/feedback", "/admin/profiles", "/admin/precedents", "/admin/audit"]) {
      expect((await checkPage(`${LOCAL}${path}`)).status, path).toBe(200);
    }
  });

  it("pages say so even when they're only a part of one, in case someone opens it on its own", async () => {
    for (const url of [`${SITE}/g/strict-arena/rooms`, `${SITE}/forum/similar?search_text=strict+pages`]) {
      const response = await SELF.fetch(url);
      expect(response.headers.get("content-security-policy"), url).toContain("script-src 'self'");
    }
  });
});

describe("the site's script files", () => {
  it("are served, named for their contents and cached for good", async () => {
    expect(loaded.size).toBeGreaterThan(10);
    for (const path of loaded) {
      const response = await SELF.fetch(`${SITE}${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const name = path.slice("/js/".length).replace(/\.[0-9a-f]{16}\.js$/, "");
      const hashHex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(await response.text())))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      expect(path).toBe(`/js/${name}.${hashHex.slice(0, 16)}.js`);
    }
  });

  it("answer a page from before a deploy with the current script, never cached, and nothing else at all", async () => {
    const [path] = loaded;
    const older = await SELF.fetch(`${SITE}${path!.replace(/\.[0-9a-f]{16}\.js$/, ".0000000000000000.js")}`);
    expect(older.status).toBe(200);
    expect(older.headers.get("cache-control")).toBe("no-store");
    expect(await older.text()).toBe(await (await SELF.fetch(`${SITE}${path}`)).text());
    for (const wrong of ["/js/nothing.0000000000000000.js", "/js/site.js", "/js/", "/js/../index.ts"]) expect((await SELF.fetch(`${SITE}${wrong}`)).status, wrong).toBe(404);
    expect((await SELF.fetch(`${SITE}${path}`, { method: "POST" })).status).toBe(405);
  });

  it("are each loaded by some page", () => {
    // A script no page loads is left over; pages behind a sign-in load the rest, in accounts.test.ts.
    const signedInOnly = ["developer-settings", "payments-amounts", "access-choices", "connect-app", "keys-check", "new-password", "passkey-add", "account-confirm", "social-settings", "local-times", "upload", "friends", "joined", "back-to-app", "show-password", "username-check", "protect-account", "qr-png", "background-preview"];
    // Screens (components/screens.ts) puts these in each page it shows, rather than a page linking them.
    const putInByScreens = ["layout-measure", "layout-inspect"];
    const names = new Set([...loaded].map((path) => path.slice("/js/".length).replace(/\.[0-9a-f]{16}\.js$/, "")));
    expect(pageScripts().map((script) => script.name).filter((name) => !names.has(name) && !signedInOnly.includes(name) && !putInByScreens.includes(name))).toEqual([]);
  });
});

describe("zaisma.com's transport", () => {
  it("sends Strict-Transport-Security over https", async () => {
    const response = await SELF.fetch(`${SITE}/`);
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
  });

  it("sends plain http on its own address to https, keeping the path and query", async () => {
    const response = await SELF.fetch("http://zaisma.test/g/some-game?x=1", { redirect: "manual" });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://zaisma.test/g/some-game?x=1");
  });

  it("leaves other plain http addresses (local preview, tests) alone", async () => {
    const response = await SELF.fetch(`${LOCAL}/`, { redirect: "manual" });
    expect(response.status).not.toBe(308);
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });
});

describe("Zaisma's own scrollbar, never the browser's", () => {
  it("is checked on every page above: the check finds a page without the page's rail, the components' script or with a scrollbar shown", () => {
    const script = '<script src="/js/components.0123456789abcdef.js" defer blocking="render"></script>';
    expect(defaultScrollbarProblems(`<!doctype html><html><head>${script}</head><body><div class="rail" data-rail="page"></div></body></html>`)).toEqual([]);
    expect(defaultScrollbarProblems(`<!doctype html><html><head>${script}</head><body></body></html>`)).toHaveLength(1);
    expect(defaultScrollbarProblems('<!doctype html><html><body><div data-rail="page"></div></body></html>')).toHaveLength(1);
    expect(defaultScrollbarProblems(`<!doctype html><html><head>${script}<style>.list { scrollbar-width: thin; }</style></head><body><div data-rail="page"></div></body></html>`)).toEqual(["shows the browser's scrollbar: scrollbar-width: thin"]);
    // A part of a page is inside one that has them.
    expect(defaultScrollbarProblems("<ul><li>Room 1</li></ul>")).toEqual([]);
  });

  it("is hidden wherever Zaisma's rail takes its place", async () => {
    const page = await (await SELF.fetch(`${SITE}/signin`)).text();
    const styles = await (await SELF.fetch(`${SITE}${page.match(/href="(\/css\/site\.[0-9a-f]+\.css)"/)![1]}`)).text();
    expect(styles).toMatch(/\.own-scroll(:where\([^)]*\)[^{]*)? ?\{ ?scrollbar-width: none; ?\}/);
    expect(styles).toMatch(/\.own-scroll(:where\([^)]*\))?[^{]*::-webkit-scrollbar[^{]*\{ ?display: none; ?\}/);
  });
});
