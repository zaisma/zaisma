import type { ScanJob } from "@zaisma/core";
import type { GameDatabaseService } from "../../rooms/src/database.ts";
import type { GameSecretsService } from "../../rooms/src/secrets.ts";
import type { GameServerWebhookService } from "../../rooms/src/game-server.ts";
import type { GameStorageService } from "../../rooms/src/game-storage.ts";
import type { PhotoDnaService } from "../../photodna/src/index.ts";

export interface Env {
  DB: D1Database;
  GAMES: R2Bucket;
  /** Players' cloud saves, kept apart from game files. */
  SAVES: R2Bucket;
  ASSETS: Fetcher;
  SCAN_QUEUE: Queue<ScanJob>;
  /** Every game's own database, in the rooms Worker, for the developer API (game-database.ts). */
  GAME_DATABASES?: Service<GameDatabaseService>;
  /** Every game's secrets, in the rooms Worker, for the developer API (secrets-api.ts). */
  GAME_SECRETS?: Service<GameSecretsService>;
  /** Every game's own game server, in the rooms Worker, for webhooks that send events to it (webhooks.ts). */
  GAME_SERVER_WEBHOOKS?: Service<GameServerWebhookService>;
  /** Deleting a game's database, secrets and game server storage, in the rooms Worker (game-deletion.ts). */
  GAME_STORAGE?: Service<GameStorageService>;
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
  /** The game review's monthly budget in US cents; Julius hears at 80%, and past it versions wait for a person. */
  AI_REVIEW_MONTHLY_BUDGET_CENTS: string;
  /** Chat's own monthly cap on AI input tokens (chat-check.ts), apart from AI_MONTHLY_INPUT_TOKENS. */
  AI_CHAT_MONTHLY_INPUT_TOKENS: string;
  /** The model that reviews sexual messages from adults to teens the chat filter stopped (chat-review.ts). */
  AI_REVIEW_MODEL: string;
  ALERT_FROM: string;
  ALERT_EMAIL?: string;
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
