// The parts of the Node runner (node.js) that stand on their own: where it gets the pass keys and
// profiles, its local SQLite files, and the checks on its options. Nothing here is part of the
// public package: tests reach it by path.
import { existsSync } from "node:fs";
import { DATABASE_LIMITS, GameServerError, answerDatabase, checkBatch, checkPlayerId, checkStatement, checkedRow, eraseRefused, eraseStatements, readDatabaseAnswer, tablesFromColumns, tooManyRows, TABLE_COLUMNS_SQL } from "../src/internal.ts";

/** How long the pass keys and the profiles of accounts are kept before they're fetched again. */
const KEYS_KEPT_MS = 3600_000;
const PROFILE_KEPT_MS = 300_000;
/** The most profiles kept at once. */
const MAXIMUM_PROFILE_COUNT = 10_000;
/** The format the runner's saved room states are written in. A file with another is dropped, and rooms start fresh. */
const ROOM_STATES_FORMAT_VERSION_NUMBER = 1;

/** Fetch the public keys a JWKS URL publishes, caching them for an hour (fetched again at once when asked to refresh). */
function keysFrom(jwksUrl) {
  let cache = null;
  return async (isRefreshing = false) => {
    if (cache && !isRefreshing && Date.now() - cache.fetchedAtMs < KEYS_KEPT_MS) return cache.keys;
    const response = await fetch(jwksUrl);
    if (!response.ok) throw new Error(`Couldn't load Zaisma's keys from ${jwksUrl}`);
    cache = { fetchedAtMs: Date.now(), keys: (await response.json()).keys };
    return cache.keys;
  };
}

/** The pass keys a JWKS URL publishes (Zaisma's: <issuerUrl>/.well-known/jwks.json), as startServer's loadPassKeys takes them. */
export function passKeysFrom(jwksUrl) {
  return keysFrom(jwksUrl);
}

/** The receipt keys a JWKS URL publishes (Zaisma's: <issuerUrl>/.well-known/receipt-jwks.json), as startServer's loadReceiptKeys takes them. */
export function receiptKeysFrom(jwksUrl) {
  return keysFrom(jwksUrl);
}

/**
 * Look up accounts' public profiles at Zaisma (<issuerUrl>/v1/players/<id>), caching each for 5 minutes.
 * An account's pass proves only who the player is; its name comes from here. Null when no account
 * has that ID (deleted since its pass was made).
 */
export function profilesFrom(issuerUrl) {
  const cache = new Map();
  return async (playerId) => {
    const cached = cache.get(playerId);
    if (cached && Date.now() - cached.fetchedAtMs < PROFILE_KEPT_MS) return cached.profile;
    const response = await fetch(`${issuerUrl}/v1/players/${encodeURIComponent(playerId)}`);
    if (response.status !== 200 && response.status !== 404) throw new Error(`Couldn't look up player ${playerId} at ${issuerUrl}`);
    const profile = response.status === 200 ? (await response.json()).player : null;
    if (cache.size > MAXIMUM_PROFILE_COUNT) cache.clear();
    cache.set(playerId, { fetchedAtMs: Date.now(), profile });
    return profile;
  };
}

/** A row from node:sqlite, read as BigInts: a whole number in range is a number again, and one past 2^53 stays too big for checkedRow to refuse. */
function numbersFrom(row) {
  const plain = {};
  for (const [column, columnValue] of Object.entries(row)) plain[column] = typeof columnValue === "bigint" ? Number(columnValue) : columnValue;
  return plain;
}

/**
 * The game's database (room.database) in a local SQLite file, opened on first use: the same calls
 * as in Zaisma rooms, checked the same way, each call in one transaction. Zaisma's free limits don't
 * apply here; the file is yours. Copy it to move the data, or open it with any SQLite tool.
 */
