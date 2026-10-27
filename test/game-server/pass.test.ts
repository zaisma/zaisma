import { describe, expect, it } from "vitest";
import { PassError, REQUEST_LIMITS, readRequestBody, passesAreFriends, canChat, generateSigningKey, passesHaveBlockBetween, guestName, isRoomCode, jwks, loadSigningKey, roomCode, signPass, verifyPass, PASS_ISSUER_URL, PASS_TOKEN_TYPE, PASS_VERSION_NUMBER, type PassClaims, type WhoCanChat } from "../../packages/game-server/src/internal.ts";

const ISS = "https://rooms.zaisma.test";

async function setup() {
  const signing = await loadSigningKey(await generateSigningKey());
  const now = Math.floor(Date.now() / 1000);
  const claims: PassClaims = { sub: "p1", name: "Swift Fox 42", aud: "arena", iss: ISS, pass_version_number: 1, kind: "guest", owned_item_names: [], iat: now, exp: now + 3600 };
  return { signing, claims, keys: jwks([signing.publicKey]).keys };
}

describe("player passes", () => {
  it("signs a pass that checks out", async () => {
    const { signing, claims, keys } = await setup();
    const token = await signPass(signing, claims);
    expect(await verifyPass(token, keys, { gameSlug: "arena", issuerUrl: ISS })).toMatchObject({ sub: "p1", name: "Swift Fox 42" });
  });

  it("an account's pass is proof only: its ID, the game and when it expires, with no name", async () => {
    const { signing, claims, keys } = await setup();
    const { name: _, ...accountClaims } = { ...claims, sub: "player_8f3k2m", kind: "account" as const };
    const checked = await verifyPass(await signPass(signing, accountClaims), keys, { gameSlug: "arena", issuerUrl: ISS });
    expect(checked).toMatchObject({ sub: "player_8f3k2m", kind: "account", aud: "arena" });
    expect(checked).not.toHaveProperty("name");
    // A guest's pass carries its name. A kind added later still checks out, and never chats.
    const reason = async (token: string) => verifyPass(token, keys, { gameSlug: "arena", issuerUrl: ISS }).then(() => "ok", (error: PassError) => error.code);
    expect(await reason(await signPass(signing, { ...claims, name: undefined }))).toBe("malformed");
    const later = await verifyPass(await signPass(signing, { ...accountClaims, kind: "studio" }), keys, { gameSlug: "arena", issuerUrl: ISS });
    expect(later.kind).toBe("studio");
    expect(canChat({ ...later, who_can_chat: "anyone", chat_group_id: "chat_group_a" }, { ...later, sub: "player_other", who_can_chat: "anyone", chat_group_id: "chat_group_a" })).toBe(false);
  });

  it("publishes only the public half of the key", async () => {
    const { keys } = await setup();
    expect(keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" });
    expect(keys[0]).not.toHaveProperty("d");
  });

  it("rejects expired, wrong-game, wrong-issuer and tampered passes", async () => {
    const { signing, claims, keys } = await setup();
    const reason = async (token: string, game = "arena") => verifyPass(token, keys, { gameSlug: game, issuerUrl: ISS }).then(() => "ok", (e: PassError) => e.code);

    expect(await reason(await signPass(signing, { ...claims, exp: claims.iat - 1 }))).toBe("expired");
    expect(await reason(await signPass(signing, claims), "other-game")).toBe("wrong_game");
    expect(await reason(await signPass(signing, { ...claims, iss: "https://evil.example" }))).toBe("wrong_issuer");

    const [h, , s] = (await signPass(signing, claims)).split(".");
    const forged = btoa(JSON.stringify({ ...claims, name: "Admin" })).replace(/=+$/, "");
    expect(await reason(`${h}.${forged}.${s}`)).toBe("bad_signature");
    expect(await reason("not-a-pass")).toBe("malformed");

    const other = await loadSigningKey(await generateSigningKey());
    expect(await reason(await signPass(other, claims))).toBe("unknown_key");
  });

  it("is a v1 pass: typ pass+jwt and pass_version_number 1, from Zaisma's issuer unless the server says otherwise", async () => {
    const { signing, claims, keys } = await setup();
    const reason = async (token: string) => verifyPass(token, keys, { gameSlug: "arena", issuerUrl: ISS }).then(() => "ok", (e: PassError) => e.code);
    const token = await signPass(signing, claims);
    expect(JSON.parse(atob(token.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/")))).toMatchObject({ alg: "EdDSA", typ: PASS_TOKEN_TYPE });
    expect(PASS_VERSION_NUMBER).toBe(1);

    // Any other JWT signed with the same key, even with a pass's claims, isn't a pass.
    const signedAs = async (typ: string) => {
      const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
      const unsigned = `${encode({ alg: "EdDSA", typ, kid: signing.publicKey.kid })}.${encode(claims)}`;
      const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, signing.key, new TextEncoder().encode(unsigned)));
      return `${unsigned}.${btoa(String.fromCharCode(...signature)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
    };
    expect(await reason(await signedAs("JWT"))).toBe("wrong_kind");
    expect(await reason(await signedAs(PASS_TOKEN_TYPE))).toBe("ok");
    // A pass from another version of the format is refused, never read as this one.
    expect(await reason(await signPass(signing, { ...claims, pass_version_number: 2 }))).toBe("wrong_version");
    expect(await reason(await signPass(signing, { ...claims, pass_version_number: undefined as never }))).toBe("wrong_version");

    // With no issuerUrl, only Zaisma's own passes check out.
    const zaismas = await signPass(signing, { ...claims, iss: PASS_ISSUER_URL });
    expect(await verifyPass(zaismas, keys, { gameSlug: "arena" })).toMatchObject({ iss: "https://rooms.zaisma.com" });
    expect(await verifyPass(token, keys, { gameSlug: "arena" }).catch((e: PassError) => e.code)).toBe("wrong_issuer");
  });

  it("refuses anything but two passes in its helpers, with a TypeError", async () => {
    const { claims } = await setup();
    for (const check of [canChat, passesAreFriends, passesHaveBlockBetween]) {
      expect(() => check("eyJ..." as never, claims)).toThrow(TypeError);
      expect(() => check(claims, null as never)).toThrow(TypeError);
    }
  });

  it("carries an account's friends as opaque tags, and passesAreFriends and canChat need both passes to say so", async () => {
    const { signing, claims, keys } = await setup();
    const reason = async (token: string) => verifyPass(token, keys, { gameSlug: "arena", issuerUrl: ISS }).then(() => "ok", (error: PassError) => error.code);
    // Each player's tag in this game, and their friends' tags: never their player IDs.
    const tag = (sub: string) => `player_tag_${sub.slice("player_".length)}`;
    const account = (sub: string, whoCanChat: WhoCanChat, friendPlayerIds: string[]): PassClaims => ({ ...claims, name: undefined, sub, kind: "account", who_can_chat: whoCanChat, chat_group_id: "chat_group_a", player_tag_id: tag(sub), friend_player_tag_ids: friendPlayerIds.map(tag) });
    expect(await reason(await signPass(signing, account("player_ana", "friends", ["player_ben"])))).toBe("ok");
    expect(await reason(await signPass(signing, { ...account("player_ana", "friends", []), friend_player_tag_ids: "player_tag_ben" as never }))).toBe("malformed");
    expect(await reason(await signPass(signing, { ...account("player_ana", "friends", []), friend_player_tag_ids: [7] as never }))).toBe("malformed");

    const ana = account("player_ana", "friends", ["player_ben", "player_cy"]);
    const ben = account("player_ben", "friends", ["player_ana"]);
    // Cy removed Ana: Cy's new pass no longer lists her, so Ana's older one isn't enough.
    const cy = account("player_cy", "anyone", []);
    const soloFriend = account("player_dee", "nobody", ["player_ana"]);
    expect(passesAreFriends(ana, ben)).toBe(true);
    expect(passesAreFriends(ben, ana)).toBe(true);
    expect(passesAreFriends(ana, cy)).toBe(false);
    expect(passesAreFriends(ana, { ...ana })).toBe(false);
    // A guest's pass is never anyone's friend, even with a tag it shouldn't have.
    expect(passesAreFriends(ana, { ...claims, sub: "player_ben", player_tag_id: tag("player_ben"), friend_player_tag_ids: [tag("player_ana")] })).toBe(false);
    expect(canChat(ana, ben)).toBe(true);
    expect(canChat(ben, ana)).toBe(true);
    expect(canChat(ana, cy)).toBe(false);
    expect(canChat({ ...ana, friend_player_tag_ids: [...ana.friend_player_tag_ids!, tag("player_dee")] }, soloFriend)).toBe(false);
    // Chat never leaves a chat group, friends included (Oct 26, 2026): friends a 14 and a 16 pass, or an adult and a teen, don't chat.
    expect(canChat({ ...ben, chat_group_id: "chat_group_b" }, ana)).toBe(false);
    expect(canChat({ ...ben, who_can_chat: "anyone", chat_group_id: "chat_group_a" }, { ...ana, who_can_chat: "anyone", chat_group_id: "chat_group_b" })).toBe(false);
    expect(canChat({ ...ben, chat_group_id: undefined }, ana)).toBe(false);
    // Strangers who both let anyone chat, in the same group.
    expect(canChat({ ...cy, chat_group_id: "chat_group_a" }, { ...account("player_eve", "anyone", []), chat_group_id: "chat_group_a" })).toBe(true);
    // A guest named in a list is still a guest.
    expect(canChat(ana, { ...claims, sub: "player_ben" })).toBe(false);
    // Anyone on one side and friends on the other: friends only.
    expect(canChat({ ...cy, chat_group_id: "chat_group_a" }, { ...account("player_fay", "friends", []), chat_group_id: "chat_group_a" })).toBe(false);
    // A who_can_chat added later still checks out, and chats with nobody.
    const later = await verifyPass(await signPass(signing, { ...ana, who_can_chat: "classmates" }), keys, { gameSlug: "arena", issuerUrl: ISS });
    expect(later.who_can_chat).toBe("classmates");
    expect(canChat(later, ben)).toBe(false);
    expect(await reason(await signPass(signing, { ...ana, who_can_chat: 3 as never }))).toBe("malformed");
  });

  it("carries blocks as opaque tags, and either pass is enough to find one, from either side", async () => {
    const { signing, claims, keys } = await setup();
    const reason = async (token: string) => verifyPass(token, keys, { gameSlug: "arena", issuerUrl: ISS }).then(() => "ok", (error: PassError) => error.code);
    const account = (sub: string, playerTag: string, blockTagIds: string[], friendTagIds: string[] = []): PassClaims => ({
      ...claims,
      name: undefined,
      sub,
      kind: "account",
      who_can_chat: "friends",
      chat_group_id: "chat_group_a",
      player_tag_id: playerTag,
      friend_player_tag_ids: friendTagIds,
      block_player_tag_ids: blockTagIds,
    });
    expect(await reason(await signPass(signing, account("player_ana", "block_tag_a", ["block_tag_b"])))).toBe("ok");
    expect(await reason(await signPass(signing, { ...account("player_ana", "block_tag_a", []), player_tag_id: 7 as never }))).toBe("malformed");
    expect(await reason(await signPass(signing, { ...account("player_ana", "block_tag_a", []), block_player_tag_ids: "block_tag_b" as never }))).toBe("malformed");

    // Ana blocked Ben: both passes say so, and neither says who made it.
    const ana = account("player_ana", "block_tag_a", ["block_tag_b"], ["block_tag_b"]);
    const ben = account("player_ben", "block_tag_b", ["block_tag_a"], ["block_tag_a"]);
    expect(passesHaveBlockBetween(ana, ben)).toBe(true);
    expect(passesHaveBlockBetween(ben, ana)).toBe(true);
    // Ben's pass is from before the block (or past its newest 100): Ana's alone is enough.
    const oldBen = { ...ben, block_player_tag_ids: [] };
    expect(passesHaveBlockBetween(ana, oldBen)).toBe(true);
    expect(passesHaveBlockBetween(oldBen, ana)).toBe(true);
    // A block keeps chat apart even between friends whose older passes still list each other.
    expect(canChat(ana, ben)).toBe(false);
    expect(canChat({ ...ana, block_player_tag_ids: [] }, oldBen)).toBe(true);
    // No block, guests, and the same player.
    const cy = account("player_cy", "block_tag_c", []);
    expect(passesHaveBlockBetween(ana, cy)).toBe(false);
    expect(passesHaveBlockBetween(ana, claims)).toBe(false);
    expect(passesHaveBlockBetween(ana, { ...ana })).toBe(false);
  });
});

describe("owned items in a pass", () => {
  it("an account's pass carries the items it owns, as a list of names", async () => {
    const { signing, claims, keys } = await setup();
    const { name: _, ...accountClaims } = { ...claims, kind: "account" as const, owned_item_names: ["gold_crown"] };
    expect((await verifyPass(await signPass(signing, accountClaims), keys, { gameSlug: "arena", issuerUrl: ISS })).owned_item_names).toEqual(["gold_crown"]);
    const bad = await verifyPass(await signPass(signing, { ...accountClaims, owned_item_names: "gold_crown" as never }), keys, { gameSlug: "arena", issuerUrl: ISS }).then(() => "ok", (error: PassError) => error.code);
    expect(bad).toBe("malformed");
  });

  it("are always a list: a pass made without them owns nothing", async () => {
    const { signing, claims, keys } = await setup();
    const { owned_item_names: _, ...withoutItems } = claims;
    expect((await verifyPass(await signPass(signing, withoutItems), keys, { gameSlug: "arena", issuerUrl: ISS })).owned_item_names).toEqual([]);
  });
});

describe("names and codes", () => {
  it("makes guest names and readable room codes", () => {
    expect(guestName()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
    for (let i = 0; i < 50; i++) expect(isRoomCode(roomCode())).toBe(true);
    expect(isRoomCode("ABC10O")).toBe(false);
  });
});

describe("the fullest pass Zaisma makes", () => {
  it("fits the pass size both runtimes take with a request, with room to spare", async () => {
    const { signing } = await setup();
    const now = Math.floor(Date.now() / 1000);
    const tag = (i: number) => `player_tag_${i.toString(16).padStart(20, "0")}`;
    // Every one of a game's 1,000 items with a 40-character name, 200 friends and 100 blocks, for a 40-character slug.
    const fullest = await signPass(signing, {
      sub: "player_0123456789abcdefghij",
      aud: "a".repeat(40),
      iss: "https://rooms.zaisma.com",
      pass_version_number: 1,
      kind: "account",
      who_can_chat: "anyone",
      chat_group_id: "chat_group_0123456789abcdef0123",
      player_tag_id: tag(0),
      friend_player_tag_ids: Array.from({ length: 200 }, (_, i) => tag(i + 1)),
      block_player_tag_ids: Array.from({ length: 100 }, (_, i) => tag(i + 500)),
      owned_item_names: Array.from({ length: 1000 }, (_, i) => `skin_${String(i).padStart(4, "0")}_`.padEnd(40, "x")),
      iat: now,
      exp: now + 86400,
    });
    expect(fullest.length).toBeLessThan(REQUEST_LIMITS.maximumPassSizeBytes * 0.8);
    expect(readRequestBody(JSON.stringify({ pass: fullest, request: { type: "wardrobe" } }))).toEqual({ pass: fullest, request: { type: "wardrobe" } });
  });
});
