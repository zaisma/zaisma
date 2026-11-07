/**
 * Every way into Zaisma, read from the code: one extractor per source, each giving doors
 * { door_id, door_name, door_kind, sector_id, source_path, anchors, gives, trusts, covered_by_door_id }.
 * Door ids are stable (they key the map's accumulated verdicts), and a door the code gains is a new id,
 * so it shows up unexplored by construction. Nothing here judges a door; generate.mjs and the night's
 * review do. warn is told whenever a door lands somewhere by default, so a new kind of door is seen.
 */

const DEVELOPER = "apps/site/src/developer.ts";
const anchorOf = (sourcePath, symbolName) => ({ anchor_id: `${sourcePath}:${symbolName}`, source_path: sourcePath, symbol_name: symbolName });

function door({ door_id, door_name, door_kind, sector_id, source_path, anchors, gives = [], trusts = [], covered_by_door_id = null, stored_value = null, contract = null }) {
  return { door_id, door_name, door_kind, sector_id, source_path, anchors, gives: [...new Set(gives)].sort(), trusts: [...new Set(trusts)].sort(), covered_by_door_id, stored_value, contract };
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
  ["/games/:slug/items", "money", DEVELOPER, "route"],
  ["/games/:slug/purchases", "money", DEVELOPER, "route"],
  ["/games/:slug/purchase-settings", "money", DEVELOPER, "route"],
  ["/games/:slug/players/:player_id/items", "money", DEVELOPER, "route"],
  ["/games", "games-and-files", DEVELOPER, "route"],
  ["/files/:sha256/parts", "games-and-files", DEVELOPER, "bigFile"],
  ["/files/:sha256", "games-and-files", DEVELOPER, "putBlob"],
  ["/sign-in-apps", "api-keys", DEVELOPER, "signInAppRoute"],
  ["/webhooks", "api-keys", DEVELOPER, "webhookRoute"],
  ["/forum", "accounts", "apps/site/src/forum.ts", "forumRoute"],
  ["/players", "accounts", "packages/core/src/profiles.ts", "playerProfile"],
  ["/access", "api-keys", DEVELOPER, "accessJson"],
  ["/activity", "accounts", "apps/site/src/security-log.ts", "activityAnswer"],
  ["/credit", "money", DEVELOPER, "route"],
  ["/pro", "money", DEVELOPER, "route"],
  ["/stripe-account", "money", DEVELOPER, "route"],
  ["/spending-requests", "money", DEVELOPER, "route"],
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
    return door({ door_id: apiDoorIdOf(apiRoute), door_name: `${apiRoute.method} /api/dev${apiRoute.path}`, door_kind: "api_call", sector_id, source_path: DEVELOPER, anchors, gives, trusts, contract: site.apiRouteContract(apiRoute) });
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
  // A retired tool makes no call, so it has no door.
  for (const tool of site.TOOLS.filter((candidate) => !candidate.replacedBy)) {
    const apiRoutes = await apiRoutesOfTool(site, tool);
    if (apiRoutes.length === 0) continue;
    const covering = apiRoutes.find((apiRoute) => apiRoute.method !== "GET") ?? apiRoutes[0];
    const coveredBy = apiDoorList.find((apiDoor) => apiDoor.door_id === apiDoorIdOf(covering));
    if (!apiDoorIds.has(apiDoorIdOf(covering))) continue;
    doors.push(door({ door_id: `mcp:${tool.name}`, door_name: tool.name, door_kind: "mcp_tool", sector_id: coveredBy.sector_id, source_path: "apps/site/src/mcp.ts", anchors: [anchorOf("apps/site/src/mcp.ts", "handleMcp")], trusts: ["api_key"], covered_by_door_id: coveredBy.door_id, contract: coveredBy.contract }));
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
      contract: {
        whoMayCall: "admin",
        reaches: tool.reaches,
        trusts: ["admin_access"],
        takes: { query: {}, body: { kind: "json", fields: tool.inputSchema.properties ?? {}, required: tool.inputSchema.required ?? [], maximumSizeBytes: 16 * 1024 * 1024 } },
        answers: { kind: "json", schema: tool.outputSchema },
        limit: { whyNoLimit: "admin_only" },
      },
    }),
  );
}