export function localDatabase(file) {
  let opened = null;
  const open = async () => {
    // Loaded only when a game uses its database, so games without one never see Node's SQLite warning.
    opened ??= import("node:sqlite").then(({ DatabaseSync }) => new DatabaseSync(file));
    return opened;
  };
  const run = (database, statements) => {
    database.exec("BEGIN");
    try {
      const results = statements.map(({ sql, values }) => {
        const rows = [];
        const statement = database.prepare(sql);
        statement.setReadBigInts(true);
        for (const row of statement.iterate(...values)) {
          if (rows.length >= DATABASE_LIMITS.maximumRowCount) throw tooManyRows();
          rows.push(checkedRow(numbersFrom(row)));
        }
        return rows;
      });
      database.exec("COMMIT");
      return results;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // SQLite already ended the transaction.
      }
      throw error;
    }
  };
  return {
    query: async (sql, values) => {
      const database = await open();
      return readDatabaseAnswer(answerDatabase(() => run(database, [checkStatement(sql, values)])[0]));
    },
    batch: async (statements) => {
      const database = await open();
      return readDatabaseAnswer(answerDatabase(() => run(database, checkBatch(statements))));
    },
    // The same rule as in Zaisma rooms (eraseStatements), in one transaction. A file that isn't there yet has nothing to erase.
    erasePlayer: async (playerId) => {
      const checkedPlayerId = readDatabaseAnswer(answerDatabase(() => checkPlayerId(playerId)));
      if (!opened && !existsSync(file)) return [];
      const database = await open();
      return readDatabaseAnswer(
        answerDatabase(() => {
          const statements = eraseStatements(tablesFromColumns(database.prepare(TABLE_COLUMNS_SQL).all()), checkedPlayerId);
          database.exec("BEGIN");
          try {
            const erasedTables = statements.map((statement) => {
              try {
                return { tableName: statement.tableName, erasedRowCount: Number(database.prepare(statement.sql).run(...statement.values).changes) };
              } catch (error) {
                throw eraseRefused(statement.tableName, error);
              }
            });
            database.exec("COMMIT");
            return erasedTables;
          } catch (error) {
            try {
              database.exec("ROLLBACK");
            } catch {
              // SQLite already ended the transaction.
            }
            throw error;
          }
        }),
      );
    },
  };
}

/** A player as a saved record: snake_case, like the rest of the room_states file. */
function playerRecord(player) {
  return { id: player.id, name: player.name, kind: player.kind, ...(player.ownedItemNames ? { owned_item_names: player.ownedItemNames } : {}) };
}

function playerFromRecord(record) {
  return { id: record.id, name: record.name, kind: record.kind, ...(record.owned_item_names ? { ownedItemNames: record.owned_item_names } : {}) };
}

/** A map of records, each changed by change; an absent map stays absent. */
function mapped(given, change) {
  return given ? Object.fromEntries(Object.entries(given).map(([key, entry]) => [key, change(entry)])) : undefined;
}

/** Drop the keys whose value is undefined, so JSON.stringify and a reader see the same record. */
function without(record) {
  return Object.fromEntries(Object.entries(record).filter(([, recordValue]) => recordValue !== undefined));
}

/**
 * What a room needs to wake from a restart, as the record the room_states file keeps in saved_room_json:
 * its settings, who it remembers, its seats and waits, and the players in its match (match_players).
 * Every key is snake_case, apart from the ones that are the game's own data (labels, setup_data, join_data, kept_out's IDs).
 * Whether the room is kept is the is_kept column, not part of this.
 */
