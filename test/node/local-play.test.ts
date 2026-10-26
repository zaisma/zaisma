import { createServer, type Server } from "node:http";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { passesAreFriends, passesHaveBlockBetween, verifyPass, verifyReceipt, type PassClaims, type PublicKey } from "../../packages/game-server/src/index.ts";
import { startLocalPlay, type LocalPlay } from "../../packages/game-server/bin/local-play.js";

// Playing a multiplayer game on your own computer (packages/game-server/bin/local-play.js): four in a row, its
// game server and the bench, with real passes and receipts from the stand-in rooms, played by two clients.

const EXAMPLE = join(import.meta.dirname, "../../examples/four-in-a-row");
const SLUG = "four-in-a-row";
const port = 20_000 + Math.floor(Math.random() * 4_000) * 4;
let folder = "";
let play: LocalPlay;
// Zaisma's developer API for the game's items, stood in for: the bench brings them in at every start with --game and a key.
let developerApi: Server;
const ITEMS = { "gold-board": { item_name: "gold-board", title: "Gold board", description: "A gold board for every match.", item_kind: "permanent", item_category: "cosmetic", price_minor_units: 199, currency_code: "usd" } };
const startPlay = () => startLocalPlay({ gameFolder: folder, port, gameSlug: SLUG, zaismaKey: "zsk_test", developerApiUrl: `http://127.0.0.1:${(developerApi.address() as { port: number }).port}`, log: () => {} });

