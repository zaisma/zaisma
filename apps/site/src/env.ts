import type { ScanJob } from "@zaisma/core";
import type { GameDatabaseService } from "../../rooms/src/database.ts";

export interface Env {
  DB: D1Database;
  GAMES: R2Bucket;
  /** Players' cloud saves, kept apart from game files. */
  SAVES: R2Bucket;
  ASSETS: Fetcher;
  SCAN_QUEUE: Queue<ScanJob>;
  /** Every game's own database, in the rooms Worker, for the developer API (game-database.ts). */
  GAME_DATABASES?: Service<GameDatabaseService>;
  REPORT_LIMIT?: RateLimit;
  SIGNIN_LIMIT?: RateLimit;
  SAVE_LIMIT?: RateLimit;
  /** Play counts from game pages, per connection address. */
  PLAY_LIMIT?: RateLimit;
  /** Cloudflare's invisible check on Play (Turnstile): the widget's site key and secret. Without them no play is counted. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Developer API requests, per account. */
  DEV_LIMIT?: RateLimit;
  /** Sending game files to the developer API, per account. */
  FILE_LIMIT?: RateLimit;
  ALERTS?: SendEmail;
  SITE_ORIGIN: string;
  GAME_HOST_MODE: "path" | "subdomain";
  GAME_ORIGIN: string;
  GAME_DOMAIN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  AI_MODEL: string;
  AI_MONTHLY_INPUT_TOKENS: string;
  ALERT_FROM: string;
  ALERT_EMAIL?: string;
  ANTHROPIC_API_KEY?: string;
  VT_API_KEY?: string;
  /** Arachnid Shield's API user, as "username:password". Without it, image matching isn't connected and every game waits for a person. */
  ARACHNID_SHIELD_KEY?: string;
  /** Only to point image matching at a stand-in (the local preview). */
  ARACHNID_SHIELD_URL?: string;
  DEV_ADMIN?: string;
  /** Seconds a guest plays with progress before "Keep your progress" shows. Default 300; the local preview uses less. */
  KEEP_OFFER_SECONDS?: string;
  /** How long each place keeps a copy of a game's room list. 10 unless set (tests set 0). */
  ROOM_LIST_CACHE_SECONDS?: string;
  /** Supabase Auth. Without these, accounts are off and everything else still works. */
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  /** Only for deleting sign-ins (account deletion, under-13s). */
  SUPABASE_SECRET_KEY?: string;
  /** Sign in with Zaisma's RS256 key, a private RSA JWK (scripts/sign-in-key.mjs makes one). Without it, Sign in with Zaisma is off. */
  SIGN_IN_SIGNING_KEY?: string;
}

export function gameUrl(env: Env, slug: string): string {
  return env.GAME_HOST_MODE === "subdomain" && env.GAME_DOMAIN ? `https://${slug}.${env.GAME_DOMAIN}/` : `${env.GAME_ORIGIN}/${slug}/`;
}

export function gameFrameSource(env: Env): string {
  return env.GAME_HOST_MODE === "subdomain" && env.GAME_DOMAIN ? `https://*.${env.GAME_DOMAIN}` : env.GAME_ORIGIN;
}
