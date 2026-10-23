import { env, SELF } from "cloudflare:test";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { accountById, createAccount, createApiKey, gameBySlug, gameRowDeletions, newGrant, recordGrant } from "@zaisma/core";
import { PassError, loadSigningKey, verifyPass, verifyReceipt } from "@zaisma/game-server";
import { accountDataZip } from "../../apps/site/src/account-data.ts";
import { purchasesRoute } from "../../apps/site/src/items-api.ts";
import type { Caller, CheckedCall } from "../../apps/site/src/developer.ts";
import type { Env } from "../../apps/site/src/env.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { GAME, GAME_ITEM, ITEMS, PURCHASE, PURCHASE_SETTINGS } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// Items and purchases through the developer API and MCP (apps/site/src/items-api.ts): what a game sells or
// grants, its refund policy, grants with their receipts (signed in the rooms Worker, here its stand-in through
// the RECEIPTS binding, with the tests' pass key), and refunds of grants.

const SITE = "https://zaisma.test";
const ISSUER = "https://rooms.zaisma.test";
let token = "";
let nextId = 1;
let playerId = "";
// Each test is its own developer, so the developer API's 120 calls a minute (by account) never run out across tests.
let developerNumber = 0;
let developerId = "";

async function api(path: string, init: { method?: string; body?: unknown; key?: string } = {}) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const answer = JSON.parse(await response.text()) as any;
  if (!response.ok) expect(errorProblems(answer, response.status)).toEqual([]);
  return { status: response.status, answer };
}

async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await response.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

const revive = { title: "Revive", description: "Back in the fight where you fell.", item_kind: "consumable", item_category: "gameplay", price_minor_units: 199, currency_code: "usd", local_prices: [] };
const cape = { title: "Supporter's Cape", description: "", item_kind: "permanent", item_category: "cosmetic", price_minor_units: null, currency_code: null, local_prices: [] };
const setItem = (itemName: string, fields: Record<string, unknown>) => api(`/games/sky-hopper/items/${itemName}`, { method: "PUT", body: fields });
const setRefundPolicy = () => api("/games/sky-hopper/purchase-settings", { method: "PATCH", body: { refund_policy: "unused_within_14_days" } });
const receiptKeys = async () => [(await loadSigningKey(env.TEST_PASS_SIGNING_KEY)).publicKey];

beforeEach(async () => {
  await env.DB.exec("DELETE FROM purchases; DELETE FROM game_items; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM security_events; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  developerId = `dev-${++developerNumber}`;
  await createAccount(env.DB, { id: developerId, username: "Pixel_Smith", ageBand: "18+" });
  await createAccount(env.DB, { id: "player-1", username: "Emma_Clarke", ageBand: "18+" });
  playerId = (await accountById(env.DB, "player-1"))!.player_id;
  await letPublish(env.DB, developerId);
  token = (await createApiKey(env.DB, developerId, "claude")).token;
  expect((await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } })).status).toBe(201);
});

// Items point at their game, so they go before games do in other files' clean-up.
afterAll(async () => {
  await env.DB.exec("DELETE FROM purchases; DELETE FROM game_items;");
});

