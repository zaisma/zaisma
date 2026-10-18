import type { Env } from "./env.ts";
import { pageScript } from "./page-scripts.ts";

/**
 * Cloudflare's invisible check (Turnstile): a real browser, not a script. It runs as the page opens and
 * never shows a puzzle; its answer is a one-use token the page sends along. Play uses it to count plays
 * (plays.ts), making an account uses it to stop mass sign-ups, and passwords from new devices and asking
 * for email codes use it to stop scripts guessing and sending (account.ts).
 */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** What Cloudflare's siteverify answers about a Turnstile token, in its own words. */
interface TurnstileAnswer {
  success?: boolean;
  action?: string;
  hostname?: string;
}

/** What the check was run for, as the page told the widget: a play, making an account, a password from a device the account hasn't seen, or asking for an email code. */
export type TurnstileAction = "play" | "join" | "sign_in" | "email_code";

/** Whether Cloudflare says a real browser on our own pages got this token for this action. Each token works once. */
export async function isRealBrowser(env: Env, token: unknown, action: TurnstileAction): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const response = await fetch(env.TURNSTILE_SITEVERIFY_URL || SITEVERIFY, { method: "POST", body: new URLSearchParams({ secret, response: token }) });
    const answer = (await response.json()) as TurnstileAnswer;
    if (answer.success !== true) return false;
    // Cloudflare's test keys (the preview) answer without the action or our hostname.
    if (secret.startsWith("1x0000000000000000000000000000000")) return true;
    return answer.action === action && answer.hostname === new URL(env.SITE_ORIGIN).hostname;
  } catch {
    return false;
  }
}

/**
 * The browser side for forms: each box with data-bot-check (its action) and data-site-key runs the check
 * as the page opens and puts its answer in its form's hidden `turnstile_token` field. Pressing the button
 * before the answer is in waits for it (up to 15 seconds), then sends the form either way; the server says
 * so if the check didn't pass.
 */
export const BOT_CHECK_SCRIPT = pageScript("bot-check", `(() => {
  const checks = [...document.querySelectorAll("[data-bot-check]")].map((box) => {
    const form = box.closest("form"), field = form.querySelector('input[name="turnstile_token"]');
    let waiting = null, broken = false;
    const settle = () => { const send = waiting; waiting = null; if (send) send(); };
    const answered = (token) => { field.value = token || ""; settle(); };
    const giveUp = () => { broken = true; settle(); };
    const go = () => {
      try {
        turnstile.render(box, { sitekey: box.dataset.siteKey, action: box.dataset.botCheck, appearance: "interaction-only", "refresh-expired": "auto", callback: answered, "expired-callback": () => (field.value = ""), "error-callback": giveUp, "timeout-callback": giveUp });
      } catch { broken = true; }
    };
    form.addEventListener("submit", (event) => {
      if (field.value || broken) return;
      event.preventDefault();
      if (waiting) return;
      const submitter = event.submitter;
      const timer = setTimeout(giveUp, 15000);
      waiting = () => { clearTimeout(timer); form.requestSubmit(submitter); };
    });
    return { go, giveUp };
  });
  if (!checks.length) return;
  if (window.turnstile) checks.forEach((check) => check.go());
  else {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => checks.forEach((check) => check.go());
    script.onerror = () => checks.forEach((check) => check.giveUp());
    document.head.appendChild(script);
  }
})();`);
