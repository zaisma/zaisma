import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAXIMUM_OPEN_FRIEND_INVITE_COUNT, accountById, ageBand, ageOn, canonicalSave, checkName, createApiKey, deleteExpiredFriendInvites, friendInviteByCode, friendInvitesOf, friendsOf, gameById, gameBySlug, gameOwner, saveKey, sha256Hex } from "@zaisma/core";
import { decideTopic } from "../../apps/site/src/forum-posts.ts";
import { checkForumPosts, type CheckDeps } from "../../apps/site/src/forum-check.ts";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { changeSaveAsDeveloper } from "../../apps/site/src/saves.ts";
import { SIGN_IN_APP } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";

const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";

// The presets' settings (docs/DECISIONS.md, "Social settings, with the social modes as presets").
const SOLO_FOCUSED = { who_can_chat: "nobody", who_can_join: "friends", who_sees_playing_now: "friends", who_sees_played_games: "friends", who_sees_online: "friends", who_can_send_friend_requests: "nobody" };
const FRIENDS_FOCUSED = { ...SOLO_FOCUSED, who_can_chat: "friends" };
const OPEN_AND_SOCIAL_ADULT = { who_can_chat: "anyone", who_can_join: "anyone", who_sees_playing_now: "anyone", who_sees_played_games: "anyone", who_sees_online: "friends", who_can_send_friend_requests: "anyone" };

// --- A small stand-in for Supabase Auth: email codes, ES256 access tokens, refresh, admin delete. ---

let keys: CryptoKeyPair;
let jwk: JsonWebKey;
const users = new Map<string, string>(); // email -> user id
const sent: { email: string; create: boolean }[] = [];
const deleted: string[] = [];
const links = new Map<string, string>(); // one-time sign-in link hash -> email
let tokenSeconds = 3600;
let signinAge = 0; // seconds since the last sign-in, as Supabase's amr claim says
const signedInAt = new Map<string, number>(); // user id -> seconds
const codes = new Map<string, { email: string; challenge: string }>(); // Google/Discord one-time code -> who
let realFetch: typeof fetch;

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function accessToken(id: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "ES256", kid: "test-key", typ: "JWT" }));
  const amr = [{ method: "otp", timestamp: signedInAt.get(id) ?? now }];
  const p = b64url(JSON.stringify({ sub: id, email, aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: now + tokenSeconds, iat: now, amr }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

async function tokens(id: string, email: string) {
  return Response.json({ access_token: await accessToken(id, email), refresh_token: `r-${id}`, user: { id, email } });
}

async function fakeSupabase(url: URL, init: RequestInit = {}): Promise<Response> {
  const body = init.body ? JSON.parse(String(init.body)) : {};
  const headers = new Headers(init.headers);
  const path = url.pathname.replace("/auth/v1", "");
  if (path === "/.well-known/jwks.json") return Response.json({ keys: [{ ...jwk, kid: "test-key", alg: "ES256" }] });
  if (headers.get("apikey") !== "sb_publishable_test" && !path.startsWith("/admin/")) return new Response("bad key", { status: 401 });
  if (path === "/otp") {
    sent.push({ email: body.email, create: body.create_user });
    if (!users.has(body.email) && !body.create_user) return Response.json({ code: "otp_disabled" }, { status: 422 });
    return Response.json({});
  }
  if (path === "/verify" && body.token_hash) {
    const email = links.get(body.token_hash);
    links.delete(body.token_hash);
    if (!email || body.type !== "magiclink") return Response.json({ code: "otp_expired" }, { status: 403 });
    signedInAt.set(users.get(email)!, Math.floor(Date.now() / 1000));
    return tokens(users.get(email)!, email);
  }
  if (path === "/verify") {
    if (body.token !== "123456" || !sent.some((s) => s.email === body.email)) return Response.json({ code: "otp_expired" }, { status: 403 });
    if (!users.has(body.email)) users.set(body.email, crypto.randomUUID());
    signedInAt.set(users.get(body.email)!, Math.floor(Date.now() / 1000) - signinAge);
    return tokens(users.get(body.email)!, body.email);
  }
  if (path === "/settings") return Response.json({ external: { email: true, google: true, discord: true, github: false } });
  if (path === "/token" && url.searchParams.get("grant_type") === "pkce") {
    const c = codes.get(body.auth_code);
    codes.delete(body.auth_code);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(body.code_verifier))));
    if (!c || c.challenge !== challenge) return Response.json({ code: "flow_state_not_found" }, { status: 404 });
    if (!users.has(c.email)) users.set(c.email, crypto.randomUUID());
    signedInAt.set(users.get(c.email)!, Math.floor(Date.now() / 1000));
    return tokens(users.get(c.email)!, c.email);
  }
  if (path === "/token") {
    const id = String(body.refresh_token).replace(/^r-/, "");
    const email = [...users].find(([, v]) => v === id)?.[0];
    return email ? tokens(id, email) : Response.json({ code: "refresh_token_not_found" }, { status: 400 });
  }
  if (path === "/logout") return new Response(null, { status: 204 });
  if (path.startsWith("/admin/") && headers.get("apikey") !== "sb_secret_test") return new Response("forbidden", { status: 403 });
  if (path === "/admin/generate_link") {
    const hash = `hash-${crypto.randomUUID()}`;
    links.set(hash, body.email);
    return Response.json({ id: users.get(body.email), email: body.email, hashed_token: hash, verification_type: "magiclink" });
  }
  const del = path.match(/^\/admin\/users\/(.+)$/);
  if (del && (init.method ?? "GET") === "GET") {
    const email = [...users].find(([, v]) => v === del[1])?.[0];
    return email ? Response.json({ id: del[1], email }) : Response.json({}, { status: 404 });
  }
  if (del && init.method === "DELETE") {
    if (headers.get("apikey") !== "sb_secret_test") return new Response("forbidden", { status: 403 });
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
  signedInAt.clear();
  links.clear();
  codes.clear();
  signinAge = 0;
  sent.length = 0;
  deleted.length = 0;
  tokenSeconds = 3600;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.origin === SUPABASE ? fakeSupabase(url, init) : realFetch(input, init);
  });
  await env.DB.exec("DELETE FROM forum_posts; DELETE FROM forum_topic_tags; DELETE FROM forum_votes; DELETE FROM forum_follows; DELETE FROM forum_media; DELETE FROM forum_mentions; DELETE FROM forum_topics; DELETE FROM played; DELETE FROM friendships; DELETE FROM friend_invites; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM passkeys; DELETE FROM save_history; DELETE FROM saves; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
});

afterEach(() => vi.unstubAllGlobals());

// --- A browser with a cookie jar ---

