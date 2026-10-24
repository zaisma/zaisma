import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { build } from "esbuild";
import { defineConfig } from "vitest/config";
import { generateSigningKey } from "./packages/game-server/src/pass.ts";
import { BalancedShardSequencer } from "./test/shards.ts";
// @ts-expect-error: a Node script with no types of its own.
import { memoryCap, waitForTestTurn } from "./scripts/preview/memory.mjs";

// A test run's turn in the line for memory, before any file runs (scripts/preview/memory.mjs): on a Mac, test runs and previews share
// one memory budget across every checkout, and a run that doesn't fit waits in line and starts by itself (npm run test:list shows the
// line). It runs as many files at once as fit, up to TEST_WORKER_COUNT (4 without it): a Workers file's runtime takes about 0.9 GB.
// On GitHub's runners there's no line, and TEST_WORKER_COUNT is the count (2 without it). Listing tests never waits. Vitest reads this
// file once for each project, in the same process, so the run asks once.
const turns = globalThis as { zaismaTestTurn?: Promise<{ workerCount: number }> };
turns.zaismaTestTurn ??= process.argv.includes("list") ? Promise.resolve({ workerCount: 1 }) : waitForTestTurn({ requestedWorkerCount: Number(process.env.TEST_WORKER_COUNT) || (memoryCap().capBytes ? 4 : 2), isNodeOnly: isNodeOnlyRun(process.argv) });
const { workerCount } = await turns.zaismaTestTurn!;

/** Whether this run names only node files (test/node, test/layout) or only those projects, which take far less memory than Workers files. */
function isNodeOnlyRun(argv: string[]): boolean {
  const args = argv.slice(Math.max(0, argv.indexOf("run")) + 1);
  const projects = args.flatMap((arg, i) => (arg.startsWith("--project=") ? [arg.slice("--project=".length)] : args[i - 1] === "--project" ? [arg] : []));
  const files = args.filter((arg, i) => !arg.startsWith("-") && args[i - 1] !== "--project");
  if (projects.length) return projects.every((project) => project === "node" || project === "layout");
  return files.length > 0 && files.every((file) => /^(\.\/)?test\/(node|layout)\//.test(file));
}

// Throwaway pass and receipt signing keys for tests. The real ones are Worker secrets.
const passKey = await generateSigningKey();
const receiptKey = await generateSigningKey();

// The site reaches games' databases in the rooms Worker through a service binding. Its tests get the
// real database code as a second Worker of that name, bundled here (test/site/rooms-database-worker.ts).
const roomsDatabaseBundle = await build({ entryPoints: ["test/site/rooms-database-worker.ts"], bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], external: ["cloudflare:*", "node:*"], write: false });
const roomsDatabaseWorker = {
  name: "zaisma-rooms",
  modules: [{ type: "ESModule" as const, path: "rooms-database-worker.mjs", contents: roomsDatabaseBundle.outputFiles[0]!.text }],
  compatibilityDate: "2026-10-01",
  compatibilityFlags: ["nodejs_compat"],
  durableObjects: { GAME_DATABASES: { className: "GameDatabaseObject", useSQLite: true }, GAME_SECRETS: { className: "GameSecretsObject", useSQLite: true } },
  // The site's own D1, by its ID: a game's database counts its kept rooms (kept_rooms) toward its storage.
  d1Databases: { DB: "bffea7a7-f905-4eaf-84f2-97b1fb6bf932" },
  // Purchases' receipts are signed with the rooms tests' receipt key.
  bindings: { PASS_SIGNING_KEY: passKey, RECEIPT_SIGNING_KEY: receiptKey, ISSUER: "https://rooms.zaisma.test" },
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

// And for the rooms tests, the chat filter's AI step in the site Worker (apps/site/src/chat-check.ts): a
// stand-in that answers by what the message says, so tests can steer it.
const chatCheckWorker = {
  name: "zaisma-site",
  modules: [
    {
      type: "ESModule" as const,
      path: "chat-check-worker.mjs",
      contents: `import { WorkerEntrypoint } from "cloudflare:workers";
export class ChatCheckService extends WorkerEntrypoint {
  checkUnclear({ text, isAdultToMinor }) {
    if (text.includes("[ai down]")) return { verdict: "unchecked" };
    if (text.includes("[ai sexual]") || (isAdultToMinor && text.includes("home alone"))) return { verdict: "blocked", reason: "sexual" };
    return { verdict: "allowed" };
  }
}
export default { fetch: () => new Response("Not found", { status: 404 }) };`,
    },
  ],
  compatibilityDate: "2026-10-01",
};

// What game servers' calls to other servers reach in the rooms tests (apps/rooms/src/outbound.ts): a
// stand-in for the internet that says what it was sent, so tests can check what got through.
const outsideServers = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  // Cloudflare's relay (apps/rooms/src/relay.ts): credentials that name the game they were made for,
  // and its use for a game, 10 MB late yesterday and 30 MB early today.
  if (url.hostname === "rtc.live.cloudflare.com") {
    const asked = (await request.json()) as { ttl: number; customIdentifier: string };
    const turn = ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"];
    return Response.json({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }, { urls: turn, username: `relay-user-${asked.customIdentifier}-${asked.ttl}`, credential: "relay-secret" }] }, { status: 201 });
  }
  if (url.hostname === "api.cloudflare.com" && url.pathname === "/client/v4/graphql") {
    const { variables } = (await request.json()) as { variables: { customIdentifier: string; fromDate: string } };
    const today = new Date().toISOString().slice(0, 10);
    const groups = variables.customIdentifier.endsWith("quiet") ? [] : [{ dimensions: { datetimeHour: `${variables.fromDate}T23:00:00Z` }, sum: { egressBytes: 10_000_000 } }, { dimensions: { datetimeHour: `${today}T01:00:00Z` }, sum: { egressBytes: 30_000_000 } }];
    return Response.json({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: groups }] } }, errors: null });
  }
  if (url.pathname === "/redirect") return new Response(null, { status: 302, headers: { Location: "https://elsewhere.example.test/took-the-redirect" } });
  if (url.pathname === "/claims-refusal") return new Response("{}", { headers: { "Content-Type": "application/json", "zaisma-outside-call-refused": "host_not_allowed" } });
  return Response.json({ host: url.hostname, path: url.pathname, method: request.method, authorization: request.headers.get("authorization") });
};

