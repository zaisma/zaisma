import type { World } from "../site/access-world.ts";

/**
 * What the owner sends each door on zaisma.com that isn't one API call, so the grid can try it (test/grid/pages.grid.ts). The
 * others send the same, so a refusal can only be the door's. Every row that writes has an entry in PAGE_SAMPLES or OWNER_NOT_PROVEN,
 * or a line in COVERED_ELSEWHERE; test/node/contract-grid.test.ts fails on one with none, so a new door needs one. A row for
 * Zaisma's own people needs none: nobody else gets past the guard, and no door's own code can tell them apart.
 */

/** A world's things as pages name them: test/site/access-world.ts's, and what only a page takes. */
export interface PageWorld extends World {
  pagePathValues: Record<string, string>;
  /** A live game of the owner's, for the doors that only open on one. */
  liveSlug: string;
  liveSaveCopyId: string;
  liveSaveVersionNumber: number;
  newSaveJson: string;
  /** The tag the owner's game page sends with a save, so it can't land on another account. */
  liveSaveTag: string;
  /** A player who asked the owner to be friends. */
  requesterPlayerId: string;
  /** Their public link's name. */
  liveLinkName: string;
  coverFile: File;
  shaderFile: File;
  /** Another player's invite, and the owner's own. */
  strangersInviteCode: string;
  helperPlayerId: string;
  helperUsername: string;
  /** Values only pages may show the owner. */
  privateCanaries: string[];
}

export interface PageSample {
  pathValues?: Record<string, string>;
  /** What the owner names in place of pathValues: a live game, where everyone else tries the draft. */
  ownerPathValues?: Record<string, string>;
  query?: Record<string, string>;
  form?: Record<string, string | string[]>;
  multipart?: Record<string, string | File>;
  jsonBody?: unknown;
  /** The path anyone else sends at a door whose proof is in its path: a token that isn't one. */
  pathValuesWithoutProof?: Record<string, string>;
}

/** Rows the grid tries as something else, and where. */
export const COVERED_ELSEWHERE: Readonly<Record<string, string>> = {
  "POST /api/dev": "API_ROUTES' calls, in test/grid/api.grid.ts: the row is only the router's address.",
  "POST /api/dev/*": "API_ROUTES' calls, in test/grid/api.grid.ts.",
  "POST /mcp": "TOOLS, in test/grid/mcp.grid.ts.",
  "POST /admin/mcp": "ADMIN_TOOLS, in test/grid/mcp.grid.ts.",
};

const onLive = (world: PageWorld): PageSample => ({ ownerPathValues: { slug: world.liveSlug } });
const onLiveWith = (world: PageWorld, more: PageSample): PageSample => ({ ...onLive(world), ...more });

