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

describe("migration 0055", () => {
  const database = migratedFrom(
    "0055_",
    `INSERT INTO webhooks (id, owner_id, endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms) VALUES ('webhook_one', 'owner_one', 'https://hooks.skyhopper.io/zaisma', '["bug_reported"]', NULL, 'whsec_abc', 1, 2);`,
  );

  it("keeps every webhook, sending to its address", () => {
    expect(database.prepare("SELECT * FROM webhooks").all()).toEqual([
      { id: "webhook_one", owner_id: "owner_one", destination_kind: "endpoint_url", endpoint_url: "https://hooks.skyhopper.io/zaisma", event_kinds: '["bug_reported"]', game_slugs: null, signing_secret: "whsec_abc", created_at_ms: 1, updated_at_ms: 2 },
    ]);
  });

  it("takes a game server's webhook without an address, and nothing in between", () => {
    database.exec(`INSERT INTO webhooks (id, owner_id, destination_kind, endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms) VALUES ('webhook_two', 'owner_one', 'game_server', NULL, '["bug_reported"]', '["sky-hopper"]', 'whsec_def', 3, 3)`);
    expect(() => database.exec(`INSERT INTO webhooks (id, owner_id, destination_kind, endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms) VALUES ('webhook_three', 'owner_one', 'game_server', 'https://x.example', '[]', NULL, 'whsec_x', 3, 3)`)).toThrow();
    expect(() => database.exec(`INSERT INTO webhooks (id, owner_id, destination_kind, endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms) VALUES ('webhook_four', 'owner_one', 'endpoint_url', NULL, '[]', NULL, 'whsec_x', 3, 3)`)).toThrow();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'webhooks' AND name = 'webhooks_owner'").all()).toHaveLength(1);
  });
});

describe("migration 0061", () => {
  const database = migratedFrom(
    "0061_",
    `INSERT INTO accounts (id, player_id, username, age_band, created_at_ms, updated_at_ms) VALUES ('account_keyed', 'player_keyed', 'Keyed', '18+', 1, 1), ('account_plain', 'player_plain', 'Plain', '18+', 1, 1);
     INSERT INTO passkeys (id, account_id, public_key, algorithm_number, sign_count, name, created_at_ms) VALUES ('passkey_one', 'account_keyed', 'key', -7, 0, 'Mac', 1);`,
  );

  it("marks an account that has a passkey, approves its passkeys at once and ends no sessions", () => {
    expect(database.prepare("SELECT id, has_had_passkey, sessions_ended_at_ms FROM accounts ORDER BY id").all()).toEqual([
      { id: "account_keyed", has_had_passkey: 1, sessions_ended_at_ms: null },
      { id: "account_plain", has_had_passkey: 0, sessions_ended_at_ms: null },
    ]);
    expect(database.prepare("SELECT id, approves_from_at_ms FROM passkeys").all()).toEqual([{ id: "passkey_one", approves_from_at_ms: 0 }]);
  });

  it("keeps how a session proved it's them, by one of five ways", () => {
    database.exec("INSERT INTO session_proofs (session_id, account_id, proof_kind, passkey_id, proved_at_ms) VALUES ('session_one', 'account_keyed', 'passkey', 'passkey_one', 5)");
    expect(() => database.exec("INSERT INTO session_proofs (session_id, account_id, proof_kind, proved_at_ms) VALUES ('session_two', 'account_keyed', 'carrier_pigeon', 5)")).toThrow();
  });
});

describe("migration 0071", () => {
  const database = migratedFrom(
    "0071_",
    `INSERT INTO games (id, slug, title, review_status, connect_hosts, created_at_ms, updated_at_ms) VALUES
       ('game_none', 'none', 'None', 'live', '', 1, 1), ('game_one', 'one', 'One', 'live', 'wss://a.example', 1, 1), ('game_two', 'two', 'Two', 'live', 'wss://a.example' || char(10) || 'https://b.example:8443', 1, 1);`,
  );

  it("turns each game's own servers into a JSON list under the API's name", () => {
    expect(database.prepare("SELECT id, own_server_urls FROM games ORDER BY id").all().map((row) => ({ ...row, own_server_urls: JSON.parse(String(row.own_server_urls)) }))).toEqual([
      { id: "game_none", own_server_urls: [] },
      { id: "game_one", own_server_urls: ["wss://a.example"] },
      { id: "game_two", own_server_urls: ["wss://a.example", "https://b.example:8443"] },
    ]);
  });
});

