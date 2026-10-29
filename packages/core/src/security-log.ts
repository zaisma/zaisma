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
  credit_top_up_started: "Started a credit top-up",
  credit_refunded: "Refunded hosting credit",
  automatic_top_up_changed: "Changed automatic top-up",
  pro_checkout_started: "Started Zaisma Pro",
  pro_cancelled: "Cancelled Zaisma Pro",
  pro_resumed: "Took back cancelling Zaisma Pro",
  pro_refunded: "Refunded Zaisma Pro's first payment",
  stripe_account_connected: "Connected a Stripe account for sales",
  stripe_account_changed: "Turned Stripe Tax on or off",
  stripe_account_disconnected: "Disconnected the Stripe account sales go to",
  account_data_downloaded: "Downloaded your data",
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
  shader_added: "Added a background shader",
  shader_removed: "Removed a background shader",
  background_chosen: "Chose a background",
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
  kept_room_deleted: "Deleted a kept room",
  hosting_budget_changed: "Changed the game's hosting budget",
  item_changed: "Set an item",
  item_removed: "Removed an item",
  purchase_settings_changed: "Changed the refund policy or what the game sells itself",
  purchase_granted: "Granted an item to a player",
  purchase_refunded: "Refunded a purchase",
  database_written: "Changed the database with SQL",
  database_imported: "Imported into the database",
  database_exported: "Exported the database",
  database_restored: "Restored the database to an earlier time",
  database_restore_undone: "Undid a database restore",
  saves_read: "Read a player's save",
  save_changed: "Changed a player's save",
  game_exported: "Exported everything about the game",
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
  "account_data_downloaded",
  "credit_top_up_started",
  "credit_refunded",
  "automatic_top_up_changed",
  "pro_checkout_started",
  "pro_cancelled",
  "pro_resumed",
  "pro_refunded",
  "stripe_account_connected",
  "stripe_account_changed",
  "stripe_account_disconnected",
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
  "shader_added",
  "shader_removed",
  "background_chosen",
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
  "kept_room_deleted",
  "hosting_budget_changed",
  "item_changed",
  "item_removed",
  "purchase_settings_changed",
  "purchase_granted",
  "purchase_refunded",
  "database_written",
  "database_imported",
  "database_restored",
  "database_restore_undone",
  "save_changed",
  // It takes every player's save and the whole database out, so who did it, and from where, is kept.
  "game_exported",
  // It takes everything about the account out, the same way.
  "account_data_downloaded",
  // Money: who started or changed spending, and from where.
  "credit_top_up_started",
  "credit_refunded",
  "automatic_top_up_changed",
  "pro_checkout_started",
  "pro_cancelled",
  "pro_resumed",
  "pro_refunded",
  "stripe_account_connected",
  "stripe_account_changed",
  "stripe_account_disconnected",
  "webhook_created",
  "webhook_changed",
  "webhook_deleted",
  "sign_in_app_created",
  "sign_in_app_changed",
  "sign_in_app_deleted",
];

/** Uploads keep their address for 90 days whether or not the account keeps where it's used from. */
export const ALWAYS_ADDRESS_KEEPING_EVENT_KINDS: readonly SecurityEventKind[] = ["version_uploaded", "image_added", "image_refused", "shader_added"];

export const SECURITY_LOG_LIMITS = {
  keptDurationDays: 90,
  activityPageEventCount: 50,
  accountPageEventCount: 10,
  gameHistoryEventCount: 100,
  foldDurationMs: 3_600_000,
  maximumWhereCharacterCount: 60,
  /** Alert emails to one account an hour; past it, alerts wait on its pages, so a key used from many places can't flood an inbox. */
  maximumAlertEmailCountPerHour: 10,
  /** How many unseen security alerts get_activity answers, and the pages show. */
  unseenAlertCount: 10,
} as const;

// --- Security alerts ---------------------------------------------------------------

/**
 * The risky moments the owner hears about (docs/DECISIONS.md, "The security log says who did what from where, and
 * the owner hears about the risky moments"): an email, or with none, the account page and dashboard until seen.
 */
export const SECURITY_ALERT_STATUSES = ["emailed", "unseen", "seen"] as const;
export type SecurityAlertStatus = (typeof SECURITY_ALERT_STATUSES)[number];

/** What each alert's email says: its subject, and what to do when it wasn't them. */
export const SECURITY_ALERT_WORDS = {
  signed_in_new_device: { subject: "New sign-in to your Zaisma account", ifNotYou: "change your password" },
  password_added: { subject: "A password was added to your Zaisma account", ifNotYou: "change your password" },
  password_changed: { subject: "Your Zaisma password was changed", ifNotYou: "change your password" },
  email_added: { subject: "An email was added to your Zaisma account", ifNotYou: "change your password" },
  email_changed: { subject: "Your Zaisma email was changed", ifNotYou: "change your password" },
  email_removed: { subject: "The email was removed from your Zaisma account", ifNotYou: "change your password" },
  passkey_removed: { subject: "A passkey was removed from your Zaisma account", ifNotYou: "change your password" },
  api_key_created: { subject: "A new API key was made on your Zaisma account", ifNotYou: "remove the key under Game developers and change your password" },
  api_key_new_place: { subject: "Your Zaisma API key was used from a new place", ifNotYou: "remove the key under Game developers and change your password" },
  api_key_turned_off: { subject: "Zaisma turned off one of your API keys", ifNotYou: "make a new key under Game developers, and keep it out of public places" },
  ai_connected: { subject: "An AI was connected to your Zaisma account", ifNotYou: "remove the key under Game developers and change your password" },
  connected_app_added: { subject: "An app was connected to your Zaisma account", ifNotYou: "remove the app under Game developers and change your password" },
  account_data_downloaded: { subject: "Your Zaisma data was downloaded", ifNotYou: "sign out on every device and change your password" },
  stripe_account_connected: { subject: "A Stripe account was connected to your Zaisma games", ifNotYou: "disconnect it under Game developers and change your password" },
  connected_app_removed: { subject: "Zaisma disconnected an app from your account", ifNotYou: "connect the app again, and change your password" },
} as const satisfies Partial<Record<SecurityEventKind, { subject: string; ifNotYou: string }>>;
export type SecurityAlertKind = keyof typeof SECURITY_ALERT_WORDS;

