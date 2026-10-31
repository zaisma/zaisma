import { stackOfOne } from "../../apps/site/src/components/layout.ts";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAXIMUM_OPEN_FRIEND_INVITE_COUNT, addCreditEntry, accountById, stopSocial, addTesterLink, friendsNowOf, blocksOf, playerProfile, playingNowOf, ageBand, ageOn, applyBirthdays, canonicalSave, saveFromParts, checkUsername, createAccount, createApiKey, deleteExpiredFriendInvites, friendInviteByCode, friendInvitesOf, friendsOf, gameById, gameBySlug, gameOwner, recordPlayed, createGame, unversionedSaveKey, sha256Hex, createReport, createVersion, isSlugRetired, newId, personOwner, queueGameDeletion, saveCopyKey, saveScan } from "@zaisma/core";
import { deleteDueGames } from "../../apps/site/src/game-deletion.ts";
import { PASSKEY_SCRIPT } from "../../apps/site/src/passkeys.ts";
import { decideTopic } from "../../apps/site/src/forum-posts.ts";
import { checkForumPosts, type CheckDeps } from "../../apps/site/src/forum-check.ts";
import { checkProfiles } from "../../apps/site/src/profile-check.ts";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { passingScanDeps } from "./scan-stubs.ts";
import { changeSaveAsDeveloper, storedSaveText } from "../../apps/site/src/saves.ts";

/** A localStorage-only save as Zaisma stores it (the v1 envelope). */
const savedText = (localStorageItems: Record<string, string>) => canonicalSave(saveFromParts(localStorageItems, []));
import { DAILY_SIGN_IN_SWEEP_MS, RECENT_SIGN_IN_SWEEP_MS, deleteAbandonedSignIns } from "../../apps/site/src/cleanup.ts";
import worker from "../../apps/site/src/index.ts";
import { deleteOldProofs } from "../../apps/site/src/session-proofs.ts";
import { sendEmailCode } from "../../apps/site/src/email-codes.ts";
import { ACTIVITY, SIGN_IN_APP } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { pageDataOf, pageScriptNames, pageScriptText, strictScriptProblems } from "../strict-scripts.ts";
import { defaultScrollbarProblems } from "../own-scrollbars.ts";
import { unzipSync } from "fflate";
import { ACCOUNT_COLUMNS_LEFT_OUT, ACCOUNT_DATA_TABLES } from "../../apps/site/src/account-data.ts";
import { pageProblems } from "./page-rules.ts";
import { playersSheet } from "../../apps/site/src/players-sheet.ts";
import { html } from "../../apps/site/src/markup.ts";
import { blockSheet } from "../../apps/site/src/blocks.ts";
import { configuredRateLimit, countingRateLimiter } from "../rate-limits.ts";
import siteWranglerText from "../../apps/site/wrangler.jsonc?raw";
import { banAccount } from "../../apps/site/src/bans.ts";
import { personOwner as personOwnerOf } from "@zaisma/core";

const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";

// The presets' settings (docs/DECISIONS.md, "Social settings, with the social modes as presets").
const SOLO_FOCUSED = { who_can_chat: "nobody", who_can_join: "friends", who_sees_playing_now: "friends", who_sees_played_games: "friends", who_sees_online: "friends", who_can_send_friend_requests: "nobody", who_sees_profile: "friends" };
// Friends-focused at 13–15, invites only; at 16 and up it takes friend requests from anyone (Julius, Oct 27, 2026).
const FRIENDS_FOCUSED = { ...SOLO_FOCUSED, who_can_chat: "friends" };
const FRIENDS_FOCUSED_16_UP = { ...FRIENDS_FOCUSED, who_can_send_friend_requests: "anyone" };
const OPEN_AND_SOCIAL_ADULT = { who_can_chat: "anyone", who_can_join: "anyone", who_sees_playing_now: "anyone", who_sees_played_games: "anyone", who_sees_online: "friends", who_can_send_friend_requests: "anyone", who_sees_profile: "anyone" };

// --- A small stand-in for Supabase Auth: passwords, ES256 access tokens, refresh, Google and Discord, admin calls. ---
// It answers only the secret key, like the live project, and has none of Supabase's own email codes: Zaisma
// makes those itself and sends them to the outbox below.

let keys: CryptoKeyPair;
let jwk: JsonWebKey;
const users = new Map<string, string>(); // email -> user id
const createdAt = new Map<string, number>(); // user id -> when Supabase made it, in ms
const deleted: string[] = [];
const supabaseCalls: { path: string; grantType: string | null; apikey: string | null; forwardedFor: string | null }[] = [];
/** Email Zaisma sent (its outbox stand-in), newest last. */
const emails: { from: string; to: string; subject: string; text: string; html: string }[] = [];
const OUTBOX = "https://outbox.test";
const links = new Map<string, string>(); // one-time sign-in link hash -> email
let tokenSeconds = 3600;
/** Each sign-in starts a session with its own ID and sign-in time (seconds), as Supabase's session_id and amr claims say; a refresh keeps both. */
const sessions = new Map<string, { userId: string; seconds: number }>();
/** What Supabase was asked to sign out (/logout's scope), newest last, and whether it says no. */
const logouts: { scope: string | null }[] = [];
let isLogoutFailing = false;
/** How many seconds before now the next sign-ins say they happened, for a device that signed in a while ago. */
let signInAgeSeconds = 0;
const codes = new Map<string, { email: string; challenge: string }>(); // Google/Discord one-time code -> who
const passwords = new Map<string, string>(); // user id -> password
const turnstileChecks: string[] = []; // tokens sent to Cloudflare's siteverify

/** The code in the last email to this address. */
function codeSentTo(email: string): string {
  const sent = emails.filter((sentEmail) => sentEmail.to === email).at(-1);
  if (!sent) throw new Error(`No email to ${email}`);
  return sent.subject.match(/^(\d{6}) is your Zaisma code$/)![1]!;
}

/** A code that isn't this one. */
const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");
let realFetch: typeof fetch;

/** The one password Have I Been Pwned knows, in this stand-in. */
const BREACHED_PASSWORD = "password123";
const PASSWORD = "correct horse battery";

async function pwnedRange(url: URL): Promise<Response> {
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(BREACHED_PASSWORD)))].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  const prefix = url.pathname.split("/").pop();
  // Padding lines (count 0) like the real service sends, and the breached one when its range is asked for.
  return new Response([...(prefix === hash.slice(0, 5) ? [`${hash.slice(5)}:42`] : []), "0000000000000000000000000000000000A:0"].join("\r\n"));
}

function moveEmail(id: string, email: string) {
  for (const [known, knownId] of users) if (knownId === id) users.delete(known);
  users.set(email, id);
}

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function accessToken(sessionId: string, id: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "ES256", kid: "test-key", typ: "JWT" }));
  const amr = [{ method: "otp", timestamp: sessions.get(sessionId)?.seconds ?? now }];
  const p = b64url(JSON.stringify({ sub: id, email, aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: now + tokenSeconds, iat: now, amr, session_id: sessionId }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

/** A new sign-in: its own session. */
async function newSession(id: string, email: string) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { userId: id, seconds: Math.floor(Date.now() / 1000) - signInAgeSeconds });
  return tokens(sessionId, id, email);
}

async function tokens(sessionId: string, id: string, email: string) {
  return Response.json({ access_token: await accessToken(sessionId, id, email), refresh_token: `r-${sessionId}`, user: { id, email } });
}

/** A proof older than the 10 minutes "Confirm it's you" counts, for every session. */
const ageProofs = () => env.DB.exec("UPDATE session_proofs SET proved_at_ms = proved_at_ms - 3600000");

async function fakeSupabase(url: URL, init: RequestInit = {}): Promise<Response> {
  const body = init.body ? JSON.parse(String(init.body)) : {};
  const headers = new Headers(init.headers);
  const path = url.pathname.replace("/auth/v1", "");
  if (path === "/.well-known/jwks.json") return Response.json({ keys: [{ ...jwk, kid: "test-key", alg: "ES256" }] });
  supabaseCalls.push({ path, grantType: url.searchParams.get("grant_type"), apikey: headers.get("apikey"), forwardedFor: headers.get("sb-forwarded-for") });
  // Only Zaisma's secret key: the publishable key is off.
  if (headers.get("apikey") !== "sb_secret_test") return new Response("bad key", { status: 401 });
  if (path === "/token" && url.searchParams.get("grant_type") === "password") {
    const id = users.get(body.email);
    if (!id || passwords.get(id) !== body.password) return Response.json({ code: "invalid_credentials" }, { status: 400 });
    return newSession(id, body.email);
  }
  if (path === "/verify" && body.token_hash) {
    const email = links.get(body.token_hash);
    links.delete(body.token_hash);
    if (!email || body.type !== "magiclink") return Response.json({ code: "otp_expired" }, { status: 403 });
    return newSession(users.get(email)!, email);
  }
  if (path === "/settings") return Response.json({ external: { email: true, google: true, discord: true, github: false } });
  if (path === "/token" && url.searchParams.get("grant_type") === "pkce") {
    const c = codes.get(body.auth_code);
    codes.delete(body.auth_code);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(body.code_verifier))));
    if (!c || c.challenge !== challenge) return Response.json({ code: "flow_state_not_found" }, { status: 404 });
    if (!users.has(c.email)) {
      users.set(c.email, crypto.randomUUID());
      createdAt.set(users.get(c.email)!, Date.now());
    }
    return newSession(users.get(c.email)!, c.email);
  }
  if (path === "/token") {
    const sessionId = String(body.refresh_token).replace(/^r-/, "");
    const id = sessions.get(sessionId)?.userId;
    const email = [...users].find(([, v]) => v === id)?.[0];
    return id && email ? tokens(sessionId, id, email) : Response.json({ code: "refresh_token_not_found" }, { status: 400 });
  }
  if (path === "/logout") {
    const scope = url.searchParams.get("scope");
    logouts.push({ scope });
    if (isLogoutFailing) return new Response("no", { status: 500 });
    const claims = JSON.parse(atob(String(headers.get("authorization")).split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string; session_id: string };
    for (const [sessionId, session] of sessions) if (session.userId === claims.sub && (scope === "global" || (scope === "others" && sessionId !== claims.session_id))) sessions.delete(sessionId);
    return new Response(null, { status: 204 });
  }
  if (path === "/admin/generate_link") {
    const hash = `hash-${crypto.randomUUID()}`;
    links.set(hash, body.email);
    return Response.json({ id: users.get(body.email), email: body.email, hashed_token: hash, verification_type: "magiclink" });
  }
  if (path === "/admin/users" && init.method === "POST") {
    if (users.has(body.email)) return Response.json({ code: "email_exists" }, { status: 422 });
    const id = crypto.randomUUID();
    users.set(body.email, id);
    createdAt.set(id, Date.now());
    passwords.set(id, body.password);
    return Response.json({ id, email: body.email });
  }
  // The admin list: newest first, a page at a time, and filter finds emails containing the text.
  if (path === "/admin/users" && (init.method ?? "GET") === "GET") {
    const filter = url.searchParams.get("filter") ?? "";
    const perPageCount = Number(url.searchParams.get("per_page") ?? 50);
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const listed = [...users]
      .filter(([email]) => email.includes(filter))
      .map(([email, id]) => ({ id, email, created_at: new Date(createdAt.get(id) ?? 0).toISOString() }))
      .sort((first, second) => Date.parse(second.created_at) - Date.parse(first.created_at));
    return Response.json({ users: listed.slice((pageNumber - 1) * perPageCount, pageNumber * perPageCount), aud: "authenticated" });
  }
  const del = path.match(/^\/admin\/users\/(.+)$/);
  if (del && init.method === "PUT") {
    if (body.email && users.has(body.email) && users.get(body.email) !== del[1]) return Response.json({ code: "email_exists" }, { status: 422 });
    if (body.password) passwords.set(del[1]!, body.password);
    if (body.email) moveEmail(del[1]!, body.email);
    return Response.json({ id: del[1] });
  }
  if (del && (init.method ?? "GET") === "GET") {
    const email = [...users].find(([, v]) => v === del[1])?.[0];
    return email ? Response.json({ id: del[1], email }) : Response.json({}, { status: 404 });
  }
  if (del && init.method === "DELETE") {
    deleted.push(del[1]!);
    for (const [e, id] of users) if (id === del[1]) users.delete(e);
    return Response.json({});
  }
  return new Response("not found", { status: 404 });
}

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  realFetch = globalThis.fetch;
});

beforeEach(async () => {
  users.clear();
  createdAt.clear();
  supabaseCalls.length = 0;
  emails.length = 0;
  sessions.clear();
  logouts.length = 0;
  isLogoutFailing = false;
  signInAgeSeconds = 0;
  links.clear();
  codes.clear();
  passwords.clear();
  turnstileChecks.length = 0;
  deleted.length = 0;
  tokenSeconds = 3600;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://api.pwnedpasswords.com") return pwnedRange(url);
    // Cloudflare's invisible check: "bad" is a script, any other token a real browser. A token named after
    // an action answers for that one (sign_in, email_code); any other, for making an account.
    if (url.origin === "https://challenges.cloudflare.com") {
      const token = new URLSearchParams(String(init?.body)).get("response")!;
      turnstileChecks.push(token);
      return Promise.resolve(Response.json(token === "bad" ? { success: false } : { success: true, action: ["sign_in", "email_code"].includes(token) ? token : "join", hostname: "zaisma.test" }));
    }
    if (url.origin === OUTBOX) {
      emails.push(JSON.parse(String(init?.body)));
      return Promise.resolve(Response.json({}));
    }
    return url.origin === SUPABASE ? fakeSupabase(url, init) : realFetch(input, init);
  });
  await env.DB.exec("DELETE FROM email_codes; DELETE FROM email_code_requests; DELETE FROM security_events; DELETE FROM security_places; DELETE FROM device_marks; DELETE FROM wrong_passwords; DELETE FROM forum_posts; DELETE FROM forum_topic_tags; DELETE FROM forum_votes; DELETE FROM forum_follows; DELETE FROM forum_media; DELETE FROM forum_mentions; DELETE FROM forum_topics; DELETE FROM played; DELETE FROM games_ever_played; DELETE FROM player_erases; DELETE FROM presences; DELETE FROM room_players; DELETE FROM live_rooms; DELETE FROM friendships; DELETE FROM friend_invites; DELETE FROM blocks; DELETE FROM profile_reports; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM passkeys; DELETE FROM session_proofs; DELETE FROM save_history; DELETE FROM saves; DELETE FROM audit_log; DELETE FROM tester_links; DELETE FROM reports; DELETE FROM versions; DELETE FROM game_deletions; DELETE FROM retired_game_slugs; DELETE FROM credit_entries; DELETE FROM banned_marks; DELETE FROM ban_matches; DELETE FROM owner_cards; DELETE FROM stripe_connect_states; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// --- A browser with a cookie jar ---

// Browsers made so far, so each gets an address no other has.
let browserCount = 0;

class Browser {
  jar = new Map<string, string>();
  // Each browser gets its own address, so the sign-in rate limit doesn't spill between tests: counted out, never drawn at random,
  // since two of the file's hundreds of browsers drawing the same address shared a limit and failed now and then.
  ip = `10.0.${Math.floor(browserCount / 250) % 250}.${browserCount++ % 250}`;
  /** What the browser says it is, and where Cloudflare says it is (request.cf), for the security log. */
  userAgent: string | null = null;
  cf: Record<string, unknown> | null = null;
  /** Bindings its requests get in place of the tests' own, like a rate limiter that counts with no clock (test/rate-limits.ts). */
  bindings: Partial<typeof env> | null = null;
  async go(path: string, form?: Record<string, string> | URLSearchParams, init: { method?: string; body?: string; origin?: string; contentType?: string } = {}): Promise<Response> {
    const request = new Request(`${SITE}${path}`, {
      method: init.method ?? (form ? "POST" : "GET"),
      body: init.body ?? (form ? new URLSearchParams(form) : undefined),
      headers: {
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        "cf-connecting-ip": this.ip,
        ...(this.userAgent ? { "user-agent": this.userAgent } : {}),
        ...(form || init.body ? { origin: init.origin ?? SITE } : {}),
        ...(init.contentType ? { "content-type": init.contentType } : {}),
      },
      redirect: "manual",
      ...(this.cf ? { cf: this.cf as unknown as IncomingRequestCfProperties } : {}),
    });
    const res = this.cf || this.bindings ? await worker.fetch(request, { ...env, ...this.bindings }, createExecutionContext()) : await SELF.fetch(request);
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split("; ");
      const [k, v] = [pair!.slice(0, pair!.indexOf("=")), pair!.slice(pair!.indexOf("=") + 1)];
      if (attrs.includes("Max-Age=0")) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    // Every page it opens runs only the site's own script files (Strict scripts on zaisma.com, test/strict-scripts.ts).
    if ((res.headers.get("content-type") ?? "").startsWith("text/html")) {
      const page = await res.clone().text();
      expect(strictScriptProblems(page, res.headers.get("content-security-policy")), path).toEqual([]);
      // …and Zaisma's own scrollbar, never the browser's (test/own-scrollbars.ts).
      expect(defaultScrollbarProblems(page), path).toEqual([]);
    }
    return res;
  }
}

const BIRTH_ADULT = { year: "1990", month: "5", day: "20" };
const thisYear = new Date().getUTCFullYear();

/** Let an account make games, as Julius does on /admin/publishing until the beta. */
const letPublishAs = (username: string) => env.DB.prepare("UPDATE accounts SET can_publish = 1 WHERE username = ?").bind(username).run();

/** Make an account with a username and password; with an email, add it too, as the account page does. */
async function join(b: Browser, email: string | null = "fox@example.com", username = "Night_Owl", birth = BIRTH_ADULT): Promise<Response> {
  await b.go("/join/age", birth);
  const made = await b.go("/join/account", { turnstile_token: "test-token", username, password: PASSWORD });
  if (email) await addEmail(b, email);
  return made;
}

async function addEmail(b: Browser, email: string): Promise<Response> {
  await b.go("/account/email", { email, turnstile_token: "email_code" });
  return b.go("/account/email/code", { email, code: codeSentTo(email) });
}

/** Sign in with a password, passing the invisible check a device the account hasn't seen needs. */
const signIn = (b: Browser, form: Record<string, string>) => b.go("/signin", { turnstile_token: "sign_in", ...form });

/** Sign out, then let the next second begin: Sign out on every device ends every session up to the end of the second it happens in, so a sign-in in that same second would end with it. */
async function signOutThenWait(b: Browser): Promise<Response> {
  const res = await b.go("/signout", {});
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 1500 });
  return res;
}

/** Ask for a code to an email from the Forgot your password page, and type it. */
async function signInByEmail(b: Browser, email: string, next?: string): Promise<Response> {
  await b.go("/signin/email", { email, turnstile_token: "email_code", ...(next ? { next } : {}) });
  return b.go("/signin/code", { email, code: codeSentTo(email), ...(next ? { next } : {}) });
}

const idOf = async (username: string) => (await env.DB.prepare("SELECT id FROM accounts WHERE username = ? COLLATE NOCASE").bind(username).first<{ id: string }>())!.id;

describe("age and usernames", () => {
  it("works out whole years and the band", () => {
    const today = new Date(Date.UTC(2026, 9, 12));
    expect(ageOn({ yearNumber: 2013, monthNumber: 10, dayNumber: 12 }, today)).toBe(13);
    expect(ageOn({ yearNumber: 2013, monthNumber: 10, dayNumber: 13 }, today)).toBe(12);
    expect(ageOn({ yearNumber: 2008, monthNumber: 2, dayNumber: 30 }, today)).toBeNull();
    expect(ageOn({ yearNumber: 2030, monthNumber: 1, dayNumber: 1 }, today)).toBeNull();
    expect([ageBand(12), ageBand(13), ageBand(15), ageBand(16), ageBand(17), ageBand(18)]).toEqual([null, "13-15", "13-15", "16-17", "16-17", "18+"]);
  });

  it("takes letters, numbers and underscores, and refuses rude, reserved and phone-number ones", () => {
    expect(checkUsername(" @Night_Owl ")).toEqual({ username: "Night_Owl" });
    expect(checkUsername("Kit2010")).toEqual({ username: "Kit2010" });
    expect(checkUsername("GrapePeacock")).toEqual({ username: "GrapePeacock" });
    for (const bad of ["ab", "Night Owl", "night-owl", "_kit", "kit_", "12345", "Kit5551234567", "Zaisma_Admin", "sh1thead", "<script>", "Ñandú", "a".repeat(21)]) expect(checkUsername(bad)).toHaveProperty("error");
  });
});

describe("making an account", () => {
  it("asks the age first, then a username and password, and signs straight in", async () => {
    const b = new Browser();
    expect(await (await b.go("/join")).text()).toContain("When&#39;s your birthday?");
    const agePage = await (await b.go("/join/age", BIRTH_ADULT)).text();
    expect(agePage).toContain("Username");
    expect(agePage).toContain('autocomplete="new-password"');
    expect(agePage).toContain('href="/legal/terms"');
    expect(agePage).not.toContain('type="email"');
    // How they play is its own step, after the account is made.
    expect(agePage).not.toContain("How do you play?");

    const done = await b.go("/join/account", { turnstile_token: "test-token", username: "Night_Owl", password: PASSWORD });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/join/play");
    expect(b.jar.get("__Host-zaisma")).toMatch(/~r-/);
    expect(b.jar.get("__Host-zaisma_in")).toBe("1");
    expect(b.jar.has("__Host-zaisma_join")).toBe(false);
    // Supabase knows it by a stand-in address that gets no mail, and nothing was emailed.
    expect([...users.keys()]).toEqual([expect.stringMatching(/^account-[0-9a-f]{24}@no-mail\.zaisma\.com$/)]);
    expect(emails).toHaveLength(0);

    const account = await accountById(env.DB, await idOf("Night_Owl"));
    expect(account).toMatchObject({ username: "Night_Owl", age_band: "18+", ...FRIENDS_FOCUSED_16_UP, password_changed_at_ms: expect.any(Number) });
    const page = await (await b.go("/account?welcome")).text();
    expect(page).toContain("Welcome to Zaisma, Night_Owl");
    expect(page).not.toContain("no-mail.zaisma.com");
    expect(page).toContain("No email. Add one");
    // Nothing says which age group the account is in.
    expect(page).not.toMatch(/18 or over|Age group/);
  });

  it("says a username is taken as it's typed, and suggests free ones", async () => {
    await join(new Browser(), null, "Night_Owl");
    const check = async (username: string) => (await (await new Browser().go(`/api/username-check?username=${encodeURIComponent(username)}`)).json()) as { is_available: boolean; message: string; suggested_usernames: string[] };
    const taken = await check("night_owl");
    expect(taken).toMatchObject({ is_available: false, message: "night_owl is taken." });
    expect(taken.suggested_usernames).toHaveLength(3);
    for (const suggestion of taken.suggested_usernames) {
      expect(suggestion).toMatch(/^night_owl_?\d+$/);
      expect(checkUsername(suggestion)).toEqual({ username: suggestion });
    }
    expect(await check("Day_Owl")).toEqual({ is_available: true, message: "Day_Owl is free.", suggested_usernames: [] });
    const spaced = await check("Day Owl");
    expect(spaced.is_available).toBe(false);
    expect(spaced.suggested_usernames).toContain("Day_Owl");

    // The form says so too, with the same suggestions to tap, and keeps what was typed.
    const b = new Browser();
    await b.go("/join/age", BIRTH_ADULT);
    const again = await b.go("/join/account", { turnstile_token: "test-token", username: "NIGHT_OWL", password: PASSWORD });
    expect(again.status).toBe(400);
    const page = await again.text();
    expect(page).toContain("NIGHT_OWL is taken. Try another, or one of these.");
    expect(page).toMatch(/value="NIGHT_OWL_?\d+"/);
    expect(page).toContain('value="NIGHT_OWL"');
    expect(page).not.toContain(PASSWORD);
    expect(users.size).toBe(1);
  });

  it("refuses short and breached passwords, and a password that's the username", async () => {
    const b = new Browser();
    await b.go("/join/age", BIRTH_ADULT);
    expect(await (await b.go("/join/account", { turnstile_token: "test-token", username: "Night_Owl", password: "short" })).text()).toContain("Passwords are at least 8 characters.");
    expect(await (await b.go("/join/account", { turnstile_token: "test-token", username: "Night_Owl", password: BREACHED_PASSWORD })).text()).toContain("showed up in a data breach");
    expect(await (await b.go("/join/account", { turnstile_token: "test-token", username: "Night_Owl", password: "night_owl" })).text()).toContain("isn&#39;t your username");
    expect(users.size).toBe(0);
    // No rules about capitals, digits or symbols.
    expect((await b.go("/join/account", { turnstile_token: "test-token", username: "Night_Owl", password: "just some lowercase words" })).headers.get("location")).toBe("/join/play");
  });

  it("checks for a real browser", async () => {
    const b = new Browser();
    const asked = await b.go("/join/age", BIRTH_ADULT);
    const page = await asked.text();
    expect(page).toContain('name="turnstile_token"');
    // The bot-check script runs Cloudflare's check in the form's box, which the page's policy lets it load.
    expect(page).toContain('<div data-bot-check="join" data-site-key="test-site-key"></div>');
    expect(pageScriptNames(page)).toContain("bot-check");
    expect(asked.headers.get("content-security-policy")).toContain("script-src 'self' https://challenges.cloudflare.com;");
    for (const token of ["bad", ""]) {
      const refused = await b.go("/join/account", { turnstile_token: token, username: "Night_Owl", password: PASSWORD });
      expect(await refused.text()).toContain("couldn&#39;t check that you&#39;re using a real browser");
    }
    expect(users.size).toBe(0);
    expect(turnstileChecks).toEqual(["bad"]);
    expect((await b.go("/join/account", { turnstile_token: "test-token", username: "Night_Owl", password: PASSWORD })).headers.get("location")).toBe("/join/play");
  });

  it("lets 16 and over choose how they play after the account is made, and starts 13 to 15 with no chat", async () => {
    const older = new Browser();
    await older.go("/join/age", { year: String(thisYear - 17), month: "1", day: "1" });
    // A social mode sent with the account step is ignored: the account starts on the band's default, which step B shows picked.
    const made = await older.go("/join/account", { turnstile_token: "test-token", username: "Open_Kite", password: PASSWORD, social_mode: "open_and_social" });
    expect(made.headers.get("location")).toBe("/join/play");
    expect(await accountById(env.DB, await idOf("Open_Kite"))).toMatchObject({ age_band: "16-17", ...FRIENDS_FOCUSED_16_UP });
    const playPage = await (await older.go("/join/play")).text();
    expect(playPage).toContain("How do you play?");
    expect(playPage).toContain("I want to play and chat with my friends.");
    expect(playPage).toMatch(/value="friends_focused" checked/);
    expect(playPage).toContain("Make my account");
    // Open and social at 16–17: chat and friend requests from anyone, the rest with friends.
    const chosen = await older.go("/join/play", { social_mode: "open_and_social" });
    expect(chosen.headers.get("location")).toBe("/account?welcome");
    expect(await accountById(env.DB, await idOf("Open_Kite"))).toMatchObject({ age_band: "16-17", ...FRIENDS_FOCUSED, who_can_chat: "anyone", who_can_send_friend_requests: "anyone", who_sees_profile: "anyone" });
    // Anything else is refused, and the page says so.
    const refused = await older.go("/join/play", { social_mode: "everyone" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("Choose one of these.");

    const younger = new Browser();
    expect(await (await younger.go("/join/age", { year: String(thisYear - 14), month: "1", day: "1" })).text()).not.toContain("How do you play?");
    // 13–15 skip step B, and a hand-made form can't give them open and social there either.
    const youngerMade = await younger.go("/join/account", { turnstile_token: "test-token", username: "Small_Kite", password: PASSWORD, social_mode: "open_and_social" });
    expect(youngerMade.headers.get("location")).toBe("/account?welcome");
    expect((await younger.go("/join/play")).headers.get("location")).toBe("/account?welcome");
    expect((await younger.go("/join/play", { social_mode: "open_and_social" })).headers.get("location")).toBe("/account?welcome");
    expect(await accountById(env.DB, await idOf("Small_Kite"))).toMatchObject({ age_band: "13-15", ...SOLO_FOCUSED });

    // Without an account there's nothing to set: back to the start.
    expect((await new Browser().go("/join/play")).headers.get("location")).toBe("/join");
  });

  it("takes the birthday from the wheels as one date", async () => {
    const b = new Browser();
    const answered = await b.go("/join/age", { birthday: `${thisYear - 30}-05-20` });
    expect(await answered.text()).toMatch(/<h1>(How will you sign in\?|Pick a username)<\/h1>/);
    expect((await b.go("/join/account", { turnstile_token: "test-token", username: "Wheel_Owl", password: PASSWORD })).headers.get("location")).toBe("/join/play");
    expect(await accountById(env.DB, await idOf("Wheel_Owl"))).toMatchObject({ age_band: "18+" });
    const wrong = await new Browser().go("/join/age", { birthday: "2010-02-30" });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toMatch(/class="wheel-button [^"]*\bis-marked\b/);
  });

  it("keeps the birth date only while under 18, and never an adult's", async () => {
    const teen = new Browser();
    await join(teen, null, "Quiet_Comet", { year: String(thisYear - 15), month: "3", day: "9" });
    expect(await env.DB.prepare("SELECT age_band, birth_date FROM accounts WHERE id = ?").bind(await idOf("Quiet_Comet")).first()).toEqual({ age_band: "13-15", birth_date: `${thisYear - 15}-03-09` });

    const adult = new Browser();
    await join(adult, null, "Night_Owl", { year: String(thisYear - 30), month: "3", day: "9" });
    const row = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(await idOf("Night_Owl")).first();
    expect(row).toMatchObject({ age_band: "18+", birth_date: null });
    // Everything but the id and timestamps, which can contain any four digits.
    const { id: _id, created_at_ms: _c, updated_at_ms: _u, password_changed_at_ms: _p, ...stored } = row!;
    expect(JSON.stringify(stored)).not.toContain(String(thisYear - 30));
    expect([...adult.jar.values()].join()).not.toContain(String(thisYear - 30));

    // A hand-made join cookie can't give a birth date that says another band.
    const forged = new Browser();
    await forged.go("/join/age", { year: String(thisYear - 14), month: "3", day: "9" });
    forged.jar.set("__Host-zaisma_join", encodeURIComponent(JSON.stringify({ band: "13-15", birth_date: "1990-01-01" })));
    await forged.go("/join/account", { turnstile_token: "test-token", username: "Odd_Kite", password: PASSWORD });
    expect(await accountById(env.DB, await idOf("Odd_Kite"))).toMatchObject({ age_band: "13-15", birth_date: null });
  });

  it("stops under-13s before they pick a username, and for a day after", async () => {
    const b = new Browser();
    const res = await b.go("/join/age", { year: String(thisYear - 10), month: "1", day: "1" });
    // It doesn't say the age, so there's no number to lie about.
    const page = await res.text();
    expect(page).toContain("You can't make an account");
    // Its words, not its styles (where ::placeholder says "older").
    expect(page.replace(/<style>[\s\S]*?<\/style>/g, "")).not.toMatch(/13 and up|under 13|older/);
    expect(b.jar.get("__Host-zaisma_age")).toBe("no");
    expect(await (await b.go("/join/age", BIRTH_ADULT)).text()).toContain("You can't make an account");
    expect(await (await b.go("/join/account", { turnstile_token: "test-token", username: "Little_Fox", password: PASSWORD })).text()).toContain("You can't make an account");
    expect(users.size).toBe(0);
  });

  it("blocks nothing after a too-young answer where the block lasts 0 seconds, as in the local preview", async () => {
    const b = new Browser();
    b.bindings = { TOO_YOUNG_BLOCK_SECONDS: "0" };
    expect(await (await b.go("/join/age", { year: String(thisYear - 10), month: "1", day: "1" })).text()).toContain("You can't make an account");
    b.jar.set("__Host-zaisma_age", "no");
    expect(await (await b.go("/join/age", BIRTH_ADULT)).text()).not.toContain("You can't make an account");
  });

  it("refuses a bad username and keeps what was typed", async () => {
    const b = new Browser();
    await b.go("/join/age", BIRTH_ADULT);
    const res = await b.go("/join/account", { turnstile_token: "test-token", username: "x", password: PASSWORD });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Usernames are 3 to 20 letters, numbers or underscores.");
    expect(users.size).toBe(0);
  });

  it("can't skip the age question by going straight to the username step", async () => {
    const b = new Browser();
    const res = await b.go("/join/account", { turnstile_token: "test-token", username: "Night_Owl", password: PASSWORD });
    expect(res.headers.get("location")).toBe("/join");
    expect(users.size).toBe(0);
  });

  it("deletes a half-made account if they turn out to be under 13, and never emails it a code", async () => {
    // Back from Discord as an adult, but left before picking a username.
    const b = new Browser();
    await b.go("/join/age", { ...BIRTH_ADULT, with: "discord" });
    expect((await viaProvider(b, "/signin/with/discord", "half@example.com")).headers.get("location")).toBe("/join/username");
    const halfId = users.get("half@example.com")!;
    // A Supabase sign-in with no Zaisma account behind it gets no code: only accounts do.
    await new Browser().go("/signin/email", { email: "half@example.com", turnstile_token: "email_code" });
    expect(emails).toHaveLength(0);
    await b.go("/join/age", { year: String(thisYear - 9), month: "3", day: "3" });
    expect(deleted).toEqual([halfId]);
    expect(b.jar.has("__Host-zaisma")).toBe(false);
    expect(await accountById(env.DB, halfId)).toBeNull();
  });
});

describe("signing in", () => {
  it("signs in with a username in any case, or the account's email, and a password", async () => {
    await join(new Browser(), "fox@example.com", "Night_Owl");
    const b = new Browser();
    const wrong = await signIn(b, { username: "night_owl", password: "not the password" });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain("That username and password don&#39;t match.");
    expect(b.jar.has("__Host-zaisma")).toBe(false);
    const res = await signIn(b, { username: "night_owl", password: PASSWORD, next: "/g/arena" });
    expect(res.headers.get("location")).toBe("/g/arena");
    expect(b.jar.get("__Host-zaisma")).toMatch(/~r-/);

    const byEmail = new Browser();
    expect((await signIn(byEmail, { username: "fox@example.com", password: PASSWORD })).headers.get("location")).toBe("/");
    // Nobody by that name: the same answer.
    expect(await (await signIn(new Browser(), { username: "Nobody_Here", password: PASSWORD })).text()).toContain("That username and password don&#39;t match.");
    // "Sign in" never makes accounts.
    expect(users.size).toBe(1);
  });

  it("tells an account without a password how to get in", async () => {
    users.set("old@example.com", "u-old");
    await createAccount(env.DB, { id: "u-old", username: "Old_Timer", ageBand: "18+" });
    expect(await (await signIn(new Browser(), { username: "Old_Timer", password: PASSWORD })).text()).toContain("doesn&#39;t have a password yet");
  });

  it("gets back in by email code without saying who has an account, then asks for a new password", async () => {
    await join(new Browser());
    const nobody = await new Browser().go("/signin/email", { email: "nobody@example.com", turnstile_token: "email_code" });
    expect(await nobody.text()).toContain("Check your email");
    expect(emails.filter((email) => email.to === "nobody@example.com")).toHaveLength(0);

    const b = new Browser();
    expect(await (await b.go("/signin?next=/g/arena")).text()).toContain('href="/signin/email?next=%2Fg%2Farena"');
    const form = await (await b.go("/signin/email?next=/g/arena")).text();
    const back = "/account?new-password&next=%2Fg%2Farena";
    expect(form).toContain(`name="next" value="${back.replace(/&/g, "&amp;")}"`);
    await b.go("/signin/email", { email: "fox@example.com", next: back, turnstile_token: "email_code" });
    const code = codeSentTo("fox@example.com");
    expect((await b.go("/signin/code", { email: "fox@example.com", code: wrongCode(code) })).status).toBe(400);
    const res = await b.go("/signin/code", { email: "fox@example.com", code, next: back });
    expect(res.headers.get("location")).toBe(back);

    // A window asks for the new password, and then they go on to where they were headed.
    const page = await (await b.go(back)).text();
    expect(page).toContain('<dialog id="new-password"');
    expect(page).toContain("Set a new password");
    expect(page).toContain('<a class="btn ghost" href="/g/arena">Not now</a>');
    const tooShort = await (await b.go("/account/password", { from: "new-password", next: "/g/arena", password: "short" })).text();
    expect(tooShort).toContain('<dialog id="new-password"');
    expect(tooShort).toContain("Passwords are at least 8 characters.");
    expect((await b.go("/account/password", { from: "new-password", next: "/g/arena", password: "a brand new password" })).headers.get("location")).toBe("/g/arena");
    expect((await signIn(new Browser(), { username: "Night_Owl", password: "a brand new password" })).headers.get("location")).toBe("/");
    // Only straight after signing in: later, the page just shows the account.
    const later = new Browser();
    await signIn(later, { username: "Night_Owl", password: "a brand new password" });
    await ageProofs();
    expect(await (await later.go("/account?new-password")).text()).not.toContain('<dialog id="new-password"');
  });

  it("limits password tries on one username, from any address", async () => {
    expect(configuredRateLimit(siteWranglerText, "PASSWORD_LIMIT")).toEqual({ limit: 5, period: 60 });
    await join(new Browser(), null);
    const passwordLimit = countingRateLimiter(5);
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const b = new Browser();
      b.bindings = { PASSWORD_LIMIT: passwordLimit };
      statuses.push((await signIn(b, { username: "Night_Owl", password: `guess number ${i}` })).status);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429, 429]);
    // Counted by the account, whatever address each try came from.
    expect(new Set(passwordLimit.keys)).toEqual(new Set([await idOf("Night_Owl")]));
  });

  it("only sends people back to our own pages", async () => {
    const b = new Browser();
    await join(b);
    const res = await b.go("/signin?next=//evil.example");
    expect(res.headers.get("location")).toBe("/account");
  });

  it("refreshes an expired session quietly", async () => {
    tokenSeconds = 5; // already inside the expiry margin
    const b = new Browser();
    await join(b);
    const before = b.jar.get("__Host-zaisma");
    tokenSeconds = 3600;
    const res = await b.go("/account");
    expect(res.status).toBe(200);
    expect(b.jar.get("__Host-zaisma")).not.toBe(before);
  });

  it("ignores forged session cookies", async () => {
    const b = new Browser();
    b.jar.set("__Host-zaisma", "eyJhbGciOiJFUzI1NiIsImtpZCI6InRlc3Qta2V5In0.eyJzdWIiOiJ4In0.AAAA~r-x");
    expect((await b.go("/account")).headers.get("location")).toBe("/signin");
  });

  it("refuses forms posted from other sites", async () => {
    const res = await SELF.fetch(`${SITE}/signin`, { method: "POST", body: new URLSearchParams({ username: "Night_Owl", password: PASSWORD }), headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("signs out", async () => {
    const b = new Browser();
    await join(b);
    await b.go("/signout", {});
    // The device keeps its mark, so it still opens the account with its password however many wrong ones others try.
    expect([...b.jar.keys()]).toEqual(["__Host-zaisma_device"]);
  });
});

describe("accounts open only through Zaisma", () => {
  const LOCKED_OUT = "Too many wrong passwords were tried on this account today.";
  const BOT_CHECK_FAILED = "We couldn&#39;t check that you&#39;re using a real browser.";
  const markOf = (accountId: string) => env.DB.prepare("SELECT * FROM device_marks WHERE account_id = ?").bind(accountId).first<{ consecutive_wrong_password_count: number }>();
  /** Wrong passwords from other devices earlier today, as if typed. */
  async function wrongPasswordsEarlier(accountId: string, count: number) {
    for (let i = 0; i < count; i++) await env.DB.prepare("INSERT INTO wrong_passwords (account_id, tried_at_ms) VALUES (?, ?)").bind(accountId, Date.now() - 3600_000).run();
  }

  it("calls Supabase only with the secret key, sending the player's address", async () => {
    const b = new Browser();
    await join(b);
    const other = new Browser();
    await signIn(other, { username: "Night_Owl", password: PASSWORD });
    await signInByEmail(new Browser(), "fox@example.com");
    expect(supabaseCalls.length).toBeGreaterThan(5);
    expect(new Set(supabaseCalls.map((call) => call.apikey))).toEqual(new Set(["sb_secret_test"]));
    // None of Supabase's own email codes: Zaisma sends its own.
    expect(supabaseCalls.filter((call) => ["/otp", "/user", "/recover", "/signup"].includes(call.path))).toEqual([]);
    const passwordCalls = supabaseCalls.filter((call) => call.grantType === "password");
    expect(passwordCalls.map((call) => call.forwardedFor)).toEqual([b.ip, other.ip]);
    // Every call that signs someone in carries their address; the admin calls are Zaisma's own.
    for (const call of supabaseCalls.filter((call) => call.path === "/token" || call.path === "/verify")) expect(call.forwardedFor).toMatch(/^10\.0\./);
  });

  it("sends 6-digit codes kept only as hashes, one live code per address, dead after 5 tries or 10 minutes", async () => {
    await join(new Browser(), "fox@example.com");
    const b = new Browser();
    await b.go("/signin/email", { email: "fox@example.com", turnstile_token: "email_code" });
    const first = codeSentTo("fox@example.com");
    expect(first).toMatch(/^\d{6}$/);
    const sentEmail = emails.at(-1)!;
    expect(sentEmail).toMatchObject({ from: "codes@zaisma.com", to: "fox@example.com", subject: `${first} is your Zaisma code` });
    expect(sentEmail.text).toContain("Enter this code on Zaisma to sign in:");
    expect(sentEmail.text).toContain("It works once, for 10 minutes.");
    expect(sentEmail.html).toContain(first);
    // Neither the address nor the code is kept, only their hashes.
    const stored = JSON.stringify(await env.DB.prepare("SELECT * FROM email_codes").all());
    expect(stored).not.toContain("fox@example.com");
    expect(stored).not.toContain(first);

    // A new code replaces the last one.
    await b.go("/signin/email", { email: "fox@example.com", turnstile_token: "email_code" });
    const second = codeSentTo("fox@example.com");
    if (second !== first) expect((await b.go("/signin/code", { email: "fox@example.com", code: first })).status).toBe(400);
    // 5 tries in all, then even the right code is dead.
    while (((await env.DB.prepare("SELECT try_count FROM email_codes").first<{ try_count: number }>())?.try_count ?? 5) < 5) await new Browser().go("/signin/code", { email: "fox@example.com", code: wrongCode(second) });
    expect(await (await b.go("/signin/code", { email: "fox@example.com", code: second })).text()).toContain("That code didn&#39;t work.");
    expect(b.jar.has("__Host-zaisma")).toBe(false);

    // At most 3 an hour to one address (adding the email asked for one too), from anywhere.
    expect((await new Browser().go("/signin/email", { email: "fox@example.com", turnstile_token: "email_code" })).status).toBe(429);

    // Ten minutes on, a code is dead too.
    await join(new Browser(), "owl@example.com", "Owl_Two");
    const later = new Browser();
    await later.go("/signin/email", { email: "owl@example.com", turnstile_token: "email_code" });
    await env.DB.prepare("UPDATE email_codes SET created_at_ms = ?").bind(Date.now() - 11 * 60_000).run();
    expect((await later.go("/signin/code", { email: "owl@example.com", code: codeSentTo("owl@example.com") })).status).toBe(400);
  });

  it("counts asking for an address on no account the same, and runs the invisible check first", async () => {
    const b = new Browser();
    for (let i = 0; i < 3; i++) expect((await b.go("/signin/email", { email: "nobody@example.com", turnstile_token: "email_code" })).status).toBe(200);
    expect((await b.go("/signin/email", { email: "nobody@example.com", turnstile_token: "email_code" })).status).toBe(429);
    expect(emails).toEqual([]);

    await join(new Browser(), "fox@example.com");
    const sentCount = emails.length;
    for (const token of ["bad", ""]) {
      const refused = await new Browser().go("/signin/email", { email: "fox@example.com", turnstile_token: token });
      expect(await refused.text()).toContain(BOT_CHECK_FAILED);
    }
    expect(emails).toHaveLength(sentCount);
    // The form has the check, with its own action.
    expect(await (await new Browser().go("/signin/email")).text()).toContain('"email_code"');
  });

  it("a device that signed in before opens the account, however many wrong passwords others try", async () => {
    const owner = new Browser();
    await join(owner, null);
    const id = await idOf("Night_Owl");
    expect(await markOf(id)).toMatchObject({ consecutive_wrong_password_count: 0 });

    // Other devices share 20 wrong passwords a day: the 20th locks them out, the right password too.
    await wrongPasswordsEarlier(id, 19);
    expect(await (await signIn(new Browser(), { username: "Night_Owl", password: "a wrong guess" })).text()).toContain("That username and password don&#39;t match.");
    const locked = await signIn(new Browser(), { username: "Night_Owl", password: PASSWORD });
    expect(locked.status).toBe(400);
    expect(await locked.text()).toContain(`${LOCKED_OUT} Sign in on a device you&#39;ve used before, or with your passkey or email.`);

    // The owner's device still gets in with the right password, with no invisible check to pass.
    const checksBefore = turnstileChecks.length;
    await signOutThenWait(owner);
    expect((await owner.go("/signin", { username: "Night_Owl", password: PASSWORD })).headers.get("location")).toBe("/");
    expect(turnstileChecks).toHaveLength(checksBefore);

    // Its account page says so once, with the ways back in a new device can use.
    const page = await (await owner.go("/account")).text();
    expect(page).toContain("Someone tried wrong passwords on your account today. Nothing got in.");
    expect(page).toContain('href="#passkeys">Add a passkey</a>');
    expect(page).toContain('href="#email">Add an email</a>');
    expect(await (await owner.go("/account")).text()).not.toContain("Someone tried wrong passwords");

    // An email code still opens it on a new device, which can then use its password.
    await addEmail(owner, "fox@example.com");
    const newDevice = new Browser();
    expect((await signInByEmail(newDevice, "fox@example.com")).headers.get("location")).toBe("/");
    await newDevice.go("/signout", {});
    expect((await newDevice.go("/signin", { username: "Night_Owl", password: PASSWORD })).headers.get("location")).toBe("/");
    // Once the day's wrong passwords drop below 20, new devices get in again.
    await env.DB.prepare("UPDATE wrong_passwords SET tried_at_ms = ? WHERE account_id = ?").bind(Date.now() - 25 * 3600_000, id).run();
    expect((await signIn(new Browser(), { username: "Night_Owl", password: PASSWORD })).headers.get("location")).toBe("/");
  });

  it("a device loses its mark after 10 wrong passwords in a row", async () => {
    const owner = new Browser();
    await join(owner, null);
    const id = await idOf("Night_Owl");
    // The right password starts the count over.
    await env.DB.prepare("UPDATE device_marks SET consecutive_wrong_password_count = 5").run();
    await owner.go("/signin", { username: "Night_Owl", password: PASSWORD });
    expect(await markOf(id)).toMatchObject({ consecutive_wrong_password_count: 0 });

    await env.DB.prepare("UPDATE device_marks SET consecutive_wrong_password_count = 9").run();
    expect((await owner.go("/signin", { username: "Night_Owl", password: "a wrong guess" })).status).toBe(400);
    expect(await markOf(id)).toBeNull();
    expect((await accountById(env.DB, id))?.wrong_password_notice_at_ms).toEqual(expect.any(Number));
    // Now it's a device like any other: the invisible check first, then it's marked again.
    expect(await (await owner.go("/signin", { username: "Night_Owl", password: PASSWORD })).text()).toContain(BOT_CHECK_FAILED);
    expect((await signIn(owner, { username: "Night_Owl", password: PASSWORD })).headers.get("location")).toBe("/");
    expect(await markOf(id)).toMatchObject({ consecutive_wrong_password_count: 0 });
  });

  it("asks a device the account hasn't seen for the invisible check, the same whether the account exists or not", async () => {
    await join(new Browser(), null);
    for (const username of ["Night_Owl", "Nobody_Here"]) {
      for (const token of ["bad", ""]) expect(await (await new Browser().go("/signin", { username, password: PASSWORD, turnstile_token: token })).text()).toContain(BOT_CHECK_FAILED);
    }
    expect(await (await new Browser().go("/signin")).text()).toContain('"sign_in"');
  });

  it("deletes Supabase sign-ins with no Zaisma account after an hour", async () => {
    await join(new Browser(), null);
    const hourMs = 3600_000;
    const kept = await idOf("Night_Owl");
    createdAt.set(kept, Date.now() - 2 * hourMs);
    const age = { "left@example.com": 2 * hourMs, "new@example.com": 10 * 60_000, "days@example.com": 2 * 24 * hourMs, "old@example.com": 5 * 24 * hourMs };
    for (const [email, ageMs] of Object.entries(age)) {
      users.set(email, `u-${email.split("@")[0]}`);
      createdAt.set(`u-${email.split("@")[0]}`, Date.now() - ageMs);
    }
    expect(await deleteAbandonedSignIns(env, RECENT_SIGN_IN_SWEEP_MS)).toBe(0);
    // Every few minutes, the half hour before the last hour; once a day, the 3 days before it.
    createdAt.set("u-left", Date.now() - hourMs - 10 * 60_000);
    expect(await deleteAbandonedSignIns(env, RECENT_SIGN_IN_SWEEP_MS)).toBe(1);
    expect(deleted).toEqual(["u-left"]);
    expect(await deleteAbandonedSignIns(env, DAILY_SIGN_IN_SWEEP_MS)).toBe(1);
    expect(deleted).toEqual(["u-left", "u-days"]);
    expect([...users.values()].sort()).toEqual([kept, "u-new", "u-old"].sort());
  });
});

// Supabase sends the person to Google or Discord and back with a one-time code for this browser.
async function viaProvider(b: Browser, start: string, email: string): Promise<Response> {
  const to = new URL((await b.go(start)).headers.get("location")!);
  const code = `code-${crypto.randomUUID()}`;
  codes.set(code, { email, challenge: to.searchParams.get("code_challenge")! });
  return b.go(`/signin/callback?code=${code}`);
}

describe("Google and Discord", () => {
  it("shows the buttons and sends the browser to Supabase with a one-time challenge", async () => {
    const page = await (await new Browser().go("/signin?next=/g/arena")).text();
    expect(page).toContain('href="/signin/with/google?next=%2Fg%2Farena"');
    expect(page).toContain("Continue with Discord");
    expect(page).not.toContain("/signin/with/github");

    const b = new Browser();
    const res = await b.go("/signin/with/google?next=/g/arena");
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe(`${SUPABASE}/auth/v1/authorize`);
    expect(Object.fromEntries(to.searchParams)).toMatchObject({ provider: "google", redirect_to: `${SITE}/signin/callback`, code_challenge_method: "s256" });
    expect(b.jar.get("__Host-zaisma_oauth")).toMatch(/^google\.[\w-]{43}\./);
    expect((await b.go("/signin/with/github")).status).toBe(404);
  });

  it("signs in an existing account with the same email", async () => {
    await join(new Browser());
    const b = new Browser();
    const res = await viaProvider(b, "/signin/with/google?next=/g/arena", "fox@example.com");
    expect(res.headers.get("location")).toBe("/g/arena");
    expect(b.jar.get("__Host-zaisma")).toMatch(/~r-/);
    expect(b.jar.has("__Host-zaisma_oauth")).toBe(false);
  });

  it("keeps nothing from someone new until they've answered the age question", async () => {
    const b = new Browser();
    const res = await viaProvider(b, "/signin/with/discord", "new@example.com");
    expect(res.headers.get("location")).toBe("/join?with=discord");
    expect(deleted).toEqual([expect.any(String)]);
    expect(b.jar.has("__Host-zaisma")).toBe(false);
    expect(await (await b.go("/join?with=discord")).text()).toContain("back to Discord to finish");

    // The age answer goes straight back to Discord, then to picking a username, with no password.
    expect((await b.go("/join/age", { ...BIRTH_ADULT, with: "discord" })).headers.get("location")).toBe("/signin/with/discord");
    expect((await viaProvider(b, "/signin/with/discord", "new@example.com")).headers.get("location")).toBe("/join/username");
    const usernamePage = await (await b.go("/join/username")).text();
    expect(usernamePage).toContain("Pick a username");
    expect(usernamePage).not.toContain('type="password"');
    // Made with the band's default; 16 and over go on to how they play.
    expect((await b.go("/join/username", { turnstile_token: "test-token", username: "Lucky_Star" })).headers.get("location")).toBe("/join/play");
    expect(await accountById(env.DB, users.get("new@example.com")!)).toMatchObject({ username: "Lucky_Star", age_band: "18+", password_changed_at_ms: null });
  });

  it("under-13s still get no account", async () => {
    const b = new Browser();
    await b.go("/join/age", { year: String(thisYear - 10), month: "1", day: "1" });
    const res = await viaProvider(b, "/signin/with/google", "kid@example.com");
    expect(res.headers.get("location")).toBe("/join?with=google");
    expect(deleted).toHaveLength(1);
    expect(await (await b.go("/join")).text()).toContain("You can't make an account");
    expect(b.jar.has("__Host-zaisma")).toBe(false);
  });

  it("a code only works in the browser that asked for it, and cancelling says so", async () => {
    const a = new Browser();
    const to = new URL((await a.go("/signin/with/google")).headers.get("location")!);
    codes.set("stolen", { email: "fox@example.com", challenge: to.searchParams.get("code_challenge")! });
    const other = new Browser();
    await other.go("/signin/with/google");
    const res = await other.go("/signin/callback?code=stolen");
    expect(res.status).toBe(400);
    expect(other.jar.has("__Host-zaisma")).toBe(false);

    await a.go("/signin/with/google");
    expect(await (await a.go("/signin/callback?error=access_denied")).text()).toContain("Google sign-in was cancelled");
  });
});

describe("the account page", () => {
  it("adds an email with a code to the new address, refuses one on another account, and removes it", async () => {
    const b = new Browser();
    await join(b, null);
    const id = await idOf("Night_Owl");
    expect(await (await b.go("/account")).text()).toContain("No email. Add one");
    const codePage = await (await b.go("/account/email", { email: "Fox@Example.com", turnstile_token: "email_code" })).text();
    expect(codePage).toContain("Enter it to add the email to your account.");
    expect(codePage).toContain('action="/account/email/code"');
    // Zaisma's own code, to the new address; Supabase only hears of the email once it's typed.
    expect(emails.map((email) => email.to)).toEqual(["fox@example.com"]);
    expect(emails[0]!.text).toContain("Enter this code on Zaisma to add this email to your account:");
    expect(users.has("fox@example.com")).toBe(false);
    const code = codeSentTo("fox@example.com");
    expect((await b.go("/account/email/code", { email: "fox@example.com", code: wrongCode(code) })).status).toBe(400);
    expect((await b.go("/account/email/code", { email: "fox@example.com", code })).headers.get("location")).toBe("/account?email-saved#signing-in");
    const page = await (await b.go("/account?email-saved")).text();
    expect(page).toContain('<p class="lead">fox@example.com</p>');
    expect(page).toContain("Remove email");
    expect(users.get("fox@example.com")).toBe(id);

    await join(new Browser(), "owl@example.com", "Owl_Two");
    const sentCount = emails.length;
    expect(await (await b.go("/account/email", { email: "owl@example.com", turnstile_token: "email_code" })).text()).toContain("may already be on another account");
    expect(emails).toHaveLength(sentCount);

    // Taken off, Supabase knows the account by a stand-in address again, and the password still works.
    expect((await b.go("/account/email/remove", {})).headers.get("location")).toBe("/account?email-removed#signing-in");
    expect([...users].find(([, userId]) => userId === id)?.[0]).toMatch(/@no-mail\.zaisma\.com$/);
    expect(await (await b.go("/account")).text()).toContain("No email. Add one");
    expect((await signIn(new Browser(), { username: "Night_Owl", password: PASSWORD })).headers.get("location")).toBe("/");
  });

  it("opens nothing with a sign-in code sent to an address the account has since left", async () => {
    const owner = new Browser();
    await join(owner);
    const id = await idOf("Night_Owl");
    // Someone with the old inbox asks for a code, and the owner moves the account to a new address before it's used.
    await new Browser().go("/signin/email", { email: "fox@example.com", turnstile_token: "email_code" });
    const oldCode = codeSentTo("fox@example.com");
    await owner.go("/account/email", { email: "new@example.com", turnstile_token: "email_code" });
    await owner.go("/account/email/code", { email: "new@example.com", code: codeSentTo("new@example.com") });
    expect(users.get("new@example.com")).toBe(id);
    const stranger = new Browser();
    expect((await stranger.go("/signin/code", { email: "fox@example.com", code: oldCode })).status).toBe(400);
    expect(await (await stranger.go("/account")).text()).not.toContain("Night_Owl");

    // And again once the email is taken off altogether.
    await new Browser().go("/signin/email", { email: "new@example.com", turnstile_token: "email_code" });
    const lastCode = codeSentTo("new@example.com");
    expect((await owner.go("/account/email/remove", {})).headers.get("location")).toBe("/account?email-removed#signing-in");
    const another = new Browser();
    expect((await another.go("/signin/code", { email: "new@example.com", code: lastCode })).status).toBe(400);
    expect(await (await another.go("/account")).text()).not.toContain("Night_Owl");
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM email_codes WHERE account_id = ?").bind(id).first<{ count: number }>()).toEqual({ count: 0 });
  });

  it("changes the username, keeping what was typed and suggesting free ones when it's taken", async () => {
    await join(new Browser(), null, "Taken_Name");
    const b = new Browser();
    await join(b, null, "Night_Owl");
    expect((await b.go("/account/username", { username: "night_owl" })).headers.get("location")).toBe("/account?username-saved#username");
    const taken = await (await b.go("/account/username", { username: "taken_name" })).text();
    expect(taken).toContain("taken_name is taken.");
    expect(taken).toMatch(/data-username="taken_name_?\d+"/);
    expect((await accountById(env.DB, await idOf("night_owl")))?.username).toBe("night_owl");
    const check = (await (await b.go("/api/username-check?username=NIGHT_OWL")).json()) as { message: string };
    expect(check.message).toBe("That's your username.");
  });

  it("renames, ages up, and deletes everything", async () => {
    const b = new Browser();
    await join(b, "teen@example.com", "Quiet_Comet", { year: String(thisYear - 15), month: "1", day: "1" });
    const id = users.get("teen@example.com")!;

    expect((await b.go("/account/username", { username: "Loud_Comet" })).status).toBe(303);
    expect((await accountById(env.DB, id))?.username).toBe("Loud_Comet");

    // The page shows the presets and settings 13–15 can have, and nothing at all of the rest: no open
    // and social, no Anyone for chat, joining or friend requests, and no hint of what opens up later.
    const accountPageText = await (await b.go("/account")).text();
    const social = accountPageText.slice(accountPageText.indexOf('<h2 id="social">'), accountPageText.indexOf('<h2 id="signing-in">'));
    expect(social).toContain('<h2 id="social">Social</h2>');
    expect(social).toMatch(/value="solo_focused" checked/);
    expect(social).toMatch(/name="who_can_chat" value="friends"/);
    expect(social).not.toContain('value="open_and_social"');
    expect(social).not.toMatch(/name="who_can_chat" value="anyone"|name="who_can_join" value="anyone"|name="who_sees_online" value="anyone"/);
    // Friend requests: Invites only, or People I play with, never Anyone.
    expect(social).toMatch(/name="who_can_send_friend_requests" value="played_with"/);
    expect(social).not.toMatch(/name="who_can_send_friend_requests" value="anyone"/);
    expect(social).not.toMatch(/opens up|disabled|16-17|band group/);

    // 13–15 can move to friends-focused, never open and social, and nothing past their limits.
    expect(await (await b.go("/account/social", { social_mode: "open_and_social" })).text()).toContain("Choose from the social settings shown");
    expect(await (await b.go("/account/social", { social_mode: "custom", who_can_join: "anyone" })).text()).toContain("Choose from the social settings shown");
    expect(await (await b.go("/account/social", { social_mode: "custom", who_can_chat: "everyone" })).text()).toContain("Choose from the social settings shown");
    expect(await accountById(env.DB, id)).toMatchObject(SOLO_FOCUSED);
    // A preset with nothing else changed sets them all (the page's script fills them in too).
    const saved = await b.go("/account/social", { social_mode: "friends_focused", ...SOLO_FOCUSED });
    expect(saved.headers.get("location")).toBe("/account?social-saved#social");
    expect(await accountById(env.DB, id)).toMatchObject(FRIENDS_FOCUSED);
    expect(await (await b.go("/account?social-saved")).text()).toMatch(/value="friends_focused" checked/);
    // Changing one setting makes it Custom, whatever preset the form still says.
    expect((await b.go("/account/social", { social_mode: "friends_focused", ...FRIENDS_FOCUSED, who_sees_played_games: "nobody" })).status).toBe(303);
    expect(await accountById(env.DB, id)).toMatchObject({ ...FRIENDS_FOCUSED, who_sees_played_games: "nobody" });
    expect(await (await b.go("/account")).text()).toMatch(/value="custom" checked/);
    // Back to a preset's exact settings is that preset again.
    await b.go("/account/social", { social_mode: "custom", ...FRIENDS_FOCUSED });
    expect(await (await b.go("/account")).text()).toMatch(/value="friends_focused" checked/);

    // The page never says which band an account is in, and nobody changes their birthday.
    expect(accountPageText).not.toMatch(/Age group|13 to 15|Turned 1[68]/);
    expect((await b.go("/account/age", { year: String(thisYear - 19), month: "1", day: "1" })).status).toBe(404);
    expect(await accountById(env.DB, id)).toMatchObject({ age_band: "13-15" });

    // The band moves up on the birthday by itself, keeping the preset: not before the birthday has
    // come everywhere (UTC−12), and never down.
    const sixteenthBirthdayMs = Date.UTC(thisYear + 1, 0, 1);
    expect(await accountById(env.DB, id, sixteenthBirthdayMs + 11 * 3600_000)).toMatchObject({ age_band: "13-15" });
    expect(await accountById(env.DB, id, sixteenthBirthdayMs + 12 * 3600_000)).toMatchObject({ age_band: "16-17", birth_date: `${thisYear - 15}-01-01`, ...FRIENDS_FOCUSED_16_UP });
    expect(await accountById(env.DB, id)).toMatchObject({ age_band: "16-17" });
    // Open and social at 16–17 keeps joining and what they play with friends.
    expect(await (await b.go("/account/social", { social_mode: "custom", ...FRIENDS_FOCUSED_16_UP, who_sees_playing_now: "anyone" })).text()).toContain("Choose from the social settings shown");
    expect((await b.go("/account/social", { social_mode: "open_and_social", ...FRIENDS_FOCUSED_16_UP })).status).toBe(303);
    expect(await accountById(env.DB, id)).toMatchObject({ ...FRIENDS_FOCUSED, who_can_chat: "anyone", who_can_send_friend_requests: "anyone", who_sees_profile: "anyone" });
    const teenPageText = await (await b.go("/account")).text();
    const teenPage = teenPageText.slice(teenPageText.indexOf('<h2 id="social">'), teenPageText.indexOf('<h2 id="signing-in">'));
    expect(teenPage).toMatch(/value="open_and_social" checked/);
    expect(teenPage).toMatch(/name="who_can_send_friend_requests" value="anyone" checked/);
    expect(teenPage).not.toMatch(/name="who_can_join" value="anyone"|name="who_sees_playing_now" value="anyone"|opens up|disabled/);
    // At 18 open and social opens up the rest too, and the birth date is deleted.
    expect(await accountById(env.DB, id, Date.UTC(thisYear + 3, 0, 1, 12))).toMatchObject({ age_band: "18+", birth_date: null, ...OPEN_AND_SOCIAL_ADULT });
    // The daily job does the same for players who weren't on, and Custom stays as it was.
    const custom = new Browser();
    await join(custom, "custom@example.com", "Odd_Fern", { year: String(thisYear - 17), month: "1", day: "1" });
    const customId = users.get("custom@example.com")!;
    await custom.go("/account/social", { social_mode: "custom", ...FRIENDS_FOCUSED, who_can_chat: "anyone" });
    expect(await applyBirthdays(env.DB, Date.UTC(thisYear + 1, 0, 1, 12))).toBe(1);
    expect(await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(customId).first()).toMatchObject({ age_band: "18+", birth_date: null, ...FRIENDS_FOCUSED, who_can_chat: "anyone" });
    expect(await applyBirthdays(env.DB, Date.UTC(thisYear + 1, 0, 1, 12))).toBe(0);

    expect(await (await b.go("/account/delete", { confirm: "nope" })).text()).toContain('Type "delete"');
    const gone = await b.go("/account/delete", { confirm: "delete" });
    expect(await gone.text()).toContain("Your account is deleted");
    expect(deleted).toEqual([id]);
    expect(await accountById(env.DB, id)).toBeNull();
    // Only the device's own cookie stays, and its mark for the account is gone with the account.
    expect([...b.jar.keys()]).toEqual(["__Host-zaisma_device"]);
    expect(await env.DB.prepare("SELECT * FROM device_marks WHERE account_id = ?").bind(id).first()).toBeNull();
  });
});

describe("deleting an account reaches developers", () => {
  it("erases the player from the games they played, unless a game turned it off, and says so", async () => {
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const anaId = users.get("ana@example.com")!;
    const playerId = (await accountById(env.DB, anaId))!.player_id;
    expect(await (await ana.go("/account")).text()).toContain("Games you played and sites you signed in to with Zaisma are told");
    const erasing = await createGame(env.DB, { slug: "tower-climb", title: "Tower Climb", description: "" });
    const keeping = await createGame(env.DB, { slug: "ledger-quest", title: "Ledger Quest", description: "" });
    await env.DB.prepare("UPDATE games SET deleted_account_erase_enabled = 0 WHERE id = ?").bind(keeping.id).run();
    for (const game of [erasing, keeping]) {
      await env.GAME_DATABASES!.batch(game.id, [{ sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER)" }, { sql: "INSERT INTO scores VALUES (?, 10)", values: [playerId] }]);
      await recordPlayed(env.DB, anaId, game.id);
    }
    const scoreCount = async (gameId: string) => {
      const answer = await env.GAME_DATABASES!.query(gameId, "SELECT count(*) AS score_count FROM scores", []);
      return "queryResult" in answer ? answer.queryResult.rows[0]!.score_count : answer.error.message;
    };

    const gone = await ana.go("/account/delete", { confirm: "delete" });
    expect(await gone.text()).toContain("Games you played and sites you signed in to with Zaisma were told");
    await vi.waitFor(async () => expect(await scoreCount(erasing.id)).toBe(0));
    expect(await scoreCount(keeping.id)).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS played_count FROM games_ever_played WHERE account_id = ?").bind(anaId).first("played_count")).toBe(0);
  });
});

describe("deleting an account deletes its games", () => {
  const SCAN_REPORT = { finished_at_ms: Date.now(), decision: "held" as const, findings: [], outside_hosts: [], images: { provider: "photodna", is_connected: true, checked_media_count: 0 }, ai: null, is_child_safety: true };

  async function developer(b: Browser) {
    await join(b, null, "Pixel_Smith");
    return idOf("Pixel_Smith");
  }
  async function ownGame(accountId: string, slug: string, title: string) {
    const owner = await personOwner(env.DB, accountId);
    return createGame(env.DB, { slug, title, description: "", ownerId: owner.id, visibility: "listed" });
  }
  async function zipVersion(gameId: string) {
    const versionId = newId("version");
    await createVersion(env.DB, { id: versionId, gameId, r2Prefix: `games/${gameId}/${versionId}`, fileCount: 1, sizeBytes: 5 });
    await env.GAMES.put(`games/${gameId}/${versionId}/index.html`, "hello");
    return versionId;
  }
  const rowCount = async (table: string, gameId: string) => (await env.DB.prepare(`SELECT COUNT(*) AS row_count FROM ${table} WHERE game_id = ?`).bind(gameId).first<{ row_count: number }>())!.row_count;
  const storage = () => env.GAME_STORAGE as unknown as { takeWiped(nextFailureMessage: string | null): Promise<string[]> };

  it("names the account's games in the delete box", async () => {
    const b = new Browser();
    const accountId = await developer(b);
    expect(await (await b.go("/account")).text()).not.toContain("Your games are deleted with it");
    await ownGame(accountId, "sky-hopper", "Sky Hopper");
    await ownGame(accountId, "moon-dash", "Moon Dash");
    const page = await (await b.go("/account")).text();
    expect(page).toContain("Your games are deleted with it");
    expect(page).toContain("Sky Hopper");
    expect(page).toContain("zaisma.com/g/moon-dash");
  });

  it("deletes each game's files, images, saves, database, secrets and rows, and keeps its link from other games", async () => {
    const b = new Browser();
    const accountId = await developer(b);
    const game = await ownGame(accountId, "sky-hopper", "Sky Hopper");
    const zipVersionId = await zipVersion(game.id);
    await env.DB.prepare("UPDATE versions SET scan_status = 'approved' WHERE game_id = ?").bind(game.id).run();
    await env.DB.prepare("UPDATE games SET live_version_id = ?, review_status = 'live' WHERE id = ?").bind(zipVersionId, game.id).run();
    const filesVersionId = newId("version");
    await createVersion(env.DB, { id: filesVersionId, gameId: game.id, r2Prefix: `manifests/${filesVersionId}`, fileCount: 1, sizeBytes: 5, kind: "files" });
    await env.GAMES.put(`manifests/${filesVersionId}.json`, "{}");
    await env.DB.prepare("UPDATE versions SET scan_status = 'approved' WHERE id = ?").bind(filesVersionId).run();
    await env.GAMES.put(`images/${game.id}/image_cover`, "png");
    const reportId = await createReport(env.DB, { gameId: game.id, reason: "broken", playerText: "Stuck on level 2", versionId: zipVersionId });
    await env.GAMES.put(`report-pictures/${reportId}.jpg`, "jpg");
    // Another player's save, with an earlier copy.
    const player = await createAccount(env.DB, { id: "player-ana", username: "Ana_Plays", ageBand: "18+" });
    await env.DB.prepare("INSERT INTO saves (account_id, game_id, version_number, sha256, size_bytes, saved_at_ms, changed_by_kind) VALUES (?, ?, 1, 'x', 2, ?, 'game')").bind(player.id, game.id, Date.now()).run();
    await env.SAVES.put(unversionedSaveKey(player.id, game.id), "{}");
    await env.DB.prepare("INSERT INTO save_history (id, account_id, game_id, saved_at_ms, copy_reason, sha256, size_bytes) VALUES ('save_copy_1', ?, ?, ?, 'hourly', 'x', 2)").bind(player.id, game.id, Date.now()).run();
    await env.SAVES.put(saveCopyKey(player.id, game.id, "save_copy_1"), "{}");
    await recordPlayed(env.DB, player.id, game.id);
    await env.GAME_DATABASES!.batch(game.id, [{ sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER)" }, { sql: "INSERT INTO scores VALUES ('player_ana', 10)" }]);
    await env.GAME_SECRETS!.set(game.id, "DISCORD_TOKEN", "abc", Date.now());
    await env.DB.prepare("INSERT INTO database_restores (id, game_id, restore_to_at_ms, undo_bookmark, restored_at_ms) VALUES ('database_restore_1', ?, ?, 'bookmark', ?)").bind(game.id, Date.now() - 3600_000, Date.now()).run();
    await storage().takeWiped(null);

    const gone = await b.go("/account/delete", { confirm: "delete" });
    expect(await gone.text()).toContain("Your games are deleted too");
    // The account's own run deletes it straight away, in the background.
    await vi.waitFor(async () => expect(await gameById(env.DB, game.id)).toBeNull());
    for (const table of ["versions", "reports", "saves", "save_history", "played", "games_ever_played", "game_deletions", "audit_log", "database_restores"]) expect(await rowCount(table, game.id), table).toBe(0);
    for (const key of [`games/${game.id}/${zipVersionId}/index.html`, `manifests/${filesVersionId}.json`, `images/${game.id}/image_cover`, `report-pictures/${reportId}.jpg`]) expect(await env.GAMES.head(key), key).toBeNull();
    for (const key of [unversionedSaveKey(player.id, game.id), saveCopyKey(player.id, game.id, "save_copy_1")]) expect(await env.SAVES.head(key), key).toBeNull();
    const overview = await env.GAME_DATABASES!.overview(game.id);
    expect("queryResult" in overview && overview.queryResult.tables).toEqual([]);
    expect(await env.GAME_SECRETS!.list(game.id)).toEqual({ secrets: [] });
    expect(await storage().takeWiped(null)).toEqual([game.id]);

    // Its link is never given to another game.
    const other = await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
    await letPublishAs("Other_Dev");
    const { token } = await createApiKey(env.DB, other.id, "test");
    const taken = await SELF.fetch("https://zaisma.test/api/dev/games", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Sky Hopper", slug: "sky-hopper" }) });
    const answer = await taken.json();
    expect(taken.status).toBe(409);
    expect(errorProblems(answer, taken.status)).toEqual([]);
    expect(answer).toMatchObject({ error: { code: "slug_taken", field: "slug" } });
  });

  it("keeps a game under a child-safety hold whole, taken down with no owner", async () => {
    const b = new Browser();
    const accountId = await developer(b);
    const flagged = await ownGame(accountId, "flagged-game", "Flagged Game");
    const flaggedVersionId = await zipVersion(flagged.id);
    await saveScan(env.DB, flaggedVersionId, "held", SCAN_REPORT);
    const reported = await ownGame(accountId, "reported-game", "Reported Game");
    await createReport(env.DB, { gameId: reported.id, reason: "child_safety", playerText: "" });
    const cleared = await ownGame(accountId, "cleared-game", "Cleared Game");
    await createReport(env.DB, { gameId: cleared.id, reason: "child_safety", playerText: "" });
    await env.DB.prepare("UPDATE reports SET report_status = 'dismissed' WHERE game_id = ?").bind(cleared.id).run();

    await b.go("/account/delete", { confirm: "delete" });
    await vi.waitFor(async () => expect(await gameById(env.DB, cleared.id)).toBeNull());

    for (const kept of [flagged, reported]) {
      const game = (await gameById(env.DB, kept.id))!;
      expect(game).toMatchObject({ owner_id: null, review_status: "removed" });
      expect(JSON.parse(game.review_reason!)).toMatchObject({ code: "developer_account_deleted" });
      expect(await env.DB.prepare("SELECT action FROM audit_log WHERE game_id = ?").bind(kept.id).first("action")).toBe("kept-for-review");
      expect(await rowCount("game_deletions", kept.id)).toBe(0);
    }
    expect(await env.GAMES.head(`games/${flagged.id}/${flaggedVersionId}/index.html`)).not.toBeNull();
    expect(await isSlugRetired(env.DB, "flagged-game")).toBe(true);
  });

  it("checks for a hold again before deleting, waits for a scan, and tries again when storage doesn't answer", async () => {
    const flaggedLate = await createGame(env.DB, { slug: "late-flag", title: "Late Flag", description: "" });
    const flaggedVersionId = await zipVersion(flaggedLate.id);
    await queueGameDeletion(env.DB, flaggedLate.id, "account_deleted");
    // A scan that finishes after the account went still keeps it.
    await saveScan(env.DB, flaggedVersionId, "held", SCAN_REPORT);
    const scanning = await createGame(env.DB, { slug: "still-scanning", title: "Still Scanning", description: "" });
    const scanningVersionId = await zipVersion(scanning.id);
    await queueGameDeletion(env.DB, scanning.id, "account_deleted");
    await deleteDueGames(env);

    expect(await gameById(env.DB, flaggedLate.id)).not.toBeNull();
    expect(await rowCount("game_deletions", flaggedLate.id)).toBe(0);
    expect(await env.DB.prepare("SELECT action FROM audit_log WHERE game_id = ?").bind(flaggedLate.id).first("action")).toBe("kept-for-review");
    expect(await env.DB.prepare("SELECT attempt_count, failure_message FROM game_deletions WHERE game_id = ?").bind(scanning.id).first()).toEqual({ attempt_count: 1, failure_message: "A version is still being scanned." });

    await env.DB.prepare("UPDATE versions SET scan_status = 'approved' WHERE id = ?").bind(scanningVersionId).run();
    await env.DB.prepare("UPDATE game_deletions SET next_attempt_at_ms = 0").run();
    await storage().takeWiped("The game's database didn't answer.");
    await deleteDueGames(env);
    expect(await env.DB.prepare("SELECT attempt_count, failure_message FROM game_deletions WHERE game_id = ?").bind(scanning.id).first()).toEqual({ attempt_count: 2, failure_message: "The game's database didn't answer." });
    expect(await env.GAMES.head(`games/${scanning.id}/${scanningVersionId}/index.html`)).not.toBeNull();

    await storage().takeWiped(null);
    await env.DB.prepare("UPDATE game_deletions SET next_attempt_at_ms = 0").run();
    await deleteDueGames(env);
    expect(await gameById(env.DB, scanning.id)).toBeNull();
    expect(await env.GAMES.head(`games/${scanning.id}/${scanningVersionId}/index.html`)).toBeNull();
  });

  it("lets Zaisma delete a game an account left behind, and only one with no owner", async () => {
    const b = new Browser();
    const accountId = await developer(b);
    const owned = await ownGame(accountId, "still-owned", "Still Owned");
    const left = await createGame(env.DB, { slug: "left-behind", title: "Left Behind", description: "" });
    const versionId = await zipVersion(left.id);
    await saveScan(env.DB, versionId, "held", SCAN_REPORT);

    expect(await (await SELF.fetch(`http://localhost/admin/games/${owned.id}`)).text()).not.toContain("Delete for good");
    expect(await (await SELF.fetch(`http://localhost/admin/games/${owned.id}/delete`, { method: "POST", body: new URLSearchParams({ reason: "test" }) })).text()).toContain("Only a game with no owner");
    expect(await (await SELF.fetch(`http://localhost/admin/games/${left.id}`)).text()).toContain("Delete for good");
    await SELF.fetch(`http://localhost/admin/games/${left.id}/delete`, { method: "POST", body: new URLSearchParams({ reason: "Reported and kept as long as needed." }), redirect: "manual" });
    expect(await (await SELF.fetch(`http://localhost/admin/games/${left.id}`)).text()).toContain("Being deleted");
    // Zaisma's own deletion skips the hold check: a person decided.
    await deleteDueGames(env);
    expect(await gameById(env.DB, left.id)).toBeNull();
    expect(await gameById(env.DB, owned.id)).not.toBeNull();
    expect(await isSlugRetired(env.DB, "left-behind")).toBe(true);
  });
});

describe("friends", () => {
  const inviteFrom = async (b: Browser) => {
    const made = await b.go("/friends/invites", {});
    expect(made.status).toBe(303);
    return new URL(made.headers.get("location")!, SITE).searchParams.get("invite")!;
  };

  it("adds a friend only through an invite they were given, once, and removes them on both sides", async () => {
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const ben = new Browser();
    await join(ben, "ben@example.com", "Quiet_Comet", { year: String(thisYear - 14), month: "1", day: "1" });
    const [anaId, benId] = [users.get("ana@example.com")!, users.get("ben@example.com")!];

    expect(await (await ana.go("/friends")).text()).toContain("No friends yet");
    const inviteCode = await inviteFrom(ana);
    expect(inviteCode).toMatch(/^[23456789A-HJ-NP-Z]{8}$/);
    const shown = await (await ana.go(`/friends?invite=${inviteCode}`)).text();
    expect(shown).toContain(`${SITE}/friends/add/${inviteCode}`);
    expect(shown).toContain(`${inviteCode.slice(0, 4)}-${inviteCode.slice(4)}`);
    // Someone else's invite code in the address shows nothing.
    expect(await (await ben.go(`/friends?invite=${inviteCode}`)).text()).not.toContain(`/friends/add/${inviteCode}`);

    // Signed out, the link says who it's from and asks to sign in first.
    const signedOut = await (await new Browser().go(`/friends/add/${inviteCode}`)).text();
    expect(signedOut).toContain("Night_Owl invited you to be friends");
    expect(signedOut).toContain(`/signin?next=${encodeURIComponent(`/friends/add/${inviteCode}`)}`);
    // Its maker can't use it.
    expect(await (await ana.go(`/friends/add/${inviteCode}`)).text()).toContain("This is your own invite");
    expect((await ana.go(`/friends/add/${inviteCode}`, {})).status).toBe(409);

    // Typed by hand in any case, with its dash, it goes to the invite's page, which asks first.
    const typed = await ben.go("/friends/add", { invite_code: `${inviteCode.slice(0, 4).toLowerCase()}-${inviteCode.slice(4)}` });
    expect(typed.headers.get("location")).toBe(`/friends/add/${inviteCode}`);
    expect(await (await ben.go(`/friends/add/${inviteCode}`)).text()).toContain("Add Night_Owl as a friend?");
    expect(await (await ben.go("/friends/add", { invite_code: "nope" })).text()).toContain("An invite code is 8 letters and numbers");

    const accepted = await ben.go(`/friends/add/${inviteCode}`, {});
    expect(accepted.status).toBe(303);
    expect(await (await ben.go(accepted.headers.get("location")!)).text()).toContain("You and Night_Owl are friends now");
    expect(await friendsOf(env.DB, anaId)).toMatchObject([{ name: "Quiet_Comet" }]);
    expect(await friendsOf(env.DB, benId)).toMatchObject([{ name: "Night_Owl" }]);
    // Ben's chat setting is solo-focused, and the page says what that means for friends.
    expect(await (await ben.go("/friends")).text()).toContain("you don't chat with anyone in games, friends included");

    // Used once, it's gone.
    const carol = new Browser();
    await join(carol, "carol@example.com", "Tall_Pine");
    expect(await (await carol.go(`/friends/add/${inviteCode}`)).text()).toContain("This invite doesn't work");
    expect((await carol.go(`/friends/add/${inviteCode}`, {})).status).toBe(404);

    // A new invite to someone who's already a friend stays for whoever it's meant for.
    const second = await inviteFrom(ana);
    expect(await (await ben.go(`/friends/add/${second}`)).text()).toContain("already friends");
    expect((await carol.go(`/friends/add/${second}`, {})).status).toBe(303);
    expect((await friendsOf(env.DB, anaId)).map((friend) => friend.name)).toEqual(["Quiet_Comet", "Tall_Pine"]);

    // Removing is both sides at once.
    const benPlayerId = (await accountById(env.DB, benId))!.player_id;
    expect((await ana.go(`/friends/${benPlayerId}/remove`, {})).status).toBe(303);
    expect(await friendsOf(env.DB, benId)).toEqual([]);
    expect((await friendsOf(env.DB, anaId)).map((friend) => friend.name)).toEqual(["Tall_Pine"]);

    // Deleting an account takes its friends and invites with it.
    await inviteFrom(ana);
    await ana.go("/account/delete", { confirm: "delete" });
    expect(await friendsOf(env.DB, users.get("carol@example.com")!)).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS invite_count FROM friend_invites").first("invite_count")).toBe(0);
  });

  it("keeps whether a reporter has a block with the player they report, and nothing else about them", async () => {
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const ben = new Browser();
    await join(ben, "ben@example.com", "Quiet_Comet");
    const benPlayerId = (await accountById(env.DB, users.get("ben@example.com")!))!.player_id;
    await createGame(env.DB, { slug: "block-arena", title: "Block Arena", description: "" });
    const reportBen = (reason: string) =>
      ana.go("/g/block-arena/report", undefined, { method: "POST", body: JSON.stringify({ reason, room: "ABCDEF", player: { id: benPlayerId, name: "Quiet_Comet" } }), contentType: "application/json" });
    expect((await reportBen("harassment")).status).toBe(200);
    await ana.go(`/friends/blocks/${benPlayerId}`, undefined, { method: "POST", body: "{}" });
    expect((await reportBen("following_after_block")).status).toBe(200);
    expect((await reportBen("threats_or_private_details")).status).toBe(400);
    const { results } = await env.DB.prepare("SELECT player_reason, has_block_between FROM reports WHERE player_id = ? ORDER BY reported_at_ms, rowid").bind(benPlayerId).all();
    expect(results).toEqual([
      { player_reason: "harassment", has_block_between: 0 },
      { player_reason: "following_after_block", has_block_between: 1 },
    ]);
    await env.DB.exec("DELETE FROM reports");
  });

  it("turns an account's social side off for good: friends and invites end, and nothing turns it back on", async () => {
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const ben = new Browser();
    await join(ben, "ben@example.com", "Quiet_Comet");
    const [anaId, benId] = [users.get("ana@example.com")!, users.get("ben@example.com")!];
    await ben.go(`/friends/add/${await inviteFrom(ana)}`, {});
    const waiting = await inviteFrom(ana);
    const benInvite = await inviteFrom(ben);
    await stopSocial(env.DB, anaId, "personal_details");

    const stopped = (await accountById(env.DB, anaId))!;
    expect(stopped).toMatchObject({ who_can_chat: "nobody", who_can_join: "nobody", who_sees_playing_now: "nobody", who_sees_played_games: "nobody", who_sees_online: "nobody", who_can_send_friend_requests: "nobody", chat_stopped_reason: "removed", social_stopped_reason: "personal_details" });
    expect(await friendsOf(env.DB, benId)).toEqual([]);
    expect(await friendInvitesOf(env.DB, anaId)).toEqual([]);
    expect((await ben.go(`/friends/add/${waiting}`)).status).toBe(404);

    // The account page and /friends say why, in place of the settings and the invite tools.
    const notice = "A person at Zaisma upheld a report that you shared someone&#39;s personal details.";
    expect(await (await ana.go("/account")).text()).toContain(notice);
    expect(await (await ana.go("/friends")).text()).toContain(notice);
    expect(await (await ana.go("/friends")).text()).not.toContain('action="/friends/invites"');
    // Nothing turns it back on: not the settings, not a new invite, not someone else's.
    await ana.go("/account/social", { social_mode: "friends_focused" });
    expect((await accountById(env.DB, anaId))!.who_can_chat).toBe("nobody");
    expect(await (await ana.go("/friends/invites", {})).text()).toContain("Friends are off for your account.");
    expect(await (await ana.go(`/friends/add/${benInvite}`, {})).text()).toContain("Friends are off for your account.");
    expect(await friendsOf(env.DB, anaId)).toEqual([]);
  });

  it("blocks from the game page's plate, ends a friendship, lists blocks with Unblock, and invites don't cross a block", async () => {
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const ben = new Browser();
    await join(ben, "ben@example.com", "Quiet_Comet");
    const [anaId, benId] = [users.get("ana@example.com")!, users.get("ben@example.com")!];
    const [anaPlayerId, benPlayerId] = [(await accountById(env.DB, anaId))!.player_id, (await accountById(env.DB, benId))!.player_id];
    await ben.go(`/friends/add/${await inviteFrom(ana)}`, {});
    expect(await friendsOf(env.DB, anaId)).toHaveLength(1);

    // The plate asks first, with the name Zaisma knows them by, and says they're friends.
    expect(await (await ana.go(`/friends/blocks/${benPlayerId}`)).json()).toEqual({ player: { player_id: benPlayerId, name: "Quiet_Comet" }, is_friend: true, is_blocked: false });
    expect((await ana.go(`/friends/blocks/${anaPlayerId}`)).status).toBe(404);
    expect((await ana.go("/friends/blocks/player_nobody")).status).toBe(404);
    expect((await new Browser().go(`/friends/blocks/${benPlayerId}`)).status).toBe(401);
    // Only from Zaisma's own pages.
    expect((await ana.go(`/friends/blocks/${benPlayerId}`, undefined, { method: "POST", body: "{}", origin: "https://evil.example" })).status).toBe(403);
    const blocked = await ana.go(`/friends/blocks/${benPlayerId}`, undefined, { method: "POST", body: "{}" });
    expect(await blocked.json()).toEqual({ player: { player_id: benPlayerId, name: "Quiet_Comet" }, is_blocked: true });
    expect(await (await ana.go(`/friends/blocks/${benPlayerId}`)).json()).toMatchObject({ is_friend: false, is_blocked: true });

    // The friendship ended on both sides, and only Ana's page lists the block.
    expect(await friendsOf(env.DB, anaId)).toEqual([]);
    expect(await friendsOf(env.DB, benId)).toEqual([]);
    const anaPage = await (await ana.go("/friends")).text();
    expect(anaPage).toContain("Blocked (1)");
    expect(anaPage).toContain(`/friends/blocks/${benPlayerId}/remove`);
    expect(await (await ben.go("/friends")).text()).not.toContain("Blocked");
    // Ben is online, but no longer Ana's friend: he's off her Online strip, and she's off his.
    expect((await ben.go("/api/presence", undefined, { method: "POST", body: "{}" })).status).toBe(204);
    await ana.go("/api/presence", undefined, { method: "POST", body: "{}" });
    expect(await (await ana.go("/friends")).text()).not.toContain("Quiet_Comet</span></li>");
    expect(await (await ben.go("/friends")).text()).not.toContain("Night_Owl</span></li>");

    // Ana's invite looks used to Ben, so he's never told; Ana hears why Ben's doesn't work.
    const anaInvite = await inviteFrom(ana);
    const benSees = await ben.go(`/friends/add/${anaInvite}`);
    expect(benSees.status).toBe(404);
    expect(await benSees.text()).toContain("This invite doesn't work");
    expect((await ben.go(`/friends/add/${anaInvite}`, {})).status).toBe(404);
    const benInvite = await inviteFrom(ben);
    expect(await (await ana.go(`/friends/add/${benInvite}`)).text()).toContain("You blocked Quiet_Comet");
    expect(await (await ana.go(`/friends/add/${benInvite}`, {})).text()).toContain("You blocked Quiet_Comet");
    expect(await friendsOf(env.DB, anaId)).toEqual([]);

    // Unblock: the wall is down, and they aren't friends again until someone sends an invite.
    const unblocked = await ana.go(`/friends/blocks/${benPlayerId}/remove`, {});
    expect(unblocked.headers.get("location")).toBe("/friends?unblocked#blocked");
    expect(await (await ana.go("/friends?unblocked")).text()).toContain("Unblocked.");
    expect(await blocksOf(env.DB, anaId)).toEqual([]);
    expect(await friendsOf(env.DB, anaId)).toEqual([]);
    expect((await ana.go(`/friends/add/${benInvite}`, {})).status).toBe(303);

    // Blocks go with either account.
    await ana.go(`/friends/blocks/${benPlayerId}`, undefined, { method: "POST", body: "{}" });
    expect(await blocksOf(env.DB, anaId)).toHaveLength(1);
    await ben.go("/account/delete", { confirm: "delete" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS block_count FROM blocks").first("block_count")).toBe(0);
  });

  it("shows friends online and what they're playing, with Join only when it would work", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, multiplayer_mode, created_at_ms, updated_at_ms) VALUES ('g-arena', 'arena-game', 'Arena', 'live', 'listed', 'v1', 'relay', ?, ?)").bind(now, now).run();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, created_at_ms, updated_at_ms) VALUES ('g-secret', 'secret-game', 'Secret Plans', 'live', 'private', 'v2', ?, ?)").bind(now, now).run();
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const friends: Record<string, Browser> = {};
    for (const name of ["Quiet_Comet", "Tall_Pine", "Red_Fox"]) {
      friends[name] = new Browser();
      await join(friends[name]!, `${name.toLowerCase()}@example.com`, name);
      expect((await friends[name]!.go(`/friends/add/${await inviteFrom(ana)}`, {})).status).toBe(303);
    }
    const [ben, carol, dan] = [friends.Quiet_Comet!, friends.Tall_Pine!, friends.Red_Fox!];
    const checkIn = (b: Browser, body: object = {}) => b.go("/api/presence", undefined, { method: "POST", body: JSON.stringify(body) });
    const playerIdOf = async (email: string) => (await accountById(env.DB, users.get(email)!))!.player_id;

    expect(await (await ana.go("/friends")).text()).toContain("None of your friends are online right now.");
    // Ben is in an Arena room; Carol pressed Play on a game that isn't out; Dan shows neither.
    expect((await checkIn(ben)).status).toBe(204);
    await env.DB.prepare("INSERT INTO room_players (game_id, room_code, player_id, joined_at_ms, updated_at_ms) VALUES ('g-arena', 'ROOMAA', ?, ?, ?)").bind(await playerIdOf("quiet_comet@example.com"), now, now).run();
    await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, created_at_ms, updated_at_ms) VALUES ('g-arena', 'ROOMAA', 2, 8, 1, ?, ?)").bind(now, now).run();
    // A game page's check-in answers how many friend requests wait.
    expect(await (await checkIn(carol, { game_slug: "secret-game" })).json()).toEqual({ waiting_friend_request_count: 0, accepted_friend_request_count: 0 });
    await env.DB.prepare("UPDATE accounts SET who_sees_online = 'nobody', who_sees_playing_now = 'nobody' WHERE id = ?").bind(users.get("red_fox@example.com")!).run();
    await checkIn(dan, { game_slug: "arena-game" });

    const page = await (await ana.go("/friends")).text();
    const online = page.slice(page.indexOf('class="online"'), page.indexOf("</ul>", page.indexOf('class="online"')));
    expect(online).toContain("Quiet_Comet");
    expect(online).toContain("Tall_Pine");
    expect(online).not.toContain("Red_Fox");
    expect(page).toContain("Playing now");
    expect(page).toContain('href="/g/arena-game?room=ROOMAA"');
    expect(page).toContain("A game that isn't out yet");
    expect(page).not.toContain("Secret Plans");
    expect(page).not.toContain("secret-game");
    expect(page).toContain('href="/@Quiet_Comet"');

    // The game page says who's playing it, with the same Join.
    const here = await (await ana.go("/g/arena-game/friends")).text();
    expect(here).toContain('<b class="one-line">Quiet_Comet</b><span>\u00a0is playing</span>');
    expect(here).toMatch(/<a class="shell cut-btn small" href="\/g\/arena-game\?room=ROOMAA">.*?<span>Join<\/span>/);
    // Glass: only gallery components.
    expect(pageProblems(here)).toEqual([]);
    expect(await (await ana.go("/g/secret-game/friends")).text()).toBe("");
    // And so does Ben's profile, for a friend; a stranger doesn't see it.
    const profile = await (await ana.go("/@Quiet_Comet")).text();
    expect(profile).toContain("Playing now");
    expect(profile).toContain('href="/g/arena-game?room=ROOMAA"');
    expect(await (await new Browser().go("/@Quiet_Comet")).text()).not.toContain("?room=ROOMAA");
    expect((await new Browser().go("/g/arena-game/friends")).status).toBe(401);
    expect((await checkIn(new Browser())).status).toBe(401);

    // One account's Playing now, for its profile: friends see it, strangers only when it's open to anyone.
    const benId = users.get("quiet_comet@example.com")!;
    expect(await playingNowOf(env.DB, benId, users.get("ana@example.com")!, 18)).toMatchObject({ game: { slug: "arena-game" }, join: { room_code: "ROOMAA", refusal: null } });
    expect(await playingNowOf(env.DB, benId, null, 18)).toBeNull();
    await env.DB.prepare("UPDATE accounts SET who_sees_playing_now = 'anyone' WHERE id = ?").bind(benId).run();
    // Joining stays with friends, so a stranger sees the game and why Join won't work.
    expect(await playingNowOf(env.DB, benId, null, 18)).toMatchObject({ game: { slug: "arena-game" }, join: { refusal: "friend_not_taking_joins" } });
    await env.DB.prepare("UPDATE accounts SET who_sees_playing_now = 'friends' WHERE id = ?").bind(benId).run();

    // Join grays out with why: a closed room, a full one, a friend who doesn't take joins.
    await env.DB.prepare("UPDATE live_rooms SET is_open = 0").run();
    // On the game's page, why takes Join's place.
    const closed = await (await ana.go("/g/arena-game/friends")).text();
    expect(closed).toContain('<span class="tag plain">Match in progress</span>');
    expect(closed).not.toContain("?room=ROOMAA");
    expect(pageProblems(closed)).toEqual([]);
    await env.DB.prepare("UPDATE live_rooms SET is_open = 1, player_count = 7, held_seat_count = 1").run();
    expect(await (await ana.go("/friends")).text()).toContain('data-reason="Room full"');
    await env.DB.prepare("UPDATE accounts SET who_can_join = 'nobody' WHERE id = ?").bind(users.get("quiet_comet@example.com")!).run();
    const refused = await (await ana.go("/friends")).text();
    expect(refused).toContain('data-reason="Quiet_Comet isn&#39;t taking joins"');
    expect(refused).not.toContain("?room=ROOMAA");
    await env.DB.prepare("UPDATE accounts SET who_can_join = 'friends' WHERE id = ?").bind(users.get("quiet_comet@example.com")!).run();
    // The game's switches: a private room, then Join off for the whole game, which says so first.
    await env.DB.prepare("UPDATE live_rooms SET player_count = 2, held_seat_count = 0, friend_joins_enabled = 0").run();
    expect(await (await ana.go("/friends")).text()).toContain('data-reason="Private room"');
    await env.DB.prepare("UPDATE games SET friend_joins_enabled = 0 WHERE slug = 'arena-game'").run();
    const gameOff = await (await ana.go("/g/arena-game/friends")).text();
    expect(gameOff).toContain('<span class="tag plain">This game doesn&#39;t take joins</span>');
    expect(gameOff).not.toContain("?room=ROOMAA");
    await env.DB.prepare("UPDATE games SET friend_joins_enabled = 1 WHERE slug = 'arena-game'").run();
    await env.DB.prepare("UPDATE live_rooms SET friend_joins_enabled = 1").run();
    expect(await (await ana.go("/friends")).text()).toContain('href="/g/arena-game?room=ROOMAA"');
    await env.DB.prepare("UPDATE accounts SET who_can_join = 'nobody' WHERE id = ?").bind(users.get("quiet_comet@example.com")!).run();

    // Carol leaves the game; Ben appears offline and is gone from both lists, though he still sees his friends.
    await checkIn(carol, { left_game_slug: "secret-game" });
    expect((await ben.go("/friends/appear-offline", { is_appearing_offline: "1" })).status).toBe(303);
    await checkIn(ana);
    const benPage = await (await ben.go("/friends")).text();
    expect(benPage).toContain("You're hidden from Online and Playing now for everyone.");
    expect(benPage).toContain("Night_Owl</span></li>");
    const quiet = await (await ana.go("/friends")).text();
    expect(quiet).not.toContain("Quiet_Comet</span></li>");
    expect(quiet).not.toContain("Playing now");
    expect(quiet).toContain("Tall_Pine</span></li>");
    await ben.go("/friends/appear-offline", { is_appearing_offline: "0" });
    expect(await (await ana.go("/friends")).text()).toContain("Quiet_Comet</span></li>");

    // Deleting an account takes where it was with it.
    await ben.go("/account/delete", { confirm: "delete" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS row_count FROM room_players").first("row_count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS row_count FROM presences WHERE account_id = ?").bind(benId).first("row_count")).toBe(0);
  });

  it("sends a friend's Join to the room on the game's own server, and the game page passes only its own servers on", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, own_server_urls, created_at_ms, updated_at_ms) VALUES ('g-own', 'own-game', 'Own Servers', 'live', 'listed', 'v1', '[\"wss://play.example.com\"]', ?, ?)").bind(now, now).run();
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const ben = new Browser();
    await join(ben, "quiet_comet@example.com", "Quiet_Comet");
    expect((await ben.go(`/friends/add/${await inviteFrom(ana)}`, {})).status).toBe(303);
    const benId = users.get("quiet_comet@example.com")!;
    await env.DB.prepare("INSERT INTO room_players (game_id, room_code, player_id, server_url, joined_at_ms, updated_at_ms) VALUES ('g-own', 'WNRMAA', ?, 'wss://play.example.com', ?, ?)").bind((await accountById(env.DB, benId))!.player_id, now, now).run();

    const server = "server=wss%3A%2F%2Fplay.example.com";
    expect(await (await ana.go("/friends")).text()).toContain(`/g/own-game?room=WNRMAA&amp;${server}`);
    expect(await (await ana.go("/g/own-game/friends")).text()).toContain(`/g/own-game?room=WNRMAA&amp;${server}`);
    // The game gets the server beside the room, for joinRoom to follow; a server that isn't the game's own never reaches it.
    expect(await (await ana.go(`/g/own-game?room=WNRMAA&${server}`)).text()).toContain(`?room=WNRMAA&amp;${server}`);
    const other = await (await ana.go(`/g/own-game?room=WNRMAA&server=${encodeURIComponent("wss://evil.example")}`)).text();
    expect(other).toContain("?room=WNRMAA");
    expect(other).not.toContain("evil.example");

    // Its public profile says what it's playing once Ben shows that to anyone.
    const benPlayerId = (await accountById(env.DB, benId))!.player_id;
    expect((await playerProfile(env.DB, benPlayerId, "https://zaisma.test"))!.playing_now).toBeNull();
    await env.DB.prepare("UPDATE accounts SET who_sees_playing_now = 'anyone', who_sees_profile = 'anyone' WHERE id = ?").bind(benId).run();
    expect((await playerProfile(env.DB, benPlayerId, "https://zaisma.test"))!.playing_now).toEqual({ slug: "own-game", title: "Own Servers", page_url: "https://zaisma.test/g/own-game" });
  });

  it("builds the Players and Block sheets from gallery components only, their row templates too: Players, a player and Report are steps of one sheet", () => {
    const reportStep = { stepName: "report", title: "Report Arena", body: stackOfOne(html`<p>What's wrong</p>`, "words") };
    const players = playersSheet({ gameOrigin: "https://games.zaisma.test", slug: "arena-game", title: "Arena", hasZaismaRooms: true, canSignIn: true, signInPath: "/signin", reportStep }).html;
    expect(players.match(/<dialog /g)).toHaveLength(1);
    for (const stepName of ["players", "player", "report"]) expect(players).toContain(`data-sheet-step="${stepName}"`);
    const block = blockSheet({ gameOrigin: "https://games.zaisma.test" }).html;
    for (const markup of [players, block]) expect(pageProblems(markup)).toEqual([]);
    // pageProblems leaves templates out, so the room's row template is held to it on its own.
    const rowTemplate = /<template id="players-row">([\s\S]*?)<\/template>/.exec(players)![1]!;
    expect(pageProblems(rowTemplate)).toEqual([]);
    expect(rowTemplate).toContain('data-player-action="mute"');
    expect(rowTemplate).toContain('data-player-action="more"');
    // The hooks their scripts use.
    for (const id of ["players-find-field", "players-list", "players-note", "players-watching", "players-friends", "players-friends-list", "players-sign-in", "players-player-title", "players-player-profile", "players-player-block", "players-player-report", "players-data"]) expect(players).toContain(`id="${id}"`);
    for (const id of ["block-title", "block-who", "block-friend", "block-told", "block-error", "block-yes", "block-data"]) expect(block).toContain(`id="${id}"`);
  });

  it("gives the game bar's Players plate names and Friend marks from Zaisma, and friends playing outside the room with Join", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, multiplayer_mode, created_at_ms, updated_at_ms) VALUES ('g-arena', 'arena-game', 'Arena', 'live', 'listed', 'v1', 'relay', ?, ?)").bind(now, now).run();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, created_at_ms, updated_at_ms) VALUES ('g-solo', 'solo-game', 'Solo', 'live', 'listed', 'v1', ?, ?)").bind(now, now).run();
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const ben = new Browser();
    await join(ben, "quiet_comet@example.com", "Quiet_Comet");
    expect((await ben.go(`/friends/add/${await inviteFrom(ana)}`, {})).status).toBe(303);
    await join(new Browser(), "red_fox@example.com", "Red_Fox");
    const playerIdOf = async (email: string) => (await accountById(env.DB, users.get(email)!))!.player_id;
    const [anaPlayerId, benPlayerId, foxPlayerId] = [await playerIdOf("ana@example.com"), await playerIdOf("quiet_comet@example.com"), await playerIdOf("red_fox@example.com")];

    // Only games that go online get the button and the plate.
    const page = await (await ana.go("/g/arena-game")).text();
    expect(page).toContain('id="players-open"');
    expect(page).toMatch(/<dialog class="sheet glass placement-foot is-compact"[^>]* id="players"/);
    expect(page).toMatch(/<dialog class="sheet glass placement-foot" id="block"/);
    const solo = await (await ana.go("/g/solo-game")).text();
    expect(solo).not.toContain('id="players-open"');
    expect(solo).not.toContain('id="players"');

    // Names come from Zaisma, whatever the game called them; guests and the player themselves aren't listed.
    const among = async (b: Browser, playerIds: string[]) => {
      const response = await b.go(`/friends/among?player_ids=${playerIds.join(",")}`);
      return { status: response.status, answer: (await response.json()) as any };
    };
    const asked = [anaPlayerId, benPlayerId, foxPlayerId, "player_guest1"];
    const { answer: forAna } = await among(ana, asked);
    expect(forAna.players.sort((first: any, second: any) => first.name.localeCompare(second.name))).toEqual([
      { player_id: benPlayerId, name: "Quiet_Comet", is_friend: true },
      { player_id: foxPlayerId, name: "Red_Fox", is_friend: false },
    ]);
    // Signed out: the same names, nobody a friend.
    const { answer: forGuest } = await among(new Browser(), [benPlayerId]);
    expect(forGuest.players).toEqual([{ player_id: benPlayerId, name: "Quiet_Comet", is_friend: false }]);
    const tooMany = await among(ana, Array.from({ length: 101 }, (_, i) => `player_x${i}`));
    expect(tooMany).toMatchObject({ status: 400, answer: { error: { code: "bad_player_ids" } } });
    expect((await among(ana, ["not-a-player"])).answer.error.code).toBe("bad_player_ids");

    // Friends playing the game: Ben in a room, with Join, unless he's in the player's own room.
    await env.DB.prepare("INSERT INTO room_players (game_id, room_code, player_id, joined_at_ms, updated_at_ms) VALUES ('g-arena', 'ROOMAA', ?, ?, ?)").bind(benPlayerId, now, now).run();
    await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, created_at_ms, updated_at_ms) VALUES ('g-arena', 'ROOMAA', 2, 8, 1, ?, ?)").bind(now, now).run();
    await ben.go("/api/presence", undefined, { method: "POST", body: "{}" });
    expect((await new Browser().go("/g/arena-game/players/friends")).status).toBe(401);
    const friends = await (await ana.go("/g/arena-game/players/friends")).text();
    expect(friends).toContain("Quiet_Comet");
    expect(friends).toContain('href="/g/arena-game?room=ROOMAA"');
    // The friends part goes into the players sheet, so it's gallery components too.
    expect(pageProblems(friends)).toEqual([]);
    const inRoom = await (await ana.go("/g/arena-game/players/friends?room=ROOMAA")).text();
    expect(inRoom).not.toContain("Quiet_Comet");
    expect(inRoom).toContain("None of your friends are playing this right now.");
    expect(pageProblems(inRoom)).toEqual([]);
    // Join is grayed with the reason when it won't work.
    await env.DB.prepare("UPDATE accounts SET who_can_join = 'nobody' WHERE id = ?").bind(users.get("quiet_comet@example.com")!).run();
    const refused = await (await ana.go("/g/arena-game/players/friends?room=OTHERR")).text();
    expect(refused).toContain("Quiet_Comet isn&#39;t taking joins");
    expect(refused).toMatch(/<button class="shell cut-btn small" type="button" disabled>/);
    expect(refused).not.toContain('href="/g/arena-game?room=ROOMAA"');
    expect(pageProblems(refused)).toEqual([]);
  });

  it("shows Watch beside Join for a room that takes spectators, by Join's rules, live on a full or closed room", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, multiplayer_mode, created_at_ms, updated_at_ms) VALUES ('g-arena', 'arena-game', 'Arena', 'live', 'listed', 'v1', 'own', ?, ?)").bind(now, now).run();
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const ben = new Browser();
    await join(ben, "quiet_comet@example.com", "Quiet_Comet");
    expect((await ben.go(`/friends/add/${await inviteFrom(ana)}`, {})).status).toBe(303);
    const benPlayerId = (await accountById(env.DB, users.get("quiet_comet@example.com")!))!.player_id;
    await env.DB.prepare("INSERT INTO room_players (game_id, room_code, player_id, joined_at_ms, updated_at_ms) VALUES ('g-arena', 'ROOMAA', ?, ?, ?)").bind(benPlayerId, now, now).run();
    await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, created_at_ms, updated_at_ms) VALUES ('g-arena', 'ROOMAA', 2, 8, 1, ?, ?)").bind(now, now).run();
    await ben.go("/api/presence", undefined, { method: "POST", body: "{}" });
    const watchLink = 'href="/g/arena-game?room=ROOMAA&watch=1"';
    // An address's & is written &amp; in gallery buttons' markup, the same link to a browser.
    const pages = async () => (await Promise.all(["/friends", "/g/arena-game/friends", "/@Quiet_Comet", "/g/arena-game/players/friends"].map(async (path) => (await ana.go(path)).text()))).map((page) => page.replaceAll("&amp;", "&"));

    // A game server that doesn't take spectators: no Watch at all.
    for (const page of await pages()) {
      expect(page).toContain('href="/g/arena-game?room=ROOMAA"');
      expect(page).not.toContain(">Watch<");
    }
    // One that does: Watch beside Join, everywhere Join is.
    await env.DB.prepare("UPDATE live_rooms SET maximum_spectator_count = 20, spectator_count = 2").run();
    for (const page of await pages()) expect(page).toContain(watchLink);
    // A full or closed room can still be watched, while Join grays.
    await env.DB.prepare("UPDATE live_rooms SET is_open = 0").run();
    const closed = await (await ana.go("/friends")).text();
    expect(closed).toContain('data-reason="Match in progress"');
    expect(closed).toContain(watchLink);
    await env.DB.prepare("UPDATE live_rooms SET is_open = 1, player_count = 8").run();
    expect((await (await ana.go("/g/arena-game/players/friends")).text()).replaceAll("&amp;", "&")).toContain(watchLink);
    // No room for another spectator: grayed, with why (under the friend's name in the players sheet).
    await env.DB.prepare("UPDATE live_rooms SET spectator_count = 20").run();
    const [friendsPage, gameFriends, profile, playersFriends] = await pages();
    for (const page of [friendsPage!, profile!]) {
      expect(page).toContain('aria-label="Watch: Watching full"');
      expect(page).not.toContain(watchLink);
    }
    // On the game's page the refused door says why as a tag in its place, with no Watch link.
    expect(gameFriends).toContain('<span class="tag plain">Watching full</span>');
    expect(gameFriends).not.toContain(watchLink);
    expect(playersFriends).toContain("Watching full");
    expect(playersFriends).not.toContain(watchLink);
    await env.DB.prepare("UPDATE live_rooms SET spectator_count = 2").run();
    // Join's social rules gray Watch too: a private room, Join off for the game, a friend who doesn't take joins.
    await env.DB.prepare("UPDATE live_rooms SET friend_joins_enabled = 0").run();
    expect(await (await ana.go("/friends")).text()).toContain('aria-label="Watch: Private room"');
    await env.DB.prepare("UPDATE live_rooms SET friend_joins_enabled = 1").run();
    await env.DB.prepare("UPDATE games SET friend_joins_enabled = 0").run();
    expect(await (await ana.go("/g/arena-game/friends")).text()).toContain('<span class="tag plain">This game doesn&#39;t take joins</span>');
    await env.DB.prepare("UPDATE games SET friend_joins_enabled = 1").run();
    await env.DB.prepare("UPDATE accounts SET who_can_join = 'nobody' WHERE id = ?").bind(users.get("quiet_comet@example.com")!).run();
    const pagesNow = await pages();
    for (const page of [pagesNow[0]!, pagesNow[2]!]) {
      expect(page).toContain("Watch: Quiet_Comet isn&#39;t taking joins");
      expect(page).not.toContain("?room=ROOMAA");
    }
    expect(pagesNow[1]).toContain('<span class="tag plain">Quiet_Comet isn&#39;t taking joins</span>');
    expect(pagesNow[1]).not.toContain("?room=ROOMAA");
    expect(pagesNow[3]).toContain("Quiet_Comet isn&#39;t taking joins");
    expect(pagesNow[3]).not.toContain("?room=ROOMAA");
  });

  it("takes invites back, lets them run out, and keeps a few waiting at most", async () => {
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    const anaId = users.get("ana@example.com")!;
    const inviteCode = await inviteFrom(ana);
    await ana.go(`/friends/invites/${inviteCode}/remove`, {});
    expect(await friendInviteByCode(env.DB, inviteCode)).toBeNull();

    const expiring = await inviteFrom(ana);
    expect(await friendInviteByCode(env.DB, expiring, Date.now() + 8 * 86400_000)).toBeNull();
    await deleteExpiredFriendInvites(env.DB, Date.now() + 8 * 86400_000);
    expect(await friendInvitesOf(env.DB, anaId, 0)).toEqual([]);

    for (let i = 0; i < MAXIMUM_OPEN_FRIEND_INVITE_COUNT; i++) await inviteFrom(ana);
    expect(await (await ana.go("/friends/invites", {})).text()).toContain(`You have ${MAXIMUM_OPEN_FRIEND_INVITE_COUNT} invites waiting`);
    expect(await (await new Browser().go("/friends")).headers.get("location")).toBe(`/signin?next=${encodeURIComponent("/friends")}`);
  });
});

describe("profiles", () => {
  const inviteFrom = async (b: Browser) => new URL((await b.go("/friends/invites", {})).headers.get("location")!, SITE).searchParams.get("invite")!;
  const befriend = async (first: Browser, second: Browser) => second.go(`/friends/add/${await inviteFrom(first)}`, {});
  const checked: string[] = [];
  /** The 5-minute run, with an AI that holds anything saying "hold me". */
  const runCheck = () =>
    checkProfiles({ ...env, ANTHROPIC_API_KEY: "test-key" }, { ai: async (_key, _model, text) => (checked.push(text), text.includes("hold me") ? { verdict: "hold", reason: "Asks to talk elsewhere.", inputTokenCount: 5, outputTokenCount: 2 } : { verdict: "ok", reason: "", inputTokenCount: 5, outputTokenCount: 2 }) });
  async function ownedGame(accountId: string, slug: string, title: string, visibility = "listed") {
    const owner = await env.DB.prepare("INSERT INTO owners (id, kind, account_id, created_at_ms) VALUES (?, 'person', ?, 1) ON CONFLICT (account_id) DO UPDATE SET kind = 'person' RETURNING id").bind(`owner_${slug.replace(/-/g, "")}`, accountId).first<{ id: string }>();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, owner_id, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'v1', ?, 1, 1)").bind(`g-${slug}`, slug, title, visibility, owner!.id).run();
  }

  it("shows the header and published games to everyone, and the rest only past the owner's setting", async () => {
    const kit = new Browser();
    await join(kit, "kit@example.com", "Kit_Makes", { year: String(thisYear - 16), month: "1", day: "1" });
    const kitId = users.get("kit@example.com")!;
    await ownedGame(kitId, "sky-hopper", "Sky Hopper");
    await ownedGame(kitId, "secret-lab", "Secret Lab", "private");
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, created_at_ms, updated_at_ms) VALUES ('g-arena', 'arena', 'Arena', 'live', 'listed', 'v1', 1, 1)").run();
    await env.DB.prepare("INSERT INTO played (account_id, game_id, played_at_ms) VALUES (?, 'g-arena', ?)").bind(kitId, Date.now() - 3 * 86400_000).run();

    // Kit writes a name and bio; until the check passes, others see the username alone.
    const saved = await kit.go("/@Kit_Makes/edit", { display_name: "Kit", bio: "I make tiny games.\nMostly platformers." });
    expect(saved.headers.get("location")).toBe("/@Kit_Makes?saved");
    expect(await (await kit.go("/@Kit_Makes?saved")).text()).toContain("Others see your new name and bio once they&#39;re checked");
    const stranger = new Browser();
    expect(await (await stranger.go("/@Kit_Makes")).text()).not.toContain("I make tiny games");
    await runCheck();
    expect(checked.at(-1)).toContain("Bio: I make tiny games.\nMostly platformers.");

    // A 16-year-old starts private: strangers get the header, published games and the wall.
    const lower = await stranger.go("/@kit_makes");
    expect(lower.headers.get("location")).toBe("/@Kit_Makes");
    const wall = await (await stranger.go("/@Kit_Makes")).text();
    expect(wall).toContain("<h1>Kit</h1>");
    expect(wall).toContain("@Kit_Makes");
    expect(wall).toContain("Kit's profile is private.");
    expect(wall).toContain("Made by Kit");
    expect(wall).toContain('href="/g/sky-hopper"');
    expect(wall).not.toContain("secret-lab");
    expect(wall).not.toContain("I make tiny games");
    expect(wall).not.toContain('href="/g/arena"');
    // No links field for under-18s, and links sent anyway are refused.
    expect(await (await kit.go("/@Kit_Makes")).text()).not.toContain('name="link_url"');
    expect(await (await kit.go("/@Kit_Makes/edit", new URLSearchParams([["display_name", "Kit"], ["link_url", "https://instagram.com/kit"]]))).text()).toContain("Links can&#39;t be shown on this profile.");

    // A friend gets past the wall: the bio, and what Kit played with a rough time.
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    await befriend(kit, ana);
    const asFriend = await (await ana.go("/@Kit_Makes")).text();
    expect(asFriend).toContain("I make tiny games.\nMostly platformers.");
    expect(asFriend).not.toContain("profile is private");
    expect(asFriend).toContain('href="/g/arena"');
    expect(asFriend).toContain("this week");
    // The owner sees it as a friend or anyone would.
    expect(await (await kit.go("/@Kit_Makes?view_as=anyone")).text()).toContain("Kit's profile is private.");
    expect(await (await kit.go("/@Kit_Makes?view_as=friend")).text()).toContain('href="/g/arena"');

    // Opened to anyone (a setting of its own), strangers see the bio, but what Kit played stays with friends.
    const social = await kit.go("/account/social", { social_mode: "custom", ...FRIENDS_FOCUSED, who_sees_profile: "anyone" });
    expect(social.status).toBe(303);
    const open = await (await stranger.go("/@Kit_Makes")).text();
    expect(open).toContain("I make tiny games.");
    expect(open).not.toContain('href="/g/arena"');

    // The public profile is exactly what a stranger sees.
    const kitPlayerId = (await accountById(env.DB, kitId))!.player_id;
    const { player } = (await (await SELF.fetch(`${SITE}/api/dev/players/${kitPlayerId}`, { headers: { authorization: `Bearer ${(await createApiKey(env.DB, kitId, "test")).token}` } })).json()) as { player: Record<string, unknown> };
    expect(player).toMatchObject({ name: "Kit_Makes", display_name: "Kit", bio: "I make tiny games.\nMostly platformers.", link_urls: [], is_profile_private: false, profile_url: `${SITE}/@Kit_Makes`, played_games: [] });
    expect(player.published_games).toEqual([{ slug: "sky-hopper", title: "Sky Hopper", page_url: `${SITE}/g/sky-hopper` }]);
  });

  it("keeps both sides of a block at the wall, the same as a private profile, and its menu blocks and unblocks", async () => {
    const kit = new Browser();
    await join(kit, "kit@example.com", "Kit_Makes");
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night_Owl");
    for (const each of [kit, ana]) await each.go("/account/social", { social_mode: "custom", ...FRIENDS_FOCUSED, who_sees_profile: "anyone" });
    await kit.go("/@Kit_Makes/edit", { display_name: "Kit", bio: "I make tiny games." });
    await runCheck();
    await befriend(kit, ana);
    const kitPlayerId = (await accountById(env.DB, users.get("kit@example.com")!))!.player_id;

    // A friend's menu has Block, which asks first and says it ends the friendship.
    const asFriend = await (await ana.go("/@Kit_Makes")).text();
    expect(asFriend).toContain(`action="/friends/blocks/${kitPlayerId}"`);
    expect(asFriend).toContain("You&#39;re friends, so this ends that too.");
    expect((await ana.go(`/friends/blocks/${kitPlayerId}`, {})).headers.get("location")).toBe("/friends?blocked#blocked");

    // Ana sees Kit at the wall, with Unblock in her menu.
    const asBlocker = await (await ana.go("/@Kit_Makes")).text();
    expect(asBlocker).toContain("Kit's profile is private.");
    expect(asBlocker).not.toContain("I make tiny games");
    expect(asBlocker).toContain(`/friends/blocks/${kitPlayerId}/remove`);
    // Kit sees Ana's open profile as if it were private, with Block as anyone has it: never told.
    const asBlocked = await (await kit.go("/@Night_Owl")).text();
    expect(asBlocked).toContain("Night_Owl's profile is private.");
    expect(asBlocked).not.toContain("/remove");
    // Strangers still see Kit's whole profile.
    expect(await (await new Browser().go("/@Kit_Makes")).text()).toContain("I make tiny games.");

    expect((await ana.go(`/friends/blocks/${kitPlayerId}/remove`, {})).status).toBe(303);
    expect(await (await ana.go("/@Kit_Makes")).text()).toContain("I make tiny games.");
  });

  it("checks what players write, takes links on adult profiles, and lets a person decide what's held", async () => {
    const mia = new Browser();
    await join(mia, "mia@example.com", "Mia_Plays");
    const miaId = users.get("mia@example.com")!;
    // Contact details are refused at once, like chat.
    expect(await (await mia.go("/@Mia_Plays/edit", { display_name: "Mia", bio: "add me on snap" })).text()).toContain("Keep contact details");
    expect(await (await mia.go("/@Mia_Plays/edit", new URLSearchParams([["bio", "Hi"], ["link_url", "http://example.com"]]))).text()).toContain("isn&#39;t a link Zaisma can show");
    await mia.go("/@Mia_Plays/edit", new URLSearchParams([["display_name", "Mia"], ["bio", "hold me"], ["link_url", "instagram.com/mia"]]));
    expect(await accountById(env.DB, miaId)).toMatchObject({ display_name: "Mia", link_urls: "https://instagram.com/mia", profile_check_status: "pending" });
    await runCheck();
    expect(await accountById(env.DB, miaId)).toMatchObject({ profile_check_status: "held", profile_held_reason: "Asks to talk elsewhere." });
    expect(await (await mia.go("/@Mia_Plays")).text()).toContain("A person at Zaisma is looking at your name and bio");
    const stranger = new Browser();
    expect(await (await stranger.go("/@Mia_Plays")).text()).toContain("<h1>Mia_Plays</h1>");

    // The admin lets it through; links open through Leaving Zaisma. Mia is open and social, so anyone sees past the header.
    await mia.go("/account/social", { social_mode: "open_and_social", ...OPEN_AND_SOCIAL_ADULT });
    expect(await (await SELF.fetch("http://localhost/admin/profiles")).text()).toContain("Asks to talk elsewhere.");
    const miaPlayerId = (await accountById(env.DB, miaId))!.player_id;
    await SELF.fetch(`http://localhost/admin/profiles/${miaPlayerId}/show`, { method: "POST", body: new URLSearchParams(), redirect: "manual" });
    const shown = await (await stranger.go("/@Mia_Plays")).text();
    expect(shown).toContain("<h1>Mia</h1>");
    expect(shown).toContain(`/forum/out?to=${encodeURIComponent("https://instagram.com/mia")}`);

    // Three reports hide the words again, until a person looks; Clear empties them.
    for (const [i, name] of ["Ann_One", "Ben_Two", "Cat_Three"].entries()) {
      const reporter = new Browser();
      await join(reporter, `r${i}@example.com`, name);
      expect((await reporter.go("/@Mia_Plays/report", { reason: "harassment" })).headers.get("location")).toBe("/@Mia_Plays?reported");
    }
    expect(await accountById(env.DB, miaId)).toMatchObject({ profile_check_status: "held", profile_held_reason: "Reported: Harassing or bullying (3 reports)" });
    await SELF.fetch(`http://localhost/admin/profiles/${miaPlayerId}/clear`, { method: "POST", body: new URLSearchParams(), redirect: "manual" });
    expect(await accountById(env.DB, miaId)).toMatchObject({ display_name: null, bio: null, link_urls: "", profile_check_status: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS report_count FROM profile_reports").first("report_count")).toBe(0);
  });

  it("shows friends in common but never the friend list, and links names to profiles", async () => {
    const [ana, ben, cal] = [new Browser(), new Browser(), new Browser()];
    await join(ana, "ana@example.com", "Night_Owl");
    await join(ben, "ben@example.com", "Ben_Builds");
    await join(cal, "cal@example.com", "Cal_Quest");
    await befriend(ana, cal);
    await befriend(ben, cal);
    await befriend(ana, ben);
    const seen = await (await ana.go("/@Ben_Builds")).text();
    expect(seen).toContain("Friends you both have");
    expect(seen).toContain('href="/@Cal_Quest"');
    // Ben's own page never lists his friends, and /friends links each face to its profile.
    expect(await (await ben.go("/@Ben_Builds")).text()).not.toContain("Cal_Quest");
    expect(await (await ana.go("/friends")).text()).toContain('href="/@Ben_Builds"');
    expect((await new Browser().go("/@Nobody_Here")).status).toBe(404);
  });
});

describe("game owners", () => {
  it("admin gives a game to an account, and it shows on their account page", async () => {
    const b = new Browser();
    await join(b);
    const id = users.get("fox@example.com")!;
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, created_at_ms, updated_at_ms) VALUES ('g1', 'owl-game', 'Owl Game', 'live', ?, ?)").bind(now, now).run();

    const bad = await SELF.fetch("http://localhost/admin/games/g1/owner", { method: "POST", body: new URLSearchParams({ account_id: "nope" }) });
    expect(await bad.text()).toContain("No account with that ID");
    await SELF.fetch("http://localhost/admin/games/g1/owner", { method: "POST", body: new URLSearchParams({ account_id: id }), redirect: "manual" });
    const owner = await gameOwner(env.DB, (await gameById(env.DB, "g1"))!.owner_id);
    expect(owner).toMatchObject({ name: "Night_Owl", owner: { kind: "person", account_id: id } });
    expect(await (await b.go("/account")).text()).toContain("Owl Game");

    // Deleting the account deletes the game, and its link is never given to another game.
    await b.go("/account/delete", { confirm: "delete" });
    await vi.waitFor(async () => expect(await gameById(env.DB, "g1")).toBeNull());
    expect(await isSlugRetired(env.DB, "owl-game")).toBe(true);
  });
});

describe("pages", () => {
  it("adds a sign-in link, a privacy page, and keeps account pages out of caches and search", async () => {
    const home = await (await SELF.fetch(`${SITE}/`)).text();
    expect(home).toContain('href="/signin"');
    expect(home).toContain('href="/legal/privacy"');
    // A page that doesn't know who's looking swaps Sign in for the account from the signed-in cookie.
    expect(await (await SELF.fetch(`${SITE}/legal/privacy`)).text()).toMatch(/<script src="\/js\/account-link\.[0-9a-f]{16}\.js"><\/script>/);
    expect(await (await SELF.fetch(`${SITE}/legal/privacy`)).text()).toContain("it is deleted when you turn 18");
    const terms = await SELF.fetch(`${SITE}/legal/terms`);
    expect(terms.status).toBe(200);
    const termsPage = await terms.text();
    for (const heading of ["Terms of service", "Who this is between", "Your account", "Privacy", "Closing accounts", "Your games are yours", "Commitments to developers", "Content rules and takedowns", "Hosting credit", "Zaisma Pro", "Purchases and age", "Disclaimer and limitation of liability", "Disputes", "Changes", "Contact"])
      expect(termsPage).toMatch(new RegExp(`<h[12]>${heading}</h[12]>`));
    expect(termsPage).toContain("refundable to its card on request for 30 days");
    expect(await (await SELF.fetch(`${SITE}/legal/dmca`)).text()).toContain("<h2>Repeat infringers</h2>");
    expect(home).toContain('href="/legal/terms"');
    expect((await SELF.fetch(`${SITE}/signin`)).headers.get("cache-control")).toBe("no-store");
    expect(await (await SELF.fetch(`${SITE}/robots.txt`)).text()).toContain("Disallow: /account");
  });
});

describe("the header and the theme", () => {
  it("says Sign in signed out, and shows your account and its menu signed in", async () => {
    const out = await (await new Browser().go("/")).text();
    expect(out).toMatch(/<a class="[^"]*run-wrap[^"]*" href="\/signin"/);
    expect(out).not.toContain('class="me');
    const b = new Browser();
    await join(b, null);
    const home = await (await b.go("/")).text();
    expect(home).toContain('aria-label="Your account, Night_Owl"');
    expect(home).not.toMatch(/<a class="[^"]*run-wrap[^"]*" href="\/signin"/);
    const menu = home.slice(home.indexOf('class="dropdown'));
    for (const [words, href] of [["Your profile", "/@Night_Owl"], ["Friends", "/friends"], ["Developer", "/dashboard"], ["Settings", "/account"]]) expect(menu).toMatch(new RegExp(`href="${href}"[^>]*>[\\s\\S]*?${words}`));
    expect(menu).toMatch(/<form class="dropdown-form" method="post" action="\/signout">[\s\S]*?Sign out/);
    // A page that knows who's looking isn't kept by any cache.
    expect((await b.go("/")).headers.get("cache-control")).toBe("no-store");
  });

  it("opens the Developer and Forum tabs on developer pages and folds them away elsewhere", async () => {
    const b = new Browser();
    await join(b, null);
    const tabOf = (page: string, words: string) => page.match(new RegExp(`<a class="[^"]*" data-lights href="[^"]*"[^>]*>${words}</a>`))?.[0] ?? "";
    const dashboard = await (await b.go("/dashboard")).text();
    expect(tabOf(dashboard, "Developer")).toBe('<a class="flush-row quiet foldable" data-lights href="/dashboard" aria-current="page">Developer</a>');
    expect(tabOf(dashboard, "Forum")).toBe('<a class="flush-row quiet foldable" data-lights href="/forum">Forum</a>');
    const home = await (await b.go("/")).text();
    expect(tabOf(home, "Developer")).toBe('<a class="flush-row quiet foldable folded" data-lights href="/dashboard" tabindex="-1" aria-hidden="true">Developer</a>');
    expect(tabOf(home, "Home")).toBe('<a class="flush-row quiet" data-lights href="/" aria-current="page">Home</a>');
  });

  it("starts every account on System, and saves Light or Dark for its pages", async () => {
    const b = new Browser();
    await join(b, null);
    expect(await (await b.go("/account")).text()).toContain('<html lang="en" data-theme-choice="system">');
    const saved = await b.go("/account/color-theme", { color_theme: "dark" });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/account?theme-saved#theme");
    expect(await accountById(env.DB, await idOf("Night_Owl"))).toMatchObject({ color_theme: "dark" });
    for (const path of ["/", "/account", "/friends", "/forum", "/dashboard"]) expect(await (await b.go(path)).text(), path).toContain('data-theme-choice="dark"');
    // A fixed theme has one browser color; System has one for each.
    const home = await (await b.go("/")).text();
    expect(home).toContain('<meta name="theme-color" content="#121110">');
    expect(home).not.toContain('media="(prefers-color-scheme: light)"');
    expect((await b.go("/account/color-theme", { color_theme: "purple" })).status).toBe(400);
    expect(await accountById(env.DB, await idOf("Night_Owl"))).toMatchObject({ color_theme: "dark" });
    // Guests always follow their device.
    expect(await (await new Browser().go("/")).text()).toContain('data-theme-choice="system"');
  });
});

describe("playing as your account", () => {
  it("gives a signed-in player a key to their account's passes, and anyone else a guest's", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, multiplayer_mode, created_at_ms, updated_at_ms) VALUES ('g-arena', 'arena-game', 'Arena', 'live', 'listed', 'v1', 'relay', ?, ?)").bind(now, now).run();
    // Cloudflare's check on Play says each browser is real.
    const withSupabase = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      // The Play check's token; making an account goes on to the usual stand-in.
      String(input instanceof Request ? input.url : input).startsWith("https://challenges.cloudflare.com/") && new URLSearchParams(String(init?.body)).get("response") === "good" ? Promise.resolve(Response.json({ success: true, action: "play", hostname: "zaisma.test" })) : withSupabase(input, init),
    );
    const play = async (b: Browser) => (await b.go("/api/plays/arena-game", undefined, { method: "POST", body: JSON.stringify({ first: null, last: null, cfirst: null, clast: null, token: "good" }) })).json<{ key: string; playerKind: string }>();
    const keyAccount = (key: string) => env.DB.prepare("SELECT account_id FROM room_keys WHERE id = ?").bind(key).first<{ account_id: string | null }>();

    const guest = await play(new Browser());
    expect(guest.playerKind).toBe("guest");
    expect(await keyAccount(guest.key)).toEqual({ account_id: null });

    const b = new Browser();
    await join(b);
    const signedIn = await play(b);
    expect(signedIn.playerKind).toBe("account");
    expect(await keyAccount(signedIn.key)).toEqual({ account_id: users.get("fox@example.com") });
    // Every account has its own player ID, the same in every game, apart from the sign-in's ID.
    const account = await accountById(env.DB, users.get("fox@example.com")!);
    expect(account?.player_id).toMatch(/^player_[a-z0-9]{20}$/);
  });

  it("trades a guest's key for the account's when they sign in while the game runs", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, multiplayer_mode, created_at_ms, updated_at_ms) VALUES ('g-arena', 'arena-game', 'Arena', 'live', 'listed', 'v1', 'relay', ?, ?)").bind(now, now).run();
    const withSupabase = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      // The Play check's token; making an account goes on to the usual stand-in.
      String(input instanceof Request ? input.url : input).startsWith("https://challenges.cloudflare.com/") && new URLSearchParams(String(init?.body)).get("response") === "good" ? Promise.resolve(Response.json({ success: true, action: "play", hostname: "zaisma.test" })) : withSupabase(input, init),
    );
    const b = new Browser();
    const guest = await (await b.go("/api/plays/arena-game", undefined, { method: "POST", body: JSON.stringify({ first: null, last: null, cfirst: null, clast: null, token: "good" }) })).json<{ key: string; playerKind: string }>();
    expect(guest.playerKind).toBe("guest");
    const signedIn = (body: unknown, origin = SITE) => b.go("/api/plays/arena-game/account", undefined, { method: "POST", body: JSON.stringify(body), origin });
    // Still a guest: nothing to trade.
    expect((await signedIn({ roomKey: guest.key })).status).toBe(401);

    const issued = await env.DB.prepare("SELECT issued_at_ms FROM room_keys WHERE id = ?").bind(guest.key).first<{ issued_at_ms: number }>();
    await join(b);
    const traded = await (await signedIn({ roomKey: guest.key })).json<{ player: unknown; key: string; playerKind: string }>();
    const account = (await accountById(env.DB, users.get("fox@example.com")!))!;
    expect(traded).toEqual({ player: { id: account.player_id, name: "Night_Owl", kind: "account" }, key: expect.stringMatching(/^room_key_[a-z0-9]+$/), playerKind: "account" });
    // The account's key runs out when the guest's would have, and the guest's is gone, so it trades once.
    const keys = await env.DB.prepare("SELECT id, account_id, issued_at_ms FROM room_keys WHERE id IN (?, ?)").bind(guest.key, traded.key).all<{ id: string; account_id: string | null }>();
    expect(keys.results).toEqual([{ id: traded.key, account_id: account.id, issued_at_ms: issued!.issued_at_ms }]);
    expect(await (await signedIn({ roomKey: guest.key })).json()).toEqual({ player: traded.player });
    // A game with no key (single-player): just who the player is now.
    expect(await (await signedIn({})).json()).toEqual({ player: traded.player });
    // Only from Zaisma's own pages.
    expect((await signedIn({}, "https://evil.test")).status).toBe(403);
  });
});

describe("cloud saves", () => {
  async function liveGame(slug = "owl-game", cloudSaves = 1) {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, cloud_saves_enabled, created_at_ms, updated_at_ms) VALUES (?, ?, 'Owl Game', 'live', ?, ?, ?)")
      .bind(`g-${slug}`, slug, cloudSaves, now, now)
      .run();
    return `g-${slug}`;
  }
  /** The tag the game page's GET answers, which every change it makes carries. */
  const tagOf = async (b: Browser, slug = "owl-game") => ((await (await b.go(`/api/saves/${slug}`)).json()) as { tag: string }).tag;
  const put = async (b: Browser, baseVersionNumber: number, saveData: Record<string, string>, slug = "owl-game") =>
    b.go(`/api/saves/${slug}`, undefined, { method: "PUT", body: JSON.stringify({ tag: await tagOf(b, slug), base_version_number: baseVersionNumber, save_json: JSON.stringify(saveData) }) });
  /** The account's save in a game, as stored now. */
  const storedNow = async (accountId: string, gameId: string) => {
    const row = await env.DB.prepare("SELECT * FROM saves WHERE account_id = ? AND game_id = ?").bind(accountId, gameId).first<{ account_id: string; game_id: string; version_number: number; sha256: string }>();
    return row ? storedSaveText(env, row) : null;
  };

  it("stores a save, hands it back, and refuses an out-of-date one", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    const empty = (await (await b.go("/api/saves/owl-game")).json()) as { tag: string; version_number: number };
    expect(empty.version_number).toBe(0);
    expect(empty.tag).toMatch(/^[0-9a-f]{16}$/);

    const first = await put(b, 0, { level: "3", coins: "120" });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ version_number: 1, saved_at: expect.stringMatching(/Z$/) });
    const got = (await (await b.go("/api/saves/owl-game")).json()) as { version_number: number; save_data: Record<string, string>; sha256: string };
    expect(got).toMatchObject({ version_number: 1, save_data: { save_format_version_number: 1, local_storage_items: { coins: "120", level: "3" }, indexeddb_databases: [] } });
    expect(await storedNow(users.get("fox@example.com")!, gameId)).toBe(savedText({ level: "3", coins: "120" }));

    // A second device that loaded version 0 can't overwrite version 1.
    const stale = await put(b, 0, { level: "1" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version_number: 1 });
    expect((await put(b, 1, { level: "4" })).status).toBe(200);
    expect((await put(b, 1, { level: "5" })).status).toBe(409);
  });

  it("answers a save the account already has with its version, and keeps no copy of it", async () => {
    await liveGame();
    const b = new Browser();
    await join(b);
    const first = (await (await put(b, 0, { level: "3" })).json()) as { version_number: number; sha256: string; saved_at: string };
    // Sent again after its answer was lost, from the version it started from: saved already.
    const again = await put(b, 0, { level: "3" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ version_number: 1, sha256: first.sha256, saved_at: first.saved_at, kept_save_copy_id: null });
    // A device keeping progress that is exactly the account's save keeps nothing.
    const kept = await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ tag: await tagOf(b), keep: true, save_json: JSON.stringify({ level: "3" }) }) });
    expect(await kept.json()).toEqual({ is_kept: false, save_copy_id: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS copy_count FROM save_history").first()).toEqual({ copy_count: 0 });
    // A save another device made first answers 409 with that save's sha256, so the page can tell its own from another's.
    const stale = await put(b, 0, { level: "4" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version_number: 1, sha256: first.sha256, changed_by_kind: "player" });
  });

  it("refuses a change from a page loaded for another account, leaving this account's save as it was", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b, "a@example.com", "Player_One");
    const tagOfOne = await tagOf(b);
    await put(b, 0, { level: "3" });
    // Another account signs in on the same browser, while the page still holds the first account's tag.
    await b.go("/signout", {});
    await join(b, "b@example.com", "Player_Two");
    const accountTwo = await idOf("Player_Two");
    expect((await put(b, 0, { level: "1" })).status).toBe(200);
    const accountChanged = { error: "account_changed", message: "Another account is signed in now." };
    for (const body of [
      { tag: tagOfOne, base_version_number: 1, save_json: JSON.stringify({ level: "99" }) },
      { tag: tagOfOne, keep: true, save_json: JSON.stringify({ level: "99" }) },
    ]) {
      const refused = await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify(body) });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual(accountChanged);
    }
    // Without a tag at all, it's a bad save.
    expect((await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ base_version_number: 1, save_json: "{}" }) })).status).toBe(400);
    expect(await storedNow(accountTwo, gameId)).toBe(savedText({ level: "1" }));
    expect(await env.DB.prepare("SELECT COUNT(*) AS copy_count FROM save_history").first()).toEqual({ copy_count: 0 });
  });

  it("leaves the save as it was when its file can't be stored, never naming a version it doesn't have", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    await put(b, 0, { level: "3" });
    const tag = await tagOf(b);
    b.bindings = { SAVES: { get: env.SAVES.get.bind(env.SAVES), delete: env.SAVES.delete.bind(env.SAVES), put: () => Promise.reject(new Error("R2 is down")) } as unknown as R2Bucket };
    // The Worker fails the request (the runtime answers 500).
    await expect(b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ tag, base_version_number: 1, save_json: JSON.stringify({ level: "4" }) }) })).rejects.toThrow("R2 is down");
    b.bindings = null;
    expect(await (await b.go("/api/saves/owl-game")).json()).toMatchObject({ version_number: 1, sha256: await sha256Hex(new TextEncoder().encode(savedText({ level: "3" }))), save_data: { local_storage_items: { level: "3" } } });
    expect(await storedNow(users.get("fox@example.com")!, gameId)).toBe(savedText({ level: "3" }));
  });

  it("tells the game page when the developer changed the save, so it takes it without asking", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    await put(b, 0, { level: "3" });
    expect(await (await b.go("/api/saves/owl-game?version")).json()).toMatchObject({ version_number: 1, changed_by_kind: "player" });
    await changeSaveAsDeveloper(env, users.get("fox@example.com")!, gameId, () => savedText({ level: "10" }), null);
    expect(await (await b.go("/api/saves/owl-game?version")).json()).toMatchObject({ version_number: 2, changed_by_kind: "developer" });
    expect(await (await b.go("/api/saves/owl-game")).json()).toMatchObject({ version_number: 2, changed_by_kind: "developer", save_data: { local_storage_items: { level: "10" } } });
    // The open game's next save started from version 1: refused, saying the developer moved it on.
    const stale = await put(b, 1, { level: "4" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version_number: 2, changed_by_kind: "developer" });
    // Once the game saves from the developer's version, the save is the player's again.
    expect((await put(b, 2, { level: "11" })).status).toBe(200);
    expect(await (await b.go("/api/saves/owl-game?version")).json()).toMatchObject({ version_number: 3, changed_by_kind: "player" });
  });

  it("stores saves from games that also keep IndexedDB databases", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    const save = { idb: [{ name: "/idbfs", version: 21, stores: [{ name: "FILE_DATA", keyPath: null, autoIncrement: false, indexes: [], records: [["/idbfs/save", { contents: { $z: ["view", "Uint8Array", "Bw=="] } }]] }] }], local: { b: "2", a: "1" } };
    const res = await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ tag: await tagOf(b), base_version_number: 0, save_json: JSON.stringify(save) }) });
    expect(res.status).toBe(200);
    // Sent in the shape from before v1, stored as v1.
    const text = canonicalSave(saveFromParts(save.local, save.idb));
    expect(text.startsWith('{"save_format_version_number":1,"local_storage_items":{"a":"1","b":"2"},"indexeddb_databases":[{"name":"/idbfs"')).toBe(true);
    expect(await storedNow(users.get("fox@example.com")!, gameId)).toBe(text);
    const got = (await (await b.go("/api/saves/owl-game")).json()) as { save_data: unknown; sha256: string };
    expect(got.save_data).toEqual(JSON.parse(text));
    expect(got.sha256).toBe(await sha256Hex(new TextEncoder().encode(text)));
  });

  it("labels a save with the game version the page reported, only when it's a version of this game", async () => {
    const gameId = await liveGame();
    const otherGameId = await liveGame("other-game");
    const insertVersion = (versionId: string, forGameId: string) =>
      env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, 'x', 1, 1, 'approved', 0)").bind(versionId, forGameId).run();
    await insertVersion("version_owl1", gameId);
    await insertVersion("version_other1", otherGameId);
    const b = new Browser();
    await join(b);
    const accountId = users.get("fox@example.com")!;
    const versionIdNow = async () => (await env.DB.prepare("SELECT version_id FROM saves WHERE account_id = ? AND game_id = ?").bind(accountId, gameId).first<{ version_id: string | null }>())!.version_id;
    const tag = await tagOf(b);
    const putVersion = (baseVersionNumber: number, versionId: unknown) =>
      b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ tag, base_version_number: baseVersionNumber, save_json: JSON.stringify({ level: String(baseVersionNumber) }), version_id: versionId }) });
    expect((await putVersion(0, "version_owl1")).status).toBe(200);
    expect(await versionIdNow()).toBe("version_owl1");
    // Another game's version, junk or none: still saved, with no label.
    expect((await putVersion(1, "version_other1")).status).toBe(200);
    expect(await versionIdNow()).toBeNull();
    expect((await putVersion(2, "<script>")).status).toBe(200);
    expect(await versionIdNow()).toBeNull();
    expect((await putVersion(3, 7)).status).toBe(200);
    expect(await versionIdNow()).toBeNull();
    // The developer's writes have no game version behind them.
    expect((await putVersion(4, "version_owl1")).status).toBe(200);
    await changeSaveAsDeveloper(env, accountId, gameId, () => savedText({ level: "dev" }), null);
    expect(await versionIdNow()).toBeNull();
  });

  it("rewrites a save stored before v1 the first time it's read, and only then", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    const accountId = users.get("fox@example.com")!;
    await put(b, 0, { level: "3" });
    // As a save from before v1 was stored: a bare localStorage object, with its hash.
    const legacy = JSON.stringify({ level: "3" });
    await env.SAVES.put(unversionedSaveKey(accountId, gameId), legacy, { customMetadata: { version_number: "1" } });
    await env.DB.prepare("UPDATE saves SET sha256 = ?, size_bytes = ? WHERE account_id = ?").bind(await sha256Hex(new TextEncoder().encode(legacy)), legacy.length, accountId).run();
    const text = savedText({ level: "3" });
    const got = (await (await b.go("/api/saves/owl-game")).json()) as { sha256: string; save_data: unknown };
    expect(got).toMatchObject({ sha256: await sha256Hex(new TextEncoder().encode(text)), save_data: JSON.parse(text) });
    const object = (await env.SAVES.get(unversionedSaveKey(accountId, gameId)))!;
    expect(await object.text()).toBe(text);
    expect(object.customMetadata).toEqual({ version_number: "1" });
    expect(await env.DB.prepare("SELECT sha256, size_bytes FROM saves WHERE account_id = ?").bind(accountId).first()).toEqual({ sha256: got.sha256, size_bytes: text.length });
    // The second read writes nothing.
    expect(await (await b.go("/api/saves/owl-game")).json()).toEqual(got);
    expect((await env.SAVES.get(unversionedSaveKey(accountId, gameId)))!.etag).toBe(object.etag);
  });

  it("keeps saves apart per player", async () => {
    await liveGame();
    const a = new Browser();
    await join(a, "a@example.com", "Player_One");
    const b = new Browser();
    await join(b, "b@example.com", "Player_Two");
    await put(a, 0, { secret: "a" });
    expect(((await (await b.go("/api/saves/owl-game")).json()) as { version_number: number }).version_number).toBe(0);
  });

  it("refuses guests, other sites, bad saves, big saves and games that keep their own", async () => {
    await liveGame();
    await liveGame("own-saves", 0);
    expect((await new Browser().go("/api/saves/owl-game")).status).toBe(401);
    const b = new Browser();
    await join(b);
    expect((await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ base_version_number: 0, save_json: "{}" }), origin: "https://owl-game.games.example" })).status).toBe(403);
    expect((await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ base_version_number: 0, save_json: '{"a":1}' }) })).status).toBe(400);
    expect((await put(b, 0, { big: "x".repeat(5 * 1024 * 1024) })).status).toBe(413);
    expect((await b.go("/api/saves/own-saves")).status).toBe(404);
  });

  it("deletes saves with the account", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    const id = users.get("fox@example.com")!;
    await put(b, 0, { level: "9" });
    await b.go("/account/delete", { confirm: "delete" });
    expect((await env.SAVES.list({ prefix: `${id}/${gameId}` })).objects).toEqual([]);
    expect(await env.DB.prepare("SELECT * FROM saves").first()).toBeNull();
  });

  describe("earlier versions", () => {
    const id = () => users.get("fox@example.com")!;
    const copies = async () => (await env.DB.prepare("SELECT * FROM save_history ORDER BY saved_at_ms DESC, rowid DESC").all<{ id: string; copy_reason: string; saved_at_ms: number; sha256: string }>()).results;
    // Pretend the history was made earlier, so the next save is due an hourly copy.
    const age = (ms: number) => env.DB.prepare("UPDATE save_history SET saved_at_ms = saved_at_ms - ?").bind(ms).run();
    const putWith = async (b: Browser, body: Record<string, unknown>) => b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ tag: await tagOf(b), ...body }) });

    it("keeps a copy about once an hour, not on every save", async () => {
      const gameId = await liveGame();
      const b = new Browser();
      await join(b);
      await put(b, 0, { level: "1" });
      await put(b, 1, { level: "2" });
      // The first overwrite keeps a copy: there's nothing in the history yet.
      expect((await copies()).map((c) => c.copy_reason)).toEqual(["hourly"]);
      await put(b, 2, { level: "3" });
      expect(await copies()).toHaveLength(1);
      await age(2 * 3600_000);
      await put(b, 3, { level: "4" });
      const list = await copies();
      expect(list).toHaveLength(2);
      expect(await env.SAVES.get(`${id()}/${gameId}/${list[0]!.id}.json`).then((o) => o?.text())).toBe(savedText({ level: "3" }));
    });

    it("keeps what's about to be lost: replaced progress, a shrunken save and the device's progress", async () => {
      await liveGame();
      const b = new Browser();
      await join(b);
      // Enough items that the save shrinks to under half, envelope and all.
      const items = "sword,shield,bow,lantern,rope,map,compass,potion,".repeat(3);
      await put(b, 0, { level: "9", coins: "5000", items });
      await put(b, 1, { level: "10", coins: "5100", items });
      await putWith(b, { base_version_number: 2, save_json: JSON.stringify({ level: "11", coins: "5200", items }), replace: true });
      await put(b, 3, { level: "1" });
      const kept = await putWith(b, { keep: true, save_json: JSON.stringify({ phone: "progress" }) });
      expect(kept.status).toBe(200);
      const keptAnswer = (await kept.json()) as { is_kept: boolean; save_copy_id: string };
      expect(keptAnswer).toEqual({ is_kept: true, save_copy_id: expect.stringMatching(/^save_copy_[a-z0-9]{20}$/) });
      // Keeping the same progress again answers the copy that already holds it.
      expect(await (await putWith(b, { keep: true, save_json: JSON.stringify({ phone: "progress" }) })).json()).toEqual(keptAnswer);
      expect((await copies()).map((c) => c.copy_reason)).toEqual(["device_lost", "smaller", "account_lost", "hourly"]);
      // Keeping the device's progress doesn't touch the account's save.
      expect(((await (await b.go("/api/saves/owl-game")).json()) as { version_number: number }).version_number).toBe(4);
    });

    it("dates a device's kept progress to when the device last played it, never later than now", async () => {
      const gameId = await liveGame();
      await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('version_owl1', ?, 'x', 1, 1, 'approved', 0)").bind(gameId).run();
      const b = new Browser();
      await join(b);
      await put(b, 0, { level: "9" });
      const keep = async (playedAt: unknown, level: string) => {
        const answer = (await (await putWith(b, { keep: true, save_json: JSON.stringify({ level }), version_id: "version_owl1", played_at: playedAt })).json()) as { save_copy_id: string };
        return (await env.DB.prepare("SELECT copy_reason, saved_at_ms, version_id FROM save_history WHERE id = ?").bind(answer.save_copy_id).first<{ copy_reason: string; saved_at_ms: number; version_id: string | null }>())!;
      };
      const playedAtMs = Date.now() - 3 * 3600_000;
      expect(await keep(new Date(playedAtMs).toISOString(), "1")).toEqual({ copy_reason: "device_lost", saved_at_ms: playedAtMs, version_id: "version_owl1" });
      // A time in the future, none or junk: now.
      for (const [playedAt, level] of [[new Date(Date.now() + 86_400_000).toISOString(), "2"], [null, "3"], ["yesterday-ish", "4"]] as const) {
        const before = Date.now();
        const copy = await keep(playedAt, level);
        expect(copy.saved_at_ms).toBeGreaterThanOrEqual(before);
        expect(copy.saved_at_ms).toBeLessThanOrEqual(Date.now());
      }
      // The copies list in the order they were played.
      const listed = (await (await b.go("/api/saves/owl-game/copies")).json()) as { save_copies: { saved_at: string; version_id: string | null }[] };
      expect(listed.save_copies.at(-1)).toMatchObject({ saved_at: new Date(playedAtMs).toISOString(), version_id: "version_owl1" });
    });

    it("rewrites a copy stored before v1 the first time it's read, and restores it with its version", async () => {
      const gameId = await liveGame();
      const b = new Browser();
      await join(b);
      await put(b, 0, { level: "1" });
      await put(b, 1, { level: "2" });
      const [copy] = await copies();
      const legacy = JSON.stringify({ level: "1" });
      await env.SAVES.put(`${id()}/${gameId}/${copy!.id}.json`, legacy);
      await env.DB.prepare("UPDATE save_history SET sha256 = ?, size_bytes = ?, version_id = 'version_owl1' WHERE id = ?").bind(await sha256Hex(new TextEncoder().encode(legacy)), legacy.length, copy!.id).run();
      const text = savedText({ level: "1" });
      const sha256 = await sha256Hex(new TextEncoder().encode(text));
      expect(await (await b.go(`/api/saves/owl-game/copies/${copy!.id}`)).json()).toMatchObject({ save_copy: { size_bytes: text.length, version_id: "version_owl1", local_storage_items: { level: "1" } } });
      expect(await env.SAVES.get(`${id()}/${gameId}/${copy!.id}.json`).then((o) => o?.text())).toBe(text);
      expect((await copies())[0]!.sha256).toBe(sha256);
      // Going back to it makes it the save, labelled with the copy's version.
      expect(await (await b.go(`/api/saves/owl-game/copies/${copy!.id}/restore`, undefined, { method: "POST", body: JSON.stringify({ tag: await tagOf(b) }) })).json()).toMatchObject({ sha256 });
      expect(await env.DB.prepare("SELECT version_id FROM saves WHERE game_id = ?").bind(gameId).first()).toEqual({ version_id: "version_owl1" });
    });

    it("upgrades a save's copies when it's upgraded, so a copy of the same progress is the current save", async () => {
      const gameId = await liveGame();
      const b = new Browser();
      await join(b);
      const accountId = users.get("fox@example.com")!;
      await put(b, 0, { level: "1" });
      await put(b, 1, { level: "2" });
      const [copy] = await copies();
      // The save and its copy, both stored before v1 with the same progress, and so with the same old hash.
      const legacy = JSON.stringify({ level: "2" });
      const legacyHash = await sha256Hex(new TextEncoder().encode(legacy));
      await env.SAVES.put(unversionedSaveKey(accountId, gameId), legacy, { customMetadata: { version_number: "2" } });
      await env.SAVES.put(`${id()}/${gameId}/${copy!.id}.json`, legacy);
      await env.DB.prepare("UPDATE saves SET sha256 = ?, size_bytes = ? WHERE account_id = ?").bind(legacyHash, legacy.length, accountId).run();
      await env.DB.prepare("UPDATE save_history SET sha256 = ?, size_bytes = ? WHERE id = ?").bind(legacyHash, legacy.length, copy!.id).run();
      // The first read of the save upgrades the copy too, without anyone opening it.
      await b.go("/api/saves/owl-game");
      const text = savedText({ level: "2" });
      expect(await env.DB.prepare("SELECT sha256, size_bytes FROM save_history WHERE id = ?").bind(copy!.id).first()).toEqual({ sha256: await sha256Hex(new TextEncoder().encode(text)), size_bytes: text.length });
      const listed = (await (await b.go("/api/saves/owl-game/copies")).json()) as { save_copies: { id: string; is_current_save: boolean }[] };
      expect(listed.save_copies.find((savedCopy) => savedCopy.id === copy!.id)!.is_current_save).toBe(true);
    });

    it("keeps five, dropping routine copies before ones from right before progress was lost", async () => {
      await liveGame();
      const b = new Browser();
      await join(b);
      await put(b, 0, { level: "0" });
      await putWith(b, { base_version_number: 1, save_json: JSON.stringify({ level: "1" }), replace: true });
      for (let v = 2; v <= 8; v++) {
        await age(2 * 3600_000);
        await put(b, v, { level: String(v) });
      }
      const list = await copies();
      expect(list).toHaveLength(5);
      expect(list.at(-1)!.copy_reason).toBe("account_lost");
      const files = await env.SAVES.list({ prefix: `${id()}/g-owl-game/save_copy_` });
      expect(files.objects).toHaveLength(5);
    });

    it("answers which copy holds the progress a save replaced", async () => {
      await liveGame();
      const b = new Browser();
      await join(b);
      expect(await (await put(b, 0, { level: "1" })).json()).toMatchObject({ version_number: 1, kept_save_copy_id: null });
      const replacing = (await (await putWith(b, { base_version_number: 1, save_json: JSON.stringify({ level: "2" }), replace: true })).json()) as { kept_save_copy_id: string };
      expect(replacing.kept_save_copy_id).toBe((await copies())[0]!.id);
      // Nothing kept: the next save within the hour replaces it without a copy.
      expect(await (await put(b, 2, { level: "3" })).json()).toMatchObject({ kept_save_copy_id: null });
    });

    it("has no save screens on the account page, but the game lists, reads and restores the player's copies", async () => {
      const gameId = await liveGame();
      const a = new Browser();
      await join(a);
      await put(a, 0, { level: "1" });
      await put(a, 1, { level: "2" });
      expect((await a.go("/account/saves")).status).toBe(404);
      expect((await a.go("/account/saves/owl-game")).status).toBe(404);
      expect(await (await a.go("/account")).text()).not.toContain("/account/saves");

      // The game page, for the game's own screens (Zaisma.saves).
      const listed = (await (await a.go("/api/saves/owl-game/copies")).json()) as { save_copies: { id: string }[] };
      expect(listed.save_copies).toEqual([{ id: expect.stringMatching(/^save_copy_/), saved_at: expect.stringMatching(/Z$/), copy_reason: "hourly", size_bytes: savedText({ level: "1" }).length, is_current_save: false, version_id: null }]);
      const copyId = listed.save_copies[0]!.id;
      expect(await (await a.go(`/api/saves/owl-game/copies/${copyId}`)).json()).toEqual({ save_copy: { ...listed.save_copies[0], local_storage_items: { level: "1" }, missing_keys: [], indexeddb_databases: [] } });

      // Browsers send the page's origin with every POST from a script (this test browser, with a body).
      const tag = await tagOf(a);
      const restore = (init: { origin?: string } = {}, browser = a, id = copyId, slug = "owl-game") => browser.go(`/api/saves/${slug}/copies/${id}/restore`, undefined, { method: "POST", body: JSON.stringify({ tag }), ...init });
      expect((await restore({ origin: "https://owl-game.games.example" })).status).toBe(403);
      expect((await restore({}, new Browser())).status).toBe(401);
      const restored = await restore();
      expect(restored.status).toBe(200);
      const answer = (await restored.json()) as { version_number: number; sha256: string; saved_at: string; kept_save_copy_id: string };
      expect(answer).toMatchObject({ version_number: 3, sha256: await sha256Hex(new TextEncoder().encode(savedText({ level: "1" }))), saved_at: expect.stringMatching(/Z$/) });
      // The save is the copy's again, the player's own change, and the save it replaced is kept as a restore copy.
      expect(await (await a.go("/api/saves/owl-game")).json()).toMatchObject({ version_number: 3, changed_by_kind: "player", save_data: { local_storage_items: { level: "1" } } });
      const after = await copies();
      expect(after.map((copy) => copy.copy_reason)).toEqual(["restore", "hourly"]);
      expect(answer.kept_save_copy_id).toBe(after[0]!.id);
      expect(await env.SAVES.get(`${id()}/${gameId}/${after[0]!.id}.json`).then((o) => o?.text())).toBe(savedText({ level: "2" }));
      const relisted = (await (await a.go("/api/saves/owl-game/copies")).json()) as { save_copies: { id: string; is_current_save: boolean }[] };
      expect(relisted.save_copies.find((copy) => copy.id === copyId)!.is_current_save).toBe(true);

      // Unknown, bad and other players' copy IDs, and a game whose cloud saves are off.
      expect(await (await a.go("/api/saves/owl-game/copies/save_copy_nope")).json()).toEqual({ error: "no_save_copy" });
      expect((await a.go("/api/saves/owl-game/copies/not-an-id")).status).toBe(404);
      expect((await restore({}, a, "save_copy_nope")).status).toBe(404);
      const other = new Browser();
      await join(other, "owl@example.com", "Other_Owl");
      expect((await other.go(`/api/saves/owl-game/copies/${copyId}`)).status).toBe(404);
      expect((await restore({}, other)).status).toBe(404);
      expect((await other.go("/api/saves/owl-game/copies")).status).toBe(200);
      await liveGame("own-saves", 0);
      expect((await a.go("/api/saves/own-saves/copies")).status).toBe(404);
      expect((await restore({}, a, copyId, "own-saves")).status).toBe(404);
      // Only GET reads and POST restores.
      expect((await a.go(`/api/saves/owl-game/copies/${copyId}`, undefined, { method: "POST", body: "{}" })).status).toBe(405);
      expect((await a.go(`/api/saves/owl-game/copies/${copyId}/restore`)).status).toBe(405);
    });

    it("tells an open game when the account's save was stored, from the database alone", async () => {
      await liveGame();
      const b = new Browser();
      await join(b);
      expect(await (await b.go("/api/saves/owl-game?version")).json()).toEqual({ version_number: 0, saved_at: null, changed_by_kind: null });
      await put(b, 0, { level: "1" });
      const got = (await (await b.go("/api/saves/owl-game?version")).json()) as { version_number: number; saved_at: string; changed_by_kind: string };
      expect(got).toMatchObject({ version_number: 1, changed_by_kind: "player" });
      expect(Date.parse(got.saved_at)).toBeGreaterThan(Date.now() - 60_000);
    });

    it("deletes earlier versions with the account", async () => {
      const gameId = await liveGame();
      const b = new Browser();
      await join(b);
      const account = id();
      await put(b, 0, { level: "1" });
      await put(b, 1, { level: "2" });
      await b.go("/account/delete", { confirm: "delete" });
      expect((await env.SAVES.list({ prefix: `${account}/${gameId}/` })).objects).toHaveLength(0);
      expect(await copies()).toHaveLength(0);
    });
  });

  it("offers guests to keep their progress, opening the account steps so they come back to the game", async () => {
    await liveGame();
    await liveGame("own-saves", 0);
    const page = await (await SELF.fetch(`${SITE}/g/owl-game`)).text();
    expect(page).toMatch(/<aside class="playing-card glass" id="keep" aria-labelledby="keep-title"[^>]*hidden>/);
    expect(page).toContain("Your Owl Game progress is only saved in this browser.");
    // Both ways in (make an account, sign in) open in a new tab, back to the game, so each link carries the step the script opens.
    const keepCard = page.match(/<aside[^>]*id="keep"[\s\S]*?<\/aside>/)![0];
    const keepLinks = keepCard.match(/<a [^>]*>/g)!;
    expect(keepLinks.some((link) => link.includes('data-keep="/join"') && link.includes('href="/join?next=%2Fg%2Fowl-game%3Fplay"'))).toBe(true);
    expect(keepLinks.some((link) => link.includes('data-keep="/signin"') && link.includes('href="/signin?next=%2Fg%2Fowl-game%3Fplay"'))).toBe(true);
    expect(page).toContain('"slug":"owl-game"');
    expect(await (await SELF.fetch(`${SITE}/g/own-saves`)).text()).not.toContain('id="keep"');
  });

  it("lands the new account back at the game, and tells the game tab", async () => {
    await liveGame();
    expect((await new Browser().go("/account/kept?game=owl-game")).headers.get("location")).toBe("/signin?next=%2Faccount%2Fkept%3Fgame%3Dowl-game");
    const b = new Browser();
    const joined = await (async () => {
      await b.go("/join/age", BIRTH_ADULT);
      return b.go("/join/account", { turnstile_token: "test-token", username: "Night_Owl", password: PASSWORD, next: "/account/kept?game=owl-game" });
    })();
    expect(joined.headers.get("location")).toBe("/join/play?next=%2Faccount%2Fkept%3Fgame%3Dowl-game");
    expect((await b.go("/join/play", { social_mode: "friends_focused", next: "/account/kept?game=owl-game" })).headers.get("location")).toBe("/account/kept?game=owl-game");
    const page = await (await b.go("/account/kept?game=owl-game")).text();
    expect(page).toContain("You're in, Night_Owl");
    expect(page).toMatch(/<div data-back><a class="shell run-wrap[^"]*" href="\/g\/owl-game\?play">/);
    expect(pageScriptNames(page)).toEqual(expect.arrayContaining(["joined", "back-to-game"]));
    expect(await pageScriptText(page, (path) => SELF.fetch(`${SITE}${path}`))).toContain('BroadcastChannel("zaisma").postMessage("signed-in")');
    expect(await (await b.go("/account/kept?game=nope")).text()).toContain("Find a game");
    // A game that keeps its own saves: no word about progress saving to the account.
    await liveGame("own-saves", 0);
    const own = await (await b.go("/account/kept?game=own-saves")).text();
    expect(own).toContain("Go back to Owl Game to keep playing.</p>");
  });

  it("signs in over the city, naming the game that asked, with the guest way back to it", async () => {
    await liveGame();
    await env.DB.prepare("UPDATE games SET visibility = 'listed' WHERE slug = 'owl-game'").run();
    const plain = await (await new Browser().go("/signin")).text();
    // One pane of glass over the city: its canvas, the still under it, the logo alone above, and the switch to making an account.
    expect(plain).toContain('<div class="city-pane" data-city-pane>');
    expect(plain).toContain('<canvas class="city"></canvas>');
    // Every step swaps into the pane in place, so the city never starts over; the passkey script can run again for it.
    expect(plain).toMatch(/<script src="\/js\/city-pane\.[0-9a-f]+\.js" defer><\/script>/);
    expect(plain).toContain('<div class="city-still is-day"></div><div class="city-still is-night"></div><canvas class="city"></canvas>');
    expect(plain).toMatch(/<header class="top bar-layout glass[^"]*"[^>]*>[\s\S]*?<\/header>/);
    expect(plain.match(/<header class="top bar-layout glass[^"]*"[\s\S]*?<\/header>/)![0]).not.toMatch(/class="end"|class="nav"|href="\/signin"/);
    expect(plain).toContain('<a class="flush-row quiet" data-lights href="/signin" aria-current="page">Sign in</a>');
    expect(plain).toContain('<a class="flush-row quiet" data-lights href="/join">Make an account</a>');
    expect(plain).toContain("Continue as guest");
    expect(plain).not.toContain("asked you to sign in");
    expect(pageScriptNames(plain)).toEqual(expect.arrayContaining(["city", "back-to-game", "passkey-sign-in", "entry-switch"]));
    // Sign in and Make an account are both in the pane, so the switch swaps them in place; each address opens on its own.
    expect(plain).toContain('<section class="pane-stack" id="view-signin" data-entry-view="signin" data-title="Sign in · Zaisma">');
    expect(plain).toContain('<section class="pane-stack" id="view-join" data-entry-view="join" data-title="Make an account · Zaisma" hidden>');
    const joinPage = await (await new Browser().go("/join")).text();
    expect(joinPage).toContain('data-entry-view="signin" data-title="Sign in · Zaisma" hidden>');
    expect(joinPage).toContain('<a class="flush-row quiet" data-lights href="/join" aria-current="page">Make an account</a>');
    // The stills are the stage's CSS, so only the one showing loads.
    const styles = await (await SELF.fetch(`${SITE}${plain.match(/href="(\/css\/site\.[0-9a-f]+\.css)"/)![1]}`)).text();
    for (const still of ["city-day.webp", "city-day-phone.webp", "city-night.webp", "city-night-phone.webp"]) expect(styles).toContain(`url(/sign-in/${still})`);
    // A press anywhere but on the pane, the logo or the rail reaches the city, whose shapes and sea are there to tap.
    expect(styles).toMatch(/\.city-page[^{}]*\{ ?pointer-events: none; ?\}/);
    expect(styles).toMatch(/\.city-stage[^{}]*\{ ?pointer-events: auto; ?\}/);

    // A game's tab: the pane says the game asked, and the guest way goes back to it, on every pane of the way in.
    const next = encodeURIComponent("/account/kept?game=owl-game");
    for (const path of [`/signin?next=${next}`, `/join?next=${next}`, `/signin/email?next=${next}`]) {
      const asked = await (await new Browser().go(path)).text();
      expect(asked, path).toContain("<p>Owl Game asked you to sign in.</p>");
      expect(asked, path).toContain('<div data-back><a class="shell tertiary-btn is-full" href="/g/owl-game?play">');
      expect(asked, path).toContain("Back to Owl Game as a guest");
      expect(asked, path).not.toContain("Continue as guest");
    }
    // The switch keeps where they were going.
    expect(await (await new Browser().go(`/signin?next=${next}`)).text()).toContain(`<a class="flush-row quiet" data-lights href="/join?next=${next}">Make an account</a>`);
    // A made-up game, or one strangers can't see, isn't named.
    for (const unknown of ["/account/kept?game=no-such-game", "/account/kept?game=Owl"]) {
      const page = await (await new Browser().go(`/signin?next=${encodeURIComponent(unknown)}`)).text();
      expect(page).toContain("Continue as guest");
      expect(page).not.toContain("asked you to sign in");
    }
    await env.DB.prepare("UPDATE games SET visibility = 'private' WHERE slug = 'owl-game'").run();
    expect(await (await new Browser().go(`/signin?next=${next}`)).text()).not.toContain("Owl Game");
  });

  it("lets a game ask a guest to sign in beside it, in a new tab, and tells the game who they are", async () => {
    await liveGame();
    const page = await (await SELF.fetch(`${SITE}/g/owl-game`)).text();
    expect(page).toMatch(/<aside class="playing-card glass" id="sign-in-ask" aria-labelledby="sign-in-ask-title"[^>]*hidden>/);
    expect(page).toContain("Owl Game asks you to sign in");
    const askCard = page.match(/<aside[^>]*id="sign-in-ask"[\s\S]*?<\/aside>/)![0];
    const askLinks = askCard.match(/<a [^>]*>/g)!;
    expect(askLinks.some((link) => link.includes('data-sign-in="/join"') && link.includes('href="/join?next=%2Fg%2Fowl-game%3Fplay"'))).toBe(true);
    expect(askLinks.some((link) => link.includes('data-sign-in="/signin"') && link.includes('href="/signin?next=%2Fg%2Fowl-game%3Fplay"'))).toBe(true);
    expect(pageDataOf(page, "game-page-data").slug).toBe("owl-game");
    expect(pageScriptNames(page)).toContain("sign-in-while-playing");
    const scripts = await pageScriptText(page, (path) => SELF.fetch(`${SITE}${path}`));
    expect(scripts).toContain('d.type === "zaisma:sign-in"');
    expect(scripts).toContain('fetch("/api/plays/" + gamePage.slug + "/account"');
    expect(scripts).toContain('type: "zaisma:signed-in"');
  });

  it("game pages offer saves only for games that use them", async () => {
    await liveGame();
    await liveGame("own-saves", 0);
    const page = await (await SELF.fetch(`${SITE}/g/owl-game`)).text();
    expect(pageScriptNames(page)).toContain("saves");
    expect(pageDataOf(page, "saves-data")).toMatchObject({ api: "/api/saves/owl-game", slug: "owl-game" });
    expect(pageDataOf(page, "game-page-data").cloud_saves_enabled).toBe(true);
    expect(page).toContain('id="keep-title">Keep your progress');
    // No save screens: no "which progress?" chooser and no earlier progress in the menu.
    expect(page).not.toContain("save-choice");
    expect(page).not.toContain("/account/saves");
    const own = await (await SELF.fetch(`${SITE}/g/own-saves`)).text();
    expect(pageScriptNames(own)).not.toContain("saves");
    expect(own).not.toContain('id="saves-data"');
    expect(own).not.toContain('id="keep"');
    expect(pageDataOf(own, "game-page-data").cloud_saves_enabled).toBe(false);
  });

  it("a game can turn off the \"Keep your progress\" card by itself, keep cloud saves and show the card at its own moment", async () => {
    await liveGame();
    expect(pageDataOf(await (await SELF.fetch(`${SITE}/g/owl-game`)).text(), "saves-data")).toMatchObject({ isAccountOfferEnabled: true });
    await env.DB.prepare("UPDATE games SET account_offer_enabled = 0 WHERE slug = 'owl-game'").run();
    const page = await (await SELF.fetch(`${SITE}/g/owl-game`)).text();
    expect(pageScriptNames(page)).toContain("saves");
    expect(pageDataOf(page, "saves-data")).toMatchObject({ isAccountOfferEnabled: false });
    // The card is there for Zaisma.player.offerAccount(), shown only when the game asks.
    expect(page).toContain('id="keep-title"');
    expect(page).toContain('id="keep-bar"');
    const scripts = await pageScriptText(page, (path) => SELF.fetch(`${SITE}${path}`));
    expect(scripts).toContain('d.type === "zaisma:account-offer"');
    expect(scripts).toContain('d.type === "zaisma:saves-request"');
  });

  it("game pages that need an account say so before Play and ask guests to sign in, back to the same match", async () => {
    await liveGame("members-only");
    expect(await (await SELF.fetch(`${SITE}/g/members-only`)).text()).not.toContain('id="account-note"');
    await env.DB.prepare("UPDATE games SET account_requirement = 'whole_game' WHERE slug = 'members-only'").run();
    const page = await (await SELF.fetch(`${SITE}/g/members-only?room=BCDFGH`)).text();
    expect(page).toContain(">Needs a Zaisma account<");
    expect(page).toContain('href="/signin?next=%2Fg%2Fmembers-only%3Froom%3DBCDFGH"');
    expect(page).toContain('href="/join?next=%2Fg%2Fmembers-only%3Froom%3DBCDFGH"');
    // For a guest, the account gate's script makes Play "Sign in to play", and a room link starts the game only for a signed-in player.
    expect(pageScriptNames(page)).toContain("account-gate");
    expect(await pageScriptText(page, (path) => SELF.fetch(`${SITE}${path}`))).toContain("Sign in to play");
    expect(pageDataOf(page, "game-page-data")).toMatchObject({ account_requirement: "whole_game", room_code: "BCDFGH", sign_in_url: "/signin?next=%2Fg%2Fmembers-only%3Froom%3DBCDFGH", autoplay: "when_signed_in" });
    await env.DB.prepare("UPDATE games SET account_requirement = 'multiplayer' WHERE slug = 'members-only'").run();
    const online = await (await SELF.fetch(`${SITE}/g/members-only`)).text();
    expect(online).toContain(">Playing online needs a Zaisma account<");
    // Guests can still play alone, so Play stays Play: the gate changes it only for a whole game or a room link.
    expect(pageDataOf(online, "game-page-data")).toMatchObject({ account_requirement: "multiplayer", room_code: "", autoplay: "never" });
  });
});

describe("a game for 16 and up", () => {
  const BIRTH_TEEN = { year: String(thisYear - 14), month: "1", day: "1" };
  const BIRTH_SIXTEEN = { year: String(thisYear - 16), month: "1", day: "1" };
  const inviteFrom = async (b: Browser) => new URL((await b.go("/friends/invites", {})).headers.get("location")!, SITE).searchParams.get("invite")!;

  async function grownUpGame() {
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, multiplayer_mode, account_requirement, minimum_player_age_years, entry_signing_key, created_at_ms, updated_at_ms) VALUES ('g-grown', 'grown-up', 'Grown Up Game', 'live', 'listed', 'v-grown', 'relay', 'whole_game', 16, 'entrykey', ?, ?)",
    )
      .bind(now, now)
      .run();
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('v-grown', 'g-grown', 'games/g-grown/v-grown', 1, 0, 'approved', 0)").run();
  }
  const entry = (b: Browser) => b.go("/api/plays/grown-up/entry", undefined, { method: "POST", body: JSON.stringify({ then: "?room=ABCDEF" }) });

  it("lets in accounts old enough, through an entry, and tells the others nothing about ages", async () => {
    await grownUpGame();
    const adult = new Browser();
    await join(adult, null, "Night_Owl");
    const sixteen = new Browser();
    await join(sixteen, null, "Tall_Pine", BIRTH_SIXTEEN);
    const teen = new Browser();
    await join(teen, null, "Quiet_Comet", BIRTH_TEEN);
    const guest = new Browser();

    // Play's entry: old enough gets the game domain's address with a grant; younger and guests are refused, never cached.
    for (const b of [adult, sixteen]) {
      const entered = (await (await entry(b)).json()) as { entry_url: string };
      expect(entered.entry_url).toMatch(/\/grown-up\/_zaisma\/enter\?grant=\d+\.[0-9a-f]{64}&then=%3Froom%3DABCDEF$/);
    }
    const tooYoung = await entry(teen);
    expect(tooYoung.status).toBe(403);
    expect(tooYoung.headers.get("cache-control")).toBe("no-store");
    expect(await tooYoung.json()).toMatchObject({ error: { code: "game_not_open_to_player" } });
    expect(await (await entry(guest)).json()).toMatchObject({ error: { code: "account_needed" } });
    // A play started by a younger account gets no key and isn't counted.
    const play = await teen.go("/api/plays/grown-up", undefined, { method: "POST", body: JSON.stringify({ token: "test-token" }) });
    expect(play.status).toBe(403);
    expect(await play.json()).toMatchObject({ error: { code: "game_not_open_to_player" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS day_count FROM play_days WHERE game_id = 'g-grown'").first("day_count")).toBe(0);

    // The page: closed for the younger account, with no Play, no rooms and no age anywhere.
    const closed = await teen.go("/g/grown-up?room=ABCDEF");
    expect(closed.headers.get("cache-control")).toBe("no-store");
    const closedPage = await closed.text();
    expect(closedPage).toContain("This game isn't open to your account.");
    expect(closedPage).toContain("Find other games");
    expect(closedPage).not.toContain('id="play"');
    expect(closedPage).not.toMatch(/and up|1[68]\+|years old/);
    expect(pageDataOf(closedPage, "game-page-data")).toMatchObject({ autoplay: "never", room_code: "" });
    // Signed out, it's any accounts-only game; signed in and old enough, Play opens through the entry.
    expect(await (await guest.go("/g/grown-up")).text()).toContain(">Needs a Zaisma account<");
    const open = await (await adult.go("/g/grown-up")).text();
    expect(open).toContain('id="play"');
    expect(open).not.toContain("This game isn't open to your account.");
    expect(pageDataOf(open, "game-page-data")).toMatchObject({ is_accounts_only: true });
    expect(open).not.toMatch(/<iframe id="game" src=/);

    // A younger account never finds it: home and Continue playing; everyone else does.
    expect(await (await teen.go("/")).text()).not.toContain("grown-up");
    expect(await (await adult.go("/")).text()).toContain('"slug":"grown-up"');
    expect(await (await guest.go("/")).text()).toContain('"slug":"grown-up"');
    for (const b of [teen, adult]) await b.go("/api/me/played/grown-up", undefined, { method: "POST", body: "{}" });
    expect(await (await teen.go("/api/me/played")).json()).toEqual({ played: [] });
    expect(((await (await adult.go("/api/me/played")).json()) as { played: { slug: string }[] }).played.map((played) => played.slug)).toEqual(["grown-up"]);
  });

  it("keeps it off a younger friend's Playing now and a profile they look at", async () => {
    await grownUpGame();
    const adult = new Browser();
    await join(adult, "moss@example.com", "Moss_Runner");
    const teen = new Browser();
    await join(teen, "comet@example.com", "Quiet_Comet", BIRTH_TEEN);
    expect((await teen.go(`/friends/add/${await inviteFrom(adult)}`, {})).status).toBe(303);
    const now = Date.now();
    const adultAccount = (await accountById(env.DB, users.get("moss@example.com")!))!;
    await adult.go("/api/presence", undefined, { method: "POST", body: JSON.stringify({}) });
    await env.DB.prepare("INSERT INTO room_players (game_id, room_code, player_id, joined_at_ms, updated_at_ms) VALUES ('g-grown', 'ROOMAB', ?, ?, ?)").bind(adultAccount.player_id, now, now).run();
    await env.DB.prepare("UPDATE accounts SET who_sees_profile = 'anyone', who_sees_playing_now = 'anyone', who_sees_played_games = 'anyone' WHERE id = ?").bind(adultAccount.id).run();
    await adult.go("/api/me/played/grown-up", undefined, { method: "POST", body: "{}" });

    const teenId = users.get("comet@example.com")!;
    expect((await friendsNowOf(env.DB, teenId, 18)).playing.map((playing) => playing.game?.slug)).toEqual(["grown-up"]);
    expect((await friendsNowOf(env.DB, teenId, 13)).playing).toEqual([]);
    expect(await (await teen.go("/friends")).text()).not.toContain("grown-up");
    expect(await (await teen.go("/g/grown-up/friends")).text()).toBe("");
    // Moss_Runner's profile, as a stranger sees it, shows the game; the younger friend doesn't see it at all.
    expect(await (await new Browser().go("/@Moss_Runner")).text()).toContain("/g/grown-up");
    expect(await (await teen.go("/@Moss_Runner")).text()).not.toContain("grown-up");
  });

  it("holds tester links to it, but not the developer's previews", async () => {
    await grownUpGame();
    const link = await addTesterLink(env.DB, "g-grown", "Friends");
    const teen = new Browser();
    await join(teen, null, "Quiet_Comet", BIRTH_TEEN);
    const adult = new Browser();
    await join(adult, null, "Night_Owl");
    const enter = (b: Browser) => b.go(`/t/${link.token}/enter`, undefined, { method: "POST", body: "{}" });
    expect(await (await enter(teen)).json()).toMatchObject({ error: { code: "game_not_open_to_player" } });
    expect(await (await enter(new Browser())).json()).toMatchObject({ error: { code: "account_needed" } });
    expect(((await (await enter(adult)).json()) as { frame_url: string }).frame_url).toContain("grown-up--tester/_zaisma/enter?grant=");
    expect(await (await teen.go(`/t/${link.token}`)).text()).toContain("This game isn't open to your account.");
    const tested = await teen.go("/api/plays/grown-up", undefined, { method: "POST", body: JSON.stringify({ tester: link.token, token: "test-token" }) });
    expect(await tested.json()).toMatchObject({ error: { code: "game_not_open_to_player" } });
  });
});

describe("a game that sells itself", () => {
  // Ashfall sells itself for $24.99 and two add-ons on its page; Ashfall Demo is its free demo. Emma made both.
  async function paidGame() {
    await env.DB.exec("DELETE FROM purchases; DELETE FROM game_items;");
    const developer = new Browser();
    await join(developer, null, "Emma_Clarke");
    const developerAccount = (await env.DB.prepare("SELECT id FROM accounts WHERE username = 'Emma_Clarke'").first<{ id: string }>())!;
    await env.DB.prepare("INSERT INTO owners (id, kind, account_id, created_at_ms) VALUES ('owner_emma', 'person', ?, 1)").bind(developerAccount.id).run();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, multiplayer_mode, account_requirement, full_game_item_name, demo_game_id, refund_policy, owner_id, entry_signing_key, created_at_ms, updated_at_ms) VALUES ('g-ashfall', 'ashfall', 'Ashfall', 'live', 'listed', 'v-ashfall', 'relay', 'whole_game', 'full_game', 'g-ashfall-demo', 'no_refunds', 'owner_emma', 'entrykey', ?, ?)",
      ).bind(now, now),
      env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, owner_id, created_at_ms, updated_at_ms) VALUES ('g-ashfall-demo', 'ashfall-demo', 'Ashfall Demo', 'live', 'listed', 'v-ashfall-demo', 'owner_emma', ?, ?)").bind(now, now),
      env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('v-ashfall', 'g-ashfall', 'games/g-ashfall/v-ashfall', 1, 0, 'approved', 0), ('v-ashfall-demo', 'g-ashfall-demo', 'games/g-ashfall-demo/v', 1, 0, 'approved', 0)"),
      env.DB.prepare(
        `INSERT INTO game_items (game_id, item_name, title, description, item_kind, item_category, price_minor_units, currency_code, local_prices, is_on_game_page, created_at_ms, updated_at_ms) VALUES
           ('g-ashfall', 'full_game', 'Ashfall', '', 'permanent', 'content', 2499, 'usd', '[]', 0, 1, 1),
           ('g-ashfall', 'frozen_north', 'The Frozen North', 'A new region.\nTwelve hours of story.', 'permanent', 'content', 999, 'usd', '[]', 1, 1, 1),
           ('g-ashfall', 'supporter_pack', 'Supporter pack', 'A cape and a banner.', 'permanent', 'cosmetic', 499, 'usd', '[]', 1, 1, 1),
           ('g-ashfall', 'revive', 'Revive', '', 'consumable', 'gameplay', 199, 'usd', '[]', 0, 1, 1)`,
      ),
    ]);
    const owner = new Browser();
    await join(owner, null, "Alex_Turner");
    const ownerPlayer = (await env.DB.prepare("SELECT player_id FROM accounts WHERE username = 'Alex_Turner'").first<{ player_id: string }>())!;
    await env.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms) VALUES ('purchase_full', 'g-ashfall', 'full_game', 'permanent', ?1, 'sale', 'completed', 1), ('purchase_pack', 'g-ashfall', 'supporter_pack', 'permanent', ?1, 'sale', 'completed', 1)").bind(ownerPlayer.player_id).run();
    const stranger = new Browser();
    await join(stranger, null, "Ben_Walker");
    return { developer, owner, stranger, guest: new Browser() };
  }
  const entry = (b: Browser) => b.go("/api/plays/ashfall/entry", undefined, { method: "POST", body: JSON.stringify({ then: "" }) });
  const start = (b: Browser) => b.go("/api/plays/ashfall", undefined, { method: "POST", body: JSON.stringify({ token: "test-token" }) });

  afterEach(async () => {
    await env.DB.exec("DELETE FROM purchases; DELETE FROM game_items;");
  });

  it("plays only for owners, its developer and tester links: Play, its files' entry and room keys turn everyone else away", async () => {
    const { developer, owner, stranger, guest } = await paidGame();
    for (const b of [owner, developer]) {
      expect((await (await entry(b)).json()) as { entry_url: string }).toMatchObject({ entry_url: expect.stringMatching(/\/ashfall\/_zaisma\/enter\?grant=/) });
      // Started, not turned away (this file's stand-in check doesn't pass plays, so no key or ticket comes with it).
      expect((await start(b)).status).toBe(204);
    }
    const notOwned = await entry(stranger);
    expect(notOwned.status).toBe(403);
    expect(await notOwned.json()).toMatchObject({ error: { code: "full_game_not_owned", message: "Buy Ashfall to play." } });
    expect(await (await start(stranger)).json()).toMatchObject({ error: { code: "full_game_not_owned" } });
    expect(await (await entry(guest)).json()).toMatchObject({ error: { code: "account_needed" } });
    // No room key reached anyone who doesn't own it.
    const strangerAccount = (await env.DB.prepare("SELECT id FROM accounts WHERE username = 'Ben_Walker'").first<{ id: string }>())!;
    expect(await env.DB.prepare("SELECT COUNT(*) AS key_count FROM room_keys WHERE account_id = ?").bind(strangerAccount.id).first("key_count")).toBe(0);
    // A tester link plays it, as it skips the account rule.
    const link = await addTesterLink(env.DB, "g-ashfall", "Friends");
    expect((await guest.go("/api/plays/ashfall", undefined, { method: "POST", body: JSON.stringify({ tester: link.token, token: "test-token" }) })).status).toBe(204);
    // A refund ends it.
    await env.DB.prepare("UPDATE purchases SET purchase_status = 'refunded' WHERE id = 'purchase_full'").run();
    expect(await (await entry(owner)).json()).toMatchObject({ error: { code: "full_game_not_owned" } });
  });

  it("keeps playing for owners after the developer hides it, and is not found for anyone else", async () => {
    const { owner, stranger, guest } = await paidGame();
    await env.DB.prepare("UPDATE games SET visibility = 'private' WHERE id = 'g-ashfall'").run();
    expect(await (await entry(owner)).json()).toMatchObject({ entry_url: expect.any(String) });
    expect((await owner.go("/g/ashfall")).status).toBe(200);
    expect((await entry(stranger)).status).toBe(404);
    expect((await start(stranger)).status).toBe(404);
    expect((await stranger.go("/g/ashfall")).status).toBe(404);
    expect((await guest.go("/g/ashfall")).status).toBe(404);
    // A takedown ends it for owners too.
    await env.DB.prepare("UPDATE games SET review_status = 'removed' WHERE id = 'g-ashfall'").run();
    expect((await entry(owner)).status).toBe(404);
  });

  it("shows Buy and the price where Play is, its demo and its add-ons, and Play and Owned to an owner", async () => {
    const { owner, guest, stranger } = await paidGame();
    const forSale = await guest.go("/g/ashfall?room=BCDFGH");
    expect(forSale.headers.get("cache-control")).toBe("no-store");
    const forSalePage = await forSale.text();
    expect(forSalePage).toContain('id="buy-game"');
    expect(forSalePage).toContain('data-buy-item="full_game"');
    expect(forSalePage).toContain("$24.99");
    expect(forSalePage).not.toContain('id="play"');
    expect(forSalePage).not.toContain(">Needs a Zaisma account<");
    expect(forSalePage).toContain('href="/g/ashfall-demo?play"');
    // Add-ons: the two the developer put on the page, the first line of each description, not the full game or the revive.
    expect(forSalePage).toContain(">Add-ons<");
    expect(forSalePage).toContain("The Frozen North");
    expect(forSalePage).toContain("A new region.");
    expect(forSalePage).not.toContain("Twelve hours of story.");
    expect(forSalePage).toContain('data-buy-item="supporter_pack"');
    expect(forSalePage).not.toContain('data-buy-item="revive"');
    // A room link to it opens the details with Buy, not the match.
    expect(pageDataOf(forSalePage, "game-page-data")).toMatchObject({ autoplay: "never", room_code: "" });
    expect(pageDataOf(forSalePage, "buy-sheet-data")).toMatchObject({ opened_item_name: null });
    // ?buy opens the sheet at once for someone who can buy it, and is ignored for an owner.
    expect(pageDataOf(await (await stranger.go("/g/ashfall?buy")).text(), "buy-sheet-data")).toMatchObject({ opened_item_name: "full_game" });
    const owned = await (await owner.go("/g/ashfall?buy")).text();
    expect(owned).toContain('id="play"');
    expect(owned).not.toContain('id="buy-game"');
    expect(owned).not.toContain('href="/g/ashfall-demo?play"');
    expect(owned).not.toContain('data-buy-item="supporter_pack"');
    expect(owned).toContain(">Owned<");
    expect(pageDataOf(owned, "buy-sheet-data")).toMatchObject({ opened_item_name: null });
    // The demo's page links to the full game; the label says no in-game purchases come with the full game alone.
    const demo = await (await guest.go("/g/ashfall-demo")).text();
    expect(demo).toContain('id="play"');
    expect(demo).toContain('href="/g/ashfall?buy"');
    // Taken off sale: owners still play, others see it's not on sale.
    await env.DB.prepare("UPDATE game_items SET price_minor_units = NULL, currency_code = NULL WHERE item_name = 'full_game'").run();
    expect(await (await guest.go("/g/ashfall")).text()).toContain("Not on sale right now");
  });

  it("puts its price on its cover for anyone who doesn't own it, and Browse filters by price range", async () => {
    const { owner, guest } = await paidGame();
    const browse = await (await guest.go("/games")).text();
    expect(browse).toContain("$24.99");
    expect(await (await owner.go("/games")).text()).not.toContain("$24.99");
    const ranged = await (await guest.go("/games?price=15_to_30")).text();
    expect(ranged).toContain("Ashfall");
    expect(ranged).not.toContain("Ashfall Demo");
    const free = await (await guest.go("/games?price=free")).text();
    expect(free).toContain("Ashfall Demo");
    expect(await (await guest.go("/games?price=30_and_up")).text()).toContain("No games in this price range yet");
  });
});

describe("API keys on the account page", () => {
  it("shows a new key once, lists it and removes it", async () => {
    const b = new Browser();
    await join(b);
    const device = await addPasskey(b);
    const made = await (await makeKey(b, device)).text();
    const token = made.match(/zsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}/)?.[0];
    expect(token).toBeTruthy();
    const api = await SELF.fetch(`${SITE}/api/dev/games`, { headers: { authorization: `Bearer ${token}` } });
    expect(await api.json()).toEqual({ games: [], unread_topic_count: 0 });

    const page = await (await b.go("/dashboard/settings")).text();
    expect(page).toContain("My laptop");
    expect(page).not.toContain(token!);

    const id = page.match(/\/dashboard\/settings\/keys\/([a-z0-9]+)\/remove/)![1];
    await b.go(`/dashboard/settings/keys/${id}/remove`, {});
    expect((await SELF.fetch(`${SITE}/api/dev/games`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("makes a key limited to some games and a level, and lists what it can do", async () => {
    const b = new Browser();
    await join(b);
    await letPublishAs("Night_Owl");
    const device = await addPasskey(b);
    for (const title of ["Sky Hopper", "Cave Run"]) expect((await b.go("/api/dev/games", undefined, { method: "POST", body: JSON.stringify({ title }) })).status).toBe(201);
    const form = new URLSearchParams([["name", "CI"], ["access_level", "upload"], ["game_scope", "some"], ["game_slugs", "sky-hopper"], ["game_slugs", "someone-elses-game"]]);
    const made = await (await makeKey(b, device, form)).text();
    const token = made.match(/zsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}/)![0];
    const access = await (await SELF.fetch(`${SITE}/api/dev/access`, { headers: { authorization: `Bearer ${token}` } })).json();
    // Games that aren't the developer's are dropped.
    expect(access).toMatchObject({ access: { api_key_name: "CI", access_level: "upload", game_slugs: ["sky-hopper"] } });
    expect(await (await b.go("/dashboard/settings")).text()).toContain("Upload; only Sky Hopper");

    // A custom key for some games: sign-in apps and webhooks stay out of its reach, whatever the form sent.
    const custom = new URLSearchParams({ name: "Stats", access_level: "custom", game_scope: "some", game_slugs: "cave-run", game_access: "read", version_access: "read", stats_access: "read", database_access: "none", save_access: "none", purchase_access: "none", forum_access: "none", sign_in_app_access: "write", webhook_access: "read" });
    const customToken = (await (await makeKey(b, device, custom)).text()).match(/zsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}/)![0];
    const customAccess = (await (await SELF.fetch(`${SITE}/api/dev/access`, { headers: { authorization: `Bearer ${customToken}` } })).json()) as { access: { area_access: Record<string, string> } };
    expect(customAccess.access.area_access).toMatchObject({ stats_access: "read", database_access: "none", sign_in_app_access: "none", webhook_access: "none" });

    // Some games, but none chosen.
    const none = new URLSearchParams({ name: "Nothing", access_level: "read", game_scope: "some" });
    expect(await (await makeKey(b, device, none)).text()).toContain("Choose at least one game");
  });

  it("lets the dashboard use the session, but only from zaisma.com", async () => {
    const b = new Browser();
    await join(b);
    await letPublishAs("Night_Owl");
    expect((await b.go("/api/dev/games")).status).toBe(200);
    const body = JSON.stringify({ title: "Cookie Game" });
    expect((await b.go("/api/dev/games", undefined, { method: "POST", body, origin: "https://evil.example" })).status).toBe(403);
    expect((await b.go("/api/dev/games", undefined, { method: "POST", body })).status).toBe(201);
  });
});

describe("the dashboard", () => {
  const pass: ScanDeps = passingScanDeps();

  /** Upload a one-file game through the API with the browser's session, then pass its scan. */
  async function uploadAndPass(b: Browser, slug: string, text: string): Promise<string> {
    const sha256 = await sha256Hex(new TextEncoder().encode(text));
    const files = [{ path: "index.html", sha256, size_bytes: new TextEncoder().encode(text).byteLength }];
    await b.go(`/api/dev/games/${slug}/uploads`, undefined, { method: "POST", body: JSON.stringify({ files }) });
    expect((await b.go(`/api/dev/files/${sha256}`, undefined, { method: "PUT", body: text })).status).toBe(200);
    const { version } = (await (await b.go(`/api/dev/games/${slug}/versions`, undefined, { method: "POST", body: JSON.stringify({ files }) })).json()) as { version: { id: string } };
    await scanVersion({ ...env, ANTHROPIC_API_KEY: "test-key" }, version.id, pass);
    return version.id;
  }

  it("sends signed-out visitors to sign in", async () => {
    const res = await new Browser().go("/dashboard");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/signin?next=%2Fdashboard");
  });

  it("exports everything from the Details tab, for the signed-in owner alone", async () => {
    const b = new Browser();
    await join(b);
    await letPublishAs("Night_Owl");
    await b.go("/dashboard/new", { title: "Sky Hopper" });
    const id = await uploadAndPass(b, "sky-hopper", "<p>hop</p>");
    const details = await (await b.go("/dashboard/sky-hopper/details")).text();
    expect(details).toContain('href="/dashboard/sky-hopper/export.zip" data-download');
    expect(details).toContain("Export everything");

    const exported = await b.go("/dashboard/sky-hopper/export.zip");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/zip");
    expect(exported.headers.get("content-disposition")).toMatch(/^attachment; filename="sky-hopper-\d{4}-\d{2}-\d{2}\.zip"$/);
    // A readable cookie tells the page the download started, so the button's spinner stops (html.ts, BUSY_SCRIPT).
    const startedCookie = exported.headers.getSetCookie().find((cookie) => /^(__Host-)?download_started=1;/.test(cookie));
    expect(startedCookie).toBeDefined();
    expect(startedCookie).not.toContain("HttpOnly");
    const zip = new Uint8Array(await exported.arrayBuffer());
    expect(new TextDecoder().decode(zip)).toContain(`versions/${id}/index.html`);

    // Signed out, it's sign in first; someone else's account finds no such game.
    const out = await new Browser().go("/dashboard/sky-hopper/export.zip");
    expect(out.headers.get("location")).toBe("/signin?next=%2Fdashboard%2Fsky-hopper%2Fexport.zip");
    const stranger = new Browser();
    await join(stranger, "owl@example.com", "Other_Owl");
    const refused = await stranger.go("/dashboard/sky-hopper/export.zip");
    expect(refused.status).toBe(404);
    expect(refused.headers.get("content-type")).not.toBe("application/zip");
  });

  it("makes a game, publishes it and asks before hiding it", async () => {
    const b = new Browser();
    await join(b);
    // Until the beta, Your games says publishing opens with it, and nothing makes a game.
    const closed = await (await b.go("/dashboard")).text();
    expect(closed).toContain("Publishing opens with the beta.");
    expect(closed).not.toContain('action="/dashboard/new"');
    expect(closed).not.toContain("Work from your AI or terminal");
    expect(await (await b.go("/dashboard/new", { title: "Sky Hopper" })).text()).toContain("Publishing opens with the beta");
    expect(await gameBySlug(env.DB, "sky-hopper")).toBeNull();
    // Once Julius adds the account, it's a developer's page.
    await letPublishAs("Night_Owl");
    const open = await (await b.go("/dashboard")).text();
    expect(open).toContain("No games yet");
    expect(open).not.toContain("Publishing opens with the beta.");

    const made = await b.go("/dashboard/new", { title: "Sky Hopper" });
    expect(made.headers.get("location")).toBe("/dashboard/sky-hopper?done=made");
    expect(await (await b.go("/dashboard")).text()).toContain("Sky Hopper");

    const id = await uploadAndPass(b, "sky-hopper", "<p>hop</p>");
    const page = await (await b.go("/dashboard/sky-hopper")).text();
    expect(page).toContain(`/dashboard/sky-hopper/versions/${id}/publish`);
    expect(page).toContain("Preview");

    // A change comes back to the section its form was on.
    expect((await b.go(`/dashboard/sky-hopper/versions/${id}/publish`, {})).headers.get("location")).toBe("/dashboard/sky-hopper/versions?done=published");
    // A listed game needs a screenshot (one waiting for review counts).
    await env.DB.prepare("INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, created_at_ms) SELECT 'image_dashshot', id, 'screenshot', 'image/png', 1280, 720, 64, 0 FROM games WHERE slug = 'sky-hopper'").run();
    expect((await b.go("/dashboard/sky-hopper/visibility", { visibility: "listed", section: "players" })).headers.get("location")).toBe("/dashboard/sky-hopper/players?done=visibility");
    expect((await gameBySlug(env.DB, "sky-hopper"))!.visibility).toBe("listed");

    const asked = await b.go("/dashboard/sky-hopper/visibility", { visibility: "private" });
    expect(await asked.text()).toContain("Hide it from players");
    expect((await gameBySlug(env.DB, "sky-hopper"))!.visibility).toBe("listed");
    await b.go("/dashboard/sky-hopper/visibility", { visibility: "private", confirm: "yes" });
    expect((await gameBySlug(env.DB, "sky-hopper"))!.visibility).toBe("private");
  });

  it("splits each game into sections, each with the title and who can play", async () => {
    const b = new Browser();
    await join(b);
    await letPublishAs("Night_Owl");
    await b.go("/dashboard/new", { title: "Sky Hopper" });
    const id = await uploadAndPass(b, "sky-hopper", "<p>hop</p>");
    const sections = { "": "Latest upload", "/versions": "Tester links", "/details": "Cover and screenshots", "/players": "Multiplayer and game server use", "/database": "Export and import" };
    for (const [path, shows] of Object.entries(sections)) {
      const response = await b.go(`/dashboard/sky-hopper${path}`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(shows);
      expect(text).toContain("<h1>Sky Hopper</h1>");
      expect(text).toContain('aria-label="Who can play"');
      expect(text).toContain(`<a href="/dashboard/sky-hopper${path}" aria-current="page">`);
    }
    // The new upload is on Overview with its Publish button, which comes back to Overview.
    expect(await (await b.go("/dashboard/sky-hopper")).text()).toContain(`/dashboard/sky-hopper/versions/${id}/publish`);
    expect((await b.go(`/dashboard/sky-hopper/versions/${id}/publish`, { section: "overview" })).headers.get("location")).toBe("/dashboard/sky-hopper?done=published");
    expect((await b.go("/dashboard/sky-hopper/nowhere")).headers.get("location")).toBe("/dashboard/sky-hopper");
  });

  it("saves details and shows API refusals on the page", async () => {
    const b = new Browser();
    await join(b);
    await letPublishAs("Night_Owl");
    await b.go("/dashboard/new", { title: "Hop" });
    const saved = await b.go("/dashboard/hop/details", { title: "Hop Hop", description: "Jump.", devices: "phone", screen: "portrait" });
    expect(saved.headers.get("location")).toContain("done=details");
    expect(await gameBySlug(env.DB, "hop-hop")).toBeNull();
    // An unticked Cloud saves box turns them off; ticking it turns them back on.
    expect((await gameBySlug(env.DB, "hop"))!).toMatchObject({ title: "Hop Hop", devices: "phone", screen_orientation: "portrait", cloud_saves_enabled: 0 });
    await b.go("/dashboard/hop/details", { title: "Hop Hop", cloud_saves: "on" });
    expect((await gameBySlug(env.DB, "hop"))!.cloud_saves_enabled).toBe(1);
    expect(await (await b.go("/dashboard/hop/details")).text()).toContain('name="cloud_saves" checked');

    const refused = await b.go("/dashboard/hop/details", { title: "" });
    expect(refused.status).toBe(400);
    const refusedText = await refused.text();
    // The page shows the refusal in its own words, never the AI's fix.
    expect(refusedText).toContain("A title can&#39;t be empty or longer than the field allows.");
    expect(refusedText).not.toContain("Give 1 to 80 characters");
    expect(refusedText).toContain('<a href="/dashboard/hop/details" aria-current="page">');
  });

  it("keeps other people's games and other sites out", async () => {
    const owner = new Browser();
    await join(owner);
    await owner.go("/dashboard/new", { title: "Mine" });
    const other = new Browser();
    await join(other, "other@example.com", "Other_Owl");
    expect((await other.go("/dashboard/mine")).status).toBe(404);
    expect((await other.go("/dashboard/mine/visibility", { visibility: "draft" })).status).toBe(404);
    expect((await owner.go("/dashboard/mine/visibility", { visibility: "listed" }, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("messages Zaisma privately from the forum's pages as the developer, and shows who wrote each post", async () => {
    const b = new Browser();
    await join(b);
    await letPublishAs("Night_Owl");
    await b.go("/dashboard/new", { title: "Sky Hopper" });
    const board = await (await b.go("/forum")).text();
    expect(board).toContain('<a class="flush-row quiet foldable" data-lights href="/forum" aria-current="page">Forum</a>');
    expect(board).toContain('aria-label="Search the forum"');
    expect(board).toContain("New topic");
    expect(await (await b.go("/forum/new")).text()).toContain('<option value="sky-hopper">Sky Hopper</option>');
    expect((await new Browser().go("/forum/new")).headers.get("location")).toBe("/signin?next=%2Fforum%2Fnew");

    // A refusal keeps what was typed.
    const refused = await b.go("/forum/messages/new", { kind: "bug", title: "", text_markdown: "Kept text" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("Kept text");

    const sent = await b.go("/forum/messages/new", { kind: "bug", title: "Upload stalls at 99%", text_markdown: "My 300 MB build stops near the end.", game_slug: "sky-hopper", category: "publishing" });
    const id = sent.headers.get("location")!.match(/^\/forum\/(topic_[a-z0-9]+)\?done=posted-private$/)![1]!;
    expect(await env.DB.prepare("SELECT author_kind, posted_via, check_status FROM forum_posts WHERE topic_id = ?").bind(id).first()).toEqual({ author_kind: "developer", posted_via: "dashboard", check_status: null });

    // Their AI adds to it through the API, with a screenshot; the page names them, marks the AI's post, and shows it.
    const account = (await env.DB.prepare("SELECT id FROM accounts WHERE username = ?").bind("Night_Owl").first<{ id: string }>())!;
    const { token } = await createApiKey(env.DB, account.id, "claude");
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const added = await SELF.fetch(`${SITE}/api/dev/forum/${id}/posts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ text_markdown: "It fails at the last 4 MB part.", images_base64: [btoa(String.fromCharCode(...png))] }) });
    const aiPost = ((await added.json()) as { post: { id: string; media: { id: string }[] } }).post;
    const image = aiPost.media[0]!.id;
    const thread = await (await b.go(`/forum/${id}?done=posted-private`)).text();
    expect(thread).toContain('<strong><a class="to-profile" href="/@Night_Owl">Night_Owl</a></strong>');
    expect(thread).toContain('class="mark ai"');
    expect(thread).toContain("A message to Zaisma: only you and Zaisma see it");
    expect(thread).toContain(`/forum/media/${image}`);
    expect((await b.go(`/forum/media/${image}`)).headers.get("content-type")).toBe("image/png");
    expect(await (await b.go("/forum/messages")).text()).toContain("Upload stalls at 99%");
    expect(await (await b.go("/forum?tab=yours")).text()).not.toContain("Upload stalls at 99%");

    // Zaisma's reply is news on Your games until the topic is opened, and is marked as Zaisma's.
    await decideTopic(env, id, { reply: "We are on it." });
    expect(await (await b.go("/dashboard")).text()).toContain("Zaisma replied to one of your forum topics");
    const replied = await (await b.go(`/forum/${id}`)).text();
    expect(replied).toContain("We are on it.");
    expect(replied).toContain('class="mark team"');
    expect(await (await b.go("/dashboard")).text()).not.toContain("Zaisma replied");

    // Closed, it offers reopening.
    await decideTopic(env, id, { topicStatus: "fixed" });
    expect(await (await b.go(`/forum/${id}`)).text()).toContain('name="reopen" value="1"');
    const reopened = await b.go(`/forum/${id}/reply`, { text_markdown: "Back again.", reopen: "1" });
    expect(reopened.headers.get("location")).toMatch(new RegExp(`^/forum/${id}\\?done=reopened#p-post_[a-z0-9]+$`));
    expect((await env.DB.prepare("SELECT topic_status FROM forum_topics WHERE id = ?").bind(id).first<{ topic_status: string }>())!.topic_status).toBe("new");

    // Someone else's private topic looks like no topic, and so do its pictures; the old addresses lead here.
    const other = new Browser();
    await join(other, "other@example.com", "Other_Owl");
    expect((await other.go(`/forum/${id}`)).status).toBe(404);
    expect((await other.go(`/forum/media/${image}`)).status).toBe(404);
    expect((await b.go("/dashboard/feedback")).headers.get("location")).toBe("/forum?tab=yours");
    expect((await b.go(`/dashboard/feedback/${id}`)).headers.get("location")).toBe(`/forum/${id}`);
  });

  it("shows public topics to everyone once checked, with replies to one post, votes and answers", async () => {
    const pass: CheckDeps = { ai: async (_k, _m, text) => ({ verdict: /discord/i.test(text) ? "hold" : "ok", reason: "Asks to move to another app.", inputTokenCount: 100, outputTokenCount: 10 }) };
    const check = () => checkForumPosts({ ...env, ANTHROPIC_API_KEY: "test-key" }, pass);
    const first = new Browser();
    await join(first);
    const sent = await first.go("/forum/new", { kind: "question", title: "How do rooms pick a region?", text_markdown: "Players in Europe get a US room.", category: "rooms", tags: "mobile" });
    const id = sent.headers.get("location")!.match(/^\/forum\/(topic_[a-z0-9]+)\?done=checking$/)![1]!;

    // Until it's checked only its developer sees it.
    const reader = new Browser();
    expect(await (await reader.go("/forum")).text()).not.toContain("How do rooms pick a region?");
    expect((await reader.go(`/forum/${id}`)).status).toBe(404);
    expect(await (await first.go(`/forum/${id}`)).text()).toContain("Being checked");
    expect(await check()).toBe(1);
    const board = await (await reader.go("/forum")).text();
    expect(board).toContain("How do rooms pick a region?");
    expect(board).toContain("to post, reply and vote");
    expect(await (await reader.go(`/forum/${id}`)).text()).toContain("Sign in to reply");

    // Another developer replies; the first answers that one post.
    const other = new Browser();
    await join(other, "other@example.com", "Other_Owl");
    await other.go(`/forum/${id}/reply`, { text_markdown: "The one closest to the first player who joins." });
    await check();
    const answer = (await env.DB.prepare("SELECT id FROM forum_posts WHERE topic_id = ? AND text_markdown LIKE 'The one closest%'").bind(id).first<{ id: string }>())!.id;
    await first.go(`/forum/${id}/reply`, { text_markdown: "Thanks, that explains it.", reply_to_post_id: answer });
    await check();
    const page = await (await reader.go(`/forum/${id}`)).text();
    expect(page).toContain('class="quote"');
    expect(page).toContain("<strong>Other_Owl</strong>");

    // Me too counts once per developer, never for your own topic.
    await other.go(`/forum/${id}/vote`, {});
    await other.go(`/forum/${id}/vote`, {});
    expect((await first.go(`/forum/${id}/vote`, {})).status).toBe(400);
    expect(await env.DB.prepare("SELECT vote_count, reply_count FROM forum_topics WHERE id = ?").bind(id).first()).toEqual({ vote_count: 1, reply_count: 2 });

    // Only the asker marks the answer.
    expect((await other.go(`/forum/${id}/answer`, { answer_post_id: answer })).status).toBe(403);
    await first.go(`/forum/${id}/answer`, { answer_post_id: answer });
    expect(await (await reader.go(`/forum/${id}`)).text()).toContain("Answered by Other_Owl");
    expect(await (await reader.go("/forum?tab=unanswered")).text()).not.toContain("How do rooms pick a region?");

    // A post the check holds stays with its writer until a person looks.
    await other.go(`/forum/${id}/reply`, { text_markdown: "Add me on discord to talk more." });
    await check();
    expect(await (await other.go(`/forum/${id}`)).text()).toContain("Waiting for a person at Zaisma");
    expect(await (await reader.go(`/forum/${id}`)).text()).not.toContain("discord");

    // Filters: kind, category and its section, tag.
    for (const [q, shown] of [["kind=question", true], ["kind=bug", false], ["category=rooms", true], ["section=multiplayer", true], ["section=publish", false], ["tag=mobile", true], ["search_text=region", true], ["search_text=nothing+like+it", false]] as const) {
      expect((await (await reader.go(`/forum?${q}`)).text()).includes("How do rooms pick a region?"), q).toBe(shown);
    }

    // A known issue is pinned at the top of its category.
    const bug = await first.go("/forum/messages/new", { kind: "bug", title: "Rooms drop at 50", text_markdown: "Everyone is disconnected.", category: "rooms" });
    await decideTopic(env, bug.headers.get("location")!.split("/")[2]!.split("?")[0]!, { topicStatus: "known", knownIssue: { title: "Rooms drop every player at 50", workaround: "Cap rooms at 40." } });
    const rooms = await (await reader.go("/forum?section=multiplayer")).text();
    expect(rooms).toContain("Known issues here");
    expect(rooms).toContain("Rooms drop every player at 50");
    expect(rooms).not.toContain("Everyone is disconnected.");
  });
});

describe("recently played", () => {
  async function liveGame(slug: string, title: string) {
    const id = `g-${slug}`;
    await env.DB.prepare("INSERT INTO games (id, slug, title, description, review_status, visibility, created_at_ms, updated_at_ms) VALUES (?, ?, ?, '', 'live', 'listed', 1, 1)").bind(id, slug, title).run();
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms, published_at_ms, patch_notes) VALUES (?, ?, 'x', 1, 1, 'approved', 1, ?, ?)").bind(`v-${slug}`, id, Date.now(), "New levels.").run();
    await env.DB.prepare("UPDATE games SET live_version_id = ? WHERE id = ?").bind(`v-${slug}`, id).run();
  }

  it("remembers games for signed-in players, newest first, and forgets them with the account", async () => {
    await liveGame("hop", "Hop");
    await liveGame("dash", "Dash");
    const b = new Browser();
    await join(b);
    expect((await b.go("/api/me/played/hop", undefined, { method: "POST", body: "{}" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    await b.go("/api/me/played/dash", undefined, { method: "POST", body: "{}" });
    const { played } = (await (await b.go("/api/me/played")).json()) as { played: { slug: string }[] };
    expect(played.map((p) => p.slug)).toEqual(["dash", "hop"]);

    expect((await b.go("/api/me/played/hop", undefined, { method: "POST", body: "{}", origin: "https://evil.example" })).status).toBe(403);
    expect((await b.go("/api/me/played/nope", undefined, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await new Browser().go("/api/me/played")).status).toBe(401);

    await b.go("/account/delete", { confirm: "delete" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM played").first<{ n: number }>())!.n).toBe(0);
  });

  it("brings a guest's games from this device to their new account, keeping the newer time", async () => {
    await liveGame("hop", "Hop");
    await liveGame("dash", "Dash");
    const b = new Browser();
    await join(b);
    await b.go("/api/me/played/hop", undefined, { method: "POST", body: "{}" });
    const list = { played: [{ slug: "hop", played_at_ms: 5 }, { slug: "dash", played_at_ms: 10 }, { slug: "nope", played_at_ms: 20 }, { slug: "dash", played_at_ms: "soon" }] };
    expect((await b.go("/api/me/played", undefined, { method: "POST", body: JSON.stringify(list) })).status).toBe(200);
    const { played } = (await (await b.go("/api/me/played")).json()) as { played: { slug: string; played_at_ms: number }[] };
    expect(played.map((p) => p.slug)).toEqual(["hop", "dash"]);
    expect(played[0]!.played_at_ms).toBeGreaterThan(5);
    expect(played[1]!.played_at_ms).toBe(10);
    expect((await b.go("/api/me/played", undefined, { method: "POST", body: "{}", origin: "https://evil.example" })).status).toBe(403);
    expect((await b.go("/api/me/played", undefined, { method: "POST", body: "nope" })).status).toBe(400);
  });

  it("shows games on the home page and patch notes on the game page", async () => {
    await liveGame("hop", "Hop");
    const home = await (await SELF.fetch(`${SITE}/`)).text();
    expect((pageDataOf(home, "home-data") as { games: { slug: string }[] }).games.map((game) => game.slug)).toContain("hop");
    const page = await (await SELF.fetch(`${SITE}/g/hop`)).text();
    expect(page).toContain("New levels.");
    // Patch notes are a section of the one scroll: a heading, dated entries, the notes.
    expect(page).toMatch(/id="updates"[\s\S]*?<h2>Updates<\/h2>[\s\S]*?<h3>[^<]+<\/h3><p>New levels\.<\/p>/);
    expect(pageDataOf(page, "game-page-data").autoplay).toBe("never");
    expect(pageDataOf(await (await SELF.fetch(`${SITE}/g/hop?play`)).text(), "game-page-data").autoplay).toBe("always");
  });
});

// --- A software authenticator and the passkey calls, for the passkey and key tests ---

// A software authenticator: what a phone or laptop does when it makes and uses a passkey.
const RP = "zaisma.test";
const sha = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const text = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) (out.set(p, i), (i += p.length));
  return out;
};
const u32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
// WebCrypto signs as r||s; WebAuthn sends DER.
const der = (raw: Uint8Array) => {
  const int = (x: Uint8Array) => {
    let i = 0;
    while (i < x.length - 1 && x[i] === 0) i++;
    const v = x.slice(i);
    return v[0]! & 0x80 ? cat(new Uint8Array([2, v.length + 1, 0]), v) : cat(new Uint8Array([2, v.length]), v);
  };
  const body = cat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return cat(new Uint8Array([0x30, body.length]), body);
};

class Device {
  keys!: CryptoKeyPair;
  id = crypto.getRandomValues(new Uint8Array(16));
  count = 0;
  async create(options: { challenge: string }, origin = SITE) {
    this.keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const auth = cat(await sha(text(RP)), new Uint8Array([0x45]), u32(0), new Uint8Array(16), new Uint8Array([0, this.id.length]), this.id);
    return {
      id: b64url(this.id),
      clientDataJSON: b64url(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin })),
      authenticatorData: b64url(auth),
      publicKey: b64url((await crypto.subtle.exportKey("spki", this.keys.publicKey)) as ArrayBuffer),
      alg: -7,
    };
  }
  async get(challenge: string, opts: { origin?: string; count?: number } = {}) {
    this.count = opts.count ?? this.count + 1;
    const auth = cat(await sha(text(RP)), new Uint8Array([0x05]), u32(this.count));
    const client = text(JSON.stringify({ type: "webauthn.get", challenge, origin: opts.origin ?? SITE }));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, cat(auth, await sha(client))));
    return { id: b64url(this.id), clientDataJSON: b64url(client), authenticatorData: b64url(auth), signature: b64url(der(sig)) };
  }
}

const api = async (b: Browser, path: string, body: unknown = {}) => {
  const res = await b.go(path, undefined, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
};
async function addPasskey(b: Browser, device = new Device(), isWaiting = false) {
  const options = await api(b, "/api/passkeys/add/options");
  expect(options.status).toBe(200);
  expect(options.data).toMatchObject({ rp: { id: RP, name: "Zaisma" }, algs: [-7, -257] });
  const added = await api(b, "/api/passkeys/add", await device.create(options.data as { challenge: string }));
  expect(added).toEqual({ status: 200, data: { ok: true, is_waiting: isWaiting } });
  return device;
}

/** A tap on a passkey made for this purpose: the challenge from the options call, signed by the device. */
async function tapFor(b: Browser, device: Device, purpose: "confirm" | "key") {
  const options = await api(b, "/api/passkeys/tap/options", { purpose });
  expect(options.status).toBe(200);
  return device.get(String(options.data.challenge));
}

/** A tap as the popup sends it (components/confirm-its-you.ts): snake_case, in passkey_tap. */
const tapBody = (tap: { id: string; clientDataJSON: string; authenticatorData: string; signature: string }) => ({
  passkey_tap: { passkey_id: tap.id, client_data_json: tap.clientDataJSON, authenticator_data: tap.authenticatorData, signature: tap.signature, user_handle: "" },
});

/** Confirm it's you with a tap, as the account page's popup does. */
async function confirmWith(b: Browser, device: Device) {
  const tap = await tapFor(b, device, "confirm");
  return api(b, "/api/account/confirm", tapBody(tap));
}

/** Make an API key as the account page does: a tap made for the key, sent with the form. */
async function makeKey(b: Browser, device: Device, fields: Record<string, string> | URLSearchParams = { name: "My laptop", access_level: "full", game_scope: "all" }) {
  const tap = await tapFor(b, device, "key");
  const form = new URLSearchParams(fields);
  for (const [name, value] of Object.entries({ passkey_id: tap.id, client_data_json: tap.clientDataJSON, authenticator_data: tap.authenticatorData, signature: tap.signature, user_handle: "" })) form.set(name, value);
  return b.go("/dashboard/settings/keys", form);
}
async function signInWith(device: Device, opts: { origin?: string; count?: number } = {}) {
  const b = new Browser();
  const { data } = await api(b, "/api/passkeys/signin/options");
  const res = await api(b, "/api/passkeys/signin", { ...(await device.get(String(data.challenge), opts)), next: "/account" });
  return { b, ...res };
}


describe("passkeys", () => {
  it("keeps its shared script safe to run again, as a sign-in step swapped in place runs it", () => {
    // A top-level const or let can't be declared twice on a page, so running it again would throw.
    expect(PASSKEY_SCRIPT.sourceText).not.toMatch(/^(const|let) /m);
  });
  /** The challenge cookie a browser holds, as its name and value. */
  const pkCookie = (b: Browser): [string, string] => [...b.jar].find(([name]) => name.endsWith("zaisma_pk"))!;
  it("takes a passkey tap or sign-in once, even from a passkey that never counts its uses", async () => {
    const b = new Browser();
    await join(b);
    const device = await addPasskey(b);

    // A passkey sign-in sent again with the same cookie and body, as a copy of the request would, opens nothing.
    const first = new Browser();
    const { data } = await api(first, "/api/passkeys/signin/options");
    const signInBody = { ...(await device.get(String(data.challenge), { count: 0 })), next: "/account" };
    const challengeCookie = pkCookie(first);
    expect((await api(first, "/api/passkeys/signin", signInBody)).status).toBe(200);
    const again = new Browser();
    again.jar.set(...challengeCookie);
    expect((await api(again, "/api/passkeys/signin", signInBody)).status).toBe(400);
    expect(await (await again.go("/account")).text()).not.toContain("fox@example.com");

    // A key-making tap sent twice makes one key.
    const tap = await tapFor(b, device, "key");
    const keyCookie = pkCookie(b);
    const keyForm = () => new URLSearchParams({ name: "My laptop", access_level: "full", game_scope: "all", passkey_id: tap.id, client_data_json: tap.clientDataJSON, authenticator_data: tap.authenticatorData, signature: tap.signature, user_handle: "" });
    const countKeys = async () => (await env.DB.prepare("SELECT COUNT(*) AS count FROM api_keys").first<{ count: number }>())!.count;
    const keysBefore = await countKeys();
    await b.go("/dashboard/settings/keys", keyForm());
    expect(await countKeys()).toBe(keysBefore + 1);
    b.jar.set(...keyCookie);
    await b.go("/dashboard/settings/keys", keyForm());
    expect(await countKeys()).toBe(keysBefore + 1);

    // And a challenge nobody asked this server for is no challenge: a cookie of the page's own making does nothing.
    const forged = new Browser();
    forged.jar.set(challengeCookie[0], "in.not-issued-by-this-server");
    expect((await api(forged, "/api/passkeys/signin", { ...(await device.get("not-issued-by-this-server", { count: 0 })), next: "/account" })).status).toBe(400);
  });

  it("adds a passkey after a recent sign-in, then signs back in with it", async () => {
    const b = new Browser();
    await join(b);
    const device = await addPasskey(b);
    expect(await (await b.go("/account")).text()).toContain("Added on");

    const { b: other, status, data } = await signInWith(device);
    expect(status).toBe(200);
    expect(data.next).toBe("/account");
    expect(await (await other.go("/account")).text()).toContain("fox@example.com");
    const row = await env.DB.prepare("SELECT sign_count, last_used_at_ms FROM passkeys").first<{ sign_count: number; last_used_at_ms: number }>();
    expect(row!.sign_count).toBe(1);
    expect(row!.last_used_at_ms).toBeGreaterThan(0);
  });

  it("refuses a wrong site, a reused challenge, a copied key and a removed passkey", async () => {
    const b = new Browser();
    await join(b);
    const device = await addPasskey(b);
    expect((await signInWith(device, { origin: "https://evil.example" })).status).toBe(400);

    // A challenge works once.
    const once = new Browser();
    const { data } = await api(once, "/api/passkeys/signin/options");
    const use = await device.get(String(data.challenge));
    expect((await api(once, "/api/passkeys/signin", use)).status).toBe(200);
    expect((await api(once, "/api/passkeys/signin", use)).status).toBe(400);

    // A sign count that goes backwards means a copied key.
    expect((await signInWith(device, { count: 1 })).status).toBe(400);

    const id = (await env.DB.prepare("SELECT id FROM passkeys").first<{ id: string }>())!.id;
    await b.go(`/account/passkeys/${id}/remove`, {});
    expect((await signInWith(device)).status).toBe(400);
  });

  it("asks to confirm it's you with the password when the last sign-in wasn't recent", async () => {
    const b = new Browser();
    await join(b);
    await signIn(b, { username: "Night_Owl", password: PASSWORD });
    await ageProofs();
    // Every action is on the page, its button asking in the popup when pressed, with the password for the way (no passkey on the account).
    const page = await (await b.go("/account")).text();
    expect(page).toContain('id="account-confirm"');
    expect(page).toContain('"strong_methods":["password"]');
    expect(page).toContain('"is_confirmed_for_ms":0');
    expect(page).toMatch(/<form[^>]*action="\/account\/password"[^>]*data-confirm="strong"/);
    expect(page).toMatch(/<form[^>]*action="\/account\/delete"[^>]*data-confirm="strong"/);
    expect(page).toMatch(/<a[^>]*href="\/account\/data\.zip"[^>]*data-confirm="strong"/);
    expect(page).toContain('id="passkey-add"');
    expect(page).not.toContain('action="/account/confirm"');
    expect((await api(b, "/api/passkeys/add/options")).data).toMatchObject({ confirm: true });
    for (const [path, form] of [["/account/password", { password: "another fine password" }], ["/account/email", { email: "new@example.com" }], ["/account/email/remove", {}]] as const) {
      expect((await b.go(path, form)).headers.get("location")).toBe("/account?confirm-first#signing-in");
    }

    expect(await api(b, "/api/account/confirm", { password: "not my password" })).toEqual({ status: 403, data: { error: "That password isn't right." } });
    expect(await api(b, "/api/account/confirm", {})).toEqual({ status: 400, data: { error: "Send a passkey_tap or a password." } });
    expect(await api(b, "/api/account/confirm", { password: PASSWORD })).toEqual({ status: 200, data: { is_confirmed: true } });
    // The page now holds what the proof has left, so the popup stays shut for the next press.
    expect(await (await b.go("/account")).text()).toMatch(/"is_confirmed_for_ms":(5\d{5}|6\d{5})/);
    expect((await b.go("/account/password", { password: "another fine password" })).headers.get("location")).toBe("/account?password-saved#signing-in");
    await addPasskey(b);
  });

  it("confirms an account without a password by an email code, then it can add one", async () => {
    users.set("old@example.com", "u-old");
    await createAccount(env.DB, { id: "u-old", username: "Old_Timer", ageBand: "18+" });
    const b = new Browser();
    await signInByEmail(b, "old@example.com");
    await ageProofs();
    const page = await (await b.go("/account")).text();
    expect(page).toContain("Email me a code");
    expect(page).toContain("No password yet.");

    const sentBefore = emails.length;
    const code = await (await b.go("/account/confirm", { turnstile_token: "email_code" })).text();
    expect(emails.length).toBe(sentBefore + 1);
    expect(emails.at(-1)!.text).toContain("Enter this code on Zaisma to confirm it's you:");
    expect(code).toContain('value="/account?confirmed#signing-in"');
    expect((await b.go("/signin/code", { email: "old@example.com", code: codeSentTo("old@example.com"), next: "/account?confirmed#signing-in" })).headers.get("location")).toBe("/account?confirmed#signing-in");
    expect((await b.go("/account/password", { password: "short" })).status).toBe(200);
    expect((await b.go("/account/password", { password: "a password at last" })).headers.get("location")).toBe("/account?password-saved#signing-in");
    expect((await accountById(env.DB, "u-old"))?.password_changed_at_ms).toEqual(expect.any(Number));
    expect((await signIn(new Browser(), { username: "old_timer", password: "a password at last" })).headers.get("location")).toBe("/");
  });

  it("only takes requests from our own pages, and deletes passkeys with the account", async () => {
    const b = new Browser();
    await join(b);
    const device = await addPasskey(b);
    expect((await b.go("/api/passkeys/signin/options", undefined, { method: "POST", body: "{}", origin: "https://evil.example" })).status).toBe(403);
    expect((await api(new Browser(), "/api/passkeys/add/options")).status).toBe(401);
    // The account has a passkey, so only a tap on it confirms it's them.
    expect((await b.go("/account/delete", { confirm: "delete" })).headers.get("location")).toBe("/account?confirm-first#signing-in");
    await confirmWith(b, device);
    await b.go("/account/delete", { confirm: "delete" });
    expect(await env.DB.prepare("SELECT * FROM passkeys").first()).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM session_proofs").first()).toBeNull();
  });

  it("offers passkeys on the sign-in page", async () => {
    const page = await (await new Browser().go("/signin?next=/g/owl")).text();
    expect(page).toContain("Sign in with a passkey");
    expect(page).toContain('autocomplete="username webauthn"');
  });
});

describe("Confirm it's you", () => {
  const RISKY: [string, Record<string, string>][] = [
    ["/account/password", { password: "another fine password" }],
    ["/account/email", { email: "new@example.com", turnstile_token: "email_code" }],
    ["/account/email/remove", {}],
    ["/account/delete", { confirm: "delete" }],
  ];
  const confirmFirst = "/account?confirm-first#signing-in";
  const passkeyIdOf = (device: Device) => b64url(device.id);

  /** An account with an email and a passkey, and a new browser signed in with only its password. */
  async function accountWithPasskey() {
    const b = new Browser();
    await join(b);
    const device = await addPasskey(b);
    const other = new Browser();
    await signIn(other, { username: "Night_Owl", password: PASSWORD });
    return { b, device, other };
  }

  it("a password sign-in on an account with a passkey changes nothing risky", async () => {
    const { device, other } = await accountWithPasskey();
    for (const [path, form] of RISKY) expect((await other.go(path, form)).headers.get("location"), path).toBe(confirmFirst);
    expect((await other.go(`/account/passkeys/${passkeyIdOf(device)}/remove`, {})).headers.get("location")).toBe(confirmFirst);
    expect((await signIn(new Browser(), { username: "Night_Owl", password: PASSWORD })).headers.get("location")).toBe("/");
    expect(await env.DB.prepare("SELECT COUNT(*) AS passkey_count FROM passkeys").first()).toEqual({ passkey_count: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS account_count FROM accounts").first()).toEqual({ account_count: 1 });
    const page = await (await other.go("/account")).text();
    // The passkey is the way for what's risky; the password only for adding a passkey (which waits a day).
    expect(page).toContain('"strong_methods":["passkey"]');
    expect(page).toContain('"add_methods":["passkey","password"]');
    expect(page).toMatch(/<form[^>]*action="\/account\/delete"[^>]*data-confirm="strong"/);
    expect(page).not.toContain('id="confirm"');
  });

  it("a passkey tap confirms it, for 10 minutes", async () => {
    const { device, other } = await accountWithPasskey();
    const confirmed = await confirmWith(other, device);
    expect(confirmed).toEqual({ status: 200, data: { is_confirmed: true } });
    expect((await other.go("/account/password", { password: "another fine password" })).headers.get("location")).toBe("/account?password-saved#signing-in");
    await ageProofs();
    expect((await other.go("/account/password", { password: "one more fine password" })).headers.get("location")).toBe(confirmFirst);
  });

  it("a tap for the wrong purpose, a reused challenge or another account's passkey doesn't confirm", async () => {
    const { b, device, other } = await accountWithPasskey();
    // A tap made for a key isn't one for confirming it's you.
    const forKey = await tapFor(other, device, "key");
    expect((await api(other, "/api/account/confirm", tapBody(forKey))).status).toBe(403);
    expect((await other.go("/account/password", { password: "another fine password" })).headers.get("location")).toBe(confirmFirst);

    // A challenge works once.
    const tap = await tapFor(other, device, "confirm");
    expect((await api(other, "/api/account/confirm", tapBody(tap))).status).toBe(200);
    await ageProofs();
    expect((await api(other, "/api/account/confirm", tapBody(tap))).status).toBe(403);
    expect((await other.go("/account/password", { password: "another fine password" })).headers.get("location")).toBe(confirmFirst);

    // A passkey of another account signs this account's challenge.
    const stranger = new Browser();
    await join(stranger, "owl@example.com", "Owl_Two");
    const strangerDevice = await addPasskey(stranger);
    const { data } = await api(other, "/api/passkeys/tap/options", { purpose: "confirm" });
    const wrong = await strangerDevice.get(String(data.challenge));
    expect((await api(other, "/api/account/confirm", tapBody(wrong))).status).toBe(403);
    expect((await other.go("/account/password", { password: "another fine password" })).headers.get("location")).toBe(confirmFirst);
    // And the signed-in browser's own proof still works for it.
    expect((await confirmWith(b, device)).status).toBe(200);
  });

  it("making a key needs a tap made for it", async () => {
    const b = new Browser();
    await join(b);
    const form = { name: "My laptop", access_level: "full", game_scope: "all" };
    const keyCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS key_count FROM api_keys").first<{ key_count: number }>())!.key_count;

    // No passkey yet: add one first.
    expect(await (await b.go("/dashboard/settings/keys", form)).text()).toContain("Add a passkey first: making a key needs one.");
    expect(await api(b, "/api/passkeys/tap/options", { purpose: "key" })).toEqual({ status: 400, data: { error: "Add a passkey first: making a key needs one." } });
    const device = await addPasskey(b);
    expect(await keyCount()).toBe(0);

    // No tap, a tap made for confirming, and a reused tap make nothing.
    expect(await (await b.go("/dashboard/settings/keys", form)).text()).toContain("Making a key needs a tap on your passkey. Try again.");
    const forConfirm = await tapFor(b, device, "confirm");
    const fields = (tap: Awaited<ReturnType<typeof tapFor>>) => ({ ...form, passkey_id: tap.id, client_data_json: tap.clientDataJSON, authenticator_data: tap.authenticatorData, signature: tap.signature, user_handle: "" });
    expect(await (await b.go("/dashboard/settings/keys", fields(forConfirm))).text()).toContain("Making a key needs a tap");
    expect(await keyCount()).toBe(0);
    const tap = await tapFor(b, device, "key");
    expect(await (await b.go("/dashboard/settings/keys", fields(tap))).text()).toContain("Your new key");
    expect(await keyCount()).toBe(1);
    expect(await (await b.go("/dashboard/settings/keys", fields(tap))).text()).toContain("Making a key needs a tap");
    expect(await keyCount()).toBe(1);
    // A signature that doesn't match is no tap either.
    const forged = await tapFor(b, device, "key");
    expect(await (await b.go("/dashboard/settings/keys", { ...fields(forged), signature: b64url("not a signature") })).text()).toContain("Making a key needs a tap");
    expect(await keyCount()).toBe(1);
  });

  it("Developer settings asks for a passkey first, and knows when one is waiting", async () => {
    const b = new Browser();
    await join(b);
    const none = await (await b.go("/dashboard/settings")).text();
    expect(none).toContain("Making a key needs your passkey");
    expect(none).toContain('href="/account#passkeys"');
    expect(none).not.toContain('name="passkey_id"');
    const device = await addPasskey(b);
    const ready = await (await b.go("/dashboard/settings")).text();
    expect(ready).toContain('data-tap="key"');
    expect(ready).toContain('name="passkey_id"');
    expect(ready).not.toContain("Making a key needs your passkey");
    // Make the key asks for the passkey in the Confirm it's you popup.
    expect(ready).toContain('id="settings-confirm"');
    expect(await (await makeKey(b, device)).text()).toContain("Your new key");
  });

  it("the first passkey makes keys at once and sends no email", async () => {
    const b = new Browser();
    await join(b);
    const emailCount = emails.length;
    const device = await addPasskey(b);
    expect(emails).toHaveLength(emailCount);
    const row = await env.DB.prepare("SELECT approves_from_at_ms FROM passkeys").first<{ approves_from_at_ms: number }>();
    expect(row!.approves_from_at_ms).toBeLessThanOrEqual(Date.now());
    expect(await (await makeKey(b, device)).text()).toContain("Your new key");
  });

  it("a passkey added through the password after losing them waits a day, and the email is told", async () => {
    const { device: oldDevice, other } = await accountWithPasskey();
    // The password only lets this browser add a passkey, and the page says so.
    expect(await api(other, "/api/account/confirm", { password: PASSWORD })).toEqual({ status: 200, data: { is_confirmed: true } });
    for (const [path, form] of RISKY) expect((await other.go(path, form)).headers.get("location"), path).toBe(confirmFirst);
    const emailCount = emails.length;
    const newDevice = await addPasskey(other, new Device(), true);
    const waiting = await env.DB.prepare("SELECT approves_from_at_ms FROM passkeys WHERE id = ?").bind(passkeyIdOf(newDevice)).first<{ approves_from_at_ms: number }>();
    expect(waiting!.approves_from_at_ms).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(waiting!.approves_from_at_ms).toBeLessThanOrEqual(Date.now() + 24 * 3600_000);
    expect(emails).toHaveLength(emailCount + 1);
    expect(emails.at(-1)).toMatchObject({ to: "fox@example.com", subject: "A new passkey was added to your Zaisma account" });
    expect(emails.at(-1)!.text).toContain("Night_Owl, on a device at ");
    expect(emails.at(-1)!.text).toContain("it can make API keys and change how you sign in from");
    const page = await (await other.go("/account?passkey-waiting")).text();
    expect(page).toMatch(/Passkey added\. It can make API keys and change how you sign in from \w+ \d+ at [\d:]+ [AP]M UTC\./);
    expect(page).toMatch(/Can make API keys from \w+ \d+ at [\d:]+ [AP]M UTC/);

    // It can't make a key, and a tap on it doesn't open the risky changes either.
    expect(await (await makeKey(other, newDevice)).text()).toContain("Making a key needs a tap");
    expect(await env.DB.prepare("SELECT * FROM api_keys").first()).toBeNull();
    expect((await confirmWith(other, newDevice)).status).toBe(200);
    expect((await other.go("/account/password", { password: "another fine password" })).headers.get("location")).toBe(confirmFirst);
    // The older passkey still does.
    expect((await confirmWith(other, oldDevice)).status).toBe(200);

    // A day on, it does both.
    await env.DB.prepare("UPDATE passkeys SET approves_from_at_ms = 0 WHERE id = ?").bind(passkeyIdOf(newDevice)).run();
    expect(await (await makeKey(other, newDevice)).text()).toContain("Your new key");
    await env.DB.exec("DELETE FROM passkeys WHERE id = '" + passkeyIdOf(oldDevice) + "'");
    await ageProofs();
    expect((await confirmWith(other, newDevice)).status).toBe(200);
    expect((await other.go("/account/password", { password: "another fine password" })).headers.get("location")).toBe("/account?password-saved&keys-check#developer");
  });

  it("a waiting passkey alone says when it can make keys", async () => {
    const b = new Browser();
    await join(b, null);
    const first = await addPasskey(b);
    await confirmWith(b, first);
    await b.go(`/account/passkeys/${passkeyIdOf(first)}/remove`, {});
    const other = new Browser();
    await signIn(other, { username: "Night_Owl", password: PASSWORD });
    const waiting = await addPasskey(other, new Device(), true);
    // No email to tell, so none was sent.
    expect(emails).toHaveLength(0);
    const page = await (await other.go("/dashboard/settings")).text();
    expect(page).toMatch(/Your new passkey can make keys from \w+ \d+ at [\d:]+ [AP]M UTC\./);
    expect(await api(other, "/api/passkeys/tap/options", { purpose: "key" })).toMatchObject({ status: 400, data: { error: expect.stringContaining("Your new passkey can make keys from") } });
  });

  it("removing every passkey and adding one through the password waits too", async () => {
    const { b, device } = await accountWithPasskey();
    await confirmWith(b, device);
    await b.go(`/account/passkeys/${passkeyIdOf(device)}/remove`, {});
    expect(await env.DB.prepare("SELECT * FROM passkeys").first()).toBeNull();
    const again = new Browser();
    await signIn(again, { username: "Night_Owl", password: PASSWORD });
    await addPasskey(again, new Device(), true);
  });

  it("a passkey added with an approving passkey's tap doesn't wait", async () => {
    const { b, device } = await accountWithPasskey();
    const emailCount = emails.length;
    await confirmWith(b, device);
    const second = await addPasskey(b, new Device(), false);
    expect(emails).toHaveLength(emailCount);
    expect(await (await makeKey(b, second)).text()).toContain("Your new key");
  });

  /** Two devices signed in as one account (the second a few seconds ago, so Zaisma can tell it from the new one), the first with a passkey and a key. */
  async function twoDevices() {
    const a = new Browser();
    await join(a);
    const device = await addPasskey(a);
    expect(await (await makeKey(a, device, { name: "CI key", access_level: "full", game_scope: "all" })).text()).toContain("Your new key");
    const other = new Browser();
    signInAgeSeconds = 5;
    await signIn(other, { username: "Night_Owl", password: PASSWORD });
    signInAgeSeconds = 0;
    expect((await other.go("/account")).status).toBe(200);
    return { a, device, other };
  }

  it("a new password signs out every other device, and lists the keys to turn off", async () => {
    const { a, device, other } = await twoDevices();
    expect((await confirmWith(a, device)).status).toBe(200);
    const saved = await a.go("/account/password", { password: "a brand new password" });
    expect(saved.headers.get("location")).toBe("/account?password-saved&keys-check#developer");
    expect(saved.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-zaisma="))).toBe(true);
    expect(logouts.at(-1)).toEqual({ scope: "others" });

    // This device keeps going, and its proof came with it: the keys window, then more changes without asking again.
    const page = await (await a.go("/account?password-saved&keys-check")).text();
    expect(page).toContain('id="keys-check"');
    expect(page).toContain("Check your API keys");
    expect(page).toContain("CI key");
    expect(page).toContain("Turn off");
    expect(page).toContain("Password saved, and every other device is signed out.");
    // The other device is out, with a token that hasn't run out.
    expect((await other.go("/account")).headers.get("location")).toBe("/signin");
    expect((await signIn(new Browser(), { username: "Night_Owl", password: "a brand new password" })).headers.get("location")).toBe("/");

    // Turning a key off removes it, and the window says when none are left.
    const id = page.match(/\/account\/keys\/([a-z0-9]+)\/revoke/)![1];
    expect((await a.go(`/account/keys/${id}/revoke`, { next: "/account?keys-check#developer" })).headers.get("location")).toBe("/account?keys-check#developer");
    expect(await (await a.go("/account?keys-check")).text()).toContain("No API keys left.");
    expect(await env.DB.prepare("SELECT * FROM api_keys").first()).toBeNull();
  });

  it("the other device stays out when Supabase doesn't sign it out, even after its token is refreshed", async () => {
    const a = new Browser();
    await join(a);
    const device = await addPasskey(a);
    const other = new Browser();
    // A token that has run out, so the next request refreshes it.
    tokenSeconds = 5;
    signInAgeSeconds = 5;
    await signIn(other, { username: "Night_Owl", password: PASSWORD });
    signInAgeSeconds = 0;
    tokenSeconds = 3600;
    expect((await other.go("/account")).status).toBe(200);
    isLogoutFailing = true;
    await confirmWith(a, device);
    expect((await a.go("/account/password", { password: "a brand new password" })).headers.get("location")).toBe("/account?password-saved#signing-in");
    expect(logouts.at(-1)).toEqual({ scope: "others" });
    expect((await a.go("/account")).status).toBe(200);
    expect((await other.go("/account")).headers.get("location")).toBe("/signin");
    // And the sign-in page clears its stale cookie, so the header stops saying signed in.
    const signinPage = await other.go("/signin");
    expect(signinPage.status).toBe(200);
    expect(other.jar.has("__Host-zaisma")).toBe(false);
  });

  it("the keys window goes on to where Forgot your password was headed", async () => {
    const a = new Browser();
    await join(a);
    const device = await addPasskey(a);
    await makeKey(a, device);
    await confirmWith(a, device);
    const saved = await a.go("/account/password", { password: "a brand new password", from: "new-password", next: "/g/arena" });
    expect(saved.headers.get("location")).toBe("/account?password-saved&keys-check&next=%2Fg%2Farena#developer");
    const page = await (await a.go("/account?password-saved&keys-check&next=%2Fg%2Farena")).text();
    expect(page).toContain('<a class="btn light" href="/g/arena">Done</a>');
    expect(page).toContain("next=%2Fg%2Farena");
  });

  it("Forgot your password sets a new one on an account without a passkey, but an email code can't on one with a passkey", async () => {
    const plain = new Browser();
    await join(plain, "fox@example.com", "Plain_Fox");
    const back = "/account?new-password";
    const noPasskey = new Browser();
    await signInByEmail(noPasskey, "fox@example.com", back);
    expect(await (await noPasskey.go(back)).text()).toContain('<dialog id="new-password"');
    expect((await noPasskey.go("/account/password", { from: "new-password", password: "a brand new password" })).headers.get("location")).toBe("/account?password-saved#signing-in");

    const keyed = new Browser();
    await join(keyed, "owl@example.com", "Owl_Two");
    await addPasskey(keyed);
    const viaCode = new Browser();
    await signInByEmail(viaCode, "owl@example.com", back);
    const page = await (await viaCode.go(back)).text();
    expect(page).not.toContain('<dialog id="new-password"');
    expect(page).toContain('"strong_methods":["passkey"]');
    expect((await viaCode.go("/account/password", { password: "a brand new password" })).headers.get("location")).toBe(confirmFirst);
  });

  it("Sign out on every device ends other sessions at once", async () => {
    const { a, other } = await twoDevices();
    await a.go("/signout", {});
    expect((await other.go("/account")).headers.get("location")).toBe("/signin");
    expect(logouts.at(-1)).toEqual({ scope: "global" });
  });

  it("Google sign-in counts as a recent proof on an account without a passkey", async () => {
    await join(new Browser(), "fox@example.com", "Night_Owl");
    const b = new Browser();
    await viaProvider(b, "/signin/with/google", "fox@example.com");
    const asked = await b.go("/account/email", { email: "new@example.com", turnstile_token: "email_code" });
    expect(asked.status).toBe(200);
    expect(await asked.text()).toContain("Check your email");
  });

  it("old proofs go after a day", async () => {
    await join(new Browser());
    expect(await env.DB.prepare("SELECT COUNT(*) AS proof_count FROM session_proofs").first()).toEqual({ proof_count: 1 });
    await deleteOldProofs(env, Date.now() + 25 * 3600_000);
    expect(await env.DB.prepare("SELECT COUNT(*) AS proof_count FROM session_proofs").first()).toEqual({ proof_count: 0 });
  });
});

describe("Sign in with Zaisma", () => {
  const CALLBACK = "https://skyhopper.test/auth/callback";
  const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM sign_in_codes; DELETE FROM sign_in_grants; DELETE FROM sign_in_apps;");
  });

  /** A developer with a sign-in app, made through the API with their session, as the dashboard would. */
  async function developerWithApp(kind: "confidential" | "public" = "confidential"): Promise<{ developer: Browser; appId: string; clientSecret: string | null }> {
    const developer = new Browser();
    await join(developer, `maker-${crypto.randomUUID()}@example.com`, "Sky_Maker");
    const made = await developer.go("/api/dev/sign-in-apps", undefined, { method: "POST", body: JSON.stringify({ name: "Sky Hopper Online", kind, redirect_urls: [CALLBACK] }) });
    expect(made.status).toBe(201);
    const answer = (await made.json()) as { sign_in_app: { id: string }; client_secret: string | null };
    return { developer, appId: answer.sign_in_app.id, clientSecret: answer.client_secret };
  }

  const authorizeQuery = (appId: string, extra: Record<string, string> = {}) =>
    `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: appId, redirect_uri: CALLBACK, scope: "openid profile", state: "state-123", nonce: "nonce-456", ...extra })}`;

  /** Says yes on the consent page, and answers the code the app gets back. */
  async function allow(player: Browser, appId: string, extra: Record<string, string> = {}): Promise<string> {
    const back = await player.go("/oauth/authorize", { response_type: "code", client_id: appId, redirect_uri: CALLBACK, scope: "openid profile", state: "state-123", nonce: "nonce-456", ...extra, decision: "allow" });
    expect(back.status).toBe(303);
    const url = new URL(back.headers.get("location")!);
    expect(url.origin + url.pathname).toBe(CALLBACK);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("iss")).toBe(SITE);
    return url.searchParams.get("code")!;
  }

  const swap = (form: Record<string, string>, headers: Record<string, string> = {}) =>
    SELF.fetch(`${SITE}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", redirect_uri: CALLBACK, ...form }), headers });

  async function readIdToken(idToken: string): Promise<Record<string, unknown>> {
    const { keys: published } = (await (await SELF.fetch(`${SITE}/.well-known/jwks.json`)).json()) as { keys: (JsonWebKey & { kid: string })[] };
    const [header, body, signature] = idToken.split(".") as [string, string, string];
    const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
    const headerJson = JSON.parse(new TextDecoder().decode(fromB64url(header))) as { alg: string; kid: string };
    expect(headerJson.alg).toBe("RS256");
    const jwk = published.find((candidate) => candidate.kid === headerJson.kid)!;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, RS256, false, ["verify"]);
    expect(await crypto.subtle.verify(RS256, key, fromB64url(signature), new TextEncoder().encode(`${header}.${body}`))).toBe(true);
    return JSON.parse(new TextDecoder().decode(fromB64url(body))) as Record<string, unknown>;
  }

  it("makes, changes and deletes sign-in apps through the API", async () => {
    const { developer, appId, clientSecret } = await developerWithApp();
    expect(clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const listed = (await (await developer.go("/api/dev/sign-in-apps")).json()) as { sign_in_apps: unknown[] };
    expect(listed.sign_in_apps).toHaveLength(1);
    expect(schemaProblems(SIGN_IN_APP, listed.sign_in_apps[0])).toEqual([]);
    expect(JSON.stringify(listed)).not.toContain(clientSecret);

    const make = (body: unknown) => developer.go("/api/dev/sign-in-apps", undefined, { method: "POST", body: JSON.stringify(body) });
    const plainHttp = await make({ name: "Sky Hopper", kind: "confidential", redirect_urls: ["http://skyhopper.test/callback"] });
    expect(((await plainHttp.json()) as { error: { code: string; field: string } }).error).toMatchObject({ code: "bad_redirect_urls", field: "redirect_urls[0]" });
    const lookalike = await make({ name: "Zaisma Login", kind: "public", redirect_urls: [CALLBACK] });
    const lookalikeAnswer = await lookalike.json();
    expect(errorProblems(lookalikeAnswer, lookalike.status)).toEqual([]);
    expect((lookalikeAnswer as { error: { code: string } }).error.code).toBe("bad_name");
    expect(((await (await make({ name: "Local", kind: "public", redirect_urls: ["http://localhost:3000/cb"] })).json()) as { client_secret: string | null }).client_secret).toBeNull();

    const change = (id: string, body: unknown) => developer.go(`/api/dev/sign-in-apps/${id}`, undefined, { method: "PATCH", body: JSON.stringify(body) });
    const replaced = (await (await change(appId, { replace_client_secret: true })).json()) as { client_secret: string };
    expect(replaced.client_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(replaced.client_secret).not.toBe(clientSecret);

    // Someone else's app is not yours to see or change.
    const stranger = new Browser();
    await join(stranger, "stranger@example.com", "Some_Stranger");
    const theirs = await stranger.go(`/api/dev/sign-in-apps/${appId}`, undefined, { method: "PATCH", body: JSON.stringify({ name: "Mine Now" }) });
    expect(((await theirs.json()) as { error: { code: string } }).error.code).toBe("no_sign_in_app");

    const removed = await developer.go(`/api/dev/sign-in-apps/${appId}`, undefined, { method: "DELETE", body: "{}" });
    expect(await removed.json()).toEqual({ removed_sign_in_app_id: appId, next_steps: [] });
  });

  it("signs a player in to a site, remembers their yes, and lets them take it back", async () => {
    const { appId, clientSecret } = await developerWithApp();
    const player = new Browser();

    // Signed out: sign in first, then back to the same step.
    const signedOut = await player.go(authorizeQuery(appId));
    expect(signedOut.status).toBe(303);
    const signinUrl = new URL(signedOut.headers.get("location")!, SITE);
    expect(signinUrl.pathname).toBe("/signin");
    expect(signinUrl.searchParams.get("next")).toContain(`/oauth/authorize?response_type=code&client_id=${appId}`);
    expect(await (await player.go(`/signin?next=${encodeURIComponent(signinUrl.searchParams.get("next")!)}`)).text()).toContain('name="next" value="/oauth/authorize?');

    await join(player, "owl@example.com", "Night_Owl");
    const consent = await player.go(authorizeQuery(appId));
    expect(consent.status).toBe(200);
    const consentPage = await consent.text();
    expect(consentPage).toContain("Sign in to Sky Hopper Online");
    expect(consentPage).toContain("Never your email");
    expect(consentPage).toContain("skyhopper.test");
    // Only gallery components, laid out by them: no style, class or sheet of its own.
    expect(pageProblems(consentPage)).toEqual([]);
    expect(consent.headers.get("content-security-policy")).toContain("form-action 'self' https://skyhopper.test");

    const code = await allow(player, appId);
    const wrongSecret = await swap({ code, client_id: appId, client_secret: "not-the-secret" });
    expect(wrongSecret.status).toBe(401);
    expect(((await wrongSecret.json()) as { error: string }).error).toBe("invalid_client");

    // The wrong secret didn't use the code up; the right one, by HTTP Basic, swaps it once.
    const swapped = await swap({ code }, { authorization: `Basic ${btoa(`${appId}:${clientSecret}`)}` });
    expect(swapped.status).toBe(200);
    const tokens = (await swapped.json()) as { access_token: string; id_token: string; token_type: string; expires_in: number };
    expect(tokens.token_type).toBe("Bearer");
    const account = await env.DB.prepare("SELECT player_id FROM accounts WHERE username = 'Night_Owl'").first<{ player_id: string }>();
    const claims = await readIdToken(tokens.id_token);
    expect(claims).toMatchObject({ iss: SITE, sub: account!.player_id, aud: appId, nonce: "nonce-456", name: "Night_Owl", preferred_username: "Night_Owl" });
    expect(JSON.stringify(claims)).not.toContain("owl@example.com");
    expect((await swap({ code, client_id: appId, client_secret: clientSecret! })).status).toBe(400);

    const userinfo = () => SELF.fetch(`${SITE}/oauth/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(await (await userinfo()).json()).toEqual({ sub: account!.player_id, name: "Night_Owl", preferred_username: "Night_Owl" });

    // The second time, straight back with a code.
    const again = await player.go(authorizeQuery(appId));
    expect(again.status).toBe(303);
    expect(new URL(again.headers.get("location")!).searchParams.get("code")).toBeTruthy();

    // Taken back on the account page: userinfo stops, and the app asks again.
    const accountPage = await (await player.go("/account")).text();
    expect(accountPage).toContain("Signed in with Zaisma");
    expect(accountPage).toContain("Sky Hopper Online");
    await player.go(`/account/sign-ins/${appId}/remove`, {});
    expect((await userinfo()).status).toBe(401);
    expect((await player.go(authorizeQuery(appId))).status).toBe(200);
  });

  it("needs PKCE from public apps, and checks the code_verifier", async () => {
    const { appId } = await developerWithApp("public");
    const player = new Browser();
    await join(player, "owl@example.com", "Night_Owl");
    const withoutPkce = await player.go(authorizeQuery(appId));
    expect(new URL(withoutPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");

    const verifier = "a-long-random-verifier-that-only-the-app-knows-1234567890";
    const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const pkce = { code_challenge: challenge, code_challenge_method: "S256" };
    const wrong = await swap({ code: await allow(player, appId, pkce), client_id: appId, code_verifier: "not-the-verifier" });
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_grant");
    const right = await swap({ code: await allow(player, appId, pkce), client_id: appId, code_verifier: verifier });
    expect(right.status).toBe(200);
    expect(right.headers.get("access-control-allow-origin")).toBe("*");

    // Signing in keeps the whole link, PKCE included, and comes back to it.
    await signOutThenWait(player);
    const next = new URL((await player.go(authorizeQuery(appId, pkce))).headers.get("location")!, SITE).searchParams.get("next")!;
    expect(next.length).toBeGreaterThan(200);
    expect(await (await player.go(`/signin?next=${encodeURIComponent(next)}`)).text()).toContain(`name="next" value="${next.replace(/&/g, "&amp;")}"`);
    expect((await signIn(player, { username: "Night_Owl", password: PASSWORD, next })).headers.get("location")).toBe(next);
    expect(new URL((await player.go(next)).headers.get("location")!).searchParams.get("code")).toBeTruthy();
  });

  it("refuses broken links and what it doesn't share, and publishes where everything is", async () => {
    const { appId } = await developerWithApp();
    const player = new Browser();
    expect((await player.go(authorizeQuery("sign_in_app_nosuchapp"))).status).toBe(400);
    expect(await (await player.go(authorizeQuery(appId, { redirect_uri: "https://evil.test/steal" }))).text()).toContain("register (redirect_uri)");
    const email = await player.go(authorizeQuery(appId, { scope: "openid email" }));
    expect(new URL(email.headers.get("location")!).searchParams.get("error")).toBe("invalid_scope");
    const silent = await player.go(authorizeQuery(appId, { prompt: "none" }));
    expect(new URL(silent.headers.get("location")!).searchParams.get("error")).toBe("login_required");

    const configuration = (await (await SELF.fetch(`${SITE}/.well-known/openid-configuration`)).json()) as Record<string, unknown>;
    expect(configuration).toMatchObject({ issuer: SITE, authorization_endpoint: `${SITE}/oauth/authorize`, token_endpoint: `${SITE}/oauth/token`, jwks_uri: `${SITE}/.well-known/jwks.json`, id_token_signing_alg_values_supported: ["RS256"] });
  });

  it("goes with the account: a player's yeses, and a developer's apps", async () => {
    const { developer, appId } = await developerWithApp();
    const player = new Browser();
    await join(player, "owl@example.com", "Night_Owl");
    await allow(player, appId);
    await player.go("/account/delete", { confirm: "delete" });
    expect(await env.DB.prepare("SELECT * FROM sign_in_grants").first()).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM sign_in_codes").first()).toBeNull();
    await developer.go("/account/delete", { confirm: "delete" });
    expect(await env.DB.prepare("SELECT * FROM sign_in_apps").first()).toBeNull();
  });
});

describe("pages behind a sign-in run only the site's script files", () => {
  // The browser checks every page it opens; these are the pages and states only a signed-in player or developer sees.
  it("the account, friends, profile, dashboard and forum pages, each with its own scripts", async () => {
    const b = new Browser();
    await join(b);
    const accountId = users.get("fox@example.com")!;
    const owner = await env.DB.prepare("INSERT INTO owners (id, kind, account_id, created_at_ms) VALUES ('owner_strict', 'person', ?, 1) ON CONFLICT (account_id) DO UPDATE SET kind = 'person' RETURNING id").bind(accountId).first<{ id: string }>();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, owner_id, created_at_ms, updated_at_ms) VALUES ('g-strict-own', 'strict-own', 'Own \"><img src=x onerror=alert(1)>', 'live', 'listed', 'v1', ?, 1, 1)").bind(owner!.id).run();
    const scriptsOf = async (path: string) => pageScriptNames(await (await b.go(path)).text());
    expect(await scriptsOf("/account?welcome")).toEqual(expect.arrayContaining(["joined", "username-check", "social-settings", "passkeys", "passkey-add", "bot-check"]));
    expect(await scriptsOf("/account?new-password")).toEqual(expect.arrayContaining(["new-password", "show-password"]));
    expect(await scriptsOf("/friends")).toContain("friends");
    expect(await scriptsOf("/@Night_Owl")).toContain("profile");
    expect(await scriptsOf("/dashboard")).toContain("local-times");
    expect(await scriptsOf("/dashboard/strict-own")).toEqual(expect.arrayContaining(["upload", "local-times"]));
    expect(await scriptsOf("/forum")).toEqual(expect.arrayContaining(["forum", "forum-posts"]));
    expect(await scriptsOf("/forum/new")).toEqual(expect.arrayContaining(["forum", "forum-posts"]));
    expect(await scriptsOf("/g/strict-own")).toEqual(expect.arrayContaining(["game-page", "saves", "sign-in-while-playing", "game-links", "game-autoplay"]));
    expect(await scriptsOf("/account/kept?game=strict-own")).toEqual(expect.arrayContaining(["joined", "back-to-game"]));
    await env.DB.prepare("DELETE FROM games WHERE id = 'g-strict-own'").run();
  });
});

describe("protect your account", () => {
  const PROTECT_LINE = '<div class="note" id="protect">';
  async function savedHoursAgo(accountId: string, hourCount: number) {
    const nowMs = Date.now();
    await env.DB.prepare("INSERT OR IGNORE INTO games (id, slug, title, review_status, created_at_ms, updated_at_ms) VALUES ('g-protect', 'protect-game', 'Protect Game', 'live', ?, ?)").bind(nowMs, nowMs).run();
    await env.DB.prepare("INSERT OR REPLACE INTO saves (account_id, game_id, version_number, sha256, size_bytes, saved_at_ms) VALUES (?, 'g-protect', 1, 'x', 2, ?)").bind(accountId, nowMs - hourCount * 3600_000).run();
  }
  const offeredAtMs = async (accountId: string) => (await env.DB.prepare("SELECT protection_offered_at_ms FROM accounts WHERE id = ?").bind(accountId).first<{ protection_offered_at_ms: number | null }>())!.protection_offered_at_ms;
  afterEach(async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM saves WHERE game_id = 'g-protect'"), env.DB.prepare("DELETE FROM games WHERE id = 'g-protect'")]);
  });

  it("asks once on the home page when a player comes back to a save with neither a passkey nor an email, and keeps a line on the account page", async () => {
    const b = new Browser();
    await join(b, null);
    const id = await idOf("Night_Owl");
    // Nothing saved yet: nothing to lose, so the home page doesn't ask; the account page has the line.
    expect(await (await b.go("/")).text()).not.toContain('id="protect-account"');
    const accountPage = await (await b.go("/account")).text();
    expect(accountPage).toContain(PROTECT_LINE);
    expect(accountPage).toContain('href="#passkeys">Add a passkey</a> <a class="btn ghost" href="#email">Add an email</a>');
    expect(accountPage).toContain('<h3 class="sub" id="email">Email</h3>');

    // Saved 10 minutes ago: still playing, not back yet.
    await savedHoursAgo(id, 1 / 6);
    expect(await (await b.go("/")).text()).not.toContain('id="protect-account"');
    expect(await offeredAtMs(id)).toBeNull();

    // Back to a save from 2 hours ago: asked once, with both ways in and Later.
    await savedHoursAgo(id, 2);
    const home = await (await b.go("/")).text();
    expect(home).toContain('<dialog id="protect-account"');
    expect(home).toContain('href="/account#passkeys">Add a passkey</a>');
    expect(home).toContain('href="/account#email">Add an email</a>');
    expect(home).toContain("data-close>Later</button>");
    expect(home).not.toContain('type="password"');
    expect(pageScriptNames(home)).toContain("protect-account");
    expect(await offeredAtMs(id)).toEqual(expect.any(Number));
    expect(await (await b.go("/")).text()).not.toContain('id="protect-account"');
    expect(await (await b.go("/account")).text()).toContain(PROTECT_LINE);

    // Signed out, nobody is asked.
    await b.go("/signout", {});
    expect(await (await b.go("/")).text()).not.toContain('id="protect-account"');
  });

  it("asks nobody with an email or a passkey", async () => {
    const withEmail = new Browser();
    await join(withEmail, "fox@example.com");
    await savedHoursAgo(await idOf("Night_Owl"), 2);
    expect(await (await withEmail.go("/")).text()).not.toContain('id="protect-account"');
    expect(await (await withEmail.go("/account")).text()).not.toContain(PROTECT_LINE);

    const withPasskey = new Browser();
    await join(withPasskey, null, "Key_Holder");
    const id = await idOf("Key_Holder");
    await savedHoursAgo(id, 2);
    await env.DB.prepare("INSERT INTO passkeys (id, account_id, public_key, algorithm_number, sign_count, name, created_at_ms, last_used_at_ms, approves_from_at_ms) VALUES ('protect-passkey', ?, 'key', -7, 0, 'Mac', ?, NULL, 0)").bind(id, Date.now()).run();
    expect(await (await withPasskey.go("/")).text()).not.toContain('id="protect-account"');
    expect(await offeredAtMs(id)).toBeNull();
    expect(await (await withPasskey.go("/account")).text()).not.toContain(PROTECT_LINE);
  });

  it("leaves the account page to the email ask when that shows, so it never asks twice", async () => {
    const b = new Browser();
    await join(b, null);
    await createApiKey(env.DB, await idOf("Night_Owl"), "test");
    const page = await (await b.go("/account")).text();
    expect(page).toContain('id="email-ask"');
    expect(page).not.toContain(PROTECT_LINE);
  });

  it("shows adding a passkey and an email asking in the popup when the proof ran out", async () => {
    const b = new Browser();
    await join(b, null);
    const id = await idOf("Night_Owl");
    await env.DB.prepare("UPDATE session_proofs SET proved_at_ms = 0 WHERE account_id = ?").bind(id).run();
    const page = await (await b.go("/account")).text();
    expect(page).toContain('id="passkey-add"');
    expect(page).toContain('"add_methods":["password"]');
    expect(page).toMatch(/<form[^>]*action="\/account\/email"[^>]*data-confirm="strong"/);
    expect(page).not.toContain("Confirm it's you</a> above to add one.");
  });
});

describe("the security log on the account page", () => {
  const CHROME_ON_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const MANCHESTER = { asn: 64500, asOrganization: "Vodafone", city: "Manchester", region: "England", country: "GB" };
  const eventsOf = (accountId: string, kind?: string) =>
    env.DB.prepare(`SELECT * FROM security_events WHERE account_id = ?${kind ? " AND kind = ?" : ""} ORDER BY id`)
      .bind(...(kind ? [accountId, kind] : [accountId]))
      .all<Record<string, unknown>>()
      .then(({ results }) => results);
  /** A browser in Manchester on a Windows PC. */
  const inManchester = () => Object.assign(new Browser(), { userAgent: CHROME_ON_WINDOWS, cf: MANCHESTER as unknown as IncomingRequestCfProperties });

  it("writes one event for a password sign-in on a device the account hasn't marked, and none on one it has", async () => {
    const owner = inManchester();
    await join(owner, null);
    const id = await idOf("Night_Owl");
    // Making the account on this device.
    expect(await eventsOf(id)).toMatchObject([{ kind: "account_created", done_by: "you", device: "Chrome on a Windows PC", city_name: "Manchester", country_code: "GB", connection_address: null }]);
    await owner.go("/signout", {});
    await owner.go("/signin", { username: "Night_Owl", password: PASSWORD });
    expect(await eventsOf(id)).toHaveLength(1);

    const elsewhere = inManchester();
    await signIn(elsewhere, { username: "Night_Owl", password: PASSWORD });
    const [, second] = await eventsOf(id);
    expect(second).toMatchObject({ kind: "signed_in_new_device", sign_in_kind: "password", done_by: "you", device: "Chrome on a Windows PC", network_name: "Vodafone", city_name: "Manchester", region_name: "England", country_code: "GB", connection_address: null, api_key_id: null });
    await elsewhere.go("/signout", {});
    await signIn(elsewhere, { username: "Night_Owl", password: PASSWORD });
    expect(await eventsOf(id)).toHaveLength(2);
  });

  it("logs a changed password, and a key made and removed with its places", async () => {
    const owner = inManchester();
    await join(owner, null);
    const id = await idOf("Night_Owl");
    await owner.go("/account/password", { password: "another long password" });
    expect(await eventsOf(id, "password_changed")).toHaveLength(1);

    // A key needs a tap on a passkey; adding the first one is logged too.
    const device = await addPasskey(owner);
    expect(await eventsOf(id, "passkey_added")).toHaveLength(1);
    const made = await (await makeKey(owner, device)).text();
    const token = made.match(/zsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}/)![0];
    const [created] = await eventsOf(id, "api_key_created");
    expect(created).toMatchObject({ subject_name: "My laptop", done_by: "you", connection_address: owner.ip, city_name: "Manchester" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS place_count FROM security_places WHERE account_id = ?").bind(id).first<{ place_count: number }>())!.place_count).toBe(1);
    // Used from the place it was made from: not new.
    await worker.fetch(new Request(`${SITE}/api/dev/games`, { headers: { authorization: `Bearer ${token}` }, cf: MANCHESTER as unknown as IncomingRequestCfProperties }), env, createExecutionContext());
    expect(await eventsOf(id, "api_key_new_place")).toHaveLength(0);

    const page = await (await owner.go("/dashboard/settings")).text();
    const keyId = page.match(/\/dashboard\/settings\/keys\/([a-z0-9]+)\/remove/)![1];
    await owner.go(`/dashboard/settings/keys/${keyId}/remove`, {});
    expect(await eventsOf(id, "api_key_removed")).toMatchObject([{ subject_name: "My laptop" }]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS place_count FROM security_places WHERE account_id = ?").bind(id).first<{ place_count: number }>())!.place_count).toBe(0);
  });

  it("shows the Activity list on the account page, with Not you? and the setting", async () => {
    const owner = inManchester();
    await join(owner, null);
    const page = await (await owner.go("/account")).text();
    expect(page).toContain('<h2 id="activity">Activity</h2>');
    expect(page).toContain("Made your account");
    expect(page).toContain("Chrome on a Windows PC · Vodafone, near Manchester, UK");
    expect(page).toContain('href="/account?not-you#signing-in">Not you?</a>');
    expect(page).toContain("Keep where my account is used from");
    expect(page).toMatch(/name="where_used_from_enabled" value="on" checked/);
    expect(await (await owner.go("/account?not-you")).text()).toContain("Don&#39;t recognize something in your activity?");
  });

  it("turns Keep where my account is used from off only after Confirm it's you, and wipes where, except an upload's address", async () => {
    const owner = inManchester();
    await join(owner, null);
    const id = await idOf("Night_Owl");
    // The proof of it's them is more than 10 minutes old.
    await ageProofs();
    const refused = await owner.go("/account/where-used-from", {});
    expect(refused.headers.get("location")).toBe("/account?confirm-first#signing-in");
    expect((await accountById(env.DB, id))!.where_used_from_enabled).toBe(1);

    await signOutThenWait(owner);
    await owner.go("/signin", { username: "Night_Owl", password: PASSWORD });
    // An upload from a key, with its address.
    await env.DB.prepare(
      "INSERT INTO security_events (account_id, kind, done_by, device, network_name, connection_address, happened_at_ms, last_happened_at_ms) VALUES (?, 'version_uploaded', 'api_key', 'the upload command 0.9.1', 'Microsoft Corporation', '203.0.113.40', ?, ?)",
    )
      .bind(id, Date.now(), Date.now())
      .run();
    const off = await owner.go("/account/where-used-from", {});
    expect(off.headers.get("location")).toBe("/account?where-off#activity");
    expect(await (await owner.go("/account?where-off")).text()).toContain("Saved. Your activity shows only what happened and when from now on.");
    expect((await accountById(env.DB, id))!.where_used_from_enabled).toBe(0);
    const rows = await eventsOf(id);
    for (const row of rows.filter((each) => each.kind !== "version_uploaded")) expect(row, String(row.kind)).toMatchObject({ device: null, network_name: null, city_name: null, region_name: null, country_code: null, connection_address: null });
    expect(rows.find((row) => row.kind === "version_uploaded")).toMatchObject({ device: null, network_name: null, connection_address: "203.0.113.40" });
    expect(rows.map((row) => row.kind)).toContain("where_used_from_turned_off");

    // A new sign-in has no where; it's in the Activity API, without a where, for a full key.
    const elsewhere = inManchester();
    await signIn(elsewhere, { username: "Night_Owl", password: PASSWORD });
    expect((await eventsOf(id, "signed_in_new_device")).at(-1)).toMatchObject({ device: null, city_name: null, connection_address: null });
    const token = (await createApiKey(env.DB, id, "full")).token;
    const activity = await (await SELF.fetch(`${SITE}/api/dev/activity`, { headers: { authorization: `Bearer ${token}` } })).json();
    expect(schemaProblems(ACTIVITY, activity)).toEqual([]);
    expect(activity).toMatchObject({ where_used_from_enabled: false });
    expect((activity as { events: { kind: string }[] }).events.map((event) => event.kind)).toContain("where_used_from_turned_off");

    // Turning it back on needs nothing more.
    const on = await owner.go("/account/where-used-from", { where_used_from_enabled: "on" });
    expect(on.headers.get("location")).toBe("/account?where-on#activity");
    expect((await accountById(env.DB, id))!.where_used_from_enabled).toBe(1);
  });

  it("deletes the log and the places with the account", async () => {
    const owner = inManchester();
    await join(owner, null);
    const id = await idOf("Night_Owl");
    expect((await env.DB.prepare("SELECT COUNT(*) AS network_count FROM sign_in_networks WHERE account_id = ?").bind(id).first<{ network_count: number }>())!.network_count).toBe(1);
    await makeKey(owner, await addPasskey(owner));
    expect((await eventsOf(id)).length).toBeGreaterThan(0);
    await owner.go("/account/delete", { confirm: "delete" });
    expect(await eventsOf(id)).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS place_count FROM security_places WHERE account_id = ?").bind(id).first<{ place_count: number }>())!.place_count).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS network_count FROM sign_in_networks WHERE account_id = ?").bind(id).first<{ network_count: number }>())!.network_count).toBe(0);
  });
});

describe("leaked keys on the account page", () => {
  const MANCHESTER = { asn: 64500, asOrganization: "Vodafone", city: "Manchester", region: "England", country: "GB" };
  // A key's row on Developer settings: its name, then its line.
  const rowFor = (page: string, name: string) => page.match(new RegExp(`>${name}<[\\s\\S]*?</li>`))![0].replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

  it("shows a working key with where it was last used and its end date, a turned-off key with where it was found, and an ended one", async () => {
    const owner = Object.assign(new Browser(), { cf: MANCHESTER as unknown as IncomingRequestCfProperties });
    await join(owner, null);
    const id = await idOf("Night_Owl");
    const nowMs = Date.now();
    const working = (await createApiKey(env.DB, id, "Claude Desktop", { accessLevel: "full", gameSlugs: null, endsAfterDays: 30 })).key;
    const leaked = (await createApiKey(env.DB, id, "space-game CI")).key;
    const ended = (await createApiKey(env.DB, id, "Old laptop")).key;
    await env.DB.batch([
      env.DB.prepare("UPDATE api_keys SET last_used_at_ms = ?, last_used_device = 'Zaisma CLI 1.4', last_used_network_name = 'Vodafone', last_used_city_name = 'Manchester', last_used_country_code = 'GB' WHERE id = ?").bind(nowMs - 3600_000, working.id),
      env.DB.prepare("UPDATE api_keys SET turned_off_at_ms = ?, found_in = 'github', found_at_url = 'https://github.com/sam/space-game' WHERE id = ?").bind(nowMs, leaked.id),
      env.DB.prepare("UPDATE api_keys SET ends_at_ms = ? WHERE id = ?").bind(nowMs - 86400_000, ended.id),
    ]);
    const page = await (await owner.go("/dashboard/settings")).text();
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const workingRow = rowFor(page, "Claude Desktop");
    expect(workingRow).toContain(`Made ${day(working.created_at_ms)} · last used ${day(nowMs - 3600_000)} with Zaisma CLI 1.4 · Vodafone, near Manchester, UK · ends ${day(working.ends_at_ms!)}`);
    const leakedRow = rowFor(page, "space-game CI");
    expect(leakedRow).toContain(`Turned off ${day(nowMs)}: found in public at github.com/sam/space-game. Make a new key and remove this one.`);
    expect(rowFor(page, "Old laptop")).toContain(`Ended ${day(nowMs - 86400_000)}. Make a new key and remove this one.`);
    // Dead keys can still be removed.
    expect(page).toContain(`/dashboard/settings/keys/${leaked.id}/remove`);
  });

  it("makes a key with an end date from the Ends choice, and refuses one that isn't a choice", async () => {
    const owner = Object.assign(new Browser(), { cf: MANCHESTER as unknown as IncomingRequestCfProperties });
    await join(owner, null);
    const id = await idOf("Night_Owl");
    const device = await addPasskey(owner);
    const endsChoices = await (await owner.go("/dashboard/settings")).text();
    expect(endsChoices).toContain('name="ends_after_days"');
    for (const choice of ["Never", "In 7 days", "In 30 days", "In 90 days", "In a year"]) expect(endsChoices).toContain(choice);
    expect(await (await makeKey(owner, device, { name: "Short", access_level: "full", game_scope: "all", ends_after_days: "8" })).text()).toContain("Choose when the key ends, or Never.");
    await makeKey(owner, device, { name: "Short", access_level: "full", game_scope: "all", ends_after_days: "7" });
    await makeKey(owner, device, { name: "Forever", access_level: "full", game_scope: "all", ends_after_days: "" });
    const rows = (await env.DB.prepare("SELECT name, ends_at_ms FROM api_keys WHERE account_id = ? ORDER BY name").bind(id).all<{ name: string; ends_at_ms: number | null }>()).results;
    expect(rows.map((row) => row.name)).toEqual(["Forever", "Short"]);
    expect(rows[0]!.ends_at_ms).toBeNull();
    expect(rows[1]!.ends_at_ms! - Date.now()).toBeGreaterThan(7 * 86400_000 - 10_000);
  });

  it("shows Zaisma turning a key off in Activity", async () => {
    const owner = Object.assign(new Browser(), { cf: MANCHESTER as unknown as IncomingRequestCfProperties });
    await join(owner, null);
    const id = await idOf("Night_Owl");
    const { token } = await createApiKey(env.DB, id, "space-game CI");
    const found = await worker.fetch(new Request(`${SITE}/api/dev/forum`, { method: "POST", headers: { authorization: `Bearer ${(await createApiKey(env.DB, id, "poster")).token}`, "content-type": "application/json" }, body: JSON.stringify({ is_public: false, kind: "bug", title: "x", text_markdown: `Key ${token}` }) }), env, createExecutionContext());
    expect(found.status).toBe(201);
    const page = await (await owner.go("/account")).text();
    expect(page).toContain("Zaisma turned off an API key found in public: space-game CI");
    expect(page).toContain("Zaisma");
  });
});

describe("security alerts on the account page and dashboard", () => {
  const MANCHESTER = { asn: 64500, asOrganization: "Vodafone", city: "Manchester", region: "England", country: "GB" };
  const LEEDS_SAME_NETWORK = { ...MANCHESTER, city: "Leeds" };
  const ELSEWHERE = { asn: 8075, asOrganization: "Microsoft Corporation", city: "Des Moines", region: "Iowa", country: "US" };
  const at = (cf: Record<string, unknown>) => Object.assign(new Browser(), { cf: cf as unknown as IncomingRequestCfProperties });
  const alertsTo = (email: string) => emails.filter((sent) => sent.to === email && !/is your Zaisma code$/.test(sent.subject));
  const statusesOf = async (accountId: string, kind: string) =>
    (await env.DB.prepare("SELECT security_alert_status FROM security_events WHERE account_id = ? AND kind = ? ORDER BY id").bind(accountId, kind).all<{ security_alert_status: string | null }>()).results.map((row) => row.security_alert_status);

  it("emails a password change to the account's email, and an email change to the old address and the new", async () => {
    const owner = at(MANCHESTER);
    await join(owner, "fox@example.com");
    const id = await idOf("Night_Owl");
    // Adding the first email is an alert too, to the address it added.
    expect(alertsTo("fox@example.com").map((sent) => sent.subject)).toEqual(["An email was added to your Zaisma account"]);
    await owner.go("/account/password", { password: "another long password" });
    const [changed] = alertsTo("fox@example.com").slice(-1);
    expect(changed).toMatchObject({ subject: "Your Zaisma password was changed" });
    expect(changed!.text).toContain("Changed your password, on your Zaisma account Night_Owl,");
    expect(changed!.text).toContain("Vodafone, near Manchester, UK");
    expect(changed!.text).toContain("zaisma.test/account?not-you#signing-in");
    expect(await statusesOf(id, "password_changed")).toEqual(["emailed"]);

    await addEmail(owner, "fox@new.example.com");
    expect(alertsTo("fox@example.com").at(-1)!.subject).toBe("Your Zaisma email was changed");
    expect(alertsTo("fox@new.example.com").at(-1)!.subject).toBe("Your Zaisma email was changed");
  });

  it("emails a new-device sign-in only from a network the account hasn't signed in from", async () => {
    const owner = at(MANCHESTER);
    await join(owner, "fox@example.com");
    const id = await idOf("Night_Owl");
    const before = alertsTo("fox@example.com").length;
    // Another device, the same network: a school's laptop cart. Logged, but no alert.
    await signIn(at(LEEDS_SAME_NETWORK), { username: "Night_Owl", password: PASSWORD });
    expect(await statusesOf(id, "signed_in_new_device")).toEqual([null]);
    expect(alertsTo("fox@example.com")).toHaveLength(before);
    await signIn(at(ELSEWHERE), { username: "Night_Owl", password: PASSWORD });
    expect(await statusesOf(id, "signed_in_new_device")).toEqual([null, "emailed"]);
    expect(alertsTo("fox@example.com").at(-1)).toMatchObject({ subject: "New sign-in to your Zaisma account" });
    expect(alertsTo("fox@example.com").at(-1)!.text).toContain("Signed in with your password on a new device");
    // Making the account is never one.
    expect(await statusesOf(id, "account_created")).toEqual([null]);
  });

  it("without an email, shows the alert and the ask on the account page and dashboard until That was me and Skip", async () => {
    const owner = at(MANCHESTER);
    await join(owner, null);
    const id = await idOf("Night_Owl");
    // Nothing to lose yet: no ask.
    expect(await (await owner.go("/account")).text()).not.toContain('id="email-ask"');
    await makeKey(owner, await addPasskey(owner));
    // The key shows once on Developer settings; the alert and the ask are on the account page and the dashboard.
    const made = await (await owner.go("/account")).text();
    expect(made).toContain('id="security-alerts"');
    expect(made).toContain("Made an API key: My laptop");
    // Just confirmed with the passkey: the email box is right there.
    expect(made).toContain("Where should we tell you if someone else uses your account?");
    expect(made).toMatch(/id="email-ask"[\s\S]*action="\/account\/email"/);
    expect(await statusesOf(id, "api_key_created")).toEqual(["unseen"]);

    const dashboard = await (await owner.go("/dashboard")).text();
    expect(dashboard).toContain('id="security-alerts"');
    expect(dashboard).toContain("Made an API key: My laptop");
    expect(dashboard).toContain('id="email-ask"');

    const seen = await owner.go("/account/security-alerts/seen", { next: "/dashboard" });
    expect(seen.headers.get("location")).toBe("/dashboard");
    expect(await statusesOf(id, "api_key_created")).toEqual(["seen"]);
    expect(await (await owner.go("/dashboard")).text()).not.toContain('id="security-alerts"');
    await owner.go("/account/email-ask/skip", { next: "/account" });
    const after = await (await owner.go("/account")).text();
    expect(after).not.toContain('id="email-ask"');
    expect(after).not.toContain('id="security-alerts"');
  });

  it("asks a player without a fresh confirmation to confirm first", async () => {
    const owner = at(MANCHESTER);
    await join(owner, null);
    const id = await idOf("Night_Owl");
    await createApiKey(env.DB, id, "CI");
    await ageProofs();
    const page = await (await owner.go("/account")).text();
    expect(page).toMatch(/id="email-ask"[\s\S]*action="\/account\/email"[^>]*data-confirm="strong"/);
  });
});

describe("download your data", () => {
  const readZip = async (res: Response) => {
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const text = (path: string) => new TextDecoder().decode(files[path]);
    return { files, text, json: (path: string) => JSON.parse(text(path)) };
  };

  it("hands over everything the account keeps as one .zip, saves as files", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, cloud_saves_enabled, created_at_ms, updated_at_ms) VALUES ('g-owl', 'owl-game', 'Owl Game', 'live', 1, ?, ?)").bind(now, now).run();
    const b = new Browser();
    await join(b);
    const id = users.get("fox@example.com")!;
    const tag = ((await (await b.go("/api/saves/owl-game")).json()) as { tag: string }).tag;
    await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ tag, base_version_number: 0, save_json: JSON.stringify({ level: "3" }) }) });
    await env.DB.prepare("INSERT INTO save_history (id, account_id, game_id, saved_at_ms, copy_reason, sha256, size_bytes) VALUES ('copy-1', ?, 'g-owl', ?, 'hourly', 'abc', 20)").bind(id, now - 3600_000).run();
    // A save and a copy stored before v1: the export reads them as v1, with the v1 text's hash and size, and leaves them as they are.
    await env.SAVES.put(unversionedSaveKey(id, "g-owl"), JSON.stringify({ level: "3" }), { customMetadata: { version_number: "1" } });
    await env.SAVES.put(saveCopyKey(id, "g-owl", "copy-1"), JSON.stringify({ level: "1" }));
    await recordPlayed(env.DB, id, "g-owl");
    await createAccount(env.DB, { id: "u-friend", username: "Kind_Badger", ageBand: "18+" });
    await createAccount(env.DB, { id: "u-blocked", username: "Loud_Crow", ageBand: "18+" });
    await env.DB.prepare("INSERT INTO friendships (account_id, friend_account_id, created_at_ms) VALUES (?, 'u-friend', ?), ('u-friend', ?, ?)").bind(id, now, id, now).run();
    await env.DB.prepare("INSERT INTO blocks (account_id, blocked_account_id, created_at_ms) VALUES (?, 'u-blocked', ?), ('u-blocked', ?, ?)").bind(id, now, id, now).run();
    await createApiKey(env.DB, id, "my laptop");

    const page = await (await b.go("/account")).text();
    expect(page).toContain('href="/account/data.zip" data-download');
    expect(configuredRateLimit(siteWranglerText, "EXPORT_LIMIT")).toEqual({ limit: 2, period: 60 });
    const exportLimit = countingRateLimiter(2);
    b.bindings = { EXPORT_LIMIT: exportLimit };
    const res = await b.go("/account/data.zip");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="zaisma-Night_Owl-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(b.jar.get("download_started") ?? b.jar.get("__Host-download_started")).toBe("1");
    const zip = await readZip(res);

    expect(Object.keys(zip.files).sort()).toEqual(
      ["README.txt", "account.json", "activity.json", "developer.json", "forum.json", "friends.json", "games-played.json", "reports.json", "saves/owl-game/save.json", `saves/owl-game/earlier/${new Date(now - 3600_000).toISOString().replace(/:/g, "-")}.json`, "signing-in.json"].sort(),
    );
    expect(zip.text("README.txt")).toContain("@Night_Owl");
    const account = zip.json("account.json");
    expect(account).toMatchObject({ email: "fox@example.com", account: { username: "Night_Owl", age_band: "18+", link_urls: [] } });
    // Every column is in it, as the API says it, except the safety records it leaves out on purpose.
    const columns = (await env.DB.prepare("SELECT name FROM pragma_table_info('accounts')").all<{ name: string }>()).results.map((column) => column.name);
    for (const column of Object.keys(ACCOUNT_COLUMNS_LEFT_OUT)) expect(columns).toContain(column);
    for (const column of columns.filter((name) => !(name in ACCOUNT_COLUMNS_LEFT_OUT))) expect(account.account, column).toHaveProperty(column.replace(/_ms$/, ""));
    for (const column of Object.keys(ACCOUNT_COLUMNS_LEFT_OUT)) expect(account.account).not.toHaveProperty(column.replace(/_ms$/, ""));

    expect(zip.json("saves/owl-game/save.json")).toMatchObject({ game_slug: "owl-game", saved_at: expect.stringMatching(/Z$/), changed_by_kind: "player", local_storage_items: { level: "3" }, indexeddb_databases: [] });
    expect(Object.entries(zip.files).find(([path]) => path.includes("/earlier/"))![1]).toBeTruthy();
    expect(JSON.parse(new TextDecoder().decode(Object.entries(zip.files).find(([path]) => path.includes("/earlier/"))![1]))).toMatchObject({ copy_reason: "hourly", local_storage_items: { level: "1" }, indexeddb_databases: [] });
    expect(await (await env.SAVES.get(saveCopyKey(id, "g-owl", "copy-1")))!.text()).toBe(JSON.stringify({ level: "1" }));
    expect(await (await env.SAVES.get(unversionedSaveKey(id, "g-owl")))!.text()).toBe(JSON.stringify({ level: "3" }));
    const v1Save = savedText({ level: "3" });
    const v1Copy = savedText({ level: "1" });
    expect(zip.json("saves/owl-game/save.json")).toMatchObject({ sha256: await sha256Hex(new TextEncoder().encode(v1Save)), size_bytes: v1Save.length });
    expect(JSON.parse(new TextDecoder().decode(Object.entries(zip.files).find(([path]) => path.includes("/earlier/"))![1]))).toMatchObject({ sha256: await sha256Hex(new TextEncoder().encode(v1Copy)), size_bytes: v1Copy.length });
    expect(zip.json("friends.json")).toMatchObject({ friends: [{ username: "Kind_Badger" }], blocks: [{ username: "Loud_Crow" }] });
    expect(zip.json("games-played.json")).toMatchObject({ continue_playing: [{ game_slug: "owl-game" }], games_ever_played: [{ game_slug: "owl-game" }] });
    expect(zip.json("developer.json").api_keys).toMatchObject([{ name: "my laptop" }]);
    // No secrets, and nothing that says who blocked the account.
    const everything = Object.values(zip.files).map((bytes) => new TextDecoder().decode(bytes)).join("\n");
    expect(everything).not.toMatch(/secret_hash|signing_secret|client_secret/);
    expect(everything).not.toContain("u-blocked");

    // The download is in the Activity list, and an alert by email, since it takes everything.
    expect(await env.DB.prepare("SELECT kind FROM security_events WHERE account_id = ? AND kind = 'account_data_downloaded'").bind(id).first()).toBeTruthy();
    expect(emails.at(-1)).toMatchObject({ to: "fox@example.com", subject: "Your Zaisma data was downloaded" });
    expect((await readZip(await b.go("/account/data.zip"))).json("activity.json").events.map((event: { kind: string }) => event.kind)).toContain("account_data_downloaded");
    // Two a minute, shared with Export everything.
    expect((await b.go("/account/data.zip")).status).toBe(429);
    expect(exportLimit.keys).toEqual([id, id, id]);
  });

  it("needs Confirm it's you, like deleting the account", async () => {
    const b = new Browser();
    await join(b, null);
    await ageProofs();
    expect((await b.go("/account/data.zip")).headers.get("location")).toBe("/account?confirm-first#signing-in");
    const page = await (await b.go("/account")).text();
    // The link is there, and pressing it asks in the popup first.
    expect(page).toMatch(/<a[^>]*href="\/account\/data\.zip"[^>]*data-confirm="strong"/);
    expect((await new Browser().go("/account/data.zip")).headers.get("location")).toMatch(/^\/signin/);
  });

  it("lists every table that holds an account's rows, so a new one can't be missed", async () => {
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>()).results.map((table) => table.name);
    const holding: string[] = [];
    for (const table of tables) {
      const columns = (await env.DB.prepare("SELECT name FROM pragma_table_info(?)").bind(table).all<{ name: string }>()).results.map((column) => column.name);
      if (columns.some((column) => /^(account_id|player_id|owner_id)$|_account_id$/.test(column))) holding.push(table);
    }
    expect(holding.filter((table) => !(table in ACCOUNT_DATA_TABLES)), "tables to add to ACCOUNT_DATA_TABLES in apps/site/src/account-data.ts").toEqual([]);
    expect(Object.keys(ACCOUNT_DATA_TABLES).filter((table) => !holding.includes(table)), "tables that are gone or hold no account").toEqual([]);
  });
});

// --- Developer settings (apps/site/src/developer-settings.ts) ---

describe("Developer settings", () => {
  /** A signed-in developer with a passkey, a game of theirs and a full API key. */
  async function developer() {
    const b = new Browser();
    await join(b);
    const device = await addPasskey(b);
    const accountId = users.get("fox@example.com")!;
    const owner = await personOwner(env.DB, accountId);
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, owner_id, created_at_ms, updated_at_ms) VALUES ('game_dev_settings', 'dev-settings', 'Starfall', 'pending', 'private', ?, 1, 1)").bind(owner.id).run();
    const { token } = await createApiKey(env.DB, accountId, "Test key");
    const apiRequest = (path: string, init: { method?: string; body?: unknown } = {}) =>
      SELF.fetch(`${SITE}/api/dev${path}`, { method: init.method ?? (init.body ? "PATCH" : "GET"), headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
    return { b, device, accountId, owner, apiRequest };
  }
  const budgetOf = async () => (await env.DB.prepare("SELECT monthly_budget_cents FROM games WHERE id = 'game_dev_settings'").first<{ monthly_budget_cents: number | null }>())!.monthly_budget_cents;

  it("needs a sign-in, and sends a guest to it and back", async () => {
    const res = await new Browser().go("/dashboard/settings");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/signin?next=%2Fdashboard%2Fsettings");
  });

  it("shows every pane for a developer with a game and for one with none", async () => {
    const { b } = await developer();
    const page = await (await b.go("/dashboard/settings")).text();
    for (const id of ["hosting", "pro", "payments", "webhooks", "sign-in-apps", "keys"]) expect(page).toContain(`id="${id}"`);
    expect(page).toContain("Starfall");
    expect(page).toContain("Connect Stripe");
    expect(page).toContain("No webhooks yet");
    expect(page).toContain("No sign-in apps yet");
    expect(page).toContain('<meta name="checked-page" content="Developer settings">');
    expect(pageProblems(page)).toEqual([]);
    await env.DB.exec("DELETE FROM games");
    const bare = await (await b.go("/dashboard/settings")).text();
    for (const id of ["hosting", "pro", "payments", "webhooks", "sign-in-apps", "keys"]) expect(bare).toContain(`id="${id}"`);
    expect(bare).not.toContain("Your games this month");
  });

  it("keeps a raise as a request the developer approves with a tap, and applies the same change a confirmed raise makes", async () => {
    const { b, device, apiRequest } = await developer();
    const asked = await apiRequest("/games/dev-settings", { body: { monthly_budget_cents: 4000 } });
    expect(asked.status).toBe(403);
    const { error } = (await asked.json()) as { error: { code: string; confirm_url: string; spending_request_id: string } };
    expect(error.code).toBe("confirmation_needed");
    expect(error.confirm_url).toBe(`${SITE}/dashboard/settings?spending_request=${error.spending_request_id}`);
    const checked = (await (await apiRequest(`/spending-requests/${error.spending_request_id}`)).json()) as { spending_request: Record<string, unknown> };
    expect(checked.spending_request).toMatchObject({ request_kind: "game_budget", game_slug: "dev-settings", request_status: "waiting", requested_change: { monthly_budget_cents: 4000 }, current_setting: { monthly_budget_cents: null } });

    // A second ask for the same game replaces the first.
    const again = ((await (await apiRequest("/games/dev-settings", { body: { monthly_budget_cents: 5000 } })).json()) as { error: { spending_request_id: string } }).error.spending_request_id;
    expect((await apiRequest(`/spending-requests/${error.spending_request_id}`)).status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS waiting FROM spending_requests WHERE request_status = 'waiting'").first()).toEqual({ waiting: 1 });
    // Another account sees none of it.
    const stranger = new Browser();
    await join(stranger, "other@example.com", "Other_Dev");
    const strangerKey = (await createApiKey(env.DB, users.get("other@example.com")!, "Theirs")).token;
    expect((await SELF.fetch(`${SITE}/api/dev/spending-requests/${again}`, { headers: { authorization: `Bearer ${strangerKey}` } })).status).toBe(404);

    // The sheet names the exact change.
    const sheet = await (await b.go(`/dashboard/settings?spending_request=${again}`)).text();
    expect(sheet).toContain("Your AI asks");
    expect(sheet).toContain("Starfall");
    expect(sheet).toContain("none → $50");
    expect(pageProblems(sheet)).toEqual([]);

    // Approving without a fresh passkey tap is refused and changes nothing; declining changes nothing either.
    const refused = await (await b.go(`/dashboard/settings/spending/${again}`, { answer: "approved" })).text();
    expect(refused).toContain("passkey");
    expect(await budgetOf()).toBeNull();
    // With the tap, the change is made and the AI can see it.
    expect((await confirmWith(b, device)).status).toBe(200);
    expect((await b.go(`/dashboard/settings/spending/${again}`, { answer: "approved" })).status).toBe(303);
    expect(await budgetOf()).toBe(5000);
    expect(((await (await apiRequest(`/spending-requests/${again}`)).json()) as { spending_request: { request_status: string } }).spending_request.request_status).toBe("approved");
    // An answered request can't be answered again.
    expect(((await b.go(`/dashboard/settings/spending/${again}`, { answer: "declined" })).headers.get("location"))).toContain("spending_request=");
  });

  it("declines and expires without changing anything, and re-checks what an approval would make", async () => {
    const { b, device, accountId, apiRequest } = await developer();
    const idOf = async (cents: number) => ((await (await apiRequest("/games/dev-settings", { body: { monthly_budget_cents: cents } })).json()) as { error: { spending_request_id: string } }).error.spending_request_id;
    await confirmWith(b, device);
    const declined = await idOf(4000);
    expect((await b.go(`/dashboard/settings/spending/${declined}`, { answer: "declined" })).headers.get("location")).toBe("/dashboard/settings?done=declined#hosting");
    expect(await budgetOf()).toBeNull();
    const expired = await idOf(6000);
    await env.DB.prepare("UPDATE spending_requests SET expires_at_ms = ? WHERE id = ?").bind(Date.now() - 1, expired).run();
    expect(((await (await apiRequest(`/spending-requests/${expired}`)).json()) as { spending_request: { request_status: string } }).spending_request.request_status).toBe("expired");
    expect(await (await b.go(`/dashboard/settings?spending_request=${expired}`)).text()).toContain("isn&#39;t waiting any more");
    expect((await b.go(`/dashboard/settings/spending/${expired}`, { answer: "approved" })).headers.get("location")).toContain("spending_request=");
    expect(await budgetOf()).toBeNull();
    // A budget below $1 is refused at approval, as a direct confirmed call would refuse it.
    const small = await idOf(4000);
    await env.DB.prepare("UPDATE spending_requests SET monthly_budget_cents = 50 WHERE id = ?").bind(small).run();
    expect(await (await b.go(`/dashboard/settings/spending/${small}`, { answer: "approved" })).text()).toContain("A budget is at least $1 a month");
    expect(await budgetOf()).toBeNull();
    expect(accountId).toBeTruthy();
  });

  it("asks for the tap to raise a budget on the page, and not to lower one", async () => {
    const { b, device } = await developer();
    await env.DB.prepare("UPDATE games SET monthly_budget_cents = 5000 WHERE id = 'game_dev_settings'").run();
    // Lowering needs no tap.
    expect((await b.go("/dashboard/settings/games/dev-settings/budget", { monthly_budget_dollars: "20" })).status).toBe(303);
    expect(await budgetOf()).toBe(2000);
    // Raising without one is refused; with a fresh tap it is made.
    expect(await (await b.go("/dashboard/settings/games/dev-settings/budget", { monthly_budget_dollars: "80" })).text()).toContain("passkey");
    expect(await budgetOf()).toBe(2000);
    await confirmWith(b, device);
    expect((await b.go("/dashboard/settings/games/dev-settings/budget", { monthly_budget_dollars: "80" })).status).toBe(303);
    expect(await budgetOf()).toBe(8000);
    // Turning paid hosting off needs none.
    expect((await b.go("/dashboard/settings/games/dev-settings/budget-off", {})).status).toBe(303);
    expect(await budgetOf()).toBeNull();
  });

  it("shows the money defaults: no top-up amount picked, and no automatic top-up", async () => {
    const { b } = await developer();
    await env.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents) VALUES ('game_dev_settings', ?, 1440)").bind(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 10)).run();
    const page = await (await b.go("/dashboard/settings")).text();
    expect(page).not.toMatch(/name="amount_cents"[^>]*checked/);
    for (const cents of ["1000", "2500", "5000", "10000", "other"]) expect(page).toContain(`value="${cents}"`);
    expect(page).not.toContain("below_dollars");
    expect(page).not.toContain("Automatic top-up");
    expect(page).toContain("Last month&#39;s use past the free allowance would have cost $4.40");
  });

  it("puts a top-up's Refund in its row of the last 90 days while it refunds, and nowhere else", async () => {
    const { b, owner } = await developer();
    const DAY_MS = 86_400_000;
    const fresh = (await addCreditEntry(env.DB, { ownerId: owner.id, entryKind: "top_up", amountCents: 2500, stripeObjectId: "pi_settings_fresh", refundableUntilMs: Date.now() + 27 * DAY_MS, createdAtMs: Date.now() - 3 * DAY_MS }))!;
    const old = (await addCreditEntry(env.DB, { ownerId: owner.id, entryKind: "top_up", amountCents: 2500, stripeObjectId: "pi_settings_old", refundableUntilMs: Date.now() - 10 * DAY_MS, createdAtMs: Date.now() - 40 * DAY_MS }))!;
    const page = await (await b.go("/dashboard/settings")).text();
    expect(page).not.toContain("Top-ups you can still refund");
    expect(page).toContain("refundable until");
    expect(page).toContain(`aria-controls="refund-${fresh}"`);
    expect(page).not.toContain(`refund-${old}`);
  });

  it("connects Stripe only with a fresh tap, and turns Stripe Tax and disconnecting without one", async () => {
    const { b, device, owner } = await developer();
    const notConnected = await (await b.go("/dashboard/settings")).text();
    expect(notConnected).toContain("Connect Stripe");
    expect(notConnected).toContain('data-tap="confirm"');
    // Without a tap Zaisma refuses, in words.
    expect(await (await b.go("/dashboard/settings/payments/connect", {})).text()).toContain("passkey");
    await env.DB.prepare("UPDATE owners SET stripe_account_id = 'acct_test_settings', can_take_stripe_payments = 0, stripe_country_code = 'DE', stripe_default_currency_code = 'eur', stripe_business_name = 'Pixel Smith', stripe_support_email = 'help@pixel.example' WHERE id = ?").bind(owner.id).run();
    const connected = await (await b.go("/dashboard/settings")).text();
    expect(connected).toContain("Pixel Smith");
    expect(connected).toContain("Finish on Stripe");
    expect(connected).toContain("Change on Stripe");
    expect(connected).toContain("Open Stripe");
    expect(pageProblems(connected)).toEqual([]);
    // The tap is in the Finish on Stripe form too, since it asks for a fresh connect_url: its sheet posts to connect, tapping the passkey first.
    expect(connected).toMatch(/action="\/dashboard\/settings\/payments\/connect"[\s\S]*?data-tap="confirm"/);
    // Stripe Tax needs no tap.
    expect((await b.go("/dashboard/settings/payments/tax", { is_stripe_tax_used: "on" })).status).toBe(303);
    expect(await env.DB.prepare("SELECT is_stripe_tax_used FROM owners WHERE id = ?").bind(owner.id).first()).toEqual({ is_stripe_tax_used: 1 });
    expect(device).toBeTruthy();
  });

  it("makes keys only at its own route, and the account page links here", async () => {
    const { b, device } = await developer();
    const account = await (await b.go("/account")).text();
    expect(account).toContain('href="/dashboard/settings"');
    expect(account).not.toContain('id="key-new"');
    expect(await (await makeKey(b, device)).text()).toContain("Your new key");
    // Confirmed with the passkey just now, the account page shows Delete account's words.
    expect(await (await b.go("/account")).text()).toContain("Unused hosting credit from the last 30 days goes back to the card");
    expect((await b.go("/account/keys", { name: "Old route", access_level: "full", game_scope: "all" })).status).not.toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS key_count FROM api_keys WHERE name = 'Old route'").first()).toEqual({ key_count: 0 });
  });

  it("makes, changes and deletes a webhook and a sign-in app through the same API", async () => {
    const { b } = await developer();
    const made = await (await b.go("/dashboard/settings/webhooks", new URLSearchParams([["endpoint_url", "https://example.com/hook"], ["event_kinds", "bug_reported"]]))).text();
    expect(made).toContain("signing secret");
    expect(made).toMatch(/whsec_|code-text/);
    const webhookId = (await env.DB.prepare("SELECT id FROM webhooks").first<{ id: string }>())!.id;
    expect((await b.go(`/dashboard/settings/webhooks/${webhookId}`, new URLSearchParams([["endpoint_url", "https://example.com/other"], ["event_kinds", "player_reported"]]))).status).toBe(303);
    expect(await env.DB.prepare("SELECT endpoint_url FROM webhooks").first()).toEqual({ endpoint_url: "https://example.com/other" });
    expect((await b.go(`/dashboard/settings/webhooks/${webhookId}/delete`, {})).status).toBe(303);
    expect(await env.DB.prepare("SELECT COUNT(*) AS webhook_count FROM webhooks").first()).toEqual({ webhook_count: 0 });
    const app = await (await b.go("/dashboard/settings/sign-in-apps", new URLSearchParams([["name", "My site"], ["kind", "confidential"], ["redirect_urls", "https://example.com/callback"]]))).text();
    expect(app).toContain("client secret");
    const appId = (await env.DB.prepare("SELECT id FROM sign_in_apps").first<{ id: string }>())!.id;
    expect((await b.go(`/dashboard/settings/sign-in-apps/${appId}/delete`, {})).status).toBe(303);
    expect(await env.DB.prepare("SELECT COUNT(*) AS app_count FROM sign_in_apps").first()).toEqual({ app_count: 0 });
  });
});

// Sign-in's promises, from the Oct 23 hunt (docs/findings/beta-hardening.md): the clock is set so no test hangs on today's date.
describe("sign-in keeps its promises", () => {
  const setNow = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => vi.useRealTimers());

  const TOO_YOUNG = "You can't make an account";
  const hasJoinCookie = (b: Browser) => b.jar.has("__Host-zaisma_join");

  describe("the 13th birthday counts from midnight where the player is", () => {
    it("lets in the morning of the birthday in Tokyo, which is still the evening before in UTC, and keeps the birth date", async () => {
      setNow("2027-03-08T16:00:00Z");
      const tokyo = new Browser();
      await tokyo.go("/join/age", { birthday: "2014-03-09", today: "2027-03-09" });
      expect(hasJoinCookie(tokyo)).toBe(true);
      await tokyo.go("/join/account", { turnstile_token: "test-token", username: "Tokyo_Teen", password: PASSWORD });
      // The band-move clock (UTC-12) still reads 12: the date stays, and the account moves up on its 16th birthday.
      expect(await env.DB.prepare("SELECT age_band, birth_date FROM accounts WHERE id = ?").bind(await idOf("Tokyo_Teen")).first()).toEqual({ age_band: "13-15", birth_date: "2014-03-09" });
      expect(await accountById(env.DB, await idOf("Tokyo_Teen"), Date.UTC(2030, 2, 9, 13))).toMatchObject({ age_band: "16-17", birth_date: "2014-03-09" });
    });

    it("turns away the evening before the birthday in Los Angeles, which is already the birthday in UTC", async () => {
      setNow("2027-03-09T03:00:00Z");
      const losAngeles = new Browser();
      expect(await (await losAngeles.go("/join/age", { birthday: "2014-03-09", today: "2027-03-08" })).text()).toContain(TOO_YOUNG);
      expect(hasJoinCookie(losAngeles)).toBe(false);
      // A form with no date (no script) counts the UTC date.
      expect(hasJoinCookie(await (async () => { const b = new Browser(); await b.go("/join/age", { birthday: "2014-03-09" }); return b; })())).toBe(true);
    });

    it("counts the UTC date for a date no time zone has right now", async () => {
      setNow("2027-03-09T12:00:00Z");
      const ahead = new Browser();
      expect(await (await ahead.go("/join/age", { birthday: "2014-03-10", today: "2027-03-20" })).text()).toContain(TOO_YOUNG);
      const behind = new Browser();
      await behind.go("/join/age", { birthday: "2014-03-09", today: "2027-03-01" });
      expect(hasJoinCookie(behind)).toBe(true);
      expect(await (await new Browser().go("/join/age", { birthday: "2014-03-09", today: "not a date" })).text()).not.toContain(TOO_YOUNG);
    });

    it("keeps the birth date of an account made on its 13th birthday, and still deletes it at 18", async () => {
      await createAccount(env.DB, { id: "teen-1", username: "Tokyo_Teen", ageBand: "13-15", birthDate: "2014-03-09" });
      const born = async (nowMs: number) => (await accountById(env.DB, "teen-1", nowMs))!;
      expect(await born(Date.UTC(2027, 2, 9, 0, 30))).toMatchObject({ age_band: "13-15", birth_date: "2014-03-09" });
      expect(await born(Date.UTC(2027, 2, 9, 13))).toMatchObject({ age_band: "13-15", birth_date: "2014-03-09" });
      expect(await born(Date.UTC(2032, 2, 9, 13))).toMatchObject({ age_band: "18+", birth_date: null });
    });
  });

  describe("join steps that cross midnight keep the birth date", () => {
    it.each([
      { name: "a 16th birthday", birthday: "2011-03-09", band: "13-15", later: Date.UTC(2027, 2, 9, 13), laterBand: "16-17" },
      { name: "an 18th birthday", birthday: "2009-03-09", band: "16-17", later: Date.UTC(2027, 2, 9, 13), laterBand: "18+" },
    ])("on $name", async ({ birthday, band, later, laterBand }) => {
      setNow("2027-03-08T23:50:00Z");
      const b = new Browser();
      await b.go("/join/age", { birthday });
      setNow("2027-03-09T00:10:00Z");
      await b.go("/join/account", { turnstile_token: "test-token", username: "Midnight_Kid", password: PASSWORD });
      const id = await idOf("Midnight_Kid");
      expect(await env.DB.prepare("SELECT age_band, birth_date FROM accounts WHERE id = ?").bind(id).first()).toEqual({ age_band: band, birth_date: birthday });
      expect(await accountById(env.DB, id, later)).toMatchObject({ age_band: laterBand, birth_date: laterBand === "18+" ? null : birthday });
    });

    it("but drops a birth date a cookie's band can't have come from", async () => {
      setNow("2027-03-09T12:00:00Z");
      const forged = new Browser();
      forged.jar.set("__Host-zaisma_join", encodeURIComponent(JSON.stringify({ band: "16-17", birth_date: "2014-03-09" })));
      await forged.go("/join/account", { turnstile_token: "test-token", username: "Forged_Kid", password: PASSWORD });
      expect(await accountById(env.DB, await idOf("Forged_Kid"))).toMatchObject({ age_band: "16-17", birth_date: null });
    });
  });

  it("signs in with the username as it's shown everywhere, @name", async () => {
    await join(new Browser(), null, "Night_Owl");
    const b = new Browser();
    const res = await signIn(b, { username: "@night_owl", password: PASSWORD });
    expect([res.status, res.headers.get("location")]).toEqual([303, "/"]);
    expect(b.jar.has("__Host-zaisma")).toBe(true);
    expect((await signIn(new Browser(), { username: "@night_owl", password: "wrong password here" })).status).toBe(400);
  });

  describe("someone new back from Google or Discord who is deleted keeps nothing", () => {
    const proofCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS proof_count FROM session_proofs").first<{ proof_count: number }>())!.proof_count;

    it("without having answered the age question", async () => {
      const b = new Browser();
      await viaProvider(b, "/signin/with/discord", "new@example.com");
      expect(deleted).toHaveLength(1);
      expect(await proofCount()).toBe(0);
    });

    it("when the age question then says under 13", async () => {
      const b = new Browser();
      await b.go("/join/age", { ...BIRTH_ADULT, with: "discord" });
      await viaProvider(b, "/signin/with/discord", "half@example.com");
      await b.go("/join/age", { year: String(thisYear - 9), month: "3", day: "3" });
      expect(deleted).toHaveLength(1);
      expect(await proofCount()).toBe(0);
    });

    it("and the proof is kept once the account is made", async () => {
      const b = new Browser();
      await b.go("/join/age", { ...BIRTH_ADULT, with: "discord" });
      await viaProvider(b, "/signin/with/discord", "half@example.com");
      expect(await proofCount()).toBe(0);
      await b.go("/join/username", { turnstile_token: "test-token", username: "Lucky_Star" });
      expect(await env.DB.prepare("SELECT account_id, proof_kind FROM session_proofs").all()).toMatchObject({ results: [{ account_id: users.get("half@example.com"), proof_kind: "discord" }] });
    });
  });

  it("a deleted account's other device can't make a new account on the deleted sign-in", async () => {
    const a = new Browser();
    await join(a, null);
    const [phone, tablet] = [new Browser(), new Browser()];
    for (const device of [phone, tablet]) await signIn(device, { username: "Night_Owl", password: PASSWORD });
    expect((await phone.go("/account")).status).toBe(200);
    expect((await a.go("/account/delete", { confirm: "delete" })).status).toBe(200);

    const askedAge = await phone.go("/join/age", BIRTH_ADULT);
    expect(askedAge.headers.get("location")).toBe("/join");
    expect(phone.jar.has("__Host-zaisma")).toBe(false);
    // The same from the username step, with the join steps' cookie in hand.
    tablet.jar.set("__Host-zaisma_join", encodeURIComponent(JSON.stringify({ band: "18+" })));
    const madeAgain = await tablet.go("/join/username", { turnstile_token: "test-token", username: "Lucky_Star" });
    expect(madeAgain.headers.get("location")).toBe("/join");
    expect(tablet.jar.has("__Host-zaisma")).toBe(false);
    expect(await env.DB.prepare("SELECT COUNT(*) AS account_count FROM accounts").first()).toEqual({ account_count: 0 });
  });

  it("a device signed in earlier in the same second as Sign out on every device is signed out too", async () => {
    setNow("2027-01-05T10:00:00.400Z");
    const a = new Browser();
    await join(a, null);
    const other = new Browser();
    await signIn(other, { username: "Night_Owl", password: PASSWORD });
    expect((await other.go("/account")).status).toBe(200);
    setNow("2027-01-05T10:00:00.900Z");
    await a.go("/signout", {});
    expect((await other.go("/account")).headers.get("location")).toBe("/signin");
  });

  it("at most 3 email codes an hour reach one address, even when the asks come at the same moment", async () => {
    const nowMs = Date.UTC(2027, 0, 5, 10);
    const asks = await Promise.all(Array.from({ length: 6 }, () => sendEmailCode(env, { email: "fox@example.com", accountId: null, kind: "sign_in", reason: "sign_in" }, nowMs)));
    expect(asks.filter((ask) => ask === "sent")).toHaveLength(3);
    expect(asks.filter((ask) => ask === "too-many")).toHaveLength(3);
    expect(await env.DB.prepare("SELECT COUNT(*) AS request_count FROM email_code_requests").first()).toEqual({ request_count: 3 });
  });
});

// --- Bans (apps/site/src/bans.ts) ---

describe("bans at sign-in", () => {
  const ban = async (username: string, banScope: "developer" | "whole_account") => {
    const account = (await accountById(env.DB, await idOf(username)))!;
    await banAccount(env, { account, banScope, why: "Illegal content.", contentRule: "child_safety", actor: "julius@zaisma.test" });
  };

  it("closes a whole-account ban's sessions, and its right password makes none", async () => {
    const b = new Browser();
    await join(b);
    expect((await b.go("/account")).status).toBe(200);
    await ban("Night_Owl", "whole_account");
    expect((await b.go("/account")).headers.get("location")).toMatch(/^\/signin/);

    const fresh = new Browser();
    const page = await signIn(fresh, { username: "Night_Owl", password: PASSWORD });
    expect(page.status).toBe(403);
    const closed = await page.text();
    // Child safety: no rule and no why, and the way to appeal.
    expect(closed).toContain("Zaisma closed Night_Owl for breaking Zaisma's rules.");
    expect(closed).not.toContain("Illegal content");
    expect(closed).toContain('href="mailto:safety@zaisma.com?subject=Appeal%3A%20Night_Owl"');
    expect(fresh.jar.has("__Host-zaisma")).toBe(false);
    // A wrong password says only that, so the page doesn't tell who's banned.
    expect(await (await signIn(new Browser(), { username: "Night_Owl", password: "not the password" })).text()).not.toContain("closed");
    // An email code and Google don't open it either.
    expect((await signInByEmail(new Browser(), "fox@example.com")).status).toBe(403);
    const viaGoogle = new Browser();
    expect((await viaProvider(viaGoogle, "/signin/with/google", "fox@example.com")).status).toBe(403);
    expect(viaGoogle.jar.has("__Host-zaisma")).toBe(false);
  });

  it("says which rule a closed account broke, and why", async () => {
    await join(new Browser());
    const account = (await accountById(env.DB, await idOf("Night_Owl")))!;
    await banAccount(env, { account, banScope: "whole_account", why: "It sold stolen accounts to players.", contentRule: "illegal", actor: "julius@zaisma.test" });
    const closed = await (await signIn(new Browser(), { username: "Night_Owl", password: PASSWORD })).text();
    expect(closed).toContain('the content rules on <a');
    expect(closed).toContain('href="/legal/content-rules#illegal"');
    expect(closed).toContain("illegal content</a>: It sold stolen accounts to players.");
  });

  it("keeps a developer ban signed in", async () => {
    const b = new Browser();
    await join(b);
    await ban("Night_Owl", "developer");
    const accountPage = await b.go("/account");
    expect(accountPage.status).toBe(200);
    const accountText = await accountPage.text();
    expect(accountText).toContain("Zaisma banned this account&#39;s developer side for breaking Zaisma&#39;s rules.");
    expect(accountText).toContain('href="mailto:safety@zaisma.com?subject=Appeal%3A%20Night_Owl"');
    const games = await b.go("/dashboard");
    const gamesText = await games.text();
    expect(gamesText).toContain("Zaisma banned this account&#39;s developer side for breaking Zaisma&#39;s rules.");
    expect(gamesText).toContain("mailto:safety@zaisma.com");
    expect((await b.go("/dashboard/settings")).headers.get("location")).toBe("/dashboard");
  });

  it("refuses a banned email on another account, and on a new one from Google", async () => {
    await join(new Browser());
    await ban("Night_Owl", "developer");

    const other = new Browser();
    await join(other, null, "Kind_Badger");
    const added = await other.go("/account/email", { email: "Fox@Example.com", turnstile_token: "email_code" });
    expect(await added.text()).toContain("This email can&#39;t be used on Zaisma.");
    expect(emails.filter((sent) => JSON.stringify(sent).includes("Fox@Example.com"))).toEqual([]);

    const fromGoogle = new Browser();
    await fromGoogle.go("/join/age", BIRTH_ADULT);
    users.delete("fox@example.com");
    const refused = await viaProvider(fromGoogle, "/signin/with/google", "fox@example.com");
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("This email can&#39;t be used on Zaisma.");
    expect(fromGoogle.jar.has("__Host-zaisma")).toBe(false);
  });

  it("refuses connecting a banned Stripe account, and disconnects nothing", async () => {
    const first = new Browser();
    await join(first);
    const firstOwner = await personOwnerOf(env.DB, await idOf("Night_Owl"));
    await env.DB.prepare("UPDATE owners SET stripe_account_id = 'acct_banned_1' WHERE id = ?").bind(firstOwner.id).run();
    await ban("Night_Owl", "developer");

    const b = new Browser();
    await join(b, null, "Kind_Badger");
    const owner = await personOwnerOf(env.DB, await idOf("Kind_Badger"));
    await env.DB.prepare("INSERT INTO stripe_connect_states (state, owner_id, expires_at_ms) VALUES ('state-1', ?, ?)").bind(owner.id, Date.now() + 60_000).run();
    const before = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(input instanceof Request ? input.url : String(input)).pathname === "/oauth/token" ? Promise.resolve(Response.json({ stripe_user_id: "acct_banned_1" })) : before(input, init),
    );
    const back = await b.go("/stripe/connect-return?state=state-1&code=ac_1");
    expect(back.headers.get("location")).toBe(`${SITE}/dashboard/settings?stripe=stripe_account_banned#payments`);
    expect(await env.DB.prepare("SELECT stripe_account_id FROM owners WHERE id = ?").bind(owner.id).first()).toEqual({ stripe_account_id: null });
    expect(await env.DB.prepare("SELECT stripe_account_id FROM owners WHERE id = ?").bind(firstOwner.id).first()).toEqual({ stripe_account_id: "acct_banned_1" });
    expect(await (await b.go("/dashboard/settings?stripe=stripe_account_banned")).text()).toContain("This Stripe account can&#39;t be connected to Zaisma.");
  });
});
