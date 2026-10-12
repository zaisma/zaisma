import {
  MAX_PASSKEYS,
  PASSKEY_ALGS,
  accountById,
  addPasskey,
  b64url,
  checkNewPasskey,
  checkPasskeyUse,
  deviceName,
  newChallenge,
  passkeyById,
  passkeysFor,
  removePasskey,
  usedPasskey,
} from "@zaisma/core";
import { currentSession, readCookie, sendCode, sessionCookies, sessionForUser, setCookie } from "./auth.ts";
import { codePage } from "./account.ts";
import type { Env } from "./env.ts";

/**
 * Passkeys: sign back in with Face ID, a fingerprint or a device PIN. We check them ourselves
 * (packages/core/src/webauthn.ts); Supabase still makes the session. New accounts and lost
 * devices use the email code, as before.
 *
 *   POST /api/passkeys/signin/options   a challenge for signing in
 *   POST /api/passkeys/signin           { id, clientDataJSON, authenticatorData, signature, next }
 *   POST /api/passkeys/add/options      what the browser needs to make one (signed in, recently)
 *   POST /api/passkeys/add              { id, clientDataJSON, authenticatorData, publicKey, alg }
 *   POST /account/passkeys/confirm      email a code first, when the last sign-in was a while ago
 *   POST /account/passkeys/:id/remove
 *
 * Adding a passkey needs a sign-in in the last 10 minutes, so a stolen session cookie can't
 * add a way back in.
 */
export const RECENT_SIGNIN_MS = 10 * 60_000;
const CHALLENGE_SECONDS = 300;

export async function handlePasskeys(request: Request, env: Env, path: string): Promise<Response | null> {
  const remove = path.match(/^\/account\/passkeys\/([A-Za-z0-9_-]{1,400})\/remove$/);
  if (!path.startsWith("/api/passkeys/") && path !== "/account/passkeys/confirm" && !remove) return null;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  // Only our own pages.
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });

  const json = (body: unknown, status = 200, cookies: string[] = []) => {
    const res = Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    for (const c of cookies) res.headers.append("Set-Cookie", c);
    return res;
  };
  const rpId = new URL(env.SITE_ORIGIN).hostname;
  const want = (challenge: string) => ({ challenge, origin: env.SITE_ORIGIN, rpId });
  // The challenge lives in a short cookie, for one use, tied to what it's for.
  const challengeCookie = (purpose: string, challenge: string) => setCookie(env, "zaisma_pk", `${purpose}.${challenge}`, { maxAge: CHALLENGE_SECONDS });
  const takeChallenge = (purpose: string) => {
    const [p, c] = (readCookie(request, env, "zaisma_pk") ?? "").split(".");
    return p === purpose && c ? c : null;
  };
  const used = setCookie(env, "zaisma_pk", "", { maxAge: 0 });

  if (path === "/api/passkeys/signin/options") {
    const challenge = newChallenge();
    return json({ challenge, rpId }, 200, [challengeCookie("in", challenge)]);
  }

  if (path === "/api/passkeys/signin") {
    if (env.SIGNIN_LIMIT && !(await env.SIGNIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success) return json({ error: "Too many tries. Wait a minute and try again." }, 429);
    const challenge = takeChallenge("in");
    const body = await readJson(request);
    const key = challenge && typeof body.id === "string" ? await passkeyById(env.DB, body.id) : null;
    const checked = key ? await checkPasskeyUse({ clientDataJSON: str(body.clientDataJSON), authenticatorData: str(body.authenticatorData), signature: str(body.signature) }, { publicKey: key.public_key, alg: key.alg, signCount: key.sign_count }, want(challenge!)) : null;
    // The passkey's user handle, when sent, is the account it was made for.
    if (!key || !checked || (typeof body.userHandle === "string" && body.userHandle && body.userHandle !== b64url(new TextEncoder().encode(key.account_id)))) {
      return json({ error: "That passkey didn't work. It may have been removed from your account. Sign in with an email code instead." }, 400, [used]);
    }
    const session = await sessionForUser(env, key.account_id);
    if (!session) return json({ error: "Couldn't sign you in. Try again, or use an email code." }, 502, [used]);
    await usedPasskey(env.DB, key.id, checked.signCount);
    return json({ next: safeNext(body.next) ?? "/" }, 200, [used, ...sessionCookies(env, session)]);
  }

  // --- Signed in from here on ---
  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  if (!session || !account) return json({ error: "Sign in first." }, 401);
  const recent = Date.now() - session.authAt < RECENT_SIGNIN_MS;

  if (path === "/account/passkeys/confirm") {
    // Prove it's them with an email code, then come back to add the passkey.
    const sent = await sendCode(env, session.email, false);
    if (sent !== "sent") return withCookies(new Response(null, { status: 303, headers: { Location: "/account?passkey-failed#passkeys" } }), session.cookies);
    return withCookies(codePage(env, session.email, "/account?passkey", undefined, true), session.cookies);
  }

  if (remove) {
    await removePasskey(env.DB, account.id, remove[1]!);
    return withCookies(new Response(null, { status: 303, headers: { Location: "/account#passkeys" } }), session.cookies);
  }

  if (path === "/api/passkeys/add/options") {
    if (!recent) return json({ error: "Confirm it's you first.", confirm: true }, 403, session.cookies);
    const keys = await passkeysFor(env.DB, account.id);
    if (keys.length >= MAX_PASSKEYS) return json({ error: `You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.` }, 400, session.cookies);
    const challenge = newChallenge();
    return json(
      {
        challenge,
        rp: { id: rpId, name: "Zaisma" },
        user: { id: b64url(new TextEncoder().encode(account.id)), name: session.email, displayName: account.name },
        algs: PASSKEY_ALGS,
        exclude: keys.map((k) => k.id),
      },
      200,
      [...session.cookies, challengeCookie("add", challenge)],
    );
  }

  if (path === "/api/passkeys/add") {
    const challenge = takeChallenge("add");
    if (!recent || !challenge) return json({ error: "That took too long. Try again." }, 400, [...session.cookies, used]);
    const body = await readJson(request);
    const p = { id: str(body.id), clientDataJSON: str(body.clientDataJSON), authenticatorData: str(body.authenticatorData), publicKey: str(body.publicKey), alg: Number(body.alg) };
    const checked = p.id.length <= 400 ? await checkNewPasskey(p, want(challenge)) : null;
    if (!checked) return json({ error: "Couldn't add that passkey. Try again." }, 400, [...session.cookies, used]);
    if ((await passkeysFor(env.DB, account.id)).length >= MAX_PASSKEYS) return json({ error: `You can have up to ${MAX_PASSKEYS} passkeys.` }, 400, [...session.cookies, used]);
    const added = await addPasskey(env.DB, { id: p.id, account_id: account.id, public_key: p.publicKey, alg: p.alg, sign_count: checked.signCount, name: deviceName(request.headers.get("user-agent") ?? "") });
    if (!added) return json({ error: "That passkey is already on an account." }, 400, [...session.cookies, used]);
    return json({ ok: true }, 200, [...session.cookies, used]);
  }

  return json({ error: "Not here" }, 404, session.cookies);
}

