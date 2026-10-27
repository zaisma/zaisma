import { WorkerEntrypoint } from "cloudflare:workers";
import { ZAISMA_DOMAINS, allowedHostsOf, isHostAllowed, unreachableHostReason } from "@zaisma/core";
import { OUTSIDE_CALL_LIMITS, OUTSIDE_CALL_REFUSAL_HEADER, type OutsideCallErrorCode, type OutsideCallRefusal } from "@zaisma/game-server/internal";
import type { Env } from "./index.ts";

/**
 * Game server reach (docs/DECISIONS.md, "Game servers are full building blocks"): every fetch() a
 * game's sandbox makes comes here instead of going out (sandbox.ts gives it as the sandbox's
 * globalOutbound, fixed to the game by props it can't see), and goes on only when it's https to a host
 * the game lists in games.game_server_allowed_hosts, never an IP address, this computer or Zaisma's
 * own domains. Redirects come back to the game server rather than being followed here, so a listed
 * host can't send a call somewhere unlisted. A refusal answers with OUTSIDE_CALL_REFUSAL_HEADER, which
 * the sandbox's fetch turns into an OutsideCallError. Raw TCP (connect()) isn't offered.
 */

/** How long a game's list is kept before it's read again, so a change works within a minute. */
const LIST_CACHE_MS = 30_000;
const listsByGameId = new Map<string, { allowedHosts: string[]; readAtMs: number }>();

/**
 * Calls each game made through this isolate that aren't in room_usage yet, for the hosting meter: counted here,
 * where the game's code can't reach, and added at most every RECORD_DELAY_MS, a row per game, not a write per call.
 */
const unrecordedCallCountByGameId = new Map<string, number>();
let isRecordPlanned = false;
const RECORD_DELAY_MS = 5_000;

export class GameServerOutbound extends WorkerEntrypoint<Env, { gameId: string }> {
  async fetch(request: Request): Promise<Response> {
    const { gameId } = this.ctx.props;
    this.countCall(gameId);
    const url = URL.canParse(request.url) ? new URL(request.url) : null;
    if (!url || url.protocol !== "https:") {
      return refuse("not_https", `${url ? `${url.protocol}//${url.host}` : JSON.stringify(request.url)} isn't an https address.`, "Call https:// addresses, like https://api.example.com/scores; game servers make no other calls.");
    }
    const host = url.hostname;
    const reason = unreachableHostReason(host, blockedDomains(this.env));
    if (reason) return refuse("unreachable_host", reason, "Call your own server or a service by its name, and list it in game_server_allowed_hosts.");
    const allowedHosts = await this.allowedHosts(gameId);
    if (!isHostAllowed(host, allowedHosts)) {
      return refuse(
        "host_not_allowed",
        `${host} isn't in the game's game_server_allowed_hosts.`,
        `List it with update_game: game_server_allowed_hosts ${JSON.stringify([...allowedHosts, host])}. Calls to it work within a minute.`,
      );
    }
    if (this.env.OUTSIDE_CALL_LIMIT && !(await this.env.OUTSIDE_CALL_LIMIT.limit({ key: gameId })).success) {
      return refuse("outside_call_limit", `This game made over ${OUTSIDE_CALL_LIMITS.maximumCallsPerMin} calls to other servers in a minute.`, "Make fewer, like one per match or per batch of scores rather than per message; calls work again within a minute.");
    }
    const body = await cappedBody(request);
    if (body === "too_big") return refuse("too_big", `The call sends over ${OUTSIDE_CALL_LIMITS.maximumBodySizeBytes / 1024 / 1024} MB.`, `Send up to ${OUTSIDE_CALL_LIMITS.maximumBodySizeBytes / 1024 / 1024} MB a call.`);
    try {
      const response = await fetch(url, { method: request.method, headers: request.headers, body, redirect: "manual", signal: AbortSignal.timeout(OUTSIDE_CALL_LIMITS.timeoutSec * 1000) });
      if (!response.headers.has(OUTSIDE_CALL_REFUSAL_HEADER)) return response;
      // Only our refusals carry it: a server can't make the game server think it was refused.
      const answered = new Response(response.body, response);
      answered.headers.delete(OUTSIDE_CALL_REFUSAL_HEADER);
      return answered;
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return refuse("outside_call_timeout", `${host} didn't answer within ${OUTSIDE_CALL_LIMITS.timeoutSec} seconds.`, "Check the server is up and answers quickly; the call can be tried again.");
      }
      return refuse("outside_call_failed", `${host} couldn't be reached: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`, "Check the address and that the server is up.");
    }
  }

