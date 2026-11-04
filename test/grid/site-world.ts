import { env } from "cloudflare:test";
import { createApiKey } from "@zaisma/core";
import { everything, KEY_USE_EVENT_KINDS, makeWorld, privateValues, type World } from "../site/access-world.ts";

/**
 * The contract test grid's world on zaisma.com: test/site/access-world.ts's, with sessions, bans and a digest of the
 * owner's things alone, since a caller may change their own.
 */

export const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";

let signingKeys: CryptoKeyPair;
let publicKey: JsonWebKey;

const base64Url = (given: ArrayBuffer | string) =>
  btoa(typeof given === "string" ? given : String.fromCharCode(...new Uint8Array(given)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** What signs and proves the sessions below, as Supabase's public keys answer. Call once for a file, with the fetch beneath it. */
export async function useSessions(): Promise<void> {
  signingKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = (await crypto.subtle.exportKey("jwk", signingKeys.publicKey)) as JsonWebKey;
  const beneath = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "grid-key", alg: "ES256" }] });
    // Supabase's accounts, the email outbox and Cloudflare's check on Play: stand-ins that say yes.
    if (url.origin === SUPABASE || url.hostname === "outbox.test") return Response.json({});
    if (url.hostname === "challenges.cloudflare.com") return Response.json({ success: true });
    return beneath(input, init);
  }) as typeof fetch;
}

/** A session's ID, by the account it's for. */
export const sessionIdOf = (accountId: string) => `session-${accountId}`;

/** The cookies of a session that works, for an account. */
export async function sessionCookie(accountId: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: "grid-key", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({ sub: accountId, session_id: sessionIdOf(accountId), email: "", aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }] }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `__Host-zaisma=${header}.${claims}.${base64Url(signature)}~r-${accountId}; __Host-zaisma_in=1`;
}

/** Runs a call with the account banned in a scope, then lifts the ban. */
export async function whileBanned<Answer>(accountId: string, banScope: "developer" | "whole_account", run: () => Promise<Answer>): Promise<Answer> {
  await env.DB.prepare("UPDATE accounts SET banned_at_ms = 1, ban_scope = ? WHERE id = ?").bind(banScope, accountId).run();
  try {
    return await run();
  } finally {
    await env.DB.prepare("UPDATE accounts SET banned_at_ms = NULL, ban_scope = NULL WHERE id = ?").bind(accountId).run();
  }
}

let tablesToEmpty: string[] = [];

/** The tables with nothing in them before any world, which is everything but what migrations put there. Call once for a file. */
export async function rememberEmptyTables(): Promise<void> {
  const { results: tables } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE 'forum_search%'").all<{ name: string }>();
  const counts = await env.DB.batch(tables.map(({ name }) => env.DB.prepare(`SELECT COUNT(*) AS row_count FROM "${name}"`)));
  tablesToEmpty = tables.filter((_, i) => (counts[i]!.results[0] as { row_count: number }).row_count === 0).map(({ name }) => name);
}

/** Every world's rows and files, whatever a door made, so the next door's digest stays small. */
export async function emptyWorlds(): Promise<void> {
  await env.DB.batch([env.DB.prepare("PRAGMA defer_foreign_keys = ON"), ...tablesToEmpty.map((name) => env.DB.prepare(`DELETE FROM "${name}"`))]);
  for (const bucket of [env.GAMES, env.SAVES]) {
    for (let listed = await bucket.list({ limit: 1000 }); listed.objects.length > 0; listed = await bucket.list({ limit: 1000 })) await bucket.delete(listed.objects.map((object) => object.key));
  }
}

/** The values that name the owner's things, in any table or bucket. Names anyone could use (a screen, an item's name) aren't among them. */
async function ownersMarkers(world: World): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT id FROM games WHERE slug IN (?, ?)").bind(world.values.slug!, world.otherSlug).all<{ id: string }>();
  const shared = new Set(["wide", "phone", "API_TOKEN", "K7Q2MX", "revive", "1"]);
  return [world.victimAccountId, world.victimOwnerId, world.otherSlug, ...results.map((game) => game.id), ...Object.values(world.values).filter((given) => !shared.has(given))];
}

/** A key's row without what its use writes, which even a refused call does. */
const withoutKeyUse = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([column]) => !column.startsWith("last_used_") && column !== "last_place_sha256" && column !== "mcp_first_used_at_ms"));

/** Everything of the owner's a call could change: every row and bucket object naming their things, their keys, and their games' own databases and secrets. */
export async function ownersThings(world: World): Promise<string> {
  const markers = await ownersMarkers(world);
  const mentionsOwner = (line: string) => markers.some((marker) => line.includes(marker));
  const { results: tables } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE 'forum_search%' AND name NOT IN ('security_places') ORDER BY name").all<{ name: string }>();
  const rows = await env.DB.batch(tables.map(({ name }) => env.DB.prepare(name === "security_events" ? `SELECT * FROM security_events WHERE kind NOT IN (${KEY_USE_EVENT_KINDS.map((kind) => `'${kind}'`).join(", ")})` : `SELECT * FROM "${name}"`)));
  const parts = tables.map(({ name }, i) => {
    const lines = rows[i]!.results.map((row) => JSON.stringify(name === "api_keys" ? withoutKeyUse(row as Record<string, unknown>) : row));
    return `${name}: ${lines.filter(mentionsOwner).sort().join("\n")}`;
  });
  for (const bucket of [env.GAMES, env.SAVES]) {
    let cursor: string | undefined;
    do {
      const listed = await bucket.list({ limit: 1000, cursor });
      parts.push(listed.objects.filter((object) => mentionsOwner(object.key)).map((object) => `${object.key} ${object.etag}`).join("\n"));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  for (const slug of [world.values.slug!, world.otherSlug]) {
    const game = await env.DB.prepare("SELECT id FROM games WHERE slug = ?").bind(slug).first<{ id: string }>();
    if (game) parts.push(JSON.stringify(await env.GAME_DATABASES!.exportDump(game.id, null)), JSON.stringify(await env.GAME_SECRETS!.list(game.id)));
  }
  return parts.join("\n\n");
}

/** Whether an answer shows something private to the owner that the caller didn't send it. A key of the owner's own for their other game may see that game and whose it is, but not the first game's things. */
export function showsPrivateValue(world: World & { privateCanaries?: string[] }, answerText: string, sentText: string, callerKnows: readonly string[] = []): boolean {
  return [...privateValues(world), ...(world.privateCanaries ?? [])].some((given) => answerText.includes(given) && !sentText.includes(given) && !callerKnows.includes(given));
}

export const keyWithScope = async (accountId: string, scope: Parameters<typeof createApiKey>[3]) => (await createApiKey(env.DB, accountId, `grid key ${Math.random()}`, scope)).token;

export { everything, makeWorld };
