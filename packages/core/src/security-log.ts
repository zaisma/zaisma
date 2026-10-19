import { sha256Hex } from "./ids.ts";
import { deviceName } from "./passkeys.ts";

/**
 * The security log's pure parts (docs/DECISIONS.md, "The security log says who did what from where"): the
 * kinds of event, who did them, where they came from and what each says in plain words. The database side
 * is apps/site/src/security-log.ts.
 */

export const SIGN_IN_KINDS = ["password", "passkey", "email_code", "google", "discord"] as const;
export type SignInKind = (typeof SIGN_IN_KINDS)[number];

/** Who did it: the developer on zaisma.com, a script's API key, an AI through the MCP, or Zaisma. */
export const DONE_BY_KINDS = ["you", "api_key", "ai", "zaisma"] as const;
export type DoneBy = (typeof DONE_BY_KINDS)[number];

export const SECURITY_EVENT_DESCRIPTIONS = {
  // The account's own, shown in its Activity list.
  account_created: "Made your account",
  signed_in_new_device: "Signed in on a new device",
  password_added: "Added a password",
  password_changed: "Changed your password",
  email_added: "Added an email",
  email_changed: "Changed your email",
  email_removed: "Removed your email",
  passkey_added: "Added a passkey",
  passkey_removed: "Removed a passkey",
  api_key_created: "Made an API key",
  api_key_removed: "Removed an API key",
  api_key_new_place: "An API key was used from a new place",
  api_key_turned_off: "Zaisma turned off an API key found in public",
  ai_connected: "Connected an AI",
  connected_app_added: "Connected an app",
  connected_app_removed: "Removed a connected app",
  where_used_from_turned_off: "Turned off Keep where my account is used from",
  where_used_from_turned_on: "Turned on Keep where my account is used from",
  // A game's, in the words its history has always used.
  game_created: "Made the game",
  details_changed: "Changed the details",
  multiplayer_changed: "Multiplayer settings changed",
  allowed_hosts_changed: "Changed which other servers the game server can call",
  own_servers_changed: "Changed the game's own servers",
  links_changed: "Changed the game's links",
  image_added: "Added an image",
  image_refused: "An image upload was refused",
  image_removed: "Removed an image",
  version_uploaded: "Uploaded a version",
  version_published: "Published a version",
  version_rolled_back: "Rolled back to an earlier version",
  publish_scheduled: "Scheduled a version to publish later",
  publish_unscheduled: "Cancelled a scheduled publish",
  preview_links_ended: "Turned off a version's preview links",
  tester_link_added: "Made a tester link",
  tester_link_changed: "Changed a tester link",
  tester_link_removed: "Turned off a tester link",
  secret_set: "Set a secret",
  secret_deleted: "Deleted a secret",
  database_written: "Changed the database with SQL",
  database_imported: "Imported into the database",
  database_exported: "Exported the database",
  database_restored: "Restored the database to an earlier time",
  database_restore_undone: "Undid a database restore",
  saves_read: "Read a player's save",
  save_changed: "Changed a player's save",
  // The developer's account-wide things, shown in every game's history to a key that reaches them.
  webhook_created: "Made a webhook",
  webhook_changed: "Changed a webhook",
  webhook_deleted: "Deleted a webhook",
  sign_in_app_created: "Made a sign-in app",
  sign_in_app_changed: "Changed a sign-in app",
  sign_in_app_deleted: "Deleted a sign-in app",
} as const satisfies Record<string, string>;

export type SecurityEventKind = keyof typeof SECURITY_EVENT_DESCRIPTIONS;
export const SECURITY_EVENT_KINDS = Object.keys(SECURITY_EVENT_DESCRIPTIONS) as SecurityEventKind[];

