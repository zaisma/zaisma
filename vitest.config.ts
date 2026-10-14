import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { generateSigningKey } from "./packages/game-server/src/pass.ts";

const migrations = await readD1Migrations("migrations");
// A throwaway pass signing key for tests. The real one is a Worker secret.
const passKey = await generateSigningKey();

const worker = (name: string, configPath: string, extraBindings: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
  extends: true as const,
  plugins: [
    cloudflareTest({
      wrangler: { configPath },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations as unknown as string, ...extraBindings },
        ...extra,
      },
    }),
  ],
  // Files share one database, so they run one after another: one file's clean-up can't wipe another's data mid-test.
  test: {
    name,
    include: [`test/${name}/**/*.test.ts`],
    setupFiles: ["test/apply-migrations.ts"],
    fileParallelism: false,
    // The text filter's library ships as CommonJS behind a thin ES wrapper; bundle it for the Workers runtime.
    deps: { optimizer: { ssr: { enabled: true, include: ["obscenity"] } } },
  },
});

export default defineConfig({
  test: {
    projects: [
      // The self-hosting runner runs on plain Node, outside the Workers runtime.
      { extends: true as const, test: { name: "node", environment: "node", include: ["test/node/**/*.test.ts"] } },
      worker("site", "apps/site/wrangler.jsonc", {
        SITE_ORIGIN: "https://zaisma.test",
        GAME_ORIGIN: "https://games.zaisma.test",
        GAME_HOST_MODE: "path",
        GAME_DOMAIN: "",
        ACCESS_TEAM_DOMAIN: "zaisma.cloudflareaccess.com",
        ACCESS_AUD: "test-aud",
        DEV_ADMIN: "1",
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        SUPABASE_SECRET_KEY: "sb_secret_test",
        // Room lists answer from the database every time, so tests see each change at once.
        ROOM_LIST_CACHE_SECONDS: "0",
        // Cloudflare's check on Play: tests answer it themselves (test/site/plays.test.ts).
        TURNSTILE_SITE_KEY: "test-site-key",
        TURNSTILE_SECRET: "test-secret",
        // Never the real image matcher, even with its key in .dev.vars: tests bring their own stand-in.
        ARACHNID_SHIELD_KEY: "",
      }, {
        // Tests run scans themselves. Wrangler's options are merged one level deep, so the queue's
        // consumer can't be removed; instead uploads send their scan jobs to a queue nothing reads.
        queueProducers: { SCAN_QUEUE: { queueName: "zaisma-scan-in-tests" } },
      }),
      worker("games", "apps/games/wrangler.jsonc", { SITE_ORIGIN: "https://zaisma.test", ROOMS_ORIGIN: "https://rooms.zaisma.test", GAME_HOST_MODE: "path", GAME_DOMAIN: "" }),
      worker("core", "apps/games/wrangler.jsonc"),
      worker("game-server", "apps/games/wrangler.jsonc"),
      worker("rooms", "apps/rooms/wrangler.jsonc", {
        ISSUER: "https://rooms.zaisma.test",
        SITE_ORIGIN: "https://zaisma.test",
        GAME_HOST_MODE: "path",
        GAME_ORIGIN: "https://games.zaisma.test",
        GAME_DOMAIN: "",
        PASS_SIGNING_KEY: passKey,
        ROOM_LIST_CACHE_SECONDS: "0",
      }),
    ],
  },
});