const json = async (response: Response) => ({ status: response.status, body: (await response.json()) as Record<string, any> });
const bench = (path: string, body?: unknown) => fetch(`${play.benchUrl}${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }).then(json);
const rooms = (path: string, body: unknown) => fetch(`${play.roomsUrl}${path}`, { method: "POST", headers: { origin: play.gameSiteUrl, "content-type": "text/plain" }, body: JSON.stringify(body) }).then(json);
/** A call of the buy sheet's script, from a tab's page: its address, with ?player=, is the referrer. */
const buySheet = (playerNumber: number, path: string, body: unknown) => fetch(`${play.benchUrl}${path}`, { method: "POST", headers: { referer: `${play.benchUrl}/?player=${playerNumber}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then(json);
const keysAt = async (path: string) => ((await (await fetch(`${play.roomsUrl}${path}`)).json()) as { keys: PublicKey[] }).keys;

async function passOf(playerNumber: number): Promise<{ pass: string; claims: PassClaims }> {
  const key = (await bench(`/bench/key?player=${playerNumber}`)).body.key;
  const answer = await rooms("/v1/pass", { gameSlug: SLUG, roomKey: key });
  expect(answer.status).toBe(200);
  return { pass: answer.body.pass, claims: await verifyPass(answer.body.pass, await keysAt("/.well-known/jwks.json"), { gameSlug: SLUG, issuerUrl: play.roomsUrl }) };
}

/** A client in a room: its welcome, the newest players list it heard, and the game's messages to it. */
function joinRoom(code: string, pass: string): Promise<{ socket: WebSocket; welcome: any; players: () => any[]; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${play.roomsUrl.replace(/^http/, "ws")}/v1/rooms/${SLUG}/${code}`, { headers: { origin: play.gameSiteUrl } });
    let players: any[] = [];
    const messages: any[] = [];
    socket.on("open", () => socket.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, room: {} })));
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString());
      if (message.type === "welcome") {
        players = message.players;
        resolve({ socket, welcome: message, players: () => players, messages });
      }
      if (message.type === "players") players = message.players;
      if (message.type === "message") messages.push(message.data);
      if (message.type === "error") reject(new Error(message.message));
    });
    socket.on("error", reject);
  });
}
const until = async (isDone: () => boolean, timeoutMs = 10_000) => {
  const startedAtMs = Date.now();
  while (!isDone()) {
    if (Date.now() - startedAtMs > timeoutMs) throw new Error("timed out");
    await new Promise((done) => setTimeout(done, 50));
  }
};

describe("play-locally", () => {
  beforeAll(async () => {
    // The example as a developer uploads it: the game at the top, its game server as zaisma-server.js.
    folder = mkdtempSync(join(tmpdir(), "zaisma-local-play-"));
    cpSync(join(EXAMPLE, "game"), folder, { recursive: true });
    writeFileSync(join(folder, "zaisma-server.js"), stripTypeScriptTypes(readFileSync(join(EXAMPLE, "server.ts"), "utf8")));
    developerApi = createServer((request, response) => {
      const isAsked = request.url === `/games/${SLUG}/items` && request.headers.authorization === "Bearer zsk_test";
      response.writeHead(isAsked ? 200 : 404, { "Content-Type": "application/json" });
      response.end(JSON.stringify(isAsked ? { items: ITEMS, purchase_delivery: "game" } : { error: { code: "no_game" } }));
    });
    await new Promise<void>((done) => developerApi.listen(0, "127.0.0.1", () => done()));
    play = await startPlay();
  }, 30_000);

  afterAll(async () => {
    await play?.close();
    developerApi?.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it("gives each tab a pass the game server's own check accepts: a guest first, then the accounts", async () => {
    const first = await passOf(1);
    const second = await passOf(2);
    expect(first.claims.kind).toBe("guest");
    expect(typeof first.claims.name).toBe("string");
    expect(second.claims.kind).toBe("account");
    expect(second.claims.sub).toMatch(/^player_[a-z0-9]+$/);
    expect(second.claims.player_tag_id).toMatch(/^player_tag_/);
    const profile = await fetch(`${play.roomsUrl}/v1/players/${second.claims.sub}`).then(json);
    expect(profile.body.player.name).toBe("Anna");
  }, 20_000);

  it("lets two players into one room on the game server", async () => {
    const code = (await rooms("/v1/rooms", { gameSlug: SLUG })).body.roomCode;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const first = await joinRoom(code, (await passOf(1)).pass);
    const second = await joinRoom(code, (await passOf(2)).pass);
    await until(() => first.players().length === 2);
    expect(second.players().map((player: { name: string }) => player.name)).toContain("Anna");
    first.socket.close();
    second.socket.close();
  }, 20_000);

  it("puts the bench's friends, blocks and items in the next passes, and grants items with receipts", async () => {
    expect((await bench("/bench/state", { op: "set-friend", first: "anna", second: "ben", isFriend: true })).status).toBe(200);
    let anna = await passOf(2);
    let ben = await passOf(3);
    expect(passesAreFriends(anna.claims, ben.claims)).toBe(true);
    expect(passesHaveBlockBetween(anna.claims, ben.claims)).toBe(false);
    await bench("/bench/state", { op: "set-block", blocker: "ben", blocked: "anna", isBlocked: true });
    anna = await passOf(2);
    ben = await passOf(3);
    expect(passesHaveBlockBetween(anna.claims, ben.claims)).toBe(true);

    // The game's own items, brought in from Zaisma as the bench started; the bench makes none up.
    expect((await bench("/bench/state")).body.items.map((listedItem: { itemName: string }) => listedItem.itemName)).toEqual(["gold-board"]);
    expect((await bench("/bench/state", { op: "set-item", item: { itemName: "made-up" } })).body.error.code).toBe("bad_change");
    // As the buy sheet does it: its start (the price and the saved test card), then paying with that card, from player 2's page.
    const started = await buySheet(2, "/api/buy/four-in-a-row/start", { item_name: "gold-board", item_count: 1, game_account_id: null });
    expect(started.body).toMatchObject({ item: { title: "Gold board" }, price: { price_text: "$1.99" }, saved_card: { card_brand: "visa", card_last_digits: "4242" } });
    const bought = await buySheet(2, `/api/buy/purchases/${started.body.purchase_id}/pay-with-saved-card`, {});
    expect(bought.body.status).toBe("completed");
    const receipt = await verifyReceipt(bought.body.purchase.receipt, await keysAt("/.well-known/receipt-jwks.json"), { gameSlug: SLUG, issuerUrl: `${play.roomsUrl}/receipts` });
    expect(receipt).toMatchObject({ sub: anna.claims.sub, item_name: "gold-board", purchase_status: "completed", purchase_source: "grant" });
    expect((await passOf(2)).claims.owned_item_names).toEqual(["gold-board"]);
    // A guest's tab can't buy: buying is for accounts.
    expect((await buySheet(1, "/api/buy/four-in-a-row/start", { item_name: "gold-board", item_count: 1, game_account_id: null })).body.error.code).toBe("account_needed");
  }, 20_000);

  it("draws the game page from the site's own Glass: the playing bar, the real buy sheet, its stylesheet and the brand files", async () => {
    const page = await (await fetch(`${play.benchUrl}/?player=1`)).text();
    expect(page).toContain('class="is-playing"');
    expect(page).toContain('class="playing-bar');
    expect(page).toContain('id="buy-sheet"');
    expect(page).toContain('id="bench-friends-body"');
    const stylesheet = /href="(\/css\/site\.[a-z0-9]+\.css)"/.exec(page)?.[1];
    expect(stylesheet).toBeTruthy();
    expect((await fetch(`${play.benchUrl}${stylesheet}`)).status).toBe(200);
    const font = /href="(\/fonts\/[a-z0-9.]+\.woff2)"/.exec(page)?.[1];
    expect((await fetch(`${play.benchUrl}${font}`)).headers.get("content-type")).toBe("font/woff2");
    expect((await fetch(`${play.benchUrl}/zaisma-mark-metal.svg`)).status).toBe(200);
    expect((await fetch(`${play.benchUrl}/README.md`)).status).toBe(404);
    // The sheets are the components' markup, drawn from the bench's state.
    const friends = await (await fetch(`${play.benchUrl}/bench/sheet/friends?player=2`)).text();
    expect(friends).toContain('name="bench-friend"');
    expect(friends).not.toContain("&lt;");
  }, 20_000);

  it("gives two tabs opened together two players", async () => {
    const claim = () => fetch(`${play.benchUrl}/bench/claim`, { method: "POST" }).then(json);
    const [first, second] = await Promise.all([claim(), claim()]);
    expect(first.body.playerNumber).not.toBe(second.body.playerNumber);
  });

  it("answers a call it has no stand-in for with not_local", async () => {
    const answer = await rooms("/v1/relay", { gameSlug: SLUG });
    expect(answer.status).toBe(404);
    expect(answer.body.error.code).toBe("not_local");
    // The chat filter is Zaisma's: the bench says it let the text through unchecked.
    expect((await rooms("/v1/filter", { gameSlug: SLUG, text: "hello" })).body).toMatchObject({ isAllowed: true, text: "hello", is_stand_in: true });
  }, 20_000);

  it("serves the game with the SDK set up for the bench, and never its server or the bench's folder", async () => {
    const sdk = await (await fetch(`${play.gameSiteUrl}/_zaisma/v1.js`)).text();
    expect(sdk).toContain(`"rooms":"http://localhost:${port + 2}"`);
    expect(sdk).toContain(`"site":"http://localhost:${port}"`);
    expect((await fetch(`${play.gameSiteUrl}/zaisma-server.js`)).status).toBe(404);
    expect((await fetch(`${play.gameSiteUrl}/.zaisma-local/keys.json`)).status).toBe(404);
    // In any case: macOS and Windows find .zaisma-local as .ZAISMA-LOCAL too, and it holds the signing keys.
    expect((await fetch(`${play.gameSiteUrl}/.ZAISMA-LOCAL/keys.json`)).status).toBe(404);
    expect((await fetch(`${play.gameSiteUrl}/ZAISMA-SERVER.JS`)).status).toBe(404);
    // However the path is written: an encoded slash with .. lands in the same folder, and is judged by where it lands.
    expect((await fetch(`${play.gameSiteUrl}/a%2F..%2F.zaisma-local%2Fkeys.json`)).status).toBe(404);
    expect((await fetch(`${play.gameSiteUrl}/a%2F..%2Fzaisma-server.js`)).status).toBe(404);
    expect((await fetch(`${play.gameSiteUrl}/a%2F..%2Findex.html`)).status).toBe(200);
    expect((await fetch(`${play.gameSiteUrl}/../keys.json`)).status).toBe(404);
    const page = await fetch(`${play.gameSiteUrl}/`);
    expect(page.headers.get("content-security-policy")).toContain(`frame-ancestors http://localhost:${port}`);
    expect(await page.text()).toContain("/_zaisma/saves.js");
  }, 20_000);

  it("starts the game server again when its file changes, with the room's match as it was", async () => {
    const code = (await rooms("/v1/rooms", { gameSlug: SLUG })).body.roomCode;
    const anna = await passOf(2);
    const ben = await passOf(3);
    const first = await joinRoom(code, anna.pass);
    const second = await joinRoom(code, ben.pass);
    await until(() => first.players().length === 2);
    // Anna has the first seat, and drops a piece in column 3: the bottom row's fourth cell.
    first.socket.send(JSON.stringify({ type: "message", data: { column: 3 } }));
    const hasPiece = (messages: any[]) => messages.some((message) => Array.isArray(message?.board) && message.board[38] === 1);
    await until(() => hasPiece(second.messages));
    const startCount = play.runnerStartCount;
    appendFileSync(join(folder, "zaisma-server.js"), "\n// changed\n");
    await until(() => play.runnerStartCount > startCount, 15_000);
    await until(() => first.socket.readyState === WebSocket.CLOSED && second.socket.readyState === WebSocket.CLOSED, 15_000);
    let back: Awaited<ReturnType<typeof joinRoom>> | null = null;
    await until(() => {
      if (!back) joinRoom(code, anna.pass).then((joined) => (back = joined), () => {});
      return back !== null;
    }, 15_000);
    // Back in the room the restart brought back: the board still has her piece.
    await until(() => hasPiece(back!.messages), 10_000);
    back!.socket.close();
  }, 60_000);

  it("keeps an account's save and the bench's players across a restart", async () => {
    const saveText = '{"save_format_version_number":1,"local_storage_items":{"level":"3"},"indexeddb_databases":[]}';
    expect((await fetch(`${play.benchUrl}/bench/saves/anna`, { method: "PUT", body: JSON.stringify({ saveText }) })).status).toBe(200);
    const annaId = (await passOf(2)).claims.sub;
    await play.close();
    play = await startPlay();
    expect((await bench("/bench/saves/anna")).body.saveText).toBe(saveText);
    expect((await passOf(2)).claims.sub).toBe(annaId);
    expect(existsSync(join(folder, ".zaisma-local", "keys.json"))).toBe(true);
  }, 30_000);
});
