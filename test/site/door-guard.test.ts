import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "@zaisma/core";
import { currentSession } from "../../apps/site/src/auth.ts";
import { PATH_PARTS, SITE_DOORS, siteDoorAt, type SiteDoor } from "../../apps/site/src/doors.ts";
import { guardSiteDoor } from "../../apps/site/src/guard.ts";
import { samplePathOf } from "../door-samples.ts";

/**
 * The guard in front of every door on zaisma.com (docs/DOORS.md), called with each row of SITE_DOORS, so a new
 * row is tried by writing it. The guard itself, not the page: what it refuses, no door's own code ever sees.
 * What a door does for each kind of caller past the guard is the contract test grid's.
 */

const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";
const realFetch = globalThis.fetch;
const OTHER_SITE = "https://other.example.test";
let signingKeys: CryptoKeyPair;
let publicKey: JsonWebKey;

const b64url = (given: ArrayBuffer | string) =>
  btoa(typeof given === "string" ? given : String.fromCharCode(...new Uint8Array(given)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function sessionCookie(accountId: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "guard-test-key", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ sub: accountId, email: "", aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }] }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `__Host-zaisma=${header}.${claims}.${b64url(signature)}~r-${accountId}`;
}

const methodsOf = (door: SiteDoor): string[] => (door.methods === "any" ? ["POST"] : [...door.methods]);
const rowsWith = (test: (door: SiteDoor) => boolean) => SITE_DOORS.filter(test).flatMap((door) => methodsOf(door).map((method) => ({ door, method, path: samplePathOf(door.path, PATH_PARTS) })));
const requestAt = (path: string, method: string, headers: Record<string, string> = {}) => new Request(`${SITE}${path}`, { method, headers: { ...headers, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, ...(["GET", "HEAD", "OPTIONS"].includes(method) ? {} : { body: "" }) });
const needsSession = (door: SiteDoor) => "whenSignedOut" in door;
const isDeveloperDoor = (door: SiteDoor) => "whenNoAccount" in door;
const ownOrigin = (door: SiteDoor): Record<string, string> => (door.origin === "anywhere" ? {} : { origin: SITE });

beforeAll(async () => {
  signingKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = (await crypto.subtle.exportKey("jwk", signingKeys.publicKey)) as JsonWebKey;
});

beforeEach(async () => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "guard-test-key", alg: "ES256" }] });
    return realFetch(input, init);
  });
  await env.DB.prepare("DELETE FROM accounts WHERE id LIKE 'guard-%'").run();
  await createAccount(env.DB, { id: "guard-emma", username: "Emma_Builds", ageBand: "18+" });
});

afterEach(() => vi.unstubAllGlobals());

describe("The guard's table", () => {
  it("finds each row at its own sample path", () => {
    const shadowed = rowsWith(() => true).filter(({ door, method, path }) => siteDoorAt(path, method) !== door);
    expect(shadowed.map(({ door, method, path }) => `${method} ${door.path} at ${path}: ${JSON.stringify(siteDoorAt(path, method))}`)).toEqual([]);
  });

  it("answers a path with no row as nothing there, and a method a row doesn't take as not allowed", async () => {
    const missing = await SELF.fetch(`${SITE}/no-door-here/at-all`, { redirect: "manual" });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Page not found");
    const wrong = await SELF.fetch(`${SITE}/friends`, { method: "DELETE", redirect: "manual" });
    expect(wrong.status).toBe(405);
    const head = await guardSiteDoor(requestAt("/games", "HEAD"), env, "/games");
    expect(head).toBeNull();
  });
});

