/**
 * Every value Zaisma stores that someone outside Zaisma's code chose: what developers and players save,
 * and what comes from outside (browsers, games, GitHub, AI notes on untrusted content, reports). Each has
 * a shape that's checked when it's saved and again where a page shows it, and the doors that save it and
 * the pages that show it, as the security map's door ids (docs/DECISIONS.md, "Stored values safe where
 * they show"). test/node/stored-values.test.ts fails on a text column that's on neither this list nor
 * CLOSED_TEXT_COLUMNS; test/site/stored-values.test.ts sends values outside each shape through each door
 * that saves it, plants hostile values straight in the database, renders the pages and checks that what
 * each entry says it shows on is exactly where it shows.
 */

/**
 * How a stored value is shaped, and so how a page may show it:
 * - shown_text: one line others see, checked by checkShownText (no invisible or direction characters), shown escaped.
 * - shown_text_block: the same, with line breaks.
 * - forum_markdown: a shown_text_block a page shows through renderMarkdown, which escapes everything and checks every link.
 * - pattern_name: a fixed pattern of letters, digits and a few marks (a slug, a username, a link name, a host name).
 * - hex_color: "#rrggbb", which a page puts in CSS only through shownColor.
 * - web_address: an http: or https: address, which a page links only through shownAddress.
 * - escaped_text: anything, from a door that can't refuse it (outside) or seen only by the account that saved it; only ever shown escaped.
 */
export type StoredValueFormat = "shown_text" | "shown_text_block" | "forum_markdown" | "pattern_name" | "hex_color" | "web_address" | "escaped_text";

/** Who chose it: a developer, a player, the outside world (a browser, a game, GitHub, an AI's note on untrusted content) or Zaisma's own people (admin). */
export type StoredValueSource = "developer" | "player" | "outside" | "zaisma";

export interface StoredValue {
  /** table.column, table.column.field for a field of a JSON object, table.column[] for each item of a list, table.column[].field for a field of each. */
  stored: string;
  format: StoredValueFormat;
  source: StoredValueSource;
  /** The function that checks it on the way in; null when nothing can (outside, zaisma). */
  checked_by: { source_path: string; symbol_name: string } | null;
  /** The security map's doors that save it. Each is sent a value outside its shape by test/site/stored-values.test.ts. */
  saved_by_door_ids: string[];
  /** The security map's page doors that show it, as test/site/stored-values.test.ts finds them. */
  shown_on_door_ids: string[];
}

// The doors, as the security map names them (scripts/security-map/doors.mjs).
const DASHBOARD = "page:/dashboard/([a-z0-9-]+)(/.*)?";
const GAME_PAGE = "page:/g/([a-z0-9-]+)(/report|/rooms|/qr-code\\.svg|/live-version)?";
const HOME = "page:GET /";
const PROFILE = "page:/@([A-Za-z0-9_]{1,40})(/edit|/report)?";
const FORUM_NEW = "page:GET /forum/new";
const FORUM_TOPIC = "page:/forum/(topic_[a-z0-9]{1,40})(?:/(reply|vote|follow|answer|misplaced|still-happening|rate|bookmark|report))?";
const FORUM_NEW_MESSAGE = "page:/forum/messages/new";
const ACCOUNT = "page:GET /account";
const ADMIN_GAME = "page:/admin/games/([a-z0-9_]+)";
const ADMIN_REPORTS = "page:/admin/reports";

const checkedIn = (sourcePath: string, symbolName: string) => ({ source_path: sourcePath, symbol_name: symbolName });
const DETAILS = checkedIn("packages/core/src/developers.ts", "checkDetails");