export const PAGE_SAMPLES: Readonly<Record<string, (world: PageWorld) => PageSample>> = {
  // The account page.
  "POST /signout": () => ({}),
  "POST /account/username": (world) => ({ form: { username: `Renamed_${world.n}` } }),
  "POST /account/social": () => ({ form: { social_mode: "solo_focused" } }),
  "POST /account/streamer-mode": () => ({ form: { is_streamer_mode_on: "1" } }),
  "POST /account/color-theme": () => ({ form: { color_theme: "dark" } }),
  "POST /account/delete": () => ({ form: { confirm: "delete" } }),
  "POST /account/where-used-from": () => ({ form: {} }),
  "POST /account/email-ask/skip": () => ({}),
  "POST /account/keys/:key_id/revoke": () => ({}),
  "POST /account/sign-ins/:sign_in_app_id/remove": () => ({}),
  "POST /account/passkeys/:passkey_id/remove": () => ({}),

  // Playing.
  "GET /g/:slug": onLive,
  "GET /g/:slug/rooms": onLive,
  "GET /g/:slug/live-version": onLive,
  "GET /g/:slug/qr-code.svg": onLive,
  "GET /g/:slug/report": onLive,
  "POST /g/:slug/report": (world) => onLiveWith(world, { jsonBody: { reason: "broken", details: "It doesn't load." } }),
  "GET /g/:slug/friends": onLive,
  "GET /g/:slug/players/friends": onLive,
  "GET /t/:tester_token": (world) => ({ pathValuesWithoutProof: { tester_token: "a".repeat(20) }, pathValues: { tester_token: world.pagePathValues.tester_token! } }),
  "POST /t/:tester_token/enter": (world) => ({ pathValuesWithoutProof: { tester_token: "a".repeat(20) }, pathValues: { tester_token: world.pagePathValues.tester_token! }, form: {} }),
  "GET /p/:preview_token": (world) => ({ pathValuesWithoutProof: { preview_token: "not-a-token" }, pathValues: { preview_token: world.pagePathValues.preview_token! } }),
  "POST /api/plays/:slug": (world) => onLiveWith(world, { jsonBody: {} }),
  "POST /api/plays/:slug/account": (world) => onLiveWith(world, { jsonBody: {} }),
  "POST /api/plays/:slug/entry": (world) => ({ jsonBody: {}, ownerPathValues: { slug: world.liveSlug } }),
  "POST /api/links/:slug": (world) => onLiveWith(world, { jsonBody: { link_name: world.liveLinkName } }),
  "POST /api/me/played": (world) => ({ jsonBody: { played: [{ slug: world.liveSlug, played_at_ms: 1 }] } }),
  "POST /api/me/played/:slug": onLive,
  "POST /api/presence": () => ({}),
  "POST /csp-reports": () => ({ jsonBody: { "csp-report": { "document-uri": "https://zaisma.test/", "violated-directive": "script-src" } } }),

  // A player's saves.
  "GET /api/saves/:slug": onLive,
  "GET /api/saves/:slug/copies": onLive,
  "GET /api/saves/:slug/copies/:save_copy_id": (world) => onLiveWith(world, { ownerPathValues: { slug: world.liveSlug, save_copy_id: world.liveSaveCopyId } }),
  "PUT /api/saves/:slug": (world) => onLiveWith(world, { jsonBody: { tag: world.liveSaveTag, save_json: world.newSaveJson, base_version_number: world.liveSaveVersionNumber } }),
  "POST /api/saves/:slug/copies/:save_copy_id/restore": (world) => onLiveWith(world, { ownerPathValues: { slug: world.liveSlug, save_copy_id: world.liveSaveCopyId }, jsonBody: { tag: world.liveSaveTag } }),

  // Buying.
  "POST /api/buy/:slug/start": (world) => onLiveWith(world, { jsonBody: { item_name: "revive" } }),
  "GET /buy/:slug/:item_name": (world) => ({ ownerPathValues: { slug: world.liveSlug, item_name: "revive" } }),

  // Friends and blocks.
  "POST /friends/add": (world) => ({ form: { invite_code: world.strangersInviteCode } }),
  "POST /friends/invites": () => ({}),
  "POST /friends/appear-offline": () => ({ form: { is_appearing_offline: "1" } }),
  "POST /friends/invites/:invite_code/remove": () => ({}),
  "POST /friends/:player_id/remove": (world) => ({ pathValues: { player_id: world.helperPlayerId } }),
  "GET /friends/add/:invite_link_code": (world) => ({ pathValues: { invite_link_code: world.strangersInviteCode } }),
  "POST /friends/add/:invite_link_code": (world) => ({ pathValues: { invite_link_code: world.strangersInviteCode } }),
  "POST /friends/requests": (world) => ({ jsonBody: { player_id: world.values.player_id } }),
  "POST /friends/requests/:player_id/:answer_verb": (world) => ({ pathValues: { player_id: world.requesterPlayerId } }),
  "POST /friends/blocks/:player_id": (world) => ({ jsonBody: {}, pathValues: { player_id: world.values.player_id! } }),
  "POST /friends/blocks/:player_id/remove": (world) => ({ pathValues: { player_id: world.pagePathValues.blocked_player_id! } }),

  // Profiles.
  "POST /:at_username": () => ({ form: {} }),
  "POST /:at_username/edit": () => ({ form: { bio: "Makes games." } }),
  "POST /:at_username/report": (world) => ({ ownerPathValues: { at_username: `@${world.helperUsername}` }, form: { reason: "impersonation" } }),

  // The forum.
  "POST /forum/media": (world) => ({ multipart: { file: world.coverFile } }),
  "POST /forum/preview": () => ({ form: { text_markdown: "A preview." } }),
  "POST /forum/new": (world) => ({ form: { kind: "bug", category: "servers", title: "Rooms drop after a minute", text_markdown: "Every match ends at 60 seconds.", game_slug: world.values.slug! } }),
  "POST /forum/messages/new": () => ({ form: { kind: "question", title: "Rooms drop after a minute", text_markdown: "Every match ends at 60 seconds." } }),
  "POST /forum/:topic_id/:topic_action": () => ({ form: { text_markdown: "It happens on phones too." } }),
  "GET /forum/out": () => ({ query: { to: "https://example.test/" } }),

  // Developer settings.
  "POST /dashboard/settings/credit/top-up": () => ({ form: { amount_cents: "2000" } }),
  "POST /dashboard/settings/credit/plan/start": () => ({ form: { refill_level_dollars: "40" } }),
  "POST /dashboard/settings/credit/plan/level": () => ({ form: { refill_level_dollars: "30" } }),
  "POST /dashboard/settings/credit/plan/stop": () => ({}),
  "POST /dashboard/settings/credit/refund/:top_up_id": () => ({}),
  "POST /dashboard/settings/storage/budget": () => ({ form: { monthly_storage_budget_dollars: "20" } }),
  "POST /dashboard/settings/storage/budget-off": () => ({}),
  "POST /dashboard/settings/games/:slug/:budget_action": () => ({ form: { monthly_budget_dollars: "40" } }),
  "POST /dashboard/settings/spending/:spending_request_id": () => ({ form: { answer: "declined" } }),
  "POST /dashboard/settings/game-deletion/:game_deletion_request_id": () => ({ form: { answer: "declined" } }),
  "POST /dashboard/settings/pro/checkout": () => ({}),
  "POST /dashboard/settings/pro/refund": () => ({}),
  "POST /dashboard/settings/pro/cancel": () => ({}),
  "POST /dashboard/settings/pro/resume": () => ({}),
  "POST /dashboard/settings/payments/connect": () => ({}),
  "POST /dashboard/settings/payments/tax": () => ({ form: { is_stripe_tax_used: "on" } }),
  "POST /dashboard/settings/payments/disconnect": () => ({}),
  "POST /dashboard/settings/webhooks": () => ({ form: { event_kinds: ["bug_reported"], endpoint_url: "https://hooks.example.test/two" } }),
  "POST /dashboard/settings/webhooks/:webhook_id": () => ({ form: { event_kinds: ["bug_reported"], endpoint_url: "https://hooks.example.test/three" } }),
  "POST /dashboard/settings/webhooks/:webhook_id/:webhook_action": () => ({}),
  "POST /dashboard/settings/sign-in-apps": () => ({ form: { name: "Hop Online", kind: "public", redirect_urls: "https://hop.example.test/back" } }),
  "POST /dashboard/settings/sign-in-apps/:sign_in_app_id": () => ({ form: { name: "Hop Online 2", redirect_urls: "https://hop.example.test/back" } }),
  "POST /dashboard/settings/sign-in-apps/:sign_in_app_id/:sign_in_app_action": () => ({}),
  "POST /dashboard/settings/keys/:key_id/remove": () => ({}),

  // The dashboard.
  "POST /dashboard/new": (world) => ({ form: { title: `Moon Base ${world.n}` } }),
  "POST /dashboard/:slug/details": () => ({ form: { title: "Hop Higher", description: "Hop higher." } }),
  "POST /dashboard/:slug/links": () => ({ form: { link_name_0: "site", destination_url_0: "https://example.test/" } }),
  "POST /dashboard/:slug/own-servers": () => ({ form: { own_server_url_0: "https://server.example.test/" } }),
  "POST /dashboard/:slug/visibility": () => ({ form: { visibility: "private" } }),
  "POST /dashboard/:slug/images": (world) => ({ multipart: { file: world.coverFile } }),
  "POST /dashboard/:slug/images/:id/remove": (world) => ({ pathValues: { id: world.values.image_id! } }),
  "POST /dashboard/:slug/backgrounds": (world) => ({ multipart: { file: world.shaderFile, screen: "wide" } }),
  "POST /dashboard/:slug/backgrounds/:screen": (world) => ({ form: { source: "shader", shader_id: world.values.shader_id! } }),
  "POST /dashboard/:slug/shaders/:id/remove": (world) => ({ pathValues: { id: world.values.shader_id! } }),
  "POST /dashboard/:slug/glass-tint": () => ({ form: { glass_tint_color: "#112233" } }),
  "POST /dashboard/:slug/testers": () => ({ form: { name: "Streamers", version_choice: "newest_passed" } }),
  "POST /dashboard/:slug/testers/:id/:tester_action": (world) => ({ pathValues: { id: world.values.tester_id! } }),
  "POST /dashboard/:slug/delete": (world) => ({ form: { confirm_slug: world.values.slug! } }),
  "POST /dashboard/:slug/bring-back": () => ({}),
  "POST /dashboard/:slug/erase-now": () => ({}),
  "POST /dashboard/:slug/versions/:id/end-previews": (world) => ({ pathValues: { id: world.values.version_id! } }),
  "POST /dashboard/:slug/versions/:id/:version_action": (world) => ({ pathValues: { id: world.values.version_id! }, form: { patch_notes: "Faster jumps." } }),

  // Pages that need one of their own names.
  "GET /legal/:legal_page": () => ({ pathValues: { legal_page: "terms" } }),
};

