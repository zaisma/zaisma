import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractSymbol } from "./anchors.mjs";

/**
 * Every way into Zaisma, read from the code: one extractor per source, each giving doors
 * { door_id, door_name, door_kind, sector_id, source_path, anchors, gives, trusts, covered_by_door_id }.
 * Door ids are stable (they key the map's accumulated verdicts), and a door the code gains is a new id,
 * so it shows up unexplored by construction. Nothing here judges a door; generate.mjs and the night's
 * review do. warn is told whenever a door lands somewhere by default, so a new kind of door is seen.
 */

const DEVELOPER = "apps/site/src/developer.ts";
const anchorOf = (sourcePath, symbolName) => ({ anchor_id: `${sourcePath}:${symbolName}`, source_path: sourcePath, symbol_name: symbolName });

function door({ door_id, door_name, door_kind, sector_id, source_path, anchors, gives = [], trusts = [], covered_by_door_id = null }) {
  return { door_id, door_name, door_kind, sector_id, source_path, anchors, gives: [...new Set(gives)].sort(), trusts: [...new Set(trusts)].sort(), covered_by_door_id };
}

// ---------------------------------------------------------------------------------------------------
// The developer API (API_ROUTES) and the MCP over it (TOOLS).

/** Which sector an API path's call is in, and the handler route() sends it to, by the same prefixes route() uses; longest first. */
const API_HANDLERS = [
  ["/games/:slug/saves", "player-data", "apps/site/src/saves-api.ts", "savesRoute"],
  ["/games/:slug/database", "player-data", "apps/site/src/game-database.ts", "databaseRoute"],
  ["/games/:slug/secrets", "games-and-files", "apps/site/src/secrets-api.ts", "secretsRoute"],
  ["/games/:slug/versions/:version_id/preview-links", "games-and-files", DEVELOPER, "endPreviewLinks"],
  ["/games/:slug/versions", "games-and-files", DEVELOPER, "versionRoute"],
  ["/games/:slug/uploads", "games-and-files", DEVELOPER, "versionRoute"],
  ["/games/:slug/testers", "games-and-files", DEVELOPER, "testerRoute"],
  ["/games/:slug/reports", "games-and-files", DEVELOPER, "reportsFor"],
  ["/games/:slug/stats", "games-and-files", DEVELOPER, "statsFor"],
  ["/games/:slug/history", "games-and-files", DEVELOPER, "historyFor"],
  ["/games", "games-and-files", DEVELOPER, "route"],
  ["/files/:sha256/parts", "games-and-files", DEVELOPER, "bigFile"],
  ["/files/:sha256", "games-and-files", DEVELOPER, "putBlob"],
  ["/sign-in-apps", "api-keys", DEVELOPER, "signInAppRoute"],
  ["/webhooks", "api-keys", DEVELOPER, "webhookRoute"],
  ["/forum", "accounts", "apps/site/src/forum.ts", "forumRoute"],
  ["/players", "accounts", "packages/core/src/profiles.ts", "playerProfile"],
  ["/access", "api-keys", DEVELOPER, "accessJson"],
  ["/activity", "accounts", "apps/site/src/security-log.ts", "activityAnswer"],
].sort((first, second) => second[0].length - first[0].length);

const isUnder = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

/** { sector_id, handler } for one API_ROUTES entry. A path no prefix covers lands in accounts, by route(), with a warning. */
export function sectorAndHandlerForApiDoor(apiRoute, warn = () => {}) {
  const match = API_HANDLERS.find(([prefix]) => isUnder(apiRoute.path, prefix));
  if (!match) {
    warn(`API call ${apiRoute.method} ${apiRoute.path} matches no sector in API_HANDLERS (scripts/security-map/doors.mjs); it's put in accounts, with route() as its handler, until it's added.`);
    return { sector_id: "accounts", handler: anchorOf(DEVELOPER, "route") };
  }
  const [, sector_id, sourcePath, symbolName] = match;
  return { sector_id, handler: anchorOf(sourcePath, symbolName) };
}

/** What an API call hands out, by path: [prefix, methods, things]. */
const API_GIVES = [
  ["/games/:slug/saves", ["GET"], ["player_id"]],
  ["/games/:slug/database", ["GET", "POST"], ["player_id"]],
  ["/games/:slug/testers", ["GET", "POST", "PATCH"], ["tester_link"]],
  ["/games/:slug/versions", ["GET", "POST"], ["preview_link"]],
  ["/sign-in-apps", ["POST", "PATCH"], ["sign_in_app_client_secret"]],
  ["/webhooks", ["POST", "PATCH"], ["webhook_signing_secret"]],
];

