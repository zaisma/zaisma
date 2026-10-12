import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("migrations");

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
  test: { name, include: [`test/${name}/**/*.test.ts`], setupFiles: ["test/apply-migrations.ts"] },
});

export default defineConfig({
  test: {
    projects: [
      worker("site", "apps/site/wrangler.jsonc", {
        SITE_ORIGIN: "https://zaisma.test",
        GAME_ORIGIN: "https://games.zaisma.test",
        GAME_HOST_MODE: "path",
        GAME_DOMAIN: "",
        ACCESS_TEAM_DOMAIN: "zaisma.cloudflareaccess.com",
        ACCESS_AUD: "test-aud",
        DEV_ADMIN: "1",
      }),
      worker("games", "apps/games/wrangler.jsonc", { SITE_ORIGIN: "https://zaisma.test", GAME_HOST_MODE: "path", GAME_DOMAIN: "" }),
      worker("core", "apps/games/wrangler.jsonc"),
    ],
  },
});
