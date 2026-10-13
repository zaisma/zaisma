import { CONTROLS, DEVICES, PLAY_STYLES, ROOM_BROWSING, SCREENS, VISIBILITIES } from "@zaisma/core";
import { ApiError, apiCall, authenticate, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * The developer MCP at /mcp: every tool is a call to the developer API, so the MCP, the upload command
 * and the dashboard always agree. Streamable HTTP without sessions or streaming: each POST is one
 * JSON-RPC message (or a batch) and gets a JSON answer. Sign in with an API key as a Bearer token.
 */

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/** Small games can be sent straight through the MCP; bigger builds go through the upload command. */
const MCP_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_BODY = 8 * 1024 * 1024;

const INSTRUCTIONS = `Zaisma hosts browser games: a game is a folder with an index.html at the top. Players open zaisma.com/g/<slug> and play in any browser, no install.

How publishing works:
1. create_game makes a game. It starts as a draft only its developer can see.
2. Upload a version. Small games (under 5 MB, like single-file HTML games): upload_files with the file contents. Bigger builds: run \`npx @zaisma/cli upload <folder> --game <slug>\` in a terminal with ZAISMA_KEY set to the same API key; it only sends changed files.
3. Every version is scanned, usually in under a minute; get_version shows the result. A held version waits for a person, usually within a day. Passed versions get a private preview link.
4. publish_version makes a passed version live (or rolls back to an older one), now or at a set time. Then update_game with visibility "listed" shows the game to players (or "unlisted": only people with the link).

Ask the developer before making a game private or a draft again (players lose access), and show them the preview link before publishing. Never guess why a version was held beyond what get_version says.`;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
  run: (args: Record<string, unknown>, call: ApiCall) => Promise<unknown>;
}

type ApiCall = (method: string, path: string, body?: unknown) => Promise<Record<string, unknown>>;

