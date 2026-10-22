import { countryName, isCountry } from "./rooms.ts";
import { reviewReasonAnswer, type ReviewReason } from "./review.ts";
import type { Game } from "./types.ts";

/**
 * A game blocked in one country: when that country's law forbids what US law allows (the UK's hatred
 * offences, say), a notice from there blocks the game for players there, never everywhere
 * (docs/DECISIONS.md, "The content rules draw exact lines, so developers don't hedge"). Kept on the games
 * row as games.country_blocks, so the game files, the game page, rooms and lists check it with the row
 * they already read.
 */
export interface CountryBlock {
  /** ISO 3166-1 alpha-2, like GB. */
  country_code: string;
  /** What the developer reads: country_law_notice, with what the notice names. */
  review_reason: ReviewReason;
  blocked_at_ms: number;
}

export function readCountryBlocks(game: Pick<Game, "country_blocks">): CountryBlock[] {
  try {
    const blocks = JSON.parse(game.country_blocks || "[]") as CountryBlock[];
    return Array.isArray(blocks) ? blocks : [];
  } catch {
    return [];
  }
}

/** Whether players in this country can't open the game. An unknown country (XX, Tor's T1, none) is never blocked. */
export function isBlockedInCountry(game: Pick<Game, "country_blocks">, countryCode: string | null): boolean {
  return isCountry(countryCode) && readCountryBlocks(game).some((block) => block.country_code === countryCode);
}

/** The country a request comes from, by Cloudflare: a two-letter code, or null when it's unknown or Tor. */
export function requestCountryCode(request: Request): string | null {
  const countryCode = (request as { cf?: { country?: unknown } }).cf?.country;
  return typeof countryCode === "string" && isCountry(countryCode) ? countryCode : null;
}

/** Codes Intl names that Cloudflare never gives a request: groups, test codes, and UK (the United Kingdom is GB). */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ", "UK"]);

/** Whether a code names a real country, like GB or DE, so a person can block a game there. */
export function isKnownCountryCode(countryCode: unknown): countryCode is string {
  return typeof countryCode === "string" && isCountry(countryCode) && !NOT_COUNTRIES.has(countryCode) && countryName(countryCode) !== countryCode;
}

/**
 * Keeps a game off a list for viewers in one country: bind the viewer's country (requestCountryCode, or
 * null, which matches nothing) where it stands. Needs the games table as games.
 */
export const NOT_BLOCKED_IN_COUNTRY_SQL = "NOT EXISTS (SELECT 1 FROM json_each(games.country_blocks) WHERE json_extract(json_each.value, '$.country_code') = ?)";

/** Blocks the game in a country, or replaces that country's reason when it's already blocked there. */
export async function blockInCountry(database: D1Database, game: Pick<Game, "id" | "country_blocks">, countryCode: string, reviewReason: ReviewReason, nowMs = Date.now()): Promise<void> {
  const blocks = readCountryBlocks(game).filter((block) => block.country_code !== countryCode);
  blocks.push({ country_code: countryCode, review_reason: reviewReason, blocked_at_ms: nowMs });
  await database.prepare("UPDATE games SET country_blocks = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(blocks), nowMs, game.id).run();
}

/** Lifts the game's block in a country; false when it wasn't blocked there. */
export async function liftCountryBlock(database: D1Database, game: Pick<Game, "id" | "country_blocks">, countryCode: string, nowMs = Date.now()): Promise<boolean> {
  const blocks = readCountryBlocks(game);
  const kept = blocks.filter((block) => block.country_code !== countryCode);
  if (kept.length === blocks.length) return false;
  await database.prepare("UPDATE games SET country_blocks = ?, updated_at_ms = ? WHERE id = ?").bind(JSON.stringify(kept), nowMs, game.id).run();
  return true;
}

/** A game's blocks as the API answers them. */
export function countryBlocksAnswer(game: Pick<Game, "country_blocks">) {
  return readCountryBlocks(game).map((block) => ({
    country_code: block.country_code,
    country_name: countryName(block.country_code),
    review_reason: reviewReasonAnswer(block.review_reason),
    blocked_at: new Date(block.blocked_at_ms).toISOString(),
  }));
}
