import type { Env } from "./env.ts";
import { showcase } from "./home.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT, playingNowCounts } from "./plays.ts";

/*
 * Who's playing right now (docs/DECISIONS.md, "The sign-in shows who's playing, over a kingdom in the mountains"): everyone at once, the sum of
 * every game's playing-now count, real and never rounded up.
 */

/** The most-played games it lists at most. */
const MOST_BUSIEST_GAME_COUNT = 6;

export interface PlayingNowAnswer {
  playing_now_player_count: number;
  busiest_games: { slug: string; title: string; cover_url: string | null; playing_now_player_count: number | null }[];
}

const sumOf = (counts: Map<string, number>) => [...counts.values()].reduce((playerCount, gamePlayerCount) => playerCount + gamePlayerCount, 0);

/** Who's playing right now: public, the same for everyone, on the sign-in page and through the API and MCP. Busiest games are listed ones only, by play count alone. */
export async function playingNowAnswer(env: Env, nowMs = Date.now(), previewPlayerCount: number | null = null): Promise<PlayingNowAnswer> {
  const [counts, games] = await Promise.all([playingNowCounts(env, nowMs), showcase(env, 13)]);
  const busiest = games.filter((game) => game.playing_now_player_count > 0).sort((first, second) => second.playing_now_player_count - first.playing_now_player_count).slice(0, MOST_BUSIEST_GAME_COUNT);
  return {
    playing_now_player_count: previewPlayerCount ?? sumOf(counts),
    busiest_games: busiest.map((game) => ({ slug: game.slug, title: game.title, cover_url: game.cover, playing_now_player_count: game.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? game.playing_now_player_count : null })),
  };
}