describe("items", () => {
  it("are set whole, listed, replaced and removed, answered as their schemas say", async () => {
    expect((await setRefundPolicy()).status).toBe(200);
    const made = await setItem("revive", revive);
    expect(made.status).toBe(201);
    expect(schemaProblems(GAME_ITEM, made.answer.item)).toEqual([]);
    expect(made.answer.item).toMatchObject({ item_name: "revive", price_minor_units: 199, currency_code: "usd" });
    // Under 2 dollars, a nudge about card fees, never a floor.
    expect(made.answer.item.card_fee_note).toBe("Of $1.99, about $1.63 reaches you after card fees.");

    const replaced = await setItem("revive", { ...revive, price_minor_units: 499, local_prices: [{ currency_code: "brl", price_minor_units: 2490 }] });
    expect(replaced.status).toBe(200);
    expect(replaced.answer.item).toMatchObject({ price_minor_units: 499, card_fee_note: null, local_prices: [{ currency_code: "brl", price_minor_units: 2490 }] });

    const listed = await api("/games/sky-hopper/items");
    expect(schemaProblems(ITEMS, listed.answer)).toEqual([]);
    expect(listed.answer.items.map((listedItem: { item_name: string }) => listedItem.item_name)).toEqual(["revive"]);
    expect(listed.answer.purchase_label).toEqual({ categories: ["gameplay"], has_own_payments: false });

    expect((await api("/games/sky-hopper/items/revive", { method: "DELETE" })).answer).toEqual({ removed_item_name: "revive", next_steps: [] });
    expect((await api("/games/sky-hopper/items")).answer.items).toEqual([]);
    expect((await api("/games/sky-hopper/items/revive", { method: "DELETE" })).answer.error).toMatchObject({ code: "no_item", field: "item_name" });
  });

  it("refuse a price before the game states its refund policy, but not an item that's only granted", async () => {
    expect((await setItem("revive", revive)).answer.error).toMatchObject({ code: "refund_policy_needed", field: "price_minor_units" });
    expect((await setItem("supporter_cape", cape)).status).toBe(201);
  });

  it("refuse what isn't an item: a name with spaces, dollars for minor units, a price under Stripe's, a currency Zaisma doesn't price in, a local price in the main currency", async () => {
    await setRefundPolicy();
    expect((await setItem("Revive%20Potion", revive)).answer.error).toMatchObject({ code: "bad_item", field: "item_name" });
    expect((await setItem("revive", { ...revive, price_minor_units: 1.99 })).answer.error).toMatchObject({ code: "bad_item", field: "price_minor_units" });
    expect((await setItem("revive", { ...revive, price_minor_units: 49 })).answer.error).toMatchObject({ code: "price_too_low", field: "price_minor_units" });
    expect((await setItem("revive", { ...revive, currency_code: "xyz" })).answer.error).toMatchObject({ code: "unsupported_currency", field: "currency_code" });
    expect((await setItem("revive", { ...revive, local_prices: [{ currency_code: "usd", price_minor_units: 299 }] })).answer.error).toMatchObject({ code: "bad_item", field: "local_prices[0].currency_code" });
    const { local_prices: _, ...withoutLocalPrices } = revive;
    expect((await setItem("revive", withoutLocalPrices)).answer.error).toMatchObject({ code: "missing_field", field: "local_prices" });
    expect((await setItem("revive", { ...revive, price: 199 })).answer.error).toMatchObject({ code: "unknown_field", field: "price" });
  });

  it("make the game's label, which only sold items and its own payments count, and the game answer carries it", async () => {
    await setRefundPolicy();
    await setItem("supporter_cape", cape);
    expect((await api("/games/sky-hopper")).answer.game.purchase_label).toEqual({ categories: [], has_own_payments: false });
    await setItem("expansion_north", { ...revive, item_kind: "permanent", item_category: "content", price_minor_units: 1999 });
    const settings = await api("/games/sky-hopper/purchase-settings", { method: "PATCH", body: { own_payment_categories: ["currency", "cosmetic"] } });
    expect(schemaProblems(PURCHASE_SETTINGS, (({ next_steps: _, ...rest }) => rest)(settings.answer))).toEqual([]);
    const game = (await api("/games/sky-hopper")).answer.game;
    expect(schemaProblems(GAME, game)).toEqual([]);
    expect(game).toMatchObject({ purchase_label: { categories: ["cosmetic", "content", "currency"], has_own_payments: true }, refund_policy: "unused_within_14_days", refund_policy_text: null });
  });
});

