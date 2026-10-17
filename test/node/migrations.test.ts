import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/** Migrations that move data as well as names: each one checked on a database from just before it. */

const MIGRATIONS = join(import.meta.dirname, "../../migrations");

/** A database with every migration before the one starting with `prefix`, `before` run in it, and then the rest. */
function migratedFrom(prefix: string, before: string): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  const index = files.findIndex((name) => name.startsWith(prefix));
  for (const file of files.slice(0, index)) database.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  database.exec(before);
  for (const file of files.slice(index)) database.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  return database;
}

describe("migration 0034", () => {
  const scanReport = {
    finishedAt: 1792012345678,
    decision: "held",
    findings: [{ rule: "outside-host", severity: "hold", detail: "Loads code from another site.", path: "index.html" }],
    outsideHosts: ["cdn.example.com"],
    images: { provider: "photodna", connected: true, checked: 3 },
    ai: { model: "claude-haiku-5-5", verdict: "hold", summary: "Loads a script from elsewhere.", inputTokens: 1200, outputTokens: 80 },
    childSafety: false,
  };
  const triage = {
    ai: true,
    category: "broken",
    summary: "The game doesn't load.",
    recommendation: "recheck",
    why: "A version changed since.",
    actions: ["Asked for a fresh look at the files."],
    recheck: { status: "done", decision: "approved", summary: "Fine now.", findings: [] },
    precedent: { id: "precedent_hard-or-boring", title: "Too hard", fit: "fits" },
    draft: { title: "Broken after an update", applies_when: "A game stops loading.", decision: "bug", why: "The developer's to fix." },
    spot_check: false,
  };
  const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  const database = migratedFrom(
    "0034_",
    `
    INSERT INTO games (id, slug, title, review_status, created_at_ms, updated_at_ms) VALUES ('game_sky', 'sky-hopper', 'Sky Hopper', 'live', 1, 1);
    INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms, scan_report) VALUES ('version_held', 'game_sky', 'manifests/version_held', 1, 10, 'held', 1, ${json(scanReport)});
    INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms, scan_report) VALUES ('version_new', 'game_sky', 'manifests/version_new', 1, 10, 'scanning', 1, NULL);
    INSERT INTO reports (id, game_id, reason, details, status, created_at, picture, severity, group_id, triage, triaged_at, triage_tries, bug, bug_at)
      VALUES ('report_first', 'game_sky', 'broken', 'It stays black.', 'open', 5, 1, 3, NULL, ${json(triage)}, 6, 1, 1, 7);
    INSERT INTO reports (id, game_id, reason, created_at, group_id) VALUES ('report_second', 'game_sky', 'broken', 8, 'report_first');
    `,
  );
  const read = (sql: string) => database.prepare(sql).all();

  it("keeps scan reports, in snake_case all the way down", () => {
    const [held, fresh] = read("SELECT scan_report FROM versions ORDER BY id").map((row) => row.scan_report as string | null);
    expect(JSON.parse(held!)).toEqual({
      finished_at_ms: 1792012345678,
      decision: "held",
      // Named by code since migration 0035.
      findings: [{ code: "outside_host", severity: "hold", message: "Loads code from another site.", path: "index.html" }],
      outside_hosts: ["cdn.example.com"],
      images: { provider: "photodna", is_connected: true, checked_media_count: 3 },
      ai: { model: "claude-haiku-5-5", verdict: "hold", summary: "Loads a script from elsewhere.", input_token_count: 1200, output_token_count: 80 },
      is_child_safety: false,
    });
    expect(fresh).toBeNull();
  });

  it("keeps reports and their triage, in the admin MCP's words", () => {
    expect(read("SELECT id, player_text, report_status, reported_at_ms, has_picture, severity_index, report_group_id, triaged_at_ms, triage_attempt_count, is_bug_report, bug_report_at_ms FROM reports ORDER BY id")).toEqual([
      { id: "report_first", player_text: "It stays black.", report_status: "open", reported_at_ms: 5, has_picture: 1, severity_index: 3, report_group_id: null, triaged_at_ms: 6, triage_attempt_count: 1, is_bug_report: 1, bug_report_at_ms: 7 },
      { id: "report_second", player_text: "", report_status: "open", reported_at_ms: 8, has_picture: 0, severity_index: 3, report_group_id: "report_first", triaged_at_ms: null, triage_attempt_count: 0, is_bug_report: 0, bug_report_at_ms: null },
    ]);
    const [first, second] = read("SELECT triage FROM reports ORDER BY id").map((row) => row.triage as string | null);
    expect(JSON.parse(first!)).toEqual({
      is_by_ai: true,
      category: "broken",
      summary: "The game doesn't load.",
      recommendation: "recheck",
      why: "A version changed since.",
      ai_actions: ["Asked for a fresh look at the files."],
      recheck: { recheck_status: "done", scan_status: "approved", summary: "Fine now.", findings: [] },
      precedent: { id: "precedent_hard-or-boring", title: "Too hard", fit: "fits" },
      precedent_draft: triage.draft,
      is_spot_check: false,
    });
    expect(second).toBeNull();
  });
});

