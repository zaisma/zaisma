import { ACCOUNT_REQUIREMENTS, ApiError, accountById, CONTENT_RULES, CONTROLS, DEVICES, LINK_LIMITS, MINIMUM_PLAYER_AGES, OWN_SERVER_LIMITS, PLAYER_REPORT_REASONS, PLAY_STYLES, ROOM_BROWSING, SCREENS, type Account, type AccountRequirement, type ContentRule, type MinimumPlayerAge, type PlayerReportReason, type PlayMode, type RoomBrowsing } from "@zaisma/core";
import { currentSession, downloadStartedCookie, realEmail } from "./auth.ts";
import { apiCall, apiResponse, callerFor, GAME_ALERT_KINDS, type Caller, type GameAlertKind } from "./developer.ts";
import { gameUrl, type Env } from "./env.ts";
import { html, layout, metalButton, raw, scriptTags, type Raw } from "./html.ts";
import { shownColor } from "./markup.ts";
import { emailAskBox, isEmailAskDue, securityAlertsBox, type UnseenSecurityAlert } from "./security-alerts.ts";
import { doneByText, eventTitle, whereText } from "./security-log.ts";
import { pageScript } from "./page-scripts.ts";
import { pageStyle } from "./page-styles.ts";
import { SHADER_HELPERS, ZAISMA_SHADER } from "./components/shaders.ts";
import { EDGE } from "./components/foundations.ts";

/**
 * The developer dashboard: your games, and a manager for each one. Every read and every change is a
 * call to the developer API (as the signed-in account), so the dashboard, the MCP and the upload
 * command always agree. Uploads run in the browser against the API directly, file by file.
 */

// The API's answers, as apps/site/src/schemas.ts describes them.
interface ReviewReasonJson {
  code: string;
  message: string;
  content_rule: ContentRule | null;
  fix: string;
}
interface GameJson {
  slug: string;
  page_url: string;
  title: string;
  description: string;
  visibility: "draft" | "listed" | "unlisted" | "private";
  review_status: "pending" | "live" | "held" | "removed";
  review_reason: ReviewReasonJson | null;
  devices: string[];
  controls: string[];
  screen_orientation: string | null;
  play_modes: PlayMode[] | null;
  cloud_saves_enabled: boolean;
  account_offer_enabled: boolean;
  deleted_account_erase_enabled: boolean;
  friend_joins_enabled: boolean;
  multiplayer_mode: "none" | "relay" | "own" | "built-in";
  room_browsing: RoomBrowsing;
  account_requirement: AccountRequirement;
  minimum_player_age_years: MinimumPlayerAge;
  own_server_urls: string[];
  links: LinkJson[];
  details_waiting_for_review: { title: string | null; description: string | null } | null;
  title_listing_reason: ReviewReasonJson | null;
  glass_tint_color: string | null;
  updated_at: string;
}
/** A registered link, as the API answers it (apps/site/src/schemas.ts, LINK). */
interface LinkJson {
  link_name: string;
  destination_url: string;
  is_on_game_page: boolean;
  who_can_open: "everyone" | "signed_in_adults" | "nobody";
  review_reason: ReviewReasonJson | null;
}
/** What needs attention in a game, as list_games and get_game answer it (apps/site/src/developer.ts, gameAlerts). */
interface GameAlertJson {
  kind: string;
  message: string;
  fix: string;
  version_id: string | null;
}
interface ImageJson {
  id: string;
  kind: "cover" | "square" | "screenshot" | "share" | "background" | "phone_background" | "shader_texture";
  review_status: "pending" | "approved" | "rejected";
  review_reason: ReviewReasonJson | null;
  listing_reason: ReviewReasonJson | null;
  size_bytes: number;
  image_url: string;
  created_at: string;
}
/** One of a shader pass's channels (apps/site/src/schemas.ts, SHADER_CHANNEL). */
interface ShaderChannelJson {
  channel_index: number;
  input_kind: "buffer" | "texture";
  buffer_name: "a" | "b" | "c" | "d" | null;
  image_id: string | null;
  filter: "linear" | "nearest";
  wrap: "clamp" | "repeat";
}
/** A background shader, and what each screen shows (apps/site/src/schemas.ts, SHADER and BACKGROUND). */
interface ShaderJson {
  id: string;
  screen: "wide" | "phone";
  review_status: "pending" | "approved" | "rejected";
  review_reason: ReviewReasonJson | null;
  quality_checks: { quality_level: number; check_frame_ms: number; maximum_check_frame_ms: number }[];
  has_quality_levels: boolean;
  flash_count: number | null;
  still_url: string | null;
  frame_urls: string[];
  image: { source_url: string; channels: ShaderChannelJson[] };
  buffers: { buffer_name: "a" | "b" | "c" | "d"; source_url: string; channels: ShaderChannelJson[] }[];
  buffer_count: number;
  texture_count: number;
  texture_image_ids: string[];
  created_at: string;
}
interface BackgroundJson {
  screen: "wide" | "phone";
  source: "zaisma" | "image" | "shader" | "wide";
  image_id: string | null;
  shader_id: string | null;
  still_url: string | null;
}
interface VersionJson {
  id: string;
  file_count: number;
  size_bytes: number;
  scan_status: "scanning" | "held" | "approved" | "rejected";
  is_live: boolean;
  patch_notes: string;
  preview_url: string | null;
  preview_url_expires_at: string | null;
  published_at: string | null;
  scheduled_publish_at: string | null;
  created_at: string;
  review_reason: ReviewReasonJson | null;
  findings: (ReviewReasonJson & { severity: "reject" | "hold"; path: string | null })[];
  replaced_by_version_id: string | null;
  performance_check: PerformanceCheckJson | null;
}
interface PerformanceCheckJson {
  check_status: "waiting" | "checking" | "checked" | "over_daily_limit" | "could_not_run";
  loading_duration_sec: number | null;
  start_download_size_bytes: number | null;
  start_memory_size_bytes: number | null;
  notes: { code: string; message: string; path: string | null; fix: string }[];
}

const VISIBILITY: Record<GameJson["visibility"], { label: string; hint: string }> = {
  listed: { label: "Everyone", hint: "On Zaisma for everyone to find" },
  unlisted: { label: "Link only", hint: "Anyone with the link can play; it's never listed" },
  private: { label: "Only me", hint: "Only you and your testers, through preview and tester links" },
  draft: { label: "Draft", hint: "Not ready yet; only you and your testers, through preview and tester links" },
};
const REVIEW: Record<GameJson["review_status"], string> = { pending: "Not live yet", live: "Live", held: "Held", removed: "Taken down" };
const DEVICE_LABELS: Record<string, string> = { phone: "Phone", tablet: "Tablet", computer: "Computer" };
const CONTROL_LABELS: Record<string, string> = { touch: "Touch", keyboard_mouse: "Keyboard and mouse", gamepad: "Gamepad" };
const SCREEN_LABELS: Record<string, string> = { "": "Not set", portrait: "Portrait", landscape: "Landscape", either: "Either way" };
const ROOM_BROWSING_LABELS: Record<RoomBrowsing, { label: string; hint: string }> = {
  page: { label: "On the game page and in the game", hint: "Players see open rooms on your game's page and can jump in. Your game can list them too, with Zaisma.rooms.list()." },
  game: { label: "Only in the game", hint: "For games with their own lobby or server browser: your game lists rooms with Zaisma.rooms.list(), and the game page doesn't." },
  off: { label: "Off", hint: "No room is listed anywhere. Room codes and invite links still work." },
};
const ACCOUNT_REQUIREMENT_LABELS: Record<AccountRequirement, { label: string; hint: string }> = {
  none: { label: "Not needed", hint: "Guests play everything. Signed-in players play as their Zaisma account." },
  multiplayer: { label: "Accounts for multiplayer", hint: "Guests play alone. Only signed-in players get player passes, so your game shows its own message when a guest tries to play online." },
  whole_game: { label: "Accounts only", hint: "Your game page says \"Needs a Zaisma account\", and Play asks guests to sign in first." },
};
const DONE: Record<string, string> = {
  made: "Your game is made. Upload a version below.",
  uploaded: "Uploaded. The scan usually takes under a minute; refresh to see the result.",
  details: "Details saved.",
  links: "Links saved.",
  "own-servers": "Servers saved. Players connect from their next visit, and the game's menu names them.",
  "multiplayer-no-file": "Saved, but your live version's game server can't run yet. Publish a version with a zaisma-server/ folder (index.js first) or a zaisma-server.js, up to 5 MB.",
  "details-review": "Saved. The new title or description shows once it's reviewed.",
  visibility: "Visibility changed.",
  image: "Image added. It shows on the game page once it's reviewed.",
  "image-removed": "Image removed.",
  "background-sent": "Sent. It's checked in about a minute; refresh to see it here, then choose it.",
  "background-chosen": "Background changed. It shows on the home and your game page now.",
  "shader-removed": "Shader removed.",
  tint: "Glass tint saved.",
  published: "Published. Players get this version now.",
  scheduled: "Scheduled.",
  unscheduled: "It won't be published by itself.",
  "tester-added": "Tester link made. Copy it below and send it to your testers.",
  "tester-removed": "Tester link turned off. It stopped working straight away, and its testers leave their multiplayer matches within 10 seconds.",
  "tester-changed": "Tester link changed. Its testers keep the same link and their progress.",
  "previews-ended": "Every preview link for that version handed out so far stopped working. The Preview button has a fresh one.",
};

export async function handleDashboard(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== "/dashboard" && !path.startsWith("/dashboard/")) return null;
  const post = request.method === "POST";
  if (post && request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });

  const session = await currentSession(request, env);
  if (!session) return redirect(`/signin?next=${encodeURIComponent(path)}`, []);
  const caller = await callerFor(env, request, session.userId, session.cookies);
  if (!caller) return redirect("/join?next=/dashboard", session.cookies);
  const call = (method: string, apiPath: string, body?: unknown) => apiCall(env, caller, method, apiPath, body);
  const done = (response: Response) => withCookies(response, session.cookies);
  const url = new URL(request.url);

  // The header shows the account; the games page also shows security alerts no email told them about, and asks for an email once there's something to lose.
  const account = await accountById(env.DB, caller.accountId);
  const isAskingForEmail = async () => (account ? isEmailAskDue(env, account, realEmail(session.email)) : false);
  if (path === "/dashboard" && !post) return done(await gamesPage(env, call, account, url.searchParams.get("error") ?? undefined, "", await isAskingForEmail()));
  // Feedback moved into the developer forum.
  if (path === "/dashboard/feedback") return done(redirect("/forum?tab=yours"));
  const moved = path.match(/^\/dashboard\/feedback\/(?:topic_)?([a-z0-9]{1,40})$/);
  if (moved) return done(redirect(`/forum/topic_${moved[1]}`));
  if (path === "/dashboard/new" && post) {
    const form = await request.formData();
    try {
      const { game } = (await call("POST", "/games", { title: String(form.get("title") ?? "") })) as { game: GameJson };
      return done(redirect(`/dashboard/${game.slug}?done=made`));
    } catch (error) {
      if (error instanceof ApiError) return done(await gamesPage(env, call, account, error.messageWithFix, String(form.get("title") ?? ""), await isAskingForEmail()));
      throw error;
    }
  }

  const pathMatch = path.match(/^\/dashboard\/([a-z0-9-]+)(\/.*)?$/);
  if (!pathMatch) return null;
  const slug = pathMatch[1]!;
  const action = pathMatch[2] ?? "";
  const back = (section: Section, key: string, hash = "") => done(redirect(`${sectionPath(slug, section)}?done=${key}${hash}`));

  // Export everything: the .zip, made as it downloads (game-export.ts), through the same API call as zaisma export.
  if (!post && action === "/export.zip") {
    try {
      const exported = await apiResponse(env, caller, `/games/${slug}/export/download`);
      // The button's spinner stops when this arrives: the browser's own download takes over (html.ts, BUSY_SCRIPT).
      exported.headers.append("Set-Cookie", downloadStartedCookie(env));
      return done(exported);
    } catch (error) {
      if (error instanceof ApiError) return done(await managerPage(env, call, account, slug, "details", { error: error.messageWithFix }, error.httpStatus));
      throw error;
    }
  }

  if (!post) {
    const section = SECTIONS.find((each) => (each.path ? `/${each.path}` : "") === action);
    if (!section) return done(redirect(`/dashboard/${slug}`));
    return done(await managerPage(env, call, account, slug, section.id, { done: DONE[url.searchParams.get("done") ?? ""] }));
  }

  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  // A change comes back to the section its form is in, which a form says when it's on more than one.
  const sectionOfAction: Section =
    SECTIONS.find((each) => each.id === field("section"))?.id ??
    (action === "/details" || action === "/links" || action === "/own-servers" || action.startsWith("/images") || action.startsWith("/backgrounds") || action.startsWith("/shaders") || action === "/glass-tint" ? "details" : action.startsWith("/testers") || action.startsWith("/versions/") ? "versions" : "overview");
  try {
    if (action === "/details") {
      const saved = (await call("PATCH", `/games/${slug}`, {
        title: field("title"),
        description: field("description"),
        devices: form.getAll("devices").map(String),
        controls: form.getAll("controls").map(String),
        screen_orientation: field("screen") || null,
        play_modes: playModesFrom(form),
        cloud_saves_enabled: form.get("cloud_saves") === "on",
        account_offer_enabled: form.get("account_offer") === "on",
        deleted_account_erase_enabled: form.get("deleted_account_erase") === "on",
        ...(form.has("room_browsing") ? { room_browsing: field("room_browsing") } : {}),
        // Only when the Join switch was on the form: a game without rooms doesn't show it.
        ...(form.has("friend_joins_shown") ? { friend_joins_enabled: form.get("friend_joins") === "on" } : {}),
        ...(form.has("account_requirement") ? { account_requirement: field("account_requirement") } : {}),
        // A game for 16 or 18 and up is accounts only, so choosing one sets Zaisma accounts too.
        ...(form.has("minimum_player_age_years") ? { minimum_player_age_years: Number(field("minimum_player_age_years")) } : {}),
        ...(Number(field("minimum_player_age_years")) > 13 ? { account_requirement: "whole_game" } : {}),
        ...(form.has("multiplayer") ? { multiplayer_mode: field("multiplayer") } : {}),
      })) as { review_message: string | null; game_server_problem: string | null };
      if (saved.game_server_problem) return back("details", "multiplayer-no-file");
      return back("details", saved.review_message ? "details-review" : "details");
    }
    if (action === "/links") {
      // One row per link, numbered; a row left empty is no link.
      const links = Array.from({ length: LINK_LIMITS.maximumLinkCount }, (_, i) => ({ link_name: field(`link_name_${i}`), destination_url: field(`destination_url_${i}`), is_on_game_page: form.get(`is_on_game_page_${i}`) === "on" })).filter(
        (link) => link.link_name || link.destination_url,
      );
      await call("PATCH", `/games/${slug}`, { links });
      return back("details", "links", "#links");
    }
    if (action === "/own-servers") {
      const ownServerUrls = Array.from({ length: OWN_SERVER_LIMITS.maximumServerCount }, (_, i) => field(`own_server_url_${i}`)).filter(Boolean);
      await call("PATCH", `/games/${slug}`, { own_server_urls: ownServerUrls });
      return back("details", "own-servers", "#own-servers");
    }
    if (action === "/visibility") {
      const visibility = field("visibility");
      const { game } = (await call("GET", `/games/${slug}`)) as { game: GameJson };
      const hiding = (visibility === "private" || visibility === "draft") && (game.visibility === "listed" || game.visibility === "unlisted") && game.review_status === "live";
      if (hiding && field("confirm") !== "yes") return done(await managerPage(env, call, account, slug, sectionOfAction, { confirmHide: visibility as GameJson["visibility"] }));
      await call("PATCH", `/games/${slug}`, { visibility });
      return back(sectionOfAction, "visibility");
    }
    if (action === "/images") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new ApiError("no_file", { message: "No image was chosen.", field: "file", fix: "Choose an image first." });
      const kind = (["screenshot", "square", "share"] as const).find((choice) => choice === field("kind")) ?? "cover";
      await call("POST", `/games/${slug}/images?kind=${kind}`, new Uint8Array(await file.arrayBuffer()));
      return back("details", "image", "#images");
    }
    if (action === "/backgrounds") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new ApiError("no_file", { message: "No picture or shader file was chosen.", field: "file", fix: "Choose a picture (PNG, JPEG or WebP) or a .glsl shader first." });
      const screen = field("screen") === "phone" ? "phone" : "wide";
      const bytes = new Uint8Array(await file.arrayBuffer());
      // A shader is text; anything else is sent as a picture, and the API says what it isn't.
      // A one-pass shader file is its image pass.
      if (/\.(glsl|frag|txt)$/i.test(file.name) || file.type.startsWith("text/")) await call("POST", `/games/${slug}/shaders`, { screen, image: { source: new TextDecoder().decode(bytes) } });
      else await call("POST", `/games/${slug}/images?kind=${screen === "phone" ? "phone_background" : "background"}`, bytes);
      return back("details", "background-sent", "#background");
    }
    const backgroundPath = action.match(/^\/backgrounds\/(wide|phone)$/);
    if (backgroundPath) {
      const source = field("source");
      await call("PUT", `/games/${slug}/backgrounds/${backgroundPath[1]}`, { source, ...(source === "image" ? { image_id: field("image_id") } : {}), ...(source === "shader" ? { shader_id: field("shader_id") } : {}) });
      return back("details", "background-chosen", "#background");
    }
    const shaderPath = action.match(/^\/shaders\/([a-z0-9_]+)\/remove$/);
    if (shaderPath) {
      await call("DELETE", `/games/${slug}/shaders/${shaderPath[1]}`);
      return back("details", "shader-removed", "#background");
    }
    if (action === "/glass-tint") {
      await call("PATCH", `/games/${slug}`, { glass_tint_color: form.get("clear") ? null : field("glass_tint_color") });
      return back("details", "tint", "#background");
    }
    const imagePath = action.match(/^\/images\/([a-z0-9_]+)\/remove$/);
    if (imagePath) {
      await call("DELETE", `/games/${slug}/images/${imagePath[1]}`);
      return back("details", "image-removed", "#images");
    }
    if (action === "/testers") {
      await call("POST", `/games/${slug}/testers`, { name: field("name"), ...testerChoicesFrom(field), ...(field("at") ? { ends_at: field("at") } : {}) });
      return back("versions", "tester-added", "#testers");
    }
    const tester = action.match(/^\/testers\/([a-z0-9_]+)\/(remove|change)$/);
    if (tester?.[2] === "remove") {
      await call("DELETE", `/games/${slug}/testers/${tester[1]}`);
      return back("versions", "tester-removed", "#testers");
    }
    if (tester?.[2] === "change") {
      await call("PATCH", `/games/${slug}/testers/${tester[1]}`, { name: field("name"), ...testerChoicesFrom(field), ends_at: field("at") || null });
      return back("versions", "tester-changed", "#testers");
    }
    const previewsPath = action.match(/^\/versions\/([a-z0-9_]+)\/end-previews$/);
    if (previewsPath) {
      await call("DELETE", `/games/${slug}/versions/${previewsPath[1]}/preview-links`);
      return back(sectionOfAction, "previews-ended");
    }
    const versionPath = action.match(/^\/versions\/([a-z0-9_]+)\/(publish|schedule|unschedule)$/);
    if (versionPath) {
      const [, id, what] = versionPath;
      // "Update running games now": live matches switch now instead of at their next match.
      const matchUpdate = field("match_update_mode") === "now" ? { match_update_mode: "now" } : {};
      if (what === "publish") await call("POST", `/games/${slug}/versions/${id}/publish`, matchUpdate);
      if (what === "schedule") await call("POST", `/games/${slug}/versions/${id}/publish`, { scheduled_publish_at: field("at"), ...matchUpdate });
      if (what === "unschedule") await call("DELETE", `/games/${slug}/versions/${id}/publish`);
      return back(sectionOfAction, what === "publish" ? "published" : `${what}d`);
    }
  } catch (error) {
    if (error instanceof ApiError) return done(await managerPage(env, call, account, slug, sectionOfAction, { error: error.messageWithFix }, error.httpStatus));
    throw error;
  }
  return done(redirect(`/dashboard/${slug}`));
}

