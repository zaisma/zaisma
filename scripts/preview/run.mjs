#!/usr/bin/env node
// Local preview: the whole site (site, games, stand-in sign-in) with test games, so changes can be
// tried and iterated on before anything goes live. Run: npm run preview (add --reset for fresh data).
// Uses its own data folder and ports, so it never touches your dev data or the live site.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { startFakeAuth } from "./fake-auth.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STATE = join(ROOT, ".wrangler/preview");
const PORTS = { site: 8800, games: 8801, rooms: 8802, auth: 8790, ai: 8791 };
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
    "ANTHROPIC_API_KEY=preview", `ANTHROPIC_BASE_URL=http://localhost:${PORTS.ai}`, ""].join("\n"),
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

function wrangler(app, args, opts = {}) {
  return spawn("npx", ["wrangler", ...args], { cwd: join(ROOT, "apps", app), stdio: opts.quiet ? "ignore" : ["ignore", "inherit", "inherit"], env: { ...process.env, FORCE_COLOR: "0" } });
}

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(url);
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} didn't start. Is something else using its port?`);
}

await startFakeAuth(PORTS.auth, join(STATE, "auth-key.json")).catch(() => console.log(`Sign-in stand-in already running on ${PORTS.auth}.`));
children.push(spawn("node", [join(ROOT, "scripts/preview/fake-ai.mjs"), String(PORTS.ai)], { stdio: "ignore" }));
console.log("Applying database updates…");
spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "zaisma", "--local", "--persist-to", STATE], { cwd: join(ROOT, "apps/site"), stdio: "ignore", env: { ...process.env, CI: "1" } });
children.push(wrangler("games", ["dev", "--port", String(PORTS.games), "--inspector-port", "9341", "--persist-to", STATE, "--env-file", join(STATE, "games.env")], { quiet: true }));
children.push(wrangler("site", ["dev", "--port", String(PORTS.site), "--inspector-port", "9340", "--local-upstream", `localhost:${PORTS.site}`, "--persist-to", STATE, "--env-file", join(STATE, "site.env"), "--test-scheduled"], { quiet: true }));
children.push(wrangler("rooms", ["dev", "--port", String(PORTS.rooms), "--inspector-port", "9342", "--persist-to", STATE, "--env-file", join(STATE, "rooms.env")], { quiet: true }));
await Promise.all([waitFor(SITE), waitFor(GAMES), waitFor(ROOMS)]);
if (fresh) {
  console.log("Adding test games…");
  await seed();
  writeFileSync(join(STATE, "seeded"), new Date().toISOString());
}
// The two multiplayer demos run on our rooms (also for preview data made before rooms were in the preview).
spawnSync("npx", ["wrangler", "d1", "execute", "zaisma", "--local", "--persist-to", STATE, "--command", "UPDATE games SET game_server = slug WHERE slug IN ('arena', 'four-in-a-row') AND game_server IS NULL"], {
  cwd: join(ROOT, "apps/site"),
  stdio: "ignore",
  env: { ...process.env, CI: "1" },
});

// The site's every-5-minutes job (scheduled publishing, report triage), run every 20 seconds here.
const tick = () => fetch(`${SITE}/__scheduled?cron=${encodeURIComponent("*/5 * * * *")}`).catch(() => {});
setInterval(tick, 20_000);
tick();

console.log(`
Zaisma preview is running. Nothing here touches the live site.

  Home            ${SITE}/
  A game page     ${SITE}/g/shard-dodge
  Multiplayer     ${SITE}/g/arena  (open it in two windows to play together)
  Your games      ${SITE}/dashboard
  Admin           ${SITE}/admin
  Report queue    ${SITE}/admin/reports

Sign in with any email and the code 123456. ${EMAIL} owns the test games.
Stop with Ctrl+C. Fresh data: npm run preview -- --reset
`);

