/**
 * Players never connect straight to each other ("Players never connect straight to each other" in
 * docs/DECISIONS.md). The relay script on every game page (packages/sdk/relay.js) sends each WebRTC
 * connection through Cloudflare's relay (TURN), with credentials from here: short-lived, issued per
 * game and player like passes, tagged with the game's ID so Cloudflare's analytics give each game's use,
 * which this reads back about once an hour for the free tier.
 */

/** How long relay credentials work: as long as the room key that gets them. */
export const RELAY_CREDENTIAL_DURATION_SEC = 6 * 3600;

/** At most this many games' use is read each hour: Cloudflare takes 300 analytics queries in 5 minutes. */
const MAXIMUM_CHECKED_GAME_COUNT = 250;

export interface RelayEnv {
  /** Cloudflare Realtime's TURN key (dashboard, Realtime, TURN): its ID and API token, Worker secrets. */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  /** Reading the relay's use per game: the account's ID and a token with Account Analytics read, Worker secrets. */
  CLOUDFLARE_ACCOUNT_ID?: string;
  RELAY_ANALYTICS_API_TOKEN?: string;
}

export interface RelayServer {
  urls: string[];
  username: string;
  credential: string;
}

const today = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/**
 * Relay servers for one player of a game, with credentials that last RELAY_CREDENTIAL_DURATION_SEC, or
 * null when the relay isn't set up or didn't answer. Only turn: and turns: addresses: a STUN server would
 * only tell the player their own address, and browsers block port 53.
 */
export async function relayCredentials(env: RelayEnv, database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ iceServers: RelayServer[]; expiresAtMs: number } | null> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return null;
  let response: Response;
  try {
    response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: RELAY_CREDENTIAL_DURATION_SEC, customIdentifier: gameId }),
    });
  } catch (error) {
    console.error("Relay credentials:", error);
    return null;
  }
  if (!response.ok) {
    console.error("Relay credentials:", response.status, await response.text().catch(() => ""));
    return null;
  }
  const answer = (await response.json().catch(() => null)) as { iceServers?: { urls?: string | string[]; username?: string; credential?: string }[] } | null;
  const iceServers = (answer?.iceServers ?? []).flatMap((server): RelayServer[] => {
    const urls = [server.urls ?? []].flat().filter((address) => /^turns?:/.test(address) && !/:53(\?|$)/.test(address));
    return urls.length && server.username && server.credential ? [{ urls, username: server.username, credential: server.credential }] : [];
  });
  if (!iceServers.length) return null;
  await database
    .prepare("INSERT INTO room_usage (game_id, date, relay_credential_count) VALUES (?, ?, 1) ON CONFLICT(game_id, date) DO UPDATE SET relay_credential_count = relay_credential_count + 1")
    .bind(gameId, today(nowMs))
    .run();
  return { iceServers, expiresAtMs: nowMs + RELAY_CREDENTIAL_DURATION_SEC * 1000 };
}

/** What Cloudflare's GraphQL analytics answer for the relay's use. */
interface TurnAnalyticsAnswer {
  data?: { viewer?: { accounts?: { callsTurnUsageAdaptiveGroups?: { dimensions: { datetimeHour: string }; sum: { egressBytes: number } }[] }[] } };
  errors?: { message: string }[] | null;
}

/**
 * The data the relay sent one game's players on each day since fromDate (UTC), from Cloudflare's
 * analytics: one query per game, since Cloudflare samples and a query over several games skews each.
 * Null when Cloudflare didn't answer.
 */
async function relayedSizeBytesByDate(env: RelayEnv, gameId: string, fromDate: string): Promise<Map<string, number> | null> {
  const query = `query RelayUse($accountTag: string!, $customIdentifier: string!, $fromDate: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      callsTurnUsageAdaptiveGroups(limit: 100, filter: { date_geq: $fromDate, customIdentifier: $customIdentifier }) {
        dimensions { datetimeHour }
        sum { egressBytes }
      }
    }
  }
}`;
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RELAY_ANALYTICS_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { accountTag: env.CLOUDFLARE_ACCOUNT_ID, customIdentifier: gameId, fromDate } }),
    });
    const answer = (await response.json()) as TurnAnalyticsAnswer;
    const groups = answer.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups;
    if (!response.ok || answer.errors?.length || !groups) {
      console.error("Relay use:", response.status, JSON.stringify(answer.errors ?? null));
      return null;
    }
    const byDate = new Map<string, number>();
    for (const group of groups) {
      const date = group.dimensions.datetimeHour.slice(0, 10);
      byDate.set(date, (byDate.get(date) ?? 0) + Math.round(group.sum.egressBytes));
    }
    return byDate;
  } catch (error) {
    console.error("Relay use:", error);
    return null;
  }
}

/**
 * Hourly: each game whose players got relay credentials in the last two days (they last 6 hours, so
 * yesterday's reach into today), the data the relay sent them yesterday and today, into room_usage.
 */
export async function syncRelayUse(env: RelayEnv, database: D1Database, nowMs = Date.now()): Promise<void> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.RELAY_ANALYTICS_API_TOKEN) return;
  const yesterday = today(nowMs - 86_400_000);
  const { results } = await database
    .prepare("SELECT game_id FROM room_usage WHERE date >= ? AND relay_credential_count > 0 GROUP BY game_id ORDER BY MAX(date) DESC LIMIT ?")
    .bind(yesterday, MAXIMUM_CHECKED_GAME_COUNT)
    .all<{ game_id: string }>();
  for (const { game_id: gameId } of results) {
    const byDate = await relayedSizeBytesByDate(env, gameId, yesterday);
    if (!byDate) continue;
    const writes = [...byDate].map(([date, relayedSizeBytes]) =>
      database
        .prepare("INSERT INTO room_usage (game_id, date, relayed_size_bytes) VALUES (?, ?, ?) ON CONFLICT(game_id, date) DO UPDATE SET relayed_size_bytes = excluded.relayed_size_bytes")
        .bind(gameId, date, relayedSizeBytes),
    );
    if (writes.length) await database.batch(writes);
  }
}
