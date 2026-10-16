import { DurableObject } from "cloudflare:workers";
import { GAME_SERVER_OPTIONS, REQUEST_LIMITS, SCHEDULE_LIMITS, checkSchedules, nextRunAtMs, readRequestAnswer, type Player, type RequestErrorCode, type Schedule } from "@zaisma/game-server";
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
  scheduledRunCount: number;
  crashCount: number;
  stoppedCount: number;
  errors: { versionId: string; kind: "crash" | "stopped"; message: string; occurrenceCount: number; firstAtMs: number }[];
}

/** The live version's schedules, with when each runs next and last ran. */
interface Schedules {
  versionId: string;
  schedules: (Schedule & { nextRunAtMs: number; lastRunAtMs: number | null })[];
}

/** An open session with a version's game server, what it has, or why it can't run and when it's tried again. */
type Opened = { session: Session; handlerNames: string[]; schedules: Schedule[] } | { outcome: RequestOutcome; retryAtMs?: number };

/** Stats are written about once a minute while requests come in, not once per request. */
const RECORD_DELAY_MS = 60_000;
/** A schedule's alarm this close before the record is due records too. */
const RECORD_SLACK_MS = 30_000;
/** The month's count is also saved after this many requests, so a busy game loses little if it restarts. */
const SAVE_REQUEST_COUNT = 500;
/** Distinct errors kept until they're recorded. */
const MAXIMUM_ERROR_COUNT = 5;
/** A game server stopped this often (run on too long) within PAUSE_WINDOW_MS answers no requests and runs no schedules until it's been quiet. */
const PAUSE_STOPPED_COUNT = 3;
const PAUSE_WINDOW_MS = 10 * 60_000;
/** A game server that didn't start is tried again after this for requests, and after SCHEDULE_RETRY_MS for its schedules. */
const RETRY_START_MS = 60_000;
const SCHEDULE_RETRY_MS = 15 * 60_000;

class TimedOut extends Error {}

/**
 * A game's own game server outside its rooms: one object per game, named by its ID, that answers the
 * game's requests (onRequest) and runs its schedules (onSchedule) with its live version's code, in the
 * same sandbox its rooms use, with the same database (database.ts). It keeps one session with the
 * sandbox while it's awake, so a request or a run costs one call into it, and counts the month's
 * requests against the free ones (FREE_REQUEST_COUNT_PER_MONTH). Schedules are free, capped by their
 * shape: up to 10, at most once a minute. The rooms Worker checks the player's pass before it asks;
 * nothing here trusts the request.
 *
 * Its one alarm does three things: the next schedule due, recording stats about a minute after use,
 * and trying again a game server that didn't start. The rooms Worker's cron (index.ts) tells it to read
 * the schedules again when the live version changes (syncSchedules).
 */
