import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accountById, ageBand, ageOn, canonicalSave, checkName, gameById, gameBySlug, gameOwner, saveKey, sha256Hex, versionById } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";

const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";

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
  await env.DB.exec("DELETE FROM played; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM passkeys; DELETE FROM save_history; DELETE FROM saves; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
});

afterEach(() => vi.unstubAllGlobals());

// --- A browser with a cookie jar ---

class Browser {
  jar = new Map<string, string>();
  // Each browser gets its own address, so the sign-in rate limit doesn't spill between tests.
  ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  async go(path: string, form?: Record<string, string>, init: { method?: string; body?: string; origin?: string } = {}): Promise<Response> {
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
    expect(ageOn({ year: 2013, month: 10, day: 12 }, today)).toBe(13);
    expect(ageOn({ year: 2013, month: 10, day: 13 }, today)).toBe(12);
    expect(ageOn({ year: 2008, month: 2, day: 30 }, today)).toBeNull();
    expect(ageOn({ year: 2030, month: 1, day: 1 }, today)).toBeNull();
    expect([ageBand(12), ageBand(13), ageBand(17), ageBand(18)]).toEqual([null, "13-17", "13-17", "18+"]);
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
    expect(await age.text()).toContain("Your name");
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
    expect(account).toMatchObject({ name: "Night Owl", age_band: "18+" });
    const page = await (await b.go("/account?welcome")).text();
    expect(page).toContain("Welcome to Zaisma, Night Owl");
    expect(page).toContain("fox@example.com");
    expect(page).toContain("18 or over");
  });

  it("never stores the birth date", async () => {
    const b = new Browser();
    await join(b, "teen@example.com", "Quiet Comet", { year: String(thisYear - 15), month: "1", day: "1" });
    const row = await env.DB.prepare("SELECT * FROM accounts").first();
    expect(row).toMatchObject({ age_band: "13-17" });
    expect(JSON.stringify(row)).not.toContain(String(thisYear - 15));
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
    expect(await (await b.go("/join?with=discord")).text()).toContain("then continue with Discord again");

    expect(await (await b.go("/join/age", BIRTH_ADULT)).text()).toContain("Continue with Discord");
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

    expect(await (await b.go("/account/age", { year: String(thisYear - 16), month: "1", day: "1" })).text()).toContain("18 or over yet");
    await b.go("/account/age", { year: String(thisYear - 19), month: "1", day: "1" });
    expect((await accountById(env.DB, id))?.age_band).toBe("18+");

    expect(await (await b.go("/account/delete", { confirm: "nope" })).text()).toContain('Type "delete"');
    const gone = await b.go("/account/delete", { confirm: "delete" });
    expect(await gone.text()).toContain("Your account is deleted");
    expect(deleted).toEqual([id]);
    expect(await accountById(env.DB, id)).toBeNull();
    expect(b.jar.size).toBe(0);
  });
});