class Browser {
  jar = new Map<string, string>();
  // Each browser gets its own address, so the sign-in rate limit doesn't spill between tests.
  ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  async go(path: string, form?: Record<string, string> | URLSearchParams, init: { method?: string; body?: string; origin?: string } = {}): Promise<Response> {
    const res = await SELF.fetch(`${SITE}${path}`, {
      method: init.method ?? (form ? "POST" : "GET"),
      body: init.body ?? (form ? new URLSearchParams(form) : undefined),
      headers: {
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        "cf-connecting-ip": this.ip,
        ...(form || init.body ? { origin: init.origin ?? SITE } : {}),
      },
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split("; ");
      const [k, v] = [pair!.slice(0, pair!.indexOf("=")), pair!.slice(pair!.indexOf("=") + 1)];
      if (attrs.includes("Max-Age=0")) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
}

const BIRTH_ADULT = { year: "1990", month: "5", day: "20" };
const thisYear = new Date().getUTCFullYear();

async function join(b: Browser, email = "fox@example.com", name = "Night Owl", birth = BIRTH_ADULT): Promise<Response> {
  await b.go("/join/age", birth);
  await b.go("/join/email", { email, name });
  return b.go("/signin/code", { email, code: "123456" });
}

describe("age and names", () => {
  it("works out whole years and the band", () => {
    const today = new Date(Date.UTC(2026, 9, 12));
    expect(ageOn({ yearNumber: 2013, monthNumber: 10, dayNumber: 12 }, today)).toBe(13);
    expect(ageOn({ yearNumber: 2013, monthNumber: 10, dayNumber: 13 }, today)).toBe(12);
    expect(ageOn({ yearNumber: 2008, monthNumber: 2, dayNumber: 30 }, today)).toBeNull();
    expect(ageOn({ yearNumber: 2030, monthNumber: 1, dayNumber: 1 }, today)).toBeNull();
    expect([ageBand(12), ageBand(13), ageBand(15), ageBand(16), ageBand(17), ageBand(18)]).toEqual([null, "13-15", "13-15", "16-17", "16-17", "18+"]);
  });

  it("tidies names and refuses rude or reserved ones", () => {
    expect(checkName("  Night   Owl ")).toEqual({ name: "Night Owl" });
    expect(checkName("ab")).toHaveProperty("error");
    expect(checkName("Zaisma_Admin")).toHaveProperty("error");
    expect(checkName("sh1thead")).toHaveProperty("error");
    expect(checkName("Grape Peacock")).toEqual({ name: "Grape Peacock" });
    expect(checkName("<script>")).toHaveProperty("error");
  });
});

describe("making an account", () => {
  it("asks the age first, then name and email, then the code", async () => {
    const b = new Browser();
    expect(await (await b.go("/join")).text()).toContain("When's your birthday?");
    const age = await b.go("/join/age", BIRTH_ADULT);
    const agePage = await age.text();
    expect(agePage).toContain("Your name");
    // 16 and over pick a preset on the way in, friends-focused unless they choose another.
    expect(agePage).toContain("Who can chat with you and see what you play?");
    const email = await b.go("/join/email", { email: "Fox@Example.com", name: "Night Owl" });
    expect(await email.text()).toContain("Check your email");
    expect(sent).toEqual([{ email: "fox@example.com", create: true }]);

    const done = await b.go("/signin/code", { email: "fox@example.com", code: "123 456" });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/account?welcome");
    expect(b.jar.get("__Host-zaisma")).toMatch(/~r-/);
    expect(b.jar.get("__Host-zaisma_in")).toBe("1");
    expect(b.jar.has("__Host-zaisma_join")).toBe(false);

    const account = await accountById(env.DB, users.get("fox@example.com")!);
    expect(account).toMatchObject({ name: "Night Owl", age_band: "18+", ...FRIENDS_FOCUSED });
    const page = await (await b.go("/account?welcome")).text();
    expect(page).toContain("Welcome to Zaisma, Night Owl");
    expect(page).toContain("fox@example.com");
    expect(page).toContain("18 or over");
  });

  it("lets 16 and over choose a social mode while joining, and starts 13 to 15 with no chat", async () => {
    const older = new Browser();
    await older.go("/join/age", { year: String(thisYear - 17), month: "1", day: "1" });
    await older.go("/join/email", { email: "open@example.com", name: "Open Kite", social_mode: "open_and_social" });
    await older.go("/signin/code", { email: "open@example.com", code: "123456" });
    // Open and social at 16–17: chat and friend requests from anyone, the rest with friends.
    expect(await accountById(env.DB, users.get("open@example.com")!)).toMatchObject({ age_band: "16-17", ...FRIENDS_FOCUSED, who_can_chat: "anyone", who_can_send_friend_requests: "anyone" });

    const younger = new Browser();
    expect(await (await younger.go("/join/age", { year: String(thisYear - 14), month: "1", day: "1" })).text()).not.toContain("Who can chat with you");
    // A hand-made form can't give 13–15 open and social.
    await younger.go("/join/email", { email: "young@example.com", name: "Small Kite", social_mode: "open_and_social" });
    await younger.go("/signin/code", { email: "young@example.com", code: "123456" });
    expect(await accountById(env.DB, users.get("young@example.com")!)).toMatchObject({ age_band: "13-15", ...SOLO_FOCUSED });
  });

  it("never stores the birth date", async () => {
    const b = new Browser();
    await join(b, "teen@example.com", "Quiet Comet", { year: String(thisYear - 15), month: "1", day: "1" });
    const row = await env.DB.prepare("SELECT * FROM accounts").first();
    expect(row).toMatchObject({ age_band: "13-15", ...SOLO_FOCUSED });
    // Everything but the id and timestamps, which can contain any four digits.
    const { id: _id, created_at_ms: _c, updated_at_ms: _u, ...stored } = row!;
    expect(JSON.stringify(stored)).not.toContain(String(thisYear - 15));
    expect([...b.jar.values()].join()).not.toContain(String(thisYear - 15));
  });

  it("stops under-13s before they type an email, and for a day after", async () => {
    const b = new Browser();
    const res = await b.go("/join/age", { year: String(thisYear - 10), month: "1", day: "1" });
    expect(await res.text()).toContain("Accounts are for 13 and up");
    expect(b.jar.get("__Host-zaisma_age")).toBe("no");
    expect(await (await b.go("/join/age", BIRTH_ADULT)).text()).toContain("Accounts are for 13 and up");
    expect(await (await b.go("/join/email", { email: "kid@example.com", name: "Little Fox" })).text()).toContain("Accounts are for 13 and up");
    expect(sent).toHaveLength(0);
  });

  it("refuses a bad name and keeps what was typed", async () => {
    const b = new Browser();
    await b.go("/join/age", BIRTH_ADULT);
    const res = await b.go("/join/email", { email: "fox@example.com", name: "x" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Names are 3 to 20");
    expect(sent).toHaveLength(0);
  });

  it("can't skip the age question by going straight to the email step", async () => {
    const b = new Browser();
    const res = await b.go("/join/email", { email: "fox@example.com", name: "Night Owl" });
    expect(res.headers.get("location")).toBe("/join");
    expect(sent).toHaveLength(0);
  });

  it("finishes a half-made account after sign-in, and deletes it if they're under 13", async () => {
    users.set("half@example.com", "u-half");
    const b = new Browser();
    await b.go("/signin", { email: "half@example.com" });
    const res = await b.go("/signin/code", { email: "half@example.com", code: "123456" });
    expect(res.headers.get("location")).toBe("/join");
    await b.go("/join/age", { year: String(thisYear - 9), month: "3", day: "3" });
    expect(deleted).toEqual(["u-half"]);
    expect(b.jar.has("__Host-zaisma")).toBe(false);
    expect(await accountById(env.DB, "u-half")).toBeNull();
  });
});

describe("signing in", () => {
  it("never makes accounts and doesn't reveal who has one", async () => {
    const b = new Browser();
    const res = await b.go("/signin", { email: "nobody@example.com" });
    expect(await res.text()).toContain("Check your email");
    expect(sent).toEqual([{ email: "nobody@example.com", create: false }]);
    expect(users.size).toBe(0);
  });

  it("signs back in, and a wrong code is refused", async () => {
    await join(new Browser());
    const b = new Browser();
    await b.go("/signin", { email: "fox@example.com" });
    expect((await b.go("/signin/code", { email: "fox@example.com", code: "000000" })).status).toBe(400);
    const res = await b.go("/signin/code", { email: "fox@example.com", code: "123456", next: "/g/arena" });
    expect(res.headers.get("location")).toBe("/g/arena");
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
    const res = await SELF.fetch(`${SITE}/signin`, { method: "POST", body: new URLSearchParams({ email: "a@b.co" }), headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("signs out", async () => {
    const b = new Browser();
    await join(b);
    await b.go("/signout", {});
    expect(b.jar.size).toBe(0);
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

    // The age answer goes straight back to Discord, then to picking a name.
    expect((await b.go("/join/age", { ...BIRTH_ADULT, with: "discord" })).headers.get("location")).toBe("/signin/with/discord");
    expect((await viaProvider(b, "/signin/with/discord", "new@example.com")).headers.get("location")).toBe("/join/name");
    expect(await (await b.go("/join/name")).text()).toContain("Pick a name");
    expect((await b.go("/join/name", { name: "Lucky Star" })).headers.get("location")).toBe("/account?welcome");
    expect(await accountById(env.DB, users.get("new@example.com")!)).toMatchObject({ name: "Lucky Star", age_band: "18+" });
  });

  it("under-13s still get no account", async () => {
    const b = new Browser();
    await b.go("/join/age", { year: String(thisYear - 10), month: "1", day: "1" });
    const res = await viaProvider(b, "/signin/with/google", "kid@example.com");
    expect(res.headers.get("location")).toBe("/join?with=google");
    expect(deleted).toHaveLength(1);
    expect(await (await b.go("/join")).text()).toContain("Accounts are for 13 and up");
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
  it("renames, ages up, and deletes everything", async () => {
    const b = new Browser();
    await join(b, "teen@example.com", "Quiet Comet", { year: String(thisYear - 15), month: "1", day: "1" });
    const id = users.get("teen@example.com")!;

    expect((await b.go("/account/name", { name: "Loud Comet" })).status).toBe(303);
    expect((await accountById(env.DB, id))?.name).toBe("Loud Comet");

    // The page shows the presets and settings 13–15 can have, and nothing at all of the rest: no open
    // and social, no Anyone for chat or joining, no friend requests, and no hint of what opens up later.
    const accountPageText = await (await b.go("/account")).text();
    const social = accountPageText.slice(accountPageText.indexOf('<h2 id="social">'), accountPageText.indexOf('<h2 id="passkeys">'));
    expect(social).toContain('<h2 id="social">Social</h2>');
    expect(social).toMatch(/value="solo_focused" checked/);
    expect(social).toMatch(/name="who_can_chat" value="friends"/);
    expect(social).not.toContain('value="open_and_social"');
    expect(social).not.toMatch(/name="who_can_chat" value="anyone"|name="who_can_join" value="anyone"|name="who_sees_online" value="anyone"/);
    expect(social).not.toContain('name="who_can_send_friend_requests"');
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

    // Up a band at a time, keeping the preset; never down.
    expect(await (await b.go("/account/age", { year: String(thisYear - 14), month: "1", day: "1" })).text()).toContain("16 or over yet");
    await b.go("/account/age", { year: String(thisYear - 16), month: "1", day: "1" });
    expect(await accountById(env.DB, id)).toMatchObject({ age_band: "16-17", ...FRIENDS_FOCUSED });
    expect(await (await b.go("/account/age", { year: String(thisYear - 17), month: "1", day: "1" })).text()).toContain("18 or over yet");
    // Open and social at 16–17 keeps joining and what they play with friends.
    expect(await (await b.go("/account/social", { social_mode: "custom", ...FRIENDS_FOCUSED, who_sees_playing_now: "anyone" })).text()).toContain("Choose from the social settings shown");
    expect((await b.go("/account/social", { social_mode: "open_and_social", ...FRIENDS_FOCUSED })).status).toBe(303);
    expect(await accountById(env.DB, id)).toMatchObject({ ...FRIENDS_FOCUSED, who_can_chat: "anyone", who_can_send_friend_requests: "anyone" });
    const teenPageText = await (await b.go("/account")).text();
    const teenPage = teenPageText.slice(teenPageText.indexOf('<h2 id="social">'), teenPageText.indexOf('<h2 id="passkeys">'));
    expect(teenPage).toMatch(/value="open_and_social" checked/);
    expect(teenPage).toMatch(/name="who_can_send_friend_requests" value="anyone" checked/);
    expect(teenPage).not.toMatch(/name="who_can_join" value="anyone"|name="who_sees_playing_now" value="anyone"|opens up|disabled/);
    // At 18 open and social opens up the rest too.
    await b.go("/account/age", { year: String(thisYear - 19), month: "1", day: "1" });
    expect(await accountById(env.DB, id)).toMatchObject({ age_band: "18+", ...OPEN_AND_SOCIAL_ADULT });
    // Custom stays as it was when the band moves up.
    const custom = new Browser();
    await join(custom, "custom@example.com", "Odd Fern", { year: String(thisYear - 17), month: "1", day: "1" });
    const customId = users.get("custom@example.com")!;
    await custom.go("/account/social", { social_mode: "custom", ...FRIENDS_FOCUSED, who_can_chat: "anyone" });
    await custom.go("/account/age", { year: String(thisYear - 19), month: "1", day: "1" });
    expect(await accountById(env.DB, customId)).toMatchObject({ age_band: "18+", ...FRIENDS_FOCUSED, who_can_chat: "anyone" });

    expect(await (await b.go("/account/delete", { confirm: "nope" })).text()).toContain('Type "delete"');
    const gone = await b.go("/account/delete", { confirm: "delete" });
    expect(await gone.text()).toContain("Your account is deleted");
    expect(deleted).toEqual([id]);
    expect(await accountById(env.DB, id)).toBeNull();
    expect(b.jar.size).toBe(0);
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
    await join(ana, "ana@example.com", "Night Owl");
    const ben = new Browser();
    await join(ben, "ben@example.com", "Quiet Comet", { year: String(thisYear - 14), month: "1", day: "1" });
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
    expect(signedOut).toContain("Night Owl invited you to be friends");
    expect(signedOut).toContain(`/signin?next=${encodeURIComponent(`/friends/add/${inviteCode}`)}`);
    // Its maker can't use it.
    expect(await (await ana.go(`/friends/add/${inviteCode}`)).text()).toContain("This is your own invite");
    expect((await ana.go(`/friends/add/${inviteCode}`, {})).status).toBe(409);

    // Typed by hand in any case, with its dash, it goes to the invite's page, which asks first.
    const typed = await ben.go("/friends/add", { invite_code: `${inviteCode.slice(0, 4).toLowerCase()}-${inviteCode.slice(4)}` });
    expect(typed.headers.get("location")).toBe(`/friends/add/${inviteCode}`);
    expect(await (await ben.go(`/friends/add/${inviteCode}`)).text()).toContain("Add Night Owl as a friend?");
    expect(await (await ben.go("/friends/add", { invite_code: "nope" })).text()).toContain("An invite code is 8 letters and numbers");

    const accepted = await ben.go(`/friends/add/${inviteCode}`, {});
    expect(accepted.status).toBe(303);
    expect(await (await ben.go(accepted.headers.get("location")!)).text()).toContain("You and Night Owl are friends now");
    expect(await friendsOf(env.DB, anaId)).toMatchObject([{ name: "Quiet Comet" }]);
    expect(await friendsOf(env.DB, benId)).toMatchObject([{ name: "Night Owl" }]);
    // Ben's chat setting is solo-focused, and the page says what that means for friends.
    expect(await (await ben.go("/friends")).text()).toContain("you don't chat with anyone in games, friends included");

    // Used once, it's gone.
    const carol = new Browser();
    await join(carol, "carol@example.com", "Tall Pine");
    expect(await (await carol.go(`/friends/add/${inviteCode}`)).text()).toContain("This invite doesn't work");
    expect((await carol.go(`/friends/add/${inviteCode}`, {})).status).toBe(404);

    // A new invite to someone who's already a friend stays for whoever it's meant for.
    const second = await inviteFrom(ana);
    expect(await (await ben.go(`/friends/add/${second}`)).text()).toContain("already friends");
    expect((await carol.go(`/friends/add/${second}`, {})).status).toBe(303);
    expect((await friendsOf(env.DB, anaId)).map((friend) => friend.name)).toEqual(["Quiet Comet", "Tall Pine"]);

    // Removing is both sides at once.
    const benPlayerId = (await accountById(env.DB, benId))!.player_id;
    expect((await ana.go(`/friends/${benPlayerId}/remove`, {})).status).toBe(303);
    expect(await friendsOf(env.DB, benId)).toEqual([]);
    expect((await friendsOf(env.DB, anaId)).map((friend) => friend.name)).toEqual(["Tall Pine"]);

    // Deleting an account takes its friends and invites with it.
    await inviteFrom(ana);
    await ana.go("/account/delete", { confirm: "delete" });
    expect(await friendsOf(env.DB, users.get("carol@example.com")!)).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS invite_count FROM friend_invites").first("invite_count")).toBe(0);
  });

  it("takes invites back, lets them run out, and keeps a few waiting at most", async () => {
    const ana = new Browser();
    await join(ana, "ana@example.com", "Night Owl");
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
    expect(owner).toMatchObject({ name: "Night Owl", owner: { kind: "person", account_id: id } });
    expect(await (await b.go("/account")).text()).toContain("Owl Game");

    // Deleting the account leaves the game up, with no owner.
    await b.go("/account/delete", { confirm: "delete" });
    expect((await gameById(env.DB, "g1"))?.owner_id).toBeNull();
    expect((await gameById(env.DB, "g1"))?.review_status).toBe("live");
  });
});

describe("pages", () => {
  it("adds a sign-in link, a privacy page, and keeps account pages out of caches and search", async () => {
    const home = await (await SELF.fetch(`${SITE}/`)).text();
    expect(home).toContain('id="account-link"');
    expect(home).toContain('href="/legal/privacy"');
    expect(await (await SELF.fetch(`${SITE}/legal/privacy`)).text()).toContain("never keep it");
    expect((await SELF.fetch(`${SITE}/signin`)).headers.get("cache-control")).toBe("no-store");
    expect(await (await SELF.fetch(`${SITE}/robots.txt`)).text()).toContain("Disallow: /account");
  });
});

describe("playing as your account", () => {
  it("gives a signed-in player a key to their account's passes, and anyone else a guest's", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, multiplayer_mode, created_at_ms, updated_at_ms) VALUES ('g-arena', 'arena-game', 'Arena', 'live', 'listed', 'v1', 'relay', ?, ?)").bind(now, now).run();
    // Cloudflare's check on Play says each browser is real.
    const withSupabase = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).startsWith("https://challenges.cloudflare.com/") ? Promise.resolve(Response.json({ success: true, action: "play", hostname: "zaisma.test" })) : withSupabase(input, init),
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
      String(input instanceof Request ? input.url : input).startsWith("https://challenges.cloudflare.com/") ? Promise.resolve(Response.json({ success: true, action: "play", hostname: "zaisma.test" })) : withSupabase(input, init),
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
    expect(traded).toEqual({ player: { id: account.player_id, name: "Night Owl", kind: "account" }, key: expect.stringMatching(/^room_key_[a-z0-9]+$/), playerKind: "account" });
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
  const put = (b: Browser, baseVersionNumber: number, saveData: Record<string, string>, slug = "owl-game") =>
    b.go(`/api/saves/${slug}`, undefined, { method: "PUT", body: JSON.stringify({ base_version_number: baseVersionNumber, save_json: JSON.stringify(saveData) }) });

  it("stores a save, hands it back, and refuses an out-of-date one", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    const empty = (await (await b.go("/api/saves/owl-game")).json()) as { tag: string; version_number: number };
    expect(empty.version_number).toBe(0);
    expect(empty.tag).toMatch(/^[0-9a-f]{16}$/);

    const first = await put(b, 0, { level: "3", coins: "120" });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ version_number: 1, updated_at: expect.stringMatching(/Z$/) });
    const got = (await (await b.go("/api/saves/owl-game")).json()) as { version_number: number; save_data: Record<string, string>; sha256: string };
    expect(got).toMatchObject({ version_number: 1, save_data: { coins: "120", level: "3" } });
    expect(await env.SAVES.get(saveKey(users.get("fox@example.com")!, gameId)).then((o) => o?.text())).toBe(canonicalSave({ level: "3", coins: "120" }));

    // A second device that loaded version 0 can't overwrite version 1.
    const stale = await put(b, 0, { level: "1" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version_number: 1 });
    expect((await put(b, 1, { level: "4" })).status).toBe(200);
    expect((await put(b, 1, { level: "5" })).status).toBe(409);
  });

  it("tells the game page when the developer changed the save, so it takes it without asking", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    await put(b, 0, { level: "3" });
    expect(await (await b.go("/api/saves/owl-game?version")).json()).toEqual({ version_number: 1, changed_by_kind: "player" });
    await changeSaveAsDeveloper(env, users.get("fox@example.com")!, gameId, canonicalSave({ level: "10" }));
    expect(await (await b.go("/api/saves/owl-game?version")).json()).toEqual({ version_number: 2, changed_by_kind: "developer" });
    expect(await (await b.go("/api/saves/owl-game")).json()).toMatchObject({ version_number: 2, changed_by_kind: "developer", save_data: { level: "10" } });
    // The open game's next save started from version 1: refused, saying the developer moved it on.
    const stale = await put(b, 1, { level: "4" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version_number: 2, changed_by_kind: "developer" });
    // Once the game saves from the developer's version, the save is the player's again.
    expect((await put(b, 2, { level: "11" })).status).toBe(200);
    expect(await (await b.go("/api/saves/owl-game?version")).json()).toEqual({ version_number: 3, changed_by_kind: "player" });
  });

  it("stores saves from games that also keep IndexedDB databases", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    const save = { idb: [{ name: "/idbfs", version: 21, stores: [{ name: "FILE_DATA", keyPath: null, autoIncrement: false, indexes: [], records: [["/idbfs/save", { contents: { $z: ["view", "Uint8Array", "Bw=="] } }]] }] }], local: { b: "2", a: "1" } };
    const res = await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ base_version_number: 0, save_json: JSON.stringify(save) }) });
    expect(res.status).toBe(200);
    const text = canonicalSave(save);
    expect(text.startsWith('{"idb":[{"name":"/idbfs"')).toBe(true);
    expect(text).toContain('"local":{"a":"1","b":"2"}');
    expect(await env.SAVES.get(saveKey(users.get("fox@example.com")!, gameId)).then((o) => o?.text())).toBe(text);
    const got = (await (await b.go("/api/saves/owl-game")).json()) as { save_data: unknown; sha256: string };
    expect(got.save_data).toEqual(JSON.parse(text));
    expect(got.sha256).toBe(await sha256Hex(new TextEncoder().encode(text)));
  });

  it("keeps saves apart per player", async () => {
    await liveGame();
    const a = new Browser();
    await join(a, "a@example.com", "Player One");
    const b = new Browser();
    await join(b, "b@example.com", "Player Two");
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
    expect(await env.SAVES.get(saveKey(id, gameId))).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM saves").first()).toBeNull();
  });

  describe("earlier versions", () => {
    const id = () => users.get("fox@example.com")!;
    const copies = async () => (await env.DB.prepare("SELECT * FROM save_history ORDER BY saved_at_ms DESC, rowid DESC").all<{ id: string; copy_reason: string; saved_at_ms: number; sha256: string }>()).results;
    // Pretend the history was made earlier, so the next save is due an hourly copy.
    const age = (ms: number) => env.DB.prepare("UPDATE save_history SET saved_at_ms = saved_at_ms - ?").bind(ms).run();
    const putWith = (b: Browser, body: Record<string, unknown>) => b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify(body) });

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
      expect(await env.SAVES.get(`${id()}/${gameId}/${list[0]!.id}.json`).then((o) => o?.text())).toBe(canonicalSave({ level: "3" }));
    });