export class GameServerObject extends DurableObject<Env> {
  private requestUse: RequestUse;
  private unrecorded: Unrecorded | null;
  private unsavedRequestCount = 0;
  private gameId: string | null;
  private schedules: Schedules | null;
  /** When to record the stats, and when to read the schedules again after their game server didn't start. */
  private recordAtMs: number | null = null;
  private scheduleRetryAtMs: number | null;
  /** Schedules ran since the last record, so their times go to D1 with it. */
  private haveSchedulesRun = false;
  private stoppedAtMs: number[] = [];
  /** The open session, for one version: or why that version can't run, and when a server that didn't start is tried again. */
  private server: { versionId: string; ready: Promise<Opened> } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.requestUse = ctx.storage.kv.get<RequestUse>("request_use") ?? { month: usageMonth(), requestCount: 0 };
    this.unrecorded = ctx.storage.kv.get<Unrecorded>("unrecorded") ?? null;
    // Saved before schedules counted runs.
    if (this.unrecorded) this.unrecorded.scheduledRunCount ??= 0;
    this.gameId = ctx.storage.kv.get<string>("game_id") ?? null;
    this.schedules = ctx.storage.kv.get<Schedules>("schedules") ?? null;
    this.scheduleRetryAtMs = ctx.storage.kv.get<number>("schedule_retry_at_ms") ?? null;
  }

  async request(gameId: string, versionId: string, player: Player, request: unknown): Promise<RequestOutcome> {
    this.knowGame(gameId);
    this.newMonth();
    if (this.requestUse.requestCount >= FREE_REQUEST_COUNT_PER_MONTH) {
      return { code: "request_limit", message: `This game has used its free ${FREE_REQUEST_COUNT_PER_MONTH.toLocaleString("en-US")} requests this month. They work again on ${nextMonthStartDate()} (UTC).` };
    }
    if (this.isPaused()) return { code: "game_server_error", message: "The game's server is paused for a few minutes: it kept running on too long." };

    const ready = await this.serverFor(gameId, versionId);
    if ("outcome" in ready) return ready.outcome;
    if (!ready.handlerNames.includes("onRequest")) return { code: "no_request_handler", message: "This game's server doesn't take requests: its live version has no onRequest." };

    this.countRequest();
    const reply = await this.reach(versionId, () => ready.session.request(player, request), REQUEST_LIMITS.answerTimeoutSec, "onRequest", `onRequest didn't answer within ${REQUEST_LIMITS.answerTimeoutSec} seconds, so the request failed. Something it awaits never finished.`);
    if (!reply) return { code: "game_server_error" };
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

  /** From the rooms Worker's cron, when the game's live version isn't the one whose schedules were read. */
  async syncSchedules(gameId: string): Promise<void> {
    this.knowGame(gameId);
    await this.readSchedules();
    this.planAlarm();
  }

  private knowGame(gameId: string): void {
    if (this.gameId === gameId) return;
    this.gameId = gameId;
    this.ctx.storage.kv.put("game_id", gameId);
  }

  private isPaused(): boolean {
    const nowMs = Date.now();
    this.stoppedAtMs = this.stoppedAtMs.filter((stoppedAtMs) => nowMs - stoppedAtMs < PAUSE_WINDOW_MS);
    return this.stoppedAtMs.length >= PAUSE_STOPPED_COUNT;
  }

  /** The version's open session, opening it (again, once a server that didn't start may be retried). */
  private async serverFor(gameId: string, versionId: string): Promise<Opened> {
    if (this.server?.versionId !== versionId) this.server = { versionId, ready: this.open(gameId, versionId) };
    let ready = await this.server.ready;
    if ("outcome" in ready && ready.retryAtMs !== undefined && Date.now() >= ready.retryAtMs) {
      this.server = { versionId, ready: this.open(gameId, versionId) };
      ready = await this.server.ready;
    }
    return ready;
  }

  /** Open a session with the version's game server, or say why it can't run. */
  private async open(gameId: string, versionId: string): Promise<Opened> {
    try {
      const open = await sandboxOpener(this.env, this.ctx.exports, gameId, versionId);
      if (open === null) return { outcome: { code: "no_request_handler", message: "This game's server doesn't take requests: its live version has no game server." } };
      const session = await open();
      const settings = await session.settings();
      const optionNames = Array.isArray(settings.optionNames) ? settings.optionNames.map(String) : [];
      const unknown = optionNames.find((name) => !(GAME_SERVER_OPTIONS as readonly string[]).includes(name));
      if (unknown) throw new Error(`${unknown} isn't a game server option. A game server takes: ${GAME_SERVER_OPTIONS.join(", ")}.`);
      const handlerNames = Array.isArray(settings.handlerNames) ? settings.handlerNames.map(String) : [];
      // Checked like any game server's (defineGameServer), so a mistake says what to do.
      const schedules = checkSchedules(settings.schedules, handlerNames.includes("onSchedule"));
      return { session, handlerNames, schedules };
    } catch (error) {
      console.error("Couldn't start the game server outside rooms:", error);
      this.note(versionId, "crash", `Didn't start: ${errorLine(String(error instanceof Error ? error.message : error))}`);
      // Tried again a minute later, in case it was the sandbox and not the code; meanwhile requests fail at once.
      return { outcome: { code: "game_server_error" }, retryAtMs: Date.now() + RETRY_START_MS };
    }
  }

  /**
   * One call into handler in the sandbox, given up after timeoutSec. Null when it failed: timed out
   * (timeoutMessage), or the sandbox itself failed (over its CPU limit, or restarted), noted for the
   * developer either way.
   */
  private async reach<T>(versionId: string, work: () => Promise<T>, timeoutSec: number, handler: string, timeoutMessage: string): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TimedOut()), timeoutSec * 1000);
        }),
      ]);
    } catch (error) {
      if (error instanceof TimedOut) {
        this.note(versionId, "crash", timeoutMessage);
        return null;
      }
      // The next call gets a fresh session.
      this.stoppedAtMs.push(Date.now());
      this.note(versionId, "stopped", /CPU time/i.test(String(error)) ? `${handler} ran on too long and was stopped, like a loop that never ends` : `The game server stopped: ${String(error)}`);
      if (this.server?.versionId === versionId) this.server = null;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The game's live version, or null when players can't play it (taken down, held, no version). */
  private async liveVersionId(): Promise<string | null> {
    const game = await this.env.DB.prepare("SELECT review_status, live_version_id FROM games WHERE id = ?").bind(this.gameId).first<{ review_status: string; live_version_id: string | null }>();
    return game?.review_status === "live" && game.live_version_id ? game.live_version_id : null;
  }

  /**
   * Read the live version's schedules and plan their runs, keeping when each last ran. A game players
   * can't play has none. Written to D1 for the developer's stats, with the version read, so the rooms
   * Worker's cron knows when to ask again.
   */
  private async readSchedules(): Promise<void> {
    if (!this.gameId) return;
    const versionId = await this.liveVersionId();
    const nowMs = Date.now();
    let schedules: Schedules | null = null;
    this.scheduleRetryAtMs = null;
    if (versionId) {
      const ready = await this.serverFor(this.gameId, versionId);
      if ("session" in ready && ready.schedules.length) {
        const last = this.schedules?.schedules ?? [];
        schedules = {
          versionId,
          schedules: ready.schedules.map((schedule) => ({
            ...schedule,
            nextRunAtMs: nextRunAtMs(schedule.cron, nowMs)!,
            lastRunAtMs: last.find((before) => before.name === schedule.name)?.lastRunAtMs ?? null,
          })),
        };
        // A game server that didn't start: noted for the developer, and read again in a while.
      } else if ("outcome" in ready && ready.retryAtMs !== undefined) this.scheduleRetryAtMs = nowMs + SCHEDULE_RETRY_MS;
    }
    this.schedules = schedules;
    this.saveSchedules();
    try {
      await this.env.DB.batch([
        this.env.DB.prepare("DELETE FROM game_server_schedules WHERE game_id = ?").bind(this.gameId),
        ...(schedules?.schedules ?? []).map((schedule) =>
          this.env.DB.prepare("INSERT INTO game_server_schedules (game_id, schedule_name, cron, version_id, next_run_at_ms, last_run_at_ms) VALUES (?, ?, ?, ?, ?, ?)").bind(
            this.gameId,
            schedule.name,
            schedule.cron,
            schedules!.versionId,
            schedule.nextRunAtMs,
            schedule.lastRunAtMs,
          ),
        ),
        this.env.DB.prepare("UPDATE games SET game_server_schedules_version_id = ? WHERE id = ?").bind(versionId, this.gameId),
      ]);
    } catch (error) {
      console.error("Couldn't record the game server's schedules:", error);
    }
  }

  /** Run the schedules that are due, once each however late, after checking the game is still the same. */
  private async runDue(): Promise<void> {
    const schedules = this.schedules;
    if (!schedules || !this.gameId) return;
    // A new live version (the cron will ask too) or a game players can't play: its schedules are read again.
    if ((await this.liveVersionId()) !== schedules.versionId) return this.readSchedules();
    const nowMs = Date.now();
    const due = schedules.schedules.filter((schedule) => schedule.nextRunAtMs <= nowMs);
    if (!due.length) return;
    const runs = due.map((schedule) => ({ name: schedule.name, cron: schedule.cron, scheduledAt: new Date(schedule.nextRunAtMs).toISOString() }));
    for (const schedule of due) {
      schedule.lastRunAtMs = nowMs;
      schedule.nextRunAtMs = nextRunAtMs(schedule.cron, nowMs)!;
    }
    this.haveSchedulesRun = true;
    this.saveSchedules();
    this.recordSoon();
    if (this.isPaused()) {
      for (const run of runs) this.note(schedules.versionId, "stopped", `Schedule ${run.name} skipped a run: the game's server is paused for a few minutes, it kept running on too long.`);
      return;
    }
    const ready = await this.serverFor(this.gameId, schedules.versionId);
    // Didn't start: noted when it was opened.
    if ("outcome" in ready) return;
    await Promise.all(
      runs.map(async (run) => {
        this.today().scheduledRunCount++;
        const timeoutMessage = `Schedule ${run.name}: onSchedule didn't finish within ${SCHEDULE_LIMITS.runTimeoutSec} seconds, so the run failed. Something it awaits never finished.`;
        const reply = await this.reach(schedules.versionId, () => ready.session.schedule(run), SCHEDULE_LIMITS.runTimeoutSec, `Schedule ${run.name}: onSchedule`, timeoutMessage);
        if (reply?.error !== undefined) this.note(schedules.versionId, "crash", `Schedule ${run.name}: ${errorLine(String(reply.error))}`);
      }),
    );
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
    return (this.unrecorded ??= { date, requestCount: 0, scheduledRunCount: 0, crashCount: 0, stoppedCount: 0, errors: [] });
  }

  private recordSoon(): void {
    if (this.recordAtMs !== null) return;
    this.recordAtMs = Date.now() + RECORD_DELAY_MS;
    this.planAlarm();
  }

  /** The one alarm, at whatever's next: a schedule due, recording the stats, or trying a game server again. */
  private planAlarm(): void {
    const times = [this.recordAtMs, this.scheduleRetryAtMs, ...(this.schedules?.schedules.map((schedule) => schedule.nextRunAtMs) ?? [])].filter((atMs): atMs is number => atMs !== null);
    if (times.length) void this.ctx.storage.setAlarm(Math.min(...times));
    else void this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const nowMs = Date.now();
    const isRetryDue = this.scheduleRetryAtMs !== null && this.scheduleRetryAtMs <= nowMs;
    const isRunDue = this.schedules?.schedules.some((schedule) => schedule.nextRunAtMs <= nowMs) ?? false;
    if (isRetryDue) await this.readSchedules();
    else if (isRunDue) await this.runDue();
    // Recorded when this alarm was for it, with a schedule's alarm a little before (so a schedule every
    // minute wakes this once a minute, not twice), and after a restart (which forgets when) at the next alarm.
    if (this.unrecorded && (!(isRetryDue || isRunDue) || this.recordAtMs === null || this.recordAtMs <= Date.now() + RECORD_SLACK_MS)) {
      this.recordAtMs = null;
      this.save();
      await this.record();
    } else if (!this.unrecorded) this.recordAtMs = null;
    this.planAlarm();
  }

  /** Add the unrecorded use and errors to the game's stats, which the developer API reads, with when schedules ran. */
  private async record(): Promise<void> {
    const unrecorded = this.unrecorded;
    if (!unrecorded || !this.gameId) return;
    this.unrecorded = null;
    this.save();
    const nowMs = Date.now();
    const ranSchedules = this.haveSchedulesRun ? this.schedules : null;
    this.haveSchedulesRun = false;
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT INTO room_usage (game_id, date, game_server_request_count, game_server_scheduled_run_count, game_server_crash_count, game_server_stopped_count) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, date) DO UPDATE SET game_server_request_count = game_server_request_count + excluded.game_server_request_count, game_server_scheduled_run_count = game_server_scheduled_run_count + excluded.game_server_scheduled_run_count, game_server_crash_count = game_server_crash_count + excluded.game_server_crash_count, game_server_stopped_count = game_server_stopped_count + excluded.game_server_stopped_count",
        ).bind(this.gameId, unrecorded.date, unrecorded.requestCount, unrecorded.scheduledRunCount, unrecorded.crashCount, unrecorded.stoppedCount),
        ...unrecorded.errors.map((error) =>
          this.env.DB.prepare(
            "INSERT INTO game_server_errors (game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, version_id, kind, message) DO UPDATE SET occurrence_count = occurrence_count + excluded.occurrence_count, last_at_ms = excluded.last_at_ms",
          ).bind(this.gameId, error.versionId, error.kind, error.message, error.occurrenceCount, error.firstAtMs, nowMs),
        ),
        ...(ranSchedules?.schedules ?? []).map((schedule) =>
          this.env.DB.prepare("UPDATE game_server_schedules SET next_run_at_ms = ?, last_run_at_ms = ? WHERE game_id = ? AND schedule_name = ? AND version_id = ?").bind(
            schedule.nextRunAtMs,
            schedule.lastRunAtMs,
            this.gameId,
            schedule.name,
            ranSchedules!.versionId,
          ),
        ),
      ]);
    } catch (error) {
      console.error("Couldn't record the game server's use:", error);
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

  private saveSchedules(): void {
    if (this.schedules) this.ctx.storage.kv.put("schedules", this.schedules);
    else this.ctx.storage.kv.delete("schedules");
    if (this.scheduleRetryAtMs !== null) this.ctx.storage.kv.put("schedule_retry_at_ms", this.scheduleRetryAtMs);
    else this.ctx.storage.kv.delete("schedule_retry_at_ms");
  }
}

/** Games read per cron run: a burst of publishes gets through over a few minutes. */
const SYNC_GAME_COUNT = 100;

/**
 * The rooms Worker's cron, every minute: games whose live version isn't the one whose schedules their
 * object read (just published, rolled back, or playable again) get their object to read them. A game's
 * object also checks before each run, so a game taken down stops at its next run.
 */
export async function syncSchedules(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM games WHERE review_status = 'live' AND live_version_id IS NOT NULL AND live_version_id IS NOT game_server_schedules_version_id LIMIT ?",
  )
    .bind(SYNC_GAME_COUNT)
    .all<{ id: string }>();
  const synced = await Promise.allSettled(results.map((game) => env.GAME_SERVER_OBJECTS.get(env.GAME_SERVER_OBJECTS.idFromName(game.id)).syncSchedules(game.id)));
  for (const outcome of synced) if (outcome.status === "rejected") console.error("Couldn't read a game server's schedules:", outcome.reason);
}
