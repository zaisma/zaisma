import { AUTO_HOLD_REASONS, PLAYER_REPORT_REASONS, REPORT_REASONS, SEVERITY, type Game, type GameStatus, type PlayerReportReason, type ReportReason, type ScanReport, type ScanStatus, type Version, type Visibility } from "./types.ts";
import { newId } from "./ids.ts";

const now = () => Date.now();

export async function gameBySlug(db: D1Database, slug: string): Promise<Game | null> {
  return db.prepare("SELECT * FROM games WHERE slug = ?").bind(slug).first<Game>();
}

export async function gameById(db: D1Database, id: string): Promise<Game | null> {
  return db.prepare("SELECT * FROM games WHERE id = ?").bind(id).first<Game>();
}

export async function gameByDomain(db: D1Database, hostname: string): Promise<Game | null> {
  return db
    .prepare("SELECT games.* FROM domains JOIN games ON games.id = domains.game_id WHERE domains.hostname = ?")
    .bind(hostname)
    .first<Game>();
}

/** What the game server needs: the game plus where its published files live. */
export async function servableGame(
  db: D1Database,
  by: { slug: string } | { hostname: string },
): Promise<(Game & { r2_prefix: string | null; version_kind: "zip" | "files" | null }) | null> {
  const where = "slug" in by ? "games.slug = ?" : "games.id = (SELECT game_id FROM domains WHERE hostname = ?)";
  return db
    .prepare(`SELECT games.*, versions.r2_prefix, versions.kind AS version_kind FROM games LEFT JOIN versions ON versions.id = games.current_version_id WHERE ${where}`)
    .bind("slug" in by ? by.slug : by.hostname)
    .first();
}

export async function liveGames(db: D1Database): Promise<Game[]> {
  const { results } = await db
    .prepare("SELECT * FROM games WHERE status = 'live' AND visibility = 'listed' AND current_version_id IS NOT NULL ORDER BY updated_at DESC LIMIT 200")
    .all<Game>();
  return results;
}

export async function allGames(db: D1Database): Promise<Game[]> {
  const { results } = await db.prepare("SELECT * FROM games ORDER BY updated_at DESC LIMIT 500").all<Game>();
  return results;
}

export async function createGame(
  db: D1Database,
  g: { slug: string; title: string; description: string; ownerId?: string; visibility?: Visibility },
): Promise<Game> {
  const { ownerId, visibility, ...info } = g;
  const game: Game = {
    id: newId(), ...info, status: "pending", current_version_id: null, game_server: null, connect_hosts: "", owner_id: ownerId ?? null, cloud_saves: 1,
    visibility: visibility ?? "listed", devices: "", controls: "", screen: "", players: "", details_draft: null, created_at: now(), updated_at: now(),
  };
  await db
    .prepare("INSERT INTO games (id, slug, title, description, status, current_version_id, owner_id, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(game.id, game.slug, game.title, game.description, game.status, null, game.owner_id, game.visibility, game.created_at, game.updated_at)
    .run();
  return game;
}

export async function updateGameInfo(db: D1Database, id: string, g: { title: string; description: string }): Promise<void> {
  await db.prepare("UPDATE games SET title = ?, description = ?, updated_at = ? WHERE id = ?").bind(g.title, g.description, now(), id).run();
}

export async function setCloudSaves(db: D1Database, id: string, on: boolean): Promise<void> {
  await db.prepare("UPDATE games SET cloud_saves = ?, updated_at = ? WHERE id = ?").bind(on ? 1 : 0, now(), id).run();
}

export async function setMultiplayer(db: D1Database, id: string, m: { gameServer: string | null; connectHosts: string[] }): Promise<void> {
  await db.prepare("UPDATE games SET game_server = ?, connect_hosts = ?, updated_at = ? WHERE id = ?").bind(m.gameServer, m.connectHosts.join("\n"), now(), id).run();
}

export async function setGameStatus(db: D1Database, id: string, status: GameStatus): Promise<void> {
  await db.prepare("UPDATE games SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
}

export async function createVersion(
  db: D1Database,
  v: { id: string; gameId: string; prefix: string; files: number; bytes: number; kind?: "zip" | "files"; notes?: string; publishWhenApproved?: boolean },
): Promise<void> {
  await db
    .prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, bytes, scan_status, kind, notes, publish_when_approved, created_at) VALUES (?, ?, ?, ?, ?, 'scanning', ?, ?, ?, ?)")
    .bind(v.id, v.gameId, v.prefix, v.files, v.bytes, v.kind ?? "zip", v.notes ?? "", v.publishWhenApproved === false ? 0 : 1, now())
    .run();
}

/** A passed version that isn't published yet gets a private preview link. */
export async function approveDraft(db: D1Database, versionId: string): Promise<string> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  await db.prepare("UPDATE versions SET scan_status = 'approved', preview_token = COALESCE(preview_token, ?) WHERE id = ?").bind(token, versionId).run();
  return (await db.prepare("SELECT preview_token FROM versions WHERE id = ?").bind(versionId).first<{ preview_token: string }>())!.preview_token;
}

