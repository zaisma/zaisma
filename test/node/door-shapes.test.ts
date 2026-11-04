import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DOOR_LIMIT_LEVELS,
  DOOR_NO_LIMIT_REASONS,
  FREE_HOSTING_CENTS_PER_MONTH,
  HOSTING_PRICES,
  MAXIMUM_GAME_LIMIT_SHARD_COUNT,
  bodyProblem,
  cutUndeclared,
  fieldsOf,
  formProblem,
  gameData,
  gameLimitShardCount,
  hasAutomationSigns,
  integer,
  isOnRentedShare,
  isPastDoorLimit,
  isReturningBrowser,
  listOf,
  orNothing,
  queryProblem,
  readPlayShare,
  rentedShareLimitCents,
  rentedShareOfRoomCents,
  rentedShareUsedCents,
  schemaProblems,
  sealPlayShare,
  signPlayMark,
  text,
  typeProblems,
  yesOrNo,
} from "@zaisma/core";
// @ts-expect-error: a plain JavaScript script without types
import { collectDoors } from "../../scripts/security-map/doors.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { loadSiteModule } from "../../scripts/security-map/load-site.mjs";

/** A door's shape, its answer cut to what it declares, its limit, and where a player plays from on the meter (docs/DOORS.md). */

const ROOT = join(import.meta.dirname, "../..");
const NOW_MS = Date.parse("2026-11-04T12:00:00Z");
const DAY_MS = 86_400_000;

describe("a shape", () => {
  const shape = fieldsOf({ name: text(5), level: integer(1, 3), isOn: yesOrNo, tags: listOf(text(2), 2), note: orNothing(text(3)), save: gameData(20) }, ["name"]);

  it("takes what fits", () => {
    expect(schemaProblems(shape, { name: "Ana", level: 2, isOn: true, tags: ["a"], note: null, save: { any: "thing" } })).toEqual([]);
  });

  it.each([
    [{ level: 2 }, "name: missing"],
    [{ name: "too long" }, "over 5 characters"],
    [{ name: 5 }, "is integer"],
    [{ name: "Ana", level: 9 }, "above 3"],
    [{ name: "Ana", level: 0 }, "below 1"],
    [{ name: "Ana", isOn: "yes" }, "is string"],
    [{ name: "Ana", tags: ["a", "b", "c"] }, "over 2 items"],
    [{ name: "Ana", tags: ["abc"] }, "over 2 characters"],
    [{ name: "Ana", other: 1 }, "not in the schema"],
    [{ name: "Ana", save: "x".repeat(30) }, "over 20 bytes"],
  ])("refuses %j", (given, problem) => {
    expect(schemaProblems(shape, given).join(" ")).toContain(problem);
  });

  it("holds a query's values as text its shape reads, and a page lets other names by", () => {
    const fields = { page: integer(1, 9), is_on: yesOrNo, search_text: text(3) };
    expect(queryProblem(fields, new URLSearchParams("page=2&is_on=true&search_text=abc"))).toBeNull();
    expect(queryProblem(fields, new URLSearchParams("page=many"))?.field).toBe("page");
    expect(queryProblem(fields, new URLSearchParams("page=20"))?.field).toBe("page");
    expect(queryProblem(fields, new URLSearchParams("search_text=abcd"))?.field).toBe("search_text");
    expect(queryProblem(fields, new URLSearchParams("fbclid=x"))?.field).toBe("fbclid");
    expect(queryProblem(fields, new URLSearchParams("fbclid=x"), true)).toBeNull();
  });

  it("closes a form's names, takes its files only where it says, and repeats only as a list", () => {
    const form = new FormData();
    form.set("title", "Hi");
    expect(formProblem({ title: text(5) }, [], form as never)).toBeNull();
    form.set("extra", "x");
    expect(formProblem({ title: text(5) }, [], form as never)?.field).toBe("extra");
    expect(formProblem({ title: text(5), extra: text(1) }, [], form as never)).toBeNull();
    const upload = new FormData();
    upload.set("file", new Blob(["x"]));
    expect(formProblem({ file: text(5) }, [], upload as never)?.field).toBe("file");
    expect(formProblem({}, ["file"], upload as never)).toBeNull();
  });

  it("needs what a body must have, and closes the rest", () => {
    expect(bodyProblem({ a: text(1) }, ["a"], {})?.problem).toContain("missing");
    expect(bodyProblem({ a: text(1) }, [], { b: 1 })?.field).toBe("b");
    expect(bodyProblem({ a: text(1) }, [], { a: "x" })).toBeNull();
  });

  it("can hold only types and closed names, leaving the rest to the call behind it", () => {
    const schema = { type: "object", properties: { kind: { enum: ["a", "b"] }, size: { type: "integer", maximum: 3 } }, additionalProperties: false };
    expect(typeProblems(schema, { kind: "c", size: 9 })).toEqual([]);
    expect(typeProblems(schema, { size: "many" })[0]).toContain("is string");
    expect(typeProblems(schema, { other: 1 })[0]).toContain("not in the schema");
  });
});