describe("migration 0035", () => {
  const report = (decision: string, findings: unknown[]) => ({
    finished_at_ms: 1,
    decision,
    findings,
    outside_hosts: [],
    images: { provider: "none", is_connected: false, checked_media_count: 0 },
    ai: null,
    is_child_safety: false,
  });
  const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  const held = report("held", [
    { stage: "static", severity: "hold", rule: "packed-code", detail: "Code is packed.", path: "game.js" },
    { stage: "static", severity: "info", rule: "virustotal-unavailable", detail: "VirusTotal lookup failed (500).", path: "game.js" },
    { stage: "ai", severity: "hold", rule: "ai-budget", detail: "Budget used up." },
    { stage: "ai", severity: "hold", rule: "ai-likely_copyright", detail: "Mario sprites.", path: "art/hero.png", quote: "mario" },
  ]);
  const database = migratedFrom(
    "0035_",
    `
    INSERT INTO games (id, slug, title, review_status, live_version_id, created_at_ms, updated_at_ms) VALUES
      ('game_down', 'down', 'Down', 'removed', NULL, 1, 1),
      ('game_paused', 'paused', 'Paused', 'held', 'version_paused', 1, 1),
      ('game_hidden', 'hidden', 'Hidden', 'held', 'version_known', 1, 1),
      ('game_live', 'live', 'Live', 'live', 'version_held', 1, 1);
    INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms, scan_report, report_held_at_ms) VALUES
      ('version_held', 'game_live', 'm', 1, 10, 'held', 5, ${json(held)}, NULL),
      ('version_paused', 'game_paused', 'm', 1, 10, 'approved', 5, ${json(report("approved", []))}, 9),
      ('version_known', 'game_hidden', 'm', 1, 10, 'held', 5, ${json(report("held", []))}, NULL),
      ('version_by_person', 'game_live', 'm', 1, 10, 'rejected', 5, ${json(report("held", []))}, NULL),
      ('version_by_scan', 'game_live', 'm', 1, 10, 'rejected', 5, ${json(report("rejected", []))}, NULL),
      ('version_failed', 'game_live', 'm', 1, 10, 'held', 7, NULL, NULL);
    INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms) VALUES
      ('image_no', 'game_live', 'cover', 'image/png', 1920, 1080, 10, 'rejected', 1),
      ('image_yes', 'game_live', 'cover', 'image/png', 1920, 1080, 10, 'approved', 1);
    INSERT INTO audit_log (game_id, action, reason, actor, happened_at_ms) VALUES
      ('game_down', 'takedown', 'Steals passwords', 'julius@ivsan.com', 1),
      ('game_paused', 'auto-hold', 'Report: Child safety', 'system', 2),
      ('game_live', 'published', 'version_held', 'system', 3);
    `,
  );
  const read = (sql: string) => database.prepare(sql).all();
  const reasonOf = (code: string, message: string) => JSON.stringify({ code, message, content_rule: null });

  it("names scan findings by code, with their message", () => {
    const [stored] = read("SELECT scan_report FROM versions WHERE id = 'version_held'").map((row) => JSON.parse(row.scan_report as string));
    expect(stored.findings).toEqual([
      { stage: "static", severity: "hold", code: "packed_code", message: "Code is packed.", path: "game.js" },
      { stage: "static", severity: "info", code: "antivirus_unavailable", message: "VirusTotal lookup failed (500).", path: "game.js" },
      { stage: "ai", severity: "hold", code: "ai_review_budget_used", message: "Budget used up." },
      { stage: "ai", severity: "hold", code: "ai_likely_copyright", message: "Mario sprites.", path: "art/hero.png", quote: "mario" },
    ]);
  });

  it("gives a scan that never finished a report that says so", () => {
    const [stored] = read("SELECT scan_report FROM versions WHERE id = 'version_failed'").map((row) => JSON.parse(row.scan_report as string));
    expect(stored).toEqual({ ...report("held", [{ stage: "static", severity: "hold", code: "scan_failed", message: "The scan didn't finish." }]), finished_at_ms: 7 });
  });

  it("says why games are held or removed, and why a person rejected a version or an image", () => {
    expect(read("SELECT id, review_reason FROM games ORDER BY id")).toEqual([
      { id: "game_down", review_reason: reasonOf("taken_down", "A person at Zaisma took the game down.") },
      { id: "game_hidden", review_reason: reasonOf("needs_review", "A person at Zaisma needs to look at it first.") },
      { id: "game_live", review_reason: null },
      { id: "game_paused", review_reason: reasonOf("report_paused_game", "A player report paused the game while Zaisma checks it.") },
    ]);
    expect(read("SELECT id, review_reason FROM versions WHERE review_reason IS NOT NULL")).toEqual([{ id: "version_by_person", review_reason: reasonOf("rejected_by_zaisma", "A person at Zaisma rejected the version.") }]);
    expect(read("SELECT id, review_reason FROM game_images ORDER BY id")).toEqual([
      { id: "image_no", review_reason: reasonOf("image_rejected", "A person at Zaisma didn't approve the image.") },
      { id: "image_yes", review_reason: null },
    ]);
  });

  it("puts the same reasons in the history, never Zaisma's own notes", () => {
    expect(read("SELECT action, reason, review_reason FROM audit_log ORDER BY happened_at_ms")).toEqual([
      { action: "takedown", reason: "Steals passwords", review_reason: reasonOf("taken_down", "A person at Zaisma took the game down.") },
      { action: "auto-hold", reason: "Report: Child safety", review_reason: reasonOf("report_paused_game", "A player report paused the game while Zaisma checks it.") },
      { action: "published", reason: "version_held", review_reason: null },
    ]);
  });
});

