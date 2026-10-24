import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiptError, generateSigningKey, loadSigningKey, verifyReceipt } from "@zaisma/game-server/internal";
import type { Env } from "../../apps/rooms/src/index.ts";
import { publishedReceiptKeys, receiptPublicKeys, signingKey } from "../../apps/rooms/src/signing.ts";
import { signTestReceipt } from "../helpers.ts";

// The keys the rooms Worker publishes (apps/rooms/src/signing.ts): the pass key at /.well-known/jwks.json, and the receipt key and every retired receipt key at /.well-known/receipt-jwks.json.

const e = env as unknown as Env;
const ISSUER = "https://rooms.zaisma.test";

/** A retired receipt key: its secret (to sign with) and the public JWK a developer would list in RETIRED_RECEIPT_PUBLIC_KEYS. */
async function retiredKey() {
  const secret = await generateSigningKey();
  const signing = await loadSigningKey(secret);
  return { secret, signing, publicKey: signing.publicKey };
}

describe("published keys", () => {
  const original = { receiptKey: e.RECEIPT_SIGNING_KEY, retired: e.RETIRED_RECEIPT_PUBLIC_KEYS };
  afterEach(() => {
    e.RECEIPT_SIGNING_KEY = original.receiptKey;
    e.RETIRED_RECEIPT_PUBLIC_KEYS = original.retired;
    vi.restoreAllMocks();
  });
  const passKeys = () => SELF.fetch(`${ISSUER}/.well-known/jwks.json`);
  const receiptKeys = () => SELF.fetch(`${ISSUER}/.well-known/receipt-jwks.json`);

  it("put the pass key alone at jwks.json, with no private part", async () => {
    const retired = await retiredKey();
    e.RETIRED_RECEIPT_PUBLIC_KEYS = JSON.stringify([retired.publicKey]);
    const response = await passKeys();
    const body = await response.json<{ keys: { kid: string }[] }>();
    expect(body.keys.map((key) => key.kid)).toEqual([(await signingKey(e)).publicKey.kid]);
    for (const key of body.keys) expect(key).not.toHaveProperty("d");
  });

  it("put the current receipt key and each retired one at receipt-jwks.json, in that order", async () => {
    const retired = await retiredKey();
    const receiptKeyId = (await loadSigningKey(e.RECEIPT_SIGNING_KEY!)).publicKey.kid;
    expect((await publishedReceiptKeys({ ...e, RETIRED_RECEIPT_PUBLIC_KEYS: JSON.stringify([retired.publicKey]) })).map((key) => key.kid)).toEqual([receiptKeyId, retired.publicKey.kid]);
    e.RETIRED_RECEIPT_PUBLIC_KEYS = JSON.stringify([retired.publicKey]);
    const response = await receiptKeys();
    expect(response.status).toBe(200);
    const body = await response.json<{ keys: { kid: string }[] }>();
    expect(body.keys.map((key) => key.kid)).toEqual([receiptKeyId, retired.publicKey.kid]);
    expect(JSON.stringify(body)).not.toContain('"d"');
  });

  it("let a receipt signed with a retired key verify, as long as it's listed", async () => {
    const retired = await retiredKey();
    const receipt = await signTestReceipt(retired.signing, "arena", ISSUER);
    const expectation = { gameSlug: "arena", issuerUrl: `${ISSUER}/receipts` };
    const withRetired = await receiptPublicKeys({ ...e, RETIRED_RECEIPT_PUBLIC_KEYS: JSON.stringify([retired.publicKey]) });
    expect(await verifyReceipt(receipt, withRetired, expectation)).toMatchObject({ aud: "arena", purchase_status: "completed" });
    const without = await verifyReceipt(receipt, await receiptPublicKeys({ ...e, RETIRED_RECEIPT_PUBLIC_KEYS: "[]" }), expectation).catch((thrown: unknown) => thrown);
    expect(without).toBeInstanceOf(ReceiptError);
    expect(without).toMatchObject({ code: "unknown_key" });
    // Still checkable with only retired keys where no current key is set.
    expect(await receiptPublicKeys({ RETIRED_RECEIPT_PUBLIC_KEYS: JSON.stringify([retired.publicKey]) })).toEqual([retired.publicKey]);
  });

  it("answer 503 receipts_unavailable at receipt-jwks.json where the receipt settings don't load, and keep publishing the pass key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const retired = await retiredKey();
    const withBadSetting = async (settings: { receiptKey?: string | undefined; retired?: string }) => {
      e.RECEIPT_SIGNING_KEY = "receiptKey" in settings ? settings.receiptKey : original.receiptKey;
      e.RETIRED_RECEIPT_PUBLIC_KEYS = settings.retired;
      const response = await receiptKeys();
      return { httpStatus: response.status, body: await response.json<any>() };
    };
    const unavailable = { httpStatus: 503, body: { error: { code: "receipts_unavailable", message: expect.any(String) } } };
    // No current receipt key, even with retired keys listed (the keys alone would hide a missing signing key).
    expect(await withBadSetting({ receiptKey: undefined, retired: JSON.stringify([retired.publicKey]) })).toMatchObject(unavailable);
    // A list that isn't a list, isn't JSON, or holds something that isn't an Ed25519 public JWK with a kid.
    expect(await withBadSetting({ retired: JSON.stringify({ kid: "bare" }) })).toMatchObject(unavailable);
    expect(await withBadSetting({ retired: "not json" })).toMatchObject(unavailable);
    expect(await withBadSetting({ retired: JSON.stringify([{ kty: "OKP", crv: "Ed25519", x: retired.publicKey.x }]) })).toMatchObject(unavailable);
    expect(await withBadSetting({ retired: JSON.stringify([null]) })).toMatchObject(unavailable);
    expect(error).toHaveBeenCalled();
    expect((await passKeys()).status).toBe(200);
  });

  it("cut a retired key down to its public fields, so a private part pasted in by mistake is never published", async () => {
    const retired = await retiredKey();
    const privatePart: string = JSON.parse(retired.secret).d;
    const withPrivatePart = { ...retired.publicKey, d: privatePart, extra: "x" };
    const [, published] = await publishedReceiptKeys({ ...e, RETIRED_RECEIPT_PUBLIC_KEYS: JSON.stringify([withPrivatePart]) });
    expect(published).toEqual(retired.publicKey);
    expect(published).not.toHaveProperty("d");
    e.RETIRED_RECEIPT_PUBLIC_KEYS = JSON.stringify([withPrivatePart]);
    expect(await (await receiptKeys()).text()).not.toContain(privatePart);
  });
});