// ---------------------------------------------------------------------------------------------------
// zaisma.com's pages and forms: the site's door table (SITE_DOORS, apps/site/src/doors.ts).

const GUARD = anchorOf("apps/site/src/guard.ts", "guardSiteDoor");

/** Where a page path's own code is, by its longest matching prefix: [prefix, source_path, symbol_name]. */
const PAGE_HANDLERS = [
  ["/account", "apps/site/src/account.ts", "handleAccount"],
  ["/api/account/confirm", "apps/site/src/account.ts", "handleAccount"],
  ["/api/account/purchase-pin", "apps/site/src/buy.ts", "handleBuy"],
  ["/signin", "apps/site/src/account.ts", "handleAccount"],
  ["/signout", "apps/site/src/account.ts", "handleAccount"],
  ["/join", "apps/site/src/account.ts", "handleAccount"],
  ["/api/username-check", "apps/site/src/account.ts", "handleAccount"],
  ["/account/passkeys", "apps/site/src/passkeys.ts", "handlePasskeys"],
  ["/api/passkeys", "apps/site/src/passkeys.ts", "handlePasskeys"],
  ["/oauth", "apps/site/src/sign-in.ts", "handleSignIn"],
  ["/.well-known/oauth", "apps/site/src/mcp-sign-in.ts", "handleMcpSignIn"],
  ["/.well-known/openid-configuration", "apps/site/src/sign-in.ts", "handleSignIn"],
  ["/.well-known/jwks.json", "apps/site/src/sign-in.ts", "handleSignIn"],
  ["/dashboard/settings", "apps/site/src/developer-settings.ts", "handleDeveloperSettings"],
  ["/dashboard", "apps/site/src/dashboard.ts", "handleDashboard"],
  ["/forum", "apps/site/src/forum-pages.ts", "handleForum"],
  ["/friends/among", "apps/site/src/players-sheet.ts", "handlePlayersSheet"],
  ["/friends/blocks", "apps/site/src/blocks.ts", "handleBlocks"],
  ["/friends/requests", "apps/site/src/friend-requests.ts", "handleFriendRequests"],
  ["/friends", "apps/site/src/friends.ts", "handleFriends"],
  ["/api/presence", "apps/site/src/friends-now.ts", "handleFriendsNow"],
  ["/:at_username", "apps/site/src/profiles.ts", "handleProfiles"],
  ["/api/plays", "apps/site/src/plays.ts", "handlePlays"],
  ["/api/me/played", "apps/site/src/home.ts", "handlePlayed"],
  ["/api/links", "apps/site/src/game-links.ts", "handleGameLinks"],
  ["/api/saves", "apps/site/src/saves.ts", "handleSaves"],
  ["/api/buy", "apps/site/src/buy.ts", "handleBuy"],
  ["/api/payment-methods", "apps/site/src/buy.ts", "handleBuy"],
  ["/api/speed-reports", "apps/site/src/speed-reports.ts", "handleSpeedReports"],
  ["/admin/mcp", "apps/site/src/admin-mcp.ts", "handleAdminMcp"],
  ["/admin", "apps/site/src/admin.ts", "handleAdmin"],
  ["/img", DEVELOPER, "handleDeveloper"],
  ["/shaders", DEVELOPER, "handleDeveloper"],
  ["/shader-checks", DEVELOPER, "handleDeveloper"],
  ["/api/dev", DEVELOPER, "handleDeveloper"],
].sort((first, second) => second[0].length - first[0].length);

