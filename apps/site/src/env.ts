import type { ScanJob } from "@zaisma/core";

export interface Env {
  DB: D1Database;
  GAMES: R2Bucket;
  ASSETS: Fetcher;
  SCAN_QUEUE: Queue<ScanJob>;
  REPORT_LIMIT?: RateLimit;
  SIGNIN_LIMIT?: RateLimit;
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
  DEV_ADMIN?: string;
  /** Supabase Auth. Without these, accounts are off and everything else still works. */
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  /** Only for deleting sign-ins (account deletion, under-13s). */
  SUPABASE_SECRET_KEY?: string;
}

export function gameUrl(env: Env, slug: string): string {
  return env.GAME_HOST_MODE === "subdomain" && env.GAME_DOMAIN ? `https://${slug}.${env.GAME_DOMAIN}/` : `${env.GAME_ORIGIN}/${slug}/`;
}

export function gameFrameSource(env: Env): string {
  return env.GAME_HOST_MODE === "subdomain" && env.GAME_DOMAIN ? `https://*.${env.GAME_DOMAIN}` : env.GAME_ORIGIN;
}