export async function versionByPreview(db: D1Database, gameId: string, token: string): Promise<Version | null> {
  return db.prepare("SELECT * FROM versions WHERE preview_token = ? AND game_id = ? AND scan_status = 'approved'").bind(token, gameId).first<Version>();
}

export async function versionById(db: D1Database, id: string): Promise<Version | null> {
  return db.prepare("SELECT * FROM versions WHERE id = ?").bind(id).first<Version>();
}

export async function versionsForGame(db: D1Database, gameId: string): Promise<Version[]> {
  const { results } = await db.prepare("SELECT * FROM versions WHERE game_id = ? ORDER BY created_at DESC LIMIT 20").bind(gameId).all<Version>();
  return results;
}

export async function heldVersions(db: D1Database): Promise<(Version & { slug: string; title: string })[]> {
  const { results } = await db
    .prepare("SELECT versions.*, games.slug, games.title FROM versions JOIN games ON games.id = versions.game_id WHERE versions.scan_status IN ('held', 'scanning') ORDER BY versions.created_at DESC")
    .all<Version & { slug: string; title: string }>();
  return results;
}

export async function saveScan(db: D1Database, versionId: string, status: ScanStatus, report: ScanReport | null): Promise<void> {
  await db.prepare("UPDATE versions SET scan_status = ?, scan_report = COALESCE(?, scan_report) WHERE id = ?").bind(status, report ? JSON.stringify(report) : null, versionId).run();
}

/** Make a version the one players get. A removed or held game stays hidden. */
export async function publishVersion(db: D1Database, version: Version): Promise<void> {
  await db.batch([
    db.prepare("UPDATE versions SET scan_status = 'approved', published_at = ?, publish_at = NULL WHERE id = ?").bind(now(), version.id),
    db
      .prepare("UPDATE games SET current_version_id = ?, status = CASE WHEN status IN ('removed', 'held') THEN status ELSE 'live' END, updated_at = ? WHERE id = ?")
      .bind(version.id, now(), version.game_id),
  ]);
}

/** A person checked this version after a report: later reports can't pause it. */
export async function clearVersion(db: D1Database, versionId: string): Promise<void> {
  await db.prepare("UPDATE versions SET cleared_at = ?, report_held_at = NULL WHERE id = ?").bind(now(), versionId).run();
}

export async function audit(db: D1Database, gameId: string | null, action: string, reason = "", actor = "system"): Promise<void> {
  await db.prepare("INSERT INTO audit_log (game_id, action, reason, actor, at) VALUES (?, ?, ?, ?, ?)").bind(gameId, action, reason, actor, now()).run();
}

export interface AuditEntry {
  id: number;
  game_id: string | null;
  slug: string | null;
  action: string;
  reason: string;
  actor: string;
  at: number;
}

export async function auditLog(db: D1Database, gameId?: string): Promise<AuditEntry[]> {
  const sql = `SELECT audit_log.*, games.slug FROM audit_log LEFT JOIN games ON games.id = audit_log.game_id ${gameId ? "WHERE audit_log.game_id = ?" : ""} ORDER BY at DESC LIMIT 200`;
  const stmt = gameId ? db.prepare(sql).bind(gameId) : db.prepare(sql);
  return (await stmt.all<AuditEntry>()).results;
}

export interface Report {
  id: string;
  game_id: string;
  reason: string;
  details: string;
  status: "open" | "dismissed" | "actioned";
  created_at: number;
  /** The version that was live when it was reported. */
  version_id: string | null;
  room_code: string;
  /** A report about a player: their temporary ID and name, and what they did (a PLAYER_REPORT_REASONS key). */
  player_id: string;
  player_name: string;
  player_reason: string;
  /** 1 when the player included a picture of the game (reportPictureKey). */
  picture: number;
  closed_at: number | null;
  /** 0 child safety, 1 urgent, 2 high, 3 normal, 4 low (SEVERITIES). */
  severity: number;
  /** The first open report about the same problem, or null when this report starts its group. */
  group_id: string | null;
  /** JSON Triage, once AI report triage has looked at it. */
  triage: string | null;
  triaged_at: number | null;
  triage_tries: number;
  /** 1 when the developer sees it as a bug report, since bug_at. */
  bug: number;
  bug_at: number | null;
  /** The precedent it was decided by, or recommended under. */
  precedent_id: string | null;
}

