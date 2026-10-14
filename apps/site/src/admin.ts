import {
  BUILT_IN_GAME_SERVERS,
  SANDBOX_GAME_SERVER,
  LIMITS,
  AUTO_HOLD_REASONS,
  SEVERITIES,
  SEVERITY,
  reportLabel,
  reportPictureKey,
  clearVersion,
  closeReportGroup,
  UploadError,
  aiUsage,
  allGames,
  audit,
  auditLog,
  closeReports,
  gameById,
  heldVersions,
  openReports,
  parseConnectHosts,
  publishVersion,
  saveScan,
  setGameStatus,
  setMultiplayer,
  setCloudSaves,
  accountById,
  gameOwner,
  personOwner,
  setGameOwner,
  versionById,
  versionsForGame,
  gamesWithDetailsDrafts,
  imageById,
  imageKey,
  imagesForGame,
  pendingImages,
  settleDetailsDraft,
  settleImage,
  type GameImage,
  type GameStatus,
  type PrecedentDecision,
  type Report,
  type ScanReport,
  type Triage,
} from "@zaisma/core";
import { adminIdentity } from "./access.ts";
import { gameUrl, type Env } from "./env.ts";
import { html, layout, raw, type Raw } from "./html.ts";
import { handleAdminMcp } from "./admin-mcp.ts";
import { adminFeedbackAction, adminFeedbackPage, feedbackSummary } from "./admin-feedback.ts";
import { precedentAction, precedentsPage, savePrecedent } from "./precedents.ts";
import { clearCountedDay, playSpikes } from "./plays.ts";
import { passVersion } from "./scan.ts";
import { uploadGame } from "./upload.ts";

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const pill = (s: string) => html`<span class="pill ${s}">${s}</span>`;

export function adminPage(env: Env, title: string, body: Raw): Response {
  return page(env, title, body);
}

function page(env: Env, title: string, body: Raw): Response {
  return layout(env, { title: `${title} · Zaisma admin`, body, admin: true });
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to } });
}

export async function handleAdmin(request: Request, env: Env, path: string): Promise<Response> {
  const actor = await adminIdentity(request, env);
  if (!actor) return new Response("Forbidden", { status: 403 });

  // The admin MCP: Claude Code signs in through Cloudflare Access with a service token, so it sends no Origin of ours.
  if (path === "/admin/mcp") return handleAdminMcp(request, env, actor);

  if (request.method === "POST") {
    // Admin forms only come from our own pages.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
    return adminAction(request, env, path, actor);
  }

  if (path === "/admin") return dashboard(env);
  if (path === "/admin/audit") return auditPage(env);
  if (path === "/admin/reports") return reportQueue(env);
  if (path === "/admin/precedents") return page(env, "Precedents", await precedentsPage(env));
  const feedback = path === "/admin/feedback" || path.startsWith("/admin/feedback/") ? await adminFeedbackPage(env, path, new URL(request.url)) : null;
  if (feedback) return feedback;
  const m = path.match(/^\/admin\/games\/([a-z0-9]+)$/);
  if (m) return gameDetail(env, m[1]!);
  const img = path.match(/^\/admin\/images\/([a-z0-9]+)$/);
  if (img) return adminImage(env, img[1]!);
  const pic = path.match(/^\/admin\/reports\/([a-z0-9]+)\/picture$/);
  if (pic) return reportPicture(env, pic[1]!);
  return new Response("Not found", { status: 404 });
}

async function adminAction(request: Request, env: Env, path: string, actor: string): Promise<Response> {
  const wantsJson = path.startsWith("/admin/api/");
  if (path === "/admin/upload" || path === "/admin/api/games") {
    try {
      const result = await uploadGame(env, await request.formData(), actor);
      if (wantsJson) {
        return Response.json({ gameId: result.game.id, slug: result.game.slug, versionId: result.versionId, files: result.files, status: "scanning", url: `${env.SITE_ORIGIN}/g/${result.game.slug}` }, { status: 201 });
      }
      return redirect(`/admin/games/${result.game.id}`);
    } catch (err) {
      if (!(err instanceof UploadError)) throw err;
      if (wantsJson) return Response.json({ error: err.message }, { status: 400 });
      return dashboard(env, err.message);
    }
  }

  return adminForm(env, path, await request.formData(), actor);
}