export function savedRoomRecord(savedRoom, matchPlayers) {
  return without({
    is_listed: savedRoom.isListed,
    is_open: savedRoom.isOpen,
    friend_joins_enabled: savedRoom.friendJoinsEnabled,
    name: savedRoom.name,
    labels: savedRoom.labels,
    known_player_ids: savedRoom.knownPlayerIds,
    setup_data: savedRoom.setupData,
    kept_out: savedRoom.keptOut,
    expected: mapped(savedRoom.expected, (expected) => ({ join_data: expected.joinData, from_room_code: expected.fromRoomCode, until_ms: expected.untilMs })),
    held: mapped(savedRoom.held, (held) => ({ player: playerRecord(held.player), reason: held.reason, until_ms: held.untilMs })),
    kept: savedRoom.kept,
    reconnecting: mapped(savedRoom.reconnecting, (reconnecting) => ({ player: playerRecord(reconnecting.player), until_ms: reconnecting.untilMs })),
    lobby_room_code: savedRoom.lobbyRoomCode,
    ends_at_ms: savedRoom.endsAt ? Date.parse(savedRoom.endsAt) : undefined,
    account_blocks: savedRoom.accountBlocks,
    session_blocks: savedRoom.sessionBlocks,
    friendships: savedRoom.friendships,
    match_players: matchPlayers.map(playerRecord),
  });
}

/** The room and the players in its match that savedRoomRecord wrote, as the room takes them; isKept is the is_kept column. */
export function savedRoomFrom(record, isKept) {
  const savedRoom = without({
    isListed: record.is_listed,
    isOpen: record.is_open,
    friendJoinsEnabled: record.friend_joins_enabled,
    name: record.name,
    labels: record.labels,
    knownPlayerIds: record.known_player_ids,
    setupData: record.setup_data,
    keptOut: record.kept_out,
    expected: mapped(record.expected, (expected) => ({ joinData: expected.join_data, fromRoomCode: expected.from_room_code, untilMs: expected.until_ms })),
    held: mapped(record.held, (held) => ({ player: playerFromRecord(held.player), reason: held.reason, untilMs: held.until_ms })),
    kept: record.kept,
    reconnecting: mapped(record.reconnecting, (reconnecting) => ({ player: playerFromRecord(reconnecting.player), untilMs: reconnecting.until_ms })),
    lobbyRoomCode: record.lobby_room_code,
    endsAt: record.ends_at_ms === undefined ? undefined : new Date(record.ends_at_ms).toISOString(),
    accountBlocks: record.account_blocks,
    sessionBlocks: record.session_blocks,
    friendships: record.friendships,
    isKept: isKept ? true : undefined,
  });
  return { savedRoom, matchPlayers: (record.match_players ?? []).map(playerFromRecord) };
}

/**
 * The rooms' states in a local SQLite file (roomStateFile), made the first time a room saves: a
 * real-time room's every stateSaveIntervalSec and a turn-based room's after each change, so a
 * restarted server brings its matches back (onRestored, for rooms that tick). Apart from the game's
 * database, which is the game's own data: these are the runner's. One row a room, with its state as JSON
 * and the rest of the room as a savedRoomRecord. A file written in another format_version is dropped
 * when it's opened: its rooms start fresh.
 */
