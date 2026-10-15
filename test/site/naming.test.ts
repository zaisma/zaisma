import { describe, expect, it } from "vitest";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { ADMIN_TOOLS } from "../../apps/site/src/admin-mcp.ts";
import { namingProblems, schemaProblems } from "../schema-check.ts";

describe("names in the developer MCP follow docs/NAMING.md", () => {
  it("checks every tool", () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual(expect.arrayContaining(["list_games", "get_game", "update_game", "upload_files", "get_stats", "get_reports", "get_history", "search_forum", "get_topic", "post_topic", "message_zaisma"]));
  });

  for (const tool of TOOLS) {
    it(tool.name, () => {
      expect(namingProblems(tool.inputSchema, `${tool.name} input`, true)).toEqual([]);
      expect(tool.outputSchema, `${tool.name} needs an output schema`).toBeDefined();
      expect(tool.outputSchema!.type).toBe("object");
      expect(namingProblems(tool.outputSchema!, `${tool.name} answer`, false)).toEqual([]);
    });
  }
});

describe("names in the admin MCP follow docs/NAMING.md", () => {
  for (const tool of ADMIN_TOOLS) {
    it(tool.name, () => {
      expect(namingProblems(tool.inputSchema, `${tool.name} input`, true)).toEqual([]);
      expect(tool.outputSchema.type).toBe("object");
      expect(namingProblems(tool.outputSchema, `${tool.name} answer`, false)).toEqual([]);
    });
  }
});

describe("the naming check itself", () => {
  const inputs = (properties: Record<string, unknown>) => namingProblems({ type: "object", properties, additionalProperties: false }, "x", true);
  const answers = (properties: Record<string, unknown>) => namingProblems({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }, "x", false);

  it("catches the names it should", () => {
    expect(answers({ files: { type: "integer" } }).join()).toContain("a number ends in _count");
    expect(answers({ files: { type: "integer" } }).join()).toContain("a plural names a list");
    expect(answers({ created_at: { type: "integer" } }).join()).toContain("*_at");
    expect(answers({ rotation: { type: "number" } }).join()).toContain("a number ends in");
    expect(answers({ dt: { type: "number" } }).join()).toContain("short forms");
    expect(answers({ max_players: { type: "integer" } }).join()).toContain("maximum_");
    expect(answers({ live: { type: "boolean" } }).join()).toContain("yes/no");
    expect(answers({ next: { type: "array", items: { type: "string" } } }).join()).toContain("plural");
    expect(answers({ data: { type: "string" } }).join()).toContain("doesn't say what it is");
    expect(answers({ version_id: { type: "string" } }).join()).toContain("an ID says its kind");
    expect(inputs({ topic_id: { type: "string", pattern: "^[a-z0-9]+$" } }).join()).toContain("an ID says its kind");
    expect(inputs({ context: { type: "object" } }).join()).toContain("free-form");
    expect(answers({ game: { type: "object", properties: { slug: { type: "string" } }, additionalProperties: false } }).join()).toContain("every key every time");
  });

  it("lets good names through", () => {
    expect(
      answers({
        file_count: { type: "integer" },
        play_duration_min: { type: "integer" },
        rotation_deg: { type: "number" },
        ticks_per_sec: { type: "number" },
        published_at: { type: ["string", "null"], format: "date-time" },
        date: { type: "string", format: "date" },
        is_live: { type: "boolean" },
        cloud_saves_enabled: { type: "boolean" },
        version_id: { type: "string", pattern: "^version_[a-z0-9]+$" },
        files: { type: "array", items: { type: "string" } },
      }),
    ).toEqual([]);
    expect(inputs({ confirm: { type: "boolean" }, undo: { type: "boolean" } })).toEqual([]);
    // Plurals without an s, and a list sent in a format.
    expect(answers({ people: { type: "array", items: { type: "string" } }, media: { type: "array", items: { type: "string" } } })).toEqual([]);
    expect(inputs({ images_base64: { type: "array", items: { type: "string" } } })).toEqual([]);
    expect(inputs({ image_base64: { type: "array", items: { type: "string" } } }).join()).toContain("plural");
  });

  it("checks answers against their schema", () => {
    const schema = { type: "object", properties: { at: { type: "string", format: "date-time" }, n: { type: "integer" } }, required: ["at", "n"], additionalProperties: false };
    expect(schemaProblems(schema, { at: "2026-10-14T09:30:00.000Z", n: 2 })).toEqual([]);
    expect(schemaProblems(schema, { at: 1792012345678, n: 2 })).toEqual(["answer.at: is integer, expected string"]);
    expect(schemaProblems(schema, { at: "2026-10-14T09:30:00.000Z" })).toEqual(["answer.n: missing"]);
    expect(schemaProblems(schema, { at: "2026-10-14T09:30:00.000Z", n: 2, extra: true })).toEqual(["answer.extra: not in the schema"]);
    const withId = { type: "object", properties: { id: { type: "string", pattern: "^version_[a-z0-9]+$" } }, required: ["id"], additionalProperties: false };
    expect(schemaProblems(withId, { id: "version_8f3k2m9q1x7c4v6b0n5z" })).toEqual([]);
    expect(schemaProblems(withId, { id: "8f3k2m9q1x7c4v6b0n5z" })).toEqual(["answer.id: 8f3k2m9q1x7c4v6b0n5z doesn't match ^version_[a-z0-9]+$"]);
  });
});
