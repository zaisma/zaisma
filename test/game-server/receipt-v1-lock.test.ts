import { describe, expect, it } from "vitest";
import { signReceipt } from "../../packages/core/src/receipts.ts";
import { ReceiptError, generateSigningKey, loadSigningKey, signPass, verifyPass, verifyReceipt, type PublicKey, type ReceiptClaims } from "../../packages/game-server/src/index.ts";

// The receipt contract games depend on from v1: a receipt signed today keeps verifying, to the same claims, in
// every later copy of verifyReceipt, and v1 receipts only gain things. Change this file only to add to it.

/** A v1 receipt, signed Oct 23, 2026 with a throwaway key made for this test (never a Zaisma key). */
const V1_KEY: PublicKey = { kty: "OKP", crv: "Ed25519", x: "MD-Gwz1SQo-LGb12LdCGw-pzle2f2_rz_cPZRm3GbeM", kid: "MsCTmV9nMAyvWkje", alg: "EdDSA", use: "sig" } as PublicKey;
const V1_RECEIPT =
  "eyJhbGciOiJFZERTQSIsInR5cCI6InJlY2VpcHQrand0Iiwia2lkIjoiTXNDVG1WOW5NQXl2V2tqZSJ9.eyJzdWIiOiJwbGF5ZXJfOGYzazJtOXExeDdjNHY2YjBuNXoiLCJhdWQiOiJza3ktaG9wcGVyIiwiaXNzIjoiaHR0cHM6Ly9yb29tcy56YWlzbWEuY29tL3JlY2VpcHRzIiwianRpIjoicHVyY2hhc2VfOGYzazJtOXExeDdjNHY2YjBuNXoiLCJyZWNlaXB0X3ZlcnNpb25fbnVtYmVyIjoxLCJwdXJjaGFzZV9pZCI6InB1cmNoYXNlXzhmM2sybTlxMXg3YzR2NmIwbjV6IiwicHVyY2hhc2VkX2F0IjoiMjAyNi0xMC0yM1QxODowMDowMC4wMDBaIiwicHVyY2hhc2Vfc3RhdHVzIjoiY29tcGxldGVkIiwiaXRlbV9uYW1lIjoiZXhwYW5zaW9uX25vcnRoIiwiaXRlbV9raW5kIjoicGVybWFuZW50IiwiaXRlbV9jb3VudCI6MSwicHVyY2hhc2Vfc291cmNlIjoic2FsZSIsInBhaWRfbWlub3JfdW5pdHMiOjE5OTksImN1cnJlbmN5X2NvZGUiOiJ1c2QiLCJnYW1lX2FjY291bnRfaWQiOiJwYS00ODIxMyIsImlhdCI6MTc5Mjc3ODQwMH0.egZDYVi1PuF2UvCj0BjDijY0iHnNDsPTy_oVAXmsagMGkcZFWrvm0MBJNowYspFBXq2ety_4_PeHb818wQ1YCA";
const V1_CLAIMS = {
  sub: "player_8f3k2m9q1x7c4v6b0n5z",
  aud: "sky-hopper",
  iss: "https://rooms.zaisma.com/receipts",
  jti: "purchase_8f3k2m9q1x7c4v6b0n5z",
  receipt_version_number: 1,
  purchase_id: "purchase_8f3k2m9q1x7c4v6b0n5z",
  purchased_at: "2026-10-23T18:00:00.000Z",
  purchase_status: "completed",
  item_name: "expansion_north",
  item_kind: "permanent",
  item_count: 1,
  purchase_source: "sale",
  paid_minor_units: 1999,
  currency_code: "usd",
  game_account_id: "pa-48213",
  iat: 1792778400,
};
const EXPECT = { game: "sky-hopper", issuer: "https://rooms.zaisma.com/receipts" };

async function signer() {
  const signing = await loadSigningKey(await generateSigningKey());
  const sign = (overrides: Record<string, unknown> = {}) => signReceipt(signing, { ...V1_CLAIMS, ...overrides } as ReceiptClaims);
  return { signing, sign, keys: [signing.publicKey] };
}
const reason = (answer: Promise<unknown>) => answer.then(() => "ok", (error: ReceiptError) => (error instanceof ReceiptError ? error.code : String(error)));