describe("game owners", () => {
  it("admin gives a game to an account, and it shows on their account page", async () => {
    const b = new Browser();
    await join(b);
    const id = users.get("fox@example.com")!;
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, status, created_at, updated_at) VALUES ('g1', 'owl-game', 'Owl Game', 'live', ?, ?)").bind(now, now).run();

    const bad = await SELF.fetch("http://localhost/admin/games/g1/owner", { method: "POST", body: new URLSearchParams({ account_id: "nope" }) });
    expect(await bad.text()).toContain("No account with that ID");
    await SELF.fetch("http://localhost/admin/games/g1/owner", { method: "POST", body: new URLSearchParams({ account_id: id }), redirect: "manual" });
    const owner = await gameOwner(env.DB, (await gameById(env.DB, "g1"))!.owner_id);
    expect(owner).toMatchObject({ name: "Night Owl", owner: { kind: "person", account_id: id } });
    expect(await (await b.go("/account")).text()).toContain("Owl Game");

    // Deleting the account leaves the game up, with no owner.
    await b.go("/account/delete", { confirm: "delete" });
    expect((await gameById(env.DB, "g1"))?.owner_id).toBeNull();
    expect((await gameById(env.DB, "g1"))?.status).toBe("live");
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

describe("cloud saves", () => {
  async function liveGame(slug = "owl-game", cloudSaves = 1) {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO games (id, slug, title, status, cloud_saves, created_at, updated_at) VALUES (?, ?, 'Owl Game', 'live', ?, ?, ?)")
      .bind(`g-${slug}`, slug, cloudSaves, now, now)
      .run();
    return `g-${slug}`;
  }
  const put = (b: Browser, base: number, data: Record<string, string>, slug = "owl-game") =>
    b.go(`/api/saves/${slug}`, undefined, { method: "PUT", body: JSON.stringify({ base, data: JSON.stringify(data) }) });

  it("stores a save, hands it back, and refuses an out-of-date one", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    const empty = (await (await b.go("/api/saves/owl-game")).json()) as { tag: string; version: number };
    expect(empty.version).toBe(0);
    expect(empty.tag).toMatch(/^[0-9a-f]{16}$/);

    const first = await put(b, 0, { level: "3", coins: "120" });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ version: 1 });
    const got = (await (await b.go("/api/saves/owl-game")).json()) as { version: number; data: Record<string, string>; hash: string };
    expect(got).toMatchObject({ version: 1, data: { coins: "120", level: "3" } });
    expect(await env.SAVES.get(saveKey(users.get("fox@example.com")!, gameId)).then((o) => o?.text())).toBe(canonicalSave({ level: "3", coins: "120" }));

    // A second device that loaded version 0 can't overwrite version 1.
    const stale = await put(b, 0, { level: "1" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version: 1 });
    expect((await put(b, 1, { level: "4" })).status).toBe(200);
    expect((await put(b, 1, { level: "5" })).status).toBe(409);
  });

  it("stores saves from games that also keep IndexedDB databases", async () => {
    const gameId = await liveGame();
    const b = new Browser();
    await join(b);
    const save = { idb: [{ name: "/idbfs", version: 21, stores: [{ name: "FILE_DATA", keyPath: null, autoIncrement: false, indexes: [], records: [["/idbfs/save", { contents: { $z: ["view", "Uint8Array", "Bw=="] } }]] }] }], local: { b: "2", a: "1" } };
    const res = await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ base: 0, data: JSON.stringify(save) }) });
    expect(res.status).toBe(200);
    const text = canonicalSave(save);
    expect(text.startsWith('{"idb":[{"name":"/idbfs"')).toBe(true);
    expect(text).toContain('"local":{"a":"1","b":"2"}');
    expect(await env.SAVES.get(saveKey(users.get("fox@example.com")!, gameId)).then((o) => o?.text())).toBe(text);
    const got = (await (await b.go("/api/saves/owl-game")).json()) as { data: unknown; hash: string };
    expect(got.data).toEqual(JSON.parse(text));
    expect(got.hash).toBe(await sha256Hex(new TextEncoder().encode(text)));
  });

  it("keeps saves apart per player", async () => {
    await liveGame();
    const a = new Browser();
    await join(a, "a@example.com", "Player One");
    const b = new Browser();
    await join(b, "b@example.com", "Player Two");
    await put(a, 0, { secret: "a" });
    expect(((await (await b.go("/api/saves/owl-game")).json()) as { version: number }).version).toBe(0);
  });

  it("refuses guests, other sites, bad saves, big saves and games that keep their own", async () => {
    await liveGame();
    await liveGame("own-saves", 0);
    expect((await new Browser().go("/api/saves/owl-game")).status).toBe(401);
    const b = new Browser();
    await join(b);
    expect((await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ base: 0, data: "{}" }), origin: "https://owl-game.games.example" })).status).toBe(403);
    expect((await b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify({ base: 0, data: '{"a":1}' }) })).status).toBe(400);
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
    const copies = async () => (await env.DB.prepare("SELECT * FROM save_history ORDER BY at DESC, rowid DESC").all<{ id: string; reason: string; at: number; hash: string }>()).results;
    // Pretend the history was made earlier, so the next save is due an hourly copy.
    const age = (ms: number) => env.DB.prepare("UPDATE save_history SET at = at - ?").bind(ms).run();
    const putWith = (b: Browser, body: Record<string, unknown>) => b.go("/api/saves/owl-game", undefined, { method: "PUT", body: JSON.stringify(body) });

    it("keeps a copy about once an hour, not on every save", async () => {
      const gameId = await liveGame();
      const b = new Browser();
      await join(b);
      await put(b, 0, { level: "1" });
      await put(b, 1, { level: "2" });
      // The first overwrite keeps a copy: there's nothing in the history yet.
      expect((await copies()).map((c) => c.reason)).toEqual(["hourly"]);
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
      await putWith(b, { base: 2, data: JSON.stringify({ level: "11", coins: "5200", items: "sword,shield,bow" }), replace: true });
      await put(b, 3, { level: "1" });
      expect((await putWith(b, { keep: true, data: JSON.stringify({ phone: "progress" }) })).status).toBe(200);
      expect((await copies()).map((c) => c.reason)).toEqual(["device", "smaller", "replaced", "hourly"]);
      // Keeping the device's progress doesn't touch the account's save.
      expect(((await (await b.go("/api/saves/owl-game")).json()) as { version: number }).version).toBe(4);
    });

    it("keeps five, dropping routine copies before ones from right before progress was lost", async () => {
      await liveGame();
      const b = new Browser();
      await join(b);
      await put(b, 0, { level: "0" });
      await putWith(b, { base: 1, data: JSON.stringify({ level: "1" }), replace: true });
      for (let v = 2; v <= 8; v++) {
        await age(2 * 3600_000);
        await put(b, v, { level: String(v) });
      }
      const list = await copies();
      expect(list).toHaveLength(5);
      expect(list.at(-1)!.reason).toBe("replaced");
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
      const got = (await (await b.go("/api/saves/owl-game")).json()) as { version: number; data: unknown };
      expect(got).toMatchObject({ version: 3, data: { level: "7" } });
      expect((await copies()).map((c) => c.reason)).toEqual(["restore", "hourly"]);
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
});

