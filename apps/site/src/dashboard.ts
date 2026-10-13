import { CONTROLS, DEVICES, PLAY_STYLES, ROOM_BROWSING, SCREENS, type PlayerCount, type Players, type RoomBrowsing } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { ApiError, apiCall, callerFor, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { html, layout, metalButton, raw, type Raw } from "./html.ts";

/**
 * The developer dashboard: your games, and a manager for each one. Every read and every change is a
 * call to the developer API (as the signed-in account), so the dashboard, the MCP and the upload
 * command always agree. Uploads run in the browser against the API directly, file by file.
 */

interface GameJson {
  slug: string;
  url: string;
  title: string;
  description: string;
  visibility: "draft" | "listed" | "unlisted" | "private";
  review: "pending" | "live" | "held" | "removed";
  devices: string[];
  controls: string[];
  screen: string;
  players: Players | null;
  cloud_saves: boolean;
  zaisma_rooms: boolean;
  multiplayer: "none" | "relay" | "own" | "built-in";
  room_browsing: RoomBrowsing;
  waiting_for_review: { title?: string; description?: string } | null;
  updated_at: number;
}
interface ImageJson {
  id: string;
  kind: "cover" | "square" | "screenshot";
  status: "pending" | "approved" | "rejected";
  url: string;
}
interface VersionJson {
  id: string;
  files: number;
  bytes: number;
  scan: "scanning" | "held" | "approved" | "rejected";
  live: boolean;
  notes: string;
  preview_url: string | null;
  published_at: number | null;
  publish_at: number | null;
  created_at: number;
  findings?: { rule: string; detail: string; path?: string | null }[];
}

const VISIBILITY: Record<GameJson["visibility"], { label: string; hint: string }> = {
  listed: { label: "Everyone", hint: "On Zaisma for everyone to find" },
  unlisted: { label: "Link only", hint: "Anyone with the link can play; it's never listed" },
  private: { label: "Only me", hint: "Only you and your testers, through preview and tester links" },
  draft: { label: "Draft", hint: "Not ready yet; only you and your testers, through preview and tester links" },
};
const REVIEW: Record<GameJson["review"], string> = { pending: "Not live yet", live: "Live", held: "Held", removed: "Taken down" };
const DEVICE_LABELS: Record<string, string> = { phone: "Phone", tablet: "Tablet", computer: "Computer" };
const CONTROL_LABELS: Record<string, string> = { touch: "Touch", "keyboard-mouse": "Keyboard and mouse", gamepad: "Gamepad" };
const SCREEN_LABELS: Record<string, string> = { "": "Not set", portrait: "Portrait", landscape: "Landscape", either: "Either way" };
const ROOM_BROWSING_LABELS: Record<RoomBrowsing, { label: string; hint: string }> = {
  page: { label: "On the game page and in the game", hint: "Players see open rooms on your game's page and can jump in. Your game can list them too, with Zaisma.rooms.list()." },
  game: { label: "Only in the game", hint: "For games with their own lobby or server browser: your game lists rooms with Zaisma.rooms.list(), and the game page doesn't." },
  off: { label: "Off", hint: "No room is listed anywhere. Room codes and invite links still work." },
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
  const call = (method: string, p: string, body?: unknown) => apiCall(env, caller, method, p, body);
  const done = (res: Response) => withCookies(res, session.cookies);
  const url = new URL(request.url);

  if (path === "/dashboard" && !post) return done(await gamesPage(env, call, url.searchParams.get("error") ?? undefined));
  if (path === "/dashboard/new" && post) {
    const form = await request.formData();
    try {
      const { game } = (await call("POST", "/games", { title: String(form.get("title") ?? "") })) as { game: GameJson };
      return done(redirect(`/dashboard/${game.slug}?done=made`));
    } catch (err) {
      if (err instanceof ApiError) return done(await gamesPage(env, call, err.message, String(form.get("title") ?? "")));
      throw err;
    }
  }

  const m = path.match(/^\/dashboard\/([a-z0-9-]+)(\/.*)?$/);
  if (!m) return null;
  const slug = m[1]!;
  const action = m[2] ?? "";
  const back = (key: string, hash = "") => done(redirect(`/dashboard/${slug}?done=${key}${hash}`));

  if (!action && !post) return done(await managerPage(env, call, slug, { done: DONE[url.searchParams.get("done") ?? ""] }));
  if (!post) return done(redirect(`/dashboard/${slug}`));

  const form = await request.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  try {
    if (action === "/details") {
      const res = (await call("PATCH", `/games/${slug}`, {
        title: field("title"),
        description: field("description"),
        devices: form.getAll("devices").map(String),
        controls: form.getAll("controls").map(String),
        screen: field("screen"),
        players: playersFrom(form),
        cloud_saves: form.get("cloud_saves") === "on",
        ...(form.has("room_browsing") ? { room_browsing: field("room_browsing") } : {}),
        ...(form.has("multiplayer") ? { multiplayer: field("multiplayer") } : {}),
      })) as { review: string | null; note?: string };
      if (res.note) return back("multiplayer-no-file", "#details");
      return back(res.review ? "details-review" : "details", "#details");
    }
    if (action === "/visibility") {
      const visibility = field("visibility");
      const { game } = (await call("GET", `/games/${slug}`)) as { game: GameJson };
      const hiding = (visibility === "private" || visibility === "draft") && (game.visibility === "listed" || game.visibility === "unlisted") && game.review === "live";
      if (hiding && field("confirm") !== "yes") return done(await managerPage(env, call, slug, { confirmHide: visibility as GameJson["visibility"] }));
      await call("PATCH", `/games/${slug}`, { visibility });
      return back("visibility");
    }
    if (action === "/images") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "no_file", "Choose an image first.");
      const kind = field("kind") === "screenshot" ? "screenshot" : field("kind") === "square" ? "square" : "cover";
      await call("POST", `/games/${slug}/images?kind=${kind}`, new Uint8Array(await file.arrayBuffer()));
      return back("image", "#images");
    }
    const img = action.match(/^\/images\/([a-z0-9]+)\/remove$/);
    if (img) {
      await call("DELETE", `/games/${slug}/images/${img[1]}`);
      return back("image-removed", "#images");
    }
    if (action === "/testers") {
      await call("POST", `/games/${slug}/testers`, { name: field("name") });
      return back("tester-added", "#testers");
    }
    const tester = action.match(/^\/testers\/([a-z0-9]+)\/remove$/);
    if (tester) {
      await call("DELETE", `/games/${slug}/testers/${tester[1]}`);
      return back("tester-removed", "#testers");
    }
    const ver = action.match(/^\/versions\/([a-z0-9]+)\/(publish|schedule|unschedule)$/);
    if (ver) {
      const [, id, what] = ver;
      if (what === "publish") await call("POST", `/games/${slug}/versions/${id}/publish`, {});
      if (what === "schedule") await call("POST", `/games/${slug}/versions/${id}/publish`, { at: field("at") });
      if (what === "unschedule") await call("DELETE", `/games/${slug}/versions/${id}/publish`);
      return back(what === "publish" ? "published" : `${what}d`, "#versions");
    }
  } catch (err) {
    if (err instanceof ApiError) return done(await managerPage(env, call, slug, { error: err.message }, err.status));
    throw err;
  }
  return done(redirect(`/dashboard/${slug}`));
}