/** Where a report's picture is kept, in the games bucket. Never served on the game domain. */
export const reportPictureKey = (reportId: string) => `report-pictures/${reportId}.jpg`;

export interface NewReport {
  gameId: string;
  reason: string;
  details: string;
  versionId?: string | null;
  roomCode?: string;
  player?: { id: string; name: string; reason: string };
}

/** How serious a report is from its reason alone, before triage looks at it. */
export function reportSeverity(reason: string, playerReason = ""): number {
  if (reason === "child_safety") return SEVERITY.child_safety;
  if ((AUTO_HOLD_REASONS as string[]).includes(reason)) return SEVERITY.urgent;
  if (["malware", "sexual", "hate"].includes(reason) || ["sexual", "hate"].includes(playerReason)) return SEVERITY.high;
  if (reason === "copyright") return SEVERITY.low;
  return SEVERITY.normal;
}

/** Nothing about the person reporting is ever passed in or stored. */
export async function createReport(db: D1Database, r: NewReport): Promise<string> {
  const id = newId();
  await db
    .prepare("INSERT INTO reports (id, game_id, reason, details, created_at, version_id, room_code, player_id, player_name, player_reason, severity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, r.gameId, r.reason, r.details, now(), r.versionId ?? null, r.roomCode ?? "", r.player?.id ?? "", r.player?.name ?? "", r.player?.reason ?? "", reportSeverity(r.reason, r.player?.reason))
    .run();
  return id;
}

/** What a report is about, in a line: "Another player's behavior: Cheating (Swift Fox 42, room ABCDEF)". */
export function reportLabel(r: Pick<Report, "reason" | "room_code" | "player_name" | "player_reason">): string {
  let label: string = REPORT_REASONS[r.reason as ReportReason] ?? r.reason;
  if (r.player_reason) label += `: ${PLAYER_REPORT_REASONS[r.player_reason as PlayerReportReason] ?? r.player_reason}`;
  const where = [r.player_name, r.room_code && `room ${r.room_code}`].filter(Boolean).join(", ");
  return where ? `${label} (${where})` : label;
}

export async function openReports(db: D1Database): Promise<(Report & { slug: string; title: string; game_status: GameStatus })[]> {
  const { results } = await db
    .prepare("SELECT reports.*, games.slug, games.title, games.status AS game_status FROM reports JOIN games ON games.id = reports.game_id WHERE reports.status = 'open' ORDER BY reports.created_at DESC LIMIT 200")
    .all<Report & { slug: string; title: string; game_status: GameStatus }>();
  return results;
}

export async function closeReports(db: D1Database, gameId: string, status: "dismissed" | "actioned"): Promise<void> {
  await db.prepare("UPDATE reports SET status = ?, closed_at = ? WHERE game_id = ? AND status = 'open'").bind(status, now(), gameId).run();
}

/** Close one group of reports about the same problem: the first report and every one merged into it. */
export async function closeReportGroup(db: D1Database, groupId: string, status: "dismissed" | "actioned"): Promise<void> {
  await db.prepare("UPDATE reports SET status = ?, closed_at = ? WHERE (id = ? OR group_id = ?) AND status = 'open'").bind(status, now(), groupId, groupId).run();
}

export function currentMonth(at = new Date()): string {
  return at.toISOString().slice(0, 7);
}

export async function aiUsage(db: D1Database, month = currentMonth()): Promise<{ input_tokens: number; output_tokens: number; scans: number; reports: number }> {
  return (await db.prepare("SELECT input_tokens, output_tokens, scans, reports FROM ai_usage WHERE month = ?").bind(month).first()) ?? { input_tokens: 0, output_tokens: 0, scans: 0, reports: 0 };
}

/** Scans and report triage share one monthly budget. */
export async function addAiUsage(db: D1Database, input: number, output: number, what: "scans" | "reports" = "scans", month = currentMonth()): Promise<void> {
  const [scans, reports] = what === "scans" ? [1, 0] : [0, 1];
  await db
    .prepare(
      "INSERT INTO ai_usage (month, input_tokens, output_tokens, scans, reports) VALUES (?, ?, ?, ?, ?) ON CONFLICT(month) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, scans = scans + excluded.scans, reports = reports + excluded.reports",
    )
    .bind(month, input, output, scans, reports)
    .run();
}
