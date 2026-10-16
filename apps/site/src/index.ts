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
import { handlePlays } from "./plays.ts";
import { gamePage, legal, testerPage } from "./pages.ts";
import { reportForm, submitReport } from "./report.ts";
import { roomsFragment } from "./rooms.ts";
import { handlePasskeys } from "./passkeys.ts";
import { handleSignIn } from "./sign-in.ts";
import { handleSaveHistory, handleSaves } from "./saves.ts";
import { handleScanBatch, queueImageChecks } from "./scan.ts";
import { triageReports } from "./triage.ts";
import { sortMisplaced, sortTopics } from "./forum-sort.ts";
import { moveFiles } from "./file-moves.ts";
import { checkForumPosts } from "./forum-check.ts";
import { handleForum } from "./forum-pages.ts";
import { handleFriends } from "./friends.ts";

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
    // Sign in with Zaisma, before the method check: other sites' pages ask first (OPTIONS).
    const signIn = await handleSignIn(request, env, path);
    if (signIn) return signIn;
    if (method !== "GET" && method !== "HEAD" && method !== "POST" && !(method === "PUT" && path.startsWith("/api/saves/"))) return new Response("Method not allowed", { status: 405 });

    if (path === "/" && method !== "POST") return home(env);

    const played = await handlePlayed(request, env, path);
    if (played) return played;

    const plays = await handlePlays(request, env, path);
    if (plays) return plays;

    const save = path.match(/^\/api\/saves\/([a-z0-9-]+)$/);
    if (save) return handleSaves(request, env, save[1]!);

    const dashboard = await handleDashboard(request, env, path);
    if (dashboard) return dashboard;

    const forum = await handleForum(request, env, path);
    if (forum) return forum;

    const passkeys = await handlePasskeys(request, env, path);
    if (passkeys) return passkeys;

    const history = await handleSaveHistory(request, env, path);
    if (history) return history;

    const account = await handleAccount(request, env, path);
    if (account) return account;

    const friends = await handleFriends(request, env, path);
    if (friends) return friends;

    const game = path.match(/^\/g\/([a-z0-9-]+)(\/report|\/rooms)?$/);
    if (game) {
      const [, slug, sub] = game as unknown as [string, string, string | undefined];
      if (sub === "/rooms" && method === "GET") return roomsFragment(env, slug, request);
      const report = sub === "/report";
      if (!sub && method !== "POST") return gamePage(env, slug, request);
      if (report && method === "POST") return submitReport(env, request, slug, ctx);
      if (report) return reportForm(env, slug);
    }

    // A tester link: the game page for a game that may be private, for anyone with the link.
    const tester = path.match(/^\/t\/([a-z0-9]{20})$/);
    if (tester && method !== "POST") return testerPage(env, tester[1]!, request, ctx);

    const legalPage = path.match(/^\/legal\/([a-z-]+)$/);
    if (legalPage && method !== "POST") {
      const response = legal(env, legalPage[1]!);
      if (response) return response;
    }

    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /friends\nDisallow: /join\nDisallow: /signin\nDisallow: /oauth/\nDisallow: /api/\nDisallow: /t/\n", { headers: { "Content-Type": "text/plain" } });
    return message(env, "Page not found", "There's nothing at this address.", 404);
  },

  async queue(batch, env): Promise<void> {
    await handleScanBatch(batch, env);
  },

  async scheduled(event, env): Promise<void> {
    // One failing job mustn't stop the others.
    const jobs = await Promise.allSettled([moveFiles(env), publishDue(env), triageReports(env), sortTopics(env), sortMisplaced(env), checkForumPosts(env), ...(event.cron === DAILY ? [dailyCleanup(env), queueImageChecks(env)] : [])]);
    for (const job of jobs) if (job.status === "rejected") console.error("scheduled job failed", job.reason);
  },
} satisfies ExportedHandler<Env, ScanJob>;
