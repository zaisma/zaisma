import { AUTO_HOLD_REASONS, PLAYER_REPORT_REASONS, REPORT_REASONS, SEVERITY, type Game, type MultiplayerMode, type PlayerReportReason, type ReportReason, type ReviewStatus, type ScanReport, type ScanStatus, type Version, type Visibility } from "./types.ts";
import { newId } from "./ids.ts";
import type { ReviewReason } from "./review.ts";

const now = () => Date.now();

export async function gameBySlug(database: D1Database, slug: string): Promise<Game | null> {
  return database.prepare("SELECT * FROM games WHERE slug = ?").bind(slug).first<Game>();
}

export async function gameById(database: D1Database, id: string): Promise<Game | null> {
  return database.prepare("SELECT * FROM games WHERE id = ?").bind(id).first<Game>();
}

export async function gameByDomain(database: D1Database, hostname: string): Promise<Game | null> {
  return database
    .prepare("SELECT games.* FROM domains JOIN games ON games.id = domains.game_id WHERE domains.hostname = ?")
    .bind(hostname)
    .first<Game>();
}

/** What the game server needs: the game plus where its published files live. */
export async function servableGame(
  database: D1Database,
  by: { slug: string } | { hostname: string },
): Promise<(Game & { r2_prefix: string | null; version_kind: "zip" | "files" | null }) | null> {
  const where = "slug" in by ? "games.slug = ?" : "games.id = (SELECT game_id FROM domains WHERE hostname = ?)";
  return database
    .prepare(`SELECT games.*, versions.r2_prefix, versions.kind AS version_kind FROM games LEFT JOIN versions ON versions.id = games.live_version_id WHERE ${where}`)
    .bind("slug" in by ? by.slug : by.hostname)
    .first();
}

export async function liveGames(database: D1Database): Promise<Game[]> {
  const { results } = await database
    .prepare("SELECT * FROM games WHERE review_status = 'live' AND visibility = 'listed' AND live_version_id IS NOT NULL ORDER BY updated_at_ms DESC LIMIT 200")
    .all<Game>();
  return results;
}

export async function allGames(database: D1Database): Promise<Game[]> {
  const { results } = await database.prepare("SELECT * FROM games ORDER BY updated_at_ms DESC LIMIT 500").all<Game>();
  return results;
}

