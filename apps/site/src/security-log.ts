import {
  ACCOUNT_EVENT_KINDS,
  ACCOUNT_WIDE_GAME_EVENT_KINDS,
  ADDRESS_KEEPING_EVENT_KINDS,
  ALWAYS_ADDRESS_KEEPING_EVENT_KINDS,
  ApiError,
  NO_WHERE,
  SECURITY_LOG_LIMITS,
  SIGN_IN_EVENT_KINDS,
  describeSecurityEvent,
  foldKeyFor,
  isReadOnlySql,
  placeSha256For,
  whereFrom,
  type Account,
  type ApiKey,
  type DoneBy,
  type Game,
  type RequestWhere,
  type SecurityEventKind,
  type SignInKind,
} from "@zaisma/core";
import { connectionAddressOf } from "./auth.ts";
import { isDeviceMarked, markDevice } from "./device-marks.ts";
import type { Caller, CheckedCall } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * The security log's database side (docs/DECISIONS.md, "The security log says who did what from where"):
 * writing events where each action succeeds, the places keys were used from, and the account's Activity and
 * a game's history as the API answers them. The pure parts (kinds, words, the where) are in
 * packages/core/src/security-log.ts.
 *
 * Every write here catches its own errors and logs them, never throws: the action it records already happened.
 */

const DAY_MS = 86400_000;
const HOUR_MS = 3600_000;

export interface SecurityEventRow {
  accountId: string;
  gameId: string | null;
  kind: SecurityEventKind;
  doneBy: DoneBy;
  apiKeyId: string | null;
  apiKeyName: string | null;
  signInKind: SignInKind | null;
  versionId: string | null;
  subjectName: string | null;
  where: RequestWhere;
  /** Whether the account keeps where it's used from (accounts.where_used_from_enabled). */
  isWhereKept: boolean;
  isNewPlace: boolean;
}

/** The place's words and the address as they're kept for this event: the setting off keeps no where, and only uploads keep their address. */
function keptWhere(row: SecurityEventRow) {
  const { where } = row;
  const keepsAddress = (row.isWhereKept ? ADDRESS_KEEPING_EVENT_KINDS : ALWAYS_ADDRESS_KEEPING_EVENT_KINDS).includes(row.kind);
  return {
    device: row.isWhereKept ? where.device : null,
    networkName: row.isWhereKept ? where.networkName : null,
    cityName: row.isWhereKept ? where.cityName : null,
    regionName: row.isWhereKept ? where.regionName : null,
    countryCode: row.isWhereKept ? where.countryCode : null,
    connectionAddress: keepsAddress ? where.connectionAddress : null,
  };
}

export async function logSecurityEvent(env: Env, row: SecurityEventRow, nowMs = Date.now()): Promise<void> {
  try {
    const kept = keptWhere(row);
    const foldKey = foldKeyFor(row.kind, row.gameId, row.doneBy, row.apiKeyId, nowMs);
    await env.DB.prepare(
      `INSERT INTO security_events (account_id, game_id, kind, done_by, api_key_id, api_key_name, sign_in_kind, version_id, subject_name, device, network_name, city_name, region_name, country_code, connection_address, is_new_place, occurrence_count, fold_key, happened_at_ms, last_happened_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ${foldKey ? "ON CONFLICT (fold_key) DO UPDATE SET occurrence_count = occurrence_count + 1, last_happened_at_ms = excluded.last_happened_at_ms, is_new_place = MAX(is_new_place, excluded.is_new_place)" : ""}`,
    )
      .bind(
        row.accountId,
        row.gameId,
        row.kind,
        row.doneBy,
        row.apiKeyId,
        row.apiKeyName,
        row.signInKind,
        row.versionId,
        row.subjectName,
        kept.device,
        kept.networkName,
        kept.cityName,
        kept.regionName,
        kept.countryCode,
        kept.connectionAddress,
        row.isNewPlace ? 1 : 0,
        foldKey,
        nowMs,
        nowMs,
      )
      .run();
  } catch (error) {
    console.error("Security event not logged", row.kind, error);
  }
}