/** A tester link form's version choice, as the API's version_choice and picked_version_id: "live", "newest_passed" or a version's ID. */
function testerChoicesFrom(field: (name: string) => string): { version_choice: string; picked_version_id?: string } {
  const opens = field("opens");
  return opens === "live" || opens === "newest_passed" || !opens ? { version_choice: opens || "live" } : { version_choice: "picked", picked_version_id: opens };
}

/** The Players fields of the details form, as the API's play_modes. Nothing ticked clears it. */
function playModesFrom(form: FormData): PlayMode[] | null {
  const modes: PlayMode[] = [];
  if (form.get("single") === "on") modes.push({ mode: "single", minimum_player_count: null, maximum_player_count: null, play_style: null });
  for (const mode of ["local", "online"] as const) {
    if (form.get(mode) !== "on") continue;
    const maximumText = String(form.get(`${mode}_maximum_player_count`) ?? "").trim();
    modes.push({ mode, minimum_player_count: Number(form.get(`${mode}_minimum_player_count`) || 2), maximum_player_count: maximumText ? Number(maximumText) : null, play_style: String(form.get(`${mode}_play_style`) ?? "co-op") as PlayMode["play_style"] });
  }
  return modes.length ? modes : null;
}

export type Call = (method: string, path: string, body?: unknown) => Promise<Record<string, unknown>>;

