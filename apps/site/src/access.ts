import type { Env } from "./env.ts";

/**
 * Admin requests must carry a valid Cloudflare Access token. Checking it here
 * as well as at Cloudflare means a missing or broken Access rule fails closed.
 * Returns the signed-in email, or null.
 */
export async function adminIdentity(request: Request, env: Env): Promise<string | null> {
  const url = new URL(request.url);
  if (env.DEV_ADMIN === "1" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return "dev@localhost";
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const claims = await verifyJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  if (!claims) return null;
  // A service token (the admin MCP) has no email; the token's client ID says which one it was.
  return claims.email ?? (claims.common_name ? `service token ${claims.common_name}` : "access-user");
}

interface Claims {
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
  email?: string;
  common_name?: string;
}

let certCache: { team: string; at: number; keys: (JsonWebKey & { kid: string })[] } | null = null;

async function keysFor(team: string): Promise<(JsonWebKey & { kid: string })[]> {
  if (certCache && certCache.team === team && Date.now() - certCache.at < 10 * 60_000) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) return [];
  const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
  certCache = { team, at: Date.now(), keys };
  return keys;
}

export async function verifyJwt(token: string, team: string, aud: string, keys?: (JsonWebKey & { kid: string })[]): Promise<Claims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: { alg: string; kid: string };
  let claims: Claims;
  try {
    header = JSON.parse(b64urlText(h));
    claims = JSON.parse(b64urlText(p));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const jwk = (keys ?? (await keysFor(team))).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;

  const now = Date.now() / 1000;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) return null;
  if (claims.iss !== `https://${team}`) return null;
  if (!(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) return null;
  return claims;
}

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlText(s: string): string {
  return new TextDecoder().decode(b64urlBytes(s));
}