/** The events an account's Activity list shows. */
export const ACCOUNT_EVENT_KINDS: readonly SecurityEventKind[] = [
  "account_created",
  "signed_in_new_device",
  "password_added",
  "password_changed",
  "email_added",
  "email_changed",
  "email_removed",
  "passkey_added",
  "passkey_removed",
  "api_key_created",
  "api_key_removed",
  "api_key_new_place",
  "api_key_turned_off",
  "ai_connected",
  "connected_app_added",
  "connected_app_removed",
  "where_used_from_turned_off",
  "where_used_from_turned_on",
];

/** Belong to the whole account, so they show in every game's history for a key that isn't limited to some games. */
export const ACCOUNT_WIDE_GAME_EVENT_KINDS: readonly SecurityEventKind[] = ["webhook_created", "webhook_changed", "webhook_deleted", "sign_in_app_created", "sign_in_app_changed", "sign_in_app_deleted"];

/** Sign-ins: deleted after 90 days, where the others only lose their place. */
export const SIGN_IN_EVENT_KINDS: readonly SecurityEventKind[] = ["account_created", "signed_in_new_device"];

/** Calls that come in bunches: one row an hour, counting them, so a script's thousand saves leave one. */
export const FOLDED_EVENT_KINDS: readonly SecurityEventKind[] = ["database_written", "database_imported", "database_exported", "saves_read", "save_changed"];

/** What developers do to games, and the keys they make and use: these keep the connection address for 90 days. */
export const ADDRESS_KEEPING_EVENT_KINDS: readonly SecurityEventKind[] = [
  "api_key_created",
  "api_key_new_place",
  "ai_connected",
  "connected_app_added",
  "game_created",
  "details_changed",
  "multiplayer_changed",
  "allowed_hosts_changed",
  "own_servers_changed",
  "links_changed",
  "image_added",
  "image_refused",
  "image_removed",
  "version_uploaded",
  "version_published",
  "version_rolled_back",
  "publish_scheduled",
  "publish_unscheduled",
  "preview_links_ended",
  "tester_link_added",
  "tester_link_changed",
  "tester_link_removed",
  "secret_set",
  "secret_deleted",
  "database_written",
  "database_imported",
  "database_restored",
  "database_restore_undone",
  "save_changed",
  "webhook_created",
  "webhook_changed",
  "webhook_deleted",
  "sign_in_app_created",
  "sign_in_app_changed",
  "sign_in_app_deleted",
];

/** Uploads keep their address for 90 days whether or not the account keeps where it's used from. */
export const ALWAYS_ADDRESS_KEEPING_EVENT_KINDS: readonly SecurityEventKind[] = ["version_uploaded", "image_added", "image_refused"];

export const SECURITY_LOG_LIMITS = {
  keptDurationDays: 90,
  activityPageEventCount: 50,
  accountPageEventCount: 10,
  gameHistoryEventCount: 100,
  foldDurationMs: 3_600_000,
  maximumWhereCharacterCount: 60,
} as const;

const SIGN_IN_KIND_WORDS: Record<SignInKind, string> = {
  password: "with your password",
  passkey: "with a passkey",
  email_code: "with an email code",
  google: "with Google",
  discord: "with Discord",
};

/** What an event says, in plain words. A sign-in says how. */
export function describeSecurityEvent(kind: SecurityEventKind, signInKind: SignInKind | null): string {
  if (kind === "signed_in_new_device") return signInKind ? `Signed in ${SIGN_IN_KIND_WORDS[signInKind]} on a new device` : "Signed in on a new device";
  return SECURITY_EVENT_DESCRIPTIONS[kind];
}

/** Where a request came from, as far as Cloudflare and the user agent say. Labels only: nothing here is trusted. */
export interface RequestWhere {
  device: string | null;
  networkName: string | null;
  cityName: string | null;
  regionName: string | null;
  countryCode: string | null;
  networkNumber: number | null;
  connectionAddress: string | null;
}

export const NO_WHERE: RequestWhere = { device: null, networkName: null, cityName: null, regionName: null, countryCode: null, networkNumber: null, connectionAddress: null };

function shortText(given: unknown): string | null {
  if (typeof given !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = given.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, SECURITY_LOG_LIMITS.maximumWhereCharacterCount);
  return cleaned === "" ? null : cleaned;
}