// --- Test data, made through the same pages and API that people use ---

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
    spawnSync("node", [join(ROOT, "packages/cli/zaisma.mjs"), "upload", join(ROOT, folder), "--game", slug, "--notes", notes], {
      env: { ...process.env, ZAISMA_API: SITE, ZAISMA_KEY: key },
      stdio: "ignore",
    });
  // With no AI review locally, every version waits for a person: approve it as admin.
  const approveNewest = async (slug) => {
    const { versions } = await api("GET", `/games/${slug}`);
    await go(`/admin/versions/${versions[0].id}/approve`, form({ reason: "Preview test data" }));
    return versions[0].id;
  };

  const games = [
    { title: "Shard Dodge", folder: "examples/hello-game", color: [70, 140, 220], description: "Dodge the falling shards for as long as you can. Arrow keys, mouse or finger.", devices: ["phone", "tablet", "computer"], controls: ["touch", "keyboard-mouse"], players: { single: true, local: null, online: null } },
    { title: "Arena", folder: "examples/arena/game", color: [150, 70, 160], description: "Bump your friends off the platform. Last one standing wins the round.", devices: ["computer"], controls: ["keyboard-mouse", "gamepad"], players: { single: false, local: { min: 2, max: 4, style: "versus" }, online: { min: 2, max: 8, style: "versus" } } },
    { title: "Four in a Row", folder: "examples/four-in-a-row/game", color: [200, 140, 50], description: "The classic: drop your pieces and line up four before your friend does.", devices: ["phone", "tablet", "computer"], controls: ["touch", "keyboard-mouse"], players: { single: false, local: { min: 2, max: 2, style: "versus" }, online: { min: 2, max: 2, style: "versus" } } },
    { title: "Night Drive", folder: "examples/hello-game", color: [40, 50, 90], description: "", devices: [], controls: [] },
    { title: "Tiny Farm", folder: "scripts/preview/tiny-farm", color: [90, 140, 60], description: "Harvest carrots. It saves like a Unity game does (in IndexedDB), to try cloud saves.", devices: ["phone", "tablet", "computer"], controls: ["touch", "keyboard-mouse"], players: { single: true, local: null, online: null } },
    { title: "Cave Crew", folder: "examples/hello-game", color: [60, 120, 90], description: "Dig, build and explore together. Bring the whole crew.", devices: ["computer"], controls: ["keyboard-mouse", "gamepad"], players: { single: true, local: { min: 2, max: 4, style: "co-op" }, online: { min: 2, max: null, style: "co-op" } } },
  ];
  for (const g of games) {
    const { game } = await api("POST", "/games", { title: g.title, description: g.description, devices: g.devices, controls: g.controls, ...(g.players ? { players: g.players } : {}) });
    upload(g.folder, game.slug, "First version.");
    await api("POST", `/games/${game.slug}/versions/${await approveNewest(game.slug)}/publish`);
    await api("PATCH", `/games/${game.slug}`, { visibility: "listed" });
    if (g.title !== "Night Drive") {
      const { image } = await api("POST", `/games/${game.slug}/images?kind=cover`, picture(g.color, 0));
      await go(`/admin/images/${image.id}/approve`, form({ reason: "" }));
    }
  }
  // Screenshots and a second version with patch notes, so the game page has everything.
  for (const n of [1, 2]) {
    const { image } = await api("POST", "/games/shard-dodge/images?kind=screenshot", picture([70, 140, 220], n));
    await go(`/admin/images/${image.id}/approve`, form({ reason: "" }));
  }
  upload("examples/hello-game", "shard-dodge", "New night level, faster hops and a fix for the double-jump bug.");
  await api("POST", `/games/shard-dodge/versions/${await approveNewest("shard-dodge")}/publish`);

  // Reports for the report queue, sent like the plate beside a game sends them. The stand-in AI sorts them within half a minute.
  const reports = [
    ["shard-dodge", { reason: "broken", details: "Freezes when I double jump on the night level" }],
    ["shard-dodge", { reason: "other", details: "stuck after a double jump on the night level, can't move" }],
    ["night-drive", { reason: "other", details: "it asks for my steam login to unlock level 2" }],
    ["cave-crew", { reason: "sexual", details: "naked characters in the second cave" }],
    ["arena", { reason: "harassment", room: "ABCDEF", player: { id: "g_preview000000001", name: "Swift Fox 42" }, details: "keeps following me and spamming insults" }],
    ["arena", { reason: "harassment", room: "ABCDEF", player: { id: "g_preview000000001", name: "Swift Fox 42" }, details: "same player again, won't leave me alone" }],
    ["four-in-a-row", { reason: "other", details: "boring, my friend always wins" }],
  ];
  for (const [i, [slug, body]] of reports.entries()) {
    await fetch(`${SITE}/g/${slug}/report`, { method: "POST", headers: { "content-type": "application/json", origin: SITE, "cf-connecting-ip": `192.0.2.${i + 1}` }, body: JSON.stringify(body) });
  }
}

/** A 16:9 test picture that reads like game art: a sky, a sun and two ranges of hills, in the game's colors. */
function picture([r, g, b], n) {
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
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
}

function crc(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
