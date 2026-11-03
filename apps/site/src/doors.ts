import { doorPathPattern, type DoorCallerProvenByFunction, type DoorContract, type DoorReach, type DoorTrust } from "@zaisma/core";

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
  chat_review_verb: "false-alarm|remove-chat|reported",
  precedent_id: "[a-z0-9_-]+",
  precedent_verb: "activate|change|retire",
  review_precedent_verb: "approve|retire|change|retry",
};

const signIn = (next: "here" | "here_with_query" | "next_field" | `/${string}` | null): WhenSignedOut => ({ kind: "sign_in", next });
const statusOf = (httpStatus: number, jsonBody: unknown = null): WhenSignedOut => ({ kind: "status", httpStatus, jsonBody });
const proof = (sourcePath: string, symbolName: string) => ({ source_path: sourcePath, symbol_name: symbolName });

// A door anyone may open: public, or showing a signed-in person their own too.
const open = (methods: DoorRowFields["methods"], path: string, options: { reaches?: DoorReach; trusts?: readonly DoorTrust[]; origin?: DoorOrigin; answersAs?: DoorAnswerKind } = {}): SiteDoor => ({
  methods,
  path,
  origin: options.origin ?? "anywhere",
  answersAs: options.answersAs ?? "page",
  contract: { whoMayCall: "anyone", reaches: options.reaches ?? "nothing_private", trusts: options.trusts ?? [] },
});
// A door for a session, on the person's own things unless it says otherwise.
const signedIn = (
  methods: DoorRowFields["methods"],
  path: string,
  whenSignedOut: WhenSignedOut,
  options: { reaches?: DoorReach; trusts?: readonly DoorTrust[]; origin?: DoorOrigin; answersAs?: DoorAnswerKind; isClosedToBannedDeveloper?: true } = {},
): SiteDoor => ({
  methods,
  path,
  origin: options.origin ?? "own_pages_if_sent",
  answersAs: options.answersAs ?? "page",
  contract: { whoMayCall: "signed_in", reaches: options.reaches ?? "account", trusts: options.trusts ?? ["session"] },
  whenSignedOut,
  ...(options.isClosedToBannedDeveloper ? { isClosedToBannedDeveloper: true as const } : {}),
});

const JSON_ANSWER = { answersAs: "json" } as const;
const OWN_PAGES_JSON = { origin: "own_pages", answersAs: "json" } as const;

// The account page's forms.
const ACCOUNT_SIGN_IN = signIn("next_field");
const accountForm = (path: string) => signedIn(["POST"], path, ACCOUNT_SIGN_IN);

// The sign-in and join pages take any of GET and POST: each says what the other does.
const joining = (path: string, trusts: readonly DoorTrust[] = ["session"]) => open(["GET", "POST"], path, { reaches: "account", trusts, origin: "own_pages_if_sent" });

const PASSKEY_SIGN_IN = statusOf(401, { error: "Sign in first." });
const passkey = (path: string) => signedIn(["POST"], path, PASSKEY_SIGN_IN, { trusts: ["session", "passkey"], ...OWN_PAGES_JSON });

const NEEDS_ACCOUNT_TO_BUY = statusOf(403, { error: { code: "account_needed", message: "Make a free account (or sign in) to buy." } });
const buying = (methods: DoorRowFields["methods"], path: string, origin: DoorOrigin = "own_pages") => signedIn(methods, path, NEEDS_ACCOUNT_TO_BUY, { reaches: "purchase", origin, answersAs: "json" });

const SAVES_SIGN_IN = statusOf(401, { error: "Sign in to save to your account." });
const FRIENDS_SIGN_IN = signIn("/friends");
const friendForm = (path: string) => signedIn(["POST"], path, FRIENDS_SIGN_IN);
const FRIEND_REQUEST_SIGN_IN: WhenSignedOut = { kind: "form_or_status", next: "/friends#requests", httpStatus: 401, jsonBody: { error: { code: "not_signed_in", message: "Sign in to add friends." } } };
const BLOCK_SIGN_IN: WhenSignedOut = { kind: "form_or_status", next: "/friends", httpStatus: 401, jsonBody: { error: { code: "not_signed_in", message: "Sign in to block players." } } };

// The forum: a banned developer reads it but posts nothing.
const FORUM_SIGN_IN = signIn("here_with_query");
const forumPost = (path: string, whenSignedOut: WhenSignedOut = FORUM_SIGN_IN) => signedIn(["POST"], path, whenSignedOut, { reaches: "forum_topic", isClosedToBannedDeveloper: true });