export const STORED_VALUES: readonly StoredValue[] = [
  // A game, as its developer sets it.
  { stored: "games.slug", format: "pattern_name", source: "developer", checked_by: checkedIn("packages/core/src/slug.ts", "checkSlug"), saved_by_door_ids: ["api:POST /games", "page:POST /dashboard/new"], shown_on_door_ids: ["page:/admin", "page:/admin/audit", ACCOUNT, "page:GET /dashboard"] },
  { stored: "games.title", format: "shown_text", source: "developer", checked_by: DETAILS, saved_by_door_ids: ["api:POST /games", "api:PATCH /games/:slug", "page:POST /dashboard/new"], shown_on_door_ids: [PROFILE, "page:/admin", ADMIN_GAME, ADMIN_REPORTS, DASHBOARD, GAME_PAGE, HOME, ACCOUNT, "page:GET /dashboard"] },
  { stored: "games.description", format: "shown_text_block", source: "developer", checked_by: DETAILS, saved_by_door_ids: ["api:POST /games", "api:PATCH /games/:slug"], shown_on_door_ids: ["page:/admin", ADMIN_GAME, GAME_PAGE] },
  { stored: "games.details_waiting_for_review.title", format: "shown_text", source: "developer", checked_by: DETAILS, saved_by_door_ids: ["api:PATCH /games/:slug"], shown_on_door_ids: ["page:/admin", DASHBOARD] },
  { stored: "games.details_waiting_for_review.description", format: "shown_text_block", source: "developer", checked_by: DETAILS, saved_by_door_ids: ["api:PATCH /games/:slug"], shown_on_door_ids: ["page:/admin", DASHBOARD] },
  { stored: "games.cleared_title", format: "shown_text", source: "developer", checked_by: DETAILS, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "games.glass_tint_color", format: "hex_color", source: "developer", checked_by: DETAILS, saved_by_door_ids: ["api:POST /games", "api:PATCH /games/:slug", DASHBOARD], shown_on_door_ids: [DASHBOARD, HOME] },
  { stored: "games.links[].link_name", format: "pattern_name", source: "developer", checked_by: checkedIn("packages/core/src/links.ts", "checkLinks"), saved_by_door_ids: ["api:POST /games", "api:PATCH /games/:slug", DASHBOARD], shown_on_door_ids: [DASHBOARD] },
  { stored: "games.links[].destination_url", format: "web_address", source: "developer", checked_by: checkedIn("packages/core/src/links.ts", "checkLinks"), saved_by_door_ids: ["api:POST /games", "api:PATCH /games/:slug", DASHBOARD], shown_on_door_ids: [DASHBOARD] },
  { stored: "games.own_server_urls[]", format: "web_address", source: "developer", checked_by: checkedIn("packages/core/src/own-servers.ts", "checkOwnServerUrls"), saved_by_door_ids: ["api:POST /games", "api:PATCH /games/:slug", DASHBOARD], shown_on_door_ids: [ADMIN_GAME, DASHBOARD, GAME_PAGE] },
  { stored: "games.game_server_allowed_hosts[]", format: "pattern_name", source: "developer", checked_by: checkedIn("packages/core/src/reach.ts", "checkAllowedHosts"), saved_by_door_ids: ["api:POST /games", "api:PATCH /games/:slug"], shown_on_door_ids: [] },
  { stored: "games.review_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ADMIN_GAME] },
  { stored: "games.title_listing_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ADMIN_GAME] },
  { stored: "versions.patch_notes", format: "shown_text_block", source: "developer", checked_by: checkedIn("apps/site/src/developer.ts", "shownTextOrThrow"), saved_by_door_ids: ["api:POST /games/:slug/versions"], shown_on_door_ids: [DASHBOARD, GAME_PAGE] },
  { stored: "versions.scan_report", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ADMIN_GAME] },
  { stored: "versions.review_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ADMIN_GAME] },
  { stored: "performance_checks.report", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "performance_checks.start_files", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "game_images.review_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "game_images.listing_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "game_shaders.review_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "tester_links.name", format: "shown_text", source: "developer", checked_by: checkedIn("apps/site/src/developer.ts", "readTesterName"), saved_by_door_ids: ["api:POST /games/:slug/testers", "api:PATCH /games/:slug/testers/:tester_id"], shown_on_door_ids: [DASHBOARD] },
  { stored: "sign_in_apps.name", format: "shown_text", source: "developer", checked_by: checkedIn("packages/core/src/sign-in-apps.ts", "checkSignInAppName"), saved_by_door_ids: ["api:POST /sign-in-apps", "api:PATCH /sign-in-apps/:sign_in_app_id"], shown_on_door_ids: ["page:/oauth/authorize"] },
  { stored: "sign_in_apps.redirect_urls[]", format: "web_address", source: "developer", checked_by: checkedIn("packages/core/src/sign-in-apps.ts", "checkRedirectUrl"), saved_by_door_ids: ["api:POST /sign-in-apps", "api:PATCH /sign-in-apps/:sign_in_app_id"], shown_on_door_ids: [] },
  { stored: "webhooks.endpoint_url", format: "web_address", source: "developer", checked_by: checkedIn("packages/core/src/webhooks.ts", "checkEndpointUrl"), saved_by_door_ids: ["api:POST /webhooks", "api:PATCH /webhooks/:webhook_id"], shown_on_door_ids: [] },
  { stored: "webhook_deliveries.failure_message", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "game_server_errors.message", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [DASHBOARD] },
  { stored: "game_server_schedules.schedule_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [DASHBOARD] },
  { stored: "game_server_schedules.cron", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [DASHBOARD] },
  { stored: "room_message_types.message_type", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "live_rooms.name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "kept_rooms.name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "live_rooms.labels", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "room_players.server_url", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "game_deletions.failure_message", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ADMIN_GAME] },
  { stored: "player_erases.failure_message", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "audit_log.actor", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/audit", ADMIN_GAME] },
  { stored: "audit_log.reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/audit", ADMIN_GAME] },
  { stored: "audit_log.review_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },

  // A player's account and profile.
  { stored: "accounts.username", format: "pattern_name", source: "player", checked_by: checkedIn("packages/core/src/accounts.ts", "checkUsername"), saved_by_door_ids: ["page:POST /join/username", "page:POST /account/username"], shown_on_door_ids: [] },
  { stored: "accounts.display_name", format: "shown_text", source: "player", checked_by: checkedIn("packages/core/src/profiles.ts", "readProfileText"), saved_by_door_ids: [PROFILE], shown_on_door_ids: [PROFILE, "page:/admin/profiles"] },
  { stored: "accounts.bio", format: "shown_text_block", source: "player", checked_by: checkedIn("packages/core/src/profiles.ts", "readProfileText"), saved_by_door_ids: [PROFILE], shown_on_door_ids: [PROFILE, "page:/admin/profiles"] },
  { stored: "accounts.link_urls[]", format: "web_address", source: "player", checked_by: checkedIn("packages/core/src/profiles.ts", "readProfileText"), saved_by_door_ids: [PROFILE], shown_on_door_ids: [PROFILE, "page:/admin/profiles"] },
  { stored: "accounts.profile_held_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "accounts.social_stopped_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "passkeys.name", format: "escaped_text", source: "player", checked_by: null, saved_by_door_ids: ["page:POST /api/passkeys/add"], shown_on_door_ids: [ACCOUNT] },
  { stored: "api_keys.name", format: "escaped_text", source: "developer", checked_by: null, saved_by_door_ids: ["page:POST /account/keys"], shown_on_door_ids: [ACCOUNT] },
  { stored: "api_keys.found_at_url", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "api_keys.last_used_device", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ACCOUNT] },
  { stored: "api_keys.last_used_network_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ACCOUNT] },
  { stored: "api_keys.last_used_city_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ACCOUNT] },
  { stored: "api_keys.last_used_region_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "api_keys.connected_app_host", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "security_events.subject_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [DASHBOARD] },
  { stored: "security_events.api_key_name", format: "escaped_text", source: "developer", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [DASHBOARD] },
  { stored: "security_events.device", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [DASHBOARD] },
  { stored: "security_events.network_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [DASHBOARD] },
  { stored: "security_events.city_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [DASHBOARD] },
  { stored: "security_events.region_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "security_events.connection_address", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "security_spikes.network_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "mcp_clients.client_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/oauth/authorize"] },
  { stored: "mcp_clients.redirect_urls", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "connected_app_codes.connected_app_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "connected_app_codes.redirect_url", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "connected_app_codes.code_challenge", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "connected_app_codes.resource_url", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "sign_in_codes.redirect_url", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "sign_in_codes.code_challenge", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "sign_in_codes.nonce", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "sign_in_codes.scope", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "blocked_scripts.violated_directive", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "blocked_scripts.blocked_source", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "blocked_scripts.page_path", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },

  // The forum.
  { stored: "forum_topics.title", format: "shown_text", source: "developer", checked_by: checkedIn("apps/site/src/forum-posts.ts", "readTitle"), saved_by_door_ids: ["api:POST /forum", FORUM_NEW, FORUM_NEW_MESSAGE], shown_on_door_ids: ["page:/admin/feedback"] },
  { stored: "forum_posts.text_markdown", format: "forum_markdown", source: "developer", checked_by: checkedIn("apps/site/src/forum-posts.ts", "readPost"), saved_by_door_ids: ["api:POST /forum", "api:POST /forum/:topic_id/posts", FORUM_NEW, FORUM_TOPIC, FORUM_NEW_MESSAGE], shown_on_door_ids: ["page:/admin/feedback", FORUM_TOPIC] },
  { stored: "forum_posts.debug_context", format: "escaped_text", source: "developer", checked_by: null, saved_by_door_ids: ["api:POST /forum", "api:POST /forum/:topic_id/posts"], shown_on_door_ids: [] },
  { stored: "forum_posts.held_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "forum_topics.known_issue_title", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin", "page:/admin/feedback", FORUM_TOPIC, "page:/forum/messages"] },
  { stored: "forum_topics.workaround", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/feedback", FORUM_TOPIC] },
  { stored: "forum_topics.roadmap_item", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/feedback", FORUM_TOPIC] },
  { stored: "forum_topics.triage", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin", "page:/admin/feedback"] },
  { stored: "forum_reports.details", format: "escaped_text", source: "player", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/feedback"] },
  { stored: "profile_reports.details", format: "escaped_text", source: "player", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/profiles"] },

  // Reports and reviews, read by Zaisma's people.
  { stored: "reports.player_text", format: "escaped_text", source: "player", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ADMIN_GAME, ADMIN_REPORTS] },
  { stored: "reports.player_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [ADMIN_GAME, ADMIN_REPORTS] },
  { stored: "reports.room_name", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "reports.triage", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin", ADMIN_GAME, ADMIN_REPORTS] },
  { stored: "chat_reviews.text", format: "escaped_text", source: "player", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "chat_reviews.recent_texts_json", format: "escaped_text", source: "player", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "chat_reviews.ai_reason", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  // Zaisma's news for players, posted through the admin MCP (post_announcement).
  { stored: "announcements.text", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [HOME] },
  { stored: "announcements.link_url", format: "web_address", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [HOME] },
  // Its label shows on the home only beside a link in shape, which the hostile pass never plants with it, so no page is listed (it's escaped there).
  { stored: "announcements.link_label", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "announcements.created_by", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "precedents.title", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/precedents"] },
  { stored: "precedents.applies_when", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/precedents"] },
  { stored: "precedents.decision", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "precedents.why", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/precedents"] },
  { stored: "review_precedents.title", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/review-precedents"] },
  { stored: "review_precedents.applies_when", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/review-precedents"] },
  { stored: "review_precedents.why", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
  { stored: "review_precedents.case_title", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/review-precedents"] },
  { stored: "review_precedents.case_description", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/review-precedents"] },
  { stored: "review_precedents.case_index_html", format: "escaped_text", source: "zaisma", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: ["page:/admin/review-precedents"] },
  { stored: "review_precedents.test_result", format: "escaped_text", source: "outside", checked_by: null, saved_by_door_ids: [], shown_on_door_ids: [] },
];

/**
 * Text columns that can only hold what Zaisma's code makes or a closed choice, so they need no entry: IDs,
 * hashes, keys, tokens and codes, statuses, kinds, levels, modes and other choices, dates. A column is one
 * when its name says so (CLOSED_COLUMN_NAME) or it's listed here.
 */
export const CLOSED_COLUMN_NAME = /^(id|kind|date|day|month|token|code|sha256)$|_(id|ids|sha256|hash|key|token|code|status|kind|level|mode|band|choice|via|access|date)$|^who_/;

export const CLOSED_TEXT_COLUMNS: readonly string[] = [
  // Choices from fixed lists.
  "accounts.color_theme", "accounts.chat_stopped_reason", "api_keys.found_in", "mcp_clients.token_endpoint_auth_method", "audit_log.action", "chat_reviews.source", "checked_files.provider", "forum_post_ratings.rating", "forum_reports.reason", "forum_topic_tags.tag",
  "forum_topics.category", "forum_topics.severity", "game_backgrounds.screen", "game_backgrounds.source", "game_shaders.screen", "games.visibility", "games.devices", "games.controls",
  "games.screen_orientation", "games.play_modes", "games.room_browsing", "games.built_in_server", "games.account_requirement", "profile_reports.reason", "reports.reason", "reports.player_reason",
  "review_precedents.decision", "review_precedents.content_rule", "room_message_types.direction", "save_history.copy_reason", "security_events.done_by", "webhooks.event_kinds",
  // What Zaisma's code makes or copies from a checked value: slugs and usernames, content types it sniffed, colors it measured, places Cloudflare names, its own keys and records.
  "api_keys.game_slugs", "connected_app_codes.game_slugs", "webhooks.game_slugs", "retired_game_slugs.slug", "forum_mentions.name", "forum_media.content_type", "game_images.content_type",
  "game_images.average_color", "game_shaders.average_color", "live_rooms.country", "live_rooms.continent", "precedents.created_by", "review_precedents.created_by", "database_restores.undo_bookmark",
  "domains.hostname", "file_moves.bucket_name", "versions.r2_prefix", "webhook_deliveries.event_json", "webhooks.signing_secret",
];