describe("purchase settings", () => {
  it("take the policy in the developer's own words only with own_words, filtered like room names", async () => {
    expect((await api("/games/sky-hopper/purchase-settings", { method: "PATCH", body: { refund_policy: "own_words" } })).answer.error).toMatchObject({ code: "bad_refund_policy_text", field: "refund_policy_text" });
    expect((await api("/games/sky-hopper/purchase-settings", { method: "PATCH", body: { refund_policy: "no_refunds", refund_policy_text: "Never." } })).answer.error).toMatchObject({ code: "bad_refund_policy_text" });
    expect((await api("/games/sky-hopper/purchase-settings", { method: "PATCH", body: { refund_policy: "own_words", refund_policy_text: "Email me at refunds@example.com" } })).answer.error).toMatchObject({ code: "bad_refund_policy_text" });
    const set = await api("/games/sky-hopper/purchase-settings", { method: "PATCH", body: { refund_policy: "own_words", refund_policy_text: "Expansions are refunded within 30 days." } });
    expect(set.answer).toMatchObject({ refund_policy: "own_words", refund_policy_text: "Expansions are refunded within 30 days." });
    // A game that sells keeps a policy.
    await setItem("revive", revive);
    expect((await api("/games/sky-hopper/purchase-settings", { method: "PATCH", body: { refund_policy: null } })).answer.error).toMatchObject({ code: "refund_policy_needed", field: "refund_policy" });
  });
});