// The dashboard: everything on a game goes through the API, whose router holds it to the caller's own games.
const developer = (methods: DoorRowFields["methods"], path: string, reaches: DoorReach, whenNoAccount: `/${string}`, next: "here" | `/${string}`, isOpenToBannedDeveloper = false): SiteDoor => ({
  methods,
  path,
  origin: "own_pages_if_sent",
  answersAs: "page",
  contract: { whoMayCall: "developer", reaches, trusts: ["session"] },
  whenSignedOut: signIn(next),
  whenNoAccount,
  ...(isOpenToBannedDeveloper ? { isOpenToBannedDeveloper: true as const } : {}),
});
const dashboard = (methods: DoorRowFields["methods"], path: string, isOpenToBannedDeveloper = false) => developer(methods, path, "game", "/join?next=/dashboard", "here", isOpenToBannedDeveloper);
const gameForm = (action: string) => dashboard(["POST"], `/dashboard/:slug/${action}`);
const SETTINGS = "/dashboard/settings";
const settings = (methods: DoorRowFields["methods"], path: string) => developer(methods, path, "account", "/join?next=/dashboard/settings", SETTINGS);
const settingsForm = (sub: string) => settings(["POST"], `${SETTINGS}/${sub}`);

// /admin: Cloudflare Access, then Zaisma's people.
const admin = (methods: DoorRowFields["methods"], path: string, reaches: DoorReach, origin: DoorOrigin = "own_pages_if_sent"): SiteDoor => ({
  methods,
  path,
  origin,
  answersAs: "page",
  contract: { whoMayCall: "admin", reaches, trusts: ["admin_access"] },
});
const adminPage = (path: string, reaches: DoorReach) => admin(["GET"], path, reaches, "anywhere");
const adminForm = (path: string, reaches: DoorReach) => admin(["POST"], path, reaches);

// A caller a named function proves, from what's on the request.
const proven = (methods: DoorRowFields["methods"], path: string, contract: DoorContract & { whoMayCall: DoorCallerProvenByFunction }): SiteDoor => ({ methods, path, origin: "anywhere", answersAs: "page", contract });

