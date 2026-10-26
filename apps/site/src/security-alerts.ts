import {
  ACROSS_ZAISMA_NETWORK_NUMBER,
  SECURITY_ALERT_WORDS,
  SECURITY_LOG_LIMITS,
  SECURITY_SIGNAL_KEPT_DURATION_DAYS,
  SPIKE_THRESHOLDS,
  SPIKE_WORDS,
  cleanBlockedScriptReport,
  describeSecurityEvent,
  iso,
  type Account,
  type SecurityAlertKind,
  type SecurityAlertStatus,
  type SpikeKind,
} from "@zaisma/core";
import { authUserEmail, connectionAddressOf, realEmail } from "./auth.ts";
import { sendAlert } from "./email.ts";
import { deliverEmail, securityAlertEmail } from "./email-codes.ts";
import type { Env } from "./env.ts";
import { html, raw, type Raw } from "./html.ts";
import { activityEventJson, eventTitle, keptWhere, whereText, type SecurityEventRow } from "./security-log.ts";
import { tellSecurityAlert } from "./webhooks.ts";

/**
 * Security alerts (docs/DECISIONS.md, "The security log says who did what from where, and the owner hears about
 * the risky moments"). security-log.ts raises one as it writes a risky event: an email to the account (and its old
 * address when the email changed or went), or, with none, the account page and dashboard until That was me; and a
 * security_alert event to the developer's webhooks. An account without an email is asked for one once it has
 * something to lose. Across Zaisma, spikes (many wrong passwords or new-device sign-ins from one network, many keys
 * made or databases exported at once, many scripts blocked) alert Julius and show in the admin MCP, beside
 * zaisma.com's script policy violation reports.
 *
 * Nothing here throws into the action it's about: that already happened.
 */

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

const KEY_ALERT_KINDS: readonly SecurityAlertKind[] = ["api_key_created", "api_key_new_place", "api_key_turned_off", "ai_connected", "connected_app_added", "connected_app_removed"];

/** Tells the owner about an event that's a security alert, and sets its security_alert_status: emailed, or unseen for the pages. */
export async function raiseSecurityAlert(env: Env, eventNumber: number, row: SecurityEventRow, nowMs = Date.now()): Promise<void> {
  try {
    const kind = row.kind as SecurityAlertKind;
    const account = await env.DB.prepare("SELECT username FROM accounts WHERE id = ?").bind(row.accountId).first<{ username: string }>();
    if (!account) return;
    const kept = keptWhere(row);
    const stored = {
      kind: row.kind,
      sign_in_kind: row.signInKind,
      subject_name: row.subjectName,
      done_by: row.doneBy,
      api_key_name: row.apiKeyName,
      device: kept.device,
      network_name: kept.networkName,
      city_name: kept.cityName,
      region_name: kept.regionName,
      country_code: kept.countryCode,
      connection_address: kept.connectionAddress,
      happened_at_ms: nowMs,
    };
    const emails = new Set<string>();
    const ownEmail = realEmail((await authUserEmail(env, row.accountId)) ?? "");
    if (ownEmail) emails.add(ownEmail.toLowerCase());
    for (const email of row.alert?.emails ?? []) if (realEmail(email)) emails.add(email.toLowerCase());
    let status: SecurityAlertStatus = "unseen";
    if (emails.size) {
      const sent = await env.DB.prepare("SELECT COUNT(*) AS emailed_count FROM security_events WHERE account_id = ? AND security_alert_status = 'emailed' AND happened_at_ms > ?")
        .bind(row.accountId, nowMs - HOUR_MS)
        .first<{ emailed_count: number }>();
      if ((sent?.emailed_count ?? 0) < SECURITY_LOG_LIMITS.maximumAlertEmailCountPerHour) {
        const words = SECURITY_ALERT_WORDS[kind];
        const message = securityAlertEmail(env, {
          username: account.username,
          title: eventTitle({ kind: row.kind, description: describeSecurityEvent(row.kind, row.signInKind), subject_name: row.subjectName, api_key_name: row.apiKeyName }),
          subject: words.subject,
          ifNotYou: words.ifNotYou,
          isByZaisma: row.doneBy === "zaisma",
          isAboutKeys: KEY_ALERT_KINDS.includes(kind),
          happenedAtMs: nowMs,
          whereText: whereText(stored),
          ...(row.alert?.detailText ? { detailText: row.alert.detailText } : {}),
        });
        const delivered = await Promise.all([...emails].map((email) => deliverEmail(env, email, message)));
        if (delivered.some(Boolean)) status = "emailed";
      }
    }
    await env.DB.prepare("UPDATE security_events SET security_alert_status = ? WHERE id = ?").bind(status, eventNumber).run();
    await tellSecurityAlert(env, row.accountId, activityEventJson({ ...stored, security_alert_status: status }, row.isWhereKept));
  } catch (error) {
    console.error("Security alert not raised", row.kind, error);
  }
}

