import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { accountById, addTesterLink, createAccount, createGame, createWebhook, gameBySlug, openSecret, personOwner, sealStoredSecrets, sha256Hex, signatureFor, testerLinkByToken, testerLinkToken, testerLinks, updateWebhook, webhookById, webhookSigningSecret, type Webhook } from "@zaisma/core";
import { checkPreviewLinkToken, previewLinkToken } from "../../apps/site/src/preview-links.ts";

/** What's sealed stays out of the database's reach, and sealing and replacing the key change nothing anyone holds. */

const newKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const ACCOUNT_ID = "account_sealed";
let gameId: string;
const TOKEN = "abcdefghij0123456789";
const input = { ownerId: "owner_sealed", destinationKind: "endpoint_url" as const, endpointUrl: "https://hooks.skyhopper.io/zaisma", eventKinds: ["bug_reported" as const], gameSlugs: null };
const tokenSha256 = (token: string) => sha256Hex(new TextEncoder().encode(token));

async function plainWebhook(signingSecret: string): Promise<string> {
  const id = `webhook_${crypto.randomUUID().replaceAll("-", "")}`;
  await env.DB.prepare("INSERT INTO webhooks (id, owner_id, destination_kind, endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms) VALUES (?, 'owner_sealed', 'endpoint_url', 'https://hooks.skyhopper.io/zaisma', '[\"bug_reported\"]', NULL, ?, 1, 1)").bind(id, signingSecret).run();
  return id;
}

async function plainTesterLink(token: string): Promise<string> {
  const id = `tester_${crypto.randomUUID().replaceAll("-", "")}`;
  await env.DB.prepare("INSERT INTO tester_links (id, game_id, name, token, created_at_ms) VALUES (?, ?, 'Team', ?, 1)").bind(id, gameId, token).run();
  return id;
}

const webhookRow = (id: string) => env.DB.prepare("SELECT * FROM webhooks WHERE id = ?").bind(id).first<Webhook>();
const testerRow = (id: string) => env.DB.prepare("SELECT * FROM tester_links WHERE id = ?").bind(id).first<{ id: string; token: string | null; token_sha256: string | null; sealed_token: string | null }>();

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM webhooks").run();
  await env.DB.prepare("DELETE FROM tester_links").run();
  if (!(await accountById(env.DB, ACCOUNT_ID))) await createAccount(env.DB, { id: ACCOUNT_ID, username: "Sam_Sealed", ageBand: "18+" });
  const owner = await personOwner(env.DB, ACCOUNT_ID);
  gameId = ((await gameBySlug(env.DB, "sealed-game")) ?? (await createGame(env.DB, { slug: "sealed-game", title: "Sealed", description: "", ownerId: owner.id, visibility: "draft" }))).id;
});

describe("new secrets", () => {
  it("a new webhook's signing secret reaches the database only sealed", async () => {
    const { webhook, signingSecret } = await createWebhook(env.DB, env, input);
    const row = (await webhookRow(webhook.id))!;
    expect(row.signing_secret).toBeNull();
    expect(JSON.stringify(row)).not.toContain(signingSecret);
    expect(await webhookSigningSecret(env, row)).toBe(signingSecret);
  });

  it("replacing a signing secret seals the new one, and leaves it alone otherwise", async () => {
    const { webhook, signingSecret } = await createWebhook(env.DB, env, input);
    const kept = await updateWebhook(env.DB, env, webhook, { eventKinds: ["player_reported"] });
    expect(kept.signingSecret).toBeNull();
    expect(await webhookSigningSecret(env, (await webhookRow(webhook.id))!)).toBe(signingSecret);
    const replaced = await updateWebhook(env.DB, env, webhook, { replaceSigningSecret: true });
    expect(replaced.signingSecret).not.toBe(signingSecret);
    const row = (await webhookRow(webhook.id))!;
    expect(row.signing_secret).toBeNull();
    expect(await webhookSigningSecret(env, row)).toBe(replaced.signingSecret);
  });

  it("a new tester link's token reaches the database only sealed, and its URL still finds it", async () => {
    const link = await addTesterLink(env.DB, env, gameId, "Team");
    const row = (await testerRow(link.id))!;
    expect(row.token).toBeNull();
    expect(JSON.stringify(row)).not.toContain(link.token);
    expect(row.token_sha256).toBe(await tokenSha256(link.token));
    expect((await testerLinkByToken(env.DB, link.token))?.id).toBe(link.id);
    expect(await testerLinkToken(env, (await testerLinks(env.DB, gameId))[0]!)).toBe(link.token);
  });
});