describe("a v1 receipt", () => {
  it("signed on Oct 23, 2026 still verifies, to every claim it had, years later", async () => {
    expect(await verifyReceipt(V1_RECEIPT, [V1_KEY], { ...EXPECT, nowMs: Date.UTC(2036, 0, 1) })).toEqual(V1_CLAIMS);
  });

  it("says it's a receipt in its header, so no JWT library takes it for a pass", () => {
    expect(JSON.parse(atob(V1_RECEIPT.split(".")[0]!))).toEqual({ alg: "EdDSA", typ: "receipt+jwt", kid: "MsCTmV9nMAyvWkje" });
  });

  it("still verifies with claims added after v1, and with item kinds, sources and statuses v1 never had", async () => {
    const { sign, keys } = await signer();
    const grown = await sign({ item_kind: "season_pass", purchase_source: "gift", purchase_status: "disputed", bundle_item_names: ["a", "b"] });
    expect(await verifyReceipt(grown, keys, EXPECT)).toMatchObject({ item_kind: "season_pass", purchase_source: "gift", purchase_status: "disputed", bundle_item_names: ["a", "b"] });
  });

  it("says when its purchase was refunded or charged back", async () => {
    const { sign, keys } = await signer();
    expect(await verifyReceipt(await sign({ purchase_status: "refunded" }), keys, EXPECT)).toMatchObject({ purchase_status: "refunded" });
    expect(await verifyReceipt(await sign({ purchase_status: "charged_back" }), keys, EXPECT)).toMatchObject({ purchase_status: "charged_back" });
  });

  it("is refused, with a code for each reason, when it isn't one this copy can read", async () => {
    const { signing, sign, keys } = await signer();
    expect(await reason(verifyReceipt(await sign({ receipt_version_number: 2 }), keys, EXPECT))).toBe("wrong_version");
    expect(await reason(verifyReceipt(await sign({ exp: 1 }), keys, EXPECT))).toBe("expired");
    expect(await reason(verifyReceipt(await sign(), keys, { ...EXPECT, game: "moon-base" }))).toBe("wrong_game");
    expect(await reason(verifyReceipt(await sign(), keys, { ...EXPECT, issuer: "https://rooms.zaisma.com" }))).toBe("wrong_issuer");
    expect(await reason(verifyReceipt(await sign(), [V1_KEY], EXPECT))).toBe("unknown_key");
    expect(await reason(verifyReceipt(await sign({ item_count: "1" }), keys, EXPECT))).toBe("malformed");
    expect(await reason(verifyReceipt(await sign({ purchase_id: "" }), keys, EXPECT))).toBe("malformed");
    const pass = await signPass(signing, { sub: "player_8f3k2m9q1x7c4v6b0n5z", aud: "sky-hopper", iss: EXPECT.issuer, kind: "account", iat: 1, exp: 4102444800 });
    expect(await reason(verifyReceipt(pass, keys, EXPECT))).toBe("wrong_kind");
    expect(await reason(verifyReceipt("not.a.receipt", keys, EXPECT))).toBe("malformed");
  });

  it("never stands in for a pass", async () => {
    const { sign, keys } = await signer();
    const asPass = verifyPass(await sign({ iss: "https://rooms.zaisma.com", kind: "account", exp: 4102444800 }), keys, { game: "sky-hopper", issuer: "https://rooms.zaisma.com" });
    expect(await asPass.then(() => "ok", (error: { code: string }) => error.code)).toBe("wrong_kind");
  });

  it("is refused as a ReceiptError that says so", async () => {
    const error = await verifyReceipt(V1_RECEIPT, [V1_KEY], { ...EXPECT, game: "moon-base" }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ReceiptError);
    expect(error).toMatchObject({ name: "ReceiptError", code: "wrong_game", message: "Receipt rejected: wrong_game" });
  });
});
