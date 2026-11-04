const DAY_MS = 86_400_000;
import { HOSTING_PRICES, hostingCostCents, noHostingUse, type HostingKind, type HostingUse } from "./hosting.ts";

/**
 * Real players go last inside each game (docs/DECISIONS.md): traffic from rented servers gets its own share of a game's free
 * time and budget, counting only its own use, and real players the rest, with no extra free time and no gap in the meter.
 * The test reads a network and a few honest signs, never a person: guests give nothing new, and nothing here is kept about one.
 */

/** Cloud and hosting networks, where scripts usually run and few players do. People on a VPN can land here too: that's why a share and not a wall. */
export const HOSTING_NETWORKS: ReadonlySet<number> = new Set([
  16509, 14618, 8987, // Amazon
  15169, 396982, 19527, // Google
  8075, 8068, // Microsoft
  14061, // DigitalOcean
  16276, // OVH
  24940, 213230, // Hetzner
  63949, // Linode (Akamai)
  20473, // Vultr
  31898, // Oracle
  45102, 37963, // Alibaba
  132203, 45090, // Tencent
  51167, // Contabo
  12876, // Scaleway
  60781, 16265, 28753, // Leaseweb
  36352, // ColoCrossing
  9009, // M247
  212238, 60068, // Datacamp, CDN77
  13335, // Cloudflare
]);

/** The internet provider's network number of a connection, or 0 when unknown. */
export function networkNumberOf(request: Request, standIn?: string): number {
  const autonomousSystemNumber = Number(standIn || (request as { cf?: { asn?: unknown } }).cf?.asn);
  return Number.isInteger(autonomousSystemNumber) && autonomousSystemNumber > 0 ? autonomousSystemNumber : 0;
}

/** The share of a game's free time and of its budget rented-server traffic gets. The first month of Beta's measured share sets it. */
export const RENTED_SHARE_PCT = 10;

/** What rented-server traffic may use of a game this month: the free time in force and its budget, in cents. */
export const rentedShareLimitCents = (allowanceCents: number, budgetCents: number | null) => ((allowanceCents + (budgetCents ?? 0)) * RENTED_SHARE_PCT) / 100;

/** The words a player stopped here reads, wherever a game shows an error, and on its Zaisma page. */
export const RENTED_SHARE_TEXT = "This network looks like a server. Turn off your VPN or sign in to keep playing.";

/** How long an account has to be to count on its age alone, and how long ago its first counted play or a browser's first play on a rented network has to be. */
export const HISTORY_ACCOUNT_AGE_DAYS = 7;
export const HISTORY_FIRST_PLAY_AGE_DAYS = 2;
export const RENTED_MARK_AGE_DAYS = 7;

/**
 * Whether an account plays from the 90% on any network: old enough, or it has played before, or it has bought something. A script can't
 * clear any of these within a day or so. Most accounts are old enough, so most cost no read.
 */
export async function accountHasHistory(database: D1Database, account: { id: string; player_id: string; created_at_ms: number }, nowMs = Date.now()): Promise<boolean> {
  if (nowMs - account.created_at_ms >= HISTORY_ACCOUNT_AGE_DAYS * DAY_MS) return true;
  const row = await database
    .prepare(
      `SELECT (SELECT MIN(first_played_at_ms) FROM games_ever_played WHERE account_id = ?1) AS first_played_at_ms,
              EXISTS (SELECT 1 FROM purchases WHERE player_id = ?2 AND purchase_status = 'completed' AND purchase_source = 'sale') AS has_purchase`,
    )
    .bind(account.id, account.player_id)
    .first<{ first_played_at_ms: number | null; has_purchase: number }>();
  return Boolean(row?.has_purchase) || (row?.first_played_at_ms != null && nowMs - row.first_played_at_ms >= HISTORY_FIRST_PLAY_AGE_DAYS * DAY_MS);
}

const encoder = new TextEncoder();

