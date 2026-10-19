import { ApiError, LOG_LIMITS, LOG_SOURCE_KINDS, MINIMUM_LOG_LEVELS, iso, logDay, logDayPrefix, meetsMinimumLevel, type Game, type LogSourceKind, type MinimumLogLevel, type StoredLogLine } from "@zaisma/core";
import { isRoomCode } from "@zaisma/game-server";
import type { CheckedCall } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * A game server's logs through the developer API (docs/DEVELOPER-API.md, "A game server's logs"): every
 * line it printed on Zaisma in the last 30 days, which the rooms Worker writes to the game files bucket
 * (apps/rooms/src/logs.ts), one file per write, newest first by key.
 *
 *   GET /api/dev/games/:slug/logs   ?room_code ?minimum_level ?source_kind ?search_text ?maximum_line_count ?cursor | ?new_lines_cursor
 *
 * Without a cursor it answers the newest lines; next_cursor goes further back, and new_lines_cursor
 * answers only lines written since. Lines are oldest first within an answer. Following goes by the order
 * files were written, not by the time on a line, since a room writes up to 30 seconds late.
 */

/** Where an answer stopped: a file of a day, and how far into its lines (unfiltered, oldest first). */
interface Position {
  day: string;
  key: string;
  lineIndex: number;
}


const logLineJson = (line: StoredLogLine) => ({ logged_at: iso(line.atMs), level: line.level, text: line.text, source_kind: line.sourceKind, room_code: line.roomCode, version_id: line.versionId });

function cursorFor(position: Position, kind: "cursor" | "new_lines_cursor"): string {
  return `${kind === "cursor" ? "logs_" : "logs_new_"}${btoa(JSON.stringify([position.day, position.key.slice(position.key.lastIndexOf("/") + 1), position.lineIndex])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

function readPosition(gameId: string, given: string, field: "cursor" | "new_lines_cursor"): Position {
  const bad = () =>
    new ApiError("bad_cursor", {
      message: `${field} ${JSON.stringify(given.slice(0, 40))} isn't a ${field === "cursor" ? "next_cursor" : "new_lines_cursor"} get_logs gave.`,
      field,
      fix: `Pass the ${field === "cursor" ? "next_cursor" : "new_lines_cursor"} from your last get_logs answer as it came, or leave ${field} out for the newest lines.`,
    });
  const prefix = field === "cursor" ? "logs_" : "logs_new_";
  if (!given.startsWith(prefix) || (field === "cursor" && given.startsWith("logs_new_"))) throw bad();
  try {
    const [day, name, lineIndex] = JSON.parse(atob(given.slice(prefix.length).replaceAll("-", "+").replaceAll("_", "/"))) as unknown[];
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof name !== "string" || !/^[\w-]*(\.ndjson)?$/.test(name) || typeof lineIndex !== "number" || !Number.isInteger(lineIndex) || lineIndex < 0) throw bad();
    return { day, key: name ? `${logDayPrefix(gameId, day)}${name}` : "", lineIndex };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw bad();
  }
}

interface Filters {
  roomCode: string | null;
  minimumLevel: MinimumLogLevel;
  sourceKind: LogSourceKind | null;
  searchText: string | null;
}

/** The call's inputs, closed: each one checked, with what to send instead. */
function readInputs(query: URLSearchParams): Filters & { maximumLineCount: number; cursor: string | null; newLinesCursor: string | null } {
  const roomCode = query.get("room_code");
  if (roomCode !== null && !isRoomCode(roomCode)) throw new ApiError("bad_room_code", { message: `room_code ${JSON.stringify(roomCode.slice(0, 20))} isn't a room code.`, field: "room_code", fix: "Give a room's code as players see it, like K7Q2MX, or leave room_code out for every room." });
  const minimumLevel = query.get("minimum_level") ?? "debug";
  if (!(MINIMUM_LOG_LEVELS as readonly string[]).includes(minimumLevel)) throw new ApiError("bad_minimum_level", { message: `minimum_level ${JSON.stringify(minimumLevel.slice(0, 20))} isn't one of ${MINIMUM_LOG_LEVELS.join(", ")}.`, field: "minimum_level", fix: 'Give "warn" for warnings and errors, "error" for errors only, "info" for everything but console.debug.' });
  const sourceKind = query.get("source_kind");
  if (sourceKind !== null && !(LOG_SOURCE_KINDS as readonly string[]).includes(sourceKind)) throw new ApiError("bad_source_kind", { message: `source_kind ${JSON.stringify(sourceKind.slice(0, 20))} isn't one of ${LOG_SOURCE_KINDS.join(", ")}.`, field: "source_kind", fix: "Give room, request (onRequest), schedule (onSchedule) or webhook (onWebhook), or leave it out for all of them." });
  const searchText = query.get("search_text");
  if (searchText !== null && (searchText.length < 1 || searchText.length > 200)) throw new ApiError("bad_search_text", { message: "search_text is empty or over 200 characters.", field: "search_text", fix: "Give a few words or the error you're looking for, like \"hp of undefined\"." });
  const given = query.get("maximum_line_count");
  const maximumLineCount = given === null ? LOG_LIMITS.defaultLineCount : Number(given);
  if (!Number.isInteger(maximumLineCount) || maximumLineCount < 1 || maximumLineCount > LOG_LIMITS.maximumLineCount) throw new ApiError("bad_maximum_line_count", { message: `maximum_line_count isn't a whole number from 1 to ${LOG_LIMITS.maximumLineCount}.`, field: "maximum_line_count", fix: `Give up to ${LOG_LIMITS.maximumLineCount}; next_cursor gives the lines before those.` });
  const cursor = query.get("cursor");
  const newLinesCursor = query.get("new_lines_cursor");
  if (cursor !== null && newLinesCursor !== null) throw new ApiError("two_log_cursors", { message: "get_logs got both cursor and new_lines_cursor.", field: "new_lines_cursor", fix: "Pass cursor (a next_cursor) for older lines, or new_lines_cursor for lines written since, not both." });
  return { roomCode, minimumLevel: minimumLevel as MinimumLogLevel, sourceKind: sourceKind as LogSourceKind | null, searchText: searchText?.toLowerCase() ?? null, maximumLineCount, cursor, newLinesCursor };
}

