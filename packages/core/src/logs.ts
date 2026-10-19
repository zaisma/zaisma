// A game server's logs (docs/DEVELOPER-API.md, "A game server's logs"): every line it prints on Zaisma,
// kept 30 days in the game files bucket under logs/<game_id>/, one file per write. The rooms Worker writes
// them (apps/rooms/src/logs.ts) and the developer API reads them (apps/site/src/logs-api.ts). The games
// Worker serves only files a version's manifest names, so nothing under logs/ is ever reachable from a game.

/** The console methods a game server prints with, from least to most urgent. */
export const LOG_LEVELS = ["debug", "log", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** What get_logs' minimum_level takes: info covers log and info, as browsers' consoles show them. */
export const MINIMUM_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type MinimumLogLevel = (typeof MINIMUM_LOG_LEVELS)[number];

/** Where a line was printed: in a room, or outside rooms in onRequest, onSchedule or onWebhook. */
export const LOG_SOURCE_KINDS = ["room", "request", "schedule", "webhook"] as const;
export type LogSourceKind = (typeof LOG_SOURCE_KINDS)[number];

export const LOG_LIMITS = {
  /** A longer line is cut here, ending in "…". */
  lineCharacterCount: 4000,
  /** Lines one call into the sandbox hands back; past it, one line says how many more were dropped. */
  callLineCount: 1000,
  /** What a room, or the game's object, keeps in a UTC day; past it, one line says so and the rest wait for the next day. */
  dailyByteCountPerWriter: 20 * 1024 * 1024,
  /** Written at once when this much is waiting, and at most this much in one file. */
  fileByteCount: 256 * 1024,
  /** At most this many lines in one file, so any one file fits in an answer. */
  fileLineCount: 500,
  /** How often a writer writes while it has lines, and while someone has read the logs lately. */
  writeDelayMs: 30_000,
  watchedWriteDelayMs: 2_000,
  /** After get_logs, the game's writers write every 2 seconds for this long. */
  watchedDurationMs: 10 * 60_000,
  /** get_logs marks the game read only when its mark is older than this, so following doesn't write every call. */
  readMarkDelayMs: 5 * 60_000,
  keptDayCount: 30,
  defaultLineCount: 100,
  maximumLineCount: 500,
  /** Files one get_logs call reads before it stops and answers next_cursor. */
  readFileCountPerCall: 50,
} as const;

/** One line as the rooms Worker stores it, one JSON object per line of a file. */
export interface StoredLogLine {
  atMs: number;
  level: LogLevel;
  text: string;
  sourceKind: LogSourceKind;
  roomCode: string | null;
  versionId: string;
}

/** A line as the sandbox hands it back, before the room knows where it ran. */
export interface PrintedLogLine {
  atMs: number;
  level: LogLevel;
  text: string;
}

/** The UTC day of a time, as YYYY-MM-DD. */
export const logDay = (atMs: number): string => new Date(atMs).toISOString().slice(0, 10);

const LARGEST_DAY_NUMBER = 99_999_999;
const LARGEST_TIME_MS = 9_999_999_999_999;

/** Every log file of a game starts with this. */
export const logPrefix = (gameId: string): string => `logs/${gameId}/`;

/** A game's files of one day: days count down in keys, so a plain list starts with the newest. */
export const logDayPrefix = (gameId: string, day: string): string => `${logPrefix(gameId)}${String(LARGEST_DAY_NUMBER - Number(day.replaceAll("-", ""))).padStart(8, "0")}/`;

/**
 * A file's key: its day, then the time it was written counting down (so newest first), who wrote it (a
 * room's code, or "server" for the game's object) and a few random letters so two writes never collide.
 */
export function logKey(gameId: string, writtenAtMs: number, writerName: string): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${logDayPrefix(gameId, logDay(writtenAtMs))}${String(LARGEST_TIME_MS - writtenAtMs).padStart(13, "0")}-${writerName}-${random}.ndjson`;
}

/** A line cut to the limit. */
export const logText = (text: string): string => (text.length > LOG_LIMITS.lineCharacterCount ? `${text.slice(0, LOG_LIMITS.lineCharacterCount - 1)}…` : text);

/**
 * The lines a sandbox handed back, which the room checks like anything from a game: a list of
 * { atMs, level, text }, at most callLineCount (plus the line about the rest), each cut to the limit.
 */
export function readPrintedLines(given: unknown, nowMs = Date.now()): PrintedLogLine[] {
  if (!Array.isArray(given)) return [];
  const lines: PrintedLogLine[] = [];
  for (const line of given.slice(0, LOG_LIMITS.callLineCount + 1)) {
    if (!line || typeof line !== "object") continue;
    const { atMs, level, text } = line as Record<string, unknown>;
    if (typeof text !== "string" || !(LOG_LEVELS as readonly unknown[]).includes(level)) continue;
    // A time from the sandbox within the last day, else now: its clock is Cloudflare's, but it's still the game's code.
    const printedAtMs = typeof atMs === "number" && Number.isFinite(atMs) && atMs <= nowMs && atMs > nowMs - 86_400_000 ? Math.floor(atMs) : nowMs;
    lines.push({ atMs: printedAtMs, level: level as LogLevel, text: logText(text) });
  }
  return lines;
}

/** Whether a line passes get_logs' minimum_level. */
export function meetsMinimumLevel(level: LogLevel, minimum: MinimumLogLevel): boolean {
  const rank = (given: string) => (given === "debug" ? 0 : given === "log" || given === "info" ? 1 : given === "warn" ? 2 : 3);
  return rank(level) >= rank(minimum);
}
