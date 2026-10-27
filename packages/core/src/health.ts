/**
 * "Julius hears within minutes when something is down" (docs/DECISIONS.md in the ops repo): what counts as half-broken,
 * and when Julius is told. The outside checker (scripts/watch.mjs) covers down; the site Worker's cron
 * (apps/site/src/health-alerts.ts) covers these three.
 */

export const HEALTH_ALERT_KINDS = ["scans_behind", "errors_spiking", "watcher_silent", "refunds_stuck"] as const;
export type HealthAlertKind = (typeof HEALTH_ALERT_KINDS)[number];

export const HEALTH_ALERT_LIMITS = {
  /** A scan normally takes under a minute. */
  maximumScanWaitDurationMin: 10,
  /** More than this share of a window's requests failing is a spike, but only with minimumRequestCount requests behind it. */
  maximumErrorRatePct: 5,
  minimumRequestCount: 20,
  errorWindowDurationMin: 5,
  /** Cloudflare's analytics lag a minute or two, so the window ends this long ago. */
  analyticsLagDurationMin: 2,
  /** Still broken: Julius hears again this often, never every 5 minutes. */
  reminderIntervalMin: 120,
  /** The outside checker runs every 5 minutes; GitHub often runs a schedule late. */
  maximumWatcherSilenceDurationMin: 45,
  /** A deleted account's refund is retried hourly; past this, Julius hears it's stuck. */
  maximumPendingRefundDurationDays: 30,
} as const;

export const HEALTH_ALERT_WORDS: Record<HealthAlertKind, { title: string; clearedTitle: string }> = {
  scans_behind: { title: "Scans are behind", clearedTitle: "Scans caught up" },
  errors_spiking: { title: "Errors are spiking", clearedTitle: "Errors are back to normal" },
  watcher_silent: { title: "The outside checker has gone quiet", clearedTitle: "The outside checker is running again" },
  refunds_stuck: { title: "A deleted account's refund is stuck", clearedTitle: "Stuck refunds went through" },
};

export type HealthAlertState = { startedAtMs: number; lastToldAtMs: number };
export type HealthAlertAction = "none" | "start" | "remind" | "clear";

/** What to do about a condition: `state` is its row (null when none), `isBad` whether it holds now. */
export function nextHealthAlertAction(state: HealthAlertState | null, isBad: boolean, nowMs: number): HealthAlertAction {
  if (!state) return isBad ? "start" : "none";
  if (!isBad) return "clear";
  return nowMs - state.lastToldAtMs >= HEALTH_ALERT_LIMITS.reminderIntervalMin * 60_000 ? "remind" : "none";
}

/** Errors over the share and enough requests that a quiet night's one error can't alert. */
export function isErrorSpike(requestCount: number, errorCount: number): boolean {
  return requestCount >= HEALTH_ALERT_LIMITS.minimumRequestCount && (errorCount / requestCount) * 100 > HEALTH_ALERT_LIMITS.maximumErrorRatePct;
}