describe("sealStoredSecrets", () => {
  it("seals plain rows and empties them, and everything anyone holds keeps working", async () => {
    const secret = `whsec_${btoa("twenty-four-random-bytes")}`;
    const webhookId = await plainWebhook(secret);
    const testerId = await plainTesterLink(TOKEN);
    const signatureBefore = await signatureFor(await webhookSigningSecret(env, (await webhookById(env.DB, webhookId))!), "webhook_event_one", 100, "{}");
    expect((await testerLinkByToken(env.DB, TOKEN))?.id).toBe(testerId);

    await sealStoredSecrets(env.DB, env);

    const webhook = (await webhookById(env.DB, webhookId))!;
    expect(webhook.signing_secret).toBeNull();
    expect(webhook.sealed_signing_secret).not.toContain("whsec");
    expect(await signatureFor(await webhookSigningSecret(env, webhook), "webhook_event_one", 100, "{}")).toBe(signatureBefore);
    const tester = (await testerRow(testerId))!;
    expect(tester.token).toBeNull();
    expect(tester.token_sha256).toBe(await tokenSha256(TOKEN));
    expect(JSON.stringify(tester)).not.toContain(TOKEN);
    expect((await testerLinkByToken(env.DB, TOKEN))?.id).toBe(testerId);
    expect(await testerLinkToken(env, tester)).toBe(TOKEN);
  });

  it("seals a link that's been turned off too", async () => {
    const testerId = await plainTesterLink(TOKEN);
    await env.DB.prepare("UPDATE tester_links SET revoked_at_ms = 5 WHERE id = ?").bind(testerId).run();
    await sealStoredSecrets(env.DB, env);
    expect((await testerRow(testerId))!.token).toBeNull();
  });

  it("moves values onto the slot in use after a swap, and each keeps its secret", async () => {
    const { webhook, signingSecret } = await createWebhook(env.DB, env, input);
    const link = await addTesterLink(env.DB, env, gameId, "Team");
    const swapped = { STORED_SECRETS_KEY: env.STORED_SECRETS_KEY, SECOND_STORED_SECRETS_KEY: newKey(), IS_SECOND_STORED_SECRETS_KEY_IN_USE: "true" };

    await sealStoredSecrets(env.DB, swapped);

    const webhookAfter = (await webhookRow(webhook.id))!;
    const testerAfter = (await testerRow(link.id))!;
    expect(webhookAfter.sealed_signing_secret!.startsWith("second.")).toBe(true);
    expect(testerAfter.sealed_token!.startsWith("second.")).toBe(true);
    expect(await webhookSigningSecret(swapped, webhookAfter)).toBe(signingSecret);
    expect(await testerLinkToken(swapped, testerAfter)).toBe(link.token);
    // The first slot's key can go now.
    expect(await webhookSigningSecret({ STORED_SECRETS_KEY: newKey(), SECOND_STORED_SECRETS_KEY: swapped.SECOND_STORED_SECRETS_KEY }, webhookAfter)).toBe(signingSecret);
  });

  it("never overwrites a secret replaced while it ran", async () => {
    const webhookId = await plainWebhook("whsec_b2xk");
    const replacedDuringTheRun = {
      prepare: (query: string) => env.DB.prepare(query),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.prepare("UPDATE webhooks SET signing_secret = 'whsec_bmV3' WHERE id = ?").bind(webhookId).run();
        return env.DB.batch(statements);
      },
    } as unknown as D1Database;
    await sealStoredSecrets(replacedDuringTheRun, env);
    const row = (await webhookRow(webhookId))!;
    expect(row.signing_secret).toBe("whsec_bmV3");
    expect(row.sealed_signing_secret).toBeNull();
  });

  it("leaves a value that won't open, and goes on with the rest", async () => {
    const { webhook } = await createWebhook(env.DB, env, input);
    const unopenable = (await webhookRow(webhook.id))!.sealed_signing_secret!;
    const elsewhere = await plainWebhook("whsec_b2xk");
    await sealStoredSecrets(env.DB, { STORED_SECRETS_KEY: newKey(), SECOND_STORED_SECRETS_KEY: newKey(), IS_SECOND_STORED_SECRETS_KEY_IN_USE: "true" });
    expect((await webhookRow(webhook.id))!.sealed_signing_secret).toBe(unopenable);
    expect((await webhookRow(elsewhere))!.signing_secret).toBeNull();
  });

  it("does nothing once everything is sealed in the slot in use", async () => {
    const { webhook } = await createWebhook(env.DB, env, input);
    const sealed = (await webhookRow(webhook.id))!.sealed_signing_secret;
    await sealStoredSecrets(env.DB, env);
    expect((await webhookRow(webhook.id))!.sealed_signing_secret).toBe(sealed);
    await expect(openSecret(env, sealed!, `webhooks.signing_secret:${webhook.id}`)).resolves.toMatch(/^whsec_/);
  });
});

describe("preview links", () => {
  const version = { id: "version_one", scan_status: "approved" as const, preview_link_key: "kept-in-the-database" };
  const NOW = 1_800_000_000_000;

  it("keep working across a swap, and stop once the old slot's key is replaced", () => {
    const first = newKey();
    const second = newKey();
    const before = { STORED_SECRETS_KEY: first, SECOND_STORED_SECRETS_KEY: second };
    const after = { ...before, IS_SECOND_STORED_SECRETS_KEY_IN_USE: "true" };
    const { token, expiresAtMs } = previewLinkToken(before, version, NOW)!;
    expect(checkPreviewLinkToken(before, token, version, NOW)).toBe(expiresAtMs);
    expect(checkPreviewLinkToken(after, token, version, NOW)).toBe(expiresAtMs);
    expect(checkPreviewLinkToken({ STORED_SECRETS_KEY: newKey(), SECOND_STORED_SECRETS_KEY: second, IS_SECOND_STORED_SECRETS_KEY_IN_USE: "true" }, token, version, NOW)).toBeNull();
  });

  it("can't be made from the database's value alone", async () => {
    const { createHmac } = await import("node:crypto");
    const hourNumber = Math.floor(NOW / 3600_000);
    const forged = `${version.id}.${hourNumber.toString(36)}.${createHmac("sha256", version.preview_link_key).update(`preview:${version.id}:${hourNumber}`).digest("hex").slice(0, 32)}`;
    expect(checkPreviewLinkToken({ STORED_SECRETS_KEY: newKey() }, forged, version, NOW)).toBeNull();
  });
});
