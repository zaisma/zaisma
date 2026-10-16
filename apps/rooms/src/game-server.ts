import { DurableObject } from "cloudflare:workers";
import { GAME_SERVER_OPTIONS, REQUEST_LIMITS, readRequestAnswer, type Player, type RequestErrorCode } from "@zaisma/game-server";
import { FREE_REQUEST_COUNT_PER_MONTH, nextMonthStartDate, usageMonth } from "@zaisma/core";
import { errorLine, sandboxOpener, type Session } from "./sandbox.ts";
import type { Env } from "./index.ts";

/** What a request gets: onRequest's answer, or why not. */
export type RequestOutcome = { answer: unknown } | { code: RequestErrorCode; message?: string };

/** Requests counted this month (UTC), for the free requests. */
interface RequestUse {
  month: string;
  requestCount: number;
}

/** Use and errors not yet in the stats (room_usage and game_server_errors), by date. */
interface Unrecorded {
  date: string;
  requestCount: number;
  crashCount: number;
  stoppedCount: number;
  errors: { versionId: string; kind: "crash" | "stopped"; message: string; occurrenceCount: number; firstAtMs: number }[];
}

/** Stats are written about once a minute while requests come in, not once per request. */
const RECORD_DELAY_MS = 60_000;
/** The month's count is also saved after this many requests, so a busy game loses little if it restarts. */
const SAVE_REQUEST_COUNT = 500;
/** Distinct errors kept until they're recorded. */
const MAXIMUM_ERROR_COUNT = 5;
/** A game server stopped this often (run on too long) within PAUSE_WINDOW_MS answers no requests until it's been quiet. */
const PAUSE_STOPPED_COUNT = 3;
const PAUSE_WINDOW_MS = 10 * 60_000;
/** A game server that didn't start is tried again after this. */
const RETRY_START_MS = 60_000;

class TimedOut extends Error {}

/**
 * A game's own game server outside its rooms: one object per game, named by its ID, that answers the
 * game's requests (onRequest) with its live version's code, in the same sandbox its rooms use, with the
 * same database (database.ts). It keeps one session with the sandbox while it's awake, so a request costs
 * one call into it, and counts the month's requests against the free ones (FREE_REQUEST_COUNT_PER_MONTH).
 * The rooms Worker checks the player's pass before it asks; nothing here trusts the request.
 */