/** A page path's sector, by its longest matching prefix ("/" only for the home page itself). */
const PAGE_SECTORS = [
  ["/account", "accounts"],
  ["/signin", "accounts"],
  ["/signout", "accounts"],
  ["/join", "accounts"],
  ["/oauth", "accounts"],
  ["/.well-known", "accounts"],
  ["/:at_username", "accounts"],
  ["/friends", "accounts"],
  ["/api/passkeys", "accounts"],
  ["/api/username-check", "accounts"],
  ["/api/account/confirm", "accounts"],
  ["/api/me", "accounts"],
  ["/forum", "accounts"],
  ["/legal", "accounts"],
  ["/robots.txt", "accounts"],
  ["/sitemap.xml", "accounts"],
  ["/js/", "accounts"],
  ["/css/", "accounts"],
  ["/:rules_file", "accounts"],
  ["/design", "accounts"],
  ["/developers", "accounts"],
  ["/github/secret-scanning", "api-keys"],
  ["/csp-reports", "accounts"],
  ["/api/speed-reports", "accounts"],
  ["/mcp", "api-keys"],
  ["/api/dev", "api-keys"],
  ["/dashboard", "games-and-files"],
  ["/games", "games-and-files"],
  ["/g/", "games-and-files"],
  ["/t/", "games-and-files"],
  ["/p/", "games-and-files"],
  ["/img/", "games-and-files"],
  ["/shaders/", "games-and-files"],
  ["/shader-checks/", "games-and-files"],
  ["/api/plays", "games-and-files"],
  ["/api/links", "games-and-files"],
  ["/api/saves", "player-data"],
  ["/api/presence", "player-data"],
  ["/admin", "zaisma-keys-and-admin"],
  ["/buy", "money"],
  ["/stripe", "money"],
  ["/api/buy", "money"],
  ["/api/payment-methods", "money"],
  ["/api/account/purchase-pin", "money"],
].sort((first, second) => second[0].length - first[0].length);

/** What a page or form hands out, by door id. */
const PAGE_GIVES = {
  "page:POST /signin": ["session"],
  "page:POST /signin/code": ["session"],
  "page:POST /join/account": ["session"],
  "page:GET /signin/callback": ["session"],
  "page:POST /api/passkeys/signin": ["session"],
  "page:POST /dashboard/settings/keys": ["api_key"],
  "page:POST /oauth/token": ["oauth_access"],
  "page:POST /oauth/authorize": ["oauth_code"],
};

export function pageSectorOf(path, warn = () => {}) {
  if (path === "/") return "accounts";
  const match = PAGE_SECTORS.find(([prefix]) => path.startsWith(prefix));
  if (match) return match[1];
  warn(`Page ${path} matches no sector in PAGE_SECTORS (scripts/security-map/doors.mjs); it's put in accounts until it's added.`);
  return "accounts";
}

const pageAnchors = (siteDoor) => {
  const handler = PAGE_HANDLERS.find(([prefix]) => siteDoor.path.startsWith(prefix));
  const anchors = [GUARD, anchorOf(handler?.[1] ?? "apps/site/src/index.ts", handler?.[2] ?? "route")];
  if (siteDoor.contract.provenBy) anchors.push(anchorOf(siteDoor.contract.provenBy.source_path, siteDoor.contract.provenBy.symbol_name));
  return anchors.filter((anchor, index, all) => all.findIndex((other) => other.anchor_id === anchor.anchor_id) === index);
};

export function pageDoors(site, warn = () => {}) {
  return site.SITE_DOORS.flatMap((siteDoor) =>
    site.siteDoorIds(siteDoor).map((door_id) => {
      const method = door_id.match(/^page:([A-Z]+) /)?.[1] ?? null;
      const isForm = method !== null && method !== "GET" && method !== "OPTIONS";
      const anchors = pageAnchors(siteDoor);
      return door({ door_id, door_name: method ? `${method} ${siteDoor.path}` : siteDoor.path, door_kind: isForm ? "page_form" : "page_route", sector_id: pageSectorOf(siteDoor.path, warn), source_path: anchors[1].source_path, anchors, gives: PAGE_GIVES[door_id] ?? [], trusts: siteDoor.contract.trusts, contract: siteDoor.contract });
    }),
  );
}

// ---------------------------------------------------------------------------------------------------
// Game files, on the separate game domain (apps/games): its door table (GAME_FILE_DOORS, apps/games/src/doors.ts).

const GAMES = "apps/games/src/index.ts";
const GAME_DOOR_IDS = { file: ["/", "/<file>"], preview_address: ["--preview"], tester_address: ["--tester"] };
const GAME_DOOR_NAMES = { "/": "A game's page (its index.html)", "/<file>": "Any file of a game", "--preview": "A version's preview address (<slug>--preview)", "--tester": "A tester link's address (<slug>--tester)" };

