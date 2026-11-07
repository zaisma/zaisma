import {
  AREA_ACCESS_CHOICES,
  SOCIAL_SETTINGS,
  ANSWERS_EMPTY,
  ANSWERS_FILE,
  ANSWERS_BYTES,
  ANSWERS_PAGE,
  LINK_LIMITS,
  OWN_SERVER_LIMITS,
  SAVE_LIMIT_BYTES,
  TAKES_NOTHING,
  answersJson,
  anyOf,
  doorPathPattern,
    gameData,
  integer,
  listOf,
  orNothing,
  realNumber,
  text,
  yesOrNo,
  type DoorAnswer,
  type DoorBody,
  type DoorCallerProvenByFunction,
  type DoorContract,
  type DoorLimit,
  type DoorReach,
  type DoorShape,
  type DoorTakes,
  type DoorTrust,
  FORUM_LIMITS,
  IMAGE_LIMITS,
  MAXIMUM_RAW_BODY_SIZE_BYTES,
  ZIP_LIMITS,
} from "@zaisma/core";

/**
 * Every door on zaisma.com that isn't one API call (docs/DOORS.md): one row per path, with who may call it, what it
 * may reach and what it trusts. The guard (guard.ts) checks a request against its row before any of the door's
 * code runs, and a path with no row is answered as nothing there, so a page without a contract can't be reached.
 * test/node/doors.test.ts fails on a path a handler names that has no row here, and test/site/door-guard.test.ts
 * calls every row from these same declarations. The API's calls have their own table, API_ROUTES, behind the
 * /api/dev row; the MCP's tools only make those calls.
 */

export type SiteDoorMethod = "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS";

/**
 * Where a door takes requests from, by their Origin: only Zaisma's own pages, the same unless the request names no
 * origin (what a browser's plain form on the same site can do), or anywhere.
 */
export type DoorOrigin = "own_pages" | "own_pages_if_sent" | "anywhere";

/** How a door says no to the wrong origin: a page's plain words, a JSON error, or nothing but the status. */
export type DoorAnswerKind = "page" | "json" | "empty";

/** What a door that needs a session answers without one: the same a person there has always seen. */
export type WhenSignedOut =
  /** To sign-in, then back: to this path, this path with its query, the next field or query the door was sent, or a fixed path. */
  | { kind: "sign_in"; next: "here" | "here_with_query" | "next_field" | `/${string}` | null }
  /** Back to the profile the path names. */
  | { kind: "profile" }
  /** A status, with a JSON body or none. */
  | { kind: "status"; httpStatus: number; jsonBody: unknown }
  /** A form goes to sign-in and back; a script's call gets the status. */
  | { kind: "form_or_status"; next: `/${string}`; httpStatus: number; jsonBody: unknown };

interface DoorRowFields {
  methods: readonly SiteDoorMethod[] | "any";
  path: string;
  origin: DoorOrigin;
  answersAs: DoorAnswerKind;
}

/** A door for a session can't be stated without what it answers when there's none, so it doesn't build. */
export type SiteDoor = DoorRowFields &
  (
    | { contract: DoorContract & { whoMayCall: Exclude<DoorContract["whoMayCall"], "signed_in" | "developer"> } }
    | { contract: DoorContract & { whoMayCall: "signed_in" }; whenSignedOut: WhenSignedOut; isClosedToBannedDeveloper?: true }
    | { contract: DoorContract & { whoMayCall: "developer" }; whenSignedOut: WhenSignedOut; whenNoAccount: `/${string}`; isOpenToBannedDeveloper?: true }
  );

/** The shapes of the parts of a path, by name; any other is one part of anything. Each is what the door's handler matches. */
export const PATH_PARTS: Readonly<Record<string, string>> = {
  slug: "[a-z0-9-]+",
  provider: "[a-z]+",
  save_copy_id: "[^/]{1,100}",
  item_name: "[a-z0-9][a-z0-9_-]{0,39}",
  sale_id: "[A-Za-z0-9_-]+",
  at_username: "@[A-Za-z0-9_]{1,40}",
  player_id: "player_[a-z0-9]{1,40}",
  invite_link_code: "[A-Za-z0-9-]{1,20}",
  invite_code: "[A-Z0-9]{8}",
  answer_verb: "accept|turn-down",
  topic_id: "topic_[a-z0-9]{1,40}",
  topic_action: "reply|vote|follow|answer|misplaced|still-happening|rate|bookmark|report|seen",
  media_id: "media_[a-z0-9]{1,40}",
  moved_topic_id: "(?:topic_)?[a-z0-9]{1,40}",
  key_id: "[a-z0-9]+",
  sign_in_app_id: "sign_in_app_[a-z0-9]+",
  sign_in_app_action: "delete|secret",
  webhook_id: "webhook_[a-z0-9]+",
  webhook_action: "delete|test|secret",
  top_up_id: "top_up_[a-z0-9]+",
  spending_request_id: "spending_request_[a-z0-9]+",
  game_deletion_request_id: "game_deletion_request_[a-z0-9]+",
  budget_action: "budget|budget-off",
  passkey_id: "[A-Za-z0-9_-]{1,400}",
  legal_page: "[a-z-]+",
  tester_token: "[a-z0-9]{20}",
  preview_token: "[A-Za-z0-9_.-]{1,140}",
  background_file: "[a-z0-9-]+\\.glsl",
  rules_file: "speculation-rules(?:\\.[0-9a-f]{16})?\\.json",
  screen: "wide|phone",
  id: "[a-z0-9_]+",
  tester_action: "remove|change",
  version_action: "publish|schedule|unschedule|ai-review|delete",
  shader_id: "shader_[a-z0-9]+",
  shader_picture: "still\\.png|frame-[0-9]\\.png",
  review_verb: "approve|reject",
  game_action: "takedown|restore|dismiss",
  report_group_action: "dismiss|bug|hide-name|pass-to-developer|stop-social|clear-profile",
  play_day: "\\d{4}-\\d{2}-\\d{2}",
  feedback_id: "[a-z0-9_]{1,40}",
  feedback_verb: "show|remove",
  publisher: "[A-Za-z0-9_-]{1,64}",
  profile_verb: "show|clear",
  chat_review_verb: "false-alarm|remove-chat|report-to-ncmec",
  account_id: "[A-Za-z0-9_-]{1,64}",
  precedent_id: "[a-z0-9_-]+",
  precedent_verb: "activate|change|retire",
  review_precedent_verb: "approve|retire|change|retry",
};

const signIn = (next: "here" | "here_with_query" | "next_field" | `/${string}` | null): WhenSignedOut => ({ kind: "sign_in", next });
const statusOf = (httpStatus: number, jsonBody: unknown = null): WhenSignedOut => ({ kind: "status", httpStatus, jsonBody });
const proof = (sourcePath: string, symbolName: string) => ({ source_path: sourcePath, symbol_name: symbolName });

