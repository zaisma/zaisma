import { describe, expect, it, onTestFinished, vi } from "vitest";
import { GameServerError, checkChat, guestPlayer, signInWithZaismaPlayers, type PublicKey } from "../../packages/game-server/src/internal.ts";

// Players from outside Zaisma on a developer's own server: Sign in with Zaisma's ID tokens checked by
// signInWithZaismaPlayers, guests from elsewhere, and checkChat with null for each of them.

const SITE = "https://zaisma.test";
const APP = "sign_in_app_8f3k2m";
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

const base64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const textBase64Url = (text: string) => base64Url(new TextEncoder().encode(text));

/** An RS256 key as apps/site/src/sign-in.ts makes one, with its public JWK. */
async function rsaKey(kid: string) {
  const pair = (await crypto.subtle.generateKey({ ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { privateKey: pair.privateKey, publicJwk: { kty: "RSA", n: jwk.n, e: jwk.e, kid, alg: "RS256", use: "sig" } as PublicKey };
}

async function idToken(key: Awaited<ReturnType<typeof rsaKey>>, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const signed = `${textBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.publicJwk.kid, ...header }))}.${textBase64Url(JSON.stringify({ iss: SITE, sub: "player_ana", aud: APP, iat: nowSec, exp: nowSec + 3600, name: "ana", ...claims }))}`;
  return `${signed}.${base64Url(new Uint8Array(await crypto.subtle.sign(RS256, key.privateKey, new TextEncoder().encode(signed))))}`;
}

const key = await rsaKey("key_one");

describe("signInWithZaismaPlayers", () => {
  const identify = (loadKeys: (isRefreshing: boolean) => Promise<PublicKey[]> = async () => [key.publicJwk], loadProfile = async (playerId: string) => (playerId === "player_ana" ? { name: "ana" } : null)) => signInWithZaismaPlayers({ signInAppIds: [APP], siteUrl: SITE, loadKeys, loadProfile });
  const connection = { origin: "https://star-raiders.example.com" };

  it("answers the account's Zaisma player ID and name for a good ID token", async () => {
    expect(await identify()(await idToken(key, {}), connection)).toEqual({ id: "player_ana", name: "ana" });
  });

  it("answers null for a token for another app, from another issuer, expired, or signed any other way", async () => {
    const check = identify();
    const nowSec = Math.floor(Date.now() / 1000);
    const other = await rsaKey("key_one");
    for (const token of [
      await idToken(key, { aud: "sign_in_app_someoneelse" }),
      await idToken(key, { iss: "https://evil.example.com" }),
      await idToken(key, { exp: nowSec - 61 }),
      await idToken(key, {}, { typ: "at+jwt" }),
      await idToken(key, {}, { alg: "HS256" }),
      await idToken(other, {}),
      `${textBase64Url(JSON.stringify({ alg: "none", typ: "JWT", kid: "key_one" }))}.${textBase64Url(JSON.stringify({ iss: SITE, sub: "player_ana", aud: APP, exp: nowSec + 60, name: "ana" }))}.`,
      "not a token",
    ]) {
      expect(await check(token, connection)).toBeNull();
    }
    // Within the minute's leeway, a token just past exp still counts.
    expect(await check(await idToken(key, { exp: nowSec - 30 }), connection)).toEqual({ id: "player_ana", name: "ana" });
  });

  it("fetches the keys again once for a key it doesn't know", async () => {
    const newer = await rsaKey("key_two");
    const loadKeys = vi.fn(async (isRefreshing: boolean) => (isRefreshing ? [key.publicJwk, newer.publicJwk] : [key.publicJwk]));
    const check = identify(loadKeys);
    expect(await check(await idToken(newer, {}), connection)).toEqual({ id: "player_ana", name: "ana" });
    expect(loadKeys.mock.calls).toEqual([[false], [true]]);
    expect(await check(await idToken(await rsaKey("key_three"), {}), connection)).toBeNull();
    expect(loadKeys.mock.calls).toHaveLength(4);
  });

  it("takes the public profile's name for a token without one, and answers null for an account deleted since", async () => {
    const check = identify();
    expect(await check(await idToken(key, { name: undefined }), connection)).toEqual({ id: "player_ana", name: "ana" });
    expect(await check(await idToken(key, { sub: "player_gone", name: undefined }), connection)).toBeNull();
  });

  it("refuses options it doesn't take, and sign-in app IDs that aren't", () => {
    expect(() => signInWithZaismaPlayers({ signInAppIds: [APP], gameSlug: "x" } as never)).toThrow(GameServerError);
    expect(() => signInWithZaismaPlayers({ signInAppIds: [] })).toThrow(/signInAppIds/);
    expect(() => signInWithZaismaPlayers({ signInAppIds: ["app_1"] })).toThrow(/signInAppIds/);
  });
});

describe("guestPlayer", () => {
  it("is a temporary player ID and a generated name, like Zaisma's guests", () => {
    const guest = guestPlayer();
    expect(guest.id).toMatch(/^player_[a-z0-9]{20}$/);
    expect(guest.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
    expect(guestPlayer().id).not.toBe(guest.id);
  });
});

describe("checkChat with players from outside Zaisma", () => {
  it("allows chat among outsiders only without asking Zaisma, and sends null for each outsider otherwise", async () => {
    const asked: unknown[] = [];
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      asked.push(JSON.parse(String(init?.body)));
      return Response.json({ isAllowed: false, reason: "not_allowed_to_chat", message: "Chat isn't open for this message.", hasSwearing: false, hasSlur: false });
    });
    onTestFinished(() => fetched.mockRestore());
    expect(await checkChat({ text: "hi", senderPass: null, receiverPasses: [null, null] })).toEqual({ isAllowed: true, reason: null, message: null, hasSwearing: false, hasSlur: false });
    expect(asked).toEqual([]);

    // A pass, unchecked here (Zaisma checks it), saying where to ask.
    const teenPass = `${textBase64Url("{}")}.${textBase64Url(JSON.stringify({ sub: "player_teen", iss: "https://rooms.zaisma.com", aud: "arena" }))}.signature`;
    expect(await checkChat({ text: "hi", senderPass: null, receiverPasses: [teenPass, null] })).toMatchObject({ isAllowed: false, reason: "not_allowed_to_chat" });
    expect(asked).toEqual([{ gameSlug: "arena", senderPass: null, receiverPasses: [teenPass, null], text: "hi", recentTexts: [], isAdultFilterEnabled: false }]);
  });
});
