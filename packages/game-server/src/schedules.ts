/**
 * Schedules: a game server running by itself, outside rooms and requests, for daily resets, weekly
 * leaderboards or a persistent world's turns. The game server lists its schedules, each a name and a
 * cron in UTC, and onSchedule(run, server) runs at each, with server.database. Zaisma runs them in the
 * game's own object (apps/rooms/src/game-server.ts) and the Node runner with timers (startSchedules),
 * both from the times here, so a schedule runs at the same minutes in both.
 *
 * Crons are the usual five fields, minute hour day-of-month month day-of-week, in UTC: numbers, *,
 * ranges (1-5), steps (*\/15) and lists (1,15). So a schedule runs at most once a minute.
 */

import type { Server } from "./requests.ts";

/** One of a game server's schedules: its name, and when it runs. */
export interface Schedule {
  /** Lowercase letters, digits and hyphens, like "daily-reset". onSchedule tells them apart by it. */
  name: string;
  /** When it runs: five fields, minute hour day-of-month month day-of-week, in UTC. "0 0 * * *" is every midnight. */
  cron: string;
}

/** A schedule's run, as onSchedule gets it: which schedule, and the minute it was due (an ISO time, UTC). */
export interface ScheduledRun {
  name: string;
  cron: string;
  scheduledAt: string;
}

export const SCHEDULE_LIMITS = {
  maximumScheduleCount: 10,
  maximumNameCharacterCount: 40,
  /** How long onSchedule may take, awaiting the database included, before the run fails. */
  runTimeoutSec: 30,
} as const;

/** A game server that runs on schedules. */
export interface ScheduleHandler {
  schedules?: readonly Schedule[];
  onSchedule?(run: ScheduledRun, server: Server): unknown;
}

const FIELDS = [
  { name: "minute", minimum: 0, maximum: 59 },
  { name: "hour", minimum: 0, maximum: 23 },
  { name: "day of the month", minimum: 1, maximum: 31 },
  { name: "month", minimum: 1, maximum: 12 },
  { name: "day of the week", minimum: 0, maximum: 7 },
] as const;

/** A cron read into the values each field allows. Day 7 of the week is Sunday, like 0. */
interface CronTimes {
  minutes: boolean[];
  hours: boolean[];
  monthDays: boolean[];
  months: boolean[];
  weekDays: boolean[];
  /** Both day fields given: a day matches either, as cron has always done. */
  isEitherDay: boolean;
}

const CRON_FIX = 'Give five fields in UTC: minute hour day-of-month month day-of-week, like "0 0 * * *" (every midnight), "*/15 * * * *" (every 15 minutes) or "0 4 * * 1" (Mondays at 04:00).';

/** Read a cron, or say what's wrong with it. */
export function readCron(cron: unknown): { cronTimes: CronTimes } | { mistake: string } {
  if (typeof cron !== "string") return { mistake: `cron is ${JSON.stringify(cron) ?? String(cron)}, not text. ${CRON_FIX}` };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { mistake: `The cron "${cron}" has ${parts.length} field${parts.length === 1 ? "" : "s"}, not 5 (schedules run at most once a minute, so there's no seconds field). ${CRON_FIX}` };
  const allowed: boolean[][] = [];
  for (const [index, field] of FIELDS.entries()) {
    const values: boolean[] = Array(field.maximum + 1).fill(false);
    for (const part of parts[index]!.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) return { mistake: `The cron "${cron}" has "${part}" as its ${field.name}. Fields are numbers, *, ranges like 1-5, steps like */15 and lists like 1,15: no names like MON, and no ?, L or #. ${CRON_FIX}` };
      const stepNumber = match[2] === undefined ? 1 : Number(match[2]);
      // *, a range, or one number; a number with a step (5/15) runs from there to the field's end.
      let [fromNumber, toNumber]: [number, number] = [field.minimum, field.maximum];
      if (match[1]!.includes("-")) [fromNumber, toNumber] = match[1]!.split("-").map(Number) as [number, number];
      else if (match[1] !== "*") [fromNumber, toNumber] = [Number(match[1]), match[2] === undefined ? Number(match[1]) : field.maximum];
      if (fromNumber < field.minimum || toNumber > field.maximum || fromNumber > toNumber || stepNumber < 1) {
        return { mistake: `The cron "${cron}" has "${part}" as its ${field.name}, which goes from ${field.minimum} to ${field.maximum}. ${CRON_FIX}` };
      }
      for (let allowedNumber = fromNumber; allowedNumber <= toNumber; allowedNumber += stepNumber) values[allowedNumber] = true;
    }
    allowed.push(values);
  }
  const weekDays = allowed[4]!;
  if (weekDays[7]) weekDays[0] = true;
  const cronTimes: CronTimes = { minutes: allowed[0]!, hours: allowed[1]!, monthDays: allowed[2]!, months: allowed[3]!, weekDays, isEitherDay: parts[2] !== "*" && parts[4] !== "*" };
  if (nextAtMs(cronTimes, Date.UTC(2000, 0, 1)) === null) return { mistake: `The cron "${cron}" never runs: no month has that day. ${CRON_FIX}` };
  return { cronTimes };
}