describe("migration 0047", () => {
  const database = migratedFrom(
    "0047",
    `INSERT INTO accounts (id, player_id, name, age_band, social_mode, created_at_ms, updated_at_ms) VALUES
      ('first', 'player_firstaaaaaaaaaaaaa', 'Night Owl', '18+', 'friends_focused', 1, 1),
      ('second', 'player_secondbbbbbbbbbbbb', 'night-owl', '18+', 'friends_focused', 2, 2),
      ('third', 'player_thirdcccccccccccccc', ' Quiet Comet ', '13-15', 'solo_focused', 3, 3),
      ('fourth', 'player_fourthdddddddddddd', 'Ñandú', '16-17', 'solo_focused', 4, 4);`,
  );
  const read = (sql: string) => database.prepare(sql).all();

  it("turns names into usernames: underscores for spaces and dashes, and the same one twice made unique", () => {
    expect(read("SELECT id, username, password_changed_at_ms FROM accounts ORDER BY created_at_ms")).toEqual([
      { id: "first", username: "Night_Owl", password_changed_at_ms: null },
      { id: "second", username: "night_owl_bbbbbb", password_changed_at_ms: null },
      { id: "third", username: "Quiet_Comet", password_changed_at_ms: null },
      // Kept, so the account page asks for a new one.
      { id: "fourth", username: "Ñandú", password_changed_at_ms: null },
    ]);
  });

  it("keeps usernames unique ignoring case", () => {
    expect(() => database.exec("INSERT INTO accounts (id, player_id, username, age_band, created_at_ms, updated_at_ms) VALUES ('fifth', 'player_fiftheeeeeeeeeeeee', 'NIGHT_OWL', '18+', 5, 5)")).toThrow(/UNIQUE/);
  });
});
