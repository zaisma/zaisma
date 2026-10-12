import {
  LIMITS,
  REPORT_REASONS,
  UploadError,
  aiUsage,
  allGames,
  audit,
  auditLog,
  closeReports,
  gameById,
  heldVersions,
  openReports,
  publishVersion,
  saveScan,
  setGameStatus,
  versionById,
  versionsForGame,
  type ReportReason,
  type ScanReport,
} from "@zaisma/core";
import { adminIdentity } from "./access.ts";
import { gameUrl, type Env } from "./env.ts";
import { html, layout, type Raw } from "./html.ts";
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
    if (m[2] === "approve") {
      await publishVersion(env.DB, version);
      await audit(env.DB, version.game_id, "approved", reason || `Version ${version.id}`, actor);
    } else {
      await saveScan(env.DB, version.id, "rejected", null);
      await audit(env.DB, version.game_id, "rejected", reason || `Version ${version.id}`, actor);
    }
    return redirect(`/admin/games/${version.game_id}`);
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
      await closeReports(env.DB, game.id, "dismissed");
      await audit(env.DB, game.id, "restored", reason, actor);
    } else {
      await closeReports(env.DB, game.id, "dismissed");
      await audit(env.DB, game.id, "reports-dismissed", reason, actor);
    }
    return redirect(`/admin/games/${game.id}`);
  }
  return new Response("Not found", { status: 404 });
}

async function dashboard(env: Env, error = ""): Promise<Response> {
  const [queue, reports, games, usage] = await Promise.all([heldVersions(env.DB), openReports(env.DB), allGames(env.DB), aiUsage(env.DB)]);
  return page(
    env,
    "Admin",
    html`<h1>Admin</h1>
<p class="lead">AI review this month: ${usage.scans} scans, ${usage.input_tokens.toLocaleString("en-US")} of ${Number(env.AI_MONTHLY_INPUT_TOKENS).toLocaleString("en-US")} input tokens.</p>

<h2>Waiting for review (${queue.length})</h2>
${queue.length
      ? html`<table><tr><th>Game</th><th>Version</th><th>Status</th><th>Uploaded</th></tr>${queue.map(
          (v) => html`<tr><td><a href="/admin/games/${v.game_id}">${v.title}</a></td><td>${v.id}</td><td>${pill(v.scan_status)}</td><td>${when(v.created_at)}</td></tr>`,
        )}</table>`
      : html`<p class="note">Nothing waiting.</p>`}

<h2>Open reports (${reports.length})</h2>
${reports.length
      ? html`<table><tr><th>Game</th><th>Reason</th><th>Details</th><th>When</th></tr>${reports.map(
          (r) => html`<tr><td><a href="/admin/games/${r.game_id}">${r.title}</a> ${pill(r.game_status)}</td><td>${REPORT_REASONS[r.reason as ReportReason] ?? r.reason}</td><td>${r.details}</td><td>${when(r.created_at)}</td></tr>`,
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
  const [versions, reports, log] = await Promise.all([versionsForGame(env.DB, id), openReports(env.DB), auditLog(env.DB, id)]);
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

<h2>Open reports (${mine.length})</h2>
${mine.length
      ? html`<table>${mine.map((r) => html`<tr><td>${REPORT_REASONS[r.reason as ReportReason] ?? r.reason}</td><td>${r.details}</td><td>${when(r.created_at)}</td></tr>`)}</table>
<form method="post" action="/admin/games/${game.id}/dismiss" class="row" style="margin-top:10px"><input name="reason" placeholder="Why (optional)"><button class="btn ghost" type="submit">Dismiss reports</button></form>`
      : html`<p class="note">None.</p>`}

<h2>Versions</h2>
${versions.map((v) => {
      const report: ScanReport | null = v.scan_report ? JSON.parse(v.scan_report) : null;
      const current = v.id === game.current_version_id;
      return html`<div class="note" style="margin-bottom:12px">
  <div class="row"><strong>${v.id}</strong> ${pill(v.scan_status)} ${current ? html`<span class="pill live">players get this one</span>` : ""}
    <span>${v.file_count} files · ${(v.bytes / 1048576).toFixed(1)} MB · ${when(v.created_at)}</span></div>
  ${report ? scanReport(report) : html`<p>Scan in progress…</p>`}
  ${v.scan_status !== "approved" || !current
        ? html`<div class="row">
    ${v.scan_status !== "approved" ? html`<form method="post" action="/admin/versions/${v.id}/approve"><button class="btn" type="submit">Approve and publish</button></form>` : ""}
    ${v.scan_status !== "rejected" ? html`<form method="post" action="/admin/versions/${v.id}/reject"><button class="btn ghost" type="submit">Reject</button></form>` : ""}
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
