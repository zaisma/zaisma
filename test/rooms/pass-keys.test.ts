import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PassError, generateSigningKey, signPass, verifyPass, type PublicKey } from "../../packages/game-server/src/internal.ts";
import { chatGroupId, passPublicKeys, playerTag, signingKey, type Env } from "../../apps/rooms/src/index.ts";

/** The pass key can be replaced with no game server breaking: the next key is published ahead, and a swap leaves old passes checking. */

const ISSUER = "https://rooms.zaisma.test";
const claims = () => ({ sub: "player_one", aud: "sky-hopper", iss: ISSUER, pass_version_number: 1 as const, kind: "account" as const, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
const expect_ = { gameSlug: "sky-hopper", issuerUrl: ISSUER };
const testEnv = env as unknown as Env;

describe("the pass key's two slots", () => {
  it("with one key, signs and publishes that one, as a self-hosted Zaisma does", async () => {
    const keys = await passPublicKeys({ PASS_SIGNING_KEY: await generateSigningKey() });
    expect(keys).toHaveLength(1);
    const { keys: published } = (await (await SELF.fetch(`${ISSUER}/.well-known/jwks.json`)).json()) as { keys: PublicKey[] };
    expect(published).toEqual(await passPublicKeys(testEnv));
  });

  it("publishes the next key ahead, so a server that fetched before the swap already holds it", async () => {
    const before = { PASS_SIGNING_KEY: await generateSigningKey(), SECOND_PASS_SIGNING_KEY: await generateSigningKey() };
    const after = { ...before, IS_SECOND_PASS_SIGNING_KEY_IN_USE: "true" };
    const heldByAGameServer = await passPublicKeys(before);
    expect(heldByAGameServer).toHaveLength(2);
    expect(heldByAGameServer[0]!.kid).toBe((await signingKey(before)).publicKey.kid);

    const signedAfter = await signPass(await signingKey(after), claims());
    expect((await signingKey(after)).publicKey.kid).toBe(heldByAGameServer[1]!.kid);
    expect((await verifyPass(signedAfter, heldByAGameServer, expect_)).sub).toBe("player_one");
  });

  it("a pass from before a swap keeps working, and the key in use is listed first", async () => {
    const before = { PASS_SIGNING_KEY: await generateSigningKey(), SECOND_PASS_SIGNING_KEY: await generateSigningKey() };
    const after = { ...before, IS_SECOND_PASS_SIGNING_KEY_IN_USE: "true" };
    const signedBefore = await signPass(await signingKey(before), claims());
    const publishedAfter = await passPublicKeys(after);
    expect((await verifyPass(signedBefore, publishedAfter, expect_)).sub).toBe("player_one");
    expect(publishedAfter[0]!.kid).toBe((await signingKey(after)).publicKey.kid);
  });

  it("once a leaked key's slot is overwritten, what it signed is refused as unknown_key", async () => {
    const before = { PASS_SIGNING_KEY: await generateSigningKey(), SECOND_PASS_SIGNING_KEY: await generateSigningKey() };
    const signedWithLeaked = await signPass(await signingKey(before), claims());
    const afterLeak = { ...before, PASS_SIGNING_KEY: await generateSigningKey(), IS_SECOND_PASS_SIGNING_KEY_IN_USE: "true" };
    const refusal = await verifyPass(signedWithLeaked, await passPublicKeys(afterLeak), expect_).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(PassError);
    expect((refusal as PassError).code).toBe("unknown_key");
  });

  it("says so when the marker is set and the second key isn't", async () => {
    await expect(signingKey({ PASS_SIGNING_KEY: await generateSigningKey(), IS_SECOND_PASS_SIGNING_KEY_IN_USE: "true" })).rejects.toThrow("SECOND_PASS_SIGNING_KEY");
  });
});

describe("chat's own key", () => {
  const newKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

  it("replacing it changes chat groups and never a player tag", async () => {
    const other = { ...testEnv, CHAT_GROUP_KEY: newKey() };
    expect(await chatGroupId(other, "sky-hopper", "adults")).not.toBe(await chatGroupId(testEnv, "sky-hopper", "adults"));
    expect(await playerTag(other, "sky-hopper", "player_one")).toBe(await playerTag(testEnv, "sky-hopper", "player_one"));
    expect(await chatGroupId(testEnv, "sky-hopper", "adults")).toMatch(/^chat_group_[0-9a-f]{20}$/);
  });

  it("replacing the player tag key changes no chat group", async () => {
    const other = { ...testEnv, PLAYER_TAG_KEY: newKey() };
    expect(await chatGroupId(other, "sky-hopper", "adults")).toBe(await chatGroupId(testEnv, "sky-hopper", "adults"));
    expect(await playerTag(other, "sky-hopper", "player_one")).not.toBe(await playerTag(testEnv, "sky-hopper", "player_one"));
  });
});
