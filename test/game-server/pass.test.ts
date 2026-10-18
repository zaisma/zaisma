import { describe, expect, it } from "vitest";
import { PassError, areFriends, canChat, generateSigningKey, hasBlockBetween, guestName, isRoomCode, jwks, loadSigningKey, roomCode, signPass, verifyPass, type PassClaims, type WhoCanChat } from "../../packages/game-server/src/index.ts";

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

  it("an account's pass is proof only: its ID, the game and when it expires, with no name", async () => {
    const { signing, claims, keys } = await setup();
    const { name: _, ...accountClaims } = { ...claims, sub: "player_8f3k2m", kind: "account" as const };
    const checked = await verifyPass(await signPass(signing, accountClaims), keys, { game: "arena", issuer: ISS });
    expect(checked).toMatchObject({ sub: "player_8f3k2m", kind: "account", aud: "arena" });
    expect(checked).not.toHaveProperty("name");
    // A guest's pass carries its name, and a pass of any other kind isn't one.
    const reason = async (token: string) => verifyPass(token, keys, { game: "arena", issuer: ISS }).then(() => "ok", (error: PassError) => error.code);
    expect(await reason(await signPass(signing, { ...claims, name: undefined }))).toBe("malformed");
    expect(await reason(await signPass(signing, { ...claims, kind: "admin" as never }))).toBe("malformed");
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
    expect(await reason(await signPass(signing, claims), "other-game")).toBe("wrong_game");
    expect(await reason(await signPass(signing, { ...claims, iss: "https://evil.example" }))).toBe("wrong_issuer");

    const [h, , s] = (await signPass(signing, claims)).split(".");
    const forged = btoa(JSON.stringify({ ...claims, name: "Admin" })).replace(/=+$/, "");
    expect(await reason(`${h}.${forged}.${s}`)).toBe("bad_signature");
    expect(await reason("not-a-pass")).toBe("malformed");

    const other = await loadSigningKey(await generateSigningKey());
    expect(await reason(await signPass(other, claims))).toBe("unknown_key");
  });

  it("carries an account's friends as opaque tags, and areFriends and canChat need both passes to say so", async () => {
    const { signing, claims, keys } = await setup();
    const reason = async (token: string) => verifyPass(token, keys, { game: "arena", issuer: ISS }).then(() => "ok", (error: PassError) => error.code);
    // Each player's tag in this game, and their friends' tags: never their player IDs.
    const tag = (sub: string) => `player_tag_${sub.slice("player_".length)}`;
    const account = (sub: string, whoCanChat: WhoCanChat, friendPlayerIds: string[]): PassClaims => ({ ...claims, name: undefined, sub, kind: "account", who_can_chat: whoCanChat, player_tag: tag(sub), friend_tag_ids: friendPlayerIds.map(tag) });
    expect(await reason(await signPass(signing, account("player_ana", "friends", ["player_ben"])))).toBe("ok");
    expect(await reason(await signPass(signing, { ...account("player_ana", "friends", []), friend_tag_ids: "player_tag_ben" as never }))).toBe("malformed");
    expect(await reason(await signPass(signing, { ...account("player_ana", "friends", []), friend_tag_ids: [7] as never }))).toBe("malformed");

    const ana = account("player_ana", "friends", ["player_ben", "player_cy"]);
    const ben = account("player_ben", "friends", ["player_ana"]);
    // Cy removed Ana: Cy's new pass no longer lists her, so Ana's older one isn't enough.
    const cy = account("player_cy", "anyone", []);
    const soloFriend = account("player_dee", "nobody", ["player_ana"]);
    expect(areFriends(ana, ben)).toBe(true);
    expect(areFriends(ben, ana)).toBe(true);
    expect(areFriends(ana, cy)).toBe(false);
    expect(areFriends(ana, { ...ana })).toBe(false);
    // A guest's pass is never anyone's friend, even with a tag it shouldn't have.
    expect(areFriends(ana, { ...claims, sub: "player_ben", player_tag: tag("player_ben"), friend_tag_ids: [tag("player_ana")] })).toBe(false);
    expect(canChat(ana, ben)).toBe(true);
    expect(canChat(ben, ana)).toBe(true);
    expect(canChat(ana, cy)).toBe(false);
    expect(canChat({ ...ana, friend_tag_ids: [...ana.friend_tag_ids!, tag("player_dee")] }, soloFriend)).toBe(false);
    // Friends chat across chat groups; strangers who both let anyone chat still need the same group.
    expect(canChat({ ...ben, who_can_chat: "anyone", chat_group: "chat_group_a" }, { ...ana, who_can_chat: "anyone", chat_group: "chat_group_b" })).toBe(true);
    expect(canChat({ ...cy, chat_group: "chat_group_a" }, { ...account("player_eve", "anyone", []), chat_group: "chat_group_a" })).toBe(true);
    // A guest named in a list is still a guest.
    expect(canChat(ana, { ...claims, sub: "player_ben" })).toBe(false);
    // Anyone on one side and friends on the other: friends only.
    expect(canChat({ ...cy, chat_group: "chat_group_a" }, { ...account("player_fay", "friends", []), chat_group: "chat_group_a" })).toBe(false);
    expect(await reason(await signPass(signing, { ...ana, who_can_chat: "open_and_social" as never }))).toBe("malformed");
  });

  it("carries blocks as opaque tags, and either pass is enough to find one, from either side", async () => {
    const { signing, claims, keys } = await setup();
    const reason = async (token: string) => verifyPass(token, keys, { game: "arena", issuer: ISS }).then(() => "ok", (error: PassError) => error.code);
    const account = (sub: string, playerTag: string, blockTagIds: string[], friendTagIds: string[] = []): PassClaims => ({
      ...claims,
      name: undefined,
      sub,
      kind: "account",
      who_can_chat: "friends",
      player_tag: playerTag,
      friend_tag_ids: friendTagIds,
      block_tag_ids: blockTagIds,
    });
    expect(await reason(await signPass(signing, account("player_ana", "block_tag_a", ["block_tag_b"])))).toBe("ok");
    expect(await reason(await signPass(signing, { ...account("player_ana", "block_tag_a", []), player_tag: 7 as never }))).toBe("malformed");
    expect(await reason(await signPass(signing, { ...account("player_ana", "block_tag_a", []), block_tag_ids: "block_tag_b" as never }))).toBe("malformed");

    // Ana blocked Ben: both passes say so, and neither says who made it.
    const ana = account("player_ana", "block_tag_a", ["block_tag_b"], ["block_tag_b"]);
    const ben = account("player_ben", "block_tag_b", ["block_tag_a"], ["block_tag_a"]);
    expect(hasBlockBetween(ana, ben)).toBe(true);
    expect(hasBlockBetween(ben, ana)).toBe(true);
    // Ben's pass is from before the block (or past its newest 100): Ana's alone is enough.
    const oldBen = { ...ben, block_tag_ids: [] };
    expect(hasBlockBetween(ana, oldBen)).toBe(true);
    expect(hasBlockBetween(oldBen, ana)).toBe(true);
    // A block keeps chat apart even between friends whose older passes still list each other.
    expect(canChat(ana, ben)).toBe(false);
    expect(canChat({ ...ana, block_tag_ids: [] }, oldBen)).toBe(true);
    // No block, guests, and the same player.
    const cy = account("player_cy", "block_tag_c", []);
    expect(hasBlockBetween(ana, cy)).toBe(false);
    expect(hasBlockBetween(ana, claims)).toBe(false);
    expect(hasBlockBetween(ana, { ...ana })).toBe(false);
  });
});

describe("names and codes", () => {
  it("makes guest names and readable room codes", () => {
    expect(guestName()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
    for (let i = 0; i < 50; i++) expect(isRoomCode(roomCode())).toBe(true);
    expect(isRoomCode("ABC10O")).toBe(false);
  });
});
