import type { Env } from "./env.ts";

/**
 * Cloudflare's invisible check (Turnstile): a real browser, not a script. It runs as the page opens and
 * never shows a puzzle; its answer is a one-use token the page sends along. Play uses it to count plays
 * (plays.ts), and making an account uses it to stop mass sign-ups (account.ts).
 */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** What Cloudflare's siteverify answers about a Turnstile token, in its own words. */
interface TurnstileAnswer {
  success?: boolean;
  action?: string;
  hostname?: string;
}

/** What the check was run for, as the page told the widget. */
export type TurnstileAction = "play" | "join";

/** Whether Cloudflare says a real browser on our own pages got this token for this action. Each token works once. */
export async function isRealBrowser(env: Env, token: unknown, action: TurnstileAction): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const response = await fetch(SITEVERIFY, { method: "POST", body: new URLSearchParams({ secret, response: token }) });
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
 * The browser side for a form: runs the check as the page opens and puts its answer in the form's hidden
 * `turnstile_token` field. Pressing the button before the answer is in waits for it (up to 15 seconds),
 * then sends the form either way; the server says so if the check didn't pass.
 */
export function turnstileFormScript(siteKey: string, action: TurnstileAction, formId: string, boxId: string): string {
  return `(() => {
  const SITE_KEY = ${JSON.stringify(siteKey)}, form = document.getElementById(${JSON.stringify(formId)}), box = document.getElementById(${JSON.stringify(boxId)});
  const field = form.querySelector('input[name="turnstile_token"]');
  let waiting = null, broken = false;
  const settle = () => { const send = waiting; waiting = null; if (send) send(); };
  const answered = (token) => { field.value = token || ""; settle(); };
  const giveUp = () => { broken = true; settle(); };
  const go = () => {
    try {
      turnstile.render(box, { sitekey: SITE_KEY, action: ${JSON.stringify(action)}, appearance: "interaction-only", "refresh-expired": "auto", callback: answered, "expired-callback": () => (field.value = ""), "error-callback": giveUp, "timeout-callback": giveUp });
    } catch { broken = true; }
  };
  if (window.turnstile) go();
  else {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = go;
    script.onerror = giveUp;
    document.head.appendChild(script);
  }
  form.addEventListener("submit", (event) => {
    if (field.value || broken) return;
    event.preventDefault();
    if (waiting) return;
    const submitter = event.submitter;
    const timer = setTimeout(giveUp, 15000);
    waiting = () => { clearTimeout(timer); form.requestSubmit(submitter); };
  });
})();`;
}