export const apiDoorIdOf = (apiRoute) => `api:${apiRoute.method} ${apiRoute.path}`;

export function apiDoors(site, warn = () => {}) {
  return site.API_ROUTES.map((apiRoute) => {
    const { sector_id, handler } = sectorAndHandlerForApiDoor(apiRoute, warn);
    const anchors = [anchorOf(DEVELOPER, "checkCall"), handler].filter((anchor, index, all) => all.findIndex((other) => other.anchor_id === anchor.anchor_id) === index);
    const gives = API_GIVES.filter(([prefix, methods]) => isUnder(apiRoute.path, prefix) && methods.includes(apiRoute.method)).flatMap(([, , things]) => things);
    const trusts = ["api_key", ...(apiRoute.path.includes(":player_id") ? ["player_id"] : [])];
    return door({ door_id: apiDoorIdOf(apiRoute), door_name: `${apiRoute.method} /api/dev${apiRoute.path}`, door_kind: "api_call", sector_id, source_path: DEVELOPER, anchors, gives, trusts });
  });
}

/** A value a tool would take for one argument; flag is what every boolean gets, so both branches run. As test/site/api-mcp-parity.test.ts. */
function sampleValue(name, schema, flag) {
  if (schema.examples?.length) return schema.examples[0];
  if (schema.enum?.length) return schema.enum[0];
  const variant = schema.anyOf?.[0] ?? schema.oneOf?.[0];
  if (variant) return sampleValue(name, variant, flag);
  const type = Array.isArray(schema.type) ? schema.type.find((candidate) => candidate !== "null") : schema.type;
  if (type === "boolean") return flag;
  if (type === "integer" || type === "number") return 1;
  if (type === "array") return [];
  if (type === "object") return {};
  return name.endsWith("_base64") ? "aGk=" : "sky-hopper";
}

/**
 * The API_ROUTES entries a tool calls, run with every argument filled in against an API that says yes to
 * everything: the same resolution as test/site/api-mcp-parity.test.ts, which holds tools to it.
 */
export async function apiRoutesOfTool(site, tool) {
  const properties = tool.inputSchema.properties ?? {};
  const example = (tool.inputSchema.examples ?? [])[0] ?? {};
  const apiRoutes = [];
  for (const flag of [false, true]) {
    const toolArguments = { ...Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, sampleValue(name, schema, flag)])), ...example };
    await tool.run(toolArguments, async (method, path, body) => {
      const apiRoute = site.apiRoutesAt(path.split("?")[0]).find((candidate) => candidate.method === method);
      if (apiRoute && !apiRoutes.includes(apiRoute)) apiRoutes.push(apiRoute);
      const files = body?.files;
      return { game: { visibility: "draft", review_status: "draft" }, version: {}, missing_file_hashes: (files ?? []).map((file) => file.sha256), next_steps: [] };
    });
  }
  return apiRoutes;
}

/** One door per tool that makes an API call, covered by that call's door (the first that changes something, else the first). */
export async function mcpDoors(site, apiDoorList) {
  const apiDoorIds = new Set(apiDoorList.map((apiDoor) => apiDoor.door_id));
  const doors = [];
  for (const tool of site.TOOLS) {
    const apiRoutes = await apiRoutesOfTool(site, tool);
    if (apiRoutes.length === 0) continue;
    const covering = apiRoutes.find((apiRoute) => apiRoute.method !== "GET") ?? apiRoutes[0];
    const coveredBy = apiDoorList.find((apiDoor) => apiDoor.door_id === apiDoorIdOf(covering));
    if (!apiDoorIds.has(apiDoorIdOf(covering))) continue;
    doors.push(door({ door_id: `mcp:${tool.name}`, door_name: tool.name, door_kind: "mcp_tool", sector_id: coveredBy.sector_id, source_path: "apps/site/src/mcp.ts", anchors: [anchorOf("apps/site/src/mcp.ts", "handleMcp")], trusts: ["api_key"], covered_by_door_id: coveredBy.door_id }));
  }
  return doors;
}