const slug = { type: "string", description: "The game's link name, as in zaisma.com/g/<slug>" };
const versionId = { type: "string", description: "A version ID from get_game or upload_files" };
const details = {
  title: { type: "string", maxLength: 80 },
  description: { type: "string", maxLength: 500, description: "Shown on the game page" },
  devices: { type: "array", items: { enum: DEVICES }, description: "Devices the game works on" },
  controls: { type: "array", items: { enum: CONTROLS }, description: "Controls the game supports" },
  screen: { enum: [...SCREENS, ""], description: "Screen orientation; empty for not set" },
  players: {
    type: ["object", "null"],
    description: 'How it\'s played. Like { "single": true, "local": { "min": 2, "max": 4, "style": "co-op" }, "online": null }. local means together on one device. max null means no limit. null clears it.',
    properties: { single: { type: "boolean" }, local: count("Together on one device or screen"), online: count("Over the internet") },
    required: ["single"],
  },
  cloud_saves: {
    type: "boolean",
    description: "Copy signed-in players' browser saves (localStorage and IndexedDB) to their account, so progress follows them to any device. On by default; turn off for games that keep their own saves on a server.",
  },
  multiplayer: {
    enum: ["none", "relay", "own"],
    description:
      "Multiplayer on Zaisma rooms. none: single-player or the game's own servers. relay: Zaisma passes each message to the others, no server code. own: your game server runs on Zaisma: put it in zaisma-server.js at the top of the upload (one plain JavaScript ES module, no imports, default export { setup, onJoin, onLeave, onMessage, onTick, maxPlayers, tickRate }). It runs sealed off: no internet, so it only talks to its players. Players never get the file. get_stats shows its errors.",
  },
  room_browsing: {
    enum: ROOM_BROWSING,
    description:
      "For games on Zaisma rooms: where open rooms are listed so players can join them. page (the default): on the game page and to the game through Zaisma.rooms.list(). game: only to the game, for games with their own lobby or server browser. off: nowhere; room codes and invite links still work. Single rooms can be hidden with joinRoom({ listed: false }) or room.setListed(false).",
  },
};
function count(description: string) {
  return { type: ["object", "null"], description, properties: { min: { type: "integer", minimum: 2 }, max: { type: ["integer", "null"] }, style: { enum: PLAY_STYLES } }, required: ["min", "style"] };
}
const read = { readOnlyHint: true, openWorldHint: false } as const;
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const pick = (args: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
const str = (v: unknown) => encodeURIComponent(String(v ?? ""));

const TOOLS: Tool[] = [
  {
    name: "list_games",
    title: "List my games",
    description: "Your games, with their visibility (draft, listed, unlisted, private) and review status.",
    inputSchema: object({}),
    annotations: read,
    run: (_, call) => call("GET", "/games"),
  },
  {
    name: "create_game",
    title: "Make a game",
    description: "Make a new game. It starts as a draft only you can see. The link name comes from the title unless you give one.",
    inputSchema: object({ ...details, slug: { type: "string", description: "Link name: lowercase letters, numbers and single hyphens" } }, ["title"]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, call) => call("POST", "/games", pick(args, ["title", "slug", "description", "devices", "controls", "screen", "players", "cloud_saves", "room_browsing", "multiplayer"])),
  },
  {
    name: "get_game",
    title: "Get a game",
    description: "One game: its details, covers and screenshots, and every version with its scan result, preview link and whether it's live.",
    inputSchema: object({ slug }, ["slug"]),
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}`),
  },
  {
    name: "update_game",
    title: "Change a game's details",
    description:
      'Change the title, description, device labels, players (single-player, local and online multiplayer with player counts), cloud saves, room browsing or visibility. listed: on Zaisma for everyone. unlisted: only people with the link. private and draft: only you. A new title or description on a game players can see waits for review. Making a public game private or a draft takes it away from players, so it needs "confirm": true after asking the developer.',
    inputSchema: object({ slug, ...details, visibility: { enum: VISIBILITIES }, confirm: { type: "boolean", description: "The developer agreed to hide a public game" } }, ["slug"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (args, call) => {
      const change = pick(args, ["title", "description", "devices", "controls", "screen", "players", "cloud_saves", "room_browsing", "multiplayer", "visibility"]);
      if (change.visibility === "draft" || change.visibility === "private") {
        const { game } = (await call("GET", `/games/${str(args.slug)}`)) as { game: { visibility: string; review: string } };
        if ((game.visibility === "listed" || game.visibility === "unlisted") && game.review === "live" && args.confirm !== true) {
          throw new ApiError(409, "confirm", `Players can play this game now; making it ${change.visibility} takes it away from them. Ask the developer, then call again with "confirm": true.`);
        }
      }
      return call("PATCH", `/games/${str(args.slug)}`, change);
    },
  },
  {
    name: "upload_files",
    title: "Upload a small game",
    description: `Upload a new version from file contents, up to ${MCP_UPLOAD_BYTES / 1048576} MB in all. It needs an index.html at the top. Text files go in "text", other files (images, sounds) base64-encoded in "base64". It's scanned, then waits as a draft with a preview link (or goes live when it passes, with publish_when_approved). For bigger builds, run \`npx @zaisma/cli upload <folder> --game <slug>\` instead.`,
    inputSchema: object(
      {
        slug,
        files: {
          type: "array",
          minItems: 1,
          items: object({ path: { type: "string", description: "Like index.html or assets/hero.png" }, text: { type: "string" }, base64: { type: "string" } }, ["path"]),
        },
        notes: { type: "string", maxLength: 2000, description: "Patch notes: what changed" },
        publish_when_approved: { type: "boolean", description: "Go live as soon as it passes the scan" },
      },
      ["slug", "files"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, call) => uploadFiles(args, call),
  },
  {
    name: "get_version",
    title: "Check a version",
    description: "A version's scan result (scanning, held, approved or rejected), what the scan found and how to fix it, and its private preview link once it passes.",
    inputSchema: object({ slug, version_id: versionId }, ["slug", "version_id"]),
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}/versions/${str(args.version_id)}`),
  },
  {
    name: "publish_version",
    title: "Publish or roll back",
    description: 'Make a version that passed review live now, or at a set time with "at" (ISO 8601, from a few minutes to 90 days ahead). Publishing an older version rolls back to it. The live version and the last 5 are kept.',
    inputSchema: object({ slug, version_id: versionId, at: { type: "string", description: "Publish later, like 2026-11-01T17:00:00Z" } }, ["slug", "version_id"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("POST", `/games/${str(args.slug)}/versions/${str(args.version_id)}/publish`, args.at ? { at: args.at } : {}),
  },
  {
    name: "cancel_scheduled_publish",
    title: "Cancel a publish-later",
    description: "Stop a version from going live at its scheduled time.",
    inputSchema: object({ slug, version_id: versionId }, ["slug", "version_id"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("DELETE", `/games/${str(args.slug)}/versions/${str(args.version_id)}/publish`),
  },
  {
    name: "add_image",
    title: "Add a cover or screenshot",
    description: "Add a cover (replaces the old one once approved) or a screenshot (up to 8). PNG, JPEG or WebP, base64-encoded, up to 5 MB, at least 320 px a side. Images show once reviewed.",
    inputSchema: object({ slug, kind: { enum: ["cover", "screenshot"] }, base64: { type: "string" } }, ["slug", "kind", "base64"]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (args, call) => call("POST", `/games/${str(args.slug)}/images?kind=${str(args.kind)}`, decode(String(args.base64 ?? ""), "base64")),
  },
  {
    name: "remove_image",
    title: "Remove an image",
    description: "Remove a cover or screenshot by its ID from get_game.",
    inputSchema: object({ slug, image_id: { type: "string" } }, ["slug", "image_id"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (args, call) => call("DELETE", `/games/${str(args.slug)}/images/${str(args.image_id)}`),
  },
  {
    name: "get_reports",
    title: "Player reports",
    description:
      "What players reported about the game in the last 90 days, counted by reason, with the bug reports: what the player wrote, a one-line summary and the version they played. To check for new bug reports, pass the next_since from your last call as since.",
    inputSchema: object({ slug, since: { type: "integer", minimum: 0, description: "next_since from an earlier call: only bug reports that arrived after it." } }, ["slug"]),
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}/reports${args.since ? `?since=${str(args.since)}` : ""}`),
  },
  {
    name: "get_stats",
    title: "Play stats",
    description: "Multiplayer use per day: rooms, player minutes and messages. Plays and players coming back aren't counted yet.",
    inputSchema: object({ slug, days: { type: "integer", minimum: 1, maximum: 90 } }, ["slug"]),
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}/stats${args.days ? `?days=${str(args.days)}` : ""}`),
  },
  {
    name: "get_history",
    title: "Game history",
    description: "What happened to the game, newest first: uploads, scan results, publishes, rollbacks, reviews and holds, and whether you or Zaisma did it. Start here to answer why a game or version is held.",
    inputSchema: object({ slug }, ["slug"]),
    annotations: read,
    run: (args, call) => call("GET", `/games/${str(args.slug)}/history`),
  },
];

function decode(value: string, as: "text" | "base64"): Uint8Array {
  if (as === "text") return new TextEncoder().encode(value);
  try {
    return Uint8Array.from(atob(value.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(400, "bad_base64", "That isn't valid base64.");
  }
}

async function uploadFiles(args: Record<string, unknown>, call: ApiCall): Promise<unknown> {
  const input = Array.isArray(args.files) ? (args.files as { path?: unknown; text?: unknown; base64?: unknown }[]) : [];
  const files: { path: string; sha256: string; bytes: number; data: Uint8Array }[] = [];
  let total = 0;
  for (const f of input) {
    if (typeof f?.path !== "string" || (typeof f.text === "string") === (typeof f.base64 === "string")) {
      throw new ApiError(400, "bad_files", 'Each file needs a "path" and either "text" or "base64".');
    }
    const data = typeof f.text === "string" ? decode(f.text, "text") : decode(f.base64 as string, "base64");
    total += data.byteLength;
    if (total > MCP_UPLOAD_BYTES) throw new ApiError(413, "too_big_for_mcp", `Uploads through the MCP can be up to ${MCP_UPLOAD_BYTES / 1048576} MB. Run \`npx @zaisma/cli upload <folder> --game ${args.slug}\` for bigger games.`);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
    files.push({ path: f.path, sha256: hash, bytes: data.byteLength, data });
  }
  const list = files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }));
  const { missing } = (await call("POST", `/games/${str(args.slug)}/uploads`, { files: list })) as { missing: string[] };
  const sent = new Set<string>();
  for (const f of files) {
    if (!missing.includes(f.sha256) || sent.has(f.sha256)) continue;
    await call("PUT", `/files/${f.sha256}`, f.data);
    sent.add(f.sha256);
  }
  const result = await call("POST", `/games/${str(args.slug)}/versions`, {
    files: list,
    notes: typeof args.notes === "string" ? args.notes : "",
    ...(args.publish_when_approved ? { publish: "when-approved" } : {}),
  });
  return { ...result, sent: sent.size, next: "The scan usually takes under a minute. Check it with get_version." };
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: RpcMessage["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Send MCP messages as POST requests.", { status: 405, headers: { Allow: "POST" } });
  let caller: Caller;
  try {
    if (!request.headers.get("authorization")) throw new ApiError(401, "no_key", "Send an API key from zaisma.com/account as: Authorization: Bearer zsk_…");
    caller = await authenticate(request, env);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return Response.json(rpcError(null, -32001, err.message), { status: err.status, headers: err.status === 401 ? { "WWW-Authenticate": 'Bearer realm="zaisma"' } : {} });
  }
  const call: ApiCall = (method, path, payload) => apiCall(env, caller, method, path, payload);
  return serveMcp(
    request,
    { name: "zaisma", title: "Zaisma", instructions: INSTRUCTIONS },
    TOOLS.map((t) => ({ ...t, run: (args: Record<string, unknown>) => t.run(args, call) })),
    (err) => (err instanceof ApiError ? `${err.message} (${err.code})` : null),
  );
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Tool["annotations"];
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