describe("an answer", () => {
  const schema = { anyOf: [{ type: "object", properties: { game: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, list: { type: "array", items: { type: "object", properties: { n: { type: "number" } }, additionalProperties: false } }, rows: { type: "object" } }, additionalProperties: false }, { type: "object", properties: { error: { type: "object" } }, required: ["error"], additionalProperties: false }] };

  it("goes out as the same value when it declares everything", () => {
    const given = { game: { id: "game_1" }, list: [{ n: 1 }], rows: { theirs: 1 } };
    const cut = cutUndeclared(schema, given);
    expect(cut.kept).toBe(given);
    expect(cut.cutPaths).toEqual([]);
  });

  it("loses only what it didn't declare, and still goes out", () => {
    const cut = cutUndeclared(schema, { game: { id: "game_1", email: "a@example.com" }, list: [{ n: 1, secret: 2 }, { n: 2, secret: 3 }], secret_key: "x" });
    expect(cut.kept).toEqual({ game: { id: "game_1" }, list: [{ n: 1 }, { n: 2 }] });
    expect(cut.cutPaths.sort()).toEqual(["answer.game.email", "answer.list[].secret", "answer.secret_key"]);
  });

  it("leaves what a game owns alone: only closed objects cut", () => {
    expect(cutUndeclared(schema, { rows: { any_column: 1 } }).cutPaths).toEqual([]);
  });
});

describe("a limit", () => {
  const counting = () => {
    const keys: string[] = [];
    return { keys, limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) };
  };

  it("counts a door on its own, or its group together", async () => {
    const binding = counting();
    expect(await isPastDoorLimit({ LIMIT_BUSY: binding }, { level: "busy", counts: "account" }, "/forum", "account_1")).toBe(true);
    expect(await isPastDoorLimit({ LIMIT_BUSY: binding }, { level: "busy", counts: "account", group: "api" }, "/forum", "account_1")).toBe(true);
    expect(binding.keys).toEqual(["/forum:account_1", "api:account_1"]);
  });

  it("lets everything by with no binding, on a developer's own server, and with a reason", async () => {
    expect(await isPastDoorLimit({}, { level: "busy", counts: "player" }, "/x", "player_1")).toBe(false);
    expect(await isPastDoorLimit({ LIMIT_BUSY: counting() }, { whyNoLimit: "cached_file" }, "/x", "player_1")).toBe(false);
  });

  it("grows a game's share by itself with its real players, up to what leaves room for every other game", () => {
    expect(gameLimitShardCount(0)).toBe(1);
    expect(gameLimitShardCount(24)).toBe(1);
    expect(gameLimitShardCount(25)).toBe(2);
    expect(gameLimitShardCount(100_000)).toBe(MAXIMUM_GAME_LIMIT_SHARD_COUNT);
  });
});