// ---------------------------------------------------------------------------------------------------
// The admin MCP (ADMIN_TOOLS), behind Cloudflare Access.

export function adminDoors(site) {
  return site.ADMIN_TOOLS.map((tool) =>
    door({
      door_id: `admin:${tool.name}`,
      door_name: tool.title ?? tool.name,
      door_kind: "admin_tool",
      sector_id: "zaisma-keys-and-admin",
      source_path: "apps/site/src/admin-mcp.ts",
      anchors: [anchorOf("apps/site/src/admin.ts", "handleAdmin"), anchorOf("apps/site/src/admin-mcp.ts", "handleAdminMcp")],
      trusts: ["admin_access"],
    }),
  );
}

// ---------------------------------------------------------------------------------------------------
// zaisma.com's pages and forms.

/** Where the site's pages are routed: each file's entry (its handle* function) and the functions that hold its paths. */
const PAGE_SOURCES = [
  { source_path: "apps/site/src/index.ts", entry: "route", routeSymbols: ["route"] },
  { source_path: "apps/site/src/account.ts", entry: "handleAccount", routeSymbols: ["PATHS", "handleAccount"] },
  { source_path: "apps/site/src/sign-in.ts", entry: "handleSignIn", routeSymbols: ["handleSignIn"] },
  { source_path: "apps/site/src/passkeys.ts", entry: "handlePasskeys", routeSymbols: ["handlePasskeys"], onlyMethod: "POST" },
  { source_path: "apps/site/src/dashboard.ts", entry: "handleDashboard", routeSymbols: ["handleDashboard"] },
  { source_path: "apps/site/src/forum-pages.ts", entry: "handleForum", routeSymbols: ["handleForum"] },
  { source_path: "apps/site/src/friends.ts", entry: "handleFriends", routeSymbols: ["handleFriends"] },
  { source_path: "apps/site/src/blocks.ts", entry: "handleBlocks", routeSymbols: ["handleBlocks"] },
  { source_path: "apps/site/src/friends-now.ts", entry: "handleFriendsNow", routeSymbols: ["handleFriendsNow"] },
  { source_path: "apps/site/src/players-sheet.ts", entry: "handlePlayersSheet", routeSymbols: ["handlePlayersSheet"], onlyMethod: "GET" },
  { source_path: "apps/site/src/profiles.ts", entry: "handleProfiles", routeSymbols: ["handleProfiles"] },
  { source_path: "apps/site/src/plays.ts", entry: "handlePlays", routeSymbols: ["handlePlays"], onlyMethod: "POST" },
  { source_path: "apps/site/src/home.ts", entry: "handlePlayed", routeSymbols: ["handlePlayed"] },
  { source_path: "apps/site/src/game-links.ts", entry: "handleGameLinks", routeSymbols: ["handleGameLinks"], onlyMethod: "POST" },
  { source_path: "apps/site/src/admin.ts", entry: "handleAdmin", routeSymbols: ["handleAdmin", "adminAction", "adminForm"] },
];

/** A page path's sector, by its longest matching prefix ("/" only for the home page itself). */
const PAGE_SECTORS = [
  ["/account", "accounts"],
  ["/signin", "accounts"],
  ["/signout", "accounts"],
  ["/join", "accounts"],
  ["/oauth", "accounts"],
  ["/.well-known", "accounts"],
  ["/@", "accounts"],
  ["/friends", "accounts"],
  ["/api/passkeys", "accounts"],
  ["/api/username-check", "accounts"],
  ["/api/me", "accounts"],
  ["/forum", "accounts"],
  ["/legal", "accounts"],
  ["/robots.txt", "accounts"],
  ["/js/", "accounts"],
  ["/mcp", "api-keys"],
  ["/dashboard", "games-and-files"],
  ["/g/", "games-and-files"],
  ["/t/", "games-and-files"],
  ["/p/", "games-and-files"],
  ["/api/plays", "games-and-files"],
  ["/api/links", "games-and-files"],
  ["/api/saves", "player-data"],
  ["/api/presence", "player-data"],
  ["/admin", "zaisma-keys-and-admin"],
].sort((first, second) => second[0].length - first[0].length);