// What the site Worker's calls to other servers reach in the site tests, so no test waits on the runner's
// network (a DNS lookup can take 5 seconds there). A test that stands in for a server itself (vi.stubGlobal("fetch"))
// answers first; what it passes on lands here.
const siteOutsideServers = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  // Supabase's admin lookup of a user (apps/site/src/auth.ts): an account without an email, as Supabase knows it.
  const userId = url.origin === "https://supabase.test" && request.method === "GET" ? url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/)?.[1] : undefined;
  if (userId) return Response.json({ id: decodeURIComponent(userId), email: `${decodeURIComponent(userId)}@no-mail.zaisma.com` });
  // The email outbox (apps/site/src/email-codes.ts): taken.
  if (url.origin === "https://outbox.test") return Response.json({});
  // Anything else is refused at once, as a server that can't be reached.
  return new Response(`No server at ${url.origin} in the site tests: stand in for it in the test.`, { status: 502 });
};

const migrations = await readD1Migrations("migrations");
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
  // Each file gets a runtime of its own (its own Miniflare, database, buckets and Durable Objects), so files run side by side
  // like the node project's: one file's clean-up can't reach another's data.
  test: {
    name,
    include: [`test/${name}/**/*.test.ts`],
    setupFiles: ["test/apply-migrations.ts"],
    // The text filter's library ships as CommonJS behind a thin ES wrapper; bundle it for the Workers runtime.
    deps: { optimizer: { ssr: { enabled: true, include: ["obscenity"] } } },
    // Vitest runs projects in groups by this, lowest first: load (1) before everything else (2).
    sequence: { groupOrder: 2 },
  },
});

const roomsBindings = {
  ISSUER: "https://rooms.zaisma.test",
  SITE_ORIGIN: "https://zaisma.test",
  GAME_HOST_MODE: "path",
  GAME_ORIGIN: "https://games.zaisma.test",
  GAME_DOMAIN: "",
  PASS_SIGNING_KEY: passKey,
  RECEIPT_SIGNING_KEY: receiptKey,
  ROOM_LIST_CACHE_SECONDS: "0",
  PLAYING_NOW_CACHE_SECONDS: "0",
  // Cloudflare's relay and its analytics answer from the stand-in above.
  TURN_KEY_ID: "turn-key-test",
  TURN_KEY_API_TOKEN: "turn-token-test",
  CLOUDFLARE_ACCOUNT_ID: "account-test",
  RELAY_ANALYTICS_API_TOKEN: "analytics-token-test",
};
const roomsExtra = { outboundService: outsideServers, workers: [chatCheckWorker] };

