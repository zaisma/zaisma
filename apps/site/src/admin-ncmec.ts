import { isIdOf } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, type Raw } from "./html.ts";
import { clearSafetyPause, detailsOf, pausedAccounts, sendByPerson, type NcmecReport, type NcmecReportStatus, type ReportSource } from "./ncmec.ts";
import { profilePath } from "./profiles.ts";

/**
 * Reports to NCMEC's CyberTipline (ncmec.ts), for a person: what was sent with NCMEC's number, what's ready
 * for a press (a confirmed chat review or player report), and what the daily brake stopped or what failed,
 * each with Send. And the accounts a known-image match paused, each with Clear pause; a ban is on the
 * admin MCP's ban_account. Nothing here opens a matched picture.
 */

export type AdminNcmecReport = NcmecReport & { username: string | null; game_slug: string | null };

export async function ncmecReportsForAdmin(env: Env, maximumReportCount = 200): Promise<AdminNcmecReport[]> {
  return (
    await env.DB.prepare(
      `SELECT ncmec_reports.*, accounts.username, games.slug AS game_slug FROM ncmec_reports LEFT JOIN accounts ON accounts.id = ncmec_reports.account_id LEFT JOIN games ON games.id = ncmec_reports.game_id
       ORDER BY CASE WHEN ncmec_reports.ncmec_report_status = 'sent' THEN 1 ELSE 0 END, ncmec_reports.created_at_ms DESC LIMIT ?`,
    )
      .bind(maximumReportCount)
      .all<AdminNcmecReport>()
  ).results;
}

const SOURCE_WORDS: Record<ReportSource, string> = { image_match: "Known-image match", chat_review: "Chat review", player_report: "Player reports" };

/** Where a report stands, in words. */
export function ncmecReportState(report: NcmecReport): string {
  const words: Record<NcmecReportStatus, string> = {
    ready: "Ready: press Send",
    waiting: `Sending: tried ${report.send_attempt_count} times`,
    sent: `Sent, report ${report.ncmec_report_number}`,
    stopped_by_brake: "Stopped by the daily brake: press Send if it's real",
    failed: "Failed: press Send, or file it by hand at report.cybertip.org",
  };
  return words[report.ncmec_report_status];
}

const isSendable = (report: NcmecReport) => report.ncmec_report_status === "ready" || report.ncmec_report_status === "stopped_by_brake" || report.ncmec_report_status === "failed";

export async function adminNcmecPage(env: Env): Promise<Raw> {
  const [reports, paused] = await Promise.all([ncmecReportsForAdmin(env), pausedAccounts(env)]);
  return html`<h1>NCMEC reports</h1>
<p class="lead">Reports to NCMEC's CyberTipline. A known-image match is sent by itself and pauses the account; a confirmed chat review or player report waits here for Send. Don't open matched pictures and don't delete anything: what's sent is kept a year.</p>
<h2>Paused accounts (${paused.length})</h2>
${paused.length
    ? html`<table><tr><th>Account</th><th>Paused</th><th></th></tr>${paused.map(
        (account) => html`<tr><td><a href="${profilePath(account.username)}">@${account.username}</a></td><td>${new Date(account.safety_paused_at_ms).toISOString().slice(0, 16).replace("T", " ")}</td>
<td><form method="post" action="/admin/ncmec/accounts/${account.id}/clear-pause"><button class="btn ghost" type="submit">Clear pause</button></form></td></tr>`,
      )}</table>`
    : html`<p class="note">No account is paused.</p>`}
<h2>Reports (${reports.length})</h2>
${reports.length
    ? html`<table><tr><th>What</th><th>Account</th><th>Where it stands</th><th></th></tr>${reports.map((report) => {
        const details = detailsOf(report);
        return html`<tr><td>${SOURCE_WORDS[report.report_source]}<br><span class="muted">${report.game_slug ? html`<a href="/admin/games/${report.game_id}">${report.game_slug}</a> · ` : ""}${new Date(report.created_at_ms).toISOString().slice(0, 16).replace("T", " ")} · ${details.files.length} file${details.files.length === 1 ? "" : "s"}</span></td>
<td>${report.username ? html`<a href="${profilePath(report.username)}">@${report.username}</a>` : details.account ? html`@${details.account.username} <span class="muted">(deleted)</span>` : html`<span class="muted">Unknown</span>`}</td>
<td>${ncmecReportState(report)}${report.last_error ? html`<br><span class="muted">${report.last_error}</span>` : ""}</td>
<td>${isSendable(report) ? html`<form method="post" action="/admin/ncmec/${report.id}/send"><button class="btn" type="submit">Send</button></form>` : ""}</td></tr>`;
      })}</table>`
    : html`<p class="note">No reports yet.</p>`}`;
}

/** The page's buttons: answers where to go next, or null when the path isn't one of these. */
export async function adminNcmecAction(env: Env, path: string, actor: string): Promise<string | null> {
  const send = path.match(/^\/admin\/ncmec\/([a-z0-9_]+)\/send$/);
  if (send && isIdOf("ncmec_report", send[1])) {
    await sendByPerson(env, send[1], actor);
    return "/admin/ncmec";
  }
  const clear = path.match(/^\/admin\/ncmec\/accounts\/([A-Za-z0-9_-]+)\/clear-pause$/);
  if (clear) {
    await clearSafetyPause(env, clear[1]!, actor);
    return "/admin/ncmec";
  }
  return null;
}
