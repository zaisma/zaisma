/**
 * Counting what Cloudflare bills a game for that its objects can't read back from Cloudflare (docs/DECISIONS.md,
 * "Hosting is priced by value"): the time an object is awake, the rows Zaisma writes for the game, and the
 * game server versions loaded each day. Each object adds them to room_usage with the rest of its use.
 */

/** Cloudflare bills an object's duration while it's awake: from each event until about 10 seconds after the last, when it sleeps. */
export const AWAKE_TAIL_MS = 10_000;

/**
 * One object's awake time as Cloudflare bills it: the time covered by its events, each with AWAKE_TAIL_MS after it.
 * In memory only, like the object: a fresh start is a fresh wake.
 */
export class AwakeTime {
  private awakeUntilMs = 0;

  /** The object was in use from fromMs to toMs (one moment when they're the same): the awake time that adds, in ms. */
  note(fromMs = Date.now(), toMs = fromMs): number {
    const untilMs = toMs + AWAKE_TAIL_MS;
    const addedMs = Math.max(0, untilMs - Math.max(fromMs, this.awakeUntilMs));
    this.awakeUntilMs = Math.max(this.awakeUntilMs, untilMs);
    return addedMs;
  }
}

/**
 * D1 that tells onWritten the rows each of its writes wrote (index entries included, as Cloudflare bills them):
 * run(), all() and batch() read it from D1's own answer. first() and raw() answer no count, so writes go through run().
 */
export function countingDatabase(database: D1Database, onWritten: (writtenRowCount: number) => void): D1Database {
  const originals = new WeakMap<object, D1PreparedStatement>();
  const counted = (answer: D1Result) => {
    onWritten(answer.meta?.rows_written ?? 0);
    return answer;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
        if (key === "run" || key === "all") return async () => counted(await target[key]());
        const member = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    originals.set(wrapped, statement);
    return wrapped;
  };
  return new Proxy(database, {
    get(target, key) {
      if (key === "prepare") return (query: string) => wrap(target.prepare(query));
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const answers = await target.batch(statements.map((statement) => originals.get(statement) ?? statement));
          for (const answer of answers) counted(answer);
          return answers;
        };
      const member = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

/**
 * An object's storage that tells onWritten the rows its puts and deletes write: a key each (deleteAll as one).
 * Reads and everything else pass straight through.
 */
export function countingStorage(storage: DurableObjectStorage, onWritten: (writtenRowCount: number) => void): DurableObjectStorage {
  return new Proxy(storage, {
    get(target, key) {
      const member = Reflect.get(target, key, target);
      if (typeof member !== "function") return member;
      if (key === "put")
        return (keyOrEntries: string | Record<string, unknown>, ...rest: unknown[]) => {
          onWritten(typeof keyOrEntries === "string" ? 1 : Object.keys(keyOrEntries).length);
          return (member as (...given: unknown[]) => unknown).call(target, keyOrEntries, ...rest);
        };
      if (key === "delete")
        return (keys: string | string[], ...rest: unknown[]) => {
          onWritten(Array.isArray(keys) ? keys.length : 1);
          return (member as (...given: unknown[]) => unknown).call(target, keys, ...rest);
        };
      if (key === "deleteAll")
        return (...given: unknown[]) => {
          onWritten(1);
          return (member as (...given: unknown[]) => unknown).apply(target, given);
        };
      return member.bind(target);
    },
  });
}

/** Versions this isolate already wrote to loaded_versions, by game, version and day: one write each. */
const noted = new Set<string>();

/**
 * A game server version was loaded today (UTC): one row in loaded_versions per game, version and day, which the
 * meter counts, however many rooms and objects load it. Never fails the caller.
 */
export async function noteLoadedVersion(database: D1Database, gameId: string, versionId: string, nowMs = Date.now()): Promise<void> {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  const key = `${gameId}\n${versionId}\n${date}`;
  if (noted.has(key)) return;
  // A long-lived isolate starts over now and then rather than keep every day's versions.
  if (noted.size >= 10_000) noted.clear();
  try {
    await database.prepare("INSERT OR IGNORE INTO loaded_versions (game_id, date, version_id) VALUES (?, ?, ?)").bind(gameId, date, versionId).run();
    noted.add(key);
  } catch (error) {
    console.error("Couldn't note a loaded game server version:", error);
  }
}
