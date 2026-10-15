// The preview runs the site, games and rooms Workers as three wrangler dev servers, each its own
// workerd process, all on one local database file. Local D1 is SQLite with no busy wait, so when one
// server writes while another reads or writes, the other's call fails straight away: "database is
// locked: SQLITE_BUSY" (or _SNAPSHOT), or for a read "Failed to get session commit token". Press Play
// while the scheduled job or a room writes, and the page or the game's frame showed a 500.
// Production has one real D1 and never sees this, so only the preview wraps its Workers in this (see
// the files beside it): each database call that hit a lock is tried again a moment later. A failed
// call rolled back whole (every local D1 call is its own transaction), so trying again never counts twice.

const LOCKED = /SQLITE_BUSY|database is locked|Failed to get session commit token/;
const MAXIMUM_ATTEMPT_COUNT = 10;

async function retried(call) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= MAXIMUM_ATTEMPT_COUNT || !LOCKED.test(String(error?.message ?? error))) throw error;
      // A random wait that grows, so the servers stop colliding: about 10 ms at first, up to half a second.
      const delayMs = 10 + Math.random() * Math.min(500, 10 * 2 ** attempt);
      await new Promise((done) => setTimeout(done, delayMs));
    }
  }
}

/** The real statement behind each wrapped one, for batch(). */
const realStatements = new WeakMap();

function retryingStatement(statement) {
  const wrapped = {
    bind: (...values) => retryingStatement(statement.bind(...values)),
    first: (...options) => retried(() => statement.first(...options)),
    run: () => retried(() => statement.run()),
    all: () => retried(() => statement.all()),
    raw: (...options) => retried(() => statement.raw(...options)),
  };
  realStatements.set(wrapped, statement);
  return wrapped;
}

function retryingDatabase(database) {
  return {
    prepare: (query) => retryingStatement(database.prepare(query)),
    // A batch is one transaction: it all happened or none of it did.
    batch: (statements) => retried(() => database.batch(statements.map((statement) => realStatements.get(statement) ?? statement))),
    exec: (query) => retried(() => database.exec(query)),
    withSession: (...options) => database.withSession(...options),
  };
}

const retryingEnvironments = new WeakMap();

/** The Worker's environment with its database (DB) tried again when locked; everything else as it was. */
export function retryWhenLocked(environment) {
  if (!environment?.DB) return environment;
  let retrying = retryingEnvironments.get(environment);
  if (!retrying) {
    const database = retryingDatabase(environment.DB);
    retrying = new Proxy(environment, { get: (target, name) => (name === "DB" ? database : Reflect.get(target, name)) });
    retryingEnvironments.set(environment, retrying);
  }
  return retrying;
}

/** A Worker's handlers (fetch, scheduled, queue), each given the retrying environment. */
export function workerRetryingWhenLocked(worker) {
  return Object.fromEntries(
    Object.entries(worker).map(([name, handler]) => [name, typeof handler === "function" ? (event, environment, context) => handler.call(worker, event, retryWhenLocked(environment), context) : handler]),
  );
}
