import { describe, expect, it } from "vitest";
import { PassError, generateSigningKey, guestName, isRoomCode, jwks, loadSigningKey, roomCode, signPass, verifyPass, type PassClaims } from "../../packages/game-server/src/index.ts";

const ISS = "https://rooms.zaisma.test";

async function setup() {
  const signing = await loadSigningKey(await generateSigningKey());
  const now = Math.floor(Date.now() / 1000);
  const claims: PassClaims = { sub: "p1", name: "Swift Fox 42", aud: "arena", iss: ISS, kind: "guest", iat: now, exp: now + 3600 };
  return { signing, claims, keys: jwks([signing.publicKey]).keys };
}

describe("player passes", () => {
  it("signs a pass that checks out", async () => {
    const { signing, claims, keys } = await setup();
    const token = await signPass(signing, claims);
    expect(await verifyPass(token, keys, { game: "arena", issuer: ISS })).toMatchObject({ sub: "p1", name: "Swift Fox 42" });
  });

  it("publishes only the public half of the key", async () => {
    const { keys } = await setup();
    expect(keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" });
    expect(keys[0]).not.toHaveProperty("d");
  });

  it("rejects expired, wrong-game, wrong-issuer and tampered passes", async () => {
    const { signing, claims, keys } = await setup();
    const reason = async (token: string, game = "arena") => verifyPass(token, keys, { game, issuer: ISS }).then(() => "ok", (e: PassError) => e.code);

    expect(await reason(await signPass(signing, { ...claims, exp: claims.iat - 1 }))).toBe("expired");
    expect(await reason(await signPass(signing, claims), "other-game")).toBe("wrong-game");
    expect(await reason(await signPass(signing, { ...claims, iss: "https://evil.example" }))).toBe("wrong-issuer");

    const [h, , s] = (await signPass(signing, claims)).split(".");
    const forged = btoa(JSON.stringify({ ...claims, name: "Admin" })).replace(/=+$/, "");
    expect(await reason(`${h}.${forged}.${s}`)).toBe("bad-signature");
    expect(await reason("not-a-pass")).toBe("malformed");

    const other = await loadSigningKey(await generateSigningKey());
    expect(await reason(await signPass(other, claims))).toBe("unknown-key");
  });
});

describe("names and codes", () => {
  it("makes guest names and readable room codes", () => {
    expect(guestName()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
    for (let i = 0; i < 50; i++) expect(isRoomCode(roomCode())).toBe(true);
    expect(isRoomCode("ABC10O")).toBe(false);
  });
});