/** Whether a file can hold lines that pass, from what its key and metadata say, so most never need reading. */
function mightMatch(object: R2Object, filters: Filters): boolean {
  const metadata = object.customMetadata ?? {};
  if (filters.roomCode !== null && metadata.roomCode !== filters.roomCode) return false;
  if (filters.sourceKind !== null && metadata.sourceKinds !== undefined && !metadata.sourceKinds.split(",").includes(filters.sourceKind)) return false;
  if (metadata.levels !== undefined && !metadata.levels.split(",").some((level) => meetsMinimumLevel(level as StoredLogLine["level"], filters.minimumLevel))) return false;
  return true;
}

const passes = (line: StoredLogLine, filters: Filters) =>
  (filters.roomCode === null || line.roomCode === filters.roomCode) &&
  (filters.sourceKind === null || line.sourceKind === filters.sourceKind) &&
  meetsMinimumLevel(line.level, filters.minimumLevel) &&
  (filters.searchText === null || line.text.toLowerCase().includes(filters.searchText));

async function linesIn(env: Env, key: string): Promise<StoredLogLine[]> {
  const object = await env.GAMES.get(key);
  if (!object) return [];
  const lines: StoredLogLine[] = [];
  for (const text of (await object.text()).split("\n")) {
    try {
      lines.push(JSON.parse(text) as StoredLogLine);
    } catch {
      // A line we didn't write whole: skipped.
    }
  }
  return lines;
}

