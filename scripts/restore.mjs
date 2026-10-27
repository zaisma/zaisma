#!/usr/bin/env node
// Brings Zaisma back in a Cloudflare account from its backups at Backblaze B2 (apps/site/src/backups.ts),
// for the day Zaisma's own account is gone, and for practising that day. Run it from a public checkout on
// the code to deploy, with an API token for the target account in the shell (CLOUDFLARE_API_TOKEN), never
// wrangler login: the machine has one wrangler sign-in, and every npm run ship uses it.
//
//   node scripts/restore.mjs plan [--night <YYYY-MM-DD>]
//       which night the restore would bring back (the newest by default) and the nights there are; writes nothing
//   node scripts/restore.mjs run --account-id <id> --site-domain <domain> --game-domain <domain> [--night <YYYY-MM-DD>]
//       makes the database, buckets and queues, loads that night's main database, applies newer migrations,
//       deploys the five Workers on those domains, puts fresh signing keys and the read key, and starts the
//       copy of everything else, which the site Worker does itself (apps/site/src/restore.ts)
//   node scripts/restore.mjs status --account-id <id>
//       how far the copy is
//   node scripts/restore.mjs check --account-id <id>
//       every table's rows against the main database's backup, and the copy's counts
//   node scripts/restore.mjs clean
//       deletes the generated configs (apps/*/wrangler.restore*.jsonc) and the download (.restore/) from this checkout
//
// Every command takes --json (one answer as JSON) and run takes --dry (says each step, does none). run is
// safe to run again: each step looks first and skips what's done, so a run that stopped goes on from there.
//
// It needs the read key in the shell, RESTORE_KEY_ID and RESTORE_KEY_SECRET: a Backblaze key with only
// listBuckets, listFiles and readFiles on the backups bucket, made for the restore and deleted after it.
// Production's domains are zaisma.com and zaismausercontent.com; a practice uses two of its own, already
// added to the target account, with the game domain's wildcard record (* AAAA 100::, proxied).
//
// Not restored, as the backups don't hold them: game secrets (developers set them again), Supabase's
// sign-ins (Supabase keeps its own backups) and rooms that aren't kept. Signing keys are made fresh, so
// passes and sign-in links made before stop working. Other secrets (Supabase, Stripe, Anthropic, email,
// pushes, the relay) come from the password manager: each Worker's wrangler.jsonc lists them.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { BackupStorage } from "../apps/site/src/backup-storage.ts";
import { scanStatements } from "../packages/game-server/src/database.ts";
import { ensureDocker, placePhotoDnaSdk } from "./photodna-sdk.mjs";

const CHECKOUT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Deployed in this order, as npm run ship does: the site calls rooms and photodna and links to games.
const WORKERS = ["rooms", "games", "photodna", "compress", "site"];
const PRODUCTION = { siteDomain: "zaisma.com", gameDomain: "zaismausercontent.com", databaseId: "bffea7a7-f905-4eaf-84f2-97b1fb6bf932" };
const DATABASE_NAME = "zaisma";
const BUCKET_NAMES = ["zaisma-games", "zaisma-saves"];
const MAIN_DATABASE_KEY = "main-database.sql";
/** The nightly backup starts at 03:17 UTC (apps/site/wrangler.jsonc): a night's copies are those uploaded before the next night starts. */
const BACKUP_CRON_UTC = { hour: 3, minute: 17 };
const RESTORE_FOLDER = join(CHECKOUT, ".restore");
const DAY_MS = 24 * 60 * 60 * 1000;
/** SQL sent at once through wrangler d1 execute --command: well under a command line's limit. */
const COMMAND_SIZE_CHARACTERS = 90_000;

const [command = "", ...rest] = process.argv.slice(2);
const flags = readFlags(rest);
const isJson = flags.has("json");
const isDryRun = flags.has("dry");