    it("keeps what's about to be lost: replaced progress, a shrunken save and the device's progress", async () => {
      await liveGame();
      const b = new Browser();
      await join(b);
      await put(b, 0, { level: "9", coins: "5000", items: "sword,shield,bow" });
      await put(b, 1, { level: "10", coins: "5100", items: "sword,shield,bow" });
      await putWith(b, { base_version_number: 2, save_json: JSON.stringify({ level: "11", coins: "5200", items: "sword,shield,bow" }), replace: true });
      await put(b, 3, { level: "1" });
      const kept = await putWith(b, { keep: true, save_json: JSON.stringify({ phone: "progress" }) });
      expect(kept.status).toBe(200);
      expect(await kept.json()).toEqual({ is_kept: true });
      expect((await copies()).map((c) => c.copy_reason)).toEqual(["device", "smaller", "replaced", "hourly"]);
      // Keeping the device's progress doesn't touch the account's save.
      expect(((await (await b.go("/api/saves/owl-game")).json()) as { version_number: number }).version_number).toBe(4);
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
      expect(list.at(-1)!.copy_reason).toBe("replaced");
      const files = await env.SAVES.list({ prefix: `${id()}/g-owl-game/` });
      expect(files.objects).toHaveLength(5);
    });

    it("goes back to an earlier version, and keeps the progress it replaced", async () => {
      const gameId = await liveGame();
      const b = new Browser();
      await join(b);
      await put(b, 0, { level: "7" });
      await put(b, 1, { level: "1" });
      const [copy] = await copies();
      const page = await (await b.go("/account/saves/owl-game")).text();
      expect(page).toContain("Earlier versions");
      expect(page).toContain(`value="${copy!.id}"`);
      const res = await b.go("/account/saves/owl-game/restore", { id: copy!.id });
      expect(res.headers.get("location")).toBe("/account/saves/owl-game?restored");
      const got = (await (await b.go("/api/saves/owl-game")).json()) as { version_number: number; save_data: unknown };
      expect(got).toMatchObject({ version_number: 3, save_data: { level: "7" } });
      expect((await copies()).map((c) => c.copy_reason)).toEqual(["restore", "hourly"]);
      expect(await env.SAVES.get(saveKey(id(), gameId)).then((o) => o?.text())).toBe(canonicalSave({ level: "7" }));
      expect(await (await b.go("/account/saves/owl-game?restored")).text()).toContain("starts from that progress");
      // A device still on the old version has to choose instead of overwriting.
      expect((await put(b, 2, { level: "2" })).status).toBe(409);
    });