describe("migration 0073", () => {
  const database = migratedFrom(
    "0073_",
    `INSERT INTO accounts (id, player_id, username, age_band, created_at_ms, updated_at_ms) VALUES ('account_maker', 'player_maker', 'Maker', '18+', 1, 1), ('account_player', 'player_player', 'Player', '18+', 1, 1);
     INSERT INTO owners (id, kind, account_id, created_at_ms) VALUES ('owner_maker', 'person', 'account_maker', 1), ('owner_player', 'person', 'account_player', 1);
     INSERT INTO games (id, slug, title, owner_id, review_status, created_at_ms, updated_at_ms) VALUES ('game_one', 'sky-hopper', 'Sky Hopper', 'owner_maker', 'live', 1, 1);`,
  );

  it("lets accounts that already own a game keep publishing, and no one else", () => {
    expect(database.prepare("SELECT id, can_publish FROM accounts ORDER BY id").all()).toEqual([
      { id: "account_maker", can_publish: 1 },
      { id: "account_player", can_publish: 0 },
    ]);
  });
});

describe("migration 0079", () => {
  const database = migratedFrom(
    "0079_",
    `INSERT INTO accounts (id, player_id, username, age_band, created_at_ms, updated_at_ms) VALUES ('account_mia', 'player_mia', 'Mia', '18+', 1, 1);
     INSERT INTO games (id, slug, title, review_status, created_at_ms, updated_at_ms) VALUES ('game_played', 'played', 'Played', 'live', 1, 1), ('game_saved', 'saved', 'Saved', 'live', 1, 1), ('game_both', 'both', 'Both', 'live', 1, 1);
     INSERT INTO played (account_id, game_id, played_at_ms) VALUES ('account_mia', 'game_played', 10), ('account_mia', 'game_both', 20);
     INSERT INTO saves (account_id, game_id, version_number, sha256, size_bytes, updated_at_ms) VALUES ('account_mia', 'game_saved', 1, 'x', 2, 30), ('account_mia', 'game_both', 1, 'x', 2, 40);`,
  );

  it("remembers every game an account played or saved in, once, and erases deleted players by default", () => {
    expect(database.prepare("SELECT account_id, game_id, first_played_at_ms FROM games_ever_played ORDER BY game_id").all()).toEqual([
      { account_id: "account_mia", game_id: "game_both", first_played_at_ms: 20 },
      { account_id: "account_mia", game_id: "game_played", first_played_at_ms: 10 },
      { account_id: "account_mia", game_id: "game_saved", first_played_at_ms: 30 },
    ]);
    expect(database.prepare("SELECT DISTINCT deleted_account_erase_enabled FROM games").all()).toEqual([{ deleted_account_erase_enabled: 1 }]);
  });
});

describe("migration 0080", () => {
  const database = migratedFrom(
    "0080_",
    `INSERT INTO game_server_errors (game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms) VALUES ('game_one', 'version_one', 'crash', 'onJoin: boom', 3, 1000, 5000);`,
  );

  it("counts errors from before as already told, so webhooks never hear old news", () => {
    expect(database.prepare("SELECT last_at_ms, told_webhooks_at_ms FROM game_server_errors").all()).toEqual([{ last_at_ms: 5000, told_webhooks_at_ms: 5000 }]);
  });
});

describe("migration 0084", () => {
  const database = migratedFrom(
    "0084_",
    `INSERT INTO games (id, slug, title, review_status, created_at_ms, updated_at_ms) VALUES ('game_one', 'one', 'One', 'live', 1, 1);
     INSERT INTO reports (id, game_id, reason, player_text, reported_at_ms, player_id, player_name, player_reason) VALUES ('report_one', 'game_one', 'player', 'says he will find me', 1000, 'player_one', 'Kit', 'threats_or_private_details'), ('report_two', 'game_one', 'player', 'speed hacks', 2000, 'player_one', 'Kit', 'cheating');`,
  );

  it("files reports under the old threats reason as real-life threats, and nothing as passed to the developer", () => {
    expect(database.prepare("SELECT id, player_reason, is_passed_to_developer, has_block_between FROM reports ORDER BY id").all()).toEqual([
      { id: "report_one", player_reason: "real_life_threat", is_passed_to_developer: 0, has_block_between: 0 },
      { id: "report_two", player_reason: "cheating", is_passed_to_developer: 0, has_block_between: 0 },
    ]);
  });
});

