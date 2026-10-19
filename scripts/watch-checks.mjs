// What the checker outside Cloudflare does every 5 minutes (.github/workflows/watch.yml runs scripts/watch.mjs).
// Plain JavaScript like scripts/ship-checks.mjs, so a test can import it with fetch stubbed.
//
// "Julius hears within minutes when something is down" in docs/DECISIONS.md (the ops repo): it tries a game page, a
// game's files, rooms, the MCP and sign-in; a check that fails twice in a row pushes Julius an alert, and one message
// when it's back. Zaisma's own half-broken alerts (scans behind, errors spiking, this checker silent) are the site
// Worker's (apps/site/src/health-alerts.ts).

import { CHECK_GAME_SLUG, CHECK_GAME_URL, ROOMS_URL, SITE_URL, checkUrl } from "./ship-checks.mjs";

export const WATCH_RETRY_WAIT_MS = 10_000;
/** A check tries twice, 10 seconds apart, before it counts as failed for this run. */
export const WATCH_ATTEMPT_COUNT = 2;
/** Down means failed in this many runs in a row. */
export const WATCH_FAILED_RUN_COUNT = 2;
/** Still down: Julius hears again this often, never every 5 minutes. */
export const WATCH_REMINDER_INTERVAL_MIN = 120;
export const PUSHOVER_URL = "https://api.pushover.net/1/messages.json";

const MCP_INITIALIZE = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "zaisma-watch", version: "1" } } });
// An address no account has: sign-in looks it up in Supabase first, then Cloudflare's bot check stops a script with a 400.
// So a 400 proves Supabase answered; Supabase failing is a 502.
const SIGN_IN_BODY = new URLSearchParams({ username: "watch@zaisma-watch.invalid", password: "not-a-real-password-1" });

const ok = (isGood) => (response, body) => (isGood(response, body) ? [] : ["unexpected answer"]);
const options = { attemptCount: WATCH_ATTEMPT_COUNT, retryWaitMs: WATCH_RETRY_WAIT_MS };

/** The five checks, each answering { name, isPass, isSecurity, note }. */
export function runWatchChecks() {
  return Promise.all([
    checkUrl("game page", `${SITE_URL}/g/${CHECK_GAME_SLUG}`, {}, ok((response, body) => response.status === 200 && body.includes("<iframe")), options),
    checkUrl("game files", CHECK_GAME_URL, {}, ok((response) => response.status === 200), options),
    checkUrl("rooms", `${ROOMS_URL}/.well-known/jwks.json`, {}, ok((response, body) => response.status === 200 && body.includes('"keys"')), options),
    checkUrl(
      "MCP",
      `${SITE_URL}/mcp`,
      { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: MCP_INITIALIZE },
      ok((response, body) => response.status === 401 && body.includes('"no_key"')),
      options,
    ),
    checkUrl("sign-in", `${SITE_URL}/signin`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: SIGN_IN_BODY }, ok((response) => response.status === 400), options),
  ]);
}

export const emptyWatchState = () => ({ failedRunCount: 0, failingSinceMs: 0, lastToldAtMs: 0 });

const minutesText = (durationMs) => {
  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} hours`;
};

/**
 * One run's step. `state` is what the last run left, `failedNotes` the notes of this run's failed checks ([] when all
 * passed). Answers the state to keep and the push to send, or null:
 * - the second failed run in a row: down, as an emergency (priority 2: repeats until tapped);
 * - every 2 hours after that while it stays down: a reminder (priority 1);
 * - the first passing run after Julius was told: back up (priority 0), with how long it was down.
 */
export function nextWatchStep(state, failedNotes, nowMs) {
  if (!failedNotes.length) {
    const wasTold = state.failedRunCount >= WATCH_FAILED_RUN_COUNT;
    return { state: emptyWatchState(), push: wasTold ? { title: "Zaisma is back up", message: `Every check passes again. It was down ${minutesText(nowMs - state.failingSinceMs)}.`, priority: 0 } : null };
  }
  const failedRunCount = state.failedRunCount + 1;
  const failingSinceMs = state.failedRunCount ? state.failingSinceMs : nowMs;
  const message = failedNotes.join("; ");
  if (failedRunCount === WATCH_FAILED_RUN_COUNT) {
    return { state: { failedRunCount, failingSinceMs, lastToldAtMs: nowMs }, push: { title: "Zaisma is down", message: `Failing for ${WATCH_FAILED_RUN_COUNT} checks in a row: ${message}`, priority: 2 } };
  }
  if (failedRunCount > WATCH_FAILED_RUN_COUNT && nowMs - state.lastToldAtMs >= WATCH_REMINDER_INTERVAL_MIN * 60_000) {
    return { state: { failedRunCount, failingSinceMs, lastToldAtMs: nowMs }, push: { title: "Still down", message: `Down for ${minutesText(nowMs - failingSinceMs)}: ${message}`, priority: 1 } };
  }
  return { state: { failedRunCount, failingSinceMs, lastToldAtMs: state.lastToldAtMs }, push: null };
}

/** Pushover: an emergency push (priority 2) asks again every minute for an hour or until tapped. Throws when Pushover refuses. */
export async function sendPushover({ userKey, appToken }, push, url = PUSHOVER_URL) {
  const form = new URLSearchParams({ token: appToken, user: userKey, title: push.title, message: push.message, priority: String(push.priority) });
  if (push.priority === 2) {
    form.set("retry", "60");
    form.set("expire", "3600");
  }
  const response = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Pushover answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
}