export function localRoomStates(file) {
  let database = null;
  const open = () => {
    if (database) return database;
    // Loaded only once a room saves, so a server that never does never sees Node's SQLite warning.
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    database = new DatabaseSync(file);
    const hasTable = database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'room_states'").get() !== undefined;
    const hasVersion = hasTable && database.prepare("SELECT 1 FROM pragma_table_info('room_states') WHERE name = 'format_version'").get() !== undefined;
    if (hasTable && (!hasVersion || database.prepare("SELECT 1 FROM room_states WHERE format_version != ? LIMIT 1").get(ROOM_STATES_FORMAT_VERSION_NUMBER) !== undefined)) {
      database.exec("DROP TABLE room_states");
      console.warn("Saved room states from an older runner were dropped; rooms start fresh.");
    }
    database.exec("CREATE TABLE IF NOT EXISTS room_states (room_code TEXT PRIMARY KEY, format_version INTEGER NOT NULL, state_json TEXT NOT NULL, saved_room_json TEXT NOT NULL, saved_at_ms INTEGER NOT NULL, is_saved_empty INTEGER NOT NULL, is_kept INTEGER NOT NULL)");
    return database;
  };
  const isThere = () => database !== null || (file !== ":memory:" && existsSync(file));
  return {
    /** A room's saved state, the players in its match and the room, when it was saved and whether it was empty then; null if it has none. */
    read(roomCode) {
      if (!isThere()) return null;
      const row = open().prepare("SELECT state_json, saved_room_json, saved_at_ms, is_saved_empty, is_kept FROM room_states WHERE room_code = ?").get(roomCode);
      if (!row) return null;
      const { savedRoom, matchPlayers } = savedRoomFrom(JSON.parse(row.saved_room_json), row.is_kept === 1);
      return { stateJson: row.state_json, matchPlayers, savedRoom, savedAtMs: Number(row.saved_at_ms), isSavedEmpty: row.is_saved_empty === 1 };
    },
    write(roomCode, { stateJson, matchPlayers, savedRoom, savedAtMs, isSavedEmpty = false }) {
      open()
        .prepare("INSERT INTO room_states (room_code, format_version, state_json, saved_room_json, saved_at_ms, is_saved_empty, is_kept) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(room_code) DO UPDATE SET format_version = excluded.format_version, state_json = excluded.state_json, saved_room_json = excluded.saved_room_json, saved_at_ms = excluded.saved_at_ms, is_saved_empty = excluded.is_saved_empty, is_kept = excluded.is_kept")
        .run(roomCode, ROOM_STATES_FORMAT_VERSION_NUMBER, stateJson, JSON.stringify(savedRoomRecord(savedRoom, matchPlayers)), savedAtMs, isSavedEmpty ? 1 : 0, savedRoom.isKept === true ? 1 : 0);
    },
    /** A room's state unchanged since its last save, which now counts as saved as it emptied, with the room as it is (kept or not). */
    markEmpty(roomCode, savedRoom, matchPlayers) {
      if (isThere()) open().prepare("UPDATE room_states SET saved_room_json = ?, is_kept = ?, is_saved_empty = 1 WHERE room_code = ?").run(JSON.stringify(savedRoomRecord(savedRoom, matchPlayers)), savedRoom.isKept === true ? 1 : 0, roomCode);
    },
    remove(roomCode) {
      if (isThere()) open().prepare("DELETE FROM room_states WHERE room_code = ?").run(roomCode);
    },
    /** Delete the states saved before then, except those of rooms still running and kept rooms (room.setKept). */
    removeOlder(beforeMs, runningRoomCodes) {
      if (!isThere()) return;
      const running = [...runningRoomCodes];
      open()
        .prepare(`DELETE FROM room_states WHERE saved_at_ms < ? AND is_kept = 0${running.length ? ` AND room_code NOT IN (${running.map(() => "?").join(", ")})` : ""}`)
        .run(beforeMs, ...running);
    },
  };
}

/** room.secrets and server.secrets on your own server: the environment variables, as they were at the start. */
export function secretsFromEnvironment() {
  return Object.freeze(Object.fromEntries(Object.entries(process.env).filter(([, environmentValue]) => typeof environmentValue === "string")));
}

const OPTION_NAMES = ["gameServer", "gameSlug", "port", "origins", "issuerUrl", "loadPassKeys", "loadReceiptKeys", "loadProfile", "database", "secrets", "webhookSigningSecret", "roomStateFile", "zaismaKey", "developerApiUrl"];

/**
 * Check what startServer was given: unknown options and options of the wrong kind are a GameServerError,
 * before anything listens. Returns the options with their defaults filled in.
 */