    it("lists saves on the account, only for the player, and refuses other people's copies", async () => {
      await liveGame();
      const a = new Browser();
      await join(a);
      await put(a, 0, { level: "1" });
      await put(a, 1, { level: "2" });
      expect(await (await a.go("/account/saves")).text()).toContain('href="/account/saves/owl-game"');
      expect(await (await a.go("/account")).text()).toContain('href="/account/saves"');
      const [copy] = await copies();
      const other = new Browser();
      await join(other, "b@example.com", "Player Two");
      expect(await (await other.go("/account/saves")).text()).toContain("No saves yet");
      expect((await other.go("/account/saves/owl-game/restore", { id: copy!.id })).headers.get("location")).toBe("/account/saves/owl-game?failed");
      expect((await new Browser().go("/account/saves")).headers.get("location")).toBe("/signin?next=%2Faccount%2Fsaves");
      expect((await a.go("/account/saves/owl-game/restore", { id: copy!.id }, { origin: "https://evil.example" })).status).toBe(403);
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
    expect(page).toContain('<aside class="keep plate bevel" id="keep"');
    expect(page).toContain("Your Owl Game progress is only saved in this browser.");
    expect(page).toContain('href="/join?next=%2Fg%2Fowl-game%3Fplay" data-keep="/join"');
    expect(page).toContain('href="/signin?next=%2Fg%2Fowl-game%3Fplay" data-keep="/signin"');
    expect(page).toContain('"slug":"owl-game"');
    expect(await (await SELF.fetch(`${SITE}/g/own-saves`)).text()).not.toContain('id="keep"');
  });

