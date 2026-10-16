#!/usr/bin/env node
// Local preview: the whole site (site, games, stand-in sign-in) with test games, so changes can be
// tried and iterated on before anything goes live. Run: npm run preview (add --reset for fresh data).
// Uses its own data folder and ports, so it never touches your dev data or the live site.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { transformSync } from "esbuild";
import { startFakeAuth } from "./fake-auth.mjs";
import { LATER_MARKER, MATCH_MARKER } from "./fake-shield.mjs";
import { openTestRooms, pretendRoomsSql } from "./test-rooms.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STATE = join(ROOT, ".wrangler/preview");
// PREVIEW_PORT_OFFSET=100 moves every port up (site on 8900), for a second checkout while another runs its preview.
const OFFSET = Number(process.env.PREVIEW_PORT_OFFSET) || 0;
const PORTS = { site: 8800 + OFFSET, games: 8801 + OFFSET, rooms: 8802 + OFFSET, auth: 8790 + OFFSET, ai: 8791 + OFFSET, shield: 8792 + OFFSET };
const SITE = `http://localhost:${PORTS.site}`;
const GAMES = `http://localhost:${PORTS.games}`;
const ROOMS = `http://localhost:${PORTS.rooms}`;
const EMAIL = "preview@zaisma.test";

if (process.argv.includes("--reset")) rmSync(STATE, { recursive: true, force: true });
const fresh = !existsSync(join(STATE, "seeded"));
mkdirSync(STATE, { recursive: true });

// Settings for the preview only. --env-file replaces .dev.vars, so your own settings stay out of it.
writeFileSync(
  join(STATE, "site.env"),
  [`SITE_ORIGIN=${SITE}`, `GAME_ORIGIN=${GAMES}`, "GAME_HOST_MODE=path", "GAME_DOMAIN=", "DEV_ADMIN=1", `SUPABASE_URL=http://localhost:${PORTS.auth}`, "SUPABASE_PUBLISHABLE_KEY=preview", "SUPABASE_SECRET_KEY=preview", "KEEP_OFFER_SECONDS=20",
    // Scans and report triage ask a stand-in AI (fake-ai.mjs): no real key, no cost.
    "ANTHROPIC_API_KEY=preview", `ANTHROPIC_BASE_URL=http://localhost:${PORTS.ai}`,
    // Image matching asks a stand-in Arachnid Shield (fake-shield.mjs) that only matches marked test pictures.
    "ARACHNID_SHIELD_KEY=preview:preview", `ARACHNID_SHIELD_URL=http://localhost:${PORTS.shield}`,
    // Cloudflare's published test keys for its check on Play: invisible, and every browser passes.
    "TURNSTILE_SITE_KEY=1x00000000000000000000BB", "TURNSTILE_SECRET=1x0000000000000000000000000000000AA", ""].join("\n"),
);
writeFileSync(join(STATE, "games.env"), [`SITE_ORIGIN=${SITE}`, "GAME_HOST_MODE=path", "GAME_DOMAIN=", `ROOMS_ORIGIN=${ROOMS}`, ""].join("\n"));
// Multiplayer rooms, with their own pass signing key kept between runs so passes stay valid.
const passKeyFile = join(STATE, "rooms-key.json");
if (!existsSync(passKeyFile)) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const { kty, crv, x, d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  writeFileSync(passKeyFile, JSON.stringify({ kty, crv, x, d }));
}
writeFileSync(
  join(STATE, "rooms.env"),
  [`ISSUER=${ROOMS}`, `SITE_ORIGIN=${SITE}`, "GAME_HOST_MODE=path", `GAME_ORIGIN=${GAMES}`, "GAME_DOMAIN=", `PASS_SIGNING_KEY='${readFileSync(passKeyFile, "utf8")}'`, ""].join("\n"),
);

const children = [];
const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// Also when set-up fails, so nothing is left running.
process.on("exit", () => children.forEach((c) => c.kill()));

function wrangler(app, args, opts = {}) {
  // Quiet servers write to <app>.log in the preview folder, for when something doesn't start.
  const log = opts.quiet ? openSync(join(STATE, `${app}.log`), "w") : "inherit";
  return spawn("npx", ["wrangler", ...args], { cwd: join(ROOT, "apps", app), stdio: ["ignore", log, log], env: { ...process.env, FORCE_COLOR: "0" } });
}

// The three servers share one database file, and local D1 fails straight away when another server
// has it locked. Each runs its Worker through scripts/preview/workers/<app>.mjs, which tries such
// calls again; the Workers themselves, and production, are unchanged.
// Wrangler looks for its config beside the entry it's given, so it's named too.
const dev = (app) => ["dev", join(ROOT, "scripts/preview/workers", `${app}.mjs`), "--config", join(ROOT, "apps", app, "wrangler.jsonc")];