export default defineConfig({
  test: {
    // GitHub's check runs the tests in four shards: dealt out by each file's cost, not by a hash of its path (test/shards.ts).
    sequence: { sequencer: BalancedShardSequencer },
    // Files at once, across every project: what this run's turn in the line gave it (above). GitHub's runners have 4 cores and 16 GB.
    maxWorkers: workerCount,
    projects: [
      // The self-hosting runner runs on plain Node, outside the Workers runtime.
      // The site's modules load there too, to check its page scripts (test/node/strict-scripts.test.ts), with stand-ins for Workers' email and workers modules.
      { extends: true as const, resolve: { alias: { "cloudflare:email": new URL("test/node/cloudflare-email.ts", import.meta.url).pathname, "cloudflare:workers": new URL("test/node/cloudflare-workers.ts", import.meta.url).pathname } }, test: { name: "node", environment: "node", include: ["test/node/**/*.test.ts"], sequence: { groupOrder: 2 } } },
      // The measuring check in headless Chrome on the preview (scripts/layout-check.mjs): GitHub's check runs it in its own job.
      { extends: true as const, resolve: { alias: { "cloudflare:email": new URL("test/node/cloudflare-email.ts", import.meta.url).pathname, "cloudflare:workers": new URL("test/node/cloudflare-workers.ts", import.meta.url).pathname } }, test: { name: "layout", environment: "node", include: ["test/layout/**/*.test.ts"], sequence: { groupOrder: 2 } } },
      worker("site", "apps/site/wrangler.jsonc", {
        SITE_ORIGIN: "https://zaisma.test",
        GAME_ORIGIN: "https://games.zaisma.test",
        GAME_HOST_MODE: "path",
        GAME_DOMAIN: "",
        ACCESS_TEAM_DOMAIN: "zaisma.cloudflareaccess.com",
        ACCESS_AUD: "test-aud",
        DEV_ADMIN: "1",
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_SECRET_KEY: "sb_secret_test",
        // Email codes go to a stand-in outbox the tests read (test/site/accounts.test.ts), never real email.
        EMAIL_OUTBOX_URL: "https://outbox.test",
        SIGN_IN_SIGNING_KEY: signInKey,
        // Room lists answer from the database every time, so tests see each change at once.
        ROOM_LIST_CACHE_SECONDS: "0",
        PLAYING_NOW_CACHE_SECONDS: "0",
        // Cloudflare's check on Play: tests answer it themselves (test/site/plays.test.ts).
        TURNSTILE_SITE_KEY: "test-site-key",
        TURNSTILE_SECRET: "test-secret",
        // Never the real image matcher, even with its key in .dev.vars: tests bring their own stand-in.
        ARACHNID_SHIELD_KEY: "",
        PHOTODNA_KEY: "",
        // Links' sites are checked with a stand-in for Cloudflare's DNS (test/site/links.test.ts answers it).
        LINK_CHECK_DNS_URL: "https://dns.zaisma.test/dns-query",
        // A Stripe test-mode stand-in: tests answer api.stripe.com themselves (test/site/credit.test.ts), and sign events with this.
        STRIPE_SECRET_KEY: "sk_test_zaisma",
        STRIPE_EVENTS_SECRET: "whsec_test_zaisma",
        STRIPE_PRO_PRICE_ID: "price_test_pro",
        // The receipt key the rooms stand-in signs receipts with, so tests can check them (test/site/items.test.ts).
        TEST_RECEIPT_SIGNING_KEY: receiptKey,
        // Backups go to a stand-in for Backblaze that tests answer themselves (test/site/backups.test.ts).
        BACKUP_ENDPOINT: "https://backups.zaisma.test",
        BACKUP_KEY_ID: "test-backup-key-id",
        BACKUP_KEY_SECRET: "test-backup-key-secret",
      }, {
        // Tests run scans themselves. Wrangler's options are merged one level deep, so the queue's
        // consumer can't be removed; instead uploads send their scan, compress and Chrome jobs, and the cron its backup parts, to queues nothing reads.
        queueProducers: { SCAN_QUEUE: { queueName: "zaisma-scan-in-tests" }, COMPRESS_QUEUE: { queueName: "zaisma-compress-in-tests" }, PERFORMANCE_QUEUE: { queueName: "zaisma-performance-in-tests" }, BACKUP_QUEUE: { queueName: "zaisma-backup-in-tests" } },
        workers: [roomsDatabaseWorker, photoDnaWorker],
        outboundService: siteOutsideServers,
      }),
      worker("games", "apps/games/wrangler.jsonc", { SITE_ORIGIN: "https://zaisma.test", ROOMS_ORIGIN: "https://rooms.zaisma.test", GAME_HOST_MODE: "path", GAME_DOMAIN: "" }),
      worker("core", "apps/games/wrangler.jsonc"),
      worker("game-server", "apps/games/wrangler.jsonc"),
      worker("rooms", "apps/rooms/wrangler.jsonc", roomsBindings, roomsExtra),
      // Files that measure how fast something runs (a full room at full speed, with its players in Node and the room in a Miniflare of
      // its own): a group of their own that vitest runs before every other file starts, one at a time, so they have the machine to
      // themselves (ALONE_TEST_FILES in test/shards.ts).
      { extends: true as const, test: { name: "load", environment: "node", include: ["test/load/**/*.test.ts"], fileParallelism: false, sequence: { groupOrder: 1 } } },
    ],
  },
});
