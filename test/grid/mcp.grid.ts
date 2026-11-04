import { createExecutionContext, env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";
import { ACCOUNT_AREAS, AREA_ACCESS_BY_LEVEL, AREA_ACCESS_CHOICES, type AreaAccess } from "@zaisma/core";
import { ADMIN_TOOLS } from "../../apps/site/src/admin-mcp.ts";
import { BANNED_DEVELOPER_ROUTES, apiRoutesAt, type ApiRoute } from "../../apps/site/src/developer.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { CONFIRMED_ON_A_PAGE, SAMPLES, keyFor, nameOf, setUpOwnersCall, useRealServers, useStandInServers, type SiteWorker, type World } from "../site/access-world.ts";
import { CALLER_KINDS, cellOf, problemWithAnswer, type CallAnswer, type CallerKind, type GridCell } from "./cells.ts";
import { TOOL_ARGUMENTS } from "./tool-samples.ts";
import { SITE, emptyWorlds, keyWithScope, makeWorld, ownersThings, rememberEmptyTables, sessionCookie, showsPrivateValue, useSessions, whileBanned } from "./site-world.ts";

vi.mock("../../apps/site/src/shader-check.ts", async (original) => (await import("./shader-stand-in.ts")).shaderCheckStandIn(await original<object>()));
vi.resetModules();
const worker = (await import("../../apps/site/src/index.ts")).default as unknown as SiteWorker;

/**
 * Every live MCP tool and admin tool by every kind of caller (test/grid/cells.ts). A tool's refusal is its isError, so here that
 * counts as the door's 403. An MCP tool makes API calls, and each tool is held to the first call that changes something.
 */

type Tool = (typeof TOOLS)[number];
const OWNING_PARTS = ["game", "webhook", "sign_in_app", "forum_topic"];

/** The API calls a tool makes, by running it against a stand-in for the API. */
async function routesOfTool(tool: Tool): Promise<ApiRoute[]> {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
  const example = ((tool.inputSchema as { examples?: Record<string, unknown>[] }).examples ?? [])[0] ?? {};
  const routes: ApiRoute[] = [];
  const toolArguments = { ...Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, schema.enum?.[0] ?? (name.endsWith("_base64") ? "AAAA" : schema.type === "array" ? [] : schema.type === "number" || schema.type === "integer" ? 1 : schema.type === "boolean" ? true : schema.type === "object" ? {} : "a")])), ...example };
  try {
    await tool.run(toolArguments as never, (async (method: string, path: string) => {
      const route = apiRoutesAt(path.split("?")[0]!).find((candidate) => candidate.method === method);
      if (route && !routes.includes(route)) routes.push(route);
      return { game: { visibility: "draft", review_status: "draft" }, version: {}, missing_file_hashes: [], next_steps: [] };
    }) as never);
  } catch {}
  return routes;
}

/** A tool's arguments, from its call's sample and the world, by name: the API and MCP use one name for one thing. */
function argumentsOf(tool: Tool, route: ApiRoute | undefined, world: World): Record<string, unknown> {
  const sample = route ? SAMPLES[nameOf(route)]!(world) : {};
  const known: Record<string, unknown> = { ...world.values, game_slug: world.values.slug, ...sample.pathValues, ...sample.query, ...sample.body };
  const properties = Object.keys(tool.inputSchema.properties ?? {});
  return { ...Object.fromEntries(properties.filter((name) => name in known).map((name) => [name, known[name]])), ...TOOL_ARGUMENTS[tool.name]?.(world) };
}

async function callTool(address: string, name: string, toolArguments: Record<string, unknown>, headers: Record<string, string>) {
  let response: Response;
  try {
    response = await worker.fetch(new Request(address, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: toolArguments } }) }), env, createExecutionContext());
  } catch {
    return { http_status: 500, answerText: "", isError: true };
  }
  const answerText = await response.text();
  let isError = false;
  try {
    isError = Boolean((JSON.parse(answerText) as { result?: { isError?: boolean }; error?: unknown }).result?.isError);
  } catch {}
  return { http_status: isError ? 403 : response.status, answerText, isError };
}

beforeAll(async () => {
  useStandInServers();
  await useSessions();
  await rememberEmptyTables();
});

afterEach(emptyWorlds);

afterAll(useRealServers);

const liveTools = TOOLS.filter((tool) => !tool.replacedBy);

