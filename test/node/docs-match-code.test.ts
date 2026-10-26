import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "../../packages/core/src/errors.ts";
import { FORUM_TABS } from "../../packages/core/src/forum.ts";

/**
 * The docs say what the code does ("Nothing for an AI to guess" in docs/DECISIONS.md): each list a doc keeps by hand is compared
 * with the code it describes, so the next drift fails here instead of misleading an AI.
 */

const ROOT = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const developerApi = read("docs/DEVELOPER-API.md");
const naming = read("docs/NAMING.md");
const adminMcp = read("docs/ADMIN-MCP.md");

const namesIn = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
const sorted = (names: Iterable<string>) => [...new Set(names)].sort();
const lineStarting = (text: string, start: string) => {
  const line = text.split("\n").find((candidate) => candidate.startsWith(start));
  if (!line) throw new Error(`No line starts with ${start}`);
  return line;
};
/** The text from a heading to the next heading of the same or a higher level. */
const section = (text: string, heading: string) => {
  const level = heading.match(/^#+/)![0].length;
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`No heading ${heading}`);
  const rest = text.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`\\n#{1,${level}} `));
  return end < 0 ? rest : rest.slice(0, end);
};
/** The quoted names of a declaration in a source file, up to its closing `;` at a line's end. */
const quotedIn = (path: string, declaration: string) => {
  const source = read(path);
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`${declaration} isn't in ${path}`);
  const length = source.slice(start).search(/;\n/);
  return [...source.slice(start, start + length).matchAll(/"([A-Za-z_0-9]+)"/g)].map((match) => match[1]!);
};
/** Each tool's name in an MCP source file, with whether the tool is retired (it names the tool that replaces it). */
const toolsIn = (path: string) => {
  const parts = read(path).split(/^ {4}name: "(\w+)",$/m);
  const tools: { name: string; isRetired: boolean; block: string }[] = [];
  for (let index = 1; index < parts.length; index += 2) tools.push({ name: parts[index]!, isRetired: parts[index + 1]!.slice(0, parts[index + 1]!.search(/^ {2}\},?$/m)).includes("replacedBy"), block: parts[index + 1]! });
  return tools;
};
const TOOLS = toolsIn("apps/site/src/mcp.ts");
const ADMIN_TOOLS = toolsIn("apps/site/src/admin-mcp.ts");
const GAME_DETAIL_INPUTS = quotedIn("apps/site/src/developer.ts", "const GAME_DETAIL_INPUTS");
const glossaryNames = (label: string) => namesIn(lineStarting(naming, `| ${label}`).split(" (the same words")[0]!);

describe("the docs say what the code does", () => {
  it("lists every MCP tool in the MCP paragraph, and only those", () => {
    const paragraph = lineStarting(developerApi, "Every tool is a call to this API");
    const documented = namesIn(paragraph).filter((name) => /^[a-z]+(_[a-z]+)*$/.test(name) && name !== "confirm");
    expect(sorted(documented)).toEqual(sorted(TOOLS.filter((tool) => !tool.isRetired).map((tool) => tool.name)));
  });

  it("gives POST /games the inputs the game details take", () => {
    const inputs = [...lineStarting(developerApi, "| `POST /games` |").split("|")[2]!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
    expect(sorted(inputs)).toEqual(sorted(["title", "slug", ...GAME_DETAIL_INPUTS]));
  });

  it("names the pass claims and checks of the Players paragraph as the game server has them", () => {
    const paragraph = section(developerApi, "## Players").split("\n").find((line) => line.includes("passesAreFriends"))!;
    const pass = read("packages/game-server/src/pass.ts");
    const exported = read("packages/game-server/src/index.ts");
    for (const claim of ["chat_group_id", "player_tag_id", "friend_player_tag_ids", "block_player_tag_ids"]) {
      expect(paragraph, claim).toContain(`\`${claim}\``);
      expect(pass, claim).toContain(`${claim}?:`);
    }
    for (const check of ["passesAreFriends", "passesHaveBlockBetween", "canChat"]) {
      expect(paragraph, check).toContain(`\`${check}(`);
      expect(exported, check).toContain(check);
    }
    for (const stale of ["areFriends(", "friend_tag_ids", "`chat_group`", "`player_tag`"]) expect(paragraph, stale).not.toContain(stale);
  });

  it("lists the room events the SDK has", () => {
    const documented = section(developerApi, "### Room events").split("\n").filter((line) => /^\| `\w+` \|/.test(line)).map((line) => line.match(/^\| `(\w+)`/)![1]!);
    const types = read("packages/sdk/zaisma.d.ts");
    const start = types.indexOf("interface RoomEvents {");
    const body = types.slice(start, start + types.slice(start).search(/\n {2}}\n/));
    expect(sorted(documented)).toEqual(sorted([...body.matchAll(/^ {4}(\w+): \(/gm)].map((match) => match[1]!)));
  });

  it("lists the admin tools and the report decisions as the admin MCP has them", () => {
    const toolNames = new Set(ADMIN_TOOLS.map((tool) => tool.name));
    const rows = adminMcp.split("\n").filter((line) => /^\| `[a-z_]+`/.test(line));
    const documented = rows.flatMap((line) => namesIn(line.split("|")[1]!)).filter((name) => toolNames.has(name));
    expect(sorted(documented)).toEqual(sorted(toolNames));
    const decide = ADMIN_TOOLS.find((tool) => tool.name === "decide_report_group")!;
    const decisions = [...decide.block.match(/decision: \{\n\s+enum: \[([^\]]+)\]/)![1]!.matchAll(/"(\w+)"/g)].map((match) => match[1]!);
    const row = lineStarting(adminMcp, "| `decide_report_group` |");
    const listed = namesIn(row.split("|")[2]!.split("exactly like")[0]!);
    expect(sorted(listed.filter((name) => decisions.includes(name)))).toEqual(sorted(decisions));
  });

  it("keeps NAMING.md's glossary lists to the constants they describe", () => {
    const alertKinds = quotedIn("apps/site/src/developer.ts", "export const GAME_ALERT_KINDS");
    expect(glossaryNames("What needs a developer's attention in a game")).toEqual(expect.arrayContaining(alertKinds));
    const reviewSource = read("packages/core/src/review.ts");
    const rules = [...reviewSource.slice(reviewSource.indexOf("export const CONTENT_RULES")).split("} as const")[0]!.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]!);
    expect(glossaryNames("A content rule, as a hold or takedown names it")).toEqual(["content_rule", ...rules]);
    expect(glossaryNames("What a request to a game server can fail with").filter((name) => name !== "RequestErrorCode")).toEqual(quotedIn("packages/game-server/src/requests.ts", "export type RequestErrorCode"));
    const closeRow = lineStarting(naming, "| Why a room closed a connection");
    for (const match of read("packages/game-server/src/room.ts").matchAll(/^export const (\w+_CLOSE_CODE) = (\d+);/gm)) expect(closeRow, match[1]).toContain(`\`${match[1]}\` (${match[2]}`);
  });

  it("writes a version's publish time as scheduled_publish_at in NAMING.md's examples", () => {
    expect(read("apps/site/src/mcp.ts")).toContain("scheduled_publish_at");
    expect(naming).not.toMatch(/(?<![a-z_])publish_at(?![a-z_])/);
  });

  it("says in bad_tab every tab the forum has", () => {
    for (const tab of FORUM_TABS) {
      expect(ERROR_CODES.bad_tab.meaning, tab).toContain(tab);
      expect(lineStarting(developerApi, "| `bad_tab` |"), tab).toContain(tab);
    }
  });
});
