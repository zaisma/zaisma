import { HEALTH_ALERT_KINDS, HEALTH_ALERT_LIMITS, HEALTH_ALERT_WORDS, isErrorSpike, nextHealthAlertAction, type HealthAlertKind, type HealthAlertState } from "@zaisma/core";
import type { Env } from "./env.ts";
import { sendPush, type PushPriorityNumber } from "./push.ts";

/**
 * Half-broken, not down ("Julius hears within minutes when something is down", docs/DECISIONS.md in the ops repo): scans
 * falling behind, errors spiking, the outside checker (scripts/watch.mjs, run by .github/workflows/watch.yml) gone
 * silent, and a deleted account's refund Stripe still hasn't taken after 30 days (credit-api.ts, retryPendingRefunds). Runs on the site's 5-minute cron. Julius is pushed once when a condition starts, again every 2 hours while it
 * holds, and once when it ends; `health_alerts` holds a row while one holds. Down itself is the outside checker's: it
 * can't depend on the thing that's down.
 */

const MINUTE_MS = 60_000;
const SCRIPT_NAMES = ["zaisma-site", "zaisma-rooms", "zaisma-games"] as const;
const DEFAULT_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const DEFAULT_WATCH_RUNS_URL = "https://api.github.com/repos/zaisma/zaisma/actions/workflows/watch.yml/runs?per_page=1&status=completed";
const PRIORITY_NUMBER: Record<HealthAlertKind, PushPriorityNumber> = { scans_behind: 0, errors_spiking: 0, watcher_silent: 1, refunds_stuck: 0 };

/** What a check found: whether the condition holds (null when it couldn't tell, which changes nothing) and a line saying what. */
type Finding = { isBad: boolean | null; detail: string };

export async function watchHealth(env: Env, nowMs = Date.now()): Promise<void> {
  const findings: Record<HealthAlertKind, Finding> = {
    scans_behind: await settled(() => scansBehind(env, nowMs)),
    errors_spiking: await settled(() => errorsSpiking(env, nowMs)),
    watcher_silent: await settled(() => watcherSilent(env, nowMs)),
    refunds_stuck: await settled(() => refundsStuck(env, nowMs)),
  };
  for (const kind of HEALTH_ALERT_KINDS) {
    const finding = findings[kind];
    if (finding.isBad === null) continue;
    try {
      await settle(env, kind, finding, nowMs);
    } catch (error) {
      console.error("health alert failed", kind, error);
    }
  }
}

async function settled(check: () => Promise<Finding>): Promise<Finding> {
  try {
    return await check();
  } catch (error) {
    console.error("health check failed", error);
    return { isBad: null, detail: "" };
  }
}

/** Tells Julius what the finding calls for. A row claim first, so two crons at once tell him once. */
async function settle(env: Env, kind: HealthAlertKind, finding: Finding, nowMs: number): Promise<void> {
  const row = await env.DB.prepare("SELECT started_at_ms, last_told_at_ms FROM health_alerts WHERE health_alert_kind = ?").bind(kind).first<{ started_at_ms: number; last_told_at_ms: number }>();
  const state: HealthAlertState | null = row ? { startedAtMs: row.started_at_ms, lastToldAtMs: row.last_told_at_ms } : null;
  const action = nextHealthAlertAction(state, finding.isBad === true, nowMs);
  const words = HEALTH_ALERT_WORDS[kind];
  if (action === "start") {
    const claimed = await env.DB.prepare("INSERT OR IGNORE INTO health_alerts (health_alert_kind, started_at_ms, last_told_at_ms) VALUES (?, ?, ?)").bind(kind, nowMs, nowMs).run();
    if (claimed.meta.changes) await sendPush(env, { title: words.title, message: finding.detail, priorityNumber: PRIORITY_NUMBER[kind] });
  } else if (action === "remind" && state) {
    const claimed = await env.DB.prepare("UPDATE health_alerts SET last_told_at_ms = ? WHERE health_alert_kind = ? AND last_told_at_ms = ?").bind(nowMs, kind, state.lastToldAtMs).run();
    if (claimed.meta.changes) await sendPush(env, { title: `Still: ${words.title}`, message: `${finding.detail} It began ${durationText(nowMs - state.startedAtMs)} ago.`, priorityNumber: PRIORITY_NUMBER[kind] });
  } else if (action === "clear" && state) {
    const claimed = await env.DB.prepare("DELETE FROM health_alerts WHERE health_alert_kind = ?").bind(kind).run();
    if (claimed.meta.changes) await sendPush(env, { title: words.clearedTitle, message: `It lasted ${durationText(nowMs - state.startedAtMs)}.`, priorityNumber: 0 });
  }
}

function durationText(durationMs: number): string {
  const durationMin = Math.max(1, Math.round(durationMs / MINUTE_MS));
  return durationMin < 120 ? `${durationMin} min` : `${Math.round(durationMin / 60)} hours`;
}

/** Versions still scanning long after they were queued; scans normally take under a minute. */
async function scansBehind(env: Env, nowMs: number): Promise<Finding> {
  const waitingSinceMs = nowMs - HEALTH_ALERT_LIMITS.maximumScanWaitDurationMin * MINUTE_MS;
  const found = await env.DB.prepare("SELECT COUNT(*) AS version_count, MIN(COALESCE(scan_queued_at_ms, created_at_ms)) AS oldest_queued_at_ms FROM versions WHERE scan_status = 'scanning' AND COALESCE(scan_queued_at_ms, created_at_ms) < ?")
    .bind(waitingSinceMs)
    .first<{ version_count: number; oldest_queued_at_ms: number | null }>();
  const versionCount = found?.version_count ?? 0;
  if (!versionCount || found?.oldest_queued_at_ms == null) return { isBad: false, detail: "" };
  return { isBad: true, detail: `${versionCount} ${versionCount === 1 ? "version has" : "versions have"} been waiting to be scanned, the oldest for ${durationText(nowMs - found.oldest_queued_at_ms)}. Scans usually take under a minute.` };
}