describe("every MCP tool", () => {
  it.for(liveTools.map((tool) => [`mcp:${tool.name}`, tool] as const))("%s", { timeout: 120_000 }, async ([doorId, tool], { task }) => {
    const cells: GridCell[] = (task.meta.grid_cells = []);
    const routes = await routesOfTool(tool);
    const route = routes.find((candidate) => candidate.method !== "GET") ?? routes[0];
    const routeName = route ? nameOf(route) : "";
    const world = await makeWorld(routeName);
    const toolArguments = argumentsOf(tool, route, world);
    const attempt = async (key: string | null, callerKnows: readonly string[] = [], given = toolArguments): Promise<CallAnswer> => {
      const before = await ownersThings(world);
      const made = await callTool(`${SITE}/mcp`, tool.name, given, key ? { authorization: `Bearer ${key}` } : {});
      return { http_status: made.http_status, location: null, is_owners_changed: (await ownersThings(world)) !== before, is_private_value_shown: showsPrivateValue(world, made.answerText, JSON.stringify(given), callerKnows) };
    };
    const owns = [world.victimAccountId, world.victimOwnerId, world.otherSlug];
    const ownerKey = await keyFor(world.victimAccountId);
    const judge = async (callerKind: CallerKind, expected: Parameters<typeof problemWithAnswer>[0], answer: CallAnswer) => cells.push(cellOf(doorId, callerKind, problemWithAnswer(expected, null, answer)));

    await judge("stranger", "refused", await attempt(null));
    const isOwning = route ? Object.values(route.pathParts).some((part) => OWNING_PARTS.includes(part)) : false;
    // The owner's own game, webhook, sign-in app or private topic, whatever public one the owner's call uses.
    const owning = route ? Object.fromEntries(Object.entries(route.pathParts).filter(([, part]) => OWNING_PARTS.includes(part)).map(([name]) => [name, world.values[name]!])) : {};
    await judge("another_account", isOwning ? "refused" : "own_things_only", await attempt(await keyFor(world.strangerAccountId), [], { ...toolArguments, ...owning }));
    if (route?.area) {
      const choices: readonly string[] = AREA_ACCESS_CHOICES[route.area];
      const shortOf = choices[choices.indexOf(route.choice) - 1];
      if (shortOf) await judge("weaker_key", "refused", await attempt(await keyWithScope(world.victimAccountId, { accessLevel: "custom", areaAccess: { ...AREA_ACCESS_BY_LEVEL.full, [route.area]: shortOf } as AreaAccess, gameSlugs: null }), owns));
    }
    if (route && (Object.values(route.pathParts).includes("game") || route.isAccountWide || (route.area && ACCOUNT_AREAS.includes(route.area)))) {
      await judge("another_games_key", "refused", await attempt(await keyWithScope(world.victimAccountId, { accessLevel: "custom", areaAccess: { ...AREA_ACCESS_BY_LEVEL.full, sign_in_app_access: "none", webhook_access: "none" }, gameSlugs: [world.otherSlug] }), owns));
    }
    await judge("banned_account", "refused", await whileBanned(world.victimAccountId, "whole_account", () => attempt(ownerKey, owns)));
    if (route && BANNED_DEVELOPER_ROUTES.has(routeName)) await setUpOwnersCall(routeName, world);
    const isOpenWhenBanned = routes.length > 0 && routes.every((candidate) => BANNED_DEVELOPER_ROUTES.has(nameOf(candidate)));
    const banned = await whileBanned(world.victimAccountId, "developer", () => attempt(ownerKey, owns));
    await judge("banned_developer", isOpenWhenBanned ? "goes_through" : "refused", isOpenWhenBanned ? { ...banned, is_owners_changed: false } : banned);

    const ownersWorld = await makeWorld(routeName);
    await setUpOwnersCall(routeName, ownersWorld);
    const made = await callTool(`${SITE}/mcp`, tool.name, argumentsOf(tool, route, ownersWorld), { authorization: `Bearer ${await keyFor(ownersWorld.victimAccountId)}` });
    // A call that needs the owner's passkey on a page first refuses even the owner's key.
    if (CONFIRMED_ON_A_PAGE.has(routeName)) cells.push(cellOf(doorId, "owner", made.isError ? null : "Went through, where it needs a passkey on a page first."));
    else cells.push(cellOf(doorId, "owner", made.isError || made.http_status >= 400 ? `Answered ${made.http_status}, where it should go through.` : null));
  });
});

describe("every admin tool", () => {
  it.for(ADMIN_TOOLS.map((tool) => [`admin:${tool.name}`, tool] as const))("%s", { timeout: 120_000 }, async ([doorId, tool], { task }) => {
    const cells: GridCell[] = (task.meta.grid_cells = []);
    const world = await makeWorld();
    const keys = { weaker_key: await keyWithScope(world.victimAccountId, { accessLevel: "read", gameSlugs: null }), another_games_key: await keyWithScope(world.victimAccountId, { accessLevel: "full", gameSlugs: [world.otherSlug] }) };
    const headersOf = async (callerKind: CallerKind): Promise<Record<string, string>> => {
      if (callerKind === "stranger") return {};
      if (callerKind === "weaker_key" || callerKind === "another_games_key") return { authorization: `Bearer ${keys[callerKind]}` };
      return { cookie: await sessionCookie(callerKind === "another_account" ? world.strangerAccountId : world.victimAccountId), origin: SITE };
    };
    for (const callerKind of CALLER_KINDS.filter((kind) => kind !== "owner")) {
      const headers = await headersOf(callerKind);
      const run = async (): Promise<CallAnswer> => {
        const before = await ownersThings(world);
        const made = await callTool(`${SITE}/admin/mcp`, tool.name, {}, headers);
        return { http_status: made.http_status, location: null, is_owners_changed: (await ownersThings(world)) !== before, is_private_value_shown: false };
      };
      const answer = callerKind === "banned_account" ? await whileBanned(world.victimAccountId, "whole_account", run) : callerKind === "banned_developer" ? await whileBanned(world.victimAccountId, "developer", run) : await run();
      cells.push(cellOf(doorId, callerKind, problemWithAnswer("refused", null, answer)));
    }
    // Zaisma's own people: past the guard is all this shows, since no arguments may be just what the tool refuses.
    const made = await callTool("http://localhost/admin/mcp", tool.name, {}, { origin: "http://localhost" });
    cells.push(cellOf(doorId, "owner", made.http_status === 401 || (made.http_status === 403 && !made.isError) ? `Answered ${made.http_status} to Zaisma's own people.` : null));
  });
});