/** Before Zaisma knows the player, an address counts, at the level a whole building clears. */
const BY_ADDRESS: DoorLimit = { level: "building", counts: "address" };
const READS_BY_ACCOUNT: DoorLimit = { level: "busy", counts: "account" };
const WRITES_BY_ACCOUNT: DoorLimit = { level: "steady", counts: "account" };
const FILE_NO_LIMIT: DoorLimit = { whyNoLimit: "cached_file" };
const FROM_MEMORY: DoorLimit = { whyNoLimit: "answers_from_memory" };
const SIGNED: DoorLimit = { whyNoLimit: "signed_by_sender" };

/** The most of a form's fields: a Worker reads no more than this, and a form with files no more than its files besides. */
const FORM_SIZE_BYTES = 256 * 1024;
/** A form's field, as the outer wall: its handler keeps what it allows inside this. */
const FORM_TEXT = text(FORM_SIZE_BYTES);
const namesOf = (names: readonly string[], shape: DoorShape = FORM_TEXT): Record<string, DoorShape> => Object.fromEntries(names.map((name) => [name, anyTextOrList(shape)]));
/** A form's checkboxes repeat a name, so any name may come more than once, up to this. */
const anyTextOrList = (shape: DoorShape): DoorShape => anyOf(shape, listOf(shape, 100));
const form = (names: readonly string[], files: { fileNames: readonly string[]; maximumFilesSizeBytes: number } | null = null): DoorTakes => ({
  query: {},
  body: { kind: "form", fields: namesOf(names), ...(files ? { fileNames: files.fileNames } : {}), maximumSizeBytes: FORM_SIZE_BYTES + (files?.maximumFilesSizeBytes ?? 0) },
});
const json = (fields: Readonly<Record<string, DoorShape>>, required: readonly string[] = [], maximumSizeBytes = 16 * 1024, isOptional = true): DoorTakes => ({
  query: {},
  body: { kind: "json", fields, required, maximumSizeBytes, ...(isOptional ? { isOptional: true as const } : {}) },
});
/** A page's query names: a page ignores names it doesn't read, since share links pick some up, and holds these to a size. */
const query = (...names: readonly string[]): DoorTakes => ({ query: Object.fromEntries(names.map((name) => [name, text(2000)])), body: null });
const withForm = (names: readonly string[], ...queryNames: readonly string[]): DoorTakes => ({ ...form(names), query: query(...queryNames).query });
/** What a JSON door answers: these fields, each as the door sends it, and no others. */
const fieldsAnswer = (...names: readonly string[]): DoorAnswer => answersJson({ type: "object", properties: Object.fromEntries(names.map((name) => [name, {}])), required: [], additionalProperties: false });
const ANY_LIST = answersJson({ type: "array" });

/** What a door takes, answers and how much it can be used. With none said, a door takes nothing and answers as its kind says. */
interface DoorOptions {
  reaches?: DoorReach;
  trusts?: readonly DoorTrust[];
  origin?: DoorOrigin;
  takes?: DoorTakes;
  limit?: DoorLimit;
}
/** A JSON door can't be stated without what it answers, so it doesn't build. */
type AnswerOptions = { answersAs?: "page" | "empty"; answers?: DoorAnswer } | { answersAs: "json"; answers: DoorAnswer };
const answersOf = (options: AnswerOptions): DoorAnswer => options.answers ?? (options.answersAs === "empty" ? ANSWERS_EMPTY : ANSWERS_PAGE);

// A door anyone may open: public, or showing a signed-in person their own too.
const open = (methods: DoorRowFields["methods"], path: string, options: DoorOptions & AnswerOptions = {}): SiteDoor => ({
  methods,
  path,
  origin: options.origin ?? "anywhere",
  answersAs: options.answersAs ?? "page",
  contract: { whoMayCall: "anyone", reaches: options.reaches ?? "nothing_private", trusts: options.trusts ?? [], takes: options.takes ?? TAKES_NOTHING, answers: answersOf(options), limit: options.limit ?? BY_ADDRESS },
});
// A door for a session, on the person's own things unless it says otherwise.
const signedIn = (methods: DoorRowFields["methods"], path: string, whenSignedOut: WhenSignedOut, options: DoorOptions & AnswerOptions & { isClosedToBannedDeveloper?: true } = {}): SiteDoor => ({
  methods,
  path,
  origin: options.origin ?? "own_pages_if_sent",
  answersAs: options.answersAs ?? "page",
  contract: {
    whoMayCall: "signed_in",
    reaches: options.reaches ?? "account",
    trusts: options.trusts ?? ["session"],
    takes: options.takes ?? TAKES_NOTHING,
    answers: answersOf(options),
    limit: options.limit ?? (Array.isArray(methods) && methods.every((method) => method === "GET") ? READS_BY_ACCOUNT : WRITES_BY_ACCOUNT),
  },
  whenSignedOut,
  ...(options.isClosedToBannedDeveloper ? { isClosedToBannedDeveloper: true as const } : {}),
});

const jsonAnswer = (...names: readonly string[]) => ({ answersAs: "json", answers: fieldsAnswer(...names) }) as const;
const ownPagesJson = (...names: readonly string[]) => ({ origin: "own_pages", answersAs: "json", answers: fieldsAnswer(...names) }) as const;

const BROWSE_QUERY = query("sort", "genre", "players", "price", "page", "search_text", "theme");
const OAUTH_QUERY = query("client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge", "code_challenge_method", "nonce", "resource", "prompt", "connect_step");
const USERINFO_ANSWER = fieldsAnswer("sub", "name", "preferred_username", "picture", "email", "email_verified", "profile", "error", "error_description");
/** What a page sends about a play: a start, a minute on screen or its time, with what it remembers. */
const PLAY_TAKES = json(
  {
    first: orNothing(text(20)),
    last: orNothing(text(20)),
    cfirst: orNothing(text(20)),
    clast: orNothing(text(20)),
    tlast: orNothing(text(20)),
    token: orNothing(text(4096)),
    tester: text(100),
    ticket: text(100),
    counted: yesOrNo,
    seconds: realNumber(0, 1_000_000),
    is_away: yesOrNo,
    performance: gameData(4096),
    play_mark: orNothing(text(400)),
    has_play_mark: yesOrNo,
  },
  [],
  4096,
);