/** A key for one purpose, from a secret the Worker has: no new secret to set, and a play mark's key signs nothing else. */
const keysByPurpose = new Map<string, Promise<CryptoKey>>();
function purposeKey(secret: string, purpose: string): Promise<CryptoKey> {
  const cacheKey = `${purpose}:${secret}`;
  let key = keysByPurpose.get(cacheKey);
  if (!key) {
    key = crypto.subtle.digest("SHA-256", encoder.encode(`zaisma:${purpose}:${secret}`)).then((keyBytes) => crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
    keysByPurpose.set(cacheKey, key);
  }
  return key;
}

let sealingKeyOfSecret: { secret: string; key: Promise<CryptoKey> } | null = null;
function sealingKey(secret: string): Promise<CryptoKey> {
  if (sealingKeyOfSecret?.secret !== secret) {
    sealingKeyOfSecret = { secret, key: crypto.subtle.digest("SHA-256", encoder.encode(`zaisma:play_share:${secret}`)).then((keyBytes) => crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"])) };
  }
  return sealingKeyOfSecret.key;
}

const toBase64Url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function signed(secret: string, purpose: string, parts: string): Promise<string> {
  return `${parts}.${toBase64Url(await crypto.subtle.sign("HMAC", await purposeKey(secret, purpose), encoder.encode(parts)))}`;
}

/** The parts a token signed for this purpose carries, or null for one that wasn't. */
async function signedParts(secret: string, purpose: string, token: unknown): Promise<string[] | null> {
  if (typeof token !== "string" || token.length > 400) return null;
  const cutAt = token.lastIndexOf(".");
  if (cutAt < 1) return null;
  const signature = fromBase64Url(token.slice(cutAt + 1));
  if (!signature) return null;
  const parts = token.slice(0, cutAt);
  return (await crypto.subtle.verify("HMAC", await purposeKey(secret, purpose), signature, encoder.encode(parts))) ? parts.split(".") : null;
}

/**
 * A browser's first play of a game, signed so it can't be claimed: its date, and whether that play was off rented networks. It
 * lives only in the browser, Zaisma keeps nothing of it, and it says nothing but the date: no device, no person.
 */
export const signPlayMark = (secret: string, gameId: string, firstPlayDate: string, isOffRentedNetworks: boolean) => signed(secret, "play_mark", `${gameId}.${firstPlayDate}.${isOffRentedNetworks ? 1 : 0}`);

/** Whether a browser's mark says it played this game before, as it counts for the 90%: at once when made off rented networks, after a week when made on one. */
export async function isReturningBrowser(secret: string, gameId: string, mark: unknown, nowMs = Date.now()): Promise<boolean> {
  const parts = await signedParts(secret, "play_mark", mark);
  if (!parts || parts.length !== 3 || parts[0] !== gameId) return false;
  const firstPlayMs = Date.parse(parts[1]!);
  if (!Number.isFinite(firstPlayMs) || firstPlayMs > nowMs) return false;
  return parts[2] === "1" || nowMs - firstPlayMs >= RENTED_MARK_AGE_DAYS * DAY_MS;
}

/** What a pass's playShare says, which is never in the pass: games and their own servers see a player as a stranger would. */
export interface PlayShare {
  /** An account with history, or a browser that played this game before: plays from the 90% on any network. */
  isInRealShare: boolean;
  /** Played this game before, for where a game's hours went. */
  isReturningPlayer: boolean;
}

/** Sealed for one player of one game, for as long as their pass: the SDK and the game hold it and can't read it, since games see a player as a stranger would. Only rooms open it. */
export async function sealPlayShare(secret: string, playerId: string, gameSlug: string, share: PlayShare, expiresAtSec: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`${playerId}:${gameSlug}`) }, await sealingKey(secret), encoder.encode(`${share.isInRealShare ? 1 : 0}.${share.isReturningPlayer ? 1 : 0}.${expiresAtSec}`));
  return `${toBase64Url(iv.buffer)}.${toBase64Url(sealed)}`;
}