async function waitFor(url) {
  for (let i = 0; i < 240; i++) {
    try {
      await fetch(url, { redirect: "manual" });
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} didn't start. Is something else using its port? Its output is in ${STATE}.`);
}

await startFakeAuth(PORTS.auth, join(STATE, "auth-key.json")).catch(() => console.log(`Sign-in stand-in already running on ${PORTS.auth}.`));
children.push(spawn("node", [join(ROOT, "scripts/preview/fake-ai.mjs"), String(PORTS.ai)], { stdio: "ignore" }));
children.push(spawn("node", [join(ROOT, "scripts/preview/fake-shield.mjs"), String(PORTS.shield), STATE], { stdio: "ignore" }));
console.log("Applying database updates…");
spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "zaisma", "--local", "--persist-to", STATE], { cwd: join(ROOT, "apps/site"), stdio: "ignore", env: { ...process.env, CI: "1" } });
// One at a time: they share the preview's database, and starting together can find it locked.
children.push(wrangler("games", [...dev("games"), "--port", String(PORTS.games), "--inspector-port", String(9341 + OFFSET), "--persist-to", STATE, "--env-file", join(STATE, "games.env")], { quiet: true }));
await waitFor(GAMES);
children.push(wrangler("site", [...dev("site"), "--port", String(PORTS.site), "--inspector-port", String(9340 + OFFSET), "--local-upstream", `localhost:${PORTS.site}`, "--persist-to", STATE, "--env-file", join(STATE, "site.env"), "--test-scheduled"], { quiet: true }));
await waitFor(SITE);
children.push(wrangler("rooms", [...dev("rooms"), "--port", String(PORTS.rooms), "--inspector-port", String(9342 + OFFSET), "--persist-to", STATE, "--env-file", join(STATE, "rooms.env")], { quiet: true }));
await waitFor(ROOMS);
if (fresh) {
  console.log("Adding test games…");
  await seed();
  writeFileSync(join(STATE, "seeded"), new Date().toISOString());
}
// Arena runs its own game server (the zaisma-server.js in its upload) in a sandbox, like an outside
// developer's game would; Four in a Row uses the copy built into our rooms.
// The two multiplayer demos run on our rooms (also for preview data made before rooms were in the preview).
// Cave Crew uses the relay, to show closed and hidden rooms. Rooms from the last run are gone.
spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "zaisma", "--local", "--persist-to", STATE, "--command",
    "UPDATE games SET multiplayer_mode = 'own' WHERE slug = 'arena'; UPDATE games SET multiplayer_mode = 'built-in', built_in_server = slug WHERE slug = 'four-in-a-row' AND multiplayer_mode = 'none'; UPDATE games SET multiplayer_mode = 'relay' WHERE slug = 'cave-crew' AND multiplayer_mode = 'none'; DELETE FROM live_rooms"],
  { cwd: join(ROOT, "apps/site"), stdio: "ignore", env: { ...process.env, CI: "1" } },
);
// Pretend play stats for two games, so the dashboard's Plays section has something to show. Real
// presses of Play in the preview add to them.
spawnSync("npx", ["wrangler", "d1", "execute", "zaisma", "--local", "--persist-to", STATE, "--command", pretendPlaysSql()], { cwd: join(ROOT, "apps/site"), stdio: "ignore", env: { ...process.env, CI: "1" } });
// Test players keep a few rooms open, so the Rooms tab has something in it. Cave Crew also lists
// pretend rooms from around the world, kept fresh every half hour (without blocking the test players).
await openTestRooms(ROOMS, GAMES, SITE).catch((err) => console.log(`Couldn't open the test rooms: ${err.message}`));
const pretend = () => spawn("npx", ["wrangler", "d1", "execute", "zaisma", "--local", "--persist-to", STATE, "--command", pretendRoomsSql()], { cwd: join(ROOT, "apps/site"), stdio: "ignore", env: { ...process.env, CI: "1" } });
pretend();
setInterval(pretend, 30 * 60_000);

// The site's every-5-minutes job (scheduled publishing, report triage), run every 20 seconds here.
const tick = () => fetch(`${SITE}/__scheduled?cron=${encodeURIComponent("*/5 * * * *")}`).catch(() => {});
setInterval(tick, 20_000);
tick();

let testers = {};
try {
  testers = JSON.parse(readFileSync(join(STATE, "testers.json"), "utf8"));
} catch {}
console.log(`
Zaisma preview is running. Nothing here touches the live site.

  Home            ${SITE}/
  A game page     ${SITE}/g/shard-dodge
  Multiplayer     ${SITE}/g/arena  (open it in two windows to play together)
  Rooms           ${SITE}/g/arena#rooms  and  ${SITE}/g/cave-crew#rooms  (Cave Crew's are mostly pretend, from around the world)
  Tester links    ${testers.secret ?? "(npm run preview -- --reset to make them)"}  (Rocket Lab, a private game)
                  ${testers.arena ?? ""}  (Arena, to try multiplayer through one)
  Your games      ${SITE}/dashboard
  Admin           ${SITE}/admin
  Report queue    ${SITE}/admin/reports
  Forum           ${SITE}/forum  (topics, known issues, a topic: ${SITE}/forum?tab=known)
  Admin feedback  ${SITE}/admin/feedback
  Image matching  ${SITE}/admin  (Night Drive's update is held: a picture renamed .dat, a video and a picture
                  written into its code matched known abuse material, in the stand-in. Cave Crew's history
                  shows a screenshot refused the same way. Pixel Garden passed before matching knew its
                  picture; the daily check found it and hid the game.)

Sign in with any email and the code 123456. ${EMAIL} owns the test games.
Stop with Ctrl+C. Fresh data: npm run preview -- --reset
`);

// --- Test data, made through the same pages and API that people use ---

/** A game folder with its game server beside it as zaisma-server.js (types stripped), like a developer would upload. */
function withServer(example, name) {
  const out = join(STATE, "uploads", name);
  rmSync(out, { recursive: true, force: true });
  cpSync(join(ROOT, example, "game"), out, { recursive: true });
  const code = transformSync(readFileSync(join(ROOT, example, "server.ts"), "utf8"), { loader: "ts", format: "esm" }).code;
  // In the preview, players who walk away are quick to try: "Still there?" after a minute, seats held for two.
  const quick = code.replace(/export\s*\{\s*(\w+) as default\s*\};?\s*$/, "export default { ...$1, idleTimeoutSec: 60, seatHoldDurationSec: 120 };");
  if (quick === code) throw new Error(`Couldn't give the preview's ${name} game server quick away settings`);
  writeFileSync(join(out, "zaisma-server.js"), quick);
  return out;
}

