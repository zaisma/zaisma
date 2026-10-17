import { ACCOUNT_REQUIREMENTS, ApiError, CONTENT_RULES, CONTROLS, DEVICES, PLAY_STYLES, ROOM_BROWSING, SCREENS, type AccountRequirement, type ContentRule, type PlayMode, type RoomBrowsing } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { apiCall, callerFor, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { html, layout, metalButton, raw, type Raw } from "./html.ts";

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
  multiplayer_mode: "none" | "relay" | "own" | "built-in";
  room_browsing: RoomBrowsing;
  account_requirement: AccountRequirement;
  details_waiting_for_review: { title: string | null; description: string | null } | null;
  updated_at: string;
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
};

export async function handleDashboard(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== "/dashboard" && !path.startsWith("/dashboard/")) return null;
  const post = request.method === "POST";
  if (post && request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });

  const session = await currentSession(request, env);
  if (!session) return redirect(`/signin?next=${encodeURIComponent(path)}`, []);
  const caller = await callerFor(env, session.userId, session.cookies);
  if (!caller) return redirect("/join?next=/dashboard", session.cookies);
  const call = (method: string, apiPath: string, body?: unknown) => apiCall(env, caller, method, apiPath, body);
  const done = (response: Response) => withCookies(response, session.cookies);
  const url = new URL(request.url);

  if (path === "/dashboard" && !post) return done(await gamesPage(env, call, url.searchParams.get("error") ?? undefined));
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
      if (error instanceof ApiError) return done(await gamesPage(env, call, error.messageWithFix, String(form.get("title") ?? "")));
      throw error;
    }
  }

  const pathMatch = path.match(/^\/dashboard\/([a-z0-9-]+)(\/.*)?$/);
  if (!pathMatch) return null;
  const slug = pathMatch[1]!;
  const action = pathMatch[2] ?? "";
  const back = (key: string, hash = "") => done(redirect(`/dashboard/${slug}?done=${key}${hash}`));

  if (!action && !post) return done(await managerPage(env, call, slug, { done: DONE[url.searchParams.get("done") ?? ""] }));
  if (!post) return done(redirect(`/dashboard/${slug}`));

  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
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
        ...(form.has("room_browsing") ? { room_browsing: field("room_browsing") } : {}),
        ...(form.has("account_requirement") ? { account_requirement: field("account_requirement") } : {}),
        ...(form.has("multiplayer") ? { multiplayer_mode: field("multiplayer") } : {}),
      })) as { review_message: string | null; game_server_problem: string | null };
      if (saved.game_server_problem) return back("multiplayer-no-file", "#details");
      return back(saved.review_message ? "details-review" : "details", "#details");
    }
    if (action === "/visibility") {
      const visibility = field("visibility");
      const { game } = (await call("GET", `/games/${slug}`)) as { game: GameJson };
      const hiding = (visibility === "private" || visibility === "draft") && (game.visibility === "listed" || game.visibility === "unlisted") && game.review_status === "live";
      if (hiding && field("confirm") !== "yes") return done(await managerPage(env, call, slug, { confirmHide: visibility as GameJson["visibility"] }));
      await call("PATCH", `/games/${slug}`, { visibility });
      return back("visibility");
    }
    if (action === "/images") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new ApiError("no_file", { message: "No image was chosen.", field: "file", fix: "Choose an image first." });
      const kind = field("kind") === "screenshot" ? "screenshot" : field("kind") === "square" ? "square" : "cover";
      await call("POST", `/games/${slug}/images?kind=${kind}`, new Uint8Array(await file.arrayBuffer()));
      return back("image", "#images");
    }
    const imagePath = action.match(/^\/images\/([a-z0-9_]+)\/remove$/);
    if (imagePath) {
      await call("DELETE", `/games/${slug}/images/${imagePath[1]}`);
      return back("image-removed", "#images");
    }
    if (action === "/testers") {
      await call("POST", `/games/${slug}/testers`, { name: field("name") });
      return back("tester-added", "#testers");
    }
    const tester = action.match(/^\/testers\/([a-z0-9_]+)\/remove$/);
    if (tester) {
      await call("DELETE", `/games/${slug}/testers/${tester[1]}`);
      return back("tester-removed", "#testers");
    }
    const versionPath = action.match(/^\/versions\/([a-z0-9_]+)\/(publish|schedule|unschedule)$/);
    if (versionPath) {
      const [, id, what] = versionPath;
      if (what === "publish") await call("POST", `/games/${slug}/versions/${id}/publish`, {});
      if (what === "schedule") await call("POST", `/games/${slug}/versions/${id}/publish`, { scheduled_publish_at: field("at") });
      if (what === "unschedule") await call("DELETE", `/games/${slug}/versions/${id}/publish`);
      return back(what === "publish" ? "published" : `${what}d`, "#versions");
    }
  } catch (error) {
    if (error instanceof ApiError) return done(await managerPage(env, call, slug, { error: error.messageWithFix }, error.httpStatus));
    throw error;
  }
  return done(redirect(`/dashboard/${slug}`));
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
  const rendered = layout(env, { title: `${title} · Zaisma`, body: html`<style>${raw(STYLES)}</style>${body}<script>${raw(LOCAL_TIMES)}</script>`, isPrivate: true, nav: "dashboard", art });
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