// What each family of forms takes: one handler reads them, so they share a closed list of names.
const WEBAUTHN_NAMES = ["passkey_id", "client_data_json", "authenticator_data", "signature", "user_handle"];
const KEY_CHOICE_NAMES = ["access_level", "game_scope", "game_slugs", "ends_after_days", ...Object.keys(AREA_ACCESS_CHOICES)];
/** The bot check's answer, and the field Cloudflare's script adds to a form by itself. */
const BOT_CHECK_FIELDS = ["turnstile_token", "cf-turnstile-response"] as const;
const ACCOUNT_FORM = form([...SOCIAL_SETTINGS, "next", ...BOT_CHECK_FIELDS, "username", "password", "new_password", "current_password", "email", "code", "confirm", "with", "from", "kind", "birthday", "day", "month", "year", "today", "social_mode", "who_can_chat", "who_can_message", "color_theme", "is_streamer_mode_on", "where_used_from_enabled", "purchase_pin", "name", ...WEBAUTHN_NAMES, ...KEY_CHOICE_NAMES]);
const JOINING_TAKES: DoorTakes = { ...ACCOUNT_FORM, query: query("next", "username", "with", "game", "code", "error", "welcome").query };
const FRIEND_FORM = form(["invite_code", "is_appearing_offline", "next", "game_slug"]);
const FORUM_FORM = form(["title", "text_markdown", "category", "kind", "tags", "game_slug", "known_issue_topic_id", "reply_to_post_id", "post_id", "answer_post_id", "rating", "reason", "details", "reopen", "undo", "t", "u"]);
/** An image placed in a post while it's written, the one file the forum's pages send. */
const FORUM_IMAGE_FORM = form([], { fileNames: ["file"], maximumFilesSizeBytes: FORUM_LIMITS.imageSizeBytes });
const SETTINGS_FORM = form(["name", "kind", "amount_cents", "other_dollars", "monthly_budget_dollars", "monthly_storage_budget_dollars", "refill_level_dollars", "answer", "destination_kind", "endpoint_url", "event_kinds", "game_server_slug", "is_stripe_tax_used", "redirect_urls", ...WEBAUTHN_NAMES, ...KEY_CHOICE_NAMES]);
const GAME_FORM_NAMES = [
  "section", "title", "description", "devices", "controls", "genres", "screen_orientation", "cloud_saves", "account_offer", "deleted_account_erase", "room_browsing", "friend_joins", "friend_joins_shown", "account_requirement", "minimum_player_age_years", "multiplayer", "multiplayer_mode",
  "single", "local", "online", ...["local", "online"].flatMap((mode) => [`${mode}_play_style`, `${mode}_minimum_player_count`, `${mode}_maximum_player_count`]),
  ...Array.from({ length: LINK_LIMITS.maximumLinkCount }, (_, index) => [`link_name_${index}`, `destination_url_${index}`, `is_on_game_page_${index}`]).flat(),
  ...Array.from({ length: OWN_SERVER_LIMITS.maximumServerCount }, (_, index) => `own_server_url_${index}`),
  "visibility", "kind", "clear", "image_id", "shader_id", "source", "screen", "glass_tint_color", "confirm", "confirm_slug", "is_big_update", "match_update_mode", "patch_notes", "publish_after_ai_review_enabled", "at", "opens", "name", "notes", "details", "version_choice", "picked_version_id", "ends_at", "ends_after_days",
];
const GAME_FORM = form(GAME_FORM_NAMES);
/** A cover, screenshot or background sent from the game's page: one picture, or a shader's text, which is smaller. A game's own files go through the API (RAW_CALLS). */
const GAME_PICTURE_FORM = form(GAME_FORM_NAMES, { fileNames: ["file"], maximumFilesSizeBytes: IMAGE_LIMITS.maximumSizeBytes });
const ADMIN_FORM_NAMES = [
  "back", "reason", "content_rule", "precedent", "off", "game_server", "cloud_saves", "account_id", "notice_kind", "country_code", "social_stopped_reason", "username", "slug", "title", "description", "category", "status_filter", "is_known_issue", "known_issue_title", "merge_into_topic_id", "reply", "roadmap_item", "severity", "topic_status", "workaround", "group",
  "p_alone", "p_decision", "p_replaces", "p_title", "p_when", "p_why", "review_precedent", "rp_case_description", "rp_case_html", "rp_case_title", "rp_group", "rp_id", "rp_replaces", "rp_rule", "rp_title", "rp_version", "rp_when", "rp_why",
];
const ADMIN_FORM = form(ADMIN_FORM_NAMES);
const ADMIN_ZIP_FORM = form(ADMIN_FORM_NAMES, { fileNames: ["zip"], maximumFilesSizeBytes: ZIP_LIMITS.maximumZipSizeBytes });
const PROFILE_FORM = form(["display_name", "bio", "link_url", "reason", "details"]);
/** A report's words and its picture of the game, which report.ts takes up to 2.1 MB of text. */
const REPORT_BODY_SIZE_BYTES = 4 * 1024 * 1024;
const REPORT_FORM: DoorTakes = {
  query: query("room", "reported").query,
  body: { kind: "form", fields: { ...namesOf(["reason", "details", "room", "about", ...BOT_CHECK_FIELDS]) }, fileNames: ["picture"], maximumSizeBytes: REPORT_BODY_SIZE_BYTES },
};
const BUY_FIELDS: Readonly<Record<string, DoorShape>> = {
  item_name: text(40),
  item_count: integer(0, 1_000_000),
  game_account_id: orNothing(text(200)),
  tester_token: orNothing(text(40)),
  preview_country_code: orNothing(text(2)),
  passkey_tap: gameData(16 * 1024),
  password: text(4096),
  purchase_pin: text(40),
  buying_public_key_base64: orNothing(text(100)),
  buying_signature_base64: orNothing(text(100)),
  setup_intent_id: text(200),
  payment_method_id: text(200),
  sale_id: text(100),
};
const PASSKEY_FIELDS: Readonly<Record<string, DoorShape>> = { id: text(2000), clientDataJSON: text(16 * 1024), authenticatorData: text(16 * 1024), signature: text(16 * 1024), userHandle: orNothing(text(2000)), publicKey: text(16 * 1024), alg: integer(-100000, 100000), name: text(200), next: orNothing(text(2000)), purpose: text(40), transports: gameData(1024), passkey_tap: gameData(16 * 1024), password: text(4096) };
const OAUTH_NAMES = ["grant_type", "code", "code_verifier", "redirect_uri", "client_id", "client_secret", "refresh_token", "resource", "decision", "connect_step", "state", "scope", "code_challenge", "code_challenge_method", "response_type", "nonce", "next", ...WEBAUTHN_NAMES, ...KEY_CHOICE_NAMES];

// The account page's forms.
const ACCOUNT_SIGN_IN = signIn("next_field");
const accountForm = (path: string) => signedIn(["POST"], path, ACCOUNT_SIGN_IN, { takes: ACCOUNT_FORM });

// The sign-in and join pages take any of GET and POST: each says what the other does.
const joining = (path: string, trusts: readonly DoorTrust[] = ["session"]) => open(["GET", "POST"], path, { reaches: "account", trusts, origin: "own_pages_if_sent", takes: JOINING_TAKES });