/** What a page or form hands out, by door id. */
const PAGE_GIVES = {
  "page:POST /signin": ["session"],
  "page:POST /signin/code": ["session"],
  "page:POST /join/account": ["session"],
  "page:/signin/callback": ["session"],
  "page:POST /api/passkeys/signin": ["session"],
  "page:POST /account/keys": ["api_key"],
  "page:/oauth/token": ["oauth_access"],
  "page:/oauth/authorize": ["oauth_code"],
};

/** What a page or form relies on, by path prefix. */
const PAGE_TRUSTS = [
  ["/account", ["session"]],
  ["/friends", ["session"]],
  ["/dashboard", ["session"]],
  ["/api/saves", ["session"]],
  ["/api/presence", ["session"]],
  ["/api/me", ["session"]],
  ["/api/passkeys/add", ["session"]],
  ["/api/passkeys/confirm", ["session"]],
  ["/forum", ["session"]],
  ["/@", ["session"]],
  ["/oauth/authorize", ["session"]],
  ["/oauth/token", ["oauth_code"]],
  ["/oauth/userinfo", ["oauth_access"]],
  ["/t/", ["tester_link"]],
  ["/p/", ["preview_link"]],
  ["/admin", ["admin_access"]],
];

export function pageSectorOf(path, warn = () => {}) {
  if (path === "/") return "accounts";
  const match = PAGE_SECTORS.find(([prefix]) => path.startsWith(prefix));
  if (match) return match[1];
  warn(`Page ${path} matches no sector in PAGE_SECTORS (scripts/security-map/doors.mjs); it's put in accounts until it's added.`);
  return "accounts";
}