  it("lands the new account back at the game, and tells the game tab", async () => {
    await liveGame();
    expect((await new Browser().go("/account/kept?game=owl-game")).headers.get("location")).toBe("/signin?next=%2Faccount%2Fkept%3Fgame%3Dowl-game");
    const b = new Browser();
    const joined = await (async () => {
      await b.go("/join/age", BIRTH_ADULT);
      await b.go("/join/email", { email: "fox@example.com", name: "Night Owl", next: "/account/kept?game=owl-game" });
      return b.go("/signin/code", { email: "fox@example.com", code: "123456", next: "/account/kept?game=owl-game" });
    })();
    expect(joined.headers.get("location")).toBe("/account/kept?game=owl-game");
    const page = await (await b.go("/account/kept?game=owl-game")).text();
    expect(page).toContain("You're in, Night Owl");
    expect(page).toContain('href="/g/owl-game?play" data-back=""');
    expect(page).toContain('BroadcastChannel("zaisma").postMessage("signed-in")');
    expect(await (await b.go("/account/kept?game=nope")).text()).toContain("Find a game");
    // A game that keeps its own saves: no word about progress saving to the account.
    await liveGame("own-saves", 0);
    const own = await (await b.go("/account/kept?game=own-saves")).text();
    expect(own).toContain("Go back to Owl Game to keep playing.</p>");
  });

