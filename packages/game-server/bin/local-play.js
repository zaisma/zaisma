// Play your multiplayer game on your own computer: your game and its game server, with stand-ins for what
// only Zaisma does, so two browser tabs play together with no account, key or internet.
//
//   zaisma-game-server play-locally [folder] [--port 4800] [--game <slug>] [--on-network]
//
// It starts four things on consecutive ports from --port: the test bench (4800), whose dev page has the bench's own bar
// above a frame of the player's page, zaisma.com's game page drawn by the site's own code, with the bench answering its
// calls; the game's site (4801), your folder served as Zaisma serves it, with the SDK set up, framed by the player's
// page; the stand-in rooms (4802), which answers the calls the SDK makes to Zaisma's rooms and signs real player passes
// and receipts with keys made on the first run; and your game server (4803), the Node runner, as its own process.
// Different ports are different origins, so the game is on another origin from its page, as on Zaisma.
// Everything it keeps is in <folder>/.zaisma-local/. Nothing here changes the game server: it checks the
// stand-in passes the way it checks Zaisma's, against the keys the stand-in rooms publishes.
import { createServer, request as httpRequest } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { createServer as createSocketServer } from "node:net";
import { hostname as computerName } from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { networkInterfaces } from "node:os";
import { basename, extname, isAbsolute, join, relative as relativePath, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { BUSY_CLOSE_CODE, GameServerError, PASS_VERSION_NUMBER, RECEIPT_TOKEN_TYPE, RECEIPT_VERSION_NUMBER, generateSigningKey, guestName, jwks, loadSigningKey, roomCode, signPass, verifyPass } from "../src/internal.ts";
import { qrCodeModules, qrCodeSvg } from "../src/qr-code.ts";
import { ARRIVE_SCRIPT_SOURCE, FRAME_ALLOW, KEPT_SCRIPT_SOURCE, devScriptSource } from "./local-play-bench.js";
import { isCertificateGood, makeCertificate } from "./local-play-certificate.js";

/** The first of the four ports. */
export const DEFAULT_PORT_NUMBER = 4800;
/** The version the SDK's setup names. */
export const LOCAL_VERSION_ID = "version_local";
/** The folder in the game's folder that holds what the bench keeps. */
export const LOCAL_FOLDER = ".zaisma-local";
/** Every _zaisma/ file the games Worker serves, split by whether it works here or only loads and does nothing (test/node/local-play-parity.test.ts holds this to apps/games/src/index.ts). */
export const SERVED_ZAISMA_PATHS = ["_zaisma/v1.js", "_zaisma/v1.d.ts", "_zaisma/relay.js", "_zaisma/picture.js", "_zaisma/saves.js", "_zaisma/restore"];
export const ONLY_ON_ZAISMA_PATHS = ["_zaisma/performance.js", "_zaisma/warm", "_zaisma/warm.json", "_zaisma/warm.js"];
const OPTION_NAMES = ["gameFolder", "port", "isOnNetwork", "gameSlug", "zaismaKey", "developerApiUrl", "log"];
const SAVE_LIMIT_BYTES = 5 * 1024 * 1024;
const PASS_DURATION_SEC = 24 * 3600;
const SCRIPTS_VERSION_NUMBER = 7;
const SLOW_RESTART_MS = 150;
const RUNNER_START_TIMEOUT_MS = 15_000;
const LOCAL_RUNNER_KEY = "zaisma-local-key";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
};

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * The bench's Glass (bench/glass.ts): the site's components, layout and buy sheet, bundled from apps/site's source. The published package
 * carries the bundle (dist/bench/glass.js, made by scripts/build.mjs); in the repository it's bundled from the source as the bench starts,
 * so it always draws the design as it is.
 */
async function loadGlass(localFolder) {
  const built = join(here, "../bench/glass.js");
  if (existsSync(built)) return import(pathToFileURL(built).href);
  const { buildBenchGlass } = await import(pathToFileURL(join(here, "../scripts/bench.mjs")).href);
  const bundled = join(localFolder, "bench-glass.mjs");
  await buildBenchGlass(bundled);
  return import(`${pathToFileURL(bundled).href}?at=${Date.now()}`);
}

/** The brand folder the site serves its logos, favicons, loader and font from: beside the bundle in the package, at the top of the repository. */
const brandFolder = [join(here, "../bench/brand"), join(here, "../../../brand")].find((folder) => existsSync(folder)) ?? null;

/** A file of the brand folder by the path the site serves it at, or null; never its design sources or notes (brand/.assetsignore). */
function brandFile(path) {
  if (!brandFolder) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(path).replace(/^\/+/, "");
  } catch {
    return null;
  }
  const file = resolve(brandFolder, decoded);
  const inside = relativePath(brandFolder, file);
  if (!decoded || inside.startsWith("..") || isAbsolute(inside) || /\.(afdesign|md)$/i.test(file) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

/** The SDK's served files: in the repository next to the package, in the published package beside bin/. */
function sdkText(name) {
  for (const folder of [join(here, "../../sdk"), join(here, "../sdk")]) if (existsSync(join(folder, name))) return readFileSync(join(folder, name), "utf8");
  throw new GameServerError("missing_sdk_file", "sdk", `${name} is missing from this install of @zaisma/game-server.`, "Install it again: npx --yes @zaisma/game-server@1.");
}

/** A script with its setup handed in as a parameter, as the games Worker does, so the setup is never a global the game can read. */
function withSetup(parameterName, setup, script) {
  return `(function (${parameterName}) {\n${script}\n})(${JSON.stringify(setup)});\n`;
}

/** Put scripts first in <head>, before any game script runs (apps/games/src/index.ts, withScripts). */
export function withScripts(page, scriptUrls) {
  const tag = scriptUrls.map((scriptUrl) => `<script src="${scriptUrl}"></script>`).join("");
  const head = page.match(/<head(\s[^>]*)?>/i);
  if (head) return page.slice(0, head.index + head[0].length) + tag + page.slice(head.index + head[0].length);
  const html = page.match(/<html(\s[^>]*)?>/i);
  if (html) return page.slice(0, html.index + html[0].length) + tag + page.slice(html.index + html[0].length);
  const doctype = page.match(/^\s*<!doctype[^>]*>/i);
  return doctype ? doctype[0] + tag + page.slice(doctype[0].length) : tag + page;
}

/** The headers every file of the game's site carries: the games Worker's (packages/core/src/headers.ts), with the connect sources set to the local origins. */
export function localGameHeaders(contentType, benchOrigin, connectOrigins) {
  return {
    "Content-Type": contentType,
    "Content-Security-Policy": [
      "default-src 'self' data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      ["connect-src 'self' data: blob:", ...connectOrigins].join(" "),
      "worker-src 'self' blob:",
      "frame-src 'self'",
      "form-action 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      `frame-ancestors ${benchOrigin}`,
    ].join("; "),
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), fullscreen=(self), gamepad=(self), autoplay=(self)",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Document-Isolation-Policy": "isolate-and-credentialless",
  };
}

const randomText = (characterCount) => Array.from(crypto.getRandomValues(new Uint8Array(characterCount)), (byte) => "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36]).join("");
const now = () => Date.now();
const isoOf = (ms) => new Date(ms).toISOString();

/** A fresh bench: no players yet. Accounts are made as players sign in, and kept with their friends, blocks and items. */
function defaultState() {
  return {
    accounts: [],
    // Who each player is: their number to "guest" or an account's id.
    tabs: {},
    // Each player's guest, while they play as one: { id, name }.
    guests: {},
    friends: [],
    blocks: [],
    ownedItems: {},
    items: [],
    purchases: [],
    purchaseDelivery: "game",
    isItemsCopied: false,
    itemsCopiedAt: null,
  };
}

/** A pretty price like $1.99, in the currency's own way. */
function priceText(currencyCode, minorUnits) {
  try {
    const format = new Intl.NumberFormat("en", { style: "currency", currency: String(currencyCode).toUpperCase() });
    const fractionDigitCount = format.resolvedOptions().maximumFractionDigits;
    return format.format(minorUnits / 10 ** fractionDigitCount);
  } catch {
    return `${minorUnits} ${currencyCode}`;
  }
}

/** The game server file in the folder, as uploads find it, or null for the relay. */
export function serverEntryOf(gameFolder) {
  for (const entry of ["zaisma-server/index.js", "zaisma-server.js"]) if (existsSync(join(gameFolder, entry))) return join(gameFolder, entry);
  return null;
}

/** Whether a path in the folder is the game server's, in any case: macOS and Windows find zaisma-server.js as ZAISMA-SERVER.JS too. */
const isServerFile = (relativePath) => {
  const lowered = relativePath.toLowerCase();
  return lowered === "zaisma-server.js" || lowered.startsWith("zaisma-server/");
};

function sourceOf(gameFolder) {
  const found = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  const folder = join(gameFolder, "zaisma-server");
  if (existsSync(folder)) walk(folder);
  if (existsSync(join(gameFolder, "zaisma-server.js"))) found.push(join(gameFolder, "zaisma-server.js"));
  return found.map((path) => readFileSync(path, "utf8")).join("\n");
}

/** The first non-internal IPv4 addresses of this computer, for a phone on the same Wi-Fi. */
function networkAddresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces())) for (const each of list ?? []) if (each.family === "IPv4" && !each.internal) found.push(each.address);
  return found;
}

function checkedOptions(options) {
  const fail = (code, field, message, fix) => new GameServerError(code, field, message, fix);
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw fail("bad_option", "options", "startLocalPlay takes one object of options.", `Call startLocalPlay({ gameFolder }), with any of: ${OPTION_NAMES.join(", ")}.`);
  for (const field of Object.keys(options)) if (!OPTION_NAMES.includes(field)) throw fail("unknown_option", field, `${field} isn't a startLocalPlay option.`, `startLocalPlay takes: ${OPTION_NAMES.join(", ")}.`);
  const { gameFolder, port = DEFAULT_PORT_NUMBER, isOnNetwork = false, gameSlug = null, zaismaKey = process.env.ZAISMA_KEY ?? "", developerApiUrl = (process.env.ZAISMA_API || "https://zaisma.com").replace(/\/+$/, "") + "/api/dev", log = (line) => console.log(line) } = options;
  if (typeof gameFolder !== "string" || !gameFolder) throw fail("bad_option", "gameFolder", "gameFolder is missing.", "Give the folder of your game, the one with index.html at the top.");
  if (!Number.isInteger(port) || port < 1 || port > 65532) throw fail("bad_option", "port", "port isn't a whole number from 1 to 65532.", "Give the first of four ports, like 4800: the bench, the game's site, the stand-in rooms and your game server take it and the next three.");
  if (typeof isOnNetwork !== "boolean") throw fail("bad_option", "isOnNetwork", "isOnNetwork isn't true or false.", "Give true to let a phone on the same Wi-Fi in, or leave it out.");
  if (gameSlug !== null && !(typeof gameSlug === "string" && /^[a-z0-9-]{1,40}$/.test(gameSlug))) throw fail("bad_option", "gameSlug", "gameSlug isn't a game's slug.", "A slug is 1 to 40 lowercase letters, digits or hyphens, like sky-hopper.");
  if (typeof log !== "function") throw fail("bad_option", "log", "log isn't a function.", "Give a function that takes one line of text, or leave it out to print to the terminal.");
  return { gameFolder: resolve(gameFolder), port, isOnNetwork, gameSlug, zaismaKey, developerApiUrl, log };
}

/**
 * Start the bench for a game folder. Options (all closed, as startServer's): gameFolder (required), port
 * (4800: the first of four), isOnNetwork (false: localhost only), gameSlug (by default the folder's name),
 * zaismaKey (an API key; with gameSlug, each start brings in the game's items from Zaisma; by default the
 * ZAISMA_KEY environment variable), developerApiUrl (where that copy is read from) and log (a function for lines
 * of text; by default the terminal). Answers { benchUrl, gameSiteUrl, roomsUrl, networkUrl, runnerStartCount,
 * close() }: close() saves every room first and finishes once everything has stopped.
 */