describe("every door", () => {
  let doors: { door_id: string; door_kind: string; contract: Record<string, any> | null }[];
  beforeAll(async () => {
    doors = await collectDoors(ROOT, await loadSiteModule(ROOT));
  }, 120_000);
  const withCallers = () => doors.filter((door) => door.door_kind !== "token_or_session" && door.door_kind !== "stored_value");

  it("states what it takes, what it answers and a limit or a reason from the list", () => {
    const missing = withCallers().filter(({ contract }) => !contract?.takes || !contract.answers || !contract.limit);
    expect(missing.map((door) => door.door_id)).toEqual([]);
    for (const { door_id, contract } of withCallers()) {
      const { limit } = contract!;
      if ("whyNoLimit" in limit) expect(Object.keys(DOOR_NO_LIMIT_REASONS), door_id).toContain(limit.whyNoLimit);
      else expect(Object.keys(DOOR_LIMIT_LEVELS), door_id).toContain(limit.level);
    }
  });

  it("counts an address only at the level a building clears", () => {
    for (const { door_id, contract } of withCallers()) if (contract!.limit.counts === "address") expect(contract!.limit.level, door_id).toBe("building");
  });

  it("answers JSON with a schema, and no door gives an empty one", () => {
    for (const { door_id, contract } of withCallers()) if (contract!.answers.kind === "json") expect(contract!.answers.schema, door_id).toBeTruthy();
  });

  it("has each level it uses bound in its Worker's wrangler, at its number", () => {
    const usedBy = (prefix: string) => new Set(withCallers().filter(({ door_id, door_kind }) => (prefix === "rooms" ? door_id.startsWith("rooms:") || door_kind === "room_message" : door_id.startsWith("page:") || door_kind === "api_call")).flatMap(({ contract }) => ("level" in contract!.limit ? [contract!.limit.level as keyof typeof DOOR_LIMIT_LEVELS] : [])));
    for (const worker of ["site", "rooms"]) {
      const wrangler = readFileSync(join(ROOT, `apps/${worker}/wrangler.jsonc`), "utf8");
      for (const level of usedBy(worker)) expect(wrangler, `${worker} ${level}`).toMatch(new RegExp(`"LIMIT_${level.toUpperCase()}"[^\\n]*"limit": ${DOOR_LIMIT_LEVELS[level]},`));
      expect(wrangler).toMatch(/"GAME_LIMIT", "namespace_id": "1187", "simple": \{ "limit": 600, "period": 60 \}/);
    }
  });
});