/** Cloudflare's own count of each Worker's requests and the ones that threw, over the last few minutes. Off without its token. */
async function errorsSpiking(env: Env, nowMs: number): Promise<Finding> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.ANALYTICS_API_TOKEN) return { isBad: null, detail: "" };
  const endMs = nowMs - HEALTH_ALERT_LIMITS.analyticsLagDurationMin * MINUTE_MS;
  const startMs = endMs - HEALTH_ALERT_LIMITS.errorWindowDurationMin * MINUTE_MS;
  const counts = await Promise.all(SCRIPT_NAMES.map((scriptName) => workerCounts(env, scriptName, new Date(startMs).toISOString(), new Date(endMs).toISOString())));
  const spiking = SCRIPT_NAMES.flatMap((scriptName, index) => (isErrorSpike(counts[index]!.requestCount, counts[index]!.errorCount) ? [{ scriptName, ...counts[index]! }] : []));
  if (!spiking.length) return { isBad: false, detail: "" };
  const lines = spiking.map(({ scriptName, requestCount, errorCount }) => `${scriptName}: ${errorCount} of ${requestCount} requests failed (${Math.round((errorCount / requestCount) * 100)}%)`);
  return { isBad: true, detail: `In the last ${HEALTH_ALERT_LIMITS.errorWindowDurationMin} minutes, ${lines.join("; ")}.` };
}

async function workerCounts(env: Env, scriptName: string, startIso: string, endIso: string): Promise<{ requestCount: number; errorCount: number }> {
  const query = `query ($accountTag: String!, $scriptName: String!, $start: Time!, $end: Time!) { viewer { accounts(filter: { accountTag: $accountTag }) { workersInvocationsAdaptive(limit: 1, filter: { scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end }) { sum { requests errors } } } } }`;
  const response = await fetch(env.CLOUDFLARE_GRAPHQL_URL ?? DEFAULT_GRAPHQL_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${env.ANALYTICS_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { accountTag: env.CLOUDFLARE_ACCOUNT_ID, scriptName, start: startIso, end: endIso } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`analytics answered ${response.status}`);
  // GraphQL's answer: { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests, errors } }] }] } }, errors }.
  const answer = (await response.json()) as Record<string, unknown>;
  if (answer["errors"] || !answer["data"]) throw new Error("analytics answered with errors");
  const sum = followPath(answer, ["data", "viewer", "accounts", 0, "workersInvocationsAdaptive", 0, "sum"]) as Record<string, number> | undefined;
  return { requestCount: sum?.["requests"] ?? 0, errorCount: sum?.["errors"] ?? 0 };
}

/** The outside checker's newest finished run, from GitHub's public list; asked every 15 minutes, since a run is every 5 and GitHub limits unsigned calls. */
async function watcherSilent(env: Env, nowMs: number): Promise<Finding> {
  if (new Date(nowMs).getUTCMinutes() % 15 >= 5) return { isBad: null, detail: "" };
  const response = await fetch(env.WATCH_RUNS_URL ?? DEFAULT_WATCH_RUNS_URL, { headers: { accept: "application/vnd.github+json", "user-agent": "zaisma-site" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return { isBad: null, detail: "" };
  const answer = (await response.json()) as { workflow_runs?: { updated_at?: string }[] };
  const updatedAtMs = Date.parse(answer.workflow_runs?.[0]?.updated_at ?? "");
  // No run yet, as in the first minutes after this ships: GitHub hasn't started its schedule, so there's nothing to call silent.
  if (Number.isNaN(updatedAtMs)) return { isBad: null, detail: "" };
  const silentMs = nowMs - updatedAtMs;
  return silentMs > HEALTH_ALERT_LIMITS.maximumWatcherSilenceDurationMin * MINUTE_MS
    ? { isBad: true, detail: `The checker outside Cloudflare last finished ${durationText(silentMs)} ago. Down alerts are off until it runs again (GitHub Actions, .github/workflows/watch.yml).` }
    : { isBad: false, detail: "" };
}

/** Refunds a deleted account was owed that Stripe hasn't taken for HEALTH_ALERT_LIMITS.maximumPendingRefundDurationDays: they need a person. */
async function refundsStuck(env: Env, nowMs: number): Promise<Finding> {
  const found = await env.DB.prepare("SELECT COUNT(*) AS refund_count, COALESCE(SUM(amount_cents), 0) AS amount_cents FROM pending_refunds WHERE created_at_ms < ?")
    .bind(nowMs - HEALTH_ALERT_LIMITS.maximumPendingRefundDurationDays * 86_400_000)
    .first<{ refund_count: number; amount_cents: number }>();
  const refundCount = found?.refund_count ?? 0;
  if (!refundCount) return { isBad: false, detail: "" };
  return { isBad: true, detail: `${refundCount} ${refundCount === 1 ? "refund" : "refunds"} of deleted accounts' credit ($${(found!.amount_cents / 100).toFixed(2)} in all) has failed at Stripe for over ${HEALTH_ALERT_LIMITS.maximumPendingRefundDurationDays} days: pending_refunds has the payment intents.` };
}

/** The value at a path through objects and arrays, or undefined where the answer doesn't go that far. */
function followPath(start: unknown, path: (string | number)[]): unknown {
  let found = start;
  for (const step of path) {
    if (found === null || typeof found !== "object") return undefined;
    found = (found as Record<string | number, unknown>)[step];
  }
  return found;
}
