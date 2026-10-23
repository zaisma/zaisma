import { sha256Hex } from "@zaisma/core";
import type { Env } from "./env.ts";
import { esc } from "./html.ts";

/**
 * Email codes are Zaisma's own (docs/DECISIONS.md, "Accounts open only through Zaisma"): 6 digits, kept only
 * as a hash, good for 10 minutes, one live code per address, dead once 5 tries are spent, and at most 3 an
 * hour and 10 a day to one address. A right code opens the account the way a passkey does (sessionForUser in
 * auth.ts), so Supabase never holds a code someone could guess through its open verify link. Cloudflare Email
 * Sending sends them from zaisma.com.
 */

export const CODE_DURATION_MIN = 10;
const CODE_DURATION_MS = CODE_DURATION_MIN * 60_000;
const MAXIMUM_TRY_COUNT = 5;
const CODES_PER_HOUR = 3;
const CODES_PER_DAY = 10;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** What a right code does for its account: opens it, or adds the address to it. */
export type EmailCodeKind = "sign_in" | "add_email";

/** What the email says the code is for: signing in, confirming it's you on the account page, or adding the address. */
export type EmailCodeReason = "sign_in" | "confirm" | "add_email";

export type EmailCodeSending = "sent" | "too-many" | "failed";

const emailHash = (email: string) => sha256Hex(new TextEncoder().encode(email.trim().toLowerCase()));
const codeHash = (emailSha256: string, code: string) => sha256Hex(new TextEncoder().encode(`${emailSha256}:${code}`));

/** Six digits, each number as likely as any other. */
function newCode(): string {
  const draw = new Uint32Array(1);
  // Numbers past the last whole million in a 32-bit draw would make low codes likelier: draw again.
  do crypto.getRandomValues(draw);
  while (draw[0]! >= 4_294_000_000);
  return String(draw[0]! % 1_000_000).padStart(6, "0");
}

/**
 * Ask for a code to an address. Only an address with an account (accountId) gets one; one without is
 * answered and counted the same, so neither the page nor the limits say who has an account. A new code
 * replaces the address's last one.
 */
export async function sendEmailCode(env: Env, request: { email: string; accountId: string | null; kind: EmailCodeKind; reason: EmailCodeReason }, nowMs = Date.now()): Promise<EmailCodeSending> {
  const emailSha256 = await emailHash(request.email);
  const counted = await env.DB.prepare("SELECT COUNT(*) AS day_request_count, COALESCE(SUM(requested_at_ms > ?), 0) AS hour_request_count FROM email_code_requests WHERE email_sha256 = ? AND requested_at_ms > ?")
    .bind(nowMs - HOUR_MS, emailSha256, nowMs - DAY_MS)
    .first<{ day_request_count: number; hour_request_count: number }>();
  if ((counted?.hour_request_count ?? 0) >= CODES_PER_HOUR || (counted?.day_request_count ?? 0) >= CODES_PER_DAY) return "too-many";
  await env.DB.prepare("INSERT INTO email_code_requests (email_sha256, requested_at_ms) VALUES (?, ?)").bind(emailSha256, nowMs).run();
  if (!request.accountId) return "sent";

  const code = newCode();
  await env.DB.prepare(
    `INSERT INTO email_codes (email_sha256, account_id, kind, code_sha256, try_count, created_at_ms) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT (email_sha256) DO UPDATE SET account_id = excluded.account_id, kind = excluded.kind, code_sha256 = excluded.code_sha256, try_count = 0, created_at_ms = excluded.created_at_ms`,
  )
    .bind(emailSha256, request.accountId, request.kind, await codeHash(emailSha256, code), nowMs)
    .run();
  if (await deliverCode(env, request.email, code, request.reason)) return "sent";
  await env.DB.prepare("DELETE FROM email_codes WHERE email_sha256 = ?").bind(emailSha256).run();
  return "failed";
}