export function gameFileDoors(site) {
  const serveAnchors = [anchorOf(GAMES, "serve"), anchorOf(GAMES, "resolveGame")];
  return Object.entries(site.GAME_FILE_DOORS).flatMap(([name, contract]) =>
    (GAME_DOOR_IDS[name] ?? [name]).map((address) =>
      door({
        door_id: `game-file:${address}`,
        door_name: GAME_DOOR_NAMES[address] ?? address,
        door_kind: "game_file_address",
        sector_id: address === "_zaisma/saves.js" || address === "_zaisma/restore" ? "player-data" : "games-and-files",
        source_path: GAMES,
        anchors: contract.provenBy ? [...serveAnchors, anchorOf(contract.provenBy.source_path, contract.provenBy.symbol_name)] : serveAnchors,
        trusts: contract.trusts,
        contract,
      }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------
// Multiplayer rooms: the messages a room takes (ROOM_MESSAGE_DOORS), and the rooms Worker's addresses (ROOM_ADDRESS_DOORS).

const GAME_SERVER_ROOM = "packages/game-server/src/room.ts";
const ROOMS_ROOM = "apps/rooms/src/room.ts";
const ROOMS = "apps/rooms/src/index.ts";

/** What a rooms address hands out, by path. */
const ROOMS_GIVES = { "/v1/pass": ["player_pass"], "/v1/relay": ["relay_credentials"] };

export function roomDoors(site) {
  const messageAnchors = [anchorOf(GAME_SERVER_ROOM, "receive"), anchorOf(ROOMS_ROOM, "webSocketMessage")];
  return [
    ...Object.entries(site.ROOM_MESSAGE_DOORS).map(([messageType, contract]) => door({ door_id: `room-message:${messageType}`, door_name: `The "${messageType}" message`, door_kind: "room_message", sector_id: "rooms", source_path: GAME_SERVER_ROOM, anchors: messageAnchors, trusts: contract.trusts, contract })),
    ...site.ROOM_ADDRESS_DOORS.filter(({ path }) => path.startsWith("/v1/")).map(({ path, contract }) =>
      door({ door_id: `rooms:${path}`, door_name: `rooms.zaisma.com${path}`, door_kind: "page_route", sector_id: "rooms", source_path: ROOMS, anchors: [anchorOf(ROOMS, "default")], gives: ROOMS_GIVES[path] ?? [], trusts: contract.trusts, contract }),
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

const STORED_VALUES_SOURCE = "apps/site/src/stored-values.ts";

/**
 * One door per stored value (STORED_VALUES, apps/site/src/stored-values.ts): what an attacker who can save a
 * value wants is for it to act on someone else's page, as them, so it's in the accounts sector. It follows
 * the value from the doors that save it to the pages that show it, and is anchored on the check that shapes
 * it, esc and the list itself, so a change to any of them makes its cases stale.
 */
export function storedValueDoors(site) {
  return site.STORED_VALUES.map((entry) =>
    door({
      door_id: `stored-value:${entry.stored}`,
      door_name: `${entry.stored} (${entry.format}, from ${entry.source})`,
      door_kind: "stored_value",
      sector_id: "accounts",
      source_path: STORED_VALUES_SOURCE,
      anchors: [...(entry.checked_by ? [anchorOf(entry.checked_by.source_path, entry.checked_by.symbol_name)] : []), anchorOf("apps/site/src/markup.ts", "esc"), anchorOf(STORED_VALUES_SOURCE, "STORED_VALUES")],
      contract: site.storedValueContract(entry),
      stored_value: { format: entry.format, source: entry.source, saved_by_door_ids: [...entry.saved_by_door_ids].sort(), shown_on_door_ids: [...entry.shown_on_door_ids].sort() },
    }),
  );
}

/** Every door in the code, sorted by id. site is loadSiteModule()'s answer. */
export async function collectDoors(repoRoot, site, warn = () => {}) {
  const api = apiDoors(site, warn);
  const all = [...api, ...(await mcpDoors(site, api)), ...adminDoors(site), ...pageDoors(site, warn), ...gameFileDoors(site), ...roomDoors(site), ...tokenDoors(), ...storedValueDoors(site)];
  const seen = new Set();
  for (const each of all) {
    if (seen.has(each.door_id)) throw new Error(`Two doors have the id ${each.door_id}; door ids key the map, so each must be unique.`);
    seen.add(each.door_id);
  }
  return all.sort((first, second) => first.door_id.localeCompare(second.door_id));
}