/** A route's regular expression as a path: /^\/friends\/(player_…)\/remove$/ → /friends/(player_…)/remove. */
const patternPath = (regexSource) => regexSource.replace(/^\^/, "").replace(/\$$/, "").replace(/\\\//g, "/");

/** The method a condition after a path names: `path === "/x" && post` is a POST, `&& !post` a GET. */
function methodAfter(followingText) {
  const flag = /^\s*&&\s*(!?)\s*(post|isPost)\b/.exec(followingText);
  if (flag) return flag[1] ? "GET" : "POST";
  const compared = /^\s*&&\s*(?:request\.)?method\s*(===|!==)\s*"([A-Z]+)"/.exec(followingText);
  if (compared) return (compared[1] === "===") === (compared[2] === "POST") ? "POST" : "GET";
  return null;
}

/** Every path a piece of routing code names: [path, method or null, isPrefix]. */
function routedPaths(symbolText) {
  const found = [];
  for (const match of symbolText.matchAll(/path\s*===\s*"([^"]+)"/g)) found.push([match[1], methodAfter(symbolText.slice(match.index + match[0].length, match.index + match[0].length + 60)), false]);
  for (const match of symbolText.matchAll(/path\.startsWith\("([^"]+)"\)/g)) found.push([match[1], null, true]);
  for (const match of symbolText.matchAll(/\[((?:\s*"[^"]*"\s*,?)+)\]\.includes\(path\)/g)) for (const literal of match[1].matchAll(/"([^"]*)"/g)) found.push([literal[1], null, false]);
  for (const match of symbolText.matchAll(/path\.match\(\/(\^(?:\\.|[^/\\\n])*)\/[a-z]*\)/g)) found.push([patternPath(match[1]), null, false]);
  return found;
}

/** The string literals of an array const, like account.ts's PATHS. */
const arrayLiterals = (symbolText) => (/=\s*\[/.test(symbolText) ? [...symbolText.slice(symbolText.indexOf("[")).matchAll(/"([^"]*)"/g)].map((match) => match[1]) : []);

export function pageDoors(repoRoot, warn = () => {}) {
  /** path → { methods, sources: [{ source_path, anchors }] } */
  const byPath = new Map();
  const prefixes = [];
  for (const source of PAGE_SOURCES) {
    const sourceText = readFileSync(join(repoRoot, source.source_path), "utf8");
    const entryAnchor = anchorOf(source.source_path, source.entry);
    for (const symbolName of source.routeSymbols) {
      const symbolText = extractSymbol(sourceText, symbolName);
      if (symbolText === null) {
        warn(`${source.source_path} has no ${symbolName} any more; its pages aren't on the map until PAGE_SOURCES (scripts/security-map/doors.mjs) names where they went.`);
        continue;
      }
      const anchors = symbolName === source.entry || symbolName === "PATHS" ? [entryAnchor] : [entryAnchor, anchorOf(source.source_path, symbolName)];
      const paths = symbolName === "PATHS" ? arrayLiterals(symbolText).map((path) => [path, null, false]) : routedPaths(symbolText);
      for (const [path, method, isPrefix] of paths) {
        if (isPrefix) {
          prefixes.push({ path, source, anchors });
          continue;
        }
        const entry = byPath.get(path) ?? { methods: new Set(), source, anchors };
        entry.methods.add(source.onlyMethod ?? method ?? "?");
        byPath.set(path, entry);
      }
    }
  }
  // A prefix is a door of its own only when no named path sits under it (else it's just the file's guard).
  const allPaths = [...byPath.keys()];
  for (const prefix of prefixes) {
    if (allPaths.some((path) => path.startsWith(prefix.path))) continue;
    const path = `${prefix.path.replace(/\/$/, "")}/*`;
    const entry = byPath.get(path) ?? { methods: new Set(), source: prefix.source, anchors: prefix.anchors };
    entry.methods.add(prefix.source.onlyMethod ?? "?");
    byPath.set(path, entry);
  }
  const doors = [];
  for (const [path, { methods, source, anchors }] of byPath) {
    const sector_id = pageSectorOf(path, warn);
    const trusts = PAGE_TRUSTS.filter(([prefix]) => path.startsWith(prefix)).flatMap(([, things]) => things);
    const forms = methods.has("POST") ? ["POST"] : [];
    const views = methods.has("GET") ? ["GET"] : methods.has("POST") ? [] : [null];
    for (const method of [...views, ...forms]) {
      const door_id = method ? `page:${method} ${path}` : `page:${path}`;
      doors.push(door({ door_id, door_name: method ? `${method} ${path}` : path, door_kind: method === "POST" ? "page_form" : "page_route", sector_id, source_path: source.source_path, anchors, gives: PAGE_GIVES[door_id] ?? [], trusts }));
    }
  }
  return doors;
}

// ---------------------------------------------------------------------------------------------------
// Game files, on the separate game domain (apps/games).

const GAMES = "apps/games/src/index.ts";

export function gameFileDoors(repoRoot) {
  const sourceText = readFileSync(join(repoRoot, GAMES), "utf8");
  const serveAnchors = [anchorOf(GAMES, "serve"), anchorOf(GAMES, "resolveGame")];
  const fixed = [
    { address: "/", door_name: "A game's page (its index.html)" },
    { address: "/<file>", door_name: "Any file of a game" },
    { address: "--preview", door_name: "A version's preview address (<slug>--preview)" },
    { address: "--tester", door_name: "A tester link's address (<slug>--tester)" },
  ];
  const zaismaAddresses = [...new Set([...sourceText.matchAll(/target\.path === "(_zaisma\/[^"]+)"/g)].map((match) => match[1]))].sort();
  return [
    ...fixed.map(({ address, door_name }) => door({ door_id: `game-file:${address}`, door_name, door_kind: "game_file_address", sector_id: "games-and-files", source_path: GAMES, anchors: serveAnchors, trusts: address === "--preview" ? ["preview_link"] : address === "--tester" ? ["tester_link"] : [] })),
    ...zaismaAddresses.map((address) => {
      const isThroughLink = address === "_zaisma/enter" || address === "_zaisma/entered";
      return door({
        door_id: `game-file:${address}`,
        door_name: address,
        door_kind: "game_file_address",
        sector_id: address === "_zaisma/saves.js" || address === "_zaisma/restore" ? "player-data" : "games-and-files",
        source_path: GAMES,
        anchors: isThroughLink ? [...serveAnchors, anchorOf(GAMES, "openThroughLink")] : serveAnchors,
        trusts: isThroughLink ? ["preview_link", "tester_link"] : [],
      });
    }),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Multiplayer rooms: the messages a room takes, and the rooms Worker's /v1 addresses.

const GAME_SERVER_ROOM = "packages/game-server/src/room.ts";
const ROOMS_ROOM = "apps/rooms/src/room.ts";
const ROOMS = "apps/rooms/src/index.ts";

/** What a rooms address hands out, by path. */
const ROOMS_GIVES = { "/v1/pass": ["player_pass"], "/v1/relay": ["relay_credentials"] };

export function roomDoors(repoRoot) {
  const receiveText = extractSymbol(readFileSync(join(repoRoot, GAME_SERVER_ROOM), "utf8"), "receive") ?? "";
  const messageTypes = [...new Set([...receiveText.matchAll(/case "([a-z_-]+)":/g)].map((match) => match[1]))];
  const messageAnchors = [anchorOf(GAME_SERVER_ROOM, "receive"), anchorOf(ROOMS_ROOM, "webSocketMessage")];
  const roomsText = extractSymbol(readFileSync(join(repoRoot, ROOMS), "utf8"), "default") ?? "";
  const roomsPaths = [
    ...[...roomsText.matchAll(/pathname\s*===\s*"(\/v1\/[^"]*)"/g)].map((match) => match[1]),
    ...[...roomsText.matchAll(/pathname\.match\(\/(\^\\\/v1(?:\\.|[^/\\\n])*)\/[a-z]*\)/g)].map((match) => patternPath(match[1])),
  ];
  return [
    ...messageTypes.map((messageType) => door({ door_id: `room-message:${messageType}`, door_name: `The "${messageType}" message`, door_kind: "room_message", sector_id: "rooms", source_path: GAME_SERVER_ROOM, anchors: messageAnchors, trusts: ["player_pass"] })),
    ...[...new Set(roomsPaths)].map((path) =>
      door({ door_id: `rooms:${path}`, door_name: `rooms.zaisma.com${path}`, door_kind: "page_route", sector_id: "rooms", source_path: ROOMS, anchors: [anchorOf(ROOMS, "default")], gives: ROOMS_GIVES[path] ?? [], trusts: path === "/v1/pass" ? ["session"] : path.startsWith("/v1/players") ? ["player_id"] : ["player_pass"] }),
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Keys, sessions and tokens, each at the function that checks it.

const TOKENS = [
  { thing: "session", door_name: "A signed-in session", sector_id: "accounts", anchor: anchorOf("apps/site/src/auth.ts", "currentSession") },
  { thing: "email_code", door_name: "An email code", sector_id: "accounts", anchor: anchorOf("apps/site/src/email-codes.ts", "checkEmailCode") },
  { thing: "oauth_access", door_name: "A Sign in with Zaisma access token", sector_id: "accounts", anchor: anchorOf("apps/site/src/sign-in.ts", "readAccessToken") },
  { thing: "api_key", door_name: "A developer API key", sector_id: "api-keys", anchor: anchorOf("packages/core/src/developers.ts", "apiKeyForToken") },
  { thing: "preview_link", door_name: "A version's preview link", sector_id: "games-and-files", anchor: anchorOf("apps/site/src/preview-links.ts", "checkPreviewLinkToken") },
  { thing: "tester_link", door_name: "A tester link", sector_id: "games-and-files", anchor: anchorOf("packages/core/src/db.ts", "testerLinkByToken"), alsoAnchors: [anchorOf("packages/core/src/game-access.ts", "isTesterLinkOn")] },
  { thing: "player_pass", door_name: "A player pass", sector_id: "rooms", anchor: anchorOf("packages/game-server/src/pass.ts", "verifyPass") },
  { thing: "admin_access", door_name: "Cloudflare Access to /admin", sector_id: "zaisma-keys-and-admin", anchor: anchorOf("apps/site/src/access.ts", "verifyJwt") },
];

export function tokenDoors() {
  return TOKENS.map(({ thing, door_name, sector_id, anchor, alsoAnchors = [] }) => door({ door_id: `token:${thing}`, door_name, door_kind: "token_or_session", sector_id, source_path: anchor.source_path, anchors: [anchor, ...alsoAnchors], gives: [thing] }));
}

// ---------------------------------------------------------------------------------------------------

/** Every door in the code, sorted by id. site is loadSiteModule()'s answer. */
export async function collectDoors(repoRoot, site, warn = () => {}) {
  const api = apiDoors(site, warn);
  const all = [...api, ...(await mcpDoors(site, api)), ...adminDoors(site), ...pageDoors(repoRoot, warn), ...gameFileDoors(repoRoot), ...roomDoors(repoRoot), ...tokenDoors()];
  const seen = new Set();
  for (const each of all) {
    if (seen.has(each.door_id)) throw new Error(`Two doors have the id ${each.door_id}; door ids key the map, so each must be unique.`);
    seen.add(each.door_id);
  }
  return all.sort((first, second) => first.door_id.localeCompare(second.door_id));
}
