import { NO_WHERE, apiKeysFor, iso, keyAccess, turnOffLeakedKey, type ApiKey, type KeyFoundIn } from "@zaisma/core";
import type { Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { logSecurityEvent, whereText } from "./security-log.ts";

/**
 * Keys that turn off by themselves (docs/DECISIONS.md, "Leaked keys turn off by themselves."): a key found in
 * public stops working for good. GitHub's secret scanning tells us about keys pushed to public places, and we
 * look in uploaded game files and forum posts ourselves. Only a token that matches a key's whole secret turns
 * it off, never the shape alone.
 */

const MAXIMUM_GITHUB_BODY_SIZE_BYTES = 1024 * 1024;
const GITHUB_PUBLIC_KEYS_URL = "https://api.github.com/meta/public_keys/secret_scanning";
const PUBLIC_KEY_CACHE_MS = 3600_000;
/** GitHub's name for our token type in its secret scanning feedback. */
const TOKEN_TYPE = "zaisma_api_key";

export interface FoundWhere {
  foundIn: KeyFoundIn;
  foundAtUrl: string | null;
}

/** A day as the account page words it: 2026-10-18. */
export const dayText = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Where a turned-off key was found, in plain words: "found in public at github.com/sam/space-game". */
export function foundWords(key: Pick<ApiKey, "found_in" | "found_at_url">): string {
  const address = key.found_at_url?.replace(/^https?:\/\//, "") ?? null;
  if (key.found_in === "github") return address ? `found in public at ${address}` : "found in public on GitHub";
  if (key.found_in === "game_files") return "found in a game's files uploaded to Zaisma";
  if (key.found_in === "forum_post") return address ? `found in a forum post at ${address}` : "found in a forum post";
  return "found in public";
}

/**
 * Turn off every key a token is, and log it in the key's owner's Activity. Answers each token with whether
 * it was a real key (turned off now, or already off), so callers can tell a look-alike from a leak.
 */
export async function turnOffLeakedKeys(env: Env, tokens: string[], found: FoundWhere): Promise<{ token: string; isKey: boolean }[]> {
  const answers: { token: string; isKey: boolean }[] = [];
  for (const token of tokens) {
    let turnedOff: Awaited<ReturnType<typeof turnOffLeakedKey>> = null;
    try {
      turnedOff = await turnOffLeakedKey(env.DB, token, found);
    } catch (error) {
      console.error("Leaked key not turned off", error);
    }
    answers.push({ token, isKey: turnedOff !== null });
    if (!turnedOff?.isNewlyTurnedOff) continue;
    await logSecurityEvent(env, {
      accountId: turnedOff.key.account_id,
      gameId: null,
      kind: "api_key_turned_off",
      doneBy: "zaisma",
      apiKeyId: turnedOff.key.id,
      apiKeyName: turnedOff.key.name,
      signInKind: null,
      versionId: null,
      subjectName: turnedOff.key.name,
      where: NO_WHERE,
      isWhereKept: false,
      isNewPlace: false,
    });
  }
  return answers;
}

/** GET /api/dev/api-keys: every key on the account, newest first. No key's ID is given out. */
export async function apiKeysAnswer(env: Env, caller: Caller) {
  const keys = (await apiKeysFor(env.DB, caller.accountId)).reverse();
  return {
    api_keys: keys.map((key) => ({
      api_key_name: key.name,
      kind: key.kind,
      connected_app_host: key.connected_app_host,
      access_level: key.access_level,
      area_access: keyAccess(key).areaAccess,
      game_slugs: keyAccess(key).gameSlugs,
      created_at: iso(key.created_at_ms),
      last_used_at: key.last_used_at_ms === null ? null : iso(key.last_used_at_ms),
      last_used_where:
        whereText({ device: key.last_used_device, network_name: key.last_used_network_name, city_name: key.last_used_city_name, region_name: key.last_used_region_name, country_code: key.last_used_country_code }) || null,
      ends_at: key.ends_at_ms === null ? null : iso(key.ends_at_ms),
      turned_off_at: key.turned_off_at_ms === null ? null : iso(key.turned_off_at_ms),
      found_in: key.found_in,
      found_at_url: key.found_at_url,
      is_this_key: key.id === caller.access.apiKeyId,
    })),
  };
}

// --- GitHub's secret scanning ------------------------------------------------------

interface GithubPublicKey {
  key_identifier: string;
  key: string;
  is_current: boolean;
}

let cachedPublicKeys: { keys: GithubPublicKey[]; fetchedAtMs: number } | null = null;

/** GitHub's public keys, from the last hour's copy; null when GitHub can't be reached. */
async function githubPublicKeys(isFresh: boolean): Promise<GithubPublicKey[] | null> {
  if (!isFresh && cachedPublicKeys && Date.now() - cachedPublicKeys.fetchedAtMs < PUBLIC_KEY_CACHE_MS) return cachedPublicKeys.keys;
  try {
    const response = await fetch(GITHUB_PUBLIC_KEYS_URL, { headers: { "user-agent": "zaisma.com", accept: "application/json" } });
    if (!response.ok) return null;
    const listed = (await response.json()) as { public_keys?: GithubPublicKey[] };
    if (!Array.isArray(listed.public_keys)) return null;
    cachedPublicKeys = { keys: listed.public_keys, fetchedAtMs: Date.now() };
    return listed.public_keys;
  } catch {
    return null;
  }
}

/** An ECDSA signature as ASN.1 DER (SEQUENCE { r INTEGER, s INTEGER }) to the 64 bytes r‖s that WebCrypto takes; null when it isn't one. */
export function derToRawEcdsaSignature(der: Uint8Array): Uint8Array | null {
  let readIndex = 0;
  const readSizeBytes = (): number | null => {
    const leadByteNumber = der[readIndex++];
    if (leadByteNumber === undefined) return null;
    if (leadByteNumber < 0x80) return leadByteNumber;
    const sizeByteCount = leadByteNumber & 0x7f;
    if (sizeByteCount === 0 || sizeByteCount > 2) return null;
    let sizeBytes = 0;
    for (let i = 0; i < sizeByteCount; i++) {
      const nextByteNumber = der[readIndex++];
      if (nextByteNumber === undefined) return null;
      sizeBytes = sizeBytes * 256 + nextByteNumber;
    }
    return sizeBytes;
  };
  if (der[readIndex++] !== 0x30) return null;
  const sequenceSizeBytes = readSizeBytes();
  if (sequenceSizeBytes === null || readIndex + sequenceSizeBytes !== der.length) return null;
  const raw = new Uint8Array(64);
  for (let halfIndex = 0; halfIndex < 2; halfIndex++) {
    if (der[readIndex++] !== 0x02) return null;
    const integerSizeBytes = readSizeBytes();
    if (integerSizeBytes === null || integerSizeBytes === 0 || readIndex + integerSizeBytes > der.length) return null;
    let integer = der.slice(readIndex, readIndex + integerSizeBytes);
    readIndex += integerSizeBytes;
    while (integer.length > 1 && integer[0] === 0) integer = integer.slice(1);
    if (integer.length > 32) return null;
    raw.set(integer, halfIndex * 32 + (32 - integer.length));
  }
  return readIndex === der.length ? raw : null;
}

function bytesFromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text.trim()), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function isSignedByGithub(body: Uint8Array, keyIdentifier: string, signature: string): Promise<"yes" | "no" | "unreachable"> {
  let keys = await githubPublicKeys(false);
  if (!keys) return "unreachable";
  let publicKey = keys.find((each) => each.key_identifier === keyIdentifier);
  if (!publicKey) {
    keys = await githubPublicKeys(true);
    if (!keys) return "unreachable";
    publicKey = keys.find((each) => each.key_identifier === keyIdentifier);
  }
  if (!publicKey) return "no";
  const der = bytesFromBase64(signature);
  const raw = der && derToRawEcdsaSignature(der);
  const pemBody = publicKey.key.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  const keyBytes = bytesFromBase64(pemBody);
  if (!raw || !keyBytes) return "no";
  try {
    const imported = await crypto.subtle.importKey("spki", keyBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, imported, raw, body)) ? "yes" : "no";
  } catch {
    return "no";
  }
}