/**
 * The account a right code is for, once: the code is used up. Every check spends one of the code's 5 tries
 * first, so tries sent at the same moment count too. null for a wrong, used, old or spent code.
 */
export async function checkEmailCode(env: Env, email: string, code: string, kind: EmailCodeKind, nowMs = Date.now()): Promise<string | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const emailSha256 = await emailHash(email);
  const spent = await env.DB.prepare("UPDATE email_codes SET try_count = try_count + 1 WHERE email_sha256 = ? AND kind = ? AND try_count < ? AND created_at_ms > ? RETURNING code_sha256")
    .bind(emailSha256, kind, MAXIMUM_TRY_COUNT, nowMs - CODE_DURATION_MS)
    .first<{ code_sha256: string }>();
  if (!spent || spent.code_sha256 !== (await codeHash(emailSha256, code))) return null;
  const used = await env.DB.prepare("DELETE FROM email_codes WHERE email_sha256 = ? AND code_sha256 = ? RETURNING account_id").bind(emailSha256, spent.code_sha256).first<{ account_id: string }>();
  return used?.account_id ?? null;
}

/** An account's codes still waiting, gone: its address changed or was taken off, so a code sent to the old one opens nothing. */
export async function deleteEmailCodesOf(env: Env, accountId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM email_codes WHERE account_id = ?").bind(accountId).run();
}

/** Once a day: codes past their 10 minutes, and requests older than the day the limits look back. */
export async function deleteOldEmailCodes(env: Env, nowMs = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_codes WHERE created_at_ms <= ?").bind(nowMs - CODE_DURATION_MS),
    env.DB.prepare("DELETE FROM email_code_requests WHERE requested_at_ms <= ?").bind(nowMs - DAY_MS),
  ]);
}

// --- The email ---

const CODE_FOR: Record<EmailCodeReason, string> = {
  sign_in: "Enter this code on Zaisma to sign in:",
  confirm: "Enter this code on Zaisma to confirm it's you:",
  add_email: "Enter this code on Zaisma to add this email to your account:",
};

const IF_NOT_YOU: Record<EmailCodeReason, string> = {
  sign_in: "Didn't ask for it? Then ignore this email. Nobody gets into your account without the code.",
  confirm: "Didn't ask for it? Then ignore this email. Nobody gets into your account without the code.",
  add_email: "Didn't ask for it? Then ignore this email. Your address isn't added to anything without the code.",
};