/** The kinds that are always an alert. A new-device sign-in is one only from a new network; a removed app only when Zaisma removed it. */
export const SECURITY_ALERT_EVENT_KINDS: readonly SecurityEventKind[] = [
  "password_added",
  "password_changed",
  "email_added",
  "email_changed",
  "email_removed",
  "passkey_removed",
  "api_key_created",
  "api_key_new_place",
  "api_key_turned_off",
  "ai_connected",
  "connected_app_added",
  "account_data_downloaded",
  "stripe_account_connected",
];

/** Whether an event is a security alert. isNewPlace: for a sign-in, from a network the account hasn't used. */
export function isSecurityAlert(kind: SecurityEventKind, doneBy: DoneBy, isNewPlace: boolean): kind is SecurityAlertKind {
  if (kind === "signed_in_new_device") return isNewPlace;
  // A connection Zaisma cut off, because its refresh token was used twice: a stolen copy.
  if (kind === "connected_app_removed") return doneBy === "zaisma";
  return SECURITY_ALERT_EVENT_KINDS.includes(kind);
}

// --- Spikes across Zaisma ----------------------------------------------------------

/**
 * Counts per clock hour that alert Julius when one reaches its threshold, from one network or across Zaisma
 * (network_number 0). Database exports bunch at midnight, when CI runs, so theirs is high.
 */
export const SPIKE_THRESHOLDS = {
  wrong_passwords_from_network: 100,
  new_device_sign_ins_from_network: 50,
  api_keys_created: 100,
  databases_exported: 500,
  scripts_blocked: 500,
} as const;
export type SpikeKind = keyof typeof SPIKE_THRESHOLDS;
export const SPIKE_KINDS = Object.keys(SPIKE_THRESHOLDS) as SpikeKind[];
export const SPIKE_WORDS: Record<SpikeKind, string> = {
  wrong_passwords_from_network: "wrong passwords",
  new_device_sign_ins_from_network: "sign-ins on new devices",
  api_keys_created: "API keys made",
  databases_exported: "databases exported",
  scripts_blocked: "scripts blocked on zaisma.com",
};
export const ACROSS_ZAISMA_NETWORK_NUMBER = 0;
/** Spikes and blocked scripts are kept this long. */
export const SECURITY_SIGNAL_KEPT_DURATION_DAYS = 30;

// --- Script policy reports ---------------------------------------------------------

export interface BlockedScript {
  violatedDirective: string;
  blockedSource: string;
  pagePath: string;
}

const EXTENSION_SCHEMES = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i;
const KEYWORD_SOURCES = new Set(["inline", "eval", "wasm-eval", "data", "blob", "self", "trusted-types-policy", "trusted-types-sink"]);

/**
 * One script policy violation report, as browsers send it: the old {"csp-report": {…}} body or one
 * {type: "csp-violation", body: {…}} item of a reports+json list. What's kept: the directive, the blocked
 * source as a keyword or an origin (never a path or query), and the page's path. Null for a browser
 * extension's (extensions break page policies all day, and say nothing about Zaisma) or anything else.
 */
export function cleanBlockedScriptReport(report: unknown): BlockedScript | null {
  if (!report || typeof report !== "object") return null;
  const given = report as Record<string, unknown>;
  let fields: Record<string, unknown>;
  if (given["csp-report"] && typeof given["csp-report"] === "object") {
    const old = given["csp-report"] as Record<string, unknown>;
    fields = { directive: old["effective-directive"] ?? old["violated-directive"], blocked: old["blocked-uri"], page: old["document-uri"], source: old["source-file"] };
  } else if (given.type === "csp-violation" && given.body && typeof given.body === "object") {
    const body = given.body as Record<string, unknown>;
    fields = { directive: body.effectiveDirective, blocked: body.blockedURL, page: body.documentURL ?? given.url, source: body.sourceFile };
  } else return null;
  if (typeof fields.directive !== "string" || typeof fields.page !== "string") return null;
  const blocked = typeof fields.blocked === "string" ? fields.blocked.trim() : "";
  if (EXTENSION_SCHEMES.test(blocked) || (typeof fields.source === "string" && EXTENSION_SCHEMES.test(fields.source))) return null;
  const violatedDirective = fields.directive.trim().split(/\s+/)[0]!.toLowerCase();
  if (!/^[a-z-]{1,40}$/.test(violatedDirective)) return null;
  let pagePath: string;
  try {
    pagePath = new URL(fields.page).pathname.slice(0, 200);
  } catch {
    return null;
  }
  let blockedSource: string;
  if (blocked === "" || KEYWORD_SOURCES.has(blocked.toLowerCase())) blockedSource = blocked.toLowerCase() || "inline";
  else {
    try {
      const url = new URL(blocked);
      blockedSource = (url.origin === "null" ? url.protocol.replace(/:$/, "") : url.origin).slice(0, 100);
    } catch {
      return null;
    }
  }
  return { violatedDirective, blockedSource, pagePath };
}

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