function readFlags(words) {
  const read = new Map();
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (!word.startsWith("--")) fail(`${word} isn't a flag: give flags as --name value.`);
    const name = word.slice(2);
    if (["json", "dry"].includes(name)) read.set(name, true);
    else if (["night", "account-id", "site-domain", "game-domain"].includes(name)) {
      const value = words[++index];
      if (!value || value.startsWith("--")) fail(`--${name} needs a value.`);
      read.set(name, value);
    } else fail(`--${name} isn't a flag restore.mjs takes: --night, --account-id, --site-domain, --game-domain, --json, --dry.`);
  }
  return read;
}

function say(line) {
  if (!isJson) process.stdout.write(`${line}\n`);
}

function fail(message, next = null) {
  if (isJson) process.stdout.write(`${JSON.stringify({ is_done: false, error: message, next_step: next })}\n`);
  else process.stdout.write(`\nRESTORE FAIL ${message}${next ? `\nNext: ${next}` : ""}\n`);
  process.exit(1);
}

function answer(fields, line) {
  if (isJson) process.stdout.write(`${JSON.stringify({ is_done: true, ...fields })}\n`);
  else process.stdout.write(`\n${line}\n`);
}

/** The site's wrangler.jsonc as an object: its comments stripped (none sits inside a string). */
function siteSettings() {
  const text = readFileSync(join(CHECKOUT, "apps", "site", "wrangler.jsonc"), "utf8");
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
}

function backupStorage() {
  const { RESTORE_KEY_ID: keyId, RESTORE_KEY_SECRET: keySecret } = process.env;
  if (!keyId || !keySecret) fail("RESTORE_KEY_ID and RESTORE_KEY_SECRET aren't set in this shell.", "Make the read key (b2 key create, listBuckets,listFiles,readFiles on the backups bucket only) and export both, then run this again.");
  const vars = siteSettings().vars;
  return new BackupStorage({ endpointUrl: vars.BACKUP_ENDPOINT, regionName: vars.BACKUP_REGION, bucketName: vars.BACKUP_BUCKET_NAME, keyId, keySecret });
}

/** The main database's copies, newest first, each with its night and the cutoff every other key's copy is taken before. */
async function mainDatabaseNights(storage) {
  const { versions } = await storage.listVersionPage(MAIN_DATABASE_KEY, null);
  return versions
    .filter((version) => version.key === MAIN_DATABASE_KEY && !version.isHidden)
    .map((version) => {
      const night = new Date(version.lastModifiedAtMs).toISOString().slice(0, 10);
      const [year, month, day] = night.split("-").map(Number);
      return { night, version, cutoffAtMs: Date.UTC(year, month - 1, day, BACKUP_CRON_UTC.hour, BACKUP_CRON_UTC.minute) + DAY_MS };
    });
}

async function chosenNight(storage) {
  const nights = await mainDatabaseNights(storage);
  if (!nights.length) fail(`The backups hold no ${MAIN_DATABASE_KEY}.`, "Check RESTORE_KEY_ID is a key on the backups bucket, and that a night has finished (backup_runs).");
  const wanted = flags.get("night");
  const chosen = wanted ? nights.find((night) => night.night === wanted) : nights[0];
  if (!chosen) fail(`No copy of the main database from ${wanted}.`, `Pick one of: ${nights.map((night) => night.night).join(", ")}.`);
  return { chosen, nights };
}