/** Every unseen alert of the account's is seen: That was me on the account page or dashboard. */
export async function markSecurityAlertsSeen(env: Env, accountId: string): Promise<void> {
  await env.DB.prepare("UPDATE security_events SET security_alert_status = 'seen' WHERE account_id = ? AND security_alert_status = 'unseen'").bind(accountId).run();
}

export async function skipEmailAsk(env: Env, accountId: string, nowMs = Date.now()): Promise<void> {
  await env.DB.prepare("UPDATE accounts SET email_ask_skipped_at_ms = ? WHERE id = ?").bind(nowMs, accountId).run();
}

/**
 * Whether to ask "Where should we tell you if someone else uses your account?": the account has no email, hasn't
 * pressed Skip, and has something to lose: a key of any kind (an AI connected with one) or a game players can play.
 */
export async function isEmailAskDue(env: Env, account: Account, email: string | null): Promise<boolean> {
  if (email || account.email_ask_skipped_at_ms !== null) return false;
  const something = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM api_keys WHERE account_id = ?1)
         OR EXISTS (SELECT 1 FROM games JOIN owners ON owners.id = games.owner_id WHERE owners.account_id = ?1 AND games.live_version_id IS NOT NULL) AS has_something`,
  )
    .bind(account.id)
    .first<{ has_something: number }>();
  return something?.has_something === 1;
}

// --- On the account page and dashboard -------------------------------------------

/** An unseen alert as get_activity's unseen_security_alerts lists it. */
export interface UnseenSecurityAlert {
  kind: string;
  description: string;
  subject_name: string | null;
  api_key_name: string | null;
  done_by: SecurityEventRow["doneBy"];
  device: string | null;
  network_name: string | null;
  city_name: string | null;
  region_name: string | null;
  country_code: string | null;
  happened_at: string;
}

const alertDay = (happenedAt: string) => new Date(happenedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The alerts no email told the account about, until That was me. backTo: the page to come back to. */
export function securityAlertsBox(alerts: UnseenSecurityAlert[], backTo: "/account" | "/dashboard"): Raw | string {
  if (!alerts.length) return "";
  return html`<div class="note" role="status" id="security-alerts"><p><strong>Something changed on your account.</strong> Was it you?</p>
<ul class="keys">${alerts.map((alert) => {
    const where = whereText(alert);
    return html`<li><span>${eventTitle(alert)} <span class="why muted small">${alertDay(alert.happened_at)}${where ? ` · ${where}` : ""}</span></span></li>`;
  })}</ul>
<div class="row"><form method="post" action="/account/security-alerts/seen"><input type="hidden" name="next" value="${backTo}"><button class="btn" type="submit">That was me</button></form> <a class="btn ghost" href="/account?not-you#signing-in">Not you? Change your password</a></div></div>`;
}

/** The ask, once the account has something to lose. With a fresh confirmation it takes the email right here; otherwise it goes to Confirm it's you first. */
export function emailAskBox(options: { isConfirmed: boolean; backTo: "/account" | "/dashboard" }): Raw {
  const skip = html`<form method="post" action="/account/email-ask/skip"><input type="hidden" name="next" value="${options.backTo}"><button class="btn ghost" type="submit">Skip</button></form>`;
  return html`<div class="note" id="email-ask"><p><strong>Where should we tell you if someone else uses your account?</strong></p>
