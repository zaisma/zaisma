import { deleteDueGames } from "./game-deletion.ts";
import { gameBySlug, upgradeToHttps, withTransportSecurity, type ListingCheckJob, type ScanJob, type ShaderCheckJob } from "@zaisma/core";
import { qrCodeImage, sitemap } from "./share-cards.ts";
import { handleAccount } from "./account.ts";
import { DAILY_SIGN_IN_SWEEP_MS, RECENT_SIGN_IN_SWEEP_MS, dailyCleanup, deleteAbandonedSignIns, publishDue } from "./cleanup.ts";
import { handleAdmin } from "./admin.ts";
import { handleDashboard } from "./dashboard.ts";
import { handleDeveloper } from "./developer.ts";
import type { Env } from "./env.ts";
import { SPECULATION_RULES, SPECULATION_RULES_PATH, message } from "./html.ts";
import { handleMcp } from "./mcp.ts";
import { handleGithubSecretScanning } from "./leaked-keys.ts";
import { recordBlockedScripts } from "./security-alerts.ts";
import { pageScriptResponse } from "./page-scripts.ts";
import { pageStyleResponse } from "./page-styles.ts";
import { browsePage } from "./browse.ts";
import { handlePlayed, home } from "./home.ts";
import { handlePlays } from "./plays.ts";
import { gamePage, legal, previewPage, testerEnter, testerPage } from "./pages.ts";
import { reportForm, submitReport } from "./report.ts";
import { liveVersionAnswer } from "./game-updates.ts";
import { roomsFragment } from "./rooms.ts";
import { handlePasskeys } from "./passkeys.ts";
import { handleSignIn } from "./sign-in.ts";
import { handleSaves } from "./saves.ts";
import { handleScanBatch, queueImageChecks, rescanWaiting } from "./scan.ts";
import { queueMissingCompression } from "./compress.ts";
import { handlePerformanceBatch, type PerformanceJob } from "./performance-check.ts";
import { handleBackupMessage, startBackupRun, type BackupPart } from "./backups.ts";
import { queueListingChecks, runListingCheck } from "./listing-check.ts";
import { checkShaderFromQueue, queueShaderChecks } from "./shader-check.ts";
import { coverGuidePage } from "./cover-guide.ts";
import { BACKGROUND_GUIDE_PATH, backgroundGuidePage, backgroundSourceResponse } from "./background-guide.ts";
// Every component of the look (components/), defined before the first request, and the gallery that shows them.
import "./components/index.ts";
import { designPage } from "./design-page.ts";
import { testWaitingReviewPrecedents } from "./review-precedent-tests.ts";
import { triageReports } from "./triage.ts";
import { sortMisplaced, sortTopics } from "./forum-sort.ts";
import { moveFiles } from "./file-moves.ts";
import { checkForumPosts } from "./forum-check.ts";
import { checkProfiles } from "./profile-check.ts";
import { reviewChatMessages } from "./chat-review.ts";
import { handleForum } from "./forum-pages.ts";
import { handleAnnouncements } from "./announcements.ts";
import { handleFriends } from "./friends.ts";
import { handleBlocks } from "./blocks.ts";
import { handleFriendsNow } from "./friends-now.ts";
import { handlePlayersSheet } from "./players-sheet.ts";
import { handleProfiles } from "./profiles.ts";
import { deliverDueWebhooks, tellAlertNotices, tellGameServerErrors, eraseDuePlayers } from "./webhooks.ts";
import { runHostingJob } from "./hosting-job.ts";
import { handleStripeEvents } from "./stripe-events.ts";
import { handleStripeConnectEvents } from "./stripe-connect-events.ts";
import { handleGameLinks, recheckLinks } from "./game-links.ts";
import { watchHealth } from "./health-alerts.ts";
import { SECURITY_TEXT_FILE_PATH, securityTextFile } from "./security-policy.ts";
import { viewerOf } from "./viewer.ts";
import { failStaleSales, handleBuy } from "./buy.ts";
import { handleConnectReturn } from "./stripe-account-api.ts";

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
  if (path.startsWith("/css/")) return method === "GET" || method === "HEAD" ? pageStyleResponse(path) : new Response("Method not allowed", { status: 405 });
  // The speculation rules every page's Speculation-Rules header names (html.ts), the same for everyone.
  if (path === SPECULATION_RULES_PATH) {
    if (method !== "GET" && method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    return new Response(JSON.stringify(SPECULATION_RULES), { headers: { "Content-Type": "application/speculationrules+json", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  }
  if (path === "/admin" || path.startsWith("/admin/")) return handleAdmin(request, env, path);
  if (path === "/mcp") return handleMcp(request, env, ctx);
  if (path === "/github/secret-scanning") return handleGithubSecretScanning(request, env);
  if (path === "/stripe/events") return handleStripeEvents(request, env);
  if (path === "/stripe/connect-events") return handleStripeConnectEvents(request, env);
  if (path === "/csp-reports") return method === "POST" ? recordBlockedScripts(request, env) : new Response("Method not allowed", { status: 405 });
  const developer = await handleDeveloper(request, env, path, ctx);
  if (developer) return developer;
  // Sign in with Zaisma, before the method check: other sites' pages ask first (OPTIONS).
  const signIn = await handleSignIn(request, env, path);
  if (signIn) return signIn;
  // The buy sheet's own calls, before the method check: a saved card and the purchase PIN are PUT and DELETE.
  const buy = await handleBuy(request, env, path);
  if (buy) return buy;
  if (path === "/stripe/connect-return" && method === "GET") return handleConnectReturn(request, env);
  if (method !== "GET" && method !== "HEAD" && method !== "POST" && !(method === "PUT" && path.startsWith("/api/saves/"))) return new Response("Method not allowed", { status: 405 });

  if (path === "/" && method !== "POST") return home(env, request);
  if (path === "/games" && (method === "GET" || method === "HEAD")) return browsePage(env, request);

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

  const announcements = await handleAnnouncements(request, env, path);
  if (announcements) return announcements;

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

  const game = path.match(/^\/g\/([a-z0-9-]+)(\/report|\/rooms|\/qr-code\.svg|\/live-version)?$/);
  if (game) {
    const [, slug, sub] = game as unknown as [string, string, string | undefined];
    if (sub === "/rooms" && method === "GET") return roomsFragment(env, slug, request);
    if (sub === "/live-version" && method === "GET") return liveVersionAnswer(env, slug);
    if (sub === "/qr-code.svg" && method === "GET") return qrCodeImage(env, await gameBySlug(env.DB, slug), request);
    const report = sub === "/report";
    if (!sub && method !== "POST") return gamePage(env, slug, request);
    if (report && method === "POST") return submitReport(env, request, slug, ctx);
    if (report) return reportForm(env, slug, "", 200, await viewerOf(request, env));
  }

  // A tester link: the game page for a game that may be private, for anyone with the link.
  const tester = path.match(/^\/t\/([a-z0-9]{20})(\/enter)?$/);
  if (tester && !tester[2] && method !== "POST") return testerPage(env, tester[1]!, request, ctx);
  if (tester && tester[2] && method === "POST") return testerEnter(env, tester[1]!, request);
  // A version's preview link: it opens the version full page at the game's preview address.
  const preview = path.match(/^\/p\/([A-Za-z0-9_.-]{1,140})$/);
  if (preview && method !== "POST") return previewPage(env, preview[1]!);

  if (path === "/developers/covers" && method === "GET") return coverGuidePage(env, await viewerOf(request, env));
  if (path === BACKGROUND_GUIDE_PATH && method === "GET") return backgroundGuidePage(env, await viewerOf(request, env));
  // A stand-in world's source, as plain text to start from.
  const backgroundSource = path.match(/^\/developers\/backgrounds\/([a-z0-9-]+)\.glsl$/);
  if (backgroundSource && method === "GET") {
    const source = backgroundSourceResponse(backgroundSource[1]!);
    if (source) return source;
  }
  // The developer front door: the dashboard until the developer page is built.
  if (path === "/developers" && method === "GET") return Response.redirect(new URL("/dashboard", request.url).toString(), 302);
  if ((path === "/design" || path.startsWith("/design/")) && method === "GET") {
    const gallery = designPage(env, url);
    if (gallery) return gallery;
  }

  const legalPage = path.match(/^\/legal\/([a-z-]+)$/);
  if (legalPage && method !== "POST") {
    const response = legal(env, legalPage[1]!);
    if (response) return response;
  }

  if (path === SECURITY_TEXT_FILE_PATH) return securityTextFile(env.SITE_ORIGIN);
  if (path === "/sitemap.xml" && method === "GET") return sitemap(env);
  if (path === "/robots.txt") return new Response(`User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /friends\nDisallow: /join\nDisallow: /signin\nDisallow: /oauth/\nDisallow: /.well-known/oauth-\nDisallow: /api/\nDisallow: /t/\nDisallow: /p/\nSitemap: ${env.SITE_ORIGIN}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain" } });
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
    // Versions to open in Chrome have a queue of their own (zaisma-performance, or its stand-in in tests).
    if (batch.queue.startsWith("zaisma-performance")) return handlePerformanceBatch(batch as MessageBatch<PerformanceJob>, env);
    // The night's copy to Backblaze (zaisma-backup): one part a message.
    if (batch.queue.startsWith("zaisma-backup")) {
      for (const message of (batch as unknown as MessageBatch<BackupPart>).messages) await handleBackupMessage(env, message);
      return;
    }
    const scans: Message<ScanJob>[] = [];
    for (const message of batch.messages) {
      const body = message.body;
      if ("shaderCheckId" in body) {
        await checkShaderFromQueue(env, message as Message<ShaderCheckJob>);
        continue;
      }
      if (!("listingCheckGameId" in body)) {
        scans.push(message as Message<ScanJob>);
        continue;
      }
      try {
        await runListingCheck(env, body.listingCheckGameId);
        message.ack();
      } catch (error) {
        // The cron asks again for a check that keeps failing; the pictures wait for a person meanwhile.
        console.error("listing check failed", body.listingCheckGameId, error);
        if (message.attempts >= 3) message.ack();
        else message.retry({ delaySeconds: 30 * message.attempts });
      }
    }
    if (scans.length) await handleScanBatch({ ...batch, messages: scans } as MessageBatch<ScanJob>, env);
  },

  async scheduled(event, env): Promise<void> {
    // One failing job mustn't stop the others.
    const jobs = await Promise.allSettled([moveFiles(env), publishDue(env), triageReports(env), sortTopics(env), sortMisplaced(env), checkForumPosts(env), checkProfiles(env), reviewChatMessages(env), deliverDueWebhooks(env), eraseDuePlayers(env), deleteDueGames(env), runHostingJob(env).then(() => tellAlertNotices(env)), tellGameServerErrors(env), recheckLinks(env), rescanWaiting(env), watchHealth(env), testWaitingReviewPrecedents(env), queueListingChecks(env), queueShaderChecks(env), deleteAbandonedSignIns(env, event.cron === DAILY ? DAILY_SIGN_IN_SWEEP_MS : RECENT_SIGN_IN_SWEEP_MS), ...(event.cron === DAILY ? [dailyCleanup(env), failStaleSales(env), queueImageChecks(env), queueMissingCompression(env), startBackupRun(env)] : [])]);
    for (const job of jobs) if (job.status === "rejected") console.error("scheduled job failed", job.reason);
  },
} satisfies ExportedHandler<Env, ScanJob | ListingCheckJob | ShaderCheckJob>;