  it("lets a game ask a guest to sign in beside it, in a new tab, and tells the game who they are", async () => {
    await liveGame();
    const page = await (await SELF.fetch(`${SITE}/g/owl-game`)).text();
    expect(page).toContain('<aside class="keep plate bevel" id="sign-in-ask"');
    expect(page).toContain("Owl Game asks you to sign in");
    expect(page).toContain('href="/join?next=%2Fg%2Fowl-game%3Fplay" data-sign-in="/join"');
    expect(page).toContain('href="/signin?next=%2Fg%2Fowl-game%3Fplay" data-sign-in="/signin"');
    expect(page).toContain('d.type === "zaisma:sign-in"');
    expect(page).toContain('fetch("/api/plays/owl-game/account"');
    expect(page).toContain('type: "zaisma:signed-in"');
  });

  it("game pages offer saves only for games that use them", async () => {
    await liveGame();
    await liveGame("own-saves", 0);
    const page = await (await SELF.fetch(`${SITE}/g/owl-game`)).text();
    expect(page).toContain("window.startSaves = function");
    expect(page).toContain('id="save-choice"');
    expect(page).toContain('"api":"/api/saves/owl-game"');
    expect(page).toContain('<a id="save-history" href="/account/saves/owl-game" hidden>');
    const own = await (await SELF.fetch(`${SITE}/g/own-saves`)).text();
    expect(own).not.toContain("window.startSaves = function");
    expect(own).not.toContain("save-choice");
  });

  it("game pages that need an account say so before Play and ask guests to sign in, back to the same match", async () => {
    await liveGame("members-only");
    expect(await (await SELF.fetch(`${SITE}/g/members-only`)).text()).not.toContain('id="account-note"');
    await env.DB.prepare("UPDATE games SET account_requirement = 'whole_game' WHERE slug = 'members-only'").run();
    const page = await (await SELF.fetch(`${SITE}/g/members-only?room=BCDFGH`)).text();
    expect(page).toContain(">Needs a Zaisma account<");
    expect(page).toContain('href="/signin?next=%2Fg%2Fmembers-only%3Froom%3DBCDFGH"');
    expect(page).toContain('href="/join?next=%2Fg%2Fmembers-only%3Froom%3DBCDFGH"');
    expect(page).toContain("Sign in to play");
    // A room link starts the game only for a signed-in player.
    expect(page).toContain("if (!needsSignIn) play();");
    await env.DB.prepare("UPDATE games SET account_requirement = 'multiplayer' WHERE slug = 'members-only'").run();
    const online = await (await SELF.fetch(`${SITE}/g/members-only`)).text();
    expect(online).toContain(">Playing online needs a Zaisma account<");
    // Guests can still play alone, so Play stays Play.
    expect(online).not.toContain("Sign in to play");
  });
});