const DONE_BY_VIA: Record<Caller["via"], DoneBy> = { dashboard: "you", api: "api_key", mcp: "ai" };

/** An event for a call that succeeded: who made it comes from the caller, and for a game's, whether its key is somewhere new. */
export async function logCallerEvent(
  env: Env,
  caller: Caller,
  kind: SecurityEventKind,
  parts: { gameId?: string | null; versionId?: string | null; subjectName?: string | null } = {},
): Promise<void> {
  try {
    const gameId = parts.gameId ?? null;
    let isNewPlace = false;
    const apiKeyId = caller.access.apiKeyId;
    if (gameId && apiKeyId && caller.placeSha256) {
      const first = await env.DB.prepare("UPDATE security_places SET game_event_logged_at_ms = ? WHERE api_key_id = ? AND place_sha256 = ? AND game_event_logged_at_ms IS NULL").bind(Date.now(), apiKeyId, caller.placeSha256).run();
      isNewPlace = first.meta.changes > 0;
    }
    await logSecurityEvent(env, {
      accountId: caller.accountId,
      gameId,
      kind,
      doneBy: DONE_BY_VIA[caller.via],
      apiKeyId,
      apiKeyName: caller.access.apiKeyName,
      signInKind: null,
      versionId: parts.versionId ?? null,
      subjectName: parts.subjectName ?? null,
      where: caller.where,
      isWhereKept: caller.isWhereKept,
      isNewPlace,
    });
  } catch (error) {
    console.error("Security event not logged", kind, error);
  }
}

/** Where a request came from, for a person on our own pages. */
export function whereOfPerson(request: Request): RequestWhere {
  return whereFrom(request.cf as Parameters<typeof whereFrom>[0], request.headers.get("user-agent") ?? "", "you", connectionAddressOf(request));
}

/** A change to how the account signs in or to its keys, made by the account on zaisma.com. */
export async function logAccountChange(request: Request, env: Env, account: Account, kind: SecurityEventKind, parts: { subjectName?: string | null } = {}): Promise<void> {
  await logSecurityEvent(env, {
    accountId: account.id,
    gameId: null,
    kind,
    doneBy: "you",
    apiKeyId: null,
    apiKeyName: null,
    signInKind: null,
    versionId: null,
    subjectName: parts.subjectName ?? null,
    where: whereOfPerson(request),
    isWhereKept: account.where_used_from_enabled === 1,
    isNewPlace: false,
  });
}

/**
 * Signed in (or made the account) on this device. A device the account hadn't marked is a new device, and
 * says so in the log; one it had is quiet. Marks the device either way, and answers its cookie.
 */
export async function recordSignIn(request: Request, env: Env, accountId: string, signInKind: SignInKind | null, options: { isNewAccount?: boolean } = {}): Promise<string> {
  const wasMarked = await isDeviceMarked(request, env, accountId);
  const cookie = await markDevice(request, env, accountId);
  if (!wasMarked) {
    try {
      const account = await env.DB.prepare("SELECT where_used_from_enabled FROM accounts WHERE id = ?").bind(accountId).first<{ where_used_from_enabled: number }>();
      await logSecurityEvent(env, {
        accountId,
        gameId: null,
        kind: options.isNewAccount ? "account_created" : "signed_in_new_device",
        doneBy: "you",
        apiKeyId: null,
        apiKeyName: null,
        signInKind,
        versionId: null,
        subjectName: null,
        where: whereOfPerson(request),
        isWhereKept: (account?.where_used_from_enabled ?? 1) === 1,
        isNewPlace: false,
      });
    } catch (error) {
      console.error("Sign-in not logged", error);
    }
  }
  return cookie;
}

/**
 * A call with a key: where it came from, as a fingerprint of its network and country. A place the key
 * hasn't been used from is an event; so is its first call through the MCP (an AI connected). Answers the
 * place's fingerprint, or null when the request has no network or country.
 */
