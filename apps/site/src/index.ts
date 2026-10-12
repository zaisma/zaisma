import type { ScanJob } from "@zaisma/core";
import { handleAccount } from "./account.ts";
import { dailyCleanup, publishDue } from "./cleanup.ts";
import { handleAdmin } from "./admin.ts";
import { handleDashboard } from "./dashboard.ts";
import { handleDeveloper } from "./developer.ts";
import type { Env } from "./env.ts";
import { message } from "./html.ts";
import { handleMcp } from "./mcp.ts";
import { handlePlayed, home } from "./home.ts";
import { gamePage, legal } from "./pages.ts";
import { reportForm, submitReport } from "./report.ts";
import { handlePasskeys } from "./passkeys.ts";
import { handleSaveHistory, handleSaves } from "./saves.ts";
import { handleScanBatch } from "./scan.ts";

/** Must match the daily cron in wrangler.jsonc. */
const DAILY = "17 3 * * *";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (path === "/admin" || path.startsWith("/admin/")) return handleAdmin(request, env, path);
    if (path === "/mcp") return handleMcp(request, env);
    const developer = await handleDeveloper(request, env, path);
    if (developer) return developer;
    if (method !== "GET" && method !== "HEAD" && method !== "POST" && !(method === "PUT" && path.startsWith("/api/saves/"))) return new Response("Method not allowed", { status: 405 });

    if (path === "/" && method !== "POST") return home(env);

    const played = await handlePlayed(request, env, path);
    if (played) return played;

    const save = path.match(/^\/api\/saves\/([a-z0-9-]+)$/);
    if (save) return handleSaves(request, env, save[1]!);

    const dashboard = await handleDashboard(request, env, path);
    if (dashboard) return dashboard;

    const passkeys = await handlePasskeys(request, env, path);
    if (passkeys) return passkeys;

    const history = await handleSaveHistory(request, env, path);
    if (history) return history;

    const account = await handleAccount(request, env, path);
    if (account) return account;

    const game = path.match(/^\/g\/([a-z0-9-]+)(\/report)?$/);
    if (game) {
      const [, slug, report] = game as unknown as [string, string, string | undefined];
      if (!report && method !== "POST") return gamePage(env, slug, url);
      if (report && method === "POST") return submitReport(env, request, slug, ctx);
      if (report) return reportForm(env, slug);
    }

    const legalPage = path.match(/^\/legal\/([a-z-]+)$/);
    if (legalPage && method !== "POST") {
      const res = legal(env, legalPage[1]!);
      if (res) return res;
    }

    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /join\nDisallow: /signin\nDisallow: /api/\n", { headers: { "Content-Type": "text/plain" } });
    return message(env, "Page not found", "There's nothing at this address.", 404);
  },

  async queue(batch, env): Promise<void> {
    await handleScanBatch(batch, env);
  },

  async scheduled(event, env): Promise<void> {
    await publishDue(env);
    if (event.cron === DAILY) await dailyCleanup(env);
  },
} satisfies ExportedHandler<Env, ScanJob>;
