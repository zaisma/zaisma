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
      findings: scanReport.findings,
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