describe("grants", () => {
  it("answer a receipt any server checks for this game alone, which never passes as a player pass", async () => {
    await setItem("supporter_cape", cape);
    const granted = await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "supporter_cape", game_account_id: "patreon-4417" } });
    expect(granted.status).toBe(201);
    expect(schemaProblems(PURCHASE, granted.answer.purchase)).toEqual([]);
    expect(granted.answer).toMatchObject({ is_already_owned: false, purchase: { purchase_source: "grant", purchase_status: "completed", item_count: 1, price_minor_units: null, game_account_id: "patreon-4417" } });
    const keys = await receiptKeys();
    const claims = await verifyReceipt(granted.answer.purchase.receipt, keys, { game: "sky-hopper", issuer: ISSUER });
    expect(claims).toMatchObject({ sub: playerId, aud: "sky-hopper", kind: "receipt", jti: granted.answer.purchase.id, item_name: "supporter_cape", item_kind: "permanent", purchase_source: "grant", game_account_id: "patreon-4417" });
    await expect(verifyReceipt(granted.answer.purchase.receipt, keys, { game: "moon-base", issuer: ISSUER })).rejects.toMatchObject({ code: "wrong_game" });
    const asPass = await verifyPass(granted.answer.purchase.receipt, keys, { game: "sky-hopper", issuer: ISSUER }).catch((error: unknown) => error);
    expect(asPass).toBeInstanceOf(PassError);
    expect((asPass as PassError).code).toBe("wrong_kind");
    // The same purchase always signs to the same receipt.
    expect((await api(`/games/sky-hopper/purchases/${granted.answer.purchase.id}`)).answer.purchase.receipt).toBe(granted.answer.purchase.receipt);
  });

  it("give a permanent item once, and a consumable as many times and as many as asked", async () => {
    await setItem("supporter_cape", cape);
    await setItem("revive", { ...revive, price_minor_units: null, currency_code: null });
    const first = await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "supporter_cape" } });
    const again = await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "supporter_cape" } });
    expect(again.status).toBe(200);
    expect(again.answer).toMatchObject({ is_already_owned: true, purchase: { id: first.answer.purchase.id } });
    expect((await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "supporter_cape", item_count: 2 } })).answer.error).toMatchObject({ code: "bad_item_count", field: "item_count" });
    const revives = await tool("grant_item", { slug: "sky-hopper", player_id: playerId, item_name: "revive", item_count: 5 });
    expect(revives.purchase).toMatchObject({ item_count: 5, item_kind: "consumable" });
    await tool("grant_item", { slug: "sky-hopper", player_id: playerId, item_name: "revive" });
    // Only permanent items are owned; consumables are delivered and then the game's to count.
    expect((await api(`/games/sky-hopper/players/${playerId}/items`)).answer).toEqual({ player_id: playerId, owned_item_names: ["supporter_cape"] });
    const listed = await tool("list_purchases", { slug: "sky-hopper", item_name: "revive" });
    expect(listed.purchases.map((purchase: { item_count: number }) => purchase.item_count)).toEqual([1, 5]);
  });

  it("go only to accounts, and only of the game's own items", async () => {
    await setItem("supporter_cape", cape);
    expect((await api("/games/sky-hopper/purchases", { body: { player_id: "player_8f3k2m9q1x7c4v6b0n5z", item_name: "supporter_cape" } })).answer.error).toMatchObject({ code: "no_player", field: "player_id" });
    expect((await api("/games/sky-hopper/purchases", { body: { player_id: "version_8f3k2m9q1x7c4v6b0n5z", item_name: "supporter_cape" } })).answer.error).toMatchObject({ code: "wrong_id_kind", field: "player_id" });
    expect((await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "golden_cape" } })).answer.error).toMatchObject({ code: "no_item", field: "item_name" });
  });

  it("are taken back with a refund, once, and the item can't be removed while a player owns it", async () => {
    await setItem("supporter_cape", cape);
    const granted = await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "supporter_cape" } });
    expect((await api("/games/sky-hopper/items/supporter_cape", { method: "DELETE" })).answer.error).toMatchObject({ code: "item_has_owners", field: "item_name" });
    const refunded = await tool("refund_purchase", { slug: "sky-hopper", purchase_id: granted.answer.purchase.id });
    expect(refunded.purchase).toMatchObject({ purchase_status: "refunded", refunded_minor_units: 0 });
    expect(refunded.purchase.refunded_at).not.toBeNull();
    expect((await api(`/games/sky-hopper/players/${playerId}/items`)).answer.owned_item_names).toEqual([]);
    expect((await api(`/games/sky-hopper/purchases/${granted.answer.purchase.id}/refund`, { method: "POST" })).answer.error).toMatchObject({ code: "already_refunded" });
    expect((await api("/games/sky-hopper/items/supporter_cape", { method: "DELETE" })).status).toBe(200);
  });

  it("refund a sale only through Stripe, which isn't connected yet", async () => {
    const game = (await gameBySlug(env.DB, "sky-hopper"))!;
    const purchaseId = "purchase_salefortest01";
    await env.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, price_minor_units, currency_code, created_at_ms, purchased_at_ms) VALUES (?, ?, 'revive', 'consumable', ?, 'sale', 'completed', 199, 'usd', ?, ?)")
      .bind(purchaseId, game.id, playerId, Date.now(), Date.now())
      .run();
    expect((await api(`/games/sky-hopper/purchases/${purchaseId}/refund`, { method: "POST" })).answer.error).toMatchObject({ code: "stripe_not_connected" });
    expect((await api("/games/sky-hopper/purchases/purchase_nothingthere01")).answer.error).toMatchObject({ code: "no_purchase", field: "purchase_id" });
  });

  it("list newest first, a page at a time, and are in the game's history", async () => {
    await setItem("revive", { ...revive, price_minor_units: null, currency_code: null });
    const game = (await gameBySlug(env.DB, "sky-hopper"))!;
    const nowMs = Date.now();
    await env.DB.batch(
      Array.from({ length: 101 }, (_, i) =>
        env.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES (?, ?, 'revive', 'consumable', ?, 'grant', 'completed', ?, ?)").bind(`purchase_page${String(i).padStart(3, "0")}`, game.id, playerId, nowMs - (i % 3), nowMs),
      ),
    );
    const first = await api("/games/sky-hopper/purchases?purchase_source=grant");
    expect(first.answer.purchases).toHaveLength(100);
    const rest = await api(`/games/sky-hopper/purchases?purchase_source=grant&cursor=${first.answer.next_cursor}`);
    expect(rest.answer).toMatchObject({ next_cursor: null });
    const seen = [...first.answer.purchases, ...rest.answer.purchases].map((purchase: { id: string }) => purchase.id);
    expect(new Set(seen).size).toBe(101);
    expect((await api("/games/sky-hopper/purchases?purchase_status=bought")).answer.error).toMatchObject({ code: "bad_purchase_status", field: "purchase_status" });
    const history = (await api("/games/sky-hopper/history")).answer.events.map((event: { description: string }) => event.description);
    expect(history).toContain("Set an item");
  });
});