/** How far ahead to look for the next run: past every leap day. */
const SEARCH_DAY_COUNT = 8 * 366;
const DAY_MS = 86_400_000;

function nextAtMs(cronTimes: CronTimes, afterMs: number): number | null {
  // The first whole minute after afterMs.
  const firstMs = Math.floor(afterMs / 60_000) * 60_000 + 60_000;
  const firstDayMs = Math.floor(firstMs / DAY_MS) * DAY_MS;
  for (let dayIndex = 0; dayIndex < SEARCH_DAY_COUNT; dayIndex++) {
    const dayMs = firstDayMs + dayIndex * DAY_MS;
    const date = new Date(dayMs);
    if (!cronTimes.months[date.getUTCMonth() + 1]) continue;
    const isMonthDay = cronTimes.monthDays[date.getUTCDate()]!;
    const isWeekDay = cronTimes.weekDays[date.getUTCDay()]!;
    if (cronTimes.isEitherDay ? !(isMonthDay || isWeekDay) : !(isMonthDay && isWeekDay)) continue;
    const fromMinuteIndex = dayIndex === 0 ? (firstMs - dayMs) / 60_000 : 0;
    for (let minuteIndex = fromMinuteIndex; minuteIndex < 1440; minuteIndex++) {
      if (cronTimes.hours[Math.floor(minuteIndex / 60)] && cronTimes.minutes[minuteIndex % 60]) return dayMs + minuteIndex * 60_000;
    }
  }
  return null;
}

/** When a cron next runs after afterMs (epoch milliseconds): a whole minute, UTC. Null for a cron that doesn't read. */
export function nextRunAtMs(cron: string, afterMs: number): number | null {
  const read = readCron(cron);
  return "mistake" in read ? null : nextAtMs(read.cronTimes, afterMs);
}

/**
 * A game server's schedules, checked: a list of up to SCHEDULE_LIMITS.maximumScheduleCount
 * { name, cron }, names different, crons that read. Schedules need onSchedule, and onSchedule needs
 * schedules. Otherwise what's wrong, and what to do.
 */