export const SITE_DOORS: readonly SiteDoor[] = [
  // What every page loads, the same for everyone.
  open(["GET"], "/js/*"),
  open(["GET"], "/css/*"),
  open(["GET"], "/:rules_file"),
  open(["GET"], "/img/*", { trusts: ["session"] }),
  open(["GET"], "/shaders/*", { trusts: ["session"] }),
  open(["GET"], "/shader-checks/*"),

  // Calls from other machines: what proves them is on the request, so a named function reads it.
  proven("any", "/api/dev", { whoMayCall: "api_caller", reaches: "account", trusts: ["api_key", "session"], provenBy: proof("apps/site/src/developer.ts", "checkCall") }),
  proven("any", "/api/dev/*", { whoMayCall: "api_caller", reaches: "account", trusts: ["api_key", "session"], provenBy: proof("apps/site/src/developer.ts", "checkCall") }),
  proven("any", "/mcp", { whoMayCall: "api_caller", reaches: "account", trusts: ["api_key", "oauth_access"], provenBy: proof("apps/site/src/mcp.ts", "handleMcp") }),
  proven("any", "/github/secret-scanning", { whoMayCall: "signed_sender", reaches: "any_account", trusts: ["github_signature"], provenBy: proof("apps/site/src/leaked-keys.ts", "handleGithubSecretScanning") }),
  proven("any", "/stripe/events", { whoMayCall: "signed_sender", reaches: "purchase", trusts: ["stripe_signature"], provenBy: proof("apps/site/src/stripe-events.ts", "handleStripeEvents") }),
  proven("any", "/stripe/connect-events", { whoMayCall: "signed_sender", reaches: "purchase", trusts: ["stripe_signature"], provenBy: proof("apps/site/src/stripe-connect-events.ts", "handleStripeConnectEvents") }),
  open(["POST"], "/csp-reports"),
  open(["POST"], "/api/speed-reports", { origin: "own_pages_if_sent", answersAs: "empty" }),

  // Sign in with Zaisma, for other sites: their servers and pages ask first (OPTIONS), and these answer their own way when the method is wrong.
  open(["GET", "OPTIONS"], "/.well-known/openid-configuration"),
  open(["GET", "OPTIONS"], "/.well-known/jwks.json"),
  open(["GET", "OPTIONS"], "/.well-known/oauth-protected-resource"),
  open(["GET", "OPTIONS"], "/.well-known/oauth-protected-resource/mcp"),
  open(["GET", "OPTIONS"], "/.well-known/oauth-authorization-server"),
  open(["GET"], "/.well-known/security.txt"),
  open(["GET"], "/oauth/authorize", { reaches: "sign_in_app", trusts: ["session"] }),
  open(["POST"], "/oauth/authorize", { reaches: "sign_in_app", trusts: ["session"], origin: "own_pages_if_sent" }),
  proven(["GET", "POST", "OPTIONS"], "/oauth/token", { whoMayCall: "token_holder", reaches: "account", trusts: ["oauth_code"], provenBy: proof("apps/site/src/sign-in.ts", "token") }),
  proven(["GET", "POST", "OPTIONS"], "/oauth/userinfo", { whoMayCall: "token_holder", reaches: "account", trusts: ["oauth_access"], provenBy: proof("apps/site/src/sign-in.ts", "readAccessToken") }),
  open(["GET", "POST", "OPTIONS"], "/oauth/register"),

  // Signing in and joining.
  joining("/signin"),
  joining("/signin/email", ["session", "email_code"]),
  joining("/signin/code", ["email_code"]),
  open(["GET"], "/signin/with/:provider", { reaches: "account" }),
  open(["GET"], "/signin/callback", { reaches: "account", trusts: ["oauth_code"] }),
  joining("/join"),
  joining("/join/age"),
  joining("/join/account"),
  joining("/join/username"),
  joining("/join/play"),
  open(["GET"], "/api/username-check", { trusts: ["session"] }),
  open(["POST"], "/api/passkeys/signin/options", OWN_PAGES_JSON),
  open(["POST"], "/api/passkeys/signin", { reaches: "account", trusts: ["passkey"], ...OWN_PAGES_JSON }),

  // The account page.
  signedIn(["GET"], "/account", signIn(null), { origin: "anywhere" }),
  signedIn(["GET"], "/account/kept", signIn("here_with_query"), { origin: "anywhere" }),
  signedIn(["GET"], "/account/data.zip", ACCOUNT_SIGN_IN, { origin: "anywhere" }),
  ...["username", "social", "streamer-mode", "color-theme", "confirm", "password", "email", "email/code", "email/remove", "delete", "where-used-from", "security-alerts/seen", "email-ask/skip"].map((form) => accountForm(`/account/${form}`)),
  accountForm("/signout"),
  accountForm("/account/keys/:key_id/revoke"),
  accountForm("/account/sign-ins/:sign_in_app_id/remove"),
  signedIn(["POST"], "/api/account/confirm", statusOf(401, { error: "Sign in first." }), { ...JSON_ANSWER, trusts: ["session", "passkey"] }),
  passkey("/api/passkeys/tap/options"),
  passkey("/api/passkeys/add/options"),
  passkey("/api/passkeys/add"),
  passkey("/account/passkeys/:passkey_id/remove"),

  // Playing.
  open(["GET"], "/", { trusts: ["session"] }),
  open(["GET"], "/games", { trusts: ["session"] }),
  open(["GET"], "/games/suggestions", { trusts: ["session"] }),
  open(["GET"], "/g/:slug", { trusts: ["session"] }),
  open(["GET"], "/g/:slug/rooms"),
  open(["GET"], "/g/:slug/live-version"),
  open(["GET"], "/g/:slug/qr-code.svg"),
  open(["GET", "POST"], "/g/:slug/report", { trusts: ["session"] }),
  signedIn(["GET"], "/g/:slug/friends", statusOf(401), { answersAs: "empty" }),
  signedIn(["GET"], "/g/:slug/players/friends", statusOf(401, { error: { code: "not_signed_in", message: "Sign in to see your friends." } }), { origin: "anywhere", ...JSON_ANSWER }),
  proven(["GET"], "/t/:tester_token", { whoMayCall: "link_holder", reaches: "game", trusts: ["tester_link"], provenBy: proof("apps/site/src/pages.ts", "testerPage") }),
  proven(["POST"], "/t/:tester_token/enter", { whoMayCall: "link_holder", reaches: "game", trusts: ["tester_link"], provenBy: proof("apps/site/src/pages.ts", "testerEnter") }),
  proven(["GET"], "/p/:preview_token", { whoMayCall: "link_holder", reaches: "game", trusts: ["preview_link"], provenBy: proof("apps/site/src/pages.ts", "previewPage") }),
  open(["POST"], "/api/plays/:slug", { reaches: "account", trusts: ["session", "tester_link"], origin: "own_pages_if_sent", answersAs: "empty" }),
  open(["POST"], "/api/plays/:slug/account", { reaches: "account", trusts: ["session"], origin: "own_pages_if_sent", answersAs: "empty" }),
  open(["POST"], "/api/plays/:slug/entry", { reaches: "account", trusts: ["session"], origin: "own_pages_if_sent", answersAs: "empty" }),
  open(["POST"], "/api/links/:slug", { trusts: ["session"], origin: "own_pages", answersAs: "empty" }),
  signedIn(["GET"], "/api/me/played", statusOf(401, { error: "Signed out" }), { origin: "anywhere", ...JSON_ANSWER }),
  signedIn(["POST"], "/api/me/played", statusOf(401, { error: "Signed out" }), OWN_PAGES_JSON),
  signedIn(["POST"], "/api/me/played/:slug", statusOf(401, { error: "Signed out" }), OWN_PAGES_JSON),
  signedIn(["POST"], "/api/presence", statusOf(401), { answersAs: "empty" }),
  open(["GET"], "/api/announcements"),

  // A player's saves: the game page writes them, on its own site.
  ...(["/api/saves/:slug", "/api/saves/:slug/copies", "/api/saves/:slug/copies/:save_copy_id"] as const).map((path) => signedIn(["GET"], path, SAVES_SIGN_IN, { reaches: "player_save", origin: "anywhere", ...JSON_ANSWER })),
  signedIn(["PUT"], "/api/saves/:slug", SAVES_SIGN_IN, { reaches: "player_save", ...OWN_PAGES_JSON }),
  signedIn(["POST"], "/api/saves/:slug/copies/:save_copy_id/restore", SAVES_SIGN_IN, { reaches: "player_save", ...OWN_PAGES_JSON }),

  // Buying.
  open(["POST"], "/api/buy/:slug/start", { reaches: "purchase", trusts: ["session"], ...OWN_PAGES_JSON }),
  buying(["POST"], "/api/buy/confirm"),
  buying(["GET"], "/api/buy/purchases/:sale_id", "anywhere"),
  buying(["POST"], "/api/buy/purchases/:sale_id/pay-with-saved-card"),
  buying(["POST"], "/api/buy/purchases/:sale_id/wallet-intent"),
  buying(["POST"], "/api/payment-methods/setup"),
  buying(["POST", "DELETE"], "/api/payment-methods/saved"),
  buying(["PUT", "DELETE"], "/api/account/purchase-pin"),
  open(["GET"], "/buy/stripe-frame"),
  open(["GET"], "/buy/:slug/:item_name", { trusts: ["session"] }),
  open(["GET"], "/stripe/connect-return", { reaches: "account", trusts: ["session"] }),

  // Friends and blocks.
  signedIn(["GET"], "/friends", FRIENDS_SIGN_IN, { origin: "anywhere" }),
  friendForm("/friends/add"),
  friendForm("/friends/invites"),
  friendForm("/friends/appear-offline"),
  friendForm("/friends/invites/:invite_code/remove"),
  friendForm("/friends/:player_id/remove"),
  open(["GET", "POST"], "/friends/add/:invite_link_code", { reaches: "account", trusts: ["session"], origin: "own_pages_if_sent" }),
  open(["GET"], "/friends/among", { trusts: ["session"] }),
  signedIn(["GET"], "/friends/requests", FRIEND_REQUEST_SIGN_IN, { origin: "anywhere", ...JSON_ANSWER }),
  signedIn(["POST"], "/friends/requests", FRIEND_REQUEST_SIGN_IN, OWN_PAGES_JSON),
  signedIn(["GET"], "/friends/requests/about/:player_id", FRIEND_REQUEST_SIGN_IN, { origin: "anywhere", ...JSON_ANSWER }),
  signedIn(["POST"], "/friends/requests/:player_id/:answer_verb", FRIEND_REQUEST_SIGN_IN, OWN_PAGES_JSON),
  signedIn(["GET"], "/friends/blocks/:player_id", BLOCK_SIGN_IN, { origin: "anywhere", ...JSON_ANSWER }),
  signedIn(["POST"], "/friends/blocks/:player_id", BLOCK_SIGN_IN, OWN_PAGES_JSON),
  open(["GET"], "/friends/blocks/:player_id/remove"),
  signedIn(["POST"], "/friends/blocks/:player_id/remove", FRIENDS_SIGN_IN, OWN_PAGES_JSON),

  // Profiles.
  open(["GET", "POST"], "/:at_username", { trusts: ["session"], origin: "own_pages_if_sent" }),
  signedIn(["GET", "POST"], "/:at_username/edit", { kind: "profile" }),
  signedIn(["GET", "POST"], "/:at_username/report", signIn("here")),

  // The developer forum.
  open(["GET"], "/forum", { reaches: "forum_topic", trusts: ["session"] }),
  open(["GET"], "/forum/messages", { reaches: "forum_topic", trusts: ["session"] }),
  open(["GET"], "/forum/similar", { reaches: "forum_topic", trusts: ["session"] }),
  open(["GET"], "/forum/out"),
  open(["GET"], "/forum/media/:media_id", { reaches: "forum_topic", trusts: ["session"] }),
  signedIn(["GET"], "/forum/people", statusOf(401, []), { reaches: "forum_topic", origin: "anywhere", ...JSON_ANSWER }),
  forumPost("/forum/media", statusOf(401, { error: "Sign in to add images." })),
  forumPost("/forum/preview", statusOf(401)),
  signedIn(["GET"], "/forum/new", FORUM_SIGN_IN, { reaches: "forum_topic", origin: "anywhere" }),
  forumPost("/forum/new"),
  signedIn(["GET"], "/forum/messages/new", FORUM_SIGN_IN, { reaches: "forum_topic", origin: "anywhere" }),
  forumPost("/forum/messages/new"),
  open(["GET"], "/forum/:topic_id", { reaches: "forum_topic", trusts: ["session"] }),
  // Back here after signing in for a post: a GET, which goes on to the topic.
  signedIn(["GET"], "/forum/:topic_id/:topic_action", FORUM_SIGN_IN, { reaches: "forum_topic", origin: "anywhere" }),
  forumPost("/forum/:topic_id/:topic_action"),

  // Developer settings, before the dashboard's /dashboard/<game>: settings is no game's slug.
  settings(["GET"], SETTINGS),
  settings(["GET"], `${SETTINGS}/*`),
  ...["credit/top-up", "credit/plan/start", "credit/plan/level", "credit/plan/stop", "credit/refund/:top_up_id", "storage/budget", "storage/budget-off", "games/:slug/:budget_action", "spending/:spending_request_id", "pro/checkout", "pro/refund", "pro/cancel", "pro/resume", "payments/connect", "payments/tax", "payments/disconnect", "webhooks", "webhooks/:webhook_id", "webhooks/:webhook_id/:webhook_action", "sign-in-apps", "sign-in-apps/:sign_in_app_id", "sign-in-apps/:sign_in_app_id/:sign_in_app_action", "keys", "keys/:key_id/remove"].map(settingsForm),

  // The dashboard.
  dashboard(["GET"], "/dashboard", true),
  dashboard(["POST"], "/dashboard/new"),
  dashboard(["GET"], "/dashboard/feedback"),
  dashboard(["GET"], "/dashboard/feedback/:moved_topic_id"),
  dashboard(["GET"], "/dashboard/:slug/export.zip", true),
  dashboard(["GET"], "/dashboard/:slug"),
  dashboard(["GET"], "/dashboard/:slug/*"),
  ...["details", "links", "own-servers", "visibility", "images", "images/:id/remove", "backgrounds", "backgrounds/:screen", "shaders/:id/remove", "glass-tint", "testers", "testers/:id/:tester_action", "delete", "versions/:id/end-previews", "versions/:id/:version_action"].map(gameForm),

  // Zaisma's own people.
  admin("any", "/admin/mcp", "zaisma_settings", "anywhere"),
  adminPage("/admin", "any_game"),
  adminPage("/admin/audit", "zaisma_settings"),
  adminPage("/admin/profiles", "any_account"),
  adminPage("/admin/chat-reviews", "any_account"),
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
  adminForm("/admin/upload", "any_game"),
  adminForm("/admin/api/games", "any_game"),
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
  adminForm("/admin/precedents", "zaisma_settings"),
  adminForm("/admin/precedents/:precedent_id/:precedent_verb", "zaisma_settings"),
  adminForm("/admin/review-precedents/:precedent_id/:review_precedent_verb", "zaisma_settings"),

  // Pages anyone may read.
  open(["GET"], "/developers"),
  open(["GET"], "/developers/covers", { trusts: ["session"] }),
  open(["GET"], "/developers/backgrounds", { trusts: ["session"] }),
  open(["GET"], "/developers/backgrounds/:background_file"),
  open(["GET"], "/design"),
  open(["GET"], "/design/*"),
  open(["GET"], "/legal/:legal_page"),
  open(["GET"], "/sitemap.xml"),
  open(["GET"], "/robots.txt"),
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
