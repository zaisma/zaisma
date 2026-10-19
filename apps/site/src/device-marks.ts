import { b64url, sha256Hex } from "@zaisma/core";
import { readCookie, setCookie } from "./auth.ts";
import type { Env } from "./env.ts";
import { noteSpike } from "./security-alerts.ts";

/**
 * Wrong passwords (docs/DECISIONS.md, "Accounts open only through Zaisma"). Usernames are public, so a pause
 * for everyone would let anyone lock a classmate out. Instead, a device that has signed in to an account
 * keeps a mark for it and always opens that account with the right password. Other devices run the
 * invisible check and share 20 wrong passwords a day per account; past that, the account opens on a new
 * device only with a passkey or an email code until the day's count drops below 20. A marked device loses
 * its mark after 10 wrong passwords in a row, so a shared computer can't be used to guess.
 *
 * A device is its own HttpOnly cookie, a random ID kept after signing out; Zaisma keeps only its hash, with
 * one mark per account signed in on it, for a year after the last sign-in there.
 */

const DAY_MS = 86400_000;
const MARK_DURATION_DAYS = 365;
const MARK_DURATION_MS = MARK_DURATION_DAYS * DAY_MS;
export const WRONG_PASSWORDS_PER_DAY = 20;
const MAXIMUM_CONSECUTIVE_WRONG_PASSWORD_COUNT = 10;

const DEVICE_COOKIE = "zaisma_device";

async function deviceHash(deviceId: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(deviceId));
}

/** This device's ID from its cookie, or null when it has none. */
function deviceIdOf(request: Request, env: Env): string | null {
  const deviceId = readCookie(request, env, DEVICE_COOKIE);
  return deviceId && /^[A-Za-z0-9_-]{43}$/.test(deviceId) ? deviceId : null;
}

/** Whether this device signed in to the account in the last year and hasn't lost the mark since. */
export async function isDeviceMarked(request: Request, env: Env, accountId: string, nowMs = Date.now()): Promise<boolean> {
  const deviceId = deviceIdOf(request, env);
  if (!deviceId) return false;
  const mark = await env.DB.prepare("SELECT 1 AS is_marked FROM device_marks WHERE device_sha256 = ? AND account_id = ? AND signed_in_at_ms > ?")
    .bind(await deviceHash(deviceId), accountId, nowMs - MARK_DURATION_MS)
    .first();
  return mark !== null;
}

/** Signed in on this device: mark it for the account (again), starting its wrong passwords in a row over. The cookie to send back. */
export async function markDevice(request: Request, env: Env, accountId: string, nowMs = Date.now()): Promise<string> {
  const deviceId = deviceIdOf(request, env) ?? b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(
    `INSERT INTO device_marks (device_sha256, account_id, signed_in_at_ms, consecutive_wrong_password_count) VALUES (?, ?, ?, 0)
     ON CONFLICT (device_sha256, account_id) DO UPDATE SET signed_in_at_ms = excluded.signed_in_at_ms, consecutive_wrong_password_count = 0`,
  )
    .bind(await deviceHash(deviceId), accountId, nowMs)
    .run();
  return setCookie(env, DEVICE_COOKIE, deviceId, { maximumAgeSec: MARK_DURATION_DAYS * 86400 });
}

/** Whether new devices are locked out of the account's password: 20 wrong ones from unmarked devices in the last day. */
export async function isPasswordLockedOut(env: Env, accountId: string, nowMs = Date.now()): Promise<boolean> {
  const counted = await env.DB.prepare("SELECT COUNT(*) AS wrong_password_count FROM wrong_passwords WHERE account_id = ? AND tried_at_ms > ?").bind(accountId, nowMs - DAY_MS).first<{ wrong_password_count: number }>();
  return (counted?.wrong_password_count ?? 0) >= WRONG_PASSWORDS_PER_DAY;
}

/**
 * A wrong password for the account. On a marked device it counts toward the device's 10 in a row, and the
 * tenth costs it the mark; elsewhere it counts toward the day's 20. Either limit reached leaves a notice
 * for the owner's account page.
 */
export async function noteWrongPassword(request: Request, env: Env, accountId: string, isMarked: boolean, nowMs = Date.now()): Promise<void> {
  // Many from one network, on any accounts, is a spike Julius hears about.
  const network = request.cf as { asn?: unknown; asOrganization?: unknown } | undefined;
  if (typeof network?.asn === "number" && network.asn > 0) await noteSpike(env, "wrong_passwords_from_network", network.asn, typeof network.asOrganization === "string" ? network.asOrganization.slice(0, 60) : null, nowMs);
  let isLimitReached: boolean;
  if (isMarked) {
    const device = await deviceHash(deviceIdOf(request, env)!);
    const mark = await env.DB.prepare("UPDATE device_marks SET consecutive_wrong_password_count = consecutive_wrong_password_count + 1 WHERE device_sha256 = ? AND account_id = ? RETURNING consecutive_wrong_password_count")
      .bind(device, accountId)
      .first<{ consecutive_wrong_password_count: number }>();
    isLimitReached = (mark?.consecutive_wrong_password_count ?? 0) >= MAXIMUM_CONSECUTIVE_WRONG_PASSWORD_COUNT;
    if (isLimitReached) await env.DB.prepare("DELETE FROM device_marks WHERE device_sha256 = ? AND account_id = ?").bind(device, accountId).run();
  } else {
    await env.DB.prepare("INSERT INTO wrong_passwords (account_id, tried_at_ms) VALUES (?, ?)").bind(accountId, nowMs).run();
    isLimitReached = await isPasswordLockedOut(env, accountId, nowMs);
  }
  if (isLimitReached) await env.DB.prepare("UPDATE accounts SET wrong_password_notice_at_ms = ? WHERE id = ?").bind(nowMs, accountId).run();
}

/** The account page said the notice from this time (wrong_password_notice_at_ms): it doesn't say it again, unless it happens again. */
export async function clearWrongPasswordNotice(env: Env, accountId: string, noticeAtMs: number): Promise<void> {
  await env.DB.prepare("UPDATE accounts SET wrong_password_notice_at_ms = NULL WHERE id = ? AND wrong_password_notice_at_ms = ?").bind(accountId, noticeAtMs).run();
}

/** Once a day: wrong passwords older than a day, and marks a year past their last sign-in. */
export async function deleteOldDeviceMarks(env: Env, nowMs = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM wrong_passwords WHERE tried_at_ms <= ?").bind(nowMs - DAY_MS),
    env.DB.prepare("DELETE FROM device_marks WHERE signed_in_at_ms <= ?").bind(nowMs - MARK_DURATION_MS),
  ]);
}