export function redirect(to: string, cookies: string[] = []): Response {
  const response = new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

function withCookies(response: Response, cookies: string[]): Response {
  if (!cookies.length) return response;
  const withAll = new Response(response.body, response);
  for (const cookie of cookies) withAll.headers.append("Set-Cookie", cookie);
  return withAll;
}

export function page(env: Env, title: string, body: Raw, httpStatus = 200, account?: Account | null): Response {
  const rendered = layout(env, { title: `${title} · Zaisma`, body: html`${body}${scriptTags(LOCAL_TIMES_SCRIPT)}`, steelStyles: [DASHBOARD_STYLE], isPrivate: true, nav: "developer", viewer: account === undefined ? undefined : { account } });
  return new Response(rendered.body, { status: httpStatus, headers: rendered.headers });
}

export const notice = (messages: { done?: string; error?: string }) =>
  messages.error ? html`<p class="error" role="alert">${messages.error}</p>` : messages.done ? html`<p class="done" role="status">${messages.done}</p>` : "";

/** A time, from the API (ISO) or the database (milliseconds), shown in the reader's own time zone. */
export const when = (instant: string | number) => html`<time datetime="${new Date(instant).toISOString()}" data-local>${new Date(instant).toISOString().slice(0, 16).replace("T", " ")} UTC</time>`;

const sizeText = (sizeBytes: number) => (sizeBytes >= 1024 ** 3 ? `${(sizeBytes / 1024 ** 3).toFixed(1)} GB` : sizeBytes >= 1048576 ? `${(sizeBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(sizeBytes / 1024))} KB`);

function coverOf(images: ImageJson[]): ImageJson | undefined {
  const covers = images.filter((i) => i.kind === "cover" && i.review_status !== "rejected");
  return covers.find((i) => i.review_status === "approved") ?? covers[0];
}

// --- Your games ---

async function gamesPage(env: Env, call: Call, account: Account | null, error?: string, title = "", isAskingForEmail = false): Promise<Response> {
  const [{ games: listedGames, unread_topic_count: unreadTopicCount }, { can_publish: canPublish }, { unseen_security_alerts: unseenSecurityAlerts }] = (await Promise.all([call("GET", "/games"), call("GET", "/access"), call("GET", "/activity")])) as [
    { games: (GameJson & { alerts: GameAlertJson[] })[]; unread_topic_count: number },
    { can_publish: boolean },
    { unseen_security_alerts: UnseenSecurityAlert[] },
  ];
  // Games that need attention first, the most urgent first (a kind this page doesn't know after the known ones); the rest keep the API's order, last changed first.
  const urgency = (game: { alerts: GameAlertJson[] }) => (game.alerts.length ? Math.min(...game.alerts.map((alert) => GAME_ALERT_KINDS.indexOf(alert.kind as GameAlertKind) >>> 0)) : Infinity);
  const games = [...listedGames].sort((first, second) => urgency(first) - urgency(second));
  const details = await Promise.all(games.map((game) => call("GET", `/games/${game.slug}`) as Promise<{ images: ImageJson[]; versions: VersionJson[] }>));
  const make = html`<form class="make" method="post" action="/dashboard/new">
<input name="title" maxlength="80" required placeholder="Your game's name" aria-label="Your game's name" value="${title}">
${metalButton("Make a game", { type: "submit" })}
</form>`;
  // Developer settings takes this place when it lands; until then API keys are all there is.
  const settings = html`<a class="btn ghost" href="/account#developer">API keys</a>`;
  return page(
    env,
    "Your games",
    html`<div class="dash-head"><h1>Your games</h1><div class="dash-actions">${canPublish ? make : ""}${settings}</div></div>
${notice({ error })}
${securityAlertsBox(unseenSecurityAlerts, "/dashboard")}
${isAskingForEmail ? emailAskBox({ isConfirmed: false, backTo: "/dashboard" }) : ""}
${unreadTopicCount ? html`<p class="done" role="status">Zaisma replied to ${unreadTopicCount === 1 ? "one of your forum topics" : `${unreadTopicCount} of your forum topics`}. <a href="/forum?tab=yours">Read ${unreadTopicCount === 1 ? "it" : "them"}</a></p>` : ""}
${canPublish
      ? ""
      : html`<div class="first note"><p><strong>Publishing opens with the beta.</strong> Until then, only accounts Zaisma adds can make games. You can still play, keep your progress, add friends and talk in the forum.</p></div>`}
${games.length
      ? html`<div class="grid">${games.map((game, i) => {
          const cover = coverOf(details[i]!.images);
          const live = details[i]!.versions.find((version) => version.is_live);
          const waitingDraftCount = details[i]!.versions.filter((version) => !version.is_live && version.scan_status === "approved" && !version.published_at).length;
          return html`<div class="hit block"><div class="tile">
<a class="pic" href="/dashboard/${game.slug}" tabindex="-1" aria-hidden="true">${cover ? html`<img src="${cover.image_url}" alt="" loading="lazy">` : ""}</a>
<div class="body"><a class="name" href="/dashboard/${game.slug}"><span>${game.title}</span><small>${VISIBILITY[game.visibility].label} · ${REVIEW[game.review_status]}${live ? "" : " · no live version"}</small></a>
${waitingDraftCount ? html`<span class="badge">${waitingDraftCount === 1 ? "Draft ready" : `${waitingDraftCount} drafts ready`}</span>` : ""}</div>
${game.alerts.length ? html`<ul class="alerts" aria-label="Needs attention">${game.alerts.map((alert) => html`<li class="${alert.kind === "game_removed" || alert.kind === "game_held" || alert.kind === "version_rejected" ? "urgent" : ""}">${alert.message}</li>`)}</ul>` : ""}
</div></div>`;
        })}</div>`
      : canPublish
        ? html`<div class="first note"><p><strong>No games yet.</strong> Give your game a name above, then upload its folder. A game is any folder with an index.html at the top: an HTML game, or a web export from Godot, Unity, Phaser or any other engine.</p></div>`
        : ""}
${canPublish
      ? html`<h2 class="rule-h">Work from your AI or terminal</h2>
<div class="ways">
<div class="way"><h3>Your AI</h3><p class="muted">Claude Code, Cursor or any tool that takes MCP servers can make, upload and publish games for you.</p>
<pre>claude mcp add --transport http -s user zaisma ${env.SITE_ORIGIN}/mcp --header "Authorization: Bearer $ZAISMA_KEY"</pre></div>
<div class="way"><h3>Your terminal</h3><p class="muted">Upload a build folder; only changed files are sent.</p>
<pre>npx @zaisma/cli upload ./build --game your-game</pre></div>
</div>
<p class="muted">Both need an API key: <a href="/account#developer">make one on your account page</a> and set it as ZAISMA_KEY.</p>`
      : ""}`,
    200,
    account,
  );
}

// --- One game ---

/**
 * Each game's dashboard is split into sections, each with its own page and a fixed layout
 * (docs/DECISIONS.md, "The dashboard is three kinds of page"). The title and who can play sit on every one.
 */
export type Section = "overview" | "versions" | "details" | "players" | "database";
const SECTIONS: { id: Section; path: string; name: string }[] = [
  { id: "overview", path: "", name: "Overview" },
  { id: "versions", path: "versions", name: "Versions" },
  { id: "details", path: "details", name: "Details" },
  { id: "players", path: "players", name: "Players and stats" },
  { id: "database", path: "database", name: "Database" },
];
const sectionPath = (slug: string, section: Section) => `/dashboard/${slug}${section === "overview" ? "" : `/${section}`}`;
/** Sends a change back to the section its form is in, for forms that show on more than one. */
const sectionField = (section: Section) => html`<input type="hidden" name="section" value="${section}">`;

interface HistoryJson {
  events: {
    description: string;
    version_id: string | null;
    subject_name: string | null;
    done_by: "you" | "api_key" | "ai" | "zaisma";
    api_key_name: string | null;
    device: string | null;
    network_name: string | null;
    city_name: string | null;
    region_name: string | null;
    country_code: string | null;
    is_new_place: boolean;
    occurrence_count: number;
    happened_at: string;
    review_reason: ReviewReasonJson | null;
  }[];
}
interface DatabaseJson {
  tables: { name: string; sql: string }[];
  indexes: { name: string; table_name: string; sql: string }[];
  database_use_this_month: {
    read_row_count: number;
    written_row_count: number;
    storage_size_bytes: number;
    maximum_storage_size_bytes: number;
  };
}
type Loaded = { game: GameJson; alerts: GameAlertJson[]; images: ImageJson[]; backgrounds: BackgroundJson[]; shaders: ShaderJson[]; versions: VersionJson[]; testers: TesterJson[] };

async function managerPage(
  env: Env,
  call: Call,
  account: Account | null,
  slug: string,
  section: Section,
  options: { done?: string; error?: string; confirmHide?: GameJson["visibility"] },
  httpStatus = 200,
): Promise<Response> {
  let loaded: Loaded;
  try {
    loaded = (await call("GET", `/games/${slug}`)) as Loaded;
  } catch (error) {
    if (error instanceof ApiError && error.httpStatus === 404) return page(env, "Game not found", html`<h1>Game not found</h1><p class="lead">${error.message}</p><a class="btn ghost" href="/dashboard">Your games</a>`, 404, account);
    throw error;
  }
  const { game, images } = loaded;
  const cover = coverOf(images);
  const removed = game.review_status === "removed";
  const name = SECTIONS.find((each) => each.id === section)!.name;

  let body: Raw;
  if (section === "overview") {
    const [stats, history] = await Promise.all([call("GET", `/games/${slug}/stats?period_duration_days=30`), call("GET", `/games/${slug}/history`)]);
    body = overviewSection(slug, loaded, stats as unknown as Stats, history as unknown as HistoryJson);
  } else if (section === "versions") {
    body = versionsSection(slug, loaded);
  } else if (section === "details") {
    body = detailsSection(slug, loaded, (await call("GET", `/games/${slug}/qr-code`)) as unknown as QrCodeJson, gameUrl(env, slug));
  } else if (section === "players") {
    const [reports, stats] = await Promise.all([call("GET", `/games/${slug}/reports`), call("GET", `/games/${slug}/stats?period_duration_days=30`)]);
    body = playersSection(game, reports as unknown as Reports, stats as unknown as Stats);
  } else {
    let database: DatabaseJson | string;
    try {
      database = (await call("GET", `/games/${slug}/database`)) as unknown as DatabaseJson;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      database = error.messageWithFix;
    }
    body = databaseSection(slug, database);
  }

  return page(
    env,
    section === "overview" ? game.title : `${name} · ${game.title}`,
    html`<p class="crumbs"><a href="/dashboard">Your games</a></p>
<div class="game-head">
<div class="cover pic bevel">${cover ? html`<img src="${cover.image_url}" alt="">` : ""}</div>
<div class="who">
<h1>${game.title}</h1>
<p class="muted"><span class="pill ${game.review_status}">${REVIEW[game.review_status]}</span> ${game.visibility === "listed" || game.visibility === "unlisted" ? html`<a href="${game.page_url}">${game.page_url.replace(/^https?:\/\//, "")}</a>` : html`zaisma.com/g/${game.slug}`}</p>
</div>
<form class="vis" method="post" action="/dashboard/${slug}/visibility" aria-label="Who can play">${sectionField(section)}
<div class="seg">${(["listed", "unlisted", "private", "draft"] as const).map(
      (visibility) => html`<button name="visibility" value="${visibility}" title="${VISIBILITY[visibility].hint}" aria-pressed="${game.visibility === visibility}"${removed ? raw(" disabled") : ""}>${VISIBILITY[visibility].label}</button>`,
    )}</div>
<p class="hint">${VISIBILITY[game.visibility].hint}.</p>
</form>
</div>
<div class="game-dash">
<nav class="sections" aria-label="${game.title}">${SECTIONS.map((each) => html`<a href="${sectionPath(slug, each.id)}"${each.id === section ? raw(' aria-current="page"') : ""}>${each.name}</a>`)}</nav>
<div class="section-body">
${options.confirmHide
      ? html`<div class="note confirm" role="alert"><p><strong>Players can play ${game.title} now.</strong> ${options.confirmHide === "draft" ? "Making it a draft" : "Making it private"} takes it away from them, and its link stops working.</p>
<form class="row" method="post" action="/dashboard/${slug}/visibility"><input type="hidden" name="visibility" value="${options.confirmHide}"><input type="hidden" name="confirm" value="yes">${sectionField(section)}
<button class="btn danger" type="submit">Hide it from players</button><a class="btn ghost" href="${sectionPath(slug, section)}">Keep it</a></form></div>`
      : ""}
${game.review_reason ? html`<div class="note held-game" role="status">${reasonPanel(slug, game.review_reason, removed ? "Zaisma took this game down." : "Players can't open this game right now.")}</div>` : ""}
${notice(options)}
${body}
</div>
</div>`,
    httpStatus,
    account,
  );
}

/** Where on the dashboard each kind of alert is dealt with. A kind this page doesn't know shows its message alone. */
const ALERT_PLACES: Partial<Record<GameAlertKind, { section: Section; hash: string; label: string }>> = {
  version_rejected: { section: "versions", hash: "", label: "See why" },
  version_held: { section: "versions", hash: "", label: "See why" },
  hosting_paused: { section: "players", hash: "#hosting", label: "Hosting" },
  database_full: { section: "database", hash: "", label: "Database" },
  hosting_nearly_paused: { section: "players", hash: "#hosting", label: "Hosting" },
  hosting_budget_nearly_used: { section: "players", hash: "#hosting", label: "Hosting" },
  database_nearly_full: { section: "database", hash: "", label: "Database" },
  reports_open: { section: "players", hash: "#reports", label: "See them" },
  link_flagged: { section: "details", hash: "#links", label: "Links" },
  game_off_lists: { section: "details", hash: "#images", label: "Images" },
};

/**
 * What needs the developer, as get_game answers it, each linked to the section it's dealt with in.
 * A held or taken-down game already has its own panel on every section, and the latest upload its card.
 */
function alertsPanel(slug: string, alerts: GameAlertJson[], shownVersionId: string | null): Raw | "" {
  const shown = alerts.filter((alert) => alert.kind !== "game_removed" && alert.kind !== "game_held" && !(alert.version_id && alert.version_id === shownVersionId));
  if (!shown.length) return "";
  return html`<ul class="game-alerts" aria-label="Needs attention">${shown.map((alert) => {
    const place = ALERT_PLACES[alert.kind as GameAlertKind];
    return html`<li class="note">${alert.version_id ? html`<strong>${alert.version_id.slice(0, 16)}</strong> ` : ""}${alert.message}${place ? html` <a href="${sectionPath(slug, place.section)}${place.hash}">${place.label}</a>` : ""}</li>`;
  })}</ul>`;
}

/** Status, what needs you, a new upload, the live version, plays and what happened lately. */
function overviewSection(slug: string, { game, alerts, versions }: Loaded, stats: Stats, history: HistoryJson): Raw {
  const live = versions.find((version) => version.is_live) ?? null;
  // The newest upload, when it isn't live yet: scanning, ready to publish, or held back with why.
  const newest = versions.find((version) => !version.is_live && (!live || version.created_at > live.created_at)) ?? null;
  const playStats = stats.play_stats;
  const recent = history.events.slice(0, 5);
  const earlier = history.events.slice(5);
  const event = (each: HistoryJson["events"][number]) => {
    const where = whereText(each);
    return html`<li><span>${eventTitle(each)}${each.review_reason ? html` <span class="muted">${each.review_reason.message}</span>` : ""}</span><span class="muted">${when(each.happened_at)} · ${doneByText(each)}${where ? ` · ${where}` : ""}${each.is_new_place ? html` <span class="badge">New place</span>` : ""}</span></li>`;
  };
  return html`${alertsPanel(slug, alerts, newest?.id ?? null)}
<div class="overview">
<section>
${game.review_status === "removed" ? "" : uploadPanel(slug)}
${newest ? html`<h2 class="rule-h">Latest upload</h2><ol class="track">${versionRow(slug, newest, "overview")}</ol>` : ""}
<h2 class="rule-h">Live version</h2>
${live ? html`<ol class="track">${versionRow(slug, live, "overview")}</ol>` : html`<p class="muted">Nothing is live yet. Upload your game's folder above; once it passes the scan, publish it.</p>`}
<p class="hint"><a href="/dashboard/${slug}/versions">Every version</a>, rolling back and tester links are in Versions.</p>
</section>
<aside>
<h2 class="rule-h">Plays <span class="muted">Last 30 days</span></h2>
${playStats.play_count
      ? html`<div class="numbers compact">
<div class="num plate"><strong>${formatted(playStats.play_count)}</strong><span>Plays</span></div>
<div class="num plate"><strong>${formatted(playStats.new_player_count)}</strong><span>New players</span></div>
<div class="num plate"><strong>${playStats.average_play_duration_min === null ? "–" : `${playStats.average_play_duration_min} min`}</strong><span>Per play</span></div>
<div class="num plate"><strong>${playStats.came_back.after_1_day.returned_pct === null ? "–" : `${playStats.came_back.after_1_day.returned_pct}%`}</strong><span>Back the next day</span></div>
</div>`
      : html`<p class="muted">No counted plays yet${playStats.started_play_count ? html` (${formatted(playStats.started_play_count)} started in all)` : ""}.</p>`}
<p class="hint"><a href="/dashboard/${slug}/players">Players and stats</a> has day by day, reports and multiplayer use.</p>
<h2 class="rule-h">Recent history</h2>
${recent.length ? html`<ul class="history">${recent.map(event)}</ul>` : html`<p class="muted">Nothing yet.</p>`}
${earlier.length ? html`<details class="later"><summary>Earlier</summary><ul class="history">${earlier.map(event)}</ul></details>` : ""}
</aside>
</div>`;
}

/** Every version with what to do with it, then the tester links. */
function versionsSection(slug: string, { game, versions, testers }: Loaded): Raw {
  return html`${game.review_status === "removed" ? "" : uploadPanel(slug)}
<h2 class="rule-h" id="versions">Versions</h2>
${versions.length ? html`<ol class="track">${versions.map((version) => versionRow(slug, version, "versions"))}</ol>` : html`<p class="muted">No versions yet. Every upload becomes a version here: it's scanned, then you publish it or keep it as a draft.</p>`}
<p class="hint">Zaisma keeps the live version and the last 5 that passed, for rolling back. Drafts nobody publishes are deleted after 30 days.</p>
<h2 class="rule-h" id="testers">Tester links</h2>
${testersPanel(slug, game, testers, versions)}`;
}

/** What players see about the game, and how it plays on Zaisma; its cover and screenshots beside. */
function detailsSection(slug: string, { game, images, backgrounds, shaders }: Loaded, qrCode: QrCodeJson, gameAddress: string): Raw {
  return html`<div class="details-layout">
<section><h2 class="rule-h" id="details">Details</h2>${detailsForm(slug, game)}
<h2 class="rule-h" id="links">Links</h2>${linksForm(slug, game)}
<h2 class="rule-h" id="own-servers">Your own servers</h2>${ownServersForm(slug, game)}
<h2 class="rule-h" id="export">Export</h2>${exportPanel(slug)}</section>
<aside><h2 class="rule-h" id="images">Cover and screenshots</h2>${imagesPanel(slug, images.filter((image) => !BACKGROUND_KINDS.includes(image.kind)))}
<h2 class="rule-h" id="background">Background</h2>${backgroundPanel(slug, game, images, backgrounds, shaders, gameAddress)}
<h2 class="rule-h" id="qr-code">QR code</h2>${qrCodePanel(slug, qrCode)}</aside>
</div>`;
}

/** Plays, reports and multiplayer use, each in full. */
function playersSection(game: GameJson, reports: Reports, stats: Stats): Raw {
  const ownServer = game.multiplayer_mode === "own" || stats.schedules.length > 0 || stats.multiplayer_days.some((day) => day.game_server !== null);
  return html`<h2 class="rule-h" id="plays">Plays <span class="muted">Last 30 days</span></h2>
${playsPanel(stats.play_stats)}
${hostingPanel(game, stats, ownServer)}
<h2 class="rule-h" id="reports">Player reports</h2>
${reportsPanel(reports)}
<h2 class="rule-h" id="multiplayer">Multiplayer and game server use</h2>
${statsPanel(game.slug, stats, ownServer)}`;
}

/** The first day of next month (UTC), as people say it: "November 1". */
const nextMonthStart = (nowMs = Date.now()) => {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
};

/**
 * The free tier, in its own section: hosting is counted in player-hours (time in Zaisma rooms, and data
 * through Zaisma's relay), and until hosting billing a game stops at the free ones. Only for games that
 * play online, or have used some.
 */
function hostingPanel(game: GameJson, stats: Stats, own: boolean): Raw | "" {
  const use = stats.hosting_use_this_month;
  if (game.multiplayer_mode === "none" && !use.free_used_pct && !use.is_paused && !own && use.monthly_budget_cents === null) return "";
  const resetDay = nextMonthStart();
  const shares = use.shares.length ? html`<small>${use.shares.map((share) => `${HOSTING_KIND_LABELS[share.kind]} ${share.share_pct}%`).join(", ")}</small>` : "";
  const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  const pausedWhy =
    use.paused_reason === "budget_used"
      ? "This month's budget is used: raise it to start again."
      : use.paused_reason === "credit_used"
        ? "Your credit ran out: add credit to start again."
        : `This month's free hosting is used: it's back on ${resetDay}, or sooner with credit and a budget.`;
  const paused = use.is_paused
    ? html`<div class="hosting-paused" role="status"><strong>Hosting is paused</strong><p>New matches can't start, and running ones end within the hour.</p><small>${pausedWhy}</small></div>`
    : "";
  const freeMeter = html`<span class="meter"><span style="width:${use.free_used_pct}%"></span></span>`;
  const budgetCents = use.monthly_budget_cents;
  if (budgetCents === null) {
    return html`<h2 class="rule-h" id="hosting">Hosting <span class="muted">This month</span></h2>
${paused}<div class="numbers hosting">
<div class="num plate${use.free_used_pct >= 100 ? " reached" : ""}"><strong>${use.free_used_pct}%</strong><span>Free this month: ${use.free_used_pct}% used. Resets ${resetDay}.</span>${freeMeter}${shares}</div>
</div>`;
  }
  // Paid hosting carries on where the free allowance ends: one meter, the free part first, then the budget. The free
  // part is a share of the bar, never sized by dollars, and a game living on its budget isn't warned about it.
  const budgetUsedPct = Math.min(100, Math.round((use.spent_from_credit_cents / Math.max(budgetCents, 1)) * 100));
  const isIntoBudget = use.free_used_pct >= 100;
  return html`<h2 class="rule-h" id="hosting">Hosting <span class="muted">This month</span></h2>
${paused}<div class="numbers hosting">
<div class="num plate${use.spent_from_credit_cents >= budgetCents * 0.8 ? " reached" : ""}">${isIntoBudget
    ? html`<strong>${dollars(use.spent_from_credit_cents)}</strong><span>of ${dollars(budgetCents)} budget, after this month's free hosting. Resets ${resetDay}.</span>`
    : html`<strong>${use.free_used_pct}%</strong><span>Free this month: ${use.free_used_pct}% used. Then the ${dollars(budgetCents)} budget. Resets ${resetDay}.</span>`}<span class="meter split"><span class="part free"><i style="width:${use.free_used_pct}%"></i></span><span class="part paid"><i style="width:${budgetUsedPct}%"></i></span></span><span class="meter-labels"><small>Free: ${use.free_used_pct}%</small><small>Budget: ${dollars(use.spent_from_credit_cents)} of ${dollars(budgetCents)}</small></span>${shares}</div>
</div>`;
}

const HOSTING_KIND_LABELS: Record<Stats["hosting_use_this_month"]["shares"][number]["kind"], string> = { room_play: "Rooms", game_server_cpu: "Game server CPU", relayed_data: "Relay", database: "Database", requests: "Requests" };

/**
 * The game's own SQLite database: the month's use, its tables beside how to reach it. The SQL console
 * (Game database console) takes the main column.
 */
function databaseSection(slug: string, database: DatabaseJson | string): Raw {
  if (typeof database === "string") return html`<p class="error" role="alert">${database}</p>`;
  const use = database.database_use_this_month;
  const meter = (label: string, usedNumber: number, shown: (shownNumber: number) => string) => html`<div class="num plate"><strong>${shown(usedNumber)}</strong><span>${label}</span></div>`;
  const tables = database.tables;
  return html`<div class="numbers">
${meter("Rows read this month", use.read_row_count, formatted)}
${meter("Rows written this month", use.written_row_count, formatted)}
${meter("Stored", use.storage_size_bytes, sizeText)}
</div>
<p class="hint">The database counts on the game's hosting meter with everything else it runs (Players, Hosting). A game keeps up to ${sizeText(use.maximum_storage_size_bytes)}.</p>
<div class="database">
<aside class="tables">
<h2 class="rule-h">Tables</h2>
${tables.length
      ? html`<ul class="schema">${tables.map(
          (table) => html`<li><details><summary>${table.name}</summary><pre>${table.sql}</pre>${database.indexes
            .filter((index) => index.table_name === table.name)
            .map((index) => html`<pre>${index.sql}</pre>`)}</details></li>`,
        )}</ul>`
      : html`<p class="muted">No tables yet.</p>`}
</aside>
<section>
${tables.length
      ? ""
      : html`<div class="note"><p><strong>Every game gets its own SQLite database.</strong> Your game server keeps scores, inventories and anything else that outlives a match in it, as <code>room.database</code>, and the same database runs as a file on your own server. Make tables with <code>CREATE TABLE</code> from your game server, your AI or your terminal.</p></div>`}
<h2 class="rule-h">Run SQL</h2>
<p class="muted">From your AI, with the Zaisma MCP: <code>query_database</code> and <code>batch_database</code>. From your terminal:</p>
<pre>npx @zaisma/cli database query ${slug} "SELECT * FROM ${tables[0]?.name ?? "scores"} LIMIT 50"</pre>
<h2 class="rule-h">Export and import</h2>
<p class="muted">The whole database comes out as SQLite's SQL dump or a ready <code>.sqlite</code> file, the one your own server runs, and goes back in the same way. Your AI does it with <code>export_database</code> and <code>import_database</code>.</p>
<pre>npx @zaisma/cli database export ${slug} ${slug}.sqlite
npx @zaisma/cli database import ${slug} ${slug}.sql</pre>
</section>
</div>`;
}

interface TesterJson {
  id: string;
  name: string;
  link_url: string;
  version_choice: "live" | "newest_passed" | "picked";
  picked_version_id: string | null;
  ends_at: string | null;
  created_at: string;
  last_opened_at: string | null;
}

/** A version's name in a list: when it was uploaded, and whether it's live. */
const versionName = (version: VersionJson) => `${version.id.slice(0, 16)}${version.is_live ? " (live)" : version.patch_notes ? `: ${version.patch_notes.slice(0, 40)}` : ""}`;

/** What a tester link opens, in words. */
function opensText(link: TesterJson, versions: VersionJson[]): string {
  if (link.version_choice === "live") return "Opens what players get (live)";
  if (link.version_choice === "newest_passed") return "Opens your latest upload that passed, published or not";
  const picked = versions.find((version) => version.id === link.picked_version_id);
  return picked ? `Opens just ${versionName(picked)}` : "Opens a version that was deleted: pick another";
}

/** The choice of what a tester link opens: the live version, the newest that passed, or one that passed. */
function opensSelect(versions: VersionJson[], link?: TesterJson): Raw {
  const chosen = !link ? "live" : link.version_choice === "picked" ? link.picked_version_id : link.version_choice;
  const option = (optionValue: string, label: string) => html`<option value="${optionValue}"${chosen === optionValue ? raw(" selected") : ""}>${label}</option>`;
  const passed = versions.filter((version) => version.scan_status === "approved");
  return html`<select name="opens" aria-label="Which version it opens">${option("live", "Live (what players get)")}${option("newest_passed", "Latest upload that passed")}${passed.length ? html`<optgroup label="Or just one version">${passed.map((version) => option(version.id, versionName(version)))}</optgroup>` : ""}</select>`;
}

/** An end date input, filled in from the browser's own time on submit (data-local-time). */
const endsInput = (endsAt: string | null) =>
  html`<label class="ends">Ends <input type="datetime-local" name="local" aria-label="When it stops working (optional)" data-iso="${endsAt ?? ""}"></label><input type="hidden" name="at">`;

/** Secret links that open the game whatever the visibility: one per group, each turned off on its own. */
function testersPanel(slug: string, game: GameJson, testers: TesterJson[], versions: VersionJson[]): Raw {
  const removed = game.review_status === "removed";
  const nowMs = Date.now();
  return html`<p class="hint">Anyone with a tester link plays your game, even while it's private or a draft, with no account needed. A link opens what players get, your latest upload that passed or just one version, so testers can try an update before players get it. Online play works only on links that open the live version, so tests never reach live rooms, game servers or data: try online play on your own computer first, with your game server running there. Make one for each group, like your team or a streamer, so you can turn one off without the others.</p>
${testers.length
      ? html`<ul class="testers">${testers.map((link) => {
          const hasEnded = link.ends_at !== null && Date.parse(link.ends_at) <= nowMs;
          return html`<li class="plate">
<div class="tester-link-head"><strong>${link.name}</strong><span class="muted">${link.last_opened_at ? html`Last opened ${when(link.last_opened_at)}` : "Not opened yet"}</span></div>
<p class="muted tester-opens">${opensText(link, versions)}${link.ends_at ? html`. ${hasEnded ? "Ended" : "Works until"} ${when(link.ends_at)}` : ""}.</p>
<div class="row"><input readonly value="${link.link_url}" aria-label="Tester link for ${link.name}"><button class="btn ghost" type="button" data-copy="${link.link_url}">Copy</button>
<form method="post" action="/dashboard/${slug}/testers/${link.id}/remove"><button class="btn ghost" type="submit">Turn off</button></form></div>
${removed
  ? ""
  : html`<details class="later"><summary>Change</summary><form class="row" method="post" action="/dashboard/${slug}/testers/${link.id}/change" data-local-time><input name="name" maxlength="60" required value="${link.name}" aria-label="Who it's for">${opensSelect(versions, link)}${endsInput(link.ends_at)}<button class="btn ghost" type="submit">Save</button><button class="btn ghost" type="button" data-cancel>Cancel</button></form></details>`}
</li>`;
        })}</ul>`
      : ""}
${removed ? "" : html`<form class="row make-tester" method="post" action="/dashboard/${slug}/testers" data-local-time><input name="name" maxlength="60" required placeholder="Who it's for, like Playtesters" aria-label="Who the link is for">${opensSelect(versions)}${endsInput(null)}<button class="btn light" type="submit">Make a tester link</button></form>`}`;
}

function uploadPanel(slug: string): Raw {
  return html`<form class="drop bevel" id="drop" data-slug="${slug}">
<p><strong>Upload a new version.</strong> Drop your game's folder here, or <label class="pick">choose it<input type="file" id="folder" webkitdirectory multiple hidden></label>. It needs an index.html at the top.</p>
<div class="row"><input name="notes" id="notes" maxlength="2000" placeholder="What changed (optional, shown with the update)" aria-label="What changed"><label class="check"><input type="checkbox" id="auto"> Publish when it passes</label></div>
<p class="hint" id="upload-status" role="status" aria-live="polite">Only new and changed files are sent. Files over 95 MB go through <code>npx @zaisma/cli upload</code>.</p>
</form>
${scriptTags(UPLOAD_SCRIPT)}`;
}

function versionRow(slug: string, version: VersionJson, section: Section): Raw {
  const action = (what: string) => `/dashboard/${slug}/versions/${version.id}/${what}`;
  const scheduled = version.scheduled_publish_at
    ? html`<form class="row" method="post" action="${action("unschedule")}">${sectionField(section)}<span>Goes live ${when(version.scheduled_publish_at)}${version.scan_status === "scanning" ? " if it has passed by then" : ""}.</span><button class="btn ghost" type="submit">Cancel</button></form>`
    : "";
  let acts: Raw | string = "";
  if (version.scan_status === "approved" && !version.is_live) {
    acts = html`<div class="row">
${version.preview_url ? html`<a class="btn ghost" href="${version.preview_url}" target="_blank" rel="noopener" title="For you and your AI: each link works for a day">Preview</a>` : ""}
<form class="row" method="post" action="${action("publish")}">${sectionField(section)}<button class="btn light" type="submit">${version.published_at ? "Roll back to this" : "Publish"}</button><label class="check now-check" title="Live matches switch within seconds, in the same room; open games get Update"><input type="checkbox" name="match_update_mode" value="now"> Update running games now</label></form>
${version.preview_url ? html`<details class="later"><summary>Preview links</summary><form class="row" method="post" action="${action("end-previews")}">${sectionField(section)}<span class="muted">Each preview link is for you and your AI and works for a day. Shared one too widely? Turn them all off; Preview gets a fresh one.</span><button class="btn ghost" type="submit">Turn off preview links</button></form></details>` : ""}
${version.scheduled_publish_at ? "" : html`<details class="later"><summary>Publish later</summary><form class="row" method="post" action="${action("schedule")}">${sectionField(section)}<input type="datetime-local" name="local" required aria-label="When"><input type="hidden" name="at"><label class="check now-check" title="Live matches switch within seconds, in the same room; open games get Update"><input type="checkbox" name="match_update_mode" value="now"> Update running games now</label><button class="btn ghost" type="submit">Schedule</button></form></details>`}
</div>`;
  } else if (version.scan_status === "scanning") {
    acts = html`<p class="muted">Being scanned. This usually takes under a minute.</p>`;
  }
  // Held and rejected versions say why: a person's or a report's decision, and what the scan found. One a newer
  // version replaced while it waited says only that.
  const isReplaced = version.scan_status === "held" && version.replaced_by_version_id !== null;
  const isHeldBack = (version.scan_status === "held" || version.scan_status === "rejected") && !isReplaced;
  const findings = isHeldBack ? version.findings : [];
  const fixes = [...new Set(findings.map((finding) => finding.fix))];
  return html`<li class="${version.is_live ? "live edge" : ""}">
<div class="version-head"><strong>${version.is_live ? html`<span class="badge">Live</span> ` : ""}${version.id.slice(0, 16)}</strong><span class="muted">${when(version.created_at)} · ${version.file_count} files, ${sizeText(version.size_bytes)}</span>${version.is_live ? "" : html`<span class="pill ${version.scan_status}">${version.scan_status === "approved" ? (version.published_at ? "Was live" : "Ready") : version.scan_status[0]!.toUpperCase() + version.scan_status.slice(1)}</span>`}</div>
${version.patch_notes ? html`<p class="version-notes">${version.patch_notes}</p>` : ""}
${isReplaced ? html`<p class="muted">Replaced by a newer version</p>` : ""}
${isHeldBack && version.review_reason ? reasonPanel(slug, version.review_reason) : ""}
${findings.length
      ? html`<div class="reason"><ul class="findings">${findings.map(
          (finding) => html`<li>${finding.message}${finding.path ? html` <span class="muted">(${finding.path})</span>` : ""}<br><span class="muted">${finding.content_rule ? html`${ruleLink(finding.content_rule)} · ` : ""}<code>${finding.code}</code></span></li>`,
        )}</ul>${fixes.map((fix) => html`<p class="fix">${fixForPeople(slug, fix)}</p>`)}</div>`
      : ""}
${version.scan_status === "approved" ? performanceLine(version.performance_check) : ""}
${scheduled}${acts}
</li>`;
}

/** How a passed version started in Chrome, with its notes folded away: they never hold it. */
function performanceLine(check: PerformanceCheckJson | null): Raw | string {
  if (!check) return "";
  if (check.check_status === "waiting" || check.check_status === "checking") return html`<p class="muted">Checking how it starts in Chrome…</p>`;
  if (check.check_status === "over_daily_limit") return html`<p class="muted">Not started in Chrome: today's 20 runs are used. Versions are measured again from midnight UTC.</p>`;
  if (check.check_status === "could_not_run") return html`<p class="muted">Chrome couldn't run it on Zaisma's side; nothing for you to fix.</p>`;
  const numbers = [
    check.loading_duration_sec === null ? "nothing drawn" : `first frame after ${check.loading_duration_sec} s`,
    check.start_download_size_bytes === null ? "" : `${sizeText(check.start_download_size_bytes)} before it`,
    check.start_memory_size_bytes === null ? "" : `${sizeText(check.start_memory_size_bytes)} memory`,
  ].filter(Boolean);
  return html`<div class="started"><p>Started in Chrome: ${numbers.join(" · ")}</p>${check.notes.length
    ? html`<details class="later"><summary>${check.notes.length} ${check.notes.length === 1 ? "note" : "notes"}</summary><ul class="started-notes">${check.notes.map(
        (note) => html`<li>${note.message}${note.path ? html` <span class="muted">(${note.path})</span>` : ""}<br><span class="fix">${note.fix}</span> <span class="muted"><code>${note.code}</code></span></li>`,
      )}</ul></details>`
    : ""}</div>`;
}

function detailsForm(slug: string, game: GameJson): Raw {
  const waiting = game.details_waiting_for_review;
  return html`<form class="stack" method="post" action="/dashboard/${slug}/details">
${waiting ? html`<p class="note small">Being checked: ${[waiting.title ? `title "${waiting.title}"` : "", waiting.description ? "a new description" : ""].filter(Boolean).join(" and ")}. It usually shows within a minute.</p>` : ""}
${game.title_listing_reason ? html`<div class="note">${reasonPanel(slug, game.title_listing_reason, "The title keeps your game off Zaisma's lists.")}</div>` : ""}
<label>Title<input name="title" maxlength="80" required value="${waiting?.title ?? game.title}"></label>
<label>Description<textarea name="description" maxlength="500">${waiting?.description ?? game.description}</textarea></label>
<fieldset><legend>Works on</legend><div class="row">${DEVICES.map((device) => html`<label class="check"><input type="checkbox" name="devices" value="${device}"${game.devices.includes(device) ? raw(" checked") : ""}> ${DEVICE_LABELS[device]}</label>`)}</div></fieldset>
<fieldset><legend>Controls</legend><div class="row">${CONTROLS.map((control) => html`<label class="check"><input type="checkbox" name="controls" value="${control}"${game.controls.includes(control) ? raw(" checked") : ""}> ${CONTROL_LABELS[control]}</label>`)}</div></fieldset>
${playersFields(game.play_modes)}
<label>Screen<select name="screen">${["", ...SCREENS].map((screen) => html`<option value="${screen}"${(game.screen_orientation ?? "") === screen ? raw(" selected") : ""}>${SCREEN_LABELS[screen]}</option>`)}</select></label>
${multiplayerFields(game.multiplayer_mode)}
${game.multiplayer_mode !== "none" ? roomBrowsingFields(game.room_browsing) : ""}
${game.multiplayer_mode !== "none" || game.own_server_urls.length > 0 ? friendJoinsFields(game.friend_joins_enabled) : ""}
${accountRequirementFields(game.account_requirement, game.minimum_player_age_years)}
${minimumPlayerAgeFields(game)}
<fieldset><legend>Saves</legend>
<label class="check"><input type="checkbox" name="cloud_saves"${game.cloud_saves_enabled ? raw(" checked") : ""}> Cloud saves</label>
<p class="hint">Signed-in players' progress follows them to any device. It copies the game's own browser saves, so there's nothing to add to your game. Turn it off if your game keeps its own saves on a server.</p>
<label class="check"><input type="checkbox" name="account_offer"${game.account_offer_enabled ? raw(" checked") : ""}> "Keep your progress" card</label>
<p class="hint">Once a guest has progress and has played 5 minutes, a card beside the game offers a free account to keep it. Turn it off if your game picks the moment itself: <code>Zaisma.player.offerAccount()</code> shows the same card whenever the game likes, at most once a visit and not for 3 days after Not now.</p>
</fieldset>
<fieldset><legend>Deleted accounts</legend>
<label class="check"><input type="checkbox" name="deleted_account_erase"${game.deleted_account_erase_enabled ? raw(" checked") : ""}> Erase players who delete their account</label>
<p class="hint">When a player deletes their Zaisma account, Zaisma erases their rows from this game's database: every row whose <code>player_id</code> is theirs. Turn it off if your game must keep some of them, and handle the <code>account_deleted</code> webhook event yourself.</p>
</fieldset>
<button class="btn" type="submit">Save details</button>
</form>`;
}

const LINK_AUDIENCE_WORDS: Record<LinkJson["who_can_open"], string> = {
  everyone: "Opens for everyone.",
  signed_in_adults: "Opens for signed-in adults. Guests and players under 18 see \"This link can't be opened here.\"",
  nobody: "Opens for nobody.",
};

/**
 * The sites the game opens with Zaisma.links.open, one row each and two empty ones to add more; a row
 * cleared is a link removed. Each says who it opens for, and why it opens for nobody.
 */
function linksForm(slug: string, game: GameJson): Raw {
  const rowCount = Math.min(LINK_LIMITS.maximumLinkCount, game.links.length + 2);
  const row = (i: number) => {
    const link = game.links[i];
    return html`<fieldset class="link-row">
<div class="row"><label>Name<input name="link_name_${i}" value="${link?.link_name ?? ""}" maxlength="32" pattern="[a-z][a-z0-9_]*" placeholder="store" aria-label="Link ${i + 1}: name"></label>
<label class="grow">Address<input name="destination_url_${i}" type="url" value="${link?.destination_url ?? ""}" maxlength="500" placeholder="https://kit.itch.io/sky-hopper" aria-label="Link ${i + 1}: address"></label></div>
<label class="check"><input type="checkbox" name="is_on_game_page_${i}"${link?.is_on_game_page ? raw(" checked") : ""}> Show it on the game page too</label>
${link ? html`<p class="hint">${LINK_AUDIENCE_WORDS[link.who_can_open]}</p>${link.review_reason ? reasonPanel(slug, link.review_reason) : ""}` : ""}
</fieldset>`;
  };
  return html`<form class="stack" method="post" action="/dashboard/${slug}/links">
<p class="hint">The sites your game opens, like your store, Patreon, Steam page or Discord: <code>Zaisma.links.open("store")</code>, from a tap or key press in the game. Players see "You're leaving Zaisma" with the address, and choose Open or Stay. Guests and players under 18 open only links on well-known store, payment and video sites, never chat apps. Up to ${LINK_LIMITS.maximumLinkCount}; clear a row to remove its link.</p>
${Array.from({ length: rowCount }, (_, i) => row(i))}
<button class="btn" type="submit">Save links</button>
</form>`;
}

/** The servers of the developer's own the game connects to, one row each and one empty to add another; a row cleared is a server removed. */
function ownServersForm(slug: string, game: GameJson): Raw {
  const rowCount = Math.min(OWN_SERVER_LIMITS.maximumServerCount, game.own_server_urls.length + 1);
  return html`<form class="stack" method="post" action="/dashboard/${slug}/own-servers">
<p class="hint">Servers you run that your game connects to, like a game server with <code>@zaisma/game-server</code> or your own relay: <code>wss://play.example.com</code>. Up to ${OWN_SERVER_LIMITS.maximumServerCount}, live at once. The game's menu says "Online play runs on the developer's own server: play.example.com". Games that only use Zaisma rooms need none. Clear a row to remove it.</p>
${Array.from(
    { length: rowCount },
    (_, i) => html`<label>Server ${i + 1}<input name="own_server_url_${i}" type="url" value="${game.own_server_urls[i] ?? ""}" maxlength="${OWN_SERVER_LIMITS.maximumUrlCharacterCount}" placeholder="wss://play.example.com"></label>`,
  )}
<button class="btn" type="submit">Save servers</button>
</form>`;
}

/** Export everything (game-export.ts): one .zip, the same one export_game's link and zaisma export give. */
function exportPanel(slug: string): Raw {
  return html`<div class="stack">
<p class="hint">Everything about the game in one .zip: every version that passed review, the cover and screenshots, the database, every player's save, stats, reports and history. Secrets come by name, never their values. It's made as it downloads, so it starts at once. Your AI gets the same link with <code>export_game</code>, and a terminal saves it as a folder with <code>npx @zaisma/cli export ${slug}</code>.</p>
<a class="btn" href="/dashboard/${slug}/export.zip" data-download>Export everything</a>
</div>`;
}

const MULTIPLAYER_LABELS = {
  none: { label: "None", hint: "Single-player, or only your own servers." },
  relay: { label: "Relay", hint: "Zaisma passes each player's messages to the others. No server code." },
  own: { label: "Your game server", hint: "Runs the zaisma-server/ folder (or zaisma-server.js) from your upload on Zaisma, sealed off: it calls only the servers you list for it. Players never get its files." },
} as const;

/** Multiplayer on Zaisma rooms, as the developer sets it. A game server built into Zaisma is set by us. */
function multiplayerFields(current: GameJson["multiplayer_mode"]): Raw {
  if (current === "built-in") return html`<fieldset><legend>Multiplayer</legend><p class="hint">Runs a game server built into Zaisma. Ask us to change it.</p></fieldset>`;
  return html`<fieldset class="choices"><legend>Multiplayer</legend>
${(["none", "relay", "own"] as const).map(
    (multiplayerMode) => html`<label class="check"><input type="radio" name="multiplayer" value="${multiplayerMode}"${current === multiplayerMode ? raw(" checked") : ""}> <span>${MULTIPLAYER_LABELS[multiplayerMode].label}<small class="hint">${MULTIPLAYER_LABELS[multiplayerMode].hint}</small></span></label>`,
  )}
</fieldset>`;
}

/** Where open rooms on Zaisma are listed. Single rooms can still hide themselves from the game. */
function roomBrowsingFields(current: RoomBrowsing): Raw {
  return html`<fieldset class="choices"><legend>Room browsing</legend>
${ROOM_BROWSING.map(
    (browsing) => html`<label class="check"><input type="radio" name="room_browsing" value="${browsing}"${current === browsing ? raw(" checked") : ""}> <span>${ROOM_BROWSING_LABELS[browsing].label}<small class="hint">${ROOM_BROWSING_LABELS[browsing].hint}</small></span></label>`,
  )}
<p class="hint">Your game can also hide single rooms, like private matches: <code>Zaisma.joinRoom({ isListed: false })</code>, or <code>room.setListed(false)</code> from your game server.</p>
</fieldset>`;
}

/** Whether a player's friends can Join them in this game's rooms from Zaisma. Single rooms can turn it off from the game. */
function friendJoinsFields(isEnabled: boolean): Raw {
  return html`<fieldset><legend>Join</legend>
<input type="hidden" name="friend_joins_shown" value="1">
<label class="check"><input type="checkbox" name="friend_joins"${isEnabled ? raw(" checked") : ""}> Friends can join players</label>
<p class="hint">A player's friends see Join beside them on Zaisma and go straight to their room. Turn it off if players shouldn't drop into each other's matches: Join shows as "This game doesn't take joins". Your game can turn it off for one room instead: <code>Zaisma.joinRoom({ friendJoinsEnabled: false })</code>, or <code>room.setFriendJoinsEnabled(false)</code> from your game server.</p>
</fieldset>`;
}

/** Whether guests play too, or only signed-in players for multiplayer or the whole game. A game for 16 or 18 and up is accounts only. */
function accountRequirementFields(current: AccountRequirement, minimumPlayerAgeYears: number): Raw {
  const isLocked = minimumPlayerAgeYears > 13;
  return html`<fieldset class="choices"><legend>Zaisma accounts</legend>
${ACCOUNT_REQUIREMENTS.map(
    (requirement) =>
      html`<label class="check"><input type="radio" name="account_requirement" value="${requirement}"${current === requirement ? raw(" checked") : ""}${isLocked && requirement !== "whole_game" ? raw(" disabled") : ""}> <span>${ACCOUNT_REQUIREMENT_LABELS[requirement].label}<small class="hint">${ACCOUNT_REQUIREMENT_LABELS[requirement].hint}</small></span></label>`,
  )}
${isLocked ? html`<p class="hint">Guests can't play: only accounts have an age.</p>` : ""}
</fieldset>`;
}

const MINIMUM_PLAYER_AGE_LABELS: Record<MinimumPlayerAge, { label: string; hint: string }> = {
  13: { label: "Everyone 13 and up", hint: "Anyone with the link, guests included, as your Zaisma accounts setting allows" },
  16: { label: "16 and up", hint: "Younger players can't find or open your game. Guests can't play: only accounts have an age." },
  18: { label: "18 and up", hint: "Younger players can't find or open your game. Guests can't play: only accounts have an age." },
};

/** The youngest age that can play (docs/DECISIONS.md, "Games can keep out younger age bands"). */
function minimumPlayerAgeFields(game: Pick<GameJson, "minimum_player_age_years">): Raw {
  return html`<fieldset class="choices"><legend>Ages</legend>
${MINIMUM_PLAYER_AGES.map(
    (ageYears) =>
      html`<label class="check"><input type="radio" name="minimum_player_age_years" value="${String(ageYears)}"${game.minimum_player_age_years === ageYears ? raw(" checked") : ""}> <span>${MINIMUM_PLAYER_AGE_LABELS[ageYears].label}<small class="hint">${MINIMUM_PLAYER_AGE_LABELS[ageYears].hint}</small></span></label>`,
  )}
</fieldset>`;
}

function playersFields(modes: PlayMode[] | null): Raw {
  const of = (wanted: PlayMode["mode"]) => modes?.find((playMode) => playMode.mode === wanted) ?? null;
  const mode = (name: "local" | "online", label: string, hint: string, playMode: PlayMode | null) => html`<div class="mode">
<label class="check"><input type="checkbox" name="${name}"${playMode ? raw(" checked") : ""}> ${label}</label>
<div class="mode-detail"><select name="${name}_play_style" aria-label="${label}: how">${PLAY_STYLES.map((playStyle) => html`<option value="${playStyle}"${playMode?.play_style === playStyle ? raw(" selected") : ""}>${playStyle === "both" ? "Both" : playStyle === "co-op" ? "Co-op" : "Versus"}</option>`)}</select>
<input type="number" name="${name}_minimum_player_count" min="2" max="1000" value="${playMode?.minimum_player_count ?? 2}" aria-label="${label}: fewest players"><span class="muted">to</span><input type="number" name="${name}_maximum_player_count" min="2" max="1000" value="${playMode?.maximum_player_count ?? ""}" placeholder="any" aria-label="${label}: most players (empty for no limit)"><span class="muted">players</span></div>
<p class="hint">${hint}</p></div>`;
  return html`<fieldset class="players"><legend>Players</legend>
<label class="check"><input type="checkbox" name="single"${of("single") ? raw(" checked") : ""}> Single-player</label>
${mode("local", "Local multiplayer", "Together on one device or screen.", of("local"))}
${mode("online", "Online multiplayer", "Each on their own device. Leave the most empty for no limit.", of("online"))}
</fieldset>`;
}

const KIND_LABELS: Record<ImageJson["kind"], string> = { cover: "Cover", square: "Square cover", screenshot: "Screenshot", share: "Share picture", background: "Background", phone_background: "Phone background", shader_texture: "Shader texture" };
/** Pictures the Background section shows, not Cover and screenshots: backgrounds, and the textures shaders read. */
const BACKGROUND_KINDS: ImageJson["kind"][] = ["background", "phone_background", "shader_texture"];

/**
 * Why Zaisma held, rejected or took something down: the reason in plain words, the content rule it's
 * about, what to do, and the code to look it up by (the forum finds others who had it).
 */
function reasonPanel(slug: string, reason: ReviewReasonJson, lead?: string): Raw {
  return html`<div class="reason">
<p>${lead ? html`<strong>${lead}</strong> ` : ""}${reason.message}</p>
${reason.content_rule ? html`<p class="muted">${ruleLink(reason.content_rule)}</p>` : ""}
<p class="fix">${fixForPeople(slug, reason.fix)}</p>
<p class="muted"><a href="/forum?search_text=${encodeURIComponent(reason.code)}"><code>${reason.code}</code></a></p>
</div>`;
}

/**
 * A fix as people read it here: the calls it names for an AI (message_zaisma, add_image, update_game)
 * become this page's own links, with the same meaning.
 */
function fixForPeople(slug: string, fix: string): Raw {
  const message = `/forum/messages/new?${new URLSearchParams({ kind: "question", game_slug: slug })}`;
  const parts = fix.split(/(message_zaisma(?: with the (?:game_slug|version_id))?|add_image|add_shader|update_game)/);
  return html`${parts.map((part, i) =>
    i % 2 === 0
      ? part
      : part.startsWith("message_zaisma")
        ? html`<a href="${message}">message Zaisma</a>`
        : part === "add_image"
          ? html`<a href="/dashboard/${slug}/details#images">Add image</a>`
          : part === "add_shader"
            ? html`<a href="/dashboard/${slug}/details#background">Background</a>`
            : html`<a href="/dashboard/${slug}/details">the details here</a>`,
  )}`;
}

/** A content rule, linked to where the rules page says it. */
const ruleLink = (rule: ContentRule) => html`The rule: <a href="/legal/content-rules#${rule}" target="_blank" rel="noopener">${CONTENT_RULES[rule]}</a>`;

interface QrCodeJson {
  link_url: string;
  qr_code_svg: string;
}

/** The game's link as a QR code, for posters, booths and trailers: SVG for print, PNG for anything else. */
function qrCodePanel(slug: string, qrCode: QrCodeJson): Raw {
  const svgUrl = `data:image/svg+xml;base64,${btoa(qrCode.qr_code_svg)}`;
  return html`<div class="qr-panel"><img class="qr-image" src="${svgUrl}" alt="QR code for ${qrCode.link_url}" width="160" height="160">
<div class="stack"><p class="muted">Scans to ${qrCode.link_url.replace(/^https:\/\//, "")}. Players get the same code from Share on the game page.</p>
<div class="row"><a class="btn ghost" href="${svgUrl}" download="${slug}-qr-code.svg">Download SVG</a><button class="btn ghost" type="button" id="qr-png" data-svg="${svgUrl}" data-name="${slug}-qr-code.png">Download PNG</button></div></div></div>
${scriptTags(QR_PNG_SCRIPT)}`;
}

function imagesPanel(slug: string, images: ImageJson[]): Raw {
  const shown = images.filter((i) => i.review_status !== "rejected");
  // Only the latest few that weren't approved, each with why; rejected images are never served, so no picture.
  const rejected = images.filter((image) => image.review_status === "rejected" && image.review_reason).slice(0, 3);
  // Pictures the listing check found that keep the game off lists (or held it): shown, with why and the fix.
  const offLists = shown.filter((image) => image.listing_reason);
  return html`${offLists.map(
    (image) =>
      html`<div class="note rejected-image">${reasonPanel(slug, image.listing_reason!, image.listing_reason!.code === "fake_reward" ? `Your ${KIND_LABELS[image.kind].toLowerCase()} held the game.` : `Your ${KIND_LABELS[image.kind].toLowerCase()} keeps the game off Zaisma's lists.`)}</div>`,
  )}
${rejected.map(
    (image) => html`<div class="note rejected-image"><p><strong>The ${KIND_LABELS[image.kind].toLowerCase()} you sent ${when(image.created_at)} wasn't approved.</strong></p>${reasonPanel(slug, image.review_reason!)}
<form method="post" action="/dashboard/${slug}/images/${image.id}/remove"><button class="link" type="submit">Clear this</button></form></div>`,
  )}
${shown.length
    ? html`<div class="thumbs">${shown.map(
        (i) => html`<figure><img class="bevel-s${i.kind === "square" ? " sq" : ""}" src="${i.image_url}" alt="" loading="lazy"><figcaption><span>${KIND_LABELS[i.kind]}${i.review_status === "pending" ? html` <span class="pill pending">Being checked</span>` : i.listing_reason ? html` <span class="pill pending">Off lists</span>` : ""}</span>
<form method="post" action="/dashboard/${slug}/images/${i.id}/remove"><button class="link" type="submit">Remove</button></form></figcaption></figure>`,
      )}</div>`
    : html`<p class="muted">No cover yet. Players see it on the game page and in lists.</p>`}
<form class="stack" method="post" action="/dashboard/${slug}/images" enctype="multipart/form-data">
<div class="row"><select name="kind" aria-label="Kind"><option value="cover">Cover</option><option value="square">Square cover</option><option value="screenshot">Screenshot</option><option value="share">Share picture</option></select><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Image"></div>
<p class="hint">Players see your cover alone as your game's card, so put your game's name or logo on it, and nothing else: no other words, nothing laid over the picture, no fake rewards, no famous characters you don't own, and built around something from the game. <a href="/developers/covers">See covers that pass</a>. The cover is landscape (16:9 shows best). The square cover is optional: phones show it instead, where a landscape one would be small; at least 512 px. Screenshots are just the game, its own interface included, with nothing added. The share picture is optional: links to your game show it in chats and social sites instead of the cover (1200 by 630 shows best). PNG, JPEG or WebP, up to 5 MB, at least 320 px a side.</p>
<button class="btn" type="submit">Add image</button>
</form>`;
}

const SCREEN_NAMES = { wide: "Wide screens", phone: "Phones" } as const;

/**
 * The game's background behind Zaisma's glass, for each screen: what shows now, the pictures and shaders it can show with what their
 * check found (each quality level's time), and a live preview behind a sample pane of glass, at the device's quality level or one
 * picked. A shader previews in a frame on the game's own site, never here, whether it was sent or is a file or folder not sent yet. A
 * shader folder (image.glsl, buffer-a.glsl to buffer-d.glsl, channels.json and its textures) is checked before sending and sent as a
 * developer's tools send it: its textures first, as shader_texture pictures, then the shader (BACKGROUND_PREVIEW_SCRIPT).
 */
function backgroundPanel(slug: string, game: GameJson, images: ImageJson[], backgrounds: BackgroundJson[], shaders: ShaderJson[], gameAddress: string): Raw {
  const textures = images.filter((image) => image.kind === "shader_texture");
  const screenPanel = (background: BackgroundJson) => {
    const screen = background.screen;
    const kind = screen === "wide" ? "background" : "phone_background";
    const pictures = images.filter((image) => image.kind === kind);
    const screenShaders = shaders.filter((shader) => shader.screen === screen);
    const nowText = background.source === "zaisma" ? "Zaisma's own" : background.source === "wide" ? "The same as wide screens" : background.source === "image" ? "Your picture" : "Your shader";
    const choose = (source: string, extra: Record<string, string>, label: string) =>
      html`<form method="post" action="/dashboard/${slug}/backgrounds/${screen}"><input type="hidden" name="source" value="${source}">${Object.entries(extra).map(([name, fieldValue]) => html`<input type="hidden" name="${name}" value="${fieldValue}">`)}<button class="link" type="submit">${label}</button></form>`;
    const status = (reviewStatus: string, isShown: boolean) =>
      isShown ? html` <span class="pill live">Showing</span>` : reviewStatus === "pending" ? html` <span class="pill pending">Being checked</span>` : reviewStatus === "rejected" ? html` <span class="pill held">Not passed</span>` : "";
    const candidates = [
      ...pictures.map((image) => {
        const isShown = background.source === "image" && background.image_id === image.id;
        return html`<figure><button class="bg-thumb" type="button" data-preview-picture="${image.review_status === "rejected" ? "" : image.image_url}" aria-label="Preview this picture">${image.review_status === "rejected" ? html`<span class="bevel-s"></span>` : html`<img class="bevel-s" src="${image.image_url}" alt="" loading="lazy">`}</button>
<figcaption><span>Picture${status(image.review_status, isShown)}</span><span class="row">${image.review_status === "approved" && !isShown ? choose("image", { image_id: image.id }, "Use this") : ""}<form method="post" action="/dashboard/${slug}/images/${image.id}/remove"><button class="link" type="submit">Remove</button></form></span></figcaption>
${image.review_reason ? html`<div class="note rejected-image">${reasonPanel(slug, image.review_reason)}</div>` : ""}</figure>`;
      }),
      ...screenShaders.map((shader) => {
        const isShown = background.source === "shader" && background.shader_id === shader.id;
        // Everything the preview needs to draw it as sent: each pass's source and channels, and where its textures are.
        const preview = { image: shader.image, buffers: shader.buffers, texture_urls: Object.fromEntries(shader.texture_image_ids.map((id) => [id, textures.find((texture) => texture.id === id)?.image_url ?? ""])) };
        return html`<figure><button class="bg-thumb" type="button" data-preview-shader="${JSON.stringify(preview)}" aria-label="Preview this shader live">${shader.still_url ? html`<img class="bevel-s" src="${shader.still_url}" alt="" loading="lazy">` : html`<span class="bevel-s"></span>`}</button>
<figcaption><span>Shader${status(shader.review_status, isShown)}${shaderMakeup(shader)}</span><span class="row">${shader.review_status === "approved" && !isShown ? choose("shader", { shader_id: shader.id }, "Use this") : ""}<form method="post" action="/dashboard/${slug}/shaders/${shader.id}/remove"><button class="link" type="submit">Remove</button></form></span></figcaption>
${shader.quality_checks.length ? html`<p class="bg-timings muted">${qualityTimings(shader.quality_checks)}</p>` : ""}
${shader.frame_urls.length ? html`<p class="bg-frames">${shader.frame_urls.map((frameUrl, frameIndex) => html`<a href="${frameUrl}" target="_blank" rel="noopener"><img src="${frameUrl}" alt="Frame ${frameIndex + 1} of the check" loading="lazy"></a>`)}</p>` : ""}
${shader.review_reason ? html`<div class="note rejected-image">${reasonPanel(slug, shader.review_reason)}</div>` : ""}</figure>`;
      }),
    ];
    return html`<div class="bg-screen" data-screen="${screen}">
<h3>${SCREEN_NAMES[screen]}</h3>
<div class="bg-now muted"><span>Shows now: <strong>${nowText}</strong></span>${background.source !== "zaisma" ? choose("zaisma", {}, "Use Zaisma's own") : ""}${screen === "phone" && background.source !== "wide" ? choose("wide", {}, "Same as wide screens") : ""}</div>
${candidates.length ? html`<div class="thumbs bg-candidates">${candidates}</div>` : ""}
<form class="stack" method="post" action="/dashboard/${slug}/backgrounds" enctype="multipart/form-data"><input type="hidden" name="screen" value="${screen}">
<div class="row"><input type="file" name="file" accept="image/png,image/jpeg,image/webp,.glsl,.frag,text/plain" required aria-label="${SCREEN_NAMES[screen]} background: a picture or a shader" data-preview-file><button class="btn ghost" type="submit">Send</button></div></form>
<div class="drop bg-folder" data-slug="${slug}" data-screen="${screen}">
<p><strong>A shader with buffers or textures?</strong> Drop its folder here, or <label class="pick">choose it<input type="file" webkitdirectory multiple hidden aria-label="${SCREEN_NAMES[screen]} background: a shader folder" data-folder-input></label>.</p>
<p class="bg-folder-summary" data-folder-summary hidden></p>
<div class="row" data-folder-actions hidden><button class="btn ghost" type="button" data-folder-check>Check before sending</button><button class="btn" type="button" data-folder-send>Send this shader</button></div>
<div class="bg-check" data-folder-result hidden></div>
<p class="hint" role="status" aria-live="polite" data-folder-status>It previews here as soon as it's picked. Check before sending draws it as the check does, under Zaisma's glass, without sending it.</p>
</div>
</div>`;
  };
  const glassTintColor = shownColor(game.glass_tint_color);
  return html`<div class="bg-panel" data-game-address="${gameAddress}">
<div class="bg-preview not-steel" aria-label="Live preview"${glassTintColor ? html` style="--glass-hue:${glassTintColor}"` : ""}>
<iframe class="backdrop is-framed" data-backdrop="frame" data-adapts-glass src="${gameAddress}_zaisma/shader-preview" sandbox="allow-scripts allow-same-origin" title="Background preview" tabindex="-1"></iframe>
<img class="bg-picture" alt="" hidden>
<div class="glass bg-sample" data-glass data-glass-corners="pane">${EDGE}<strong>${game.title}</strong><span>Zaisma's glass over your background</span></div>
<p class="bg-note" role="status" hidden></p>
</div>
<div class="bg-levels"><span class="muted">Quality level</span><div class="seg" role="group" aria-label="Quality level the preview draws at">${QUALITY_CHOICES.map((choice) => html`<button type="button" data-quality-level="${choice.qualityLevel}" aria-pressed="${choice.qualityLevel === ""}" title="${choice.hint}">${choice.label}</button>`)}</div></div>
<p class="hint">Pick a picture or shader below, or choose a file or folder, to see it here before anyone else does. A shader runs on your game's own site, at the level this device would pick unless you pick one: it reads it as <code>iQuality</code>.</p>
${backgrounds.map(screenPanel)}
${textures.length ? html`<div class="bg-textures"><h3>Shader textures</h3><div class="thumbs">${textures.map(
    (texture) => html`<figure><img class="bevel-s" src="${texture.image_url}" alt="" loading="lazy"><figcaption><span>${sizeText(texture.size_bytes)}${texture.review_status === "pending" ? html` <span class="pill pending">Being checked</span>` : ""}</span><form method="post" action="/dashboard/${slug}/images/${texture.id}/remove"><button class="link" type="submit">Remove</button></form></figcaption></figure>`,
  )}</div><p class="hint">Pictures your shaders read through their channels: a game keeps up to 16, and one a kept shader reads stays until that shader goes.</p></div>` : ""}
<form class="row bg-tint" method="post" action="/dashboard/${slug}/glass-tint"><label>Glass tint <input type="color" name="glass_tint_color" value="${glassTintColor ?? "#808080"}"></label><button class="btn ghost" type="submit">Save tint</button>${glassTintColor ? html`<button class="link" type="submit" name="clear" value="yes">Clear</button>` : ""}</form>
<p class="hint">A background is your game's world behind Zaisma's glass on the home and your game page: no title, logo or words on it (those go on the cover). A picture for wide screens is landscape, at least 1600 px wide, with room for the glass on the left; one for phones is portrait, at least 1600 px tall, with room on the bottom half. A shader is Shadertoy's <code>mainImage</code> in WebGL2's GLSL, up to 64 KB a pass: one <code>.glsl</code> file, or a folder with <code>image.glsl</code>, <code>buffer-a.glsl</code> to <code>buffer-d.glsl</code> for its buffers, its textures (PNG, JPEG or WebP), and <code>channels.json</code> for what each pass reads, like <code>{"image": [{"channel_index": 0, "input_kind": "buffer", "buffer_name": "a"}, {"channel_index": 1, "input_kind": "texture", "texture_file": "noise.png"}], "buffer-a": [{"channel_index": 0, "input_kind": "buffer", "buffer_name": "a"}]}</code>. It's drawn and checked before it can show, at each quality level it reads; players' browsers draw it at fewer pixels, sharpened as it's scaled up, at most 30 frames a second. <a href="/developers/backgrounds">What reads well under the glass</a>. Without a phone background, phones show the wide one. The tint colors Zaisma's glass; Zaisma still decides how thick it is, so words stay readable.</p>
</div>${scriptTags(BACKGROUND_PREVIEW_SCRIPT)}`;
}

/** The quality levels the preview can draw at: the device's own, or one a shader reads as iQuality. */
const QUALITY_CHOICES = [
  { qualityLevel: "", label: "This device's", hint: "The level this device starts at: 2 on a computer, 1 on a tablet, 0 on a phone" },
  { qualityLevel: "0", label: "0", hint: "Phones and slow devices" },
  { qualityLevel: "1", label: "1", hint: "Tablets" },
  { qualityLevel: "2", label: "2", hint: "Computers" },
];

/** Each quality level's time in the check, against its most: "Level 0: 12 of 75 ms a frame". */
const qualityTimings = (qualityChecks: ShaderJson["quality_checks"]) =>
  qualityChecks.map((qualityCheck) => `Level ${qualityCheck.quality_level}: ${qualityCheck.check_frame_ms} of ${qualityCheck.maximum_check_frame_ms} ms a frame`).join(" · ");

/** A shader's buffers and textures, when it has any. */
function shaderMakeup(shader: ShaderJson): Raw | string {
  const parts = [shader.buffer_count ? `${shader.buffer_count} ${shader.buffer_count === 1 ? "buffer" : "buffers"}` : "", shader.texture_count ? `${shader.texture_count} ${shader.texture_count === 1 ? "texture" : "textures"}` : ""].filter(Boolean);
  return parts.length ? html` <span class="muted">${parts.join(", ")}</span>` : "";
}

interface Reports {
  reasons: { reason: string; label: string; open_count: number; closed_count: number }[];
  bug_reports: { player_text: string; reported_at: string }[];
  player_reports: { reason: PlayerReportReason; player_text: string; reported_player_name: string; room_code: string | null; reported_at: string }[];
}

function reportsPanel(reports: Reports): Raw {
  if (!reports.reasons.length) return html`<p class="muted">No reports in the last 90 days.</p>`;
  return html`<table><thead><tr><th>Reason</th><th>Waiting for us</th><th>Looked at</th></tr></thead><tbody>${reports.reasons.map((reason) => html`<tr><td>${reason.label}</td><td>${reason.open_count}</td><td>${reason.closed_count}</td></tr>`)}</tbody></table>
${reports.bug_reports.length ? html`<h3>What players said about bugs</h3><ul class="said">${reports.bug_reports.map((bug) => html`<li>${bug.player_text} <span class="muted">${when(bug.reported_at)}</span></li>`)}</ul>` : ""}
${reports.player_reports.length
    ? html`<h3>What players reported about other players</h3>
<p class="hint">Bullying, cheating and other behavior is your game's call: Zaisma passes those reports to you, and get_reports and the player_reported webhook give them to your AI and your server. Zaisma itself looks at real-life threats, personal details, following after a block and sexual behavior.</p>
<ul class="said">${reports.player_reports.map((report) => html`<li><strong>${PLAYER_REPORT_REASONS[report.reason] ?? report.reason}</strong>: ${report.reported_player_name || "a player"}${report.room_code ? html` in room ${report.room_code}` : ""}${report.player_text ? html`. “${report.player_text}”` : ""} <span class="muted">${when(report.reported_at)}</span></li>`)}</ul>`
    : ""}`;
}

interface Stats {
  play_stats: {
    days: { date: string; play_count: number; player_count: number; new_player_count: number; play_duration_min: number; started_play_count: number }[];
    play_count: number;
    started_play_count: number;
    new_player_count: number;
    play_duration_min: number;
    average_play_duration_min: number | null;
    came_back: Record<"after_1_day" | "after_7_days" | "after_30_days", { returned_pct: number | null; returned_player_count: number; new_player_count: number }>;
  };
  multiplayer_days: {
    date: string;
    room_count: number;
    room_play_duration_min: number;
    message_count: number;
    game_server_cpu_duration_sec: number;
    game_server: { call_count: number; request_count: number; scheduled_run_count: number; crash_count: number; stopped_count: number; ended_match_count: number } | null;
  }[];
  hosting_use_this_month: {
    free_used_pct: number;
    shares: { kind: "room_play" | "game_server_cpu" | "relayed_data" | "database" | "requests"; share_pct: number }[];
    is_paused: boolean;
    paused_reason: "free_used" | "budget_used" | "credit_used" | null;
    monthly_budget_cents: number | null;
    spent_from_credit_cents: number;
    request_count: number;
  };
  room_traffic: {
    inbound_messages_per_player_sec: number;
    inbound_size_bytes_per_player_sec: number;
    outbound_messages_per_player_sec: number;
    outbound_size_bytes_per_player_sec: number;
    message_types: { message_type: string; direction: "inbound" | "outbound"; message_count: number; size_bytes: number; largest_size_bytes: number; average_size_bytes: number }[];
    traffic_hints: { code: string; message: string }[];
  };
  schedules: { schedule_name: string; cron: string; version_id: string; next_run_at: string; last_run_at: string | null }[];
  game_server_errors: { kind: "crash" | "stopped"; message: string; occurrence_count: number; version_id: string; last_at: string }[];
}

const formatted = (shownNumber: number) => shownNumber.toLocaleString("en-US");

/** Plays, time played and players coming back, as the game page counts them. */
function playsPanel(playStats: Stats["play_stats"]): Raw {
  const how = html`<p class="hint">A play counts once the game has been on screen for a minute, in a browser Cloudflare checked is real. Plays through tester and preview links, and your own while signed in, don't count. A player is a browser: one person on two devices counts twice. Time counts only while the game is on screen.</p>`;
  if (!playStats.play_count) return html`<p class="muted">No counted plays in the last 30 days${playStats.started_play_count ? html` (${formatted(playStats.started_play_count)} started in all)` : ""}.</p>${how}`;
  const back = (label: string, cameBack: Stats["play_stats"]["came_back"]["after_1_day"]) =>
    html`<div class="num plate"><strong>${cameBack.returned_pct === null ? "–" : `${cameBack.returned_pct}%`}</strong><span>${label}</span><small>${cameBack.new_player_count ? `${formatted(cameBack.returned_player_count)} of ${formatted(cameBack.new_player_count)} new players` : "Not enough days yet"}</small></div>`;
  const topPlayCount = Math.max(...playStats.days.map((day) => day.play_count), 1);
  // Every one of the 30 days, including those with no plays.
  const playCountByDate = new Map(playStats.days.map((day) => [day.date, day.play_count]));
  const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10));
  return html`<div class="numbers">
<div class="num plate"><strong>${formatted(playStats.play_count)}</strong><span>Plays</span><small>${formatted(playStats.started_play_count)} started in all</small></div>
<div class="num plate"><strong>${formatted(playStats.new_player_count)}</strong><span>New players</span></div>
<div class="num plate"><strong>${playStats.average_play_duration_min === null ? "–" : `${playStats.average_play_duration_min} min`}</strong><span>Per play</span><small>${formatted(playStats.play_duration_min)} minutes in all</small></div>
${back("Back the next day", playStats.came_back.after_1_day)}
${back("Back a week later", playStats.came_back.after_7_days)}
</div>
<figure class="chart"><div class="cols" role="img" aria-label="Plays per day">${dates.map((date) => html`<span title="${date}: ${formatted(playCountByDate.get(date) ?? 0)} plays" style="height:${Math.max(Math.round(((playCountByDate.get(date) ?? 0) / topPlayCount) * 100), 1)}%"></span>`)}</div>
<figcaption><span>${dates[0]}</span><span>Plays per day</span><span>Today</span></figcaption></figure>
<details class="later"><summary>Day by day</summary><table><thead><tr><th>Day</th><th>Plays</th><th>Players</th><th>New</th><th>Minutes</th><th>Started in all</th></tr></thead><tbody>${[...playStats.days].reverse().map(
    (day) => html`<tr><td class="nowrap">${day.date}</td><td>${formatted(day.play_count)}</td><td>${formatted(day.player_count)}</td><td>${formatted(day.new_player_count)}</td><td>${formatted(day.play_duration_min)}</td><td class="muted">${formatted(day.started_play_count)}</td></tr>`,
  )}</tbody></table></details>${how}`;
}

/**
 * This month's room traffic: messages and data each way per player a second, the biggest message types
 * and what to change. Nothing when the game had no room play this month.
 */
function trafficPanel(traffic: Stats["room_traffic"]): Raw | "" {
  if (!traffic.message_types.length && !traffic.inbound_messages_per_player_sec && !traffic.outbound_messages_per_player_sec) return "";
  const kilobytes = (sizeBytes: number) => `${formatted(Math.round((sizeBytes / 1024) * 10) / 10)} KB`;
  const shownSize = (sizeBytes: number) => (sizeBytes < 1024 ? `${formatted(sizeBytes)} bytes` : kilobytes(sizeBytes));
  return html`<h3>Room traffic this month</h3>
<div class="numbers">
<div class="num plate"><strong>${formatted(traffic.inbound_messages_per_player_sec)}</strong><span>messages in</span><small>per player a second</small></div>
<div class="num plate"><strong>${kilobytes(traffic.inbound_size_bytes_per_player_sec)}</strong><span>in</span><small>per player a second</small></div>
<div class="num plate"><strong>${formatted(traffic.outbound_messages_per_player_sec)}</strong><span>messages out</span><small>per player a second</small></div>
<div class="num plate"><strong>${kilobytes(traffic.outbound_size_bytes_per_player_sec)}</strong><span>out</span><small>per player a second</small></div>
</div>
${traffic.traffic_hints.map((hint) => html`<p class="note">${hint.message}</p>`)}
${traffic.message_types.length
    ? html`<table><thead><tr><th>Message type</th><th>Way</th><th>Messages</th><th>Average</th><th>Largest</th></tr></thead><tbody>${traffic.message_types.map(
        (type) => html`<tr><td><code>${type.message_type}</code></td><td>${type.direction === "inbound" ? "In" : "Out"}</td><td>${formatted(type.message_count)}</td><td>${shownSize(type.average_size_bytes)}</td><td>${shownSize(type.largest_size_bytes)}</td></tr>`,
      )}</tbody></table>`
    : ""}
<p class="hint">Counted in Zaisma rooms, each message out once per player it reached. Your message types are their <code>type</code> field; (zaisma) is Zaisma's own, like player lists and pings. Your AI reads the same with get_stats.</p>`;
}

function statsPanel(slug: string, stats: Stats, own: boolean): Raw {
  const days = stats.multiplayer_days;
  if (!days.length) return html`<p class="muted">No multiplayer rooms in the last 30 days.</p>${schedulesTable(stats.schedules)}${own ? serverErrors(slug, stats.game_server_errors) : ""}`;
  const topDurationMin = Math.max(...days.map((day) => day.room_play_duration_min), 1);
  return html`<table><thead><tr><th>Day</th><th>Rooms</th><th>Player minutes</th>${own ? html`<th>Requests</th><th>Scheduled runs</th><th>Game server errors</th><th>Stopped</th><th>Matches ended</th>` : ""}</tr></thead><tbody>${days.map(
    (day) => html`<tr><td class="nowrap">${day.date}</td><td>${day.room_count}</td><td><span class="bar" style="width:${Math.round((day.room_play_duration_min / topDurationMin) * 100)}%"></span>${day.room_play_duration_min}</td>${
      own ? html`<td>${formatted(day.game_server?.request_count ?? 0)}</td><td>${formatted(day.game_server?.scheduled_run_count ?? 0)}</td><td>${day.game_server?.crash_count ?? 0}</td><td>${day.game_server?.stopped_count ?? 0}</td><td>${day.game_server?.ended_match_count ?? 0}</td>` : ""
    }</tr>`,
  )}</tbody></table>${trafficPanel(stats.room_traffic)}${schedulesTable(stats.schedules)}${own ? serverErrors(slug, stats.game_server_errors) : ""}`;
}

/** The live version's schedules, so its developer sees they were read and when they run. */
function schedulesTable(schedules: Stats["schedules"]): Raw | "" {
  if (!schedules.length) return "";
  return html`<h3>Your game server's schedules</h3>
<p class="hint">Crons are in UTC; times here are yours. Schedules are free: up to 10, each at most once a minute. Errors from a run show with your game server's others.</p>
<table><thead><tr><th>Schedule</th><th>Cron</th><th>Next run</th><th>Last run</th></tr></thead><tbody>${schedules.map(
    (schedule) => html`<tr><td>${schedule.schedule_name}</td><td><code>${schedule.cron}</code></td><td class="nowrap">${when(schedule.next_run_at)}</td><td class="nowrap">${schedule.last_run_at ? when(schedule.last_run_at) : html`<span class="muted">Not yet</span>`}</td></tr>`,
  )}</tbody></table>`;
}

/** A game server's recent errors, so its developer can fix what wastes their players' time and our work. */
/** Where a developer reads everything their game server prints: their AI, or a terminal (Logs in the MCP; no logs page). */
const logsPointer = (slug: string): Raw => html`<p class="hint">Everything your game server prints is kept for 30 days. Ask your AI for its logs, or follow them in a terminal: <code>npx @zaisma/cli logs ${slug} --follow</code></p>`;

function serverErrors(slug: string, errors: Stats["game_server_errors"]): Raw {
  if (!errors.length) return html`<p class="muted">No errors from your game server in the last 30 days.</p>${logsPointer(slug)}`;
  return html`<h3>Your game server's errors</h3>
<p class="hint">An error loses that one message, tick, request or scheduled run, and the match carries on. Stopped means it ran on too long, like a loop that never ends: the match froze for about 2 seconds, and a match stopped twice ends.</p>
<table><thead><tr><th>What happened</th><th>Times</th><th>Last</th></tr></thead><tbody>${errors.map(
    (serverError) => html`<tr><td>${serverError.kind === "stopped" ? serverError.message : html`<code>${serverError.message}</code>`}</td><td>${serverError.occurrence_count}</td><td class="nowrap">${when(serverError.last_at)}</td></tr>`,
  )}</tbody></table>${logsPointer(slug)}`;
}

const STYLES = `
.dash-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}
.dash-head h1{margin:0}
.dash-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.make{display:flex;gap:8px;flex-wrap:wrap}
.grid>.hit>.tile{flex:1}
.tile .alerts{list-style:none;margin:0;padding:10px 14px 12px;display:grid;gap:6px;font-size:13px;line-height:1.4;color:var(--text-2);border-top:1px solid var(--line)}
.tile .alerts li{position:relative;padding-left:14px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.tile .alerts li::before{content:"";position:absolute;left:0;top:.5em;width:6px;height:6px;background:var(--warn)}
.tile .alerts li.urgent{color:var(--text)}
.tile .alerts li.urgent::before{background:var(--danger)}
.make input{width:260px;max-width:100%}
.done{color:var(--ok-text);margin:0 0 14px}
.first,#security-alerts,#email-ask{max-width:640px}
.tile .badge{flex:none}
.ways{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:12px}
.way{padding:18px}
.way p{margin:0 0 10px}
.way pre{margin:0;user-select:all}
.crumbs{margin:0 0 12px;font-size:14px}
.crumbs a{color:var(--muted)}
.game-head{display:grid;grid-template-columns:160px 1fr auto;gap:20px;align-items:center;margin-bottom:20px}
.game-head .cover{position:relative;aspect-ratio:16/9;background:var(--pic);overflow:hidden}
.game-head .cover img{width:100%;height:100%;object-fit:cover;display:block}
.game-head h1{margin:0 0 6px}
.game-head .who p{margin:0;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.vis .hint{margin:6px 0 0;text-align:right}
.seg button[disabled]{cursor:not-allowed;opacity:.5}
.confirm{margin-bottom:16px}
.confirm p{margin:0 0 12px}
.drop{padding:20px;outline:1px dashed #4a4f58;outline-offset:-9px}
.drop.over{outline:2px dashed #e9ebee;outline-offset:-9px}
.drop p{margin:0 0 12px}
.drop .row input[name=notes]{flex:1;min-width:200px}
.drop .hint{margin:12px 0 0}
.pick{display:inline;color:var(--text);text-decoration:underline;cursor:pointer;font-size:inherit}
.check{display:inline-flex;flex-direction:row;align-items:center;gap:8px;min-height:44px;color:var(--text-2);font-size:15px}
.check input{min-height:0;width:18px;height:18px;accent-color:#c9cace}
.track{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:12px}
.track>li{padding:14px 16px;display:grid;gap:10px}
.track>li.live{box-shadow:0 0 0 2px #000,-2px -2px 0 2px #fff,var(--drop)}
.version-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.version-head .pill{margin-left:auto}
.version-notes{margin:0;color:var(--text-2);white-space:pre-wrap}
.findings{margin:0;padding-left:18px;color:var(--warn);display:grid;gap:6px}
.findings .muted{color:var(--muted);font-size:13px}
.started{display:grid;gap:2px}
.started>p{color:var(--text-2)}
.started-notes{margin:0 0 4px;padding-left:18px;display:grid;gap:8px;font-size:14px}
.started-notes .fix{color:var(--text-2)}
.started-notes code{font-size:12px}
.reason{display:grid;gap:6px}
.reason p{margin:0}
.reason .fix{color:var(--text-2)}
.reason code{font-size:12px}
.reason a{color:inherit}
.held-game{margin-bottom:16px;border-left:3px solid var(--warn)}
.rejected-image{margin-bottom:12px;display:grid;gap:8px}
.rejected-image>p{margin:0}
.track p{margin:0}
.testers{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:12px}
.testers>li{padding:14px 16px;display:grid;gap:10px}
.tester-link-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between}
.testers .row input{flex:1;min-width:200px;font-size:14px}
.make-tester input[name=name]{flex:1;min-width:200px}
.tester-opens{margin:0;font-size:14px}
.ends{display:flex;gap:6px;align-items:center;font-size:14px}
.link-row{display:grid;gap:8px;padding-top:14px;background:linear-gradient(#000,#000) top/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.055),rgba(255,255,255,.055)) 0 1px/100% 1px no-repeat}
.link-row .row{align-items:end}
.link-row label{display:grid;gap:4px}
.link-row label.grow{flex:1;min-width:220px}
.link-row label.check{display:flex}
.link-row .hint{margin:0}
.later summary{min-height:44px;display:inline-flex;align-items:center;font-size:15px}
.later[open]{flex-basis:100%}
.qr-panel{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.qr-image{flex:none;width:160px;height:160px;background:#fff;box-shadow:0 0 0 1px #000}
.qr-panel .stack{flex:1;min-width:180px}
.thumbs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:16px}
.thumbs figure{margin:0}
.thumbs img{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--pic);display:block}
.thumbs img.sq{aspect-ratio:1}
.thumbs figcaption{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:13px;color:var(--text-2);padding-top:4px}
button.link{background:none;border:0;color:var(--muted);font:inherit;font-size:13px;text-decoration:underline;cursor:pointer;min-height:32px;padding:0}
button.link:hover{color:var(--text)}
.said{padding-left:18px;color:var(--text-2)}
.numbers{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.num{padding:14px 16px;display:grid;gap:2px;align-content:start}
.num strong{font-family:var(--display);font-size:30px;font-weight:500;line-height:1.1}
.num span{color:var(--text-2);font-size:14px}
.num small{color:var(--muted);font-size:12px}
.chart{margin:0 0 8px}
.chart .cols{display:flex;align-items:flex-end;gap:3px;height:120px;padding:0 0 1px;border-bottom:1px solid var(--line)}
.chart .cols span{flex:1;background:linear-gradient(#d8dade,#8d9199);min-height:1px}
.chart figcaption{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;padding-top:6px}
.bar{display:inline-block;height:8px;background:var(--line-2);margin-right:8px;vertical-align:middle;max-width:60%}
.nowrap{white-space:nowrap}
.players{display:grid;gap:4px}
.mode-detail{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-left:26px}
.mode-detail select{width:auto;flex:none}
.mode-detail input{width:64px;flex:none}
.mode .hint{margin:4px 0 6px 26px}
.mode:not(:has(input[type=checkbox]:checked)) .mode-detail,.mode:not(:has(input[type=checkbox]:checked)) .hint{display:none}
.choices{display:grid;gap:2px}
.choices .check{align-items:flex-start;min-height:0;padding:8px 0}
.choices .check input{margin-top:2px}
.choices .check small{display:block;margin-top:3px;font-size:13px}
.choices>.hint{margin:6px 0 0}
input[type=file]{flex:1;min-width:0;padding:9px 12px;color:var(--muted);font-size:14px}
input[type=file]::file-selector-button{background:var(--raised);color:var(--text);border:0;padding:6px 12px;margin-right:10px;font:inherit;font-weight:600;cursor:pointer}
@media (max-width:900px){.game-head{grid-template-columns:96px minmax(0,1fr)}.vis{grid-column:1/-1}.vis .hint{text-align:left}}
@media (max-width:520px){.section-body table{display:block;overflow-x:auto}.seg{display:flex}.seg button{flex:1;padding:0 8px}.make input{width:100%}.make,.dash-actions{width:100%}}
`;

/** Each game's sections: a rail on the left, tabs along the top on phones. */
const GAME_STYLES = `
.bg-preview{position:relative;aspect-ratio:16/9;overflow:hidden;background:#05070a;margin-bottom:8px}
.bg-preview .backdrop{border:0}
.bg-preview .bg-picture{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:0}
.bg-preview [hidden]{display:none}
.bg-preview .bg-sample{position:absolute;z-index:1;left:6%;top:24%;width:56%;padding:var(--pad-pane);display:flex;flex-direction:column;gap:var(--gap-words-words);font:var(--type-note);color:var(--ink-2)}
.bg-preview .bg-sample strong{font:var(--type-name);color:var(--ink)}
.bg-note{position:absolute;z-index:2;left:8px;right:8px;bottom:8px;margin:0;padding:6px 10px;font-size:13px;background:rgba(10,12,16,.82);color:#f3f5f8}
.bg-screen h3{margin:18px 0 4px;font-size:15px}
.bg-now{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;margin:0 0 10px;font-size:14px}
.bg-now span{margin-right:auto}
.bg-screen form{display:inline}
.bg-screen form.stack{display:grid}
.bg-thumb{display:block;width:100%;padding:0;border:0;background:none;cursor:pointer}
.bg-thumb span{display:block;aspect-ratio:16/9;background:var(--pic)}
.bg-screen[data-screen="phone"] .bg-candidates{grid-template-columns:repeat(3,minmax(0,1fr))}
.bg-screen[data-screen="phone"] .bg-candidates img,.bg-screen[data-screen="phone"] .bg-thumb span,.bg-screen[data-screen="phone"] .bg-frames img{aspect-ratio:9/16}
.bg-screen[data-screen="phone"] figcaption{flex-wrap:wrap}
.bg-frames{display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin:4px 0 0}
.bg-frames img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.bg-levels{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin:0 0 8px;font-size:14px}
.bg-timings{margin:4px 0 0;font-size:13px}
.bg-folder{margin-top:10px}
.bg-folder .row{margin-top:10px}
.bg-folder-summary{font-size:14px;overflow-wrap:anywhere}
.bg-check{display:grid;gap:6px;margin-top:12px;font-size:14px}
.bg-check p{margin:0}
.bg-check img{width:100%;display:block}
.bg-textures h3{margin:18px 0 4px;font-size:15px}
.bg-tint{margin-top:16px;align-items:center}
.bg-tint input[type=color]{width:40px;height:30px;padding:0;border:0;background:none;vertical-align:middle;margin-left:6px}
.game-dash{display:grid;grid-template-columns:190px minmax(0,1fr);gap:32px;align-items:start}
.sections{position:sticky;top:84px;display:grid;gap:2px}
.sections a{position:relative;display:flex;align-items:center;min-height:40px;padding:0 12px;font-family:var(--display);font-weight:500;font-size:15px;color:var(--muted);text-decoration:none;white-space:nowrap}
.sections a:hover{color:var(--text)}
.sections [aria-current]{color:var(--text);background:linear-gradient(90deg,rgba(255,255,255,.07),rgba(255,255,255,0))}
.sections [aria-current]::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;background:var(--chrome);box-shadow:0 0 10px rgba(225,230,240,.35)}
.section-body .rule-h{margin:36px 0 16px}
.section-body>.rule-h:first-child,.section-body section>.rule-h:first-child,.section-body aside>.rule-h:first-child{margin-top:0}
.rule-h .muted{font-family:system-ui,sans-serif;font-weight:400;text-shadow:none;margin-left:-8px}
.section-body .drop+.rule-h{margin-top:36px}
.overview,.details-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:40px;align-items:start}
.game-alerts{list-style:none;padding:0;margin:0 0 24px;display:grid;gap:8px}
.game-alerts li{border-left:3px solid var(--warn);color:var(--text-2);margin:0}
.game-alerts a{color:var(--text);white-space:nowrap}
.numbers.compact{grid-template-columns:repeat(2,minmax(0,1fr))}
.numbers.compact .num strong{font-size:24px}
.overview .hint a,.section-body>.hint a{color:var(--text-2)}
.history{list-style:none;padding:0;margin:0;display:grid}
.history li{display:grid;gap:2px;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px;color:var(--text-2)}
.history .muted{font-size:13px}
.history+.later{margin-top:4px}
.meter{display:block;height:4px;margin-top:8px;background:rgba(0,0,0,.45);box-shadow:inset 0 1px 1px rgba(0,0,0,.6)}
.meter span{display:block;height:100%;background:var(--chrome)}
.num.reached .meter span{background:var(--warn)}
.num.reached small{color:var(--warn)}
.hosting-lead{color:var(--text-2);max-width:680px;margin:0 0 14px}
.numbers.hosting{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
.numbers.hosting .num:only-child{grid-column:1/-1;max-width:560px}
.numbers.hosting .meter{height:8px}
.numbers.hosting .meter+small{margin-top:6px}
.meter.split{display:flex;gap:3px;background:none;box-shadow:none}
.meter.split .part{display:block;height:100%;background:rgba(0,0,0,.45);box-shadow:inset 0 1px 1px rgba(0,0,0,.6)}
.meter.split .free{flex:1}
.meter.split .paid{flex:2}
.meter.split i{display:block;height:100%;background:var(--chrome)}
.num.reached .meter.split i{background:var(--warn)}
.meter-labels{display:flex;margin-top:6px}
.meter-labels small{flex:1}
.meter-labels small+small{flex:2;padding-left:3px}
.hosting-paused{border-left:4px solid var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent);padding:14px 18px;margin:0 0 16px;max-width:680px}
.hosting-paused strong{display:block;font-size:20px;color:var(--warn);margin-bottom:4px}
.hosting-paused p{margin:0;color:var(--text)}
.hosting-paused small{display:block;margin-top:4px;color:var(--text-2)}
.num.reached .meter-labels small,.num.reached .meter-labels+small{color:inherit}
@media (max-width:640px){.numbers.hosting{grid-template-columns:minmax(0,1fr)}}
.database{display:grid;grid-template-columns:240px minmax(0,1fr);gap:32px;align-items:start;margin-top:8px}
.database .note p{margin:0}
.database .note{margin-bottom:8px}
.schema{list-style:none;padding:0;margin:0;display:grid}
.schema li{border-bottom:1px solid var(--line)}
.schema summary{min-height:40px;display:flex;align-items:center;cursor:pointer;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;color:var(--text-2)}
.schema summary:hover{color:var(--text)}
.schema pre{margin:0 0 10px;font-size:12px}
@media (max-width:1100px){.overview,.details-layout{grid-template-columns:minmax(0,1fr)}}
@media (max-width:900px){.database{grid-template-columns:minmax(0,1fr)}}
@media (max-width:760px){.game-dash{grid-template-columns:minmax(0,1fr);gap:20px}
.sections{position:static;display:flex;overflow-x:auto;gap:0;margin:0 -16px;padding:0 16px;box-shadow:inset 0 -1px 0 var(--line);scrollbar-width:none}
.sections::-webkit-scrollbar{display:none}
.sections a{flex:none;min-height:44px}
.sections [aria-current]{background:none}
.sections [aria-current]::before{left:10px;right:10px;top:auto;bottom:0;width:auto;height:3px}}
`;

/** The dashboard's styles as a cached file, until its pages are rebuilt, so moving between them doesn't send them again. */
const DASHBOARD_STYLE = pageStyle("dashboard", () => STYLES + GAME_STYLES);

// Times in the reader's own time zone, and "publish later" sent as an exact moment.
// The QR code's PNG, drawn from its SVG at 1024 px in the browser, so the API only ever answers one format.
/**
 * The Background section's live preview (backgroundPanel), built as the home and game page build theirs: a shader runs in a frame on the
 * game's own site (apps/games/src/background.ts), posted by this page with its passes and its textures' bytes; the backdrop script
 * (BACKDROP_SCRIPT) tells the frame where the real pane of glass is, and picks the pane's glass from a still. Pictures show over the frame.
 * It starts with what wide screens show now, or Zaisma's own, at the device's quality level until one is picked.
 *
 * A shader folder (image.glsl, buffer-a.glsl to buffer-d.glsl, channels.json, its textures) previews as soon as it's picked, with each
 * texture_file in channels.json standing for that file. Checking or sending it first sends the textures it reads as shader_texture
 * pictures (a picture the game already has is used again) and waits for them to pass, then checks the shader (shader-checks) or sends
 * it (shaders), as a developer's tools do.
 */
const BACKGROUND_PREVIEW_SCRIPT = pageScript(
  "background-preview",
  `(()=>{const panel=document.querySelector(".bg-panel");if(!panel)return;
const frame=panel.querySelector(".bg-preview iframe"),picture=panel.querySelector(".bg-picture"),note=panel.querySelector(".bg-note");
const origin=new URL(frame.src).origin,ZAISMA=${JSON.stringify(`uniform float iDark;\n${SHADER_HELPERS}${ZAISMA_SHADER}`)};let ready=false,waiting=null,isChosen=false,qualityLevel=null;
const say=text=>{note.textContent=text||"";note.hidden=!text};
const post=message=>frame.contentWindow.postMessage(message,origin);
// The glass over it is measured from a still: the picture, or the frame the shader hands back (the backdrop script reads data-backdrop-still).
const measureFrom=url=>{if(url)frame.setAttribute("data-backdrop-still",url)};
// What the frame draws: { source } for one pass, or { manifest, textures } for a whole shader.
const run=message=>{isChosen=true;picture.hidden=true;say("");if(!ready){waiting=message;return}post(message)};
const show=url=>{isChosen=true;waiting=null;picture.src=url;picture.hidden=false;measureFrom(url);say("")};
addEventListener("message",event=>{if(event.source!==frame.contentWindow||!event.data||!event.data.zaismaBackground)return;
// Ready: the level picked, then what was chosen while it loaded, or Zaisma's own when nothing was.
if(event.data.isReady){ready=true;post({qualityLevel});if(waiting)post(waiting);else if(!isChosen)post({source:ZAISMA});waiting=null}
if(typeof event.data.stillDataUrl==="string"&&event.data.stillDataUrl.startsWith("data:image/")&&picture.hidden)measureFrom(event.data.stillDataUrl);
if(event.data.compileError)say("It doesn't compile: "+event.data.compileError);
if(event.data.error==="no_webgl")say("This browser can't run shaders here (it has no WebGL2); players see its still frame instead.")});
panel.querySelectorAll("[data-quality-level]").forEach(button=>button.addEventListener("click",()=>{qualityLevel=button.dataset.qualityLevel===""?null:Number(button.dataset.qualityLevel);
panel.querySelectorAll("[data-quality-level]").forEach(other=>other.setAttribute("aria-pressed",String(other===button)));if(ready)post({qualityLevel})}));
const fetched=async(url,kind)=>{const response=await fetch(url,{credentials:"same-origin"});if(!response.ok)throw new Error("couldn't load");return kind==="text"?response.text():response.arrayBuffer()};
// A sent shader, drawn as it was sent: each pass's source and its textures' bytes.
const runSent=async preview=>{const manifest={image:{source:await fetched(preview.image.source_url,"text"),channels:preview.image.channels},
buffers:await Promise.all(preview.buffers.map(async buffer=>({buffer_name:buffer.buffer_name,source:await fetched(buffer.source_url,"text"),channels:buffer.channels})))};
const textures=await Promise.all(Object.entries(preview.texture_urls).filter(entry=>entry[1]).map(async entry=>({imageId:entry[0],bytes:await fetched(entry[1],"bytes")})));
run({manifest,textures})};
panel.addEventListener("click",event=>{const button=event.target.closest("[data-preview-shader],[data-preview-picture]");if(!button)return;
if(button.dataset.previewPicture)show(button.dataset.previewPicture);
else runSent(JSON.parse(button.dataset.previewShader)).catch(()=>say("That shader couldn't be loaded."))});
panel.querySelectorAll("[data-preview-file]").forEach(input=>input.addEventListener("change",()=>{const file=input.files[0];if(!file)return;const reader=new FileReader();
if(/\\.(glsl|frag|txt)$/i.test(file.name)||file.type.startsWith("text/")){reader.onload=()=>run({source:String(reader.result)});reader.readAsText(file)}else{reader.onload=()=>show(String(reader.result));reader.readAsDataURL(file)}}));

// Shader folders.
const JUNK=new Set([".DS_Store","Thumbs.db","desktop.ini","__MACOSX"]),TEXTURE=/\\.(png|jpe?g|webp)$/i,BUFFERS=["buffer-a","buffer-b","buffer-c","buffer-d"];
const fromEntry=(entry,path,out)=>new Promise((done,fail)=>{if(JUNK.has(entry.name))return done();if(entry.isFile)return entry.file(file=>{out.push({file,path:path+entry.name});done()},fail);
const reader=entry.createReader(),all=[];const more=()=>reader.readEntries(async entries=>{if(!entries.length){for(const each of all)await fromEntry(each,path+entry.name+"/",out);return done()}all.push(...entries);more()},fail);more()});
// The files by their path in the folder, without the folder's own name.
const folderFiles=items=>{let files=items.filter(item=>!item.path.split("/").some(part=>JUNK.has(part)||part.startsWith(".")));
const tops=new Set(files.map(item=>item.path.split("/")[0]));if(tops.size===1&&files.every(item=>item.path.includes("/"))){const top=[...tops][0].length+1;files=files.map(item=>({file:item.file,path:item.path.slice(top)}))}return files};
async function readFolder(items){const files=folderFiles(items),byPath={};files.forEach(item=>{byPath[item.path.toLowerCase()]=item});
const image=byPath["image.glsl"];if(!image)throw new Error("The folder has no image.glsl: the image pass, which draws the background (Shadertoy's Image tab).");
const bufferNames=BUFFERS.filter(name=>byPath[name+".glsl"]),textures=files.filter(item=>TEXTURE.test(item.path)),used=new Set();let wiring={};
if(byPath["channels.json"]){try{wiring=JSON.parse(await byPath["channels.json"].file.text())}catch(error){throw new Error("channels.json isn't JSON: "+error.message)}
if(!wiring||typeof wiring!=="object"||Array.isArray(wiring))throw new Error("channels.json is an object: image and buffer-a to buffer-d, each a list of that pass's channels.")}
Object.keys(wiring).forEach(key=>{if(key!=="image"&&!bufferNames.includes(key))throw new Error("channels.json names "+key+", which isn't image or one of the folder's buffers ("+(bufferNames.join(", ")||"it has none")+").")});
// A texture channel names its file (texture_file); it reads that picture once it's sent.
const channelsOf=name=>(Array.isArray(wiring[name])?wiring[name]:[]).map(channel=>{if(!channel||typeof channel!=="object")throw new Error("channels.json's "+name+" has something that isn't a channel.");
const copy=Object.assign({},channel);delete copy.texture_file;if(copy.input_kind!=="texture")return copy;
const path=String(channel.texture_file||""),found=textures.find(item=>item.path.toLowerCase()===path.toLowerCase());
if(!found)throw new Error("channels.json's "+name+" reads the texture "+JSON.stringify(path)+(textures.length?", which isn't in the folder (it has "+textures.map(item=>item.path).join(", ")+").":", but the folder has no PNG, JPEG or WebP pictures."));
used.add(found);copy.image_id="file:"+found.path;return copy});
const manifest={image:{source:await image.file.text(),channels:channelsOf("image")},buffers:[]};
for(const name of bufferNames)manifest.buffers.push({buffer_name:name.slice(-1),source:await byPath[name+".glsl"].file.text(),channels:channelsOf(name)});
return {manifest,textures:textures.filter(item=>used.has(item)),imageIds:null}}
const api=async(method,path,body,isRaw)=>{const response=await fetch("/api/dev"+path,{method,headers:isRaw?{}:{"content-type":"application/json"},body:isRaw?body:body&&JSON.stringify(body)});
const answer=await response.json().catch(()=>({}));if(!response.ok)throw new Error(answer.error?answer.error.message+" "+answer.error.fix:"Zaisma didn't answer ("+response.status+").");return answer};
const hashOf=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
// The folder's textures as the game's pictures: one it has already is used again, so sending a folder twice doesn't fill its 16.
async function textureIds(box,folder,tell){if(folder.imageIds)return folder.imageIds;const slug=box.dataset.slug,ids={};
const kept=(await api("GET","/games/"+slug)).images.filter(image=>image.kind==="shader_texture"&&image.review_status!=="rejected");
for(const texture of folder.textures){const bytes=await texture.file.arrayBuffer(),hash=await hashOf(bytes);let id=null;
for(const image of kept.filter(each=>each.size_bytes===bytes.byteLength)){try{if(await hashOf(await fetched(image.image_url,"bytes"))===hash){id=image.id;break}}catch(error){}}
if(!id){tell("Sending "+texture.path+"…");id=(await api("POST","/games/"+slug+"/images?kind=shader_texture",bytes,true)).image.id}ids[texture.path]=id}
// Image matching passes them at once; one it couldn't check waits for a person.
for(let tryIndex=0;Object.keys(ids).length;tryIndex++){const images=(await api("GET","/games/"+slug)).images,states=Object.values(ids).map(id=>images.find(image=>image.id===id));
const refused=states.find(image=>!image||image.review_status==="rejected");if(refused)throw new Error("A texture wasn't approved"+(refused&&refused.review_reason?": "+refused.review_reason.message:"."));
if(states.every(image=>image.review_status==="approved"))break;
if(tryIndex>=20)throw new Error("A texture is waiting for a person to look at it, usually within a day. Send the folder again once it's approved.");
tell("Waiting for the textures to pass…");await new Promise(done=>setTimeout(done,3000))}
folder.imageIds=ids;return ids}
const withIds=(manifest,ids)=>JSON.parse(JSON.stringify(manifest),(key,value)=>key==="image_id"&&typeof value==="string"&&value.startsWith("file:")?ids[value.slice(5)]:value);
// What the check found, in words, with its sheet.
function showCheck(box,check,remaining){const result=box.querySelector("[data-folder-result]");result.replaceChildren();result.hidden=false;
const line=(text,className)=>{const paragraph=document.createElement("p");paragraph.textContent=text;if(className)paragraph.className=className;result.append(paragraph);return paragraph};
if(check.compile_error)line("It doesn't compile: "+check.compile_error,"hint bad");else{
line(check.quality_checks.map(level=>"Level "+level.quality_level+": "+level.check_frame_ms+" of "+level.maximum_check_frame_ms+" ms a frame"+(level.check_frame_ms>level.maximum_check_frame_ms?", too slow":"")).join(" · ")||"It was too slow to time.");
if(check.flash_count)line(check.flash_count>3?"It flashes "+check.flash_count+" times in a second; more than 3 is refused.":"It flashes at most "+check.flash_count+(check.flash_count===1?" time":" times")+" in a second; more than 3 is refused.");else if(check.flash_count===0)line("It doesn't flash.");
if(check.is_glass_smoked!==null)line("Zaisma would put "+(check.is_glass_smoked?"smoked":"light")+" glass over it, its tint at "+Math.round(check.glass_tint_pct)+"%.");
check.notes.forEach(each=>{const paragraph=line(each.message+" ");const fix=document.createElement("span");fix.className="muted";fix.textContent=each.fix;paragraph.append(fix)});
if(!check.notes.length)line("No notes: nothing to fix before sending.");
if(check.sheet_url){const link=document.createElement("a");link.href=check.sheet_url;link.target="_blank";link.rel="noopener";const sheet=document.createElement("img");sheet.src=check.sheet_url;
sheet.alt="The check's sheet: wide and phone under Zaisma's glass, small, what changes between two frames, and each level's time";link.append(sheet);result.append(link)}}
line(remaining+" checks before sending left today.","hint")}
panel.querySelectorAll(".bg-folder").forEach(box=>{const status=box.querySelector("[data-folder-status]"),summary=box.querySelector("[data-folder-summary]"),actions=box.querySelector("[data-folder-actions]");
let folder=null,isBusy=false;const tell=(text,isBad)=>{status.textContent=text;status.classList.toggle("bad",Boolean(isBad))};
async function pick(items){try{folder=await readFolder(items)}catch(error){folder=null;summary.hidden=true;actions.hidden=true;tell(error.message,true);return}
const passes=["image.glsl"].concat(folder.manifest.buffers.map(buffer=>"buffer-"+buffer.buffer_name+".glsl"));
summary.textContent=passes.join(", ")+(folder.textures.length?", reading "+folder.textures.map(item=>item.path).join(", "):"")+".";summary.hidden=false;actions.hidden=false;
box.querySelector("[data-folder-result]").hidden=true;tell("Previewing it above. Check before sending draws it as the check does, under Zaisma's glass, without sending it.");
run({manifest:folder.manifest,textures:await Promise.all(folder.textures.map(async item=>({imageId:"file:"+item.path,bytes:await item.file.arrayBuffer()})))})}
async function act(isSending){if(!folder||isBusy)return;isBusy=true;actions.querySelectorAll("button").forEach(button=>{button.disabled=true});
try{const ids=await textureIds(box,folder,tell),body=Object.assign({screen:box.dataset.screen},withIds(folder.manifest,ids));
if(isSending){tell("Sending the shader…");await api("POST","/games/"+box.dataset.slug+"/shaders",body);location.href=location.pathname+"?done=background-sent#background";return}
tell("Drawing it as the check does; this takes up to a minute or two…");const answer=await api("POST","/games/"+box.dataset.slug+"/shader-checks",body);
showCheck(box,answer.shader_check,answer.remaining_shader_check_count);tell("Checked. It isn't sent yet.")}catch(error){tell(error.message,true)}
finally{isBusy=false;actions.querySelectorAll("button").forEach(button=>{button.disabled=false})}}
box.querySelector("[data-folder-input]").addEventListener("change",event=>pick([...event.target.files].map(file=>({file,path:file.webkitRelativePath||file.name}))));
box.querySelector("[data-folder-check]").addEventListener("click",()=>act(false));box.querySelector("[data-folder-send]").addEventListener("click",()=>act(true));
box.addEventListener("dragover",event=>{event.preventDefault();box.classList.add("over")});box.addEventListener("dragleave",()=>box.classList.remove("over"));
box.addEventListener("drop",async event=>{event.preventDefault();box.classList.remove("over");const out=[];
try{for(const item of [...event.dataTransfer.items]){const entry=item.webkitGetAsEntry&&item.webkitGetAsEntry();if(entry)await fromEntry(entry,"",out)}}catch(error){tell("Couldn't read that folder. Use choose it instead.",true);return}pick(out)})});
const shown=panel.querySelector('.bg-screen[data-screen="wide"] .pill.live');if(shown){const button=shown.closest("figure").querySelector("[data-preview-shader],[data-preview-picture]");if(button)button.click()}})();`,
);

const QR_PNG_SCRIPT = pageScript("qr-png", `const button = document.getElementById("qr-png");
if (button) button.onclick = () => {
  const image = new Image();
  image.onload = () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 1024, height: 1024 });
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, 1024, 1024);
    canvas.toBlob((blob) => {
      const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: button.dataset.name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, "image/png");
  };
  image.src = button.dataset.svg;
};
`);

const LOCAL_TIMES_SCRIPT = pageScript("local-times", `document.querySelectorAll("time[data-local]").forEach(t=>{t.textContent=new Date(t.dateTime).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})});
document.querySelectorAll(".later form, form[data-local-time]").forEach(f=>{const l=f.elements.local;if(!l)return;const iso=l.dataset.iso;if(iso){const d=new Date(iso);l.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}f.addEventListener("submit",()=>{f.elements.at.value=l.value?new Date(l.value).toISOString():""})});
// Cancel puts a change form back as it was and closes it.
document.querySelectorAll("[data-cancel]").forEach(b=>b.onclick=()=>{const f=b.closest("form");f.reset();const l=f.elements.local;if(l&&l.dataset.iso){const d=new Date(l.dataset.iso);l.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}b.closest("details").open=false});
document.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent="Copied";setTimeout(()=>b.textContent="Copy",2000)}catch{b.previousElementSibling.select()}});`);

/**
 * Upload a folder from the browser, the same way the upload command does: hash every file, ask the
 * API which are missing, send those, then make the version. Signed in by the session cookie.
 */
const UPLOAD_SCRIPT = pageScript("upload", `(()=>{const form=document.getElementById("drop");if(!form)return;const slug=form.dataset.slug,status=document.getElementById("upload-status"),input=document.getElementById("folder");
const JUNK=new Set([".DS_Store","Thumbs.db","desktop.ini","__MACOSX",".git","node_modules"]),DIRECT=95*1048576;let busy=false;
const say=t=>{status.textContent=t};
const api=async(method,path,body,raw)=>{for(let i=0;;i++){const r=await fetch("/api/dev"+path,{method,headers:raw?{}:{"content-type":"application/json"},body:raw?body:body&&JSON.stringify(body)});
if(r.status===429&&i<6){say("Waiting a moment before sending more…");await new Promise(s=>setTimeout(s,10000));continue}
const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?d.error.message+" "+d.error.fix:"The upload failed ("+r.status+").");return d}};
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
const fromEntry=(entry,path,out)=>new Promise((ok,no)=>{if(JUNK.has(entry.name))return ok();if(entry.isFile)return entry.file(f=>{out.push({file:f,path:path+entry.name});ok()},no);
const reader=entry.createReader(),all=[];const more=()=>reader.readEntries(async es=>{if(!es.length){for(const e of all)await fromEntry(e,path+entry.name+"/",out);return ok()}all.push(...es);more()},no);more()});
async function upload(items){if(busy)return;busy=true;try{
let files=items.filter(f=>!f.path.split("/").some(p=>JUNK.has(p)));
// The folder itself, and a single wrapping folder, aren't part of the paths.
const strip=()=>{const tops=new Set(files.map(f=>f.path.split("/")[0]));if(tops.size===1&&files.every(f=>f.path.includes("/"))&&!files.some(f=>f.path.toLowerCase()==="index.html")){const t=[...tops][0]+"/";files=files.map(f=>({...f,path:f.path.slice(t.length)}));return true}return false};
while(strip());
const hidden=files.filter(f=>f.path.split("/").some(p=>p.startsWith(".")));files=files.filter(f=>!hidden.includes(f));
if(!files.length)throw new Error("That folder is empty.");
const big=files.find(f=>f.file.size>DIRECT);if(big)throw new Error(big.path+" is over 95 MB. Upload this game with: npx @zaisma/cli upload <folder> --game "+slug);
const list=[];for(let i=0;i<files.length;i++){say("Checking files… "+(i+1)+" of "+files.length);const f=files[i];f.sha256=hex(await crypto.subtle.digest("SHA-256",await f.file.arrayBuffer()));list.push({path:f.path,sha256:f.sha256,size_bytes:f.file.size})}
const plan=await api("POST","/games/"+slug+"/uploads",{files:list});const seen=new Set(),todo=files.filter(f=>plan.missing_file_hashes.includes(f.sha256)&&!seen.has(f.sha256)&&seen.add(f.sha256));
const total=todo.reduce((n,f)=>n+f.file.size,0);let sent=0;const mb=n=>(n/1048576).toFixed(1)+" MB";
const queue=[...todo];await Promise.all(Array.from({length:4},async()=>{for(let f=queue.shift();f;f=queue.shift()){await api("PUT","/files/"+f.sha256,f.file,true);sent+=f.file.size;say("Sending "+todo.length+" new or changed files… "+mb(sent)+" of "+mb(total))}}));
say("Making the version…");
await api("POST","/games/"+slug+"/versions",{files:list,patch_notes:document.getElementById("notes").value,publish_when_approved:document.getElementById("auto").checked});
location.href=location.pathname+"?done=uploaded"}catch(e){say(e.message);status.classList.add("error")}finally{busy=false}}
input.addEventListener("change",()=>{status.classList.remove("error");upload([...input.files].map(f=>({file:f,path:f.webkitRelativePath||f.name})))});
form.addEventListener("submit",e=>e.preventDefault());
form.addEventListener("dragover",e=>{e.preventDefault();form.classList.add("over")});form.addEventListener("dragleave",()=>form.classList.remove("over"));
form.addEventListener("drop",async e=>{e.preventDefault();form.classList.remove("over");status.classList.remove("error");const out=[];
try{for(const it of [...e.dataTransfer.items]){const en=it.webkitGetAsEntry&&it.webkitGetAsEntry();if(en)await fromEntry(en,"",out)}}catch{say("Couldn't read that folder. Use “choose it” instead.");return}upload(out)})})();`);
