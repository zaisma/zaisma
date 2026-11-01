// What the checker outside Cloudflare does every 5 minutes (.github/workflows/watch.yml runs scripts/watch.mjs).
// Plain JavaScript like scripts/ship-checks.mjs, so a test can import it with fetch stubbed.
//
// "Julius hears within minutes when something is down" in docs/DECISIONS.md (the ops repo): it tries a game page, a
// game's files, rooms, the MCP and sign-in; a check that fails twice in a row pushes Julius an alert, and one message
// when it's back. Zaisma's own half-broken alerts (scans behind, errors spiking, this checker silent) are the site
// Worker's (apps/site/src/health-alerts.ts).

import { CHECK_GAME_SLUG, CHECK_GAME_URL, ROOMS_URL, SITE_URL, checkUrl, publishedKeyCount } from "./ship-checks.mjs";

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

/** The six checks, each answering { name, isPass, isSecurity, note }. */
export function runWatchChecks() {
  return Promise.all([
    checkUrl("game page", `${SITE_URL}/g/${CHECK_GAME_SLUG}`, {}, ok((response, body) => response.status === 200 && body.includes("<iframe")), options),
    checkUrl("game files", CHECK_GAME_URL, {}, ok((response) => response.status === 200), { ...options, isSameOriginRedirectFollowed: true }),
    checkUrl("rooms", `${ROOMS_URL}/.well-known/jwks.json`, {}, ok((response, body) => response.status === 200 && publishedKeyCount(body) >= 1), options),
    checkUrl("receipt keys", `${ROOMS_URL}/.well-known/receipt-jwks.json`, {}, ok((response, body) => response.status === 200 && publishedKeyCount(body) >= 1), options),
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

// The Cloudflare account, watched from outside Cloudflare ("Zaisma's own accounts are watched" in docs/DECISIONS.md, the
// ops repo): a new member or API token pushes Julius at once, with who made it and from where when the audit log says.
// The site Worker emails the same items (apps/site/src/account-watch.ts); a Cloudflare taken over can stop that email,
// not this push. A removed item pushes nothing.

export const CLOUDFLARE_API_URL = "https://api.cloudflare.com/client/v4";
/** Pushes one by one in a run; the rest go in one more push. */
export const CLOUDFLARE_WATCH_MAXIMUM_PUSH_COUNT = 10;
const CLOUDFLARE_WATCH_MAXIMUM_PAGE_COUNT = 20;
const CLOUDFLARE_AUDIT_LOG_MAXIMUM_PAGE_COUNT = 5;
/** The audit log is read from the last run less this, so an item made just before it is still found. */
const CLOUDFLARE_AUDIT_LOG_OVERLAP_MS = 10 * 60_000;
export const CLOUDFLARE_WATCH_STARTED_OVER_PUSH = { title: "The Cloudflare watch started over", message: "Its saved state was gone (GitHub drops a cache it hasn't used in a week): tokens and members made in the last hour weren't compared.", priority: 0 };

const CLOUDFLARE_WATCH_KINDS = [
  { itemKind: "member", path: (accountId) => `/accounts/${accountId}/members`, listWords: "members", itemWords: "a new member of Zaisma's Cloudflare account", listPageUrl: (accountId) => `https://dash.cloudflare.com/${accountId}/members` },
  { itemKind: "account_token", path: (accountId) => `/accounts/${accountId}/tokens`, listWords: "account API tokens", itemWords: "a new API token on Zaisma's Cloudflare account", listPageUrl: (accountId) => `https://dash.cloudflare.com/${accountId}/api-tokens` },
  { itemKind: "user_token", path: () => "/user/tokens", listWords: "user API tokens", itemWords: "a new API token on Julius's Cloudflare profile", listPageUrl: () => "https://dash.cloudflare.com/profile/api-tokens" },
];

const cloudflareItem = (itemKind, row) => {
  const createdAtMs = Date.parse(row.issued_on ?? "");
  const itemLabel = itemKind === "member" ? `${row.user?.email ?? ""} (${row.status ?? "member"})` : String(row.name ?? "");
  return { itemId: String(row.id ?? ""), itemLabel, createdAtMs: Number.isNaN(createdAtMs) ? null : createdAtMs };
};

/**
 * One run of the Cloudflare watch. `state.cloudflareItemIds` holds each kind's item ids from the last good read; a kind
 * missing from it is read for the first time, which is the baseline and pushes nothing. Answers the ids to keep, when
 * this check ran (the next run's audit log starts there), the pushes to send, and a note per list that couldn't be read
 * (they join the checker's failed notes; that list keeps its old ids).
 */
export async function checkCloudflareAccount(state, { accountId, token }, nowMs, fetchImpl = fetch) {
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  const readJson = async (url) => {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });
    // Only the status, never the body: a note is pushed and logged.
    if (!response.ok) throw new Error(`answered ${response.status}`);
    const body = await response.json();
    if (body?.success === false) throw new Error("answered with errors");
    return body;
  };
  const knownItemIds = state.cloudflareItemIds ?? {};
  const cloudflareItemIds = { ...knownItemIds };
  const failedNotes = [];
  const newItems = [];
  for (const kind of CLOUDFLARE_WATCH_KINDS) {
    const rows = [];
    try {
      for (let pageNumber = 1; pageNumber <= CLOUDFLARE_WATCH_MAXIMUM_PAGE_COUNT; pageNumber++) {
        const body = await readJson(`${CLOUDFLARE_API_URL}${kind.path(accountId)}?per_page=50&page=${pageNumber}`);
        rows.push(...(Array.isArray(body?.result) ? body.result : []));
        if (!(pageNumber < Number(body?.result_info?.total_pages ?? 1))) break;
      }
    } catch (error) {
      failedNotes.push(`Cloudflare watch can't read ${kind.listWords}: ${error instanceof Error && error.message.startsWith("answered") ? error.message : "no answer"}`);
      continue;
    }
    const items = rows.map((row) => cloudflareItem(kind.itemKind, row));
    cloudflareItemIds[kind.itemKind] = items.map((item) => item.itemId);
    if (!knownItemIds[kind.itemKind]) continue;
    const known = new Set(knownItemIds[kind.itemKind]);
    newItems.push(...items.filter((item) => !known.has(item.itemId)).map((item) => ({ ...item, itemWords: kind.itemWords, listPageUrl: kind.listPageUrl(accountId) })));
  }
  const checkedAtMs = nowMs;
  if (!newItems.length) return { cloudflareItemIds, checkedAtMs, pushes: [], failedNotes };

  // Who made each one, from the audit log. Its answers come in two shapes, so an entry matches when it names the item's id anywhere.
  const sinceMs = Math.min(state.cloudflareCheckedAtMs ?? nowMs - 60 * 60_000, nowMs) - CLOUDFLARE_AUDIT_LOG_OVERLAP_MS;
  const auditEntries = [];
  try {
    let cursor = "";
    for (let pageNumber = 0; pageNumber < CLOUDFLARE_AUDIT_LOG_MAXIMUM_PAGE_COUNT; pageNumber++) {
      const query = new URLSearchParams({ since: new Date(sinceMs).toISOString(), before: new Date(nowMs).toISOString(), limit: "1000" });
      if (cursor) query.set("cursor", cursor);
      const body = await readJson(`${CLOUDFLARE_API_URL}/accounts/${accountId}/logs/audit?${query}`);
      auditEntries.push(...(Array.isArray(body?.result) ? body.result : []));
      cursor = body?.result_info?.cursor ?? "";
      if (!cursor) break;
    }
  } catch {
    // The push goes out without who made it.
  }
  const madeByText = (itemId) => {
    const entry = auditEntries.find((candidate) => JSON.stringify(candidate).includes(itemId));
    if (!entry) return " The audit log doesn't show who made it.";
    const email = entry.actor?.email ?? "someone";
    const address = entry.actor?.ip_address ?? entry.actor?.ip ?? entry.ip;
    return ` Made by ${email}${address ? ` from ${address}` : ""}.`;
  };
  const pushes = newItems.slice(0, CLOUDFLARE_WATCH_MAXIMUM_PUSH_COUNT).map((item) => {
    const madeText = item.createdAtMs === null ? "" : `, made ${new Date(item.createdAtMs).toISOString().replace("T", " ").slice(0, 16)} UTC`;
    const words = item.itemWords.charAt(0).toUpperCase() + item.itemWords.slice(1);
    return { title: `New on Cloudflare: ${item.itemLabel}`, message: `${words}: ${item.itemLabel}${madeText}.${madeByText(item.itemId)} If this wasn't you or Gleb, remove it now: ${item.listPageUrl}`, priority: 2 };
  });
  const restItems = newItems.slice(CLOUDFLARE_WATCH_MAXIMUM_PUSH_COUNT);
  if (restItems.length) {
    const listPageUrls = [...new Set(restItems.map((item) => item.listPageUrl))];
    pushes.push({ title: `${restItems.length} more new keys and members`, message: `${restItems.length} more new items on Cloudflare weren't sent one by one. If they weren't you or Gleb, look now: ${listPageUrls.join(" ")}`, priority: 2 });
  }
  return { cloudflareItemIds, checkedAtMs, pushes, failedNotes };
}