/** A form that does its work without changing anything stored, and why, so the owner's call can't prove itself by a change. */
export const CHANGES_NOTHING: Readonly<Record<string, string>> = {
  "POST /signout": "It ends the session, which Supabase keeps.",
  "POST /forum/preview": "Answers the text as it would show.",
  "POST /account/email-ask/skip": "Remembers it in a cookie.",
  "POST /api/presence": "Says a friend's here, in memory.",
  "POST /:at_username": "A profile's page takes a form only to answer it again.",
  "POST /friends/add": "Sends on to the invite's own page.",
};

/**
 * Doors where the owner's call can't go through here, and where it's tried instead. Everyone else's refusals are still tried.
 * For these the refusal comes from the proof itself, so a bad sample can't be what refused.
 */
export const OWNER_NOT_PROVEN: Readonly<Record<string, string>> = {
  "GET /js/*": "A file by its name, the same for everyone; the build makes the name.",
  "GET /css/*": "A file by its name, the same for everyone; the build makes the name.",
  "GET /img/*": "A served picture: test/site/uploads.test.ts.",
  "GET /whats-on-art/*": "An event's art, Zaisma's own, served to anyone: test/site/whats-on.test.ts.",
  "GET /shaders/*": "A served shader: test/site/backgrounds.test.ts.",
  "GET /shader-checks/*": "A served sheet: test/site/shader-check.test.ts.",
  "POST /github/secret-scanning": "Signed with GitHub's key: test/site/leaked-keys.test.ts.",
  "POST /stripe/events": "Signed with Stripe's secret: test/site/credit.test.ts.",
  "POST /stripe/connect-events": "Signed with Stripe's secret: test/site/buy.test.ts.",
  "POST /api/speed-reports": "A browser's measurements: test/site/performance-check.test.ts.",
  "GET /oauth/authorize": "A sign-in app's own request: test/site/mcp-sign-in.test.ts.",
  "POST /oauth/authorize": "A sign-in app's own request: test/site/mcp-sign-in.test.ts.",
  "GET /oauth/token": "Answers its own 405: test/site/mcp-sign-in.test.ts.",
  "POST /oauth/token": "A real code: test/site/mcp-sign-in.test.ts.",
  "GET /oauth/userinfo": "A real token: test/site/mcp-sign-in.test.ts.",
  "POST /oauth/userinfo": "A real token: test/site/mcp-sign-in.test.ts.",
  "GET /oauth/register": "Answers its own 405: test/site/mcp-sign-in.test.ts.",
  "POST /oauth/register": "A sign-in app's own request: test/site/mcp-sign-in.test.ts.",
  "POST /signin": "A password, through Supabase: test/site/accounts.test.ts.",
  "POST /signin/email": "An email code: test/site/accounts.test.ts.",
  "POST /signin/code": "An email code: test/site/accounts.test.ts.",
  "GET /signin/with/:provider": "An outside provider: test/site/accounts.test.ts.",
  "GET /signin/callback": "An outside provider: test/site/accounts.test.ts.",
  "POST /join/play": "Cloudflare's check on Play: test/site/accounts.test.ts.",
  "POST /api/passkeys/signin": "A real passkey's signature: test/site/accounts.test.ts.",
  "POST /api/account/confirm": "A real passkey's signature or password: test/site/accounts.test.ts.",
  "POST /api/passkeys/tap/options": "Its own confirmation first: test/site/accounts.test.ts.",
  "POST /api/passkeys/add/options": "Its own confirmation first: test/site/accounts.test.ts.",
  "POST /api/passkeys/add": "A real passkey's signature: test/site/accounts.test.ts.",
  "POST /account/password": "Through Supabase: test/site/accounts.test.ts.",
  "POST /account/email": "Through Supabase: test/site/accounts.test.ts.",
  "GET /g/:slug/rooms": "A game with rooms: test/site/multiplayer.test.ts.",
  "POST /api/buy/:slug/start": "A connected Stripe account: test/site/buy.test.ts.",
  "GET /developers/backgrounds/:background_file": "A file by its name: test/site/background-guide.test.ts.",
  "GET /design/*": "The gallery's pages by name: test/site/design.test.ts.",
  "POST /api/plays/:slug/entry": "A game's entry check: test/site/plays.test.ts.",
  "POST /account/confirm": "An email code: test/site/accounts.test.ts.",
  "POST /account/email/code": "An email code: test/site/accounts.test.ts.",
  "POST /account/email/remove": "Only with a password and an email: test/site/accounts.test.ts.",
  "POST /account/security-alerts/seen": "Only with an alert to mark: test/site/security-alerts.test.ts.",
  "POST /dashboard/settings/keys": "A real passkey's signature: test/site/scoped-keys.test.ts.",
  "POST /api/buy/confirm": "A real passkey's signature or a PIN: test/site/buy.test.ts.",
  "GET /api/buy/purchases/:sale_id": "A sale started through Stripe: test/site/buy.test.ts.",
  "POST /api/buy/purchases/:sale_id/pay-with-saved-card": "A sale started through Stripe: test/site/buy.test.ts.",
  "POST /api/buy/purchases/:sale_id/wallet-intent": "A sale started through Stripe: test/site/buy.test.ts.",
  "POST /api/payment-methods/setup": "Through Stripe: test/site/buy.test.ts.",
  "POST /api/payment-methods/saved": "A setup Stripe finished: test/site/buy.test.ts.",
  "DELETE /api/payment-methods/saved": "Only with a saved card: test/site/buy.test.ts.",
  "PUT /api/account/purchase-pin": "A password, through Supabase: test/site/buy.test.ts.",
  "DELETE /api/account/purchase-pin": "Only with a PIN: test/site/buy.test.ts.",
  "POST /api/passkeys/signin/options": "Answers a challenge in a cookie: test/site/accounts.test.ts.",
};

/** Doors that rightly change a row naming the owner's things when someone else calls them, and why. */
export const MAY_TOUCH_OWNER: Readonly<Record<string, string>> = {
  "POST /friends/requests": "A friend request to the owner names them.",
  "POST /friends/blocks/:player_id": "Blocking a player names them.",
  "POST /g/:slug/report": "A report names the game it's about, and a game's address answers the same at any visibility (report.ts).",
  "POST /:at_username/report": "A report names the profile it's about.",
};

/** What the owner's call needs in place first, by the API call the door makes (setUpOwnersCall). */
export const OWNER_SETUP_ROUTES: Readonly<Record<string, string>> = {
  "POST /dashboard/:slug/bring-back": "POST /games/:slug/bring-back",
  "POST /dashboard/:slug/erase-now": "POST /games/:slug/erase-now",
  "POST /dashboard/settings/pro/refund": "POST /pro/refund",
  "POST /dashboard/settings/pro/cancel": "POST /pro/cancel",
  "POST /dashboard/settings/pro/resume": "POST /pro/resume",
  "POST /dashboard/settings/payments/tax": "PATCH /stripe-account",
  "POST /dashboard/settings/payments/disconnect": "DELETE /stripe-account",
};
