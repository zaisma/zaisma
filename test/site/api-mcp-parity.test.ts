import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createAccount, createApiKey } from "@zaisma/core";
import { API_ROUTES, apiRoutesAt } from "../../apps/site/src/developer.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";

/**
 * "What a developer can see, their AI can see" (CLAUDE.md, Rules for code; docs/DECISIONS.md, The
 * direction): every developer API call has an MCP tool that makes it, and every call a tool makes is a
 * real one. The calls without a tool are named here, each with why.
 */

/** API calls with no MCP tool, on purpose: "METHOD /path" as in API_ROUTES, and the reason. */
const WITHOUT_TOOL: Record<string, string> = {
  "GET /games/:slug/testers": "get_game already answers the same tester links.",
  "POST /files/:sha256/parts": "Big files (over 95 MB) go through the upload command; upload_files takes builds up to 5 MB.",
  "PUT /files/:sha256/parts/:part_number": "A part of a big file: the upload command's, like the call that starts it.",
  "POST /files/:sha256/parts/done": "Finishes a big file: the upload command's, like the call that starts it.",
  "GET /forum/similar": "The page's look-alikes while a title is typed; post_topic answers similar_topics and search_forum finds the rest.",
  "POST /forum/media": "The page's image upload; tools send images inline as images_base64 in the post itself.",
  "GET /forum/:topic_id/media/:media_id": "An image's bytes; get_topic gives each image's image_url, which serves them.",
};

const nameOf = (apiRoute: { method: string; path: string }) => `${apiRoute.method} ${apiRoute.path}`;

interface PropertySchema {
  type?: string | string[];
  enum?: unknown[];
  examples?: unknown[];
  anyOf?: PropertySchema[];
  oneOf?: PropertySchema[];
}

/** A value a tool would take for one argument; flag is what every boolean gets, so both branches run. */
function sampleValue(name: string, schema: PropertySchema, flag: boolean): unknown {
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

/** The API calls a tool makes, run with every argument filled in, against an API that says yes to everything. */
async function callsOf(tool: (typeof TOOLS)[number]): Promise<{ method: string; path: string }[]> {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, PropertySchema>;
  const example = ((tool.inputSchema.examples ?? []) as Record<string, unknown>[])[0] ?? {};
  const calls: { method: string; path: string }[] = [];
  for (const flag of [false, true]) {
    const toolArguments = { ...Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, sampleValue(name, schema, flag)])), ...example };
    await tool.run(toolArguments, async (method, path, body) => {
      calls.push({ method, path: path.split("?")[0]! });
      const files = (body as { files?: { sha256: string }[] } | undefined)?.files;
      return { game: { visibility: "draft", review_status: "draft" }, version: {}, missing_file_hashes: (files ?? []).map((file) => file.sha256), next_steps: [] };
    });
  }
  return calls;
}

describe("the developer API and the MCP", async () => {
  const routesByTool = new Map<string, string[]>();
  for (const tool of TOOLS) {
    routesByTool.set(
      tool.name,
      (await callsOf(tool)).map((call) => {
        const apiRoute = apiRoutesAt(call.path).find((candidate) => candidate.method === call.method);
        return apiRoute ? nameOf(apiRoute) : `no such call: ${call.method} ${call.path}`;
      }),
    );
  }
  const toolsByRoute = new Map<string, string[]>();
  for (const [toolName, routeNames] of routesByTool) for (const routeName of routeNames) toolsByRoute.set(routeName, [...new Set([...(toolsByRoute.get(routeName) ?? []), toolName])]);

  it("every API call has an MCP tool, or is named in WITHOUT_TOOL with why", () => {
    const missing = API_ROUTES.map(nameOf).filter((routeName) => !toolsByRoute.has(routeName) && !(routeName in WITHOUT_TOOL));
    expect(
      missing,
      `These API calls have no MCP tool: ${missing.join("; ")}. Add a tool in apps/site/src/mcp.ts that makes the call (docs/NAMING.md, and "Adding a building block" in CLAUDE.md), or, if an AI truly shouldn't make it, name it in WITHOUT_TOOL in this file with a one-line reason.`,
    ).toEqual([]);
  });

  it("every call a tool makes is a real API call", () => {
    const wrong = [...routesByTool].flatMap(([toolName, routeNames]) => routeNames.filter((routeName) => routeName.startsWith("no such call")).map((routeName) => `${toolName}: ${routeName}`));
    expect(wrong, `These tools call paths the API doesn't answer: ${wrong.join("; ")}. Fix the tool's path, or add the call to API_ROUTES in apps/site/src/developer.ts and to the router.`).toEqual([]);
    for (const [toolName, routeNames] of routesByTool) expect(routeNames.length, `${toolName} makes no API call; every tool is a call to the developer API.`).toBeGreaterThan(0);
  });

  it("WITHOUT_TOOL names only real calls that really have no tool", () => {
    const routeNames = API_ROUTES.map(nameOf);
    for (const [routeName, reason] of Object.entries(WITHOUT_TOOL)) {
      expect(routeNames, `WITHOUT_TOOL names ${routeName}, which isn't in API_ROUTES; take it out.`).toContain(routeName);
      expect(toolsByRoute.get(routeName), `${routeName} has a tool now (${toolsByRoute.get(routeName)?.join(", ")}); take it out of WITHOUT_TOOL.`).toBeUndefined();
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("the router answers every call in API_ROUTES", async () => {
    // Placeholders are made up, so most calls say no; never with "no such call" or "wrong method".
    await createAccount(env.DB, { id: "parity-dev", username: "Parity_Dev", ageBand: "18+" });
    const { token } = await createApiKey(env.DB, "parity-dev", "parity");
    const unanswered: string[] = [];
    for (const apiRoute of API_ROUTES) {
      const path = apiRoute.path.replace(/:[a-z0-9_]+/g, (name) => (name === ":sha256" ? "0".repeat(64) : name === ":part_number" ? "1" : "parity-test"));
      const response = await SELF.fetch(`https://zaisma.test/api/dev${path}`, {
        method: apiRoute.method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: apiRoute.method === "GET" ? undefined : "{}",
      });
      const error = response.ok ? null : ((await response.json().catch(() => ({}))) as { error?: { code: string; message: string } }).error;
      if (error?.code === "bad_method" || error?.message.startsWith("There's no API call")) unanswered.push(`${nameOf(apiRoute)} (${error.message})`);
    }
    await env.DB.exec("DELETE FROM api_keys WHERE account_id = 'parity-dev'; DELETE FROM owners WHERE account_id = 'parity-dev'; DELETE FROM accounts WHERE id = 'parity-dev';");
    expect(unanswered, `API_ROUTES lists calls the router doesn't answer: ${unanswered.join("; ")}. Handle them in route() or take them out.`).toEqual([]);
  });

  it("API_ROUTES has each call once", () => {
    const routeNames = API_ROUTES.map(nameOf);
    expect(routeNames.filter((routeName, i) => routeNames.indexOf(routeName) !== i)).toEqual([]);
  });
});