const PASSKEY_SIGN_IN = statusOf(401, { error: "Sign in first." });
const passkey = (path: string) => signedIn(["POST"], path, PASSKEY_SIGN_IN, { trusts: ["session", "passkey"], takes: json(PASSKEY_FIELDS), ...ownPagesJson("challenge", "rpId", "allow", "ok", "is_waiting", "rp", "user", "algs", "exclude", "next") });

const NEEDS_ACCOUNT_TO_BUY = statusOf(403, { error: { code: "account_needed", message: "Make a free account (or sign in) to buy." } });
const buying = (methods: DoorRowFields["methods"], path: string, answerNames: readonly string[], origin: DoorOrigin = "own_pages") =>
  signedIn(methods, path, NEEDS_ACCOUNT_TO_BUY, { reaches: "purchase", origin, takes: json(BUY_FIELDS), ...jsonAnswer(...answerNames) });

const SAVES_SIGN_IN = statusOf(401, { error: "Sign in to save to your account." });
const SAVE_ANSWER = { answersAs: "json", answers: fieldsAnswer("saved_at", "changed_by_kind", "save_data", "save_copies", "save_copy", "is_kept", "save_copy_id", "kept_save_copy_id", "sha256", "tag", "version_number") } as const;
const FRIENDS_SIGN_IN = signIn("/friends");
const friendForm = (path: string) => signedIn(["POST"], path, FRIENDS_SIGN_IN, { takes: FRIEND_FORM });
const FRIEND_REQUEST_SIGN_IN: WhenSignedOut = { kind: "form_or_status", next: "/friends#requests", httpStatus: 401, jsonBody: { error: { code: "not_signed_in", message: "Sign in to add friends." } } };
/** Your games' changes (a favorite, Remove): from a form, back to sign in; from a script, a structured 401. */
const YOUR_GAMES_SIGN_IN: WhenSignedOut = { kind: "form_or_status", next: "/your-games", httpStatus: 401, jsonBody: { error: { code: "not_signed_in", message_for_people: "Sign in to keep favorites.", fix: "Sign in, then try again." } } };
const BLOCK_SIGN_IN: WhenSignedOut = { kind: "form_or_status", next: "/friends", httpStatus: 401, jsonBody: { error: { code: "not_signed_in", message: "Sign in to block players." } } };

// The forum: a banned developer reads it but posts nothing.
const FORUM_SIGN_IN = signIn("here_with_query");
const FORUM_QUERY = query("search_text", "name_prefix", "topic_id", "to", "section", "category", "kind", "tag", "tab", "topic_status", "page_number", "known_issue_topic_id", "done", "reply_to_post_id", "post_id", "v");
const forumPost = (path: string, whenSignedOut: WhenSignedOut = FORUM_SIGN_IN, takes: DoorTakes = FORUM_FORM) => signedIn(["POST"], path, whenSignedOut, { reaches: "forum_topic", isClosedToBannedDeveloper: true, takes });

const DASHBOARD_READ = query("error", "done", "stripe", "spending_request", "game_deletion_request", "deliveries", "cursor", "section");
// The dashboard: everything on a game goes through the API, whose router holds it to the caller's own games.
const developer = (methods: DoorRowFields["methods"], path: string, reaches: DoorReach, whenNoAccount: `/${string}`, next: "here" | `/${string}`, isOpenToBannedDeveloper = false, takes: DoorTakes = DASHBOARD_READ): SiteDoor => ({
  methods,
  path,
  origin: "own_pages_if_sent",
  answersAs: "page",
  contract: { whoMayCall: "developer", reaches, trusts: ["session"], takes, answers: ANSWERS_PAGE, limit: Array.isArray(methods) && methods.every((method) => method === "GET") ? READS_BY_ACCOUNT : WRITES_BY_ACCOUNT },
  whenSignedOut: signIn(next),
  whenNoAccount,
  ...(isOpenToBannedDeveloper ? { isOpenToBannedDeveloper: true as const } : {}),
});
const dashboard = (methods: DoorRowFields["methods"], path: string, isOpenToBannedDeveloper = false, takes: DoorTakes = DASHBOARD_READ) => developer(methods, path, "game", "/join?next=/dashboard", "here", isOpenToBannedDeveloper, takes);
const gameForm = (action: string, takes: DoorTakes = GAME_FORM) => dashboard(["POST"], `/dashboard/:slug/${action}`, false, takes);
const SETTINGS = "/dashboard/settings";
const settings = (methods: DoorRowFields["methods"], path: string, takes: DoorTakes = DASHBOARD_READ) => developer(methods, path, "account", "/join?next=/dashboard/settings", SETTINGS, false, takes);
const settingsForm = (sub: string) => settings(["POST"], `${SETTINGS}/${sub}`, SETTINGS_FORM);

const ADMIN_READ = query("status", "error", "not_found");
// /admin: Cloudflare Access, then Zaisma's people.
const admin = (methods: DoorRowFields["methods"], path: string, reaches: DoorReach, origin: DoorOrigin = "own_pages_if_sent", takes: DoorTakes = ADMIN_READ): SiteDoor => ({
  methods,
  path,
  origin,
  answersAs: "page",
  contract: { whoMayCall: "admin", reaches, trusts: ["admin_access"], takes, answers: ANSWERS_PAGE, limit: { whyNoLimit: "admin_only" } },
});
const adminPage = (path: string, reaches: DoorReach) => admin(["GET"], path, reaches, "anywhere");
const adminForm = (path: string, reaches: DoorReach, takes: DoorTakes = ADMIN_FORM) => admin(["POST"], path, reaches, "own_pages_if_sent", takes);

const RAW_CALLS = { takes: { query: {}, body: { kind: "bytes", maximumSizeBytes: MAXIMUM_RAW_BODY_SIZE_BYTES } }, answers: ANSWERS_BYTES, limit: { whyNoLimit: "counted_by_its_call" } } as const;
const SIGNED_BODY = { takes: { query: {}, body: { kind: "bytes", maximumSizeBytes: 1024 * 1024 } }, answers: ANSWERS_BYTES, limit: SIGNED } as const;
// A caller a named function proves, from what's on the request.
const proven = (methods: DoorRowFields["methods"], path: string, contract: DoorContract & { whoMayCall: DoorCallerProvenByFunction }): SiteDoor => ({ methods, path, origin: "anywhere", answersAs: "page", contract });

