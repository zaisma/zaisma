import { ACCOUNT_REQUIREMENTS, ApiError, accountById, CONTENT_RULES, CONTROLS, DEVICES, LINK_LIMITS, MINIMUM_PLAYER_AGES, OWN_SERVER_LIMITS, PLAY_STYLES, ROOM_BROWSING, SCREENS, type AccountRequirement, type ContentRule, type MinimumPlayerAge, type PlayMode, type RoomBrowsing } from "@zaisma/core";
import { currentSession, realEmail } from "./auth.ts";
import { apiCall, apiResponse, callerFor, GAME_ALERT_KINDS, type Caller, type GameAlertKind } from "./developer.ts";
import type { Env } from "./env.ts";
import { html, layout, metalButton, raw, scriptTags, type Raw } from "./html.ts";
import { emailAskBox, isEmailAskDue, securityAlertsBox, type UnseenSecurityAlert } from "./security-alerts.ts";
import { doneByText, eventTitle, whereText } from "./security-log.ts";
import { pageScript } from "./page-scripts.ts";

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
  kind: "cover" | "square" | "screenshot";
  review_status: "pending" | "approved" | "rejected";
  review_reason: ReviewReasonJson | null;
  image_url: string;
  created_at: string;
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

  // The games page also shows security alerts no email told them about, and asks for an email once there's something to lose.
  const isAskingForEmail = async () => {
    const account = await accountById(env.DB, caller.accountId);
    return account ? isEmailAskDue(env, account, realEmail(session.email)) : false;
  };
  if (path === "/dashboard" && !post) return done(await gamesPage(env, call, url.searchParams.get("error") ?? undefined, "", await isAskingForEmail()));
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
      if (error instanceof ApiError) return done(await gamesPage(env, call, error.messageWithFix, String(form.get("title") ?? ""), await isAskingForEmail()));
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
      return done(await apiResponse(env, caller, `/games/${slug}/export/download`));
    } catch (error) {
      if (error instanceof ApiError) return done(await managerPage(env, call, slug, "details", { error: error.messageWithFix }, error.httpStatus));
      throw error;
    }
  }

  if (!post) {
    const section = SECTIONS.find((each) => (each.path ? `/${each.path}` : "") === action);
    if (!section) return done(redirect(`/dashboard/${slug}`));
    return done(await managerPage(env, call, slug, section.id, { done: DONE[url.searchParams.get("done") ?? ""] }));
  }

  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  // A change comes back to the section its form is in, which a form says when it's on more than one.
  const sectionOfAction: Section =
    SECTIONS.find((each) => each.id === field("section"))?.id ??
    (action === "/details" || action === "/links" || action === "/own-servers" || action.startsWith("/images") ? "details" : action.startsWith("/testers") || action.startsWith("/versions/") ? "versions" : "overview");
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
      if (hiding && field("confirm") !== "yes") return done(await managerPage(env, call, slug, sectionOfAction, { confirmHide: visibility as GameJson["visibility"] }));
      await call("PATCH", `/games/${slug}`, { visibility });
      return back(sectionOfAction, "visibility");
    }
    if (action === "/images") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new ApiError("no_file", { message: "No image was chosen.", field: "file", fix: "Choose an image first." });
      const kind = field("kind") === "screenshot" ? "screenshot" : field("kind") === "square" ? "square" : "cover";
      await call("POST", `/games/${slug}/images?kind=${kind}`, new Uint8Array(await file.arrayBuffer()));
      return back("details", "image", "#images");
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
      if (what === "publish") await call("POST", `/games/${slug}/versions/${id}/publish`, {});
      if (what === "schedule") await call("POST", `/games/${slug}/versions/${id}/publish`, { scheduled_publish_at: field("at") });
      if (what === "unschedule") await call("DELETE", `/games/${slug}/versions/${id}/publish`);
      return back(sectionOfAction, what === "publish" ? "published" : `${what}d`);
    }
  } catch (error) {
    if (error instanceof ApiError) return done(await managerPage(env, call, slug, sectionOfAction, { error: error.messageWithFix }, error.httpStatus));
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

export function page(env: Env, title: string, body: Raw, httpStatus = 200, art: string | null = null): Response {
  const rendered = layout(env, { title: `${title} · Zaisma`, body: html`<style>${raw(STYLES + GAME_STYLES)}</style>${body}${scriptTags(LOCAL_TIMES_SCRIPT)}`, isPrivate: true, nav: "dashboard", art });
  return new Response(rendered.body, { status: httpStatus, headers: rendered.headers });
}

export const notice = (messages: { done?: string; error?: string }) =>
  messages.error ? html`<p class="error" role="alert">${messages.error}</p>` : messages.done ? html`<p class="done" role="status">${messages.done}</p>` : "";

/** A time, from the API (ISO) or the database (milliseconds), shown in the reader's own time zone. */
export const when = (instant: string | number) => html`<time datetime="${new Date(instant).toISOString()}" data-local>${new Date(instant).toISOString().slice(0, 16).replace("T", " ")} UTC</time>`;

const sizeText = (sizeBytes: number) => (sizeBytes >= 1048576 ? `${(sizeBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(sizeBytes / 1024))} KB`);

function coverOf(images: ImageJson[]): ImageJson | undefined {
  const covers = images.filter((i) => i.kind === "cover" && i.review_status !== "rejected");
  return covers.find((i) => i.review_status === "approved") ?? covers[0];
}

// --- Your games ---

async function gamesPage(env: Env, call: Call, error?: string, title = "", isAskingForEmail = false): Promise<Response> {
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
          return html`<div class="hit block"${cover ? raw(` data-art="${cover.image_url.replace(/"/g, "")}"`) : ""}><div class="tile">
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
    free_read_row_count: number;
    free_written_row_count: number;
    free_storage_size_bytes: number;
    has_reached_free_reads: boolean;
    has_reached_free_writes: boolean;
    has_reached_free_storage: boolean;
    reset_date: string;
  };
}
type Loaded = { game: GameJson; alerts: GameAlertJson[]; images: ImageJson[]; versions: VersionJson[]; testers: TesterJson[] };