export function whereFrom(
  cloudflareProperties: { asn?: unknown; asOrganization?: unknown; city?: unknown; region?: unknown; country?: unknown } | undefined,
  userAgent: string,
  doneBy: DoneBy,
  connectionAddress: string | null,
): RequestWhere {
  const country = cloudflareProperties?.country;
  const asn = cloudflareProperties?.asn;
  return {
    device: deviceFor(userAgent, doneBy),
    networkName: shortText(cloudflareProperties?.asOrganization),
    cityName: shortText(cloudflareProperties?.city),
    regionName: shortText(cloudflareProperties?.region),
    countryCode: typeof country === "string" && /^[A-Z][A-Z0-9]$/.test(country) ? country : null,
    networkNumber: typeof asn === "number" && Number.isInteger(asn) && asn > 0 ? asn : null,
    connectionAddress,
  };
}

/** The browser a user agent says it is, or null when it isn't one we know. */
export function browserName(userAgent: string): string | null {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\//.test(userAgent)) return "Opera";
  if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) return "Safari";
  return null;
}

/**
 * A label for what made the call: "Chrome on a Windows PC", "the upload command 0.9.1", or a program's
 * name. Null for an AI and for Zaisma: an AI's tool name is its own unchecked claim.
 */
export function deviceFor(userAgent: string, doneBy: DoneBy): string | null {
  if (doneBy === "ai" || doneBy === "zaisma") return null;
  const cli = userAgent.match(/^zaisma-cli\/([0-9][0-9A-Za-z.+-]{0,19})/);
  if (cli) return `the upload command ${cli[1]}`;
  if (/^Mozilla\//.test(userAgent)) {
    const browser = browserName(userAgent);
    const device = deviceName(userAgent);
    if (device === "a device") return browser ?? "A browser";
    const system = `${/^[aeiou]/i.test(device) ? "an" : "a"} ${device}`;
    return `${browser ?? "A browser"} on ${system}`;
  }
  return userAgent.match(/^[A-Za-z][A-Za-z0-9._-]{0,30}(\/[0-9][0-9A-Za-z._-]{0,15})?/)?.[0] ?? "a program";
}

/** A key's place as a fingerprint of the key, the network and the country, so "new place" works without keeping where a key went. Null without both. */
export async function placeSha256For(apiKeyId: string, where: RequestWhere): Promise<string | null> {
  if (where.networkNumber === null || where.countryCode === null) return null;
  return sha256Hex(new TextEncoder().encode(`${apiKeyId}:${where.networkNumber}:${where.countryCode}`));
}

/** The key that folds an event into the hour's row, or null for a kind that isn't folded. */
export function foldKeyFor(kind: SecurityEventKind, gameId: string | null, doneBy: DoneBy, apiKeyId: string | null, nowMs: number): string | null {
  if (!FOLDED_EVENT_KINDS.includes(kind)) return null;
  return `${kind}:${gameId ?? ""}:${doneBy}:${apiKeyId ?? ""}:${Math.floor(nowMs / SECURITY_LOG_LIMITS.foldDurationMs)}`;
}

/** Whether SQL only reads, by its first word once comments are past: SELECT, EXPLAIN or VALUES. WITH, PRAGMA, DDL and writes aren't. */
export function isReadOnlySql(sql: string): boolean {
  let rest = sql;
  for (;;) {
    rest = rest.replace(/^\s+/, "");
    if (rest.startsWith("--")) {
      const lineEndIndex = rest.indexOf("\n");
      rest = lineEndIndex === -1 ? "" : rest.slice(lineEndIndex + 1);
    } else if (rest.startsWith("/*")) {
      const commentEndIndex = rest.indexOf("*/");
      rest = commentEndIndex === -1 ? "" : rest.slice(commentEndIndex + 2);
    } else break;
  }
  return /^(SELECT|EXPLAIN|VALUES)\b/i.test(rest);
}
