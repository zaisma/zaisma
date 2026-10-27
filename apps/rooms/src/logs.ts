import { LOG_LIMITS, logDay, logKey, logText, type LogSourceKind, type PrintedLogLine, type StoredLogLine } from "@zaisma/core";
import type { Env } from "./index.ts";

/**
 * Writes what a game server prints to its game's logs (docs/DEVELOPER-API.md, "A game server's logs"):
 * one per room, and one for the game's object (requests, schedules and webhooks). Lines wait here and go
 * to the game files bucket as one file per write: every 30 seconds while there are lines, every 2 seconds
 * while someone has read the game's logs in the last 10 minutes, at once when a file's worth is waiting,
 * and when its room or object asks (a room that empties or ends). Whoever owns it sets its alarm for
 * writeDelayMs() and calls write(); nothing here keeps a timer, so rooms still hibernate.
 */
export class LogWriter {
  private waiting: StoredLogLine[] = [];
  private waitingByteCount = 0;
  /** Today's bytes, for the daily limit; a restart starts the count again, which only ever lets more through. */
  private day = "";
  private dayByteCount = 0;
  private isOverDailyLimit = false;
  /** Days this writer has written game_log_days for. */
  private markedDays = new Set<string>();
  /** When someone last read the game's logs, as of watchCheckedAtMs. */
  private readAtMs = 0;
  private watchCheckedAtMs = 0;
  private writing: Promise<void> | null = null;
  /** Files written and rows written for them since the owner last took them (takeUse), for the hosting meter. */
  private unrecordedFileCount = 0;
  private unrecordedWrittenRowCount = 0;

  constructor(
    private readonly env: Env,
    private readonly gameId: string,
    /** A room's code, or "server" for the game's object. */
    private readonly writerName: string,
  ) {}

  /** Lines a call printed, with where it ran. */
  add(lines: PrintedLogLine[], sourceKind: LogSourceKind, roomCode: string | null, versionId: string): void {
    for (const line of lines) {
      const day = logDay(line.atMs);
      if (day !== this.day) {
        this.day = day;
        this.dayByteCount = 0;
        this.isOverDailyLimit = false;
      }
      if (this.isOverDailyLimit) continue;
      let stored: StoredLogLine = { atMs: line.atMs, level: line.level, text: logText(line.text), sourceKind, roomCode, versionId };
      const byteCount = stored.text.length + 100;
      if (this.dayByteCount + byteCount > LOG_LIMITS.dailyByteCountPerWriter) {
        this.isOverDailyLimit = true;
        const where = roomCode ? `room ${roomCode}` : "this game's server outside rooms";
        stored = { ...stored, level: "warn", text: `Zaisma: ${where} printed more than ${LOG_LIMITS.dailyByteCountPerWriter / 1024 / 1024} MB of logs today; its lines until midnight UTC aren't kept.` };
      }
      this.dayByteCount += byteCount;
      this.waiting.push(stored);
      this.waitingByteCount += byteCount;
    }
  }

  get hasWaitingLines(): boolean {
    return this.waiting.length > 0;
  }

  /** How long until the waiting lines should be written: null with nothing waiting, 0 when a file's worth is. */
  writeDelayMs(nowMs = Date.now()): number | null {
    if (!this.waiting.length) return null;
    if (this.waitingByteCount >= LOG_LIMITS.fileByteCount || this.waiting.length >= LOG_LIMITS.fileLineCount) return 0;
    return nowMs - this.readAtMs < LOG_LIMITS.watchedDurationMs ? LOG_LIMITS.watchedWriteDelayMs : LOG_LIMITS.writeDelayMs;
  }

  /** Write everything waiting, a file at a time. A write that fails keeps its lines for the next try, up to a day's limit. */
  write(): Promise<void> {
    // One write at a time: lines added meanwhile wait for the next.
    this.writing ??= this.writeWaiting().finally(() => (this.writing = null));
    return this.writing;
  }

  private async writeWaiting(): Promise<void> {
    while (this.waiting.length) {
      const file: StoredLogLine[] = [];
      let byteCount = 0;
      while (this.waiting.length && file.length < LOG_LIMITS.fileLineCount && (byteCount === 0 || byteCount + this.waiting[0]!.text.length + 100 <= LOG_LIMITS.fileByteCount)) {
        const line = this.waiting.shift()!;
        byteCount += line.text.length + 100;
        file.push(line);
      }
      this.waitingByteCount -= byteCount;
      const nowMs = Date.now();
      const levels = [...new Set(file.map((line) => line.level))].join(",");
      const sourceKinds = [...new Set(file.map((line) => line.sourceKind))].join(",");
      try {
        await this.env.GAMES.put(logKey(this.gameId, nowMs, this.writerName), file.map((line) => JSON.stringify(line)).join("\n"), {
          httpMetadata: { contentType: "application/x-ndjson" },
          customMetadata: { levels, sourceKinds, roomCode: file[0]!.roomCode ?? "" },
        });
        this.unrecordedFileCount++;
        await this.markDay(logDay(nowMs));
      } catch (error) {
        console.error("Couldn't write a game server's logs:", error);
        // Kept for the next write unless a lot is already waiting.
        if (this.waitingByteCount < LOG_LIMITS.fileByteCount * 4) {
          this.waiting.unshift(...file);
          this.waitingByteCount += byteCount;
        }
        return;
      }
    }
    await this.checkWatched();
  }

  /** The game has logs on this day, for the daily cleanup and get_logs. Once per writer per day. */
  private async markDay(day: string): Promise<void> {
    if (this.markedDays.has(day)) return;
    const marked = await this.env.DB.prepare("INSERT OR IGNORE INTO game_log_days (game_id, day) VALUES (?, ?)").bind(this.gameId, day).run();
    this.unrecordedWrittenRowCount += marked.meta?.rows_written ?? 0;
    this.markedDays.add(day);
  }

  /** The files and rows written since the last time, for the owner's use on the hosting meter. */
  takeUse(): { fileCount: number; writtenRowCount: number } {
    const use = { fileCount: this.unrecordedFileCount, writtenRowCount: this.unrecordedWrittenRowCount };
    this.unrecordedFileCount = this.unrecordedWrittenRowCount = 0;
    return use;
  }

  /** Whether someone read the game's logs lately, read at most every 30 seconds: when a writer starts, and after writes. */
  async checkWatched(): Promise<void> {
    const nowMs = Date.now();
    if (nowMs - this.watchCheckedAtMs < LOG_LIMITS.writeDelayMs) return;
    this.watchCheckedAtMs = nowMs;
    try {
      const game = await this.env.DB.prepare("SELECT logs_read_at_ms FROM games WHERE id = ?").bind(this.gameId).first<{ logs_read_at_ms: number | null }>();
      this.readAtMs = game?.logs_read_at_ms ?? 0;
    } catch (error) {
      console.error("Couldn't read whether a game's logs are being read:", error);
    }
  }
}
