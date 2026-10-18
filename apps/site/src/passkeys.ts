import {
  MAXIMUM_PASSKEY_COUNT,
  PASSKEY_ALGORITHM_NUMBERS,
  PASSKEY_APPROVAL_WAIT_MS,
  type Passkey,
  accountById,
  approvingPasskeys,
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
import { connectionAddressOf, currentSession, readCookie, realEmail, sessionCookies, sessionForUser, setCookie } from "./auth.ts";
import { deliverEmail, passkeyWaitEmail, waitEndsText } from "./email-codes.ts";
import { logAccountChange, recordSignIn } from "./security-log.ts";
import type { Env } from "./env.ts";
import { pageScript } from "./page-scripts.ts";
import { confirmationOf, recordProof } from "./session-proofs.ts";

/**
 * Passkeys: sign back in with Face ID, a fingerprint or a device PIN. We check them ourselves
 * (packages/core/src/webauthn.ts); Supabase still makes the session. A way back in beside the
 * password, and the email when there is one.
 *
 *   POST /api/passkeys/signin/options   a challenge for signing in
 *   POST /api/passkeys/signin           { id, clientDataJSON, authenticatorData, signature, next }
 *   POST /api/passkeys/tap/options      a challenge for a tap, for "confirm" (Confirm it's you) or "key" (making an API key)
 *   POST /api/passkeys/confirm          a tap made for "confirm": this session has proved it's them
 *   POST /api/passkeys/add/options      what the browser needs to make one (signed in, proven in the last 10 minutes)
 *   POST /api/passkeys/add              { id, clientDataJSON, authenticatorData, publicKey, alg }
 *   POST /account/passkeys/:id/remove
 *
 * A tap is checked for the one thing it was made for, once (checkPasskeyTap): the challenge's cookie says
 * which, and is used up by the check. Only a passkey that can approve counts (approves_from_at_ms): one added
 * without an older passkey's approval, on an account that has had one, waits a day, and the account's email is
 * told. Adding a passkey needs a proof in the last 10 minutes, so a stolen session cookie can't add a way back
 * in; the account page's "Confirm it's you" makes one (account.ts, session-proofs.ts).
 */
const CHALLENGE_DURATION_SEC = 300;

/** The challenge lives in a short cookie, for one use, tied to what it's for. */
const challengeCookie = (env: Env, purpose: string, challenge: string) => setCookie(env, "zaisma_pk", `${purpose}.${challenge}`, { maximumAgeSec: CHALLENGE_DURATION_SEC });
const takeChallenge = (request: Request, env: Env, purpose: string) => {
  const [cookiePurpose, cookieChallenge] = (readCookie(request, env, "zaisma_pk") ?? "").split(".");
  return cookiePurpose === purpose && cookieChallenge ? cookieChallenge : null;
};
/** Clears the challenge cookie once a check has used it. */
export const usedChallengeCookie = (env: Env) => setCookie(env, "zaisma_pk", "", { maximumAgeSec: 0 });

/** What a tap is for: confirming it's them on the account page, or making an API key. */
export type PasskeyTapPurpose = "confirm" | "key";

/** A tap as the browser sends it: the passkey's ID and what it signed. */
export interface PasskeyTap {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string;
}

/** Why an account can't make a key: no passkey, only waiting ones, or the tap didn't work. */
export function keyRefusal(passkeys: Passkey[], nowMs = Date.now()): string {
  if (!passkeys.length) return "Add a passkey first: making a key needs one.";
  const waiting = passkeys.filter((passkey) => passkey.approves_from_at_ms > nowMs);
  if (waiting.length === passkeys.length) return `Your new passkey can make keys from ${waitEndsText(Math.min(...waiting.map((passkey) => passkey.approves_from_at_ms)))}.`;
  return "Making a key needs a tap on your passkey. Try again.";
}

/**
 * A tap made for this purpose, once: the challenge in the cookie for that purpose, a passkey of this account
 * (one that can approve, for "key"), a good signature and the account's user handle. The passkey, or null.
 * The caller clears the challenge cookie with usedChallengeCookie.
 */
export async function checkPasskeyTap(request: Request, env: Env, accountId: string, purpose: PasskeyTapPurpose, tap: PasskeyTap, nowMs = Date.now()): Promise<Passkey | null> {
  const challenge = takeChallenge(request, env, purpose);
  if (!challenge || !tap.id) return null;
  const passkey = await passkeyById(env.DB, tap.id);
  if (!passkey || passkey.account_id !== accountId) return null;
  if (purpose === "key" && passkey.approves_from_at_ms > nowMs) return null;
  const checked = await checkPasskeyUse(
    { clientDataJSON: tap.clientDataJSON, authenticatorData: tap.authenticatorData, signature: tap.signature },
    { publicKey: passkey.public_key, algorithmNumber: passkey.algorithm_number, signCount: passkey.sign_count },
    { challenge, origin: env.SITE_ORIGIN, rpId: new URL(env.SITE_ORIGIN).hostname },
  );
  if (!checked) return null;
  if (tap.userHandle && tap.userHandle !== b64url(new TextEncoder().encode(passkey.account_id))) return null;
  await usedPasskey(env.DB, passkey.id, checked.signCount);
  return passkey;
}

const SIGN_IN_PASSKEY_FAILED = "That passkey didn't work. Try again, or use another one.";

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
  const used = usedChallengeCookie(env);

  if (path === "/api/passkeys/signin/options") {
    const challenge = newChallenge();
    return json({ challenge, rpId }, 200, [challengeCookie(env, "in", challenge)]);
  }

  if (path === "/api/passkeys/signin") {
    if (env.SIGNIN_LIMIT && !(await env.SIGNIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success) return json({ error: "Too many tries. Wait a minute and try again." }, 429);
    const challenge = takeChallenge(request, env, "in");
    const body = await readJson(request);
    const key = challenge && typeof body.id === "string" ? await passkeyById(env.DB, body.id) : null;
    const checked = key ? await checkPasskeyUse({ clientDataJSON: asText(body.clientDataJSON), authenticatorData: asText(body.authenticatorData), signature: asText(body.signature) }, { publicKey: key.public_key, algorithmNumber: key.algorithm_number, signCount: key.sign_count }, want(challenge!)) : null;
    // The passkey's user handle, when sent, is the account it was made for.
    if (!key || !checked || (typeof body.userHandle === "string" && body.userHandle && body.userHandle !== b64url(new TextEncoder().encode(key.account_id)))) {
      return json({ error: "That passkey didn't work. It may have been removed from your account. Sign in with your password instead." }, 400, [used]);
    }
    const session = await sessionForUser(env, key.account_id, connectionAddressOf(request));
    if (!session) return json({ error: "Couldn't sign you in. Try again, or use your password." }, 502, [used]);
    await usedPasskey(env.DB, key.id, checked.signCount);
    await recordProof(env, session, "passkey", key.id);
    return json({ next: safeNext(body.next) ?? "/" }, 200, [used, ...sessionCookies(env, session), await recordSignIn(request, env, key.account_id, "passkey")]);
  }

  // --- Signed in from here on ---
  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  if (!session || !account) return json({ error: "Sign in first." }, 401);
  const confirmation = await confirmationOf(env, session, account.id);

  if (remove) {
    // Removing a passkey needs the strongest way the account has; nothing is removed otherwise.
    if (!confirmation.isConfirmed) return withCookies(new Response(null, { status: 303, headers: { Location: "/account?confirm-first#signing-in" } }), session.cookies);
    const removedPasskey = (await passkeysFor(env.DB, account.id)).find((passkey) => passkey.id === remove[1]);
    await removePasskey(env.DB, account.id, remove[1]!);
    if (removedPasskey) await logAccountChange(request, env, account, "passkey_removed", { subjectName: removedPasskey.name });
    return withCookies(new Response(null, { status: 303, headers: { Location: "/account#passkeys" } }), session.cookies);
  }

  if (path === "/api/passkeys/tap/options") {
    if (env.SIGNIN_LIMIT && !(await env.SIGNIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success) return json({ error: "Too many tries. Wait a minute and try again." }, 429, session.cookies);
    const purpose = (await readJson(request)).purpose;
    if (purpose !== "confirm" && purpose !== "key") return json({ error: "Say what the tap is for: confirm or key." }, 400, session.cookies);
    const keys = await passkeysFor(env.DB, account.id);
    const allowed = purpose === "key" ? approvingPasskeys(keys) : keys;
    if (!allowed.length) return json({ error: purpose === "key" ? keyRefusal(keys) : "Add a passkey first." }, 400, session.cookies);
    const challenge = newChallenge();
    return json({ challenge, rpId, allow: allowed.map((passkey) => passkey.id) }, 200, [...session.cookies, challengeCookie(env, purpose, challenge)]);
  }

  if (path === "/api/passkeys/confirm") {
    if (env.SIGNIN_LIMIT && !(await env.SIGNIN_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success) return json({ error: "Too many tries. Wait a minute and try again." }, 429, session.cookies);
    const body = await readJson(request);
    const passkey = await checkPasskeyTap(request, env, account.id, "confirm", { id: asText(body.id), clientDataJSON: asText(body.clientDataJSON), authenticatorData: asText(body.authenticatorData), signature: asText(body.signature), userHandle: asText(body.userHandle) });
    if (!passkey) return json({ error: SIGN_IN_PASSKEY_FAILED }, 400, [...session.cookies, used]);
    await recordProof(env, session, "passkey", passkey.id);
    return json({ next: "/account?confirmed#signing-in" }, 200, [...session.cookies, used]);
  }

  if (path === "/api/passkeys/add/options") {
    if (!confirmation.isProven) return json({ error: "Confirm it's you first.", confirm: true }, 403, session.cookies);
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
      [...session.cookies, challengeCookie(env, "add", challenge)],
    );
  }

  if (path === "/api/passkeys/add") {
    const challenge = takeChallenge(request, env, "add");
    if (!confirmation.isProven || !challenge) return json({ error: "That took too long. Try again." }, 400, [...session.cookies, used]);
    const body = await readJson(request);
    const newPasskey = { id: asText(body.id), clientDataJSON: asText(body.clientDataJSON), authenticatorData: asText(body.authenticatorData), publicKey: asText(body.publicKey), algorithmNumber: Number(body.alg) };
    const checked = newPasskey.id.length <= 400 ? await checkNewPasskey(newPasskey, want(challenge)) : null;
    if (!checked) return json({ error: "Couldn't add that passkey. Try again." }, 400, [...session.cookies, used]);
    if ((await passkeysFor(env.DB, account.id)).length >= MAXIMUM_PASSKEY_COUNT) return json({ error: `You can have up to ${MAXIMUM_PASSKEY_COUNT} passkeys.` }, 400, [...session.cookies, used]);
    // The first passkey an account ever has approves at once. Later ones wait a day unless an older passkey that
    // can approve confirmed this session: otherwise someone with the password could add one and use it to take the account.
    const nowMs = Date.now();
    const isWaiting = account.has_had_passkey === 1 && !(confirmation.isPasskeyNeeded && confirmation.isConfirmed);
    const approvesFromAtMs = isWaiting ? nowMs + PASSKEY_APPROVAL_WAIT_MS : nowMs;
    const passkeyName = deviceName(request.headers.get("user-agent") ?? "");
    const added = await addPasskey(env.DB, { id: newPasskey.id, account_id: account.id, public_key: newPasskey.publicKey, algorithm_number: newPasskey.algorithmNumber, sign_count: checked.signCount, name: passkeyName }, approvesFromAtMs);
    if (!added) return json({ error: "That passkey is already on an account." }, 400, [...session.cookies, used]);
    await logAccountChange(request, env, account, "passkey_added", { subjectName: passkeyName });
    const email = realEmail(session.email);
    // A failed send is logged and never fails the add.
    if (isWaiting && email) await deliverEmail(env, email, passkeyWaitEmail(env, { username: account.username, deviceName: passkeyName, addedAtMs: nowMs, approvesFromAtMs }));
    return json({ ok: true, is_waiting: isWaiting }, 200, [...session.cookies, used]);
  }

  return json({ error: "Not here" }, 404, session.cookies);
}

/**
 * The browser side, for the sign-in and account pages: zaismaPasskeySignIn(next, conditional),
 * zaismaAddPasskey() and zaismaPasskeyTap(purpose). The first two return an error to show, or null (zaismaAddPasskey
 * also "waiting" when the new passkey must wait a day, and "confirm" when the proof ran out); the tap answers
 * { tap } or { error }. A page loads it before the part that uses it.
 */
export const PASSKEY_SCRIPT = pageScript("passkeys", `
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
  if (!res.ok) return res.data.error || "Couldn't add that passkey. Try again.";
  return res.data.is_waiting ? "waiting" : null;
}
// A tap on one of the account's passkeys, made for one thing: "confirm" or "key".
async function zaismaPasskeyTap(purpose) {
  const o = await pkPost("/api/passkeys/tap/options", { purpose });
  if (!o.ok) return { error: o.data.error || "Couldn't start. Try again." };
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: { challenge: pkBytes(o.data.challenge), rpId: o.data.rpId, allowCredentials: o.data.allow.map((id) => ({ type: "public-key", id: pkBytes(id) })), userVerification: "required", timeout: 120000 } });
  } catch (e) {
    return { error: "No passkey was used. Try again." };
  }
  if (!cred) return { error: "No passkey was used. Try again." };
  const r = cred.response;
  return { tap: { passkey_id: cred.id, client_data_json: pkB64(r.clientDataJSON), authenticator_data: pkB64(r.authenticatorData), signature: pkB64(r.signature), user_handle: r.userHandle ? pkB64(r.userHandle) : "" } };
}
`);

/**
 * Sign in with a passkey, on the sign-in and Forgot your password pages: the #passkey-go button goes
 * to its data-next once in, and with data-autofill the username box offers passkeys too, where the
 * browser can.
 */
export const PASSKEY_SIGN_IN_SCRIPT = pageScript("passkey-sign-in", `(() => {
  if (!window.PublicKeyCredential) return;
  const go = document.getElementById("passkey-go");
  document.getElementById("ways").hidden = false;
  go.hidden = false;
  const next = go.dataset.next || "/";
  const show = (e) => { const p = document.getElementById("passkey-error"); p.textContent = e || ""; p.hidden = !e; };
  go.onclick = async () => show(await zaismaPasskeySignIn(next, false));
  if (go.hasAttribute("data-autofill") && PublicKeyCredential.isConditionalMediationAvailable) PublicKeyCredential.isConditionalMediationAvailable().then((ok) => ok && zaismaPasskeySignIn(next, true).then(show));
})();`);

/** Add a passkey, on the account page. */
export const PASSKEY_ADD_SCRIPT = pageScript("passkey-add", `(() => {
  const row = document.getElementById("passkey-add-row");
  if (!window.PublicKeyCredential) {
    row.innerHTML = "<p class=muted>This browser can't use passkeys.</p>";
    return;
  }
  document.getElementById("passkey-add").onclick = async () => {
    const error = await zaismaAddPasskey();
    if (!error) return (location.href = "/account?passkey-added#passkeys");
    // Added without an older passkey's approval: it can make keys and approve changes a day later.
    if (error === "waiting") return (location.href = "/account?passkey-waiting#passkeys");
    // The recent sign-in ran out while the page was open: confirm it's you first.
    if (error === "confirm") return (location.href = "/account?confirm-first#signing-in");
    const p = document.getElementById("passkey-error");
    p.textContent = error;
    p.hidden = false;
  };
})();`);

/** Confirm it's you with a passkey, on the account page: the #passkey-confirm button taps one, then goes on. */
export const PASSKEY_CONFIRM_SCRIPT = pageScript("passkey-confirm", `(() => {
  const button = document.getElementById("passkey-confirm");
  const show = (text) => { const p = document.getElementById("passkey-confirm-error"); p.textContent = text; p.hidden = false; };
  if (!window.PublicKeyCredential) return show("This browser can't use passkeys. Use the password below.");
  button.onclick = async () => {
    const tapped = await zaismaPasskeyTap("confirm");
    if (tapped.error) return show(tapped.error);
    const t = tapped.tap;
    const res = await pkPost("/api/passkeys/confirm", { id: t.passkey_id, clientDataJSON: t.client_data_json, authenticatorData: t.authenticator_data, signature: t.signature, userHandle: t.user_handle });
    if (!res.ok) return show(res.data.error || "That passkey didn't work. Try again, or use another one.");
    location.href = res.data.next;
  };
})();`);

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