/**
 * POST /github/secret-scanning: GitHub tells us about tokens of ours it found in public. The signature is checked
 * over the raw body before anything is read from the database. Answers GitHub's feedback list: a label for each token.
 */
export async function handleGithubSecretScanning(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  const keyIdentifier = request.headers.get("github-public-key-identifier");
  const signature = request.headers.get("github-public-key-signature");
  if (!keyIdentifier || !signature) return new Response("Unauthorized", { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAXIMUM_GITHUB_BODY_SIZE_BYTES) return new Response("Payload too large", { status: 413 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAXIMUM_GITHUB_BODY_SIZE_BYTES) return new Response("Payload too large", { status: 413 });
  const signed = await isSignedByGithub(body, keyIdentifier, signature);
  if (signed === "unreachable") return new Response("Can't check the signature right now", { status: 503 });
  if (signed === "no") return new Response("Unauthorized", { status: 401 });
  let matches: unknown;
  try {
    matches = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!Array.isArray(matches)) return new Response("Bad request", { status: 400 });
  const feedback: { token_raw: string; token_type: string; label: "true_positive" | "false_positive" }[] = [];
  for (const match of matches) {
    const { token, url } = (match ?? {}) as { token?: unknown; url?: unknown };
    if (typeof token !== "string") continue;
    const [answer] = await turnOffLeakedKeys(env, [token], { foundIn: "github", foundAtUrl: typeof url === "string" && url.trim() ? url.trim().slice(0, 500) : null });
    feedback.push({ token_raw: token, token_type: TOKEN_TYPE, label: answer?.isKey ? "true_positive" : "false_positive" });
  }
  return Response.json(feedback, { headers: { "Cache-Control": "no-store" } });
}
