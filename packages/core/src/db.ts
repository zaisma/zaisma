import type { Game, GameStatus, ScanReport, ScanStatus, Version } from "./types.ts";
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
): Promise<(Game & { r2_prefix: string | null }) | null> {
  const where = "slug" in by ? "games.slug = ?" : "games.id = (SELECT game_id FROM domains WHERE hostname = ?)";
  return db
    .prepare(`SELECT games.*, versions.r2_prefix FROM games LEFT JOIN versions ON versions.id = games.current_version_id WHERE ${where}`)
    .bind("slug" in by ? by.slug : by.hostname)
    .first();
}

export async function liveGames(db: D1Database): Promise<Game[]> {
  const { results } = await db
    .prepare("SELECT * FROM games WHERE status = 'live' AND current_version_id IS NOT NULL ORDER BY updated_at DESC LIMIT 200")
    .all<Game>();
  return results;
}

export async function allGames(db: D1Database): Promise<Game[]> {
  const { results } = await db.prepare("SELECT * FROM games ORDER BY updated_at DESC LIMIT 500").all<Game>();
  return results;
}

export async function createGame(db: D1Database, g: { slug: string; title: string; description: string }): Promise<Game> {
  const game: Game = { id: newId(), ...g, status: "pending", current_version_id: null, game_server: null, connect_hosts: "", owner_id: null, created_at: now(), updated_at: now() };
  await db
    .prepare("INSERT INTO games (id, slug, title, description, status, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(game.id, game.slug, game.title, game.description, game.status, null, game.created_at, game.updated_at)
    .run();
  return game;
}

export async function updateGameInfo(db: D1Database, id: string, g: { title: string; description: string }): Promise<void> {
  await db.prepare("UPDATE games SET title = ?, description = ?, updated_at = ? WHERE id = ?").bind(g.title, g.description, now(), id).run();
}

export async function setMultiplayer(db: D1Database, id: string, m: { gameServer: string | null; connectHosts: string[] }): Promise<void> {
  await db.prepare("UPDATE games SET game_server = ?, connect_hosts = ?, updated_at = ? WHERE id = ?").bind(m.gameServer, m.connectHosts.join("\n"), now(), id).run();
}

export async function setGameStatus(db: D1Database, id: string, status: GameStatus): Promise<void> {
  await db.prepare("UPDATE games SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), id).run();
}

export async function createVersion(db: D1Database, v: { id: string; gameId: string; prefix: string; files: number; bytes: number }): Promise<void> {
  await db
    .prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, bytes, scan_status, created_at) VALUES (?, ?, ?, ?, ?, 'scanning', ?)")
    .bind(v.id, v.gameId, v.prefix, v.files, v.bytes, now())
    .run();
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
    db.prepare("UPDATE versions SET scan_status = 'approved' WHERE id = ?").bind(version.id),
    db
      .prepare("UPDATE games SET current_version_id = ?, status = CASE WHEN status IN ('removed', 'held') THEN status ELSE 'live' END, updated_at = ? WHERE id = ?")
      .bind(version.id, now(), version.game_id),
  ]);
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
}

export async function createReport(db: D1Database, r: { gameId: string; reason: string; details: string }): Promise<string> {
  const id = newId();
  await db.prepare("INSERT INTO reports (id, game_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, r.gameId, r.reason, r.details, now()).run();
  return id;
}

export async function openReports(db: D1Database): Promise<(Report & { slug: string; title: string; game_status: GameStatus })[]> {
  const { results } = await db
    .prepare("SELECT reports.*, games.slug, games.title, games.status AS game_status FROM reports JOIN games ON games.id = reports.game_id WHERE reports.status = 'open' ORDER BY reports.created_at DESC LIMIT 200")
    .all<Report & { slug: string; title: string; game_status: GameStatus }>();
  return results;
}

export async function closeReports(db: D1Database, gameId: string, status: "dismissed" | "actioned"): Promise<void> {
  await db.prepare("UPDATE reports SET status = ? WHERE game_id = ? AND status = 'open'").bind(status, gameId).run();
}

export function currentMonth(at = new Date()): string {
  return at.toISOString().slice(0, 7);
}

export async function aiUsage(db: D1Database, month = currentMonth()): Promise<{ input_tokens: number; output_tokens: number; scans: number }> {
  return (await db.prepare("SELECT input_tokens, output_tokens, scans FROM ai_usage WHERE month = ?").bind(month).first()) ?? { input_tokens: 0, output_tokens: 0, scans: 0 };
}

export async function addAiUsage(db: D1Database, input: number, output: number, month = currentMonth()): Promise<void> {
  await db
    .prepare("INSERT INTO ai_usage (month, input_tokens, output_tokens, scans) VALUES (?, ?, ?, 1) ON CONFLICT(month) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, scans = scans + 1")
    .bind(month, input, output)
    .run();
}