// wrangler, on the account the restore goes into.
const wranglerBin = join(CHECKOUT, "node_modules", ".bin", "wrangler");
function wrangler(argumentList, { input, isInteractive = false } = {}) {
  const environment = { ...process.env, CLOUDFLARE_ACCOUNT_ID: flags.get("account-id"), FORCE_COLOR: "0" };
  if (isInteractive) return { exitCode: spawnSync(wranglerBin, argumentList, { cwd: CHECKOUT, env: environment, stdio: "inherit" }).status ?? 1, output: "" };
  const result = spawnSync(wranglerBin, argumentList, { cwd: CHECKOUT, env: environment, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...(input === undefined ? {} : { input }) });
  return { exitCode: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function wranglerOrFail(argumentList, what, options) {
  const result = wrangler(argumentList, options);
  if (result.exitCode !== 0) {
    say(result.output.trim());
    fail(`${what} failed (wrangler's answer is above).`, "Fix what wrangler says, then run this again: it goes on from where it stopped.");
  }
  return result.output;
}

const configOf = (worker) => join("apps", worker, "wrangler.restore.jsonc");
/** A Worker's first deploy into a new account, without its bindings to Workers not deployed yet. */
const firstConfigOf = (worker) => join("apps", worker, "wrangler.restore-first.jsonc");
const siteConfig = configOf("site");

/** One SQL statement on the restored main database, answered as rows. */
function remoteRows(sql) {
  const output = wranglerOrFail(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--config", siteConfig, "--command", sql], `Running ${sql.slice(0, 60)}`);
  const answered = JSON.parse(output.slice(output.indexOf("[")));
  return answered[0]?.results ?? [];
}

function needTarget() {
  if (!process.env.CLOUDFLARE_API_TOKEN) fail("CLOUDFLARE_API_TOKEN isn't set in this shell: the restore never uses wrangler's own sign-in, which npm run ship needs for Zaisma's account.", "Make an API token in the target account (the \"Edit Cloudflare Workers\" template plus D1, Queues, Containers, R2 and the zones' DNS) and export it in this shell only.");
  for (const name of ["account-id", ...(command === "run" ? ["site-domain", "game-domain"] : [])]) if (!flags.get(name)) fail(`--${name} is missing.`, "node scripts/restore.mjs run --account-id <id> --site-domain <domain> --game-domain <domain>");
}

/** Each Worker's config for the target: the target's database and domains in place of production's, beside the original so its paths hold. */
function writeConfigs(databaseId) {
  const siteDomain = flags.get("site-domain");
  const gameDomain = flags.get("game-domain");
  for (const worker of WORKERS) {
    const text = readFileSync(join(CHECKOUT, "apps", worker, "wrangler.jsonc"), "utf8")
      .replaceAll(PRODUCTION.databaseId, databaseId)
      .replaceAll(PRODUCTION.gameDomain, gameDomain)
      .replaceAll(PRODUCTION.siteDomain, siteDomain);
    writeFileSync(join(CHECKOUT, configOf(worker)), text);
  }
}

async function downloadMainDatabase(storage, version) {
  mkdirSync(RESTORE_FOLDER, { recursive: true });
  const dumpPath = join(RESTORE_FOLDER, `main-database-${version.versionId.replace(/[^\w-]/g, "_")}.sql`);
  const countsPath = `${dumpPath}.counts.json`;
  if (existsSync(dumpPath) && existsSync(countsPath)) return { dumpPath, rowCounts: JSON.parse(readFileSync(countsPath, "utf8")) };
  const object = await storage.getObject(MAIN_DATABASE_KEY, version.versionId);
  // Counts each table's INSERTs on the way, for check: every row starts a line of the dump (backups.ts, mainDatabaseDump).
  const rowCounts = {};
  let rest = "";
  const counting = new Transform({
    transform(chunk, _encoding, done) {
      const lines = (rest + chunk.toString("utf8")).split("\n");
      rest = lines.pop();
      for (const line of lines) {
        const match = /^INSERT INTO "((?:[^"]|"")+)"\(/.exec(line);
        if (match) rowCounts[match[1].replaceAll('""', '"')] = (rowCounts[match[1].replaceAll('""', '"')] ?? 0) + 1;
      }
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(object.body), counting, createWriteStream(dumpPath));
  writeFileSync(countsPath, JSON.stringify(rowCounts));
  return { dumpPath, rowCounts };
}

/**
 * The dump without its virtual tables, for D1's import, which refuses them (it resets the database and
 * says only D1_RESET_DO), and the CREATE VIRTUAL TABLEs and their rows as statements to run after it.
 */
function splitVirtualTables(dumpPath) {
  const dumpSql = readFileSync(dumpPath, "utf8");
  const statements = scanStatements(dumpSql).map((statement) => dumpSql.slice(statement.startIndex, statement.endIndex));
  const virtualNames = new Set(statements.map((text) => /^CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w]+)"?/i.exec(text)?.[1]).filter(Boolean));
  const isVirtual = (text) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(text) || [...virtualNames].some((name) => new RegExp(`^INSERT\\s+INTO\\s+"?${name}"?\\s*\\(`, "i").test(text));
  const importPath = `${dumpPath}.import.sql`;
  writeFileSync(importPath, statements.filter((text) => !isVirtual(text)).map((text) => `${text};\n`).join(""));
  return { importPath, virtualStatements: statements.filter(isVirtual) };
}

/**
 * The dump as statements through wrangler d1 execute --command: each table's CREATE and rows together,
 * a table after every table it refers to, then indexes, views and triggers, in commands that each defer
 * foreign keys to their end. A refused command stops the load and says which tables it held.
 */
function loadByStatements(dumpPath) {
  const dumpSql = readFileSync(dumpPath, "utf8");
  const statements = scanStatements(dumpSql).map((statement) => dumpSql.slice(statement.startIndex, statement.endIndex));
  const tableNameOf = (text) => (/^CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i.exec(text) ?? /^INSERT\s+INTO\s+"?(\w+)"?\s*\(/i.exec(text))?.[1]?.toLowerCase() ?? null;
  const groups = new Map();
  const rest = [];
  for (const text of statements) {
    if (/^PRAGMA\b/i.test(text)) continue;
    const tableName = tableNameOf(text);
    if (tableName) groups.set(tableName, [...(groups.get(tableName) ?? []), text]);
    else rest.push(text);
  }
  const referencesOf = (tableName) => [...(groups.get(tableName)?.[0] ?? "").matchAll(/REFERENCES\s+"?(\w+)"?/gi)].map((match) => match[1].toLowerCase()).filter((name) => name !== tableName && groups.has(name));
  const ordered = [];
  const placed = new Set();
  const place = (tableName, path = new Set()) => {
    if (placed.has(tableName) || path.has(tableName)) return;
    path.add(tableName);
    for (const parent of referencesOf(tableName)) place(parent, path);
    placed.add(tableName);
    ordered.push(tableName);
  };
  for (const tableName of groups.keys()) place(tableName);
  const commands = [];
  let command = "";
  let commandTables = new Set();
  const flush = () => {
    if (command) commands.push({ sql: `PRAGMA defer_foreign_keys = TRUE;\n${command}`, tables: [...commandTables] });
    command = "";
    commandTables = new Set();
  };
  const add = (text, tableName) => {
    if (command && command.length + text.length > COMMAND_SIZE_CHARACTERS) flush();
    command += `${text};\n`;
    if (tableName) commandTables.add(tableName);
  };
  for (const tableName of ordered) for (const text of groups.get(tableName)) add(text, tableName);
  for (const text of rest) add(text, null);
  flush();
  commands.forEach((loaded, index) => {
    const result = wrangler(["d1", "execute", DATABASE_NAME, "--remote", "--yes", "--config", siteConfig, "--command", loaded.sql]);
    if (result.exitCode !== 0) {
      say(result.output.trim());
      fail(`Part ${index + 1} of ${commands.length} of the main database (tables ${loaded.tables.join(", ") || "none: indexes, views and triggers"}) was refused (above); the parts before it are in.`, "Delete the practice database (npx wrangler d1 delete zaisma, with this shell's token), fix what's above, and run this again.");
    }
    say(`Main database part ${index + 1} of ${commands.length} in.`);
  });
}

/** Statements joined into commands of up to COMMAND_SIZE_CHARACTERS each (one longer statement goes alone). */
function commandsOf(statements) {
  const commands = [];
  let command = "";
  for (const text of statements) {
    if (command && command.length + text.length > COMMAND_SIZE_CHARACTERS) {
      commands.push(command);
      command = "";
    }
    command += `${text};\n`;
  }
  if (command) commands.push(command);
  return commands;
}

async function runRestore() {
  needTarget();
  const storage = backupStorage();
  const { chosen } = await chosenNight(storage);
  say(`Restoring the night of ${chosen.night}: the main database's copy, and every other key's newest copy before ${new Date(chosen.cutoffAtMs).toISOString()}.`);
  if (isDryRun) {
    answer({ night_date: chosen.night, cutoff_at: new Date(chosen.cutoffAtMs).toISOString() }, `RESTORE DRY would make the database, buckets and queues in ${flags.get("account-id")}, load ${chosen.night}'s main database, deploy ${WORKERS.join(", ")} on ${flags.get("site-domain")} and ${flags.get("game-domain")}, and start the copy.`);
    return;
  }
  wranglerOrFail(["whoami"], "Checking wrangler's sign-in");

  // The main database: made, or found from a run that stopped.
  const listed = JSON.parse(wranglerOrFail(["d1", "list", "--json"], "Listing the account's databases"));
  let databaseId = listed.find((database) => database.name === DATABASE_NAME)?.uuid;
  if (!databaseId) {
    wranglerOrFail(["d1", "create", DATABASE_NAME], "Making the database");
    databaseId = JSON.parse(wranglerOrFail(["d1", "list", "--json"], "Listing the account's databases")).find((database) => database.name === DATABASE_NAME)?.uuid;
    say(`Database ${DATABASE_NAME} made (${databaseId}).`);
  }
  if (databaseId === PRODUCTION.databaseId && flags.get("site-domain") !== PRODUCTION.siteDomain) fail("That's production's database: a practice goes into an account of its own.", "Give --account-id the practice account's ID.");
  writeConfigs(databaseId);

  // The buckets and queues.
  const buckets = wranglerOrFail(["r2", "bucket", "list"], "Listing the account's buckets");
  for (const bucketName of BUCKET_NAMES) {
    if (new RegExp(`name:\\s+${bucketName}\\s`).test(`${buckets}\n`)) continue;
    wranglerOrFail(["r2", "bucket", "create", bucketName], `Making the bucket ${bucketName}`);
    say(`Bucket ${bucketName} made.`);
  }
  const queueNames = [...new Set(WORKERS.flatMap((worker) => [...readFileSync(join(CHECKOUT, "apps", worker, "wrangler.jsonc"), "utf8").matchAll(/"queue":\s*"([\w-]+)"/g)].map((match) => match[1])))];
  const queues = wranglerOrFail(["queues", "list"], "Listing the account's queues");
  for (const queueName of queueNames.filter((name) => !new RegExp(`\\s${name}\\s`).test(queues))) {
    wranglerOrFail(["queues", "create", queueName], `Making the queue ${queueName}`);
    say(`Queue ${queueName} made.`);
  }

  // The main database's copy, loaded once: a database with d1_migrations already has it.
  const hasMainDatabase = wrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--config", siteConfig, "--command", "SELECT COUNT(*) AS migration_count FROM d1_migrations"]).exitCode === 0;
  if (!hasMainDatabase) {
    const { dumpPath } = await downloadMainDatabase(storage, chosen.version);
    const { importPath, virtualStatements } = splitVirtualTables(dumpPath);
    say(`Loading ${chosen.night}'s main database…`);
    const loadStartedAtMs = Date.now();
    const imported = wrangler(["d1", "execute", DATABASE_NAME, "--remote", "--yes", "--config", siteConfig, "--file", importPath]);
    if (imported.exitCode === 0) {
      // D1's import takes no virtual table (the forum's full-text search): it and its rows go in as statements.
      for (const command of commandsOf(virtualStatements)) wranglerOrFail(["d1", "execute", DATABASE_NAME, "--remote", "--yes", "--config", siteConfig, "--command", command], "Loading the main database's virtual tables");
    } else {
      // D1's import can refuse a dump without saying why ({"D1_RESET_DO":true}), and leaves the database as it was:
      // the same SQL then goes in as statements, parents before the tables that refer to them, and a refusal names its statement.
      say(`D1's import refused the dump (${imported.output.trim().split("\n").filter((line) => /ERROR/.test(line)).join(" ") || "no reason given"}); loading it as statements instead…`);
      loadByStatements(dumpPath);
    }
    say(`Main database loaded in ${Math.round((Date.now() - loadStartedAtMs) / 1000)} s.`);
  }
  // Migrations newer than the copy: one that deletes data asks in this terminal.
  if (wrangler(["d1", "migrations", "apply", DATABASE_NAME, "--remote", "--config", siteConfig], { isInteractive: true }).exitCode !== 0) fail("Applying migrations failed (above).", "Fix it and run this again.");

  // The Workers, in ship's order. photodna's container needs the SDK and Docker, as on a ship.
  const photoDnaProblem = placePhotoDnaSdk(CHECKOUT) ?? ensureDocker();
  if (photoDnaProblem) fail(`photodna can't be built: ${photoDnaProblem}.`);
  // rooms and the site bind to each other: in a new account, a Worker whose binding names one that isn't
  // deployed yet goes first without that binding, then again whole once every Worker is up.
  const deployedWorkerNames = new Set();
  const deployedAgain = [];
  for (const worker of WORKERS) {
    say(`Deploying ${worker}…`);
    const configText = readFileSync(join(CHECKOUT, configOf(worker)), "utf8");
    const missingNames = [...configText.matchAll(/"service":\s*"([\w-]+)"/g)].map((match) => match[1]).filter((name) => name !== `zaisma-${worker}` && !deployedWorkerNames.has(name));
    if (missingNames.length) {
      const firstText = missingNames.reduce((text, name) => text.replace(new RegExp(`,?\\s*\\{[^{}]*"service":\\s*"${name}"[^{}]*\\}`, "g"), ""), configText).replace(/\[\s*,/g, "[");
      writeFileSync(join(CHECKOUT, firstConfigOf(worker)), firstText);
      wranglerOrFail(["deploy", "--config", firstConfigOf(worker)], `Deploying ${worker} without its bindings to ${missingNames.join(", ")}`);
      deployedAgain.push(worker);
    } else wranglerOrFail(["deploy", "--config", configOf(worker)], `Deploying ${worker}`);
    deployedWorkerNames.add(`zaisma-${worker}`);
  }
  for (const worker of deployedAgain) {
    say(`Deploying ${worker} again, with every binding…`);
    wranglerOrFail(["deploy", "--config", configOf(worker)], `Deploying ${worker} again`);
    rmSync(join(CHECKOUT, firstConfigOf(worker)), { force: true });
  }

  // Fresh signing keys, made here and sent straight into the secrets, and the read key last: with it, the site's cron starts the copy.
  const putSecretWhenMissing = (worker, name, makeValue) => {
    const workerName = `zaisma-${worker}`;
    const secretList = wranglerOrFail(["secret", "list", "--name", workerName, "--format", "json"], `Listing ${workerName}'s secrets`);
    if (secretList.includes(`"${name}"`)) return;
    wranglerOrFail(["secret", "put", name, "--config", configOf(worker)], `Putting ${workerName}'s ${name}`, { input: makeValue() });
    say(`${workerName}'s ${name} put.`);
  };
  const ed25519Key = () => spawnSync(process.execPath, [join(CHECKOUT, "scripts", "rooms-key.mjs")], { encoding: "utf8" }).stdout;
  putSecretWhenMissing("rooms", "PASS_SIGNING_KEY", ed25519Key);
  putSecretWhenMissing("rooms", "RECEIPT_SIGNING_KEY", ed25519Key);
  putSecretWhenMissing("rooms", "PLAYER_TAG_KEY", () => randomBytes(32).toString("base64"));
  putSecretWhenMissing("site", "SIGN_IN_SIGNING_KEY", () => spawnSync(process.execPath, [join(CHECKOUT, "scripts", "sign-in-key.mjs")], { encoding: "utf8" }).stdout);
  putSecretWhenMissing("site", "RESTORE_KEY_ID", () => process.env.RESTORE_KEY_ID);
  putSecretWhenMissing("site", "RESTORE_KEY_SECRET", () => process.env.RESTORE_KEY_SECRET);

  // The copy: one restore_runs row, which the site's cron starts within five minutes.
  const runs = remoteRows("SELECT id FROM restore_runs");
  if (!runs.length) remoteRows(`INSERT INTO restore_runs (id, cutoff_at_ms, requested_at_ms) VALUES ('restore_${randomBytes(9).toString("base64url")}', ${chosen.cutoffAtMs}, ${Date.now()})`);
  answer(
    { night_date: chosen.night, cutoff_at: new Date(chosen.cutoffAtMs).toISOString(), next_step: "node scripts/restore.mjs status --account-id <id>" },
    `RESTORE STARTED ${chosen.night}: deployed on ${flags.get("site-domain")} and ${flags.get("game-domain")}; the site copies the rest within minutes of its next cron. Follow it with node scripts/restore.mjs status --account-id ${flags.get("account-id")}, then check. Put the other secrets from the password manager (each Worker's wrangler.jsonc lists them), and delete the read key once check passes.`,
  );
}

function restoreRow() {
  needTarget();
  if (!existsSync(join(CHECKOUT, siteConfig))) fail(`No ${siteConfig}: run hasn't made the configs in this checkout.`, "Run status and check from the checkout run used.");
  const [row] = remoteRows("SELECT * FROM restore_runs ORDER BY requested_at_ms DESC LIMIT 1");
  if (!row) fail("No restore has started in this account.", "node scripts/restore.mjs run …");
  return row;
}

function describeRow(row) {
  const state = row.failure_message ? `failed: ${row.failure_message}` : row.finished_at_ms ? `finished ${new Date(row.finished_at_ms).toISOString()}` : row.started_at_ms ? "copying" : "waiting for the site's cron (and the read key)";
  return `${state}; ${row.finished_part_count} of ${row.queued_part_count} parts, ${row.restored_object_count} objects (${(row.restored_size_bytes / 1024 ** 3).toFixed(2)} GB) restored, ${row.skipped_object_count} left out (deleted or taken down before the copy, or kinds a restore leaves out)`;
}

function checkRestore() {
  const row = restoreRow();
  const countsFile = (existsSync(RESTORE_FOLDER) ? readdirSync(RESTORE_FOLDER) : []).find((name) => name.endsWith(".counts.json"));
  if (!countsFile) fail("No row counts from the main database's download in .restore/.", "Run check from the checkout run used.");
  const expected = JSON.parse(readFileSync(join(RESTORE_FOLDER, countsFile), "utf8"));
  const problems = [];
  if (!row.finished_at_ms) problems.push(`the copy isn't finished (${describeRow(row)})`);
  if (row.failure_message) problems.push(`the copy failed: ${row.failure_message}`);
  // compressed_blobs is emptied by the restore itself, and Brotli copies are made again.
  for (const [tableName, rowCount] of Object.entries(expected)) {
    if (tableName === "compressed_blobs") continue;
    const [counted] = remoteRows(`SELECT COUNT(*) AS row_count FROM "${tableName.replaceAll('"', '""')}"`);
    if (counted?.row_count !== rowCount) problems.push(`${tableName} has ${counted?.row_count} rows, the backup ${rowCount}`);
  }
  if (problems.length) fail(`${problems.length} problem(s): ${problems.join("; ")}.`);
  answer({ checked_table_count: Object.keys(expected).length, ...row }, `RESTORE CHECKED every table's rows match the backup (${Object.keys(expected).length} tables); ${describeRow(row)}. Now play a game there.`);
}

if (command === "plan") {
  const { chosen, nights } = await chosenNight(backupStorage());
  answer(
    { night_date: chosen.night, cutoff_at: new Date(chosen.cutoffAtMs).toISOString(), night_dates: nights.map((night) => night.night) },
    `RESTORE PLAN the night of ${chosen.night}: its main database, and every other key's newest copy before ${new Date(chosen.cutoffAtMs).toISOString()}. Nights there are: ${nights.map((night) => night.night).join(", ")}.`,
  );
} else if (command === "run") await runRestore();
else if (command === "status") {
  const row = restoreRow();
  answer(row, `RESTORE STATUS ${describeRow(row)}.`);
} else if (command === "check") checkRestore();
else if (command === "clean") {
  for (const worker of WORKERS) for (const config of [configOf(worker), firstConfigOf(worker)]) rmSync(join(CHECKOUT, config), { force: true });
  rmSync(RESTORE_FOLDER, { recursive: true, force: true });
  answer({}, "RESTORE CLEAN the generated configs and the downloaded main database are gone from this checkout.");
} else fail(`${command || "No command"}: restore.mjs takes plan, run, status, check or clean.`, "node scripts/restore.mjs plan");