async function seed() {
  const jar = new Map();
  const go = async (path, init = {}) => {
    const res = await fetch(SITE + path, {
      ...init,
      redirect: "manual",
      headers: { origin: SITE, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(init.headers ?? {}) },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split("; ");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
  const form = (data) => ({ method: "POST", body: new URLSearchParams(data) });

  // A developer account with an API key.
  await go("/join/age", form({ month: "5", day: "20", year: "1990" }));
  await go("/join/email", form({ name: "Preview Studio", email: EMAIL }));
  await go("/signin/code", form({ email: EMAIL, code: "123456" }));
  const page = await (await go("/account/keys", form({ name: "preview" }))).text();
  const key = page.match(/zsk_[a-z0-9]+_[A-Za-z0-9_-]+/)?.[0];
  if (!key) throw new Error("Couldn't make the preview account's API key.");
  const api = async (method, path, body) => {
    const raw = body instanceof Uint8Array;
    const res = await fetch(`${SITE}/api/dev${path}`, { method, headers: { authorization: `Bearer ${key}`, ...(body && !raw ? { "content-type": "application/json" } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${data.error?.message}`);
    return data;
  };
  const upload = (folder, slug, notes) =>
    spawnSync("node", [join(ROOT, "packages/cli/zaisma.mjs"), "upload", resolve(ROOT, folder), "--game", slug, "--patch-notes", notes], {
      env: { ...process.env, ZAISMA_API: SITE, ZAISMA_KEY: key },
      stdio: "ignore",
    });
  // Scans may still be running: approve as admin so the test data is ready at once.
  const approveNewest = async (slug) => {
    const { versions } = await api("GET", `/games/${slug}`);
    await go(`/admin/versions/${versions[0].id}/approve`, form({ reason: "Preview test data" }));
    return versions[0].id;
  };

  const games = [
    { title: "Shard Dodge", folder: "examples/hello-game", color: [70, 140, 220], description: "Dodge the falling shards for as long as you can. Arrow keys, mouse or finger.", devices: ["phone", "tablet", "computer"], controls: ["touch", "keyboard_mouse"], play_modes: [{ mode: "single" }] },
    { title: "Arena", folder: withServer("examples/arena", "arena"), color: [150, 70, 160], description: "Bump your friends off the platform. Last one standing wins the round.", devices: ["computer"], controls: ["keyboard_mouse", "gamepad"], play_modes: [{ mode: "local", minimum_player_count: 2, maximum_player_count: 4, play_style: "versus" }, { mode: "online", minimum_player_count: 2, maximum_player_count: 8, play_style: "versus" }] },
    { title: "Four in a Row", folder: "examples/four-in-a-row/game", color: [200, 140, 50], description: "The classic: drop your pieces and line up four before your friend does.", devices: ["phone", "tablet", "computer"], controls: ["touch", "keyboard_mouse"], play_modes: [{ mode: "local", minimum_player_count: 2, maximum_player_count: 2, play_style: "versus" }, { mode: "online", minimum_player_count: 2, maximum_player_count: 2, play_style: "versus" }] },
    { title: "Night Drive", folder: "examples/hello-game", color: [40, 50, 90], description: "", devices: [], controls: [] },
    { title: "Tiny Farm", folder: "scripts/preview/tiny-farm", color: [90, 140, 60], description: "Harvest carrots. It saves like a Unity game does (in IndexedDB), to try cloud saves.", devices: ["phone", "tablet", "computer"], controls: ["touch", "keyboard_mouse"], play_modes: [{ mode: "single" }] },
    { title: "Cave Crew", folder: "examples/hello-game", color: [60, 120, 90], description: "Dig, build and explore together. Bring the whole crew.", devices: ["computer"], controls: ["keyboard_mouse", "gamepad"], play_modes: [{ mode: "single" }, { mode: "local", minimum_player_count: 2, maximum_player_count: 4, play_style: "co-op" }, { mode: "online", minimum_player_count: 2, maximum_player_count: null, play_style: "co-op" }] },
  ];
  for (const g of games) {
    const { game } = await api("POST", "/games", { title: g.title, description: g.description, devices: g.devices, controls: g.controls, ...(g.play_modes ? { play_modes: g.play_modes } : {}) });
    upload(g.folder, game.slug, "First version.");
    await api("POST", `/games/${game.slug}/versions/${await approveNewest(game.slug)}/publish`);
    await api("PATCH", `/games/${game.slug}`, { visibility: "listed" });
    // Covers carry the game's name in the studio's own lettering, as real ones do (covers/, made once
    // from these pictures). Night Drive has none, to show the card a game without a cover gets.
    if (g.title !== "Night Drive") {
      const titled = join(ROOT, "scripts/preview/covers", `${game.slug}.png`);
      const { image } = await api("POST", `/games/${game.slug}/images?kind=cover`, existsSync(titled) ? new Uint8Array(readFileSync(titled)) : picture(g.color, 0));
      await go(`/admin/images/${image.id}/approve`, form({ reason: "" }));
      // Some also have a square cover, which phones show; the rest show their landscape one whole.
      const square = join(ROOT, "scripts/preview/covers", `${game.slug}-square.png`);
      if (existsSync(square)) {
        const { image: sq } = await api("POST", `/games/${game.slug}/images?kind=square`, new Uint8Array(readFileSync(square)));
        await go(`/admin/images/${sq.id}/approve`, form({ reason: "" }));
      }
    }
  }
  // Screenshots and a second version with patch notes, so the game page has everything.
  for (const n of [1, 2]) {
    const { image } = await api("POST", "/games/shard-dodge/images?kind=screenshot", picture([70, 140, 220], n));
    await go(`/admin/images/${image.id}/approve`, form({ reason: "" }));
  }
  upload("examples/hello-game", "shard-dodge", "New night level, faster hops and a fix for the double-jump bug.");
  await api("POST", `/games/shard-dodge/versions/${await approveNewest("shard-dodge")}/publish`);

  // Image matching: an update with a picture the stand-in Arachnid Shield matches, held for a person
  // (the game stays on its first version), and a screenshot it refuses. Both are harmless test pictures.
  // The matched files hide: a picture renamed .dat, a video, and a picture written into the code as base64.
  const flagged = join(STATE, "uploads", "night-drive-v2");
  rmSync(flagged, { recursive: true, force: true });
  cpSync(join(ROOT, "examples/hello-game"), flagged, { recursive: true });
  mkdirSync(join(flagged, "art"), { recursive: true });
  mkdirSync(join(flagged, "data"), { recursive: true });
  writeFileSync(join(flagged, "art", "sky.png"), picture([40, 50, 90], 0));
  writeFileSync(join(flagged, "data", "stars.dat"), picture([40, 50, 90], 1, MATCH_MARKER));
  writeFileSync(join(flagged, "art", "intro.mp4"), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftypisom\0\0\x02\0${MATCH_MARKER}`, "latin1")]));
  writeFileSync(join(flagged, "moon.js"), `// The moon, drawn from a picture in the code.\nconst moon = "data:image/png;base64,${Buffer.from(picture([200, 200, 220], 2, MATCH_MARKER)).toString("base64")}";\n`);
  upload(flagged, "night-drive", "A starry sky.");
  await api("POST", "/games/cave-crew/images?kind=screenshot", picture([60, 120, 90], 2, MATCH_MARKER)).catch(() => {});

  // A game that passed before image matching was connected, with a picture the stand-in only learns
  // about later: the daily check (run once here) matches it and hides the game.
  const { game: garden } = await api("POST", "/games", { title: "Pixel Garden", description: "Grow a tiny garden, one pixel at a time.", devices: ["computer"], controls: ["keyboard_mouse"], play_modes: [{ mode: "single" }] });
  const gardenFolder = join(STATE, "uploads", "pixel-garden");
  rmSync(gardenFolder, { recursive: true, force: true });
  cpSync(join(ROOT, "examples/hello-game"), gardenFolder, { recursive: true });
  writeFileSync(join(gardenFolder, "flowers.png"), picture([90, 160, 90], 1, LATER_MARKER));
  upload(gardenFolder, garden.slug, "First version.");
  let gardenVersion;
  for (let i = 0; i < 60; i++) {
    gardenVersion = (await api("GET", `/games/${garden.slug}`)).versions[0];
    if (gardenVersion.scan_status !== "scanning") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (gardenVersion.scan_status !== "approved") await go(`/admin/versions/${gardenVersion.id}/approve`, form({ reason: "Preview test data" }));
  await api("POST", `/games/${garden.slug}/versions/${gardenVersion.id}/publish`);
  await api("PATCH", `/games/${garden.slug}`, { visibility: "unlisted" });
  spawnSync("npx", ["wrangler", "d1", "execute", "zaisma", "--local", "--persist-to", STATE, "--command", `UPDATE versions SET scan_report = json_set(scan_report, '$.images.is_connected', json('false')) WHERE id = '${gardenVersion.id}'`], { cwd: join(ROOT, "apps/site"), stdio: "ignore", env: { ...process.env, CI: "1" } });
  writeFileSync(join(STATE, "shield-knows-later"), "");
  await fetch(`${SITE}/__scheduled?cron=${encodeURIComponent("17 3 * * *")}`);

  // Reports for the report queue, sent like the plate beside a game sends them. The stand-in AI sorts them within half a minute.
  const reports = [
    ["shard-dodge", { reason: "broken", details: "Freezes when I double jump on the night level" }],
    ["shard-dodge", { reason: "other", details: "stuck after a double jump on the night level, can't move" }],
    ["night-drive", { reason: "other", details: "it asks for my steam login to unlock level 2" }],
    ["cave-crew", { reason: "sexual", details: "naked characters in the second cave" }],
    ["arena", { reason: "harassment", room: "ABCDEF", player: { id: "player_preview000000001", name: "Swift Fox 42" }, details: "keeps following me and spamming insults" }],
    ["arena", { reason: "harassment", room: "ABCDEF", player: { id: "player_preview000000001", name: "Swift Fox 42" }, details: "same player again, won't leave me alone" }],
    ["four-in-a-row", { reason: "other", details: "boring, my friend always wins" }],
  ];
  for (const [i, [slug, body]] of reports.entries()) {
    await fetch(`${SITE}/g/${slug}/report`, { method: "POST", headers: { "content-type": "application/json", origin: SITE, "cf-connecting-ip": `192.0.2.${i + 1}` }, body: JSON.stringify(body) });
  }

  // A private game that only opens through tester links, and a tester link for Arena to try multiplayer through one.
  const { game: secret } = await api("POST", "/games", { title: "Rocket Lab", description: "Build a rocket from scrap and see how high it goes. Still in testing.", devices: ["computer"], controls: ["keyboard_mouse"], play_modes: [{ mode: "single" }] });
  upload("examples/hello-game", secret.slug, "First test build.");
  await api("POST", `/games/${secret.slug}/versions/${await approveNewest(secret.slug)}/publish`);
  await api("PATCH", `/games/${secret.slug}`, { visibility: "private" });
  const { tester } = await api("POST", `/games/${secret.slug}/testers`, { name: "Playtesters" });
  await api("POST", `/games/${secret.slug}/testers`, { name: "My team" });
  const { tester: arena } = await api("POST", "/games/arena/testers", { name: "Streamer" });
  writeFileSync(join(STATE, "testers.json"), JSON.stringify({ secret: tester.link_url, arena: arena.link_url }));

  // The developer forum, as it might look a few weeks in: developers and their AI posting ideas,
  // questions and discussions, bugs sent to Zaisma privately, known issues, answers and Me too.
  await seedForum(api, go, form);
}

/**
 * Forum test data. Everything goes through the API and admin pages, then the times are spread over
 * the last three weeks (in order), so the lists read like a forum that's been running a while.
 */
async function seedForum(you, go, form) {
  const start = Date.now();
  const names = ["Pixel Forge", "Bramble Studio", "Lumen Works", "Tiny Rocket", "Coral Arcade", "Quiet Owl", "Hexa Labs", "Other Studio"];
  const dev = {};
  for (const name of names) dev[name] = await developer(name, `${name.toLowerCase().replace(/[^a-z]+/g, "-")}@zaisma.test`);
  const me = "developer";
  const topic = async (who, body) => (await who("POST", "/forum", body)).topic;
  const reply = async (who, id, text, extra = {}) => (await who("POST", `/forum/${id}/posts`, { text_markdown: text, ...extra })).post;
  const meToo = async (id, ...who) => {
    for (const w of who) await w("POST", `/forum/${id}/vote`);
  };
  const zaisma = (id, fields) => go(`/admin/feedback/${id}/decide`, form(fields));
  const zaismaPostId = async (who, id) => (await who("GET", `/forum/${id}`)).posts.filter((post) => post.author.kind === "zaisma").at(-1)?.id;
  const { "Pixel Forge": pf, "Bramble Studio": bs, "Lumen Works": lw, "Tiny Rocket": tr, "Coral Arcade": ca, "Quiet Owl": qo, "Hexa Labs": hl, "Other Studio": os } = dev;

  // A rooms bug, sent privately, that Zaisma makes a public known issue; others hit it too.
  const { topic: roomsBug } = await os("POST", "/forum", { is_public: false, kind: "bug", author_kind: me, category: "rooms", title: "Rooms disconnect everyone when the 50th player joins", text_markdown: "Every time a room reaches 50 players, every player in it is disconnected at once. Under 50 it's fine." });
  await zaisma(roomsBug.id, { is_known_issue: "1", known_issue_title: "Rooms drop every player at 50", workaround: "Cap rooms at 40 players for now: maximumPlayerCount: 40 on your game server.", roadmap_item: "Multiplayer", topic_status: "known", severity: "high", category: "rooms", reply: "Thanks, we can see it happening. We've made it a known issue so others find the workaround." });
  const known = (await you("GET", "/forum?tab=known")).topics;
  const roomsKnown = known.find((k) => k.title === "Rooms drop every player at 50").id;
  await meToo(roomsKnown, pf, lw, ca);
  await reply(pf, roomsKnown, "Same here with a 64-player lobby. Capping at 40 works for now, thanks.", { author_kind: me });
  await reply(lw, roomsKnown, "Happens on our relay rooms too, not only Zaisma's own rooms. Logs show the drop right as player 50's pass is checked.", { author_kind: "ai" });

  // Ideas.
  const bigRooms = await topic(pf, { kind: "feature", author_kind: me, category: "rooms", tags: ["performance"], title: "Let rooms hold more than 50 players", text_markdown: "Battle-royale style games need 80 to 100 players in one room. Could the limit be raised, maybe with a cost per room above 50?" });
  await meToo(bigRooms.id, bs, lw, tr, ca, hl);
  const r1 = await reply(lw, bigRooms.id, "+1. Even 64 would cover most of what we make.");
  await reply(tr, bigRooms.id, "Would you pay per room, or per player-hour? Per player-hour feels fairer for small rooms.", { reply_to_post_id: r1.id, author_kind: "developer" });
  await zaisma(bigRooms.id, { reply: "We're looking at this with the multiplayer work. The 50 cap comes from how a room's messages fan out; a bigger tier would cost more per room, and we'd show the price up front.", topic_status: "planned", category: "rooms" });

  const scanTool = await topic(lw, { kind: "feature", category: "mcp", tags: ["ai-made"], title: "An MCP tool that shows every finding in a held version", text_markdown: "get_version shows that a version was held and the first finding. When there are several, the AI fixes one, uploads, waits for the scan, and finds the next. Showing all of them at once would save a lot of round trips." });
  await meToo(scanTool.id, pf, qo, you);
  await reply(qo, scanTool.id, "Yes please. My AI went through four uploads last week for three small findings.", { author_kind: me });

  const webhook = await topic(hl, { kind: "feature", author_kind: me, category: "api", title: "A webhook when a scan finishes", text_markdown: "Our CI uploads with the upload command and then polls get_version. A webhook (or a wait flag on the upload command) would be cleaner." });
  await meToo(webhook.id, pf, bs, lw, tr, ca, you);
  await reply(bs, webhook.id, "A --wait flag on the upload command would already do it for CI:\n```\nnpx @zaisma/cli upload dist --game my-game --wait\n```", { author_kind: me });

  const rumble = await topic(ca, { kind: "feature", author_kind: me, category: "sdk", tags: ["controls"], title: "Gamepad rumble through the SDK", text_markdown: "Browsers support vibration on most gamepads now. A Zaisma.gamepad.rumble(ms, strength) would save everyone writing the same feature checks." });
  await meToo(rumble.id, tr, hl);

  const country = await topic(tr, { kind: "feature", author_kind: me, category: "stats", title: "Show plays by country", text_markdown: "Would help decide which languages to translate into first." });
  await meToo(country.id, bs, ca, qo, lw);

  const brotli = await topic(qo, { kind: "feature", category: "publishing", tags: ["unity"], title: "Serve Unity WebGL builds compressed with Brotli", text_markdown: "Unity's default WebGL build uses Brotli (.br files). Right now they need decompression fallback turned on, which makes the first load slower." });
  await meToo(brotli.id, hl, ca);

  await topic(you, { kind: "feature", author_kind: me, category: "pages", title: "Let players favorite a game from its page", text_markdown: "Players ask how to find our game again. A heart on the game page that adds it to their library would help." });

  // Questions, some answered.
  const domain = await topic(you, { kind: "question", author_kind: me, category: "pages", title: "Can a game use its own domain?", text_markdown: "I'd like players to reach Cave Crew at cavecrew.example. Is that possible?" });
  await zaisma(domain.id, { reply: "Not yet. Games are served from Zaisma's game domain for safety; a custom domain can link to your game page, and your game's links work anywhere." });
  await you("POST", `/forum/${domain.id}/answer`, { answer_post_id: await zaismaPostId(you, domain.id) });

  const syncSaves = await topic(bs, { kind: "question", category: "saves", title: "Can cloud saves move between two of my games?", text_markdown: "We're making a sequel and want players to carry their unlocks over. Can the new game read the old game's save?" });
  await zaisma(syncSaves.id, { reply: "Not directly: each game's saves are its own. Your game server can read both games' saves through the API with your key, and copy what you want across when a player first opens the sequel." });
  await bs("POST", `/forum/${syncSaves.id}/answer`, { answer_post_id: await zaismaPostId(bs, syncSaves.id) });

  const privateTest = await topic(tr, { kind: "question", author_kind: me, category: "publishing", title: "How do I keep a game private while friends test it?", text_markdown: "I want five friends to play before it's public. Do they need accounts?" });
  const ans = await reply(qo, privateTest.id, "Set it to Only me, then make a tester link on the game's page in the dashboard and send that. Testers don't need accounts, and you can turn the link off any time.", { author_kind: me });
  await tr("POST", `/forum/${privateTest.id}/answer`, { answer_post_id: ans.id });
  for (const who of [pf, bs]) await who("POST", `/forum/${privateTest.id}/posts/${ans.id}/helpful`);

  const godot = await topic(pf, { kind: "question", category: "publishing", tags: ["godot"], title: "Godot 4 web export says SharedArrayBuffer isn't defined", text_markdown: "Exported with threads on. Works locally with the Godot server, fails on Zaisma with:\n```\nReferenceError: SharedArrayBuffer is not defined\n```" });
  const godotAns = await reply(hl, godot.id, "Export with Thread Support turned off (Project > Export > Web > Variant). Threads need cross-origin isolation headers, and most hosts that embed games can't send them. Single-threaded builds run fine for 2D.", { author_kind: "ai" });
  await pf("POST", `/forum/${godot.id}/answer`, { answer_post_id: godotAns.id });
  for (const who of [ca, qo, tr]) await who("POST", `/forum/${godot.id}/posts/${godotAns.id}/helpful`);
  await meToo(godot.id, ca, qo);

  const serverState = await topic(lw, { kind: "question", category: "servers", title: "Can my game server keep state between matches?", text_markdown: "We want a lobby leaderboard that survives after a room closes. Where should that live?" });
  await reply(pf, serverState.id, "We keep ours in the game database, written from the server when a match ends. Rooms themselves forget everything when they close.", { author_kind: me });

  const passes = await topic(qo, { kind: "question", category: "passes", title: "Verifying player passes on my own server, in Python", text_markdown: "The docs show JavaScript. Is there a Python example for checking a player pass?" });
  await reply(lw, passes.id, "Passes are standard signed tokens (Ed25519). With PyJWT:\n```python\nimport jwt\nclaims = jwt.decode(token, public_key, algorithms=[\"EdDSA\"], audience=\"your-game-slug\")\n```\nGet the public key from the rooms server's keys address.", { author_kind: "ai" });

  const transfer = await topic(ca, { kind: "question", author_kind: me, category: "accounts", title: "Can I move a game to my teammate's account?", text_markdown: "My co-founder should own the game now. Is there a transfer?" });
  await zaisma(transfer.id, { reply: "Not by yourselves yet. Write to us from the account that owns it and we'll move it; studio accounts with several members are on the roadmap.", topic_status: "answered" });

  const audio = await topic(tr, { kind: "question", category: "sdk", tags: ["phaser", "mobile", "audio"], title: "Phaser 3 sound doesn't start until the second tap on iPhone", text_markdown: "First tap starts the game but no sound; second tap and it works. Android is fine." });
  await reply(ca, audio.id, "iOS only unlocks audio inside a tap handler. Call this.sound.unlock() (or resume the audio context) in your first pointerdown, before starting the scene.", { author_kind: me });
  await meToo(audio.id, hl);

  const ci = await topic(hl, { kind: "question", category: "cli", title: "Running the upload command in GitHub Actions", text_markdown: "What's the cleanest setup? We'd like every merge to main to upload a new version." });
  await reply(you, ci.id, "We do this: put the key in a secret called ZAISMA_KEY, then\n```yaml\n- run: npx @zaisma/cli upload dist --game shard-dodge --patch-notes \"${{ github.event.head_commit.message }}\"\n  env:\n    ZAISMA_KEY: ${{ secrets.ZAISMA_KEY }}\n```", { author_kind: "ai" });

  const unanswered = await topic(bs, { kind: "question", author_kind: me, category: "scans", title: "Why was my version held for an outside host?", text_markdown: "The scan held our build for loading fonts from a font service. Is that not allowed?" });
  await meToo(unanswered.id, qo);
  await topic(lw, { kind: "question", category: "dashboard", title: "Is there a way to see who's playing right now?", text_markdown: "Not names, just a live count would do." });

  // Discussions.
  const weekly = await topic(ca, { kind: "talk", author_kind: me, category: "other", title: "What are you building this week?", text_markdown: "Share what you're working on. We're adding a co-op mode to Coral Run." });
  await reply(pf, weekly.id, "A tiny racing game, made mostly with Claude. First playable is up as a draft.", { author_kind: me });
  await reply(qo, weekly.id, "Porting an old Flash puzzle game. Rooms made the versus mode a weekend job.", { author_kind: me });
  await reply(tr, weekly.id, "Rewriting our save system to use cloud saves instead of our own server.", { author_kind: me });
  await reply(you, weekly.id, "Polishing Arena's new map and testing it with a tester link.", { author_kind: me });
  // A busy thread: more people than a row shows.
  await reply(bs, weekly.id, "A cozy farming game for phones. Cloud saves made the sync painless.", { author_kind: me });
  await reply(hl, weekly.id, "A horror game, short and mean. Asked about the rules first.", { author_kind: me });
  await reply(lw, weekly.id, "Tooling, mostly: our AI now files the bugs it hits straight to this forum.");
  await reply(os, weekly.id, "Two-player tank battles, rooms on Zaisma. @[Pixel Forge], want to swap playtests?", { author_kind: me });
  const horror = await topic(hl, { kind: "talk", author_kind: me, category: "rules", title: "Is a horror game with jump scares fine under the content rules?", text_markdown: "Nothing gory, just jump scares and a dark mood. Want to check before we finish it." });
  await zaisma(horror.id, { reply: "Yes. Scary is fine; the rules are about gore, sexual content and real harm. Say it's a horror game in your description so players know what they're getting." });
  await topic(qo, { kind: "talk", author_kind: me, category: "docs", title: "The room codes docs could use a full example", text_markdown: "The page lists the calls but not how they fit together. A small lobby example from start to finish would help a lot." });

  // A public bug, Zaisma on it.
  const crop = await topic(hl, { kind: "bug", author_kind: me, is_public: true, category: "pages", tags: ["mobile"], title: "Square covers are cropped at the top on some phones", text_markdown: "On a Pixel 7 our square cover loses about 20 px at the top on the home page. Other phones look fine. **Before** and **after** below.", images_base64: [Buffer.from(picture([70, 140, 220], 1)).toString("base64"), Buffer.from(picture([150, 70, 160], 2)).toString("base64")] });
  await meToo(crop.id, ca, pf);
  await zaisma(crop.id, { reply: "Thanks, we can see it on that screen size. Fix coming with the next home page update.", topic_status: "known" });

  // The preview account's messages to Zaisma: its AI hits a bug Zaisma makes a known issue, and hits the
  // rooms one too (the stand-in AI merges it); the developer sends a gap.
  const { topic: tooBig } = await you("POST", "/forum", {
    is_public: false,
    kind: "bug",
    game_slug: "arena",
    category: "mcp",
    title: "upload_files fails with too_big for a 3 MB game",
    text_markdown: "Uploading Arena's new build with upload_files fails straight away with too_big, though the whole build is 3.1 MB. The upload command sends the same folder fine.",
    debug_context: { call: "upload_files", error_code: "too_big", error_message: "That's more than upload_files takes.", notes: "14 files, 3,250,000 bytes in all." },
    images_base64: [Buffer.from(picture([150, 70, 160], 1)).toString("base64")],
  });
  await zaisma(tooBig.id, { is_known_issue: "1", known_issue_title: "upload_files refuses some builds under 5 MB", workaround: "Use the upload command (npx @zaisma/cli upload) for builds over 2 MB.", roadmap_item: "Developer MCP", topic_status: "known", severity: "normal", category: "mcp", reply: "Found it: base64 makes the request bigger than the build. Thanks for the details." });
  await you("POST", "/forum", { is_public: false, kind: "bug", game_slug: "cave-crew", category: "rooms", title: "Room drops every player once it fills up", text_markdown: "Cave Crew's rooms drop every player once about 50 join. Players get disconnected all at once." });
  await you("POST", "/forum", { is_public: false, kind: "gap", author_kind: me, category: "publishing", title: "Builds over 500 MB", text_markdown: "My Unity export is 640 MB with its streaming assets. Is the 500 MB limit going to change? I can't split it." });
  // A reply the check holds, to show what waiting for a person looks like.
  await reply(you, weekly.id, "Anyone want to playtest Arena tonight? Add me on discord, same name.", { author_kind: me });
  // A third known issue, planned.
  const { topic: scanSlow } = await lw("POST", "/forum", { is_public: false, kind: "bug", category: "scans", title: "Scan took 25 minutes on Saturday", text_markdown: "Usually under a minute; Saturday evening it took 25." });
  await zaisma(scanSlow.id, { is_known_issue: "1", known_issue_title: "Scans can take over 10 minutes at busy times", workaround: "Upload a little ahead of a launch, or schedule the publish.", roadmap_item: "Scan speed", topic_status: "fixing", severity: "normal", category: "scans" });
  // The rooms fix is out, and Zaisma is watching that it holds.
  const roomsTopic = (await you("GET", `/forum/${roomsKnown}`)).topic;
  await zaisma(roomsKnown, { is_known_issue: "1", known_issue_title: roomsTopic.title, workaround: roomsTopic.workaround, roadmap_item: roomsTopic.roadmap_item ?? "", topic_status: "released", severity: "high", category: "rooms", reply: "The fix for the 50-player drop is live. We're watching that it holds." });
  await meToo((await you("GET", "/forum?tab=known")).topics.find((k) => k.title.startsWith("Scans can take")).id, pf, tr);

  // Spread the times over the last three weeks, in the order things happened.
  const end = Date.now();
  const k = (21 * 86400_000) / (end - start);
  const at = (col) => `${col} = CASE WHEN ${col} >= ${start} THEN CAST(${end} - (${end} - ${col}) * ${k} AS INTEGER) ELSE ${col} END`;
  spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "zaisma", "--local", "--persist-to", STATE, "--command",
      `UPDATE forum_topics SET ${["created_at_ms", "updated_at_ms", "last_activity_at_ms", "news_at_ms", "seen_at_ms", "triaged_at_ms"].map(at).join(", ")}; UPDATE forum_posts SET ${at("created_at_ms")}; UPDATE forum_votes SET ${at("created_at_ms")}; UPDATE forum_follows SET ${at("seen_at_ms")};`],
    { cwd: join(ROOT, "apps/site"), stdio: "ignore", env: { ...process.env, CI: "1" } },
  );
}

/** Another developer account, signed in with its own API key: answers an API call function. */

async function developer(name, email) {
  const jar = new Map();
  // Each from its own test address, as real people would be, so sign-in's limit per address isn't hit.
  const ip = `198.51.100.${(developer.made = (developer.made ?? 0) + 1)}`;
  const go = async (path, body) => {
    const res = await fetch(SITE + path, { method: "POST", body: new URLSearchParams(body), redirect: "manual", headers: { origin: SITE, "cf-connecting-ip": ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split("; ");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
  await go("/join/age", { month: "3", day: "14", year: "1988" });
  await go("/join/email", { name, email });
  await go("/signin/code", { email, code: "123456" });
  const key = (await (await go("/account/keys", { name: "preview" })).text()).match(/zsk_[a-z0-9]+_[A-Za-z0-9_-]+/)?.[0];
  if (!key) throw new Error(`Couldn't make ${name}'s API key.`);
  return async (method, path, body) => {
    const res = await fetch(`${SITE}/api/dev${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${data.error?.message}`);
    return data;
  };
}

/** A 16:9 test picture that reads like game art: a sky, a sun and two ranges of hills, in the game's colors. A marker goes in a text chunk. */
function picture([r, g, b], n, marker) {
  const w = 640, h = 360;
  const rows = [];
  const sun = { x: 140 + n * 150, y: 110 + n * 20, r: 46 };
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const t = y / h;
      let c = [r * (0.35 + t * 0.9), g * (0.35 + t * 0.9), b * (0.6 + t * 0.6)];
      const d = Math.hypot(x - sun.x, y - sun.y);
      if (d < sun.r) c = [255, 235, 190];
      else if (d < sun.r * 2.4) c = c.map((v, i) => v + ([255, 220, 160][i] - v) * 0.35 * (1 - (d - sun.r) / (sun.r * 1.4)));
      const far = h * 0.62 + Math.sin(x / 47 + n) * 22 + Math.sin(x / 13 + n * 2) * 6;
      const near = h * 0.78 + Math.sin(x / 71 + n * 3) * 30 + Math.sin(x / 19) * 8;
      if (y > near) c = [r * 0.18, g * 0.18, b * 0.22];
      else if (y > far) c = [r * 0.42, g * 0.42, b * 0.5];
      row[1 + x * 3] = Math.max(0, Math.min(255, Math.round(c[0])));
      row[2 + x * 3] = Math.max(0, Math.min(255, Math.round(c[1])));
      row[3 + x * 3] = Math.max(0, Math.min(255, Math.round(c[2])));
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, "latin1"), data])), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), ...(marker ? [chunk("tEXt", Buffer.from(`Comment\0${marker}`, "latin1"))] : []), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
}

function crc(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/**
 * Two months of made-up plays for Shard Dodge and Arena, growing over time, and a jump for Cave Crew
 * and Tiny Farm; only fills days that are empty. Most plays count, spread over home internet providers.
 */
function pretendPlaysSql(now = Date.now()) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const PROVIDERS = [7922, 3320, 5089, 2856, 701, 3215];
  const rows = [];
  const add = (slug, d, players, fresh, seconds) => {
    const plays = Math.round(players * 1.8);
    const counted = Math.round(plays * 0.8);
    const countedPlayers = Math.round(players * 0.85);
    rows.push(`INSERT OR IGNORE INTO play_days (game_id, date, started_play_count, started_player_count, started_new_player_count, play_count, player_count, new_player_count, play_duration_sec) SELECT id, '${d}', ${plays}, ${players}, ${fresh}, ${counted}, ${countedPlayers}, ${Math.round(fresh * 0.85)}, ${counted * seconds} FROM games WHERE slug = '${slug}'`);
    PROVIDERS.forEach((asn, i) => {
      const share = Math.floor(countedPlayers / PROVIDERS.length) + (i < countedPlayers % PROVIDERS.length ? 1 : 0);
      if (share) rows.push(`INSERT OR IGNORE INTO play_networks (game_id, date, autonomous_system_number, player_count) SELECT id, '${d}', ${asn}, ${share} FROM games WHERE slug = '${slug}'`);
    });
  };
  for (const [slug, size] of [["shard-dodge", 40], ["arena", 15]]) {
    for (let i = 60; i >= 0; i--) {
      const grow = 1 + (60 - i) / 30;
      const weekend = [0, 6].includes(new Date(now - i * 86_400_000).getUTCDay()) ? 1.4 : 1;
      const fresh = Math.round(size * grow * weekend * (0.8 + 0.4 * Math.abs(Math.sin(i * 1.7))));
      const d = day(now - i * 86_400_000);
      add(slug, d, Math.round(fresh * 1.6), fresh, slug === "arena" ? 540 : 260);
      for (const [after, share] of [[1, 0.32], [7, 0.14], [30, 0.06]]) {
        if (i - after >= 0) rows.push(`INSERT OR IGNORE INTO play_returns (game_id, first_play_date, after_days, player_count) SELECT id, '${d}', ${after}, ${Math.round(fresh * 0.85 * share)} FROM games WHERE slug = '${slug}'`);
      }
    }
  }
  // Cave Crew and Tiny Farm have had a lot more players these last 3 days, so they trend.
  for (const [slug, jump] of [["cave-crew", 70], ["tiny-farm", 30]]) {
    for (let i = 16; i >= 0; i--) {
      const n = i < 3 ? jump + i * 10 : 6;
      add(slug, day(now - i * 86_400_000), n, Math.round(n * 0.7), 400);
    }
  }
  // Four in a Row looks botted today: a jump, mostly from cloud servers, for admin's Play spikes.
  for (let i = 7; i >= 1; i--) add("four-in-a-row", day(now - i * 86_400_000), 4, 2, 300);
  rows.push(`INSERT OR IGNORE INTO play_days (game_id, date, started_play_count, started_player_count, started_new_player_count, play_count, player_count, new_player_count, play_duration_sec) SELECT id, '${day(now)}', 260, 240, 235, 240, 240, 235, ${240 * 70} FROM games WHERE slug = 'four-in-a-row'`);
  rows.push(`INSERT OR IGNORE INTO play_networks (game_id, date, autonomous_system_number, player_count) SELECT id, '${day(now)}', 16509, 190 FROM games WHERE slug = 'four-in-a-row'`);
  rows.push(`INSERT OR IGNORE INTO play_networks (game_id, date, autonomous_system_number, player_count) SELECT id, '${day(now)}', 14061, 38 FROM games WHERE slug = 'four-in-a-row'`);
  rows.push(`INSERT OR IGNORE INTO play_networks (game_id, date, autonomous_system_number, player_count) SELECT id, '${day(now)}', 7922, 12 FROM games WHERE slug = 'four-in-a-row'`);
  return rows.join("; ");
}
