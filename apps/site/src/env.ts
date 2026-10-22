import type { CompressJob, ListingCheckJob, ScanJob, ShaderCheckJob } from "@zaisma/core";
import type { PerformanceJob } from "./performance-check.ts";
import type { GameDatabaseService } from "../../rooms/src/database.ts";
import type { GameSecretsService } from "../../rooms/src/secrets.ts";
import type { GameServerWebhookService } from "../../rooms/src/game-server.ts";
import type { GameStorageService } from "../../rooms/src/game-storage.ts";
import type { GameRoomsService } from "../../rooms/src/room-updates.ts";
import type { ReceiptSigningService } from "../../rooms/src/receipts.ts";
import type { PhotoDnaService } from "../../photodna/src/index.ts";

export interface Env {
  DB: D1Database;
  GAMES: R2Bucket;
  /** Players' cloud saves, kept apart from game files. */
  SAVES: R2Bucket;
  ASSETS: Fetcher;
  /** Cloudflare Images, for each game picture's share card JPEG; without it the card is the picture itself. */
  IMAGES?: ImagesBinding;
  SCAN_QUEUE: Queue<ScanJob | ListingCheckJob | ShaderCheckJob>;
  /** Cloudflare Browser Rendering, which draws every shader a game sends before anyone sees it (shader-check.ts) and opens every version that passes (performance-check.ts). */
  BROWSER?: Fetcher;
  /** Brotli copies of game files to make (compress.ts). */
  COMPRESS_QUEUE: Queue<CompressJob>;
  /** Versions to open in headless Chrome once they pass (performance-check.ts). */
  PERFORMANCE_QUEUE: Queue<PerformanceJob>;
  /** Every game's own database, in the rooms Worker, for the developer API (game-database.ts). */
  GAME_DATABASES?: Service<GameDatabaseService>;
  /** Every game's secrets, in the rooms Worker, for the developer API (secrets-api.ts). */
  GAME_SECRETS?: Service<GameSecretsService>;
  /** Every game's own game server, in the rooms Worker, for webhooks that send events to it (webhooks.ts). */
  GAME_SERVER_WEBHOOKS?: Service<GameServerWebhookService>;
  /** Deleting a game's database, secrets and game server storage, in the rooms Worker (game-deletion.ts). */
  GAME_STORAGE?: Service<GameStorageService>;
  /** Every game's live rooms, in the rooms Worker, told when a version goes live with match_update_mode "now" (match-updates.ts). */
  GAME_ROOMS?: Service<GameRoomsService>;
  /** Signs purchases' receipts with the pass key, in the rooms Worker (items-api.ts). */
  RECEIPTS?: Service<ReceiptSigningService>;
  REPORT_LIMIT?: RateLimit;
  SIGNIN_LIMIT?: RateLimit;
  /** Password tries on one username, from any address. */
  PASSWORD_LIMIT?: RateLimit;
  SAVE_LIMIT?: RateLimit;
  /** Play counts from game pages, per connection address. */
  PLAY_LIMIT?: RateLimit;
  /** Cloudflare's invisible check on Play and on making an account (Turnstile): the widget's site key and secret. Without them no play is counted, and sign-ups go unchecked. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Only to point the Turnstile check's server side at a stand-in (the local preview). */
  TURNSTILE_SITEVERIFY_URL?: string;
  /** Developer API requests, per account. */
  DEV_LIMIT?: RateLimit;
  /** Sending game files to the developer API, per account. */
  FILE_LIMIT?: RateLimit;
  /** AI apps registering to sign in to the MCP (POST /oauth/register), per connection address. */
  REGISTER_LIMIT?: RateLimit;
  /** Restores and undos of a game's database, per game. */
  DATABASE_RESTORE_LIMIT?: RateLimit;
  /** Exports a game (game-export.ts) an account starts in a minute: each reads the whole game. */
  EXPORT_LIMIT?: RateLimit;
  /** Script policy violation reports per connection address (security-alerts.ts). */
  CSP_REPORT_LIMIT?: RateLimit;
  ALERTS?: SendEmail;
  /** Cloudflare Email Sending, for players' email codes (email-codes.ts), from EMAIL_FROM on zaisma.com. */
  EMAIL?: SendEmail;
  EMAIL_FROM: string;
  /** Only to send email codes to a stand-in instead (the local preview and tests): each email is POSTed there as JSON. */
  EMAIL_OUTBOX_URL?: string;
  SITE_ORIGIN: string;
  GAME_HOST_MODE: "path" | "subdomain";
  GAME_ORIGIN: string;
  GAME_DOMAIN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Chat checks, report triage and the forum. The game review has its own models, below. */
  AI_MODEL: string;
  /** Report triage's and the forum's monthly cap on AI input tokens. The game review counts in cents (AI_REVIEW_MONTHLY_BUDGET_CENTS). */
  AI_MONTHLY_INPUT_TOKENS: string;
  /** The game review's readers, which list evidence from all the code and pictures (review-readers.ts). */
  REVIEW_READER_MODEL: string;
  /** The game review's judge, which decides from the evidence (review-judge.ts). */
  REVIEW_JUDGE_MODEL: string;
  /** The listing check, which holds covers, screenshots and titles to "No slop" (listing-judge.ts); counts toward the review's budget. */
  LISTING_CHECK_MODEL: string;
  /** The game review's monthly budget in US cents; Julius hears at 80%, and past it versions wait for a person. */
  AI_REVIEW_MONTHLY_BUDGET_CENTS: string;
  /** Chat's own monthly cap on AI input tokens (chat-check.ts), apart from AI_MONTHLY_INPUT_TOKENS. */
  AI_CHAT_MONTHLY_INPUT_TOKENS: string;
  /** The model that reviews sexual messages from adults to teens the chat filter stopped (chat-review.ts). */
  AI_REVIEW_MODEL: string;
  ALERT_FROM: string;
  ALERT_EMAIL?: string;
  /** Pushover, for pushes to Julius's phone (push.ts). Without them an alert is only logged. */
  PUSHOVER_USER_KEY?: string;
  PUSHOVER_APP_TOKEN?: string;
  /** Only to point pushes at a stand-in (tests). */
  PUSHOVER_URL?: string;
  /** Cloudflare's GraphQL Analytics API for the error-spike alert (health-alerts.ts): the account and a token with Account Analytics read. Without them that one alert is off. */
  CLOUDFLARE_ACCOUNT_ID?: string;
  ANALYTICS_API_TOKEN?: string;
  /** Only to point the error-spike query and the outside checker's run list at stand-ins (tests). */
  CLOUDFLARE_GRAPHQL_URL?: string;
  WATCH_RUNS_URL?: string;
  ANTHROPIC_API_KEY?: string;
  VT_API_KEY?: string;
  /** Arachnid Shield's API user, as "username:password". Without it or PhotoDNA, image matching isn't connected and every game waits for a person. */
  ARACHNID_SHIELD_KEY?: string;
  /** Only to point image matching at a stand-in (the local preview). */
  ARACHNID_SHIELD_URL?: string;
  /** Where registered links' sites are checked for malware and phishing: Cloudflare's DNS over HTTPS by default (LINK_CHECK_DNS_URL); tests point it at a stand-in. */
  LINK_CHECK_DNS_URL?: string;
  /** Microsoft's PhotoDNA Cloud Service key. With PHOTODNA, PhotoDNA matches pictures alongside Arachnid Shield. */
  PHOTODNA_KEY?: string;
  /** The photodna Worker (apps/photodna), which hashes pictures with Microsoft's SDK and paces requests to Microsoft. */
  PHOTODNA?: Service<PhotoDnaService>;
  DEV_ADMIN?: string;
  /** Seconds a guest plays with progress before "Keep your progress" shows. Default 300; the local preview uses less. */
  KEEP_OFFER_SECONDS?: string;
  /** How long each place keeps a copy of a game's room list. 10 unless set (tests set 0). */
  ROOM_LIST_CACHE_SECONDS?: string;
  /** How long each place keeps a copy of how many people play each game now. 30 unless set (tests set 0). */
  PLAYING_NOW_CACHE_SECONDS?: string;
  /** Supabase Auth. Without these, accounts are off and everything else still works. */
  SUPABASE_URL?: string;
  /** The only key Supabase answers (its publishable key is off), so every sign-in goes through Zaisma's limits and checks. */
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
