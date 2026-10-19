import type { Env } from "./env.ts";

/** Pushover's priorities that Zaisma uses: normal, high (past quiet hours) and emergency (repeats until Julius taps it). */
export type PushPriorityNumber = 0 | 1 | 2;

/**
 * A push to Julius's phone through Pushover ("Julius hears within minutes when something is down", docs/DECISIONS.md in
 * the ops repo). The outside checker (scripts/watch.mjs) calls the same API from GitHub's runners. Never throws: an
 * alert must not break the job it's about. With no keys it logs, like sendAlert.
 */
export async function sendPush(env: Env, push: { title: string; message: string; priorityNumber: PushPriorityNumber }): Promise<void> {
  if (!env.PUSHOVER_USER_KEY || !env.PUSHOVER_APP_TOKEN) {
    console.log(`[push] ${push.title}`);
    return;
  }
  const form = new URLSearchParams({ token: env.PUSHOVER_APP_TOKEN, user: env.PUSHOVER_USER_KEY, title: push.title, message: push.message, priority: String(push.priorityNumber) });
  // An emergency push asks again every minute for an hour, or until it's tapped.
  if (push.priorityNumber === 2) {
    form.set("retry", "60");
    form.set("expire", "3600");
  }
  try {
    const response = await fetch(env.PUSHOVER_URL ?? "https://api.pushover.net/1/messages.json", { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) console.error("push failed", response.status);
  } catch (error) {
    console.error("push failed", error);
  }
}