describe("Who may call", () => {
  it("refuses every door that needs a session, signed out, with what that door has always answered", async () => {
    for (const { door, method, path } of rowsWith(needsSession)) {
      const answer = await guardSiteDoor(requestAt(path, method, ownOrigin(door)), env, path);
      expect(answer, `${method} ${door.path}`).not.toBeNull();
      if (!("whenSignedOut" in door)) continue;
      const { whenSignedOut } = door;
      if (whenSignedOut.kind === "status") expect(answer!.status, `${method} ${door.path}`).toBe(whenSignedOut.httpStatus);
      if (whenSignedOut.kind === "sign_in") expect(answer!.headers.get("location"), `${method} ${door.path}`).toMatch(/^\/signin/);
      if (whenSignedOut.kind === "profile") expect(answer!.headers.get("location"), `${method} ${door.path}`).toMatch(/^\/@/);
    }
  });

  it("lets a signed-in person through every door that needs a session", async () => {
    const cookie = `${await sessionCookie("guard-emma")}; __Host-zaisma_in=1`;
    for (const { door, method, path } of rowsWith(needsSession)) {
      expect(await guardSiteDoor(requestAt(path, method, { ...ownOrigin(door), cookie }), env, path), `${method} ${door.path}`).toBeNull();
    }
  });

  it("sends a session with no account yet to finish making one, on a developer's door", async () => {
    const cookie = await sessionCookie("guard-no-account-yet");
    for (const { door, method, path } of rowsWith(isDeveloperDoor)) {
      const answer = await guardSiteDoor(requestAt(path, method, { ...ownOrigin(door), cookie }), env, path);
      expect(answer?.headers.get("location"), `${method} ${door.path}`).toMatch(/^\/join\?next=\/dashboard/);
    }
  });

  it("keeps a banned developer to the doors open to them, and out of the forum's forms", async () => {
    await env.DB.prepare("UPDATE accounts SET banned_at_ms = 1, ban_scope = 'developer' WHERE id = 'guard-emma'").run();
    const cookie = await sessionCookie("guard-emma");
    for (const { door, method, path } of rowsWith((candidate) => isDeveloperDoor(candidate) || ("isClosedToBannedDeveloper" in candidate && Boolean(candidate.isClosedToBannedDeveloper)))) {
      const answer = await guardSiteDoor(requestAt(path, method, { ...ownOrigin(door), cookie }), env, path);
      if ("isOpenToBannedDeveloper" in door && door.isOpenToBannedDeveloper) expect(answer, `${method} ${door.path}`).toBeNull();
      else expect(answer?.headers.get("location"), `${method} ${door.path}`).toBe("/dashboard");
    }
    expect(await guardSiteDoor(requestAt("/forum/new", "GET", { cookie }), env, "/forum/new")).toBeNull();
  });

  it("treats a whole-account ban as signed out on every door", async () => {
    await env.DB.prepare("UPDATE accounts SET banned_at_ms = 1, ban_scope = 'whole_account' WHERE id = 'guard-emma'").run();
    const cookie = await sessionCookie("guard-emma");
    const answer = await guardSiteDoor(requestAt("/account", "GET", { cookie }), env, "/account");
    expect(answer?.headers.get("location")).toBe("/signin");
  });

  it("keeps /admin for Zaisma's own people", async () => {
    const rows = rowsWith((door) => door.contract.whoMayCall === "admin");
    expect(rows.length).toBeGreaterThan(30);
    for (const { door, method, path } of rows) expect((await guardSiteDoor(requestAt(path, method, ownOrigin(door)), env, path))?.status, `${method} ${door.path}`).toBe(403);
  });

  it("reads no session for a door anyone may open, so a guest's page costs what it did", async () => {
    const reads = vi.fn();
    const cookie = await sessionCookie("guard-emma");
    vi.stubGlobal("fetch", async () => {
      reads();
      return new Response(null, { status: 500 });
    });
    for (const { door, method, path } of rowsWith((candidate) => !needsSession(candidate) && candidate.contract.whoMayCall !== "admin")) {
      expect(await guardSiteDoor(requestAt(path, method, { ...ownOrigin(door), cookie }), env, path), `${method} ${door.path}`).toBeNull();
    }
    expect(reads).not.toHaveBeenCalled();
  });

  it("reads a session once a request: the guard's is the one the door's own code gets", async () => {
    const request = requestAt("/account", "GET", { cookie: await sessionCookie("guard-emma") });
    await guardSiteDoor(request, env, "/account");
    expect(currentSession(request, env)).toBe(currentSession(request, env));
  });
});

describe("Where a door takes requests from", () => {
  const originRows = rowsWith((door) => door.origin !== "anywhere");

  it("refuses another site at every door that takes only Zaisma's own pages, before anything else", async () => {
    expect(originRows.length).toBeGreaterThan(60);
    for (const { door, method, path } of originRows) {
      const answer = await guardSiteDoor(requestAt(path, method, { origin: OTHER_SITE }), env, path);
      expect(answer?.status, `${method} ${door.path}`).toBe(403);
      if (door.answersAs === "json") expect(await answer!.json()).toMatchObject({ error: { code: "bad_origin" } });
      if (door.answersAs === "empty") expect(await answer!.text()).toBe("");
    }
  });

  it("refuses a request that names no origin only where a door takes none but its own", async () => {
    const cookie = await sessionCookie("guard-emma");
    for (const { door, method, path } of originRows.filter(({ door }) => door.contract.whoMayCall !== "admin")) {
      const answer = await guardSiteDoor(requestAt(path, method, { cookie }), env, path);
      if (door.origin === "own_pages") expect(answer?.status, `${method} ${door.path}`).toBe(403);
      else expect(answer, `${method} ${door.path}`).toBeNull();
    }
  });

  it("takes Zaisma's own pages at every one", async () => {
    for (const { door, method, path } of originRows.filter(({ door }) => !needsSession(door) && door.contract.whoMayCall !== "admin")) {
      expect(await guardSiteDoor(requestAt(path, method, { origin: SITE }), env, path), `${method} ${door.path}`).toBeNull();
    }
  });
});
