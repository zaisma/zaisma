import type { Account } from "@zaisma/core";
import type { Env } from "./env.ts";
import { html, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";

/**
 * Protect your account (docs/DECISIONS.md, "Accounts get protected once there's something to lose"). A fresh
 * account has nothing worth stealing, so sign-up asks for nothing more. Once a player with neither a passkey nor
 * an email comes back to progress they saved, the home page (never over a game) asks once for one; after that
 * the account page keeps a line while the account has neither. Plain words, and it never asks for the password.
 */

/** A cloud save at least this old means the player saved, left and came back. */
export const PROTECTION_OFFER_SAVE_AGE_MS = 3600_000;

export const PROTECT_WORDS = "Add a passkey or an email so only you can sign in, even if someone learns your password.";

/** Whether the home page asks now: no email, not asked before, no passkey, and a save from an earlier visit. */
export async function isProtectionOfferDue(env: Env, account: Account, email: string | null, nowMs = Date.now()): Promise<boolean> {
  if (email || account.protection_offered_at_ms !== null) return false;
  const due = await env.DB.prepare(
    "SELECT EXISTS (SELECT 1 FROM saves WHERE account_id = ?1 AND updated_at_ms <= ?2) AND NOT EXISTS (SELECT 1 FROM passkeys WHERE account_id = ?1) AS is_due",
  )
    .bind(account.id, nowMs - PROTECTION_OFFER_SAVE_AGE_MS)
    .first<{ is_due: number }>();
  return due?.is_due === 1;
}

/** Asked once: shown is enough, so ignoring it counts too. */
export async function markProtectionOffered(env: Env, accountId: string, nowMs = Date.now()): Promise<void> {
  await env.DB.prepare("UPDATE accounts SET protection_offered_at_ms = ? WHERE id = ? AND protection_offered_at_ms IS NULL").bind(nowMs, accountId).run();
}

/** The one-time window on the home page. Both ways in are added on the account page, behind Confirm it's you. */
export function protectAccountWindow(): Raw {
  return html`<dialog id="protect-account" class="wizard short bevel-l" aria-labelledby="protect-account-title">
  <div class="wizard-head"><div><h2 id="protect-account-title">Protect your account</h2><p class="wizard-sub">${PROTECT_WORDS}</p></div></div>
  <div class="wizard-foot row">
    <button class="btn ghost" type="button" data-close>Later</button>
    <a class="btn ghost" href="/account#email">Add an email</a>
    <a class="btn light" href="/account#passkeys">Add a passkey</a>
  </div>
</dialog>
${scriptTags(PROTECT_ACCOUNT_SCRIPT)}`;
}

const PROTECT_ACCOUNT_SCRIPT = pageScript("protect-account", `(() => {
  const dialog = document.getElementById("protect-account");
  dialog.showModal();
  for (const close of dialog.querySelectorAll("[data-close]")) close.onclick = () => dialog.close();
})();`);

/** The line that stays on the account page while the account has neither. */
export function protectAccountLine(): Raw {
  return html`<div class="note" id="protect"><p><strong>Protect your account.</strong> ${PROTECT_WORDS}</p>
<div class="row"><a class="btn ghost" href="#passkeys">Add a passkey</a> <a class="btn ghost" href="#email">Add an email</a></div></div>`;
}