export async function noteKeyUse(request: Request, env: Env, key: Omit<ApiKey, "created_at_ms">, caller: Caller, nowMs = Date.now()): Promise<string | null> {
  try {
    const placeSha256 = await placeSha256For(key.id, caller.where);
    const isHourlyTouch = !key.last_used_at_ms || nowMs - key.last_used_at_ms > HOUR_MS;
    // What the key list shows as its last use: kept only while the account keeps where it's used from.
    if (placeSha256 && (placeSha256 !== key.last_place_sha256 || isHourlyTouch)) {
      const { where } = caller;
      const kept = caller.isWhereKept;
      await env.DB.prepare("UPDATE api_keys SET last_used_device = ?, last_used_network_name = ?, last_used_city_name = ?, last_used_region_name = ?, last_used_country_code = ? WHERE id = ?")
        .bind(kept ? where.device : null, kept ? where.networkName : null, kept ? where.cityName : null, kept ? where.regionName : null, kept ? where.countryCode : null, key.id)
        .run();
    }
    if (placeSha256 && placeSha256 !== key.last_place_sha256) {
      const inserted = await env.DB.prepare("INSERT OR IGNORE INTO security_places (account_id, api_key_id, place_sha256, first_seen_at_ms, last_seen_at_ms, game_event_logged_at_ms) VALUES (?, ?, ?, ?, ?, NULL)")
        .bind(key.account_id, key.id, placeSha256, nowMs, nowMs)
        .run();
      if (inserted.meta.changes === 1) {
        await logSecurityEvent(env, {
          accountId: key.account_id,
          gameId: null,
          kind: "api_key_new_place",
          doneBy: caller.via === "mcp" ? "ai" : "api_key",
          apiKeyId: key.id,
          apiKeyName: key.name,
          signInKind: null,
          versionId: null,
          subjectName: null,
          where: caller.where,
          isWhereKept: caller.isWhereKept,
          isNewPlace: true,
        });
      } else {
        await env.DB.prepare("UPDATE security_places SET last_seen_at_ms = ? WHERE api_key_id = ? AND place_sha256 = ?").bind(nowMs, key.id, placeSha256).run();
      }
      await env.DB.prepare("UPDATE api_keys SET last_place_sha256 = ? WHERE id = ?").bind(placeSha256, key.id).run();
    } else if (placeSha256 && isHourlyTouch) {
      // Along with the hourly touch of last_used_at_ms, so a place in use isn't forgotten.
      await env.DB.prepare("UPDATE security_places SET last_seen_at_ms = ? WHERE api_key_id = ? AND place_sha256 = ?").bind(nowMs, key.id, placeSha256).run();
    }
    if (caller.via === "mcp" && key.mcp_first_used_at_ms === null) {
      const first = await env.DB.prepare("UPDATE api_keys SET mcp_first_used_at_ms = ? WHERE id = ? AND mcp_first_used_at_ms IS NULL").bind(nowMs, key.id).run();
      if (first.meta.changes === 1) {
        await logSecurityEvent(env, {
          accountId: key.account_id,
          gameId: null,
          kind: "ai_connected",
          doneBy: "ai",
          apiKeyId: key.id,
          apiKeyName: key.name,
          signInKind: null,
          versionId: null,
          subjectName: null,
          where: caller.where,
          isWhereKept: caller.isWhereKept,
          isNewPlace: false,
        });
      }
    }
    return placeSha256;
  } catch (error) {
    console.error("Key use not noted", error);
    return null;
  }
}

/** The place a key is made from counts as its own, so its first use there isn't new. */
export async function seedKeyPlace(request: Request, env: Env, accountId: string, apiKeyId: string): Promise<void> {
  try {
    const placeSha256 = await placeSha256For(apiKeyId, whereOfPerson(request));
    if (!placeSha256) return;
    const nowMs = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO security_places (account_id, api_key_id, place_sha256, first_seen_at_ms, last_seen_at_ms, game_event_logged_at_ms) VALUES (?, ?, ?, ?, ?, ?)").bind(accountId, apiKeyId, placeSha256, nowMs, nowMs, nowMs),
      env.DB.prepare("UPDATE api_keys SET last_place_sha256 = ? WHERE id = ?").bind(placeSha256, apiKeyId),
    ]);
  } catch (error) {
    console.error("Key place not seeded", error);
  }
}