describe("migration 0110", () => {
  const database = migratedFrom(
    "0110_",
    `INSERT INTO games (id, slug, title, review_status, created_at_ms, updated_at_ms) VALUES ('game_one', 'one', 'One', 'live', 1, 1);
     INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms, review_reason, listing_reason, cleared_at_ms)
       VALUES ('image_cover', 'game_one', 'cover', 'image/png', 1280, 720, 100, 'approved', 5, NULL, '{"code":"extra_text_on_cover","message":"Words.","content_rule":null}', NULL),
              ('image_shot', 'game_one', 'screenshot', 'image/webp', 1280, 720, 200, 'approved', 6, NULL, NULL, 9);`,
  );

  it("keeps every cover and screenshot through the rebuild, with its listing reason and when it was cleared", () => {
    expect(database.prepare("SELECT id, kind, review_status, listing_reason, cleared_at_ms FROM game_images ORDER BY id").all()).toEqual([
      { id: "image_cover", kind: "cover", review_status: "approved", listing_reason: '{"code":"extra_text_on_cover","message":"Words.","content_rule":null}', cleared_at_ms: null },
      { id: "image_shot", kind: "screenshot", review_status: "approved", listing_reason: null, cleared_at_ms: 9 },
    ]);
  });

  it("takes the background kinds, shaders and backgrounds, and a glass tint", () => {
    database.exec("INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, created_at_ms) VALUES ('image_world', 'game_one', 'phone_background', 'image/png', 1440, 3120, 300, 7)");
    database.exec("INSERT INTO game_shaders (id, game_id, screen, size_bytes, created_at_ms) VALUES ('shader_one', 'game_one', 'wide', 120, 8)");
    database.exec("INSERT INTO game_backgrounds (game_id, screen, source, shader_id, updated_at_ms) VALUES ('game_one', 'wide', 'shader', 'shader_one', 8)");
    expect(() => database.exec("INSERT INTO game_backgrounds (game_id, screen, source, updated_at_ms) VALUES ('game_one', 'wide', 'video', 8)")).toThrow();
    expect(database.prepare("SELECT review_status FROM game_shaders").get()).toEqual({ review_status: "pending" });
    expect(database.prepare("SELECT glass_tint_color FROM games").get()).toEqual({ glass_tint_color: null });
  });
});

describe("migration 0123", () => {
  const database = migratedFrom(
    "0123_",
    `INSERT INTO games (id, slug, title, description, review_status, created_at_ms, updated_at_ms, glass_tint_color) VALUES
       ('game_one', 'one', 'Sky' || char(8238) || 'Hopper', 'A' || char(8203) || 'B', 'live', 1, 1, 'red;}'),
       ('game_two', 'two', 'Café 東方 👨\u200d👩\u200d👧', 'Plain words', 'live', 1, 1, '#6B3FA0');
     INSERT INTO accounts (id, username, player_id, age_band, created_at_ms, updated_at_ms, display_name, bio) VALUES ('account_one', 'Ana', 'player_one', '18+', 1, 1, 'Za' || char(173) || 'isma', 'Hi' || char(8294) || ' there');`,
  );

  it("puts glass tints back into #rrggbb or none", () => {
    expect(database.prepare("SELECT slug, glass_tint_color FROM games ORDER BY slug").all()).toEqual([
      { slug: "one", glass_tint_color: null },
      { slug: "two", glass_tint_color: "#6b3fa0" },
    ]);
  });

  it("takes invisible and direction characters out of shown text, and leaves every language and emoji", () => {
    expect(database.prepare("SELECT title, description FROM games ORDER BY slug").all()).toEqual([
      { title: "SkyHopper", description: "AB" },
      { title: "Café 東方 👨\u200d👩\u200d👧", description: "Plain words" },
    ]);
    expect(database.prepare("SELECT display_name, bio FROM accounts").get()).toEqual({ display_name: "Zaisma", bio: "Hi there" });
  });
});