describe("API keys on the account page", () => {
  it("shows a new key once, lists it and removes it", async () => {
    const b = new Browser();
    await join(b);
    const made = await (await b.go("/account/keys", { name: "My laptop" })).text();
    const token = made.match(/zsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}/)?.[0];
    expect(token).toBeTruthy();
    const api = await SELF.fetch(`${SITE}/api/dev/games`, { headers: { authorization: `Bearer ${token}` } });
    expect(await api.json()).toEqual({ games: [] });

    const page = await (await b.go("/account")).text();
    expect(page).toContain("My laptop");
    expect(page).not.toContain(token!);

    const id = page.match(/\/account\/keys\/([a-z0-9]+)\/revoke/)![1];
    await b.go(`/account/keys/${id}/revoke`, {});
    expect((await SELF.fetch(`${SITE}/api/dev/games`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
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
    images: { check: async (imgs) => ({ provider: "test", connected: true, checked: imgs.length, findings: [] }) },
    ai: async () => ({ report: { model: "test", verdict: "pass", summary: "fine", inputTokens: 1, outputTokens: 1 }, findings: [], childSafety: false }),
  };

  /** Upload a one-file game through the API with the browser's session, then pass its scan. */
  async function uploadAndPass(b: Browser, slug: string, text: string): Promise<string> {
    const sha256 = await sha256Hex(new TextEncoder().encode(text));
    const files = [{ path: "index.html", sha256, bytes: new TextEncoder().encode(text).byteLength }];
    await b.go(`/api/dev/games/${slug}/uploads`, undefined, { method: "POST", body: JSON.stringify({ files }) });
    expect((await b.go(`/api/dev/files/${sha256}`, undefined, { method: "PUT", body: text })).status).toBe(200);
    const { version } = (await (await b.go(`/api/dev/games/${slug}/versions`, undefined, { method: "POST", body: JSON.stringify({ files }) })).json()) as { version: { id: string } };
    for (let i = 0; i < 60 && (await versionById(env.DB, version.id))?.scan_status === "scanning"; i++) await new Promise((r) => setTimeout(r, 50));
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
    expect((await gameBySlug(env.DB, "hop"))!).toMatchObject({ title: "Hop Hop", devices: "phone", screen: "portrait", cloud_saves: 0 });
    await b.go("/dashboard/hop/details", { title: "Hop Hop", cloud_saves: "on" });
    expect((await gameBySlug(env.DB, "hop"))!.cloud_saves).toBe(1);
    expect(await (await b.go("/dashboard/hop")).text()).toContain('name="cloud_saves" checked');

    const refused = await b.go("/dashboard/hop/details", { title: "" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("The title needs 1 to 80 characters.");
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
});

describe("recently played", () => {
  async function liveGame(slug: string, title: string) {
    const id = `g-${slug}`;
    await env.DB.prepare("INSERT INTO games (id, slug, title, description, status, visibility, created_at, updated_at) VALUES (?, ?, ?, '', 'live', 'listed', 1, 1)").bind(id, slug, title).run();
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, bytes, scan_status, created_at, published_at, notes) VALUES (?, ?, 'x', 1, 1, 'approved', 1, ?, ?)").bind(`v-${slug}`, id, Date.now(), "New levels.").run();
    await env.DB.prepare("UPDATE games SET current_version_id = ? WHERE id = ?").bind(`v-${slug}`, id).run();
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
    const list = { played: [{ slug: "hop", at: 5 }, { slug: "dash", at: 10 }, { slug: "nope", at: 20 }, { slug: "dash", at: "soon" }] };
    expect((await b.go("/api/me/played", undefined, { method: "POST", body: JSON.stringify(list) })).status).toBe(200);
    const { played } = (await (await b.go("/api/me/played")).json()) as { played: { slug: string; at: number }[] };
    expect(played.map((p) => p.slug)).toEqual(["hop", "dash"]);
    expect(played[0]!.at).toBeGreaterThan(5);
    expect(played[1]!.at).toBe(10);
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
    const row = await env.DB.prepare("SELECT sign_count, last_used_at FROM passkeys").first<{ sign_count: number; last_used_at: number }>();
    expect(row!.sign_count).toBe(1);
    expect(row!.last_used_at).toBeGreaterThan(0);
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