export function checkedStartServerOptions(given, issuerUrlDefault) {
  const fail = (code, field, message, fix) => new GameServerError(code, field, message, fix);
  if (given === null || typeof given !== "object" || Array.isArray(given)) throw fail("bad_option", "options", "startServer takes one object of options.", `Call startServer({ gameServer, gameSlug }), with any of: ${OPTION_NAMES.join(", ")}.`);
  for (const field of Object.keys(given)) {
    if (!OPTION_NAMES.includes(field)) throw fail("unknown_option", field, `${field} isn't a startServer option.`, `startServer takes: ${OPTION_NAMES.join(", ")}.`);
  }
  const bad = (field, kind, fix) => fail("bad_option", field, `${field} isn't ${kind}.`, fix);
  const isText = (checked) => typeof checked === "string" && checked.length > 0;
  const isFunction = (checked) => typeof checked === "function";
  const options = { ...given };
  for (const [field, fix] of [["gameServer", "Give your game server object: the default export of your server.ts, or relay."], ["gameSlug", 'Give your game\'s slug as text, like "my-game".']]) {
    if (options[field] === undefined) throw fail("bad_option", field, `${field} is missing.`, fix);
  }
  if (options.gameServer === null || typeof options.gameServer !== "object") throw bad("gameServer", "a game server object", "Give the default export of your server.ts (a defineGameServer object), or relay.");
  if (typeof options.gameSlug !== "string" || !/^[a-z0-9-]{1,40}$/.test(options.gameSlug)) throw bad("gameSlug", "a game slug", 'Give your game\'s slug: 1 to 40 lowercase letters, digits or hyphens, like "my-game".');
  options.port ??= 8080;
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw bad("port", "a port number", "Give a whole number from 0 to 65535 (0 picks a free one), like 8080.");
  options.origins ??= [`https://${options.gameSlug}.zaismausercontent.com`];
  if (!Array.isArray(options.origins) || !options.origins.every(isText)) throw bad("origins", "a list of page origins", 'Give a list of origins, like ["https://my-game.zaismausercontent.com"]; an empty list allows any page, for local testing.');
  options.issuerUrl ??= issuerUrlDefault;
  if (!isText(options.issuerUrl) || !URL.canParse(options.issuerUrl)) throw bad("issuerUrl", "a URL", `Give the address of the server that signs your players' passes, like "${issuerUrlDefault}".`);
  for (const [field, fix] of [["loadPassKeys", "Give async (isRefreshing) => the pass keys, as a list."], ["loadReceiptKeys", "Give async (isRefreshing) => the receipt keys, as a list."], ["loadProfile", "Give async (playerId) => { name } or null."]]) {
    if (options[field] !== undefined && !isFunction(options[field])) throw bad(field, "a function", fix);
  }
  if (options.database !== undefined && (options.database === null || typeof options.database !== "object" || !["query", "batch", "erasePlayer"].every((call) => isFunction(options.database[call])))) throw bad("database", "a game database", "Give an object with query, batch and erasePlayer, like the one localDatabase makes.");
  if (options.secrets !== undefined && (options.secrets === null || typeof options.secrets !== "object" || Array.isArray(options.secrets))) throw bad("secrets", "an object of secrets", "Give an object of text values by name, like { STRIPE_KEY: \"…\" }.");
  if (options.webhookSigningSecret !== undefined && typeof options.webhookSigningSecret !== "string") throw bad("webhookSigningSecret", "text", "Give the signing_secret of the webhook whose events come to /v1/webhooks, as text.");
  if (options.roomStateFile !== undefined && options.roomStateFile !== null && !isText(options.roomStateFile)) throw bad("roomStateFile", "a file path", "Give a file path as text, like \"zaisma-room-states.sqlite\", or null to keep no states.");
  if (options.zaismaKey !== undefined && !isText(options.zaismaKey)) throw bad("zaismaKey", "an API key", "Give an API key with purchase_access write for this game as text, or leave it out to use ZAISMA_KEY.");
  if (options.developerApiUrl !== undefined && (!isText(options.developerApiUrl) || !URL.canParse(options.developerApiUrl))) throw bad("developerApiUrl", "a URL", 'Give the address of Zaisma\'s developer API, like "https://zaisma.com/api/dev".');
  return options;
}