async function managerPage(
  env: Env,
  call: Call,
  slug: string,
  section: Section,
  options: { done?: string; error?: string; confirmHide?: GameJson["visibility"] },
  httpStatus = 200,
): Promise<Response> {
  let loaded: Loaded;
  try {
    loaded = (await call("GET", `/games/${slug}`)) as Loaded;
  } catch (error) {
    if (error instanceof ApiError && error.httpStatus === 404) return page(env, "Game not found", html`<h1>Game not found</h1><p class="lead">${error.message}</p><a class="btn ghost" href="/dashboard">Your games</a>`, 404);
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
    body = detailsSection(slug, loaded);
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
    cover?.image_url ?? null,
  );
}

/** Where on the dashboard each kind of alert is dealt with. A kind this page doesn't know shows its message alone. */
const ALERT_PLACES: Partial<Record<GameAlertKind, { section: Section; hash: string; label: string }>> = {
  version_rejected: { section: "versions", hash: "", label: "See why" },
  version_held: { section: "versions", hash: "", label: "See why" },
  rooms_paused: { section: "players", hash: "#hosting", label: "Free hosting" },
  requests_paused: { section: "players", hash: "#hosting", label: "Free hosting" },
  database_paused: { section: "database", hash: "", label: "Database" },
  database_writes_paused: { section: "database", hash: "", label: "Database" },
  database_full: { section: "database", hash: "", label: "Database" },
  rooms_nearly_paused: { section: "players", hash: "#hosting", label: "Free hosting" },
  requests_nearly_paused: { section: "players", hash: "#hosting", label: "Free hosting" },
  database_nearly_paused: { section: "database", hash: "", label: "Database" },
  database_writes_nearly_paused: { section: "database", hash: "", label: "Database" },
  database_nearly_full: { section: "database", hash: "", label: "Database" },
  reports_open: { section: "players", hash: "#reports", label: "See them" },
  link_flagged: { section: "details", hash: "#links", label: "Links" },
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
function detailsSection(slug: string, { game, images }: Loaded): Raw {
  return html`<div class="details-layout">
<section><h2 class="rule-h" id="details">Details</h2>${detailsForm(slug, game)}
<h2 class="rule-h" id="links">Links</h2>${linksForm(slug, game)}
<h2 class="rule-h" id="own-servers">Your own servers</h2>${ownServersForm(slug, game)}
<h2 class="rule-h" id="export">Export</h2>${exportPanel(slug)}</section>
<aside><h2 class="rule-h" id="images">Cover and screenshots</h2>${imagesPanel(slug, images)}</aside>
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
${statsPanel(stats, ownServer)}`;
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
  const use = stats.room_use_this_month;
  const requestUse = stats.request_use_this_month;
  const showsRequests = own || requestUse.request_count > 0;
  if (game.multiplayer_mode === "none" && !use.counted_play_duration_hours && !use.has_reached_free_hours && !showsRequests) return "";
  const resetDay = nextMonthStart();
  const percent = (usedNumber: number, freeNumber: number) => Math.min(100, Math.round((usedNumber / Math.max(freeNumber, 1)) * 100));
  const relayHours = Math.round((use.counted_play_duration_hours - use.room_play_duration_hours) * 10) / 10;
  const parts = use.relayed_size_bytes > 0
    ? html`<small>${formatted(use.room_play_duration_hours)} in Zaisma rooms, ${formatted(relayHours)} from ${formatted(Math.round(use.relayed_size_bytes / 1_000_000))} MB through Zaisma's relay</small>`
    : "";
  return html`<h2 class="rule-h" id="hosting">Free hosting <span class="muted">This month</span></h2>
<p class="hosting-lead">Your game is on Zaisma's free tier. Hosting is counted in player-hours: one player in a Zaisma room for an hour is one, and so is every 20 MB Zaisma's relay sends your players when they connect to each other. The first ${formatted(use.free_room_play_duration_hours)} each month are free.</p>
<div class="numbers hosting">
<div class="num plate${use.has_reached_free_hours ? " reached" : ""}"><strong>${formatted(use.counted_play_duration_hours)}</strong><span>player-hours used</span><small>${use.has_reached_free_hours ? html`All ${formatted(use.free_room_play_duration_hours)} free ones used: new rooms and connections between players open again on ${resetDay}` : html`of ${formatted(use.free_room_play_duration_hours)} free`}</small><span class="meter"><span style="width:${percent(use.counted_play_duration_hours, use.free_room_play_duration_hours)}%"></span></span>${parts}</div>
${showsRequests
    ? html`<div class="num plate${requestUse.has_reached_free_requests ? " reached" : ""}"><strong>${formatted(requestUse.request_count)}</strong><span>requests to your game server</span><small>of ${formatted(requestUse.free_request_count)} free${requestUse.has_reached_free_requests ? html`, all used: they answer request_limit until ${resetDay}` : ""}</small><span class="meter"><span style="width:${percent(requestUse.request_count, requestUse.free_request_count)}%"></span></span></div>`
    : ""}
</div>
<p class="hint">Starts again from 0 on ${resetDay} (UTC). Hosting billing isn't here yet, so for now the free tier is the most a game can use: once it's used, new rooms and connections between players don't open until the month resets, and matches already running carry on. Rooms and a relay on your own servers are never counted.</p>`;
}

/**
 * The game's own SQLite database: the month's use, its tables beside how to reach it. The SQL console
 * (Game database console) takes the main column.
 */
function databaseSection(slug: string, database: DatabaseJson | string): Raw {
  if (typeof database === "string") return html`<p class="error" role="alert">${database}</p>`;
  const use = database.database_use_this_month;
  const meter = (label: string, usedNumber: number, freeNumber: number, shown: (shownNumber: number) => string, reached: boolean) =>
    html`<div class="num plate${reached ? " reached" : ""}"><strong>${shown(usedNumber)}</strong><span>${label}</span><small>of ${shown(freeNumber)} free${reached ? ", all used" : ""}</small><span class="meter"><span style="width:${Math.min(100, Math.round((usedNumber / Math.max(freeNumber, 1)) * 100))}%"></span></span></div>`;
  const tables = database.tables;
  return html`<div class="numbers">
${meter("Rows read this month", use.read_row_count, use.free_read_row_count, formatted, use.has_reached_free_reads)}
${meter("Rows written this month", use.written_row_count, use.free_written_row_count, formatted, use.has_reached_free_writes)}
${meter("Stored", use.storage_size_bytes, use.free_storage_size_bytes, sizeText, use.has_reached_free_storage)}
</div>
<p class="hint">Reads and writes start again from 0 on ${use.reset_date} (UTC). Until hosting billing is ready, past the free reads queries stop, past the free writes only reads work, and a full database can change and delete rows but not grow.</p>
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
<form method="post" action="${action("publish")}">${sectionField(section)}<button class="btn light" type="submit">${version.published_at ? "Roll back to this" : "Publish"}</button></form>
${version.preview_url ? html`<details class="later"><summary>Preview links</summary><form class="row" method="post" action="${action("end-previews")}">${sectionField(section)}<span class="muted">Each preview link is for you and your AI and works for a day. Shared one too widely? Turn them all off; Preview gets a fresh one.</span><button class="btn ghost" type="submit">Turn off preview links</button></form></details>` : ""}
${version.scheduled_publish_at ? "" : html`<details class="later"><summary>Publish later</summary><form class="row" method="post" action="${action("schedule")}">${sectionField(section)}<input type="datetime-local" name="local" required aria-label="When"><input type="hidden" name="at"><button class="btn ghost" type="submit">Schedule</button></form></details>`}
</div>`;
  } else if (version.scan_status === "scanning") {
    acts = html`<p class="muted">Being scanned. This usually takes under a minute.</p>`;
  }
  // Held and rejected versions say why: a person's or a report's decision, and what the scan found.
  const isHeldBack = version.scan_status === "held" || version.scan_status === "rejected";
  const findings = isHeldBack ? version.findings : [];
  const fixes = [...new Set(findings.map((finding) => finding.fix))];
  return html`<li class="${version.is_live ? "live edge" : ""}">
<div class="version-head"><strong>${version.is_live ? html`<span class="badge">Live</span> ` : ""}${version.id.slice(0, 16)}</strong><span class="muted">${when(version.created_at)} · ${version.file_count} files, ${sizeText(version.size_bytes)}</span>${version.is_live ? "" : html`<span class="pill ${version.scan_status}">${version.scan_status === "approved" ? (version.published_at ? "Was live" : "Ready") : version.scan_status[0]!.toUpperCase() + version.scan_status.slice(1)}</span>`}</div>
${version.patch_notes ? html`<p class="version-notes">${version.patch_notes}</p>` : ""}
${isHeldBack && version.review_reason ? reasonPanel(slug, version.review_reason) : ""}
${findings.length
      ? html`<div class="reason"><ul class="findings">${findings.map(
          (finding) => html`<li>${finding.message}${finding.path ? html` <span class="muted">(${finding.path})</span>` : ""}<br><span class="muted">${finding.content_rule ? html`${ruleLink(finding.content_rule)} · ` : ""}<code>${finding.code}</code></span></li>`,
        )}</ul>${fixes.map((fix) => html`<p class="fix">${fixForPeople(slug, fix)}</p>`)}</div>`
      : ""}
${scheduled}${acts}
</li>`;
}

