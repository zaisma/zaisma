import {
  BUILT_IN_GAME_SERVERS,
  KNOWN_IMAGE_CODE,
  SANDBOX_GAME_SERVER,
  ZIP_LIMITS,
  AUTO_HOLD_REASONS,
  SEVERITIES,
  SEVERITY,
  reportLabel,
  reportPictureKey,
  PLAYER_REPORT_REASONS,
  ZAISMA_PLAYER_REPORT_REASONS,
  isForZaisma,
  stopSocial,
  clearVersion,
  closeReportGroup,
  UploadError,
  aiUsage,
  allGames,
  audit,
  auditLog,
  closeReports,
  gameById,
  heldVersions,
  openReports,
  ownServerUrlsOf,
  publishVersion,
  saveScan,
  setReviewStatus,
  setMultiplayer,
  setCloudSavesEnabled,
  accountById,
  gameOwner,
  personOwner,
  setGameOwner,
  versionById,
  versionsForGame,
  gamesWithDetailsWaitingForReview,
  imageById,
  imageKey,
  cardImageKey,
  imagesForGame,
  pendingImages,
  settleDetailsWaitingForReview,
  settleImage,
  CONTENT_RULES,
  NOTICE_CODES,
  NOTICE_KINDS,
  decidedReason,
  isContentRule,
  isNoticeKind,
  isNoticeReason,
  readReviewReason,
  reviewModelOf,
  type ContentRule,
  type GameImage,
  type ReviewStatus,
  type PrecedentDecision,
  type Report,
  type ScanReport,
  type Version,
  type Triage,
  gameDeletionOf,
  queueGameDeletion,
} from "@zaisma/core";
import { adminProfileAction, adminProfilesPage, clearProfile } from "./admin-profiles.ts";
import { sendAlert } from "./email.ts";
import { adminChatReviewAction, adminChatReviewsPage } from "./admin-chat-reviews.ts";
import { adminPublishingAction, adminPublishingPage } from "./admin-publishing.ts";
import { adminIdentity } from "./access.ts";
import { gameUrl, type Env } from "./env.ts";
import { html, layout, raw, type Raw } from "./html.ts";
import { handleAdminMcp } from "./admin-mcp.ts";
import { adminFeedbackAction, adminFeedbackPage, feedbackSummary } from "./admin-feedback.ts";
import { precedentAction, precedentsPage, savePrecedent } from "./precedents.ts";
import { clearCountedDay, playSpikes } from "./plays.ts";
import { KNOWN_IMAGE_ALERT, passVersion } from "./scan.ts";
import { ownerUsername, stopCopy } from "./copies.ts";
import { uploadGame } from "./upload.ts";
import { tellWebhooks } from "./webhooks.ts";

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const pill = (label: string) => html`<span class="pill ${label}">${label}</span>`;
/** A version with pictures that matched known abuse material: never approved, only kept and reported. */
const knownImages = (version: Version) => (version.scan_report ? (JSON.parse(version.scan_report) as ScanReport).findings.some((finding) => finding.code === KNOWN_IMAGE_CODE) : false);

/** The content rule a person picked for a decision (content_rule in the form), or null for none. */
const pickedRule = (form: FormData): ContentRule | null => {
  const picked = form.get("content_rule");
  return isContentRule(picked) ? picked : null;
};

/**
 * What a person picks and writes when they hold something back: the content rule it broke and why,
 * which the developer reads (never for child safety). A takedown needs both. Notices hold a game from its own form.
 */
function decisionFields(options: { isTakedown?: boolean }): Raw {
  const isTakedown = Boolean(options.isTakedown);
  return html`${ruleSelect({ contentRule: null, isRequired: isTakedown })}
<input name="reason" placeholder="${isTakedown ? "Why (required; the developer reads it)" : "Why (the developer reads it)"}" maxlength="500" size="36"${isTakedown ? raw(" required") : ""}>`;
}

/** The content rules to pick from. */
function ruleSelect(options: { contentRule: string | null; isRequired: boolean }): Raw {
  return html`<select name="content_rule" aria-label="The rule it broke"${options.isRequired ? raw(" required") : ""}>
  <option value="">${options.isRequired ? "The rule it broke…" : "No rule broken"}</option>
  ${Object.entries(CONTENT_RULES).map(([rule, text]) => html`<option value="${rule}" title="${text}"${options.contentRule === rule ? raw(" selected") : ""}>${rule.replace(/_/g, " ")}</option>`)}
</select>`;
}

/**
 * A copyright or defamation notice holds the game without Zaisma judging it. It shows again once a
 * person checks a fixed version (publishing one emails Zaisma), or 10 working days after a
 * counter-notice reached the sender, unless they say they've gone to court.
 */
function noticeSection(gameId: string, reviewStatus: ReviewStatus, reason: ReturnType<typeof readReviewReason>): Raw {
  if (reviewStatus === "removed") return html`<p class="note">Taken down, so a notice can't hold it.</p>`;
  if (reviewStatus === "held" && isNoticeReason(reason)) {
    return html`<p class="note">Held on a notice. Show it again (above) once the live version no longer has what the notice names, or 10 working days after you passed a counter-notice on, unless the sender says they've gone to court.</p>`;
  }
  return html`<form method="post" action="/admin/games/${gameId}/notice" class="row">
  <select name="notice_kind" aria-label="The kind of notice" required>
    <option value="">The kind of notice…</option>
    ${NOTICE_KINDS.map((kind) => html`<option value="${kind}">${kind === "copyright" ? "copyright (DMCA)" : kind}</option>`)}
  </select>
  <input name="reason" placeholder="What it names (required; the developer reads it)" maxlength="500" size="36" required>
  <button class="btn danger" type="submit">Hold on this notice</button>
</form>`;
}

/** What the developer was told about a hold, rejection or takedown, for the admin pages. */
function toldDeveloper(stored: string | null): Raw | string {
  const reason = readReviewReason(stored);
  return reason ? html`<p class="muted">The developer reads: <code>${reason.code}</code>${reason.content_rule ? html` · rule <code>${reason.content_rule}</code>` : ""} · “${reason.message}”</p>` : "";
}

export function adminPage(env: Env, title: string, body: Raw): Response {
  return page(env, title, body);
}

function page(env: Env, title: string, body: Raw): Response {
  return layout(env, { title: `${title} · Zaisma admin`, body, isAdmin: true });
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to } });
}

export async function handleAdmin(request: Request, env: Env, path: string): Promise<Response> {
  const actor = await adminIdentity(request, env);
  if (!actor) return new Response("Forbidden", { status: 403 });

  // The admin MCP: Claude Code signs in through Cloudflare Access with a service token, so it sends no Origin of ours.
  if (path === "/admin/mcp") return handleAdminMcp(request, env, actor);

  if (request.method === "POST") {
    // Admin forms only come from our own pages.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
    return adminAction(request, env, path, actor);
  }

  if (path === "/admin") return dashboard(env);
  if (path === "/admin/audit") return auditPage(env);
  if (path === "/admin/profiles") return page(env, "Profiles", await adminProfilesPage(env));
  if (path === "/admin/chat-reviews") return page(env, "Chat reviews", await adminChatReviewsPage(env));
  if (path === "/admin/publishing") return page(env, "Publishing", await adminPublishingPage(env, new URL(request.url).searchParams.get("not_found")));
  if (path === "/admin/reports") return reportQueue(env);
  if (path === "/admin/precedents") return page(env, "Precedents", await precedentsPage(env));
  const feedback = path === "/admin/feedback" || path.startsWith("/admin/feedback/") ? await adminFeedbackPage(env, path, new URL(request.url)) : null;
  if (feedback) return feedback;
  const gameMatch = path.match(/^\/admin\/games\/([a-z0-9_]+)$/);
  if (gameMatch) return gameDetail(env, gameMatch[1]!);
  const imageMatch = path.match(/^\/admin\/images\/([a-z0-9_]+)$/);
  if (imageMatch) return adminImage(env, imageMatch[1]!);
  const pictureMatch = path.match(/^\/admin\/reports\/([a-z0-9_]+)\/picture$/);
  if (pictureMatch) return reportPicture(env, pictureMatch[1]!);
  return new Response("Not found", { status: 404 });
}

