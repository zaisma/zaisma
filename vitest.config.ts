import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { generateSigningKey } from "./packages/game-server/src/pass.ts";

const migrations = await readD1Migrations("migrations");
// A throwaway pass signing key for tests. The real one is a Worker secret.
const passKey = await generateSigningKey();

const worker = (name: string, configPath: string, extraBindings: Record<string, string> = {}) => ({
  extends: true as const,
  plugins: [
    cloudflareTest({
      wrangler: { configPath },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations as unknown as string, ...extraBindings },
        // Tests run scans themselves, so turn off the automatic queue consumer.
        queueConsumers: {},
      },
    }),
  ],
  // Files share one database, so they run one after another: one file's clean-up can't wipe another's data mid-test.
  test: { name, include: [`test/${name}/**/*.test.ts`], setupFiles: ["test/apply-migrations.ts"], fileParallelism: false },
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
      }),
    ],
  },
});