describe("at the same moment", () => {
  /** Fills the game with permanent items straight in the database, up to itemCount. */
  async function fillTo(itemCount: number) {
    const game = (await gameBySlug(env.DB, "sky-hopper"))!;
    const nowMs = Date.now();
    const statements = Array.from({ length: itemCount }, (_, i) => env.DB.prepare("INSERT INTO game_items (game_id, item_name, title, item_kind, item_category, created_at_ms, updated_at_ms) VALUES (?, ?, 'Skin', 'permanent', 'cosmetic', ?, ?)").bind(game.id, `skin_${String(i).padStart(4, "0")}`, nowMs, nowMs));
    for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
  }

  it("two grants of a permanent item make one purchase that owns it, so refunding it leaves nothing owned", async () => {
    await setItem("supporter_cape", cape);
    const game = (await gameBySlug(env.DB, "sky-hopper"))!;
    const grant = { playerId, gameItem: { item_name: "supporter_cape", item_kind: "permanent" as const }, itemCount: 1, gameAccountId: null, nowMs: Date.now() };
    // Both made before either is recorded, as two calls that each found the item not owned yet.
    const first = newGrant(game, grant);
    const second = newGrant(game, grant);
    expect(await recordGrant(env.DB, first)).toEqual({ purchase: first, isAlreadyOwned: false });
    expect(await recordGrant(env.DB, second)).toMatchObject({ purchase: { id: first.id }, isAlreadyOwned: true });
    const insertAgain = env.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms) VALUES ('purchase_insertedagain', ?, 'supporter_cape', 'permanent', ?, 'grant', 'completed', 0)").bind(game.id, playerId);
    await expect(insertAgain.run()).rejects.toThrow(/UNIQUE/);
    await api(`/games/sky-hopper/purchases/${first.id}/refund`, { method: "POST" });
    expect((await api(`/games/sky-hopper/players/${playerId}/items`)).answer.owned_item_names).toEqual([]);
  });

  it("refunds of one grant take it back once: one answers refunded, the other already_refunded", async () => {
    await setItem("supporter_cape", cape);
    const seen: string[] = [];
    for (let round = 0; round < 10; round++) {
      await env.DB.exec("DELETE FROM purchases;");
      const granted = await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "supporter_cape" } });
      const answers = await Promise.all([1, 2].map(() => api(`/games/sky-hopper/purchases/${granted.answer.purchase.id}/refund`, { method: "POST" })));
      seen.push(answers.map((answer) => answer.status).sort().join(" "));
    }
    expect(seen).toEqual(Array(10).fill("200 409"));
  });

  it("new items keep a game at 1,000", async () => {
    await fillTo(999);
    const itemCounts: number[] = [];
    for (let round = 0; round < 5; round++) {
      await Promise.all(["a", "b", "c"].map((suffix) => setItem(`skin_new_${round}_${suffix}`, cape)));
      itemCounts.push((await env.DB.prepare("SELECT COUNT(*) AS item_count FROM game_items").first<{ item_count: number }>())!.item_count);
      await env.DB.prepare("DELETE FROM game_items WHERE item_name LIKE 'skin_new_%'").run();
    }
    expect(itemCounts).toEqual(Array(5).fill(1000));
  });

  it("a refund policy cleared as an item goes on sale never leaves a price without a policy", async () => {
    const onSaleWithoutPolicy: boolean[] = [];
    for (let round = 0; round < 10; round++) {
      await setRefundPolicy();
      await Promise.all([setItem("revive", revive), api("/games/sky-hopper/purchase-settings", { method: "PATCH", body: { refund_policy: null } })]);
      const game = await env.DB.prepare("SELECT refund_policy FROM games WHERE slug = 'sky-hopper'").first<{ refund_policy: string | null }>();
      const sold = await env.DB.prepare("SELECT 1 AS is_sold FROM game_items WHERE price_minor_units IS NOT NULL").first();
      onSaleWithoutPolicy.push(sold !== null && game!.refund_policy === null);
      await env.DB.prepare("DELETE FROM game_items").run();
    }
    expect(onSaleWithoutPolicy).toEqual(Array(10).fill(false));
  });
});