export function readSchedules(schedules: unknown, hasOnSchedule: boolean): { schedules: Schedule[] } | { message: string; fix: string } {
  const example = 'Give a list like [{ name: "daily-reset", cron: "0 0 * * *" }].';
  if (schedules === undefined || (Array.isArray(schedules) && schedules.length === 0)) {
    return hasOnSchedule ? { message: "onSchedule is there but schedules isn't, so it would never run.", fix: `Add schedules, saying when it runs. ${example}` } : { schedules: [] };
  }
  if (!Array.isArray(schedules)) return { message: `schedules is ${JSON.stringify(schedules)?.slice(0, 80) ?? String(schedules)}, not a list.`, fix: example };
  if (schedules.length > SCHEDULE_LIMITS.maximumScheduleCount) {
    return { message: `There are ${schedules.length} schedules; a game server has up to ${SCHEDULE_LIMITS.maximumScheduleCount}.`, fix: "Run more than one job from a schedule: onSchedule can do several things at once." };
  }
  const read: Schedule[] = [];
  for (const schedule of schedules as unknown[]) {
    const { name, cron, ...rest } = (schedule && typeof schedule === "object" && !Array.isArray(schedule) ? schedule : {}) as { name?: unknown; cron?: unknown };
    if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) return { message: `A schedule is ${JSON.stringify(schedule)?.slice(0, 80)}, not { name, cron }.`, fix: example };
    const extra = Object.keys(rest)[0];
    if (extra !== undefined) return { message: `A schedule has ${extra}, which schedules don't take.`, fix: `A schedule is only { name, cron }. ${example}` };
    if (typeof name !== "string" || !new RegExp(`^[a-z0-9][a-z0-9-]{0,${SCHEDULE_LIMITS.maximumNameCharacterCount - 1}}$`).test(name)) {
      return { message: `A schedule's name is ${JSON.stringify(name) ?? "missing"}.`, fix: `Name it with lowercase letters, digits and hyphens, up to ${SCHEDULE_LIMITS.maximumNameCharacterCount} characters, like "daily-reset".` };
    }
    if (read.some((other) => other.name === name)) return { message: `Two schedules are named "${name}".`, fix: "Give each schedule its own name: onSchedule tells them apart by it." };
    const cronRead = readCron(cron);
    if ("mistake" in cronRead) return { message: `Schedule "${name}": ${cronRead.mistake.replace(` ${CRON_FIX}`, "")}`, fix: CRON_FIX };
    read.push({ name, cron: (cron as string).trim().split(/\s+/).join(" ") });
  }
  if (!hasOnSchedule) return { message: "schedules is there but onSchedule isn't, so nothing would run.", fix: "Add onSchedule(run, server): run.name says which schedule is due." };
  return { schedules: read };
}

/**
 * Run a game server's onSchedule for one run, with a time limit. failure says why it failed, for the
 * game server's errors: it threw, or took longer than SCHEDULE_LIMITS.runTimeoutSec.
 */
export async function runSchedule(handler: ScheduleHandler, run: ScheduledRun, server: Server): Promise<{ isDone: true } | { failure: string }> {
  if (typeof handler.onSchedule !== "function") return { failure: "This game server has no onSchedule" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => handler.onSchedule!(run, server)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`onSchedule ("${run.name}") didn't finish within ${SCHEDULE_LIMITS.runTimeoutSec} seconds`)), SCHEDULE_LIMITS.runTimeoutSec * 1000);
      }),
    ]);
    return { isDone: true };
  } catch (error) {
    return { failure: String((error instanceof Error && error.stack) || error) };
  } finally {
    clearTimeout(timer);
  }
}

/** The longest a timer waits in one go (setTimeout's own limit is about 24.8 days). */
const MAXIMUM_TIMER_MS = 24 * 3_600_000;

/**
 * Run a game server's schedules with timers, as the Node runner does on the developer's own server:
 * each at the minutes its cron gives, from the moment this starts. onFailure hears about a run that
 * failed.
 */
export function startSchedules(handler: ScheduleHandler, server: Server, onFailure: (run: ScheduledRun, failure: string) => void): { stop(): void } {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let isStopped = false;
  for (const schedule of handler.schedules ?? []) {
    const plan = (afterMs: number) => {
      const atMs = nextRunAtMs(schedule.cron, afterMs);
      if (atMs === null || isStopped) return;
      const wait = (timer: ReturnType<typeof setTimeout>) => {
        timers.add(timer);
        (timer as { unref?: () => void }).unref?.();
      };
      const due = () => {
        // Long waits go in steps, and the clock is read again after each.
        if (atMs - Date.now() > 0) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            due();
          }, Math.min(atMs - Date.now(), MAXIMUM_TIMER_MS));
          return wait(timer);
        }
        plan(atMs);
        // A run gives up after SCHEDULE_LIMITS.runTimeoutSec, so it's over before the next minute.
        const run = { name: schedule.name, cron: schedule.cron, scheduledAt: new Date(atMs).toISOString() };
        void runSchedule(handler, run, server).then((outcome) => {
          if ("failure" in outcome) onFailure(run, outcome.failure);
        });
      };
      due();
    };
    plan(Date.now());
  }
  return {
    stop() {
      isStopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