/** The Players fields of the details form, as the API takes them. Nothing ticked clears it. */
function playersFrom(form: FormData): Players | null {
  const count = (mode: "local" | "online") => {
    if (form.get(mode) !== "on") return null;
    const max = String(form.get(`${mode}_max`) ?? "").trim();
    return { min: Number(form.get(`${mode}_min`) || 2), max: max ? Number(max) : null, style: String(form.get(`${mode}_style`) ?? "co-op") } as PlayerCount;
  };
  const players = { single: form.get("single") === "on", local: count("local"), online: count("online") };
  return players.single || players.local || players.online ? players : null;
}

type Call = (method: string, path: string, body?: unknown) => Promise<Record<string, unknown>>;

function redirect(to: string, cookies: string[] = []): Response {
  const res = new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

function withCookies(res: Response, cookies: string[]): Response {
  if (!cookies.length) return res;
  const out = new Response(res.body, res);
  for (const c of cookies) out.headers.append("Set-Cookie", c);
  return out;
}

function page(env: Env, title: string, body: Raw, status = 200, art: string | null = null): Response {
  const res = layout(env, { title: `${title} · Zaisma`, body: html`<style>${raw(STYLES)}</style>${body}<script>${raw(LOCAL_TIMES)}</script>`, private: true, nav: "dashboard", art });
  return new Response(res.body, { status, headers: res.headers });
}

const notice = (opts: { done?: string; error?: string }) =>
  opts.error ? html`<p class="error" role="alert">${opts.error}</p>` : opts.done ? html`<p class="done" role="status">${opts.done}</p>` : "";

const when = (ms: number) => html`<time datetime="${new Date(ms).toISOString()}" data-local>${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC</time>`;

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`);

function coverOf(images: ImageJson[]): ImageJson | undefined {
  const covers = images.filter((i) => i.kind === "cover" && i.status !== "rejected");
  return covers.find((i) => i.status === "approved") ?? covers[0];
}

// --- Your games ---

async function gamesPage(env: Env, call: Call, error?: string, title = ""): Promise<Response> {
  const { games } = (await call("GET", "/games")) as { games: GameJson[] };
  const details = await Promise.all(games.map((g) => call("GET", `/games/${g.slug}`) as Promise<{ images: ImageJson[]; versions: VersionJson[] }>));
  const make = html`<form class="make" method="post" action="/dashboard/new">
<input name="title" maxlength="80" required placeholder="Your game's name" aria-label="Your game's name" value="${title}">
${metalButton("Make a game", { type: "submit" })}
</form>`;
  return page(
    env,
    "Your games",
    html`<div class="dash-head"><h1>Your games</h1>${make}</div>
${notice({ error })}
${games.length
      ? html`<div class="grid">${games.map((g, i) => {
          const cover = coverOf(details[i]!.images);
          const live = details[i]!.versions.find((v) => v.live);
          const waiting = details[i]!.versions.filter((v) => !v.live && v.scan === "approved" && !v.published_at).length;
          return html`<div class="hit block"${cover ? raw(` data-art="${cover.url.replace(/"/g, "")}"`) : ""}><div class="tile">
<a class="pic" href="/dashboard/${g.slug}" tabindex="-1" aria-hidden="true">${cover ? html`<img src="${cover.url}" alt="" loading="lazy">` : ""}</a>
<div class="body"><a class="name" href="/dashboard/${g.slug}"><span>${g.title}</span><small>${VISIBILITY[g.visibility].label} · ${REVIEW[g.review]}${live ? "" : " · no live version"}</small></a>
${waiting ? html`<span class="badge">${waiting === 1 ? "Draft ready" : `${waiting} drafts ready`}</span>` : ""}</div>
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
  opts: { done?: string; error?: string; confirmHide?: GameJson["visibility"] },
  status = 200,
): Promise<Response> {
  let data: { game: GameJson; images: ImageJson[]; versions: VersionJson[]; testers: TesterJson[] };
  try {
    data = (await call("GET", `/games/${slug}`)) as typeof data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return page(env, "Game not found", html`<h1>Game not found</h1><p class="lead">${err.message}</p><a class="btn ghost" href="/dashboard">Your games</a>`, 404);
    throw err;
  }
  const { game, images, versions, testers } = data;
  // Held and rejected versions come with what the scan found.
  const findings = new Map<string, VersionJson["findings"]>();
  await Promise.all(
    versions
      .filter((v) => v.scan === "held" || v.scan === "rejected")
      .slice(0, 5)
      .map(async (v) => findings.set(v.id, ((await call("GET", `/games/${slug}/versions/${v.id}`)) as { version: VersionJson }).version.findings)),
  );
  const [reports, stats, history] = (await Promise.all([
    call("GET", `/games/${slug}/reports`),
    call("GET", `/games/${slug}/stats?days=30`),
    call("GET", `/games/${slug}/history`),
  ])) as unknown as [
    { reasons: Record<string, { label: string; open: number; closed: number }>; bug_reports: { said: string; at: number }[] },
    Stats,
    { history: { what: string; version: string | null; by: string; at: number }[] },
  ];
  const cover = coverOf(images);
  const removed = game.review === "removed";
  const openReports = Object.values(reports.reasons).reduce((n, r) => n + r.open, 0);

  return page(
    env,
    game.title,
    html`<p class="crumbs"><a href="/dashboard">Your games</a></p>
<div class="game-head">
<div class="cover pic bevel">${cover ? html`<img src="${cover.url}" alt="">` : ""}</div>
<div class="who">
<h1>${game.title}</h1>
<p class="muted"><span class="pill ${game.review}">${REVIEW[game.review]}</span> ${game.visibility === "listed" || game.visibility === "unlisted" ? html`<a href="${game.url}">${game.url.replace(/^https?:\/\//, "")}</a>` : html`zaisma.com/g/${game.slug}`}</p>
</div>
<form class="vis" method="post" action="/dashboard/${slug}/visibility" aria-label="Who can play">
<div class="seg">${(["listed", "unlisted", "private", "draft"] as const).map(
      (v) => html`<button name="visibility" value="${v}" title="${VISIBILITY[v].hint}" aria-pressed="${game.visibility === v}"${removed ? raw(" disabled") : ""}>${VISIBILITY[v].label}</button>`,
    )}</div>
<p class="hint">${VISIBILITY[game.visibility].hint}.</p>
</form>
</div>
${opts.confirmHide
      ? html`<div class="note confirm" role="alert"><p><strong>Players can play ${game.title} now.</strong> ${opts.confirmHide === "draft" ? "Making it a draft" : "Making it private"} takes it away from them, and its link stops working.</p>
<form class="row" method="post" action="/dashboard/${slug}/visibility"><input type="hidden" name="visibility" value="${opts.confirmHide}"><input type="hidden" name="confirm" value="yes">
<button class="btn danger" type="submit">Hide it from players</button><a class="btn ghost" href="/dashboard/${slug}">Keep it</a></form></div>`
      : ""}
${removed ? html`<div class="note"><p><strong>Zaisma took this game down.</strong> It can't get new versions or change who can play it.</p></div>` : ""}
${notice(opts)}
<div class="manage">
<section class="main">
${removed ? "" : uploadPanel(slug)}
<h2 class="rule-h" id="versions">Versions</h2>
${versions.length ? html`<ol class="track">${versions.map((v) => versionRow(slug, v, findings.get(v.id)))}</ol>` : html`<p class="muted">No versions yet.</p>`}
<p class="hint">Zaisma keeps the live version and the last 5 that passed, for rolling back. Drafts nobody publishes are deleted after 30 days.</p>
<h2 class="rule-h" id="testers">Tester links</h2>
${testersPanel(slug, game, testers, versions.some((v) => v.live))}
</section>
<aside>
<h2 id="details">Details</h2>
${detailsForm(slug, game)}
<h2 id="images">Cover and screenshots</h2>
${imagesPanel(slug, images)}
</aside>
</div>
<div class="facts">
<details open><summary><h2>Plays</h2><span class="muted">Last 30 days</span></summary>${playsPanel(stats.plays)}</details>
<details${openReports ? raw(" open") : ""}><summary><h2>Player reports${openReports ? ` (${openReports} open)` : ""}</h2></summary>${reportsPanel(reports)}</details>
<details><summary><h2>Multiplayer use</h2></summary>${statsPanel(stats)}</details>
<details><summary><h2>History</h2></summary>${history.history.length ? html`<table><tbody>${history.history.map((h) => html`<tr><td class="nowrap">${when(h.at)}</td><td>${h.what}${h.version ? html` <span class="muted">(${h.version.slice(0, 8)})</span>` : ""}</td><td class="muted">${h.by}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nothing yet.</p>`}</details>
</div>`,
    status,
    cover?.url ?? null,
  );
}

interface TesterJson {
  id: string;
  name: string;
  url: string;
  created_at: number;
  opened_at: number | null;
}

/** Secret links that open the live version whatever the visibility: one per group, each turned off on its own. */
function testersPanel(slug: string, game: GameJson, testers: TesterJson[], live: boolean): Raw {
  const removed = game.review === "removed";
  return html`<p class="hint">Anyone with a tester link plays your live version, even while the game is private or a draft, with no account needed. Make one for each group, like your team or a streamer, so you can turn one off without the others.${live ? "" : " Publish a version first: the links open the live version."}</p>
${testers.length
      ? html`<ul class="testers">${testers.map(
          (t) => html`<li class="plate">
<div class="t-head"><strong>${t.name}</strong><span class="muted">${t.opened_at ? html`Last opened ${when(t.opened_at)}` : "Not opened yet"}</span></div>
<div class="row"><input readonly value="${t.url}" aria-label="Tester link for ${t.name}"><button class="btn ghost" type="button" data-copy="${t.url}">Copy</button>
<form method="post" action="/dashboard/${slug}/testers/${t.id}/remove"><button class="btn ghost" type="submit">Turn off</button></form></div>
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

function versionRow(slug: string, v: VersionJson, findings?: VersionJson["findings"]): Raw {
  const action = (what: string) => `/dashboard/${slug}/versions/${v.id}/${what}`;
  const scheduled = v.publish_at
    ? html`<form class="row" method="post" action="${action("unschedule")}"><span>Goes live ${when(v.publish_at)}${v.scan === "scanning" ? " if it has passed by then" : ""}.</span><button class="btn ghost" type="submit">Cancel</button></form>`
    : "";
  let acts: Raw | string = "";
  if (v.scan === "approved" && !v.live) {
    acts = html`<div class="row">
${v.preview_url ? html`<a class="btn ghost" href="${v.preview_url}" target="_blank" rel="noopener">Preview</a>` : ""}
<form method="post" action="${action("publish")}"><button class="btn light" type="submit">${v.published_at ? "Roll back to this" : "Publish"}</button></form>
${v.publish_at ? "" : html`<details class="later"><summary>Publish later</summary><form class="row" method="post" action="${action("schedule")}"><input type="datetime-local" name="local" required aria-label="When"><input type="hidden" name="at"><button class="btn ghost" type="submit">Schedule</button></form></details>`}
</div>`;
  } else if (v.scan === "scanning") {
    acts = html`<p class="muted">Being scanned. This usually takes under a minute.</p>`;
  } else if (v.scan === "held") {
    acts = html`<p class="muted">A person will look at it, usually within a day.</p>`;
  } else if (v.scan === "rejected") {
    acts = html`<p class="muted">This version can't be published. Fix what's below and upload again.</p>`;
  }
  return html`<li class="${v.live ? "live edge" : ""}">
<div class="v-head"><strong>${v.live ? html`<span class="badge">Live</span> ` : ""}${v.id.slice(0, 8)}</strong><span class="muted">${when(v.created_at)} · ${v.files} files, ${size(v.bytes)}</span>${v.live ? "" : html`<span class="pill ${v.scan}">${v.scan === "approved" ? (v.published_at ? "Was live" : "Ready") : v.scan[0]!.toUpperCase() + v.scan.slice(1)}</span>`}</div>
${v.notes ? html`<p class="v-notes">${v.notes}</p>` : ""}
${findings?.length ? html`<ul class="findings">${findings.map((f) => html`<li>${f.detail}${f.path ? html` <span class="muted">(${f.path})</span>` : ""}</li>`)}</ul>` : ""}
${scheduled}${acts}
</li>`;
}

function detailsForm(slug: string, g: GameJson): Raw {
  const waiting = g.waiting_for_review;
  return html`<form class="stack" method="post" action="/dashboard/${slug}/details">
${waiting ? html`<p class="note small">Waiting for review: ${[waiting.title ? `title "${waiting.title}"` : "", waiting.description ? "a new description" : ""].filter(Boolean).join(" and ")}.</p>` : ""}
<label>Title<input name="title" maxlength="80" required value="${waiting?.title ?? g.title}"></label>
<label>Description<textarea name="description" maxlength="500">${waiting?.description ?? g.description}</textarea></label>
<fieldset><legend>Works on</legend><div class="row">${DEVICES.map((d) => html`<label class="check"><input type="checkbox" name="devices" value="${d}"${g.devices.includes(d) ? raw(" checked") : ""}> ${DEVICE_LABELS[d]}</label>`)}</div></fieldset>
<fieldset><legend>Controls</legend><div class="row">${CONTROLS.map((c) => html`<label class="check"><input type="checkbox" name="controls" value="${c}"${g.controls.includes(c) ? raw(" checked") : ""}> ${CONTROL_LABELS[c]}</label>`)}</div></fieldset>
${playersFields(g.players)}
<label>Screen<select name="screen">${["", ...SCREENS].map((s) => html`<option value="${s}"${g.screen === s ? raw(" selected") : ""}>${SCREEN_LABELS[s]}</option>`)}</select></label>
${multiplayerFields(g.multiplayer)}
${g.zaisma_rooms ? roomBrowsingFields(g.room_browsing) : ""}
<fieldset><legend>Saves</legend>
<label class="check"><input type="checkbox" name="cloud_saves"${g.cloud_saves ? raw(" checked") : ""}> Cloud saves</label>
<p class="hint">Signed-in players' progress follows them to any device. It copies the game's own browser saves, so there's nothing to add to your game. Turn it off if your game keeps its own saves on a server.</p>
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
function multiplayerFields(current: GameJson["multiplayer"]): Raw {
  if (current === "built-in") return html`<fieldset><legend>Multiplayer</legend><p class="hint">Runs a game server built into Zaisma. Ask us to change it.</p></fieldset>`;
  return html`<fieldset class="choices"><legend>Multiplayer</legend>
${(["none", "relay", "own"] as const).map(
    (m) => html`<label class="check"><input type="radio" name="multiplayer" value="${m}"${current === m ? raw(" checked") : ""}> <span>${MULTIPLAYER_LABELS[m].label}<small class="hint">${MULTIPLAYER_LABELS[m].hint}</small></span></label>`,
  )}
</fieldset>`;
}

/** Where open rooms on Zaisma are listed. Single rooms can still hide themselves from the game. */
function roomBrowsingFields(current: RoomBrowsing): Raw {
  return html`<fieldset class="choices"><legend>Room browsing</legend>
${ROOM_BROWSING.map(
    (b) => html`<label class="check"><input type="radio" name="room_browsing" value="${b}"${current === b ? raw(" checked") : ""}> <span>${ROOM_BROWSING_LABELS[b].label}<small class="hint">${ROOM_BROWSING_LABELS[b].hint}</small></span></label>`,
  )}
<p class="hint">Your game can also hide single rooms, like private matches: <code>Zaisma.joinRoom({ listed: false })</code>, or <code>room.setListed(false)</code> from your game server.</p>
</fieldset>`;
}

function playersFields(p: Players | null): Raw {
  const mode = (name: "local" | "online", label: string, hint: string, c: PlayerCount | null) => html`<div class="mode">
<label class="check"><input type="checkbox" name="${name}"${c ? raw(" checked") : ""}> ${label}</label>
<div class="mode-detail"><select name="${name}_style" aria-label="${label}: how">${PLAY_STYLES.map((st) => html`<option value="${st}"${c?.style === st ? raw(" selected") : ""}>${st === "both" ? "Both" : st === "co-op" ? "Co-op" : "Versus"}</option>`)}</select>
<input type="number" name="${name}_min" min="2" max="1000" value="${c?.min ?? 2}" aria-label="${label}: fewest players"><span class="muted">to</span><input type="number" name="${name}_max" min="2" max="1000" value="${c?.max ?? ""}" placeholder="any" aria-label="${label}: most players (empty for no limit)"><span class="muted">players</span></div>
<p class="hint">${hint}</p></div>`;
  return html`<fieldset class="players"><legend>Players</legend>
<label class="check"><input type="checkbox" name="single"${p?.single ? raw(" checked") : ""}> Single-player</label>
${mode("local", "Local multiplayer", "Together on one device or screen.", p?.local ?? null)}
${mode("online", "Online multiplayer", "Each on their own device. Leave the most empty for no limit.", p?.online ?? null)}
</fieldset>`;
}

const KIND_LABELS: Record<ImageJson["kind"], string> = { cover: "Cover", square: "Square cover", screenshot: "Screenshot" };

function imagesPanel(slug: string, images: ImageJson[]): Raw {
  const shown = images.filter((i) => i.status !== "rejected");
  return html`${shown.length
    ? html`<div class="thumbs">${shown.map(
        (i) => html`<figure><img class="bevel-s${i.kind === "square" ? " sq" : ""}" src="${i.url}" alt="" loading="lazy"><figcaption><span>${KIND_LABELS[i.kind]}${i.status === "pending" ? html` <span class="pill pending">In review</span>` : ""}</span>
<form method="post" action="/dashboard/${slug}/images/${i.id}/remove"><button class="link" type="submit">Remove</button></form></figcaption></figure>`,
      )}</div>`
    : html`<p class="muted">No cover yet. Players see it on the game page and in lists.</p>`}
<form class="stack" method="post" action="/dashboard/${slug}/images" enctype="multipart/form-data">
<div class="row"><select name="kind" aria-label="Kind"><option value="cover">Cover</option><option value="square">Square cover</option><option value="screenshot">Screenshot</option></select><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Image"></div>
<p class="hint">Players see your cover alone as your game's card, so put your game's name or logo on it. The cover is landscape (16:9 shows best). The square cover is optional: phones show it instead, where a landscape one would be small; at least 512 px. Screenshots are just the game. PNG, JPEG or WebP, up to 5 MB, at least 320 px a side.</p>
<button class="btn" type="submit">Add image</button>
</form>`;
}

function reportsPanel(r: { reasons: Record<string, { label: string; open: number; closed: number }>; bug_reports: { said: string; at: number }[] }): Raw {
  const rows = Object.values(r.reasons);
  if (!rows.length) return html`<p class="muted">No reports in the last 90 days.</p>`;
  return html`<table><thead><tr><th>Reason</th><th>Waiting for us</th><th>Looked at</th></tr></thead><tbody>${rows.map((x) => html`<tr><td>${x.label}</td><td>${x.open}</td><td>${x.closed}</td></tr>`)}</tbody></table>
${r.bug_reports.length ? html`<h3>What players said about bugs</h3><ul class="said">${r.bug_reports.map((b) => html`<li>${b.said} <span class="muted">${when(b.at)}</span></li>`)}</ul>` : ""}`;
}

interface Stats {
  plays: {
    days: { day: string; plays: number; players: number; new_players: number; minutes_played: number }[];
    plays: number;
    new_players: number;
    minutes_played: number;
    minutes_per_play: number | null;
    came_back: Record<"after_1_day" | "after_7_days" | "after_30_days", { percent: number | null; players: number; of: number }>;
  };
  multiplayer: { day: string; rooms: number; player_minutes: number; messages: number; game_server?: { calls: number; crashes: number; stopped: number; matches_ended: number } }[];
  game_server_errors?: { kind: "crash" | "stopped"; error: string; times: number; version: string; last: number }[];
}

const n = (x: number) => x.toLocaleString("en-US");

/** Plays, time played and players coming back, as the game page counts them. */
function playsPanel(p: Stats["plays"]): Raw {
  const how = html`<p class="hint">Counted when someone presses Play on the game page, not through tester or preview links. A player is a browser: one person on two devices counts twice. Time counts only while the game is on screen.</p>`;
  if (!p.plays) return html`<p class="muted">No plays in the last 30 days.</p>${how}`;
  const back = (label: string, b: Stats["plays"]["came_back"]["after_1_day"]) =>
    html`<div class="num plate"><strong>${b.percent === null ? "–" : `${b.percent}%`}</strong><span>${label}</span><small>${b.of ? `${n(b.players)} of ${n(b.of)} new players` : "Not enough days yet"}</small></div>`;
  const top = Math.max(...p.days.map((d) => d.plays), 1);
  // Every one of the 30 days, including those with no plays.
  const by = new Map(p.days.map((d) => [d.day, d.plays]));
  const all = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10));
  return html`<div class="numbers">
<div class="num plate"><strong>${n(p.plays)}</strong><span>Plays</span></div>
<div class="num plate"><strong>${n(p.new_players)}</strong><span>New players</span></div>
<div class="num plate"><strong>${p.minutes_per_play === null ? "–" : `${p.minutes_per_play} min`}</strong><span>Per play</span><small>${n(p.minutes_played)} minutes in all</small></div>
${back("Back the next day", p.came_back.after_1_day)}
${back("Back a week later", p.came_back.after_7_days)}
</div>
<figure class="chart"><div class="cols" role="img" aria-label="Plays per day">${all.map((d) => html`<span title="${d}: ${n(by.get(d) ?? 0)} plays" style="height:${Math.max(Math.round(((by.get(d) ?? 0) / top) * 100), 1)}%"></span>`)}</div>
<figcaption><span>${all[0]}</span><span>Plays per day</span><span>Today</span></figcaption></figure>
<details class="later"><summary>Day by day</summary><table><thead><tr><th>Day</th><th>Plays</th><th>Players</th><th>New</th><th>Minutes</th></tr></thead><tbody>${[...p.days].reverse().map(
    (d) => html`<tr><td class="nowrap">${d.day}</td><td>${n(d.plays)}</td><td>${n(d.players)}</td><td>${n(d.new_players)}</td><td>${n(d.minutes_played)}</td></tr>`,
  )}</tbody></table></details>${how}`;
}

function statsPanel(stats: Stats): Raw {
  const days = stats.multiplayer;
  if (!days.length) return html`<p class="muted">No multiplayer rooms in the last 30 days.</p>`;
  const top = Math.max(...days.map((d) => d.player_minutes), 1);
  const own = stats.game_server_errors !== undefined;
  return html`<table><thead><tr><th>Day</th><th>Rooms</th><th>Player minutes</th>${own ? html`<th>Game server errors</th><th>Stopped</th><th>Matches ended</th>` : ""}</tr></thead><tbody>${days.map(
    (d) => html`<tr><td class="nowrap">${d.day}</td><td>${d.rooms}</td><td><span class="bar" style="width:${Math.round((d.player_minutes / top) * 100)}%"></span>${d.player_minutes}</td>${
      own ? html`<td>${d.game_server?.crashes ?? 0}</td><td>${d.game_server?.stopped ?? 0}</td><td>${d.game_server?.matches_ended ?? 0}</td>` : ""
    }</tr>`,
  )}</tbody></table>${own ? serverErrors(stats.game_server_errors!) : ""}`;
}

/** A game server's recent errors, so its developer can fix what wastes their players' time and our work. */
function serverErrors(errors: NonNullable<Stats["game_server_errors"]>): Raw {
  if (!errors.length) return html`<p class="muted">No errors from your game server in the last 30 days.</p>`;
  return html`<h3>Your game server's errors</h3>
<p class="hint">An error loses that one message or tick and the match carries on. Stopped means it ran on too long, like a loop that never ends: the match froze for about 2 seconds, and a match stopped twice ends.</p>
<table><thead><tr><th>What happened</th><th>Times</th><th>Last</th></tr></thead><tbody>${errors.map(
    (e) => html`<tr><td>${e.kind === "stopped" ? e.error : html`<code>${e.error}</code>`}</td><td>${e.times}</td><td class="nowrap">${when(e.last)}</td></tr>`,
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
.v-head{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.v-head .pill{margin-left:auto}
.v-notes{margin:0;color:var(--text-2);white-space:pre-wrap}
.findings{margin:0;padding-left:18px;color:var(--warn)}
.findings .muted{color:var(--muted)}
.track p{margin:0}
.testers{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:12px}
.testers>li{padding:14px 16px;display:grid;gap:10px}
.t-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between}
.testers .row input{flex:1;min-width:200px;font-size:14px}
.make-tester input{flex:1;min-width:200px}
.later summary{min-height:44px;display:inline-flex;align-items:center;font-size:15px}
.later[open]{flex-basis:100%}
.thumbs{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
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
@media (max-width:900px){.manage{grid-template-columns:1fr}.game-head{grid-template-columns:96px 1fr}.vis{grid-column:1/-1}.vis .hint{text-align:left}}
@media (max-width:520px){.seg{display:flex}.seg button{flex:1;padding:0 8px}.make input{width:100%}.make{width:100%}}
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
const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error&&d.error.message||"The upload failed ("+r.status+").");return d}};
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
const list=[];for(let i=0;i<files.length;i++){say("Checking files… "+(i+1)+" of "+files.length);const f=files[i];f.sha256=hex(await crypto.subtle.digest("SHA-256",await f.file.arrayBuffer()));list.push({path:f.path,sha256:f.sha256,bytes:f.file.size})}
const plan=await api("POST","/games/"+slug+"/uploads",{files:list});const seen=new Set(),todo=files.filter(f=>plan.missing.includes(f.sha256)&&!seen.has(f.sha256)&&seen.add(f.sha256));
const total=todo.reduce((n,f)=>n+f.file.size,0);let sent=0;const mb=n=>(n/1048576).toFixed(1)+" MB";
const queue=[...todo];await Promise.all(Array.from({length:4},async()=>{for(let f=queue.shift();f;f=queue.shift()){await api("PUT","/files/"+f.sha256,f.file,true);sent+=f.file.size;say("Sending "+todo.length+" new or changed files… "+mb(sent)+" of "+mb(total))}}));
say("Making the version…");
await api("POST","/games/"+slug+"/versions",{files:list,notes:document.getElementById("notes").value,publish:document.getElementById("auto").checked?"when-approved":undefined});
location.href="/dashboard/"+slug+"?done=uploaded#versions"}catch(e){say(e.message);status.classList.add("error")}finally{busy=false}}
input.addEventListener("change",()=>{status.classList.remove("error");upload([...input.files].map(f=>({file:f,path:f.webkitRelativePath||f.name})))});
form.addEventListener("submit",e=>e.preventDefault());
form.addEventListener("dragover",e=>{e.preventDefault();form.classList.add("over")});form.addEventListener("dragleave",()=>form.classList.remove("over"));
form.addEventListener("drop",async e=>{e.preventDefault();form.classList.remove("over");status.classList.remove("error");const out=[];
try{for(const it of [...e.dataTransfer.items]){const en=it.webkitGetAsEntry&&it.webkitGetAsEntry();if(en)await fromEntry(en,"",out)}}catch{say("Couldn't read that folder. Use “choose it” instead.");return}upload(out)})})();`;
