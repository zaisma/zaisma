import { createServer, type Server } from "node:http";
import { request as secureRequest } from "node:https";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { passesAreFriends, passesHaveBlockBetween, verifyPass, verifyReceipt, type PassClaims, type PublicKey } from "../../packages/game-server/src/index.ts";
import { startLocalPlay, type LocalPlay } from "../../packages/game-server/bin/local-play.js";

// Playing a multiplayer game on your own computer (packages/game-server/bin/local-play.js): four in a row, its
// game server and the bench, with real passes and receipts from the stand-in rooms, played by two clients. Each
// player's page is zaisma.com's game page, so these call the bench as that page's scripts do.

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
/** A call of the game page's scripts, from a player's page: its address (/p/<number>/g/<slug>) is the referrer. */
const fromPage = (playerNumber: number, path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  fetch(`${play.benchUrl}${path}`, { method, headers: { referer: `${play.benchUrl}/p/${playerNumber}/g/${SLUG}?play`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const keysAt = async (path: string) => ((await (await fetch(`${play.roomsUrl}${path}`)).json()) as { keys: PublicKey[] }).keys;
/** A new tab: a new player, a guest. */
const newPlayer = async (): Promise<number> => (await bench("/bench/claim", {})).body.playerNumber;
/** The bench's sign-in, as its page sends it: a name makes the account, or is the account of that name again. */
const signIn = (playerNumber: number, name: string) =>
  fetch(`${play.benchUrl}/bench/sign-in`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ player: String(playerNumber), next: `/account/kept?game=${SLUG}`, name }) });
let guest = 0;
let anna = 0;
let ben = 0;

async function passOf(playerNumber: number): Promise<{ pass: string; claims: PassClaims }> {
  // Play hands the page a room key, which the game swaps for the player's pass.
  const key = (await json(await fromPage(playerNumber, `/api/plays/${SLUG}`, {}))).body.key;
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
    // Closed before its welcome (the game server was starting again): this try is over, and the next one can go.
    socket.on("close", () => reject(new Error("closed before the welcome")));
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
    guest = await newPlayer();
    anna = await newPlayer();
    ben = await newPlayer();
    for (const [playerNumber, name] of [[anna, "Anna"], [ben, "Ben"]] as const) expect((await signIn(playerNumber, name)).status).toBe(303);
  }, 30_000);

  afterAll(async () => {
    await play?.close();
    developerApi?.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it("gives each player a pass the game server's own check accepts: a guest, and an account once they sign in", async () => {
    const first = await passOf(guest);
    const second = await passOf(anna);
    expect(first.claims.kind).toBe("guest");
    expect(typeof first.claims.name).toBe("string");
    expect(second.claims.kind).toBe("account");
    expect(second.claims.sub).toMatch(/^player_[a-z0-9]+$/);
    expect(second.claims.player_tag_id).toMatch(/^player_tag_/);
    const profile = await fetch(`${play.roomsUrl}/v1/players/${second.claims.sub}`).then(json);
    expect(profile.body.player.name).toBe("Anna");
    // The page asks whose it is after a sign-in, as zaisma.com's does: the account, with a key for its pass.
    expect((await json(await fromPage(anna, `/api/plays/${SLUG}/account`, {}))).body).toMatchObject({ player: { name: "Anna", kind: "account" }, playerKind: "account" });
    expect((await fromPage(guest, `/api/plays/${SLUG}/account`, {})).status).toBe(401);
  }, 20_000);

  it("lets two players into one room on the game server", async () => {
    const code = (await rooms("/v1/rooms", { gameSlug: SLUG })).body.roomCode;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    const first = await joinRoom(code, (await passOf(guest)).pass);
    const second = await joinRoom(code, (await passOf(anna)).pass);
    await until(() => first.players().length === 2);
    expect(second.players().map((player: { name: string }) => player.name)).toContain("Anna");
    // The dev page learns the room, for Add a player.
    expect((await bench(`/bench/state?player=${anna}`)).body.roomCode).toBe(code);
    first.socket.close();
    second.socket.close();
  }, 20_000);

  it("puts friends from the dev bar and blocks from the game page in the next passes, and grants items with receipts", async () => {
    expect((await bench("/bench/state", { op: "set-friend", playerNumber: anna, friendAccountId: "ben", isFriend: true })).status).toBe(200);
    let annaPass = await passOf(anna);
    let benPass = await passOf(ben);
    expect(passesAreFriends(annaPass.claims, benPass.claims)).toBe(true);
    // The players sheet's Friend marks, as the page asks for them.
    expect((await json(await fromPage(anna, `/friends/among?player_ids=${benPass.claims.sub}`))).body.players).toEqual([{ player_id: benPass.claims.sub, name: "Ben", is_friend: true }]);
    // A friend's never set by the dev bar for a guest.
    expect((await bench("/bench/state", { op: "set-friend", playerNumber: guest, friendAccountId: "ben", isFriend: true })).body.error.code).toBe("bad_change");
    // Anna blocks Ben from the block sheet: a block ends the friendship, and holds in their passes.
    expect((await json(await fromPage(anna, `/friends/blocks/${benPass.claims.sub}`))).body).toMatchObject({ player: { name: "Ben" }, is_friend: true, is_blocked: false });
    expect((await fromPage(anna, `/friends/blocks/${benPass.claims.sub}`, undefined, "POST")).status).toBe(200);
    annaPass = await passOf(anna);
    benPass = await passOf(ben);
    expect(passesHaveBlockBetween(annaPass.claims, benPass.claims)).toBe(true);
    expect(passesAreFriends(annaPass.claims, benPass.claims)).toBe(false);

    // The game's own items, brought in from Zaisma as the bench started; the bench makes none up.
    // As the buy sheet does it: its start (the price and the saved test card), then paying with that card, from Anna's page.
    const started = await json(await fromPage(anna, `/api/buy/${SLUG}/start`, { item_name: "gold-board", item_count: 1, game_account_id: null }));
    expect(started.body).toMatchObject({ item: { title: "Gold board" }, price: { price_text: "$1.99" }, saved_card: { card_brand: "visa", card_last_digits: "4242" } });
    expect((await json(await fromPage(anna, `/api/buy/${SLUG}/start`, { item_name: "made-up", item_count: 1, game_account_id: null }))).body.error.code).toBe("no_item");
    const bought = await json(await fromPage(anna, `/api/buy/purchases/${started.body.purchase_id}/pay-with-saved-card`, {}));
    expect(bought.body.status).toBe("completed");
    const receipt = await verifyReceipt(bought.body.purchase.receipt, await keysAt("/.well-known/receipt-jwks.json"), { gameSlug: SLUG, issuerUrl: `${play.roomsUrl}/receipts` });
    expect(receipt).toMatchObject({ sub: annaPass.claims.sub, item_name: "gold-board", purchase_status: "completed", purchase_source: "grant" });
    expect((await passOf(anna)).claims.owned_item_names).toEqual(["gold-board"]);
    // A guest can't buy: the sheet asks them to sign in.
    expect((await json(await fromPage(guest, `/api/buy/${SLUG}/start`, { item_name: "gold-board", item_count: 1, game_account_id: null }))).body.error.code).toBe("account_needed");
  }, 20_000);

  it("frames each player's page, zaisma.com's game page drawn by the site's own code, under the dev bar", async () => {
    const dev = await (await fetch(`${play.benchUrl}/?player=${anna}`)).text();
    expect(dev).toContain('class="bench-bar"');
    expect(dev).not.toContain('class="playing-bar');
    expect(dev).toContain(`src="/p/${anna}/g/${SLUG}?play"`);
    expect(dev).toContain('id="bench-friends-body"');
    const response = await fetch(`${play.benchUrl}/p/${anna}/g/${SLUG}?play`);
    // Signed in: the readable cookie the page's scripts look for, for this player's page alone.
    expect(response.headers.get("set-cookie")).toBe(`zaisma_in=1; Path=/p/${anna}; SameSite=Lax`);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    const page = await response.text();
    for (const id of ["game-page-data", "buy-sheet", "players", "share-dialog", "room-dialog", "report"]) expect(page).toContain(`id="${id}"`);
    expect(page).toContain(`src="${play.gameSiteUrl}/${SLUG}/"`);
    const stylesheet = /href="(\/css\/site\.[a-z0-9]+\.css)"/.exec(page)?.[1];
    expect(stylesheet).toBeTruthy();
    expect((await fetch(`${play.benchUrl}${stylesheet}`)).status).toBe(200);
    for (const script of page.matchAll(/src="(\/js\/[a-z-]+\.[a-z0-9]+\.js)"/g)) expect((await fetch(`${play.benchUrl}${script[1]}`)).status).toBe(200);
    const font = /href="(\/fonts\/[a-z0-9.]+\.woff2)"/.exec(page)?.[1];
    expect((await fetch(`${play.benchUrl}${font}`)).headers.get("content-type")).toBe("font/woff2");
    expect((await fetch(`${play.benchUrl}/zaisma-mark-metal.svg`)).status).toBe(200);
    expect((await fetch(`${play.benchUrl}/README.md`)).status).toBe(404);
    // A guest's page drops the cookie; the sign-in is a bench page of its own.
    expect((await fetch(`${play.benchUrl}/p/${guest}/g/${SLUG}?play`)).headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await (await fromPage(guest, `/signin?next=%2Faccount%2Fkept`)).text()).toContain(`name="player" id="bench-sign-in-player" value="${guest}"`);
    // A link from the page to the game page (Join a friend) stays this player's.
    expect((await fetch(`${play.benchUrl}/g/${SLUG}?room=ABC234`, { redirect: "manual", headers: { referer: `${play.benchUrl}/p/${anna}/g/${SLUG}`, "sec-fetch-dest": "iframe" } })).headers.get("location")).toBe(`/p/${anna}/g/${SLUG}?room=ABC234`);
    expect((await fetch(`${play.benchUrl}/g/${SLUG}?room=ABC234`, { redirect: "manual", headers: { referer: `${play.benchUrl}/p/${anna}/g/${SLUG}`, "sec-fetch-dest": "document" } })).headers.get("location")).toBe(`/?player=${anna}&room=ABC234`);
    // The dev bar's sheets are the components' markup, drawn from the bench's state.
    const friends = await (await fetch(`${play.benchUrl}/bench/sheet/friends?player=${anna}`)).text();
    expect(friends).toContain('name="bench-friend"');
    expect(friends).not.toContain("&lt;");
  }, 20_000);

  it("gives two tabs opened together two players, and a tab its own player again", async () => {
    const [first, second] = await Promise.all([newPlayer(), newPlayer()]);
    expect(first).not.toBe(second);
    expect((await bench("/bench/claim", { keptPlayerNumber: anna })).body.playerNumber).toBe(anna);
  });

  it("speaks HTTPS too on the network, with a certificate of its own, and http still on this computer", async () => {
    // A folder of its own: two benches on one folder would share its game server's saved rooms.
    const networkFolder = mkdtempSync(join(tmpdir(), "zaisma-local-play-network-"));
    cpSync(folder, networkFolder, { recursive: true, filter: (source) => !source.includes(".zaisma-local") });
    const onNetwork = await startLocalPlay({ gameFolder: networkFolder, port: port + 40, gameSlug: SLUG, isOnNetwork: true, log: () => {} });
    try {
      const { certificatePem } = JSON.parse(readFileSync(join(networkFolder, ".zaisma-local", "certificate.json"), "utf8"));
      const overHttps = (portNumber: number, path: string) =>
        new Promise<string>((done, failed) => {
          secureRequest({ host: "localhost", port: portNumber, path, ca: certificatePem }, (response) => {
            let text = "";
            response.on("data", (chunk) => (text += chunk));
            response.on("end", () => done(text));
          }).on("error", failed).end();
        });
      expect(await overHttps(port + 40, "/?player=1")).toContain('id="bench-player"');
      // The game's site over HTTPS names the bench and the rooms over HTTPS, so the page's frame and calls stay secure.
      const sdk = await overHttps(port + 41, "/_zaisma/v1.js");
      expect(sdk).toContain(`"site":"https://localhost:${port + 40}"`);
      expect(sdk).toContain(`"rooms":"https://localhost:${port + 42}"`);
      expect(await (await fetch(`http://localhost:${port + 40}/?player=1`)).text()).toContain('id="bench-player"');
      if (onNetwork.networkUrl) expect(onNetwork.networkUrl).toMatch(/^https:\/\//);
    } finally {
      await onNetwork.close();
      rmSync(networkFolder, { recursive: true, force: true });
    }
  }, 30_000);

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
    // At /<slug>/ too, where the game page frames it, as Zaisma's games Worker serves a game by path.
    expect((await fetch(`${play.gameSiteUrl}/${SLUG}/`)).status).toBe(200);
    expect(await (await fetch(`${play.gameSiteUrl}/${SLUG}/_zaisma/v1.js`)).text()).toContain(`"game":"${SLUG}"`);
    expect((await fetch(`${play.gameSiteUrl}/${SLUG}/zaisma-server.js`)).status).toBe(404);
  }, 20_000);

  it("starts the game server again when its file changes, with the room's match as it was", async () => {
    const code = (await rooms("/v1/rooms", { gameSlug: SLUG })).body.roomCode;
    const annaPass = await passOf(anna);
    const guestPass = await passOf(guest);
    const first = await joinRoom(code, annaPass.pass);
    const second = await joinRoom(code, guestPass.pass);
    await until(() => first.players().length === 2);
    // Anna has the first seat, and drops a piece in column 3: the bottom row's fourth cell.
    first.socket.send(JSON.stringify({ type: "message", data: { column: 3 } }));
    const hasPiece = (messages: any[]) => messages.some((message) => Array.isArray(message?.board) && message.board[38] === 1);
    await until(() => hasPiece(second.messages));
    const startCount = play.runnerStartCount;
    appendFileSync(join(folder, "zaisma-server.js"), "\n// changed\n");
    await until(() => play.runnerStartCount > startCount, 15_000);
    await until(() => first.socket.readyState === WebSocket.CLOSED && second.socket.readyState === WebSocket.CLOSED, 15_000);
    // One try at a time until the restarted game server takes her: a second connection as the same player would replace the first.
    let back: Awaited<ReturnType<typeof joinRoom>> | null = null;
    let isTrying = false;
    await until(() => {
      if (!back && !isTrying) {
        isTrying = true;
        joinRoom(code, annaPass.pass).then((joined) => (back = joined), () => {}).finally(() => (isTrying = false));
      }
      return back !== null;
    }, 15_000);
    // Back in the room the restart brought back: the board still has her piece.
    await until(() => hasPiece(back!.messages), 10_000);
    back!.socket.close();
  }, 60_000);

  it("keeps an account's cloud save and the bench's players across a restart", async () => {
    const saveData = { save_format_version_number: 1, local_storage_items: { level: "3" }, indexeddb_databases: [] };
    // As the page's saves script does: a save on version 0, then one that's behind is refused.
    const saved = await json(await fromPage(anna, `/api/saves/${SLUG}`, { base_version_number: 0, save_json: JSON.stringify(saveData), version_id: "version_local" }, "PUT"));
    expect(saved.body.version_number).toBe(1);
    expect((await fromPage(anna, `/api/saves/${SLUG}`, { base_version_number: 0, save_json: "{}", version_id: "version_local" }, "PUT")).status).toBe(409);
    expect((await fromPage(guest, `/api/saves/${SLUG}`)).status).toBe(401);
    const annaId = (await passOf(anna)).claims.sub;
    const guestId = (await passOf(guest)).claims.sub;
    await play.close();
    play = await startPlay();
    expect((await json(await fromPage(anna, `/api/saves/${SLUG}`))).body).toMatchObject({ version_number: 1, save_data: saveData });
    expect((await passOf(anna)).claims.sub).toBe(annaId);
    // A guest's tab keeps its guest's pass, so the bench keeps the guest too.
    expect((await passOf(guest)).claims.sub).toBe(guestId);
    expect(existsSync(join(folder, ".zaisma-local", "keys.json"))).toBe(true);
  }, 30_000);
});
