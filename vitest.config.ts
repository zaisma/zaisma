import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { build } from "esbuild";
import { defineConfig } from "vitest/config";
import { generateSigningKey } from "./packages/game-server/src/pass.ts";

// The site reaches games' databases in the rooms Worker through a service binding. Its tests get the
// real database code as a second Worker of that name, bundled here (test/site/rooms-database-worker.ts).
const roomsDatabaseBundle = await build({ entryPoints: ["test/site/rooms-database-worker.ts"], bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], external: ["cloudflare:*", "node:*"], write: false });
const roomsDatabaseWorker = {
  name: "zaisma-rooms",
  modules: [{ type: "ESModule" as const, path: "rooms-database-worker.mjs", contents: roomsDatabaseBundle.outputFiles[0]!.text }],
  compatibilityDate: "2026-10-01",
  compatibilityFlags: ["nodejs_compat"],
  durableObjects: { GAME_DATABASES: { className: "GameDatabaseObject", useSQLite: true } },
};

// And PhotoDNA matching in the photodna Worker (its container can't run in tests): a stand-in that's always down.
const photoDnaWorker = {
  name: "zaisma-photodna",
  modules: [
    {
      type: "ESModule" as const,
      path: "photodna-worker.mjs",
      contents: `import { WorkerEntrypoint } from "cloudflare:workers";
export class PhotoDnaService extends WorkerEntrypoint {
  hash() { return { kind: "down", why: "no hasher in tests" }; }
  match() { return { kind: "down", why: "no PhotoDNA in tests" }; }
}
export default { fetch: () => new Response("Not found", { status: 404 }) };`,
    },
  ],
  compatibilityDate: "2026-10-01",
};

const migrations = await readD1Migrations("migrations");
// A throwaway pass signing key for tests. The real one is a Worker secret.
const passKey = await generateSigningKey();
// And one for Sign in with Zaisma's tokens (scripts/sign-in-key.mjs makes the real one).
const signInPair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const signInKey = JSON.stringify(await crypto.subtle.exportKey("jwk", signInPair.privateKey));

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
        SIGN_IN_SIGNING_KEY: signInKey,
        // Room lists answer from the database every time, so tests see each change at once.
        ROOM_LIST_CACHE_SECONDS: "0",
        // Cloudflare's check on Play: tests answer it themselves (test/site/plays.test.ts).
        TURNSTILE_SITE_KEY: "test-site-key",
        TURNSTILE_SECRET: "test-secret",
        // Never the real image matcher, even with its key in .dev.vars: tests bring their own stand-in.
        ARACHNID_SHIELD_KEY: "",
        PHOTODNA_KEY: "",
      }, {
        // Tests run scans themselves. Wrangler's options are merged one level deep, so the queue's
        // consumer can't be removed; instead uploads send their scan jobs to a queue nothing reads.
        queueProducers: { SCAN_QUEUE: { queueName: "zaisma-scan-in-tests" } },
        workers: [roomsDatabaseWorker, photoDnaWorker],
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
