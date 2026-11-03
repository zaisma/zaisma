import { describe, expect, it } from "vitest";
import { openSecret, sealSecret, storedSecretsKeyBytes } from "../../packages/core/src/sealed-secrets.ts";
import { createEntryGrant, isEntryCookieValid, useEntryGrant } from "../../packages/core/src/game-access.ts";

/** Secrets sealed with a key the database never holds, and the two slots that let that key be replaced. */

const newKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const first = newKey();
const second = newKey();
const PLACE = "webhooks.signing_secret:webhook_one";
const onFirst = { STORED_SECRETS_KEY: first, SECOND_STORED_SECRETS_KEY: second };
const onSecond = { ...onFirst, IS_SECOND_STORED_SECRETS_KEY_IN_USE: "true" };

describe("sealed secrets", () => {
  it("opens what it sealed, and the sealed value holds nothing of the secret", async () => {
    const sealed = await sealSecret(onFirst, "whsec_abc", PLACE);
    expect(sealed).toMatch(/^first\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("whsec");
    expect(await openSecret(onFirst, sealed, PLACE)).toBe("whsec_abc");
    expect(await sealSecret(onFirst, "whsec_abc", PLACE)).not.toBe(sealed);
  });

  it("refuses a changed value, another row's or column's, and one under another key", async () => {
    const sealed = await sealSecret(onFirst, "whsec_abc", PLACE);
    const [slot, iv, ciphertext] = sealed.split(".") as [string, string, string];
    await expect(openSecret(onFirst, `${slot}.${iv}.${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`, PLACE)).rejects.toThrow();
    await expect(openSecret(onFirst, sealed, "webhooks.signing_secret:webhook_two")).rejects.toThrow();
    await expect(openSecret(onFirst, sealed, "tester_links.token:webhook_one")).rejects.toThrow();
    await expect(openSecret({ STORED_SECRETS_KEY: newKey() }, sealed, PLACE)).rejects.toThrow();
    await expect(openSecret(onFirst, "whsec_abc", PLACE)).rejects.toThrow();
  });

  it("seals with the slot in use and opens either, so a swap breaks nothing", async () => {
    const sealedFirst = await sealSecret(onFirst, "one", PLACE);
    const sealedSecond = await sealSecret(onSecond, "two", PLACE);
    expect(sealedSecond.startsWith("second.")).toBe(true);
    expect(await openSecret(onSecond, sealedFirst, PLACE)).toBe("one");
    expect(await openSecret(onFirst, sealedSecond, PLACE)).toBe("two");
  });

  it("says so when a slot's key is missing, or isn't long enough", async () => {
    const sealedSecond = await sealSecret(onSecond, "two", PLACE);
    await expect(openSecret({ STORED_SECRETS_KEY: first }, sealedSecond, PLACE)).rejects.toThrow("SECOND_STORED_SECRETS_KEY");
    await expect(sealSecret({ STORED_SECRETS_KEY: first, IS_SECOND_STORED_SECRETS_KEY_IN_USE: "true" }, "x", PLACE)).rejects.toThrow("SECOND_STORED_SECRETS_KEY");
    await expect(sealSecret({ STORED_SECRETS_KEY: "c2hvcnQ=" }, "x", PLACE)).rejects.toThrow("32 random bytes");
  });

  it("lists the key in use first, and only what's set", () => {
    expect(storedSecretsKeyBytes({ STORED_SECRETS_KEY: first })).toHaveLength(1);
    const [inUse, other] = storedSecretsKeyBytes(onSecond);
    expect(Buffer.from(inUse!).toString("base64")).toBe(second);
    expect(Buffer.from(other!).toString("base64")).toBe(first);
  });
});

describe("accounts-only entry", () => {
  const game = { id: "game_one", entry_signing_key: "kept-in-the-database" };

  it("keeps working across a swap, and the database's value alone signs nothing", async () => {
    const entered = await useEntryGrant(onFirst, game, await createEntryGrant(onFirst, game));
    expect(entered).not.toBeNull();
    expect(await isEntryCookieValid(onSecond, game, entered!.cookieValue)).toBe(true);
    expect(await useEntryGrant(onFirst, game, await createEntryGrant(onSecond, game))).not.toBeNull();

    // Signed with entry_signing_key alone, as anyone holding only the database could.
    const expiresAtMs = Date.now() + 60_000;
    const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(game.entry_signing_key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(`entry|${game.id}|${expiresAtMs}`));
    const forged = `${expiresAtMs}.${Buffer.from(signature).toString("hex")}`;
    expect(await isEntryCookieValid(onFirst, game, forged)).toBe(false);

    // Once the old slot's key is replaced, what it signed stops opening.
    expect(await isEntryCookieValid({ STORED_SECRETS_KEY: newKey(), SECOND_STORED_SECRETS_KEY: second }, game, entered!.cookieValue)).toBe(false);
  });
});
