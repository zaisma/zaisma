import { describe, expect, it } from "vitest";
import * as gameServer from "../../packages/game-server/src/index.ts";
import { canChat, passesAreFriends, passesHaveBlockBetween, verifyPass, type PassError, type PublicKey } from "../../packages/game-server/src/index.ts";
import { lockSurface } from "./surface.ts";

/**
 * Player passes, v1: the claims a game's own server reads, how it checks them, and the helpers that
 * answer friends, chat and blocks from two passes (the behavior is test/game-server/pass.test.ts).
 */
describe("player passes v1", () => {
  lockSurface("pass", "packages/game-server/src/pass.ts", [
    "PassClaims",
    "PlayerKind",
    "WhoCanChat",
    "PassErrorCode",
    "PassExpectations",
    "PublicKey",
    "PASS_TOKEN_TYPE",
    "PASS_VERSION_NUMBER",
    "PASS_ISSUER_URL",
    "verifyPass",
    "canChat",
    "passesAreFriends",
    "passesHaveBlockBetween",
  ]);

  // A v1 account pass, signed once and kept as it was sent, with the public half of the key that signed it.
  const KEY: PublicKey = { kty: "OKP", crv: "Ed25519", x: "kAPTXGyTuhpkrW4M_Jm_sXf5znspAP3T-K7tSECZ0Pg", kid: "MmndAuBXzK0cIuWW", alg: "EdDSA", use: "sig" };
  const PASS =
    "eyJhbGciOiJFZERTQSIsInR5cCI6InBhc3Mrand0Iiwia2lkIjoiTW1uZEF1Qlh6SzBjSXVXVyJ9.eyJzdWIiOiJwbGF5ZXJfN2gyazltNHEiLCJhdWQiOiJza3ktaG9wcGVyIiwiaXNzIjoiaHR0cHM6Ly9yb29tcy56YWlzbWEuY29tIiwicGFzc192ZXJzaW9uX251bWJlciI6MSwia2luZCI6ImFjY291bnQiLCJ3aG9fY2FuX2NoYXQiOiJhbnlvbmUiLCJjaGF0X2dyb3VwX2lkIjoiY2hhdF9ncm91cF8zbjh4Mms1diIsInBsYXllcl90YWdfaWQiOiJwbGF5ZXJfdGFnXzljNG0xcTd6IiwiZnJpZW5kX3BsYXllcl90YWdfaWRzIjpbInBsYXllcl90YWdfMmI2djhuMHgiXSwiYmxvY2tfcGxheWVyX3RhZ19pZHMiOlsicGxheWVyX3RhZ181azFqM2g3ZyJdLCJpYXQiOjE3OTI4MDAwMDAsImV4cCI6MTc5MjgwMzYwMH0.1e9-JlMiszBPX7I6f2-Ie2z2xzuXO6JE_6Zrwdycd6eKkmf6Kk_CCSVTXHc0S7dS_5h7rc-H242CyrVgOcrZBw";
  const CHECKED_AT_MS = 1792801000_000;

  it("takes a v1 pass as it was signed, with every claim as sent", async () => {
    const claims = await verifyPass(PASS, [KEY], { gameSlug: "sky-hopper", nowMs: CHECKED_AT_MS });
    expect(claims).toEqual({
      sub: "player_7h2k9m4q",
      aud: "sky-hopper",
      iss: "https://rooms.zaisma.com",
      pass_version_number: 1,
      kind: "account",
      who_can_chat: "anyone",
      chat_group_id: "chat_group_3n8x2k5v",
      player_tag_id: "player_tag_9c4m1q7z",
      friend_player_tag_ids: ["player_tag_2b6v8n0x"],
      block_player_tag_ids: ["player_tag_5k1j3h7g"],
      iat: 1792800000,
      exp: 1792803600,
    });
    // The helpers read those claims as v1 says: a friend's pass lists this one's tag back, a block either way is enough.
    const friend = { ...claims, sub: "player_2b6v8n0x", player_tag_id: "player_tag_2b6v8n0x", friend_player_tag_ids: ["player_tag_9c4m1q7z"], block_player_tag_ids: [] };
    const blocked = { ...claims, sub: "player_5k1j3h7g", player_tag_id: "player_tag_5k1j3h7g", friend_player_tag_ids: [], block_player_tag_ids: [] };
    expect(passesAreFriends(claims, friend)).toBe(true);
    expect(canChat(claims, friend)).toBe(true);
    expect(passesHaveBlockBetween(claims, blocked)).toBe(true);
    expect(canChat(claims, blocked)).toBe(false);
  });

  it("refuses with v1's error codes", async () => {
    const codeOf = (token: string, gameSlug = "sky-hopper", nowMs = CHECKED_AT_MS) => verifyPass(token, [KEY], { gameSlug, nowMs }).then(() => null, (error: PassError) => error.code);
    expect(await codeOf(PASS, "other-game")).toBe("wrong_game");
    expect(await codeOf(PASS, "sky-hopper", 1792803601_000)).toBe("expired");
    expect(await codeOf(PASS.slice(0, -4) + "AAAA")).toBe("bad_signature");
    expect(await codeOf("not-a-pass")).toBe("malformed");
    expect(await verifyPass(PASS, [{ ...KEY, kid: "another" }], { gameSlug: "sky-hopper", nowMs: CHECKED_AT_MS }).catch((error: PassError) => error.code)).toBe("unknown_key");
    expect(await verifyPass(PASS, [KEY], { gameSlug: "sky-hopper", issuerUrl: "https://rooms.example.com", nowMs: CHECKED_AT_MS }).catch((error: PassError) => error.code)).toBe("wrong_issuer");
  });

  it("keeps signing out of the package's public entry: that's Zaisma's own", () => {
    expect(Object.keys(gameServer)).toEqual(expect.arrayContaining(["verifyPass", "verifyReceipt", "canChat", "passesAreFriends", "passesHaveBlockBetween", "PassError", "PASS_TOKEN_TYPE", "PASS_VERSION_NUMBER", "PASS_ISSUER_URL"]));
    for (const name of ["signPass", "generateSigningKey", "loadSigningKey", "jwks"]) expect(gameServer).not.toHaveProperty(name);
  });
});
