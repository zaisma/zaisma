import { describe, expect, it } from "vitest";
import { verifyJwt } from "../../apps/site/src/access.ts";

const TEAM = "zaisma.cloudflareaccess.com";

async function setup() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid: "k1" };
  const b64u = (b: Uint8Array | string) =>
    btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sign = async (claims: object, kid = "k1") => {
    const head = b64u(JSON.stringify({ alg: "RS256", kid }));
    const body = b64u(JSON.stringify(claims));
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${body}`)));
    return `${head}.${body}.${b64u(sig)}`;
  };
  return { keys: [jwk], sign };
}

const good = () => ({ aud: ["aud1"], iss: `https://${TEAM}`, exp: Date.now() / 1000 + 600, email: "julius@example.com" });

describe("Cloudflare Access tokens", () => {
  it("accepts a valid token", async () => {
    const { keys, sign } = await setup();
    expect((await verifyJwt(await sign(good()), TEAM, "aud1", keys))?.email).toBe("julius@example.com");
  });

  it("refuses wrong audience, issuer, expiry or key", async () => {
    const { keys, sign } = await setup();
    expect(await verifyJwt(await sign({ ...good(), aud: ["other"] }), TEAM, "aud1", keys)).toBeNull();
    expect(await verifyJwt(await sign({ ...good(), iss: "https://evil.cloudflareaccess.com" }), TEAM, "aud1", keys)).toBeNull();
    expect(await verifyJwt(await sign({ ...good(), exp: Date.now() / 1000 - 1 }), TEAM, "aud1", keys)).toBeNull();
    expect(await verifyJwt(await sign(good(), "k2"), TEAM, "aud1", keys)).toBeNull();
    const other = await setup();
    expect(await verifyJwt(await other.sign(good()), TEAM, "aud1", keys)).toBeNull();
  });
});