/** SQL that wrote or imported a game's database, or exported it: one folded event, unless it only read. A restore or its undo: one event each. */
export async function logDatabaseCall(env: Env, caller: Caller, game: Game, what: string | undefined, checked: CheckedCall, answerBody: unknown): Promise<void> {
  if (what === "restores" || what === "undo") {
    const restore = (answerBody as { database_restore?: { restore_to_at?: string; undoes_database_restore_id?: string | null } } | null)?.database_restore;
    if (!restore) return;
    if (what === "undo") return logCallerEvent(env, caller, "database_restore_undone", { gameId: game.id, subjectName: restore.undoes_database_restore_id ?? null });
    return logCallerEvent(env, caller, "database_restored", { gameId: game.id, subjectName: restore.restore_to_at ?? null });
  }
  if (what === "export") return logCallerEvent(env, caller, "database_exported", { gameId: game.id });
  if (what === "import") return logCallerEvent(env, caller, "database_imported", { gameId: game.id });
  if (what === "erase-player") return logCallerEvent(env, caller, "database_written", { gameId: game.id });
  if (what !== "query" && what !== "batch") return;
  const answer = (answerBody ?? {}) as { written_row_count?: unknown; statement_results?: { written_row_count?: unknown }[] };
  const writtenRowCount = what === "query" ? Number(answer.written_row_count ?? 0) : (answer.statement_results ?? []).reduce((writtenSoFarCount, statementResult) => writtenSoFarCount + Number(statementResult.written_row_count ?? 0), 0);
  const statements = what === "query" ? [checked.body.sql] : Array.isArray(checked.body.statements) ? (checked.body.statements as unknown[]).map((statement) => (statement as { sql?: unknown } | null)?.sql) : [];
  const readsOnly = statements.length > 0 && statements.every((sql) => typeof sql === "string" && isReadOnlySql(sql));
  if (readsOnly && writtenRowCount === 0) return;
  await logCallerEvent(env, caller, "database_written", { gameId: game.id });
}

/** Reading one save or one earlier copy, and changing, resetting or restoring a save. Lists aren't logged. */
export async function logSavesCall(env: Env, caller: Caller, game: Game, method: string, isSaveContents: boolean): Promise<void> {
  if (method === "GET") {
    if (isSaveContents) await logCallerEvent(env, caller, "saves_read", { gameId: game.id });
    return;
  }
  await logCallerEvent(env, caller, "save_changed", { gameId: game.id });
}

// --- What the API answers ----------------------------------------------------------

/** The fields every event answers with about who and where. */
interface WhoAndWhereRow {
  done_by: DoneBy;
  api_key_name: string | null;
  device: string | null;
  network_name: string | null;
  city_name: string | null;
  region_name: string | null;
  country_code: string | null;
  connection_address: string | null;
}

const WHO_AND_WHERE_COLUMNS = "done_by, api_key_name, device, network_name, city_name, region_name, country_code, connection_address";

const iso = (ms: number) => new Date(ms).toISOString();

function whoAndWhere(row: WhoAndWhereRow, isAddressShown: boolean) {
  return {
    done_by: row.done_by,
    api_key_name: row.api_key_name,
    device: row.device,
    network_name: row.network_name,
    city_name: row.city_name,
    region_name: row.region_name,
    country_code: row.country_code,
    connection_address: isAddressShown ? row.connection_address : null,
  };
}

function placeholders(valueCount: number): string {
  return Array.from({ length: valueCount }, () => "?").join(", ");
}

