// A stand-in for a developer's own site that uses Sign in with Zaisma, for local previews only:
// "Sky Hopper Online", a confidential app written with no libraries, so the whole flow can be tried
// by hand: its button, Zaisma's consent page, and back here signed in. It checks the ID token's
// signature against Zaisma's published key, as any OpenID Connect library would.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

const [port, site, clientId, clientSecret] = process.argv.slice(2);
const here = `http://localhost:${port}`;
const callback = `${here}/callback`;
const started = new Map(); // state -> { verifier, nonce }

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const escape = (text) => String(text).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const page = (body) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sky Hopper Online</title>
<style>body{font:16px/1.5 system-ui;background:#f4f1ea;color:#222;max-width:560px;margin:60px auto;padding:0 16px}a.button{display:inline-block;background:#222;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none}code{background:#e6e1d6;padding:2px 6px;border-radius:4px}.note{color:#666;font-size:14px}</style>
<h1>Sky Hopper Online</h1>${body}<p class="note">A stand-in for a developer's own site, only in the local preview.</p>`;

async function idTokenClaims(idToken) {
  const [header, body, signature] = idToken.split(".");
  const { kid } = JSON.parse(Buffer.from(header, "base64url"));
  const { keys } = await (await fetch(`${site}/.well-known/jwks.json`)).json();
  const jwk = keys.find((candidate) => candidate.kid === kid);
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const isSigned = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${body}`));
  if (!isSigned) throw new Error("The ID token's signature is wrong.");
  return JSON.parse(Buffer.from(body, "base64url"));
}

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, here);
    const send = (body, status = 200) => response.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(page(body));
    if (url.pathname === "/") return send(`<p>Play with your Zaisma account: we only get your player ID and name.</p><p><a class="button" href="/start">Sign in with Zaisma</a></p>`);
    if (url.pathname === "/start") {
      const state = b64url(randomBytes(16));
      const verifier = b64url(randomBytes(32));
      const nonce = b64url(randomBytes(16));
      started.set(state, { verifier, nonce });
      const challenge = b64url(createHash("sha256").update(verifier).digest());
      const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: callback, scope: "openid profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256" });
      return response.writeHead(302, { location: `${site}/oauth/authorize?${query}` }).end();
    }
    if (url.pathname === "/callback") {
      const back = started.get(url.searchParams.get("state") ?? "");
      started.delete(url.searchParams.get("state") ?? "");
      if (url.searchParams.get("error")) return send(`<p>Not signed in: <code>${escape(url.searchParams.get("error"))}</code>. ${escape(url.searchParams.get("error_description") ?? "")}</p><p><a class="button" href="/start">Try again</a></p>`, 400);
      if (!back) return send(`<p>That sign-in isn't one this site started.</p><p><a class="button" href="/">Start over</a></p>`, 400);
      try {
        const tokenResponse = await fetch(`${site}/oauth/token`, {
          method: "POST",
          headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code") ?? "", redirect_uri: callback, code_verifier: back.verifier }),
        });
        const tokens = await tokenResponse.json();
        if (!tokenResponse.ok) throw new Error(`${tokens.error}: ${tokens.error_description}`);
        const claims = await idTokenClaims(tokens.id_token);
        if (claims.nonce !== back.nonce) throw new Error("The nonce doesn't match.");
        return send(`<p>Signed in as <strong>${escape(claims.name)}</strong>.</p><p>Player ID <code>${escape(claims.sub)}</code>, the same one Zaisma's games see.</p><p><a class="button" href="/">Back to the start</a></p>`);
      } catch (error) {
        return send(`<p>Sign-in failed: ${escape(error.message)}</p><p><a class="button" href="/start">Try again</a></p>`, 502);
      }
    }
    send("<p>Nothing here.</p>", 404);
  })
  .listen(Number(port));
