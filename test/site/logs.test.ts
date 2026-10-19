import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, gameBySlug, logDay, logKey, logPrefix, type StoredLogLine } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { deleteOldLogs } from "../../apps/site/src/logs-api.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// A game server's logs through the developer API and MCP (apps/site/src/logs-api.ts). The rooms Worker
// writes the files (test/rooms/logs.test.ts); here they're written the same way, by hand.

const SITE = "https://zaisma.test";
const VERSION_ID = "version_boss1";
let token = "";
let gameId = "";
let nextId = 1;

async function api(path: string) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, { headers: { authorization: `Bearer ${token}` } });
  const answer = (await res.json()) as any;
  if (!res.ok) expect(errorProblems(answer, res.status)).toEqual([]);
  return { status: res.status, answer };
}

async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const res = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await res.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** One file as a room (or the game's object, writer "server") writes it, with the lines printed a little before. */
async function writeFile(writtenAtMs: number, writerName: string, lines: Partial<StoredLogLine>[]) {
  const stored: StoredLogLine[] = lines.map((line, index) => ({ atMs: writtenAtMs - 1000 + index, level: "log", text: "", sourceKind: writerName === "server" ? "request" : "room", roomCode: writerName === "server" ? null : writerName, versionId: VERSION_ID, ...line }));
  await env.GAMES.put(logKey(gameId, writtenAtMs, writerName), stored.map((line) => JSON.stringify(line)).join("\n"), {
    customMetadata: { levels: [...new Set(stored.map((line) => line.level))].join(","), sourceKinds: [...new Set(stored.map((line) => line.sourceKind))].join(","), roomCode: stored[0]!.roomCode ?? "" },
  });
  await env.DB.prepare("INSERT OR IGNORE INTO game_log_days (game_id, day) VALUES (?, ?)").bind(gameId, logDay(writtenAtMs)).run();
}

const texts = (answer: any) => answer.log_lines.map((line: { text: string }) => line.text);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts; DELETE FROM game_log_days;");
  await createAccount(env.DB, { id: "dev-1", username: "Anna_Builds", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  expect((await (await SELF.fetch(`${SITE}/api/dev/games`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Boss Fight", slug: "boss-fight" }) })).status)).toBe(201);
  gameId = (await gameBySlug(env.DB, "boss-fight"))!.id;
  for (let listed = await env.GAMES.list({ prefix: "logs/" }); listed.objects.length; listed = await env.GAMES.list({ prefix: "logs/" })) await env.GAMES.delete(listed.objects.map((object) => object.key));
});

describe("get_logs", () => {
  it("answers the newest lines oldest first, and follows with new_lines_cursor", async () => {
    expect(await tool("get_logs", { slug: "boss-fight" })).toMatchObject({ log_lines: [], next_cursor: null, new_lines_cursor: expect.stringMatching(/^logs_new_/) });
    const nowMs = Date.now();
    await writeFile(nowMs - 60_000, "K7Q2MX", [{ text: "player joined: 1 in room", level: "info" }, { text: "round 1 starts" }]);
    await writeFile(nowMs - 30_000, "K7Q2MX", [{ text: "slow tick 48 ms", level: "warn" }, { text: "TypeError: hp of undefined", level: "error" }]);
    const first = await tool("get_logs", { slug: "boss-fight" });
    expect(texts(first)).toEqual(["player joined: 1 in room", "round 1 starts", "slow tick 48 ms", "TypeError: hp of undefined"]);
    expect(first.log_lines[3]).toEqual({ logged_at: new Date(nowMs - 30_000 - 1000 + 1).toISOString(), level: "error", text: "TypeError: hp of undefined", source_kind: "room", room_code: "K7Q2MX", version_id: VERSION_ID });
    expect(first.next_cursor).toBeNull();

    // Nothing new yet, then only what was written since.
    const quiet = await tool("get_logs", { slug: "boss-fight", new_lines_cursor: first.new_lines_cursor });
    expect(quiet.log_lines).toEqual([]);
    // A room that writes late: its lines are older than the last ones, but written after them.
    await writeFile(nowMs - 1000, "PQRS22", [{ text: "late room", atMs: nowMs - 50_000 }]);
    await writeFile(nowMs, "server", [{ text: "request buy" }]);
    const fresh = await tool("get_logs", { slug: "boss-fight", new_lines_cursor: quiet.new_lines_cursor });
    expect(texts(fresh)).toEqual(["late room", "request buy"]);
    expect((await tool("get_logs", { slug: "boss-fight", new_lines_cursor: fresh.new_lines_cursor })).log_lines).toEqual([]);
  });

  it("goes back a page at a time with next_cursor, across files and days, each line once", async () => {
    const nowMs = Date.now();
    const lineCount = 37;
    // Files of 5 lines, one a minute, the oldest yesterday.
    for (let fileIndex = 0; fileIndex * 5 < lineCount; fileIndex++) {
      const writtenAtMs = nowMs - (8 - fileIndex) * 3 * 3600_000;
      await writeFile(writtenAtMs, "K7Q2MX", Array.from({ length: Math.min(5, lineCount - fileIndex * 5) }, (_, index) => ({ text: `line ${fileIndex * 5 + index}` })));
    }
    const seen: string[] = [];
    let answer = (await api("/games/boss-fight/logs?maximum_line_count=7")).answer;
    expect(texts(answer)).toEqual(Array.from({ length: 7 }, (_, index) => `line ${30 + index}`));
    for (;;) {
      seen.unshift(...texts(answer));
      if (!answer.next_cursor) break;
      answer = (await api(`/games/boss-fight/logs?maximum_line_count=7&cursor=${answer.next_cursor}`)).answer;
      expect(answer.new_lines_cursor).toBeNull();
    }
    expect(seen).toEqual(Array.from({ length: lineCount }, (_, index) => `line ${index}`));
  });

  it("narrows by room, level, where it ran and text", async () => {
    const nowMs = Date.now();
    await writeFile(nowMs - 3000, "K7Q2MX", [{ text: "round 1 starts" }, { text: "debugging the boss", level: "debug" }, { text: "Boss HP 0", level: "warn" }]);
    await writeFile(nowMs - 2000, "PQRS22", [{ text: "other room", level: "error" }]);
    await writeFile(nowMs - 1000, "server", [{ text: "request buy" }, { text: "daily reset", sourceKind: "schedule" }]);
    expect(texts((await api("/games/boss-fight/logs?room_code=K7Q2MX")).answer)).toEqual(["round 1 starts", "debugging the boss", "Boss HP 0"]);
    expect(texts((await api("/games/boss-fight/logs?minimum_level=info")).answer)).toEqual(["round 1 starts", "Boss HP 0", "other room", "request buy", "daily reset"]);
    expect(texts((await api("/games/boss-fight/logs?minimum_level=warn")).answer)).toEqual(["Boss HP 0", "other room"]);
    expect(texts((await api("/games/boss-fight/logs?source_kind=schedule")).answer)).toEqual(["daily reset"]);
    expect(texts((await api("/games/boss-fight/logs?search_text=boss")).answer)).toEqual(["debugging the boss", "Boss HP 0"]);
  });

  it("refuses inputs it doesn't take, saying what to send", async () => {
    for (const [query, code] of [
      ["room_code=lobby", "bad_room_code"],
      ["minimum_level=log", "bad_minimum_level"],
      ["source_kind=tick", "bad_source_kind"],
      ["maximum_line_count=501", "bad_maximum_line_count"],
      ["cursor=cursor_abc", "bad_cursor"],
      ["new_lines_cursor=logs_abc", "bad_cursor"],
      ["cursor=logs_x&new_lines_cursor=logs_new_y", "two_log_cursors"],
      ["since=2026-10-18T14:00:00Z", "unknown_field"],
    ]) {
      const { status, answer } = await api(`/games/boss-fight/logs?${query}`);
      expect([status, answer.error.code]).toEqual([400, code]);
    }
  });

  it("marks the game read, so its game servers write every 2 seconds, at most every 5 minutes", async () => {
    await api("/games/boss-fight/logs");
    const readAtMs = (await env.DB.prepare("SELECT logs_read_at_ms FROM games WHERE id = ?").bind(gameId).first<{ logs_read_at_ms: number }>())!.logs_read_at_ms;
    expect(Date.now() - readAtMs).toBeLessThan(5000);
    await env.DB.prepare("UPDATE games SET logs_read_at_ms = ? WHERE id = ?").bind(readAtMs - 60_000, gameId).run();
    await api("/games/boss-fight/logs");
    expect((await env.DB.prepare("SELECT logs_read_at_ms FROM games WHERE id = ?").bind(gameId).first<{ logs_read_at_ms: number }>())!.logs_read_at_ms).toBe(readAtMs - 60_000);
  });

  it("forgets days past the 30 kept", async () => {
    const nowMs = Date.now();
    await writeFile(nowMs - 31 * 86_400_000, "K7Q2MX", [{ text: "long ago" }]);
    await writeFile(nowMs - 1000, "K7Q2MX", [{ text: "today" }]);
    await deleteOldLogs(env as never, nowMs);
    expect((await env.GAMES.list({ prefix: logPrefix(gameId) })).objects).toHaveLength(1);
    expect((await env.DB.prepare("SELECT day FROM game_log_days WHERE game_id = ?").bind(gameId).all()).results).toEqual([{ day: logDay(nowMs - 1000) }]);
    expect(texts((await api("/games/boss-fight/logs")).answer)).toEqual(["today"]);
  });
});