function detailsForm(slug: string, game: GameJson): Raw {
  const waiting = game.details_waiting_for_review;
  return html`<form class="stack" method="post" action="/dashboard/${slug}/details">
${waiting ? html`<p class="note small">Waiting for review: ${[waiting.title ? `title "${waiting.title}"` : "", waiting.description ? "a new description" : ""].filter(Boolean).join(" and ")}.</p>` : ""}
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
<a class="btn" href="/dashboard/${slug}/export.zip" download>Export everything</a>
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

const KIND_LABELS: Record<ImageJson["kind"], string> = { cover: "Cover", square: "Square cover", screenshot: "Screenshot" };

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
  const parts = fix.split(/(message_zaisma(?: with the (?:game_slug|version_id))?|add_image|update_game)/);
  return html`${parts.map((part, i) =>
    i % 2 === 0 ? part : part.startsWith("message_zaisma") ? html`<a href="${message}">message Zaisma</a>` : part === "add_image" ? html`<a href="/dashboard/${slug}/details#images">Add image</a>` : html`<a href="/dashboard/${slug}/details">the details here</a>`,
  )}`;
}

/** A content rule, linked to where the rules page says it. */
const ruleLink = (rule: ContentRule) => html`The rule: <a href="/legal/content-rules#${rule}" target="_blank" rel="noopener">${CONTENT_RULES[rule]}</a>`;

function imagesPanel(slug: string, images: ImageJson[]): Raw {
  const shown = images.filter((i) => i.review_status !== "rejected");
  // Only the latest few that weren't approved, each with why; rejected images are never served, so no picture.
  const rejected = images.filter((image) => image.review_status === "rejected" && image.review_reason).slice(0, 3);
  return html`${rejected.map(
    (image) => html`<div class="note rejected-image"><p><strong>The ${KIND_LABELS[image.kind].toLowerCase()} you sent ${when(image.created_at)} wasn't approved.</strong></p>${reasonPanel(slug, image.review_reason!)}
<form method="post" action="/dashboard/${slug}/images/${image.id}/remove"><button class="link" type="submit">Clear this</button></form></div>`,
  )}
${shown.length
    ? html`<div class="thumbs">${shown.map(
        (i) => html`<figure><img class="bevel-s${i.kind === "square" ? " sq" : ""}" src="${i.image_url}" alt="" loading="lazy"><figcaption><span>${KIND_LABELS[i.kind]}${i.review_status === "pending" ? html` <span class="pill pending">In review</span>` : ""}</span>
<form method="post" action="/dashboard/${slug}/images/${i.id}/remove"><button class="link" type="submit">Remove</button></form></figcaption></figure>`,
      )}</div>`
    : html`<p class="muted">No cover yet. Players see it on the game page and in lists.</p>`}
<form class="stack" method="post" action="/dashboard/${slug}/images" enctype="multipart/form-data">
<div class="row"><select name="kind" aria-label="Kind"><option value="cover">Cover</option><option value="square">Square cover</option><option value="screenshot">Screenshot</option></select><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Image"></div>
<p class="hint">Players see your cover alone as your game's card, so put your game's name or logo on it. The cover is landscape (16:9 shows best). The square cover is optional: phones show it instead, where a landscape one would be small; at least 512 px. Screenshots are just the game. PNG, JPEG or WebP, up to 5 MB, at least 320 px a side.</p>
<button class="btn" type="submit">Add image</button>
</form>`;
}

interface Reports {
  reasons: { reason: string; label: string; open_count: number; closed_count: number }[];
  bug_reports: { player_text: string; reported_at: string }[];
}

function reportsPanel(reports: Reports): Raw {
  if (!reports.reasons.length) return html`<p class="muted">No reports in the last 90 days.</p>`;
  return html`<table><thead><tr><th>Reason</th><th>Waiting for us</th><th>Looked at</th></tr></thead><tbody>${reports.reasons.map((reason) => html`<tr><td>${reason.label}</td><td>${reason.open_count}</td><td>${reason.closed_count}</td></tr>`)}</tbody></table>
${reports.bug_reports.length ? html`<h3>What players said about bugs</h3><ul class="said">${reports.bug_reports.map((bug) => html`<li>${bug.player_text} <span class="muted">${when(bug.reported_at)}</span></li>`)}</ul>` : ""}`;
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
    game_server: { call_count: number; request_count: number; scheduled_run_count: number; crash_count: number; stopped_count: number; ended_match_count: number } | null;
  }[];
  room_use_this_month: { room_play_duration_hours: number; relayed_size_bytes: number; counted_play_duration_hours: number; free_room_play_duration_hours: number; has_reached_free_hours: boolean };
  request_use_this_month: { request_count: number; free_request_count: number; has_reached_free_requests: boolean };
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

function statsPanel(stats: Stats, own: boolean): Raw {
  const days = stats.multiplayer_days;
  if (!days.length) return html`<p class="muted">No multiplayer rooms in the last 30 days.</p>${schedulesTable(stats.schedules)}`;
  const topDurationMin = Math.max(...days.map((day) => day.room_play_duration_min), 1);
  return html`<table><thead><tr><th>Day</th><th>Rooms</th><th>Player minutes</th>${own ? html`<th>Requests</th><th>Scheduled runs</th><th>Game server errors</th><th>Stopped</th><th>Matches ended</th>` : ""}</tr></thead><tbody>${days.map(
    (day) => html`<tr><td class="nowrap">${day.date}</td><td>${day.room_count}</td><td><span class="bar" style="width:${Math.round((day.room_play_duration_min / topDurationMin) * 100)}%"></span>${day.room_play_duration_min}</td>${
      own ? html`<td>${formatted(day.game_server?.request_count ?? 0)}</td><td>${formatted(day.game_server?.scheduled_run_count ?? 0)}</td><td>${day.game_server?.crash_count ?? 0}</td><td>${day.game_server?.stopped_count ?? 0}</td><td>${day.game_server?.ended_match_count ?? 0}</td>` : ""
    }</tr>`,
  )}</tbody></table>${schedulesTable(stats.schedules)}${own ? serverErrors(stats.game_server_errors) : ""}`;
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
function serverErrors(errors: Stats["game_server_errors"]): Raw {
  if (!errors.length) return html`<p class="muted">No errors from your game server in the last 30 days.</p>`;
  return html`<h3>Your game server's errors</h3>
<p class="hint">An error loses that one message, tick, request or scheduled run, and the match carries on. Stopped means it ran on too long, like a loop that never ends: the match froze for about 2 seconds, and a match stopped twice ends.</p>
<table><thead><tr><th>What happened</th><th>Times</th><th>Last</th></tr></thead><tbody>${errors.map(
    (serverError) => html`<tr><td>${serverError.kind === "stopped" ? serverError.message : html`<code>${serverError.message}</code>`}</td><td>${serverError.occurrence_count}</td><td class="nowrap">${when(serverError.last_at)}</td></tr>`,
  )}</tbody></table>`;
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

// Times in the reader's own time zone, and "publish later" sent as an exact moment.
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