export async function createGame(
  database: D1Database,
  details: { slug: string; title: string; description: string; ownerId?: string; visibility?: Visibility },
): Promise<Game> {
  const { ownerId, visibility, ...words } = details;
  const game: Game = {
    id: newId("game"), ...words, review_status: "pending", review_reason: null, live_version_id: null, multiplayer_mode: "none", built_in_server: null, connect_hosts: "", owner_id: ownerId ?? null, cloud_saves_enabled: 1,
    visibility: visibility ?? "listed", devices: "", controls: "", screen_orientation: "", play_modes: "", room_browsing: "page", account_requirement: "none", is_off_shelves: 0, details_waiting_for_review: null, created_at_ms: now(), updated_at_ms: now(),
  };
  await database
    .prepare("INSERT INTO games (id, slug, title, description, review_status, live_version_id, owner_id, visibility, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(game.id, game.slug, game.title, game.description, game.review_status, null, game.owner_id, game.visibility, game.created_at_ms, game.updated_at_ms)
    .run();
  return game;
}

export async function updateGameInfo(database: D1Database, id: string, words: { title: string; description: string }): Promise<void> {
  await database.prepare("UPDATE games SET title = ?, description = ?, updated_at_ms = ? WHERE id = ?").bind(words.title, words.description, now(), id).run();
}

export async function setCloudSavesEnabled(database: D1Database, id: string, enabled: boolean): Promise<void> {
  await database.prepare("UPDATE games SET cloud_saves_enabled = ?, updated_at_ms = ? WHERE id = ?").bind(enabled ? 1 : 0, now(), id).run();
}

/** Admin: multiplayer, including one of Zaisma's own game servers, and the game's own servers it may connect to. */
export async function setMultiplayer(database: D1Database, id: string, multiplayer: { multiplayerMode: MultiplayerMode; builtInServer: string | null; connectHosts: string[] }): Promise<void> {
  await database
    .prepare("UPDATE games SET multiplayer_mode = ?, built_in_server = ?, connect_hosts = ?, updated_at_ms = ? WHERE id = ?")
    .bind(multiplayer.multiplayerMode, multiplayer.multiplayerMode === "built-in" ? multiplayer.builtInServer : null, multiplayer.connectHosts.join("\n"), now(), id)
    .run();
}

/** Zaisma's review of a game. Held and removed always say why; pending and live never do. */
export async function setReviewStatus(database: D1Database, id: string, reviewStatus: "pending" | "live"): Promise<void>;
export async function setReviewStatus(database: D1Database, id: string, reviewStatus: "held" | "removed", reviewReason: ReviewReason): Promise<void>;
export async function setReviewStatus(database: D1Database, id: string, reviewStatus: ReviewStatus, reviewReason: ReviewReason | null = null): Promise<void> {
  await database.prepare("UPDATE games SET review_status = ?, review_reason = ?, updated_at_ms = ? WHERE id = ?").bind(reviewStatus, reviewReason ? JSON.stringify(reviewReason) : null, now(), id).run();
}

export async function createVersion(
  database: D1Database,
  version: { id: string; gameId: string; r2Prefix: string; fileCount: number; sizeBytes: number; kind?: "zip" | "files"; patchNotes?: string; publishWhenApprovedEnabled?: boolean },
): Promise<void> {
  await database
    .prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, kind, patch_notes, publish_when_approved_enabled, created_at_ms) VALUES (?, ?, ?, ?, ?, 'scanning', ?, ?, ?, ?)")
    .bind(version.id, version.gameId, version.r2Prefix, version.fileCount, version.sizeBytes, version.kind ?? "zip", version.patchNotes ?? "", version.publishWhenApprovedEnabled === false ? 0 : 1, now())
    .run();
}

/** A secret for a link on the game domain (<slug>--<token>): 20 lowercase letters and digits. */
export function linkToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36]).join("");
}

/** A passed version that isn't published yet gets a private preview link. */
export async function approveDraft(database: D1Database, versionId: string): Promise<string> {
  const token = linkToken();
  await database.prepare("UPDATE versions SET scan_status = 'approved', preview_token = COALESCE(preview_token, ?) WHERE id = ?").bind(token, versionId).run();
  return (await database.prepare("SELECT preview_token FROM versions WHERE id = ?").bind(versionId).first<{ preview_token: string }>())!.preview_token;
}

export async function versionByPreview(database: D1Database, gameId: string, token: string): Promise<Version | null> {
  return database.prepare("SELECT * FROM versions WHERE preview_token = ? AND game_id = ? AND scan_status = 'approved'").bind(token, gameId).first<Version>();
}

export async function versionById(database: D1Database, id: string): Promise<Version | null> {
  return database.prepare("SELECT * FROM versions WHERE id = ?").bind(id).first<Version>();
}

export async function versionsForGame(database: D1Database, gameId: string): Promise<Version[]> {
  const { results } = await database.prepare("SELECT * FROM versions WHERE game_id = ? ORDER BY created_at_ms DESC LIMIT 20").bind(gameId).all<Version>();
  return results;
}

export async function heldVersions(database: D1Database): Promise<(Version & { slug: string; title: string })[]> {
  const { results } = await database
    .prepare("SELECT versions.*, games.slug, games.title FROM versions JOIN games ON games.id = versions.game_id WHERE versions.scan_status IN ('held', 'scanning') ORDER BY versions.created_at_ms DESC")
    .all<Version & { slug: string; title: string }>();
  return results;
}