/** The account's Activity: the last 90 days of its own events, newest first, 50 a page. */
export async function activityAnswer(env: Env, account: Account, cursor: string | null, nowMs = Date.now()) {
  let beforeEventNumber = Number.MAX_SAFE_INTEGER;
  if (cursor !== null) {
    const match = cursor.match(/^cursor_([0-9]{1,15})$/);
    if (!match) throw new ApiError("bad_cursor", { message: "That cursor isn't one this call gave.", field: "cursor", fix: "Pass next_cursor from the last answer, or leave cursor out for the newest." });
    beforeEventNumber = Number(match[1]);
  }
  const pageEventCount = SECURITY_LOG_LIMITS.activityPageEventCount;
  const { results } = await env.DB.prepare(
    `SELECT id, kind, sign_in_kind, subject_name, ${WHO_AND_WHERE_COLUMNS}, happened_at_ms FROM security_events
     WHERE account_id = ? AND game_id IS NULL AND kind IN (${placeholders(ACCOUNT_EVENT_KINDS.length)}) AND happened_at_ms > ? AND id < ?
     ORDER BY id DESC LIMIT ?`,
  )
    .bind(account.id, ...ACCOUNT_EVENT_KINDS, nowMs - SECURITY_LOG_LIMITS.keptDurationDays * DAY_MS, beforeEventNumber, pageEventCount + 1)
    .all<WhoAndWhereRow & { id: number; kind: SecurityEventKind; sign_in_kind: SignInKind | null; subject_name: string | null; happened_at_ms: number }>();
  const page = results.slice(0, pageEventCount);
  const isAddressShown = account.where_used_from_enabled === 1;
  return {
    events: page.map((row) => ({
      kind: row.kind,
      description: describeSecurityEvent(row.kind, row.sign_in_kind),
      sign_in_kind: row.sign_in_kind,
      subject_name: row.subject_name,
      ...whoAndWhere(row, isAddressShown),
      happened_at: iso(row.happened_at_ms),
    })),
    where_used_from_enabled: account.where_used_from_enabled === 1,
    next_cursor: results.length > pageEventCount ? `cursor_${page[page.length - 1]!.id}` : null,
  };
}

/** One event of a game's history, as the API answers it. */
export interface HistoryEvent {
  description: string;
  version_id: string | null;
  subject_name: string | null;
  done_by: DoneBy;
  api_key_name: string | null;
  device: string | null;
  network_name: string | null;
  city_name: string | null;
  region_name: string | null;
  country_code: string | null;
  connection_address: string | null;
  is_new_place: boolean;
  occurrence_count: number;
  happened_at: string;
  last_happened_at: string;
  review_reason: unknown;
}

/**
 * What happened to a game, newest first, 100: the developer's and their keys' changes from the security
 * log (plus the account-wide webhooks and sign-in apps, for a caller that isn't limited to some games), and
 * what Zaisma did from the audit log, which describeZaisma words (null for an entry the developer isn't told).
 */