<p class="hint">Only for alerts like this and getting back in. Never shown to anyone.</p>
${options.isConfirmed || options.backTo === "/account"
    ? html`<div class="row"><form class="row" method="post" action="/account/email"${options.isConfirmed ? "" : raw(' data-confirm="strong"')}><input type="email" name="email" autocomplete="email" required aria-label="Email" placeholder="Email"><button class="btn" type="submit">Add</button></form> ${skip}</div>`
    : html`<div class="row"><a class="btn" href="/account?confirm-first#email">Add an email</a> ${skip}</div>`}</div>`;
}

// --- Spikes across Zaisma ------------------------------------------------------------

/**
 * One more of a kind this clock hour, from a network (its number) or across Zaisma (0). The moment the hour's count
 * reaches its threshold, Julius gets one email; list_security_spikes lists it in the admin MCP.
 */
export async function noteSpike(env: Env, spikeKind: SpikeKind, networkNumber: number, networkName: string | null, nowMs = Date.now()): Promise<void> {
  try {
    const hourNumber = Math.floor(nowMs / HOUR_MS);
    const counted = await env.DB.prepare(
      `INSERT INTO security_spikes (spike_kind, network_number, hour_number, network_name, occurrence_count, first_happened_at_ms, last_happened_at_ms) VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT (spike_kind, network_number, hour_number) DO UPDATE SET occurrence_count = occurrence_count + 1, last_happened_at_ms = excluded.last_happened_at_ms, network_name = COALESCE(network_name, excluded.network_name)
       RETURNING occurrence_count`,
    )
      .bind(spikeKind, networkNumber, hourNumber, networkName, nowMs, nowMs)
      .first<{ occurrence_count: number }>();
    const thresholdCount = SPIKE_THRESHOLDS[spikeKind];
    if (counted?.occurrence_count !== thresholdCount) return;
    const claimed = await env.DB.prepare("UPDATE security_spikes SET alerted_at_ms = ? WHERE spike_kind = ? AND network_number = ? AND hour_number = ? AND alerted_at_ms IS NULL")
      .bind(nowMs, spikeKind, networkNumber, hourNumber)
      .run();
    if (claimed.meta.changes !== 1) return;
    const from = networkNumber === ACROSS_ZAISMA_NETWORK_NUMBER ? "across Zaisma" : `from network AS${networkNumber}${networkName ? ` (${networkName})` : ""}`;
    await sendAlert(env, `Spike: ${thresholdCount} ${SPIKE_WORDS[spikeKind]} in an hour ${from}`, `${thresholdCount} ${SPIKE_WORDS[spikeKind]} ${from} since ${iso(hourNumber * HOUR_MS)}. The admin MCP's list_security_spikes has it, with the hour's count as it grows.`);
  } catch (error) {
    console.error("Spike not counted", spikeKind, error);
  }
}

/** What the admin MCP's list_security_spikes answers: every hour past its threshold in the last 30 days, newest first. */
export async function securitySpikesAnswer(env: Env, nowMs = Date.now()) {
  const { results } = await env.DB.prepare("SELECT * FROM security_spikes WHERE alerted_at_ms IS NOT NULL AND last_happened_at_ms > ? ORDER BY hour_number DESC, occurrence_count DESC LIMIT 100")
    .bind(nowMs - SECURITY_SIGNAL_KEPT_DURATION_DAYS * DAY_MS)
    .all<{ spike_kind: SpikeKind; network_number: number; network_name: string | null; hour_number: number; occurrence_count: number }>();
  return {
    security_spikes: results.map((row) => ({
      spike_kind: row.spike_kind,
      autonomous_system: row.network_number === ACROSS_ZAISMA_NETWORK_NUMBER ? null : `AS${row.network_number}`,
      network_name: row.network_number === ACROSS_ZAISMA_NETWORK_NUMBER ? null : row.network_name,
      hour_started_at: iso(row.hour_number * HOUR_MS),
      occurrence_count: row.occurrence_count,
      threshold_count: SPIKE_THRESHOLDS[row.spike_kind] ?? null,
    })),
  };
}

// --- Script policy reports -----------------------------------------------------------

const MAXIMUM_REPORT_BODY_BYTES = 16_384;
const MAXIMUM_REPORT_COUNT_PER_BODY = 20;

/**
 * POST /csp-reports: zaisma.com's script policy (html.ts, securityHeaders) sends its violation reports here, in
 * either shape browsers use. Each is folded into the hour's row and counted toward the scripts_blocked spike. Always
 * 204, so a sender learns nothing; past 30 a minute from one address, or over 16 KB, nothing is kept.
 */
export async function recordBlockedScripts(request: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const done = new Response(null, { status: 204 });
  try {
    const address = connectionAddressOf(request) ?? "unknown";
    if (env.CSP_REPORT_LIMIT && !(await env.CSP_REPORT_LIMIT.limit({ key: address })).success) return done;
    const declaredBytes = Number(request.headers.get("content-length") ?? "0");
    if (declaredBytes > MAXIMUM_REPORT_BODY_BYTES) return done;
    const text = await request.text();
    if (text.length > MAXIMUM_REPORT_BODY_BYTES) return done;
    const parsed: unknown = JSON.parse(text);
    const reports = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, MAXIMUM_REPORT_COUNT_PER_BODY);
    const hourNumber = Math.floor(nowMs / HOUR_MS);
    for (const report of reports) {
      const blocked = cleanBlockedScriptReport(report);
      if (!blocked) continue;
      await env.DB.prepare(
        `INSERT INTO blocked_scripts (violated_directive, blocked_source, page_path, hour_number, occurrence_count, first_reported_at_ms, last_reported_at_ms) VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (violated_directive, blocked_source, page_path, hour_number) DO UPDATE SET occurrence_count = occurrence_count + 1, last_reported_at_ms = excluded.last_reported_at_ms`,
      )
        .bind(blocked.violatedDirective, blocked.blockedSource, blocked.pagePath, hourNumber, nowMs, nowMs)
        .run();
      await noteSpike(env, "scripts_blocked", ACROSS_ZAISMA_NETWORK_NUMBER, null, nowMs);
    }
  } catch {
    // Not JSON, or not a report: nothing to keep.
  }
  return done;
}

/** What the admin MCP's list_blocked_scripts answers: the last 7 days, most reported first, 100 at most. */
export async function blockedScriptsAnswer(env: Env, nowMs = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT violated_directive, blocked_source, page_path, SUM(occurrence_count) AS occurrence_count, MIN(first_reported_at_ms) AS first_reported_at_ms, MAX(last_reported_at_ms) AS last_reported_at_ms
     FROM blocked_scripts WHERE last_reported_at_ms > ? GROUP BY violated_directive, blocked_source, page_path ORDER BY occurrence_count DESC LIMIT 100`,
  )
    .bind(nowMs - 7 * DAY_MS)
    .all<{ violated_directive: string; blocked_source: string; page_path: string; occurrence_count: number; first_reported_at_ms: number; last_reported_at_ms: number }>();
  return {
    blocked_scripts: results.map((row) => ({
      violated_directive: row.violated_directive,
      blocked_source: row.blocked_source,
      page_path: row.page_path,
      occurrence_count: row.occurrence_count,
      first_reported_at: iso(row.first_reported_at_ms),
      last_reported_at: iso(row.last_reported_at_ms),
    })),
  };
}

/** Once a day, with the security log: spikes and blocked scripts after 30 days, and networks an account hasn't signed in from for 90. */
export async function deleteOldSecuritySignals(env: Env, nowMs = Date.now()): Promise<void> {
  const signalsCutoffMs = nowMs - SECURITY_SIGNAL_KEPT_DURATION_DAYS * DAY_MS;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM security_spikes WHERE last_happened_at_ms <= ?").bind(signalsCutoffMs),
    env.DB.prepare("DELETE FROM blocked_scripts WHERE last_reported_at_ms <= ?").bind(signalsCutoffMs),
    env.DB.prepare("DELETE FROM sign_in_networks WHERE last_seen_at_ms <= ?").bind(nowMs - SECURITY_LOG_LIMITS.keptDurationDays * DAY_MS),
  ]);
}