export async function saveScan(database: D1Database, versionId: string, scanStatus: ScanStatus, report: ScanReport | null): Promise<void> {
  await database.prepare("UPDATE versions SET scan_status = ?, scan_report = COALESCE(?, scan_report) WHERE id = ?").bind(scanStatus, report ? JSON.stringify(report) : null, versionId).run();
}

/** Make a version the one players get. A removed or held game stays hidden. */
export async function publishVersion(database: D1Database, version: Version): Promise<void> {
  await database.batch([
    database.prepare("UPDATE versions SET scan_status = 'approved', published_at_ms = ?, scheduled_publish_at_ms = NULL WHERE id = ?").bind(now(), version.id),
    database
      .prepare("UPDATE games SET live_version_id = ?, review_status = CASE WHEN review_status IN ('removed', 'held') THEN review_status ELSE 'live' END, updated_at_ms = ? WHERE id = ?")
      .bind(version.id, now(), version.game_id),
  ]);
}

/** A person checked this version after a report: later reports can't pause it. */
export async function clearVersion(database: D1Database, versionId: string): Promise<void> {
  await database.prepare("UPDATE versions SET cleared_at_ms = ?, report_held_at_ms = NULL WHERE id = ?").bind(now(), versionId).run();
}

/**
 * Note what happened to a game. `reason` is for Zaisma's own eyes; `reviewReason`, for a hold,
 * rejection or takedown, is what the developer reads about it in the game's history.
 */
