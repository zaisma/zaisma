import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey } from "@zaisma/core";
import { SPECULATION_RULES, SPECULATION_RULES_PATH } from "../../apps/site/src/prepared-pages.ts";
import { pageScripts } from "../../apps/site/src/page-scripts.ts";
import { layout, html } from "../../apps/site/src/html.ts";
import { callerFor } from "../../apps/site/src/developer.ts";
import { getTopic, markTopicSeen } from "../../apps/site/src/forum.ts";

/** Pages prepared ahead of a tap ("Page switches that never wait"): what's prepared, and that a prepared page acts on nothing until opened. */
const SITE = "https://zaisma.test";

/** The body's script tags of a page, as written. */
const bodyScripts = (page: string): string[] => page.slice(page.indexOf("<body")).match(/<script\b[^>]*>/g) ?? [];

describe("the speculation rules", () => {
  it("prerender a link the pointer rests on or presses, and fetch what a phone marks on screen", () => {
    expect(SPECULATION_RULES.prerender).toEqual([expect.objectContaining({ source: "document", eagerness: "moderate" })]);
    expect(SPECULATION_RULES.prefetch).toEqual([expect.objectContaining({ source: "document", eagerness: "immediate" })]);
    const text = JSON.stringify(SPECULATION_RULES);
    for (const never of ["/api/*", "/admin/*", "/signout", "/mcp", "/t/*", "/g/*/*"]) expect(text).toContain(JSON.stringify({ pathname: never }));
    expect(text).toContain("[data-prepared-ahead]");
    expect(text).toContain("[data-never-prepared]");
  });

  it("are served at an address named for their contents, kept for good, and named by every page", async () => {
    expect(SPECULATION_RULES_PATH).toMatch(/^\/speculation-rules\.[0-9a-f]{16}\.json$/);
    const served = await SELF.fetch(`${SITE}${SPECULATION_RULES_PATH}`);
    expect(served.headers.get("content-type")).toBe("application/speculationrules+json");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(await served.json()).toEqual(SPECULATION_RULES);
    // A page from before a deploy names an older address: today's rules, never kept.
    const older = await SELF.fetch(`${SITE}/speculation-rules.json`);
    expect(older.headers.get("cache-control")).toBe("no-store");
    expect(await older.json()).toEqual(SPECULATION_RULES);
    const page = await SELF.fetch(`${SITE}/legal/terms`);
    expect(page.headers.get("speculation-rules")).toBe(`"${SPECULATION_RULES_PATH}"`);
    await page.arrayBuffer();
  });
});

describe("a page prepared ahead", () => {
  it("holds every script but the reviewed few until it's opened, and the browser may keep it half a minute", async () => {
    for (const purpose of [["sec-purpose", "prefetch;prerender"], ["sec-purpose", "prefetch"], ["purpose", "prefetch"]] as [string, string][]) {
      const prepared = await SELF.fetch(`${SITE}/legal/terms`, { headers: [purpose] });
      expect(prepared.status).toBe(200);
      expect(prepared.headers.get("cache-control")).toBe("private, max-age=30");
      expect(prepared.headers.get("vary")).toContain("Cookie");
      const page = await prepared.text();
      expect(page).toMatch(/<html [^>]*data-prepared-ahead/);
      // The page's script files are named at its body's end and run by its first-paint script (html.ts): the held ones are marked.
      const files = [...page.matchAll(/<link rel="preload" as="script" href="(\/js\/[^"]+)"[^>]*data-page-script[^>]*>/g)];
      const held = files.filter((file) => file[0].includes("data-when-opened")).map((file) => file[1]!);
      expect(held.length).toBeGreaterThan(2);
      expect(held.join("")).toContain("/js/site.");
      expect(held.join("")).toContain("/js/presence.");
      expect(files.filter((file) => !file[0].includes("data-when-opened")).map((file) => file[1])).toEqual([]);
      expect(bodyScripts(page).at(-1)).toContain('src="/js/when-opened.');
      // The first-paint pieces the page carries draw it while it's prepared: first in its body, before anything it shows.
      expect(page.slice(page.indexOf("<body>"))).toMatch(/^<body>\n<script>/);
    }
  });

  it("is a page like any other when it isn't prepared", async () => {
    const page = await (await SELF.fetch(`${SITE}/legal/terms`)).text();
    expect(page).not.toContain("data-prepared-ahead");
    expect(page).not.toContain("zaisma/when-opened");
    expect(page).not.toContain("/js/when-opened.");
  });

  it("runs only scripts reviewed to fetch, count and wake nothing", () => {
    const reviewed = pageScripts().filter((script) => script.runsWhilePreparedBecause).map((script) => script.name);
    // A script added here is one more that runs on a page the player may never open: review it first.
    expect(reviewed.sort()).toEqual(["styles-applied", "when-opened"]);
    for (const name of reviewed) expect(pageScripts().find((script) => script.name === name)!.sourceText).not.toMatch(/fetch\(|sendBeacon|WebSocket|EventSource|setInterval/);
  });

  it("opens in its game's glass tint, from the server", async () => {
    const page = await layout(env, { title: "Worlds on Zaisma", body: html`<p>Worlds</p>`, glassHue: "#12abef", stageColor: "#203040" }).text();
    expect(page).toMatch(/<html [^>]*style="--backdrop-edge: #203040; --glass-hue: #12abef"/);
    expect((await layout(env, { title: "Worlds", body: html`<p>Worlds</p>`, glassHue: "red" }).text()).match(/<html[^>]*>/)![0]).not.toContain("--glass-hue");
  });
});

describe("a forum topic prepared ahead", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM forum_posts; DELETE FROM forum_follows; DELETE FROM forum_search; DELETE FROM forum_topics; DELETE FROM api_keys; DELETE FROM accounts;");
    await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  });

  it("leaves the topic unseen until it's opened", async () => {
    const { token } = await createApiKey(env.DB, "dev-1", "claude");
    const posted = await SELF.fetch(`${SITE}/api/dev/forum`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ is_public: false, kind: "question", title: "Rooms on my own server?", text_markdown: "How?" }) });
    const topicId = ((await posted.json()) as { topic: { id: string } }).topic.id;
    await env.DB.prepare("UPDATE forum_follows SET seen_at_ms = 1 WHERE topic_id = ?").bind(topicId).run();
    const seenAtMs = async () => (await env.DB.prepare("SELECT seen_at_ms FROM forum_follows WHERE topic_id = ? AND account_id = 'dev-1'").bind(topicId).first<{ seen_at_ms: number }>())!.seen_at_ms;
    const caller = (await callerFor(env, new Request(SITE), "dev-1"))!;
    await getTopic(env, caller, topicId, { isMarkingSeen: false });
    expect(await seenAtMs()).toBe(1);
    await markTopicSeen(env, caller, topicId);
    expect(await seenAtMs()).toBeGreaterThan(1);
  });
});
