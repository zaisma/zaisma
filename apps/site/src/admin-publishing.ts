import { accountById, accountByUsername, audit, publishingAccounts, setCanPublish } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, type Raw } from "./html.ts";
import { profilePath } from "./profiles.ts";

/**
 * Who can make games before the beta (docs/DECISIONS.md, "Uploads are only for people Julius adds until
 * the beta"): the accounts with accounts.can_publish, added and removed by username. The developer
 * API's router checks the flag on every call that makes, uploads or publishes (isPublishing), so the
 * dashboard, the MCP and the upload command all follow it. The admin MCP's list_publishing_accounts and
 * set_can_publish do the same as this page.
 */

export async function adminPublishingPage(env: Env, notFoundUsername: string | null = null): Promise<Raw> {
  const accounts = await publishingAccounts(env.DB);
  return html`<h1>Who can publish (${accounts.length})</h1>
<p class="lead">Until the beta, only these accounts can make, upload and publish games. Uploads open to every account when the beta opens.</p>
${notFoundUsername ? html`<p class="error" role="alert">No account has the username ${notFoundUsername}.</p>` : ""}
<form class="row" method="post" action="/admin/publishing/add"><input name="username" maxlength="30" required placeholder="Username" aria-label="Username"><button class="btn" type="submit">Add</button></form>
${accounts.length
    ? html`<table><tr><th>Account</th><th>Games</th><th></th></tr>${accounts.map(
        (account) => html`<tr><td><a href="${profilePath(account.username)}">@${account.username}</a></td><td>${account.game_count}</td>
<td><form method="post" action="/admin/publishing/${account.account_id}/remove"><button class="btn ghost" type="submit">Remove</button></form></td></tr>`,
      )}</table>`
    : html`<p class="note">Nobody yet.</p>`}`;
}

/** Let an account make games, or stop it, with an audit line. Shared by the page and the admin MCP. */
export async function setAccountCanPublish(env: Env, accountId: string, username: string, canPublish: boolean, actor: string): Promise<void> {
  await setCanPublish(env.DB, accountId, canPublish);
  await audit(env.DB, null, canPublish ? "publishing-allowed" : "publishing-stopped", `@${username}`, actor);
}

/** The page's buttons: answers where to go next, or null when the path isn't one of these. */
export async function adminPublishingAction(env: Env, path: string, form: FormData, actor: string): Promise<string | null> {
  if (path === "/admin/publishing/add") {
    const username = String(form.get("username") ?? "")
      .trim()
      .replace(/^@/, "")
      .slice(0, 30);
    const account = username ? await accountByUsername(env.DB, username) : null;
    if (!account) return `/admin/publishing?not_found=${encodeURIComponent(username)}`;
    await setAccountCanPublish(env, account.id, account.username, true, actor);
    return "/admin/publishing";
  }
  const match = path.match(/^\/admin\/publishing\/([A-Za-z0-9_-]{1,64})\/remove$/);
  if (!match) return null;
  const account = await accountById(env.DB, match[1]!);
  if (account) await setAccountCanPublish(env, account.id, account.username, false, actor);
  return "/admin/publishing";
}
