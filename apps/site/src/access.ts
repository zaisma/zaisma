import type { Env } from "./env.ts";

/**
 * Admin requests must carry a valid Cloudflare Access token. Checking it here
 * as well as at Cloudflare means a missing or broken Access rule fails closed.
 * Returns the signed-in email, or null.
 */
export async function adminIdentity(request: Request, env: Env): Promise<string | null> {
  const url = new URL(request.url);
  // The local preview only: on this machine, or opened from a phone on its tailnet (a .ts.net name only its own devices reach).
  if (env.DEV_ADMIN === "1" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".ts.net"))) return "dev@localhost";
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const claims = await verifyJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  if (!claims) return null;
  // A service token (the admin MCP) has no email; the token's client ID says which one it was.
  return claims.email ?? (claims.common_name ? `service token ${claims.common_name}` : "access-user");
}

/** A Cloudflare Access token's claims, in the JWT standard's and Cloudflare's own words. */
interface AccessJwtClaims {
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
  email?: string;
  common_name?: string;
}

let certCache: { team: string; fetchedAtMs: number; keys: (JsonWebKey & { kid: string })[] } | null = null;

async function keysFor(team: string): Promise<(JsonWebKey & { kid: string })[]> {
  if (certCache && certCache.team === team && Date.now() - certCache.fetchedAtMs < 10 * 60_000) return certCache.keys;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!response.ok) return [];
  const { keys } = (await response.json()) as { keys: (JsonWebKey & { kid: string })[] };
  certCache = { team, fetchedAtMs: Date.now(), keys };
  return keys;
}

export async function verifyJwt(token: string, team: string, audience: string, keys?: (JsonWebKey & { kid: string })[]): Promise<AccessJwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
  let header: { alg: string; kid: string };
  let claims: AccessJwtClaims;
  try {
    header = JSON.parse(b64urlText(encodedHeader));
    claims = JSON.parse(b64urlText(encodedClaims));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const jwk = (keys ?? (await keysFor(team))).find((candidate) => candidate.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
  if (!ok) return null;

  const nowSec = Date.now() / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) return null;
  if (claims.iss !== `https://${team}`) return null;
  if (!(claims.exp > nowSec) || (claims.nbf && claims.nbf > nowSec + 60)) return null;
  return claims;
}

function b64urlBytes(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function b64urlText(encoded: string): string {
  return new TextDecoder().decode(b64urlBytes(encoded));
}