export async function gameHistoryAnswer(
  env: Env,
  game: Game,
  caller: Caller,
  describeZaisma: (entry: { action: string; reason: string; review_reason: string | null }) => { description: string; version_id: string | null; review_reason: unknown } | null,
): Promise<{ events: HistoryEvent[] }> {
  const eventCount = SECURITY_LOG_LIMITS.gameHistoryEventCount;
  const isUnlimited = caller.access.gameSlugs === null;
  const wide = isUnlimited ? ` OR (account_id = ? AND game_id IS NULL AND kind IN (${placeholders(ACCOUNT_WIDE_GAME_EVENT_KINDS.length)}))` : "";
  const [{ results: logged }, { results: audited }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, kind, version_id, subject_name, ${WHO_AND_WHERE_COLUMNS}, is_new_place, occurrence_count, happened_at_ms, last_happened_at_ms FROM security_events
       WHERE game_id = ?${wide} ORDER BY happened_at_ms DESC, id DESC LIMIT ?`,
    )
      .bind(game.id, ...(isUnlimited ? [caller.accountId, ...ACCOUNT_WIDE_GAME_EVENT_KINDS] : []), eventCount)
      .all<WhoAndWhereRow & { id: number; kind: SecurityEventKind; version_id: string | null; subject_name: string | null; is_new_place: number; occurrence_count: number; happened_at_ms: number; last_happened_at_ms: number }>(),
    env.DB.prepare("SELECT id, action, reason, happened_at_ms, review_reason FROM audit_log WHERE game_id = ? AND actor NOT LIKE 'account:%' ORDER BY happened_at_ms DESC, id DESC LIMIT ?")
      .bind(game.id, eventCount)
      .all<{ id: number; action: string; reason: string; happened_at_ms: number; review_reason: string | null }>(),
  ]);
  const merged: { happenedAtMs: number; id: number; event: HistoryEvent }[] = logged.map((row) => ({
    happenedAtMs: row.happened_at_ms,
    id: row.id,
    event: {
      description: describeSecurityEvent(row.kind, null),
      version_id: row.version_id,
      subject_name: row.subject_name,
      ...whoAndWhere(row, caller.isWhereKept),
      is_new_place: row.is_new_place === 1,
      occurrence_count: row.occurrence_count,
      happened_at: iso(row.happened_at_ms),
      last_happened_at: iso(row.last_happened_at_ms),
      review_reason: null,
    },
  }));
  for (const entry of audited) {
    const described = describeZaisma(entry);
    if (!described) continue;
    merged.push({
      happenedAtMs: entry.happened_at_ms,
      id: entry.id,
      event: {
        ...described,
        subject_name: null,
        done_by: "zaisma",
        api_key_name: null,
        device: null,
        network_name: null,
        city_name: null,
        region_name: null,
        country_code: null,
        connection_address: null,
        is_new_place: false,
        occurrence_count: 1,
        happened_at: iso(entry.happened_at_ms),
        last_happened_at: iso(entry.happened_at_ms),
      },
    });
  }
  merged.sort((first, second) => second.happenedAtMs - first.happenedAtMs || second.id - first.id);
  return { events: merged.slice(0, eventCount).map((entry) => entry.event) };
}

/**
 * Keep where the account is used from, on or off. Off wipes the device, network, place and address from the
 * account's rows (uploads keep their address 90 days either way), so the log then says only what happened and when.
 */
export async function setWhereUsedFrom(request: Request, env: Env, account: Account, isEnabled: boolean): Promise<void> {
  if (!isEnabled) {
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET where_used_from_enabled = 0 WHERE id = ?").bind(account.id),
      env.DB.prepare("UPDATE api_keys SET last_used_device = NULL, last_used_network_name = NULL, last_used_city_name = NULL, last_used_region_name = NULL, last_used_country_code = NULL WHERE account_id = ?").bind(account.id),
      env.DB.prepare(
        `UPDATE security_events SET device = NULL, network_name = NULL, city_name = NULL, region_name = NULL, country_code = NULL,
           connection_address = CASE WHEN kind IN (${placeholders(ALWAYS_ADDRESS_KEEPING_EVENT_KINDS.length)}) THEN connection_address ELSE NULL END
         WHERE account_id = ?`,
      ).bind(...ALWAYS_ADDRESS_KEEPING_EVENT_KINDS, account.id),
    ]);
    await logSecurityEvent(env, {
      accountId: account.id,
      gameId: null,
      kind: "where_used_from_turned_off",
      doneBy: "you",
      apiKeyId: null,
      apiKeyName: null,
      signInKind: null,
      versionId: null,
      subjectName: null,
      where: NO_WHERE,
      isWhereKept: false,
      isNewPlace: false,
    });
    return;
  }
  await env.DB.prepare("UPDATE accounts SET where_used_from_enabled = 1 WHERE id = ?").bind(account.id).run();
  await logSecurityEvent(env, {
    accountId: account.id,
    gameId: null,
    kind: "where_used_from_turned_on",
    doneBy: "you",
    apiKeyId: null,
    apiKeyName: null,
    signInKind: null,
    versionId: null,
    subjectName: null,
    where: whereOfPerson(request),
    isWhereKept: true,
    isNewPlace: false,
  });
}

/** Once a day: sign-ins older than 90 days go, every other event loses its place and address, and so do places no key has used since. Keys that stopped working 90 days ago go. */
export async function deleteOldSecurityEvents(env: Env, nowMs = Date.now()): Promise<void> {
  const cutoffMs = nowMs - SECURITY_LOG_LIMITS.keptDurationDays * DAY_MS;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM security_events WHERE kind IN (${placeholders(SIGN_IN_EVENT_KINDS.length)}) AND happened_at_ms <= ?`).bind(...SIGN_IN_EVENT_KINDS, cutoffMs),
    env.DB.prepare(
      `UPDATE security_events SET network_name = NULL, city_name = NULL, region_name = NULL, country_code = NULL, connection_address = NULL
       WHERE happened_at_ms <= ? AND (network_name IS NOT NULL OR city_name IS NOT NULL OR region_name IS NOT NULL OR country_code IS NOT NULL OR connection_address IS NOT NULL)`,
    ).bind(cutoffMs),
    env.DB.prepare("DELETE FROM security_places WHERE last_seen_at_ms <= ?").bind(cutoffMs),
    // A key's last use keeps no place after 90 days either.
    env.DB.prepare(
      `UPDATE api_keys SET last_used_device = NULL, last_used_network_name = NULL, last_used_city_name = NULL, last_used_region_name = NULL, last_used_country_code = NULL
       WHERE last_used_at_ms <= ? AND (last_used_device IS NOT NULL OR last_used_network_name IS NOT NULL OR last_used_city_name IS NOT NULL OR last_used_region_name IS NOT NULL OR last_used_country_code IS NOT NULL)`,
    ).bind(cutoffMs),
    // A key that stopped working 90 days ago goes, with the places it was used from and a connected app's tokens.
    env.DB.prepare("DELETE FROM connected_app_tokens WHERE api_key_id IN (SELECT id FROM api_keys WHERE COALESCE(turned_off_at_ms, ends_at_ms) <= ?)").bind(cutoffMs),
    env.DB.prepare("DELETE FROM security_places WHERE api_key_id IN (SELECT id FROM api_keys WHERE COALESCE(turned_off_at_ms, ends_at_ms) <= ?)").bind(cutoffMs),
    env.DB.prepare("DELETE FROM api_keys WHERE COALESCE(turned_off_at_ms, ends_at_ms) <= ?").bind(cutoffMs),
  ]);
}