describe("a grant whose receipt can't be signed", () => {
  it("is answered receipts_unavailable and not recorded, so trying again gives the item once", async () => {
    await setItem("revive", { ...revive, price_minor_units: null, currency_code: null });
    const game = (await gameBySlug(env.DB, "sky-hopper"))!;
    const signingDown = { ...(env as unknown as Env), RECEIPTS: { signAll: () => Promise.reject(new Error("rooms Worker unreachable")) } } as unknown as Env;
    const caller = { accountId: developerId, ownerId: game.owner_id, actor: "claude", cookies: [], via: "api", access: { apiKeyId: null, apiKeyName: null }, where: {} } as unknown as Caller;
    const checked = { pathValues: {}, query: new URLSearchParams(), body: { player_id: playerId, item_name: "revive", item_count: 5 }, game, webhook: null, signInApp: null } as unknown as CheckedCall;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await purchasesRoute(new Request(`${SITE}/api/dev/games/sky-hopper/purchases`, { method: "POST" }), signingDown, game, undefined, false, caller, checked).catch((error: { code?: string }) => error.code);
    vi.restoreAllMocks();
    expect(failed).toBe("receipts_unavailable");
    expect((await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "revive", item_count: 5 } })).status).toBe(201);
    const granted = (await api(`/games/sky-hopper/purchases?player_id=${playerId}`)).answer.purchases;
    expect(granted.map((purchase: { item_count: number }) => purchase.item_count)).toEqual([5]);
  });
});

describe("a deleted game", () => {
  it("leaves its players' purchases in their Download your data", async () => {
    await setItem("supporter_cape", cape);
    const granted = await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "supporter_cape" } });
    const game = (await gameBySlug(env.DB, "sky-hopper"))!;
    await env.DB.batch(gameRowDeletions(env.DB, game.id));
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    const zip = unzipSync(new Uint8Array(await new Response(accountDataZip(env as never, (await accountById(env.DB, "player-1"))!)).arrayBuffer()));
    vi.unstubAllGlobals();
    const played = JSON.parse(new TextDecoder().decode(zip["games-played.json"]));
    expect(played.purchases).toMatchObject([{ game_slug: null, id: granted.answer.purchase.id, item_name: "supporter_cape", purchase_status: "completed" }]);
  });
});

describe("access", () => {
  it("lets every key read items and purchases, and only a full key change them", async () => {
    await setItem("supporter_cape", cape);
    const readKey = (await createApiKey(env.DB, developerId, "read", { accessLevel: "read", gameSlugs: null })).token;
    const uploadKey = (await createApiKey(env.DB, developerId, "ci", { accessLevel: "upload", gameSlugs: null })).token;
    expect((await api("/games/sky-hopper/items", { key: readKey })).status).toBe(200);
    expect((await api("/games/sky-hopper/items/revive", { method: "PUT", body: revive, key: readKey })).answer.error).toMatchObject({ code: "key_not_allowed" });
    expect((await api("/games/sky-hopper/purchases", { key: uploadKey })).status).toBe(200);
    expect((await api("/games/sky-hopper/purchases", { body: { player_id: playerId, item_name: "supporter_cape" }, key: uploadKey })).answer.error).toMatchObject({ code: "key_not_allowed" });
  });
});
