import { PROFILE_REPORT_REASONS, audit, isIdOf, linkUrlsOf, type Account, type ProfileReportReason } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, type Raw } from "./html.ts";
import { profilePath } from "./profiles.ts";

/**
 * Profiles waiting for a person (docs/DECISIONS.md, "What a profile shows"): ones the check held, ones
 * reports hid, and ones the AI couldn't check. Show lets the words through; Clear empties them, so the
 * profile shows the username alone until its owner writes something else.
 */

type WaitingProfile = Account & { reports: { reason: string; details: string | null }[] };

export async function waitingProfiles(env: Env): Promise<WaitingProfile[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM accounts WHERE profile_check_status = 'held' OR (profile_check_status = 'pending' AND updated_at_ms < ?) OR id IN (SELECT account_id FROM profile_reports) ORDER BY updated_at_ms LIMIT 100",
  )
    .bind(Date.now() - 10 * 60_000)
    .all<Account>();
  if (!results.length) return [];
  const { results: reports } = await env.DB.prepare("SELECT account_id, reason, details FROM profile_reports WHERE account_id IN (SELECT value FROM json_each(?)) ORDER BY created_at_ms")
    .bind(JSON.stringify(results.map((account) => account.id)))
    .all<{ account_id: string; reason: string; details: string | null }>();
  return results.map((account) => ({ ...account, reports: reports.filter((report) => report.account_id === account.id) }));
}

export async function adminProfilesPage(env: Env): Promise<Raw> {
  const profiles = await waitingProfiles(env);
  return html`<h1>Profiles waiting (${profiles.length})</h1>
<p class="lead">Names, bios and links the check held, that reports hid, or that the AI couldn't check. Others see the username alone until you decide.</p>
${profiles.length
    ? html`<table><tr><th>Player</th><th>What they wrote</th><th>Why it's here</th><th></th></tr>${profiles.map(
        (account) => html`<tr><td><a href="${profilePath(account.username)}">@${account.username}</a><br><span class="muted">${account.age_band}</span></td>
<td><strong>${account.display_name ?? ""}</strong>${account.bio ? html`<br><span style="white-space:pre-line">${account.bio}</span>` : ""}${linkUrlsOf(account).map((linkUrl) => html`<br><code>${linkUrl}</code>`)}</td>
<td>${account.profile_check_status === "held" ? account.profile_held_reason ?? "Held" : account.profile_check_status === "pending" ? "Not checked yet" : ""}${account.reports.map((report) => html`<br>Report: ${PROFILE_REPORT_REASONS[report.reason as ProfileReportReason] ?? report.reason}${report.details ? html` (“${report.details}”)` : ""}`)}</td>
<td><div class="row"><form method="post" action="/admin/profiles/${account.player_id}/show"><button class="btn" type="submit">Show</button></form><form method="post" action="/admin/profiles/${account.player_id}/clear"><button class="btn ghost" type="submit">Clear</button></form></div></td></tr>`,
      )}</table>`
    : html`<p class="note">Nothing waiting.</p>`}`;
}

/** Show or Clear: answers where to go next, or null when the path isn't one of these. */
export async function adminProfileAction(env: Env, path: string, actor: string): Promise<string | null> {
  const match = path.match(/^\/admin\/profiles\/([a-z0-9_]+)\/(show|clear)$/);
  if (!match || !isIdOf("player", match[1])) return null;
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE player_id = ?").bind(match[1]).first<Account>();
  if (!account) return "/admin/profiles";
  await env.DB.batch([
    match[2] === "show"
      ? env.DB.prepare("UPDATE accounts SET profile_check_status = CASE WHEN display_name IS NULL AND bio IS NULL AND link_urls = '' THEN NULL ELSE 'passed' END, profile_held_reason = NULL WHERE id = ?").bind(account.id)
      : env.DB.prepare("UPDATE accounts SET display_name = NULL, bio = NULL, link_urls = '', profile_check_status = NULL, profile_held_reason = NULL, updated_at_ms = ? WHERE id = ?").bind(Date.now(), account.id),
    env.DB.prepare("DELETE FROM profile_reports WHERE account_id = ?").bind(account.id),
  ]);
  await audit(env.DB, null, match[2] === "show" ? "profile-shown" : "profile-cleared", `@${account.username}`, actor);
  return "/admin/profiles";
}