  /** One more call for the game's meter, refused or not: the gateway ran either way. */
  private countCall(gameId: string): void {
    unrecordedCallCountByGameId.set(gameId, (unrecordedCallCountByGameId.get(gameId) ?? 0) + 1);
    if (isRecordPlanned) return;
    isRecordPlanned = true;
    this.ctx.waitUntil(
      new Promise((resolve) => setTimeout(resolve, RECORD_DELAY_MS))
        .then(() => recordCalls(this.env.DB))
        .finally(() => (isRecordPlanned = false)),
    );
  }

  /** The game's list, kept for LIST_CACHE_MS. A game that's gone lists nothing. */
  private async allowedHosts(gameId: string): Promise<string[]> {
    const nowMs = Date.now();
    const kept = listsByGameId.get(gameId);
    if (kept && nowMs - kept.readAtMs < LIST_CACHE_MS) return kept.allowedHosts;
    const game = await this.env.DB.prepare("SELECT game_server_allowed_hosts FROM games WHERE id = ?").bind(gameId).first<{ game_server_allowed_hosts: string }>();
    const allowedHosts = game ? allowedHostsOf(game) : [];
    listsByGameId.set(gameId, { allowedHosts, readAtMs: nowMs });
    return allowedHosts;
  }
}

/** Zaisma's own domains and this Zaisma's own addresses (the local preview and tests have their own). */
function blockedDomains(env: Env): string[] {
  const hosts = [env.SITE_ORIGIN, env.GAME_ORIGIN, env.ISSUER].filter(Boolean).map((origin) => (URL.canParse(origin) ? new URL(origin).hostname : ""));
  return [...new Set([...ZAISMA_DOMAINS, ...hosts, env.GAME_DOMAIN].filter((domain) => domain && domain.includes(".")))];
}

function refuse(code: OutsideCallErrorCode, message: string, fix: string): Response {
  const refusal: OutsideCallRefusal = { error: { code, message, fix } };
  return new Response(JSON.stringify(refusal), { status: code === "outside_call_limit" ? 429 : 403, headers: { "Content-Type": "application/json", [OUTSIDE_CALL_REFUSAL_HEADER]: code } });
}

/** The call's body, read up to the limit, or too_big. */
async function cappedBody(request: Request): Promise<Uint8Array | null | "too_big"> {
  if (!request.body) return null;
  if (Number(request.headers.get("content-length") ?? 0) > OUTSIDE_CALL_LIMITS.maximumBodySizeBytes) return "too_big";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  for (;;) {
    const { done: isDone, value: chunk } = await reader.read();
    if (isDone) break;
    sizeBytes += chunk.byteLength;
    if (sizeBytes > OUTSIDE_CALL_LIMITS.maximumBodySizeBytes) {
      await reader.cancel();
      return "too_big";
    }
    chunks.push(chunk);
  }
  const body = new Uint8Array(sizeBytes);
  let filledSizeBytes = 0;
  for (const chunk of chunks) {
    body.set(chunk, filledSizeBytes);
    filledSizeBytes += chunk.byteLength;
  }
  return body;
}

/** Adds the calls waiting (in this isolate) to each game's room_usage for today, with its own row as one Zaisma wrote for the game; a write that fails keeps them for the next. */
export async function recordCalls(database: D1Database): Promise<void> {
  const counts = [...unrecordedCallCountByGameId];
  unrecordedCallCountByGameId.clear();
  if (!counts.length) return;
  const date = new Date().toISOString().slice(0, 10);
  try {
    await database.batch(
      counts.map(([gameId, callCount]) =>
        database
          .prepare("INSERT INTO room_usage (game_id, date, outside_call_count, bookkeeping_written_row_count) VALUES (?, ?, ?, 1) ON CONFLICT(game_id, date) DO UPDATE SET outside_call_count = outside_call_count + excluded.outside_call_count, bookkeeping_written_row_count = bookkeeping_written_row_count + 1")
          .bind(gameId, date, callCount),
      ),
    );
  } catch (error) {
    console.error("Couldn't record games' outside calls:", error);
    for (const [gameId, callCount] of counts) unrecordedCallCountByGameId.set(gameId, (unrecordedCallCountByGameId.get(gameId) ?? 0) + callCount);
  }
}