/** Every admin form action. The admin MCP calls this too, so a decision there is exactly a click here. */
export async function adminForm(env: Env, path: string, form: FormData, actor: string): Promise<Response> {
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500);
  const back = (fallback: string) => redirect(form.get("back") === "queue" ? "/admin/reports" : fallback);

  const feedback = await adminFeedbackAction(env, path, form);
  if (feedback) return feedback;
  const precedents = await precedentAction(env, path, form, actor);
  if (precedents) return precedents;
  // Deciding a report in the queue can also set a precedent for cases like it.
  const decided = precedentDecision(path);
  if (decided && form.get("precedent") === "1") await savePrecedent(env, form, decided, actor);

  let m = path.match(/^\/admin\/versions\/([a-z0-9]+)\/(approve|reject)$/);
  if (m) {
    const version = await versionById(env.DB, m[1]!);
    if (!version) return new Response("Not found", { status: 404 });
    if (version.report_held_at && m[2] === "approve") {
      // A report paused this update: put it back, and later reports can't pause it again.
      await publishVersion(env.DB, version);
      await clearVersion(env.DB, version.id);
      await closeReports(env.DB, version.game_id, "dismissed");
      await audit(env.DB, version.game_id, "report-cleared", reason || `Version ${version.id} is back`, actor);
    } else if (m[2] === "approve") {
      await passVersion(env, version, reason || "Approved by a person", actor);
    } else {
      await saveScan(env.DB, version.id, "rejected", null);
      if (version.report_held_at) await closeReports(env.DB, version.game_id, "actioned");
      await audit(env.DB, version.game_id, "rejected", reason || `Version ${version.id}`, actor);
    }
    return back(`/admin/games/${version.game_id}`);
  }

  m = path.match(/^\/admin\/images\/([a-z0-9]+)\/(approve|reject)$/);
  if (m) {
    const img = await imageById(env.DB, m[1]!);
    if (!img) return new Response("Not found", { status: 404 });
    const replaced = await settleImage(env.DB, img, m[2] === "approve");
    await Promise.all(replaced.map((r) => env.GAMES.delete(imageKey(r))));
    await audit(env.DB, img.game_id, m[2] === "approve" ? "image-approved" : "image-rejected", reason || `${img.kind} ${img.id}`, actor);
    return redirect(String(form.get("back") ?? "") === "game" ? `/admin/games/${img.game_id}` : "/admin");
  }

  m = path.match(/^\/admin\/games\/([a-z0-9]+)\/details\/(approve|reject)$/);
  if (m) {
    const game = await gameById(env.DB, m[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    await settleDetailsDraft(env.DB, game, m[2] === "approve");
    await audit(env.DB, game.id, m[2] === "approve" ? "details-approved" : "details-rejected", reason || game.details_draft || "", actor);
    return redirect("/admin");
  }

  m = path.match(/^\/admin\/games\/([a-z0-9]+)\/plays\/(\d{4}-\d{2}-\d{2})\/clear$/);
  if (m) {
    const game = await gameById(env.DB, m[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    await clearCountedDay(env.DB, game.id, m[2]!);
    await audit(env.DB, game.id, "plays-cleared", `Counted plays on ${m[2]} removed`, actor);
    return redirect("/admin#plays");
  }

  m = path.match(/^\/admin\/games\/([a-z0-9]+)\/shelves$/);
  if (m) {
    const game = await gameById(env.DB, m[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const off = form.get("off") === "1";
    await env.DB.prepare("UPDATE games SET off_shelves = ? WHERE id = ?").bind(off ? 1 : 0, game.id).run();
    await audit(env.DB, game.id, off ? "off-shelves" : "on-shelves", off ? "Kept off Popular, Trending and New" : "Back on Popular, Trending and New", actor);
    return redirect(form.get("back") === "game" ? `/admin/games/${game.id}` : "/admin#plays");
  }

  m = path.match(/^\/admin\/games\/([a-z0-9]+)\/multiplayer$/);
  if (m) {
    const game = await gameById(env.DB, m[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const server = String(form.get("game_server") ?? "");
    if (server && server !== SANDBOX_GAME_SERVER && !(BUILT_IN_GAME_SERVERS as readonly string[]).includes(server)) return gameDetail(env, game.id, "Pick a game server from the list.");
    let hosts: string[];
    try {
      hosts = parseConnectHosts(String(form.get("connect_hosts") ?? ""));
    } catch (err) {
      return gameDetail(env, game.id, (err as Error).message);
    }
    await setMultiplayer(env.DB, game.id, { gameServer: server || null, connectHosts: hosts });
    await audit(env.DB, game.id, "multiplayer", `Game server: ${server || "none"}. Own servers: ${hosts.join(", ") || "none"}`, actor);
    return redirect(`/admin/games/${game.id}`);
  }

  m = path.match(/^\/admin\/games\/([a-z0-9]+)\/saves$/);
  if (m) {
    const game = await gameById(env.DB, m[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const on = form.get("cloud_saves") === "on";
    await setCloudSaves(env.DB, game.id, on);
    await audit(env.DB, game.id, "cloud-saves", on ? "On" : "Off", actor);
    return redirect(`/admin/games/${game.id}`);
  }

  m = path.match(/^\/admin\/games\/([a-z0-9]+)\/owner$/);
  if (m) {
    const game = await gameById(env.DB, m[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const accountId = String(form.get("account_id") ?? "").trim();
    if (!accountId) {
      await setGameOwner(env.DB, game.id, null);
      await audit(env.DB, game.id, "owner", "No owner", actor);
      return redirect(`/admin/games/${game.id}`);
    }
    const account = await accountById(env.DB, accountId);
    if (!account) return gameDetail(env, game.id, "No account with that ID. It's shown at the bottom of the account page.");
    const owner = await personOwner(env.DB, account.id);
    await setGameOwner(env.DB, game.id, owner.id);
    await audit(env.DB, game.id, "owner", `Owner: ${account.name} (account ${account.id})`, actor);
    return redirect(`/admin/games/${game.id}`);
  }

  m = path.match(/^\/admin\/games\/([a-z0-9]+)\/(takedown|restore|dismiss)$/);
  if (m) {
    const game = await gameById(env.DB, m[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    if (m[2] === "takedown") {
      if (!reason) return gameDetail(env, game.id, "Give a reason for the takedown. It goes in the audit log.");
      await setGameStatus(env.DB, game.id, "removed");
      await closeReports(env.DB, game.id, "actioned");
      await audit(env.DB, game.id, "takedown", reason, actor);
    } else if (m[2] === "restore") {
      await setGameStatus(env.DB, game.id, game.current_version_id ? "live" : "pending");
      // A person checked it: reports can't hide this version again.
      if (game.current_version_id) await clearVersion(env.DB, game.current_version_id);
      await closeReports(env.DB, game.id, "dismissed");
      await audit(env.DB, game.id, "restored", reason, actor);
    } else {
      if (game.current_version_id) await clearVersion(env.DB, game.current_version_id);
      await closeReports(env.DB, game.id, "dismissed");
      await audit(env.DB, game.id, "reports-dismissed", reason, actor);
    }
    return back(`/admin/games/${game.id}`);
  }

  // One group of reports about the same problem, from the queue.
  m = path.match(/^\/admin\/report-groups\/([a-z0-9]+)\/(dismiss|bug|hide-name)$/);
  if (m) {
    const { results: group } = await env.DB.prepare("SELECT * FROM reports WHERE (id = ? OR group_id = ?) AND status = 'open'").bind(m[1]!, m[1]!).all<Report>();
    if (!group.length) return back("/admin/reports");
    const gameId = group[0]!.game_id;
    // Never passed to the developer: telling them could warn someone abusing a child.
    if (m[2] === "bug" && group.some((r) => r.severity === 0 || r.reason === "child_safety")) return back("/admin/reports");
    if (m[2] === "hide-name") {
      // The room's name and labels leave the game page and the game's own list while the room lives.
      const rooms = [...new Set(group.map((r) => r.room_code).filter(Boolean))];
      for (const code of rooms) await env.DB.prepare("UPDATE live_rooms SET name_hidden = 1 WHERE game_id = ? AND code = ?").bind(gameId, code).run();
      await closeReportGroup(env.DB, m[1]!, "actioned");
      await audit(env.DB, gameId, "room-name-hidden", reason || `Room ${rooms.join(", ")}: ${group[0]!.room_name ?? "its name"}`, actor);
    } else if (m[2] === "bug") {
      await env.DB.prepare("UPDATE reports SET bug = 1, bug_at = COALESCE(bug_at, ?) WHERE (id = ? OR group_id = ?) AND status = 'open'").bind(Date.now(), m[1]!, m[1]!).run();
      await closeReportGroup(env.DB, m[1]!, "actioned");
      await audit(env.DB, gameId, "reports-to-developer", reason || `${group.length} report(s) passed to the developer as bugs`, actor);
    } else {
      // A person looked at a serious report and found nothing: reports can't pause that version again.
      for (const r of group) if (r.version_id && (r.severity <= SEVERITY.urgent || (AUTO_HOLD_REASONS as string[]).includes(r.reason))) await clearVersion(env.DB, r.version_id);
      await closeReportGroup(env.DB, m[1]!, "dismissed");
      await audit(env.DB, gameId, "reports-dismissed", reason || `${group.length} report(s): ${reportLabel(group[0]!)}`, actor);
    }
    return back("/admin/reports");
  }
  return new Response("Not found", { status: 404 });
}

async function dashboard(env: Env, error = ""): Promise<Response> {
  const [queue, reports, games, usage, images, words, spikes, feedback] = await Promise.all([
    heldVersions(env.DB),
    openReports(env.DB),
    allGames(env.DB),
    aiUsage(env.DB),
    pendingImages(env.DB),
    gamesWithDetailsDrafts(env.DB),
    playSpikes(env.DB),
    feedbackSummary(env),
  ]);
  const offShelves = games.filter((g) => g.off_shelves);
  const groups = groupReports(reports);
  return page(
    env,
    "Admin",
    html`<h1>Admin</h1>
<p class="lead">AI this month: ${usage.scans} scans, ${usage.reports} reports and ${usage.feedback} feedback items sorted, ${usage.input_tokens.toLocaleString("en-US")} of ${Number(env.AI_MONTHLY_INPUT_TOKENS).toLocaleString("en-US")} input tokens.</p>

<h2>Waiting for review (${queue.length})</h2>
${queue.length
      ? html`<table><tr><th>Game</th><th>Version</th><th>Status</th><th>Uploaded</th></tr>${queue.map(
          (v) => html`<tr><td><a href="/admin/games/${v.game_id}">${v.title}</a></td><td>${v.id}</td><td>${pill(v.scan_status)}${v.report_held_at ? " paused by a report" : ""}</td><td>${when(v.created_at)}</td></tr>`,
        )}</table>`
      : html`<p class="note">Nothing waiting.</p>`}

<h2>Covers and screenshots (${images.length})</h2>
${images.length
      ? html`<p class="muted">Image matching isn't connected yet, so every picture waits here. Check it shows the game and follows the content rules.</p>
<div class="shots">${images.map((i) => html`<div>${imageReview(i)}<p><a href="/admin/games/${i.game_id}">${i.title}</a></p></div>`)}</div>`
      : html`<p class="note">Nothing waiting.</p>`}

<h2>New titles and descriptions (${words.length})</h2>
${words.length
      ? html`<table><tr><th>Game</th><th>Now</th><th>New</th><th></th></tr>${words.map((g) => {
          const d = JSON.parse(g.details_draft!) as { title?: string; description?: string };
          return html`<tr><td><a href="/admin/games/${g.id}">${g.slug}</a></td><td><strong>${g.title}</strong><br>${g.description}</td><td><strong>${d.title ?? g.title}</strong><br>${d.description ?? g.description}</td>
<td><div class="row"><form method="post" action="/admin/games/${g.id}/details/approve"><button class="btn" type="submit">Approve</button></form><form method="post" action="/admin/games/${g.id}/details/reject"><button class="btn ghost" type="submit">Reject</button></form></div></td></tr>`;
        })}</table>`
      : html`<p class="note">Nothing waiting.</p>`}

<h2>Reports (${groups.length})</h2>
${groups.length
      ? html`<table><tr><th>How serious</th><th>Game</th><th>What</th><th>Reports</th></tr>${groups.slice(0, 5).map(
          (g) => html`<tr><td>${severityPill(g.severity)}</td><td><a href="/admin/games/${g.lead.game_id}">${g.lead.title}</a></td><td>${g.triage?.summary ?? reportLabel(g.lead)}</td><td>${g.rows.length}</td></tr>`,
        )}</table>
<p><a class="btn ghost" href="/admin/reports">Open the report queue</a></p>`
      : html`<p class="note">No open reports.</p>`}

${feedback}

<h2 id="plays">Play spikes (${spikes.length})</h2>
${spikes.length
      ? html`<p class="muted">Counted players at least 5 times the week before. Faked plays tend to come from few networks, or from cloud servers. Removing a day's counts keeps every play started; keeping a game off the shelves hides it from Popular, Trending and New until you put it back.</p>
<table><tr><th>Game</th><th>Day</th><th>Players</th><th>Usual</th><th>Networks</th><th>Biggest network</th><th>Cloud</th><th></th></tr>${spikes.map(
          (p) => html`<tr><td><a href="/admin/games/${p.game_id}">${p.title}</a>${p.off_shelves ? html` ${pill("off shelves")}` : ""}</td><td>${p.day}</td><td>${p.players}</td><td>${p.usual}</td><td>${p.networks}</td><td>${p.top_share}%</td><td>${p.hosting_share}%</td>
<td><div class="row"><form method="post" action="/admin/games/${p.game_id}/plays/${p.day}/clear"><button class="btn ghost" type="submit">Remove this day's counts</button></form>${p.off_shelves ? "" : html`<form method="post" action="/admin/games/${p.game_id}/shelves"><input type="hidden" name="off" value="1"><button class="btn ghost" type="submit">Keep off the shelves</button></form>`}</div></td></tr>`,
        )}</table>`
      : html`<p class="note">No spikes.</p>`}
${offShelves.length
      ? html`<h3>Kept off the shelves</h3><table>${offShelves.map((g) => html`<tr><td><a href="/admin/games/${g.id}">${g.title}</a></td><td><form method="post" action="/admin/games/${g.id}/shelves"><input type="hidden" name="off" value="0"><button class="btn ghost" type="submit">Put back</button></form></td></tr>`)}</table>`
      : ""}

<h2>Upload a game</h2>
${error ? html`<p class="note" style="color:var(--danger)">${error}</p>` : ""}
<form class="stack" method="post" action="/admin/upload" enctype="multipart/form-data">
  <label>Title <input name="title" required maxlength="80"></label>
  <label>Link name (zaisma.com/g/…). Leave empty to make one from the title. Reuse an existing one to upload a new version.
    <input name="slug" pattern="[a-z0-9-]{3,40}" maxlength="40"></label>
  <label>Short description <textarea name="description" maxlength="500"></textarea></label>
  <label>Game zip (up to ${Math.round(LIMITS.zipBytes / 1048576)} MB, index.html at the top) <input type="file" name="zip" accept=".zip,application/zip" required></label>
  <div><button class="btn" type="submit">Upload and scan</button></div>
</form>

<h2>All games (${games.length})</h2>
<table><tr><th>Game</th><th>Status</th><th>Updated</th></tr>${games.map(
      (g) => html`<tr><td><a href="/admin/games/${g.id}">${g.title}</a> <span style="color:var(--muted)">/g/${g.slug}</span></td><td>${pill(g.status)}</td><td>${when(g.updated_at)}</td></tr>`,
    )}</table>`,
  );
}

async function gameDetail(env: Env, id: string, error = ""): Promise<Response> {
  const game = await gameById(env.DB, id);
  if (!game) return new Response("Not found", { status: 404 });
  const [versions, reports, log, owner, images] = await Promise.all([
    versionsForGame(env.DB, id),
    openReports(env.DB),
    auditLog(env.DB, id),
    gameOwner(env.DB, game.owner_id),
    imagesForGame(env.DB, id),
  ]);
  const mine = reports.filter((r) => r.game_id === id);

  return page(
    env,
    game.title,
    html`<h1>${game.title} ${pill(game.status)}</h1>
<p class="lead">${game.description}</p>
<div class="row">
  <a class="btn ghost" href="/g/${game.slug}">Game page</a>
  <a class="btn ghost" href="${gameUrl(env, game.slug)}">Game file server</a>
</div>
${error ? html`<p class="note" style="color:var(--danger)">${error}</p>` : ""}

<h2>Takedown</h2>
${game.status === "removed" || game.status === "held"
      ? html`<form method="post" action="/admin/games/${game.id}/restore" class="row"><input name="reason" placeholder="Why (optional)"><button class="btn" type="submit">${game.status === "held" ? "Clear and show again" : "Restore"}</button></form>`
      : html`<form method="post" action="/admin/games/${game.id}/takedown" class="row"><input name="reason" placeholder="Reason (required, goes in the audit log)" required size="40"><button class="btn danger" type="submit">Take down now</button></form>`}

<h2>Details</h2>
<p>Visibility: ${pill(game.visibility)} · Devices: ${game.devices || "not set"} · Controls: ${game.controls || "not set"} · Screen: ${game.screen || "not set"}</p>
${images.length ? html`<div class="shots">${images.map((i) => html`<div>${imageReview(i, true)}</div>`)}</div>` : html`<p class="note">No cover or screenshots yet.</p>`}

<h2>Owner</h2>
<p>${owner ? html`${owner.name} <span class="muted">(${owner.owner.kind}${owner.owner.account_id ? `, account ${owner.owner.account_id}` : ""})</span>` : "No owner yet."}</p>
<form method="post" action="/admin/games/${game.id}/owner" class="row">
  <input name="account_id" placeholder="Account ID (blank for no owner)" size="40" value="${owner?.owner.account_id ?? ""}">
  <button class="btn ghost" type="submit">Set owner</button>
</form>

<h2>Shelves</h2>
<form method="post" action="/admin/games/${game.id}/shelves" class="row">
  <input type="hidden" name="off" value="${game.off_shelves ? "0" : "1"}"><input type="hidden" name="back" value="game">
  <span>${game.off_shelves ? "Kept off Popular, Trending and New." : "Can show on Popular, Trending and New."}</span>
  <button class="btn ghost" type="submit">${game.off_shelves ? "Put back on the shelves" : "Keep off the shelves"}</button>
</form>

<h2>Cloud saves</h2>
<form method="post" action="/admin/games/${game.id}/saves" class="row">
  <label class="row"><input type="checkbox" name="cloud_saves" ${game.cloud_saves ? "checked" : ""}> Copy signed-in players' browser saves to their account. Turn off for games that keep their own saves.</label>
  <button class="btn ghost" type="submit">Save</button>
</form>

<h2>Multiplayer</h2>
<form method="post" action="/admin/games/${game.id}/multiplayer" class="stack">
  <label>Game server
    <select name="game_server">
      <option value="">None (single-player)</option>
      ${BUILT_IN_GAME_SERVERS.map((s) => html`<option value="${s}" ${game.game_server === s ? "selected" : ""}>${s}</option>`)}
      <option value="${SANDBOX_GAME_SERVER}" ${game.game_server === SANDBOX_GAME_SERVER ? "selected" : ""}>The game's own (zaisma-server.js, in a sandbox)</option>
    </select></label>
  <label>The game's own servers, one per line, like wss://play.example.com (at most 5). The game may connect to them, and they're listed on the game page.
    <textarea name="connect_hosts" rows="3">${game.connect_hosts}</textarea></label>
  <div><button class="btn" type="submit">Save</button></div>
</form>

<h2>Open reports (${mine.length})</h2>
${mine.length
      ? html`<table>${mine.map((r) => html`<tr><td>${severityPill(r.severity)}</td><td>${reportLabel(r)}${r.player_id ? html`<br><small class="muted">Player ID ${r.player_id}</small>` : ""}</td><td>${r.details}${pictureLink(r)}${r.triage ? html`<br><small class="muted">${(JSON.parse(r.triage) as Triage).summary}</small>` : ""}</td><td>${when(r.created_at)}</td></tr>`)}</table>
<form method="post" action="/admin/games/${game.id}/dismiss" class="row" style="margin-top:10px"><input name="reason" placeholder="Why (optional)"><button class="btn ghost" type="submit">Dismiss reports</button></form>`
      : html`<p class="note">None.</p>`}

<h2>Versions</h2>
${versions.map((v) => {
      const report: ScanReport | null = v.scan_report ? JSON.parse(v.scan_report) : null;
      const current = v.id === game.current_version_id;
      return html`<div class="note" style="margin-bottom:12px">
  <div class="row"><strong>${v.id}</strong> ${pill(v.scan_status)} ${current ? html`<span class="pill live">players get this one</span>` : ""}
    <span>${v.file_count} files · ${(v.bytes / 1048576).toFixed(1)} MB · ${when(v.created_at)}</span></div>
  ${v.report_held_at && v.scan_status === "held" ? html`<p><strong>A report paused this update.</strong> Players are on the version before it. Put it back if the report was wrong.</p>` : ""}
  ${report ? scanReport(report) : html`<p>Scan in progress…</p>`}
  ${v.scan_status !== "approved" || !current
        ? html`<div class="row">
    ${v.scan_status !== "approved" ? html`<form method="post" action="/admin/versions/${v.id}/approve"><button class="btn" type="submit">${v.report_held_at ? "Put the update back" : v.publish_when_approved ? "Approve and publish" : "Approve as a draft"}</button></form>` : ""}
    ${v.scan_status !== "rejected" ? html`<form method="post" action="/admin/versions/${v.id}/reject"><button class="btn ghost" type="submit">${v.report_held_at ? "Keep it off" : "Reject"}</button></form>` : ""}
  </div>`
        : ""}
</div>`;
    })}

<h2>History</h2>
${auditTable(log)}`,
  );
}

function scanReport(r: ScanReport): Raw {
  return html`
${r.childSafety ? html`<p style="color:var(--danger)"><strong>Child-safety flag.</strong> Don't delete anything. Review, and if confirmed report to NCMEC (CyberTipline) as the law requires.</p>` : ""}
<p>Scan result: ${pill(r.decision)} · image matching: ${r.images.connected ? `${r.images.provider}, ${r.images.checked} checked` : "not connected"} · AI: ${r.ai ? `${r.ai.verdict} (${r.ai.model})` : "not run"}</p>
${r.ai?.summary ? html`<p>${r.ai.summary}</p>` : ""}
${r.findings.length
    ? html`<table><tr><th>Level</th><th>Check</th><th>What</th><th>File</th></tr>${r.findings.map(
        (f) => html`<tr><td>${pill(f.severity)}</td><td>${f.rule}</td><td>${f.detail}</td><td>${f.path ?? ""}</td></tr>`,
      )}</table>`
    : ""}
${r.outsideHosts.length ? html`<p>Outside sites referenced: ${r.outsideHosts.join(", ")}</p>` : ""}`;
}

function auditTable(log: Awaited<ReturnType<typeof auditLog>>): Raw {
  return log.length
    ? html`<table><tr><th>When</th><th>Game</th><th>Action</th><th>Reason</th><th>By</th></tr>${log.map(
        (e) => html`<tr><td>${when(e.at)}</td><td>${e.slug ?? ""}</td><td>${e.action}</td><td>${e.reason}</td><td>${e.actor}</td></tr>`,
      )}</table>`
    : html`<p class="note">Nothing yet.</p>`;
}

async function auditPage(env: Env): Promise<Response> {
  return page(env, "Audit log", html`<h1>Audit log</h1>${auditTable(await auditLog(env.DB))}`);
}

function imageReview(i: GameImage, fromGame = false): Raw {
  return html`<a href="/admin/images/${i.id}"><img src="/admin/images/${i.id}" alt="${i.kind}" loading="lazy"></a>
<p>${i.kind} ${pill(i.status)} <span class="muted">${i.width}×${i.height}</span></p>
${i.status === "pending"
    ? html`<div class="row"><form method="post" action="/admin/images/${i.id}/approve"><input type="hidden" name="back" value="${fromGame ? "game" : ""}"><button class="btn" type="submit">Approve</button></form>
<form method="post" action="/admin/images/${i.id}/reject"><input type="hidden" name="back" value="${fromGame ? "game" : ""}"><button class="btn ghost" type="submit">Reject</button></form></div>`
    : ""}`;
}

export type QueueRow = Report & { slug: string; title: string; game_status: GameStatus };

export interface ReportGroup {
  /** The first report's id: group actions close it and every report merged into it. */
  id: string;
  rows: QueueRow[];
  /** The most serious report, latest first: its triage leads the card. */
  lead: QueueRow;
  severity: number;
  triage: Triage | null;
  rechecks: NonNullable<Triage["recheck"]>[];
}

/** Open reports as groups about the same problem, most serious first, then the longest waiting. */
export function groupReports(rows: QueueRow[]): ReportGroup[] {
  const groups = new Map<string, QueueRow[]>();
  for (const r of [...rows].sort((a, b) => a.created_at - b.created_at)) {
    const key = r.group_id ?? r.id;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const parse = (r: QueueRow): Triage | null => (r.triage ? JSON.parse(r.triage) : null);
  return [...groups]
    .map(([id, rows]) => {
      const lead = rows.reduce((a, b) => (b.severity < a.severity || (b.severity === a.severity && b.created_at > a.created_at) ? b : a));
      const triages = rows.map(parse);
      return { id, rows, lead, severity: lead.severity, triage: parse(lead) ?? [...triages].reverse().find(Boolean) ?? null, rechecks: triages.flatMap((t) => (t?.recheck ? [t.recheck] : [])) };
    })
    .sort((a, b) => a.severity - b.severity || a.rows[0]!.created_at - b.rows[0]!.created_at);
}

export const severityPill = (n: number) => html`<span class="pill sev${n}">${SEVERITIES[n] ?? "Normal"}</span>`;

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

const PRECEDENT_LABEL: Record<PrecedentDecision, string> = { dismiss: "dismiss", bug: "tell the developer", recheck: "check the files again", take_down: "take down" };

const RECOMMENDED: Record<Triage["recommendation"], string> = {
  dismiss: "Dismiss",
  bug: "Tell the developer",
  recheck: "Wait for the re-check",
  person: "Your call",
  take_down: "Take the game down",
  restore: "Put the game back",
};

/** Every open report, sorted and merged by AI triage (triage.ts), each group decided in one click. */
async function reportQueue(env: Env): Promise<Response> {
  const week = Date.now() - 7 * 86400_000;
  const [{ results: open }, { results: handled }, { results: paused }] = await Promise.all([
    env.DB
      .prepare("SELECT reports.*, games.slug, games.title, games.status AS game_status FROM reports JOIN games ON games.id = reports.game_id WHERE reports.status = 'open' ORDER BY reports.created_at LIMIT 500")
      .all<QueueRow>(),
    // Closed by triage itself (bugs passed to the developer, dismissals under a precedent), to look over.
    env.DB
      .prepare("SELECT reports.*, games.slug, games.title, games.status AS game_status FROM reports JOIN games ON games.id = reports.game_id WHERE reports.status != 'open' AND reports.closed_at = reports.triaged_at AND reports.closed_at > ? ORDER BY reports.closed_at DESC LIMIT 100")
      .bind(week)
      .all<QueueRow>(),
    env.DB.prepare("SELECT id, game_id FROM versions WHERE report_held_at IS NOT NULL AND scan_status = 'held'").all<{ id: string; game_id: string }>(),
  ]);
  const groups = groupReports(open);
  const pausedUpdate = new Map(paused.map((v) => [v.game_id, v.id]));
  const waiting = open.filter((r) => !r.triaged_at).length;
  return page(
    env,
    "Reports",
    html`<h1>Reports</h1>
<p class="lead">${groups.length ? `${open.length} open ${open.length === 1 ? "report" : "reports"} about ${groups.length} ${groups.length === 1 ? "problem" : "problems"}, most serious first.` : "No open reports."}${waiting ? ` ${waiting} still being sorted.` : ""}</p>
${groups.map((g) => groupCard(g, pausedUpdate.get(g.lead.game_id)))}
${handled.length
      ? html`<details class="handled"><summary><h2>Handled without you this week (${handled.length})</h2></summary>
<table><tr><th>Game</th><th>What</th><th>Done</th><th>Player wrote</th><th>When</th></tr>${handled.map((r) => {
          const t: Triage | null = r.triage ? JSON.parse(r.triage) : null;
          return html`<tr><td><a href="/admin/games/${r.game_id}">${r.title}</a></td><td>${t?.summary ?? reportLabel(r)}</td><td>${t?.actions.join("; ") ?? ""}</td><td>${r.details}</td><td class="nowrap">${ago(r.created_at)}</td></tr>`;
        })}</table></details>`
      : ""}`,
  );
}

function groupCard(g: ReportGroup, pausedUpdate: string | undefined): Raw {
  const t = g.triage;
  const game = g.lead;
  const rec = t?.recommendation;
  const button = (label: string, action: string, recommended: boolean, danger = false) =>
    html`<button class="btn${recommended ? (danger ? " danger" : "") : " ghost"}" type="submit" formaction="${action}">${label}</button>`;
  const gameHeld = game.game_status === "held";
  const gameRemoved = game.game_status === "removed";
  const prefill = t?.summary && t.ai ? t.summary : reportLabel(game);
  const challenged = t?.precedent?.fit === "challenges" ? t.precedent : null;
  const draft = t?.draft;
  return html`<article class="note case sev${g.severity}">
  <div class="row">${severityPill(g.severity)}${t?.spot_check ? html` <span class="pill spot">Spot-check</span>` : ""} <a href="/admin/games/${game.game_id}"><strong>${game.title}</strong></a> ${game.game_status !== "live" ? pill(game.game_status) : ""}
    <span class="muted">${g.rows.length > 1 ? `${g.rows.length} reports · first ${ago(g.rows[0]!.created_at)}` : ago(game.created_at)}</span></div>
  ${t ? html`<p class="said">${t.summary}</p>` : html`<p class="said">${reportLabel(game)}${game.details ? html`: “${game.details}”` : ""}</p><p class="muted">Waiting to be sorted.</p>`}
  ${t ? html`<p class="muted">Recommended: <strong>${RECOMMENDED[t.recommendation]}</strong>. ${t.why}${t.ai ? "" : " (Not sorted by AI.)"}</p>` : ""}
  ${t?.precedent
    ? html`<p class="muted">${t.precedent.fit === "fits" ? "Fits" : "Challenges"} the precedent <a href="/admin/precedents#p-${t.precedent.id}">${t.precedent.title}</a>.</p>`
    : t?.ai
      ? html`<p class="muted">No precedent covers this yet.</p>`
      : ""}
  ${t?.actions.length ? html`<p class="muted">Done already: ${t.actions.join("; ")}.</p>` : ""}
  ${g.rechecks.map(
    (c) =>
      html`<p class="muted">Re-check of the game's files: ${c.status === "waiting" ? "running…" : c.status === "failed" ? `didn't finish (${c.summary ?? ""})` : c.findings?.length ? html`${c.decision === "rejected" ? pill("rejected") : ""} found ${c.findings.join("; ")}. ${c.summary ?? ""}` : `nothing new. ${c.summary ?? ""}`}</p>`,
  )}
  <details><summary>What players sent (${g.rows.length})</summary><table>${g.rows.map(
    (r) => html`<tr><td class="nowrap">${ago(r.created_at)}</td><td>${reportLabel(r)}${r.player_id ? html`<br><small class="muted">Player ID ${r.player_id}</small>` : ""}</td><td>${r.details || html`<span class="muted">No details</span>`}${pictureLink(r)}</td></tr>`,
  )}</table></details>
  <form method="post" class="decide">
    <input type="hidden" name="back" value="queue">
    <input type="hidden" name="group" value="${g.id}">
    ${challenged ? html`<input type="hidden" name="p_replaces" value="${challenged.id}">` : ""}
    <div class="precedent">
      <label class="check"><input type="checkbox" name="precedent" value="1"${draft || challenged ? raw(" checked") : ""}> ${challenged ? html`Change the precedent “${challenged.title}” to decide cases like this the way you decide this one` : draft ? html`Also make it a precedent: <strong>${draft.title}</strong>` : "Also make it a precedent for cases like this"}</label>
      <details><summary>${draft ? html`Edit the precedent <span class="muted">· the AI suggests: ${PRECEDENT_LABEL[draft.decision]}</span>` : "Write the precedent"}</summary>
        <label>Name <input name="p_title" value="${draft?.title ?? ""}" maxlength="120"></label>
        <label>Applies when <textarea name="p_when" rows="2" maxlength="500">${draft?.applies_when ?? ""}</textarea></label>
        <label>Why <textarea name="p_why" rows="2" maxlength="500">${draft?.why ?? ""}</textarea></label>
        <label class="check"><input type="checkbox" name="p_alone" value="1"> If you dismiss it: the AI may dismiss cases like this without you</label>
      </details>
    </div>
    <div class="row">
    <input name="reason" value="${prefill}" aria-label="Reason, for the audit log" maxlength="500">
    ${gameRemoved
      ? button("Close", `/admin/report-groups/${g.id}/dismiss`, true)
      : gameHeld
        ? html`${button("Put the game back", `/admin/games/${game.game_id}/restore`, rec === "restore" || rec === "dismiss")}${button("Take down", `/admin/games/${game.game_id}/takedown`, rec === "take_down", true)}`
        : pausedUpdate
          ? html`${button("Put the update back", `/admin/versions/${pausedUpdate}/approve`, rec === "restore" || rec === "dismiss")}${button("Keep the update off", `/admin/versions/${pausedUpdate}/reject`, false)}${button("Take down", `/admin/games/${game.game_id}/takedown`, rec === "take_down", true)}`
          : html`${button("Dismiss", `/admin/report-groups/${g.id}/dismiss`, rec === "dismiss")}${g.rows.some((r) => r.room_name) ? button("Hide the room's name", `/admin/report-groups/${g.id}/hide-name`, false) : ""}${g.severity === 0 ? "" : button("Tell the developer", `/admin/report-groups/${g.id}/bug`, rec === "bug")}${button("Take down", `/admin/games/${game.game_id}/takedown`, rec === "take_down", true)}`}
    </div>
  </form>
</article>`;
}

/** What a decision in the queue means as a precedent: putting a game back means the report was wrong. */
function precedentDecision(path: string): PrecedentDecision | null {
  if (/^\/admin\/(report-groups\/[a-z0-9]+\/dismiss|games\/[a-z0-9]+\/restore|versions\/[a-z0-9]+\/approve)$/.test(path)) return "dismiss";
  if (/^\/admin\/report-groups\/[a-z0-9]+\/bug$/.test(path)) return "bug";
  if (/^\/admin\/(games\/[a-z0-9]+\/takedown|versions\/[a-z0-9]+\/reject)$/.test(path)) return "take_down";
  return null;
}

const pictureLink = (r: { id: string; picture: number }) => (r.picture ? html` <a href="/admin/reports/${r.id}/picture" target="_blank">Picture</a>` : "");

/** The picture of the game a player included with a report. */
async function reportPicture(env: Env, id: string): Promise<Response> {
  const object = await env.GAMES.get(reportPictureKey(id));
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}

async function adminImage(env: Env, id: string): Promise<Response> {
  const img = await imageById(env.DB, id);
  const object = img ? await env.GAMES.get(imageKey(img)) : null;
  if (!img || !object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": img.content_type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