// --- Words for pages ----------------------------------------------------------------

export const COUNTRY_SHORT_NAMES: Record<string, string> = { GB: "UK", US: "US" };

function countryName(countryCode: string): string {
  const short = COUNTRY_SHORT_NAMES[countryCode];
  if (short) return short;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

interface EventWords {
  kind?: string;
  description: string;
  subject_name: string | null;
  api_key_name: string | null;
  occurrence_count?: number;
  done_by: DoneBy;
  device: string | null;
  network_name: string | null;
  city_name: string | null;
  region_name: string | null;
  country_code: string | null;
}

/** "Chrome on a Windows PC · Vodafone, near Manchester, UK": each part left out when it isn't known. Empty when nothing is. */
export function whereText(event: Pick<EventWords, "device" | "network_name" | "city_name" | "region_name" | "country_code">): string {
  const place = [event.network_name, event.city_name || event.region_name ? `near ${event.city_name ?? event.region_name}` : null, event.country_code ? countryName(event.country_code) : null].filter(Boolean).join(", ");
  return [event.device, place].filter(Boolean).join(" · ");
}

/** Who did it: "You", `Key "GitHub Actions"`, `Your AI · key "preview"`, "Zaisma". */
export function doneByText(event: Pick<EventWords, "done_by" | "api_key_name">): string {
  if (event.done_by === "you") return "You";
  if (event.done_by === "zaisma") return "Zaisma";
  if (event.done_by === "ai") return event.api_key_name ? `Your AI · key "${event.api_key_name}"` : "Your AI";
  return event.api_key_name ? `Key "${event.api_key_name}"` : "An API key";
}

/** The event in a line: what it says, what it was done to, and how many times when it folded. */
export function eventTitle(event: Pick<EventWords, "kind" | "description" | "subject_name" | "api_key_name" | "occurrence_count">): string {
  const subject = event.subject_name ?? (event.kind === "api_key_new_place" || event.kind === "api_key_turned_off" || event.kind === "ai_connected" ? event.api_key_name : null);
  return `${event.description}${subject ? `: ${subject}` : ""}${(event.occurrence_count ?? 1) > 1 ? ` (${event.occurrence_count} times)` : ""}`;
}
