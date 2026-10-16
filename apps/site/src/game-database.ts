import { ApiError, GAME_DATABASE_FREE_LIMITS, nextMonthStartDate, type Game } from "@zaisma/core";
import type { DatabaseRow, DatabaseValue } from "@zaisma/game-server";
import type { DeveloperDatabaseAnswer, StatementResult } from "../../rooms/src/database.ts";
import { closedBody, readJson, type NextStep } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * A game's own database through the developer API (docs/DECISIONS.md, "Every game gets a real database"):
 * the same SQLite database its game servers use as room.database, with the same checks, limits and use,
 * reached in the rooms Worker through the GAME_DATABASES service binding.
 *
 *   GET  /api/dev/games/:slug/database         its tables and indexes, and this month's use against the free limits
 *   POST /api/dev/games/:slug/database/query   one statement: { "sql", "values" }
 *   POST /api/dev/games/:slug/database/batch   several in one transaction: { "statements": [{ "sql", "values" }] }
 *
 * JSON has no bytes, so a blob goes in and comes out as { "blob_base64": "…" }.
 */

/** Values up to 1 MB each, up to 100 statements: the body can be big, but not unbounded. */
const MAXIMUM_DATABASE_BODY_SIZE_BYTES = 6 * 1024 * 1024;

const VALUES_FIX = 'Give the values for the ?s as a list, in order: text, numbers, null, or { "blob_base64": "…" } for bytes, like ["player_8f3k2m", 1200, null].';

export async function databaseRoute(request: Request, env: Env, game: Game, what: string | undefined): Promise<[unknown, number?]> {
  const service = env.GAME_DATABASES;
  if (!service) throw new ApiError("database_unavailable", { message: "This Zaisma has no game databases connected.", fix: "On zaisma.com this doesn't happen; on your own Zaisma, bind the rooms Worker's GameDatabaseService as GAME_DATABASES (apps/site/wrangler.jsonc)." });

  if (!what) {
    const overview = readAnswer(await service.overview(game.id), null);
    const limits = GAME_DATABASE_FREE_LIMITS;
    const usage = overview.usage;
    return [
      {
        tables: overview.tables,
        indexes: overview.indexes.map((index) => ({ name: index.name, table_name: index.tableName, sql: index.sql })),
        database_use_this_month: {
          read_row_count: usage.readRowCount,
          written_row_count: usage.writtenRowCount,
          storage_size_bytes: usage.storageSizeBytes,
          free_read_row_count: limits.readRowCountPerMonth,
          free_written_row_count: limits.writtenRowCountPerMonth,
          free_storage_size_bytes: limits.storageSizeBytes,
          has_reached_free_reads: usage.readRowCount >= limits.readRowCountPerMonth,
          has_reached_free_writes: usage.writtenRowCount >= limits.writtenRowCountPerMonth,
          has_reached_free_storage: usage.storageSizeBytes >= limits.storageSizeBytes,
          reset_date: nextMonthStartDate(),
        },
      },
    ];
  }

  const body = await readJson(request, MAXIMUM_DATABASE_BODY_SIZE_BYTES);
  const nextSteps: NextStep[] = [];
  if (what === "query") {
    closedBody(body, ["sql", "values"]);
    if (body.sql === undefined) throw new ApiError("missing_field", { message: "sql wasn't sent.", field: "sql", fix: 'Send one SQL statement as sql, like { "sql": "SELECT * FROM scores WHERE player_id = ?", "values": ["player_8f3k2m"] }.' });
    const statementResult = readAnswer(await service.query(game.id, body.sql, readValues(body.values, "values")), "sql");
    return [{ ...resultJson(statementResult), next_steps: nextSteps }];
  }
  closedBody(body, ["statements"]);
  if (body.statements === undefined) throw new ApiError("missing_field", { message: "statements wasn't sent.", field: "statements", fix: 'Send statements as a list, like { "statements": [{ "sql": "UPDATE …", "values": [] }, { "sql": "INSERT …", "values": [] }] }.' });
  const statements = Array.isArray(body.statements)
    ? body.statements.map((statement, i) => (statement && typeof statement === "object" && !Array.isArray(statement) && "values" in statement ? { ...statement, values: readValues((statement as { values: unknown }).values, `statements[${i}].values`) } : statement))
    : body.statements;
  const statementResults = readAnswer(await service.batch(game.id, statements), "statements");
  return [{ statement_results: statementResults.map(resultJson), next_steps: nextSteps }];
}

/** One statement's answer, with blobs as { blob_base64 }. */
function resultJson(statementResult: StatementResult) {
  return { rows: statementResult.rows.map(rowJson), read_row_count: statementResult.readRowCount, written_row_count: statementResult.writtenRowCount };
}

function rowJson(row: DatabaseRow): Record<string, string | number | null | { blob_base64: string }> {
  const json: Record<string, string | number | null | { blob_base64: string }> = {};
  for (const [column, columnValue] of Object.entries(row)) json[column] = columnValue instanceof Uint8Array ? { blob_base64: toBase64(columnValue) } : columnValue;
  return json;
}

/**
 * Values from JSON, as the database takes them: { blob_base64 } becomes bytes. The database checks the
 * rest (how many, how big); kinds JSON has and it doesn't take are refused here, with the API's own fix.
 */
function readValues(given: unknown, field: string): DatabaseValue[] | undefined {
  if (given === undefined || given === null) return undefined;
  if (!Array.isArray(given)) throw new ApiError("bad_values", { message: `${field} isn't a list.`, field, fix: VALUES_FIX });
  return given.map((givenValue, i) => {
    if (givenValue === null || typeof givenValue === "string" || typeof givenValue === "number") return givenValue;
    if (typeof givenValue === "boolean") throw new ApiError("bad_values", { message: `Value ${i + 1} is ${givenValue}.`, field: `${field}[${i}]`, fix: "Give 1 for true and 0 for false." });
    const blob = givenValue && typeof givenValue === "object" && !Array.isArray(givenValue) && Object.keys(givenValue).length === 1 ? (givenValue as { blob_base64?: unknown }).blob_base64 : undefined;
    if (typeof blob === "string") {
      try {
        return Uint8Array.from(atob(blob.replace(/\s+/g, "")), (character) => character.charCodeAt(0));
      } catch {
        throw new ApiError("bad_values", { message: `Value ${i + 1}'s blob_base64 isn't valid base64.`, field: `${field}[${i}]`, fix: "Send the bytes base64-encoded, with nothing around them." });
      }
    }
    throw new ApiError("bad_values", {
      message: `Value ${i + 1} is ${Array.isArray(givenValue) ? "a list" : "an object"}.`,
      field: `${field}[${i}]`,
      fix: 'Give text, a number, null or { "blob_base64": "…" }; to store an object, give it as JSON text and read it back with SQLite\'s JSON functions, like json_extract(column, \'$.level\').',
    });
  });
}

/** The answer's result, or its error as the API answers it. */
function readAnswer<T>(answer: DeveloperDatabaseAnswer<T>, sqlField: string | null): T {
  if ("queryResult" in answer) return answer.queryResult;
  const { code, message, fix } = answer.error;
  const field = code === "bad_sql" ? sqlField : code === "bad_values" ? (sqlField === "sql" ? "values" : sqlField) : null;
  const isMonthLimit = code === "database_read_limit" || code === "database_write_limit";
  const retryAfterSec = isMonthLimit ? Math.ceil((Date.parse(`${nextMonthStartDate()}T00:00:00Z`) - Date.now()) / 1000) : code === "database_unavailable" ? 5 : null;
  throw new ApiError(code, { message, field, fix, retryAfterSec });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