async function adminAction(request: Request, env: Env, path: string, actor: string): Promise<Response> {
  const wantsJson = path.startsWith("/admin/api/");
  if (path === "/admin/upload" || path === "/admin/api/games") {
    try {
      const upload = await uploadGame(env, await request.formData(), actor);
      if (wantsJson) {
        return Response.json({ gameId: upload.game.id, slug: upload.game.slug, versionId: upload.versionId, files: upload.fileCount, status: "scanning", url: `${env.SITE_ORIGIN}/g/${upload.game.slug}` }, { status: 201 });
      }
      return redirect(`/admin/games/${upload.game.id}`);
    } catch (error) {
      if (!(error instanceof UploadError)) throw error;
      if (wantsJson) return Response.json({ error: error.message }, { status: 400 });
      return dashboard(env, error.message);
    }
  }

  return adminForm(env, path, await request.formData(), actor);
}

/** Every admin form action. The admin MCP calls this too, so a decision there is exactly a click here. */
export async function adminForm(env: Env, path: string, form: FormData, actor: string): Promise<Response> {
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500);
  const back = (fallback: string) => redirect(form.get("back") === "queue" ? "/admin/reports" : fallback);

  const feedback = await adminFeedbackAction(env, path, form);
  if (feedback) return feedback;
  const precedents = await precedentAction(env, path, form, actor);
  if (precedents) return precedents;
  const profileDone = await adminProfileAction(env, path, actor);
  if (profileDone) return redirect(profileDone);
  const chatReviewDone = await adminChatReviewAction(env, path, actor);
  if (chatReviewDone) return redirect(chatReviewDone);
  const publishingDone = await adminPublishingAction(env, path, form, actor);
  if (publishingDone) return redirect(publishingDone);
  // Deciding a report in the queue can also set a precedent for cases like it.
  const decided = precedentDecision(path);
  if (decided && form.get("precedent") === "1") await savePrecedent(env, form, decided, actor);

  let match = path.match(/^\/admin\/versions\/([a-z0-9_]+)\/(approve|reject)$/);
  if (match) {
    const version = await versionById(env.DB, match[1]!);
    if (!version) return new Response("Not found", { status: 404 });
    if (match[2] === "approve" && knownImages(version)) return new Response("This version matched known abuse material, so it can't be approved.", { status: 409 });
    if (match[2] === "approve") await env.DB.prepare("UPDATE versions SET review_reason = NULL WHERE id = ?").bind(version.id).run();
    if (version.report_held_at_ms && match[2] === "approve") {
      // A report paused this update: put it back, and later reports can't pause it again.
      await publishVersion(env.DB, version);
      await clearVersion(env.DB, version.id);
      await closeReports(env.DB, version.game_id, "dismissed");
      await audit(env.DB, version.game_id, "report-cleared", reason || `${version.id} is back`, actor);
      await tellWebhooks(env, "live_version_changed", version.game_id, { versionId: version.id });
    } else if (match[2] === "approve") {
      await passVersion(env, version, reason || "Approved by a person", actor);
    } else {
      const rejectedReason = decidedReason("rejected_by_zaisma", pickedRule(form), reason);
      await saveScan(env.DB, version.id, "rejected", null);
      await env.DB.prepare("UPDATE versions SET review_reason = ? WHERE id = ?").bind(JSON.stringify(rejectedReason), version.id).run();
      if (version.report_held_at_ms) await closeReports(env.DB, version.game_id, "actioned");
      await audit(env.DB, version.game_id, "rejected", reason ? `${version.id}: ${reason}` : version.id, actor, rejectedReason);
    }
    await tellWebhooks(env, "scan_status_changed", version.game_id, { versionId: version.id });
    return back(`/admin/games/${version.game_id}`);
  }

  match = path.match(/^\/admin\/versions\/([a-z0-9_]+)\/reject-copy$/);
  if (match) {
    const version = await versionById(env.DB, match[1]!);
    if (!version) return new Response("Not found", { status: 404 });
    if (!(await stopCopy(env, version, actor))) return new Response("This version isn't a held match of another developer's game.", { status: 409 });
    return back(`/admin/games/${version.game_id}`);
  }

  match = path.match(/^\/admin\/images\/([a-z0-9_]+)\/(approve|reject)$/);
  if (match) {
    const image = await imageById(env.DB, match[1]!);
    if (!image) return new Response("Not found", { status: 404 });
    const rejectedReason = match[2] === "reject" ? decidedReason("image_rejected", pickedRule(form), reason) : null;
    const replaced = await settleImage(env.DB, image, rejectedReason);
    await Promise.all(replaced.map((replacedImage) => env.GAMES.delete([imageKey(replacedImage), cardImageKey(replacedImage)])));
    await audit(env.DB, image.game_id, rejectedReason ? "image-rejected" : "image-approved", reason || `${image.kind} ${image.id}`, actor, rejectedReason);
    return redirect(String(form.get("back") ?? "") === "game" ? `/admin/games/${image.game_id}` : "/admin");
  }

  match = path.match(/^\/admin\/games\/([a-z0-9_]+)\/details\/(approve|reject)$/);
  if (match) {
    const game = await gameById(env.DB, match[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    await settleDetailsWaitingForReview(env.DB, game, match[2] === "approve");
    const rejectedReason = match[2] === "reject" ? decidedReason("details_rejected", pickedRule(form), reason) : null;
    await audit(env.DB, game.id, rejectedReason ? "details-rejected" : "details-approved", reason || game.details_waiting_for_review || "", actor, rejectedReason);
    return redirect("/admin");
  }

  match = path.match(/^\/admin\/games\/([a-z0-9_]+)\/plays\/(\d{4}-\d{2}-\d{2})\/clear$/);
  if (match) {
    const game = await gameById(env.DB, match[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    await clearCountedDay(env.DB, game.id, match[2]!);
    await audit(env.DB, game.id, "plays-cleared", `Counted plays on ${match[2]} removed`, actor);
    return redirect("/admin#plays");
  }

  match = path.match(/^\/admin\/games\/([a-z0-9_]+)\/shelves$/);
  if (match) {
    const game = await gameById(env.DB, match[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const off = form.get("off") === "1";
    await env.DB.prepare("UPDATE games SET is_off_shelves = ? WHERE id = ?").bind(off ? 1 : 0, game.id).run();
    await audit(env.DB, game.id, off ? "off-shelves" : "on-shelves", off ? "Kept off Popular, Trending and New" : "Back on Popular, Trending and New", actor);
    return redirect(form.get("back") === "game" ? `/admin/games/${game.id}` : "/admin#plays");
  }

  match = path.match(/^\/admin\/games\/([a-z0-9_]+)\/multiplayer$/);
  if (match) {
    const game = await gameById(env.DB, match[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const server = String(form.get("game_server") ?? "");
    if (server && server !== "relay" && server !== SANDBOX_GAME_SERVER && !(BUILT_IN_GAME_SERVERS as readonly string[]).includes(server)) return gameDetail(env, game.id, "Pick a game server from the list.");
    const multiplayerMode = !server ? "none" : server === "relay" ? "relay" : server === SANDBOX_GAME_SERVER ? "own" : "built-in";
    await setMultiplayer(env.DB, game.id, { multiplayerMode, builtInServer: multiplayerMode === "built-in" ? server : null });
    await audit(env.DB, game.id, "multiplayer", `Game server: ${server || "none"}`, actor);
    return redirect(`/admin/games/${game.id}`);
  }

  match = path.match(/^\/admin\/games\/([a-z0-9_]+)\/saves$/);
  if (match) {
    const game = await gameById(env.DB, match[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const on = form.get("cloud_saves") === "on";
    await setCloudSavesEnabled(env.DB, game.id, on);
    await audit(env.DB, game.id, "cloud-saves", on ? "On" : "Off", actor);
    return redirect(`/admin/games/${game.id}`);
  }

  match = path.match(/^\/admin\/games\/([a-z0-9_]+)\/owner$/);
  if (match) {
    const game = await gameById(env.DB, match[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const accountId = String(form.get("account_id") ?? "").trim();
    if (!accountId) {
      await setGameOwner(env.DB, game.id, null);
      await audit(env.DB, game.id, "owner", "No owner", actor);
      return redirect(`/admin/games/${game.id}`);
    }
    const account = await accountById(env.DB, accountId);
    if (!account) return gameDetail(env, game.id, "No account with that ID. It's shown at the bottom of the account page.");
    const owner = await personOwner(env.DB, account.id);
    await setGameOwner(env.DB, game.id, owner.id);
    await audit(env.DB, game.id, "owner", `Owner: ${account.username} (account ${account.id})`, actor);
    return redirect(`/admin/games/${game.id}`);
  }

  match = path.match(/^\/admin\/games\/([a-z0-9_]+)\/notice$/);
  if (match) {
    const game = await gameById(env.DB, match[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const noticeKind = form.get("notice_kind");
    if (!isNoticeKind(noticeKind) || !reason) return gameDetail(env, game.id, "Pick the kind of notice and say what it names. The developer reads it, and it goes in the audit log too.");
    if (game.review_status === "removed") return gameDetail(env, game.id, "The game is already taken down. Restore it first if the notice should hold it instead.");
    // Zaisma doesn't judge the notice: the game is held until a fixed version is checked or a counter-notice brings it back.
    const noticeReason = decidedReason(NOTICE_CODES[noticeKind].code, null, `A ${noticeKind === "copyright" ? "copyright (DMCA)" : "defamation"} notice names this: ${reason}`);
    await setReviewStatus(env.DB, game.id, "held", noticeReason);
    await audit(env.DB, game.id, "notice-held", reason, actor, noticeReason);
    await tellWebhooks(env, "review_status_changed", game.id, {});
    return back(`/admin/games/${game.id}`);
  }

  // A game an account left behind (kept for a child-safety hold, or ownerless from before), deleted for good.
  match = path.match(/^\/admin\/games\/([a-z0-9_]+)\/delete$/);
  if (match) {
    const game = await gameById(env.DB, match[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    if (game.owner_id) return gameDetail(env, game.id, "Only a game with no owner can be deleted here.");
    if (!reason) return gameDetail(env, game.id, "Say why: it goes in the audit log.");
    await queueGameDeletion(env.DB, game.id, "zaisma");
    await audit(env.DB, game.id, "deleted", reason, actor);
    return redirect(`/admin/games/${game.id}`);
  }

  match = path.match(/^\/admin\/games\/([a-z0-9_]+)\/(takedown|restore|dismiss)$/);
  if (match) {
    const game = await gameById(env.DB, match[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    if (match[2] === "takedown") {
      const contentRule = pickedRule(form);
      if (!reason || !contentRule) return gameDetail(env, game.id, "Pick the rule it broke and say why. The developer reads why, unless it's child safety; it goes in the audit log too.");
      const removedReason = decidedReason("taken_down", contentRule, reason);
      await setReviewStatus(env.DB, game.id, "removed", removedReason);
      await closeReports(env.DB, game.id, "actioned");
      await audit(env.DB, game.id, "takedown", reason, actor, removedReason);
      await tellWebhooks(env, "review_status_changed", game.id, {});
    } else if (match[2] === "restore") {
      const current = game.live_version_id ? await versionById(env.DB, game.live_version_id) : null;
      if (current && knownImages(current)) return gameDetail(env, game.id, "Players would get the version that matched known abuse material. Once the developer publishes a clean version, the game can be shown again.");
      await setReviewStatus(env.DB, game.id, game.live_version_id ? "live" : "pending");
      await tellWebhooks(env, "review_status_changed", game.id, {});
      // A person checked it: reports can't hide this version again.
      if (game.live_version_id) await clearVersion(env.DB, game.live_version_id);
      await closeReports(env.DB, game.id, "dismissed");
      await audit(env.DB, game.id, "restored", reason, actor);
    } else {
      if (game.live_version_id) await clearVersion(env.DB, game.live_version_id);
      await closeReports(env.DB, game.id, "dismissed");
      await audit(env.DB, game.id, "reports-dismissed", reason, actor);
    }
    return back(`/admin/games/${game.id}`);
  }

  // One group of reports about the same problem, from the queue.
  match = path.match(/^\/admin\/report-groups\/([a-z0-9_]+)\/(dismiss|bug|hide-name|pass-to-developer|stop-social|clear-profile)$/);
  if (match) {
    const { results: group } = await env.DB.prepare(`${QUEUE_SELECT} WHERE (reports.id = ? OR reports.report_group_id = ?) AND reports.report_status = 'open'`).bind(match[1]!, match[1]!).all<QueueRow>();
    if (!group.length) return back("/admin/reports");
    const gameId = group[0]!.game_id;
    const isChildSafety = group.some((report) => report.severity_index === 0 || report.reason === "child_safety");
    // Never passed to the developer: telling them could warn someone abusing a child.
    if ((match[2] === "bug" || match[2] === "pass-to-developer") && isChildSafety) return back("/admin/reports");
    const [lead] = groupReports(group).map((reportGroup) => reportGroup.lead);
    const isAboutPlayer = group.every((report) => report.player_id);
    if (match[2] === "pass-to-developer") {
      if (!isAboutPlayer) return back("/admin/reports");
      const nowMs = Date.now();
      await env.DB.prepare("UPDATE reports SET is_passed_to_developer = 1, passed_to_developer_at_ms = ? WHERE (id = ? OR report_group_id = ?) AND report_status = 'open' AND is_passed_to_developer = 0").bind(nowMs, match[1]!, match[1]!).run();
      // The ones the developer hadn't been told about yet, the same ones get_reports shows.
      for (const report of group) if (!report.is_passed_to_developer) await tellWebhooks(env, "player_reported", gameId, { playerReport: report });
      await closeReportGroup(env.DB, match[1]!, "actioned");
      await audit(env.DB, gameId, "reports-to-developer", reason || `${group.length} report(s) about ${lead!.player_name || "a player"} passed to the developer`, actor);
      return back("/admin/reports");
    }
    if (match[2] === "stop-social" || match[2] === "clear-profile") {
      const account = isAboutPlayer && lead!.reported_username ? await env.DB.prepare("SELECT id, username FROM accounts WHERE player_id = ?").bind(lead!.player_id).first<{ id: string; username: string }>() : null;
      if (!account) return back("/admin/reports");
      if (match[2] === "clear-profile") {
        await clearProfile(env.DB, account.id);
        await closeReportGroup(env.DB, match[1]!, "actioned");
        await audit(env.DB, gameId, "profile-cleared", reason || `@${account.username}`, actor);
        return back("/admin/reports");
      }
      const stoppedReason = String(form.get("social_stopped_reason") ?? "");
      if (!isForZaisma(stoppedReason) || lead!.reported_social_stopped_at_ms) return back("/admin/reports");
      await stopSocial(env.DB, account.id, stoppedReason);
      await closeReportGroup(env.DB, match[1]!, "actioned");
      await audit(env.DB, gameId, "social-stopped", `@${account.username}: ${PLAYER_REPORT_REASONS[stoppedReason]}. ${reason}`.trim(), actor);
      // Something sexual toward a teen, confirmed: the law asks for a report, which names someone to the police, so Julius sends it.
      if (isChildSafety) {
        await sendAlert(env, `URGENT: report to NCMEC: @${account.username}`, `A person confirmed a child-safety report about @${account.username} (player ${lead!.player_id}) and turned off their social side. Don't delete anything; the reports stay on the admin page.\n\n${reason}\n\nReview: ${env.SITE_ORIGIN}/admin/games/${gameId}`);
      }
      return back("/admin/reports");
    }
    if (match[2] === "hide-name") {
      // The room's name and labels leave the game page and the game's own list while the room lives.
      const rooms = [...new Set(group.map((report) => report.room_code).filter(Boolean))];
      for (const roomCode of rooms) await env.DB.prepare("UPDATE live_rooms SET is_name_hidden = 1 WHERE game_id = ? AND room_code = ?").bind(gameId, roomCode).run();
      await closeReportGroup(env.DB, match[1]!, "actioned");
      await audit(env.DB, gameId, "room-name-hidden", reason || `Room ${rooms.join(", ")}: ${group[0]!.room_name ?? "its name"}`, actor);
    } else if (match[2] === "bug") {
      await env.DB.prepare("UPDATE reports SET is_bug_report = 1, bug_report_at_ms = COALESCE(bug_report_at_ms, ?) WHERE (id = ? OR report_group_id = ?) AND report_status = 'open'").bind(Date.now(), match[1]!, match[1]!).run();
      // The ones the developer hadn't been told about yet, the same ones get_reports shows.
      for (const report of group) if (!report.is_bug_report && report.player_text && report.severity_index > 0) await tellWebhooks(env, "bug_reported", gameId, { bugReport: report });
      await closeReportGroup(env.DB, match[1]!, "actioned");
      await audit(env.DB, gameId, "reports-to-developer", reason || `${group.length} report(s) passed to the developer as bugs`, actor);
    } else {
      // A person looked at a serious report and found nothing: reports can't pause that version again.
      for (const report of group) if (report.version_id && (report.severity_index <= SEVERITY.urgent || (AUTO_HOLD_REASONS as string[]).includes(report.reason))) await clearVersion(env.DB, report.version_id);
      await closeReportGroup(env.DB, match[1]!, "dismissed");
      await audit(env.DB, gameId, "reports-dismissed", reason || `${group.length} report(s): ${reportLabel(group[0]!)}`, actor);
    }
    return back("/admin/reports");
  }
  return new Response("Not found", { status: 404 });
}

async function dashboard(env: Env, error = ""): Promise<Response> {
  const [queue, reports, games, usage, images, words, spikes, feedback] = await Promise.all([
    heldVersions(env.DB),
    openReports(env.DB),
    allGames(env.DB),
    aiUsage(env.DB),
    pendingImages(env.DB),
    gamesWithDetailsWaitingForReview(env.DB),
    playSpikes(env.DB),
    feedbackSummary(env),
  ]);
  const offShelves = games.filter((game) => game.is_off_shelves);
  const groups = groupReports(reports);
  return page(
    env,
    "Admin",
    html`<h1>Admin</h1>
<p class="lead">AI this month: ${usage.scan_call_count} scans; reviews $${(usage.review_cost_cents / 100).toFixed(2)} of $${(Number(env.AI_REVIEW_MONTHLY_BUDGET_CENTS) / 100).toFixed(2)} (${usage.review_call_count} calls); ${usage.report_triage_call_count} reports and ${usage.forum_call_count} feedback items sorted, ${usage.input_token_count.toLocaleString("en-US")} of ${Number(env.AI_MONTHLY_INPUT_TOKENS).toLocaleString("en-US")} input tokens.</p>

<h2>Waiting for review (${queue.length})</h2>
${queue.length
      ? html`<table><tr><th>Game</th><th>Version</th><th>Status</th><th>Uploaded</th></tr>${queue.map(
          (version) => html`<tr><td><a href="/admin/games/${version.game_id}">${version.title}</a></td><td>${version.id}</td><td>${pill(version.scan_status)}${version.report_held_at_ms ? " paused by a report" : ""}${knownImages(version) ? html` <strong style="color:var(--danger)">known abuse images</strong>` : ""}</td><td>${when(version.created_at_ms)}</td></tr>`,
        )}</table>`
      : html`<p class="note">Nothing waiting.</p>`}

<h2>Covers and screenshots (${images.length})</h2>
${images.length
      ? html`<p class="muted">${env.ARACHNID_SHIELD_KEY ? "These passed image matching. Check each shows the game and follows the content rules." : "Image matching isn't connected yet, so check each picture shows the game and follows the content rules."}</p>
<div class="shots">${images.map((image) => html`<div>${imageReview(image)}<p><a href="/admin/games/${image.game_id}">${image.title}</a></p></div>`)}</div>`
      : html`<p class="note">Nothing waiting.</p>`}

<h2>New titles and descriptions (${words.length})</h2>
${words.length
      ? html`<table><tr><th>Game</th><th>Now</th><th>New</th><th></th></tr>${words.map((game) => {
          const waiting = JSON.parse(game.details_waiting_for_review!) as { title?: string; description?: string };
          return html`<tr><td><a href="/admin/games/${game.id}">${game.slug}</a></td><td><strong>${game.title}</strong><br>${game.description}</td><td><strong>${waiting.title ?? game.title}</strong><br>${waiting.description ?? game.description}</td>
<td><div class="row"><form method="post" action="/admin/games/${game.id}/details/approve"><button class="btn" type="submit">Approve</button></form><details><summary class="btn ghost">Reject…</summary><form class="row" method="post" action="/admin/games/${game.id}/details/reject">${decisionFields({})}<button class="btn ghost" type="submit">Reject</button></form></details></div></td></tr>`;
        })}</table>`
      : html`<p class="note">Nothing waiting.</p>`}

<h2>Reports (${groups.length})</h2>
${groups.length
      ? html`<table><tr><th>How serious</th><th>Game</th><th>What</th><th>Reports</th></tr>${groups.slice(0, 5).map(
          (group) => html`<tr><td>${severityPill(group.severityIndex)}</td><td><a href="/admin/games/${group.lead.game_id}">${group.lead.title}</a></td><td>${group.triage?.summary ?? reportLabel(group.lead)}</td><td>${group.rows.length}</td></tr>`,
        )}</table>
<p><a class="btn ghost" href="/admin/reports">Open the report queue</a></p>`
      : html`<p class="note">No open reports.</p>`}

${feedback}

<h2 id="plays">Play spikes (${spikes.length})</h2>
${spikes.length
      ? html`<p class="muted">Counted players at least 5 times the week before. Faked plays tend to come from few networks, or from cloud servers. Removing a day's counts keeps every play started; keeping a game off the shelves hides it from Popular, Trending and New until you put it back.</p>
<table><tr><th>Game</th><th>Day</th><th>Players</th><th>Usual</th><th>Networks</th><th>Biggest network</th><th>Cloud</th><th></th></tr>${spikes.map(
          (spike) => html`<tr><td><a href="/admin/games/${spike.game_id}">${spike.title}</a>${spike.is_off_shelves ? html` ${pill("off shelves")}` : ""}</td><td>${spike.date}</td><td>${spike.player_count}</td><td>${spike.usual_players_per_day}</td><td>${spike.network_count}</td><td>${spike.biggest_network_pct}%</td><td>${spike.hosting_network_pct}%</td>
<td><div class="row"><form method="post" action="/admin/games/${spike.game_id}/plays/${spike.date}/clear"><button class="btn ghost" type="submit">Remove this day's counts</button></form>${spike.is_off_shelves ? "" : html`<form method="post" action="/admin/games/${spike.game_id}/shelves"><input type="hidden" name="off" value="1"><button class="btn ghost" type="submit">Keep off the shelves</button></form>`}</div></td></tr>`,
        )}</table>`
      : html`<p class="note">No spikes.</p>`}
${offShelves.length
      ? html`<h3>Kept off the shelves</h3><table>${offShelves.map((game) => html`<tr><td><a href="/admin/games/${game.id}">${game.title}</a></td><td><form method="post" action="/admin/games/${game.id}/shelves"><input type="hidden" name="off" value="0"><button class="btn ghost" type="submit">Put back</button></form></td></tr>`)}</table>`
      : ""}

<h2>Upload a game</h2>
${error ? html`<p class="note" style="color:var(--danger)">${error}</p>` : ""}
<form class="stack" method="post" action="/admin/upload" enctype="multipart/form-data">
  <label>Title <input name="title" required maxlength="80"></label>
  <label>Link name (zaisma.com/g/…). Leave empty to make one from the title. Reuse an existing one to upload a new version.
    <input name="slug" pattern="[a-z0-9-]{3,40}" maxlength="40"></label>
  <label>Short description <textarea name="description" maxlength="500"></textarea></label>
  <label>Game zip (up to ${Math.round(ZIP_LIMITS.maximumZipSizeBytes / 1048576)} MB, index.html at the top) <input type="file" name="zip" accept=".zip,application/zip" required></label>
  <div><button class="btn" type="submit">Upload and scan</button></div>
</form>

<h2>All games (${games.length})</h2>
<table><tr><th>Game</th><th>Status</th><th>Updated</th></tr>${games.map(
      (game) => html`<tr><td><a href="/admin/games/${game.id}">${game.title}</a> <span style="color:var(--muted)">/g/${game.slug}</span></td><td>${pill(game.review_status)}</td><td>${when(game.updated_at_ms)}</td></tr>`,
    )}</table>`,
  );
}

async function gameDetail(env: Env, id: string, error = ""): Promise<Response> {
  const game = await gameById(env.DB, id);
  if (!game) return new Response("Not found", { status: 404 });
  const [versions, reports, log, owner, images, deletion] = await Promise.all([
    versionsForGame(env.DB, id),
    openReports(env.DB),
    auditLog(env.DB, id),
    gameOwner(env.DB, game.owner_id),
    imagesForGame(env.DB, id),
    gameDeletionOf(env.DB, id),
  ]);
  const mine = reports.filter((report) => report.game_id === id);
  // Held re-uploads: which game and developer each matched, for the person deciding it.
  const matchedGames = new Map<string, { title: string; ownerName: string | null }>();
  for (const version of versions) {
    const matchedGameId = version.scan_report ? (JSON.parse(version.scan_report) as ScanReport).matched_game?.game_id : undefined;
    if (!matchedGameId || matchedGames.has(matchedGameId)) continue;
    const matched = await gameById(env.DB, matchedGameId);
    if (matched) matchedGames.set(matchedGameId, { title: matched.title, ownerName: await ownerUsername(env, matched.owner_id) });
  }

  return page(
    env,
    game.title,
    html`<h1>${game.title} ${pill(game.review_status)}</h1>
<p class="lead">${game.description}</p>
<div class="row">
  <a class="btn ghost" href="/g/${game.slug}">Game page</a>
  <a class="btn ghost" href="${gameUrl(env, game.slug)}">Game file server</a>
</div>
${error ? html`<p class="note" style="color:var(--danger)">${error}</p>` : ""}

<h2>Takedown</h2>
${game.review_status === "removed" || game.review_status === "held"
      ? html`<form method="post" action="/admin/games/${game.id}/restore" class="row"><input name="reason" placeholder="Why (optional)"><button class="btn" type="submit">${game.review_status === "held" ? "Clear and show again" : "Restore"}</button></form>`
      : html`<form method="post" action="/admin/games/${game.id}/takedown" class="row">${decisionFields({ isTakedown: true })}<button class="btn danger" type="submit">Take down now</button></form>`}
${toldDeveloper(game.review_reason)}

<h2>Notice</h2>
${noticeSection(game.id, game.review_status, readReviewReason(game.review_reason))}

<h2>Details</h2>
<p>Visibility: ${pill(game.visibility)} · Devices: ${game.devices || "not set"} · Controls: ${game.controls || "not set"} · Screen: ${game.screen_orientation || "not set"}</p>
${images.length ? html`<div class="shots">${images.map((image) => html`<div>${imageReview(image, true)}</div>`)}</div>` : html`<p class="note">No cover or screenshots yet.</p>`}

<h2>Owner</h2>
<p>${owner ? html`${owner.name} <span class="muted">(${owner.owner.kind}${owner.owner.account_id ? `, account ${owner.owner.account_id}` : ""})</span>` : "No owner yet."}</p>
<form method="post" action="/admin/games/${game.id}/owner" class="row">
  <input name="account_id" placeholder="Account ID (blank for no owner)" size="40" value="${owner?.owner.account_id ?? ""}">
  <button class="btn ghost" type="submit">Set owner</button>
</form>
${deletion
      ? html`<p class="note">Being deleted: its files, database and saves go within minutes.${deletion.failure_message ? ` Last try: ${deletion.failure_message}` : ""}</p>`
      : owner
        ? ""
        : html`<h3>Delete for good</h3>
<p class="muted">For a game an account left behind, like one kept for a child-safety hold. Its files, database, secrets, game server storage, saves and rows are deleted, and its link never goes to another game.</p>
<form method="post" action="/admin/games/${game.id}/delete" class="row"><input name="reason" placeholder="Why (required)" required><button class="btn danger" type="submit">Delete for good</button></form>`}

<h2>Shelves</h2>
<form method="post" action="/admin/games/${game.id}/shelves" class="row">
  <input type="hidden" name="off" value="${game.is_off_shelves ? "0" : "1"}"><input type="hidden" name="back" value="game">
  <span>${game.is_off_shelves ? "Kept off Popular, Trending and New." : "Can show on Popular, Trending and New."}</span>
  <button class="btn ghost" type="submit">${game.is_off_shelves ? "Put back on the shelves" : "Keep off the shelves"}</button>
</form>

<h2>Cloud saves</h2>
<form method="post" action="/admin/games/${game.id}/saves" class="row">
  <label class="row"><input type="checkbox" name="cloud_saves" ${game.cloud_saves_enabled ? "checked" : ""}> Copy signed-in players' browser saves to their account. Turn off for games that keep their own saves.</label>
  <button class="btn ghost" type="submit">Save</button>
</form>

<h2>Multiplayer</h2>
<form method="post" action="/admin/games/${game.id}/multiplayer" class="stack">
  <label>Game server
    <select name="game_server">
      <option value="">None (single-player)</option>
      <option value="relay" ${game.multiplayer_mode === "relay" ? "selected" : ""}>The relay</option>
      ${BUILT_IN_GAME_SERVERS.map((server) => html`<option value="${server}" ${game.multiplayer_mode === "built-in" && game.built_in_server === server ? "selected" : ""}>${server}</option>`)}
      <option value="${SANDBOX_GAME_SERVER}" ${game.multiplayer_mode === "own" ? "selected" : ""}>The game's own (zaisma-server.js, in a sandbox)</option>
    </select></label>
  <p class="muted">Own servers (set by the developer): ${ownServerUrlsOf(game).join(", ") || "none"}</p>
  <div><button class="btn" type="submit">Save</button></div>
</form>

<h2>Open reports (${mine.length})</h2>
${mine.length
      ? html`<table>${mine.map((report) => html`<tr><td>${severityPill(report.severity_index)}</td><td>${reportLabel(report)}${report.player_id ? html`<br><small class="muted">Player ID ${report.player_id}</small>` : ""}</td><td>${report.player_text}${pictureLink(report)}${report.triage ? html`<br><small class="muted">${(JSON.parse(report.triage) as Triage).summary}</small>` : ""}</td><td>${when(report.reported_at_ms)}</td></tr>`)}</table>
<form method="post" action="/admin/games/${game.id}/dismiss" class="row" style="margin-top:10px"><input name="reason" placeholder="Why (optional)"><button class="btn ghost" type="submit">Dismiss reports</button></form>`
      : html`<p class="note">None.</p>`}

<h2>Versions</h2>
${versions.map((version) => {
      const report: ScanReport | null = version.scan_report ? JSON.parse(version.scan_report) : null;
      const current = version.id === game.live_version_id;
      return html`<div class="note" style="margin-bottom:12px">
  <div class="row"><strong>${version.id}</strong> ${pill(version.scan_status)} ${current ? html`<span class="pill live">players get this one</span>` : ""}
    <span>${version.file_count} files · ${(version.size_bytes / 1048576).toFixed(1)} MB · ${when(version.created_at_ms)}</span></div>
  ${version.report_held_at_ms && version.scan_status === "held" ? html`<p><strong>A report paused this update.</strong> Players are on the version before it. Put it back if the report was wrong.</p>` : ""}
  ${report ? scanReport(report) : html`<p>Scan in progress…</p>`}
  ${report?.matched_game ? matchedGameLine(report.matched_game, matchedGames.get(report.matched_game.game_id)) : ""}
  ${toldDeveloper(version.review_reason)}
  ${version.scan_status !== "approved" || !current
        ? html`<div class="row">
    ${version.scan_status !== "approved" && !knownImages(version) ? html`<form method="post" action="/admin/versions/${version.id}/approve"><button class="btn" type="submit">${version.report_held_at_ms ? "Put the update back" : version.publish_when_approved_enabled ? "Approve and publish" : "Approve as a draft"}</button></form>` : ""}
    ${version.scan_status !== "rejected" && report?.matched_game ? html`<form method="post" action="/admin/versions/${version.id}/reject-copy"><button class="btn ghost" type="submit">Reject as a copy</button></form>` : ""}
    ${version.scan_status !== "rejected" ? html`<details><summary class="btn ghost">${version.report_held_at_ms ? "Keep it off…" : "Reject…"}</summary><form class="row" method="post" action="/admin/versions/${version.id}/reject">${decisionFields({})}<button class="btn ghost" type="submit">${version.report_held_at_ms ? "Keep it off" : "Reject"}</button></form></details>` : ""}
  </div>`
        : ""}
</div>`;
    })}

<h2>History</h2>
${auditTable(log)}`,
  );
}

/** What a held re-upload matched, and what Reject as a copy does. */
function matchedGameLine(matchedGame: NonNullable<ScanReport["matched_game"]>, matched: { title: string; ownerName: string | null } | undefined): Raw {
  return html`<p><strong>Most of its files (${matchedGame.matched_file_count} of ${matchedGame.compared_file_count}) were sent first by another developer</strong>, in <a href="/admin/games/${matchedGame.game_id}">${matched?.title ?? matchedGame.game_id}</a>${matched?.ownerName ? ` by ${matched.ownerName}` : ""}. Reject as a copy tells that developer, with this uploader's name; Approve and Reject… tell nobody. Not sure (a teammate, permission)? Ask them first.</p>`;
}

function scanReport(report: ScanReport): Raw {
  return html`
${report.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)
    ? html`<p style="color:var(--danger)"><strong>Known abuse images.</strong> ${KNOWN_IMAGE_ALERT} It can't be approved.</p>`
    : report.is_child_safety
      ? html`<p style="color:var(--danger)"><strong>Child-safety flag.</strong> Don't delete anything. Review, and if confirmed report to NCMEC (CyberTipline) as the law requires.</p>`
      : ""}
<p>Scan result: ${pill(report.decision)} · image matching: ${report.images.is_connected ? `${report.images.provider}, ${report.images.checked_media_count} checked${report.images.reused_media_count ? `, ${report.images.reused_media_count} cleared earlier` : ""}` : "not connected"} · AI: ${report.ai ? `${report.ai.verdict} (${reviewModelOf(report.ai)}${"cost_cents" in report.ai ? `, ${report.ai.cost_cents.toFixed(2)}¢` : ""})` : "not run"}</p>
${report.ai?.summary ? html`<p>${report.ai.summary}</p>` : ""}
${report.findings.length
    ? html`<table><tr><th>Level</th><th>Check</th><th>What</th><th>File</th></tr>${report.findings.map(
        (finding) => html`<tr><td>${pill(finding.severity)}</td><td>${finding.code}</td><td>${finding.message}</td><td>${finding.path ?? ""}</td></tr>`,
      )}</table>`
    : ""}
${report.outside_hosts.length ? html`<p>Outside sites referenced: ${report.outside_hosts.join(", ")}</p>` : ""}`;
}

function auditTable(log: Awaited<ReturnType<typeof auditLog>>): Raw {
  return log.length
    ? html`<table><tr><th>When</th><th>Game</th><th>Action</th><th>Reason</th><th>By</th></tr>${log.map(
        (entry) => html`<tr><td>${when(entry.happened_at_ms)}</td><td>${entry.slug ?? ""}</td><td>${entry.action}</td><td>${entry.reason}</td><td>${entry.actor}</td></tr>`,
      )}</table>`
    : html`<p class="note">Nothing yet.</p>`;
}

async function auditPage(env: Env): Promise<Response> {
  return page(env, "Audit log", html`<h1>Audit log</h1>${auditTable(await auditLog(env.DB))}`);
}

function imageReview(image: GameImage, fromGame = false): Raw {
  return html`<a href="/admin/images/${image.id}"><img src="/admin/images/${image.id}" alt="${image.kind}" loading="lazy"></a>
<p>${image.kind} ${pill(image.review_status)} <span class="muted">${image.width_px}×${image.height_px}</span></p>
${image.review_status === "pending"
    ? html`<div class="row"><form method="post" action="/admin/images/${image.id}/approve"><input type="hidden" name="back" value="${fromGame ? "game" : ""}"><button class="btn" type="submit">Approve</button></form>
<details><summary class="btn ghost">Reject…</summary><form class="stack" method="post" action="/admin/images/${image.id}/reject"><input type="hidden" name="back" value="${fromGame ? "game" : ""}">${decisionFields({})}<button class="btn ghost" type="submit">Reject</button></form></details></div>`
    : image.review_status === "rejected"
      ? toldDeveloper(image.review_reason)
      : ""}`;
}

/** A report in the queue, with its game and, for a report about an account, that account (null for a guest or a game report). */
export type QueueRow = Report & {
  slug: string;
  title: string;
  game_review_status: ReviewStatus;
  reported_username?: string | null;
  reported_age_band?: string | null;
  reported_social_stopped_at_ms?: number | null;
  has_reported_profile_text?: number | null;
};
export const QUEUE_SELECT =
  "SELECT reports.*, games.slug, games.title, games.review_status AS game_review_status, reported.username AS reported_username, reported.age_band AS reported_age_band, reported.social_stopped_at_ms AS reported_social_stopped_at_ms, CASE WHEN reported.id IS NULL THEN NULL WHEN reported.display_name IS NOT NULL OR reported.bio IS NOT NULL OR reported.link_urls != '' THEN 1 ELSE 0 END AS has_reported_profile_text FROM reports JOIN games ON games.id = reports.game_id LEFT JOIN accounts AS reported ON reports.player_id != '' AND reported.player_id = reports.player_id";

/**
 * What a person can decide for a group of reports about a player, as the queue's buttons and the admin
 * MCP's decide_report_group offer them: never a takedown (it's a player, not the game), never to the
 * developer at child safety, and only an account's social side or profile.
 */
export function playerGroupChoices(group: ReportGroup): string[] {
  const isChildSafety = group.severityIndex === 0 || group.rows.some((report) => report.reason === "child_safety");
  return [
    "dismiss",
    ...(group.rows.some((report) => report.room_name) ? ["hide_name"] : []),
    ...(isChildSafety ? [] : ["pass_to_developer"]),
    ...(group.lead.reported_username && !group.lead.reported_social_stopped_at_ms ? ["stop_social"] : []),
    ...(group.lead.has_reported_profile_text ? ["clear_profile"] : []),
  ];
}
export const isPlayerGroup = (group: ReportGroup) => group.rows.every((report) => report.player_id);

export interface ReportGroup {
  /** The first report's id: group actions close it and every report merged into it. */
  id: string;
  rows: QueueRow[];
  /** The most serious report, latest first: its triage leads the card. */
  lead: QueueRow;
  severityIndex: number;
  triage: Triage | null;
  rechecks: NonNullable<Triage["recheck"]>[];
}

/** Open reports as groups about the same problem, most serious first, then the longest waiting. */
export function groupReports(rows: QueueRow[]): ReportGroup[] {
  const groups = new Map<string, QueueRow[]>();
  for (const row of [...rows].sort((first, second) => first.reported_at_ms - second.reported_at_ms)) {
    const key = row.report_group_id ?? row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const parse = (row: QueueRow): Triage | null => (row.triage ? JSON.parse(row.triage) : null);
  return [...groups]
    .map(([id, rows]) => {
      const lead = rows.reduce((mostSerious, row) => (row.severity_index < mostSerious.severity_index || (row.severity_index === mostSerious.severity_index && row.reported_at_ms > mostSerious.reported_at_ms) ? row : mostSerious));
      const triages = rows.map(parse);
      return { id, rows, lead, severityIndex: lead.severity_index, triage: parse(lead) ?? [...triages].reverse().find(Boolean) ?? null, rechecks: triages.flatMap((triage) => (triage?.recheck ? [triage.recheck] : [])) };
    })
    .sort((first, second) => first.severityIndex - second.severityIndex || first.rows[0]!.reported_at_ms - second.rows[0]!.reported_at_ms);
}

export const severityPill = (severityIndex: number) => html`<span class="pill sev${severityIndex}">${SEVERITIES[severityIndex] ?? "Normal"}</span>`;

function ago(ms: number): string {
  const elapsedMin = Math.round((Date.now() - ms) / 60000);
  if (elapsedMin < 1) return "just now";
  if (elapsedMin < 60) return `${elapsedMin} min ago`;
  if (elapsedMin < 48 * 60) return `${Math.round(elapsedMin / 60)} h ago`;
  return `${Math.round(elapsedMin / 1440)} days ago`;
}

const PRECEDENT_LABEL: Record<PrecedentDecision, string> = { dismiss: "dismiss", bug: "tell the developer", recheck: "check the files again", take_down: "take down", pass_to_developer: "pass to the game's developer", stop_social: "turn off their social side" };

const RECOMMENDED: Record<Triage["recommendation"], string> = {
  dismiss: "Dismiss",
  bug: "Tell the developer",
  recheck: "Wait for the re-check",
  person: "Your call",
  take_down: "Take the game down",
  restore: "Put the game back",
  pass_to_developer: "Pass to the game's developer",
  stop_social: "Turn off their social side",
};

/** Every open report, sorted and merged by AI triage (triage.ts), each group decided in one click. */
async function reportQueue(env: Env): Promise<Response> {
  const weekAgoMs = Date.now() - 7 * 86400_000;
  const [{ results: open }, { results: handled }, { results: paused }] = await Promise.all([
    env.DB
      .prepare(`${QUEUE_SELECT} WHERE reports.report_status = 'open' ORDER BY reports.reported_at_ms LIMIT 500`)
      .all<QueueRow>(),
    // Closed by triage itself (bugs passed to the developer, dismissals under a precedent), to look over.
    env.DB
      .prepare(`${QUEUE_SELECT} WHERE reports.report_status != 'open' AND reports.closed_at_ms = reports.triaged_at_ms AND reports.closed_at_ms > ? ORDER BY reports.closed_at_ms DESC LIMIT 100`)
      .bind(weekAgoMs)
      .all<QueueRow>(),
    env.DB.prepare("SELECT id, game_id FROM versions WHERE report_held_at_ms IS NOT NULL AND scan_status = 'held'").all<{ id: string; game_id: string }>(),
  ]);
  const groups = groupReports(open);
  const pausedUpdate = new Map(paused.map((version) => [version.game_id, version.id]));
  const waiting = open.filter((report) => !report.triaged_at_ms).length;
  return page(
    env,
    "Reports",
    html`<h1>Reports</h1>
<p class="lead">${groups.length ? `${open.length} open ${open.length === 1 ? "report" : "reports"} about ${groups.length} ${groups.length === 1 ? "problem" : "problems"}, most serious first.` : "No open reports."}${waiting ? ` ${waiting} still being sorted.` : ""}</p>
${groups.map((group) => groupCard(group, pausedUpdate.get(group.lead.game_id)))}
${handled.length
      ? html`<details class="handled"><summary><h2>Handled without you this week (${handled.length})</h2></summary>
<table><tr><th>Game</th><th>What</th><th>Done</th><th>Player wrote</th><th>When</th></tr>${handled.map((report) => {
          const triage: Triage | null = report.triage ? JSON.parse(report.triage) : null;
          return html`<tr><td><a href="/admin/games/${report.game_id}">${report.title}</a></td><td>${triage?.summary ?? reportLabel(report)}</td><td>${triage?.ai_actions.join("; ") ?? ""}</td><td>${report.player_text}</td><td class="nowrap">${ago(report.reported_at_ms)}</td></tr>`;
        })}</table></details>`
      : ""}`,
  );
}

function groupCard(group: ReportGroup, pausedUpdate: string | undefined): Raw {
  const triage = group.triage;
  const game = group.lead;
  const recommendation = triage?.recommendation;
  const button = (label: string, action: string, recommended: boolean, danger = false) =>
    html`<button class="btn${recommended ? (danger ? " danger" : "") : " ghost"}" type="submit" formaction="${action}">${label}</button>`;
  const gameHeld = game.game_review_status === "held";
  const gameRemoved = game.game_review_status === "removed";
  const prefill = triage?.summary && triage.is_by_ai ? triage.summary : reportLabel(game);
  const challenged = triage?.precedent?.fit === "challenges" ? triage.precedent : null;
  const draft = triage?.precedent_draft;
  return html`<article class="note case sev${group.severityIndex}">
  <div class="row">${severityPill(group.severityIndex)}${triage?.is_spot_check ? html` <span class="pill spot">Spot-check</span>` : ""} <a href="/admin/games/${game.game_id}"><strong>${game.title}</strong></a> ${game.game_review_status !== "live" ? pill(game.game_review_status) : ""}
    <span class="muted">${group.rows.length > 1 ? `${group.rows.length} reports · first ${ago(group.rows[0]!.reported_at_ms)}` : ago(game.reported_at_ms)}</span></div>
  ${isPlayerGroup(group) ? html`<p class="muted">About ${game.reported_username ? html`<a href="/@${game.reported_username}">@${game.reported_username}</a> · ${game.reported_age_band}${game.reported_social_stopped_at_ms ? " · social side off" : ""}` : html`${game.player_name || "a player"}, a guest`}</p>` : ""}
  ${triage ? html`<p class="said">${triage.summary}</p>` : html`<p class="said">${reportLabel(game)}${game.player_text ? html`: “${game.player_text}”` : ""}</p><p class="muted">Waiting to be sorted.</p>`}
  ${triage ? html`<p class="muted">Recommended: <strong>${RECOMMENDED[triage.recommendation]}</strong>. ${triage.why}${triage.is_by_ai ? "" : " (Not sorted by AI.)"}</p>` : ""}
  ${triage?.precedent
    ? html`<p class="muted">${triage.precedent.fit === "fits" ? "Fits" : "Challenges"} the precedent <a href="/admin/precedents#p-${triage.precedent.id}">${triage.precedent.title}</a>.</p>`
    : triage?.is_by_ai
      ? html`<p class="muted">No precedent covers this yet.</p>`
      : ""}
  ${triage?.ai_actions.length ? html`<p class="muted">Done already: ${triage.ai_actions.join("; ")}.</p>` : ""}
  ${group.rechecks.map(
    (recheck) =>
      html`<p class="muted">Re-check of the game's files: ${recheck.recheck_status === "waiting" ? "running…" : recheck.recheck_status === "failed" ? `didn't finish (${recheck.summary ?? ""})` : recheck.findings?.length ? html`${recheck.scan_status === "rejected" ? pill("rejected") : ""} found ${recheck.findings.join("; ")}. ${recheck.summary ?? ""}` : `nothing new. ${recheck.summary ?? ""}`}</p>`,
  )}
  <details><summary>What players sent (${group.rows.length})</summary><table>${group.rows.map(
    (report) => html`<tr><td class="nowrap">${ago(report.reported_at_ms)}</td><td>${reportLabel(report)}${report.player_id ? html`<br><small class="muted">Player ID ${report.player_id}${report.has_block_between ? " · blocked by the reporter, or blocked them" : ""}</small>` : ""}</td><td>${report.player_text || html`<span class="muted">No details</span>`}${pictureLink(report)}</td></tr>`,
  )}</table></details>
  <form method="post" class="decide">
    <input type="hidden" name="back" value="queue">
    <input type="hidden" name="group" value="${group.id}">
    ${challenged ? html`<input type="hidden" name="p_replaces" value="${challenged.id}">` : ""}
    <div class="precedent">
      <label class="check"><input type="checkbox" name="precedent" value="1"${draft || challenged ? raw(" checked") : ""}> ${challenged ? html`Change the precedent “${challenged.title}” to decide cases like this the way you decide this one` : draft ? html`Also make it a precedent: <strong>${draft.title}</strong>` : "Also make it a precedent for cases like this"}</label>
      <details><summary>${draft ? html`Edit the precedent <span class="muted">· the AI suggests: ${PRECEDENT_LABEL[draft.decision]}</span>` : "Write the precedent"}</summary>
        <label>Name <input name="p_title" value="${draft?.title ?? ""}" maxlength="120"></label>
        <label>Applies when <textarea name="p_when" rows="2" maxlength="500">${draft?.applies_when ?? ""}</textarea></label>
        <label>Why <textarea name="p_why" rows="2" maxlength="500">${draft?.why ?? ""}</textarea></label>
        <label class="check"><input type="checkbox" name="p_alone" value="1"> If you dismiss it: the AI may dismiss cases like this without you</label>
      </details>
    </div>
    <div class="row">
    <input name="reason" value="${prefill}" aria-label="Why: for the audit log, and the developer reads it if you take the game down or keep the update off" title="For the audit log. If you take the game down or keep the update off, the developer reads it too (never for child safety)." maxlength="500">
    ${gameRemoved || isPlayerGroup(group) ? "" : ruleSelect({ contentRule: triage && isContentRule(triage.category) ? triage.category : null, isRequired: false })}
    ${isPlayerGroup(group) && !gameRemoved && !gameHeld && !pausedUpdate
      ? playerButtons(group, button)
      : gameRemoved
      ? button("Close", `/admin/report-groups/${group.id}/dismiss`, true)
      : gameHeld
        ? html`${button("Put the game back", `/admin/games/${game.game_id}/restore`, recommendation === "restore" || recommendation === "dismiss")}${button("Take down", `/admin/games/${game.game_id}/takedown`, recommendation === "take_down", true)}`
        : pausedUpdate
          ? html`${button("Put the update back", `/admin/versions/${pausedUpdate}/approve`, recommendation === "restore" || recommendation === "dismiss")}${button("Keep the update off", `/admin/versions/${pausedUpdate}/reject`, false)}${button("Take down", `/admin/games/${game.game_id}/takedown`, recommendation === "take_down", true)}`
          : html`${button("Dismiss", `/admin/report-groups/${group.id}/dismiss`, recommendation === "dismiss")}${group.rows.some((report) => report.room_name) ? button("Hide the room's name", `/admin/report-groups/${group.id}/hide-name`, false) : ""}${group.severityIndex === 0 ? "" : button("Tell the developer", `/admin/report-groups/${group.id}/bug`, recommendation === "bug")}${button("Take down", `/admin/games/${game.game_id}/takedown`, recommendation === "take_down", true)}`}
    </div>
  </form>
</article>`;
}

/** A player group's decisions (playerGroupChoices): turning off their social side asks which of the four it was. */
function playerButtons(group: ReportGroup, button: (label: string, action: string, recommended: boolean, danger?: boolean) => Raw): Raw {
  const choices = playerGroupChoices(group);
  const recommendation = group.triage?.recommendation;
  const picked = isForZaisma(group.lead.player_reason) ? group.lead.player_reason : "real_life_threat";
  return html`${button("Dismiss", `/admin/report-groups/${group.id}/dismiss`, recommendation === "dismiss")}${choices.includes("hide_name") ? button("Hide the room's name", `/admin/report-groups/${group.id}/hide-name`, false) : ""}${choices.includes("pass_to_developer") ? button("Pass to the developer", `/admin/report-groups/${group.id}/pass-to-developer`, recommendation === "pass_to_developer") : ""}${choices.includes("clear_profile") ? button("Clear their profile", `/admin/report-groups/${group.id}/clear-profile`, false) : ""}${
    choices.includes("stop_social")
      ? html`<select name="social_stopped_reason" aria-label="What the report found">${ZAISMA_PLAYER_REPORT_REASONS.map((reason) => html`<option value="${reason}"${reason === picked ? raw(" selected") : ""}>${PLAYER_REPORT_REASONS[reason]}</option>`)}</select>${button("Turn off their social side", `/admin/report-groups/${group.id}/stop-social`, recommendation === "stop_social", true)}`
      : ""
  }`;
}

/** What a decision in the queue means as a precedent: putting a game back means the report was wrong. */
function precedentDecision(path: string): PrecedentDecision | null {
  if (/^\/admin\/(report-groups\/[a-z0-9_]+\/dismiss|games\/[a-z0-9_]+\/restore|versions\/[a-z0-9_]+\/approve)$/.test(path)) return "dismiss";
  if (/^\/admin\/report-groups\/[a-z0-9_]+\/bug$/.test(path)) return "bug";
  if (/^\/admin\/report-groups\/[a-z0-9_]+\/pass-to-developer$/.test(path)) return "pass_to_developer";
  if (/^\/admin\/report-groups\/[a-z0-9_]+\/stop-social$/.test(path)) return "stop_social";
  if (/^\/admin\/(games\/[a-z0-9_]+\/takedown|versions\/[a-z0-9_]+\/reject)$/.test(path)) return "take_down";
  return null;
}

const pictureLink = (report: { id: string; has_picture: number }) => (report.has_picture ? html` <a href="/admin/reports/${report.id}/picture" target="_blank">Picture</a>` : "");

/** The picture of the game a player included with a report. */
async function reportPicture(env: Env, id: string): Promise<Response> {
  const object = await env.GAMES.get(reportPictureKey(id));
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}

async function adminImage(env: Env, id: string): Promise<Response> {
  const image = await imageById(env.DB, id);
  const object = image ? await env.GAMES.get(imageKey(image)) : null;
  if (!image || !object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": image.content_type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
