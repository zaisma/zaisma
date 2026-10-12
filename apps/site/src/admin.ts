import {
  BUILT_IN_GAME_SERVERS,
  LIMITS,
  reportLabel,
  reportPictureKey,
  clearVersion,
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
  type ScanReport,
} from "@zaisma/core";
import { adminIdentity } from "./access.ts";
import { gameUrl, type Env } from "./env.ts";
import { html, layout, type Raw } from "./html.ts";
import { passVersion } from "./scan.ts";
import { uploadGame } from "./upload.ts";

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const pill = (s: string) => html`<span class="pill ${s}">${s}</span>`;

function page(env: Env, title: string, body: Raw): Response {
  return layout(env, { title: `${title} · Zaisma admin`, body, admin: true });
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to } });
}

export async function handleAdmin(request: Request, env: Env, path: string): Promise<Response> {
  const actor = await adminIdentity(request, env);
  if (!actor) return new Response("Forbidden", { status: 403 });

  if (request.method === "POST") {
    // Admin forms only come from our own pages.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
    return adminAction(request, env, path, actor);
  }

  if (path === "/admin") return dashboard(env);
  if (path === "/admin/audit") return auditPage(env);
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

  const form = await request.formData();
  const reason = String(form.get("reason") ?? "").trim().slice(0, 500);

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
    return redirect(`/admin/games/${version.game_id}`);
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

  m = path.match(/^\/admin\/games\/([a-z0-9]+)\/multiplayer$/);
  if (m) {
    const game = await gameById(env.DB, m[1]!);
    if (!game) return new Response("Not found", { status: 404 });
    const server = String(form.get("game_server") ?? "");
    if (server && !(BUILT_IN_GAME_SERVERS as readonly string[]).includes(server)) return gameDetail(env, game.id, "Pick a game server from the list.");
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
    return redirect(`/admin/games/${game.id}`);
  }
  return new Response("Not found", { status: 404 });
}

async function dashboard(env: Env, error = ""): Promise<Response> {
  const [queue, reports, games, usage, images, words] = await Promise.all([
    heldVersions(env.DB),
    openReports(env.DB),
    allGames(env.DB),
    aiUsage(env.DB),
    pendingImages(env.DB),
    gamesWithDetailsDrafts(env.DB),
  ]);
  return page(
    env,
    "Admin",
    html`<h1>Admin</h1>
<p class="lead">AI review this month: ${usage.scans} scans, ${usage.input_tokens.toLocaleString("en-US")} of ${Number(env.AI_MONTHLY_INPUT_TOKENS).toLocaleString("en-US")} input tokens.</p>

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

<h2>Open reports (${reports.length})</h2>
${reports.length
      ? html`<table><tr><th>Game</th><th>Reason</th><th>Details</th><th>When</th></tr>${reports.map(
          (r) => html`<tr><td><a href="/admin/games/${r.game_id}">${r.title}</a> ${pill(r.game_status)}</td><td>${reportLabel(r)}</td><td>${r.details}${pictureLink(r)}</td><td>${when(r.created_at)}</td></tr>`,
        )}</table>`
      : html`<p class="note">No open reports.</p>`}

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
    </select></label>
  <label>The game's own servers, one per line, like wss://play.example.com (at most 5). The game may connect to them, and they're listed on the game page.
    <textarea name="connect_hosts" rows="3">${game.connect_hosts}</textarea></label>
  <div><button class="btn" type="submit">Save</button></div>
</form>

<h2>Open reports (${mine.length})</h2>
${mine.length
      ? html`<table>${mine.map((r) => html`<tr><td>${reportLabel(r)}${r.player_id ? html`<br><small class="muted">Player ID ${r.player_id}</small>` : ""}</td><td>${r.details}${pictureLink(r)}</td><td>${when(r.created_at)}</td></tr>`)}</table>
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