/** One day's files, newest first: all of them, or only those newer than a key (a key that sorts before it). */
async function filesOf(env: Env, gameId: string, day: string, { startAfter, newerThan }: { startAfter?: string; newerThan?: string } = {}): Promise<R2Object[]> {
  const files: R2Object[] = [];
  let cursor: string | undefined;
  // A day has at most a few thousand files from one game, and a follow reads only the top of one.
  for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
    const listed = await env.GAMES.list({ prefix: logDayPrefix(gameId, day), include: ["customMetadata"], limit: 1000, ...(startAfter ? { startAfter } : {}), ...(cursor ? { cursor } : {}) });
    for (const object of listed.objects) {
      if (newerThan !== undefined && object.key >= newerThan) return files;
      files.push(object);
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return files;
}

/** The game's days with logs, newest first, within the 30 days kept. */
async function daysOf(env: Env, gameId: string): Promise<string[]> {
  const firstDay = logDay(Date.now() - LOG_LIMITS.keptDayCount * 86_400_000);
  const { results } = await env.DB.prepare("SELECT day FROM game_log_days WHERE game_id = ? AND day >= ? ORDER BY day DESC").bind(gameId, firstDay).all<{ day: string }>();
  return results.map((row) => row.day);
}

/**
 * GET /games/:slug/logs, once the router has checked the key (stats read) and the game. Positions: for
 * next_cursor, lines before lineIndex in its file are still to come, then the files after it (older);
 * for new_lines_cursor, its file's first lineIndex lines were answered already.
 */
export async function logsFor(env: Env, game: Game, checked: CheckedCall) {
  const inputs = readInputs(checked.query);
  await markRead(env, game);
  const days = await daysOf(env, game.id);
  if (inputs.newLinesCursor !== null) return newLines(env, game, days, inputs, readPosition(game.id, inputs.newLinesCursor, "new_lines_cursor"));

  const from = inputs.cursor !== null ? readPosition(game.id, inputs.cursor, "cursor") : null;
  // Collected newest first, turned round at the end.
  const collected: StoredLogLine[] = [];
  let newest: Position | null = null;
  let lastRead: Position | null = null;
  let nextPosition: Position | null = null;
  let readFileCount = 0;
  outer: for (const day of days) {
    if (from && day > from.day) continue;
    const resumeKey = from && day === from.day && from.key ? from.key : undefined;
    const files: { key: string; object: R2Object | null }[] = (await filesOf(env, game.id, day, resumeKey ? { startAfter: resumeKey } : {})).map((object) => ({ key: object.key, object }));
    // The file the last answer stopped partway through comes first again, for its older lines.
    if (resumeKey && from!.lineIndex > 0) files.unshift({ key: resumeKey, object: null });
    for (const { key, object } of files) {
      newest ??= from ? null : { day, key, lineIndex: LOG_LIMITS.fileLineCount };
      if (object && !mightMatch(object, inputs)) continue;
      if (readFileCount >= LOG_LIMITS.readFileCountPerCall) {
        // Read enough files for one call: the next one starts after the last file read.
        nextPosition = lastRead;
        break outer;
      }
      readFileCount++;
      const lines = await linesIn(env, key);
      const endIndex = object === null ? Math.min(from!.lineIndex, lines.length) : lines.length;
      for (let index = endIndex - 1; index >= 0; index--) {
        if (!passes(lines[index]!, inputs)) continue;
        collected.push(lines[index]!);
        if (collected.length >= inputs.maximumLineCount) {
          nextPosition = { day, key, lineIndex: index };
          break outer;
        }
      }
      lastRead = { day, key, lineIndex: 0 };
    }
  }
  return {
    log_lines: collected.reverse().map(logLineJson),
    next_cursor: nextPosition ? cursorFor(nextPosition, "cursor") : null,
    // Following starts from the newest file there is; an older page has none to give.
    new_lines_cursor: from ? null : cursorFor(newest ?? { day: logDay(Date.now()), key: "", lineIndex: 0 }, "new_lines_cursor"),
  };
}

/** Lines written since a new_lines_cursor, oldest first, up to the call's maximum. */
async function newLines(env: Env, game: Game, days: string[], inputs: ReturnType<typeof readInputs>, seenThrough: Position) {
  // Files newer than the cursor's, oldest first: newer days whole, the cursor's day down to its file.
  const newer: { day: string; key: string }[] = [];
  for (const day of days) {
    if (day < seenThrough.day) break;
    const files = await filesOf(env, game.id, day, day === seenThrough.day && seenThrough.key ? { newerThan: seenThrough.key } : {});
    newer.push(...files.map((file) => ({ day, key: file.key })));
  }
  newer.reverse();
  // The cursor's own file first, when the last answer stopped partway through it.
  const queue: { day: string; key: string; startIndex: number }[] = [];
  if (seenThrough.key) queue.push({ day: seenThrough.day, key: seenThrough.key, startIndex: seenThrough.lineIndex });
  queue.push(...newer.map((file) => ({ ...file, startIndex: 0 })));

  const collected: StoredLogLine[] = [];
  let reached: Position = seenThrough;
  let readFileCount = 0;
  for (const file of queue) {
    if (readFileCount >= LOG_LIMITS.readFileCountPerCall) break;
    const lines = await linesIn(env, file.key);
    if (file.startIndex >= lines.length) {
      reached = { day: file.day, key: file.key, lineIndex: lines.length };
      continue;
    }
    readFileCount++;
    let index = file.startIndex;
    for (; index < lines.length; index++) {
      if (collected.length >= inputs.maximumLineCount) break;
      if (passes(lines[index]!, inputs)) collected.push(lines[index]!);
    }
    reached = { day: file.day, key: file.key, lineIndex: index };
    if (collected.length >= inputs.maximumLineCount) break;
  }
  return { log_lines: collected.map(logLineJson), next_cursor: null, new_lines_cursor: cursorFor(reached, "new_lines_cursor") };
}

/** Someone is reading the logs: the game's servers write every 2 seconds for the next 10 minutes. Written at most every 5 minutes. */
async function markRead(env: Env, game: Game): Promise<void> {
  const nowMs = Date.now();
  await env.DB.prepare("UPDATE games SET logs_read_at_ms = ? WHERE id = ? AND (logs_read_at_ms IS NULL OR logs_read_at_ms < ?)").bind(nowMs, game.id, nowMs - LOG_LIMITS.readMarkDelayMs).run();
}

/** Every log file of a game, for deleting the game (game-deletion.ts) and the daily cleanup's old days. */
export async function deleteLogDays(env: Env, gameId: string, days: string[]): Promise<void> {
  for (const day of days) {
    for (;;) {
      const listed = await env.GAMES.list({ prefix: logDayPrefix(gameId, day), limit: 1000 });
      if (listed.objects.length) await env.GAMES.delete(listed.objects.map((object) => object.key));
      if (!listed.truncated) break;
    }
    await env.DB.prepare("DELETE FROM game_log_days WHERE game_id = ? AND day = ?").bind(gameId, day).run();
  }
}

/** The daily cleanup: days past the 30 kept, for every game. */
export async function deleteOldLogs(env: Env, nowMs = Date.now()): Promise<void> {
  const firstDay = logDay(nowMs - LOG_LIMITS.keptDayCount * 86_400_000);
  const { results } = await env.DB.prepare("SELECT game_id, day FROM game_log_days WHERE day < ? LIMIT 500").bind(firstDay).all<{ game_id: string; day: string }>();
  for (const row of results) await deleteLogDays(env, row.game_id, [row.day]);
}