/** A tool result that also shows pictures. */
export class WithImages {
  constructor(
    readonly data: unknown,
    readonly images: { data: string; mimeType: string }[],
  ) {}
}

/**
 * Answers MCP messages for a set of tools: Streamable HTTP without sessions or streaming, each POST
 * one JSON-RPC message (or a batch). `userError` turns a tool's refusal into words for the AI, or
 * returns null for a real failure.
 */
export async function serveMcp(request: Request, server: { name: string; title: string; instructions: string }, tools: McpTool[], userError: (err: unknown) => string | null): Promise<Response> {
  if (request.method !== "POST") return new Response("Send MCP messages as POST requests.", { status: 405, headers: { Allow: "POST" } });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json(rpcError(null, -32600, "That message is too big."), { status: 413 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Send JSON-RPC as JSON."), { status: 400 });
  }

  const answer = async (msg: RpcMessage): Promise<unknown | null> => {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Not a JSON-RPC 2.0 request.");
    if (msg.id === undefined) return null; // A notification, like notifications/initialized.
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
      case "initialize": {
        const asked = String(msg.params?.protocolVersion ?? "");
        return ok({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, title: server.title, version: "0.1.0", websiteUrl: "https://zaisma.com" },
          instructions: server.instructions,
        });
      }
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: tools.map(({ run: _, ...t }) => t) });
      case "tools/call": {
        const tool = tools.find((t) => t.name === msg.params?.name);
        if (!tool) return rpcError(msg.id, -32602, `No tool called ${String(msg.params?.name)}.`);
        const args = msg.params?.arguments && typeof msg.params.arguments === "object" ? (msg.params.arguments as Record<string, unknown>) : {};
        try {
          const result = await tool.run(args);
          const data = result instanceof WithImages ? result.data : result;
          const images = result instanceof WithImages ? result.images.map((i) => ({ type: "image", ...i })) : [];
          return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }, ...images], structuredContent: data });
        } catch (err) {
          const said = userError(err);
          if (said === null) throw err;
          return ok({ content: [{ type: "text", text: said }], isError: true });
        }
      }
      default:
        return rpcError(msg.id, -32601, `${msg.method} isn't supported.`);
    }
  };

  const headers = { "Cache-Control": "no-store" };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => answer(m as RpcMessage)))).filter((r) => r !== null);
    return out.length ? Response.json(out, { headers }) : new Response(null, { status: 202 });
  }
  const out = await answer(body as RpcMessage);
  return out === null ? new Response(null, { status: 202 }) : Response.json(out, { headers });
}
