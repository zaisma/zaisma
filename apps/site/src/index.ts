import { deleteDueGames } from "./game-deletion.ts";
import { upgradeToHttps, withTransportSecurity, type ScanJob } from "@zaisma/core";
import { handleAccount } from "./account.ts";
import { DAILY_SIGN_IN_SWEEP_MS, RECENT_SIGN_IN_SWEEP_MS, dailyCleanup, deleteAbandonedSignIns, publishDue } from "./cleanup.ts";
import { handleAdmin } from "./admin.ts";
import { handleDashboard } from "./dashboard.ts";
import { handleDeveloper } from "./developer.ts";
import type { Env } from "./env.ts";
import { message } from "./html.ts";
import { handleMcp } from "./mcp.ts";
import { handleGithubSecretScanning } from "./leaked-keys.ts";
import { recordBlockedScripts } from "./security-alerts.ts";
import { pageScriptResponse } from "./page-scripts.ts";
import { handlePlayed, home } from "./home.ts";
import { handlePlays } from "./plays.ts";
import { gamePage, legal, previewPage, testerEnter, testerPage } from "./pages.ts";
import { reportForm, submitReport } from "./report.ts";
import { roomsFragment } from "./rooms.ts";
import { handlePasskeys } from "./passkeys.ts";
import { handleSignIn } from "./sign-in.ts";
import { handleSaves } from "./saves.ts";
import { handleScanBatch, queueImageChecks, rescanWaiting } from "./scan.ts";
import { triageReports } from "./triage.ts";
import { sortMisplaced, sortTopics } from "./forum-sort.ts";
import { moveFiles } from "./file-moves.ts";
import { checkForumPosts } from "./forum-check.ts";
import { checkProfiles } from "./profile-check.ts";
import { reviewChatMessages } from "./chat-review.ts";
import { handleForum } from "./forum-pages.ts";
import { handleFriends } from "./friends.ts";
import { handleBlocks } from "./blocks.ts";
import { handleFriendsNow } from "./friends-now.ts";
import { handlePlayersSheet } from "./players-sheet.ts";
import { handleProfiles } from "./profiles.ts";
import { deliverDueWebhooks, noticeFreeUseAlerts, tellAlertNotices, tellGameServerErrors, eraseDuePlayers } from "./webhooks.ts";
import { handleGameLinks, recheckLinks } from "./game-links.ts";

// The chat filter's AI step, for the rooms Worker (its CHAT_CHECK binding).
export { ChatCheckService } from "./chat-check.ts";

/** Must match the daily cron in wrangler.jsonc. */
const DAILY = "17 3 * * *";

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  // Pages' script files (page-scripts.ts): every module that makes one is imported above, so all are known.
  if (path.startsWith("/js/")) return method === "GET" || method === "HEAD" ? pageScriptResponse(path) : new Response("Method not allowed", { status: 405 });
  if (path === "/admin" || path.startsWith("/admin/")) return handleAdmin(request, env, path);
  if (path === "/mcp") return handleMcp(request, env, ctx);
  if (path === "/github/secret-scanning") return handleGithubSecretScanning(request, env);
  if (path === "/csp-reports") return method === "POST" ? recordBlockedScripts(request, env) : new Response("Method not allowed", { status: 405 });
  const developer = await handleDeveloper(request, env, path, ctx);
  if (developer) return developer;
  // Sign in with Zaisma, before the method check: other sites' pages ask first (OPTIONS).
  const signIn = await handleSignIn(request, env, path);
  if (signIn) return signIn;
  if (method !== "GET" && method !== "HEAD" && method !== "POST" && !(method === "PUT" && path.startsWith("/api/saves/"))) return new Response("Method not allowed", { status: 405 });

  if (path === "/" && method !== "POST") return home(env, request);

  const played = await handlePlayed(request, env, path);
  if (played) return played;

  const plays = await handlePlays(request, env, path);
  if (plays) return plays;

  const links = await handleGameLinks(request, env, path);
  if (links) return links;

  // /api/saves/<game>, its /copies, one copy (any ID: an unknown one answers no_save_copy) and its /restore.
  const save = path.match(/^\/api\/saves\/([a-z0-9-]+)(\/copies(?:\/([^/]{1,100})(\/restore)?)?)?$/);
  if (save) return handleSaves(request, env, save[1]!, save[2] ? { saveCopyId: save[3] ?? null, isRestore: Boolean(save[4]) } : null);

  const dashboard = await handleDashboard(request, env, path);
  if (dashboard) return dashboard;

  const forum = await handleForum(request, env, path);
  if (forum) return forum;

  const passkeys = await handlePasskeys(request, env, path);
  if (passkeys) return passkeys;

  const account = await handleAccount(request, env, path, ctx.waitUntil.bind(ctx));
  if (account) return account;

  const blocks = await handleBlocks(request, env, path);
  if (blocks) return blocks;

  const playersSheet = await handlePlayersSheet(request, env, path);
  if (playersSheet) return playersSheet;

  const friends = await handleFriends(request, env, path);
  if (friends) return friends;
  const friendsNow = await handleFriendsNow(request, env, path);
  if (friendsNow) return friendsNow;

  const profile = await handleProfiles(request, env, path);
  if (profile) return profile;

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
  const tester = path.match(/^\/t\/([a-z0-9]{20})(\/enter)?$/);
  if (tester && !tester[2] && method !== "POST") return testerPage(env, tester[1]!, request, ctx);
  if (tester && tester[2] && method === "POST") return testerEnter(env, tester[1]!, request);
  // A version's preview link: it opens the version full page at the game's preview address.
  const preview = path.match(/^\/p\/([A-Za-z0-9_.-]{1,140})$/);
  if (preview && method !== "POST") return previewPage(env, preview[1]!);

  const legalPage = path.match(/^\/legal\/([a-z-]+)$/);
  if (legalPage && method !== "POST") {
    const response = legal(env, legalPage[1]!);
    if (response) return response;
  }

  if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /friends\nDisallow: /join\nDisallow: /signin\nDisallow: /oauth/\nDisallow: /.well-known/oauth-\nDisallow: /api/\nDisallow: /t/\nDisallow: /p/\n", { headers: { "Content-Type": "text/plain" } });
  return message(env, "Page not found", "There's nothing at this address.", 404);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    // Only on the production address: tests and the local preview run over plain http.
    if (url.protocol === "http:" && env.SITE_ORIGIN.startsWith("https://") && url.hostname === new URL(env.SITE_ORIGIN).hostname) return upgradeToHttps(url);
    return withTransportSecurity(url, await route(request, env, ctx));
  },

  async queue(batch, env): Promise<void> {
    await handleScanBatch(batch, env);
  },

  async scheduled(event, env): Promise<void> {
    // One failing job mustn't stop the others.
    const jobs = await Promise.allSettled([moveFiles(env), publishDue(env), triageReports(env), sortTopics(env), sortMisplaced(env), checkForumPosts(env), checkProfiles(env), reviewChatMessages(env), deliverDueWebhooks(env), eraseDuePlayers(env), deleteDueGames(env), noticeFreeUseAlerts(env).then(() => tellAlertNotices(env)), tellGameServerErrors(env), recheckLinks(env), rescanWaiting(env), deleteAbandonedSignIns(env, event.cron === DAILY ? DAILY_SIGN_IN_SWEEP_MS : RECENT_SIGN_IN_SWEEP_MS), ...(event.cron === DAILY ? [dailyCleanup(env), queueImageChecks(env)] : [])]);
    for (const job of jobs) if (job.status === "rejected") console.error("scheduled job failed", job.reason);
  },
} satisfies ExportedHandler<Env, ScanJob>;