async function gamesPage(env: Env, call: Call, error?: string, title = ""): Promise<Response> {
  const { games, unread_topic_count: unreadTopicCount } = (await call("GET", "/games")) as { games: GameJson[]; unread_topic_count: number };
  const details = await Promise.all(games.map((game) => call("GET", `/games/${game.slug}`) as Promise<{ images: ImageJson[]; versions: VersionJson[] }>));
  const make = html`<form class="make" method="post" action="/dashboard/new">
<input name="title" maxlength="80" required placeholder="Your game's name" aria-label="Your game's name" value="${title}">
${metalButton("Make a game", { type: "submit" })}
</form>`;
  return page(
    env,
    "Your games",
    html`<div class="dash-head"><h1>Your games</h1>${make}</div>
${notice({ error })}
${unreadTopicCount ? html`<p class="done" role="status">Zaisma replied to ${unreadTopicCount === 1 ? "one of your forum topics" : `${unreadTopicCount} of your forum topics`}. <a href="/forum?tab=yours">Read ${unreadTopicCount === 1 ? "it" : "them"}</a></p>` : ""}
${games.length
      ? html`<div class="grid">${games.map((game, i) => {
          const cover = coverOf(details[i]!.images);
          const live = details[i]!.versions.find((version) => version.is_live);
          const waitingDraftCount = details[i]!.versions.filter((version) => !version.is_live && version.scan_status === "approved" && !version.published_at).length;
          return html`<div class="hit block"${cover ? raw(` data-art="${cover.image_url.replace(/"/g, "")}"`) : ""}><div class="tile">
<a class="pic" href="/dashboard/${game.slug}" tabindex="-1" aria-hidden="true">${cover ? html`<img src="${cover.image_url}" alt="" loading="lazy">` : ""}</a>
<div class="body"><a class="name" href="/dashboard/${game.slug}"><span>${game.title}</span><small>${VISIBILITY[game.visibility].label} · ${REVIEW[game.review_status]}${live ? "" : " · no live version"}</small></a>
${waitingDraftCount ? html`<span class="badge">${waitingDraftCount === 1 ? "Draft ready" : `${waitingDraftCount} drafts ready`}</span>` : ""}</div>
</div></div>`;
        })}</div>`
      : html`<div class="first note"><p><strong>No games yet.</strong> Give your game a name above, then upload its folder. A game is any folder with an index.html at the top: an HTML game, or a web export from Godot, Unity, Phaser or any other engine.</p></div>`}
<h2 class="rule-h">Work from your AI or terminal</h2>
<div class="ways">
<div class="way"><h3>Your AI</h3><p class="muted">Claude Code, Cursor or any tool that takes MCP servers can make, upload and publish games for you.</p>
<pre>claude mcp add --transport http -s user zaisma ${env.SITE_ORIGIN}/mcp --header "Authorization: Bearer $ZAISMA_KEY"</pre></div>
<div class="way"><h3>Your terminal</h3><p class="muted">Upload a build folder; only changed files are sent.</p>
<pre>npx @zaisma/cli upload ./build --game your-game</pre></div>
</div>
<p class="muted">Both need an API key: <a href="/account#developer">make one on your account page</a> and set it as ZAISMA_KEY.</p>`,
  );
}

// --- One game ---

async function managerPage(
  env: Env,
  call: Call,
  slug: string,
  options: { done?: string; error?: string; confirmHide?: GameJson["visibility"] },
  httpStatus = 200,
): Promise<Response> {
  let loaded: { game: GameJson; images: ImageJson[]; versions: VersionJson[]; testers: TesterJson[] };
  try {
    loaded = (await call("GET", `/games/${slug}`)) as typeof loaded;
  } catch (error) {
    if (error instanceof ApiError && error.httpStatus === 404) return page(env, "Game not found", html`<h1>Game not found</h1><p class="lead">${error.message}</p><a class="btn ghost" href="/dashboard">Your games</a>`, 404);
    throw error;
  }
  // Held and rejected versions come with what the scan found.
  const { game, images, versions, testers } = loaded;
  const [reports, stats, history] = (await Promise.all([
    call("GET", `/games/${slug}/reports`),
    call("GET", `/games/${slug}/stats?period_duration_days=30`),
    call("GET", `/games/${slug}/history`),
  ])) as unknown as [Reports, Stats, { events: { description: string; version_id: string | null; done_by: "you" | "zaisma"; happened_at: string; review_reason: ReviewReasonJson | null }[] }];
  const cover = coverOf(images);
  const removed = game.review_status === "removed";
  const openReportCount = reports.reasons.reduce((openCount, reason) => openCount + reason.open_count, 0);

  return page(
    env,
    game.title,
    html`<p class="crumbs"><a href="/dashboard">Your games</a></p>
<div class="game-head">
<div class="cover pic bevel">${cover ? html`<img src="${cover.image_url}" alt="">` : ""}</div>
<div class="who">
<h1>${game.title}</h1>
<p class="muted"><span class="pill ${game.review_status}">${REVIEW[game.review_status]}</span> ${game.visibility === "listed" || game.visibility === "unlisted" ? html`<a href="${game.page_url}">${game.page_url.replace(/^https?:\/\//, "")}</a>` : html`zaisma.com/g/${game.slug}`}</p>
</div>
<form class="vis" method="post" action="/dashboard/${slug}/visibility" aria-label="Who can play">
<div class="seg">${(["listed", "unlisted", "private", "draft"] as const).map(
      (visibility) => html`<button name="visibility" value="${visibility}" title="${VISIBILITY[visibility].hint}" aria-pressed="${game.visibility === visibility}"${removed ? raw(" disabled") : ""}>${VISIBILITY[visibility].label}</button>`,
    )}</div>
<p class="hint">${VISIBILITY[game.visibility].hint}.</p>
</form>
</div>
${options.confirmHide
      ? html`<div class="note confirm" role="alert"><p><strong>Players can play ${game.title} now.</strong> ${options.confirmHide === "draft" ? "Making it a draft" : "Making it private"} takes it away from them, and its link stops working.</p>
<form class="row" method="post" action="/dashboard/${slug}/visibility"><input type="hidden" name="visibility" value="${options.confirmHide}"><input type="hidden" name="confirm" value="yes">
<button class="btn danger" type="submit">Hide it from players</button><a class="btn ghost" href="/dashboard/${slug}">Keep it</a></form></div>`
      : ""}
${game.review_reason ? html`<div class="note held-game" role="status">${reasonPanel(slug, game.review_reason, removed ? "Zaisma took this game down." : "Players can't open this game right now.")}</div>` : ""}
${notice(options)}
<div class="manage">
<section class="main">
${removed ? "" : uploadPanel(slug)}
<h2 class="rule-h" id="versions">Versions</h2>
${versions.length ? html`<ol class="track">${versions.map((version) => versionRow(slug, version))}</ol>` : html`<p class="muted">No versions yet.</p>`}
<p class="hint">Zaisma keeps the live version and the last 5 that passed, for rolling back. Drafts nobody publishes are deleted after 30 days.</p>
<h2 class="rule-h" id="testers">Tester links</h2>
${testersPanel(slug, game, testers, versions.some((version) => version.is_live))}
</section>
<aside>
<h2 id="details">Details</h2>
${detailsForm(slug, game)}
<h2 id="images">Cover and screenshots</h2>
${imagesPanel(slug, images)}
</aside>
</div>
<div class="facts">
<details open><summary><h2>Plays</h2><span class="muted">Last 30 days</span></summary>${playsPanel(stats.play_stats)}</details>
<details${openReportCount ? raw(" open") : ""}><summary><h2>Player reports${openReportCount ? ` (${openReportCount} open)` : ""}</h2></summary>${reportsPanel(reports)}</details>
<details${stats.room_use_this_month.has_reached_free_hours || stats.request_use_this_month.has_reached_free_requests ? raw(" open") : ""}><summary><h2>Multiplayer and game server use${stats.room_use_this_month.has_reached_free_hours ? " (new rooms paused)" : stats.request_use_this_month.has_reached_free_requests ? " (requests paused)" : ""}</h2></summary>${statsPanel(stats, game.multiplayer_mode === "own" || stats.schedules.length > 0 || stats.multiplayer_days.some((day) => day.game_server !== null))}</details>
<details><summary><h2>History</h2></summary>${history.events.length ? html`<table><tbody>${history.events.map((event) => html`<tr><td class="nowrap">${when(event.happened_at)}</td><td>${event.description}${event.version_id ? html` <span class="muted">(${event.version_id.slice(0, 16)})</span>` : ""}${event.review_reason ? html`<br><span class="muted">${event.review_reason.message} <code>${event.review_reason.code}</code></span>` : ""}</td><td class="muted">${event.done_by === "you" ? "You" : "Zaisma"}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nothing yet.</p>`}</details>
</div>`,
    httpStatus,
    cover?.image_url ?? null,
  );
}

interface TesterJson {
  id: string;
  name: string;
  link_url: string;
  created_at: string;
  last_opened_at: string | null;
}

/** Secret links that open the live version whatever the visibility: one per group, each turned off on its own. */
function testersPanel(slug: string, game: GameJson, testers: TesterJson[], live: boolean): Raw {
  const removed = game.review_status === "removed";
  return html`<p class="hint">Anyone with a tester link plays your live version, even while the game is private or a draft, with no account needed. Make one for each group, like your team or a streamer, so you can turn one off without the others.${live ? "" : " Publish a version first: the links open the live version."}</p>
${testers.length
      ? html`<ul class="testers">${testers.map(
          (link) => html`<li class="plate">
<div class="tester-link-head"><strong>${link.name}</strong><span class="muted">${link.last_opened_at ? html`Last opened ${when(link.last_opened_at)}` : "Not opened yet"}</span></div>
<div class="row"><input readonly value="${link.link_url}" aria-label="Tester link for ${link.name}"><button class="btn ghost" type="button" data-copy="${link.link_url}">Copy</button>
<form method="post" action="/dashboard/${slug}/testers/${link.id}/remove"><button class="btn ghost" type="submit">Turn off</button></form></div>
</li>`,
        )}</ul>`
      : ""}
${removed ? "" : html`<form class="row make-tester" method="post" action="/dashboard/${slug}/testers"><input name="name" maxlength="60" required placeholder="Who it's for, like Playtesters" aria-label="Who the link is for"><button class="btn light" type="submit">Make a tester link</button></form>`}`;
}

function uploadPanel(slug: string): Raw {
  return html`<form class="drop bevel" id="drop" data-slug="${slug}">
<p><strong>Upload a new version.</strong> Drop your game's folder here, or <label class="pick">choose it<input type="file" id="folder" webkitdirectory multiple hidden></label>. It needs an index.html at the top.</p>
<div class="row"><input name="notes" id="notes" maxlength="2000" placeholder="What changed (optional, shown with the update)" aria-label="What changed"><label class="check"><input type="checkbox" id="auto"> Publish when it passes</label></div>
<p class="hint" id="upload-status" role="status" aria-live="polite">Only new and changed files are sent. Files over 95 MB go through <code>npx @zaisma/cli upload</code>.</p>
</form>
<script>${raw(UPLOAD_SCRIPT)}</script>`;
}

function versionRow(slug: string, version: VersionJson): Raw {
  const action = (what: string) => `/dashboard/${slug}/versions/${version.id}/${what}`;
  const scheduled = version.scheduled_publish_at
    ? html`<form class="row" method="post" action="${action("unschedule")}"><span>Goes live ${when(version.scheduled_publish_at)}${version.scan_status === "scanning" ? " if it has passed by then" : ""}.</span><button class="btn ghost" type="submit">Cancel</button></form>`
    : "";
  let acts: Raw | string = "";
  if (version.scan_status === "approved" && !version.is_live) {
    acts = html`<div class="row">
${version.preview_url ? html`<a class="btn ghost" href="${version.preview_url}" target="_blank" rel="noopener">Preview</a>` : ""}
<form method="post" action="${action("publish")}"><button class="btn light" type="submit">${version.published_at ? "Roll back to this" : "Publish"}</button></form>
${version.scheduled_publish_at ? "" : html`<details class="later"><summary>Publish later</summary><form class="row" method="post" action="${action("schedule")}"><input type="datetime-local" name="local" required aria-label="When"><input type="hidden" name="at"><button class="btn ghost" type="submit">Schedule</button></form></details>`}
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
${accountRequirementFields(game.account_requirement)}
<fieldset><legend>Saves</legend>
<label class="check"><input type="checkbox" name="cloud_saves"${game.cloud_saves_enabled ? raw(" checked") : ""}> Cloud saves</label>
<p class="hint">Signed-in players' progress follows them to any device. It copies the game's own browser saves, so there's nothing to add to your game. Turn it off if your game keeps its own saves on a server.</p>
<label class="check"><input type="checkbox" name="account_offer"${game.account_offer_enabled ? raw(" checked") : ""}> "Keep your progress" card</label>
<p class="hint">Once a guest has progress and has played 5 minutes, a card beside the game offers a free account to keep it. Turn it off if your game offers accounts its own way, with <code>Zaisma.player.signIn()</code>.</p>
</fieldset>
<button class="btn" type="submit">Save details</button>
</form>`;
}

const MULTIPLAYER_LABELS = {
  none: { label: "None", hint: "Single-player, or only your own servers." },
  relay: { label: "Relay", hint: "Zaisma passes each player's messages to the others. No server code." },
  own: { label: "Your game server", hint: "Runs the zaisma-server/ folder (or zaisma-server.js) from your upload on Zaisma, sealed off from the internet. Players never get its files." },
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

/** Whether guests play too, or only signed-in players for multiplayer or the whole game. */
function accountRequirementFields(current: AccountRequirement): Raw {
  return html`<fieldset class="choices"><legend>Zaisma accounts</legend>
${ACCOUNT_REQUIREMENTS.map(
    (requirement) => html`<label class="check"><input type="radio" name="account_requirement" value="${requirement}"${current === requirement ? raw(" checked") : ""}> <span>${ACCOUNT_REQUIREMENT_LABELS[requirement].label}<small class="hint">${ACCOUNT_REQUIREMENT_LABELS[requirement].hint}</small></span></label>`,
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
    i % 2 === 0 ? part : part.startsWith("message_zaisma") ? html`<a href="${message}">message Zaisma</a>` : part === "add_image" ? html`<a href="#images">Add image</a>` : html`<a href="#details">the details here</a>`,
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
  room_use_this_month: { room_play_duration_hours: number; free_room_play_duration_hours: number; has_reached_free_hours: boolean };
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
  const monthUse = stats.room_use_this_month;
  const month = monthUse.has_reached_free_hours
    ? html`<p class="hint">Your game has used this month's ${formatted(monthUse.free_room_play_duration_hours)} free player-hours on Zaisma rooms, so new rooms don't open until the month resets (UTC). Matches already running carry on. Until hosting billing is ready, that's the most a game can use. Rooms on a server you run yourself are never limited.</p>`
    : html`<p class="hint">${formatted(monthUse.room_play_duration_hours)} of ${formatted(monthUse.free_room_play_duration_hours)} free player-hours on Zaisma rooms this month. Until hosting billing is ready, new rooms stop opening at ${formatted(monthUse.free_room_play_duration_hours)} until the month resets (UTC); matches already running carry on.</p>`;
  // Requests to the game server's onRequest, which any game's own game server can answer, rooms or not.
  const requestUse = stats.request_use_this_month;
  const requests = !requestUse.request_count
    ? ""
    : requestUse.has_reached_free_requests
      ? html`<p class="hint">Your game has used this month's ${formatted(requestUse.free_request_count)} free requests to its game server, so requests answer request_limit until the month resets (UTC). Until hosting billing is ready, that's the most a game can use. Requests to a server you run yourself are never limited.</p>`
      : html`<p class="hint">${formatted(requestUse.request_count)} of ${formatted(requestUse.free_request_count)} free requests to your game server this month. Until hosting billing is ready, requests stop at ${formatted(requestUse.free_request_count)} until the month resets (UTC).</p>`;
  if (!days.length) return html`<p class="muted">No multiplayer rooms in the last 30 days.</p>${monthUse.room_play_duration_hours || monthUse.has_reached_free_hours ? month : ""}${requests}${schedulesTable(stats.schedules)}`;
  const topDurationMin = Math.max(...days.map((day) => day.room_play_duration_min), 1);
  return html`<table><thead><tr><th>Day</th><th>Rooms</th><th>Player minutes</th>${own ? html`<th>Requests</th><th>Scheduled runs</th><th>Game server errors</th><th>Stopped</th><th>Matches ended</th>` : ""}</tr></thead><tbody>${days.map(
    (day) => html`<tr><td class="nowrap">${day.date}</td><td>${day.room_count}</td><td><span class="bar" style="width:${Math.round((day.room_play_duration_min / topDurationMin) * 100)}%"></span>${day.room_play_duration_min}</td>${
      own ? html`<td>${formatted(day.game_server?.request_count ?? 0)}</td><td>${formatted(day.game_server?.scheduled_run_count ?? 0)}</td><td>${day.game_server?.crash_count ?? 0}</td><td>${day.game_server?.stopped_count ?? 0}</td><td>${day.game_server?.ended_match_count ?? 0}</td>` : ""
    }</tr>`,
  )}</tbody></table>${month}${requests}${schedulesTable(stats.schedules)}${own ? serverErrors(stats.game_server_errors) : ""}`;
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
.make{display:flex;gap:8px;flex-wrap:wrap}
.make input{width:260px;max-width:100%}
.done{color:var(--ok-text);margin:0 0 14px}
.first{max-width:640px}
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
.manage{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:40px;align-items:start}
.manage h2:first-child{margin-top:0}
.manage aside h2:first-child{margin-top:0}
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
.make-tester input{flex:1;min-width:200px}
.later summary{min-height:44px;display:inline-flex;align-items:center;font-size:15px}
.later[open]{flex-basis:100%}
.thumbs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:16px}
.thumbs figure{margin:0}
.thumbs img{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--pic);display:block}
.thumbs img.sq{aspect-ratio:1}
.thumbs figcaption{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:13px;color:var(--text-2);padding-top:4px}
button.link{background:none;border:0;color:var(--muted);font:inherit;font-size:13px;text-decoration:underline;cursor:pointer;min-height:32px;padding:0}
button.link:hover{color:var(--text)}
.facts{margin-top:24px;border-top:1px solid var(--line)}
.facts details{border-bottom:1px solid var(--line)}
.facts summary{list-style:none;display:flex;align-items:center;gap:10px;min-height:56px}
.facts summary::-webkit-details-marker{display:none}
.facts summary::before{content:"";width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);transition:transform 120ms}
.facts details[open] summary::before{transform:rotate(45deg)}
.facts summary h2{margin:0;font-size:20px}
.facts details>:not(summary){margin-bottom:20px}
.said{padding-left:18px;color:var(--text-2)}
.facts summary .muted{font-size:14px}
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
@media (max-width:900px){.manage{grid-template-columns:minmax(0,1fr)}.game-head{grid-template-columns:96px minmax(0,1fr)}.vis{grid-column:1/-1}.vis .hint{text-align:left}}
@media (max-width:520px){.facts table{display:block;overflow-x:auto}.seg{display:flex}.seg button{flex:1;padding:0 8px}.make input{width:100%}.make{width:100%}}
`;

// Times in the reader's own time zone, and "publish later" sent as an exact moment.
const LOCAL_TIMES = `document.querySelectorAll("time[data-local]").forEach(t=>{t.textContent=new Date(t.dateTime).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})});
document.querySelectorAll(".later form").forEach(f=>f.addEventListener("submit",()=>{const v=f.elements.local.value;if(v)f.elements.at.value=new Date(v).toISOString()}));
document.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent="Copied";setTimeout(()=>b.textContent="Copy",2000)}catch{b.previousElementSibling.select()}});`;

/**
 * Upload a folder from the browser, the same way the upload command does: hash every file, ask the
 * API which are missing, send those, then make the version. Signed in by the session cookie.
 */
const UPLOAD_SCRIPT = `(()=>{const form=document.getElementById("drop");if(!form)return;const slug=form.dataset.slug,status=document.getElementById("upload-status"),input=document.getElementById("folder");
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
location.href="/dashboard/"+slug+"?done=uploaded#versions"}catch(e){say(e.message);status.classList.add("error")}finally{busy=false}}
input.addEventListener("change",()=>{status.classList.remove("error");upload([...input.files].map(f=>({file:f,path:f.webkitRelativePath||f.name})))});
form.addEventListener("submit",e=>e.preventDefault());
form.addEventListener("dragover",e=>{e.preventDefault();form.classList.add("over")});form.addEventListener("dragleave",()=>form.classList.remove("over"));
form.addEventListener("drop",async e=>{e.preventDefault();form.classList.remove("over");status.classList.remove("error");const out=[];
try{for(const it of [...e.dataTransfer.items]){const en=it.webkitGetAsEntry&&it.webkitGetAsEntry();if(en)await fromEntry(en,"",out)}}catch{say("Couldn't read that folder. Use “choose it” instead.");return}upload(out)})})();`;