export const SITE_DOORS: readonly SiteDoor[] = [
  // What every page loads, the same for everyone.
  open(["GET"], "/js/*", { limit: FROM_MEMORY }),
  open(["GET"], "/css/*", { limit: FROM_MEMORY }),
  open(["GET"], "/:rules_file", { limit: FROM_MEMORY }),
  open(["GET"], "/whats-on-art/*", { limit: FILE_NO_LIMIT, answers: ANSWERS_FILE }),
  open(["GET"], "/img/*", { trusts: ["session"], limit: FILE_NO_LIMIT, answers: ANSWERS_FILE }),
  open(["GET"], "/shaders/*", { trusts: ["session"], limit: FILE_NO_LIMIT, answers: ANSWERS_FILE }),
  open(["GET"], "/shader-checks/*", { limit: FILE_NO_LIMIT, answers: ANSWERS_FILE }),

  // Calls from other machines: what proves them is on the request, so a named function reads it.
  // The API's and MCP's own routers hold each call to its row (API_ROUTES, TOOLS): here, only the address's ceiling before a key is known.
  proven("any", "/api/dev", { whoMayCall: "api_caller", reaches: "account", trusts: ["api_key", "session"], provenBy: proof("apps/site/src/developer.ts", "checkCall"), ...RAW_CALLS }),
  proven("any", "/api/dev/*", { whoMayCall: "api_caller", reaches: "account", trusts: ["api_key", "session"], provenBy: proof("apps/site/src/developer.ts", "checkCall"), ...RAW_CALLS }),
  proven("any", "/mcp", { whoMayCall: "api_caller", reaches: "account", trusts: ["api_key", "oauth_access"], provenBy: proof("apps/site/src/mcp.ts", "handleMcp"), ...RAW_CALLS }),
  proven("any", "/github/secret-scanning", { whoMayCall: "signed_sender", reaches: "any_account", trusts: ["github_signature"], provenBy: proof("apps/site/src/leaked-keys.ts", "handleGithubSecretScanning"), ...SIGNED_BODY }),
  proven("any", "/stripe/events", { whoMayCall: "signed_sender", reaches: "purchase", trusts: ["stripe_signature"], provenBy: proof("apps/site/src/stripe-events.ts", "handleStripeEvents"), ...SIGNED_BODY }),
  proven("any", "/stripe/connect-events", { whoMayCall: "signed_sender", reaches: "purchase", trusts: ["stripe_signature"], provenBy: proof("apps/site/src/stripe-connect-events.ts", "handleStripeConnectEvents"), ...SIGNED_BODY }),
  open(["POST"], "/csp-reports", { answersAs: "empty", takes: { query: {}, body: { kind: "bytes", maximumSizeBytes: 16_384 } } }),
  open(["POST"], "/api/speed-reports", { origin: "own_pages_if_sent", answersAs: "empty", takes: { query: {}, body: { kind: "bytes", maximumSizeBytes: 16_384 } } }),

  // Sign in with Zaisma, for other sites: their servers and pages ask first (OPTIONS), and these answer their own way when the method is wrong.
  open(["GET", "OPTIONS"], "/.well-known/openid-configuration", { limit: FROM_MEMORY, answers: ANSWERS_FILE }),
  open(["GET", "OPTIONS"], "/.well-known/jwks.json", { limit: FROM_MEMORY, answers: ANSWERS_FILE }),
  open(["GET", "OPTIONS"], "/.well-known/oauth-protected-resource", { limit: FROM_MEMORY, answers: ANSWERS_FILE }),
  open(["GET", "OPTIONS"], "/.well-known/oauth-protected-resource/mcp", { limit: FROM_MEMORY, answers: ANSWERS_FILE }),
  open(["GET", "OPTIONS"], "/.well-known/oauth-authorization-server", { limit: FROM_MEMORY, answers: ANSWERS_FILE }),
  open(["GET"], "/.well-known/security.txt", { limit: FROM_MEMORY, answers: ANSWERS_FILE }),
  open(["GET"], "/oauth/authorize", { reaches: "sign_in_app", trusts: ["session"], takes: OAUTH_QUERY }),
  open(["POST"], "/oauth/authorize", { reaches: "sign_in_app", trusts: ["session"], origin: "own_pages_if_sent", takes: { ...form(OAUTH_NAMES), query: OAUTH_QUERY.query } }),
  proven(["GET", "POST", "OPTIONS"], "/oauth/token", {
    whoMayCall: "token_holder",
    reaches: "account",
    trusts: ["oauth_code"],
    provenBy: proof("apps/site/src/sign-in.ts", "token"),
    takes: { query: {}, body: { kind: "bytes", maximumSizeBytes: 64 * 1024 } },
    answers: fieldsAnswer("access_token", "token_type", "expires_in", "refresh_token", "scope", "id_token", "error", "error_description"),
    limit: BY_ADDRESS,
  }),
  proven(["GET", "POST", "OPTIONS"], "/oauth/userinfo", {
    whoMayCall: "token_holder",
    reaches: "account",
    trusts: ["oauth_access"],
    provenBy: proof("apps/site/src/sign-in.ts", "readAccessToken"),
    takes: TAKES_NOTHING,
    answers: USERINFO_ANSWER,
    limit: BY_ADDRESS,
  }),
  // OAuth's own doors drop fields they don't know, as RFC 7591 and RFC 6749 say: this isn't the developer API.
  open(["GET", "POST", "OPTIONS"], "/oauth/register", { takes: { query: {}, body: { kind: "bytes", maximumSizeBytes: 64 * 1024 } }, answersAs: "json", answers: fieldsAnswer("client_id", "client_secret", "client_id_issued_at", "client_secret_expires_at", "client_name", "redirect_uris", "grant_types", "response_types", "token_endpoint_auth_method", "scope", "error", "error_description") }),

  // Signing in and joining.
  joining("/signin"),
  joining("/signin/email", ["session", "email_code"]),
  joining("/signin/code", ["email_code"]),
  open(["GET"], "/signin/with/:provider", { reaches: "account", takes: query("next") }),
  open(["GET"], "/signin/callback", { reaches: "account", trusts: ["oauth_code"], takes: query("code", "state", "error", "error_description", "next") }),
  joining("/join"),
  joining("/join/age"),
  joining("/join/account"),
  joining("/join/username"),
  joining("/join/play"),
  open(["GET"], "/api/playing-now", { origin: "anywhere", takes: query("preview_players"), ...jsonAnswer("playing_now_player_count", "busiest_games") }),
  open(["GET"], "/api/username-check", { trusts: ["session"], takes: query("username"), ...jsonAnswer("is_available", "message", "suggested_usernames") }),
  open(["POST"], "/api/passkeys/signin/options", { takes: json(PASSKEY_FIELDS), ...ownPagesJson("challenge", "rpId") }),
  open(["POST"], "/api/passkeys/signin", { reaches: "account", trusts: ["passkey"], takes: json(PASSKEY_FIELDS), ...ownPagesJson("next") }),

  // The account page.
  signedIn(["GET"], "/account", signIn(null), { origin: "anywhere", takes: query("next", "game", "kept", "from") }),
  signedIn(["GET"], "/account/kept", signIn("here_with_query"), { origin: "anywhere", takes: query("game", "next") }),
  signedIn(["GET"], "/account/data.zip", ACCOUNT_SIGN_IN, { origin: "anywhere", answers: ANSWERS_BYTES }),
  ...["username", "social", "streamer-mode", "color-theme", "confirm", "password", "email", "email/code", "email/remove", "delete", "where-used-from", "security-alerts/seen", "email-ask/skip"].map((form) => accountForm(`/account/${form}`)),
  accountForm("/signout"),
  accountForm("/account/keys/:key_id/revoke"),
  accountForm("/account/sign-ins/:sign_in_app_id/remove"),
  signedIn(["POST"], "/api/account/confirm", statusOf(401, { error: "Sign in first." }), { ...jsonAnswer("is_confirmed"), trusts: ["session", "passkey"], takes: json(PASSKEY_FIELDS) }),
  passkey("/api/passkeys/tap/options"),
  passkey("/api/passkeys/add/options"),
  passkey("/api/passkeys/add"),
  passkey("/account/passkeys/:passkey_id/remove"),

  // Playing.
  open(["GET"], "/", { trusts: ["session"], takes: BROWSE_QUERY }),
  open(["GET"], "/games", { trusts: ["session"], takes: BROWSE_QUERY }),
  open(["GET"], "/your-games", { trusts: ["session"] }),
  open(["GET"], "/your-games/played", { trusts: ["session"], takes: query("sort") }),
  open(["GET"], "/games/suggestions", { trusts: ["session"], takes: BROWSE_QUERY, ...jsonAnswer("finishes", "games") }),
  open(["GET"], "/g/:slug", { trusts: ["session"], takes: query("room", "server", "watch", "play", "buy", "theme", "state", "screen", "preview_bar") }),
  open(["GET"], "/g/:slug/rooms", { takes: query("room_order", "is_hiding_full_rooms", "labels", "cursor", "region", "shown_row_count", "left") }),
  open(["GET"], "/g/:slug/live-version", jsonAnswer("live_version_id", "live_version_match_update_mode")),
  open(["GET"], "/g/:slug/qr-code.svg", { takes: query("room"), answers: ANSWERS_FILE }),
  open(["GET", "POST"], "/g/:slug/report", { trusts: ["session"], takes: REPORT_FORM }),
  signedIn(["GET"], "/g/:slug/friends", statusOf(401), { answersAs: "empty" }),
  signedIn(["GET"], "/g/:slug/players/friends", statusOf(401, { error: { code: "not_signed_in", message: "Sign in to see your friends." } }), { origin: "anywhere", takes: query("player_ids", "room") }),
  proven(["GET"], "/t/:tester_token", { whoMayCall: "link_holder", reaches: "game", trusts: ["tester_link"], provenBy: proof("apps/site/src/pages.ts", "testerPage"), takes: query("room"), answers: ANSWERS_PAGE, limit: BY_ADDRESS }),
  proven(["POST"], "/t/:tester_token/enter", { whoMayCall: "link_holder", reaches: "game", trusts: ["tester_link"], provenBy: proof("apps/site/src/pages.ts", "testerEnter"), takes: json({ room_code: text(40) }), answers: fieldsAnswer("frame_url"), limit: BY_ADDRESS }),
  proven(["GET"], "/p/:preview_token", { whoMayCall: "link_holder", reaches: "game", trusts: ["preview_link"], provenBy: proof("apps/site/src/pages.ts", "previewPage"), takes: query("room"), answers: ANSWERS_PAGE, limit: BY_ADDRESS }),
  open(["POST"], "/api/plays/:slug", { reaches: "account", trusts: ["session", "tester_link"], origin: "own_pages_if_sent", takes: PLAY_TAKES, answersAs: "json", answers: fieldsAnswer("ticket", "key", "playerKind", "play_mark") }),
  open(["POST"], "/api/plays/:slug/account", { reaches: "account", trusts: ["session"], origin: "own_pages_if_sent", takes: json({ roomKey: text(100) }, [], 4096), answersAs: "json", answers: fieldsAnswer("player", "key", "playerKind") }),
  open(["POST"], "/api/plays/:slug/entry", { reaches: "account", trusts: ["session"], origin: "own_pages_if_sent", takes: json({ then: text(2000) }, [], 4096), answersAs: "json", answers: fieldsAnswer("entry_url") }),
  open(["POST"], "/api/links/:slug", { trusts: ["session"], origin: "own_pages", takes: json({ link_name: text(100), path: text(4000), query_parameters: gameData(4096), tester_token: orNothing(text(40)) }, [], 8192), answersAs: "json", answers: fieldsAnswer("destination_url") }),
  signedIn(["GET"], "/api/me/played", statusOf(401, { error: "Signed out" }), { origin: "anywhere", ...jsonAnswer("played") }),
  signedIn(["POST"], "/api/me/played", statusOf(401, { error: "Signed out" }), { takes: json({ played: listOf(gameData(1024), 1000) }, [], 256 * 1024), ...ownPagesJson("ok") }),
  signedIn(["POST"], "/api/me/played/:slug", statusOf(401, { error: "Signed out" }), { takes: json({}), ...ownPagesJson("ok") }),
  signedIn(["POST"], "/api/me/played/:slug/remove", YOUR_GAMES_SIGN_IN, { takes: json({}), ...ownPagesJson("ok") }),
  signedIn(["POST"], "/api/me/favorites/:slug", YOUR_GAMES_SIGN_IN, { takes: json({}), ...ownPagesJson("ok", "is_favorite") }),
  signedIn(["POST"], "/api/me/favorites/:slug/remove", YOUR_GAMES_SIGN_IN, { takes: json({}), ...ownPagesJson("ok", "is_favorite") }),
  signedIn(["POST"], "/api/presence", statusOf(401), { takes: json({ game_slug: text(40), left_game_slug: text(40) }, [], 4096), answersAs: "json", answers: fieldsAnswer("waiting_friend_request_count", "accepted_friend_request_count") }),

  // A player's saves: the game page writes them, on its own site.
  ...(["/api/saves/:slug", "/api/saves/:slug/copies", "/api/saves/:slug/copies/:save_copy_id"] as const).map((path) => signedIn(["GET"], path, SAVES_SIGN_IN, { reaches: "player_save", origin: "anywhere", takes: query("version"), ...SAVE_ANSWER })),
  signedIn(["PUT"], "/api/saves/:slug", SAVES_SIGN_IN, { reaches: "player_save", origin: "own_pages", takes: json({ tag: gameData(1024), base_version_number: gameData(64), save_json: gameData(SAVE_LIMIT_BYTES * 2 + 1024), version_id: gameData(1024), replace: gameData(64), keep: gameData(64), played_at: gameData(1024) }, [], SAVE_LIMIT_BYTES * 2 + 1024), ...SAVE_ANSWER }),
  signedIn(["POST"], "/api/saves/:slug/copies/:save_copy_id/restore", SAVES_SIGN_IN, { reaches: "player_save", origin: "own_pages", takes: json({ tag: gameData(1024) }, [], 4096), ...SAVE_ANSWER }),

  // Buying.
  open(["POST"], "/api/buy/:slug/start", { reaches: "purchase", trusts: ["session"], takes: json(BUY_FIELDS), origin: "own_pages", ...jsonAnswer("purchase_id", "item", "item_count", "price", "seller", "refund_policy", "refund_policy_words", "is_eu_withdrawal_line_shown", "saved_card", "has_account_email", "is_confirmation_needed", "confirmation_reason", "confirmation_methods", "wallet"), limit: BY_ADDRESS }),
  buying(["POST"], "/api/buy/confirm", ["is_confirmed"]),
  buying(["GET"], "/api/buy/purchases/:sale_id", ["purchase"], "anywhere"),
  buying(["POST"], "/api/buy/purchases/:sale_id/pay-with-saved-card", ["status", "purchase", "client_secret", "stripe_account_id"]),
  buying(["POST"], "/api/buy/purchases/:sale_id/wallet-intent", ["client_secret", "stripe_account_id"]),
  buying(["POST"], "/api/payment-methods/setup", ["setup_intent_id", "client_secret"]),
  buying(["POST", "DELETE"], "/api/payment-methods/saved", ["saved_card"]),
  buying(["PUT", "DELETE"], "/api/account/purchase-pin", ["has_purchase_pin"]),
  open(["GET"], "/buy/stripe-frame", { takes: query("opener_origin") }),
  open(["GET"], "/buy/:slug/:item_name", { trusts: ["session"], takes: query("preview_country", "item_count", "opener_origin", "game_account_id", "request_number", "preview_wallet") }),
  open(["GET"], "/stripe/connect-return", { reaches: "account", trusts: ["session"], takes: query("state", "code", "error", "error_description", "scope") }),

  // Friends and blocks.
  signedIn(["GET"], "/friends", FRIENDS_SIGN_IN, { origin: "anywhere", takes: query("added", "invite", "removed", "unblocked", "blocked", "turned-down") }),
  friendForm("/friends/add"),
  friendForm("/friends/invites"),
  friendForm("/friends/appear-offline"),
  friendForm("/friends/invites/:invite_code/remove"),
  friendForm("/friends/:player_id/remove"),
  open(["GET", "POST"], "/friends/add/:invite_link_code", { reaches: "account", trusts: ["session"], origin: "own_pages_if_sent", takes: FRIEND_FORM }),
  open(["GET"], "/friends/among", { trusts: ["session"], takes: query("player_ids", "room"), ...jsonAnswer("players") }),
  signedIn(["GET"], "/friends/requests", FRIEND_REQUEST_SIGN_IN, { origin: "anywhere", ...jsonAnswer("requests", "accepted", "player", "can_send", "has_sent", "is_friend") }),
  signedIn(["POST"], "/friends/requests", FRIEND_REQUEST_SIGN_IN, { takes: json({ player_id: text(80), game_slug: orNothing(text(40)) }), ...ownPagesJson("status") }),
  signedIn(["GET"], "/friends/requests/about/:player_id", FRIEND_REQUEST_SIGN_IN, { origin: "anywhere", ...jsonAnswer("requests", "accepted", "player", "can_send", "has_sent", "is_friend") }),
  signedIn(["POST"], "/friends/requests/:player_id/:answer_verb", FRIEND_REQUEST_SIGN_IN, { takes: json({}), ...ownPagesJson("answer") }),
  signedIn(["GET"], "/friends/blocks/:player_id", BLOCK_SIGN_IN, { origin: "anywhere", ...jsonAnswer("player", "is_friend", "is_blocked", "ok") }),
  signedIn(["POST"], "/friends/blocks/:player_id", BLOCK_SIGN_IN, { takes: { ...json({}), body: { kind: "bytes", maximumSizeBytes: FORM_SIZE_BYTES } }, origin: "own_pages_if_sent", ...jsonAnswer("player", "is_friend", "is_blocked", "ok") }),
  open(["GET"], "/friends/blocks/:player_id/remove"),
  signedIn(["POST"], "/friends/blocks/:player_id/remove", FRIENDS_SIGN_IN, { takes: json({}), ...ownPagesJson("ok", "is_blocked", "player") }),

  // Profiles.
  open(["GET", "POST"], "/:at_username", { trusts: ["session"], origin: "own_pages_if_sent", takes: { ...PROFILE_FORM, query: query("view_as", "saved", "reported").query } }),
  signedIn(["GET", "POST"], "/:at_username/edit", { kind: "profile" }, { takes: PROFILE_FORM }),
  signedIn(["GET", "POST"], "/:at_username/report", signIn("here"), { takes: PROFILE_FORM }),

  // The developer forum.
  open(["GET"], "/forum", { reaches: "forum_topic", trusts: ["session"], takes: FORUM_QUERY }),
  open(["GET"], "/forum/messages", { reaches: "forum_topic", trusts: ["session"], takes: FORUM_QUERY }),
  open(["GET"], "/forum/similar", { reaches: "forum_topic", trusts: ["session"], takes: FORUM_QUERY }),
  open(["GET"], "/forum/out", { takes: query("to") }),
  open(["GET"], "/forum/media/:media_id", { reaches: "forum_topic", trusts: ["session"], takes: query("v"), answers: ANSWERS_FILE }),
  signedIn(["GET"], "/forum/people", statusOf(401, []), { reaches: "forum_topic", origin: "anywhere", takes: FORUM_QUERY, answersAs: "json", answers: ANY_LIST }),
  forumPost("/forum/media", statusOf(401, { error: "Sign in to add images." }), FORUM_IMAGE_FORM),
  forumPost("/forum/preview", statusOf(401)),
  signedIn(["GET"], "/forum/new", FORUM_SIGN_IN, { reaches: "forum_topic", origin: "anywhere", takes: FORUM_QUERY }),
  forumPost("/forum/new"),
  signedIn(["GET"], "/forum/messages/new", FORUM_SIGN_IN, { reaches: "forum_topic", origin: "anywhere", takes: FORUM_QUERY }),
  forumPost("/forum/messages/new"),
  open(["GET"], "/forum/:topic_id", { reaches: "forum_topic", trusts: ["session"], takes: FORUM_QUERY }),
  // Back here after signing in for a post: a GET, which goes on to the topic.
  signedIn(["GET"], "/forum/:topic_id/:topic_action", FORUM_SIGN_IN, { reaches: "forum_topic", origin: "anywhere", takes: FORUM_QUERY }),
  forumPost("/forum/:topic_id/:topic_action"),

  // Developer settings, before the dashboard's /dashboard/<game>: settings is no game's slug.
  settings(["GET"], SETTINGS),
  settings(["GET"], `${SETTINGS}/*`),
  ...["credit/top-up", "credit/plan/start", "credit/plan/level", "credit/plan/stop", "credit/refund/:top_up_id", "storage/budget", "storage/budget-off", "games/:slug/:budget_action", "spending/:spending_request_id", "game-deletion/:game_deletion_request_id", "pro/checkout", "pro/refund", "pro/cancel", "pro/resume", "payments/connect", "payments/tax", "payments/disconnect", "webhooks", "webhooks/:webhook_id", "webhooks/:webhook_id/:webhook_action", "sign-in-apps", "sign-in-apps/:sign_in_app_id", "sign-in-apps/:sign_in_app_id/:sign_in_app_action", "keys", "keys/:key_id/remove"].map(settingsForm),

  // The dashboard.
  dashboard(["GET"], "/dashboard", true),
  dashboard(["POST"], "/dashboard/new", false, GAME_FORM),
  dashboard(["GET"], "/dashboard/feedback"),
  dashboard(["GET"], "/dashboard/feedback/:moved_topic_id"),
  dashboard(["GET"], "/dashboard/:slug/export.zip", true),
  dashboard(["GET"], "/dashboard/:slug"),
  dashboard(["GET"], "/dashboard/:slug/*"),
  ...["images", "backgrounds"].map((action) => gameForm(action, GAME_PICTURE_FORM)),
  ...["details", "links", "own-servers", "visibility", "images/:id/remove", "backgrounds/:screen", "shaders/:id/remove", "glass-tint", "testers", "testers/:id/:tester_action", "delete", "bring-back", "erase-now", "versions/:id/end-previews", "versions/:id/:version_action"].map((action) => gameForm(action)),

  // Zaisma's own people.
  admin("any", "/admin/mcp", "zaisma_settings", "anywhere"),
  adminPage("/admin", "any_game"),
  adminPage("/admin/audit", "zaisma_settings"),
  adminPage("/admin/profiles", "any_account"),
  adminPage("/admin/chat-reviews", "any_account"),
  adminPage("/admin/ncmec", "any_account"),
  adminPage("/admin/publishing", "any_account"),
  adminPage("/admin/reports", "any_game"),
  adminPage("/admin/precedents", "zaisma_settings"),
  adminPage("/admin/review-precedents", "zaisma_settings"),
  adminPage("/admin/feedback", "forum_topic"),
  adminPage("/admin/feedback/pictures/:feedback_id", "forum_topic"),
  adminPage("/admin/feedback/:feedback_id", "forum_topic"),
  adminPage("/admin/games/:id", "any_game"),
  adminPage("/admin/images/:id", "any_game"),
  adminPage("/admin/shaders/:shader_id/:shader_picture", "any_game"),
  adminPage("/admin/reports/:id/picture", "any_game"),
  adminForm("/admin/upload", "any_game", ADMIN_ZIP_FORM),
  adminForm("/admin/api/games", "any_game", ADMIN_ZIP_FORM),
  adminForm("/admin/versions/:id/:review_verb", "any_game"),
  adminForm("/admin/versions/:id/reject-copy", "any_game"),
  adminForm("/admin/images/:id/:review_verb", "any_game"),
  adminForm("/admin/images/:id/clear-listing", "any_game"),
  adminForm("/admin/shaders/:shader_id/:review_verb", "any_game"),
  ...["title-listing/clear", "details/:review_verb", "plays/:play_day/clear", "shelves", "multiplayer", "saves", "owner", "notice", "country-block", "country-block-lift", "delete", ":game_action"].map((action) => adminForm(`/admin/games/:id/${action}`, "any_game")),
  adminForm("/admin/report-groups/:id/:report_group_action", "any_game"),
  adminForm("/admin/feedback/posts/:feedback_id/:feedback_verb", "forum_topic"),
  adminForm("/admin/feedback/:feedback_id/decide", "forum_topic"),
  adminForm("/admin/publishing/add", "any_account"),
  adminForm("/admin/publishing/:publisher/remove", "any_account"),
  adminForm("/admin/profiles/:id/:profile_verb", "any_account"),
  adminForm("/admin/chat-reviews/:id/:chat_review_verb", "any_account"),
  adminForm("/admin/ncmec/:id/send", "any_account"),
  adminForm("/admin/ncmec/accounts/:account_id/clear-pause", "any_account"),
  adminForm("/admin/precedents", "zaisma_settings"),
  adminForm("/admin/precedents/:precedent_id/:precedent_verb", "zaisma_settings"),
  adminForm("/admin/review-precedents/:precedent_id/:review_precedent_verb", "zaisma_settings"),

  // Pages anyone may read.
  open(["GET"], "/developers"),
  open(["GET"], "/developers/covers", { trusts: ["session"] }),
  open(["GET"], "/developers/backgrounds", { trusts: ["session"] }),
  open(["GET"], "/developers/backgrounds/:background_file", { limit: FROM_MEMORY, answers: ANSWERS_FILE }),
  open(["GET"], "/design", { takes: query("theme", "page", "search_text", "state", "screen") }),
  open(["GET"], "/design/*", { takes: query("theme", "page", "search_text", "state", "screen") }),
  open(["GET"], "/legal/:legal_page"),
  open(["GET"], "/sitemap.xml", { answers: ANSWERS_FILE }),
  open(["GET"], "/robots.txt", { limit: FROM_MEMORY, answers: ANSWERS_FILE }),
];