describe("the rented share", () => {
  const SECRET = "test-secret";

  it("is a tenth of the free time in force and of the budget", () => {
    expect(rentedShareLimitCents(FREE_HOSTING_CENTS_PER_MONTH, null)).toBe(100);
    expect(rentedShareLimitCents(FREE_HOSTING_CENTS_PER_MONTH * 2, 5000)).toBe(700);
  });

  it("takes in only the rented network without history, and anyone showing both signs together", () => {
    const honest = { hasGraphicsChip: true, isInputSeen: false };
    expect(isOnRentedShare(true, { isInRealShare: false }, honest)).toBe(true);
    expect(isOnRentedShare(true, { isInRealShare: true }, honest)).toBe(false);
    expect(isOnRentedShare(false, { isInRealShare: false }, honest)).toBe(false);
    // One sign alone doesn't count, on any network.
    expect(hasAutomationSigns({ hasGraphicsChip: false, isInputSeen: true })).toBe(false);
    expect(hasAutomationSigns({ hasGraphicsChip: true, isInputSeen: false })).toBe(false);
    expect(hasAutomationSigns({})).toBe(false);
    // Both, even off rented networks and with history.
    expect(isOnRentedShare(false, { isInRealShare: true }, { hasGraphicsChip: false, isInputSeen: false })).toBe(true);
  });

  it("gives a shared room's cost by player: their own messages and connections, their part of the rest", () => {
    const use = { roomAwakeDurationSec: 1000, objectRequestCount: 0, bookkeepingWrittenRowCount: 0, roomCpuDurationMs: 0, startupCpuDurationMs: 0, gameServerSessionCount: 0, logFileCount: 0 };
    const awakeCents = 1000 * HOSTING_PRICES.awakeCentsPerSec;
    expect(rentedShareOfRoomCents(use, { playShareNumber: 0, messageCount: 0, connectionCount: 0 })).toBe(0);
    expect(rentedShareOfRoomCents(use, { playShareNumber: 0.25, messageCount: 0, connectionCount: 0 })).toBeCloseTo(awakeCents / 4);
    expect(rentedShareOfRoomCents(use, { playShareNumber: 1, messageCount: 10, connectionCount: 2 })).toBeCloseTo(awakeCents + 10 * HOSTING_PRICES.inboundMessageCentsPerMessage + 2 * HOSTING_PRICES.roomConnectionCentsPerConnection);
  });

  it("counts requests and relayed data by its part, the database by its part of the play, and never a game's storage", () => {
    const kinds = { rooms: 100, game_server: 0, requests: 100, relayed_data: 40, database: 60, adult_chat_checks: 0 };
    const storedBytes = 30 / HOSTING_PRICES.storedCentsPerByteMonth;
    const used = rentedShareUsedCents(kinds, { monthStoredSizeBytes: storedBytes, requestCount: 100, scheduledRunCount: 0 }, { roomUseCents: 50, requestCount: 50, relayCredentialCount: 1, relayCredentialTotalCount: 4 });
    // Rooms 50, requests half of 100, the relay a quarter of 40, and half of the database's 30 past its storage.
    expect(used).toBeCloseTo(50 + 50 + 10 + 15);
    expect(rentedShareUsedCents(kinds, { monthStoredSizeBytes: storedBytes, requestCount: 100, scheduledRunCount: 0 }, { roomUseCents: 0, requestCount: 0, relayCredentialCount: 0, relayCredentialTotalCount: 4 })).toBe(0);
  });

  it("can't be claimed: a mark counts only as signed, for its game, and a mark from a rented network only after a week", async () => {
    const fromHome = await signPlayMark(SECRET, "game_1", "2026-11-04", true);
    expect(await isReturningBrowser(SECRET, "game_1", fromHome, NOW_MS)).toBe(true);
    expect(await isReturningBrowser(SECRET, "game_2", fromHome, NOW_MS)).toBe(false);
    expect(await isReturningBrowser("another-secret", "game_1", fromHome, NOW_MS)).toBe(false);
    expect(await isReturningBrowser(SECRET, "game_1", fromHome.replace("2026-11-04", "2026-01-01"), NOW_MS)).toBe(false);
    expect(await isReturningBrowser(SECRET, "game_1", "game_1.2026-01-01.1.nope", NOW_MS)).toBe(false);
    expect(await isReturningBrowser(SECRET, "game_1", null, NOW_MS)).toBe(false);
    const fromRented = await signPlayMark(SECRET, "game_1", "2026-11-04", false);
    expect(await isReturningBrowser(SECRET, "game_1", fromRented, NOW_MS)).toBe(false);
    expect(await isReturningBrowser(SECRET, "game_1", fromRented, NOW_MS + 7 * DAY_MS)).toBe(true);
    // A date still to come is no first play.
    expect(await isReturningBrowser(SECRET, "game_1", await signPlayMark(SECRET, "game_1", "2027-01-01", true), NOW_MS)).toBe(false);
  });

  it("says nothing to the game holding it, and opens only for its player, game and time", async () => {
    const nowSec = NOW_MS / 1000;
    const sealed = await sealPlayShare(SECRET, "player_1", "arena", { isInRealShare: true, isReturningPlayer: true }, nowSec + 60);
    expect(sealed).not.toContain("player_1");
    expect(await readPlayShare(SECRET, "player_1", "arena", sealed, nowSec)).toEqual({ isInRealShare: true, isReturningPlayer: true });
    const nothing = { isInRealShare: false, isReturningPlayer: false };
    expect(await readPlayShare(SECRET, "player_2", "arena", sealed, nowSec)).toEqual(nothing);
    expect(await readPlayShare(SECRET, "player_1", "other", sealed, nowSec)).toEqual(nothing);
    expect(await readPlayShare(SECRET, "player_1", "arena", sealed, nowSec + 61)).toEqual(nothing);
    expect(await readPlayShare(SECRET, "player_1", "arena", "forged.token", nowSec)).toEqual(nothing);
    expect(await readPlayShare(SECRET, "player_1", "arena", undefined, nowSec)).toEqual(nothing);
  });
});