export async function audit(database: D1Database, gameId: string | null, action: string, reason = "", actor = "system", reviewReason: ReviewReason | null = null): Promise<void> {
  await database
    .prepare("INSERT INTO audit_log (game_id, action, reason, actor, happened_at_ms, review_reason) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(gameId, action, reason, actor, now(), reviewReason ? JSON.stringify(reviewReason) : null)
    .run();
}

/** A row of the audit log: what happened to a game, and who did it. */
export interface AuditEntry {
  id: number;
  game_id: string | null;
  slug: string | null;
  action: string;
  reason: string;
  actor: string;
  happened_at_ms: number;
  /** For a hold, rejection or takedown: what the developer reads about it, as JSON (a ReviewReason). */
  review_reason: string | null;
}

export async function auditLog(database: D1Database, gameId?: string): Promise<AuditEntry[]> {
  const sql = `SELECT audit_log.*, games.slug FROM audit_log LEFT JOIN games ON games.id = audit_log.game_id ${gameId ? "WHERE audit_log.game_id = ?" : ""} ORDER BY happened_at_ms DESC LIMIT 200`;
  const statement = gameId ? database.prepare(sql).bind(gameId) : database.prepare(sql);
  return (await statement.all<AuditEntry>()).results;
}

export interface Report {
  id: string;
  game_id: string;
  reason: string;
  player_text: string;
  report_status: "open" | "dismissed" | "actioned";
  reported_at_ms: number;
  /** The version that was live when it was reported. */
  version_id: string | null;
  room_code: string;
  /** The room's name and labels when it was reported. */
  room_name: string | null;
  /** A report about a player: their temporary ID and name, and what they did (a PLAYER_REPORT_REASONS key). */
  player_id: string;
  player_name: string;
  player_reason: string;
  /** 1 when the player included a picture of the game (reportPictureKey). */
  has_picture: number;
  closed_at_ms: number | null;
  /** 0 child safety, 1 urgent, 2 high, 3 normal, 4 low (SEVERITIES). */
  severity_index: number;
  /** The first open report about the same problem, or null when this report starts its group. */
  report_group_id: string | null;
  /** JSON Triage, once AI report triage has looked at it. */
  triage: string | null;
  triaged_at_ms: number | null;
  triage_attempt_count: number;
  /** 1 when the developer sees it as a bug report, since bug_report_at_ms. */
  is_bug_report: number;
  bug_report_at_ms: number | null;
  /** The precedent it was decided by, or recommended under. */
  precedent_id: string | null;
}

/** Where a report's picture is kept, in the games bucket. Never served on the game domain. */
export const reportPictureKey = (reportId: string) => `report-pictures/${reportId}.jpg`;

export interface NewReport {
  gameId: string;
  reason: string;
  playerText: string;
  versionId?: string | null;
  roomCode?: string;
  /** The room's name and labels when it was reported, like "Ana's castle (Mode: Classic)". */
  roomName?: string | null;
  player?: { id: string; name: string; reason: string };
}

/** How serious a report is from its reason alone, before triage looks at it: its place in SEVERITIES. */
export function reportSeverityIndex(reason: string, playerReason = ""): number {
  if (reason === "child_safety") return SEVERITY.child_safety;
  if ((AUTO_HOLD_REASONS as string[]).includes(reason)) return SEVERITY.urgent;
  if (["malware", "sexual", "hate"].includes(reason) || ["sexual", "hate"].includes(playerReason)) return SEVERITY.high;
  if (reason === "copyright") return SEVERITY.low;
  return SEVERITY.normal;
}

/** Nothing about the person reporting is ever passed in or stored. */
export async function createReport(database: D1Database, report: NewReport): Promise<string> {
  const id = newId("report");
  await database
    .prepare("INSERT INTO reports (id, game_id, reason, player_text, reported_at_ms, version_id, room_code, room_name, player_id, player_name, player_reason, severity_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, report.gameId, report.reason, report.playerText, now(), report.versionId ?? null, report.roomCode ?? "", report.roomName ?? null, report.player?.id ?? "", report.player?.name ?? "", report.player?.reason ?? "", reportSeverityIndex(report.reason, report.player?.reason))
    .run();
  return id;
}

/** What a report is about, in a line: "Another player's behavior: Cheating (Swift Fox 42, room ABCDEF)". */
export function reportLabel(report: Pick<Report, "reason" | "room_code" | "player_name" | "player_reason"> & { room_name?: string | null }): string {
  let label: string = REPORT_REASONS[report.reason as ReportReason] ?? report.reason;
  if (report.player_reason) label += `: ${PLAYER_REPORT_REASONS[report.player_reason as PlayerReportReason] ?? report.player_reason}`;
  const where = [report.player_name, report.room_code && `room ${report.room_code}${report.room_name ? ` “${report.room_name}”` : ""}`].filter(Boolean).join(", ");
  return where ? `${label} (${where})` : label;
}

export async function openReports(database: D1Database): Promise<(Report & { slug: string; title: string; game_review_status: ReviewStatus })[]> {
  const { results } = await database
    .prepare("SELECT reports.*, games.slug, games.title, games.review_status AS game_review_status FROM reports JOIN games ON games.id = reports.game_id WHERE reports.report_status = 'open' ORDER BY reports.reported_at_ms DESC LIMIT 200")
    .all<Report & { slug: string; title: string; game_review_status: ReviewStatus }>();
  return results;
}

export async function closeReports(database: D1Database, gameId: string, reportStatus: "dismissed" | "actioned"): Promise<void> {
  await database.prepare("UPDATE reports SET report_status = ?, closed_at_ms = ? WHERE game_id = ? AND report_status = 'open'").bind(reportStatus, now(), gameId).run();
}

/** Close one group of reports about the same problem: the first report and every one merged into it. */
export async function closeReportGroup(database: D1Database, reportGroupId: string, reportStatus: "dismissed" | "actioned"): Promise<void> {
  await database.prepare("UPDATE reports SET report_status = ?, closed_at_ms = ? WHERE (id = ? OR report_group_id = ?) AND report_status = 'open'").bind(reportStatus, now(), reportGroupId, reportGroupId).run();
}

export function currentMonth(today = new Date()): string {
  return today.toISOString().slice(0, 7);
}

export async function aiUsage(database: D1Database, month = currentMonth()): Promise<{ input_token_count: number; output_token_count: number; scan_call_count: number; report_triage_call_count: number; forum_call_count: number }> {
  return (await database.prepare("SELECT input_token_count, output_token_count, scan_call_count, report_triage_call_count, forum_call_count FROM ai_usage WHERE month = ?").bind(month).first()) ?? { input_token_count: 0, output_token_count: 0, scan_call_count: 0, report_triage_call_count: 0, forum_call_count: 0 };
}

/** Scans, report triage and feedback sorting share one monthly budget. */
export async function addAiUsage(database: D1Database, inputTokenCount: number, outputTokenCount: number, what: "scans" | "reports" | "feedback" = "scans", month = currentMonth()): Promise<void> {
  const [scanCallCount, reportTriageCallCount, forumCallCount] = [what === "scans" ? 1 : 0, what === "reports" ? 1 : 0, what === "feedback" ? 1 : 0];
  await database
    .prepare(
      "INSERT INTO ai_usage (month, input_token_count, output_token_count, scan_call_count, report_triage_call_count, forum_call_count) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(month) DO UPDATE SET input_token_count = input_token_count + excluded.input_token_count, output_token_count = output_token_count + excluded.output_token_count, scan_call_count = scan_call_count + excluded.scan_call_count, report_triage_call_count = report_triage_call_count + excluded.report_triage_call_count, forum_call_count = forum_call_count + excluded.forum_call_count",
    )
    .bind(month, inputTokenCount, outputTokenCount, scanCallCount, reportTriageCallCount, forumCallCount)
    .run();
}

/** Tester links a developer can have turned on per game. */
export const MAXIMUM_TESTER_LINK_COUNT = 50;

/** A row of the tester_links table: the same names the developer API shows. */
export interface TesterLink {
  id: string;
  game_id: string;
  name: string;
  token: string;
  created_at_ms: number;
  last_opened_at_ms: number | null;
  revoked_at_ms: number | null;
}

export async function testerLinks(database: D1Database, gameId: string): Promise<TesterLink[]> {
  const { results } = await database.prepare("SELECT * FROM tester_links WHERE game_id = ? AND revoked_at_ms IS NULL ORDER BY created_at_ms DESC").bind(gameId).all<TesterLink>();
  return results;
}

/** A tester link that's still on, with its game's slug. */
export async function testerLinkByToken(database: D1Database, token: string): Promise<(TesterLink & { slug: string }) | null> {
  if (!/^[a-z0-9]{20}$/.test(token)) return null;
  return database
    .prepare("SELECT tester_links.*, games.slug FROM tester_links JOIN games ON games.id = tester_links.game_id WHERE tester_links.token = ? AND tester_links.revoked_at_ms IS NULL")
    .bind(token)
    .first();
}

export async function addTesterLink(database: D1Database, gameId: string, name: string): Promise<TesterLink> {
  const link: TesterLink = { id: newId("tester"), game_id: gameId, name, token: linkToken(), created_at_ms: now(), last_opened_at_ms: null, revoked_at_ms: null };
  await database.prepare("INSERT INTO tester_links (id, game_id, name, token, created_at_ms) VALUES (?, ?, ?, ?, ?)").bind(link.id, gameId, name, link.token, link.created_at_ms).run();
  return link;
}

/** Turn a link off for good. False if it wasn't on. */
export async function revokeTesterLink(database: D1Database, gameId: string, id: string): Promise<boolean> {
  const revoked = await database.prepare("UPDATE tester_links SET revoked_at_ms = ? WHERE id = ? AND game_id = ? AND revoked_at_ms IS NULL").bind(now(), id, gameId).run();
  return revoked.meta.changes > 0;
}

/** Note that a tester link was opened, at most once an hour so a busy link costs no extra writes. */
export async function testerLinkOpened(database: D1Database, id: string): Promise<void> {
  const openedAtMs = now();
  await database.prepare("UPDATE tester_links SET last_opened_at_ms = ? WHERE id = ? AND (last_opened_at_ms IS NULL OR last_opened_at_ms < ?)").bind(openedAtMs, id, openedAtMs - 3600_000).run();
}