/** A playShare's facts for this player of this game; a missing or forged one counts for nothing, so all it can do is leave a player to their network. */
export async function readPlayShare(secret: string, playerId: string, gameSlug: string, token: unknown, nowSec = Math.floor(Date.now() / 1000)): Promise<PlayShare> {
  const nothing = { isInRealShare: false, isReturningPlayer: false };
  if (typeof token !== "string" || token.length > 400) return nothing;
  const [ivText, sealedText] = token.split(".");
  const iv = ivText ? fromBase64Url(ivText) : null;
  const sealed = sealedText ? fromBase64Url(sealedText) : null;
  if (!iv || !sealed || iv.length !== 12) return nothing;
  try {
    const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(`${playerId}:${gameSlug}`) }, await sealingKey(secret), sealed);
    const [inRealShare, returningPlayer, expiresAtSec] = new TextDecoder().decode(opened).split(".");
    return Number(expiresAtSec) > nowSec ? { isInRealShare: inRealShare === "1", isReturningPlayer: returningPlayer === "1" } : nothing;
  } catch {
    return nothing;
  }
}

/** What a client says about itself: no input and no graphics chip, together, on any network. One sign alone doesn't count, and a script can fake both: the network and the meter are the backstop. */
export const hasAutomationSigns = (given: { hasGraphicsChip?: unknown; isInputSeen?: unknown }) => given.hasGraphicsChip === false && given.isInputSeen === false;

/** Who plays from the rented share: anyone on a rented network without history, and anyone at all showing both signs. */
export const isOnRentedShare = (isRentedNetwork: boolean, share: Pick<PlayShare, "isInRealShare">, signs: { hasGraphicsChip?: unknown; isInputSeen?: unknown }) => (isRentedNetwork && !share.isInRealShare) || hasAutomationSigns(signs);

/** What a room's use since it last recorded it comes to for its players on the rented share: their own messages and connections, and their part of its time awake and game server, by their part of its play. */
export function rentedShareOfRoomCents(
  use: Pick<HostingUse, "roomAwakeDurationSec" | "objectRequestCount" | "bookkeepingWrittenRowCount" | "roomCpuDurationMs" | "startupCpuDurationMs" | "gameServerSessionCount" | "logFileCount">,
  rented: { playFraction: number; messageCount: number; connectionCount: number },
): number {
  const shared = hostingCostCents({ ...noHostingUse(), ...use });
  const sharedCents = shared.kinds.rooms + shared.kinds.game_server;
  return sharedCents * rented.playFraction + rented.messageCount * HOSTING_PRICES.inboundMessageCentsPerMessage + rented.connectionCount * HOSTING_PRICES.roomConnectionCentsPerConnection;
}

/**
 * What rented-server traffic used of a game this month: its rooms as they recorded it, its requests and relayed data by its part of each, and the
 * game database by its part of the rooms and requests. Storage is never in it: a game's storage is the game's, whoever plays.
 */
export function rentedShareUsedCents(kinds: Record<HostingKind, number>, use: Pick<HostingUse, "monthStoredSizeBytes" | "requestCount" | "scheduledRunCount">, rented: { roomUseCents: number; requestCount: number; relayCredentialCount: number; relayCredentialTotalCount: number }): number {
  const allRequestCount = use.requestCount + use.scheduledRunCount;
  const requestsCents = allRequestCount > 0 ? kinds.requests * Math.min(1, rented.requestCount / allRequestCount) : 0;
  const relayedCents = rented.relayCredentialTotalCount > 0 ? kinds.relayed_data * Math.min(1, rented.relayCredentialCount / rented.relayCredentialTotalCount) : 0;
  const playedCents = kinds.rooms + kinds.requests + kinds.game_server;
  const databaseCents = Math.max(0, kinds.database - use.monthStoredSizeBytes * HOSTING_PRICES.storedCentsPerByteMonth);
  const databaseShare = playedCents > 0 ? Math.min(1, (rented.roomUseCents + requestsCents) / playedCents) : 0;
  return rented.roomUseCents + requestsCents + relayedCents + databaseCents * databaseShare;
}