export async function startLocalPlay(givenOptions) {
  const { gameFolder, port, isOnNetwork, gameSlug: givenSlug, zaismaKey, developerApiUrl, log: printLine } = checkedOptions(givenOptions);
  // Everything the bench says goes to the terminal, and the last of it to the dev page's Log.
  const logLines = [];
  const log = (line) => {
    logLines.push(line);
    if (logLines.length > 200) logLines.shift();
    printLine(line);
  };
  if (!existsSync(gameFolder) || !statSync(gameFolder).isDirectory()) throw new GameServerError("bad_option", "gameFolder", `${gameFolder} isn't a folder.`, "Give the folder of your game, the one with index.html at the top.");
  const gameSlug = givenSlug ?? (basename(gameFolder).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "my-game");
  // The game page's title: the one the game's own page has, else its slug.
  let gameTitle = gameSlug;
  try {
    gameTitle = /<title[^>]*>([^<]{1,80})<\/title>/i.exec(readFileSync(join(gameFolder, "index.html"), "utf8"))?.[1].trim() || gameSlug;
  } catch {
    // No index.html yet: the game's site says it's missing.
  }
  const ports = { bench: port, game: port + 1, rooms: port + 2, runner: port + 3 };
  const host = isOnNetwork ? undefined : "127.0.0.1";
  const localFolder = join(gameFolder, LOCAL_FOLDER);
  mkdirSync(join(localFolder, "saves"), { recursive: true });

  // --- The keys: one pair for passes, one for receipts, made on the first run ---
  const keysFile = join(localFolder, "keys.json");
  let keyTexts = existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, "utf8")) : null;
  if (!keyTexts?.pass || !keyTexts?.receipt) {
    keyTexts = { pass: await generateSigningKey(), receipt: await generateSigningKey() };
    writeFileSync(keysFile, JSON.stringify(keyTexts, null, 2));
  }
  const passSigning = await loadSigningKey(keyTexts.pass);
  const receiptSigning = await loadSigningKey(keyTexts.receipt);

  // --- The bench's state: who each tab is, friends, blocks, items. It survives a restart ---
  const stateFile = join(localFolder, "bench.json");
  const state = existsSync(stateFile) ? { ...defaultState(), ...JSON.parse(readFileSync(stateFile, "utf8")) } : defaultState();
  const saveState = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
  // Players made before they had an age and a social mode: grown-ups, playing as their chat setting said.
  for (const account of state.accounts) {
    if (!account.ageBand) account.ageBand = "18+";
    if (!account.socialMode) account.socialMode = account.whoCanChat === "nobody" ? "solo_focused" : account.whoCanChat === "friends" ? "friends_focused" : "open_and_social";
    delete account.whoCanChat;
  }
  if (!existsSync(stateFile)) saveState();
  // The game's items are the ones it has on Zaisma, brought in at every start with --game and a key: an item the bench made up would
  // be one the game's code has never heard of. Offline, the bench keeps the ones it brought in last.
  if (givenSlug && zaismaKey) {
    try {
      const response = await fetch(`${developerApiUrl}/games/${givenSlug}/items`, { headers: { authorization: `Bearer ${zaismaKey}` } });
      if (response.ok) {
        const answered = await response.json();
        state.items = Object.values(answered.items ?? {}).map((listedItem) => ({ itemName: listedItem.item_name, title: listedItem.title, description: listedItem.description ?? "", itemKind: listedItem.item_kind, itemCategory: listedItem.item_category, priceMinorUnits: listedItem.price_minor_units ?? null, currencyCode: listedItem.currency_code ?? null }));
        const itemNames = new Set(state.items.map((listedItem) => listedItem.itemName));
        for (const [accountId, owned] of Object.entries(state.ownedItems)) state.ownedItems[accountId] = owned.filter((itemName) => itemNames.has(itemName));
        if (answered.purchase_delivery) state.purchaseDelivery = answered.purchase_delivery;
        state.isItemsCopied = true;
        state.itemsCopiedAt = isoOf(now());
        saveState();
        log(`Brought in ${state.items.length} item${state.items.length === 1 ? "" : "s"} from ${givenSlug} on Zaisma.`);
      } else log(`Couldn't bring in ${givenSlug}'s items from Zaisma (${response.status}): ${state.items.length ? "the bench keeps the ones it brought in last" : "the game has none here"}. Check ZAISMA_KEY reaches the game.`);
    } catch {
      log(`Couldn't reach Zaisma for ${givenSlug}'s items: ${state.items.length ? "the bench keeps the ones it brought in last" : "the game has none here"}.`);
    }
  }
  const glass = await loadGlass(localFolder);
  const accountOf = (id) => state.accounts.find((account) => account.id === id) ?? null;
  const accountOfPlayer = (playerId) => state.accounts.find((account) => account.playerId === playerId) ?? null;
  const asOf = (playerNumber) => state.tabs[playerNumber] ?? "guest";
  const isPair = (pair, first, second) => (pair[0] === first && pair[1] === second) || (pair[0] === second && pair[1] === first);

  // --- Origins: the browser reaches them by whatever address it was given (localhost, or the computer's address on the network) ---
  const localhostOrigin = (portNumber) => `http://localhost:${portNumber}`;
  const issuerUrl = localhostOrigin(ports.rooms);
  // Over the network the bench speaks HTTPS too (a phone's browser may insist), on the same ports: each origin is the scheme the request came by.
  const schemeOf = (request) => (request.socket.encrypted ? "https" : "http");
  const originFor = (request, portNumber) => `${schemeOf(request)}://${hostnameOf(request)}:${portNumber}`;
  const hostnameOf = (request) => /^(\[[^\]]+\]|[^:]+)/.exec(request.headers.host ?? "localhost")?.[1] ?? "localhost";
  const isGameOrigin = (origin) => typeof origin === "string" && URL.canParse(origin) && new URL(origin).port === String(ports.game) && ["http:", "https:"].includes(new URL(origin).protocol);
  const addresses = isOnNetwork ? networkAddresses() : [];
  const networkOrigin = addresses.length ? `https://${addresses[0]}:${ports.bench}` : null;

  // The bench's own certificate, made on this computer for its names and addresses and kept until they change or it nears its end.
  let certificate = null;
  if (isOnNetwork) {
    const certificateFile = join(localFolder, "certificate.json");
    const names = [...new Set(["localhost", "127.0.0.1", "::1", computerName(), `${computerName().split(".")[0]}.local`, ...addresses])].filter((each) => /^[A-Za-z0-9.:-]+$/.test(each));
    const kept = existsSync(certificateFile) ? JSON.parse(readFileSync(certificateFile, "utf8")) : null;
    certificate = kept && isCertificateGood(kept, names) ? kept : makeCertificate(names);
    if (certificate !== kept) writeFileSync(certificateFile, JSON.stringify(certificate, null, 2));
  }

  // --- Passes and receipts ---
  const roomKeys = new Map(); // key -> { playerNumber, as }
  const guestOf = (playerNumber) => {
    // Kept with the bench, as the tab keeps its guest's pass: a restart, or the tab coming back, is the same guest.
    if (!state.guests[playerNumber]) {
      state.guests[playerNumber] = { id: `player_${randomText(10)}`, name: guestName() };
      saveState();
    }
    return state.guests[playerNumber];
  };
  const tagsOf = (accountIds) => accountIds.map((id) => accountOf(id)?.playerTagId).filter(Boolean);
  const friendIdsOf = (accountId) => state.friends.filter((pair) => pair.includes(accountId)).map((pair) => pair.find((id) => id !== accountId));
  const blockIdsOf = (accountId) => [...new Set(state.blocks.filter((block) => block.blocker === accountId || block.blocked === accountId).map((block) => (block.blocker === accountId ? block.blocked : block.blocker)))];
  const ownedNamesOf = (accountId) => state.ownedItems[accountId] ?? [];

  async function passFor(as, playerNumber) {
    const nowSec = Math.floor(now() / 1000);
    const account = as === "guest" ? null : accountOf(as);
    const player = account ? { id: account.playerId, name: account.username, kind: "account" } : { ...guestOf(playerNumber), kind: "guest" };
    // Who they chat with, by Zaisma's own rules for their age and social mode, and an opaque chat group for their band, never the age.
    const chat = account ? glass.chatOf(account.ageBand, account.socialMode) : null;
    const claims = account
      ? {
          sub: account.playerId, aud: gameSlug, iss: issuerUrl, pass_version_number: PASS_VERSION_NUMBER, kind: "account",
          who_can_chat: chat.whoCanChat, ...(chat.bandGroup ? { chat_group_id: `chat_group_${createHash("sha256").update(`local:${gameSlug}:${chat.bandGroup}`).digest("hex").slice(0, 24)}` } : {}),
          player_tag_id: account.playerTagId, friend_player_tag_ids: tagsOf(friendIdsOf(account.id)), block_player_tag_ids: tagsOf(blockIdsOf(account.id)),
          owned_item_names: ownedNamesOf(account.id), iat: nowSec, exp: nowSec + PASS_DURATION_SEC,
        }
      : { sub: player.id, name: player.name, aud: gameSlug, iss: issuerUrl, pass_version_number: PASS_VERSION_NUMBER, kind: "guest", owned_item_names: [], iat: nowSec, exp: nowSec + PASS_DURATION_SEC };
    return { pass: await signPass(passSigning, claims), player, expiresAt: isoOf((nowSec + PASS_DURATION_SEC) * 1000) };
  }

  const encoder = new TextEncoder();
  const base64Url = (bytes) => Buffer.from(bytes).toString("base64url");
  async function signReceipt(claims) {
    const header = base64Url(encoder.encode(JSON.stringify({ alg: "EdDSA", typ: RECEIPT_TOKEN_TYPE, kid: receiptSigning.publicKey.kid })));
    const body = base64Url(encoder.encode(JSON.stringify(claims)));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, receiptSigning.key, encoder.encode(`${header}.${body}`)));
    return `${header}.${body}.${base64Url(signature)}`;
  }
  async function purchaseFor(purchase) {
    const receipt = await signReceipt({
      sub: purchase.playerId, aud: gameSlug, iss: `${issuerUrl}/receipts`, jti: purchase.id, receipt_version_number: RECEIPT_VERSION_NUMBER, purchase_id: purchase.id, purchased_at: purchase.purchasedAt,
      purchase_status: purchase.refundedAt ? "refunded" : "completed", item_name: purchase.itemName, item_kind: purchase.itemKind, item_count: purchase.itemCount, purchase_source: "grant", paid_minor_units: null, currency_code: null,
      game_account_id: purchase.gameAccountId, iat: Math.floor(now() / 1000),
    });
    return {
      id: purchase.id, itemName: purchase.itemName, itemKind: purchase.itemKind, itemCount: purchase.itemCount, purchaseSource: "grant", purchaseStatus: purchase.refundedAt ? "refunded" : "completed", gameAccountId: purchase.gameAccountId,
      paidMinorUnits: null, currencyCode: null, purchasedAt: purchase.purchasedAt, refundedAt: purchase.refundedAt ?? null, receipt,
    };
  }
  async function claimsOf(pass) {
    try {
      return await verifyPass(typeof pass === "string" ? pass : "", [passSigning.publicKey], { gameSlug, issuerUrl });
    } catch {
      return null;
    }
  }

  // --- Players: every tab or phone that opens the bench is a new player, numbered as it arrives, a guest until it signs in ---
  // A player's page is /p/<number>/g/<slug>, so the requests its page makes say whose they are: same-origin requests carry the page as their
  // referrer. The readable sign-in cookie the page's scripts look for is set for that path alone, so each player's page reads its own.
  // The dev page asks for the state about once a second, which says the player is still here, and says when it closes. One not heard from
  // for 70 seconds is gone too: a browser slows a background tab's timers to once a minute. (Polling, not a held-open stream per tab: a
  // browser holds at most six connections to one address.)
  const PLAYER_OPEN_MS = 70_000;
  const PLAYER_PATH = /^\/p\/([1-9][0-9]{0,3})(?=\/|$)/;
  const heardAtMs = new Map(); // player number -> when its dev page last asked
  const lastRoomCodes = new Map(); // player number -> the room it was last seen in, to go back to after a sign-in that left the page
  let reloadNumber = 0;
  /** Tell every dev page to reload its game, at its next ask. */
  const tell = (event) => {
    if (event === "reload") reloadNumber++;
  };
  const alive = { has: (playerNumber) => now() - (heardAtMs.get(playerNumber) ?? 0) < PLAYER_OPEN_MS };
  const openPlayerNumbers = () => [...heardAtMs.keys()].filter((playerNumber) => alive.has(playerNumber)).sort((first, second) => first - second);
  const nextPlayerNumber = () => {
    let playerNumber = 1;
    while (alive.has(playerNumber)) playerNumber++;
    return playerNumber;
  };
  /**
   * A tab's player. A tab keeps its number (the dev page keeps it in sessionStorage, as the game keeps its pass there), so coming back is the
   * same player. A new tab takes the first number nobody holds, at once, so two tabs opened together are two players, and starts as a new guest.
   */
  const claimPlayer = (keptNumber) => {
    if (Number.isInteger(keptNumber) && keptNumber > 0 && keptNumber <= 9999) {
      heardAtMs.set(keptNumber, now());
      return keptNumber;
    }
    const playerNumber = nextPlayerNumber();
    heardAtMs.set(playerNumber, now());
    state.tabs[playerNumber] = "guest";
    delete state.guests[playerNumber];
    saveState();
    return playerNumber;
  };
  const roomsTracked = new Map(); // code -> { sockets: Set<{ isSpectator, playerId }>, isListed, name, labels, maximumPlayerCount, isOpen }
  const ownRooms = new Map(); // player id -> { roomCode, friendJoinsEnabled }
  const saidOnce = new Set();
  const logOnce = (line) => {
    if (saidOnce.has(line)) return;
    saidOnce.add(line);
    log(line);
  };

  /** The player a request is from: its own path (/p/<number>/...), or the page it was made on, theirs or their dev page (/?player=). 0 for none. */
  const playerNumberOf = (request, url) => {
    const own = PLAYER_PATH.exec(url.pathname);
    if (own) return Number(own[1]);
    const referrer = request.headers.referer;
    if (!referrer || !URL.canParse(referrer)) return 0;
    const from = new URL(referrer);
    const page = PLAYER_PATH.exec(from.pathname);
    if (page) return Number(page[1]);
    const devNumber = from.pathname === "/" ? Number(from.searchParams.get("player")) : 0;
    return Number.isInteger(devNumber) && devNumber > 0 && devNumber <= 9999 ? devNumber : 0;
  };
  const playingAccount = (playerNumber) => (asOf(playerNumber) === "guest" ? null : accountOf(asOf(playerNumber)));
  const playerIdOf = (playerNumber) => playingAccount(playerNumber)?.playerId ?? state.guests[playerNumber]?.id ?? null;
  const roomOfPlayerId = (playerId) => (playerId ? ([...roomsTracked].find(([, room]) => [...room.sockets].some((each) => each.playerId === playerId && !each.isSpectator))?.[0] ?? null) : null);

  /** A friend's account's friends playing the game now, as on Zaisma: a player open as them, or a room they're in. */
  function friendsPlaying(accountId) {
    const playingIds = new Set(openPlayerNumbers().map((playerNumber) => asOf(playerNumber)));
    return friendIdsOf(accountId).map((id) => accountOf(id)).filter(Boolean).flatMap((friend) => {
      const code = roomOfPlayerId(friend.playerId);
      const ownRoom = ownRooms.get(friend.playerId) ?? null;
      if (!code && !ownRoom && !playingIds.has(friend.id)) return [];
      return [{ playerId: friend.playerId, username: friend.username, roomCode: code ?? (ownRoom?.friendJoinsEnabled ? ownRoom.roomCode : null), ownRoom }];
    });
  }

  /** A room key for the player, as Zaisma hands one to the page as Play is pressed: the stand-in rooms swaps it for the player's pass. */
  function roomKeyFor(playerNumber) {
    const as = asOf(playerNumber);
    const key = `local_key_${randomText(24)}`;
    roomKeys.set(key, { playerNumber, as });
    return { key, playerKind: as === "guest" ? "guest" : "account" };
  }

  // The bench's players, made on this computer with Zaisma's own age bands and social modes: no passwords, kept in bench.json.
  const EXAMPLE_NAMES = ["Anna", "Ben", "Carla", "David", "Emma", "Felix", "Grace", "Henry", "Iris", "Jonas", "Lena", "Max"];
  const suggestedName = () => EXAMPLE_NAMES.find((name) => !state.accounts.some((account) => account.username === name)) ?? `Player ${state.accounts.length + 1}`;
  const AGE_BANDS = ["13-15", "16-17", "18+"];
  const isUsername = (name) => /^[\p{L}\p{N} _-]{1,20}$/u.test(name);
  const accountByName = (username) => state.accounts.find((account) => account.username.toLowerCase() === username.toLowerCase()) ?? null;
  function makeAccount(username, ageBand = "18+", socialMode = glass.startingSocialMode(ageBand)) {
    const base = username.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "player";
    let id = base;
    for (let suffixNumber = 2; accountOf(id); suffixNumber++) id = `${base}-${suffixNumber}`;
    const account = { id, username, playerId: `player_${randomText(10)}`, playerTagId: `player_tag_${randomText(12)}`, ageBand, socialMode };
    state.accounts.push(account);
    return account;
  }
  /** Why a profile can't be, or null: a name that's a name and not another player's, a band, and a social mode the band can choose. */
  function profileRefusal(username, ageBand, socialMode, exceptId = null) {
    if (!isUsername(username)) return "A name is 1 to 20 letters, digits, spaces, hyphens or underscores.";
    if (state.accounts.some((account) => account.id !== exceptId && account.username.toLowerCase() === username.toLowerCase())) return `There's a player named ${username} already.`;
    if (!AGE_BANDS.includes(ageBand)) return "Pick an age.";
    if (!glass.isSocialModeAllowed(ageBand, socialMode)) return ageBand === "13-15" ? "13–15 can be solo-focused or friends-focused, as on Zaisma." : "Pick how they play.";
    return null;
  }
  /** Signs a player (tab) in as an account, most recent first in the player menu. */
  function signInAs(playerNumber, account) {
    state.tabs[playerNumber] = account.id;
    state.accounts = [account, ...state.accounts.filter((each) => each.id !== account.id)];
    saveState();
    log(`Player ${playerNumber} signed in as ${account.username}.`);
  }

  /** A purchase for an account: bought through the buy sheet with the test card, or granted from the player's details. */
  async function addPurchase(account, listedItem, itemCount, gameAccountId, source, purchaseId = `purchase_${randomText(12)}`) {
    const deliveredItemCount = listedItem.itemKind === "consumable" ? itemCount : 1;
    const purchase = { id: purchaseId, playerId: account.playerId, accountId: account.id, itemName: listedItem.itemName, itemKind: listedItem.itemKind, itemCount: deliveredItemCount, gameAccountId: gameAccountId ?? null, purchasedAt: isoOf(now()), isHandled: false, source, refundedAt: null };
    state.purchases.push(purchase);
    if (listedItem.itemKind === "permanent") state.ownedItems[account.id] = [...new Set([...ownedNamesOf(account.id), listedItem.itemName])];
    saveState();
    return purchase;
  }
  async function buy(playerNumber, itemName, itemCount, gameAccountId, purchaseId = `purchase_${randomText(12)}`) {
    const listedItem = state.items.find((each) => each.itemName === itemName);
    if (!listedItem) return { error: { code: "no_item", message: `The game has no item named ${itemName} on Zaisma.`, fix: "Set it on Zaisma (zaisma items set), then start the bench again." } };
    const account = playingAccount(playerNumber);
    if (!account) return { error: { code: "account_needed", message: "Buying is for players signed in, and this player is a guest.", fix: "Sign in from the buy sheet." } };
    return { purchase: await purchaseFor(await addPurchase(account, listedItem, itemCount, gameAccountId, "bought", purchaseId)) };
  }

  /** What the dev page and its sheets show for a player. */
  function devViewFor(playerNumber) {
    const account = playingAccount(playerNumber);
    return {
      gameSlug, playerNumber, accountName: account?.username ?? null, roomCode: roomOfPlayerId(playerIdOf(playerNumber)),
      players: state.accounts.map((each) => ({ playerId: each.playerId, name: each.username, isThisTab: each.id === account?.id })),
      networkUrl: networkOrigin, logLines: [...logLines],
    };
  }

  const matches = (searchText, ...texts) => !searchText || texts.some((text) => text.toLowerCase().includes(searchText.toLowerCase()));
  const titleOf = (itemName) => state.items.find((listedItem) => listedItem.itemName === itemName)?.title ?? itemName;
  const openNumbersOf = (account) => openPlayerNumbers().filter((each) => asOf(each) === account.id);
  const blockedIdsOf = (account) => state.blocks.filter((block) => block.blocker === account.id).map((block) => block.blocked);
  const blockerIdsOf = (account) => state.blocks.filter((block) => block.blocked === account.id).map((block) => block.blocker);
  const playerIdsOf = (accountIds) => accountIds.map((id) => accountOf(id)?.playerId).filter(Boolean);

  // --- The bench's API: everything the Players panel and the dev bar do, as JSON, for the developer's AI as much as for the panel ---
  // Players are named by their player_id, the ID games see. Answers and errors are shaped as Zaisma's developer API's.
  const apiPlayer = (account) => ({
    player_id: account.playerId, name: account.username, age_band: account.ageBand, social_mode: account.socialMode, who_can_chat: glass.chatOf(account.ageBand, account.socialMode).whoCanChat,
    open_player_numbers: openNumbersOf(account), friend_player_ids: playerIdsOf(friendIdsOf(account.id)), block_player_ids: playerIdsOf(blockedIdsOf(account)),
    blocked_by_player_ids: playerIdsOf(blockerIdsOf(account)), owned_item_names: ownedNamesOf(account.id),
  });
  const apiPurchase = (purchase) => ({
    purchase_id: purchase.id, player_id: purchase.playerId, item_name: purchase.itemName, item_count: purchase.itemCount, purchase_source: purchase.source === "bought" ? "test_card" : "grant",
    purchased_at: purchase.purchasedAt, is_handled: purchase.isHandled, refunded_at: purchase.refundedAt ?? null,
  });
  const apiOpenPlayer = (playerNumber) => ({ player_number: playerNumber, player_id: playingAccount(playerNumber)?.playerId ?? null, kind: playingAccount(playerNumber) ? "account" : "guest", room_code: roomOfPlayerId(playerIdOf(playerNumber)), url: `${localhostOrigin(ports.bench)}/?player=${playerNumber}` });

  async function answerApi(request, response, url) {
    const reply = (status, body, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
      response.end(JSON.stringify(body));
    };
    const fail = (status, code, message, fix) => reply(status, { error: { code, message, fix } });
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method;
    const body = method === "GET" || method === "DELETE" ? {} : await readJson(request);
    const noPlayer = () => fail(404, "no_player", "The bench has no player with that player_id.", "GET /bench/api/players lists them.");
    if (path === "/bench/api" && method === "GET") {
      return reply(200, {
        game_slug: gameSlug, bench_url: localhostOrigin(ports.bench), network_url: networkOrigin, game_site_url: localhostOrigin(ports.game), rooms_url: issuerUrl,
        players: state.accounts.map(apiPlayer), open_players: openPlayerNumbers().map(apiOpenPlayer),
        rooms: [...roomsTracked].map(([code, room]) => ({ room_code: code, player_count: [...room.sockets].filter((each) => !each.isSpectator).length })),
        items: state.items.map((listedItem) => ({ item_name: listedItem.itemName, title: listedItem.title, item_kind: listedItem.itemKind, price_text: listedItem.priceMinorUnits === null || !listedItem.currencyCode ? null : priceText(listedItem.currencyCode, listedItem.priceMinorUnits) })),
      });
    }
    if (path === "/bench/api/log" && method === "GET") return reply(200, { log_lines: [...logLines] });
    if (path === "/bench/api/players" && method === "GET") return reply(200, { players: state.accounts.map(apiPlayer) });
    // A new player: any of a name, an age band and a social mode, each left out taking the next example name and Zaisma's defaults.
    if (path === "/bench/api/players" && method === "POST") {
      const ageBand = body.age_band ?? "18+";
      const socialMode = body.social_mode ?? (AGE_BANDS.includes(ageBand) ? glass.startingSocialMode(ageBand) : "friends_focused");
      const username = typeof body.name === "string" ? body.name.trim() : suggestedName();
      const refused = profileRefusal(username, ageBand, socialMode);
      if (refused) return fail(400, "bad_player", refused, "Give a name of 1 to 20 letters, digits, spaces, hyphens or underscores, an age_band (13-15, 16-17, 18+) and a social_mode the band can choose.");
      const account = makeAccount(username, ageBand, socialMode);
      saveState();
      log(`Made ${username}.`);
      return reply(201, { player: apiPlayer(account) });
    }
    if (path === "/bench/api/open-players" && method === "GET") return reply(200, { open_players: openPlayerNumbers().map(apiOpenPlayer) });
    // A new player (tab) for the AI or a script to open: as a guest, or signed in as one of the bench's players; in a room when it names one.
    if (path === "/bench/api/open-players" && method === "POST") {
      const account = body.player_id ? accountOfPlayer(body.player_id) : null;
      if (body.player_id && !account) return noPlayer();
      const playerNumber = claimPlayer();
      if (account) signInAs(playerNumber, account);
      const room = typeof body.room_code === "string" && /^[A-Z0-9]{6}$/.test(body.room_code) ? body.room_code : null;
      return reply(201, { ...apiOpenPlayer(playerNumber), url: `${localhostOrigin(ports.bench)}/?player=${playerNumber}${room ? `&room=${room}` : ""}` });
    }
    const openMatch = /^\/bench\/api\/open-players\/([1-9][0-9]{0,3})(\/pass)?$/.exec(path);
    if (openMatch) {
      const playerNumber = Number(openMatch[1]);
      // A pass for the player, as the game gets one: for a script that joins the game server's rooms itself, over a WebSocket with the game site's Origin.
      if (openMatch[2] && method === "POST") {
        const given = await passFor(asOf(playerNumber), playerNumber);
        return reply(200, { pass: given.pass, player: given.player, expires_at: given.expiresAt, game_slug: gameSlug, rooms_url: issuerUrl, game_site_url: localhostOrigin(ports.game) });
      }
      // Who this player plays as: one of the bench's players, or null for a new guest.
      if (!openMatch[2] && method === "PUT") {
        if (body.player_id === null) {
          state.tabs[playerNumber] = "guest";
          delete state.guests[playerNumber];
          saveState();
          log(`Player ${playerNumber} signed out.`);
        } else {
          const account = accountOfPlayer(body.player_id);
          if (!account) return noPlayer();
          signInAs(playerNumber, account);
        }
        heardAtMs.set(playerNumber, now());
        return reply(200, apiOpenPlayer(playerNumber), { "Set-Cookie": signedInCookie(playerNumber) });
      }
    }
    const playerMatch = /^\/bench\/api\/players\/(player_[a-z0-9]{1,40})(\/.*)?$/.exec(path);
    if (!playerMatch) return fail(404, "not_local", `${method} ${path} isn't a call of the bench's API.`, "GET /bench/api says what the bench has; the README's \"Play it on your own computer\" lists every call.");
    const account = accountOfPlayer(playerMatch[1]);
    if (!account) return noPlayer();
    const rest = playerMatch[2] ?? "";
    const done = () => {
      saveState();
      return reply(200, { player: apiPlayer(account) });
    };
    if (rest === "" && method === "GET") return reply(200, { player: apiPlayer(account), purchases: state.purchases.filter((purchase) => purchase.accountId === account.id).map(apiPurchase) });
    if (rest === "" && method === "PATCH") {
      const username = typeof body.name === "string" ? body.name.trim() : account.username;
      const ageBand = body.age_band ?? account.ageBand;
      // A band that can't keep the social mode takes the band's starting one, as Zaisma's account page does.
      const socialMode = body.social_mode ?? (glass.isSocialModeAllowed(ageBand, account.socialMode) ? account.socialMode : glass.startingSocialMode(ageBand));
      const refused = profileRefusal(username, ageBand, socialMode, account.id);
      if (refused) return fail(400, "bad_player", refused, "Give a name of 1 to 20 letters, digits, spaces, hyphens or underscores, an age_band (13-15, 16-17, 18+) and a social_mode the band can choose.");
      Object.assign(account, { username, ageBand, socialMode });
      return done();
    }
    if (rest === "" && method === "DELETE") {
      state.accounts = state.accounts.filter((each) => each.id !== account.id);
      state.friends = state.friends.filter((pair) => !pair.includes(account.id));
      state.blocks = state.blocks.filter((block) => block.blocker !== account.id && block.blocked !== account.id);
      state.purchases = state.purchases.filter((purchase) => purchase.accountId !== account.id);
      delete state.ownedItems[account.id];
      for (const [playerNumber, as] of Object.entries(state.tabs)) if (as === account.id) state.tabs[playerNumber] = "guest";
      rmSync(saveFileOf(account.id), { force: true });
      saveState();
      log(`Deleted ${account.username}.`);
      return reply(200, { is_deleted: true });
    }
    const pairMatch = /^\/(friends|blocks)\/(player_[a-z0-9]{1,40})$/.exec(rest);
    if (pairMatch && (method === "PUT" || method === "DELETE")) {
      const other = accountOfPlayer(pairMatch[2]);
      if (!other || other.id === account.id) return fail(404, "no_player", "That's not another of the bench's players.", "GET /bench/api/players lists them.");
      if (pairMatch[1] === "friends") {
        state.friends = state.friends.filter((pair) => !isPair(pair, account.id, other.id));
        if (method === "PUT") {
          if (state.blocks.some((block) => isPair([block.blocker, block.blocked], account.id, other.id))) return fail(409, "blocked_pair", `${account.username} and ${other.username} can't be friends while one blocks the other.`, "Remove the block first: DELETE .../blocks/<player_id>.");
          state.friends.push([account.id, other.id]);
        }
      } else {
        state.blocks = state.blocks.filter((block) => !(block.blocker === account.id && block.blocked === other.id));
        if (method === "PUT") {
          // A block ends a friendship too, as on Zaisma.
          state.friends = state.friends.filter((pair) => !isPair(pair, account.id, other.id));
          state.blocks.push({ blocker: account.id, blocked: other.id });
        }
      }
      return done();
    }
    // Grant one of the game's items: a purchase the game gets as Zaisma would send it.
    if (rest === "/items" && method === "POST") {
      const listedItem = state.items.find((each) => each.itemName === body.item_name);
      if (!listedItem) return fail(404, "no_item", `The game has no item named ${String(body.item_name)} on Zaisma.`, "GET /bench/api lists its items.");
      const itemCount = Number.isInteger(body.item_count) && body.item_count > 0 ? body.item_count : 1;
      const purchase = await addPurchase(account, listedItem, itemCount, typeof body.game_account_id === "string" ? body.game_account_id : null, "grant");
      log(`Granted ${listedItem.title} to ${account.username}.`);
      return reply(201, { purchase: apiPurchase(purchase), player: apiPlayer(account) });
    }
    const itemMatch = /^\/items\/([^/]{1,100})$/.exec(rest);
    if (itemMatch && method === "DELETE") {
      state.ownedItems[account.id] = ownedNamesOf(account.id).filter((itemName) => itemName !== decodeURIComponent(itemMatch[1]));
      return done();
    }
    if (rest === "/purchases" && method === "GET") return reply(200, { purchases: state.purchases.filter((purchase) => purchase.accountId === account.id).map(apiPurchase) });
    const refundMatch = /^\/purchases\/(purchase_[a-z0-9]+)\/refund$/.exec(rest);
    if (refundMatch && method === "POST") {
      const purchase = state.purchases.find((each) => each.id === refundMatch[1] && each.accountId === account.id);
      if (!purchase) return fail(404, "no_purchase", "This player has no purchase with that ID.", "GET .../purchases lists them.");
      if (purchase.refundedAt) return fail(409, "already_refunded", "It was refunded already.", "Nothing to do.");
      // The game hears it as Zaisma's refund: the purchase again, refunded, and a permanent item no longer owned.
      purchase.refundedAt = isoOf(now());
      purchase.isHandled = false;
      if (purchase.itemKind === "permanent") state.ownedItems[account.id] = ownedNamesOf(account.id).filter((itemName) => itemName !== purchase.itemName);
      saveState();
      log(`Refunded ${account.username}'s ${purchase.itemName}.`);
      return reply(200, { purchase: apiPurchase(purchase), player: apiPlayer(account) });
    }
    return fail(404, "not_local", `${method} ${path} isn't a call of the bench's API.`, "The README's \"Play it on your own computer\" lists every call.");
  }

  /** A part of the Players panel, drawn afresh after every change: the list, New player, or one player's tab. */
  function panelHtml(url, place) {
    const view = url.searchParams.get("view") ?? "list";
    const searchText = (url.searchParams.get("search") ?? "").slice(0, 100);
    const current = playingAccount(place.playerNumber);
    const panelPlayer = (account) => ({ playerId: account.playerId, name: account.username, ageBand: account.ageBand, socialMode: account.socialMode, openPlayerNumbers: openNumbersOf(account) });
    const account = view === "player" ? accountOfPlayer(url.searchParams.get("player_id") ?? "") : null;
    if (view === "new") return glass.newPlayerPanelHtml({ suggestedName: suggestedName() });
    if (!account) {
      return glass.playersPanelHtml(place, { players: state.accounts.filter((each) => matches(searchText, each.username)).map(panelPlayer), currentPlayerId: current?.playerId ?? null, searchText, totalCount: state.accounts.length });
    }
    const tab = url.searchParams.get("tab") === "items" ? "items" : "profile";
    const named = (ids) => ids.map((id) => accountOf(id)).filter(Boolean).map((other) => ({ playerId: other.playerId, name: other.username }));
    const owned = new Set(ownedNamesOf(account.id));
    return glass.playerPanelHtml(place, {
      player: panelPlayer(account), isCurrent: current?.id === account.id, tab,
      friends: named(friendIdsOf(account.id)), blocked: named(blockedIdsOf(account)), blockedBy: named(blockerIdsOf(account)).map((other) => other.name),
      others: state.accounts.filter((other) => other.id !== account.id).map((other) => ({ playerId: other.playerId, name: other.username })),
      // The game's items, owned first, each with this player's purchases of it, newest first.
      items: state.items
        .filter((listedItem) => matches(searchText, listedItem.title, listedItem.itemName))
        .map((listedItem) => ({
          itemName: listedItem.itemName, title: listedItem.title, itemKind: listedItem.itemKind,
          priceText: listedItem.priceMinorUnits === null || !listedItem.currencyCode ? "only granted" : priceText(listedItem.currencyCode, listedItem.priceMinorUnits), isOwned: owned.has(listedItem.itemName),
          purchases: state.purchases
            .filter((purchase) => purchase.accountId === account.id && purchase.itemName === listedItem.itemName)
            .reverse()
            .map((purchase) => ({
              purchaseId: purchase.id,
              detail: [`${purchase.source === "bought" ? "Test card" : "Granted"}${purchase.itemCount > 1 ? ` × ${purchase.itemCount}` : ""}`, purchase.purchasedAt.slice(0, 16).replace("T", " "), purchase.isHandled ? "handled" : "waiting for the game", ...(purchase.refundedAt ? ["refunded"] : [])].join(" · "),
              isRefunded: Boolean(purchase.refundedAt),
            })),
        }))
        .sort((first, second) => Number(second.isOwned) - Number(first.isOwned) || second.purchases.length - first.purchases.length),
      searchText,
    });
  }

  const placesFor = (request) => ({ localSiteOrigin: localhostOrigin(ports.bench), gameOrigin: originFor(request, ports.game), roomsOrigin: originFor(request, ports.rooms) });
  const readText = async (request) => {
    const chunks = [];
    let sizeBytes = 0;
    for await (const chunk of request) {
      sizeBytes += chunk.length;
      if (sizeBytes > SAVE_LIMIT_BYTES * 2) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  const readJson = async (request) => {
    const text = await readText(request);
    try {
      const body = JSON.parse(text || "{}");
      return body && typeof body === "object" && !Array.isArray(body) ? body : {};
    } catch {
      return {};
    }
  };
  const sendPage = (response, page, extraHeaders = {}, httpStatus = page.httpStatus) => {
    const headers = Object.fromEntries(page.headers.filter(([name]) => !["link", "speculation-rules", "cache-control"].includes(name.toLowerCase())));
    response.writeHead(httpStatus, { ...headers, "Cache-Control": "no-store", ...extraHeaders });
    response.end(page.body);
  };
  const signedInCookie = (playerNumber) => (playingAccount(playerNumber) ? `zaisma_in=1; Path=/p/${playerNumber}; SameSite=Lax` : `zaisma_in=; Path=/p/${playerNumber}; SameSite=Lax; Max-Age=0`);

  // The buy sheet's calls (apps/site/src/buy.ts), stood in for: the price, a saved test card, and paying with it grants the item.
  const pendingSales = new Map(); // purchase id -> { playerNumber, itemName, itemCount, gameAccountId }
  const grantedPurchases = new Map(); // purchase id -> the purchase as the sheet gets it
  const sheetPurchase = (given) => ({ id: given.id, item_name: given.itemName, item_kind: given.itemKind, item_count: given.itemCount, purchase_source: given.purchaseSource, purchase_status: given.purchaseStatus, game_account_id: given.gameAccountId, paid_minor_units: given.paidMinorUnits, currency_code: given.currencyCode, purchased_at: given.purchasedAt, refunded_at: given.refundedAt, receipt: given.receipt });
  async function answerBuy(request, response, url, reply) {
    const fail = (status, code, message) => reply(status, { error: { code, message } });
    const body = await readJson(request);
    const path = url.pathname;
    if (request.method === "POST" && path === `/api/buy/${gameSlug}/start`) {
      const playerNumber = playerNumberOf(request, url);
      const listedItem = state.items.find((each) => each.itemName === body.item_name);
      if (!listedItem) return fail(404, "no_item", `This game has no item named ${String(body.item_name)} on Zaisma. Set it there (zaisma items set), then start the bench again.`);
      if (listedItem.priceMinorUnits === null || !listedItem.currencyCode) return fail(400, "not_for_sale", `${listedItem.title} isn't for sale: it's only granted.`);
      if (!playingAccount(playerNumber)) return fail(403, "account_needed", "Buying needs an account.");
      const itemCount = listedItem.itemKind === "consumable" && Number.isInteger(body.item_count) && body.item_count > 0 ? body.item_count : 1;
      const purchaseId = `purchase_${randomText(12)}`;
      pendingSales.set(purchaseId, { playerNumber, itemName: listedItem.itemName, itemCount, gameAccountId: typeof body.game_account_id === "string" ? body.game_account_id : null });
      const totalMinorUnits = listedItem.priceMinorUnits * itemCount;
      return reply(200, {
        purchase_id: purchaseId,
        item: { title: listedItem.title, description: listedItem.description },
        item_count: itemCount,
        price: { price_text: priceText(listedItem.currencyCode, totalMinorUnits), price_minor_units: totalMinorUnits, currency_code: listedItem.currencyCode },
        seller: { business_name: "the game's developer" },
        refund_policy_words: "A test on this computer: the test card is never charged.",
        // Stripe's test card, as the site's own local preview has it.
        saved_card: { card_brand: "visa", card_last_digits: "4242" },
        is_confirmation_needed: false,
        confirmation_reason: null,
        confirmation_methods: {},
        has_account_email: true,
        is_eu_withdrawal_line_shown: false,
        wallet: null,
      });
    }
    const payMatch = /^\/api\/buy\/purchases\/(purchase_[a-z0-9]+)\/pay-with-saved-card$/.exec(path);
    if (request.method === "POST" && payMatch) {
      const sale = pendingSales.get(payMatch[1]);
      if (!sale) return fail(404, "no_purchase", "That purchase isn't waiting to be paid.");
      pendingSales.delete(payMatch[1]);
      const answer = await buy(sale.playerNumber, sale.itemName, sale.itemCount, sale.gameAccountId, payMatch[1]);
      if ("error" in answer) return fail(400, answer.error.code, answer.error.message);
      const purchase = sheetPurchase(answer.purchase);
      grantedPurchases.set(purchase.id, purchase);
      return reply(200, { status: "completed", purchase });
    }
    const purchaseMatch = /^\/api\/buy\/purchases\/(purchase_[a-z0-9]+)$/.exec(path);
    if (request.method === "GET" && purchaseMatch) {
      const purchase = grantedPurchases.get(purchaseMatch[1]);
      return purchase ? reply(200, { purchase }) : fail(404, "no_purchase", "No purchase has that ID.");
    }
    return fail(404, "not_local", `${request.method} ${path} is a part of Zaisma's buy sheet the bench has no stand-in for.`);
  }

  // Cloud saves (apps/site/src/saves.ts), stood in for: one save per account, kept in .zaisma-local/saves/, with its version number.
  const saveFileOf = (accountId) => join(localFolder, "saves", `${accountId}.json`);
  const savedRowOf = (accountId) => {
    try {
      const row = JSON.parse(readFileSync(saveFileOf(accountId), "utf8"));
      return Number.isInteger(row?.version_number) ? row : null;
    } catch {
      return null;
    }
  };
  async function answerSaves(request, url, reply, playerNumber) {
    const account = playingAccount(playerNumber);
    if (!account) return reply(401, { error: "Sign in to keep your progress." });
    const rest = url.pathname.slice(`/api/saves/${gameSlug}`.length);
    const row = savedRowOf(account.id);
    if (rest === "/copies" && request.method === "GET") return reply(200, { save_copies: [] });
    if (rest.startsWith("/copies/")) return reply(404, { error: { code: "no_save_copy", message: "The bench keeps one save per account, with no earlier versions." } });
    if (rest !== "") return reply(404, { error: { code: "not_local", message: "Not a saves call." } });
    if (request.method === "GET") {
      if (url.searchParams.has("version")) return reply(200, { version_number: row?.version_number ?? 0, saved_at: row?.saved_at ?? null, changed_by_kind: row ? "player" : null });
      const tag = createHash("sha256").update(`${account.id}:${gameSlug}`).digest("hex").slice(0, 16);
      if (!row) return reply(200, { tag, version_number: 0 });
      return reply(200, { tag, version_number: row.version_number, sha256: row.sha256, saved_at: row.saved_at, changed_by_kind: "player", save_data: row.save_data });
    }
    if (request.method !== "PUT") return reply(405, { error: "PUT or GET." });
    const text = await readText(request);
    let body = {};
    try {
      body = JSON.parse(text ?? "") ?? {};
    } catch {
      body = {};
    }
    if (typeof body.save_json !== "string") return reply(400, { error: "save_json is missing." });
    if (Buffer.byteLength(body.save_json) > SAVE_LIMIT_BYTES) return reply(413, { error: "Over 5 MB." });
    let saveData;
    try {
      saveData = JSON.parse(body.save_json);
    } catch {
      return reply(400, { error: "save_json isn't JSON." });
    }
    if (body.keep === true) return reply(200, { save_copy_id: `save_copy_${randomText(12)}` });
    const currentNumber = row?.version_number ?? 0;
    if (body.replace !== true && Number(body.base_version_number) !== currentNumber) return reply(409, { error: "Played on another device.", version_number: currentNumber, saved_at: row?.saved_at ?? null, changed_by_kind: "player" });
    const saved = { version_number: currentNumber + 1, sha256: createHash("sha256").update(body.save_json).digest("hex"), saved_at: isoOf(now()), save_data: saveData };
    writeFileSync(saveFileOf(account.id), JSON.stringify(saved));
    return reply(200, { version_number: saved.version_number, sha256: saved.sha256, saved_at: saved.saved_at, kept_save_copy_id: null });
  }

  /** The calls zaisma.com's game page makes, stood in for (apps/site/src/pages.ts and the scripts and sheets it holds). */
  async function answerSite(request, response, url) {
    const reply = (status, body, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
      response.end(body === null ? undefined : JSON.stringify(body));
    };
    const noContent = () => {
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
    };
    const fragment = (markup) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(markup);
    };
    const path = url.pathname;
    const playerNumber = playerNumberOf(request, url);
    const account = playingAccount(playerNumber);
    const isPost = request.method === "POST";
    const game = `/g/${gameSlug}`;

    // The player's page: the game page as zaisma.com draws it for them.
    const page = PLAYER_PATH.exec(path);
    if (page && path === `/p/${playerNumber}${game}` && request.method === "GET") {
      const pageUrl = `${game}${url.search}`;
      const soldCategories = [...new Set(state.items.filter((listedItem) => listedItem.priceMinorUnits !== null && listedItem.currencyCode).map((listedItem) => listedItem.itemCategory))];
      const drawn = await glass.playerPage({ places: placesFor(request), gameSlug, gameTitle, pageUrl, account: account ? { id: account.id, username: account.username } : null, purchaseDelivery: state.purchaseDelivery, soldCategories });
      return sendPage(response, drawn, { "Set-Cookie": signedInCookie(playerNumber) });
    }
    if (page) return reply(404, { error: { code: "not_local", message: "A player's address holds only their game page." } });
    // A link to the game page (Join a friend, a room's link) reaches the player's own page. The game page sends its links to the top
    // window when it's framed, as in Zaisma's home, so a top-level one comes back to the player's dev page; with no player, a new one's.
    if ((path === game || path === `${game}/`) && request.method === "GET") {
      const room = /^[A-Z0-9]{6}$/.test(url.searchParams.get("room") ?? "") ? url.searchParams.get("room") : null;
      const devPath = `/?${playerNumber ? `player=${playerNumber}` : ""}${room ? `${playerNumber ? "&" : ""}room=${room}` : ""}`;
      const isFramed = request.headers["sec-fetch-dest"] === "iframe";
      response.writeHead(302, { Location: isFramed && playerNumber ? `/p/${playerNumber}${game}${url.search}` : devPath, "Cache-Control": "no-store" });
      return response.end();
    }
    if (path.startsWith("/api/buy/")) return answerBuy(request, response, url, reply);
    if (path === `/api/saves/${gameSlug}` || path.startsWith(`/api/saves/${gameSlug}/`)) return answerSaves(request, url, reply, playerNumber);

    // Play: a ticket for the time reports (which go nowhere here) and the room key. A tester link's play isn't on the bench.
    if (isPost && path === `/api/plays/${gameSlug}`) {
      const body = await readJson(request);
      if (body.ticket !== undefined || body.tester !== undefined || !playerNumber) return noContent();
      return reply(200, { ticket: `ticket_local_${randomText(12)}`, ...roomKeyFor(playerNumber) });
    }
    // A guest who signed in while playing: the account, and a room key for its pass.
    if (isPost && path === `/api/plays/${gameSlug}/account`) {
      await readJson(request);
      if (!account) return reply(401, { error: { code: "not_signed_in", message: "Not signed in." } });
      return reply(200, { player: { id: account.playerId, name: account.username, kind: "account" }, ...roomKeyFor(playerNumber) });
    }
    // Where friends see what a player plays, and what they played: only on Zaisma.
    if (isPost && (path === `/api/me/played/${gameSlug}` || path === "/api/presence" || path === "/csp-reports")) {
      await readText(request);
      return noContent();
    }
    if (request.method === "GET" && path === `${game}/live-version`) return reply(200, { live_version_id: LOCAL_VERSION_ID, live_version_match_update_mode: "next_match" });
    if (request.method === "GET" && path === `${game}/qr-code.svg`) {
      const code = /^[A-Z0-9]{6}$/.test(url.searchParams.get("room") ?? "") ? url.searchParams.get("room") : null;
      const target = `${networkOrigin ?? originFor(request, ports.bench)}/${code ? `?room=${code}` : ""}`;
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      return response.end(qrCodeSvg(target));
    }

    // Friends: who's playing, the Friend marks in the players sheet, and blocks.
    if (request.method === "GET" && path === `${game}/friends`) return fragment(account ? glass.friendsHereHtml(gameSlug, friendsPlaying(account.id)) : "");
    if (request.method === "GET" && path === `${game}/players/friends`) {
      if (!account) return reply(401, { error: { code: "not_signed_in", message: "Sign in to see your friends." } });
      const room = (url.searchParams.get("room") ?? "").toUpperCase();
      return fragment(glass.friendRowsHtml(gameSlug, friendsPlaying(account.id).filter((friend) => friend.roomCode !== room)));
    }
    if (request.method === "GET" && path === "/friends/among") {
      const given = (url.searchParams.get("player_ids") ?? "").split(",").filter(Boolean);
      if (given.length > 50 || given.some((playerId) => !/^player_[a-z0-9]{1,40}$/.test(playerId))) return reply(400, { error: { code: "bad_player_ids", message: "player_ids takes up to 50 player IDs, separated by commas." } });
      const friendIds = new Set(account ? friendIdsOf(account.id) : []);
      const players = given.map((playerId) => accountOfPlayer(playerId)).filter((other) => other && other.id !== account?.id).map((other) => ({ player_id: other.playerId, name: other.username, is_friend: friendIds.has(other.id) }));
      return reply(200, { players });
    }
    const blockMatch = /^\/friends\/blocks\/(player_[a-z0-9]{1,40})$/.exec(path);
    if (blockMatch) {
      const target = accountOfPlayer(blockMatch[1]);
      if (!account || !target || target.id === account.id) return reply(404, { error: { code: "no_player", message: "No account to block there." } });
      if (isPost) {
        await readText(request);
        // A block ends a friendship too, and holds in every game's passes from the next one on.
        state.friends = state.friends.filter((pair) => !isPair(pair, account.id, target.id));
        if (!state.blocks.some((block) => block.blocker === account.id && block.blocked === target.id)) state.blocks.push({ blocker: account.id, blocked: target.id });
        saveState();
        log(`${account.username} blocked ${target.username}.`);
        return reply(200, { is_blocked: true });
      }
      return reply(200, { player: { player_id: target.playerId, name: target.username }, is_friend: friendIdsOf(account.id).includes(target.id), is_blocked: state.blocks.some((block) => block.blocker === account.id && block.blocked === target.id) });
    }
    // A report goes to Zaisma's moderators, or the game's developer: here the terminal says what it would send.
    if (isPost && path === `${game}/report`) {
      const body = await readJson(request);
      log(`Report (not sent anywhere): ${JSON.stringify({ reason: body.reason, details: body.details, room: body.room, player: body.player?.name ?? null, hasPicture: typeof body.picture === "string" })}`);
      return reply(200, { is_game_hidden: false, is_update_paused: false });
    }
    if (isPost && path === `/api/links/${gameSlug}`) {
      await readText(request);
      logOnce("Only on Zaisma: the game's registered links (Zaisma.links.open). They're set on Zaisma, which opens them there.");
      return reply(404, { error: { code: "unknown_link", message: "The bench has none of the game's registered links: they're set on Zaisma." } });
    }

    // Signing in: Zaisma's sign-in and Make an account go to the bench's Players panel, as a page of its own.
    if ((path === "/signin" || path === "/join") && request.method === "GET") {
      const place = { playerNumber, isPage: true };
      return sendPage(response, await glass.panelPage(placesFor(request), place, panelHtml(new URL("/bench/panel", url), place)));
    }
    if (path === "/bench/panel" && request.method === "GET") {
      const askedNumber = Number(url.searchParams.get("player"));
      const place = { playerNumber: Number.isInteger(askedNumber) && askedNumber > 0 ? askedNumber : playerNumber, isPage: url.searchParams.get("page") === "yes" };
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(panelHtml(url, place));
    }
    if (path === "/bench/api" || path.startsWith("/bench/api/")) return answerApi(request, response, url);
    if (path === "/account/kept" && request.method === "GET") {
      const keptNumber = Number(url.searchParams.get("player")) || 0;
      return sendPage(response, await glass.keptPage(placesFor(request), playingAccount(keptNumber)?.username ?? null, keptNumber));
    }
    if (path === "/bench/kept.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(KEPT_SCRIPT_SOURCE);
    }
    return null;
  }

  /** The dev page's own calls. */
  async function answerBench(request, response, url) {
    const reply = (status, body, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
      response.end(JSON.stringify(body));
    };
    const path = url.pathname;
    const givenNumber = Number(url.searchParams.get("player"));
    const playerNumber = Number.isInteger(givenNumber) && givenNumber > 0 ? givenNumber : 0;
    if (path === "/bench/state" && request.method === "GET") {
      if (playerNumber) heardAtMs.set(playerNumber, now());
      const roomCode = playerNumber ? roomOfPlayerId(playerIdOf(playerNumber)) : null;
      if (roomCode) lastRoomCodes.set(playerNumber, roomCode);
      return reply(200, { reloadNumber, roomCode, openPlayerNumbers: openPlayerNumbers() });
    }
    if (path === "/bench/claim" && request.method === "POST") {
      const given = await readJson(request);
      return reply(200, { playerNumber: claimPlayer(given.keptPlayerNumber) });
    }
    if (path === "/bench/arrive.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(ARRIVE_SCRIPT_SOURCE);
    }
    if (path === "/bench/leave" && request.method === "POST") {
      heardAtMs.delete(playerNumber);
      return reply(200, { isLeft: true });
    }
    const sheetMatch = /^\/bench\/sheet\/(phone|log)$/.exec(path);
    if (sheetMatch && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(glass.devSheetBody(sheetMatch[1], devViewFor(playerNumber)));
    }
    if (path === "/bench/dev.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(devScriptSource());
    }
    if (path === "/bench/qr.svg") {
      const target = url.searchParams.get("text") ?? "";
      if (!target || target.length > 200) return reply(400, { error: { code: "bad_text", message: "text isn't a link of up to 200 characters.", fix: "Give the address to show." } });
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      return response.end(qrCodeSvg(target));
    }
    return reply(404, { error: { code: "not_local", message: `${request.method} ${path} isn't a call the bench makes.`, fix: "Open the bench at its address." } });
  }

  const benchServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://bench");
      // The dev page: a new player gets their number first, then the page frames their game page.
      if (url.pathname === "/" && request.method === "GET") {
        const givenNumber = Number(url.searchParams.get("player"));
        let room = /^[A-Z0-9]{6}$/.test(url.searchParams.get("room") ?? "") ? url.searchParams.get("room") : null;
        if (!Number.isInteger(givenNumber) || givenNumber < 1 || givenNumber > 9999) {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          return response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test bench</title><body style="margin:0;background:#000"><script src="/bench/arrive.js"></script>`);
        }
        heardAtMs.set(givenNumber, now());
        // Back from a sign-in that left the page: into the room the player was in, while it's still going.
        const lastRoom = lastRoomCodes.get(givenNumber);
        if (!room && lastRoom && roomsTracked.has(lastRoom)) room = lastRoom;
        const framePath = `/p/${givenNumber}/g/${gameSlug}${room ? `?room=${room}` : "?play"}`;
        return sendPage(response, await glass.devPage(placesFor(request), devViewFor(givenNumber), { path: framePath, allow: FRAME_ALLOW }));
      }
      if (url.pathname.startsWith("/bench/") && !/^\/bench\/(kept\.js|panel|api)(\/|$)/.test(url.pathname)) return await answerBench(request, response, url);
      const answered = await answerSite(request, response, url);
      if (answered !== null || response.headersSent) return;
      // Logos, favicons, the loader and the font, from the brand folder as the site serves it.
      const brand = brandFile(url.pathname);
      if (brand) {
        response.writeHead(200, { "Content-Type": TYPES[extname(brand).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "no-cache" });
        return response.end(readFileSync(brand));
      }
      // The site's stylesheet and scripts, by the paths its page names.
      const asset = await glass.siteAsset(url.pathname);
      if (asset) {
        response.writeHead(asset.httpStatus, asset.headers);
        return response.end(asset.body);
      }
      logOnce(`Only on Zaisma: ${request.method} ${url.pathname}`);
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`${url.pathname} is only on Zaisma. The bench is at /.`);
    } catch (error) {
      log(`The bench couldn't answer ${request.url}: ${error instanceof Error ? error.message : error}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });

  // --- The game's site ---
  const connectOriginsFor = (request) => [originFor(request, ports.rooms), originFor(request, ports.rooms).replace(/^http/, "ws"), originFor(request, ports.bench), originFor(request, ports.game)];
  const gameServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://game");
      const benchOrigin = originFor(request, ports.bench);
      const headersFor = (contentType, cacheControl = "no-cache") => ({ ...localGameHeaders(contentType, benchOrigin, connectOriginsFor(request)), "Cache-Control": cacheControl });
      const send = (status, contentType, body, cacheControl) => {
        response.writeHead(status, headersFor(contentType, cacheControl));
        response.end(request.method === "HEAD" ? undefined : body);
      };
      let path;
      try {
        path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      } catch {
        return send(400, "text/plain; charset=utf-8", "Bad address.");
      }
      // The game page frames the game at /<slug>/, as Zaisma's games Worker serves a game by path.
      if (path === gameSlug) {
        response.writeHead(301, { Location: `/${gameSlug}/${url.search}` });
        return response.end();
      }
      if (path.startsWith(`${gameSlug}/`)) path = path.slice(gameSlug.length + 1);
      if (path.startsWith("_zaisma/")) {
        const js = "text/javascript; charset=utf-8";
        if (path === "_zaisma/v1.js") {
          const config = { rooms: originFor(request, ports.rooms), game: gameSlug, site: benchOrigin, version: LOCAL_VERSION_ID, purchaseDelivery: state.purchaseDelivery };
          return send(200, js, withSetup("__ZAISMA__", config, sdkText("zaisma.js")));
        }
        if (path === "_zaisma/v1.d.ts") return send(200, "text/plain; charset=utf-8", sdkText("zaisma.d.ts"));
        if (path === "_zaisma/relay.js") return send(200, js, withSetup("__ZAISMA_RELAY__", { rooms: originFor(request, ports.rooms), game: gameSlug, site: benchOrigin, ownRelayHosts: [], fetchEarly: false }, sdkText("relay.js")));
        if (path === "_zaisma/picture.js") return send(200, js, withSetup("__ZAISMA_PICTURE__", { site: benchOrigin }, sdkText("picture.js")));
        if (path === "_zaisma/saves.js") {
          const versionId = url.searchParams.get("version_id");
          return send(200, js, withSetup("__ZAISMA_SAVES__", { site: benchOrigin, saveLimitBytes: SAVE_LIMIT_BYTES, versionId: versionId === LOCAL_VERSION_ID ? versionId : null }, sdkText("saves.js")));
        }
        if (path === "_zaisma/restore") return send(200, "text/html; charset=utf-8", `<!doctype html><meta charset="utf-8"><title>Loading</title><body style="margin:0;background:#000"><script src="saves.js?v=${SCRIPTS_VERSION_NUMBER}&version_id=${LOCAL_VERSION_ID}"></script>`);
        // Zaisma's measuring of how the game runs, and its warm-up before Play: here they load and do nothing.
        if (path === "_zaisma/performance.js" || path === "_zaisma/warm.js") return send(200, js, `// ${path} is only on Zaisma: it does nothing here.\n`);
        if (path === "_zaisma/warm") return send(200, "text/html; charset=utf-8", "<!doctype html><title>Only on Zaisma</title>");
        if (path === "_zaisma/warm.json") return send(200, "application/json", "[]");
        return send(404, "text/plain; charset=utf-8", "Not found.");
      }
      const asked = path === "" || path.endsWith("/") ? `${path}index.html` : path;
      const file = resolve(gameFolder, asked);
      // Judged on where the path lands, not how it was written (an encoded slash, .., another letter case), so the bench's
      // own folder (its signing keys) and the game server's files are never served, as on Zaisma.
      const relative = relativePath(gameFolder, file).split(sep).join("/");
      const inside = relative !== "" && !relative.startsWith("../") && relative !== ".." && !isAbsolute(relative);
      if (!inside || relative.split("/")[0].toLowerCase() === LOCAL_FOLDER || isServerFile(relative)) return send(404, "text/plain; charset=utf-8", "File not found: this game is missing a file.");
      let target = file;
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
      if (!existsSync(target)) return send(404, "text/plain; charset=utf-8", "File not found: this game is missing a file.");
      const contentType = TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
      const bytes = readFileSync(target);
      if (contentType.startsWith("text/html")) {
        const injected = withScripts(bytes.toString("utf8"), [`/_zaisma/saves.js?v=${SCRIPTS_VERSION_NUMBER}&version_id=${LOCAL_VERSION_ID}`]);
        return send(200, contentType, injected);
      }
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
      if (range && (range[1] || range[2])) {
        const startByte = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
        const endByte = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        if (startByte > endByte || startByte >= bytes.length) {
          response.writeHead(416, { "Content-Range": `bytes */${bytes.length}` });
          return response.end();
        }
        response.writeHead(206, { ...headersFor(contentType), "Accept-Ranges": "bytes", "Content-Range": `bytes ${startByte}-${endByte}/${bytes.length}`, "Content-Length": endByte - startByte + 1 });
        return response.end(request.method === "HEAD" ? undefined : bytes.subarray(startByte, endByte + 1));
      }
      response.writeHead(200, { ...headersFor(contentType), "Accept-Ranges": "bytes" });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      log(`The game's site couldn't answer ${request.url}: ${error instanceof Error ? error.message : error}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });

  // --- The stand-in rooms: Zaisma's rooms origin, answering the calls the SDK makes ---
  const roomsProfile = (account, benchOrigin) => ({ id: account.playerId, name: account.username, username: account.username, display_name: account.username, bio: "", link_urls: [], profile_url: `${benchOrigin}/players/${account.username}`, is_profile_private: false, published_games: [], played_games: [], playing_now: null });
  const roomsServer = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const url = new URL(request.url ?? "/", "http://rooms");
    const path = url.pathname;
    const cors = isGameOrigin(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
    const reply = (status, body, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors, ...headers });
      response.end(JSON.stringify(body));
    };
    const fail = (status, code, message) => reply(status, { error: { code, message } });
    const notLocal = () => fail(404, "not_local", `${request.method} ${path} is a Zaisma call the local bench has no stand-in for. It works once the game is on Zaisma.`);
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type" });
        return response.end();
      }
      if (path === "/.well-known/jwks.json") return reply(200, jwks([passSigning.publicKey]), { "Access-Control-Allow-Origin": "*" });
      if (path === "/.well-known/receipt-jwks.json") return reply(200, jwks([receiptSigning.publicKey]), { "Access-Control-Allow-Origin": "*" });
      const readBody = async () => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          const body = JSON.parse(text || "{}");
          return body && typeof body === "object" ? body : {};
        } catch {
          return {};
        }
      };
      const playerMatch = /^\/v1\/players\/([a-z0-9_-]{1,60})$/.exec(path);
      if (playerMatch && request.method === "GET") {
        const account = accountOfPlayer(playerMatch[1]);
        if (!account) return fail(404, "no_player", "No stand-in account has that player ID. Guests have no profile.");
        return reply(200, { player: roomsProfile(account, originFor(request, ports.bench)) }, { "Access-Control-Allow-Origin": "*" });
      }
      // The developer API the game server calls to hand over purchases (game_server delivery), stood in for.
      const developerMatch = /^\/api\/dev\/games\/([a-z0-9-]{1,40})(\/.*)?$/.exec(path);
      if (developerMatch) {
        const rest = developerMatch[2] ?? "";
        if (request.method === "GET" && rest === "/items") return reply(200, { items: Object.fromEntries(state.items.map((listedItem) => [listedItem.itemName, { item_name: listedItem.itemName }])), purchase_delivery: state.purchaseDelivery });
        const forPlayer = /^\/players\/([a-z0-9_-]+)\/items$/.exec(rest);
        if (request.method === "GET" && forPlayer) {
          const waiting = state.purchases.filter((purchase) => purchase.playerId === forPlayer[1] && !purchase.isHandled);
          const unhandled = await Promise.all(waiting.map(async (purchase) => {
            const given = await purchaseFor(purchase);
            return { id: given.id, item_name: given.itemName, item_kind: given.itemKind, item_count: given.itemCount, purchase_source: given.purchaseSource, purchase_status: given.purchaseStatus, game_account_id: given.gameAccountId, paid_minor_units: null, currency_code: null, purchased_at: given.purchasedAt, refunded_at: null, receipt: given.receipt };
          }));
          return reply(200, { unhandled_purchases: unhandled });
        }
        const handled = /^\/purchases\/(purchase_[a-z0-9]+)\/handled$/.exec(rest);
        if (request.method === "POST" && handled) {
          const purchase = state.purchases.find((each) => each.id === handled[1]);
          if (!purchase) return fail(404, "no_purchase", "The bench has no purchase by that ID.");
          if (purchase.isHandled) return fail(409, "already_handled", "That purchase is already handled.");
          purchase.isHandled = true;
          saveState();
          return reply(200, { isHandled: true });
        }
        return notLocal();
      }
      if (request.method === "POST" && ["/v1/pass", "/v1/rooms", "/v1/report", "/v1/filter", "/v1/friends", "/v1/friends/room", "/v1/items/unhandled", "/v1/items/handled"].includes(path)) {
        if (!isGameOrigin(origin)) return fail(403, "bad_origin", "Not allowed from here.");
        const body = await readBody();
        if (body.gameSlug !== gameSlug) return fail(404, "game_unavailable", `The bench plays ${gameSlug}, not ${String(body.gameSlug)}.`);
        if (path === "/v1/pass") {
          const given = typeof body.roomKey === "string" ? roomKeys.get(body.roomKey) : null;
          if (!given) return fail(403, "unchecked", "Zaisma couldn't check this browser, so it can't play online. Reload the game to try again.");
          return reply(200, await passFor(given.as, given.playerNumber));
        }
        if (path === "/v1/rooms") return reply(200, { roomCode: roomCode() });
        if (path === "/v1/filter") return reply(200, { isAllowed: true, reason: null, message: null, hasSwearing: false, text: String(body.text ?? ""), is_stand_in: true });
        if (path === "/v1/report") {
          log(`Report (not sent anywhere): ${JSON.stringify({ roomCode: body.roomCode, playerId: body.playerId, playerName: body.playerName, reason: body.reason, details: body.details })}`);
          return reply(200, { isReported: true });
        }
        const claims = await claimsOf(body.pass);
        if (!claims) return fail(401, "bad_pass", "This player's pass didn't check out. Zaisma.player.getPass() gets a new one.");
        if (path === "/v1/friends/room") {
          if (body.serverUrl === null && body.roomCode === null) ownRooms.delete(claims.sub);
          else ownRooms.set(claims.sub, { roomCode: String(body.roomCode ?? ""), friendJoinsEnabled: body.friendJoinsEnabled !== false });
          return reply(200, { isSet: true });
        }
        if (path === "/v1/friends") {
          if (claims.kind !== "account") return fail(403, "account_needed", "Friends are for players signed in to Zaisma. Ask a guest to sign in first (Zaisma.player.signIn).");
          const me = accountOfPlayer(claims.sub);
          // Friends playing the game now, as on the game page: Join's room, or why not.
          const friends = friendsPlaying(me?.id ?? "").map((friend) => ({ player_id: friend.playerId, username: friend.username, room_code: friend.roomCode, server_url: null, join_refusal: friend.roomCode ? null : friend.ownRoom ? "private_room" : "friend_not_in_room" }));
          return reply(200, { friends });
        }
        // /v1/items/unhandled and /v1/items/handled, as apps/rooms answers them. Guests own nothing.
        if (path === "/v1/items/handled") {
          if (state.purchaseDelivery !== "game") return fail(409, "handled_by_server", `This game's purchases go to its ${state.purchaseDelivery === "game_server" ? "game server's onPurchase" : "own server"} (purchase_delivery ${state.purchaseDelivery}), which marks them handled.`);
          const purchase = state.purchases.find((each) => each.id === body.purchaseId && each.playerId === claims.sub);
          if (!purchase) return fail(404, "no_purchase", 'This player has no purchase with that ID in this game: take it from Zaisma.items.on("purchase") or unhandled().');
          if (purchase.isHandled) return fail(409, "already_handled", "It was marked handled already.");
          purchase.isHandled = true;
          saveState();
          return reply(200, { isHandled: true });
        }
        if (claims.kind !== "account") return reply(200, { purchases: [] });
        const waiting = state.purchases.filter((purchase) => purchase.playerId === claims.sub && !purchase.isHandled);
        return reply(200, { purchases: await Promise.all(waiting.map(purchaseFor)) });
      }
      const requestMatch = /^\/v1\/requests\/([a-z0-9-]{1,40})$/.exec(path);
      if (requestMatch && request.method === "POST") {
        if (!isGameOrigin(origin)) return fail(403, "bad_origin", "Not allowed from here.");
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const upstream = await fetch(`http://127.0.0.1:${ports.runner}${path}`, { method: "POST", headers: { "content-type": "text/plain", origin: localhostOrigin(ports.game) }, body: Buffer.concat(chunks) }).catch(() => null);
        if (!upstream) return fail(503, "busy", "The game server is starting again. Try again in a moment.");
        response.writeHead(upstream.status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors });
        return response.end(Buffer.from(await upstream.arrayBuffer()));
      }
      const listMatch = /^\/v1\/rooms\/([a-z0-9-]{1,40})$/.exec(path);
      if (listMatch && request.method === "GET") {
        if (!isGameOrigin(origin)) return fail(403, "bad_origin", "Not allowed from here.");
        const listed = [...roomsTracked].filter(([, room]) => room.isListed && [...room.sockets].some((each) => !each.isSpectator));
        const rooms = listed.map(([code, room]) => ({
          roomCode: code, playerCount: [...room.sockets].filter((each) => !each.isSpectator).length, heldSeatCount: 0, maximumPlayerCount: room.maximumPlayerCount, spectatorCount: [...room.sockets].filter((each) => each.isSpectator).length,
          maximumSpectatorCount: 0, isOpen: room.isOpen, location: null, isNear: true, name: room.name, labels: room.labels, isKept: false, inviteUrl: `${originFor(request, ports.bench)}/g/${gameSlug}?room=${code}`,
        }));
        let totalPlayerCount = 0;
        for (const room of rooms) totalPlayerCount += room.playerCount;
        return reply(200, { rooms, playing: { playerCount: totalPlayerCount, roomCount: rooms.length, closedRoomCount: rooms.filter((room) => !room.isOpen).length }, joinableRoomCount: rooms.filter((room) => room.isOpen && room.playerCount < room.maximumPlayerCount).length, openRoomCount: rooms.filter((room) => room.isOpen).length, regions: [], region: null, moreOpenRoomCount: 0, filters: [] });
      }
      const itemsMatch = /^\/v1\/items\/([a-z0-9-]{1,40})$/.exec(path);
      if (itemsMatch && request.method === "GET") {
        if (!isGameOrigin(origin)) return fail(403, "bad_origin", "Not allowed from here.");
        return reply(200, { items: state.items.filter((listedItem) => listedItem.priceMinorUnits !== null && listedItem.currencyCode).map((listedItem) => ({ itemName: listedItem.itemName, title: listedItem.title, description: listedItem.description, itemKind: listedItem.itemKind, itemCategory: listedItem.itemCategory, priceMinorUnits: listedItem.priceMinorUnits, currencyCode: listedItem.currencyCode, priceText: priceText(listedItem.currencyCode, listedItem.priceMinorUnits) })) });
      }
      return notLocal();
    } catch (error) {
      log(`The stand-in rooms couldn't answer ${request.method} ${path}: ${error instanceof Error ? error.message : error}`);
      if (!response.headersSent) fail(500, "busy", "The bench couldn't answer. Its terminal says why.");
    }
  });

  // WebSockets to a room go straight to the game server, which checks the pass; the bench only watches the first and the welcome to list rooms.
  const sockets = new WebSocketServer({ noServer: true });
  roomsServer.on("upgrade", (request, socket, head) => {
    const match = /^\/v1\/rooms\/([a-z0-9-]{1,40})\/([A-Z0-9]{6})$/.exec(new URL(request.url ?? "/", "http://rooms").pathname);
    if (!match || !isGameOrigin(request.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    sockets.handleUpgrade(request, socket, head, (client) => proxyRoom(client, match[2], new URL(request.url, "http://rooms").pathname));
  });
  function proxyRoom(client, code, path) {
    const upstream = new WebSocket(`ws://127.0.0.1:${ports.runner}${path}`, { headers: { origin: localhostOrigin(ports.game) } });
    const seen = { isSpectator: false, playerId: null };
    const waiting = [];
    const room = () => roomsTracked.get(code);
    const forget = () => {
      const tracked = room();
      if (!tracked) return;
      tracked.sockets.delete(seen);
      if (!tracked.sockets.size) roomsTracked.delete(code);
    };
    const closeCode = (givenCode) => (Number.isInteger(givenCode) && givenCode >= 1000 && givenCode <= 4999 && ![1004, 1005, 1006, 1015].includes(givenCode) ? givenCode : 1011);
    client.on("message", (received, isBinary) => {
      if (!isBinary) {
        try {
          const hello = JSON.parse(received.toString());
          if (hello?.type === "hello") {
            seen.isSpectator = hello.isSpectator === true;
            seen.playerId = typeof hello.pass === "string" ? (JSON.parse(Buffer.from(hello.pass.split(".")[1] ?? "", "base64url").toString("utf8")).sub ?? null) : null;
            const made = hello.room ?? {};
            const tracked = roomsTracked.get(code) ?? { sockets: new Set(), isListed: false, name: null, labels: {}, maximumPlayerCount: 100, isOpen: true };
            if (made.isListed === true) tracked.isListed = true;
            if (typeof made.name === "string") tracked.name = made.name;
            if (made.labels && typeof made.labels === "object") tracked.labels = made.labels;
            roomsTracked.set(code, tracked);
            tracked.sockets.add(seen);
          }
        } catch {
          // Not a hello the bench can read: the game server answers it.
        }
      }
      if (upstream.readyState === WebSocket.OPEN) upstream.send(received, { binary: isBinary });
      else waiting.push([received, isBinary]);
    });
    upstream.on("open", () => {
      for (const [received, isBinary] of waiting.splice(0)) upstream.send(received, { binary: isBinary });
    });
    upstream.on("message", (received, isBinary) => {
      if (!isBinary) {
        try {
          const message = JSON.parse(received.toString());
          if (message?.type === "welcome" && room()) {
            const settings = message.room ?? {};
            if (typeof settings.maximumPlayerCount === "number") room().maximumPlayerCount = settings.maximumPlayerCount;
            if (typeof settings.isOpen === "boolean") room().isOpen = settings.isOpen;
            if (typeof settings.isListed === "boolean") room().isListed = settings.isListed;
          }
        } catch {
          // Not JSON the bench reads.
        }
      }
      if (client.readyState === WebSocket.OPEN) client.send(received, { binary: isBinary });
    });
    upstream.on("close", (upstreamCloseCode, reason) => {
      forget();
      if (client.readyState === WebSocket.OPEN) client.close(closeCode(upstreamCloseCode), reason.toString().slice(0, 120));
    });
    // The game server is starting again: the game hears "busy" and tries again, with its rooms back as they were.
    upstream.on("error", () => {
      forget();
      if (client.readyState === WebSocket.OPEN) client.close(BUSY_CLOSE_CODE, "busy");
    });
    client.on("close", () => {
      forget();
      upstream.close();
    });
    client.on("error", () => upstream.terminate());
  }

  // --- The game server: the Node runner, as its own process, so a change starts it again with fresh code ---
  let runner = null;
  let runnerStartCount = 0;
  // The game server's source as the running one started with it: a change event with nothing changed (a late or repeated one) starts nothing.
  let runnerSource = null;
  let isClosing = false;
  const runnerFile = join(here, "local-play-runner.js");
  const entry = () => serverEntryOf(gameFolder);
  const roomsAddress = () => issuerUrl;
  function startRunner() {
    return new Promise((done) => {
      runnerSource = sourceOf(gameFolder);
      // Games that handle purchases in their game server get them there, as on Zaisma with purchase_delivery game_server,
      // read again at each start unless the delivery was copied from the game on Zaisma.
      const delivery = /\bonPurchase\b|\bonRefund\b/.test(runnerSource) ? "game_server" : "game";
      if (!state.isItemsCopied && state.purchaseDelivery !== delivery) {
        state.purchaseDelivery = delivery;
        saveState();
        tell("reload");
      }
      const config = { entry: entry(), gameSlug, port: ports.runner, origin: localhostOrigin(ports.game), issuerUrl: roomsAddress(), databaseFile: join(localFolder, "database.sqlite"), roomStateFile: join(localFolder, "room-states.sqlite"), developerApiUrl: `${roomsAddress()}/api/dev`, zaismaKey: LOCAL_RUNNER_KEY };
      const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", runnerFile, JSON.stringify(config)], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
      let isReady = false;
      const timeout = setTimeout(() => {
        if (!isReady) {
          log("Your game server is slow to start. Its output is above.");
          done(child);
        }
      }, RUNNER_START_TIMEOUT_MS);
      const lines = (stream, label) => {
        let rest = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => {
          rest += chunk;
          const parts = rest.split("\n");
          rest = parts.pop();
          for (const line of parts) {
            if (line === "ZAISMA_LOCAL_RUNNER_READY" && !isReady) {
              isReady = true;
              clearTimeout(timeout);
              done(child);
            } else log(`${label}${line}`);
          }
        });
      };
      lines(child.stdout, "[game server] ");
      lines(child.stderr, "[game server] ");
      child.on("exit", (code) => {
        clearTimeout(timeout);
        if (runner === child) runner = null;
        if (!isReady) {
          if (!isClosing) log("Your game server didn't start. Fix what it says above and save the file: it starts again by itself.");
          done(null);
        } else if (!isClosing && !child.zaismaIsRestarting) log(`Your game server stopped (exit code ${code}). Save a game server file to start it again.`);
      });
      runnerStartCount++;
    }).then((child) => {
      runner = child;
      return child;
    });
  }
  function stopRunner() {
    const child = runner;
    if (!child) return Promise.resolve();
    child.zaismaIsRestarting = true;
    return new Promise((done) => {
      child.once("exit", () => done());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    });
  }
  let restartChain = Promise.resolve();
  const restartRunner = () => {
    restartChain = restartChain.then(async () => {
      if (isClosing) return;
      await stopRunner();
      await startRunner();
      if (runner) log("Your game server is running again, with its rooms as they were.");
    });
    return restartChain;
  };

  // --- Watching the folder: the game server's files start it again, anything else reloads the game ---
  let watcher = null;
  let timer = null;
  let isServerChanged = false;
  let isOtherChanged = false;
  try {
    watcher = watch(gameFolder, { recursive: true }, (eventType, name) => {
      const relative = String(name ?? "").split(sep).join("/");
      if (!relative || relative === LOCAL_FOLDER || relative.startsWith(`${LOCAL_FOLDER}/`) || relative.startsWith(".git/") || relative.startsWith("node_modules/") || relative.endsWith(".DS_Store")) return;
      if (isServerFile(relative)) isServerChanged = true;
      else isOtherChanged = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const wasServerChanged = isServerChanged;
        const wasOtherChanged = isOtherChanged;
        isServerChanged = isOtherChanged = false;
        if (wasServerChanged && (!runner || sourceOf(gameFolder) !== runnerSource)) {
          log("Your game server changed: starting it again.");
          void restartRunner();
        }
        if (wasOtherChanged) {
          log("A game file changed: the game reloads.");
          tell("reload");
        }
      }, SLOW_RESTART_MS);
    });
  } catch {
    log("This computer can't watch the folder for changes, so reload the game yourself after a change.");
  }

  // --- Start everything ---
  // On the network each port takes both: a connection that opens with TLS's handshake (its first byte, 0x16) goes to HTTPS with the
  // bench's certificate, any other to plain http, so this computer keeps http://localhost and a phone that asks for HTTPS gets it.
  const secureServers = [];
  const fronts = [];
  const frontFor = (server) => {
    if (!certificate) return server;
    const secure = createSecureServer({ cert: certificate.certificatePem, key: certificate.keyPem });
    for (const event of ["request", "upgrade"]) for (const listener of server.listeners(event)) secure.on(event, listener);
    secureServers.push(secure);
    const front = createSocketServer((socket) => {
      socket.once("data", (firstChunk) => {
        socket.pause();
        socket.unshift(firstChunk);
        (firstChunk[0] === 0x16 ? secure : server).emit("connection", socket);
        process.nextTick(() => socket.resume());
      });
      socket.on("error", () => socket.destroy());
    });
    fronts.push(front);
    return front;
  };
  const listen = (server, portNumber) =>
    new Promise((done, failed) => {
      server.once("error", (error) => failed(error?.code === "EADDRINUSE" ? new GameServerError("bad_option", "port", `Port ${portNumber} is already in use.`, `Stop what's using ports ${port} to ${port + 3}, or give another first port: --port ${port + 10}.`) : error));
      server.listen(portNumber, host, () => done());
    });
  const listening = [[benchServer, ports.bench], [gameServer, ports.game], [roomsServer, ports.rooms]].map(([server, portNumber]) => [frontFor(server), portNumber]);
  try {
    for (const [server, portNumber] of listening) await listen(server, portNumber);
  } catch (error) {
    for (const [server] of listening) if (server.listening) server.close();
    watcher?.close();
    throw error;
  }
  await startRunner();

  const benchUrl = localhostOrigin(ports.bench);
  const networkUrl = networkOrigin;
  return {
    benchUrl,
    gameSiteUrl: localhostOrigin(ports.game),
    roomsUrl: issuerUrl,
    networkUrl,
    get runnerStartCount() {
      return runnerStartCount;
    },
    async close() {
      isClosing = true;
      clearTimeout(timer);
      watcher?.close();
      await restartChain.catch(() => {});
      await stopRunner();
      for (const front of fronts) front.close();
      await Promise.all([benchServer, gameServer, roomsServer, ...secureServers].map((server) => new Promise((done) => {
        server.close(() => done());
        server.closeAllConnections();
      })));
      for (const client of sockets.clients) client.terminate();
    },
  };
}

/** The bench's QR code for a phone, drawn with half blocks so two rows of modules take one line of the terminal. */
export function terminalQr(text) {
  const modules = qrCodeModules(text);
  const marginModuleCount = 2;
  const sideModuleCount = modules.length + marginModuleCount * 2;
  const dark = (columnIndex, rowIndex) => modules[rowIndex - marginModuleCount]?.[columnIndex - marginModuleCount] === true;
  const lines = [];
  for (let rowIndex = 0; rowIndex < sideModuleCount; rowIndex += 2) {
    let line = "";
    for (let columnIndex = 0; columnIndex < sideModuleCount; columnIndex++) {
      const top = dark(columnIndex, rowIndex);
      const bottom = dark(columnIndex, rowIndex + 1);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  // Dark modules print as the terminal's own light on dark, so the code is drawn inverted on a white block.
  return lines.map((line) => [...line].map((each) => ({ "█": " ", "▀": "▄", "▄": "▀", " ": "█" })[each]).join("")).join("\n");
}
