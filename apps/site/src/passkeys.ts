import {
  MAXIMUM_PASSKEY_COUNT,
  PASSKEY_ALGORITHM_NUMBERS,
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
import { currentSession, readCookie, sessionCookies, sessionForUser, setCookie } from "./auth.ts";
import type { Env } from "./env.ts";

/**
 * Passkeys: sign back in with Face ID, a fingerprint or a device PIN. We check them ourselves
 * (packages/core/src/webauthn.ts); Supabase still makes the session. A way back in beside the
 * password, and the email when there is one.
 *
 *   POST /api/passkeys/signin/options   a challenge for signing in
 *   POST /api/passkeys/signin           { id, clientDataJSON, authenticatorData, signature, next }
 *   POST /api/passkeys/add/options      what the browser needs to make one (signed in, recently)
 *   POST /api/passkeys/add              { id, clientDataJSON, authenticatorData, publicKey, alg }
 *   POST /account/passkeys/:id/remove
 *
 * Adding a passkey needs a sign-in in the last 10 minutes, so a stolen session cookie can't
 * add a way back in; the account page's "Confirm it's you" makes one (account.ts).
 */
export const RECENT_SIGNIN_MS = 10 * 60_000;
const CHALLENGE_DURATION_SEC = 300;

export async function handlePasskeys(request: Request, env: Env, path: string): Promise<Response | null> {
  const remove = path.match(/^\/account\/passkeys\/([A-Za-z0-9_-]{1,400})\/remove$/);
  if (!path.startsWith("/api/passkeys/") && !remove) return null;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  // Only our own pages.
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });

  const json = (body: unknown, httpStatus = 200, cookies: string[] = []) => {
    const response = Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
    for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
    return response;
  };
  const rpId = new URL(env.SITE_ORIGIN).hostname;
  const want = (challenge: string) => ({ challenge, origin: env.SITE_ORIGIN, rpId });
  // The challenge lives in a short cookie, for one use, tied to what it's for.
  const challengeCookie = (purpose: string, challenge: string) => setCookie(env, "zaisma_pk", `${purpose}.${challenge}`, { maximumAgeSec: CHALLENGE_DURATION_SEC });
  const takeChallenge = (purpose: string) => {
    const [cookiePurpose, cookieChallenge] = (readCookie(request, env, "zaisma_pk") ?? "").split(".");
    return cookiePurpose === purpose && cookieChallenge ? cookieChallenge : null;
  };
  const used = setCookie(env, "zaisma_pk", "", { maximumAgeSec: 0 });

  if (path === "/api/passkeys/signin/options") {
    const challenge = newChallenge();
    return json({ challenge, rpId }, 200, [challengeCookie("in", challenge)]);
  }

  if (path === "/api/passkeys/signin") {
    if (env.SIGNIN_LIMIT && !(await env.SIGNIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success) return json({ error: "Too many tries. Wait a minute and try again." }, 429);
    const challenge = takeChallenge("in");
    const body = await readJson(request);
    const key = challenge && typeof body.id === "string" ? await passkeyById(env.DB, body.id) : null;
    const checked = key ? await checkPasskeyUse({ clientDataJSON: asText(body.clientDataJSON), authenticatorData: asText(body.authenticatorData), signature: asText(body.signature) }, { publicKey: key.public_key, algorithmNumber: key.algorithm_number, signCount: key.sign_count }, want(challenge!)) : null;
    // The passkey's user handle, when sent, is the account it was made for.
    if (!key || !checked || (typeof body.userHandle === "string" && body.userHandle && body.userHandle !== b64url(new TextEncoder().encode(key.account_id)))) {
      return json({ error: "That passkey didn't work. It may have been removed from your account. Sign in with your password instead." }, 400, [used]);
    }
    const session = await sessionForUser(env, key.account_id);
    if (!session) return json({ error: "Couldn't sign you in. Try again, or use your password." }, 502, [used]);
    await usedPasskey(env.DB, key.id, checked.signCount);
    return json({ next: safeNext(body.next) ?? "/" }, 200, [used, ...sessionCookies(env, session)]);
  }

  // --- Signed in from here on ---
  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  if (!session || !account) return json({ error: "Sign in first." }, 401);
  const recent = Date.now() - session.signedInAtMs < RECENT_SIGNIN_MS;

  if (remove) {
    await removePasskey(env.DB, account.id, remove[1]!);
    return withCookies(new Response(null, { status: 303, headers: { Location: "/account#passkeys" } }), session.cookies);
  }

  if (path === "/api/passkeys/add/options") {
    if (!recent) return json({ error: "Confirm it's you first.", confirm: true }, 403, session.cookies);
    const keys = await passkeysFor(env.DB, account.id);
    if (keys.length >= MAXIMUM_PASSKEY_COUNT) return json({ error: `You can have up to ${MAXIMUM_PASSKEY_COUNT} passkeys. Remove one first.` }, 400, session.cookies);
    const challenge = newChallenge();
    return json(
      {
        challenge,
        rp: { id: rpId, name: "Zaisma" },
        user: { id: b64url(new TextEncoder().encode(account.id)), name: account.username, displayName: account.username },
        algs: PASSKEY_ALGORITHM_NUMBERS,
        exclude: keys.map((passkey) => passkey.id),
      },
      200,
      [...session.cookies, challengeCookie("add", challenge)],
    );
  }

  if (path === "/api/passkeys/add") {
    const challenge = takeChallenge("add");
    if (!recent || !challenge) return json({ error: "That took too long. Try again." }, 400, [...session.cookies, used]);
    const body = await readJson(request);
    const newPasskey = { id: asText(body.id), clientDataJSON: asText(body.clientDataJSON), authenticatorData: asText(body.authenticatorData), publicKey: asText(body.publicKey), algorithmNumber: Number(body.alg) };
    const checked = newPasskey.id.length <= 400 ? await checkNewPasskey(newPasskey, want(challenge)) : null;
    if (!checked) return json({ error: "Couldn't add that passkey. Try again." }, 400, [...session.cookies, used]);
    if ((await passkeysFor(env.DB, account.id)).length >= MAXIMUM_PASSKEY_COUNT) return json({ error: `You can have up to ${MAXIMUM_PASSKEY_COUNT} passkeys.` }, 400, [...session.cookies, used]);
    const added = await addPasskey(env.DB, { id: newPasskey.id, account_id: account.id, public_key: newPasskey.publicKey, algorithm_number: newPasskey.algorithmNumber, sign_count: checked.signCount, name: deviceName(request.headers.get("user-agent") ?? "") });
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
    return e && e.name === "AbortError" ? null : conditional ? null : "No passkey was used. Try again, or sign in with your password.";
  }
  if (!cred) return null;
  const r = cred.response;
  const res = await pkPost("/api/passkeys/signin", { id: cred.id, clientDataJSON: pkB64(r.clientDataJSON), authenticatorData: pkB64(r.authenticatorData), signature: pkB64(r.signature), userHandle: r.userHandle ? pkB64(r.userHandle) : "", next });
  if (!res.ok) return res.data.error || "That passkey didn't work. Sign in with your password instead.";
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

const asText = (input: unknown) => (typeof input === "string" ? input.slice(0, 20000) : "");

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeNext(next: unknown): string | null {
  return typeof next === "string" && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(next) && next.length < 200 ? next : null;
}

function withCookies(response: Response, cookies: string[]): Response {
  const out = new Response(response.body, response);
  for (const cookie of cookies) out.headers.append("Set-Cookie", cookie);
  out.headers.set("Cache-Control", "no-store");
  return out;
}