/** The email with a code: its subject (the code first, so it shows in a notification), plain text and HTML. */
export function codeEmail(env: Env, code: string, reason: EmailCodeReason): { subject: string; text: string; html: string } {
  const lasts = `It works once, for ${CODE_DURATION_MIN} minutes.`;
  return {
    subject: `${code} is your Zaisma code`,
    text: `${CODE_FOR[reason]}\n\n${code}\n\n${lasts}\n\n${IF_NOT_YOU[reason]}\n\nZaisma, ${env.SITE_ORIGIN.replace(/^https?:\/\//, "")}\n`,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><title>${code} is your Zaisma code</title></head>
<body style="margin:0;padding:32px 16px;background:#0b0d10;color:#eceef0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px">
<tr><td style="padding:0 0 28px"><img src="${esc(env.SITE_ORIGIN)}/zaisma-wordmark-white-2400.png" width="112" alt="Zaisma" style="display:block;width:112px;height:auto;border:0"></td></tr>
<tr><td style="font-size:16px;line-height:1.5;color:#c6c9ce">${esc(CODE_FOR[reason])}</td></tr>
<tr><td style="padding:18px 0 22px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:36px;font-weight:600;letter-spacing:8px;color:#eceef0">${code}</td></tr>
<tr><td style="font-size:14px;line-height:1.5;color:#969ba4">${esc(lasts)} ${esc(IF_NOT_YOU[reason])}</td></tr>
</table></td></tr></table>
</body></html>`,
  };
}

/** Send an email; false when it didn't go. The preview and tests send to a stand-in (EMAIL_OUTBOX_URL) instead. */
export async function deliverEmail(env: Env, email: string, message: { subject: string; text: string; html: string }): Promise<boolean> {
  try {
    if (env.EMAIL_OUTBOX_URL) {
      const response = await fetch(env.EMAIL_OUTBOX_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: env.EMAIL_FROM, to: email, ...message }) });
      return response.ok;
    }
    if (!env.EMAIL) {
      console.error("Email can't be sent: the EMAIL binding isn't set up.");
      return false;
    }
    await env.EMAIL.send({ from: { email: env.EMAIL_FROM, name: "Zaisma" }, to: email, ...message });
    return true;
  } catch (error) {
    console.error("Sending an email failed:", error);
    return false;
  }
}

const deliverCode = (env: Env, email: string, code: string, reason: EmailCodeReason) => deliverEmail(env, email, codeEmail(env, code, reason));

/** The email that says a passkey was added without one of the older ones, and that it waits a day. */
export function passkeyWaitEmail(env: Env, details: { username: string; deviceName: string; addedAtMs: number; approvesFromAtMs: number }): { subject: string; text: string; html: string } {
  const added = waitEndsText(details.addedAtMs);
  const ends = waitEndsText(details.approvesFromAtMs);
  const subject = "A new passkey was added to your Zaisma account";
  // deviceName (core/passkeys.ts) is a plain name like Mac or iPhone, or "a device" when the browser said nothing.
  const where = details.deviceName === "a device" ? "a device" : `${/^[aeiou]/i.test(details.deviceName) ? "an" : "a"} ${details.deviceName}`;
  const first = `A passkey was added to your Zaisma account, ${details.username}, on ${where} at ${added}, without one of your older passkeys. To keep your account safe, it can make API keys and change how you sign in from ${ends}.`;
  const second = "Wasn't you? Sign in at zaisma.com/account with one of your passkeys, remove it under Passkeys, and change your password.";
  return {
    subject,
    text: `${first}\n\n${second}\n\nZaisma, ${env.SITE_ORIGIN.replace(/^https?:\/\//, "")}\n`,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:32px 16px;background:#0b0d10;color:#eceef0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px">
<tr><td style="padding:0 0 28px"><img src="${esc(env.SITE_ORIGIN)}/zaisma-wordmark-white-2400.png" width="112" alt="Zaisma" style="display:block;width:112px;height:auto;border:0"></td></tr>
<tr><td style="font-size:16px;line-height:1.5;color:#c6c9ce;padding:0 0 16px">${esc(first)}</td></tr>
<tr><td style="font-size:14px;line-height:1.5;color:#969ba4">${esc(second)}</td></tr>
</table></td></tr></table>
</body></html>`,
  };
}

/**
 * The email to a developer whose game a person at Zaisma found re-uploaded by someone else, with the uploader's
 * public name (docs/DECISIONS.md, "Copies never pay; history does"). It goes only once the copy is rejected.
 */
export function copyStoppedEmail(env: Env, details: { username: string; gameTitle: string; uploaderName: string }): { subject: string; text: string; html: string } {
  const subject = `We stopped a re-upload of ${details.gameTitle}`;
  const first = `We stopped a re-upload of ${details.gameTitle} by ${details.uploaderName}. Most of its files were uploaded to Zaisma as their own game; a person at Zaisma checked it, and it never reached players.`;
  const second = `Nothing to do, ${details.username}. If ${details.uploaderName} has your permission, message Zaisma at zaisma.com/forum and we'll put it back.`;
  return {
    subject,
    text: `${first}\n\n${second}\n\nZaisma, ${env.SITE_ORIGIN.replace(/^https?:\/\//, "")}\n`,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:32px 16px;background:#0b0d10;color:#eceef0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px">
<tr><td style="padding:0 0 28px"><img src="${esc(env.SITE_ORIGIN)}/zaisma-wordmark-white-2400.png" width="112" alt="Zaisma" style="display:block;width:112px;height:auto;border:0"></td></tr>
<tr><td style="font-size:16px;line-height:1.5;color:#c6c9ce;padding:0 0 16px">${esc(first)}</td></tr>
<tr><td style="font-size:14px;line-height:1.5;color:#969ba4">${esc(second)}</td></tr>
</table></td></tr></table>
</body></html>`,
  };
}

/**
 * A security alert's email (docs/DECISIONS.md, "The security log says who did what from where, and the owner hears
 * about the risky moments"): what happened, when and from where (left out when the account doesn't keep where it's
 * used from), anything more Zaisma knows (where a turned-off key was found), and what to do if it wasn't them.
 */
export function securityAlertEmail(
  env: Env,
  details: { username: string; title: string; subject: string; ifNotYou: string; isByZaisma: boolean; isAboutKeys: boolean; happenedAtMs: number; whereText: string; detailText?: string },
): { subject: string; text: string; html: string } {
  const site = env.SITE_ORIGIN.replace(/^https?:\/\//, "");
  const first = `${details.title}, on your Zaisma account ${details.username}, ${waitEndsText(details.happenedAtMs)}${details.whereText ? ` (${details.whereText})` : ""}.`;
  const link = details.isAboutKeys ? `${site}/account#developer` : `${site}/account?not-you#signing-in`;
  const what = details.isByZaisma
    ? `To keep going, ${details.ifNotYou}: ${link}`
    : `Was this you? Then there's nothing to do. If it wasn't, ${details.ifNotYou} at ${link}${details.isAboutKeys ? "" : ". A new password signs out every other device"}.`;
  const paragraphs = [first, ...(details.detailText ? [details.detailText] : []), what];
  return {
    subject: details.subject,
    text: `${paragraphs.join("\n\n")}\n\nZaisma, ${site}\n`,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><title>${esc(details.subject)}</title></head>
<body style="margin:0;padding:32px 16px;background:#0b0d10;color:#eceef0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px">
<tr><td style="padding:0 0 28px"><img src="${esc(env.SITE_ORIGIN)}/zaisma-wordmark-white-2400.png" width="112" alt="Zaisma" style="display:block;width:112px;height:auto;border:0"></td></tr>
${paragraphs
  .slice(0, -1)
  .map((paragraph) => `<tr><td style="font-size:16px;line-height:1.5;color:#c6c9ce;padding:0 0 16px">${esc(paragraph)}</td></tr>`)
  .join("\n")}
<tr><td style="font-size:14px;line-height:1.5;color:#969ba4">${esc(what)}</td></tr>
</table></td></tr></table>
</body></html>`,
  };
}

/** A time as the page and the email say it: Oct 19 at 2:05 PM UTC. (The account page has no local-time script, and an email can't run one.) */
export function waitEndsText(ms: number): string {
  return `${new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).replace(", ", " at ")} UTC`;
}

/** The hosting emails a developer gets (hosting-job.ts, stripe-events.ts): a game's meter, and their credit. */
export const HOSTING_EMAIL_KINDS = ["hosting_nearly_paused", "hosting_budget_nearly_used", "hosting_paused", "credit_low", "credit_used_up", "automatic_top_up_made", "automatic_top_up_failed"] as const;
export type HostingEmailKind = (typeof HOSTING_EMAIL_KINDS)[number];

/** What a hosting email says: the game and month for a game's, amounts in cents for credit's. */
export interface HostingEmailDetails {
  gameTitle?: string;
  /** "October" */
  monthName?: string;
  /** "Nov 1" */
  resetsOnText?: string;
  pausedReason?: "free_used" | "budget_used" | "credit_used";
  spentCents?: number;
  budgetCents?: number;
  balanceCents?: number;
  topUpCents?: number;
  /** What's left of the month's automatic top-up limit. */
  leftThisMonthCents?: number;
  monthlyLimitCents?: number;
  /** Stripe's own words for a declined card. */
  failureText?: string;
}

/** Cents as dollars, like $3.40 or $20. */
export const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** A hosting email: a game's meter reaching a line, or the developer's credit. Plain words, the next step last. */
export function hostingEmail(env: Env, kind: HostingEmailKind, details: HostingEmailDetails): { subject: string; text: string; html: string } {
  const site = env.SITE_ORIGIN.replace(/^https?:\/\//, "");
  const settings = `${site}/developer/settings#credit`;
  const game = details.gameTitle ?? "Your game";
  const [subject, first, second]: [string, string, string] = (() => {
    switch (kind) {
      case "hosting_nearly_paused":
        return [`${game} has used most of its free hosting`, `${game} has used 80% of its free hosting this month. When it's all used, no new matches start until ${details.resetsOnText}, and running ones get an hour to finish.`, `To keep it going, add credit and give ${game} a monthly budget at ${settings}.`];
      case "hosting_budget_nearly_used":
        return [`${game} has used most of its budget`, `${game} has used ${dollars(details.spentCents ?? 0)} of its ${dollars(details.budgetCents ?? 0)} budget for ${details.monthName}. When it's all used, the game pauses like at the end of its free hosting.`, `To keep it going, raise its budget at ${settings}.`];
      case "hosting_paused": {
        const why = details.pausedReason === "budget_used" ? `it used its ${dollars(details.budgetCents ?? 0)} budget for ${details.monthName}` : details.pausedReason === "credit_used" ? "your credit ran out" : "it used its free hosting this month";
        const next =
          details.pausedReason === "budget_used" ? `Raise its budget at ${settings} to start it again now.` : details.pausedReason === "credit_used" ? `Add credit at ${settings} to start it again now.` : `It starts again on ${details.resetsOnText}, or now if you add credit and give it a budget at ${settings}.`;
        return [`${game}'s hosting is paused`, `${game}'s hosting is paused: ${why}. No new matches start, and running ones get an hour to finish.`, next];
      }
      case "credit_low":
        return ["Your Zaisma credit is low", `You have ${dollars(details.balanceCents ?? 0)} of hosting credit left. When it's used, your games with a budget pause until you add more.`, `Add credit, or turn on automatic top-up, at ${settings}.`];
      case "credit_used_up":
        return ["Your Zaisma credit is used up", "Your hosting credit is used up, so your games with a budget have paused. Running matches get an hour to finish.", `Add credit at ${settings} to start them again.`];
      case "automatic_top_up_made":
        return [`Zaisma added ${dollars(details.topUpCents ?? 0)} of credit`, `Zaisma added ${dollars(details.topUpCents ?? 0)} of credit. ${dollars(details.leftThisMonthCents ?? 0)} of your ${dollars(details.monthlyLimitCents ?? 0)} for ${details.monthName} is left.`, `Change or turn off automatic top-up at ${settings}.`];
      case "automatic_top_up_failed":
        return ["Your automatic top-up didn't go through", `Your card didn't take the automatic top-up${details.failureText ? `: ${details.failureText}` : "."} Automatic top-up is off now.`, `Add credit, or turn automatic top-up on again with another card, at ${settings}.`];
    }
  })();
  return {
    subject,
    text: `${first}\n\n${second}\n\nZaisma, ${site}\n`,
    html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:32px 16px;background:#0b0d10;color:#eceef0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px">
<tr><td style="padding:0 0 28px"><img src="${esc(env.SITE_ORIGIN)}/zaisma-wordmark-white-2400.png" width="112" alt="Zaisma" style="display:block;width:112px;height:auto;border:0"></td></tr>
<tr><td style="font-size:16px;line-height:1.5;color:#c6c9ce;padding:0 0 16px">${esc(first)}</td></tr>
<tr><td style="font-size:14px;line-height:1.5;color:#969ba4">${esc(second)}</td></tr>
</table></td></tr></table>
</body></html>`,
  };
}