describe("migration 0134", () => {
  const database = migratedFrom(
    "0134_",
    `INSERT INTO games (id, slug, title, review_status, created_at_ms, updated_at_ms) VALUES ('game_one', 'one', 'One', 'live', 1, 1);
     INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms, listing_reason, cleared_at_ms, average_color, is_glass_smoked, glass_tint_pct)
       VALUES ('image_world', 'game_one', 'background', 'image/webp', 2560, 1440, 300, 'approved', 5, NULL, 9, '#0E0A28', 1, 62);
     INSERT INTO game_shaders (id, game_id, screen, size_bytes, review_status, check_frame_ms, flash_count, checked_at_ms, created_at_ms) VALUES ('shader_checked', 'game_one', 'wide', 120, 'approved', 42.5, 0, 7, 6), ('shader_waiting', 'game_one', 'phone', 90, 'pending', NULL, NULL, NULL, 8);`,
  );

  it("keeps each shader's measured frame as level 0's quality check, and none for one not yet checked", () => {
    expect(database.prepare("SELECT id, quality_checks, buffer_count, texture_count FROM game_shaders ORDER BY id").all().map((row) => ({ ...row, quality_checks: row.quality_checks === null ? null : JSON.parse(row.quality_checks as string) }))).toEqual([
      { id: "shader_checked", quality_checks: [{ quality_level: 0, check_frame_ms: 42.5, maximum_check_frame_ms: 75 }], buffer_count: 0, texture_count: 0 },
      { id: "shader_waiting", quality_checks: null, buffer_count: 0, texture_count: 0 },
    ]);
  });

  it("keeps every picture through the rebuild, with its tone, and takes shader textures", () => {
    expect(database.prepare("SELECT id, kind, cleared_at_ms, average_color, is_glass_smoked, glass_tint_pct FROM game_images").all()).toEqual([{ id: "image_world", kind: "background", cleared_at_ms: 9, average_color: "#0E0A28", is_glass_smoked: 1, glass_tint_pct: 62 }]);
    database.exec("INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, created_at_ms) VALUES ('image_noise', 'game_one', 'shader_texture', 'image/png', 256, 256, 40, 9)");
    expect(() => database.exec("INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, created_at_ms) VALUES ('image_video', 'game_one', 'video', 'video/mp4', 256, 256, 40, 9)")).toThrow();
  });
});

describe("migration 0135", () => {
  const purchase = (id: string, createdAtMs: number, status = "completed", itemName = "supporter_cape") =>
    `('${id}', 'game_one', '${itemName}', 'permanent', 'player_one', 'grant', '${status}', ${createdAtMs}, ${createdAtMs})`;
  const database = migratedFrom(
    "0135_",
    `INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES
       ${purchase("purchase_later", 2)}, ${purchase("purchase_first", 1)}, ${purchase("purchase_refunded", 0, "refunded")}, ${purchase("purchase_other", 3, "completed", "gold_crown")};`,
  );

  it("keeps the earliest of a player's completed purchases of a permanent item and marks the rest failed, deleting none", () => {
    expect(database.prepare("SELECT id, purchase_status FROM purchases ORDER BY id").all()).toEqual([
      { id: "purchase_first", purchase_status: "completed" },
      { id: "purchase_later", purchase_status: "failed" },
      { id: "purchase_other", purchase_status: "completed" },
      { id: "purchase_refunded", purchase_status: "refunded" },
    ]);
  });

  it("refuses a second completed purchase of a permanent item a player owns, and takes one once it's refunded", () => {
    expect(() => database.exec(`INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES ${purchase("purchase_again", 4)}`)).toThrow(/UNIQUE/);
    database.exec("UPDATE purchases SET purchase_status = 'refunded' WHERE id = 'purchase_first'");
    database.exec(`INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES ${purchase("purchase_again", 4)}`);
  });
});