const isExactPath = (path: string) => !path.includes(":") && !path.includes("*");

const exactDoors = new Map<string, SiteDoor[]>();
const patternDoors: { door: SiteDoor; pattern: RegExp }[] = [];
for (const door of SITE_DOORS) {
  if (isExactPath(door.path)) exactDoors.set(door.path, [...(exactDoors.get(door.path) ?? []), door]);
  else patternDoors.push({ door, pattern: doorPathPattern(door.path, PATH_PARTS) });
}

const takes = (door: SiteDoor, method: string) => door.methods === "any" || door.methods.includes((method === "HEAD" ? "GET" : method) as SiteDoorMethod);

/** The row for a request, or what's wrong: nothing at this path, or nothing at it for this method. An exact path comes first, then rows in order. */
export function siteDoorAt(path: string, method: string): SiteDoor | "no_door" | "wrong_method" {
  const exact = exactDoors.get(path);
  const exactDoor = exact?.find((door) => takes(door, method));
  if (exactDoor) return exactDoor;
  let isKnownPath = Boolean(exact);
  for (const { door, pattern } of patternDoors) {
    if (!pattern.test(path)) continue;
    if (takes(door, method)) return door;
    isKnownPath = true;
  }
  return isKnownPath ? "wrong_method" : "no_door";
}

/** A row's ids on the security map, one per method: page:POST /account/email. */
export const siteDoorIds = (door: SiteDoor): string[] => (door.methods === "any" ? [`page:${door.path}`] : door.methods.map((method) => `page:${method} ${door.path}`));