export class GameServerObject extends DurableObject<Env> {
  private requestUse: RequestUse;
  private unrecorded: Unrecorded | null;
  private unsavedRequestCount = 0;
  private gameId: string | null;
  private isRecordingSoon = false;
  private stoppedAtMs: number[] = [];
  /** The open session, for one version: or why that version can't answer, and when a server that didn't start is tried again. */
  private server: { versionId: string; ready: Promise<{ session: Session } | { outcome: RequestOutcome; retryAtMs?: number }> } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.requestUse = ctx.storage.kv.get<RequestUse>("request_use") ?? { month: usageMonth(), requestCount: 0 };
    this.unrecorded = ctx.storage.kv.get<Unrecorded>("unrecorded") ?? null;
    this.gameId = ctx.storage.kv.get<string>("game_id") ?? null;
  }

  async request(gameId: string, versionId: string, player: Player, request: unknown): Promise<RequestOutcome> {
    if (this.gameId !== gameId) {
      this.gameId = gameId;
      this.ctx.storage.kv.put("game_id", gameId);
    }
    this.newMonth();
    if (this.requestUse.requestCount >= FREE_REQUEST_COUNT_PER_MONTH) {
      return { code: "request_limit", message: `This game has used its free ${FREE_REQUEST_COUNT_PER_MONTH.toLocaleString("en-US")} requests this month. They work again on ${nextMonthStartDate()} (UTC).` };
    }
    const nowMs = Date.now();
    this.stoppedAtMs = this.stoppedAtMs.filter((stoppedAtMs) => nowMs - stoppedAtMs < PAUSE_WINDOW_MS);
    if (this.stoppedAtMs.length >= PAUSE_STOPPED_COUNT) return { code: "game_server_error", message: "The game's server is paused for a few minutes: it kept running on too long." };

    if (this.server?.versionId !== versionId) this.server = { versionId, ready: this.open(gameId, versionId) };
    let ready = await this.server.ready;
    if ("outcome" in ready && ready.retryAtMs !== undefined && Date.now() >= ready.retryAtMs) {
      this.server = { versionId, ready: this.open(gameId, versionId) };
      ready = await this.server.ready;
    }
    if ("outcome" in ready) return ready.outcome;

    this.countRequest();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reply: { answer?: unknown; error?: string };
    try {
      reply = await Promise.race([
        ready.session.request(player, request),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TimedOut()), REQUEST_LIMITS.answerTimeoutSec * 1000);
        }),
      ]);
    } catch (error) {
      if (error instanceof TimedOut) {
        this.note(versionId, "crash", `onRequest didn't answer within ${REQUEST_LIMITS.answerTimeoutSec} seconds, so the request failed. Something it awaits never finished.`);
        return { code: "game_server_error" };
      }
      // The sandbox itself failed (over its CPU limit, or restarted): the next request gets a fresh session.
      this.stoppedAtMs.push(Date.now());
      this.note(versionId, "stopped", /CPU time/i.test(String(error)) ? "onRequest ran on too long and was stopped, like a loop that never ends" : `The game server stopped: ${String(error)}`);
      if (this.server?.versionId === versionId) this.server = null;
      return { code: "game_server_error" };
    } finally {
      clearTimeout(timer);
    }
    if (reply.error !== undefined) {
      this.note(versionId, "crash", errorLine(String(reply.error)));
      return { code: "game_server_error" };
    }
    const read = readRequestAnswer(reply.answer);
    if ("mistake" in read) {
      this.note(versionId, "crash", read.mistake);
      return { code: "game_server_error" };
    }
    return read;
  }

  /** Open a session with the version's game server, or say why it can't answer requests. */
  private async open(gameId: string, versionId: string): Promise<{ session: Session } | { outcome: RequestOutcome; retryAtMs?: number }> {
    const noHandler = { outcome: { code: "no_request_handler", message: "This game's server doesn't take requests: its live version has no onRequest." } as const };
    try {
      const open = await sandboxOpener(this.env, this.ctx.exports, gameId, versionId);
      if (open === null) return noHandler;
      const session = await open();
      const settings = await session.settings();
      const optionNames = Array.isArray(settings.optionNames) ? settings.optionNames.map(String) : [];
      const unknown = optionNames.find((name) => !(GAME_SERVER_OPTIONS as readonly string[]).includes(name));
      if (unknown) throw new Error(`${unknown} isn't a game server option. A game server takes: ${GAME_SERVER_OPTIONS.join(", ")}.`);
      const handlerNames = Array.isArray(settings.handlerNames) ? settings.handlerNames.map(String) : [];
      return handlerNames.includes("onRequest") ? { session } : noHandler;
    } catch (error) {
      console.error("Couldn't start the game server for requests:", error);
      this.note(versionId, "crash", `Didn't start: ${errorLine(String(error instanceof Error ? error.message : error))}`);
      // Tried again a minute later, in case it was the sandbox and not the code; meanwhile requests fail at once.
      return { outcome: { code: "game_server_error" }, retryAtMs: Date.now() + RETRY_START_MS };
    }
  }

  /** One more request this month, and in today's stats. */
  private countRequest(): void {
    this.requestUse.requestCount++;
    this.today().requestCount++;
    // A restart can lose the last minute's counts; that's a little free use, never a wrong limit.
    if (++this.unsavedRequestCount >= SAVE_REQUEST_COUNT) this.save();
    this.recordSoon();
  }

  /** An error for the developer's stats, once per distinct message. */
  private note(versionId: string, kind: "crash" | "stopped", message: string): void {
    const today = this.today();
    if (kind === "crash") today.crashCount++;
    else today.stoppedCount++;
    const trimmed = message.slice(0, 300);
    const seen = today.errors.find((error) => error.versionId === versionId && error.kind === kind && error.message === trimmed);
    if (seen) seen.occurrenceCount++;
    else if (today.errors.length < MAXIMUM_ERROR_COUNT) today.errors.push({ versionId, kind, message: trimmed, occurrenceCount: 1, firstAtMs: Date.now() });
    this.recordSoon();
  }

  private today(): Unrecorded {
    const date = new Date().toISOString().slice(0, 10);
    // Use from an earlier day goes out first, under its own date.
    if (this.unrecorded && this.unrecorded.date !== date) void this.record();
    return (this.unrecorded ??= { date, requestCount: 0, crashCount: 0, stoppedCount: 0, errors: [] });
  }

  private recordSoon(): void {
    if (this.isRecordingSoon) return;
    this.isRecordingSoon = true;
    void this.ctx.storage.setAlarm(Date.now() + RECORD_DELAY_MS);
  }

  async alarm(): Promise<void> {
    this.isRecordingSoon = false;
    this.save();
    await this.record();
  }

  /** Add the unrecorded use and errors to the game's stats, which the developer API reads. */
  private async record(): Promise<void> {
    const unrecorded = this.unrecorded;
    if (!unrecorded || !this.gameId) return;
    this.unrecorded = null;
    this.save();
    const nowMs = Date.now();
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT INTO room_usage (game_id, date, game_server_request_count, game_server_crash_count, game_server_stopped_count) VALUES (?, ?, ?, ?, ?) ON CONFLICT(game_id, date) DO UPDATE SET game_server_request_count = game_server_request_count + excluded.game_server_request_count, game_server_crash_count = game_server_crash_count + excluded.game_server_crash_count, game_server_stopped_count = game_server_stopped_count + excluded.game_server_stopped_count",
        ).bind(this.gameId, unrecorded.date, unrecorded.requestCount, unrecorded.crashCount, unrecorded.stoppedCount),
        ...unrecorded.errors.map((error) =>
          this.env.DB.prepare(
            "INSERT INTO game_server_errors (game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, version_id, kind, message) DO UPDATE SET occurrence_count = occurrence_count + excluded.occurrence_count, last_at_ms = excluded.last_at_ms",
          ).bind(this.gameId, error.versionId, error.kind, error.message, error.occurrenceCount, error.firstAtMs, nowMs),
        ),
      ]);
    } catch (error) {
      console.error("Couldn't record the game server's requests:", error);
    }
  }

  /** A new month starts from nothing. */
  private newMonth(): void {
    const month = usageMonth();
    if (this.requestUse.month === month) return;
    this.requestUse = { month, requestCount: 0 };
    this.save();
  }

  private save(): void {
    this.ctx.storage.kv.put("request_use", this.requestUse);
    if (this.unrecorded) this.ctx.storage.kv.put("unrecorded", this.unrecorded);
    else this.ctx.storage.kv.delete("unrecorded");
    this.unsavedRequestCount = 0;
  }
}