/**
 * The browser side, for the sign-in and account pages: zaismaPasskeySignIn(next, conditional)
 * and zaismaAddPasskey(). Both return an error to show, or null.
 */
export const PASSKEY_SCRIPT = `
const pkB64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const pkBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const pkPost = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));
let pkWaiting = null;
async function zaismaPasskeySignIn(next, conditional) {
  if (pkWaiting) pkWaiting.abort();
  const waiting = (pkWaiting = new AbortController());
  const o = await pkPost("/api/passkeys/signin/options");
  if (!o.ok) return "Couldn't start. Try again.";
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: { challenge: pkBytes(o.data.challenge), rpId: o.data.rpId, userVerification: "required", timeout: 120000 }, mediation: conditional ? "conditional" : undefined, signal: waiting.signal });
  } catch (e) {
    return e && e.name === "AbortError" ? null : conditional ? null : "No passkey was used. Try again, or sign in with an email code.";
  }
  if (!cred) return null;
  const r = cred.response;
  const res = await pkPost("/api/passkeys/signin", { id: cred.id, clientDataJSON: pkB64(r.clientDataJSON), authenticatorData: pkB64(r.authenticatorData), signature: pkB64(r.signature), userHandle: r.userHandle ? pkB64(r.userHandle) : "", next });
  if (!res.ok) return res.data.error || "That passkey didn't work. Sign in with an email code instead.";
  location.href = res.data.next;
  return null;
}
async function zaismaAddPasskey() {
  const o = await pkPost("/api/passkeys/add/options");
  if (!o.ok) return o.data.confirm ? "confirm" : o.data.error || "Couldn't start. Try again.";
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      challenge: pkBytes(o.data.challenge), rp: o.data.rp,
      user: { id: pkBytes(o.data.user.id), name: o.data.user.name, displayName: o.data.user.displayName },
      pubKeyCredParams: o.data.algs.map((alg) => ({ type: "public-key", alg })),
      excludeCredentials: o.data.exclude.map((id) => ({ type: "public-key", id: pkBytes(id) })),
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      attestation: "none", timeout: 120000,
    } });
  } catch (e) {
    if (e && e.name === "InvalidStateError") return "This device already has a passkey for your account.";
    return "No passkey was added.";
  }
  const r = cred.response;
  const key = r.getPublicKey && r.getPublicKey();
  if (!key || !r.getAuthenticatorData) return "This browser can't add passkeys yet. Try another one.";
  const res = await pkPost("/api/passkeys/add", { id: cred.id, clientDataJSON: pkB64(r.clientDataJSON), authenticatorData: pkB64(r.getAuthenticatorData()), publicKey: pkB64(key), alg: r.getPublicKeyAlgorithm() });
  return res.ok ? null : res.data.error || "Couldn't add that passkey. Try again.";
}
`;

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 20000) : "");

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeNext(value: unknown): string | null {
  return typeof value === "string" && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(value) && value.length < 200 ? value : null;
}

function withCookies(res: Response, cookies: string[]): Response {
  const out = new Response(res.body, res);
  for (const c of cookies) out.headers.append("Set-Cookie", c);
  out.headers.set("Cache-Control", "no-store");
  return out;
}