describe("API keys on the account page", () => {
  it("shows a new key once, lists it and removes it", async () => {
    const b = new Browser();
    await join(b);
    const made = await (await b.go("/account/keys", { name: "My laptop", access_level: "full", game_scope: "all" })).text();
    const token = made.match(/zsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}/)?.[0];
    expect(token).toBeTruthy();
    const api = await SELF.fetch(`${SITE}/api/dev/games`, { headers: { authorization: `Bearer ${token}` } });
    expect(await api.json()).toEqual({ games: [], unread_topic_count: 0 });

    const page = await (await b.go("/account")).text();
    expect(page).toContain("My laptop");
    expect(page).not.toContain(token!);

    const id = page.match(/\/account\/keys\/([a-z0-9]+)\/revoke/)![1];
    await b.go(`/account/keys/${id}/revoke`, {});
    expect((await SELF.fetch(`${SITE}/api/dev/games`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("makes a key limited to some games and a level, and lists what it can do", async () => {
    const b = new Browser();
    await join(b);
    for (const title of ["Sky Hopper", "Cave Run"]) expect((await b.go("/api/dev/games", undefined, { method: "POST", body: JSON.stringify({ title }) })).status).toBe(201);
    const form = new URLSearchParams([["name", "CI"], ["access_level", "upload"], ["game_scope", "some"], ["game_slugs", "sky-hopper"], ["game_slugs", "someone-elses-game"]]);
    const made = await (await b.go("/account/keys", form)).text();
    const token = made.match(/zsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}/)![0];
    const access = await (await SELF.fetch(`${SITE}/api/dev/access`, { headers: { authorization: `Bearer ${token}` } })).json();
    // Games that aren't the developer's are dropped.
    expect(access).toMatchObject({ access: { api_key_name: "CI", access_level: "upload", game_slugs: ["sky-hopper"] } });
    expect(await (await b.go("/account")).text()).toContain("Upload; only Sky Hopper");

    // A custom key for some games: sign-in apps and webhooks stay out of its reach, whatever the form sent.
    const custom = new URLSearchParams({ name: "Stats", access_level: "custom", game_scope: "some", game_slugs: "cave-run", game_access: "read", version_access: "read", stats_access: "read", database_access: "none", save_access: "none", forum_access: "none", sign_in_app_access: "write", webhook_access: "read" });
    const customToken = (await (await b.go("/account/keys", custom)).text()).match(/zsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}/)![0];
    const customAccess = (await (await SELF.fetch(`${SITE}/api/dev/access`, { headers: { authorization: `Bearer ${customToken}` } })).json()) as { access: { area_access: Record<string, string> } };
    expect(customAccess.access.area_access).toMatchObject({ stats_access: "read", database_access: "none", sign_in_app_access: "none", webhook_access: "none" });

    // Some games, but none chosen.
    const none = new URLSearchParams({ name: "Nothing", access_level: "read", game_scope: "some" });
    expect(await (await b.go("/account/keys", none)).text()).toContain("Choose at least one game");
  });

  it("lets the dashboard use the session, but only from zaisma.com", async () => {
    const b = new Browser();
    await join(b);
    expect((await b.go("/api/dev/games")).status).toBe(200);
    const body = JSON.stringify({ title: "Cookie Game" });
    expect((await b.go("/api/dev/games", undefined, { method: "POST", body, origin: "https://evil.example" })).status).toBe(403);
    expect((await b.go("/api/dev/games", undefined, { method: "POST", body })).status).toBe(201);
  });
});

describe("the dashboard", () => {
  const pass: ScanDeps = {
    images: { check: async (imgs) => ({ provider: "test", isConnected: true, checkedMediaCount: imgs.length, findings: [] }) },
    ai: async () => ({ report: { model: "test", verdict: "pass", summary: "fine", input_token_count: 1, output_token_count: 1 }, findings: [], isChildSafety: false }),
  };

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

  it("makes a game, publishes it and asks before hiding it", async () => {
    const b = new Browser();
    await join(b);
    expect(await (await b.go("/dashboard")).text()).toContain("No games yet");

    const made = await b.go("/dashboard/new", { title: "Sky Hopper" });
    expect(made.headers.get("location")).toBe("/dashboard/sky-hopper?done=made");
    expect(await (await b.go("/dashboard")).text()).toContain("Sky Hopper");

    const id = await uploadAndPass(b, "sky-hopper", "<p>hop</p>");
    const page = await (await b.go("/dashboard/sky-hopper")).text();
    expect(page).toContain(`/dashboard/sky-hopper/versions/${id}/publish`);
    expect(page).toContain("Preview");

    expect((await b.go(`/dashboard/sky-hopper/versions/${id}/publish`, {})).headers.get("location")).toContain("done=published");
    await b.go("/dashboard/sky-hopper/visibility", { visibility: "listed" });
    expect((await gameBySlug(env.DB, "sky-hopper"))!.visibility).toBe("listed");

    const asked = await b.go("/dashboard/sky-hopper/visibility", { visibility: "private" });
    expect(await asked.text()).toContain("Hide it from players");
    expect((await gameBySlug(env.DB, "sky-hopper"))!.visibility).toBe("listed");
    await b.go("/dashboard/sky-hopper/visibility", { visibility: "private", confirm: "yes" });
    expect((await gameBySlug(env.DB, "sky-hopper"))!.visibility).toBe("private");
  });

  it("saves details and shows API refusals on the page", async () => {
    const b = new Browser();
    await join(b);
    await b.go("/dashboard/new", { title: "Hop" });
    const saved = await b.go("/dashboard/hop/details", { title: "Hop Hop", description: "Jump.", devices: "phone", screen: "portrait" });
    expect(saved.headers.get("location")).toContain("done=details");
    expect(await gameBySlug(env.DB, "hop-hop")).toBeNull();
    // An unticked Cloud saves box turns them off; ticking it turns them back on.
    expect((await gameBySlug(env.DB, "hop"))!).toMatchObject({ title: "Hop Hop", devices: "phone", screen_orientation: "portrait", cloud_saves_enabled: 0 });
    await b.go("/dashboard/hop/details", { title: "Hop Hop", cloud_saves: "on" });
    expect((await gameBySlug(env.DB, "hop"))!.cloud_saves_enabled).toBe(1);
    expect(await (await b.go("/dashboard/hop")).text()).toContain('name="cloud_saves" checked');

    const refused = await b.go("/dashboard/hop/details", { title: "" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("title is empty or over 80 characters. Give a title of 1 to 80 characters.");
  });

  it("keeps other people's games and other sites out", async () => {
    const owner = new Browser();
    await join(owner);
    await owner.go("/dashboard/new", { title: "Mine" });
    const other = new Browser();
    await join(other, "other@example.com", "Other Owl");
    expect((await other.go("/dashboard/mine")).status).toBe(404);
    expect((await other.go("/dashboard/mine/visibility", { visibility: "draft" })).status).toBe(404);
    expect((await owner.go("/dashboard/mine/visibility", { visibility: "listed" }, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("messages Zaisma privately from the forum's pages as the developer, and shows who wrote each post", async () => {
    const b = new Browser();
    await join(b);
    await b.go("/dashboard/new", { title: "Sky Hopper" });
    const board = await (await b.go("/forum")).text();
    expect(board).toContain('<a href="/forum" aria-current="page">Forum</a>');
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
    const account = (await env.DB.prepare("SELECT id FROM accounts WHERE name = ?").bind("Night Owl").first<{ id: string }>())!;
    const { token } = await createApiKey(env.DB, account.id, "claude");
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const added = await SELF.fetch(`${SITE}/api/dev/forum/${id}/posts`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ text_markdown: "It fails at the last 4 MB part.", images_base64: [btoa(String.fromCharCode(...png))] }) });
    const aiPost = ((await added.json()) as { post: { id: string; media: { id: string }[] } }).post;
    const image = aiPost.media[0]!.id;
    const thread = await (await b.go(`/forum/${id}?done=posted-private`)).text();
    expect(thread).toContain("<strong>Night Owl</strong>");
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
    await join(other, "other@example.com", "Other Owl");
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
    await join(other, "other@example.com", "Other Owl");
    await other.go(`/forum/${id}/reply`, { text_markdown: "The one closest to the first player who joins." });
    await check();
    const answer = (await env.DB.prepare("SELECT id FROM forum_posts WHERE topic_id = ? AND text_markdown LIKE 'The one closest%'").bind(id).first<{ id: string }>())!.id;
    await first.go(`/forum/${id}/reply`, { text_markdown: "Thanks, that explains it.", reply_to_post_id: answer });
    await check();
    const page = await (await reader.go(`/forum/${id}`)).text();
    expect(page).toContain('class="quote"');
    expect(page).toContain("<strong>Other Owl</strong>");

    // Me too counts once per developer, never for your own topic.
    await other.go(`/forum/${id}/vote`, {});
    await other.go(`/forum/${id}/vote`, {});
    expect((await first.go(`/forum/${id}/vote`, {})).status).toBe(400);
    expect(await env.DB.prepare("SELECT vote_count, reply_count FROM forum_topics WHERE id = ?").bind(id).first()).toEqual({ vote_count: 1, reply_count: 2 });

    // Only the asker marks the answer.
    expect((await other.go(`/forum/${id}/answer`, { answer_post_id: answer })).status).toBe(403);
    await first.go(`/forum/${id}/answer`, { answer_post_id: answer });
    expect(await (await reader.go(`/forum/${id}`)).text()).toContain("Answered by Other Owl");
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
    expect(home).toContain('id="stage"');
    expect(home).toContain('href="/g/hop?play"');
    const page = await (await SELF.fetch(`${SITE}/g/hop`)).text();
    expect(page).toContain("New levels.");
    expect(page).toContain('id="tab-updates"');
    expect(await (await SELF.fetch(`${SITE}/g/hop?play`)).text()).toContain("play();");
  });
});

describe("passkeys", () => {
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
  async function addPasskey(b: Browser, device = new Device()) {
    const options = await api(b, "/api/passkeys/add/options");
    expect(options.status).toBe(200);
    expect(options.data).toMatchObject({ rp: { id: RP, name: "Zaisma" }, algs: [-7, -257] });
    const added = await api(b, "/api/passkeys/add", await device.create(options.data as { challenge: string }));
    expect(added).toEqual({ status: 200, data: { ok: true } });
    return device;
  }
  async function signInWith(device: Device, opts: { origin?: string; count?: number } = {}) {
    const b = new Browser();
    const { data } = await api(b, "/api/passkeys/signin/options");
    const res = await api(b, "/api/passkeys/signin", { ...(await device.get(String(data.challenge), opts)), next: "/account" });
    return { b, ...res };
  }

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

  it("asks for an email code first when the last sign-in wasn't recent", async () => {
    signinAge = 3600;
    const b = new Browser();
    await join(b);
    const page = await (await b.go("/account")).text();
    expect(page).toContain('action="/account/passkeys/confirm"');
    expect((await api(b, "/api/passkeys/add/options")).data).toMatchObject({ confirm: true });

    const sentBefore = sent.length;
    const code = await (await b.go("/account/passkeys/confirm", {})).text();
    expect(sent.length).toBe(sentBefore + 1);
    expect(code).toContain('value="/account?passkey"');
    signinAge = 0;
    expect((await b.go("/signin/code", { email: "fox@example.com", code: "123456", next: "/account?passkey" })).headers.get("location")).toBe("/account?passkey");
    expect(await (await b.go("/account?passkey")).text()).toContain("Thanks, that's you.");
    await addPasskey(b);
  });

  it("only takes requests from our own pages, and deletes passkeys with the account", async () => {
    const b = new Browser();
    await join(b);
    await addPasskey(b);
    expect((await b.go("/api/passkeys/signin/options", undefined, { method: "POST", body: "{}", origin: "https://evil.example" })).status).toBe(403);
    expect((await api(new Browser(), "/api/passkeys/add/options")).status).toBe(401);
    await b.go("/account/delete", { confirm: "delete" });
    expect(await env.DB.prepare("SELECT * FROM passkeys").first()).toBeNull();
  });

  it("offers passkeys on the sign-in page", async () => {
    const page = await (await new Browser().go("/signin?next=/g/owl")).text();
    expect(page).toContain("Sign in with a passkey");
    expect(page).toContain('autocomplete="email webauthn"');
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
    await join(developer, `maker-${crypto.randomUUID()}@example.com`, "Sky Maker");
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
    await join(stranger, "stranger@example.com", "Some Stranger");
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

    await join(player, "owl@example.com", "Night Owl");
    const consent = await player.go(authorizeQuery(appId));
    expect(consent.status).toBe(200);
    const consentPage = await consent.text();
    expect(consentPage).toContain("Sign in to Sky Hopper Online");
    expect(consentPage).toContain("Never your email");
    expect(consentPage).toContain("skyhopper.test");
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
    const account = await env.DB.prepare("SELECT player_id FROM accounts WHERE name = 'Night Owl'").first<{ player_id: string }>();
    const claims = await readIdToken(tokens.id_token);
    expect(claims).toMatchObject({ iss: SITE, sub: account!.player_id, aud: appId, nonce: "nonce-456", name: "Night Owl" });
    expect(JSON.stringify(claims)).not.toContain("owl@example.com");
    expect((await swap({ code, client_id: appId, client_secret: clientSecret! })).status).toBe(400);

    const userinfo = () => SELF.fetch(`${SITE}/oauth/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(await (await userinfo()).json()).toEqual({ sub: account!.player_id, name: "Night Owl" });

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
    await join(player, "owl@example.com", "Night Owl");
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

    // Signing in with an email code keeps the whole link, PKCE included, and comes back to it.
    await player.go("/signout", {});
    const next = new URL((await player.go(authorizeQuery(appId, pkce))).headers.get("location")!, SITE).searchParams.get("next")!;
    expect(next.length).toBeGreaterThan(200);
    await player.go("/signin", { email: "owl@example.com", next });
    expect((await player.go("/signin/code", { email: "owl@example.com", code: "123456", next })).headers.get("location")).toBe(next);
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
    await join(player, "owl@example.com", "Night Owl");
    await allow(player, appId);
    await player.go("/account/delete", { confirm: "delete" });
    expect(await env.DB.prepare("SELECT * FROM sign_in_grants").first()).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM sign_in_codes").first()).toBeNull();
    await developer.go("/account/delete", { confirm: "delete" });
    expect(await env.DB.prepare("SELECT * FROM sign_in_apps").first()).toBeNull();
  });
});
